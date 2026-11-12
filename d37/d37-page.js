// d37-page.js — the page glue of the D37 web build (no simulation and no rendering here: both are in the wasm).
// It owns the canvas size, the keys, the mouse (pointer lock, or dragging where the browser refuses the lock),
// touch controls, the frame callback and the Workers (terrain columns of flat scenes, chunks of the planet).
// The default scene is the planet. URL parameters (tests and old scenes): ?scene=<url> another scene,
// ?gl=1 forces WebGL2, ?auto=1 walks forward by itself, ?workers=0 builds on the main thread, ?hud=1 shows numbers,
// ?q=max|mid|low the graphics tier (mid by default), ?invert_y=1 moving the pointer up looks down, ?holes=1 the hole
// probe of the tests (a small second frame without the sky, read back: below-horizon pixels nothing was drawn on).
// Ground materials are made by code in the Workers at load.
// Touch screens: the left half is a move stick (run when pushed to the edge), the right half looks around,
// buttons: jump, «орбита ↔ земля», full screen. The same action state as the keys.
import init, { D37Web, ground_layer } from './d37_web.js';

const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const canvas = $('view'), hud = $('hud'), hint = $('hint');
const TOUCH = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
const state = { ready: false, loaded: false, error: null, backend: '', firstFrameMs: null, loadedMs: null, frames: 0, fps: 0, stats: null, planet: null, workers: 0, isPlanet: false, quality: '', groundMs: 0, groundLayerMs: [], rejections: 0 };
// promise rejections nobody handled (tests count them: the page must not leave any)
addEventListener('unhandledrejection', (e) => { state.rejections++; console.warn('d37: unhandled rejection', e.reason); e.preventDefault(); });
window.__d37 = state;

function fail(e) {
  state.error = String(e && e.message ? e.message : e);
  const box = $('error');
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
  const sceneUrl = q.get('scene') || new URL('./scenes/planet.ron', import.meta.url).href;   // next to this file, whatever the page address is
  const res = await fetch(sceneUrl);
  if (!res.ok) throw new Error('сцена ' + sceneUrl + ': HTTP ' + res.status);
  const sceneText = await res.text();
  fitCanvas();
  const app = await D37Web.create(canvas, q.get('gl') === '1');
  state.backend = app.backend();
  if (q.get('q')) { try { app.set_quality(q.get('q')); } catch (e) { fail(e); return; } }
  state.quality = app.quality();
  // the player's setting: moving the mouse / finger up looks down (off by default): ?invert_y=1 (or 0), remembered
  // in this browser
  let invY = q.get('invert_y');
  try { if (invY === null) invY = localStorage.getItem('d37.invert_y'); else localStorage.setItem('d37.invert_y', invY); } catch (e) { /* storage blocked */ }
  app.set_invert_y(invY === '1');
  // tests: look() -> [yaw, pitch] in degrees; look(dx, dy) turns as a mouse move would, then returns the angles
  state.look = (dx, dy) => { if (dx !== undefined) app.add_look(dx, dy || 0); return Array.from(app.look_deg()); };

  // Workers: each has its own copy of the wasm and one builder (terrain columns, or planet chunks)
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
          if (m.type === 'chunk') {
            slot.busy = false;
            try { app.push_chunk(new Uint8Array(m.bytes), m.ms); } catch (e) { fail(e); }
          }
          if (m.type === 'ground') {
            slot.busy = false; slot.ground = false;
            state.groundLayerMs.push(m.ms);
            try { app.push_ground(new Uint8Array(m.bytes)); state.groundMs = app.ground_ms(); } catch (e) { fail(e); }
          }
          if (m.type === 'error') fail(m.error);
        };
        w.onerror = (e) => { slot.dead = true; console.warn('d37 worker failed', e.message); };
        pool.push(slot);
      } catch (e) { console.warn('d37: no worker', e); }
    }
  }
  state.workers = pool.length;
  app.load_scene(sceneText, pool.length > 0);
  const planet = app.is_planet();
  state.isPlanet = planet;
  for (const s of pool) s.w.postMessage({ type: 'init', scene: sceneText, planet });

  // input: the keys held right now -> one action state
  const keys = new Set();
  let fly = false, third = true;
  const stick = { id: -1, x0: 0, y0: 0, sx: 0, sy: 0 }, look = { id: -1, x: 0, y: 0 };
  let touchJump = false, orbitHeld = false;
  const BTN = { run: 1, jump: 2, crouch: 4, fly: 8, orbit: 16 };
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
    if (planet && (orbitHeld || k('KeyO'))) b |= BTN.orbit;
    app.set_move(sx, sf, b);
  }
  state.press = (code, ms) => { keys.add(code); publish(); setTimeout(() => { keys.delete(code); publish(); }, ms || 120); };   // tests
  state.setFly = (on) => { fly = !!on; publish(); };   // tests: free flight held on (as after F)
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && !e.repeat) { third = !third; app.set_third_person(third); }
    if (e.code === 'KeyF' && !e.repeat) fly = !fly;
    if (e.code === 'F3' && !e.repeat) { e.preventDefault(); hud.style.display = hud.style.display === 'block' ? 'none' : 'block'; }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    keys.add(e.code); publish();
  });
  addEventListener('keyup', (e) => { keys.delete(e.code); publish(); });
  addEventListener('blur', () => { keys.clear(); publish(); });
  // the mouse: pointer lock where the browser gives it; embedded browsers refuse it — then holding the button and
  // dragging looks around (both paths call the same add_look)
  let drag = false;
  canvas.addEventListener('click', () => { if (!TOUCH && document.pointerLockElement !== canvas && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* dragging still works */ } } });
  canvas.addEventListener('mousedown', () => { if (!TOUCH) drag = true; });
  addEventListener('mouseup', () => { drag = false; });
  addEventListener('blur', () => { drag = false; });
  addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas || drag) app.add_look(e.movementX, e.movementY); });

  // buttons (mouse and touch alike): «орбита ↔ земля» is held while pressed (the engine takes the press), full screen
  const hold = (el, set) => {
    const on = (v) => (e) => { e.preventDefault(); set(v); publish(); };
    el.addEventListener('pointerdown', on(true));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, on(false));
  };
  if (planet) { $('orbit').style.display = 'flex'; hold($('orbit'), (v) => { orbitHeld = v; }); }
  $('full').addEventListener('click', () => {
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  });
  hint.textContent = TOUCH
    ? (planet ? 'Слева — лететь / идти · справа — смотреть · 🌍 — орбита ↔ земля' : 'Слева — идти (до упора — бег) · справа — смотреть')
    : 'Осмотреться: нажми на картинку или зажми кнопку мыши и веди · W A S D — ' + (planet ? 'лететь / идти · O — орбита ↔ земля · Shift — быстро' : 'ходить · Shift — бег · Пробел — прыжок · F — полёт');
  if (TOUCH) {
    const R = 56;   // stick radius in CSS px
    const jump = $('jump');
    jump.style.display = 'flex';
    hold(jump, (v) => { touchJump = v; });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
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
  if (q.get('hud') === '1') hud.style.display = 'block';
  if (q.get('holes') === '1') { const pw = 480; app.enable_hole_probe(pw, Math.max(16, Math.round(pw * canvas.height / Math.max(1, canvas.width)))); }
  publish();

  let last = performance.now(), acc = 0, n = 0, lastHud = 0;
  function frame(now) {
    if (state.error) return;
    if (fitCanvas()) app.resize(canvas.width, canvas.height);
    // hand queued jobs to idle workers
    let idle = pool.filter((s) => s.ready && !s.busy && !s.dead);
    if (planet) {
      // ground material layers first (they make the near ground); with no Workers: one layer per frame here
      // after the first view has settled (the orbit needs no near-ground textures), one Worker at a time, so the
      // chunk builds never wait for them (the landing must not find holes)
      const busyGround = pool.some((s) => s.busy && s.ground);
      const g = state.loaded && !busyGround && (idle.length > 0 || !pool.length) ? app.ground_jobs(1) : [];
      if (g.length > 1) {
        for (let i = 1; i < g.length; i++) {
          if (pool.length) { idle[i - 1].busy = true; idle[i - 1].ground = true; idle[i - 1].w.postMessage({ type: 'ground', index: g[i], size: g[0] }); }
          else { const t0 = performance.now(); app.push_ground(ground_layer(g[i], g[0])); state.groundLayerMs.push(performance.now() - t0); state.groundMs = app.ground_ms(); }
        }
        idle = idle.slice(g.length - 1);
      }
    }
    if (idle.length && planet) {
      const jobs = app.take_chunk_jobs(idle.length);
      for (let i = 0; i * 2 < jobs.length; i++) { idle[i].busy = true; idle[i].w.postMessage({ type: 'chunk', lo: jobs[i * 2], hi: jobs[i * 2 + 1] }); }
    } else if (idle.length) {
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
      let text = state.backend + '\n' + state.fps.toFixed(0) + ' кадров/с · тик ' + s.tick + ' · пропущено ' + s.dropped_ticks + '\n';
      if (planet) {
        const p = JSON.parse(app.planet_stats());
        state.planet = p;
        if (q.get('holes') === '1') state.holes = JSON.parse(app.hole_stats());
        text += 'высота ' + (p.alt > 1000 ? (p.alt / 1000).toFixed(1) + ' км' : p.alt.toFixed(1) + ' м') + ' · кусков ' + p.shown + ' (в памяти ' + p.cached + ', очередь ' + p.queued + ')\n'
          + (s.triangles / 1000).toFixed(0) + ' тыс. треугольников · сборка куска ' + p.build_ms_mean.toFixed(1) + ' мс';
      } else {
        text += 'место ' + s.pos.map((v) => v.toFixed(1)).join(' ') + '\n'
          + 'земля: ' + s.terrain_blocks + ' блоков, очередь ' + s.queue + ' + ' + s.ready + ' · ' + (s.triangles / 1000).toFixed(0) + ' тыс. треугольников';
      }
      hud.textContent = text + '\nпотоков: ' + pool.length;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(fail);
