// d37-terrain-worker.js — a terrain Worker of the D37 web build: its own instance of the engine's wasm and one
// column mesher. Messages: {type:'init', scene} -> {type:'ready'}; {type:'job', cx, cz, lo, hi} ->
// {type:'done', cx, cz, lo, hi, bytes, ms} (bytes is transferred, not copied).
import init, { ColumnWorker } from './d37_web.js';

let mesher = null;
const pending = [];

function run(m) {
  const t0 = performance.now();
  const bytes = mesher.mesh(m.cx, m.cz);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  postMessage({ type: 'done', cx: m.cx, cz: m.cz, lo: m.lo, hi: m.hi, bytes: buf, ms: performance.now() - t0 }, [buf]);
}

onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      await init({ module_or_path: new URL('./d37_web_bg.wasm', import.meta.url) });
      mesher = new ColumnWorker(m.scene);
      postMessage({ type: 'ready' });
      while (pending.length) run(pending.shift());
    } else if (m.type === 'job') {
      if (mesher) run(m); else pending.push(m);
    }
  } catch (e) {
    postMessage({ type: 'error', error: String(e) });
  }
};
