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
  // сборка: сцена + свечение → sRGB; яркость (luma) — в альфу для FXAA
  const FS_COMP = `uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom; varying vec2 vUv;
void main(){ vec3 c = texture2D(tScene, vUv).rgb;
  if (uBloom > 0.0) c += texture2D(tBloom, vUv).rgb * uBloom;
  c = LinearTosRGB(vec4(max(c, vec3(0.0)), 1.0)).rgb;
  gl_FragColor = vec4(c, dot(min(c, vec3(1.0)), vec3(0.299, 0.587, 0.114))); }`;
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

  E.post = function (R, o = {}){
    const T = R.T, r = R.r, q = R.q, ext = r.extensions, gl2 = r.capabilities.isWebGL2;
    // буфер сцены: половинные float (значения > 1 и маска свечения в альфе); нет — обычный (без свечения)
    const half = gl2 ? ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')
      : ext.has('OES_texture_half_float') && ext.has('OES_texture_half_float_linear') && ext.has('EXT_color_buffer_half_float');
    const type = half ? T.HalfFloatType : T.UnsignedByteType;
    const P = { ok: true, on: true, hdr: half, msaa: 0, fxaa: true, w: 1, h: 1, pr: 1, passes: 0,
      bloom: { on: o.bloom !== false && half, strength: q === 'high' ? 1 : .9, levels: q === 'high' ? 5 : 4 } };
    const sceneOpt = { type, depthBuffer: true, stencilBuffer: false };
    let rtScene = new T.WebGLRenderTarget(1, 1, sceneOpt);
    const rtLdr = new T.WebGLRenderTarget(1, 1, { depthBuffer: false });
    const B = [];
    const mk = (fs, uniforms, add) => new T.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, toneMapped: false,
      blending: add ? T.CustomBlending : T.NoBlending, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendEquation: T.AddEquation });
    const tx = () => ({ tSrc: { value: null }, uTexel: { value: new T.Vector2() } });
    const M = {
      pre: mk(FS_PRE, tx()), down: mk(FS_DOWN, tx()), up: mk(FS_UP, tx(), true),
      comp: mk(FS_COMP, { tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0 } }), fxaa: mk(FS_FXAA, tx()),
    };
    // один треугольник на весь экран; матрицы не нужны
    const tri = new T.BufferGeometry();
    tri.setAttribute('position', new T.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    tri.setAttribute('uv', new T.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    const pscene = new T.Scene(), pcam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new T.Mesh(tri, M.comp);
    quad.frustumCulled = false; quad.matrixAutoUpdate = false; pscene.add(quad); pscene.matrixWorldAutoUpdate = false; pscene.updateMatrixWorld(true);
    function pass(mat, target){ quad.material = mat; r.setRenderTarget(target); r.render(pscene, pcam); P.passes++; }

    P.setSize = (w, h, pr = 1) => {
      P.w = w; P.h = h; P.pr = pr;
      const ms = gl2 && q === 'high' && o.msaa !== false && pr <= 1.25 ? 4 : 0;
      if (ms !== rtScene.samples) { rtScene.dispose(); rtScene = new T.WebGLRenderTarget(w, h, { ...sceneOpt, samples: ms }); }
      else rtScene.setSize(w, h);
      P.msaa = ms;
      P.fxaa = !ms || pr < (R.pr0 || 1) - .001;   // нет MSAA или кадр растягиваем — сглаживаем FXAA
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
      return 2 * P.bloom.strength / (n + 1);
    }
    P.render = (scene, camera) => {
      const st = R.stats, ac = r.autoClear;
      P.passes = 0;
      r.setRenderTarget(rtScene); r.autoClear = true;
      r.render(scene, camera);
      st.scene = r.info.render.calls;
      r.autoClear = false;   // проходы закрашивают весь кадр — чистить нечего
      const k = P.bloom.on && P.bloom.strength > 0 && B.length ? bloomPasses() : 0;
      const U = M.comp.uniforms; U.tScene.value = rtScene.texture; U.tBloom.value = B[0]?.texture || null; U.uBloom.value = k;
      if (P.fxaa) { pass(M.comp, rtLdr); M.fxaa.uniforms.tSrc.value = rtLdr.texture; M.fxaa.uniforms.uTexel.value.set(1 / P.w, 1 / P.h); pass(M.fxaa, null); }
      else pass(M.comp, null);
      r.autoClear = ac;
      st.post = r.info.render.calls - st.scene;
    };
    P.dispose = () => {
      rtScene.dispose(); rtLdr.dispose(); for (const b of B) b.dispose();
      for (const k in M) M[k].dispose();
      tri.dispose();
    };
    return P;
  };
})();
