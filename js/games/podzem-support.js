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
    const P = S.prof(mode), Gr = S.grid({ dims: 2, down: 1, max: 8192 }), BO = { r: 64, rn: 20, P }, SEEDS = [];
    const { cAt, idx, fgAt } = H;
    const bitOf = (c, i) => c.pl ? (c.pl[i >> 3] >> (i & 7)) & 1 : 0;
    const read = (x, y) => {
      if (y < 0) return 0;
      const c = cAt(x, y); if (!c) return 1;   // не загружено — опора
      const i = idx(x, y), f = c.fg[i]; if (!f) return 0;
      const m = MT[f]; if (m === 255) return 0;
      return bitOf(c, i) ? (m << 2) | 2 : (NT[f] << 2) | 3;
    };
    const X = { mode, P, G: Gr, stats: { solves: 0, ms: 0, maxMs: 0, groups: 0, cells: 0, refused: 0 }, groups: [] };
    X.code = (x, y) => read(x, y);
    // поставил игрок: бит в чанке (сохраняется вместе с чанком)
    X.placed = (x, y, on = true) => {
      const c = cAt(x, y); if (!c) return;
      const i = idx(x, y);
      if (on) { if (!c.pl) c.pl = new Uint8Array(512); c.pl[i >> 3] |= 1 << (i & 7); } else if (c.pl) c.pl[i >> 3] &= ~(1 << (i & 7));
    };
    X.estimate = (f, x, y) => {
      const m = MT[f]; if (m === undefined || m === 255) return -1;
      SEEDS.length = 0; SEEDS.push(x, y, 0, (m << 2) | 2);
      Gr.build(SEEDS, read, BO);
      return Gr.estimate(P);
    };
    // превью и умный курсор спрашивают каждый шаг: ответ на (плитка, клетка, номер правки) — один раз
    const Q = { f: -1, x: 0, y: 0, rev: -1, s: 0, gnd: 0 };
    const ask = (f, x, y) => { const rev = G.cellRev | 0; if (!(Q.f === f && Q.x === x && Q.y === y && Q.rev === rev)) { Q.f = f; Q.x = x; Q.y = y; Q.rev = rev; Q.s = X.estimate(f, x, y); Q.gnd = Gr.g.gnd[0]; } return Q.s; };
    X.canPlace = (f, x, y) => { const s = ask(f, x, y); return s < 0 || s >= P.min[MT[f]]; };
    X.level = (f, x, y) => { const s = ask(f, x, y); return s < 0 ? -1 : S.level(s, MT[f], P, Q.gnd); };
    // ── сломали плитку (x, y) с кодом code (до правки) — что держалось через неё, падает ──
    X.removed = (x, y, code) => {
      if (!code || (code & 3) < 2) return 0;
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
    function dropGroup(xyz, depth){
      const cells = [], flat = [];
      for (let i = 0; i < xyz.length; i += 3) {
        const x = xyz[i], y = xyz[i + 1], c = cAt(x, y); if (!c) continue;
        const j = idx(x, y), f = c.fg[j]; if (!f) continue;
        cells.push(x, y, f, c.st[j] & 15, bitOf(c, j) ? 1 : 0); flat.push(x, y, 0);
      }
      if (!cells.length) return;
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
    // твёрдое для падающего: блок, платформа, закрытая дверь; не загружено — стена; жидкость и растения — нет
    const solid = (x, y) => { if (y < 0) return false; const f = fgAt(x, y); if (f === 255) return true; const s = H.P.SOLID[f]; return s === 1 || s === 2 || s === 3; };
    // шаг игры (1/60 с): кусок падает, задел героя — толчок; лёг — плитками
    X.step = dt => {
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
    function land(g){
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
      if (landed.length && g.depth < 3) recheck(landed, g.depth + 1);
    }
    function recheck(xyz, d){
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
      Gr.build(SEEDS, read, BO); Gr.solve(P, false);
      const g = Gr.g;
      for (let i = 0; i < g.n && DOTS.n < 400; i++) if (g.seed[i]) { DOTS.xy[DOTS.n * 2] = Gr.px[i]; DOTS.xy[DOTS.n * 2 + 1] = Gr.py[i]; DOTS.lv[DOTS.n] = S.level(g.sup[i], g.mat[i], P, g.gnd[i]); DOTS.n++; }
      return DOTS;
    };
    X.COLORS = S.COLORS;
    X.clear = () => { X.groups.length = 0; };
    return X;
  };
})();
