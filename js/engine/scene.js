// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — сцена как в Roblox: объекты (детали, модели, точки появления, свет, готовые предметы, скрипты),
//  свойства и материалы, иерархия, копирование, сохранение; меши и тела физики строятся по свойствам
// ═══════════════════════════════════════
// SC = D37E.scene(R, phys, { edit }) — R: D37E.renderer, phys: D37E.Phys.
//   SC.add(класс, свойства, родитель) → объект; SC.remove(obj); SC.set(obj, свойство, значение); SC.get(id); SC.all();
//   SC.clone(obj); SC.pick(raycaster) → объект под мышью; SC.box(obj) → THREE.Box3; SC.toJSON() / SC.fromJSON(data);
//   SC.touching(ch) — каких деталей касается персонаж (для события «коснулся»); SC.on('add'|'remove'|'change', f).
// Классы: Part (деталь: shape block | ball | cyl | wedge), Spawn (точка появления), Light (свет), Prefab (готовый предмет:
// дерево, фонарь, скамейка…), Model (группа), Script (скрипт — код в песочнице, см. script.js), Mesh (своя 3D-модель —
// как MeshPart: model — номер в D37E.models (model.js), pos — центр, size — растягивает модель; тело — fit: 'precise' —
// коробки по поверхности модели (M.colliders), 'box' — одна коробка size), Effect (частицы fx.js: kind — огонь, дым, искры…;
// внутри детали — летят из неё, сам по себе — из pos; rate и scale — множители; нужен SC.fx = D37E.fx(R)).
// Свойства детали: pos [x,y,z], rot [x,y,z] (градусы, порядок YXZ как в Roblox), size [x,y,z], color '#rrggbb',
// mat (материал — SC.MATS), alpha (прозрачность 0…1), collide (сталкивается), anchored (закреплена; нет — падает),
// shadow (отбрасывает тень), attrs (свои значения для скриптов). Физика: блок/клин/цилиндр — точно при поворотах на 90°
// по X и Z (любой поворот по Y); при наклонах — описанная коробка.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const DEG = Math.PI / 180;

  // ═══ Материалы (как в Roblox): ключ, название, значок, плитка текстуры (м) ═══
  const MATS = [
    ['plastic', 'Пластик', '🟦'], ['smooth', 'Гладкий пластик', '🔷'], ['neon', 'Неон', '💡'], ['glass', 'Стекло', '🪟'], ['metal', 'Металл', '⚙️'],
    ['diamond', 'Рифлёный металл', '🔩'], ['wood', 'Дерево', '🪵'], ['planks', 'Паркет', '🟫'], ['brick', 'Кирпич', '🧱'], ['concrete', 'Бетон', '⬜'],
    ['cobble', 'Плитка', '🔲'], ['asphalt', 'Асфальт', '⬛'], ['grass', 'Трава', '🌿'], ['sand', 'Песок', '🏖️'], ['rock', 'Камень', '🪨'],
    ['dirt', 'Земля', '🟤'], ['snow', 'Снег', '❄️'], ['ice', 'Лёд', '🧊'], ['marble', 'Мрамор', '🏛️'], ['fabric', 'Ткань', '🧶'], ['tiles', 'Кафель', '◽'],
  ];
  const TILE = { wood: 1.2, planks: 1.8, brick: 2.4, concrete: 2.4, cobble: 2.6, asphalt: 4, grass: 2.4, sand: 3, rock: 3, dirt: 3, snow: 3, marble: 2.6, fabric: 2, tiles: 1.4, diamond: 1.2 };
  const FLOOR = { wood: 'wood', planks: 'wood', metal: 'metal', diamond: 'metal', grass: 'grass', sand: 'carpet', dirt: 'carpet', snow: 'carpet', fabric: 'carpet', tiles: 'tile', marble: 'tile', ice: 'tile', glass: 'tile' };
  const PREFABS = [
    ['tree', 'Дерево', '🌳'], ['pine', 'Ёлка', '🌲'], ['bush', 'Куст', '🌿'], ['rock', 'Камень', '🪨'], ['flowers', 'Цветы', '🌸'],
    ['lamp', 'Фонарь', '🏮'], ['bench', 'Скамейка', '🪑'], ['sign', 'Табличка', '🪧'], ['fence', 'Забор', '🚧'],
  ];
  const SHAPES = [['block', 'Блок', '🟫'], ['ball', 'Шар', '⚪'], ['cyl', 'Цилиндр', '🛢️'], ['wedge', 'Клин (пандус)', '📐']];
  const DEF = {
    Part: { name: 'Деталь', shape: 'block', pos: [0, .5, 0], rot: [0, 0, 0], size: [4, 1, 2], color: '#a3a2a5', mat: 'plastic', alpha: 0, collide: true, anchored: true, shadow: true },
    Spawn: { name: 'Точка появления', shape: 'block', pos: [0, .2, 0], rot: [0, 0, 0], size: [6, .4, 6], color: '#5b6b82', mat: 'plastic', alpha: 0, collide: true, anchored: true, shadow: true },
    Light: { name: 'Свет', pos: [0, 4, 0], color: '#fff1c4', range: 18, power: 2 },
    Prefab: { name: 'Предмет', kind: 'tree', pos: [0, 0, 0], rot: [0, 0, 0], scale: 1, text: 'Привет!', color: '#7c3aed' },
    Model: { name: 'Модель' },
    Mesh: { name: 'Своя модель', model: '', pos: [0, 2, 0], rot: [0, 0, 0], size: [4, 4, 4], alpha: 0, collide: true, anchored: true, shadow: true, fit: 'precise' },
    Script: { name: 'Скрипт', code: '', enabled: true, lang: 'js' },
    Effect: { name: 'Эффект', kind: 'fire', pos: [0, 1, 0], rate: 1, scale: 1, color: '', color2: '', enabled: true },
  };
  const SAVE = ['name', 'shape', 'pos', 'rot', 'size', 'color', 'mat', 'alpha', 'collide', 'anchored', 'shadow', 'range', 'power', 'kind', 'scale', 'text', 'code', 'lang', 'src', 'enabled', 'attrs', 'locked', 'model', 'fit', 'rate', 'color2'];
  const r3 = v => Math.round(v * 1000) / 1000;
  const copy = v => Array.isArray(v) ? v.slice() : v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;

  E.scene = function (R, ph, o = {}){
    const T = R.T, ev = E.emitter(), objects = new Map(), order = [];
    const SC = { R, ph, objects, edit: !!o.edit, MATS, PREFABS, SHAPES, DEF, seq: 0, on: ev.on, terrain: null };
    const emit = (e, d) => ev.emit(e, d);
    const matCache = new Map();

    // ── Материал по ключу, цвету и прозрачности ──
    function material(key, color, alpha){
      const k = `${key}|${color}|${alpha}`;
      if (matCache.has(k)) return matCache.get(k);
      const low = R.q === 'low', tile = TILE[key] || 2;
      let m;
      switch (key) {
        case 'neon': m = new T.MeshBasicMaterial({ color, toneMapped: false }); break;
        case 'glass': m = low ? new T.MeshLambertMaterial({ color, transparent: true, opacity: .45 }) : new T.MeshStandardMaterial({ color, roughness: .04, metalness: .1, transparent: true, opacity: .3, envMapIntensity: 1.5 }); break;
        case 'ice': m = low ? new T.MeshLambertMaterial({ color, transparent: true, opacity: .85 }) : new T.MeshStandardMaterial({ color, roughness: .06, metalness: 0, transparent: true, opacity: .82, envMapIntensity: 1.3 }); break;
        case 'smooth': m = R.mat(color, { rough: .18, env: 1 }); break;
        case 'metal': m = R.mat(color, { rough: .3, metal: .85, env: 1.1 }); break;
        case 'wood': m = R.tex('planks', { tint: color, tile, flatColor: color, rough: .7 }); break;
        case 'planks': m = R.tex('parquet', { tint: color, tile, flatColor: color, rough: .6 }); break;
        case 'concrete': m = R.tex('sidewalk', { tint: color, tile, flatColor: color }); break;
        case 'cobble': m = R.tex('plaza', { tint: color, tile, flatColor: color }); break;
        case 'asphalt': m = R.tex('asphalt', { tint: color, tile, flatColor: color, rough: .95 }); break;
        case 'marble': m = R.tex('plaster', { tint: color, tile, flatColor: color, rough: .35 }); break;
        case 'fabric': m = R.tex('carpet', { tint: color, tile, flatColor: color }); break;
        case 'tiles': m = R.tex('tiles', { tint: color, tile, flatColor: color, rough: .3 }); break;
        case 'grass': case 'sand': case 'rock': case 'brick': case 'snow': case 'dirt': case 'diamond':
          m = R.texMat('m:' + key, R.proc(key), { tint: color, tile, flatColor: color, rough: key === 'diamond' ? .4 : .92 });
          if (key === 'diamond' && !low) { m = m.clone(); m.metalness = .7; }
          break;
        default: m = R.mat(color, { rough: .42 });
      }
      if (alpha > 0 && key !== 'glass') {
        m = m.clone(); m.transparent = true; m.opacity = Math.max(0, 1 - alpha); m.depthWrite = alpha < .5;
        if (!m.userData.tile && TILE[key]) m.userData.tile = tile * (E.UNIT || 1);
      }
      if (alpha >= .999) { m = m.clone(); m.visible = !SC.edit ? false : true; if (SC.edit) { m.transparent = true; m.opacity = .12; } }
      matCache.set(k, m);
      return m;
    }

    // ── Геометрия по форме и размеру: вершины уже нужного размера, UV «по коробке» в метрах (текстура не тянется) ──
    function wedgeGeo(){
      const A = [-.5, -.5, -.5], B = [.5, -.5, -.5], C = [.5, -.5, .5], D = [-.5, -.5, .5], Ee = [-.5, .5, -.5], F = [.5, .5, -.5];
      const tris = [[A, C, B], [A, D, C], [A, B, F], [A, F, Ee], [Ee, F, C], [Ee, C, D], [A, Ee, D], [B, C, F]];
      const pos = [], nor = [];
      for (let [a, b, c] of tris) {
        let n = cross(sub(b, a), sub(c, a));
        const cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
        if (n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] < 0) { [b, c] = [c, b]; n = n.map(v => -v); }
        const l = Math.hypot(...n);
        for (const p of [a, b, c]) { pos.push(...p); nor.push(n[0] / l, n[1] / l, n[2] / l); }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
      return g;
    }
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    function geometry(shape, s, tile){
      let g = shape === 'ball' ? new T.SphereGeometry(.5, 28, 18) : shape === 'cyl' ? new T.CylinderGeometry(.5, .5, 1, 28) : shape === 'wedge' ? wedgeGeo() : new T.BoxGeometry(1, 1, 1);
      if (g.index) g = g.toNonIndexed();
      const pos = g.attributes.position, nor = g.attributes.normal, uv = new Float32Array(pos.count * 2), t = tile || 1;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) * s[0], y = pos.getY(i) * s[1], z = pos.getZ(i) * s[2];
        pos.setXYZ(i, x, y, z);
        let nx = nor.getX(i) / s[0], ny = nor.getY(i) / s[1], nz = nor.getZ(i) / s[2];
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        nor.setXYZ(i, nx, ny, nz);
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
        if (ay >= ax && ay >= az) { uv[i * 2] = x / t; uv[i * 2 + 1] = (ny > 0 ? -z : z) / t; }
        else if (ax >= az) { uv[i * 2] = (nx > 0 ? -z : z) / t; uv[i * 2 + 1] = y / t; }
        else { uv[i * 2] = (nz > 0 ? x : -x) / t; uv[i * 2 + 1] = y / t; }
      }
      g.setAttribute('uv', new T.BufferAttribute(uv, 2));
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    }

    // ── Тела физики детали (точно — поворот по Y и шаги по 90° по X/Z; иначе описанная коробка) ──
    const q = new T.Quaternion(), eu = new T.Euler(), m4 = new T.Matrix4(), m4b = new T.Matrix4();
    const is90 = v => { const r = ((v % 90) + 90) % 90; return r < .01 || r > 89.99; };
    function colliders(obj){
      for (const c of obj._cols || []) ph.remove(c);
      obj._cols = [];
      if (obj.cls !== 'Part' && obj.cls !== 'Spawn' && obj.cls !== 'Mesh') return;
      const [x, y, z] = obj.pos, [rx, ry, rz] = obj.rot, h = [obj.size[0] / 2, obj.size[1] / 2, obj.size[2] / 2];
      let yaw = 0, ex, ey, ez;
      eu.set(rx * DEG, ry * DEG, rz * DEG, 'YXZ'); m4.makeRotationFromEuler(eu);
      if (is90(rx) && is90(rz)) { yaw = ry * DEG; m4b.makeRotationY(-yaw).multiply(m4); } else m4b.copy(m4);
      const e = m4b.elements;   // столбцы: e[0..2] — ось X детали и т. д.
      ex = Math.abs(e[0]) * h[0] + Math.abs(e[4]) * h[1] + Math.abs(e[8]) * h[2];
      ey = Math.abs(e[1]) * h[0] + Math.abs(e[5]) * h[1] + Math.abs(e[9]) * h[2];
      ez = Math.abs(e[2]) * h[0] + Math.abs(e[6]) * h[1] + Math.abs(e[10]) * h[2];
      const solid = obj.collide !== false, big = Math.max(obj.size[0], obj.size[1], obj.size[2]) > 3;
      const data = { part: obj.id, floor: FLOOR[obj.mat] || 'concrete', cam: solid && big && obj.alpha < .6 };
      // своя модель, «точно»: коробки по поверхности (model.js → M.colliders), растянутые и повёрнутые вместе с моделью
      const md = obj.cls === 'Mesh' && obj.fit !== 'box' ? E.models?.cached(obj.model) : null;
      if (md && E.models.colliders) {
        const k = [obj.size[0] / (md.size[0] || 1), obj.size[1] / (md.size[1] || 1), obj.size[2] / (md.size[2] || 1)], v = new T.Vector3();
        for (const [cx, cy, cz, bx, by, bz] of E.models.colliders(md)) {
          v.set(cx * k[0], cy * k[1] - h[1], cz * k[2]).applyMatrix4(m4);
          const hb = [bx * k[0], by * k[1], bz * k[2]];
          const d2 = { part: obj.id, floor: 'concrete', cam: solid && Math.max(hb[0], hb[1], hb[2]) > 1.5 && obj.alpha < .6 };
          obj._cols.push(ph.addBox({ x: x + v.x, y: y + v.y, z: z + v.z, yaw, solid, tag: 'part', data: d2,
            hx: Math.abs(e[0]) * hb[0] + Math.abs(e[4]) * hb[1] + Math.abs(e[8]) * hb[2], hy: Math.abs(e[1]) * hb[0] + Math.abs(e[5]) * hb[1] + Math.abs(e[9]) * hb[2], hz: Math.abs(e[2]) * hb[0] + Math.abs(e[6]) * hb[1] + Math.abs(e[10]) * hb[2] }));
        }
        return;
      }
      const plain = !rx && !rz;
      if (obj.shape === 'wedge' && plain) obj._cols.push(ph.addWedge({ x, y, z, hx: h[0], hy: h[1], hz: h[2], yaw, solid, tag: 'part', data }));
      else if ((obj.shape === 'cyl' || obj.shape === 'ball') && plain) obj._cols.push(ph.addCyl({ x, y, z, r: Math.max(h[0], h[2]), hy: h[1], solid, tag: 'part', data }));
      else obj._cols.push(ph.addBox({ x, y, z, hx: ex, hy: ey, hz: ez, yaw, solid, tag: 'part', data }));
    }

    // ── Построить/перестроить картинку и тела объекта ──
    function place(mesh, obj){
      mesh.position.set(obj.pos[0], obj.pos[1], obj.pos[2]);
      mesh.rotation.set((obj.rot?.[0] || 0) * DEG, (obj.rot?.[1] || 0) * DEG, (obj.rot?.[2] || 0) * DEG, 'YXZ');
    }
    function tag(o3, obj){ o3.traverse(c => { c.userData.oid = obj.id; }); }
    function unbuild(obj){
      if (obj._mesh) { R.scene.remove(obj._mesh); obj._mesh.traverse(c => { if (c.isMesh && c.userData.ownGeo) c.geometry.dispose(); if (c.isMesh && c.userData.ownMat) c.material.dispose(); }); obj._mesh = null; }
      if (obj._light) { R.scene.remove(obj._light); obj._light = null; }
      if (obj._em) { obj._em.dispose(); obj._em = null; }
      for (const c of obj._cols || []) ph.remove(c);
      obj._cols = [];
    }
    function build(obj){
      unbuild(obj);
      if (obj.cls === 'Part' || obj.cls === 'Spawn') {
        const mat = material(obj.mat, obj.color, obj.alpha || 0), tile = mat.userData?.tile || (TILE[obj.mat] || 2) * (E.UNIT || 1);
        const mesh = new T.Mesh(geometry(obj.shape, obj.size, tile), mat);
        mesh.userData.ownGeo = true;
        place(mesh, obj);
        if (R.r.shadowMap.enabled) { mesh.castShadow = obj.shadow !== false && (obj.alpha || 0) < .5 && obj.mat !== 'neon'; mesh.receiveShadow = obj.mat !== 'neon'; }
        if (obj.cls === 'Spawn') {   // знак на точке появления
          const d = new T.Mesh(new T.CircleGeometry(Math.min(obj.size[0], obj.size[2]) * .32, 32), spawnMat());
          d.rotation.x = -Math.PI / 2; d.position.y = obj.size[1] / 2 + .01; d.userData.ownGeo = true; mesh.add(d);
          if (!SC.edit) mesh.visible = true;
        }
        if ((obj.alpha || 0) >= .999 && !SC.edit) mesh.visible = false;
        tag(mesh, obj); R.scene.add(mesh); obj._mesh = mesh;
        colliders(obj);
      } else if (obj.cls === 'Mesh') {
        const holder = new T.Group(), md = E.models?.cached(obj.model);
        if (md) {
          const g = E.models.instance(R, md), a = obj.alpha || 0;
          g.scale.set(obj.size[0] / (md.size[0] || 1), obj.size[1] / (md.size[1] || 1), obj.size[2] / (md.size[2] || 1));
          g.position.y = -obj.size[1] / 2;   // у модели низ в нуле, а pos — центр (как у детали)
          if (a > 0) g.traverse(c => { if (!c.isMesh) return; c.material = c.material.clone(); c.material.transparent = true; c.material.opacity *= Math.max(SC.edit && a >= .999 ? .12 : 0, 1 - a); c.material.depthWrite = a < .5; c.userData.ownMat = true; });
          if (!R.r.shadowMap.enabled || obj.shadow === false || a >= .5) g.traverse(c => { if (c.isMesh) c.castShadow = false; });
          if (a >= .999 && !SC.edit) g.visible = false;
          holder.add(g);
        } else {   // модель ещё грузится или её нет в этом браузере — каркас коробки
          const box = new T.Mesh(new T.BoxGeometry(obj.size[0], obj.size[1], obj.size[2]), meshStub());
          box.userData.ownGeo = true; box.userData.stub = true; holder.add(box);
          if (obj.model && E.models) E.models.load(obj.model).then(m => { if (m && objects.get(obj.id) === obj && obj._mesh === holder) build(obj); });
        }
        place(holder, obj);
        tag(holder, obj); R.scene.add(holder); obj._mesh = holder;
        colliders(obj);
      } else if (obj.cls === 'Effect') {
        const host = () => { const p = obj.parent && objects.get(obj.parent); return p && p.pos && p.cls !== 'Model' ? p : null; };
        const at = [0, 0, 0];   // из детали — с её верхней грани
        if (SC.fx) obj._em = SC.fx.emitter({ kind: obj.kind, rate: obj.rate, size: obj.scale, color: obj.color || undefined, color2: obj.color2 || undefined, enabled: obj.enabled !== false,
          at: () => { const h = host(); if (!h) return obj.pos; at[0] = h.pos[0]; at[1] = h.pos[1] + (Array.isArray(h.size) ? h.size[1] / 2 : 0); at[2] = h.pos[2]; return at; } });
        if (SC.edit) {   // значок, за который можно взять
          const s = new T.Mesh(new T.OctahedronGeometry(.32), fxMark());
          s.userData.ownGeo = true; s.position.set(...(host() || obj).pos); tag(s, obj); R.scene.add(s); obj._mesh = s;
        }
      } else if (obj.cls === 'Light') {
        const L = new T.PointLight(obj.color, obj.power, obj.range, 1.6);
        L.position.set(...obj.pos); R.scene.add(L); obj._light = L;
        if (SC.edit) {   // лампочка, за которую можно взять
          const s = new T.Mesh(new T.SphereGeometry(.28, 14, 10), new T.MeshBasicMaterial({ color: obj.color, toneMapped: false }));
          s.userData.ownGeo = true; s.position.set(...obj.pos); tag(s, obj); R.scene.add(s); obj._mesh = s;
        }
      } else if (obj.cls === 'Prefab') {
        const holder = new T.Group(), cols = [];
        const rec = { addBox: b => { const c = ph.addBox({ ...b, y: (b.y || 0) + obj.pos[1], data: { part: obj.id, floor: 'wood' } }); cols.push(c); return c; },
          addCyl: b => { const c = ph.addCyl({ ...b, y: (b.y || 0) + obj.pos[1], data: { part: obj.id, floor: 'wood' } }); cols.push(c); return c; } };
        R.prefab(obj.kind, { x: obj.pos[0], z: obj.pos[2], yaw: (obj.rot?.[1] || 0) * DEG, k: obj.scale || 1, parent: holder, text: obj.text, c: obj.kind === 'sign' ? obj.color : undefined, seed: obj.id.length * 7,
          x1: obj.pos[0] - 3 * (obj.scale || 1), z1: obj.pos[2], x2: obj.pos[0] + 3 * (obj.scale || 1), z2: obj.pos[2] }, rec);
        if (obj.kind === 'fence') { holder.children[0].rotation.y = (obj.rot?.[1] || 0) * DEG - Math.PI / 2 + Math.PI / 2; }
        holder.position.y = obj.pos[1];
        if (R.r.shadowMap.enabled) R.shadowsOn(holder);
        holder.traverse(c => { if (c.isMesh) c.userData.dyn = true; });
        tag(holder, obj); R.scene.add(holder); obj._mesh = holder; obj._cols = cols;
      }
    }
    let fxM = null;
    const fxMark = () => fxM || (fxM = new T.MeshBasicMaterial({ color: '#ffd23f', wireframe: true, toneMapped: false }));
    let stubM = null;
    const meshStub = () => stubM || (stubM = new T.MeshBasicMaterial({ color: '#9aa3b5', wireframe: true, transparent: true, opacity: .55, toneMapped: false }));
    let spawnM = null;
    function spawnMat(){
      if (spawnM) return spawnM;
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d');
      g.strokeStyle = '#fff'; g.lineWidth = 8; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke();
      g.fillStyle = '#fff'; g.font = '64px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('★', 64, 68);
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding;
      spawnM = new T.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false });
      return spawnM;
    }

    // ═══ Объекты ═══
    SC.get = id => objects.get(id) || null;
    SC.all = () => order.slice();
    SC.children = obj => (obj ? obj.children : order.filter(o => !o.parent).map(o => o.id)).map(SC.get).filter(Boolean);
    SC.add = (cls, props = {}, parent = null, id = null) => {
      if (!DEF[cls]) throw new Error('класс: ' + cls);
      const obj = { id: id || 'o' + (++SC.seq).toString(36) + Math.random().toString(36).slice(2, 5), cls, parent: null, children: [], ...copy(DEF[cls]) };
      for (const k of SAVE) if (props[k] !== undefined) obj[k] = copy(props[k]);
      if (props.name) obj.name = String(props.name).slice(0, 40);
      else if (cls === 'Prefab') obj.name = (PREFABS.find(p => p[0] === obj.kind) || [])[1] || obj.name;
      objects.set(obj.id, obj); order.push(obj);
      if (parent) { const p = objects.get(typeof parent === 'string' ? parent : parent.id); if (p) { obj.parent = p.id; p.children.push(obj.id); } }
      build(obj);
      emit('add', obj);
      return obj;
    };
    SC.remove = obj => {
      if (!obj || !objects.has(obj.id)) return;
      for (const cid of obj.children.slice()) SC.remove(objects.get(cid));
      unbuild(obj);
      objects.delete(obj.id); order.splice(order.indexOf(obj), 1);
      if (obj.parent) { const p = objects.get(obj.parent); if (p) p.children = p.children.filter(c => c !== obj.id); }
      emit('remove', obj);
    };
    // Переложить в другого родителя (null — в корень)
    SC.reparent = (obj, parent) => {
      if (obj.parent) { const p = objects.get(obj.parent); if (p) p.children = p.children.filter(c => c !== obj.id); }
      obj.parent = null;
      if (parent && parent !== obj && !SC.isAncestor(obj, parent)) { obj.parent = parent.id; parent.children.push(obj.id); }
      emit('change', { obj, key: 'parent' });
    };
    SC.isAncestor = (a, b) => { for (let p = b; p; p = objects.get(p.parent)) if (p === a) return true; return false; };
    // Свойство: картинка/тела обновляются сами. Модель: pos и rot двигают всех детей
    SC.set = (obj, key, val, silent) => {
      if (!obj) return;
      if (obj.cls === 'Model' && (key === 'pos' || key === 'rot')) { SC.transformModel(obj, key, val); return; }
      obj[key] = copy(val);
      if (['shape', 'size', 'mat', 'color', 'alpha', 'kind', 'scale', 'text', 'range', 'power', 'shadow', 'model', 'rate', 'color2'].includes(key) || (key === 'enabled' && obj.cls === 'Effect')) build(obj);
      else if (key === 'pos' || key === 'rot') {
        if (obj._mesh && obj.cls !== 'Prefab') place(obj._mesh, obj);
        if (obj._light) obj._light.position.set(...obj.pos);
        if (obj.cls === 'Prefab') build(obj); else colliders(obj);
      } else if (key === 'collide' || key === 'fit') colliders(obj);
      if (!silent) emit('change', { obj, key });
    };
    // Модель: центр (pivot) — середина её коробки; сдвиг и поворот вокруг Y — для всех потомков
    SC.descendants = obj => { const out = []; const walk = o => { for (const c of o.children) { const ch = objects.get(c); if (ch) { out.push(ch); walk(ch); } } }; walk(obj); return out; };
    SC.pivot = obj => {
      if (obj.cls !== 'Model') return obj.pos ? obj.pos.slice() : [0, 0, 0];
      const b = SC.box(obj); if (b.isEmpty()) return [0, 0, 0];
      const c = b.getCenter(new T.Vector3()); return [c.x, b.min.y, c.z];
    };
    SC.transformModel = (model, key, val) => {
      const piv = SC.pivot(model);
      if (key === 'pos') {
        const d = [val[0] - piv[0], val[1] - piv[1], val[2] - piv[2]];
        for (const o of SC.descendants(model)) if (o.pos) SC.set(o, 'pos', [o.pos[0] + d[0], o.pos[1] + d[1], o.pos[2] + d[2]], true);
      } else {   // поворот вокруг вертикали через центр
        const dy = (val[1] || 0) - (model._yaw || 0); model._yaw = val[1] || 0;
        const a = dy * DEG, ca = Math.cos(a), sa = Math.sin(a);
        for (const o of SC.descendants(model)) if (o.pos) {
          const px = o.pos[0] - piv[0], pz = o.pos[2] - piv[2];
          SC.set(o, 'pos', [piv[0] + px * ca + pz * sa, o.pos[1], piv[2] - px * sa + pz * ca], true);
          if (o.rot) SC.set(o, 'rot', [o.rot[0], ((o.rot[1] + dy) % 360 + 360) % 360, o.rot[2]], true);
        }
      }
      emit('change', { obj: model, key });
    };
    SC.box = obj => {
      const b = new T.Box3();
      const add = o => { if (o._mesh) b.expandByObject(o._mesh); else if (o.pos) b.expandByPoint(new T.Vector3(...o.pos)); };
      add(obj); for (const d of SC.descendants(obj)) add(d);
      return b;
    };
    SC.clone = (obj, parent = objects.get(obj.parent) || null) => {
      const data = SC.serialize([obj, ...SC.descendants(obj)]), map = new Map();
      let first = null;
      for (const d of data) {
        const np = d.parent && map.get(d.parent) ? map.get(d.parent) : d.id === obj.id ? parent : null;
        const n = SC.add(d.cls, d, np);
        map.set(d.id, n);
        if (!first) first = n;
      }
      return first;
    };
    SC.serialize = list => list.map(o => { const d = { id: o.id, cls: o.cls, parent: o.parent }; for (const k of SAVE) if (o[k] !== undefined && (k !== 'attrs' || Object.keys(o[k] || {}).length)) d[k] = Array.isArray(o[k]) ? o[k].map(v => typeof v === 'number' ? r3(v) : v) : copy(o[k]); return d; });
    SC.clear = () => { for (const o of order.slice()) if (!o.parent) SC.remove(o); };
    SC.toJSON = () => ({ v: 1, objects: SC.serialize(order), lighting: { ...R.lighting } });   // ландшафт — отдельно (TR.toJSON, сжатие асинхронное)
    SC.fromJSON = data => {
      SC.clear();
      const list = Array.isArray(data?.objects) ? data.objects : [];
      for (const d of list) if (d && DEF[d.cls]) { try { SC.add(d.cls, d, d.parent && objects.get(d.parent) ? d.parent : null, typeof d.id === 'string' ? d.id.slice(0, 24) : null); } catch (e) { console.warn('объект пропущен:', e.message); } }
      if (data?.lighting && R.setLighting) R.setLighting(data.lighting);
      return SC;
    };

    // ── Выбор мышью: луч по мешам объектов ──
    SC.pick = ray => {
      const meshes = [];
      for (const o of order) if (o._mesh && o._mesh.visible !== false) meshes.push(o._mesh);
      const hits = ray.intersectObjects(meshes, true);
      for (const h of hits) { let n = h.object; while (n && !n.userData.oid) n = n.parent; const obj = n && objects.get(n.userData.oid); if (obj) return { obj, point: h.point, normal: h.face?.normal }; }
      return null;
    };
    // ── Касания (Touched): тела деталей рядом с капсулой персонажа ──
    SC.touching = ch => {
      const out = new Set(), r = ch.r + .12;
      for (const c of ph.query(ch.x - r, ch.z - r, ch.x + r, ch.z + r, [])) {
        const id = c.data?.part; if (!id || out.has(id)) continue;
        const top = c.type === 'wedge' ? E.Phys.topAt(c, ch.x, ch.z) : c.top;
        if (top < ch.y - .12 || c.bottom > ch.y + ch.h + .05) continue;
        if (E.Phys.circleHit(c, ch.x, ch.z, r) || E.Phys.inside(c, ch.x, ch.z)) out.add(id);
      }
      return out;
    };
    // Незакреплённые детали падают (без вращения): шаг игры
    SC.step = dt => {
      for (const o of order) {
        if (o.anchored !== false || (o.cls !== 'Part') || o._held) continue;
        o._vy = (o._vy || 0) - 40 * dt;
        const hy = (o._cols[0]?.hy) || o.size[1] / 2, x = o.pos[0], z = o.pos[2];
        const skip = new Set(o._cols);
        let sup = ph.groundAt ? ph.groundAt(x, z) : 0;
        for (const c of ph.query(x - .3, z - .3, x + .3, z + .3, [])) { if (skip.has(c) || !c.solid || c.trigger) continue; const t = c.type === 'wedge' ? E.Phys.topAt(c, x, z) : c.top; if (t <= o.pos[1] - hy + .05 && t > sup && (E.Phys.inside(c, x, z) || E.Phys.circleHit(c, x, z, .2))) sup = t; }
        let ny = o.pos[1] + o._vy * dt;
        if (ny - hy <= sup) { ny = sup + hy; o._vy = 0; }
        if (Math.abs(ny - o.pos[1]) > 1e-4) SC.set(o, 'pos', [x, ny, z], true);
      }
    };
    SC.dispose = () => { for (const o of order.slice()) unbuild(o); objects.clear(); order.length = 0; ev.clear(); };
    SC.material = material;
    return SC;
  };
  E.scene.MATS = MATS; E.scene.PREFABS = PREFABS; E.scene.SHAPES = SHAPES; E.scene.DEF = DEF;
})();
