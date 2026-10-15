// ═══════════════════════════════════════
//  «МИР ДЕНЧИКА»: ТРАНСПОРТ В МИРЕ (js/engine/vehicle.js) — машины, лодки, вертолёты, самолёты: места из зон, [E] — сесть
//  за руль или пассажиром, камера сзади, кнопки телефона, звук мотора, сеть 'vh' (ведёт водитель), возврат на стоянку
// ═══════════════════════════════════════
// Места — в описаниях зон: MirZones.def(id, { vehicles: [{ id (как ID_RE, ≤ 16), def, x, z, yaw, area? }] }); area — техника
// не выезжает из своей зоны (военная — из боевой, карты — из детского городка). Возраст — ворота зон (за руль в зону не по
// возрасту не въехать). Сеть: { t: 'vh', k: 'in' | 's' | 'out', id, s: снимок E.vehicle.pack, c: когда сел } — водитель шлёт
// 5 раз в секунду, стоя — раз в 1,2 с; у остальных — проверка (E.vehicle.snapOk: потолок скорости, телепорты), плавная подстановка
// с предсказанием. Сел раньше — тот и водитель (второй пересаживается пассажиром или выходит). Кто где сидит — zx.v [id, место].
// Крючки mir.js: S.zones.drive(dt, C, rig) — вместо P.update, пока в машине; camTarget() — за кем камера; inVeh() — без 'st'
// направления. Новичку ('hi') — снимки машин, которые веду или оставил я.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const PI = Math.PI;
  const MZ = () => root.MirZones;
  // места появления из описаний зон
  function spots(){
    const L = [], Z = MZ(); if (!Z) return L;
    for (const [zid, d] of Object.entries(Z.DEFS)) for (const s of d.vehicles || []) L.push({ ...s, zone: zid });
    return L;
  }
  const AREA_MSG = { war: '🪖 Военная техника — только в боевой зоне', kids: '🏎️ Карты катаются только по Солнечному городку', metro: '🏙️ Эта машина — только для Большого города' };
  const BASE_BTNS = [{ action: 'crouch', icon: '⬇', label: 'присесть' }, { action: 'interact', icon: '✋', label: 'действие' }, { action: 'jump', icon: '⤒', label: 'прыжок', big: true }];
  const HINT = {
    car: 'W/S — газ и назад, A/D — руль, Пробел — тормоз, Shift — ускорение, H — сигнал, L — фары, E — выйти',
    boat: 'W/S — вперёд и назад, A/D — руль, Shift — быстрее, H — гудок, E — выйти',
    heli: 'Пробел — вверх, C — вниз, W/S — вперёд и назад, A/D — поворот, Shift — быстрее, E — выйти (на земле)',
    plane: 'W — газ, S — сбросить газ, на скорости Пробел — взлёт (нос вверх), C — нос вниз, A/D — крен и поворот, E — выйти (на земле)',
  };

  function start(rt){
    const VE = root.D37E?.vehicle, Z = MZ(); if (!VE || !Z) return null;
    const S = rt.S, R = rt.R, T = rt.T, ph = rt.ph, X = rt.X, H = rt.H, E = rt.E, toast = rt.toast;
    const now = () => performance.now();
    const VS = { list: new Map(), me: null, t: 0, lookAt: -9, sendT: 0, warnAt: -9, hinted: new Set(), cam0: null, loops: new Map() };
    const env = { ph, water: (x, z) => (ph.waterLevel ? ph.waterLevel(x, z) : -Infinity), bounds: Z.bounds(), onCrash };
    let glassM = null;
    const glass = () => glassM || (glassM = (() => { const m = new T.MeshStandardMaterial({ color: '#bfe8ff', transparent: true, opacity: .32, roughness: .08, metalness: 0, depthWrite: false }); R.own.push(m); return R.fresnel ? R.fresnel(m, .5) : m; })());
    const IN = { thr: 0, steer: 0, up: 0, boost: 0, brake: 0, on: true };
    // высота стоянки: лодка — на воде, остальное — на опоре (земля, площадка, перрон)
    function restY(d, x, z, hint, own){   // hint — высота места (площадка на крыше небоскрёба): опора не выше неё; own — своё тело не опора
      if (d.kind === 'boat') { const wl = env.water(x, z); if (wl > -Infinity) return wl - d.water.draft; }
      return ph.supportAt(x, z, .5, hint != null ? hint + 1 : 2, own).y;   // без подсказки — у земли (не на крыше паркинга над местом)
    }
    // ── машины мест ──
    for (const sp of spots()) {
      const d = VE.get(sp.def); if (!d || VS.list.has(sp.id)) continue;
      const v = VE.create(d, { id: sp.id, x: sp.x, y: restY(d, sp.x, sp.z, sp.y), z: sp.z, yaw: sp.yaw || 0 });
      Object.assign(v, { area: sp.area || null, zone: sp.zone, spotY: sp.y ?? null, view: null, by: null, claimAt: 0, lastBy: null, idleAt: now(), net: null, bad: 0, settled: false, local: false });
      VE.addBody(v, ph);
      v.item = X.add({ x: v.x, y: v.y + 1, z: v.z, r: Math.max(1.4, d.size[2] * .42), col: v.body, prompt: () => promptOf(v), act: () => tryEnter(v) });
      VS.list.set(v.id, v);
    }
    // ── кто где сидит: по zx.v [id, место] у всех (и у меня) ──
    function seatsOf(v){
      const occ = [];
      if (VS.me?.v === v) occ[VS.me.seat] = S.key;
      for (const p of S.players.values()) { const zv = p.zx?.v; if (!p.leaving && zv && zv[0] === v.id && Number.isInteger(zv[1])) occ[zv[1]] = p.key; }
      return occ;
    }
    const driverOn = v => !!v.by && (v.by === S.key ? VS.me?.v === v && VS.me.seat === 0 : !!S.players.get(v.by) && !S.players.get(v.by).leaving && now() - (v.net?.at || 0) < 4500);
    function promptOf(v){
      if (VS.me) return null;
      const d = v.def;
      if (v.broken) return `🔧 ${d.icon} ${d.name} сломан — скоро новый`;
      const occ = seatsOf(v);
      if (v.temp && v.owner !== S.key) { const fr = d.seats.findIndex((s, i) => i > 0 && !occ[i]); return fr > 0 ? `🪑 Сесть пассажиром · ${d.name} (тест-драйв)` : null; }
      if (!occ[0] && !driverOn(v)) return `${d.icon} Сесть за руль · ${d.name}`;
      const free = d.seats.findIndex((s, i) => i > 0 && !occ[i]);
      return free > 0 ? `🪑 Сесть пассажиром · ${d.name}` : null;
    }
    function tryEnter(v){
      if (VS.me || v.broken) return;
      const occ = seatsOf(v);
      const seat = !occ[0] && !driverOn(v) && !(v.temp && v.owner !== S.key) ? 0 : v.def.seats.findIndex((s, i) => i > 0 && !occ[i]);
      if (seat < 0) { toast('Мест нет'); return; }
      enter(v, seat);
    }
    // ── сесть ──
    function enter(v, seat){
      const P = S.P, d = v.def, rig = S.rig;
      if (P.mode === 'sit') P.standUp();
      rt.unsit?.();
      if (rt.zx.a) rt.setZX({ a: null });
      VS.me = { v, seat };
      if (seat === 0) { v.by = S.key; v.claimAt = Date.now(); v.local = true; v.eng = true; v.idleAt = now(); v.net = null; v.ai = null; sendSnap(v, 'in'); }
      rt.setZX({ v: [v.id, seat] });
      if (!VS.cam0) VS.cam0 = { dist: rig.dist, maxD: rig.maxD, minD: rig.minD, minP: rig.minP };
      Object.assign(rig, { dist: d.cam.dist, maxD: d.cam.dist * 2.2, minD: 4, minP: .05 });
      rig.pitch = Math.max(.22, Math.min(rig.pitch, .5)); rig.yaw = v.yaw + PI; VS.lookAt = -9;
      touch(true, v, seat);
      if (seat === 0 && !VS.hinted.has(d.kind)) { VS.hinted.add(d.kind); toast(`${d.icon} ${d.name}: ${S.I?.touch ? 'джойстик — газ и руль, кнопки справа' : HINT[d.kind]}`, true); }
      else if (seat > 0) toast(`🪑 Ты пассажир: ${d.name}. E — выйти${!driverOn(v) ? ', Пробел — пересесть за руль' : ''}`);
      rt.sfx('click', { vol: .5 });
      seatMe();
    }
    // ── выйти: сбоку от своего места (если занято — с другой стороны, сзади, спереди); высоко в воздухе — нельзя ──
    function exitSpot(v, seat){
      const d = v.def, sp = d.seats[seat] || d.seats[0], side = sp.pos[0] >= 0 ? 1 : -1, w = (d.kind === 'plane' ? 2.4 : d.size[0]) / 2 + .8, L = d.size[2] / 2 + 1;
      const cand = [[side * w, sp.pos[2]], [-side * w, sp.pos[2]], [0, -L], [0, L], [side * w, 0], [-side * w, 0]];
      const o = {};
      for (const [lx, lz] of cand) {
        VE.local(v, [lx, 0, lz], o);
        const wl = env.water(o.x, o.z), y = Math.max(ph.supportAt(o.x, o.z, .3, v.y + 2.5, v.body).y, wl > -Infinity ? wl - 1 : -Infinity);
        if (!ph.blocked(o.x, o.z, y + .15, y + 2, .45, v.body)) return { x: o.x, y, z: o.z };
      }
      VE.local(v, [0, d.size[1] + .1, 0], o);   // всё занято — на крышу
      return { x: o.x, y: o.y, z: o.z };
    }
    function exit(o = {}){
      const m = VS.me; if (!m) return false;
      const v = m.v, d = v.def, P = S.P, rig = S.rig;
      if (!o.force && (d.kind === 'heli' || d.kind === 'plane') && !v.grounded && v.y - ph.supportAt(v.x, v.z, 1, v.y, v.body).y > 3) { toast('🪂 Сначала приземлись — потом выйти'); return false; }
      if (!o.noPlace) { const p = exitSpot(v, m.seat); P.place(p.x, p.y, p.z, v.yaw); }
      if (m.seat === 0) { v.local = false; v.by = null; v.lastBy = S.key; v.eng = false; v.spd = 0; v.vx = v.vz = 0; v.slip = 0; v.thr = 0; v.idleAt = now(); sendSnap(v, 'out'); }
      if (v.temp && v.owner === S.key) { clearTimeout(v.goneT); v.goneT = setTimeout(() => { if (VS.me?.v !== v && VS.list.get(v.id) === v) { rt.vehSend?.({ k: 'gone', id: v.id }); VS.despawn(v.id); } }, 25000); }
      VS.me = null;
      rt.setZX({ v: null });
      if (VS.cam0) { Object.assign(rig, VS.cam0); VS.cam0 = null; }
      delete R.camera.userData.fov0;
      touch(false);
      if (S.X) { S.X.text = null; S.X.cur = null; }
      hudShow(false);
      S.forceSend = true;
      return true;
    }
    // пересесть: пассажир — за руль (водитель ушёл), водитель — пассажиром (кто-то сел раньше)
    function moveSeat(v, seat){
      const m = VS.me; if (!m || m.v !== v) return;
      if (m.seat === 0 && seat !== 0) { v.local = false; }
      m.seat = seat;
      if (seat === 0) { v.by = S.key; v.claimAt = Date.now(); v.local = true; v.eng = true; v.net = null; sendSnap(v, 'in'); }
      rt.setZX({ v: [v.id, seat] });
      touch(true, v, seat);
    }
    // ── посадить себя на место (тело и камера — у сиденья; поза — в preActors) ──
    const SEAT = {};
    function seatMe(){
      const m = VS.me; if (!m) return;
      const v = m.v, sp = v.def.seats[m.seat] || v.def.seats[0], ch = S.P.ch;
      VE.local(v, sp.pos, SEAT);
      ch.x = SEAT.x; ch.y = SEAT.y - .4; ch.z = SEAT.z; ch.vx = ch.vy = ch.vz = 0; ch.grounded = true;
      S.P.yaw = v.yaw;
    }
    // ── за рулём: шаг машины вместо шага человечка (крючок mir.js) ──
    // куда нельзя: зона не по возрасту (развернуться — от её середины) или техника за своей зоной (развернуться — к середине)
    const mid = r => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];
    function blockedAt(v){
      const Zn = Z.zoneAt(v.x, v.z);
      if (Zn && !Z.gateOf(Zn).ok) { const [cx, cz] = mid(Zn); return { msg: `${Zn.icon} ${Zn.name}: вход только ${Zn.age}+`, turn: Math.atan2(v.x - cx, v.z - cz) }; }
      const A = v.area && Z.ZONES[v.area];
      if (A && !Z.inRect(A, v.x, v.z, -1.5)) { const [cx, cz] = mid(A); return { msg: AREA_MSG[v.area] || 'Дальше на этой машине нельзя', turn: Math.atan2(cx - v.x, cz - v.z) }; }
      return null;
    }
    VS.drive = (dt, C, rig) => {
      const m = VS.me; if (!m) return false;
      const v = m.v;
      VS.t += dt;
      if (C.down('interact')) { exit(); return true; }
      if (m.seat > 0 && !driverOn(v) && C.down('jump')) { moveSeat(v, 0); return true; }
      if (m.seat === 0 && v.local) {
        if (C.down('horn')) { v.horn = .6; rt.sfx('horn', { x: v.x, y: v.y + 1, z: v.z, vol: .7 }); }
        if (C.down('lights') && v.def.lights) { v.lights = !v.lights; rt.sfx('click', { vol: .4 }); }
        const ox = v.x, oz = v.z;
        VE.step(v, dt, VE.input(C, v, IN), env);
        const why = blockedAt(v);
        if (why) {
          v.x = ox; v.z = oz;
          if (v.kind === 'heli' || v.kind === 'plane') v.yaw += VE.H.angDiff(v.yaw, why.turn) * Math.min(1, dt * 1.6);   // в воздухе — плавный разворот у границы
          else { v.spd *= -.15; v.vx = v.vz = 0; v.slip = 0; }
          ph.update(v.body, VE.bodyOf(v));
          if (VS.t - VS.warnAt > 2.5) { VS.warnAt = VS.t; toast(why.msg); }
        }
        netTick(v, dt);
      }
      seatMe();
      if (S.X) { S.X.cur = null; S.X.text = `${C.hint('interact')} Выйти${m.seat > 0 && !driverOn(v) ? ' · ' + C.hint('jump') + ' За руль' : ''}`; }
      // камера: сзади машины, если игрок не крутит сам; на скорости — шире
      const lk = Math.abs(S.I?.look?.dx || 0) + Math.abs(S.I?.look?.dy || 0) + Math.abs(C.look.dx) + Math.abs(C.look.dy);
      if (lk > .5) VS.lookAt = VS.t;
      if (rig.mode !== 'first' && VS.t - VS.lookAt > 1.2 && Math.abs(v.spd) > 2) rig.yaw = E.dampAngle(rig.yaw, v.yaw + PI, 2.2, dt);
      R.camera.userData.fov0 = 50 + 12 * E.clamp(Math.abs(v.spd) / v.def.speed.max, 0, 1);
      return true;
    };
    const CAM = { x: 0, y: 0, z: 0 };
    VS.camTarget = () => {
      const m = VS.me; if (!m || S.rig?.mode === 'first') return null;
      const v = m.v; CAM.x = v.x; CAM.y = v.y + v.def.cam.h - (S.rig?.lift || 1.5) + 1; CAM.z = v.z;
      return CAM;
    };
    VS.inVeh = () => !!VS.me;
    VS.driving = () => VS.me?.seat === 0;
    VS.leave = () => { if (VS.me) exit({ force: true, noPlace: true }); };
    // ── кнопки телефона ──
    function touch(on, v, seat){
      if (!S.I?.touch || !H?.buttons) return;
      if (!on) { if (rt.war?.W?.inZone && rt.war.touch) rt.war.touch(true); else H.buttons(BASE_BTNS); return; }
      const air = v.kind === 'heli' || v.kind === 'plane';
      if (seat > 0) { H.buttons([{ action: 'interact', icon: '🚪', label: 'выйти' }, { action: 'jump', icon: '🧑‍✈️', label: 'за руль' }]); return; }
      H.buttons(air
        ? [{ action: 'interact', icon: '🚪', label: 'выйти' }, { action: 'run', icon: '🚀', label: 'быстрее' }, { action: 'crouch', icon: '⬇', label: v.kind === 'plane' ? 'нос вниз' : 'вниз' }, { action: 'jump', icon: '⬆', label: v.kind === 'plane' ? 'нос вверх' : 'вверх', big: true }]
        : [{ action: 'interact', icon: '🚪', label: 'выйти' }, { action: 'horn', icon: '📯', label: 'сигнал' }, { action: 'run', icon: '🚀', label: 'быстрее' }, { action: 'jump', icon: '🅿️', label: 'тормоз', big: true }]);
    }
    // ── сеть ──
    function sendSnap(v, k){ rt.vehSend?.({ k, id: v.id, s: VE.pack(v, k === 'out'), c: v.claimAt || 0, ...(v.temp ? { d: v.def.id } : {}) }); }
    function netTick(v, dt){
      VS.sendT += dt;
      const moving = Math.abs(v.spd) > .3 || Math.abs(v.vy) > .3 || (v.kind === 'heli' && !v.grounded);
      if (VS.sendT >= (moving ? .2 : 1.2)) { VS.sendT = 0; sendSnap(v, 's'); }
    }
    VS.onMsg = (p, d) => {
      if (d.k === 'gone') { const g = VS.list.get(d.id); if (g?.temp && g.owner === p.key) VS.despawn(d.id); return true; }
      let v = VS.list.get(d.id); if (!['in', 's', 'out'].includes(d.k)) return true;
      const s = VE.unpack(d.s); if (!s) return true;
      if (!v && TEMP_RE.test(d.id) && typeof d.d === 'string' && VE.get(d.d) && d.k !== 'out' && VS.list.size < 60) {   // тест-драйв другого игрока
        v = VS.spawn(d.d, { id: d.id, x: s.x, z: s.z, yaw: s.yaw, temp: true }); if (v) { v.owner = p.key; v.y = s.y; }
      }
      if (!v) return true;
      const c = +d.c || 0, ts = +d.ts || Date.now();
      // кто ведёт: кто раньше сел (c), при равенстве — меньший ключ
      if (v.local && d.k !== 'out') {
        if (c < v.claimAt || (c === v.claimAt && p.key < S.key)) {
          const free = v.def.seats.findIndex((x, i) => i > 0 && !seatsOf(v)[i]);
          if (free > 0) { moveSeat(v, free); toast(`🪑 ${p.nick} сел за руль раньше — ты пассажир`); } else { exit({ force: true }); toast(`🚗 ${p.nick} сел за руль раньше`); }
        } else return true;
      }
      if (v.by && v.by !== p.key && v.by !== S.key && driverOn(v) && v.claimAt && v.claimAt < c) return true;   // уже ведёт тот, кто сел раньше
      // честность: тот же водитель — не быстрее машины и без телепортов; новый — начинает там, где машина стоит
      if (d.k !== 'out' && v.net && v.net.by === p.key) { const why = VE.snapOk(v.def, v.net.s, s, (ts - v.net.ts) / 1000); if (why) { v.bad++; return true; } }
      else if (Math.hypot(s.x - v.x, s.z - v.z) > 30) { v.bad++; return true; }
      v.net = { s, ts, at: now(), by: p.key };
      if (d.k === 'out') {
        Object.assign(v, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, roll: s.roll, spd: 0, vy: 0, eng: false, by: null, lastBy: p.key, idleAt: now(), broken: s.broken, grounded: s.grounded });
        ph.update(v.body, VE.bodyOf(v));
      } else { v.by = p.key; v.claimAt = c; v.idleAt = now(); }
      return true;
    };
    VS.onHi = () => setTimeout(() => { if (rt.stopped) return; for (const v of VS.list.values()) if (v.local) sendSnap(v, 's'); else if (!v.by && v.lastBy === S.key) sendSnap(v, 'out'); }, 300 + Math.random() * 1200);
    // ── удар, поломка ──
    function onCrash(v, k){
      if (VS.me?.v === v) { S.rig?.shake?.(Math.min(3, k * .15), .35); rt.sfx('hit', { vol: Math.min(1, .3 + k * .03) }); }
      else rt.sfx('hit', { x: v.x, y: v.y + 1, z: v.z, vol: Math.min(1, .2 + k * .03) });
      if (v.broken && v.local) {
        toast(`💥 ${v.def.name} разбит! Новый появится на стоянке`, false);
        puff(v, 'smoke');
        setTimeout(() => { if (VS.me?.v === v) exit({ force: true }); }, 600);
      }
    }
    function puff(v, kind){ const FX = S.FX; if (!FX) return; const e = FX.emitter({ kind, at: [v.x, v.y + 1.2, v.z], rate: 0, size: 1.2 }); e.burst(24); setTimeout(() => e.dispose(), 4000); }
    // ── шаг: чужие машины — плавно к снимку (с предсказанием), пассажиры и водители — на сиденьях, возврат на стоянку ──
    VS.update = dt => {
      const t = now();
      for (const v of VS.list.values()) {
        if (v.local) continue;
        const n = v.net;
        if (v.by && n) {
          const s = n.s, age = Math.min(.6, (t - n.at) / 1000), hs = s.spd * Math.cos(s.pitch);
          const tx = s.x + Math.sin(s.yaw) * hs * age, tz = s.z + Math.cos(s.yaw) * hs * age, ty = s.y + (v.kind === 'heli' || v.kind === 'plane' ? s.vy * age : 0);
          if (Math.hypot(tx - v.x, ty - v.y, tz - v.z) > 12) { v.x = tx; v.y = ty; v.z = tz; v.yaw = s.yaw; }
          else { const k = 1 - Math.exp(-dt * 8); v.x += (tx - v.x) * k; v.y += (ty - v.y) * k; v.z += (tz - v.z) * k; v.yaw += VE.H.angDiff(v.yaw, s.yaw) * k; }
          const k2 = Math.min(1, dt * 8);
          v.pitch += (s.pitch - v.pitch) * k2; v.roll += (s.roll - v.roll) * k2;
          Object.assign(v, { spd: s.spd, steer: s.steer, rotor: s.rotor, eng: s.eng, lights: s.lights, broken: s.broken, grounded: s.grounded, boost: s.boost });
          if (s.horn && !v._hornN) { v._hornN = true; rt.sfx('horn', { x: v.x, y: v.y + 1, z: v.z, vol: .6 }); } else if (!s.horn) v._hornN = false;
          ph.update(v.body, VE.bodyOf(v));
          if (!driverOn(v)) { v.by = null; v.eng = false; v.spd = 0; v.idleAt = t; }   // водитель ушёл из мира — машина стоит, где была
        } else if (!v.settled) {
          const zs = rt.zones.get(v.zone);   // зона построилась — встать на площадку/перрон (до постройки — на земле)
          if (zs?.built) { v.y = restY(v.def, v.x, v.z, v.spotY, v.body); v.home.y = v.y; v.settled = true; ph.update(v.body, VE.bodyOf(v)); }
        }
        if (v.temp && v.owner !== S.key && (!S.players.get(v.owner) || S.players.get(v.owner).leaving) && t - v.idleAt > 30000) { VS.despawn(v.id); continue; }
        if (v.temp) continue;   // у тест-драйва нет стоянки
        // никто не едет давно (или разбит) и рядом никого — обратно на стоянку целой
        const moved = Math.hypot(v.x - v.home.x, v.z - v.home.z) > 6 || Math.abs(v.y - v.home.y) > 3;
        if (!v.by && (v.broken ? t - v.idleAt > 20000 : moved && t - v.idleAt > 240000) && !seatsOf(v).some(Boolean) && !nearPlayer(v, 25)) home(v);
      }
      // чужие на сиденьях: тело — у места (подписи и дальность — по нему)
      for (const p of S.players.values()) {
        const zv = p.zx?.v, v = zv && VS.list.get(zv[0]); if (!v || p.leaving) continue;
        const sp = v.def.seats[zv[1]] || v.def.seats[0]; VE.local(v, sp.pos, SEAT);
        p.ch.x = SEAT.x; p.ch.y = SEAT.y - .4; p.ch.z = SEAT.z; p.ch.vx = p.ch.vy = p.ch.vz = 0; p.ch.grounded = true; p.yaw = v.yaw;
      }
      if (VS.me && VS.me.seat > 0) seatMe();
      // пассажир: машина въехала туда, куда мне по возрасту нельзя — выйти (ворота зон вернут на безопасное место)
      if (VS.me && VS.me.seat > 0) { const Zn = Z.zoneAt(VS.me.v.x, VS.me.v.z); if (Zn && !Z.gateOf(Zn).ok) { exit({ force: true }); } }
    };
    const nearPlayer = (v, r) => Math.hypot(S.P.ch.x - v.x, S.P.ch.z - v.z) < r || [...S.players.values()].some(p => !p.leaving && Math.hypot(p.ch.x - v.x, p.ch.z - v.z) < r);
    function home(v){
      Object.assign(v, { x: v.home.x, z: v.home.z, yaw: v.home.yaw, pitch: 0, roll: 0, spd: 0, vy: 0, vx: 0, vz: 0, eng: false, lastBy: null, idleAt: now(), net: null, grounded: true, thr: 0, rotor: 0 });
      v.y = restY(v.def, v.x, v.z, v.spotY, v.body); VE.repair(v); VE.refuel(v); v.drown = 0;
      ph.update(v.body, VE.bodyOf(v));
    }
    // ── поза седоков: сидят в машине (до A.update) ──
    VS.preActors = () => {
      const pose = (a, v, seat) => { const sp = v.def.seats[seat] || v.def.seats[0]; VE.local(v, sp.pos, SEAT); a.x = SEAT.x; a.z = SEAT.z; a.y = SEAT.y; a.sit = true; a.seatY = SEAT.y; a.yaw = v.yaw; a.moving = false; a.speed = 0; a.air = false; a.crouch = 0; a.roll = -1; a.swim = false; a.dive = false; };
      if (VS.me) { const a = S.A.get(S.key); if (a) pose(a, VS.me.v, VS.me.seat); }
      for (const p of S.players.values()) { const zv = p.zx?.v, v = zv && VS.list.get(zv[0]); const a = v && S.A.get(p.key); if (a && !p.leaving) pose(a, v, zv[1]); }
    };
    // ── кадр: вид машин рядом (строится у камеры, вдали — убирается), колёса и винты, подсказки, звук мотора ──
    const VIEW_IN = 150, VIEW_OUT = 190;
    VS.frame = dt => {
      const cam = R.camera.position;
      for (const v of VS.list.values()) {
        const d = Math.hypot(v.x - cam.x, v.z - cam.z);
        // стоит без мотора — склеенный вид (колёса и винты не крутятся); едет, винт крутится, рядом — живой (колёса, винты)
        const live = d < (v.view && !v.view.still ? 80 : 70) && (v.local || !!v.by || v.eng || v.rotor > .02 || Math.abs(v.spd) > .05);
        if (v.view && (d > VIEW_OUT || v.view.still === live)) { v.view.dispose(); v.view = null; }
        if (!v.view && d < VIEW_IN) { v.view = VE.view(R, v.def, { merge: (R2, g) => Z.merge(R2, g, { chunk: 0 }), glass: glass(), still: !live }); R.scene.add(v.view.g); }
        if (v.view) {
          if (!v.local && !v.by && v.kind === 'boat') { const tt = now() / 1000 + v.home.x; v.pitch = Math.sin(tt * 1.3) * .02; v.roll = Math.sin(tt * 1.7 + 1) * .03; }   // стоит — качается
          v.view.update(v, dt);
        }
        if (v.item) { v.item.x = v.x; v.item.y = v.y + 1; v.item.z = v.z; }
      }
      sounds();
      hud();
    };
    // звук мотора: до 3 ближних машин с мотором (своя — громче), высота тона — по скорости/оборотам
    function sounds(){
      const A = S.AU; if (!A?.loop) return;
      const cam = R.camera.position, L = [...VS.list.values()].filter(v => v.eng || v.rotor > .05).map(v => [v, Math.hypot(v.x - cam.x, v.y - cam.y, v.z - cam.z)]).filter(([, d]) => d < 60).sort((a, b) => a[1] - b[1]).slice(0, 3);
      const want = new Set(L.map(([v]) => v.id));
      for (const [id, h] of VS.loops) if (!want.has(id)) { h.stop(); VS.loops.delete(id); }
      for (const [v] of L) {
        let h = VS.loops.get(v.id);
        if (!h) { h = A.loop(v.def.sound, { x: v.x, y: v.y, z: v.z, vol: 0 }); VS.loops.set(v.id, h); }
        const S0 = v.def.speed.max, k = v.kind === 'plane' ? .3 + .7 * v.rotor : v.kind === 'heli' ? v.rotor : Math.min(1, Math.abs(v.spd) / S0);
        h.set({ x: v.x, y: v.y + 1, z: v.z, vol: (VS.me?.v === v ? .5 : .38) * (v.kind === 'heli' ? v.rotor : .45 + .55 * k), rate: (v.kind === 'heli' ? .6 + .5 * v.rotor : .7 + .9 * k) });
      }
    }
    // плашка водителя: скорость, высота, бак, прочность
    const hudEl = document.createElement('div'); hudEl.className = 'mz-veh'; hudEl.hidden = true; rt.hud.appendChild(hudEl);
    let hudT = 0;
    function hudShow(on){ hudEl.hidden = !on; }
    function hud(){
      const m = VS.me; if (!m) { if (!hudEl.hidden) hudShow(false); return; }
      if (now() - hudT < 150) return; hudT = now();
      const v = m.v, d = v.def, kmh = Math.round(Math.abs(v.spd) / (E.UNIT || 1.17) * 3.6);
      const alt = d.kind === 'heli' || d.kind === 'plane' ? ` · ↑ ${Math.max(0, Math.round((v.y - ph.groundAt(v.x, v.z)) / (E.UNIT || 1.17)))} м` : '';
      const fuel = d.fuel ? ` · ⛽ ${Math.round(v.fuel / d.fuel.cap * 100)}%` : '', hp = v.hp < d.hp ? ` · ❤️ ${Math.round(v.hp / d.hp * 100)}%` : '';
      const thr = d.kind === 'plane' && m.seat === 0 ? ` · газ ${Math.round(v.thr * 100)}%` : '';
      hudEl.textContent = `${d.icon} ${kmh} км/ч${alt}${thr}${fuel}${hp}${v.lights ? ' · 💡' : ''}`;
      hudShow(true);
    }
    VS.esc = () => false;
    VS.dispose = () => {
      if (VS.me) exit({ force: true, noPlace: true });
      for (const v of VS.list.values()) { v.view?.dispose(); VE.removeBody(v, ph); if (v.item) X.remove(v.item); }
      for (const h of VS.loops.values()) h.stop();
      VS.loops.clear(); VS.list.clear(); hudEl.remove();
    };
    VS.spawn = (defId, o = {}) => {   // гараж / прокат / тест-драйв: машина у точки (своя: id должен быть ID_RE)
      const d = VE.get(defId); if (!d || !o.id || VS.list.has(o.id)) return null;
      const v = VE.create(d, { id: o.id, x: o.x, y: restY(d, o.x, o.z), z: o.z, yaw: o.yaw || 0 });
      Object.assign(v, { area: o.area || null, zone: o.zone || null, view: null, by: null, claimAt: 0, lastBy: null, idleAt: now(), net: null, bad: 0, settled: true, local: false, temp: !!o.temp });
      VE.addBody(v, ph);
      v.item = X.add({ x: v.x, y: v.y + 1, z: v.z, r: Math.max(1.4, d.size[2] * .42), col: v.body, prompt: () => promptOf(v), act: () => tryEnter(v) });
      VS.list.set(v.id, v);
      return v;
    };
    const TEMP_RE = /^t_[a-z0-9]{2,12}$/;
    VS.testDrive = (defId, at) => {
      if (!VE.get(defId) || VS.me) return null;
      const old = [...VS.list.values()].find(v => v.temp && v.owner === S.key);
      if (old) { rt.vehSend?.({ k: 'gone', id: old.id }); VS.despawn(old.id); }
      const tag = (S.key || 'me').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-6) || 'me';
      const v = VS.spawn(defId, { id: 't_' + tag + (Date.now() % 1296).toString(36), x: at.x, z: at.z, yaw: at.yaw || 0, temp: true, zone: at.zone || null });
      if (!v) return null;
      v.owner = S.key;
      enter(v, 0);
      toast(`🚗 Тест-драйв: ${v.def.name} — 5 минут`, true);
      clearTimeout(v.endT); v.endT = setTimeout(() => { if (VS.list.get(v.id) !== v) return; if (VS.me?.v === v) { exit({ force: true }); toast('🚗 Тест-драйв окончен — понравилось? Скоро можно будет купить'); } rt.vehSend?.({ k: 'gone', id: v.id }); VS.despawn(v.id); }, 300000);
      return v;
    };
    VS.despawn = id => {
      const v = VS.list.get(id); if (!v) return false;
      if (VS.me?.v === v) exit({ force: true });
      v.view?.dispose(); VE.removeBody(v, ph); if (v.item) X.remove(v.item);
      for (const [k, h] of VS.loops) if (k === id) { h.stop(); VS.loops.delete(k); }
      VS.list.delete(id); return true;
    };
    VS._ = { enter, exit, seatsOf, home, blockedAt, env };
    return VS;
  }
  root.MirVeh = { start, spots, AREA_MSG };
})();
