// d37-page.js — the page glue of the D37 web build (no simulation and no rendering here: both are in the wasm).
// It owns the canvas size, the keys, pointer lock, the frame callback and the terrain Workers.
// URL parameters: ?gl=1 forces WebGL2, ?scene=<url> another scene, ?auto=1 walks forward by itself (tests),
// ?workers=0 meshes terrain on the main thread.
// Touch screens: the left half is a move stick (run when pushed to the edge), the right half looks around,
// one jump button. The same action state as the keys.
import init, { D37Web } from './d37_web.js';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const hud = document.getElementById('hud');
const hint = document.getElementById('hint');
const TOUCH = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
const state = { ready: false, loaded: false, error: null, backend: '', firstFrameMs: null, loadedMs: null, frames: 0, fps: 0, stats: null, workers: 0 };
window.__d37 = state;

function fail(e) {
  state.error = String(e && e.message ? e.message : e);
  const box = document.getElementById('error');
  box.textContent = 'D37 не запустился: ' + state.error;
  box.style.display = 'flex';
}

function fitCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, TOUCH ? 1.5 : 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
  return false;
}

async function main() {
  await init({ module_or_path: new URL('./d37_web_bg.wasm', import.meta.url) });
  const sceneUrl = q.get('scene') || new URL('./scenes/meadow.ron', import.meta.url).href;   // next to this file, whatever the page address is
  const res = await fetch(sceneUrl);
  if (!res.ok) throw new Error('сцена ' + sceneUrl + ': HTTP ' + res.status);
  const sceneText = await res.text();
  fitCanvas();
  const app = await D37Web.create(canvas, q.get('gl') === '1');
  state.backend = app.backend();

  // terrain Workers: each has its own copy of the wasm and one mesher
  const pool = [];
  if (q.get('workers') !== '0' && typeof Worker !== 'undefined') {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < n; i++) {
      try {
        const w = new Worker(new URL('./d37-terrain-worker.js', import.meta.url), { type: 'module' });
        const slot = { w, ready: false, busy: false, dead: false };
        w.onmessage = (ev) => {
          const m = ev.data;
          if (m.type === 'ready') { slot.ready = true; return; }
          if (m.type === 'done') {
            slot.busy = false;
            try { app.push_result(m.cx, m.cz, m.lo, m.hi, new Uint8Array(m.bytes), m.ms); } catch (e) { fail(e); }
          }
          if (m.type === 'error') fail(m.error);
        };
        w.onerror = (e) => { slot.dead = true; console.warn('d37 terrain worker failed', e.message); };
        w.postMessage({ type: 'init', scene: sceneText });
        pool.push(slot);
      } catch (e) { console.warn('d37: no terrain worker', e); }
    }
  }
  state.workers = pool.length;
  app.load_scene(sceneText, pool.length > 0);

  // input: the keys held right now -> one action state
  const keys = new Set();
  let fly = false, third = true;
  const stick = { id: -1, x0: 0, y0: 0, sx: 0, sy: 0 }, look = { id: -1, x: 0, y: 0 };
  let touchJump = false;
  const BTN = { run: 1, jump: 2, crouch: 4, fly: 8 };
  function publish() {
    const k = (c) => keys.has(c);
    let forward = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    const strafe = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    if (q.get('auto') === '1') forward = 1;
    let b = 0;
    let sx = strafe, sf = forward;
    if (stick.id !== -1) { sx += stick.sx; sf += stick.sy; if (Math.hypot(stick.sx, stick.sy) > 0.9) b |= BTN.run; }
    sx = Math.max(-1, Math.min(1, sx)); sf = Math.max(-1, Math.min(1, sf));
    if (touchJump) b |= BTN.jump;
    if (k('ShiftLeft') || k('ShiftRight')) b |= BTN.run;
    if (k('Space')) b |= BTN.jump;
    if (k('ControlLeft') || k('ControlRight') || k('KeyC')) b |= BTN.crouch;
    if (fly) b |= BTN.fly;
    app.set_move(sx, sf, b);
  }
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && !e.repeat) { third = !third; app.set_third_person(third); }
    if (e.code === 'KeyF' && !e.repeat) fly = !fly;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    keys.add(e.code); publish();
  });
  addEventListener('keyup', (e) => { keys.delete(e.code); publish(); });
  addEventListener('blur', () => { keys.clear(); publish(); });
  canvas.addEventListener('click', () => { if (!TOUCH && document.pointerLockElement !== canvas && canvas.requestPointerLock) canvas.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => { hint.style.display = document.pointerLockElement === canvas ? 'none' : 'block'; });
  addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) app.add_look(e.movementX, e.movementY); });
  if (TOUCH) {
    const R = 56;   // stick radius in CSS px
    hint.textContent = 'Левая половина экрана — идти (до упора — бег) · правая — смотреть';
    const jump = document.getElementById('jump');
    if (jump) {
      jump.style.display = 'flex';
      const set = (on) => (e) => { e.preventDefault(); touchJump = on; publish(); };
      jump.addEventListener('pointerdown', set(true));
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) jump.addEventListener(ev, set(false));
    }
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault(); hint.style.display = 'none';
      if (e.clientX < innerWidth / 2 && stick.id === -1) { stick.id = e.pointerId; stick.x0 = e.clientX; stick.y0 = e.clientY; stick.sx = 0; stick.sy = 0; }
      else if (look.id === -1) { look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY; }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId === stick.id) {
        stick.sx = Math.max(-1, Math.min(1, (e.clientX - stick.x0) / R));
        stick.sy = Math.max(-1, Math.min(1, (stick.y0 - e.clientY) / R));
        publish();
      } else if (e.pointerId === look.id) {
        app.add_look((e.clientX - look.x) * 2.5, (e.clientY - look.y) * 2.5);
        look.x = e.clientX; look.y = e.clientY;
      }
    });
    const end = (e) => {
      if (e.pointerId === stick.id) { stick.id = -1; stick.sx = 0; stick.sy = 0; publish(); }
      if (e.pointerId === look.id) look.id = -1;
    };
    for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, end);
  }
  publish();

  let last = performance.now(), acc = 0, n = 0, lastHud = 0;
  function frame(now) {
    if (state.error) return;
    if (fitCanvas()) app.resize(canvas.width, canvas.height);
    // hand queued terrain jobs to idle workers
    const idle = pool.filter((s) => s.ready && !s.busy && !s.dead);
    if (idle.length) {
      const jobs = app.take_jobs(idle.length);
      for (let i = 0; i * 4 < jobs.length; i++) {
        idle[i].busy = true;
        idle[i].w.postMessage({ type: 'job', cx: jobs[i * 4], cz: jobs[i * 4 + 1], lo: jobs[i * 4 + 2] >>> 0, hi: jobs[i * 4 + 3] >>> 0 });
      }
    }
    try {
      app.frame(now);
      state.frames++;
      if (state.firstFrameMs === null) { state.firstFrameMs = performance.now(); state.ready = true; }
      if (!state.loaded && app.loaded()) { state.loaded = true; state.loadedMs = performance.now(); }
    } catch (e) {
      // a surface that had to be configured again is not an error; anything else stops the page
      if (!String(e).includes('reconfigured')) { fail(e); return; }
    }
    acc += now - last; last = now; n++;
    if (now - lastHud > 500) {
      state.fps = n * 1000 / Math.max(acc, 1); acc = 0; n = 0; lastHud = now;
      const s = JSON.parse(app.stats());
      state.stats = s;
      hud.textContent = state.backend + '\n' + state.fps.toFixed(0) + ' кадров/с · тик ' + s.tick + ' · пропущено ' + s.dropped_ticks + '\n'
        + 'место ' + s.pos.map((v) => v.toFixed(1)).join(' ') + '\n'
        + 'земля: ' + s.terrain_blocks + ' блоков, очередь ' + s.queue + ' + ' + s.ready + ' · ' + (s.triangles / 1000).toFixed(0) + ' тыс. треугольников\n'
        + 'потоков земли: ' + pool.length;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(fail);
