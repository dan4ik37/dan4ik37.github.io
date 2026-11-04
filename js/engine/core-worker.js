// ═══════════════════════════════════════
//  D37 CORE — worker (C-002): the shared core d37-core runs here, single-threaded, off the page's main thread
// ═══════════════════════════════════════
// new Worker('js/engine/core-worker.js?v=…') (D37CoreWorld.host) — loads d37core.js + core-world.js with the same ?v= and serves the
// protocol of core-world.js § "2) worker transport" (postMessage with transferable ArrayBuffers; no SharedArrayBuffer, so the page
// needs no COOP / COEP and ads keep working). The wasm missing, broken or of another ABI → the JS core inside the worker (bit-exact).
// Also listed as a plain <script> in the game's file list (cached with the game) — does nothing in a window.
(function () {
  if (typeof window !== 'undefined' || typeof importScripts !== 'function') return;
  var q = (self.location && self.location.search) || '';
  importScripts('d37core.js' + q, 'core-world.js' + q);
  self.D37CoreWorld.serve(self);
})();
