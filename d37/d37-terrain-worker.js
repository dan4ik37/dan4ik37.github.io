// d37-terrain-worker.js — a build Worker of the D37 web build: its own instance of the engine's wasm and one
// builder — a terrain column mesher (flat scenes) or a planet chunk builder (the planet).
// Messages: {type:'init', scene, planet, module?} -> {type:'ready'} (module: a compiled WebAssembly.Module);
//   {type:'job', cx, cz, lo, hi} -> {type:'done', cx, cz, lo, hi, bytes, ms};
//   {type:'chunk', lo, hi} -> {type:'chunk', bytes, ms}   (bytes is transferred, not copied);
//   {type:'ground', index, size} -> {type:'ground', bytes, ms}   (one ground material layer: from its CC0 set's two PNGs
//   beside the page (materials/cc0/<stem>_albedo.png, _surface.png; ep15-look L2), else made by code);
//   {type:'scatter', w, rows} -> {type:'scatter', w, bytes, ms}   (fly-hitch: one scatter LOD tile; w = the job's
//   5 words from take_scatter_jobs, rows = scatter_rows(); the builder is made on the first job).
import init, { ColumnWorker, PlanetWorker, ScatterWorker, D37_GLUE_BUILD, ground_layer, ground_layer_cc0, ground_layer_cc0_stem } from './d37_web.js';

let mesher = null, builder = null, scatter = null, sceneText = '';
let chunkCache = null, pendingWrites = 0, writes = 0;
const CHUNK_STORE = 'chunks';
const CHUNK_LIMIT = 2048;
const CHUNK_BYTES_LIMIT = 96 * 1024;
const READ_TIMEOUT_MS = 120;
const pending = [];

function openChunkStore() {
  return new Promise((resolve) => {
    const request = indexedDB.open('d37-planet-chunks', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(CHUNK_STORE, { keyPath: 'key' });
      store.createIndex('created', 'created');
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = request.onblocked = () => resolve(null);
  });
}

async function chunkStore(scene) {
  try {
    const [db, hash] = await Promise.all([
      openChunkStore(),
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(scene)),
    ]);
    if (!db) return null;
    const world = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
    return { db, world };
  } catch {
    return null;
  }
}

function readChunk(cache, key) {
  return new Promise((resolve) => {
    const request = cache.db.transaction(CHUNK_STORE).objectStore(CHUNK_STORE).get(key);
    request.onsuccess = () => resolve(request.result?.bytes);
    request.onerror = () => resolve(null);
  });
}

function keepChunk(cache, key, bytes) {
  if (pendingWrites >= 4) return;
  try {
    const tx = cache.db.transaction(CHUNK_STORE, 'readwrite');
    const store = tx.objectStore(CHUNK_STORE);
    store.put({ key, bytes, created: Date.now() });
    pendingWrites++;
    tx.oncomplete = tx.onabort = () => { pendingWrites--; };
    if (writes++ % 32 !== 0) return;
    const count = store.count();
    count.onsuccess = () => {
      let excess = count.result - CHUNK_LIMIT;
      if (excess <= 0) return;
      const oldest = store.index('created').openKeyCursor();
      oldest.onsuccess = () => {
        const row = oldest.result;
        if (!row || excess-- <= 0) return;
        store.delete(row.primaryKey);
        row.continue();
      };
    };
  } catch {
    // World streaming can always regenerate when storage is unavailable.
  }
}

function validChunk(bytes, lo, hi) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 48 || bytes.byteLength > CHUNK_BYTES_LIMIT) return false;
  const data = new DataView(bytes);
  return data.getUint32(0, true) === lo && data.getUint32(4, true) === hi
    && data.getUint32(36, true) + 48 === bytes.byteLength;
}

function validScatter(bytes, words) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 184 || bytes.byteLength > CHUNK_BYTES_LIMIT) return false;
  const data = new DataView(bytes);
  return words.every((word, i) => data.getUint32(i * 4, true) === word)
    && 184 + data.getUint32(176, true) * 64 + data.getUint32(180, true) * 16 === bytes.byteLength;
}

async function loadTerrain(address, valid, build) {
  let timer;
  let cache, key, bytes;
  try {
    if (chunkCache) {
      const deadline = new Promise(resolve => { timer = setTimeout(resolve, READ_TIMEOUT_MS); });
      const lookup = chunkCache.then(async (store) => {
        cache = store;
        if (!cache) return null;
        key = [D37_GLUE_BUILD, cache.world, ...address];
        return readChunk(cache, key);
      });
      bytes = await Promise.race([lookup, deadline]);
    }
  } catch {
    // A slow, blocked or unavailable cache is a normal miss.
  } finally {
    clearTimeout(timer);
  }
  const fromDisk = valid(bytes);
  if (!fromDisk) {
    const built = build();
    bytes = built.buffer.slice(built.byteOffset, built.byteOffset + built.byteLength);
    if (cache && valid(bytes)) keepChunk(cache, key, bytes);
  }
  return { bytes, fromDisk };
}

async function run(m) {
  const t0 = performance.now();
  if (m.type === 'dig') {
    try {
      const bytes = builder.build_dig(new Uint8Array(m.bytes));
      postMessage({ type: 'dig', ticket: m.ticket, bytes: bytes.buffer, ms: performance.now() - t0 }, [bytes.buffer]);
    } catch (e) {
      postMessage({ type: 'dig', ticket: m.ticket, error: String(e) });
    }
    return;
  }
  if (m.type === 'scatter') {
    try {
      const { bytes, fromDisk } = await loadTerrain(
        ['scatter', ...m.rows, ...m.w],
        cached => validScatter(cached, m.w),
        () => {
          if (!scatter) scatter = new ScatterWorker(sceneText, m.rows[0], m.rows[1]);
          return scatter.build(Uint32Array.from(m.w));
        },
      );
      postMessage({ type: 'scatter', w: m.w, bytes, ms: performance.now() - t0, fromDisk }, [bytes]);
    } catch (e) {
      // A scatter tile is looks only: report it and keep building chunks.
      postMessage({ type: 'scatter', w: m.w, error: String(e) });
    }
    return;
  }
  if (m.type === 'ground') {
    const send = (b) => {
      const gb = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      postMessage({ type: 'ground', bytes: gb, ms: performance.now() - t0 }, [gb]);
    };
    const stem = ground_layer_cc0_stem(m.index);
    if (!stem) { send(ground_layer(m.index, m.size)); return; }
    // the CC0 set's files (separate from the wasm); any failure: the layer made by code, as before
    const get = (k) => fetch(new URL('./materials/cc0/' + stem + '_' + k + '.png', import.meta.url)).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
    Promise.all([get('albedo'), get('surface')])
      .then(([a, s2]) => send(ground_layer_cc0(m.index, m.size, new Uint8Array(a), new Uint8Array(s2))))
      .catch(() => send(ground_layer(m.index, m.size)));
    return;
  }
  if (m.type === 'chunk') {
    const { bytes, fromDisk } = await loadTerrain(
      ['ground', m.hi, m.lo],
      cached => validChunk(cached, m.lo, m.hi),
      () => builder.build(m.lo, m.hi),
    );
    postMessage({ type: 'chunk', bytes, ms: performance.now() - t0, fromDisk }, [bytes]);
    return;
  }
  const bytes = mesher.mesh(m.cx, m.cz);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  postMessage({ type: 'done', cx: m.cx, cz: m.cz, lo: m.lo, hi: m.hi, bytes: buf, ms: performance.now() - t0 }, [buf]);
}

onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      // a host page that compiled the module already passes it (engine-host.js): no second download or compile
      await init({ module_or_path: m.module || new URL('./d37_web_bg.wasm', import.meta.url) });
      sceneText = m.scene;
      if (m.planet) {
        builder = new PlanetWorker(m.scene);
        if (m.cacheChunks !== false) chunkCache = chunkStore(m.scene);
      } else {
        mesher = new ColumnWorker(m.scene);
      }
      postMessage({ type: 'ready' });
      while (pending.length) await run(pending.shift());
    } else if (m.type === 'job' || m.type === 'chunk' || m.type === 'ground' || m.type === 'scatter' || m.type === 'dig') {
      if (mesher || builder) await run(m); else pending.push(m);
    }
  } catch (e) {
    postMessage({ type: 'error', error: String(e) });
  }
};
