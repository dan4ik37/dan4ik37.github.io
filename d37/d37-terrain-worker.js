// d37-terrain-worker.js — a build Worker of the D37 web build: its own instance of the engine's wasm and one
// builder — a terrain column mesher (flat scenes) or a planet chunk builder (the planet).
// Messages: {type:'init', scene, planet, module?} -> {type:'ready'} (module: a compiled WebAssembly.Module);
//   {type:'job', cx, cz, lo, hi} -> {type:'done', cx, cz, lo, hi, bytes, ms};
//   {type:'chunk', lo, hi} -> {type:'chunk', bytes, ms}   (bytes is transferred, not copied);
//   {type:'ground', index, size} -> {type:'ground', bytes, ms}   (one ground material layer, made by code).
import init, { ColumnWorker, PlanetWorker, ground_layer } from './d37_web.js';

let mesher = null, builder = null;
const pending = [];

function run(m) {
  const t0 = performance.now();
  if (m.type === 'ground') {
    const b = ground_layer(m.index, m.size);
    const gb = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    postMessage({ type: 'ground', bytes: gb, ms: performance.now() - t0 }, [gb]);
    return;
  }
  const bytes = m.type === 'chunk' ? builder.build(m.lo, m.hi) : mesher.mesh(m.cx, m.cz);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const ms = performance.now() - t0;
  if (m.type === 'chunk') postMessage({ type: 'chunk', bytes: buf, ms }, [buf]);
  else postMessage({ type: 'done', cx: m.cx, cz: m.cz, lo: m.lo, hi: m.hi, bytes: buf, ms }, [buf]);
}

onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      // a host page that compiled the module already passes it (engine-host.js): no second download or compile
      await init({ module_or_path: m.module || new URL('./d37_web_bg.wasm', import.meta.url) });
      if (m.planet) builder = new PlanetWorker(m.scene); else mesher = new ColumnWorker(m.scene);
      postMessage({ type: 'ready' });
      while (pending.length) run(pending.shift());
    } else if (m.type === 'job' || m.type === 'chunk' || m.type === 'ground') {
      if (mesher || builder) run(m); else pending.push(m);
    }
  } catch (e) {
    postMessage({ type: 'error', error: String(e) });
  }
};
