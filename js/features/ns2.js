// ═══════════════════════════════════════
//  🧠 СИЛЬНЫЙ ШУМОДАВ МИКРОФОНА (T-169, ns2) — выключен (NS2_ON)
// ═══════════════════════════════════════
// Владелец 19.11: «шумодав можно сделать в движок в микрофон, чтобы работал и на сайте». Модуль движка d37-ns (Rust, RNNoise через
// крейт nnnoiseless, BSD-3-Clause; исходники — локальный репозиторий M:\d37\d37-audio, его же возьмёт RustOBS) собран в
// js/features/d37-ns.wasm; здесь — подключение: микрофон → AudioWorklet (ns2-worklet.js) → очищенный звук → в звонок.
// Обработка только на этом устройстве, звук никуда дополнительно не уходит. Задержка — один кадр 10 мс (+ блок браузера 2,7 мс).
// Флаг: NS2_ON (выключено). Попробовать заранее: localStorage d37_ns2 = '1' (тогда в «🎛 Проверка» появится переключатель).
// D37NS2.wrap(stream) → { stream, stop(), stats(), set({ on, wet }) } | null (не вышло — звонок идёт с обычным микрофоном).
// D37NS2.bench(frames) → { msPerFrame, maxMs } — замер скорости на главном потоке (тот же wasm).
(() => {
  'use strict';
  if (window.D37NS2) return;
  let lab = false; try { lab = localStorage.getItem('d37_ns2') === '1'; } catch (er) {}
  const NS2_ON = false || lab;
  const VER = '1';
  const NS = window.D37NS2 = { on: NS2_ON, VER };
  if (!NS2_ON) return;
  let modP = null;
  const mod = () => modP || (modP = fetch('js/features/d37-ns.wasm?v=' + VER).then(r => { if (!r.ok) throw new Error('wasm ' + r.status); return r.arrayBuffer(); }).then(b => WebAssembly.compile(b)));
  NS.supported = () => typeof AudioWorkletNode === 'function' && typeof WebAssembly === 'object';
  NS.wrap = async stream => {
    if (!NS.supported() || !stream?.getAudioTracks?.().length) return null;
    let ctx = null;
    try {
      const m = await mod();
      ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      await ctx.audioWorklet.addModule('js/features/ns2-worklet.js?v=' + VER);
      const src = ctx.createMediaStreamSource(stream), node = new AudioWorkletNode(ctx, 'd37-ns2', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const dst = ctx.createMediaStreamDestination();
      const ready = new Promise(res => { const t = setTimeout(() => res(false), 4000); node.port.onmessage = e => { if ('ready' in (e.data || {})) { clearTimeout(t); res(!!e.data.ready); } }; });
      node.port.postMessage({ module: m });
      src.connect(node); node.connect(dst);
      if (!await ready) { ctx.close().catch(() => {}); return null; }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const out = dst.stream, tr = out.getAudioTracks()[0];
      return {
        stream: out, ctx, node,
        set: o => node.port.postMessage(o || {}),
        stats: () => new Promise(res => { const t = setTimeout(() => res(null), 1000); node.port.onmessage = e => { if (e.data?.stats) { clearTimeout(t); res(e.data.stats); } }; node.port.postMessage({ stats: 1 }); }),
        stop: () => { try { tr.stop(); src.disconnect(); node.disconnect(); } catch (er) {} ctx.close().catch(() => {}); },
      };
    } catch (er) { try { ctx?.close(); } catch (e2) {} console.warn('ns2', er); return null; }
  };
  NS.bench = async (frames = 1000) => {
    const inst = await WebAssembly.instantiate(await mod(), {}), x = inst.exports, p = x.ns_new(), N = x.ns_frame();
    let seed = 1; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
    let max = 0, sum = 0;
    for (let k = 0; k < frames; k++) {
      const b = new Float32Array(x.memory.buffer, x.ns_buf(p), N);
      for (let i = 0; i < N; i++) b[i] = 0.2 * Math.sin((k * N + i) * 2 * Math.PI * 220 / 48000) + 0.05 * rnd();
      const a = performance.now(); x.ns_process(p); const d = performance.now() - a; sum += d; if (d > max) max = d;
    }
    const ms = sum / frames;
    x.ns_free(p);
    return { msPerFrame: +ms.toFixed(4), maxMs: +max.toFixed(3), frameMs: 10, N };
  };
})();
