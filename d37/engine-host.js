// engine-host.js — the engine-owned glue that puts D37 inside a hosting page (the site's hub, /hub/play): the loader
// with real progress (the wasm's bytes, then the graphics device, then the world around the player), the canvas, keys /
// mouse / touch, the build Workers (they get the compiled module: one download, one compile), the wardrobe panel, and
// the transport of bridge v1 (crates/d37-web/src/bridge.rs):
//   page -> engine: send({t:'session', uid, nick, realm, band, staff}) · send({t:'look', body, text}) · send({t:'wardrobe', on})
//   engine -> page: onMessage({t:'ready'|'loaded'|'look_changed'|'wardrobe'|'save_ready'|'event'|'error'|'progress', ...})
//   bytes: save() -> Uint8Array (bridge::SaveV1); the page's earlier save goes in as o.save before the world loads.
// It ships with the wasm (same folder, same version). No simulation and no rendering here, no site globals: the page
// (site-owned js/features/hub.js) talks only to the handle start() returns. Text from the engine is codes and the look
// text; this file puts strings into the DOM with textContent only.
import init, { D37Web, ground_layer, bridge_version, last_panic } from './d37_web.js';

export const BRIDGE = 1;
const HERE = (f) => new URL('./' + f, import.meta.url).href;
const TOUCH = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
const HEX = /^[0-9a-f]{6}$/i;

// the buttons and the wardrobe panel over the canvas (one <style>, whatever page hosts the engine)
const CSS = `.d37h-btn{position:absolute;z-index:3;width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;
background:rgba(10,14,22,.42);border:1px solid rgba(255,255,255,.32);color:#fff;font-size:24px;line-height:1;cursor:pointer;touch-action:none;
user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;padding:0}
.d37h-btn:active,.d37h-btn.on{background:rgba(255,160,60,.55)}
.d37h-jump{right:16px;bottom:calc(24px + env(safe-area-inset-bottom))}.d37h-orbit{right:16px;bottom:calc(92px + env(safe-area-inset-bottom))}
.d37h-ward{right:16px;bottom:calc(160px + env(safe-area-inset-bottom))}
@media (pointer:fine){.d37h-orbit{bottom:24px}.d37h-ward{bottom:92px}}
.d37h-game.d37h-jump{bottom:calc(76px + env(safe-area-inset-bottom))}.d37h-game.d37h-ward{bottom:calc(144px + env(safe-area-inset-bottom))}
.d37h-hint{position:absolute;z-index:2;left:50%;bottom:calc(10px + env(safe-area-inset-bottom));transform:translateX(-50%);max-width:min(92%,640px);
padding:6px 12px;border-radius:10px;background:rgba(0,0,0,.5);color:#fff;font:13px/1.35 system-ui,sans-serif;text-align:center;pointer-events:none;transition:opacity .8s}
.d37h-wardrobe{position:absolute;z-index:4;right:84px;top:64px;width:min(360px,calc(100% - 100px));max-height:calc(100% - 80px);overflow-y:auto;
padding:10px 12px;border-radius:14px;background:rgba(10,13,20,.86);border:1px solid rgba(255,255,255,.16);color:#eef2f8;font:14px/1.35 system-ui,sans-serif}
.d37h-wardrobe .d37h-wt{font-weight:700;font-size:16px;color:#ffd36b;margin-bottom:4px}
.d37h-wardrobe .d37h-wg{margin:8px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;opacity:.75}
.d37h-wardrobe .d37h-wr{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.d37h-wardrobe button{font:inherit;font-size:13px;padding:8px 11px;border-radius:9px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.1);color:inherit;cursor:pointer}
.d37h-wardrobe button.on{background:rgba(255,160,60,.6)}
.d37h-wardrobe button.sw{width:32px;height:32px;padding:0}.d37h-wardrobe button.sw.on{outline:2px solid #fff;outline-offset:1px}
.d37h-wardrobe input[type=range]{width:100%}.d37h-wardrobe .d37h-ws{font-size:12px;color:#9f9;margin-top:6px}
@media (max-width:700px){.d37h-wardrobe{top:auto;right:8px;left:8px;bottom:calc(8px + env(safe-area-inset-bottom));width:auto;max-height:44%}}`;
function style() {
  if (document.getElementById('d37h-style')) return;
  const s = document.createElement('style');
  s.id = 'd37h-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// the wasm with a byte counter: streaming compile stays on (the Response carries the wasm type), the bar moves
async function compileWasm(url, rawSize, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('wasm: HTTP ' + res.status);
  const enc = (res.headers.get('content-encoding') || '').toLowerCase();
  const len = +res.headers.get('content-length') || 0;
  // Content-Length is the compressed size when the server compresses: the raw size comes from build.json then
  const total = rawSize > 0 ? rawSize : (!enc || enc === 'identity' ? len : 0);
  if (!res.body || typeof ReadableStream === 'undefined') {
    const buf = await res.arrayBuffer();
    onBytes(buf.byteLength, total || buf.byteLength);
    return WebAssembly.compile(buf);
  }
  const rd = res.body.getReader();
  let got = 0;
  const stream = new ReadableStream({
    async pull(c) {
      const { done, value } = await rd.read();
      if (done) { onBytes(got, total || got); c.close(); return; }
      got += value.byteLength;
      onBytes(got, total);
      c.enqueue(value);
    },
    cancel(r) { try { rd.cancel(r); } catch (e) { /* gone */ } },
  });
  const counted = new Response(stream, { headers: { 'content-type': 'application/wasm' } });
  if (typeof WebAssembly.compileStreaming === 'function') return WebAssembly.compileStreaming(counted);
  return WebAssembly.compile(await counted.arrayBuffer());
}

// Start the engine inside o.root (an element the page sized; it gets position:relative children).
// o: { root, scene: 'planet' | 'planet_ground' | 'valley' (EP7: the game) | 'creative' (T-163: the free-flight world) | 'wardrobe'
//      (T-163: the character alone on a pedestal — the light wardrobe), rawSize, gl, quality, session, look: {body, text}, save: Uint8Array,
//      wardrobe: bool, workers: number, onMessage(msg), onProgress({phase, done, total}),
//      W8 hub: newWorld: bool (`game progress new`: a cell at the tide pool), skipTribe: bool (`game progress skip tribe`),
//      spawn: 'last' | 'home' | 'orbit' (where a saved world starts: as saved / `game place goto home_valley` / `travel orbit`) }
// The 'wardrobe' scene is a studio: the panel is open from the start, no walking (the keys and the left half of a phone
// turn the camera round the character instead), no jump / orbit / 👕 buttons; «Готово» is sent to the page as
// {t:'wardrobe', on:false} as always (the site goes back where it came from).
const SCENES = ['planet', 'planet_ground', 'valley', 'creative', 'wardrobe'];
export async function start(o) {
  const root = o.root;
  style();
  const emit = (m) => { try { o.onMessage && o.onMessage(m); } catch (e) { console.warn('d37 host: onMessage', e); } };
  const progress = (phase, done, total) => { try { o.onProgress && o.onProgress({ phase, done, total }); } catch (e) { /* page */ } };
  const touch = TOUCH();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const made = [];
  const add = (e) => { root.appendChild(e); made.push(e); return e; };
  const canvas = add(el('canvas', 'd37h-canvas'));
  canvas.setAttribute('tabindex', '0');
  canvas.setAttribute('aria-label', 'Игра D37');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none';
  const st = { app: null, pool: [], raf: 0, paused: false, dead: false, loaded: false, error: null, frames: 0, fps: 0, backend: '', listeners: [], keys: new Set(), inputOn: true };
  const on = (t, ev, f, opt) => { t.addEventListener(ev, f, opt); st.listeners.push([t, ev, f, opt]); };

  // 1. the wasm (bytes), 2. the device, 3. the world
  progress('wasm', 0, o.rawSize || 0);
  const module = await compileWasm(HERE('d37_web_bg.wasm'), o.rawSize || 0, (d, t) => progress('wasm', d, t));
  await init({ module_or_path: module });
  if (bridge_version() !== BRIDGE) throw new Error('bridge version ' + bridge_version() + ', the page speaks ' + BRIDGE);
  const sceneName = SCENES.includes(o.scene) ? o.scene : 'planet';
  const studio = sceneName === 'wardrobe';
  // a portrait phone: the wardrobe panel takes the lower 44 % — the studio draws the character in the free part above it
  const place = () => { canvas.style.height = studio && typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches ? '56%' : '100%'; };
  place();
  const res = await fetch(HERE('scenes/' + sceneName + '.ron'));
  if (!res.ok) throw new Error('scene: HTTP ' + res.status);
  const sceneText = await res.text();
  progress('gpu', 0, 1);
  const fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
    return false;
  };
  fit();
  const app = await D37Web.create(canvas, !!o.gl);
  st.app = app;
  st.backend = app.backend();
  if (o.quality) { try { app.set_quality(o.quality); } catch (e) { /* keeps mid */ } }
  progress('gpu', 1, 1);

  // Workers: each builds planet chunks / ground layers from the module compiled above
  const nW = Math.max(0, Math.min(o.workers == null ? 4 : o.workers, touch ? 2 : 4, (navigator.hardwareConcurrency || 2) - 1));
  for (let i = 0; i < nW && typeof Worker !== 'undefined'; i++) {
    try {
      const w = new Worker(HERE('d37-terrain-worker.js'), { type: 'module' });
      const slot = { w, ready: false, busy: false, dead: false, ground: false };
      w.onmessage = (ev) => {
        const m = ev.data;
        if (!st.app) return;
        try {
          if (m.type === 'ready') slot.ready = true;
          else if (m.type === 'done') { slot.busy = false; st.app.push_result(m.cx, m.cz, m.lo, m.hi, new Uint8Array(m.bytes), m.ms); }
          else if (m.type === 'chunk') { slot.busy = false; st.app.push_chunk(new Uint8Array(m.bytes), m.ms); }
          else if (m.type === 'ground') { slot.busy = false; slot.ground = false; st.app.push_ground(new Uint8Array(m.bytes)); }
          else if (m.type === 'error') { slot.dead = true; emit({ t: 'error', code: 'worker', msg: String(m.error).slice(0, 200) }); }
        } catch (e) { fail('worker-result', e); }
      };
      w.onerror = () => { slot.dead = true; };
      st.pool.push(slot);
    } catch (e) { /* no Worker: built on this thread */ }
  }
  // a save made earlier: the world starts where it was made (refused saves are reported, the world starts fresh)
  if (o.save && o.save.length) {
    try { emit({ t: 'resumed', summary: JSON.parse(app.load_save(o.save)) }); } catch (e) { emit({ t: 'error', code: 'save', msg: String(e).slice(0, 200) }); }
  }
  app.load_scene(sceneText, st.pool.length > 0);
  const planet = app.is_planet();
  // EP7 the game layer (a scene with a `game` block): the HUD is drawn and hit tested by the engine; this glue only
  // forwards keys / pointers (the same rules as the engine's page d37-page.js). Its save rides in save() (GAME section).
  const game = app.game_on();
  st.game = game;
  if (game) app.game_set_touch(touch);
  const mouse = { act: false, use: false };
  const toCanvas = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / Math.max(1, r.width), (e.clientY - r.top) * canvas.height / Math.max(1, r.height)]; };
  const menuOpen = () => { try { return game && st.app.game_menu_open(); } catch (e) { return false; } };
  for (const s of st.pool) s.w.postMessage({ type: 'init', scene: sceneText, planet, module });
  const send = (m) => {
    if (!st.app) return false;
    try { st.app.host_in(JSON.stringify(Object.assign({ v: BRIDGE }, m))); return true; } catch (e) { emit({ t: 'error', code: 'host_in', msg: String(e).slice(0, 200) }); return false; }
  };
  if (o.session) send(Object.assign({ t: 'session' }, o.session));
  if (o.look && (o.look.text || o.look.body)) send({ t: 'look', body: o.look.body || '', text: o.look.text || '' });
  if (o.wardrobe || studio) send({ t: 'wardrobe', on: true });

  // ── input: the held keys -> one action state (the same as the engine's test page d37-page.js) ──
  const BTN = { run: 1, jump: 2, crouch: 4, fly: 8, orbit: 16, act: 32, use: 64 };
  let fly = false, third = true, body = (o.look && o.look.body) || 'girl', touchJump = false, orbitHeld = false;
  const stick = { id: -1, x0: 0, y0: 0, sx: 0, sy: 0 }, look = { id: -1, x: 0, y: 0 };
  const NEXT_BODY = { girl: 'boy', boy: 'mannequin', mannequin: 'girl' };
  const keys = st.keys;
  function publish() {
    if (!st.app) return;
    if (!st.inputOn || studio) { st.app.set_move(0, 0, 0); return; }
    const k = (c) => keys.has(c);
    let fw = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    let sx = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    let b = 0;
    if (stick.id !== -1) { sx += stick.sx; fw += stick.sy; if (Math.hypot(stick.sx, stick.sy) > 0.9) b |= BTN.run; }
    sx = Math.max(-1, Math.min(1, sx)); fw = Math.max(-1, Math.min(1, fw));
    if (touchJump || k('Space')) b |= BTN.jump;
    if (k('ShiftLeft') || k('ShiftRight')) b |= BTN.run;
    if (k('ControlLeft') || k('ControlRight') || k('KeyC')) b |= BTN.crouch;
    if (fly) b |= BTN.fly;
    if (planet && !game && (orbitHeld || k('KeyO'))) b |= BTN.orbit;
    if (game && (mouse.act || k('KeyE'))) b |= BTN.act;
    if (game && mouse.use) b |= BTN.use;
    st.app.set_move(sx, fw, b);
  }
  const run = (cmd) => { try { const r = st.app.admin(cmd); const m = /^character (\w+)$/.exec(cmd); if (m) body = m[1]; return r; } catch (e) { return 'отказ: ' + e; } };
  // typing in the page (chat, search) is never game input
  const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); };
  const live = () => !st.paused && !st.dead && st.inputOn && !typing();
  // look-fix: a turn the page means exactly (keys, the lift after a landing) skips the engine's spike filter
  const turn = (dx, dy) => { if (st.app.turn_look) st.app.turn_look(dx, dy); else st.app.add_look(dx, dy); };
  on(window, 'keydown', (e) => {
    if (!live() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (!e.repeat) {
      if (e.code === 'KeyV') { third = !third; st.app.set_third_person(third); }
      if (e.code === 'KeyF') fly = !fly;
      if (e.code === 'KeyG' && !game) run('character ' + (NEXT_BODY[body] || 'girl')); // in a game G drops (inv-fix)
      if (e.code === 'KeyB') send({ t: 'wardrobe', on: !wardrobeShown });
      // the game takes digits, R, Q / I, T, Esc in a menu (a menu frees the mouse)
      if (game) { try { if (st.app.game_key(e.code)) { if (menuOpen() && document.pointerLockElement === canvas) document.exitPointerLock(); e.preventDefault(); } } catch (er) { /* not a game key */ } }
    }
    if (studio && !e.repeat) { const t = { KeyA: [-180, 0], ArrowLeft: [-180, 0], KeyD: [180, 0], ArrowRight: [180, 0], KeyW: [0, -60], ArrowUp: [0, -60], KeyS: [0, 60], ArrowDown: [0, 60] }[e.code]; if (t) turn(t[0], t[1]); }
    keys.add(e.code); publish();
    // the key is the game's: the page under it (site hotkeys, Esc of its panels, a focused site button) never sees it
    e.stopPropagation();
  }, true);
  on(window, 'keyup', (e) => { if (keys.delete(e.code)) publish(); if (live() && !e.ctrlKey && !e.metaKey && !e.altKey) e.stopPropagation(); }, true);
  on(window, 'blur', () => { keys.clear(); drag = false; publish(); });
  // look-fix (owner 13.11 «резко в разные стороны тащит»): the engine drops pointer-lock spikes (camera::LookFilter);
  // a new lock drops its first event (the cursor's jump to the centre), a drag or a finger starts a fresh gesture
  const lookReset = (skip) => { try { if (st.app && st.app.look_reset) st.app.look_reset(skip); } catch (e) { /* an older engine: no filter */ } };
  on(document, 'pointerlockchange', () => { if (document.pointerLockElement === canvas) lookReset(true); });
  if (studio) on(window, 'resize', place);   // the phone turned / the window changed: the character stays above the panel
  let drag = false;
  on(canvas, 'click', () => { canvas.focus({ preventScroll: true }); if (!touch && !wardrobeShown && !menuOpen() && document.pointerLockElement !== canvas && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* dragging works */ } } });
  on(canvas, 'contextmenu', (e) => { if (game) e.preventDefault(); });
  let hudMouse = false;
  on(canvas, 'mousedown', (e) => {
    if (touch) return;
    if (game && live()) {
      const [x, y] = toCanvas(e);
      // a menu or the tray takes the click; with the pointer locked: left = the action, right = place / eat
      // (the HUD's release comes on mouseup: the inventory window drags items; the other menus act the same on it)
      if (document.pointerLockElement !== canvas && st.app.game_pointer(x, y, 0, 1)) { hudMouse = true; return; }
      if (document.pointerLockElement === canvas) { if (e.button === 0) mouse.act = true; if (e.button === 2) mouse.use = true; publish(); return; }
    }
    drag = true;
    lookReset(false);
  });
  on(window, 'mouseup', (e) => { drag = false; if (hudMouse) { hudMouse = false; if (game) { const [x, y] = toCanvas(e); st.app.game_pointer(x, y, 2, 1); } return; } if (game) { if (e.button === 0) mouse.act = false; if (e.button === 2) mouse.use = false; publish(); } });
  on(canvas, 'wheel', (e) => { e.preventDefault(); st.app.zoom_by(-e.deltaY / (e.deltaMode === 1 ? 3 : 100)); }, { passive: false });
  on(window, 'mousemove', (e) => {
    if (!live()) return;
    if (menuOpen()) { const [x, y] = toCanvas(e); st.app.game_pointer(x, y, 1, 1); return; }
    if (document.pointerLockElement === canvas || drag) st.app.add_look(e.movementX, e.movementY);
  });

  // buttons over the canvas (touch first; the mouse can use them too): jump, orbit <-> ground, wardrobe
  const button = (cls, text, title) => { const b = add(el('button', 'd37h-btn ' + cls + (game ? ' d37h-game' : ''), text)); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); return b; };
  const hold = (b, set) => {
    const h = (v) => (e) => { e.preventDefault(); e.stopPropagation(); set(v); publish(); };
    b.addEventListener('pointerdown', h(true));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, h(false));
  };
  const bWard = button('d37h-ward', '👕', 'Гардероб (B)');
  if (studio) bWard.style.display = 'none';
  bWard.addEventListener('click', (e) => { e.stopPropagation(); send({ t: 'wardrobe', on: !wardrobeShown }); });
  if (planet && !game) hold(button('d37h-orbit', '🌍', 'Орбита ↔ земля (O)'), (v) => { orbitHeld = v; });
  if (touch) {
    if (!studio) hold(button('d37h-jump', '⤒', 'Прыжок'), (v) => { touchJump = v; });
    const R = 56;
    const hudTouch = new Set();
    on(canvas, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      if (game) { const [x, y] = toCanvas(e); if (st.app.game_pointer(x, y, 0, e.pointerId)) { hudTouch.add(e.pointerId); publish(); return; } }
      const r = canvas.getBoundingClientRect();
      if (!studio && e.clientX - r.left < r.width / 2 && stick.id === -1) { stick.id = e.pointerId; stick.x0 = e.clientX; stick.y0 = e.clientY; stick.sx = 0; stick.sy = 0; }
      else if (look.id === -1) { look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY; lookReset(false); }
    });
    on(canvas, 'pointermove', (e) => {
      if (hudTouch.has(e.pointerId)) { const [x, y] = toCanvas(e); st.app.game_pointer(x, y, 1, e.pointerId); return; }
      if (e.pointerId === stick.id) { stick.sx = Math.max(-1, Math.min(1, (e.clientX - stick.x0) / R)); stick.sy = Math.max(-1, Math.min(1, (stick.y0 - e.clientY) / R)); publish(); }
      else if (e.pointerId === look.id) { st.app.add_look((e.clientX - look.x) * 2.5, (e.clientY - look.y) * 2.5); look.x = e.clientX; look.y = e.clientY; }
    });
    const end = (e) => { if (hudTouch.has(e.pointerId)) { hudTouch.delete(e.pointerId); const [x, y] = toCanvas(e); st.app.game_pointer(x, y, 2, e.pointerId); publish(); return; } if (e.pointerId === stick.id) { stick.id = -1; stick.sx = 0; stick.sy = 0; publish(); } if (e.pointerId === look.id) look.id = -1; };
    on(canvas, 'pointerup', end); on(canvas, 'pointercancel', end);
  }
  const hint = add(el('div', 'd37h-hint', studio ? (touch ? 'Проведи пальцем — повернуть камеру' : 'Тяни мышью — повернуть камеру · колесо — ближе и дальше') : game
    ? (touch ? 'Слева — идти · справа — смотреть · кнопки: ДЕЙСТВИЕ, СУМКА, РЕМЕСЛО' : 'Нажми на картинку · ЛКМ / E — рубить, брать, ставить · ПКМ — поставить / съесть · 1-8 — в руку · Q — сумка · T — ремесло · R — повернуть')
    : touch
    ? (planet ? 'Слева — идти / лететь · справа — смотреть · 🌍 — на землю и обратно · 👕 — гардероб' : 'Слева — идти · справа — смотреть')
    : 'Нажми на картинку — мышь смотрит · W A S D — идти · Пробел — прыжок · O — на землю и обратно · B — гардероб · V — вид'));
  if (game) { hint.style.bottom = 'auto'; hint.style.top = '56px'; }
  setTimeout(() => { hint.style.opacity = '0'; }, 9000);

  // ── the wardrobe panel: drawn from app.wardrobe_json(); every choice is one engine command (character / tint) ──
  const panel = add(el('div', 'd37h-wardrobe'));
  panel.style.display = 'none';
  let wardrobeShown = false, wSlot = null, wHue = 330, wVal = 1, panelBody = '';
  const hex2 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  const hsv = (h, s, v) => { const c = v * s, hp = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1)), m = v - c; const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]; return hex2(r + m) + hex2(g + m) + hex2(b + m); };
  const wbtn = (text, isOn, click) => { const b = el('button', isOn ? 'on' : '', text); b.type = 'button'; b.addEventListener('click', (e) => { e.stopPropagation(); click(); }); return b; };
  function wrun(cmd) { run(cmd); setTimeout(buildPanel, /^character/.test(cmd) ? 120 : 0); }
  function buildPanel() {
    if (!wardrobeShown || !st.app) return;
    let w; try { w = JSON.parse(st.app.wardrobe_json()); } catch (e) { return; }
    panelBody = String(w.body || '');
    panel.textContent = '';
    panel.appendChild(el('div', 'd37h-wt', 'Гардероб'));
    const row = (label) => { panel.appendChild(el('div', 'd37h-wg', label)); const r = el('div', 'd37h-wr'); panel.appendChild(r); return r; };
    const rb = row('Персонаж');
    for (const b of w.bodies || []) rb.appendChild(wbtn(String(b.label), b.name === w.body, () => wrun('character ' + b.name)));
    const slots = Array.isArray(w.slots) ? w.slots : [];
    if (!slots.length) panel.appendChild(el('div', 'd37h-ws', 'У манекена нет одежды и цветов — выбери девочку или мальчика'));
    if (!slots.find((x) => x.slot === wSlot)) wSlot = slots.length ? slots[0].slot : null;
    for (const sl of slots) {
      const r = row(String(sl.label) + (sl.slot === wSlot ? ' ◂' : ''));
      r.appendChild(wbtn('свой', sl.color === null, () => { wSlot = sl.slot; wrun('tint ' + w.body + ' ' + sl.slot + ' own'); }));
      for (const c of sl.swatches || []) {
        if (!HEX.test(String(c))) continue;
        const b = wbtn('', sl.color === c, () => { wSlot = sl.slot; wrun('tint ' + w.body + ' ' + sl.slot + ' ' + c); });
        b.className += ' sw'; b.style.background = '#' + c; b.title = '#' + c; b.setAttribute('aria-label', 'цвет #' + c); r.appendChild(b);
      }
    }
    if (wSlot) {
      const range = (label, min, max, step, val, set) => { const r = row(label); const i = document.createElement('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = val; i.setAttribute('aria-label', label); i.addEventListener('input', () => { set(Number(i.value)); run('tint ' + w.body + ' ' + wSlot + ' ' + hsv(wHue, 0.55, wVal)); }); i.addEventListener('change', buildPanel); r.appendChild(i); };
      range('Оттенок', 0, 359, 1, wHue, (v) => { wHue = v; });
      range('Яркость', 0.25, 1, 0.01, wVal, (v) => { wVal = v; });
    }
    const re = row('');
    if (slots.length) re.appendChild(wbtn('Цвета как были', false, () => wrun('tint ' + w.body + ' reset')));
    re.appendChild(wbtn('Готово', false, () => send({ t: 'wardrobe', on: false })));
  }
  function syncPanel(show) {
    wardrobeShown = !!show;
    panel.style.display = wardrobeShown ? 'block' : 'none';
    bWard.classList.toggle('on', wardrobeShown);
    if (wardrobeShown) {
      if (document.pointerLockElement) document.exitPointerLock();
      hint.style.opacity = '0';
      // the wardrobe turns the camera to the face; a look steeply down would still show the top of the head
      levelLook(-8);
      buildPanel();
    }
  }

  // The orbit starts looking steeply down (-75°): on the ground that look shows the top of the head and the ground only.
  // After a landing, a start on the ground and in the wardrobe the look is lifted to just under the horizon (add_look:
  // 0.08° per pixel, moving up looks up); a player who looks down on purpose later is not touched.
  function levelLook(target) {
    try { const [, pitch] = Array.from(st.app.look_deg()); if (pitch < target - 13) turn(0, (pitch - target) / 0.08); } catch (e) { /* the look stays */ }
  }

  // ── the frame: jobs to idle Workers, one engine frame, the bridge's messages ──
  let last = performance.now(), acc = 0, n = 0, lastT = 0;
  function fail(code, e) {
    if (st.dead) return;
    st.error = String(e && e.message ? e.message : e).slice(0, 300);
    let panic = ''; try { panic = last_panic(); } catch (er) { /* the instance is gone */ }
    st.dead = true;
    cancelAnimationFrame(st.raf);
    emit({ t: 'error', code, msg: (panic || st.error).slice(0, 300) });
  }
  function frame(now) {
    st.raf = 0;
    if (st.dead || st.paused || !st.app) return;
    const a = st.app;
    if (fit()) a.resize(canvas.width, canvas.height);
    let idle = st.pool.filter((s) => s.ready && !s.busy && !s.dead);
    try {
      if (planet) {
        const busyGround = st.pool.some((s) => s.busy && s.ground);
        const g = st.loaded && !busyGround && (idle.length > 0 || !st.pool.length) ? a.ground_jobs(1) : [];
        for (let i = 1; i < g.length; i++) {
          if (st.pool.length) { const s = idle[i - 1]; s.busy = true; s.ground = true; s.w.postMessage({ type: 'ground', index: g[i], size: g[0] }); }
          else a.push_ground(ground_layer(g[i], g[0]));
        }
        if (g.length > 1) idle = idle.slice(g.length - 1);
        if (idle.length) { const jobs = a.take_chunk_jobs(idle.length); for (let i = 0; i * 2 < jobs.length; i++) { idle[i].busy = true; idle[i].w.postMessage({ type: 'chunk', lo: jobs[i * 2], hi: jobs[i * 2 + 1] }); } }
      } else if (idle.length) {
        const jobs = a.take_jobs(idle.length);
        for (let i = 0; i * 4 < jobs.length; i++) { idle[i].busy = true; idle[i].w.postMessage({ type: 'job', cx: jobs[i * 4], cz: jobs[i * 4 + 1], lo: jobs[i * 4 + 2] >>> 0, hi: jobs[i * 4 + 3] >>> 0 }); }
      }
      a.frame(now);
      st.frames++;
      const out = a.host_out();
      if (out) {
        for (const m of JSON.parse(out)) {
          if (m.t === 'loaded') { st.loaded = true; try { const p = JSON.parse(a.planet_stats()); if (planet && p.alt < 100) levelLook(-12); } catch (e) { /* numbers only */ } spawnOnce(); }
          if (m.t === 'event' && m.code === 'landed') levelLook(-12);
          if (m.t === 'wardrobe') syncPanel(m.on);
          // the body changed (a click, G, the page's saved look): the panel shows that body's parts
          if (m.t === 'look_changed' && m.body) { body = m.body; if (wardrobeShown && m.body !== panelBody) buildPanel(); }
          emit(m);
        }
      }
    } catch (e) {
      // a surface configured again is not an error; anything else stops the world (the page shows its error screen)
      if (!String(e).includes('reconfigured')) { fail('frame', e); return; }
    }
    acc += now - last; last = now; n++;
    if (now - lastT > 250) {
      st.fps = n * 1000 / Math.max(acc, 1); acc = 0; n = 0; lastT = now;
      if (!st.loaded && planet) { try { const p = JSON.parse(a.planet_stats()); progress('world', p.shown || 0, (p.shown || 0) + (p.queued || 0) + (p.ready || 0)); } catch (e) { /* numbers only */ } }
    }
    st.raf = requestAnimationFrame(frame);
  }
  // W8 hub: the world is there — a new world / the shortcut / the spawn choice, once, through the admin path (§5.2)
  let spawned = false;
  function spawnOnce() {
    if (spawned || !game) return;
    spawned = true;
    // EP8 fix (play check): «Играть» with no world yet starts the path from the cell, like «Новый мир»
    const fresh = o.scene === 'valley' && !(o.save && o.save.length) && !o.skipTribe && o.spawn !== 'orbit';
    const cmds = o.newWorld || fresh ? ['game progress new'] : o.skipTribe ? ['game progress skip tribe'] : o.spawn === 'orbit' ? ['travel orbit'] : o.spawn === 'home' ? ['game place goto home_valley'] : [];
    for (const c of cmds) { const r = run(c); if (typeof r === 'string' && /^отказ|error|no such/i.test(r)) emit({ t: 'error', code: 'spawn', msg: (c + ': ' + r).slice(0, 200) }); }
  }
  publish();
  st.raf = requestAnimationFrame(frame);

  const handle = {
    state: st,
    send,
    // the player's game as bytes (bridge::SaveV1); empty when the engine is gone
    save() { try { return st.app && !st.dead ? st.app.save() : new Uint8Array(0); } catch (e) { return new Uint8Array(0); } },
    stats() { try { return st.app ? JSON.parse(st.app.stats()) : null; } catch (e) { return null; } },
    // EP7: the game's numbers (items, parts, saves...; null without a game layer)
    gameStats() { try { return st.app && game ? JSON.parse(st.app.game_stats()) : null; } catch (e) { return null; } },
    // a DOM sheet over the world (chat, menu): the keys stop reaching the game
    input(enabled) { st.inputOn = !!enabled; if (!enabled) { keys.clear(); if (document.pointerLockElement === canvas) document.exitPointerLock(); } publish(); },
    pause() { if (st.paused || st.dead) return; st.paused = true; keys.clear(); publish(); try { st.app && st.app.audio_park(true); } catch (e) { /* no sound */ } cancelAnimationFrame(st.raf); st.raf = 0; if (document.pointerLockElement === canvas) document.exitPointerLock(); },
    resume() { if (!st.paused || st.dead) return; st.paused = false; try { st.app && st.app.audio_park(false); } catch (e) { /* no sound */ } last = performance.now(); if (!st.raf) st.raf = requestAnimationFrame(frame); },
    // everything this start made goes away: the frame loop, listeners, Workers, the GPU device (free), the DOM
    dispose() {
      if (st.disposed) return;
      st.disposed = true; st.dead = true;
      cancelAnimationFrame(st.raf); st.raf = 0;
      if (document.pointerLockElement === canvas) { try { document.exitPointerLock(); } catch (e) { /* gone */ } }
      for (const [t, ev, f, opt] of st.listeners) t.removeEventListener(ev, f, opt);
      st.listeners.length = 0;
      for (const s of st.pool) { try { s.w.terminate(); } catch (e) { /* gone */ } }
      st.pool.length = 0;
      const a = st.app; st.app = null;
      // the game's sound stops with the game (it lives outside the app object and would keep playing on the site)
      try { a && a.audio_close(); } catch (e) { /* no sound */ }
      try { a && a.free(); } catch (e) { /* already freed */ }
      for (const e of made) e.remove();
      made.length = 0;
    },
  };
  return handle;
}
