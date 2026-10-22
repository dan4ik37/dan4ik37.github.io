// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — частицы (как ParticleEmitter / Fire / Smoke / Sparkles в Roblox): огонь, дым, искры, конфетти, снег,
//  дождь, магия, пузыри. Один эмиттер = одни Points (один вызов отрисовки), частицы считаются на процессоре без мусора.
// ═══════════════════════════════════════
// FX = D37E.fx(R) → em = FX.emitter({ kind, at: () => [x, y, z] | [x, y, z], rate (×), size (×), color, color2, enabled });
// em.set(props), em.burst(n), em.dispose(); каждый кадр — FX.update(dt) (позиция берётся из at, если это функция); FX.dispose().
// На «низкой» графике частиц вдвое меньше. Всё, что видно, — в R.scene; ничего не выделяется на кадр.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  // скорость: [от, до] — вверх (y), разлёт spread (доля к горизонтали), gravity: >0 вниз, <0 — всплывает; area — разброс места
  // рождения (радиус), shape: 0 мягкий круг, 1 квадрат, 2 кольцо, 3 звёздочка; blend: add — светится (огонь, искры)
  const KINDS = {
    fire: { name: 'Огонь', icon: '🔥', rate: 45, life: [.5, 1], size: [1.1, 2], color: '#ffc14d', color2: '#ff3412', speed: [1.4, 2.8], spread: .25, gravity: -1.5, area: .35, shape: 0, blend: 'add', shrink: 1 },
    smoke: { name: 'Дым', icon: '💨', rate: 10, life: [2.5, 4], size: [1.4, 3.6], color: '#a8adb5', color2: '#4b5563', speed: [.6, 1.3], spread: .35, gravity: -.3, area: .4, shape: 0, blend: 'normal', alpha: .5, grow: 1 },
    sparkles: { name: 'Искры', icon: '✨', rate: 24, life: [.8, 1.6], size: [.22, .45], color: '#fff6a8', color2: '#ffc93c', speed: [.4, 1.6], spread: 1, gravity: .4, area: .8, shape: 3, blend: 'add', twinkle: 1 },
    confetti: { name: 'Конфетти', icon: '🎉', rate: 55, life: [2, 3.2], size: [.22, .36], palette: ['#ff4d6d', '#ffd23f', '#3ddc97', '#4cc9f0', '#b14aed', '#ff8c42'], speed: [5, 9], spread: .55, gravity: 7, area: .3, shape: 1, blend: 'normal', drag: .6 },
    snow: { name: 'Снег', icon: '❄️', rate: 70, life: [6, 9], size: [.18, .4], color: '#ffffff', speed: [-.9, -.4], spread: 0, gravity: 0, area: 18, top: 14, shape: 0, blend: 'normal', alpha: .9, drift: .8 },
    rain: { name: 'Дождь', icon: '🌧️', rate: 320, life: [.9, 1.3], size: [.1, .16], color: '#b8d4ff', speed: [-16, -12], spread: 0, gravity: 0, area: 18, top: 16, shape: 0, blend: 'normal', alpha: .6 },
    magic: { name: 'Магия', icon: '🔮', rate: 32, life: [1, 2], size: [.3, .65], color: '#d08cff', color2: '#5aa7ff', speed: [.3, .9], spread: 1, gravity: -.6, area: .9, shape: 3, blend: 'add', orbit: 1.6, twinkle: 1 },
    fountain: { name: 'Фонтан', icon: '⛲', rate: 90, life: [1, 1.25], size: [.12, .22], color: '#eefaff', color2: '#8fd3f5', speed: [3.6, 4.4], spread: .32, gravity: 9.8, area: .1, shape: 0, blend: 'normal', alpha: .8 },
    bubbles: { name: 'Пузыри', icon: '🫧', rate: 7, life: [2, 3.6], size: [.35, .8], color: '#c8f0ff', speed: [.6, 1.2], spread: .25, gravity: -.4, area: .5, shape: 2, blend: 'normal', alpha: .75, drift: .4 },
    // пожар (FX.flames): столб дыма — тёмный, растёт и светлеет, уносит ветром; угли — мелкие, светятся, мигают, всплывают
    firesmoke: { name: 'Дым пожара', icon: '🌫️', rate: 8, life: [2.6, 4.2], size: [.7, 1.7], color: '#3b3836', color2: '#8d8a87', speed: [1.1, 2], spread: .18, gravity: -.25, area: .35, shape: 0, blend: 'normal', alpha: .42, grow: 1, drift: .25 },
    embers: { name: 'Угли', icon: '✨', rate: 10, life: [.9, 1.8], size: [.07, .14], color: '#ffb347', color2: '#ff3a12', speed: [1.4, 3.2], spread: .45, gravity: -.6, area: .35, shape: 0, blend: 'add', twinkle: 1, drift: .6 },
  };
  const MAX = 900;   // частиц в одном эмиттере
  // случайное для картинки (не Math.random: его результат V8 «упаковывает» — мусор на каждый вызов): xorshift в типизированном массиве
  const RSA = new Int32Array([0x2545f491]);
  const fr = () => { let r = RSA[0]; r ^= r << 13; r ^= r >>> 17; r ^= r << 5; RSA[0] = r; return (r >>> 0) * 2.3283064365386963e-10; };
  // ── Частицы эмиттера: рождение и движение (общие для всех эмиттеров; массивы — em.pos, em.vel, …) ──
  function emSpawn(em, x, y, z){
    if (em.n >= em.cap) return;
    const i = em.n++, K = em.kind, s = em.sizeK, sp = K.spread, ar = K.area * (K.top ? 1 : s), pos = em.pos, vel = em.vel, tint = em.tint;
    const a = fr() * Math.PI * 2, rr = K.top ? fr() * ar : Math.sqrt(fr()) * ar;
    pos[i * 3] = x + Math.cos(a) * rr; pos[i * 3 + 1] = y + (K.top ? K.top * s * .5 + fr() * 2 : 0); pos[i * 3 + 2] = z + Math.sin(a) * rr;
    const v = (K.speed[0] + fr() * (K.speed[1] - K.speed[0])) * (K.top ? 1 : Math.sqrt(s)), d = fr() * Math.PI * 2;
    vel[i * 3] = Math.cos(d) * v * sp; vel[i * 3 + 1] = v * (1 - sp * .5); vel[i * 3 + 2] = Math.sin(d) * v * sp;
    if (K.top) { vel[i * 3] = vel[i * 3 + 2] = 0; vel[i * 3 + 1] = v; }
    em.age[i] = 0; em.life[i] = K.life[0] + fr() * (K.life[1] - K.life[0]); em.base[i] = (K.size[0] + fr() * (K.size[1] - K.size[0])) * s; em.ph[i] = fr() * 6.283; em.spin[i] = fr() * 6.283;
    if (K.palette) { const ca = em.ca; ca.set(K.palette[(fr() * K.palette.length) | 0]); tint[i * 3] = ca.r; tint[i * 3 + 1] = ca.g; tint[i * 3 + 2] = ca.b; }
    else { const m = fr() * .25, c1 = em.c1, c2 = em.c2; tint[i * 3] = c1[0] * (1 - m) + c2[0] * m; tint[i * 3 + 1] = c1[1] * (1 - m) + c2[1] * m; tint[i * 3 + 2] = c1[2] * (1 - m) + c2[2] * m; }
  }
  // движение и смерть (умершие меняются местами с последней — массив без дыр), размер, цвет и прозрачность за жизнь
  function emMove(em, dt){
    const K = em.kind, pos = em.pos, vel = em.vel, age = em.age, life = em.life, base = em.base, ph = em.ph, spin = em.spin, tint = em.tint, size = em.size, col = em.col, c2 = em.c2, wind = em.wind, mul = em.mul;
    const grav = K.gravity, drag = K.drag || 0, drift = K.drift || 0, orbit = K.orbit || 0, alpha = K.alpha ?? 1, m0 = c2 && !K.palette ? 1 : 0, shrink = !!K.shrink, grow = !!K.grow, twinkle = !!K.twinkle, sq = K.shape === 1;
    for (let i = 0; i < em.n; i++) {
      age[i] += dt;
      if (age[i] >= life[i]) {
        const j = --em.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) { pos[i * 3 + k] = pos[j * 3 + k]; vel[i * 3 + k] = vel[j * 3 + k]; tint[i * 3 + k] = tint[j * 3 + k]; }
          age[i] = age[j]; life[i] = life[j]; base[i] = base[j]; ph[i] = ph[j]; spin[i] = spin[j];
        }
        i--; continue;
      }
      const t = age[i] / life[i];
      vel[i * 3 + 1] -= grav * dt;
      if (drag) { const f = Math.max(0, 1 - drag * dt); vel[i * 3] *= f; vel[i * 3 + 2] *= f; if (vel[i * 3 + 1] < -3) vel[i * 3 + 1] = -3; }
      let wx = 0, wz = 0;
      if (drift) { wx = Math.sin(age[i] * 1.3 + ph[i]) * drift; wz = Math.cos(age[i] * 1.1 + ph[i]) * drift; }
      if (orbit) { wx += Math.cos(age[i] * 3 + ph[i]) * orbit; wz += Math.sin(age[i] * 3 + ph[i]) * orbit; }
      if (wind) { const k = t < .35 ? t * 2.2 : .77 + t * .3; wx += wind[0] * k; wz += wind[1] * k; }   // ветер сильнее уносит то, что уже поднялось
      pos[i * 3] += (vel[i * 3] + wx) * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += (vel[i * 3 + 2] + wz) * dt;
      let sz = base[i];
      if (shrink) sz *= 1 - t * .85; if (grow) sz *= .5 + t;
      if (twinkle) sz *= .65 + .35 * Math.sin(age[i] * 14 + ph[i]);
      size[i] = sz;
      const fade = Math.min(1, t * 6) * (1 - t * t) * alpha, m = m0 ? t : 0;
      col[i * 4] = tint[i * 3] * (1 - m) + c2[0] * m; col[i * 4 + 1] = tint[i * 3 + 1] * (1 - m) + c2[1] * m; col[i * 4 + 2] = tint[i * 3 + 2] * (1 - m) + c2[2] * m; col[i * 4 + 3] = fade;
      if (mul) { col[i * 4] *= mul[0]; col[i * 4 + 1] *= mul[1]; col[i * 4 + 2] *= mul[2]; }
      if (sq) spin[i] += dt * 4;
    }
    const geo = em.geo;
    geo.setDrawRange(0, em.n);
    if (em.n) { geo.attributes.position.needsUpdate = geo.attributes.aSize.needsUpdate = geo.attributes.aColor.needsUpdate = geo.attributes.aSpin.needsUpdate = true; }
  }

  E.fx = function (R){
    const T = R.T, low = R.q === 'low', list = new Set();
    const uni = { uScale: { value: 400 } };
    const VERT = `attribute float aSize; attribute vec4 aColor; attribute float aSpin; varying vec4 vColor; varying float vSpin;
uniform float uScale;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale * projectionMatrix[1][1] / max(.1, -mv.z);
  vColor = aColor; vSpin = aSpin;
}`;
    const FRAG = `uniform float uShape; varying vec4 vColor; varying float vSpin;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float c = cos(vSpin), s = sin(vSpin); p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  float r = length(p), a;
  if (uShape < .5) a = (1.0 - smoothstep(.15, 1.0, r));
  else if (uShape < 1.5) a = step(max(abs(p.x), abs(p.y) * 1.7), .75);
  else if (uShape < 2.5) a = smoothstep(.55, .75, r) * (1.0 - smoothstep(.85, 1.0, r)) + (1.0 - smoothstep(.0, .45, length(p - vec2(-.3, -.3)))) * .5;
  else a = max((1.0 - smoothstep(.0, .35, abs(p.x) * 2.5 + abs(p.y) * .35)), (1.0 - smoothstep(.0, .35, abs(p.y) * 2.5 + abs(p.x) * .35))) + (1.0 - smoothstep(.0, .5, r)) * .6;
  a *= vColor.a;
  if (a < .01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`;
    const FX = { KINDS, list };
    const ca = new T.Color(), cb = new T.Color();

    FX.emitter = (o = {}) => {
      const em = { enabled: true, acc: 0, n: 0, kind: null, P: null };
      const geo = new T.BufferGeometry();
      const pos = new Float32Array(MAX * 3), size = new Float32Array(MAX), col = new Float32Array(MAX * 4), spin = new Float32Array(MAX);
      // своё состояние частиц: скорость, возраст, жизнь, размер, фаза
      const vel = new Float32Array(MAX * 3), age = new Float32Array(MAX), life = new Float32Array(MAX), base = new Float32Array(MAX), ph = new Float32Array(MAX), tint = new Float32Array(MAX * 3);
      geo.setAttribute('position', new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage));
      geo.setAttribute('aSize', new T.BufferAttribute(size, 1).setUsage(T.DynamicDrawUsage));
      geo.setAttribute('aColor', new T.BufferAttribute(col, 4).setUsage(T.DynamicDrawUsage));
      geo.setAttribute('aSpin', new T.BufferAttribute(spin, 1).setUsage(T.DynamicDrawUsage));
      geo.setDrawRange(0, 0);
      const mat = new T.ShaderMaterial({ uniforms: { uScale: uni.uScale, uShape: { value: 0 } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
      const pts = new T.Points(geo, mat);
      pts.frustumCulled = false; pts.renderOrder = 5;
      R.scene.add(pts);
      let at = [0, 0, 0], atFn = null;
      em.set = p => {
        Object.assign(o, p);
        const K = KINDS[o.kind] || KINDS.fire;
        em.kind = K; em.enabled = o.enabled !== false;
        mat.uniforms.uShape.value = K.shape;
        mat.blending = K.blend === 'add' ? T.AdditiveBlending : T.NormalBlending;
        pts.renderOrder = K.blend === 'add' ? 6 : 5;   // светящееся — поверх дыма
        mat.needsUpdate = true;
        ca.set(o.color || K.color || '#ffffff'); cb.set(o.color2 || K.color2 || o.color || K.color || '#ffffff');
        em.c1 = [ca.r, ca.g, ca.b]; em.c2 = [cb.r, cb.g, cb.b];
        em.rate = K.rate * Math.max(0, Math.min(5, o.rate ?? 1)) * (low ? .5 : 1);
        em.sizeK = Math.max(.1, Math.min(10, o.size ?? 1));
        if (typeof o.at === 'function') atFn = o.at; else if (Array.isArray(o.at)) { atFn = null; at = o.at; }
      };
      em.cap = Math.max(1, Math.min(MAX, o.cap | 0 || MAX));   // своё число частиц (дым пожара на телефоне — меньше: перерисовка экрана)
      em.set({});
      // частицы — в массивах самого эмиттера; рождение и движение — общие функции (emSpawn / emMove — одни на все эмиттеры:
      // быстрее становятся оптимизированным кодом V8, без «упакованных» дробных чисел — мусора за кадр)
      Object.assign(em, { pos, size, col, spin, vel, age, life, base, ph, tint, ca, geo });
      em.burst = n => { const p = atFn ? atFn() : at; if (!p) return; for (let k = 0; k < n; k++) emSpawn(em, p[0], p[1], p[2]); };
      // родить прямо в точке (без em.set — тот пересобирает материал): пожар — дым и угли над каждым горящим
      em.emitAt = (x, y, z, n = 1) => { for (let k = 0; k < n; k++) emSpawn(em, x, y, z); };
      em.wind = null;   // [x, z] — ветер (м/с): уносит частицы (дым пожара)
      em.mul = null;    // [r, g, b] — свет вокруг (ночью и в пещере дым темнее): множитель цвета
      em.step = dt => {
        const p = atFn ? atFn() : at;
        if (em.enabled && p) { em.acc += em.rate * dt; let n = Math.min(60, em.acc | 0); em.acc -= n; while (n-- > 0) emSpawn(em, p[0], p[1], p[2]); }
        else em.acc = 0;
        emMove(em, dt);
      };
      em.clear = () => { em.n = 0; geo.setDrawRange(0, 0); };
      em.dispose = () => { list.delete(em); R.scene.remove(pts); geo.dispose(); mat.dispose(); };
      list.add(em);
      return em;
    };
    FX.update = dt => {
      const h = R.r.getDrawingBufferSize ? R.r.domElement.height : 600;
      uni.uScale.value = h * .5;
      for (const em of list) em.step(Math.min(dt, .1));
    };
    FX.clear = () => { for (const em of list) em.clear(); };
    const flames = new Set();
    FX.dispose = () => { for (const f of [...flames]) f.dispose(); for (const em of [...list]) em.dispose(); };

    // ═══ Пожар (D37E.fire → картинка): языки пламени, дрожь горячего воздуха, столб дыма, угли, мерцающий свет ═══
    // FL = FX.flames({ max, lights, shimmer, smoke, embers, lit(x, y, z) → [r, g, b] }) — один на игру. Каждый кадр:
    // FL.begin(камера) → на каждый горящий o = FL.push() и строка FL.Q[o…o + 7] = x, y, z (низ середины, координаты сцены), размер,
    // сила 0…1, зерно 0…1, дым 0…1, высота × (или FL.burn(…) — то же вызовом) → FL.dt, FL.t, FL.windIn [x, z] м/с → FL.end().
    // Языки — один вызов отрисовки
    // (экземпляры квадрата: свой шейдер — шум бежит вверх, ядро светлее, к концу горения краснее; столбом вверх, к камере
    // лицом, ветер клонит), дрожь воздуха — второй (только «высокая»: светлые полосы над огнём бегут вверх), дым и угли —
    // эмиттеры fx.js (свои пулы, до 900 частиц), свет — лампы движка R.lights у ближних очагов (o.lights: сколько; ореол у
    // всех ламп рисует render.js), «Кубомир» — свет блоков огня (свои лампы — 0). Качество: low — 1 язык на очаг, без дрожи,
    // дыма ×0,4; mid — 2 языка; high — 3 и дрожь. Без мусора за кадр: буферы — постоянные.
    FX.flames = (o = {}) => {
      const q = R.q || 'mid', LOWQ = q === 'low', HIGH = q === 'high' || q === 'ultra';
      const MAXI = Math.max(16, o.max || (LOWQ ? 160 : HIGH ? 900 : 480)), PER = LOWQ ? 1 : HIGH ? 3 : 2, SHIM = o.shimmer ?? HIGH, MAXS = 40;
      const FL = { n: 0, ns: 0, cells: 0, max: MAXI, per: PER, wind: new Float32Array(2), stats: { tongues: 0, cells: 0, lit: 0 } };
      const quad = new T.BufferGeometry();
      quad.setAttribute('position', new T.BufferAttribute(new Float32Array([-.5, 0, 0, .5, 0, 0, .5, 1, 0, -.5, 1, 0]), 3));
      quad.setIndex([0, 1, 2, 0, 2, 3]);
      const mk = (cap) => {
        const g = new T.InstancedBufferGeometry();
        g.index = quad.index; g.setAttribute('position', quad.attributes.position);
        const A = new Float32Array(cap * 4), B = new Float32Array(cap * 4);
        g.setAttribute('iA', new T.InstancedBufferAttribute(A, 4).setUsage(T.DynamicDrawUsage));
        g.setAttribute('iB', new T.InstancedBufferAttribute(B, 4).setUsage(T.DynamicDrawUsage));
        g.instanceCount = 0;
        return { g, A, B };
      };
      const U = { uTime: { value: 0 }, uLean: { value: new T.Vector2() }, uFog: { value: new T.Vector2(80, 200) } };
      // вершины: квадрат у основания огня, развёрнут к камере только вокруг вертикали (языки — столбом); верх клонит ветер
      const VERT = `attribute vec4 iA; attribute vec4 iB; uniform float uTime; uniform vec2 uLean; uniform vec2 uFog;
varying vec2 vUv; varying float vSeed; varying float vHeat; varying float vFade;
void main(){
  vec3 cr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec2 rr = cr.xz; float rl = length(rr); rr = rl > 1e-4 ? rr / rl : vec2(1.0, 0.0);
  float y = position.y, w = iA.w, h = iB.x;
  float sway = sin(uTime * 2.3 + iB.z * 6.2831) * 0.07 * y;
  vec3 wp = iA.xyz + vec3(rr.x, 0.0, rr.y) * ((position.x + sway) * w) + vec3(0.0, y * h, 0.0);
  wp.xz += uLean * (y * y) * h;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = vec2(position.x + 0.5, y); vSeed = iB.z; vHeat = iB.y;
  vFade = 1.0 - smoothstep(uFog.x, uFog.y, -mv.z);
}`;
      // языки: шум по «вверх» бежит, форма — капля, край рвётся шумом; ядро — бело-жёлтое, снаружи — оранжевое, догорает — красное
      const NOISE = `float fh(vec2 p){ p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float fn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fh(i), fh(i + vec2(1.0, 0.0)), f.x), mix(fh(i + vec2(0.0, 1.0)), fh(i + vec2(1.0, 1.0)), f.x), f.y); }`;
      const FRAG = `uniform float uTime; varying vec2 vUv; varying float vSeed; varying float vHeat; varying float vFade;
${NOISE}
void main(){
  float t = uTime, s = vSeed * 17.0;
  vec2 uv = vUv;
  float n = fn(vec2(uv.x * 3.2 + s, uv.y * 3.6 - t * 2.4 + s)) * 0.65 + fn(vec2(uv.x * 6.5 - s, uv.y * 7.5 - t * 4.1)) * 0.35;
  float x = (uv.x - 0.5) * 2.0 + (n - 0.5) * 0.55 * uv.y;
  float wdt = (1.0 - uv.y) * (0.78 + 0.35 * n) + 0.06;
  float body = 1.0 - smoothstep(wdt * 0.45, wdt, abs(x));
  float top = 1.0 - smoothstep(0.45, 1.0, uv.y + (n - 0.5) * 0.5);
  float a = body * top * smoothstep(0.0, 0.08, uv.y);
  if (a < 0.02) discard;
  float core = clamp((1.0 - abs(x) / max(wdt, 0.05)) * (1.0 - uv.y * 1.6), 0.0, 1.0);
  vec3 deep = mix(vec3(0.72, 0.1, 0.02), vec3(1.0, 0.32, 0.05), vHeat);
  vec3 col = mix(deep, vec3(1.0, 0.68, 0.18), clamp(1.1 - uv.y * 1.2 + n * 0.25, 0.0, 1.0));
  col = mix(col, vec3(1.0, 0.95, 0.78), core * core * vHeat);
  a *= vFade * (0.55 + 0.45 * vHeat) * (0.86 + 0.14 * sin(t * 11.0 + s * 3.0));
  gl_FragColor = vec4(col * a * 1.8, a);
}`;
      // дрожь горячего воздуха над огнём: светлые волнистые полосы бегут вверх (сложением, очень слабо)
      const SFRAG = `uniform float uTime; varying vec2 vUv; varying float vSeed; varying float vHeat; varying float vFade;
void main(){
  float t = uTime, s = vSeed * 13.0, x = (vUv.x - 0.5) * 2.0;
  float env = (1.0 - smoothstep(0.35, 1.0, abs(x))) * smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  float w = sin(vUv.y * 9.0 - t * 5.0 + s + sin(vUv.x * 7.0 + t * 2.0 + s) * 1.3);
  float a = env * (0.5 + 0.5 * w) * 0.07 * vHeat * vFade;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vec3(1.0, 0.85, 0.7) * a, a);
}`;
      const F1 = mk(MAXI), mat = new T.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false });
      const mesh = new T.Mesh(F1.g, mat); mesh.frustumCulled = false; mesh.renderOrder = 6; mesh.name = 'fire:flames'; mesh.userData.dyn = true;
      R.scene.add(mesh);
      let S1 = null, smat = null, smesh = null;
      if (SHIM) {
        S1 = mk(MAXS); smat = new T.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: SFRAG, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false });
        smesh = new T.Mesh(S1.g, smat); smesh.frustumCulled = false; smesh.renderOrder = 7; smesh.name = 'fire:shimmer'; smesh.userData.dyn = true; R.scene.add(smesh);
      }
      // дым и угли — эмиттеры fx.js (свои пулы)
      // дым — мягкие большие пятна: на телефоне их меньше (каждое — перерисовка куска экрана), угли — мелкие
      const MOB = !!E.isMobile?.();
      const smoke = o.smoke !== false ? FX.emitter({ kind: 'firesmoke', rate: 0, enabled: false, cap: LOWQ ? 120 : HIGH && !MOB ? 520 : 260 }) : null;
      const embers = o.embers !== false ? FX.emitter({ kind: 'embers', rate: 0, enabled: false, cap: LOWQ ? 80 : HIGH && !MOB ? 320 : 160 }) : null;
      if (smoke) smoke.wind = FL.wind; if (embers) embers.wind = FL.wind;
      const kS = (LOWQ ? .3 : HIGH ? .9 : .5) * (MOB ? .7 : 1), kE = (LOWQ ? .3 : HIGH ? 1 : .6) * (MOB ? .8 : 1);
      // свет: лампы движка у ближних очагов (ореол — у всех ламп сам)
      const NL = Math.max(0, Math.min(6, o.lights | 0)), lamps = [];
      for (let i = 0; i < NL && R.lights; i++) { const src = { position: new T.Vector3(0, -1e4, 0), color: new T.Color('#ff8a3a'), intensity: 0, distance: 10, decay: 2, visible: true }; lamps.push({ src, rec: R.lights.add(src) }); }
      const NC = 16, CX = new Float32Array(NC), CY = new Float32Array(NC), CZ = new Float32Array(NC), CD = new Float32Array(NC), CH = new Float32Array(NC);
      let nc = 0, camX = 0, camY = 0, camZ = 0, dtF = 1 / 60;
      const lit = typeof o.lit === 'function' ? o.lit : null;
      // очередь очагов кадра (без вызова на каждый — числа не «упаковываются»): строка — x, y, z, размер, сила 0…1, зерно 0…1,
      // дым 0…1, высота (×; дерево — выше)
      const MAXQ = Math.max(64, o.queue || MAXI), Q = FL.Q = new Float32Array(MAXQ * 8);
      FL.q = 0; FL.dt = 1 / 60; FL.t = 0; FL.windIn = new Float32Array(2);
      FL.begin = cam => {
        FL.q = 0;
        if (cam) { camX = cam.x; camY = cam.y; camZ = cam.z; }
        else if (R.camera) { const p = R.camera.position; camX = p.x; camY = p.y; camZ = p.z; }
      };
      // место под очаг → смещение строки в FL.Q (или −1 — места нет): игра пишет FL.Q[o…o + 7] сама
      FL.push = () => (FL.q < MAXQ ? FL.q++ * 8 : -1);
      // удобно (не в горячем цикле): FL.burn(x, y, z, размер, сила, зерно, дым, высота)
      FL.burn = (x, y, z, sz, heat, seed, smk = .7, tall = 1) => { const i = FL.push(); if (i < 0) return false; Q[i] = x; Q[i + 1] = y; Q[i + 2] = z; Q[i + 3] = sz; Q[i + 4] = heat; Q[i + 5] = seed; Q[i + 6] = smk; Q[i + 7] = tall; return true; };
      // очаг размера s (клетка, кусок дерева, деталь): 1–3 языка (место — от зерна: не прыгает), дрожь, дым и угли, лампа
      function cell(i){
        const x = Q[i], y = Q[i + 1], z = Q[i + 2], sz = Q[i + 3], heat = Q[i + 4], seed = Q[i + 5], smk = Q[i + 6], tall = Q[i + 7] || 1;
        FL.cells++;
        const hk = .45 + .55 * heat, fs = sz * hk;
        const A = F1.A, B = F1.B;
        for (let k = 0; k < PER && FL.n < MAXI; k++) {   // языки — прямо в буфер экземпляров (без вызова на каждый: дробные аргументы V8 «упаковывает»)
          const a = seed * 7.13 + k * 2.39, r = k ? sz * .27 : 0, j = FL.n++ * 4;
          A[j] = x + Math.cos(a) * r; A[j + 1] = y; A[j + 2] = z + Math.sin(a) * r; A[j + 3] = fs * (k ? .78 : 1.2);
          B[j] = fs * tall * (k ? 1.25 : 1.8) * (1 + .18 * ((seed * 3.7 + k) % 1)); B[j + 1] = heat; B[j + 2] = (seed + k * .37) % 1; B[j + 3] = 0;
        }
        if (SHIM && FL.ns < MAXS && heat > .5) {
          const dx = x - camX, dz = z - camZ;
          if (dx * dx + dz * dz < 900) { const j = FL.ns++ * 4; S1.A[j] = x; S1.A[j + 1] = y + fs * tall * .9; S1.A[j + 2] = z; S1.A[j + 3] = fs * 1.4; S1.B[j] = fs * tall * 2.6; S1.B[j + 1] = heat; S1.B[j + 2] = seed; S1.B[j + 3] = 0; }
        }
        // дым и угли: вероятность за кадр (картинка — случайность браузера можно)
        const top = y + fs * tall * 1.3;
        // пул полон — не звать вовсе (иначе у «полного» эмиттера редкий путь рождения остаётся «холодным» и V8 то и дело выкидывает
        // оптимизированный код — мусор каждый кадр)
        if (smoke && smk > 0 && smoke.n < smoke.cap - 4 && fr() < 1.3 * smk * heat * kS * dtF * (sz > 1.5 ? 1.6 : 1)) emSpawn(smoke, x + (fr() - .5) * sz * .4, top, z + (fr() - .5) * sz * .4);
        if (embers && embers.n < embers.cap - 4 && fr() < 1.6 * heat * kE * dtF) emSpawn(embers, x + (fr() - .5) * sz * .5, y + fs * tall * .5, z + (fr() - .5) * sz * .5);
        // кандидат в лампы: 16 самых близких
        if (NL) {
          const dx = x - camX, dy = y - camY, dz = z - camZ, d = dx * dx + dy * dy + dz * dz;
          if (nc < NC || d < CD[nc - 1]) {
            let j = nc < NC ? nc++ : NC - 1;
            while (j > 0 && CD[j - 1] > d) { CX[j] = CX[j - 1]; CY[j] = CY[j - 1]; CZ[j] = CZ[j - 1]; CD[j] = CD[j - 1]; CH[j] = CH[j - 1]; j--; }
            CX[j] = x; CY[j] = y + fs * tall * .6; CZ[j] = z; CD[j] = d; CH[j] = heat * Math.min(2, sz);
          }
        }
      }
      // кадр: FL.dt, FL.t (с), FL.windIn [x, z] (м/с) — поля, не аргументы (без мусора за кадр)
      FL.end = () => {
        const t = FL.t;
        dtF = Math.min(.1, Math.max(0, FL.dt || 1 / 60));
        FL.n = 0; FL.ns = 0; FL.cells = 0; nc = 0;
        for (let k = 0; k < FL.q; k++) cell(k * 8);
        U.uTime.value = t % 120;
        const wx = FL.windIn[0] || 0, wz = FL.windIn[1] || 0;
        FL.wind[0] = wx * .45; FL.wind[1] = wz * .45;
        U.uLean.value.set(Math.max(-1.2, Math.min(1.2, wx * .07)), Math.max(-1.2, Math.min(1.2, wz * .07)));
        const fog = R.scene.fog; if (fog && fog.far > fog.near + 1) U.uFog.value.set(Math.max(0, fog.near), fog.far); else U.uFog.value.set(400, 800);
        if (smoke && lit && FL.cells) { const L = lit(camX, camY, camZ); if (L) { smoke.mul = smoke.mul || new Float32Array(3); smoke.mul[0] = L[0]; smoke.mul[1] = L[1]; smoke.mul[2] = L[2]; } }   // дым — светом вокруг
        F1.g.instanceCount = FL.n; mesh.visible = FL.n > 0;
        if (FL.n) { F1.g.attributes.iA.needsUpdate = true; F1.g.attributes.iB.needsUpdate = true; F1.g.attributes.iA.updateRange.count = FL.n * 4; F1.g.attributes.iB.updateRange.count = FL.n * 4; }
        if (smesh) { S1.g.instanceCount = FL.ns; smesh.visible = FL.ns > 0; if (FL.ns) { S1.g.attributes.iA.needsUpdate = true; S1.g.attributes.iB.needsUpdate = true; } }
        // лампы: самые близкие очаги, не ближе 4 ед. друг к другу; мерцают
        let li = 0;
        for (let k = 0; k < nc && li < NL; k++) {
          let near = false;
          for (let j = 0; j < li; j++) { const p = lamps[j].src.position, dx = p.x - CX[k], dz = p.z - CZ[k]; if (dx * dx + dz * dz < 16) { near = true; break; } }
          if (near) continue;
          const L = lamps[li], ph = li * 2.17;
          L.src.position.set(CX[k], CY[k], CZ[k]);
          L.src.intensity = (1.2 + .6 * Math.min(1, CH[k])) * (1 + .16 * Math.sin(t * 9.3 + ph) + .1 * Math.sin(t * 15.7 + ph * 2.3));
          L.src.distance = 8 + 4 * Math.min(1, CH[k]);
          li++;
        }
        for (let j = li; j < NL; j++) { lamps[j].src.intensity = 0; lamps[j].src.position.y = -1e4; }
        FL.stats.tongues = FL.n; FL.stats.cells = FL.cells; FL.stats.lit = li;
      };
      FL.clear = () => { FL.begin(); FL.end(); smoke?.clear(); embers?.clear(); };
      FL.dispose = () => {
        flames.delete(FL);
        R.scene.remove(mesh); F1.g.dispose(); mat.dispose();
        if (smesh) { R.scene.remove(smesh); S1.g.dispose(); smat.dispose(); }
        quad.dispose();
        smoke?.dispose(); embers?.dispose();
        for (const L of lamps) R.lights?.remove(L.rec);
        lamps.length = 0;
      };
      FL.objects = () => ({ mesh, shimmer: smesh, smoke, embers, lamps });
      flames.add(FL);
      return FL;
    };
    return FX;
  };
  E.fx.KINDS = KINDS;
})();
