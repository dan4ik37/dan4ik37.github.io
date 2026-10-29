// ═══════════════════════════════════════
//  «КУБОМИР» — надрубы, крен и опрокидывание, рубка дерева «как в жизни» (T-138): переходник к D37E.topple и D37E.fell
// ═══════════════════════════════════════
// Владелец 29.10: «ты ломаешь что-то, и оно как в Teardown по частям ломается с этой стороны; плохо держится — перевес, оно
// падает; дерево не распадается, а просто падает вниз, и его надо дорубить; огромным деревьям нужен большой угол»; «физика
// должна быть с наклоном, чтобы не державшее вес не стояло». Спека: E:\d37-core\spec\STRUCTURE_HAZARDS.md §0.9, §2.2, §2.4, §5.x.
//  F1 (KT.CUT) — удар снимает материал со своей стороны: у клетки срез (восьмые клетки с каждой из 6 сторон, плитка W.tile .cut —
//     сохраняется с чанком, формат не меняется), сетка рисует кубик без снятого (voxel-mesh.js cuts); насквозь — блок сломан (как
//     раньше: вещи). Чем сильнее инструмент, тем быстрее идёт срез (время блока — то же, что раньше, если рубить с одной стороны).
//  F2 (KT.LEAN) — миры с обрушением: после правки рядом с постройкой — проверка этажей (центр масс по материалам против опоры
//     этажа, «тонкая опора» усиливает раскачку): не держит — сначала кренится (скрип, пыль), потом падает целым, перекатывается,
//     ложится блоками на бок (брёвна поворачиваются, сундук — с вещами); упёрлось в соседа — висит наклонённым. Куски обрушения,
//     стоящие на краю (D37E.support), — тоже.
//  F3 (KT.FELL) — живое дерево (не поставленное игроком) не ломается с одного удара: подруб ≥ 1/3 ствола со стороны падения, запил
//     с другой — недопил держит, дерево кренится на нём и падает целым; лёгло — брёвна лежат (дорубить), листва — вещами и крошкой;
//     великаны 2×2 и 3×3 требуют куда больше ударов; упало на соседнее дерево — повисло. Огонь и гости — как раньше (fellTree).
//  F4 (шаг 2, kubomir-debris.js) — легло с размаху: блоки, ударившиеся быстрее своей прочности (верх высокой башни), отламываются
//     обломками (летят, катятся, ложатся блоком); блок, которому некуда лечь, — обломок (сползает с кучи); удар толкает вещи по весу.
//  F5 (шаг 2, KT.NET) — игра вместе: решает хозяин. Удар гостя по надрубаемому блоку / живому стволу — просьба хозяину ('kc',
//     kubomir-coop.js → X.hostHit); хозяин рассылает события с номером такта (X.netPush → netTake): срез клетки, тело родилось /
//     угол и сдвиг каждый такт / скрип / повисло / легло, обломки (kubomir-debris.js). Гость (X.netIn) повторяет их в том же
//     порядке с постоянной задержкой в тактах; клетки мира — правками хозяина, как всегда. Гость сам ничего не решает (проверки этажей
//     только у хозяина).
//   X = KubomirTopple.attach(st) → { mines(hit, b, need), mine(hit, b, M), hostHit(hit, b, need, by), hitCost(hit, b, need),
//     cutsFor(cx, cz), group(cells, nat), tick(), left(), flush(), netPush(…), netTake(pv, enc), netIn(list, toLocal, dec), stats,
//     bodies() } · откат каждой части — одна строка: KT.CUT / KT.LEAN / KT.FELL / KT.NET = false (всё выключено — как было).
(() => {
  const KT = window.KubomirTopple = window.KubomirTopple || {};
  KT.CUT = true;    // F1: надрубы со стороны удара (false — копать как раньше)
  KT.LEAN = true;   // F2: перевес — крен, потом падение целым (false — постройки стоят, обрушение — как было)
  KT.FELL = true;   // F3: подруб и запил (false — одно бревно, и дерево падает вещами, как было)
  KT.NET = true;    // F5: игра вместе — гость рубит через хозяина, видит крен / падение / обломки хозяина (false — гость как раньше)
  KT.CEIL = 6144;   // §5.x: потолок за такт мира в операциях (чтения клеток) — постройки (проверки, тела, «легло») и обломки вместе
  KT.CUT_MIN = .3;  // блоки быстрее (с), чем это, копаются как раньше (земля, песок): срез на них не виден и не нужен
  KT.MAXB = 1536;   // постройка больше — проверка этажей «не знаю» (стоит)
  KT.CHECK_OPS = 2048;
  KT.LAND_CELLS = 48;   // легло — клеток в мир за такт (остальное — следующими тактами, сетка лежит на их месте)   // проверки этажей за такт мира: клеток обхода (доля общего потолка, §5.x)
  const VX = () => window.D37E.vox, TPm = () => window.D37E.topple, FLm = () => window.D37E.fell;
  const DEG = 46603 / 80;   // 1°/с — в долях угла за подшаг (2^24 на оборот, 80 подшагов в секунду)

  KT.attach = st => {
    const TP = TPm(), FL = FLm(), V = VX();
    if (!TP || !FL || !V || !st?.W) return null;
    const W = st.W;
    const Wd = TP.world({ slots: 16, smp: 64, reads: 2048 }), B = TP.body(4096), R = TP.result();
    const bodies = new Array(Wd.NS).fill(null), pend = [], CHK = [];
    let own = 0;
    // звуки скрипа и удара синтезируются при первом проигрывании (~0,2 с, телефон ×4 — до 0,8 с): заранее, пока мир открывается
    if (KT.CUT || KT.LEAN || KT.FELL) { const f = () => { try { window.D37E.synth?.render?.('kb_creak'); window.D37E.synth?.render?.('kb_thud'); } catch (e) {} }; if (window.requestIdleCallback) window.requestIdleCallback(f, { timeout: 2500 }); else setTimeout(f, 1000); }
    const X = { Wd, stats: { checks: 0, checkNodes: 0, skipped: 0, tips: 0, leans: 0, hangs: 0, lands: 0, back: 0, cuts: 0, fells: 0, chips: 0, groups: 0, items: 0, maxTickMs: 0, tickMs: 0, ticks: 0, reads: 0, landReads: 0, queued: 0 } };
    const now = () => performance.now();
    X.stats.ms = { chop: 0, check: 0, start: 0, land: 0, recheck: 0 };   // худшее время событий (мс) — для замеров
    function timed(k, f, a, b, c, d, e, g){ const t = now(); try { return f(a, b, c, d, e, g); } finally { const ms = now() - t; if (ms > X.stats.ms[k]) X.stats.ms[k] = ms; } }
    const solidT = t => V.T.solid[t] === 1 && V.T.shape[t] !== V.SHAPE.cross && !V.T.liquid[t];
    const isLeaf = v => st.ents?.treeKind ? st.ents.treeKind(v) === 3 : /^leaves_/.test(V.blocks[v & 0xfff]?.name || '');
    // что останавливает падающее: твёрдое, кроме листвы и растений (сквозь крону падает, о ствол — упирается)
    const stopAt = (x, y, z) => { const v = W.raw(x, y, z); if (v < 0) return true; if (!(v > 0)) return false; const t = v & 0xfff; return solidT(t) && !isLeaf(v); };
    const natural = (x, y, z) => { const c = W.chunkAt ? W.chunkAt(x, z) : null; if (!c) return true; return !(c.edits && c.edits.has(((x & 15) << 11) | ((z & 15) << 7) | y)); };
    const touch = (x, z) => { const c = W.chunkAt ? W.chunkAt(x, z) : null; if (c && st.unsaved) st.unsaved.add(c.key); W.markTile?.(x, z); st.ST?.touch?.(x, z, 2); };
    const batch = keep => st.ents?.itemBatch ? st.ents.itemBatch(keep) : { add: (x, y, z, s) => st.ents?.addItem?.(x, y, z, s, false, null, false, keep), flush(){} };

    // ═══ F1: срез клетки (плитка .cut — 6 сторон по 4 бита, восьмые) ═══
    const cutGet = (x, y, z) => { const t = W.tile ? W.tile(x, y, z) : null; return t && t.cut ? t.cut | 0 : 0; };
    function cutSet(x, y, z, c){
      if (!W.tile) return;
      if (c) { const t = W.tile(x, y, z, () => ({})); t.cut = c; }
      else { const t = W.tile(x, y, z); if (t) { delete t.cut; delete t.fs; if (!Object.keys(t).length) W.dropTile(x, y, z); } }
      touch(x, z);
      if (netOn()) X.netPush('c', x, y, z, c | 0);
    }
    X.cutAt = cutGet;
    // для сетки чанка (voxel-stream cuts): надрубленные клетки области 3×3 чанков у центра → Int32Array [rx, y, rz, значение, срез, …] | null
    X.cutsFor = (cx, cz) => {
      if (!KT.CUT && !KT.FELL) return null;
      let out = null;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const c = W.chunk ? W.chunk(cx + dx, cz + dz) : null; if (!c || !c.tiles || !c.ids) continue;
        for (const [i, t] of c.tiles) {
          if (!t || !t.cut) continue;
          const lx = i >> 11, lz = (i >> 7) & 15, y = i & 127, rx = (dx + 1) * 16 + lx, rz = (dz + 1) * 16 + lz;
          if (rx < 15 || rx > 32 || rz < 15 || rz > 32) continue;
          const v = c.ids[i]; if (!v) continue;
          (out || (out = [])).push(rx, y, rz, v, t.cut | 0);
        }
      }
      return out ? Int32Array.from(out) : null;
    };

    // какой удар: 0 — как раньше, 1 — срез (F1), 2 — рубка живого дерева (F3)
    const SIDE_OF = (nx, ny, nz) => nx > 0 ? 0 : nx < 0 ? 1 : ny > 0 ? 2 : ny < 0 ? 3 : nz > 0 ? 4 : 5;   // грань удара → сторона (порядок сетки)
    X.mines = (hit, b, need) => {
      if (!hit || hit.ice || st.creative || (st.coopGuest && !(KT.NET && st.net?.reqCut)) || !b || b.hard <= 0) return 0;
      const v = hit.v | 0, t = v & 0xfff;
      if (KT.FELL && st.fellOn?.() !== false && st.ents?.treeKind?.(v) === 1 && ((v >>> 12) & 3) === 0 && natural(hit.x, hit.y, hit.z)) return 2;
      if (!KT.CUT || b.shape !== V.SHAPE.cube || !V.T.opaque[t] || b.ui || b.fall || V.T.liquid[t] || isLeaf(v)) return 0;
      return (need ?? st.mine?.need ?? 0) >= KT.CUT_MIN ? 1 : 0;
    };
    // копаем (M = st.mine: t накоплено, need — время блока) → 0 ничего · 1 сломать как раньше (зовущий — breakBlock) · 2 сделано тут
    X.mine = (hit, b, M) => {
      const mode = X.mines(hit, b, M.need); if (!mode) return M.t >= M.need ? 1 : 0;
      if (st.coopGuest) return guestMine(hit, b, M, mode);
      if (mode === 1) return cutHit(hit, b, M);
      return chop(hit, b, M);
    };
    function cutHit(hit, b, M){
      const per = M.need / 4;   // четверть блока за удар (2/8 клетки)
      while (M.t >= per) {
        M.t -= per;
        const f = SIDE_OF(hit.nx | 0, hit.ny | 0, hit.nz | 0), o = f ^ 1, c = cutGet(hit.x, hit.y, hit.z);
        const sf = FL.side(c, f), so = FL.side(c, o), nd = Math.min(8 - so, sf + 2);
        const c2 = (c & ~(15 << (f * 4))) | (nd << (f * 4));
        X.stats.cuts++;
        if (FL.through(c2)) return 1;
        cutSet(hit.x, hit.y, hit.z, c2);
        st.ents?.debris?.(hit.x, hit.y, hit.z, b.id, 3);
        if (KT.LEAN && st.sup) queueCheck(hit.x, hit.y, hit.z, -1);
      }
      return 0;
    }
    // ═══ F5: гость — удары уходят хозяину (он решает: срез, рубка, сломан); у себя — крошки, звук и износ (раз в 4 удара) ═══
    let gHits = 0;
    function guestMine(hit, b, M, mode){
      let per = M.need / 4;
      if (mode === 2) { const D = secD(hit.x, hit.y, hit.z); if (!D) return M.t >= M.need ? 1 : 0; per = M.need * D / 8; }
      const it = st.P?.inv?.[st.P.sel], tool = it ? it.id : '';
      while (M.t >= per) {
        M.t -= per;
        st.net.reqCut(hit.x, hit.y, hit.z, hit.nx | 0, hit.ny | 0, hit.nz | 0, tool);
        st.ents?.debris?.(hit.x, hit.y, hit.z, b.id, mode === 2 ? 4 : 3);
        X.stats.netHits = (X.stats.netHits | 0) + 1;
        if (++gHits % 4 === 0) st.ktWear?.(1);
      }
      return 0;
    }
    const secD = (x, y, z) => { const t = W.tile ? W.tile(x, y, z) : null; if (t && t.fs) return t.fs[4] | 0; const sec = section(x, y, z); return sec ? sec.D : 0; };
    // хозяин: сколько стоит один удар гостя (с) — 0: блок не надрубается (обычное «сломать»)
    X.hitCost = (hit, b, need) => { const mode = X.mines(hit, b, need); return !mode ? 0 : mode === 1 ? need / 4 : need * secD(hit.x, hit.y, hit.z) / 8; };
    // хозяин: один удар гостя (by — где гость: { x, z }) → 0 срез · 1 насквозь (зовущий ломает как раньше) · 2 дерево пошло
    X.hostHit = (hit, b, need, by) => {
      const mode = X.mines(hit, b, need); if (!mode) return 0;
      const per = mode === 1 ? need / 4 : need * secD(hit.x, hit.y, hit.z) / 8; if (!(per > 0)) return 0;
      const M = { t: per + 1e-9, need };
      return mode === 1 ? cutHit(hit, b, M) : chop(hit, b, M, by || { x: hit.x + .5, z: hit.z + .5 });
    };

    // ═══ F3: рубка живого дерева ═══
    // сечение ствола в слое y у клетки (x, z): связные (по 4 сторонам) живые вертикальные брёвна в окне 3×3 → { xs: [x, z, …], x0, z0, D } | null
    function section(x, y, z){
      const xs = [x, z], seen = new Set([x + ',' + z]);
      for (let h = 0; h < xs.length; h += 2) for (let k = 0; k < 4; k++) {
        const nx = xs[h] + (k === 0 ? 1 : k === 1 ? -1 : 0), nz = xs[h + 1] + (k === 2 ? 1 : k === 3 ? -1 : 0), key = nx + ',' + nz;
        if (seen.has(key) || Math.abs(nx - x) > 2 || Math.abs(nz - z) > 2) continue; seen.add(key);
        const v = W.raw(nx, y, nz);
        if (v > 0 && st.ents.treeKind(v) === 1 && ((v >>> 12) & 3) === 0 && natural(nx, y, nz)) { xs.push(nx, nz); if (xs.length > 18) return null; }
      }
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      for (let i = 0; i < xs.length; i += 2) { if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i]; if (xs[i + 1] < z0) z0 = xs[i + 1]; if (xs[i + 1] > z1) z1 = xs[i + 1]; }
      const D = Math.max(x1 - x0, z1 - z0) + 1; if (D > 3) return null;
      return { xs, x0, z0, D };
    }
    const LEAN_OUT = { go: 0, dir: 0, kind: 0, hinge: 0 }, CC = [0, 0, 0, 0];
    const chop = (hit, b, M, by) => timed('chop', chop0, hit, b, M, by);
    function chop0(hit, b, M, by){
      const x = hit.x, y = hit.y, z = hit.z;
      // состояние сечения — в плитке клетки (.fs, копия в каждой клетке сечения: срубленные насквозь клетки уходят)
      const t0 = W.tile(x, y, z);
      let S = t0 && t0.fs ? Int32Array.from(t0.fs) : null, x0, z0, D, xs;
      if (S) { x0 = S[8]; z0 = S[9]; D = S[4]; xs = []; for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) { const v = W.raw(x0 + i, y, z0 + j); if (v > 0 && st.ents.treeKind(v) === 1) xs.push(x0 + i, z0 + j); } }
      else { const sec = section(x, y, z); if (!sec) return M.t >= M.need ? 1 : 0; x0 = sec.x0; z0 = sec.z0; D = sec.D; xs = sec.xs; S = new Int32Array(12); S.set(FL.state(D)); S[8] = x0; S[9] = z0; }
      const per = M.need * D / 8;   // восьмая ствола за удар; шире ствол — дольше
      let side = -1;
      { const nx = hit.nx | 0, nz = hit.nz | 0;
        if (nx || nz) side = nx > 0 ? 0 : nx < 0 ? 1 : nz > 0 ? 2 : 3;
        else { const P = by || st.P, dx = P ? P.x - (x0 + D / 2) : 1, dz = P ? P.z - (z0 + D / 2) : 0; side = Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 0 : 1) : (dz >= 0 ? 2 : 3); } }   // сверху / снизу — со стороны игрока
      let res = 0;
      while (M.t >= per && !res) {
        M.t -= per;
        FL.hit(S, side, FL.step(D));
        X.stats.chips++;
        st.ents?.debris?.(x, y, z, b.id, 4);
        if (!by && S[6] % 4 === 0) st.ktWear?.(1);   // инструмент тупится: раз в 4 удара (как один блок); у гостя — у него самого
        // крона: куда клонится (раз на дерево, когда срез глубже половины) — для «тяжёлое кренится само»
        if (!(S[7] & 1) && S[side] * 2 >= 8 * D) { S[7] |= 1; const T = st.ents.treeAbove(xs, y); if (T) { const L = crownLean(T, x0, z0, D); S[10] = L[0]; S[11] = L[1]; } }
        FL.decide(S, S[7] & 1 ? [S[10], S[11]] : null, LEAN_OUT);
        if (LEAN_OUT.go) { const T = st.ents.treeAbove(xs, y); if (T && fell(T, S, xs, y, LEAN_OUT)) { res = 2; break; } }
        writeSection(S, xs, y, b);
      }
      if (res === 2) { writeSection(S, xs, y, b); return 2; }
      return 0;
    }
    // крона: смещение центра масс от оси ствола (восьмые, × доля массы кроны ‰ / 1000) → [x, z]
    function crownLean(T, x0, z0, D){
      let m = 0, sx = 0, sz = 0;
      const cx = 8 * x0 + 4 * D, cz = 8 * z0 + 4 * D;
      for (let i = 0; i < T.cells.length; i += 4) { const k = st.ents.treeKind(T.cells[i + 3]), w = k === 1 ? 650 : k === 2 ? 200 : 40; m += w; sx += w * (8 * T.cells[i] + 4 - cx); sz += w * (8 * T.cells[i + 2] + 4 - cz); }
      return [Math.floor(sx / Math.max(1, m)), Math.floor(sz / Math.max(1, m))];
    }
    // срезы клеток сечения по состоянию; насквозь — клетка уходит (щепки, без вещей)
    function writeSection(S, xs, y, b){
      const D = S[4], x0 = S[8], z0 = S[9], fs = Array.from(S);
      own++;
      try {
        for (let k = 0; k < xs.length; k += 2) {
          const cx = xs[k], cz = xs[k + 1], v = W.raw(cx, y, cz); if (!(v > 0) || st.ents.treeKind(v) !== 1) continue;
          const gone = FL.cell(S, cx - x0, cz - z0, CC);
          if (gone) { W.dropTile(cx, y, cz); W.set(cx, y, cz, 0, { urgent: 2 }); st.ents?.debris?.(cx, y, cz, b.id, 6); if (!st.creative) { const bl = V.blocks[v & 0xfff], id = bl?.drop || bl?.name; if (id && V.item(id)) st.ents?.addItem?.(cx + .5, y + .4, cz + .5, { id, n: 1 }); } continue; }   // клетка среза насквозь — бревно вещью (как сломать)
          const c = FL.pack(CC[0], CC[1], 0, 0, CC[2], CC[3]);
          const t = W.tile(cx, y, cz, () => ({})); t.cut = c || undefined; t.fs = fs; if (!c) delete t.cut;
          touch(cx, cz);
          if (netOn()) X.netPush('c', cx, y, cz, c | 0);
        }
      } finally { own--; }
    }
    // дерево пошло: убрать из мира, крен на недопиле → падение (D37E.topple), лёгло — брёвна лежат
    function fell(T, S, xs, y, out){
      const D = S[4], x0 = S[8], z0 = S[9], d = out.dir;
      B.reset();
      const cells = T.cells, n = cells.length / 4;
      if (n > B.max) return false;
      for (let i = 0; i < n; i++) { const k = st.ents.treeKind(cells[i * 4 + 3]); B.push(cells[i * 4] - x0, cells[i * 4 + 1] - y, cells[i * 4 + 2] - z0, k === 1 ? 650 : k === 2 ? 200 : 40); }
      // ось — по недопилу: грань сечения со стороны падения минус подруб (восьмые от угла сечения), на верху слоя среза
      R.dir = d; R.py = 8; R.pn = d === 0 ? 8 * D - S[0] : d === 1 ? S[1] : d === 2 ? 8 * D - S[2] : S[3];
      const rate = Math.round((out.kind === 3 ? 1.5 : out.kind === 1 ? 5 : 8) * DEG);
      const s = start('tree', cells, null, null, R, { ox: x0, oy: y, oz: z0, rate, kind: 'lean' });
      if (s < 0) return false;
      X.stats.fells++;
      return true;
    }

    // ═══ F2: проверка этажей постройки у правки ═══
    // правка (x, y, z): was — что было (−1 — надруб: только «после»; иначе — правило «держалось до»: давно перегруженное от чужой правки
    // не падает, как у нагрузки v2)
    function queueCheck(x, y, z, was){
      for (let i = 0; i < CHK.length; i += 4) if (CHK[i] === x && CHK[i + 1] === y && CHK[i + 2] === z) { if (was < 0) CHK[i + 3] = -1; return; }
      if (CHK.length >= 4 * 64) { X.stats.queued++; return; }
      CHK.push(x, y, z, was);
    }
    if (Array.isArray(W.listeners)) W.listeners.push((x, y, z, was, v) => {
      if (own) return;
      // клетку заменили чем-то другим (огонь, вода, чужая правка) — её надруб и рубка больше не её (иначе новый блок «надрублен»)
      if ((KT.CUT || KT.FELL) && ((was ^ v) & 0xfff) && W.tile) { const t = W.tile(x, y, z); if (t && (t.cut || t.fs)) { delete t.cut; delete t.fs; if (!Object.keys(t).length) W.dropTile(x, y, z); } }
      if (!KT.LEAN || !st.sup || st.coopGuest) return;   // гость ничего не решает: крен и падение — у хозяина (его правки придут)
      const a = was > 0 ? st.sup.matOf(was & 0xfff) : 255, b = v > 0 ? st.sup.matOf(v & 0xfff) : 255;
      if (a === 255 && b === 255) return;
      queueCheck(x, y, z, was > 0 ? was : 0);
    });
    // обход постройки (клетки игрока, по 6 соседям) от правки: вмурована в природное сбоку / сверху, больше KT.MAXB, незагруженное —
    // «не знаю» (стоит). Опора клетки — твёрдое под ней (своё или чужое) → этажи (TP.storeys)
    const VIS = new Map(), Q = [];
    const R2 = TP.result(), BT = [], ZM = [];
    const check = (x0, y0, z0, was) => timed('check', check0, x0, y0, z0, was);
    function check0(x0, y0, z0, was){
      const code = st.sup.code, P = st.sup.P;
      VIS.clear(); Q.length = 0; B.reset();
      const seed = (x, y, z) => { const c = code(x, y, z); if ((c & 3) === 2 && c !== 5 && !VIS.has(key(x, y, z))) { VIS.set(key(x, y, z), -1); Q.push(x, y, z); } };
      seed(x0, y0, z0); seed(x0 + 1, y0, z0); seed(x0 - 1, y0, z0); seed(x0, y0 + 1, z0); seed(x0, y0 - 1, z0); seed(x0, y0, z0 + 1); seed(x0, y0, z0 - 1);
      if (!Q.length) return 0;
      let ops = 0;
      for (let h = 0; h < Q.length; h += 3) {
        const x = Q[h], y = Q[h + 1], z = Q[h + 2], c = code(x, y, z);
        ops++;
        if ((c & 3) !== 2) continue;
        if (B.n >= KT.MAXB) { X.stats.skipped++; return ops; }
        const m = c >> 2, cut = cutGet(x, y, z), left = cut ? FL.left(cut) : 512;
        const i = B.push(x - x0, y - y0, z - z0, Math.max(1, Math.floor(P.mass[m] * left / 512)));
        VIS.set(key(x, y, z), i);
        for (let k = 0; k < 6; k++) {
          const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0), nz = z + (k === 4 ? 1 : k === 5 ? -1 : 0);
          const nc = code(nx, ny, nz); ops++;
          if (nc === 5) { X.stats.skipped++; return ops; }   // незагруженное рядом — не знаем
          if ((nc & 3) === 2) { const kk = key(nx, ny, nz); if (!VIS.has(kk)) { VIS.set(kk, -1); Q.push(nx, ny, nz); } continue; }
          if (k !== 3 && (nc === 1 || (nc & 3) === 3)) { X.stats.skipped++; return ops; }   // вмурована в землю / скалу — держится ею
        }
        // опора снизу: что угодно твёрдое (своё — этаж внутри постройки, земля — основание); срез клетки сужает след
        const bc = code(x, y - 1, z);
        if (bc === 5) { X.stats.skipped++; return ops; }
        if (bc === 1 || (bc & 3) >= 2) {
          const bm = (bc & 3) >= 2 ? bc >> 2 : m, bend = Math.min(P.bend[m], P.bend[bm]) * left / 512;
          B.contact(i, Math.floor(bend), 8 * (x - x0) + FL.side(cut, 1), 8 * (x - x0) + 8 - FL.side(cut, 0), 8 * (z - z0) + FL.side(cut, 5), 8 * (z - z0) + 8 - FL.side(cut, 4));
        }
      }
      X.stats.checks++; X.stats.checkNodes += B.n;
      const SO = { sway: P.sway || 50 };
      TP.storeys(B, SO, R);
      if (R.kind < 2) return ops;
      // «держалось до»: та же постройка без правки (снятую клетку — обратно, поставленную — без веса) тоже не держала — не трогаем
      // правки той же постройки из очереди (сломали / поставили несколько за такт) — одна проверка, «до» — до них всех
      BT.length = 0; BT.push(x0, y0, z0, was);
      for (let i = 0; i < CHK.length; i += 4) {
        const x = CHK[i], y = CHK[i + 1], z = CHK[i + 2];
        let near = VIS.has(key(x, y, z)); for (let k = 0; k < 6 && !near; k++) { const v = VIS.get(key(x + (k === 0 ? 1 : k === 1 ? -1 : 0), y + (k === 2 ? 1 : k === 3 ? -1 : 0), z + (k === 4 ? 1 : k === 5 ? -1 : 0))); near = v !== undefined && v >= 0; }
        if (!near) continue;
        BT.push(x, y, z, CHK[i + 3]); CHK.splice(i, 4); i -= 4;
      }
      let cutEdit = false; for (let i = 3; i < BT.length; i += 4) if (BT[i] < 0) cutEdit = true;
      if (!cutEdit) {   // надруб — всегда «после» (это прямое действие игрока по этой постройке)
        const n0 = B.n, rm = new Set(); ZM.length = 0;
        for (let i = 0; i < BT.length; i += 4) if (BT[i + 3] > 0 && !VIS.has(key(BT[i], BT[i + 1], BT[i + 2]))) rm.add(key(BT[i], BT[i + 1], BT[i + 2]));
        for (let i = 0; i < BT.length; i += 4) {
          const x = BT[i], y = BT[i + 1], z = BT[i + 2], w = BT[i + 3], at = VIS.get(key(x, y, z));
          if (at !== undefined && at >= 0) { ZM.push(at, B.m[at], B.c[at]); B.m[at] = 0; B.c[at] = 0; continue; }   // поставили — «до» его не было
          if (!(w > 0) || B.n >= B.max) continue;
          const m = st.sup.matOf(w & 0xfff); if (m === 255) continue;
          const j = B.push(x - x0, y - y0, z - z0, P.mass[m]), bc = code(x, y - 1, z);
          if (bc === 1 || (bc & 3) >= 2 || rm.has(key(x, y - 1, z))) B.contact(j, Math.floor(P.bend[m]), 8 * (x - x0), 8 * (x - x0) + 8, 8 * (z - z0), 8 * (z - z0) + 8);
          const up = VIS.get(key(x, y + 1, z));   // клетка над снятой «до» стояла на ней (этаж внутри постройки)
          if (up !== undefined && up >= 0 && !B.c[up]) { ZM.push(up, B.m[up], 0); B.contact(up, Math.floor(P.bend[m]), 8 * (x - x0), 8 * (x - x0) + 8, 8 * (z - z0), 8 * (z - z0) + 8); }
        }
        TP.storeys(B, SO, R2);
        B.n = n0; for (let i = 0; i < ZM.length; i += 3) { B.m[ZM[i]] = ZM[i + 1]; B.c[ZM[i]] = ZM[i + 2]; }
        if (R2.kind >= 2) { X.stats.over = (X.stats.over | 0) + 1; return ops; }
        TP.storeys(B, SO, R);   // отметки «выше этажа» — заново (их перезаписала проверка «до»)
        if (R.kind < 2) return ops;
      }
      // падает часть выше слоя R.layer
      const cells = [], up = B.up;
      for (let i = 0; i < B.n; i++) if (up[i]) { const x = B.x[i] + x0, y = B.y[i] + y0, z = B.z[i] + z0; cells.push(x, y, z, W.raw(x, y, z)); }
      // тело для слота — только эта часть (порядок клеток — как в обходе: одинаково у всех)
      let j = 0; for (let i = 0; i < B.n; i++) if (up[i]) { B.x[j] = B.x[i]; B.y[j] = B.y[i]; B.z[j] = B.z[i]; B.m[j] = B.m[i]; j++; } B.n = j;
      const q = Math.max(0, Math.floor(R.over / Math.max(1, R.W)));
      const rate = Math.round(Math.min(6, 1.5 + q * .25) * DEG);
      if (R.kind === 2) X.stats.tips++; else X.stats.leans++;
      start('build', cells, null, null, R, { ox: x0, oy: y0, oz: z0, rate, kind: R.kind === 2 ? 'tip' : 'lean' });
      return ops;
    }
    const key = (x, y, z) => (x * 4096 + z) * 512 + y;

    // ═══ F2: кусок обрушения (D37E.support), стоящий на чём-то: перевесил край — опрокинуть (иначе — как было, вниз) ═══
    X.group = (cells, nat) => {
      if (!KT.LEAN || !cells.length || !st.sup) return false;
      const n = cells.length / 4; if (n > B.max || n < 2) return false;
      const P = st.sup.P, mine = new Set();
      for (let i = 0; i < cells.length; i += 4) mine.add(key(cells[i], cells[i + 1], cells[i + 2]));
      const x0 = cells[0], y0 = cells[1], z0 = cells[2];
      B.reset(); let nc = 0;
      for (let i = 0; i < n; i++) {
        const x = cells[i * 4], y = cells[i * 4 + 1], z = cells[i * 4 + 2], m = st.sup.matOf(cells[i * 4 + 3] & 0xfff);
        const k = B.push(x - x0, y - y0, z - z0, m === 255 ? 100 : P.mass[m]);
        if (!mine.has(key(x, y - 1, z)) && stopAt(x, y - 1, z)) { B.contact(k, 0, 8 * (x - x0), 8 * (x - x0) + 8, 8 * (z - z0), 8 * (z - z0) + 8); nc++; }
      }
      if (!nc) return false;
      B.plan = 0;
      TP.analyze(B, { sway: P.sway || 50 }, R);
      if (R.kind < 2) return false;
      const rate = Math.round(3 * DEG);
      if (start('build', cells, nat, null, R, { ox: x0, oy: y0, oz: z0, rate, kind: R.kind === 2 ? 'tip' : 'lean', loose: true }) < 0) return false;
      X.stats.groups++;
      return true;
    };

    // ═══ старт тела: убрать из мира (прицепленное — вещами, сундук — с собой), слот D37E.topple, сетка ═══
    const PV = { x: 0, y: 0, z: 0, d: 0 }, DV = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
    const start = (kind, cells, nat, tiles0, Rr, o) => timed('start', start0, kind, cells, nat, tiles0, Rr, o);
    function start0(kind, cells, nat, tiles0, Rr, o){
      const tA = now(), s = Wd.add(B, Rr, o);
      X.stats.ms.add = Math.max(X.stats.ms.add || 0, now() - tA);
      if (s < 0) { pend.push([kind, cells, nat, Rr.dir]); return -1; }
      const n = cells.length / 4, tiles = new Array(n).fill(null), ev = batch(true);
      own++;
      try {
        if (kind === 'build' && st.sup?.popAttached) for (let i = 0; i < n; i++) st.sup.popAttached(cells[i * 4], cells[i * 4 + 1], cells[i * 4 + 2], ev);
        for (let i = 0; i < n; i++) {
          const x = cells[i * 4], y = cells[i * 4 + 1], z = cells[i * 4 + 2];
          const tl = W.dropTile ? W.dropTile(x, y, z) : null;
          if (tl) { delete tl.cut; delete tl.fs; if (Object.keys(tl).length) { tiles[i] = tl; const U = st.ui; if (U?.isOpen?.() && U.pos && U.pos.x === x && U.pos.y === y && U.pos.z === z) U.close({ esc: true }); } }
          W.set(x, y, z, 0, { urgent: 2 });
        }
      } finally { own--; }
      ev.flush();
      X.stats.ms.remove = Math.max(X.stats.ms.remove || 0, now() - tA);
      Wd.pivot(s, PV);
      const dv = DV[Rr.dir];
      const g = st.ents?.fallGroup ? st.ents.fallGroup(cells, { x: PV.x, y: PV.y, z: PV.z }, dv, { topple: true, fast: true, cap: 16, trunk: kind === 'tree' ? (v => st.ents.treeKind(v) === 1) : null }) : null;
      X.stats.ms.view = Math.max(X.stats.ms.view || 0, now() - tA);
      bodies[s] = { kind, cells, nat, tiles, g, ox: o.ox, oy: o.oy, oz: o.oz, dir: Rr.dir, t: 0, hung: false, hold: [0, 0, 0], loose: !!o.loose, nid: 0, om: 0, lth: -1, lon: 0, loy: 0 };
      if (netOn()) { const B2 = bodies[s]; B2.nid = ++X.nid; X.netPush('b', B2.nid, kind === 'tree' ? 1 : 0, Rr.dir, Math.round(PV.x * 8), Math.round(PV.y * 8), Math.round(PV.z * 8), cells); }
      if (kind === 'build') st.AU?.play('kb_creak', { x: PV.x - st.ox, y: PV.y + 2, z: PV.z - st.oz, vol: .8, rate: .7 });
      return s;
    }

    // ═══ такт мира (20/с): проверки этажей → висящие (держатель ушёл — падают дальше) → D37E.topple → события ═══
    const OF = [0, 0], LC = [0, 0, 0];
    X.tick = () => {
      const t0 = now();
      X.stats.ticks++;
      if (st.coopGuest) { guestTick(); return; }
      X.inTick = true; try { tick0(); } finally { X.inTick = false; }
      const ms = now() - t0; X.stats.tickMs += ms; if (ms > X.stats.maxTickMs) X.stats.maxTickMs = ms;
    };
    function tick0(){
      ceilWin();
      let ops = 0;
      while (CHK.length && ops < KT.CHECK_OPS && st.sup && KT.LEAN) { const x = CHK.shift(), y = CHK.shift(), z = CHK.shift(), w = CHK.shift(); ops += check(x, y, z, w); }
      for (let s = 0; s < Wd.NS; s++) { const b = bodies[s]; if (b && b.hung && !stopAt(b.hold[0], b.hold[1], b.hold[2])) { b.hung = false; Wd.resume(s, Math.round(4 * DEG)); } }
      const busy = Wd.busy();
      if (busy) {
        for (let s = 0; s < Wd.NS; s++) { const b = bodies[s]; if (b?.g) { b.g.pth = b.g.th; b.g.pon = b.g.on; b.g.poy = b.g.oy; } }
        const ne = Wd.tick(stopAt);
        X.stats.reads += Wd.used;
        for (let e = 0; e < ne; e++) {
          const s = Wd.ev[e * 5], type = Wd.ev[e * 5 + 1], b = bodies[s]; if (!b) continue;
          if (type === 1) onHang(s, b, Wd.ev[e * 5 + 2], Wd.ev[e * 5 + 3], Wd.ev[e * 5 + 4]);
          else if (type === 2) { b.om = Wd.om[s]; Wd.drop(s, 8 * dropDist(s, b)); }
          else if (type === 3) { b.landing = X.stats.ticks; land(s, b); }
          else if (type === 4) creak(s, b);
        }
        for (let s = 0; s < Wd.NS; s++) { const b = bodies[s]; if (b?.g) { b.g.th = Wd.angle(s); Wd.offset(s, OF); b.g.on = OF[0] / 8; b.g.oy = OF[1] / 8; if (b.nid && (b.lth !== Wd.th[s] || b.lon !== OF[0] || b.loy !== OF[1])) { b.lth = Wd.th[s]; b.lon = OF[0]; b.loy = OF[1]; X.netPush('s', b.nid, b.lth, b.lon, b.loy); } } }
      }
      for (let s = 0; s < Wd.NS; s++) { const b = bodies[s]; if (b?.landing && b.landing !== X.stats.ticks && b.L) land(s, b); }   // запись по частям (со следующего такта)
      // ждущие свободного слота — по одному (никогда не теряются)
      if (pend.length && Wd.busy() < Wd.NS) retry(pend.shift());
      X.used = ops + Wd.used + landCells * 4; landCells = 0;
    }
    // §5.x: один потолок за такт (операции): постройки — проверки этажей, тела в полёте (их доля всегда есть: падение не замирает),
    // «легло»; обломкам (kubomir-debris.js) — остаток, не меньше их пола. Строка окна (20 тактов) — X.stats.ceilLine
    let landCells = 0, wStruct = 0, wDebris = 0, wDef = 0, wN = 0;
    X.used = 0;
    X.left = () => Math.max(0, KT.CEIL - X.used);
    function ceilWin(){
      const dU = st.debris?.D ? st.debris.D.used : 0;
      if (X.used > wStruct) wStruct = X.used; if (dU > wDebris) wDebris = dU;
      wDef = Wd.stats.deferred + (st.debris?.D ? st.debris.D.stats.deferred : 0);
      if (++wN >= 20) { X.stats.ceilLine = 'потолок ' + KT.CEIL + ' · постройки ' + wStruct + ' · обломки ' + wDebris + ' · отложено ' + wDef; X.stats.ceil = { cap: KT.CEIL, struct: wStruct, debris: wDebris, deferred: wDef }; if (wStruct + wDebris > (X.stats.ceilMax | 0)) X.stats.ceilMax = wStruct + wDebris; wStruct = 0; wDebris = 0; wN = 0; }
    }
    function retry(p){
      const [kind, cells, nat, dir] = p;
      // тело заново (как в group): клетки уже на месте — проверка решит снова
      if (kind === 'build') X.group(cells, nat);
    }
    function creak(s, b){
      if (b.nid) X.netPush('k', b.nid);
      Wd.pivot(s, PV);
      st.AU?.play('kb_creak', { x: PV.x - st.ox, y: PV.y + 1.5, z: PV.z - st.oz, vol: .6, rate: .75 + (b.t++ % 3) * .08 });
      const c = b.cells; st.ents?.debris?.(Math.floor(PV.x), Math.floor(PV.y), Math.floor(PV.z), c[3] & 0xfff, 3);
    }
    function onHang(s, b, hx, hy, hz){
      X.stats.hangs++;
      if (Wd.th[s] < TP.F5) { back(s, b); return; }   // крен меньше 5° — встало обратно (опёрлось сразу): клетки на место
      b.hung = true; b.hold[0] = hx; b.hold[1] = hy; b.hold[2] = hz;
      if (b.nid) X.netPush('h', b.nid);
      st.AU?.play('kb_creak', { x: hx - st.ox, y: hy, z: hz - st.oz, vol: .7, rate: .6 });
    }
    // встало на место: клетки — туда же (занято — вещью)
    function back(s, b){
      X.stats.back++;
      const c = b.cells, n = c.length / 4, ev = batch(true), xyz = [];
      own++;
      try { for (let i = 0; i < n; i++) put(c[i * 4], c[i * 4 + 1], c[i * 4 + 2], c[i * 4 + 3], b, i, ev, xyz); } finally { own--; }
      if (b.kind === 'tree') for (let k = 0; k < xyz.length; k += 3) { const x = xyz[k], y = xyz[k + 1], z = xyz[k + 2], ch = W.chunkAt ? W.chunkAt(x, z) : null; ch?.edits?.delete(((x & 15) << 11) | ((z & 15) << 7) | y); }   // дерево на месте — снова живое (генератор даст то же)
      ev.flush();
      end(s, b, xyz, false);
    }
    // сколько клеток вниз до опоры после поворота на четверть (по столбикам, ≤ 48)
    function dropDist(s, b){
      const c = b.cells, n = c.length / 4, low = new Map();
      for (let i = 0; i < n; i++) {
        if (b.kind === 'tree' && st.ents.treeKind(c[i * 4 + 3]) >= 2) continue;   // листва и тонкие ветки (станут вещами) не держат упавший ствол
        Wd.land(s, c[i * 4] - b.ox, c[i * 4 + 1] - b.oy, c[i * 4 + 2] - b.oz, LC);
        const k = (LC[0] + 4096) * 8192 + (LC[2] + 4096), y = LC[1]; if (!low.has(k) || low.get(k) > y) low.set(k, y);
      }
      let dmin = 48;
      for (const [k, y] of low) {
        const x = Math.floor(k / 8192) - 4096, z = k % 8192 - 4096;
        let d = 0; while (d < dmin && b.oy + y - d - 1 >= 1 && !stopAt(b.ox + x, b.oy + y - d - 1, b.oz + z)) { d++; X.stats.landReads++; }   // y — от начала тела: дно мира — в мировых (было y − d − 1 ≥ 1 — ствол над пнём не опускался на землю)
        if (d < dmin) dmin = d;
      }
      return dmin;
    }
    // лёг: клетки на бок (поворот на четверть + сдвиг), брёвна — поперёк, сундук — с вещами; дерево: брёвна лежат, листва — вещами
    const land = (s, b, budget) => timed('land', land0, s, b, budget);
    // запись — по KT.LAND_CELLS клеток за такт (телефон ×4: 126 клеток разом — 37 мс в одном такте); пока пишется — сетка лежит на
    // месте клеток; budget = Infinity — сразу (сохранение)
    function land0(s, b, budget = KT.LAND_CELLS){
      if (!b.L) { X.stats.lands++; const c = b.cells, n = c.length / 4; b.L = { i: 0, ev: batch(b.kind !== 'tree'),   // дерево — вещи как у прежнего падения (исчезают со временем); постройка — «keep» (как обрушение)
 xyz: [], lk: Math.min(1, 150 / Math.max(1, n)), rng: V.rng ? V.rng(V.hash ? V.hash(W.seed | 0, c[0], c[1], c[2]) : 7) : Math.random, brk: null, sp: [] };
        if (st.debris && window.KubomirDebris?.ON && budget !== Infinity) impact(s, b); }
      const c = b.cells, n = c.length / 4, L = b.L, ev = L.ev, xyz = L.xyz, lk = L.lk, rng = L.rng, i1 = Math.min(n, L.i + budget);
      own++;
      try {
        for (let i = L.i; i < i1; i++) {
          const v = c[i * 4 + 3], t = v & 0xfff, bl = V.blocks[t];
          Wd.land(s, c[i * 4] - b.ox, c[i * 4 + 1] - b.oy, c[i * 4 + 2] - b.oz, LC);
          const x = LC[0] + b.ox, y = LC[1] + b.oy, z = LC[2] + b.oz;
          if (b.kind === 'tree') {
            const k = st.ents.treeKind(v);
            if (k === 3) { const id = st.ents.leafItem?.(v, rng(), lk); if (id) ev.add(x + .5, y + .5, z + .5, { id, n: 1 }); if ((i & 7) === 0) st.ents?.debris?.(x, y, z, t, 2); continue; }
            if (k === 2) { const id = bl?.drop || bl?.name; if (id && V.item(id)) ev.add(x + .5, y + .5, z + .5, { id, n: 1 }); continue; }
          }
          let nv = v;
          if (V.T.axis[t]) nv = V.cell(t, (TP.rotAxis((v >>> 12) & 3, b.dir)) | ((v >>> 12) & ~3));
          else if (bl && bl.shape !== V.SHAPE.cube && bl.shape !== V.SHAPE.chest) { item(nv, x, y, z, ev); continue; }   // без поворота (дверь и т. п.) — вещью
          if (b.nat && b.nat[i]) { const r = bl?.name === 'stone' ? 'cobble' : bl?.name === 'grass' || bl?.name === 'snow_grass' ? 'dirt' : null; if (r && V.ID[r] !== undefined) nv = V.cell(V.ID[r], 0); }
          if (L.brk && L.brk.has(i) && !(b.tiles && b.tiles[i])) {   // F4: ударилось быстрее своей прочности — отломится и полетит вперёд (когда всё тело легло)
            const vt = Math.min(14, L.brk.get(i)), dv = DV[b.dir], h = V.hash ? V.hash(W.seed | 0, x, y, z) : 0, j = ((h & 1023) / 1023 - .5) * .2 * vt;   // вперёд — четверть скорости удара, вверх — отскок
            L.sp.push(x, y, z, nv, dv.x * vt * .25 + (dv.x ? 0 : j), vt * .15, dv.z * vt * .25 + (dv.z ? 0 : j), i, 0);
            continue;
          }
          put(x, y, z, nv, b, i, ev, xyz);
        }
      } finally { own--; }
      landCells += i1 - L.i;
      L.i = i1; if (i1 < n) return false;
      // обломки — когда всё тело записано (у гостя мир тот же: правки «легло» пришли раньше событий обломков — путь у них тот же)
      if (L.sp.length) { own++; try { for (let k = 0; k < L.sp.length; k += 9) {
        const x = L.sp[k], y = L.sp[k + 1], z = L.sp[k + 2], v = L.sp[k + 3];
        if (st.debris?.spawnCell(x, y, z, v, L.sp[k + 4], L.sp[k + 5], L.sp[k + 6])) { if (L.sp[k + 8]) X.stats.slid = (X.stats.slid | 0) + 1; else X.stats.broke = (X.stats.broke | 0) + 1; continue; }
        if (L.sp[k + 8]) item(v, x, y, z, ev); else put(x, y, z, v, b, L.sp[k + 7], ev, xyz);
      } } finally { own--; } L.sp.length = 0; }
      ev.flush();
      end(s, b, xyz, true);
      if (xyz.length && st.sup?.recheck) timed('recheck', st.sup.recheck, xyz);   // легли — держатся ли сами (v1)
      return true;
    }
    function item(v, x, y, z, ev){
      if (st.creative) return;
      const bl = V.blocks[v & 0xfff]; if (!bl) return;
      const id = bl.name === 'door_oak' ? 'door' : bl.name === 'furnace_lit' ? 'furnace' : bl.drop || bl.name;
      if (id && V.item(id)) { ev.add(x + .5, y + .4, z + .5, { id, n: 1 }); X.stats.items++; }
    }
    const blockedAt = (x, y, z) => { const p = st.P; if (p && !p.dead && p.x + .3 > x && p.x - .3 < x + 1 && p.z + .3 > z && p.z - .3 < z + 1 && p.y + 1.8 > y && p.y < y + 1) return true; return !!st.ents?.blocked?.(x, y, z); };
    function put(x, y, z, v, b, i, ev, xyz){
      const cur = W.raw(x, y, z), ct = cur > 0 ? cur & 0xfff : 0;
      const free = cur >= 0 && y >= 1 && y < V.H - 1 && (cur === 0 || V.T.liquid[ct] || V.T.shape[ct] === V.SHAPE.cross || V.T.shape[ct] === V.SHAPE.torch || (V.blocks[ct]?.replace && !V.T.solid[ct]));
      const tile = b.tiles ? b.tiles[i] : null;
      if (free && !blockedAt(x, y, z)) {
        if (cur > 0 && !V.T.liquid[ct]) item(cur, x, y, z, ev);
        W.set(x, y, z, v, { urgent: 2 }); xyz.push(x, y, z);
        if (tile) { W.tile?.(x, y, z, () => tile); if ('fuel' in tile || 'in' in tile) st.ents?.furnaces?.add(x + ',' + y + ',' + z); }
        return;
      }
      // F4: некуда лечь (занято) — обломок: сползает с кучи и ложится рядом блоком (сундук и т. п. — как было: вещами)
      if (!tile && b.kind !== 'tree' && st.debris && window.KubomirDebris?.ON && b.L && b.L.i < b.cells.length / 4) { b.L.sp.push(x, y, z, v, DV[b.dir].x * 1.5, 1.5, DV[b.dir].z * 1.5, i, 1); return; }
      item(v, x, y, z, ev);
      if (tile) for (const s2 of [...(tile.items || []), tile.in, tile.fuel, tile.out]) if (s2 && s2.n > 0) ev.add(x + .5, y + .5, z + .5, s2);
    }
    function end(s, b, xyz, loud){
      if (b.nid) X.netPush('e', b.nid, loud ? 1 : 0);
      if (b.g) st.ents?.groupEnd?.(b.g, xyz, loud);
      bodies[s] = null; Wd.free(s);
    }

    // ═══ F4: удар о землю — что отломится (скорость клетки ω·r выше прочности материала; не больше KubomirDebris.PER_LAND, самые
    // дальние от оси) и толчок вещам / обломкам рядом (Δv = J / m) ═══
    const VBRK = { stone: 7, brick: 6, concrete: 9, metal: 18, glass: 4, wood: 10, dirt: 5, sand: 4, snow: 3, slab: 9, steel: 20, rock: 7, soil: 5 };
    function impact(s, b){
      const c = b.cells, n = c.length / 4, KD = window.KubomirDebris, MT = window.D37E.support?.MATS, KS = window.KubomirSupport;
      const w = b.om * (Math.PI / 2) / TP.F90 * 80;   // рад/с в момент удара
      Wd.pivot(s, PV);
      let M = 0, Mr = 0; const cand = [];
      for (let i = 0; i < n; i++) {
        const v = c[i * 4 + 3], t = v & 0xfff, m = KS?.matOf ? KS.matOf(t) : 255, mat = MT?.[m];
        const al = b.dir < 2 ? c[i * 4] + .5 - PV.x : c[i * 4 + 2] + .5 - PV.z, up = c[i * 4 + 1] + .5 - PV.y, r = Math.sqrt(al * al + up * up);
        const kg = mat ? mat.mass : 600; M += kg; Mr += kg * r;
        if (b.kind !== 'build' || !(w > .3)) continue;
        const vb = VBRK[mat?.key] ?? 8, vt = w * r;
        if (vt >= vb && V.blocks[t]?.shape === V.SHAPE.cube) cand.push(i, r, vt);
      }
      if (cand.length) {
        const idx = []; for (let k = 0; k < cand.length; k += 3) idx.push(k);
        idx.sort((p, q) => cand[q + 1] - cand[p + 1] || cand[p] - cand[q]);
        b.L.brk = new Map(); for (let k = 0; k < idx.length && k < (KD?.PER_LAND ?? 16); k++) b.L.brk.set(cand[idx[k]], cand[idx[k] + 2]);
      }
      if (w > .3 && st.debris?.shock) {
        const mid = Math.floor(n / 2);
        Wd.land(s, c[mid * 4] - b.ox, c[mid * 4 + 1] - b.oy, c[mid * 4 + 2] - b.oz, LC);
        const J = Math.max(30, Math.min(400, M * w * (Mr / Math.max(1, M)) * .002));
        st.debris.shock(LC[0] + b.ox + .5, LC[1] + b.oy + .5, LC[2] + b.oz + .5, J, 2.5 + Math.min(4, n / 40));
      }
    }

    // ═══ F5: игра вместе. Хозяин: события с номером такта → X.netTake (kubomir-coop.js рассылает гостям после правок) ═══
    const NET = [], GQ = [], GB = new Map();
    X.nid = 0;
    const netOn = () => KT.NET && !!st.net && !st.coopGuest;
    X.netOn = netOn;
    // номер такта: внутри такта мира (тела, обломки) — этот; между тактами (удар гостя у хозяина, H.step) — следующий: у гостя
    // событие проиграется в начале того такта, где хозяин впервые его считал
    X.inTick = false;
    X.netPush = (...a) => { if (!netOn()) return; a.unshift(X.stats.ticks + (X.inTick ? 0 : 1)); NET.push(a); };
    // pv — значение блока → палитра хозяина, enc — байты → строка (base64)
    X.netTake = (pv, enc) => {
      if (!NET.length) return null;
      const out = new Array(NET.length);
      for (let k = 0; k < NET.length; k++) {
        const e = NET[k];
        if (e[1] === 'b') { const c = e[8], a = new Int32Array(c.length); for (let i = 0; i < c.length; i += 4) { a[i] = c[i]; a[i + 1] = c[i + 1]; a[i + 2] = c[i + 2]; a[i + 3] = pv(c[i + 3]); } out[k] = [e[0], 'b', e[2], e[3], e[4], e[5], e[6], e[7], enc(new Uint8Array(a.buffer))]; }
        else if (e[1] === 'd') { const f = e.slice(); f[12] = pv(e[12]); out[k] = f; }
        else out[k] = e;
      }
      NET.length = 0;
      return out;
    };
    // гость: события хозяина в очередь (toLocal — палитра, dec — строка → байты); проигрываются в такте мира по порядку, с постоянной
    // задержкой (первое событие — через 2 такта; отстали больше чем на 10 — догнать)
    let gOff = null;
    X.netIn = (list, toLocal, dec) => {
      if (!Array.isArray(list)) return;
      for (let k = 0; k < list.length && k < 8000; k++) {
        const e = list[k];
        if (!Array.isArray(e) || !Number.isInteger(e[0]) || typeof e[1] !== 'string') continue;
        if (e[1] === 'b') {
          try { const u = dec(String(e[8])), a = new Int32Array(u.buffer.slice(u.byteOffset, u.byteOffset + (u.byteLength & ~3))); if (a.length > 4 * 4096) continue;
            const cells = new Array(a.length); for (let i = 0; i < a.length; i += 4) { cells[i] = a[i]; cells[i + 1] = a[i + 1]; cells[i + 2] = a[i + 2]; cells[i + 3] = toLocal(a[i + 3] >>> 0); }
            e[8] = cells; } catch (err) { continue; }
        } else if (e[1] === 'd') e[12] = toLocal(e[12] >>> 0);
        GQ.push(e);
      }
    };
    let gHead = 0;
    function guestTick(){
      const nowT = X.stats.ticks;
      if (gHead < GQ.length) {
        if (gOff === null) gOff = nowT - GQ[gHead][0] + 2;
        if (GQ[gHead][0] + gOff < nowT - 10) gOff = nowT - GQ[gHead][0];
        while (gHead < GQ.length && GQ[gHead][0] + gOff <= nowT) { try { gApply(GQ[gHead]); } catch (e) { console.error(e); } gHead++; }
        if (gHead > 256 || gHead === GQ.length) { GQ.splice(0, gHead); gHead = 0; }
      }
      for (const [, G] of GB) { const g = G.g; g.pth = g.th; g.pon = g.on; g.poy = g.oy; g.th = G.th; g.on = G.on; g.oy = G.oy; }
    }
    function gApply(e){
      const k = e[1];
      if (k === 'b') {
        const cells = e[8]; if (!cells || !cells.length || !st.ents?.fallGroup) return;
        const g = st.ents.fallGroup(cells, { x: e[5] / 8, y: e[6] / 8, z: e[7] / 8 }, DV[e[4] & 3], { topple: true, visual: true, fast: true, cap: 16, trunk: e[3] === 1 ? (v => st.ents.treeKind(v) === 1) : null });
        if (g) GB.set(e[2] | 0, { g, th: 0, on: 0, oy: 0 });
        X.stats.netBodies = (X.stats.netBodies | 0) + 1;
      } else if (k === 's') { const G = GB.get(e[2] | 0); if (G) { G.thF = +e[3] || 0; G.th = G.thF / (TP.F90 * 4) * Math.PI * 2; G.on = (+e[4] || 0) / 8; G.oy = (+e[5] || 0) / 8; } }
      else if (k === 'k' || k === 'h') { const G = GB.get(e[2] | 0); if (G) { st.AU?.play('kb_creak', { x: G.g.px - st.ox, y: G.g.py + 1.5, z: G.g.pz - st.oz, vol: k === 'h' ? .7 : .6, rate: k === 'h' ? .6 : .75 }); if (k === 'k') st.ents?.debris?.(Math.floor(G.g.px), Math.floor(G.g.py), Math.floor(G.g.pz), G.g.cells[3] & 0xfff, 3); } }
      else if (k === 'e') { const G = GB.get(e[2] | 0); if (G) { GB.delete(e[2] | 0); st.ents?.groupEnd?.(G.g, null, !!e[3]); } }
      else if (k === 'c') {
        const x = e[2] | 0, y = e[3] | 0, z = e[4] | 0, c = e[5] | 0; if (!W.tile || !W.loaded?.(x, z)) return;
        if (c) { const t = W.tile(x, y, z, () => ({})); t.cut = c; } else { const t = W.tile(x, y, z); if (t) { delete t.cut; if (!Object.keys(t).length) W.dropTile(x, y, z); } }
        W.markTile?.(x, z); X.stats.netCuts = (X.stats.netCuts | 0) + 1;
      } else if (k === 'd' || k === 'x' || k === 'B') st.debris?.netApply?.(e.slice(1));
    }
    X.netQueue = () => GQ.length - gHead;
    X.netView = () => [...GB].map(([n, G]) => [n, G.thF | 0]);   // гость: тела хозяина на виду — [номер, угол (доли)]

    // сохранить / закрыть мир: что кренится и падает — ложится сразу (крен < 45° — встаёт обратно), висящее — тоже
    X.flush = () => {
      if (st.coopGuest) { for (const [, G] of GB) st.ents?.groupEnd?.(G.g, null, false); GB.clear(); GQ.length = 0; return 0; }
      let n = 0;
      for (let s = 0; s < Wd.NS; s++) {
        const b = bodies[s]; if (!b) continue;
        n++;
        if (!b.L && Wd.th[s] < TP.F90 / 2) { back(s, b); continue; }
        Wd.th[s] = TP.F90; Wd.ph[s] = TP.PH.LANDED;
        if (!b.L) { Wd.dropNow(s, 0); Wd.dropNow(s, 8 * dropDist(s, b)); }
        land(s, b, Infinity);
      }
      pend.length = 0; CHK.length = 0;
      return n;
    };
    X.bodies = () => bodies.filter(Boolean).map((b, i) => ({ kind: b.kind, hung: b.hung, n: b.cells.length / 4 }));
    X.busy = () => Wd.busy() + pend.length + CHK.length / 4;
    X.dispose = () => { for (let s = 0; s < Wd.NS; s++) { const b = bodies[s]; if (b?.g) st.ents?.groupEnd?.(b.g, null, false); bodies[s] = null; } Wd.clear(); pend.length = 0; CHK.length = 0; for (const [, G] of GB) st.ents?.groupEnd?.(G.g, null, false); GB.clear(); GQ.length = 0; NET.length = 0; };
    return X;
  };
})();
