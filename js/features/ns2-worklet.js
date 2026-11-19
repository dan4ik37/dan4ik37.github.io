// T-169: сильный шумодав микрофона — AudioWorklet (js/features/ns2.js его подключает; флаг NS2_ON, по умолчанию выключено).
// Внутри — d37-ns.wasm: RNNoise на Rust (крейт nnnoiseless, BSD-3-Clause; наш модуль d37-ns — общий с RustOBS).
// Кадр 480 отсчётов при 48 кГц (10 мс); браузер даёт блоки по 128 — копим кадр, обрабатываем, отдаём с задержкой в один кадр.
// Звук никуда не уходит: обработка на этом устройстве, дальше — как обычно в звонок.
/* global registerProcessor, sampleRate */
class D37Ns2 extends AudioWorkletProcessor {
  constructor(){
    super();
    this.ok = false; this.on = true; this.wet = 1; this.N = 480;
    this.inb = new Float32Array(480); this.outb = new Float32Array(480 * 2); this.fill = 0; this.rd = 0; this.wr = 480;   // один кадр задержки
    this.frames = 0; this.vad = 0; this.busyMs = 0; this.maxMs = 0;
    this.port.onmessage = async e => {
      const d = e.data || {};
      if (d.module) {
        try {
          const inst = await WebAssembly.instantiate(d.module, {});
          const x = inst.exports; this.x = x; this.N = x.ns_frame();
          this.p = x.ns_new(); this.buf = new Float32Array(x.memory.buffer, x.ns_buf(this.p), this.N);
          this.ok = this.N === 480 && sampleRate === 48000;
          this.port.postMessage({ ready: this.ok, rate: sampleRate });
        } catch (er) { this.port.postMessage({ ready: false, err: String(er && er.message || er) }); }
      }
      if ('on' in d) this.on = !!d.on;
      if ('wet' in d && this.x) this.x.ns_mix(this.p, +d.wet);
      if (d.stats) this.port.postMessage({ stats: { frames: this.frames, vad: this.vad, busyMs: this.busyMs, maxMs: this.maxMs } });
    };
  }
  process(inputs, outputs){
    const inp = inputs[0] && inputs[0][0], out = outputs[0] && outputs[0][0];
    if (!out) return true;
    if (!inp) { out.fill(0); return true; }
    if (!this.ok || !this.on) { out.set(inp); return true; }
    const n = inp.length, N = this.N, ring = this.outb, R = ring.length;
    for (let i = 0; i < n; i++) {
      this.inb[this.fill++] = inp[i];
      if (this.fill === N) {
        if (this.buf.buffer !== this.x.memory.buffer) this.buf = new Float32Array(this.x.memory.buffer, this.x.ns_buf(this.p), N);   // память выросла
        this.buf.set(this.inb);
        const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
        this.vad = this.x.ns_process(this.p);
        if (t0) { const dt = performance.now() - t0; this.busyMs += dt; if (dt > this.maxMs) this.maxMs = dt; }
        for (let j = 0; j < N; j++) { ring[this.wr] = this.buf[j]; this.wr = (this.wr + 1) % R; }
        this.fill = 0; this.frames++;
      }
      out[i] = ring[this.rd]; ring[this.rd] = 0; this.rd = (this.rd + 1) % R;
    }
    return true;
  }
}
registerProcessor('d37-ns2', D37Ns2);
