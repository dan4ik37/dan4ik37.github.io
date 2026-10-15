// ═══════════════════════════════════════
//  QR-КОД кодом, без библиотек и сети (ссылка-приглашение «👥 Пригласи друзей», js/features/invite.js)
// ═══════════════════════════════════════
// По стандарту QR (ISO/IEC 18004): байтовый режим (UTF-8), уровень коррекции M (~15 % можно испортить), версии 1–10
// (до 213 байт — ссылке хватает), маска — лучшая из 8 по штрафам стандарта. Проверка: scripts/referral-test.cjs (структура,
// коды Рида — Соломона) и расшифровка OpenCV (см. docs/REFERRALS.md).
// API (window.D37QR): make(text) → { size, version, mask, dark(x, y) } или null (слишком длинно); svg(text, { px, margin, dark, light })
// → строка <svg>; draw(canvas, text, { px, margin, dark, light }).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  // Уровень M: [кодовых слов коррекции на блок, [блоков, данных в блоке], [блоков, данных в блоке]]
  const ECC_M = [null,
    [10, [1, 16]], [16, [1, 28]], [26, [1, 44]], [18, [2, 32]], [24, [2, 43]],
    [16, [4, 27]], [18, [4, 31]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  const MAX_V = 10;

  // ── Поле GF(256), x^8 + x^4 + x^3 + x^2 + 1 (0x11D) ──
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;
  // Многочлен-генератор: (x − α^0)(x − α^1)…(x − α^(n−1)), коэффициенты от старшего
  function generator(n){
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
      g = next;
    }
    return g;
  }
  // Остаток деления data·x^n на генератор — n кодовых слов коррекции
  function rsEncode(data, n){
    const g = generator(n), res = new Array(n).fill(0);
    for (const d of data) {
      const f = d ^ res[0];
      res.shift(); res.push(0);
      for (let i = 0; i < n; i++) res[i] ^= mul(g[i + 1], f);
    }
    return res;
  }

  const utf8 = s => {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(String(s)));
    return Array.from(unescape(encodeURIComponent(String(s))), c => c.charCodeAt(0));
  };
  const dataWords = v => { const e = ECC_M[v]; return e[1][0] * e[1][1] + (e[2] ? e[2][0] * e[2][1] : 0); };
  const capacity = v => Math.floor((dataWords(v) * 8 - 4 - (v < 10 ? 8 : 16)) / 8);

  // Кодовые слова: режим «байты», длина, данные, конец, добивка 0xEC 0x11; блоки + коррекция, перемешанные по стандарту
  function codewords(bytes, v){
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    const cap = dataWords(v) * 8;
    put(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    for (let pad = 0xec; data.length < dataWords(v); pad ^= 0xec ^ 0x11) data.push(pad);
    const e = ECC_M[v], blocks = [];
    let k = 0;
    for (const grp of [e[1], e[2]]) {
      if (!grp) continue;
      for (let i = 0; i < grp[0]; i++) { const d = data.slice(k, k + grp[1]); k += grp[1]; blocks.push({ d, e: rsEncode(d, e[0]) }); }
    }
    const out = [], maxD = Math.max(...blocks.map(b => b.d.length));
    for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
    for (let i = 0; i < e[0]; i++) for (const b of blocks) out.push(b.e[i]);
    return out;
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
  ];

  function build(bytes, v){
    const size = 17 + 4 * v;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));     // m[y][x] — тёмный?
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));    // служебный модуль
    const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
    // искатели (с белой рамкой)
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
    // полосы синхронизации
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    // выравнивающие узоры
    const al = ALIGN[v];
    for (const ay of al) for (const ax of al) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === al[al.length - 1]) || (ax === al[al.length - 1] && ay === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    // место под формат (заполним потом), тёмный модуль
    for (let i = 0; i < 9; i++) { if (!fn[8][i]) set(i, 8, false); if (!fn[i][8]) set(8, i, false); }
    for (let i = 0; i < 8; i++) { set(size - 1 - i, 8, false); set(8, size - 1 - i, false); }
    set(8, size - 8, true);
    // версия (с 7-й)
    if (v >= 7) {
      let rem = v;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (v << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = ((bits >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, bit); set(b, a, bit);
      }
    }
    // данные — змейкой снизу справа, по два столбца, столбец 6 пропускаем
    const cw = codewords(bytes, v);
    let bit = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
          if (fn[y][x]) continue;
          if (bit < cw.length * 8) m[y][x] = ((cw[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
          bit++;
        }
      }
    }
    return { size, m, fn };
  }

  // Формат: уровень M (00) + маска, BCH(15,5), маска 0x5412
  function formatBits(mask){
    const data = (0 << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }
  function drawFormat(q, mask){
    const bits = formatBits(mask), s = q.size, b = i => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) q.m[i][8] = b(i);
    q.m[7][8] = b(6); q.m[8][8] = b(7); q.m[8][7] = b(8);
    for (let i = 9; i < 15; i++) q.m[8][14 - i] = b(i);
    for (let i = 0; i < 8; i++) q.m[8][s - 1 - i] = b(i);
    for (let i = 8; i < 15; i++) q.m[s - 15 + i][8] = b(i);
    q.m[s - 8][8] = true;
  }
  function applyMask(q, mask){
    const f = MASKS[mask];
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (!q.fn[y][x] && f(x, y)) q.m[y][x] = !q.m[y][x];
  }
  // Штраф маски (4 правила стандарта): длинные ряды, квадраты 2×2, узор как у искателя, перекос тёмного
  function penalty(q){
    const s = q.size, m = q.m;
    let p = 0, dark = 0;
    const line = get => {
      let run = 1, prev = get(0), pts = 0;
      for (let i = 1; i < s; i++) {
        const c = get(i);
        if (c === prev) run++; else { if (run >= 5) pts += 3 + run - 5; run = 1; prev = c; }
      }
      if (run >= 5) pts += 3 + run - 5;
      // узор искателя 1:1:3:1:1 со светлой полосой 4 с любой стороны; за краем — светлая рамка (так видит камера)
      let t = '0000';
      for (let i = 0; i < s; i++) t += get(i) ? '1' : '0';
      t += '0000';
      for (let i = 0; i + 11 <= t.length; i++) {
        const w = t.substr(i, 11);
        if (w === '10111010000' || w === '00001011101') pts += 40;
      }
      return pts;
    };
    for (let y = 0; y < s; y++) p += line(x => m[y][x]);
    for (let x = 0; x < s; x++) p += line(y => m[y][x]);
    for (let y = 0; y < s - 1; y++) for (let x = 0; x < s - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if (m[y][x]) dark++;
    p += 10 * Math.floor(Math.abs(dark * 100 / (s * s) - 50) / 5);
    return p;
  }

  function make(text){
    const bytes = utf8(text);
    let v = 1;
    while (v <= MAX_V && capacity(v) < bytes.length) v++;
    if (v > MAX_V) return null;
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const q = build(bytes, v);
      applyMask(q, mask);
      drawFormat(q, mask);
      const pts = penalty(q);
      if (!best || pts < best.pts) best = { q, mask, pts };
    }
    const { q, mask } = best;
    return { size: q.size, version: v, mask, dark: (x, y) => !!(q.m[y] && q.m[y][x]), rows: q.m };
  }

  function svg(text, o = {}){
    const q = make(text);
    if (!q) return '';
    const px = o.px || 6, mg = o.margin == null ? 4 : o.margin, n = q.size + mg * 2;
    let d = '';
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.dark(x, y)) d += `M${x + mg} ${y + mg}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n * px}" height="${n * px}" shape-rendering="crispEdges" role="img" aria-label="QR-код">`
      + `<rect width="${n}" height="${n}" fill="${o.light || '#fff'}"/><path d="${d}" fill="${o.dark || '#000'}"/></svg>`;
  }

  function draw(canvas, text, o = {}){
    const q = make(text);
    if (!q || !canvas?.getContext) return false;
    const px = o.px || 6, mg = o.margin == null ? 4 : o.margin, n = q.size + mg * 2;
    canvas.width = canvas.height = n * px;
    const g = canvas.getContext('2d');
    g.fillStyle = o.light || '#fff'; g.fillRect(0, 0, n * px, n * px);
    g.fillStyle = o.dark || '#000';
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.dark(x, y)) g.fillRect((x + mg) * px, (y + mg) * px, px, px);
    return true;
  }

  root.D37QR = { make, svg, draw, _test: { rsEncode, generator, codewords, formatBits, capacity, ECC_M, ALIGN, EXP, LOG, mul } };
})();
