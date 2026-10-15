// «Подземье» в node — игра целиком (js/games/podzem.js) без браузера: заглушки DOM, WebGL (рисование — пустое), IndexedDB
// (в памяти), свой requestAnimationFrame с любой частотой кадров (60, 144, 240 Гц…), поток мира — «в этом же потоке».
// Для проверок управления, урона и появления мобов: scripts/tiles-test.cjs (раздел game).
//   const sim = await require('./podzem-sim.cjs')(SITE);  →  { A (api игры), T (_test), G (состояние), frames(сек, гц), aimAt(x, y), … }
const fs = require('fs'), path = require('path'), vm = require('vm');

module.exports = async function podzemSim(SITE, opts = {}){
  const g = globalThis, noop = () => {};
  const any = (base = {}) => new Proxy(base, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
  const W = opts.w || 1098, H = opts.h || 600;
  const evt = { addEventListener: noop, removeEventListener: noop };
  function el(tag){
    const q = {};
    const e = any({ tagName: tag, className: '', style: {}, width: 0, height: 0, clientWidth: W, hidden: false, ...evt,
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      getContext: () => any({ measureText: () => ({ width: 10 }) }),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H }),
      appendChild: c => c, querySelector: s => q[s] || null, querySelectorAll: () => [] });
    Object.defineProperty(e, 'innerHTML', { configurable: true, get: () => '', set(v){ if (/pz-wrap/.test(v)) { q['.pz-wrap'] = el('div'); q['.pz-gl'] = el('canvas'); q['.pz-ov'] = el('canvas'); } } });
    return e;
  }
  // IndexedDB в памяти: ровно то, что зовёт DB в podzem.js
  const idb = (() => {
    const dbs = new Map();
    const later = f => setImmediate(f);
    const req = fn => { const r = {}; later(() => { try { r.result = fn(); r.onsuccess?.({ target: r }); } catch (e) { r.error = e; r.onerror?.(e); } }); return r; };
    const inR = (k, r) => !r || (k >= r.lo && k <= r.hi);
    function makeDb(){
      const stores = new Map();
      const keys = (s, r) => [...s.m.keys()].filter(k => inR(k, r)).sort();
      const store = s => ({
        get: k => req(() => s.m.get(k)),
        getAll: r => req(() => keys(s, r).map(k => s.m.get(k))),
        getAllKeys: r => req(() => keys(s, r)),
        put: (v, k) => req(() => { const key = k !== undefined ? k : v[s.kp]; s.m.set(key, structuredClone(v)); return key; }),
        delete: k => req(() => { if (k && typeof k === 'object') { for (const x of keys(s, k)) s.m.delete(x); } else s.m.delete(k); }),
      });
      return {
        objectStoreNames: { contains: n => stores.has(n) },
        createObjectStore(n, o){ stores.set(n, { kp: o && o.keyPath, m: new Map() }); },
        transaction(){ const tx = { objectStore: n => store(stores.get(n)) }; later(() => later(() => tx.oncomplete?.())); return tx; },
      };
    }
    return { open(name){ const r = {}; later(() => { let db = dbs.get(name); const fresh = !db; if (!db) dbs.set(name, db = makeDb()); r.result = db; if (fresh) r.onupgradeneeded?.(); r.onsuccess?.(); }); return r; } };
  })();
  // свой кадр: rAF копит колбэки, frames() вызывает их с нужным шагом времени
  const rafQ = [];
  let tnow = performance.now();
  Object.assign(g, {
    window: g, document: any({ createElement: el, body: el('body'), head: el('head'), hidden: false, ...evt, querySelector: () => null, getElementById: () => null }),
    addEventListener: noop, removeEventListener: noop, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, matchMedia: () => ({ matches: false }),
    requestAnimationFrame: cb => { rafQ.push(cb); return rafQ.length; }, cancelAnimationFrame: noop,
    indexedDB: idb, IDBKeyRange: { bound: (lo, hi) => ({ lo, hi }) },
  });
  const PZ_CORE = require(path.join(SITE, 'js/games/podzem-core.js'));
  g.PZ_CORE = PZ_CORE; g.PZ = PZ_CORE();
  // управление движка: что «зажато» и что «нажали» (на один шаг)
  const C = { held: new Set(), downs: new Set(), move: { x: 0, y: 0 } };
  g.D37E = { controls: () => ({ move: C.move, step: noop, held: k => C.held.has(k), down: k => C.downs.has(k), frameEnd: () => C.downs.clear(), reset_state: noop, dispose: noop }) };
  const touch = { mx: 0, my: 0, jump: false, jumpDown: false, use: false, front: false, build: false };
  const toasts = [];
  g.PZUI = { create: () => new Proxy({ touch, modal: () => false, toast: t => toasts.push(t) }, { get: (t, k) => (k in t ? t[k] : noop) }) };
  const R = any({ w: W, h: H, frame: 0, stats: { draws: 0, sprites: 0 }, post: null, resize(w, h){ R.w = w; R.h = h; } });
  g.PZGL = { renderer: () => R, paint: () => ({ spr: new Proxy({}, { get: () => [[0, 0, 16, 16]] }), item: new Proxy({}, { get: () => 0 }), canvas: el('canvas') }) };
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/games/podzem.js'), 'utf8'), { filename: 'podzem.js' });
  const GI = g.GAME_IMPL.podzem, A = GI.api, T = GI._test;
  GI.mount(el('div'), new Proxy({}, { get: () => noop }));
  const tick = () => new Promise(r => setImmediate(r));
  // sec секунд «настоящего» времени при частоте экрана hz (по умолчанию 60); после каждого кадра — sim.onFrame()
  async function frames(sec, hz = 60){
    const n = Math.round(sec * hz), dt = 1000 / hz;
    for (let i = 0; i < n; i++) {
      tnow += dt;
      const q = rafQ.splice(0); for (const cb of q) cb(tnow);
      if ((i & 15) === 15) await tick();   // ответы потока мира (чанки) — в следующем такте
      sim.onFrame?.();
    }
    await tick();
  }
  async function newWorld(seedText){
    const w = A.newWorldRecord('Проверка', seedText), c = A.newCharRecord('Герой');
    await A.put('worlds', w); await A.put('chars', c);
    await A.play(w.id, c.id);
    for (let i = 0; i < 400 && T.G.state !== 'play'; i++) await frames(.05);
    return T.G.state;
  }
  const G = () => T.G;
  // мышь — в точку мира (как будто курсор там)
  function aimAt(wx, wy){ const s = G(); s.mouse.sx = ((wx - s.cam.x) * s.cam.tile + s.R.w / 2) / s.res; s.mouse.sy = ((wy - s.cam.y) * s.cam.tile + s.R.h / 2) / s.res; s.mouse.in = true; s.aim.src = 'mouse'; }
  function screenOf(wx, wy){ const s = G(); return [((wx - s.cam.x) * s.cam.tile + s.R.w / 2) / s.res, ((wy - s.cam.y) * s.cam.tile + s.R.h / 2) / s.res]; }
  const sim = { A, T, get G(){ return T.G; }, C, touch, toasts, frames, newWorld, aimAt, screenOf, tick, onFrame: null };
  return sim;
};
