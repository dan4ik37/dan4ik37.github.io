// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — графика: рендерер, свет и тени, небо с солнцем и облаками, материалы (PBR + текстуры с рельефом),
//  вода, детали (как блоки в Роблоксе), готовые предметы и склейка статичного мира в несколько вызовов отрисовки
// ═══════════════════════════════════════
// R = D37E.renderer(container, { quality }) → { T, K (World3D.kit: человечки), r, scene, camera, q (качество), sun }.
// Качество: low (слабые телефоны, «Экономный» режим) — без теней и текстур; mid — тени 1024; high — мягкие тени 2048,
// текстуры с картами нормалей. Свой выбор — localStorage d37_gfx (low/mid/high).
// Свет — как упрощённый HDRP: солнце (направленный свет с тенями, коробка теней ездит за игроком — R.follow(x, z)),
// небо (освещение и отражения от неба: PMREM из купола), тональная кривая ACES. Материалы: R.mat(цвет, { rough, metal,
// flat, emissive }), R.tex(имя, { tint, tile (м на повтор), rough }) — img/tex/<имя>.jpg + _n.jpg (нормали; CC0 из Unity-
// проекта, scripts/make-textures.py); R.canvasTex(…) — текстура кодом. R.water(цвет) — вода (рябь движется).
// Детали: R.part(parent, { s: 'box'|'cyl'|'cone'|'ball'|'ico'|'torus'|'ring'|'disc'|'plane', x, y, z, w, h, d (r), yaw, rx, rz,
// c: цвет, m: 'basic'|'glow'|'ds'|материал }). Предметы: R.prefab(имя, opts, phys). Всё статичное — в R.static, затем
// R.bakeStatic(): склейка по материалу + UV «по миру» (текстура ложится ровно на любой размер) + тень у земли (AO).
// Каждый кадр: R.update(dt) (облака, вода), R.follow(x, z) (тени за игроком), R.render().
(() => {
  const E = window.D37E = window.D37E || {};
  const PI = Math.PI, TAU = PI * 2;
  const TEX_DIR = 'img/tex/';

  E.gfxQuality = () => { try { const v = localStorage.getItem('d37_gfx'); if (['low', 'mid', 'high'].includes(v)) return v; } catch (e) {} return E.quality(); };

  E.renderer = function (container, o = {}){
    const T = window.THREE, K = window.World3D.kit(T), q = o.quality || E.gfxQuality();
    const r = new T.WebGLRenderer({ antialias: q !== 'low', powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'low' ? 1 : q === 'mid' ? 1.5 : 2));
    r.outputEncoding = T.sRGBEncoding;
    r.toneMapping = T.ACESFilmicToneMapping;
    r.toneMappingExposure = q === 'low' ? 1.0 : .98;
    const shadows = q !== 'low';
    if (shadows) { r.shadowMap.enabled = true; r.shadowMap.type = q === 'high' ? T.PCFSoftShadowMap : T.PCFShadowMap; }
    r.domElement.className = 'e-gl';
    container.prepend(r.domElement);
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(50, 1, .2, 800);
    const R = { T, K, r, scene, camera, q, static: new T.Group(), w: 1, h: 1, dead: false, anims: [], own: [] };
    scene.add(R.static);

    // ═══ Свет: небо + солнце с тенями ═══
    const SUN_DIR = new T.Vector3(-.55, .78, .3).normalize();
    const hemi = new T.HemisphereLight('#d4eaff', '#7d6a4a', q === 'low' ? 1.0 : .42);
    scene.add(hemi);
    const sun = new T.DirectionalLight('#ffeccf', q === 'low' ? 1.25 : 2.6);
    sun.position.copy(SUN_DIR).multiplyScalar(90);
    if (shadows) {
      sun.castShadow = true;
      const s = q === 'high' ? 2048 : 1024, e = q === 'high' ? 34 : 26;
      sun.shadow.mapSize.set(s, s);
      Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 10, far: 200 });
      sun.shadow.camera.updateProjectionMatrix();
      sun.shadow.bias = -.00035; sun.shadow.normalBias = .035;
      if (q === 'high') sun.shadow.radius = 3;
    }
    scene.add(sun); scene.add(sun.target);
    R.sun = sun; R.hemi = hemi; R.sunDir = SUN_DIR;
    // Коробка теней едет за игроком; шаг — ровно на тексель (иначе тени «дрожат» при ходьбе)
    const lr = new T.Vector3(), lu = new T.Vector3(), tgt = new T.Vector3();
    lr.crossVectors(new T.Vector3(0, 1, 0), SUN_DIR).normalize(); lu.crossVectors(SUN_DIR, lr).normalize();
    R.follow = (x, z, y = 0) => {
      tgt.set(x, y, z);
      if (shadows) {
        const tex = (sun.shadow.camera.right * 2) / sun.shadow.mapSize.x;
        const a = tgt.dot(lr), b = tgt.dot(lu), da = Math.round(a / tex) * tex - a, db = Math.round(b / tex) * tex - b;
        tgt.addScaledVector(lr, da).addScaledVector(lu, db);
      }
      sun.target.position.copy(tgt);
      sun.position.copy(tgt).addScaledVector(SUN_DIR, 100);
    };

    // ═══ Небо: переход цвета, солнце, свечение у горизонта; туман того же цвета ═══
    const skyMat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new T.Color('#4f9cf5') }, mid: { value: new T.Color('#bfe3ff') }, bot: { value: new T.Color('#e8f5ff') }, sunDir: { value: SUN_DIR }, sunC: { value: new T.Color('#fff4d6') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // #include — только с новой строки (иначе шейдер не собирается)
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 sunC; varying vec3 vP;
void main(){ vec3 d = normalize(vP); float h = d.y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.55)) : mix(mid, bot, min(1.0, -h * 4.0));
float s = max(dot(d, sunDir), 0.0); c += sunC * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.28 + pow(s, 4.0) * 0.06);
gl_FragColor = vec4(c, 1.0);
#include <encodings_fragment>
}`,
    });
    const sky = new T.Mesh(new T.SphereGeometry(450, 32, 16), skyMat);
    sky.renderOrder = -1; sky.frustumCulled = false;
    scene.add(sky);
    R.setSky = (top, mid, bot, near = 110, far = 320) => {
      skyMat.uniforms.top.value.set(top); skyMat.uniforms.mid.value.set(mid); skyMat.uniforms.bot.value.set(bot || mid);
      scene.fog = new T.Fog(mid, near, far);
      scene.background = new T.Color(mid);
      makeEnv();
    };
    // Освещение и отражения от неба (IBL): купол + яркое солнце → PMREM
    let envTex = null;
    function makeEnv(){
      if (q === 'low') return;
      const pm = new T.PMREMGenerator(r), es = new T.Scene();
      const m = skyMat.clone(); m.uniforms = T.UniformsUtils.clone(skyMat.uniforms); m.uniforms.sunDir.value = SUN_DIR;
      es.add(new T.Mesh(new T.SphereGeometry(10, 32, 16), m));
      const ground = new T.Mesh(new T.CircleGeometry(9, 24), new T.MeshBasicMaterial({ color: '#7d8f5c' }));
      ground.rotation.x = -PI / 2; ground.position.y = -1.5; es.add(ground);
      const rt = pm.fromScene(es, .03);
      envTex?.dispose(); envTex = rt.texture;
      scene.environment = envTex;
      pm.dispose(); m.dispose(); ground.geometry.dispose(); ground.material.dispose();
    }
    R.setSky('#4f9cf5', '#bfe3ff', '#e8f5ff');

    // ═══ Облака: мягкие спрайты кодом, медленно плывут ═══
    const clouds = [];
    R.clouds = (n = 14, seed = 7) => {
      const rnd = E.rng(seed), tex = cloudTex();
      for (let i = 0; i < n; i++) {
        const s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: .9 }));
        const a = rnd() * TAU, d = 110 + rnd() * 130, k = 34 + rnd() * 40;
        s.position.set(Math.cos(a) * d, 34 + rnd() * 34, Math.sin(a) * d);
        s.scale.set(k * 1.9, k * .75, 1);
        s.userData.v = 1.2 + rnd() * 1.6;
        scene.add(s); clouds.push(s); R.own.push(s.material);
      }
    };
    function cloudTex(){
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const g = c.getContext('2d'), rnd = E.rng(3);
      for (let i = 0; i < 22; i++) {
        const x = 40 + rnd() * 176, y = 50 + rnd() * 40, rr = 18 + rnd() * 34;
        const gr = g.createRadialGradient(x, y, 2, x, y, rr);
        gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(.6, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
      }
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; R.own.push(t); return t;
    }

    R.resize = () => {
      const b = container.getBoundingClientRect();
      R.w = Math.max(100, b.width); R.h = Math.max(100, b.height);
      r.setSize(R.w, R.h, false);
      r.domElement.style.width = R.w + 'px'; r.domElement.style.height = R.h + 'px';
      camera.aspect = R.w / R.h; camera.fov = camera.userData.fov0 = R.w < R.h ? 58 : 50; camera.updateProjectionMatrix();
    };
    R.update = dt => {
      for (const s of clouds) { s.position.x += s.userData.v * dt; if (s.position.x > 300) s.position.x = -300; }
      for (const f of R.anims) f(dt);
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
      for (const m of mats.values()) m.dispose();
      for (const t of texCache.values()) t.dispose();
      for (const x of R.own) x.dispose?.();
      envTex?.dispose();
      r.dispose(); r.forceContextLoss?.(); r.domElement.remove();
    };

    // ═══ Материалы ═══
    const mats = new Map(), texCache = new Map();
    const cache = (k, f) => mats.get(k) || (mats.set(k, f()), mats.get(k));
    // Обычный материал: PBR (шероховатый «пластик/краска»), на слабых — Ламберт
    R.mat = (c, o = {}) => cache(`m${c}|${o.rough ?? ''}|${o.metal ?? ''}|${o.flat ? 1 : 0}|${o.emissive || ''}|${o.ds ? 1 : 0}`, () => {
      const p = { color: c, side: o.ds ? T.DoubleSide : T.FrontSide };
      if (o.emissive) { p.emissive = new T.Color(o.emissive); p.emissiveIntensity = o.ei ?? 1; }
      if (q === 'low') return new T.MeshLambertMaterial({ ...p, flatShading: !!o.flat });
      return new T.MeshStandardMaterial({ ...p, roughness: o.rough ?? .82, metalness: o.metal ?? 0, flatShading: !!o.flat, envMapIntensity: o.env ?? .65 });
    });
    const glow = c => cache('glow' + c, () => new T.MeshBasicMaterial({ color: c, toneMapped: false }));
    // Текстура из img/tex (грузится в фоне; пока грузится — материал просто цветной)
    const loader = new T.TextureLoader();
    const loadTex = (file, srgb) => {
      if (texCache.has(file)) return texCache.get(file);
      const t = loader.load(TEX_DIR + file, tt => { tt.needsUpdate = true; });
      t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = q === 'high' ? 8 : 4;
      if (srgb) t.encoding = T.sRGBEncoding;
      texCache.set(file, t);
      return t;
    };
    R.tex = (name, o = {}) => cache(`t${name}|${o.tint || ''}|${o.tile || ''}|${o.rough ?? ''}|${o.ns ?? ''}`, () => {
      const tint = o.tint || '#ffffff';
      if (q === 'low') { const m = new T.MeshLambertMaterial({ color: o.flatColor || tint }); m.userData.tile = 0; return m; }
      const m = new T.MeshStandardMaterial({ color: tint, roughness: o.rough ?? .9, metalness: 0, map: loadTex(name + '.jpg', true), envMapIntensity: .8 });
      if (q === 'high' && o.normal !== false) { m.normalMap = loadTex(name + '_n.jpg', false); m.normalScale = new T.Vector2(o.ns ?? 1, o.ns ?? 1); }
      m.userData.tile = (o.tile || 2) * (E.UNIT || 1);
      return m;
    });
    // Текстура кодом (трава, черепица…): draw(g, size, rnd)
    R.canvasTex = (key, size, draw, o = {}) => {
      if (texCache.has(key)) return texCache.get(key);
      const c = document.createElement('canvas'); c.width = c.height = size;
      draw(c.getContext('2d'), size, E.rng(o.seed || 11));
      const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = q === 'high' ? 8 : 4;
      if (o.srgb !== false) t.encoding = T.sRGBEncoding;
      texCache.set(key, t);
      return t;
    };
    // Нормали из «высоты» (Собель) — для текстур кодом
    R.normalFrom = (key, size, height, strength = 2) => R.canvasTex(key, size, (g, n) => {
      const H = height(n), img = g.createImageData(n, n), at = (x, y) => H[((y + n) % n) * n + ((x + n) % n)];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1), i = (y * n + x) * 4;
        img.data[i] = (-dx / l * .5 + .5) * 255; img.data[i + 1] = (dy / l * .5 + .5) * 255; img.data[i + 2] = (1 / l * .5 + .5) * 255; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }, { srgb: false });
    R.texMat = (key, map, o = {}) => cache('cm' + key + (o.tint || ''), () => {
      if (q === 'low') return new T.MeshLambertMaterial({ color: o.flatColor || o.tint || '#ffffff', map: o.lowMap ? map : null });
      const m = new T.MeshStandardMaterial({ color: o.tint || '#ffffff', map, roughness: o.rough ?? .9, metalness: 0, envMapIntensity: .8 });
      if (o.normalMap && q === 'high') { m.normalMap = o.normalMap; m.normalScale = new T.Vector2(o.ns ?? 1, o.ns ?? 1); }
      m.userData.tile = (o.tile || 2) * (E.UNIT || 1);
      return m;
    });
    // Вода: блестящая, рябь движется (нормали кодом), чуть прозрачная
    R.water = (c = '#3fa9e0') => cache('water' + c, () => {
      if (q === 'low') return new T.MeshLambertMaterial({ color: c, transparent: true, opacity: .9 });
      const nm = R.normalFrom('waterN', 256, n => {
        const H = new Float32Array(n * n), rnd = E.rng(21), waves = Array.from({ length: 9 }, () => [1 + (rnd() * 5 | 0), 1 + (rnd() * 5 | 0), rnd() * TAU, .3 + rnd() * .7]);
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let h = 0; for (const [a, b, p, k] of waves) h += Math.sin((a * x + b * y) / n * TAU + p) * k; H[y * n + x] = h * .06; }
        return H;
      }, 3);
      const m = new T.MeshStandardMaterial({ color: c, roughness: .06, metalness: .05, transparent: true, opacity: .88, normalMap: nm, envMapIntensity: 1.4 });
      m.normalScale = new T.Vector2(.6, .6);
      m.userData.tile = 4 * (E.UNIT || 1); m.userData.noCast = true; m.userData.noAO = true;
      R.anims.push(dt => { nm.offset.x += dt * .018; nm.offset.y += dt * .011; });
      return m;
    });

    // ═══ Детали ═══
    const matOf = p => p.m === 'basic' || p.m === 'glow' ? glow(p.c || '#ffffff') : p.m === 'ds' ? R.mat(p.c || '#cccccc', { ds: true }) : p.m?.isMaterial ? p.m
      : R.mat(p.c || '#cccccc', { flat: p.s === 'ico' || p.flat, rough: p.rough, metal: p.metal, emissive: p.emissive });
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
      if (s === 'disc') return K.geo(`edisc${f3(p.r)}`, () => new T.CircleGeometry(p.r, 40));
      if (s === 'plane') return K.geo(`eplane${f3(p.w)}_${f3(p.d)}`, () => new T.PlaneGeometry(p.w, p.d));
      throw new Error('деталь: ' + s);
    };
    R.part = (parent, p) => {
      const m = new T.Mesh(geoOf(p), matOf(p));
      m.position.set(p.x || 0, p.y || 0, p.z || 0);
      if (p.yaw || p.rx || p.rz) m.rotation.set(p.rx || 0, p.yaw || 0, p.rz || 0);
      if (p.sx || p.sy || p.sz) m.scale.set(p.sx || 1, p.sy || 1, p.sz || 1);
      if (p.dyn) m.userData.dyn = true;   // двигается — не склеивать
      if (p.noCast) m.userData.noCast = true;
      if (shadows && p.dyn) { m.castShadow = !p.noCast; m.receiveShadow = true; }
      parent.add(m);
      return m;
    };
    R.group = (parent, x = 0, y = 0, z = 0, yaw = 0) => { const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = yaw; (parent || R.static).add(g); return g; };
    // Тени у подвижного/несклеиваемого объекта (крыши, человечки)
    R.shadowsOn = (obj, cast = true, receive = true) => { if (!shadows) return; obj.traverse(m => { if (m.isMesh && !m.isSprite) { m.castShadow = cast && !m.material?.userData?.noCast; m.receiveShadow = receive; } }); };
    // UV «по миру» для отдельного объекта (крыша и т. п.): текстура ложится ровно, плитка — material.userData.tile
    R.worldUV = (mesh, tile) => {
      mesh.updateWorldMatrix(true, false);
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      const pos = g.attributes.position, nor = g.attributes.normal, mw = mesh.matrixWorld, nm = new T.Matrix3().getNormalMatrix(mw);
      const p = new T.Vector3(), n = new T.Vector3(), uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(mw); n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        boxUV(p, n, tile, uv, i);
      }
      g.setAttribute('uv', new T.BufferAttribute(uv, 2));
      mesh.geometry = g; mesh.userData.own = true;
    };
    function boxUV(p, n, tile, out, i){
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      let u, v;
      if (ay >= ax && ay >= az) { u = p.x; v = n.y > 0 ? -p.z : p.z; }
      else if (ax >= az) { u = n.x > 0 ? -p.z : p.z; v = p.y; }
      else { u = n.z > 0 ? p.x : -p.x; v = p.y; }
      out[i * 2] = u / tile; out[i * 2 + 1] = v / tile;
    }

    // ═══ Готовые предметы (параметры — opts; тела — в phys) ═══
    const PF = {
      // дерево: ствол + 3 «облака» кроны (низкополигональные, с тенью); v — вариант цвета, k — размер
      tree(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z, o.yaw || 0), k = o.k || 1;
        const greens = o.colors || ['#3f8f3a', '#4ea544', '#62b84f', '#367d34'], v = o.v || 0;
        R.part(g, { s: 'cyl', r: .32 * k, r2: .22 * k, h: 1.9 * k, y: .95 * k, c: '#7a4f2c', seg: 7, rough: .95 });
        [[0, 2.45, 0, 1.25], [-.7, 2.0, .25, .9], [.7, 2.05, -.15, .95], [.1, 2.95, .1, .8]].forEach(([dx, dy, dz, rr], j) =>
          R.part(g, { s: 'ico', r: rr * k, x: dx * k, y: dy * k, z: dz * k, c: greens[(v + j) % greens.length], sy: .9, det: 1 }));
        ph?.addCyl({ x: o.x, z: o.z, y: 1.2 * k, r: .38 * k, hy: 1.2 * k, tag: 'tree' });
        return g;
      },
      pine(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z), k = o.k || 1;
        R.part(g, { s: 'cyl', r: .26 * k, h: 1.2 * k, y: .6 * k, c: '#6b4426', seg: 6 });
        [[1.5, 1.6, 1.6], [1.15, 1.4, 2.6], [.78, 1.2, 3.45]].forEach(([rr, hh, y]) => R.part(g, { s: 'cone', r: rr * k, h: hh * k, y: y * k, c: o.c || '#2f7d4a', seg: 8, flat: true }));
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
        R.part(g, { s: 'ico', r: .7 * k, y: .3 * k, c: o.c || '#8b929c', det: 0, sy: .7, rough: .95 });
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
        R.part(g, { s: 'cyl', r: .1, r2: .07, h: 3, y: 1.5, c: '#2d2a3a', seg: 8, rough: .5, metal: .6 });
        R.part(g, { s: 'cyl', r: .22, h: .12, y: .06, c: '#2d2a3a', seg: 10, rough: .5, metal: .6 });
        R.part(g, { s: 'ball', r: .26, y: 3.1, c: '#fff3b0', m: 'glow', seg: 12 });
        if (q !== 'low') { const hl = new T.Sprite(halo()); hl.position.set(0, 3.1, 0); hl.scale.setScalar(1.05); g.add(hl); }
        R.part(g, { s: 'cone', r: .32, h: .22, y: 3.38, c: '#2d2a3a', seg: 10, rough: .5, metal: .6 });
        ph?.addCyl({ x: o.x, z: o.z, y: 1.5, r: .16, hy: 1.5, tag: 'lamp' });
        return g;
      },
      bench(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z, o.yaw || 0), wood = o.m || R.mat(o.c || '#a0673a', { rough: .75 });
        R.part(g, { s: 'box', w: 2.2, h: .14, d: .62, y: .55, m: wood });
        R.part(g, { s: 'box', w: 2.2, h: .5, d: .12, y: .92, z: -.26, m: o.m2 || wood });
        for (const s of [-1, 1]) R.part(g, { s: 'box', w: .12, h: .55, d: .5, x: s * .9, y: .27, c: '#2f2a26', rough: .5, metal: .5 });
        ph?.addBox({ x: o.x, z: o.z, y: .5, hx: 1.1, hy: .5, hz: .33, yaw: o.yaw || 0, tag: 'bench', data: { seat: true, yaw: o.yaw || 0 } });
        return g;
      },
      sign(o, ph){
        const g = R.group(o.parent, o.x, 0, o.z, o.yaw || 0);
        R.part(g, { s: 'box', w: .14, h: 1.6, d: .14, y: .8, c: '#6b4426' });
        const tex = textTex(o.text || '', o.c || '#7c3aed');
        const m = new T.Mesh(K.geo('signplane', () => new T.PlaneGeometry(1.8, .7)), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
        m.position.set(0, 1.75, .08); m.userData.dyn = true; g.add(m); R.own.push(m.material, tex);
        R.part(g, { s: 'box', w: 1.9, h: .8, d: .1, y: 1.75, c: '#3b2a1c' });
        ph?.addBox({ x: o.x, z: o.z, y: .8, hx: .1, hy: .8, hz: .1, tag: 'sign' });
        return g;
      },
      fence(o, ph){
        // забор от (x1, z1) до (x2, z2)
        const dx = o.x2 - o.x1, dz = o.z2 - o.z1, len = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz) - PI / 2;
        const g = R.group(o.parent, (o.x1 + o.x2) / 2, 0, (o.z1 + o.z2) / 2, yaw), n = Math.max(1, Math.round(len / 1.6));
        for (let i = 0; i <= n; i++) R.part(g, { s: 'box', w: .14, h: 1, d: .14, x: -len / 2 + len * i / n, y: .5, c: o.c || '#efe2c6' });
        for (const y of [.35, .75]) R.part(g, { s: 'box', w: len, h: .1, d: .06, y, c: o.c || '#efe2c6' });
        ph?.addBox({ x: (o.x1 + o.x2) / 2, z: (o.z1 + o.z2) / 2, y: .5, hx: len / 2, hy: .5, hz: .1, yaw, tag: 'fence' });
        return g;
      },
    };
    let haloMat = null;
    function halo(){
      if (haloMat) return haloMat;
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      gr.addColorStop(0, 'rgba(255,240,190,.5)'); gr.addColorStop(.35, 'rgba(255,225,150,.16)'); gr.addColorStop(1, 'rgba(255,220,140,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; R.own.push(t);
      haloMat = new T.SpriteMaterial({ map: t, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false }); R.own.push(haloMat);
      return haloMat;
    }
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

    // ═══ Склейка статичного мира: детали R.static → по одной сетке на материал; UV по миру; тень у земли; тени ═══
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
      const p = new T.Vector3(), n = new T.Vector3();
      for (const [mat, list] of by) {
        let cnt = 0;
        const parts = list.map(m => { const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); g.applyMatrix4(m.matrixWorld); cnt += g.attributes.position.count; return g; });
        const pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3), uv = new Float32Array(cnt * 2);
        const tile = mat.userData?.tile, ao = !mat.userData?.noAO && q !== 'low' && !mat.isMeshBasicMaterial, col = ao ? new Float32Array(cnt * 3) : null;
        let k = 0;
        for (const g of parts) {
          const gp = g.attributes.position, gn = g.attributes.normal, gu = g.attributes.uv;
          pos.set(gp.array, k * 3);
          if (gn) nor.set(gn.array, k * 3);
          for (let i = 0; i < gp.count; i++) {
            p.fromBufferAttribute(gp, i);
            if (gn) n.fromBufferAttribute(gn, i); else n.set(0, 1, 0);
            if (tile) boxUV(p, n, tile, uv, k + i);
            else if (gu) { uv[(k + i) * 2] = gu.getX(i); uv[(k + i) * 2 + 1] = gu.getY(i); }
            if (col) {   // тень у земли: стены и столбы темнее внизу (как AO в HDRP — дёшево, вершинами)
              const vert = Math.abs(n.y) < .6, a = vert ? .58 + .42 * Math.min(1, Math.max(0, p.y / 1.4)) : 1;
              col[(k + i) * 3] = col[(k + i) * 3 + 1] = col[(k + i) * 3 + 2] = a;
            }
          }
          k += gp.count; g.dispose();
        }
        const mg = new T.BufferGeometry();
        mg.setAttribute('position', new T.BufferAttribute(pos, 3)); mg.setAttribute('normal', new T.BufferAttribute(nor, 3)); mg.setAttribute('uv', new T.BufferAttribute(uv, 2));
        let useMat = mat;
        if (col) { mg.setAttribute('color', new T.BufferAttribute(col, 3)); useMat = mat.clone(); useMat.vertexColors = true; R.own.push(useMat); }
        mg.computeBoundingSphere();
        const mesh = new T.Mesh(mg, useMat); mesh.userData.own = true; mesh.matrixAutoUpdate = false;
        if (shadows) { mesh.castShadow = !mat.userData?.noCast && !mat.isMeshBasicMaterial; mesh.receiveShadow = !mat.isMeshBasicMaterial; }
        scene.add(mesh); calls++;
      }
      drop.forEach(m => m.parent?.remove(m));
      return calls;
    };
    return R;
  };

  // Камера — js/engine/camera.js (E.cameraRig)
})();
