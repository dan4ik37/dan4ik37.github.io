// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — графика: рендерер, небо, свет, детали (как блоки в Роблоксе), готовые
//  предметы (деревья, фонари, скамейки, фонтан, порталы…) и склейка статичного мира в несколько вызовов отрисовки
// ═══════════════════════════════════════
// R = D37E.renderer(container) → { T, K (World3D.kit: мультяшные материалы и человечки), r, scene, camera, q (качество) }.
// Детали: R.part(parent, { s: 'box'|'cyl'|'cone'|'ball'|'torus', x, y, z, w, h, d (r), yaw, rx, rz, c: цвет, m: 'toon'|'basic'|'glow' }).
// Предметы: R.prefab(name, opts, phys) → THREE.Group (+ тела в физике). Всё статичное — в R.static, потом R.bakeStatic().
(() => {
  const E = window.D37E = window.D37E || {};
  const PI = Math.PI, TAU = PI * 2;

  E.renderer = function (container, o = {}){
    const T = window.THREE, K = window.World3D.kit(T), q = o.quality || E.quality();
    const r = new T.WebGLRenderer({ antialias: q !== 'low', powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'low' ? 1 : q === 'mid' ? 1.5 : 2));
    r.outputEncoding = T.sRGBEncoding;
    r.domElement.className = 'e-gl';
    container.prepend(r.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(50, 1, .2, 700);
    const sun = K.lights(scene);
    const R = { T, K, r, scene, camera, q, sun, static: new T.Group(), w: 1, h: 1, dead: false };
    scene.add(R.static);

    // ── Небо: купол с переходом цвета (зенит → горизонт), туман того же цвета ──
    const skyGeo = new T.SphereGeometry(400, 24, 12);
    const skyMat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new T.Color('#5aa7ff') }, mid: { value: new T.Color('#bfe3ff') }, bot: { value: new T.Color('#e8f5ff') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // #include — только с новой строки (иначе шейдер не собирается)
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : mix(mid, bot, min(1.0, -h * 4.0)); gl_FragColor = vec4(c, 1.0);
#include <encodings_fragment>
}`,
    });
    const sky = new T.Mesh(skyGeo, skyMat);
    sky.renderOrder = -1;
    scene.add(sky);
    R.setSky = (top, mid, bot, near = 70, far = 190) => {
      skyMat.uniforms.top.value.set(top); skyMat.uniforms.mid.value.set(mid); skyMat.uniforms.bot.value.set(bot || mid);
      scene.fog = new T.Fog(mid, near, far);
      scene.background = new T.Color(mid);
    };
    R.setSky('#5aa7ff', '#bfe3ff', '#e8f5ff');

    R.resize = () => {
      const b = container.getBoundingClientRect();
      R.w = Math.max(100, b.width); R.h = Math.max(100, b.height);
      r.setSize(R.w, R.h, false);
      r.domElement.style.width = R.w + 'px'; r.domElement.style.height = R.h + 'px';
      camera.aspect = R.w / R.h; camera.fov = camera.userData.fov0 = R.w < R.h ? 58 : 50; camera.updateProjectionMatrix();
    };
    R.render = () => { sky.position.copy(camera.position); r.render(scene, camera); };
    const v3 = new T.Vector3();
    // Точка мира → экран (для подписей): [x, y, видна ли]
    R.project = (x, y, z) => { v3.set(x, y, z).project(camera); return [(v3.x + 1) / 2 * R.w, (1 - v3.y) / 2 * R.h, v3.z < 1 && Math.abs(v3.x) < 1.25 && Math.abs(v3.y) < 1.25]; };
    // Экран → луч мира (для клика)
    const ray = new T.Raycaster(), ndc = new T.Vector2();
    R.screenRay = (cx, cy) => {
      const b = r.domElement.getBoundingClientRect();
      ndc.set((cx - b.left) / b.width * 2 - 1, -((cy - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return { ox: ray.ray.origin.x, oy: ray.ray.origin.y, oz: ray.ray.origin.z, dx: ray.ray.direction.x, dy: ray.ray.direction.y, dz: ray.ray.direction.z };
    };
    R.dispose = () => {
      R.dead = true;
      scene.traverse(x => { if (x.isMesh && x.userData.own) x.geometry.dispose(); });
      r.dispose(); r.forceContextLoss?.(); r.domElement.remove();
    };

    // ═══ Детали ═══
    const glow = c => K.mats.get('glow' + c) || (K.mats.set('glow' + c, new T.MeshBasicMaterial({ color: c })), K.mats.get('glow' + c));
    const matOf = p => p.m === 'basic' || p.m === 'glow' ? glow(p.c || '#ffffff') : p.m === 'ds' ? K.toon(p.c || '#cccccc', 1) : p.m?.isMaterial ? p.m : K.toon(p.c || '#cccccc');
    const f3 = v => (+v).toFixed(3);
    const geoOf = p => {
      const s = p.s || 'box';
      if (s === 'box') return K.geo(`ebox${f3(p.w)}_${f3(p.h)}_${f3(p.d)}`, () => new T.BoxGeometry(p.w, p.h, p.d));
      if (s === 'cyl') return K.geo(`ecyl${f3(p.r)}_${f3(p.r2 ?? p.r)}_${f3(p.h)}_${p.seg || 14}`, () => new T.CylinderGeometry(p.r2 ?? p.r, p.r, p.h, p.seg || 14));
      if (s === 'cone') return K.geo(`econe${f3(p.r)}_${f3(p.h)}_${p.seg || 12}`, () => new T.ConeGeometry(p.r, p.h, p.seg || 12));
      if (s === 'ball') return K.geo(`eball${f3(p.r)}_${p.seg || 14}`, () => new T.SphereGeometry(p.r, p.seg || 14, Math.max(6, Math.round((p.seg || 14) * .7))));
      if (s === 'ico') return K.geo(`eico${f3(p.r)}_${p.det ?? 1}`, () => new T.IcosahedronGeometry(p.r, p.det ?? 1));
      if (s === 'torus') return K.geo(`etor${f3(p.r)}_${f3(p.t)}_${f3(p.arc ?? TAU)}`, () => new T.TorusGeometry(p.r, p.t, 8, 32, p.arc ?? TAU));
      if (s === 'ring') return K.geo(`ering${f3(p.r)}_${f3(p.r2)}`, () => new T.RingGeometry(p.r2, p.r, 40));
      if (s === 'disc') return K.geo(`edisc${f3(p.r)}`, () => new T.CircleGeometry(p.r, 32));
      if (s === 'plane') return K.geo(`eplane${f3(p.w)}_${f3(p.d)}`, () => new T.PlaneGeometry(p.w, p.d));
      throw new Error('деталь: ' + s);
    };
    R.part = (parent, p) => {
      const m = new T.Mesh(geoOf(p), matOf(p));
      m.position.set(p.x || 0, p.y || 0, p.z || 0);
      if (p.yaw || p.rx || p.rz) m.rotation.set(p.rx || 0, p.yaw || 0, p.rz || 0);
      if (p.sx || p.sy || p.sz) m.scale.set(p.sx || 1, p.sy || 1, p.sz || 1);
      if (p.dyn) m.userData.dyn = true;   // двигается — не склеивать
      parent.add(m);
      return m;
    };
    R.group = (parent, x = 0, y = 0, z = 0, yaw = 0) => { const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = yaw; (parent || R.static).add(g); return g; };

    // ═══ Готовые предметы (параметры — opts; тела — в phys) ═══
    const PF = {
      // дерево: ствол + 3 шара кроны; v — вариант цвета, k — размер
      tree(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z, o.yaw || 0), k = o.k || 1;
        const greens = o.colors || ['#2f8a3f', '#3fa24c', '#58b85a', '#2c7a3a'], v = o.v || 0;
        R.part(g, { s: 'cyl', r: .32 * k, r2: .24 * k, h: 1.7 * k, y: .85 * k, c: '#7a4f2c', seg: 7 });
        [[0, 2.25, 0, 1.2], [-.65, 1.85, .22, .85], [.66, 1.9, -.12, .9]].forEach(([dx, dy, dz, rr], j) =>
          R.part(g, { s: 'ico', r: rr * k, x: dx * k, y: dy * k, z: dz * k, c: greens[(v + j) % greens.length], sy: .92 }));
        ph?.addCyl({ x: o.x, z: o.z, y: 1.2 * k, r: .38 * k, hy: 1.2 * k, tag: 'tree' });
        return g;
      },
      pine(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z), k = o.k || 1;
        R.part(g, { s: 'cyl', r: .26 * k, h: 1.2 * k, y: .6 * k, c: '#6b4426', seg: 6 });
        [[1.4, 1.5, 1.6], [1.1, 1.3, 2.5], [.75, 1.1, 3.3]].forEach(([rr, hh, y]) => R.part(g, { s: 'cone', r: rr * k, h: hh * k, y: y * k, c: o.c || '#2f7d4a', seg: 8 }));
        ph?.addCyl({ x: o.x, z: o.z, y: 1.2 * k, r: .32 * k, hy: 1.2 * k, tag: 'tree' });
        return g;
      },
      bush(o){
        const g = R.group(o.parent, o.x, 0, o.z), k = o.k || 1;
        [[0, .45, 0, .6], [.45, .35, .1, .45], [-.4, .35, -.05, .42]].forEach(([dx, dy, dz, rr]) => R.part(g, { s: 'ico', r: rr * k, x: dx * k, y: dy * k, z: dz * k, c: o.c || '#3f9a4c', det: 1 }));
        return g;
      },
      rock(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z, o.yaw || 0), k = o.k || 1;
        R.part(g, { s: 'ico', r: .7 * k, y: .35 * k, c: o.c || '#8b929c', det: 0, sy: .7 });
        ph?.addCyl({ x: o.x, z: o.z, y: .35 * k, r: .6 * k, hy: .4 * k, tag: 'rock' });
        return g;
      },
      flowers(o){
        const g = R.group(o.parent, o.x, 0, o.z), n = o.n || 6, rnd = E.rng(o.seed || 1);
        for (let i = 0; i < n; i++) {
          const a = rnd() * TAU, d = rnd() * .8;
          R.part(g, { s: 'cyl', r: .025, h: .35, x: Math.cos(a) * d, y: .17, z: Math.sin(a) * d, c: '#3f9a4c', seg: 4 });
          R.part(g, { s: 'ball', r: .09, x: Math.cos(a) * d, y: .38, z: Math.sin(a) * d, c: o.c || '#f472b6', seg: 6 });
        }
        return g;
      },
      lamp(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z);
        R.part(g, { s: 'cyl', r: .1, r2: .07, h: 3, y: 1.5, c: '#2d2a3a', seg: 8 });
        R.part(g, { s: 'cyl', r: .22, h: .12, y: .06, c: '#2d2a3a', seg: 10 });
        R.part(g, { s: 'ball', r: .26, y: 3.1, c: '#fff3b0', m: 'glow', seg: 12 });
        R.part(g, { s: 'cone', r: .32, h: .22, y: 3.38, c: '#2d2a3a', seg: 10 });
        ph?.addCyl({ x: o.x, z: o.z, y: 1.5, r: .16, hy: 1.5, tag: 'lamp' });
        return g;
      },
      bench(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z, o.yaw || 0);
        R.part(g, { s: 'box', w: 2.2, h: .14, d: .62, y: .55, c: o.c || '#a0673a' });
        R.part(g, { s: 'box', w: 2.2, h: .5, d: .12, y: .92, z: -.26, c: o.c2 || '#8b5a2b' });
        for (const s of [-1, 1]) R.part(g, { s: 'box', w: .12, h: .55, d: .5, x: s * .9, y: .27, c: '#3b2a1c' });
        ph?.addBox({ x: o.x, z: o.z, y: .5, hx: 1.1, hy: .5, hz: .33, yaw: o.yaw || 0, tag: 'bench', data: { seat: true, yaw: o.yaw || 0 } });
        return g;
      },
      sign(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z, o.yaw || 0);
        R.part(g, { s: 'box', w: .14, h: 1.6, d: .14, y: .8, c: '#6b4426' });
        const tex = textTex(o.text || '', o.c || '#7c3aed');
        const m = new T.Mesh(K.geo('signplane', () => new T.PlaneGeometry(1.8, .7)), new T.MeshBasicMaterial({ map: tex }));
        m.position.set(0, 1.75, .08); m.userData.dyn = true; g.add(m);
        R.part(g, { s: 'box', w: 1.9, h: .8, d: .1, y: 1.75, c: '#3b2a1c' });
        ph?.addBox({ x: o.x, z: o.z, y: .8, hx: .1, hy: .8, hz: .1, tag: 'sign' });
        return g;
      },
      fence(o, ph){
        // забор от (x1, z1) до (x2, z2)
        const dx = o.x2 - o.x1, dz = o.z2 - o.z1, len = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz) - PI / 2;
        const g = R.group(o.parent, (o.x1 + o.x2) / 2, 0, (o.z1 + o.z2) / 2, yaw), n = Math.max(1, Math.round(len / 1.6));
        for (let i = 0; i <= n; i++) R.part(g, { s: 'box', w: .14, h: 1, d: .14, x: -len / 2 + len * i / n, y: .5, c: o.c || '#e7d3b0' });
        for (const y of [.35, .75]) R.part(g, { s: 'box', w: len, h: .1, d: .06, y, c: o.c || '#e7d3b0' });
        ph?.addBox({ x: (o.x1 + o.x2) / 2, z: (o.z1 + o.z2) / 2, y: .5, hx: len / 2, hy: .5, hz: .1, yaw, tag: 'fence' });
        return g;
      },
    };
    R.prefab = (name, opts = {}, ph) => { const f = PF[name] || R.prefabs[name]; if (!f) throw new Error('предмет: ' + name); return f(opts, ph, R); };
    R.prefabs = {};   // игра может добавить свои

    // Текст на плоскости (табличка)
    function textTex(text, bg){
      const c = document.createElement('canvas'); c.width = 512; c.height = 200;
      const g = c.getContext('2d');
      g.fillStyle = bg; g.fillRect(0, 0, 512, 200);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let size = 70; g.font = `900 ${size}px Montserrat, Arial, sans-serif`;
      while (g.measureText(text).width > 470 && size > 26) { size -= 4; g.font = `900 ${size}px Montserrat, Arial, sans-serif`; }
      g.fillText(text, 256, 104);
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
    }
    R.textTex = textTex;

    // ═══ Склейка статичного мира: все неподвижные детали R.static → по одной сетке на материал ═══
    R.bakeStatic = () => {
      R.static.updateMatrixWorld(true);
      const by = new Map(), drop = [];
      R.static.traverse(m => {
        if (!m.isMesh || m.userData.dyn || m.isInstancedMesh) return;
        let p = m.parent, dyn = false;
        while (p && p !== R.static) { if (p.userData.dyn) { dyn = true; break; } p = p.parent; }
        if (dyn) return;
        if (!by.has(m.material)) by.set(m.material, []);
        by.get(m.material).push(m);
        drop.push(m);
      });
      let calls = 0;
      for (const [mat, list] of by) {
        let n = 0;
        const parts = list.map(m => { const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); g.applyMatrix4(m.matrixWorld); n += g.attributes.position.count; return g; });
        const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
        let k = 0;
        for (const g of parts) {
          pos.set(g.attributes.position.array, k * 3);
          if (g.attributes.normal) nor.set(g.attributes.normal.array, k * 3);
          if (g.attributes.uv) uv.set(g.attributes.uv.array, k * 2);
          k += g.attributes.position.count; g.dispose();
        }
        const mg = new T.BufferGeometry();
        mg.setAttribute('position', new T.BufferAttribute(pos, 3)); mg.setAttribute('normal', new T.BufferAttribute(nor, 3)); mg.setAttribute('uv', new T.BufferAttribute(uv, 2));
        mg.computeBoundingSphere();
        const mesh = new T.Mesh(mg, mat); mesh.userData.own = true; mesh.matrixAutoUpdate = false;
        scene.add(mesh); calls++;
      }
      drop.forEach(m => m.parent?.remove(m));
      return calls;
    };
    return R;
  };

  // Камера — js/engine/camera.js (E.cameraRig)
})();
