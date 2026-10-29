// ═══════════════════════════════════════
//  «КУБОМИР» — обломки и вещи как твёрдые тела (T-138 шаг 2, F4): переходник к D37E.debris
// ═══════════════════════════════════════
// Владелец 29.10: «блоки и предметы могут улетать в зависимости от веса и катиться со скалы». Спека: E:\d37-core\spec\
// STRUCTURE_HAZARDS.md §0.9 (SH-R), §5.x (один потолок). Ядро — js/engine/debris.js (целые числа, пул без мусора).
//  • Постройка упала (kubomir-topple.js): блоки, что ударились о землю быстрее своей прочности (дальние от оси — у высокой башни
//    верх), отламываются и летят вперёд; блок, которому некуда лечь, — тоже обломок (сползает с кучи). Обломок — кубик
//    с массой материала (KubomirSupport.matOf → D37E.support.MATS: камень 2 400 кг, дерево 650): летит, отскакивает, катится
//    по склону (круглое — брёвна, камень; кубик — только с края обрыва), с края скалы — вниз; уснул — снова блок на сетке (занято —
//    вещью, «keep»: не пропадает).
//  • Удар упавшего (X.shock) толкает обломки и вещи рядом: Δv = J / m — лёгкие (ростки, палки) летят дальше тяжёлых (булыжник).
//  • Вещи (KD.ITEMS): лежащая вещь на склоне (то же правило ядра D37E.debris.slope) катится вниз и со скалы.
//  • Игра вместе (F5): решает хозяин; гостю — события с номером такта (kubomir-topple.js netPush): «обломок родился» (целые числа
//    ядра) и «уснул»; гость считает то же ядро — путь тот же; блок / вещь — правками и снимками хозяина.
//   X = KubomirDebris.attach(st) → { spawnCell(x, y, z, v, vx, vy, vz), shock(x, y, z, J, r), tick(reads), frame(dt), flush(),
//     dispose(), netApply(ev), live(), stats } · откат — KD.ON = false (обломков нет: блоки и вещи — как было), KD.ITEMS = false.
(() => {
  const KD = window.KubomirDebris = window.KubomirDebris || {};
  KD.ON = true;      // F4: обломки (false — блок, которому некуда лечь, сразу вещью; при ударе ничего не отламывается — как было)
  KD.ITEMS = true;   // F4: вещи катятся по склону и со скалы, толчок удара — по весу (false — как было)
  KD.MAX = 48;       // обломков в полёте сразу (пул ядра)
  KD.READS = 1024;   // доля потолка §5.x за такт мира (чтений клеток), если постройки не заняли больше
  KD.FLOOR = 256;    // меньше не бывает: летящий обломок не висит в воздухе дольше такта
  KD.PER_LAND = 16;  // отломится при ударе — не больше на одно падение (самые дальние от оси)
  const ITEM_VOL = .022;   // вещь-блок — маленький кубик (0,28 клетки): доля массы блока

  KD.attach = st => {
    const DBm = window.D37E?.debris, V = window.D37E?.vox;
    if (!DBm || !V || !st?.W) return null;
    const W = st.W, D = DBm.world({ max: KD.MAX, reads: KD.READS }), ONE = DBm.ONE, Lit = window.KubomirEnts?.Lit;
    const guest = () => !!st.coopGuest;
    const X = { D, stats: { spawned: 0, blocks: 0, items: 0, full: 0, hits: 0, shocks: 0, rolledItems: 0, itemReads: 0, maxTickMs: 0, tickMs: 0, ticks: 0, reads: 0, netIn: 0 } };
    const view = new Array(D.N).fill(null), nidOf = new Int32Array(D.N);
    const byNid = new Map();   // гость: номер хозяина → слот
    let nid = 0;
    const solidT = t => V.T.solid[t] === 1 && V.T.shape[t] !== V.SHAPE.cross && !V.T.liquid[t];
    const stop = (x, y, z) => { const v = W.raw(x, y, z); if (v < 0) return true; if (!(v > 0)) return false; return solidT(v & 0xfff); };
    // масса (кг на клетку) и «круглость» по блоку — таблицы по номеру блока (моды добавили блоки — пересобрать)
    let MS = null, RL = null;
    function tables(){
      if (MS && MS.length === V.blocks.length) return;
      const n = V.blocks.length, KS = window.KubomirSupport, MT = window.D37E.support?.MATS;
      MS = new Int32Array(n); RL = new Int16Array(n);
      for (let t = 0; t < n; t++) {
        const b = V.blocks[t], m = KS?.matOf ? KS.matOf(t) : 255;
        MS[t] = MT?.[m] ? MT[m].mass : (b && /leaves|wool|cloth|bed/.test(b.name) ? 80 : 600);
        RL[t] = V.T.axis[t] ? 1000 : b && /stone|cobble|ore_|gravel|basalt|granite|andesite|diorite|boulder|rock/.test(b.name) ? 600 : 0;
      }
    }
    const batch = keep => st.ents?.itemBatch ? st.ents.itemBatch(keep) : { add: (x, y, z, s) => st.ents?.addItem?.(x, y, z, s, false, null, false, keep), flush(){} };
    const blockedAt = (x, y, z) => { const p = st.P; if (p && !p.dead && p.x + .3 > x && p.x - .3 < x + 1 && p.z + .3 > z && p.z - .3 < z + 1 && p.y + 1.8 > y && p.y < y + 1) return true; return !!st.ents?.blocked?.(x, y, z); };

    // ═══ обломок родился: клетка (x, y, z) — откуда (занято — выше, до 3), скорость (м/с) → true; false — зовущий делает как раньше ═══
    X.spawnCell = (x, y, z, v, vx, vy, vz) => {
      if (!KD.ON || guest()) return false;
      tables();
      let yy = y; while (yy < y + 3 && (stop(x, yy, z) || blockedAt(x, yy, z))) yy++;
      if (stop(x, yy, z) || blockedAt(x, yy, z) || yy >= V.H - 1) return false;
      const t = v & 0xfff, i = D.add(DBm.q(x + .5), DBm.q(yy + .5), DBm.q(z + .5), DBm.vq(vx), DBm.vq(vy), DBm.vq(vz), MS[t] || 600, 7, RL[t] || 0, v);
      if (i < 0) { X.stats.full++; return false; }
      X.stats.spawned++;
      nidOf[i] = ++nid;
      st.topple?.netPush?.('d', nid, D.px[i], D.py[i], D.pz[i], D.vx[i], D.vy[i], D.vz[i], D.kg[i], 7, RL[t] || 0, v);
      makeView(i, v);
      return true;
    };
    // удар (упавшее легло): J — кг·м/с, r — клеток; обломки (ядро) и вещи — Δv = J / m (вещам — не больше 9 м/с)
    X.shock = (x, y, z, J, r) => {
      if (!KD.ON || guest()) return 0;
      X.stats.shocks++;
      const qx = DBm.q(x), qy = DBm.q(y), qz = DBm.q(z), qJ = Math.round(J * ONE / 80);
      D.blast(qx, qy, qz, qJ, r);
      st.topple?.netPush?.('B', qx, qy, qz, qJ, r);
      if (!KD.ITEMS || !st.ents?.items) return 0;
      let n = 0;
      for (const e of st.ents.items) {
        const dx = e.x - x, dy = e.y + .1 - y, dz = e.z - z, d = Math.hypot(dx, dy, dz); if (d >= r) continue;
        const dv = Math.min(9, J * (1 - d / r) / itemMass(e.s.id)); if (dv < .3) continue;
        const k = d > .01 ? dv / d : 0; e.vx += dx * k; e.vz += dz * k; e.vy += Math.max(0, dy * k) + dv / 3; e.ground = false; n++;
      }
      return n;
    };
    function itemMass(id){
      const it = V.item(id); if (!it) return 1;
      const b = it.place ? V.block(it.place) : null;
      if (b && b.shape === V.SHAPE.cube) { tables(); return Math.max(.5, (MS[b.id] || 600) * ITEM_VOL); }
      if (b) return .3;   // росток, цветок, факел — лёгкие
      return it.tool ? 2 : .4;   // инструмент — 2 кг; палка, росток, еда — легче
    }
    X.itemMass = itemMass;

    // ═══ вещи на склоне (KD.ITEMS): правило ядра — круглое катится, если ниже на 2 за 2 клетки; катится — проверка каждый такт ═══
    const SO = { ax: 0, az: 0, s: 0, reads: 0 }, AK = 6400 / ONE;   // Q16/подшаг² → клеток/с²
    if (st.ents) st.ents.hookRoll = (e, dt) => {
      if (!KD.ITEMS) { e.roll = false; return; }
      if (!e.roll && ((st.ents.tickN + e.id) & 7)) return;   // лежит — раз в 8 тактов
      DBm.slope(stop, Math.floor(e.x), Math.floor(e.y + .05), Math.floor(e.z), true, SO); X.stats.itemReads += SO.reads;
      if (!SO.ax && !SO.az) { e.roll = false; return; }
      if (!e.roll) X.stats.rolledItems++;
      e.roll = true; e.vx += SO.ax * AK * dt; e.vz += SO.az * AK * dt;
    };

    // ═══ такт мира: ядро (доля потолка) → уснул — блок / вещь; удар — звук ═══
    const PT = { x: 0, y: 0, z: 0 }, SET = [];
    let snd = 0;
    X.tick = reads => {
      if (!D.live()) { D.used = 0; return; }
      const t0 = performance.now();
      X.stats.ticks++;
      if (st.topple) st.topple.inTick = true;   // события обломков — этого такта мира (F5)
      try { tick0(reads); } finally { if (st.topple) st.topple.inTick = false; }
      const ms = performance.now() - t0; X.stats.tickMs += ms; if (ms > X.stats.maxTickMs) X.stats.maxTickMs = ms;
    };
    function tick0(reads){
      for (let i = 0; i < D.N; i++) { const w = view[i]; if (w) { w.px = w.x; w.py = w.y; w.pz = w.z; } }
      const n = D.tick(stop, Math.max(KD.FLOOR, Math.min(KD.READS, reads > 0 ? reads : KD.READS)));
      X.stats.reads += D.used;
      snd = 0; SET.length = 0;
      for (let e = 0; e < n; e++) {
        const i = D.ev[e * 5], type = D.ev[e * 5 + 1];
        if (type === 2) { X.stats.hits++; hitFx(i, D.ev[e * 5 + 2]); continue; }
        if (guest()) { drop(i); continue; }   // гость: блок / вещь придут от хозяина
        settle(i, D.ev[e * 5 + 2], type === 3 ? Math.max(1, D.ev[e * 5 + 3]) : D.ev[e * 5 + 3], D.ev[e * 5 + 4]);
      }
      if (SET.length && st.sup?.recheck) st.sup.recheck(SET.slice());   // легли блоками — держатся ли (обрушение v1)
      for (let i = 0; i < D.N; i++) { const w = view[i]; if (w && D.st[i] === 1) { D.pos(i, PT); w.x = PT.x; w.y = PT.y; w.z = PT.z; } }
    }
    function hitFx(i, sp){
      const w = view[i]; if (!w || snd >= 3) return;
      const ms = sp * 80 / ONE; if (ms < 4) return;
      snd++;
      st.AU?.play('kb_thud', { x: w.x - st.ox, y: w.y, z: w.z - st.oz, vol: Math.min(.7, .15 + ms / 30), rate: 1.3 + (D.kg[i] < 1000 ? .4 : 0) });
      if (st.ents?.debris) st.ents.debris(Math.floor(w.x), Math.floor(w.y - .5), Math.floor(w.z), D.tag[i] & 0xfff, 3);
    }
    // уснул в клетке (x, y, z): блоком на сетку (свободно — воздух, вода, трава; не игрок и не моб), занято — клеткой выше, нет — вещью
    function settle(i, x, y, z){
      const v = D.tag[i], t = v & 0xfff, bl = V.blocks[t];
      let ok = false;
      for (let k = 0; k < 2 && !ok; k++) {
        const yy = y + k, cur = W.raw(x, yy, z), ct = cur > 0 ? cur & 0xfff : 0;
        const free = cur >= 0 && yy >= 1 && yy < V.H - 1 && (cur === 0 || V.T.liquid[ct] || V.T.shape[ct] === V.SHAPE.cross || (V.blocks[ct]?.replace && !V.T.solid[ct]));
        if (!free || blockedAt(x, yy, z)) continue;
        W.set(x, yy, z, v, { urgent: 2 }); SET.push(x, yy, z); ok = true; X.stats.blocks++;
      }
      if (!ok && !st.creative && bl) {
        const id = bl.name === 'door_oak' ? 'door' : bl.name === 'furnace_lit' ? 'furnace' : bl.drop || bl.name;
        if (id && V.item(id)) { const ev = batch(true); ev.add(x + .5, y + .4, z + .5, { id, n: 1 }); ev.flush(); X.stats.items++; }
      }
      st.topple?.netPush?.('x', nidOf[i]);
      drop(i);
    }
    function drop(i){ const w = view[i]; if (w?.m) { st.R?.scene?.remove(w.m); w.m.geometry.dispose(); } view[i] = null; D.free(i); }

    // ═══ картинка: кубик вещи блока (7/8 клетки), плавно между тактами, катится — крутится ═══
    function makeView(i, v){
      const b = V.blocks[v & 0xfff], name = b && V.item(b.name) ? b.name : b?.drop && V.item(b.drop) ? b.drop : null;
      D.pos(i, PT);
      const w = { m: null, lit: Lit ? Lit.make(null) : null, x: PT.x, y: PT.y, z: PT.z, px: PT.x, py: PT.y, pz: PT.z, fx: PT.x, fz: PT.z };
      if (name && st.VR?.itemMesh && st.R?.scene) { w.m = st.VR.itemMesh(name, 15 << 12); w.m.scale.setScalar(.875); w.m.castShadow = true; st.R.scene.add(w.m); }
      view[i] = w;
    }
    X.frame = dt => {
      const a = st.ents && st.ents.frac >= 0 && st.ents.frac <= 1 ? st.ents.frac : 1;
      for (let i = 0; i < D.N; i++) {
        const w = view[i]; if (!w || !w.m) continue;
        const x = w.px + (w.x - w.px) * a, y = w.py + (w.y - w.py) * a, z = w.pz + (w.z - w.pz) * a;
        const r = 7 / 16, dx = x - w.fx, dz = z - w.fz; w.fx = x; w.fz = z;
        if (Math.abs(dx) + Math.abs(dz) < 1) { w.m.rotation.x += dz / r; w.m.rotation.z -= dx / r; }   // катится: поворот на пройденное / радиус
        w.m.position.set(x - st.ox, y, z - st.oz);
        if (Lit && w.lit) { Lit.update(w.lit, st, x, y, z, dt); st.VR.itemLightF?.(w.m.geometry, w.lit.lv); }
      }
    };

    // ═══ игра вместе: гость повторяет события хозяина (тот же ход ядра) ═══
    X.netApply = ev => {   // ['d', nid, x, y, z, vx, vy, vz, kg, size, roll, v] · ['x', nid] · ['B', x, y, z, J, r]
      X.stats.netIn++;
      if (ev[0] === 'd') {
        const i = D.add(+ev[2], +ev[3], +ev[4], ev[5] | 0, ev[6] | 0, ev[7] | 0, ev[8] | 0, ev[9] | 0, ev[10] | 0, ev[11] | 0);
        if (i < 0) return;
        byNid.set(ev[1] | 0, i); nidOf[i] = ev[1] | 0; makeView(i, ev[11] | 0);
      } else if (ev[0] === 'x') {
        const i = byNid.get(ev[1] | 0); byNid.delete(ev[1] | 0);
        if (i !== undefined && nidOf[i] === (ev[1] | 0) && view[i]) drop(i);
      } else if (ev[0] === 'B') D.blast(+ev[1], +ev[2], +ev[3], +ev[4], ev[5] | 0);
    };

    // сохранить / закрыть: всё, что летит, — сразу там, где есть (блоком / вещью)
    X.flush = () => {
      let n = 0;
      for (let i = 0; i < D.N; i++) {
        if (D.st[i] !== 1 && D.st[i] !== 2) continue;
        n++;
        if (guest()) { drop(i); continue; }
        settle(i, Math.floor(D.px[i] / ONE), Math.max(1, Math.floor((D.py[i] - D.hq[i] + 1) / ONE)), Math.floor(D.pz[i] / ONE));
      }
      if (SET.length && st.sup?.recheck) { st.sup.recheck(SET.slice()); SET.length = 0; }
      return n;
    };
    X.live = () => D.live();
    // для проверок: обломки по номеру хозяина — «номер:x,y,z,vx,vy,vz» (Q16), по возрастанию номера ('' — нет)
    X.state = () => { const a = []; for (let i = 0; i < D.N; i++) if (D.st[i] === 1 || D.st[i] === 2) a.push([nidOf[i], D.px[i], D.py[i], D.pz[i], D.vx[i], D.vy[i], D.vz[i]]); a.sort((p, q) => p[0] - q[0]); return a.map(r => r[0] + ':' + r.slice(1).join(',')).join(' '); };
    X.dispose = () => { for (let i = 0; i < D.N; i++) if (view[i]) drop(i); D.clear(); byNid.clear(); if (st.ents?.hookRoll) st.ents.hookRoll = null; };
    return X;
  };
})();
