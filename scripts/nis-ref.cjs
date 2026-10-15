// Эталон NVIDIA Image Scaling (NIS) SDK v1.0.3 на JS — для проверки переноса в шейдер (js/engine/post.js FS_NIS / FS_NIS_SHARP):
// render-test считает им свойства (ровная картинка остаётся ровной, резкость ограничена…), а в браузере тот же расчёт
// сравнивается с тем, что нарисовал шейдер на видеокарте (see scripts/render-test.cjs, раздел NIS).
// Код — по NIS/NIS_Scaler.h (NVScaler, NVSharpen; SDR), таблицы и константы — из js/engine/post.js (E.NIS, E.nisConfig).
//   The MIT License(MIT). Copyright(c) 2022 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
//   (полный текст уведомления — в js/engine/post.js)
// Картинка — Float32Array RGB (0…1), ряды снизу вверх, как texelFetch в WebGL (алгоритм задан на сетке пикселей — порядок рядов
// тот же, что у шейдера, поэтому совпадение — попиксельное).
'use strict';
function make(E){
  const S = E.NIS.scale, U = E.NIS.usm;
  const cl01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const Yof = (img, w, h, x, y) => { x = x < 0 ? 0 : x >= w ? w - 1 : x; y = y < 0 ? 0 : y >= h ? h - 1 : y; const i = (y * w + x) * 3; return .2126 * img[i] + .7152 * img[i + 1] + .0722 * img[i + 2]; };
  function edge(K, p00, p01, p02, p10, p11, p12, p20, p21, p22){
    const g0 = Math.abs(p00 + p01 + p02 - p20 - p21 - p22), g45 = Math.abs(p10 + p00 + p01 - p21 - p22 - p12);
    const g90 = Math.abs(p00 + p10 + p20 - p02 - p12 - p22), g135 = Math.abs(p10 + p20 + p21 - p01 - p02 - p12);
    const a = Math.max(g0, g90), ai = Math.min(g0, g90), b = Math.max(g45, g135), bi = Math.min(g45, g135);
    if (a + b === 0) return [0, 0, 0, 0];
    const e090 = Math.min(a / (a + b), 1), e45 = 1 - e090;
    const c090 = a > ai * K.kDetectRatio && a > K.kDetectThres && a > bi, c45 = b > bi * K.kDetectRatio && b > K.kDetectThres && b > ai;
    const cg0 = a === g0, cg45 = b === g45;
    const f090 = c090 && c45 ? e090 : 1, f45 = c090 && c45 ? e45 : 1;
    return [c090 && cg0 ? f090 : 0, c090 && !cg0 ? f090 : 0, c45 && cg45 ? f45 : 0, c45 && !cg45 ? f45 : 0];
  }
  function lti(K, a0, a1, a2, b0, b1, b2){
    const ac = Math.max(a0, a1, a2) - Math.min(a0, a1, a2), bc = Math.max(b0, b1, b2) - Math.min(b0, b1, b2);
    const r = Math.max(ac, bc) / (Math.min(ac, bc) + K.kEps);
    return (1 - cl01((r - K.kMinContrastRatio) * K.kRatioNorm)) * K.kContrastBoost;
  }
  function poly(K, x, ph){
    let y = 0, yu = 0;
    for (let i = 0; i < 6; i++) { y += S[ph * 6 + i] * x[i]; yu += U[ph * 6 + i] * x[i]; }
    const ys = 1 - cl01((y - K.kSharpStartY) * K.kSharpScaleY);
    yu *= ys * K.kSharpStrengthScale + K.kSharpStrengthMin;
    const lim = (ys * K.kSharpLimitScale + K.kSharpLimitMin) * y;
    yu = Math.min(lim, Math.max(-lim, yu));
    const sel = ph <= 32;
    yu *= lti(K, sel ? x[0] : x[3], x[1], x[2], x[3], x[4], sel ? x[2] : x[5]);
    return y + yu;
  }
  const mix = (a, b, t) => a + (b - a) * t;
  // билинейно, края — по краю (samplerLinearClamp), координаты — в пикселях входа (центр пикселя = целое)
  function bil(img, w, h, sx, sy, out){
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    for (let c = 0; c < 3; c++) {
      const at = (x, y) => { x = x < 0 ? 0 : x >= w ? w - 1 : x; y = y < 0 ? 0 : y >= h ? h - 1 : y; return img[(y * w + x) * 3 + c]; };
      out[c] = mix(mix(at(x0, y0), at(x0 + 1, y0), fx), mix(at(x0, y0 + 1), at(x0 + 1, y0 + 1), fx), fy);
    }
    return out;
  }
  // NVScaler: вход w×h → выход ow×oh
  function scale(img, w, h, ow, oh, sharpness = .5, dbg = null){
    const K = E.nisConfig(sharpness), out = new Float32Array(ow * oh * 3), p = [], op = [0, 0, 0];
    const kx = w / ow, ky = h / oh;
    for (let dy = 0; dy < oh; dy++) for (let dx = 0; dx < ow; dx++) {
      const sx = (dx + .5) * kx - .5, sy = (dy + .5) * ky - .5, fx0 = Math.floor(sx), fy0 = Math.floor(sy), fx = sx - fx0, fy = sy - fy0;
      const fxi = Math.floor(fx * 64), fyi = Math.floor(fy * 64);
      for (let i = 0; i < 6; i++) { p[i] = p[i] || []; for (let j = 0; j < 6; j++) p[i][j] = Yof(img, w, h, fx0 + j - 2, fy0 + i - 2); }
      const e = (i, j) => edge(K, p[1 + i][1 + j], p[1 + i][2 + j], p[1 + i][3 + j], p[2 + i][1 + j], p[2 + i][2 + j], p[2 + i][3 + j], p[3 + i][1 + j], p[3 + i][2 + j], p[3 + i][3 + j]);
      const e00 = e(0, 0), e01 = e(0, 1), e10 = e(1, 0), e11 = e(1, 1), wv = [0, 0, 0, 0];
      for (let c = 0; c < 4; c++) wv[c] = mix(mix(e00[c], e01[c], fx), mix(e10[c], e11[c], fx), fy);
      let hacc = 0;
      for (let j = 0; j < 6; j++) { let v = 0; for (let i = 0; i < 6; i++) v += p[i][j] * S[fyi * 6 + i]; hacc += v * S[fxi * 6 + j]; }
      let opY = hacc * (1 - wv[0] - wv[1] - wv[2] - wv[3]);
      if (wv[0] > 0) opY += poly(K, [0, 1, 2, 3, 4, 5].map(i => mix(p[i][2], p[i][3], fx)), fyi) * wv[0];
      if (wv[1] > 0) opY += poly(K, [0, 1, 2, 3, 4, 5].map(i => mix(p[2][i], p[3][i], fy)), fxi) * wv[1];
      if (wv[2] > 0) {
        let pb = .5 + .5 * (fx - fy);
        const t = [];
        t[1] = mix(p[2][1], p[1][2], pb); t[3] = mix(p[3][2], p[2][3], pb); t[5] = mix(p[4][3], p[3][4], pb);
        pb -= .5; const hi = pb >= 0, ab = Math.abs(pb);
        t[0] = mix(p[1][1], hi ? p[0][2] : p[2][0], ab); t[2] = mix(p[2][2], hi ? p[1][3] : p[3][1], ab);
        t[4] = mix(p[3][3], hi ? p[2][4] : p[4][2], ab); t[6] = mix(p[4][4], hi ? p[3][5] : p[5][3], ab);
        let pp = fx + fy;
        if (pp >= 1) { pp -= 1; opY += poly(K, t.slice(1, 7), Math.floor(pp * 64)) * wv[2]; } else opY += poly(K, t.slice(0, 6), Math.floor(pp * 64)) * wv[2];
      }
      if (wv[3] > 0) {
        let pb = .5 * (fx + fy);
        const t = [];
        t[1] = mix(p[3][1], p[4][2], pb); t[3] = mix(p[2][2], p[3][3], pb); t[5] = mix(p[1][3], p[2][4], pb);
        pb -= .5; const hi = pb >= 0, ab = Math.abs(pb);
        t[0] = mix(p[4][1], hi ? p[5][2] : p[3][0], ab); t[2] = mix(p[3][2], hi ? p[4][3] : p[2][1], ab);
        t[4] = mix(p[2][3], hi ? p[3][4] : p[1][2], ab); t[6] = mix(p[1][4], hi ? p[2][5] : p[0][3], ab);
        let pp = 1 + (fx - fy);
        if (pp >= 1) { pp -= 1; opY += poly(K, t.slice(1, 7), Math.floor(pp * 64)) * wv[3]; } else opY += poly(K, t.slice(0, 6), Math.floor(pp * 64)) * wv[3];
      }
      bil(img, w, h, sx, sy, op);
      if (dbg) dbg(dx, dy, wv, opY, fxi, fyi);
      const corr = opY - (.2126 * op[0] + .7152 * op[1] + .0722 * op[2]), o = (dy * ow + dx) * 3;
      for (let c = 0; c < 3; c++) out[o + c] = cl01(op[c] + corr);
    }
    return out;
  }
  // NVSharpen: тот же размер
  function sharpen(img, w, h, sharpness = .5){
    const K = E.nisConfig(sharpness), out = new Float32Array(w * h * 3), p = [];
    const usm = (x0, x1, x2, x3, x4, st, lim) => { let y = (-.6001 * x1 + 1.2002 * x2 - .6001 * x3) * st; y = Math.min(lim, Math.max(-lim, y)); return y * lti(K, x0, x1, x2, x2, x3, x4); };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      for (let i = 0; i < 5; i++) { p[i] = p[i] || []; for (let j = 0; j < 5; j++) p[i][j] = Yof(img, w, h, x + j - 2, y + i - 2); }
      const sc = 1 - cl01((p[2][2] - K.kSharpStartY) * K.kSharpScaleY), st = sc * K.kSharpStrengthScale + K.kSharpStrengthMin, lim = (sc * K.kSharpLimitScale + K.kSharpLimitMin) * p[2][2];
      const u = [usm(p[0][2], p[1][2], p[2][2], p[3][2], p[4][2], st, lim), usm(p[2][0], p[2][1], p[2][2], p[2][3], p[2][4], st, lim),
        usm(p[1][1], mix(p[2][1], p[1][2], .5), p[2][2], mix(p[3][2], p[2][3], .5), p[3][3], st, lim), usm(p[3][1], mix(p[3][2], p[2][1], .5), p[2][2], mix(p[2][3], p[1][2], .5), p[1][3], st, lim)];
      const wv = edge(K, p[1][1], p[1][2], p[1][3], p[2][1], p[2][2], p[2][3], p[3][1], p[3][2], p[3][3]);
      const d = u[0] * wv[0] + u[1] * wv[1] + u[2] * wv[2] + u[3] * wv[3], o = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) out[o + c] = cl01(img[o + c] + d);
    }
    return out;
  }
  return { scale, sharpen };
}
if (typeof module !== 'undefined') module.exports = make;
if (typeof window !== 'undefined') window.D37NisRef = make;
