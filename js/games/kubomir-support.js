// ═══════════════════════════════════════
//  «КУБОМИР» — обрушение и прочность (T-022a, docs/PHYSICS_PLAN.md §1): переходник кубиков к ядру движка D37E.support
// ═══════════════════════════════════════
// Мир выбирает при создании: «Обрушение: выкл (как было) / мягкое / реализм» (meta.support; старые миры — выкл, постройки не
// рухнут). Постройка игрока (клетка в правках чанка) держится по материалу блока (дерево, камень, кирпич, металл, стекло, земля,
// песок, снег); природное в «мягком» — опора, в «реализме» — скала и грунт (вверх не теряют, вбок — свод пещеры: широко выкопал —
// середина обваливается). Листва, трава, цветы, факелы, лестницы — не держат и держаться не обязаны (факел и лестница отпадают
// вместе с тем, на чём висят). Сломал блок — пересчёт рядом (ядро); что держалось через него и теперь не держится — падает
// кусками (KubomirEnts.fallGroup, режим drop: целым куском вниз, по тактам игры) и ложится блоками (природное — булыжником);
// куда лечь нельзя (игрок, моб, незагруженное) — выпадает вещью: ничего не теряется. Поставить блок, который не удержится, нельзя
// (подсказка). Рамка «куда встанет блок» — цветом устойчивости: синий — на опоре, зелёный, жёлтый, красный (еле держится).
// Игра вместе: считает хозяин (его правки и падающие куски уходят гостям), гость сам проверяет «удержится ли» (рамка и отказ).
//   X = KubomirSupport.attach(st) → null (выкл) | { mode, P, code(x, y, z), removed(x, y, z, код), canPlace(x, y, z, блок),
//   tint(T, блок), stats, matOf(блок) }
// Нагрузка (v2, T-124, STRUCTURE_HAZARDS.md §2.1): мир с meta.load = 1 (и D37E.support.LOAD) — у постройки есть вес: плита на одной
// палке, длинная консоль, перевешенный балкон ломаются; пересчёт — заданием по кусочкам в такте мира (SOLVE_BUDGET шагов, одинаково
// на телефоне и ПК), не в обработчике ломания; рамка «куда встанет» — по держанию и нагрузке, считается в такте мира. Старые миры
// (нет meta.load) — v1, как было.
(() => {
  const VX = () => window.D37E.vox, SU = () => window.D37E.support;
  const KS = window.KubomirSupport = window.KubomirSupport || {};
  KS.MODES = ['off', 'soft', 'real'];
  KS.NOTES = {
    off: 'Обрушение выкл: блоки держатся где угодно, как в Майнкрафте.',
    soft: 'Мягкое: постройкам нужна опора — длинные балки и навесы без колонн падают, пещеры не обваливаются. Рамка при стройке — цветом: синий — на опоре, зелёный — крепко, жёлтый — так себе, красный — еле держится.',
    real: 'Реализм: опора важнее (камень держится вбок на 4 блока, дерево — на 6, металл — на 12), и своды пещер обваливаются, если выкопать слишком широко.',
  };

  // ── материал прочности по блоку: 255 — не держит и не нуждается (воздух, вода, листва, растения, факелы, лестницы) ──
  let MT = null, NT = null, tabN = -1;
  const SOUND = { stone: 'stone', metal: 'metal', wood: 'wood', glass: 'glass', dirt: 'dirt', grass: 'dirt', sand: 'sand', gravel: 'sand', snow: 'snow', wool: 'dirt' };
  function tables(){
    const V = VX(), S = SU();
    if (MT && tabN === V.blocks.length) return;
    tabN = V.blocks.length; MT = new Uint8Array(tabN).fill(255); NT = new Uint8Array(tabN).fill(255);
    for (const b of V.blocks) {
      const i = b.id;
      if (!V.T.solid[i] || V.T.liquid[i] || b.shape === V.SHAPE.cross || b.shape === V.SHAPE.cactus || /^leaves_/.test(b.name) || b.foliage || b.supMat === 'none') continue;
      let k = b.supMat || SOUND[b.sound] || 'stone';
      if (/bricks/.test(b.name)) k = 'brick';
      else if (b.name === 'obsidian') k = 'concrete';
      else if (/_block$/.test(b.name) && b.sound === 'metal') k = 'metal';
      else if (b.name === 'ice') k = 'glass';
      MT[i] = S.mat(k);
      NT[i] = S.mat(['stone', 'metal', 'glass'].includes(b.sound) || b.name === 'ice' ? 'rock' : 'soil');
    }
  }
  KS.matOf = id => { tables(); return MT[id] ?? 255; };

  KS.attach = st => {
    const S = SU(), V = VX();
    const mode = st?.meta?.support;
    if (!S || !S.on(mode)) return null;
    tables();
    const W = st.W, P = S.prof(mode), soft = mode === 'soft', BED = V.ID.bedrock;
    const G = S.grid({ dims: 3, down: -1, max: 24576 });
    const BO = { r: 96, rn: 13, P };   // природное — на 13 шагов (свод держится вбок до 9 клеток + высота зала)
    BO.opb = 16;   // v2: вес узла при сборке куска — чтение чанков мира (Chrome, телефон ×4: ~4–7 мкс на узел; такт ≤ 2 мс)
    // код клетки для ядра: 0 пусто, 1 опора, постройка / природное с материалом
    // чанк — один раз на столбик соседних клеток (обход в ширину идёт рядом), без Math.floor: координаты — целые
    let lc = null, lcx = 1e9, lcz = 1e9;
    const H = V.H;
    const read = (x, y, z) => {
      if (y < 0) return 1; if (y >= H) return 0;
      const cx = x >> 4, cz = z >> 4;
      if (cx !== lcx || cz !== lcz) { lc = W.chunk(cx, cz); lcx = cx; lcz = cz; }
      const c = lc; if (!c || !c.gen) return 5;   // незагруженное — опора «край куска» (не рушим то, чего не видим; v1 — как 1)
      const i = ((x & 15) << 11) | ((z & 15) << 7) | y, v = c.ids ? c.ids[i] : W.raw(x, y, z);   // мир без массива клеток (проверки) — через raw
      if (!v) return 0; if (v < 0) return 1;
      const t = v & 0xfff;
      if (t === BED) return 1;
      const m = MT[t]; if (m === undefined || m === 255) return 0;
      const e = c.edits;
      if (e && e.has(i)) return (m << 2) | 2;
      return soft ? 1 : (NT[t] << 2) | 3;
    };
    const fresh = () => { lc = null; lcx = lcz = 1e9; };   // перед каждым расчётом (чанки могли выгрузить)
    const LD = !!(S.LOAD && S.loadJob && (st.meta?.load === 1 || st.meta?.load === true));   // v2: вес и моменты
    const X = { mode, P, G, load: LD, stats: { solves: 0, ms: 0, maxMs: 0, groups: 0, cells: 0, refused: 0, jobs: 0, ticks: 0, restarts: 0, crushed: 0, over: 0, tickMs: 0, maxTickMs: 0, lastTicks: 0, lastN: 0 }, matOf: KS.matOf };
    X.code = (x, y, z) => { fresh(); return read(x, y, z); };
    const SEEDS = [];
    const nowMs = () => performance.now();
    // ── поставить: удержится ли блок b в (x, y, z) → держание (‰) или −1 (не участвует — можно всегда) ──
    X.estimate = (x, y, z, b) => {
      const m = MT[b.id]; if (m === undefined || m === 255) return -1;
      SEEDS.length = 0; SEEDS.push(x, y, z, (m << 2) | 2);
      fresh(); G.build(SEEDS, read, BO);
      return G.estimate(P);
    };
    X.canPlace = (x, y, z, b) => {
      if (LD) return placeOk(x, y, z, b);
      const s = X.estimate(x, y, z, b); return s < 0 || s >= P.min[MT[b.id]];
    };
    // ── цвет рамки «куда встанет блок»: раз в 0,1 с или при смене клетки; → [r, g, b] (0…1) или null ──
    const TINT = [1, 1, 1], last = { x: 0, y: -999, z: 0, id: -1, rev: -1, t: 0, lv: 0, s: 0 };
    X.tint = (T, b) => {
      if (!T || !b) return null;
      const m = MT[b.id]; if (m === undefined || m === 255) return null;
      if (LD) return tintAtTick(T, b);
      const t = nowMs();
      if (!(last.x === T.x && last.y === T.y && last.z === T.z && last.id === b.id && (last.rev === W.rev || t - last.t < 100))) {
        const s = X.estimate(T.x, T.y, T.z, b);
        last.x = T.x; last.y = T.y; last.z = T.z; last.id = b.id; last.rev = W.rev; last.t = t; last.s = s;
        last.lv = S.level(s, m, P, G.g.gnd[0]);
      }
      const c = S.COLORS[last.lv];
      TINT[0] = (c >> 16 & 255) / 255; TINT[1] = (c >> 8 & 255) / 255; TINT[2] = (c & 255) / 255;
      return TINT;
    };
    X.level = () => last.lv;
    // ── сломали (x, y, z) с кодом code (до правки: X.code) → пересчёт и обрушение ──
    X.removed = (x, y, z, code) => {
      if (!code || (code & 3) < 2) return 0;
      if (LD) { queueJob('rm', x, y, z, code, 0); return 0; }   // v2: задание в такте мира (X.step)
      const t0 = nowMs();
      SEEDS.length = 0; SEEDS.push(x, y, z, code);
      fresh(); G.build(SEEDS, read, BO);
      const ng = G.collapse(P);
      const ms = nowMs() - t0;
      X.stats.solves++; X.stats.ms += ms; if (ms > X.stats.maxMs) X.stats.maxMs = ms;
      if (!ng) return 0;
      X.stats.groups += ng;
      for (let k = 0; k < ng; k++) enqueue(G.groups(k), 0);
      X.step();   // первое — сразу (в этом же такте), остальное — по бюджету шагов
      return ng;
    };

    // ── замер без последствий: что упало бы, если убрать клетку (x, y, z) с кодом code (мир не трогаем) ──
    X.dry = (x, y, z, code) => {
      if (LD) return dry2(x, y, z, code);
      const t0 = nowMs();
      SEEDS.length = 0; SEEDS.push(x, y, z, code);
      fresh(); G.build(SEEDS, read, BO);
      const ng = G.collapse(P);
      return { ms: nowMs() - t0, nodes: G.g.n, groups: ng, fall: G.g.nf };
    };
    // ── очередь: большое обрушение — по частям (куски до PART клеток, снизу вверх), не больше BUDGET клеток за такт игры (20/с, st.sup.step в update):
    // кадр не «встаёт» на секунды (дом из 2000 блоков — ~0,1–0,2 с частями); места для анимации нет — ждёт до 6 с (120 тактов), потом ложится сразу ──
    const PART = 400, BUDGET = 260, Q = [];   // бюджет — одинаковый на телефоне и ПК (одинаковый ход обрушения)
    X.queue = Q;
    function enqueue(xyz, depth){
      const n = xyz.length / 3;
      if (n <= PART) { Q.push({ xyz, depth, wait: 0, y: minY(xyz) }); return; }
      const bins = new Map();   // куски 8×8×8 — каждый падает сам (верх ложится на низ)
      for (let i = 0; i < xyz.length; i += 3) {
        const k = ((xyz[i] >> 3) + 4096) * 67108864 + ((xyz[i + 1] >> 3) + 64) * 524288 + ((xyz[i + 2] >> 3) + 4096);
        let b = bins.get(k); if (!b) bins.set(k, b = []); b.push(xyz[i], xyz[i + 1], xyz[i + 2]);
      }
      for (const b of [...bins.keys()].sort((a, c) => a - c).map(k => bins.get(k))) Q.push({ xyz: b, depth, wait: 0, y: minY(b) });
      Q.sort((a, c) => a.y - c.y);
    }
    const minY = a => { let m = 1e9; for (let i = 1; i < a.length; i += 3) if (a[i] < m) m = a[i]; return m; };
    X.step = () => {
      if (LD) loadTick();
      let budget = BUDGET;
      while (Q.length && budget > 0) {
        const job = Q[0], n = job.xyz.length / 3, free = (st.ents?.groups?.length ?? 99) < 8;
        if (!free && n > 24 && job.wait++ < 120) break;   // анимаций и так много — подождать
        Q.shift(); budget -= n;
        dropGroup(job.xyz, job.depth, !free);
      }
    };

    // ── кусок падает: прицепленное отпадает вещами, клетки — из мира, кусок — целым вниз; лёг — блоками (куда нельзя — вещью) ──
    // сундук и печь в куске (T-124 SH0.2): содержимое (W.tile) едет вместе с блоком и ложится с ним на новое место; лечь нельзя —
    // высыпается вещами «keep» (не пропадают). Вещи события — стопками (st.ents.itemBatch), не сотни штук
    const batch = keep => st.ents?.itemBatch ? st.ents.itemBatch(keep) : { add: (x, y, z, s) => st.ents?.addItem?.(x, y, z, s, false, null, false, keep), flush(){} };
    function spill(tile, x, y, z, ev){ if (tile) for (const s of [...(tile.items || []), tile.in, tile.fuel, tile.out]) if (s && s.n > 0) ev.add(x + .5, y + .5, z + .5, s); }
    function dropGroup(xyz, depth = 0, instant = false){
      own++; try { dropGroup0(xyz, depth, instant); } finally { own--; }
    }
    function dropGroup0(xyz, depth, instant){
      fresh();
      const n = xyz.length / 3, cells = [], nat = [];
      let tiles = null;
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9, y0 = 1e9;
      for (let i = 0; i < n; i++) {
        const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2], v = W.raw(x, y, z);
        if (!(v > 0)) continue;
        nat.push((read(x, y, z) & 3) === 3);   // природное (до уборки: правок в клетке нет) — ляжет булыжником / землёй
        cells.push(x, y, z, v);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; if (y < y0) y0 = y;
      }
      if (!cells.length) return;
      X.stats.cells += cells.length / 4;
      const evA = batch(true), ev = batch(true);   // отпавшее сразу; что не легло — при посадке
      for (let i = 0; i < cells.length; i += 4) popAttached(cells[i], cells[i + 1], cells[i + 2], evA);
      evA.flush();
      for (let i = 0; i < cells.length; i += 4) {
        const x = cells[i], y = cells[i + 1], z = cells[i + 2], v = cells[i + 3];
        const tl = W.dropTile ? W.dropTile(x, y, z) : null;
        if (tl) { if (!tiles) tiles = new Array(cells.length >> 2).fill(null); tiles[i >> 2] = tl; X.stats.tiles = (X.stats.tiles | 0) + 1; }
        W.set(x, y, z, 0, { urgent: 2 });
        if ((i >> 2) % 3 === 0) st.ents?.debris?.(x, y, z, v & 0xfff, 3);
      }
      const pivot = { x: (x0 + x1) / 2 + .5, y: y0, z: (z0 + z1) / 2 + .5 };
      const landed = [];   // где легли блоками: потом — держатся ли сами (лёг краем на столб — остальное свалится дальше)
      let moved = false;   // v2: лёг на том же месте (стоял на опоре, сдвига нет) — нагрузка та же, проверять снова незачем
      const onSettle = (v, x, y, z, i) => { if (y !== cells[i * 4 + 1]) moved = true; if (settle(v, x, y, z, nat[i], tiles ? tiles[i] : null, ev)) landed.push(x, y, z); };
      const onLanded = () => { ev.flush(); if (moved || !LD) recheck(landed, depth + 1); };
      const nc = cells.length / 4;   // 1–3 блока — без сетки и анимации: осыпаются сразу (пыль), иначе — куском
      const g = !instant && nc > 3 && nc <= PART ? st.ents?.fallGroup?.(cells, pivot, { x: 1, z: 0 }, { drop: true, cap: 8, onSettle, onLanded }) : null;
      if (g) return;
      // нет анимации (много сразу, нет сущностей) — ложится сразу
      const flat = []; for (let i = 0; i < cells.length; i += 4) flat.push(cells[i], cells[i + 1], cells[i + 2]);
      const F = S.drop(flat, { down: -1 });
      for (let k = 0; k < 4000 && !S.dropStep(F, 1 / 20, solidAt); k++);
      for (let i = 0; i < cells.length; i += 4) onSettle(cells[i + 3], cells[i], cells[i + 1] - F.off, cells[i + 2], i >> 2);
      if (nc > 3 || (X.thudT = (X.thudT || 0) + 1) % 6 === 1) st.AU?.play('kb_thud', { x: pivot.x - st.ox, y: pivot.y - F.off + 1, z: pivot.z - st.oz, vol: nc > 3 ? .9 : .5, rate: .85 });
      if (nc > 3) onLanded(); else ev.flush();   // упало 1–3 блока — проверять, держатся ли они, не нужно (лежат на том, на что упали)
    }
    // легли — держатся ли? (падение только добавляет блоки — чужое держание не уменьшается; не держатся только сами упавшие)
    X.recheck = xyz => { recheck(xyz, 1); X.step(); };
    function recheck(xyz, d){
      if (!xyz.length || d > 2 || xyz.length > 3 * 1600) return;
      if (LD) { fresh(); for (let i = 0; i < xyz.length; i += 3) { const c = read(xyz[i], xyz[i + 1], xyz[i + 2]); if ((c & 3) >= 2) queueJob('add', xyz[i], xyz[i + 1], xyz[i + 2], c, d); } return; }   // v2: «лёг» — с нагрузкой (до = до посадки)
      SEEDS.length = 0; fresh();
      for (let i = 0; i < xyz.length; i += 3) { const c = read(xyz[i], xyz[i + 1], xyz[i + 2]); if ((c & 3) >= 2) SEEDS.push(xyz[i], xyz[i + 1], xyz[i + 2], c); }
      if (!SEEDS.length) return;
      fresh(); G.build(SEEDS, read, BO);
      G.solve(P, false);
      const g = G.g, out = [];
      for (let i = 0; i < g.n; i++) if (g.seed[i] && g.sup[i] < P.min[g.mat[i]]) out.push(G.px[i], G.py[i], G.pz[i]);
      if (!out.length) return;
      // не держатся — связными кусками (по соседству), падают дальше
      const left = new Set(); for (let i = 0; i < out.length; i += 3) left.add(V.supportKey(out[i], out[i + 1], out[i + 2]));
      for (let i = 0; i < out.length; i += 3) {
        const k0 = V.supportKey(out[i], out[i + 1], out[i + 2]); if (!left.has(k0)) continue;
        left.delete(k0); const part = [out[i], out[i + 1], out[i + 2]];
        for (let h = 0; h < part.length; h += 3) for (let q = 0; q < 6; q++) {
          const nx = part[h] + (q === 0 ? 1 : q === 1 ? -1 : 0), ny = part[h + 1] + (q === 2 ? 1 : q === 3 ? -1 : 0), nz = part[h + 2] + (q === 4 ? 1 : q === 5 ? -1 : 0), k = V.supportKey(nx, ny, nz);
          if (left.has(k)) { left.delete(k); part.push(nx, ny, nz); }
        }
        X.stats.groups++;
        enqueue(part, d);
      }
    }
    const solidAt = (x, y, z) => { const v = W.raw(x, y, z); if (v < 0) return true; if (!(v > 0)) return false; const t = v & 0xfff; return V.T.solid[t] === 1 && V.T.shape[t] !== V.SHAPE.cross; };
    // лёг: блоком (природный камень — булыжником, дёрн — землёй), занято — вещью
    function settle(v, x, y, z, natural, tile, ev){ own++; try { return settle0(v, x, y, z, natural, tile, ev); } finally { own--; } }
    function settle0(v, x, y, z, natural, tile, ev){
      const b = V.blocks[v & 0xfff]; if (!b) { spill(tile, x, y, z, ev); return; }
      let place = v;
      if (natural) { const r = b.name === 'stone' ? 'cobble' : b.name === 'grass' || b.name === 'snow_grass' ? 'dirt' : null; if (r && V.ID[r] !== undefined) place = V.cell(V.ID[r], 0); }
      const cur = W.raw(x, y, z);
      const free = cur >= 0 && y >= 1 && y < V.H - 1 && (cur === 0 || (V.blocks[cur & 0xfff]?.replace && !V.T.solid[cur & 0xfff]) || V.T.liquid[cur & 0xfff] || V.T.shape[cur & 0xfff] === V.SHAPE.cross || V.T.shape[cur & 0xfff] === V.SHAPE.torch);
      const body = free && (overlapP(x, y, z) || st.ents?.blocked?.(x, y, z) || (st.ents?.others || []).some(o => !o.dead && o.x + .3 > x && o.x - .3 < x + 1 && o.z + .3 > z && o.z - .3 < z + 1 && o.y + 1.8 > y && o.y < y + 1));
      if (free && !body && !b.glass) {
        if (cur > 0 && !V.T.liquid[cur & 0xfff]) dropBlockItem(cur, x, y, z, ev);   // факел, цветок под упавшим — вещью
        W.set(x, y, z, place, { urgent: 2 });
        if (tile) {   // сундук / печь — содержимое на новом месте (чужое, что там осталось без блока, — вещами)
          spill(W.dropTile ? W.dropTile(x, y, z) : null, x, y, z, ev);
          W.tile?.(x, y, z, () => tile);
          if ('fuel' in tile || 'in' in tile) st.ents?.furnaces?.add(x + ',' + y + ',' + z);
        }
        return true;
      }
      if (!st.creative) dropBlockItem(b.glass ? 0 : place, x, y, z, ev);
      spill(tile, x, y, z, ev);   // лечь некуда — содержимое вещами (и в «Творчестве»: это вещи игрока)
      return false;
    }
    const overlapP = (x, y, z) => { const p = st.P; if (!p || p.dead) return false; const hw = (p.w || .6) / 2; return p.x + hw > x && p.x - hw < x + 1 && p.z + hw > z && p.z - hw < z + 1 && p.y + (p.h || 1.8) > y && p.y < y + 1; };
    function dropBlockItem(v, x, y, z, ev){
      if (!(v > 0) || st.creative) return;
      const b = V.blocks[v & 0xfff]; if (!b) return;
      const name = b.name === 'door_oak' ? 'door' : b.name === 'furnace_lit' ? 'furnace' : b.drop || b.name;
      if (name && V.item(name)) { if (ev) ev.add(x + .5, y + .4, z + .5, { id: name, n: 1 }); else st.ents?.addItem?.(x + .5, y + .4, z + .5, { id: name, n: 1 }, false, null, false, true); }
    }
    // факел, лестница, растение, дверь, прицепленные к клетке (x, y, z), — отпадают вещами
    function popAttached(x, y, z, ev){
      for (let k = 0; k < 6; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0), nz = z + (k === 4 ? 1 : k === 5 ? -1 : 0);
        const v = W.raw(nx, ny, nz); if (!(v > 0)) continue;
        const t = v & 0xfff, sh = V.T.shape[t], s = v >>> 12;
        if (MT[t] !== 255 && sh !== V.SHAPE.door) continue;   // своё держание — у ядра
        let ax = nx, ay = ny - 1, az = nz;
        if (sh === V.SHAPE.torch) { const f = s & 7; if (f >= 1 && f <= 4) { const d = V.FACING[f - 1]; ax = nx - d[0]; ay = ny; az = nz - d[2]; } }
        else if (sh === V.SHAPE.ladder) { const d = V.FACING[s & 3]; ax = nx - d[0]; ay = ny; az = nz - d[2]; }
        else if (sh === V.SHAPE.door) { if (s & 8) continue; }   // верхняя половина — с нижней
        else if (sh !== V.SHAPE.cross) continue;
        if (ax !== x || ay !== y || az !== z) continue;
        if (sh === V.SHAPE.door) { const u = W.raw(nx, ny + 1, nz); if (u > 0 && (u & 0xfff) === t) W.set(nx, ny + 1, nz, 0, { urgent: 2 }); }
        W.set(nx, ny, nz, 0, { urgent: 2 });
        dropBlockItem(v, nx, ny, nz, ev);
      }
    }

    // ═══ v2 (нагрузка): задания в такте мира ═══
    // Очередь заданий (FIFO, одно идёт): ломание — 'rm' (до = с клеткой), посадка куска — 'add' (до = без него). Правка внутри
    // куска идущего задания — заново с объединением семян (не больше 2 раз, потом — до конца на последнем мире); остальные — в
    // следующее задание (одно ждущее копит семена рядом). Бюджет шагов на такт — один на всех (S.SOLVE_BUDGET); итог — группы падают
    // (та же очередь кусков), раздавленные клетки — вещами. Дольше такта — скрип и пыль на куске.
    let own = 0;
    const JQ = [], CRUSH = [];
    let cur = null, restarts = 0, touched = false, J = null, GE = null, JE = null, BOE = null;
    if (LD) {
      J = G.loadJob();
      GE = S.grid({ dims: 3, down: -1, max: 4096 }); JE = GE.loadJob(); BOE = { r: 96, rn: 13, P, max: 4096, opb: 16 };
      // чужая правка (игрок поставил, огонь, вода) внутри куска идущего задания — пересчитать заново
      if (Array.isArray(W.listeners)) W.listeners.push((x, y, z) => { if (!own && J.busy && G.inPiece(x, y, z)) touched = true; });
    }
    const NEAR = 256;
    function queueJob(kind, x, y, z, code, depth){
      // идущее задание того же вида и его кусок — заново с объединением семян
      if (cur && J.busy && cur.kind === kind && G.inPiece(x, y, z) && restarts < 2) { cur.seeds.push(x, y, z, code); touched = true; return; }
      const q = JQ[JQ.length - 1];
      if (q && q.kind === kind && q.depth === depth && q.seeds.length < 4 * 4096 && Math.abs(q.seeds[0] - x) < NEAR && Math.abs(q.seeds[2] - z) < NEAR && Math.abs(q.seeds[1] - y) < NEAR) { q.seeds.push(x, y, z, code); return; }
      JQ.push({ kind, depth, seeds: [x, y, z, code], t0: X.stats.ticks });
    }
    function loadTick(){
      const t0 = nowMs();
      X.stats.ticks++;
      if (!J.busy && JQ.length) { cur = JQ.shift(); restarts = 0; touched = false; fresh(); J.start(cur.kind, cur.seeds, read, BO); X.stats.jobs++; }
      if (J.busy) {
        if (touched) { touched = false; if (restarts < 2) { restarts++; X.stats.restarts++; fresh(); J.start(cur.kind, cur.seeds, read, BO); } }
        fresh();
        const fin = J.step(S.SOLVE_BUDGET);
        if (J.ticks === 2) creak(cur);
        if (fin) apply(cur);
      }
      tintTick();
      const ms = nowMs() - t0; X.stats.tickMs += ms; if (ms > X.stats.maxTickMs) X.stats.maxTickMs = ms;
    }
    function apply(job){
      const R = J.res; cur = null;
      X.stats.solves++; X.stats.lastTicks = R.ticks; X.stats.lastN = R.n; X.stats.over += R.over;
      const ng = R.ng; X.stats.groups += ng;
      // раздавленные клетки — сначала (их нет в группах): постройка — своей вещью «keep», природное — булыжником (вещью)
      if (R.crushed) {
        J.crushedList(CRUSH); const ev = batch(true); own++;
        try { for (const i of CRUSH) { const x = G.px[i], y = G.py[i], z = G.pz[i], v = W.raw(x, y, z); if (!(v > 0)) continue; W.set(x, y, z, 0, { urgent: 2 }); X.stats.crushed++; const nat = (G.g.mat[i] === S.MAT.rock || G.g.mat[i] === S.MAT.soil); dropBlockItem(nat && V.ID.cobble !== undefined && (v & 0xfff) === V.ID.stone ? V.cell(V.ID.cobble, 0) : v, x, y, z, ev); st.ents?.debris?.(x, y, z, v & 0xfff, 4); } } finally { own--; }
        ev.flush();
      }
      for (let k = 0; k < ng; k++) enqueue(G.groups(k), job.depth);
    }
    function creak(job){   // задание дольше такта: скрип и пыль там, где правка
      const x = job.seeds[0], y = job.seeds[1], z = job.seeds[2];
      st.AU?.play('kb_creak', { x: x - st.ox + .5, y: y + 1, z: z - st.oz + .5, vol: .55, rate: .8 });
      const v = W.raw(x, y + 1, z); if (v > 0) st.ents?.debris?.(x, y + 1, z, v & 0xfff, 2);
    }
    // ── поставить (v2): держание и нагрузка; рамка — в такте мира (задание оценки по кусочкам), клик — сразу, если не готово ──
    const EST = { x: 0, y: -999, z: 0, id: -1, rev: -1, ok: true, lv: 0, busy: false, want: false, wx: 0, wy: 0, wz: 0, wid: -1, wrev: -1 };
    const EST_BUDGET = 2048;
    function placeOk(x, y, z, b){
      const m = MT[b.id]; if (m === undefined || m === 255) return true;
      if (EST.x === x && EST.y === y && EST.z === z && EST.id === b.id && EST.rev === W.rev && !EST.busy) return EST.ok;
      fresh(); const o = S.placeCheck(GE, x, y, z, (m << 2) | 2, read, BOE);
      EST.busy = false; EST.x = x; EST.y = y; EST.z = z; EST.id = b.id; EST.rev = W.rev; EST.ok = o.ok; EST.lv = o.lv;
      if (!o.ok) X.stats.refused++;
      return o.ok;
    }
    function tintAtTick(T, b){
      EST.want = true; EST.wx = T.x; EST.wy = T.y; EST.wz = T.z; EST.wid = b.id;
      const same = EST.x === T.x && EST.y === T.y && EST.z === T.z && EST.id === b.id;
      last.lv = same ? EST.lv : last.lv;
      const c = S.COLORS[last.lv];
      TINT[0] = (c >> 16 & 255) / 255; TINT[1] = (c >> 8 & 255) / 255; TINT[2] = (c & 255) / 255;
      return TINT;
    }
    function tintTick(){
      if (EST.busy) {
        fresh();
        if (JE.step(EST_BUDGET)) { const m = MT[EST.wid2]; const o = S.placeResult(GE, (m << 2) | 2); EST.busy = false; EST.x = EST.bx; EST.y = EST.by; EST.z = EST.bz; EST.id = EST.wid2; EST.rev = EST.brev; EST.ok = o.ok; EST.lv = o.lv; }
        return;
      }
      if (!EST.want) return;
      EST.want = false;
      if (EST.x === EST.wx && EST.y === EST.wy && EST.z === EST.wz && EST.id === EST.wid && EST.rev === W.rev) return;
      const m = MT[EST.wid]; if (m === undefined || m === 255) return;
      fresh(); S.placeStart(GE, EST.wx, EST.wy, EST.wz, (m << 2) | 2, read, BOE);
      EST.busy = true; EST.bx = EST.wx; EST.by = EST.wy; EST.bz = EST.wz; EST.wid2 = EST.wid; EST.brev = W.rev;
    }
    // ── замер без последствий (v2): задание целиком по кусочкам бюджета — сколько тактов и худший такт (мс) ──
    function dry2(x, y, z, code){
      while (J.busy || JQ.length) loadTick();   // замер — на пустой очереди (идущее задание доводим до конца)
      const t0 = nowMs(); fresh(); J.start('rm', [x, y, z, code], read, BO);
      let maxT = 0, nt = 0, wph = -1; const ph = [0, 0, 0, 0, 0, 0, 0, 0], po = [0, 0, 0, 0, 0, 0, 0, 0];
      for (;;) { const p = J.phase, o0 = J.ops, a = nowMs(); fresh(); const fin = J.step(S.SOLVE_BUDGET); const d = nowMs() - a; nt++; ph[p] += d; po[p] += J.ops - o0; if (d > maxT) { maxT = d; wph = p; } if (fin) break; }
      return { ms: nowMs() - t0, maxTick: maxT, worstPhase: wph, phaseMs: ph.map(v => +v.toFixed(2)), phaseOps: po, ticks: nt, nodes: G.g.n, groups: J.res.ng, fall: J.res.nf, ops: J.res.ops };
    }
    X.jobs = () => ({ busy: !!J?.busy, queued: JQ.length, cur: cur ? { kind: cur.kind, seeds: cur.seeds.length / 4 } : null });
    return X;
  };
})();
