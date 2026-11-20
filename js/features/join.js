// ═══════════════════════════════════════
//  👥 ПРИСОЕДИНЕНИЕ К ИГРЕ «КАК В РОБЛОКСЕ» И СПИСОК КОМНАТ (T-174, владелец 20.11; движок — d37-core/spec/NET_JOIN.md)
// ═══════════════════════════════════════
// Комнаты игр движка живут на сервере игр (d37-server): он один знает, какие комнаты есть, сколько в них людей, кто хозяин, коды.
// Сайт: список (GET /sessions?game=), «Быстрая игра» (GET /quick?game=), «Создать комнату» (хозяин шлёт движку lobby meta / limit), вход
// по 6-значному коду и по ссылке /hub/play/<игра>/<КОД> (или /hub/play/<игра>/s-<id> — комната из списка). Сам вход — движок
// (engine-host.js handle.lobby: join / joinCode / rejoinKey / state / leave), после того как мир загрузился.
// «Где играет друг»: движок шлёт {t:'mode', data:{kind:'presence', game, session, vis, n, max, joinable}} → часть «d:» в коде занятия
// телефона (phone.js P.activity / actCode / actParse / actText / actJoin — обёртки ниже). Код занятия уже едет по двум путям: общее
// «кто онлайн» сайта (chat.js; туда «d:» — только когда к игроку можно всем) и друзьям через comm_ping / friends_online (сервер, только
// друзья). Новых таблиц нет. Настройка «Кто может ко мне присоединиться» (все / друзья / только по приглашению) — D37Settings 'joinWho'
// (едет в аккаунт с настройками игр). Возраст: присоединиться к игре — не общение (владелец), разделение по возрасту остаётся в чате,
// звонках и личке; хозяин может сам ограничить комнату по возрасту (сервер проверяет).
// Группа «Идём вместе»: канал Supabase Realtime 'party-<id>' (только presence, без базы): ведущий заходит в комнату — у остальных
// с «Идём вместе» игра открывается в той же комнате. «Вернуться в игру»: ключ возврата движка — sessionStorage 'd37join_rj'.
// Всё чужое (названия комнат, ники, коды, поля сервера) — только textContent. Откат — JOIN_ON = false (js/core/config.js).
// Тест: node scripts/t174-e2e.cjs (две страницы, свой сервер игр на 127.0.0.1).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37Join) return;
  const doc = root.document;
  const ON = () => { try { if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && localStorage.getItem('d37_join_on') === '1') return true; } catch (e) {} try { return typeof JOIN_ON !== 'undefined' && !!JOIN_ON; } catch (e) { return false; } };   // localhost: тест включает сам (d37_join_on)
  const DEV = (() => { try { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname); } catch (e) { return false; } })();
  const URL_RE = /^wss?:\/\/[a-z0-9.\-]+(?::\d{1,5})?(?:\/[a-z0-9_\-/]*)?$/i;
  // адрес сервера игр: JOIN_SERVER из config.js; на своём компьютере (localhost) тест может подставить свой — localStorage d37_join_server
  function server(){
    let s = '';
    try { s = typeof JOIN_SERVER === 'string' ? JOIN_SERVER : ''; } catch (e) {}
    if (DEV) { try { const o = localStorage.getItem('d37_join_server'); if (o !== null) s = o; } catch (e) {} }
    s = String(s || '').trim().replace(/\/+$/, '');
    return URL_RE.test(s) ? s : '';
  }
  const httpOf = s => s.replace(/^ws(s?):\/\//i, 'http$1://');
  // игры с комнатами (сейчас одна): иконка, название, сколько людей можно
  const GAMES = { klet2: { title: 'Клеточки', icon: '🟢', max: 16 } };
  const gameOk = g => Object.prototype.hasOwnProperty.call(GAMES, g);
  const CODE_RE = /^[A-HJKMNP-Z2-9]{6}$/;          // как CODE_ALPHABET сервера: без I, L, O, 0, 1
  const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
  const VIS = { open: 'Все', friends: 'Друзья', code: 'По коду' };
  const P = () => root.D37Phone || null;
  const S = () => root.D37Settings || null;
  const me = () => { try { return typeof currentUser !== 'undefined' && currentUser ? currentUser : null; } catch (e) { return null; } };
  const prof = () => { try { return typeof currentProfile !== 'undefined' && currentProfile ? currentProfile : null; } catch (e) { return null; } };
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (cls, text, on) => { const b = el('button', cls, text); b.type = 'button'; if (on) b.addEventListener('click', on); return b; };
  const ss = { get(k){ try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }, set(k, v){ try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const go = href => { try { if (root.D37Route) D37Route.go(href); else location.href = href; } catch (e) { location.href = href; } };
  const abs = href => { try { return root.D37Route ? D37Route.abs(href) : location.origin + href; } catch (e) { return href; } };
  const clean = t => { const s = String(t == null ? '' : t).replace(/_/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40); try { return P()?.clean ? P().clean(s) : s; } catch (e) { return s; } };
  const num = (v, max) => { const n = Math.floor(+v); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0; };
  const report = (where, msg) => { try { root.d37Err && root.d37Err('join:' + where, new Error(String(msg || '').slice(0, 200))); } catch (e) {} };

  async function getJson(url, ms){
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const to = setTimeout(() => { try { ctl && ctl.abort(); } catch (e) {} }, ms || 4000);
    try { const r = await fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined }); if (!r.ok) return null; return await r.json(); } catch (e) { return null; } finally { clearTimeout(to); }
  }
  // строка списка сервера → проверенный объект (сервер свой, но поля всё равно не доверяем)
  function row(x){
    if (!x || typeof x !== 'object' || !gameOk(String(x.game)) || !ID_RE.test(String(x.id || ''))) return null;
    const code = String(x.code || '').toUpperCase();
    const max = num(x.max, 64) || GAMES[x.game].max;
    return { game: String(x.game), id: String(x.id), code: CODE_RE.test(code) ? code : '', vis: VIS[x.vis] ? String(x.vis) : 'open', players: num(x.players, 999), max,
      mode: String(x.mode || '').replace(/[^a-z0-9_]/gi, '').slice(0, 16), map: String(x.map || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 16),
      name: clean(x.name || ''), ages: ['all', 'kids', 'adults'].includes(x.ages) ? x.ages : 'all', region: String(x.region || '').replace(/[^a-z0-9-]/gi, '').slice(0, 16), full: !!x.full || num(x.players, 999) >= max };
  }
  // список комнат: null — сервер недоступен
  async function list(game){
    const s = server(); if (!s) return null;
    const d = await getJson(httpOf(s) + '/sessions' + (game ? '?game=' + encodeURIComponent(game) : ''));
    if (!Array.isArray(d)) return null;
    return d.slice(0, 200).map(row).filter(Boolean);
  }
  async function quick(game){
    const s = server(); if (!s || !gameOk(game)) return null;
    const d = await getJson(httpOf(s) + '/quick?game=' + encodeURIComponent(game));
    return d && ID_RE.test(String(d.id || '')) ? { id: String(d.id), fresh: !!d.new, players: num(d.players, 999) } : null;
  }

  // ═══ Есть ли у движка мост лобби (канал preview) — без него всё прячется ═══
  let bridgeP = null;
  function bridge(){
    if (!ON()) return Promise.resolve(false);
    if (bridgeP) return bridgeP;
    bridgeP = (async () => {
      const H = root.D37Hub; if (!H || !H.resolveGame) return false;
      const g = await H.resolveGame('klet2');
      const id = String(g && g.build && g.build.id || '');
      if (!/^[0-9a-f]{6,16}$/.test(id)) return false;
      try { const c = JSON.parse(localStorage.getItem('d37_join_bridge') || 'null'); if (c && c.id === id && c.base === g.base) return !!c.ok; } catch (e) {}
      // тот же адрес, что берёт hub.js при запуске игры (?v=<сборка>&k=3) — файл ляжет в кэш и второй раз не скачается
      let t = '';
      try { const r = await fetch(g.base + 'engine-host.js?v=' + id + '&k=3'); t = r.ok ? await r.text() : ''; } catch (e) { return false; }
      const ok = /\blobby\s*:\s*\{/.test(t) && /join_session/.test(t);
      try { localStorage.setItem('d37_join_bridge', JSON.stringify({ id, base: g.base, ok })); } catch (e) {}
      return ok;
    })().catch(() => false);
    bridgeP.then(ok => { st.bridge = ok; });
    return bridgeP;
  }

  // ═══ Настройка «Кто может ко мне присоединиться» ═══
  const WHO = [['all', '🌍 Все'], ['friends', '👥 Друзья'], ['invite', '✉️ По приглашению']];
  const who = () => { const v = S() ? S().get('joinWho') : 'friends'; return WHO.some(w => w[0] === v) ? v : 'friends'; };
  function settingsInit(){
    const s = S(); if (!s || !s.define) return;
    s.define('joinWho', { def: 'friends', list: WHO.map(w => w[0]) });
    try { const K = s._sync && s._sync.KEYS; if (Array.isArray(K) && !K.includes('joinWho')) K.push('joinWho'); } catch (e) {}
    const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const hint = { all: 'Кнопка «Присоединиться» у тебя — у всех на сайте, если комната открытая.', friends: 'Только друзья видят, где ты играешь, и могут зайти к тебе.', invite: 'Никто не видит, в какой ты комнате: зайти можно только по твоей ссылке или коду.' };
    s.addMain && s.addMain({ id: 'joinWho', order: 58, ctx: ['site', 'engine', 'game'], when: () => ON(), html: () => {
      const cur = who();
      return `<div class="gs-row" data-words="присоединиться зайти ко мне комната друзья приглашение лобби игра"><div class="gs-lbl"><b>Кто может ко мне присоединиться</b><small>${esc(hint[cur])}</small></div><div class="gs-ctl"><div class="gs-seg" role="radiogroup" aria-label="Кто может ко мне присоединиться">${WHO.map(([v, t]) => `<button type="button" role="radio" aria-checked="${cur === v}" class="${cur === v ? 'on' : ''}" data-set="joinWho" data-v="${v}">${t}</button>`).join('')}</div></div></div>`;
    } });
    s.on && s.on(ev => { if (ev && (ev.key === 'joinWho' || ev.key === '*')) actChanged(true); });
  }

  // ═══ Состояние ═══
  const st = { cur: null, bridge: null, h: null, target: null, gen: 0, entered: -1, poll: 0, online: false, offAt: 0, idByCode: new Map(), gameBox: null, party: null, sigAt: 0, sig: '' };

  // ═══ Где я играю (presence движка) → код занятия телефона ═══
  function myVis(){
    const c = st.cur;
    if (!c || !c.session || !c.joinable || c.n >= c.max) return '';
    const w = who();
    if (w === 'invite' || c.vis === 'code') return '';
    return c.vis === 'friends' || w === 'friends' ? 'f' : 'o';
  }
  function onPresence(d){
    const g = String(d.game || '');
    if (!g || !gameOk(g)) { if (st.cur) { st.cur = null; actChanged(true); partyTrack(); } return; }
    const code = String(d.session || '').toUpperCase();
    const max = num(d.max, 64) || GAMES[g].max;
    const next = { game: g, session: CODE_RE.test(code) ? code : '', vis: VIS[d.vis] ? String(d.vis) : 'open', n: num(d.n, 999), max, joinable: !!d.joinable };
    const was = st.cur;
    st.cur = next;
    const big = !was || was.session !== next.session || was.vis !== next.vis || was.joinable !== next.joinable || was.game !== next.game;
    actChanged(big);
    if (!was || was.session !== next.session) partyTrack();
    paintGame();
  }
  // занятие сменилось — телефону (он сам решает, когда отправить в «кто онлайн» и друзьям); только число игроков — не чаще раза в 30 с
  function actChanged(big){
    const p = P(); if (!p || !p.setActivity) return;
    if (!big && Date.now() - st.sigAt < 30000) return;
    st.sigAt = Date.now();
    try { p.setActivity({}); } catch (e) {}
  }
  const D_RE = /^([a-z0-9]{2,16})\.([A-HJKMNP-Z2-9]{6})\.([of])\.(\d{1,3})\.(\d{1,3})$/;
  function wrapPhone(){
    const p = P(); if (!p || p._joinWrap || !p.activity || !p.actCode) return false;
    p._joinWrap = 1;
    const oa = p.activity, oc = p.actCode, op = p.actParse, ot = p.actText, oj = p.actJoin, og = p.goJoin;
    p.activity = () => {
      const a = oa();
      const c = st.cur, v = ON() ? myVis() : '';
      if (c && v) { a.d = { g: c.game, c: c.session, v, n: c.n, m: c.max }; delete a.v; delete a.ch; }
      if (c && !a.g && !a.w && !a.s) a.g = 'hub';
      return a;
    };
    // pub — общее «кто онлайн» (видят все): туда «d:» только у открытой для всех комнаты
    p.actCode = (a, pub) => {
      let s = oc(a);
      const d = a && a.d;
      if (d && gameOk(d.g) && CODE_RE.test(d.c) && (d.v === 'o' || (d.v === 'f' && !pub))) s = (s ? s + '|' : '') + 'd:' + [d.g, d.c, d.v, num(d.n, 999), num(d.m, 999)].join('.');
      return s;
    };
    if (op) p.actParse = code => {
      const a = op(code);
      for (const part of String(code || '').slice(0, 200).split('|')) {
        if (part.slice(0, 2) !== 'd:') continue;
        const m = D_RE.exec(part.slice(2));
        if (m && gameOk(m[1])) a.d = { g: m[1], c: m[2], v: m[3], n: +m[4], m: +m[5] };
      }
      return a;
    };
    if (ot) p.actText = a => {
      if (a && a.d && gameOk(a.d.g)) { const G = GAMES[a.d.g]; return G.icon + ' Играет в «' + G.title + '» (' + a.d.n + ' / ' + a.d.m + ')' + (a.c ? ' · 📞 в звонке' : ''); }
      return ot(a);
    };
    if (oj) p.actJoin = a => {
      const t = joinTarget(a);
      return t || oj(a);
    };
    if (og) p.goJoin = (uid, a) => {
      const t = joinTarget(a);
      if (!t) return og(uid, a);
      try { if (p.isOpen && p.isOpen() && p.close) p.close(); } catch (e) {}
      go(t.href);
    };
    return true;
  }
  // можно ли зайти к человеку с таким занятием (для смотрящего): включено, есть сервер и мост, комната не полная
  function joinTarget(a){
    const d = a && a.d;
    if (!ON() || !d || !gameOk(d.g) || !CODE_RE.test(d.c) || !(d.n < d.m) || !server() || st.bridge === false) return null;
    const href = '/hub/play/' + d.g + '/' + d.c;
    return { d37: true, href, hash: href.slice(1), label: '▶ Присоединиться', game: d.g, code: d.c };
  }

  // ═══ Вход в комнату (hub.js зовёт: target при открытии /hub/play/<игра>/<…>, loaded — мир готов) ═══
  // /hub/play/klet2/K7M2QX — по коду; /hub/play/klet2/s-<id> — комната из списка (или новая: создаётся первым вошедшим)
  function parseTarget(game, sub){
    if (!gameOk(game)) return null;
    const s = String(sub || '');
    if (CODE_RE.test(s.toUpperCase()) && s.length === 6) return { game, code: s.toUpperCase() };
    if (s.slice(0, 2) === 's-' && ID_RE.test(s.slice(2))) return { game, id: s.slice(2) };
    return null;
  }
  function setTarget(game, sub){
    st.gen++;
    st.target = ON() ? parseTarget(game, sub) : null;
    st.online = false; st.offAt = 0; st.h = null;
    return st.target;
  }
  function loaded(h){
    if (!h || st.entered === st.gen) return;
    st.h = h;
    const t = st.target;
    if (!t) return;
    st.entered = st.gen;
    const url = server();
    if (!url) { gameToast('Сервер игр недоступен — попробуй позже. Пока играешь с ботами'); return; }
    if (!h.lobby || typeof h.lobby.join !== 'function') { gameToast('Комнаты появятся с новой версией игры — пока играешь с ботами'); return; }
    const rj = ss.get('d37join_rj');
    try {
      if (rj && rj.key && ((t.id && rj.id === t.id) || (t.code && rj.code === t.code))) h.lobby.rejoinKey(rj.key >>> 0);
      if (t.id) h.lobby.join(url, t.game, t.id, ''); else h.lobby.joinCode(url, t.code, '');
    } catch (e) { report('join', e && e.message); gameToast('Не получилось войти в комнату — играешь с ботами'); return; }
    clearInterval(st.poll);
    st.poll = setInterval(pollState, 1500);
  }
  function pollState(){
    const h = st.h;
    if (!h || !h.lobby) { clearInterval(st.poll); st.poll = 0; return; }
    let s = null; try { s = h.lobby.state(); } catch (e) {}
    const t = st.target;
    if (s && s.online) {
      st.online = true; st.offAt = 0; dropBanner(false);
      const code = String(s.code || '').toUpperCase();
      if (t && (s.key >>> 0)) ss.set('d37join_rj', { g: t.game, id: t.id || st.idByCode.get(code) || '', code: CODE_RE.test(code) ? code : (t.code || ''), key: s.key >>> 0, t: Date.now() });
      hostApply(s);
      st.last = s;
      paintGame();
    } else if (st.online) {
      if (!st.offAt) st.offAt = Date.now();
      else if (Date.now() - st.offAt > 4000) dropBanner(true);
    }
  }
  // создатель комнаты: название, кто может войти, сколько людей — когда сервер сделал его хозяином
  function hostApply(s){
    const t = st.target, pend = ss.get('d37join_host');
    if (!t || !pend || !t.id || pend.id !== t.id || s.host !== s.me || !st.h) return;
    ss.set('d37join_host', null);
    try {
      st.h.lobby.meta(t.game, pend.vis, t.game, '-', pend.ages, pend.name);
      if (pend.max) st.h.lobby.limit(t.game, pend.max);
      st.meta = { vis: pend.vis, ages: pend.ages, name: pend.name };
    } catch (e) { report('meta', e && e.message); }
  }
  function rejoinNow(){
    const h = st.h, t = st.target, url = server(), rj = ss.get('d37join_rj');
    if (!h || !t || !url) return;
    try {
      if (rj && rj.key) h.lobby.rejoinKey(rj.key >>> 0);
      if (rj && rj.id) h.lobby.join(url, t.game, rj.id, ''); else if (t.id) h.lobby.join(url, t.game, t.id, ''); else h.lobby.joinCode(url, (rj && rj.code) || t.code, '');
      st.offAt = Date.now();
      gameToast('Возвращаемся в комнату…');
    } catch (e) { gameToast('Не получилось — попробуй позже'); }
  }
  function closed(){
    clearInterval(st.poll); st.poll = 0;
    // вышел сам («← На сайт», другой раздел) — из комнаты насовсем, «Вернуться в игру» не предлагаем; перезагрузка и обрыв сюда не попадают
    if (st.h && st.target) { try { st.h.lobby && st.h.lobby.leave(st.target.game); } catch (e) {} ss.set('d37join_rj', null); }
    st.h = null; st.target = null; st.online = false; st.gameBox = null; st.last = null;
    if (st.cur) { st.cur = null; actChanged(true); partyTrack(); }
  }
  function onMode(d){
    if (!d || typeof d !== 'object') return;
    if (d.kind === 'presence') onPresence(d);
  }
  function joinError(){ if (st.target) gameToast('Не получилось войти в комнату — играешь с ботами'); }

  // ═══ В игре: кнопка 👥 у ⏸ — комната, код, «Пригласить», хозяину — кто может войти и сколько людей ═══
  function mountGame(box){
    if (!ON() || !box) return;
    st.gameBox = box;
    const b = btn('jn-gbtn', '👥', () => roomSheet());
    b.title = 'Комната и приглашение'; b.setAttribute('aria-label', 'Комната и приглашение');
    b.hidden = true;
    box.appendChild(b);
  }
  function paintGame(){
    const box = st.gameBox; if (!box) return;
    const b = box.querySelector('.jn-gbtn'); if (b) b.hidden = !(st.online && st.cur && st.cur.session);
    const sh = box.querySelector('.jn-room'); if (sh && sh.fill) sh.fill();
  }
  function gameToast(t){
    const box = st.gameBox; if (!box) return;
    const x = el('div', 'hub-gtoast', t); box.appendChild(x); setTimeout(() => x.remove(), 3600);
  }
  function dropBanner(on){
    const box = st.gameBox; if (!box) return;
    let d = box.querySelector('.jn-drop');
    if (!on) { if (d) d.remove(); return; }
    if (d) return;
    d = el('div', 'jn-drop');
    d.append(el('span', '', '📡 Связь с комнатой пропала'), btn('jn-dropb', 'Вернуться', () => rejoinNow()));
    box.appendChild(d);
  }
  // лист поверх игры или страницы (те же стили, что листы платформы)
  function sheet(host, title, build, cls){
    const page = host || doc.getElementById('hub-page') || doc.body;
    page.querySelector('.hub-sheet-bg.jn-bg')?.remove();
    const bg = el('div', 'hub-sheet-bg jn-bg'), box = el('div', 'hub-sheet' + (cls ? ' ' + cls : ''));
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', title);
    const close = () => { bg.remove(); doc.removeEventListener('keydown', esc, true); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    const x = btn('hub-sheet-x', '✕', close); x.setAttribute('aria-label', 'Закрыть');
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    doc.addEventListener('keydown', esc, true);
    box.append(x, el('h2', 'hub-sheet-h', title));
    build(box, close);
    bg.appendChild(box); page.appendChild(bg);
    return box;
  }
  function seg(name, opts, cur, on){
    const g = el('div', 'jn-seg'); g.setAttribute('role', 'radiogroup'); g.setAttribute('aria-label', name);
    for (const [v, t] of opts) {
      const b = btn(v === cur ? 'on' : '', t, () => { g.querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); on(v); });
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(v === cur)); b.dataset.v = v;
      g.appendChild(b);
    }
    return g;
  }
  function roomSheet(){
    const c = st.cur, t = st.target; if (!c || !t) return;
    const G = GAMES[c.game];
    sheet(st.gameBox, G.icon + ' Комната', (box) => {
      box.classList.add('jn-room');
      const info = el('p', 'hub-sheet-p jn-rinfo');
      const codeRow = el('div', 'jn-code');
      const code = el('b', 'jn-codev', c.session || '—');
      const cp = btn('hub-btn hub-btn3', '📋 Код', () => copy(st.cur && st.cur.session, 'Код скопирован'));
      codeRow.append(el('span', 'jn-codel', 'Код комнаты'), code, cp);
      box.append(info, codeRow);
      box.appendChild(btn('hub-btn', '📨 Пригласить', () => inviteSheet()));
      const hostBox = el('div', 'jn-hostbox');
      box.appendChild(hostBox);
      box.appendChild(btn('hub-btn hub-btn3', '🚪 Выйти из комнаты', () => { ss.set('d37join_rj', null); go('/hub/lobby/' + c.game); }));
      box.fill = () => {
        const cc = st.cur || c, s = st.last;
        info.textContent = 'Игроков: ' + cc.n + ' / ' + cc.max + ' · войти могут: ' + (VIS[cc.vis] || 'все').toLowerCase() + (who() === 'invite' ? ' · ты скрыт(а) — только по приглашению' : '');
        code.textContent = cc.session || '—';
        const host = s && s.host === s.me;
        if (host && !hostBox.childElementCount) {
          hostBox.append(el('b', 'jn-lbl', 'Ты хозяин комнаты'));
          hostBox.append(el('small', 'jn-muted', 'Кто может войти'), seg('Кто может войти', [['open', '🌍 Все'], ['friends', '👥 Друзья'], ['code', '🔒 По коду']], cc.vis, v => hostMeta({ vis: v })));
          hostBox.append(el('small', 'jn-muted', 'Сколько игроков'), seg('Сколько игроков', [4, 8, 12, 16].map(n => [String(n), String(n)]), String(cc.max), v => { try { st.h.lobby.limit(c.game, +v); } catch (e) {} }));
        }
        hostBox.hidden = !host;
      };
      box.fill();
    });
  }
  function hostMeta(patch){
    const t = st.target; if (!t || !st.h) return;
    const m = Object.assign({ vis: (st.cur && st.cur.vis) || 'open', ages: 'all', name: '' }, st.meta || {}, patch);
    st.meta = m;
    try { st.h.lobby.meta(t.game, m.vis, t.game, '-', m.ages, m.name || defName()); } catch (e) {}
  }
  const defName = () => 'Комната ' + String(prof() && prof().nick || 'игрока').slice(0, 20);
  async function copy(text, ok){
    if (!text) return;
    try { await navigator.clipboard.writeText(text); toast(ok); } catch (e) { toast(text); }
  }
  function toast(t){
    if (st.gameBox && st.gameBox.isConnected) return gameToast(t);
    const page = doc.getElementById('hub-page') || doc.body;
    const x = el('div', 'hub-toast', t); page.appendChild(x); setTimeout(() => x.remove(), 3500);
  }
  // «Пригласить»: ссылка (скопировать / поделиться), другу в личку, в открытый чат — своим путём сообщений сайта (человек сам жмёт «Отправить»)
  function inviteLink(){ const c = st.cur; return c && c.session ? abs('/hub/play/' + c.game + '/' + c.session) : ''; }
  function inviteText(){ const c = st.cur; return c ? '🎮 Заходи ко мне в «' + GAMES[c.game].title + '»! ' + inviteLink() : ''; }
  function inviteSheet(){
    const link = inviteLink(); if (!link) return;
    sheet(st.gameBox, '📨 Пригласить', box => {
      box.appendChild(el('p', 'hub-sheet-p', 'По ссылке игра откроется сразу в твоей комнате. Код можно назвать голосом.'));
      const l = el('div', 'jn-link', link); box.appendChild(l);
      const row1 = el('div', 'jn-acts');
      row1.appendChild(btn('hub-btn', '📋 Скопировать ссылку', () => copy(link, 'Ссылка скопирована — отправь другу')));
      if (navigator.share) row1.appendChild(btn('hub-btn hub-btn3', '📤 Поделиться', async () => { try { await navigator.share({ title: 'Играем вместе', text: inviteText(), url: link }); } catch (e) {} }));
      box.appendChild(row1);
      const row2 = el('div', 'jn-acts');
      if (me() && P() && P().friends) row2.appendChild(btn('hub-btn hub-btn3', '✉️ Другу в личку', () => friendPick()));
      if (composer()) row2.appendChild(btn('hub-btn hub-btn3', '💬 В открытый чат', () => { putDraft(composer(), inviteText()); toast('Приглашение в поле сообщения — нажми «Отправить»'); }));
      if (row2.childElementCount) box.appendChild(row2);
    });
  }
  // поле сообщения ленты (msgview: личка в телефоне или канал чата), видимое на странице
  function composer(){
    const list = [...doc.querySelectorAll('textarea.mv-in')].filter(t => t.offsetParent !== null && !t.disabled);
    return list[list.length - 1] || null;
  }
  function putDraft(t, text){
    if (!t) return;
    t.value = (t.value ? t.value.trimEnd() + ' ' : '') + text;
    t.dispatchEvent(new Event('input', { bubbles: true }));
    try { t.focus({ preventScroll: true }); } catch (e) {}
  }
  async function friendPick(){
    const p = P(); if (!p) return;
    const f = await p.friends(false).catch(() => null);
    const ids = (f && f.list || []).slice(0, 60);
    sheet(st.gameBox, '✉️ Кому?', (box, close) => {
      if (!ids.length) { box.appendChild(el('p', 'hub-sheet-p', 'Друзей пока нет — скопируй ссылку и отправь как удобно.')); return; }
      const lst = el('div', 'jn-list');
      for (const id of ids) {
        const pr = p.prof(id) || {};
        const r = btn('jn-row jn-rowb', '', async () => {
          close();
          const text = inviteText();
          try { if (p.open) p.open('msgs/' + id); } catch (e) {}
          for (let i = 0; i < 30; i++) { await new Promise(res => setTimeout(res, 100)); const t = composer(); if (t) { putDraft(t, text); toast('Приглашение в поле сообщения — нажми «Отправить»'); return; } }
          copy(inviteLink(), 'Ссылка скопирована — вставь её в сообщение');
        });
        r.append(el('span', 'jn-ic', '👤'), el('b', 'jn-name', String(pr.nick || 'друг').slice(0, 24)));
        lst.appendChild(r);
      }
      box.appendChild(lst);
    });
  }

  // ═══ Список комнат: в меню /hub (коротко) и /hub/lobby[/игра] (целиком) ═══
  // o: { game, full }
  function lobby(host, o){
    o = o || {};
    const sec = el('section', 'jn' + (o.full ? ' jn-full' : ''));
    sec.setAttribute('aria-label', 'Комнаты');
    sec.hidden = true;   // покажем, когда узнаем, что мост движка есть
    host.appendChild(sec);
    bridge().then(ok => { if (!ok || !sec.isConnected) { sec.remove(); return; } sec.hidden = false; build(sec, o); });
    return sec;
  }
  function build(sec, o){
    const f = { game: gameOk(o.game) ? o.game : '', room: false, friends: false };
    const head = el('div', 'jn-head');
    head.append(el('h2', 'jn-h', o.full ? '🟢 Открытые комнаты' : '👥 Играть с людьми'));
    const reg = el('span', 'jn-reg', '');
    head.appendChild(reg);
    if (!o.full) { const a = el('a', 'jn-all', 'Все комнаты →'); a.href = '/hub/lobby' + (f.game ? '/' + f.game : ''); head.appendChild(a); }
    sec.appendChild(head);
    const back = el('div', 'jn-back'); back.hidden = true; sec.appendChild(back);
    const acts = el('div', 'jn-acts');
    const qb = btn('hub-btn jn-quick', '⚡ Быстрая игра', () => quickPlay(f.game || 'klet2', qb));
    const cb = btn('hub-btn hub-btn3 jn-create', '＋ Создать комнату', () => createSheet(f.game || 'klet2'));
    const form = el('form', 'jn-codef');
    const inp = el('input', 'jn-codei'); inp.type = 'text'; inp.maxLength = 6; inp.placeholder = 'Код комнаты'; inp.autocomplete = 'off'; inp.spellcheck = false; inp.setAttribute('aria-label', 'Код комнаты из 6 знаков'); inp.setAttribute('autocapitalize', 'characters');
    const ib = el('button', 'hub-btn hub-btn3', 'Войти'); ib.type = 'submit';
    form.append(inp, ib);
    inp.addEventListener('input', () => { const v = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); if (v !== inp.value) inp.value = v; });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = inp.value.trim().toUpperCase();
      if (!CODE_RE.test(v)) { toast('Код — 6 знаков: буквы и цифры (без O, I, L, 0, 1)'); inp.focus(); return; }
      if (!server()) { toast('Сервер игр недоступен — попробуй позже'); return; }
      go('/hub/play/' + (f.game || 'klet2') + '/' + v);
    });
    acts.append(qb, cb, form);
    sec.appendChild(acts);
    const filt = el('div', 'jn-filt');
    const gsel = el('select', 'jn-gsel'); gsel.setAttribute('aria-label', 'Игра');
    gsel.appendChild(new Option('Все игры', ''));
    for (const [id, G] of Object.entries(GAMES)) gsel.appendChild(new Option(G.icon + ' ' + G.title, id));
    gsel.value = f.game;
    gsel.addEventListener('change', () => { f.game = gsel.value; refresh(); });
    const chip = (text, key) => {
      const b = btn('jn-chip', text, () => { f[key] = !f[key]; b.classList.toggle('on', f[key]); b.setAttribute('aria-pressed', String(f[key])); paint(); });
      b.setAttribute('aria-pressed', 'false'); b.dataset.f = key; return b;
    };
    const rf = btn('jn-chip jn-rf', '↻', () => refresh()); rf.title = 'Обновить'; rf.setAttribute('aria-label', 'Обновить список');
    filt.append(gsel, chip('Есть место', 'room'), chip('👥 Друзья внутри', 'friends'), rf);
    sec.appendChild(filt);
    const box = el('div', 'jn-list'); box.setAttribute('aria-live', 'polite');
    sec.appendChild(box);
    if (o.full) sec.appendChild(partyBox());
    let rows = null, fr = new Map(), busy = false, timer = 0;
    const state = (t, cls) => { box.textContent = ''; box.appendChild(el('div', 'jn-empty' + (cls ? ' ' + cls : ''), t)); };
    state('Ищем комнаты…');
    async function refresh(){
      if (!sec.isConnected) { clearInterval(timer); return; }
      if (busy) return; busy = true;
      try {
        if (!server()) { rows = null; offline(true); state('Сервер игр недоступен — попробуй позже.', 'jn-off'); return; }
        const [l, friends] = await Promise.all([list(f.game), friendsIn()]);
        if (!sec.isConnected) return;
        fr = friends;
        if (!l) { rows = null; offline(true); state('Сервер игр недоступен — попробуй позже.', 'jn-off'); return; }
        offline(false);
        rows = l;
        l.forEach(r => { if (r.code) st.idByCode.set(r.code, r.id); });
        const rg = [...new Set(l.map(r => r.region).filter(Boolean))];
        reg.textContent = rg.length ? '📍 ' + rg.slice(0, 2).join(', ') : '';
        paint();
        backOffer(back, l);
      } finally { busy = false; }
    }
    function offline(on){ qb.disabled = on; cb.disabled = on; ib.disabled = on; sec.classList.toggle('jn-isoff', on); }
    function paint(){
      if (!rows) return;
      // комнаты друзей, которых нет в общем списке (только для друзей / открытые, но ещё не попали) — с замком
      const all = rows.slice();
      for (const [code, x] of fr) if (!all.some(r => r.code === code) && (!f.game || x.g === f.game)) all.push({ game: x.g, id: '', code, vis: x.v === 'o' ? 'open' : 'friends', players: x.n, max: x.m, mode: '', map: '', name: 'Комната ' + x.nicks[0], region: '', full: x.n >= x.m, friendsOnly: x.v !== 'o' });
      let show = all.filter(r => (!f.room || !r.full) && (!f.friends || fr.has(r.code)));
      show.sort((a, b) => (fr.has(b.code) ? 1 : 0) - (fr.has(a.code) ? 1 : 0) || b.players - a.players);
      const limit = o.full ? 100 : 5;
      box.textContent = '';
      if (!show.length) {
        state(all.length ? 'Под фильтр ничего не подошло — сними галочки.' : 'Пока никто не играет. Нажми «Быстрая игра» — комната создастся сама, а боты поиграют с тобой, пока не придут люди.');
        return;
      }
      for (const r of show.slice(0, limit)) box.appendChild(rowEl(r, fr.get(r.code)));
      if (!o.full && show.length > limit) { const a = el('a', 'jn-more', 'Ещё ' + (show.length - limit) + ' →'); a.href = '/hub/lobby' + (f.game ? '/' + f.game : ''); box.appendChild(a); }
    }
    refresh();
    timer = setInterval(() => { if (!sec.isConnected) { clearInterval(timer); return; } if (!doc.hidden) refresh(); }, 10000);
    sec._refresh = refresh;
  }
  function rowEl(r, friend){
    const G = GAMES[r.game];
    const d = el('div', 'jn-row' + (r.full ? ' jn-fullrow' : ''));
    d.dataset.code = r.code; d.dataset.id = r.id;
    d.appendChild(el('span', 'jn-ic', G.icon));
    const m = el('span', 'jn-main');
    const nm = el('b', 'jn-name', (r.vis !== 'open' || r.friendsOnly ? '🔒 ' : '') + (r.name || 'Комната'));
    const sub = el('small', 'jn-sub', [G.title, r.mode && r.mode !== r.game ? r.mode : '', r.map && r.map !== '-' ? 'карта ' + r.map : '', r.ages === 'kids' ? 'до 18' : r.ages === 'adults' ? '18+' : '', r.region ? '📍 ' + r.region : ''].filter(Boolean).join(' · '));
    m.append(nm, sub);
    if (friend) m.appendChild(el('small', 'jn-fr', '👥 ' + friend.nicks.slice(0, 2).join(', ') + (friend.nicks.length > 2 ? ' и ещё ' + (friend.nicks.length - 2) : '') + ' внутри'));
    d.appendChild(m);
    d.appendChild(el('span', 'jn-n', r.players + ' / ' + r.max));
    const b = btn('hub-btn jn-go', r.full ? 'Полная' : 'Войти', () => go('/hub/play/' + r.game + '/' + (r.id ? 's-' + r.id : r.code)));
    b.disabled = r.full;
    if (!r.id && !r.code) b.disabled = true;
    d.appendChild(b);
    return d;
  }
  // друзья в комнатах (из их занятия: «d:» — только то, что они разрешили) → код комнаты → { g, v, n, m, nicks }
  async function friendsIn(){
    const out = new Map(), p = P();
    if (!me() || !p || !p.friends || !p.friendStatus) return out;
    try {
      const f = await p.friends(false); const ids = (f && f.list || []).slice(0, 200);
      if (!ids.length) return out;
      const sts = await p.friendStatus(ids);
      for (const [id, s] of sts) {
        const d = s && s.a && s.a.d; if (!d || !gameOk(d.g) || !CODE_RE.test(d.c)) continue;
        const nick = String((p.prof(id) || {}).nick || 'друг').slice(0, 24);
        const x = out.get(d.c) || { g: d.g, v: d.v, n: d.n, m: d.m, nicks: [] };
        x.nicks.push(nick); out.set(d.c, x);
      }
    } catch (e) {}
    return out;
  }
  async function quickPlay(game, b){
    if (!server()) { toast('Сервер игр недоступен — попробуй позже'); return; }
    if (b) b.disabled = true;
    const q = await quick(game);
    if (b) b.disabled = false;
    if (!q) { toast('Сервер игр недоступен — попробуй позже'); return; }
    go('/hub/play/' + game + '/s-' + q.id);
  }
  const newId = () => { const A = 'abcdefghijkmnpqrstuvwxyz23456789', b = new Uint8Array(8); try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < 8; i++) b[i] = Math.random() * 256 | 0; } return Array.from(b, x => A[x % A.length]).join(''); };
  function createSheet(game){
    if (!server()) { toast('Сервер игр недоступен — попробуй позже'); return; }
    const G = GAMES[game];
    const o = { vis: 'open', max: 8, ages: 'all' };
    sheet(null, '＋ Новая комната', (box, close) => {
      box.appendChild(el('p', 'hub-sheet-p jn-muted', G.icon + ' ' + G.title + ' · пока людей мало, с тобой играют боты'));
      const nl = el('label', 'jn-field'); nl.appendChild(el('small', 'jn-muted', 'Название'));
      const name = el('input', 'jn-name-in'); name.type = 'text'; name.maxLength = 24; name.placeholder = defName(); name.autocomplete = 'off';
      nl.appendChild(name); box.appendChild(nl);
      box.append(el('small', 'jn-muted', 'Кто может войти'), seg('Кто может войти', [['open', '🌍 Все'], ['friends', '👥 Друзья'], ['code', '🔒 По коду']], o.vis, v => { o.vis = v; }));
      box.append(el('small', 'jn-muted', 'Сколько игроков'), seg('Сколько игроков', [4, 8, 12, 16].map(n => [String(n), String(n)]), String(o.max), v => { o.max = +v; }));
      box.append(el('small', 'jn-muted', 'Возраст'), seg('Возраст', [['all', 'Для всех'], ['kids', 'Только до 18']], o.ages, v => { o.ages = v; }));
      const go1 = btn('hub-btn jn-mk', '▶ Создать и играть', () => {
        const id = newId();
        const nm = (String(name.value || '').replace(/[\u0000-\u001f\u007f;]/g, ' ').trim() || defName()).slice(0, 24);
        ss.set('d37join_host', { id, vis: o.vis, max: o.max, ages: o.ages, name: nm, t: Date.now() });
        close();
        go('/hub/play/' + game + '/s-' + id);
      });
      box.appendChild(go1);
    });
  }
  // «Вернуться в игру»: была комната в этой вкладке (обрыв, перезагрузка) и она ещё есть
  function backOffer(back, rows){
    const rj = ss.get('d37join_rj');
    back.textContent = ''; back.hidden = true;
    if (!rj || !gameOk(rj.g) || Date.now() - (+rj.t || 0) > 15 * 60000 || st.target) return;
    const alive = rows.some(r => (rj.id && r.id === rj.id) || (rj.code && r.code === rj.code)) || Date.now() - rj.t < 3 * 60000;
    if (!alive) return;
    back.hidden = false;
    back.append(el('span', '', '🔁 Ты играл(а) в комнате ' + (rj.code || '') + ' — место ещё держится'));
    back.appendChild(btn('hub-btn jn-backb', 'Вернуться в игру', () => go('/hub/play/' + rj.g + '/' + (rj.id ? 's-' + rj.id : rj.code))));
    const x = btn('jn-chip', '✕', () => { ss.set('d37join_rj', null); back.hidden = true; }); x.setAttribute('aria-label', 'Не возвращаться');
    back.appendChild(x);
  }

  // ═══ Группа «Идём вместе» (presence-канал party-<id>, без базы) ═══
  // Ведущий — тот, кто собрал группу (lead). Он вошёл в комнату — у остальных с «Идём вместе» игра открывается в той же комнате.
  // Отметку шлём не чаще раза в 7 с (предел Supabase: 5 presence за 30 с).
  const PARTY_RE = /^[a-z0-9]{8}$/;
  const pkey = (() => { let k = ''; try { k = sessionStorage.getItem('d37join_pk') || ''; if (!k) { k = newId(); sessionStorage.setItem('d37join_pk', k); } } catch (e) { k = newId(); } return k; })();
  function partyChannel(id){
    if (root.__d37PartyChannel) return root.__d37PartyChannel(id, pkey);   // тест: свой канал
    if (typeof sbClient === 'undefined' || !sbClient) return null;
    return sbClient.channel('party-' + id, { config: { presence: { key: pkey } } });
  }
  function partyJoin(id, lead){
    if (!ON() || !PARTY_RE.test(id)) return false;
    if (st.party && st.party.id === id) return true;
    partyLeave();
    const ch = partyChannel(id); if (!ch) { toast('Группы работают, когда сайт на связи'); return false; }
    const P0 = { id, lead: !!lead, ch, follow: true, members: [], lastS: '', trackAt: 0, trackT: 0 };
    st.party = P0;
    ss.set('d37join_party', { id, lead: !!lead });
    ch.on('presence', { event: 'sync' }, () => partySync());
    ch.subscribe(status => { if (status === 'SUBSCRIBED') { P0.ok = true; partyTrack(true); } });
    partyPaint();
    return true;
  }
  function partyLeave(){
    const p = st.party; if (!p) return;
    st.party = null; ss.set('d37join_party', null);
    clearTimeout(p.trackT);
    try { p.ch.untrack && p.ch.untrack(); } catch (e) {}
    try { if (typeof sbClient !== 'undefined' && sbClient && sbClient.removeChannel && !root.__d37PartyChannel) sbClient.removeChannel(p.ch); else p.ch.unsubscribe && p.ch.unsubscribe(); } catch (e) {}
    partyPaint();
  }
  function partyMeta(){
    const p = st.party, c = st.cur;
    return { k: pkey, nick: String(prof() && prof().nick || 'Гость').slice(0, 24), lead: !!(p && p.lead), s: c && c.session ? c.game + '.' + c.session : '' };
  }
  function partyTrack(now){
    const p = st.party; if (!p || !p.ok) return;
    clearTimeout(p.trackT);
    const wait = now ? 0 : Math.max(0, 7000 - (Date.now() - p.trackAt));
    p.trackT = setTimeout(() => { if (st.party !== p) return; p.trackAt = Date.now(); try { const r = p.ch.track(partyMeta()); r && r.catch && r.catch(() => {}); } catch (e) {} }, wait);
  }
  function partySync(){
    const p = st.party; if (!p) return;
    let s = {}; try { s = p.ch.presenceState() || {}; } catch (e) {}
    const mem = [];
    for (const metas of Object.values(s)) {
      const m = (metas || [])[metas.length - 1]; if (!m) continue;
      const sp = String(m.s || '').split('.');
      mem.push({ k: String(m.k || '').slice(0, 16), nick: clean(m.nick || 'игрок').slice(0, 24), lead: !!m.lead, g: gameOk(sp[0]) ? sp[0] : '', c: CODE_RE.test(sp[1] || '') ? sp[1] : '' });
    }
    p.members = mem;
    partyPaint();
    // за ведущим: он в комнате, я — нет (или в другой)
    const L = mem.find(m => m.lead && m.k !== pkey);
    if (!L || !L.c || !p.follow || p.lead) return;
    const sig = L.g + '.' + L.c;
    if (sig === p.lastS) return;
    p.lastS = sig;
    if (st.cur && st.cur.session === L.c) return;
    toast('👥 Идём за ведущим в комнату ' + L.c);
    go('/hub/play/' + L.g + '/' + L.c);
  }
  function partyBox(){
    const b = el('div', 'jn-party');
    b.dataset.party = '1';
    setTimeout(partyPaint, 0);
    return b;
  }
  function partyPaint(){
    for (const b of doc.querySelectorAll('[data-party]')) {
      b.textContent = '';
      const p = st.party;
      b.appendChild(el('b', 'jn-lbl', '👥 Группа'));
      if (!p) {
        b.appendChild(el('small', 'jn-muted', 'Соберитесь вместе: ведущий заходит в комнату — остальные попадают туда же, в любой игре.'));
        b.appendChild(btn('hub-btn hub-btn3 jn-pmk', 'Собрать группу', () => { const id = newId(); if (partyJoin(id, true)) go('/hub/party/' + id); }));
        continue;
      }
      const lst = el('div', 'jn-pmem');
      for (const m of p.members) lst.appendChild(el('span', 'jn-pm' + (m.lead ? ' lead' : ''), (m.lead ? '⭐ ' : '') + m.nick + (m.c ? ' · в комнате' : '')));
      if (!p.members.length) lst.appendChild(el('small', 'jn-muted', 'Подключаемся…'));
      b.appendChild(lst);
      const row = el('div', 'jn-acts');
      row.appendChild(btn('hub-btn hub-btn3', '📋 Позвать в группу', () => copy(abs('/hub/party/' + p.id), 'Ссылка на группу скопирована')));
      if (!p.lead) {
        const f = btn('jn-chip' + (p.follow ? ' on' : ''), 'Идём вместе', () => { p.follow = !p.follow; p.lastS = ''; partyPaint(); if (p.follow) partySync(); });
        f.setAttribute('aria-pressed', String(p.follow)); f.dataset.follow = '1';
        row.appendChild(f);
      }
      row.appendChild(btn('jn-chip', 'Выйти', () => partyLeave()));
      b.appendChild(row);
    }
  }

  // ═══ «▶ Присоединиться» в списках сайта: друзья (friends.js), голосовой канал (calls.js) — [data-juid] / ник со [data-mini-uid] ═══
  // плитки голосового перерисовываются часто: известное за последние 20 с ставим сразу (без мигания), свежее — через 250 мс
  const decQ = new Set(), decCache = new Map(); let decT = 0;
  const decNodes = r => r && r.isConnected ? [...r.querySelectorAll('[data-juid], .role-result-nick[data-mini-uid]')] : [];
  const decId = n => { const id = n.dataset.juid || n.dataset.miniUid; return /^[0-9a-f-]{36}$/.test(id || '') ? id : ''; };
  function decApply(n, c){
    const host = n.closest('.role-result-row, .vc-tile, .jn-juser') || n.parentElement; if (!host) return;
    const old = host.querySelector(':scope > .jn-jbtn');
    if (!c || !c.t) { if (old) old.remove(); return; }
    if (old && old.dataset.to === c.t.href) return;
    if (old) old.remove();
    const b = btn('jn-jbtn', '▶ Присоединиться', ev => { ev.stopPropagation(); ev.preventDefault(); go(c.t.href); });
    b.dataset.to = c.t.href; b.title = c.text || '';
    host.appendChild(b);
  }
  function decorate(rootEl){
    if (!ON() || !rootEl || !server() || st.bridge === false) return;
    let stale = false;
    for (const n of decNodes(rootEl)) { const id = decId(n); if (!id) continue; const c = decCache.get(id); if (c) decApply(n, c); if (!c || Date.now() - c.at > 20000) stale = true; }
    if (!stale) return;
    decQ.add(rootEl);
    clearTimeout(decT);
    decT = setTimeout(decorateNow, 250);
  }
  async function decorateNow(){
    const roots = [...decQ]; decQ.clear();
    const p = P(); if (!p || !p.friendStatus || !p.actJoin) return;
    if (!(await bridge())) return;
    const nodes = []; for (const r of roots) nodes.push(...decNodes(r));
    const ids = [...new Set(nodes.map(decId).filter(Boolean))];
    if (!ids.length) return;
    const sts = await p.friendStatus(ids).catch(() => null); if (!sts) return;
    for (const id of ids) { const s = sts.get(id), t = s && s.a ? joinTarget(s.a) : null; decCache.set(id, { at: Date.now(), t, text: t && p.actText ? p.actText(s.a) : '' }); }
    if (decCache.size > 300) decCache.delete(decCache.keys().next().value);
    for (const r of roots) for (const n of decNodes(r)) { const id = decId(n); if (id) decApply(n, decCache.get(id)); }
  }
  // чужой профиль: «Играет в … (n / max)» и «Присоединиться» (profile.js не трогаем — вставка по переходу, как карточка платформы)
  async function profileJoin(){
    if (!ON() || typeof currentRoute !== 'function' || currentRoute() !== 'profile') return;
    const host = doc.getElementById('profileContent'); if (!host) return;
    host.querySelector('.jn-pjoin')?.remove();
    const param = typeof currentRouteParam === 'function' ? currentRouteParam() : null, u = me();
    if (!param || !/^[0-9a-f-]{36}$/.test(param) || (u && u.id === param) || !server()) return;
    const p = P(); if (!p || !p.friendStatus) return;
    if (!(await bridge())) return;
    const sts = await p.friendStatus([param]).catch(() => null);
    const s = sts && sts.get(param), t = s && s.a ? joinTarget(s.a) : null;
    if (!t || currentRoute() !== 'profile' || currentRouteParam() !== param || host.querySelector('.jn-pjoin')) return;
    const card = el('div', 'jn-pjoin');
    card.appendChild(el('span', 'jn-ic', GAMES[t.game].icon));
    card.appendChild(el('span', 'jn-main', p.actText ? p.actText(s.a) : 'Играет'));
    card.appendChild(btn('hub-btn', '▶ Присоединиться', () => go(t.href)));
    host.prepend(card);
  }

  // ═══ Старт ═══
  function init(){
    settingsInit();
    if (!wrapPhone()) setTimeout(wrapPhone, 1500);
    const pp = ss.get('d37join_party');
    if (pp && PARTY_RE.test(pp.id || '')) setTimeout(() => partyJoin(pp.id, !!pp.lead), 1200);
    if (ON() && server()) setTimeout(() => bridge(), 4000);   // для кнопок «Присоединиться» (без адреса сервера — ничего не качаем)
    root.addEventListener('d37:route', () => setTimeout(profileJoin, 900));
    root.addEventListener('load', () => setTimeout(profileJoin, 1800));
  }
  if (doc) { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init(); }

  root.D37Join = { ON, GAMES, server, list, quick, bridge, lobby, setTarget, loaded, closed, onMode, joinError, mountGame, decorate, profileJoin, partyJoin, partyLeave,
    parseTarget, joinTarget, who, inviteLink, roomSheet, inviteSheet, createSheet, get state(){ return st; } };
})();
