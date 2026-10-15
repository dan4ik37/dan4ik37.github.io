// АВТОМАТИЧЕСКИ из api/_lib/raid-sim.js (node scripts/make-raid-sim.mjs) — руками не править: сервер считает бой этим же кодом.
(function(){
  var root = typeof window !== 'undefined' ? window : globalThis;
  var makeRaidSim = function makeRaidSim(){
  'use strict';
  const VER = 1;
  const C = 256, MAP = 16, OFF = 2, PN = 12, W = MAP * C, NC = MAP * MAP, HALF = C >> 1;
  const DIAG = 362;   // 256·√2
  const MAX_IN = 400;
  // поход: зёрна лагерей подобраны ботом (scripts/raid-test.cjs, «Поход»): сложность растёт плавно
  const CAMP_SEED = [1007, 1620, 2940, 4361, 1338, 1345, 1049, 1056, 3689, 1272, 2996, 4417];

  // ── Целые помощники ──
  const tr = Math.trunc;
  function isqrt(n){ if (n <= 0) return 0; let r = Math.floor(Math.sqrt(n)); while (r * r > n) r--; while ((r + 1) * (r + 1) <= n) r++; return r; }
  function rng32(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; }; }
  const isInt = v => Number.isInteger(v);
  const ticksOf = (s, tps) => Math.max(1, Math.round(s * tps));
  const pts = c => Math.round(c * C);
  const inRing = (x, z) => { const cx = tr(x / C), cz = tr(z / C); return cx < OFF || cx >= OFF + PN || cz < OFF || cz >= OFF + PN; };
  // расстояние² от точки до прямоугольника постройки
  function d2rect(x, z, b){
    const dx = x < b.x0 * C ? b.x0 * C - x : x > b.x1 * C ? x - b.x1 * C : 0;
    const dz = z < b.z0 * C ? b.z0 * C - z : z > b.z1 * C ? z - b.z1 * C : 0;
    return dx * dx + dz * dz;
  }
  const near = (x, z, b) => [x < b.x0 * C ? b.x0 * C : x > b.x1 * C ? b.x1 * C : x, z < b.z0 * C ? b.z0 * C : z > b.z1 * C ? b.z1 * C : z];

  // ── Каталог → цифры боя (точки, шаги) ──
  function unitsOf(defs){
    const tps = defs.raid?.tps || 20, out = {};
    for (const [k, U] of Object.entries(defs.u || {})) {
      out[k] = { k, sp: U.sp | 0, hp: U.hp | 0, dmg: U.dmg | 0, cd: ticksOf(U.cd || 1, tps), rng: pts(U.rng || .5), spd: Math.max(1, Math.round((U.spd || 1) * C / tps)),
        tgt: U.tgt || 'any', air: U.air ? 1 : 0, splash: U.splash ? pts(U.splash) : 0, wdmg: U.wdmg | 0, boom: U.boom ? pts(U.boom) : 0, heal: U.heal | 0, hr: U.hr ? pts(U.hr) : 0 };
    }
    return out;
  }
  function heroOf(defs, lv){
    const H = defs.hero, tps = defs.raid?.tps || 20;
    if (!H || !(lv >= 1)) return null;
    const i = Math.min(H.hp.length, lv) - 1;
    return { k: 'hero', sp: 0, hp: H.hp[i], dmg: H.dmg[i], cd: ticksOf(H.cd || 1, tps), rng: pts(H.rng || .7), spd: Math.max(1, Math.round((H.spd || 1.8) * C / tps)), tgt: H.tgt || 'any', air: 0,
      splash: 0, wdmg: 0, boom: 0, heal: 0, hr: 0, ab: H.ab[i], abr: pts(H.abr || 2) };
  }
  const fp = (D, r) => (r & 1 ? [D.d, D.w] : [D.w, D.d]);

  // ═══ Бой ═══
  function create(cfg){
    const defs = cfg.defs, tps = defs.raid?.tps || 20, MAXT = (defs.raid?.max || 180) * tps;
    const UN = unitsOf(defs), HERO = heroOf(defs, cfg.hero | 0);
    const rnd = rng32((cfg.seed | 0) ^ 0x5bd1e995);
    const bs = [], occ = new Int16Array(NC).fill(-1);
    let total = 0, th = -1;
    const layout = (Array.isArray(cfg.layout) ? cfg.layout : []).filter(it => it && isInt(it.i)).slice().sort((a, b) => a.i - b.i);
    for (const it of layout) {
      const D = defs.k?.[it.k];
      if (!D || D.g === 'deco' || !(it.l >= 1) || !isInt(it.x) || !isInt(it.z)) continue;
      const L = Math.min(D.lv, it.l), [w, d] = fp(D, it.r | 0), x0 = it.x + OFF, z0 = it.z + OFF;
      if (x0 < OFF || z0 < OFF || x0 + w > OFF + PN || z0 + d > OFF + PN) continue;
      const b = { n: bs.length, id: it.i, k: it.k, x0, z0, w, d, x1: x0 + w, z1: z0 + d, cx: (2 * x0 + w) * HALF, cz: (2 * z0 + d) * HALF, l: L,
        hp: 0, mhp: 0, alive: true, cnt: false, wall: it.k === 'wall', def: null, trap: null, busy: it.ue != null };
      if (D.trap) {
        const T = D.trap;
        b.trap = { dmg: T.dmg[L - 1] | 0, trig: pts(T.trig), sp: pts(T.sp || 0), delay: T.delay ? ticksOf(T.delay, tps) : 0, gnd: T.gnd ? 1 : 0, air: T.air ? 1 : 0, arm: -1 };
      } else {
        let clash = false;
        for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) if (occ[z * MAP + x] >= 0) clash = true;
        if (clash) continue;   // пересечение (плохие данные) — постройку не ставим
        b.hp = b.mhp = (D.hp?.[L - 1] | 0) || 1;
        b.cnt = !b.wall;
        if (D.atk) { const A = D.atk; b.def = { dmg: A.dmg[L - 1] | 0, cd: ticksOf(A.cd, tps), rng: pts(A.rng), min: pts(A.min || 0), sp: pts(A.sp || 0), fly: A.fly ? ticksOf(A.fly, tps) : 0, gnd: A.gnd ? 1 : 0, air: A.air ? 1 : 0, tg: -1, cdl: 0 }; b.def.cdl = rnd() % b.def.cd; }
        if (b.cnt) total++;
        if (it.k === 'th') th = b.n;
        for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) occ[z * MAP + x] = b.n;
      }
      bs.push(b);
    }
    const left = {};
    for (const [u, n] of Object.entries(cfg.army || {})) if (UN[u] && isInt(n) && n > 0) left[u] = Math.min(n, 999);
    // события для картинки (выстрелы, взрывы, гибель) — клиент забирает после шага; сервер без них (cfg.noEv)
    const evOn = !cfg.noEv;
    const B = {
      VER, tps, MAXT, tick: 0, over: false, why: '', end: 0, bs, us: [], shells: [], ev: [], total, th, thDead: false, dead: 0, mapv: 0,
      left, used: {}, hero: HERO ? 1 : 0, heroUsed: false, heroIdx: -1, abUsed: false, UN, HERO, occ,
    };
    const ev = e => { if (evOn) B.ev.push(e); };

    // ── Ввод ──
    B.deploy = (u, x, z) => {
      if (B.over) return 'over';
      if (!isInt(x) || !isInt(z) || x < 0 || z < 0 || x >= W || z >= W) return 'xy';
      if (!inRing(x, z)) return 'zone';
      let D;
      if (u === 'hero') { if (!HERO || B.heroUsed) return 'unit'; D = HERO; B.heroUsed = true; }
      else { if (!(B.left[u] > 0)) return 'unit'; D = UN[u]; B.left[u]--; B.used[u] = (B.used[u] || 0) + 1; }
      const o = { n: B.us.length, k: u, x, z, px: x, pz: z, hp: D.hp, mhp: D.hp, air: D.air, D, tg: -1, path: null, pi: 0, pv: 0, ob: -1, cdl: 0, alive: true, hit: -99, fx: 0, fz: 1, act: -99 };
      B.us.push(o);
      if (u === 'hero') B.heroIdx = o.n;
      ev({ e: 'spawn', u: o.n });
      return null;
    };
    B.ability = () => {
      if (B.over) return 'over';
      const h = B.us[B.heroIdx];
      if (!h || !h.alive || B.abUsed) return 'ab';
      B.abUsed = true;
      const r2 = HERO.abr * HERO.abr;
      for (const b of bs) if (b.alive && !b.trap && d2rect(h.x, h.z, b) <= r2) hurtB(b, HERO.ab);
      ev({ e: 'ab', u: h.n, x: h.x, z: h.z, r: HERO.abr });
      return null;
    };
    B.surrender = () => { if (B.over) return 'over'; finish('end'); return null; };

    function finish(why){ if (B.over) return; B.over = true; B.why = why; B.end = B.tick; }
    function hurtB(b, dmg){
      if (!b.alive || dmg <= 0) return;
      b.hp -= dmg;
      if (b.hp > 0) return;
      b.hp = 0; b.alive = false; B.mapv++;
      if (!b.trap) for (let z = b.z0; z < b.z1; z++) for (let x = b.x0; x < b.x1; x++) if (occ[z * MAP + x] === b.n) occ[z * MAP + x] = -1;
      if (b.cnt) { B.dead++; if (b.n === B.th) B.thDead = true; }
      ev({ e: 'down', b: b.n });
    }
    function hurtU(o, dmg){
      if (!o.alive || dmg <= 0) return;
      o.hp -= dmg; o.hit = B.tick;
      if (o.hp > 0) return;
      o.hp = 0; o.alive = false;
      ev({ e: 'die', u: o.n });
    }

    // ── Цели отрядов ──
    function nearest(o, ok){
      let best = null, bd = 0;
      for (const b of bs) {
        if (!b.alive || b.trap || !ok(b)) continue;
        const d = d2rect(o.x, o.z, b);
        if (!best || d < bd) { best = b; bd = d; }
      }
      return best;
    }
    function pick(o){
      const t = o.D.tgt;
      let b = null;
      if (t === 'def') b = nearest(o, x => !!x.def);
      else if (t === 'wall') b = nearest(o, x => x.wall);
      if (!b) b = nearest(o, x => x.cnt);
      return b;
    }
    const inRange = (o, b) => d2rect(o.x, o.z, b) <= o.D.rng * o.D.rng;

    // ── Путь по клеткам (Дейкстра; цена — шаги: идти или ломать то, что на пути) ──
    const dist = new Int32Array(NC), prev = new Int16Array(NC), done = new Uint8Array(NC);
    const heap = [];
    const hless = (a, b) => (a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1]);
    function hpush(e){ heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!hless(heap[i], heap[p])) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; } }
    function hpop(){ const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && hless(heap[l], heap[m])) m = l; if (r < heap.length && hless(heap[r], heap[m])) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; }
    const dmgVs = (D, b) => (b.wall && D.wdmg ? D.wdmg : D.dmg);
    function breakCost(D, b){ const dm = dmgVs(D, b); return dm > 0 ? Math.ceil(b.hp / dm) * D.cd : 1e6; }
    const N8 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 1]];
    function findPath(o, T){
      const D = o.D, so = Math.ceil(C / D.spd), sd = Math.ceil(DIAG / D.spd), r2 = D.rng * D.rng;
      const sx = Math.min(MAP - 1, tr(o.x / C)), sz = Math.min(MAP - 1, tr(o.z / C)), s = sz * MAP + sx;
      dist.fill(0x3fffffff); prev.fill(-1); done.fill(0); heap.length = 0;
      dist[s] = 0; hpush([0, s]);
      const goal = c => d2rect((c % MAP) * C + HALF, tr(c / MAP) * C + HALF, T) <= r2;
      let g = -1;
      while (heap.length) {
        const [dc, c] = hpop();
        if (done[c]) continue;
        done[c] = 1;
        if (goal(c)) { g = c; break; }
        const cx = c % MAP, cz = tr(c / MAP);
        for (const [dx, dz, dg] of N8) {
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= MAP || nz >= MAP) continue;
          const nc = nz * MAP + nx, ob = occ[nc];
          if (ob === T.n) continue;   // в цель не входим — бьём с соседней
          let cost;
          if (dg) {
            if (ob >= 0 || occ[cz * MAP + nx] >= 0 || occ[nz * MAP + cx] >= 0) continue;   // по диагонали — только мимо свободных
            cost = sd;
          } else cost = so + (ob >= 0 ? breakCost(D, bs[ob]) : 0);
          const nd = dc + cost;
          if (nd < dist[nc]) { dist[nc] = nd; prev[nc] = c; hpush([nd, nc]); }
        }
      }
      if (g < 0) return null;
      const path = [];
      for (let c = g; c >= 0; c = prev[c]) path.push(c);
      path.reverse();   // [клетка, где стоим, …, клетка у цели]
      return path;
    }
    // шаг к точке; true — дошёл
    function moveTo(o, tx, tz){
      const dx = tx - o.x, dz = tz - o.z, d2 = dx * dx + dz * dz, s = o.D.spd;
      if (d2 <= s * s) { o.x = tx; o.z = tz; if (d2) { o.fx = dx; o.fz = dz; } return true; }
      const d = isqrt(d2);
      o.x += tr(dx * s / d); o.z += tr(dz * s / d); o.fx = dx; o.fz = dz;
      return false;
    }
    function hitB(o, b){
      o.act = B.tick;
      const D = o.D;
      if (D.boom) {   // подрывник: взрыв — стенам wdmg, постройкам dmg, сам погибает
        const r2 = D.boom * D.boom;
        for (const x of bs) if (x.alive && !x.trap && d2rect(o.x, o.z, x) <= r2) hurtB(x, x.wall ? D.wdmg : D.dmg);
        ev({ e: 'boom', u: o.n, x: o.x, z: o.z, r: D.boom });
        o.hp = 0; o.alive = false; ev({ e: 'die', u: o.n });
        return;
      }
      if (D.splash) {
        const [px, pz] = near(o.x, o.z, b), r2 = D.splash * D.splash;
        for (const x of bs) if (x.alive && !x.trap && (x === b || d2rect(px, pz, x) <= r2)) hurtB(x, dmgVs(D, x));
        ev({ e: 'bomb', u: o.n, x: px, z: pz });
      } else { hurtB(b, dmgVs(D, b)); ev({ e: 'hit', u: o.n, b: b.n }); }
      o.cdl = D.cd;
    }
    function unitStep(o){
      const D = o.D;
      o.px = o.x; o.pz = o.z;
      if (o.cdl > 0) o.cdl--;
      if (D.tgt === 'heal') return healStep(o);
      let T = o.tg >= 0 ? bs[o.tg] : null;
      if (!T || !T.alive) { T = pick(o); o.tg = T ? T.n : -1; o.path = null; if (!T) return; }
      if (inRange(o, T)) { if (!o.cdl) hitB(o, T); return; }
      if (o.air) { moveTo(o, T.cx, T.cz); return; }
      if (!o.path || (o.ob >= 0 && o.pv !== B.mapv)) { o.path = findPath(o, T); o.pi = 0; o.pv = B.mapv; o.ob = -1; if (!o.path) return; }
      const c = o.path[o.pi];
      if (c === undefined) { o.path = null; return; }
      const ob = occ[c];
      if (ob >= 0 && ob !== T.n) {
        const O = bs[ob];
        o.ob = ob;
        if (inRange(o, O)) { if (!o.cdl) hitB(o, O); return; }
        const p0 = o.path[Math.max(0, o.pi - 1)];
        moveTo(o, (p0 % MAP) * C + HALF, tr(p0 / MAP) * C + HALF);   // не достаёт — к центру своей клетки
        return;
      }
      o.ob = -1;
      if (moveTo(o, (c % MAP) * C + HALF, tr(c / MAP) * C + HALF)) o.pi++;
    }
    function healStep(o){
      const D = o.D;
      let best = null, bk = 0, bd = 0;
      for (const u of B.us) {
        if (!u.alive || u.air) continue;
        const k = tr(u.hp * 1000 / u.mhp), dx = u.x - o.x, dz = u.z - o.z, d = dx * dx + dz * dz;
        if (!best || k < bk || (k === bk && d < bd)) { best = u; bk = k; bd = d; }
      }
      if (!best) return;
      const dx = best.x - o.x, dz = best.z - o.z;
      if (dx * dx + dz * dz > C * C) moveTo(o, best.x, best.z);
      if (!o.cdl) {
        const r2 = D.hr * D.hr;
        let any = false;
        for (const u of B.us) if (u.alive && !u.air && u.hp < u.mhp && (u.x - o.x) * (u.x - o.x) + (u.z - o.z) * (u.z - o.z) <= r2) { u.hp = Math.min(u.mhp, u.hp + D.heal); any = true; }
        if (any) ev({ e: 'heal', u: o.n });
        o.cdl = D.cd;
      }
    }

    // ── Оборона, снаряды, ловушки ──
    function defOk(b, u){
      if (!u.alive || (u.air ? !b.def.air : !b.def.gnd)) return false;
      const dx = u.x - b.cx, dz = u.z - b.cz, d = dx * dx + dz * dz;
      return d <= b.def.rng * b.def.rng && d >= b.def.min * b.def.min;
    }
    function defStep(b){
      const A = b.def;
      if (A.cdl > 0) A.cdl--;
      let u = A.tg >= 0 ? B.us[A.tg] : null;
      if (!u || !defOk(b, u)) {
        u = null; let bd = 0;
        for (const x of B.us) { if (!defOk(b, x)) continue; const dx = x.x - b.cx, dz = x.z - b.cz, d = dx * dx + dz * dz; if (!u || d < bd) { u = x; bd = d; } }
        A.tg = u ? u.n : -1;
      }
      if (!u || A.cdl) return;
      A.cdl = A.cd;
      if (A.fly) {
        const sx = u.x + (rnd() % 129) - 64, sz = u.z + (rnd() % 129) - 64;
        B.shells.push({ x: sx, z: sz, land: B.tick + A.fly, dmg: A.dmg, sp: A.sp, b: b.n, t0: B.tick });
        ev({ e: 'shell', b: b.n, x: sx, z: sz, t: A.fly });
      } else {
        ev({ e: 'shot', b: b.n, u: u.n });
        hurtU(u, A.dmg);
      }
    }
    function shellStep(){
      for (let i = 0; i < B.shells.length; i++) {
        const s = B.shells[i];
        if (s.land > B.tick) continue;
        const r2 = s.sp * s.sp;
        for (const u of B.us) if (u.alive && !u.air && (u.x - s.x) * (u.x - s.x) + (u.z - s.z) * (u.z - s.z) <= r2) hurtU(u, s.dmg);
        ev({ e: 'blast', x: s.x, z: s.z, r: s.sp });
        B.shells.splice(i--, 1);
      }
    }
    function trapStep(b){
      const P = b.trap, r2 = P.trig * P.trig;
      if (P.air) {   // воздушная мина: ближайший летающий в радиусе
        let u = null, bd = 0;
        for (const x of B.us) { if (!x.alive || !x.air) continue; const d = (x.x - b.cx) * (x.x - b.cx) + (x.z - b.cz) * (x.z - b.cz); if (d <= r2 && (!u || d < bd)) { u = x; bd = d; } }
        if (!u) return;
        b.alive = false; ev({ e: 'trap', b: b.n, x: b.cx, z: b.cz });
        hurtU(u, P.dmg);
        return;
      }
      if (P.arm < 0) {
        for (const x of B.us) if (x.alive && !x.air && (x.x - b.cx) * (x.x - b.cx) + (x.z - b.cz) * (x.z - b.cz) <= r2) { P.arm = B.tick + P.delay; ev({ e: 'arm', b: b.n }); break; }
        if (P.arm < 0 || P.arm > B.tick) return;
      } else if (P.arm > B.tick) return;
      const s2 = P.sp * P.sp;
      b.alive = false; ev({ e: 'trap', b: b.n, x: b.cx, z: b.cz, r: P.sp });
      for (const x of B.us) if (x.alive && !x.air && (x.x - b.cx) * (x.x - b.cx) + (x.z - b.cz) * (x.z - b.cz) <= s2) hurtU(x, P.dmg);
    }

    // ── Шаг боя ──
    B.step = () => {
      if (B.over) return;
      shellStep();
      for (const b of bs) if (b.alive && b.trap) trapStep(b);
      for (const b of bs) if (b.alive && b.def && !b.busy) defStep(b);
      for (const o of B.us) if (o.alive) unitStep(o);
      B.tick++;
      if (B.dead >= B.total) finish('all');
      else if (B.tick >= MAXT) finish('time');
      else if (!B.us.some(o => o.alive) && !Object.values(B.left).some(n => n > 0) && (!B.hero || B.heroUsed) && B.us.length) finish('army');
    };
    // Итог (для экрана — сразу, для сервера — после run)
    B.result = () => {
      const pct = B.total ? Math.floor(B.dead * 100 / B.total) : 0;
      const stars = (pct >= 50 ? 1 : 0) + (B.thDead ? 1 : 0) + (pct >= 100 ? 1 : 0);
      return { ver: VER, stars, pct, th: B.thDead, ticks: B.over ? B.end : B.tick, why: B.why, destroyed: bs.filter(b => !b.alive && b.cnt).map(b => b.id),
        used: { ...B.used }, hero: B.heroUsed, ab: B.abUsed, deployed: B.us.length };
    };
    // Сверка (тесты): всё, что влияет на бой
    B.hash = () => {
      let h = 2166136261 >>> 0;
      const mix = v => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
      mix(B.tick);
      for (const o of B.us) { mix(o.x); mix(o.z); mix(o.hp); mix(o.tg); }
      for (const b of bs) { mix(b.hp); mix(b.alive ? 1 : 0); if (b.def) mix(b.def.tg); }
      return h;
    };
    return B;
  }

  // ═══ Весь бой по вводу (сервер, повтор, тесты) ═══
  // Форма ввода: массив до 400 записей, t — целые по возрастанию; {t, u, x, z} — высадка, {t, a: 1} — удар героя, {t, s: 1} — сдаться
  function check(inputs, maxT){
    if (!Array.isArray(inputs)) return 'shape';
    if (inputs.length > MAX_IN) return 'many';
    let t0 = 0;
    for (let i = 0; i < inputs.length; i++) {
      const e = inputs[i];
      if (!e || typeof e !== 'object' || Array.isArray(e)) return 'shape';
      const keys = Object.keys(e);
      if (!isInt(e.t) || e.t < t0 || e.t > maxT) return 'tick';
      t0 = e.t;
      if (typeof e.u === 'string') { if (!(e.u.length <= 12) || !isInt(e.x) || !isInt(e.z) || keys.length !== 4) return 'shape'; }
      else if (e.a === 1) { if (keys.length !== 2) return 'shape'; }
      else if (e.s === 1) { if (keys.length !== 2 || i !== inputs.length - 1) return 'shape'; }
      else return 'shape';
    }
    return null;
  }
  function run(cfg, inputs){
    const B = create({ ...cfg, noEv: !cfg.ev }), bad = check(inputs, B.MAXT);
    if (bad) return { ok: false, reason: bad };
    let i = 0;
    while (!B.over) {
      while (i < inputs.length && inputs[i].t === B.tick) {
        const e = inputs[i], why = e.u != null ? B.deploy(e.u, e.x, e.z) : e.a ? B.ability() : B.surrender();
        if (why) return { ok: false, reason: why, at: i };
        i++;
      }
      if (B.over) break;
      if (i >= inputs.length && !B.us.length) break;   // ни одной высадки — бой не начался
      B.step();
    }
    if (i < inputs.length) return { ok: false, reason: 'late', at: i };
    return { ok: true, ...B.result(), hash: B.hash() };
  }

  // ═══ Базы разбойников: 0 — учебная, 1…12 — поход, 101…105 — под ратушу (вариант 0…3) ═══
  function bot(level, defs, variant = 0){
    const R = defs.raid || {}, K = defs.k || {};
    let th, pw, seed, tut = false;
    if (level === 0) { th = 1; pw = 0; seed = 7; tut = true; }
    else if (isInt(level) && level >= 1 && level <= (R.campTh || []).length) {
      th = R.campTh[level - 1];
      const grp = R.campTh.map((t, i) => [t, i]).filter(([t]) => t === th).map(([, i]) => i);
      pw = grp.length > 1 ? grp.indexOf(level - 1) / (grp.length - 1) : .5;
      seed = CAMP_SEED[level - 1] ?? 1000 + level * 7;
    } else if (isInt(level) && level >= 101 && level <= 105) { th = level - 100; pw = .45; seed = 5000 + level * 10 + ((variant | 0) & 3); }
    else return null;
    return gen(K, th, pw, seed, tut);
  }
  function gen(K, th, pw, seed, tut){
    const r = rng32(seed), ri = n => (n > 0 ? r() % n : 0);
    const L = [], occ = new Uint8Array(PN * PN);
    let seq = 0;
    const lvOf = k => { const D = K[k]; if (!D) return 1; const top = Math.min(D.lv, th); return Math.max(1, top - (ri(100) < Math.round((1 - pw) * 55) ? 1 : 0)); };
    const fits = (x, z, w, d) => { if (x < 0 || z < 0 || x + w > PN || z + d > PN) return false; for (let j = z; j < z + d; j++) for (let i = x; i < x + w; i++) if (occ[j * PN + i]) return false; return true; };
    const put = (k, x, z, l) => { const D = K[k]; if (!D) return false; const [w, d] = [D.w, D.d]; if (!fits(x, z, w, d)) return false; for (let j = z; j < z + d; j++) for (let i = x; i < x + w; i++) occ[j * PN + i] = 1; L.push({ i: ++seq, k, x, z, r: 0, l: l || lvOf(k) }); return true; };
    const maxOf = k => (K[k]?.max?.[th - 1] | 0);
    const shuffled = list => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
    // дом (5×5) — в углу, ратуша — ближе к середине
    const hc = [[0, 0], [PN - 5, 0], [0, PN - 5], [PN - 5, PN - 5]][ri(4)];
    put('house', hc[0], hc[1]);
    let tx = 4 + ri(2), tz = 4 + ri(2);
    if (!put('th', tx, tz, th)) for (const [x, z] of [[4, 4], [5, 5], [4, 5], [5, 4], [3, 4], [4, 3], [6, 4], [4, 6], [3, 3], [6, 6], [3, 6], [6, 3]]) if (put('th', x, z, th)) { tx = x; tz = z; break; }
    // оборона — вокруг ратуши
    const ring = [];
    for (let z = tz - 3; z <= tz + 4; z++) for (let x = tx - 3; x <= tx + 4; x++) ring.push([x, z]);
    const cnt = (k, f) => Math.max(0, Math.min(maxOf(k), Math.round(maxOf(k) * f)));
    const defs = [];
    for (const k of ['cannon', 'tower', 'mortar']) { const n = tut ? (k === 'cannon' ? 1 : 0) : cnt(k, .65 + .35 * pw); for (let i = 0; i < n; i++) defs.push(k); }
    for (const k of defs) for (const [x, z] of shuffled(ring)) if (put(k, x, z)) break;
    // забор — кольцо вокруг ядра (не хватает заборов — с проходами; дом — часть кольца)
    let x0 = PN, z0 = PN, x1 = 0, z1 = 0;
    for (const it of L) { if (it.k === 'house') continue; const D = K[it.k]; x0 = Math.min(x0, it.x); z0 = Math.min(z0, it.z); x1 = Math.max(x1, it.x + D.w); z1 = Math.max(z1, it.z + D.d); }
    x0 = Math.max(0, x0 - 1); z0 = Math.max(0, z0 - 1); x1 = Math.min(PN, x1 + 1); z1 = Math.min(PN, z1 + 1);
    const per = [];
    for (let x = x0; x < x1; x++) per.push([x, z0]);
    for (let z = z0 + 1; z < z1; z++) per.push([x1 - 1, z]);
    for (let x = x1 - 2; x >= x0; x--) per.push([x, z1 - 1]);
    for (let z = z1 - 2; z > z0; z--) per.push([x0, z]);
    let walls = tut ? 8 : Math.min(maxOf('wall'), Math.round(maxOf('wall') * (.45 + .5 * pw)));
    const start = ri(per.length), wl = Math.max(1, Math.min(K.wall?.lv || 1, th) - (pw < .5 && th > 1 ? 1 : 0));
    for (let i = 0; i < per.length && walls > 0; i++) { const [x, z] = per[(start + i) % per.length]; if (put('wall', x, z, wl)) walls--; }
    // ловушки — внутри кольца
    const inner = [];
    for (let z = z0 + 1; z < z1 - 1; z++) for (let x = x0 + 1; x < x1 - 1; x++) inner.push([x, z]);
    for (const k of ['bomb', 'airmine']) { let n = tut ? 0 : cnt(k, .5 + .5 * pw); for (const [x, z] of shuffled(inner)) { if (n <= 0) break; if (put(k, x, z)) n--; } }
    // шахты, склады, казарма, мастерская — снаружи, где влезет
    const all = [];
    for (let z = 0; z < PN; z++) for (let x = 0; x < PN; x++) all.push([x, z]);
    const rest = [];
    for (const k of ['mine', 'store', 'barracks', 'shop']) { const n = Math.min(maxOf(k), tut ? (k === 'mine' || k === 'store' ? 1 : 0) : Math.max(1, cnt(k, .7 + .3 * pw))); for (let i = 0; i < n; i++) rest.push(k); }
    const spots = shuffled(all);
    for (const k of rest) for (const [x, z] of spots) if (put(k, x, z)) break;
    return L;
  }

  // ═══ Добыча, кубки, итог — те же формулы, что в raids.sql (тест PGlite сверяет) ═══
  const thOf = L => { const t = (L || []).find(it => it.k === 'th'); return t ? Math.max(1, t.l | 0) : 1; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function league(defs, tr){ const L = defs.raid.league; let i = 0; while (i + 1 < L.length && (tr | 0) >= L[i + 1]) i++; return i; }
  // кирпичи в шахте сейчас (как Rules.prod / base_prod)
  function prodNow(defs, it, now){
    const M = defs.k.mine;
    if (it.k !== 'mine' || !(it.l >= 1) || it.ue != null) return 0;
    return Math.min(M.hold[it.l - 1], Math.floor(M.rate[it.l - 1] * Math.max(0, now - (it.t0 ?? now)) / 3600));
  }
  // Сколько можно взять (снимок на начало набега): st — доли склада (ратуша и склады), mn — шахт; base = { layout, bricks }
  function offer(defs, base, attTh, now){
    const R = defs.raid.loot, K = defs.k, L = base.layout || [], dth = thOf(L);
    let prot = R.prot[dth - 1];
    const stores = L.filter(it => it.k === 'store' && it.l >= 1).sort((a, b) => a.i - b.i);
    for (const s of stores) prot += R.sprot[Math.min(s.l, R.sprot.length) - 1];
    const free = Math.max(0, (base.bricks | 0) - prot);
    const pct = attTh > dth ? Math.max(R.min, R.pct - R.step * (attTh - dth)) : R.pct;
    const pool = Math.min(R.cap[dth - 1], Math.floor(free * pct / 100));
    const st = {}, mn = {}, th = L.find(it => it.k === 'th');
    if (th && pool > 0) {
      const thS = stores.length ? Math.floor(pool * R.th / 100) : pool;
      if (thS > 0) st[th.i] = thS;
      let rest = pool - thS;
      const sum = stores.reduce((a, s) => a + K.store.keep[s.l - 1], 0);
      let given = 0;
      for (const s of stores) { const v = Math.floor(rest * K.store.keep[s.l - 1] / sum); if (v > 0) st[s.i] = v; given += v; }
      if (stores.length && rest - given > 0) st[stores[0].i] = (st[stores[0].i] || 0) + rest - given;
    }
    for (const it of L.slice().sort((a, b) => a.i - b.i)) if (it.k === 'mine') { const v = Math.floor(prodNow(defs, it, now) * R.mine / 100); if (v > 0) mn[it.i] = v; }
    const total = Object.values(st).reduce((a, b) => a + b, 0) + Object.values(mn).reduce((a, b) => a + b, 0);
    return { th: dth, prot, pct, pool, st, mn, total };
  }
  // Кубки: win — за 3★ (за меньше — долю, вверх), lose — за поражение
  function trophies(defs, attTr, defTr, stars){
    const T = defs.raid.tr;
    const win = clamp(T.win + tr((defTr - attTr) / T.wdiv), T.wmin, T.wmax), lose = clamp(T.lose + tr((attTr - defTr) / T.ldiv), T.lmin, T.lmax);
    return { win, lose, delta: stars > 0 ? Math.ceil(win * stars / 3) : -lose };
  }
  // Итог набега на игрока (как raid_settle): o — offer со старта, res — итог боя, x — что сейчас на сервере:
  // { attTh, attTr, defTr, lootDay, pair, alt, attBricks, attCap, defBricks, defProt, mines: {id: в шахте сейчас} }
  function settle(defs, o, res, x){
    const R = defs.raid, dead = new Set(res.destroyed || []);
    let st = 0;
    for (const [id, v] of Object.entries(o.st || {})) if (dead.has(+id)) st += v;
    st = Math.min(st, Math.max(0, (x.defBricks | 0) - (x.defProt | 0)));
    const ids = Object.keys(o.mn || {}).map(Number).sort((a, b) => a - b), mines = {};
    for (const id of ids) if (dead.has(id)) mines[id] = Math.min(o.mn[id], Math.max(0, x.mines?.[id] | 0));
    const zero = !!(x.alt || x.pair);
    if (zero) { st = 0; for (const id of Object.keys(mines)) mines[id] = 0; }
    let left = Math.max(0, R.loot.day[x.attTh - 1] - (x.lootDay | 0));
    st = Math.min(st, left); left -= st;
    for (const id of ids) if (id in mines) { mines[id] = Math.min(mines[id], left); left -= mines[id]; }
    for (const id of Object.keys(mines)) if (!mines[id]) delete mines[id];
    const total = st + Object.values(mines).reduce((a, b) => a + b, 0);
    const T = zero ? { win: 0, lose: 0, delta: 0 } : trophies(defs, x.attTr | 0, x.defTr | 0, res.stars | 0);
    const bonus = !zero && res.stars > 0 ? Math.floor(R.bonus[league(defs, x.attTr)] * res.stars / 3) : 0;
    const added = Math.min(Math.max(0, (x.attCap | 0) - (x.attBricks | 0)), total + bonus);
    return { st, mines, total, bonus, added, tr: T.delta, attTr: Math.max(0, (x.attTr | 0) + T.delta), defTr: Math.max(0, (x.defTr | 0) - T.delta), zero };
  }
  // Награда за разбойников: bot — под ратушу (3 раза в день), camp — новые звёзды похода, tut — учебный (один раз)
  function pve(defs, mode, lv, stars, x){
    const R = defs.raid;
    if (mode === 'bot') return (x.bots | 0) < R.day.bots ? Math.floor(R.bot[Math.min(5, Math.max(1, lv)) - 1] * stars / 3) : 0;
    if (mode === 'camp') { const c = R.camp[lv - 1] | 0, best = Math.min(3, x.best | 0); return stars > best ? Math.floor(c * stars / 3) - Math.floor(c * best / 3) : 0; }
    if (mode === 'tut') return !x.tut && stars > 0 ? R.tut : 0;
    return 0;
  }

  return { VER, C, MAP, OFF, PN, W, DIAG, isqrt, rng32, inRing, unitsOf, heroOf, create, check, run, bot, thOf, league, prodNow, offer, trophies, settle, pve, _gen: gen, CAMP_SEED };
};
  root.makeRaidSim = makeRaidSim;
  root.RaidSim = makeRaidSim();
})();
