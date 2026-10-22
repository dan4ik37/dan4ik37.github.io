// ═══════════════════════════════════════
//  «ПОДЗЕМЬЕ» ⛏ — ГРАФИКА: атлас, нарисованный кодом (блоки × 4 варианта, стены, предметы, мобы, боссы), и WebGL2-рисовальщик
// ═══════════════════════════════════════
// Почему свой WebGL2, а не Three.js: мир — сетка клеток, и выгоднее всего рисовать чанк ОДНИМ прямоугольником, а клетки
// доставать в шейдере из текстур данных (номер блока, соседи, форма, жидкость) — ни одной вершины на клетку, правка клетки =
// 4 байта в текстуре. 10–20 вызовов отрисовки на кадр, Three.js (600 КБ) не нужен, работает и без сети.
// Свет — текстура 66×66 на чанк (с рамкой из соседей) с линейной фильтрацией: плавный переход между клетками бесплатно.
// Края блоков (скругление открытых углов, кромка, трава по открытым сторонам, швы между разными материалами), склоны и
// полублоки — в шейдере по маске соседей (её считает игра). Мобы, предметы, частицы, персонаж — пачкой спрайтов.
// PZGL.paint(PZ, mods) → атлас (canvas 1024×1024 + таблицы ячеек); R = PZGL.renderer(canvas) → R.draw… (см. ниже).
(() => {
  const AN = 64, AS = 1024;           // ячеек в ряду атласа, размер атласа
  const SPR_Y = 40 * 16;              // спрайты — ниже ячеек блоков и предметов
  const hex = h => { const n = parseInt(String(h || '#888').slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const rgb = (c, k = 1, a = 1) => `rgba(${Math.max(0, Math.min(255, c[0] * k | 0))},${Math.max(0, Math.min(255, c[1] * k | 0))},${Math.max(0, Math.min(255, c[2] * k | 0))},${a})`;
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  function rng(seed){ let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const strSeed = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

  // ═══ Узоры 16×16 (g — контекст, ox/oy — угол ячейки, c — цвета [основа, тёмный, светлый], R — случайность варианта) ═══
  function P(g, ox, oy){ return (x, y, col, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(ox + x, oy + y, w, h); }; }
  // кружок радиуса r (обрезается краем ячейки)
  function blob(p, x, y, r, col){ for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r) { const X = x + xx | 0, Y = y + yy | 0; if (X >= 0 && Y >= 0 && X < 16 && Y < 16) p(X, Y, col); } }
  // «камни» по Вороному на торе (узор стыкуется сам с собой): номер камня и «шов» для каждой из 256 точек
  function cells(R, n){
    const pts = []; for (let i = 0; i < n; i++) pts.push([R() * 16, R() * 16]);
    const id = new Uint8Array(256), seam = new Uint8Array(256);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let d1 = 1e9, d2 = 1e9, b = 0;
      for (let i = 0; i < n; i++) for (let oy = -16; oy <= 16; oy += 16) for (let ox = -16; ox <= 16; ox += 16) {
        const dx = x + .5 - pts[i][0] - ox, dy = (y + .5 - pts[i][1] - oy) * 1.25, d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; b = i; } else if (d < d2) d2 = d;
      }
      id[y * 16 + x] = b; seam[y * 16 + x] = Math.sqrt(d2) - Math.sqrt(d1) < 1.05 ? 1 : 0;
    }
    return { id, seam, n };
  }
  // камни с объёмом: свой тон у каждого, светлый край сверху-слева, тень снизу-справа, тёмные швы
  function cobble(p, c, R, n, seamK = .78){
    const C = cells(R, n), tone = Array.from({ length: n }, () => [.9 + R() * .16, R() * .35]);
    const at = (x, y) => C.seam[((y + 16) % 16) * 16 + ((x + 16) % 16)];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const i = y * 16 + x;
      if (C.seam[i]) { p(x, y, rgb(c[1], seamK)); continue; }
      const [k, m] = tone[C.id[i]], base = mixc(c[0], c[2], m);
      const hi = at(x, y - 1) || at(x - 1, y), lo = at(x, y + 1) || at(x + 1, y);
      p(x, y, rgb(hi ? mixc(base, c[2], .65) : base, lo ? k * .84 : k));
    }
    return C;
  }
  const PAT = {
    dirt(g, ox, oy, c, R){   // комья двух тонов, камешки со светлым верхом, корешок
      const p = P(g, ox, oy); p(0, 0, rgb(c[0]), 16, 16);
      for (let k = 0; k < 7; k++) { const dk = R() < .55; blob(p, R() * 16, R() * 16, 1.2 + R() * 2.2, rgb(dk ? c[1] : c[2], dk ? .9 + R() * .12 : .98 + R() * .06)); }
      for (let i = 0; i < 18; i++) p(R() * 16 | 0, R() * 16 | 0, rgb(c[1], .82));
      for (let i = 0; i < 6; i++) p(R() * 16 | 0, R() * 16 | 0, rgb(c[2], 1.08));
      for (let i = 0; i < 3; i++) { const x = R() * 14 | 0, y = R() * 14 | 0, s = mixc(c[2], [196, 188, 176], .45); p(x, y, rgb(s), 2, 2); p(x, y, rgb(s, 1.18), 1, 1); p(x + 1, y + 1, rgb(c[1], .66), 1, 1); }
      if (R() < .45) { let x = R() * 16 | 0, y = R() * 8 | 0; for (let i = 0; i < 5; i++) { p(x, y, rgb(c[1], .7)); if (R() < .5) x = (x + 1) % 16; y++; } }
    },
    stone(g, ox, oy, c, R){   // камни по Вороному: стыкуются без шва, у каждого свой тон и объём
      const p = P(g, ox, oy);
      cobble(p, c, R, 5);
      for (let i = 0; i < 7; i++) p(R() * 16 | 0, R() * 16 | 0, rgb(c[1], .9));
      if (R() < .5) { let x = R() * 16 | 0, y = R() * 16 | 0; for (let i = 0; i < 4; i++) { p(x, y, rgb(c[1], .72)); x = (x + (R() < .5 ? 1 : 0)) % 16; y = (y + 1) % 16; } }   // трещинка
    },
    sand(g, ox, oy, c, R){   // рябь от ветра (узор стыкуется) и песчинки
      const p = P(g, ox, oy); p(0, 0, rgb(c[0]), 16, 16);
      const ph = R() * 8 | 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const r = (x + 2 * y + ph + (y >> 2)) & 7; if (r === 0) p(x, y, rgb(c[1], .96)); else if (r === 1) p(x, y, rgb(c[2], 1.02)); }
      for (let i = 0; i < 22; i++) p(R() * 16 | 0, R() * 16 | 0, R() < .5 ? rgb(c[1], .9) : rgb(c[2], 1.05));
    },
    snow(g, ox, oy, c, R){   // мягкие сугробы с голубой тенью и искорки
      const p = P(g, ox, oy); p(0, 0, rgb(c[0]), 16, 16);
      for (let k = 0; k < 4; k++) blob(p, R() * 16, R() * 16, 1.5 + R() * 2.5, rgb(c[1], 1.01));
      for (let k = 0; k < 4; k++) blob(p, R() * 16, R() * 16, 1 + R() * 1.6, rgb(c[0], 1.02));
      for (let i = 0; i < 4; i++) p(R() * 16 | 0, R() * 16 | 0, rgb(c[2]));
      for (let i = 0; i < 2; i++) { const x = 1 + R() * 14 | 0, y = 1 + R() * 14 | 0; p(x, y, 'rgba(255,255,255,1)'); p(x - 1, y, 'rgba(225,240,255,.8)'); p(x + 1, y, 'rgba(225,240,255,.8)'); }
    },
    ice(g, ox, oy, c, R){   // грани, косые блики и трещины
      const p = P(g, ox, oy);
      const C = cells(R, 3);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = y * 16 + x, t = C.id[i] / 3; p(x, y, C.seam[i] ? rgb(c[1], .92) : rgb(mixc(c[0], c[2], .12 + t * .25))); }
      for (let k = 0; k < 2; k++) { const s = R() * 16 | 0; for (let i = 0; i < 6; i++) p((s + i) % 16, (k * 8 + 6 - i + 16) % 16, 'rgba(255,255,255,.75)'); }
      for (let i = 0; i < 3; i++) p(R() * 16 | 0, R() * 16 | 0, 'rgba(255,255,255,.9)');
    },
    strata(g, ox, oy, c, R){
      const p = P(g, ox, oy);
      for (let y = 0; y < 16; y++) { const band = ((y + (R() * 2 | 0)) >> 2) & 1; p(0, y, rgb(band ? c[0] : c[1]), 16, 1); }
      for (let i = 0; i < 18; i++) p(R() * 16 | 0, R() * 16 | 0, rgb(c[2]));
    },
    ore(g, ox, oy, c, R){   // камень + самородки с тёмной оправой, светлой гранью и искрой
      PAT.stone(g, ox, oy, [c[0], mixc(hex('#000000'), c[0], .8), mixc(c[0], [255, 255, 255], .25)], R);
      const p = P(g, ox, oy);
      for (let k = 0; k < 4; k++) {
        const x = 1 + (R() * 11 | 0), y = 1 + (R() * 11 | 0), big = R() < .5;
        p(x - 1, y, rgb(c[1], .42), big ? 5 : 4, big ? 4 : 3); p(x, y - 1, rgb(c[1], .42), big ? 3 : 2, big ? 6 : 5);   // оправа
        p(x, y, rgb(c[1], .82), big ? 3 : 2, big ? 3 : 2); p(x, y, rgb(c[1]), big ? 2 : 1, big ? 2 : 2);
        p(x, y, rgb(c[2]), 1, 1); if (big) p(x + 2, y + 2, rgb(c[1], .6), 1, 1);
      }
      if (R() < .75) { const x = 2 + (R() * 12 | 0), y = 2 + (R() * 12 | 0); p(x, y, 'rgba(255,255,255,1)'); p(x - 1, y, rgb(c[2], 1, .85)); p(x + 1, y, rgb(c[2], 1, .85)); p(x, y - 1, rgb(c[2], 1, .85)); p(x, y + 1, rgb(c[2], 1, .85)); }   // искра
    },
    obsid(g, ox, oy, c, R){
      const p = P(g, ox, oy); p(0, 0, rgb(c[0]), 16, 16);
      for (let i = 0; i < 26; i++) p(R() * 16 | 0, R() * 16 | 0, rgb(c[1]));
      for (let k = 0; k < 3; k++) { const x = R() * 13 | 0, y = R() * 13 | 0; p(x, y, rgb(c[2]), 2, 1); p(x + 1, y + 1, rgb(c[2], .8), 2, 1); }
    },
    planks(g, ox, oy, c, R){   // две доски: свой тон, волокна, сучок, гвозди у стыка
      const p = P(g, ox, oy);
      for (let row = 0; row < 2; row++) {
        const y = row * 8, cut = 3 + (R() * 10 | 0), k = .94 + R() * .1;
        p(0, y, rgb(c[0], k), 16, 8);
        for (let i = 0; i < 6; i++) p(R() * 16 | 0, y + 1 + (R() * 6 | 0), rgb(c[1], k * .96), 3 + (R() * 5 | 0), 1);   // волокна
        if (R() < .5) { const x = 2 + (R() * 11 | 0), yy = y + 2 + (R() * 3 | 0); p(x, yy, rgb(c[1], .8), 2, 2); p(x, yy, rgb(c[1], .65), 1, 1); }   // сучок
        p(0, y, rgb(c[2], k), 16, 1); p(0, y + 7, rgb(c[1], .74), 16, 1);
        p(cut, y, rgb(c[1], .7), 1, 7); p(cut + 1, y + 1, rgb(c[2], .95), 1, 6);
        p(cut - 2, y + 2, 'rgba(40,30,25,.9)'); p(cut + 2, y + 2, 'rgba(40,30,25,.9)'); p(cut - 2, y + 1, 'rgba(255,240,210,.35)');   // гвозди
      }
    },
    brick(g, ox, oy, c, R){
      const p = P(g, ox, oy); p(0, 0, rgb(c[1]), 16, 16);
      for (let row = 0; row < 4; row++) {
        const y = row * 4, sh = row % 2 ? 4 : 0;
        for (let x = -sh; x < 16; x += 8) {
          const k = .9 + R() * .2;
          p(Math.max(0, x), y, rgb(c[0], k), Math.min(7, 7 + x - Math.max(0, x)), 3);
          p(Math.max(0, x), y, rgb(c[2], k), Math.min(7, 7 + x - Math.max(0, x)), 1);
        }
      }
    },
    glass(g, ox, oy, c, R){
      const p = P(g, ox, oy); g.clearRect(ox, oy, 16, 16);
      p(0, 0, rgb(c[0], 1, .28), 16, 16);
      p(0, 0, rgb(c[2], 1, .9), 16, 1); p(0, 15, rgb(c[2], 1, .9), 16, 1); p(0, 0, rgb(c[2], 1, .9), 1, 16); p(15, 0, rgb(c[2], 1, .9), 1, 16);
      for (let i = 0; i < 6; i++) { p(3 + i, 9 - i, rgb(c[1], 1, .7)); p(5 + i, 12 - i, rgb(c[1], 1, .5)); }
    },
    platform(g, ox, oy, c, R){
      const p = P(g, ox, oy); g.clearRect(ox, oy, 16, 16);
      p(0, 0, rgb(c[0]), 16, 4); p(0, 0, rgb(c[2]), 16, 1); p(0, 4, rgb(c[1]), 16, 1);
      p(2, 5, rgb(c[1], .9), 2, 3); p(12, 5, rgb(c[1], .9), 2, 3);
      if (R() < .5) p(7, 1, rgb(c[1]), 1, 2);
    },
    torch(g, ox, oy, c, R){   // ручка и обмотка; само пламя — живое, рисует игра поверх (PZGL.SPR.flame)
      const p = P(g, ox, oy); g.clearRect(ox, oy, 16, 16);
      p(7, 7, rgb(c[0]), 2, 9); p(7, 7, rgb(c[0], 1.3), 1, 9);
      p(6, 6, rgb([70, 46, 30]), 4, 2); p(6, 6, rgb([96, 66, 42]), 4, 1);   // обмотка
      p(7, 5, rgb(c[1], .9), 2, 1); p(8, 4, rgb(c[2]), 1, 1);              // тлеющий кончик (если пламя не нарисовано)
    },
    trunk(g, ox, oy, c, R){   // кора: продольные борозды, светлая сторона, сучок
      const p = P(g, ox, oy); g.clearRect(ox, oy, 16, 16);
      p(3, 0, rgb(c[0]), 10, 16); p(3, 0, rgb(c[1], .85), 1, 16); p(12, 0, rgb(c[1], .8), 1, 16); p(4, 0, rgb(c[2]), 2, 16); p(11, 0, rgb(c[1]), 1, 16);
      for (let i = 0; i < 6; i++) { const x = 5 + (R() * 6 | 0), y = R() * 16 | 0, h = 3 + (R() * 5 | 0); p(x, y, rgb(c[1], .9), 1, h); p(x + 1, y + 1, rgb(c[2], .95), 1, Math.max(1, h - 2)); }
      if (R() < .35) { const y = 3 + (R() * 9 | 0); p(6, y, rgb(c[1], .7), 4, 3); p(7, y + 1, rgb(c[1], .5), 2, 1); p(6, y, rgb(c[2]), 4, 1); }
    },
    leaves(g, ox, oy, c, R){   // сплошная листва: тёмная основа, пучки с бликом сверху и тенью снизу, просветы (края скругляет шейдер)
      const p = P(g, ox, oy);
      p(0, 0, rgb(c[1]), 16, 16);
      for (let k = 0; k < 10; k++) {
        const x = R() * 16, y = R() * 16, r = 1.8 + R() * 2.4;
        for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
          if (xx * xx + yy * yy > r * r) continue;
          const X = x + xx | 0, Y = y + yy | 0; if (X < 0 || Y < 0 || X > 15 || Y > 15) continue;
          p(X, Y, rgb(yy < -r * .4 ? c[2] : yy > r * .5 ? c[1] : c[0], yy > r * .5 ? 1.08 : 1));
        }
      }
      for (let i = 0; i < 8; i++) p(R() * 16 | 0, R() * 16 | 0, rgb(c[1], .62));   // просветы
      for (let i = 0; i < 5; i++) p(R() * 16 | 0, R() * 16 | 0, rgb(c[2], 1.12));
    },
    pleaves(g, ox, oy, c, R){
      const p = P(g, ox, oy);
      p(0, 0, rgb(c[1]), 16, 16);
      for (let y = 0; y < 16; y += 2) for (let x = (y >> 1) % 2; x < 16; x += 2) p(x, y, rgb(c[0], .9 + R() * .25), 2, 1);
      for (let i = 0; i < 14; i++) { const x = R() * 16 | 0, y = R() * 5 | 0; p(x, y, rgb(c[2]), 2, 1); }
    },
    cactus(g, ox, oy, c, R){
      g.clearRect(ox, oy, 16, 16);
      const p = P(g, ox, oy); p(3, 0, rgb(c[0]), 10, 16); p(3, 0, rgb(c[1]), 2, 16); p(10, 0, rgb(c[2]), 1, 16);
      for (let y = 1; y < 16; y += 4) { p(2, y, rgb(c[2]), 1, 1); p(13, y + 2, rgb(c[2]), 1, 1); p(7, y + 1, rgb(c[1]), 1, 2); }
    },
    tallgrass(g, ox, oy, c, R){
      g.clearRect(ox, oy, 16, 16);
      const p = P(g, ox, oy), n = 4 + (R() * 4 | 0);
      for (let k = 0; k < n; k++) {
        const x = 1 + (R() * 14 | 0), h = 4 + (R() * 10 | 0), lean = R() < .5 ? -1 : 1, col = R() < .3 ? c[2] : R() < .5 ? c[1] : c[0];
        for (let i = 0; i < h; i++) p(Math.max(0, Math.min(15, x + (i > h * .6 ? lean : 0))), 15 - i, rgb(col));
      }
    },
    flower(g, ox, oy, c, R){
      g.clearRect(ox, oy, 16, 16);
      const p = P(g, ox, oy), x = 5 + (R() * 6 | 0), h = 6 + (R() * 4 | 0);
      const pet = [hex('#ff5d8f'), hex('#ffd84a'), hex('#8ab4ff'), hex('#ffffff'), hex('#ff8a3a')][R() * 5 | 0];
      p(x, 16 - h, rgb(c[0]), 1, h); p(x - 2, 13, rgb(c[0]), 2, 1);
      const y = 16 - h - 2;
      p(x - 1, y, rgb(pet), 3, 3); p(x - 2, y + 1, rgb(pet), 5, 1); p(x, y - 1, rgb(pet), 1, 5); p(x, y + 1, rgb(c[2]), 1, 1);
    },
    vine(g, ox, oy, c, R){
      g.clearRect(ox, oy, 16, 16);
      const p = P(g, ox, oy); let x = 6 + (R() * 4 | 0);
      for (let y = 0; y < 16; y++) { p(x, y, rgb(c[0])); if (y % 4 === 1) { x += R() < .5 ? -1 : 1; p(x + (R() < .5 ? -2 : 1), y, rgb(c[2]), 2, 2); } }
    },
    rope(g, ox, oy, c, R){
      g.clearRect(ox, oy, 16, 16);
      const p = P(g, ox, oy); p(7, 0, rgb(c[0]), 3, 16);
      for (let y = 0; y < 16; y += 3) { p(7, y, rgb(c[1]), 1, 2); p(9, y + 1, rgb(c[2]), 1, 2); }
    },
    ladder(g, ox, oy, c, R){
      g.clearRect(ox, oy, 16, 16);
      const p = P(g, ox, oy); p(2, 0, rgb(c[0]), 2, 16); p(12, 0, rgb(c[0]), 2, 16); p(2, 0, rgb(c[2]), 1, 16);
      for (let y = 2; y < 16; y += 5) { p(4, y, rgb(c[0]), 8, 2); p(4, y + 1, rgb(c[1]), 8, 1); }
    },
    mushroom(g, ox, oy, c, R){
      g.clearRect(ox, oy, 16, 16);
      const p = P(g, ox, oy), x = 4 + (R() * 4 | 0);
      p(x + 2, 10, rgb(c[0]), 3, 6); p(x, 7, rgb(c[1]), 7, 3); p(x + 1, 6, rgb(c[1]), 5, 1); p(x + 1, 7, rgb(c[2]), 1, 1); p(x + 4, 8, rgb(c[2]), 1, 1);
    },
    glowshroom(g, ox, oy, c, R){
      g.clearRect(ox, oy, 16, 16);
      const p = P(g, ox, oy), x = 3 + (R() * 6 | 0), h = 5 + (R() * 4 | 0);
      p(x + 2, 16 - h, rgb(c[0]), 2, h); p(x - 1, 16 - h - 3, rgb(c[1]), 8, 3); p(x, 16 - h - 4, rgb(c[1]), 6, 1); p(x + 1, 16 - h - 3, rgb(c[2]), 3, 1);
    },
    crystal(g, ox, oy, c, R){
      g.clearRect(ox, oy, 16, 16);
      const p = P(g, ox, oy);
      for (let k = 0; k < 3; k++) {
        const x = 3 + (R() * 9 | 0), h = 5 + (R() * 8 | 0);
        for (let i = 0; i < h; i++) { const w = i < 2 ? 1 : 2; p(x, 15 - i, rgb(i > h - 3 ? c[2] : c[0]), w, 1); p(x + w, 15 - i, rgb(c[1]), 1, 1); }
      }
    },
    lamp(g, ox, oy, c, R){   // фонарь: рамка, стекло, свечение (для модов)
      g.clearRect(ox, oy, 16, 16);
      const p = P(g, ox, oy); p(4, 1, rgb(c[1]), 8, 2); p(3, 3, rgb(c[1]), 10, 11); p(4, 4, rgb(c[0]), 8, 9); p(6, 6, rgb(c[2]), 4, 5); p(5, 14, rgb(c[1]), 6, 2);
      p(4, 4, rgb(c[1], 1, .6), 1, 9); p(11, 4, rgb(c[1], 1, .6), 1, 9);
    },
    pot(g, ox, oy, c, R){
      g.clearRect(ox, oy, 16, 16);
      const p = P(g, ox, oy); p(4, 5, rgb(c[0]), 8, 10); p(3, 7, rgb(c[0]), 10, 6); p(5, 3, rgb(c[1]), 6, 2); p(4, 7, rgb(c[2]), 1, 5); p(4, 15, rgb(c[1]), 8, 1);
      p(5, 9, rgb(c[1]), 6, 1);
    },
  };
  // ── Предметы из нескольких клеток: рисуем целиком (w×h клеток по 16 px), потом режем ──
  const OBJ = {
    door(g, x, y, c){ const p = P(g, x, y); p(2, 0, rgb(c[1]), 12, 48); p(3, 1, rgb(c[0]), 10, 46); for (let i = 4; i < 46; i += 8) p(4, i, rgb(c[1], .9), 8, 1); p(11, 22, rgb(c[2]), 2, 3); },
    dooropen(g, x, y, c){ const p = P(g, x, y); p(1, 0, rgb(c[1]), 4, 48); p(2, 1, rgb(c[0]), 2, 46); p(4, 0, rgb(c[1], .7), 2, 48); },
    chest(g, x, y, c){ const p = P(g, x, y); p(2, 8, rgb(c[1]), 28, 24); p(3, 9, rgb(c[0]), 26, 22); p(2, 14, rgb(c[1]), 28, 2); p(3, 4, rgb(c[0]), 26, 5); p(2, 4, rgb(c[1]), 28, 1);
      p(14, 13, rgb(c[2]), 4, 5); p(15, 15, rgb(c[1]), 2, 2); p(3, 9, rgb(c[2], 1, .8), 2, 22); p(27, 9, rgb(c[2], 1, .8), 2, 22); },
    workbench(g, x, y, c){ const p = P(g, x, y); p(0, 2, rgb(c[0]), 32, 4); p(0, 2, rgb(c[2]), 32, 1); p(0, 6, rgb(c[1]), 32, 1); p(2, 6, rgb(c[1]), 3, 10); p(27, 6, rgb(c[1]), 3, 10); p(6, 10, rgb(c[0], .8), 20, 2); },
    furnace(g, x, y, c){ const p = P(g, x, y); p(2, 4, rgb(c[0]), 44, 28); p(2, 4, rgb(c[0], 1.2), 44, 2); for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) p(3 + i * 9 + (j % 2) * 4, 7 + j * 6, rgb(c[1]), 7, 1);
      p(14, 16, rgb(c[1], .6), 20, 14); p(16, 20, rgb(c[2]), 16, 10); p(18, 24, rgb([255, 230, 120]), 12, 5); p(20, 0, rgb(c[1]), 8, 5); },
    anvil(g, x, y, c){ const p = P(g, x, y); p(2, 3, rgb(c[0]), 28, 5); p(0, 3, rgb(c[0]), 4, 3); p(2, 3, rgb(c[2]), 28, 1); p(10, 8, rgb(c[1]), 12, 4); p(6, 12, rgb(c[0]), 20, 4); },
    bed(g, x, y, c){ const p = P(g, x, y); p(0, 8, rgb(c[0]), 48, 5); p(0, 2, rgb(c[0]), 4, 14); p(44, 4, rgb(c[0]), 4, 12); p(4, 5, rgb(c[2]), 9, 4); p(13, 5, rgb(c[1]), 31, 4); p(13, 5, rgb(c[1], 1.2), 31, 1); },
    lifecrystal(g, x, y, c){ const p = P(g, x, y);
      for (let yy = 0; yy < 28; yy++) for (let xx = 0; xx < 28; xx++) {
        const u = (xx - 14) / 13, v = (yy - 12) / 13, heart = (u * u + v * v - .5) ** 3 - u * u * v * v * v < 0;
        if (heart) p(2 + xx, 2 + yy, rgb(yy < 10 ? c[1] : c[0], .9 + (xx + yy) % 3 * .06));
      }
      p(9, 8, rgb(c[2]), 4, 3); p(4, 28, rgb([90, 90, 100]), 24, 4); },
    loot(g, x, y, c){ OBJ.chest(g, x, y, c); const p = P(g, x, y); p(2, 4, rgb(c[2]), 28, 1); p(2, 31, rgb(c[2]), 28, 1); },
  };
  // ── Значки предметов ──
  const ICON = {
    pick(p, c){ for (let i = 0; i < 11; i++) p(3 + i, 13 - i, rgb([120, 80, 45])); p(2, 2, rgb(c), 5, 2); p(6, 1, rgb(c), 5, 2); p(10, 2, rgb(c), 3, 3); p(12, 5, rgb(c), 2, 4); p(2, 2, rgb(c, 1.3), 4, 1); },
    axe(p, c){ for (let i = 0; i < 12; i++) p(3 + i, 14 - i, rgb([120, 80, 45])); p(8, 1, rgb(c), 5, 7); p(7, 2, rgb(c), 1, 5); p(12, 2, rgb(c, 1.3), 1, 5); },
    hammer(p, c){ for (let i = 0; i < 11; i++) p(3 + i, 14 - i, rgb([120, 80, 45])); p(7, 1, rgb(c), 8, 5); p(7, 1, rgb(c, 1.3), 8, 1); },
    sword(p, c){ for (let i = 0; i < 10; i++) { p(5 + i, 10 - i, rgb(c)); p(6 + i, 10 - i, rgb(c, 1.25)); } p(2, 10, rgb([200, 160, 60]), 6, 2); p(3, 11, rgb([120, 80, 45]), 2, 4); },
    bow(p, c){ for (let i = 0; i < 14; i++) { const x = 3 + Math.round(4 * Math.sin(i / 13 * Math.PI)); p(x, 1 + i, rgb(c)); } p(3, 1, rgb([230, 230, 230]), 1, 14); },
    arrow(p, c){ for (let i = 0; i < 12; i++) p(2 + i, 13 - i, rgb([170, 120, 70])); p(12, 1, rgb(c), 3, 3); p(1, 12, rgb([240, 240, 240]), 3, 3); },
    wand(p, c){ for (let i = 0; i < 10; i++) p(3 + i, 14 - i, rgb([90, 60, 120])); p(11, 2, rgb(c), 4, 4); p(12, 3, rgb([255, 255, 255]), 2, 2); },
    bar(p, c){ p(2, 7, rgb(c, .75), 12, 5); p(3, 5, rgb(c), 11, 3); p(3, 5, rgb(c, 1.35), 10, 1); },
    gem(p, c){ p(5, 3, rgb(c, 1.3), 6, 2); p(3, 5, rgb(c), 10, 3); p(4, 8, rgb(c, .85), 8, 2); p(5, 10, rgb(c, .7), 6, 2); p(7, 12, rgb(c, .6), 2, 2); p(5, 5, rgb([255, 255, 255], 1, .8), 2, 2); },
    gel(p, c){ p(4, 6, rgb(c, 1, .85), 8, 7); p(5, 4, rgb(c, 1, .85), 6, 2); p(6, 6, rgb([255, 255, 255], 1, .8), 2, 2); },
    fiber(p, c){ for (let k = 0; k < 4; k++) for (let i = 0; i < 12; i++) p(3 + k * 3 + (i % 3 === 0 ? 1 : 0), 2 + i, rgb(c, .9 + k * .05)); },
    membrane(p, c){ p(2, 5, rgb(c), 12, 6); p(4, 3, rgb(c), 8, 2); p(2, 5, rgb(c, .6), 1, 6); p(13, 5, rgb(c, .6), 1, 6); },
    feather(p, c){ for (let i = 0; i < 12; i++) { p(3 + i, 13 - i, rgb(c, .8)); p(4 + i, 11 - i, rgb(c)); p(2 + i, 12 - i, rgb(c, 1.15)); } },
    bottle(p, c){ p(5, 6, rgb(c, 1, .7), 6, 8); p(6, 3, rgb(c, 1, .8), 4, 3); p(6, 2, rgb([160, 110, 70]), 4, 1); p(6, 7, rgb([255, 255, 255], 1, .7), 1, 5); },
    potion(p, c){ ICON.bottle(p, [190, 230, 255]); p(5, 9, rgb(c), 6, 5); p(6, 9, rgb(c, 1.3), 1, 3); },
    mushroom(p, c){ p(6, 9, rgb([232, 224, 208]), 4, 6); p(3, 5, rgb(c), 10, 4); p(4, 4, rgb(c), 8, 1); p(5, 5, rgb([255, 255, 255]), 2, 1); p(9, 6, rgb([255, 255, 255]), 1, 1); },
    heart(p, c){ for (let y = 0; y < 12; y++) for (let x = 0; x < 14; x++) { const u = (x - 6.5) / 6.5, v = (y - 5) / 6.5; if ((u * u + v * v - .5) ** 3 - u * u * v * v * v < 0) p(1 + x, 2 + y, rgb(y < 5 ? mixc(c, [255, 255, 255], .3) : c)); } },
    star(p, c){ const pts = [[8, 1], [10, 6], [15, 6], [11, 9], [13, 14], [8, 11], [3, 14], [5, 9], [1, 6], [6, 6]]; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } if (ins) p(x, y, rgb(c, y < 7 ? 1.2 : 1)); } },
    bait(p, c){ p(3, 6, rgb(c, 1, .9), 10, 7); p(5, 4, rgb(c), 6, 2); p(7, 1, rgb([240, 200, 60]), 2, 3); p(5, 8, rgb([20, 30, 40]), 2, 2); p(9, 8, rgb([20, 30, 40]), 2, 2); },
    lure(p, c){ p(4, 3, rgb(c), 8, 10); p(6, 1, rgb([120, 80, 45]), 4, 3); p(5, 6, rgb([40, 30, 20]), 2, 2); p(9, 6, rgb([40, 30, 20]), 2, 2); p(7, 9, rgb([240, 180, 60]), 2, 2); },
    amulet(p, c){ for (let i = 0; i < 8; i++) { p(3 + i, 1 + (i < 4 ? i : 7 - i), rgb([230, 200, 90])); } p(5, 7, rgb(c), 6, 6); p(6, 8, rgb([255, 255, 255], 1, .8), 2, 2); },
    boots(p, c){ p(3, 3, rgb(c), 5, 9); p(3, 10, rgb(c), 10, 4); p(3, 13, rgb([40, 40, 50]), 10, 2); p(4, 4, rgb(c, 1.3), 1, 7); },
    wings(p, c){ for (let i = 0; i < 7; i++) { p(1 + i, 3 + i, rgb(c), 6 - (i >> 1), 2); p(9 + (i >> 1), 3 + i, rgb(c), 6 - (i >> 1), 2); } p(7, 4, rgb([120, 80, 45]), 2, 8); },
    torch(p){   // факел в вещах: ручка, обмотка и пламя (в мире пламя живое — SPR.flame)
      p(7, 7, rgb([122, 75, 38]), 2, 9); p(7, 7, rgb([158, 104, 56]), 1, 9); p(6, 6, rgb([70, 46, 30]), 4, 2);
      p(6, 2, rgb([255, 132, 40]), 4, 4); p(5, 3, rgb([226, 78, 26]), 1, 3); p(10, 3, rgb([226, 78, 26]), 1, 3); p(7, 0, rgb([255, 150, 50]), 2, 2);
      p(7, 2, rgb([255, 222, 120]), 2, 4); p(7, 3, rgb([255, 250, 214]), 1, 2);
    },
    hook(p, c){   // крюк-кошка: стержень, три зубца, кольцо и кусок верёвки
      for (let i = 0; i < 8; i++) p(5 + i, 11 - i, rgb(c, .85));
      p(11, 1, rgb(c), 2, 5); p(12, 1, rgb(c, 1.35), 1, 3); p(9, 3, rgb(c), 2, 2); p(8, 2, rgb(c), 1, 2); p(13, 5, rgb(c), 2, 2); p(14, 4, rgb(c), 1, 2);
      p(3, 11, rgb(c, .7), 3, 3); p(4, 12, rgb([30, 30, 34]), 1, 1);
      for (let i = 0; i < 4; i++) p(i, 13 + (i & 1), rgb([170, 120, 70]), 1, 1);
    },
    flint(p, c){   // огниво (T-022d): стальное кресало скобой, кремень и искры
      p(2, 10, rgb(c, .75), 9, 2); p(2, 7, rgb(c), 2, 4); p(9, 7, rgb(c), 2, 4); p(3, 10, rgb(c, 1.3), 7, 1); p(2, 7, rgb(c, 1.3), 1, 3);
      p(9, 2, rgb([84, 82, 92]), 5, 4); p(10, 1, rgb([118, 116, 128]), 3, 1); p(10, 2, rgb([150, 148, 162]), 2, 1); p(13, 3, rgb([60, 58, 66]), 1, 3);
      p(7, 4, rgb([255, 214, 96])); p(6, 2, rgb([255, 150, 50])); p(8, 1, rgb([255, 244, 170])); p(5, 5, rgb([255, 120, 40]));
    },
  };
  // ── Спрайты (мобы, боссы, снаряды, эффекты): имя → [w, h, кадров, рисовать(g, x, y, кадр)] ──
  // желе (слизни): полупрозрачный купол — тёмная кромка, низ темнее, блик сверху слева, ядро, пузырьки, глаза с бликом.
  // Серое — красится цветом вершин (у каждого слизня свой). k — толщина «пикселя» (великан — 2)
  function jelly(g, x, y, W, H, sq, k){
    const p = P(g, x, y), w = W - 4 * k + sq, h = H - 6 * k - sq, ox = (W - w) >> 1, oy = H - h, R = Math.round;
    // купол: низ (четверть) во всю ширину, выше — по дуге
    const inside = (xx, yy) => { if (xx < 0 || xx >= w || yy < 0 || yy >= h) return false; const v = (h - yy - .5) / h, q = v > .3 ? (v - .3) / .7 : 0, hw = w / 2 * Math.sqrt(Math.max(0, 1 - q * q)); return Math.abs(xx + .5 - w / 2) <= hw; };
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      if (!inside(xx, yy)) continue;
      const edge = !inside(xx - k, yy) || !inside(xx + k, yy) || !inside(xx, yy - k) || yy >= h - k;
      const gl = yy < h * .3 && xx > w * .14 && xx < w * .48 && inside(xx, yy - 2 * k);
      let c = 236 - yy / h * 56 | 0, a = .8;
      if (edge) { c = 128; a = .96; } else if (gl) { c = 255; a = .92; }
      p(ox + xx, oy + yy, `rgba(${c},${c},${c},${a})`);
    }
    const cx = ox + w * .5, cy = oy + h * .64, rx = w * .17, ry = h * .17;
    for (let yy = -ry; yy <= ry; yy++) for (let xx = -rx; xx <= rx; xx++) if ((xx * xx) / (rx * rx) + (yy * yy) / (ry * ry) <= 1) p(R(cx + xx), R(cy + yy), 'rgba(110,110,120,.2)');
    p(R(ox + w * .72), R(oy + h * .5), 'rgba(255,255,255,.75)', k, k); p(R(ox + w * .27), R(oy + h * .74), 'rgba(255,255,255,.55)', k, k);
    const ey = oy + R(h * .3), e = Math.max(3, R(3 * k));
    p(ox + R(w * .22), ey, '#1a1a22', e, e + k); p(ox + R(w * .64), ey, '#1a1a22', e, e + k);
    p(ox + R(w * .22), ey, '#fff', k, k); p(ox + R(w * .64), ey, '#fff', k, k);
    p(ox + R(w * .42), ey + e + 2 * k, '#1a1a22', R(w * .16), k);
  }
  // тёмный контур по краю непрозрачного (как у спрайтов Террарии) — только внутри кадра
  function outline(g, x, y, w, h){
    const im = g.getImageData(x, y, w, h), d = im.data, a = i => d[i * 4 + 3];
    const add = [];
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const i = yy * w + xx; if (a(i) > 40) continue;
      if ((xx > 0 && a(i - 1) > 160) || (xx < w - 1 && a(i + 1) > 160) || (yy > 0 && a(i - w) > 160) || (yy < h - 1 && a(i + w) > 160)) add.push(i);
    }
    for (const i of add) { d[i * 4] = 18; d[i * 4 + 1] = 16; d[i * 4 + 2] = 24; d[i * 4 + 3] = 170; }
    g.putImageData(im, x, y);
  }
  const OUTLINED = new Set(['zombie', 'bat', 'crawler', 'imp', 'owl', 'person']);
  const SPR = {
    white: [4, 4, 1, (g, x, y) => { g.fillStyle = '#fff'; g.fillRect(x, y, 4, 4); }],
    slime: [26, 20, 3, (g, x, y, f) => jelly(g, x, y, 26, 20, [0, 3, -2][f], 1)],   // серый — красится цветом вершин
    zombie: [20, 44, 4, (g, x, y, f) => {   // рваная рубаха, сквозь дыры — кожа, светящиеся глаза, руки вперёд качаются
      const p = P(g, x, y), sw = [0, 2, 0, -2][f], st = f % 2, skin = '#7fae6a', sk2 = '#5f8f50', dk = '#46703c', shirt = '#4a6a9a', sh2 = '#36507a', pants = '#4a3a2e', pa2 = '#352a20';
      p(6, 0, skin, 9, 9); p(6, 0, dk, 9, 2); p(6, 2, sk2, 1, 7); p(14, 2, sk2, 1, 7);   // голова
      p(7, 3, '#20301a', 3, 3); p(11, 3, '#20301a', 3, 3); p(8, 4, '#f2ea60', 1, 1); p(12, 4, '#f2ea60', 1, 1);   // глазницы и глаза
      p(8, 7, '#3a2a20', 5, 1); p(9, 7, '#d8d0b0', 1, 1); p(11, 7, '#d8d0b0', 1, 1); p(10, 1, '#8fc07a', 3, 1);
      p(5, 9, shirt, 11, 15); p(5, 9, sh2, 11, 2); p(5, 9, sh2, 1, 15); p(7, 13, skin, 2, 3); p(12, 18, skin, 2, 2); p(8, 21, sh2, 4, 1);   // рубаха с дырами
      p(5, 22, '#2a2018', 11, 2); p(10, 22, '#8a7a40', 1, 2);   // ремень
      for (let i = 0; i < 5; i++) p(5 + i * 2 + (i % 2), 24, sh2, 1, 2);   // рваный край
      p(13, 11 + st, skin, 7, 3); p(13, 13 + st, sk2, 7, 1); p(14 + sw, 15 - st, skin, 6, 3); p(18 + sw, 15 - st, sk2, 2, 3);   // руки вперёд
      p(6, 25, pants, 4, 15 + st); p(11, 25, pants, 4, 15 - st); p(6, 25, pa2, 1, 15 + st); p(7, 31, '#5a4a3a', 2, 2);
      p(6 - sw, 40, '#2a2420', 5, 4); p(11 + sw, 40, '#2a2420', 5, 4); p(6 - sw, 40, '#3a3430', 5, 1); p(11 + sw, 40, '#3a3430', 5, 1);
    }],
    bat: [26, 14, 4, (g, x, y, f) => {   // уши, клыки, перепонки с «пальцами»
      const p = P(g, x, y), wy = [0, 4, 7, 4][f];
      for (let i = 0; i < 10; i++) {
        const yy = 4 + Math.round(wy * (1 - i / 10)) - (i < 3 ? 1 : 0), Y = Math.max(0, Math.min(11, yy)), hh = 3 + (i % 3 === 2 ? 1 : 0);
        p(9 - i, Y, '#5a4a6a', 1, hh); p(16 + i, Y, '#5a4a6a', 1, hh);
        if (i % 3 === 2) { p(9 - i, Y, '#3a2e4a', 1, 1); p(16 + i, Y, '#3a2e4a', 1, 1); }   // «пальцы» крыла
      }
      p(10, 4, '#4a3a5a', 6, 7); p(10, 4, '#5e4c70', 6, 2); p(10, 2, '#4a3a5a', 2, 2); p(14, 2, '#4a3a5a', 2, 2); p(10, 1, '#4a3a5a', 1, 1); p(15, 1, '#4a3a5a', 1, 1);
      p(11, 6, '#ff4040', 1, 1); p(14, 6, '#ff4040', 1, 1); p(12, 9, '#f0f0f0', 1, 1); p(13, 9, '#f0f0f0', 1, 1);
    }],
    crawler: [28, 14, 4, (g, x, y, f) => {   // жук: панцирь из сегментов с бликом, голова с жвалами, 6 лапок
      const p = P(g, x, y);
      for (let i = 0; i < 3; i++) { const lx = 6 + i * 6, ph = (f + i) % 4, dy = ph === 1 ? -1 : ph === 3 ? 1 : 0; p(lx - 1 + (ph < 2 ? 0 : 1), 10, '#2e241c', 1, 3 + dy); p(lx + 2 - (ph < 2 ? 0 : 1), 10, '#2e241c', 1, 3 - dy); }
      p(4, 3, '#5a4a3a', 18, 8); p(5, 2, '#5a4a3a', 16, 1);
      for (let s = 0; s < 3; s++) { p(5 + s * 6, 3, '#7a6a52', 5, 2); p(5 + s * 6, 4, '#8f7e62', 2, 1); p(10 + s * 6, 3, '#3e3226', 1, 7); }
      p(4, 9, '#3e3226', 18, 1);
      p(22, 4, '#3a2e24', 5, 6); p(22, 4, '#4e4030', 4, 1); p(24, 6, '#ff7a3a', 2, 1); p(26, 9, '#d8c8a0', 2, 1); p(26, 7, '#d8c8a0', 1, 1);   // голова, глаз, жвала
    }],
    imp: [24, 24, 3, (g, x, y, f) => {   // рога, хвост, крылья машут
      const p = P(g, x, y), w = [-2, 0, 2][f];
      p(0, 8 + w, '#7a2a20', 7, 4); p(1, 7 + w, '#5a1e16', 5, 1); p(17, 8 + w, '#7a2a20', 7, 4); p(18, 7 + w, '#5a1e16', 5, 1);
      p(2, 12 + w, '#5a1e16', 1, 2); p(21, 12 + w, '#5a1e16', 1, 2);
      p(7, 6, '#c03a2a', 10, 12); p(8, 3, '#c03a2a', 8, 4); p(7, 6, '#9a2c20', 1, 12); p(16, 6, '#e05a3a', 1, 10); p(10, 12, '#e0704a', 4, 4);
      p(8, 0, '#ffa040', 2, 3); p(7, 0, '#ffd080', 1, 1); p(14, 0, '#ffa040', 2, 3); p(16, 0, '#ffd080', 1, 1);   // рога
      p(9, 5, '#ffe060', 2, 2); p(13, 5, '#ffe060', 2, 2); p(10, 5, '#fff8c0', 1, 1); p(14, 5, '#fff8c0', 1, 1); p(10, 8, '#5a1e16', 4, 1); p(11, 8, '#fff', 1, 1); p(13, 8, '#fff', 1, 1);
      p(9, 18, '#7a2a20', 2, 5); p(13, 18, '#7a2a20', 2, 5);
      p(17, 16, '#9a2c20', 3, 1); p(19, 17 + (f === 1 ? 1 : 0), '#9a2c20', 2, 1); p(21, 16, '#ff6a3a', 2, 2);   // хвост
    }],
    bigslime: [96, 72, 3, (g, x, y, f) => {   // великан: то же желе крупно + корона с камнем
      const sq = [0, 6, -4][f], w = 88 + sq, h = 60 - sq, ox = (96 - w) >> 1, oy = 72 - h;
      jelly(g, x, y, 96, 72, sq, 2);
      const p = P(g, x, y);
      for (let i = 0; i < 5; i++) { p(ox + w * .3 + i * 7, oy - 6 + (i % 2) * 3, 'rgba(255,214,60,.98)', 5, 9); p(ox + w * .3 + i * 7, oy - 6 + (i % 2) * 3, 'rgba(255,248,170,1)', 2, 2); }
      p(ox + w * .3, oy + 1, 'rgba(200,150,30,1)', 33, 3); p(ox + w * .3 + 14, oy - 3, 'rgba(230,40,70,1)', 5, 5); p(ox + w * .3 + 15, oy - 2, 'rgba(255,190,200,1)', 2, 2);
    }],
    owl: [64, 56, 3, (g, x, y, f) => {
      const p = P(g, x, y), wy = [0, 10, 18][f];
      for (let i = 0; i < 22; i++) { const yy = 18 + Math.round(wy * (1 - i / 22)) - (i > 15 ? 2 : 0); p(20 - i, Math.max(0, yy), '#8a6a4a', 1, 14 - (i >> 2)); p(43 + i, Math.max(0, yy), '#8a6a4a', 1, 14 - (i >> 2)); }
      p(20, 10, '#a8865e', 24, 34); p(22, 6, '#a8865e', 20, 6); p(21, 4, '#a8865e', 4, 3); p(39, 4, '#a8865e', 4, 3);
      p(24, 12, '#f2d060', 7, 7); p(33, 12, '#f2d060', 7, 7); p(26, 14, '#141420', 3, 3); p(35, 14, '#141420', 3, 3); p(30, 19, '#e0a030', 4, 4);
      p(24, 24, '#d8c8a8', 16, 18); for (let i = 0; i < 4; i++) p(25 + i * 4, 28 + (i % 2) * 5, '#a8865e', 2, 2);
      p(25, 44, '#e0a030', 4, 6); p(35, 44, '#e0a030', 4, 6);
    }],
    person: [20, 44, 2, (g, x, y, f) => {   // запасной человечек (пока печётся 2D-персонаж сайта)
      const p = P(g, x, y); p(6, 0, '#f0c8a0', 9, 9); p(6, 0, '#5a3a20', 9, 3); p(8, 4, '#222', 1, 2); p(12, 4, '#222', 1, 2);
      p(5, 9, '#4f8df7', 11, 15); p(3, 10, '#f0c8a0', 2, 10); p(16, 10, '#f0c8a0', 2, 10);
      p(6, 24, '#3a4a6a', 4, 17 + f); p(11, 24, '#3a4a6a', 4, 17 - f); p(5, 40, '#2a2a30', 5, 4); p(11, 40, '#2a2a30', 5, 4);
    }],
    // живое пламя (факелы, печь, факел в руке): 8 кадров «языка» — капля, жарче в середине и снизу, кончик гуляет,
    // в части кадров сверху отрывается искра. Рисуется без света сцены (огонь светит сам), поверх — мягкий ореол
    flame: [8, 14, 8, (g, x, y, f) => {
      const p = P(g, x, y), R = rng(901 + f * 17);
      const Hh = 10 + (R() * 3.99 | 0), lean = (R() - .5) * 2;
      for (let yy = 0; yy < 14; yy++) {
        const h = 13 - yy; if (h > Hh) continue;
        const u = h / Hh, half = 3.2 * Math.pow(Math.sin(Math.PI * (u * .8 + .2)), .65) * (1 - u * .3);
        const cx = 4 + lean * u * u + Math.sin(f * .785 + u * 4.5) * .6 * u;
        for (let xx = 0; xx < 8; xx++) {
          const d = Math.abs(xx + .5 - cx) / Math.max(.6, half); if (d > 1) continue;
          const t = (1 - d) * (1 - u * .85);
          p(xx, yy, t > .6 ? 'rgba(255,250,220,1)' : t > .4 ? 'rgba(255,226,120,1)' : t > .2 ? 'rgba(255,152,48,.96)' : 'rgba(230,82,26,.85)');
        }
      }
      if (f % 3 === 1) { const ty = 13 - Hh - 1 - (R() * 2 | 0), tx = 3 + (R() * 2.99 | 0); if (ty >= 0) p(tx, ty, 'rgba(255,150,46,.9)'); }
    }],
    arrowp: [16, 4, 1, (g, x, y) => { const p = P(g, x, y); p(0, 1, '#eee', 3, 2); p(3, 1, '#a87848', 10, 2); p(13, 0, '#ccc', 3, 4); }],
    spark: [8, 8, 2, (g, x, y, f) => { const p = P(g, x, y); p(2, 2, f ? '#ffd0ff' : '#ff8af0', 4, 4); p(3, 0, '#fff', 2, 8); p(0, 3, '#fff', 8, 2); }],
    fireball: [10, 10, 2, (g, x, y, f) => { const p = P(g, x, y); p(1, 1, '#ff5a1a', 8, 8); p(2, 2, '#ffb030', 6, 6); p(3 + f, 3, '#fff2a0', 3, 3); }],
    featherp: [14, 6, 1, (g, x, y) => { const p = P(g, x, y); p(0, 2, '#d8c8a8', 12, 2); p(2, 1, '#a8865e', 8, 1); p(2, 4, '#a8865e', 8, 1); p(12, 2, '#6a4a2a', 2, 2); }],
    crack: [16, 16, 4, (g, x, y, f) => {
      const p = P(g, x, y), R = rng(77 + f);
      for (let k = 0; k <= f; k++) { let cx = 8, cy = 8; for (let i = 0; i < 6 + f * 2; i++) { cx += R() < .5 ? -1 : 1; cy += R() < .5 ? -1 : 1; p(Math.max(0, Math.min(15, cx)), Math.max(0, Math.min(15, cy)), 'rgba(0,0,0,.75)'); } }
    }],
    frame: [16, 16, 1, (g, x, y) => { g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, 15, 15); g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeRect(x + 1.5, y + 1.5, 13, 13); }],
    sun: [8, 8, 1, (g, x, y) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 4, y + 4, 4, 0, Math.PI * 2); g.fill(); }],
  };

  // ═══ Атлас: блоки (по 4 варианта), стены, предметы, спрайты ═══
  // mods: { tiles: [{ id, pat?, c?, img? }], walls: [...], items: [{ key, icon? , img? }] } — блоки и предметы модов
  function paint(PZ, mods = {}){
    const cv = document.createElement('canvas'); cv.width = AS; cv.height = AS;
    const g = cv.getContext('2d', { willReadFrequently: false });
    g.imageSmoothingEnabled = false;
    let cell = 0;
    const take = n => { const c0 = cell; cell += n; return c0; };
    const cxy = c => [(c % AN) * 16, (c / AN | 0) * 16];
    const out = { canvas: cv, tile: new Int32Array(256).fill(-1), wall: new Int32Array(256).fill(-1), item: {}, spr: {}, objCell: {} };
    function tileTex(t, c0){
      const c = (t.c || ['#888', '#666', '#aaa']).map(hex);
      if (t.k === 'obj') {
        const [w, h] = t.sz;
        const tmp = document.createElement('canvas'); tmp.width = w * 16; tmp.height = h * 16;
        const tg = tmp.getContext('2d'); tg.imageSmoothingEnabled = false;
        (OBJ[t.pat] || OBJ.chest)(tg, 0, 0, c);
        for (let fy = 0; fy < h; fy++) for (let fx = 0; fx < w; fx++) { const [x, y] = cxy(c0 + fx + fy * w); g.drawImage(tmp, fx * 16, fy * 16, 16, 16, x, y, 16, 16); }
        return tmp;
      }
      for (let v = 0; v < 4; v++) {
        const [x, y] = cxy(c0 + v);
        g.save(); g.beginPath(); g.rect(x, y, 16, 16); g.clip();
        if (t.img) g.drawImage(t.img, x, y, 16, 16);
        else (PAT[t.pat] || PAT.dirt)(g, x, y, c, rng(strSeed((t.key || '') + ':' + v)));
        g.restore();
      }
      return null;
    }
    const objImg = {};
    for (const t of PZ.TILES) {
      if (!t || !t.id || t.id >= PZ.MOD_ID0) continue;   // блоки модов — ниже (с их картинками)
      const n = t.k === 'obj' ? t.sz[0] * t.sz[1] : 4;
      const c0 = take(n); out.tile[t.id] = c0;
      const im = tileTex(t, c0); if (im) objImg[t.key] = im;
    }
    for (const t of mods.tiles || []) { const c0 = take(4); out.tile[t.id] = c0; tileTex(t, c0); }
    for (const w of PZ.WALLS) {
      if (!w || !w.id) continue;
      const c0 = take(4); out.wall[w.id] = c0;
      tileTex(Object.assign({}, w, { k: 'block' }), c0);
    }
    // значки предметов
    const iconOf = (it, x, y) => {
      g.clearRect(x, y, 16, 16);
      const p = P(g, x, y);
      if (it.img) { g.drawImage(it.img, x, y, 16, 16); return; }
      if (it.icon && ICON[it.icon[0]]) { ICON[it.icon[0]](p, hex(it.icon[1])); return; }
      if (it.kind === 'tile' && PZ.TILE[it.tile] !== undefined || it.tileId) {
        const t = it.tileId ? null : PZ.TILE[it.tile], id = it.tileId || t.id;
        if (t && t.k === 'obj') { const im = objImg[t.key]; if (im) { const k = Math.min(14 / im.width, 14 / im.height); g.drawImage(im, x + 8 - im.width * k / 2, y + 8 - im.height * k / 2, im.width * k, im.height * k); } return; }
        const [sx, sy] = cxy(out.tile[id]);
        if (t && (t.k === 'plant' || t.k === 'torch' || t.k === 'plat')) { g.drawImage(cv, sx, sy, 16, 16, x, y, 16, 16); return; }
        g.drawImage(cv, sx, sy, 16, 16, x + 2, y + 2, 12, 12);
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + 2, y + 13, 12, 1); g.fillRect(x + 13, y + 2, 1, 12);
        return;
      }
      if (it.kind === 'wall') {
        const w = PZ.WALL[it.wall]; const [sx, sy] = cxy(out.wall[w.id]);
        g.drawImage(cv, sx, sy, 16, 16, x + 1, y + 1, 14, 14);
        g.strokeStyle = 'rgba(255,255,255,.55)'; g.strokeRect(x + 1.5, y + 1.5, 13, 13);
        return;
      }
      p(4, 4, '#888', 8, 8);
    };
    const items = [...PZ.ITEM_LIST, ...(mods.items || [])];
    for (const it of items) { const c0 = take(1); out.item[it.key] = c0; const [x, y] = cxy(c0); iconOf(it, x, y); }
    // спрайты: полки ниже ячеек
    let sx = 0, sy = Math.max(SPR_Y, (Math.ceil(cell / AN) + 1) * 16), rowH = 0;
    for (const [name, [w, h, n, draw]] of Object.entries(SPR)) {
      const fr = [];
      for (let f = 0; f < n; f++) {
        if (sx + w > AS) { sx = 0; sy += rowH + 2; rowH = 0; }
        g.save(); g.beginPath(); g.rect(sx, sy, w, h); g.clip(); draw(g, sx, sy, f); g.restore();
        if (OUTLINED.has(name)) outline(g, sx, sy, w, h);
        fr.push([sx, sy, w, h]); sx += w + 2; rowH = Math.max(rowH, h);
      }
      out.spr[name] = fr;
    }
    out.cells = cell;
    return out;
  }
  // значок предмета → dataURL (для интерфейса): кэш
  function iconCanvas(atlas){
    // лист значков: та же картинка атласа, CSS берёт фон с позицией
    return atlas.canvas.toDataURL('image/png');
  }

  // ═══ WebGL2 ═══
  const VS_CHUNK = `#version 300 es
layout(location = 0) in vec2 aP;
uniform vec2 uOff, uScale;
out vec2 vT;
out vec2 vS;   // клетки от камеры (для параллакса фона пещер)
void main(){ vT = aP * 64.0; vS = uOff + vT; vec2 p = vS * uScale; gl_Position = vec4(p.x, -p.y, 0.0, 1.0); }`;
  // ── Чанк, «красивый»: свет как в Террарии (режим «Цвет») и дальше — по качеству uQ (0 низкое … 3 ультра):
  // 1+ мерцание огня, тень у стен (контактная), волны и блик воды; 2+ объём по свету (рельеф текстур и кромки к свету),
  // лучи в воде, параллакс фона пещер. Сломается на телефоне (не соберётся / рисует чёрным) — renderer() берёт FS_CHUNK_BASIC.
  // smoothstep — только с edge0 < edge1 (иначе на части видеокарт неопределённо). Общие куски (шум, кривая света и мерцание,
  // тень у стен, гладь, лучи, лава) — из js/engine/shade2d.js (D37E.shade2d.GLSL): их же возьмут другие 2D-игры.
  const S2 = (typeof window !== 'undefined' && window.D37E && window.D37E.shade2d && window.D37E.shade2d.GLSL) || null;
  // волны «вида сбоку» (js/engine/waves.js GLSL1 — та же сумма волн, что F.at1 в JS); нет модуля — та же формула здесь (uW1H = 0 — волн нет)
  const W1 = (typeof window !== 'undefined' && window.D37E && window.D37E.waves && window.D37E.waves.GLSL1) || 'float d37w1( float x ){ vec4 th = uW1K * x + uW1P; return dot( uW1A, sin( th ) ); }';
  const FS_CHUNK_HQ = !S2 ? null : `#version 300 es
precision highp float; precision highp int; precision highp usampler2D; precision highp sampler2D;
uniform usampler2D uT0, uT1, uProps;
uniform sampler2D uLight, uAtlas, uDyn;
uniform ivec2 uOrg;
uniform ivec2 uDynOrg;  // карта «живого» света (герой, факел в руке, снаряды): мировая клетка левого верха
uniform vec2 uDynSize;  // и её размер в клетках
uniform vec3 uSky;
uniform float uAmb, uTime;
uniform float uScat;    // свет, рассеянный в воздухе вокруг огня (0 — нет)
uniform vec2 uCamP;     // камера × 0,65 (по модулю 1020) — параллакс фона пещер
uniform int uPass, uSmooth, uBack, uQ;
uniform vec4 uW1K, uW1A, uW1P;   // волны (js/engine/waves.js, «вид сбоку»): k·направление, амплитуды, фазы от начала отсчёта uW1O
uniform int uW1O;
uniform float uW1H;              // сумма амплитуд (0 — волн нет)
in vec2 vT;
in vec2 vS;
out vec4 oC;
${S2.noise}
${S2.light}
${S2.aoWall}
${S2.water}
${W1}
// волны на глади: под открытым небом (свет неба в клетке) или в большом озере (доля клетки — биты 1–7 канала a, podzem.js wvRows);
// между серединами клеток — плавно (как waveK в podzem.js); соседняя клетка за краем чанка — «озеро» края
float pzSkyK( ivec2 cc ){ return smoothstep( 0.3, 0.8, texelFetch( uLight, clamp( cc + 1, ivec2( 0 ), ivec2( 65 ) ), 0 ).a ); }
float pzBigK( ivec2 cc ){ return float( ( texelFetch( uT1, clamp( cc, ivec2( 0 ), ivec2( 63 ) ), 0 ).a >> 1u ) & 127u ) / 127.0; }
float pzWaveK( int cy, float x ){
  float fx = x - 0.5, i0 = floor( fx ), u = fx - i0; int ix = int( i0 );
  return mix( max( pzSkyK( ivec2( ix, cy ) ), pzBigK( ivec2( ix, cy ) ) ), max( pzSkyK( ivec2( ix + 1, cy ) ), pzBigK( ivec2( ix + 1, cy ) ) ), u );
}
vec4 at(int cell, ivec2 px){ return texelFetch(uAtlas, ivec2((cell % ${AN}) * 16 + px.x, (cell / ${AN}) * 16 + px.y), 0); }
// свет клетки: карта чанка (небо, факелы, лава) и «живой» свет — что ярче (по каналам)
vec4 Lraw(vec2 p){
  vec4 L = uSmooth == 1 ? texture(uLight, (p + 1.0) / 66.0) : texelFetch(uLight, clamp(ivec2(floor(p)) + 1, ivec2(0), ivec2(65)), 0);
  vec2 dp = vec2(uOrg - uDynOrg) + p;
  if (dp.x > 0.0 && dp.y > 0.0 && dp.x < uDynSize.x && dp.y < uDynSize.y)
    L.rgb = max(L.rgb, (uSmooth == 1 ? texture(uDyn, dp / uDynSize) : texelFetch(uDyn, ivec2(floor(dp)), 0)).rgb);
  return L;
}
// «Ультра»: свет ещё мягче — 5 выборок вокруг точки (без «ромбиков» между серединами клеток)
vec4 Lsoft(vec2 p){
  if (uQ < 3 || uSmooth != 1) return Lraw(p);
  return Lraw(p) * 0.4 + (Lraw(p + vec2(0.35, 0.18)) + Lraw(p + vec2(-0.18, 0.35)) + Lraw(p + vec2(-0.35, -0.18)) + Lraw(p + vec2(0.18, -0.35))) * 0.15;
}
float Llum(vec2 p){ vec4 L = Lraw(p); return s2lum(max(L.rgb, uSky * L.a)); }
// свет в точке: огонь (мерцает) или небо — что ярче (свет вокруг героя — в «живой» карте, его тоже держат стены)
vec3 lightCol(vec4 L, vec2 pw, vec2 p){
  return s2light(L.rgb, L.a, uSky, pw, uTime, uQ) + uAmb;
}
uint hsh(ivec2 p){ return s2hash(p); }
float lum(vec3 c){ return s2lum(c); }
float aoWall(uint m, vec2 f){ return s2ao(m, f); }
void main(){
  ivec2 c = clamp(ivec2(floor(vT)), ivec2(0), ivec2(63));
  vec2 f = vT - vec2(c);
  ivec2 px = ivec2(clamp(floor(f * 16.0), 0.0, 15.0));
  uvec4 t0 = texelFetch(uT0, c, 0), t1 = texelFetch(uT1, c, 0);
  ivec2 wp = uOrg + c;
  uint hv = hsh(wp);
  vec2 pw = vec2(uOrg & 4095) + vT;   // мировые клетки (по модулю — для шума без потери точности)
  vec4 Lr = Lsoft(vT);
  vec3 L = lightCol(Lr, pw, vT);
  // свет, рассеянный в воздухе у огня (ореол): по той же карте света — в толщу камня и за стену не попадает
  vec3 scat = uScat > 0.0 ? s2scatter(Lr.rgb, uQ >= 1 ? s2flick(pw, uTime) : 1.0, uScat) : vec3(0.0);
  if (uPass == 1) {
    uint lv = t1.g, lt = t1.b & 3u; bool above = (t1.b & 128u) != 0u;
    if (lv == 0u || lt == 0u) discard;
    float top = above ? 0.0 : 1.0 - float(lv) / 255.0;
    float wk = !above && lt == 1u && uW1H > 0.0 ? pzWaveK(c.y, vT.x) : 0.0;   // волны движка (ветер, гроза) — вместо мелкой ряби
    if (!above && uQ >= 1) top = min(0.98, top + s2wave(pw, uTime, lt != 1u) * (lt == 1u ? 0.07 : 0.05) * (1.0 - wk));   // рябь на глади (только вниз от верха клетки)
    if (wk > 0.0) top = min(0.98, top + wk * (uW1H - d37w1(float(uOrg.x - uW1O) + vT.x)));
    if (f.y < top) discard;
    float dep = f.y - top;
    vec4 col;
    if (lt == 1u) {
      vec3 base = above ? vec3(0.07, 0.25, 0.62) : vec3(0.10, 0.33, 0.74);
      vec3 cc = base * L;
      float a = above ? 0.74 : 0.64;
      if (uQ >= 2) cc += vec3(0.25, 0.42, 0.5) * s2rays(pw, uTime) * min(1.2, lum(L)) * 0.5;   // лучи света в воде: косые полосы, ярче там, где светло
      if (!above && dep < 0.1) { cc = mix(cc, vec3(0.7, 0.88, 1.0) * (L * 1.15 + 0.04), 0.65); a = 0.92; }   // блик: в нём отражается свет
      col = vec4(cc, a);
    } else {
      vec3 cc = s2lava(pw, uTime);
      if (!above && dep < 0.12) cc = mix(cc, vec3(1.0, 0.88, 0.45), 0.6);
      col = vec4(cc, 0.96);
    }
    oC = vec4(col.rgb * col.a, col.a);
    return;
  }
  uint fg = t0.r, sm = t0.g, wall = t0.b, wm = t0.a & 15u, same = t0.a >> 4u, st = t1.r;
  vec4 col = vec4(0.0);
  float emis = 0.0, rel = 1.0;
  bool open = true;   // в этой точке воздух (стена фона, растение, предмет) — тут виден рассеянный свет
  bool dirL = uQ >= 2;
  vec2 lgN = vec2(0.0);
  if (dirL) {   // куда светлее (в клетках мира, y вниз): для объёма текстур и кромок
    vec2 lg = vec2(Llum(vT + vec2(0.6, 0.0)) - Llum(vT - vec2(0.6, 0.0)), Llum(vT + vec2(0.0, 0.6)) - Llum(vT - vec2(0.0, 0.6)));
    float ll = length(lg);
    lgN = lg / (ll + 0.015) * smoothstep(0.0, 0.08, ll);
  }
  if (wall != 0u) {
    uvec4 wi = texelFetch(uProps, ivec2(int(wall), 2), 0);
    int wc = int(wi.r | (wi.g << 8u)) + int(hv & 3u);
    vec4 w = at(wc, px);
    float e = 0.0;
    if ((wm & 1u) != 0u && px.y < 2) e = 1.0;
    if ((wm & 2u) != 0u && px.x > 13) e = 1.0;
    if ((wm & 4u) != 0u && px.y > 13) e = 1.0;
    if ((wm & 8u) != 0u && px.x < 2) e = 1.0;
    col = vec4(w.rgb * (0.66 - e * 0.22), w.a);
    if (uQ >= 1) col.rgb *= aoWall(sm, f);
    if (dirL) {
      vec2 hg = vec2(lum(at(wc, clamp(px + ivec2(1, 0), ivec2(0), ivec2(15))).rgb) - lum(at(wc, clamp(px - ivec2(1, 0), ivec2(0), ivec2(15))).rgb),
                     lum(at(wc, clamp(px + ivec2(0, 1), ivec2(0), ivec2(15))).rgb) - lum(at(wc, clamp(px - ivec2(0, 1), ivec2(0), ivec2(15))).rgb));
      rel = 1.0 - clamp(dot(hg, lgN) * 0.8, -0.25, 0.25);
    }
  } else if ((t1.a & 1u) != 0u && uBack == 1) {
    // фон пещер: дальний слой (параллакс на «высоком»), темнее и в цвет глубины
    vec2 bq = uQ >= 2 ? vS + uCamP : vec2(wp) + f;
    ivec2 bc = ivec2(floor(bq)); vec2 bf = bq - vec2(bc);
    uvec4 wi = texelFetch(uProps, ivec2(2, 2), 0);
    ivec2 bpx = ivec2(clamp(floor(bf * 16.0), 0.0, 15.0));
    vec4 w = at(int(wi.r | (wi.g << 8u)) + int((hsh(ivec2(floor(vec2(bc) / 3.0))) >> 3u) & 3u), ivec2((bpx.x + (bc.x & 1) * 8) & 15, (bpx.y + (bc.y & 1) * 8) & 15));
    float d = clamp((float(wp.y) - 200.0) / 1200.0, 0.0, 1.0);
    vec3 tint = mix(vec3(0.62, 0.48, 0.38), vec3(0.42, 0.44, 0.62), d);
    if (wp.y > 1150) tint = vec3(0.65, 0.36, 0.3);
    col = vec4(w.rgb * tint * (uQ >= 2 ? 0.36 : 0.42), 1.0);
    if (uQ >= 1) col.rgb *= aoWall(sm, f);
  }
  uvec4 fi = texelFetch(uProps, ivec2(int(fg), 0), 0);
  if (fg != 0u && fi.a != 3u) {
    uvec4 fx = texelFetch(uProps, ivec2(int(fg), 1), 0);
    int base = int(fi.r | (fi.g << 8u));
    uint fl = fi.b, kind = fi.a;
    int tcell = kind == 1u ? base + int(st >> 4u) : base + int(hv & 3u);
    vec4 tc = at(tcell, px);
    float frel = 1.0;
    if (kind == 0u) {
      uint shape = st & 15u;
      bool cut = false;
      bool U = (sm & 1u) == 0u, R = (sm & 2u) == 0u, D = (sm & 4u) == 0u, Lf = (sm & 8u) == 0u;
      if (shape == 1u && px.y < 8) cut = true;
      if (shape == 2u && px.y < 15 - px.x) cut = true;
      if (shape == 3u && px.y < px.x) cut = true;
      if (shape == 0u) {
        int rr = (fl & 2u) != 0u ? 7 : 2;   // листва — скругляем сильнее
        if (U && Lf && px.x + px.y < rr) cut = true;
        if (U && R && 15 - px.x + px.y < rr) cut = true;
        if (D && Lf && px.x + 15 - px.y < rr) cut = true;
        if (D && R && 30 - px.x - px.y < rr) cut = true;
      }
      if (cut) tc.a = 0.0;
      else {
        if (shape == 1u) U = true;
        int topY = shape == 1u ? 8 : 0;
        vec2 en = vec2(0.0);   // наружу от кромки
        if (U && px.y == topY) en.y -= 1.0;
        if (D && px.y == 15) en.y += 1.0;
        if (Lf && px.x == 0) en.x -= 1.0;
        if (R && px.x == 15) en.x += 1.0;
        if (shape == 2u && px.y == 15 - px.x) en = vec2(-0.7, -0.7);
        if (shape == 3u && px.y == px.x) en = vec2(0.7, -0.7);
        bool edge = en.x != 0.0 || en.y != 0.0;
        bool seam = ((same & 1u) == 0u && !U && px.y == 0) || ((same & 2u) == 0u && !R && px.x == 15) || ((same & 4u) == 0u && !D && px.y == 15) || ((same & 8u) == 0u && !Lf && px.x == 0);
        if ((fl & 1u) != 0u) {
          int g = 99;
          if (U) g = min(g, px.y - topY);
          if (Lf) g = min(g, px.x);
          if (R) g = min(g, 15 - px.x);
          if (D) g = min(g, 15 - px.y);
          if (shape == 2u) g = min(g, px.y - (15 - px.x));
          if (shape == 3u) g = min(g, px.y - px.x);
          int dep = 2 + int((hsh(wp * 16 + px) >> 7u) & 1u) + int(((hsh(ivec2(wp.x * 16 + px.x, 7)) >> 5u) & 1u));
          vec3 gc = vec3(fx.rgb) / 255.0;
          if (g < dep) tc.rgb = gc * (1.0 + 0.1 * float(dep - g) - (g == 0 ? 0.15 : 0.0));
          else if (g == dep) tc.rgb = mix(tc.rgb, gc * 0.6, 0.5);
        }
        if (edge) tc.rgb *= dirL ? mix(0.55, 1.18, clamp(0.5 + 0.7 * dot(normalize(en), lgN), 0.0, 1.0)) : 0.6;   // кромка к свету — светлее
        else if (seam) tc.rgb *= 0.78;
        if (dirL && !edge) {
          vec2 hg = vec2(lum(at(tcell, clamp(px + ivec2(1, 0), ivec2(0), ivec2(15))).rgb) - lum(at(tcell, clamp(px - ivec2(1, 0), ivec2(0), ivec2(15))).rgb),
                         lum(at(tcell, clamp(px + ivec2(0, 1), ivec2(0), ivec2(15))).rgb) - lum(at(tcell, clamp(px - ivec2(0, 1), ivec2(0), ivec2(15))).rgb));
          frel = 1.0 - clamp(dot(hg, lgN) * 1.1, -0.3, 0.3);
        }
      }
    }
    emis = float(fx.a) / 255.0;
    if (tc.a > 0.5) { rel = frel; if ((fl & 4u) != 0u) open = false; }   // непрозрачный блок: ореола в нём нет
    col.rgb = tc.rgb * tc.a + col.rgb * (1.0 - tc.a);
    col.a = tc.a + col.a * (1.0 - tc.a);
  }
  if (col.a < 0.004) {   // пусто (небо): только ореол огня в воздухе — прибавкой
    if (scat.r + scat.g + scat.b < 0.004) discard;
    oC = vec4(scat, 0.0);
    return;
  }
  vec3 lit = col.rgb * min(L, vec3(1.35)) * rel;
  lit = max(lit, col.rgb * emis);
  oC = vec4(lit * col.a + (open ? scat : vec3(0.0)), col.a);
}`;
  // ── Чанк, «простой» (как было в 1-й версии): запасной, если «красивый» не собрался или рисует чёрным ──
  const FS_CHUNK_BASIC = `#version 300 es
precision highp float; precision highp int; precision highp usampler2D; precision highp sampler2D;
uniform usampler2D uT0, uT1, uProps;
uniform sampler2D uLight, uAtlas, uDyn;
uniform ivec2 uOrg, uDynOrg;
uniform vec2 uDynSize;
uniform vec3 uSky;
uniform float uAmb, uTime;
uniform int uPass, uSmooth, uBack;
in vec2 vT;
out vec4 oC;
uint hsh(ivec2 p){ uint h = uint(p.x) * 0x27d4eb2du ^ uint(p.y) * 0x165667b1u; h = (h ^ (h >> 15u)) * 0x85ebca6bu; h ^= h >> 13u; return h; }
vec4 at(int cell, ivec2 px){ return texelFetch(uAtlas, ivec2((cell % ${AN}) * 16 + px.x, (cell / ${AN}) * 16 + px.y), 0); }
vec3 lightAt(vec2 p){
  vec4 L = uSmooth == 1 ? texture(uLight, (p + 1.0) / 66.0) : texelFetch(uLight, ivec2(floor(p)) + 1, 0);
  vec2 dp = vec2(uOrg - uDynOrg) + p;   // «живой» свет (герой, факел в руке…)
  if (dp.x > 0.0 && dp.y > 0.0 && dp.x < uDynSize.x && dp.y < uDynSize.y) L.rgb = max(L.rgb, texture(uDyn, dp / uDynSize).rgb);
  return max(L.rgb * 1.1, uSky * L.a) + uAmb;
}
void main(){
  ivec2 c = clamp(ivec2(floor(vT)), ivec2(0), ivec2(63));
  vec2 f = vT - vec2(c);
  ivec2 px = ivec2(clamp(floor(f * 16.0), 0.0, 15.0));
  uvec4 t0 = texelFetch(uT0, c, 0), t1 = texelFetch(uT1, c, 0);
  ivec2 wp = uOrg + c;
  uint hv = hsh(wp);
  vec3 L = lightAt(vT);
  if (uPass == 1) {
    uint lv = t1.g, lt = t1.b & 3u; bool above = (t1.b & 128u) != 0u;
    if (lv == 0u || lt == 0u) discard;
    float top = above ? 0.0 : 1.0 - float(lv) / 255.0;
    if (f.y < top) discard;
    vec4 col;
    vec2 p = vec2(wp) + f;   // узор — по сплошным мировым координатам (по клеткам он рвался бы сеткой)
    if (lt == 1u) {
      float surf = (!above && f.y - top < 0.08) ? 0.35 : 0.0;
      float w = sin(p.x * 1.3 + sin(p.y * 0.9 + uTime * 0.7) * 1.4 + uTime * 2.0) * 0.04;
      col = vec4(vec3(0.13, 0.38 + w, 0.82) * L + vec3(surf) * L, 0.6 + surf * 0.3);
    } else {
      float n = sin(p.x * 0.9 + sin(p.y * 0.8 + uTime * 0.5) * 1.6 + uTime * 0.9) * 0.5 + sin(p.y * 1.1 - uTime * 0.7 + sin(p.x * 0.6) * 1.3) * 0.5;
      vec3 cc = mix(vec3(0.72, 0.15, 0.03), vec3(1.0, 0.5, 0.1), 0.5 + 0.3 * n);
      cc = mix(cc, vec3(1.0, 0.84, 0.36), smoothstep(0.45, 0.95, n) * 0.75);   // светлые прожилки
      if (!above && f.y - top < 0.1) cc = mix(cc, vec3(1.0, 0.86, 0.4), 0.55);   // кромка
      col = vec4(cc, 0.95);
    }
    oC = vec4(col.rgb * col.a, col.a);
    return;
  }
  uint fg = t0.r, sm = t0.g, wall = t0.b, wm = t0.a & 15u, same = t0.a >> 4u, st = t1.r;
  vec4 col = vec4(0.0);
  float emis = 0.0;
  if (wall != 0u) {
    uvec4 wi = texelFetch(uProps, ivec2(int(wall), 2), 0);
    vec4 w = at(int(wi.r | (wi.g << 8u)) + int(hv & 3u), px);
    float e = 0.0;
    if ((wm & 1u) != 0u && px.y < 2) e = 1.0;
    if ((wm & 2u) != 0u && px.x > 13) e = 1.0;
    if ((wm & 4u) != 0u && px.y > 13) e = 1.0;
    if ((wm & 8u) != 0u && px.x < 2) e = 1.0;
    col = vec4(w.rgb * (0.66 - e * 0.22), w.a);
  } else if ((t1.a & 1u) != 0u && uBack == 1) {
    uvec4 wi = texelFetch(uProps, ivec2(2, 2), 0);
    vec4 w = at(int(wi.r | (wi.g << 8u)) + int((hsh(wp / 3) >> 3u) & 3u), ivec2((px.x + (wp.x & 1) * 8) & 15, (px.y + (wp.y & 1) * 8) & 15));
    float d = clamp((float(wp.y) - 200.0) / 1200.0, 0.0, 1.0);
    vec3 tint = mix(vec3(0.62, 0.48, 0.38), vec3(0.42, 0.44, 0.62), d);
    if (wp.y > 1150) tint = vec3(0.65, 0.36, 0.3);
    col = vec4(w.rgb * tint * 0.42, 1.0);
  }
  uvec4 fi = texelFetch(uProps, ivec2(int(fg), 0), 0);
  if (fg != 0u && fi.a != 3u) {
    uvec4 fx = texelFetch(uProps, ivec2(int(fg), 1), 0);
    int base = int(fi.r | (fi.g << 8u));
    uint fl = fi.b, kind = fi.a;
    vec4 tc = at(kind == 1u ? base + int(st >> 4u) : base + int(hv & 3u), px);
    if (kind == 0u) {
      uint shape = st & 15u;
      bool cut = false;
      bool U = (sm & 1u) == 0u, R = (sm & 2u) == 0u, D = (sm & 4u) == 0u, Lf = (sm & 8u) == 0u;
      if (shape == 1u && px.y < 8) cut = true;
      if (shape == 2u && px.y < 15 - px.x) cut = true;
      if (shape == 3u && px.y < px.x) cut = true;
      if (shape == 0u) {
        int rr = (fl & 2u) != 0u ? 7 : 2;   // листва — скругляем сильнее
        if (U && Lf && px.x + px.y < rr) cut = true;
        if (U && R && 15 - px.x + px.y < rr) cut = true;
        if (D && Lf && px.x + 15 - px.y < rr) cut = true;
        if (D && R && 30 - px.x - px.y < rr) cut = true;
      }
      if (cut) tc.a = 0.0;
      else {
        if (shape == 1u) U = true;
        bool edge = (U && px.y == (shape == 1u ? 8 : 0)) || (D && px.y == 15) || (Lf && px.x == 0) || (R && px.x == 15);
        if (shape == 2u && px.y == 15 - px.x) edge = true;
        if (shape == 3u && px.y == px.x) edge = true;
        bool seam = ((same & 1u) == 0u && !U && px.y == 0) || ((same & 2u) == 0u && !R && px.x == 15) || ((same & 4u) == 0u && !D && px.y == 15) || ((same & 8u) == 0u && !Lf && px.x == 0);
        if ((fl & 1u) != 0u) {
          int g = 99;
          if (U) g = min(g, px.y - (shape == 1u ? 8 : 0));
          if (Lf) g = min(g, px.x);
          if (R) g = min(g, 15 - px.x);
          if (D) g = min(g, 15 - px.y);
          if (shape == 2u) g = min(g, px.y - (15 - px.x));
          if (shape == 3u) g = min(g, px.y - px.x);
          int dep = 2 + int((hsh(wp * 16 + px) >> 7u) & 1u) + int(((hsh(ivec2(wp.x * 16 + px.x, 7)) >> 5u) & 1u));
          vec3 gc = vec3(fx.rgb) / 255.0;
          if (g < dep) tc.rgb = gc * (1.0 + 0.1 * float(dep - g) - (g == 0 ? 0.15 : 0.0));
          else if (g == dep) tc.rgb = mix(tc.rgb, gc * 0.6, 0.5);
        }
        if (edge) tc.rgb *= 0.6;
        else if (seam) tc.rgb *= 0.78;
      }
    }
    emis = float(fx.a) / 255.0;
    col.rgb = tc.rgb * tc.a + col.rgb * (1.0 - tc.a);
    col.a = tc.a + col.a * (1.0 - tc.a);
  }
  if (col.a < 0.004) discard;
  vec3 lit = col.rgb * min(L, vec3(1.3));
  lit = max(lit, col.rgb * emis);
  oC = vec4(lit * col.a, col.a);
}`;
  const VS_SPR = `#version 300 es
in vec2 aP; in vec2 aUV; in vec4 aC;
uniform vec2 uScale;
out vec2 vUV; out vec4 vC;
void main(){ vUV = aUV; vC = aC; vec2 p = aP * uScale; gl_Position = vec4(p.x, -p.y, 0.0, 1.0); }`;
  const FS_SPR = `#version 300 es
precision highp float; precision highp sampler2D;   // телефоны: mediump-координаты атласа 1024² ошибаются на полпикселя — соседняя клетка «протекает»
uniform sampler2D uTex;
in vec2 vUV; in vec4 vC;
out vec4 oC;
void main(){ vec4 t = texture(uTex, vUV); oC = vec4(t.rgb * vC.rgb, t.a) * vC.a; if (oC.a < 0.004) discard; }`;
  const VS_BG = `#version 300 es
layout(location = 0) in vec2 aP; out vec2 vUV;
void main(){ vUV = aP; gl_Position = vec4(aP * 2.0 - 1.0, 0.0, 1.0); }`;
  // ── Небо и даль, «красивое»: свои горы и деревья у каждого края (uShape/uShape2 + uBlend — плавный переход), дымка у
  // подножий (даль в цвет неба), заря у горизонта со стороны солнца, облака с подсветкой снизу ──
  const FS_BG_HQ = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 oC;
uniform vec3 uTop, uBot, uHill1, uHill2, uHill3, uHorizon;
uniform vec2 uRes;      // пикселей
uniform float uTile;    // пикселей на клетку
uniform vec3 uCam;      // x (по модулю, для параллакса), y (мировой), время
uniform vec4 uSun;      // x, y (доли экрана), радиус (доля высоты), 1 — солнце / 0 — луна
uniform vec4 uShape, uShape2;   // острота гор 0…1, деревья (0 нет, 1 круглые, 2 ели, 3 джунгли, 4 кактусы), неровность, дымка
uniform float uBlend;   // 0 — uShape, 1 — uShape2
uniform float uNight, uSurf;
uniform int uQ;
float h1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
float n1(float x){ float i = floor(x), f = fract(x); float u = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), u); }
float fbm(float x){ return n1(x) * 0.55 + n1(x * 2.1 + 3.1) * 0.28 + n1(x * 4.3 + 7.7) * 0.17; }
float rid(float x){ return (1.0 - abs(n1(x) * 2.0 - 1.0)) * 0.6 + (1.0 - abs(n1(x * 2.3 + 5.0) * 2.0 - 1.0)) * 0.3 + n1(x * 5.1) * 0.1; }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = h1(i.x + i.y * 57.0), b = h1(i.x + 1.0 + i.y * 57.0), c = h1(i.x + (i.y + 1.0) * 57.0), d = h1(i.x + 1.0 + (i.y + 1.0) * 57.0);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y); }
// силуэт деревьев (в долях высоты дерева, 0…1) по стилю
float trees(float x, float style){
  float i = floor(x), fx = fract(x), r = h1(i * 3.7 + 1.3);
  if (style < 0.5 || r < 0.35) return 0.0;
  float c = 0.5 + (h1(i * 5.1) - 0.5) * 0.4, dx = abs(fx - c);
  if (style < 1.5) { float w = 0.4 + 0.08 * r, q = dx / w; return dx < w ? (0.5 + 0.5 * sqrt(max(0.0, 1.0 - q * q))) * (0.6 + 0.5 * r) : 0.0; }
  if (style < 2.5) { float w = 0.28 + 0.1 * r; return dx < w ? (1.0 - dx / w) * (0.8 + 0.4 * r) : 0.0; }
  if (style < 3.5) { float w = 0.42 + 0.06 * r, q = dx / w; return dx < w ? (1.0 + 0.35 * r) * (1.0 - q * q * q) : 0.0; }
  float arm = (dx > 0.12 && dx < 0.2) ? 0.6 : 0.0;
  return dx < 0.07 ? 0.9 * (0.7 + 0.3 * r) : arm * (0.7 + 0.3 * r);
}
float layerH(float x, vec4 S, float lay){   // высота слоя 0…1
  if (lay < 0.5) return mix(fbm(x * 0.02), rid(x * 0.018), S.x);
  if (lay < 1.5) return mix(fbm(x * 0.035 + 11.0), rid(x * 0.03 + 11.0), S.x * 0.6) * (0.75 + 0.5 * S.z);
  return fbm(x * 0.05 + 23.0);
}
void main(){
  vec2 px = vec2(vUV.x * uRes.x, (1.0 - vUV.y) * uRes.y);   // y вниз
  vec3 col = mix(uTop, uBot, clamp(1.0 - vUV.y, 0.0, 1.0));
  // звёзды (мерцают)
  if (uNight > 0.01) {
    vec2 sp = floor(px / 3.0);
    float s = h1(sp.x * 1.37 + sp.y * 91.7);
    if (s > 0.9965) col += vec3(0.85, 0.9, 1.0) * uNight * (0.5 + 0.5 * sin(uCam.z * 2.0 + s * 300.0));
  }
  // заря у горизонта — со стороны солнца
  float H = uRes.y, sy = px.y, dpx = (uCam.y - uSurf) * uTile, u = uTile / 18.0;
  float base1 = H * 0.44 - dpx * 0.22, base2 = H * 0.52 - dpx * 0.42, base3 = H * 0.6 - dpx * 0.65;
  float hz = clamp(1.0 - abs(sy - base1) / (H * 0.45), 0.0, 1.0);
  col += uHorizon * hz * hz * (0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.7, abs(vUV.x - uSun.x))));
  // солнце / луна
  vec2 sd = (vec2(vUV.x, 1.0 - vUV.y) - uSun.xy) * vec2(uRes.x / uRes.y, 1.0);
  float d = length(sd);
  if (uSun.w > 0.5) { col += vec3(1.0, 0.85, 0.5) * (1.0 - smoothstep(0.0, uSun.z * 4.0, d)) * 0.35 + vec3(1.0, 0.9, 0.7) * (1.0 - smoothstep(0.0, uSun.z * 12.0, d)) * 0.12; if (d < uSun.z) col = mix(col, vec3(1.0, 0.97, 0.85), 0.95); }
  else if (uSun.w > -0.5) { col += vec3(0.6, 0.7, 1.0) * (1.0 - smoothstep(0.0, uSun.z * 3.0, d)) * 0.18; if (d < uSun.z) col = mix(col, vec3(0.92, 0.94, 1.0), 0.9 - 0.4 * step(0.0, sd.x - uSun.z * 0.35)); }
  // облака — над дальними горами, снизу подсвечены зарёй
  float cl = n2(vec2((px.x / uTile + uCam.x * 0.06 + uCam.z * 0.5) * 0.06, sy / uTile * 0.12));
  cl = smoothstep(0.62, 0.85, cl * 0.7 + n2(vec2(px.x / uTile * 0.15 + uCam.x * 0.09, sy / uTile * 0.3)) * 0.3);
  vec3 ccol = mix(vec3(1.0), uTop * 0.6, uNight * 0.85) + uHorizon * 0.6;
  col = mix(col, ccol, cl * 0.55 * (1.0 - smoothstep(base1 - H * 0.3, base1, sy)));
  vec4 S = mix(uShape, uShape2, uBlend);
  float hz1 = S.w;
  // дальние горы
  float hx1 = (px.x - uRes.x * 0.5) / uTile * 0.5 + uCam.x * 0.15;
  float top1 = base1 - layerH(hx1, S, 0.0) * H * (0.3 + 0.16 * S.x) * u;
  if (sy > top1) { float m = smoothstep(top1, base1 + H * 0.1, sy); col = mix(uHill1, mix(uHill1, uBot, hz1), m); }
  // средние холмы
  float hx2 = (px.x - uRes.x * 0.5) / uTile * 0.7 + uCam.x * 0.3;
  float top2 = base2 - layerH(hx2, S, 1.0) * H * 0.24 * u;
  if (sy > top2) { float m = smoothstep(top2, base2 + H * 0.12, sy); col = mix(uHill2, mix(uHill2, uBot, hz1 * 0.7), m * 0.9); }
  // ближние холмы и деревья (стиль смешивается на переходе)
  float hx3 = (px.x - uRes.x * 0.5) / uTile * 0.85 + uCam.x * 0.5;
  float t3 = mix(trees(hx3 * 0.4, uShape.y), trees(hx3 * 0.4, uShape2.y), uBlend);
  float top3 = base3 - (fbm(hx3 * 0.05 + 23.0) * 16.0 + t3 * 6.5) * uTile * 0.6;
  if (sy > top3) col = mix(uHill3, uBot * 0.35 + uHill3 * 0.65, (1.0 - smoothstep(top3, top3 + uTile * 2.0, sy)) * 0.25 * hz1);
  oC = vec4(col, 1.0);
}`;
  const FS_BG_BASIC = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 oC;
uniform vec3 uTop, uBot, uHill1, uHill2, uHill3;
uniform vec2 uRes;      // пикселей
uniform float uTile;    // пикселей на клетку
uniform vec3 uCam;      // x (по модулю, для параллакса), y (мировой), время
uniform vec4 uSun;      // x, y (доли экрана), радиус (доля высоты), 1 — солнце / 0 — луна
uniform float uNight, uSurf;
float h1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
float n1(float x){ float i = floor(x), f = fract(x); float u = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), u); }
float fbm(float x){ return n1(x) * 0.55 + n1(x * 2.1 + 3.1) * 0.28 + n1(x * 4.3 + 7.7) * 0.17; }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = h1(i.x + i.y * 57.0), b = h1(i.x + 1.0 + i.y * 57.0), c = h1(i.x + (i.y + 1.0) * 57.0), d = h1(i.x + 1.0 + (i.y + 1.0) * 57.0);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y); }
void main(){
  vec2 px = vec2(vUV.x * uRes.x, (1.0 - vUV.y) * uRes.y);   // y вниз
  float wy = uCam.y + (px.y - uRes.y * 0.5) / uTile;          // мировая высота пикселя
  vec3 col = mix(uTop, uBot, clamp(vUV.y < 0.0 ? 0.0 : 1.0 - vUV.y, 0.0, 1.0));
  // звёзды
  if (uNight > 0.01) {
    vec2 sp = floor(px / 3.0);
    float s = h1(sp.x * 1.37 + sp.y * 91.7);
    if (s > 0.9965) col += vec3(0.85, 0.9, 1.0) * uNight * (0.5 + 0.5 * sin(uCam.z * 2.0 + s * 300.0));
  }
  // солнце / луна
  vec2 sd = (vec2(vUV.x, 1.0 - vUV.y) - uSun.xy) * vec2(uRes.x / uRes.y, 1.0);   // uSun — доли экрана сверху
  float d = length(sd);
  if (uSun.w > 0.5) { col += vec3(1.0, 0.85, 0.5) * (1.0 - smoothstep(0.0, uSun.z * 4.0, d)) * 0.35; if (d < uSun.z) col = mix(col, vec3(1.0, 0.97, 0.85), 0.95); }
  else if (uSun.w > -0.5) { col += vec3(0.6, 0.7, 1.0) * (1.0 - smoothstep(0.0, uSun.z * 3.0, d)) * 0.15; if (d < uSun.z) col = mix(col, vec3(0.92, 0.94, 1.0), 0.9 - 0.4 * step(0.0, sd.x - uSun.z * 0.35)); }
  // горы и холмы — в пикселях экрана: у поверхности основание ниже середины, спускаешься — уходят вверх (параллакс)
  float H = uRes.y, sy = px.y, dpx = (uCam.y - uSurf) * uTile, u = uTile / 18.0;
  float base1 = H * 0.44 - dpx * 0.22, base2 = H * 0.52 - dpx * 0.42, base3 = H * 0.6 - dpx * 0.65;
  // облака — над дальними горами
  float cl = n2(vec2((px.x / uTile + uCam.x * 0.06 + uCam.z * 0.5) * 0.06, sy / uTile * 0.12));
  cl = smoothstep(0.62, 0.85, cl * 0.7 + n2(vec2(px.x / uTile * 0.15 + uCam.x * 0.09, sy / uTile * 0.3)) * 0.3);
  col = mix(col, mix(vec3(1.0), uTop * 0.6, uNight * 0.85), cl * 0.55 * (1.0 - smoothstep(base1 - H * 0.3, base1, sy)));
  float hx1 = (px.x - uRes.x * 0.5) / uTile * 0.5 + uCam.x * 0.15;
  if (sy > base1 - fbm(hx1 * 0.02) * H * 0.34 * u) col = mix(col, uHill1, 0.85);
  float hx2 = (px.x - uRes.x * 0.5) / uTile * 0.7 + uCam.x * 0.3;
  if (sy > base2 - fbm(hx2 * 0.035 + 11.0) * H * 0.24 * u) col = mix(col, uHill2, 0.92);
  float hx3 = (px.x - uRes.x * 0.5) / uTile * 0.85 + uCam.x * 0.5;
  float tr = step(0.55, n1(hx3 * 0.9)) * (1.0 - abs(fract(hx3 * 0.9) - 0.5) * 2.0) * 8.0;
  if (sy > base3 - (fbm(hx3 * 0.05 + 23.0) * 16.0 + tr) * uTile * 0.6) col = uHill3;
  oC = vec4(col, 1.0);
}`;

  const DEF_SHAPE = new Float32Array([.25, 1, .5, .45]), ZERO3 = new Float32Array(3);
  // ореол: белый круг с мягким краем (рисуется сложением цвета — R.glowBegin / R.glowEnd)
  let glowImg = null;
  function glowCanvas(){
    if (glowImg) return glowImg;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.18, 'rgba(255,255,255,.62)'); gr.addColorStop(.45, 'rgba(255,255,255,.2)'); gr.addColorStop(.75, 'rgba(255,255,255,.05)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (glowImg = c);
  }
  function renderer(canvas, opts = {}){
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: true, preserveDrawingBuffer: !!opts.keep, powerPreference: 'high-performance' });
    if (!gl) return null;
    const compile = (vs, fs) => {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Шейдер: ' + gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Шейдер: ' + gl.getProgramInfoLog(p));
      const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
      return { p, u };
    };
    // «красивые» шейдеры; не собрались — простые (как в 1-й версии), рисуют чёрным — тоже простые (R.selfTest)
    const tryCompile = (vs, fs, name) => { try { return compile(vs, fs); } catch (e) { console.warn('Подземье: шейдер «' + name + '» не собрался — беру простой', e.message); return null; } };
    const progCH = opts.basic || !FS_CHUNK_HQ ? null : tryCompile(VS_CHUNK, FS_CHUNK_HQ, 'клетки'), progBH = opts.basic ? null : tryCompile(VS_BG, FS_BG_HQ, 'небо');
    let progCB = null, progBB = null;
    const basicC = () => progCB || (progCB = compile(VS_CHUNK, FS_CHUNK_BASIC)), basicB = () => progBB || (progBB = compile(VS_BG, FS_BG_BASIC));
    let progC = progCH || basicC(), progB = progBH || basicB();
    const progS = compile(VS_SPR, FS_SPR);
    // квадрат 0…1
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const vaoQ = gl.createVertexArray(); gl.bindVertexArray(vaoQ);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // спрайты: 4 вершины × (x, y, u, v, rgba8) на спрайт
    const MAXS = 6000, STRIDE = 20;
    const sbuf = new ArrayBuffer(MAXS * 4 * STRIDE), sf = new Float32Array(sbuf), su = new Uint8Array(sbuf);
    const vboS = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vboS); gl.bufferData(gl.ARRAY_BUFFER, sbuf.byteLength, gl.DYNAMIC_DRAW);
    const idx = new Uint16Array(MAXS * 6);
    for (let i = 0; i < MAXS; i++) { const v = i * 4, o = i * 6; idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v + 2; idx[o + 4] = v + 1; idx[o + 5] = v + 3; }
    const vaoS = gl.createVertexArray(); gl.bindVertexArray(vaoS);
    const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, vboS);
    const aP = gl.getAttribLocation(progS.p, 'aP'), aUV = gl.getAttribLocation(progS.p, 'aUV'), aC = gl.getAttribLocation(progS.p, 'aC');
    gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(aUV); gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, STRIDE, 8);
    gl.enableVertexAttribArray(aC); gl.vertexAttribPointer(aC, 4, gl.UNSIGNED_BYTE, true, STRIDE, 16);
    const vaoB = gl.createVertexArray(); gl.bindVertexArray(vaoB); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const texU = (w, h, fmt) => {   // целочисленная текстура данных (без фильтрации)
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fmt || gl.RGBA8UI, w, h);
      return t;
    };
    const texL = () => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 66, 66);
      return t;
    };
    const R = { gl, w: 1, h: 1, tile: 16, camX: 0, camY: 0, stats: { draws: 0, sprites: 0, uploads: 0 }, pixelImgs: new WeakSet() };
    let atlasTex = null, propsTex = null;
    const imgTex = new Map();   // картинки 2D-персонажа → текстура
    R.setAtlas = A => {
      if (!atlasTex) atlasTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, A.canvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      R.atlas = A;
    };
    // свойства блоков: строка 0 — [ячейка lo, hi, флаги (1 трава, 2 листва, 4 непрозрачный), вид], строка 1 — [цвет травы rgb, свечение], строка 2 — стены
    R.setProps = (PZ, A) => {
      const d = new Uint8Array(256 * 3 * 4);
      for (let id = 1; id < 256; id++) {
        const c = A.tile[id];
        if (c < 0) { d[id * 4 + 3] = 3; continue; }   // неизвестный (мод удалён) — не рисуем, данные в мире целы
        const t = PZ.TILES[id] || {};
        d[id * 4] = c & 255; d[id * 4 + 1] = c >> 8; d[id * 4 + 2] = (PZ.P.GRASSY[id] ? 1 : 0) | (PZ.P.LEAFY[id] ? 2 : 0) | (PZ.P.OPC[id] === 1 ? 4 : 0); d[id * 4 + 3] = PZ.P.KIND[id] === 1 ? 1 : PZ.P.KIND[id] === 0 || PZ.P.LEAFY[id] ? 0 : 2;
        const gc = hex(t.grass || '#000000'), o = 1024 + id * 4;
        d[o] = gc[0]; d[o + 1] = gc[1]; d[o + 2] = gc[2]; d[o + 3] = PZ.P.EMIS[id];
      }
      for (let id = 1; id < 256; id++) { const c = A.wall[id]; if (c < 0) continue; const o = 2048 + id * 4; d[o] = c & 255; d[o + 1] = c >> 8; }
      if (!propsTex) propsTex = texU(256, 3);
      gl.bindTexture(gl.TEXTURE_2D, propsTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 3, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, d);
      R.selfTest();
    };
    // ── Чанк: текстуры t0 (fg, маска, стена, маски) и t1 (форма/кадр, жидкость, тип|над ней, флаги), свет 66×66 ──
    R.chunkInit = c => { if (!c.gl) c.gl = { t0: texU(64, 64), t1: texU(64, 64), l: texL() }; return c.gl; };
    R.upload0 = (c, data) => { const g = R.chunkInit(c); gl.bindTexture(gl.TEXTURE_2D, g.t0); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, data); R.stats.uploads++; };
    R.upload1 = (c, data) => { const g = R.chunkInit(c); gl.bindTexture(gl.TEXTURE_2D, g.t1); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, data); R.stats.uploads++; };
    R.upload1Rows = (c, data, y, rows) => { const g = R.chunkInit(c); gl.bindTexture(gl.TEXTURE_2D, g.t1); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, 64, rows, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, data, y * 256); R.stats.uploads++; };   // только ряды y…y+rows−1 (вода течёт)
    R.uploadL = (c, data) => { const g = R.chunkInit(c); gl.bindTexture(gl.TEXTURE_2D, g.l); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 66, 66, gl.RGBA, gl.UNSIGNED_BYTE, data); R.stats.uploads++; };
    R.chunkFree = c => { if (!c.gl) return; gl.deleteTexture(c.gl.t0); gl.deleteTexture(c.gl.t1); gl.deleteTexture(c.gl.l); c.gl = null; };
    // ── «Живой» свет (герой, факел в руке, «сияние», огненные снаряды): RGBA w×h клеток с левым верхом (x0, y0) — игра
    // считает сама (заливка по клеткам, стены держат) и присылает, когда поменялся. Нет — пустая текстура 1×1 ──
    const dynTex = gl.createTexture(); let dynW = 0, dynH = 0;
    gl.bindTexture(gl.TEXTURE_2D, dynTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    R.dyn = { x0: 0, y0: 0, w: 1, h: 1 };
    R.setDyn = (data, w, h, x0, y0) => {
      gl.bindTexture(gl.TEXTURE_2D, dynTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      if (w === dynW && h === dynH) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); dynW = w; dynH = h; }
      R.dyn.x0 = x0; R.dyn.y0 = y0; R.dyn.w = w; R.dyn.h = h; R.stats.uploads++;
    };
    R.clearDyn = () => { R.dyn.w = R.dyn.h = 1; R.dyn.x0 = R.dyn.y0 = -1e6; };
    R.clearDyn();

    R.resize = (w, h, tile) => { R.w = w; R.h = h; R.tile = tile; if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } };
    // постобработка набора шейдеров (js/engine/shade2d.js): «Красивые»/«Ультра» — свечение, рябь, жар, цвет, виньетка;
    // «Ретро» — крупные пиксели, меньше оттенков, полоски CRT. Нет модуля или не собралась — рисуем прямо на экран.
    R.post = !opts.basic && window.D37E?.shade2d ? window.D37E.shade2d.create(gl) : null;
    R.begin = (camX, camY, fl) => {
      R.camX = camX; R.camY = camY; R.stats.draws = 0; R.stats.sprites = 0;
      if (!(R.post && R.post.begin(R.w, R.h, fl))) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, R.w, R.h); }
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    };
    // кадр готов: постобработка на экран (params: time, grade, bloom, vignette; поле искажений — R.post.field)
    R.end = params => { R.flush(); if (R.post?.active) { R.post.end(params); R.stats.draws += R.post.stats.passes; } };
    // небо, горы, облака, солнце/луна (s: { top, bot, hill1, hill2, hill3 — [r,g,b] 0…1, sun: [x, y, r, kind], night, surf, time })
    // + горы и деревья края (shape, shape2, blend: [острота, деревья, неровность, дымка]), заря у горизонта (horizon), q
    R.background = s => {
      gl.useProgram(progB.p); gl.bindVertexArray(vaoB);
      const u = progB.u;
      gl.uniform3fv(u.uTop, s.top); gl.uniform3fv(u.uBot, s.bot); gl.uniform3fv(u.uHill1, s.hill1); gl.uniform3fv(u.uHill2, s.hill2); gl.uniform3fv(u.uHill3, s.hill3);
      gl.uniform2f(u.uRes, R.w, R.h); gl.uniform1f(u.uTile, R.tile);
      gl.uniform3f(u.uCam, R.camX % 100000, R.camY, s.time); gl.uniform4fv(u.uSun, s.sun);
      gl.uniform1f(u.uNight, s.night); gl.uniform1f(u.uSurf, s.surf);
      if (u.uShape) { gl.uniform4fv(u.uShape, s.shape || DEF_SHAPE); gl.uniform4fv(u.uShape2, s.shape2 || s.shape || DEF_SHAPE); gl.uniform1f(u.uBlend, s.blend || 0); }
      if (u.uHorizon) gl.uniform3fv(u.uHorizon, s.horizon || ZERO3);
      if (u.uQ) gl.uniform1i(u.uQ, s.q | 0);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.enable(gl.BLEND);
      R.stats.draws++;
    };
    // чанки: list — [{ cx, cy, gl }], s: { sky: [r,g,b], amb, time, smooth, back }, pass 0 — блоки и стены, 1 — жидкости
    const sc = new Float32Array(2);
    R.chunks = (list, s, pass) => {
      gl.useProgram(progC.p); gl.bindVertexArray(vaoQ);
      const u = progC.u;
      sc[0] = 2 * R.tile / R.w; sc[1] = 2 * R.tile / R.h;
      gl.uniform2fv(u.uScale, sc);
      gl.uniform3fv(u.uSky, s.sky); gl.uniform1f(u.uAmb, s.amb); gl.uniform1f(u.uTime, s.time); gl.uniform1i(u.uPass, pass);
      gl.uniform1i(u.uSmooth, s.smooth ? 1 : 0); gl.uniform1i(u.uBack, s.back === false ? 0 : 1);
      if (u.uQ) gl.uniform1i(u.uQ, s.q | 0);
      if (u.uScat) gl.uniform1f(u.uScat, pass === 0 ? s.scat || 0 : 0);
      if (u.uCamP) gl.uniform2f(u.uCamP, (R.camX * .65) % 1020, (R.camY * .65) % 1020);   // 1020 — кратно 6: узор фона (3 × 2) не прыгает
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, atlasTex); gl.uniform1i(u.uAtlas, 3);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, propsTex); gl.uniform1i(u.uProps, 4);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, dynTex); if (u.uDyn) gl.uniform1i(u.uDyn, 5);
      if (u.uDynOrg) { gl.uniform2i(u.uDynOrg, R.dyn.x0, R.dyn.y0); gl.uniform2f(u.uDynSize, R.dyn.w, R.dyn.h); }
      gl.uniform1i(u.uT0, 0); gl.uniform1i(u.uT1, 1); gl.uniform1i(u.uLight, 2);
      const wv = pass === 1 && u.uW1H ? s.wv : null;   // волны (waves.js): только жидкости, только «красивый» шейдер
      if (u.uW1H) gl.uniform1f(u.uW1H, wv ? wv.H : 0);
      if (wv && u.uW1K) { gl.uniform4fv(u.uW1K, wv.K); gl.uniform4fv(u.uW1A, wv.A); gl.uniform4fv(u.uW1P, wv.P); gl.uniform1i(u.uW1O, wv.O); }
      for (let i = 0; i < list.length; i++) {
        const c = list[i]; if (!c.gl || !c.ready) continue;
        if (pass === 1 && !c.hasLq) continue;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, c.gl.t0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, c.gl.t1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, c.gl.l);
        gl.uniform2f(u.uOff, c.cx * 64 - R.camX, c.cy * 64 - R.camY);
        gl.uniform2i(u.uOrg, c.cx * 64, c.cy * 64);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        R.stats.draws++;
      }
      gl.activeTexture(gl.TEXTURE0);
    };
    // ── Спрайты пачкой: R.sprite(tex | null (атлас), x, y, w, h — клетки мира; u0, v0, u1, v1 — пиксели текстуры; r, g, b, a 0…255; flip, rot) ──
    let sn = 0, sTex = null;
    const texOf = img => {
      let t = imgTex.get(img);
      if (t) { t.used = R.frame; return t.t; }
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      const px = R.pixelImgs.has(img);   // пиксельный стиль персонажа — без размытия
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, px ? gl.NEAREST : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, px ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      t = { t: tex, used: R.frame, w: img.width, h: img.height };
      imgTex.set(img, t);
      return tex;
    };
    R.frame = 0;
    R.texSize = img => { if (!img) return [AS, AS]; const t = imgTex.get(img); return t ? [t.w, t.h] : [img.width, img.height]; };
    R.sprite = (img, x, y, w, h, u0, v0, u1, v1, r, g, b, a, flip, rot, ox, oy) => {
      const tex = img ? texOf(img) : atlasTex;
      if (tex !== sTex || sn >= MAXS) { R.flush(); sTex = tex; }
      const tw = img ? img.width : AS, th = img ? img.height : AS;
      let U0 = u0 / tw, U1 = u1 / tw; const V0 = v0 / th, V1 = v1 / th;
      if (flip) { const q = U0; U0 = U1; U1 = q; }
      const X = x - R.camX, Y = y - R.camY;
      let x0, y0, x1, y1, x2, y2, x3, y3;
      if (rot) {
        const c = Math.cos(rot), s = Math.sin(rot), px = X + (ox ?? w / 2), py = Y + (oy ?? h / 2);
        const ax = -(ox ?? w / 2), ay = -(oy ?? h / 2), bx = ax + w, by = ay + h;
        x0 = px + ax * c - ay * s; y0 = py + ax * s + ay * c;
        x1 = px + bx * c - ay * s; y1 = py + bx * s + ay * c;
        x2 = px + ax * c - by * s; y2 = py + ax * s + by * c;
        x3 = px + bx * c - by * s; y3 = py + bx * s + by * c;
      } else { x0 = X; y0 = Y; x1 = X + w; y1 = Y; x2 = X; y2 = Y + h; x3 = X + w; y3 = Y + h; }
      const o = sn * 4 * 5;
      sf[o] = x0; sf[o + 1] = y0; sf[o + 2] = U0; sf[o + 3] = V0;
      sf[o + 5] = x1; sf[o + 6] = y1; sf[o + 7] = U1; sf[o + 8] = V0;
      sf[o + 10] = x2; sf[o + 11] = y2; sf[o + 12] = U0; sf[o + 13] = V1;
      sf[o + 15] = x3; sf[o + 16] = y3; sf[o + 17] = U1; sf[o + 18] = V1;
      for (let k = 0; k < 4; k++) { const q = (o + k * 5 + 4) * 4; su[q] = r; su[q + 1] = g; su[q + 2] = b; su[q + 3] = a; }
      sn++;
    };
    R.flush = () => {
      if (!sn) return;
      gl.useProgram(progS.p); gl.bindVertexArray(vaoS);
      gl.uniform2f(progS.u.uScale, 2 * R.tile / R.w, 2 * R.tile / R.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sTex); gl.uniform1i(progS.u.uTex, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, vboS);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sf, 0, sn * 4 * 5);
      gl.drawElements(gl.TRIANGLES, sn * 6, gl.UNSIGNED_SHORT, 0);
      R.stats.draws++; R.stats.sprites += sn;
      sn = 0;
    };
    // ── Ореолы света: всё, что между glowBegin и glowEnd, складывается с картинкой (свечение, «блум» без постобработки) ──
    R.glowBegin = () => { R.flush(); gl.blendFunc(gl.ONE, gl.ONE); };
    R.glow = (x, y, rad, r, g, b, a) => { const img = glowCanvas(); R.sprite(img, x - rad, y - rad, rad * 2, rad * 2, 0, 0, 64, 64, r, g, b, a); };
    R.glowEnd = () => { R.flush(); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); };
    // мягкое пятно обычным смешиванием (дым, пузыри лавы): тот же круг, что у ореола
    R.puff = (x, y, rad, r, g, b, a) => { const img = glowCanvas(); R.sprite(img, x - rad, y - rad, rad * 2, rad * 2, 0, 0, 64, 64, r, g, b, a); };

    // ── Проверка на этой видеокарте: «красивые» шейдеры рисуют не чёрным? (на части телефонов шейдер собирается, а
    // рисует чёрное — так было с травой в 3D). Рисуем кусочек стены и неба в маленькую текстуру и читаем пиксель. ──
    R.hq = { chunk: progC === progCH && !!progCH, bg: progB === progBH && !!progBH };
    let tested = false;
    R.selfTest = () => {
      if (tested || !atlasTex || !propsTex) return R.hq;
      tested = true;
      const tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 16, 16);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx, 0);
      const tc = { cx: 0, cy: 0, gl: null, ready: true, hasLq: false };
      const d0 = new Uint8Array(4096 * 4), d1 = new Uint8Array(4096 * 4), dl = new Uint8Array(66 * 66 * 4).fill(255);
      for (let i = 0; i < 4096; i++) { d0[i * 4 + 2] = 1; d1[i * 4 + 3] = 1; }   // всюду стена №1, «под землёй»
      R.upload0(tc, d0); R.upload1(tc, d1); R.uploadL(tc, dl);
      const save = [R.w, R.h, R.tile, R.camX, R.camY], px = new Uint8Array(4);
      const sum = draw => { gl.viewport(0, 0, 16, 16); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); draw(); gl.readPixels(8, 8, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return px[0] + px[1] + px[2]; };
      R.w = 16; R.h = 16; R.tile = 8; R.camX = 2; R.camY = 2;
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const st = { sky: [1, 1, 1], amb: 0, time: 1, smooth: true, back: true, q: 2, glow: 0 };
      const bgs = { top: [.3, .5, .9], bot: [.6, .8, 1], hill1: [.3, .5, .6], hill2: [.2, .4, .3], hill3: [.1, .3, .2], sun: new Float32Array([.5, .2, .05, 1]), night: 0, surf: 2, time: 1, q: 2 };
      const res = { chunk: 0, bg: 0, chunkBasic: -1, bgBasic: -1 };
      try {
        if (progCH) { progC = progCH; res.chunk = sum(() => R.chunks([tc], st, 0)); if (res.chunk < 12) { progC = basicC(); res.chunkBasic = sum(() => R.chunks([tc], st, 0)); if (res.chunkBasic < 12) progC = progCH; } }
        if (progBH) { progB = progBH; res.bg = sum(() => R.background(bgs)); if (res.bg < 12) { progB = basicB(); res.bgBasic = sum(() => R.background(bgs)); if (res.bgBasic < 12) progB = progBH; } }
      } catch (e) { console.warn('Подземье: проверка шейдеров', e); }
      [R.w, R.h, R.tile, R.camX, R.camY] = save;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(tx); R.chunkFree(tc);
      gl.viewport(0, 0, R.w, R.h);
      R.hq = { chunk: progC === progCH && !!progCH, bg: progB === progBH && !!progBH, test: res };
      if (!R.hq.chunk || !R.hq.bg) console.warn('Подземье: «красивая» графика на этой видеокарте выключена', res);
      return R.hq;
    };
    // старые текстуры персонажа (лист сменился) — удалить через 10 с без использования
    R.gc = () => { for (const [img, t] of imgTex) if (R.frame - t.used > 600) { gl.deleteTexture(t.t); imgTex.delete(img); } };
    R.lost = () => gl.isContextLost();
    R.dispose = () => {
      for (const t of imgTex.values()) gl.deleteTexture(t.t);
      imgTex.clear();
      if (atlasTex) gl.deleteTexture(atlasTex); if (propsTex) gl.deleteTexture(propsTex); gl.deleteTexture(dynTex);
      gl.deleteBuffer(quad); gl.deleteBuffer(vboS); gl.deleteBuffer(ibo);
      try { R.post?.dispose(); } catch (e) {}
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
    return R;
  }

  window.PZGL = { paint, renderer, iconCanvas, PAT, ICON, SPR, OBJ, AN, AS, hex, rng, strSeed };
})();
