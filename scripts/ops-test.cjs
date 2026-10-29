// Ops (T-016, docs/OPS.md): то, что не покрывают errlog-test, ops-sql-test и backup-test —
//  1) гигиена репозитория (он ОТКРЫТЫЙ): .gitignore закрывает backup.env / *.env / копии базы; в файлах нет паролей базы, ключей service_role,
//     токенов GitHub / Supabase, закрытых ключей; нет лишних *.env и *.sql.gz;
//  2) проводка: кнопка «🩺 Ошибки сайта» в панели админа, openSiteErrors() подгружает js/features/ops-admin.js только админу и один раз,
//     имена функций в ops.sql = вызовы в diag.js и ops-admin.js, политика конфиденциальности говорит про отчёты об ошибках;
//  3) окно админа (js/features/ops-admin.js) в песочнице с маленьким DOM: список, период, скрыть, «Для ИИ», очистить, ошибки (нет ops.sql,
//     не админ), чужой текст — только как текст (<img onerror> не становится картинкой), innerHTML в файле не используется;
//  4) 404: scripts/serve.py (повторяет vercel.json) отдаёт мусорным адресам настоящий статус 404 и страницу 404.html;
//     разделы сайта — index.html со статусом 200; /api/* и серверные страницы локально — 404.
// Запуск из корня сайта: node scripts/ops-test.cjs
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), http = require('http');
const { spawn, spawnSync } = require('child_process');
const SITE = process.argv[2] || path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(SITE, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : (typeof extra === 'string' ? extra : JSON.stringify(extra))); } };
const tick = () => new Promise(r => setImmediate(r));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ═══ 1. Гигиена репозитория ═══
  {
    const ig = read('.gitignore').split('\n').map(s => s.trim());
    for (const p of ['backup.env', '*.env', '.env', '.env.*', 'backups/', '*.sql.gz', '*.sql.gz.tmp', '*.dump']) ok(ig.includes(p), `.gitignore: ${p}`);
    const SKIP = new Set(['node_modules', '.git', '.claude', 'dist', 'vendor', 'logs']);
    const all = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else all.push(p); } })(SITE);
    const rel = p => path.relative(SITE, p).replace(/\\/g, '/');
    const stray = all.map(rel).filter(f => /(^|\/)(backup\.env|\.env(\..+)?)$|\.env$|\.sql\.gz(\.tmp)?$|\.dump$/i.test(f));
    ok(!stray.length, 'в репозитории нет файлов настроек (*.env) и копий базы (*.sql.gz, *.dump)', stray);
    // секреты: проверочные файлы (в них нарочно поддельные) не сканируем
    const TEXT = /\.(js|cjs|mjs|html|md|json|yml|yaml|sql|ps1|py|txt|css|cs|h|rs|kt|gradle|xml|toml)$/i;
    const fixtures = /^scripts\/.*(test|e2e)[^/]*\.(cjs|mjs)$/;
    const PUBLIC_KEYS = new Set(['AIzaSyA0dK2a1YG_s54zG-zapYgjycIempCvHp0']);   // ключ YouTube Data API сайта: браузерный, ограничен по адресу сайта (CLAUDE.md)
    const rules = [
      ['адрес базы с паролем', /postgres(?:ql)?:\/\/[^\s:@\/'"`]+:([^\s@'"`]{4,})@[\w.-]+/g, m => !/\[YOUR|PASSWORD|ПАРОЛЬ|ВАШ|<|\$\{|\*\*\*|xxx|%s/i.test(m[0])],
      ['JWT service_role / admin', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, m => { try { const p = JSON.parse(Buffer.from(m[0].split('.')[1], 'base64url').toString()); return !['anon', 'authenticated'].includes(p.role); } catch (e) { return true; } }],
      ['токен Supabase (sbp_)', /\bsbp_[0-9a-f]{30,}\b/g, () => true],
      ['токен GitHub', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|github_pat_[A-Za-z0-9_]{30,}/g, () => true],
      ['закрытый ключ', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/g, () => true],
      ['ключ AWS', /\bAKIA[0-9A-Z]{16}\b/g, () => true],
      ['боевой ключ Stripe', /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}\b/g, () => true],
      ['ключ Google API (кроме ключа сайта)', /\bAIza[0-9A-Za-z_-]{35}\b/g, m => !PUBLIC_KEYS.has(m[0])],
    ];
    const hits = [];
    for (const f of all) {
      const r = rel(f);
      if (!TEXT.test(r) || fixtures.test(r)) continue;
      let s; try { s = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
      if (s.length > 6e6) continue;
      for (const [name, re, keep] of rules) { re.lastIndex = 0; let m; while ((m = re.exec(s))) { if (keep(m)) hits.push(r + ': ' + name); if (re.lastIndex === m.index) re.lastIndex++; } }
    }
    ok(!hits.length, 'в файлах сайта нет паролей базы, service_role, токенов и закрытых ключей', hits.slice(0, 10));
    const wf = read('.github/workflows/tests.yml');
    ok(!/secrets\./.test(wf) && !/upload-artifact/.test(wf) && /permissions:\s*\n\s+contents: read/.test(wf), 'workflow: без секретов, без артефактов, права только на чтение');
    ok(/branches: \[main\]/.test(wf) && /pull_request:/.test(wf) && /timeout-minutes: 15/.test(wf) && /node scripts\/ci-run\.cjs/.test(wf), 'workflow: push в main + PR, срок 15 минут, запускает ci-run');
    ok(!/pg_dump|DATABASE_URL|backup-db/i.test(wf), 'workflow: резервные копии базы через Actions не делаются (репозиторий открытый)');
    ok(/name: Site tests \(Windows, Node 24\)/.test(wf) && /persist-credentials: false/.test(wf), 'workflow: имя задания «Site tests (Windows, Node 24)» (его выбирают в Vercel Deployment Checks) и без сохранения токена');
    // каждая проверка в scripts/ — в списке ci-run.cjs или в явном списке «нарочно не здесь» (иначе новую проверку забудут)
    const ci = read('scripts/ci-run.cjs');
    const inManifest = new Set([...ci.matchAll(/\{ f: '([^']+)'/g)].map(m => m[1]));
    const NOT_IN_CI = {   // нужны своя среда, долгие или медленные — запускаются руками
      'climate-e2e.cjs': 'Chrome, долгая (погода, 1–2 мин), снимки', 'iogames-e2e.cjs': 'Chrome, своя раздача и боты (12+ с)', 'iogames-online-e2e.cjs': 'Chrome, две вкладки, связь',
      'kubomir-e2e.cjs': 'Chrome, 10+ минут прогона', 'kubomir-look-e2e.cjs': 'Chrome: снимки «до/после», замеры телефона и видеокарты (T-096a)','raid-e2e.cjs': 'Chrome, подменный сервер', 'room-net-e2e.cjs': 'Chrome + настоящий Supabase',
      'kubomir-coop-e2e.cjs': 'два Chrome + настоящий Supabase и WebRTC, до 10 минут', 'podzem-support-e2e.cjs': 'Chrome, профиль телефона (ЦП ×4), замеры обрушения',
      'kubomir-qol-e2e.cjs': 'Chrome, помощники «Кубомира»: снимки, замеры на профиле телефона (ЦП ×4), 20 открытий, 10 минут игры',
      'podzem-fire-e2e.cjs': 'Chrome, огонь «Подземья»: замеры на профиле телефона (ЦП ×4), снимки, 20 открытий, 10 минут игры',
      'studio-fire-e2e.cjs': 'Chrome, огонь «Студии 3D»: ▶ Играть, пожар ~1 мин, снимок',
      'hud2-e2e.cjs': 'Chrome, интерфейс игр 2.0 (T-123): доля экрана, кнопки, середина, палец, покой — телефон стоя/лёжа (ЦП ×4) и ПК, снимки',
    };
    const files = fs.readdirSync(path.join(SITE, 'scripts')).filter(f => /-(test|e2e)\.(cjs|mjs)$/.test(f));
    const forgotten = files.filter(f => !inManifest.has(f) && !NOT_IN_CI[f]);
    ok(!forgotten.length, 'каждая проверка в scripts/ — в списке ci-run.cjs (TESTS) или в списке «нарочно не в CI» (ops-test.cjs): забытые — ниже', forgotten);
    const missing = [...inManifest].filter(f => !fs.existsSync(path.join(SITE, 'scripts', f)));
    ok(!missing.length, 'в списке ci-run.cjs нет несуществующих файлов', missing);
    ok(Object.keys(NOT_IN_CI).every(f => fs.existsSync(path.join(SITE, 'scripts', f)) && !inManifest.has(f)), 'список «нарочно не в CI» не устарел (файлы есть и в CI не попали)');
  }

  // ═══ 2. Проводка ═══
  {
    const idx = read('index.html');
    ok(/<div id="profileAdminPanel"[\s\S]*?<button onclick="openSiteErrors\(\)" class="profile-admin-btn">🩺 Ошибки сайта<\/button>[\s\S]*?<\/details>/.test(idx), 'index.html: кнопка «🩺 Ошибки сайта» в панели администратора');
    ok(!/ops-admin\.js/.test(idx), 'index.html: ops-admin.js не подключён (грузится только админу по кнопке)');
    const rm = read('js/features/role-management.js');
    const m = /function openSiteErrors\(\) \{[\s\S]*?\n\}/.exec(rm);
    ok(!!m, 'role-management.js: openSiteErrors() есть');
    if (m) {
      const mkEnv = role => {
        const s = { appended: [], alerts: [], opened: 0 };
        s.window = s; s.currentRole = role; s.GAMES_VER = '115';
        s.document = { createElement: () => ({}), head: { appendChild: el => { s.appended.push(el); return el; } } };
        s.alert = t => s.alerts.push(t);
        vm.createContext(s); vm.runInContext(m[0] + ';this.f = openSiteErrors;', s);
        return s;
      };
      let e = mkEnv('user'); e.f();
      ok(!e.appended.length, 'openSiteErrors: не админ — файл не грузится');
      e = mkEnv('admin'); e.f();
      ok(e.appended.length === 1 && /^js\/features\/ops-admin\.js\?v=115/.test(e.appended[0].src), 'openSiteErrors: админ — грузит js/features/ops-admin.js?v=<версия>', e.appended);
      e.window.D37Ops = { open() { e.opened++; } }; e.appended[0].onload();
      ok(e.opened === 1, 'openSiteErrors: после загрузки открывает окно');
      e.f();
      ok(e.opened === 2 && e.appended.length === 1, 'openSiteErrors: второй раз — без повторной загрузки');
      e = mkEnv('admin'); e.f(); e.appended[0].onerror();
      ok(e.alerts.length === 1, 'openSiteErrors: файл не загрузился — понятное сообщение');
    }
    const sql = read('ops.sql'), diag = read('api/_lib/routes/diag.js'), ui = read('js/features/ops-admin.js');
    ok(/sbRpc\('ops_err_ingest'/.test(diag) && /function public\.ops_err_ingest\(|function public\.ops_err_ingest\s*\(/.test(sql.replace(/create or replace /i, '')) && /ops_err_ingest\(jsonb, jsonb\) to service_role/.test(sql), 'ops_err_ingest: вызов в diag.js = функция в ops.sql, права только service_role');
    ok(/rpc\('ops_err_admin'/.test(ui) && /rpc\('ops_err_act'/.test(ui) && /function public\.ops_err_admin/.test(sql) && /function public\.ops_err_act/.test(sql), 'ops_err_admin / ops_err_act: вызовы в ops-admin.js = функции в ops.sql');
    ok(/keep_days', 14/.test(sql) && /14 суток/.test(read('docs/BACKUPS.md') + idx), 'срок хранения 14 суток — в ops.sql и в политике конфиденциальности');
    ok(/Сообщения об ошибках сайта/.test(idx) && /Сообщения об ошибках сайта/.test(read('privacy.html')), 'политика конфиденциальности (окно и privacy.html): абзац про отчёты об ошибках');
    ok(!/\binnerHTML\b|insertAdjacentHTML|outerHTML|document\.write/.test(ui), 'ops-admin.js: чужой текст только через textContent (innerHTML / insertAdjacentHTML не используются)');
    const doc = read('docs/BACKUPS.md'), ps = read('scripts/backup-db.ps1');
    const params = (/param\(([\s\S]*?)\n\)/.exec(ps) || [])[1] || '';
    ok(/-Check/.test(doc) && /\[switch\]\$Check/.test(params) && /\$EnvFile/.test(params) && /backup\.env/.test(doc) && /scripts\\backup-db\.ps1/.test(doc), 'BACKUPS.md: команды и имена файлов совпадают со скриптом (-Check, backup.env)');
    ok(/Register-ScheduledTask/.test(doc) && /-StartWhenAvailable/.test(doc) && /Session pooler/.test(doc) && /6543/.test(doc) && /открытый/.test(doc), 'BACKUPS.md: расписание, Session pooler вместо 6543, предупреждение про открытый репозиторий');
    ok(!/postgres(?:ql)?:\/\/[^\s:]+:[A-Za-z0-9%._~-]{6,}@/.test(doc), 'BACKUPS.md: в примерах нет настоящего пароля');
  }

  // ═══ 3. Окно админа в песочнице с маленьким DOM ═══
  {
    class El {
      constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.className = ''; this.style = {}; this.listeners = {}; this.parentNode = null; this._t = ''; this.title = ''; this.type = ''; this.id = ''; }
      set textContent(v) { this.children.length = 0; this._t = String(v); }
      get textContent() { return this._t + this.children.map(c => c.textContent).join(''); }
      appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parentNode = null; } return c; }
      remove() { if (this.parentNode) this.parentNode.removeChild(this); }
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
      select() {}
      click() { for (const f of this.listeners.click || []) f({ target: this }); }
      all(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.children) c.all(pred, out); return out; }
    }
    const ROW = (o = {}) => Object.assign({ k: 'abcdef0123456789', t: 'e', m: "TypeError: Cannot read properties of undefined (reading 'length')", f: '/js/games/kubomir.js', l: 120, st: 'tick /js/games/kubomir.js:120:5\nloop /js/games/kubomir.js:200:7', first_at: new Date(Date.now() - 3 * 864e5).toISOString(), last_at: new Date(Date.now() - 300e3).toISOString(), first_v: '114', last_v: '115', ign: false, v: { 114: 11, 115: 40 }, r: { 'play/kubomir': 45, chat: 6 }, b: { 'chrome/129': 30, 'safari/17': 21 }, o: { windows: 30, ios: 21 }, d: { m: 20, d: 31 }, n_all: 80, n_win: 51, s_win: 12, n_today: 9 }, o);
    const SUMMARY = (top, o = {}) => Object.assign({ ok: true, now: new Date().toISOString(), today: '2026-10-22', days: 7, cfg: { keep_days: 14, calls_day: 6000, items_day: 20000, newk_day: 300 }, quota: { day: '2026-10-22', calls: 600, items: 1000, newk: 4 },
      daily: Array.from({ length: 7 }, (_, i) => ({ day: '2026-10-' + (16 + i), n: i === 6 ? 9 : i, s: i === 6 ? 4 : 1, keys: 2 })), top, keys_total: top.length }, o);
    async function mk(rpcImpl, role = 'admin') {
      const doc = new El('html'); doc.head = new El('head'); doc.body = new El('body'); doc.documentElement = doc;
      const kd = [];
      doc.createElement = t => new El(t);
      doc.createTextNode = t => { const e = new El('#text'); e._t = String(t); return e; };
      doc.getElementById = id => doc.head.all(e => e.id === id)[0] || null;
      doc.addEventListener = (t, f) => { if (t === 'keydown') kd.push(f); };
      doc.execCommand = () => true;
      const clip = [], calls = [];
      const win = {
        document: doc, currentRole: role, sbClient: { rpc: async (name, args) => { calls.push([name, args]); return rpcImpl(name, args); } },
        navigator: { clipboard: { writeText: async t => { clip.push(t); } } }, confirm: () => win.__confirm, alert: t => { win.__alerts.push(t); }, __alerts: [], __confirm: true,
        setTimeout: (f, ms) => { win.__timers.push(f); return 1; }, __timers: [], Date, Math, Object, Array, String, Number, JSON, console,
      };
      win.window = win;
      vm.createContext(win);
      vm.runInContext(fs.readFileSync(path.join(SITE, 'js/features/ops-admin.js'), 'utf8'), win);
      return { win, doc, kd, clip, calls, text: () => doc.body.textContent, byText: t => doc.body.all(e => e.tagName === 'BUTTON' && e.textContent === t)[0] };
    }
    // обычный список
    let rows = [ROW(), ROW({ k: 'k2', m: 'Вторая ошибка', f: '/js/features/chat.js', l: 5, n_win: 3, s_win: 2, first_at: new Date(Date.now() - 20 * 864e5).toISOString(), ign: true })];
    let E = await mk(async () => ({ data: SUMMARY(rows), error: null }));
    E.win.D37Ops.open(); await tick(); await tick();
    ok(E.calls.length === 1 && E.calls[0][0] === 'ops_err_admin' && E.calls[0][1].p_days === 7, 'окно: открылось и запросило ops_err_admin(7)', E.calls);
    let T = E.text();
    ok(/Ошибки сайта/.test(T) && T.includes("TypeError: Cannot read properties of undefined (reading 'length')") && T.includes('/js/games/kubomir.js:120') && /51×/.test(T), 'окно: видно сообщение, файл:строку, число случаев');
    ok(/v115 ×40/.test(T) && /v114 ×11/.test(T) && /chrome\/129 ×30/.test(T) && /📱 телефон ×20/.test(T) && /play\/kubomir ×45/.test(T), 'окно: версии, браузеры, устройства, разделы с числами');
    ok(!T.includes('Вторая ошибка'), 'окно: скрытая ошибка по умолчанию не показана');
    ok(/9\s*ошибок сегодня \(4 виз/.test(T) && /\d+ %\s*потолка за сутки/.test(T), 'окно: сводка — сегодня 9 ошибок в 4 визитах, потолок суток в процентах', T.slice(0, 400));
    ok(E.byText('Сутки') && E.byText('7 дней') && E.byText('14 дней') && E.byText('7 дней').className.includes('on'), 'окно: кнопки периода, выбранная — 7 дней');
    E.byText('14 дней').click(); await tick(); await tick();
    ok(E.calls[1][0] === 'ops_err_admin' && E.calls[1][1].p_days === 14, 'окно: «14 дней» запрашивает 14');
    E.byText('Сутки').click(); await tick(); await tick();
    ok(E.calls[2][1].p_days === 1, 'окно: «Сутки» запрашивает 1');
    const hid = E.byText('🙈 Скрытые: нет'); hid.click();
    ok(E.text().includes('Вторая ошибка') && !!E.byText('🙈 Скрытые: показаны'), 'окно: «Скрытые» показывает скрытую ошибку');
    const showBtn = E.byText('Показывать');
    ok(!!showBtn, 'окно: у скрытой ошибки кнопка «Показывать»');
    showBtn.click(); await tick(); await tick();
    ok(E.calls.some(c => c[0] === 'ops_err_act' && c[1].p_act === 'unign' && c[1].p_k === 'k2'), 'окно: «Показывать» → ops_err_act(unign, k2)', E.calls.map(c => c[0] + ':' + JSON.stringify(c[1])));
    E.byText('🙈 Скрыть').click(); await tick(); await tick();
    ok(E.calls.some(c => c[0] === 'ops_err_act' && c[1].p_act === 'ign' && c[1].p_k === 'abcdef0123456789'), 'окно: «Скрыть» → ops_err_act(ign, k)');
    // «Подробнее» и «Для ИИ»
    E.byText('Подробнее').click();
    ok(/Стек:\ntick \/js\/games\/kubomir\.js:120:5\nloop/.test(E.text()) && /Отпечаток: abcdef0123456789/.test(E.text()), 'окно: «Подробнее» — стек, отпечаток');
    E.byText('Свернуть').click();
    ok(!/Отпечаток:/.test(E.text()), 'окно: «Свернуть» прячет подробности');
    E.byText('📋 Для ИИ').click(); await tick();
    const ai = E.clip[0] || '';
    ok(/dan4ik37\.vercel\.app/.test(ai) && ai.includes("Cannot read properties of undefined (reading 'length')") && ai.includes('Файл: /js/games/kubomir.js:120') && /v115 ×40/.test(ai) && /Стек:\n {2}tick \/js\/games\/kubomir\.js:120:5/.test(ai) && /51 раз в 12 визитах/.test(ai), '«Для ИИ»: сообщение, файл:строка, версии, стек, число случаев — одним куском текста', ai);
    ok(/✓ Скопировано/.test(E.text()), '«Для ИИ»: кнопка подтверждает «✓ Скопировано»');
    // очистить всё
    const nAct = E.calls.filter(c => c[0] === 'ops_err_act').length;
    E.win.__confirm = false; E.byText('🧹 Очистить всё').click(); await tick();
    ok(E.calls.filter(c => c[0] === 'ops_err_act').length === nAct, 'окно: «Очистить всё» без подтверждения — ничего не стирает');
    E.win.__confirm = true; E.byText('🧹 Очистить всё').click(); await tick(); await tick();
    ok(E.calls.some(c => c[0] === 'ops_err_act' && c[1].p_act === 'clear'), 'окно: «Очистить всё» после подтверждения → ops_err_act(clear)');
    // закрытие
    ok(!!E.doc.body.children.find(c => c.className === 'ops-modal'), 'окно: в документе');
    for (const f of E.kd) f({ key: 'Escape' });
    ok(!E.doc.body.children.find(c => c.className === 'ops-modal'), 'окно: Esc закрывает');
    E.win.D37Ops.open(); await tick(); await tick();
    const modal = E.doc.body.children.find(c => c.className === 'ops-modal');
    for (const f of modal.listeners.click || []) f({ target: modal });
    ok(!E.doc.body.children.find(c => c.className === 'ops-modal'), 'окно: клик по фону закрывает');
    ok(E.doc.head.all(e => e.id === 'opsCss').length === 1, 'окно: стили добавлены один раз (после трёх открытий)');
    // чужой текст — только текст
    const evil = '<img src=x onerror=alert(1)> <script>alert(2)</script>';
    E = await mk(async () => ({ data: SUMMARY([ROW({ m: evil, f: '/js/<b>x</b>.js', st: evil, r: { [evil]: 1 }, b: { [evil]: 2 }, v: { [evil]: 3 } })]), error: null }));
    E.win.D37Ops.open(); await tick(); await tick();
    E.byText('Подробнее').click();
    const tags = E.doc.body.all(e => /^(IMG|SCRIPT|IFRAME|A|STYLE|LINK|OBJECT|EMBED)$/.test(e.tagName));
    ok(E.text().includes(evil) && !tags.length, 'окно: <img onerror> и <script> из базы показываются буквами, элементов не создают', tags.map(t => t.tagName));
    // пустая база
    E = await mk(async () => ({ data: SUMMARY([], { keys_total: 0 }), error: null }));
    E.win.D37Ops.open(); await tick(); await tick();
    ok(/За выбранный период ошибок нет/.test(E.text()), 'окно: пусто — «ошибок нет»');
    // ошибки загрузки
    E = await mk(async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.ops_err_admin(p_days) in the schema cache' } }));
    E.win.D37Ops.open(); await tick(); await tick();
    ok(/Выполни файл\s*ops\.sql/.test(E.text()) && /Мониторинг ещё не включён/.test(E.text()), 'окно: нет ops.sql (PGRST202) — «Выполни файл ops.sql»');
    E = await mk(async () => ({ data: null, error: { code: '42501', message: 'Только для админа' } }));
    E.win.D37Ops.open(); await tick(); await tick();
    ok(/Только для админа/.test(E.text()), 'окно: не админ на сервере — «Только для админа»');
    E = await mk(async () => { throw new Error('сеть упала'); });
    E.win.D37Ops.open(); await tick(); await tick();
    ok(/Ошибка загрузки: сеть упала/.test(E.text()), 'окно: сбой сети — понятная строка, без исключения');
    E = await mk(async () => ({ data: null, error: { code: 'XX000', message: 'что-то в базе' } }));
    E.win.D37Ops.open(); await tick(); await tick();
    ok(/Ошибка загрузки: что-то в базе/.test(E.text()), 'окно: другая ошибка базы — её текст');
    E = await mk(async () => ({ data: SUMMARY([]), error: null }), 'user');
    E.win.D37Ops.open(); await tick();
    ok(E.calls.length === 0 && !E.doc.body.children.length, 'окно: не админ (currentRole) — не открывается и в базу не ходит');
    E = await mk(async () => ({ data: SUMMARY([]), error: null }));
    E.win.sbClient = null; E.win.D37Ops.open(); await tick(); await tick();
    ok(/Нет связи с сервером/.test(E.text()), 'окно: нет клиента Supabase — «Нет связи с сервером»');
    const old = E.win.D37Ops.open; vm.runInContext(fs.readFileSync(path.join(SITE, 'js/features/ops-admin.js'), 'utf8'), E.win);
    ok(E.win.D37Ops.open === old, 'ops-admin.js: повторная загрузка файла ничего не пересоздаёт');
    const t = E.win.D37Ops._test;
    ok(t.top({ a: 3, b: 10, c: 1 }, k => k.toUpperCase(), 2).join() === 'B ×10,A ×3' && t.top(null).length === 0, 'top(): по убыванию, с подписью, не больше N, пустое');
    ok(t.ago(new Date(Date.now() - 20e3).toISOString()) === 'только что' && /мин назад/.test(t.ago(new Date(Date.now() - 600e3).toISOString())) && /ч назад/.test(t.ago(new Date(Date.now() - 7200e3).toISOString())) && /дн\. назад/.test(t.ago(new Date(Date.now() - 3 * 864e5).toISOString())), 'ago(): только что / мин / ч / дн.');
  }

  // ═══ 4. 404 ═══
  {
    ok(fs.existsSync(path.join(SITE, '404.html')), '404.html есть');
    const nf = read('404.html');
    ok(/<meta name="robots" content="noindex">/.test(nf) && /Такой страницы нет/.test(nf) && /href="\/"/.test(nf), '404.html: noindex, понятный текст, ссылка на главную');
    const vj = JSON.parse(read('vercel.json'));
    ok(!vj.rewrites.some(r => /^\/(\(\.\*\)|:path\*|:path\(\.\*\))$/.test(r.source) || r.source === '/:path*'), 'vercel.json: нет «всё → index.html» (иначе мусор отдавал бы 200)');
    const py = spawnSync('python', ['--version'], { encoding: 'utf8' });
    if (py.error || py.status !== 0) { console.log('SKIP 404 через serve.py: нет python'); }
    else {
      const PORT = 5594;
      const srv = spawn('python', [path.join(SITE, 'scripts/serve.py'), String(PORT)], { cwd: SITE, env: { ...process.env, D37_SERVE_QUIET: '1' }, stdio: 'ignore' });
      const get = p => new Promise(res => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ code: r.statusCode, body: b, loc: r.headers.location })); }).on('error', () => res({ code: 0, body: '' })));
      try {
        let up = false; for (let i = 0; i < 80 && !up; i++) { up = (await get('/robots.txt')).code > 0; if (!up) await sleep(150); }
        ok(up, 'serve.py запустился');
        for (const p of ['/definitely-not-a-page-xyz', '/zzz/qqq/www', '/js/nope.js', '/css/nope.css', '/img/nope.png', '/.env', '/index.html.bak', '/Chat', '/chat-x', '/api/nope']) {
          const r = await get(p);
          ok(r.code === 404 && (p === '/api/nope' || /Страница не найдена/.test(r.body)), `serve.py: ${p} → 404${p === '/api/nope' ? '' : ' и страница 404.html'}`, { code: r.code });
        }
        for (const p of ['/chat', '/play/sudoku', '/profile', '/play/zzz/qqq']) { const r = await get(p); ok(r.code === 200 && /<title>dan4ik37/.test(r.body), `serve.py: ${p} → index.html (200), разделы сайта`, { code: r.code }); }
        const r1 = await get('/home'); ok(r1.code === 308 && r1.loc === '/', 'serve.py: /home → 308 на /');
        ok((await get('/api/diag')).code === 404, 'serve.py: /api/diag локально — 404 (это функция Vercel)');
      } finally { srv.kill(); }
    }
  }

  console.log(`ops-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ПАДЕНИЕ:', e && e.stack || e); process.exit(1); });
