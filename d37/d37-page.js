// d37-page.js — the page glue of the D37 web build (no simulation and no rendering here: both are in the wasm).
// It owns the canvas size, the keys, the mouse (pointer lock, or dragging where the browser refuses the lock),
// touch controls, the frame callback and the Workers (terrain columns of flat scenes, chunks of the planet).
// The default scene is the planet. URL parameters (tests and old scenes): ?scene=<url> another scene,
// ?gl=1 forces WebGL2, ?auto=1 walks forward by itself, ?workers=0 builds on the main thread, ?hud=1 shows numbers,
// ?q=max|mid|low the graphics tier (mid by default), ?invert_y=1 moving the pointer up looks down, ?holes=1 the hole
// probe of the tests (a small second frame without the sky, read back: below-horizon pixels nothing was drawn on).
// Ground materials are made by code in the Workers at load.
// Touch screens: the left half is a move stick (run when pushed to the edge), the right half looks around,
// buttons: jump, «орбита ↔ земля», full screen, ⚙ the admin menu. The same action state as the keys.
// The character (the wasm draws it): G girl → boy → mannequin, P / 1-8 colour presets, M (held) opens the mouth —
// the test input of the mouth channel, N the slow test sine on / off; «🎤» in the admin menu feeds a microphone
// level instead (WebAudio, asked only on that click). Views: F6 / F7 / F8 or X — 3D, from the side, from above (2D views of the same world).
// The admin / test menu: ` or F10 (or ⚙), ?admin=1 shows it at load; its buttons run `app.admin(<command>)`.
// The wardrobe menu: B (or «Гардероб» in the admin menu) — body, colours per slot, the microphone; kept in this browser.
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
  state.app = app;   // tests read the character's state through stats() and drive admin()
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
  state.press = (code, ms) => { keys.add(code); publish(); onKey(code); setTimeout(() => { keys.delete(code); publish(); if (code === 'KeyM') app.set_mouth_test(0); }, ms || 120); };   // tests
  // the character, the views and the admin menu (one command language with the native client: app.admin)
  let body = 'girl', palette = 0, view = 0, sine = false;
  const NEXT_BODY = { girl: 'boy', boy: 'mannequin', mannequin: 'girl' };
  const VIEWS = ['persp', 'side', 'top'];
  // every accepted body choice (G and the menu's buttons alike) is where the next G starts from: a menu pick that was
  // not kept sent G on from a stale body (13.11 owner: «нельзя обратно переключиться на другого перса»)
  const run = (cmd) => { try { const r = app.admin(cmd); state.lastAdmin = r; for (const m of cmd.matchAll(/(?:^|;)\s*character\s+(\w+)/g)) if (NEXT_BODY[m[1]]) body = m[1]; state.body = body; if (r.startsWith('shot:')) state.shotNext = r.slice(5); return r; } catch (e) { state.lastAdmin = 'отказ: ' + e; return state.lastAdmin; } };
  function onKey(code) {
    if (code === 'KeyG') { body = NEXT_BODY[body] || 'girl'; run('character ' + body); }
    if (code === 'KeyN') { sine = !sine; run(sine ? 'mouth sine' : 'mouth 0'); }
    if (code === 'KeyP') { palette = (palette + 1) % 8; run('palette ' + palette); }
    if (/^Digit[1-8]$/.test(code)) { palette = Number(code.slice(5)) - 1; run('palette ' + palette); }
    if (code === 'KeyM') app.set_mouth_test(1);
    if (code === 'F6' || code === 'F7' || code === 'F8') { view = { F6: 0, F7: 1, F8: 2 }[code]; run('view ' + VIEWS[view]); }
    if (code === 'KeyX') { view = (view + 1) % 3; run('view ' + VIEWS[view]); }
    if (code === 'Backquote' || code === 'F10') toggleAdmin();
    if (code === 'KeyB') { run('wardrobe toggle'); syncWardrobe(); }
  }
  // the wardrobe menu (B, or «Гардероб» in the admin menu): the panel is drawn from app.wardrobe_json(); every
  // choice is an admin command (`character`, `tint`) — the same language as the native client's menu. The body is
  // ONE «set body» command (any of the three from any state). The colours and the body are kept in this browser.
  // A garment is cut for one body: this version recolours, it does not move clothes between the girl and the boy.
  const wardrobe = $('wardrobe');
  let wSlot = null, wHue = 330, wSat = 0.3, wVal = 1;
  const hex2 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  const hsv = (h, sat, v) => { const c = v * sat, hp = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1)); const m = v - c; const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]; return hex2(r + m) + hex2(g + m) + hex2(b + m); };
  function keepWardrobe() { try { localStorage.setItem('d37.look', app.wardrobe_look()); localStorage.setItem('d37.character', body); } catch (e) { /* storage blocked */ } }
  function wrun(cmd) {
    const r = run(cmd);
    const m = /^character (\w+)$/.exec(cmd);
    if (m && !r.startsWith('отказ')) body = m[1];
    keepWardrobe();
    // the body changes on the next tick: draw the panel again after it
    setTimeout(buildWardrobe, m ? 120 : 0);
    return r;
  }
  function btn(text, on, click) { const b = document.createElement('button'); b.textContent = text; if (on) b.className = 'on'; b.addEventListener('click', (e) => { e.stopPropagation(); click(); }); return b; }
  function buildWardrobe() {
    if (wardrobe.style.display !== 'block') return;
    const w = JSON.parse(app.wardrobe_json());
    wardrobe.textContent = '';
    const title = document.createElement('div'); title.className = 'atitle'; title.textContent = 'Гардероб (B — закрыть)'; wardrobe.appendChild(title);
    const row = (label) => { const h = document.createElement('div'); h.className = 'agroup'; h.textContent = label; wardrobe.appendChild(h); const r = document.createElement('div'); r.className = 'arow'; wardrobe.appendChild(r); return r; };
    const rb = row('Тело');
    for (const b of w.bodies) rb.appendChild(btn(b.label, b.name === w.body, () => wrun('character ' + b.name)));
    if (!w.slots.length) { const n = document.createElement('div'); n.className = 'astatus'; n.textContent = 'У манекена нет одежды и цветов'; wardrobe.appendChild(n); }
    if (!w.slots.find((x) => x.slot === wSlot)) wSlot = w.slots.length ? w.slots[0].slot : null;
    for (const sl of w.slots) {
      const r = row(sl.label + (sl.slot === wSlot ? ' ◂' : ''));
      r.appendChild(btn('свой', sl.color === null, () => { wSlot = sl.slot; wrun('tint ' + w.body + ' ' + sl.slot + ' own'); }));
      for (const c of sl.swatches) {
        const b = btn('', sl.color === c, () => { wSlot = sl.slot; wrun('tint ' + w.body + ' ' + sl.slot + ' ' + c); });
        b.className += ' sw'; b.style.background = '#' + c; b.title = '#' + c; r.appendChild(b);
      }
    }
    if (wSlot) {
      const range = (label, min, max, step, val, set) => { const r = row(label); const i = document.createElement('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = val; i.addEventListener('input', () => { set(Number(i.value)); wrun('tint ' + w.body + ' ' + wSlot + ' ' + hsv(wHue, Math.max(wSat, 0.3), wVal)); }); r.appendChild(i); };
      range('Оттенок', 0, 359, 1, wHue, (v) => { wHue = v; });
      range('Яркость', 0.25, 1, 0.01, wVal, (v) => { wVal = v; });
    }
    const rm = row('Микрофон');
    rm.appendChild(btn(micStarted ? '🎤 вкл (нажми — выкл)' : '🎤 выкл (нажми — вкл)', micStarted, () => { startMic().then(() => buildWardrobe()); }));
    const re = row('');
    if (w.slots.length) re.appendChild(btn('Свои цвета (сброс)', false, () => wrun('tint ' + w.body + ' reset')));
    re.appendChild(btn('Готово', false, () => { run('wardrobe off'); syncWardrobe(); }));
  }
  function syncWardrobe() {
    const show = app.wardrobe_shown();
    wardrobe.style.display = show ? 'block' : 'none';
    state.wardrobeShown = show;
    if (show) { if (document.pointerLockElement) document.exitPointerLock(); buildWardrobe(); }
  }
  state.syncWardrobe = syncWardrobe;
  // the choice of an earlier visit
  try {
    const look = localStorage.getItem('d37.look'); if (look) run('look ' + look);
    const ch = localStorage.getItem('d37.character'); if (ch && NEXT_BODY[ch]) { body = ch; run('character ' + ch); }
  } catch (e) { /* storage blocked */ }
  // the admin menu: buttons from app.admin_items(), grouped; touch and mouse alike
  const admin = $('admin');
  let micStarted = false;
  function buildAdmin() {
    admin.textContent = '';
    const title = document.createElement('div'); title.className = 'atitle'; title.textContent = 'Меню админа (` или F10 — скрыть)'; admin.appendChild(title);
    let group = '', box = null;
    for (const it of JSON.parse(app.admin_items())) {
      if (it.group !== group) {
        group = it.group;
        const h = document.createElement('div'); h.className = 'agroup'; h.textContent = group; admin.appendChild(h);
        box = document.createElement('div'); box.className = 'arow'; admin.appendChild(box);
      }
      const b = document.createElement('button'); b.textContent = it.label; b.dataset.cmd = it.cmd;
      b.addEventListener('click', (e) => { e.stopPropagation(); status.textContent = run(it.cmd); syncWardrobe(); });
      box.appendChild(b);
    }
    // the page's own: the mouth by the microphone (the voice server feeds the same input later)
    const mic = document.createElement('button'); mic.textContent = '🎤 Рот по голосу'; mic.id = 'amic';
    mic.addEventListener('click', (e) => { e.stopPropagation(); startMic().then((m) => { status.textContent = m; }); });
    box.appendChild(mic);
    const status = document.createElement('div'); status.className = 'astatus'; admin.appendChild(status);
  }
  function toggleAdmin(on) {
    const show = on === undefined ? admin.style.display !== 'block' : on;
    if (show && !admin.childElementCount) buildAdmin();
    admin.style.display = show ? 'block' : 'none';
    state.adminShown = show;
    if (show && document.pointerLockElement) document.exitPointerLock();
  }
  state.toggleAdmin = toggleAdmin;
  // the microphone is a toggle: the second click stops the tracks, closes the audio context and the level timer
  let micSrc = null;
  async function startMic() {
    if (micSrc) {
      clearInterval(micSrc.timer); micSrc.stream.getTracks().forEach((t) => t.stop());
      try { await micSrc.ctx.close(); } catch (e) { /* already closed */ }
      micSrc = null; micStarted = false; state.micLevel = 0; app.set_mouth_level(0);
      return 'микрофон выключен';
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'микрофон недоступен в этом браузере';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      // the context was made after an awaited permission prompt: stricter browsers start it suspended
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { /* the level stays 0 */ } }
      const an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      micStarted = true;
      state.micLevel = 0;
      // the level (RMS, scaled) a few dozen times a second; the engine smooths it into the mouth channel
      const timer = setInterval(() => { an.getFloatTimeDomainData(buf); let e = 0; for (const v of buf) e += v * v; const l = Math.min(1, Math.sqrt(e / buf.length) * 6); state.micLevel = l; app.set_mouth_level(l); }, 33);
      micSrc = { stream, ctx, timer };
      return 'микрофон слушается: рот открывается по голосу (ещё раз — выключить)';
    } catch (err) { return 'микрофон не дали: ' + err; }
  }
  state.setFly = (on) => { fly = !!on; publish(); };   // tests: free flight held on (as after F)
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && !e.repeat) { third = !third; app.set_third_person(third); }
    if (e.code === 'KeyF' && !e.repeat) fly = !fly;
    if (['F6', 'F7', 'F8', 'F10', 'Backquote'].includes(e.code)) e.preventDefault();
    if (!e.repeat) onKey(e.code);
    if (e.code === 'F3' && !e.repeat) { e.preventDefault(); hud.style.display = hud.style.display === 'block' ? 'none' : 'block'; }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    keys.add(e.code); publish();
  });
  addEventListener('keyup', (e) => { keys.delete(e.code); publish(); if (e.code === 'KeyM') app.set_mouth_test(0); });
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
  $('gear').addEventListener('click', (e) => { e.stopPropagation(); toggleAdmin(); });
  if (q.get('admin') === '1') toggleAdmin(true);
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
      // a screenshot asked by the admin menu: read the canvas in the same task as the frame (WebGPU clears it after)
      if (state.shotNext) {
        const name = state.shotNext; state.shotNext = null;
        const receipt = JSON.stringify({ kind: 'd37-web-shot', name, made: new Date().toISOString(), backend: state.backend, stats: JSON.parse(app.stats()), planet: planet ? JSON.parse(app.planet_stats()) : null, fps: state.fps }, null, 1);
        const save = (blob, file) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
        canvas.toBlob((b) => { if (b) save(b, 'd37_' + name + '.png'); save(new Blob([receipt], { type: 'application/json' }), 'd37_' + name + '.json'); });
      }
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
      // the menu's «бюджеты» switch shows the HUD with the budget line
      if (state.lastAdmin && /budgets on/.test(state.lastAdmin)) { state.budgets = true; hud.style.display = 'block'; }
      if (state.lastAdmin && /budgets off/.test(state.lastAdmin)) { state.budgets = false; }
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
      text += '\nперсонаж: ' + s.body + ' (' + s.body_triangles + ' треуг.) · цвета ' + s.palette + ' · вид ' + s.view + ' · рот ' + s.mouth.toFixed(2);
      if (state.budgets) {
        const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' МБ JS' : 'память: нет данных';
        text += '\nбюджеты: ' + state.fps.toFixed(0) + ' кадров/с (' + (1000 / Math.max(state.fps, 1)).toFixed(1) + ' мс; 16.7) · треуг. ' + (s.triangles / 1000).toFixed(0) + ' тыс. · draws ' + s.draws + ' · ' + mem;
      }
      hud.textContent = text + '\nпотоков: ' + pool.length;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(fail);
