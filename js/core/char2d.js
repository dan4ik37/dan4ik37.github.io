// ═══════════════════════════════════════
//  2D-ПЕРСОНАЖ 🎞️ — ПРОЕКЦИЯ НАСТОЯЩЕГО: 3D-человечек из гардероба (js/games/world3d.js) запекается в листы спрайтов с
//  анимациями — сбоку (платформеры), 2.5D сверху на 4/8 сторон (миры, «Орда», «Арена»), портрет. Для любых 2D-игр сайта.
// ═══════════════════════════════════════
// Игре: const H = D37Sprite.handle(look, { view: 'side' | 'iso4' | 'iso8' | 'front', size: 64, style, anims: ['idle', 'walk'], key }),
//   каждый кадр H.draw(ctx, 'walk', t, x, y, { dir | flip, h, item, alpha }) — ноги в (x, y). size — «стандартный рост» листа в
//   CSS px (рисуется таким, если ctx в CSS px), h — тот же рост в единицах ctx. t — секунды от начала анимации.
//   Пока лист печётся — рисуется старый 2D-персонаж (D37Char.sprite / walker); нет WebGL — всегда он.
// Стороны dir 0…7: 0 — к нам (вниз), 1 — вниз-вправо, 2 — вправо, 3 — вверх-вправо, 4 — от нас, 5 — вверх-влево, 6 — влево,
//   7 — вниз-влево (D37Sprite.dir8(dx, dy)). Печём 0, 7, 6, 5, 4 (рука с предметом — к нам), вправо — зеркало (opts.full — все).
//   Сбоку: flip: true — смотрит влево (как у обычных спрайтов, которые «смотрят вправо»).
// Листы печёт ОДИН скрытый WebGLRenderer: сначала idle, остальное — в простое (requestIdleCallback), по кадру — без рывков.
//   Анимация, которой нет в opts.anims, допечётся сама при первом H.draw (до тех пор — idle).
// Кэш: память (LRU по байтам, D37Sprite.budget) + IndexedDB «d37-sprites» — ключ: хеш образа + вид + размер + стиль + VER;
//   версия персонажа (World3D) — в записи: сменилась → лист тихо перепечётся. Готовым листам Three.js не нужен.
// Стили (STYLES): smooth, toon, flat, pixel (16-бит), retro (8-бит), sketch, chibi. Выбор игрока — D37Sprite.styleFor(свой_по_умолчанию).
// ВСЕ обращения к World3D — только в разделе «Переходник» (W3): поменялся движок персонажа — править там.
(() => {
  const VER = 1;                 // версия листов: поменял позы, раскладку или стили — подними (кэш IndexedDB перепечётся)
  const STD = 2.6;               // «стандартный рост» в единицах 3D: столько занимает size (обычный человечек — ~2,3)
  const PI = Math.PI, TAU = PI * 2;
  const W3_SRC = 'js/games/world3d.js';
  const EF = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  const LS_STYLE = 'd37_spr_style';
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // ── Виды: el — наклон камеры (рад), bake — какие стороны печём (левые: рука с предметом ближе к нам), full — без зеркала;
  //    side — в профиль, повёрнут к нам на turn ──
  const VIEWS = {
    side:  { name: 'Сбоку', el: .1, bake: [6], full: [6, 2], turn: .62 },
    iso4:  { name: '2.5D · 4 стороны', el: .56, bake: [0, 6, 4], full: [0, 2, 4, 6], turn: .3 },
    iso8:  { name: '2.5D · 8 сторон', el: .56, bake: [0, 7, 6, 5, 4], full: [0, 1, 2, 3, 4, 5, 6, 7], turn: .3 },
    front: { name: 'Портрет', el: .12, bake: [0], yaw: .32 },
  };
  // ── Анимации: n кадров (lo — на слабых) ровно на один цикл dur (с); loop: 0 — разовая (последний кадр держится) ──
  const ANIMS = {
    idle:   { name: 'Стоит', n: 4, lo: 2, dur: 2.6, loop: 1 },
    walk:   { name: 'Идёт', n: 8, lo: 6, dur: TAU / 10.5, loop: 1 },
    run:    { name: 'Бежит', n: 8, lo: 6, dur: TAU / 15, loop: 1 },
    jump:   { name: 'Прыжок', n: 2, dur: .3, loop: 0 },
    fall:   { name: 'Падает', n: 2, dur: .4, loop: 1 },
    crouch: { name: 'Присел', n: 2, lo: 1, dur: 2.6, loop: 1 },
    climb:  { name: 'Лезет', n: 4, dur: .8, loop: 1 },
    swim:   { name: 'Плывёт', n: 6, lo: 4, dur: TAU / 5.5, loop: 1 },
    sit:    { name: 'Сидит', n: 1, dur: 1, loop: 1 },
    hurt:   { name: 'Больно', n: 3, dur: .3, loop: 0 },
    use:    { name: 'Удар', n: 5, dur: .32, loop: 0 },
    wave:   { name: 'Машет', n: 6, lo: 4, dur: TAU / 10, loop: 1 },
    dance:  { name: 'Танец', n: 8, lo: 6, dur: TAU / 5.5, loop: 1 },
    cheer:  { name: 'Ура', n: 6, lo: 4, dur: TAU / 8, loop: 1 },
  };
  // ── Стили: bands — полосы света (3 — как в мире), ink — контур (доля единицы 3D), px — рост в пикселях арта,
  //    levels — уровней на канал, pal — палитра, sketch — штриховка, chibi — большая голова, flat — без светотени ──
  const STYLES = {
    smooth: { name: 'Как в 3D', icon: '🧊', bands: 3 },
    toon:   { name: 'Мультик', icon: '🖍️', bands: 2, ink: .036 },
    flat:   { name: 'Плоский', icon: '🟦', bands: 0, flat: 1, ink: .03 },
    pixel:  { name: '16-бит', icon: '👾', bands: 3, px: 46, levels: 8, inkc: '#1b1426' },
    retro:  { name: '8-бит', icon: '🕹️', bands: 2, px: 26, pal: 'nes', inkc: '#000000' },
    sketch: { name: 'Скетч', icon: '✏️', bands: 3, sketch: 1, ink: .03, inkc: '#2b1f17' },
    chibi:  { name: 'Чиби', icon: '🍡', bands: 2, chibi: 1, ink: .036 },
  };
  const STYLE_LIST = Object.keys(STYLES);
  const EMO = { wave: '👋', dance: '💃', cheer: '🎉' };
  // Палитра «8-бит» (как у NES)
  const NES = ['000000', 'fcfcfc', 'bcbcbc', '7c7c7c', 'a4e4fc', '3cbcfc', '0078f8', '0000fc', 'b8b8f8', '6888fc', '0058f8', '0000bc', 'd8b8f8',
    '9878f8', '6844fc', '4428bc', 'f8b8f8', 'f878f8', 'd800cc', '940084', 'f8a4c0', 'f85898', 'e40058', 'a80020', 'f0d0b0', 'f87858', 'f83800',
    'a81000', 'fce0a8', 'fca044', 'e45c10', '881400', 'f8d878', 'f8b800', 'ac7c00', '503000', 'd8f878', 'b8f818', '00b800', '007800', 'b8f8b8',
    '58d854', '00a800', '006800', 'b8f8d8', '58f898', '00a844', '005800', '00fcfc', '00e8d8', '008888', '004058', 'f8d8f8', '787878']
    .map(h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);

  // ═══ Мелочи ═══
  // Стабильный 53-битный хеш строки (cyrb53)
  function hash(str, seed = 0){
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  const C = () => window.D37Char;
  const isLow = () => { try { return !!document.body?.classList.contains('low'); } catch (e) { return false; } };
  const nFrames = (A, lo) => (lo && A.lo) || A.n;
  // доля цикла кадра i: цикл — i/n (последний кадр не повторяет первый), разовая — от начала до конца
  const kOf = (A, i, n) => (A.loop ? i / n : n > 1 ? i / (n - 1) : 0);
  function frameIndex(A, n, t){
    if (n <= 1) return 0;
    const f = Math.floor(Math.max(0, +t || 0) * n / A.dur + 1e-9);
    return A.loop ? ((f % n) + n) % n : Math.min(n - 1, f);
  }
  // Направление по смещению на экране (y вниз) → 0…7 / 0…3 (4 стороны — 0, 2, 4, 6)
  const dir8 = (dx, dy, cur = 0) => (Math.abs(dx) + Math.abs(dy) < 1e-6 ? cur : ((Math.round(Math.atan2(dx, dy) / (PI / 4)) % 8) + 8) % 8);
  const dir4 = (dx, dy, cur = 0) => (Math.abs(dx) + Math.abs(dy) < 1e-6 ? cur : (((Math.round(Math.atan2(dx, dy) / (PI / 2)) % 4) + 4) % 4) * 2);
  const bakeDirs = (view, full) => (full && VIEWS[view].full) || VIEWS[view].bake;
  // Поворот человечка: 0 — лицом к камере; сторона d → d·45°, в профиль чуть повёрнут к нам (turn) — видно лицо, как в 2.5D-играх
  function yawOf(view, d, anim){
    const V = VIEWS[view];
    if (view === 'side') return anim === 'climb' ? PI : d === 6 ? V.turn - PI / 2 : PI / 2 - V.turn;
    if (view === 'front') return V.yaw;
    const y = d * PI / 4;
    return y - (V.turn || 0) * Math.sin(y);
  }
  // Строка листа для стороны: [строка, зеркалить, смотрит влево]. Сбоку сторону задаёт flip (true — влево) или dir
  function rowOf(view, full, dir, flip){
    const dirs = bakeDirs(view, full);
    let d;
    if (view === 'side') d = (flip != null ? !!flip : dir >= 5 && dir <= 7) ? 6 : 2;
    else if (view === 'front') d = 0;
    else { d = ((Math.round(+dir || 0) % 8) + 8) % 8; if (view === 'iso4') d = (Math.round(d / 2) * 2) % 8; }
    let r = dirs.indexOf(d), fl = false;
    if (r < 0) { r = dirs.indexOf((8 - d) % 8); fl = true; }
    if (view === 'front' && flip) fl = true;
    return [Math.max(0, r), fl, view === 'front' ? !!flip : d >= 5 && d <= 7];
  }

  // ── Образ для ключа: нормализованный look; если частей человечка не хватает — их выберет «отпечаток» key (world3d resolve) ──
  function lookSig(look, key){
    const D = C();
    if (!D) return JSON.stringify(look || {}) + '#' + (key || '');
    const L = D.norm(look);
    return JSON.stringify(L) + (D.BODY_SLOTS.some(s => L[s] === undefined) ? '#' + (key || '') : '');
  }
  function opts(o = {}){
    const view = VIEWS[o.view] ? o.view : 'side';
    const style = STYLES[o.style] ? o.style : styleFor('toon');
    const lo = o.lo != null ? !!o.lo : isLow();
    const dpr = Math.max(1, Math.min(3, +o.dpr || (lo ? 1 : Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1))));
    const size = Math.max(16, Math.min(256, Math.round(+o.size || 64)));
    const St = STYLES[style], dev = Math.round(size * dpr);
    const f = St.px ? Math.max(1, Math.round(dev / St.px)) : 1;   // пиксель-арт: целый множитель увеличения
    return {
      view, style, lo, dpr, size, dev, f, ppu: dev / f / STD, key: String(o.key || 'me'), noItem: !!o.noItem, full: !!o.full,
      shadow: o.shadow != null ? !!o.shadow : view !== 'side', pin: !!o.pin,
      anims: (Array.isArray(o.anims) ? o.anims : ['idle']).filter(a => ANIMS[a]),
    };
  }
  function sheetKey(look, O){
    const L = O.noItem ? { ...(look || {}), item: 'none' } : look;
    return 'v' + VER + '-' + hash([lookSig(L, O.key), O.view, O.dev, O.dpr, O.style, O.lo ? 1 : 0, O.noItem ? 1 : 0, O.shadow ? 1 : 0, O.full ? 1 : 0].join('|')).toString(36);
  }

  // ═══ Выбор стиля игроком (гардероб → «Стиль в играх»): 'auto' — как задумано игрой ═══
  function myStyle(){ try { const s = localStorage.getItem(LS_STYLE); return STYLES[s] ? s : 'auto'; } catch (e) { return 'auto'; } }
  function setMyStyle(s){ try { localStorage.setItem(LS_STYLE, STYLES[s] ? s : 'auto'); } catch (e) {} }
  function styleFor(def){ const s = myStyle(); return s !== 'auto' ? s : STYLES[def] ? def : 'toon'; }
  // Ключ своего персонажа — как в редакторе (charedit), мире и комнатах (GameRoom.guestId): аккаунт или гость вкладки.
  // Невыбранные части человечка выбираются по этому ключу — везде должен быть один и тот же
  function myKey(){
    try { if (typeof currentUser !== 'undefined' && currentUser?.id) return 'u:' + currentUser.id; } catch (e) {}
    let id = '';
    try { id = sessionStorage.getItem('d37_room_gid') || ''; } catch (e) {}
    if (!id) { id = 'g-' + Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem('d37_room_gid', id); } catch (e) {} }
    return 'g:' + id;
  }

  // ═══ Память: листы по ключу, порядок Map = давность (первый — давно не нужен), бюджет в байтах ═══
  const mem = new Map();
  let bytes = 0, budgetB = 0;
  const budgetDefault = () => (isLow() ? 24 : 64) * 1048576;
  function touch(sh){
    const t = now();
    if (t - sh.used < 500) return;
    sh.used = t; mem.delete(sh.k); mem.set(sh.k, sh);
  }
  function account(sh, d){ sh.bytes += d; bytes += d; if (d > 0) evict(); }
  function evict(){
    const lim = budgetB || budgetDefault();
    if (bytes <= lim) return;
    for (const sh of [...mem.values()]) {
      if (bytes <= lim * .85) break;
      if (sh.pin || sh.busy) continue;
      drop(sh);
    }
  }
  function freeImg(img){ try { if (img && img.close) img.close(); else if (img) { img.width = 0; img.height = 0; } } catch (e) {} }
  function drop(sh){
    sh.dead = true;
    for (const a of Object.values(sh.anims)) freeImg(a.img);
    bytes -= sh.bytes; sh.bytes = 0; sh.anims = {};
    if (mem.get(sh.k) === sh) mem.delete(sh.k);
  }

  // ═══ IndexedDB: запись { k, v, cv, at, meta, anims: { имя: { blob, ...рамки } } } ═══
  const DBN = 'd37-sprites', MAX_REC = 160;
  let dbP = null, pruned = false;
  function idb(){
    if (dbP) return dbP;
    dbP = new Promise(res => {
      try {
        if (typeof indexedDB === 'undefined') return res(null);
        const r = indexedDB.open(DBN, 1);
        r.onupgradeneeded = () => { try { r.result.createObjectStore('sheets', { keyPath: 'k' }); } catch (e) {} };
        r.onsuccess = () => res(r.result);
        r.onerror = r.onblocked = () => res(null);
      } catch (e) { res(null); }
    });
    return dbP;
  }
  const req = (q) => new Promise(res => { q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
  async function idbGet(k){ const db = await idb(); if (!db) return null; try { return await req(db.transaction('sheets').objectStore('sheets').get(k)) || null; } catch (e) { return null; } }
  async function idbPut(rec){ const db = await idb(); if (!db) return false; try { await req(db.transaction('sheets', 'readwrite').objectStore('sheets').put(rec)); return true; } catch (e) { return false; } }
  async function idbDel(k){ const db = await idb(); if (!db) return; try { await req(db.transaction('sheets', 'readwrite').objectStore('sheets').delete(k)); } catch (e) {} }
  // Старые записи — прочь (по времени использования), раз за визит
  async function idbPrune(){
    if (pruned) return; pruned = true;
    const db = await idb(); if (!db) return;
    try {
      const list = [];
      await new Promise(res => {
        const c = db.transaction('sheets').objectStore('sheets').openCursor();
        c.onsuccess = () => { const cur = c.result; if (!cur) return res(); const v = cur.value; list.push([v.k, v.v === VER ? v.at || 0 : -1]); cur.continue(); };
        c.onerror = () => res();
      });
      list.sort((a, b) => a[1] - b[1]);
      const kill = list.filter((x, i) => x[1] < 0 || i < list.length - MAX_REC);
      for (const [k] of kill) await idbDel(k);
    } catch (e) {}
  }
  const AMETA = ['cw', 'ch', 'ax', 'ay', 'n', 'rows', 'seat'];
  const saveT = new Map();
  function saveLater(sh){
    if (sh.dead || sh.noSave) return;
    clearTimeout(saveT.get(sh.k));
    saveT.set(sh.k, setTimeout(() => { saveT.delete(sh.k); save(sh); }, 1500));
  }
  async function save(sh){
    if (sh.dead) return;
    const old = await idbGet(sh.k);
    const rec = { k: sh.k, v: VER, cv: sh.cv, at: Date.now(), meta: { view: sh.view, style: sh.style, top: sh.top }, anims: {} };
    if (old && old.v === VER && old.cv === sh.cv) for (const [n, a] of Object.entries(old.anims || {})) rec.anims[n] = a;
    for (const [n, a] of Object.entries(sh.anims)) {
      if (rec.anims[n] && !a.fresh) continue;
      const blob = await (a.blobP || null);
      if (!blob) continue;
      const m = { blob, hand: Array.from(a.hand || []) };
      for (const f of AMETA) m[f] = a[f];
      rec.anims[n] = m;
      a.fresh = false; a.blobP = null;
    }
    if (Object.keys(rec.anims).length) await idbPut(rec);
    setTimeout(idbPrune, 4000);
  }
  async function load(sh){
    const rec = await idbGet(sh.k);
    if (!rec || rec.v !== VER || !rec.anims) return false;
    const cur = W3.version();
    if (cur && rec.cv !== cur) return false;   // персонаж в world3d.js поменялся — печём заново
    let got = 0;
    for (const [n, m] of Object.entries(rec.anims)) {
      if (!ANIMS[n] || sh.anims[n] || !m.blob) continue;
      let img = null;
      try { img = await createImageBitmap(m.blob); } catch (e) { img = null; }
      if (!img || sh.dead) { freeImg(img); continue; }
      const a = { img, hand: Float32Array.from(m.hand || []), fresh: false };
      for (const f of AMETA) a[f] = m[f];
      commit(sh, n, a);
      got++;
    }
    if (got) { sh.cv = rec.cv; sh.src = 'idb'; if (rec.meta?.top) sh.top = rec.meta.top; if (!cur) sh.cvUnknown = true; }
    return got > 0;
  }

  // ═══ Переходник к 3D-человечку (js/games/world3d.js). ВСЕ обращения к World3D — только здесь ═══
  // Нужно от world3d.js: World3D.supported/load/kit(T); kit → build(look, key), animate(ch, moving, dt, t, o), dispose(ch), grad;
  // человечек: root, body, torso, headP, legL/legR, armL/armR (+ armR.userData.La), hipY, phase, blink, emote/emoteT.
  // animate: o.snap — поза сразу, без сглаживания (новый движок); rate (бег > 13), air, sit, crouch, ladder + climbPh, swim.
  // Эмоции — ключи 👋 💃 🎉. Время t «заморожено» (T0 ± 0,1): хвосты, крылья и волосы чуть качаются, но цикл замкнут.
  const W3 = (() => {
    let K = null, T = null, fp = '', loadP = null, failed = false;
    const T0 = 1.5;
    function script(src){
      if (typeof gamesLoadScript === 'function') return gamesLoadScript(src);
      return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src + '?v=' + (typeof GAMES_VER !== 'undefined' ? GAMES_VER : VER);
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    // Только скрипт (без Three.js) — узнать версию персонажа
    async function scriptOnly(){ if (!window.World3D) { try { await script(W3_SRC); } catch (e) { return false; } } return !!window.World3D; }
    function ready(){
      if (K) return Promise.resolve(true);
      if (failed) return Promise.resolve(false);
      if (loadP) return loadP;
      loadP = (async () => {
        if (!await scriptOnly()) return false;
        const W = window.World3D;
        if (!W.supported?.() || !await W.load()) return false;
        T = window.THREE; K = W.kit(T);
        return !!K;
      })().then(ok => { if (!ok) failed = true; loadP = null; return ok; }, () => { failed = true; loadP = null; return false; });
      return loadP;
    }
    // Версия персонажа: номер из world3d.js (если есть) + отпечаток кода kit — поменялся код человечка → листы перепекутся сами
    function version(){
      const W = window.World3D;
      if (!W) return '';
      if (!fp) { try { fp = hash(String(W.kit)).toString(36); } catch (e) { fp = '?'; } }
      return String(W.VERSION ?? W.version ?? W.CHAR_VERSION ?? W.CHAR_VER ?? W.REV ?? '') + ':' + fp;
    }
    function build(look, key){
      const ch = K.build(look, key);
      ch.blink = false;
      for (const o of ch.root.children) if (o.isMesh) o.visible = false;   // круглая тень под ногами — рисуем свою, 2D
      ch.__b = { lg: ch.legL?.scale.y || 1, hp: ch.headP?.scale.x || 1 };
      return ch;
    }
    function dispose(ch){ try { K?.dispose(ch); } catch (e) {} }
    // Полосы света (MeshToonMaterial всех частей берёт одну градиентную карту набора)
    const GRAD = { 3: [140, 200, 255], 2: [118, 255, 255], 0: [255, 255, 255] };
    function bands(n){
      const g = K?.grad, d = g?.image?.data;
      if (!d) return;
      const v = GRAD[n] || GRAD[3];
      if (d[0] === v[0] && d[4] === v[1] && d[8] === v[2]) return;
      for (let i = 0; i < 3; i++) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v[i];
      g.needsUpdate = true;
    }
    const lerpK = (arr, k) => { const x = Math.max(0, Math.min(1, k)) * (arr.length - 1), i = Math.min(arr.length - 2, Math.floor(x)), f = x - i; return arr[i] + (arr[i + 1] - arr[i]) * f; };
    const USE = { ax: [-2.85, -2.3, -1.25, -.3, -.55], az: [.4, .32, .18, .1, .16], ty: [-.32, -.18, .1, .24, .08], tx: [-.06, 0, .12, .18, .06], lx: [.4, .25, -.15, -.4, -.12], ll: [.12, .1, -.15, -.25, -.08], lr: [-.1, -.05, .15, .22, .06] };
    // Поставить позу кадра: k — доля цикла, A — анимация, St — стиль (чиби)
    function pose(ch, anim, k, A, St){
      const t = T0 + (A.loop ? .1 * Math.sin(TAU * k) : .1 * k);
      const o = { snap: true, rate: 10.5, air: false, sit: false, crouch: 0, roll: -1, rollBack: false, hang: false, ladder: false, climbPh: 0, pk: '', pkK: 0, swim: false, dive: false };
      let mv = false;
      ch.emote = null; ch.blink = false; ch.phase = 0;
      if (anim === 'walk' || anim === 'run') { mv = true; ch.phase = TAU * k; if (anim === 'run') o.rate = 15; }
      else if (anim === 'jump' || anim === 'fall') o.air = true;
      else if (anim === 'crouch') o.crouch = 1;
      else if (anim === 'climb') { o.ladder = true; o.climbPh = TAU * k; }
      else if (anim === 'swim') { o.swim = true; mv = true; ch.phase = TAU * k - t * 5.5; }
      else if (anim === 'sit') o.sit = true;
      else if (EMO[anim]) { ch.emote = EMO[anim]; ch.emoteT = t - k * A.dur; }
      K.animate(ch, mv, 0, t, o);
      const { body, torso, headP, legL, legR, armL, armR } = ch, s = Math.sin(TAU * k);
      const set = (b, x, y, z) => { if (b) b.rotation.set(x, y, z); };
      if (anim === 'idle' || anim === 'crouch' || anim === 'sit') {   // дыхание — своё, чтобы цикл замкнулся ровно
        if (torso) torso.scale.y = 1 + .016 * s;
        if (headP && anim !== 'sit') headP.rotation.z = .028 * Math.sin(TAU * k + .8);
        if (anim === 'idle') { if (armL) armL.rotation.z = -.16 - .025 * s; if (armR) armR.rotation.z = .16 + .025 * s; }
      } else if (anim === 'jump' && k < .5) {   // отрыв: колени вверх, руки вверх
        if (legL) legL.rotation.x = -.95; if (legR) legR.rotation.x = .2;
        set(armL, -2.6, 0, -.3); set(armR, -2.6, 0, .3);
        if (torso) torso.rotation.x = -.04;
      } else if (anim === 'fall') {   // падает: руки вверх и машут, ноги болтаются
        if (legL) legL.rotation.x = -.35 + .22 * s; if (legR) legR.rotation.x = .3 - .22 * s;
        set(armL, -2.5 + .22 * s, 0, -.55); set(armR, -2.5 - .22 * s, 0, .55);
        if (torso) torso.rotation.x = -.06;
      } else if (anim === 'hurt') {   // отпрянул назад и «отходит»
        const a = 1 - .8 * k;
        if (torso) torso.rotation.x = -.42 * a;
        if (headP) headP.rotation.set(-.35 * a, 0, .08 * a);
        set(armL, -.55 * a, 0, -.16 - a); set(armR, -.55 * a, 0, .16 + a);
        if (legL) legL.rotation.x = .22 * a; if (legR) legR.rotation.x = -.1 * a;
        if (body) body.position.y = .05 * a;
      } else if (anim === 'use') {   // замах правой рукой сверху вниз с поворотом корпуса
        set(armR, lerpK(USE.ax, k), 0, lerpK(USE.az, k));
        if (torso) torso.rotation.set(lerpK(USE.tx, k), lerpK(USE.ty, k), 0);
        if (armL) armL.rotation.x = lerpK(USE.lx, k);
        if (legL) legL.rotation.x = lerpK(USE.ll, k); if (legR) legR.rotation.x = lerpK(USE.lr, k);
      }
      // чиби: голова больше, ноги короче (тело опускаем, чтобы ноги стояли на земле)
      const B = ch.__b || { lg: 1, hp: 1 }, kl = St?.chibi ? .72 : 1;
      if (legL) legL.scale.y = B.lg * kl; if (legR) legR.scale.y = B.lg * kl;
      if (headP) headP.scale.setScalar(B.hp * (St?.chibi ? 1.32 : 1));
      if (St?.chibi && body) body.position.y -= (ch.hipY || .52) * (1 - kl) * (body.scale.y || 1);
    }
    // Точки в мире (после root.updateMatrixWorld): кисть правой руки и грудь
    function handAt(ch, v){ const a = ch.armR; if (!a) return false; v.set(0, -(a.userData?.La ?? .42) + .03, 0); a.localToWorld(v); return true; }
    function chestAt(ch, v){ const b = ch.torso || ch.body || ch.root; v.set(0, .4, 0); b.localToWorld(v); return v; }
    return {
      ready, version, scriptOnly, build, dispose, bands, pose, handAt, chestAt,
      hip: ch => ch.hipY || .52, get T(){ return T; }, get ok(){ return !!K; }, get failed(){ return failed; },
      _useKit(T2, K2){ T = T2; K = K2 || window.World3D.kit(T2); failed = false; },   // для тестов в node
    };
  })();

  // ═══ Печь: один скрытый WebGLRenderer, сцена со светом, ортографическая камера ═══
  const BK = { R: null, lost: false, scene: null, cam: null, L: null, chars: new Map(), freeT: 0, gl: null };
  function supported(){
    if (BK.gl != null) return BK.gl;
    try {
      if (window.World3D?.supported) return (BK.gl = !!window.World3D.supported());
      const c = document.createElement('canvas'), g = c.getContext('webgl2') || c.getContext('webgl');
      BK.gl = !!g;
      g?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (e) { BK.gl = false; }
    return BK.gl;
  }
  function stage(){
    const T = W3.T;
    if (!BK.scene) {
      BK.scene = new T.Scene();
      const hemi = new T.HemisphereLight('#ffffff', '#b8a68c', .62), sun = new T.DirectionalLight('#fff6e8', .55), fill = new T.DirectionalLight('#dfe8ff', .22);
      sun.position.set(-30, 60, 40); fill.position.set(30, 20, 30);
      BK.scene.add(hemi, sun, fill);
      BK.L = { hemi, sun, fill };
      BK.cam = new T.OrthographicCamera(-1, 1, 1, -1, .1, 80);
    }
    return BK.scene;
  }
  function renderer(){
    if (BK.R && !BK.lost) return BK.R;
    const T = W3.T;
    if (BK.R) { try { BK.R.dispose(); } catch (e) {} }
    const r = new T.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    r.setPixelRatio(1);
    r.outputEncoding = T.sRGBEncoding;
    r.setClearColor(0x000000, 0);
    r.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); BK.lost = true; });
    BK.R = r; BK.lost = false;
    return r;
  }
  // Свет и полосы под стиль: «плоский» — свет со всех сторон одинаковый
  function lightFor(St){
    W3.bands(St.bands ?? 3);
    const L = BK.L;
    if (!L) return;
    if (St.flat) { L.hemi.color.set('#ffffff'); L.hemi.groundColor.set('#ffffff'); L.hemi.intensity = .74; L.sun.intensity = .26; L.fill.intensity = 0; }
    else { L.hemi.color.set('#ffffff'); L.hemi.groundColor.set('#b8a68c'); L.hemi.intensity = .62; L.sun.intensity = .55; L.fill.intensity = .22; }
  }
  function aim(el){
    const c = BK.cam;
    c.position.set(0, 1.1 + Math.sin(el) * 30, Math.cos(el) * 30);
    c.up.set(0, 1, 0);
    c.lookAt(0, 1.1, 0);
    c.updateMatrixWorld(true);
    return c.matrixWorldInverse;
  }
  // Готовый человечек листа (кэш на 2 листа: перепечь соседей без пересборки)
  function charOf(sh){
    let c = BK.chars.get(sh.k);
    if (c) { BK.chars.delete(sh.k); BK.chars.set(sh.k, c); return c; }
    while (BK.chars.size >= 2) { const [k0, c0] = BK.chars.entries().next().value; BK.chars.delete(k0); c0.root.parent?.remove(c0.root); W3.dispose(c0); }
    c = W3.build(sh.look, sh.key);
    BK.chars.set(sh.k, c);
    return c;
  }
  function freeChars(){ for (const c of BK.chars.values()) { c.root.parent?.remove(c.root); W3.dispose(c); } BK.chars.clear(); }

  // ── Границы кадра на экране (в единицах камеры): пересечение коробки и шара каждой детали — тесно и надёжно ──
  let V3 = null, V3b = null, M4 = null, SC = null;
  function tmp(){ const T = W3.T; if (!V3) { V3 = new T.Vector3(); V3b = new T.Vector3(); M4 = new T.Matrix4(); SC = new T.Vector3(); } }
  function rectOf(root, inv, R){
    tmp();
    root.traverseVisible(o => {
      if (o.isSprite) {
        V3.setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv); SC.setFromMatrixScale(o.matrixWorld);
        const hx = SC.x / 2, hy = SC.y / 2;
        R.x0 = Math.min(R.x0, V3.x - hx); R.x1 = Math.max(R.x1, V3.x + hx); R.y0 = Math.min(R.y0, V3.y - hy); R.y1 = Math.max(R.y1, V3.y + hy);
        return;
      }
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingSphere) g.computeBoundingSphere();
      M4.multiplyMatrices(inv, o.matrixWorld);
      const b = g.boundingBox;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        V3.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(M4);
        if (V3.x < x0) x0 = V3.x; if (V3.x > x1) x1 = V3.x; if (V3.y < y0) y0 = V3.y; if (V3.y > y1) y1 = V3.y;
      }
      const s = g.boundingSphere, r = s.radius * M4.getMaxScaleOnAxis();
      V3.copy(s.center).applyMatrix4(M4);
      x0 = Math.max(x0, V3.x - r); x1 = Math.min(x1, V3.x + r); y0 = Math.max(y0, V3.y - r); y1 = Math.min(y1, V3.y + r);
      if (x1 < x0 || y1 < y0) return;
      if (x0 < R.x0) R.x0 = x0; if (x1 > R.x1) R.x1 = x1; if (y0 < R.y0) R.y0 = y0; if (y1 > R.y1) R.y1 = y1;
    });
    return R;
  }
  // Раскладка клетки: якорь (ноги) — целый пиксель, поля pad
  function layout(R, ox, oy, ppu, pad){
    const ax = Math.ceil((ox - R.x0) * ppu + pad), ay = Math.ceil((R.y1 - oy) * ppu + pad);
    const cw = ax + Math.ceil((R.x1 - ox) * ppu + pad), ch = ay + Math.ceil((oy - R.y0) * ppu + pad);
    return { ax, ay, cw, ch, left: ox - ax / ppu, top: oy + ay / ppu };
  }
  function posed(ch, anim, A, i, n, sh, d){
    W3.pose(ch, anim, kOf(A, i, n), A, STYLES[sh.style]);
    ch.root.position.set(0, 0, 0);
    ch.root.rotation.set(0, yawOf(sh.view, d, anim), 0);
    ch.root.updateMatrixWorld(true);
  }
  // План анимации (без рисования): все позы → общая клетка, якорь, точки кисти. Его же проверяет scripts/sprite-test.cjs
  function plan(sh, anim, ch){
    const A = ANIMS[anim], n = nFrames(A, sh.lo), dirs = bakeDirs(sh.view, sh.full), V = VIEWS[sh.view];
    stage();
    const inv = aim(V.el);
    const R = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const d of dirs) for (let i = 0; i < n; i++) { posed(ch, anim, A, i, n, sh, d); rectOf(ch.root, inv, R); }
    tmp();
    V3.set(0, 0, 0).applyMatrix4(inv);
    const ox = V3.x, oy = V3.y;
    if (!isFinite(R.x0)) { R.x0 = ox - .6; R.x1 = ox + .6; R.y0 = oy; R.y1 = oy + 2.4; }
    // якорь (точка земли под ногами) — всегда в клетке, даже когда сидит; тень — вокруг него
    const rx = sh.shadow ? .52 : 0, ry = sh.shadow ? rx * Math.sin(V.el) + .02 : 0;
    R.x0 = Math.min(R.x0, ox - rx); R.x1 = Math.max(R.x1, ox + rx); R.y0 = Math.min(R.y0, oy - ry); R.y1 = Math.max(R.y1, oy + ry);
    const St = STYLES[sh.style], ink = St.px ? 1 : St.ink ? Math.max(1, Math.round(St.ink * sh.ppu)) : 0;
    const Lo = layout(R, ox, oy, sh.ppu, ink + 2);
    return { A, n, dirs, rows: dirs.length, inv, ...Lo, el: V.el, seat: anim === 'sit' ? Math.round((W3.hip(ch) - .03) * Math.cos(V.el) * sh.ppu) : undefined };
  }
  // Точка кисти и «рука за телом» для кадра (после posed)
  function handOf(ch, P, ppu, out, j){
    tmp();
    if (!W3.handAt(ch, V3)) { out[j] = out[j + 1] = 0; out[j + 2] = 0; return; }
    V3.applyMatrix4(P.inv);
    W3.chestAt(ch, V3b).applyMatrix4(P.inv);
    out[j] = Math.round(((V3.x - P.left) * ppu - P.ax) * 10) / 10;
    out[j + 1] = Math.round(((P.top - V3.y) * ppu - P.ay) * 10) / 10;
    out[j + 2] = V3.z < V3b.z - .05 ? 1 : 0;   // дальше от камеры, чем грудь
  }

  // ── Холсты и обработка под стиль ──
  function canvas(w, h){ const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }
  // Контур: силуэт тёмным цветом со сдвигами вокруг, сверху — сам кадр (поля клетки не дают залезть к соседу)
  function ink(cv, w, col){
    if (w < 1) return;
    const sil = canvas(cv.width, cv.height), g = sil.getContext('2d');
    g.drawImage(cv, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, sil.width, sil.height);
    const out = canvas(cv.width, cv.height), q = out.getContext('2d'), steps = w > 1 ? 12 : 8;
    for (let a = 0; a < steps; a++) q.drawImage(sil, Math.round(Math.cos(a / steps * TAU) * w), Math.round(Math.sin(a / steps * TAU) * w));
    q.drawImage(cv, 0, 0);
    const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); c.drawImage(out, 0, 0);
    sil.width = out.width = 0;
  }
  // Пиксель-арт: жёсткая прозрачность, палитра, контур в 1 пиксель, тень — без сглаживания. По строке клеток за раз
  // (между клетками — поля, соседние строки друг другу не мешают)
  function pixelBand(g, St, P, y0, shadow, map){
    const W = g.canvas.width, H = P.ch, im = g.getImageData(0, y0, W, H), d = im.data;
    const op = new Uint8Array(W * H), lv = St.levels ? 255 / (St.levels - 1) : 0;
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      if (d[i + 3] < 110) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue; }
      op[p] = 1; d[i + 3] = 255;
      if (lv) { d[i] = Math.round(d[i] / lv) * lv; d[i + 1] = Math.round(d[i + 1] / lv) * lv; d[i + 2] = Math.round(d[i + 2] / lv) * lv; }
      else if (St.pal === 'nes') {
        const key = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | d[i + 2] >> 3;
        let c = map.get(key);
        if (!c) {
          let best = 1e9;
          for (const q of NES) { const dr = q[0] - d[i], dg = q[1] - d[i + 1], db = q[2] - d[i + 2], e = dr * dr * 3 + dg * dg * 4 + db * db * 2; if (e < best) { best = e; c = q; } }
          map.set(key, c);
        }
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
      }
    }
    const ic = parseInt((St.inkc || '#000000').slice(1), 16), ir = ic >> 16, ig = (ic >> 8) & 255, ib = ic & 255;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (op[p] || !(op[p - 1] === 1 || op[p + 1] === 1 || op[p - W] === 1 || op[p + W] === 1)) continue;
      const i = p * 4; d[i] = ir; d[i + 1] = ig; d[i + 2] = ib; d[i + 3] = 255; op[p] = 2;
    }
    if (shadow) {   // тень: эллипс под ногами в каждой клетке, только в пустых пикселях
      const rx = .52 * P.ppu, ry = Math.max(1, rx * Math.sin(P.el));
      for (let c = 0; c < P.n; c++) {
        const cx = c * P.cw + P.ax, cy = P.ay;
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const u = (x + .5 - cx) / rx, v = (y + .5 - cy) / ry;
          if (u * u + v * v > 1 || op[y * W + x]) continue;
          const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = 72;
        }
      }
    }
    g.putImageData(im, 0, y0);
  }
  // Скетч: приглушённые цвета «на бумаге» и штриховка в тени (сетка — от клетки, у всех кадров одинаковая)
  function sketchBand(g, P, y0){
    const W = g.canvas.width, H = P.ch, im = g.getImageData(0, y0, W, H), d = im.data;
    const gap = Math.max(3, Math.round(P.ppu * .085));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!d[i + 3]) continue;
      const r = d[i], gg = d[i + 1], b = d[i + 2], L = (r * .3 + gg * .59 + b * .11) / 255, gr = L * 255;
      let R2 = r * .62 + gr * .38, G2 = gg * .62 + gr * .38, B2 = b * .62 + gr * .38;
      R2 += (243 - R2) * .16; G2 += (234 - G2) * .16; B2 += (217 - B2) * .16;
      const cx = x % P.cw, cy = y;
      let k = 1;
      if (L < .66 && (cx + cy) % gap === 0) k *= .66;
      if (L < .42 && (cx - cy + 1e4) % gap === 0) k *= .7;
      d[i] = R2 * k; d[i + 1] = G2 * k; d[i + 2] = B2 * k;
    }
    g.putImageData(im, 0, y0);
  }
  function shadows(cv, P, n, rows, col){
    const g = cv.getContext('2d'), rx = .52 * P.ppu, ry = Math.max(1, rx * Math.sin(P.el));
    g.save(); g.globalCompositeOperation = 'destination-over'; g.fillStyle = col;
    for (let r = 0; r < rows; r++) for (let c = 0; c < n; c++) { g.beginPath(); g.ellipse(c * P.cw + P.ax, r * P.ch + P.ay, rx, ry, 0, 0, TAU); g.fill(); }
    g.restore();
  }
  async function post(cv, sh, P){
    const St = STYLES[sh.style], g = cv.getContext('2d');
    P.ppu = sh.ppu;
    if (St.px) { const map = new Map(); for (let r = 0; r < P.rows; r++) { pixelBand(g, St, P, r * P.ch, sh.shadow, map); await maybePause(); } return; }
    if (St.sketch) for (let r = 0; r < P.rows; r++) { sketchBand(g, P, r * P.ch); await maybePause(); }
    if (St.ink) ink(cv, Math.max(1, Math.round(St.ink * sh.ppu)), St.inkc || '#17111f');
    if (sh.shadow) shadows(cv, P, P.n, P.rows, St.sketch ? 'rgba(60,45,30,.22)' : 'rgba(0,0,0,.24)');
  }

  // ═══ Очередь выпечки: по одной анимации, по кадру за раз, в простое ═══
  const Q = [];
  let running = false, seq = 0, sliceAt = 0, sliceMax = 0, step = '';
  const BUDGET = 7;   // мс на кусок работы между паузами
  const STATS = { baked: 0, frames: 0, ms: 0, cpu: 0, idb: 0, log: [], first: null, long: [] };
  const idle = fn => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 80 }) : setTimeout(fn, 16));
  // Время работы (без ожидания простоя): сколько печь реально заняла главный поток; sliceMax — самый длинный кусок
  const busy = () => STATS.cpu + (sliceAt ? now() - sliceAt : 0);
  function endSlice(){
    if (!sliceAt) return;
    const d = now() - sliceAt;
    STATS.cpu += d; sliceAt = 0;
    if (d > sliceMax) sliceMax = d;
    if (d > 16) { STATS.long.push(step + ' ' + Math.round(d)); if (STATS.long.length > 30) STATS.long.shift(); }   // долгие куски — что именно
  }
  const pause = () => { endSlice(); return new Promise(r => idle(() => { sliceAt = now(); r(); })); };
  async function maybePause(){ if (now() - sliceAt > BUDGET) await pause(); }
  // Перед тяжёлым (сборка человечка — 15–30 мс одним куском) ждём настоящий простой браузера (до 0,6 с), чтобы игра не теряла кадр
  function longIdle(ms){
    endSlice();
    return new Promise(res => {
      const t0 = now(), go = () => { sliceAt = now(); res(); };
      if (typeof requestIdleCallback !== 'function') return setTimeout(go, 16);
      const f = dl => { if (dl.timeRemaining() >= ms || now() - t0 > 600) go(); else requestIdleCallback(f, { timeout: 120 }); };
      requestIdleCallback(f, { timeout: 120 });
    });
  }
  function enqueue(sh, anim, pr, force){
    if (!ANIMS[anim] || sh.dead || sh.fallback) return;
    if (!force && (sh.anims[anim] || sh.jobs.has(anim))) return;
    if (sh.jobs.has(anim)) return;
    sh.jobs.add(anim);
    Q.push({ sh, anim, pr, at: seq++, force: !!force });
    run();
  }
  async function run(){
    if (running) return;
    running = true;
    try {
      while (Q.length) {
        await pause();
        if (!W3.ok) {   // первый раз: скачать world3d.js и Three.js (это не работа главного потока — не считаем)
          endSlice();
          const ok = await W3.ready();
          sliceAt = now();
          if (!ok) { for (const j of Q.splice(0)) { j.sh.jobs.delete(j.anim); fallbackSheet(j.sh); } break; }
        }
        Q.sort((a, b) => a.pr - b.pr || a.at - b.at);
        const j = Q.shift();
        const stale = !j.sh.pin && !j.sh.waiters.length && now() - j.sh.used > 20000;   // лист давно никто не рисует и не ждёт — не тратим время
        if (j.sh.dead || stale || (!j.force && j.sh.anims[j.anim])) { j.sh.jobs.delete(j.anim); continue; }
        j.sh.busy = true;
        try { await bake(j.sh, j.anim); } catch (e) { j.sh.err = String(e?.message || e); if (BK.lost) BK.R = null; }
        j.sh.busy = false; j.sh.jobs.delete(j.anim);
      }
    } finally {
      endSlice();
      running = false;
      clearTimeout(BK.freeT);
      BK.freeT = setTimeout(() => { if (!running && !Q.length) { freeChars(); if (BK.R) { try { BK.R.dispose(); BK.R.forceContextLoss?.(); } catch (e) {} BK.R = null; } } }, 30000);
    }
  }
  async function bake(sh, anim){
    const t0 = now(), c0 = busy();
    if (!BK.chars.has(sh.k)) await longIdle(22);
    if (sh.dead) return;
    step = BK.chars.has(sh.k) ? 'plan' : 'build';
    const St = STYLES[sh.style], ch = charOf(sh), v = W3.version();
    // лист из кэша печён старой версией персонажа — допечём и остальные анимации заново
    if (sh.cv && sh.cv !== v) for (const a of Object.keys(sh.anims)) if (a !== anim) enqueue(sh, a, 6, true);
    sh.cv = v; sh.cvUnknown = false;
    stage(); lightFor(St);
    const P = plan(sh, anim, ch);
    await maybePause();
    if (sh.dead) return;
    step = BK.R ? 'render' : 'renderer';
    const r = renderer(), scene = stage(), cam = BK.cam;
    r.setSize(P.cw, P.ch, false);
    cam.left = P.left; cam.right = P.left + P.cw / sh.ppu; cam.top = P.top; cam.bottom = P.top - P.ch / sh.ppu; cam.updateProjectionMatrix();
    const cv = canvas(P.cw * P.n, P.ch * P.rows), g = cv.getContext('2d', St.px || St.sketch ? { willReadFrequently: true } : undefined);
    const hand = new Float32Array(P.rows * P.n * 3);
    for (const o of [...scene.children]) if (o.userData?.d37spr) scene.remove(o);
    ch.root.userData.d37spr = 1;
    scene.add(ch.root);
    let n = 0;
    for (let row = 0; row < P.rows; row++) for (let i = 0; i < P.n; i++) {
      posed(ch, anim, P.A, i, P.n, sh, P.dirs[row]);
      if (n === 1) step = 'render';
      r.render(scene, cam);
      g.drawImage(r.domElement, i * P.cw, row * P.ch);   // сразу после render — буфер ещё цел
      handOf(ch, P, sh.ppu, hand, (row * P.n + i) * 3);
      n++;
      await maybePause();
      if (sh.dead || BK.lost) { scene.remove(ch.root); return; }
    }
    scene.remove(ch.root);
    step = 'post ' + sh.style;
    await post(cv, sh, P);
    if (sh.dead) return;
    const a = { img: cv, cw: P.cw, ch: P.ch, ax: P.ax, ay: P.ay, n: P.n, rows: P.rows, hand, seat: P.seat, fresh: true };
    // ImageBitmap — быстрее рисовать; PNG для IndexedDB снимаем с холста сразу (он копируется синхронно)
    a.blobP = !sh.noSave && cv.toBlob ? new Promise(res => { try { cv.toBlob(res, 'image/png'); } catch (e) { res(null); } }) : null;
    commit(sh, anim, a);
    if (typeof createImageBitmap === 'function') createImageBitmap(cv).then(bmp => { if (sh.dead || sh.anims[anim] !== a) { bmp.close?.(); return; } a.img = bmp; setTimeout(() => { cv.width = cv.height = 0; }, 0); }, () => {});
    const ms = now() - t0, cpu = busy() - c0;
    STATS.baked++; STATS.frames += n; STATS.ms += cpu;
    STATS.log.push({ k: sh.k, anim, view: sh.view, style: sh.style, frames: n, cpu: Math.round(cpu * 10) / 10, wall: Math.round(ms), kb: Math.round(P.cw * P.n * P.ch * P.rows * 4 / 1024) });
    if (STATS.log.length > 60) STATS.log.shift();
    if (anim === 'idle' && STATS.first == null && sh.t0) STATS.first = Math.round(now() - sh.t0);
    saveLater(sh);
  }
  // Готовая анимация в лист: память, ожидающие
  function commit(sh, anim, a){
    const old = sh.anims[anim];
    if (old) { account(sh, -old.bytes); freeImg(old.img); }
    a.bytes = a.cw * a.n * a.ch * a.rows * 4;
    sh.anims[anim] = a;
    account(sh, a.bytes);
    if (anim === 'idle' || !sh.top) sh.top = a.ay;
    for (const w of sh.waiters.splice(0)) { if (w.all ? w.list.every(x => sh.anims[x]) : sh.anims[w.anim] || w.anim === '*') w.res(sh); else sh.waiters.push(w); }
  }
  function fallbackSheet(sh){ sh.fallback = true; for (const w of sh.waiters.splice(0)) w.res(sh); }

  // ═══ Листы: из памяти, из IndexedDB или в печь ═══
  function ensure(look, O, k){
    let sh = mem.get(k);
    if (sh && !sh.dead) { touch(sh); if (O.pin) sh.pin = true; return sh; }
    const L = O.noItem ? { ...(C()?.norm(look) || look || {}), item: 'none' } : (C()?.norm(look) || look || {});
    sh = {
      k, look: L, key: O.key, view: O.view, style: O.style, size: O.size, dpr: O.dpr, dev: O.dev, f: O.f, ppu: O.ppu, lo: O.lo, full: O.full,
      shadow: O.shadow, noItem: O.noItem, pin: O.pin, px: !!STYLES[O.style].px, nom: STD * O.ppu,
      anims: {}, jobs: new Set(), waiters: [], bytes: 0, used: now(), t0: now(), dead: false, busy: false, cv: '', top: 0,
      pet: C()?.petEmoji?.(look) || '', fallback: !supported(), src: 'bake',
    };
    mem.set(k, sh);
    if (sh.fallback) return sh;
    const want = O.anims.length ? O.anims : ['idle'];
    sh.loading = load(sh).catch(() => false).then(got => {
      sh.loading = null;
      if (sh.dead) return;
      if (got) STATS.idb++;
      const base = O.pin ? 0 : 1;
      enqueue(sh, 'idle', base);
      for (const a of want) if (a !== 'idle') enqueue(sh, a, base + 3);
      if (sh.cvUnknown) verifyLater();
    });
    return sh;
  }
  // Лист из кэша при выключенном world3d.js: позже (в простое) сверим версию персонажа и перепечём устаревшие
  let verifyP = null;
  function verifyLater(){
    if (verifyP) return;
    verifyP = new Promise(r => setTimeout(r, 3500)).then(() => W3.scriptOnly()).then(ok => {
      if (!ok) return;
      const v = W3.version();
      for (const sh of mem.values()) {
        if (!sh.cvUnknown || sh.dead) continue;
        sh.cvUnknown = false;
        if (sh.cv && sh.cv !== v) { sh.cv = ''; for (const a of Object.keys(sh.anims)) enqueue(sh, a, 6, true); }
      }
    });
  }
  // Попросить анимацию: нет — допечётся (своему — раньше)
  function request(sh, anim){ if (!sh.anims[anim] && !sh.jobs.has(anim) && !sh.loading && !sh.fallback) enqueue(sh, anim, sh.pin ? 2 : 3); }

  // ═══ Кадр и рисование ═══
  // → { img, sx, sy, sw, sh, ax, ay, flip, i, row, a, anim } или null (листа ещё нет)
  function frame(sh, anim, t, dir, flip){
    if (!sh || sh.dead || sh.fallback) return null;
    let a = sh.anims[anim];
    if (!a) {
      request(sh, anim);
      if (anim === 'run' && sh.anims.walk) { anim = 'walk'; a = sh.anims.walk; }
      else if (anim === 'fall' && sh.anims.jump) { anim = 'jump'; a = sh.anims.jump; }
      else { anim = 'idle'; a = sh.anims.idle; }
      if (!a) return null;
    }
    const [row, fl, left] = rowOf(sh.view, sh.full, dir ?? 0, flip);
    const r = Math.min(a.rows - 1, row), i = frameIndex(ANIMS[anim], a.n, t);
    return { img: a.img, sx: i * a.cw, sy: r * a.ch, sw: a.cw, sh: a.ch, ax: a.ax, ay: a.ay, flip: fl, left, i, row: r, a, anim };
  }
  // Эмодзи в руку (кэш картинок)
  const emoC = new Map();
  function emoImg(e, px){
    px = Math.max(8, Math.round(px / 4) * 4);
    const k = e + '|' + px;
    let c = emoC.get(k);
    if (c) return c;
    if (emoC.size > 120) emoC.clear();
    c = canvas(Math.ceil(px * 1.3), Math.ceil(px * 1.3));
    const g = c.getContext('2d');
    g.font = `${px}px ${EF}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#000';
    g.fillText(e, c.width / 2, c.height / 2 + px * .05);
    emoC.set(k, c);
    return c;
  }
  function drawItem(ctx, F, k, x, y, e, size){
    const j = (F.row * F.a.n + F.i) * 3, h = F.a.hand;
    if (!h || h.length <= j) return;
    const c = emoImg(e, size), w = size * 1.3, s = F.left ? -1 : 1;
    // эмодзи держится в кисти: чуть выше и вперёд неё (как у старого 2D-персонажа); смотрит влево — зеркалим
    ctx.save(); ctx.translate(x + h[j] * k * (F.flip ? -1 : 1), y + h[j + 1] * k); ctx.scale(s, 1); ctx.rotate(-.25);
    ctx.drawImage(c, -w * .38, -w * .7, w, w);
    ctx.restore();
  }
  // Нарисовать кадр ногами в (x, y): o.dir / o.flip, o.h (рост size в единицах ctx) или o.scale, o.alpha, o.item (эмодзи в руку)
  function draw(ctx, sh, anim, t, x, y, o = {}){
    const F = frame(sh, anim, t, o.dir, o.flip);
    if (!F) return false;
    const k = (o.h != null ? o.h : sh.size * (o.scale ?? 1)) / sh.nom;
    const a0 = ctx.globalAlpha, sm = ctx.imageSmoothingEnabled;
    if (o.alpha != null) ctx.globalAlpha = a0 * o.alpha;
    if (sh.px) ctx.imageSmoothingEnabled = false;
    const it = o.item, isz = (o.itemSize || .3) * sh.nom * k;
    const behind = it && F.a.hand && F.a.hand[(F.row * F.a.n + F.i) * 3 + 2] > 0;
    if (it && behind) drawItem(ctx, F, k, x, y, it, isz);
    if (F.flip) {
      ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1);
      ctx.drawImage(F.img, F.sx, F.sy, F.sw, F.sh, -F.ax * k, -F.ay * k, F.sw * k, F.sh * k);
      ctx.restore();
    } else ctx.drawImage(F.img, F.sx, F.sy, F.sw, F.sh, x - F.ax * k, y - F.ay * k, F.sw * k, F.sh * k);
    if (it && !behind) drawItem(ctx, F, k, x, y, it, isz);
    if (sh.px) ctx.imageSmoothingEnabled = sm;
    ctx.globalAlpha = a0;
    touch(sh);
    return true;
  }
  // Запас: старый 2D-персонаж (avatar.js), пока лист печётся или нет WebGL
  function drawOld(ctx, look, view, anim, t, x, y, o, nominal){
    const D = C();
    if (!D) return false;
    const px = Math.max(8, nominal * .9), a0 = ctx.globalAlpha;
    if (o.alpha != null) ctx.globalAlpha = a0 * o.alpha;
    let s;
    if ((view === 'iso4' || view === 'iso8') && D.walker) {
      const d = ((Math.round(+o.dir || 0) % 8) + 8) % 8, face = d === 0 ? 0 : d === 4 ? 2 : d < 4 ? 1 : 3;
      s = D.walker(look, px, { face, moving: anim === 'walk' || anim === 'run', t, noPet: true });
    } else s = D.sprite(look, px, { dir: (o.flip ?? (o.dir >= 5 && o.dir <= 7)) ? -1 : 1, t, noPet: true, item: o.item });
    ctx.drawImage(s.c, x - s.ax, y - s.ay);
    ctx.globalAlpha = a0;
    return true;
  }

  // ═══ Для игр: ручка листа — сама переживает вытеснение из памяти и смену образа ═══
  function handle(look, o = {}){
    const O = opts(o);
    const H = {
      O, look: look || {}, k: '', sh: null,
      set(look2, o2){
        if (o2) Object.assign(H.O, opts({ ...o, ...o2 }));
        const k = sheetKey(look2 || {}, H.O);
        if (k !== H.k) { H.k = k; H.look = look2 || {}; H.sh = null; }
        return H;
      },
      get sheet(){ if (!H.sh || H.sh.dead) H.sh = ensure(H.look, H.O, H.k); return H.sh; },
      ready(anim = 'idle'){ const s = H.sheet; return !!(s && s.anims[anim]); },
      want(...list){ const s = H.sheet; for (const a of list.flat()) if (s && ANIMS[a]) request(s, a); return H; },
      frame(anim, t, dir, flip){ return frame(H.sheet, anim, t, dir, flip); },
      hand(anim, t, dir, flip){ const F = frame(H.sheet, anim, t, dir, flip); if (!F || !F.a.hand) return null; const j = (F.row * F.a.n + F.i) * 3; return [F.a.hand[j] * (F.flip ? -1 : 1), F.a.hand[j + 1], F.a.hand[j + 2] > 0]; },
      // ноги в (x, y); d: dir / flip, h, scale, alpha, item; false — нечем рисовать
      draw(ctx, anim, t, x, y, d = {}){
        const sh = H.sheet;
        if (sh && draw(ctx, sh, anim, t, x, y, d)) return true;
        const nominal = d.h != null ? d.h : H.O.size * (d.scale ?? 1);
        return drawOld(ctx, H.look, H.O.view, anim, t, x, y, d, nominal);
      },
      // рост в единицах ctx над ногами (для ника): h — как в draw
      top(h){ const s = H.sheet; return (h ?? H.O.size) * (s && s.top ? s.top / s.nom : 1); },
      wait(anim = 'idle'){ return waitFor(H.sheet, anim); },
    };
    H.set(look);
    return H;
  }
  function waitFor(sh, anim, all, list){
    if (!sh) return Promise.resolve(null);
    if (sh.fallback || sh.dead) return Promise.resolve(sh);
    if (all ? list.every(x => sh.anims[x]) : sh.anims[anim]) return Promise.resolve(sh);
    return new Promise(res => sh.waiters.push({ anim, all, list, res }));
  }
  // Лист целиком: дождаться idle (или всех o.anims при o.all)
  function sheet(look, o = {}){
    const O = opts(o), sh = ensure(look, O, sheetKey(look || {}, O));
    if (o.all) { for (const a of O.anims) request(sh, a); return waitFor(sh, null, true, O.anims.length ? O.anims : ['idle']); }
    return waitFor(sh, O.anims[0] || 'idle');
  }
  function get(look, o = {}){ const O = opts(o); return ensure(look, O, sheetKey(look || {}, O)); }

  // ── Один атлас на весь лист (для песочницы «Студии игр»): анимации друг под другом + таблица кадров ──
  function pack(sh, list){
    const names = (list || Object.keys(ANIMS)).filter(n => sh?.anims[n]);
    if (!names.length) return null;
    let W = 0, H = 0;
    for (const n of names) { const a = sh.anims[n]; W = Math.max(W, a.cw * a.n); H += a.ch * a.rows; }
    const cv = canvas(W, H), g = cv.getContext('2d');
    const meta = { v: VER, view: sh.view, dirs: bakeDirs(sh.view, sh.full), nom: Math.round(sh.nom * 100) / 100, px: sh.px ? 1 : 0, top: sh.top, pet: sh.pet || '', anims: {} };
    let y = 0;
    for (const n of names) {
      const a = sh.anims[n], A = ANIMS[n];
      g.drawImage(a.img, 0, y);
      meta.anims[n] = { y, cw: a.cw, ch: a.ch, n: a.n, rows: a.rows, ax: a.ax, ay: a.ay, dur: Math.round(A.dur * 1000) / 1000, loop: A.loop, hand: Array.from(a.hand || []), seat: a.seat };
      y += a.ch * a.rows;
    }
    return { canvas: cv, meta };
  }

  function stats(){
    let sheets = 0, anims = 0;
    for (const sh of mem.values()) { sheets++; anims += Object.keys(sh.anims).length; }
    return { sheets, anims, bytes, mb: Math.round(bytes / 1048576 * 10) / 10, budgetMb: Math.round((budgetB || budgetDefault()) / 1048576), queue: Q.length, running,
      baked: STATS.baked, frames: STATS.frames, cpuMs: Math.round(STATS.ms), cpuPerFrame: STATS.frames ? Math.round(STATS.ms / STATS.frames * 100) / 100 : 0, longestSliceMs: Math.round(sliceMax * 10) / 10, longSlices: STATS.long.slice(),
      fromIdb: STATS.idb, firstIdleMs: STATS.first, gl: supported(), w3: W3.ok, log: STATS.log.slice(-20) };
  }
  function clear(all){
    for (const sh of [...mem.values()]) drop(sh);
    Q.length = 0; freeChars();
    if (all) idb().then(db => { try { db?.transaction('sheets', 'readwrite').objectStore('sheets').clear(); } catch (e) {} });
  }

  window.D37Sprite = {
    VER, STD, VIEWS, ANIMS, STYLES, STYLE_LIST,
    supported, handle, sheet, get, frame, draw, pack, dir8, dir4, frameIndex,
    styleFor, myStyle, setMyStyle, myKey, stats, clear,
    budget(mb){ if (mb > 0) { budgetB = mb * 1048576; evict(); } return Math.round((budgetB || budgetDefault()) / 1048576); },
    _test: { hash, lookSig, opts, sheetKey, kOf, nFrames, rowOf, yawOf, layout, plan, rectOf, posed, mem, evict, account, drop, commit, ensure, W3, STATS, handOf, pixelBand, sketchBand, BK },
  };
})();
