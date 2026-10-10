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
    bubbles: { name: 'Пузыри', icon: '🫧', rate: 7, life: [2, 3.6], size: [.35, .8], color: '#c8f0ff', speed: [.6, 1.2], spread: .25, gravity: -.4, area: .5, shape: 2, blend: 'normal', alpha: .75, drift: .4 },
  };
  const MAX = 900;   // частиц в одном эмиттере

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
  if (uShape < .5) a = smoothstep(1.0, .15, r);
  else if (uShape < 1.5) a = step(max(abs(p.x), abs(p.y) * 1.7), .75);
  else if (uShape < 2.5) a = smoothstep(.55, .75, r) * smoothstep(1.0, .85, r) + smoothstep(.45, .0, length(p - vec2(-.3, -.3))) * .5;
  else a = max(smoothstep(.35, .0, abs(p.x) * 2.5 + abs(p.y) * .35), smoothstep(.35, .0, abs(p.y) * 2.5 + abs(p.x) * .35)) + smoothstep(.5, .0, r) * .6;
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
      em.set({});
      const rnd = (a, b) => a + Math.random() * (b - a);
      function spawn(x, y, z){
        if (em.n >= MAX) return;
        const i = em.n++, K = em.kind, s = em.sizeK, sp = K.spread, ar = K.area * (K.top ? 1 : s);
        const a = Math.random() * Math.PI * 2, rr = K.top ? Math.random() * ar : Math.sqrt(Math.random()) * ar;
        pos[i * 3] = x + Math.cos(a) * rr; pos[i * 3 + 1] = y + (K.top ? K.top * s * .5 + Math.random() * 2 : 0); pos[i * 3 + 2] = z + Math.sin(a) * rr;
        const v = rnd(K.speed[0], K.speed[1]) * (K.top ? 1 : Math.sqrt(s)), d = Math.random() * Math.PI * 2;
        vel[i * 3] = Math.cos(d) * v * sp; vel[i * 3 + 1] = v * (1 - sp * .5); vel[i * 3 + 2] = Math.sin(d) * v * sp;
        if (K.top) { vel[i * 3] = vel[i * 3 + 2] = 0; vel[i * 3 + 1] = v; }
        age[i] = 0; life[i] = rnd(K.life[0], K.life[1]); base[i] = rnd(K.size[0], K.size[1]) * s; ph[i] = Math.random() * 6.283; spin[i] = Math.random() * 6.283;
        if (K.palette) { ca.set(K.palette[(Math.random() * K.palette.length) | 0]); tint[i * 3] = ca.r; tint[i * 3 + 1] = ca.g; tint[i * 3 + 2] = ca.b; }
        else { const m = Math.random() * .25; for (let k = 0; k < 3; k++) tint[i * 3 + k] = em.c1[k] * (1 - m) + em.c2[k] * m; }
      }
      em.burst = n => { const p = atFn ? atFn() : at; if (!p) return; for (let k = 0; k < n; k++) spawn(p[0], p[1], p[2]); };
      em.step = dt => {
        const K = em.kind, p = atFn ? atFn() : at;
        if (em.enabled && p) { em.acc += em.rate * dt; let n = Math.min(60, em.acc | 0); em.acc -= n; while (n-- > 0) spawn(p[0], p[1], p[2]); }
        else em.acc = 0;
        // движение и смерть (умершие меняются местами с последней — массив без дыр)
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
          vel[i * 3 + 1] -= K.gravity * dt;
          if (K.drag) { const f = Math.max(0, 1 - K.drag * dt); vel[i * 3] *= f; vel[i * 3 + 2] *= f; if (vel[i * 3 + 1] < -3) vel[i * 3 + 1] = -3; }
          let wx = 0, wz = 0;
          if (K.drift) { wx = Math.sin(age[i] * 1.3 + ph[i]) * K.drift; wz = Math.cos(age[i] * 1.1 + ph[i]) * K.drift; }
          if (K.orbit) { wx += Math.cos(age[i] * 3 + ph[i]) * K.orbit; wz += Math.sin(age[i] * 3 + ph[i]) * K.orbit; }
          pos[i * 3] += (vel[i * 3] + wx) * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += (vel[i * 3 + 2] + wz) * dt;
          // размер, цвет и прозрачность за жизнь
          let sz = base[i];
          if (K.shrink) sz *= 1 - t * .85; if (K.grow) sz *= .5 + t;
          if (K.twinkle) sz *= .65 + .35 * Math.sin(age[i] * 14 + ph[i]);
          size[i] = sz;
          const fade = Math.min(1, t * 6) * (1 - t * t) * (K.alpha ?? 1);
          const m = em.c2 && !K.palette ? t : 0;
          col[i * 4] = tint[i * 3] * (1 - m) + em.c2[0] * m; col[i * 4 + 1] = tint[i * 3 + 1] * (1 - m) + em.c2[1] * m; col[i * 4 + 2] = tint[i * 3 + 2] * (1 - m) + em.c2[2] * m; col[i * 4 + 3] = fade;
          if (K.shape === 1) spin[i] += dt * 4;
        }
        geo.setDrawRange(0, em.n);
        if (em.n) { geo.attributes.position.needsUpdate = geo.attributes.aSize.needsUpdate = geo.attributes.aColor.needsUpdate = geo.attributes.aSpin.needsUpdate = true; }
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
    FX.dispose = () => { for (const em of [...list]) em.dispose(); };
    return FX;
  };
  E.fx.KINDS = KINDS;
})();
