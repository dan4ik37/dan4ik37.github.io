// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — свет и сетки «Кубомира»: свет неба и ЦВЕТНОЙ свет блоков (волной по 3×3 чанкам) и «жадная» сетка
//  чанка с затенением углов (AO) и плавным светом по вершинам
// ═══════════════════════════════════════
// Работает в потоке (voxel-worker.js), в окне (если потоков нет) и в node. Вход — область 48×48×H (чанк в центре и
// по чанку вокруг): свет считается заново целиком — без «дыр» и «протечек» пошагового света; свет гаснет за 15 блоков,
// поэтому соседей на 16 блоков хватает для точного ответа. Свет блоков — три канала R, G, B по 0…255 (уровень × 17; у
// факела, лавы, лампы свой цвет — V.T.ecol); за шаг самый яркий канал гаснет на уровень (сквозь воду — сильнее), остальные
// — в той же доле: цвет с расстоянием тускнеет, но не «краснеет»; разные источники смешиваются по наибольшему. Выход —
// свет центра (Uint16Array: небо << 12 | R << 8 | G << 4 | B, по 0…15), сетки V.LAYERS: solid (непрозрачное), cutout (факелы,
// лестницы, двери, сундуки, кактусы — отсечение по альфе), water (вода, прозрачная), foliage (листва, трава, цветы — по альфе,
// качаются), glass (стекло — по альфе) и lights — светящиеся клетки центра (для настоящих ламп и ореолов).
// Вершина: pos — Uint16 ×3 (1/16 блока; меш масштабирован 1/16), vd — Uint16 ×4: u, v (1/16 блока), слой | нормаль << 12,
// AO | свечение грани (0…15) << 2 | флаги << 14 (1 — качается на ветру, 2 — вода); lt — Uint8 ×4: небо, R, G, B (×4 — 0…60,
// плавно: среднее по 4 клеткам у угла); col — Uint8 ×3 (цвет биома).
// Вода (T-044, 22.10.2026): у граней воды u, v — 0…16 в младших 5 битах, выше — глубина под гладью у 4 углов грани (по 5 бит,
// трети блока, до 10⅓): u | угол(0,0) << 5 | угол(1,0) << 10, v | угол(0,1) << 5 | угол(1,1) << 10 (углы — по u, v грани); в
// vd.w биты 6…9 — «берег» у этих углов (у глади блок: пена). Шейдер воды смешивает углы билинейно — прозрачность по глубине без
// «треугольников» на склонах дна.
// Индексы общие для всех (0 1 2 0 2 3 + 4k): тёмный угол AO — порядком вершин (диагональ через светлые углы).
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const V = E.vox = E.vox || {};
  const H = V.H, RW = 48, SZ = H, SX = RW * H, RC = RW * RW * H;
  const TYPE = 0xfff;
  V.REGION = RW;
  // сетки чанка (по одной на вид материала): непрозрачное, вырезное (факелы, лестницы, двери, сундуки), вода, листва и
  // трава (качаются на ветру), стекло — V.T.stream[блок] = номер здесь. Новые — только в конец (номера в потоках)
  V.LAYERS = ['solid', 'cutout', 'water', 'foliage', 'glass'];

  // ═══ Свет области ═══
  let Q = null, SKY = null, LR = null, LG = null, LB = null;
  const TOP = new Int16Array(RW * RW);
  V.lightRegion = (reg, T) => {
    if (!SKY) { SKY = new Uint8Array(RC); LR = new Uint8Array(RC); LG = new Uint8Array(RC); LB = new Uint8Array(RC); Q = new Int32Array(1 << 20); }
    const op = T.op, emit = T.emit, ecol = T.ecol, sky = SKY, QM = Q.length - 1;
    let qt = 0;
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
    // свет блоков (факелы, лава, лампы…) — три канала цвета
    LR.fill(0); LG.fill(0); LB.fill(0);
    qt = 0;
    for (let i = 0; i < RC; i++) {
      const t = reg[i] & TYPE, e = emit[t]; if (!e) continue;
      if (ecol) { LR[i] = ecol[t * 3]; LG[i] = ecol[t * 3 + 1]; LB[i] = ecol[t * 3 + 2]; } else LR[i] = LG[i] = LB[i] = e * 17;
      Q[qt] = i; qt = (qt + 1) & QM;
    }
    spreadRGB(reg, op, qt, QM);
    return { sky, r: LR, g: LG, b: LB };
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
  // та же волна для цвета (каналы 0…255): самый яркий канал клетки m гаснет на 17 × max(1, плотность), остальные — в той же
  // доле (оттенок сохраняется); сосед берёт по каждому каналу наибольшее и идёт дальше, если хоть один канал стал ярче
  function spreadRGB(reg, op, qt, QM){
    let qh = 0;
    while (qh !== qt) {
      const i = Q[qh]; qh = (qh + 1) & QM;
      const r = LR[i], g = LG[i], b = LB[i], m = r > g ? (r > b ? r : b) : (g > b ? g : b);
      if (m < 34) continue;   // меньше 2 уровней — дальше не идёт
      const y = i & (H - 1), c = i >> 7, rz = c % RW, rx = (c - rz) / RW;
      for (let d = 0; d < 6; d++) {
        let j;
        if (d === 0) { if (rx === RW - 1) continue; j = i + SX; } else if (d === 1) { if (rx === 0) continue; j = i - SX; }
        else if (d === 2) { if (rz === RW - 1) continue; j = i + SZ; } else if (d === 3) { if (rz === 0) continue; j = i - SZ; }
        else if (d === 4) { if (y === H - 1) continue; j = i + 1; } else { if (y === 0) continue; j = i - 1; }
        const o = op[reg[j] & TYPE]; if (o >= 15) continue;
        const nm = m - (o > 1 ? o : 1) * 17; if (nm <= 0) continue;
        const nr = r * nm / m | 0, ng = g * nm / m | 0, nb = b * nm / m | 0;
        let up = 0;
        if (nr > LR[j]) { LR[j] = nr; up = 1; }
        if (ng > LG[j]) { LG[j] = ng; up = 1; }
        if (nb > LB[j]) { LB[j] = nb; up = 1; }
        if (up && (LR[j] >= 34 || LG[j] >= 34 || LB[j] >= 34)) { Q[qt] = j; qt = (qt + 1) & QM; }
      }
    }
  }

  // ═══ Сетка чанка ═══
  // буферы (растут по надобности и переиспользуются между заданиями)
  const streams = V.LAYERS.map(() => ({ q: 0, cap: 0, pos: null, vd: null, col: null, lt: null }));
  function grow(s, need){
    if (s.cap >= need) return;
    let cap = s.cap || 4096; while (cap < need) cap *= 2;
    const pos = new Uint16Array(cap * 12), vd = new Uint16Array(cap * 16), col = new Uint8Array(cap * 12), lt = new Uint8Array(cap * 16);
    if (s.pos) { pos.set(s.pos.subarray(0, s.q * 12)); vd.set(s.vd.subarray(0, s.q * 16)); col.set(s.col.subarray(0, s.q * 12)); lt.set(s.lt.subarray(0, s.q * 16)); }
    s.pos = pos; s.vd = vd; s.col = col; s.lt = lt; s.cap = cap;
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

  // маски «жадной» склейки (слой до 128 × 16): вид, AO, свет неба и R, G, B по 4 углам (по 6 бит), цвет биома
  const N16 = H * 16;
  const MK0 = new Int32Array(N16), MKS = new Int32Array(N16), MKR = new Int32Array(N16), MKG = new Int32Array(N16), MKB = new Int32Array(N16), MK3 = new Int32Array(N16), MAO = new Int32Array(N16);
  const CS = new Int32Array(4), CR = new Int32Array(4), CG = new Int32Array(4), CB = new Int32Array(4), CA = new Int32Array(4);
  const PQ = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const LT4 = new Uint8Array(4);
  // клетки маски склеиваются, только если совпадает всё: вид, AO, свет неба и R, G, B по углам, цвет биома
  const same = (j, mi) => MK0[j] === MK0[mi] && MAO[j] === MAO[mi] && MKS[j] === MKS[mi] && MKR[j] === MKR[mi] && MKG[j] === MKG[mi] && MKB[j] === MKB[mi] && MK3[j] === MK3[mi];   // свет «одной клеткой» для не-кубов: небо, R, G, B (×4)

  // reg — область 48×48×H (Uint16), light — { sky, r, g, b } из V.lightRegion, T — V.T, tint — цвета биомов центра (256 × 9),
  // zone — климатические зоны столбов (256, V.climZone; нет — все 0): у вершин в свет неба (lt.x, 0…60) добавляется 64 × зона —
  // шейдер погоды знает, где «всегда зима» и где «зимы нет»; грани разных зон не склеиваются.
  // Зима (T-022b): до света и сетки — V.shedLeaves(reg, T, zone, bare, cx, cz): доля опавшей лиственной листвы bare 0…1 (сезон
  // движка погоды; у «всегда зимы» — всегда, у «зимы нет» — никогда), чанк cx, cz (у соседних чанков выбор клеток одинаковый):
  // такие клетки листвы — воздух для света (под голым деревом светлее) и для сетки (ветви видны, грани соседей рисуются). Блоки
  // мира не меняются — только картинка и свет чанка; reg — свой буфер задания (его можно портить)
  V.meshChunk = (reg, light, T, tint, zone) => {
    const sky = light.sky, lr = light.r, lg = light.g, lb = light.b, opaque = T.opaque, shape = T.shape, layerT = T.layer, cull = T.cullSelf, tintT = T.tint, liquid = T.liquid;
    const glowL = T.glowL || null, emit = T.emit, sT = T.stream || null;
    const gl = l => glowL && l >= 0 && l < glowL.length ? glowL[l] : 0;
    // свет клетки li (и, если надо, наибольший с клеткой li2) → LT4 (вершинам — всё в 0…60: небо × 4, цвет × 60 / 255)
    let ZA = 0;   // 64 × зона текущего столба (не кубы)
    const cellLt = (li, li2) => {
      let s = sky[li], r = lr[li], g = lg[li], b = lb[li];
      if (li2 >= 0) { if (sky[li2] > s) s = sky[li2]; if (lr[li2] > r) r = lr[li2]; if (lg[li2] > g) g = lg[li2]; if (lb[li2] > b) b = lb[li2]; }
      LT4[0] = s * 4 + ZA; LT4[1] = (r * 60 + 127) / 255 | 0; LT4[2] = (g * 60 + 127) / 255 | 0; LT4[3] = (b * 60 + 127) / 255 | 0;
      return LT4;
    };
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
          if (ny >= H) { CA[0] = CA[1] = CA[2] = CA[3] = 3; CS[0] = CS[1] = CS[2] = CS[3] = 60; CR[0] = CR[1] = CR[2] = CR[3] = CG[0] = CG[1] = CG[2] = CG[3] = CB[0] = CB[1] = CB[2] = CB[3] = 0; }
          else {
            const n = ri + D.n, nTop = ny >= H - 1, nBot = ny <= 0;
            for (let k = 0; k < 4; k++) {
              const du = D.c[k][0] ? 1 : -1, dv = D.c[k][1] ? 1 : -1, su = D.tu * du, sv = D.tv * dv;
              const okU = !(D.tu === 1 && ((du > 0 && nTop) || (du < 0 && nBot))), okV = !(D.tv === 1 && ((dv > 0 && nTop) || (dv < 0 && nBot)));
              const o1 = okU ? opaque[reg[n + su] & TYPE] : 0, o2 = okV ? opaque[reg[n + sv] & TYPE] : 0, oc = okU && okV ? opaque[reg[n + su + sv] & TYPE] : 0;
              CA[k] = o1 && o2 ? 0 : 3 - o1 - o2 - oc;
              let ls = sky[n], ar = lr[n], ag = lg[n], ab = lb[n], cnt = 1;
              if (okU && !o1) { const j = n + su; ls += sky[j]; ar += lr[j]; ag += lg[j]; ab += lb[j]; cnt++; }
              if (okV && !o2) { const j = n + sv; ls += sky[j]; ar += lr[j]; ag += lg[j]; ab += lb[j]; cnt++; }
              if (okU && okV && !oc && !(o1 && o2)) { const j = n + su + sv; ls += sky[j]; ar += lr[j]; ag += lg[j]; ab += lb[j]; cnt++; }
              const h2 = cnt >> 1, den = 255 * cnt, hd = den >> 1;
              CS[k] = (ls * 4 + h2) / cnt | 0; CR[k] = (ar * 60 + hd) / den | 0; CG[k] = (ag * 60 + hd) / den | 0; CB[k] = (ab * 60 + hd) / den | 0;
            }
          }
          const tk = tintT[t];
          let tq = 0;
          if (tk && !(tk === 1 && d !== 2)) { tintOf(tint, x, z, tk, TC); tq = 0x1000000 | ((TC[0] >> 3) << 10) | ((TC[1] >> 3) << 5) | (TC[2] >> 3); }
          const lay = sT ? sT[t] : layerT[t] === 2 ? 1 : 0, sway = tk === 2 || tk === 4 || tk === 5 ? 1 : 0;
          MK0[mi] = 0x800000 | layer | (lay << 12) | (sway << 15) | ((zone ? zone[x * 16 + z] & 3 : 0) << 16);
          MAO[mi] = CA[0] | (CA[1] << 2) | (CA[2] << 4) | (CA[3] << 6);
          MKS[mi] = CS[0] | (CS[1] << 6) | (CS[2] << 12) | (CS[3] << 18);
          MKR[mi] = CR[0] | (CR[1] << 6) | (CR[2] << 12) | (CR[3] << 18);
          MKG[mi] = CG[0] | (CG[1] << 6) | (CG[2] << 12) | (CG[3] << 18);
          MKB[mi] = CB[0] | (CB[1] << 6) | (CB[2] << 12) | (CB[3] << 18);
          MK3[mi] = tq;
          any = true;
        }
        if (!any) continue;
        // склейка: вдоль u, потом строки вдоль v (только одинаковые вид, AO, свет и цвет)
        for (let v = 0; v < nV; v++) for (let u = 0; u < nU;) {
          const mi = v * nU + u, k0 = MK0[mi];
          if (!k0) { u++; continue; }
          const ka = MAO[mi], ks = MKS[mi], kr = MKR[mi], kg = MKG[mi], kb = MKB[mi], k3 = MK3[mi];
          let w = 1;
          while (u + w < nU && same(mi + w, mi)) w++;
          let h = 1;
          grow: while (v + h < nV) {
            const row = (v + h) * nU + u;
            for (let q = 0; q < w; q++) if (!same(row + q, mi)) break grow;
            h++;
          }
          for (let hh = 0; hh < h; hh++) { const row = (v + hh) * nU + u; for (let q = 0; q < w; q++) MK0[row + q] = 0; }
          let x, y, z;
          if (axis === 0) { x = sl; y = u; z = v; } else if (axis === 1) { x = u; y = sl; z = v; } else { x = u; y = v; z = sl; }
          const layer = k0 & 0xfff;
          emitCube(streams[(k0 >> 12) & 7], d, x, y, z, w, h, layer, ka, ks, kr, kg, kb, k3, (k0 >> 15) & 1, gl(layer), ((k0 >> 16) & 3) * 64);
          u += w;
        }
      }
    }
    // ── не кубы: трава и цветы, факелы, лестницы, двери, кактусы, сундуки, жидкости ──
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      const b0 = ((x + 16) * RW + (z + 16)) * H;
      ZA = zone ? (zone[x * 16 + z] & 3) * 64 : 0;
      for (let y = 0; y <= yMax; y++) {
        const ri = b0 + y, cv = reg[ri], t = cv & TYPE, sh = shape[t];
        if (sh <= 1) continue;
        const st = cv >>> 12;
        if (sh === 2) {   // крест: две диагонали, каждая — с двух сторон
          const tk = tintT[t], c = tk ? tintOf(tint, x, z, tk, TC) : WHITE, lay = T.tex[t * 7 + 2];
          cross(streams[sT ? sT[t] || 3 : 1], x + .15, y, z + .15, .7, 1, lay, cellLt(ri, -1), c, 1, gl(lay));
        } else if (sh === 4) {   // факел: крест; на стене — прижат к ней и чуть выше; светится сам
          const f = st & 7, dd = f >= 1 && f <= 4 ? V.FACING[f - 1] : null, lay = T.tex[t * 7 + 2];
          cross(streams[1], x + .3 - (dd ? dd[0] * .3 : 0), y + (dd ? .2 : 0), z + .3 - (dd ? dd[2] * .3 : 0), .4, 1, lay, cellLt(ri, -1), WHITE, 0, gl(lay) || emit[t]);
        } else if (sh === 5) {   // лестница: пластина у стены, с двух сторон
          const dd = V.FACING[st & 3], e = .06, lay = T.tex[t * 7 + 2], L4 = cellLt(ri, -1);
          let A, B;   // концы пластины по горизонтали (снизу)
          if (dd[0] > 0) { A = [x + e, z + 1]; B = [x + e, z]; } else if (dd[0] < 0) { A = [x + 1 - e, z]; B = [x + 1 - e, z + 1]; }
          else if (dd[2] > 0) { A = [x, z + e]; B = [x + 1, z + e]; } else { A = [x + 1, z + 1 - e]; B = [x, z + 1 - e]; }
          plate(streams[1], A, B, y, 1, lay, L4, WHITE, 0, false, gl(lay));
          plate(streams[1], B, A, y, 1, lay, L4, WHITE, 0, false, gl(lay));
        } else if (sh === 9) {   // тонкая ветка: середина и «руки» к соседним брёвнам и веткам (как в модах Dynamic Trees)
          branch(reg, ri, x, y, z, t, st, T, cellLt, gl, sT ? streams[sT[t]] : streams[0]);
        } else if (sh === 6 || sh === 7 || sh === 8) {   // дверь / кактус / сундук: коробка
          const bx = V.boxOf(cv, false); if (!bx) continue;
          for (let d = 0; d < 6; d++) {
            const D = DIRS[d], ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
            const onEdge = (d === 0 && bx[3] >= 1) || (d === 1 && bx[0] <= 0) || (d === 2 && bx[4] >= 1) || (d === 3 && bx[1] <= 0) || (d === 4 && bx[5] >= 1) || (d === 5 && bx[2] <= 0);
            let li = -1;
            if (onEdge && ny >= 0 && ny < H) { const nt = reg[ri + D.n] & TYPE; if (opaque[nt] || (nt === t && sh === 7 && (d === 2 || d === 3))) continue; li = ri + D.n; }
            let lay;
            if (sh === 6) lay = T.tex[t * 7 + ((st >> 3) & 1 && d !== 2 && d !== 3 ? 0 : 2)];
            else lay = texFor(T, t, st & 3, d);
            boxFace(streams[1], d, x, y, z, bx, lay, cellLt(ri, li), WHITE, 0, gl(lay));
          }
        } else if (sh === 3) {   // жидкость: вода — прозрачная, лава — непрозрачная; поверхность — плавными углами
          const lq = liquid[t], s = lq === 1 ? streams[2] : streams[0], lay = T.tex[t * 7 + 2];
          const above = y < H - 1 ? reg[ri + 1] & TYPE : 0, full = above === t;
          const c = lq === 1 ? tintOf(tint, x, z, 3, TC) : WHITE;
          // высоты четырёх углов: среднее по клеткам вокруг угла (источник весит больше, воздух тянет край вниз)
          for (let k = 0; k < 4; k++) HC[k] = full ? 1 : cornerH(reg, ri, t, y, k & 1, k >> 1, cv, opaque);
          if (lq === 1 && !full) waterTop(reg, ri, t, y);   // глубина и берег у углов глади
          for (let d = 0; d < 6; d++) {
            const D = DIRS[d], ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
            if (ny < 0) continue;
            const nt = ny >= H ? 0 : reg[ri + D.n] & TYPE;
            if (nt === t) continue;
            if (opaque[nt] && d !== 2) continue;
            if (d === 2 && full) continue;
            let wq = null, wsb = 0;
            if (lq === 1) {
              if (d === 2) { wq = WD; wsb = WSB; }
              else { WS4.fill(Math.min(31, waterThick(reg, ri, t, y, d) * 3)); wq = WS4; }   // бок и низ: сколько воды за гранью
            }
            liquidFace(s, d, x, y, z, HC, lay, cellLt(ri, ny < H ? ri + D.n : -1), c, lq === 1 ? 2 : 0, gl(lay), wq, wsb);
          }
        }
      }
    }
    // выход: копии нужной длины (буферы потока остаются)
    const out = { yMax };
    V.LAYERS.forEach((k, i) => {
      const s = streams[i];
      out[k] = s.q ? { n: s.q, pos: s.pos.slice(0, s.q * 12), vd: s.vd.slice(0, s.q * 16), col: s.col.slice(0, s.q * 12), lt: s.lt.slice(0, s.q * 16) } : null;
    });
    // свет центра (для игры: цвет и яркость мобов и вещей, где им появляться) и светящиеся клетки (лампы и ореолы)
    const L = new Uint16Array(V.CELLS), lights = [], lava = new Set();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      const b = ((x + 16) * RW + (z + 16)) * H, o2 = (x << 11) | (z << 7);
      for (let y = 0; y < H; y++) {
        const i = b + y;
        L[o2 | y] = (sky[i] << 12) | (((lr[i] + 8) / 17 | 0) << 8) | (((lg[i] + 8) / 17 | 0) << 4) | ((lb[i] + 8) / 17 | 0);
        const t = reg[i] & TYPE;
        if (!emit[t] || lights.length >= 256) continue;
        if (liquid[t] === 2) {   // лава: одна лампа на поверхность 4×4 (и по высоте)
          if (y < H - 1 && (reg[i + 1] & TYPE) === t) continue;
          const key = (x >> 2) * 1000 + (z >> 2) * 100 + y; if (lava.has(key)) continue;
          lava.add(key);
        }
        lights.push(o2 | y | (t << 15));
      }
    }
    out.light = L;
    out.lights = lights.length ? Int32Array.from(lights) : null;
    return out;
  };
  const BC = [0, 0, 0], HC = [1, 1, 1, 1];
  // ── тонкая ветка (T-022b): середина 6/16 и «руки» до края клетки к соседним брёвнам/веткам (T.tree 1 / 2); соседей нет — брусок
  //    вдоль своей оси. Торец руки к бревну (оно непрозрачное) и к соседней ветке (её рука встречает эту) не рисуется ──
  const BW0 = .3125, BW1 = .6875, BXC = [BW0, BW0, BW0, BW1, BW1, BW1], ARM = [];
  for (let d = 0; d < 6; d++) { const b = BXC.slice(), ax = d >> 1; if (d & 1) { b[ax] = 0; b[ax + 3] = BW0; } else { b[ax] = BW1; b[ax + 3] = 1; } ARM.push(b); }
  const AXM = [(1 << 2) | (1 << 3), 1 | 2, (1 << 4) | (1 << 5)];
  function branch(reg, ri, x, y, z, t, st, T, cellLt, gl, s){
    const tr = T.tree, opaque = T.opaque;
    let m = 0;
    for (let d = 0; d < 6; d++) {
      const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0); if (ny < 0 || ny >= H) continue;
      const q = tr ? tr[reg[ri + DIRS[d].n] & TYPE] : 0; if (q === 1 || q === 2) m |= 1 << d;
    }
    if (!m) m = AXM[st & 3] || AXM[0];
    const W3 = WHITE;
    for (let d = 0; d < 6; d++) if (!((m >> d) & 1)) { const lay = texFor(T, t, st & 3, d); if (lay >= 0) boxFace(s, d, x, y, z, BXC, lay, cellLt(ri, -1), W3, 0, gl(lay)); }
    for (let a = 0; a < 6; a++) {
      if (!((m >> a) & 1)) continue;
      const bx = ARM[a], ax = a >> 1, axs = ax === 1 ? 0 : ax === 0 ? 1 : 2, nri = ri + DIRS[a].n, nt = reg[nri] & TYPE;
      for (let d = 0; d < 6; d++) {
        if (d === (a ^ 1)) continue;   // к середине — внутри
        if (d === a && (opaque[nt] || (tr && tr[nt] === 2))) continue;   // торец к бревну или к соседней ветке
        const lay = texFor(T, t, axs, d); if (lay < 0) continue;
        boxFace(s, d, x, y, z, bx, lay, cellLt(ri, d === a ? nri : -1), W3, 0, gl(lay));
      }
    }
  }
  // ── опавшая лиственная листва (зима): клетка — по хешу мира, у соседних чанков одинаково ──
  V.shedLeaves = (reg, T, zone, bare, cx, cz) => { if (T.decid && (bare > 0 || (zone && zone.includes(1)))) shedLeaves(reg, T, zone, bare || 0, cx | 0, cz | 0); };
  function shedLeaves(reg, T, zone, bare, cx, cz){
    const dc = T.decid, x0 = (cx - 1) * 16, z0 = (cz - 1) * 16, th = Math.round(Math.max(0, Math.min(1, bare)) * 1024), thW = 740;   // «всегда зима» — 72 %
    for (let rx = 0; rx < RW; rx++) for (let rz = 0; rz < RW; rz++) {
      const zi = (rx < 16 ? 0 : rx >= 32 ? 15 : rx - 16) * 16 + (rz < 16 ? 0 : rz >= 32 ? 15 : rz - 16), zn = zone ? zone[zi] & 3 : 0;
      const lim = zn === 2 ? 0 : zn === 1 ? thW : th;
      if (!lim) continue;
      const b = (rx * RW + rz) * H, wx = x0 + rx, wz = z0 + rz;
      for (let y = 0; y < H; y++) {
        const t = reg[b + y] & TYPE;
        if (dc[t] && (V.hash(wx, y, wz, 0x7ea5) & 1023) < lim) reg[b + y] = 0;
      }
    }
  }
  // Высота жидкости в углу (cx, cz ∈ {0, 1} — угол клетки): клетки вокруг угла — эта и три соседние
  function cornerH(reg, ri, t, y, cx, cz, cv, opaque){
    let h = 0, w = 0;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const j = ri + (cx - 1 + a) * SX + (cz - 1 + b) * SZ, v = reg[j], tt = v & TYPE;
      if (tt === t) {
        if (y < H - 1 && (reg[j + 1] & TYPE) === t) return 1;   // сверху тоже жидкость — угол до верха
        const src = (v >>> 12) === 0, k = src ? 10 : 1;
        h += V.liquidHeight(v) * k; w += k;
      } else if (!opaque[tt]) w += 1;   // воздух рядом — край ниже
    }
    return w ? h / w : V.liquidHeight(cv);
  }
  const putLt = (LT, o, L4) => { LT[o * 4] = L4[0]; LT[o * 4 + 1] = L4[1]; LT[o * 4 + 2] = L4[2]; LT[o * 4 + 3] = L4[3]; };
  // ── вода: глубина под гладью у углов (трети блока, 0…31) и «берег» (биты углов). Угол k = u + 2v грани (у глади u = x, v = z) ──
  const WD = new Uint8Array(4), WS4 = new Uint8Array(4);
  let WSB = 0;
  // глубина столба воды от клетки j (высота y) вниз: клетки воды подряд (с этой) — до дна; верхняя — до своей глади
  function colDepth(reg, j, t, y){
    let n = 0;
    while (n <= y && n < 12 && (reg[j - n] & TYPE) === t) n++;
    return n ? n - 1 + V.liquidHeight(reg[j]) : 0;
  }
  // гладь клетки ri: у каждого угла — 4 клетки вокруг него на высоте глади: вода — её глубина, блок — берег (0 в среднее и бит
  // пены), под блоком вода (лёд, постройка на воде) — глубина воды под ним; воздух не считается
  function waterTop(reg, ri, t, y){
    WSB = 0;
    for (let k = 0; k < 4; k++) {
      const cx = k & 1, cz = k >> 1;
      let s = 0, w = 0, shore = 0;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        const j = ri + (cx - 1 + a) * SX + (cz - 1 + b) * SZ, tt = reg[j] & TYPE;
        if (tt === t) { s += colDepth(reg, j, t, y); w++; }
        else if (tt !== 0) { shore = 1; w++; if (y > 0 && (reg[j - 1] & TYPE) === t) s += colDepth(reg, j - 1, t, y - 1) + 1; }
      }
      WD[k] = Math.min(31, Math.round((w ? s / w : 0) * 3));
      if (shore) WSB |= 1 << k;
    }
  }
  // бок и низ воды: сколько клеток воды за гранью (вглубь, до 8) — сквозь водопад видно, сквозь аквариум — нет
  function waterThick(reg, ri, t, y, d){
    const st = -DIRS[d].n; let n = 0;
    for (let j = ri, yy = y; n < 8 && yy >= 0 && yy < H && (reg[j] & TYPE) === t; j += st, n++) if (d === 3) yy++;
    return n;
  }
  // Грань жидкости: как у куба, верхние вершины — на высоте своего угла; wq — глубины углов воды (u + 2v), wsb — биты берега
  function liquidFace(s, d, x, y, z, Hc, layer, L4, c, flags, glow, wq, wsb){
    grow(s, s.q + 1);
    const D = DIRS[d], q = s.q++, P = s.pos, VD = s.vd, C = s.col, LT = s.lt;
    for (let vi = 0; vi < 4; vi++) {
      const o = q * 4 + vi;
      BC[d >> 1] = (d & 1) ? 0 : 1; BC[D.ua] = D.c[vi][0]; BC[D.va] = D.c[vi][1];
      const X = BC[0], Z = BC[2], Y = BC[1] > 0 ? Hc[X + Z * 2] : 0;
      let U, Vv;
      if (d === 2 || d === 3) { U = X; Vv = Z; } else if (d === 0) { U = 1 - Z; Vv = 1 - Y; } else if (d === 1) { U = Z; Vv = 1 - Y; } else if (d === 4) { U = X; Vv = 1 - Y; } else { U = 1 - X; Vv = 1 - Y; }
      P[o * 3] = (x + X) * 16; P[o * 3 + 1] = Math.round((y + Y) * 16); P[o * 3 + 2] = (z + Z) * 16;
      const u16 = Math.round(U * 16), v16 = Math.round(Vv * 16);
      if (wq) {   // вода: глубины углов — над u и v, берег — в vd.w
        VD[o * 4] = u16 | (wq[0] << 5) | (wq[1] << 10); VD[o * 4 + 1] = v16 | (wq[2] << 5) | (wq[3] << 10);
        VD[o * 4 + 3] = 3 | (glow << 2) | ((wsb & 15) << 6) | (flags << 14);
      } else { VD[o * 4] = u16; VD[o * 4 + 1] = v16; VD[o * 4 + 3] = 3 | (glow << 2) | (flags << 14); }
      VD[o * 4 + 2] = layer | (d << 12);
      putLt(LT, o, L4);
      C[o * 3] = c[0]; C[o * 3 + 1] = c[1]; C[o * 3 + 2] = c[2];
    }
  }

  // Квадрат «жадной» грани: клетка (x, y, z), w × h по осям (ua, va)
  function emitCube(s, d, x, y, z, w, h, layer, ka, ks, kr, kg, kb, k3, sway, glow, za){
    grow(s, s.q + 1);
    const D = DIRS[d], q = s.q++, P = s.pos, VD = s.vd, C = s.col, LT = s.lt;
    const a0 = ka & 3, a1 = (ka >> 2) & 3, a2 = (ka >> 4) & 3, a3 = (ka >> 6) & 3;
    const flip = a0 + a2 < a1 + a3 ? 1 : 0;   // тёмная диагональ 0–2 — делим по 1–3
    const r = k3 ? (((k3 >> 10) & 31) << 3) | 4 : 255, g = k3 ? (((k3 >> 5) & 31) << 3) | 4 : 255, b = k3 ? ((k3 & 31) << 3) | 4 : 255;
    for (let vi = 0; vi < 4; vi++) {
      const k = (vi + flip) & 3, du = D.c[k][0], dv = D.c[k][1], sh = k * 6;
      let X = x, Y = y, Z = z;
      if (d === 0) X++; else if (d === 2) Y++; else if (d === 4) Z++;
      if (D.ua === 0) X += du * w; else Y += du * w;
      if (D.va === 1) Y += dv * h; else Z += dv * h;
      let U, Vv;
      if (d === 2 || d === 3) { U = X; Vv = Z; } else if (d === 0) { U = 16 - Z; Vv = H - Y; } else if (d === 1) { U = Z; Vv = H - Y; } else if (d === 4) { U = X; Vv = H - Y; } else { U = 16 - X; Vv = H - Y; }
      const o = q * 4 + vi, ak = k === 0 ? a0 : k === 1 ? a1 : k === 2 ? a2 : a3;
      P[o * 3] = X * 16; P[o * 3 + 1] = Y * 16; P[o * 3 + 2] = Z * 16;
      VD[o * 4] = U * 16; VD[o * 4 + 1] = Vv * 16; VD[o * 4 + 2] = layer | (d << 12);
      VD[o * 4 + 3] = ak | (glow << 2) | (sway << 14);
      LT[o * 4] = ((ks >> sh) & 63) + za; LT[o * 4 + 1] = (kr >> sh) & 63; LT[o * 4 + 2] = (kg >> sh) & 63; LT[o * 4 + 3] = (kb >> sh) & 63;
      C[o * 3] = r; C[o * 3 + 1] = g; C[o * 3 + 2] = b;
    }
  }
  // Вертикальная пластина от A до B (по горизонтали), высота h, против часовой — со стороны «справа» от A→B
  function plate(s, A, B, y, h, layer, L4, c, sway, rev, glow){
    PQ[0][0] = A[0]; PQ[0][1] = y; PQ[0][2] = A[1];
    PQ[1][0] = A[0]; PQ[1][1] = y + h; PQ[1][2] = A[1];
    PQ[2][0] = B[0]; PQ[2][1] = y + h; PQ[2][2] = B[1];
    PQ[3][0] = B[0]; PQ[3][1] = y; PQ[3][2] = B[1];
    quad(s, PQ, layer, 6, L4, c, sway, glow);
  }
  // Крест (трава, цветы, факел): квадрат со стороной k в плане от (x0, z0), высота h
  function cross(s, x0, y, z0, k, h, layer, L4, c, sway, glow){
    const A = [x0, z0], B = [x0 + k, z0 + k], C2 = [x0 + k, z0], D2 = [x0, z0 + k];
    plate(s, A, B, y, h, layer, L4, c, sway, false, glow); plate(s, B, A, y, h, layer, L4, c, sway, false, glow);
    plate(s, C2, D2, y, h, layer, L4, c, sway, false, glow); plate(s, D2, C2, y, h, layer, L4, c, sway, false, glow);
  }
  const UV4 = [[0, 1], [0, 0], [1, 0], [1, 1]];
  function quad(s, P4, layer, nrm, L4, c, sway, glow){
    grow(s, s.q + 1);
    const q = s.q++, P = s.pos, VD = s.vd, C = s.col, LT = s.lt;
    for (let vi = 0; vi < 4; vi++) {
      const p = P4[vi], o = q * 4 + vi;
      P[o * 3] = Math.round(p[0] * 16); P[o * 3 + 1] = Math.round(p[1] * 16); P[o * 3 + 2] = Math.round(p[2] * 16);
      VD[o * 4] = UV4[vi][0] * 16; VD[o * 4 + 1] = UV4[vi][1] * 16; VD[o * 4 + 2] = layer | (nrm << 12);
      VD[o * 4 + 3] = 3 | ((glow | 0) << 2) | ((sway && (vi === 1 || vi === 2) ? 1 : 0) << 14);
      putLt(LT, o, L4);
      C[o * 3] = c[0]; C[o * 3 + 1] = c[1]; C[o * 3 + 2] = c[2];
    }
  }
  // Грань коробки bx (доли блока) в направлении d: дверь, кактус, сундук, вода. UV — по доле клетки (не тянется)
  function boxFace(s, d, x, y, z, bx, layer, L4, c, flags, glow){
    grow(s, s.q + 1);
    const D = DIRS[d], q = s.q++, P = s.pos, VD = s.vd, C = s.col, LT = s.lt, nAx = d >> 1, nHi = (d & 1) === 0;
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
      VD[o * 4 + 3] = 3 | ((glow | 0) << 2) | (flags << 14);
      putLt(LT, o, L4);
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
