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

  // ═══ Фоновое движение: кольцо квартала в правом ряду и место машины по часам (чистые функции — проверяются в node) ═══
  function laneLoop(rect, off = 2){
    const [x0, z0, x1, z1] = rect, C = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const R0 = C.map((a, i) => { const b = C[(i + 1) % 4], dx = Math.sign(b[0] - a[0]), dz = Math.sign(b[1] - a[1]); return [-dz, dx]; });   // правая сторона по ходу
    return C.map((c, i) => { const p = R0[(i + 3) % 4], q = R0[i]; return [c[0] + (p[0] + q[0]) * off, c[1] + (p[1] + q[1]) * off]; });
  }
  // где машина трафика в момент sec: на отрезке кольца, нос — по отрезку, у угла — плавно к следующему
  function trafficPose(T0, sec, v){
    const L = T0.L, s = ((((sec * T0.t.speed) / L + (T0.t.phase || 0)) % 1) + 1) % 1 * L;
    let k = 0; while (k < T0.P.length - 1 && T0.cum[k + 1] <= s) k++;
    const n = T0.P.length, a = T0.P[k], b = T0.P[(k + 1) % n], seg = T0.cum[k + 1] - T0.cum[k], u = (s - T0.cum[k]) / seg;
    v.x = a[0] + (b[0] - a[0]) * u; v.z = a[1] + (b[1] - a[1]) * u; v.y = 0;
    let yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const left = seg - (s - T0.cum[k]), done = s - T0.cum[k];
    if (left < 3) { const c = T0.P[(k + 2) % n]; yaw += root.D37E.vehicle.H.angDiff(yaw, Math.atan2(c[0] - b[0], c[1] - b[1])) * (1 - left / 3) * .5; }
    else if (done < 3) { const z0 = T0.P[(k - 1 + n) % n]; yaw += root.D37E.vehicle.H.angDiff(yaw, Math.atan2(a[0] - z0[0], a[1] - z0[1])) * (1 - done / 3) * .5; }
    v.yaw = yaw; v.spd = T0.t.speed; v.rotor = 0;
    return v;
  }
  function start(rt){
    const VE = root.D37E?.vehicle, Z = MZ(); if (!VE || !Z) return null;
    const S = rt.S, R = rt.R, T = rt.T, ph = rt.ph, X = rt.X, H = rt.H, E = rt.E, toast = rt.toast;
    const now = () => performance.now();
    const VS = { list: new Map(), me: null, t: 0, lookAt: -9, sendT: 0, warnAt: -9, hinted: new Set(), cam0: null, loops: new Map() };
    const map = !!Z.worldMap?.();   // карта-рельеф: ездить и плавать — по всей карте, летать — выше гор
    // волны (waves.js через mir.js S.waves): поле воды под лодкой; удар о волну — брызги, лодку перевернуло — люди в воду
    const env = { ph, water: (x, z) => (ph.waterLevel ? ph.waterLevel(x, z) : -Infinity), bounds: map ? Z.mapBounds() : Z.bounds(), maxY: map ? 640 : undefined, onCrash,
      waves: (x, z) => S.waves?.live(x, z) || null, onSlam, onCapsize };
    const BOAT = VE.KINDS.boat;
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
      if (v.capsized) return `🌊 ${d.icon} ${d.name} перевернулся — скоро встанет`;
      const occ = seatsOf(v);
      if (v.temp && v.owner !== S.key) { const fr = d.seats.findIndex((s, i) => i > 0 && !occ[i]); return fr > 0 ? `🪑 Сесть пассажиром · ${d.name} (тест-драйв)` : null; }
      if (!occ[0] && !driverOn(v)) return `${d.icon} Сесть за руль · ${d.name}`;
      const free = d.seats.findIndex((s, i) => i > 0 && !occ[i]);
      return free > 0 ? `🪑 Сесть пассажиром · ${d.name}` : null;
    }
    function tryEnter(v){
      if (VS.me || v.broken || v.capsized) return;
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
      if (m.seat > 0) {   // пассажир въехал в зону не по своему возрасту — высадить там, где был снаружи
        const Zn = Z.zoneAt(v.x, v.z);
        if (Zn?.age && !Z.gateOf(Zn).ok) {
          exit({ force: true, noPlace: true });
          const s = rt.safe; if (s) S.P.place(s.x, s.y, s.z, S.P.yaw); else { const p = exitSpot(v, m.seat); S.P.place(p.x, p.y, p.z, v.yaw); }
          toast(`${Zn.icon} ${Zn.name}: вход только ${Zn.age}+ — ты вышел у границы`);
          return true;
        }
      }
      if (m.seat > 0 && !driverOn(v) && C.down('jump')) { moveSeat(v, 0); return true; }
      if (m.seat === 0 && v.local) {
        if (C.down('horn')) { v.horn = .6; rt.sfx('horn', { x: v.x, y: v.y + 1, z: v.z, vol: .7 }); }
        if (C.down('lights') && v.def.lights) { v.lights = !v.lights; rt.sfx('click', { vol: .4 }); }
        const ox = v.x, oz = v.z;
        smash(v);
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
      const UI = S.H;   // кнопки телефона — интерфейс движка (E.ui), не помощники mir.js
      if (!S.I?.touch || !UI?.buttons) return;
      if (!on) { if (rt.war?.W?.inZone && rt.war.touch) rt.war.touch(true); else UI.buttons(BASE_BTNS); return; }
      const air = v.kind === 'heli' || v.kind === 'plane';
      if (seat > 0) { UI.buttons([{ action: 'interact', icon: '🚪', label: 'выйти' }, { action: 'jump', icon: '🧑‍✈️', label: 'за руль' }]); return; }
      UI.buttons(air
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
        if (v.kind === 'boat') capFrom(v, s, true);
        ph.update(v.body, VE.bodyOf(v));
      } else { v.by = p.key; v.claimAt = c; v.idleAt = now(); }
      return true;
    };
    VS.onHi = () => setTimeout(() => { if (rt.stopped) return; for (const v of VS.list.values()) if (v.local) sendSnap(v, 's'); else if (!v.by && v.lastBy === S.key) sendSnap(v, 'out'); }, 300 + Math.random() * 1200);
    // ── удар, поломка ──
    function onCrash(v, k){
      if (k > 8) rt.scare?.(v.x, v.z, 10);
      if (k > 6) { const [fx, fz] = VE.fwd(v); rt.destruct?.burst('sparks', v.x + fx * v.def.size[2] * .45, v.y + .6, v.z + fz * v.def.size[2] * .45, Math.min(24, 6 + k | 0)); }
      if (VS.me?.v === v) { S.rig?.shake?.(Math.min(3.5, k * .17), .4); S.rig?.kick?.(Math.min(1, k * .05)); rt.sfx('hit', { vol: Math.min(1, .3 + k * .03) }); }
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
          if (v.kind === 'boat') { capFrom(v, s, false); boatPose(v, dt); }   // качка на волне — у себя (волны у всех одни; по сети — только место и курс)
          if (s.hp != null) v.hp = Math.min(v.def.hp, s.hp);
          if (s.horn && !v._hornN) { v._hornN = true; rt.sfx('horn', { x: v.x, y: v.y + 1, z: v.z, vol: .6 }); } else if (!s.horn) v._hornN = false;
          ph.update(v.body, VE.bodyOf(v));
          if (!driverOn(v)) { v.by = null; v.eng = false; v.spd = 0; v.idleAt = t; }   // водитель ушёл из мира — машина стоит, где была
        } else if (!v.settled) {
          const zs = rt.zones.get(v.zone);   // зона построилась — встать на площадку/перрон (до постройки — на земле)
          if (zs?.built) { v.y = restY(v.def, v.x, v.z, v.spotY, v.body); v.home.y = v.y; v.settled = true; ph.update(v.body, VE.bodyOf(v)); }
        } else if (v.kind === 'boat') boatPose(v, dt);   // стоит у причала — качается на волне
        if (v.capsized && !v.by && v.capWall && t > v.capWall) { v.capsized = 0; v.capWall = 0; }   // перевёрнутая без водителя — встала сама
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
      if (VS.me && VS.me.seat > 0 && VS.me.v.capsized) intoWater(VS.me.v);   // пассажир: лодку перевернуло — в воду рядом
    };
    // ── волны (waves.js): качка чужой и стоящей лодки — у себя (дальше 220 от камеры — не нужна); удар о волну; переворот ──
    function boatPose(v, dt){
      const c = R.camera.position, d = Math.hypot(v.x - c.x, v.z - c.z);
      if (d > 220) return;
      const yr = v._pyaw === undefined ? 0 : VE.H.angDiff(v._pyaw, v.yaw) / Math.max(dt, 1e-3); v._pyaw = v.yaw;
      if (BOAT.pose(v, dt, env, { yr: Math.max(-1.5, Math.min(1.5, yr)), dist: d })) ph.update(v.body, VE.bodyOf(v));
    }
    function capFrom(v, s, out){   // снимок: перевёрнута ли (флаг FL.capsized); без водителя встаёт по своим часам через 8 с
      if (s.capsized) { if (!v.capsized) { v.capsized = 1; v.capSg = s.roll >= 0 ? 1 : -1; } if (out || !v.capWall) v.capWall = now() + 8000; }
      else if (v.capsized) { v.capsized = 0; v.capWall = 0; }
    }
    function onSlam(v, k){
      const [fx, fz] = VE.fwd(v), L = v.def.size[2] * .48, x = v.x + fx * L, z = v.z + fz * L, y = v.y + v.def.water.draft;
      fxAt('fountain', x, y + .15, z, Math.round(5 + k * 16), '#f1f8ff', .9 + k * .8);
      if (VS.me?.v === v) { S.rig?.shake?.(Math.min(1.4, .3 + k * 1.2), .25); S.rig?.kick?.(Math.min(.5, .15 + k * .4)); }
      rt.sfx('step_water' + (k > .5 ? 2 : 1), { x, y, z, vol: Math.min(1, .3 + k * .6), rate: .78 });
    }
    function intoWater(v){   // меня — в воду у борта, на который легла лодка
      if (VS.me?.v !== v) return;
      exit({ force: true, noPlace: true });
      const [rx, rz] = VE.right(v), sd = (v.capSg || 1) >= 0 ? 1 : -1, w = v.def.size[0] / 2 + 1.3, x = v.x + rx * w * sd, z = v.z + rz * w * sd, wl = env.water(x, z);
      S.P.place(x, wl > -Infinity ? wl - 1 : v.y, z, S.P.yaw);
      toast('🌊 Лодку перевернуло волной! В шторм не поворачивай круто на полном ходу. Подожди — она встанет сама', true);
      rt.sfx('step_water0', { vol: .9, rate: .7 });
    }
    function onCapsize(v){
      v.capWall = now() + 8000;
      fxAt('fountain', v.x, v.y + .4, v.z, 26, '#eaf6ff', 1.4);
      if (VS.me?.v === v) intoWater(v);
    }
    const nearPlayer = (v, r) => Math.hypot(S.P.ch.x - v.x, S.P.ch.z - v.z) < r || [...S.players.values()].some(p => !p.leaving && Math.hypot(p.ch.x - v.x, p.ch.z - v.z) < r);
    function home(v){
      Object.assign(v, { x: v.home.x, z: v.home.z, yaw: v.home.yaw, pitch: 0, roll: 0, spd: 0, vy: 0, vx: 0, vz: 0, eng: false, lastBy: null, idleAt: now(), net: null, grounded: true, thr: 0, rotor: 0 });
      v.y = restY(v.def, v.x, v.z, v.spotY, v.body); VE.repair(v); VE.refuel(v); v.drown = 0;
      v.capsized = 0; v.capWall = 0; v.wy = undefined;   // волны: качка — заново с места
      ph.update(v.body, VE.bodyOf(v));
    }
    // ── поза седоков: сидят в машине (до A.update) ──
    VS.preActors = () => {
      const pose = (a, v, seat) => { const sp = v.def.seats[seat] || v.def.seats[0]; VE.local(v, sp.pos, SEAT); a.x = SEAT.x; a.z = SEAT.z; a.y = SEAT.y; a.sit = true; a.seatY = SEAT.y; a.yaw = v.yaw; a.moving = false; a.speed = 0; a.air = false; a.crouch = 0; a.roll = -1; a.swim = false; a.dive = false; };
      if (VS.me) { const a = S.A.get(S.key); if (a) pose(a, VS.me.v, VS.me.seat); }
      for (const p of S.players.values()) { const zv = p.zx?.v, v = zv && VS.list.get(zv[0]); const a = v && S.A.get(p.key); if (a && !p.leaving) pose(a, v, zv[1]); }
    };
    // ═══ Фоновое движение (ИИ-трафик): машины по кольцам улиц, место — по часам (Date.now; у всех одинаково, без сети).
    //     Описание зоны: traffic: [{ id, def, rect: [x0, z0, x1, z1], speed, phase (доля кольца 0…1) }] — по часовой стрелке,
    //     в правом ряду (2 м от середины улицы). Сквозь препятствия не тормозят (фон): тело есть — игрока и машины отодвигает ═══
    const TR = [];
    for (const [zid, d] of Object.entries(Z.DEFS)) for (const t of d.traffic || []) {
      const def = VE.get(t.def); if (!def || !Array.isArray(t.rect)) continue;
      const P = laneLoop(t.rect), cum = [0];
      for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
      const v = VE.create(def, { id: 'tr_' + t.id, x: P[0][0], z: P[0][1] }); v.eng = true; v.traffic = true;
      TR.push({ t, zone: zid, P, cum, L: cum[cum.length - 1], v, view: null });
    }
    VS.traffic = TR;
    VS.trafficPose = trafficPose;
    function trafficTick(dt){
      if (!TR.length) return;
      const sec = Date.now() / 1000, cam = R.camera.position, me = S.P.ch;
      for (const T0 of TR) {
        const v = T0.v, shown = !!rt.zones.get(T0.zone)?.shown;
        trafficPose(T0, sec, v);
        const dCam = Math.hypot(v.x - cam.x, v.z - cam.z), dMe = Math.hypot(v.x - me.x, v.z - me.z);
        const live = dCam < (T0.view && !T0.view.still ? 55 : 45);   // рядом — колёса крутятся, дальше — склеенный вид
        if (T0.view && (!shown || dCam > 210 || T0.view.still === live)) { T0.view.dispose(); T0.view = null; }
        if (!T0.view && shown && dCam < 200) { T0.view = VE.view(R, v.def, { merge: (R2, g) => Z.merge(R2, g, { chunk: 0 }), glass: glass(), still: !live }); R.scene.add(T0.view.g); }
        T0.view?.update(v, dt);
        if (shown && dMe < 120) { if (!v.body) VE.addBody(v, ph); else ph.update(v.body, VE.bodyOf(v)); } else if (v.body) VE.removeBody(v, ph);
      }
    }
    // ── кадр: вид машин рядом (строится у камеры, вдали — убирается), колёса и винты, подсказки, звук мотора ──
    const VIEW_IN = 150, VIEW_OUT = 190;
    VS.frame = dt => {
      const cam = R.camera.position;
      let made = 0;   // новых видов — один за кадр (свой / с водителем — сразу): стоянка у зоны — не все разом
      for (const v of VS.list.values()) {
        const d = Math.hypot(v.x - cam.x, v.z - cam.z);
        // стоит без мотора — склеенный вид (колёса и винты не крутятся); едет, винт крутится, рядом — живой (колёса, винты)
        const live = d < (v.view && !v.view.still ? 80 : 70) && (v.local || !!v.by || v.eng || v.rotor > .02 || Math.abs(v.spd) > .05 || v.hp < v.def.hp);
        if (v.view && (d > VIEW_OUT || v.view.still === live)) { v.view.dispose(); v.view = null; }
        if (!v.view && d < VIEW_IN && (made++ < 1 || v.local || v.by)) {
          const a0 = rt.prof ? now() : 0;
          v.view = VE.view(R, v.def, { merge: (R2, g) => Z.merge(R2, g, { chunk: 0 }), glass: glass(), still: !live });
          if (!v.local && !v.by && rt.warm?.compile([v.view.g]).length) v.view.warm = true; else R.scene.add(v.view.g);
          if (rt.prof) rt.prof.push(['vview', v.id, live ? 'live' : 'still', +(now() - a0).toFixed(1), rt.frameNo]);
        }
        if (v.view?.warm && (v.local || v.by || rt.warm.poll())) { v.view.warm = false; R.scene.add(v.view.g); }
        if (v.view) {
          if (!v.local && !v.by && v.kind === 'boat' && v.wy === undefined) { const tt = now() / 1000 + v.home.x; v.pitch = Math.sin(tt * 1.3) * .02; v.roll = Math.sin(tt * 1.7 + 1) * .03; }   // стоит — качается (на волнах — boatPose)
          v.view.update(v, dt);
          if (d < 70) { damageTick(v, dt); if (d < 60 && !v.view.still) effects(v, dt); }
        }
        if (v.item) { v.item.x = v.x; v.item.y = v.y + 1; v.item.z = v.z; }
      }
      trafficTick(dt);
      sounds();
      hud();
    };
    // ═══ Живость: пыль и дым из-под колёс, следы шин, брызги и след лодки, пыль от винта; повреждения: двери, бампер, колёса
    //     отваливаются, дым → огонь → сгоревший остов (по прочности — у всех одинаково: прочность идёт в снимке) ═══
    const DIRT = (x, z) => { const Zn = Z.zoneAt(x, z); if (Zn) return Zn.id === 'war' ? 'sand' : null; const M = Z.worldMap?.(); return M && !M.road(x, z) ? 'dirt' : null; };
    const marks = (() => {   // следы шин: одна сетка-кольцо из полосок на земле (200), старые уступают место
      const N = R.q === 'low' ? 0 : 200; if (!N) return null;
      const geo = new T.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
      const mat = new T.MeshBasicMaterial({ color: '#1f1f1f', transparent: true, opacity: .32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const im = new T.InstancedMesh(geo, mat, N); im.count = N; im.frustumCulled = false; im.userData.dyn = true; im.renderOrder = 1;
      const z0 = new T.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < N; i++) im.setMatrixAt(i, z0);
      R.scene.add(im);
      const m4 = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(), up = new T.Vector3(0, 1, 0);
      let i = 0;
      return { add(x, y, z, yaw, len){ q.setFromAxisAngle(up, yaw); m4.compose(p.set(x, y + .04, z), q, s.set(.32, 1, Math.max(.3, len))); im.setMatrixAt(i, m4); i = (i + 1) % N; im.instanceMatrix.needsUpdate = true; },
        dispose(){ R.scene.remove(im); geo.dispose(); mat.dispose(); } };
    })();
    VS.marks = marks;
    const FXA = {};
    function fxAt(kind, x, y, z, n, color, size){
      const FX = S.FX; if (!FX || n <= 0) return;
      const key = kind + (color || '') + (size || '');
      let e = FXA[key]; if (!e) e = FXA[key] = FX.emitter({ kind, at: [x, y, z], rate: 0, size: size || 1, color, color2: color });
      e.set({ at: [x, y, z] }); e.burst(n);
    }
    function effects(v, dt){
      const d = v.def, sp = Math.abs(v.spd), [fx, fz] = VE.fwd(v), [rx, rz] = VE.right(v), L = d.size[2] * .42, W2 = d.size[0] * .42;
      const acc = v._fxSpd == null ? 0 : (v.spd - v._fxSpd) / Math.max(dt, 1e-3); v._fxSpd = v.spd;
      v._fxAcc = (v._fxAcc || 0) + dt;
      if (v.kind === 'car' && v.grounded) {
        const skid = Math.abs(v.slip || 0) > 2.2 || (acc < -14 && sp > 6) || (v.load > .9 && sp < 4 && v.local);
        const dirt = sp > 5 ? DIRT(v.x, v.z) : null;
        if ((skid || dirt) && v._fxAcc > .07) {
          v._fxAcc = 0;
          for (const s of [-1, 1]) {
            const wx = v.x - fx * L + rx * W2 * s, wz = v.z - fz * L + rz * W2 * s;
            if (skid) fxAt('smoke', wx, v.y + .25, wz, 2, '#d1d5db', .7);
            if (dirt) fxAt('smoke', wx, v.y + .3, wz, Math.min(4, 1 + sp / 8 | 0), dirt === 'sand' ? '#d6c08a' : '#a08a64', .9);
            if (skid && marks) { const len = Math.max(.4, sp * .08); marks.add(wx - fx * len / 2, v.y, wz - fz * len / 2, v.yaw, len); }
          }
        }
      } else if (v.kind === 'boat' && sp > 3 && v._fxAcc > .06) {   // нос режет воду — брызги; за кормой — пена
        v._fxAcc = 0; const wl = env.water(v.x, v.z), y = v.wy !== undefined ? v.y + v.def.water.draft : wl > -Infinity ? wl : v.y;   // на волне — гладь у лодки
        fxAt('fountain', v.x + fx * L, y + .2, v.z + fz * L, Math.min(6, sp / 4 | 0), '#eaf6ff', .8);
        fxAt('smoke', v.x - fx * L * 1.1, y + .05, v.z - fz * L * 1.1, 2, '#f8fafc', .7);
      } else if (v.kind === 'heli' && v.rotor > .7 && v._fxAcc > .1) {   // пыль (или брызги) от винта у земли
        const gy = ph.groundAt(v.x, v.z), h = v.y - gy;
        if (h < 14) { v._fxAcc = 0; const wl = env.water(v.x, v.z), onW = wl > gy + .3, n = Math.max(1, 5 - h / 3 | 0);
          for (let k = 0; k < 2; k++) { const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 3; fxAt(onW ? 'fountain' : 'smoke', v.x + Math.cos(a) * r, (onW ? wl : gy) + .2, v.z + Math.sin(a) * r, n, onW ? '#eaf6ff' : '#b59a73', .9); } }
      } else if (v.kind === 'plane' && !v.grounded && sp > d.air.takeoff * 1.3 && Math.abs(v.roll) > .45 && v._fxAcc > .08) {   // крутой вираж — след с концов крыльев
        v._fxAcc = 0; for (const s of [-1, 1]) fxAt('smoke', v.x + rx * d.size[0] * .48 * s, v.y + 1.2, v.z + rz * d.size[0] * .48 * s, 1, '#ffffff', .4);
      }
    }
    // повреждения по прочности (у всех одинаково): ≤ 70 % — дверь, ≤ 50 % — вторая дверь и бампер + дым, ≤ 30 % — колесо, ≤ 15 % — огонь,
    // 0 — сгоревший остов; починили (вернулась на стоянку) — как новая. Детский городок (карт 0+) — без этого
    function damageTick(v, dt){
      const vw = v.view, d = v.def; if (!vw || d.age < 12 && v.zone === 'kids') return;
      const k = v.hp / d.hp, lv = v.broken || k <= 0 ? 5 : k <= .15 ? 4 : k <= .3 ? 3 : k <= .5 ? 2 : k <= .7 ? 1 : 0;
      if (lv === 0) { if (vw.gone.size || vw.isBurnt) vw.reset(); v._dlv = 0; return; }
      const seed = [...v.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7), DS = rt.destruct;
      const drop = (name, shape, sx, sy, sz, c) => { const p = vw.drop(name); if (p && DS) { const [rx, rz] = VE.right(v), s = name.endsWith('_r') || /wheel[13]/.test(name) ? -1 : 1; DS.debris({ shape, x: p.x, y: p.y, z: p.z, sx, sy, sz, c, vx: rx * 3 * s + v.vx * .5, vy: 3, vz: rz * 3 * s + v.vz * .5, life: 20 }); } };
      const col = d.model.parts.find(p => p.loose === 'door_l')?.c || '#64748b';
      if (lv >= 1) drop(seed % 2 ? 'door_l' : 'door_r', 'box', .08, .55, 1.3, col);
      if (lv >= 2) { drop(seed % 2 ? 'door_r' : 'door_l', 'box', .08, .55, 1.3, col); drop('bumper', 'box', 2, .26, .2, '#334155'); drop('spare', 'cyl', .84, .26, .84, '#111827'); }
      if (lv >= 3) drop('wheel' + (seed % 4), 'cyl', .8, .3, .8, '#111827');
      if (lv >= 5 && !vw.isBurnt) { vw.burnt(true); if (v._dlv !== 5) boom(v); }
      v._dlv = lv;
      // дым и огонь — от мотора (перед машины)
      v._smk = (v._smk || 0) + dt;
      if (lv >= 2 && v._smk > (lv >= 4 ? .08 : .18)) {
        v._smk = 0; const [fx, fz] = VE.fwd(v), f = v.kind === 'car' ? d.size[2] * .32 : 0, x = v.x + fx * f, z = v.z + fz * f, y = v.y + d.size[1] * .75;
        fxAt('smoke', x, y, z, lv >= 4 ? 3 : 1, lv >= 5 ? '#1f2937' : '#6b7280', 1);
        if (lv === 4 || (lv === 5 && now() - (v._boomAt || 0) < 12000)) fxAt('fire', x, y - .2, z, 2, null, .8);
      }
    }
    // взрыв разбитой машины: огонь, искры, толчок рядом; своя (водитель или последний) — ломает мелочь вокруг (событие по сети)
    function boom(v){
      v._boomAt = now();
      fxAt('fire', v.x, v.y + 1, v.z, 30, null, 1.6); fxAt('sparkles', v.x, v.y + 1, v.z, 20, '#ffb347', 1);
      const dme = Math.hypot(S.P.ch.x - v.x, S.P.ch.z - v.z);
      if (dme < 30) { S.rig?.shake?.(Math.max(.5, 3 - dme / 10), .6); rt.sfx('break', { x: v.x, y: v.y + 1, z: v.z, vol: .9 }); }
      rt.scare?.(v.x, v.z, 16);
      if ((v.local || v.lastBy === S.key) && v.def.age >= 12) rt.destruct?.hit(v.x, v.z, 5, 3, { by: 'boom' });
    }
    // разгон в мелочь: что впереди и по силам машине — сломать (тела убираются до шага — машина проезжает, чуть тормозя)
    function smash(v){
      const DS = rt.destruct, pw = v.def.smash || 0; if (!DS || !pw || Math.abs(v.spd) < (pw >= 2 ? 2 : 7)) return;
      const [fx, fz] = VE.fwd(v), s = Math.sign(v.spd), L = v.def.size[2] * .5 + .6;
      const r = DS.ahead(v.x + fx * L * s, v.z + fz * L * s, v.def.size[0] * .55, pw, fx * s, fz * s);
      if (r.n) { v.spd *= r.slow; rt.scare?.(v.x, v.z, 9); S.rig?.shake?.(pw >= 2 ? .5 : .3, .2); }
    }
    // звук мотора: до 3 ближних машин с мотором (своя — громче), высота тона — по скорости/оборотам
    function sounds(){
      const A = S.AU; if (!A?.loop) return;
      const cam = R.camera.position, L = [...VS.list.values(), ...TR.filter(T0 => T0.view).map(T0 => T0.v)].filter(v => v.eng || v.rotor > .05).map(v => [v, Math.hypot(v.x - cam.x, v.y - cam.y, v.z - cam.z)]).filter(([, d]) => d < 60).sort((a, b) => a[1] - b[1]).slice(0, 3);
      const want = new Set(L.map(([v]) => v.id));
      for (const [id, h] of VS.loops) if (!want.has(id)) { h.stop(); VS.loops.delete(id); }
      for (const [v] of L) {
        let h = VS.loops.get(v.id);
        if (!h) { h = A.loop(v.def.sound, { x: v.x, y: v.y, z: v.z, vol: 0 }); VS.loops.set(v.id, h); }
        const S0 = v.def.speed.max, k = v.kind === 'plane' ? .3 + .7 * v.rotor : v.kind === 'heli' ? v.rotor : Math.min(1, Math.abs(v.spd) / S0);
        const ld = v.load || 0, tank = v.def.id === 'tank';
        h.set({ x: v.x, y: v.y + 1, z: v.z, vol: (VS.me?.v === v ? .5 : .38) * (v.kind === 'heli' ? v.rotor : .4 + .5 * k + .15 * ld), rate: (v.kind === 'heli' ? .6 + .5 * v.rotor : (.7 + .8 * k + .25 * ld) * (tank ? .55 : 1)) });
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
      for (const T0 of TR) { T0.view?.dispose(); T0.view = null; VE.removeBody(T0.v, ph); }
      for (const h of VS.loops.values()) h.stop();
      VS.loops.clear(); VS.list.clear(); hudEl.remove();
      VS.marks?.dispose(); for (const k in FXA) FXA[k].dispose?.();
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
    // тест-драйв (город) и техника военной базы (mir-base.js): o — { ttl (мс), area (только в своей зоне), msg, end }
    VS.testDrive = (defId, at, o = {}) => {
      if (!VE.get(defId) || VS.me) return null;
      const old = [...VS.list.values()].find(v => v.temp && v.owner === S.key);
      if (old) { rt.vehSend?.({ k: 'gone', id: old.id }); VS.despawn(old.id); }
      const tag = (S.key || 'me').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(-6) || 'me';
      const v = VS.spawn(defId, { id: 't_' + tag + (Date.now() % 1296).toString(36), x: at.x, z: at.z, yaw: at.yaw || 0, temp: true, zone: at.zone || null, area: o.area || null });
      if (!v) return null;
      v.owner = S.key;
      enter(v, 0);
      toast(o.msg || `🚗 Тест-драйв: ${v.def.name} — 5 минут`, true);
      clearTimeout(v.endT); v.endT = setTimeout(() => { if (VS.list.get(v.id) !== v) return; if (VS.me?.v === v) { exit({ force: true }); toast(o.end || '🚗 Тест-драйв окончен — понравилось? Скоро можно будет купить'); } rt.vehSend?.({ k: 'gone', id: v.id }); VS.despawn(v.id); }, o.ttl || 300000);
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
  root.MirVeh = { start, spots, AREA_MSG, laneLoop, trafficPose };
})();
