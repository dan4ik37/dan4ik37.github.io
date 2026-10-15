// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — текстуры «Кубомира» кодом: блоки и вещи 16×16 (пиксель-арт без картинок и без Canvas)
// ═══════════════════════════════════════
// V.paint(имя, рисунок) → Uint8Array 16×16×4 (RGBA, sRGB). Рисунок — { k: вид, … }: noise (шум цвета c, сила a), ore (камень
// + пятна c), planks, log, log_top, leaves (дырявые), grass_side, bricks, glass, stripes, checker, dots, gem, ingot, tool
// ({ tool: 'pick'|'axe'|'shovel'|'sword', c: цвет металла }), food, stick, plant, torch, ladder, door. Тот же набор — у модов
// («draw» в mod.json, docs/MODS.md). Шум — от имени текстуры (одинаковый у всех). Ваниль — V.TEX_SPECS.
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const V = E.vox = E.vox || {};
  const N = 16;
  const hx = s => { const m = /^#?([0-9a-f]{6})$/i.exec(String(s || '')); const v = m ? parseInt(m[1], 16) : 0x808080; return [v >> 16 & 255, v >> 8 & 255, v & 255]; };
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : v;
  const shade = (c, k) => [cl(c[0] * k), cl(c[1] * k), cl(c[2] * k)];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const hs = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  function img(){ return new Uint8Array(N * N * 4); }
  function put(d, x, y, c, a = 255){ if (x < 0 || y < 0 || x >= N || y >= N) return; const i = (y * N + x) * 4; d[i] = cl(Math.round(c[0])); d[i + 1] = cl(Math.round(c[1])); d[i + 2] = cl(Math.round(c[2])); d[i + 3] = a; }
  const get = (d, x, y) => { const i = (y * N + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
  // шум пикселя (0…1) — «мягкий»: среднее с соседями
  function noiseMap(seed, soft = .35){
    const r = V.rng ? V.rng(seed) : (() => { let a = seed; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    const raw = new Float32Array(N * N); for (let i = 0; i < N * N; i++) raw[i] = r();
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) s += raw[((y + dy + N) % N) * N + ((x + dx + N) % N)];
      out[y * N + x] = raw[y * N + x] * (1 - soft) + s / 4 * soft;
    }
    return { v: (x, y) => out[((y + N) % N) * N + ((x + N) % N)], r };
  }
  function fillNoise(d, c, a, nm, x0 = 0, y0 = 0, x1 = N, y1 = N){ for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(d, x, y, shade(c, 1 + (nm.v(x, y) - .5) * 2 * a)); }

  const P = {};
  P.noise = (d, s, nm) => fillNoise(d, hx(s.c), s.a ?? .12, nm);
  P.ore = (d, s, nm, name) => {
    if (typeof s.base === 'string' && s.base[0] === '#') fillNoise(d, hx(s.base), .14, nm); else paintInto(d, s.base || 'stone', name);   // основа: цвет (моды) или текстура
    const c = hx(s.c), dk = shade(c, .7), r = nm.r, n = s.n ?? 5;
    for (let k = 0; k < n; k++) {
      const cx = 2 + Math.floor(r() * 12), cy = 2 + Math.floor(r() * 12), sz = 1 + Math.floor(r() * 3);
      for (let i = 0; i < sz + 1; i++) { const x = cx + Math.floor(r() * 3) - 1, y = cy + Math.floor(r() * 3) - 1; put(d, x, y, r() < .35 ? dk : shade(c, .95 + r() * .15)); }
      put(d, cx, cy, shade(c, 1.15));
    }
  };
  P.planks = (d, s, nm) => {
    const c = hx(s.c);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const row = y >> 2, off = (row & 1) * 7, seam = y % 4 === 3 || ((x + off) % 16 === 0);
      put(d, x, y, seam ? shade(c, .62) : shade(c, .9 + nm.v(x, row * 3) * .12 + (((x * 7 + row * 13) % 11) / 11 - .5) * .1));
    }
  };
  P.log = (d, s, nm) => {
    const c = hx(s.c), dk = shade(c, .72);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const stripe = (x * 5 + Math.floor(nm.v(x, 0) * 4)) % 4 === 0, knot = s.birch && nm.v(x, y) > .78;
      put(d, x, y, knot ? hx('#2b2b2b') : stripe ? dk : shade(c, .9 + nm.v(x, y) * .2));
    }
  };
  P.log_top = (d, s, nm) => {
    const bark = hx(s.bark), wood = hx(s.c);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = x - 7.5, dy = y - 7.5, r = Math.max(Math.abs(dx), Math.abs(dy));
      if (r > 6.5) put(d, x, y, shade(bark, .9 + nm.v(x, y) * .2));
      else put(d, x, y, shade(wood, (Math.floor(r) % 2 ? .86 : 1) + nm.v(x, y) * .1));
    }
  };
  P.leaves = (d, s, nm) => {
    const c = hx(s.c || '#bdbdbd');
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = nm.v(x, y);
      if (v < (s.holes ?? .22)) { put(d, x, y, shade(c, .5), 0); continue; }
      put(d, x, y, shade(c, .72 + v * .45));
    }
  };
  P.grass_side = (d, s, nm, name) => {
    paintInto(d, 'dirt', name);
    const g = hx(s.c || '#6aa84f');
    for (let x = 0; x < N; x++) { const h = 3 + Math.floor(nm.v(x, 0) * 3); for (let y = 0; y < h; y++) put(d, x, y, shade(g, .85 + nm.v(x, y) * .3)); }
  };
  P.bricks = (d, s, nm) => {
    const c = hx(s.c), m = hx(s.m || '#cfc8bd');
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const row = y >> 2, off = (row & 1) * 4, mortar = y % 4 === 0 || (x + off) % 8 === 0;
      put(d, x, y, mortar ? shade(m, .9 + nm.v(x, y) * .15) : shade(c, .85 + nm.v(x, y) * .3));
    }
  };
  P.glass = (d, s) => {
    const c = hx(s.c || '#cfeefc');
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const edge = x === 0 || y === 0 || x === N - 1 || y === N - 1, shine = (x - y === 3 || x - y === 4) && x > 3 && x < 10;
      if (edge) put(d, x, y, shade(c, .9)); else if (shine) put(d, x, y, [255, 255, 255], 200); else put(d, x, y, c, 0);
    }
  };
  P.stripes = (d, s, nm) => { const a = hx(s.c), b = hx(s.c2 || '#ffffff'); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) put(d, x, y, shade(((s.vertical ? x : y) >> 1) & 1 ? a : b, .92 + nm.v(x, y) * .16)); };
  P.checker = (d, s, nm) => { const a = hx(s.c), b = hx(s.c2 || '#000000'); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) put(d, x, y, shade(((x >> 2) + (y >> 2)) & 1 ? a : b, .92 + nm.v(x, y) * .16)); };
  P.dots = (d, s, nm) => { fillNoise(d, hx(s.c), .08, nm); const b = hx(s.c2 || '#ffffff'); for (let k = 0; k < (s.n ?? 10); k++) put(d, Math.floor(nm.r() * N), Math.floor(nm.r() * N), b); };
  P.missing = d => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) put(d, x, y, ((x >> 3) + (y >> 3)) & 1 ? [248, 0, 248] : [16, 16, 16]); };
  P.destroy = (d, s, nm) => {   // трещины ломания: стадия 0…7
    const st = s.st | 0, r = V.rng(77);
    for (let i = 0; i < N * N * 4; i += 4) d[i + 3] = 0;
    const lines = 2 + st * 2;
    for (let k = 0; k < lines; k++) {
      let x = 8 + Math.floor((r() - .5) * 6), y = 8 + Math.floor((r() - .5) * 6);
      for (let j = 0; j < 3 + st; j++) { put(d, x, y, [20, 20, 20], 210); x += Math.floor(r() * 3) - 1; y += Math.floor(r() * 3) - 1; }
    }
  };
  // ── предметы (с прозрачным фоном): обводка темнее основного цвета ──
  function outline(d, k = .45){
    const src = d.slice();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (src[(y * N + x) * 4 + 3]) continue;
      let near = null;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; const j = (yy * N + xx) * 4; if (src[j + 3] > 128) { near = [src[j], src[j + 1], src[j + 2]]; break; } }
      if (near) put(d, x, y, shade(near, k));
    }
  }
  function line(d, x0, y0, x1, y1, c, w = 1){
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
    for (let i = 0; i <= n; i++) { const t = i / n, x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t); put(d, x, y, c); if (w > 1) put(d, x + 1, y, c); }
  }
  const STICK = '#7a5a33';
  P.stick = (d, s) => { line(d, 3, 13, 12, 4, hx(s.c || STICK)); line(d, 4, 13, 13, 4, shade(hx(s.c || STICK), .75)); outline(d); };
  P.tool = (d, s) => {
    const m = hx(s.c), lt = shade(m, 1.25), dk = shade(m, .72), st = hx(STICK);
    const handle = (x0, y0, x1, y1) => { line(d, x0, y0, x1, y1, st); line(d, x0 + 1, y0, x1 + 1, y1, shade(st, .78)); };
    if (s.tool === 'sword') {
      handle(2, 13, 4, 11);
      for (let i = 0; i < 9; i++) { put(d, 5 + i, 10 - i, i < 8 ? m : lt); put(d, 6 + i, 10 - i, dk); put(d, 5 + i, 9 - i, lt); }
      line(d, 3, 9, 7, 13, shade(st, .9)); put(d, 1, 14, dk);
    } else if (s.tool === 'pick') {
      handle(2, 13, 9, 6);
      const pts = [[4, 2], [5, 2], [6, 2], [7, 2], [8, 3], [9, 3], [10, 4], [11, 4], [12, 5], [12, 6], [13, 7], [13, 8], [13, 9], [13, 10], [13, 11]];
      for (const [x, y] of pts) { put(d, x, y, m); put(d, x, y + 1, dk); }
      for (const [x, y] of pts.slice(2, 9)) put(d, x - 1, y - 0, lt);
    } else if (s.tool === 'axe') {
      handle(2, 13, 9, 6);
      for (let y = 2; y < 9; y++) for (let x = 8; x < 14; x++) { const dx = x - 9, dy = y - 4; if (dx + dy >= -2 && dx - dy <= 4 && dx * dx + dy * dy <= 22) put(d, x, y, y < 4 ? lt : x > 11 ? dk : m); }
    } else {   // shovel
      handle(2, 13, 8, 7);
      for (let y = 2; y < 9; y++) for (let x = 7; x < 14; x++) { const dx = x - 10.5, dy = y - 5.5; if (Math.abs(dx + dy) <= 3.2 && Math.abs(dx - dy) <= 2.6) put(d, x, y, dx - dy > 1 ? dk : dx + dy < -1.5 ? lt : m); }
    }
    outline(d);
  };
  P.ingot = (d, s) => { const c = hx(s.c), lt = shade(c, 1.2), dk = shade(c, .7); for (let y = 6; y < 11; y++) for (let x = 2 + (10 - y) * 0; x < 14; x++) { const top = y === 6, edge = x === 2 || x === 13 || y === 10; if ((x < 3 || x > 12) && (y === 6)) continue; put(d, x, y, top ? lt : edge ? dk : c); } outline(d); };
  P.gem = (d, s) => {
    const c = hx(s.c), lt = shade(c, 1.35), dk = shade(c, .65);
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) { const dx = Math.abs(x - 7.5), dy = y - 3; if (dy < 3 ? dx <= 2 + dy : dx <= 4.5 - (dy - 3) * .7) put(d, x, y, dy < 3 ? lt : x < 8 ? c : dk); }
    put(d, 6, 5, [255, 255, 255]); outline(d);
  };
  P.lump = (d, s, nm) => { const c = hx(s.c); for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) { const dx = x - 7.5, dy = y - 8, r = Math.hypot(dx, dy * 1.15); if (r < 4.8 + nm.v(x, y) * 1.2) put(d, x, y, shade(c, .8 + nm.v(x, y) * .5)); } outline(d); };
  P.food = (d, s, nm) => {
    const c = hx(s.c), dk = shade(c, .7), b = s.bone ? hx('#efe6d2') : null;
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) { const dx = x - 7, dy = y - 8, r = Math.hypot(dx * 1.1, dy); if (r < 5.2) put(d, x, y, r > 4 ? dk : shade(c, .9 + nm.v(x, y) * .25)); }
    if (b) { line(d, 10, 5, 13, 2, b); put(d, 13, 1, b); put(d, 14, 2, b); }
    if (s.leaf) { put(d, 8, 2, hx('#3d8b37')); put(d, 9, 1, hx('#3d8b37')); put(d, 7, 2, hx('#5a3a1e')); }
    outline(d);
  };
  P.feather = d => { const w = hx('#f2f2f2'); line(d, 3, 13, 12, 3, hx('#9a9a9a')); for (let i = 0; i < 8; i++) { put(d, 5 + i, 10 - i, w); put(d, 6 + i, 11 - i, shade(w, .85)); put(d, 4 + i, 10 - i, shade(w, .92)); } outline(d); };
  P.plant = (d, s, nm) => {
    const stem = hx(s.stem || '#3f8f3a');
    for (let i = 0; i < N * N * 4; i += 4) d[i + 3] = 0;
    if (s.flower) {
      line(d, 7, 15, 7, 7, stem); put(d, 6, 11, stem); put(d, 5, 10, stem); put(d, 8, 12, stem); put(d, 9, 11, stem);
      const f = hx(s.flower), c2 = hx(s.center || '#f5d33d');
      for (const [x, y] of [[7, 3], [6, 4], [8, 4], [5, 5], [9, 5], [6, 6], [8, 6], [7, 6], [6, 5], [8, 5], [7, 4]]) put(d, x, y, f);
      put(d, 7, 5, c2);
    } else if (s.bush) {
      const c = hx(s.c || '#8a6a3a');
      line(d, 7, 15, 7, 8, c); line(d, 7, 11, 3, 6, c); line(d, 8, 10, 12, 5, c); line(d, 7, 9, 5, 3, c); line(d, 8, 12, 11, 9, c);
    } else if (s.sapling) {
      const c = hx(s.c || '#3f8f3a');
      line(d, 7, 15, 7, 8, hx('#6b4a2b'));
      for (let y = 3; y < 11; y++) for (let x = 3; x < 13; x++) { const v = nm.v(x, y), r = Math.hypot(x - 7.5, y - 6.5); if (r < 4.5 && v > .3) put(d, x, y, shade(c, .8 + v * .4)); }
    } else {   // трава
      const c = hx(s.c || '#bdbdbd');
      for (let k = 0; k < 9; k++) { const x0 = 1 + Math.floor(nm.r() * 14), h = 5 + Math.floor(nm.r() * 9), lean = nm.r() < .5 ? -1 : 1; for (let j = 0; j < h; j++) put(d, x0 + (j > h * .6 ? lean : 0), 15 - j, shade(c, .7 + j / h * .45)); }
    }
  };
  P.torch = d => {
    for (let i = 0; i < N * N * 4; i += 4) d[i + 3] = 0;
    for (let y = 6; y < 16; y++) { put(d, 7, y, hx('#7a5a33')); put(d, 8, y, hx('#5e4426')); }
    put(d, 7, 5, hx('#ffd84a')); put(d, 8, 5, hx('#ffb02e')); put(d, 7, 4, hx('#fff2a8')); put(d, 8, 4, hx('#ffd84a')); put(d, 7, 6, hx('#ff8a1f')); put(d, 8, 6, hx('#ff8a1f'));
  };
  P.ladder = d => {
    for (let i = 0; i < N * N * 4; i += 4) d[i + 3] = 0;
    const w = hx('#8a6a3a'), dk = hx('#5e4426');
    for (let y = 0; y < N; y++) { put(d, 2, y, w); put(d, 3, y, dk); put(d, 12, y, w); put(d, 13, y, dk); }
    for (const y of [2, 6, 10, 14]) for (let x = 4; x < 12; x++) { put(d, x, y, w); put(d, x, y + 1, dk); }
  };
  P.door = (d, s, nm) => {
    const c = hx('#9c7a4a');
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const frame = x < 2 || x > 13 || y < 2 || (s.top ? false : y > 13), pane = s.top && x > 3 && x < 12 && y > 3 && y < 12;
      if (pane) { put(d, x, y, hx('#bfe7ff'), (x + y) % 5 === 0 ? 220 : 0); continue; }
      put(d, x, y, frame ? shade(c, .75) : shade(c, .92 + nm.v(x, y) * .14));
    }
    if (!s.top) { put(d, 12, 2, hx('#3a3a3a')); put(d, 12, 3, hx('#3a3a3a')); }
  };
  P.table = (d, s, nm, name) => {
    paintInto(d, 'planks_oak', name);
    const dk = hx('#4a3520');
    if (s.part === 'top') { for (let i = 0; i < N; i++) { put(d, i, 0, dk); put(d, i, 15, dk); put(d, 0, i, dk); put(d, 15, i, dk); } for (let i = 3; i < 13; i++) { put(d, i, 7, shade(dk, 1.3)); put(d, 7, i, shade(dk, 1.3)); } }
    else { for (let x = 0; x < N; x++) { put(d, x, 0, dk); put(d, x, 1, shade(dk, 1.4)); } if (s.part === 'front') { line(d, 3, 4, 3, 12, hx('#8a8a8a')); line(d, 11, 5, 12, 12, hx('#7a5a33')); put(d, 10, 4, hx('#9a9a9a')); put(d, 11, 4, hx('#9a9a9a')); put(d, 12, 4, hx('#9a9a9a')); } }
  };
  P.furnace = (d, s, nm, name) => {
    paintInto(d, 'cobble', name);
    if (s.part === 'front') {
      for (let y = 7; y < 14; y++) for (let x = 3; x < 13; x++) put(d, x, y, s.lit ? (y > 10 ? hx('#ffb02e') : hx('#ff7a1f')) : hx('#2a2a2a'));
      for (let x = 3; x < 13; x++) put(d, x, 6, hx('#5a5a5a'));
      if (s.lit) for (let k = 0; k < 6; k++) put(d, 4 + Math.floor(nm.r() * 8), 9 + Math.floor(nm.r() * 4), hx('#ffe27a'));
    } else if (s.part === 'top') { for (let i = 2; i < 14; i++) { put(d, i, 2, hx('#5a5a5a')); put(d, i, 13, hx('#5a5a5a')); } }
  };
  P.chest = (d, s, nm, name) => {
    paintInto(d, 'planks_oak', name);
    const dk = hx('#4a3520');
    for (let i = 0; i < N; i++) { put(d, i, 0, dk); put(d, i, 15, dk); put(d, 0, i, dk); put(d, 15, i, dk); }
    if (s.part !== 'top') for (let x = 0; x < N; x++) put(d, x, 6, dk);
    if (s.part === 'front') { for (let y = 5; y < 9; y++) for (let x = 7; x < 9; x++) put(d, x, y, hx('#c9c9c9')); put(d, 7, 8, hx('#7a7a7a')); }
  };
  P.liquid = (d, s, nm) => {
    const c = hx(s.c);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const w = Math.sin((x + y * .6) * .9 + nm.v(x, y) * 2) * .5 + .5; put(d, x, y, shade(c, .85 + w * .2 + nm.v(x, y) * .1), s.alpha ?? 255); }
  };
  P.lamp = (d, s, nm) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const edge = x < 1 || y < 1 || x > 14 || y > 14, cr = (x === 7 || x === 8 || y === 7 || y === 8); put(d, x, y, edge ? hx('#8a6a3a') : cr ? hx('#ffe9a8') : shade(hx('#ffd36a'), .9 + nm.v(x, y) * .2)); }
  };

  // булыжник: неровные камни (ячейки Вороного) и тёмные швы
  P.cobble = (d, s, nm) => {
    const c = hx(s.c || '#7a7a7d'), m = shade(hx(s.m || '#55555a'), 1), r = V.rng(hs(s.c || 'c') ^ 99), pts = [];
    for (let k = 0; k < 9; k++) pts.push([r() * N, r() * N, .85 + r() * .3]);
    const moss = s.moss ? hx(s.moss) : null;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let a = 1e9, b = 1e9, k0 = 0;
      for (let k = 0; k < pts.length; k++) for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { const dd = Math.hypot(x + .5 - pts[k][0] - ox, y + .5 - pts[k][1] - oy); if (dd < a) { b = a; a = dd; k0 = k; } else if (dd < b) b = dd; }
      if (b - a < 1.1) put(d, x, y, shade(m, .9 + nm.v(x, y) * .2));
      else put(d, x, y, moss && nm.v(x * 3, y * 2) > .62 ? shade(moss, .85 + nm.v(x, y) * .3) : shade(c, pts[k0][2] * (.9 + nm.v(x, y) * .2) * (1.08 - a / 9)));
    }
  };
  const SPRITE = new Set(['stick', 'tool', 'ingot', 'gem', 'lump', 'food', 'feather', 'plant', 'torch', 'ladder', 'destroy']);
  // Ваниль: имя → рисунок (цвета — свои; никаких чужих картинок)
  const S = V.TEX_SPECS = {
    stone: { k: 'noise', c: '#7d7d80', a: .14 }, cobble: { k: 'cobble', c: '#808083', m: '#4e4e52' }, dirt: { k: 'noise', c: '#7a5634', a: .18 },
    grass_top: { k: 'noise', c: '#c4c4c4', a: .14 }, grass_side: { k: 'grass_side', c: '#5f9e44' }, sand: { k: 'noise', c: '#ddd09a', a: .08 },
    gravel: { k: 'noise', c: '#8a8580', a: .3 }, bedrock: { k: 'noise', c: '#3c3c3e', a: .55 },
    water: { k: 'liquid', c: '#c8d8ec', alpha: 190 }, lava: { k: 'liquid', c: '#e6611a' },
    log_oak: { k: 'log', c: '#6b4f2c' }, log_oak_top: { k: 'log_top', c: '#b08a52', bark: '#6b4f2c' }, leaves_oak: { k: 'leaves', c: '#c0c0c0' }, planks_oak: { k: 'planks', c: '#a8834e' },
    log_birch: { k: 'log', c: '#e7e2d6', birch: true }, log_birch_top: { k: 'log_top', c: '#d4c191', bark: '#e7e2d6' }, leaves_birch: { k: 'leaves', c: '#c8c8c8', holes: .18 }, planks_birch: { k: 'planks', c: '#cdb57c' },
    log_spruce: { k: 'log', c: '#4b3520' }, log_spruce_top: { k: 'log_top', c: '#8a6a3e', bark: '#4b3520' }, leaves_spruce: { k: 'leaves', c: '#b0b0b0', holes: .14 }, planks_spruce: { k: 'planks', c: '#7a5a34' },
    sandstone: { k: 'stripes', c: '#d9c88f', c2: '#e2d39d' }, sandstone_top: { k: 'noise', c: '#e2d39d', a: .06 }, snow: { k: 'noise', c: '#f4f8fc', a: .04 },
    snow_grass_side: { k: 'grass_side', c: '#f4f8fc' }, ice: { k: 'noise', c: '#a5c8f2', a: .06 }, clay: { k: 'noise', c: '#a3a8b6', a: .06 },
    ore_coal: { k: 'ore', c: '#242424', n: 6 }, ore_iron: { k: 'ore', c: '#d8a985', n: 5 }, ore_gold: { k: 'ore', c: '#f5d33d', n: 5 }, ore_diamond: { k: 'ore', c: '#5ff0e6', n: 4 },
    glass: { k: 'glass' }, cactus_side: { k: 'stripes', c: '#3f8a2f', c2: '#4ea23a', vertical: true }, cactus_top: { k: 'noise', c: '#5aa646', a: .1 },
    tall_grass: { k: 'plant', c: '#bdbdbd' }, flower_yellow: { k: 'plant', flower: '#f5d33d', center: '#e09a1a' }, flower_red: { k: 'plant', flower: '#e0302e', center: '#2a2a2a' },
    dead_bush: { k: 'plant', bush: true }, sapling_oak: { k: 'plant', sapling: true, c: '#4e9a3a' }, sapling_birch: { k: 'plant', sapling: true, c: '#7fb85a' }, sapling_spruce: { k: 'plant', sapling: true, c: '#2f6b3a' },
    torch: { k: 'torch' }, table_top: { k: 'table', part: 'top' }, table_side: { k: 'table', part: 'side' }, table_front: { k: 'table', part: 'front' },
    furnace_side: { k: 'furnace', part: 'side' }, furnace_front: { k: 'furnace', part: 'front' }, furnace_front_lit: { k: 'furnace', part: 'front', lit: true }, furnace_top: { k: 'furnace', part: 'top' },
    chest_side: { k: 'chest', part: 'side' }, chest_front: { k: 'chest', part: 'front' }, chest_top: { k: 'chest', part: 'top' },
    ladder: { k: 'ladder' }, door_bottom: { k: 'door' }, door_top: { k: 'door', top: true },
    bricks: { k: 'bricks', c: '#a4523c', m: '#cbbfb0' }, stone_bricks: { k: 'bricks', c: '#86868a', m: '#66666a' }, lamp: { k: 'lamp' }, obsidian: { k: 'noise', c: '#22172f', a: .35 },
    iron_block: { k: 'checker', c: '#dadada', c2: '#c4c4c4' }, gold_block: { k: 'checker', c: '#f6d04d', c2: '#e6b830' }, diamond_block: { k: 'checker', c: '#6ff2e6', c2: '#4fd9cc' },
    mossy_cobble: { k: 'cobble', c: '#7d807b', m: '#4e4e52', moss: '#4f7a3a' }, missing: { k: 'missing' }, bouncer: { k: 'checker', c: '#7bd36a', c2: '#62bd52' },
    item_stick: { k: 'stick' }, item_coal: { k: 'lump', c: '#2a2a2a' }, item_iron_ingot: { k: 'ingot', c: '#d6d6d6' }, item_gold_ingot: { k: 'ingot', c: '#f2c94c' },
    item_diamond: { k: 'gem', c: '#4fe3d6' }, item_clay_ball: { k: 'lump', c: '#a3a8b6' }, item_brick: { k: 'ingot', c: '#a4523c' },
    item_apple: { k: 'food', c: '#d8302a', leaf: true }, item_meat_raw: { k: 'food', c: '#d9605a', bone: true }, item_meat_cooked: { k: 'food', c: '#8a4a22', bone: true },
    item_chicken_raw: { k: 'food', c: '#f0c2a8', bone: true }, item_chicken_cooked: { k: 'food', c: '#c8843a', bone: true }, item_feather: { k: 'feather' },
    item_slime_ball: { k: 'lump', c: '#7bd36a' }, item_door: { k: 'door' },
  };
  for (let i = 0; i < 8; i++) S['destroy_' + i] = { k: 'destroy', st: i };
  for (const [m, M] of Object.entries(V.TOOL_MATS || {})) for (const k of ['pick', 'axe', 'shovel', 'sword']) S[`item_${k}_${m}`] = { k: 'tool', tool: k, c: M.color };

  // Нарисовать в d (основа другой текстуры: руда на камне, дёрн на земле)
  function paintInto(d, name, owner){
    const spec = S[name] || V.tex[V.texIdx?.get(name)]?.spec || { k: 'noise', c: '#808080' };
    const nm = noiseMap(hs(name));
    if (spec.rgba && spec.rgba.length === N * N * 4) { d.set(spec.rgba); return; }   // картинка мода
    for (let i = 0; i < N * N * 4; i += 4) d[i + 3] = 255;
    (P[spec.k] || P.noise)(d, spec, nm, owner || name);
  }
  // Рисунок → RGBA. spec — свой (мод) или ваниль по имени
  V.paint = (name, spec) => {
    const d = img();
    const s = spec || S[name];
    if (!s) { P.missing(d); return d; }
    if (s.rgba && s.rgba.length === N * N * 4) { d.set(s.rgba); return d; }   // уже готовые пиксели (PNG мода)
    const a0 = SPRITE.has(s.k) ? 0 : 255;
    for (let i = 0; i < N * N * 4; i += 4) d[i + 3] = a0;
    const nm = noiseMap(hs(name) ^ (s.seed | 0));
    try { (P[s.k] || P.noise)(d, s, nm, name); } catch (e) { P.missing(d); }
    return d;
  };
  V.PAINTERS = Object.keys(P);
  V.paintAll = () => V.tex.map(t => V.paint(t.name, t.spec || S[t.name]));
})();
