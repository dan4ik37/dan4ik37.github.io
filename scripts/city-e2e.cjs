// «Живой город» P1 в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol) с настоящим city.sql в PGlite за местным мостом /__rpc:
// страница ходит в «Мир Денчика», ей подменяется только sbClient.rpc (city_* → PGlite, остальное — «функции нет»); сеть к Supabase
// закрыта целиком (Network.setBlockedURLs) — живую базу и живой мир проверка не трогает.
// Проверяет: работа с сервера (номер задания, сдача не раньше времени, зарплата), после перезагрузки — тот же кошелёк, навык и работа,
// общая стройка у двух игроков (две вкладки), 📱 «🏦 Банк», окно «🏙️ Экономика города», без city.sql — пробный режим и подсказка,
// ни одной ошибки в консоли. Снимки — E:\claude-tmp\city\shots. Режим perf — замер кадра в городах (профиль телефона).
// Запуск из корня сайта: node scripts/city-e2e.cjs            (нужны Chrome и PGlite: PGLITE_PATH=<папка>, как у city-sql-test.mjs)
//                         node scripts/city-e2e.cjs perf [замедление ЦП 4] [качество mid]   (D37_OVERRIDE=папка — старые файлы для «до»)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process'), { pathToFileURL } = require('url');
const SITE = path.join(__dirname, '..');
const [MODE = '', RATE = '4', Q = 'mid'] = process.argv.slice(2);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const SHOTS = path.join(TMP, 'city', 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); } };
async function findPglite(){
  const cands = [process.env.PGLITE_PATH, path.join(os.tmpdir(), 'd37-pglite'), 'E:/claude-tmp/d37raid/pg'].filter(Boolean);
  const pick = x => (typeof x === 'string' ? x : x && (pick(x.import) || pick(x.default) || pick(x.module)));
  for (const c of cands) for (const dir of [c, path.join(c, '@electric-sql/pglite'), path.join(c, 'node_modules/@electric-sql/pglite')]) {
    try { const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); if (pj.name !== '@electric-sql/pglite') continue; const m = await import(pathToFileURL(path.join(dir, pick(pj.exports && pj.exports['.']) || pj.module || pj.main || 'dist/index.js')).href); if (m.PGlite) return m.PGlite; } catch (e) {}
  }
  return null;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon' };
const U = c => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const U1 = U('1'), U2 = U('2');

(async () => {
  // ── база: city.sql в PGlite (как city-sql-test.mjs) ──
  const PGlite = await findPglite();
  if (!PGlite) { console.log('SKIP city-e2e: нет PGlite (PGLITE_PATH)'); process.exit(0); }
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table auth.users (id uuid primary key); create table public.profiles (id uuid primary key, nick text, role text default 'user');
    create table public.banned_nicks (nick text primary key); create table public.test_age (uid uuid primary key, g text);
    create function public.age_group_of(p_uid uuid) returns text language sql stable security definer set search_path = public as $$ select coalesce((select g from public.test_age where uid = p_uid), 'unknown') $$;
    grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant execute on functions to anon, authenticated;
    insert into auth.users values ('${U1}'), ('${U2}'); insert into public.profiles values ('${U1}', 'Тест1', 'admin'), ('${U2}', 'Тест2', 'user');
    insert into public.test_age values ('${U1}', 'adult'), ('${U2}', 'adult');`);
  await db.exec('begin;\n' + fs.readFileSync(path.join(SITE, 'city.sql'), 'utf8') + '\ncommit;');
  let OFF = false;   // «city.sql ещё не выполнен» — все city_* отвечают PGRST202
  let lock = Promise.resolve(); const one = f => (lock = lock.then(f, f));
  const rpcStat = { n: 0, bytes: 0, by: {} };
  const rpc = (uid, name, a = {}) => one(async () => {
    if (OFF || !/^city_(defs|public|state|act|admin)$/.test(name)) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name } };
    await db.exec(`reset role; set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${uid || ''}', false)`);
    const q = { city_defs: ['select public.city_defs() r', []], city_public: ['select public.city_public($1, $2) r', [a.p_city, a.p_rev ?? null]],
      city_state: ['select public.city_state($1, $2) r', [a.p_city ?? null, a.p_hist ?? 0]], city_act: ['select public.city_act($1, $2::jsonb, $3) r', [a.p_act, JSON.stringify(a.p_a ?? {}), a.p_dev ?? null]],
      city_admin: ['select public.city_admin($1, $2::jsonb) r', [a.p_act, JSON.stringify(a.p_a ?? {})]] }[name];
    try { const r = await db.query(q[0], q[1]); return { data: r.rows[0].r, error: null }; }
    catch (e) { return { data: null, error: { code: e.code || '42501', message: e.message } }; }
    finally { await db.exec('reset role'); }
  });
  // ── сайт + мост ──
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__rpc' && req.method === 'POST') {
      let b = ''; req.on('data', c => { b += c; }); req.on('end', async () => {
        const { uid, name, args } = JSON.parse(b || '{}'); const out = JSON.stringify(await rpc(uid, name, args));
        rpcStat.n++; rpcStat.bytes += out.length; rpcStat.by[name] = (rpcStat.by[name] || 0) + 1;
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(out);
      });
      return;
    }
    let p = decodeURIComponent(u.pathname); if (p === '/' || /^\/(play|games)\//.test(p)) p = '/index.html';
    let f = path.join(SITE, p);
    if (process.env.D37_OVERRIDE) { const o = path.join(process.env.D37_OVERRIDE, p); if (fs.existsSync(o)) f = o; }
    if (!f.startsWith(SITE) && !process.env.D37_OVERRIDE) { res.writeHead(404); res.end(); return; }
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port0 = 9300 + Math.floor(Math.random() * 400);
  fs.mkdirSync(SHOTS, { recursive: true });
  // у каждого «игрока» — свой процесс Chrome: вторая вкладка того же окна в headless — «в фоне» (requestAnimationFrame стоит,
  // таймеры раз в секунду) — игра у первой замерла бы
  const browsers = [];
  const launch = () => {
    const port = port0 + browsers.length, profile = fs.mkdtempSync(path.join(TMP, 'city', 'chrome-'));
    const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', '--ignore-gpu-blocklist', '--enable-precise-memory-info', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
    const br = { port, profile, proc }; browsers.push(br); return br;
  };
  const B1 = launch();
  const logs = [];
  async function page(uid, w = 1280, h = 720, mobile = false, br = B1){
    const port = br.port;
    let t = null;
    for (let i = 0; i < 80 && !t; i++) { try { const L = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); t = br.used ? null : L.find(x => x.type === 'page' && x.url === 'about:blank'); if (t || br.used) break; } catch (e) {} if (!t) await sleep(250); }
    br.used = true;
    if (!t) { try { t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch (e) {} }
    const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
    let id = 0; const cb = new Map();
    ws.onmessage = m => {
      const d = JSON.parse(m.data);
      if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
      if (d.method === 'Runtime.exceptionThrown') logs.push(uid.slice(0, 1) + ' exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push(uid.slice(0, 1) + ' error: ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    };
    const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expr, ms = 90000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*supabase.co*', '*googlesyndication*', '*doubleclick*', '*yandex.ru*', '*mc.yandex*', '*google-analytics*', '*googletagmanager*'] });
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
    if (mobile) { await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_settings: JSON.stringify({ gfxPreset: Q, gfx: Q }), d37_gfx: Q, d37_mir_pos: JSON.stringify({ x: 124, z: -24, y: .2, yaw: 1.57 }) };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
    const shot = async name => { const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 78 }); fs.writeFileSync(path.join(SHOTS, name + '.jpg'), Buffer.from(data, 'base64')); };
    return { send, ev, shot, uid };
  }
  // подмена: city_* → мост; «вошёл» как uid (только для MirEcon — остальной сайт об этом не знает)
  const FAKE = (uid, role) => `(async () => {
    window.__uid = ${JSON.stringify(uid)};
    const real = typeof sbClient !== 'undefined' && sbClient ? sbClient : {};
    const rpc = async (name, args) => { const r = await fetch('/__rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: window.__uid, name, args }) }); return await r.json(); };
    sbClient = new Proxy(real, { get(t, k) { if (k === 'rpc') return rpc; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } });
    currentUser = { id: window.__uid }; ${role ? `currentRole = ${JSON.stringify(role)};` : ''}
    const A = await MirEcon.api.init(true);
    return A.mode + '/' + A.why;
  })()`;
  const W = `GAME_IMPL.world._test.state()`, Z = W + '.zones';
  async function openWorld(p){
    await p.send('Page.navigate', { url: BASE + '/#/games/world' });
    let up = false; for (let i = 0; i < 240 && !up; i++) { await sleep(500); try { up = await p.ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.city?.kids?.mod)`, 5000); } catch (e) {} }
    return up;
  }
  try {
    if (MODE === 'errs') {   // ── только ошибки консоли за 30 с в детском городке (для сравнения «до / после» с D37_OVERRIDE) ──
      const p = await page(U1);
      const up = await (async () => { await p.send('Page.navigate', { url: BASE + '/#/games/world' }); for (let i = 0; i < 240; i++) { await sleep(500); try { if (await p.ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.zoneState('kids')?.built)`, 5000)) return true; } catch (e) {} } return false; })();
      ok(up, 'мир открылся (errs)');
      await sleep(30000);
      console.log('ошибок в консоли:', logs.length); for (const l of logs.slice(0, 6)) console.log('  ', l.slice(0, 300));
      throw new Error('errs готов');
    }
    if (MODE === 'perf') {   // ── замер кадра: профиль телефона, ЦП ×RATE, «средняя» ──
      const p = await page(U1, 412, 915, true);
      ok(await openWorld(p), 'мир открылся (perf)');
      await p.send('Emulation.setCPUThrottlingRate', { rate: +RATE || 4 });
      // своё время модуля города (update + frame обоих городов) — точнее кадра целиком, когда машина занята другими процессами
      await p.ev(`(() => { const A = window.D37Age; if (A) { A.known = () => true; A.canOpen = () => true; A.allows = () => true; A.group = () => 'adult'; }
        const S = ${W}, R = S.R; S.fixedTime = 13;
        window.__cm = { t: 0, n: 0, max: 0 };
        window.__wrapCity = () => { for (const c of ['kids', 'metro']) { const m = ${W}.zones?.city?.[c]?.mod; if (!m || m.__w) continue; m.__w = 1;
          for (const k of ['update', 'frame']) { const f = m[k]; m[k] = function(){ const t0 = performance.now(); try { return f.apply(this, arguments); } finally { const d = performance.now() - t0; __cm.t += d; if (k === 'update') __cm.n++; if (d > __cm.max) __cm.max = d; } }; } } };
        __wrapCity();
        window.__reset = () => { const T = R.stats; T.frames = T.sumDt = T.maxDt = T.sumCpu = T.maxCpu = T.sumR = 0; __cm.t = __cm.n = __cm.max = 0; };
        window.__snap = () => { const T = R.stats, n = Math.max(1, T.frames); return { fps: +(1000 / (T.sumDt / n)).toFixed(1), cpu: +(T.sumCpu / n).toFixed(2), cpuMax: +T.maxCpu.toFixed(1), calls: T.calls, city: +(__cm.t / n).toFixed(3), steps: __cm.n, cityMax: +__cm.max.toFixed(2), q: window.D37E?.gfxQuality?.(), guard: (() => { try { return localStorage.getItem('d37_gfx_guard') || ''; } catch (e) { return '?'; } })().slice(0, 80), heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }; };
        return true; })()`);
      const waitCity = `for (let i = 0; i < 120 && !${W}.zones?.city?.kids?.mod; i++) await new Promise(r => setTimeout(r, 250)); __wrapCity()`;
      const at = async (name, js, ms = 8000, settle = 2500) => { await p.ev(`(async () => { ${waitCity}; ${js}; await new Promise(r => setTimeout(r, ${settle})); __wrapCity(); __reset(); })()`); await sleep(ms); const s = await p.ev('__snap()'); console.log(name.padEnd(34), JSON.stringify(s)); return s; };
      const r1 = await at('Солнечный городок', ``, 8000, 6000);
      const working = await p.ev(`!!window.MirEcon`);
      const r2 = await at('Солнечный городок: работа (пекарь)', working ? `${Z}.city.kids.mod._.setJob('baker'); await new Promise(r => setTimeout(r, 1500))` : `${Z}.city.kids.mod._.setJob('baker')`, 8000, 2500);
      const r3 = await at('Большой город', `${Z}.padGo('metro'); await new Promise(r => setTimeout(r, 9000))`, 8000, 1000);
      console.log('итог perf:', JSON.stringify({ kids: r1, work: r2, metro: r3, rpc: rpcStat }));
      throw new Error('perf готов');
    }
    // ── 1. Сервер: работа, сдача не раньше времени, зарплата ──
    const A = await page(U1);
    ok(await openWorld(A), 'мир открылся, детский городок построен');
    ok((await A.ev(FAKE(U1, 'admin'))) === 'server/', 'MirEcon: режим сервера (city.sql в PGlite)');
    await A.ev(`${Z}.city.kids.jobBoard()`); await sleep(400);
    const board = await A.ev(`document.querySelector('.wld-panel')?.innerText || ''`);
    ok(/Пекарь/.test(board) && /Учитель/.test(board) && /Механик/.test(board) && /Город нанимает/.test(board) && /за задание/.test(board), 'щит «Работа»: профессии, зарплата за задание, «Город нанимает»', board.slice(0, 300));
    await A.shot('pc-jobboard');
    const t0 = Date.now();
    await A.ev(`${Z}.city.kids.mod._.setJob('baker')`); await sleep(1500);
    const job = await A.ev(`({ n: MirEcon.api.st.job?.n, prof: MirEcon.api.st.job?.prof, cash: MirEcon.api.st.cash, task: ${Z}.city.kids.mod._.C.task?.length })`);
    ok(job.prof === 'cook' && job.cash === 50 && job.task === 4, 'взял работу пекаря: подарок 50 💵, задание из 4 шагов', job);
    await A.ev(`(() => { const m = ${Z}.city.kids.mod; let k = 0; while (m._.C.task && m._.C.task[m._.C.step] && k++ < 20) m._.stepDone(); return m._.C.step; })()`);
    await sleep(800);
    const wait1 = await A.ev(`({ cash: MirEcon.api.st.cash, hud: document.querySelector('.mz-task')?.innerText || '', run: ${Z}.city.kids.mod._.C.run.st })`);
    ok(wait1.cash === 50 && /сдаём/.test(wait1.hud) && wait1.run === 'wait', 'шаги сделаны мгновенно — ждём минимальное время, рано не сдаём', wait1);
    let got = null; for (let i = 0; i < 60 && !got; i++) { await sleep(500); const c = await A.ev(`MirEcon.api.st.cash`); if (c > 50) got = { cash: c, at: (Date.now() - t0) / 1000 }; }
    ok(got && got.cash === 55 && got.at >= 20, 'работу сдали через ≥ 20 с — зарплата 5 💵 (5,70)', got);
    await A.shot('pc-after-task');
    const hud = await A.ev(`document.querySelector('.mz-wallet')?.innerText || ''`);
    ok(/55/.test(hud) && /Пекарь/.test(hud), 'кошелёк в углу: 55 💵 и роль', hud);
    // ── 2. Перезагрузка: кошелёк, навык и работа — с сервера ──
    await sleep(3200);   // следующее задание началось
    const n2 = await A.ev(`MirEcon.api.st.job?.n`);
    ok(await openWorld(A), 'мир после перезагрузки');
    await A.ev(FAKE(U1, 'admin')); await sleep(1500);
    const after = await A.ev(`({ cash: MirEcon.api.st.cash, sk: MirEcon.api.st.skills.cook, job: ${Z}.city.kids.mod._.C.job, n: MirEcon.api.st.job?.n, task: !!${Z}.city.kids.mod._.C.task })`);
    ok(after.cash === 55 && after.sk === 1 && after.job === 'baker' && after.n === n2 && after.task, 'после перезагрузки: те же 55 💵, навык 1, работа продолжается с тем же номером', after);
    // ── 3. 📱 Банк и окно «Экономика города» ──
    await A.ev(`D37Phone.open('bank')`); await sleep(1800);
    const bank = await A.ev(`document.querySelector('.ph-app-bank')?.innerText || ''`);
    ok(/55/.test(bank) && /навыки/i.test(bank) && /история/i.test(bank) && /Повар/.test(bank) && /налог 0,30/.test(bank), '📱 «🏦 Банк»: баланс, навыки, история', bank.slice(0, 300));
    await A.shot('pc-bank');
    await A.ev(`D37Phone.close?.()`); await sleep(400);
    await A.ev(`openCityEconomy()`); await sleep(2500);
    const adm = await A.ev(`document.querySelector('.cea-box')?.innerText || ''`);
    ok(/Экономика города/.test(adm) && /казна/.test(adm) && /M \(средний кошелёк/.test(adm) && /по дням/i.test(adm), '«🏙️ Экономика города»: казна, M/T, журнал по дням', adm.slice(300, 700));
    await A.shot('pc-admin-log');
    await A.ev(`[...document.querySelectorAll('.cea-btn')].find(b => /Настройки/.test(b.textContent))?.click()`); await sleep(1500);
    const cfg = await A.ev(`document.querySelectorAll('.cea-f input').length`);
    ok(cfg > 30, 'настройки: поля из белого списка', cfg);
    await A.shot('pc-admin-cfg');
    await A.ev(`[...document.querySelectorAll('.cea-btn')].find(b => /Проверка/.test(b.textContent))?.click()`); await sleep(1200);
    const chk = await A.ev(`document.querySelector('.cea-box')?.innerText || ''`);
    ok(/✅ 0/.test(chk), 'проверка: дрейф 0', chk.slice(0, 200));
    await A.ev(`D37CityAdm.close()`);
    // ── 4. Общая стройка у двух игроков ──
    await rpc(null, 'x');   // очередь
    await one(() => db.exec(`update public.city_cfg set data = '{"profs.builder.min": 5, "site.units": 2}'::jsonb, rev = rev + 1 where id = 1; update public.cities set rev = rev + 1;`));
    const B = await page(U2, 1280, 720, false, launch());
    ok(await openWorld(B), 'вторая вкладка: мир');
    ok((await B.ev(FAKE(U2))) === 'server/', 'вторая вкладка — второй игрок');
    for (const P of [A, B]) { await P.ev(`MirEcon.api.init(true).then(() => MirEcon.api.pubGet('kids', true))`); await sleep(300); await P.ev(`${Z}.city.kids.mod._.setJob('builder')`); }
    await sleep(1600);
    for (const P of [A, B]) await P.ev(`(() => { const m = ${Z}.city.kids.mod; let k = 0; while (m._.C.task && m._.C.task[m._.C.step] && k++ < 20) m._.stepDone(); })()`);
    let st2 = null; for (let i = 0; i < 80; i++) { await sleep(500); const a = await A.ev(`MirEcon.api.st.skills.builder | 0`), b = await B.ev(`MirEcon.api.st.skills.builder | 0`); if (a && b) { st2 = [a, b]; break; } }
    ok(st2, 'оба строителя сдали задание', st2);
    for (const P of [A, B]) await P.ev(`MirEcon.api.pubGet('kids', true)`);
    await sleep(600);
    const sA = await A.ev(`({ n: ${Z}.city.kids.mod._.C.siteN, kids: ${Z}.city.kids.mod._.C.K ? 1 : 0, site: MirEcon.api.pub.kids?.site })`), sB = await B.ev(`({ n: ${Z}.city.kids.mod._.C.siteN, site: MirEcon.api.pub.kids?.site })`);
    ok(sA.n === 1 && sB.n === 1 && sA.site === 2 && sB.site === 2, 'стройка: у обоих этап 1 (2 задания по 1 на этап)', { sA, sB });
    await A.shot('pc-site');
    // ── 5. Без city.sql: пробные денки, подсказка, без ошибок ──
    OFF = true;
    ok(await openWorld(A), 'мир без city.sql');
    ok((await A.ev(FAKE(U1))) === 'trial/nosql', 'без city.sql — пробный режим');
    await A.ev(`${Z}.city.kids.jobBoard()`); await sleep(400);
    const b2 = await A.ev(`document.querySelector('.wld-panel')?.innerText || ''`);
    ok(/появится, когда сайт обновится/.test(b2) && /пробные/.test(b2), 'щит: «Банк появится, когда сайт обновится», пробные денки', b2.slice(0, 200));
    await A.ev(`${Z}.city.kids.mod._.setJob('teacher')`); await sleep(1600);
    ok(await A.ev(`${Z}.city.kids.mod._.C.task?.length === 6 && MirEcon.api.st.job?.prof === 'teacher'`), 'пробная работа учителя — задание из 6 шагов');
    await A.shot('pc-trial');
    // ── 6. Телефон: щит и банк на узком экране ──
    const Pm = await page(U1, 412, 915, true);
    OFF = false;
    ok(await openWorld(Pm), 'мир на телефоне');
    await Pm.ev(FAKE(U1)); await Pm.ev(`${Z}.city.kids.jobBoard()`); await sleep(500); await Pm.shot('phone-jobboard');
    await Pm.ev(`D37Phone.open('bank')`); await sleep(1500); await Pm.shot('phone-bank');
    console.log('RPC за проверку:', JSON.stringify(rpcStat));
  } catch (e) {
    if (!/готов/.test(e.message)) { fail++; console.log('ОШИБКА', e.message); }
  } finally {
    // закрытая сеть — не ошибка; «Invalid value used as weak map key … W.compile … VS.frame» — прогрев шейдеров машин мира, было и до
    // «Живого города» (main, D37_OVERRIDE: та же ошибка) — в отчёте, не здесь
    const errs = logs.filter(l => !/supabase|ERR_BLOCKED|net::|Failed to fetch|WebSocket|realtime|favicon|yandex|google|adsbygoogle|status of 4\d\d|Failed to load resource/i.test(l) && !/weak map key[\s\S]*W\.compile/.test(l));
    if (MODE !== 'perf') ok(errs.length === 0, 'в консоли — без ошибок (кроме закрытой сети)', errs.slice(0, 8));
    for (const l of errs.slice(0, 8)) console.log('  консоль:', l.slice(0, 240));
    for (const b of browsers) { try { b.proc.kill(); } catch (e) {} }
    server.close(); await sleep(800);
    for (const b of browsers) { try { fs.rmSync(b.profile, { recursive: true, force: true }); } catch (e) {} }
    console.log(`city-e2e: ${pass} ok, ${fail} fail`);
    process.exit(fail ? 1 : 0);
  }
})().catch(e => { console.error(e); process.exit(1); });
