// ═══════════════════════════════════════
//  «ПОДЗЕМЬЕ» — обрушение и прочность (T-022a, docs/PHYSICS_PLAN.md §1): переходник плиток 2D к ядру движка D37E.support
// ═══════════════════════════════════════
// То же ядро, что у «Кубомира» (одно на 2D и 3D): мир выбирает при создании — «Обрушение: выкл (как было) / мягкое / реализм»
// (W.support; старые миры — выкл). Что поставил игрок — бит в чанке (c.pl, 512 байт; сохраняется с чанком: запись pl),
// остальное — природное: скала и грунт держатся столбом без потерь, вбок — своды пещер («мягкое» — до ~36 клеток, «реализм» —
// до ~18; песок, как и раньше, сыплется сам). Постройка держится по материалу плитки: доски и платформы — дерево, кирпич,
// камень, стекло (держится, но не держит), земля. Стены фона блоки не держат. Сломал плитку — пересчёт рядом; что держалось
// через неё и больше не держится — падает куском (по шагам игры 1/60 с: одинаково при 30 / 60 / 144 кадрах) и ложится плитками
// (куда нельзя — вещью: ничего не теряется), задело героя — толчок и немного урона; растения, факелы, предметы на нём —
// отпадают (опоры — как раньше, checkSupport). Поставить то, что не удержится, нельзя (подсказка). Пока в руке плитка — превью
// и точки на своих постройках рядом цветом устойчивости: синий — на опоре, зелёный, жёлтый, красный (еле держится).
//   X = PZSupport.attach(G, H) → null (выкл) | { mode, code(x, y), removed(x, y, код), placed(x, y), canPlace(id, x, y),
//   level(id, x, y), step(dt), draw(), stats }; H — функции игры (cAt, idx, fgAt, setCell, dropItem, checkSupport, debris, snd,
//   lightAt, hurtPlayer, P, TILES)
// Нагрузка (v2, T-124): мир с W.load = 1 (и D37E.support.LOAD) — у постройки есть вес (плита на одной палке, длинная консоль
// ломаются); пересчёт — заданием по кусочкам в такте мира (каждый 3-й шаг 1/60 с, S.SOLVE_BUDGET шагов), рамка — в такте.
(() => {
  const SU = () => window.D37E?.support;
  const PS = window.PZSupport = window.PZSupport || {};
  PS.MODES = ['off', 'soft', 'real'];
  PS.NOTES = {
    off: 'Блоки держатся где угодно, как раньше.',
    soft: 'Мягкое: постройкам нужна опора (длинные балки и навесы без колонн падают), очень широкие пещеры обваливаются.',
    real: 'Реализм: опора важнее (камень держится вбок на 4 клетки, дерево — на 6), своды пещер шире ~18 клеток обваливаются.',
  };
  // группы материала плиток (podzem-core.js, поле g): 1 земля, 2 камень и руды, 3 песок, 4 снег/лёд, 5 ил, 6 глина, 7 глубинное,
  // 8 пепел и жарит, 9 обсидиан, 10 доски, 11 каменный кирпич, 12 кирпич, 13 стекло
  const BY_GROUP = { 1: 'dirt', 2: 'stone', 3: 'sand', 4: 'snow', 5: 'dirt', 6: 'dirt', 7: 'stone', 8: 'stone', 9: 'concrete', 10: 'wood', 11: 'brick', 12: 'brick', 13: 'glass' };
  const NAT_ROCK = new Set([2, 7, 8, 9]);
  let MT = null, NT = null;
  function tables(P){
    const S = SU(); MT = new Uint8Array(256).fill(255); NT = new Uint8Array(256).fill(255);
    for (let f = 1; f < 255; f++) {
      if (!P.USED[f] && f < 160) continue;
      const s = P.SOLID[f], k = P.KIND[f];
      if (!(s === 1 || s === 2) || (k !== 0 && k !== 4)) continue;   // предметы, растения, факелы — сами по себе (их опора — checkSupport)
      const g = P.GROUP[f], key = k === 4 ? 'wood' : f === 7 ? 'glass' : BY_GROUP[g] || 'stone';
      MT[f] = S.mat(key); NT[f] = S.mat(NAT_ROCK.has(g) || !BY_GROUP[g] ? 'rock' : 'soil');
    }
  }
  PS.matOf = (P, f) => { if (!MT) tables(P); return MT[f]; };

  PS.attach = (G, H) => {
    const S = SU(), mode = G?.W?.support;
    if (!S || !S.on(mode)) return null;
    tables(H.P);
    const P = S.prof(mode), Gr = S.grid({ dims: 2, down: 1, max: 8192 }), BO = { r: 64, rn: 20, P, opb: 6 }, SEEDS = [];   // opb: вес узла при сборке куска (чтение плиток; node, разогретое: 25 нс/шаг при 4 против 12–28 у других фаз)
    const { cAt, idx, fgAt } = H;
    const bitOf = (c, i) => c.pl ? (c.pl[i >> 3] >> (i & 7)) & 1 : 0;
    const read = (x, y) => {
      if (y < 0) return 0;
      const c = cAt(x, y); if (!c) return 5;   // не загружено — опора «край куска» (v1 — как 1)
      const i = idx(x, y), f = c.fg[i]; if (!f) return 0;
      const m = MT[f]; if (m === 255) return 0;
      return bitOf(c, i) ? (m << 2) | 2 : (NT[f] << 2) | 3;
    };
    const LD = !!(S.LOAD && S.loadJob && (G.W?.load === 1 || G.W?.load === true));
    const X = { mode, P, G: Gr, load: LD, stats: { solves: 0, ms: 0, maxMs: 0, groups: 0, cells: 0, refused: 0, jobs: 0, ticks: 0, restarts: 0, crushed: 0, tickMs: 0, maxTickMs: 0, lastTicks: 0, early: 0, creaks: 0, skipped: 0, inPlace: 0, estOps: 0, jobOps: 0, checks: 0 }, groups: [] };
    X.code = (x, y) => read(x, y);
    // поставил игрок: бит в чанке (сохраняется вместе с чанком)
    X.placed = (x, y, on = true) => {
      const c = cAt(x, y); if (!c) return;
      const i = idx(x, y);
      if (on) { if (!c.pl) c.pl = new Uint8Array(512); c.pl[i >> 3] |= 1 << (i & 7); } else if (c.pl) c.pl[i >> 3] &= ~(1 << (i & 7));
      if (LD && !own && cur && Gr.inPiece(x, y)) touched = true;   // правка внутри куска идущего задания — заново
    };
    let GV = null;   // мир с нагрузкой: оценка v1 и точки устойчивости — на своей сетке размера v1 (на Gr может идти задание)
    const EG = () => LD ? GV || (GV = S.grid({ dims: 2, down: 1, max: 8192 })) : Gr;
    X.estimate = (f, x, y) => {
      const m = MT[f]; if (m === undefined || m === 255) return -1;
      SEEDS.length = 0; SEEDS.push(x, y, 0, (m << 2) | 2);
      const g = EG(); g.build(SEEDS, read, BO);
      return g.estimate(P);
    };
    // превью и умный курсор спрашивают каждый шаг: ответ на (плитка, клетка, номер правки) — один раз
    const Q = { f: -1, x: 0, y: 0, rev: -1, s: 0, gnd: 0 };
    const ask = (f, x, y) => { const rev = G.cellRev | 0; if (!(Q.f === f && Q.x === x && Q.y === y && Q.rev === rev)) { Q.f = f; Q.x = x; Q.y = y; Q.rev = rev; Q.s = X.estimate(f, x, y); Q.gnd = EG().g.gnd[0]; } return Q.s; };
    // real — настоящая постановка (клик); без него — умный курсор и превью (до 81 клетки за шаг): держание v1 — как в v1 (дёшево, с
    // кэшем), нагрузка — только готовая оценка этой клетки из такта мира (T-124: раньше — полная проверка на каждую клетку каждый шаг)
    X.canPlace = (f, x, y, real) => { const s = ask(f, x, y), ok1 = s < 0 || s >= P.min[MT[f]]; return LD && ok1 && s >= 0 ? loadOk(f, x, y, real) : ok1; };
    X.level = (f, x, y) => {
      const s = ask(f, x, y); if (s < 0) return -1;
      const lv = S.level(s, MT[f], P, Q.gnd);
      if (!LD) return lv;
      EQ.want = true; EQ.wantT = performance.now(); EQ.wf = f; EQ.wx = x; EQ.wy = y;   // нагрузка — заданием в такте мира
      return EQ.done && EQ.f === f && EQ.x === x && EQ.y === y && EQ.rev === (G.cellRev | 0) ? Math.max(lv, EQ.ld) : lv;
    };
    // ── сломали плитку (x, y) с кодом code (до правки) — что держалось через неё, падает ──
    X.removed = (x, y, code) => {
      if (!code || (code & 3) < 2) return 0;
      if (LD) { queueJob('rm', x, y, code, 0); return 0; }   // v2: задание в такте мира
      const t0 = performance.now();
      SEEDS.length = 0; SEEDS.push(x, y, 0, code);
      Gr.build(SEEDS, read, BO);
      const ng = Gr.collapse(P), ms = performance.now() - t0;
      X.stats.solves++; X.stats.ms += ms; if (ms > X.stats.maxMs) X.stats.maxMs = ms;
      for (let k = 0; k < ng; k++) dropGroup(Gr.groups(k), 0);
      return ng;
    };
    // ── кусок падает: плитки из мира (стены фона остаются), прицепленное — по своим правилам опоры (checkSupport) ──
    const MAXG = 24;
    function dropGroup(xyz, depth){ own++; try { dropGroup0(xyz, depth); } finally { own--; } }
    function dropGroup0(xyz, depth){
      const cells = [], flat = [];
      for (let i = 0; i < xyz.length; i += 3) {
        const x = xyz[i], y = xyz[i + 1], c = cAt(x, y); if (!c) continue;
        const j = idx(x, y), f = c.fg[j]; if (!f) continue;
        cells.push(x, y, f, c.st[j] & 15, bitOf(c, j) ? 1 : 0); flat.push(x, y, 0);
      }
      if (!cells.length) return;
      if (LD && !canMove(cells)) { X.stats.inPlace++; return; }   // v2: ниже лечь некуда (стоит на чём-то) — остаётся, ничего не отпадает
      X.stats.groups++; X.stats.cells += cells.length / 5;
      for (let i = 0; i < cells.length; i += 5) { H.setCell(cells[i], cells[i + 1], 0, 0); X.placed(cells[i], cells[i + 1], false); }
      for (let i = 0; i < cells.length; i += 5) { const x = cells[i], y = cells[i + 1]; H.checkSupport(x, y - 1); H.checkSupport(x - 1, y); H.checkSupport(x + 1, y); H.checkSupport(x, y + 1); }
      for (let i = 0; i < cells.length; i += 10) H.debris?.(cells[i], cells[i + 1], 1, 1, cells[i + 2], 2);
      const F = S.drop(flat, { dims: 2, down: 1, g: 60, vmax: 50, far: 160 });
      const grp = { cells, F, pfy: 0, hit: false, depth };
      if (X.groups.length >= MAXG) { while (!S.dropStep(F, 1 / 60, solid)); land(grp); return; }
      X.groups.push(grp);
      H.snd?.('digstone', { x: cells[0], y: cells[1], vol: .7, rate: .7 });
    }
    function canMove(cells){
      const mine = new Set(); for (let i = 0; i < cells.length; i += 5) mine.add(cells[i] * 65536 + cells[i + 1]);
      for (let i = 0; i < cells.length; i += 5) { const x = cells[i], y = cells[i + 1] + 1; if (!mine.has(x * 65536 + y) && solid(x, y)) return false; }
      return true;
    }
    // твёрдое для падающего: блок, платформа, закрытая дверь; не загружено — стена; жидкость и растения — нет
    const solid = (x, y) => { if (y < 0) return false; const f = fgAt(x, y); if (f === 255) return true; const s = H.P.SOLID[f]; return s === 1 || s === 2 || s === 3; };
    // шаг игры (1/60 с): кусок падает, задел героя — толчок; лёг — плитками
    X.step = dt => {
      if (LD && ++stepN % 3 === 0) loadTick();   // такт мира — каждый 3-й шаг (20 раз в секунду)
      const L = X.groups;
      for (let k = L.length - 1; k >= 0; k--) {
        const g = L[k]; g.pfy = g.F.fy;
        if (S.dropStep(g.F, dt, solid)) { L.splice(k, 1); land(g); continue; }
        if (!g.hit) hitPlayer(g, g.F.fy);
      }
    };
    function hitPlayer(g, fy){
      const p = G.pl; if (!p || p.dead) return;
      const c = g.cells;
      for (let i = 0; i < c.length; i += 5) {
        const x = c[i], y = c[i + 1] + fy;
        if (p.x < x + 1 && p.x + p.w > x && p.y < y + 1 && p.y + p.h > y) { g.hit = true; H.hurtPlayer?.(mode === 'real' ? 12 : 6, p.x + p.w / 2 < x + .5 ? -1 : 1, 'обвал'); return; }
      }
    }
    // лёг: плитка — на место (если там пусто, жидкость или трава); занято или там герой — вещью; потом — держится ли легшее
    function land(g){ own++; try { land0(g); } finally { own--; } }
    function land0(g){
      const c = g.cells, off = g.F.off, p = G.pl, landed = [];
      for (let i = 0; i < c.length; i += 5) {
        const x = c[i], y = c[i + 1] + off, f = c[i + 2];
        const cur = fgAt(x, y), free = cur !== 255 && (cur === 0 || (H.P.KIND[cur] === 2 && H.P.HARD[cur] === 0));
        const body = p && !p.dead && p.x < x + 1 && p.x + p.w > x && p.y < y + 1 && p.y + p.h > y;
        if (free && !body && MT[f] !== S.MAT.glass) {   // стекло бьётся — вещью
          if (cur) H.setCell(x, y, 0, 0);
          H.setCell(x, y, f, 0, null, 0);
          X.placed(x, y, true);   // обломки — уже «постройка» (держатся по своему материалу)
          landed.push(x, y, 0);
        } else H.dropTile?.(f, x, y);
      }
      if (c.length) { H.snd?.('digstone', { x: c[0], y: c[1] + off, vol: 1, rate: .55 }); H.debris?.(c[0], c[1] + off, 1, 1, c[2], 6); if (G.cam) G.cam.shake = Math.max(G.cam.shake || 0, Math.min(.35, .08 + c.length / 5 / 120)); }
      if (landed.length && g.depth < 3 && (off > 0 || !LD)) recheck(landed, g.depth + 1);   // v2: лёг на месте (не сдвинулся) — нагрузка та же
    }
    X.recheck = xyz => recheck(xyz, 1);   // легло (x, y, 0, …) — держится ли (как после посадки куска)
    function recheck(xyz, d){
      if (LD) { if (d <= 2) for (let i = 0; i < xyz.length; i += 3) { const cd = read(xyz[i], xyz[i + 1]); if ((cd & 3) >= 2) queueJob('add', xyz[i], xyz[i + 1], cd, d); } return; }
      SEEDS.length = 0;
      for (let i = 0; i < xyz.length; i += 3) { const cd = read(xyz[i], xyz[i + 1]); if ((cd & 3) >= 2) SEEDS.push(xyz[i], xyz[i + 1], 0, cd); }
      if (!SEEDS.length) return;
      Gr.build(SEEDS, read, BO); Gr.solve(P, false);
      const g = Gr.g, out = [];
      for (let i = 0; i < g.n; i++) if (g.seed[i] && g.sup[i] < P.min[g.mat[i]]) out.push(Gr.px[i], Gr.py[i], 0);
      if (out.length) dropGroup(out, d);
    }
    // ── рисунок: падающие плитки (по доле до следующего шага) и превью стройки ──
    X.draw = (R, tileUV, lightAt, alpha) => {
      const a = alpha > 0 && alpha < 1 ? alpha : 0;
      for (const g of X.groups) {
        const fy = g.pfy + (g.F.fy - g.pfy) * a, c = g.cells;
        for (let i = 0; i < c.length; i += 5) {
          const uv = tileUV(c[i + 2]); if (!uv) continue;
          const x = c[i], y = c[i + 1] + fy, L = lightAt(x + .5, y + .5);
          R.sprite(null, x, y, 1, 1, uv[0], uv[1], uv[0] + 16, uv[1] + 16, 255 * L[0] | 0, 255 * L[1] | 0, 255 * L[2] | 0, 255);
        }
      }
    };
    // точки устойчивости на своих постройках рядом с курсором (пока в руке плитка): раз в 0,25 с или после правки
    const DOTS = { x: 1e9, y: 1e9, rev: -1, t: 0, n: 0, xy: new Int32Array(2 * 400), lv: new Uint8Array(400) };
    X.dots = (cx, cy, rev, tnow, f) => {
      if (DOTS.x === cx && DOTS.y === cy && DOTS.rev === rev && tnow - DOTS.t < 1) return DOTS;
      if (tnow - DOTS.t < .25 && DOTS.rev === rev) return DOTS;
      DOTS.x = cx; DOTS.y = cy; DOTS.rev = rev; DOTS.t = tnow; DOTS.n = 0;
      SEEDS.length = 0;
      for (let y = cy - 7; y <= cy + 7; y++) for (let x = cx - 9; x <= cx + 9; x++) { const cd = read(x, y); if ((cd & 3) === 2 && SEEDS.length < 1600) SEEDS.push(x, y, 0, cd); }
      if (!SEEDS.length) return DOTS;
      const D = EG(); D.build(SEEDS, read, BO); D.solve(P, false);
      const g = D.g;
      for (let i = 0; i < g.n && DOTS.n < 400; i++) if (g.seed[i]) { DOTS.xy[DOTS.n * 2] = D.px[i]; DOTS.xy[DOTS.n * 2 + 1] = D.py[i]; DOTS.lv[DOTS.n] = S.level(g.sup[i], g.mat[i], P, g.gnd[i]); DOTS.n++; }
      return DOTS;
    };
    X.COLORS = S.COLORS;
    X.clear = () => { X.groups.length = 0; if (LD) { JQ.length = 0; cur = null; if (J.busy) J.busy = false; } };
    // сохранить / уйти (podzem.js journal, stopWorld): что считается и падает — до конца сразу (T-124: иначе в сохранении висит навсегда)
    X.flush = () => {
      for (let pass = 0; pass < 8; pass++) {
        let any = false;
        if (LD) for (let k = 0; k < 256 && (cur || JQ.length); k++) { any = true; loadTick(1 << 30, true); }
        const L = X.groups; while (L.length) { any = true; const g = L.pop(); for (let k = 0; k < 4000; k++) if (S.dropStep(g.F, 1 / 60, solid)) break; land(g); }
        if (!any) return;
      }
    };

    // ═══ v2 (нагрузка): задания в такте мира (как в «Кубомире»: FIFO, правка внутри куска — заново ≤ 2 раз) ═══
    let own = 0, stepN = 0, cur = null, restarts = 0, touched = false;
    const JQ = [], CRUSH = [], J = LD ? Gr.loadJob() : null, GE = LD ? S.grid({ dims: 2, down: 1, max: 4096 }) : null, JE = GE ? GE.loadJob() : null, BOE = { r: 64, rn: 20, P, max: 4096, opb: 6 };
    const JOBO = { early: true }, EST_MIN = 512, WARM_MS = 1;   // v1-куски — сразу после проходов 1; оценке — минимум шагов; разогрев — мс
    function queueJob(kind, x, y, code, depth){
      if (cur && cur.kind === kind && Gr.inPiece(x, y) && restarts < 2) { cur.seeds.push(x, y, 0, code); touched = true; return; }
      const q = JQ[JQ.length - 1];
      if (q && q.kind === kind && q.depth === depth && q.seeds.length < 4 * 4096 && Math.abs(q.seeds[0] - x) < 256 && Math.abs(q.seeds[1] - y) < 256) { q.seeds.push(x, y, 0, code); return; }
      JQ.push({ kind, depth, seeds: [x, y, 0, code] });
    }
    // семена — по миру сейчас (T-124): «сломали», а плитку вернули — не семя; «легло», а плитки уже нет — тоже
    function liveSeeds(job){
      const a = job.seeds; let k = 0;
      for (let i = 0; i < a.length; i += 4) {
        const c = read(a[i], a[i + 1]), solidC = c === 1 || c === 5 || (c & 3) >= 2;
        if (job.kind === 'rm' ? solidC : (c & 3) < 2) continue;
        if (job.kind !== 'rm') a[i + 3] = c;
        if (k !== i) { a[k] = a[i]; a[k + 1] = a[i + 1]; a[k + 2] = a[i + 2]; a[k + 3] = a[i + 3]; }
        k += 4;
      }
      a.length = k; return k > 0;
    }
    const startJob = () => { S.warmStop(Gr); J.start(cur.kind, cur.seeds, read, BO, JOBO); };
    function loadTick(budget = S.SOLVE_BUDGET, flushing = false){
      const t0 = performance.now();
      X.stats.ticks++;
      for (let k = 0; k < 8 && !cur && JQ.length; k++) { cur = JQ.shift(); restarts = 0; touched = false; if (liveSeeds(cur)) { startJob(); X.stats.jobs++; } else { cur = null; X.stats.skipped++; } }
      if (cur && touched) { touched = false; if (restarts < 2) { restarts++; X.stats.restarts++; if (liveSeeds(cur)) startJob(); else { J.busy = false; J.early = 0; cur = null; X.stats.skipped++; } } }
      let used = 0;
      if (cur) {
        const o0 = J.ops, fin = J.step(budget);
        used = J.ops - o0; X.stats.jobOps += used;
        if (J.early) { const ne = J.early; J.early = 0; X.stats.early += ne; for (let k = 0; k < ne; k++) dropGroup(Gr.groups(k), cur.depth); }   // v1-куски — сразу
        if (J.warn === 1) { J.warn = 2; if (!fin && !flushing) { X.stats.creaks++; const x = cur.seeds[0], y = cur.seeds[1]; H.snd?.('digstone', { x, y, vol: .45, rate: .6 }); H.debris?.(x, y - 1, 1, 1, fgAt(x, y - 1) || 1, 2); } }   // скрип: сломается под нагрузкой
        if (fin) apply(cur);
      }
      if (!flushing) {
        estTick(Math.max(EST_MIN, S.SOLVE_BUDGET - used));   // оценка «поставить» — в том же потолке шагов за такт
        if (!cur && !JQ.length) { if (!Gr.warmed) S.warmTick(Gr, WARM_MS); else if (!GE.warmed && !EQ.busy) S.warmTick(GE, WARM_MS); }   // разогрев ядра (не состояние игры)
      }
      const ms = performance.now() - t0; X.stats.tickMs += ms; if (ms > X.stats.maxTickMs) X.stats.maxTickMs = ms;
    }
    function apply(job){
      const R = J.res; cur = null;
      X.stats.solves++; X.stats.lastTicks = R.ticks;
      if (!liveSeeds(job)) { X.stats.skipped++; return; }   // все семена вернули — ничего не меняется
      if (R.crushed) {   // раздавленные — вещами («keep»); что на них стояло и висело (факел, сундук) — по своим правилам опоры (T-124)
        J.crushedList(CRUSH); own++;
        try {
          for (const i of CRUSH) { const x = Gr.px[i], y = Gr.py[i], f = fgAt(x, y); if (!f || f === 255) continue; H.setCell(x, y, 0, 0); X.placed(x, y, false); H.dropTile?.(f, x, y); X.stats.crushed++; }
          for (const i of CRUSH) { const x = Gr.px[i], y = Gr.py[i]; H.checkSupport(x, y - 1); H.checkSupport(x - 1, y); H.checkSupport(x + 1, y); H.checkSupport(x, y + 1); }
        } finally { own--; }
      }
      for (let k = 0; k < R.ng; k++) dropGroup(Gr.groups(k), job.depth);
    }
    // ── поставить (v2): держание и нагрузка; превью — в такте мира, клик — сразу, если не готово ──
    // EQ — итог оценки нагрузки (ok — правило нагрузки, ld — уровень для рамки) для плитки и клетки при номере правки rev
    const EQ = { f: -1, x: 0, y: 0, rev: -1, ok: true, ld: 0, done: false, busy: false, want: false, wantT: 0, wf: -1, wx: 0, wy: 0, bf: -1, bx: 0, by: 0, brev: -1 };
    function loadOk(f, x, y, real){
      const m = MT[f]; if (m === undefined || m === 255) return true;
      const rev = G.cellRev | 0;
      if (EQ.done && EQ.f === f && EQ.x === x && EQ.y === y && EQ.rev === rev) { if (real && !EQ.ok) X.stats.refused++; return EQ.ok; }
      if (!real) return true;   // курсор и превью: нагрузку покажет оценка в такте (рамка), проверит клик
      S.warmStop(GE); X.stats.checks++;
      const o = S.placeCheck(GE, x, y, 0, (m << 2) | 2, read, BOE);
      EQ.busy = false; EQ.done = true; EQ.f = f; EQ.x = x; EQ.y = y; EQ.rev = rev; EQ.ok = o.ok; EQ.ld = o.load;
      if (!o.ok) X.stats.refused++;
      return o.ok;
    }
    // оценка для рамки — заданием в такте мира; цель сменилась — старое задание бросаем (не досчитываем чужую клетку)
    function estTick(budget){
      if (!EQ.want || performance.now() - EQ.wantT > 500) { EQ.want = false; EQ.busy = false; return; }   // плитки в руке нет — не считаем
      const rev = G.cellRev | 0, wf = EQ.wf, wx = EQ.wx, wy = EQ.wy;
      if (EQ.busy && (EQ.bf !== wf || EQ.bx !== wx || EQ.by !== wy || EQ.brev !== rev)) EQ.busy = false;
      if (!EQ.busy) {
        if (EQ.done && EQ.f === wf && EQ.x === wx && EQ.y === wy && EQ.rev === rev) return;
        const m = MT[wf]; if (m === undefined || m === 255) return;
        S.warmStop(GE); S.placeStart(GE, wx, wy, 0, (m << 2) | 2, read, BOE);
        EQ.busy = true; EQ.bf = wf; EQ.bx = wx; EQ.by = wy; EQ.brev = rev;
      }
      const o0 = JE.ops;
      if (JE.step(budget)) { const o = S.placeResult(GE, (MT[EQ.bf] << 2) | 2); EQ.busy = false; EQ.done = true; EQ.f = EQ.bf; EQ.x = EQ.bx; EQ.y = EQ.by; EQ.rev = EQ.brev; EQ.ok = o.ok; EQ.ld = o.load; }
      X.stats.estOps += JE.ops - o0;
    }
    X.jobs = () => ({ busy: !!cur, queued: JQ.length, warm: !!Gr.warmed });
    return X;
  };
})();
