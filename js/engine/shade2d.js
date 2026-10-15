// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — ШЕЙДЕРЫ 2D: наборы «Обычные / Красивые / Ультра / Ретро» и постобработка для 2D-игр (docs/SHADERS2D.md)
// ═══════════════════════════════════════
// Набор выбирает игрок: ⚙️ → Графика → «Шейдеры» (D37Settings 'shaders': auto | normal | pretty | ultra | retro; 'crt' — полоски
// старого телевизора для «Ретро»), на живую — D37Opt.gfx.shaders / .crt. «Авто» — по пресету графики и устройству.
//   D37E.shade2d.pack()        → 'normal' | 'pretty' | 'ultra' | 'retro' (что сейчас действует)
//   D37E.shade2d.flags()       → что включено: { id, q (0…3 — детали в своих шейдерах игры), smooth (плавный свет), post, bloom,
//                                bloomBlur, distort, vignette, grade, pixel (во сколько раз крупнее пиксели), posterize, crt, particles }
//   D37E.shade2d.create(gl)    → постобработка своего WebGL2-рисовальщика: P.begin(w, h) — рисуй кадр в его буфер (true) или как
//                                раньше прямо на экран (false); P.end(params) — кадр на экран: свечение (bloom), рябь воды и дрожь
//                                воздуха над лавой (поле искажений P.field), цвет кадра, виньетка, ретро (крупные пиксели, меньше
//                                оттенков, полоски CRT). Не собралось или рисует чёрным (проверка при создании) — P.ok = false.
//   D37E.shade2d.overlay(canvas) → то же для игр на Canvas 2D (старый 2D-мир, «Орда», «Арена»…): WebGL-холст поверх, свет-«пятна»
//                                (O.light), темнота вокруг (O.dark), тот же набор эффектов. Пока не подключён к играм — заготовка.
//   D37E.shade2d.GLSL          → куски шейдеров для своих 2D-шейдеров (свет как в Террарии, шум, тень у стен, вода, лава) —
//                                «Подземье» собирает из них свой шейдер клеток.
// Телефоны: все сэмплеры highp (на телефоне lowp-сэмплер даёт fp16 — «пятна»), smoothstep только с edge0 < edge1, без
// расширений WebGL; в «Авто» на телефоне — «Обычные» (без постобработки).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  if (E.shade2d) return;

  // ── Наборы ──
  const PACKS = {
    normal: { name: 'Обычные', q: 1, smooth: true, post: false, bloom: 0, bloomBlur: 0, distort: false, vignette: 0, grade: false, pixel: 1, posterize: 0, crt: false, particles: 1 },
    pretty: { name: 'Красивые', q: 2, smooth: true, post: true, bloom: .55, bloomBlur: 1, distort: true, vignette: .22, grade: true, pixel: 1, posterize: 0, crt: false, particles: 1.5 },
    ultra: { name: 'Ультра', q: 3, smooth: true, post: true, bloom: .7, bloomBlur: 2, distort: true, vignette: .26, grade: true, pixel: 1, posterize: 0, crt: false, particles: 2.5 },
    retro: { name: 'Ретро', q: 0, smooth: false, post: true, bloom: 0, bloomBlur: 0, distort: false, vignette: .3, grade: false, pixel: 2, posterize: 24, crt: false, particles: 1 },
  };
  const LIST = ['auto', 'normal', 'pretty', 'ultra', 'retro'];
  const device = () => { try { return E.quality ? E.quality() : 'mid'; } catch (e) { return 'mid'; } };
  // «Авто»: пресет графики (низкая/средняя → «Обычные», высокая → «Красивые», ультра → «Ультра»); «Авто»/«Своя» — по устройству
  function autoPack(g){
    const p = g?.preset;
    if (p === 'ultra') return 'ultra';
    if (p === 'high') return 'pretty';
    if (p === 'low' || p === 'mid') return 'normal';
    return device() === 'high' ? 'pretty' : 'normal';
  }
  function pack(){
    const g = root.D37Opt?.gfx || {}, v = g.shaders;
    return PACKS[v] ? v : autoPack(g);
  }
  function flags(){
    const id = pack(), f = Object.assign({ id }, PACKS[id]);
    if (id === 'retro') f.crt = !!root.D37Opt?.gfx?.crt;
    if (id === 'normal' && device() === 'low') f.q = 0;   // слабый телефон: «Обычные» без мелочей
    if (root.document?.body?.classList?.contains?.('low') && f.q > 1) f.q = 1;   // «Экономный» режим сайта
    return f;
  }
  // подписка: сменили набор (или пресет графики) — fn(pack)
  const subs = new Set();
  let lastRev = -1, lastPack = '';
  function poll(){
    const O = root.D37Opt; if (!O || O.rev === lastRev) return;
    lastRev = O.rev;
    const p = pack(); if (p === lastPack) return;
    lastPack = p; for (const fn of subs) try { fn(p); } catch (e) { console.warn(e); }
  }
  function on(fn){ subs.add(fn); lastPack = pack(); return () => subs.delete(fn); }

  // ── Куски GLSL (GLSL ES 3.00; в шейдер игры — строкой) ──
  const GLSL = {
    // хеш клетки (отрицательные координаты — сдвигом в плюс: перевод int → uint на части видеокарт не определён) и гладкий шум 0…1
    noise: `uint s2hash(ivec2 p){ uint h = uint(p.x + 1073741824) * 0x27d4eb2du ^ uint(p.y + 1073741824) * 0x165667b1u; h = (h ^ (h >> 15u)) * 0x85ebca6bu; h ^= h >> 13u; return h; }
float s2noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); ivec2 q = ivec2(i);
  float a = float(s2hash(q) & 1023u), b = float(s2hash(q + ivec2(1, 0)) & 1023u), c = float(s2hash(q + ivec2(0, 1)) & 1023u), d = float(s2hash(q + ivec2(1, 1)) & 1023u);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) / 1023.0; }
float s2lum(vec3 c){ return dot(c, vec3(0.3, 0.5, 0.2)); }`,
    // свет клетки → яркость: кривая (середина хвоста светлее, у огня пересвет), мерцание огня по месту и времени
    light: `vec3 s2light(vec3 block, float sky, vec3 skyCol, vec2 pw, float t, int q){
  vec3 blk = pow(block, vec3(0.75)) * 1.16;
  if (q >= 1) blk *= 1.0 + 0.10 * (s2noise(pw * 0.21 + vec2(t * 2.3, t * 1.7)) - 0.5) + 0.06 * (s2noise(pw * 0.83 + vec2(-t * 5.3, t * 4.1)) - 0.5);
  return max(blk, skyCol * pow(sky, 0.75)); }`,
    // тень от блоков на стене за ними: m — 8 соседей (вверх, вправо, вниз, влево, ↗, ↘, ↙, ↖), f — точка в клетке 0…1
    aoWall: `float s2ao(uint m, vec2 f){ float a = 0.0, r = 0.5;
  if ((m & 1u) != 0u) a += 1.0 - smoothstep(0.0, r, f.y); if ((m & 2u) != 0u) a += 1.0 - smoothstep(0.0, r, 1.0 - f.x);
  if ((m & 4u) != 0u) a += 1.0 - smoothstep(0.0, r, 1.0 - f.y); if ((m & 8u) != 0u) a += 1.0 - smoothstep(0.0, r, f.x);
  if ((m & 16u) != 0u) a += 1.0 - smoothstep(0.0, r, length(vec2(1.0 - f.x, f.y))); if ((m & 32u) != 0u) a += 1.0 - smoothstep(0.0, r, length(vec2(1.0 - f.x, 1.0 - f.y)));
  if ((m & 64u) != 0u) a += 1.0 - smoothstep(0.0, r, length(vec2(f.x, 1.0 - f.y))); if ((m & 128u) != 0u) a += 1.0 - smoothstep(0.0, r, length(f));
  return 1.0 - 0.45 * min(a, 1.0); }`,
    // гладь (0…0,98 — насколько опустить верх клетки жидкости волной), лучи в воде, узор лавы — по мировым клеткам pw
    water: `float s2wave(vec2 pw, float t, bool lava){ return lava ? 0.5 + 0.5 * sin(pw.x * 0.9 + t * 0.8) : 0.5 + 0.3 * sin(pw.x * 1.7 + t * 2.2) + 0.2 * sin(pw.x * 3.3 - t * 3.1); }
float s2rays(vec2 pw, float t){ return smoothstep(0.55, 1.0, sin(pw.x * 0.9 + pw.y * 0.35 + t * 0.6) * 0.5 + 0.5 + 0.35 * sin(pw.x * 2.3 - t * 0.9)); }
vec3 s2lava(vec2 pw, float t){ float n = sin(pw.x * 0.9 + sin(pw.y * 0.8 + t * 0.5) * 1.6 + t * 0.9) * 0.5 + sin(pw.y * 1.1 - t * 0.7 + sin(pw.x * 0.6) * 1.3) * 0.5;
  vec3 c = mix(vec3(0.72, 0.15, 0.03), vec3(1.0, 0.5, 0.1), 0.5 + 0.3 * n); return mix(c, vec3(1.0, 0.84, 0.36), smoothstep(0.45, 0.95, n) * 0.75); }`,
  };

  // ── Постобработка своего WebGL2-рисовальщика ──
  const VS = `#version 300 es
layout(location = 0) in vec2 aP; out vec2 vUV;
void main(){ vUV = aP; gl_Position = vec4(aP * 2.0 - 1.0, 0.0, 1.0); }`;
  // яркое из кадра — сразу в 1/4 размера (4 выборки): из него свечение
  const FS_BRIGHT = `#version 300 es
precision highp float; precision highp sampler2D;
in vec2 vUV; out vec4 oC;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uThr;
void main(){
  vec3 c = (texture(uSrc, vUV + uTexel * vec2(-1.0, -1.0)).rgb + texture(uSrc, vUV + uTexel * vec2(1.0, -1.0)).rgb + texture(uSrc, vUV + uTexel * vec2(-1.0, 1.0)).rgb + texture(uSrc, vUV + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
  float l = max(c.r, max(c.g, c.b));
  oC = vec4(c * smoothstep(uThr, uThr + 0.25, l), 1.0);
}`;
  // размытие по одной оси (9 точек гаусса за 5 выборок)
  const FS_BLUR = `#version 300 es
precision highp float; precision highp sampler2D;
in vec2 vUV; out vec4 oC;
uniform sampler2D uSrc; uniform vec2 uDir;
void main(){
  vec3 c = texture(uSrc, vUV).rgb * 0.227027;
  c += (texture(uSrc, vUV + uDir * 1.3846).rgb + texture(uSrc, vUV - uDir * 1.3846).rgb) * 0.316216;
  c += (texture(uSrc, vUV + uDir * 3.2308).rgb + texture(uSrc, vUV - uDir * 3.2308).rgb) * 0.070270;
  oC = vec4(c, 1.0);
}`;
  // сборка: искажения (вода, жар) → кадр + свечение → цвет кадра → виньетка → ретро
  const FS_COMP = `#version 300 es
precision highp float; precision highp sampler2D;
in vec2 vUV; out vec4 oC;
uniform sampler2D uScene, uBloom, uField;
uniform float uTime, uBloomK, uDist, uVig, uPost, uCrt, uSat, uCon, uBright;
uniform vec4 uFieldRect;   // где поле искажений на экране: uv левого верха и правого низа
uniform vec3 uTint;
void main(){
  vec2 uv = vUV;
  if (uDist > 0.5) {
    vec2 fuv = (vec2(uv.x, 1.0 - uv.y) - uFieldRect.xy) / max(uFieldRect.zw - uFieldRect.xy, vec2(1e-4));
    vec4 fld = texture(uField, clamp(fuv, vec2(0.0), vec2(1.0)));
    uv += vec2(sin(uv.y * 90.0 + uTime * 2.1), cos(uv.x * 70.0 + uTime * 1.6)) * 0.0016 * fld.r;   // вода
    uv.x += sin(uv.y * 160.0 - uTime * 7.0) * 0.0024 * fld.g;                                      // жар над лавой
  }
  vec3 c = texture(uScene, uv).rgb;
  if (uBloomK > 0.0) c += texture(uBloom, uv).rgb * uBloomK;
  c *= uTint * uBright;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * uCon + 0.5;
  vec2 d = vUV - 0.5;
  c *= 1.0 - uVig * smoothstep(0.2, 0.8, dot(d, d) * 2.0);
  if (uPost > 0.5) c = floor(c * uPost + 0.5) / uPost;
  if (uCrt > 0.5) {
    float s = mod(gl_FragCoord.y, 3.0), m = mod(gl_FragCoord.x, 3.0);
    c *= (s < 1.0 ? 0.74 : 1.0);
    c *= vec3(m < 1.0 ? 1.1 : 0.94, (m >= 1.0 && m < 2.0) ? 1.1 : 0.94, m >= 2.0 ? 1.1 : 0.94);
  }
  oC = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
  function compile(gl, vs, fs){
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'compile');
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  }
  const GRADE0 = { tint: [1, 1, 1], sat: 1, con: 1, bright: 1 };
  function create(gl, opts = {}){
    const P = { ok: false, active: false, w: 0, h: 0, sw: 0, sh: 0, stats: { passes: 0 } };
    let progs = null;
    try { progs = { bright: compile(gl, VS, FS_BRIGHT), blur: compile(gl, VS, FS_BLUR), comp: compile(gl, VS, FS_COMP) }; }
    catch (e) { console.warn('Шейдеры 2D: постобработка не собралась — без неё', e.message); return P; }
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
    const tex = (w, h, filter) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return t;
    };
    const fbo = t => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f; };
    let scene = null, sceneF = null, bA = null, bAF = null, bB = null, bBF = null, filt = 0;
    // поле искажений (вода — R, жар — G): маленькая текстура, её заполняет игра (P.field)
    const field = tex(1, 1, gl.LINEAR); let fieldRect = [0, 0, 1, 1], fieldOn = false;
    const freeBufs = () => { for (const t of [scene, bA, bB]) if (t) gl.deleteTexture(t); for (const f of [sceneF, bAF, bBF]) if (f) gl.deleteFramebuffer(f); scene = sceneF = bA = bAF = bB = bBF = null; };
    function size(w, h, px){
      const sw = Math.max(1, Math.round(w / px)), sh = Math.max(1, Math.round(h / px)), f = px > 1 ? gl.NEAREST : gl.LINEAR;
      if (scene && sw === P.sw && sh === P.sh && f === filt) return;
      freeBufs(); filt = f; P.sw = sw; P.sh = sh;
      scene = tex(sw, sh, f); sceneF = fbo(scene);
      const bw = Math.max(1, sw >> 2), bh = Math.max(1, sh >> 2);
      bA = tex(bw, bh, gl.LINEAR); bAF = fbo(bA); bB = tex(bw, bh, gl.LINEAR); bBF = fbo(bB);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    let F = PACKS.normal;
    // начать кадр: нужна постобработка — рисуй в наш буфер (вернёт true; область — P.sw × P.sh), иначе — как раньше на экран
    P.begin = (w, h, fl) => {
      F = fl || flags();
      P.w = w; P.h = h;
      P.active = !!(P.ok && F.post);
      if (!P.active) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); return false; }
      size(w, h, F.pixel || 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneF); gl.viewport(0, 0, P.sw, P.sh);
      return true;
    };
    // поле искажений: data — Uint8Array w×h×4 (R вода 0…255, G жар), rect — где оно на экране (uv: x0, y0, x1, y1; y вниз)
    P.field = (data, w, h, rect) => {
      gl.bindTexture(gl.TEXTURE_2D, field);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      fieldRect = rect; fieldOn = true;
    };
    const quadDraw = () => { gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); P.stats.passes++; };
    // кадр на экран: params { time, grade: { tint, sat, con, bright }, bloom (множитель силы), vignette (множитель) }
    P.end = (params = {}) => {
      if (!P.active) return;
      P.stats.passes = 0;
      gl.disable(gl.BLEND);
      const bloomK = (F.bloom || 0) * (params.bloom ?? 1);
      if (bloomK > 0) {
        const bw = Math.max(1, P.sw >> 2), bh = Math.max(1, P.sh >> 2);
        gl.bindFramebuffer(gl.FRAMEBUFFER, bAF); gl.viewport(0, 0, bw, bh);
        gl.useProgram(progs.bright.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene);
        gl.uniform1i(progs.bright.u.uSrc, 0); gl.uniform2f(progs.bright.u.uTexel, 1 / P.sw, 1 / P.sh); gl.uniform1f(progs.bright.u.uThr, params.threshold ?? .7);
        quadDraw();
        gl.useProgram(progs.blur.p); gl.uniform1i(progs.blur.u.uSrc, 0);
        for (let k = 0; k < Math.max(1, F.bloomBlur | 0); k++) {
          const sc = 1 + k * 1.5;
          gl.bindFramebuffer(gl.FRAMEBUFFER, bBF); gl.bindTexture(gl.TEXTURE_2D, bA); gl.uniform2f(progs.blur.u.uDir, sc / bw, 0); quadDraw();
          gl.bindFramebuffer(gl.FRAMEBUFFER, bAF); gl.bindTexture(gl.TEXTURE_2D, bB); gl.uniform2f(progs.blur.u.uDir, 0, sc / bh); quadDraw();
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, P.w, P.h);
      const u = progs.comp.u, g = F.grade && params.grade ? params.grade : GRADE0;
      gl.useProgram(progs.comp.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene); gl.uniform1i(u.uScene, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bA); gl.uniform1i(u.uBloom, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, field); gl.uniform1i(u.uField, 2);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(u.uTime, params.time || 0); gl.uniform1f(u.uBloomK, bloomK);
      gl.uniform1f(u.uDist, F.distort && fieldOn ? 1 : 0); gl.uniform4fv(u.uFieldRect, fieldRect);
      gl.uniform1f(u.uVig, (F.vignette || 0) * (params.vignette ?? 1)); gl.uniform1f(u.uPost, F.posterize || 0); gl.uniform1f(u.uCrt, F.crt ? 1 : 0);
      gl.uniform3fv(u.uTint, g.tint || GRADE0.tint); gl.uniform1f(u.uSat, g.sat ?? 1); gl.uniform1f(u.uCon, g.con ?? 1); gl.uniform1f(u.uBright, g.bright ?? 1);
      quadDraw();
      gl.enable(gl.BLEND);
      fieldOn = false;
    };
    P.dispose = () => { freeBufs(); gl.deleteTexture(field); gl.deleteBuffer(quad); gl.deleteVertexArray(vao); for (const k in progs) gl.deleteProgram(progs[k].p); P.ok = false; };
    // проверка: серый кадр через сборку → не чёрный (на части телефонов шейдер собирается, а рисует чёрным)
    try {
      P.ok = true;
      F = Object.assign({}, PACKS.pretty, { bloom: 0 });
      size(8, 8, 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneF); gl.viewport(0, 0, 8, 8); gl.clearColor(.5, .5, .5, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      const out = tex(8, 8, gl.NEAREST), outF = fbo(out);
      P.active = true; P.w = 8; P.h = 8;
      // P.end рисует на экран (null) — для проверки подменяем: рисуем сборку в свою текстуру
      gl.bindFramebuffer(gl.FRAMEBUFFER, outF); gl.viewport(0, 0, 8, 8);
      const u = progs.comp.u; gl.useProgram(progs.comp.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene); gl.uniform1i(u.uScene, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bA); gl.uniform1i(u.uBloom, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, field); gl.uniform1i(u.uField, 2); gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(u.uBloomK, 0); gl.uniform1f(u.uDist, 0); gl.uniform1f(u.uVig, 0); gl.uniform1f(u.uPost, 0); gl.uniform1f(u.uCrt, 0);
      gl.uniform3fv(u.uTint, [1, 1, 1]); gl.uniform1f(u.uSat, 1); gl.uniform1f(u.uCon, 1); gl.uniform1f(u.uBright, 1); gl.uniform4fv(u.uFieldRect, [0, 0, 1, 1]);
      gl.disable(gl.BLEND); quadDraw(); gl.enable(gl.BLEND);
      const px = new Uint8Array(4); gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(outF); gl.deleteTexture(out); gl.clearColor(0, 0, 0, 1);
      P.active = false;
      P.test = px[0] + px[1] + px[2];
      if (P.test < 300 || P.test > 465) { console.warn('Шейдеры 2D: сборка кадра на этой видеокарте неверна — без постобработки', P.test); P.ok = false; }
    } catch (e) { console.warn('Шейдеры 2D: проверка', e); P.ok = false; }
    return P;
  }

  // ── Для игр на Canvas 2D: WebGL-холст поверх своего, свет-«пятна» и тот же набор (заготовка: в игры подключать по одной) ──
  // O = overlay(canvas): O.light(x, y, r, [r, g, b], сила) — свет в пикселях холста (на этот кадр); O.dark = 0…1 — темнота вокруг;
  // O.draw(params) — после того как игра нарисовала кадр; O.dispose(). Нет WebGL2 / не собралось — O.ok = false (ничего не делает).
  const FS_OVL = `#version 300 es
precision highp float; precision highp sampler2D;
in vec2 vUV; out vec4 oC;
uniform sampler2D uSrc, uLight;
uniform float uDark;
void main(){
  vec2 uv = vec2(vUV.x, 1.0 - vUV.y);
  vec3 c = texture(uSrc, uv).rgb, l = texture(uLight, vUV).rgb;
  oC = vec4(c * max(vec3(1.0 - uDark), l * 1.2), 1.0);
}`;
  const FS_SPOT = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 oC;
uniform vec2 uC; uniform float uR; uniform vec3 uCol; uniform vec2 uRes;
void main(){ vec2 p = vec2(vUV.x, 1.0 - vUV.y) * uRes; float d = length(p - uC) / uR; float k = max(0.0, 1.0 - d); oC = vec4(uCol * k * k, 1.0); }`;
  function overlay(src, opts = {}){
    const O = { ok: false, dark: 0, lights: [] };
    const cv = root.document?.createElement?.('canvas'); if (!cv) return O;
    const gl = cv.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true });
    if (!gl) return O;
    let pOvl, pSpot;
    try { pOvl = compile(gl, VS, FS_OVL); pSpot = compile(gl, VS, FS_SPOT); } catch (e) { console.warn('Шейдеры 2D (Canvas 2D): не собралось', e.message); return O; }
    const post = create(gl);
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
    const srcT = gl.createTexture(), lightT = gl.createTexture(), lightF = gl.createFramebuffer();
    for (const t of [srcT, lightT]) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
    let lw = 0, lh = 0;
    cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';
    (opts.parent || src.parentNode)?.appendChild(cv);
    O.ok = true; O.canvas = cv;
    O.light = (x, y, r, col, k = 1) => { O.lights.push([x, y, r, col[0] / 255 * k, col[1] / 255 * k, col[2] / 255 * k]); };
    O.draw = (params = {}) => {
      const w = src.width, h = src.height; if (!w || !h) return;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const F = flags();
      gl.bindTexture(gl.TEXTURE_2D, srcT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
      const lwN = Math.max(1, w >> 2), lhN = Math.max(1, h >> 2);
      if (lwN !== lw || lhN !== lh) { lw = lwN; lh = lhN; gl.bindTexture(gl.TEXTURE_2D, lightT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lw, lh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.bindFramebuffer(gl.FRAMEBUFFER, lightF); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightT, 0); }
      // свет: сумма пятен в маленький буфер
      gl.bindFramebuffer(gl.FRAMEBUFFER, lightF); gl.viewport(0, 0, lw, lh); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.useProgram(pSpot.p); gl.bindVertexArray(vao); gl.uniform2f(pSpot.u.uRes, w, h);
      for (const [x, y, r, cr, cg, cb] of O.lights) { gl.uniform2f(pSpot.u.uC, x, y); gl.uniform1f(pSpot.u.uR, r); gl.uniform3f(pSpot.u.uCol, cr, cg, cb); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
      gl.disable(gl.BLEND); O.lights.length = 0;
      // кадр игры × свет → (постобработка набора) → экран
      post.begin(w, h, F);
      if (!post.active) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); }
      gl.useProgram(pOvl.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcT); gl.uniform1i(pOvl.u.uSrc, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lightT); gl.uniform1i(pOvl.u.uLight, 1); gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(pOvl.u.uDark, O.dark || 0);
      gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      post.end(params);
    };
    O.dispose = () => { post.dispose?.(); cv.remove(); gl.getExtension('WEBGL_lose_context')?.loseContext(); O.ok = false; };
    return O;
  }

  // 2D-игра открыта и рисуется этими шейдерами: в ⚙️ появится вкладка «Графика» с «Шейдерами» (use() → функция «закрыли»)
  const S2 = { PACKS, LIST, pack, flags, autoPack, on, poll, create, overlay, GLSL, VS, users: 0 };
  S2.use = () => { S2.users++; let done = false; return () => { if (!done) { done = true; S2.users = Math.max(0, S2.users - 1); } }; };
  E.shade2d = S2;
})();
