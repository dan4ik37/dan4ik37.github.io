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
// Глубина сцены — 24 бита (текстурой, P.depth24): буфер глубины three без текстуры — 16 бит, тонкие слои пола (плитка
// площади в 5 мм над подложкой) вдали путаются (z-fighting).
// SSAO (только WebGL2 + HDR): глубина сцены — текстурой (с MSAA three копирует её при сборке кадра), AO — в половинном
// разрешении (8 / 14 выборок по спирали, поворот — свой у пикселя), размытие 2 проходами по плоскости, в сборке — подъём
// с учётом глубины.
// Не затеняются: небо, светящееся (альфа > 1). Стрелки редактора и рамки (renderOrder ≥ 990, прямо в сцене) рисуются ПОСЛЕ
// постобработки поверх кадра — затенение «того, что за ними» их не пачкает.
(() => {
  const E = window.D37E = window.D37E || {};
  const VS = 'varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  // яркое: 4 выборки (каждая — среднее 2×2) только по пикселям с меткой свечения
  // (метка свечения — альфа ≥ 1,01: трава 1,004 не светится; NaN в буфере сцены не расползается по свечению на весь кадр)
  const FS_PRE = `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
vec3 tap(vec2 o){ vec4 c = texture2D(tSrc, vUv + o * uTexel); return c.a >= 1.01 ? clamp(c.rgb, 0.0, 65000.0) * clamp(c.a - 1.0, 0.0, 1.0) : vec3(0.0); }
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
  // uProj: 1/P00, 1/P11, near, far; uAO: радиус (ед.), смещение, сила (0 — AO выключен), выборок; uPx: пикселей на 1 ед. на
  // глубине 1. Тут же — контактные тени «Трассировки лучей»: луч к солнцу по глубине экрана (uCS: направление на солнце в
  // координатах камеры, длина луча; 0 — выкл), 10 шагов без шума — края мягчит то же размытие по плоскости, что и AO.
  // Результат: R — свет AO (1 — без затенения), G — глубина (ед., для размытия и подъёма), B — свет контактной тени
  // Трава и листва (код в альфе буфера сцены 1 + 4/1024, gfx.js E.FOLIAGE_A; D37_FOL) — не заслонка и сами без AO: тонкие
  // травинки давали тёмное пятно вокруг каждого кустика. Только «телефонно-безопасное»: чтение кода — textureLod (как глубина,
  // уже проверено на телефонах), без continue и texelFetch, вклад травы — умножением на маску (после «чёрной земли» 15.10).
  // Без D37_FOL (страж графики выключил: P.setFol(false)) fol() — ноль, и шейдер — ровно прежний, проверенный на телефонах
  const FS_AO = `#include <packing>
uniform sampler2D tDepth; uniform vec2 uFull; uniform vec4 uProj; uniform vec4 uAO; uniform vec4 uCS; uniform float uPx; varying vec2 vUv;
float vz(vec2 uv){ return perspectiveDepthToViewZ(textureLod(tDepth, uv, 0.0).x, uProj.z, uProj.w); }   // textureLod: в циклах с выходом — без производных
vec3 vpos(vec2 uv){ float z = vz(uv); return vec3((uv * 2.0 - 1.0) * uProj.xy * -z, z); }
#ifdef D37_FOL
uniform sampler2D tColor;
float fol(vec2 uv){ float a = textureLod(tColor, uv, 0.0).a; return (a > 1.0005 && a < 1.01) ? 1.0 : 0.0; }   // 1 — трава/листва
#else
float fol(vec2 uv){ return 0.0; }
#endif
void main(){
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.99999) { gl_FragColor = vec4(1.0, 1e4, 1.0, 1.0); return; }
  float z = perspectiveDepthToViewZ(d, uProj.z, uProj.w);
  if (fol(vUv) > 0.5) { gl_FragColor = vec4(1.0, -z, 1.0, 1.0); return; }
  vec3 p = vec3((vUv * 2.0 - 1.0) * uProj.xy * -z, z);
  vec3 pr = vpos(vUv + vec2(uFull.x, 0.0)), pl = vpos(vUv - vec2(uFull.x, 0.0)), pu = vpos(vUv + vec2(0.0, uFull.y)), pd = vpos(vUv - vec2(0.0, uFull.y));
  vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
  vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
  vec3 cr = cross(dx, dy), n = dot(cr, cr) > 1e-24 ? normalize(cr) : vec3(0.0, 0.0, 1.0);   // нормаль нуля (normalize → NaN) — к камере
  float ao = 1.0, rPx = uAO.x * uPx / -z;
  if (uAO.z > 0.0 && rPx >= 1.5) {
    rPx = min(rPx, uAO.w > 10.0 ? 64.0 : 48.0);
    // поворот спирали — свой у каждого пикселя (шум «градиентный», Хименес): мелкий, без узора — размытие убирает целиком
    float ang = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float occ = 0.0, ns = uAO.w, r2 = uAO.x * uAO.x, bias = uAO.y * (1.0 - z * 0.04);
    for (int i = 0; i < 16; i++) {
      if (float(i) >= ns) break;
      float t = (float(i) + 0.5) / ns, a = ang + t * 43.98;
      vec2 su = vUv + vec2(cos(a), sin(a)) * t * rPx * uFull;
      vec3 v = vpos(su) - p;
      float vv = dot(v, v), f = max(r2 - vv, 0.0);
      occ += (1.0 - fol(su)) * f * f * f * max((dot(v, n) - bias) / (vv + 0.01), 0.0);   // травинка — не заслонка
    }
    ao = clamp(1.0 - occ * uAO.z * 5.0 / (r2 * r2 * r2 * ns), 0.0, 1.0);
  }
  // контактная тень: от точки (чуть над поверхностью) к солнцу; первая заслонка — тень, чем ближе, тем гуще
  float cs = 1.0;
  if (uCS.w > 0.0 && dot(n, uCS.xyz) > 0.03) {
    float len = clamp(-z * 0.03, 0.3, 2.0) * uCS.w, sh = 0.0;
    vec3 o = p + n * (0.003 * -z + 0.01);
    for (int i = 1; i <= 10; i++) {
      float t = float(i) / 10.0;
      vec3 q = o + uCS.xyz * len * t;
      if (q.z > -uProj.z) break;
      vec2 uv = q.xy / (-q.z * uProj.xy) * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
      float dz = vz(uv) - q.z;
      if (fol(uv) < 0.5 && dz > 0.002 * -q.z + 0.004 && dz < 0.5 + len * 0.35) { sh = 1.0 - t * t; break; }   // трава — не заслонка (её тень — в карте теней)
    }
    cs = 1.0 - sh;
  }
  gl_FragColor = vec4(ao, -z, cs, 1.0);
}`;
  // ── «Трассировка лучей»: отражения в экране (SSR) — луч по глубине кадра от блестящих пикселей (код блеска — альфа буфера
  // сцены, gfx.js), перспективно-верный шаг в экране, без шума (шаги ровные) + уточнение половинным делением; нормаль — из
  // глубины (у воды — плюс рябь по миру). Промах (небо, край экрана) — вес 0: остаётся отражение неба самого материала.
  // uSSR: шагов не больше, длина луча (ед.), сила мира, время (рябь); uStride — шаг в пикселях (короткий в экране луч —
  // мельче и точнее, длинный — до предела шагов). Результат: rgb — отражённый цвет (HDR), a — вес смешивания
  const FS_SSR = `#include <packing>
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uFull; uniform vec4 uProj; uniform vec4 uSSR; uniform float uStride;
uniform mat4 uView; uniform mat4 uViewInv; varying vec2 vUv;
float vz(vec2 uv){ return perspectiveDepthToViewZ(textureLod(tDepth, uv, 0.0).x, uProj.z, uProj.w); }   // textureLod: в циклах с выходом — без производных
vec3 vpos(vec2 uv){ float z = vz(uv); return vec3((uv * 2.0 - 1.0) * uProj.xy * -z, z); }
vec2 proj(vec3 q){ return q.xy / (-q.z * uProj.xy) * 0.5 + 0.5; }
void main(){
  float a = texture2D(tColor, vUv).a, gloss = 0.0, f0 = 0.04; bool clear = false;
  if (a < 0.25) { clear = true; gloss = 1.0 - a * 4.0; f0 = 0.02; }
  else if (a >= 0.75 && a < 0.999) { bool metal = a >= 0.875; gloss = clamp((a - (metal ? 0.875 : 0.75)) / 0.12, 0.0, 1.0); f0 = metal ? 0.8 : 0.04; }
  float d = texture2D(tDepth, vUv).x;
  if (gloss < 0.02 || d >= 0.99999) { gl_FragColor = vec4(0.0); return; }
  float z = perspectiveDepthToViewZ(d, uProj.z, uProj.w);
  vec3 p = vec3((vUv * 2.0 - 1.0) * uProj.xy * -z, z);
  vec3 pr = vpos(vUv + vec2(uFull.x, 0.0)), pl = vpos(vUv - vec2(uFull.x, 0.0)), pu = vpos(vUv + vec2(0.0, uFull.y)), pd = vpos(vUv - vec2(0.0, uFull.y));
  vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
  vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
  vec3 cr = cross(dx, dy), n = dot(cr, cr) > 1e-24 ? normalize(cr) : vec3(0.0, 0.0, 1.0), v = normalize(p);
  if (dot(n, v) > 0.0) n = -n;
  if (clear) {   // вода: рябь по миру (два слоя волн), только у горизонтальной поверхности
    vec3 up = (uView * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    if (dot(n, up) > 0.85) {
      vec3 w = (uViewInv * vec4(p, 1.0)).xyz; float t = uSSR.w;
      vec2 g = vec2(sin(w.x * 1.3 + t * 1.1) + 0.6 * sin(w.x * 2.9 - w.z * 1.7 + t * 1.7), cos(w.z * 1.2 - t * 0.9) + 0.6 * cos(w.z * 3.1 + w.x * 1.3 - t * 1.5)) * 0.018;
      n = normalize(n + (uView * vec4(g.x, 0.0, g.y, 0.0)).xyz);
    }
  }
  vec3 r = reflect(v, n);
  float F = f0 + (1.0 - f0) * pow(1.0 - clamp(dot(-v, n), 0.0, 1.0), 5.0);
  float L = uSSR.y;
  if (r.z > 0.0) L = min(L, (-uProj.z * 2.0 - p.z) / r.z);   // к камере — не дальше ближней плоскости
  if (L < 0.05) { gl_FragColor = vec4(0.0); return; }
  vec3 e = p + r * L;
  vec2 s0 = vUv, s1 = proj(e), ds = s1 - s0;
  float w0 = -1.0 / p.z, w1 = -1.0 / e.z;
  // отрезок в экране — только до края кадра (шаги не тратятся на то, чего не видно)
  float tMax = 1.0;
  if (ds.x > 1e-6) tMax = min(tMax, (1.0 - s0.x) / ds.x); else if (ds.x < -1e-6) tMax = min(tMax, -s0.x / ds.x);
  if (ds.y > 1e-6) tMax = min(tMax, (1.0 - s0.y) / ds.y); else if (ds.y < -1e-6) tMax = min(tMax, -s0.y / ds.y);
  float ns = clamp(length(ds * tMax / uFull) / uStride, 4.0, uSSR.x), tPrev = 0.0, hit = -1.0, zPrev = p.z;
  for (int i = 1; i <= 96; i++) {
    if (float(i) > ns) break;
    float t = tMax * float(i) / ns;
    vec2 uv = s0 + ds * t;
    float rz = -1.0 / mix(w0, w1, t), dz = vz(uv) - rz;
    if (dz > 0.0 && dz < max(0.06, -rz * 0.025) + abs(rz - zPrev)) { hit = t; break; }
    tPrev = t; zPrev = rz;
  }
  if (hit < 0.0) { gl_FragColor = vec4(0.0); return; }
  float lo = tPrev, hi = hit;
  for (int k = 0; k < 5; k++) {
    float mid = 0.5 * (lo + hi);
    if (vz(s0 + ds * mid) + 1.0 / mix(w0, w1, mid) > 0.0) hi = mid; else lo = mid;
  }
  vec2 h = s0 + ds * hi;
  if (texture2D(tDepth, h).x >= 0.99999) { gl_FragColor = vec4(0.0); return; }
  vec2 ed = min(h, 1.0 - h);
  float fade = smoothstep(0.0, 0.07, min(ed.x, ed.y)) * (1.0 - smoothstep(0.7, 1.0, hi)) * (1.0 - smoothstep(0.15, 0.65, r.z));
  gl_FragColor = vec4(max(texture2D(tColor, h).rgb, vec3(0.0)), clamp(F * gloss * uSSR.z * fade, 0.0, 1.0));
}`;
  // размытие — два прохода (вдоль и поперёк, uTexel — шаг), 9 выборок по Гауссу с весом по плоскости: глубину соседа
  // сравниваем не с глубиной середины, а с плоскостью через неё (1/глубины меняется по экрану линейно). Раньше было 4×4
  // с весом «глубина как у середины» — на полу под углом соседи сверху/снизу отбрасывались, узор поворота 4×4 оставался
  // полосами и «лесенкой» у ножек, стульев, бордюров и ползал при движении (та самая рябь на полу)
  // (контактная тень в B размывается теми же весами)
  const FS_AOB = `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb;
  if (c.y > 5000.0) { gl_FragColor = vec4(c, 1.0); return; }
  float wc = 1.0 / max(c.y, 1e-3), wl = 1.0 / max(texture2D(tSrc, vUv - uTexel).g, 1e-3), wr = 1.0 / max(texture2D(tSrc, vUv + uTexel).g, 1e-3);
  float k = abs(wr - wc) < abs(wc - wl) ? wr - wc : wc - wl;
  vec2 s = c.xz; float ws = 1.0;
  for (int i = 1; i <= 4; i++) {
    float fi = float(i), wg = exp(-fi * fi * 0.1);
    vec3 a = texture2D(tSrc, vUv + uTexel * fi).rgb, b = texture2D(tSrc, vUv - uTexel * fi).rgb;
    float wa = wg * max(0.0, 1.0 - abs(1.0 / max(a.y, 1e-3) - wc - k * fi) / (wc * 0.035));
    float wb = wg * max(0.0, 1.0 - abs(1.0 / max(b.y, 1e-3) - wc + k * fi) / (wc * 0.035));
    s += a.xz * wa + b.xz * wb; ws += wa + wb;
  }
  gl_FragColor = vec4(s.x / ws, c.y, s.y / ws, 1.0);
}`;
  // сборка: сцена × AO (подъём с учётом глубины) + свечение (как «экран»: на ярком почти не добавляет; на самом светящемся —
  // четверть, ореол — вокруг: неон не выгорает в белое и не меняет цвет) → цвет кадра (усиление по каналам, насыщенность)
  // → sRGB → контраст (S-кривая), виньетка; яркость (luma) — в альфу для FXAA. Сразу на экран (MSAA, uLuma = 0) — альфа
  // строго 1: холст прозрачный, и тёмное просвечивало светлым фоном страницы (картинка «в белой дымке» на high)
  const FS_COMP = `#include <packing>
uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom; uniform float uLuma; varying vec2 vUv;
uniform sampler2D tAO; uniform sampler2D tDepth; uniform float uAOk; uniform vec2 uAOSize; uniform vec2 uNF;
uniform sampler2D tSSR; uniform float uSSRk; uniform float uCSk;
uniform vec3 uGain; uniform vec3 uGrade;
vec2 aoUp(){   // x — AO, y — контактная тень
  float zc = -perspectiveDepthToViewZ(texture2D(tDepth, vUv).x, uNF.x, uNF.y);
  vec2 tc = vUv * uAOSize - 0.5, f = fract(tc), b = (floor(tc) + 0.5) / uAOSize, e = 1.0 / uAOSize;
  vec3 s0 = texture2D(tAO, b).rgb, s1 = texture2D(tAO, b + vec2(e.x, 0.0)).rgb, s2 = texture2D(tAO, b + vec2(0.0, e.y)).rgb, s3 = texture2D(tAO, b + e).rgb;
  float k = 1.0 / (0.03 * zc + 0.05);
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  w *= vec4(1.0) / (1.0 + k * abs(vec4(s0.y, s1.y, s2.y, s3.y) - zc)) + 1e-4;
  float iw = 1.0 / dot(w, vec4(1.0));
  return vec2(dot(w, vec4(s0.x, s1.x, s2.x, s3.x)), dot(w, vec4(s0.z, s1.z, s2.z, s3.z))) * iw;
}
void main(){ vec4 s = texture2D(tScene, vUv); vec3 c = max(s.rgb, vec3(0.0)); float gm = s.a >= 1.01 ? clamp(s.a - 1.0, 0.0, 1.0) : 0.0;
  if (uSSRk > 0.0) { vec4 rf = texture2D(tSSR, vUv); c = mix(c, rf.rgb, rf.a); }   // отражения (трассировка лучей)
  if (uAOk > 0.0) { vec2 a = aoUp(); if (!(a.x >= 0.0 && a.x <= 1.0)) a.x = 1.0; if (!(a.y >= 0.0 && a.y <= 1.0)) a.y = 1.0;   // NaN из AO — не «чёрное», а без затенения
    float cs = mix(1.0, a.y, uCSk * (1.0 - gm)); c *= mix(1.0, a.x, uAOk * (1.0 - gm)) * cs; if (uAOk > 1.5) c = vec3(a.x * cs); }
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

  // ═══ NVIDIA Image Scaling (NIS) SDK v1.0.3 — NVScaler (увеличение + резкость) и NVSharpen (только резкость) ═══
  // Перенос на фрагментный шейдер WebGL2 (у NVIDIA — вычислительный: плитка яркости в общей памяти; здесь каждый пиксель
  // берёт своё окно 6×6 / 5×5 сам). Алгоритм, константы и таблицы фильтров — из github.com/NVIDIAGameWorks/NVIDIAImageScaling
  // (NIS/NIS_Scaler.h, NIS/NIS_Config.h):
  //   The MIT License(MIT)
  //   Copyright(c) 2022 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
  //   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
  //   documentation files(the "Software"), to deal in the Software without restriction, including without limitation the
  //   rights to use, copy, modify, merge, publish, distribute, sublicense, and / or sell copies of the Software, and to permit
  //   persons to whom the Software is furnished to do so, subject to the following conditions:
  //   The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
  //   Software.
  //   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
  //   WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
  //   COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
  //   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
  // Таблицы coef_scale и coef_usm (64 фазы × 6 отводов; 7-й и 8-й — нули) — в текстуре 4×64 (RGBA float): x 0,1 — scale, 2,3 — usm.
  const NIS_SCALE = [
    0, 0, 1, 0, 0, 0, .0029, -.0127, 1, .0132, -.0034, 0, .0063, -.0249, .9985, .0269, -.0068, 0, .0088, -.0361, .9956, .0415, -.0103, .0005,
    .0117, -.0474, .9932, .0562, -.0142, .0005, .0142, -.0576, .9897, .0713, -.0181, .0005, .0166, -.0674, .9844, .0874, -.022, .001, .0186, -.0762, .9785, .104, -.0264, .0015,
    .0205, -.085, .9727, .1206, -.0308, .002, .0225, -.0928, .9648, .1382, -.0352, .0024, .0239, -.1006, .9575, .1558, -.0396, .0029, .0254, -.1074, .9487, .1738, -.0439, .0034,
    .0264, -.1138, .939, .1929, -.0488, .0044, .0278, -.1191, .9282, .2119, -.0537, .0049, .0288, -.1245, .917, .231, -.0581, .0059, .0293, -.1294, .9058, .251, -.063, .0063,
    .0303, -.1333, .8926, .271, -.0679, .0073, .0308, -.1367, .8789, .2915, -.0728, .0083, .0308, -.1401, .8657, .312, -.0776, .0093, .0313, -.1426, .8506, .333, -.0825, .0103,
    .0313, -.1445, .8354, .354, -.0874, .0112, .0313, -.146, .8193, .3755, -.0923, .0122, .0313, -.147, .8022, .3965, -.0967, .0137, .0308, -.1479, .7856, .4185, -.1016, .0146,
    .0303, -.1479, .7681, .4399, -.106, .0156, .0298, -.1479, .7505, .4614, -.1104, .0166, .0293, -.147, .7314, .4829, -.1147, .0181, .0288, -.146, .7119, .5049, -.1187, .019,
    .0278, -.1445, .6929, .5264, -.1226, .02, .0273, -.1431, .6724, .5479, -.126, .0215, .0264, -.1411, .6528, .5693, -.1299, .0225, .0254, -.1387, .6323, .5903, -.1328, .0234,
    .0244, -.1357, .6113, .6113, -.1357, .0244, .0234, -.1328, .5903, .6323, -.1387, .0254, .0225, -.1299, .5693, .6528, -.1411, .0264, .0215, -.126, .5479, .6724, -.1431, .0273,
    .02, -.1226, .5264, .6929, -.1445, .0278, .019, -.1187, .5049, .7119, -.146, .0288, .0181, -.1147, .4829, .7314, -.147, .0293, .0166, -.1104, .4614, .7505, -.1479, .0298,
    .0156, -.106, .4399, .7681, -.1479, .0303, .0146, -.1016, .4185, .7856, -.1479, .0308, .0137, -.0967, .3965, .8022, -.147, .0313, .0122, -.0923, .3755, .8193, -.146, .0313,
    .0112, -.0874, .354, .8354, -.1445, .0313, .0103, -.0825, .333, .8506, -.1426, .0313, .0093, -.0776, .312, .8657, -.1401, .0308, .0083, -.0728, .2915, .8789, -.1367, .0308,
    .0073, -.0679, .271, .8926, -.1333, .0303, .0063, -.063, .251, .9058, -.1294, .0293, .0059, -.0581, .231, .917, -.1245, .0288, .0049, -.0537, .2119, .9282, -.1191, .0278,
    .0044, -.0488, .1929, .939, -.1138, .0264, .0034, -.0439, .1738, .9487, -.1074, .0254, .0029, -.0396, .1558, .9575, -.1006, .0239, .0024, -.0352, .1382, .9648, -.0928, .0225,
    .002, -.0308, .1206, .9727, -.085, .0205, .0015, -.0264, .104, .9785, -.0762, .0186, .001, -.022, .0874, .9844, -.0674, .0166, .0005, -.0181, .0713, .9897, -.0576, .0142,
    .0005, -.0142, .0562, .9932, -.0474, .0117, .0005, -.0103, .0415, .9956, -.0361, .0088, 0, -.0068, .0269, .9985, -.0249, .0063, 0, -.0034, .0132, 1, -.0127, .0029,
  ];
  const NIS_USM = [
    0, -.6001, 1.2002, -.6001, 0, 0, .0029, -.6084, 1.1987, -.5903, -.0029, 0, .0049, -.6147, 1.1958, -.5791, -.0068, .0005, .0073, -.6196, 1.189, -.5659, -.0103, 0,
    .0093, -.6235, 1.1802, -.5513, -.0151, 0, .0112, -.6265, 1.1699, -.5352, -.0195, .0005, .0122, -.627, 1.1582, -.5181, -.0259, .0005, .0142, -.6284, 1.1455, -.5005, -.0317, .0005,
    .0156, -.6265, 1.1274, -.479, -.0386, .0005, .0166, -.6235, 1.1089, -.457, -.0454, .001, .0176, -.6187, 1.0879, -.4346, -.0532, .001, .0181, -.6138, 1.0659, -.4102, -.0615, .0015,
    .019, -.6069, 1.0405, -.3843, -.0698, .0015, .0195, -.6006, 1.0161, -.3574, -.0796, .002, .02, -.5928, .9893, -.3286, -.0898, .0024, .02, -.582, .958, -.2988, -.1001, .0029,
    .02, -.5728, .9292, -.269, -.1104, .0034, .02, -.562, .8975, -.2368, -.1226, .0039, .0205, -.5498, .8643, -.2046, -.1343, .0044, .02, -.5371, .8301, -.1709, -.1465, .0049,
    .0195, -.5239, .7944, -.1367, -.1587, .0054, .0195, -.5107, .7598, -.1021, -.1724, .0059, .019, -.4966, .7231, -.0649, -.1865, .0063, .0186, -.4819, .6846, -.0288, -.1997, .0068,
    .0186, -.4668, .646, .0093, -.2144, .0073, .0176, -.4507, .6055, .0479, -.229, .0083, .0171, -.437, .5693, .0859, -.2446, .0088, .0161, -.4199, .5283, .1255, -.2598, .0098,
    .0161, -.4048, .4883, .1655, -.2754, .0103, .0151, -.3887, .4497, .2041, -.291, .0107, .0142, -.3711, .4072, .2446, -.3066, .0117, .0137, -.3555, .3672, .2852, -.3228, .0122,
    .0132, -.3394, .3262, .3262, -.3394, .0132, .0122, -.3228, .2852, .3672, -.3555, .0137, .0117, -.3066, .2446, .4072, -.3711, .0142, .0107, -.291, .2041, .4497, -.3887, .0151,
    .0103, -.2754, .1655, .4883, -.4048, .0161, .0098, -.2598, .1255, .5283, -.4199, .0161, .0088, -.2446, .0859, .5693, -.437, .0171, .0083, -.229, .0479, .6055, -.4507, .0176,
    .0073, -.2144, .0093, .646, -.4668, .0186, .0068, -.1997, -.0288, .6846, -.4819, .0186, .0063, -.1865, -.0649, .7231, -.4966, .019, .0059, -.1724, -.1021, .7598, -.5107, .0195,
    .0054, -.1587, -.1367, .7944, -.5239, .0195, .0049, -.1465, -.1709, .8301, -.5371, .02, .0044, -.1343, -.2046, .8643, -.5498, .0205, .0039, -.1226, -.2368, .8975, -.562, .02,
    .0034, -.1104, -.269, .9292, -.5728, .02, .0029, -.1001, -.2988, .958, -.582, .02, .0024, -.0898, -.3286, .9893, -.5928, .02, .002, -.0796, -.3574, 1.0161, -.6006, .0195,
    .0015, -.0698, -.3843, 1.0405, -.6069, .019, .0015, -.0615, -.4102, 1.0659, -.6138, .0181, .001, -.0532, -.4346, 1.0879, -.6187, .0176, .001, -.0454, -.457, 1.1089, -.6235, .0166,
    .0005, -.0386, -.479, 1.1274, -.6265, .0156, .0005, -.0317, -.5005, 1.1455, -.6284, .0142, .0005, -.0259, -.5181, 1.1582, -.627, .0122, .0005, -.0195, -.5352, 1.1699, -.6265, .0112,
    0, -.0151, -.5513, 1.1802, -.6235, .0093, 0, -.0103, -.5659, 1.189, -.6196, .0073, .0005, -.0068, -.5791, 1.1958, -.6147, .0049, 0, -.0029, -.5903, 1.1987, -.6084, .0029,
  ];
  E.NIS = { scale: NIS_SCALE, usm: NIS_USM, phases: 64, taps: 6 };
  // NVScalerUpdateConfig (SDR): резкость 0…1 → константы шейдера (вход и выход шейдер считает сам по uIn / uOut)
  E.nisConfig = (sharpness = .5) => {
    const s = Math.max(0, Math.min(1, +sharpness || 0)), sl = s - .5;   // 0…1 → −0,5…+0,5
    const MaxScale = sl >= 0 ? 1.25 : 1.75, MinScale = sl >= 0 ? 1.25 : 1, LimitScale = sl >= 0 ? 1.25 : 1;
    const kDetectRatio = 2 * 1127 / 1024, kDetectThres = 64 / 1024, kMinContrastRatio = 2, kMaxContrastRatio = 10;
    const kSharpStartY = .45, kSharpEndY = .9;
    const kSharpStrengthMin = Math.max(0, .4 + sl * MinScale * 1.2), kSharpStrengthMax = 1.6 + sl * MaxScale * 1.8;
    const kSharpLimitMin = Math.max(.1, .14 + sl * LimitScale * .32), kSharpLimitMax = .5 + sl * LimitScale * .6;
    return { kDetectRatio, kDetectThres, kMinContrastRatio, kRatioNorm: 1 / (kMaxContrastRatio - kMinContrastRatio),
      kContrastBoost: 1, kEps: 1 / 255, kSharpStartY, kSharpScaleY: 1 / (kSharpEndY - kSharpStartY),
      kSharpStrengthMin, kSharpStrengthScale: kSharpStrengthMax - kSharpStrengthMin, kSharpLimitMin, kSharpLimitScale: kSharpLimitMax - kSharpLimitMin };
  };
  // общее у обоих шейдеров NIS: яркость (Rec.709, как getY), карта краёв (GetEdgeMap), подавление звона (CalcLTI)
  const NIS_COMMON = `uniform sampler2D tSrc; uniform vec2 uIn; uniform vec2 uOut;
uniform vec4 uK0; uniform vec4 uK1; uniform vec4 uK2;
// uK0: kDetectRatio, kDetectThres, kMinContrastRatio, kRatioNorm; uK1: kContrastBoost, kEps, kSharpStartY, kSharpScaleY
// uK2: kSharpStrengthMin, kSharpStrengthScale, kSharpLimitMin, kSharpLimitScale
float nY(vec3 c){ return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }
float nL(ivec2 p){ return nY(texelFetch(tSrc, clamp(p, ivec2(0), ivec2(uIn) - 1), 0).rgb); }
vec4 nEdge(float p00, float p01, float p02, float p10, float p11, float p12, float p20, float p21, float p22){
  float g0 = abs(p00 + p01 + p02 - p20 - p21 - p22), g45 = abs(p10 + p00 + p01 - p21 - p22 - p12);
  float g90 = abs(p00 + p10 + p20 - p02 - p12 - p22), g135 = abs(p10 + p20 + p21 - p01 - p02 - p12);
  float a = max(g0, g90), ai = min(g0, g90), b = max(g45, g135), bi = min(g45, g135);
  if (a + b == 0.0) return vec4(0.0);
  float e090 = min(a / (a + b), 1.0), e45 = 1.0 - e090;
  bool c090 = a > ai * uK0.x && a > uK0.y && a > bi, c45 = b > bi * uK0.x && b > uK0.y && b > ai;
  bool cg0 = a == g0, cg45 = b == g45;
  float f090 = c090 && c45 ? e090 : 1.0, f45 = c090 && c45 ? e45 : 1.0;
  return vec4(c090 && cg0 ? f090 : 0.0, c090 && !cg0 ? f090 : 0.0, c45 && cg45 ? f45 : 0.0, c45 && !cg45 ? f45 : 0.0);
}
float nLTI(float a0, float a1, float a2, float b0, float b1, float b2){
  float ac = max(max(a0, a1), a2) - min(min(a0, a1), a2), bc = max(max(b0, b1), b2) - min(min(b0, b1), b2);
  float r = max(ac, bc) / (min(ac, bc) + uK1.y);
  return (1.0 - clamp((r - uK0.z) * uK0.w, 0.0, 1.0)) * uK1.x;
}
`;
  // NVScaler: окно яркости 6×6 вокруг точки входа (p[i][j] — ряд i, столбец j), карта краёв в 4 соседних пикселях,
  // обычный фильтр 6×6 + 4 направленных (0°, 90°, 45°, 135°) с резкостью (USM), в конце — цвет билинейно + поправка яркости
  const nisP = (i, j) => `p${i}${j}`;
  const FS_NIS = (() => {
    let s = NIS_COMMON + `uniform sampler2D tCoef;
float nPoly(float x0, float x1, float x2, float x3, float x4, float x5, int ph){
  vec4 s0 = texelFetch(tCoef, ivec2(0, ph), 0), s1 = texelFetch(tCoef, ivec2(1, ph), 0);
  vec4 u0 = texelFetch(tCoef, ivec2(2, ph), 0), u1 = texelFetch(tCoef, ivec2(3, ph), 0);
  vec4 a = vec4(x0, x1, x2, x3); vec2 b = vec2(x4, x5);
  float y = dot(s0, a) + dot(s1.xy, b), yu = dot(u0, a) + dot(u1.xy, b);
  float ys = 1.0 - clamp((y - uK1.z) * uK1.w, 0.0, 1.0);
  yu *= ys * uK2.y + uK2.x;
  float lim = (ys * uK2.w + uK2.z) * y;
  yu = min(lim, max(-lim, yu));
  bool sel = ph <= 32;
  yu *= nLTI(sel ? x0 : x3, x1, x2, x3, x4, sel ? x2 : x5);
  return y + yu;
}
void main(){
  vec2 dst = floor(gl_FragCoord.xy), k = uIn / uOut;
  vec2 src = (dst + 0.5) * k - 0.5, fl = floor(src), fr = src - fl;
  ivec2 b = ivec2(fl);
  int fxi = int(fr.x * 64.0), fyi = int(fr.y * 64.0);
`;
    for (let i = 0; i < 6; i++) s += '  float ' + [0, 1, 2, 3, 4, 5].map(j => `${nisP(i, j)} = nL(b + ivec2(${j - 2}, ${i - 2}))`).join(', ') + ';\n';
    // карта краёв в 4 пикселях вокруг точки (центры p22, p23, p32, p33) и их смесь по дробной части
    const e = (i, j) => `nEdge(${[0, 1, 2].map(r => [0, 1, 2].map(c => nisP(1 + i + r, 1 + j + c)).join(', ')).join(', ')})`;
    s += `  vec4 w = mix(mix(${e(0, 0)}, ${e(0, 1)}, fr.x), mix(${e(1, 0)}, ${e(1, 1)}, fr.x), fr.y);\n`;
    // обычный фильтр: по столбцам (фаза y), потом по строке (фаза x)
    s += `  vec4 sy0 = texelFetch(tCoef, ivec2(0, fyi), 0), sy1 = texelFetch(tCoef, ivec2(1, fyi), 0), sx0 = texelFetch(tCoef, ivec2(0, fxi), 0), sx1 = texelFetch(tCoef, ivec2(1, fxi), 0);\n`;
    for (let j = 0; j < 6; j++) s += `  float v${j} = dot(sy0, vec4(${[0, 1, 2, 3].map(i => nisP(i, j)).join(', ')})) + dot(sy1.xy, vec2(${nisP(4, j)}, ${nisP(5, j)}));\n`;
    s += `  float opY = (dot(sx0, vec4(v0, v1, v2, v3)) + dot(sx1.xy, vec2(v4, v5))) * (1.0 - w.x - w.y - w.z - w.w);
  if (w.x > 0.0) opY += nPoly(${[0, 1, 2, 3, 4, 5].map(i => `mix(${nisP(i, 2)}, ${nisP(i, 3)}, fr.x)`).join(', ')}, fyi) * w.x;
  if (w.y > 0.0) opY += nPoly(${[0, 1, 2, 3, 4, 5].map(i => `mix(${nisP(2, i)}, ${nisP(3, i)}, fr.y)`).join(', ')}, fxi) * w.y;
  if (w.z > 0.0) {
    float pb = 0.5 + 0.5 * (fr.x - fr.y);
    float t1 = mix(p21, p12, pb), t3 = mix(p32, p23, pb), t5 = mix(p43, p34, pb);
    pb -= 0.5; bool hi = pb >= 0.0; float ab = abs(pb);
    float t0 = mix(p11, hi ? p02 : p20, ab), t2 = mix(p22, hi ? p13 : p31, ab), t4 = mix(p33, hi ? p24 : p42, ab), t6 = mix(p44, hi ? p35 : p53, ab);
    float pp = fr.x + fr.y;
    if (pp >= 1.0) opY += nPoly(t1, t2, t3, t4, t5, t6, int((pp - 1.0) * 64.0)) * w.z;
    else opY += nPoly(t0, t1, t2, t3, t4, t5, int(pp * 64.0)) * w.z;
  }
  if (w.w > 0.0) {
    float pb = 0.5 * (fr.x + fr.y);
    float t1 = mix(p31, p42, pb), t3 = mix(p22, p33, pb), t5 = mix(p13, p24, pb);
    pb -= 0.5; bool hi = pb >= 0.0; float ab = abs(pb);
    float t0 = mix(p41, hi ? p52 : p30, ab), t2 = mix(p32, hi ? p43 : p21, ab), t4 = mix(p23, hi ? p34 : p12, ab), t6 = mix(p14, hi ? p25 : p03, ab);
    float pp = 1.0 + (fr.x - fr.y);
    if (pp >= 1.0) opY += nPoly(t1, t2, t3, t4, t5, t6, int((pp - 1.0) * 64.0)) * w.w;
    else opY += nPoly(t0, t1, t2, t3, t4, t5, int(pp * 64.0)) * w.w;
  }
  vec3 op = texture2D(tSrc, (src + 0.5) / uIn).rgb;
  gl_FragColor = vec4(clamp(op + (opY - nY(op)), 0.0, 1.0), 1.0);
}`;
    return s;
  })();
  // NVSharpen: окно 5×5, резкость по 4 направлениям (USM с подавлением звона), веса — по карте краёв в середине
  const FS_NIS_SHARP = (() => {
    let s = NIS_COMMON + `float nUsm(float x0, float x1, float x2, float x3, float x4, float st, float lim){
  float y = (-0.6001 * x1 + 1.2002 * x2 - 0.6001 * x3) * st;
  y = min(lim, max(-lim, y));
  return y * nLTI(x0, x1, x2, x2, x3, x4);
}
void main(){
  ivec2 b = ivec2(gl_FragCoord.xy);
`;
    for (let i = 0; i < 5; i++) s += '  float ' + [0, 1, 2, 3, 4].map(j => `${nisP(i, j)} = nL(b + ivec2(${j - 2}, ${i - 2}))`).join(', ') + ';\n';
    s += `  float sc = 1.0 - clamp((p22 - uK1.z) * uK1.w, 0.0, 1.0), st = sc * uK2.y + uK2.x, lim = (sc * uK2.w + uK2.z) * p22;
  vec4 u = vec4(nUsm(p02, p12, p22, p32, p42, st, lim), nUsm(p20, p21, p22, p23, p24, st, lim),
    nUsm(p11, mix(p21, p12, 0.5), p22, mix(p32, p23, 0.5), p33, st, lim), nUsm(p31, mix(p32, p21, 0.5), p22, mix(p23, p12, 0.5), p13, st, lim));
  vec4 w = nEdge(p11, p12, p13, p21, p22, p23, p31, p32, p33);
  vec3 op = texelFetch(tSrc, b, 0).rgb;
  gl_FragColor = vec4(clamp(op + dot(u, w), 0.0, 1.0), 1.0);
}`;
    return s;
  })();
  E.NIS.fs = { scaler: FS_NIS, sharpen: FS_NIS_SHARP };   // тексты шейдеров — для проверок (scripts/render-test.cjs)
  E.RT_FS = { ssr: FS_SSR, ao: FS_AO };

  // ═══ «Генерация кадров (×2)»: настоящий кадр — через раз, между ними — прошлый готовый кадр, переложенный под новое
  // положение камеры по его глубине (идея асинхронного timewarp / экстраполяции кадра). Для пикселя нового кадра ищем,
  // откуда он в старом: точка мира по старой глубине → в новый экран → поправка (4 шага), второй старт — «как будто далеко»
  // (открывшийся из-за предмета фон); не сошлось — берём более дальний (фон тянется, передний край не размазывается).
  // Подвижные (свой персонаж и другие, до 8: цилиндр — центр, радиус, высота, сдвиг с настоящего кадра) двигаются вместе
  // со своим сдвигом — свой персонаж в 3-м лице не «дрожит». Край экрана — по краю (растяжение).
  const FS_FG = `#include <packing>
uniform sampler2D tColor; uniform sampler2D tDepth; uniform mat4 uInvVP; uniform mat4 uVP; uniform vec2 uSize;
uniform vec4 uMovA[8]; uniform vec4 uMovB[8]; uniform float uMovN; varying vec2 vUv;
vec3 wOld(vec2 uv, float d){ vec4 c = uInvVP * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return c.xyz / c.w; }
float dOld(vec2 uv){ return min(textureLod(tDepth, clamp(uv, vec2(0.0), vec2(1.0)), 0.0).x, 0.99995); }
vec3 mv(vec3 p){
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uMovN) break;
    vec4 a = uMovA[i], b = uMovB[i]; vec2 q = p.xz - a.xz;
    if (dot(q, q) < a.w * a.w && p.y > a.y - 0.2 && p.y < a.y + b.w) return p + b.xyz;
  }
  return p;
}
vec2 toNew(vec3 p){ vec4 c = uVP * vec4(p, 1.0); return c.xy / c.w * 0.5 + 0.5; }
vec2 solve(vec2 uv, vec2 s){
  for (int k = 0; k < 4; k++) s += uv - toNew(mv(wOld(s, dOld(s))));
  return s;
}
float err(vec2 uv, vec2 s){ return length((toNew(mv(wOld(s, dOld(s)))) - uv) * uSize); }
void main(){
  vec2 uv = vUv;
  vec2 s1 = solve(uv, uv);
  vec2 s2 = solve(uv, uv + (uv - toNew(wOld(uv, 0.99995))));
  float e1 = err(uv, s1), e2 = err(uv, s2);
  vec2 s = e1 <= 1.0 ? s1 : e2 <= 1.0 ? s2 : (dOld(s1) >= dOld(s2) ? s1 : s2);
  vec2 h = 0.5 / uSize;
  gl_FragColor = vec4(texture2D(tColor, clamp(s, h, 1.0 - h)).rgb, 1.0);
}`;
  const FS_COPY = `uniform sampler2D tSrc; varying vec2 vUv;
void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }`;
  E.FG = { fs: FS_FG, MAXMOV: 8 };
  // Самопроверка кадра (страж графики, E.gfxGuard): буфер 16×12 RGBA8 — каждая точка читает одну точку источника. uMode:
  // 0 — цвет сцены (HDR → x/(1+x)), 1 — AO (r — свет AO, b — контактная тень; небо — g ≥ 9000), 2 — отражения (rgb → x/(1+x),
  // a — вес), 3 — готовый кадр (0…1). a: 1 — точка в порядке, 0,5 — небо, 0 — не число / бесконечность / вне диапазона.
  // «Не число» — по битам (экспонента вся из единиц): isnan() компилятор Direct3D выкидывает («value cannot be NaN», X3577),
  // целые операции — нет
  const FS_HEALTH = `uniform sampler2D tSrc; uniform sampler2D tDepth; uniform float uMode; uniform float uDep; varying vec2 vUv;
float bad(float x){ return ((floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u || x < -0.01 || x > 65000.0) ? 1.0 : 0.0; }
void main(){
  vec4 c = textureLod(tSrc, vUv, 0.0);
  float b = max(max(bad(c.r), bad(c.g)), max(bad(c.b), bad(c.a)));
  float sky = 0.0;
  if (uMode > 0.5 && uMode < 1.5) sky = c.g > 9000.0 ? 1.0 : 0.0;
  else if (uDep > 0.5) sky = textureLod(tDepth, vUv, 0.0).x >= 0.99999 ? 1.0 : 0.0;
  vec3 v = max(c.rgb, vec3(0.0));
  if (uMode > 0.5 && uMode < 1.5) v = vec3(clamp(c.r, 0.0, 1.0), 0.0, clamp(c.b, 0.0, 1.0));
  else if (uMode > 2.5) v = clamp(v, 0.0, 1.0);
  else v = v / (1.0 + v);
  gl_FragColor = b > 0.5 ? vec4(0.0) : vec4(v, sky > 0.5 ? 0.5 : 1.0);
}`;
  E.HEALTH = { fs: FS_HEALTH, w: 16, h: 12 };
  // Точность чтения текстур (15.10.2026, телефон владельца: «пятна» на площади и фонтане). В GLSL ES 3.00 у sampler2D во
  // фрагментном шейдере точность по умолчанию — lowp, и значение из текстуры приходит С ТОЧНОСТЬЮ СЭМПЛЕРА: на телефонах
  // (Adreno, Mali, Apple) это половинный float (fp16, 11 бит). Глубина 0,98 в fp16 — шаг 0,0005: на 8 м ошибка 0,1–0,3 м →
  // контактные тени и отражения находили «заслонки» в ровном полу (пятна, полосы), AO — шумел. three r149 точность
  // сэмплеров не задаёт (новые версии задают highp). На компьютере (ANGLE/Direct3D) всё и так fp32 — поэтому видно только
  // на телефоне. Каждый шейдер постобработки начинается с этой строки (render-test проверяет). highp в GLSL ES 3.00 есть
  // всегда; в WebGL1 — только если видеокарта умеет (GL_FRAGMENT_PRECISION_HIGH)
  E.POST_PREC = '#if __VERSION__ >= 300 || defined( GL_FRAGMENT_PRECISION_HIGH )\nprecision highp sampler2D;\n#endif\n';
  E.post = function (R, o = {}){
    const T = R.T, r = R.r, q = R.q, ext = r.extensions, gl2 = r.capabilities.isWebGL2;
    // буфер сцены: половинные float (значения > 1 и маска свечения в альфе); нет — обычный (без свечения)
    const half = gl2 ? ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')
      : ext.has('OES_texture_half_float') && ext.has('OES_texture_half_float_linear') && ext.has('EXT_color_buffer_half_float');
    const type = half ? T.HalfFloatType : T.UnsignedByteType;
    // fsr — FSR 1 вместо простого растяжения, когда кадр меньше холста (динамическое разрешение или режим FSR в render.js)
    // upscaler — чем растягивать уменьшенный кадр: 'fsr' (AMD FSR 1), 'nis' (NVIDIA Image Scaling), 'off' (просто растянуть);
    // sharp — резкость 0…1 (FSR — RCAS, NIS — свой USM; у NIS и в 100% кадре, как «резкость» в панели NVIDIA)
    const P = { ok: true, on: true, hdr: half, msaa: 0, fxaa: true, fsr: gl2, scaled: false, w: 1, h: 1, ow: 1, oh: 1, pr: 1, passes: 0,
      upscaler: 'fsr', sharp: .5,
      aa: q === 'high' ? 'msaa' : 'fxaa', canAO: gl2 && half,
      // глубина сцены — 24 бита (текстурой глубины): буфер глубины three без неё — 16 бит, и вдали тонкие слои пола
      // (плитка площади в 5 мм над подложкой, дорожки) путаются — проступает нижний (z-fighting)
      depth24: gl2 || ext.has('WEBGL_depth_texture'),
      ao: { mode: 'off', on: false, radius: .95 * (E.UNIT || 1), bias: .02, strength: 1, aw: 1, ah: 1 },
      // «Трассировка лучей» (WebGL2 + HDR): off / on (отражения: шаг 3 px, до 40 шагов; контактные тени) / high (шаг 1,5 px,
      // до 96 шагов, луч длиннее)
      rt: { mode: 'off', on: false, steps: 40, len: 40 * (E.UNIT || 1), contact: .55 },
      bloom: { on: o.bloom !== false && half, strength: q === 'high' ? 1 : .9, levels: q === 'high' ? 5 : 4 },
      // трава и листва не заслоняют AO (код в альфе — gfx.js E.FOLIAGE_A); страж графики (ниже) может выключить и это, и любой проход
      fol: true, noRT: false, noNIS: false, noFSR: false, noFXAA: false, off: {} };
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
    const mk = (fs, uniforms, add) => new T.ShaderMaterial({ vertexShader: VS, fragmentShader: E.POST_PREC + fs, uniforms, depthTest: false, depthWrite: false, toneMapped: false,
      blending: add ? T.CustomBlending : T.NoBlending, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendEquation: T.AddEquation });
    const tx = () => ({ tSrc: { value: null }, uTexel: { value: new T.Vector2() } });
    const M = {
      pre: mk(FS_PRE, tx()), down: mk(FS_DOWN, tx()), up: mk(FS_UP, tx(), true),
      comp: mk(FS_COMP, { tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0 }, uLuma: { value: 1 },
        tAO: { value: null }, tDepth: { value: null }, uAOk: { value: 0 }, uAOSize: { value: new T.Vector2(1, 1) }, uNF: { value: new T.Vector2(.2, 800) },
      tSSR: { value: null }, uSSRk: { value: 0 }, uCSk: { value: 0 },
        uGain: { value: new T.Vector3(1, 1, 1) }, uGrade: { value: new T.Vector3(1, 0, 0) } }),
      fxaa: mk(FS_FXAA, tx()),
    };
    let coefTex = null;
    if (gl2) {
      M.easu = mk(FS_EASU, { tSrc: { value: null }, uIn: { value: new T.Vector2() }, uOut: { value: new T.Vector2() } });
      M.rcas = mk(FS_RCAS, { tSrc: { value: null }, uSize: { value: new T.Vector2() }, uSharp: { value: Math.pow(2, -.2) } });   // 0,2 ступени — как в FSR по умолчанию
      // NIS: таблицы фильтров — текстура 4×64 (x 0,1 — coef_scale, 2,3 — coef_usm; по 4 отвода в пикселе)
      const cd = new Float32Array(4 * 64 * 4);
      for (let ph = 0; ph < 64; ph++) for (let t = 0; t < 6; t++) {
        cd[(ph * 4 + (t >> 2)) * 4 + (t & 3)] = NIS_SCALE[ph * 6 + t];
        cd[(ph * 4 + 2 + (t >> 2)) * 4 + (t & 3)] = NIS_USM[ph * 6 + t];
      }
      coefTex = new T.DataTexture(cd, 4, 64, T.RGBAFormat, T.FloatType);
      coefTex.minFilter = coefTex.magFilter = T.NearestFilter; coefTex.generateMipmaps = false; coefTex.needsUpdate = true;
      const nu = () => ({ tSrc: { value: null }, uIn: { value: new T.Vector2() }, uOut: { value: new T.Vector2() }, uK0: { value: new T.Vector4() }, uK1: { value: new T.Vector4() }, uK2: { value: new T.Vector4() } });
      M.nis = mk(FS_NIS, { ...nu(), tCoef: { value: coefTex } });
      M.nisS = mk(FS_NIS_SHARP, nu());
    }
    if (P.canAO) {
      M.ao = mk(FS_AO, { tDepth: { value: null }, uFull: { value: new T.Vector2() }, uProj: { value: new T.Vector4() }, uAO: { value: new T.Vector4() }, uCS: { value: new T.Vector4() }, uPx: { value: 1 },
        tColor: { value: null } });
      M.ao.defines = { D37_FOL: '' };   // трава и листва — без AO (P.setFol)
      M.aob = mk(FS_AOB, tx());
      M.ssr = mk(FS_SSR, { tColor: { value: null }, tDepth: { value: null }, uFull: { value: new T.Vector2() }, uProj: { value: new T.Vector4() }, uSSR: { value: new T.Vector4() },
        uStride: { value: 3 }, uView: { value: new T.Matrix4() }, uViewInv: { value: new T.Matrix4() } });
    }
    let rtSSR = null;   // отражения: rgb — цвет, a — вес (полный размер кадра)
    // генерация кадров: готовый настоящий кадр (размер холста) — для перекладки в промежуточном
    let rtOut = null;
    if (gl2) {
      const mu = () => ({ value: Array.from({ length: E.FG.MAXMOV }, () => new T.Vector4()) });
      M.fg = mk(FS_FG, { tColor: { value: null }, tDepth: { value: null }, uInvVP: { value: new T.Matrix4() }, uVP: { value: new T.Matrix4() }, uSize: { value: new T.Vector2(1, 1) },
        uMovA: mu(), uMovB: mu(), uMovN: { value: 0 } });
      M.copy = mk(FS_COPY, { tSrc: { value: null } });
      M.health = mk(FS_HEALTH, { tSrc: { value: null }, tDepth: { value: null }, uMode: { value: 0 }, uDep: { value: 0 } });   // страж графики
    }
    // fg.on — включена (render.js); movers — подвижные настоящего кадра: ключ → [x, y, z, r, h]
    P.fg = { ok: !!gl2, on: false, have: false, vp: new T.Matrix4(), ivp: new T.Matrix4(), gen: 0, real: 0 };
    // включить/выключить (render.js): буфер готового кадра — размером холста
    P.setFg = on => {
      on = !!on && P.fg.ok;
      if (on === P.fg.on) return;
      P.fg.on = on; P.fg.have = false;
      if (P.w > 1) P.setSize(P.w, P.h, P.pr);
    };
    // один треугольник на весь экран; матрицы не нужны
    const tri = new T.BufferGeometry();
    tri.setAttribute('position', new T.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    tri.setAttribute('uv', new T.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    const pscene = new T.Scene(), pcam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new T.Mesh(tri, M.comp);
    quad.frustumCulled = false; quad.matrixAutoUpdate = false; pscene.add(quad); pscene.matrixWorldAutoUpdate = false; pscene.updateMatrixWorld(true);
    function pass(mat, target){ quad.material = mat; r.setRenderTarget(target); r.render(pscene, pcam); P.passes++; }

    // ── Точность глубины на этом устройстве (один раз, ~1 мс): видеокарта рисует плоскость на известной глубине, шейдер с
    // highp-сэмплером читает её и сравнивает. Неточно (нет highp или драйвер его не дал) — AO, «Трассировка лучей» и
    // «Генерация кадров» здесь выключены: с грубой глубиной они рисуют пятна и полосы на ровном полу (телефон владельца) ──
    P.depthOK = !P.canAO || probeDepth();
    if (!P.depthOK) { P.canAO = false; P.fg.ok = false; }
    function probeDepth(){
      try {
        const gl = typeof r.getContext === 'function' ? r.getContext() : null;
        if (gl && gl.getShaderPrecisionFormat) {
          const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
          P.prec = hp ? hp.precision : 0;
          if (!hp || hp.precision < 23) return false;   // highp во фрагментном шейдере — не float32
        }
        if (typeof r.readRenderTargetPixels !== 'function') return true;   // подставной рендерер (проверки в node)
        const D = .9876543;   // глубина «метров за 15»: в fp16 здесь шаг 0,0005 — сразу видно
        const tz = new T.WebGLRenderTarget(4, 4, { depthBuffer: true, stencilBuffer: false });
        tz.depthTexture = new T.DepthTexture(4, 4); tz.depthTexture.type = T.UnsignedIntType; tz.depthTexture.format = T.DepthFormat;
        const to = new T.WebGLRenderTarget(1, 1, { depthBuffer: false });
        const mw = new T.ShaderMaterial({ vertexShader: `void main(){ gl_Position = vec4(position.xy, ${(2 * D - 1).toFixed(7)}, 1.0); }`,
          fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }', depthTest: true, depthWrite: true });
        const mr = mk(`uniform sampler2D tDepth; varying vec2 vUv;
void main(){ float e = abs(texture2D(tDepth, vec2(0.5)).x - ${D.toFixed(7)}); gl_FragColor = vec4(e < 4e-6 ? 1.0 : 0.0, clamp(e * 1000.0, 0.0, 1.0), 0.0, 1.0); }`, { tDepth: { value: tz.depthTexture } });
        r.setRenderTarget(tz); r.clear(true, true, false);
        pass(mw, tz); pass(mr, to);
        const px = new Uint8Array(4); r.readRenderTargetPixels(to, 0, 0, 1, 1, px);
        r.setRenderTarget(null);
        P.probe = { ok: px[0] > 127, err: px[1] / 255 / 1000 };
        for (const x of [mw, mr, to, tz.depthTexture, tz]) x.dispose();
        quad.material = M.comp;
        return P.probe.ok;
      } catch (e) { console.warn?.('post: проверка точности глубины не удалась', e); return true; }   // не смогли проверить — как раньше
    }

    // ── Настройки игрока: AO, сглаживание, апскейлер и резкость (размеры буферов — в setSize) ──
    P.setOpts = (op = {}) => {
      if ('upscaler' in op || 'sharp' in op) P.setUpscaler(op.upscaler ?? P.upscaler, op.sharp ?? P.sharp);
      const ao = P.canAO && ['on', 'high'].includes(op.ao) ? op.ao : 'off', aa = ['off', 'fxaa', 'msaa'].includes(op.aa) ? op.aa : P.aa;
      const rt = !('rt' in op) ? P.rt.mode : P.canAO && !P.noRT && ['on', 'high'].includes(op.rt) ? op.rt : 'off';
      if (ao === P.ao.mode && aa === P.aa && rt === P.rt.mode) return;
      P.ao.mode = ao; P.aa = aa; P.rt.mode = rt;
      P.rt.steps = rt === 'high' ? 96 : 40; P.rt.len = (rt === 'high' ? 60 : 40) * (E.UNIT || 1);
      R.rtMarkAll?.(rt !== 'off');   // вода и стекло пишут метку в альфу, только пока трассировка включена
      if (P.w > 1) P.setSize(P.w, P.h, P.pr);
    };
    // апскейлер и резкость: FSR — сила RCAS (2^-ступени: 0 → 1 ступень мягче, 50% → 0,2 — как было, 100% → 0), NIS — константы
    // NVScalerUpdateConfig. Без WebGL2 FSR и NIS нет — просто растяжение
    P.setUpscaler = (up, sharp) => {
      P.upscaler = gl2 && ['fsr', 'nis', 'off'].includes(up) ? up : gl2 ? 'fsr' : 'off';
      if (P.upscaler === 'nis' && P.noNIS) P.upscaler = P.noFSR ? 'off' : 'fsr';   // страж выключил (не собрался на этой видеокарте)
      if (P.upscaler === 'fsr' && P.noFSR) P.upscaler = P.noNIS ? 'off' : 'nis';
      P.sharp = Math.max(0, Math.min(1, Number.isFinite(+sharp) ? +sharp : .5));
      if (!gl2) return;
      M.rcas.uniforms.uSharp.value = Math.pow(2, -Math.max(0, Math.min(2, 1.6 * (1 - P.sharp) - .6)));
      const c = E.nisConfig(P.sharp);
      for (const m of [M.nis, M.nisS]) {
        const u = m.uniforms;
        u.uK0.value.set(c.kDetectRatio, c.kDetectThres, c.kMinContrastRatio, c.kRatioNorm);
        u.uK1.value.set(c.kContrastBoost, c.kEps, c.kSharpStartY, c.kSharpScaleY);
        u.uK2.value.set(c.kSharpStrengthMin, c.kSharpStrengthScale, c.kSharpLimitMin, c.kSharpLimitScale);
      }
    };
    P.setUpscaler(o.upscaler || 'fsr', o.sharp ?? .5);
    P.setGrade = g => {
      const U = M.comp.uniforms;
      U.uGain.value.set(g.gain[0], g.gain[1], g.gain[2]); U.uGrade.value.set(g.sat, g.con, g.vig);
    };
    P.setSize = (w, h, pr = 1) => {
      P.w = w; P.h = h; P.pr = pr;
      const scaled = P.scaled = pr < (R.pr0 || 1) - .001;   // динамическое разрешение опустило — кадр растягиваем (FSR)
      if (rtUp) { r.getDrawingBufferSize(DB); P.ow = Math.max(1, DB.x); P.oh = Math.max(1, DB.y); rtUp.setSize(P.ow, P.oh); }
      const ms = gl2 && P.aa === 'msaa' && o.msaa !== false && pr <= 1.25 && !scaled ? 4 : 0, dep = P.depth24 || P.ao.mode !== 'off';
      if (ms !== rtScene.samples || dep !== !!rtScene.depthTexture) { rtScene.dispose(); rtScene.depthTexture?.dispose(); rtScene = sceneRT(w, h, ms, dep); }
      else rtScene.setSize(w, h);   // текстуру глубины three пересоздаст сам (размер буфера сменился)
      P.msaa = ms;
      P.fxaa = !ms && P.aa !== 'off' && !P.noFXAA;   // нет MSAA (выбор, «ретина», уменьшенный кадр) — сглаживает FXAA, если не выключено
      rtLdr.setSize(w, h);
      let bw = Math.max(1, w >> (q === 'high' ? 1 : 2)), bh = Math.max(1, h >> (q === 'high' ? 1 : 2));
      for (let i = 0; i < P.bloom.levels; i++) {
        if (!B[i]) B[i] = new T.WebGLRenderTarget(bw, bh, { type, depthBuffer: false }); else B[i].setSize(bw, bh);
        bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      }
      // генерация кадров: готовый кадр — в свой буфер размером холста (оттуда — на экран и в промежуточный кадр)
      if (P.fg.on && rtUp) { if (!rtOut) rtOut = new T.WebGLRenderTarget(P.ow, P.oh, { depthBuffer: false }); else rtOut.setSize(P.ow, P.oh); }
      else if (rtOut) { rtOut.dispose(); rtOut = null; }
      P.fg.have = false;
      // трассировка лучей: отражения — свой буфер в полный кадр; контактные тени считает проход AO (он и без AO работает)
      const rtOn = P.rt.on = P.canAO && P.rt.mode !== 'off' && !!rtScene.depthTexture;
      if (rtOn) { if (!rtSSR) rtSSR = new T.WebGLRenderTarget(w, h, { type, depthBuffer: false }); else rtSSR.setSize(w, h); }
      else if (rtSSR) { rtSSR.dispose(); rtSSR = null; }
      // SSAO: половина кадра (с «ретины» — четверть), 8 / 14 выборок
      const aoOn = P.ao.on = P.canAO && (P.ao.mode !== 'off' || rtOn) && !!rtScene.depthTexture;
      if (aoOn) {
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
    const sunV = new T.Vector3();
    // сила контактной тени: днём — как задано, в сумерки и ночью (луна) — слабее, нет света — нет
    const sunK = () => { const M = R.sky; return M ? Math.max(0, Math.min(1, (M.lightI || 0) * 1.2)) * (1 - .6 * (M.night || 0)) : 1; };
    function aoPasses(camera){
      const u = M.ao.uniforms, pm = camera.projectionMatrix.elements, A = P.ao;
      u.tDepth.value = rtScene.depthTexture; u.uFull.value.set(1 / P.w, 1 / P.h);
      u.tColor.value = rtScene.texture;   // код травы и листвы — в альфе (D37_FOL)
      u.uProj.value.set(1 / pm[0], 1 / pm[5], camera.near, camera.far);
      u.uAO.value.set(A.radius, A.bias, A.mode !== 'off' ? A.strength : 0, A.mode === 'high' ? 14 : 8);
      u.uPx.value = P.h * pm[5] / 2;
      // контактные тени: направление на солнце (или луну) — в координатах камеры
      if (P.rt.on && R.sunDir && sunK() > .01) { sunV.copy(R.sunDir).transformDirection(camera.matrixWorldInverse); u.uCS.value.set(sunV.x, sunV.y, sunV.z, E.UNIT || 1); }
      else u.uCS.value.set(0, 0, 0, 0);
      pass(M.ao, rtAO);
      // размытие: вдоль (rtAO → rtAO2), поперёк (rtAO2 → rtAO); итог — в rtAO
      const b = M.aob.uniforms;
      b.tSrc.value = rtAO.texture; b.uTexel.value.set(1 / A.aw, 0); pass(M.aob, rtAO2);
      b.tSrc.value = rtAO2.texture; b.uTexel.value.set(0, 1 / A.ah); pass(M.aob, rtAO);
    }
    // стрелки редактора, рамки, кольцо кисти (renderOrder ≥ 990, прямо в сцене): с AO — поверх готового кадра
    const over = [];
    function ssrPass(camera){
      const u = M.ssr.uniforms, pm = camera.projectionMatrix.elements, G = R.lighting?.gfx?.rt;
      u.tColor.value = rtScene.texture; u.tDepth.value = rtScene.depthTexture; u.uFull.value.set(1 / P.w, 1 / P.h);
      u.uProj.value.set(1 / pm[0], 1 / pm[5], camera.near, camera.far);
      u.uSSR.value.set(P.rt.steps, P.rt.len, G ? G.refl : 1, R.waterU ? R.waterU.uTime.value : performance.now() / 1000);
      u.uStride.value = P.rt.mode === 'high' ? 1.5 : 3;
      u.uView.value.copy(camera.matrixWorldInverse); u.uViewInv.value.copy(camera.matrixWorld);
      pass(M.ssr, rtSSR);
    }
    // ── Кадр по частям: сцена в буфер (коды в альфе — только сюда) → проходы и вывод (finish) ──
    // Коды в альфе: блеск — только с «Трассировкой лучей» (как было до 16.10), трава и листва — пока считается AO (он же —
    // контактные тени трассировки) и страж графики их не выключил. Включены — только на время отрисовки буфера сцены
    P.codesOn = () => !P.off.codes && !!E.GFXU?.rt && (P.rt.on || (P.fol && P.ao.on));
    function sceneTo(scene, camera, codes){
      r.setRenderTarget(rtScene); r.autoClear = true;
      const GU = E.GFXU;
      if (codes && GU?.rt && !P.off.codes) { if (P.rt.on) GU.rt[1] = 1; if (P.fol && P.ao.on) GU.rt[2] = 1; }
      r.render(scene, camera);
      if (GU?.rt) { GU.rt[1] = 0; GU.rt[2] = 0; }
    }
    function hideOver(scene){
      over.length = 0;
      if (P.ao.on) { const ch = scene.children; for (let i = 0; i < ch.length; i++) { const c = ch[i]; if (c.renderOrder >= 990 && c.visible) { over.push(c); c.visible = false; } } }
    }
    const ssrWanted = () => P.rt.on && (R.lighting?.gfx?.rt?.refl ?? 1) > .001;
    function compSet(camera, ssrOn, k){
      const U = M.comp.uniforms; U.tScene.value = rtScene.texture; U.tBloom.value = B[0]?.texture || null; U.uBloom.value = k; U.uLuma.value = P.fxaa ? 1 : 0;
      U.uAOk.value = P.ao.on ? (P.ao.debug ? 2 : 1) : 0; U.tAO.value = P.ao.on ? rtAO.texture : null; U.tDepth.value = P.ao.on ? rtScene.depthTexture : null;
      if (P.ao.on) { U.uAOSize.value.set(P.ao.aw, P.ao.ah); U.uNF.value.set(camera.near, camera.far); }
      U.uSSRk.value = ssrOn ? 1 : 0; U.tSSR.value = ssrOn ? rtSSR.texture : null;
      U.uCSk.value = P.rt.on ? P.rt.contact * sunK() : 0;
      return U;
    }
    P.render = (scene, camera) => {
      const st = R.stats, ac = r.autoClear;
      P.passes = 0;
      hideOver(scene);
      sceneTo(scene, camera, true);
      st.scene = r.info.render.calls;
      finish(camera);
      r.autoClear = ac;
      st.post = r.info.render.calls - st.scene;
    };
    function finish(camera){
      r.autoClear = false;   // проходы закрашивают весь кадр — чистить нечего
      const ssrOn = ssrWanted();
      if (ssrOn) ssrPass(camera);
      if (P.ao.on) aoPasses(camera);
      const k = P.bloom.on && P.bloom.strength > 0 && B.length ? bloomPasses() : 0;
      const U = compSet(camera, ssrOn, k);
      const out = P.fg.on && rtOut ? rtOut : null;   // генерация кадров: сначала в свой буфер, потом копией на экран
      const nisK = (m, src, w, h, ow, oh) => { const u = m.uniforms; u.tSrc.value = src; u.uIn.value.set(w, h); u.uOut.value.set(ow, oh); };
      if (P.scaled && P.upscaler === 'nis' && M.nis) {   // NIS: сборка в уменьшенный буфер → NVScaler (увеличение + резкость) на экран
        U.uLuma.value = 0; pass(M.comp, rtLdr);
        nisK(M.nis, rtLdr.texture, P.w, P.h, P.ow, P.oh); pass(M.nis, out);
      } else if (P.scaled && P.upscaler === 'fsr' && M.easu) {   // FSR 1: сборка в уменьшенный буфер → EASU до размера холста → RCAS на экран
        U.uLuma.value = 0; pass(M.comp, rtLdr);
        const ue = M.easu.uniforms; ue.tSrc.value = rtLdr.texture; ue.uIn.value.set(P.w, P.h); ue.uOut.value.set(P.ow, P.oh);
        if (P.sharp > .001) { pass(M.easu, rtUp); const ur = M.rcas.uniforms; ur.tSrc.value = rtUp.texture; ur.uSize.value.set(P.ow, P.oh); pass(M.rcas, out); }
        else pass(M.easu, out);
      } else if (!P.scaled && P.upscaler === 'nis' && M.nisS && P.sharp > .001) {   // NIS в полном кадре: только резкость (NVSharpen)
        if (P.fxaa) {   // сначала сгладить, потом резкость
          pass(M.comp, rtLdr); M.fxaa.uniforms.tSrc.value = rtLdr.texture; M.fxaa.uniforms.uTexel.value.set(1 / P.w, 1 / P.h); pass(M.fxaa, rtUp);
          nisK(M.nisS, rtUp.texture, P.ow, P.oh, P.ow, P.oh);
        } else { U.uLuma.value = 0; pass(M.comp, rtLdr); nisK(M.nisS, rtLdr.texture, P.w, P.h, P.w, P.h); }
        pass(M.nisS, out);
      }
      else if (P.fxaa) { pass(M.comp, rtLdr); M.fxaa.uniforms.tSrc.value = rtLdr.texture; M.fxaa.uniforms.uTexel.value.set(1 / P.w, 1 / P.h); pass(M.fxaa, out); }
      else pass(M.comp, out);
      if (out) {   // генерация кадров: копия на экран; запомнить камеру этого кадра — от неё перекладывается промежуточный
        M.copy.uniforms.tSrc.value = rtOut.texture; pass(M.copy, null);
        P.fg.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); P.fg.ivp.copy(P.fg.vp).invert();
        P.fg.have = true; P.fg.real++;
      }
      P.lastOver = over.length;   // стрелки редактора (их в промежуточном кадре нет — тогда render.js генерацию не включает)
      if (over.length) { for (let i = 0; i < over.length; i++) { const c = over[i]; c.visible = true; r.render(c, camera); } over.length = 0; }
    }

    // ── Самопроверка кадра (страж графики E.gfxGuard; ~1 раз в минуту в начале, после смены настроек): тот же кадр —
    // сцена без кодов и с кодами в альфе (цвет обязан совпасть: коды пишут только альфу), AO, отражения, сборка → по сетке
    // 16×12 точек в маленький буфер RGBA8 и одно чтение на каждую проверку. Кадр на экран — как обычно (finish) ──
    let hRT = null;
    function health(src, mode, dep){
      if (!hRT) hRT = new T.WebGLRenderTarget(E.HEALTH.w, E.HEALTH.h, { depthBuffer: false });
      const u = M.health.uniforms; u.tSrc.value = src; u.tDepth.value = dep || null; u.uMode.value = mode; u.uDep.value = dep ? 1 : 0;
      pass(M.health, hRT);
      const b = new Uint8Array(E.HEALTH.w * E.HEALTH.h * 4);
      r.readRenderTargetPixels(hRT, 0, 0, E.HEALTH.w, E.HEALTH.h, b);
      return b;
    }
    P.canTest = () => !!M.health && typeof r.readRenderTargetPixels === 'function' && P.on;
    P.selfTest = (scene, camera) => {
      const st = R.stats, ac = r.autoClear, rep = { codes: P.codesOn(), ao: P.ao.on, fol: P.fol && P.ao.on, rt: P.rt.on, A: null, B: null, AO: null, SSR: null, F: null };
      P.passes = 0;
      hideOver(scene);
      try {
        if (rep.codes) { sceneTo(scene, camera, false); rep.B = health(rtScene.texture, 0, rtScene.depthTexture); }
        sceneTo(scene, camera, true);
        st.scene = r.info.render.calls;
        rep.A = health(rtScene.texture, 0, rtScene.depthTexture);
        r.autoClear = false;
        const ssrOn = ssrWanted();
        if (ssrOn) { ssrPass(camera); rep.SSR = health(rtSSR.texture, 2, null); }
        if (P.ao.on) { aoPasses(camera); rep.AO = health(rtAO.texture, 1, null); }
        const k = P.bloom.on && P.bloom.strength > 0 && B.length ? bloomPasses() : 0;
        compSet(camera, ssrOn, k).uLuma.value = 0; pass(M.comp, rtLdr);   // сборка — в свой буфер (на экран — ниже, как обычно)
        rep.F = health(rtLdr.texture, 3, null);
      } catch (e) { rep.err = String(e && e.message || e).slice(0, 120); }
      finish(camera);
      r.autoClear = ac;
      st.post = r.info.render.calls - st.scene;
      return rep;
    };
    // трава и листва в AO: выкл — проход AO собирается без них (D37_FOL), и сцена кодов травы не пишет
    P.setFol = on => {
      on = !!on && !P.off.fol && !P.off.codes;
      if (on === P.fol) return;
      P.fol = on;
      if (M.ao) { if (on) M.ao.defines.D37_FOL = ''; else delete M.ao.defines.D37_FOL; M.ao.needsUpdate = true; }
    };
    // страж графики: выключить то, что на этом устройстве не работает (не собралось, рисует не то) — до новой версии сайта
    // codes — коды в альфе (трава в AO и блеск для отражений), fol — трава в AO, ao — AO (и контактные тени), rt — трассировка,
    // fg — генерация кадров, nis / fsr — апскейлеры, fxaa, bloom — свечение, post — вся постобработка (кадр — прямо на холст)
    P.disable = k => {
      P.off[k] = true;
      if (k === 'fol' || k === 'codes') P.setFol(false);
      if (k === 'codes' || k === 'rt' || k === 'ao') P.noRT = true;
      if (k === 'ao') P.canAO = false;
      if (k === 'fg') { P.fg.ok = false; P.setFg(false); }
      if (k === 'nis') P.noNIS = true;
      if (k === 'fsr') P.noFSR = true;
      if (k === 'fxaa') P.noFXAA = true;
      if (k === 'bloom') P.bloom.on = false;
      if (k === 'post') P.on = false;
      if (P.noRT && P.rt.mode !== 'off') { P.rt.mode = 'off'; R.rtMarkAll?.(false); }
      if (!P.canAO) P.ao.mode = 'off';
      P.setUpscaler(P.upscaler, P.sharp);
      if (P.w > 1) P.setSize(P.w, P.h, P.pr);
    };
    // Промежуточный кадр: прошлый готовый кадр под новую камеру. movers — [[x, y, z, r, h, dx, dy, dz], …] (центр низа
    // цилиндра на настоящем кадре, радиус, высота, сдвиг с тех пор). false — нечего перекладывать (нужен настоящий кадр)
    const vpNow = new T.Matrix4();
    P.renderGen = (camera, movers = []) => {
      if (!P.fg.on || !P.fg.have || !rtOut || !M.fg) return false;
      camera.updateMatrixWorld();
      vpNow.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const u = M.fg.uniforms, n = Math.min(E.FG.MAXMOV, movers.length);
      u.tColor.value = rtOut.texture; u.tDepth.value = rtScene.depthTexture; u.uInvVP.value.copy(P.fg.ivp); u.uVP.value.copy(vpNow); u.uSize.value.set(P.ow, P.oh);
      for (let i = 0; i < n; i++) { const m = movers[i]; u.uMovA.value[i].set(m[0], m[1], m[2], m[3]); u.uMovB.value[i].set(m[5], m[6], m[7], m[4]); }
      u.uMovN.value = n;
      P.passes = 0; r.autoClear = false;
      pass(M.fg, null);
      r.autoClear = true;
      P.fg.gen++;
      return true;
    };
    P._test = { M, pass, rt: () => ({ scene: rtScene, ldr: rtLdr, up: rtUp, ao: rtAO, ssr: rtSSR, out: rtOut }) };   // проверки: шейдеры и проходы
    P.dispose = () => {
      rtScene.dispose(); rtScene.depthTexture?.dispose(); rtLdr.dispose(); rtUp?.dispose(); rtAO?.dispose(); rtAO2?.dispose(); for (const b of B) b.dispose();
      coefTex?.dispose(); rtSSR?.dispose(); rtOut?.dispose(); hRT?.dispose();
      for (const k in M) M[k].dispose();
      tri.dispose();
    };
    return P;
  };

  // ═══ Страж графики (16.10.2026; после «чёрной земли» на телефоне владельца 15.10) ═══
  // Драйверы шейдеров на телефонах строже и с ошибками (компьютер — ANGLE на Direct3D — многое прощает), а узнать о поломке
  // можно было только по скриншоту. Теперь движок проверяет себя сам (E.gfxGuard(R) — render.js, R.guard):
  //  • программа шейдера не собралась (three r149: program.diagnostics.runnable === false; смотрим r.info.programs): проход
  //    постобработки → выключаем только его (трава в AO → AO, трассировка, генерация кадров, NIS, FSR, FXAA, свечение;
  //    сборка кадра → без постобработки); программа сцены → без своих кусков шейдеров (E.gfxUnpatch; мир пересобирается),
  //    не помогло → «низкая» графика (событие d37:gfxfallback { rebuild } — игра пересобирает мир, mir.js);
  //  • самопроверка кадра (P.selfTest: 45-й кадр, через 15 с, через 1,5 мин и после смены настроек): коды в альфе меняют
  //    ЦВЕТ сцены (должны — только альфу) → без кодов; AO — «не числа» или почти весь чёрный → без травы в AO, потом без AO;
  //    отражения — «не числа» → без трассировки; сборка гасит яркую сцену → без AO, потом без постобработки; днём весь кадр
  //    чёрный или в сцене «не числа» (2 проверки подряд) → без кодов → без своих кусков → «низкая»;
  //  • решения помнятся (localStorage d37_gfx_guard) до новой версии сайта (GAMES_VER) или «↺ Вернуть всё» в ⚙️ → Графика;
  //  • сообщает — без личных данных: Vercel Analytics и цель Метрики 'gfx_fallback' { what, why, prog, gpu, q, v } (что,
  //    почему, какая программа/проверка, видеокарта — семейство и модель, качество, версия); 'gfx_dark' — днём тёмная земля
  //    (только сообщить).
  const GKEY = 'd37_gfx_guard';
  const POSTK = ['codes', 'fol', 'ao', 'rt', 'fg', 'nis', 'fsr', 'fxaa', 'bloom', 'post', 'test'];
  const PROGK = { pre: 'bloom', down: 'bloom', up: 'bloom', comp: 'post', fxaa: 'fxaa', easu: 'fsr', rcas: 'fsr', nis: 'nis', nisS: 'nis', ao: 'ao', aob: 'ao', ssr: 'rt', fg: 'fg', copy: 'fg', health: 'test' };
  E.GUARD = { KEY: GKEY, POSTK, PROGK };
  const gVer = () => { try { return typeof GAMES_VER !== 'undefined' ? String(GAMES_VER) : ''; } catch (e) { return ''; } };   // eslint-disable-line no-undef
  E.gfxGuardState = () => {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(GKEY) || 'null'); } catch (e) {}
    if (!s || typeof s !== 'object' || s.v !== gVer() || !s.off || typeof s.off !== 'object' || Array.isArray(s.off)) s = { v: gVer(), off: {}, why: [] };
    if (!Array.isArray(s.why)) s.why = [];
    return s;
  };
  const gSave = s => { try { localStorage.setItem(GKEY, JSON.stringify(s)); } catch (e) {} };
  E.gfxSafe = (k = 'patch') => !!E.gfxGuardState().off[k];
  // что выключено и почему (⚙️ → Графика): { off: [ключи], why: [{ k, why, prog, t }] }
  E.gfxGuardInfo = () => { const s = E.gfxGuardState(); return { off: Object.keys(s.off).filter(k => s.off[k]), why: s.why.slice() }; };
  // «↺ Вернуть всё»: забыть решения; игра пересобирает мир (свои куски шейдеров — снова, gfx.js E.gfxPatch)
  E.gfxGuardReset = () => {
    try { localStorage.removeItem(GKEY); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('d37:gfxfallback', { detail: { k: 'reset', rebuild: true } })); } catch (e) {}
  };
  // видеокарта: семейство и модель (без версии драйвера) — для отчёта
  E.gpuInfo = gl => {
    let s = '';
    try { const x = gl.getExtension('WEBGL_debug_renderer_info'); s = String(gl.getParameter(x ? x.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || ''); } catch (e) {}
    s = s.replace(/\((?:tm|r)\)/gi, ' ');
    const l = s.toLowerCase();
    const fam = /adreno/.test(l) ? 'adreno' : /mali/.test(l) ? 'mali' : /powervr|img tec/.test(l) ? 'powervr' : /xclipse/.test(l) ? 'xclipse' : /maleoon/.test(l) ? 'maleoon'
      : /swiftshader|llvmpipe|software/.test(l) ? 'soft' : /apple/.test(l) ? 'apple' : /nvidia|geforce|quadro|rtx/.test(l) ? 'nvidia' : /radeon|amd/.test(l) ? 'amd' : /intel/.test(l) ? 'intel' : 'other';
    const m = s.match(/adreno\s*\d{3}[a-z]?|mali-[a-z]*\d+[a-z0-9]*|powervr [a-z]+[ -]?[a-z0-9]*|xclipse \d+|maleoon \d+|apple [a-z0-9]+(?: gpu)?|geforce [a-z]+ \d+(?: ti)?|radeon(?: [a-z]+)? ?[a-z]*\d+[a-z]*|intel[^,(]*graphics(?: \d+)?/i);
    return { fam, model: (fam === 'soft' || !m ? fam : m[0]).replace(/\s+/g, ' ').trim().slice(0, 32) };
  };
  const gSent = new Set();
  const gSend = (name, data) => {
    const key = [name, data.what, data.why, data.prog].join('|');
    if (gSent.has(key) || gSent.size > 24) return;
    gSent.add(key);
    try { if (typeof window.va === 'function') window.va('event', { name, data }); } catch (e) {}
    try { if (typeof window.ym === 'function') window.ym(113596397, 'reachGoal', name, data); } catch (e) {}   // счётчик Метрики сайта (index.html)
  };
  E.gfxGuard = R => {
    const r = R.r, T = R.T, P = R.post, gl = typeof r.getContext === 'function' ? r.getContext() : null;
    if (!gl) return null;
    const G = { n: 0, st: E.gfxGuardState(), seen: new WeakSet(), testAt: 45, tests: 0, last: null, sig: '', black: 0, nanN: 0, wait: false,
      gpu: E.gpuInfo(gl), log: [], cb: null };
    try { r.debug.checkShaderErrors = true; } catch (e) {}
    if (P) for (const k of POSTK) if (G.st.off[k]) P.disable(k);   // запомненное — сразу, до первого кадра
    const on = k => !G.st.off[k];
    const base = () => ({ gpu: G.gpu.model, q: R.q, v: gVer() });
    // контекст WebGL потерян (телефон выгрузил видеопамять, сбой драйвера, вкладка долго в фоне): кадр не рисуется, чтение
    // даёт нули — это НЕ поломка шейдеров. Пока потерян — ни проверок, ни решений (иначе запомнили бы «без AO» навсегда);
    // вернётся — three.js сам всё пересоздаст
    const lost = () => { try { return !!gl.isContextLost?.(); } catch (e) { return false; } };
    G.lost = lost;
    function off(k, why, prog = ''){
      if (lost()) { G.log.push('lost:' + k); return false; }
      const s = E.gfxGuardState();
      if (s.off[k] || G.st.off[k]) { G.st = s; G.st.off[k] = 1; return false; }
      s.off[k] = 1; s.why.push({ k, why, prog: String(prog).slice(0, 40), t: Date.now() });
      if (s.why.length > 20) s.why.splice(0, s.why.length - 20);
      G.st = s; gSave(s);
      G.log.push(k + ':' + why + (prog ? ':' + prog : ''));
      try { console.warn(`🛡 Страж графики: выключено «${k}» (${why}${prog ? ': ' + prog : ''}) — ${G.gpu.model}`); } catch (e) {}
      gSend('gfx_fallback', { what: k, why, prog: String(prog).slice(0, 40), ...base() });
      let rebuild = false;
      if (POSTK.includes(k)) { P?.disable(k); R.reapplyGfx?.(); G.testAt = Math.min(G.testAt, G.n + 30); }   // через полсекунды — помогло ли
      else { if (k === 'patch') E.gfxUnpatch?.(T); G.wait = true; rebuild = true; }   // нужен новый рендерер: игра пересоберёт мир
      try { window.dispatchEvent(new CustomEvent('d37:gfxfallback', { detail: { k, why, prog, rebuild } })); } catch (e) {}
      return true;
    }
    // сцена: по ступеньке — коды в альфе → свои куски шейдеров → «низкая» (не собралось — коды не помогут: это не текст шейдера)
    function ladder(why, prog = ''){
      if (G.wait) return;
      if (why !== 'link' && P?.codesOn?.() && on('codes')) { off('codes', why, prog); return; }
      if (on('patch') && T.ShaderChunk?.__d37) { off('patch', why, prog); return; }
      if (on('tier') && R.q !== 'low') { off('tier', why, prog); return; }
      gSend('gfx_fallback', { what: 'none', why, prog: String(prog).slice(0, 40), ...base() });
    }
    // чья программа: прохода постобработки (материалы P) или сцены (имя материала: sky, water… или тип)
    function label(p){
      const M = P?._test?.M || {};
      for (const k in M) if (r.properties.get(M[k])?.currentProgram === p) return { post: k };
      let name = p.name || 'scene';
      try { R.scene.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) if (r.properties.get(m)?.currentProgram === p) name = m.name || m.type || name; }); } catch (e) {}
      return { scene: name };
    }
    function scan(){
      if (lost()) return;
      const L = r.info?.programs || [];
      for (const p of L) {
        if (!p || G.seen.has(p) || !p.diagnostics || p.diagnostics.runnable !== false) continue;
        G.seen.add(p);
        const d = p.diagnostics, lb = label(p);
        G.lastLog = String(d.fragmentShader?.log || d.vertexShader?.log || d.programLog || '').replace(/\s+/g, ' ').slice(0, 160);
        if (lb.post) off(lb.post === 'ao' && P?.fol && on('fol') ? 'fol' : PROGK[lb.post] || 'post', 'link', lb.post);
        else ladder('link', lb.scene);
      }
    }
    G.scan = scan;
    // ── разбор самопроверки (байты 16×12×4: rgb, a — 255 точка / ~128 небо / 0 «не число») ──
    const L8 = (b, i, hdr) => {
      let x = b[i] / 255, y = b[i + 1] / 255, z = b[i + 2] / 255;
      if (hdr) { x /= Math.max(1e-3, 1 - x); y /= Math.max(1e-3, 1 - y); z /= Math.max(1e-3, 1 - z); }
      return .2126 * x + .7152 * y + .0722 * z;
    };
    const sums = (b, hdr) => {
      const o = { total: b.length / 4, bad: 0, n: 0, sky: 0, ground: 0, black: 0, gblack: 0 };
      for (let i = 0; i < b.length; i += 4) {
        const f = b[i + 3]; if (!f) { o.bad++; continue; }
        o.n++; const L = L8(b, i, hdr);
        if (L < .003) o.black++;
        if (f < 192) o.sky++; else { o.ground++; if (L < .004) o.gblack++; }
      }
      return o;
    };
    const codesDiff = (A, B) => {   // цвет с кодами и без — должен совпасть (коды пишут только альфу)
      let n = 0, bad = 0;
      for (let i = 0; i < A.length; i += 4) {
        if (!B[i + 3]) continue;
        n++;
        if (!A[i + 3] || Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) > 4) bad++;
      }
      return { n, bad };
    };
    const aoSums = b => {
      const o = { total: b.length / 4, bad: 0, n: 0, mean: 1, low: 0 }; let s = 0;
      for (let i = 0; i < b.length; i += 4) { const f = b[i + 3]; if (!f) { o.bad++; continue; } if (f < 192) continue; const a = b[i] / 255; o.n++; s += a; if (a < .08) o.low++; }
      if (o.n) o.mean = s / o.n;
      return o;
    };
    const crushed = (A, F) => {   // яркое в сцене (≥ 0,05) → в готовом кадре почти чёрное (< 0,03 в sRGB)
      let n = 0, bad = 0;
      for (let i = 0; i < A.length; i += 4) { if (A[i + 3] < 192 || L8(A, i, true) < .05) continue; n++; if (L8(F, i, false) < .03) bad++; }
      return { n, bad };
    };
    const dayLike = () => { const M = R.sky, Lg = R.lighting || {}; return !!M && M.lightI > .4 && (Lg.brightness ?? 1) >= .5 && (Lg.ambient ?? 1) >= .3; };
    function judge(rep){
      G.tests++; G.last = rep;
      const out = rep.sum = {};
      if (rep.err || !rep.A) { off('test', 'error', rep.err || 'нет данных'); return; }
      const A = out.A = sums(rep.A, true);
      if (rep.B) { const d = out.codes = codesDiff(rep.A, rep.B); if (d.bad >= 2 && d.bad >= d.n * .01) { off('codes', 'color', `${d.bad}/${d.n}`); return; } }
      if (A.bad >= 4 && A.bad >= A.total * .02) { if (++G.nanN >= 2) { ladder('nan', `${A.bad}/${A.total}`); return; } } else G.nanN = 0;
      if (rep.AO) {
        const a = out.ao = aoSums(rep.AO);
        if (a.bad >= Math.max(3, a.total * .02) || (a.n >= 24 && (a.mean < .35 || a.low > a.n * .4))) { off(P.fol && on('fol') ? 'fol' : 'ao', 'ao', `${a.mean.toFixed(2)}/${a.low}/${a.bad}`); return; }
      }
      if (rep.SSR) { const s = out.ssr = sums(rep.SSR, true); if (s.bad >= Math.max(3, s.total * .02)) { off('rt', 'nan', 'ssr'); return; } }
      if (rep.F) {
        const c = out.comp = crushed(rep.A, rep.F);
        if (c.n >= 12 && c.bad > c.n * .25) { off(P.ao.on && on('ao') ? (P.fol && on('fol') ? 'fol' : 'ao') : 'post', 'crush', `${c.bad}/${c.n}`); return; }
      }
      // «днём чёрный кадр» — только где темно не бывает (игра ставит R.guardBlack: «Мир Денчика»); в пещерах «Кубомира»,
      // тёмных мирах студии чёрный кадр днём — нормально
      const day = out.day = dayLike() && !!R.guardBlack;
      if (day && A.n >= 96 && A.black >= A.n * .9) { if (++G.black >= 2) ladder('black', `${A.black}/${A.n}`); } else G.black = 0;
      if (day && A.ground >= 48 && A.gblack >= A.ground * .5) gSend('gfx_dark', { what: 'ground', why: 'day', prog: `${A.gblack}/${A.ground}`, ...base() });
    }
    // render.js: пора ли проверить кадр (вместо обычного P.render)
    G.due = () => !G.wait && !!P && P.on && on('test') && !!P.canTest?.() && G.n >= G.testAt && G.tests < 12 && !lost();
    G.test = (scene, camera) => {
      const k = G.tests, rep = P.selfTest(scene, camera);
      if (lost()) { G.testAt = G.n + 120; G.log.push('lost:test'); return rep; }   // потерялся во время проверки — нули не считаются
      G.testAt = k === 0 ? G.n + 900 : k === 1 ? G.n + 5400 : Infinity;   // через 15 с и через 1,5 мин; дальше — после смены настроек
      const n0 = G.log.length;
      try { scan(); } catch (e) {}   // не собравшаяся программа — главнее чисел (её проход ничего не нарисовал)
      if (G.log.length > n0) { G.tests++; G.last = rep; rep.sum = { link: G.log.slice(n0) }; }
      else try { judge(rep); } catch (e) { console.warn('страж графики:', e); }
      if (G.cb) { const f = G.cb; G.cb = null; try { f(G.report()); } catch (e) {} }
      return rep;
    };
    // ⚙️ «🩺 Проверить»: проверка на следующем кадре, f(отчёт)
    G.check = f => { G.cb = f || null; G.testAt = G.n + 1; if (G.tests >= 12) G.tests = 11; try { scan(); } catch (e) {} };
    G.report = () => ({ tests: G.tests, programs: (r.info?.programs || []).length, failed: (r.info?.programs || []).filter(p => p?.diagnostics?.runnable === false).length,
      sum: G.last?.sum || null, err: G.last?.err || '', log: G.log.slice(), off: E.gfxGuardInfo().off, gpu: G.gpu, lastLog: G.lastLog || '' });
    // после каждого настоящего кадра (render.js)
    G.tick = () => {
      if (R.dead || lost()) return;   // без контекста кадров нет — и счёт кадров стоит
      G.n++;
      if (G.n === 2 || G.n === 10 || G.n === 40 || G.n === G.scanAt || G.n % 300 === 0) { try { scan(); } catch (e) {} }
      if (G.n === 60) { try { const e = gl.getError(); if (e && e !== gl.CONTEXT_LOST_WEBGL) gSend('gfx_glerror', { what: 'gl', why: String(e), prog: '', ...base() }); } catch (e) {} }
      if (P) {   // включили/выключили AO, трассировку, траву, свечение, постобработку — проверить кадр заново (чуть позже)
        const sig = `${P.on}|${P.ao.on}|${P.rt.on}|${P.fol}|${P.bloom.on}`, sig2 = `${P.upscaler}|${P.fxaa}|${P.scaled}|${P.fg.on}`;
        if (sig !== G.sig) { if (G.sig) G.testAt = Math.min(G.testAt, G.n + 20); G.sig = sig; }
        if (sig + sig2 !== G.sig2) { if (G.sig2) G.scanAt = G.n + 2; G.sig2 = sig + sig2; }   // новые проходы — их программы проверить сразу
      }
    };
    return G;
  };
})();
