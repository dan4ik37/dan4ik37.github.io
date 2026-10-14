// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — постобработка (своя, без библиотек): сцена → буфер HDR (половинные float) → свечение неона (bloom:
//  маска в альфе + цепочка mip-размытия) → вывод в sRGB → сглаживание FXAA (или MSAA буфера на «высоком»)
// ═══════════════════════════════════════
// P = D37E.post(R) — создаёт render.js сам (R.post), если качество не low. Кадр: P.render(scene, camera) вместо r.render.
// Размер буфера сцены — P.setSize(w, h, плотность пикселей): меньше холста = динамическое разрешение (растягиваем при выводе).
// Тональная кривая (ACES) — как и раньше, в материалах; здесь только перевод в sRGB, поэтому небо, вода, стекло, неон
// и подписи поверх выглядят как без постобработки. Свечение: материал с R.bloom(m, сила) пишет в альфу буфера 1 + сила
// (непрозрачные у three.js иначе пишут ровно 1, прозрачные смешиваются к 1) — светится только то, что помечено:
// неон, лампочки, ореолы ламп. P.bloom = { on, strength, levels }; P.fxaa / P.msaa — что сглаживает сейчас.
// MSAA (4×) — только high, WebGL2 и плотность ≤ 1,25 (на «ретине» дорого и почти не видно) — иначе FXAA.
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
  // сборка: сцена + свечение (как «экран»: на ярком почти не добавляет; на самом светящемся — четверть, ореол — вокруг:
  // неон не выгорает в белое и не меняет цвет) → sRGB; яркость (luma) — в альфу для FXAA. Сразу на экран (MSAA, uLuma = 0) —
  // альфа строго 1: холст прозрачный, и тёмное просвечивало светлым фоном страницы (картинка «в белой дымке» на high)
  const FS_COMP = `uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom; uniform float uLuma; varying vec2 vUv;
void main(){ vec4 s = texture2D(tScene, vUv); vec3 c = max(s.rgb, vec3(0.0));
  if (uBloom > 0.0) { vec3 b = texture2D(tBloom, vUv).rgb * uBloom * (1.0 - 0.75 * clamp(s.a - 1.0, 0.0, 1.0)); c += b * clamp(1.0 - c, 0.0, 1.0); }
  c = LinearTosRGB(vec4(c, 1.0)).rgb;
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
      bloom: { on: o.bloom !== false && half, strength: q === 'high' ? 1 : .9, levels: q === 'high' ? 5 : 4 } };
    const sceneOpt = { type, depthBuffer: true, stencilBuffer: false };
    let rtScene = new T.WebGLRenderTarget(1, 1, sceneOpt);
    const rtLdr = new T.WebGLRenderTarget(1, 1, { depthBuffer: false });
    const rtUp = gl2 ? new T.WebGLRenderTarget(1, 1, { depthBuffer: false }) : null, DB = new T.Vector2();   // FSR: EASU → сюда (размер холста)
    const B = [];
    const mk = (fs, uniforms, add) => new T.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, toneMapped: false,
      blending: add ? T.CustomBlending : T.NoBlending, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendEquation: T.AddEquation });
    const tx = () => ({ tSrc: { value: null }, uTexel: { value: new T.Vector2() } });
    const M = {
      pre: mk(FS_PRE, tx()), down: mk(FS_DOWN, tx()), up: mk(FS_UP, tx(), true),
      comp: mk(FS_COMP, { tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0 }, uLuma: { value: 1 } }), fxaa: mk(FS_FXAA, tx()),
    };
    if (gl2) {
      M.easu = mk(FS_EASU, { tSrc: { value: null }, uIn: { value: new T.Vector2() }, uOut: { value: new T.Vector2() } });
      M.rcas = mk(FS_RCAS, { tSrc: { value: null }, uSize: { value: new T.Vector2() }, uSharp: { value: Math.pow(2, -.2) } });   // 0,2 ступени — как в FSR по умолчанию
    }
    // один треугольник на весь экран; матрицы не нужны
    const tri = new T.BufferGeometry();
    tri.setAttribute('position', new T.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    tri.setAttribute('uv', new T.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    const pscene = new T.Scene(), pcam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new T.Mesh(tri, M.comp);
    quad.frustumCulled = false; quad.matrixAutoUpdate = false; pscene.add(quad); pscene.matrixWorldAutoUpdate = false; pscene.updateMatrixWorld(true);
    function pass(mat, target){ quad.material = mat; r.setRenderTarget(target); r.render(pscene, pcam); P.passes++; }

    P.setSize = (w, h, pr = 1) => {
      P.w = w; P.h = h; P.pr = pr;
      const scaled = P.scaled = pr < (R.pr0 || 1) - .001;   // динамическое разрешение опустило — кадр растягиваем (FSR)
      if (rtUp) { r.getDrawingBufferSize(DB); P.ow = Math.max(1, DB.x); P.oh = Math.max(1, DB.y); rtUp.setSize(P.ow, P.oh); }
      const ms = gl2 && q === 'high' && o.msaa !== false && pr <= 1.25 && !scaled ? 4 : 0;
      if (ms !== rtScene.samples) { rtScene.dispose(); rtScene = new T.WebGLRenderTarget(w, h, { ...sceneOpt, samples: ms }); }
      else rtScene.setSize(w, h);
      P.msaa = ms;
      P.fxaa = !ms;   // нет MSAA (mid, «ретина», уменьшенный кадр) — сглаживает FXAA
      rtLdr.setSize(w, h);
      let bw = Math.max(1, w >> (q === 'high' ? 1 : 2)), bh = Math.max(1, h >> (q === 'high' ? 1 : 2));
      for (let i = 0; i < P.bloom.levels; i++) {
        if (!B[i]) B[i] = new T.WebGLRenderTarget(bw, bh, { type, depthBuffer: false }); else B[i].setSize(bw, bh);
        bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      }
    };
    function bloomPasses(){
      const n = Math.min(P.bloom.levels, B.length);
      M.pre.uniforms.tSrc.value = rtScene.texture; M.pre.uniforms.uTexel.value.set(1 / P.w, 1 / P.h);
      pass(M.pre, B[0]);
      for (let i = 0; i < n - 1; i++) { M.down.uniforms.tSrc.value = B[i].texture; M.down.uniforms.uTexel.value.set(1 / B[i].width, 1 / B[i].height); pass(M.down, B[i + 1]); }
      for (let i = n - 2; i >= 0; i--) { M.up.uniforms.tSrc.value = B[i + 1].texture; M.up.uniforms.uTexel.value.set(1 / B[i + 1].width, 1 / B[i + 1].height); pass(M.up, B[i]); }
      return P.bloom.strength * 1.5 / n;   // сумма уровней ≈ n × исходное — к «одному исходному» × сила
    }
    P.render = (scene, camera) => {
      const st = R.stats, ac = r.autoClear;
      P.passes = 0;
      r.setRenderTarget(rtScene); r.autoClear = true;
      r.render(scene, camera);
      st.scene = r.info.render.calls;
      r.autoClear = false;   // проходы закрашивают весь кадр — чистить нечего
      const k = P.bloom.on && P.bloom.strength > 0 && B.length ? bloomPasses() : 0;
      const U = M.comp.uniforms; U.tScene.value = rtScene.texture; U.tBloom.value = B[0]?.texture || null; U.uBloom.value = k; U.uLuma.value = P.fxaa ? 1 : 0;
      if (P.fsr && P.scaled && M.easu) {   // FSR 1: сборка в уменьшенный буфер → EASU до размера холста → RCAS на экран
        U.uLuma.value = 0; pass(M.comp, rtLdr);
        const ue = M.easu.uniforms; ue.tSrc.value = rtLdr.texture; ue.uIn.value.set(P.w, P.h); ue.uOut.value.set(P.ow, P.oh); pass(M.easu, rtUp);
        const ur = M.rcas.uniforms; ur.tSrc.value = rtUp.texture; ur.uSize.value.set(P.ow, P.oh); pass(M.rcas, null);
      }
      else if (P.fxaa) { pass(M.comp, rtLdr); M.fxaa.uniforms.tSrc.value = rtLdr.texture; M.fxaa.uniforms.uTexel.value.set(1 / P.w, 1 / P.h); pass(M.fxaa, null); }
      else pass(M.comp, null);
      r.autoClear = ac;
      st.post = r.info.render.calls - st.scene;
    };
    P.dispose = () => {
      rtScene.dispose(); rtLdr.dispose(); rtUp?.dispose(); for (const b of B) b.dispose();
      for (const k in M) M[k].dispose();
      tri.dispose();
    };
    return P;
  };
})();
