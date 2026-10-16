// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — разрушения (D37E.destruct), этап 1: деревья валятся и бьются на брёвна, столбы, скамейки, заборы,
//  ящики, мешки — на куски, стекло — осколками. Обломки — только у себя (пулы экземпляров: 4 вызова отрисовки на все,
//  жёсткий предел, сон, исчезают); по сети — событие «сломан id» с зерном; через N минут всё как было.
// ═══════════════════════════════════════
// DS = D37E.destruct(R, ph, { fx, sfx, rule(b) → 'none' | 'small' | 'all', restore (мин), cap })
//   DS.add(b) — ломаемое: { id, kind, x, y, z, h, r | w, d, yaw, c, c2, hp, small, hide(on), bodies: [], onBreak }
//     kind: tree | pine | pole | lamp | bench | fence | sign | crate | bag | barrel | glass | prop
//   DS.hit(x, z, r, dmg, o) — удар/выстрел/взрыв: урон всему в радиусе (o: { y, dx, dz, by, kinds }); сломалось — события
//   DS.ahead(x, z, r, power) — что можно сломать машиной силы power (1 — машина, 2 — танк/грузовик) у точки
//   DS.breakId(id, seed, dx, dz, remote) — сломать; из сети — remote: без повторной рассылки (DS.onBreak — только своё)
//   DS.debris(o) — свой обломок; DS.update(dt) — раз в кадр; DS.stats(); DS.dispose()
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const PI = Math.PI;
  // зерно → случайные числа (одинаковые у всех игроков для одного события)
  const rng = s => { let a = s >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  // что считается «мелочью» (во взрослом городе ломается только она)
  const SMALL = new Set(['tree', 'pine', 'pole', 'lamp', 'bench', 'fence', 'sign', 'crate', 'bag', 'barrel', 'prop']);
  // сколько нужно силы машины: деревья — только танк/грузовик (2), остальное — любая машина на скорости (1)
  // wall — кусок стены здания из деталей (боевая зона): выбит — дыра, здание стоит (крыша — на углах), тело куска убрано;
  // block — бетонный блок-укрытие. «Прочные» (бункер, базы) — свои b.hp и b.power при добавлении (танк не пробьёт, только взрывы)
  const POWER = { tree: 2, pine: 2, pole: 1, lamp: 1, bench: 1, fence: 1, sign: 1, crate: 1, bag: 1, barrel: 1, prop: 1, glass: 1, wall: 2, block: 3 };
  const HP = { tree: 4, pine: 4, pole: 2, lamp: 2, bench: 2, fence: 1, sign: 1, crate: 2, bag: 2, barrel: 2, prop: 2, glass: 1, wall: 5, block: 8 };

  E.destruct = function (R, ph, o = {}){
    const T = R.T, low = R.q === 'low', mob = !!E.isMobile?.();
    const CAP = o.cap || (low ? 36 : mob ? 60 : 120), RESTORE = (o.restore ?? 5) * 60, G = 26;
    const DS = { list: new Map(), grid: new Map(), broken: new Map(), onBreak: null, t: 0, rule: o.rule || (() => 'all') };
    const cellOf = (x, z) => Math.floor(x / 24) + ',' + Math.floor(z / 24);

    // ── Пулы обломков: InstancedMesh на форму (кубик, цилиндр, «облако», осколок стекла) ──
    const grp = new T.Group(); grp.name = 'destruct'; R.scene.add(grp);
    const mat = low ? new T.MeshLambertMaterial({ color: '#ffffff' }) : new T.MeshStandardMaterial({ color: '#ffffff', roughness: .85, metalness: 0 });
    const glassM = new T.MeshStandardMaterial({ color: '#cfeeff', roughness: .1, metalness: 0, transparent: true, opacity: .55, depthWrite: false });
    const GEO = { box: new T.BoxGeometry(1, 1, 1), cyl: new T.CylinderGeometry(.5, .5, 1, 8), ico: new T.IcosahedronGeometry(.5, 0), shard: new T.BoxGeometry(1, 1, 1) };
    GEO.cyl.computeBoundingSphere();
    const SIZE = { box: CAP, cyl: Math.ceil(CAP * .5), ico: Math.ceil(CAP * .4), shard: Math.ceil(CAP * .5) };
    const pools = {};
    for (const k of Object.keys(GEO)) {
      const im = new T.InstancedMesh(GEO[k], k === 'shard' ? glassM : mat, SIZE[k]);
      im.count = 0; im.frustumCulled = false; im.userData.dyn = true; im.castShadow = !low && k !== 'shard'; im.receiveShadow = !low;
      if (k !== 'shard') im.setColorAt(0, new T.Color('#ffffff'));
      grp.add(im);
      pools[k] = { im, n: SIZE[k], items: [] };
    }
    const M4 = new T.Matrix4(), Q = new T.Quaternion(), Qa = new T.Quaternion(), V3 = new T.Vector3(), S3 = new T.Vector3(), AX = new T.Vector3(), COL = new T.Color(), UP = new T.Vector3(0, 1, 0);
    // обломок: свободное место пула или самый старый (предел жёсткий)
    function piece(shape, p){
      const P = pools[shape] || pools.box;
      let it = P.items.find(x => !x.on);
      if (!it) {
        if (P.items.length < P.n) { it = { i: P.items.length, q: new T.Quaternion() }; P.items.push(it); P.im.count = P.items.length; }
        else it = P.items.reduce((a, b) => (a.born < b.born ? a : b));   // самый старый уступает место
      }
      Object.assign(it, { on: true, born: DS.t, x: p.x, y: p.y, z: p.z, vx: p.vx || 0, vy: p.vy || 0, vz: p.vz || 0, sx: p.sx || .3, sy: p.sy || .3, sz: p.sz || .3,
        av: p.av ?? 4, ax: p.ax || Math.random() - .5, az: p.az || Math.random() - .5, life: p.life ?? (low ? 6 : 12), sleep: 0, asleep: false, k: 1, bounce: p.bounce ?? .25, fixed: !!p.fixed, shape });
      it.q.copy(p.q || Q.identity());
      if (shape !== 'shard') P.im.setColorAt(it.i, COL.set(p.c || '#8b5a2b'));
      if (P.im.instanceColor) P.im.instanceColor.needsUpdate = true;
      write(P, it);
      return it;
    }
    function write(P, it){
      const s = it.k;
      M4.compose(V3.set(it.x, it.y, it.z), it.q, S3.set(it.sx * s, it.sy * s, it.sz * s));
      P.im.setMatrixAt(it.i, M4); P.im.instanceMatrix.needsUpdate = true;
    }
    function hidePiece(P, it){ it.on = false; M4.makeScale(0, 0, 0); P.im.setMatrixAt(it.i, M4); P.im.instanceMatrix.needsUpdate = true; }
    DS.debris = (p) => piece(p.shape || 'box', p);
    const groundY = (x, z, y) => (ph?.supportAt ? ph.supportAt(x, z, .1, y + .3).y : ph?.groundAt ? ph.groundAt(x, z) : 0);

    // ── Падающее (дерево, столб): поворот вокруг основания, ускоряется, упал — пыль и куски ──
    const fallers = [];
    function faller(b, seed, dx, dz){
      const r = rng(seed), L = b.h || 4, parts = [];
      const add = (shape, lx, ly, lz, sx, sy, sz, c) => { const it = piece(shape, { x: b.x, y: b.y, z: b.z, sx, sy, sz, c, fixed: true, life: 99 }); parts.push({ it, o: [lx, ly, lz] }); return it; };
      if (b.kind === 'tree' || b.kind === 'pine') {
        const tr = b.r || .3, th = L * .45;
        add('cyl', 0, th / 2, 0, tr * 2, th, tr * 2, '#7a4f2c');
        if (b.kind === 'pine') { add('ico', 0, th + L * .2, 0, L * .42, L * .5, L * .42, b.c2 || '#2f7d4a'); add('ico', 0, th + L * .45, 0, L * .3, L * .38, L * .3, b.c2 || '#2f7d4a'); }
        else { add('ico', 0, th + L * .2, 0, L * .55, L * .45, L * .55, b.c2 || '#4ea544'); add('ico', (r() - .5) * L * .3, th + L * .38, (r() - .5) * L * .3, L * .4, L * .35, L * .4, b.c2 || '#62b84f'); }
      } else {   // столб/фонарь/знак
        add('cyl', 0, L / 2, 0, .2, L, .2, b.c || '#2d2a3a');
        if (b.kind === 'lamp') add('ico', 0, L, 0, .5, .5, .5, '#fff3b0');
        if (b.kind === 'sign') add('box', 0, L * .85, 0, 1.6, .7, .1, b.c2 || '#7c3aed');
      }
      const l = Math.hypot(dx, dz) || 1;
      fallers.push({ b, parts, x: b.x, y: b.y, z: b.z, dx: dx / l, dz: dz / l, th: .04, w: .5 + r() * .4, L, seed });
    }
    function stepFaller(F, dt){
      F.w += 1.5 * G / Math.max(1, F.L) * Math.sin(F.th + .05) * dt * .55;
      F.th = Math.min(PI / 2, F.th + F.w * dt);
      AX.set(F.dz, 0, -F.dx).normalize(); Qa.setFromAxisAngle(AX, F.th);
      for (const p of F.parts) {
        V3.set(p.o[0], p.o[1], p.o[2]).applyQuaternion(Qa);
        p.it.x = F.x + V3.x; p.it.y = F.y + V3.y; p.it.z = F.z + V3.z; p.it.q.copy(Qa);
        write(pools[p.it.shape], p.it);
      }
      if (F.th >= PI / 2 - .02) return landFaller(F);
      return false;
    }
    function landFaller(F){
      const r = rng(F.seed + 7), tip = [F.x + F.dx * F.L * .7, F.z + F.dz * F.L * .7];
      for (const p of F.parts) {   // ствол — брёвна, крона — летит и тает
        const P = pools[p.it.shape];
        if (p.it.shape === 'cyl' && (F.b.kind === 'tree' || F.b.kind === 'pine')) {
          hidePiece(P, p.it);
          const n = 3, seg = F.L * .45 / n, tr = F.b.r || .3;
          Qa.setFromUnitVectors(UP, V3.set(F.dx, 0, F.dz));
          for (let k = 0; k < n; k++) {
            const d = seg * (k + .5);
            piece('cyl', { x: F.x + F.dx * d, y: groundY(F.x + F.dx * d, F.z + F.dz * d, F.y + 2) + tr, z: F.z + F.dz * d, sx: tr * 2, sy: seg * .92, sz: tr * 2, c: '#7a4f2c', q: Qa, vx: (r() - .5) * 2, vy: 1 + r() * 2, vz: (r() - .5) * 2, av: 1.5, life: low ? 10 : 25 });
          }
        } else {
          p.it.fixed = false; p.it.vx = (r() - .5) * 3 + F.dx * 2; p.it.vy = 2 + r() * 3; p.it.vz = (r() - .5) * 3 + F.dz * 2; p.it.life = DS.t - p.it.born + 4; p.it.av = 2;
        }
      }
      burst('dust', tip[0], F.y + .4, tip[1], 22, '#b59a73');
      if (F.b.kind === 'tree' || F.b.kind === 'pine') burst('leaves', tip[0], F.y + 1.5, tip[1], 26, F.b.kind === 'pine' ? '#2f7d4a' : '#5aa845');
      o.sfx?.('break', { x: tip[0], y: F.y + .5, z: tip[1], vol: .8 });
      o.onLand?.(F.b, tip[0], tip[1]);
      return true;
    }

    // ── Частицы (общий fx.js): пыль, листва, искры, щепки, брызги стекла — одним эмиттером на вид ──
    const EM = {};
    function burst(kind, x, y, z, n, color){
      const FX = typeof o.fx === 'function' ? o.fx() : o.fx; if (!FX) return;
      const K = { dust: ['smoke', '#b59a73', .9], leaves: ['smoke', color, .5], sparks: ['sparkles', '#ffb347', .7], glass: ['sparkles', '#e0f7ff', .6], smoke: ['smoke', '#6b7280', 1.2], fire: ['fire', null, 1], sand: ['smoke', '#d6c08a', .8] }[kind] || ['smoke', color, 1];
      const key = kind + (color || '');
      let em = EM[key];
      if (!em) em = EM[key] = FX.emitter({ kind: K[0], at: [x, y, z], rate: 0, size: K[2], color: color || K[1], color2: color || K[1] });
      em.set({ at: [x, y, z] }); em.burst(low ? Math.ceil(n / 2) : n);
    }
    DS.burst = burst;

    // ── Как бьётся каждый вид ──
    function shatter(b, seed, dx, dz){
      const r = rng(seed), l = Math.hypot(dx, dz) || 1, fx = dx / l, fz = dz / l;
      const kick = (k = 1) => ({ vx: (fx * 3 + (r() - .5) * 4) * k, vy: (2 + r() * 4) * k, vz: (fz * 3 + (r() - .5) * 4) * k });
      const base = b.y || 0;
      switch (b.kind) {
        case 'tree': case 'pine': case 'pole': case 'lamp': case 'sign': faller(b, seed, fx, fz); if (b.kind === 'lamp') burst('sparks', b.x, base + (b.h || 3), b.z, 14); break;
        case 'bench':
          for (let k = 0; k < 4; k++) piece('box', { x: b.x + (r() - .5) * 1.6, y: base + .5 + r() * .4, z: b.z + (r() - .5) * .5, sx: .9 + r() * .4, sy: .1, sz: .3, c: b.c || '#a0673a', ...kick() });
          for (const s of [-1, 1]) piece('box', { x: b.x + s * .9, y: base + .3, z: b.z, sx: .12, sy: .5, sz: .45, c: '#2f2a26', ...kick(.6) });
          burst('dust', b.x, base + .3, b.z, 10); o.sfx?.('break', { x: b.x, y: base + .5, z: b.z, vol: .6 }); break;
        case 'fence': case 'crate': case 'prop': {
          const n = b.kind === 'crate' ? 6 : 4, w = b.w || 1.2;
          for (let k = 0; k < n; k++) piece('box', { x: b.x + (r() - .5) * w, y: base + (b.h || 1) * (.3 + r() * .6), z: b.z + (r() - .5) * (b.d || .4), sx: w * (.25 + r() * .3), sy: .1 + r() * .08, sz: .2 + r() * .2, c: b.c || '#8b5a2b', ...kick() });
          burst('dust', b.x, base + .5, b.z, 12); o.sfx?.('break', { x: b.x, y: base + .5, z: b.z, vol: .6 }); break;
        }
        case 'bag':
          for (let k = 0; k < 3; k++) piece('box', { x: b.x + (r() - .5) * .8, y: base + .3, z: b.z + (r() - .5) * .4, sx: .4, sy: .2, sz: .3, c: b.c || '#c8b07c', ...kick(.6) });
          burst('sand', b.x, base + .4, b.z, 24); o.sfx?.('hit', { x: b.x, y: base + .4, z: b.z, vol: .5 }); break;
        case 'barrel':
          for (const s of [-1, 1]) { Qa.setFromAxisAngle(AX.set(r(), 0, r()).normalize(), s * .6); piece('cyl', { x: b.x + s * .25, y: base + .5, z: b.z, sx: .5, sy: .5, sz: .5, c: b.c || '#b91c1c', q: Qa, ...kick() }); }
          burst('sparks', b.x, base + .6, b.z, 10); o.sfx?.('hit', { x: b.x, y: base + .5, z: b.z, vol: .7 }); break;
        case 'glass': {
          const n = low ? 6 : 12, w = b.w || 1.5, h = b.h || 1.4;
          for (let k = 0; k < n; k++) { Qa.setFromAxisAngle(AX.set(r() - .5, r() - .5, r() - .5).normalize(), r() * PI); piece('shard', { x: b.x + (r() - .5) * w, y: base + (r() - .5) * h, z: b.z + (r() - .5) * (b.d || .1), sx: .15 + r() * .3, sy: .2 + r() * .35, sz: .02, q: Qa, ...kick(.7), life: 6 }); }
          burst('glass', b.x, base, b.z, 18); o.sfx?.('glass', { x: b.x, y: base, z: b.z, vol: .8 }); break;
        }
        case 'wall': case 'block': {   // обломки по размеру куска (кирпичи, плиты), пыль; на месте — дыра
          const w = b.w || 2, h = b.h || 3, d = b.d || .3, n = low ? 4 : 8, yw = b.yaw || 0, c = Math.cos(yw), s = Math.sin(yw);
          for (let k = 0; k < n; k++) {
            const lx = (r() - .5) * w * .9, lz = (r() - .5) * d;
            piece('box', { x: b.x + lx * c + lz * s, y: base + r() * h * .9 + .1, z: b.z - lx * s + lz * c, sx: w * (.14 + r() * .18), sy: h * (.08 + r() * .12), sz: Math.max(.14, d * (.6 + r() * .4)), c: b.c || '#a8a29e', ...kick(.8) });
          }
          burst('dust', b.x, base + h * .45, b.z, low ? 12 : 22); o.sfx?.('break', { x: b.x, y: base + 1, z: b.z, vol: .9 }); break;
        }
        default: piece('box', { x: b.x, y: base + .5, z: b.z, sx: .5, sy: .5, sz: .5, c: b.c, ...kick() });
      }
    }

    // ── Реестр ──
    DS.add = b => {
      b.hp0 = b.hp ?? HP[b.kind] ?? 2; b.hp = b.hp0; b.small = b.small ?? SMALL.has(b.kind);
      DS.list.set(b.id, b);
      const k = cellOf(b.x, b.z); let L = DS.grid.get(k); if (!L) DS.grid.set(k, L = []); L.push(b);
      return b;
    };
    DS.remove = id => { const b = DS.list.get(id); if (!b) return; DS.list.delete(id); const L = DS.grid.get(cellOf(b.x, b.z)); if (L) L.splice(L.indexOf(b), 1); };
    function near(x, z, r, cb){
      const m = r + 3;   // клетки — с запасом на размер вещи (в клетке — по центру: кусок стены 2,4 м мог попасть в соседнюю)
      for (let i = Math.floor((x - m) / 24); i <= Math.floor((x + m) / 24); i++) for (let j = Math.floor((z - m) / 24); j <= Math.floor((z + m) / 24); j++)
        for (const b of DS.grid.get(i + ',' + j) || []) if (Math.hypot(b.x - x, b.z - z) <= r + (b.r || Math.max(b.w || 0, b.d || 0) / 2 || .4)) cb(b);
    }
    const allowed = b => { const ru = DS.rule(b); return ru === 'all' || (ru === 'small' && b.small); };
    // сломать: спрятать целое, убрать тела, обломки, через N минут — назад
    DS.breakId = (id, seed = (Math.random() * 1e9) | 0, dx = 1, dz = 0, remote = false) => {
      const b = DS.list.get(id) || o.lookup?.(id); if (!b || DS.broken.has(b.id) || !allowed(b)) return false;
      if (!DS.list.has(b.id)) DS.add(b);
      DS.broken.set(b.id, DS.t + RESTORE);
      try { b.hide?.(true); } catch (e) { console.error(e); }
      for (const c of b.bodies || []) ph?.remove?.(c);
      shatter(b, seed, dx, dz);
      b.onBreak?.(b);
      if (!remote) DS.onBreak?.(b.id, seed, Math.round(dx * 100) / 100, Math.round(dz * 100) / 100);
      return true;
    };
    function restore(b){
      DS.broken.delete(b.id); b.hp = b.hp0;
      for (const c of b.bodies || []) ph?.readd?.(c);
      try { b.hide?.(false); } catch (e) { console.error(e); }
      if (b.temp) DS.remove(b.id);
    }
    DS.restore = id => { const b = DS.list.get(id); if (b && DS.broken.has(id)) restore(b); };
    // удар: урон всему в радиусе (по силе), сломалось — сломать
    DS.hit = (x, z, r, dmg = 1, hit = {}) => {
      let n = 0;
      o.provide?.(x, z, r + 4, DS);   // ленивые (деревья карты): добавить, кто рядом
      near(x, z, r, b => {
        if (DS.broken.has(b.id) || (hit.kinds && !hit.kinds.includes(b.kind)) || !allowed(b)) return;
        if (hit.y != null && b.y != null && (hit.y < b.y - .5 || hit.y > b.y + (b.h || 3) + 1)) return;
        b.hp -= dmg;
        if (b.hp <= 0) { if (DS.breakId(b.id, (Math.random() * 1e9) | 0, hit.dx ?? b.x - x, hit.dz ?? b.z - z)) n++; }
      });
      return n;
    };
    // машина: что впереди можно сломать её силой — ломает и говорит, насколько притормозить
    DS.ahead = (x, z, r, power, dx, dz) => {
      let slow = 1, n = 0;
      o.provide?.(x, z, r + 4, DS);
      near(x, z, r, b => {
        if (DS.broken.has(b.id) || !allowed(b) || (b.power ?? POWER[b.kind] ?? 1) > power) return;
        if (DS.breakId(b.id, (Math.random() * 1e9) | 0, dx, dz)) { n++; slow *= b.kind === 'tree' || b.kind === 'pine' ? .7 : .88; }
      });
      return { n, slow };
    };
    DS.blocking = (x, z, r, power) => { let hard = null; near(x, z, r, b => { if (!DS.broken.has(b.id) && (b.power ?? POWER[b.kind] ?? 1) > power) hard = b; }); return hard; };

    // ── Кадр: обломки летят, ложатся, засыпают, тают; падающие падают; сломанное восстанавливается ──
    DS.update = dt => {
      dt = Math.min(dt, .05); DS.t += dt;
      for (let i = fallers.length - 1; i >= 0; i--) if (stepFaller(fallers[i], dt)) fallers.splice(i, 1);
      for (const k in pools) {
        const P = pools[k];
        for (const it of P.items) {
          if (!it.on || it.fixed) continue;
          const age = DS.t - it.born;
          if (age > it.life) { hidePiece(P, it); continue; }
          const fade = it.life - age < 1.2 ? Math.max(.05, (it.life - age) / 1.2) : 1;
          if (it.asleep && fade === 1) continue;
          if (!it.asleep) {
            it.vy -= G * dt; it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
            const gy = groundY(it.x, it.z, it.y) + it.sy * .4;
            if (it.y < gy) { it.y = gy; it.vy = -it.vy * it.bounce; it.vx *= .6; it.vz *= .6; it.av *= .6; if (Math.abs(it.vy) < 1) it.vy = 0; }
            if (it.av > .05) { AX.set(it.ax, .3, it.az).normalize(); Qa.setFromAxisAngle(AX, it.av * dt); it.q.premultiply(Qa); }
            if (Math.abs(it.vx) + Math.abs(it.vy) + Math.abs(it.vz) < .25 && it.y <= gy + .02) { if ((it.sleep += dt) > .4) it.asleep = true; } else it.sleep = 0;
          }
          it.k = fade;
          write(P, it);
        }
      }
      if (DS.broken.size) for (const [id, at] of DS.broken) if (DS.t >= at) { const b = DS.list.get(id); if (b && !(o.busy?.(b))) restore(b); else if (!b) DS.broken.delete(id); }
    };
    DS.stats = () => { const s = { fallers: fallers.length, broken: DS.broken.size, list: DS.list.size }; for (const k in pools) s[k] = pools[k].items.filter(x => x.on).length; return s; };
    DS.clear = () => { fallers.length = 0; for (const k in pools) for (const it of pools[k].items) if (it.on) hidePiece(pools[k], it); };
    DS.dispose = () => {
      DS.clear();
      for (const id of [...DS.broken.keys()]) { const b = DS.list.get(id); if (b) restore(b); }
      R.scene.remove(grp); for (const k in GEO) GEO[k].dispose(); mat.dispose(); glassM.dispose();
      for (const k in EM) EM[k].dispose?.();
    };
    return DS;
  };
  E.destruct.SMALL = SMALL; E.destruct.POWER = POWER; E.destruct.HP = HP; E.destruct.rng = rng;
})();
