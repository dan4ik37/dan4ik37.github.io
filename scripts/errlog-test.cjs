// Мониторинг ошибок сайта (T-016, docs/OPS.md) без браузера и без базы:
//  1) общие помощники errCore: очистка текста от личных данных, путь файла, стек, раздел, браузер/система/устройство, «шум»;
//  2) этап 1 (в <head>): не ставится на чужих адресах, ничего не делает без ошибок, копит записи, подгружает этап 2, не бросает;
//  3) этап 2 (js/core/errlog.js): очистка, дедуп, выбор, пачки, лимиты (визит, сутки, ответ сервера), sendBeacon при уходе,
//     «не бросает» и «не зацикливается» на злых окружениях, затраты (200 тысяч одинаковых ошибок);
//  4) сервер POST /api/diag: метод, размер, лимиты, перепроверка присланного, ответы без базы / без ops.sql / при потолке, шквал;
//  5) файлы: js/core/errlog.js и блок в index.html свежие (node scripts/make-errlog.mjs), page.js, vercel.json, pages.js, лимит функций.
// Запуск из корня сайта: node scripts/errlog-test.cjs   (временное — D37_TMP или системная папка)
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const { pathToFileURL } = require('url');
const SITE = process.argv[2] || path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(SITE, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : (typeof extra === 'string' ? extra : JSON.stringify(extra))); } };
const tick = () => new Promise(r => setImmediate(r));
const HOST = 'dan4ik37.vercel.app';
const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  atablet: 'Mozilla/5.0 (Linux; Android 12; SM-T500) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.52',
  opera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/114.0.0.0',
  yandex: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 YaBrowser/24.10.0.0 Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  fxios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
  bot: 'curl/8.4.0',
};

(async () => {
  // ═══ api/ как ES-модули (в корне сайта package.json без "type": "module") ═══
  const tmp = fs.mkdtempSync(path.join(process.env.D37_TMP || os.tmpdir(), 'd37-errlog-test-'));
  try {
    fs.cpSync(path.join(SITE, 'api'), path.join(tmp, 'api'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
    process.env.SUPABASE_URL = 'https://sb.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    const M = await import(pathToFileURL(path.join(tmp, 'api/_lib/errlog.js')).href);
    const D = await import(pathToFileURL(path.join(tmp, 'api/_lib/routes/diag.js')).href);
    const P = await import(pathToFileURL(path.join(tmp, 'api/_lib/page.js')).href);
    const K = M.errCore();

    // ═══ 1. Общие помощники ═══
    // адрес → путь
    ok(K.urlPath('https://dan4ik37.vercel.app/js/games/x.js?v=115#h', HOST) === '/js/games/x.js', 'urlPath: свой — путь без запроса и #');
    ok(K.urlPath('/js/a.js?token=abc', HOST) === '/js/a.js' && K.urlPath('js/a.js', HOST) === '/js/a.js', 'urlPath: относительный');
    ok(K.urlPath('//dan4ik37.vercel.app/js/p.js', HOST) === '/js/p.js', 'urlPath: без протокола');
    ok(K.urlPath('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js', HOST) === 'cdn:/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js', 'urlPath: jsDelivr — cdn:/…');
    ok(K.urlPath('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', HOST) === '', 'urlPath: чужой — пусто');
    ok(K.urlPath('https://evil.example/dan4ik37.vercel.app/js/x.js', HOST) === '', 'urlPath: чужой с нашим именем в пути — пусто');
    ok(K.urlPath('https://dan4ik37.vercel.app.evil.example/js/x.js', HOST) === '', 'urlPath: похожий домен — пусто');
    ok(K.urlPath('blob:https://dan4ik37.vercel.app/abc', HOST) === '' && K.urlPath('data:text/javascript,alert(1)', HOST) === '' && K.urlPath('chrome-extension://abc/x.js', HOST) === '' && K.urlPath('javascript:void(0)', HOST) === '', 'urlPath: blob / data / расширение / javascript — пусто');
    ok(K.urlPath('', HOST) === '' && K.urlPath(null, HOST) === '' && K.urlPath(undefined, HOST) === '', 'urlPath: пусто → пусто');
    ok(K.urlPath('https://dan4ik37.vercel.app:443/js/x.js', HOST) === '/js/x.js', 'urlPath: порт не мешает');
    ok(K.urlPath('https://dan4ik37.vercel.app/' + 'a'.repeat(300) + '.js', HOST).length <= 100, 'urlPath: не длиннее 100');
    ok(K.urlPath('https://dan4ik37.vercel.app/js/ж ю.js', HOST) === '/js/.js', 'urlPath: лишние знаки убраны');

    // очистка сообщения
    const C = s => K.clean(s, HOST);
    ok(C("Cannot read properties of undefined (reading 'length')") === "Cannot read properties of undefined (reading 'length')", 'clean: имя свойства остаётся');
    ok(C("Cannot read properties of undefined (reading 'dan4ik37')") === "Cannot read properties of undefined (reading '…')", 'clean: имя похоже на ник (3 цифры) — вырезано');
    ok(C("Cannot read properties of null (reading 'x1')") === "Cannot read properties of null (reading 'x1')", 'clean: короткое имя с цифрой остаётся');
    ok(C('x is not a function') === 'x is not a function' && C('foo.bar.baz is not a function') === 'foo.bar.baz is not a function', 'clean: обычные сообщения как есть');
    ok(C('Unexpected token \'a\', "abc" is not valid JSON') === 'Unexpected token \'a\', "…" is not valid JSON', 'clean: JSON — кусок ввода вырезан', C('Unexpected token \'a\', "abc" is not valid JSON'));
    ok(C('Unexpected token \'<\', "<!DOCTYPE html>..." is not valid JSON') === 'Unexpected token \'<\', "…" is not valid JSON', 'clean: JSON — HTML вместо ответа');
    ok(C('JSON Parse error: Unexpected identifier "vasya"') === 'JSON Parse error: Unexpected identifier "…"', 'clean: JSON (Safari) — вырезано');
    ok(C('Failed to fetch dynamically imported module: https://dan4ik37.vercel.app/js/x.js?v=115#a') === 'Failed to fetch dynamically imported module: /js/x.js', 'clean: свой адрес — путь без запроса');
    ok(C('GET https://abcdefghijklmno.supabase.co/rest/v1/profiles?id=eq.5&apikey=SECRET failed') === 'GET <url> failed', 'clean: чужой адрес — <url>', C('GET https://abcdefghijklmno.supabase.co/rest/v1/profiles?id=eq.5&apikey=SECRET failed'));
    ok(C('Invalid login for vasya.pupkin@mail.ru') === 'Invalid login for <email>', 'clean: почта');
    ok(C('Bad token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij!') === 'Bad token <jwt>!', 'clean: JWT', C('Bad token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij!'));
    ok(C('No profile 123e4567-e89b-12d3-a456-426614174000') === 'No profile <uuid>', 'clean: uuid');
    ok(C('key sbp_0123456789abcdef0123456789abcdef used') === 'key <tok> used', 'clean: длинный ключ с буквами и цифрами');
    ok(C('call +7 (999) 123-45-67 now') === 'call <n> now', 'clean: телефон', C('call +7 (999) 123-45-67 now'));
    ok(C('connect 192.168.0.12 refused') === 'connect <n> refused', 'clean: IP-адрес');
    ok(C('user 1234567890 not found') === 'user <n> not found' && C('line 12345') === 'line <n>' && !/2026|10-22/.test(C('at 2026-10-22 10:15 ok')), 'clean: длинные числа и даты');
    ok(C('Не удалось загрузить \'Привет мир\'') === "Не удалось загрузить '…'", 'clean: чужой текст в кавычках вырезан');
    ok(C('Не загрузилось: js/games/kubomir.js') === 'Не загрузилось: js/games/kubomir.js', 'clean: свои сообщения и пути без кавычек — как есть');
    ok(C('a\u0000b\nc\td') === 'a b c d', 'clean: управляющие знаки и пробелы');
    ok(C('x'.repeat(1000)).length <= 180 && C('x'.repeat(1000)).endsWith('…'), 'clean: не длиннее 180');
    ok(C('Refused data:text/html;base64,AAAA ok') === 'Refused <url> ok' && C('Invalid data: foo') === 'Invalid data: foo', 'clean: data: адрес — <url>, слово «data:» — нет');
    ok(C("Failed to execute 'insertBefore' on 'Node'") === "Failed to execute 'insertBefore' on 'Node'", 'clean: имена методов остаются');
    ok(C('Failed to parse URL from javascript:alert(document.cookie)') === 'Failed to parse URL from', 'clean: Failed to parse URL from … — остаток вон');
    ok(C(null) === '' && C(undefined) === '' && C(12) === '12' && C({ toString() { return 'obj'; } }) === 'obj', 'clean: не-строки');
    ok(C('see /js/features/some-very-long-module-name-for-testing-2.js now').includes('/js/features/'), 'clean: путь с дефисами не принимается за ключ', C('see /js/features/some-very-long-module-name-for-testing-2.js now'));
    ok(!/undefined|NaN|\[object/.test(C('Error: ' + 'ab12'.repeat(20))), 'clean: без undefined / NaN');
    ok(C('Привет `мир` и "вася" готово') === 'Привет `…` и "…" готово', 'clean: обратные и двойные кавычки');

    // стек
    const chromeStack = `Error: boom
    at Object.tick (https://dan4ik37.vercel.app/js/games/kubomir.js?v=115:120:5)
    at async run (https://dan4ik37.vercel.app/js/games/kubomir.js?v=115:200:7)
    at https://dan4ik37.vercel.app/js/core/utils.js:3:4
    at foo (https://pagead2.googlesyndication.com/x.js:1:2)
    at bar (chrome-extension://abc/inject.js:1:1)
    at baz (https://dan4ik37.vercel.app/js/a.js:9:9)
    at qux (https://dan4ik37.vercel.app/js/b.js:9:9)
    at last (https://dan4ik37.vercel.app/js/c.js:9:9)`;
    let st = K.stack(chromeStack, HOST);
    ok(st.f === '/js/games/kubomir.js' && st.l === 120 && st.c === 5, 'stack: верхний свой кадр — файл, строка, столбец', st);
    ok(st.s.split('\n').length === 4 && st.s.startsWith('Object.tick /js/games/kubomir.js:120:5\nrun /js/games/kubomir.js:200:7\n/js/core/utils.js:3:4\nbaz /js/a.js:9:9'), 'stack: 4 кадра, имена, без чужих и расширений', st.s);
    ok(!/vercel|\?v=|googlesyndication|extension/.test(st.s), 'stack: без домена, запроса и чужого');
    st = K.stack('tick@https://dan4ik37.vercel.app/js/games/kubomir.js:120:5\n@https://dan4ik37.vercel.app/js/x.js:1:1\nglobal code@https://dan4ik37.vercel.app/js/z.js:2:2', HOST);
    ok(st.s === 'tick /js/games/kubomir.js:120:5\n/js/x.js:1:1\nglobal code /js/z.js:2:2' && st.f === '/js/games/kubomir.js', 'stack: формат Firefox/Safari (имя@адрес)', st.s);
    ok(K.stack('', HOST).s === '' && K.stack(null, HOST).f === '' && K.stack({ a: 1 }, HOST).l === 0 && K.stack('Error: x\n   at <anonymous>', HOST).s === '', 'stack: пусто / не строка / без адресов');

    // раздел
    ok(K.route('/', '') === 'home' && K.route('/chat', '') === 'chat' && K.route('/chat/join/abc123', '') === 'chat' && K.route('/forum/42', '') === 'forum', 'route: разделы');
    ok(K.route('/play/kubomir/abcd', '') === 'play/kubomir' && K.route('/play/Chess', '') === 'play/chess' && K.route('/play', '') === 'play', 'route: /play/<игра> — с игрой, комната отброшена');
    ok(K.route('/profile/123e4567-e89b-12d3-a456-426614174000', '') === 'profile', 'route: id отброшен');
    ok(K.route('/123e4567-e89b-12d3-a456-426614174000', '') === 'other' && K.route('/%D0%B6', '') === 'other' && K.route('/' + 'a'.repeat(40), '') === 'other', 'route: первый кусок как id / длинный / не латиница — other');
    ok(K.route('/', '#/games/chess') === 'games/chess' && K.route('/', '#/chat') === 'chat' && K.route('/', '#access_token=abc') === 'home', 'route: режим #/ и токены в # не попадают');
    ok(K.route('/play/qwe rty', '') === 'play' && K.route('/play/' + 'z'.repeat(40), '') === 'play', 'route: странный второй кусок отброшен');

    // браузер / система / устройство
    const U = (k, t) => K.ua(UA[k], t || 0);
    ok(U('chrome').b === 'chrome/129' && U('chrome').o === 'windows' && U('chrome').d === 'd', 'ua: Chrome на Windows — компьютер');
    ok(U('android').b === 'chrome/129' && U('android').o === 'android' && U('android').d === 'm', 'ua: Chrome на Android — телефон');
    ok(U('atablet').d === 't' && U('atablet').o === 'android', 'ua: Android без Mobile — планшет');
    ok(U('iphone').b === 'safari/17' && U('iphone').o === 'ios' && U('iphone').d === 'm', 'ua: iPhone Safari');
    ok(U('mac', 5).o === 'ios' && U('mac', 5).d === 't', 'ua: iPad в режиме «сайт для компьютера» (Macintosh + касания) — iOS, планшет');
    ok(U('mac').o === 'mac' && U('mac').b === 'safari/17' && U('mac').d === 'd', 'ua: Safari на Mac');
    ok(U('firefox').b === 'firefox/131' && U('edge').b === 'edge/129' && U('opera').b === 'opera/114' && U('yandex').b === 'yandex/24' && U('samsung').b === 'samsung/25', 'ua: Firefox, Edge, Opera, Яндекс, Samsung — не «chrome»');
    ok(U('fxios').b === 'firefox/131' && U('fxios').o === 'ios', 'ua: Firefox на iOS');
    ok(U('linux').o === 'linux' && U('bot').b === 'other' && U('bot').o === 'other' && K.ua(undefined, 0).b === 'other' && K.ua(null, 0).d === 'd', 'ua: Linux, curl, пусто');

    // шум
    const NZ = (m, f) => K.noise(m, f || '', HOST);
    ok(NZ('Script error.') && NZ('Uncaught Error: Script error.') && !NZ('Script error.', 'https://dan4ik37.vercel.app/js/a.js'), 'noise: «Script error.» без файла — шум, с нашим файлом — нет');
    ok(NZ('x', 'chrome-extension://abc/x.js') && NZ('x', 'moz-extension://abc/x.js') && NZ('x', 'safari-web-extension://a/b.js') && NZ('x', 'blob:https://a/b'), 'noise: расширения и blob');
    ok(NZ('x', 'https://pagead2.googlesyndication.com/a.js') && NZ('x', 'https://mc.yandex.ru/metrika/tag.js') && !NZ('x', 'https://dan4ik37.vercel.app/js/a.js') && !NZ('x', 'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.module.js'), 'noise: чужой сайт — шум; свой и jsDelivr — нет');
    ok(NZ('ResizeObserver loop completed with undelivered notifications.') && NZ('ResizeObserver loop limit exceeded'), 'noise: ResizeObserver');
    ok(NZ('TypeError: Failed to fetch') && NZ('Load failed') && NZ('TypeError: NetworkError when attempting to fetch resource.') && NZ('AbortError: signal is aborted without reason') && NZ('The user aborted a request.'), 'noise: сеть пропала / отмена');
    ok(!NZ('Failed to fetch dynamically imported module: /js/x.js') && !NZ('TypeError: x is not a function'), 'noise: «Failed to fetch dynamically imported module» — НЕ шум');
    ok(NZ("NotAllowedError: play() failed because the user didn't interact with the document first.") && NZ('The play() request was interrupted by a call to pause()'), 'noise: автозапуск звука');
    ok(NZ('Can\'t find variable: _AutofillCallbackHandler') && NZ('Java object is gone') && NZ('Cannot redefine property: ethereum'), 'noise: известный шум расширений и WebView');
    ok(!NZ('Cannot read properties of undefined (reading "x")') && !NZ(''), 'noise: обычные ошибки не шум');
    ok(K.short(new Error('x')) === 'Error' && K.short({}) === 'Object' && K.short(null) === 'object' && K.short(Object.create(null)) === 'object', 'short: имя типа');
    ok(K.site('dan4ik37.vercel.app') && !K.site('localhost') && !K.site('dan4ik37.github.io') && !K.site('dan4ik37-git-x-dan4ik37.vercel.app') && !K.site('evil-dan4ik37.vercel.app.example.com') && !K.site('') && !K.site(null), 'site: только настоящий адрес');

    // ═══ 2. Песочница браузера ═══
    // window / document / navigator / fetch / таймеры / часы — свои; код этапов запускается как обычный скрипт
    function mkEnv(o = {}) {
      const E = { sent: [], beacons: [], timers: [], appended: [], listeners: [], docListeners: [], store: o.store || new Map(), now: o.now || Date.parse('2026-10-22T12:00:00Z'), rand: o.rand === undefined ? 0 : o.rand, log: [] };
      let tid = 0;
      const sb = {};
      sb.window = sb;
      sb.location = Object.assign({ protocol: 'https:', hostname: HOST, host: HOST, pathname: '/play/kubomir/abcd', hash: '', search: '' }, o.loc || {});
      sb.navigator = Object.assign({ userAgent: UA.chrome, maxTouchPoints: 0, onLine: true }, o.nav || {});
      sb.navigator.sendBeacon = (url, blob) => { if (o.beaconThrows) throw new Error('beacon boom'); E.beacons.push({ url, body: blob.parts.join(''), type: blob.type }); return !o.beaconFalse; };
      sb.document = { head: { appendChild: el => { E.appended.push(el); return el; } }, documentElement: {}, createElement: tag => ({ tagName: String(tag).toUpperCase() }), visibilityState: 'visible', addEventListener: (t, f) => E.docListeners.push({ t, f }) };
      sb.addEventListener = (t, f, c) => E.listeners.push({ t, f, cap: !!c });
      sb.removeEventListener = (t, f) => { const i = E.listeners.findIndex(l => l.t === t && l.f === f); if (i >= 0) E.listeners.splice(i, 1); };
      sb.localStorage = o.localStorage || { getItem: k => (E.store.has(k) ? E.store.get(k) : null), setItem: (k, v) => E.store.set(k, String(v)), removeItem: k => E.store.delete(k) };
      sb.setTimeout = (fn, ms) => { const id = ++tid; E.timers.push({ id, at: E.now + (ms | 0), fn }); return id; };
      sb.clearTimeout = id => { E.timers = E.timers.filter(t => t.id !== id); };
      sb.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [E.now])); } static now() { return E.now; } };
      sb.Math = Object.assign(Object.create(Math), { random: () => E.rand });
      sb.Blob = class { constructor(parts, opts) { this.parts = parts; this.type = (opts || {}).type; } };
      sb.fetch = (url, init) => {
        if (o.fetchThrows) throw new Error('fetch sync boom');
        if (o.onFetch) o.onFetch(E);
        E.sent.push({ url, init, body: init && init.body });
        if (o.fetchRejects) return Promise.reject(new Error('Failed to fetch'));
        const reply = typeof o.reply === 'function' ? o.reply(E.sent.length) : (o.reply === undefined ? { ok: 1 } : o.reply);
        return Promise.resolve({ ok: true, status: 200, json: () => (o.badJson ? Promise.reject(new SyntaxError('bad json')) : Promise.resolve(reply)) });
      };
      if (o.GAMES_VER !== undefined) sb.GAMES_VER = o.GAMES_VER;
      const ctx = vm.createContext(sb);
      Object.assign(E, {
        sb, ctx,
        stage1: () => vm.runInContext(M.ERR_JS, ctx),
        stage2: () => vm.runInContext(M.ERR_FILE, ctx),
        on: t => E.listeners.filter(l => l.t === t),
        fire(type, ev) { for (const l of E.listeners.filter(x => x.t === type)) l.f(ev); },
        error(ev) { E.fire('error', Object.assign({ target: sb }, ev)); },
        res(tag, url) { E.fire('error', { target: { nodeType: 1, tagName: tag, src: url, href: url } }); },
        rej(reason) { E.fire('unhandledrejection', { reason }); },
        async advance(ms) {
          const end = E.now + ms;
          for (;;) {
            const due = E.timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
            if (!due) break;
            E.timers = E.timers.filter(t => t !== due);
            E.now = Math.max(E.now, due.at);
            due.fn();
            await tick();
          }
          E.now = end; await tick();
        },
        scripts: () => E.appended.filter(e => e.tagName === 'SCRIPT'),
        bodies: () => E.sent.map(s => JSON.parse(s.body)).concat(E.beacons.map(b => JSON.parse(b.body))),
        lsd: () => JSON.parse(E.store.get('d37_el') || 'null'),
      });
      return E;
    }
    const stackOf = (name, frames) => `${name}\n` + frames.map(f => `    at ${f}`).join('\n');
    const OWN = p => 'https://' + HOST + p;
    const mkErr = (msg, frames) => { const e = new Error(msg); e.stack = stackOf('Error: ' + msg, frames || [`tick (${OWN('/js/games/kubomir.js?v=115')}:120:5)`]); return e; };
    const evOf = (msg, file, line, col, err) => ({ message: msg, filename: file, lineno: line, colno: col, error: err });
    // полный путь одной ошибки: этап 1 → 0,3 с → этап 2 → 4 с → отправка
    async function full(env, ev, wait = 4400) { env.error(ev); await env.advance(300); env.stage2(); await env.advance(wait); }

    // ═══ 3. Этап 1 ═══
    {
      for (const [name, loc] of [['localhost', { hostname: 'localhost', host: 'localhost:5500' }], ['127.0.0.1', { hostname: '127.0.0.1', host: '127.0.0.1' }], ['file:', { protocol: 'file:', hostname: '' }],
        ['github.io', { hostname: 'dan4ik37.github.io', host: 'dan4ik37.github.io' }], ['предпросмотр Vercel', { hostname: 'dan4ik37-git-x-team.vercel.app', host: 'dan4ik37-git-x-team.vercel.app' }], ['чужой', { hostname: 'evil.example', host: 'evil.example' }]]) {
        const e = mkEnv({ loc }); e.stage1();
        ok(e.listeners.length === 0 && !e.sb.__d37el && !e.sb.d37Err, `этап 1: на «${name}» не ставится`);
      }
      const t0 = process.hrtime.bigint();
      let env = mkEnv(); env.stage1();
      const dt = Number(process.hrtime.bigint() - t0) / 1e6;
      ok(env.listeners.length === 2 && env.on('error')[0].cap === true && env.on('unhandledrejection').length === 1, 'этап 1: два слушателя (error в фазе захвата, unhandledrejection)');
      ok(env.timers.length === 0 && env.sent.length === 0 && env.beacons.length === 0 && env.appended.length === 0 && env.docListeners.length === 0, 'этап 1: без ошибок — ни таймеров, ни сети, ни файлов, ни слушателей pagehide/visibility');
      ok(env.sb.__d37el && env.sb.__d37el.v === 1 && Array.isArray(env.sb.__d37el.q) && typeof env.sb.d37Err === 'function', 'этап 1: window.__d37el и d37Err на месте');
      env.stage1();
      ok(env.listeners.length === 2, 'этап 1: второй запуск ничего не добавляет');
      env.error(evOf('boom', OWN('/js/a.js?v=1'), 10, 2, mkErr('boom')));
      ok(env.sb.__d37el.q.length === 1 && env.timers.length === 1 && env.timers[0].at === env.now + 300, 'этап 1: ошибка — запись в очередь и таймер на 0,3 с');
      const r0 = env.sb.__d37el.q[0];
      ok(r0.t === 'e' && r0.m === 'boom' && r0.f.includes('/js/a.js') && r0.l === 10 && r0.p === '/play/kubomir/abcd' && r0.n === 1, 'этап 1: запись {t, m, f, l, p, n}', { t: r0.t, m: r0.m, f: r0.f, l: r0.l, p: r0.p, n: r0.n });
      for (let i = 0; i < 100; i++) env.error(evOf('boom', OWN('/js/a.js?v=1'), 10, 2, null));
      ok(env.sb.__d37el.q.length === 1 && r0.n === 101 && env.timers.length === 1, 'этап 1: одинаковые ошибки считаются, а не копятся');
      for (let i = 0; i < 100; i++) env.error(evOf('other ' + i, OWN('/js/a.js'), i, 0, null));
      ok(env.sb.__d37el.q.length === 30, 'этап 1: очередь не больше 30 разных');
      await env.advance(300);
      const sc = env.scripts();
      ok(sc.length === 1 && sc[0].src === '/js/core/errlog.js?v=' + M.ERR_VER && sc[0].async === true, 'этап 1: через 0,3 с подгружает js/core/errlog.js?v=<хеш файла> один раз', sc);
      await env.advance(5000);
      ok(env.scripts().length === 1, 'этап 1: повторно файл не просит');
      ok(env.sent.length === 0, 'этап 1: сам ничего не шлёт');
      console.log(`  · этап 1: установка ${dt.toFixed(3)} мс (в узле, холодный запуск), 1 КБ gzip ≈ ${zlibSize(M.ERR_JS)} Б`);

      // злые события: ничего не бросает
      env = mkEnv(); env.stage1();
      const evil = { get message() { throw new Error('g1'); }, get filename() { throw new Error('g2'); }, get target() { throw new Error('g3'); } };
      let threw = null;
      try { env.fire('error', evil); env.fire('error', null); env.fire('error', undefined); env.fire('error', {}); env.fire('error', { target: { get nodeType() { throw new Error('x'); } } }); env.fire('unhandledrejection', null); env.fire('unhandledrejection', { get reason() { throw new Error('r'); } });
        env.rej(new Proxy({}, { get() { throw new Error('proxy'); }, has() { throw new Error('proxy'); } })); env.sb.d37Err(null, null); env.sb.d37Err({ toString() { throw new Error('ts'); } }, { get message() { throw new Error('m'); } }); } catch (e) { threw = e; }
      ok(!threw, 'этап 1: злые события (геттеры бросают, null, Proxy) — не бросает', threw && threw.message);
      env.error(evOf(Symbol('s'), OWN('/js/a.js'), 1, 1, null));
      ok(true, 'этап 1: Symbol в message — не бросает');

      // сорвалась в цикл: 60 тысяч событий
      env = mkEnv(); env.stage1();
      for (let i = 0; i < 60000; i++) env.error(evOf('loop', OWN('/js/loop.js'), 1, 1, null));
      ok(env.on('error').length === 0 && env.on('unhandledrejection').length === 0, 'этап 1: после 50 000 событий слушатели сняты');

      // ресурсы и промисы до загрузки этапа 2
      env = mkEnv(); env.stage1();
      env.res('SCRIPT', OWN('/js/games/foo.js?v=1')); env.res('IMG', OWN('/img/a.png')); env.res('LINK', OWN('/css/a.css')); env.res('VIDEO', OWN('/v.mp4'));
      env.rej(new Error('rej1')); env.rej('строка'); env.rej(null);
      ok(env.sb.__d37el.q.map(r => r.t).join('') === 'rrppp', 'этап 1: script и link — запись, img и video — нет; три промиса — записи', env.sb.__d37el.q.map(r => r.t));
    }
    function zlibSize(s) { return require('zlib').gzipSync(s).length; }

    // ═══ 4. Полный путь: этап 1 → этап 2 → отправка ═══
    {
      const env = mkEnv({ GAMES_VER: '115' });
      env.stage1();
      const err = mkErr("Cannot read properties of undefined (reading 'length')", [`tick (${OWN('/js/games/kubomir.js?v=115')}:120:5)`, `loop (${OWN('/js/games/kubomir.js?v=115')}:200:7)`]);
      await full(env, evOf(err.message, OWN('/js/games/kubomir.js?v=115'), 120, 5, err));
      ok(env.sent.length === 1 && env.beacons.length === 0, 'путь: одна отправка через fetch');
      const s0 = env.sent[0];
      ok(s0.url === '/api/diag' && s0.init.method === 'POST' && s0.init.keepalive === true && s0.init.credentials === 'omit' && /text\/plain/.test(s0.init.headers['Content-Type']), 'путь: POST /api/diag, keepalive, без cookie, text/plain (без preflight)');
      const b = JSON.parse(s0.body);
      ok(b.v === '115' && b.b === 'chrome/129' && b.o === 'windows' && b.d === 'd' && b.x === 0 && Array.isArray(b.e) && b.e.length === 1, 'путь: версия, браузер, система, устройство, выброшено 0, одна ошибка', b);
      const it = b.e[0];
      ok(it.t === 'e' && it.m === "Cannot read properties of undefined (reading 'length')" && it.f === '/js/games/kubomir.js' && it.l === 120 && it.c === 5 && it.r === 'play/kubomir' && it.n === 1, 'путь: запись — тип, сообщение, файл, строка, раздел, n', it);
      ok(it.s === 'tick /js/games/kubomir.js:120:5\nloop /js/games/kubomir.js:200:7', 'путь: стек — имя путь:строка:столбец', it.s);
      ok(JSON.stringify(Object.keys(b).sort()) === '["b","d","e","o","v","x"]' && JSON.stringify(Object.keys(it).sort()) === '["c","f","l","m","n","r","s","t"]', 'путь: в пачке только известные поля');
      ok(env.on('error').length === 1 && env.docListeners.length === 1 && env.listeners.some(l => l.t === 'pagehide'), 'путь: слушатели pagehide и visibilitychange появились после первой ошибки');
      ok(env.lsd().n === 1 && env.lsd().s === 1 && env.lsd().d === '2026-10-22', 'путь: в localStorage d37_el — счётчики дня', env.lsd());
      // повторы: дельта не раньше, чем через 30 с после прошлой
      for (let i = 0; i < 1000; i++) env.error(evOf(err.message, OWN('/js/games/kubomir.js?v=115'), 120, 5, err));
      await env.advance(10000);
      ok(env.sent.length === 1, 'повторы: ещё одна отправка не раньше, чем через 30 с');
      await env.advance(30000);
      ok(env.sent.length === 2, 'повторы: через 30 с — вторая отправка');
      const b2 = JSON.parse(env.sent[1].body);
      ok(b2.e.length === 1 && b2.e[0].n === 1000 && b2.e[0].s === '', 'повторы: n = 1000 (дельта), стек второй раз не шлётся', b2.e[0]);
      for (let i = 0; i < 5; i++) { env.error(evOf(err.message, OWN('/js/games/kubomir.js?v=115'), 120, 5, err)); await env.advance(31000); }
      ok(env.sent.length === 4, 'визит: не больше 4 отправок', env.sent.length);
      ok(env.lsd().s === 4, 'визит: в localStorage 4 отправки за сутки');
    }

    // слияние сообщений, отличающихся числами и текстом в кавычках; выбор разных
    {
      const env = mkEnv(); env.stage1();
      for (let i = 0; i < 20; i++) env.error(evOf(`Failed at tick ${1000000 + i} for 'вася ${i}' with ${i}${i}${i}${i}${i}${i}`, OWN('/js/games/a.js'), 7, 1, null));
      await env.advance(300); env.stage2(); await env.advance(4400);
      const b = env.bodies()[0];
      ok(b.e.length === 1 && b.e[0].n === 20 && b.e[0].m === "Failed at tick <n> for '…' with <n>", 'дедуп: 20 ошибок, отличающихся числом и текстом в кавычках, — одна запись n = 20', b.e);
    }
    {
      const env = mkEnv(); env.stage1();
      for (let i = 0; i < 12; i++) env.error(evOf('distinct error number ' + String.fromCharCode(97 + i), OWN('/js/games/d.js'), i, 1, null));
      await env.advance(300); env.stage2(); await env.advance(4400);
      const b = env.bodies()[0];
      ok(b.e.length === 8 && b.x === 4, 'выбор: 12 разных за визит — в пачке 8, ещё 4 посчитаны как отброшенные (x)', { n: b.e.length, x: b.x });
      env.error(evOf('another distinct one', OWN('/js/games/d.js'), 99, 1, null));
      await env.advance(31000);
      ok(env.sent.length === 1, 'выбор: девятая разная уже не отправляется');
    }

    // нет GAMES_VER (серверные страницы) — версия пустая; браузеры и устройства
    {
      const env = mkEnv({ nav: { userAgent: UA.iphone } }); env.stage1();
      await full(env, evOf('e1', OWN('/js/a.js'), 1, 1, null));
      const b = env.bodies()[0];
      ok(b.v === '' && b.b === 'safari/17' && b.o === 'ios' && b.d === 'm', 'метка: без GAMES_VER — пусто; iPhone Safari', b);
      const env2 = mkEnv({ GAMES_VER: 'x'.repeat(40) }); env2.stage1();
      await full(env2, evOf('e1', OWN('/js/a.js'), 1, 1, null));
      ok(env2.bodies()[0].v.length === 12, 'метка: длинная версия режется до 12');
    }

    // шум: реклама, Метрика, расширения, «Script error.» и ResizeObserver этап 1 отсеивает сам (у людей с блокировщиками реклама «не грузится»
    // на КАЖДОЙ странице — этап 2 из-за этого качать нельзя); сеть пропала / отмена — отсеивает этап 2
    {
      const env = mkEnv(); env.stage1();
      env.error(evOf('Script error.', '', 0, 0, null));
      env.error(evOf('Uncaught Error: Script error.', '', 0, 0, null));
      env.error(evOf('ResizeObserver loop completed with undelivered notifications.', '', 0, 0, null));
      env.error(evOf('ResizeObserver loop limit exceeded', OWN('/js/a.js'), 1, 1, null));
      env.error(evOf('boom', 'chrome-extension://abc/inject.js', 1, 1, null));
      env.error(evOf('boom', 'moz-extension://abc/inject.js', 1, 1, null));
      env.error(evOf('boom', 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 5, 5, null));
      env.error(evOf('boom', 'https://dan4ik37.vercel.app.evil.example/js/a.js', 5, 5, null));
      env.res('SCRIPT', 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'); env.res('SCRIPT', 'https://mc.yandex.ru/metrika/tag.js');
      env.res('LINK', 'https://fonts.googleapis.com/css2?family=Montserrat'); env.res('SCRIPT', 'chrome-extension://abc/x.js');
      ok(env.sb.__d37el.q.length === 0 && env.timers.length === 0, 'этап 1: реклама, Метрика, шрифты Google, расширения, «Script error.», ResizeObserver — записей нет, таймера нет');
      await env.advance(10000);
      ok(env.scripts().length === 0 && env.sent.length === 0, 'шум: этап 2 не качается, ничего не уходит');
      env.error(evOf('real', '', 1, 1, null));
      ok(env.sb.__d37el.q.length === 1, 'этап 1: ошибка без файла (eval, onclick) — запись');
      env.error(evOf('real', '/js/a.js', 1, 1, null)); env.error(evOf('real2', OWN('/js/b.js'), 1, 1, null));
      env.error(evOf('real3', 'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.module.js', 1, 1, null)); env.res('SCRIPT', 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js');
      ok(env.sb.__d37el.q.length === 5, 'этап 1: свой файл, относительный путь, jsDelivr (и ошибка, и не загрузился) — записи');
    }
    {
      const env = mkEnv(); env.stage1();
      env.rej(new TypeError('Failed to fetch')); env.rej(typeof DOMException === 'function' ? new DOMException('x', 'AbortError') : new Error('AbortError: x'));
      env.rej(new Error('The user aborted a request.')); env.rej(new Error('NetworkError when attempting to fetch resource.'));
      await env.advance(300); env.stage2(); await env.advance(10000);
      ok(env.sent.length === 0 && env.beacons.length === 0, 'шум: «Failed to fetch», отмена запроса, сеть пропала — этап 2 отсеивает, ничего не уходит');
      ok(env.lsd() === null || env.lsd().n === 0, 'шум: счётчик дня не тронут');
    }

    // ресурсы: свой скрипт, стиль, jsDelivr
    {
      const env = mkEnv(); env.stage1();
      env.res('SCRIPT', OWN('/js/games/foo.js?v=115&t=secret')); env.res('LINK', OWN('/css/premium.css?v=1'));
      env.res('SCRIPT', 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js'); env.res('IMG', OWN('/img/a.png'));
      await env.advance(300); env.stage2(); await env.advance(4400);
      const b = env.bodies()[0];
      ok(b.e.length === 3 && b.e.every(x => x.t === 'r' && x.m.startsWith('load failed: ')), 'ресурсы: script, link и jsDelivr — записи типа r', b.e);
      ok(b.e[0].f === '/js/games/foo.js' && b.e[1].f === '/css/premium.css' && b.e[2].f.startsWith('cdn:/npm/@supabase/supabase-js@2.117.2/'), 'ресурсы: путь без запроса (?v=, токены вон)', b.e.map(x => x.f));
      ok(!/secret|v=115/.test(JSON.stringify(b)), 'ресурсы: запрос не попал в пачку');
      const off = mkEnv({ nav: { onLine: false } }); off.stage1();
      off.res('SCRIPT', OWN('/js/a.js')); await off.advance(300); off.stage2(); await off.advance(5000);
      ok(off.sent.length === 0, 'ресурсы: без сети (navigator.onLine = false) — не отправляем');
    }

    // необработанные обещания: виды причин
    {
      const env = mkEnv(); env.stage1();
      env.rej(Object.assign(new TypeError('x is not a function'), { stack: stackOf('TypeError: x is not a function', [`go (${OWN('/js/features/chat.js?v=1')}:77:9)`]) }));
      env.rej('Ник уже занят: Вася_Пупкин');
      env.rej({ code: 5 }); env.rej(undefined); env.rej(42);
      env.rej(Object.assign(new Error('Тайм-аут запроса'), { name: 'TimeoutError' }));
      await env.advance(300); env.stage2(); await env.advance(4400);
      const e = env.bodies()[0].e, by = m => e.find(x => x.m === m);
      const te = by('TypeError: x is not a function');
      ok(te && te.f === '/js/features/chat.js' && te.l === 77 && te.c === 9 && te.t === 'p' && te.s === 'go /js/features/chat.js:77:9', 'обещания: Error → «Имя: сообщение», файл и строка из стека, тип p', e);
      ok(by('[Object]') && by('undefined') && by('42') && by('TimeoutError: Тайм-аут запроса'), 'обещания: объект → [Object], undefined, число, имя ошибки + текст', e.map(x => x.m));
      ok(by('Ник уже занят: Вася_Пупкин'), 'обещания: строка — как есть (личное в текст ошибок не класть: CLAUDE.md «Мониторинг»)', e.map(x => x.m));
    }

    // обещания из чужих скриптов (реклама, расширения) — не наши; без стека — наши; свои кадры — наши
    {
      const env = mkEnv(); env.stage1();
      const mk = (msg, stack) => { const e = new Error(msg); e.stack = stack; return e; };
      env.rej(mk('TagError: adsbygoogle.push() error: No slot size', 'Error: x\n    at push (https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js:1:2)\n    at https://pagead2.googlesyndication.com/pagead/x.js:3:4'));
      env.rej(mk('extension boom', 'Error: x\n    at f (chrome-extension://abc/inject.js:1:1)'));
      env.rej(mk('own failure', stackOf('Error: own failure', [`go (${OWN('/js/features/chat.js?v=1')}:5:6)`, 'x (https://pagead2.googlesyndication.com/a.js:1:1)'])));
      env.rej(mk('no frames at all', 'Error: no frames at all'));
      await env.advance(300); env.stage2(); await env.advance(4400);
      const e = env.bodies()[0].e;
      ok(e.length === 2 && e.some(x => x.m === 'own failure' && x.f === '/js/features/chat.js') && e.some(x => x.m === 'no frames at all'), 'обещания: со стеком только из чужих кадров (реклама, расширение) — отсеяны; со своим кадром и без стека — остались', e.map(x => x.m));
    }
    // шум помним, но не бесконечно: тысяча РАЗНЫХ шумных сообщений — в памяти не больше 200 пометок
    {
      const env = mkEnv(); env.stage1();
      await env.advance(1); env.error(evOf('real', OWN('/js/a.js'), 1, 1, null)); await env.advance(300); env.stage2();
      for (let i = 0; i < 1000; i++) env.sb.__d37el.on({ t: 'p', rr: { message: 'AbortError: aborted ' + i, name: 'Error' }, p: '/', h: '' });
      const s = env.sb.__d37el.stat();
      ok(s.noise === 1000 && s.seen <= 202 && s.keys === 1, 'шум: 1000 разных сообщений — пометок в памяти не больше 200 (stat.seen)', s);
      await env.advance(4400);
      ok(env.sent.length === 1 && env.bodies()[0].e.length === 1, 'шум: из тысячи шумных ничего не ушло, настоящая ошибка — одна');
    }

    // d37Err
    {
      const env = mkEnv(); env.stage1();
      env.sb.d37Err('gfx.fallback', new Error('shader failed')); env.sb.d37Err('просто так');
      await env.advance(300); env.stage2(); await env.advance(4400);
      const e = env.bodies()[0].e;
      ok(e.length === 2 && e[0].t === 'x' && e[0].m === 'gfx.fallback: shader failed' && e[1].m === 'просто так', 'd37Err: ручное сообщение — тип x, «где: что»', e);
      env.sb.d37Err('после загрузки', new Error('later'));
      await env.advance(31000);
      ok(env.sent.length === 2 && JSON.parse(env.sent[1].body).e[0].m === 'после загрузки: later', 'd37Err: после загрузки этапа 2 идёт напрямую');
    }

    // нет личных данных в пачке
    {
      const env = mkEnv({ loc: { pathname: '/profile/123e4567-e89b-12d3-a456-426614174000', hash: '#access_token=SECRETTOKEN' } }); env.stage1();
      // что искать в пачке: почта, токен из адреса и #, uuid, телефон, JWT, ключ, номер карты, секрет в запросе, ник
      const bad = ['vasya.pupkin@mail.ru', 'SECRETTOKEN', '123e4567-e89b-12d3-a456-426614174000', '+7 999 123-45-67', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij', 'Вася_Пупкин', 'sbp_0123456789abcdef0123456789abcdef', '4111 1111 1111 1111', 'hunter2'];
      const url = OWN('/js/a.js?apikey=' + bad[8] + '&token=' + bad[1] + '#access_token=' + bad[1]);
      env.error(evOf(`Bad login ${bad[0]} id ${bad[2]} tel ${bad[3]} jwt ${bad[4]} key ${bad[6]} card ${bad[7]} GET ${url} POST https://abc.supabase.co/rest/v1/p?apikey=${bad[8]}&u=${bad[0]}`, url, 1, 1, mkErr('x', [`f (${url}:1:1)`])));
      env.error(evOf(`JSON.parse failed: Unexpected token 'ы', "${bad[5]}" is not valid JSON`, OWN('/js/b.js'), 2, 1, null));
      env.error(evOf(`Cannot read properties of undefined (reading '${bad[5]}')`, OWN('/js/b.js'), 3, 1, null));
      env.res('SCRIPT', OWN('/js/c.js?token=' + bad[1]));
      await env.advance(300); env.stage2(); await env.advance(4400);
      const body = env.sent.map(s => s.body).join('');
      ok(env.sent.length === 1 && bad.every(x => !body.includes(x)), 'личное: почта, токены (в адресе, #, запросе), uuid, телефон, JWT, ключ, карта, ник в кавычках — в пачку не попали', bad.filter(x => body.includes(x)));
      ok(JSON.parse(body).e.length === 4 && JSON.parse(body).e.every(x => x.r === 'profile'), 'личное: четыре записи, раздел — profile (id и токен в адресе отброшены)');
    }

    // ═══ 5. Лимиты, ответы сервера, выбор ═══
    {
      // сутки: 40 ошибок или 8 отправок с браузера
      const today = '2026-10-22';
      let env = mkEnv({ store: new Map([['d37_el', JSON.stringify({ d: today, n: 40, s: 1 })]]) }); env.stage1();
      await full(env, evOf('capped', OWN('/js/a.js'), 1, 1, null), 6000);
      ok(env.sent.length === 0, 'сутки: 40 ошибок уже отправлено — больше не шлём');
      env = mkEnv({ store: new Map([['d37_el', JSON.stringify({ d: today, n: 1, s: 8 })]]) }); env.stage1();
      await full(env, evOf('capped', OWN('/js/a.js'), 1, 1, null), 6000);
      ok(env.sent.length === 0, 'сутки: 8 отправок уже было — больше не шлём');
      env = mkEnv({ store: new Map([['d37_el', JSON.stringify({ d: '2026-10-21', n: 40, s: 8 })]]) }); env.stage1();
      await full(env, evOf('new day', OWN('/js/a.js'), 1, 1, null));
      ok(env.sent.length === 1 && env.lsd().d === today && env.lsd().n === 1 && env.lsd().s === 1, 'сутки: на следующий день счётчики с нуля', env.lsd());
      env = mkEnv({ store: new Map([['d37_el', JSON.stringify({ d: today, n: 38, s: 2 })]]) }); env.stage1();
      for (let i = 0; i < 5; i++) env.error(evOf('batch ' + String.fromCharCode(97 + i), OWN('/js/a.js'), i, 1, null));
      await env.advance(300); env.stage2(); await env.advance(4400);
      ok(env.bodies()[0].e.length === 2 && env.lsd().n === 40, 'сутки: в пачку не больше, чем осталось до 40', env.bodies()[0].e.length);
      env = mkEnv({ store: new Map([['d37_el', 'не json {{{']]) }); env.stage1();
      await full(env, evOf('broken ls', OWN('/js/a.js'), 1, 1, null));
      ok(env.sent.length === 1, 'сутки: испорченная запись в localStorage — как пустая');

      // сервер велел молчать
      env = mkEnv({ reply: { ok: 0, stop: 7200 } }); env.stage1();
      await full(env, evOf('first', OWN('/js/a.js'), 1, 1, null));
      ok(env.sent.length === 1 && Math.abs((env.lsd().off - env.now) - 7200e3) < 5000, 'stop: ответ запомнен (off = через 2 часа)', env.lsd());
      env.error(evOf('second', OWN('/js/a.js'), 2, 1, null)); await env.advance(60000);
      ok(env.sent.length === 1, 'stop: в этом визите больше не шлём');
      const env2 = mkEnv({ store: env.store, now: env.now + 3600e3 }); env2.stage1();
      await full(env2, evOf('third', OWN('/js/a.js'), 3, 1, null));
      ok(env2.sent.length === 0, 'stop: и в следующем визите через час — молчим');
      const env3 = mkEnv({ store: env.store, now: env.now + 3 * 3600e3 }); env3.stage1();
      await full(env3, evOf('fourth', OWN('/js/a.js'), 4, 1, null));
      ok(env3.sent.length === 1, 'stop: через 3 часа — снова можно');
      const hugeStop = mkEnv({ reply: { ok: 0, stop: 9e12 } }); hugeStop.stage1();
      await full(hugeStop, evOf('x', OWN('/js/a.js'), 1, 1, null));
      ok(hugeStop.lsd().off <= hugeStop.now + 86400e3 + 1, 'stop: не дольше суток, как бы ни просил сервер', hugeStop.lsd());

      // rate: доля визитов
      env = mkEnv({ reply: { ok: 1, rate: 0.25 } }); env.stage1();
      await full(env, evOf('first', OWN('/js/a.js'), 1, 1, null));
      ok(env.lsd().rate === 0.25, 'rate: доля визитов запомнена');
      env2.sb.Math.random = () => 0.9;
      const pick = (r, store) => { const e = mkEnv({ store, rand: r }); e.stage1(); return e; };
      const yes = pick(0.1, env.store), no = pick(0.9, env.store);
      env.store.set('d37_el', JSON.stringify({ d: today, n: 0, s: 0, rate: 0.25 }));
      await full(yes, evOf('sampled in', OWN('/js/a.js'), 1, 1, null)); await full(no, evOf('sampled out', OWN('/js/a.js'), 1, 1, null));
      ok(yes.sent.length === 1 && no.sent.length === 0, 'rate 0,25: визит с random 0,1 отправляет, с random 0,9 — нет');
      const noBad = mkEnv({ reply: { ok: 1, rate: 'много' } }); noBad.stage1();
      await full(noBad, evOf('x', OWN('/js/a.js'), 1, 1, null));
      ok(noBad.lsd().rate === undefined, 'rate: не число — игнорируем');

      // ответ не json / сервер упал / fetch упал
      for (const [name, o] of [['ответ не JSON', { badJson: true }], ['fetch отклонён', { fetchRejects: true }], ['fetch бросает сразу', { fetchThrows: true }]]) {
        env = mkEnv(o); env.stage1();
        let t = null; try { await full(env, evOf('x', OWN('/js/a.js'), 1, 1, null)); } catch (e) { t = e; }
        ok(!t, `сеть: ${name} — не бросает`, t && t.message);
        ok(env.sent.length <= 1, `сеть: ${name} — повторов нет`, env.sent.length);
      }
    }

    // уход со страницы: sendBeacon
    {
      let env = mkEnv({ GAMES_VER: '115' }); env.stage1();
      env.error(evOf('before leave', OWN('/js/a.js'), 1, 1, null));
      await env.advance(300); env.stage2();
      env.fire('pagehide', {});
      ok(env.beacons.length === 1 && env.sent.length === 0 && env.beacons[0].url === '/api/diag' && /text\/plain/.test(env.beacons[0].type), 'pagehide: сразу sendBeacon (text/plain), не fetch');
      env.fire('pagehide', {}); await env.advance(10000);
      ok(env.beacons.length === 1 && env.sent.length === 0, 'pagehide: уже отправленное не уходит снова, таймер ничего не добавляет');
      env = mkEnv(); env.stage1();
      env.error(evOf('hidden tab', OWN('/js/a.js'), 1, 1, null)); await env.advance(300); env.stage2();
      env.sb.document.visibilityState = 'visible'; for (const l of env.docListeners) l.f({});
      ok(env.beacons.length === 0, 'visibilitychange: вкладка видна — ничего');
      env.sb.document.visibilityState = 'hidden'; for (const l of env.docListeners) l.f({});
      ok(env.beacons.length === 1, 'visibilitychange: вкладка скрыта — sendBeacon');
      env = mkEnv({ beaconFalse: true }); env.stage1();
      env.error(evOf('beacon refused', OWN('/js/a.js'), 1, 1, null)); await env.advance(300); env.stage2(); env.fire('pagehide', {});
      ok(env.beacons.length === 1 && env.sent.length === 1, 'pagehide: sendBeacon вернул false — запасной fetch');
      env = mkEnv({ beaconThrows: true }); env.stage1();
      env.error(evOf('beacon boom', OWN('/js/a.js'), 1, 1, null)); await env.advance(300); env.stage2();
      let t = null; try { env.fire('pagehide', {}); } catch (e) { t = e; }
      ok(!t && env.sent.length === 1, 'pagehide: sendBeacon бросает — не бросаем, шлём fetch', t && t.message);
      env = mkEnv(); env.stage1(); env.fire('pagehide', {});
      ok(env.beacons.length === 0, 'pagehide без ошибок — ничего');
    }

    // злое окружение: localStorage, часы, Blob, JSON
    {
      const evilLS = { getItem() { throw new Error('ls get'); }, setItem() { throw new Error('ls set'); }, removeItem() { throw new Error('ls rm'); } };
      let env = mkEnv({ localStorage: evilLS }); env.stage1();
      let t = null; try { await full(env, evOf('no storage', OWN('/js/a.js'), 1, 1, null)); } catch (e) { t = e; }
      ok(!t && env.sent.length === 1, 'localStorage бросает (приватный режим): не бросаем, отправляем из памяти', t && t.message);
      env = mkEnv(); env.sb.localStorage = undefined; env.stage1();
      t = null; try { await full(env, evOf('no ls at all', OWN('/js/a.js'), 1, 1, null)); } catch (e) { t = e; }
      ok(!t && env.sent.length === 1, 'localStorage нет совсем: отправляем');
      env = mkEnv(); env.sb.fetch = undefined; env.sb.navigator.sendBeacon = undefined; env.stage1();
      t = null; try { await full(env, evOf('no network api', OWN('/js/a.js'), 1, 1, null)); env.fire('pagehide', {}); } catch (e) { t = e; }
      ok(!t, 'нет ни fetch, ни sendBeacon: не бросает', t && t.message);
      env = mkEnv(); env.sb.Blob = undefined; env.stage1();
      env.error(evOf('no blob', OWN('/js/a.js'), 1, 1, null)); await env.advance(300); env.stage2();
      t = null; try { env.fire('pagehide', {}); } catch (e) { t = e; }
      ok(!t && env.sent.length === 1, 'нет Blob: запасной fetch', t && t.message);
      // ошибка в сообщении, которое нельзя превратить в строку
      env = mkEnv(); env.stage1();
      t = null; try { env.error(evOf({ toString() { throw new Error('ts'); } }, OWN('/js/a.js'), 1, 1, { get stack() { throw new Error('st'); } })); env.error(evOf('нормальная после злой', OWN('/js/a.js'), 2, 1, null)); await env.advance(300); env.stage2(); await env.advance(4400); } catch (e) { t = e; }
      ok(!t && env.bodies().length === 1 && env.bodies()[0].e.some(x => x.m === 'нормальная после злой'), 'злая ошибка (toString и stack бросают) не мешает следующим', t && t.message);
      // цикл: ошибка внутри самой отправки
      env = mkEnv({ onFetch: e => { e.error(evOf('error inside fetch', OWN('/js/a.js'), 5, 5, null)); e.rej(new Error('rej inside fetch')); } }); env.stage1();
      t = null; try { await full(env, evOf('outer', OWN('/js/a.js'), 1, 1, null), 40000); } catch (e) { t = e; }
      ok(!t && env.sent.length <= 4, 'ошибка внутри отправки не зацикливает: отправок ≤ 4', env.sent.length);
      // этап 2 запущен дважды
      env = mkEnv(); env.stage1(); env.error(evOf('a', OWN('/js/a.js'), 1, 1, null)); await env.advance(300); env.stage2(); env.stage2();
      await env.advance(4400);
      ok(env.sent.length === 1, 'этап 2 дважды: отправка одна');
      // этап 2 без этапа 1
      env = mkEnv(); t = null; try { env.stage2(); } catch (e) { t = e; }
      ok(!t && env.listeners.length === 0, 'этап 2 без этапа 1: ничего не делает');
    }

    // затраты
    {
      const env = mkEnv(); env.stage1(); env.error(evOf('hot', OWN('/js/hot.js'), 1, 1, mkErr('hot'))); await env.advance(300); env.stage2();
      const t0 = process.hrtime.bigint();
      const er = mkErr('hot');
      for (let i = 0; i < 200000; i++) env.error(evOf('hot', OWN('/js/hot.js'), 1, 1, er));
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      console.log(`  · 200 000 одинаковых ошибок (шквал, этап 1 снимает слушатели после 50 000): ${ms.toFixed(0)} мс`);
      ok(ms < 1500, 'затраты: 200 000 одинаковых ошибок < 1,5 с', ms);
      ok(env.on('error').length === 0, 'затраты: слушатели сняты после 50 000');
      await env.advance(60000);
      ok(env.sent.length <= 2, 'затраты: шквал — не больше двух отправок', env.sent.length);
      const t1 = process.hrtime.bigint();
      for (let i = 0; i < 2000; i++) { const e2 = mkEnv(); e2.stage1(); }
      const per = Number(process.hrtime.bigint() - t1) / 1e6 / 2000;
      console.log(`  · установка этапа 1 вместе с созданием песочницы: ${per.toFixed(3)} мс на раз`);
      ok(per < 5, 'затраты: установка этапа 1 < 5 мс (вместе с созданием песочницы)', per);
    }

    // ═══ 6. Сервер: POST /api/diag ═══
    const warns = [], realWarn = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    {
      const rpcCalls = [];
      let rpcImpl = async () => ({ ok: true, rate: 1 });
      globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (u.includes('/rest/v1/rpc/ops_err_ingest')) { rpcCalls.push(JSON.parse(init.body)); return rpcImpl(u, init); }
        return new Response('{}', { status: 404 });
      };
      const wrap = fn => async (u, init) => { const r = await fn(u, init); return r instanceof Response ? r : new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
      const setRpc = f => { rpcImpl = wrap(async (u, i) => f(u, i)); };
      setRpc(() => ({ ok: true, rate: 1 }));
      let ipN = 0;   // у каждого вызова свой адрес, если не задан (иначе упрёмся в лимит одного адреса)
      const call = async (body, o = {}) => {
        const out = { code: 0, headers: {}, body: '', json: null };
        const res = { statusCode: 200, setHeader(k, v) { out.headers[k] = v; }, end(b) { out.body = b; try { out.json = JSON.parse(b); } catch (e) {} out.code = res.statusCode; } };
        const req = { method: o.method || 'POST', headers: Object.assign({ 'x-real-ip': o.ip || '192.0.2.' + (++ipN % 250 + 1) + '.' + (ipN >> 8) }, o.headers || {}), body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) };
        if (o.raw) req.body = o.raw;
        await D.default(req, res);
        return out;
      };
      const good = (n = 1, o = {}) => Object.assign({ v: '115', b: 'chrome/129', o: 'windows', d: 'd', x: 0, e: Array.from({ length: n }, (_, i) => ({ t: 'e', m: 'server test error ' + String.fromCharCode(97 + i), f: '/js/a.js', l: i + 1, c: 1, r: 'chat', n: 1, s: '' })) }, o);
      D._test.reset();

      let r = await call(good(2));
      ok(r.code === 200 && r.json.ok === 1 && r.json.rate === 1 && rpcCalls.length === 1, 'сервер: нормальная пачка — ok, rate, один вызов базы', r);
      ok(r.headers['Cache-Control'] === 'no-store' && /application\/json/.test(r.headers['Content-Type']), 'сервер: no-store, JSON');
      ok(rpcCalls[0].p_items.length === 2 && rpcCalls[0].p_meta.v === '115' && rpcCalls[0].p_meta.b === 'chrome/129' && rpcCalls[0].p_meta.x === 0, 'сервер: в базу уходят p_items (очищенные) и p_meta', rpcCalls[0]);
      for (const m of ['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH']) { r = await call(good(), { method: m }); ok(r.code === 405 && r.headers.Allow === 'POST', `сервер: ${m} — 405`); }
      ok(rpcCalls.length === 1, 'сервер: чужие методы в базу не ходят');

      D._test.reset(); rpcCalls.length = 0;
      r = await call(good(), { headers: { 'content-length': '999999' } });
      ok(r.code === 413 && r.json.stop > 0 && rpcCalls.length === 0, 'сервер: Content-Length > 16 КБ — 413 + stop, база не вызвана');
      r = await call('x'.repeat(20000));
      ok(r.code === 400 && rpcCalls.length === 0, 'сервер: тело больше 16 КБ — 400');
      r = await call('не json {');
      ok(r.code === 400 && rpcCalls.length === 0, 'сервер: не JSON — 400');
      for (const bad of [null, [], 5, 'e', { e: 'x' }, { e: {} }, {}]) { r = await call(JSON.stringify(bad)); ok(r.code === 400 && rpcCalls.length === 0, `сервер: форма не та (${JSON.stringify(bad)}) — 400`); }
      r = await call(good(0));
      ok(r.code === 200 && r.json.ok === 1 && rpcCalls.length === 0, 'сервер: пустой список — ok без базы');
      r = await call(good(0, { e: [{ t: 'e', m: 'Script error.' }, { m: 'TypeError: Failed to fetch' }, { m: '' }, null, 7, 'x'] }));
      ok(r.code === 200 && r.json.ok === 1 && rpcCalls.length === 0, 'сервер: один шум — ok без базы');
      D._test.reset();
      const many = good(30);
      r = await call(many);
      ok(rpcCalls.length === 1 && rpcCalls[0].p_items.length === 10, 'сервер: больше 10 ошибок в пачке — берём первые 10', rpcCalls[0] && rpcCalls[0].p_items.length);
      ok(Buffer.isBuffer(Buffer.from('x')) && (await call(Buffer.from(JSON.stringify(good())))).code === 200, 'сервер: тело-Buffer принимается');
      ok((await call(null, { raw: good() })).code === 200, 'сервер: тело уже разобрано (объект) — принимается');

      // перепроверка присланного
      D._test.reset(); rpcCalls.length = 0;
      r = await call({ v: '1 5!<b>', b: '<b>', o: 'beos', d: 'x', x: 'много', e: [
        { t: 'zzz', m: 'Bad token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij for vasya@mail.ru', f: 'https://evil.example/js/a.js?t=1', l: '12abc', c: -4, r: 'Bad Route!', n: 99999, s: "<script>x</script>\nfoo /js/a.js:1:2\nevil text\nbar https://dan4ik37.vercel.app/js/a.js:3:4" },
        { t: 'r', m: 'load failed: script', f: 'https://dan4ik37.vercel.app/js/games/x.js?v=1&token=secret', l: 0, r: 'play/chess', n: 2 },
        { t: 'e', m: 'ok one', f: '/js/b.js', l: 5, c: 1, r: 'play/kubomir', n: 3, s: 'tick /js/b.js:5:1' },
        { t: 'p', m: 'with cdn', f: 'cdn:/npm/x@1/y.js', l: 1, r: 'home', n: 1 },
      ] });
      const sent = rpcCalls[0].p_items, meta = rpcCalls[0].p_meta;
      ok(r.code === 200 && sent.length === 4, 'сервер: 4 записи дошли до базы', sent.length);
      ok(meta.v === '' && meta.b === 'other' && meta.o === 'other' && meta.d === 'd' && meta.x === 0, 'сервер: метка пачки: версия с мусором → пусто, браузер/система/устройство вне списка → other / d', meta);
      ok(sent[0].t === 'e' && !/vasya|eyJ|@/.test(sent[0].m) && sent[0].m.includes('<jwt>') && sent[0].m.includes('<email>'), 'сервер: сообщение очищено ещё раз (jwt, почта)', sent[0].m);
      ok(sent[0].f === '' && sent[0].l === 0 && sent[0].c === 0 && sent[0].r === 'other' && sent[0].n === 1000, 'сервер: чужой файл → пусто, строка 12abc → 0, столбец −4 → 0, раздел «Bad Route!» → other, n ≤ 1000', sent[0]);
      ok(sent[0].s === 'foo /js/a.js:1:2', 'сервер: в стеке остаются только строки точного вида «имя /путь:строка:столбец»', sent[0].s);
      ok(sent[1].f === '/js/games/x.js' && sent[1].t === 'r' && sent[1].r === 'play/chess', 'сервер: полный адрес файла → путь без запроса');
      ok(sent[2].s === 'tick /js/b.js:5:1' && sent[2].n === 3 && sent[3].f === 'cdn:/npm/x@1/y.js', 'сервер: нормальные записи не портятся');
      ok(JSON.stringify(Object.keys(sent[2]).sort()) === '["c","f","l","m","n","r","s","t"]', 'сервер: в базу только известные поля');

      // ответы базы
      D._test.reset(); rpcCalls.length = 0;
      setRpc(() => ({ ok: true, rate: 0.3 }));
      r = await call(good());
      ok(r.json.ok === 1 && r.json.rate === 0.3, 'база: rate передаётся браузеру');
      setRpc(() => ({ ok: true, rate: 7 }));
      r = await call(good());
      ok(r.json.ok === 1 && r.json.rate === undefined, 'база: rate вне 0…1 — не передаётся');
      setRpc(() => ({ ok: false, stop: 5000 }));
      r = await call(good()); const n1 = rpcCalls.length;
      ok(r.code === 200 && r.json.ok === 0 && r.json.stop === 5000, 'база: потолок дня → stop передан браузеру', r.json);
      r = await call(good()); r = await call(good());
      ok(rpcCalls.length === n1 && r.json.ok === 0 && r.json.stop >= 60, 'база: после «хватит» экземпляр сам отвечает stop, в базу не ходит', { calls: rpcCalls.length - n1, stop: r.json.stop });
      D._test.reset(); rpcCalls.length = 0;
      setRpc(() => { throw new Error('rpc ops_err_ingest: HTTP 404 {"code":"PGRST202","message":"Could not find the function public.ops_err_ingest"}'); });
      globalThis.fetch = async (url, init) => { if (String(url).includes('ops_err_ingest')) { rpcCalls.push(1); return new Response('{"code":"PGRST202","message":"Could not find the function public.ops_err_ingest(p_items, p_meta) in the schema cache"}', { status: 404 }); } return new Response('{}', { status: 404 }); };
      r = await call(good());
      ok(r.code === 200 && r.json.ok === 0 && r.json.stop === 3600, 'нет ops.sql (PGRST202): тихий ответ stop на час', r.json);
      r = await call(good()); r = await call(good());
      ok(rpcCalls.length === 1, 'нет ops.sql: дальше экземпляр в базу не ходит (5 минут)', rpcCalls.length);
      D._test.reset(); rpcCalls.length = 0;
      globalThis.fetch = async (url) => { if (String(url).includes('ops_err_ingest')) { rpcCalls.push(1); return new Response('boom', { status: 500 }); } return new Response('{}', { status: 404 }); };
      r = await call(good());
      ok(r.code === 200 && r.json.ok === 0 && r.json.stop === 900 && rpcCalls.length === 1, 'база упала (500): тихий ответ stop на 15 минут', r.json);
      r = await call(good());
      ok(rpcCalls.length === 1, 'база упала: две минуты в базу не ходим');
      D._test.reset(); rpcCalls.length = 0;
      globalThis.fetch = (url) => new Promise((_, rej) => { rpcCalls.push(1); setTimeout(() => rej(new Error('network down')), 5); });
      const t0 = Date.now(); r = await call(good());
      ok(r.code === 200 && r.json.ok === 0 && Date.now() - t0 < 3000, 'база недоступна (сеть): ответ быстро, без исключения', r.json);

      // нет ключей / выключатель / лимиты
      D._test.reset();
      const saved = [process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY];
      delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      r = await call(good());
      ok(r.code === 200 && r.json.ok === 0 && r.json.stop === 21600, 'нет ключей Supabase: тихий ответ stop, сайт работает');
      [process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY] = saved;
      process.env.DIAG_DISABLED = '1';
      r = await call(good());
      ok(r.json.ok === 0 && r.json.stop === 86400, 'DIAG_DISABLED=1: выключатель — stop на сутки');
      delete process.env.DIAG_DISABLED;

      // шквал: 2000 запросов с 30 адресов подряд
      D._test.reset(); rpcCalls.length = 0;
      globalThis.fetch = async (url, init) => { if (String(url).includes('ops_err_ingest')) { rpcCalls.push(1); return new Response('{"ok":true,"rate":1}', { status: 200, headers: { 'Content-Type': 'application/json' } }); } return new Response('{}', { status: 404 }); };
      const codes = {}, t1 = Date.now();
      for (let i = 0; i < 2000; i++) { const rr = await call(good(1), { ip: '198.51.100.' + (i % 30) }); codes[rr.code] = (codes[rr.code] || 0) + 1; }
      const lim = D._test.LIM;
      console.log(`  · шквал 2000 запросов с 30 адресов: ${Date.now() - t1} мс, ответы ${JSON.stringify(codes)}, вызовов базы ${rpcCalls.length}`);
      ok(rpcCalls.length <= lim.globalN && rpcCalls.length <= 30 * lim.ipN && codes[429] >= 1700, 'шквал: в базу не больше 240 вызовов (общий потолок экземпляра), остальные 429', { calls: rpcCalls.length, codes });
      ok(Date.now() - t1 < 5000, 'шквал: 2000 запросов обработаны быстро');
      r = await call(good(), { ip: '198.51.100.250' });
      ok(r.code === 429 && r.json.stop > 0, 'шквал: 429 с stop — браузер услышит и замолчит');
      D._test.reset(); rpcCalls.length = 0;
      for (let i = 0; i < lim.ipN; i++) await call(good(), { ip: '203.0.113.99' });
      r = await call(good(), { ip: '203.0.113.99' });
      ok(r.code === 429 && r.json.stop === 600 && rpcCalls.length === lim.ipN && lim.ipN === 30, 'лимит адреса: 30 запросов за 10 минут (за мобильным оператором — сотни людей на одном адресе), 31-й — 429 (stop 10 мин)', r.json);
      r = await call(good(), { ip: '203.0.113.100' });
      ok(r.code === 200, 'лимит адреса: другой адрес не задет');
      // окна лимитов: через 10 минут адрес снова может
      ok(D._test.gate('203.0.113.99', Date.now() + 11 * 60e3) === null, 'лимит адреса: через 11 минут окно новое');
      for (let i = 0; i < 5000; i++) D._test.gate('10.1.' + (i >> 8) + '.' + (i & 255), Date.now() + 2 * 3600e3 + i);
      ok(true, 'лимит адреса: 5000 разных адресов — память ограничена (бакеты чистятся)');
      // ошибка внутри обработчика
      D._test.reset();
      globalThis.fetch = async () => { throw 'строка вместо Error'; };
      r = await call(good());
      ok(r.code === 200 && r.json.ok === 0, 'сервер: исключение внутри не уходит наружу', r);
      const resBroken = { statusCode: 200, setHeader() { throw new Error('res'); }, end() {} };
      let t = null; try { await D.default({ method: 'POST', headers: {}, body: JSON.stringify(good()) }, resBroken); } catch (e) { t = e; }
      ok(!t, 'сервер: даже сломанный res не роняет функцию', t && t.message);
      // подсказки владельцу в журнале Vercel: по одной на причину и экземпляр, без содержимого отчётов
      ok(warns.some(w => /ops\.sql не применён/.test(w)) && warns.some(w => /SUPABASE_URL/.test(w)) && warns.some(w => /база не приняла/.test(w)), 'журнал Vercel: понятные подсказки (нет ops.sql, нет ключей, база не приняла)', warns);
      ok(!warns.some(w => /server test error|vasya|eyJ/.test(w)), 'журнал Vercel: содержимое отчётов не пишется');
      ok(warns.filter(w => /ops\.sql не применён/.test(w)).length <= 3, 'журнал Vercel: не чаще раза на причину и сброс', warns.length);
    }
    console.warn = realWarn;

    // ═══ 7. Файлы: свежесть, страницы, адреса, лимит функций ═══
    {
      const file = src('js/core/errlog.js');
      ok(file === M.ERR_FILE, 'файл js/core/errlog.js свежий (node scripts/make-errlog.mjs)');
      ok(crypto.createHash('sha1').update(M.ERR_FILE).digest('hex').slice(0, 8) === M.ERR_VER, '?v= этапа 1 = хеш файла этапа 2');
      const idx = src('index.html');
      const i = idx.indexOf('<!-- errlog:begin'), j = idx.indexOf('<!-- errlog:end -->');
      ok(i > 0 && j > i && idx.slice(i, j + '<!-- errlog:end -->'.length) === M.ERR_BLOCK, 'index.html: блок этапа 1 свежий (node scripts/make-errlog.mjs)');
      const head = idx.slice(0, idx.indexOf('</head>'));
      ok(head.indexOf('<!-- errlog:begin') > head.indexOf('d37AuthHash') && head.indexOf('<!-- errlog:begin') < head.indexOf('mc.yandex.ru') && head.indexOf('<!-- errlog:begin') < head.indexOf('pagead2'), 'index.html: этап 1 — после скрипта, стирающего токены из адреса, и до Метрики и рекламы');
      ok(head.indexOf('<base href="/">') < head.indexOf('<!-- errlog:begin'), 'index.html: <base href="/"> по-прежнему первым');
      ok((idx.match(/errlog:begin/g) || []).length === 1, 'index.html: блок один');
      ok(!/<\/script/i.test(M.ERR_JS) && !M.ERR_JS.includes('<!--') && !new RegExp("[" + String.fromCharCode(0x2028, 0x2029) + "]").test(M.ERR_JS + M.ERR_FILE), 'этап 1: в тексте нет «</script», «<!--» и U+2028');
      ok(Buffer.byteLength(M.ERR_JS) < 3000 && zlibSize(M.ERR_JS) < 1500, 'этап 1: меньше 3 КБ (в <head> каждой страницы)', [Buffer.byteLength(M.ERR_JS), zlibSize(M.ERR_JS)]);
      // старые телефоны: ES5 и регулярные выражения без lookbehind / \p{…} / именованных групп (иначе скрипт не разберётся целиком)
      ok(!/=>|\blet\b|\bconst\b|\bclass\b|\basync\s+function|\basync\s*\(|\bawait\b|\.\.\.|\?\.|\?\?|\*\*|\(\?<[=!]|\\p\{|\(\?<\w+>/.test(M.ERR_JS + M.ERR_FILE.slice(M.ERR_FILE.indexOf('(function () {'))), 'этапы 1 и 2: только ES5 (нет стрелок, let/const, ..., ?., lookbehind, \\p{})');
      let page = P.page({ title: 'Тест', body: '<main>x</main>' });
      ok(page.includes(M.ERR_HEAD) && (page.match(/errHook/g) || []).length === 1, 'page.js: серверные страницы получают этап 1 (один раз)');
      ok(page.indexOf(M.ERR_HEAD) < page.indexOf('mc.yandex.ru') && page.indexOf(M.ERR_HEAD) < page.indexOf('<body>'), 'page.js: этап 1 в <head>, до Метрики');
      page = P.page({ title: 'Тест', body: '<main>x</main>', noAds: true });
      ok(page.includes(M.ERR_HEAD), 'page.js: без рекламы — тоже');
      const vj = JSON.parse(src('vercel.json'));
      const rw = vj.rewrites.find(r => r.source === '/api/diag');
      ok(rw && rw.destination === '/api/pages?page=diag', 'vercel.json: /api/diag → api/pages?page=diag');
      ok(/import diag from '\.\/_lib\/routes\/diag\.js'/.test(src('api/pages.js')) && /\bdiag\b[ }]*\};/.test(src('api/pages.js')), 'api/pages.js: маршрут diag подключён');
      const fns = fs.readdirSync(path.join(SITE, 'api'), { withFileTypes: true }).filter(d => d.isFile() && d.name.endsWith('.js'));
      ok(fns.length <= 12, `Vercel Hobby: серверных функций ${fns.length} из 12 (каждый api/*.js — функция)`, fns.map(d => d.name));
      ok(fns.length === 10, 'функций ровно 10: мониторинг не добавил 11-ю (маршрут — в api/_lib/routes)', fns.length);
      const sw = src('sw.js');
      ok(/\^\\\/\(api\|go\)\(\\\/\|\$\)/.test(sw), 'sw.js: /api/* никогда не кэшируется (pass)');
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
  console.log(`errlog-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ПАДЕНИЕ:', e && e.stack || e); process.exit(1); });
