// ═══════════════════════════════════════
//  «ПОДЗЕМЬЕ» ⛏ (#/games/podzem) — своя песочница «вид сбоку»: бесконечный мир по зерну, копать и строить, крафт и плавка,
//  свет и тьма, вода и лава, мобы днём и ночью, два босса, «Проводник», сохранения, моды. Игрок — свой персонаж сайта.
// ═══════════════════════════════════════
// Файлы: podzem-core.js (данные, генерация, свет, жидкости, столкновения — и в потоке), podzem-gl.js (атлас + WebGL2),
// podzem-mods.js (моды: проверка, песочница JS/Lua, события), podzem-ui.js (интерфейс), этот — игра (G).
// Поток (Worker из текста PZ_CORE) генерирует чанки и считает свет; игра шлёт ему правки клеток (блок, стена, лава).
// Сохранения — IndexedDB «d37-podzem»: миры (зерно + только изменённые чанки + сундуки), персонажи, моды. Раз в 45 с, при
// уходе со вкладки и при выходе; вкладку закрыли посреди правок — изменённые чанки ещё и в localStorage (журнал), при
// следующем входе журнал вливается в базу. Экспорт/импорт мира и персонажа — файл .json.
// Награды сайта (docs/ECONOMY.md): победа над боссом — game_result 'podzem_boss1' / 'podzem_boss2' (XP — в общем лимите
// «одна игра = 3 победы в день»), рекорд глубины — 'podzem' (очки = метры, без XP), монеты за босса — D37Coins.run('podzem').
// Проверка: node scripts/tiles-test.cjs; в браузере — GAME_IMPL.podzem._test (state, tp, give, time, bench).
(() => {
  const PZ = window.PZ;
  if (!PZ) return;
  const { CS, CB, CM, CA, P, T, ITEMS, TILES, RECIPES } = PZ;
  const GAME_IMPL = window.GAME_IMPL = window.GAME_IMPL || {};
  const DAY_LEN = 1200, NIGHT0 = .62;           // сутки 20 мин: день 0…0,62, ночь — дальше
  const REACH = 5.8, INV_N = 40, HOT_N = 10, CHEST_N = 20;
  const PL_W = 1.15, PL_H = 2.62, PL_SPR = 2.95;
  const GRAV = 58, MAXFALL = 30, M_PER_TILE = .5;
  const SAVE_EVERY = 45, LS_JOURNAL = 'd37_podzem_journal', LS_OPT = 'd37_podzem_opt', LS_LAST = 'd37_podzem_last';
  const now = () => performance.now();
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rand = () => Math.random();
  const kOf = PZ.key;

  // ═══ База (IndexedDB) ═══
  const DB = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') { rej(new Error('нет IndexedDB')); return; }
      const r = indexedDB.open('d37-podzem', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ['worlds', 'chars', 'mods']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    }));
    const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error || new Error('база')); });
    const range = (lo, hi) => IDBKeyRange.bound(lo, hi);
    return {
      get: (st, k) => open().then(d => req(d.transaction(st).objectStore(st).get(k))),
      all: st => open().then(d => req(d.transaction(st).objectStore(st).getAll())),
      put: (st, v, k) => open().then(d => { const t = d.transaction(st, 'readwrite'); if (k === undefined) t.objectStore(st).put(v); else t.objectStore(st).put(v, k); return done(t); }),
      del: (st, k) => open().then(d => { const t = d.transaction(st, 'readwrite'); t.objectStore(st).delete(k); return done(t); }),
      keys: (st, lo, hi) => open().then(d => req(d.transaction(st).objectStore(st).getAllKeys(range(lo, hi)))),
      getRange: (st, lo, hi) => open().then(d => { const s = d.transaction(st).objectStore(st); return Promise.all([req(s.getAllKeys(range(lo, hi))), req(s.getAll(range(lo, hi)))]); }),
      delRange: (st, lo, hi) => open().then(d => { const t = d.transaction(st, 'readwrite'); t.objectStore(st).delete(range(lo, hi)); return done(t); }),
      putMany: (st, list) => open().then(d => { const t = d.transaction(st, 'readwrite'), s = t.objectStore(st); for (const [k, v] of list) { if (k === null) s.put(v); else s.put(v, k); } return done(t); }),
      ok: () => open().then(() => true, () => false),
    };
  })();
  const ckey = (w, cx, cy) => w + '|' + cx + '|' + cy;
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const uid = p => p + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

  // ═══ Игра: одно состояние на открытую игру ═══
  let G = null;
  function newState(el, api){
    return {
      el, api, alive: true, state: 'menu', W: null, CH: null, gen: null, chunks: new Map(), want: new Set(), pending: new Set(), saved: new Set(),
      worker: null, edits: [], editIdx: new Map(), dirtySave: new Set(), metaOf: new Map(),
      pl: null, mobs: [], items: [], projs: [], npcs: [], texts: [], boss: null,
      cam: { x: 0, y: 0, tile: 24, zoom: 1, shake: 0 }, mouse: { sx: -1, sy: -1, wx: 0, wy: 0, l: false, r: false, in: false, moved: 0 },
      pad: { on: false, cx: 3, cy: -1, lb: false, rb: false, y: false, lt: false }, aim: { x: 0, y: 0, src: 'mouse' },
      t: 0, tick: 0, liqTick: 0, saveT: 0, streamT: 0, spawnT: 0, modT: 0, hudT: 0, frame: 0, perf: { frames: [], cpu: [], last: 0 },
      opt: Object.assign({ zoom: 1, smooth: true, back: true, parts: true, autosave: true, fps: false }, (() => { try { return JSON.parse(lsGet(LS_OPT) || '{}'); } catch (e) { return {}; } })()),
      chestOpen: null, talk: null, cheats: false, listeners: [], loop: null,
    };
  }
  const on = (t, ev, f, o) => { t.addEventListener(ev, f, o); G.listeners.push([t, ev, f, o]); };
  const toast = (t, kind) => G?.U?.toast(t, kind);

  // ═══ Звук: движок (D37E.audio) + свои звуки шумом (как в synth.js) ═══
  const SND = {};
  function sndMake(name){
    const E = window.D37E, S = E && E.synth;
    if (!S) return null;
    const RATE = S.RATE, Bp = S.Bp;
    const rnd = (() => { let a = 12345; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; })();
    const gen = (sec, fn) => { const n = Math.ceil(sec * RATE), d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = fn(i / RATE); let m = 0; for (const v of d) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < n; i++) d[i] *= .7 / m; for (let i = 0; i < Math.min(40, n); i++) { d[i] *= i / 40; d[n - 1 - i] *= i / 40; } return d; };
    const exp = Math.exp;
    switch (name) {
      case 'dig': { const b = new Bp(260, 1.2), c = new Bp(1500, 1); return gen(.16, t => { const w = rnd(); return b.do(w) * exp(-t * 30) * 2 + c.do(w) * exp(-t * 60) * .6; }); }
      case 'digstone': { const b = new Bp(900, 2.5), c = new Bp(2600, 3); return gen(.18, t => { const w = rnd(); return b.do(w) * exp(-t * 40) * 1.6 + c.do(w) * exp(-t * 55) + w * exp(-t * 300) * .4; }); }
      case 'place': { const b = new Bp(180, 1.5); return gen(.12, t => { const w = rnd(); return b.do(w) * exp(-t * 45) * 2.4; }); }
      case 'swing': { const b = new Bp(1200, .8); return gen(.18, t => { const w = rnd(); return b.do(w) * Math.sin(Math.min(1, t / .18) * Math.PI) * 1.2; }); }
      case 'hurt': { const b = new Bp(320, 2), c = new Bp(140, 1.2); return gen(.22, t => { const w = rnd(); return b.do(w) * exp(-t * 18) * 1.6 + c.do(w) * exp(-t * 25) * 1.6; }); }
      case 'squish': { const b = new Bp(500, 3); return gen(.2, t => { const w = rnd(); return b.do(w) * exp(-t * 20) * (1.5 + Math.sin(t * 90)); }); }
      case 'splash': { const b = new Bp(1800, .8), c = new Bp(600, 1); return gen(.45, t => { const w = rnd(); return b.do(w) * exp(-t * 9) * .8 + c.do(w) * exp(-t * 14) * 1.2; }); }
      case 'craft': { const b = new Bp(2200, 6), c = new Bp(700, 3); return gen(.3, t => { const w = rnd(); let s = 0; for (const at of [0, .1]) if (t >= at) s += (b.do(w) * 1.2 + c.do(w)) * exp(-(t - at) * 40); return s; }); }
      case 'roar': { const b = new Bp(110, 1.5), c = new Bp(240, 2); return gen(1.2, t => { const w = rnd(); return (b.do(w) * 2 + c.do(w)) * Math.sin(Math.min(1, t / 1.2) * Math.PI) * (1 + .3 * Math.sin(t * 40)); }); }
      case 'shoot': { const b = new Bp(1600, 2); return gen(.14, t => { const w = rnd(); return b.do(w) * exp(-t * 35) * 1.5; }); }
      case 'magic': { const b = new Bp(2600, 12), c = new Bp(3400, 14); return gen(.35, t => { const w = rnd(); return (b.do(w) + c.do(w)) * exp(-t * 10) * 2; }); }
      case 'drink': { const b = new Bp(900, 6); return gen(.5, t => { const w = rnd(); return b.do(w) * (Math.sin(t * 50) > .3 ? 1 : .2) * exp(-t * 4); }); }
      case 'levelup': return gen(.6, t => Math.sin(2 * Math.PI * (523 + (t > .15 ? 136 : 0) + (t > .3 ? 120 : 0)) * t) * exp(-t * 3) * .7);
    }
    return null;
  }
  function snd(name, o){
    if (!G || !window.D37E?.audio) return;
    const A = G.audio || (G.audio = window.D37E.audio());
    if (!A) return;
    const engine = window.D37E.synth?.NAMES?.includes(name);
    const id = engine ? name : 'pz_' + name;
    if (!engine && A.ctx && !A.bufs.has(id)) {
      const d = SND[name] || (SND[name] = sndMake(name));
      if (!d) return;
      const b = A.ctx.createBuffer(1, d.length, window.D37E.synth.RATE);
      b.getChannelData(0).set(d); A.bufs.set(id, b);
    }
    A.play(id, o && o.x != null ? { x: o.x, y: o.y, z: 0, vol: o.vol ?? 1, rate: o.rate } : { vol: o?.vol ?? 1, rate: o?.rate });
  }

  // ═══ Мир на главном потоке: чанки ═══
  const T0 = new Uint8Array(CA * 4), T1 = new Uint8Array(CA * 4), LB = new Uint8Array(66 * 66 * 4);
  function chunk(cx, cy){ return G.chunks.get(kOf(cx, cy)); }
  let lastC = null;
  function cAt(x, y){ const cx = x >> CB, cy = y >> CB; if (lastC && lastC.cx === cx && lastC.cy === cy) return lastC; const c = y < 0 ? null : G.chunks.get(kOf(cx, cy)); if (c) lastC = c; return c; }
  const idx = (x, y) => (y & CM) << CB | (x & CM);
  function fgAt(x, y){ const c = cAt(x, y); return c ? c.fg[idx(x, y)] : y < 0 ? 0 : 255; }   // 255 — «не загружено» (твёрдое)
  function wallAt(x, y){ const c = cAt(x, y); return c ? c.wall[idx(x, y)] : 0; }
  function stAt(x, y){ const c = cAt(x, y); return c ? c.st[idx(x, y)] : 0; }
  function lqAt(x, y){ const c = cAt(x, y); return c ? c.lq[idx(x, y)] : 0; }
  function ltAt(x, y){ const c = cAt(x, y); return c ? c.lt[idx(x, y)] : 0; }
  // форма для столкновений: 0 пусто, 1 целый, 2 полублок, 3 «/», 4 «\», 5 платформа; не загружено — стена
  function shapeAt(tx, ty){
    if (ty < 0) return 0;
    const c = cAt(tx, ty); if (!c) return 1;
    const i = idx(tx, ty), f = c.fg[i]; if (!f) return 0;
    const s = P.SOLID[f];
    if (s === 1) { const sh = c.st[i] & 15; return sh ? sh + 1 : 1; }
    if (s === 2) return 5;
    if (s === 3) return 1;
    return 0;
  }
  const solidM = f => P.SOLID[f] === 1 && P.KIND[f] === 0;
  // маски клетки для рисования: m0 — 8 соседей «твёрдая земля», m1 — открытые края стены (4) | тот же материал (4 << 4)
  const NB = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
  function maskCell(c, lx, ly){
    const i = ly << CB | lx, x = c.cx * CS + lx, y = c.cy * CS + ly, f = c.fg[i], w = c.wall[i];
    const inner = lx > 0 && lx < CM && ly > 0 && ly < CM;
    const leafy = P.LEAFY[f];
    let m0 = 0, same = 0, wm = 0;
    if ((f && (P.KIND[f] === 0 || leafy)) || w) {
      for (let n = 0; n < 8; n++) {
        const dx = NB[n][0], dy = NB[n][1];
        let nf, nw;
        if (inner) { const j = i + dy * CS + dx; nf = c.fg[j]; nw = c.wall[j]; }
        else { const cc = cAt(x + dx, y + dy); if (cc) { const j = idx(x + dx, y + dy); nf = cc.fg[j]; nw = cc.wall[j]; } else { nf = y + dy < 0 ? 0 : 3; nw = y + dy < 0 ? 0 : 1; } }
        const s = solidM(nf);
        if (leafy ? P.LEAFY[nf] || s : s) m0 |= 1 << n;   // листва сливается с листвой
        if (n < 4) {
          if (f && nf && ((P.GROUP[nf] && P.GROUP[nf] === P.GROUP[f]) || (leafy && P.LEAFY[nf]))) same |= 1 << n;
          if (w && !nw && !s) wm |= 1 << n;
        }
      }
    }
    c.m0[i] = m0; c.m1[i] = wm | same << 4;
  }
  function masksAll(c){ for (let ly = 0; ly < CS; ly++) for (let lx = 0; lx < CS; lx++) maskCell(c, lx, ly); c.dirty0 = true; }
  // пересчитать края соседей, когда пришёл чанк (их клетки у общей границы)
  function masksBorder(c){
    for (const [dx, dy] of NB) {
      const n = chunk(c.cx + dx, c.cy + dy); if (!n) continue;
      const xs = dx === 1 ? [0] : dx === -1 ? [CM] : null, ys = dy === 1 ? [0] : dy === -1 ? [CM] : null;
      if (xs && ys) maskCell(n, xs[0], ys[0]);
      else if (xs) for (let ly = 0; ly < CS; ly++) maskCell(n, xs[0], ly);
      else if (ys) for (let lx = 0; lx < CS; lx++) maskCell(n, lx, ys[0]);
      n.dirty0 = true; n.dirtyL = true;
      if (dy === 1 && dx === 0) n.dirty1 = true;   // у нижнего соседа — «над клеткой жидкость»
    }
  }
  function newChunk(d){
    const c = { cx: d.cx, cy: d.cy, k: kOf(d.cx, d.cy), fg: d.fg, wall: d.wall, st: d.st, lq: d.lq, lt: d.lt, light: d.light,
      m0: new Uint8Array(CA), m1: new Uint8Array(CA), ugH: new Int32Array(CS), awake: 0, hasLq: false, mod: false,
      dirty0: true, dirty1: true, dirtyL: true, ready: false, gl: null, vis: false };
    for (let lx = 0; lx < CS; lx++) c.ugH[lx] = G.gen.colInfo(c.cx * CS + lx).h + 2;
    for (let i = 0; i < CA; i++) if (c.lq[i]) { c.hasLq = true; break; }
    c.awake = c.hasLq ? 40 : 0;
    // песок над пустотой — тоже «проснуться»
    if (!c.awake) for (let i = 0; i < CA - CS; i++) if (P.FALL[c.fg[i]] && !c.fg[i + CS]) { c.awake = 40; break; }
    return c;
  }
  function onChunk(d){
    const k = kOf(d.cx, d.cy);
    G.pending.delete(k);
    if (!G.want.has(k) || G.chunks.has(k)) { if (!G.chunks.has(k)) G.worker.post({ t: 'drop', cx: d.cx, cy: d.cy }); return; }
    const c = newChunk(d);
    const meta = G.metaOf.get(k); G.metaOf.delete(k);
    if (meta && meta.ch) for (const [ax, ay, items] of meta.ch) G.chests.set(ax + ',' + ay, items);
    if (meta && d.gen === false) c.mod = true;
    G.chunks.set(k, c);
    lastC = null;
    masksAll(c); masksBorder(c);
    if (G.R) G.R.chunkInit(c);
  }
  function onLight(d){ const c = chunk(d.cx, d.cy); if (!c) return; c.light = d.light; c.dirtyL = true; for (const [dx, dy] of NB) { const n = chunk(c.cx + dx, c.cy + dy); if (n) n.dirtyL = true; } }
  // загрузить данные чанка на видеокарту (только изменённое)
  function upload(c){
    const R = G.R; if (!R) return;
    if (c.dirty0) {
      const fg = c.fg, wall = c.wall, m0 = c.m0, m1 = c.m1;
      for (let i = 0, o = 0; i < CA; i++, o += 4) { T0[o] = fg[i]; T0[o + 1] = m0[i]; T0[o + 2] = wall[i]; T0[o + 3] = m1[i]; }
      R.upload0(c, T0); c.dirty0 = false;
    }
    if (c.dirty1) {
      const up = chunk(c.cx, c.cy - 1), st = c.st, lq = c.lq, lt = c.lt, y0 = c.cy * CS;
      let any = false;
      for (let i = 0, o = 0; i < CA; i++, o += 4) {
        const ly = i >> CB, lx = i & CM;
        const above = ly ? lq[i - CS] : up ? up.lq[i + CS * CM] : 0;
        T1[o] = st[i]; T1[o + 1] = lq[i]; T1[o + 2] = lt[i] | (above ? 128 : 0); T1[o + 3] = y0 + ly > c.ugH[lx] ? 1 : 0;
        if (lq[i]) any = true;
      }
      c.hasLq = any;
      R.upload1(c, T1); c.dirty1 = false;
    }
    if (c.dirtyL) {
      // 66×66: середина — свет чанка, рамка — соседи (нет соседа — край своего)
      const L = c.light;
      for (let j = -1; j <= CS; j++) {
        const cy = j < 0 ? c.cy - 1 : j >= CS ? c.cy + 1 : c.cy, ly = j < 0 ? CM : j >= CS ? 0 : j;
        for (let i = -1; i <= CS; i++) {
          const cx = i < 0 ? c.cx - 1 : i >= CS ? c.cx + 1 : c.cx, lx = i < 0 ? CM : i >= CS ? 0 : i;
          let src = L, si;
          if (cx !== c.cx || cy !== c.cy) { const n = chunk(cx, cy); if (n) { src = n.light; si = (ly << CB | lx) << 2; } else si = (clamp(j, 0, CM) << CB | clamp(i, 0, CM)) << 2; }
          else si = (ly << CB | lx) << 2;
          const o = ((j + 1) * 66 + i + 1) << 2;
          LB[o] = src[si]; LB[o + 1] = src[si + 1]; LB[o + 2] = src[si + 2]; LB[o + 3] = src[si + 3];
        }
      }
      R.uploadL(c, LB); c.dirtyL = false;
    }
    c.ready = true;
  }

  // ═══ Правки клеток: игра → массивы, маски, видеокарта, поток (свет), сохранение ═══
  const EF_FG = 1, EF_WALL = 2, EF_LQ = 4;
  function setCell(x, y, fg, st, wall, lq, lt){
    const c = cAt(x, y); if (!c) return false;
    const i = idx(x, y);
    const oldFg = c.fg[i], oldWall = c.wall[i], oldLt = c.lt[i];
    if (fg !== undefined && fg !== null) c.fg[i] = fg;
    if (st !== undefined && st !== null) c.st[i] = st;
    if (wall !== undefined && wall !== null) c.wall[i] = wall;
    if (lq !== undefined && lq !== null) { c.lq[i] = lq; c.lt[i] = lq ? (lt ?? c.lt[i]) : 0; }
    touched(c, x, y, i, (c.fg[i] !== oldFg ? EF_FG : 0) | (c.wall[i] !== oldWall ? EF_WALL : 0) | (oldLt === 2 || c.lt[i] === 2 ? EF_LQ : 0));
    return true;
  }
  function touched(c, x, y, i, what){
    c.mod = true; G.dirtySave.add(c);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const n = cAt(x + dx, y + dy); if (!n) continue;
      maskCell(n, (x + dx) & CM, (y + dy) & CM); n.dirty0 = true;
    }
    c.dirty1 = true;
    if ((y & CM) === CM) { const b = chunk(c.cx, c.cy + 1); if (b) b.dirty1 = true; }
    if (what & (EF_FG | EF_WALL | EF_LQ)) queueEdit(c, x, y, i);
    wake(x, y);
  }
  function queueEdit(c, x, y, i){
    const k = x + ',' + y, at = G.editIdx.get(k);
    const v = [x, y, c.fg[i], c.wall[i], c.st[i], c.lq[i], c.lt[i]];
    if (at !== undefined) for (let n = 0; n < 7; n++) G.edits[at + n] = v[n];
    else { G.editIdx.set(k, G.edits.length); G.edits.push(...v); }
  }
  function flushEdits(){
    if (!G.edits.length || !G.worker) return;
    G.worker.post({ t: 'edit', a: G.edits.slice() });
    G.edits.length = 0; G.editIdx.clear();
  }
  function wake(x, y){ for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = cAt(x + dx * 2, y + dy * 2); if (n) n.awake = 40; } }
  // жидкости и песок (core.liquidStep зовёт changed)
  const LW = {
    chunk: (cx, cy) => G.chunks.get(kOf(cx, cy)),
    changed(x, y, fgChanged){
      const c = cAt(x, y); if (!c) return;
      c.mod = true; G.dirtySave.add(c); c.dirty1 = true;
      if ((y & CM) === CM) { const b = chunk(c.cx, c.cy + 1); if (b) b.dirty1 = true; }
      const i = idx(x, y);
      if (fgChanged) { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = cAt(x + dx, y + dy); if (n) { maskCell(n, (x + dx) & CM, (y + dy) & CM); n.dirty0 = true; } } queueEdit(c, x, y, i); }
      else if (c.lt[i] === 2 || !c.lq[i]) queueEdit(c, x, y, i);
    },
  };

  // ═══ Подгрузка мира вокруг камеры ═══
  function viewTiles(){ return [G.R ? G.R.w / G.cam.tile : 60, G.R ? G.R.h / G.cam.tile : 34]; }
  function stream(force){
    const [vw, vh] = viewTiles();
    const m = 40;
    // (верхние незагруженные чанки поток считает «как сгенерированы» — для света неба этого хватает)
    const x0 = Math.floor((G.cam.x - vw / 2 - m) / CS), x1 = Math.floor((G.cam.x + vw / 2 + m) / CS);
    const y0 = Math.max(0, Math.floor((G.cam.y - vh / 2 - m) / CS)), y1 = Math.max(0, Math.floor((G.cam.y + vh / 2 + m) / CS));
    const want = new Set();
    const need = [];
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const k = kOf(cx, cy); want.add(k);
      if (!G.chunks.has(k) && !G.pending.has(k)) need.push([cx, cy, k]);
    }
    // держим ещё чанк запаса — не выгружать туда-сюда
    for (const [k, c] of G.chunks) {
      if (want.has(k)) continue;
      if (c.cx >= x0 - 1 && c.cx <= x1 + 1 && c.cy >= y0 - 1 && c.cy <= y1 + 1) { want.add(k); continue; }
      unloadChunk(c);
    }
    G.want = want;
    // сверху вниз (свет неба), ближние к камере — раньше
    const ccx = G.cam.x / CS;
    need.sort((a, b) => a[1] - b[1] || Math.abs(a[0] - ccx) - Math.abs(b[0] - ccx));
    const max = force ? 200 : 10;
    for (const [cx, cy, k] of need) {
      if (G.pending.size >= max) break;
      requestChunk(cx, cy, k);
    }
  }
  function requestChunk(cx, cy, k){
    G.pending.add(k);
    const sk = ckey(G.W.id, cx, cy);
    if (!G.saved.has(sk)) { G.worker.post({ t: 'load', cx, cy }); return; }
    const wid = G.W.id;
    DB.get('chunks', sk).then(rec => {
      if (!G || G.W?.id !== wid) return;
      let save = null;
      try { if (rec && rec.d) save = PZ.unpackChunk(rec.d instanceof Uint8Array ? rec.d : new Uint8Array(rec.d)); } catch (e) { save = null; }
      if (rec && rec.ch) G.metaOf.set(k, { ch: rec.ch });
      if (save) G.worker.post({ t: 'load', cx, cy, save }); else G.worker.post({ t: 'load', cx, cy });
    }, () => { if (G && G.W?.id === wid) G.worker.post({ t: 'load', cx, cy }); });
  }
  function unloadChunk(c){
    if (c.mod) saveChunks([c]);
    // сундуки этого чанка — из памяти (они сохранены вместе с чанком)
    for (const k of [...G.chests.keys()]) { const [ax, ay] = k.split(',').map(Number); if (ax >> CB === c.cx && ay >> CB === c.cy) G.chests.delete(k); }
    G.R?.chunkFree(c);
    G.chunks.delete(c.k);
    G.dirtySave.delete(c);
    lastC = null;
    G.worker.post({ t: 'drop', cx: c.cx, cy: c.cy });
  }

  // ═══ Поток (Worker) — из текста ядра; нет потоков — то же самое в этом же потоке ═══
  function startWorker(){
    const handlers = d => { if (!G) return; if (d.t === 'chunk') onChunk(d); else if (d.t === 'light') onLight(d); else if (d.t === 'err') console.warn('Подземье, поток:', d.msg); };
    const S = { kind: 'worker' };
    let w = null, local = null;
    const makeLocal = () => {   // то же ядро в этом потоке (сообщения — без копирования, ответы — в следующем такте)
      const core = window.PZ_CORE(), self = { postMessage: m => setTimeout(() => handlers(m), 0) };
      core.worldWorker(self);
      S.kind = 'local';
      return m => self.onmessage({ data: m });
    };
    try {
      const url = URL.createObjectURL(new Blob([PZ.workerSource()], { type: 'text/javascript' }));
      w = new Worker(url);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      w.onmessage = e => handlers(e.data);
      w.onerror = e => {   // поток упал — дальше здесь же: заново init и все загрузки
        console.warn('Подземье: поток упал, считаю здесь', e.message);
        w?.terminate(); w = null; local = makeLocal();
        if (G?.W) { local({ t: 'init', seed: G.W.seed, props: G.modProps || null, feats: G.modFeats || null }); G.pending.clear(); }
      };
    } catch (e) { w = null; local = makeLocal(); }
    S.post = m => { if (w) w.postMessage(m); else if (local) local(m); };
    S.stop = () => { w?.terminate(); w = null; local = null; };
    return S;
  }

  // ═══ Игрок ═══
  // x — середина, feet — где ноги (верх земли)
  function newPlayer(x, feet){
    return { x: x - PL_W / 2, y: feet - PL_H, w: PL_W, h: PL_H, vx: 0, vy: 0, ground: false, stepUp: 1.05, dir: 1, drop: false, dropT: 0,
      coyote: 0, jumpBuf: 0, jumpHold: 0, jumps: 0, climb: false, inLq: 0, lqT: 0, fallY: feet - PL_H, iframes: 0, hurtT: 0, useT: 0, swing: 0, swingId: 0, swingDur: .3,
      mine: null, anim: 'idle', animT: 0, stepOff: 0, regenT: 0, manaT: 0, potionT: 0, recallT: 0, dead: 0, airT: 0, lastStep: 0 };
  }
  const hasAcc = key => G.CH.inv.some(s => s && s.id === key);
  const selItem = () => G.CH.inv[G.CH.sel] || null;
  const itemDef = k => ITEMS[k] || G.modItems?.[k] || null;

  // ═══ Предметы в сумке ═══
  const stackOf = k => (itemDef(k)?.stack) || 999;
  function give(id, n = 1, x, y){
    if (!itemDef(id)) return n;
    const inv = G.CH.inv, mx = stackOf(id);
    for (let i = 0; i < INV_N && n > 0; i++) { const s = inv[i]; if (s && s.id === id && s.n < mx) { const a = Math.min(n, mx - s.n); s.n += a; n -= a; } }
    for (let i = 0; i < INV_N && n > 0; i++) if (!inv[i]) { const a = Math.min(n, mx); inv[i] = { id, n: a }; n -= a; }
    G.U?.inv();
    if (n > 0 && x != null) dropItem(id, n, x, y);
    return n;
  }
  function count(id){ let n = 0; for (const s of G.CH.inv) if (s && s.id === id) n += s.n; return n; }
  function take(id, n){
    if (count(id) < n) return false;
    const inv = G.CH.inv;
    for (let i = INV_N - 1; i >= 0 && n > 0; i--) { const s = inv[i]; if (s && s.id === id) { const a = Math.min(n, s.n); s.n -= a; n -= a; if (!s.n) inv[i] = null; } }
    G.U?.inv();
    return true;
  }
  function useOne(){ const s = selItem(); if (!s) return; s.n--; if (s.n <= 0) G.CH.inv[G.CH.sel] = null; G.U?.inv(); }

  // ═══ Крафт: станки рядом (до 4 клеток от игрока) ═══
  function stationsNear(){
    const p = G.pl, cx = Math.floor(p.x + p.w / 2), cy = Math.floor(p.y + p.h / 2), out = new Set();
    for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 5; x <= cx + 5; x++) { const f = fgAt(x, y); const t = TILES[f]; if (t && (t.key === 'workbench' || t.key === 'furnace' || t.key === 'anvil')) out.add(t.key); }
    return out;
  }
  const allRecipes = () => G.modRecipes ? RECIPES.concat(G.modRecipes) : RECIPES;
  function craftList(){
    const st = stationsNear(), out = [];
    for (const r of allRecipes()) {
      if (!itemDef(r.o)) continue;
      const okSt = !r.st || st.has(r.st), has = r.i.every(([k, n]) => count(k) >= n);
      const known = r.i.some(([k]) => count(k) > 0) || has;
      out.push({ r, ok: okSt && has, okSt, has, known });
    }
    return out;
  }
  function craft(r, times = 1){
    let made = 0;
    for (let t = 0; t < times; t++) {
      if (r.st && !stationsNear().has(r.st)) { toast(`Нужен станок: ${TILES[PZ.TILE[r.st]?.id]?.name || r.st}`, 'bad'); break; }
      if (!r.i.every(([k, n]) => count(k) >= n)) break;
      for (const [k, n] of r.i) take(k, n);
      give(r.o, r.n, G.pl.x + G.pl.w / 2, G.pl.y + 1);
      made++;
      ach('craft');
      if (r.o === 'workbench') ach('workbench');
      if (/^bar_/.test(r.o)) ach('smelt');
    }
    if (made) snd('craft', { vol: .7 });
    G.U?.inv();
    return made;
  }

  // ═══ Достижения игры (у персонажа) ═══
  const ACH = {
    first_dig: ['⛏', 'Первый удар кирки', 'Добудь первый блок'],
    workbench: ['🔨', 'Дом, милый дом', 'Сделай верстак'],
    torch: ['🔥', 'Да будет свет', 'Поставь факел'],
    smelt: ['🔥', 'Плавильщик', 'Выплавь слиток в печи'],
    craft: ['🧰', 'Мастер', 'Сделай что-нибудь'],
    depth300: ['⬇️', 'Глубже!', 'Спустись на 150 м'],
    depth1000: ['🕳', 'Бездна', 'Спустись на 500 м'],
    depth2000: ['🌋', 'Сквозь лаву', 'Спустись на 1000 м'],
    night: ['🌙', 'Ночь пережита', 'Доживи до утра'],
    boss_any: ['👑', 'Первый босс', 'Победи любого босса'],
    boss1: ['🟢', 'Желейный великан', 'Победи Желейного великана'],
    boss2: ['🦉', 'Ночной филин', 'Победи Ночного филина'],
    walker: ['🧭', 'Путешественник', 'Отойди на 1000 м от старта'],
    life: ['❤️', 'Сердце покрепче', 'Используй кристалл жизни'],
  };
  function ach(id){
    const a = G.CH.ach || (G.CH.ach = {});
    if (a[id] || !ACH[id]) return;
    a[id] = Date.now();
    toast(`${ACH[id][0]} Достижение: «${ACH[id][1]}»`, 'ach');
    snd('levelup', { vol: .6 });
  }

  // ═══ Сущности: выпавшие предметы ═══
  function dropItem(id, n, x, y, vx, vy){
    if (!n || !itemDef(id)) return;
    // рядом такой же — сложить
    for (const it of G.items) if (it.id === id && Math.abs(it.x - x) < 1.5 && Math.abs(it.y - y) < 1.5 && it.n + n <= stackOf(id)) { it.n += n; it.t = 0; return; }
    if (G.items.length > 400) G.items.shift();
    G.items.push({ id, n, x: x - .3, y: y - .3, w: .6, h: .6, vx: vx ?? (rand() - .5) * 4, vy: vy ?? -4 - rand() * 3, ground: false, stepUp: 0, t: 0, pick: .4 });
  }
  function updItems(dt){
    const p = G.pl, pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;
    for (let n = G.items.length - 1; n >= 0; n--) {
      const it = G.items[n];
      it.t += dt; it.pick -= dt;
      if (it.t > 300) { G.items.splice(n, 1); continue; }
      const dx = pcx - (it.x + .3), dy = pcy - (it.y + .3), d = Math.hypot(dx, dy);
      if (it.pick <= 0 && !p.dead && d < 4.2 && roomFor(it.id)) {
        if (d < 1.1) {
          const left = give(it.id, it.n);
          if (left < it.n) { snd('pickup', { vol: .5 }); G.modsEmit?.('pickup', { item: it.id, n: it.n - left }); }
          if (left) it.n = left; else { G.items.splice(n, 1); continue; }
        } else { const k = 22 / Math.max(.5, d); it.vx += dx * k * dt; it.vy += dy * k * dt; it.vx *= .9; it.vy *= .9; it.x += it.vx * dt; it.y += it.vy * dt; continue; }
      }
      it.vy = Math.min(it.vy + GRAV * .6 * dt, 18); it.vx *= it.ground ? .8 : .99;
      PZ.moveBody(it, dt, shapeAt);
    }
  }
  function roomFor(id){ const mx = stackOf(id); return G.CH.inv.some(s => !s || (s.id === id && s.n < mx)); }

  // ═══ Частицы (массивы, без мусора) и всплывающие цифры ═══
  const PMAX = 1600;
  const PT = { x: new Float32Array(PMAX), y: new Float32Array(PMAX), vx: new Float32Array(PMAX), vy: new Float32Array(PMAX), t: new Float32Array(PMAX), life: new Float32Array(PMAX), s: new Float32Array(PMAX), g: new Float32Array(PMAX), c: new Uint32Array(PMAX), glow: new Uint8Array(PMAX), n: 0 };
  const PTA = [PT.x, PT.y, PT.vx, PT.vy, PT.t, PT.life, PT.s, PT.g, PT.c, PT.glow];
  function part(x, y, vx, vy, life, size, rgb, grav = 1, glow = 0){
    if (!G.opt.parts && !glow) return;
    let i = PT.n;
    if (i >= PMAX) { i = (Math.random() * PMAX) | 0; } else PT.n++;
    PT.x[i] = x; PT.y[i] = y; PT.vx[i] = vx; PT.vy[i] = vy; PT.t[i] = 0; PT.life[i] = life; PT.s[i] = size; PT.g[i] = grav; PT.c[i] = rgb; PT.glow[i] = glow;
  }
  const rgbInt = h => { const v = parseInt(String(h).replace('#', ''), 16); return isFinite(v) ? v : 0xffffff; };
  function burst(x, y, n, col, speed = 5, life = .6, size = .18, grav = 1, glow = 0){ for (let k = 0; k < n; k++) { const a = rand() * Math.PI * 2, s = speed * (.3 + rand() * .7); part(x, y, Math.cos(a) * s, Math.sin(a) * s - speed * .3, life * (.6 + rand() * .6), size * (.7 + rand() * .6), col, grav, glow); } }
  function updParts(dt){
    let n = PT.n;
    for (let i = 0; i < n; i++) {
      PT.t[i] += dt;
      if (PT.t[i] >= PT.life[i]) { n--; for (let a = 0; a < PTA.length; a++) PTA[a][i] = PTA[a][n]; i--; continue; }
      PT.vy[i] += 30 * PT.g[i] * dt; PT.x[i] += PT.vx[i] * dt; PT.y[i] += PT.vy[i] * dt;
    }
    PT.n = n;
  }
  function floatText(x, y, text, color){ if (G.texts.length > 40) G.texts.shift(); G.texts.push({ x, y, text: String(text), color: color || '#fff', t: 0 }); }

  // ═══ Мобы ═══
  // ai: slime | walker | bat | imp | bossSlime | bossOwl; tint — цвет спрайта; drop: [[предмет, от, до, шанс]]
  const MOBS = {
    slime: { name: 'Слизень', w: 1.55, h: 1.15, hp: 20, dmg: 6, ai: 'slime', spr: 'slime', tint: [90, 215, 100], drop: [['gel', 1, 3, 1]] },
    blueslime: { name: 'Пещерный слизень', w: 1.6, h: 1.2, hp: 32, dmg: 10, ai: 'slime', spr: 'slime', tint: [80, 150, 255], drop: [['gel', 2, 4, 1]] },
    purpleslime: { name: 'Глубинный слизень', w: 1.8, h: 1.35, hp: 70, dmg: 18, ai: 'slime', spr: 'slime', tint: [190, 95, 255], drop: [['gel', 2, 5, 1], ['crystal', 1, 1, .08]] },
    zombie: { name: 'Зомби', w: 1.2, h: 2.7, hp: 45, dmg: 12, ai: 'walker', spr: 'zombie', speed: 2.4, jump: 15, drop: [['fiber', 1, 2, .35], ['mushroom', 1, 1, .05]] },
    bat: { name: 'Летучая мышь', w: 1.2, h: .8, hp: 16, dmg: 10, ai: 'bat', spr: 'bat', speed: 6, drop: [['membrane', 1, 1, .5]] },
    crawler: { name: 'Жук-камнегрыз', w: 1.7, h: .85, hp: 55, dmg: 15, ai: 'walker', spr: 'crawler', speed: 1.8, jump: 10, drop: [['crystal', 1, 1, .1], ['iron', 1, 3, .3]] },
    imp: { name: 'Огневик', w: 1.4, h: 1.4, hp: 85, dmg: 24, ai: 'imp', spr: 'imp', speed: 3.2, drop: [['fireore', 1, 2, .5]] },
    slimeking: { name: 'Желейный великан', w: 6, h: 4.4, hp: 950, dmg: 24, ai: 'bossSlime', spr: 'bigslime', tint: [70, 170, 255], boss: 1, drop: [['gel', 25, 40, 1], ['lifecrystal', 2, 2, 1], ['bar_gold', 6, 10, 1], ['boots', 1, 1, 1], ['potion', 3, 5, 1]] },
    owl: { name: 'Ночной филин', w: 4, h: 3.4, hp: 1800, dmg: 30, ai: 'bossOwl', spr: 'owl', boss: 2, drop: [['feather', 12, 16, 1], ['bar_silver', 8, 12, 1], ['manastar', 1, 1, 1], ['lifecrystal', 1, 2, 1]] },
  };
  function spawnMob(type, x, y){
    const D = MOBS[type]; if (!D) return null;
    const m = { type, D, x: x - D.w / 2, y: y - D.h, w: D.w, h: D.h, vx: 0, vy: 0, hp: D.hp, maxHp: D.hp, dir: rand() < .5 ? -1 : 1, t: .5 + rand(), ground: false, stepUp: D.ai === 'walker' ? 1.05 : 0,
      hurt: 0, hitBy: 0, anim: 0, st: 0, stuck: 0, lastX: x, fireT: 2 + rand() * 2, alpha: 1, phase: 0, noSnap: D.ai === 'slime' || D.ai === 'bossSlime' };
    if (D.ai === 'bat' || D.ai === 'imp' || D.ai === 'bossOwl') m.fly = true;
    G.mobs.push(m);
    return m;
  }
  function hurtMob(m, dmg, kx, src){
    if (m.hp <= 0) return;
    const crit = rand() < .05;
    const d = Math.max(1, Math.round(dmg * (crit ? 2 : 1) * (.9 + rand() * .2)));
    m.hp -= d; m.hurt = .2;
    floatText(m.x + m.w / 2, m.y, d, crit ? '#ffd84a' : '#ffffff');
    if (!m.D.boss) { m.vx = kx * 7; m.vy = Math.min(m.vy, -5); }
    snd(m.D.ai === 'slime' || m.D.ai === 'bossSlime' ? 'squish' : 'hit', { x: m.x, y: m.y, vol: .7 });
    burst(m.x + m.w / 2, m.y + m.h / 2, 5, m.D.tint ? (m.D.tint[0] << 16 | m.D.tint[1] << 8 | m.D.tint[2]) : 0xb02020, 5, .4, .14);
    if (m.D.ai === 'bossSlime' && m.hp > 0) {   // великан: каждые 10 % — малыши
      const step = Math.floor((1 - m.hp / m.maxHp) * 10);
      if (step > m.phase) { m.phase = step; for (let k = 0; k < 2; k++) { const s = spawnMob('slime', m.x + m.w / 2 + (k ? 1 : -1), m.y + m.h * .6); if (s) { s.vy = -10; s.vx = (k ? 4 : -4); } } }
    }
    if (m.hp <= 0) killMob(m, src);
  }
  function killMob(m){
    m.hp = 0;
    for (const [id, a, b, ch] of m.D.drop || []) if (rand() < ch) dropItem(id, a + Math.floor(rand() * (b - a + 1)), m.x + m.w / 2, m.y + m.h / 2);
    burst(m.x + m.w / 2, m.y + m.h / 2, m.D.boss ? 60 : 14, m.D.tint ? (m.D.tint[0] << 16 | m.D.tint[1] << 8 | m.D.tint[2]) : 0x8a2a2a, m.D.boss ? 12 : 6, .8, .2);
    G.modsEmit?.('mobKill', { mob: m.type, x: m.x + m.w / 2, y: m.y + m.h / 2 });
    if (m.D.boss) bossDown(m);
  }
  function bossDown(m){
    const id = m.D.boss, sec = Math.round(G.t - (m.born || G.t));
    G.boss = null; G.U?.boss(null);
    G.W.flags = G.W.flags || {};
    const first = !G.W.flags['boss' + id];
    G.W.flags['boss' + id] = (G.W.flags['boss' + id] || 0) + 1;
    toast(`👑 ${m.D.name} повержен! ${first ? 'Первая победа в этом мире.' : ''}`, 'ach');
    snd('levelup');
    ach('boss_any'); ach('boss' + id);
    if (!G.cheats) {
      G.api?.report?.('podzem_boss' + id, true, Math.max(1, 600 - Math.min(599, sec)), Math.max(1, 600 - Math.min(599, sec)));
      const coins = id === 1 ? 10 : 20;
      window.D37Coins?.run?.('podzem', coins, 'podzem:' + G.W.id + ':b' + id + ':' + G.W.flags['boss' + id])?.then?.(r => { if (r?.ok && r.got) toast(`🪙 +${r.got} монет сайта`, 'good'); });
    }
    saveAll();
  }
  function spawnBoss(kind){
    if (G.boss) { toast('Босс уже здесь!', 'bad'); return false; }
    const p = G.pl;
    let m;
    if (kind === 'slimeking') {
      const side = rand() < .5 ? -1 : 1, x = Math.floor(p.x + side * 28), y = groundY(x, Math.floor(p.y));
      m = spawnMob('slimeking', x, y ?? p.y);
      toast('🟢 Желейный великан пробуждается!', 'boss');
    } else {
      m = spawnMob('owl', p.x + 20, p.y - 16);
      toast('🦉 Ночной филин вылетел на охоту!', 'boss');
    }
    if (!m) return false;
    m.born = G.t; G.boss = m; G.U?.boss(m);
    snd('roar', { vol: .9 }); G.cam.shake = .6;
    return true;
  }
  // земля под (x, y): верх первой твёрдой клетки ниже, над ней 3 клетки пусто
  function groundY(x, y){
    for (let k = 0; k < 60; k++) {
      const yy = y + k;
      if (shapeAt(x, yy) && !shapeAt(x, yy - 1) && !shapeAt(x, yy - 2) && !shapeAt(x, yy - 3)) return yy;
    }
    for (let k = 1; k < 40; k++) {
      const yy = y - k;
      if (shapeAt(x, yy) && !shapeAt(x, yy - 1) && !shapeAt(x, yy - 2) && !shapeAt(x, yy - 3)) return yy;
    }
    return null;
  }
  const isNight = () => G.W.time >= NIGHT0;
  function mobAI(m, dt){
    const p = G.pl, D = m.D, pcx = p.x + p.w / 2, pcy = p.y + p.h / 2, mcx = m.x + m.w / 2, mcy = m.y + m.h / 2;
    const dx = pcx - mcx, dy = pcy - mcy, dist = Math.hypot(dx, dy), see = !p.dead && dist < 40;
    m.anim += dt; m.hurt = Math.max(0, m.hurt - dt);
    switch (D.ai) {
      case 'slime': case 'bossSlime': {
        const big = D.ai === 'bossSlime';
        if (m.ground) {
          m.vx *= .7;
          m.t -= dt;
          if (m.t <= 0) {
            m.dir = see ? Math.sign(dx) || 1 : (rand() < .5 ? -1 : 1);
            const angry = big && m.hp < m.maxHp * .5;
            m.vx = m.dir * (big ? 7 + rand() * 4 + (angry ? 3 : 0) : 3 + rand() * 2.5);
            m.vy = -(big ? 16 + rand() * 6 : 10 + rand() * 5);
            m.t = big ? (angry ? .55 : .9) + rand() * .5 : .8 + rand() * 1.4;
            if (big) snd('squish', { x: m.x, y: m.y, vol: .9, rate: .6 });
          }
        }
        m.vy = Math.min(m.vy + GRAV * dt, MAXFALL);
        if (big) {
          m.stuck = Math.abs(m.x - m.lastX) < .05 && m.ground ? m.stuck + dt : 0; m.lastX = m.x;
          if ((dist > 45 || m.stuck > 4) && !p.dead) {   // уйти в землю и выпрыгнуть рядом
            m.alpha -= dt * 2;
            if (m.alpha <= 0) { const x = Math.floor(pcx + (rand() < .5 ? -12 : 12)), y = groundY(x, Math.floor(p.y)); if (y != null) { m.x = x - m.w / 2; m.y = y - m.h; m.vx = 0; m.vy = 0; } m.alpha = .01; m.stuck = 0; }
          } else if (m.alpha < 1) m.alpha = Math.min(1, m.alpha + dt * 2);
        }
        PZ.moveBody(m, dt, shapeAt);
        break;
      }
      case 'walker': {
        if (m.st > 0) { m.st -= dt; }
        else if (see) m.dir = Math.sign(dx) || m.dir;
        else { m.t -= dt; if (m.t <= 0) { m.dir = rand() < .5 ? -1 : 1; m.t = 3 + rand() * 3; } }
        const want = m.dir * D.speed * (isNight() || D.spr !== 'zombie' ? 1 : .6);
        m.vx += (want - m.vx) * Math.min(1, dt * 6);
        if (m.ground && (m.wallL || m.wallR)) { m.vy = -D.jump; m.jumped = (m.jumped || 0) + 1; }
        m.stuck = Math.abs(m.x - m.lastX) < .02 ? m.stuck + dt : 0; m.lastX = m.x;
        if (m.stuck > 1.6) { m.dir = -m.dir; m.st = 2; m.stuck = 0; }
        m.vy = Math.min(m.vy + GRAV * dt, MAXFALL);
        PZ.moveBody(m, dt, shapeAt);
        break;
      }
      case 'bat': case 'imp': {
        const sp = D.speed, tx = see ? dx : Math.cos(m.anim * .7 + m.phase) * 6, ty = see ? dy + Math.sin(m.anim * 3) * 2 : Math.sin(m.anim * 1.3) * 3;
        const l = Math.hypot(tx, ty) || 1;
        m.vx += (tx / l * sp - m.vx) * dt * 2.5; m.vy += (ty / l * sp - m.vy) * dt * 2.5;
        const vx0 = m.vx, vy0 = m.vy;
        PZ.moveBody(m, dt, shapeAt);
        if (m.wallL || m.wallR) m.vx = -vx0 * .6;
        if (m.ground || m.hitHead) m.vy = -vy0 * .6;
        if (D.ai === 'imp' && see && dist < 26) {
          m.fireT -= dt;
          if (m.fireT <= 0 && lineClear(mcx, mcy, pcx, pcy)) { m.fireT = 2.4 + rand() * 1.6; shoot('fireball', mcx, mcy, dx / dist * 12, dy / dist * 12, 20, 'mob'); snd('shoot', { x: mcx, y: mcy, vol: .6, rate: .7 }); }
        }
        if (m.stuck === undefined) m.stuck = 0;
        break;
      }
      case 'bossOwl': {
        m.t -= dt;
        if (!isNight()) { m.vy -= 30 * dt; m.y += m.vy * dt; m.x += m.vx * dt; if (m.y < p.y - 60) { m.hp = 0; G.mobs.splice(G.mobs.indexOf(m), 1); G.boss = null; G.U?.boss(null); toast('🦉 Ночной филин улетел — рассвет', 'bad'); } break; }
        const angry = m.hp < m.maxHp * .5;
        if (m.st === 0) {   // кружит над игроком
          const a = m.anim * (angry ? 1.4 : 1), tx = pcx + Math.cos(a) * 11 - m.w / 2, ty = pcy - 10 + Math.sin(a * 2) * 2 - m.h / 2;
          m.vx += ((tx - m.x) * 3 - m.vx) * dt * 3; m.vy += ((ty - m.y) * 3 - m.vy) * dt * 3;
          if (angry) { m.fireT -= dt; if (m.fireT <= 0) { m.fireT = .7; for (const s of [-.25, 0, .25]) { const a2 = Math.atan2(dy, dx) + s; shoot('featherp', mcx, mcy, Math.cos(a2) * 15, Math.sin(a2) * 15, 18, 'mob'); } snd('shoot', { x: mcx, y: mcy, vol: .5 }); } }
          if (m.t <= 0) { m.st = 1; m.t = 1.1; const l = dist || 1; m.vx = dx / l * (angry ? 26 : 22); m.vy = dy / l * (angry ? 26 : 22); snd('roar', { vol: .5, rate: 1.5 }); }
        } else if (m.st === 1) { if (m.t <= 0) { m.st = 2; m.t = 1; } }
        else { m.vy += (-12 - m.vy) * dt * 3; m.vx *= .97; if (m.t <= 0) { m.st = 0; m.t = angry ? 2.2 : 3.2; } }
        m.dir = m.vx >= 0 ? 1 : -1;
        m.x += m.vx * dt; m.y += m.vy * dt;
        break;
      }
    }
    if (D.ai === 'slime' || D.ai === 'walker') m.dir = m.vx > .1 ? 1 : m.vx < -.1 ? -1 : m.dir;
    // жидкость и лава
    const ml = lqAt(Math.floor(mcx), Math.floor(mcy));
    if (ml > 60 && !m.fly) { m.vy *= .9; if (ltAt(Math.floor(mcx), Math.floor(mcy)) === 2 && m.type !== 'imp') hurtMob(m, 30 * dt, 0); }
    // контакт с игроком
    if (!p.dead && p.iframes <= 0 && m.alpha > .5 && m.x < p.x + p.w && m.x + m.w > p.x && m.y < p.y + p.h && m.y + m.h > p.y) hurtPlayer(D.dmg, Math.sign(pcx - mcx) || 1, D.name);
  }
  function lineClear(x0, y0, x1, y1){
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d * 2);
    for (let k = 1; k < n; k++) { const t = k / n; if (shapeAt(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t)) === 1) return false; }
    return true;
  }
  // появление мобов: за экраном, по глубине и времени суток
  function spawnTick(){
    const p = G.pl; if (p.dead) return;
    const px = p.x + p.w / 2, py = p.y + p.h, C = G.gen.colInfo(Math.floor(px)), depth = py - C.h;
    const [vw] = viewTiles();
    let pool, cap;
    if (depth < 18) { if (isNight()) { pool = [['zombie', 6], ['slime', 2], ['bat', 1]]; cap = 8; } else { pool = [['slime', 1]]; cap = 4; } }
    else if (py < C.deep) { pool = [['blueslime', 4], ['bat', 3], ['crawler', 3]]; cap = 7; }
    else if (py < C.lava) { pool = [['purpleslime', 4], ['bat', 3], ['crawler', 4]]; cap = 8; }
    else { pool = [['imp', 5], ['purpleslime', 3], ['bat', 2]]; cap = 9; }
    let n = 0; for (const m of G.mobs) if (!m.D.boss) n++;
    if (n >= cap) return;
    const tot = pool.reduce((s, q) => s + q[1], 0);
    let r = rand() * tot, type = pool[0][0];
    for (const [k, w] of pool) { if ((r -= w) < 0) { type = k; break; } }
    const D = MOBS[type];
    for (let tries = 0; tries < 10; tries++) {
      const side = rand() < .5 ? -1 : 1, x = Math.floor(px + side * (vw / 2 + 4 + rand() * 22)), y0 = Math.floor(p.y + (rand() - .5) * 30);
      if (!cAt(x, y0)) continue;
      if (D.ai === 'bat' || D.ai === 'imp') {
        if (!shapeAt(x, y0) && !shapeAt(x + 1, y0) && !shapeAt(x, y0 + 1) && !lqAt(x, y0)) { spawnMob(type, x + .5, y0 + 1); return; }
        continue;
      }
      const gy = groundY(x, y0 - 6);
      if (gy == null || Math.abs(gy - y0) > 30 || lqAt(x, gy - 1) > 100) continue;
      if (depth < 18 && wallAt(x, gy - 1)) continue;   // на поверхности в домах (у стен) — не появляются
      spawnMob(type, x + .5, gy);
      return;
    }
  }

  // ═══ Снаряды ═══
  function shoot(spr, x, y, vx, vy, dmg, owner, opt = {}){
    G.projs.push({ spr, x, y, vx, vy, dmg, owner, t: 0, life: opt.life ?? 3, grav: opt.grav ?? 0, pierce: opt.pierce ?? 0, hit: new Set() });
  }
  function updProjs(dt){
    const p = G.pl;
    for (let n = G.projs.length - 1; n >= 0; n--) {
      const q = G.projs[n];
      q.t += dt; q.vy += q.grav * dt; q.x += q.vx * dt; q.y += q.vy * dt;
      let dead = q.t > q.life;
      const tx = Math.floor(q.x), ty = Math.floor(q.y), s = shapeAt(tx, ty);
      if (s && s !== 5) dead = true;
      if (q.spr === 'spark') part(q.x, q.y, 0, 0, .3, .12, 0xff8af0, 0, 1);
      if (q.spr === 'fireball') part(q.x, q.y, (rand() - .5), (rand() - .5), .35, .16, 0xff7a20, -.2, 1);
      if (!dead && q.owner === 'pl') {
        for (const m of G.mobs) {
          if (m.hp <= 0 || q.hit.has(m) || !(q.x > m.x && q.x < m.x + m.w && q.y > m.y && q.y < m.y + m.h)) continue;
          hurtMob(m, q.dmg, Math.sign(q.vx) || 1); q.hit.add(m);
          if (q.pierce-- <= 0) { dead = true; break; }
        }
      } else if (!dead && q.owner === 'mob' && !p.dead && p.iframes <= 0 && q.x > p.x && q.x < p.x + p.w && q.y > p.y && q.y < p.y + p.h) { hurtPlayer(q.dmg, Math.sign(q.vx) || 1, 'снаряд'); dead = true; }
      if (dead) { burst(q.x, q.y, 4, q.spr === 'fireball' ? 0xff7a20 : q.spr === 'spark' ? 0xff8af0 : 0xcccccc, 3, .3, .1); G.projs.splice(n, 1); }
    }
  }

  // ═══ Игрок: урон, смерть, возрождение ═══
  function hurtPlayer(dmg, kx, by){
    const p = G.pl;
    if (p.dead || p.iframes > 0) return;
    const d = Math.max(1, Math.round(dmg * (.9 + rand() * .2)));
    G.CH.hp -= d; p.iframes = .66; p.hurtT = .3; p.regenT = 0;
    p.vx = kx * 8; p.vy = -7; p.ground = false;
    floatText(p.x + p.w / 2, p.y, d, '#ff5a5a');
    snd('hurt', { vol: .8 }); G.cam.shake = Math.max(G.cam.shake, .25);
    G.U?.hud();
    if (G.CH.hp <= 0) die(by);
  }
  function die(by){
    const p = G.pl;
    G.CH.hp = 0; p.dead = 4; p.vx = 0; p.vy = 0; p.mine = null;
    G.nightDied = true;
    burst(p.x + p.w / 2, p.y + p.h / 2, 30, 0xc02020, 7, .9, .2);
    G.U?.dead(by);
    snd('hurt', { rate: .6 });
  }
  // точки (W.spawn, W.bed): x — клетка, y — где ноги
  function respawn(){
    const p = G.pl, s = G.W.bed || G.W.spawn;
    p.x = s.x + .5 - p.w / 2; p.y = s.y - p.h; p.vx = p.vy = 0; p.dead = 0; p.iframes = 2; p.fallY = p.y;
    G.CH.hp = G.CH.maxHp; G.CH.mana = G.CH.maxMana;
    G.cam.x = p.x; G.cam.y = p.y;
    stream(true);
    G.U?.dead(null); G.U?.hud();
  }

  // ═══ Ввод → намерения игрока ═══
  function inputState(){
    const C = G.C, U = G.U, tch = U?.touch || {};
    const blocked = U?.modal();
    const left = !blocked && (C.held('left') || tch.mx < -.3), right = !blocked && (C.held('right') || tch.mx > .3);
    const up = !blocked && (C.held('forward') || tch.my < -.45), down = !blocked && (C.held('back') || tch.my > .45);
    const mx = blocked ? 0 : (C.move.x || (tch.mx && Math.abs(tch.mx) > .3 ? tch.mx : 0));
    return { left, right, up, down, mx, jump: !blocked && (C.held('jump') || !!tch.jump), jumpDown: !blocked && (C.down('jump') || !!tch.jumpDown), blocked };
  }
  function cursorTile(){ return [Math.floor(G.aim.x), Math.floor(G.aim.y)]; }
  function updAim(){
    const p = G.pl, pcx = p.x + p.w / 2, pcy = p.y + p.h * .45;
    if (G.pad.on && (Math.abs(G.pad.ax) > .2 || Math.abs(G.pad.ay) > .2)) { G.pad.cx = G.pad.ax * 6; G.pad.cy = G.pad.ay * 6; G.aim.src = 'pad'; }
    if (G.aim.src === 'pad') { G.aim.x = pcx + G.pad.cx; G.aim.y = pcy + G.pad.cy; return; }
    // кнопка ⚔ на телефоне: перед собой (джойстик вверх/вниз — копать вверх/вниз)
    const tch = G.U?.touch;
    if (tch?.front) { const my = tch.my || 0; G.aim.x = pcx + (Math.abs(my) > .55 ? 0 : p.dir * 1.3); G.aim.y = my > .55 ? p.y + p.h + .5 : my < -.55 ? p.y - .5 : p.y + p.h * .6; return; }
    if (G.aim.src === 'touch') return;   // палец сам ставит точку
    if (G.mouse.in) { G.aim.x = G.cam.x + (G.mouse.sx * G.res - G.R.w / 2) / G.cam.tile; G.aim.y = G.cam.y + (G.mouse.sy * G.res - G.R.h / 2) / G.cam.tile; }
  }
  const inReach = (x, y) => { const p = G.pl; return Math.hypot(x + .5 - (p.x + p.w / 2), y + .5 - (p.y + p.h * .4)) <= REACH; };

  // ═══ Шаг игрока ═══
  function updPlayer(dt){
    const p = G.pl, CH = G.CH;
    if (p.dead) { p.dead -= dt; if (p.dead <= 0) respawn(); return; }
    const I = inputState();
    p.iframes -= dt; p.hurtT -= dt; p.useT -= dt; p.potionT -= dt;
    if (p.swing > 0) p.swing -= dt;
    // вода / лава / лестницы
    const cx = Math.floor(p.x + p.w / 2), feetY = Math.floor(p.y + p.h - .1), midY = Math.floor(p.y + p.h * .5);
    const wMid = lqAt(cx, midY), wFeet = lqAt(cx, feetY), lavaHere = ltAt(cx, midY) === 2 || ltAt(cx, feetY) === 2;
    const inLq = wMid > 90 ? 2 : wFeet > 90 ? 1 : 0;
    if (inLq && !p.inLq) { snd('splash', { vol: .6 }); burst(p.x + p.w / 2, p.y + p.h * .6, 10, 0x6aa8ff, 5, .5, .12); }
    p.inLq = inLq;
    if (lavaHere) { p.lqT -= dt; if (p.lqT <= 0) { p.lqT = .5; p.iframes = 0; hurtPlayer(28, 0, 'лава'); } }
    let canClimb = false;
    for (let y = Math.floor(p.y + .2); y <= Math.floor(p.y + p.h - .2); y++) if (P.CLIMB[fgAt(cx, y)]) canClimb = true;
    if (!canClimb) p.climb = false;
    else if ((I.up || I.down) && !p.climb) p.climb = true;
    // движение
    const acc = p.ground ? 46 : 26, maxV = inLq ? 5 : 8.6, slip = p.ground && P.SLIP[fgAt(cx, feetY + 1)];
    const dir = I.mx > .3 ? 1 : I.mx < -.3 ? -1 : 0;
    const target = dir * maxV * Math.min(1, Math.abs(I.mx) + .2);
    if (dir) { p.vx += clamp(target - p.vx, -acc * dt, acc * dt); p.dir = dir; }
    else { const fr = (p.ground ? (slip ? 5 : 48) : 8) * dt; p.vx = Math.abs(p.vx) <= fr ? 0 : p.vx - Math.sign(p.vx) * fr; }
    if (p.climb) {
      p.vy = I.up ? -7 : I.down ? 7 : 0; p.vx *= .6;
      if (I.jumpDown) { p.climb = false; p.vy = -12; }
    } else {
      // прыжок: «койот» 0,1 с после края, запомненное нажатие 0,12 с, выше — если держать
      if (p.ground) { p.coyote = .1; p.jumps = 0; } else p.coyote -= dt;
      if (I.jumpDown) p.jumpBuf = .12; else p.jumpBuf -= dt;
      const boots = hasAcc('boots'), wings = hasAcc('wings');
      const jv = 19 * (boots ? 1.22 : 1);
      if (inLq) {
        if (I.jump) p.vy = Math.max(p.vy - 46 * dt, -8);
        p.vy = Math.min(p.vy + GRAV * .28 * dt, 6);
        if (p.jumpBuf > 0 && inLq === 1 && p.coyote > 0) { p.vy = -jv * .8; p.jumpBuf = 0; }
      } else {
        if (p.jumpBuf > 0 && (p.coyote > 0)) { p.vy = -jv; p.jumpBuf = 0; p.coyote = 0; p.jumpHold = .18; snd('jump', { vol: .4 }); }
        else if (p.jumpBuf > 0 && wings && p.jumps < 1 && !p.ground) { p.vy = -jv * .9; p.jumps++; p.jumpBuf = 0; p.jumpHold = .12; burst(p.x + p.w / 2, p.y + p.h, 10, 0xd8c8a8, 4, .4, .16); snd('swing', { vol: .5 }); }
        if (p.jumpHold > 0) { p.jumpHold -= dt; if (!I.jump) p.jumpHold = 0; }
        const g = p.jumpHold > 0 && p.vy < 0 ? GRAV * .32 : GRAV;
        p.vy = Math.min(p.vy + g * dt, wings && I.jump && p.vy > 0 ? 3.5 : MAXFALL);
      }
    }
    // сквозь платформу — вниз (зажать «вниз»)
    if (I.down && !p.climb) p.dropT = .25; else p.dropT -= dt;
    p.drop = p.dropT > 0;
    const wasGround = p.ground, vy0 = p.vy;
    PZ.moveBody(p, dt, shapeAt);
    // приземление: урон от падения (в воде — нет)
    if (!wasGround && p.ground) {
      const fall = p.y - p.fallY;
      if (vy0 > 12) { snd('land', { vol: Math.min(1, vy0 / 30) }); burst(p.x + p.w / 2, p.y + p.h, 5, 0x9a8a7a, 3, .3, .12); }
      if (fall > 24 && !p.inLq && !hasAcc('wings')) hurtPlayer(Math.round((fall - 24) * 3.2), 0, 'падение');
    }
    if (p.ground || p.climb || p.inLq) p.fallY = p.y;
    else if (p.vy < 0) p.fallY = Math.min(p.fallY, p.y);
    // шаги
    if (p.ground && Math.abs(p.vx) > 1 && G.t - p.lastStep > .32) { p.lastStep = G.t; const f = fgAt(cx, feetY + 1); window.D37E?._audio?.step?.(P.GROUP[f] === 2 || P.GROUP[f] === 7 ? 'concrete' : f === T.PLANKS || f === T.PLATFORM ? 'wood' : f === T.SNOW || f === T.SAND ? 'carpet' : 'grass', false); }
    p.stepOff = Math.max(0, (p.stepOff || 0) - dt * 9);
    // восстановление
    p.regenT += dt; p.manaT += dt;
    if (p.regenT > 6 && CH.hp < CH.maxHp) { CH.hpAcc = (CH.hpAcc || 0) + dt * (Math.abs(p.vx) < .1 ? 2.2 : 1); if (CH.hpAcc >= 1) { CH.hp = Math.min(CH.maxHp, CH.hp + Math.floor(CH.hpAcc)); CH.hpAcc %= 1; } }
    if (p.manaT > 1 && CH.mana < CH.maxMana) CH.mana = Math.min(CH.maxMana, CH.mana + dt * 5);
    // возврат домой
    if (p.recallT > 0) {
      p.recallT -= dt; part(p.x + rand() * p.w, p.y + rand() * p.h, 0, -2, .5, .14, 0xff8af0, 0, 1);
      if (p.recallT <= 0) { const s = G.W.bed || G.W.spawn; p.x = s.x + .5 - p.w / 2; p.y = s.y - p.h; p.vx = p.vy = 0; p.fallY = p.y; G.cam.x = p.x; G.cam.y = p.y; stream(true); snd('magic'); }
    }
    // анимация
    p.animT += dt;
    const a = p.swing > 0 ? 'use' : p.climb ? 'climb' : p.inLq === 2 ? 'swim' : !p.ground ? (p.vy < 0 ? 'jump' : 'fall') : Math.abs(p.vx) > 5 ? 'run' : Math.abs(p.vx) > .4 ? 'walk' : 'idle';
    if (a !== p.anim) { p.anim = a; p.animT = 0; }
    useInput(dt, I);
    // глубина и путь
    const depthM = Math.max(0, Math.round((p.y + p.h - PZ.SURF) * M_PER_TILE));
    if (depthM > (G.W.maxDepth || 0)) { G.W.maxDepth = depthM; if (depthM >= 150) ach('depth300'); if (depthM >= 500) ach('depth1000'); if (depthM >= 1000) ach('depth2000'); }
    if (Math.abs(p.x - G.W.spawn.x) * M_PER_TILE > 1000) ach('walker');
  }

  // ═══ Использовать предмет в руке ═══
  function useInput(dt, I){
    const U = G.U;
    if (I.blocked || G.pl.recallT > 0) { G.pl.mine = null; return; }
    const wantUse = G.mouse.l || G.C.held('attack') || !!U?.touch?.use;
    if (!wantUse) { if (G.pl.mine) G.pl.mine.t += dt; if (G.pl.mine && G.pl.mine.t > 2) G.pl.mine = null; return; }
    if (G.pl.useT > 0) return;
    useItem();
  }
  function useItem(){
    const p = G.pl, s = selItem(), it = s ? itemDef(s.id) : null;
    const [tx, ty] = cursorTile();
    const pcx = p.x + p.w / 2;
    if (G.aim.x < pcx - .2) p.dir = -1; else if (G.aim.x > pcx + .2) p.dir = 1;
    if (!it) { handBreak(tx, ty); p.useT = .3; return; }
    switch (it.kind) {
      case 'tool': return useTool(it, tx, ty);
      case 'melee': return swingWeapon(it);
      case 'bow': {
        if (!take('arrow', 1)) { toast('Нет стрел: сделай их на верстаке (дерево + камень)', 'bad'); p.useT = .6; return; }
        const [dx, dy] = aimDir(); shoot('arrowp', pcx, p.y + p.h * .35, dx * 24, dy * 24 - 2, it.dmg + ITEMS.arrow.dmg, 'pl', { grav: 14, life: 2.5 });
        p.useT = it.speed; p.swing = .25; snd('shoot', { vol: .6 }); return;
      }
      case 'wand': {
        if (G.CH.mana < it.mana) { toast('Не хватает маны', 'bad'); p.useT = .4; return; }
        G.CH.mana -= it.mana; p.manaT = 0;
        const [dx, dy] = aimDir(); shoot('spark', pcx, p.y + p.h * .35, dx * 19, dy * 19, it.dmg, 'pl', { life: 1.4, pierce: 1 });
        p.useT = it.speed; p.swing = .25; snd('magic', { vol: .5 }); G.U?.hud(); return;
      }
      case 'tile': return placeTile(it, tx, ty);
      case 'wall': return placeWall(it, tx, ty);
      case 'use': return useConsumable(it, s);
      default: p.useT = .3;
    }
  }
  function aimDir(){ const p = G.pl, dx = G.aim.x - (p.x + p.w / 2), dy = G.aim.y - (p.y + p.h * .35), l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; }
  function handBreak(tx, ty){
    const f = fgAt(tx, ty);
    if (f && f !== 255 && P.TOOL[f] === 2 && P.HARD[f] <= 1 && inReach(tx, ty)) { breakTile(tx, ty); G.pl.swing = .25; }
  }
  function useTool(it, tx, ty){
    const p = G.pl;
    p.useT = it.speed; p.swing = it.speed; p.swingDur = it.speed;
    snd('swing', { vol: .25, rate: 1.2 });
    if (!inReach(tx, ty)) return;
    const f = fgAt(tx, ty); if (f === 255) return;
    if (it.tool === 'hammer') {
      if (f && P.KIND[f] === 0 && P.SOLID[f] === 1) {   // форма блока: целый → полублок → «/» → «\» → целый
        const st = stAt(tx, ty), sh = ((st & 15) + 1) % 4;
        setCell(tx, ty, null, (st & 0xf0) | sh); snd('place', { vol: .6 }); return;
      }
      if (!f) {
        const w = wallAt(tx, ty); if (!w) return;
        mineHit(tx, ty, 'wall', it.power, 30);
      }
      return;
    }
    if (!f) return;
    const tool = P.TOOL[f];
    if (tool === 2) { breakTile(tx, ty); return; }   // руками / любым
    if (tool === 1 && it.tool !== 'axe') { hint('Это рубят топором 🪓'); return; }
    if (tool === 0 && it.tool !== 'pick') { hint('Тут нужна кирка ⛏'); return; }
    if (it.tool === 'pick' && P.TIER[f] > it.tier) { hint(`Нужна кирка мощнее (${tierName(P.TIER[f])})`); burst(tx + .5, ty + .5, 3, 0xaaaaaa, 2, .2, .08); snd('digstone', { vol: .4, rate: 1.4 }); return; }
    mineHit(tx, ty, 'fg', it.power, P.HARD[f]);
  }
  const tierName = t => ['любая', 'медная', 'железная', 'золотая', 'глубинная', 'огненная'][t] || 'лучше';
  let hintAt = 0;
  function hint(t){ if (G.t - hintAt > 2.5) { hintAt = G.t; toast(t, 'bad'); } }
  function mineHit(tx, ty, layer, power, hard){
    const p = G.pl;
    if (!p.mine || p.mine.x !== tx || p.mine.y !== ty || p.mine.layer !== layer) p.mine = { x: tx, y: ty, layer, dmg: 0, t: 0 };
    p.mine.dmg += power; p.mine.t = 0;
    const f = fgAt(tx, ty), stone = layer === 'fg' && (P.GROUP[f] === 2 || P.GROUP[f] === 7 || P.GROUP[f] === 9 || P.TIER[f] >= 1);
    snd(stone ? 'digstone' : 'dig', { x: tx, y: ty, vol: .55, rate: .9 + rand() * .2 });
    const col = tileColor(layer === 'fg' ? f : 0, layer === 'wall' ? wallAt(tx, ty) : 0);
    burst(tx + .5, ty + .5, 3, col, 3, .35, .12);
    if (p.mine.dmg >= hard) {
      if (layer === 'fg') breakTile(tx, ty); else breakWall(tx, ty);
      p.mine = null;
    }
  }
  function tileColor(f, w){
    const t = f ? TILES[f] : null, wl = w ? PZ.WALLS[w] : null, c = (t && t.c) || (wl && wl.c) || (G.modTiles?.[f]?.c);
    return c ? rgbInt(c[0]) : 0x8a6a4a;
  }
  // ── Сломать блок: предмет, деревья, опоры, многоклеточное ──
  function objAnchor(x, y){
    const f = fgAt(x, y), st = stAt(x, y), w = P.W[f], fr = st >> 4;
    return [x - fr % w, y - Math.floor(fr / w), w, P.H[f]];
  }
  function breakTile(x, y, quiet){
    const c = cAt(x, y); if (!c) return false;
    const f = c.fg[idx(x, y)]; if (!f) return false;
    const t = TILES[f] || G.modTiles?.[f];
    if (!t) { setCell(x, y, 0, 0); return true; }
    if (P.KIND[f] === 1) {   // многоклеточное
      const [ax, ay, w, h] = objAnchor(x, y);
      if (f === T.CHEST || f === T.LOOT) {
        const items = G.chests.get(ax + ',' + ay);
        if (f === T.CHEST && items && items.some(Boolean)) { hint('Сначала забери всё из сундука'); return false; }
        if (f === T.LOOT) { const loot = items || lootFor(ax, ay); for (const s of loot) if (s) dropItem(s.id, s.n, ax + 1, ay + 1); }
        G.chests.delete(ax + ',' + ay);
        if (G.chestOpen === ax + ',' + ay) G.U?.chest(null);
      }
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (fgAt(ax + dx, ay + dy) === f) setCell(ax + dx, ay + dy, 0, 0);
      dropOf(t, ax + w / 2, ay + h / 2);
      afterBreak(ax, ay, f, w, h, quiet);
      return true;
    }
    if (f === T.TRUNK || f === T.CACTUS) { fellTree(x, y, f); return true; }
    if (f === T.POT) { potLoot(x, y); }
    setCell(x, y, 0, 0);
    dropOf(t, x + .5, y + .5);
    afterBreak(x, y, f, 1, 1, quiet);
    return true;
  }
  function afterBreak(x, y, f, w, h, quiet){
    if (!quiet) {
      burst(x + w / 2, y + h / 2, 10, tileColor(f, 0), 5, .5, .14);
      snd(P.GROUP[f] === 2 || P.GROUP[f] === 7 ? 'digstone' : 'dig', { x, y, vol: .8 });
      ach('first_dig');
      G.modsEmit?.('tileBreak', { x, y, tile: tileKey(f) });
    }
    for (let dx = -1; dx <= w; dx++) { checkSupport(x + dx, y - 1); checkSupport(x + dx, y + h); }
    for (let dy = 0; dy < h; dy++) { checkSupport(x - 1, y + dy); checkSupport(x + w, y + dy); }
    lightCheckChest();
  }
  function lightCheckChest(){}
  function dropOf(t, x, y){
    let d = t.d;
    if (d === undefined) d = t.key;
    if (!d) return;
    if (d.endsWith('?')) { if (rand() < .35) dropItem(d.slice(0, -1), 1, x, y); return; }
    if (t.key === 'lifecrystal') { dropItem('lifecrystal', 1, x, y); return; }
    dropItem(d, 1, x, y);
  }
  function potLoot(x, y){
    const r = rand(), d = y - G.gen.colInfo(x).h;
    if (r < .35) dropItem('torch', 2 + Math.floor(rand() * 5), x + .5, y + .5);
    else if (r < .5) dropItem('potion', 1, x + .5, y + .5);
    else if (r < .65) dropItem('arrow', 6 + Math.floor(rand() * 10), x + .5, y + .5);
    else if (r < .8) dropItem(d > 400 ? 'bar_silver' : 'bar_copper', 1 + Math.floor(rand() * 2), x + .5, y + .5);
    else if (r < .88) dropItem('rope', 5 + Math.floor(rand() * 8), x + .5, y + .5);
    else dropItem('mushroom', 1, x + .5, y + .5);
    burst(x + .5, y + .5, 12, 0xa8603a, 5, .5, .14);
    snd('digstone', { x, y, rate: 1.6 });
  }
  // сундук с сокровищами: что внутри (по зерну мира — у всех одинаково)
  function lootFor(ax, ay){
    const r = (() => { let a = PZ.hash2(ax, ay, G.W.seed + 900); return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; })();
    const d = ay - G.gen.colInfo(ax).h, out = Array(CHEST_N).fill(null);
    const add = (id, n) => { const i = out.findIndex(v => !v); if (i >= 0) out[i] = { id, n }; };
    const rare = d > 500 ? ['wand', 'recall', 'manastar', 'boots'] : ['recall', 'boots', 'bow', 'lifecrystal'];
    add(rare[Math.floor(r() * rare.length)], 1);
    add('torch', 5 + Math.floor(r() * 10));
    add(d > 600 ? 'bar_gold' : d > 300 ? 'bar_silver' : 'bar_iron', 3 + Math.floor(r() * 6));
    if (r() < .6) add('potion', 1 + Math.floor(r() * 3));
    if (r() < .5) add('arrow', 15 + Math.floor(r() * 25));
    if (r() < .4) add('rope', 10 + Math.floor(r() * 20));
    if (r() < .3) add('crystal', 1 + Math.floor(r() * 3));
    return out;
  }
  // дерево: ствол и всё над ним (листва, лианы), не дальше 4 клеток в стороны
  function fellTree(x, y, f){
    const q = [[x, y]], seen = new Set([x + ',' + y]), parts = [];
    let wood = 0;
    while (q.length && parts.length < 500) {
      const [cx, cy] = q.pop(); const ff = fgAt(cx, cy);
      if (!(ff === f || ff === T.LEAVES || ff === T.PLEAVES || ff === T.JLEAVES || ff === T.VINE)) continue;
      if ((ff === T.TRUNK || ff === T.CACTUS) && cy > y) continue;
      parts.push([cx, cy, ff]);
      if (ff === f) wood++;
      for (const [dx, dy] of [[0, -1], [1, 0], [-1, 0], [0, 1], [1, -1], [-1, -1]]) {
        const nx = cx + dx, ny = cy + dy, k = nx + ',' + ny;
        if (seen.has(k) || Math.abs(nx - x) > 4 || ny > y) continue;
        const nf = fgAt(nx, ny);
        if (nf === T.TRUNK && nx !== x) continue;   // соседнее дерево не трогаем
        seen.add(k); q.push([nx, ny]);
      }
    }
    for (const [px, py, ff] of parts) { setCell(px, py, 0, 0); if (ff !== f && rand() < .25) burst(px + .5, py + .5, 2, tileColor(ff, 0), 2, .6, .12, .3); }
    dropItem(f === T.CACTUS ? 'cactus' : 'wood', wood * (f === T.CACTUS ? 1 : 2), x + .5, y);
    snd('break', { x, y, vol: .7 });
    G.cam.shake = Math.max(G.cam.shake, .12);
    G.modsEmit?.('tileBreak', { x, y, tile: tileKey(f) });
    checkSupport(x, y + 1);
  }
  // опора у растений, факелов, предметов на полу; песок — проснуться
  function checkSupport(x, y){
    const f = fgAt(x, y); if (!f || f === 255) return;
    if (P.FALL[f]) { const c = cAt(x, y); if (c) c.awake = 40; return; }
    const sup = P.SUP[f];
    if (!sup) return;
    if (P.KIND[f] === 1) {
      const [ax, ay, w, h] = objAnchor(x, y);
      if (sup === 1) for (let dx = 0; dx < w; dx++) { const b = fgAt(ax + dx, ay + h); if (!(P.SOLID[b] === 1 || P.SOLID[b] === 2)) { breakTile(x, y, true); return; } }
      return;
    }
    const below = fgAt(x, y + 1), above = fgAt(x, y - 1), lf = fgAt(x - 1, y), rt = fgAt(x + 1, y);
    const solid = v => v !== 0 && v !== 255 && (P.SOLID[v] === 1 || P.SOLID[v] === 2);
    let ok = true;
    if (sup === 1) ok = solid(below) || below === f || (f === T.TALLGRASS && below === 255);
    else if (sup === 2) ok = solid(above) || above === f || above === T.JLEAVES || above === T.LEAVES;
    else if (sup === 4) ok = wallAt(x, y) || solid(below) || solid(lf) || solid(rt) || solid(above);
    if (!ok) breakTile(x, y, true);
  }
  // ── Поставить блок / стену ──
  function anySupport(x, y){
    if (wallAt(x, y)) return true;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { const v = fgAt(x + dx, y + dy); if (v && v !== 255 && (P.SOLID[v] || P.KIND[v] === 2 && P.CLIMB[v])) return true; }
    return false;
  }
  function bodyIn(x, y, w, h){
    const hit = b => b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y;
    if (hit(G.pl)) return true;
    for (const m of G.mobs) if (hit(m)) return true;
    return false;
  }
  function placeTile(it, tx, ty){
    const p = G.pl;
    const id = it.tileId || PZ.TILE[it.tile]?.id; if (!id) return;
    if (!inReach(tx, ty)) return;
    p.useT = .12;
    const k = P.KIND[id], s = P.SOLID[id];
    if (k === 1) {   // предмет из нескольких клеток: ставим так, чтобы низ был в клетке курсора
      const w = P.W[id], h = P.H[id], ax = tx - Math.floor((w - 1) / 2), ay = ty - h + 1;
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) { const v = fgAt(ax + dx, ay + dy); if (v && (P.KIND[v] !== 2 || P.CLIMB[v])) return; }
      if (P.SUP[id] === 1 || id === T.DOOR) for (let dx = 0; dx < w; dx++) { const b = fgAt(ax + dx, ay + h); if (!(P.SOLID[b] === 1 || P.SOLID[b] === 2) || b === 255) return; }
      if (id === T.DOOR) { const a = fgAt(ax, ay - 1); if (!(P.SOLID[a] === 1) || a === 255) { hint('Дверь ставят в проём высотой 3: блок сверху и снизу'); return; } }
      if (s && bodyIn(ax, ay, w, h)) return;
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) setCell(ax + dx, ay + dy, id, (dx + dy * w) << 4, null, 0);
      if (id === T.CHEST) G.chests.set(ax + ',' + ay, Array(CHEST_N).fill(null));
      if (id === T.BED) { G.W.bed = { x: ax + 1, y: ay + 1 }; toast('🛏 Здесь ты теперь возрождаешься', 'good'); }
    } else {
      const cur = fgAt(tx, ty);
      if (cur === 255) return;
      if (cur && !(P.KIND[cur] === 2 && P.HARD[cur] === 0)) return;   // траву можно заменить
      if (s === 1 && bodyIn(tx, ty, 1, 1)) return;
      if (id === T.TORCH && !(wallAt(tx, ty) || [[0, 1], [1, 0], [-1, 0]].some(([dx, dy]) => P.SOLID[fgAt(tx + dx, ty + dy)] === 1))) { hint('Факел нужно прислонить к стене или блоку'); return; }
      if (id === T.ROPE && !(P.SOLID[fgAt(tx, ty - 1)] || fgAt(tx, ty - 1) === T.ROPE)) { hint('Верёвку вешают под блок или другую верёвку'); return; }
      if (P.SUP[id] === 1 && !(P.SOLID[fgAt(tx, ty + 1)] === 1)) return;
      if (!anySupport(tx, ty) && id !== T.ROPE) return;
      if (cur) setCell(tx, ty, 0, 0);
      setCell(tx, ty, id, 0, null, s === 1 ? 0 : null);
      if (id === T.TORCH) ach('torch');
    }
    useOne();
    snd('place', { x: tx, y: ty, vol: .7 });
    G.modsEmit?.('tilePlace', { x: tx, y: ty, tile: tileKey(id) });
  }
  function placeWall(it, tx, ty){
    const id = PZ.WALL[it.wall]?.id; if (!id) return;
    if (!inReach(tx, ty)) return;
    G.pl.useT = .1;
    if (wallAt(tx, ty) || fgAt(tx, ty) === 255) return;
    let ok = false;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { if (wallAt(tx + dx, ty + dy) || P.SOLID[fgAt(tx + dx, ty + dy)] === 1) ok = true; }
    if (!ok) return;
    setCell(tx, ty, null, null, id);
    useOne();
    snd('place', { x: tx, y: ty, vol: .5, rate: .8 });
  }
  function breakWall(x, y){
    const w = wallAt(x, y); if (!w) return;
    setCell(x, y, null, null, 0);
    const wl = PZ.WALLS[w]; if (wl) dropItem(wl.key, 1, x + .5, y + .5);
    burst(x + .5, y + .5, 6, tileColor(0, w), 4, .4, .12);
    checkSupport(x, y);
  }
  // ── Расходники ──
  function useConsumable(it){
    const p = G.pl, CH = G.CH;
    p.useT = .5;
    switch (it.use) {
      case 'heal':
        if (it.key === 'potion') { if (p.potionT > 0) { hint(`Зелье ещё нельзя: ${Math.ceil(p.potionT)} с`); return; } p.potionT = 30; }
        if (CH.hp >= CH.maxHp) { hint('Здоровье и так полное'); return; }
        CH.hp = Math.min(CH.maxHp, CH.hp + it.heal); floatText(p.x + p.w / 2, p.y, '+' + it.heal, '#5aff7a'); snd('drink', { vol: .6 }); break;
      case 'life':
        if (CH.maxHp >= 400) { hint('Больше здоровья не бывает (400)'); return; }
        CH.maxHp += 20; CH.hp += 20; ach('life'); burst(p.x + p.w / 2, p.y + p.h / 2, 24, 0xff3a5a, 6, .8, .16, 0, 1); snd('levelup'); toast('❤️ +20 к здоровью навсегда', 'good'); break;
      case 'mana':
        if (CH.maxMana >= 200) { hint('Больше маны не бывает (200)'); return; }
        CH.maxMana += 20; CH.mana = CH.maxMana; burst(p.x + p.w / 2, p.y + p.h / 2, 24, 0x4fa0ff, 6, .8, .16, 0, 1); snd('levelup'); toast('⭐ +20 к мане', 'good'); break;
      case 'boss':
        if (it.night && !isNight()) { hint('Манок работает только ночью'); return; }
        if (!spawnBoss(it.boss)) return;
        break;
      case 'recall': p.recallT = 1.4; snd('magic'); G.U?.hud(); return;
      case 'script': if (!G.modsUse?.(it.key, G.aim.x, G.aim.y)) hint('Мод этого предмета сейчас не работает'); return;   // предмет мода: решает его скрипт
      default: return;
    }
    if (!it.keep) useOne();
    G.U?.hud();
  }
  // ── Оружие ближнего боя: дуга перед игроком ──
  function swingWeapon(it){
    const p = G.pl;
    p.useT = it.speed; p.swing = it.speed; p.swingDur = it.speed; p.swingId++;
    snd('swing', { vol: .5 });
    const id = p.swingId;
    const cx = p.x + p.w / 2, cy = p.y + p.h * .45;
    for (const m of G.mobs) {
      if (m.hp <= 0 || m.hitBy === id) continue;
      const mx = clamp(cx, m.x, m.x + m.w), my = clamp(cy, m.y, m.y + m.h), dx = mx - cx, dy = my - cy;
      if (Math.hypot(dx, dy) > it.reach + .3) continue;
      if (dx * p.dir < -.6) continue;
      m.hitBy = id;
      hurtMob(m, it.dmg, p.dir);
    }
    // по пути рубит траву
    const tx = Math.floor(cx + p.dir * 1.2);
    for (let y = Math.floor(p.y); y <= Math.floor(p.y + p.h); y++) { const f = fgAt(tx, y); if (f && f !== 255 && P.TOOL[f] === 2 && P.HARD[f] === 0) breakTile(tx, y, true); }
  }
  // ── Взаимодействие: дверь, сундук, кровать, Проводник ──
  function interactAt(tx, ty){
    const p = G.pl;
    // Проводник рядом с точкой
    for (const n of G.npcs) if (Math.abs(n.x + n.w / 2 - (tx + .5)) < 1.6 && Math.abs(n.y + n.h / 2 - (ty + .5)) < 2.2 && Math.hypot(n.x - p.x, n.y - p.y) < 8) { talk(n); return true; }
    if (!inReach(tx, ty)) return false;
    const f = fgAt(tx, ty);
    if (f === T.DOOR || f === T.DOOROPEN) { toggleDoor(tx, ty); return true; }
    if (f === T.CHEST || f === T.LOOT) { const [ax, ay] = objAnchor(tx, ty); openChest(ax, ay, f); return true; }
    if (f === T.BED) { const [ax, ay] = objAnchor(tx, ty); G.W.bed = { x: ax + 1, y: ay + 1 }; toast('🛏 Точка возрождения — здесь', 'good'); return true; }
    return false;
  }
  function interactNear(){
    const p = G.pl, cx = Math.floor(p.x + p.w / 2), cy = Math.floor(p.y + p.h / 2);
    for (const n of G.npcs) if (Math.hypot(n.x - p.x, n.y - p.y) < 4) { talk(n); return true; }
    let best = null, bd = 9;
    for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
      const f = fgAt(x, y);
      if (f === T.DOOR || f === T.DOOROPEN || f === T.CHEST || f === T.LOOT || f === T.BED) { const d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = [x, y]; } }
    }
    return best ? interactAt(best[0], best[1]) : false;
  }
  function toggleDoor(x, y){
    const f = fgAt(x, y), [ax, ay] = objAnchor(x, y), to = f === T.DOOR ? T.DOOROPEN : T.DOOR;
    if (to === T.DOOR && bodyIn(ax, ay, 1, 3)) { hint('В проёме кто-то стоит'); return; }
    for (let dy = 0; dy < 3; dy++) setCell(ax, ay + dy, to, dy << 4);
    snd(to === T.DOOR ? 'door_wood_close' : 'door_wood_open', { x: ax, y: ay, vol: .7 });
  }
  function openChest(ax, ay, f){
    const k = ax + ',' + ay;
    if (!G.chests.has(k)) G.chests.set(k, f === T.LOOT ? lootFor(ax, ay) : Array(CHEST_N).fill(null));
    const c = cAt(ax, ay); if (c) { c.mod = true; G.dirtySave.add(c); }
    G.chestOpen = k;
    G.U?.chest(k);
    snd('door_wood_open', { vol: .5, rate: 1.4 });
  }
  // ── Проводник ──
  const GUIDE_TIPS = [
    'Привет! Я Проводник. Спрашивай — подскажу, как тут выжить.',
    'Деревья рубят топором 🪓: из дерева — верстак, платформы, двери.',
    'Ночью вылезают зомби. Построй дом: стены сзади, дверь, факел — и переждёшь.',
    'Факел — из дерева и геля. Гель роняют слизни.',
    'Печь (камень, дерево, факелы) плавит руду в слитки, а слитки на наковальне превращаются в кирки и мечи.',
    'Чем глубже, тем богаче руда: медь и железо сверху, серебро и золото глубже, ниже 360 м — глубинит, а у лавы — жарит.',
    'Глубинит берёт только золотая кирка, а жарит — глубинная.',
    'Кристаллы жизни ❤️ прячутся в пещерах — каждый навсегда прибавляет 20 здоровья.',
    'Вода и лава встретятся — будет обсидиан. Он нужен для огненных вещей.',
    'Желейная приманка (25 геля + гриб) зовёт Желейного великана. Совиный манок — Ночного филина, только ночью.',
    'Молоток бьёт стены, а по блоку — делает полублок и склоны.',
    'Возвратный амулет переносит домой — без него из глубины долго выбираться.',
    'Мир бесконечный: влево, вправо и вниз. Где-то есть пустыни, снега и джунгли.',
  ];
  function guideTip(){
    const CH = G.CH, list = [];
    if (count('wood') < 10 && !count('workbench') && !stationsNear().has('workbench')) list.push('Сначала наруби дерева: нужно 10, чтобы сделать верстак (кнопка 🎒 — вещи и крафт).');
    if (isNight()) list.push('Ночь! Зомби не открывают двери — переждать лучше дома.');
    if (!count('torch')) list.push('Без факелов под землёй темно. Факел = дерево + гель.');
    if (CH.maxHp < 140 && (G.W.maxDepth || 0) > 60) list.push('Ищи в пещерах кристаллы жизни — они светятся красным.');
    if (count('gel') >= 25 && !G.W.flags?.boss1) list.push('Геля хватит на приманку для Желейного великана. Приготовься: зелья, меч, укрытие.');
    const mod = G.modLines || [];
    const pool = list.length && rand() < .6 ? list : GUIDE_TIPS.concat(mod);
    return pool[Math.floor(rand() * pool.length)];
  }
  function talk(n){ G.talk = { n, text: guideTip(), t: 0 }; G.U?.talk(n.name, G.talk.text); snd('click', { vol: .5 }); G.modsEmit?.('talk', { npc: 'guide' }); }
  function newGuide(x, y){
    return { kind: 'guide', name: 'Проводник', x: x - .55, y: y - PL_H, w: 1.1, h: PL_H, vx: 0, vy: 0, ground: false, stepUp: 1.05, dir: 1, t: 2, home: x, anim: 'idle', animT: 0 };
  }
  function updNpcs(dt){
    const p = G.pl;
    for (const n of G.npcs) {
      n.animT += dt; n.t -= dt;
      const near = Math.hypot(p.x - n.x, p.y - n.y) < 6;
      if (near) { n.vx *= .8; n.dir = p.x > n.x ? 1 : -1; }
      else if (n.t <= 0) { n.t = 2 + rand() * 4; n.vx = rand() < .45 ? 0 : (rand() < .5 ? -1 : 1) * 2.2; if (Math.abs(n.x - n.home) > 12) n.vx = Math.sign(n.home - n.x) * 2.2; }
      if (n.vx) n.dir = Math.sign(n.vx);
      if (n.ground && (n.wallL || n.wallR) && n.vx) n.vy = -14;
      n.vy = Math.min(n.vy + GRAV * dt, MAXFALL);
      PZ.moveBody(n, dt, shapeAt);
      const a = !n.ground ? 'jump' : Math.abs(n.vx) > .3 ? 'walk' : 'idle';
      if (a !== n.anim) { n.anim = a; n.animT = 0; }
    }
    if (G.talk) { G.talk.t += dt; if (G.talk.t > 9 || Math.hypot(p.x - G.talk.n.x, p.y - G.talk.n.y) > 10) { G.talk = null; G.U?.talk(null); } }
  }

  const tileKey = f => TILES[f]?.key || G.modTiles?.[f]?.key || 'air';

  // ═══ Шаг мира (60 раз в секунду) ═══
  function step(dt){
    G.t += dt; G.tick++;
    G.C.step(dt);
    pollPad();
    updAim();
    if (G.state === 'play') {
      // время суток
      const t0 = G.W.time;
      G.W.time = (G.W.time + dt / DAY_LEN) % 1;
      if (t0 >= NIGHT0 && G.W.time < NIGHT0 && t0 > G.W.time) { G.W.day = (G.W.day || 1) + 1; if (!G.nightDied) ach('night'); G.nightDied = false; }
      if (t0 < NIGHT0 && G.W.time >= NIGHT0) { G.nightDied = false; toast('🌙 Наступила ночь — берегись зомби', 'bad'); }
      G.W.playtime = (G.W.playtime || 0) + dt; G.CH.playtime = (G.CH.playtime || 0) + dt;
      keysOnce();
      updPlayer(dt);
      if (G.U) G.U.touch.jumpDown = false;   // «нажали прыжок» пальцем — один шаг
      for (let n = G.mobs.length - 1; n >= 0; n--) {
        const m = G.mobs[n];
        if (m.hp <= 0) { G.mobs.splice(n, 1); continue; }
        const far = Math.abs(m.x - G.pl.x) > 110 || Math.abs(m.y - G.pl.y) > 80;
        if (far && !m.D.boss) { G.mobs.splice(n, 1); continue; }
        if (!cAt(Math.floor(m.x), Math.floor(m.y)) && !m.fly) continue;   // мир под ним ещё грузится
        mobAI(m, dt);
      }
      updNpcs(dt);
      updProjs(dt);
      updItems(dt);
      if ((G.tick & 1) === 0) liquids();
      G.spawnT -= dt; if (G.spawnT <= 0) { G.spawnT = 1; spawnTick(); }
      G.modT -= dt; if (G.modT <= 0) { G.modT = .5; G.modsTick?.(); }
    }
    updParts(dt);
    G.streamT -= dt; if (G.streamT <= 0 && G.W) { G.streamT = .25; stream(); }
    G.saveT += dt; if (G.saveT > SAVE_EVERY && G.state === 'play' && G.opt.autosave) { G.saveT = 0; saveAll(); }
    flushEdits();
    G.C.frameEnd?.();
  }
  // жидкости и песок — только около игрока, не больше бюджета за шаг
  const liqList = [];
  function liquids(){
    const p = G.pl, pcx = (p.x / CS) | 0, pcy = (p.y / CS) | 0;
    liqList.length = 0;
    for (const c of G.chunks.values()) if (c.awake && Math.abs(c.cx - pcx) <= 2 && Math.abs(c.cy - pcy) <= 2) liqList.push(c);
    if (!liqList.length) return;
    // по кругу — чтобы бюджета хватало всем
    const r = G.liqTick++ % liqList.length;
    for (let k = 0; k < r; k++) liqList.push(liqList.shift());
    PZ.liquidStep(LW, liqList, G.liqTick, 2600);
  }
  // клавиши «один раз»: ячейки, вещи, действие, пауза
  function keysOnce(){
    const C = G.C, U = G.U;
    for (let n = 1; n <= 9; n++) if (C.down('slot' + n)) selSlot(n - 1);
    if (C.down('inventory')) U?.toggleInv();
    // Esc: сначала команда/окна, потом вещи, потом разговор, и только потом — пауза
    if (C.down('pause')) { if (U?.modal()) U.closeTop(); else if (U?.invOpen()) U.toggleInv(false); else if (G.talk) { G.talk = null; U?.talk(null); } else pause(); }
    if (U?.modal()) return;
    if (C.down('interact')) interactNear();
  }
  function selSlot(i){ G.CH.sel = clamp(i, 0, HOT_N - 1); G.pl.mine = null; G.U?.hud(); }

  // ═══ Геймпад: правый стик — прицел, LB/RB — ячейки, Y — вещи, LT — лечение ═══
  function pollPad(){
    const pads = navigator.getGamepads ? navigator.getGamepads() : null, gp = pads && [...pads].find(q => q && q.connected);
    if (!gp) { G.pad.on = false; return; }
    G.pad.on = true;
    const dz = v => Math.abs(v) < .2 ? 0 : v;
    G.pad.ax = dz(gp.axes[2] || 0); G.pad.ay = dz(gp.axes[3] || 0);
    const b = i => !!gp.buttons[i]?.pressed;
    const edge = (k, v) => { const was = G.pad[k]; G.pad[k] = v; return v && !was; };
    if (edge('lb', b(4))) selSlot((G.CH.sel + HOT_N - 1) % HOT_N);
    if (edge('rb', b(5))) selSlot((G.CH.sel + 1) % HOT_N);
    if (edge('y', b(3))) G.U?.toggleInv();
    if (edge('lt', b(6)) && G.state === 'play') { const i = G.CH.inv.findIndex(s => s && (s.id === 'potion' || s.id === 'mushroom')); if (i >= 0) { const s = G.CH.inv[i]; G.CH.sel !== i && (G.CH.sel = i); useConsumable(itemDef(s.id), s); } }
    if (G.pad.ax || G.pad.ay) G.aim.src = 'pad';
  }

  // ═══ Рисование ═══
  const SKY = [   // [доля суток, верх, низ, свет неба]
    [0, [.42, .55, .82], [.98, .66, .5], [.75, .62, .6]],
    [.06, [.3, .58, .92], [.7, .84, .98], [1, .97, .93]],
    [.5, [.28, .55, .9], [.66, .82, .97], [1, .98, .95]],
    [.58, [.36, .38, .66], [1, .58, .38], [.9, .62, .5]],
    [.64, [.07, .08, .2], [.2, .17, .32], [.16, .17, .3]],
    [.8, [.02, .03, .1], [.07, .08, .18], [.1, .12, .24]],
    [.97, [.1, .12, .28], [.4, .3, .4], [.2, .2, .32]],
    [1, [.42, .55, .82], [.98, .66, .5], [.75, .62, .6]],
  ];
  const mix3 = (a, b, t, o) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };
  const skyTop = [0, 0, 0], skyBot = [0, 0, 0], skyL = [0, 0, 0], sunV = new Float32Array(4), h1 = [0, 0, 0], h2 = [0, 0, 0], h3 = [0, 0, 0];
  const BG = { top: skyTop, bot: skyBot, hill1: h1, hill2: h2, hill3: h3, sun: sunV, night: 0, surf: PZ.SURF, time: 0 };
  const CHS = { sky: skyL, amb: .045, time: 0, smooth: true, back: true };
  function skyAt(t){
    let i = 0; while (i < SKY.length - 2 && SKY[i + 1][0] <= t) i++;
    const a = SKY[i], b = SKY[i + 1], k = (t - a[0]) / (b[0] - a[0] || 1);
    mix3(a[1], b[1], k, skyTop); mix3(a[2], b[2], k, skyBot); mix3(a[3], b[3], k, skyL);
    const night = t > .6 ? clamp((t - .6) / .05, 0, 1) * (t > .95 ? clamp((1 - t) / .05, 0, 1) : 1) : 0;
    BG.night = night;
    // холмы: даль — в цвет неба
    mix3([.36, .52, .62], skyBot, .45, h1); h1[0] *= 1 - night * .7; h1[1] *= 1 - night * .7; h1[2] *= 1 - night * .6;
    mix3([.2, .42, .3], skyBot, .25, h2); h2[0] *= 1 - night * .75; h2[1] *= 1 - night * .75; h2[2] *= 1 - night * .7;
    h3[0] = .1 * (1 - night * .7); h3[1] = .26 * (1 - night * .75); h3[2] = .16 * (1 - night * .7);
    // солнце днём (0…0,62), луна ночью
    if (t < NIGHT0) { const u = t / NIGHT0; sunV[0] = .08 + u * .84; sunV[1] = .2 + Math.pow((u - .5) * 2, 2) * .5; sunV[2] = .045; sunV[3] = 1; }
    else { const u = (t - NIGHT0) / (1 - NIGHT0); sunV[0] = .1 + u * .8; sunV[1] = .18 + Math.pow((u - .5) * 2, 2) * .45; sunV[2] = .035; sunV[3] = 0; }
  }
  const visList = [];
  function render(){
    const R = G.R; if (!R || !G.W) return;
    const t0 = now();
    R.frame++;
    const [vw, vh] = viewTiles();
    // камера: за игроком, плавно; чуть вперёд по ходу
    const p = G.pl;
    const tx = p.x + p.w / 2 + p.vx * .12, ty = p.y + p.h / 2 - (p.stepOff || 0);
    const k = 1 - Math.exp(-10 / 60);
    G.cam.x += (tx - G.cam.x) * k; G.cam.y += (ty - G.cam.y) * k;
    if (Math.abs(tx - G.cam.x) > 40 || Math.abs(ty - G.cam.y) > 40) { G.cam.x = tx; G.cam.y = ty; }
    G.cam.y = Math.max(G.cam.y, vh / 2 - 30);
    let sx = 0, sy = 0;
    if (G.cam.shake > 0) { G.cam.shake = Math.max(0, G.cam.shake - 1 / 60); sx = (rand() - .5) * G.cam.shake; sy = (rand() - .5) * G.cam.shake; }
    // кратно пикселю — без «дрожи» клеток
    const camX = Math.round((G.cam.x + sx) * G.cam.tile) / G.cam.tile, camY = Math.round((G.cam.y + sy) * G.cam.tile) / G.cam.tile;
    skyAt(G.W.time);
    BG.time = G.t; CHS.time = G.t; CHS.smooth = G.opt.smooth; CHS.back = G.opt.back;
    window.D37E?._audio?.listener?.(camX, camY, 0, 0);
    // видимые чанки → на видеокарту (не больше 14 загрузок за кадр)
    visList.length = 0;
    const x0 = Math.floor((camX - vw / 2) / CS), x1 = Math.floor((camX + vw / 2) / CS), y0 = Math.max(0, Math.floor((camY - vh / 2) / CS)), y1 = Math.floor((camY + vh / 2) / CS);
    let ups = 0;
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const c = chunk(cx, cy); if (!c) continue;
      if ((c.dirty0 || c.dirty1 || c.dirtyL || !c.ready) && ups < 14) { upload(c); ups++; }
      visList.push(c);
    }
    if (ups < 6) for (const c of G.chunks.values()) { if (ups >= 6) break; if (!c.ready || c.dirty0 || c.dirty1 || c.dirtyL) { upload(c); ups++; } }
    R.begin(camX, camY);
    R.background(BG);
    R.chunks(visList, CHS, 0);
    drawSprites();
    R.flush();
    R.chunks(visList, CHS, 1);
    drawOverlay(camX, camY);
    if ((R.frame & 255) === 0) R.gc();
    G.perf.renderMs = now() - t0;
  }
  // свет в точке мира (для спрайтов): RGB источников + небо × цвет неба
  const LT = [0, 0, 0];
  function lightAt(x, y){
    const c = cAt(Math.floor(x), Math.floor(y));
    if (!c) { LT[0] = LT[1] = LT[2] = .1; return LT; }
    const i = idx(Math.floor(x), Math.floor(y)) << 2, L = c.light, s = L[i + 3] / 255;
    LT[0] = Math.min(1, Math.max(L[i] / 230, s * skyL[0]) + .06); LT[1] = Math.min(1, Math.max(L[i + 1] / 230, s * skyL[1]) + .06); LT[2] = Math.min(1, Math.max(L[i + 2] / 230, s * skyL[2]) + .06);
    return LT;
  }
  function spr(name, f, x, y, w, h, flip, rot, tint, a, ox, oy, lit = true){
    const fr = G.A.spr[name]; if (!fr) return;
    const q = fr[f % fr.length];
    let r = 255, g = 255, b = 255;
    if (tint) { r = tint[0]; g = tint[1]; b = tint[2]; }
    if (lit) { const L = lightAt(x + w / 2, y + h / 2); r = r * L[0] | 0; g = g * L[1] | 0; b = b * L[2] | 0; }
    G.R.sprite(null, x, y, w, h, q[0], q[1], q[0] + q[2], q[1] + q[3], r, g, b, (a ?? 1) * 255 | 0, flip, rot, ox, oy);
  }
  function itemSpr(id, x, y, w, h, rot, ox, oy, flip, lit = true){
    const c = G.A.item[id]; if (c === undefined) return;
    const u = (c % 64) * 16, v = (c >> 6) * 16;
    let r = 255, g = 255, b = 255;
    if (lit) { const L = lightAt(x + w / 2, y + h / 2); r = 255 * L[0] | 0; g = 255 * L[1] | 0; b = 255 * L[2] | 0; }
    G.R.sprite(null, x, y, w, h, u, v, u + 16, v + 16, r, g, b, 255, flip, rot, ox, oy);
  }
  // 2D-персонаж сайта (D37Sprite): кадр → спрайт; не готов — запасной человечек
  function drawChar(H, anim, t, footX, footY, left, hurt, itemId, swingK){
    const R = G.R;
    let drawn = false, handX = footX + (left ? -.45 : .45), handY = footY - PL_SPR * .5;
    if (H && H.sheet && !H.sheet.fallback) {
      const F = H.frame(anim, t, null, left);
      if (F) {
        const k = PL_SPR / H.sheet.nom;
        const L = lightAt(footX, footY - 1.4), red = hurt ? 1.6 : 1;
        if (H.sheet.px) R.pixelImgs?.add?.(F.img);
        const w = F.sw * k, h = F.sh * k, x = F.flip ? footX - (F.sw - F.ax) * k : footX - F.ax * k;
        // предмет за спиной (рука сзади) — раньше персонажа
        const hd = H.hand(anim, t, null, left);
        if (hd) { handX = footX + hd[0] * k; handY = footY + hd[1] * k; }
        if (itemId && hd && hd[2]) heldItem(itemId, handX, handY, left, swingK);
        R.sprite(F.img, x, footY - F.ay * k, w, h, F.sx, F.sy, F.sx + F.sw, F.sy + F.sh, Math.min(255, 255 * L[0] * red) | 0, 255 * L[1] | 0, 255 * L[2] | 0, 255, F.flip);
        if (itemId && !(hd && hd[2])) heldItem(itemId, handX, handY, left, swingK);
        drawn = true;
      }
    }
    if (!drawn) {
      const f = anim === 'walk' || anim === 'run' ? Math.floor(t * 8) % 2 : 0;
      spr('person', f, footX - 1.25 / 2 * 1.1, footY - 2.75, 1.25, 2.75, left, 0, hurt ? [255, 120, 120] : null);
      if (itemId) heldItem(itemId, handX, handY, left, swingK);
    }
  }
  // предмет в руке: инструмент/меч — поворот по взмаху, блоки — маленьким кубиком
  function heldItem(id, hx, hy, left, swingK){
    const it = itemDef(id); if (!it) return;
    const tool = it.kind === 'tool' || it.kind === 'melee' || it.kind === 'wand' || it.kind === 'bow';
    const s = tool ? 1.15 : .7;
    let rot;
    if (swingK != null && tool && it.kind !== 'bow' && it.kind !== 'wand') rot = -2.1 + swingK * 2.8;   // замах сверху вниз
    else if (it.kind === 'bow' || it.kind === 'wand') { const [dx, dy] = aimDir(); rot = Math.atan2(dy, Math.abs(dx)) - (it.kind === 'bow' ? 0 : -.8); }
    else rot = tool ? -.5 : 0;
    if (left) rot = -rot;
    // рукоять у кисти: значок нарисован «из левого нижнего угла»
    const ox = left ? s * .82 : s * .18, oy = s * .82;
    itemSpr(id, hx - ox, hy - oy, s, s, rot, ox, oy, left);
  }
  function drawSprites(){
    const p = G.pl, t = G.t, A = G.A;
    // Проводник
    for (const n of G.npcs) drawChar(G.guideH, n.anim, n.animT, n.x + n.w / 2, n.y + n.h, n.dir < 0, false, null, null);
    // выпавшие предметы (покачиваются)
    for (const it of G.items) itemSpr(it.id, it.x - .1, it.y - .15 + Math.sin(t * 3 + it.x) * .06, .8, .8, 0);
    // мобы
    for (const m of G.mobs) {
      const D = m.D, fr = A.spr[D.spr]; if (!fr) continue;
      let f = 0;
      if (D.ai === 'slime' || D.ai === 'bossSlime') f = !m.ground ? (m.vy < 0 ? 2 : 0) : m.t < .25 ? 1 : 0;
      else if (D.ai === 'walker') f = Math.abs(m.vx) > .2 ? Math.floor(m.anim * (D.spr === 'zombie' ? 6 : 8)) % fr.length : 0;
      else f = Math.floor(m.anim * (D.ai === 'bossOwl' ? 8 : 12)) % fr.length;
      const tint = m.hurt > 0 ? [255, 140, 140] : D.tint || null;
      const sw = D.ai === 'bossSlime' ? m.w * 1.1 : m.w * (D.ai === 'slime' ? 1.12 : D.spr === 'zombie' ? 1.1 : 1.05), sh = m.h * (D.ai === 'slime' || D.ai === 'bossSlime' ? 1.15 : 1.04);
      const lit = D.spr !== 'imp';
      spr(D.spr, f, m.x + m.w / 2 - sw / 2, m.y + m.h - sh, sw, sh, m.dir < 0 && D.ai !== 'bat', 0, tint, m.alpha, null, null, lit);
      if (!D.boss && m.hp < m.maxHp) { const w = m.w, k = m.hp / m.maxHp; spr('white', 0, m.x, m.y - .45, w, .16, false, 0, [30, 30, 30], .8, null, null, false); spr('white', 0, m.x, m.y - .45, w * k, .16, false, 0, k > .5 ? [90, 220, 90] : [230, 80, 60], .9, null, null, false); }
    }
    // игрок
    if (!p.dead) {
      const s = selItem(), held = s ? s.id : null, it = held ? itemDef(held) : null;
      const swingK = p.swing > 0 && it && (it.kind === 'tool' || it.kind === 'melee') ? 1 - p.swing / (it.speed || .3) : null;
      const blink = p.iframes > 0 && Math.floor(t * 20) % 2 === 0;
      if (!blink) drawChar(G.H, p.anim, p.anim === 'use' ? (1 - p.swing / (p.swingDur || .3)) * .32 : p.animT, p.x + p.w / 2, p.y + p.h + (p.stepOff || 0), p.dir < 0, p.hurtT > 0, held, swingK);
    }
    // снаряды
    for (const q of G.projs) { const fr = A.spr[q.spr]; if (!fr) continue; const [, , w, h] = fr[0], sw = w / 16, sh = h / 16; spr(q.spr, Math.floor(q.t * 10), q.x - sw / 2, q.y - sh / 2, sw, sh, false, Math.atan2(q.vy, q.vx), null, 1, sw / 2, sh / 2, q.spr === 'arrowp'); }
    // частицы
    for (let i = 0; i < PT.n; i++) {
      const c = PT.c[i], k = 1 - PT.t[i] / PT.life[i], s = PT.s[i];
      let r = c >> 16 & 255, g = c >> 8 & 255, b = c & 255;
      if (!PT.glow[i]) { const L = lightAt(PT.x[i], PT.y[i]); r = r * L[0] | 0; g = g * L[1] | 0; b = b * L[2] | 0; }
      const q = A.spr.white[0];
      G.R.sprite(null, PT.x[i] - s / 2, PT.y[i] - s / 2, s, s, q[0], q[1], q[0] + 4, q[1] + 4, r, g, b, 255 * Math.min(1, k * 1.5) | 0);
    }
    // курсор и трещины
    if (G.state === 'play' && !p.dead && !G.U?.modal()) {
      const [cx, cy] = cursorTile(), ok = inReach(cx, cy);
      spr('frame', 0, cx, cy, 1, 1, false, 0, ok ? [255, 255, 255] : [255, 90, 90], ok ? .7 : .35, null, null, false);
      if (p.mine) { const f = fgAt(p.mine.x, p.mine.y), hard = p.mine.layer === 'wall' ? 30 : P.HARD[f] || 1, st = clamp(Math.floor(p.mine.dmg / hard * 4), 0, 3); spr('crack', st, p.mine.x, p.mine.y, 1, 1, false, 0, null, 1, null, null, false); }
    }
  }
  // надписи (2D поверх): цифры урона, имена, подсказка над курсором
  function drawOverlay(camX, camY){
    const o = G.octx; if (!o) return;
    const W = G.ov.width, H = G.ov.height, s = G.cam.tile / G.res;
    o.clearRect(0, 0, W, H);
    const sxOf = x => (x - camX) * s + W / 2 / G.dpr2, syOf = y => (y - camY) * s + H / 2 / G.dpr2;
    o.save(); o.scale(G.dpr2, G.dpr2);
    o.textAlign = 'center'; o.font = '800 14px system-ui, sans-serif'; o.lineWidth = 3; o.strokeStyle = 'rgba(0,0,0,.75)';
    for (let n = G.texts.length - 1; n >= 0; n--) {
      const q = G.texts[n]; q.t += 1 / 60;
      if (q.t > 1.1) { G.texts.splice(n, 1); continue; }
      const x = sxOf(q.x), y = syOf(q.y) - q.t * 28;
      o.globalAlpha = Math.min(1, (1.1 - q.t) * 3);
      o.strokeText(q.text, x, y); o.fillStyle = q.color; o.fillText(q.text, x, y);
    }
    o.globalAlpha = 1;
    o.font = '700 12px system-ui, sans-serif';
    for (const n of G.npcs) { const x = sxOf(n.x + n.w / 2), y = syOf(n.y) - 16; o.strokeText(n.name, x, y); o.fillStyle = '#ffe6a0'; o.fillText(n.name, x, y); }
    if (G.opt.fps) { const L = G.perf.frames, avg = L.length ? L.reduce((a, b) => a + b, 0) / L.length : 0, cpu = G.perf.cpu.length ? G.perf.cpu.reduce((a, b) => a + b, 0) / G.perf.cpu.length : 0; o.textAlign = 'left'; o.font = '600 12px ui-monospace, monospace'; const txt = `${avg ? (1000 / avg).toFixed(0) : '–'} к/с · кадр ${avg.toFixed(1)} мс · ЦП ${cpu.toFixed(2)} мс · чанков ${G.chunks.size} · вызовов ${G.R.stats.draws} · спрайтов ${G.R.stats.sprites}`; o.strokeText(txt, 8, H / G.dpr2 - 10); o.fillStyle = '#9fffa0'; o.fillText(txt, 8, H / G.dpr2 - 10); }
    o.restore();
  }

  // ═══ Цикл: логика 60 раз/с, рисование — каждый кадр ═══
  function loop(){
    let acc = 0, last = now(), raf = 0, on = true;
    const f = tm => {
      if (!on) return;
      raf = requestAnimationFrame(f);
      const dtms = tm - last; last = tm;
      if (document.hidden) return;
      const dt = Math.min(.1, Math.max(0, dtms / 1000));
      if (dtms > 0 && dtms < 500) { G.perf.frames.push(dtms); if (G.perf.frames.length > 120) G.perf.frames.shift(); }
      if (G.state === 'play' || G.state === 'paused' || G.state === 'loading') {
        const c0 = now();
        acc += G.state === 'paused' ? 0 : dt;
        let n = 0;
        while (acc >= 1 / 60 && n < 5) { step(1 / 60); acc -= 1 / 60; n++; }
        if (n === 5) acc = 0;
        if (G.state === 'loading') loadingTick();
        render();
        G.perf.cpu.push(now() - c0); if (G.perf.cpu.length > 120) G.perf.cpu.shift();   // ЦП за кадр: логика + рисование
        G.hudT -= dt; if (G.hudT <= 0) { G.hudT = .25; G.U?.hud(); G.U?.status(statusText()); }
      }
    };
    raf = requestAnimationFrame(f);
    return { stop(){ on = false; cancelAnimationFrame(raf); } };
  }
  function statusText(){
    const p = G.pl, x = Math.floor(p.x + p.w / 2), C = G.gen.colInfo(x), y = p.y + p.h;
    const d = Math.round((y - PZ.SURF) * M_PER_TILE);
    const tm = (G.W.time * 24 + 6) % 24, hh = Math.floor(tm), mm = Math.floor((tm - hh) * 60);
    const layer = y < C.h + 4 ? PZ.BIOME_NAMES[C.b] : y < C.deep ? 'Пещеры' : y < C.lava ? 'Глубины' : 'Лавовый слой';
    return `${isNight() ? '🌙' : '☀️'} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${d >= 0 ? `глубина ${d} м` : `высота ${-d} м`} · ${layer} · ${Math.round((x - G.W.spawn.x) * M_PER_TILE)} м от дома`;
  }
  // мир грузится: ждём чанки вокруг игрока
  function loadingTick(){
    const p = G.pl;
    let ready = true;
    // чанки под игроком и вокруг (±3 клетки) — пришли
    for (let y = Math.max(0, Math.floor(p.y) - 3); y <= Math.floor(p.y + p.h) + 3; y += 3) for (let x = Math.floor(p.x) - 3; x <= Math.floor(p.x + p.w) + 3; x += 3) if (!chunk(x >> CB, y >> CB)) ready = false;
    G.loadT = (G.loadT || 0) + 1 / 60;
    if (ready || G.loadT > 20) {
      G.state = 'play'; G.U?.loading(false);
      // новый мир: игрок — на земле у старта
      if (G.fresh) { const y = groundY(Math.floor(p.x + p.w / 2), Math.floor(p.y)); if (y != null) { p.y = y - p.h; p.fallY = p.y; } G.fresh = false; }
    }
  }

  // ═══ Размер холста ═══
  function resize(){
    if (!G?.cv) return;
    const box = G.wrap.getBoundingClientRect();
    const fs = window.D37Full?.contains?.(G.wrap);
    let w = Math.max(280, Math.floor(box.width || G.el.clientWidth || 360));
    let h;
    if (fs) h = Math.max(240, Math.floor(window.innerHeight - box.top));
    else { const phone = w < 640; h = phone ? Math.min(window.innerHeight - 120, Math.round(w * 1.25)) : Math.min(Math.max(420, window.innerHeight - 200), Math.round(w * .62)); h = Math.max(300, h); }
    G.wrap.style.height = h + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const base = clamp(Math.round(Math.min(w, h * 1.7) / 46), 13, 30), tileCss = base * G.opt.zoom;
    const maxPx = document.body.classList.contains('low') ? 18 : 32;
    G.res = Math.max(.5, Math.min(dpr, maxPx / tileCss));
    G.cam.tile = tileCss * G.res;
    G.R?.resize(Math.round(w * G.res), Math.round(h * G.res), G.cam.tile);
    G.cv.style.width = w + 'px'; G.cv.style.height = h + 'px';
    G.dpr2 = Math.min(2, dpr);
    G.ov.width = Math.round(w * G.dpr2); G.ov.height = Math.round(h * G.dpr2); G.ov.style.width = w + 'px'; G.ov.style.height = h + 'px';
    G.cssW = w; G.cssH = h;
    // 2D-персонаж — под размер клетки
    const size = clamp(Math.round(tileCss * PL_SPR / 8) * 8, 32, 128);
    if (G.H && G.H.O.size !== size) G.H.set(G.look, { size });
    if (G.guideH && G.guideH.O.size !== size) G.guideH.set(G.guideLook, { size });
  }

  // ═══ Сохранение ═══
  function chunkRecord(c){
    const ch = [];
    for (const [k, items] of G.chests) { const [ax, ay] = k.split(',').map(Number); if (ax >> CB === c.cx && ay >> CB === c.cy) ch.push([ax, ay, items.map(s => s ? { id: s.id, n: s.n } : null)]); }
    return { d: PZ.packChunk(c), ch };
  }
  function saveChunks(list){
    if (!G?.W) return Promise.resolve();
    const wid = G.W.id, recs = [];
    for (const c of list) { if (!c.mod) continue; const k = ckey(wid, c.cx, c.cy); recs.push([k, chunkRecord(c)]); G.saved.add(k); }
    for (const c of list) G.dirtySave.delete(c);
    if (!recs.length) return Promise.resolve();
    return DB.putMany('chunks', recs).catch(e => { console.warn('Подземье: не сохранилось', e); toast('⚠️ Не удалось сохранить мир (место в браузере?)', 'bad'); });
  }
  function charRecord(){ const CH = G.CH; CH.updated = Date.now(); return JSON.parse(JSON.stringify(CH)); }
  function worldRecord(){
    const W = G.W; W.updated = Date.now();
    W.guide = G.npcs[0] ? { x: G.npcs[0].x + G.npcs[0].w / 2, y: G.npcs[0].y + G.npcs[0].h } : W.guide;
    W.pos = { x: G.pl.x + G.pl.w / 2, y: G.pl.y + G.pl.h };
    return JSON.parse(JSON.stringify(W));
  }
  let saving = null;
  function saveAll(){
    if (!G?.W || !G.CH) return Promise.resolve();
    if (saving) return saving;
    const p = Promise.all([saveChunks([...G.dirtySave]), DB.put('worlds', worldRecord()), DB.put('chars', charRecord())])
      .then(() => { lsSet(LS_JOURNAL, null); lsSet(LS_LAST, JSON.stringify({ w: G.W.id, c: G.CH.id })); }, e => console.warn('Подземье: сохранение', e))
      .finally(() => { saving = null; });
    saving = p;
    return p;
  }
  // уходят со вкладки / закрывают: в базу (может не успеть) + журнал в localStorage (успеет точно)
  function journal(){
    if (!G?.W || !G.CH || G.state === 'menu') return;
    const dirty = [...G.dirtySave].filter(c => c.mod);
    const j = { w: G.W.id, at: Date.now(), world: worldRecord(), char: charRecord(), chunks: {} };
    let size = 0;
    for (const c of dirty) { const r = chunkRecord(c), s = PZ.toB64(r.d); size += s.length; if (size > 1.5e6) break; j.chunks[c.cx + '|' + c.cy] = { d: s, ch: r.ch }; }
    lsSet(LS_JOURNAL, JSON.stringify(j));
    saveAll();
  }
  // при входе: журнал новее базы — влить
  async function applyJournal(){
    let j = null; try { j = JSON.parse(lsGet(LS_JOURNAL) || 'null'); } catch (e) {}
    if (!j || !j.w) return;
    try {
      const recs = [];
      for (const [k, v] of Object.entries(j.chunks || {})) { const [cx, cy] = k.split('|').map(Number); recs.push([ckey(j.w, cx, cy), { d: PZ.fromB64(v.d), ch: v.ch || [] }]); }
      if (recs.length) await DB.putMany('chunks', recs);
      const w = await DB.get('worlds', j.w);
      if (j.world && (!w || (w.updated || 0) <= j.at)) await DB.put('worlds', j.world);
      const c = j.char && await DB.get('chars', j.char.id);
      if (j.char && (!c || (c.updated || 0) <= j.at)) await DB.put('chars', j.char);
      lsSet(LS_JOURNAL, null);
    } catch (e) { console.warn('Подземье: журнал', e); }
  }

  // ═══ Миры и персонажи: создать, загрузить, удалить, экспорт/импорт ═══
  function seedOf(s){
    s = String(s ?? '').trim();
    if (!s) return (Math.random() * 4294967295) >>> 0 || 1;
    if (/^\d{1,10}$/.test(s)) return (+s >>> 0) || 1;
    let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0 || 1;
  }
  function newWorldRecord(name, seedText, mods){
    const seed = seedOf(seedText), gen = PZ.makeGen(seed), sp = gen.spawnPoint();
    return { id: uid('w'), name: String(name || 'Мой мир').slice(0, 32), seed, seedText: String(seedText || seed).slice(0, 40), created: Date.now(), updated: Date.now(), playtime: 0,
      spawn: { x: sp.x, y: sp.y + 1 }, time: .08, day: 1, flags: {}, mods: (mods || []).slice(0, 16), palette: {}, maxDepth: 0, guide: null, ver: 1 };
  }
  function newCharRecord(name){
    const inv = Array(INV_N).fill(null);
    [['pick_copper', 1], ['axe_copper', 1], ['sword_copper', 1], ['hammer', 1], ['torch', 8], ['mushroom', 2]].forEach(([id, n], i) => { inv[i] = { id, n }; });
    return { id: uid('c'), name: String(name || 'Герой').slice(0, 24), created: Date.now(), updated: Date.now(), playtime: 0, inv, sel: 0, hp: 100, maxHp: 100, mana: 20, maxMana: 20, ach: {}, ver: 1 };
  }
  const listWorlds = () => DB.all('worlds').then(a => a.sort((x, y) => (y.updated || 0) - (x.updated || 0)), () => []);
  const listChars = () => DB.all('chars').then(a => a.sort((x, y) => (y.updated || 0) - (x.updated || 0)), () => []);
  async function deleteWorld(id){ await DB.delRange('chunks', id + '|', id + '|￿'); await DB.del('worlds', id); }
  async function deleteChar(id){ await DB.del('chars', id); }
  async function exportWorld(id){
    const w = await DB.get('worlds', id); if (!w) return null;
    const [keys, vals] = await DB.getRange('chunks', id + '|', id + '|￿');
    const chunks = {};
    keys.forEach((k, i) => { const [, cx, cy] = k.split('|'); chunks[cx + '|' + cy] = { d: PZ.toB64(vals[i].d instanceof Uint8Array ? vals[i].d : new Uint8Array(vals[i].d)), ch: vals[i].ch || [] }; });
    return { fmt: 'd37-podzem-world', v: 1, at: Date.now(), world: w, chunks };
  }
  async function importWorld(data){
    if (!data || data.fmt !== 'd37-podzem-world' || !data.world || typeof data.world.seed !== 'number') throw new Error('Это не файл мира «Подземья»');
    const w = Object.assign({}, data.world, { id: uid('w'), name: String(data.world.name || 'Мир').slice(0, 32) + ' (копия)', updated: Date.now() });
    const recs = [];
    for (const [k, v] of Object.entries(data.chunks || {})) {
      const m = /^(-?\d+)\|(\d+)$/.exec(k); if (!m) continue;
      const d = PZ.fromB64(v.d); PZ.unpackChunk(d);   // проверка: битый — исключение
      recs.push([ckey(w.id, +m[1], +m[2]), { d, ch: Array.isArray(v.ch) ? v.ch.slice(0, 64) : [] }]);
      if (recs.length > 20000) break;
    }
    if (recs.length) await DB.putMany('chunks', recs);
    await DB.put('worlds', w);
    return w;
  }
  async function exportChar(id){ const c = await DB.get('chars', id); return c ? { fmt: 'd37-podzem-char', v: 1, char: c } : null; }
  async function importChar(data){
    if (!data || data.fmt !== 'd37-podzem-char' || !data.char) throw new Error('Это не файл персонажа «Подземья»');
    const c = Object.assign(newCharRecord(data.char.name), data.char, { id: uid('c'), updated: Date.now() });
    c.inv = Array.from({ length: INV_N }, (_, i) => { const s = data.char.inv?.[i]; return s && typeof s.id === 'string' && s.n > 0 ? { id: s.id.slice(0, 64), n: Math.min(9999, s.n | 0) } : null; });
    c.maxHp = clamp(c.maxHp | 0, 100, 400); c.hp = clamp(c.hp | 0, 1, c.maxHp); c.maxMana = clamp(c.maxMana | 0, 20, 200); c.mana = clamp(+c.mana || 0, 0, c.maxMana);
    await DB.put('chars', c);
    return c;
  }

  // ═══ Запуск мира ═══
  async function play(worldId, charId){
    const W = await DB.get('worlds', worldId), CH = await DB.get('chars', charId);
    if (!W || !CH) { toast('Мир или персонаж не найден', 'bad'); return; }
    if (G.state !== 'menu') await stopWorld(true);
    // старые сохранения: недостающие поля
    CH.inv = Array.from({ length: INV_N }, (_, i) => CH.inv?.[i] || null);
    if (!(CH.hp > 0)) CH.hp = CH.maxHp;   // сохранились мёртвыми (вкладку закрыли во время возрождения)
    W.flags = W.flags || {}; W.palette = W.palette || {};
    G.W = W; G.CH = CH;
    G.gen = PZ.makeGen(W.seed);
    G.chunks.clear(); G.pending.clear(); G.want.clear(); G.metaOf.clear(); G.dirtySave.clear(); G.chests = new Map();
    G.mobs.length = 0; G.items.length = 0; G.projs.length = 0; G.npcs.length = 0; G.texts.length = 0; G.boss = null; PT.n = 0;
    G.edits.length = 0; G.editIdx.clear(); G.cheats = !!W.cheats;
    lastC = null;
    G.U?.loading(true, 'Мир строится…');
    // моды мира
    await (G.modsStart ? G.modsStart(W) : Promise.resolve());
    // сохранённые чанки — список ключей (без данных)
    try { G.saved = new Set(await DB.keys('chunks', W.id + '|', W.id + '|￿')); } catch (e) { G.saved = new Set(); }
    // атлас (с блоками модов) и рисовальщик
    buildAtlas();
    G.worker?.stop();
    G.worker = startWorker();
    G.worker.post({ t: 'init', seed: W.seed, props: G.modProps || null, feats: G.modFeats || null });
    const pos = W.pos || { x: W.spawn.x + .5, y: W.spawn.y };
    G.pl = newPlayer(pos.x, pos.y);
    G.fresh = !W.pos;
    const gp = W.guide || { x: W.spawn.x + 4, y: W.spawn.y };
    G.npcs.push(newGuide(gp.x, gp.y));
    G.cam.x = G.pl.x; G.cam.y = G.pl.y;
    G.state = 'loading'; G.loadT = 0;
    stream(true);
    G.U?.hud(); G.U?.inv();
    lsSet(LS_LAST, JSON.stringify({ w: W.id, c: CH.id }));
    G.api?.toast && 0;
  }
  async function stopWorld(save){
    if (!G.W) { G.state = 'menu'; return; }
    if (save) await saveAll();
    reportDepth();
    G.modsStop?.();
    G.worker?.stop(); G.worker = null;
    for (const c of G.chunks.values()) G.R?.chunkFree(c);
    G.chunks.clear(); G.W = null; G.CH = null; G.state = 'menu';
  }
  // рекорд глубины — в таблицу рекордов сайта (без XP), не чаще раза в минуту
  let depthSent = 0, depthAt = 0;
  function reportDepth(){
    const d = G?.W?.maxDepth || 0;
    if (!G?.api?.report || d <= depthSent || Date.now() - depthAt < 60e3 || G.cheats) return;
    depthSent = d; depthAt = Date.now();
    G.api.report('podzem', false, Math.min(100000, d), d);
  }
  function buildAtlas(){
    const mods = G.modAtlas || {};
    G.A = window.PZGL.paint(PZ, mods);
    G.R.setAtlas(G.A); G.R.setProps(PZ, G.A);
    G.U?.atlas(G.A);
  }
  function pause(){
    if (G.state !== 'play') return;
    G.state = 'paused'; G.C.reset_state?.(); G.mouse.l = false;
    G.U?.menu('pause');
    saveAll();
  }
  function resume(){ if (G.state === 'paused') { G.state = 'play'; G.U?.menu(null); } }

  // ═══ Мышь, колесо, клавиша 0, прицел пальцем ═══
  function bindInput(){
    const cv = G.cv;
    const pos = e => { const r = cv.getBoundingClientRect(); G.mouse.sx = e.clientX - r.left; G.mouse.sy = e.clientY - r.top; };
    on(cv, 'contextmenu', e => e.preventDefault());
    on(cv, 'pointermove', e => { if (e.pointerType !== 'mouse') return; pos(e); G.mouse.in = true; G.aim.src = 'mouse'; });
    on(cv, 'pointerleave', e => { if (e.pointerType === 'mouse') G.mouse.in = false; });
    on(cv, 'pointerdown', e => {
      if (e.pointerType !== 'mouse') return;
      pos(e); G.mouse.in = true; G.aim.src = 'mouse';
      if (G.state !== 'play' || G.U?.modal()) return;
      if (e.button === 0) G.mouse.l = true;
      if (e.button === 2) { updAim(); const [tx, ty] = cursorTile(); if (!interactAt(tx, ty)) useRight(); }
      e.preventDefault();
    });
    on(window, 'pointerup', e => { if (e.pointerType === 'mouse' && e.button === 0) G.mouse.l = false; });
    on(window, 'blur', () => { G.mouse.l = false; });
    on(cv, 'wheel', e => {
      if (G.state !== 'play') return;
      e.preventDefault();
      if (e.ctrlKey) { zoom(e.deltaY > 0 ? .9 : 1.1); return; }
      selSlot((G.CH.sel + (e.deltaY > 0 ? 1 : HOT_N - 1)) % HOT_N);
    }, { passive: false });
    on(window, 'keydown', e => {
      if (!G || G.state !== 'play' || e.target?.closest?.('input, textarea')) return;
      if (e.code === 'Digit0') { selSlot(9); e.preventDefault(); }
      else if (e.code === 'Equal' || e.code === 'NumpadAdd') zoom(1.1);
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract') zoom(.9);
      else if (e.code === 'KeyH') { const i = G.CH.inv.findIndex(s => s && (s.id === 'potion' || s.id === 'mushroom')); if (i >= 0) useConsumable(itemDef(G.CH.inv[i].id)); }
      else if (e.code === 'Slash' || (e.code === 'Enter' && !G.U?.modal())) { G.U?.command(); e.preventDefault(); }
    });
  }
  // ПКМ без двери/сундука: еда/зелье в руке — съесть
  function useRight(){ const s = selItem(), it = s && itemDef(s.id); if (it && it.kind === 'use') useConsumable(it, s); }
  function zoom(k){ G.opt.zoom = clamp(G.opt.zoom * k, .6, 1.9); saveOpt(); resize(); }
  function saveOpt(){ lsSet(LS_OPT, JSON.stringify(G.opt)); }
  // прицел пальцем (podzem-ui.js): sx, sy — точка на холсте
  function aimTouch(sx, sy){
    G.aim.src = 'touch';
    G.aim.x = G.cam.x + (sx * G.res - G.R.w / 2) / G.cam.tile; G.aim.y = G.cam.y + (sy * G.res - G.R.h / 2) / G.cam.tile;
  }
  function tapTouch(sx, sy){
    aimTouch(sx, sy);
    const [tx, ty] = cursorTile();
    if (interactAt(tx, ty)) return true;
    return false;
  }

  // ═══ Команды (чат «/»): свои + от модов ═══
  function runCommand(line){
    line = String(line || '').trim(); if (!line) return;
    const [cmd, ...args] = line.replace(/^\//, '').split(/\s+/);
    const c = cmd.toLowerCase();
    if (c === 'help' || c === 'помощь') { toast('Команды: /seed, /pos, /mods, /time, /save' + (G.modCmds?.length ? ', ' + G.modCmds.map(x => '/' + x).join(', ') : ''), 'info'); return; }
    if (c === 'seed' || c === 'зерно') { toast(`Зерно мира: ${G.W.seedText || G.W.seed}`, 'info'); return; }
    if (c === 'pos') { toast(statusText(), 'info'); return; }
    if (c === 'save') { saveAll().then(() => toast('💾 Сохранено', 'good')); return; }
    if (c === 'mods' || c === 'моды') { toast('Моды мира: ' + ((G.W.mods || []).join(', ') || 'нет'), 'info'); return; }
    if (c === 'time') {   // смена времени — «читы»: награды сайта в этом мире больше не выдаются
      const v = args[0] === 'day' || args[0] === 'день' ? .1 : args[0] === 'night' || args[0] === 'ночь' ? .66 : null;
      if (v == null) { toast('/time day или /time night (выключит награды сайта в этом мире)', 'info'); return; }
      G.W.time = v; G.cheats = G.W.cheats = true; toast('⏰ Время изменено. Награды сайта в этом мире выключены.', 'bad'); return;
    }
    if (G.modsCommand?.(c, args)) return;
    toast(`Нет команды /${c} — /help`, 'bad');
  }

  // ═══ Подключение к странице ═══
  function mount(el, api){
    if (G) unmount();
    G = newState(el, api);
    const U = window.PZUI;
    el.innerHTML = '';
    const root = document.createElement('div'); root.className = 'pz gs-noesc';
    root.innerHTML = '<div class="pz-wrap"><canvas class="pz-gl"></canvas><canvas class="pz-ov"></canvas></div>';
    el.appendChild(root);
    G.root = root; G.wrap = root.querySelector('.pz-wrap'); G.cv = root.querySelector('.pz-gl'); G.ov = root.querySelector('.pz-ov'); G.octx = G.ov.getContext('2d');
    try { G.R = window.PZGL.renderer(G.cv); } catch (e) { console.warn(e); G.R = null; }
    if (!G.R) {
      root.innerHTML = '<div class="empty-state"><span class="empty-state-icon">🧱</span><div class="empty-state-title">Нужен WebGL2</div><div class="empty-state-text">«Подземье» рисуется видеокартой. Обнови браузер (Chrome, Edge, Яндекс, Firefox, Safari 15+) или включи аппаратное ускорение.</div></div>';
      return;
    }
    G.C = window.D37E.controls({});
    G.U = U ? U.create(G, API) : null;
    G.U?.build(root);
    bindInput();
    on(window, 'resize', resize);
    G.offFs = window.D37Full?.on?.(() => setTimeout(resize, 60));
    on(document, 'visibilitychange', () => { if (document.hidden) journal(); });
    on(window, 'pagehide', journal);
    resize();
    G.look = window.D37Char?.look?.() || {};
    // 2D-персонаж сайта (сбоку, пиксели) — лист печётся в простое
    const sprites = () => {
      const SP = window.D37Sprite; if (!SP || !SP.supported()) return;
      const size = clamp(Math.round(G.cam.tile / G.res * PL_SPR / 8) * 8, 32, 128);
      G.H = SP.handle(G.look, { view: 'side', size, noItem: true, pin: true, key: SP.myKey(), style: SP.styleFor('pixel'), anims: ['idle', 'walk', 'run', 'jump', 'fall', 'use', 'climb', 'swim', 'hurt'] });
      G.guideLook = { body: 'boy', tone: 't4', hair: 'side', hairc: 'brown', top: 'sweater', color: 'green', botc: 'khaki', shoes: 'boots', hat: 'none', item: 'none', pet: 'none', trail: 'none' };
      G.guideH = SP.handle(G.guideLook, { view: 'side', size, noItem: true, key: 'pz-guide', style: SP.styleFor('pixel'), anims: ['idle', 'walk', 'jump'] });
    };
    if (window.D37Sprite) sprites();
    else if (typeof gamesLoadScript === 'function') gamesLoadScript('js/core/char2d.js').then(sprites).catch(() => {});
    G.offLook = window.D37Char?.on?.(() => { G.look = window.D37Char.look(); G.H?.set(G.look); });
    G.loop = loop();
    if (window.PZMods) G.mods = window.PZMods.attach(G, API);
    applyJournal().finally(() => G?.U?.menu('start'));
  }
  function unmount(){
    if (!G) return;
    const g = G;
    try { if (g.state !== 'menu') { journal(); reportDepth(); } } catch (e) {}
    g.alive = false;
    g.loop?.stop();
    g.modsStop?.();
    g.worker?.stop();
    for (const [t, ev, f, o] of g.listeners) t.removeEventListener(ev, f, o);
    g.offFs?.(); g.offLook?.();
    g.C?.dispose?.();
    g.U?.dispose();
    try { for (const c of g.chunks.values()) g.R?.chunkFree(c); g.R?.dispose(); } catch (e) {}
    G = null; lastC = null;
  }

  // Для интерфейса и модов
  const API = {
    get G(){ return G; }, PZ, INV_N, HOT_N, CHEST_N, ACH, MOBS, DAY_LEN, NIGHT0,
    play, stopWorld, saveAll, pause, resume, respawn, selSlot, craftList, craft, give, take, count, itemDef, stackOf, zoom, saveOpt, resize,
    listWorlds, listChars, newWorldRecord, newCharRecord, deleteWorld, deleteChar, exportWorld, importWorld, exportChar, importChar,
    put: (st, v) => DB.put(st, v), dbAll: st => DB.all(st), dbDel: (st, k) => DB.del(st, k), dbGet: (st, k) => DB.get(st, k),
    aimTouch, tapTouch, interactNear, useItem: () => useItem(), runCommand, toast, snd, isNight, statusText,
    setCell, fgAt, wallAt, lqAt, ltAt, tileKey, dropItem, burst: (x, y, n, col, sp, life, size, grav, glow) => burst(x, y, n, col, sp, life, size, grav, glow), floatText,
    spawnMob, spawnBoss, rgbInt, last: () => { try { return JSON.parse(lsGet(LS_LAST) || 'null'); } catch (e) { return null; } },
    buildAtlas,
  };

  GAME_IMPL.podzem = {
    mount, unmount, api: API,
    _test: {
      state: () => G && { state: G.state, world: G.W && { id: G.W.id, seed: G.W.seed, time: +G.W.time.toFixed(3), maxDepth: G.W.maxDepth, mods: G.W.mods }, pl: G.pl && { x: +G.pl.x.toFixed(2), y: +G.pl.y.toFixed(2), ground: G.pl.ground, hp: G.CH?.hp, dead: G.pl.dead }, chunks: G.chunks.size, pending: G.pending.size, mobs: G.mobs.length, items: G.items.length, boss: G.boss && G.boss.type, worker: G.worker?.kind, fps: G.perf.frames.length ? +(1000 / (G.perf.frames.reduce((a, b) => a + b, 0) / G.perf.frames.length)).toFixed(1) : 0, cpu: G.perf.cpu.length ? +(G.perf.cpu.reduce((a, b) => a + b, 0) / G.perf.cpu.length).toFixed(2) : 0, draws: G.R?.stats.draws, sprites: G.R?.stats.sprites },
      tp(x, y){ if (!G?.pl) return; G.pl.x = x; G.pl.y = y; G.pl.vx = G.pl.vy = 0; G.pl.fallY = y; G.cam.x = x; G.cam.y = y; stream(true); },
      give: (id, n) => give(id, n), time(v){ if (G?.W) G.W.time = v; }, step, render, stream, shapeAt, fgAt, setCell, breakTile, placeTile: (id, x, y) => placeTile(itemDef(id), x, y),
      boss: k => spawnBoss(k), mob: (k, x, y) => spawnMob(k, x, y), save: () => saveAll(), get G(){ return G; }, perf: () => G && { frames: G.perf.frames.slice(), cpu: G.perf.cpu.slice() },
      lootFor: (x, y) => lootFor(x, y), PT, chunk, upload,
    },
  };
})();
