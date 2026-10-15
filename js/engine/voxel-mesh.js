// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — свет и сетки «Кубомира»: свет неба и блоков (волной по 3×3 чанкам) и «жадная» сетка чанка
//  с затенением углов (AO) и плавным светом по вершинам
// ═══════════════════════════════════════
// Работает в потоке (voxel-worker.js), в окне (если потоков нет) и в node. Вход — область 48×48×H (чанк в центре и
// по чанку вокруг): свет считается заново целиком — без «дыр» и «протечек» пошагового света; свет гаснет за 15 блоков,
// поэтому соседей на 16 блоков хватает для точного ответа. Выход — свет центра (Uint8Array: небо << 4 | блоки) и три
// сетки: solid (непрозрачное), cutout (листва, трава, стекло — отсечение по альфе), water (вода, прозрачная).
// Вершина: pos — Uint16 ×3 (1/16 блока; меш масштабирован 1/16), vd — Uint16 ×4: u, v (1/16 блока), слой | нормаль << 12,
// AO | небо×4 << 2 | блоки×4 << 8 | флаги << 14 (1 — качается на ветру, 2 — вода); col — Uint8 ×3 (цвет биома).
// Индексы общие для всех (0 1 2 0 2 3 + 4k): тёмный угол AO — порядком вершин (диагональ через светлые углы).
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const V = E.vox = E.vox || {};
  const H = V.H, RW = 48, SZ = H, SX = RW * H, RC = RW * RW * H;
  const TYPE = 0xfff;
  V.REGION = RW;

  // ═══ Свет области ═══
  let Q = null, SKY = null, BLK = null;
  const TOP = new Int16Array(RW * RW);
  V.lightRegion = (reg, T) => {
    if (!SKY) { SKY = new Uint8Array(RC); BLK = new Uint8Array(RC); Q = new Int32Array(1 << 20); }
    const op = T.op, emit = T.emit, sky = SKY, blk = BLK, QM = Q.length - 1;
    let qt = 0;
    blk.fill(0);
    // небо: сверху вниз по столбцу без потерь, через листву/воду — минус их «плотность»
    for (let c = 0; c < RW * RW; c++) {
      const b = c * H; let L = 15, t15 = 0;
      for (let y = H - 1; y >= 0; y--) {
        const o = op[reg[b + y] & TYPE];
        if (o >= 15) L = 0; else if (o) L = L > o ? L - o : 0;
        sky[b + y] = L;
        if (L === 15) t15 = y;
      }
      TOP[c] = t15;
    }
    // источники волны неба: освещённые клетки, рядом с которыми (сбоку или снизу) темнее, чем нужно
    for (let rx = 0; rx < RW; rx++) for (let rz = 0; rz < RW; rz++) {
      const c = rx * RW + rz, b = c * H;
      let hi = TOP[c];
      if (rx > 0 && TOP[c - RW] > hi) hi = TOP[c - RW];
      if (rx < RW - 1 && TOP[c + RW] > hi) hi = TOP[c + RW];
      if (rz > 0 && TOP[c - 1] > hi) hi = TOP[c - 1];
      if (rz < RW - 1 && TOP[c + 1] > hi) hi = TOP[c + 1];
      for (let y = 0; y < hi; y++) {
        const i = b + y, L = sky[i]; if (L < 2) continue;
        if ((rx > 0 && sky[i - SX] < L - 1 && op[reg[i - SX] & TYPE] < 15) || (rx < RW - 1 && sky[i + SX] < L - 1 && op[reg[i + SX] & TYPE] < 15) ||
            (rz > 0 && sky[i - SZ] < L - 1 && op[reg[i - SZ] & TYPE] < 15) || (rz < RW - 1 && sky[i + SZ] < L - 1 && op[reg[i + SZ] & TYPE] < 15) ||
            (y > 0 && sky[i - 1] < L - 1 && op[reg[i - 1] & TYPE] < 15)) { Q[qt] = i; qt = (qt + 1) & QM; }
      }
    }
    spread(reg, sky, op, 0, qt, QM);
    // свет блоков: факелы, лава, лампы…
    qt = 0;
    for (let i = 0; i < RC; i++) { const e = emit[reg[i] & TYPE]; if (e) { blk[i] = e; Q[qt] = i; qt = (qt + 1) & QM; } }
    spread(reg, blk, op, 0, qt, QM);
    return { sky, blk };
  };
  // волна: от клетки со светом l — соседу l − max(1, плотность соседа)
  function spread(reg, L, op, qh, qt, QM){
    while (qh !== qt) {
      const i = Q[qh]; qh = (qh + 1) & QM;
      const l = L[i]; if (l < 2) continue;
      const y = i & (H - 1), c = i >> 7, rz = c % RW, rx = (c - rz) / RW;
      for (let d = 0; d < 6; d++) {
        let j;
        if (d === 0) { if (rx === RW - 1) continue; j = i + SX; } else if (d === 1) { if (rx === 0) continue; j = i - SX; }
        else if (d === 2) { if (rz === RW - 1) continue; j = i + SZ; } else if (d === 3) { if (rz === 0) continue; j = i - SZ; }
        else if (d === 4) { if (y === H - 1) continue; j = i + 1; } else { if (y === 0) continue; j = i - 1; }
        const o = op[reg[j] & TYPE]; if (o >= 15) continue;
        const nl = l - (o > 1 ? o : 1);
        if (nl > L[j]) { L[j] = nl; if (nl >= 2) { Q[qt] = j; qt = (qt + 1) & QM; } }
      }
    }
  }

  // ═══ Сетка чанка ═══
  // буферы (растут по надобности и переиспользуются между заданиями)
  const streams = [0, 1, 2].map(() => ({ q: 0, cap: 0, pos: null, vd: null, col: null }));
  function grow(s, need){
    if (s.cap >= need) return;
    let cap = s.cap || 4096; while (cap < need) cap *= 2;
    const pos = new Uint16Array(cap * 12), vd = new Uint16Array(cap * 16), col = new Uint8Array(cap * 12);
    if (s.pos) { pos.set(s.pos.subarray(0, s.q * 12)); vd.set(s.vd.subarray(0, s.q * 16)); col.set(s.col.subarray(0, s.q * 12)); }
    s.pos = pos; s.vd = vd; s.col = col; s.cap = cap;
  }
  // направления: 0 +x, 1 −x, 2 +y, 3 −y, 4 +z, 5 −z; оси граней (ua, va), шаги в области и углы вершин (du, dv)
  // (порядок вершин — против часовой стрелки, если смотреть снаружи)
  const DIRS = [
    { n: SX, ua: 1, va: 2, tu: 1, tv: SZ, c: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    { n: -SX, ua: 1, va: 2, tu: 1, tv: SZ, c: [[0, 1], [1, 1], [1, 0], [0, 0]] },
    { n: 1, ua: 0, va: 2, tu: SX, tv: SZ, c: [[0, 0], [0, 1], [1, 1], [1, 0]] },
    { n: -1, ua: 0, va: 2, tu: SX, tv: SZ, c: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    { n: SZ, ua: 0, va: 1, tu: SX, tv: 1, c: [[1, 0], [1, 1], [0, 1], [0, 0]] },
    { n: -SZ, ua: 0, va: 1, tu: SX, tv: 1, c: [[0, 0], [0, 1], [1, 1], [1, 0]] },
  ];
  V.MESH_DIRS = DIRS;
  // сторона «лицом» (как V.FACING): 0 +z, 1 −x, 2 −z, 3 +x → номер направления грани
  const FACE_OF = [4, 1, 5, 0];
  // Текстура грани: обычная; «перед» у повёрнутых (печь, сундук, верстак; горящая печь — extra); торцы брёвен — по оси
  function texFor(T, t, st, d){
    const b = t * 7;
    if (T.axis[t]) {
      const ax = st & 3;
      if (ax === 1) return d < 2 ? T.tex[b] : T.tex[b + 2];
      if (ax === 2) return d >= 4 ? T.tex[b] : T.tex[b + 2];
    }
    if (d === 2) return T.tex[b]; if (d === 3) return T.tex[b + 1];
    const front = T.tex[b + 3], side = T.tex[b + 2];
    if (front !== side && front >= 0 && FACE_OF[st & 3] === d) return (st & 4) && T.tex[b + 5] >= 0 ? T.tex[b + 5] : front;
    return side;
  }
  V.texFor = texFor;
  const BIRCH = [128, 167, 85], SPRUCE = [97, 153, 97], WHITE = [255, 255, 255];
  const TC = [0, 0, 0];
  function tintOf(tint, x, z, kind, out){
    if (kind === 4) { out[0] = BIRCH[0]; out[1] = BIRCH[1]; out[2] = BIRCH[2]; return out; }
    if (kind === 5) { out[0] = SPRUCE[0]; out[1] = SPRUCE[1]; out[2] = SPRUCE[2]; return out; }
    if (!tint) { out[0] = kind === 3 ? 63 : 120; out[1] = kind === 3 ? 118 : 190; out[2] = kind === 3 ? 228 : 90; return out; }
    const k = (x * 16 + z) * 9 + (kind === 1 ? 0 : kind === 2 ? 3 : 6);
    out[0] = tint[k]; out[1] = tint[k + 1]; out[2] = tint[k + 2];
    return out;
  }

  // маски «жадной» склейки (слой до 128 × 16)
  const MK0 = new Int32Array(H * 16), MK1 = new Int32Array(H * 16), MK2 = new Int32Array(H * 16), MK3 = new Int32Array(H * 16), MAO = new Int32Array(H * 16);
  const CS = new Int32Array(4), CB = new Int32Array(4), CA = new Int32Array(4);
  const PQ = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

  // reg — область 48×48×H (Uint16), light — { sky, blk } из V.lightRegion, T — V.T, tint — цвета биомов центра (256 × 9)
  V.meshChunk = (reg, light, T, tint) => {
    const sky = light.sky, blk = light.blk, opaque = T.opaque, shape = T.shape, layerT = T.layer, cull = T.cullSelf, tintT = T.tint, liquid = T.liquid;
    for (const s of streams) s.q = 0;
    // выше последнего непустого — делать нечего
    let yMax = 0;
    for (let x = 16; x < 32; x++) for (let z = 16; z < 32; z++) {
      const b = (x * RW + z) * H; let y = H - 1;
      while (y > 0 && reg[b + y] === 0) y--;
      if (y > yMax) yMax = y;
    }
    // ── кубы: по 6 направлениям, слоями, «жадно» ──
    for (let d = 0; d < 6; d++) {
      const D = DIRS[d], axis = d >> 1, nU = D.ua === 1 ? H : 16, nV = D.va === 1 ? H : 16;
      const sliceN = axis === 1 ? Math.min(H, yMax + 1) : 16;
      const dy = d === 2 ? 1 : d === 3 ? -1 : 0;
      for (let sl = 0; sl < sliceN; sl++) {
        let any = false;
        for (let v = 0; v < nV; v++) for (let u = 0; u < nU; u++) {
          const mi = v * nU + u;
          MK0[mi] = 0;
          let x, y, z;
          if (axis === 0) { x = sl; y = u; z = v; } else if (axis === 1) { x = u; y = sl; z = v; } else { x = u; y = v; z = sl; }
          if (y > yMax) continue;
          const ri = ((x + 16) * RW + (z + 16)) * H + y, cv = reg[ri], t = cv & TYPE;
          if (shape[t] !== 1) continue;
          const ny = y + dy;
          if (ny < 0) continue;   // низ мира не видно
          const nt = ny >= H ? 0 : reg[ri + D.n] & TYPE;
          if (opaque[nt] || (nt === t && cull[t])) continue;
          const layer = texFor(T, t, cv >>> 12, d);
          if (layer < 0) continue;
          // углы: AO и свет по 4 клеткам перед гранью (вне мира по y: сверху — светло, снизу — темно)
          if (ny >= H) { CA[0] = CA[1] = CA[2] = CA[3] = 3; CS[0] = CS[1] = CS[2] = CS[3] = 60; CB[0] = CB[1] = CB[2] = CB[3] = 0; }
          else {
            const n = ri + D.n, nTop = ny >= H - 1, nBot = ny <= 0;
            for (let k = 0; k < 4; k++) {
              const du = D.c[k][0] ? 1 : -1, dv = D.c[k][1] ? 1 : -1, su = D.tu * du, sv = D.tv * dv;
              const okU = !(D.tu === 1 && ((du > 0 && nTop) || (du < 0 && nBot))), okV = !(D.tv === 1 && ((dv > 0 && nTop) || (dv < 0 && nBot)));
              const o1 = okU ? opaque[reg[n + su] & TYPE] : 0, o2 = okV ? opaque[reg[n + sv] & TYPE] : 0, oc = okU && okV ? opaque[reg[n + su + sv] & TYPE] : 0;
              CA[k] = o1 && o2 ? 0 : 3 - o1 - o2 - oc;
              let ls = sky[n], lb = blk[n], cnt = 1;
              if (okU && !o1) { ls += sky[n + su]; lb += blk[n + su]; cnt++; }
              if (okV && !o2) { ls += sky[n + sv]; lb += blk[n + sv]; cnt++; }
              if (okU && okV && !oc && !(o1 && o2)) { ls += sky[n + su + sv]; lb += blk[n + su + sv]; cnt++; }
              CS[k] = (ls * 4 + (cnt >> 1)) / cnt | 0; CB[k] = (lb * 4 + (cnt >> 1)) / cnt | 0;
            }
          }
          const tk = tintT[t];
          let tq = 0;
          if (tk && !(tk === 1 && d !== 2)) { tintOf(tint, x, z, tk, TC); tq = 0x1000000 | ((TC[0] >> 3) << 10) | ((TC[1] >> 3) << 5) | (TC[2] >> 3); }
          const lay = layerT[t] === 2 ? 1 : 0, sway = tk === 2 || tk === 4 || tk === 5 ? 1 : 0;
          MK0[mi] = 0x800000 | layer | (lay << 12) | (sway << 13);
          MAO[mi] = CA[0] | (CA[1] << 2) | (CA[2] << 4) | (CA[3] << 6);
          MK1[mi] = CS[0] | (CS[1] << 6) | (CS[2] << 12) | (CS[3] << 18);
          MK2[mi] = CB[0] | (CB[1] << 6) | (CB[2] << 12) | (CB[3] << 18);
          MK3[mi] = tq;
          any = true;
        }
        if (!any) continue;
        // склейка: вдоль u, потом строки вдоль v
        for (let v = 0; v < nV; v++) for (let u = 0; u < nU;) {
          const mi = v * nU + u, k0 = MK0[mi];
          if (!k0) { u++; continue; }
          const ka = MAO[mi], k1 = MK1[mi], k2 = MK2[mi], k3 = MK3[mi];
          let w = 1;
          while (u + w < nU) { const j = mi + w; if (MK0[j] !== k0 || MAO[j] !== ka || MK1[j] !== k1 || MK2[j] !== k2 || MK3[j] !== k3) break; w++; }
          let h = 1;
          grow: while (v + h < nV) {
            const row = (v + h) * nU + u;
            for (let q = 0; q < w; q++) { const j = row + q; if (MK0[j] !== k0 || MAO[j] !== ka || MK1[j] !== k1 || MK2[j] !== k2 || MK3[j] !== k3) break grow; }
            h++;
          }
          for (let hh = 0; hh < h; hh++) { const row = (v + hh) * nU + u; for (let q = 0; q < w; q++) MK0[row + q] = 0; }
          let x, y, z;
          if (axis === 0) { x = sl; y = u; z = v; } else if (axis === 1) { x = u; y = sl; z = v; } else { x = u; y = v; z = sl; }
          emitCube(streams[(k0 >> 12) & 1], d, x, y, z, w, h, k0 & 0xfff, ka, k1, k2, k3, (k0 >> 13) & 1);
          u += w;
        }
      }
    }
    // ── не кубы: трава и цветы, факелы, лестницы, двери, кактусы, сундуки, жидкости ──
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      const b0 = ((x + 16) * RW + (z + 16)) * H;
      for (let y = 0; y <= yMax; y++) {
        const ri = b0 + y, cv = reg[ri], t = cv & TYPE, sh = shape[t];
        if (sh <= 1) continue;
        const st = cv >>> 12, ls = sky[ri], lb = blk[ri];
        if (sh === 2) {   // крест: две диагонали, каждая — с двух сторон
          const tk = tintT[t], c = tk ? tintOf(tint, x, z, tk, TC) : WHITE, lay = T.tex[t * 7 + 2];
          cross(streams[1], x + .15, y, z + .15, .7, 1, lay, ls, lb, c, 1);
        } else if (sh === 4) {   // факел: крест; на стене — прижат к ней и чуть выше
          const f = st & 7, dd = f >= 1 && f <= 4 ? V.FACING[f - 1] : null;
          cross(streams[1], x + .3 - (dd ? dd[0] * .3 : 0), y + (dd ? .2 : 0), z + .3 - (dd ? dd[2] * .3 : 0), .4, 1, T.tex[t * 7 + 2], 15, 14, WHITE, 0);
        } else if (sh === 5) {   // лестница: пластина у стены, с двух сторон
          const dd = V.FACING[st & 3], e = .06, lay = T.tex[t * 7 + 2];
          let A, B;   // концы пластины по горизонтали (снизу)
          if (dd[0] > 0) { A = [x + e, z + 1]; B = [x + e, z]; } else if (dd[0] < 0) { A = [x + 1 - e, z]; B = [x + 1 - e, z + 1]; }
          else if (dd[2] > 0) { A = [x, z + e]; B = [x + 1, z + e]; } else { A = [x + 1, z + 1 - e]; B = [x, z + 1 - e]; }
          plate(streams[1], A, B, y, 1, lay, ls, lb, WHITE, 0, false);
          plate(streams[1], B, A, y, 1, lay, ls, lb, WHITE, 0, false);
        } else if (sh === 6 || sh === 7 || sh === 8) {   // дверь / кактус / сундук: коробка
          const bx = V.boxOf(cv, false); if (!bx) continue;
          for (let d = 0; d < 6; d++) {
            const D = DIRS[d], ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
            const onEdge = (d === 0 && bx[3] >= 1) || (d === 1 && bx[0] <= 0) || (d === 2 && bx[4] >= 1) || (d === 3 && bx[1] <= 0) || (d === 4 && bx[5] >= 1) || (d === 5 && bx[2] <= 0);
            let li = ri;
            if (onEdge && ny >= 0 && ny < H) { const nt = reg[ri + D.n] & TYPE; if (opaque[nt] || (nt === t && sh === 7 && (d === 2 || d === 3))) continue; li = ri + D.n; }
            let lay;
            if (sh === 6) lay = T.tex[t * 7 + ((st >> 3) & 1 && d !== 2 && d !== 3 ? 0 : 2)];
            else lay = texFor(T, t, st & 3, d);
            boxFace(streams[1], d, x, y, z, bx, lay, Math.max(sky[li], ls), Math.max(blk[li], lb), WHITE, 0);
          }
        } else if (sh === 3) {   // жидкость: вода — прозрачная, лава — непрозрачная
          const lq = liquid[t], s = lq === 1 ? streams[2] : streams[0], lay = T.tex[t * 7 + 2];
          const above = y < H - 1 ? reg[ri + 1] & TYPE : 0, full = above === t, hgt = full ? 1 : V.liquidHeight(cv);
          const c = lq === 1 ? tintOf(tint, x, z, 3, TC) : WHITE;
          for (let d = 0; d < 6; d++) {
            const D = DIRS[d], ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
            if (ny < 0) continue;
            const nt = ny >= H ? 0 : reg[ri + D.n] & TYPE;
            if (nt === t) continue;
            if (opaque[nt] && d !== 2) continue;
            if (d === 2 && full) continue;
            const li = ny < H ? ri + D.n : ri;
            WB[4] = hgt;
            boxFace(s, d, x, y, z, WB, lay, Math.max(sky[li], ls), Math.max(blk[li], lb), c, lq === 1 ? 2 : 0);
          }
        }
      }
    }
    // выход: копии нужной длины (буферы потока остаются)
    const out = { yMax };
    ['solid', 'cutout', 'water'].forEach((k, i) => {
      const s = streams[i];
      out[k] = s.q ? { n: s.q, pos: s.pos.slice(0, s.q * 12), vd: s.vd.slice(0, s.q * 16), col: s.col.slice(0, s.q * 12) } : null;
    });
    // свет центра (для игры: яркость мобов, где им появляться)
    const L = new Uint8Array(V.CELLS);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      const b = ((x + 16) * RW + (z + 16)) * H, o2 = (x << 11) | (z << 7);
      for (let y = 0; y < H; y++) L[o2 | y] = (sky[b + y] << 4) | blk[b + y];
    }
    out.light = L;
    return out;
  };
  const WB = [0, 0, 0, 1, .875, 1], BC = [0, 0, 0];

  // Квадрат «жадной» грани: клетка (x, y, z), w × h по осям (ua, va)
  function emitCube(s, d, x, y, z, w, h, layer, ka, k1, k2, k3, sway){
    grow(s, s.q + 1);
    const D = DIRS[d], q = s.q++, P = s.pos, VD = s.vd, C = s.col;
    const a0 = ka & 3, a1 = (ka >> 2) & 3, a2 = (ka >> 4) & 3, a3 = (ka >> 6) & 3;
    const flip = a0 + a2 < a1 + a3 ? 1 : 0;   // тёмная диагональ 0–2 — делим по 1–3
    const r = k3 ? (((k3 >> 10) & 31) << 3) | 4 : 255, g = k3 ? (((k3 >> 5) & 31) << 3) | 4 : 255, b = k3 ? ((k3 & 31) << 3) | 4 : 255;
    for (let vi = 0; vi < 4; vi++) {
      const k = (vi + flip) & 3, du = D.c[k][0], dv = D.c[k][1];
      let X = x, Y = y, Z = z;
      if (d === 0) X++; else if (d === 2) Y++; else if (d === 4) Z++;
      if (D.ua === 0) X += du * w; else Y += du * w;
      if (D.va === 1) Y += dv * h; else Z += dv * h;
      let U, Vv;
      if (d === 2 || d === 3) { U = X; Vv = Z; } else if (d === 0) { U = 16 - Z; Vv = H - Y; } else if (d === 1) { U = Z; Vv = H - Y; } else if (d === 4) { U = X; Vv = H - Y; } else { U = 16 - X; Vv = H - Y; }
      const o = q * 4 + vi, ak = k === 0 ? a0 : k === 1 ? a1 : k === 2 ? a2 : a3;
      P[o * 3] = X * 16; P[o * 3 + 1] = Y * 16; P[o * 3 + 2] = Z * 16;
      VD[o * 4] = U * 16; VD[o * 4 + 1] = Vv * 16; VD[o * 4 + 2] = layer | (d << 12);
      VD[o * 4 + 3] = ak | (((k1 >> (k * 6)) & 63) << 2) | (((k2 >> (k * 6)) & 63) << 8) | (sway << 14);
      C[o * 3] = r; C[o * 3 + 1] = g; C[o * 3 + 2] = b;
    }
  }
  // Вертикальная пластина от A до B (по горизонтали), высота h, против часовой — со стороны «справа» от A→B
  function plate(s, A, B, y, h, layer, ls, lb, c, sway, rev){
    PQ[0][0] = A[0]; PQ[0][1] = y; PQ[0][2] = A[1];
    PQ[1][0] = A[0]; PQ[1][1] = y + h; PQ[1][2] = A[1];
    PQ[2][0] = B[0]; PQ[2][1] = y + h; PQ[2][2] = B[1];
    PQ[3][0] = B[0]; PQ[3][1] = y; PQ[3][2] = B[1];
    quad(s, PQ, layer, 6, ls, lb, c, sway);
  }
  // Крест (трава, цветы, факел): квадрат со стороной k в плане от (x0, z0), высота h
  function cross(s, x0, y, z0, k, h, layer, ls, lb, c, sway){
    const A = [x0, z0], B = [x0 + k, z0 + k], C2 = [x0 + k, z0], D2 = [x0, z0 + k];
    plate(s, A, B, y, h, layer, ls, lb, c, sway); plate(s, B, A, y, h, layer, ls, lb, c, sway);
    plate(s, C2, D2, y, h, layer, ls, lb, c, sway); plate(s, D2, C2, y, h, layer, ls, lb, c, sway);
  }
  const UV4 = [[0, 1], [0, 0], [1, 0], [1, 1]];
  function quad(s, P4, layer, nrm, ls, lb, c, sway){
    grow(s, s.q + 1);
    const q = s.q++, P = s.pos, VD = s.vd, C = s.col;
    for (let vi = 0; vi < 4; vi++) {
      const p = P4[vi], o = q * 4 + vi;
      P[o * 3] = Math.round(p[0] * 16); P[o * 3 + 1] = Math.round(p[1] * 16); P[o * 3 + 2] = Math.round(p[2] * 16);
      VD[o * 4] = UV4[vi][0] * 16; VD[o * 4 + 1] = UV4[vi][1] * 16; VD[o * 4 + 2] = layer | (nrm << 12);
      VD[o * 4 + 3] = 3 | ((ls * 4) << 2) | ((lb * 4) << 8) | ((sway && (vi === 1 || vi === 2) ? 1 : 0) << 14);
      C[o * 3] = c[0]; C[o * 3 + 1] = c[1]; C[o * 3 + 2] = c[2];
    }
  }
  // Грань коробки bx (доли блока) в направлении d: дверь, кактус, сундук, вода. UV — по доле клетки (не тянется)
  function boxFace(s, d, x, y, z, bx, layer, ls, lb, c, flags){
    grow(s, s.q + 1);
    const D = DIRS[d], q = s.q++, P = s.pos, VD = s.vd, C = s.col, nAx = d >> 1, nHi = (d & 1) === 0;
    for (let vi = 0; vi < 4; vi++) {
      const du = D.c[vi][0], dv = D.c[vi][1], o = q * 4 + vi;
      BC[nAx] = nHi ? bx[nAx + 3] : bx[nAx];
      BC[D.ua] = du ? bx[D.ua + 3] : bx[D.ua];
      BC[D.va] = dv ? bx[D.va + 3] : bx[D.va];
      const X = BC[0], Y = BC[1], Z = BC[2];
      let U, Vv;
      if (d === 2 || d === 3) { U = X; Vv = Z; } else if (d === 0) { U = 1 - Z; Vv = 1 - Y; } else if (d === 1) { U = Z; Vv = 1 - Y; } else if (d === 4) { U = X; Vv = 1 - Y; } else { U = 1 - X; Vv = 1 - Y; }
      P[o * 3] = Math.round((x + X) * 16); P[o * 3 + 1] = Math.round((y + Y) * 16); P[o * 3 + 2] = Math.round((z + Z) * 16);
      VD[o * 4] = Math.round(U * 16); VD[o * 4 + 1] = Math.round(Vv * 16); VD[o * 4 + 2] = layer | (d << 12);
      VD[o * 4 + 3] = 3 | ((ls * 4) << 2) | ((lb * 4) << 8) | (flags << 14);
      C[o * 3] = c[0]; C[o * 3 + 1] = c[1]; C[o * 3 + 2] = c[2];
    }
  }

  // Собрать область 48×48×H из чанков: get(cx, cz) → Uint16Array чанка или null (нет — воздух)
  V.buildRegion = (get, cx, cz, out) => {
    const reg = out && out.length === RC ? out : new Uint16Array(RC);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const ids = get(cx + dx, cz + dz), ox = (dx + 1) * 16, oz = (dz + 1) * 16;
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
        const dst = ((ox + x) * RW + (oz + z)) * H, src = (x << 11) | (z << 7);
        if (ids) reg.set(ids.subarray(src, src + H), dst); else reg.fill(0, dst, dst + H);
      }
    }
    return reg;
  };
})();
