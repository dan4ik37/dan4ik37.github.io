// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — постобработка (своя, без библиотек): сцена → буфер HDR (половинные float) → затенение в углах (SSAO,
//  по глубине, в половинном разрешении) → свечение неона (bloom: маска в альфе + цепочка mip-размытия) → цветокоррекция
//  и виньетка → вывод в sRGB → сглаживание FXAA (или MSAA буфера) / FSR 1 при уменьшенном кадре
// ═══════════════════════════════════════
// P = D37E.post(R) — создаёт render.js сам (R.post), если качество не low. Кадр: P.render(scene, camera) вместо r.render.
// Размер буфера сцены — P.setSize(w, h, плотность пикселей): меньше холста = динамическое разрешение (растягиваем при выводе).
// Тональная кривая (ACES) — как и раньше, в материалах; здесь только перевод в sRGB, поэтому небо, вода, стекло, неон
// и подписи поверх выглядят как без постобработки. Свечение: материал с R.bloom(m, сила) пишет в альфу буфера 1 + сила
// (непрозрачные у three.js иначе пишут ровно 1, прозрачные смешиваются к 1) — светится только то, что помечено:
// неон, лампочки, ореолы ламп, диск солнца. P.bloom = { on, strength, levels }; P.fxaa / P.msaa — что сглаживает сейчас.
// P.setOpts({ ao: 'off'|'on'|'high', aa: 'off'|'fxaa'|'msaa' }) — настройки игрока (render.js R.applyGfx). MSAA (4×) — только
// WebGL2, плотность ≤ 1,25 и кадр не уменьшен — иначе FXAA. P.setGrade({ gain, sat, con, vig }) — цвет кадра (gfx.js).
// SSAO (только WebGL2 + HDR): глубина сцены — текстурой (с MSAA three копирует её при сборке кадра), AO — в половинном
// разрешении (8 / 14 выборок по спирали, поворот — узор 4×4), размытие 4×4 по глубине, в сборке — подъём с учётом глубины.
// Не затеняются: небо, светящееся (альфа > 1). Стрелки редактора и рамки (renderOrder ≥ 990, прямо в сцене) рисуются ПОСЛЕ
// постобработки поверх кадра — затенение «того, что за ними» их не пачкает.
(() => {
  const E = window.D37E = window.D37E || {};
  const VS = 'varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  // яркое: 4 выборки (каждая — среднее 2×2) только по пикселям с меткой свечения
  const FS_PRE = `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
vec3 tap(vec2 o){ vec4 c = texture2D(tSrc, vUv + o * uTexel); return c.rgb * clamp(c.a - 1.0, 0.0, 1.0); }
void main(){ gl_FragColor = vec4((tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0))) * 0.25, 1.0); }`;
  // вниз: центр ×4 + 4 угла (двойной фильтр Кавасе)
  const FS_DOWN = `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main(){ vec3 c = texture2D(tSrc, vUv).rgb * 4.0 + texture2D(tSrc, vUv - uTexel).rgb + texture2D(tSrc, vUv + uTexel).rgb
  + texture2D(tSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb + texture2D(tSrc, vUv + vec2(-uTexel.x, uTexel.y)).rgb;
  gl_FragColor = vec4(c * 0.125, 1.0); }`;
  // вверх: «шатёр» 3×3, прибавляется к уровню выше (смешивание ONE, ONE)
  const FS_UP = `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main(){ vec2 d = uTexel; vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += (texture2D(tSrc, vUv + vec2(d.x, 0.0)).rgb + texture2D(tSrc, vUv - vec2(d.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, d.y)).rgb + texture2D(tSrc, vUv - vec2(0.0, d.y)).rgb) * 2.0;
  c += texture2D(tSrc, vUv + d).rgb + texture2D(tSrc, vUv - d).rgb + texture2D(tSrc, vUv + vec2(d.x, -d.y)).rgb + texture2D(tSrc, vUv + vec2(-d.x, d.y)).rgb;
  gl_FragColor = vec4(c * 0.0625, 1.0); }`;
  // ── SSAO (по мотивам SAO, McGuire 2012): точка и нормаль — из глубины, выборки по спирали в экране, радиус — в мире ──
  // uProj: 1/P00, 1/P11, near, far; uAO: радиус (ед.), смещение, сила, выборок; uPx: пикселей на 1 ед. на глубине 1;
  // результат: R — свет (1 — без затенения), G — глубина (ед., для размытия и подъёма)
  const FS_AO = `#include <packing>
uniform sampler2D tDepth; uniform vec2 uFull; uniform vec4 uProj; uniform vec4 uAO; uniform float uPx; varying vec2 vUv;
vec3 vpos(vec2 uv){ float z = perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uProj.z, uProj.w); return vec3((uv * 2.0 - 1.0) * uProj.xy * -z, z); }
void main(){
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.99999) { gl_FragColor = vec4(1.0, 1e4, 0.0, 1.0); return; }
  float z = perspectiveDepthToViewZ(d, uProj.z, uProj.w);
  vec3 p = vec3((vUv * 2.0 - 1.0) * uProj.xy * -z, z);
  vec3 pr = vpos(vUv + vec2(uFull.x, 0.0)), pl = vpos(vUv - vec2(uFull.x, 0.0)), pu = vpos(vUv + vec2(0.0, uFull.y)), pd = vpos(vUv - vec2(0.0, uFull.y));
  vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
  vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
  vec3 n = normalize(cross(dx, dy));
  float rPx = uAO.x * uPx / -z;
  if (rPx < 1.5) { gl_FragColor = vec4(1.0, -z, 0.0, 1.0); return; }
  rPx = min(rPx, uAO.w > 10.0 ? 64.0 : 48.0);
  vec2 q = mod(floor(gl_FragCoord.xy), 4.0);
  float ang = (q.x * 4.0 + q.y + 0.5) * 0.392699;
  float occ = 0.0, ns = uAO.w, r2 = uAO.x * uAO.x, bias = uAO.y * (1.0 - z * 0.04);
  for (int i = 0; i < 16; i++) {
    if (float(i) >= ns) break;
    float t = (float(i) + 0.5) / ns, a = ang + t * 43.98;
    vec3 v = vpos(vUv + vec2(cos(a), sin(a)) * t * rPx * uFull) - p;
    float vv = dot(v, v), f = max(r2 - vv, 0.0);
    occ += f * f * f * max((dot(v, n) - bias) / (vv + 0.01), 0.0);
  }
  gl_FragColor = vec4(clamp(1.0 - occ * uAO.z * 5.0 / (r2 * r2 * r2 * ns), 0.0, 1.0), -z, 0.0, 1.0);
}`;
  // размытие 4×4 (узор поворота — 4×4, поэтому шум уходит целиком) с весом по близости глубины
  const FS_AOB = `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  vec2 c = texture2D(tSrc, vUv).rg;
  float s = 0.0, ws = 0.0;
  for (int y = -2; y < 2; y++) for (int x = -2; x < 2; x++) {
    vec2 a = texture2D(tSrc, vUv + vec2(float(x), float(y)) * uTexel).rg;
    float w = max(0.0, 1.0 - abs(a.y - c.y) / (0.03 * c.y + 0.08));
    s += a.x * w; ws += w;
  }
  gl_FragColor = vec4(ws > 0.001 ? s / ws : c.x, c.y, 0.0, 1.0);
}`;
  // сборка: сцена × AO (подъём с учётом глубины) + свечение (как «экран»: на ярком почти не добавляет; на самом светящемся —
  // четверть, ореол — вокруг: неон не выгорает в белое и не меняет цвет) → цвет кадра (усиление по каналам, насыщенность)
  // → sRGB → контраст (S-кривая), виньетка; яркость (luma) — в альфу для FXAA. Сразу на экран (MSAA, uLuma = 0) — альфа
  // строго 1: холст прозрачный, и тёмное просвечивало светлым фоном страницы (картинка «в белой дымке» на high)
  const FS_COMP = `#include <packing>
uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom; uniform float uLuma; varying vec2 vUv;
uniform sampler2D tAO; uniform sampler2D tDepth; uniform float uAOk; uniform vec2 uAOSize; uniform vec2 uNF;
uniform vec3 uGain; uniform vec3 uGrade;
float aoUp(){
  float zc = -perspectiveDepthToViewZ(texture2D(tDepth, vUv).x, uNF.x, uNF.y);
  vec2 tc = vUv * uAOSize - 0.5, f = fract(tc), b = (floor(tc) + 0.5) / uAOSize, e = 1.0 / uAOSize;
  vec2 s0 = texture2D(tAO, b).rg, s1 = texture2D(tAO, b + vec2(e.x, 0.0)).rg, s2 = texture2D(tAO, b + vec2(0.0, e.y)).rg, s3 = texture2D(tAO, b + e).rg;
  float k = 1.0 / (0.03 * zc + 0.05);
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  w *= vec4(1.0) / (1.0 + k * abs(vec4(s0.y, s1.y, s2.y, s3.y) - zc)) + 1e-4;
  return dot(w, vec4(s0.x, s1.x, s2.x, s3.x)) / dot(w, vec4(1.0));
}
void main(){ vec4 s = texture2D(tScene, vUv); vec3 c = max(s.rgb, vec3(0.0)); float gm = clamp(s.a - 1.0, 0.0, 1.0);
  if (uAOk > 0.0) { float a = aoUp(); c *= mix(1.0, a, uAOk * (1.0 - gm)); if (uAOk > 1.5) c = vec3(a); }
  if (uBloom > 0.0) { vec3 b = texture2D(tBloom, vUv).rgb * uBloom * (1.0 - 0.75 * gm); c += b * clamp(1.0 - c, 0.0, 1.0); }
  c *= uGain;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, uGrade.x), vec3(0.0));
  c = clamp(LinearTosRGB(vec4(c, 1.0)).rgb, 0.0, 1.0);
  c = uGrade.y >= 0.0 ? mix(c, c * c * (3.0 - 2.0 * c), uGrade.y * 2.0) : mix(c, vec3(0.5), -uGrade.y);
  vec2 vd = vUv - 0.5; c *= 1.0 - uGrade.z * smoothstep(0.3, 0.95, length(vd) * 1.41);
  gl_FragColor = vec4(c, uLuma > 0.5 ? dot(min(c, vec3(1.0)), vec3(0.299, 0.587, 0.114)) : 1.0); }`;
  // FXAA (Лоттес, «лёгкий»): 5 выборок яркости, на ровном — сразу выход, на краю — размытие вдоль края (ещё 4)
  const FS_FXAA = `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  vec4 m = texture2D(tSrc, vUv);
  float nw = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).a, ne = texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel).a;
  float sw = texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel).a, se = texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel).a;
  float lo = min(m.a, min(min(nw, ne), min(sw, se))), hi = max(m.a, max(max(nw, ne), max(sw, se)));
  if (hi - lo < max(0.0312, hi * 0.125)) { gl_FragColor = vec4(m.rgb, 1.0); return; }
  vec2 dir = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
  float red = max((nw + ne + sw + se) * 0.03125, 0.0078125), rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
  vec3 a = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tSrc, vUv - dir * 0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
  float lb = dot(b, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4((lb < lo || lb > hi) ? a : b, 1.0);
}`;

  // ── AMD FidelityFX FSR 1 (MIT, © Advanced Micro Devices): кадр в уменьшенном буфере → EASU (увеличение с учётом
  // направления краёв: 12 выборок, окно Ланцоша-2, без «звона» — в пределах 4 ближних) → RCAS (резкость без шума).
  // Только WebGL2 (texelFetch). Вход — уже sRGB (после сборки), как требует FSR.
  const FS_EASU = `uniform sampler2D tSrc; uniform vec2 uIn; uniform vec2 uOut;
vec3 tx(ivec2 p){ return texelFetch(tSrc, clamp(p, ivec2(0), ivec2(uIn) - 1), 0).rgb; }
float lm(vec3 c){ return c.b * 0.5 + (c.r * 0.5 + c.g); }
void eSet(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE){
  float lenX = 1.0 / max(max(abs(lD - lC), abs(lC - lB)), 1e-5), dirX = lD - lB;
  lenX = clamp(abs(dirX) * lenX, 0.0, 1.0); lenX *= lenX;
  float lenY = 1.0 / max(max(abs(lE - lC), abs(lC - lA)), 1e-5), dirY = lE - lA;
  lenY = clamp(abs(dirY) * lenY, 0.0, 1.0); lenY *= lenY;
  dir += vec2(dirX, dirY) * w; len += (lenX + lenY) * w;
}
void eTap(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len, float lob, float clp, vec3 c){
  vec2 v = vec2(dot(off, dir), dot(off, vec2(-dir.y, dir.x))) * len;
  float d2 = min(dot(v, v), clp), wB = 0.4 * d2 - 1.0, wA = lob * d2 - 1.0;
  wB *= wB; wA *= wA; wB = 1.5625 * wB - 0.5625;
  float w = wB * wA; aC += c * w; aW += w;
}
void main(){
  vec2 pp = gl_FragCoord.xy * (uIn / uOut) - 0.5, fp = floor(pp); pp -= fp;
  ivec2 p = ivec2(fp);
  vec3 b = tx(p + ivec2(0, -1)), c = tx(p + ivec2(1, -1)), e = tx(p + ivec2(-1, 0)), f = tx(p), g = tx(p + ivec2(1, 0)), h = tx(p + ivec2(2, 0));
  vec3 i = tx(p + ivec2(-1, 1)), j = tx(p + ivec2(0, 1)), k = tx(p + ivec2(1, 1)), l = tx(p + ivec2(2, 1)), n = tx(p + ivec2(0, 2)), o = tx(p + ivec2(1, 2));
  float bL = lm(b), cL = lm(c), eL = lm(e), fL = lm(f), gL = lm(g), hL = lm(h), iL = lm(i), jL = lm(j), kL = lm(k), lL = lm(l), nL = lm(n), oL = lm(o);
  vec2 dir = vec2(0.0); float len = 0.0;
  eSet(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
  eSet(dir, len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
  eSet(dir, len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
  eSet(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);
  float dirR = dot(dir, dir); bool zro = dirR < 1.0 / 32768.0;
  dirR = zro ? 1.0 : inversesqrt(dirR); dir.x = zro ? 1.0 : dir.x; dir *= dirR;
  len = len * 0.5; len *= len;
  float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
  vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
  float lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len, clp = 1.0 / lob;
  vec3 mn = min(min(f, g), min(j, k)), mx = max(max(f, g), max(j, k)), aC = vec3(0.0); float aW = 0.0;
  eTap(aC, aW, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, b); eTap(aC, aW, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, c);
  eTap(aC, aW, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, i); eTap(aC, aW, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, j);
  eTap(aC, aW, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, f); eTap(aC, aW, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, e);
  eTap(aC, aW, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, k); eTap(aC, aW, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, l);
  eTap(aC, aW, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, h); eTap(aC, aW, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, g);
  eTap(aC, aW, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, o); eTap(aC, aW, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, n);
  gl_FragColor = vec4(min(mx, max(mn, aC / aW)), 1.0);
}`;
  // RCAS: крест из 5 выборок, «лепесток» резкости ограничен так, чтобы не выйти за 0…1; на шуме — слабее. uSharp = 2^-ступени
  const FS_RCAS = `uniform sampler2D tSrc; uniform vec2 uSize; uniform float uSharp;
vec3 tx(ivec2 p){ return texelFetch(tSrc, clamp(p, ivec2(0), ivec2(uSize) - 1), 0).rgb; }
float lm(vec3 c){ return c.b * 0.5 + (c.r * 0.5 + c.g); }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 b = tx(p + ivec2(0, 1)), d = tx(p + ivec2(-1, 0)), e = tx(p), f = tx(p + ivec2(1, 0)), h = tx(p + ivec2(0, -1));
  float bL = lm(b), dL = lm(d), eL = lm(e), fL = lm(f), hL = lm(h);
  float rng = max(max(max(bL, dL), max(eL, fL)), hL) - min(min(min(bL, dL), min(eL, fL)), hL);
  float nz = clamp(abs(0.25 * (bL + dL + fL + hL) - eL) / max(rng, 1e-5), 0.0, 1.0); nz = -0.5 * nz + 1.0;
  vec3 mn4 = min(min(b, d), min(f, h)), mx4 = max(max(b, d), max(f, h));
  vec3 hitMin = mn4 / max(4.0 * mx4, vec3(1e-5)), hitMax = (1.0 - mx4) / min(4.0 * mn4 - 4.0, vec3(-1e-5));
  vec3 lr = max(-hitMin, hitMax);
  float lobe = max(-(0.25 - 1.0 / 16.0), min(max(lr.r, max(lr.g, lr.b)), 0.0)) * uSharp * nz;
  gl_FragColor = vec4((lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0), 1.0);
}`;

  E.post = function (R, o = {}){
    const T = R.T, r = R.r, q = R.q, ext = r.extensions, gl2 = r.capabilities.isWebGL2;
    // буфер сцены: половинные float (значения > 1 и маска свечения в альфе); нет — обычный (без свечения)
    const half = gl2 ? ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')
      : ext.has('OES_texture_half_float') && ext.has('OES_texture_half_float_linear') && ext.has('EXT_color_buffer_half_float');
    const type = half ? T.HalfFloatType : T.UnsignedByteType;
    // fsr — FSR 1 вместо простого растяжения, когда кадр меньше холста (динамическое разрешение или режим FSR в render.js)
    const P = { ok: true, on: true, hdr: half, msaa: 0, fxaa: true, fsr: gl2, scaled: false, w: 1, h: 1, ow: 1, oh: 1, pr: 1, passes: 0,
      aa: q === 'high' ? 'msaa' : 'fxaa', canAO: gl2 && half,
      ao: { mode: 'off', on: false, radius: 1.5 * (E.UNIT || 1), bias: .02, strength: 1.1, aw: 1, ah: 1 },
      bloom: { on: o.bloom !== false && half, strength: q === 'high' ? 1 : .9, levels: q === 'high' ? 5 : 4 } };
    const sceneOpt = { type, depthBuffer: true, stencilBuffer: false };
    // буфер сцены: с MSAA или без, с текстурой глубины (для SSAO) или без — пересоздаётся, когда это меняется
    const sceneRT = (w, h, ms, dep) => {
      const t = new T.WebGLRenderTarget(w, h, { ...sceneOpt, samples: ms });
      if (dep) { t.depthTexture = new T.DepthTexture(w, h); t.depthTexture.type = T.UnsignedIntType; t.depthTexture.format = T.DepthFormat; }
      return t;
    };
    let rtScene = sceneRT(1, 1, 0, false);
    const rtLdr = new T.WebGLRenderTarget(1, 1, { depthBuffer: false });
    const rtUp = gl2 ? new T.WebGLRenderTarget(1, 1, { depthBuffer: false }) : null, DB = new T.Vector2();   // FSR: EASU → сюда (размер холста)
    let rtAO = null, rtAO2 = null;   // SSAO: расчёт и размытие (RG: свет, глубина)
    const B = [];
    const mk = (fs, uniforms, add) => new T.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, toneMapped: false,
      blending: add ? T.CustomBlending : T.NoBlending, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendEquation: T.AddEquation });
    const tx = () => ({ tSrc: { value: null }, uTexel: { value: new T.Vector2() } });
    const M = {
      pre: mk(FS_PRE, tx()), down: mk(FS_DOWN, tx()), up: mk(FS_UP, tx(), true),
      comp: mk(FS_COMP, { tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0 }, uLuma: { value: 1 },
        tAO: { value: null }, tDepth: { value: null }, uAOk: { value: 0 }, uAOSize: { value: new T.Vector2(1, 1) }, uNF: { value: new T.Vector2(.2, 800) },
        uGain: { value: new T.Vector3(1, 1, 1) }, uGrade: { value: new T.Vector3(1, 0, 0) } }),
      fxaa: mk(FS_FXAA, tx()),
    };
    if (gl2) {
      M.easu = mk(FS_EASU, { tSrc: { value: null }, uIn: { value: new T.Vector2() }, uOut: { value: new T.Vector2() } });
      M.rcas = mk(FS_RCAS, { tSrc: { value: null }, uSize: { value: new T.Vector2() }, uSharp: { value: Math.pow(2, -.2) } });   // 0,2 ступени — как в FSR по умолчанию
    }
    if (P.canAO) {
      M.ao = mk(FS_AO, { tDepth: { value: null }, uFull: { value: new T.Vector2() }, uProj: { value: new T.Vector4() }, uAO: { value: new T.Vector4() }, uPx: { value: 1 } });
      M.aob = mk(FS_AOB, tx());
    }
    // один треугольник на весь экран; матрицы не нужны
    const tri = new T.BufferGeometry();
    tri.setAttribute('position', new T.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    tri.setAttribute('uv', new T.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    const pscene = new T.Scene(), pcam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new T.Mesh(tri, M.comp);
    quad.frustumCulled = false; quad.matrixAutoUpdate = false; pscene.add(quad); pscene.matrixWorldAutoUpdate = false; pscene.updateMatrixWorld(true);
    function pass(mat, target){ quad.material = mat; r.setRenderTarget(target); r.render(pscene, pcam); P.passes++; }

    // ── Настройки игрока: AO и сглаживание (размеры буферов — в setSize) ──
    P.setOpts = (op = {}) => {
      const ao = P.canAO && ['on', 'high'].includes(op.ao) ? op.ao : 'off', aa = ['off', 'fxaa', 'msaa'].includes(op.aa) ? op.aa : P.aa;
      if (ao === P.ao.mode && aa === P.aa) return;
      P.ao.mode = ao; P.aa = aa;
      if (P.w > 1) P.setSize(P.w, P.h, P.pr);
    };
    P.setGrade = g => {
      const U = M.comp.uniforms;
      U.uGain.value.set(g.gain[0], g.gain[1], g.gain[2]); U.uGrade.value.set(g.sat, g.con, g.vig);
    };
    P.setSize = (w, h, pr = 1) => {
      P.w = w; P.h = h; P.pr = pr;
      const scaled = P.scaled = pr < (R.pr0 || 1) - .001;   // динамическое разрешение опустило — кадр растягиваем (FSR)
      if (rtUp) { r.getDrawingBufferSize(DB); P.ow = Math.max(1, DB.x); P.oh = Math.max(1, DB.y); rtUp.setSize(P.ow, P.oh); }
      const ms = gl2 && P.aa === 'msaa' && o.msaa !== false && pr <= 1.25 && !scaled ? 4 : 0, dep = P.ao.mode !== 'off';
      if (ms !== rtScene.samples || dep !== !!rtScene.depthTexture) { rtScene.dispose(); rtScene.depthTexture?.dispose(); rtScene = sceneRT(w, h, ms, dep); }
      else rtScene.setSize(w, h);   // текстуру глубины three пересоздаст сам (размер буфера сменился)
      P.msaa = ms;
      P.fxaa = !ms && P.aa !== 'off';   // нет MSAA (выбор, «ретина», уменьшенный кадр) — сглаживает FXAA, если не выключено
      rtLdr.setSize(w, h);
      let bw = Math.max(1, w >> (q === 'high' ? 1 : 2)), bh = Math.max(1, h >> (q === 'high' ? 1 : 2));
      for (let i = 0; i < P.bloom.levels; i++) {
        if (!B[i]) B[i] = new T.WebGLRenderTarget(bw, bh, { type, depthBuffer: false }); else B[i].setSize(bw, bh);
        bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      }
      // SSAO: половина кадра (с «ретины» — четверть), 8 / 14 выборок
      P.ao.on = dep;
      if (dep) {
        const k = pr > 1.3 ? 2 : 1, aw = Math.max(1, w >> k), ah = Math.max(1, h >> k);
        const opt = { type, depthBuffer: false, minFilter: T.NearestFilter, magFilter: T.NearestFilter };
        if (!rtAO) { rtAO = new T.WebGLRenderTarget(aw, ah, opt); rtAO2 = new T.WebGLRenderTarget(aw, ah, opt); } else { rtAO.setSize(aw, ah); rtAO2.setSize(aw, ah); }
        P.ao.aw = aw; P.ao.ah = ah;
      } else if (rtAO) { rtAO.dispose(); rtAO2.dispose(); rtAO = rtAO2 = null; }
    };
    function bloomPasses(){
      const n = Math.min(P.bloom.levels, B.length);
      M.pre.uniforms.tSrc.value = rtScene.texture; M.pre.uniforms.uTexel.value.set(1 / P.w, 1 / P.h);
      pass(M.pre, B[0]);
      for (let i = 0; i < n - 1; i++) { M.down.uniforms.tSrc.value = B[i].texture; M.down.uniforms.uTexel.value.set(1 / B[i].width, 1 / B[i].height); pass(M.down, B[i + 1]); }
      for (let i = n - 2; i >= 0; i--) { M.up.uniforms.tSrc.value = B[i + 1].texture; M.up.uniforms.uTexel.value.set(1 / B[i + 1].width, 1 / B[i + 1].height); pass(M.up, B[i]); }
      return P.bloom.strength * 1.5 / n;   // сумма уровней ≈ n × исходное — к «одному исходному» × сила
    }
    function aoPasses(camera){
      const u = M.ao.uniforms, pm = camera.projectionMatrix.elements, A = P.ao;
      u.tDepth.value = rtScene.depthTexture; u.uFull.value.set(1 / P.w, 1 / P.h);
      u.uProj.value.set(1 / pm[0], 1 / pm[5], camera.near, camera.far);
      u.uAO.value.set(A.radius, A.bias, A.strength, A.mode === 'high' ? 14 : 8);
      u.uPx.value = P.h * pm[5] / 2;
      pass(M.ao, rtAO);
      M.aob.uniforms.tSrc.value = rtAO.texture; M.aob.uniforms.uTexel.value.set(1 / A.aw, 1 / A.ah);
      pass(M.aob, rtAO2);
    }
    // стрелки редактора, рамки, кольцо кисти (renderOrder ≥ 990, прямо в сцене): с AO — поверх готового кадра
    const over = [];
    P.render = (scene, camera) => {
      const st = R.stats, ac = r.autoClear;
      P.passes = 0;
      over.length = 0;
      if (P.ao.on) { const ch = scene.children; for (let i = 0; i < ch.length; i++) { const c = ch[i]; if (c.renderOrder >= 990 && c.visible) { over.push(c); c.visible = false; } } }
      r.setRenderTarget(rtScene); r.autoClear = true;
      r.render(scene, camera);
      st.scene = r.info.render.calls;
      r.autoClear = false;   // проходы закрашивают весь кадр — чистить нечего
      if (P.ao.on) aoPasses(camera);
      const k = P.bloom.on && P.bloom.strength > 0 && B.length ? bloomPasses() : 0;
      const U = M.comp.uniforms; U.tScene.value = rtScene.texture; U.tBloom.value = B[0]?.texture || null; U.uBloom.value = k; U.uLuma.value = P.fxaa ? 1 : 0;
      U.uAOk.value = P.ao.on ? (P.ao.debug ? 2 : 1) : 0; U.tAO.value = P.ao.on ? rtAO2.texture : null; U.tDepth.value = P.ao.on ? rtScene.depthTexture : null;
      if (P.ao.on) { U.uAOSize.value.set(P.ao.aw, P.ao.ah); U.uNF.value.set(camera.near, camera.far); }
      if (P.fsr && P.scaled && M.easu) {   // FSR 1: сборка в уменьшенный буфер → EASU до размера холста → RCAS на экран
        U.uLuma.value = 0; pass(M.comp, rtLdr);
        const ue = M.easu.uniforms; ue.tSrc.value = rtLdr.texture; ue.uIn.value.set(P.w, P.h); ue.uOut.value.set(P.ow, P.oh); pass(M.easu, rtUp);
        const ur = M.rcas.uniforms; ur.tSrc.value = rtUp.texture; ur.uSize.value.set(P.ow, P.oh); pass(M.rcas, null);
      }
      else if (P.fxaa) { pass(M.comp, rtLdr); M.fxaa.uniforms.tSrc.value = rtLdr.texture; M.fxaa.uniforms.uTexel.value.set(1 / P.w, 1 / P.h); pass(M.fxaa, null); }
      else pass(M.comp, null);
      if (over.length) { for (let i = 0; i < over.length; i++) { const c = over[i]; c.visible = true; r.render(c, camera); } over.length = 0; }
      r.autoClear = ac;
      st.post = r.info.render.calls - st.scene;
    };
    P.dispose = () => {
      rtScene.dispose(); rtScene.depthTexture?.dispose(); rtLdr.dispose(); rtUp?.dispose(); rtAO?.dispose(); rtAO2?.dispose(); for (const b of B) b.dispose();
      for (const k in M) M[k].dispose();
      tri.dispose();
    };
    return P;
  };
})();
