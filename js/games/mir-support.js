// ═══════════════════════════════════════
//  «МИР ДЕНЧИКА» — обрушение зданий боевой зоны (T-022a, docs/PHYSICS_PLAN.md §1): ядро движка D37E.support на деталях зданий
// ═══════════════════════════════════════
// Здания из деталей с постоянными номерами (mir-zones.js modular: пол, куски стен, перемычки, подоконники, окна, колонны-углы,
// плиты крыши, бортики) — граф касаний сверху и сбоку; пол — опора. Выбили кусок стены или колонну (js/engine/destruct.js) —
// что держалось через него и больше не держится (верх над дырой: перемычки, бортики, плиты крыши, окна), осыпается частями —
// по очереди за ~1 с (тот же DS.breakId: обломки, пыль, тела убраны). По сети ничего лишнего: у каждого то же событие «сломан
// id» → тот же расчёт (целые числа, постоянный порядок; задержки — от номеров деталей) → те же куски. Через 5 минут всё как было
// (destruct.js); осыпавшееся не возвращается, пока не вернулась его опора (hold). Базы и бункер (MirZones.TOUGH) — сталь и
// железобетон: почти не осыпаются. Детский городок и столица — ничего не ломается (правило destruct.js), значит, и не осыпается.
//   M = MirSupport.attach(rt, DS) → { add(pieces), broke(b), hold(b), step(dt), stats, dispose() }
(() => {
  const SU = () => window.D37E?.support;
  const MS = window.MirSupport = window.MirSupport || {};
  // материал детали по виду; «прочные» здания — сталь
  const KIND = { wall: 'concrete', sill: 'concrete', lintel: 'concrete', pillar: 'concrete', parapet: 'concrete', roof: 'slab', window: 'glass', floor: 'steel' };
  MS.KIND = KIND;
  MS.attach = (rt, DS, o = {}) => {
    const S = SU(); if (!S || !DS) return null;
    const P = S.prof(o.mode || 'real'), TOUGH = o.tough || /bunker|^wb\d/;
    const bld = new Map();   // здание → { pieces: [...], byId: Map }
    const B = S.boxes({ max: 512 });
    const M = { stats: { events: 0, crumbles: 0, ms: 0, maxMs: 0 }, q: [], t: 0 };
    const keyOf = p => 'p:' + p.id;
    // ── детали зданий (после постройки зоны) ──
    M.add = pieces => {
      for (const p of pieces) {
        if (!p.b || !KIND[p.kind]) continue;
        let r = bld.get(p.b); if (!r) bld.set(p.b, r = { id: p.b, pieces: [], tough: TOUGH.test(p.b) });
        r.pieces.push(p);
      }
    };
    M.remove = pieces => { for (const p of pieces) bld.delete(p.b); };
    const broken = p => DS.broken.has(keyOf(p)) || M.q.some(e => e.id === p.id);   // сломана или вот-вот осыпется
    // граф здания: целые детали (+ seed — только что сломанная, «до» она на месте)
    const idx = [];
    function graph(r, seed){
      B.reset(); idx.length = 0;
      let y0 = Infinity; for (const p of r.pieces) { const b = p.y - p.h / 2; if (b < y0) y0 = b; }
      for (const p of r.pieces) {
        if (p !== seed && broken(p)) continue;
        const c = Math.cos(p.yaw || 0), s = Math.sin(p.yaw || 0), hx = Math.abs(c) * p.w / 2 + Math.abs(s) * p.d / 2, hz = Math.abs(s) * p.w / 2 + Math.abs(c) * p.d / 2;
        const key = r.tough ? 'steel' : KIND[p.kind];   // базы и бункер — сталь и бронестекло
        const i = B.add(p.x - hx, p.y - p.h / 2, p.z - hz, p.x + hx, p.y + p.h / 2, p.z + hz, S.mat(key), p.kind === 'floor' || p.y - p.h / 2 <= y0 + .15);
        if (i >= 0) idx.push(p);
      }
      B.link(.05);
      return idx;
    }
    // ── выбили деталь b (запись destruct.js: id 'p:<деталь>') — что осыпается ──
    M.broke = b => {
      const id = typeof b?.id === 'string' && b.id.startsWith('p:') ? b.id.slice(2) : null; if (!id) return 0;
      const p = rt.pieces?.get?.(id) || null; const r = p && bld.get(p.b); if (!r) return 0;
      const t0 = performance.now();
      const list = graph(r, p), si = list.indexOf(p);
      if (si < 0) return 0;
      const ng = B.collapse(P, [si]);
      const fall = [];
      for (let k = 0; k < ng; k++) for (const i of B.groups(k)) if (list[i] !== p && list[i].kind !== 'floor') fall.push(list[i]);
      // по очереди: ближние к дыре — раньше; задержка — от номеров деталей (у всех одинаково)
      fall.sort((a, c) => (Math.abs(a.x - p.x) + Math.abs(a.z - p.z) + (a.y - p.y) * .5) - (Math.abs(c.x - p.x) + Math.abs(c.z - p.z) + (c.y - p.y) * .5) || (a.id < c.id ? -1 : 1));
      fall.forEach((f, k) => { const h = S.hashStr(f.id + '|' + p.id); M.q.push({ id: f.id, at: M.t + .18 + k * .09 + (h % 100) / 1000, s: h, dx: Math.sign(f.x - p.x) || 1, dz: Math.sign(f.z - p.z) }); });
      const ms = performance.now() - t0;
      M.stats.events++; M.stats.ms += ms; if (ms > M.stats.maxMs) M.stats.maxMs = ms;
      return fall.length;
    };
    // ── шаг игры: пора — осыпать (без рассылки: у других — тот же расчёт) ──
    M.step = dt => {
      M.t += dt;
      if (!M.q.length) return;
      for (let i = 0; i < M.q.length; i++) {
        const e = M.q[i]; if (e.at > M.t) continue;
        M.q.splice(i--, 1);
        if (DS.breakId('p:' + e.id, e.s, e.dx, e.dz, true)) M.stats.crumbles++;
      }
    };
    // ── вернуть осыпавшееся можно, только если его опора уже на месте (иначе — повисло бы в воздухе) ──
    M.hold = b => {
      const id = typeof b?.id === 'string' && b.id.startsWith('p:') ? b.id.slice(2) : null; if (!id) return false;
      const p = rt.pieces?.get?.(id) || null, r = p && bld.get(p.b); if (!r || p.kind === 'floor') return false;
      const list = graph(r, p), i = list.indexOf(p); if (i < 0) return false;
      B.solve(P);
      return B.g.sup[i] < P.min[B.g.mat[i]];
    };
    M.dispose = () => { bld.clear(); M.q.length = 0; };
    M.buildings = () => bld.size;
    return M;
  };
})();
