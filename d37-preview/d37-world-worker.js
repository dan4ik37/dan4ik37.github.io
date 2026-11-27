// d37-world-worker.js — ep13-worker: the world of the D37 web build in its own thread (`?world=worker`). Its own
// instance of the engine's wasm runs the simulation (WorldWorker: core world + mover + game layer + its net link) on
// the native world thread's clock; the page's thread only draws. Glue only: the clock rule, the ticks and the
// messages' bytes are in the wasm (crates/d37-web/src/worker.rs, wire.rs).
// Messages: {type:'init', scene, save?, module?} -> {type:'frame', bytes} after every wake that ran ticks (the first
//   one = the world is ready); {type:'in', bytes} (the page's action state + commands, wire::Input);
//   {type:'pause'} / {type:'resume'} (the host paused the game); {type:'stop'}; an error -> {type:'error', error} (the world stops; the page shows its error screen).
// bytes are transferred ArrayBuffers both ways (no copies, no JSON on the hot path).
// EP14-config: init carries `config` (the page's settings layers as JSON): applied here before the world starts, so
//   this world runs the page's RULE values -> {type:'config', report: {hash, rules_hash}} (the page compares);
//   {type:'config', config} later = a live change (LOOK values only). {type:'alive'} every 2 s while no frame went
//   out (the pause menu): the page's watchdog knows a silent Worker from a dead one. {type:'debug_panic'} (tests).
// hotfix ep14: every frame carries its sequence number; the page asks for a keyframe inside its input bytes (a gap,
//   an overflow, a failed apply, a stall). {type:'quiet', on} = the page is hidden (on) / shown again (off): the
//   world keeps ticking but makes no frames while hidden (nothing piles up for a page that does not draw); shown
//   again, the next frame is a keyframe (WorldWorker::set_quiet).
import init, * as api from './d37_web.js';
const { WorldWorker, last_panic } = api;

const ACCOUNT_FOR_FRAME_POST_TIME = true;
let world = null, timer = 0, paused = false, lastPost = 0, lastPace = 0;
let queued = 0, wakeId = 0;
const pulse = new MessageChannel();
const now = () => performance.timeOrigin + performance.now();

pulse.port1.onmessage = ({ data }) => {
  if (data !== queued) return;
  queued = 0;
  wake();
};

function cancelWake() {
  clearTimeout(timer);
  timer = 0;
  queued = 0;
}

function fail(e) {
  let p = '';
  try { p = last_panic(); } catch (er) { /* the instance is gone */ }
  postMessage({ type: 'error', error: (p || String(e)).slice(0, 400) });
  cancelWake();
  world = null;
}

function wake() {
  timer = 0;
  if (!world || paused) return;
  let wait = 16;
  let scheduleFrom = 0;
  try {
    wait = world.wake(now());
    scheduleFrom = performance.now();
    const f = world.take_frame();
    if (f) { postMessage({ type: 'frame', bytes: f.buffer }, [f.buffer]); lastPost = performance.now(); }
    else if (performance.now() - lastPost > 2000) { postMessage({ type: 'alive' }); lastPost = performance.now(); }
    const hitch = world.take_hitch?.();
    if (hitch) postMessage({ type: 'hitch', data: hitch });
    // ep14-perf's pacing numbers (WorldWorker::pace_stats, one JSON line) about once a second for the F3 numbers; an
    // engine build without the method: nothing
    if (typeof world.pace_stats === 'function' && performance.now() - lastPace > 1000) {
      lastPace = performance.now();
      try { postMessage({ type: 'pace', stats: String(world.pace_stats()).slice(0, 2000) }); } catch (e) { /* numbers only */ }
    }
  } catch (e) { fail(e); return; }
  const elapsed = ACCOUNT_FOR_FRAME_POST_TIME ? performance.now() - scheduleFrom : 0;
  const delay = wait - elapsed;
  if (delay > 0) {
    timer = setTimeout(wake, delay);
  } else {
    // Yield to the worker's message queue while avoiding nested zero-delay timer clamping during catch-up.
    queued = ++wakeId;
    pulse.port2.postMessage(queued);
  }
}

onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    try {
      // the page passes the module it compiled already: no second download or compile
      await init({ module_or_path: m.module || new URL('./d37_web_bg.wasm', import.meta.url) });
      if (typeof m.config === 'string' && typeof api.config_apply === 'function') {
        let r = {};
        try { r = JSON.parse(api.config_apply(m.config, true)); } catch (e) { /* the defaults */ }
        postMessage({ type: 'config', report: { hash: r.hash || '', rules_hash: r.rules_hash || '', warnings: r.warnings || 0 } });
      }
      world = new WorldWorker(m.scene, m.save && m.save.length ? m.save : new Uint8Array(0));
      if (m.profile) world.set_profile(true);
      if (m.slow > 1) world.set_slow(m.slow);   // tests: a phone emulation's CPU factor (DevTools cannot throttle Workers)
      // optim lane r2 (worker.rs WARM_START_TICKS): the world's first ticks — the weather's spin-up, the first forest
      // list — run now, while the page still shows its loading state, not as a frozen third of a second after it
      if (typeof world.warm_start === 'function') world.warm_start();
      wake();
    } catch (e) { fail(e); }
  } else if (m.type === 'in') {
    if (!world) return;
    try {
      world.input(new Uint8Array(m.bytes));
      // a stepped run (tests): tick at once instead of on the clock
      if (world.stepped()) { cancelWake(); wake(); }
    } catch (e) { fail(e); }
  } else if (m.type === 'config') {
    // a live change: the LOOK values (pacing numbers) — the RULE values stay the world's
    try { if (typeof api.config_apply === 'function') api.config_apply(String(m.config || '[]'), false); } catch (e) { /* keeps the old */ }
  } else if (m.type === 'debug_panic') {
    try { api.debug_panic('worker'); } catch (e) { fail(e); }
  } else if (m.type === 'profile' && world) {
    postMessage({ type: 'profile', report: world.profile() });
  } else if (m.type === 'quiet') {
    // an engine build without the method: frames go on as before
    try { if (world && typeof world.set_quiet === 'function') world.set_quiet(!!m.on); } catch (e) { fail(e); }
  } else if (m.type === 'pause') {
    // the host page paused the game (a sheet over it, the tab): no ticks until it resumes (time is dropped, as on
    // the page's thread)
    paused = true; cancelWake();
  } else if (m.type === 'resume') {
    if (paused) world?.resume_clock?.();
    paused = false; if (!timer && !queued) wake();
  } else if (m.type === 'stop') {
    cancelWake();
    try { world && world.free(); } catch (e) { /* gone */ }
    world = null;
  }
};
