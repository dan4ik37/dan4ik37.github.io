// ═══════════════════════════════════════
//  «ПОДЗЕМЬЕ» — огонь (T-022d, docs/PHYSICS_PLAN.md §4): переходник плиток 2D к ядру движка D37E.fire (то же ядро, что у «Кубомира»)
// ═══════════════════════════════════════
// Горят плитки — по их данным (PZFire.burnOf: поле burn у плитки главнее; иначе листва — листва, растение под топор без опоры —
// ствол, лестницы — доски, мягкие растения — трава, платформы и доски (группа досок) — доски, блок с травой — дёрн; что светится
// само — не горит). Новые плитки модов и деревьев горят сами — по полям, без списков имён. Горящая плитка — состояние в ядре
// (блоков «огонь» в «Подземье» нет): пламя, угли, дым, дрожь воздуха и «живой» свет (dynLight) рисует игра по списку ядра.
// Догорела: трава, листва, лестницы — пусто; дёрн — то, что из него выпадает (земля); доски сначала чернеют (обугленные доски),
// потом осыпаются — обрушение поставленного (podzem-support.js) идёт своим путём; ствол — то, что выше, валится тем же путём, что
// от топора (fellTree; пень догорает); дверь, верстак, кровать — исчезают целиком (сундуки не горят: в них вещи).
// Мир выбирает при создании «🔥 Огонь распространяется» (W.fire = 'spread'; старые миры — выкл, «реализм» обрушения — вкл),
// меняется в ⚙️ «⛏ Подземье». Выкл — горит только подожжённое огнивом. Вкл — перекидывается на соседей (по ветру погоды мира —
// быстрее), лава, брошенный факел и огненный шар поджигают; вода гасит (в клетке или сверху). Такт — 30 в секунду (каждый второй
// шаг игры 1/60 с: одинаково при 30 / 60 / 144 кадрах), работа за такт ограничена (бюджет ядра).
//   X = PZFire.attach(G, H) → { F, spread, setSpread(on), tick(), igniteAt(x, y), useIgniter(x, y), ball(x, y), save(), draw(…),
//   lights(…), heatField(…), near(x, y, r), stats }; H — функции игры (podzem.js FIREH)
(() => {
  const FIR = () => window.D37E?.fire;
  const PF = window.PZFire = window.PZFire || {};
  PF.NOTE = 'Огонь перекидывается на деревья, траву и деревянные постройки (по ветру — быстрее), лава и брошенный факел поджигают, вода гасит. Выкл — горит только то, что поджёг огнивом.';
  PF.defaultFor = support => support === 'real';
  PF.on = W => W?.fire === 'spread';
  // Горючесть плитки — только по её полям. Читает: t.burn (поле плитки), P.EMIS / P.LR / P.LG / P.LB (светится сам — не горит),
  // P.LEAFY, P.KIND, P.TOOL, P.SUP, P.CLIMB, P.HARD, P.GROUP (группа досок — woodG), P.GRASSY
  PF.burnOf = (P, t, f, K, TO, woodG) => {
    if (!t || !f) return '';
    if (t.burn !== undefined) return t.burn && t.burn !== 'none' ? String(t.burn) : '';
    if (P.EMIS[f] || P.LR[f] || P.LG[f] || P.LB[f]) return '';
    if (P.LEAFY[f]) return 'leaves';
    const k = P.KIND[f];
    if (k === K.plant) {
      if (P.TOOL[f] === TO.axe && !P.SUP[f]) return 'wood';   // ствол (кактус стоит на земле — не горит)
      if (P.CLIMB[f] && P.HARD[f] > 0) return 'planks';      // лестница
      if (P.HARD[f] === 0) return 'grass';                   // трава, цветы, лианы, грибы
      return '';
    }
    if (k === K.plat) return 'planks';
    if (k === K.block && woodG && P.GROUP[f] === woodG) return 'planks';
    if (k === K.block && P.GRASSY[f]) return 'turf';
    return '';
  };
  // как выглядит горящее (по материалу огня): размер языка, где его низ в клетке, дым
  const LOOK = { wood: [1.35, 1, .9], planks: [1.25, 1, .8], leaves: [1.15, .95, 1], grass: [.95, 1, .5], turf: [.7, .14, .35], cloth: [.9, 1, .6], fuel: [1.25, 1, 1], char: [.9, 1, .5], flame: [1, 1, .3], tree: [1.35, 1, 1] };
  const CHAR_TINT = [255, 168, 120];

  PF.attach = (G, H) => {
    const FI = FIR(); if (!FI || !G?.W) return null;
    const P = H.P, PZ = H.PZ, K = PZ.KINDS, TO = PZ.TOOLS, MF = FI.MAT;
    const WOODG = PZ.TILE.planks ? P.GROUP[PZ.TILE.planks.id] : 0, CHAR = PZ.TILE.charwood ? PZ.TILE.charwood.id : 0;
    // материал огня по номеру плитки (ваниль и моды: 1…254) и вид пламени по материалу
    const FM = new Uint8Array(256), LK = [];
    const tables = () => { for (let f = 1; f < 255; f++) { const t = H.TILES[f] || G.modTiles?.[f]; FM[f] = t ? FI.mat(PF.burnOf(P, t, f, K, TO, WOODG)) : 0; } };
    tables();
    for (let m = 0; m < FI.MATS.length; m++) LK[m] = LOOK[FI.MATS[m].key] || LOOK.flame;
    const X = { F: null, FM, tables, spread: PF.on(G.W), vis: 0, stats: { burnt: 0, fell: 0, lava: 0, torch: 0, ball: 0, hurt: 0 } };
    // клетка для ядра: 0 — не горит, −1 — не загружено (ждёт), бит 64 — мокрое (вода в клетке или сверху: не загорится, горящее гаснет)
    const read = (x, y) => {
      const c = H.cAt(x, y); if (!c) return y < 0 ? 0 : -1;
      const i = H.idx(x, y), f = c.fg[i]; if (!f) return 0;
      const m = FM[f]; if (!m) return 0;
      if (c.lt[i] === 1 && c.lq[i] > 40) return m | 64;
      const ca = (y & 63) ? c : H.cAt(x, y - 1);
      if (ca) { const j = H.idx(x, y - 1); if (ca.lt[j] === 1 && ca.lq[j] > 40) return m | 64; }
      return m;
    };
    const F = X.F = FI.grid({ dims: 2, down: 1, hz: 30, cap: 4096, budget: 200, seed: (G.W.seed ^ 0x51ed) >>> 0, read, spread: X.spread,
      onBurnt: (x, y, z, m) => burnt(x, y, m),
      onChar: (x, y, z, m) => {   // доски почернели (горят дальше уже обугленными); стволы — нет: дерево остаётся деревом, чтобы упасть
        if (m !== MF.planks || !CHAR) return;
        const c = H.cAt(x, y); if (!c) return;
        const i = H.idx(x, y), f = c.fg[i];
        if (f && f !== CHAR && P.KIND[f] === K.block && FM[f] === MF.planks) H.setCell(x, y, CHAR, c.st[i] & 15);
      },
    });
    if (G.W.fireState) { try { F.load(G.W.fireState); } catch (e) { console.warn('Подземье: огонь не загрузился', e); F.clear(); } }
    X.setSpread = on => { X.spread = F.spread = !!on; G.W.fire = on ? 'spread' : 'off'; };
    X.save = () => (F.n ? F.save() : null);
    // догорела: плитка — в то, что из неё остаётся; ствол — то, что выше, валится (путь топора); постройка — обрушение (своим путём)
    function burnt(x, y, m){
      const c = H.cAt(x, y); if (!c) return;
      const i = H.idx(x, y), f = c.fg[i]; if (!f || !FM[f]) return;
      X.stats.burnt++;
      if (H.onScreen(x, y)) H.ash(x, y, f);
      const k = P.KIND[f];
      if (k === K.obj) { H.burnObj(x, y, f); return; }
      if (k === K.block && FM[f] === MF.turf) { const t = H.TILES[f], d = t && t.d && PZ.TILE[t.d]; H.setCell(x, y, d ? d.id : 0, c.st[i] & 15); return; }   // трава сгорела — земля
      const sc = G.sup ? G.sup.code(x, y) : 0;
      H.setCell(x, y, 0, 0);
      H.afterBreak(x, y, f, 1, 1, true);
      if (G.sup) { G.sup.placed(x, y, false); if (sc) G.sup.removed(x, y, sc); }
      if (m === MF.wood && k === K.plant && H.fgAt(x, y - 1) === f) { H.fellTree(x, y - 1, f); X.stats.fell++; }   // ствол прогорел — верх падает
    }
    // поджечь клетку; негорючая — горючее рядом (под ней, по бокам, над ней). → 1 — горит, 0 — нечему, −1 — мокрое
    const NB = [0, 1, -1, 0, 1, 0, 0, -1];
    X.igniteAt = (x, y) => {
      if (F.find(x, y) >= 0) return 1;   // уже горит
      const r = read(x, y);
      if (r > 0) return r & 64 ? -1 : F.ignite(x, y) >= 0 ? 1 : 0;
      let wet = false;
      for (let k = 0; k < NB.length; k += 2) {
        const q = read(x + NB[k], y + NB[k + 1]);
        if (q > 0 && q & 64) { wet = true; continue; }
        if (q > 0 && F.ignite(x + NB[k], y + NB[k + 1]) >= 0) return 1;
      }
      return wet ? -1 : 0;
    };
    X.useIgniter = (x, y) => X.igniteAt(x, y);
    // ── такт (30 в секунду): ветер погоды мира, лава и брошенные факелы поджигают, ядро, огонь жжёт героя и мобов ──
    let wxT = 0, lavaT = 0, torchT = 0, hurtT = 0;
    X.tick = () => {
      if (--wxT <= 0) { wxT = 60; const w = H.wind ? H.wind() : null; F.setWind(w ? +w.wind || 0 : 0, w ? +w.windDir || 0 : 0); }
      if (X.spread) {
        if (--lavaT <= 0) { lavaT = 15; lavaTick(); }
        if (--torchT <= 0) { torchT = 30; torchTick(); }
      }
      F.tick();
      if (F.n && --hurtT <= 0) { hurtT = 15; hurtTick(); }
    };
    // лава: верх лавы в чанках у героя — горючее над ней и рядом загорается (по хешу места и такта)
    function lavaTick(){
      const p = G.pl; if (!p) return;
      const pcx = Math.floor(p.x) >> 6, pcy = Math.floor(p.y) >> 6;
      for (const c of G.chunks.values()) {
        if (!c.hasLq || c.cx < pcx - 1 || c.cx > pcx + 1 || c.cy < pcy - 1 || c.cy > pcy + 1) continue;
        const L = (c.lavaDirty || !c.lava) ? H.lavaTops(c) : c.lava; if (!L || !L.length) continue;
        for (let n = 0; n < 4; n++) {
          const h = FI.hash(c.cx, c.cy, F.T, n, 0x1a7a), i = L[h % L.length], x = c.cx * 64 + (i & 63), y = c.cy * 64 + (i >> 6);
          const dx = (h >> 12) % 3 - 1, dy = dx ? ((h >> 16) & 1) - 1 : -1;   // над лавой или сбоку (на уровне глади и выше)
          const r = read(x + dx, y + dy);
          if (r > 0 && !(r & 64) && F.ignite(x + dx, y + dy) >= 0) X.stats.lava++;
        }
      }
    }
    // брошенный факел лежит в траве, на досках, у куста — загорается (раз в секунду, шанс по хешу места)
    function torchTick(){
      const L = G.items; if (!L || !L.length) return;
      for (let k = 0; k < L.length; k++) {
        const it = L[k]; if (it.id !== 'torch' || !it.ground) continue;
        const x = Math.floor(it.x + .3), y = Math.floor(it.y + .3);
        if (FI.hash(x, y, F.T, 0x70c, 0) % 3) continue;
        const r0 = read(x, y), r1 = read(x, y + 1);
        if (r0 > 0 && !(r0 & 64) && F.ignite(x, y) >= 0) X.stats.torch++;
        else if (r1 > 0 && !(r1 & 64) && F.ignite(x, y + 1) >= 0) X.stats.torch++;
      }
    }
    // огненный шар (бес) разбился: поджигает рядом (3 × 3)
    X.ball = (x, y) => {
      if (!X.spread) return;
      const cx = Math.floor(x), cy = Math.floor(y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const r = read(cx + dx, cy + dy); if (r > 0 && !(r & 64) && F.ignite(cx + dx, cy + dy) >= 0) { X.stats.ball++; return; } }
    };
    // огонь жжёт: герой в горящей клетке или на ней (клетка под ногами), мобы — так же (огневики и боссы — нет)
    function inFire(x, y, w, h){
      const x0 = Math.floor(x + .1), x1 = Math.floor(x + w - .1), y0 = Math.floor(y + .1), y1 = Math.floor(y + h + .05);
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) if (F.find(xx, yy) >= 0) return true;
      return false;
    }
    function hurtTick(){
      const p = G.pl;
      if (p && !p.dead && inFire(p.x, p.y, p.w, p.h)) { H.hurtPlayer(5, 0, 'огонь'); X.stats.hurt++; }
      const ms = G.mobs;
      for (let k = 0; k < ms.length; k++) { const m = ms[k]; if (m.hp > 0 && !m.D.boss && m.D.spr !== 'imp' && inFire(m.x, m.y, m.w, m.h)) H.hurtMob(m, 6, 0, 'fire', 1); }
    }

    // ═══ Картинка (зовёт drawFlames в podzem.js): пламя на каждой горящей клетке экрана (много — через одну-две, крупнее), блики,
    // угли и дым; доски темнеют по ходу горения. Больше 360 / 240 / 140 языков («Ультра» и «Красивые» / «Обычные» / «Ретро») —
    // реже и крупнее: работа кадра ограничена ═══
    X.draw = (x0, x1, y0, y1, q, pk, live) => {
      X.vis = 0;
      if (!F.n) return 0;
      let vis = 0;
      for (let i = 0; i < F.n; i++) { const s = F.ACT[i], x = F.X[s], y = F.Y[s]; if (x >= x0 && x <= x1 && y >= y0 && y <= y1) vis++; }
      X.vis = vis;
      if (!vis) return 0;
      const cap = q >= 2 ? 300 : q >= 1 ? 200 : 120, stride = vis > cap ? Math.ceil(vis / cap) : 1, big = stride > 1 ? Math.min(1.7, Math.sqrt(stride)) : 1, more = stride > 1 ? 1.6 : 1;
      let n = 0;
      for (let i = 0; i < F.n; i++) {
        const s = F.ACT[i], x = F.X[s], y = F.Y[s];
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        if (stride > 1 && ((x * 7 + y * 13) >>> 0) % stride) continue;
        const m = F.M[s], h = F.heat(s), L = LK[m], f = H.fgAt(x, y), seed = (x * 7.13 + y * 3.71) % 97, tint = m === MF.char ? CHAR_TINT : null;
        const solid = f && f !== 255 && P.SOLID[f] === 1 && P.OPC[f] === 1;
        if (solid) { const ph = F.phase(s); if (ph > .08) H.rect(x, y, 1, 1, 22, 14, 10, Math.min(150, ph * 190) | 0); }   // доски и блоки темнеют, пока горят
        // низ языка: трава на блоке — с поверхности, блок — из верхней части (горит его лицо), растения и листва — со дна клетки
        const by = L[1] < .5 ? y + L[1] : solid ? y + .45 : y + L[1], k = L[0] * (.7 + .6 * h) * big;
        const low = !solid && L[1] > .5 && P.OPC[H.fgAt(x, y - 1)] === 1;   // над огнём потолок — язык короче
        const fl = H.flame(x + .5, by, k, seed, low, tint);
        if (q >= 1 && h > .5) H.flame(x + .5 + ((seed | 0) & 1 ? .27 : -.27) * big, by + .04, k * .62, seed + 31, low, tint);   // второй язык — огонь гуще
        if (q >= 1) H.glare(x + .5, by - .4 * k, (1.1 + .9 * h) * big, 255, 136, 52, (.22 * h * fl * 255) | 0);   // ореол — сложением
        if (live && q >= 1) {
          H.sparks(x + .5, by - .8 * k, (q >= 2 ? .8 : .45) * pk * h * more, .7 * big);
          if (q >= 2) H.smoke(x + .5, by - 1.2 * k, .45 * pk * L[2] * more, .5 * big);
        }
        n++;
      }
      return n;
    };
    // «живой» свет пожара: очаги у камеры (корзины 8 × 8 клеток) — до max самых сильных → add(x, y, сила, доля за клетку, r, g, b).
    // Место — целыми клетками, сила — ступенями: свет пересчитывается, только когда пожар заметно поменялся
    const BN = 48, BX = new Int32Array(BN), BY = new Int32Array(BN), BC = new Int32Array(BN), BS = new Float32Array(BN), BXs = new Float32Array(BN), BYs = new Float32Array(BN);
    X.lights = (camX, camY, max, add) => {
      if (!F.n || max <= 0) return 0;
      const x0 = camX - 40, x1 = camX + 40, y0 = camY - 26, y1 = camY + 26;
      let nb = 0;
      for (let i = 0; i < F.n; i++) {
        const s = F.ACT[i], x = F.X[s], y = F.Y[s]; if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        const bx = x >> 3, by = y >> 3;
        let b = 0; while (b < nb && !(BX[b] === bx && BY[b] === by)) b++;
        if (b === nb) { if (nb >= BN) continue; BX[b] = bx; BY[b] = by; BC[b] = 0; BXs[b] = 0; BYs[b] = 0; BS[b] = 0; nb++; }
        BC[b]++; BXs[b] += x + .5; BYs[b] += y + .5; BS[b] += F.heat(s);
      }
      let out = 0;
      for (let k = 0; k < max && nb; k++) {
        let best = 0; for (let b = 1; b < nb; b++) if (BS[b] > BS[best]) best = b;
        if (!(BS[best] > 0)) break;
        const st = Math.min(6, Math.round(BS[best] / 2));
        add(Math.round(BXs[best] / BC[best]), Math.round(BYs[best] / BC[best]), 170 + 10 * st, .87, 255, 146, 60);
        BS[best] = -1; out++;
      }
      return out;
    };
    // дрожь воздуха над огнём (поле искажений постобработки, канал G — как над лавой): 3 клетки вверх, слабее
    X.heatField = (FLD, fx0, fy0, w, h) => {
      if (!F.n) return false;
      let any = false;
      for (let i = 0; i < F.n; i++) {
        const s = F.ACT[i], ii = F.X[s] - fx0, jj = F.Y[s] - fy0;
        if (ii < 0 || ii >= w || jj < 0 || jj >= h) continue;
        const k = F.heat(s);
        for (let d = 0; d <= 3 && jj - d >= 0; d++) { const o = ((jj - d) * w + ii) * 4 + 1, v = (230 - d * 55) * k; if (FLD[o] < v) FLD[o] = v; }
        any = true;
      }
      return any;
    };
    // ближайшая горящая клетка и сколько горит рядом (звук)
    const NR = { d: 1e9, x: 0, y: 0, n: 0 };
    X.near = (cx, cy, r) => {
      NR.d = 1e9; NR.n = 0;
      for (let i = 0; i < F.n; i++) {
        const s = F.ACT[i], dx = F.X[s] + .5 - cx, dy = F.Y[s] + .5 - cy;
        if (dx > r || dx < -r || dy > r || dy < -r) continue;
        const d = Math.sqrt(dx * dx + dy * dy); if (d > r) continue;
        NR.n++; if (d < NR.d) { NR.d = d; NR.x = F.X[s] + .5; NR.y = F.Y[s] + .5; }
      }
      return NR;
    };
    return X;
  };
})();
