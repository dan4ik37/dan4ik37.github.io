// ═══════════════════════════════════════
//  🎮 ПЛАТФОРМА D37 — главное меню «как в Роблоксе, только лучше» + игра нового движка внутри сайта (T-159 первая версия, EP7 13.11)
// ═══════════════════════════════════════
// Раздел /hub (PAGES.hub, js/ui/router.js): плитки «Играть» (долина: добыча, крафт, стройка — сцена valley), «Творческий режим» (/hub/creative — отдельный мир, свободный полёт; T-163), «Гардероб» (лёгкий: только персонаж, без мира; T-163), «Мир Денчика»,
// «Студия», «Мини-игры» (раздел игр сайта — одной плиткой, сам раздел не трогаем), «Позвать друга». /hub/play и /hub/wardrobe — игра
// поверх сайта: экран загрузки с настоящим прогрессом, холст движка, «← На сайт», ⛶ на весь экран.
// Движок (Rust → wasm) — папка HUB_ENGINE (js/core/config.js; сейчас /d37/ — там же тестовая страница движка). С ним говорит только
// engine-host.js из той же папки (мост v1, crates/d37-web/src/bridge.rs): сюда — кто играет (id, ник, мир для детей), образ,
// гардероб; оттуда — готов, мир загружен, образ поменялся, пора сохранить, события («приземлился», «поплыл»), ошибки.
// Образ: D37Settings 'd37body' / 'd37look' (js/core/settings.js) — вошёл: едет в аккаунт (privacy.sql prefs_set), гость: только браузер.
// Мир: байты сохранения движка (D37S v1: место, время, образ + разделы игры) — IndexedDB 'd37-hub' (браузер главный), вошёл — копия в
// облаке D37Cloud (ugc.sql cloud_saves, игра 'engine', мир 'planet'; пределы — cloud_rule на сервере). Ошибки движка — d37Err (errlog).
// Откат — HUB_ON = false. Тест: node scripts/hub-e2e.cjs (настоящий Chrome: меню, игра, образ после перезагрузки — гость и вход).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37Hub) return;
  const ON = () => { try { return typeof HUB_ON === 'undefined' || !!HUB_ON; } catch (e) { return true; } };
  const BASE = () => { try { return typeof HUB_ENGINE === 'string' && /^\/[a-z0-9/_-]*\/$/i.test(HUB_ENGINE) ? HUB_ENGINE : '/d37/'; } catch (e) { return '/d37/'; } };
  const $ = id => document.getElementById(id);
  const me = () => { try { return typeof currentUser !== 'undefined' && currentUser ? currentUser : null; } catch (e) { return null; } };
  const prof = () => { try { return typeof currentProfile !== 'undefined' && currentProfile ? currentProfile : null; } catch (e) { return null; } };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const S = () => root.D37Settings || null;
  const ym = goal => { try { root.ym && root.ym(113596397, 'reachGoal', goal); } catch (e) {} };
  const report = (where, msg) => { try { root.d37Err && root.d37Err('engine:' + where, new Error(String(msg || '').slice(0, 200))); } catch (e) {} };

  // ═══ Плитки меню (одна таблица; названия — владельца) ═══
  const TILES = [
    { id: 'play', big: 1, icon: '🌍', title: 'Играть', sub: 'Твой мир на планете — от клетки до космоса: руби, строй, зови людей в племя. Всё сохраняется', href: '/hub/play', cls: 'hub-t-play' },
    { id: 'wardrobe', icon: '👕', title: 'Гардероб', sub: 'Девочка, мальчик или манекен, цвета каждой части', href: '/hub/wardrobe', cls: 'hub-t-ward' },
    { id: 'creative', icon: '🪐', title: 'Творческий режим', sub: 'Отдельный мир: свободный полёт над планетой, без голода и опасностей — своё сохранение', href: '/hub/creative', cls: 'hub-t-planet' },
    { id: 'world', icon: '🌍', title: 'Мир Денчика', sub: 'Город, кафе и столики с играми — онлайн', href: '/play/world', cls: 'hub-t-world', age: '12+' },
    { id: 'studio', icon: '🧱', title: 'Студия', sub: 'Построй свой 3D-мир со скриптами', href: '/play/studio3d', cls: 'hub-t-studio' },
    { id: 'mini', icon: '🎲', title: 'Мини-игры', sub: 'Шахматы, «5 букв», дурак, клеточки и ещё 50 игр', href: '/play', cls: 'hub-t-mini' },
    { id: 'invite', icon: '📍', title: 'Позвать друга', sub: 'Скинь ссылку — играйте на одной планете (скоро вместе)', act: 'invite', cls: 'hub-t-invite' },
    { id: 'howto', icon: '🎓', title: 'Как играть', sub: 'Кнопки на телефоне и на ПК', act: 'howto', cls: 'hub-t-howto' },
    { id: 'gfx', icon: '✨', title: 'Графика', sub: '', act: 'gfx', cls: 'hub-t-gfx' },
    { id: 'save', icon: '💾', title: 'Сохранение', sub: 'Пока пусто — начни игру', act: 'save', cls: 'hub-t-save' },
  ];
  // Графика игры (только вид — игра одинаковая): выбор живёт в этом браузере; «Простой режим» — WebGL2 вместо WebGPU
  const GFX = [
    { id: 'auto', label: 'Авто', sub: 'Телефон — быстро, ПК — обычно' },
    { id: 'max', label: 'Красиво', sub: 'Тени, облака, вода — всё на максимум' },
    { id: 'mid', label: 'Обычно', sub: 'Средние тени и облака' },
    { id: 'low', label: 'Быстро', sub: 'Для слабых телефонов' },
    { id: 'gl', label: 'Простой режим', sub: 'WebGL2 — если игра не запускается' },
  ];
  const gfxNow = () => { let v = ''; try { v = localStorage.getItem('d37_hub_gfx') || ''; } catch (e) {} return GFX.find(g => g.id === v) || GFX[0]; };

  // ═══ Сохранение в браузере: IndexedDB 'd37-hub' / 'saves' (нет базы — в памяти до закрытия вкладки) ═══
  const MEM = new Map();
  let dbp = null;
  function db(){
    if (dbp) return dbp;
    dbp = new Promise(res => {
      try {
        const rq = root.indexedDB.open('d37-hub', 1);
        rq.onupgradeneeded = () => { try { rq.result.createObjectStore('saves'); } catch (e) {} };
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => res(null);
        rq.onblocked = () => res(null);
      } catch (e) { res(null); }
    });
    return dbp;
  }
  async function idbGet(k){
    const d = await db(); if (!d) return MEM.get(k) || null;
    return new Promise(res => { try { const r = d.transaction('saves', 'readonly').objectStore('saves').get(k); r.onsuccess = () => res(r.result || null); r.onerror = () => res(MEM.get(k) || null); } catch (e) { res(MEM.get(k) || null); } });
  }
  async function idbPut(k, v){
    MEM.set(k, v);
    const d = await db(); if (!d) return false;
    return new Promise(res => { try { const t = d.transaction('saves', 'readwrite'); t.objectStore('saves').put(v, k); t.oncomplete = () => res(true); t.onerror = () => res(false); } catch (e) { res(false); } });
  }

  // ═══ Облако (js/core/cloud.js грузится по требованию; гостю не нужно) ═══
  let cloudP = null;
  function cloud(){
    if (root.D37Cloud) return Promise.resolve(root.D37Cloud);
    if (!cloudP) cloudP = new Promise(res => { const s = document.createElement('script'); s.src = '/js/core/cloud.js'; s.onload = () => res(root.D37Cloud || null); s.onerror = () => { cloudP = null; res(null); }; document.head.appendChild(s); });
    return cloudP;
  }
  const GAME = 'engine', WORLD = 'planet';
  // режимы игры: play — главный мир (долина: добыча, крафт, стройка; сцена valley), creative — «Творческий режим» (T-163: отдельный мир,
  // свободный полёт с орбиты, без выживания; старый адрес /hub/planet ведёт туда же), wardrobe — лёгкий гардероб (T-163: персонаж один
  // на подставке, без планеты — сцена wardrobe; в игре гардероб по-прежнему B / 👕)
  const MODES = { play: 'valley', creative: 'creative', planet: 'creative', wardrobe: 'wardrobe' };
  const SLOT = { play: WORLD, creative: 'creative', planet: 'creative' };   // у творческого мира своё сохранение (и в облаке — мир 'creative')
  const SAVES = m => !!SLOT[m];
  const slot = () => SLOT[st.mode] || WORLD;
  const SPAWNS = { home: 1, orbit: 1, new: 1, tribe: 1 };
  // «Путь» от клетки до космоса: шаги (как в движке, assets/game/hub/path.ron) и где игрок — из байтов сохранения (раздел progress
  // мира: «(v:1,stage:S,era:E,…»); стадия 0 клетка, 1 существо, 2 человек; эпоха E0..E7 → шаг пути
  const PATH = [['🦠', 'Клетка'], ['🐟', 'Существо'], ['🔥', 'Племя'], ['🏡', 'Посёлок'], ['🏰', 'Город'], ['🏭', 'Заводы'], ['🚀', 'Космос']];
  const ERA_STEP = [2, 3, 3, 4, 5, 5, 6, 6];
  function pathStep(rec){
    try {
      if (!rec || !rec.bytes || !rec.bytes.length) return -1;
      const t = new TextDecoder('utf-8', { fatal: false }).decode(rec.bytes);
      const m = /\(v:1,stage:(\d),era:(\d)/.exec(t);
      if (!m) return 2;   // мир без записи о пути (старые сохранения) — человек в племени
      const stage = +m[1], era = +m[2];
      return stage < 2 ? stage : (ERA_STEP[era] != null ? ERA_STEP[era] : 2);
    } catch (e) { return -1; }
  }
  function pathPanel(step){
    const box = el('div', 'hub-path');
    box.setAttribute('aria-label', 'Путь: от клетки до космоса');
    box.appendChild(el('b', 'hub-path-h', step >= 0 ? 'Твой путь' : 'Путь: от клетки до космоса'));
    const row = el('ol', 'hub-path-row');
    PATH.forEach(([ic, name], k) => {
      const li = el('li', 'hub-path-s' + (k === step ? ' on' : k < step ? ' done' : ''));
      li.append(el('span', 'hub-path-ic', ic), el('span', 'hub-path-n', name));
      if (k === step) li.setAttribute('aria-current', 'step');
      row.appendChild(li);
    });
    box.appendChild(row);
    return box;
  }

  // ═══ Состояние ═══
  const st = { gen: 0, active: false, mode: '', h: null, starting: false, t0: 0, playBase: 0, cloudVer: null, lastCloud: 0, saves: 0, cloudSaves: 0, look: null,
    lastLook: '', status: '', events: [], errors: [], build: null, lookT: 0, saveBusy: false, gl: false };

  function lookNow(){
    const s = S(); if (!s) return { body: 'girl', text: '' };
    return { body: s.get('d37body') || 'girl', text: s.get('d37look') || '' };
  }
  // записать образ в настройки (две записи подряд: пока пишем, свой же слушатель настроек не шлёт полуготовый образ обратно в движок)
  function keepLook(body, text){
    const s = S(); if (!s) return false;
    const was = lookNow();
    if (was.body === body && was.text === text) return false;
    st.applying = true;
    try { s.set('d37body', body); s.set('d37look', text); } finally { st.applying = false; }
    return true;
  }
  // образ поменялся в движке — запомнить (через 1,5 с после последней правки: ползунок цвета шлёт много)
  function onLook(m){
    const body = String(m.body || ''), text = String(m.text || '');
    if (!/^(girl|boy|mannequin)$/.test(body) || !/^[a-z0-9.:,]{0,600}$/.test(text)) return;
    st.lastLook = body + '|' + text;
    clearTimeout(st.lookT);
    st.lookT = setTimeout(() => {
      st.lookT = 0;
      if (!keepLook(body, text)) return;
      if (st.mode === 'wardrobe') ym('d37_wardrobe_save');
      status(me() ? 'Образ сохранён в аккаунте' : 'Образ сохранён в этом браузере');
    }, 1500);
  }

  // ═══ Сохранение мира: браузер всегда, облако — вошёл (не чаще раза в 25 с, при выходе — сразу) ═══
  const playSeconds = () => st.playBase + (st.t0 ? (performance.now() - st.t0) / 1000 : 0);
  async function saveWorld(why){
    const h = st.h;
    if (!h || !SAVES(st.mode) || st.saveBusy) return false;
    const bytes = h.save();
    if (!bytes || !bytes.length) return false;
    st.saveBusy = true;
    try {
      const W = slot(), prev = await idbGet(W);
      const gt = Math.round(playSeconds());
      const rec = { bytes, at: Date.now(), gt, cloud: Object.assign({ on: false, ver: null }, prev && prev.cloud, { dirty: true }) };
      await idbPut(W, rec);
      st.saves++;
      const u = me();
      if (!u) { status('Сохранено в браузере · войди — мир будет и в облаке'); return true; }
      if (why !== 'exit' && Date.now() - st.lastCloud < 25000) { status('Сохранено'); return true; }
      const C = await cloud();
      if (!C || !C.available()) { status('Сохранено в браузере'); return true; }
      st.lastCloud = Date.now();
      const base = Number.isInteger(rec.cloud.ver) ? rec.cloud.ver : null;
      const r = await C.put(GAME, W, { name: W === WORLD ? 'Планета D37' : 'Творческий мир D37', data: bytes, gt, base });
      if (r && r.ok) {
        rec.cloud = { on: true, ver: r.ver, dirty: false };
        await idbPut(W, rec);
        st.cloudSaves++;
        status('☁️ Сохранено в облаке');
      } else status(r && r.reason === 'conflict' ? 'В облаке мир новее (другое устройство) — зайди в игру заново' : 'Сохранено в браузере (облако: ' + (r && r.reason || 'нет связи') + ')');
      return true;
    } catch (e) { report('save', e && e.message); return false; }
    finally { st.saveBusy = false; }
  }
  // Какое сохранение взять при входе в игру: облако новее и здесь не менялось — облачное; поменялись оба — новее по времени игры
  async function pickSave(){
    let local = null;
    const W = slot();
    try { local = await idbGet(W); } catch (e) {}
    if (!me()) return local;
    const C = await cloud();
    if (!C || !C.available()) return local;
    try {
      const L = await C.list(GAME);
      if (!L || !L.ok) return local;
      const row = (L.list || []).find(r => r.world === W) || null;
      const how = C.resolve(local && local.cloud, row);
      const takeCloud = row && (how === 'down' || !local || (how === 'conflict' && (+row.gt || 0) > (+(local && local.gt) || 0)));
      if (takeCloud) {
        const bytes = await C.get(GAME, row);
        const rec = { bytes, at: Date.now(), gt: +row.gt || 0, cloud: { on: true, ver: row.ver, dirty: false } };
        await idbPut(W, rec);
        status('☁️ Мир взят из облака');
        return rec;
      }
      if (local && row && how === 'conflict') { local.cloud = { on: true, ver: row.ver, dirty: true }; await idbPut(W, local); }   // оставили этот — он и уйдёт в облако
      return local;
    } catch (e) { report('cloud', e && e.message); return local; }
  }

  // ═══ Меню /hub ═══
  function account(box){
    const u = me(), p = prof();
    const row = el('div', 'hub-acc');
    if (u) {
      row.appendChild(el('span', 'hub-acc-ic', '👤'));
      const t = el('span', 'hub-acc-t'); t.append('Ты играешь как ', el('b', '', String(p && p.nick || 'игрок').slice(0, 40)), ' — мир и образ сохраняются в аккаунте');
      row.appendChild(t);
    } else {
      row.appendChild(el('span', 'hub-acc-ic', '🙂'));
      row.appendChild(el('span', 'hub-acc-t', 'Играть можно без входа — всё сохранится в этом браузере. Войди, и мир с образом будут на любом устройстве.'));
      const b = el('button', 'hub-acc-btn', 'Войти'); b.type = 'button';
      b.addEventListener('click', () => { try { root.openGlobalAuth && root.openGlobalAuth(); } catch (e) {} });
      row.appendChild(b);
    }
    box.appendChild(row);
  }
  async function renderMenu(){
    const page = $('hub-page'); if (!page) return;
    page.textContent = '';
    const wrap = el('div', 'hub wrap hub-menu');   // hub-menu: на телефоне порядок другой (css/hub.css — «Играть» на первом экране)
    const head = el('div', 'hub-head');
    head.appendChild(el('div', 'hub-kick', 'Новый движок D37 · первая версия'));
    head.appendChild(el('h1', 'hub-h1', 'Во что играем?'));
    head.appendChild(el('p', 'hub-lead', 'Своя планета, свой персонаж и все игры сайта — в одном меню.'));
    wrap.appendChild(head);
    if (!ON()) { wrap.appendChild(el('p', 'hub-soon', 'Скоро здесь будет новое меню игр. А пока — раздел «Игры».')); page.appendChild(wrap); return; }
    const CAT = root.D37HubCat;   // T-163: «кто ты в игре» и строка «Игры игроков» (js/features/hub-catalog.js)
    if (CAT) { CAT.me(wrap); CAT.row(wrap); } else account(wrap);   // строка игр — сразу под плашкой, её видно без прокрутки на ПК
    const grid = el('div', 'hub-grid');
    for (const t of TILES) {
      if (t.id === 'play') { grid.appendChild(playCard(t)); continue; }
      const a = el(t.href ? 'a' : 'button', 'hub-tile ' + t.cls + (t.big ? ' hub-big' : ''));
      if (t.href) a.href = t.href; else a.type = 'button';
      a.dataset.tile = t.id;
      a.appendChild(el('span', 'hub-ic', t.icon));
      const tx = el('span', 'hub-tx');
      tx.appendChild(el('b', 'hub-tt', t.title));
      tx.appendChild(el('span', 'hub-ts', t.sub));
      a.appendChild(tx);
      if (t.age) a.appendChild(el('i', 'hub-age', t.age));
      if (t.act === 'invite') a.addEventListener('click', invite);
      if (t.act === 'howto') a.addEventListener('click', howto);
      if (t.act === 'gfx') { a.querySelector('.hub-ts').textContent = gfxNow().label + ' · ' + gfxNow().sub; a.addEventListener('click', () => gfxPick(a)); }
      if (t.act === 'save') a.addEventListener('click', saveSheet);
      grid.appendChild(a);
    }
    wrap.appendChild(grid);
    const note = el('div', 'hub-note');
    note.appendChild(el('b', '', 'Что уже есть: '));
    note.append('один мир на планете: новый мир начинается клеткой в приливной луже, дальше — существо, племя, посёлок; рубка, ремесло, стройка, ' +
      'карта (M), дневник пути (J) и компас; можно прилететь в свой мир с орбиты. Творческий режим — свободный полёт. Это первая версия: если что-то сломалось — напиши в чат.');
    wrap.appendChild(note);
    page.appendChild(wrap);
    // «Продолжить»: есть сохранение в браузере — сколько уже наиграно, где ты на пути; нет — «Новый мир»
    let rec = null;
    try { rec = await idbGet(WORLD); } catch (e) {}
    const has = !!(rec && rec.bytes && rec.bytes.length);
    fillPlayCard(page.querySelector('[data-tile="play"]'), has ? rec : null);
    const sv = page.querySelector('[data-tile="save"] .hub-ts');
    if (has && sv) sv.textContent = fmtMin(rec.gt) + ' в игре · ' + (rec.cloud && rec.cloud.on && !rec.cloud.dirty ? 'в облаке ☁️' : 'в этом браузере');
  }
  // Главная карточка «Играть»: ссылка на свой мир, выбор места появления, панель «Путь». Сохранения нет — «Новый мир» (с клетки)
  // и маленькая ссылка «Пропустить к племени». Карточка — div (внутри ссылки, а ссылка в ссылке нельзя)
  function playCard(t){
    const card = el('div', 'hub-tile hub-big hub-playcard ' + t.cls);
    card.dataset.tile = 'play';
    const main = el('a', 'hub-play-main');
    main.href = '/hub/play';
    main.appendChild(el('span', 'hub-ic', t.icon));
    const tx = el('span', 'hub-tx');
    tx.appendChild(el('b', 'hub-tt', t.title));
    tx.appendChild(el('span', 'hub-ts', t.sub));
    tx.appendChild(el('span', 'hub-cont', ''));
    main.appendChild(tx);
    card.appendChild(main);
    card.appendChild(el('div', 'hub-spawn'));
    card.appendChild(pathPanel(-1));
    return card;
  }
  function chip(text, href, cls){ const a = el('a', 'hub-chip' + (cls ? ' ' + cls : ''), text); a.href = href; return a; }
  function fillPlayCard(card, rec){
    if (!card) return;
    const main = card.querySelector('.hub-play-main'), c = card.querySelector('.hub-cont'), sp = card.querySelector('.hub-spawn'), tt = card.querySelector('.hub-tt');
    sp.textContent = '';
    if (rec) {
      main.href = '/hub/play';
      tt.textContent = 'Играть';
      c.textContent = '▶ Продолжить мой мир · ' + fmtMin(rec.gt) + ' в игре';
      sp.appendChild(el('span', 'hub-spawn-h', 'Где появиться:'));
      sp.append(chip('📍 Где я был', '/hub/play', 'on'), chip('🏕 Домой в лагерь', '/hub/play/home'), chip('🚀 С орбиты', '/hub/play/orbit'));
      const fresh = el('button', 'hub-chip hub-chip-x', 'Новый мир…'); fresh.type = 'button';
      fresh.addEventListener('click', saveSheet);
      sp.appendChild(fresh);
    } else {
      main.href = '/hub/play/new';
      tt.textContent = 'Новый мир';
      c.textContent = '▶ Начать с клетки в приливной луже';
      sp.append(chip('🔥 Пропустить к племени', '/hub/play/tribe', 'hub-chip-x'));
    }
    const old = card.querySelector('.hub-path');
    if (old) old.replaceWith(pathPanel(pathStep(rec)));
  }
  const fmtMin = s => { const m = Math.max(1, Math.round((+s || 0) / 60)); return m >= 60 ? Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин' : m + ' мин'; };
  // лист поверх меню (как играть, сохранение): заголовок, строки, кнопки; закрывается кнопкой, фоном и Esc
  function sheet(title, build){
    const page = $('hub-page'); if (!page) return null;
    page.querySelector('.hub-sheet-bg')?.remove();
    const bg = el('div', 'hub-sheet-bg'), box = el('div', 'hub-sheet');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', title);
    const x = el('button', 'hub-sheet-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Закрыть');
    const close = () => { bg.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') close(); };
    x.addEventListener('click', close);
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    document.addEventListener('keydown', esc);
    box.append(x, el('h2', 'hub-sheet-h', title));
    build(box, close);
    bg.appendChild(box); page.appendChild(bg);
    return box;
  }
  function howto(){
    sheet('Как играть', box => {
      const rows = [
        ['🌲 Долина', 'подойди к дереву и держи ДЕЙСТВИЕ (ЛКМ или E) — дерево упадёт и станет брёвнами; камни, траву, ягоды и ветки тоже можно собрать. Руками медленно — сделай топор, кирку и лопату'],
        ['🔨 Ремесло', 'T или кнопка РЕМЕСЛО — доски, палки, инструменты, верстак, костёр, факел; стены, дверь, крыша, пол и мост — рядом с верстаком'],
        ['🏠 Стройка', 'возьми деталь в руку (1-8 или СУМКА) и поставь (ПКМ или ДЕЙСТВИЕ); R — повернуть; стены цепляются к стенам, крыша — на стены. Зажми ДЕЙСТВИЕ на детали — забрать обратно'],
        ['📱 Телефон', 'левая половина экрана — идти (до упора — бегом), правая — смотреть; ⤒ — прыжок, 👕 — гардероб; в творческом режиме 🌍 — с орбиты на землю и обратно'],
        ['🖥 Компьютер', 'нажми на картинку — мышь смотрит; W A S D — идти, Shift — бегом, Пробел — прыжок (в воде — вверх), C — присесть'],
        ['🧭 Путь', 'новый мир начинается клеткой в приливной луже: расти, стань существом, проснись человеком у монолита. Племя из 5 жителей, 3 хижины, склад и поле — и можно основать посёлок'],
        ['🗺 Карта и дневник', 'M — карта (места, племена, ты), J — дневник пути (цель, озарения); на телефоне — в меню СУМКА, сверху. Компас вверху показывает ближайшие стоянки и руины'],
        ['🪐 Творческий режим', 'отдельный мир без голода и опасностей, начинается на орбите: зажми O (или 🌍) — полетишь вниз и приземлишься; ещё раз — обратно в космос'],
        ['🌊 Вода', 'в воду можно зайти вброд, глубже — плыть; ныряй и смотри на дно'],
        ['👕 Гардероб', 'B или 👕 — девочка, мальчик или манекен, цвет волос, верха, низа, обуви и кожи; образ сохраняется сам'],
        ['💾 Сохранение', 'само, через пару секунд после каждого дела и при выходе — в браузере; вошёл в аккаунт — ещё и в облаке, на любом устройстве'],
        ['⛶ Экран', '⛶ — на весь экран, V — вид от первого лица / со спины, колесо мыши — ближе и дальше'],
      ];
      for (const [k, v] of rows) { const r = el('div', 'hub-sheet-row'); r.append(el('b', '', k), el('span', '', v)); box.appendChild(r); }
      const go = el('a', 'hub-btn', '🪐 Играть'); go.href = '/hub/play'; box.appendChild(go);
    });
  }
  function gfxPick(tile){
    const i = GFX.indexOf(gfxNow()), next = GFX[(i + 1) % GFX.length];
    try { if (next.id === 'auto') localStorage.removeItem('d37_hub_gfx'); else localStorage.setItem('d37_hub_gfx', next.id); } catch (e) {}
    const s = tile && tile.querySelector('.hub-ts'); if (s) s.textContent = next.label + ' · ' + next.sub;
    toastMenu('Графика: ' + next.label + ' (нажми ещё — следующий вариант)');
  }
  async function saveSheet(){
    const rec = await idbGet(WORLD).catch(() => null);
    sheet('Сохранение', (box, close) => {
      const has = rec && rec.bytes && rec.bytes.length;
      box.appendChild(el('p', 'hub-sheet-p', has
        ? 'Твоя планета: ' + fmtMin(rec.gt) + ' в игре, сохранено ' + new Date(rec.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + (rec.cloud && rec.cloud.on ? ' — копия в облаке ☁️.' : ' — в этом браузере.')
        : 'Сохранения пока нет. Начни игру — она сохранится сама после каждого дела и при выходе.'));
      if (!me()) box.appendChild(el('p', 'hub-sheet-p hub-muted', 'Войди в аккаунт — мир будет в облаке и откроется на любом устройстве.'));
      const row = el('div', 'hub-er');
      const go = el('a', 'hub-btn', has ? '▶ Продолжить' : '🪐 Играть'); go.href = '/hub/play'; row.appendChild(go);
      if (has) {
        const fresh = el('button', 'hub-btn hub-btn3', 'Начать заново'); fresh.type = 'button';
        fresh.addEventListener('click', async () => {
          if (!confirm('Начать заново? Долина, вещи и постройки ' + (rec.cloud && rec.cloud.on ? '(и в облаке) ' : '') + 'удалятся, вернуть их будет нельзя.')) return;
          await idbPut(WORLD, null);
          if (me() && rec.cloud && rec.cloud.on) { const C = await cloud(); try { C && C.available() && await C.del(GAME, WORLD); } catch (e) {} }
          close(); renderMenu(); toastMenu('Готово — нажми «Новый мир», он начнётся с клетки');
        });
        row.appendChild(fresh);
      }
      box.appendChild(row);
    });
  }
  // Карточка игры в своём профиле: персонаж D37, сколько наиграно, «Играть» и «Гардероб» (profile.js не трогаем — вставка по переходу)
  async function profileCard(){
    if (!ON() || typeof currentRoute !== 'function' || currentRoute() !== 'profile') return;
    const param = typeof currentRouteParam === 'function' ? currentRouteParam() : null, u = me();
    const own = u && (!param || param === u.id);
    const host = $('profileContent');
    host && host.querySelector('.hub-pcard')?.remove();
    if (!own || !host || host.style.display === 'none') return;
    const rec = await idbGet(WORLD).catch(() => null);
    const l = lookNow(), BODY = { girl: 'девочка', boy: 'мальчик', mannequin: 'манекен' };
    const card = el('div', 'hub-pcard');
    card.appendChild(el('span', 'hub-pcard-ic', '🪐'));
    const tx = el('div', 'hub-pcard-tx');
    tx.appendChild(el('b', '', 'Планета D37'));
    tx.appendChild(el('span', '', 'Персонаж: ' + (BODY[l.body] || 'девочка') + (rec && rec.bytes && rec.bytes.length ? ' · ' + fmtMin(rec.gt) + ' в игре' : ' · ещё не играл')));
    card.appendChild(tx);
    const p = el('a', 'hub-btn', 'Играть'); p.href = '/hub/play';
    const w = el('a', 'hub-btn hub-btn3', '👕'); w.href = '/hub/wardrobe'; w.title = 'Гардероб'; w.setAttribute('aria-label', 'Гардероб');
    card.append(p, w);
    if (currentRoute() !== 'profile' || host.querySelector('.hub-pcard')) return;
    const top = $('profileBanner'); let anchor = top; while (anchor && anchor.parentElement && anchor.parentElement !== host) anchor = anchor.parentElement;
    if (anchor && anchor.parentElement === host) anchor.insertAdjacentElement('afterend', card); else host.prepend(card);
  }
  async function invite(e){
    e && e.preventDefault && e.preventDefault();
    const url = (root.D37Route ? D37Route.abs('/hub/play') : location.origin + '/hub/play');
    const text = 'Залетай на мою планету в новом движке dan4ik37!';
    try { if (navigator.share) { await navigator.share({ title: 'Планета D37', text, url }); return; } } catch (er) { if (er && er.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toastMenu('Ссылка скопирована — отправь другу'); } catch (er) { toastMenu(url); }
  }
  function toastMenu(t){ const page = $('hub-page'); if (!page) return; const x = el('div', 'hub-toast', t); page.appendChild(x); setTimeout(() => x.remove(), 3500); }

  // ═══ Игра поверх сайта ═══
  let ui = null;
  function status(t){ st.status = t; if (ui && ui.stat) { ui.stat.textContent = t; ui.stat.classList.add('on'); clearTimeout(ui.statT); ui.statT = setTimeout(() => ui && ui.stat && ui.stat.classList.remove('on'), 3500); } }
  function toast(t){ if (!ui) return; const x = el('div', 'hub-gtoast', t); ui.box.appendChild(x); setTimeout(() => x.remove(), 3200); }
  const EVENTS = { landed: '🛬 Приземлился! Теперь можно гулять и плавать', wade: '🌊 Вброд по воде', swim: '🏊 Плывёшь — пробел вверх', dive: '🤿 Нырнул!', orbit: '🚀 Снова на орбите' };
  const PHASES = { wasm: 'Загружаем движок', gpu: 'Готовим видеокарту', world: 'Строим мир' };
  function buildUi(mode){
    // долина: своя строка подсказок движка вверху — полоса сайта над картинкой, не поверх неё
    const box = el('div', 'hub-play' + (mode === 'play' ? ' hub-game' : ''));
    const cre = mode === 'creative' || mode === 'planet';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', mode === 'wardrobe' ? 'Гардероб D37' : cre ? 'Творческий режим D37' : 'Игра D37');
    const bar = el('div', 'hub-bar');
    const back = el('button', 'hub-back', '← На сайт'); back.type = 'button';
    back.addEventListener('click', () => leave(mode));
    const title = el('b', 'hub-title', mode === 'wardrobe' ? '👕 Гардероб' : cre ? '🪐 Творческий режим' : '🌍 Мой мир D37');
    const stat = el('span', 'hub-stat', '');
    const full = el('button', 'hub-full', '⛶'); full.type = 'button'; full.title = 'На весь экран'; full.setAttribute('aria-label', 'На весь экран');
    full.addEventListener('click', () => toggleFull(box));
    bar.append(back, title, stat, full);
    // В игре полосы сайта нет (владелец 13.11: «это явно лишнее, оно должно быть в паузе, а не занимать игру»): маленькая ⏸ в углу,
    // «На сайт» и «На весь экран» — в меню паузы. Гардероб оставляет свою полосу (там «Готово»).
    let pause = null;
    if (mode !== 'wardrobe') {
      box.classList.add('hub-nobar');
      stat.classList.add('hub-stat-float');
      const pbtn = el('button', 'hub-pausebtn', '⏸'); pbtn.type = 'button'; pbtn.title = 'Пауза'; pbtn.setAttribute('aria-label', 'Пауза');
      pause = el('div', 'hub-pause'); pause.hidden = true; pause.setAttribute('role', 'dialog'); pause.setAttribute('aria-label', 'Пауза');
      const card = el('div', 'hub-pcard');
      const resume = el('button', 'hub-pbtn hub-pbtn-main', '▶ Продолжить'); resume.type = 'button';
      const fullP = el('button', 'hub-pbtn', '⛶ На весь экран'); fullP.type = 'button';
      fullP.addEventListener('click', () => { toggleFull(box); closePause(); });
      back.classList.add('hub-pbtn');
      card.append(el('b', 'hub-ptitle', title.textContent), resume, fullP, back);
      pause.appendChild(card);
      const openPause = () => { if (!pause.hidden) return; pause.hidden = false; try { st.h && st.h.pause(); } catch (e) {} resume.focus({ preventScroll: true }); };
      const closePause = () => { if (pause.hidden) return; pause.hidden = true; try { st.h && st.h.resume(); } catch (e) {} };
      pbtn.addEventListener('click', openPause);
      resume.addEventListener('click', closePause);
      pause.addEventListener('click', e => { if (e.target === pause) closePause(); });
      box.append(pbtn, stat);
    }
    const stage = el('div', 'hub-stage');
    const load = el('div', 'hub-load');
    const lt = el('div', 'hub-lt', mode === 'wardrobe' ? 'Открываем гардероб' : cre ? 'Летим в творческий мир' : st.opt === 'new' ? 'Рождается новый мир' : st.opt === 'orbit' ? 'Летим к твоему миру' : 'Идём в твой мир');
    const ph = el('div', 'hub-ph', 'Загружаем движок');
    const barO = el('div', 'hub-pb'), barI = el('i', '');
    barO.appendChild(barI);
    const pct = el('div', 'hub-pct', '0%');
    const tip = el('div', 'hub-tip', mode === 'wardrobe' ? 'Только персонаж — без мира, поэтому быстро. Образ сохранится сам.' : mode === 'play'
      ? (touchDev() ? 'Слева — идти, справа — смотреть. Кнопка ДЕЙСТВИЕ — рубить и брать, СУМКА и РЕМЕСЛО — вещи и крафт.' : 'Нажми на картинку. ЛКМ или E — рубить и брать, Q — сумка, T — ремесло, 1-8 — в руку, ПКМ — поставить.')
      : touchDev() ? 'Слева на экране — идти, справа — смотреть, 🌍 — с орбиты на землю.' : 'Нажми на картинку, чтобы смотреть мышью. W A S D — идти, O — с орбиты на землю, B — гардероб.');
    const cancel = el('button', 'hub-cancel', 'Отмена'); cancel.type = 'button';
    cancel.addEventListener('click', () => back.click());
    load.append(lt, ph, barO, pct, tip, cancel);
    const err = el('div', 'hub-err'); err.hidden = true;
    box.append(bar, stage, load, err);
    if (pause) box.appendChild(pause);
    // Щелчки и колёсико в игре — только игре: искры сайта, закрытие меню сайта и прочие обработчики на document их не видят
    // (ссылки «Мини-игры» / «← Меню» на экране ошибки идут дальше — их ведёт роутер сайта)
    for (const t of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart']) {
      box.addEventListener(t, e => { if (t === 'click' && e.target instanceof Element && e.target.closest('a[href]')) return; e.stopPropagation(); }, { passive: true });
    }
    document.body.appendChild(box);
    // кнопка сайта, по которой зашли, остаётся в фокусе — пробел / Enter в игре нажимали бы её снова
    try { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); } catch (e) {}
    return { box, bar, stage, load, ph, barI, pct, err, stat, statT: 0 };
  }
  const touchDev = () => { try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } };
  function toggleFull(box){
    const d = document;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
      const f = box.requestFullscreen || box.webkitRequestFullscreen;
      if (f) { const p = f.call(box); if (p && p.catch) p.catch(() => {}); }
    } catch (e) {}
  }
  function progress(p){
    if (!ui) return;
    // три этапа на одной полосе: движок 0–60 %, видеокарта 60–70 %, планета 70–100 %
    const k = p.total > 0 ? Math.max(0, Math.min(1, p.done / p.total)) : (p.phase === 'wasm' ? 0.3 : 0.5);
    const v = p.phase === 'wasm' ? k * 60 : p.phase === 'gpu' ? 60 + k * 10 : 70 + k * 29;
    ui.barI.style.width = v.toFixed(1) + '%';
    ui.pct.textContent = Math.round(v) + '%' + (p.phase === 'wasm' && p.total > 0 ? ' · ' + (p.done / 1048576).toFixed(1) + ' из ' + (p.total / 1048576).toFixed(1) + ' МБ' : '');
    ui.ph.textContent = PHASES[p.phase] || '…';
  }
  function showError(code, msg){
    if (!ui) return;
    ui.load.hidden = true;
    const e = ui.err; e.textContent = ''; e.hidden = false;
    e.appendChild(el('div', 'hub-et', code === 'nogpu' ? 'Этот браузер не тянет 3D' : 'Игра не запустилась'));
    e.appendChild(el('div', 'hub-em', code === 'nogpu' ? 'Нужен браузер с WebGPU или WebGL2 (свежий Chrome, Edge, Яндекс, Safari 17+). Мини-игры сайта работают везде.' : 'Мы уже получили отчёт об ошибке. Можно попробовать простой режим графики.'));
    const row = el('div', 'hub-er');
    if (code !== 'nogpu' && !st.gl) { const b = el('button', 'hub-btn', 'Простой режим (WebGL2)'); b.type = 'button'; b.addEventListener('click', () => { st.gl = true; restart(); }); row.appendChild(b); }
    const m = el('a', 'hub-btn hub-btn2', 'Мини-игры'); m.href = '/play'; row.appendChild(m);
    const back = el('a', 'hub-btn hub-btn2', '← Меню'); back.href = '/hub'; row.appendChild(back);
    e.appendChild(row);
  }
  async function canRun3d(){
    try { if (navigator.gpu) { const a = await Promise.race([navigator.gpu.requestAdapter(), new Promise(r => setTimeout(() => r(null), 600))]); if (a) return true; } } catch (e) {}
    try { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); if (g) { const x = g.getExtension('WEBGL_lose_context'); x && x.loseContext(); return true; } } catch (e) {}
    return false;
  }
  function sessionMsg(){
    const u = me(), p = prof();
    let band = 'u';
    try { const g = root.D37Age && D37Age.group(); band = ['child', 'teen', 'teen16', 'adult'].includes(g) ? g : 'u'; } catch (e) {}
    const role = p && p.role;
    // мир для взрослых — только с надёжной проверкой возраста (поставщика ещё нет): пока у всех детский
    return { uid: u && /^[A-Za-z0-9-]{1,64}$/.test(String(u.id)) ? String(u.id) : null, nick: String(p && p.nick || (u ? 'игрок' : 'Гость')).slice(0, 40), realm: 'kids', band, staff: role === 'admin' || role === 'moderator' };
  }
  async function buildInfo(){
    if (st.build) return st.build;
    try { const r = await fetch(BASE() + 'build.json', { cache: 'no-cache' }); if (r.ok) st.build = await r.json(); } catch (e) {}
    return st.build || {};
  }

  async function open(mode, opt){
    opt = mode === 'play' && SPAWNS[opt] ? opt : '';
    if (st.active && st.mode === mode && st.opt === opt) return;
    if (st.active) await close('switch');
    // новый мир поверх сохранённого — только с согласия (иначе — продолжить свой)
    if (opt === 'new' || opt === 'tribe') {
      const old = await idbGet(WORLD).catch(() => null);
      if (old && old.bytes && old.bytes.length && !confirm('Начать новый мир? Твой мир (' + fmtMin(old.gt) + ' в игре) заменится новым при первом сохранении.')) opt = '';
    }
    st.opt = opt;
    const gen = ++st.gen;   // этот запуск; быстро вышли и зашли снова — старый запуск сам сдаётся (два движка сразу не бывает)
    st.active = true; st.mode = mode; st.starting = true; st.events = []; st.errors = []; st.resumed = null;
    document.body.classList.add('hub-on', 'game-on', 'e2-calm');
    ui = buildUi(mode);
    ym('d37_open');
    if (!await canRun3d()) { showError('nogpu'); st.starting = false; return; }
    const info = await buildInfo();
    const fresh = opt === 'new' || opt === 'tribe';
    const save = SAVES(mode) && !fresh ? await pickSave() : null;
    if (gen !== st.gen || !st.active || !ui) { if (gen === st.gen) st.starting = false; return; }   // ушли со страницы, пока ждали
    st.playBase = save && +save.gt || 0;
    let host;
    try {
      const v = info && /^[0-9a-f]{6,16}$/.test(String(info.id || '')) ? '?v=' + info.id : '';
      host = await import(BASE() + 'engine-host.js' + v + (v ? '&' : '?') + 'k=2');   // k — версия обёртки (клавиши игры не уходят сайту)
    } catch (e) { report('import', e && e.message); showError('import', e); st.starting = false; return; }
    if (gen !== st.gen || !st.active || !ui) return;
    try {
      const look = lookNow(), g = gfxNow().id;
      st.look = look;
      const h = await host.start({
        root: ui.stage, scene: MODES[mode] || 'valley', rawSize: +(info && info.wasm_raw) || 0, gl: st.gl || g === 'gl',
        quality: g === 'max' || g === 'mid' || g === 'low' ? g : touchDev() ? 'low' : '', session: sessionMsg(), look, save: save && save.bytes, wardrobe: mode === 'wardrobe',
        newWorld: opt === 'new', skipTribe: opt === 'tribe', spawn: opt === 'home' || opt === 'orbit' ? opt : 'last',
        onProgress: progress, onMessage: onMsg,
      });
      if (gen !== st.gen || !st.active || !ui) { h.dispose(); return; }
      st.h = h; st.t0 = performance.now();
    } catch (e) {
      const msg = String(e && e.message || e);
      report('start', msg); st.errors.push(msg);
      showError('start', msg);
    } finally { st.starting = false; }
  }
  function onMsg(m){
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'loaded') { if (ui) ui.load.hidden = true; ym('d37_ready'); if (st.opt === 'new') toast('🦠 Новый мир: ты — клетка в приливной луже'); else if (st.opt === 'tribe') toast('🔥 Племя: собирай, строй, зови людей'); }
    else if (m.t === 'look_changed') onLook(m);
    else if (m.t === 'wardrobe' && m.on === false && st.mode === 'wardrobe') leave('wardrobe');
    else if (m.t === 'save_ready') saveWorld(String(m.why || ''));
    else if (m.t === 'event') { st.events.push(String(m.code)); if (EVENTS[m.code]) toast(EVENTS[m.code]); }
    else if (m.t === 'resumed') { st.resumed = m.summary || null; if (m.summary && SAVES(st.mode)) toast(st.mode === 'play' ? (st.opt === 'orbit' ? '🚀 Твой мир внизу — зажми O, чтобы приземлиться' : st.opt === 'home' ? '🏕 Ты дома, в лагере' : '▶ Твой мир: всё, что построил, на месте') : '▶ Продолжаем с того места, где ты был'); }
    else if (m.t === 'error') {
      st.errors.push(String(m.code) + ': ' + String(m.msg || ''));
      report(String(m.code).replace(/[^a-z_-]/gi, '').slice(0, 20) || 'x', m.msg);
      if (m.code === 'frame' || m.code === 'worker-result') showError('start', m.msg);
    }
    // ready приходит после первого кадра; экран загрузки уходит на loaded (или через 25 с — планета видна и так)
    if (m.t === 'ready' && ui) setTimeout(() => { if (ui) ui.load.hidden = true; }, 25000);
  }
  async function close(why){
    if (!st.active) return;
    const h = st.h;
    if (h && SAVES(st.mode)) { try { h.pause(); await saveWorld('exit'); } catch (e) {} }
    // последний образ — сразу, не ждать 1,5 с
    if (st.lookT) { clearTimeout(st.lookT); st.lookT = 0; const [b, t] = st.lastLook.split('|'); if (b) keepLook(b, t || ''); }
    try { h && h.dispose(); } catch (e) {}
    st.h = null; st.active = false; st.mode = ''; st.opt = ''; st.t0 = 0; st.gen++;
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
    if (ui) { ui.box.remove(); ui = null; }
    document.body.classList.remove('hub-on', 'e2-calm');
    if (!/^#\/games\/./.test(root.D37Route ? D37Route.hash() : '')) document.body.classList.remove('game-on');
  }
  // «← На сайт» / «Готово» в гардеробе: туда, откуда пришли (профиль, раздел игр), иначе — меню платформы
  let prevPath = '', curPath = typeof location !== 'undefined' ? location.pathname : '';
  function leave(mode){
    const to = mode === 'wardrobe' && prevPath && !/^\/hub\/(play|creative|planet|wardrobe)/.test(prevPath) ? prevPath : '/hub';
    if (root.D37Route) D37Route.go(to); else location.href = to;
  }
  async function restart(){ const m = st.mode, o = st.opt; await close('restart'); if (m) open(m, o === 'new' || o === 'tribe' ? '' : o); }

  // Образ поменяли не здесь (вошёл с другого устройства — настройки пришли из аккаунта) — показать его в игре
  function watchSettings(){
    const s = S(); if (!s || !s.on) return;
    s.on(ev => {
      if (!ev || !st.h || st.applying || (ev.key !== 'd37look' && ev.key !== 'd37body' && ev.key !== '*')) return;
      const l = lookNow();
      if (st.lastLook === l.body + '|' + l.text) return;
      st.h.send({ t: 'look', body: l.body, text: l.text });
    });
  }

  // ═══ Вход из роутера ═══
  function render(param){
    const parts = String(param || '').split('/'), p = parts[0];
    if (ON() && MODES[p]) { open(p, parts[1] || ''); return; }
    if (ON() && p === 'games' && root.D37HubCat) { if (st.active) close('menu'); D37HubCat.page($('hub-page')); return; }
    renderMenu();
    // из игры в меню: мир сохраняется при выходе — «▶ Продолжить» и «Сохранение» перерисовать, когда запишется
    if (st.active) close('menu').then(() => { if (!st.active && typeof currentRoute === 'function' && currentRoute() === 'hub') renderMenu(); });
  }
  if (typeof window !== 'undefined') {
    // ушли из /hub — сохранить и выгрузить движок; вкладку спрятали — сохранить и поставить на паузу
    window.addEventListener('d37:route', () => {
      if (location.pathname !== curPath) { prevPath = curPath; curPath = location.pathname; }
      setTimeout(() => { if (st.active && (typeof currentRoute !== 'function' || currentRoute() !== 'hub' || !/^(play|wardrobe|creative|planet)/.test(String(currentRouteParam() || '')))) close('route'); profileCard(); }, 400);
    });
    window.addEventListener('load', () => setTimeout(profileCard, 1500));
    document.addEventListener('visibilitychange', () => {
      if (!st.h) return;
      if (document.hidden) { st.h.pause(); saveWorld('hidden'); } else st.h.resume();
    });
    window.addEventListener('pagehide', () => { if (st.h) saveWorld('exit'); });
    window.addEventListener('d37:auth', () => { if (st.h) st.h.send(Object.assign({ t: 'session' }, sessionMsg())); if (!st.active && typeof currentRoute === 'function' && currentRoute() === 'hub') renderMenu(); setTimeout(profileCard, 1200); });
    setTimeout(watchSettings, 0);
    // меню сайта: пункт «🪐 Играть» виден, только когда раздел включён; в нижнем меню телефона он стоит на месте «🌍 Мир»
    // (Мир — плитка внутри платформы), раздел выключен — «Мир» возвращается
    const navOn = () => {
      document.querySelectorAll('[data-hub-nav]').forEach(a => { a.hidden = !ON(); });
      document.querySelectorAll('[data-hub-alt]').forEach(a => { a.hidden = ON(); });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', navOn); else navOn();
  }
  root.renderHubPage = render;
  root.D37Hub = { TILES, PATH, open, close, render, invite, saveWorld, pickSave, lookNow, fmtMin, pathStep, get active(){ return st.active; }, _st: st, _idb: { get: idbGet, put: idbPut } };
})();
