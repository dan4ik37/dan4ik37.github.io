// ═══════════════════════════════════════
//  🖼 ФОТОРЕДАКТОР — тяжёлая работа в потоке (Worker): открыть и уменьшить фото, сохранить в PNG/JPEG/WebP, статистика для
//  автоулучшения, качественное уменьшение слоя. Страница при этом не замирает; картинки ходят туда-обратно без копий
//  (ImageBitmap — transferable). Нет OffscreenCanvas (старый iPhone) — photo-core.js делает то же в странице.
// ═══════════════════════════════════════
'use strict';
const fit = (w, h, maxSide, maxPixels) => {
  let k = Math.min(1, maxSide / Math.max(w, h));
  if (maxPixels && w * h * k * k > maxPixels) k = Math.min(k, Math.sqrt(maxPixels / (w * h)));
  return k >= 1 ? { w, h, k: 1 } : { w: Math.max(1, Math.floor(w * k)), h: Math.max(1, Math.floor(h * k)), k };
};
// Уменьшить качественно: по половине, пока больше чем вдвое, последний шаг — «высокое» сглаживание
async function shrink(bmp, w, h){
  let cur = bmp, cw = bmp.width, ch = bmp.height;
  while (cw / 2 >= w * 1.05 && ch / 2 >= h * 1.05) {
    const nw = Math.max(w, Math.round(cw / 2)), nh = Math.max(h, Math.round(ch / 2));
    const nb = await createImageBitmap(cur, { resizeWidth: nw, resizeHeight: nh, resizeQuality: 'medium' });
    if (cur !== bmp) cur.close();
    cur = nb; cw = nw; ch = nh;
  }
  const out = await createImageBitmap(cur, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  if (cur !== bmp) cur.close();
  return out;
}

const jobs = {
  // { blob, maxSide, maxPixels } → { bitmap, w0, h0, w, h, scaled }
  async decode(d){
    const bmp = await createImageBitmap(d.blob, { imageOrientation: 'from-image' });
    const w0 = bmp.width, h0 = bmp.height, f = fit(w0, h0, d.maxSide || 4096, d.maxPixels || 0);
    if (f.k >= 1) return { out: { bitmap: bmp, w0, h0, w: w0, h: h0, scaled: false }, transfer: [bmp] };
    const small = await shrink(bmp, f.w, f.h);
    bmp.close();
    return { out: { bitmap: small, w0, h0, w: f.w, h: f.h, scaled: true }, transfer: [small] };
  },
  // { bitmap, w, h } → { bitmap } (качественно в новый размер)
  async resample(d){
    const b = d.w < d.bitmap.width && d.h < d.bitmap.height ? await shrink(d.bitmap, d.w, d.h)
      : await createImageBitmap(d.bitmap, { resizeWidth: d.w, resizeHeight: d.h, resizeQuality: 'high' });
    d.bitmap.close();
    return { out: { bitmap: b }, transfer: [b] };
  },
  // { bitmap, type, quality, bg } → { blob }; JPEG без прозрачности — подложка bg (белая)
  async encode(d){
    const w = d.bitmap.width, h = d.bitmap.height;
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
    if (d.bg) { g.fillStyle = d.bg; g.fillRect(0, 0, w, h); }
    g.drawImage(d.bitmap, 0, 0);
    d.bitmap.close();
    const blob = await c.convertToBlob({ type: d.type || 'image/png', quality: d.quality == null ? 0.92 : d.quality });
    c.width = c.height = 1;
    return { out: { blob } };
  },
  // { bitmap, specs: [[класс фильтра fabric, опции]], fabricUrl } → { bitmap } — коррекции в полный размер теми же фильтрами
  // fabric.js, что и на экране (их 2D-вариант повторяет шейдер видеокарты); fabric грузится сюда один раз (importScripts)
  async filter(d){
    if (!self.fabric) importScripts(d.fabricUrl);
    const F = self.fabric, w = d.bitmap.width, h = d.bitmap.height;
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(d.bitmap, 0, 0); d.bitmap.close();
    const st = { imageData: g.getImageData(0, 0, w, h), ctx: g, canvasEl: c, sourceWidth: w, sourceHeight: h };
    st.originalImageData = st.imageData;
    for (const [cls, o] of d.specs || []) { const f = new F.filters[cls](o); f.applyTo(st); }
    g.putImageData(st.imageData, 0, 0);
    st.imageData = st.originalImageData = null;
    const out = c.transferToImageBitmap();
    c.width = c.height = 1;
    return { out: { bitmap: out }, transfer: [out] };
  },
  // { bitmap, ortUrl, ortBase, modelUrl } → { bitmap } — маска «где предмет» 320×320 в альфе (ИИ в браузере: U²-Netp,
  // Apache-2.0, через ONNX Runtime Web, MIT). Подготовка — как у U²-Net при обучении: растянуть до 320×320, x / max(x), затем
  // (x − среднее) / отклонение ImageNet; выход — растянуть от min до max. Модель и среда грузятся один раз на поток.
  async removeBg(d){
    if (!self.ort) importScripts(d.ortUrl);
    const ort = self.ort;
    ort.env.wasm.wasmPaths = d.ortBase;
    ort.env.wasm.numThreads = 1;   // без SharedArrayBuffer (сайт не изолирован)
    if (!self.__bgSession || self.__bgModel !== d.modelUrl) {
      self.__bgSession = await ort.InferenceSession.create(d.modelUrl, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      self.__bgModel = d.modelUrl;
    }
    const S = self.__bgSession, N = 320;
    const c = new OffscreenCanvas(N, N), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(d.bitmap, 0, 0, N, N); d.bitmap.close();
    const px = g.getImageData(0, 0, N, N).data, inp = new Float32Array(3 * N * N);
    let mx = 1; for (let i = 0; i < px.length; i += 4) { if (px[i] > mx) mx = px[i]; if (px[i + 1] > mx) mx = px[i + 1]; if (px[i + 2] > mx) mx = px[i + 2]; }
    const M = [0.485, 0.456, 0.406], SD = [0.229, 0.224, 0.225];
    for (let i = 0, j = 0; i < px.length; i += 4, j++) for (let k = 0; k < 3; k++) inp[k * N * N + j] = (px[i + k] / mx - M[k]) / SD[k];
    const out = await S.run({ [S.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, N, N]) });
    const m = out[S.outputNames[0]].data;
    let lo = Infinity, hi = -Infinity; for (let j = 0; j < N * N; j++) { const v = m[j]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const img = new ImageData(N, N), a = img.data, k = hi > lo ? 255 / (hi - lo) : 0;
    for (let j = 0; j < N * N; j++) a[j * 4 + 3] = (m[j] - lo) * k;
    g.clearRect(0, 0, N, N); g.putImageData(img, 0, 0);
    const bm = c.transferToImageBitmap();
    return { out: { bitmap: bm, names: [S.inputNames[0], S.outputNames[0]] }, transfer: [bm] };
  },
  // { bitmap (уже маленький, ≤ 512) } → гистограмма яркости и средние цвета середины — для автоулучшения
  async stats(d){
    const w = d.bitmap.width, h = d.bitmap.height;
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(d.bitmap, 0, 0); d.bitmap.close();
    const px = g.getImageData(0, 0, w, h).data;
    const hist = new Uint32Array(256);
    let n = 0, sr = 0, sg = 0, sb = 0, mid = 0, sat = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      const r = px[i], gg = px[i + 1], b = px[i + 2];
      const y = (r * 54 + gg * 183 + b * 19) >> 8;   // яркость (Rec. 709 в целых)
      hist[y]++; n++;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      sat += mx ? (mx - mn) / mx : 0;
      if (y > 40 && y < 215) { sr += r; sg += gg; sb += b; mid++; }
    }
    return { out: { hist: Array.from(hist), n, avg: mid ? [sr / mid, sg / mid, sb / mid] : [128, 128, 128], sat: n ? sat / n : 0 } };
  },
};

self.onmessage = async e => {
  const { id, job, data } = e.data || {};
  try {
    if (!jobs[job]) throw new Error('нет такой работы: ' + job);
    const r = await jobs[job](data || {});
    self.postMessage({ id, ok: true, out: r.out }, r.transfer || []);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
