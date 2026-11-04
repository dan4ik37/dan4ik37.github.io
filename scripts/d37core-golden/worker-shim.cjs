// scripts/d37core-golden/worker-shim.cjs — runs a browser Worker script (js/engine/core-world.js?worker=1) inside node worker_threads for
// scripts/core-world-test.cjs: self / importScripts / postMessage / onmessage as in a dedicated Worker (transfer lists kept).
'use strict';
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm'), fs = require('fs'), path = require('path');
globalThis.self = globalThis;
globalThis.location = { search: workerData.search || '' };
globalThis.importScripts = (...names) => {
  for (const n of names) { const f = path.join(workerData.dir, String(n).split('?')[0]); vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f }); }
};
globalThis.postMessage = (m, tr) => parentPort.postMessage(m, tr || []);
parentPort.on('message', d => { if (typeof globalThis.onmessage === 'function') globalThis.onmessage({ data: d }); });
vm.runInThisContext(fs.readFileSync(workerData.script, 'utf8'), { filename: workerData.script });
