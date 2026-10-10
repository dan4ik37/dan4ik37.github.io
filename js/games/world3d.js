// ═══════════════════════════════════════
//  3D «МИРА ДЕНЧИКА» И ГАРДЕРОБА — Three.js: объёмная карта и милые человечки-чиби, собранные по частям (как в Роблоксе)
// ═══════════════════════════════════════
// Части человечка — слоты D37Char.PARTS с body: 1 (avatar.js): фигура, кожа, рост, телосложение, голова, цвет глаз, брови,
// ресницы, щёчки, причёска и цвет волос, верх/низ/обувь и их цвета, очки, шея, спина. Плюс части гардероба: цвет одежды
// (look.color), глаза, рот, шапка, предмет в руке, питомец, след. Не выбранное — по «отпечатку» ключа игрока (resolve), чтобы
// толпа была разной. kit(T) — материалы, геометрии, сборка персонажа (build) и его анимация (animate); create() — мир (карта
// 2400×1600 px, 1 единица 3D = 20 px); preview() — витрина гардероба (крутится пальцем) и картинки вариантов (thumb).
// Статичные детали одной кости с одним материалом склеиваются в одну геометрию (bake) — меньше вызовов отрисовки.
// Нет WebGL или не загрузился Three.js → мир и гардероб остаются в 2D.
(() => {
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js';
  const U = 20;
  const PI = Math.PI, TAU = PI * 2;
  let loading = null;

  function supported(){
    try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
  }
  function load(){
    if (window.THREE) return Promise.resolve(true);
    if (loading) return loading;
    loading = new Promise(res => {
      const s = document.createElement('script');
      s.src = THREE_URL; s.async = true;
      s.onload = () => res(!!window.THREE);
      s.onerror = () => { loading = null; res(false); };
      document.head.appendChild(s);
      setTimeout(() => res(!!window.THREE), 15000);
    });
    return loading;
  }

  // ── Внешность ──
  const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const D = () => window.D37Char;
  const partV = (slot, id, def) => { const p = D()?.part(slot, id); return p && p.v ? p.v : def; };
  function shade(hex, amt){
    const n = parseInt(String(hex).slice(1, 7), 16) || 0, t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v + (t - v) * p).toString(16).padStart(2, '0')).join('');
  }
  // Полный набор частей: выбранное игроком + недостающее по отпечатку ключа
  function resolve(look, key){
    const L = D() ? D().norm(look) : { ...(look || {}) };
    const h = hash(key || 'x'), pick = (a, sh) => a[(h >>> sh) % a.length];
    const r = (s, def) => (L[s] !== undefined && L[s] !== null ? String(L[s]) : def);
    const body = r('body', h & 1 ? 'girl' : 'boy'), girl = body === 'girl';
    return {
      color: L.color || 'blue', eyes: L.eyes || 'normal', mouth: L.mouth || 'smile', hat: L.hat || 'none', item: L.item || 'none', pet: L.pet || 'none', trail: L.trail || 'none',
      body,
      tone: r('tone', pick(['t2', 't3', 't4', 't5', 't6', 't3', 't2', 't7'], 3)),
      hgt: r('hgt', '2'), wid: r('wid', '2'), head: r('head', '2'),
      eyec: r('eyec', pick(['brown', 'dark', 'blue', 'green', 'brown', 'gray'], 6)),
      brows: r('brows', 'soft'), lash: r('lash', girl ? 'yes' : 'no'), cheek: r('cheek', 'blush'),
      hair: r('hair', girl ? pick(['ponytail', 'long', 'buns', 'bob'], 9) : pick(['short', 'side', 'spiky', 'curly'], 9)),
      hairc: r('hairc', pick(['black', 'dark', 'brown', 'caramel', 'blond', 'ginger', 'dark', 'brown'], 12)),
      top: r('top', 'hoodie'), bottom: r('bottom', girl && (h >>> 15) & 1 ? 'skirt' : 'pants'),
      botc: r('botc', pick(['graphite', 'denim', 'black', 'khaki', 'denim'], 16)),
      shoes: r('shoes', 'sneakers'), shoec: r('shoec', pick(['white', 'white', 'black', 'red', 'blue'], 19)),
      glasses: r('glasses', 'none'), neck: r('neck', 'none'), back: r('back', 'none'),
      trim: r('trim', 'auto'), hatc: r('hatc', 'auto'), glassc: r('glassc', 'auto'), neckc: r('neckc', 'auto'), backc: r('backc', 'auto'),
    };
  }
  // Цвета частей: готовый цвет или свой из палитры; «как задумано» (auto) — свой цвет у каждой вещи
  const PALS = ['color', 'tone', 'eyec', 'hairc', 'trim', 'botc', 'shoec', 'hatc', 'glassc', 'neckc', 'backc'];
  const SPECIAL = { color: ['galaxy', 'gold', 'rainbow'], tone: ['goldskin'], eyec: ['glow', 'fire'], hairc: ['neon', 'rainbow'] };
  const DEFC = { color: '#4f8df7', tone: '#f7cba5', eyec: '#7a4a25', hairc: '#3e2819', trim: '#f4f5f7', botc: '#3b4252', shoec: '#f4f4f6', hatc: '#e8384f', glassc: '#1f1f27', neckc: '#e11d48', backc: '#f59e0b' };
  function colorOf(R, slot){ const v = partV(slot, R[slot], DEFC[slot] || '#888888'); return v && v[0] === '#' ? v : DEFC[slot] || '#888888'; }
  // Силуэт туловища (радиус, высота 0…1): у девочки талия и бёдра
  const PROF = {
    boy: [[.001, 0], [.7, .015], [.92, .07], [1, .22], [.99, .45], [.96, .65], [.88, .83], [.66, .95], [.32, 1], [.001, 1]],
    girl: [[.001, 0], [.66, .015], [.9, .07], [.99, .2], [.9, .42], [.86, .56], [.9, .72], [.84, .85], [.62, .95], [.3, 1], [.001, 1]],
  };
  const rAt = (prof, f) => { for (let i = 1; i < prof.length; i++) if (prof[i][1] >= f) { const [r0, y0] = prof[i - 1], [r1, y1] = prof[i]; return r0 + (r1 - r0) * ((f - y0) / Math.max(1e-6, y1 - y0)); } return 0; };

  // ═══ Набор: материалы, геометрии, сборка и анимация персонажа ═══
  function kit(T){
    if (T.ColorManagement && 'legacyMode' in T.ColorManagement) T.ColorManagement.legacyMode = false;
    const grad = new T.DataTexture(new Uint8Array([140, 140, 140, 255, 200, 200, 200, 255, 255, 255, 255, 255]), 3, 1, T.RGBAFormat);
    grad.minFilter = grad.magFilter = T.NearestFilter; grad.needsUpdate = true;
    const mats = new Map(), geos = new Map(), texs = new Map(), emo = new Map();
    const cache = (m, k, f) => { let v = m.get(k); if (!v) { v = f(); m.set(k, v); } return v; };
    const toon = (c, ds) => cache(mats, 't' + c + (ds ? 'd' : ''), () => new T.MeshToonMaterial({ color: c, gradientMap: grad, side: ds ? T.DoubleSide : T.FrontSide }));
    const basic = (c, op) => cache(mats, 'b' + c + (op || ''), () => new T.MeshBasicMaterial(op ? { color: c, transparent: true, opacity: op, depthWrite: false } : { color: c }));
    const geo = (k, f) => cache(geos, k, f);
    const f3 = v => (+v).toFixed(3);
    const sph = (r, w = 16, h = 12) => geo(`s${f3(r)}_${w}_${h}`, () => new T.SphereGeometry(r, w, h));
    const cap = (r, l, rs = 12) => geo(`c${f3(r)}_${f3(l)}_${rs}`, () => new T.CapsuleGeometry(r, Math.max(.001, l), 5, rs));
    const cone = (r, h, s = 12) => geo(`k${f3(r)}_${f3(h)}_${s}`, () => new T.ConeGeometry(r, h, s));
    const cyl = (r1, r2, h, s = 16, open) => geo(`y${f3(r1)}_${f3(r2)}_${f3(h)}_${s}_${open ? 1 : 0}`, () => new T.CylinderGeometry(r1, r2, h, s, 1, !!open));
    const tor = (r, t, rs, ts, arc = TAU) => geo(`o${f3(r)}_${f3(t)}_${rs}_${ts}_${f3(arc)}`, () => new T.TorusGeometry(r, t, rs, ts, arc));
    const box = (x, y, z) => geo(`x${f3(x)}_${f3(y)}_${f3(z)}`, () => new T.BoxGeometry(x, y, z));
    function heartShape(){ const s = new T.Shape(); s.moveTo(0, -.42); s.bezierCurveTo(-.12, -.3, -.5, -.08, -.5, .16); s.bezierCurveTo(-.5, .42, -.16, .5, 0, .28); s.bezierCurveTo(.16, .5, .5, .42, .5, .16); s.bezierCurveTo(.5, -.08, .12, -.3, 0, -.42); return s; }
    function starShape(){ const s = new T.Shape(); for (let i = 0; i <= 10; i++) { const a = PI / 2 + i * PI / 5, r = i % 2 ? .21 : .5; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r); } return s; }
    const flat = (name, depth = .14) => geo('sh' + name + depth, () => { const g = new T.ExtrudeGeometry(name === 'heart' ? heartShape() : starShape(), { depth, bevelEnabled: true, bevelThickness: depth * .35, bevelSize: .04, bevelSegments: 2, curveSegments: 8 }); g.center(); return g; });
    function canvasTex(k, w, h, draw){
      return cache(texs, k, () => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t; });
    }
    // Ткань одежды: обычный цвет или особые (радуга, космос, золото)
    function cloth(id, hex, ds){
      const side = ds ? T.DoubleSide : T.FrontSide;
      if (id === 'rainbow') return cache(mats, 'top:rainbow' + (ds ? 'd' : ''), () => new T.MeshToonMaterial({ gradientMap: grad, side, map: canvasTex('rainbow', 4, 64, (g, w, h) => { for (let i = 0; i < h; i++) { g.fillStyle = `hsl(${Math.round(i / h * 330)},90%,62%)`; g.fillRect(0, i, w, 1); } }) }));
      if (id === 'galaxy') return cache(mats, 'top:galaxy' + (ds ? 'd' : ''), () => new T.MeshToonMaterial({ gradientMap: grad, side, emissive: new T.Color('#1d1450'), map: canvasTex('galaxy', 64, 64, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#2b1f7a'); gr.addColorStop(.5, '#4a2a9c'); gr.addColorStop(1, '#1b1450'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
        let s = 7; for (let i = 0; i < 46; i++) { s = (s * 16807) % 2147483647; const x = s % w; s = (s * 16807) % 2147483647; const y = s % h; g.fillStyle = i % 5 ? 'rgba(255,255,255,.85)' : '#ffd6ff'; g.fillRect(x, y, i % 7 ? 1 : 2, i % 7 ? 1 : 2); }
      }) }));
      if (id === 'gold') return cache(mats, 'top:gold' + (ds ? 'd' : ''), () => new T.MeshPhongMaterial({ color: '#e6ad1f', specular: '#fff2c0', shininess: 70, emissive: '#3a2600', side }));
      return toon(hex, ds);
    }
    const emojiTex = e => cache(emo, e, () => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'); g.font = '104px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#000'; g.fillText(e, 64, 70);
      const tx = new T.CanvasTexture(c); tx.encoding = T.sRGBEncoding; return tx;
    });
    function emojiSprite(e, size){
      const s = new T.Sprite(new T.SpriteMaterial({ map: emojiTex(e), transparent: true, depthWrite: false }));
      s.scale.set(size, size, size);
      return s;
    }
    function M(parent, g, m, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0){
      const o = new T.Mesh(g, m);
      o.position.set(x, y, z);
      if (sx !== 1 || sy !== 1 || sz !== 1) o.scale.set(sx, sy, sz);
      if (rx || ry || rz) o.rotation.set(rx, ry, rz);
      parent.add(o);
      return o;
    }
    const G = (parent, x = 0, y = 0, z = 0) => { const g = new T.Group(); g.position.set(x, y, z); parent.add(g); return g; };
    // Склеить статичные детали группы с одним материалом в одну геометрию (в каждой подгруппе отдельно — кости двигаются)
    function bake(group){
      const by = new Map();
      for (const o of group.children) if (o.isMesh && !o.userData.keep) { if (!by.has(o.material)) by.set(o.material, []); by.get(o.material).push(o); }
      for (const [mat, list] of by) {
        if (list.length < 2) continue;
        let n = 0;
        const parts = list.map(o => { o.updateMatrix(); const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.applyMatrix4(o.matrix); n += g.attributes.position.count; return g; });
        const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
        let k = 0;
        for (const g of parts) {
          const c = g.attributes.position.count;
          pos.set(g.attributes.position.array, k * 3);
          if (g.attributes.normal) nor.set(g.attributes.normal.array, k * 3);
          if (g.attributes.uv) uv.set(g.attributes.uv.array, k * 2);
          k += c; g.dispose();
        }
        const mg = new T.BufferGeometry();
        mg.setAttribute('position', new T.BufferAttribute(pos, 3));
        mg.setAttribute('normal', new T.BufferAttribute(nor, 3));
        mg.setAttribute('uv', new T.BufferAttribute(uv, 2));
        mg.computeBoundingSphere();
        const m = new T.Mesh(mg, mat); m.userData.own = true;
        list.forEach(o => group.remove(o));
        group.add(m);
      }
      for (const o of group.children) if (o.isGroup) bake(o);
    }

    const gold = ds => cache(mats, 'gold' + (ds ? 'd' : ''), () => new T.MeshPhongMaterial({ color: '#f2b91e', specular: '#fff2c0', shininess: 80, emissive: '#3a2600', side: ds ? T.DoubleSide : T.FrontSide }));
    // ── Сборка человечка ──
    function build(look, key){
      const R = resolve(look, key), girl = R.body === 'girl';
      const own = [], idf = c => c;
      // свой материал цвета из палитры: slot — откуда цвет, fn — оттенок (темнее/светлее), ds — двусторонний
      const mk = (slot, fn, ds) => {
        const f = fn || idf, m = new T.MeshToonMaterial({ color: f(colorOf(R, slot)), gradientMap: grad, side: ds ? T.DoubleSide : T.FrontSide });
        m.userData = { own: true, slot, fn: f }; own.push(m); return m;
      };
      const acc = (slot, def, fn, ds) => R[slot] === 'auto' ? toon((fn || idf)(def), ds) : mk(slot, fn, ds);
      const topC = colorOf(R, 'color'), botC = colorOf(R, 'botc'), shoeC = colorOf(R, 'shoec');
      const special = SPECIAL.color.includes(R.color);
      const skinM = R.tone === 'goldskin' ? gold() : mk('tone');
      const rainbow = [];
      const hairMat = ds => {
        if (R.hairc === 'neon') return cache(mats, 'hair:neon' + (ds ? 'd' : ''), () => new T.MeshToonMaterial({ color: '#ff4fd8', emissive: new T.Color('#b0208f'), gradientMap: grad, side: ds ? T.DoubleSide : T.FrontSide }));
        if (R.hairc === 'rainbow') { const m = new T.MeshToonMaterial({ color: '#ff4d6d', gradientMap: grad, side: ds ? T.DoubleSide : T.FrontSide }); m.userData = { own: true }; rainbow.push(m); return m; }
        return mk('hairc', null, ds);
      };
      const hairM = hairMat(false), hairDS = hairMat(true), browM = mk('hairc', c => shade(c, -.3));
      const glowEyes = R.eyec === 'glow' || R.eyec === 'fire';
      const irisM = glowEyes ? basic(colorOf(R, 'eyec')) : mk('eyec');
      const topM = special ? cloth(R.color, topC) : mk('color'), topDS = special ? cloth(R.color, topC, 1) : mk('color', null, true), topD = mk('color', c => shade(c, -.25));
      const light = c => { const n = parseInt(c.slice(1), 16); return ((n >> 16) * .3 + ((n >> 8) & 255) * .59 + (n & 255) * .11) > 215; };
      const trimM = def => acc('trim', def);
      const botM = mk('botc'), botDS = mk('botc', null, true), botD = mk('botc', c => shade(c, -.2)), botL = mk('botc', c => shade(c, .3));
      const shoeM = mk('shoec');
      const whiteM = toon('#f4f5f7'), blackM = toon('#1f1f27');
      const eyeDark = toon('#2a1c17'), whiteB = basic('#ffffff');
      const anims = [];
      if (rainbow.length) anims.push(t => { for (const m of rainbow) m.color.setHSL((t * .12) % 1, .75, .6); });
      const kh = (+R.hgt - 2) || 0, kw = (+R.wid - 2) || 0, kd = (+R.head - 2) || 0;
      const ls = 1 + .13 * kh, ts = 1 + .07 * kh, tw = 1 + .1 * kw, lw = 1 + .07 * kw, hs = 1 + .085 * kd;
      const hipY = .52 * ls, rT = .33 * tw * (girl ? .94 : 1), Th = .86 * ts, yB = -.12, yT = yB + Th;
      const prof = PROF[girl ? 'girl' : 'boy'], yAt = f => yB + f * Th, zAt = (f, d = 0) => rAt(prof, f) * rT * .84 + d;
      const dress = R.top === 'dress', skirt = !dress && R.bottom === 'skirt', bare = dress || skirt, shorts = !dress && R.bottom === 'shorts';
      const root = new T.Group(), body = G(root);
      const shadow = M(root, geo('shadow', () => new T.CircleGeometry(.55, 24)), basic('#000000', .22), 0, .02, 0, tw, 1, tw, -PI / 2);
      shadow.userData.keep = true;

      // ноги и обувь
      const lr = .125 * lw * (girl ? .94 : 1), ankle = -hipY + .13;
      const shoe = (leg, s) => {
        const g = G(leg, 0, -hipY + .075, .035), sw = lw;
        if (R.shoes === 'boots') {
          M(g, cyl(.125 * sw, .135 * sw, .2, 14), shoeM, 0, .1, -.03);
          M(g, sph(.15, 16, 10), shoeM, 0, 0, 0, .9 * sw, .62, 1.22);
          M(g, sph(.15, 16, 10), toon('#3a2a20'), 0, -.045, 0, .95 * sw, .3, 1.3);
        } else if (R.shoes === 'bunny') {
          M(g, sph(.17, 16, 12), shoeM, 0, .01, .01, sw, .72, 1.22);
          for (const e of [-1, 1]) M(g, cap(.035, .1, 8), shoeM, e * .055, .14, .1, 1, 1, 1, -.5, 0, e * .25);
          for (const e of [-1, 1]) M(g, sph(.018, 8, 6), blackM, e * .055, .07, .2);
          M(g, sph(.02, 8, 6), toon('#ff8fb0'), 0, .045, .215);
        } else {
          const sole = R.shoes === 'kedy' || !light(shoeC) ? whiteM : toon('#dfe3ea');
          M(g, sph(.15, 16, 10), shoeM, 0, .01, 0, .86 * sw, .58, 1.2);
          M(g, sph(.15, 16, 10), sole, 0, -.04, .005, .92 * sw, .28, 1.27);
          if (R.shoes === 'kedy') M(g, sph(.1, 12, 8), whiteM, 0, -.005, .1, .85 * sw, .5, .7);
          else M(g, sph(.08, 10, 8), topM, s * .115 * sw, .005, -.01, .22, .45, .9);
        }
      };
      const legs = [-1, 1].map(s => {
        const g = G(body, s * .155 * tw, hipY, 0), top = .04, len = top - ankle;
        if (bare) M(g, cap(lr * .86, len - lr * 1.72), skinM, 0, (top + ankle) / 2, 0);
        else if (shorts) {
          M(g, cap(lr * 1.08, .2), botM, 0, -.08, 0);
          M(g, cap(lr * .9, Math.max(.01, len - .3)), skinM, 0, (-.2 + ankle) / 2 - .02, 0);
        } else {
          M(g, cap(lr, len - lr * 2), botM, 0, (top + ankle) / 2, 0);
          if (R.bottom === 'jeans') M(g, tor(lr * 1.02, .028, 6, 18), botL, 0, ankle + .05, 0, 1, 1, 1, PI / 2);
          if (R.bottom === 'cargo') M(g, box(.07, .14, .13), botD, s * lr * .95, -hipY * .42, 0);
        }
        shoe(g, s);
        return g;
      });
      // юбка-«колокол» (юбка — цвета низа, платье — цвета верха)
      const flare = (m, y0, y1, r0, r1) => {
        const pts = [[r0, y0], [r0 * 1.04, y0 - (y0 - y1) * .3], [r1 * .97, y1 + .03], [r1, y1]].map(([r, y]) => new T.Vector2(r, y));
        M(body, geo(`flare${f3(y0)}_${f3(y1)}_${f3(r0)}_${f3(r1)}`, () => new T.LatheGeometry(pts.slice().reverse(), 22)), m, 0, 0, 0, 1, 1, .9);
      };
      if (!bare) M(body, sph(rT * .97, 18, 12), botM, 0, hipY - .03, 0, 1, .52, .84);
      if (skirt) { flare(botDS, hipY + .05, hipY - .3, rT * 1.0, rT * 1.45); M(body, tor(rT * .99, .03, 6, 22), botD, 0, hipY + .05, 0, 1, .9, 1, PI / 2); }
      if (dress) flare(topDS, hipY - .02, hipY - .36, rT * .95, rT * 1.5);

      // туловище (кость: таз → наклон корпуса)
      const torso = G(body, 0, hipY, 0);
      const shell = ['jacket', 'suit'].includes(R.top);
      const torsoGeo = (k, open) => geo(`torso${girl ? 1 : 0}_${f3(rT)}_${f3(Th)}_${k}_${open}`, () => {
        const pts = (open ? prof.slice(1, -2) : prof).map(([r, y]) => new T.Vector2(Math.max(.001, r * rT * k), yB + y * Th));
        return open ? new T.LatheGeometry(pts, 22, open, TAU - open * 2) : new T.LatheGeometry(pts, 22);
      });
      M(torso, torsoGeo(1, 0), shell ? trimM('#f4f5f7') : topM, 0, 0, 0, 1, 1, .84);
      if (shell) M(torso, torsoGeo(1.07, R.top === 'suit' ? .32 : .42), topDS, 0, 0, 0, 1, 1, .84);
      if (R.top === 'hoodie') {
        M(torso, tor(.21 * tw, .09, 8, 22, PI * 1.3), topM, 0, yT - .07, -.05, 1, 1, 1, -PI / 2 + .25, 0, PI * 1.85);
        M(torso, sph(.17, 16, 10), topD, 0, yAt(.27), zAt(.27, -.045), 1.15 * tw, .5, .3);
        const sm = trimM('#f4f5f7');
        for (const s of [-1, 1]) { M(torso, cyl(.015, .015, .2, 6), sm, s * .075, yAt(.78) - .08, zAt(.78, .005)); M(torso, sph(.024, 8, 6), sm, s * .075, yAt(.78) - .18, zAt(.7, .01)); }
      } else if (R.top === 'tshirt') {
        M(torso, tor(.16 * tw, .026, 6, 22), R.trim === 'auto' ? topD : trimM(), 0, yT - .045, 0, 1, .84, 1, PI / 2);
      } else if (R.top === 'sweater') {
        const stripe = R.trim !== 'auto' ? trimM() : light(topC) ? topD : whiteM;
        for (const f of [.42, .55]) M(torso, tor(rAt(prof, f) * rT * 1.005, .026, 6, 26), stripe, 0, yAt(f), 0, 1, .84, 1, PI / 2);
        M(torso, cyl(.17 * tw, .19 * tw, .1, 18), topD, 0, yT - .03, 0, 1, 1, .9);
      } else if (R.top === 'jersey') {
        for (const s of [-1, 1]) M(torso, box(.03, .17, .02), trimM('#f4f5f7'), s * .045, yT - .1, zAt(.9, -.005), 1, 1, 1, -.35, 0, s * .45);
        const num = canvasTex('jersey37', 128, 128, (g, w, h) => {
          g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
          g.font = '900 22px Montserrat, Arial, sans-serif'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.45)'; g.strokeText('DAN4IK', 64, 26); g.fillStyle = '#fff'; g.fillText('DAN4IK', 64, 26);
          g.font = '900 72px Oswald, Montserrat, Arial, sans-serif'; g.lineWidth = 8; g.strokeText('37', 64, 84); g.fillText('37', 64, 84);
        });
        const dm = cache(mats, 'jersey37', () => new T.MeshBasicMaterial({ map: num, transparent: true, depthWrite: false }));
        const d = M(torso, geo(`jback${f3(rT)}`, () => new T.CylinderGeometry(rT * 1.01, rT * 1.01, .44, 16, 1, true, PI - .75, 1.5)), dm, 0, yAt(.55), 0, 1, 1, .84);
        d.userData.keep = true;
      } else if (R.top === 'suit') {
        const tm = acc('neckc', '#d6213f');
        M(torso, box(.09, .05, .03), tm, 0, yT - .1, zAt(.9, .0));
        M(torso, geo('tieblade', () => new T.CylinderGeometry(.04, .065, .34, 4)), tm, 0, yAt(.6), zAt(.6, .005), 1, 1, .35, -.12, PI / 4, 0);
        for (const f of [.42, .28]) M(torso, sph(.018, 8, 6), topD, .07, yAt(f), zAt(f, .02));
      } else if (R.top === 'jacket') {
        M(torso, tor(.19 * tw, .045, 6, 22, PI * 1.4), topD, 0, yT - .04, -.02, 1, 1, 1, -PI / 2 + .3, 0, PI * 1.8);
        M(torso, box(.025, Th * .55, .02), toon('#c9ccd3'), .1, yAt(.5), zAt(.5, -.01));
      } else if (dress) {
        M(torso, tor(rAt(prof, .1) * rT * 1.01, .032, 6, 24), trimM('#f4f5f7'), 0, yAt(.1), 0, 1, .84, 1, PI / 2);
        M(torso, tor(.15 * tw, .024, 6, 22), trimM('#f4f5f7'), 0, yT - .045, 0, 1, .84, 1, PI / 2);
      }
      // руки
      const shortSleeve = ['tshirt', 'jersey', 'dress'].includes(R.top);
      const arms = [-1, 1].map(s => {
        const g = G(torso, s * (rT * .93 + .035), yT - .2, 0), ar = .098 * lw, La = .42 * ts;
        g.rotation.z = s * .16;
        if (shortSleeve) {
          M(g, dress ? sph(ar * 1.45, 14, 10) : cap(ar * 1.1, .07), topM, 0, -.06, 0);
          M(g, cap(ar * .86, La - .26), skinM, 0, -La / 2 - .02, 0);
          if (R.top === 'jersey') M(g, tor(ar * 1.08, .02, 6, 14), trimM('#f4f5f7'), 0, -.15, 0, 1, 1, 1, PI / 2);
        } else {
          M(g, cap(ar, La - ar * 2 - .03), topM, 0, -La / 2 + .03, 0);
          if (R.top === 'sweater' || R.top === 'hoodie') M(g, tor(ar * .95, .028, 6, 14), topD, 0, -La + .14, 0, 1, 1, 1, PI / 2);
          if (R.top === 'suit') M(g, tor(ar * .9, .022, 6, 14), trimM('#f4f5f7'), 0, -La + .11, 0, 1, 1, 1, PI / 2);
        }
        g.userData.hand = M(g, sph(.105 * lw, 14, 10), skinM, 0, -La + .03, 0);
        g.userData.La = La;
        return g;
      });

      // на шее
      const yN = yT - .07;
      if (R.neck === 'bowtie') { const g = G(torso, 0, yN - .06, zAt(.88, .02)); for (const s of [-1, 1]) M(g, cone(.065, .12, 10), acc('neckc', '#e11d48'), s * .062, 0, 0, 1, 1, .6, 0, 0, s * PI / 2); M(g, sph(.034, 8, 6), acc('neckc', '#e11d48', c => shade(c, -.25))); }
      else if (R.neck === 'tie') { const tm = acc('neckc', '#2563eb'); M(torso, sph(.042, 10, 8), tm, 0, yN - .07, zAt(.9, .0)); M(torso, geo('tieblade', () => new T.CylinderGeometry(.04, .065, .34, 4)), tm, 0, yAt(.6), zAt(.6, .01), 1, 1, .35, -.12, PI / 4, 0); }
      else if (R.neck === 'scarf') {
        const sm = R.neckc !== 'auto' ? mk('neckc') : cache(mats, 'scarf', () => new T.MeshToonMaterial({ gradientMap: grad, map: canvasTex('scarf', 16, 16, (g) => { for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#fff4e6' : '#e0313f'; g.fillRect(i * 4, 0, 4, 16); } }) }));
        M(torso, tor(.23 * tw, .085, 10, 24), sm, 0, yN + .02, 0, 1, .9, 1, PI / 2);
        M(torso, box(.13, .32, .05), sm, .12 * tw, yN - .17, zAt(.82, .03), 1, 1, 1, -.2, 0, .1);
      } else if (R.neck === 'chain') {
        const cm = R.neckc === 'auto' ? gold() : mk('neckc');
        M(torso, tor(.22 * tw, .018, 6, 28), cm, 0, yN - .07, .05, 1, 1, 1, PI / 2 - .5);
        M(torso, cyl(.065, .065, .022, 18), cm, 0, yAt(.66), zAt(.66, .02), 1, 1, 1, PI / 2 - .15);
      }
      // на спине
      const backZ = -rT * .84;
      if (R.back === 'backpack') {
        M(torso, sph(.27, 16, 12), acc('backc', '#f59e0b'), 0, yAt(.52), backZ - .1, 1.05 * tw, 1.15, .55);
        M(torso, sph(.17, 12, 10), acc('backc', '#f59e0b', c => shade(c, -.18)), 0, yAt(.36), backZ - .22, 1, .7, .4);
        for (const s of [-1, 1]) M(torso, cap(.028, .34, 6), toon('#7c4a12'), s * .15 * tw, yAt(.66), zAt(.66, .005), 1, 1, 1, -.15);
      } else if (R.back === 'guitar') {
        const g = G(torso, 0, yAt(.48), backZ - .07); g.rotation.z = .65;
        const gm = acc('backc', '#d23b3b');
        M(g, sph(.22, 16, 12), gm, 0, -.16, 0, 1, 1, .3); M(g, sph(.165, 16, 12), gm, 0, .14, 0, 1, 1, .3);
        M(g, geo('ghole', () => new T.CircleGeometry(.055, 14)), toon('#2b1a12'), 0, .0, -.068, 1, 1, 1, 0, PI, 0);
        M(g, box(.07, .55, .04), toon('#8b5a2b'), 0, .52, 0); M(g, box(.1, .15, .05), toon('#2b1a12'), 0, .84, 0);
        M(torso, box(.035, Th * 1.1, .02), toon('#3b2a1c'), 0, yAt(.55), zAt(.55, .01), 1, 1, 1, 0, 0, -.7);
      } else if (R.back === 'tail') {
        const g = G(torso, 0, yAt(.14), backZ + .05);
        const tm = R.backc === 'auto' ? hairM : mk('backc');
        for (let i = 0; i < 9; i++) { const k = i / 8; M(g, sph(.095 - k * .035, 10, 8), tm, 0, k * k * .62 - .06, -k * .5); }
        anims.push((t, dt, mv) => { g.rotation.y = Math.sin(t * (mv ? 9 : 2.6)) * (mv ? .45 : .3); g.rotation.x = -.15 + Math.sin(t * 1.3) * .08; });
      } else if (R.back === 'cape') {
        const g = G(torso, 0, yT - .1, backZ + .12);
        M(g, geo(`cape${f3(tw)}_${f3(hipY)}`, () => {
          const len = yT - .1 + hipY - .22, w = .74 * tw, pg = new T.PlaneGeometry(w, len, 6, 8), p = pg.attributes.position;
          for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), k = (len / 2 - y) / len, xx = x * (1 + k * .35); p.setXYZ(i, xx, y - len / 2, -(xx * xx) * .9 - k * .08); }
          pg.computeVertexNormals(); return pg;
        }), acc('backc', '#d62839', null, true));
        for (const s of [-1, 1]) M(torso, sph(.035, 8, 6), toon('#f2b91e'), s * .17 * tw, yT - .1, zAt(.85, .0));
        anims.push((t, dt, mv, s) => { g.rotation.x = mv ? .32 + s * .06 : .05 + Math.sin(t * 1.4) * .025; });
      } else if (R.back === 'wings' || R.back === 'batwings' || R.back === 'dragon') {
        const angel = R.back === 'wings', big = R.back === 'dragon' ? 1.35 : 1;
        const wdef = angel ? '#fbfbff' : R.back === 'dragon' ? '#1f9d78' : '#4a1f5c';
        const wm = acc('backc', wdef, null, true), bm = R.back === 'dragon' && R.backc === 'auto' ? toon('#f5c518') : acc('backc', wdef, c => shade(c, angel ? -.08 : -.35));
        const wings = [-1, 1].map(s => {
          const g = G(torso, s * .1, yAt(.66), backZ + .02);
          if (angel) for (let i = 0; i < 4; i++) M(g, sph(.26, 14, 10), wm, s * (.34 + i * .03), .14 - i * .15, -.02 * i, (1.35 - i * .2), .32, .12, 0, 0, s * (.42 - i * .25));
          else {
            M(g, geo('bwing', () => {
              const sh = new T.Shape(); sh.moveTo(0, .05); sh.lineTo(.42, .4); sh.lineTo(.78, .28); sh.quadraticCurveTo(.66, .14, .7, -.02); sh.quadraticCurveTo(.55, -.04, .5, -.16); sh.quadraticCurveTo(.36, -.12, .28, -.24); sh.quadraticCurveTo(.16, -.1, 0, -.12); sh.lineTo(0, .05);
              return new T.ShapeGeometry(sh, 6);
            }), wm, 0, 0, 0, s * big, big, 1);
            M(g, cap(.02, .5 * big, 6), bm, s * .21 * big, .22 * big, .005, 1, 1, 1, 0, 0, s * -1.0);
          }
          g.rotation.y = s * .55;
          return g;
        });
        anims.push((t, dt, mv) => { const f = Math.sin(t * (mv ? 7 : 2.2)) * (mv ? .32 : .14); wings[0].rotation.y = -.55 - f; wings[1].rotation.y = .55 + f; });
      }

      // голова (кость шеи → центр головы; всё лицо — в единицах головы радиусом .56)
      const headP = G(torso, 0, yT - .06, 0), hr = .56 * hs, head = G(headP, 0, hr * .86, 0);
      head.scale.setScalar(hs);
      M(head, sph(.56, 30, 22), skinM, 0, 0, 0, 1.04, .96, .98);
      for (const s of [-1, 1]) M(head, sph(.085, 10, 8), skinM, s * .565, -.07, 0, .55, 1, .8);
      const sz = (x, y) => .5488 * Math.sqrt(Math.max(0, 1 - (x * x) / .3392 - (y * y) / .289));   // поверхность лица
      // глаза
      const eyes = [];
      const EX = .2, EY = -.08, EZ = sz(EX, EY) - .012, kind = R.eyes;
      let blink = true;
      if (kind === 'cyclops') {
        const g = G(head, 0, EY + .02, sz(0, EY) - .01); eyes.push(g);
        M(g, sph(.17, 18, 14), eyeDark, 0, 0, 0, .9, 1, .36);
        M(g, sph(.13, 16, 12), irisM, 0, -.03, .02, .86, .86, .3);
        M(g, sph(.06, 12, 8), eyeDark, 0, -.025, .045, .85, .9, .3);
        M(g, sph(.05, 10, 8), whiteB, -.05, .06, .06); M(g, sph(.024, 8, 6), whiteB, .05, -.07, .06);
      } else if (kind === 'robot') {
        blink = false;
        M(head, box(.78, .2, .14), blackM, 0, EY, .45);
        M(head, box(.7, .11, .02), basic('#3ee8ff'), 0, EY, .525);
      } else {
        if (kind === 'cool') M(head, cyl(.013, .013, .12, 6), blackM, 0, EY + .01, sz(0, EY) + .02, 1, 1, 1, 0, 0, PI / 2);
        for (const s of [-1, 1]) {
          const g = G(head, s * EX, EY, EZ); g.rotation.set(-.05, s * .33, 0); eyes.push(g);
          if (kind === 'happy') { blink = false; M(g, tor(.068, .021, 6, 16, PI), eyeDark, 0, -.035, .02); }
          else if (kind === 'dizzy') { blink = false; M(g, tor(.075, .014, 6, 20), eyeDark, 0, 0, .01); M(g, tor(.038, .014, 6, 16), eyeDark, 0, 0, .012); M(g, sph(.014, 6, 4), eyeDark, 0, 0, .015); }
          else if (kind === 'heart') { blink = false; M(g, flat('heart'), toon('#ff3d7f'), 0, -.01, .015, .25, .25, .25); M(g, sph(.022, 8, 6), whiteB, -.045, .03, .04); }
          else if (kind === 'star') { blink = false; M(g, flat('star'), toon('#ffcc33'), 0, -.01, .015, .28, .28, .28); }
          else if (kind === 'cool') { blink = false; M(g, sph(.135, 18, 12), blackM, 0, -.01, .015, 1.08, .72, .26); M(g, box(.05, .02, .01), whiteB, -.05, .025, .05, 1, 1, 1, 0, 0, -.5); }
          else {
            M(g, sph(.105, 18, 14), eyeDark, 0, 0, 0, .82, 1, .36);
            M(g, sph(.082, 16, 12), irisM, 0, -.026, .014, .84, .84, .3);
            M(g, sph(.042, 12, 8), eyeDark, 0, -.02, .026, .8, .9, .3);
            M(g, sph(.034, 10, 8), whiteB, -.032, .042, .036);
            M(g, sph(.016, 8, 6), whiteB, .032, -.05, .036);
            if (kind === 'sleepy') M(g, sph(.112, 16, 10), skinM, 0, .05, .012, .88, .62, .44);
            if (kind === 'angry') M(g, sph(.112, 16, 10), skinM, s * .025, .075, .012, .95, .5, .44, 0, 0, s * .45);
            if (R.lash !== 'no') {
              const th = R.lash === 'long' ? .017 : .012;
              M(g, tor(.098, th, 5, 18, PI * .95), eyeDark, 0, 0, .028, 1, 1.02, 1, 0, 0, PI * .025);
              M(g, cap(th, .045, 6), eyeDark, s * .088, .068, .028, 1, 1, 1, 0, 0, s * -.9);
              if (R.lash === 'long') M(g, cap(th, .04, 6), eyeDark, s * .06, .094, .026, 1, 1, 1, 0, 0, s * -.5);
            }
          }
        }
      }
      // брови
      if (R.brows !== 'none' && kind !== 'robot') {
        const bM = browM, B = { soft: [.024, .065, -.06], thin: [.013, .1, -.1], thick: [.034, .095, .03], angry: [.03, .1, .42] }[R.brows] || [.024, .065, -.06];
        for (const s of [-1, 1]) M(head, cap(B[0], B[1], 6), bM, s * .2, .1, sz(.2, .1) + .012, 1, 1, .6, 0, s * .32, PI / 2 + s * B[2]);
      }
      // рот
      const MY = -.215, MZ = sz(0, MY) + .006, mouthM = toon('#4a2a22');
      if (R.mouth === 'cat') for (const s of [-1, 1]) M(head, tor(.032, .013, 5, 12, PI), mouthM, s * .032, MY + .01, MZ, 1, 1, 1, 0, 0, PI);
      else if (R.mouth === 'o') M(head, tor(.034, .015, 6, 16), mouthM, 0, MY - .01, MZ);
      else if (R.mouth === 'grin') {
        M(head, geo('grin', () => new T.CircleGeometry(.075, 18, PI, PI)), toon('#5b1f2a'), 0, MY + .025, MZ + .004);
        M(head, geo('grinT', () => new T.CircleGeometry(.04, 12, PI, PI)), toon('#ff7a95'), 0, MY - .012, MZ + .007);
        M(head, box(.1, .02, .006), whiteB, 0, MY + .015, MZ + .008);
      } else {
        M(head, tor(.058, .016, 6, 16, PI), mouthM, 0, MY + .02, MZ, 1, 1, 1, 0, 0, PI);
        if (R.mouth === 'tongue') M(head, sph(.034, 10, 8), toon('#ff6f8e'), .018, MY - .045, MZ - .005, 1, .8, .5);
        if (R.mouth === 'fangs') for (const s of [-1, 1]) M(head, cone(.014, .04, 6), whiteM, s * .03, MY - .045, MZ - .005, 1, 1, 1, PI, 0, 0);
        if (R.mouth === 'mustache') for (const s of [-1, 1]) M(head, sph(.065, 12, 8), toon('#3b2412'), s * .06, MY + .07, MZ, 1.3, .45, .45, 0, 0, s * -.25);
      }
      // щёчки
      for (const s of [-1, 1]) {
        const ck = R.cheek, cz = sz(.32, -.17) + .01;
        if (ck === 'blush' || ck === 'both') M(head, sph(.072, 14, 10), basic('#ff7f9f', .45), s * .32, -.17, cz, 1.15, .62, .3, 0, s * .62, 0);
        if (ck === 'freckles' || ck === 'both') for (let i = 0; i < 3; i++) { const x = .24 + i * .045, y = -.1 - (i % 2) * .035; M(head, sph(.012, 6, 4), toon('#b9774f'), s * x, y, sz(x, y) + .002); }
        if (ck === 'stars') M(head, flat('star'), toon('#ffd23f'), s * .32, -.17, cz, .09, .09, .09, 0, s * .62, 0);
        if (ck === 'hearts') M(head, flat('heart'), toon('#ff5c8a'), s * .32, -.17, cz, .085, .085, .085, 0, s * .62, 0);
      }

      // ── причёска ──
      const H = R.hair;
      const hairCap = (tilt = -.36, r = 1.07, th = .5) => M(head, geo(`hcap${f3(r)}_${f3(th)}`, () => new T.SphereGeometry(.56 * r, 30, 12, 0, TAU, 0, PI * th)), hairM, 0, .03, -.02, 1, 1, 1, tilt);
      const hairBack = (r = 1.06, t0 = .42, t1 = .8) => M(head, geo(`hback${f3(r)}_${f3(t0)}_${f3(t1)}`, () => new T.SphereGeometry(.56 * r, 26, 10, PI, PI, PI * t0, PI * (t1 - t0))), hairDS, 0, 0, -.01);
      const shellH = (r, t1, open, y = 0, z = -.02) => M(head, geo(`hshell${f3(r)}_${f3(t1)}_${f3(open)}`, () => new T.SphereGeometry(.56 * r, 32, 16, PI / 2 + open, TAU - 2 * open, 0, PI * t1)), hairDS, 0, y, z);
      const clump = (a, e, sx, sy, sz2, rz = 0, rad = .53) => {
        const o = M(head, sph(.16, 14, 10), hairM, Math.sin(a) * Math.cos(e) * rad * 1.04, Math.sin(e) * rad * .96 + .02, Math.cos(a) * Math.cos(e) * rad * .98, sx, sy, sz2);
        o.rotation.order = 'YXZ'; o.rotation.set(-e * .85, a, rz);
        return o;
      };
      const bangs = (n, spread, e, sx = 1.25, sy = .78) => { for (let i = 0; i < n; i++) { const t = n === 1 ? 0 : i / (n - 1) - .5; clump(t * spread, e - t * t * .4, sx, sy, .5, -t * .5); } };
      const up = new T.Vector3(0, 1, 0), v3 = new T.Vector3();
      const spike = (a, e, r, h, back = 0, lift = .35, dist = .5) => {
        const x = Math.sin(a) * Math.cos(e), y = Math.sin(e), z = Math.cos(a) * Math.cos(e);
        const o = M(head, cone(r, h, 8), hairM, x * (dist + h * .28), y * (dist + h * .28) + .04, z * (dist + h * .28) - .02);
        o.quaternion.setFromUnitVectors(up, v3.set(x, y + lift, z - back).normalize());
        o.userData.tuft = true;
        return o;
      };
      const ball = (x, y, z, r) => { const o = M(head, sph(r, 10, 8), hairM, x, y, z); o.userData.tuft = true; return o; };
      const curls = (n, rad, r, minY, oy = 0, oz = 0, faceCut = .5) => {
        for (let i = 0; i < n; i++) {
          const y = 1 - (i + .5) / n * (1 - minY), rr = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.39996, x = Math.cos(th) * rr, z = Math.sin(th) * rr;
          if (z > faceCut && y < .5) continue;
          ball(x * rad, y * rad + oy, z * rad + oz, r);
        }
      };
      const sideburns = () => { for (const s of [-1, 1]) clump(s * 1.32, .1, .72, 1.05, .45, 0); };
      const tie = (x, y, z, rx = 1.2) => M(head, tor(.07, .03, 6, 14), toon('#ff4fa3'), x, y, z, 1, 1, 1, rx);
      if (H !== 'bald' && H !== 'afro') {
        if (H === 'buzz' || H === 'mohawk') hairCap(-.5, 1.025, .54);
        else hairCap(-.36);
      }
      if (['short', 'side', 'spiky', 'curly', 'ponytail', 'buns', 'twintails', 'braid', 'anime'].includes(H)) hairBack();
      if (H === 'short') { bangs(4, 1.15, .62); sideburns(); }
      else if (H === 'side') { clump(-.62, .74, 1.0, .72, .5, .35); clump(-.3, .72, 1.2, .78, .5, .2); clump(.1, .56, 2.3, .85, .55, -.5); clump(.55, .38, 1.4, .8, .5, -.9); sideburns(); }
      else if (H === 'spiky') {
        bangs(3, .9, .62, 1.1, .8); sideburns();
        [[0, 1.25], [.85, .95], [-.85, .95], [1.7, .72], [-1.7, .72], [2.5, .55], [-2.5, .55], [PI, .5], [.42, 1.05], [-.42, 1.05], [2.1, .95], [-2.1, .95], [PI, 1.0]].forEach(([a, e]) => spike(a, e, .12, .34, .3));
      } else if (H === 'curly') {
        hairBack(1.1, .4, .78);
        curls(30, .6, .125, -.3, .02, -.02, .45);
        for (let i = 0; i < 5; i++) { const t = i / 4 - .5; ball(t * .5, .3 - t * t * .3, .5 - Math.abs(t) * .1, .1); }
      } else if (H === 'buzz') { /* только «ёжик» на шапочке */ }
      else if (H === 'bob') { shellH(1.12, .64, .9); bangs(6, 1.45, .55, 1.0, .92); }
      else if (H === 'long') {
        shellH(1.1, .72, .95); bangs(5, 1.25, .58);
        M(head, cap(.4, .5, 14), hairM, 0, -.62, -.3, 1.15, 1, .42);
        for (const s of [-1, 1]) M(head, cap(.1, .46, 8), hairM, s * .5, -.45, .14, 1, 1, .8, 0, 0, s * .06);
      } else if (H === 'wavy') {
        shellH(1.13, .72, .95); bangs(5, 1.25, .58);
        M(head, cap(.42, .45, 14), hairM, 0, -.62, -.32, 1.18, 1, .45);
        for (let i = 0; i < 9; i++) { const a = PI + (i / 8 - .5) * 2.4; ball(Math.sin(a) * .42, -.95 + (i % 2) * .05, Math.cos(a) * .2 - .3, .14); }
        for (const s of [-1, 1]) for (let i = 0; i < 4; i++) ball(s * (.5 + (i % 2) * .05), -.2 - i * .16, .14, .1 - i * .008);
      } else if (H === 'ponytail') {
        bangs(5, 1.25, .58); tie(0, .2, -.56);
        const g = G(head, 0, .2, -.6);
        M(g, cap(.13, .34, 10), hairM, 0, -.22, -.1, 1, 1, 1, .35); M(g, sph(.12, 10, 8), hairM, 0, -.46, -.2);
        anims.push((t, dt, mv, s) => { g.rotation.z = (mv ? s * .2 : 0) + Math.sin(t * 1.7) * .05; g.rotation.x = mv ? -.12 : 0; });
      } else if (H === 'buns') {
        bangs(5, 1.25, .58);
        for (const s of [-1, 1]) { M(head, sph(.21, 14, 10), hairM, s * .36, .46, -.12).userData.tuft = true; tie(s * .3, .34, -.1, .7).userData.tuft = true; }
      } else if (H === 'twintails') {
        bangs(5, 1.25, .58);
        const tails = [-1, 1].map(s => {
          tie(s * .5, .18, -.18, .5);
          const g = G(head, s * .54, .14, -.2);
          M(g, cap(.12, .42, 10), hairM, s * .1, -.3, -.04, 1, 1, 1, 0, 0, s * .28); M(g, sph(.105, 10, 8), hairM, s * .2, -.6, -.06);
          return g;
        });
        anims.push((t, dt, mv, s) => { tails.forEach((g, i) => { g.rotation.z = (mv ? s * .18 : 0) + Math.sin(t * 1.8 + i) * .05; }); });
      } else if (H === 'braid') {
        bangs(4, 1.15, .6);
        const g = G(head, 0, -.18, -.52);
        for (let i = 0; i < 6; i++) M(g, sph(.125 - i * .01, 10, 8), hairM, (i % 2 ? .025 : -.025), -i * .15, -i * .03, 1.1, .95, .9);
        M(g, tor(.06, .025, 6, 12), toon('#ff4fa3'), 0, -.86, -.17, 1, 1, 1, PI / 2); M(g, cone(.08, .14, 8), hairM, 0, -.98, -.18, 1, 1, 1, PI);
        anims.push((t, dt, mv, s) => { g.rotation.z = (mv ? s * .14 : 0) + Math.sin(t * 1.5) * .04; g.rotation.x = mv ? -.1 : 0; });
      } else if (H === 'mohawk') {
        for (let i = 0; i < 7; i++) { const a = -.35 + i * .37, o = M(head, sph(.15, 12, 10), hairM, 0, Math.cos(a) * .6 + .06, -Math.sin(a) * .6 - .02, .34, 1.25 - i * .07, .95); o.rotation.x = -a; o.userData.tuft = true; }
      } else if (H === 'afro') {
        shellH(1.42, .6, 1.02, .1, -.06);
        curls(46, .76, .16, -.25, .1, -.06, .42);
        for (let i = 0; i < 5; i++) { const t = i / 4 - .5; ball(t * .6, .36 - t * t * .3, .48 - Math.abs(t) * .1, .12); }
      } else if (H === 'anime') {
        bangs(3, .8, .66, 1.1, .8);
        [[2.2, .55], [-2.2, .55], [2.8, .35], [-2.8, .35], [PI, .8], [1.6, .9], [-1.6, .9], [2.6, 1.0], [-2.6, 1.0], [0, 1.25]].forEach(([a, e]) => spike(a, e, .17, .52, .55, .2, .48));
        for (const t of [-.3, 0, .3]) { const o = M(head, cone(.085, .34, 8), hairM, t * .5, .2, .5 - Math.abs(t) * .1); o.rotation.set(PI + .35, 0, t * .5); }
        for (const s of [-1, 1]) { const o = M(head, cone(.1, .55, 8), hairM, s * .5, -.2, .14); o.rotation.set(PI, 0, s * -.12); }
      }

      // ── шапка из гардероба ──
      const hat = R.hat, cover = ['cap', 'grad', 'helmet', 'army', 'top', 'propeller'].includes(hat) && H !== 'afro';
      if (cover) for (const o of [...head.children]) if (o.userData.tuft && o.position.y > .06) head.remove(o);
      const lift = cover ? 0 : { afro: .26, anime: .12, spiky: .12, curly: .07, mohawk: .2, buns: .04 }[H] || 0, hatK = H === 'afro' ? 1.22 : 1;
      let hatTop = .56;
      if (hat !== 'none') {
        const hg = G(head, 0, lift, 0); hg.scale.setScalar(hatK);
        const hm = (def, fn) => acc('hatc', def, fn);
        if (hat === 'bow') { const g = G(hg, .32, .44, .12); g.rotation.z = -.45; for (const s of [-1, 1]) M(g, cone(.1, .17, 10), hm('#ff4f9a'), s * .085, 0, 0, 1, 1, .7, 0, 0, s * PI / 2); M(g, sph(.05, 8, 6), hm('#ff4f9a', c => shade(c, -.15))); }
        else if (hat === 'cap') {
          const cm = hm('#e8384f');
          M(hg, geo('capcrown', () => new T.SphereGeometry(.62, 26, 10, 0, TAU, 0, PI * .5)), cm, 0, .1, -.02, 1, .78, 1, -.15);
          M(hg, cyl(.34, .34, .035, 26), hm('#e8384f', c => shade(c, -.18)), 0, .2, .62, 1, 1, .85, .25);
          M(hg, sph(.04, 8, 6), hm('#e8384f', c => shade(c, -.18)), 0, .53, -.06); hatTop = .58;
        } else if (hat === 'party') {
          const pm = R.hatc !== 'auto' ? mk('hatc') : cache(mats, 'party', () => new T.MeshToonMaterial({ gradientMap: grad, map: canvasTex('party', 32, 32, g => { for (let i = 0; i < 8; i++) { g.fillStyle = ['#ff4f9a', '#ffd23f', '#38bdf8', '#7cf29c'][i % 4]; g.fillRect(0, i * 4, 32, 4); } }) }));
          const g = G(hg, .08, .64, 0); g.rotation.z = -.22;
          M(g, cone(.25, .55, 18), pm); M(g, sph(.075, 10, 8), whiteM, 0, .3, 0); hatTop = 1.2;
        } else if (hat === 'grad') {
          M(hg, cyl(.36, .36, .17, 20), hm('#1f1f27'), 0, .5, -.02);
          M(hg, box(.9, .045, .9), hm('#1f1f27'), 0, .6, -.02, 1, 1, 1, 0, PI / 4, 0);
          M(hg, sph(.035, 8, 6), toon('#f2b91e'), 0, .635, -.02);
          M(hg, cyl(.012, .012, .26, 5), toon('#f2b91e'), .4, .48, .2); M(hg, cyl(.03, .02, .1, 6), toon('#f2b91e'), .4, .32, .2); hatTop = .66;
        } else if (hat === 'helmet') {
          M(hg, geo('hardhat', () => new T.SphereGeometry(.63, 26, 10, 0, TAU, 0, PI * .5)), hm('#facc15'), 0, .06, 0, 1, .82, 1);
          M(hg, cyl(.7, .7, .035, 28), hm('#facc15', c => shade(c, -.1)), 0, .08, .05, 1, 1, 1.08); M(hg, box(.08, .06, .7), hm('#facc15', c => shade(c, -.1)), 0, .56, 0); hatTop = .6;
        } else if (hat === 'army') {
          M(hg, geo('armyhat', () => new T.SphereGeometry(.66, 26, 10, 0, TAU, 0, PI * .5)), hm('#556b3a'), 0, .02, 0, 1, .82, 1);
          M(hg, tor(.65, .04, 6, 30), hm('#556b3a', c => shade(c, -.2)), 0, .03, 0, 1, 1, 1, PI / 2); hatTop = .58;
        } else if (hat === 'top') {
          M(hg, cyl(.3, .3, .5, 22), hm('#1f1f27'), 0, .8, -.02); M(hg, cyl(.52, .52, .035, 26), hm('#1f1f27'), 0, .56, -.02); M(hg, cyl(.305, .305, .08, 22), toon('#d6213f'), 0, .62, -.02); hatTop = 1.05;
        } else if (hat === 'ears') {
          for (const s of [-1, 1]) { M(hg, cone(.15, .3, 10), R.hatc === 'auto' ? hairM : mk('hatc'), s * .34, .5, -.04, 1, 1, .7, 0, 0, s * -.38); M(hg, cone(.08, .18, 8), toon('#ffb3c7'), s * .33, .48, .03, 1, 1, .5, 0, 0, s * -.38); }
          hatTop = .72;
        } else if (hat === 'horns') {
          for (const s of [-1, 1]) { M(hg, cone(.09, .3, 10), hm('#e11d48'), s * .3, .52, .06, 1, 1, 1, .25, 0, s * -.45); M(hg, cone(.045, .14, 8), hm('#e11d48'), s * .42, .7, .1, 1, 1, 1, .4, 0, s * -1.1); }
          hatTop = .78;
        } else if (hat === 'propeller') {
          const bm = R.hatc !== 'auto' ? mk('hatc') : cache(mats, 'beanie', () => new T.MeshToonMaterial({ gradientMap: grad, map: canvasTex('beanie', 32, 8, g => { ['#e23b4e', '#facc15', '#3b82f6', '#22c55e'].forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 8, 0, 8, 8); }); }) }));
          M(hg, geo('beanie', () => new T.SphereGeometry(.6, 24, 10, 0, TAU, 0, PI * .5)), bm, 0, .06, 0, 1, .72, 1);
          M(hg, cyl(.022, .022, .14, 6), blackM, 0, .55, 0);
          const pg = G(hg, 0, .62, 0);
          M(pg, box(.52, .02, .09), toon('#e23b4e'), 0, 0, 0, 1, 1, 1, .15); M(pg, box(.09, .02, .52), toon('#3b82f6'), 0, 0, 0, .15);
          M(pg, sph(.035, 8, 6), toon('#facc15'));
          anims.push((t, dt) => { pg.rotation.y += dt * 14; }); hatTop = .68;
        } else if (hat === 'halo') {
          const g = M(hg, tor(.3, .045, 8, 30), basic(R.hatc === 'auto' ? '#ffd84d' : colorOf(R, 'hatc')), 0, .86, 0, 1, 1, 1, PI / 2);
          anims.push(t => { g.position.y = .86 + Math.sin(t * 2.2) * .04; }); hatTop = .9;
        } else if (hat === 'crown') {
          const cg = R.hatc === 'auto' ? gold() : mk('hatc'), gm = R.hatc === 'auto' ? gold(1) : mk('hatc', null, true);
          M(hg, cyl(.3, .27, .2, 8, true), gm, 0, .64, -.02);
          for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; M(hg, cone(.05, .14, 6), cg, Math.sin(a) * .3, .8, Math.cos(a) * .3 - .02); }
          for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; M(hg, sph(.035, 8, 6), toon(i % 2 ? '#3b82f6' : '#e11d48'), Math.sin(a) * .29, .63, Math.cos(a) * .29 - .02); }
          hatTop = .9;
        } else if (hat === 'headphones') {
          const led = new T.MeshBasicMaterial({ color: '#ff2d55' }); led.userData.own = true;
          M(hg, tor(.62, .045, 8, 28, PI), hm('#26262e'), 0, .02, 0);
          for (const s of [-1, 1]) { M(hg, cyl(.17, .17, .13, 20), hm('#26262e'), s * .62, -.02, 0, 1, 1, 1, 0, 0, PI / 2); const r = M(hg, tor(.14, .026, 6, 22), led, s * .695, -.02, 0, 1, 1, 1, 0, PI / 2, 0); r.userData.keep = true; }
          const boom = M(hg, cyl(.014, .014, .42, 6), toon('#26262e'), -.5, -.25, .28, 1, 1, 1, .9, 0, .5); boom.userData.keep = true;
          M(hg, sph(.045, 10, 8), toon('#3a3a46'), -.28, -.36, .48);
          anims.push(t => { led.color.setHSL((t * .25) % 1, .95, .55); });
          hatTop = .66;
        }
      }
      // ── очки ──
      if (R.glasses !== 'none' && kind !== 'robot') {
        const gy = EY + .005, gz = EZ + .04, gm = def => acc('glassc', def);
        if (R.glasses === 'round' || R.glasses === 'square') {
          const sq = R.glasses === 'square';
          const fm = gm('#1f1f27');
          for (const s of [-1, 1]) M(head, sq ? tor(.15, .017, 6, 4) : tor(.118, .016, 6, 24), fm, s * EX, gy, gz, 1, 1, 1, 0, s * .3, sq ? PI / 4 : 0);
          M(head, cyl(.012, .012, .12, 6), fm, 0, gy + .02, gz + .02, 1, 1, 1, 0, 0, PI / 2);
          for (const s of [-1, 1]) M(head, cyl(.011, .011, .3, 5), fm, s * .4, gy + .02, .32, 1, 1, 1, PI / 2, 0, 0);
        } else if (R.glasses === 'heart') {
          for (const s of [-1, 1]) M(head, flat('heart', .1), gm('#ff4f8b'), s * EX, gy, gz + .01, .3, .3, .3, 0, s * .3, 0);
          M(head, cyl(.012, .012, .1, 6), gm('#ff4f8b'), 0, gy + .02, gz + .03, 1, 1, 1, 0, 0, PI / 2);
        } else if (R.glasses === 'star') {
          for (const s of [-1, 1]) { M(head, flat('star', .1), gm('#ffc83d'), s * EX, gy, gz, .36, .36, .36, 0, s * .3, 0); M(head, flat('star', .06), blackM, s * EX * 1.02, gy, gz + .025, .22, .22, .22, 0, s * .3, 0); }
        } else if (R.glasses === 'monocle') {
          const mg = R.glassc === 'auto' ? gold() : mk('glassc');
          M(head, tor(.125, .017, 6, 24), mg, EX, gy, gz, 1, 1, 1, 0, .3, 0);
          M(head, geo('mglass', () => new T.CircleGeometry(.115, 20)), basic('#dff4ff', .25), EX, gy, gz - .005, 1, 1, 1, 0, .3, 0);
          M(head, cyl(.008, .008, .4, 4), mg, EX + .12, gy - .25, gz - .05, 1, 1, 1, 0, 0, .25);
        }
      }

      // предмет в правой руке: шарик — объёмный, остальное — эмодзи
      const armR = arms[1];
      if (R.item === 'balloon') {
        const g = G(armR, 0, -armR.userData.La + .02, .05);
        M(g, cyl(.006, .006, .95, 4), whiteM, 0, .47, 0);
        M(g, sph(.21, 16, 12), toon('#ef3b4f'), 0, 1.05, 0, 1, 1.15, 1); M(g, cone(.035, .06, 6), toon('#ef3b4f'), 0, .82, 0, 1, 1, 1, PI);
        g.rotation.x = .5;
        anims.push((t, dt, mv) => { g.rotation.x = .5 - (mv ? .25 : 0); g.rotation.z = Math.sin(t * 1.3) * .12; });
      } else if (R.item !== 'none') {
        const e = partV('item', R.item, '');
        if (e) { const sp = emojiSprite(e, .5); sp.position.set(.04, -armR.userData.La - .1, .12); armR.add(sp); }
      }
      // питомец — отдельный объект (его ставит в сцену тот, кто рисует)
      const petE = R.pet !== 'none' ? partV('pet', R.pet, '') : '';
      const pet = petE ? emojiSprite(petE, .75) : null;

      bake(body);
      const top = hipY + yT - .06 + hr * .86 + hr * (H === 'afro' ? 1.35 : 1.04) + ({ spiky: .2, anime: .24, mohawk: .26, buns: .16, curly: .08 }[H] || 0) * (cover ? 0 : hs) + (hat !== 'none' ? (hatTop - .56) * hs * hatK + lift * hs : 0);
      return {
        root, body, torso, headP, head, legL: legs[0], legR: legs[1], armL: arms[0], armR, eyes, blink, anims, pet, R, top, own, key,
        headY: hipY + yT - .06 + hr * .86, hipY, hs,
        yaw: 0, phase: Math.random() * 6, blinkAt: Math.random() * 4, emote: null, emoteT: 0,
      };
    }

    // Перекрасить готового человечка, если поменялись только цвета (обычные, не особые материалы). false — нужна пересборка
    function recolor(ch, look){
      const R = resolve(look, ch.key), O = ch.R;
      for (const s in R) if (!PALS.includes(s) && R[s] !== O[s]) return false;
      for (const s of PALS) {
        if (R[s] === O[s]) continue;
        if ((SPECIAL[s] || []).includes(R[s]) || (SPECIAL[s] || []).includes(O[s]) || (R[s] === 'auto') !== (O[s] === 'auto')) return false;
      }
      for (const m of ch.own) if (m.userData.slot) m.color.set(m.userData.fn(colorOf(R, m.userData.slot)));
      ch.R = R;
      return true;
    }
    // ── Анимация: шаг, дыхание, моргание, эмоции, аксессуары ──
    // o (движок): rate — частота шага (бег быстрее), air — в прыжке/падении, sit — сидит
    function animate(ch, moving, dt, t, o){
      const rate = o?.rate || 10.5, run = rate > 13;
      if (moving) ch.phase += dt * rate;
      const s = Math.sin(ch.phase), mv = moving ? 1 : 0, sw = run ? .95 : .7;
      ch.legL.rotation.x = s * sw * mv; ch.legR.rotation.x = -s * sw * mv;
      ch.armL.rotation.set(-s * (sw - .05) * mv, 0, -.16); ch.armR.rotation.set(s * (sw - .05) * mv, 0, .16);
      ch.body.position.y = mv ? Math.abs(Math.cos(ch.phase)) * (run ? .09 : .06) : 0;
      ch.body.rotation.set(0, 0, mv ? s * .04 : 0);
      ch.torso.rotation.set(mv ? (run ? .16 : .06) : 0, 0, 0);
      ch.torso.scale.y = mv ? 1 : 1 + Math.sin(t * 2.4 + ch.phase) * .012;
      ch.headP.rotation.set(0, 0, mv ? -s * .035 : Math.sin(t * .9 + ch.phase) * .035);
      ch.body.position.z = 0; ch.body.scale.set(1, 1, 1);
      // позы движка (js/engine/player.js): кувырок, вис на краю, лестница, паркур, присед
      const special = o && (o.roll >= 0 || o.hang || o.ladder || o.pk);
      if (o?.roll >= 0) {   // кувырок клубком через голову (назад — в обратную сторону)
        const k = o.roll, curl = Math.sin(Math.min(1, k * 1.08) * PI), a = (o.rollBack ? -1 : 1) * TAU * k * k * (3 - 2 * k), hc = (ch.top || 2.3) * .45;
        ch.body.scale.setScalar(1 - .28 * curl);
        ch.body.rotation.set(a, 0, 0);
        ch.body.position.y = hc * (1 - Math.cos(a)); ch.body.position.z = -hc * Math.sin(a);
        ch.legL.rotation.x = ch.legR.rotation.x = -1.7 * curl;
        ch.armL.rotation.set(-1.3 * curl, 0, -.3); ch.armR.rotation.set(-1.3 * curl, 0, .3);
        ch.headP.rotation.x = .45 * curl; ch.torso.rotation.x = .5 * curl;
      } else if (o?.hang) {   // вис: руки на краю, ноги болтаются; по краю — перехват руками
        const q = Math.sin(t * 2.1);
        ch.body.position.y = 0;
        ch.armL.rotation.set(-2.95, 0, -.14 - (mv ? Math.max(0, s) * .3 : 0)); ch.armR.rotation.set(-2.95, 0, .14 + (mv ? Math.max(0, -s) * .3 : 0));
        ch.legL.rotation.x = q * .12 + (mv ? s * .2 : 0); ch.legR.rotation.x = -q * .1 - (mv ? s * .2 : 0);
        ch.torso.rotation.x = -.06; ch.headP.rotation.x = -.18;
      } else if (o?.ladder) {   // лестница: руки и ноги по очереди
        const q = Math.sin(o.climbPh || 0);
        ch.body.position.y = 0;
        ch.armL.rotation.set(-2.5 - q * .45, 0, -.1); ch.armR.rotation.set(-2.5 + q * .45, 0, .1);
        ch.legL.rotation.x = -.35 - Math.max(0, q) * .7; ch.legR.rotation.x = -.35 - Math.max(0, -q) * .7;
        ch.torso.rotation.x = -.05; ch.headP.rotation.x = -.2;
      } else if (o?.pk) {   // паркур: прогресс 0…1
        const k = o.pkK || 0;
        ch.body.position.y = 0;
        if (o.pk === 'vault') {   // ладонь на край → ноги вбок над препятствием → приземление
          if (k < .35) { ch.armR.rotation.set(-1.0, 0, .2); ch.armL.rotation.set(-.6, 0, -.5); ch.legL.rotation.x = ch.legR.rotation.x = -.5; ch.torso.rotation.x = .35; }
          else if (k < .68) { ch.armR.rotation.set(-.35, 0, .45); ch.armL.rotation.set(-1.4, 0, -.9); ch.legL.rotation.x = -1.3; ch.legR.rotation.x = -1.1; ch.body.rotation.z = .3; ch.torso.rotation.x = .2; }
          else { ch.armL.rotation.set(-.8, 0, -.8); ch.armR.rotation.set(-.8, 0, .8); ch.legL.rotation.x = -.35; ch.legR.rotation.x = .3; ch.torso.rotation.x = .15; }
        } else if (o.pk === 'hang') { ch.armL.rotation.set(-2.9, 0, -.15); ch.armR.rotation.set(-2.9, 0, .15); ch.legL.rotation.x = -.2; ch.legR.rotation.x = .1; }
        else {   // подтянуться: руки на край → тянут → упор, колено на край
          if (k < .4) { ch.armL.rotation.set(-2.9, 0, -.15); ch.armR.rotation.set(-2.9, 0, .15); ch.legL.rotation.x = -.15; ch.legR.rotation.x = .1; }
          else if (k < .65) { const p = (k - .4) / .25; ch.armL.rotation.set(-2.9 + p * 1.6, 0, -.3); ch.armR.rotation.set(-2.9 + p * 1.6, 0, .3); ch.legL.rotation.x = -.5 * p; ch.torso.rotation.x = .3 * p; }
          else { ch.armL.rotation.set(-.45, 0, -.35); ch.armR.rotation.set(-.45, 0, .35); ch.legL.rotation.x = -1.35; ch.legR.rotation.x = .2; ch.torso.rotation.x = .45; }
        }
      } else if (o?.air) {   // в воздухе: ноги врозь, руки чуть вверх
        ch.legL.rotation.x = -.55; ch.legR.rotation.x = .45; ch.body.position.y = 0;
        ch.armL.rotation.set(-.5, 0, -.75); ch.armR.rotation.set(-.5, 0, .75); ch.torso.rotation.x = .05;
      } else if (o?.sit) {   // сидит: ноги вперёд, руки на коленях
        ch.legL.rotation.x = -1.42; ch.legR.rotation.x = -1.42; ch.body.position.y = 0;
        ch.armL.rotation.set(-.55, 0, -.12); ch.armR.rotation.set(-.55, 0, .12); ch.torso.rotation.x = -.04;
      }
      const cw = !special && !o?.air && !o?.sit ? o?.crouch || 0 : 0;
      if (cw > .01) {   // присед: по-мультяшному сжимается, корпус вперёд, ноги шире
        ch.body.scale.set(1 + .08 * cw, 1 - .36 * cw, 1 + .08 * cw);
        ch.torso.rotation.x += .25 * cw;
        if (!mv) { ch.legL.rotation.x = -.35 * cw; ch.legR.rotation.x = .3 * cw; }
        ch.armL.rotation.x -= .3 * cw; ch.armR.rotation.x -= .3 * cw;
      }
      if (special) ch.emote = null;
      // эмоции: 👋 машет, 🎉 руки вверх и прыжок, 🔥 прыжок, 👍 палец вперёд, 😂 трясётся, ❤️/😎 кивает, 😭 плачет, 💃 танец
      const e = ch.emote, k = (t - ch.emoteT) * 10;
      if (e && t - ch.emoteT < (e === '💃' ? 3.2 : 1.6)) {
        if (e === '👋') ch.armR.rotation.set(-2.7, 0, .3 + Math.sin(k) * .45);
        else if (e === '🎉') { ch.body.position.y += Math.max(0, Math.sin(k * .8)) * .45; ch.armL.rotation.set(-2.9, 0, -.3); ch.armR.rotation.set(-2.9, 0, .3); }
        else if (e === '🔥') ch.body.position.y += Math.max(0, Math.sin(k * .8)) * .5;
        else if (e === '👍') { ch.armR.rotation.set(-1.4, 0, .1); ch.headP.rotation.x = Math.sin(k * .6) * .1; }
        else if (e === '😂') { ch.body.rotation.z = Math.sin(k * 2) * .12; ch.headP.rotation.x = -.18; }
        else if (e === '❤️' || e === '😎') ch.headP.rotation.x = Math.sin(k) * .12;
        else if (e === '😭') { ch.headP.rotation.x = .3; ch.armL.rotation.set(-2.2, 0, .55); ch.armR.rotation.set(-2.2, 0, -.55); }
        else if (e === '💃') {
          const d = Math.sin(k * .55);
          ch.body.rotation.z = d * .14; ch.body.position.y += Math.abs(Math.cos(k * .55)) * .08;
          ch.armL.rotation.set(d > 0 ? -2.8 : -.3, 0, -.4); ch.armR.rotation.set(d > 0 ? -.3 : -2.8, 0, .4);
          ch.legL.rotation.x = Math.max(0, d) * .5; ch.legR.rotation.x = Math.max(0, -d) * .5; ch.headP.rotation.z = -d * .12;
        }
      } else ch.emote = null;
      if (ch.blink) { const b = (t + ch.blinkAt) % 4 > 3.86; for (const g of ch.eyes) g.scale.y = b ? .12 : 1; }
      for (const f of ch.anims) f(t, dt, mv, s);
    }
    function dispose(ch){
      if (!ch) return;
      ch.root.parent?.remove(ch.root);
      if (ch.pet) { ch.pet.parent?.remove(ch.pet); ch.pet.material.dispose(); }
      ch.root.traverse(o => {
        if (o.isSprite) o.material.dispose();
        if (o.isMesh && o.userData.own) o.geometry.dispose();
        if (o.isMesh && o.material.userData?.own) o.material.dispose();
      });
    }
    // ── След за бегущим: эмодзи из гардероба, радуга — цветные кружки ──
    function trails(scene){
      const pool = [], live = [];
      const dot = cache(texs, 'dot', () => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 2, 16, 16, 15); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); const t = new T.CanvasTexture(c); return t; });
      function emit(trail, x, y, z, t){
        if (!trail || trail === 'none') return;
        let s = pool.pop();
        if (!s) { s = new T.Sprite(new T.SpriteMaterial({ map: dot, transparent: true, depthWrite: false })); scene.add(s); }
        s.visible = true;
        if (trail === 'rainbow') { s.material.map = dot; s.material.color.setHSL((t * .6) % 1, .9, .6); s.scale.setScalar(.32); }
        else { const e = partV('trail', trail, ''); if (!e) { pool.push(s); s.visible = false; return; } s.material.map = emojiTex(e); s.material.color.set('#ffffff'); s.scale.setScalar(.34); }
        s.position.set(x + (Math.random() - .5) * .3, y + .15 + Math.random() * .5, z + (Math.random() - .5) * .3);
        live.push({ s, life: .9, vy: .5 + Math.random() * .4 });
      }
      function update(dt){
        for (let i = live.length - 1; i >= 0; i--) {
          const p = live[i]; p.life -= dt;
          if (p.life <= 0) { p.s.visible = false; pool.push(p.s); live.splice(i, 1); continue; }
          p.s.position.y += p.vy * dt; p.s.material.opacity = Math.min(1, p.life * 1.6);
        }
      }
      function clear(){ for (const p of live) { p.s.visible = false; pool.push(p.s); } live.length = 0; }
      return { emit, update, clear };
    }
    function lights(scene){
      scene.add(new T.HemisphereLight('#ffffff', '#b8a68c', .62));
      const sun = new T.DirectionalLight('#fff6e8', .5);
      sun.position.set(-30, 60, 40);
      scene.add(sun);
      return sun;
    }
    return { T, grad, toon, basic, geo, sph, cyl, tor, box, cone, emojiSprite, build, recolor, animate, dispose, trails, lights, cloth, mats, geos, texs };
  }

  // ═══ Мир ═══
  function create(container, opts){
    const T = window.THREE, K = kit(T);
    const { M, PORTALS, ground, STAGE, CX, CY, W, H } = opts;
    const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, document.body.classList.contains('low') ? 1.25 : 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.domElement.className = 'wld-gl';
    container.prepend(renderer.domElement);
    const scene = new T.Scene();
    scene.background = new T.Color('#a8dcff');
    scene.fog = new T.Fog('#a8dcff', 60, 140);
    const camera = new T.PerspectiveCamera(40, 1, .3, 400);
    K.lights(scene);
    const toon = K.toon, geo = K.geo;

    // ── Земля (картинка 2D-карты) ──
    const tex = new T.CanvasTexture(ground);
    tex.encoding = T.sRGBEncoding;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const groundMesh = new T.Mesh(new T.PlaneGeometry(W / U, H / U), new T.MeshLambertMaterial({ map: tex }));
    groundMesh.rotation.x = -PI / 2;
    groundMesh.position.set(W / U / 2, 0, H / U / 2);
    scene.add(groundMesh);
    const outer = new T.Mesh(new T.PlaneGeometry(600, 600), new T.MeshLambertMaterial({ color: '#3a7a44' }));
    outer.rotation.x = -PI / 2; outer.position.set(W / U / 2, -.02, H / U / 2);
    scene.add(outer);

    // ── Деревья: ствол + 3 шара кроны (InstancedMesh) ──
    const trees = M.trees;
    const trunk = new T.InstancedMesh(new T.CylinderGeometry(.22, .3, 1.6, 7), toon('#7a4f2c'), trees.length);
    const crown = new T.InstancedMesh(new T.IcosahedronGeometry(1, 1), toon('#ffffff'), trees.length * 3);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), col = new T.Color();
    const greens = ['#2f8a3f', '#3fa24c', '#58b85a', '#2c7a3a'];
    trees.forEach((t, i) => {
      const k = t.r / 26, x = t.x / U, z = t.y / U;
      m4.compose(ps.set(x, .8 * k, z), q.identity(), sc.set(k, k, k)); trunk.setMatrixAt(i, m4);
      [[0, 2.1, 0, 1.15], [-.6, 1.75, .2, .8], [.62, 1.8, -.1, .85]].forEach(([dx, dy, dz, r], j) => {
        m4.compose(ps.set(x + dx * k, dy * k, z + dz * k), q.identity(), sc.set(r * k, r * k * .92, r * k)); crown.setMatrixAt(i * 3 + j, m4);
        crown.setColorAt(i * 3 + j, col.set(greens[(t.v + j) % greens.length]));
      });
    });
    scene.add(trunk, crown);
    // ── Фонари и скамейки ──
    const pole = new T.InstancedMesh(new T.CylinderGeometry(.07, .09, 2.6, 6), toon('#2d2a3a'), M.lamps.length);
    const bulb = new T.InstancedMesh(new T.SphereGeometry(.22, 12, 8), new T.MeshBasicMaterial({ color: '#fff3b0' }), M.lamps.length);
    M.lamps.forEach((l, i) => {
      m4.compose(ps.set(l.x / U, 1.3, l.y / U), q.identity(), sc.set(1, 1, 1)); pole.setMatrixAt(i, m4);
      m4.compose(ps.set(l.x / U, 2.7, l.y / U), q.identity(), sc.set(1, 1, 1)); bulb.setMatrixAt(i, m4);
    });
    scene.add(pole, bulb);
    const benchG = new T.Group();
    M.benches.forEach(b => {
      const g = new T.Group();
      const seat = new T.Mesh(geo('seat', () => new T.BoxGeometry(2.2, .14, .6)), toon('#a0673a')); seat.position.y = .55;
      const back = new T.Mesh(geo('back', () => new T.BoxGeometry(2.2, .5, .12)), toon('#8b5a2b')); back.position.set(0, .9, -.26);
      const legs = new T.Mesh(geo('blegs', () => new T.BoxGeometry(1.9, .5, .4)), toon('#3b2a1c')); legs.position.y = .25;
      g.add(seat, back, legs);
      g.position.set(b.x / U, 0, b.y / U);
      g.rotation.y = -b.a - PI / 2;   // спинкой к фонтану
      benchG.add(g);
    });
    scene.add(benchG);

    // ── Фонтан ──
    const fx = CX / U, fz = CY / U;
    const rim = new T.Mesh(new T.CylinderGeometry(5.1, 5.3, .9, 40, 1, true), toon('#a8b0bb', 1));
    rim.position.set(fx, .45, fz);
    const rimTop = new T.Mesh(new T.TorusGeometry(5.05, .28, 8, 48), toon('#c5ccd6'));
    rimTop.rotation.x = PI / 2; rimTop.position.set(fx, .9, fz);
    const water = new T.Mesh(new T.CircleGeometry(4.9, 40), new T.MeshLambertMaterial({ color: '#4fb8f0', transparent: true, opacity: .9 }));
    water.rotation.x = -PI / 2; water.position.set(fx, .62, fz);
    const pillar = new T.Mesh(new T.CylinderGeometry(.45, .7, 2.2, 16), toon('#c5ccd6'));
    pillar.position.set(fx, 1.1, fz);
    const bowl = new T.Mesh(new T.CylinderGeometry(1.6, .6, .45, 24), toon('#c5ccd6'));
    bowl.position.set(fx, 2.2, fz);
    scene.add(rim, rimTop, water, pillar, bowl);
    const ripples = [0, 1, 2].map(() => { const r = new T.Mesh(new T.RingGeometry(.9, 1.05, 40), new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .6, side: T.DoubleSide })); r.rotation.x = -PI / 2; r.position.set(fx, .64, fz); scene.add(r); return r; });
    const drops = new T.InstancedMesh(new T.SphereGeometry(.12, 6, 5), new T.MeshBasicMaterial({ color: '#bfe8ff' }), 18);
    scene.add(drops);

    // ── Порталы: арка + парящий значок ──
    const portals = PORTALS.map((p, i) => {
      const g = new T.Group();
      g.position.set(p.x / U, 0, p.y / U);
      const arch = new T.Mesh(geo('arch', () => new T.TorusGeometry(2.4, .26, 10, 40, PI)), new T.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: .7, roughness: .4 }));
      arch.position.y = .1;
      arch.rotation.y = Math.atan2(p.x / U - fx, p.y / U - fz);   // аркой к площади
      const ring = new T.Mesh(geo('pring', () => new T.TorusGeometry(3.2, .12, 8, 48)), new T.MeshBasicMaterial({ color: p.color, transparent: true, opacity: .8 }));
      ring.rotation.x = PI / 2; ring.position.y = .08;
      const icon = K.emojiSprite(p.e, 2.4);
      icon.position.y = 3.6;
      g.add(arch, ring, icon);
      scene.add(g);
      return { g, ring, icon, phase: i };
    });
    // ── Экран сцены ──
    const scrC = document.createElement('canvas'); scrC.width = 512; scrC.height = 256;
    const scrT = new T.CanvasTexture(scrC); scrT.encoding = T.sRGBEncoding;
    let scrLive = null;
    function drawScreen(live){
      if (scrLive === live) return;
      scrLive = live;
      const g = scrC.getContext('2d'), gr = g.createLinearGradient(0, 0, 512, 256);
      gr.addColorStop(0, live ? '#7c3aed' : '#1e1b4b'); gr.addColorStop(1, live ? '#db2777' : '#312e81');
      g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '900 64px Oswald, Montserrat, sans-serif'; g.fillText(live ? '🔴 В ЭФИРЕ' : 'DAN4IK37', 256, 105);
      g.font = '700 28px Montserrat, sans-serif'; g.fillStyle = 'rgba(255,255,255,.88)';
      g.fillText(live ? 'Денчик стримит — заходи!' : 'Стрим скоро · смотри видео', 256, 185);
      scrT.needsUpdate = true;
    }
    drawScreen(false);
    const scr = new T.Group();
    const sw = STAGE.w / U, sh = STAGE.h / U;
    const frame = new T.Mesh(new T.BoxGeometry(sw + .6, sh + .6, .4), toon('#111827'));
    const screen = new T.Mesh(new T.PlaneGeometry(sw, sh), new T.MeshBasicMaterial({ map: scrT }));
    screen.position.z = .21;
    const legsS = new T.Mesh(new T.BoxGeometry(.5, 3, .5), toon('#374151')); legsS.position.y = -sh / 2 - 1.2;
    scr.add(frame, screen, legsS);
    scr.position.set((STAGE.x + STAGE.w / 2) / U, sh / 2 + 2.6, (STAGE.y + STAGE.h / 2) / U);
    scene.add(scr);

    // ── Игроки ──
    const chars = new Map();   // key → { ch, sig, op }
    const trail = K.trails(scene);
    function setPlayer(key, look){
      const sig = JSON.stringify(look || {});
      const cur = chars.get(key);
      if (cur && cur.sig === sig) return;
      const ch = K.build(look, key);
      scene.add(ch.root);
      if (ch.pet) scene.add(ch.pet);
      if (cur) { ch.yaw = cur.ch.yaw; ch.root.position.copy(cur.ch.root.position); if (ch.pet && cur.ch.pet) ch.pet.position.copy(cur.ch.pet.position); K.dispose(cur.ch); }
      chars.set(key, { ch, sig, op: 1, lastTrail: 0 });
    }
    function removePlayer(key){ const c = chars.get(key); if (c) { K.dispose(c.ch); chars.delete(key); } }
    // Каждый кадр: позиция (координаты карты), идёт ли, прозрачность (вход/выход)
    function updatePlayer(key, x, y, moving, dt, t, fade){
      const c = chars.get(key);
      if (!c) return;
      const ch = c.ch, X = x / U, Z = y / U, r = ch.root;
      const dx = X - r.position.x, dz = Z - r.position.z;
      if (Math.abs(dx) + Math.abs(dz) > .002 && dx * dx + dz * dz < 4) {
        const want = Math.atan2(dx, dz);
        let d = want - ch.yaw; while (d > PI) d -= TAU; while (d < -PI) d += TAU;
        ch.yaw += d * Math.min(1, dt * 12);
      }
      r.position.set(X, 0, Z);
      r.rotation.y = ch.yaw;
      K.animate(ch, moving, dt, t);
      if (moving && ch.R.trail !== 'none' && t - c.lastTrail > .09) { c.lastTrail = t; trail.emit(ch.R.trail, X - Math.sin(ch.yaw) * .4, 0, Z - Math.cos(ch.yaw) * .4, t); }
      if (ch.pet) {
        const tx = X - Math.sin(ch.yaw) * .9 + Math.cos(ch.yaw) * .7, tz = Z - Math.cos(ch.yaw) * .9 - Math.sin(ch.yaw) * .7, p = ch.pet.position;
        p.x += (tx - p.x) * Math.min(1, dt * 5); p.z += (tz - p.z) * Math.min(1, dt * 5);
        p.y = .45 + Math.abs(Math.sin(t * 7 + ch.phase)) * (moving ? .25 : .06);
      }
      const op = fade == null ? 1 : fade;
      if (c.op !== op) { c.op = op; ch.root.visible = op > .02; if (ch.pet) ch.pet.visible = op > .02; }
    }
    function emote(key, e, t){ const c = chars.get(key); if (c) { c.ch.emote = e; c.ch.emoteT = t; } }
    const tagY = key => (chars.get(key)?.ch.top || 2.3) + .42;

    // ── Камера, кадр, выбор точки ──
    let zoom = 1, camX = W / U / 2, camZ = H / U / 2, w = 1, h = 1, paused = false;
    const ray = new T.Raycaster(), ndc = new T.Vector2(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3(), v3 = new T.Vector3();
    function resize(){
      const r = container.getBoundingClientRect();
      w = Math.max(100, r.width); h = Math.max(100, r.height);
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
      camera.aspect = w / h; camera.fov = w < h ? 50 : 40; camera.updateProjectionMatrix();
    }
    function render(t, dt, fx2, fy2){
      const tx = fx2 / U, tz = fy2 / U;
      camX += (tx - camX) * Math.min(1, dt * 6); camZ += (tz - camZ) * Math.min(1, dt * 6);
      const dist = (w < 600 ? 11.5 : 10.5) * zoom;
      camera.position.set(camX, 1.2 + dist * .58, camZ + dist * .82);
      camera.lookAt(camX, 1.1, camZ);
      trail.update(dt);
      if (paused) return;
      water.material.color.setHSL(.56, .78, .6 + Math.sin(t * 2) * .03);
      ripples.forEach((r, i) => { const k = ((t * .45 + i / 3) % 1); r.scale.setScalar(1 + k * 3.6); r.material.opacity = .6 * (1 - k); });
      for (let i = 0; i < 18; i++) { const a = i / 18 * TAU + t * .3, k = ((t * .8 + i * .37) % 1), rr = .4 + k * 1.6; m4.compose(ps.set(fx + Math.cos(a) * rr, 2.5 + Math.sin(k * PI) * 1.6, fz + Math.sin(a) * rr), q.identity(), sc.set(1, 1, 1)); drops.setMatrixAt(i, m4); }
      drops.instanceMatrix.needsUpdate = true;
      portals.forEach(p => { p.icon.position.y = 3.6 + Math.sin(t * 2 + p.phase) * .25; const s = 1 + Math.sin(t * 3 + p.phase) * .06; p.ring.scale.set(s, s, s); });
      renderer.render(scene, camera);
    }
    function pickGround(cx, cy){
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(plane, hit) ? [hit.x * U, hit.z * U] : null;
    }
    // Экранные координаты точки карты на высоте hh (в единицах 3D) — для подписей и пузырей
    function project(x, y, hh){
      v3.set(x / U, hh, y / U).project(camera);
      return [(v3.x + 1) / 2 * w, (1 - v3.y) / 2 * h, v3.z < 1 && Math.abs(v3.x) < 1.3 && Math.abs(v3.y) < 1.3];
    }
    function setZoom(z){ zoom = Math.max(.55, Math.min(1.8, z)); }
    function dispose(){
      chars.forEach(c => K.dispose(c.ch)); chars.clear();
      renderer.dispose(); renderer.forceContextLoss?.();
      renderer.domElement.remove();
    }
    resize();
    return { setPlayer, removePlayer, updatePlayer, emote, render, pickGround, project, resize, dispose, tagY, setLive: drawScreen, get zoom(){ return zoom; }, setZoom, setPaused(v){ paused = !!v; }, has: k => chars.has(k), keys: () => [...chars.keys()] };
  }

  // ═══ Витрина гардероба: человечек на подставке, крутится пальцем; картинки вариантов (thumb) ═══
  // Кадр витрины по настоящим размерам человечка (рост, голова, шапка): куда смотрим (ty), откуда (y, d), поворот
  const VIEWS = { full: 1, head: 1, hat: 1, top: 1, legs: 1, feet: 1, back: 1 };
  // ty — центр кадра, rh/rw — половина высоты/ширины того, что должно влезть, up — камера чуть выше центра
  function frameOf(v, ch){
    const top = ch.top, hy = ch.headY, hs = ch.hs, hip = ch.hipY;
    if (v === 'head') return { ty: hy + .03, rh: .8 * hs + .1, rw: .9 * hs + .15, up: .2 };
    if (v === 'hat') { const ty = (hy - .25 + top) / 2; return { ty, rh: (top - hy + .75) / 2 + .12, rw: .85 * hs, up: .2 }; }
    if (v === 'top') { const lo = hip - .15, hi = hy + .62 * hs; return { ty: (lo + hi) / 2, rh: (hi - lo) / 2 + .1, rw: .85, up: .25 }; }
    if (v === 'legs') return { ty: hip * .58, rh: hip * .58 + .16, rw: .6, up: .35 };
    if (v === 'feet') return { ty: .13, rh: .3, rw: .48, up: .35 };
    if (v === 'back') return { ty: top / 2, rh: top / 2 + .22, rw: 1.15, up: .3, yaw: PI };
    return { ty: top / 2, rh: top / 2 + .22, rw: .85, up: .3 };
  }
  // Расстояние камеры, чтобы кадр влез и по высоте, и по ширине (узкая витрина на телефоне)
  const camDist = (V, fov, aspect) => { const t = Math.tan(fov * PI / 360); return Math.max(V.rh / t, V.rw / (t * aspect)); };
  function preview(container, opts = {}){
    const T = window.THREE, K = kit(T);
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.domElement.className = 'ce-gl';
    container.appendChild(renderer.domElement);
    const scene = new T.Scene();
    K.lights(scene);
    const fill = new T.DirectionalLight('#dfe8ff', .22); fill.position.set(30, 20, 30); scene.add(fill);
    const camera = new T.PerspectiveCamera(32, 1, .1, 60);
    const stand = new T.Mesh(new T.CylinderGeometry(1.15, 1.25, .16, 40), K.toon(opts.stand || '#2d2560'));
    stand.position.y = -.08; scene.add(stand);
    const ring = new T.Mesh(new T.TorusGeometry(1.2, .025, 6, 60), new T.MeshBasicMaterial({ color: opts.ring || '#9b6dff' }));
    ring.rotation.x = PI / 2; ring.position.y = .005; scene.add(ring);
    const trail = K.trails(scene);
    let ch = null, yaw = .45, auto = true, drag = null, lastDrag = -9, walk = false, view = 'full', w = 1, h = 1, raf = 0, last = performance.now(), dead = false, lastTrail = 0;
    const cam = { up: .3, d: 6, ty: 1.15 };
    function set(look, key){
      const nch = K.build(look, key || opts.key || 'me');
      scene.add(nch.root);
      if (nch.pet) scene.add(nch.pet);
      if (ch) { nch.phase = ch.phase; K.dispose(ch); }
      ch = nch;
    }
    function focus(v){ view = VIEWS[v] ? v : 'full'; if (view === 'back') yaw = PI; }
    function resize(){
      const r = container.getBoundingClientRect();
      w = Math.max(60, r.width); h = Math.max(60, r.height);
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    const el = renderer.domElement;
    el.addEventListener('pointerdown', e => { drag = { x: e.clientX, yaw }; el.setPointerCapture?.(e.pointerId); });
    el.addEventListener('pointermove', e => { if (!drag) return; yaw = drag.yaw + (e.clientX - drag.x) * .012; lastDrag = performance.now() / 1000; });
    const up = () => { drag = null; lastDrag = performance.now() / 1000; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    function frame(now){
      if (dead) return;
      raf = requestAnimationFrame(frame);
      const t = now / 1000, dt = Math.min(.05, (now - last) / 1000); last = now;
      if (!ch) return;
      if (auto && !drag && t - lastDrag > 2.5 && view !== 'back') yaw += dt * .35;
      const V = frameOf(view, ch), want = { ty: V.ty, up: V.up, d: camDist(V, camera.fov, w / h) * 1.06 };
      for (const k of ['up', 'd', 'ty']) cam[k] += (want[k] - cam[k]) * Math.min(1, dt * 6);
      camera.position.set(0, cam.ty + cam.up, cam.d); camera.lookAt(0, cam.ty, 0);
      ch.root.rotation.y = yaw;
      K.animate(ch, walk, dt, t);
      if (walk && ch.R.trail !== 'none' && t - lastTrail > .09) { lastTrail = t; trail.emit(ch.R.trail, -Math.sin(yaw) * .4, 0, -Math.cos(yaw) * .4, t); }
      trail.update(dt);
      if (ch.pet) { const a = yaw + 2.3; ch.pet.position.set(Math.sin(a) * .95, .5 + Math.abs(Math.sin(t * (walk ? 7 : 2.5))) * (walk ? .2 : .06), Math.cos(a) * .95); }
      renderer.render(scene, camera);
    }
    resize();
    raf = requestAnimationFrame(frame);
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    ro?.observe(container);
    window.addEventListener('resize', resize);
    // Картинки вариантов: свой маленький рендерер, по несколько штук за кадр
    let tr = null, tscene = null, tcam = null;
    const queue = [];
    let qBusy = false;
    function thumb(look, key, v, canvas){
      queue.push({ look, key, v, canvas });
      if (!qBusy) { qBusy = true; requestAnimationFrame(pump); }
    }
    function pump(){
      if (dead) return;
      if (!tr) {
        tr = new T.WebGLRenderer({ antialias: true, alpha: true });
        tr.outputEncoding = T.sRGBEncoding;
        tr.setPixelRatio(1);
        tscene = new T.Scene(); K.lights(tscene);
        const f2 = new T.DirectionalLight('#dfe8ff', .22); f2.position.set(30, 20, 30); tscene.add(f2);
        tcam = new T.PerspectiveCamera(30, 1, .1, 60);
      }
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < 14) {
        const j = queue.shift();
        if (!j.canvas.isConnected) continue;
        const size = j.canvas.width;
        tr.setSize(size, size, false);
        const c = K.build(j.look, j.key);
        tscene.add(c.root);
        c.blinkAt = 0; c.phase = 0;
        K.animate(c, false, 0, 0);
        const V = frameOf(j.v, c);
        c.root.rotation.y = V.yaw != null ? V.yaw + .5 : .38;
        tcam.position.set(0, V.ty + V.up, camDist(V, tcam.fov, 1) * 1.04); tcam.lookAt(0, V.ty, 0);
        tr.render(tscene, tcam);
        const g = j.canvas.getContext('2d'); g.clearRect(0, 0, size, size); g.drawImage(tr.domElement, 0, 0, size, size);
        K.dispose(c);
      }
      if (queue.length) requestAnimationFrame(pump); else qBusy = false;
    }
    function dispose(){
      dead = true; cancelAnimationFrame(raf);
      ro?.disconnect(); window.removeEventListener('resize', resize);
      if (ch) K.dispose(ch);
      renderer.dispose(); renderer.forceContextLoss?.(); el.remove();
      if (tr) { tr.dispose(); tr.forceContextLoss?.(); }
    }
    return { set, focus, resize, dispose, thumb, recolor: look => !!ch && K.recolor(ch, look), walk(v){ walk = !!v; if (!walk) trail.clear(); }, get walking(){ return walk; }, emote(e){ if (ch) { ch.emote = e; ch.emoteT = performance.now() / 1000; } }, spin(d){ yaw += d; lastDrag = performance.now() / 1000; }, setYaw(v){ yaw = v; }, auto(v){ auto = !!v; } };
  }

  window.World3D = { supported, load, create, preview, resolve, kit };
})();
