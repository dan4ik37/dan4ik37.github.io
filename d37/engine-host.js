// engine-host.js — the engine-owned glue that puts D37 inside a hosting page (the site's hub, /hub/play): the loader
// with real progress (the wasm's bytes, then the graphics device, then the world around the player), the canvas, keys /
// mouse / touch, the build Workers (they get the compiled module: one download, one compile), the wardrobe panel, and
// the transport of bridge v1 (crates/d37-web/src/bridge.rs):
//   page -> engine: send({t:'session', uid, nick, realm, band, staff}) · send({t:'look', body, text}) · send({t:'wardrobe', on})
//   engine -> page: onMessage({t:'ready'|'loaded'|'look_changed'|'wardrobe'|'save_ready'|'event'|'error'|'progress', ...})
//   W9 keys: onMessage({t:'exit'}) = the pause menu's «НА САЙТ»; onMessage({t:'shot', blob, w, h}) = F2 (a PNG of the
//   game; the page puts it into its gallery, the host never downloads); o.fullscreenEl = the element F11 makes fullscreen
//   (default: the root). Esc / F1–F11 are the game's while it is live (F12 stays the browser's); in fullscreen the
//   Keyboard Lock API keeps Esc from the browser (holding Esc still leaves fullscreen — the browser's rule).
//   bytes: save() -> Uint8Array (bridge::SaveV1); the page's earlier save goes in as o.save before the world loads.
//   EP14-config (layered live settings, crates/d37-app/src/config.rs): o.config = {layers: [{name, url} | {name, text}],
//   build, poll} — the files are fetched in parallel with the wasm compile (revalidated: cache 'no-cache' = ETag, the
//   last good text kept per build in this browser), checked by the engine's key table, applied before the world
//   starts (the RULE values are frozen for the world and handed to the world Worker), re-read when the tab comes back
//   and every o.config.poll ms (LOOK values change live; a RULE change waits for the next start). ?tune=key:value,...
//   adds a dev layer on top. onMessage({t:'config', report, live}) after each apply; state.config = the report.
//   EP14-config crash handling: a wasm panic, a dead / silent world Worker or a lost graphics context stop the game
//   with a short Russian message and «Перезагрузить» over it (o.onReload, default: reload the page), and
//   onMessage({t:'error', code, msg, crash: {panic, build, config, rules, world, log: [last 20 lines]}}); save() is
//   empty after a crash (a host never stores a half-dead world over the last good save).
// It ships with the wasm (same folder, same version). No simulation and no rendering here, no site globals: the page
// (site-owned js/features/hub.js) talks only to the handle start() returns. Text from the engine is codes and the look
// text; this file puts strings into the DOM with textContent only.
import init, * as wasmApi from './d37_web.js';
const { D37Web, ground_layer, bridge_version, last_panic } = wasmApi;
import { finishDigJob, planetJobs, terrainWorkerCount } from './planet-jobs.js';

export const BRIDGE = 1;
const HERE = (f) => new URL('./' + f, import.meta.url).href;
// ep38 A2 switches (one-line rollbacks): the CC0 object images loaded by this page; the build check below.
const OBJ_TEXTURES = true;
const BUILD_CHECK = true;
// ep38 A2: the build this page script belongs to — stamped by scripts/pack.mjs into this file, d37-page.js, d37_web.js
// (D37_GLUE_BUILD) and the wasm (custom section «d37_build»); '' = an unpacked page (the repo's web/): no check.
export const PAGE_BUILD = '9eb3052024';
export function wasmBuildOf(module) {
  try { const s = WebAssembly.Module.customSections(module, 'd37_build'); return s.length ? new TextDecoder().decode(s[0]) : ''; } catch (e) { return ''; }
}
// A page script of one build with the wasm / glue of another (a stale cache) draws garbage or panics: refetch the
// engine files past the cache and reload ONCE; a second mismatch is an error, never a loop.
export async function reloadForBuild(here, files, why) {
  const key = 'd37.buildreload.' + PAGE_BUILD;
  let done = false;
  try { done = sessionStorage.getItem(key) === '1'; sessionStorage.setItem(key, '1'); } catch (e) { done = true; }
  if (done) throw new Error('build mismatch (' + why + ') after a reload: the page is ' + PAGE_BUILD);
  await Promise.all(files.map((f) => fetch(here(f), { cache: 'reload' }).catch(() => null)));
  location.reload();
  await new Promise(() => {}); // the reload takes the page away
}
export const ENGINE_FILES = ['engine-host.js', 'd37-page.js', 'd37_web.js', 'd37_web_bg.wasm', 'd37-world-worker.js', 'd37-terrain-worker.js', 'planet-jobs.js', 'index.html'];
// Match the standalone page for solo play. Keep the existing default for shared worlds and the wardrobe.
// o.world or ?world=worker|main override the default. Failure to start the Worker falls back to the page's thread.
function worldWanted(o, studio) {
  let q = '';
  try { q = new URLSearchParams(location.search).get('world') || ''; } catch (e) { /* no address */ }
  const requested = o.world || q;
  if (requested === 'worker' || requested === 'main') return requested === 'worker';
  return !studio && !o.join && (navigator.hardwareConcurrency || 2) >= 4;
}
// -- EP14-config: the settings layers --
// One layer's text: fetched (revalidated with the server: an unchanged file is a 304) with a time limit; on failure
// the last good text of this build in this browser, else nothing (the engine then starts on the lower layers).
const CFG_TIMEOUT = 2500;
async function fetchLayer(l, build) {
  if (typeof l.text === 'string') return { name: l.name, text: l.text, from: 'inline' };
  const key = 'd37.cfg.' + (build || '-') + '.' + l.name;
  let ctl = null, to = 0;
  try {
    ctl = typeof AbortController === 'function' ? new AbortController() : null;
    to = setTimeout(() => { try { ctl && ctl.abort(); } catch (e) { /* done */ } }, CFG_TIMEOUT);
    const res = await fetch(l.url, { cache: 'no-cache', signal: ctl ? ctl.signal : undefined });
    if (res.status === 404) return { name: l.name, text: null, from: 'none' };   // no file = no layer (not an error)
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    try { localStorage.setItem(key, text.slice(0, 65536)); } catch (e) { /* storage off */ }
    return { name: l.name, text, from: 'net' };
  } catch (e) {
    let text = null;
    try { text = localStorage.getItem(key); } catch (er) { /* storage off */ }
    return { name: l.name, text, from: text != null ? 'cache' : 'error', error: String(e && e.message || e).slice(0, 120) };
  } finally { clearTimeout(to); }
}
// ?tune=key:value,key:value — the dev layer (on top of everything; the page's address only, never stored)
function tuneLayer() {
  let q = '';
  try { q = new URLSearchParams(location.search).get('tune') || ''; } catch (e) { return null; }
  if (!q) return null;
  const values = {};
  for (const kv of q.split(',')) { const m = /^([a-z_]{1,40})[:=](-?[0-9.eE+-]{1,20})$/.exec(kv.trim()); if (m) values[m[1]] = Number(m[2]); }
  return { name: 'dev', text: JSON.stringify({ format: 1, values }), from: 'url' };
}
export async function fetchLayers(cfg) {
  const list = cfg && Array.isArray(cfg.layers) ? cfg.layers.filter((l) => l && typeof l.name === 'string' && (typeof l.text === 'string' || typeof l.url === 'string')) : [];
  const got = await Promise.all(list.map((l) => fetchLayer(l, cfg.build)));
  const dev = tuneLayer();
  if (dev) got.push(dev);
  return got;
}
export const layersJson = (got) => JSON.stringify(got.filter((l) => l.text != null).map((l) => ({ name: l.name, text: l.text })));

const TOUCH = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
const HEX = /^[0-9a-f]{6}$/i;

// the buttons and the wardrobe panel over the canvas (one <style>, whatever page hosts the engine)
const CSS = `.d37h-btn{position:absolute;z-index:3;width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;
background:rgba(10,14,22,.42);border:1px solid rgba(255,255,255,.32);color:#fff;font-size:24px;line-height:1;cursor:pointer;touch-action:none;
user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;padding:0}
.d37h-btn:active,.d37h-btn.on{background:rgba(255,160,60,.55)}
.d37h-jump{right:16px;bottom:calc(24px + env(safe-area-inset-bottom))}.d37h-orbit{right:16px;bottom:calc(92px + env(safe-area-inset-bottom))}
.d37h-ward{right:16px;bottom:calc(160px + env(safe-area-inset-bottom))}
/* ep11-fix-body: crouch (roll, let go of a hang / tree / ladder) and the creative world's fly toggle, the same right column */
.d37h-crouch{right:16px;bottom:calc(228px + env(safe-area-inset-bottom))}.d37h-fly{right:16px;bottom:calc(296px + env(safe-area-inset-bottom))}
.d37h-game.d37h-crouch{bottom:calc(212px + env(safe-area-inset-bottom))}.d37h-game.d37h-fly{bottom:calc(280px + env(safe-area-inset-bottom))}
.d37h-game.d37h-orbit{bottom:calc(348px + env(safe-area-inset-bottom))}
@media (pointer:fine){.d37h-orbit,.d37h-game.d37h-orbit{bottom:24px}.d37h-ward{bottom:92px}}
.d37h-game.d37h-jump{bottom:calc(76px + env(safe-area-inset-bottom))}.d37h-game.d37h-ward{bottom:calc(144px + env(safe-area-inset-bottom))}
.d37h-cell .d37h-jump,.d37h-cell .d37h-ward,.d37h-cell .d37h-orbit,.d37h-cell .d37h-hint{display:none!important}
.d37h-safe{position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
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
//      w11 kit-port: arena: 'klet' (`game klet play`: «Клеточки» as an engine mode in the player's world).
//      W8 hub: newWorld: bool (`game progress new`: a cell at the tide pool), skipTribe: bool (`game progress skip tribe`),
//      spawn: 'last' | 'home' | 'orbit' (where a saved world starts: as saved / `game place goto home_valley` / `travel orbit`),
//      W11 net-shards: join: {url, code} («Играть вместе»: the shared world with that join code on our d37-server),
//      NET_JOIN: arena: 'klet2' (the engine's «Клеточки»), joinSession: {url, game, id} (straight into a game session;
//      the handle's `lobby` lists / quick-plays / hosts sessions),
//      ep36 arena editor: scene: 'umode' + modeText: '<a mode file, JSON text>' (a person's own mode, solo; the handle's
//      checkMode(text) / runMode(text) check it with the engine's checker and restart it at once after an edit) }
// The 'wardrobe' scene is a studio: the panel is open from the start, no walking (the keys and the left half of a phone
// turn the camera round the character instead), no jump / orbit / 👕 buttons; «Готово» is sent to the page as
// {t:'wardrobe', on:false} as always (the site goes back where it came from).
const SCENE_ID = /^[a-z0-9_]{1,32}$/;
// ep36: a mode file as one command word (hex of its UTF-8 bytes: no spaces, no `;`), solo, (re)started at once
const MODE_CMD = (text) => { let h = ''; for (const b of new TextEncoder().encode(String(text))) h += (b < 16 ? '0' : '') + b.toString(16); return 'game umode file ' + h + '; game umode play mine'; };
const CHECK = (text) => { try { return JSON.parse(wasmApi.blocks_check(String(text))); } catch (e) { return { ok: false, error: 'проверка не прошла: ' + e }; } };
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
  const st = { app: null, pool: [], raf: 0, paused: false, dead: false, loaded: false, error: null, frames: 0, fps: 0, backend: '', listeners: [], keys: new Set(), inputOn: true, config: null, crash: null, log: [], timers: [] };
  // the last 20 lines of what happened (a crash report carries them)
  const log = (line) => { st.log.push(new Date().toISOString().slice(11, 23) + ' ' + String(line).slice(0, 200)); if (st.log.length > 20) st.log.shift(); };
  const on = (t, ev, f, opt) => { t.addEventListener(ev, f, opt); st.listeners.push([t, ev, f, opt]); };
  // a lost graphics context (WebGL2; a lost WebGPU device fails the next frame) stops the game with the message
  on(canvas, 'webglcontextlost', (e) => { try { e.preventDefault(); } catch (er) { /* old event */ } fail('context-lost', 'WebGL context lost'); });

  const sceneName = typeof o.scene === 'string' && SCENE_ID.test(o.scene) ? o.scene : 'planet';
  const studio = sceneName === 'wardrobe';
  // a portrait phone: the wardrobe panel takes the lower 44 % — the studio draws the character in the free part above it
  const place = () => { canvas.style.height = studio && typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches ? '56%' : '100%'; };
  place();
  // Fetch the scene while the WASM is downloading and compiling.
  progress('wasm', 0, o.rawSize || 0);
  // EP14-config: the settings files come in parallel with the wasm (they never wait for it, it never waits for them)
  const tCfg = performance.now();
  const [module, sceneText, layers] = await Promise.all([
    compileWasm(HERE('d37_web_bg.wasm'), o.rawSize || 0, (d, t) => progress('wasm', d, t)),
    fetch(HERE('scenes/' + sceneName + '.ron')).then(res => {
      if (!res.ok) throw new Error('scene: HTTP ' + res.status);
      return res.text();
    }),
    fetchLayers(o.config).then((l) => { st.cfgFetchMs = Math.round(performance.now() - tCfg); return l; }),
  ]);
  if (BUILD_CHECK && PAGE_BUILD) {
    const wb = wasmBuildOf(module), gb = wasmApi.D37_GLUE_BUILD || '';
    st.build = { page: PAGE_BUILD, wasm: wb, glue: gb };
    if (wb !== PAGE_BUILD || gb !== PAGE_BUILD) { log('build mismatch: page ' + PAGE_BUILD + ' wasm ' + wb + ' glue ' + gb); await reloadForBuild(HERE, ENGINE_FILES, 'wasm ' + wb + ', glue ' + gb); }
    try { sessionStorage.removeItem('d37.buildreload.' + PAGE_BUILD); } catch (e) { /* storage off */ }
  }
  await init({ module_or_path: module });
  try { st.panic0 = last_panic(); } catch (e) { st.panic0 = ''; }
  if (bridge_version() !== BRIDGE) throw new Error('bridge version ' + bridge_version() + ', the page speaks ' + BRIDGE);
  // apply the layers before anything starts (an older engine without the key table: the built-in numbers)
  st.cfgLayers = layers;
  st.cfgJson = layersJson(layers);
  const applyConfig = (start) => {
    if (typeof wasmApi.config_apply !== 'function') return null;
    let rep = null;
    try { rep = JSON.parse(wasmApi.config_apply(st.cfgJson, start)); } catch (e) { log('config: ' + String(e).slice(0, 120)); return null; }
    for (const l of st.cfgLayers) if (l.from === 'error' || l.from === 'cache') rep.layers.push({ name: l.name, ok: l.from === 'cache', skipped: l.from === 'error' ? 'не загрузился: ' + l.error : '', fetch: l.from, warn: [] });
    st.config = rep;
    log('config ' + (start ? 'start' : 'live') + ': ' + rep.line);
    emit({ t: 'config', report: rep, live: !start });
    return rep;
  };
  const t0 = performance.now();
  applyConfig(true);
  st.cfgApplyMs = Math.round((performance.now() - t0) * 10) / 10;
  // the world Worker's own apply: the same RULE hash as this page, or the run is reported (never two rule sets)
  function checkWorkerConfig(m) {
    st.workerConfig = m.report || null;
    const mine = st.config && st.config.rules_hash, theirs = m.report && m.report.rules_hash;
    if (mine && theirs && mine !== theirs) { log('config: Worker rules ' + theirs + ' != page ' + mine); emit({ t: 'error', code: 'config-mismatch', msg: 'rules page ' + mine + ' worker ' + theirs }); }
  }
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
  if (typeof app.set_gpu_culling === 'function'
    && (o.gpuCulling ?? (new URLSearchParams(location.search).get('gpu_cull') === '1'))) {
    st.gpuCullingEnabled = await app.set_gpu_culling(true);
  }
  if (o.quality) { try { app.set_quality(o.quality); } catch (e) { /* keeps mid */ } }
  // ep38 A2 (R-LATE-1122-05, the site's game drew leaf cards and tufts as flat pale squares): the things' CC0 material
  // images, as the standalone page loads them — this page never did, so every card kept the 1 x 1 stand-in (no
  // cut-out). Rollback: OBJ_TEXTURES = false.
  if (OBJ_TEXTURES && typeof app.object_texture_classes === 'function') {
    st.objTex = { want: 0, got: 0, failed: [] };
    app.object_texture_classes().forEach((c, i) => ['albedo', 'surface'].forEach((k, kind) => {
      st.objTex.want++;
      fetch(HERE('materials/cc0/obj_' + c + '_' + k + '.png'))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))))
        .then((b) => { if (st.app !== app) return; app.push_object_texture(i, kind, new Uint8Array(b)); st.objTex.got++; })
        .catch((e) => { st.objTex.failed.push(c + '_' + k); log('object material ' + c + '_' + k + ': ' + String(e && e.message || e).slice(0, 80)); });
    }));
  }
  progress('gpu', 1, 1);

  // Workers: each builds planet chunks / ground layers from the module compiled above
  const useWorldWorker = worldWanted(o, studio) && typeof Worker !== 'undefined' && typeof app.load_scene_remote === 'function';
  const nW = terrainWorkerCount(navigator.hardwareConcurrency || 2, touch, useWorldWorker, o.workers ?? 4);
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
          else if (m.type === 'dig') { finishDigJob(st.app, slot, m); if (m.error) console.warn('d37 cave worker', m.error); }
          else if (m.type === 'ground') { slot.busy = false; slot.ground = false; st.app.push_ground(new Uint8Array(m.bytes)); }
          // fly-hitch: a scatter LOD tile built off the page's thread (an error is looks only: logged, not fatal)
          else if (m.type === 'scatter') { slot.busy = false; slot.scatter = false; if (m.error) console.warn('d37 scatter worker', m.error); else st.app.push_scatter(new Uint8Array(m.bytes)); }
          else if (m.type === 'error') { slot.dead = true; emit({ t: 'error', code: 'worker', msg: String(m.error).slice(0, 200) }); }
        } catch (e) { fail('worker-result', e); }
      };
      w.onerror = () => { slot.dead = true; if (st.app) finishDigJob(st.app, slot); };
      st.pool.push(slot);
    } catch (e) { /* no Worker: built on this thread */ }
  }
  const initTerrain = () => {
    const planet = app.is_planet();
    for (const s of st.pool) {
      if (s.initialized) continue;
      s.w.postMessage({ type: 'init', scene: sceneText, planet, module });
      s.initialized = true;
    }
  };
  // a save made earlier: the world starts where it was made (refused saves are reported, the world starts fresh)
  if (o.save && o.save.length) {
    try { emit({ t: 'resumed', summary: JSON.parse(app.load_save(o.save)) }); } catch (e) { emit({ t: 'error', code: 'save', msg: String(e).slice(0, 200) }); }
  }
  // ep13-worker: the world in its own thread; the Worker builds its world while this thread makes the renderer's
  let ww = null;
  if (useWorldWorker) {
    let w = null;
    try {
      w = new Worker(HERE('d37-world-worker.js'), { type: 'module' });
      const ready = new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('no first world frame in 20 s')), 20000);
        w.onmessage = (ev) => {
          const m = ev.data;
          if (m.type === 'frame') { clearTimeout(to); st.worldAt = performance.now(); if (st.app) st.app.world_in(new Uint8Array(m.bytes)); res(); }
          else if (m.type === 'config') checkWorkerConfig(m);
          else if (m.type === 'error') { clearTimeout(to); rej(new Error(m.error)); }
        };
        w.onerror = (e) => { clearTimeout(to); try { e.preventDefault(); } catch (er) { /* old event */ } rej(new Error(e.message || 'the world Worker did not load')); };
      });
      // EP14-config: the Worker applies the same layers before its world starts (the same RULE values as this page)
      w.postMessage({ type: 'init', scene: sceneText, save: o.save && o.save.length ? o.save : null, module, config: st.cfgJson });
      app.load_scene_remote(sceneText, st.pool.length > 0);
      initTerrain();
      await ready;
      w.onmessage = (ev) => {
        const m = ev.data;
        if (!st.app || st.dead) return;
        if (m.type === 'frame') { st.worldAt = performance.now(); st.app.world_in(new Uint8Array(m.bytes)); }
        else if (m.type === 'alive') st.worldAt = performance.now();
        else if (m.type === 'hitch') st.app.world_hitch?.(m.data);
        else if (m.type === 'pace') st.paceStats = m.stats;   // ep14-perf: the world Worker's pacing line (F3 / tests)
        else if (m.type === 'config') checkWorkerConfig(m);
        else if (m.type === 'error') fail('world-worker', m.error);
      };
      w.onerror = (e) => fail('world-worker', e.message || 'world Worker error');
      w.onmessageerror = () => fail('world-worker', 'world Worker message error');
      // hotfix ep14: a hidden tab draws nothing: the Worker stops sending frames (the world keeps ticking); shown
      // again, the page and the Worker start again from a keyframe
      on(document, 'visibilitychange', () => {
        if (st.dead || !st.app) return;
        const hidden = document.visibilityState === 'hidden';
        try { w.postMessage({ type: 'quiet', on: hidden }); if (!hidden && typeof st.app.world_resync === 'function') st.app.world_resync(); } catch (e) { /* gone */ }
        if (!hidden) st.worldAt = performance.now();
      });
      ww = w;
    } catch (e) {
      // the page's thread runs the world (the save is handed in again: load_scene_remote took it)
      console.warn('d37 host: world Worker off —', String(e && e.message || e).slice(0, 200));
      try { w && w.terminate(); } catch (er) { /* gone */ }
      if (o.save && o.save.length) { try { app.load_save(o.save); } catch (er) { /* refused before: reported then */ } }
    }
  }
  st.worldWorker = ww;
  st.world = ww ? 'worker' : 'main';
  log('world: ' + st.world + ' · backend ' + st.backend);
  if (!ww) {
    app.load_scene(sceneText, st.pool.length > 0);
    initTerrain();
  }
  const planet = app.is_planet();
  // EP7 the game layer (a scene with a `game` block): the HUD is drawn and hit tested by the engine; this glue only
  // forwards keys / pointers (the same rules as the engine's page d37-page.js). Its save rides in save() (GAME section).
  const game = app.game_on();
  const creative = o.scene === 'creative';   // ep11 publish: the orbit button in the creative world (see the touch buttons)
  st.game = game;
  if (game) app.game_set_touch(touch);
  const mouse = { act: false, use: false };
  const toCanvas = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / Math.max(1, r.width), (e.clientY - r.top) * canvas.height / Math.max(1, r.height)]; };
  const menuOpen = () => { try { return game && st.app.game_menu_open(); } catch (e) { return false; } };
  // cell2 phone: the cell stage (the engine says "cell"): every pointer is the game's (swim to the finger / the held
  // mouse, double tap = dash), no pointer lock, the page's own buttons hidden; the safe-area insets go to the engine
  let cellMode = false;
  const safeProbe = add(el('div', 'd37h-safe'));
  function cellSync() {
    let m = '';
    try { m = st.app.game_mode ? st.app.game_mode() : ''; } catch (e) { /* an older engine */ }
    const on = m === 'cell';
    if (on !== cellMode) {
      cellMode = on;
      root.classList.toggle('d37h-cell', on);
      if (on && document.pointerLockElement === canvas) { try { document.exitPointerLock(); } catch (e) { /* not locked */ } }
    }
    if (!on || !st.app.game_set_safe) return;
    try {
      const cs = getComputedStyle(safeProbe), r = canvas.getBoundingClientRect(), k = canvas.width / Math.max(1, r.width);
      const px = (v) => (parseFloat(v) || 0) * k;
      st.app.game_set_safe(px(cs.paddingLeft), px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom));
      let joy = false;
      try { joy = localStorage.getItem('d37_cell_joystick') === '1'; } catch (e) { /* storage off */ }
      st.app.game_set_joystick(joy);
    } catch (e) { /* numbers only */ }
  }
  const paused = () => { try { return game && st.app.game_paused(); } catch (e) { return false; } };
  // W9 keys: our own release of the pointer lock (a menu, the wardrobe) is not the player's Esc
  let selfRelease = false, hadLock = false, pauseAt = -1e9;
  const unlock = () => { if (document.pointerLockElement === canvas) { selfRelease = true; try { document.exitPointerLock(); } catch (e) { /* gone */ } } };
  const send = (m) => {
    if (!st.app) return false;
    try { st.app.host_in(JSON.stringify(Object.assign({ v: BRIDGE }, m))); return true; } catch (e) { emit({ t: 'error', code: 'host_in', msg: String(e).slice(0, 200) }); return false; }
  };
  if (o.session) send(Object.assign({ t: 'session' }, o.session));
  if (o.look && (o.look.text || o.look.body)) send({ t: 'look', body: o.look.body || '', text: o.look.text || '' });
  if (o.wardrobe || studio) send({ t: 'wardrobe', on: true });

  // ── input: the held keys -> one action state (the same as the engine's test page d37-page.js) ──
  const BTN = { run: 1, jump: 2, crouch: 4, fly: 8, orbit: 16, act: 32, use: 64 };
  let fly = false, third = true, body = (o.look && o.look.body) || 'girl', touchJump = false, touchCrouch = false, orbitHeld = false;
  const stick = { id: -1, x0: 0, y0: 0, sx: 0, sy: 0 }, look = { id: -1, x: 0, y: 0 };
  const NEXT_BODY = { girl: 'boy', boy: 'mannequin', mannequin: 'girl' };
  const keys = st.keys;
  function publish() {
    if (!st.app) return;
    if (!st.inputOn || studio || paused()) { st.app.set_move(0, 0, 0); return; }
    const k = (c) => keys.has(c);
    let fw = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    let sx = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    let b = 0;
    if (stick.id !== -1) { sx += stick.sx; fw += stick.sy; if (Math.hypot(stick.sx, stick.sy) > 0.9) b |= BTN.run; }
    sx = Math.max(-1, Math.min(1, sx)); fw = Math.max(-1, Math.min(1, fw));
    if (touchJump || k('Space')) b |= BTN.jump;
    if (k('ShiftLeft') || k('ShiftRight')) b |= BTN.run;
    if (touchCrouch || k('ControlLeft') || k('ControlRight') || k('KeyC')) b |= BTN.crouch;
    if (fly) b |= BTN.fly;
    if (planet && (!game || creative) && (orbitHeld || k('KeyO'))) b |= BTN.orbit;
    if (game && (mouse.act || k('KeyE'))) b |= BTN.act;
    if (game && mouse.use) b |= BTN.use;
    st.app.set_move(sx, fw, b);
  }
  const run = (cmd) => { try { const r = st.app.admin(cmd); const m = /^character (\w+)$/.exec(cmd); if (m) body = m[1]; return r; } catch (e) { return 'отказ: ' + e; } };
  // typing in the page (chat, search) is never game input
  const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); };
  const live = () => !st.paused && !st.dead && st.inputOn && !typing();
  // W9 keys: Esc and F1–F11 are the game's while it is live (F12 stays the browser's: developer tools)
  const GAME_FKEY = /^(Escape|F[1-9]|F1[01])$/;
  // ── fullscreen with the keyboard lock (F11, the pause menu, the page's own fullscreen button) ──
  const fsEl = o.fullscreenEl || root;
  const kb = typeof navigator !== 'undefined' && navigator.keyboard && navigator.keyboard.lock ? navigator.keyboard : null;
  const LOCK_KEYS = ['Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11'];
  function toggleFull() {
    const d = document;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) { const x = d.exitFullscreen || d.webkitExitFullscreen; if (x) { const p = x.call(d); if (p && p.catch) p.catch(() => {}); } return; }
      const f = fsEl.requestFullscreen || fsEl.webkitRequestFullscreen;
      if (f) { const p = f.call(fsEl, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); }
    } catch (e) { /* no fullscreen here */ }
  }
  let fsHinted = false;
  try { fsHinted = localStorage.getItem('d37_fs_hint') === '1'; } catch (e) { /* storage off */ }
  on(document, 'fullscreenchange', () => {
    const f = document.fullscreenElement;
    if (f && f.contains(canvas)) {
      if (kb) { try { const p = kb.lock(LOCK_KEYS); if (p && p.catch) p.catch(() => {}); } catch (e) { /* not allowed here */ } }
      if (!fsHinted) {
        fsHinted = true;
        try { localStorage.setItem('d37_fs_hint', '1'); } catch (e) { /* storage off */ }
        say(kb ? 'Esc теперь у игры (пауза). Выйти из полного экрана — удерживай Esc' : 'Выйти из полного экрана — Esc');
      }
    } else if (kb) { try { kb.unlock(); } catch (e) { /* not locked */ } }
  });
  // a short line in the hint pill (the hint pill already exists below; set later)
  let say = () => {};
  let shotWanted = false;
  st.shots = [];
  // R-LATE-1120-01: the profiler's КОПИРОВАТЬ: the «ЗАМЕР» report to the clipboard (local only, nothing is sent)
  function copyReport() {
    let text = '';
    try { text = String(st.app.prof_report()); } catch (e) { return; }
    const fallback = () => { try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); } catch (e) { /* no clipboard */ } };
    try { navigator.clipboard.writeText(text).catch(fallback); } catch (e) { fallback(); }
  }
  function acts() {
    if (!game) return;
    for (let i = 0; i < 8; i++) {
      let a = '';
      try { a = st.app.game_act(); } catch (e) { return; }
      if (!a) return;
      if (a === 'camera') { third = !third; st.app.set_third_person(third); }
      else if (a === 'fullscreen') toggleFull();
      else if (a === 'shot') shotWanted = true;
      else if (a === 'copy') copyReport();
      else if (a === 'exit') { unlock(); emit({ t: 'exit' }); }
    }
  }
  // the browser took the mouse back (Esc outside fullscreen never reaches the page): the game's pause menu opens
  on(document, 'pointerlockchange', () => {
    const lockedNow = document.pointerLockElement === canvas;
    if (!lockedNow && hadLock && !selfRelease && game && live() && !menuOpen() && !wardrobeShown) {
      try { st.app.game_pause(true); pauseAt = performance.now(); keys.clear(); publish(); hint.style.opacity = '0'; } catch (e) { /* the world is gone */ }
    }
    if (lockedNow) selfRelease = false;
    hadLock = lockedNow;
    if (!lockedNow) selfRelease = false;
  });
  // look-fix: a turn the page means exactly (keys, the lift after a landing) skips the engine's spike filter
  const turn = (dx, dy) => { if (st.app.turn_look) st.app.turn_look(dx, dy); else st.app.add_look(dx, dy); };
  on(window, 'keydown', (e) => {
    if (!live() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    // F5 never reloads the site, F1 never opens the browser's help, F3 never its search, F11 is ours
    if (GAME_FKEY.test(e.code)) e.preventDefault();
    // the same Esc that released the pointer lock (and opened the pause through pointerlockchange) does not close it
    if (e.code === 'Escape' && performance.now() - pauseAt < 400) { e.stopPropagation(); return; }
    if (!e.repeat && !game) {
      // scenes without the game layer: F5 = the view, F11 = our fullscreen
      if (e.code === 'F5') { third = !third; st.app.set_third_person(third); }
      if (e.code === 'F11') toggleFull();
    }
    if (!e.repeat) {
      if (e.code === 'KeyV' && !paused()) { third = !third; st.app.set_third_person(third); }
      if (!paused()) {
        if (e.code === 'KeyF') fly = !fly;
        if (e.code === 'KeyG' && !game) run('character ' + (NEXT_BODY[body] || 'girl')); // in a game G drops (inv-fix)
        if (e.code === 'KeyB') send({ t: 'wardrobe', on: !wardrobeShown });
      }
      // the game takes digits, R, Q / I, T, Esc in a menu (a menu frees the mouse)
      if (game) {
        try {
          const was = paused();
          if (st.app.game_key(e.code)) { if (menuOpen()) unlock(); e.preventDefault(); }
          acts();
          if (paused()) hint.style.opacity = '0';   // the start hint never sits over the pause menu
          // Esc / ПРОДОЛЖИТЬ from the keyboard: the mouse goes back to the game (a key press is a user gesture)
          if (was && !menuOpen() && !touch && !wardrobeShown && document.pointerLockElement !== canvas && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (er) { /* dragging works */ } }
        } catch (er) { /* not a game key */ }
      }
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
  on(canvas, 'click', () => { canvas.focus({ preventScroll: true }); if (!touch && !cellMode && !wardrobeShown && !menuOpen() && document.pointerLockElement !== canvas && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* dragging works */ } } });
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
  on(window, 'mouseup', (e) => { drag = false; if (hudMouse) { hudMouse = false; if (game) { const [x, y] = toCanvas(e); st.app.game_pointer(x, y, 2, 1); acts(); publish(); } return; } if (game) { if (e.button === 0) mouse.act = false; if (e.button === 2) mouse.use = false; publish(); } });
  on(canvas, 'wheel', (e) => { e.preventDefault(); st.app.zoom_by(-e.deltaY / (e.deltaMode === 1 ? 3 : 100)); }, { passive: false });
  on(window, 'mousemove', (e) => {
    if (!live()) return;
    if (menuOpen() || cellMode) { const [x, y] = toCanvas(e); st.app.game_pointer(x, y, 1, 1); return; } // ep32: in a mode the cursor steers with no button held
    if (document.pointerLockElement === canvas || drag) st.app.add_look(e.movementX, e.movementY);
  });

  // buttons over the canvas (touch first; the mouse can use them too): jump, orbit <-> ground, wardrobe
  const button = (cls, text, title) => { const b = add(el('button', 'd37h-btn ' + cls + (game ? ' d37h-game' : ''), text)); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); return b; };
  const hold = (b, set) => {
    const h = (v) => (e) => { e.preventDefault(); e.stopPropagation(); set(v); publish(); };
    b.addEventListener('pointerdown', h(true));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, h(false));
  };
  if (touch && !studio) {
    const bWard = button('d37h-ward', '👕', 'Гардероб');
    bWard.addEventListener('click', (e) => { e.stopPropagation(); send({ t: 'wardrobe', on: !wardrobeShown }); });
  }
  // ep11 publish: the creative world has the game layer (creative rules) and still flies back up with one button
  if (planet && (!game || creative)) hold(button('d37h-orbit', '🌍', 'Орбита ↔ земля (O)'), (v) => { orbitHeld = v; });
  if (touch) {
    if (!studio) hold(button('d37h-jump', '⤒', 'Прыжок'), (v) => { touchJump = v; });
    // ep11-fix-body (CHECK-BODY 2): the touch prompts say «ПРИСЕСТЬ: СЛЕЗТЬ / СПРЫГНУТЬ», the roll needs crouch at the
    // landing, and the creative world flies (F on a PC): a held crouch disc and a fly toggle
    if (!studio) hold(button('d37h-crouch', '⤓', 'Присесть / слезть (C)'), (v) => { touchCrouch = v; });
    if (o.scene === 'creative') {
      const bFly = button('d37h-fly', '🕊', 'Полёт (F)');
      bFly.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fly = !fly; bFly.classList.toggle('on', fly); publish(); });
    }
    const R = 56;
    const hudTouch = new Set();
    on(canvas, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      if (game) { const [x, y] = toCanvas(e); if (st.app.game_pointer(x, y, 0, e.pointerId)) { hudTouch.add(e.pointerId); acts(); publish(); return; } }
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
    ? (touch ? 'Слева — идти · справа — смотреть' : 'Щелчок — управление · Tab — действия')
    : touch
    ? (planet ? 'Слева — идти / лететь · справа — смотреть · 🌍 — на землю и обратно · 👕 — гардероб' : 'Слева — идти · справа — смотреть')
    : 'Нажми на картинку — мышь смотрит · W A S D — идти · Пробел — прыжок · O — на землю и обратно · B — гардероб · V — вид'));
  if (game) hint.style.bottom = 'calc(105px + env(safe-area-inset-bottom))';
  setTimeout(() => { hint.style.opacity = '0'; }, 9000);
  let sayT = 0;
  say = (t) => { hint.textContent = t; hint.style.opacity = '1'; clearTimeout(sayT); sayT = setTimeout(() => { hint.style.opacity = '0'; }, 5000); };

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
      if (document.pointerLockElement === canvas) unlock(); else if (document.pointerLockElement) document.exitPointerLock();
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
    // the page's own panic text, only when it is new (one wasm instance serves every start of this page) and the
    // failure is the page's (a world Worker's error carries its own panic text)
    let panic = '';
    if (code !== 'world-worker') { try { panic = last_panic(); } catch (er) { /* the instance is gone */ } if (panic === st.panic0) panic = ''; }
    st.dead = true;
    cancelAnimationFrame(st.raf);
    log('CRASH ' + code + ': ' + (panic || st.error));
    // the world Worker stops with the page's world (it would keep ticking a world nobody draws)
    if (st.worldWorker) { try { st.worldWorker.terminate(); } catch (er) { /* gone */ } }
    const c = st.config || {};
    st.crash = { code, panic: (panic || st.error).slice(0, 600), build: String(o.build || (o.config && o.config.build) || ''), config: c.hash || '', rules: c.rules_hash || '', world: st.world || '', backend: st.backend || '', log: st.log.slice(-20) };
    showCrash(code);
    emit({ t: 'error', code, msg: (panic || st.error).slice(0, 300), crash: st.crash });
  }
  // the message over the stopped game: short, Russian, one button (text through textContent only)
  function showCrash(code) {
    if (st.disposed || o.crashUi === false) return;
    const box = add(el('div', 'd37h-crash'));
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:absolute;inset:0;z-index:6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;background:rgba(8,10,16,.82);color:#fff;font:15px/1.4 system-ui,sans-serif;text-align:center';
    const lost = code === 'context-lost';
    box.appendChild(el('div', '', lost ? 'Видеокарта сбросила картинку' : 'Игра остановилась из-за ошибки')).style.cssText = 'font-weight:700;font-size:19px';
    box.appendChild(el('div', '', lost ? 'Так бывает, если не хватает памяти. Мир сохранён до ошибки — перезагрузи, и продолжим.' : 'Мы уже получили отчёт. Мир сохранён до ошибки — перезагрузи, и продолжим.')).style.cssText = 'max-width:420px;opacity:.85';
    const b = el('button', 'd37h-reload', 'Перезагрузить');
    b.type = 'button';
    b.style.cssText = 'font:inherit;font-weight:700;padding:12px 22px;border-radius:12px;border:0;background:#ffb347;color:#1a1206;cursor:pointer;min-height:48px';
    b.addEventListener('click', (ev) => { ev.stopPropagation(); try { if (typeof o.onReload === 'function') o.onReload(); else location.reload(); } catch (er) { location.reload(); } });
    box.appendChild(b);
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (er) { /* not locked */ }
  }
  let dispatchPlanetJobs;
  // NET_JOIN §6 P2P: {ev:'send', link, b: base64 of [u32 len][frame]…} → handle.net.onSend(link, frame) per frame;
  // other events (role, connect, drop, closed) → handle.net.onEvent(ev)
  function p2pLine(d) {
    if (d.ev === 'send') {
      if (typeof st.p2pSend !== 'function') return;
      let bin = '';
      try { bin = atob(String(d.b || '')); } catch (e) { return; }
      const b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      const v = new DataView(b.buffer);
      for (let o = 0; o + 4 <= b.length;) {
        const n = v.getUint32(o, true); o += 4;
        if (o + n > b.length) break;
        try { st.p2pSend(d.link >>> 0, b.slice(o, o + n)); } catch (e) { console.warn('d37 host: p2p send', e); }
        o += n;
      }
      return;
    }
    try { if (typeof st.p2pEvent === 'function') st.p2pEvent(d); } catch (e) { console.warn('d37 host: p2p event', e); }
  }
  function frame(now) {
    st.raf = 0;
    if (st.dead || st.paused || !st.app) return;
    const a = st.app;
    // a world Worker that died without a word (killed for memory): no frame for o.worldTimeoutMs while the game runs
    if (ww && st.worldAt && now - st.worldAt > (o.worldTimeoutMs || 20000) && document.visibilityState !== 'hidden') { fail('world-worker', 'no world frame for ' + Math.round((now - st.worldAt) / 1000) + ' s'); return; }
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
        dispatchPlanetJobs ??= planetJobs(a, st.pool);
        dispatchPlanetJobs(idle, st.loaded);
      } else if (idle.length) {
        const jobs = a.take_jobs(idle.length);
        for (let i = 0; i * 4 < jobs.length; i++) { idle[i].busy = true; idle[i].w.postMessage({ type: 'job', cx: jobs[i * 4], cz: jobs[i * 4 + 1], lo: jobs[i * 4 + 2] >>> 0, hi: jobs[i * 4 + 3] >>> 0 }); }
      }
      if (st.debugPanic) { st.debugPanic = false; wasmApi.debug_panic('page'); }
      a.frame(now);
      st.frames++;
      // ep13-worker: this frame's action state and commands to the world's thread
      if (ww) { const b = a.world_out(); if (b.length) ww.postMessage({ type: 'in', bytes: b.buffer }, [b.buffer]); }
      if (shotWanted) { shotWanted = false; takeShot(); }
      const out = a.host_out();
      if (out) {
        for (const m of JSON.parse(out)) {
          // NET_JOIN §6 P2P: the engine's room frames for the page's data channels, its events (never logged per frame)
          if (m.t === 'mode' && m.data && m.data.kind === 'p2p') { p2pLine(m.data); continue; }
          if (m.t === 'loaded') { st.loaded = true; try { const p = JSON.parse(a.planet_stats()); if (planet && p.alt < 100) levelLook(-12); } catch (e) { /* numbers only */ } spawnOnce(); }
          if (m.t === 'event' && m.code === 'landed') levelLook(-12);
          if (m.t === 'wardrobe') syncPanel(m.on);
          if (m.t !== 'look_changed') log('engine: ' + m.t + (m.code ? ' ' + m.code : '') + (m.why ? ' ' + m.why : ''));
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
      if (game) { try { a.game_set_fps(st.fps); } catch (e) { /* numbers only */ } cellSync(); }
      if (!st.loaded && planet) { try { const p = JSON.parse(a.planet_stats()); progress('world', p.shown || 0, (p.shown || 0) + (p.queued || 0) + (p.ready || 0)); } catch (e) { /* numbers only */ } }
    }
    st.raf = requestAnimationFrame(frame);
  }
  // W9 keys, F2: a PNG of the frame just drawn into the page's gallery (onMessage {t:'shot'}); never a download
  function takeShot() {
    try {
      const w = canvas.width, h = canvas.height;
      canvas.toBlob((b) => {
        if (!b) { say('Снимок не получился'); return; }
        st.shots.push(b); if (st.shots.length > 8) st.shots.shift();
        say('📸 Снимок — в галерее');
        emit({ t: 'shot', blob: b, w, h });
      }, 'image/png');
    } catch (e) { say('Снимок не получился'); }
  }
  // W8 hub: the world is there — a new world / the shortcut / the spawn choice, once, through the admin path (§5.2)
  let spawned = false;
  function spawnOnce() {
    if (spawned || !game) return;
    spawned = true;
    // EP8 fix (play check): «Играть» with no world yet starts the path from the cell, like «Новый мир»
    const fresh = o.scene === 'valley' && !(o.save && o.save.length) && !o.skipTribe && o.spawn !== 'orbit' && !o.arena;
    const cmds = o.newWorld || fresh ? ['game progress new'] : o.skipTribe ? ['game progress skip tribe'] : o.spawn === 'orbit' ? ['travel orbit'] : o.spawn === 'home' ? ['game place goto home_valley'] : [];
    // w11 kit-port: an old site game as an engine mode, started in the player's world (only known modes; the realm
    // comes from the bridge session: an adult arena only for a verified adult)
    if (o.arena === 'klet2') cmds.push('game klet2 play');
    if (o.arena === 'hole2') cmds.push('game hole2 play');
    if (o.arena === 'umode') cmds.push('game umode play'); // ep35: a mode made only of data (assets/modes)
    if (typeof o.modeText === 'string' && CHECK(o.modeText).ok) cmds.push(MODE_CMD(o.modeText)); // ep36: a person's own file
    if (o.arena === 'klet') cmds.push(o.session && o.session.realm === 'adult' && o.session.band === 'adult' ? 'game klet play adult' : 'game klet play');
    for (const c of cmds) { const r = run(c); if (typeof r === 'string' && /^отказ|error|no such/i.test(r)) emit({ t: 'error', code: 'spawn', msg: (c + ': ' + r).slice(0, 200) }); }
    // NET_JOIN: straight into a game session (a lobby pick, an invite link ?game=klet2&s=<id>, quick play)
    if (o.joinSession && o.joinSession.url && o.joinSession.game && o.joinSession.id && typeof st.app.join_session === 'function') {
      try { st.app.join_session(String(o.joinSession.url), String(o.joinSession.game), String(o.joinSession.id), ''); emit({ t: 'event', code: 'net_join' }); } catch (e) { emit({ t: 'error', code: 'join', msg: String(e && e.message || e).slice(0, 200) }); }
    }
    // W11 net-shards: «Играть вместе» — the shared world by its code; an older engine build without join_code plays alone
    if (o.join && o.join.url && o.join.code) {
      try {
        if (typeof st.app.join_code === 'function') { st.app.join_code(String(o.join.url), String(o.join.code), ''); emit({ t: 'event', code: 'net_join' }); }
        else emit({ t: 'error', code: 'join', msg: 'engine build without join_code' });
      } catch (e) { emit({ t: 'error', code: 'join', msg: String(e && e.message || e).slice(0, 200) }); }
    }
  }
  publish();
  on(document, 'visibilitychange', () => st.app?.reset_frame_clock?.());
  st.raf = requestAnimationFrame(frame);

  // EP14-config live: the files again when the tab comes back and every o.config.poll ms (default 5 min); a changed
  // text is applied at once (LOOK keys; the RULE keys wait for the next world start)
  let polling = false;
  async function pollConfig() {
    if (polling || st.dead || !o.config || typeof wasmApi.config_apply !== 'function') return;
    polling = true;
    try {
      const got = await fetchLayers(o.config);
      if (st.dead) return;
      const json = layersJson(got);
      if (json === st.cfgJson) return;
      st.cfgLayers = got; st.cfgJson = json;
      const rep = applyConfig(false);
      if (ww) ww.postMessage({ type: 'config', config: json });
      if (rep && rep.rules_pending) log('config: RULE values changed — at the next start');
    } catch (e) { log('config poll: ' + String(e).slice(0, 100)); } finally { polling = false; }
  }
  st.pollConfig = pollConfig;
  if (o.config && o.config.poll !== 0) {
    on(document, 'visibilitychange', () => { if (document.visibilityState === 'visible') pollConfig(); });
    st.timers.push(setInterval(pollConfig, Math.max(30000, +o.config.poll || 300000)));
  }

  const handle = {
    state: st,
    send,
    // the player's game as bytes (bridge::SaveV1); empty when the engine is gone
    save() { try { return st.app && !st.dead ? st.app.save() : new Uint8Array(0); } catch (e) { return new Uint8Array(0); } },
    stats() { try { return st.app ? JSON.parse(st.app.stats()) : null; } catch (e) { return null; } },
    // EP7: the game's numbers (items, parts, saves...; null without a game layer)
    gameStats() { try { return st.app && game ? JSON.parse(st.app.game_stats()) : null; } catch (e) { return null; } },
    hitchStats() { return st.app?.hitch_stats ? JSON.parse(st.app.hitch_stats()) : []; },
    // a DOM sheet over the world (chat, menu): the keys stop reaching the game
    input(enabled) { st.inputOn = !!enabled; if (!enabled) { keys.clear(); unlock(); } publish(); },
    pause() { if (st.paused || st.dead) return; st.paused = true; if (ww) ww.postMessage({ type: 'pause' }); keys.clear(); publish(); try { st.app && st.app.audio_park(true); } catch (e) { /* no sound */ } cancelAnimationFrame(st.raf); st.raf = 0; unlock(); },
    // W9 keys: the pictures F2 took this run (newest last, at most 8; Blob PNG)
    shots() { return st.shots.slice(); },
    // W9 keys: the game's pause menu (the page opens it e.g. when its own sheet closes)
    pauseMenu(on) { if (game && st.app && !st.dead) { try { st.app.game_pause(!!on); if (on) unlock(); publish(); } catch (e) { /* gone */ } } },
    // tests: force a crash — 'page' (a panic in the page's wasm), 'worker' (a panic in the world Worker), 'kill' (the
    // Worker terminated without a word: the watchdog notices)
    debugCrash(kind) { if (kind === 'page') st.debugPanic = true; else if (kind === 'worker' && ww) ww.postMessage({ type: 'debug_panic' }); else if (kind === 'kill' && ww) { try { ww.terminate(); } catch (e) { /* gone */ } } },
    config() { return st.config; },
    // ep36 arena editor: the engine's own checker ({ok, error, warnings, hash, counts}); runMode = check, then the file
    // goes to the engine and the round restarts with it (solo; no page reload). A refused file is not sent.
    checkMode(text) { return CHECK(text); },
    runMode(text) { const r = CHECK(text); if (r.ok && st.app && !st.dead) { const a = run(MODE_CMD(text)); if (typeof a === 'string' && /^отказ/.test(a)) return { ok: false, error: a.slice(0, 300) }; } return r; },
    // NET_JOIN (d37-core/spec/NET_JOIN.md): sessions of the game modes on our d37-server. server = 'ws://host:7377'
    // (or wss:// behind the TLS proxy); the HTTP list is the same host. The engine emits {t:'mode', data:{kind:
    // 'presence'|'meta', …}} messages: presence = where the player is / can friends join; meta = records,
    // achievements, XP, season goals (the site's server decides any coins).
    lobby: {
      httpOf(server) { return String(server).replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, ''); },
      async list(server, game) { const r = await fetch(handle.lobby.httpOf(server) + '/sessions' + (game ? '?game=' + encodeURIComponent(game) : ''), { cache: 'no-store' }); return r.json(); },
      async quick(server, game) { const r = await fetch(handle.lobby.httpOf(server) + '/quick?game=' + encodeURIComponent(game), { cache: 'no-store' }); return r.json(); },
      join(server, game, id, nick) { if (!st.app || st.dead) return false; st.app.join_session(String(server), String(game), String(id), String(nick || '')); return true; },
      joinCode(server, code, nick) { if (!st.app || st.dead) return false; st.app.join_code(String(server), String(code), String(nick || '')); return true; },
      async quickPlay(server, game, nick) { const q = await handle.lobby.quick(server, game); handle.lobby.join(server, game, q.id, nick); return q; },
      // host powers (the server takes them from the session's host only): meta(vis, mode, map, ages, name), limit(n), kick(peer)
      meta(game, vis, mode, map, ages, name) { return run('game ' + game + ' lobby meta ' + [vis || 'open', mode || game, map || '-', ages || 'all', String(name || '').replace(/[;\s]+/g, '_')].join(' ')); },
      limit(game, n) { return run('game ' + game + ' lobby limit ' + (n | 0)); },
      kick(game, peer) { return run('game ' + game + ' kick ' + (peer | 0)); },
      state() { try { const s = st.app && st.app.mode_state(); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
      rejoinKey(k) { try { st.app && st.app.set_rejoin_key(k >>> 0); } catch (e) { /* older build */ } },
      leave(game) { if (game) run('game ' + game + ' quit'); try { st.app && st.app.leave(); } catch (e) { /* gone */ } },
    },
    // NET_JOIN §6 P2P (d37-core/spec/NET_JOIN.md): a session with NO game server. The page owns the WebRTC data channels
    // (ordered, reliable) and its signalling; the engine orders the room on the host's page and follows it elsewhere.
    // tag = this page's random id; link = the page's number for one remote page (a data channel). onSend(fn(link,
    // bytes)) — send these bytes on that link as one message; onEvent(fn(ev)) — {ev:'role', role:'host'} (this page
    // hosts now: a migration), {ev:'connect', tag, peer} (the room's new host: open a channel to it), {ev:'drop'},
    // {ev:'closed', why}. state() — {role, me, host, hostTag, code, people, migrations, desync} (null without a room).
    net: {
      ok() { return !!(st.app && typeof st.app.p2p_start === 'function'); },
      host(game, code, nick, tag) { if (!st.app || st.dead) return false; st.app.p2p_start(String(game), String(code), String(nick || ''), String(tag), ''); return true; },
      join(game, code, nick, tag, hostTag) { if (!st.app || st.dead) return false; st.app.p2p_start(String(game), String(code), String(nick || ''), String(tag), String(hostTag)); return true; },
      peerJoined(link, tag) { try { st.app && st.app.p2p_link_up(link >>> 0, String(tag)); } catch (e) { /* gone */ } },
      peerLeft(link) { try { st.app && st.app.p2p_link_down(link >>> 0); } catch (e) { /* gone */ } },
      deliver(link, bytes) { try { st.app && st.app.p2p_deliver(link >>> 0, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); } catch (e) { /* gone */ } },
      failed(tag) { try { st.app && st.app.p2p_failed(String(tag)); } catch (e) { /* gone */ } },
      onSend(fn) { st.p2pSend = fn; },
      onEvent(fn) { st.p2pEvent = fn; },
      state() { const s = handle.lobby.state(); return s && s.p2p ? s.p2p : null; },
      leave(game) { handle.lobby.leave(game); },
    },
    resume() { if (!st.paused || st.dead) return; st.paused = false; st.app?.reset_frame_clock?.(); st.worldAt = performance.now(); if (ww) ww.postMessage({ type: 'resume' }); try { st.app && st.app.audio_park(false); } catch (e) { /* no sound */ } last = performance.now(); if (!st.raf) st.raf = requestAnimationFrame(frame); },
    // everything this start made goes away: the frame loop, listeners, Workers, the GPU device (free), the DOM
    dispose() {
      if (st.disposed) return;
      st.disposed = true; st.dead = true;
      cancelAnimationFrame(st.raf); st.raf = 0;
      for (const t of st.timers) clearInterval(t);
      st.timers.length = 0;
      unlock();
      if (kb) { try { kb.unlock(); } catch (e) { /* not locked */ } }
      for (const [t, ev, f, opt] of st.listeners) t.removeEventListener(ev, f, opt);
      st.listeners.length = 0;
      for (const s of st.pool) { try { s.w.terminate(); } catch (e) { /* gone */ } }
      st.pool.length = 0;
      if (ww) { try { ww.terminate(); } catch (e) { /* gone */ } ww = null; st.worldWorker = null; }
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
