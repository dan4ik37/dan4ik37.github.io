// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — текстуры «Кубомира» кодом: блоки 32×32, вещи — пиксель-арт 16×16 (увеличены вдвое), без картинок и Canvas
// ═══════════════════════════════════════
// V.paint(имя, рисунок) → Uint8Array V.TEX×V.TEX×4 (RGBA, sRGB). Рисунок — { k: вид, … }: noise (шум цвета c, сила a), stone, dirt,
// sand, gravel, grass_top, ore (камень + пятна c), planks, log, log_top, leaves (дырявые), grass_side, bricks, glass, stripes,
// checker, dots, cobble, liquid, lamp, gem, ingot, tool ({ tool: 'pick'|'axe'|'shovel'|'sword', c: цвет металла }), food, stick,
// plant, torch, ladder, door. Тот же набор — у модов («draw» в mod.json, docs/MODS.md). Шум — от имени текстуры (одинаковый у
// всех). Ваниль — V.TEX_SPECS. Поверхности блоков рисуются в 32×32 (мельче шум, фаски, швы, блики), вещи и растения — в 16×16
// и увеличиваются без сглаживания (чёткий пиксель-арт). Готовые пиксели (PNG мода, пакет текстур) — 16×16 или 32×32.
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const V = E.vox = E.vox || {};
  const TS = V.TEX = 32;          // размер слоя текстуры
  let N = TS, K = N / 16;         // размер текущего рисунка и масштаб относительно 16
  const hx = s => { const m = /^#?([0-9a-f]{6})$/i.exec(String(s || '')); const v = m ? parseInt(m[1], 16) : 0x808080; return [v >> 16 & 255, v >> 8 & 255, v & 255]; };
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : v;
  const shade = (c, k) => [cl(c[0] * k), cl(c[1] * k), cl(c[2] * k)];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  // лёгкий сдвиг оттенка (t 0…1: холоднее ↔ теплее) — «живой» цвет без смены основного тона
  const warm = (c, t, s = 10) => [cl(c[0] + (t - .5) * s), c[1], cl(c[2] - (t - .5) * s)];
  const hs = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const img = () => new Uint8Array(N * N * 4);
  function put(d, x, y, c, a = 255){ if (x < 0 || y < 0 || x >= N || y >= N) return; const i = (y * N + x) * 4; d[i] = cl(Math.round(c[0])); d[i + 1] = cl(Math.round(c[1])); d[i + 2] = cl(Math.round(c[2])); d[i + 3] = a; }
  const get = (d, x, y) => { x = (x + N) % N; y = (y + N) % N; const i = (y * N + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
  // увеличить без сглаживания (16 → 32): вещи, растения, картинки модов
  function upscale(src, from, to){
    const out = new Uint8Array(to * to * 4), k = to / from;
    for (let y = 0; y < to; y++) for (let x = 0; x < to; x++) { const si = ((Math.floor(y / k)) * from + Math.floor(x / k)) * 4, di = (y * to + x) * 4; out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3]; }
    return out;
  }
  V.texUpscale = upscale;
  // шум: v — мелкий (пиксели, чуть сглажен), c — крупный (пятна в 1/4 рисунка, плавно, бесшовно), r — генератор
  function noiseMap(seed, soft = .35){
    const r = V.rng ? V.rng(seed) : (() => { let a = seed; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    const raw = new Float32Array(N * N); for (let i = 0; i < N * N; i++) raw[i] = r();
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) s += raw[((y + dy + N) % N) * N + ((x + dx + N) % N)];
      out[y * N + x] = raw[y * N + x] * (1 - soft) + s / 4 * soft;
    }
    const G = 4, g = new Float32Array(G * G); for (let i = 0; i < G * G; i++) g[i] = r();
    const sm = t => t * t * (3 - 2 * t);
    const coarse = (x, y) => {
      const fx = ((x + .5) / N * G) % G, fy = ((y + .5) / N * G) % G, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
      const at = (i, j) => g[((j + G) % G) * G + ((i + G) % G)];
      return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    };
    return { v: (x, y) => out[((y % N + N) % N) * N + ((x % N + N) % N)], c: (x, y) => coarse(((x % N) + N) % N, ((y % N) + N) % N), r };
  }
  // цвет с двумя слоями шума (мелкий + крупные пятна) и лёгким сдвигом оттенка
  const tone = (c, a, nm, x, y, hue = 8) => warm(shade(c, 1 + ((nm.v(x, y) - .5) * .8 + (nm.c(x, y) - .5) * .7) * 2 * a), nm.c(x + 7, y + 3), hue);
  function fillNoise(d, c, a, nm, x0 = 0, y0 = 0, x1 = N, y1 = N){ for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(d, x, y, tone(c, a, nm, x, y)); }
  // крапинки: n штук размером 1…sz (в пикселях 16-сетки), светлее или темнее
  function specks(d, nm, n, c, k, sz = 1){ for (let i = 0; i < n; i++) { const x = Math.floor(nm.r() * N), y = Math.floor(nm.r() * N), w = Math.max(1, Math.round((1 + Math.floor(nm.r() * sz)) * K / 2)); for (let yy = 0; yy < w; yy++) for (let xx = 0; xx < w; xx++) { const p = get(d, x + xx, y + yy); put(d, (x + xx) % N, (y + yy) % N, c ? shade(c, k) : shade(p, k)); } } }

  const P = {};
  P.noise = (d, s, nm) => fillNoise(d, hx(s.c), s.a ?? .12, nm);
  // камень: пятна, тёмные трещинки и светлые крапинки
  P.stone = (d, s, nm) => {
    const c = hx(s.c || '#7d7d80');
    fillNoise(d, c, s.a ?? .12, nm);
    for (let k = 0; k < (s.cracks ?? 5); k++) {   // короткие трещины
      let x = Math.floor(nm.r() * N), y = Math.floor(nm.r() * N); const len = 3 + Math.floor(nm.r() * 5 * K), dx = nm.r() < .5 ? 1 : -1;
      for (let j = 0; j < len; j++) { const p = get(d, x, y); put(d, (x + N) % N, (y + N) % N, shade(p, .72)); x += nm.r() < .6 ? dx : 0; y += nm.r() < .55 ? 1 : 0; }
    }
    specks(d, nm, 10 * K, null, 1.14, 2); specks(d, nm, 8 * K, null, .82, 2);
  };
  // земля: комья (крупные пятна), камушки и корешки
  P.dirt = (d, s, nm) => {
    const c = hx(s.c || '#7a5634');
    fillNoise(d, c, s.a ?? .16, nm);
    specks(d, nm, 9 * K, hx('#a08562'), 1, 2); specks(d, nm, 12 * K, null, .74, 2);
  };
  // песок: мелкое зерно, редкие тёмные и светлые песчинки
  P.sand = (d, s, nm) => {
    const c = hx(s.c || '#ddd09a');
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) put(d, x, y, warm(shade(c, 1 + (nm.v(x, y) - .5) * .16 + (nm.c(x, y) - .5) * .08), nm.c(x, y), 6));
    specks(d, nm, 14 * K, null, .86); specks(d, nm, 8 * K, null, 1.08);
  };
  // гравий: камешки разных оттенков (ячейки) и тёмные щели
  P.gravel = (d, s, nm) => {
    const c = hx(s.c || '#8a8580'), r = nm.r, pts = [];
    for (let k = 0; k < Math.round(16 * K); k++) pts.push([r() * N, r() * N, .7 + r() * .55, r()]);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let a = 1e9, b = 1e9, k0 = 0;
      for (let k = 0; k < pts.length; k++) for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { const dd = Math.hypot(x + .5 - pts[k][0] - ox, y + .5 - pts[k][1] - oy); if (dd < a) { b = a; a = dd; k0 = k; } else if (dd < b) b = dd; }
      const pt = pts[k0], base = warm(c, pt[3], 26);
      put(d, x, y, b - a < .9 * K ? shade(c, .5) : shade(base, pt[2] * (.92 + nm.v(x, y) * .16) * (1.1 - a / (6 * K) * .25)));
    }
  };
  // верх травы (серый — цвет даёт биом): травинки — короткие светлые и тёмные штрихи
  P.grass_top = (d, s, nm) => {
    const c = hx(s.c || '#c4c4c4');
    fillNoise(d, c, s.a ?? .12, nm);
    for (let k = 0; k < 26 * K; k++) { const x = Math.floor(nm.r() * N), y = Math.floor(nm.r() * N), L = 1 + Math.floor(nm.r() * 2 * K), lt = nm.r() < .5 ? 1.16 : .8; for (let j = 0; j < L; j++) { const p = get(d, x, y - j); put(d, x, (y - j + N) % N, shade(p, lt)); } }
  };
  P.ore = (d, s, nm, name) => {
    if (typeof s.base === 'string' && s.base[0] === '#') fillNoise(d, hx(s.base), .14, nm); else paintInto(d, s.base || 'stone', name);   // основа: цвет (моды) или текстура
    const c = hx(s.c), dk = shade(c, .66), lt = shade(c, 1.25), r = nm.r, n = s.n ?? 5;
    // жила: 2–3 мелких кусочка рядом (неровно), у каждого — тёмный край и светлый верх-слева
    for (let k = 0; k < n; k++) {
      const cx0 = Math.floor((2 + r() * 12) * K), cy0 = Math.floor((2 + r() * 12) * K), parts = 2 + Math.floor(r() * 2);
      for (let q = 0; q < parts; q++) {
        const cx = cx0 + Math.round((r() - .5) * 3 * K), cy = cy0 + Math.round((r() - .5) * 3 * K), sz = (.7 + r() * .8) * K;
        for (let yy = -Math.ceil(sz); yy <= Math.ceil(sz); yy++) for (let xx = -Math.ceil(sz); xx <= Math.ceil(sz); xx++) {
          const rr = Math.hypot(xx, yy * 1.15) + (nm.v(cx + xx, cy + yy) - .5) * 1.2;
          if (rr > sz) continue;
          const edge = rr > sz - .9, hl = xx + yy < -sz * .5;
          put(d, cx + xx, cy + yy, edge ? dk : hl ? lt : shade(c, .9 + r() * .16));
        }
      }
      put(d, cx0 - 1, cy0 - 1, shade(c, 1.45));   // искорка
    }
  };
  // доски: ряды по 4 пикселя (16-сетка), волокна вдоль, тёмный шов и светлая фаска, гвоздики у стыков
  P.planks = (d, s, nm) => {
    const c = hx(s.c), H = 4 * K;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const row = Math.floor(y / H), off = (row & 1) * Math.round(7 * K), yi = y % H, xs = (x + off) % N;
      const seam = yi === H - 1 || xs === 0, bevel = yi === 0 || xs === 1;
      const grain = Math.sin((x + off) * .55 / K + nm.v(x >> 1, row * 3) * 5 + row * 1.7) * .5 + .5;
      if (seam) { put(d, x, y, shade(c, .55)); continue; }
      put(d, x, y, warm(shade(c, (bevel ? 1.1 : .9) + grain * .1 + (nm.v(x, y) - .5) * .08 + (((x * 7 + row * 13) % 11) / 11 - .5) * .06), nm.c(x, row * H), 8));
    }
    for (let row = 0; row < N / H; row++) { const off = (row & 1) * Math.round(7 * K), xs = (N - off + 2) % N, y = row * H + Math.floor(H / 2) - 1; put(d, xs, y, shade(c, .5)); }
  };
  // кора: вертикальные борозды, тёмные трещины; у берёзы — светлая с тёмными чёрточками
  P.log = (d, s, nm) => {
    const c = hx(s.c), dk = shade(c, .66);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const ridge = Math.sin(x * 1.25 / K + nm.v(x, y >> 2) * 2.2) * .5 + .5, crack = !s.birch && ridge < .14 && nm.v(x, y) > .3;
      put(d, x, y, crack ? dk : shade(c, .84 + ridge * .18 + (nm.v(x, y) - .5) * .12));
    }
    if (s.birch) for (let k = 0; k < 7 * K; k++) { const x = Math.floor(nm.r() * N), y = Math.floor(nm.r() * N), L = Math.round((2 + nm.r() * 3) * K); for (let j = 0; j < L; j++) { put(d, (x + j) % N, y, hx('#2b2b2b')); if (K > 1) put(d, (x + j) % N, (y + 1) % N, hx('#555555')); } }
  };
  P.log_top = (d, s, nm) => {
    const bark = hx(s.bark), wood = hx(s.c), m = (N - 1) / 2;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = x - m, dy = y - m, r = Math.max(Math.abs(dx), Math.abs(dy)) * .7 + Math.hypot(dx, dy) * .3;
      if (r > m - 1.1 * K) put(d, x, y, shade(bark, .86 + nm.v(x, y) * .22));
      else put(d, x, y, shade(wood, ((Math.floor(r / K + nm.v(x, y) * .6) % 2) ? .84 : 1) + nm.v(x, y) * .08 + (r < K ? -.1 : 0)));
    }
  };
  // листва: дырявая; светлый верх у листочков, тёмный низ — объём
  P.leaves = (d, s, nm) => {
    const c = hx(s.c || '#bdbdbd');
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = nm.v(x, y), q = nm.c(x, y);
      if (v * .7 + q * .3 < (s.holes ?? .22) + .06) { put(d, x, y, shade(c, .45), 0); continue; }
      const up = nm.v(x, y - 1) - v;
      put(d, x, y, shade(c, .66 + v * .38 + q * .12 + (up < -.12 ? .12 : up > .12 ? -.12 : 0)));
    }
  };
  P.grass_side = (d, s, nm, name) => {
    paintInto(d, 'dirt', name);
    const g = hx(s.c || '#6aa84f');
    for (let x = 0; x < N; x++) {
      const h = Math.round((3 + nm.c(x, 0) * 2 + nm.v(x, 0) * 1.5) * K);
      for (let y = 0; y < h; y++) put(d, x, y, shade(g, .82 + nm.v(x, y) * .26 + (y === h - 1 ? -.18 : 0)));
      if (nm.v(x, 3) > .7) for (let y = h; y < h + K * 2 && y < N; y++) put(d, x, y, shade(g, .72));   // капли дёрна
      put(d, x, Math.min(N - 1, h + (nm.v(x, 3) > .7 ? K * 2 : 0)), shade(get(d, x, Math.min(N - 1, h + 1)), .78));   // тень под дёрном
    }
  };
  // кирпичи: фаска (свет сверху-слева, тень снизу-справа), у каждого кирпича свой оттенок
  P.bricks = (d, s, nm) => {
    const c = hx(s.c), m = hx(s.m || '#cfc8bd'), H = 4 * K, W = 8 * K;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const row = Math.floor(y / H), off = (row & 1) * 4 * K, xs = (x + off) % W, ys = y % H, mortar = ys < K || xs < K;
      if (mortar) { put(d, x, y, shade(m, .86 + nm.v(x, y) * .16)); continue; }
      const id = row * 7 + Math.floor((x + off) / W) * 3, tint = ((id * 37) % 11) / 11;
      const hl = ys === K || xs === K, sh = ys === H - 1 || xs === W - 1;
      put(d, x, y, warm(shade(c, (hl ? 1.12 : sh ? .78 : .9) + tint * .14 + (nm.v(x, y) - .5) * .14), tint, 14));
    }
  };
  P.glass = (d, s) => {
    const c = hx(s.c || '#cfeefc'), w = Math.max(1, K);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const edge = x < w || y < w || x >= N - w || y >= N - w, corner = (x < 2 * w || x >= N - 2 * w) && (y < 2 * w || y >= N - 2 * w);
      const shine = ((x - y >= 3 * K && x - y < 4.5 * K) || (x - y >= 6 * K && x - y < 6.6 * K)) && x > 3 * K && x < 11 * K;
      if (edge) put(d, x, y, shade(c, corner ? .78 : .92)); else if (shine) put(d, x, y, [255, 255, 255], 200); else put(d, x, y, c, 0);
    }
  };
  P.stripes = (d, s, nm) => { const a = hx(s.c), b = hx(s.c2 || '#ffffff'); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) put(d, x, y, shade(Math.floor((s.vertical ? x : y) / (2 * K)) & 1 ? a : b, .9 + nm.v(x, y) * .14 + (nm.c(x, y) - .5) * .08)); };
  // клетка (блоки металлов): у каждой клетки фаска — свет сверху, тень снизу
  P.checker = (d, s, nm) => {
    const a = hx(s.c), b = hx(s.c2 || '#000000'), Q = 4 * K;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const xi = x % Q, yi = y % Q, base = (Math.floor(x / Q) + Math.floor(y / Q)) & 1 ? a : b;
      put(d, x, y, shade(base, (yi === 0 || xi === 0 ? 1.12 : yi === Q - 1 || xi === Q - 1 ? .82 : .95) + nm.v(x, y) * .1));
    }
  };
  P.dots = (d, s, nm) => { fillNoise(d, hx(s.c), .08, nm); const b = hx(s.c2 || '#ffffff'); for (let k = 0; k < (s.n ?? 10); k++) { const x = Math.floor(nm.r() * N), y = Math.floor(nm.r() * N); for (let yy = 0; yy < K; yy++) for (let xx = 0; xx < K; xx++) put(d, x + xx, y + yy, b); } };
  P.missing = d => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) put(d, x, y, (Math.floor(x / (8 * K)) + Math.floor(y / (8 * K))) & 1 ? [248, 0, 248] : [16, 16, 16]); };
  P.destroy = (d, s) => {   // трещины ломания: стадия 0…7
    const st = s.st | 0, r = V.rng(77);
    for (let i = 0; i < N * N * 4; i += 4) d[i + 3] = 0;
    const lines = 2 + st * 2;
    for (let k = 0; k < lines; k++) {
      let x = N / 2 + Math.floor((r() - .5) * 6 * K), y = N / 2 + Math.floor((r() - .5) * 6 * K);
      for (let j = 0; j < (3 + st) * K; j++) { put(d, x, y, [20, 20, 20], 210); if (K > 1 && j % 2) put(d, x + 1, y, [40, 40, 40], 150); x += Math.floor(r() * 3) - 1; y += Math.floor(r() * 3) - 1; }
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
  // ── инструменты 32×32 (pixel art, 16.10.2026): ручка снизу слева → голова сверху справа (как в Майнкрафте); свет — сверху слева:
  // край к свету светлее, к тени темнее, обводка — темнее материала (не чёрная). У материала 4 тона: основа, свет, тень, обводка;
  // у деревянных голова светлее ручки (иначе «палка»). Та же картинка — вещь в руке (voxel-render.js выдавливает её по пикселям)
  const TOOL_PAL = {
    wood: ['#c39457', '#e2b877', '#8f6634', '#3e2810'], stone: ['#8f9095', '#b9babe', '#626368', '#2b2c30'], iron: ['#d3d6db', '#f6f8fa', '#9aa0a8', '#3b3f46'],
    gold: ['#f3c740', '#fff1a6', '#c18a1c', '#5a3806'], diamond: ['#45dccf', '#b9fff6', '#1c9b91', '#0c4744'],
  };
  const HANDLE_PAL = ['#8a5c30', '#b17e48', '#5d3b1b', '#2c1a0a'];
  P.tool32 = (d, s) => {
    const pal = (TOOL_PAL[s.m] || TOOL_PAL.iron).map(hx), hp = HANDLE_PAL.map(hx), M = new Uint8Array(N * N);   // 0 — пусто, 1 — ручка, 2 — металл
    const sc = N / 32, seg = (x0, y0, x1, y1, w, v) => {   // толстая линия (в клетках 32×32)
      x0 *= sc; y0 *= sc; x1 *= sc; y1 *= sc; w *= sc;
      const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const px = x + .5, py = y + .5, t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2)), qx = x0 + dx * t - px, qy = y0 + dy * t - py; if (qx * qx + qy * qy <= w * w / 4) M[y * N + x] = v; }
    };
    const poly = (pts, v) => {   // многоугольник (точки в клетках 32×32)
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const px = (x + .5) / sc, py = (y + .5) / sc; let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside; }
        if (inside) M[y * N + x] = v;
      }
    };
    if (s.tool === 'sword') {
      seg(4.5, 27.5, 9.5, 22.5, 3.2, 1); seg(3, 29, 4.5, 27.5, 3.4, 1);                       // рукоять и навершие
      seg(5.5, 17.5, 14.5, 26.5, 3, 2);                                                      // гарда
      poly([[9, 21], [11, 23], [27.5, 6.5], [28.5, 3.5], [25.5, 4.5]], 2);                   // клинок с острием
    } else if (s.tool === 'pick') {
      seg(4.5, 27.5, 20, 7, 3.2, 1);
      const A = [[8.95, 2.6], [15.1, 1.9], [19.9, 3.8], [23.4, 7.5], [25, 12.4], [24.3, 17.4]];   // дуга поперёк ручки, выпуклая от неё
      for (let i = 0; i < A.length - 1; i++) seg(A[i][0], A[i][1], A[i + 1][0], A[i + 1][1], i === 0 || i === A.length - 2 ? 3 : 3.8, 2);
    } else if (s.tool === 'axe') {
      seg(4.5, 27.5, 22, 6, 3.2, 1);
      poly([[12.2, 10.2], [11.5, 5.9], [12.8, 3], [15.7, 1.7], [19.9, 3.8], [21.7, 6.3], [23.3, 7.9], [18.3, 12.8], [15.3, 12.7]], 2);   // лезвие сбоку от ручки
    } else {   // лопата
      seg(4.5, 27.5, 17.5, 14.5, 3.2, 1);
      poly([[16, 12.5], [19, 8], [23, 4.5], [27, 4.5], [27.5, 8.5], [24, 13], [19.5, 16]], 2);                     // штык
    }
    // тон: к свету (сверху слева пусто) — светлее, к тени (снизу справа пусто) — темнее; блик на ребре металла
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = M[y * N + x]; if (!v) continue;
      const P4 = v === 1 ? hp : pal, e = (xx, yy) => xx < 0 || yy < 0 || xx >= N || yy >= N || !M[yy * N + xx];
      let c = P4[0];
      if (e(x - 1, y) || e(x, y - 1) || e(x - 1, y - 1)) c = P4[1];
      else if (e(x + 1, y) || e(x, y + 1) || e(x + 1, y + 1)) c = P4[2];
      if (v === 2 && !e(x - 1, y - 1) && e(x - 2, y - 2) && ((x + y) & 3) === 0) c = shade(P4[1], 1.08);
      put(d, x, y, c);
    }
    // обводка — цвет обводки соседа (ручка — своя, металл — свой)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (M[y * N + x]) continue;
      let v = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < N && yy < N && M[yy * N + xx]) { v = Math.max(v, M[yy * N + xx]); } }
      if (v) put(d, x, y, (v === 1 ? hp : pal)[3]);
    }
  };
  // ── бой (22.10.2026): лук, стрела, щит — тоже 32×32, тем же светом сверху слева и обводкой (вещь в руке выдавлена по пикселям) ──
  // маска: 0 — пусто, 1…n — цвет из палитры [основа, свет, тень, обводка] своего номера
  function paint32(d, M, pals){
    const e = (x, y) => x < 0 || y < 0 || x >= N || y >= N || !M[y * N + x];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = M[y * N + x]; if (!v) continue;
      const P4 = pals[v - 1]; let c = P4[0];
      if (e(x - 1, y) || e(x, y - 1) || e(x - 1, y - 1)) c = P4[1]; else if (e(x + 1, y) || e(x, y + 1) || e(x + 1, y + 1)) c = P4[2];
      put(d, x, y, c);
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (M[y * N + x]) continue;
      let v = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < N && yy < N && M[yy * N + xx]) v = Math.max(v, M[yy * N + xx]); }
      if (v) put(d, x, y, pals[v - 1][3]);
    }
  }
  const mask32 = () => new Uint8Array(N * N);
  function seg32(M, x0, y0, x1, y1, w, v){
    const sc = N / 32; x0 *= sc; y0 *= sc; x1 *= sc; y1 *= sc; w *= sc;
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const px = x + .5, py = y + .5, t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2)), qx = x0 + dx * t - px, qy = y0 + dy * t - py; if (qx * qx + qy * qy <= w * w / 4) M[y * N + x] = v; }
  }
  const WOOD4 = ['#a8743e', '#d19a5c', '#7a5128', '#3a2410'].map(hx), STRING4 = ['#ece6d6', '#ffffff', '#b8b0a0', '#5a5448'].map(hx);
  // лук: дуга дерева (ручка в середине темнее) и тетива
  P.bow32 = d => {   // дуга (центр 4,46; 16, радиус 13 — концы на x 8,5) выгнута вправо, тетива — слева; ручка — середина дуги
    const M = mask32(), cx = 4.46, cy = 16, r = 13.04, A = 1.257;
    for (let i = 0; i < 40; i++) { const a = -A + 2 * A * i / 40, a2 = -A + 2 * A * (i + 1) / 40; seg32(M, cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(a2) * r, cy + Math.sin(a2) * r, i > 15 && i < 25 ? 3.6 : 2.6, 1); }
    seg32(M, 8.5, 3.6, 8.5, 28.4, 1.1, 2);
    paint32(d, M, [WOOD4, STRING4]);
    const sc = N / 32;
    for (let y = Math.round(13 * sc); y < Math.round(19 * sc); y++) for (let x = Math.round(15 * sc); x < Math.round(19.5 * sc); x++) { const i = (y * N + x) * 4; if (d[i + 3] && M[y * N + x] === 1) { d[i] *= .7; d[i + 1] *= .62; d[i + 2] *= .55; } }
  };
  // стрела: древко по диагонали, наконечник из кремня, оперение
  P.arrow32 = d => {
    const M = mask32();
    seg32(M, 5, 27, 24.5, 7.5, 1.9, 1);
    for (const [x, y] of [[24, 4.5], [27.5, 8], [28.5, 3.5]]) seg32(M, 23.5, 8.5, x, y, 2.6, 2);
    seg32(M, 26, 6, 28.5, 3.5, 2.4, 2);
    for (const [x0, y0, x1, y1] of [[4, 23, 9, 28], [6, 21, 11, 26], [8, 19, 12, 23]]) { seg32(M, x0, y0 - 2.5, x1 - 1, y1 - 3.5, 2, 3); seg32(M, x0 + 2.5, y0, x1 - .5, y1 - 1, 2, 3); }
    paint32(d, M, [WOOD4, ['#6b6b74', '#a6a6b0', '#44444c', '#1f1f24'].map(hx), ['#f2f2f2', '#ffffff', '#c8c8c8', '#6a6a6a'].map(hx)]);
  };
  // щит: доски в железной оправе, умбон посередине (как у викингов — скруглённый квадрат)
  P.shield32 = d => {
    const M = mask32(), sc = N / 32;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const px = (x + .5) / sc - 16, py = (y + .5) / sc - 16.5, r = Math.max(Math.abs(px) / 12.5, Math.abs(py) / 14), bot = py > 6 ? Math.hypot(px / 12.5, (py - 6) / 8.5) : 0;
      if (r > 1 || bot > 1) continue;
      const rim = r > .86 || bot > .86, boss = Math.hypot(px, py + .5) < 3.2;
      M[y * N + x] = boss ? 3 : rim ? 2 : 1;
    }
    paint32(d, M, [WOOD4, ['#c9ccd2', '#f2f4f7', '#8c9099', '#33363c'].map(hx), ['#d8dbe0', '#ffffff', '#9aa0a8', '#3b3f46'].map(hx)]);
    // доски: тёмные швы по вертикали
    for (let y = 0; y < N; y++) for (const sx of [11.3, 16, 20.7]) { const x = Math.round(sx * sc), i = (y * N + x) * 4; if (M[y * N + x] === 1) { d[i] *= .72; d[i + 1] *= .7; d[i + 2] *= .66; } }
  };
  // ── помощники (T-049): часы, компас, глубиномер, лупа, рудоискатель, навигатор, книги, бумага и карты, свиток, вёдра — 32×32,
  //    тем же светом сверху слева и обводкой (рисунки свои) ──
  function circ32(M, cx, cy, r, v){ const sc = N / 32; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const px = (x + .5) / sc - cx, py = (y + .5) / sc - cy; if (px * px + py * py <= r * r) M[y * N + x] = v; } }
  function rect32(M, x0, y0, x1, y1, v){ const sc = N / 32; for (let y = Math.round(y0 * sc); y < Math.round(y1 * sc); y++) for (let x = Math.round(x0 * sc); x < Math.round(x1 * sc); x++) if (x >= 0 && y >= 0 && x < N && y < N) M[y * N + x] = v; }
  function poly32(M, pts, v){ const sc = N / 32; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const px = (x + .5) / sc, py = (y + .5) / sc; let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside; } if (inside) M[y * N + x] = v; } }
  const dot = (d, x, y, c) => { const sc = N / 32; for (let yy = 0; yy < sc; yy++) for (let xx = 0; xx < sc; xx++) put(d, Math.round(x * sc) + xx, Math.round(y * sc) + yy, c); };
  const ln = (d, x0, y0, x1, y1, c) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1; for (let i = 0; i <= n; i++) dot(d, Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c); };
  const PALr = b => [b, shade(b, 1.25), shade(b, .7), shade(b, .35)], PAL = c => PALr(hx(c));
  const GOLD4 = ['#f3c740', '#fff1a6', '#c18a1c', '#5a3806'].map(hx), IRON4 = ['#c9ccd2', '#f2f4f7', '#8c9099', '#33363c'].map(hx), LEATHER4 = PAL('#7a4a2a');
  const GLASS4 = ['#a8d8f0', '#e6f7ff', '#6fa8c8', '#2e5a74'].map(hx), PAPER4 = ['#e9ddb8', '#fbf3da', '#bfae80', '#5e5032'].map(hx);
  P.watch32 = d => {
    const M = mask32(); rect32(M, 12, 1, 20, 9, 1); rect32(M, 12, 23, 20, 31, 1); circ32(M, 16, 16, 9, 2); circ32(M, 16, 16, 6.6, 3);
    paint32(d, M, [LEATHER4, GOLD4, ['#f6efdc', '#ffffff', '#d8ccae', '#5e5032'].map(hx)]);
    const k = hx('#2a2a33'); ln(d, 16, 16, 16, 11, k); ln(d, 16, 16, 20, 16, k); dot(d, 16, 16, hx('#c0392b'));
    for (const [x, y] of [[16, 10], [22, 16], [16, 22], [10, 16]]) dot(d, x, y, shade(k, 1.6));
  };
  P.compass32 = d => {
    const M = mask32(); circ32(M, 16, 16, 11, 1); circ32(M, 16, 16, 8, 2);
    paint32(d, M, [IRON4, ['#2c3446', '#45506a', '#1c2230', '#0b0e16'].map(hx)]);
    ln(d, 16, 16, 21, 10, hx('#e0402e')); ln(d, 17, 16, 22, 11, hx('#b22b1e')); ln(d, 16, 16, 11, 22, hx('#f2f2f2')); ln(d, 15, 16, 10, 21, hx('#c8c8c8'));
    dot(d, 16, 16, hx('#ffd23f')); dot(d, 16, 9, hx('#ffd23f'));
  };
  P.depth32 = d => {
    const M = mask32(); rect32(M, 10, 2, 22, 30, 1); rect32(M, 13, 5, 19, 27, 2);
    paint32(d, M, [IRON4, ['#2a3240', '#3c4658', '#1a2030', '#0b0e16'].map(hx)]);
    const sc = N / 32;
    for (let y = Math.round(15 * sc); y < Math.round(27 * sc); y++) for (let x = Math.round(13 * sc); x < Math.round(19 * sc); x++) { const t = (y / sc - 15) / 12; put(d, x, y, mix(hx('#5fb4ff'), hx('#1c4fa8'), t)); }
    for (let y = 7; y < 27; y += 4) ln(d, 13, y, 14, y, hx('#ffd23f'));
    ln(d, 20, 13, 23, 13, hx('#e0402e')); dot(d, 19, 14, hx('#e0402e'));
  };
  P.lens32 = d => {
    const M = mask32(); seg32(M, 5, 28, 13, 20, 3.6, 1); circ32(M, 19.5, 12.5, 9.5, 2); circ32(M, 19.5, 12.5, 6.8, 3);
    paint32(d, M, [WOOD4, GOLD4, GLASS4]);
    dot(d, 16, 9, hx('#ffffff')); dot(d, 17, 8, hx('#ffffff')); dot(d, 15, 10, hx('#e6f7ff'));
  };
  P.orefind32 = d => {
    const M = mask32(); seg32(M, 21, 9, 26, 3, 2, 3); circ32(M, 26.5, 3, 2, 2); rect32(M, 7, 8, 25, 29, 1); rect32(M, 10, 11, 22, 21, 4);
    paint32(d, M, [IRON4, GOLD4, PAL('#3a3f48'), ['#1f4a32', '#2f6b48', '#123020', '#06140c'].map(hx)]);
    dot(d, 13, 14, hx('#5ff0e6')); dot(d, 18, 17, hx('#f5d33d')); dot(d, 15, 18, hx('#d8a985')); dot(d, 19, 13, hx('#7cff9a'));
    for (const x of [10, 14, 18]) { dot(d, x, 25, hx('#e0402e')); dot(d, x + 1, 25, hx('#b22b1e')); }
  };
  P.nav32 = d => {
    const M = mask32(); circ32(M, 16, 16, 12, 1); circ32(M, 16, 16, 9, 2);
    paint32(d, M, [GOLD4, ['#1e2b4a', '#2c3d66', '#121a30', '#070b16'].map(hx)]);
    ln(d, 16, 16, 21, 11, hx('#e0402e')); ln(d, 16, 16, 11, 21, hx('#f2f2f2')); ln(d, 16, 16, 16, 9, hx('#9fd0ff'));
    for (const [x, y] of [[16, 8], [24, 16], [16, 24], [8, 16]]) dot(d, x, y, hx('#ffd23f'));
    dot(d, 16, 16, hx('#ffd23f'));
  };
  P.book32 = (d, s) => {
    const M = mask32(); rect32(M, 6, 3, 26, 29, 1); rect32(M, 6, 3, 10, 29, 2); rect32(M, 24, 5, 27, 28, 3);
    const base = hx(s.c || '#6b3aa8'); paint32(d, M, [PALr(base), PALr(shade(base, .7)), PAPER4]);
    const g = hx('#ffd23f');
    for (const [x, y] of [[11, 4], [22, 4], [11, 27], [22, 27]]) dot(d, x, y, g);
    if (s.emblem === 'grid') { for (let i = 0; i < 4; i++) { ln(d, 12 + i * 3, 11, 12 + i * 3, 20, g); ln(d, 12, 11 + i * 3, 21, 11 + i * 3, g); } }
    else { for (const [x, y, cc] of [[13, 12, '#4caf50'], [14, 12, '#4caf50'], [13, 13, '#4caf50'], [17, 15, '#3b7fe0'], [18, 16, '#3b7fe0'], [19, 17, '#3b7fe0'], [15, 18, '#4caf50'], [16, 18, '#4caf50']]) dot(d, x, y, hx(cc)); ln(d, 18, 11, 21, 14, hx('#e0402e')); ln(d, 21, 11, 18, 14, hx('#e0402e')); }
  };
  P.paper32 = (d, s) => {
    const M = mask32(); poly32(M, [[6, 5], [26, 5], [26, 22], [21, 27], [6, 27]], 1); poly32(M, [[21, 22], [26, 22], [21, 27]], 2);
    paint32(d, M, [PAPER4, ['#cdbd92', '#e0d2a8', '#a8996c', '#5e5032'].map(hx)]);
    const ink = hx('#7a6a48');
    if (s.grid) { for (let x = 10; x < 24; x += 4) ln(d, x, 8, x, 24, shade(ink, 1.3)); for (let y = 9; y < 24; y += 4) ln(d, 8, y, 24, y, shade(ink, 1.3)); }
    else if (s.map) {
      const sc = N / 32;
      for (let y = 7; y < 25; y++) for (let x = 8; x < 24; x++) { const v = Math.sin(x * .7) + Math.cos(y * .55 + x * .2); if (v > .6) put(d, Math.round(x * sc), Math.round(y * sc), hx('#5fa34a')); else if (v < -1.1) put(d, Math.round(x * sc), Math.round(y * sc), hx('#3b7fe0')); }
      ln(d, 17, 10, 20, 13, hx('#e0402e')); ln(d, 20, 10, 17, 13, hx('#e0402e'));
    } else for (const y of [10, 14, 18]) ln(d, 9, y, 22, y, shade(ink, 1.2));
  };
  P.scroll32 = d => {
    const M = mask32(); rect32(M, 8, 8, 24, 25, 1); rect32(M, 6, 5, 26, 10, 2); rect32(M, 6, 23, 26, 28, 2); rect32(M, 15, 8, 18, 25, 3);
    paint32(d, M, [PAPER4, ['#b98a52', '#d8a86c', '#8a6234', '#3e2810'].map(hx), ['#3b7fe0', '#7fb4ff', '#2257a8', '#0e2a5a'].map(hx)]);
    for (const [x, y, c] of [[26, 2, '#ffffff'], [27, 3, '#ffd23f'], [25, 3, '#ffd23f'], [26, 4, '#ffd23f'], [26, 3, '#fff7c2']]) dot(d, x, y, hx(c));
  };
  P.bucket32 = (d, s) => {
    const M = mask32(); seg32(M, 8, 12, 12, 5, 1.6, 2); seg32(M, 12, 5, 20, 5, 1.6, 2); seg32(M, 20, 5, 24, 12, 1.6, 2);
    poly32(M, [[7, 11], [25, 11], [22.5, 28], [9.5, 28]], 1); rect32(M, 7, 11, 25, 14, 3);
    paint32(d, M, [IRON4, PAL('#5a5e66'), ['#e2e5ea', '#ffffff', '#a6aab2', '#3b3f46'].map(hx)]);
    if (s.fill) { const c = hx(s.fill); for (let y = 12; y < 16; y++) for (let x = 9 + (y > 13 ? 1 : 0); x < 23 - (y > 13 ? 1 : 0); x++) { dot(d, x, y, y === 12 ? shade(c, 1.3) : shade(c, 1.05 - (y - 12) * .08)); if (s.lava && (x * 7 + y * 3) % 5 === 0) dot(d, x, y, hx('#ffd257')); } }
  };
  // лежанка (блок): сверху — подушка и одеяло, сбоку — одеяло над деревянной рамой (рисунок свой)
  P.bed = (d, s, nm) => {
    const k = K, wood = hx('#8a6234'), red = hx('#c0392b'), white = hx('#f2efe6');
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const n = (nm.v(x, y) - .5) * .12;
      if (s.part === 'top') {
        const frame = x < k || x >= N - k || y < k || y >= N - k, pillow = y >= k * 2 && y < k * 6 && x >= k * 2 && x < N - k * 2, fold = y >= k * 7 && y < k * 8;
        put(d, x, y, frame ? shade(wood, .8 + n) : pillow ? shade(white, .95 + n - (y === k * 5 ? .1 : 0)) : shade(red, (fold ? .78 : .95) + n + ((Math.floor(x / (k * 4)) + Math.floor(y / (k * 4))) & 1 ? .04 : 0)));
      } else {
        const blanket = y < k * 7, sheet = y >= k * 7 && y < k * 8, leg = y >= k * 12 && (x < k * 3 || x >= N - k * 3), gap = y >= k * 12 && !leg;
        put(d, x, y, blanket ? shade(red, .9 + n + (y < k ? .12 : 0)) : sheet ? shade(white, .92 + n) : gap ? shade(wood, .42 + n) : shade(wood, (leg ? .7 : .85) + n + (y === k * 8 ? .12 : 0)));
      }
    }
  };
  P.ingot = (d, s) => { const c = hx(s.c), lt = shade(c, 1.2), dk = shade(c, .7); for (let y = 6; y < 11; y++) for (let x = 2; x < 14; x++) { const top = y === 6, edge = x === 2 || x === 13 || y === 10; if ((x < 3 || x > 12) && (y === 6)) continue; put(d, x, y, top ? lt : edge ? dk : c); } put(d, 4, 7, shade(c, 1.45)); put(d, 5, 7, shade(c, 1.3)); outline(d); };
  P.gem = (d, s) => {
    const c = hx(s.c), lt = shade(c, 1.35), dk = shade(c, .65);
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) { const dx = Math.abs(x - 7.5), dy = y - 3; if (dy < 3 ? dx <= 2 + dy : dx <= 4.5 - (dy - 3) * .7) put(d, x, y, dy < 3 ? lt : x < 8 ? c : dk); }
    put(d, 6, 5, [255, 255, 255]); outline(d);
  };
  P.lump = (d, s, nm) => { const c = hx(s.c); for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) { const dx = x - 7.5, dy = y - 8, r = Math.hypot(dx, dy * 1.15); if (r < 4.8 + nm.v(x, y) * 1.2) put(d, x, y, shade(c, (dx + dy < -3 ? 1.15 : .8) + nm.v(x, y) * .4)); } outline(d); };
  P.food = (d, s, nm) => {
    const c = hx(s.c), dk = shade(c, .7), b = s.bone ? hx('#efe6d2') : null;
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) { const dx = x - 7, dy = y - 8, r = Math.hypot(dx * 1.1, dy); if (r < 5.2) put(d, x, y, r > 4 ? dk : shade(c, (dx + dy < -4 ? 1.12 : .9) + nm.v(x, y) * .25)); }
    if (b) { line(d, 10, 5, 13, 2, b); put(d, 13, 1, b); put(d, 14, 2, b); }
    if (s.leaf) { put(d, 8, 2, hx('#3d8b37')); put(d, 9, 1, hx('#3d8b37')); put(d, 7, 2, hx('#5a3a1e')); }
    put(d, 5, 5, shade(c, 1.4));
    outline(d);
  };
  P.feather = d => { const w = hx('#f2f2f2'); line(d, 3, 13, 12, 3, hx('#9a9a9a')); for (let i = 0; i < 8; i++) { put(d, 5 + i, 10 - i, w); put(d, 6 + i, 11 - i, shade(w, .85)); put(d, 4 + i, 10 - i, shade(w, .92)); } outline(d); };
  P.plant = (d, s, nm) => {
    const stem = hx(s.stem || '#3f8f3a');
    for (let i = 0; i < N * N * 4; i += 4) d[i + 3] = 0;
    if (s.flower) {
      line(d, 7, 15, 7, 7, stem); put(d, 6, 11, stem); put(d, 5, 10, stem); put(d, 8, 12, stem); put(d, 9, 11, stem);
      const f = hx(s.flower), c2 = hx(s.center || '#f5d33d');
      for (const [x, y] of [[7, 3], [6, 4], [8, 4], [5, 5], [9, 5], [6, 6], [8, 6], [7, 6], [6, 5], [8, 5], [7, 4]]) put(d, x, y, y < 5 ? shade(f, 1.15) : f);
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
    const c = hx('#9c7a4a'), k = K;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const frame = x < 2 * k || x >= N - 2 * k || y < 2 * k || (s.top ? false : y >= N - 2 * k), pane = s.top && x >= 4 * k && x < 12 * k && y >= 4 * k && y < 12 * k;
      if (pane) { put(d, x, y, hx('#bfe7ff'), (Math.floor(x / k) + Math.floor(y / k)) % 5 === 0 ? 220 : 0); continue; }
      const plank = Math.floor(x / (4 * k)), seam = x % (4 * k) === 0 && !frame;
      put(d, x, y, frame ? shade(c, .72 + nm.v(x, y) * .1) : seam ? shade(c, .66) : shade(c, .9 + nm.v(x, y) * .12 + (plank & 1) * .04));
    }
    if (!s.top) for (let yy = 2 * k; yy < 4 * k; yy++) for (let xx = 0; xx < k; xx++) put(d, 12 * k + xx, yy, hx('#3a3a3a'));
  };
  P.table = (d, s, nm, name) => {
    paintInto(d, 'planks_oak', name);
    const dk = hx('#4a3520'), k = K, L = (x0, y0, x1, y1, c) => { for (let y = y0 * k; y < (y1 + 1) * k; y++) for (let x = x0 * k; x < (x1 + 1) * k; x++) put(d, x, y, c); };
    if (s.part === 'top') { L(0, 0, 15, 0, dk); L(0, 15, 15, 15, dk); L(0, 0, 0, 15, dk); L(15, 0, 15, 15, dk); L(3, 7, 12, 7, shade(dk, 1.3)); L(7, 3, 7, 12, shade(dk, 1.3)); }
    else { L(0, 0, 15, 0, dk); L(0, 1, 15, 1, shade(dk, 1.4)); if (s.part === 'front') { L(3, 4, 3, 12, hx('#8a8a8a')); L(11, 5, 11, 12, hx('#7a5a33')); L(10, 4, 12, 4, hx('#9a9a9a')); } }
  };
  P.furnace = (d, s, nm, name) => {
    paintInto(d, 'cobble', name);
    const k = K;
    if (s.part === 'front') {
      for (let y = 7 * k; y < 14 * k; y++) for (let x = 3 * k; x < 13 * k; x++) put(d, x, y, s.lit ? (y > 10 * k ? hx('#ffb02e') : hx('#ff7a1f')) : shade(hx('#2a2a2a'), .9 + nm.v(x, y) * .2));
      for (let x = 3 * k; x < 13 * k; x++) for (let j = 0; j < k; j++) put(d, x, 6 * k + j, hx('#5a5a5a'));
      if (s.lit) for (let i = 0; i < 6 * k; i++) put(d, 4 * k + Math.floor(nm.r() * 8 * k), 9 * k + Math.floor(nm.r() * 4 * k), hx('#ffe27a'));
    } else if (s.part === 'top') { for (let i = 2 * k; i < 14 * k; i++) for (let j = 0; j < k; j++) { put(d, i, 2 * k + j, hx('#5a5a5a')); put(d, i, 13 * k + j, hx('#5a5a5a')); } }
  };
  P.chest = (d, s, nm, name) => {
    paintInto(d, 'planks_oak', name);
    const dk = hx('#4a3520'), k = K;
    for (let i = 0; i < N; i++) for (let j = 0; j < k; j++) { put(d, i, j, dk); put(d, i, N - 1 - j, dk); put(d, j, i, dk); put(d, N - 1 - j, i, dk); }
    if (s.part !== 'top') for (let x = 0; x < N; x++) for (let j = 0; j < k; j++) put(d, x, 6 * k + j, dk);
    if (s.part === 'front') { for (let y = 5 * k; y < 9 * k; y++) for (let x = 7 * k; x < 9 * k; x++) put(d, x, y, hx(y < 6 * k ? '#e8e8e8' : '#c9c9c9')); for (let j = 0; j < k; j++) put(d, 7 * k + j, 9 * k - 1, hx('#7a7a7a')); }
  };
  // жидкость: лава — волнами с трещинами; вода (T-044) — без полос: ровная, мягкие пятна и редкие светлые точки (волны, блики,
  // глубину рисует шейдер воды; у простого режима — только этот рисунок). Раньше у воды были косые полосы — на глади во весь
  // экран они складывались в «муар»
  P.liquid = (d, s, nm) => {
    const c = hx(s.c), lava = s.lava;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!lava) { put(d, x, y, shade(c, .92 + (nm.c(x, y) - .5) * .1 + (nm.v(x, y) - .5) * .05 + (nm.v(x + 9, y + 5) > .84 ? .05 : 0)), s.alpha ?? 255); continue; }
      const w = Math.sin((x + y * .6) * .9 / K + nm.v(x, y) * 2 + nm.c(x, y) * 3) * .5 + .5;
      const crest = w > .9 ? .14 : 0, crack = nm.c(x * 2, y * 2) > .62 && w > .55;
      put(d, x, y, crack ? hx('#ffd257') : shade(c, .84 + w * .2 + nm.v(x, y) * .08 + crest), s.alpha ?? 255);
    }
  };
  P.lamp = (d, s, nm) => {
    const k = K;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const edge = x < k || y < k || x >= N - k || y >= N - k, cr = (Math.floor(x / k) === 7 || Math.floor(x / k) === 8 || Math.floor(y / k) === 7 || Math.floor(y / k) === 8);
      put(d, x, y, edge ? hx('#8a6a3a') : cr ? hx('#ffe9a8') : shade(hx('#ffd36a'), .9 + nm.v(x, y) * .2));
    }
  };

  // булыжник: неровные камни (ячейки Вороного), свет сверху-слева у каждого камня, тёмные швы
  P.cobble = (d, s, nm) => {
    const c = hx(s.c || '#7a7a7d'), m = shade(hx(s.m || '#55555a'), 1), r = V.rng(hs(s.c || 'c') ^ 99), pts = [];
    for (let k = 0; k < Math.round(8 * K); k++) pts.push([r() * N, r() * N, .82 + r() * .32, r()]);
    const moss = s.moss ? hx(s.moss) : null;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let a = 1e9, b = 1e9, k0 = 0, gx = 0, gy = 0;
      for (let k = 0; k < pts.length; k++) for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { const ddx = x + .5 - pts[k][0] - ox, ddy = y + .5 - pts[k][1] - oy, dd = Math.hypot(ddx, ddy); if (dd < a) { b = a; a = dd; k0 = k; gx = ddx; gy = ddy; } else if (dd < b) b = dd; }
      if (b - a < .95 * K) { put(d, x, y, shade(m, .82 + nm.v(x, y) * .2)); continue; }
      const light = (-gx - gy) / (a + 1) * .1;   // выпуклый камень: к свету — светлее
      const base = moss && nm.c(x * 2, y) > .58 && nm.v(x, y) > .3 ? shade(moss, .85 + nm.v(x, y) * .3) : warm(c, pts[k0][3], 12);
      put(d, x, y, shade(base, pts[k0][2] * (.9 + nm.v(x, y) * .18) * (1.06 - a / (9 * K) * .5) + light));
    }
  };
  const SPRITE = new Set(['stick', 'tool', 'ingot', 'gem', 'lump', 'food', 'feather', 'plant', 'torch', 'ladder']);
  const SPRITE32 = new Set(['tool32', 'bow32', 'arrow32', 'shield32', 'watch32', 'compass32', 'depth32', 'lens32', 'orefind32', 'nav32', 'book32', 'paper32', 'scroll32', 'bucket32']);   // вещи, нарисованные сразу в полный размер (фон прозрачный)
  // Ваниль: имя → рисунок (цвета — свои; никаких чужих картинок)
  const S = V.TEX_SPECS = {
    stone: { k: 'stone', c: '#7d7d80', a: .1 }, cobble: { k: 'cobble', c: '#808083', m: '#4e4e52' }, dirt: { k: 'dirt', c: '#7a5634', a: .15 },
    grass_top: { k: 'grass_top', c: '#c4c4c4', a: .12 }, grass_side: { k: 'grass_side', c: '#5f9e44' }, sand: { k: 'sand', c: '#ddd09a' },
    gravel: { k: 'gravel', c: '#8a8580' }, bedrock: { k: 'stone', c: '#3c3c3e', a: .4, cracks: 9 },
    water: { k: 'liquid', c: '#c8d8ec', alpha: 190 }, lava: { k: 'liquid', c: '#e6611a', lava: true },
    log_oak: { k: 'log', c: '#6b4f2c' }, log_oak_top: { k: 'log_top', c: '#b08a52', bark: '#6b4f2c' }, leaves_oak: { k: 'leaves', c: '#c0c0c0' }, planks_oak: { k: 'planks', c: '#a8834e' },
    log_birch: { k: 'log', c: '#e7e2d6', birch: true }, log_birch_top: { k: 'log_top', c: '#d4c191', bark: '#e7e2d6' }, leaves_birch: { k: 'leaves', c: '#c8c8c8', holes: .18 }, planks_birch: { k: 'planks', c: '#cdb57c' },
    log_spruce: { k: 'log', c: '#4b3520' }, log_spruce_top: { k: 'log_top', c: '#8a6a3e', bark: '#4b3520' }, leaves_spruce: { k: 'leaves', c: '#b0b0b0', holes: .14 }, planks_spruce: { k: 'planks', c: '#7a5a34' },
    sandstone: { k: 'stripes', c: '#d9c88f', c2: '#e2d39d' }, sandstone_top: { k: 'sand', c: '#e2d39d' }, snow: { k: 'noise', c: '#f4f8fc', a: .04 },
    snow_grass_side: { k: 'grass_side', c: '#f4f8fc' }, ice: { k: 'noise', c: '#a5c8f2', a: .06 }, clay: { k: 'noise', c: '#a3a8b6', a: .06 },
    ore_coal: { k: 'ore', c: '#242424', n: 6 }, ore_iron: { k: 'ore', c: '#d8a985', n: 5 }, ore_gold: { k: 'ore', c: '#f5d33d', n: 5 }, ore_diamond: { k: 'ore', c: '#5ff0e6', n: 4 },
    glass: { k: 'glass' }, cactus_side: { k: 'stripes', c: '#3f8a2f', c2: '#4ea23a', vertical: true }, cactus_top: { k: 'noise', c: '#5aa646', a: .1 },
    tall_grass: { k: 'plant', c: '#bdbdbd' }, flower_yellow: { k: 'plant', flower: '#f5d33d', center: '#e09a1a' }, flower_red: { k: 'plant', flower: '#e0302e', center: '#2a2a2a' },
    dead_bush: { k: 'plant', bush: true }, sapling_oak: { k: 'plant', sapling: true, c: '#4e9a3a' }, sapling_birch: { k: 'plant', sapling: true, c: '#7fb85a' }, sapling_spruce: { k: 'plant', sapling: true, c: '#2f6b3a' },
    torch: { k: 'torch' }, table_top: { k: 'table', part: 'top' }, table_side: { k: 'table', part: 'side' }, table_front: { k: 'table', part: 'front' },
    furnace_side: { k: 'furnace', part: 'side' }, furnace_front: { k: 'furnace', part: 'front' }, furnace_front_lit: { k: 'furnace', part: 'front', lit: true }, furnace_top: { k: 'furnace', part: 'top' },
    chest_side: { k: 'chest', part: 'side' }, chest_front: { k: 'chest', part: 'front' }, chest_top: { k: 'chest', part: 'top' },
    ladder: { k: 'ladder' }, door_bottom: { k: 'door' }, door_top: { k: 'door', top: true },
    bricks: { k: 'bricks', c: '#a4523c', m: '#cbbfb0' }, stone_bricks: { k: 'bricks', c: '#86868a', m: '#66666a' }, lamp: { k: 'lamp' }, obsidian: { k: 'stone', c: '#22172f', a: .3, cracks: 3 },
    iron_block: { k: 'checker', c: '#dadada', c2: '#c4c4c4' }, gold_block: { k: 'checker', c: '#f6d04d', c2: '#e6b830' }, diamond_block: { k: 'checker', c: '#6ff2e6', c2: '#4fd9cc' },
    mossy_cobble: { k: 'cobble', c: '#7d807b', m: '#4e4e52', moss: '#4f7a3a' }, missing: { k: 'missing' }, bouncer: { k: 'checker', c: '#7bd36a', c2: '#62bd52' },
    item_stick: { k: 'stick' }, item_coal: { k: 'lump', c: '#2a2a2a' }, item_iron_ingot: { k: 'ingot', c: '#d6d6d6' }, item_gold_ingot: { k: 'ingot', c: '#f2c94c' },
    item_diamond: { k: 'gem', c: '#4fe3d6' }, item_clay_ball: { k: 'lump', c: '#a3a8b6' }, item_brick: { k: 'ingot', c: '#a4523c' },
    item_apple: { k: 'food', c: '#d8302a', leaf: true }, item_meat_raw: { k: 'food', c: '#d9605a', bone: true }, item_meat_cooked: { k: 'food', c: '#8a4a22', bone: true },
    item_chicken_raw: { k: 'food', c: '#f0c2a8', bone: true }, item_chicken_cooked: { k: 'food', c: '#c8843a', bone: true }, item_feather: { k: 'feather' },
    item_slime_ball: { k: 'lump', c: '#7bd36a' }, item_door: { k: 'door' },
    item_flint: { k: 'gem', c: '#4a4a54' }, item_fiber: { k: 'plant', c: '#9ccf5c' }, item_bow: { k: 'bow32' }, item_arrow: { k: 'arrow32' }, item_shield: { k: 'shield32' },
    // помощники (T-049)
    item_watch: { k: 'watch32' }, item_compass: { k: 'compass32' }, item_depth_meter: { k: 'depth32' }, item_lens: { k: 'lens32' }, item_ore_finder: { k: 'orefind32' },
    item_navigator: { k: 'nav32' }, item_atlas: { k: 'book32', c: '#2f7d6b', emblem: 'map' }, item_master_book: { k: 'book32', c: '#6b3aa8', emblem: 'grid' },
    item_parchment: { k: 'paper32' }, item_map_blank: { k: 'paper32', grid: true }, item_map_filled: { k: 'paper32', map: true }, item_recall: { k: 'scroll32' },
    item_bucket: { k: 'bucket32' }, item_bucket_water: { k: 'bucket32', fill: '#3b7fe0' }, item_bucket_lava: { k: 'bucket32', fill: '#ff7a1f', lava: true },
    bed_top: { k: 'bed', part: 'top' }, bed_side: { k: 'bed', part: 'side' },
  };
  for (let i = 0; i < 8; i++) S['destroy_' + i] = { k: 'destroy', st: i };
  // деревья «как в модах» (T-022b): акация — серо-бурая кора и оранжевая древесина, тропическое — тёмная кора с прожилками,
  // ива — листва реже (длинные пряди); ростки — свои оттенки (листва серая — цвет даёт биом, как у дуба)
  Object.assign(S, {
    log_acacia: { k: 'log', c: '#6e655c' }, log_acacia_top: { k: 'log_top', c: '#c46d3a', bark: '#6e655c' }, leaves_acacia: { k: 'leaves', c: '#c4c4c4', holes: .26 }, planks_acacia: { k: 'planks', c: '#b8673a' },
    log_jungle: { k: 'log', c: '#5c4a2e' }, log_jungle_top: { k: 'log_top', c: '#a8823e', bark: '#5c4a2e' }, leaves_jungle: { k: 'leaves', c: '#b8b8b8', holes: .12 }, planks_jungle: { k: 'planks', c: '#a77b4d' },
    leaves_willow: { k: 'leaves', c: '#cacaca', holes: .3 },
    sapling_acacia: { k: 'plant', sapling: true, c: '#8aa83a' }, sapling_jungle: { k: 'plant', sapling: true, c: '#2f8a3a' }, sapling_willow: { k: 'plant', sapling: true, c: '#8cc060' },
  });
  for (const [m, M] of Object.entries(V.TOOL_MATS || {})) for (const k of ['pick', 'axe', 'shovel', 'sword']) S[`item_${k}_${m}`] = { k: 'tool32', tool: k, m, c: M.color };

  // готовые пиксели (PNG мода, пакет текстур): 16×16 или 32×32 → размер текущего рисунка
  function pixels(rgba){
    if (!rgba) return null;
    if (rgba.length === N * N * 4) return rgba;
    for (const n of [16, 32, 64]) if (rgba.length === n * n * 4) return n < N ? upscale(rgba, n, N) : downscale(rgba, n, N);
    return null;
  }
  function downscale(src, from, to){
    const out = new Uint8Array(to * to * 4), k = from / to;
    for (let y = 0; y < to; y++) for (let x = 0; x < to; x++) { const s = (Math.floor(y * k) * from + Math.floor(x * k)) * 4, o = (y * to + x) * 4; for (let c = 0; c < 4; c++) out[o + c] = src[s + c]; }
    return out;
  }
  // Нарисовать в d (основа другой текстуры: руда на камне, дёрн на земле)
  function paintInto(d, name, owner){
    const spec = V.texOverride?.get(name) || S[name] || V.tex[V.texIdx?.get(name)]?.spec || { k: 'noise', c: '#808080' };
    const nm = noiseMap(hs(name));
    const px = pixels(spec.rgba); if (px) { d.set(px); return; }   // картинка мода или пакета
    for (let i = 0; i < N * N * 4; i += 4) d[i + 3] = 255;
    (P[spec.k] || P.noise)(d, spec, nm, owner || name);
  }
  // Рисунок → RGBA TS×TS. spec — свой (мод) или ваниль по имени. Вещи и растения — в 16×16, увеличиваются вдвое
  V.paint = (name, spec) => {
    const s = spec || S[name];
    const n0 = N;
    N = s && SPRITE.has(s.k) && !s.rgba ? 16 : TS; K = N / 16;
    try {
      const d = img();
      if (!s) { P.missing(d); return N === TS ? d : upscale(d, N, TS); }
      const px = pixels(s.rgba);
      if (px) { d.set(px); return N === TS ? d : upscale(d, N, TS); }
      const a0 = SPRITE.has(s.k) || SPRITE32.has(s.k) ? 0 : 255;
      for (let i = 0; i < N * N * 4; i += 4) d[i + 3] = a0;
      const nm = noiseMap(hs(name) ^ (s.seed | 0));
      try { (P[s.k] || P.noise)(d, s, nm, name); } catch (e) { P.missing(d); }
      return N === TS ? d : upscale(d, N, TS);
    } finally { N = n0; K = N / 16; }
  };
  V.PAINTERS = Object.keys(P);
  // пакет текстур игрока (перенос из Minecraft — kubomir-mc.js): имя текстуры → { rgba } поверх своего рисунка; пусто — как было
  V.texOverride = V.texOverride || new Map();
  V.specOf = name => V.texOverride.get(name) || V.tex[V.texIdx.get(name)]?.spec || S[name];
  V.paintAll = () => V.tex.map(t => V.paint(t.name, V.texOverride.get(t.name) || t.spec || S[t.name]));
})();
