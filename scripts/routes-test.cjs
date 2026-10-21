// Настоящие адреса разделов (js/ui/router.js, фаза 1 мастер-инструкции) — проверка без браузера:
//  1) карта адресов: каждый раздел PAGES ↔ настоящий адрес, старые ссылки #/… из кода, базы (SQL) и сервера → куда ведут;
//  2) роутер в режиме адресов и 'hash' (свой маленький window/location/history): загрузка, location.hash = '#/…', переходы,
//     «Назад», клики по ссылкам, адрес без перехода, заголовок/описание/canonical/noindex;
//  3) vercel.json: серверные страницы — как были и раньше разделов, у каждого раздела rewrite → index.html, неизвестное — 404;
//  4) серверные страницы /forum, /forum/<id>, /ideas, /ideas/<id> (подменённый Supabase): JSON-LD, экранирование, ссылки и мат
//     скрыты, без рекламы; карта сайта, robots.txt, sw.js, manifest, index.html, 404.html.
// Запуск из корня сайта: node scripts/routes-test.cjs
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { pathToFileURL } = require('url');
const SITE = process.argv[2] || path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(SITE, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const tick = () => new Promise(r => setTimeout(r, 5));

// ═══ Маленький браузер: окно (события), адрес, история, <head> ═══
function browser(startUrl, routing){
  const ls = [];
  const H = { entries: [{ url: new URL(startUrl).href, state: null }], i: 0, pushes: 0, reloads: [] };
  const cur = () => new URL(H.entries[H.i].url);
  const win = {
    addEventListener(t, f, o){ ls.push({ t, f, cap: o === true || !!o?.capture }); },
    removeEventListener(t, f){ const i = ls.findIndex(l => l.t === t && l.f === f); if (i >= 0) ls.splice(i, 1); },
    dispatchEvent(ev){
      let stop = false;
      ev.stopImmediatePropagation = () => { stop = true; };
      ev.stopPropagation = ev.stopPropagation || (() => {});
      const list = ls.filter(l => l.t === ev.type);
      for (const l of [...list.filter(l => l.cap), ...list.filter(l => !l.cap)]) { if (stop) break; l.f(ev); }
      return true;
    },
  };
  const fire = (type, init = {}) => win.dispatchEvent(Object.assign({ type, defaultPrevented: false, preventDefault(){ this.defaultPrevented = true; } }, init));
  // как в браузере: смена решётки — новая запись, popstate сразу, hashchange — следующей задачей
  function setHash(h){
    const old = cur().href, u = cur(); u.hash = h.startsWith('#') ? h : '#' + h;
    if (u.href === old) return;
    H.entries.splice(H.i + 1); H.entries.push({ url: u.href, state: null }); H.i++;
    fire('popstate', { state: null });
    setTimeout(() => fire('hashchange', { oldURL: old, newURL: u.href }), 0);
  }
  const location = {
    get href(){ return cur().href; }, get pathname(){ return cur().pathname; }, get search(){ return cur().search; },
    get hash(){ const h = cur().hash; return h === '#' ? '' : h; }, set hash(h){ setHash(h); }, get origin(){ return cur().origin; },
    assign(u){ H.reloads.push(new URL(u, cur()).href); }, replace(u){
      const n = new URL(u, cur().origin + '/');   // <base href="/">
      if (n.pathname === cur().pathname && n.search === cur().search) { const old = cur().href; H.entries[H.i] = { url: n.href, state: null }; setTimeout(() => fire('hashchange', { oldURL: old, newURL: n.href }), 0); }
      else H.reloads.push(n.href);
    },
  };
  const history = {
    get state(){ return H.entries[H.i].state; }, get length(){ return H.entries.length; },
    pushState(st, t, url){ H.entries.splice(H.i + 1); H.entries.push({ url: new URL(url, cur().origin + '/').href, state: st }); H.i++; H.pushes++; },
    replaceState(st, t, url){ H.entries[H.i] = { url: url ? new URL(url, cur().origin + '/').href : cur().href, state: st }; },
    go(n){ setTimeout(() => { const j = Math.max(0, Math.min(H.entries.length - 1, H.i + n)); if (j === H.i) return; const old = cur().href; H.i = j;
      fire('popstate', { state: history.state }); if (new URL(old).hash !== cur().hash) setTimeout(() => fire('hashchange', { oldURL: old, newURL: cur().href }), 0); }, 0); },
    back(){ this.go(-1); }, forward(){ this.go(1); },
  };
  // <head>: meta/link по атрибутам
  const mk = tag => { const e = { tag, attrs: {}, setAttribute(k, v){ this.attrs[k] = String(v); }, getAttribute(k){ return k in this.attrs ? this.attrs[k] : null; },
    remove(){ const i = head.list.indexOf(this); if (i >= 0) head.list.splice(i, 1); } }; return e; };
  const head = { list: [], appendChild(e){ this.list.push(e); return e; },
    querySelector(sel){ const m = /^(\w+)\[(\w+)="([^"]+)"\]$/.exec(sel); return m ? this.list.find(e => e.tag === m[1] && e.attrs[m[2]] === m[3]) || null : null; } };
  const document = { head, title: '', createElement: mk, getElementById: () => null };
  const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  class CustomEvent { constructor(type, o = {}){ this.type = type; this.detail = o.detail; } }
  const ctx = { console, URL, setTimeout, clearTimeout, location, history, document, CustomEvent, sessionStorage: store(), localStorage: store(), ROUTING: routing || 'path' };
  Object.assign(win, ctx);
  win.window = win; win.globalThis = win;
  vm.createContext(win);
  // config.js задаёт ROUTING через const — здесь подставляем значение заранее, как глобальное имя
  vm.runInContext(`var ROUTING = ${JSON.stringify(routing || 'path')};`, win);
  vm.runInContext(src('js/ui/router.js'), win, { filename: 'router.js' });
  const routes = [];
  win.addEventListener('d37:route', e => routes.push({ to: e.detail.to, from: e.detail.from, oldURL: e.oldURL, newURL: e.newURL }));
  const R = vm.runInContext('D37Route', win);
  const click = (href, o = {}) => {
    const a = { getAttribute: k => (k === 'href' ? href : null), hasAttribute: k => !!o[k], target: o.target || '', href: new URL(href, cur().origin + '/').href };
    const ev = { type: 'click', button: 0, ctrlKey: !!o.ctrl, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: !!o.prevented,
      target: { closest: () => a }, preventDefault(){ this.defaultPrevented = true; } };
    win.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  return { win, R, H, location, history, document, routes, cur, click, run: code => vm.runInContext(code, win) };
}

(async () => {
  // ═══ 1. Карта адресов ═══
  const B0 = browser('https://dan4ik37.vercel.app/');
  const R = B0.R, PAGES = B0.run('PAGES');
  const routes = Object.keys(PAGES);
  for (const r of routes) {
    const p = R.toPath('#/' + r);
    const back = R.toHash(p);
    ok(p.startsWith('/') && !p.includes('#'), `#/${r} → настоящий адрес ${p}`);
    ok(back === '#/' + r, `${p} → обратно #/${r}`, back);
  }
  ok(R.toPath('#/home') === '/' && R.toPath('') === '/' && R.toPath('#/') === '/' && R.toPath('#') === '/', 'главная — «/»');
  ok(R.toPath('#/games') === '/play' && R.toPath('#/games/chess/abcd') === '/play/chess/abcd' && R.toPath('#/games/horde/coop/ab12cd') === '/play/horde/coop/ab12cd', 'игры — /play/… (/games — страница для поиска)');
  ok(R.toPath('#/games/studio3d/play/abcd1234/xy7z9q') === '/play/studio3d/play/abcd1234/xy7z9q', 'мир игрока в «Студии 3D» с комнатой');
  ok(R.toPath('#/c/AbC123') === '/chat/join/abc123' && R.toPath('#/c/') === '/chat', 'приглашение #/c/<код> → /chat/join/<код>');
  ok(R.toPath('#/nope/x') === '/' && R.toPath('#/javascript:alert(1)') === '/', 'неизвестный раздел — главная (как раньше роутер)');
  ok(R.toPath('#/play/chess') === '/play/chess', '#/play/… (ссылка с новым адресом после решётки) — тоже понимаем');
  ok(R.toHash('/') === '#/home' && R.toHash('/index.html') === '#/home' && R.toHash('/home') === '#/home', '/, /index.html, /home — главная');
  for (const p of ['/games', '/games/chess', '/videos', '/v/dQw4w9WgXcQ', '/topics', '/topic/horror', '/top', '/history', '/vip', '/reklama', '/terms', '/refund', '/contacts',
    '/ads-terms', '/studio', '/g/abcd1234', '/c/abc123', '/r/k7m2qz', '/tools/nick', '/quiz', '/quiz/minecraft', '/privacy', '/go/5', '/auth/vk/start', '/api/feed', '/sitemap.xml'])
    ok(R.toHash(p) === null, `${p} — серверная страница (не раздел)`, R.toHash(p));
  for (const [p, h] of [['/about', '#/about'], ['/shop', '#/shop'], ['/forum', '#/forum'], ['/forum/42', '#/forum/42'], ['/ideas', '#/ideas'], ['/ideas/7', '#/ideas/7']])
    ok(R.toHash(p) === h, `${p} — общий адрес страницы для поиска и раздела ${h}`);
  ok(R.toHash('/play/chess/abcd?ref=k7m2qz') === '#/games/chess/abcd' && R.toHash('/chat/c/5#x') === '#/chat/c/5', 'адрес с ?… и #… — раздел без них');

  // Все старые ссылки из кода, SQL и сервера: «#/раздел…» → настоящий адрес, который сайт отдаёт (раздел или общая страница)
  const files = [];
  const walk = d => { for (const f of fs.readdirSync(path.join(SITE, d), { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (!/^(node_modules|\.git|\.claude|docs|scripts|sdk|vendor|assets|tools|apps|img|mods|models)$/.test(f.name) && !/kubomir|voxel|podzem/.test(f.name)) walk(p); }
    else if (/\.(js|html|sql|json)$/.test(f.name) && !/^(main|preload|renderer|config|package|package-lock)\.js(on)?$/.test(f.name) && !/^\.?vercel/.test(f.name)) files.push(p);
  } };
  walk('.');
  const legacy = new Set();
  for (const f of files) for (const m of src(f).matchAll(/['"`(\s=](#\/[a-z][a-z0-9-]*(?:\/[a-z0-9_-]+)*)/g)) legacy.add(m[1]);
  const roots = new Set([...legacy].map(h => h.split('/')[1]));
  const known = new Set([...routes, 'c', 'app', 'route']);
  ok([...roots].every(r => known.has(r)), 'все старые ссылки #/… в коде, базе и на сервере — известные разделы', [...roots].filter(r => !known.has(r)));
  const vj = JSON.parse(src('vercel.json'));
  // как Vercel: redirects → файл → rewrites (первое совпадение) → 404
  const rx = s => new RegExp('^' + s.replace(/[.*+?^${}()|[\]\\]/g, m => (m === '*' || m === '+' ? m : '\\' + m))
    .replace(/\/:(\w+)\*/g, '(?:/(?<$1>.*))?').replace(/\/:(\w+)\+/g, '/(?<$1>.+)').replace(/\/:(\w+)/g, '/(?<$1>[^/]+)') + '$');
  const fileOk = p => { try { return fs.statSync(path.join(SITE, p)).isFile(); } catch (e) { return false; } };
  function serve(p){
    for (const r of vj.redirects || []) { const m = rx(r.source).exec(p); if (m) return { redirect: r.destination.replace(/:(\w+)[*+]?/g, (x, k) => m.groups?.[k] || ''), permanent: !!r.permanent }; }
    if (p === '/' || fileOk(p)) return { file: p === '/' ? '/index.html' : p };
    for (const r of vj.rewrites) {
      const m = rx(r.source).exec(p); if (!m) continue;
      const d = r.destination.replace(/:(\w+)[*+]?/g, (x, k) => m.groups?.[k] ?? x);
      return d.startsWith('/api/') ? { api: d } : { file: d };
    }
    return { status: 404 };
  }
  const notServed = [];
  for (const h of legacy) {
    if (h.split('/')[1] === 'route') continue;
    const p = R.toPath(h), s = serve(p);
    if (!(s.file === '/index.html' || s.api)) notServed.push([h, p, s]);
    if (R.toHash(p) === null) notServed.push([h, p, 'не раздел']);
  }
  ok(notServed.length === 0, `старые ссылки (${legacy.size} разных) ведут на адреса, которые сайт отдаёт`, notServed.slice(0, 5));
  ok(legacy.size > 60, 'нашлось много старых ссылок (проверка не пустая)', legacy.size);
  console.log(`старых ссылок #/… в коде, базе и на сервере: ${legacy.size} разных (из ${files.length} файлов)`);
  for (const h of ['#/forum/42', '#/ideas', '#/chat/ev/5', '#/chat/reports', '#/phone/comm/abc', '#/phone/call/abcd1234ef', '#/profile/logins', '#/profile/vip',
    '#/adv/c/7', '#/adv/admin', '#/invite', '#/invite/admin', '#/games/raid/log', '#/games/wardrobe', '#/shop', '#/shop/o/D37-abc', '#/chat/twitch', '#/chat/join/abc123',
    '#/games/fillword/daily', '#/games/unity/play/abcd1234/xy7z9q']) {
    const p = R.toPath(h), s = serve(p);
    ok((s.file === '/index.html' || s.api) && R.toHash(p) === h, `старая ссылка ${h} → ${p} (${s.file || s.api})`);
  }

  // ═══ 2. vercel.json: серверные страницы — как были, раньше разделов; у разделов — index.html; мусор — 404 ═══
  const SERVER = [['/v/abc', 'video'], ['/vip', 'pages?page=vip'], ['/shop', 'page=shop'], ['/about', 'page=about'], ['/videos', 'page=videos'], ['/games', 'api/game'],
    ['/games/chess', 'api/game?id=chess'], ['/topics', 'page=topic'], ['/topic/horror', 'page=topic&slug=horror'], ['/studio', 'page=ugc'], ['/g/abcd1234', 'page=ugc&id='],
    ['/c/abc123', 'page=invite'], ['/r/k7m2qz', 'page=r&'], ['/tools/nick', 'page=nick'], ['/quiz/x', 'page=quiz&slug=x'], ['/ads-terms', 'page=adsterms'], ['/go/5', 'page=go'],
    ['/auth/vk/start', 'page=oauth'], ['/sitemap.xml', 'api/sitemap'], ['/sitemap-pages.xml', 'part=pages'], ['/api/feed', 'page=feed'], ['/api/ids', 'page=ids'], ['/api/geo', 'page=geo'],
    ['/forum', 'page=forum'], ['/forum/42', 'page=forum&id=42'], ['/ideas', 'page=ideas'], ['/ideas/7', 'page=ideas&id=7']];
  for (const [p, want] of SERVER) { const s = serve(p); ok(s.api && s.api.includes(want), `vercel.json: ${p} — серверная страница (${want})`, s); }
  ok(serve('/privacy').file === '/privacy.html' && serve('/robots.txt').file === '/robots.txt' && serve('/sw.js').file === '/sw.js' && serve('/manifest.json').file === '/manifest.json', 'файлы (privacy, robots, sw.js, manifest) — как есть');
  ok(serve('/js/ui/router.js').file === '/js/ui/router.js' && serve('/studio/frame.html').file === '/studio/frame.html' && serve('/.well-known/assetlinks.json').file, 'скрипты, песочницы студии, .well-known — файлы');
  for (const p of ['/', '/chat', '/chat/c/5', '/chat/join/abc123', '/profile', '/profile/vip', '/phone/call/abcd1234ef', '/play', '/play/2048', '/play/horde/coop/ab12cd',
    '/shorts', '/shorts/dQw4w9WgXcQ', '/invite', '/invite/admin', '/adv', '/adv/c/7', '/donate', '/poll', '/soundboard', '/clicker', '/lfg', '/ads', '/app', '/shop/o/D37-x'])
    ok(serve(p).file === '/index.html', `vercel.json: ${p} — приложение (index.html)`, serve(p));
  for (const p of ['/nope', '/chatx', '/play2', '/about/x', '/forum/42/x', '/donate/x', '/api/nope', '/home/x', '/.env', '/wp-login.php'])
    ok(serve(p).status === 404 || (serve(p).api && /page=nope/.test(serve(p).api)) || (p === '/api/nope' && serve(p).status === 404), `vercel.json: ${p} — 404`, serve(p));
  ok(serve('/home').redirect === '/' && serve('/home').permanent, '/home → / (постоянная переадресация)');
  ok(serve('/games/chess/abcd').redirect === '/play/chess/abcd' && serve('/games/horde/coop/ab12cd').redirect === '/play/horde/coop/ab12cd', '/games/<игра>/<код> (без решётки) → /play/…');
  ok(!vj.rewrites.some(r => /^\/(\(\.\*\)|:path\*)$/.test(r.source) || r.source === '/:path*'), 'нет переписывания «всё → index.html» (иначе мусор отдавал бы 200)');
  const firstSpa = vj.rewrites.findIndex(r => r.destination === '/index.html');
  ok(firstSpa > 0 && vj.rewrites.slice(firstSpa).every(r => r.destination === '/index.html'), 'разделы SPA — в конце rewrites (серверные страницы раньше)');
  const spaRoots = new Set(vj.rewrites.filter(r => r.destination === '/index.html').map(r => r.source.split('/')[1]));
  const needSpa = routes.filter(r => !['home', 'about', 'ideas', 'forum', 'shop'].includes(r)).map(r => (r === 'games' ? 'play' : r)).concat('app');
  ok(needSpa.every(r => spaRoots.has(r)), 'у каждого раздела PAGES есть rewrite → index.html (кроме общих с серверными страницами)', needSpa.filter(r => !spaRoots.has(r)));
  ok(fs.readdirSync(path.join(SITE, 'api')).filter(f => f.endsWith('.js')).length <= 12, 'функций Vercel — не больше 12');

  // ═══ 3. Роутер в режиме адресов ═══
  {
    const B = browser('https://dan4ik37.vercel.app/?ref=k7m2qz#/games/chess/abcd');
    B.R.start();
    ok(B.cur().pathname === '/play/chess/abcd' && B.cur().search === '?ref=k7m2qz' && B.cur().hash === '', 'загрузка по старой ссылке → настоящий адрес (параметры сохранены)', B.cur().href);
    ok(B.R.hash() === '#/games/chess/abcd' && B.run('currentRoute()') === 'games' && B.run('currentRouteParam()') === 'chess/abcd', 'D37Route.hash(), currentRoute(), currentRouteParam() — как раньше');
    ok(B.history.length === 1 && B.H.pushes === 0, 'переадресация без новой записи истории');
    ok(B.win.sessionStorage.getItem('d37_spa') === '1', 'вкладка помечена «сайт-приложение» (серверные страницы того же адреса открывают раздел)');
    // location.hash = '#/…' (старый код) → настоящий адрес, 'd37:route', запись истории — одна
    B.location.hash = '#/forum/42';
    await tick();
    ok(B.cur().pathname === '/forum/42' && B.cur().hash === '' && B.history.length === 2, 'location.hash = «#/forum/42» → /forum/42, одна новая запись', [B.cur().href, B.history.length]);
    ok(B.routes.length === 1 && B.routes[0].to === '#/forum/42' && B.routes[0].from === '#/games/chess/abcd', 'событие d37:route: откуда и куда (старый вид)', B.routes);
    ok(/\/#\/games\/chess\/abcd$/.test(B.routes[0].oldURL) && /\/#\/forum\/42$/.test(B.routes[0].newURL), 'oldURL/newURL как у hashchange (их читает «игра поверх мира»)', B.routes[0]);
    B.location.hash = '#/forum/42';   // тот же раздел ещё раз (в старом режиме — ничего не происходило)
    await tick();
    ok(B.cur().pathname === '/forum/42' && B.cur().hash === '' && B.routes.length === 1, 'location.hash = тот же раздел — адрес чистый, раздел не перерисовывается', B.routes.length);
    // переход D37Route.go и клик по ссылке
    B.R.go('#/chat');
    ok(B.cur().pathname === '/chat' && B.routes.length === 1, 'go(#/chat): адрес сразу, раздел — следующей задачей (как hashchange)');
    await tick();
    ok(B.routes.length === 2 && B.routes[1].to === '#/chat', 'go → d37:route');
    ok(B.click('/profile') && B.cur().pathname === '/profile', 'клик по <a href="/profile"> — без перезагрузки');
    ok(B.click('#/shop') && B.cur().pathname === '/shop', 'клик по <a href="#/shop"> — /shop без перезагрузки');
    ok(B.click('/#/donate') && B.cur().pathname === '/donate', 'клик по <a href="/#/donate"> (серверные страницы, уведомления) — /donate');
    ok(!B.click('/videos') && B.cur().pathname === '/donate', 'клик по серверной странице (/videos) — браузер сам (переход)');
    ok(!B.click('https://youtube.com/x') && !B.click('/play/2048', { target: '_blank' }) && !B.click('/play/2048', { ctrl: true }), 'чужие ссылки, новая вкладка, Ctrl — не трогаем');
    ok(!B.click('/play/2048', { prevented: true }) || B.cur().pathname === '/donate', 'ссылку уже обработали (preventDefault) — не трогаем');
    ok(B.click('/about', {}) && B.cur().pathname === '/about', '/about — раздел «Обо мне» внутри сайта');
    ok(!B.click('/about', { 'data-server': true }), 'data-server — серверная страница перезагрузкой');
    ok(B.click('#') && B.cur().pathname === '/about', '«#» (ссылка-кнопка без preventDefault) — никуда не уходим');
    await tick();
    const n = B.routes.length;
    // «Назад» / «Вперёд»
    B.history.back(); await tick(); await tick();
    ok(B.cur().pathname === '/donate' && B.routes.length === n + 1 && B.routes[n].to === '#/donate', '«Назад» → /donate, d37:route', B.routes.slice(n));
    B.history.forward(); await tick(); await tick();
    ok(B.cur().pathname === '/about' && B.routes[B.routes.length - 1].to === '#/about', '«Вперёд» → /about');
    // своя запись с тем же адресом (полный экран, телефон, игра поверх мира) — «Назад» по ней не переход
    const m = B.routes.length;
    B.history.pushState({ gsFull: 1 }, '', B.location.href); B.history.back(); await tick(); await tick();
    ok(B.routes.length === m, 'popstate по своей записи (тот же адрес) — не переход раздела');
    // адрес без перехода
    B.R.setUrl('#/shorts/dQw4w9WgXcQ'); await tick();
    ok(B.cur().pathname === '/shorts/dQw4w9WgXcQ' && B.routes.length === m && B.history.length === B.H.entries.length, 'setUrl — адрес меняется, раздел — нет');
    B.history.pushState({ x: 1 }, '', B.location.href); B.history.back(); await tick(); await tick();
    ok(B.routes.length === m, 'после setUrl «Назад» по своей записи — тоже не переход');
    ok(B.R.href('#/games/2048') === '/play/2048' && B.R.href('/chat') === '/chat' && B.R.href('#/home') === '/' && B.R.abs('#/games/chess/abc') === 'https://dan4ik37.vercel.app/play/chess/abc', 'href / abs — настоящие адреса');
    ok(B.R.abs('#/games/world', 'https://dan4ik37.vercel.app') === 'https://dan4ik37.vercel.app/play/world', 'abs(…, сайт) — для текстов «поделиться»');
    // переход на серверную страницу через go — обычный переход
    B.R.go('/videos');
    ok(B.H.reloads.includes('https://dan4ik37.vercel.app/videos'), 'go(/videos) — переход на серверную страницу');
    // токены входа в решётке — не наше (их разбирает auth-guard.js), роутер не трогает
    const k = B.routes.length;
    B.location.hash = '#access_token=abc&type=magiclink'; await tick();
    ok(B.location.hash === '#access_token=abc&type=magiclink' && B.routes.length === k, '#access_token… — роутер не трогает и не переходит');
  }
  // Загрузка по настоящему адресу, /index.html и /home
  {
    const B = browser('https://dan4ik37.vercel.app/play/2048'); B.R.start();
    ok(B.cur().pathname === '/play/2048' && B.R.hash() === '#/games/2048', '/play/2048 — раздел игр, игра 2048');
    const C = browser('https://dan4ik37.vercel.app/index.html?x=1'); C.R.start();
    ok(C.cur().pathname === '/' && C.cur().search === '?x=1', '/index.html → / (параметры на месте)');
  }
  // Заголовок, описание, canonical, noindex
  {
    const B = browser('https://dan4ik37.vercel.app/');
    const M = (r, p) => B.R.routeMeta(r, p);
    ok(M('home').canonical === 'https://dan4ik37.vercel.app/' && !M('home').noindex, 'главная: canonical «/», индексируется');
    ok(M('forum', '42').canonical === 'https://dan4ik37.vercel.app/forum/42' && !M('forum', '42').noindex, 'тема форума: canonical /forum/42 (как у серверной страницы)');
    ok(M('ideas', '7').canonical === 'https://dan4ik37.vercel.app/ideas/7', 'идея: canonical /ideas/7');
    ok(['profile', 'phone', 'adv', 'invite', 'games'].every(r => M(r).noindex) && M('chat', 'c/5').noindex && M('shop', 'o/D37-1').noindex && !M('chat').noindex && !M('shop').noindex,
      'noindex: профиль, телефон, кабинет, приглашения, экраны игр, каналы чата, заказы магазина; /chat и /shop — индексируются');
    ok(M('shorts', 'dQw4w9WgXcQ').canonical === 'https://dan4ik37.vercel.app/v/dQw4w9WgXcQ' && M('ads').canonical === 'https://dan4ik37.vercel.app/reklama', 'Shorts → страница ролика, «Реклама» → /reklama');
    const titles = routes.map(r => M(r).title), descs = routes.map(r => M(r).description);
    ok(new Set(titles).size === titles.length && new Set(descs).size === descs.length, 'у каждого раздела свой заголовок и описание');
    ok(titles.every(t => t.length >= 15 && t.length <= 70) && descs.every(d => d.length >= 50 && d.length <= 200), 'длины заголовков (15–70) и описаний (50–200)', titles.filter(t => t.length > 70));
    B.R.meta(M('profile')); const d = B.document;
    ok(d.title === 'Профиль — dan4ik37' && d.head.querySelector('meta[name="robots"]')?.attrs.content === 'noindex', 'meta: заголовок и noindex');
    B.R.meta(M('chat'));
    ok(!d.head.querySelector('meta[name="robots"]') && d.head.querySelector('link[rel="canonical"]').attrs.href === 'https://dan4ik37.vercel.app/chat'
      && d.head.querySelector('meta[property="og:url"]').attrs.content === 'https://dan4ik37.vercel.app/chat' && d.head.querySelector('meta[name="description"]'), 'meta: noindex снят, canonical и og:url — раздел');
    B.R.meta({ title: 'Тема <b>x</b> — форум dan4ik37' });
    ok(d.title === 'Тема <b>x</b> — форум dan4ik37' && d.head.querySelector('meta[property="og:title"]').attrs.content === 'Тема <b>x</b> — форум dan4ik37', 'meta({ title }) — текстом (без разметки)');
  }
  // Режим 'hash' (откат одной строкой)
  {
    const B = browser('https://dan4ik37.vercel.app/chat/c/5?x=1', 'hash'); B.R.start();
    ok(B.R.mode === 'hash' && B.cur().pathname === '/' && B.cur().hash === '#/chat/c/5' && B.cur().search === '?x=1', 'ROUTING = hash: настоящий адрес → /#/chat/c/5', B.cur().href);
    ok(B.R.href('#/games/2048') === '#/games/2048' && B.R.href('/play/2048') === '#/games/2048' && B.R.abs('#/chat') === 'https://dan4ik37.vercel.app/#/chat', 'hash: href/abs — решётка');
    ok(B.click('/forum') && B.cur().hash === '#/forum' && B.cur().pathname === '/', 'hash: клик по /forum — решётка, без перезагрузки');
    ok(!B.click('#/donate'), 'hash: клик по #/donate — браузер сам (обычная решётка)');
    B.location.hash = '#/donate'; await tick();
    ok(B.routes.length >= 2 && B.routes[B.routes.length - 1].to === '#/donate', 'hash: hashchange → d37:route', B.routes);
  }

  // ═══ 4. Серверные страницы, карта сайта, robots.txt ═══
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd37-routes-api-'));
  try {
    fs.cpSync(path.join(SITE, 'api'), path.join(tmp, 'api'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
    process.env.SUPABASE_URL = 'https://sb.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222';
    const NET = { calls: [] };
    const J = b => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    globalThis.fetch = async (url) => {
      const u = String(url); NET.calls.push(u);
      if (u.includes('/rest/v1/forum_threads?id=eq.5&')) return J([{ id: 5, title: 'Как пройти <script>alert(1)</script> уровень?', author_id: U1, pinned: false, locked: false, created_at: '2026-10-01T10:00:00Z' }]);
      if (u.includes('/rest/v1/forum_threads?id=eq.')) return J([]);
      if (u.includes('/rest/v1/forum_threads?select=id,title')) return J([{ id: 5, title: 'Тема про Майн', author_id: U1, pinned: true, locked: false, created_at: '2026-10-01T10:00:00Z', forum_posts: [{ count: 3 }] }]);
      if (u.includes('/rest/v1/forum_threads?select=id,created_at')) return J([{ id: 5, created_at: '2026-10-01T10:00:00Z' }, { id: 6, created_at: '2026-10-03T10:00:00Z' }]);
      if (u.includes('/rest/v1/forum_posts?thread_id=eq.5')) return J([
        { id: 1, author_id: U1, body: 'Привет! Пиши в тг @vasya_pro или звони +7 999 123-45-67, сайт https://evil.example.com/x и www.bad.ru, ещё dan4ik37.vercel.app/play/chess **жирно** ||спойлер|| <img src=x onerror=alert(1)>', created_at: '2026-10-01T10:00:00Z' },
        { id: 2, author_id: U2, body: 'это хуйня какая-то', created_at: '2026-10-01T11:00:00Z' }]);
      if (u.includes('/rest/v1/profiles?id=in.')) return J([{ id: U1, nick: 'Vasya', role: 'user' }, { id: U2, nick: 'Петя', role: 'moderator' }]);
      if (u.includes('/rest/v1/rpc/list_ideas')) return J([{ id: 9, author_id: U1, author_nick: 'Vasya', author_role: null, title: 'Пройти Silksong', body: 'Целиком', status: 'planned', video_id: null, votes: 12, created_at: '2026-10-02T10:00:00Z' },
        { id: 10, author_id: U2, author_nick: 'Петя', author_role: 'moderator', title: 'Плохая идея', body: '', status: 'rejected', video_id: null, votes: 0, created_at: '2026-10-02T10:00:00Z' }]);
      if (u.includes('/rest/v1/ideas?id=eq.9')) return J([{ id: 9, author_id: U1, title: 'Пройти Silksong', body: 'Целиком на стриме', status: 'done', video_id: 'dQw4w9WgXcQ', votes: 12, created_at: '2026-10-02T10:00:00Z', status_changed_at: '2026-10-05T10:00:00Z' }]);
      if (u.includes('/rest/v1/ideas?id=eq.')) return J([]);
      if (u.includes('/rest/v1/ideas?status=neq.rejected')) return J([{ id: 9, created_at: '2026-10-02T10:00:00Z', status_changed_at: '2026-10-05T10:00:00Z' }]);
      if (u.includes('/rest/v1/ugc_games')) return J([]);
      if (/googleapis|youtube/.test(u)) return new Response('{}', { status: 500 });
      return J([]);
    };
    const pages = (await import(pathToFileURL(path.join(tmp, 'api/pages.js')).href)).default;
    const call = async (handler, q) => {
      const out = { code: 200, headers: {}, body: '' };
      const res = { status(c){ out.code = c; return res; }, setHeader(k, v){ out.headers[k] = v; return res; }, send(b){ out.body = b; return res; } };
      await handler({ query: q, headers: {} }, res);
      out.ld = [...out.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1])).flat();
      out.title = (out.body.match(/<title>([^<]*)<\/title>/) || [])[1];
      out.canon = (out.body.match(/rel="canonical" href="([^"]+)"/) || [])[1];
      return out;
    };
    let r = await call(pages, { page: 'forum' });
    ok(r.code === 200 && r.canon === 'https://dan4ik37.vercel.app/forum' && /Форум dan4ik37/.test(r.title), '/forum: 200, canonical, заголовок');
    ok(r.ld.some(x => x['@type'] === 'CollectionPage' && x.mainEntity?.itemListElement?.[0]?.url === 'https://dan4ik37.vercel.app/forum/5') && r.ld.some(x => x['@type'] === 'BreadcrumbList'), '/forum: JSON-LD ItemList тем + хлебные крошки');
    ok(r.body.includes('href="/forum/5"') && r.body.includes('href="/#/forum"') && !/adsbygoogle\.js/.test(r.body), '/forum: ссылки на темы, «Создать тему» → раздел, без рекламы');
    ok(/sessionStorage\.getItem\('d37_spa'\)\)location\.replace\("\/#\/forum"\)/.test(r.body), '/forum: вкладка-приложение сразу открывает раздел');
    r = await call(pages, { page: 'forum', id: '5' });
    const main = r.body.slice(r.body.indexOf('<main'), r.body.indexOf('</main>'));
    ok(r.code === 200 && r.canon === 'https://dan4ik37.vercel.app/forum/5' && r.title.startsWith('Как пройти &lt;script&gt;'), '/forum/5: canonical, заголовок темы (экранирован)');
    ok(!/<script>alert|<img src=x/.test(r.body) && main.includes('&lt;img src=x onerror=alert(1)&gt;'), '/forum/5: текст игроков экранирован');
    ok(main.includes('[ссылка]') && !main.includes('evil.example') && !main.includes('bad.ru') && main.includes('<a href="/play/chess">'), 'чужие ссылки — «[ссылка]», свои — ссылками');
    ok(!main.includes('+7 999') && !main.includes('@vasya_pro') && main.includes('[скрыто]'), 'телефон и @ник — «[скрыто]»');
    ok(main.includes('это ***** какая-то') && !main.includes('хуйня'), 'мат закрыт');
    ok(!main.includes('**жирно') && !main.includes('||') && main.includes('жирно спойлер'), 'разметка VIP (**, ||) — простым текстом');
    const post = r.ld.find(x => x['@type'] === 'DiscussionForumPosting');
    ok(post && post.headline.includes('<script>') === true && post.author?.name === 'Vasya' && post.datePublished === '2026-10-01T10:00:00.000Z' && post.url === 'https://dan4ik37.vercel.app/forum/5', 'JSON-LD DiscussionForumPosting: заголовок, автор, дата, адрес');
    ok(post.comment?.length === 1 && post.comment[0].text === 'это ***** какая-то' && post.interactionStatistic?.userInteractionCount === 1 && !/evil|vasya_pro|\+7/.test(JSON.stringify(post)), 'JSON-LD: ответы (Comment) и счётчик; ссылок и контактов нет');
    ok(!r.body.includes('</script><script>alert') && r.body.includes('\\u003cscript>alert(1)\\u003c/script>'), 'JSON-LD: «<» внутри экранирован (\\u003c)');
    ok(r.body.includes('href="/#/forum/5"') && !/adsbygoogle\.js/.test(r.body) && r.body.includes('data-age-page="12"'), '«Ответить» → раздел; без рекламы; метка 12+ как у раздела');
    r = await call(pages, { page: 'forum', id: '77' });
    ok(r.code === 404 && /noindex/.test(r.body), 'нет темы — 404 и noindex');
    r = await call(pages, { page: 'forum', id: '../x' });
    ok(r.code === 404 && !NET.calls.some(u => u.includes('../x')), 'мусор в номере — 404 без запроса в базу');
    r = await call(pages, { page: 'ideas' });
    ok(r.code === 200 && r.canon === 'https://dan4ik37.vercel.app/ideas' && r.body.includes('href="/ideas/9"') && !r.body.includes('Плохая идея'), '/ideas: идеи (без отклонённых), canonical');
    ok(r.ld.some(x => x['@type'] === 'CollectionPage' && x.mainEntity?.numberOfItems === 1), '/ideas: JSON-LD ItemList');
    r = await call(pages, { page: 'ideas', id: '9' });
    const idea = r.ld.find(x => x['@type'] === 'DiscussionForumPosting');
    ok(r.code === 200 && r.canon === 'https://dan4ik37.vercel.app/ideas/9' && idea?.interactionStatistic?.userInteractionCount === 12 && idea?.sharedContent?.url === 'https://dan4ik37.vercel.app/v/dQw4w9WgXcQ', '/ideas/9: голоса и ролик в JSON-LD');
    ok(r.body.includes('href="/v/dQw4w9WgXcQ"') && r.body.includes('href="/#/ideas/9"') && !/adsbygoogle\.js/.test(r.body), '/ideas/9: «Смотреть ролик», «Поддержать» → раздел, без рекламы');
    r = await call(pages, { page: 'ideas', id: '404' });
    ok(r.code === 404, 'нет идеи — 404');
    r = await call(pages, { page: 'shop' });
    ok(r.code === 200 && r.body.includes('location.replace("/#/shop")') && r.body.includes('href="/#/shop"'), '/shop: вкладка-приложение — сразу в раздел, «Открыть магазин» → раздел');
    r = await call(pages, { page: 'about' });
    ok(!/d37_spa/.test(r.body), '/about: без перехода в раздел (раздел «Обо мне» сам ссылается на эту страницу)');
    r = await call(pages, { page: 'shop', o: 'D37-abc123', r: 'ok' });
    ok(r.body.includes('location.replace("/shop/o/D37-abc123")'), 'возврат с оплаты → /shop/o/<заказ> (раздел приложения)');
    // карта сайта
    const sitemap = (await import(pathToFileURL(path.join(tmp, 'api/sitemap.js')).href)).default;
    r = await call(sitemap, { part: 'pages' });
    for (const u of ['/forum', '/forum/5', '/forum/6', '/ideas', '/ideas/9', '/shorts', '/chat', '/donate', '/lfg', '/games', '/about'])
      ok(r.body.includes(`<loc>https://dan4ik37.vercel.app${u}</loc>`), `карта сайта: ${u}`);
    for (const u of ['/profile', '/phone', '/adv', '/invite', '/play', '/shop/'])
      ok(!r.body.includes(`<loc>https://dan4ik37.vercel.app${u}`), `карта сайта: без ${u}`);
    ok(r.body.includes('<loc>https://dan4ik37.vercel.app/forum/6</loc><lastmod>2026-10-03</lastmod>'), 'карта сайта: дата темы');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  // robots.txt
  const robots = src('robots.txt');
  for (const d of ['/api/', '/auth/', '/go/', '/profile', '/phone', '/adv', '/invite', '/chat/', '/shop/', '/play/studio/mod', '/play/unity/mod'])
    ok(new RegExp('^Disallow: ' + d.replace(/[/.]/g, '\\$&') + '\\s*$', 'm').test(robots), `robots.txt: закрыто ${d}`);
  ok(/^Allow: \/api\/feed$/m.test(robots) && /^Sitemap: https:\/\/dan4ik37\.vercel\.app\/sitemap\.xml$/m.test(robots) && !/^Disallow: \/\s*$/m.test(robots), 'robots.txt: /api/feed открыт (ролики главной), карта сайта, сайт не закрыт целиком');
  for (const p of ['/forum', '/ideas', '/chat', '/about', '/shop', '/play/chess', '/games/chess']) ok(!robotsBlocked(robots, p), `robots.txt: ${p} открыт`);
  function robotsBlocked(txt, p){
    let best = null;
    for (const m of txt.matchAll(/^(Allow|Disallow):\s*(\S*)\s*$/gm)) if (m[2] && p.startsWith(m[2]) && (!best || m[2].length >= best[1].length)) best = [m[1], m[2]];
    return !!best && best[0] === 'Disallow';
  }

  // ═══ 5. sw.js, manifest, index.html, 404.html, page.js, фильтр мата ═══
  const sw = {}; const swCtx = { self: { location: { origin: 'https://dan4ik37.vercel.app' }, addEventListener(){}, registration: {} }, URL, caches: {}, Response, Request, fetch(){}, console };
  vm.createContext(swCtx); vm.runInContext(src('sw.js'), swCtx);
  const X = swCtx.self.__d37sw;
  const nav = p => X.route({ method: 'GET', url: 'https://dan4ik37.vercel.app' + p, mode: 'navigate', headers: { get: () => null } });
  for (const p of ['/', '/chat', '/chat/c/5', '/play', '/play/sudoku', '/profile/vip', '/shop/o/D37-1', '/app', '/donate']) ok(nav(p) === 'shell', `sw.js: ${p} — оболочка (без сети — приложение)`);
  for (const p of ['/forum', '/forum/5', '/ideas', '/about', '/shop', '/games/chess', '/videos', '/v/abc']) ok(nav(p) === 'page', `sw.js: ${p} — серверная страница`);
  ok(vj.rewrites.filter(r => r.destination === '/index.html').every(r => X.SPA_PATH.test(r.source.replace(/\/:path\+$/, '/x'))), 'sw.js SPA_PATH = разделы из vercel.json');
  ok(+(/const VERSION = 'v(\d+)'/.exec(src('sw.js')) || [])[1] >= 5, 'sw.js: VERSION поднят (не ниже v5 — настоящие адреса)');
  const man = JSON.parse(src('manifest.json'));
  ok(man.start_url === '/' && man.scope === '/' && man.share_target?.action === '/', 'manifest: start_url, scope, «Поделиться» — «/»');
  ok(man.shortcuts.every(s => { const u = new URL(s.url, 'https://dan4ik37.vercel.app'); return R.toHash(u.pathname) || u.hash.startsWith('#/'); }) && !man.shortcuts.some(s => s.url.startsWith('/#/games')), 'manifest: ярлыки — разделы (настоящие адреса)', man.shortcuts.map(s => s.url));
  const idx = src('index.html'), headPart = idx.slice(0, idx.indexOf('</head>'));
  ok(/<meta charset="UTF-8">\s*(<!--[\s\S]*?-->\s*)?<base href="\/">/.test(idx) && headPart.indexOf('<base href="/">') < headPart.indexOf('<link') && headPart.indexOf('<base') < headPart.indexOf('src='), 'index.html: <base href="/"> — первым в <head>');
  ok(!/href="#\//.test(idx), 'index.html: ни одной ссылки href="#/…" (меню, подвал, карточки — настоящие адреса)', (idx.match(/href="#\/[^"]*"/g) || []).slice(0, 5));
  ok(!/rel="canonical"/.test(idx) && !/property="og:url"/.test(idx), 'index.html: canonical и og:url ставит роутер (общий был бы неверным на /chat)');
  ok(/<script src="js\/core\/config\.js"><\/script>\s*<!--[^>]*-->\s*<script src="js\/ui\/router\.js"><\/script>/.test(idx) && /<script src="js\/init\.js"><\/script>\s*<script>routerStart\(\)<\/script>/.test(idx), 'index.html: роутер — сразу после config.js, старт — после init.js');
  ok((idx.match(/src="js\/ui\/router\.js"/g) || []).length === 1, 'index.html: router.js — один раз');
  ok(/location\.pathname\+location\.search\+location\.hash/.test(idx), 'index.html: копия на GitHub Pages — на главный адрес с тем же путём');
  ok(/const ROUTING = 'path';/.test(src('js/core/config.js')), 'config.js: ROUTING = path (откат — hash)');
  const nf = src('404.html');
  ok(!/href="\/#\//.test(nf) && /href="\/chat"/.test(nf) && /\/play\//.test(nf), '404.html: настоящие адреса; /games/<игра>/<код> → /play/…');
  const pg = src('api/_lib/page.js');
  ok(!/href="\/#\//.test(pg) && /href="\/forum"/.test(pg) && /href="\/ideas"/.test(pg) && /spa = ''/.test(pg), 'page.js: шапка и подвал — настоящие адреса, ссылки на форум и идеи');
  const apiFiles = [];
  const walkApi = d => { for (const f of fs.readdirSync(path.join(SITE, d), { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walkApi(p); else if (f.name.endsWith('.js')) apiFiles.push(p); } };
  walkApi('api');
  const leftovers = apiFiles.flatMap(f => (src(f).match(/href="\/#\/[^"]*"/g) || []).map(m => f.replace(/\\/g, '/') + ': ' + m))
    .filter(x => !/routes\/(forum|shop)\.js: href="\/#\/(forum|ideas|shop)/.test(x));
  ok(leftovers.length === 0, 'серверные страницы: «/#/…» только для общих адресов (/shop, /forum, /ideas)', leftovers.slice(0, 5));
  // фильтр мата на серверной странице = чат (js/features/phone.js P.clean)
  const badOf = s => (s.match(/const BAD = \[([\s\S]*?)\];/) || [])[1]?.replace(/\s+/g, '');
  ok(badOf(src('api/_lib/routes/forum.js')) && badOf(src('api/_lib/routes/forum.js')) === badOf(src('js/features/phone.js')), 'список мата форума = чат (phone.js)');
  // в коде не осталось прямого чтения location.hash там, где нужен раздел (кроме решётки входа и запасных путей без роутера)
  const reads = [];
  for (const f of ['js/features/games.js', 'js/features/chat.js', 'js/features/phone.js', 'js/features/global-auth.js', 'js/features/youtube.js', 'js/features/ads.js',
    'js/features/adcab.js', 'js/features/shorts.js', 'js/ui/hotkeys.js', 'js/features/invite.js']) {
    // читать решётку можно, только чтобы сохранить её как есть (replaceState) и в запасном пути без роутера
    for (const line of src(f).split('\n')) {
      if (/[^.\w]location\.hash(?!\s*=[^=])/.test(line) && !/D37Route|typeof location|routeHash|replaceState|^\s*\/\//.test(line)) reads.push(f + ': ' + line.trim().slice(0, 100));
    }
  }
  ok(reads.length === 0, 'разделы читаются через D37Route.hash(), не location.hash', reads.slice(0, 5));
  const hcl = [];
  for (const f of ['js/features/games.js', 'js/features/chat.js', 'js/features/phone.js', 'js/features/app.js', 'js/features/fx.js', 'js/features/invite.js', 'js/core/ad-places.js', 'js/core/age.js'])
    if (/addEventListener\??\.?\(\s*'hashchange'/.test(src(f))) hcl.push(f);
  ok(hcl.length === 0, 'переход раздела слушают через d37:route (hashchange в режиме адресов не приходит)', hcl);

  console.log(`\nroutes-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
