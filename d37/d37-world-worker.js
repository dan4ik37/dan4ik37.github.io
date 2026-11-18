// d37-world-worker.js — ep13-worker: the world of the D37 web build in its own thread (`?world=worker`). Its own
// instance of the engine's wasm runs the simulation (WorldWorker: core world + mover + game layer + its net link) on
// the native world thread's clock; the page's thread only draws. Glue only: the clock rule, the ticks and the
// messages' bytes are in the wasm (crates/d37-web/src/worker.rs, wire.rs).
// Messages: {type:'init', scene, save?, module?} -> {type:'frame', bytes} after every wake that ran ticks (the first
//   one = the world is ready); {type:'in', bytes} (the page's action state + commands, wire::Input);
//   {type:'pause'} / {type:'resume'} (the host paused the game); {type:'stop'}; an error -> {type:'error', error} (the world stops; the page shows its error screen).
// bytes are transferred ArrayBuffers both ways (no copies, no JSON on the hot path).
import init, { WorldWorker, last_panic } from './d37_web.js';

let world = null, timer = 0, paused = false;
const now = () => performance.timeOrigin + performance.now();

function fail(e) {
  let p = '';
  try { p = last_panic(); } catch (er) { /* the instance is gone */ }
  postMessage({ type: 'error', error: (p || String(e)).slice(0, 400) });
  world = null;
}

function wake() {
  timer = 0;
  if (!world || paused) return;
  let wait = 16;
  try {
    wait = world.wake(now());
    const f = world.take_frame();
    if (f) postMessage({ type: 'frame', bytes: f.buffer }, [f.buffer]);
  } catch (e) { fail(e); return; }
  timer = setTimeout(wake, Math.max(0, wait));
}

onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    try {
      // the page passes the module it compiled already: no second download or compile
      await init({ module_or_path: m.module || new URL('./d37_web_bg.wasm', import.meta.url) });
      world = new WorldWorker(m.scene, m.save && m.save.length ? m.save : new Uint8Array(0));
      if (m.profile) world.set_profile(true);
      if (m.slow > 1) world.set_slow(m.slow);   // tests: a phone emulation's CPU factor (DevTools cannot throttle Workers)
      wake();
    } catch (e) { fail(e); }
  } else if (m.type === 'in') {
    if (!world) return;
    try {
      world.input(new Uint8Array(m.bytes));
      // a stepped run (tests): tick at once instead of on the clock
      if (world.stepped()) { clearTimeout(timer); wake(); }
    } catch (e) { fail(e); }
  } else if (m.type === 'profile' && world) {
    postMessage({ type: 'profile', report: world.profile() });
  } else if (m.type === 'pause') {
    // the host page paused the game (a sheet over it, the tab): no ticks until it resumes (time is dropped, as on
    // the page's thread)
    paused = true; clearTimeout(timer); timer = 0;
  } else if (m.type === 'resume') {
    paused = false; if (!timer) wake();
  } else if (m.type === 'stop') {
    clearTimeout(timer); timer = 0;
    try { world && world.free(); } catch (e) { /* gone */ }
    world = null;
  }
};
