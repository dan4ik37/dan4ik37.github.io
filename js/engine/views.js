// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — ракурсы камеры для игроков (мир «Студии 3D» задаёт свой): от 3-го лица, от 1-го лица, из-за плеча,
//  сверху (2.5D), изометрия, сбоку (2D-платформер — ходьба только влево/вправо), камеры в мире (объекты Camera, их зоны
//  включают камеру). Переходы — плавные; куда идти — по ракурсу (сверху: стик вверх — на север экрана).
// ═══════════════════════════════════════
// V = D37E.views.create(camera, rig, { T }) — rig: D37E.cameraRig (3-е / 1-е лицо и «из-за плеча» — через него).
//   V.set(режим | { mode, dist, angle, free }, { smooth }) · V.update(dt, P, look, phys, C) — каждый кадр вместо rig.update
//   · V.moveCam(C, P) → { yaw } для P.update (и «сбоку» гасит вперёд/назад) · V.afterMove(P) — «сбоку»: держим плоскость
//   · V.cams = [{ id, pos, rot, fov, kind, zones: [[minx, miny, minz, maxx, maxy, maxz]] }] — камеры в мире · V.mode, V.cfg.
// Чистые помощники (проверка в node): wish(mode, move, yaw), camYaw(rot), pickCam(cams, p, cur), MODES, cfg(c).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const DEG = Math.PI / 180, U = E.UNIT || 2.1 / 1.8;
  const MODES = [
    ['third', 'От 3-го лица', '🎥', 'Камера за спиной, крутится мышью, пальцем или стиком. V — от 1-го лица.'],
    ['first', 'От 1-го лица', '👁', 'Глазами персонажа. Для ужастиков и лабиринтов.'],
    ['shoulder', 'Из-за плеча', '🎯', 'Близко за правым плечом, персонаж смотрит туда же, куда камера. Для боёв.'],
    ['top', 'Сверху (2.5D)', '🗺️', 'Сверху под углом, как в стратегиях. Стик вверх — вверх по экрану.'],
    ['iso', 'Изометрия', '💠', 'Сбоку-сверху под 45°, мир как на картинке. Для ферм и головоломок.'],
    ['side', 'Сбоку (2D)', '🎮', 'Как платформер: идёшь только влево-вправо, прыгаешь. Мир — полоса вдоль оси X.'],
    ['fixed', 'Камеры в мире', '📹', 'Ставишь 🎥 камеры, у каждой — зона: игрок в зоне — включается её камера.'],
  ];
  const IDS = MODES.map(m => m[0]);
  const RIGM = new Set(['third', 'first', 'shoulder']);
  const cfg = c => {
    const o = typeof c === 'string' ? { mode: c } : c && typeof c === 'object' ? c : {};
    const mode = IDS.includes(o.mode) ? o.mode : 'third';
    const num = (v, a, b, d) => { v = +v; return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; };
    return { mode, free: o.free !== false, dist: num(o.dist, 6, 80, mode === 'iso' ? 34 : mode === 'side' ? 16 : 20), angle: num(o.angle, 30, 89, 60) };
  };
  // направление ходьбы в мире: как player.js (камера yaw), «сбоку» — только влево/вправо
  function wish(mode, m, yaw){
    const x = m.x, z = mode === 'side' ? 0 : m.z;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    return { x: rx * x + fx * z, z: rz * x + fz * z };
  }
  // куда смотрит камера в мире (Camera.rot — градусы, YXZ, вперёд — −Z): yaw как у rig (вперёд = (−sin, −cos))
  const camYaw = rot => (rot?.[1] || 0) * DEG;
  // камера в мире: в чьей зоне игрок — та; ни в чьей — прежняя; нет прежней — первая
  function pickCam(cams, p, cur){
    for (const c of cams) for (const z of c.zones || []) if (p[0] >= z[0] && p[0] <= z[3] && p[1] >= z[1] - .5 && p[1] <= z[4] + .5 && p[2] >= z[2] && p[2] <= z[5]) return c.id;
    if (cur && cams.some(c => c.id === cur)) return cur;
    return cams[0]?.id || null;
  }

  function create(camera, rig, o = {}){
    const T = o.T;
    const V = { mode: 'third', cfg: cfg('third'), cams: [], camId: null, plane: null, heldYaw: null, rig0: { dist: rig.dist, minD: rig.minD, maxD: rig.maxD, lift: rig.lift, mode: rig.mode } };
    const tgt = { x: 0, y: 0, z: 0, ok: false }, last = { p: null, q: null, fov: 0 };
    let blend = null, d = V.cfg.dist;
    const pose = () => ({ p: camera.position.clone(), q: camera.quaternion.clone(), fov: camera.fov });
    V.set = (c, opt = {}) => {
      const n = cfg(c), was = V.mode;
      V.cfg = n; V.mode = n.mode; d = n.dist;
      if (opt.smooth !== false && last.p) blend = { from: { p: last.p.clone(), q: last.q.clone(), fov: last.fov }, t: 0, dur: opt.dur || .6 };
      // rig: 1-е лицо / 3-е / из-за плеча (ближе и выше)
      if (V.mode === 'first') rig.mode = 'first';
      else { rig.mode = 'third'; if (rig.mode === 'third' && was === 'first') rig.fp = 0; }
      if (V.mode === 'shoulder') Object.assign(rig, { dist: (camera.aspect < 1 ? 6.4 : 4.4) * U / 1.17, minD: 2.4, maxD: 9, lift: 1.75 });   // телефон стоя — дальше, иначе спина на пол-экрана
      else Object.assign(rig, { dist: V.rig0.dist, minD: V.rig0.minD, maxD: V.rig0.maxD, lift: V.rig0.lift });
      V.plane = null; V.heldYaw = null;
      return V.mode;
    };
    V.rig = () => RIGM.has(V.mode);
    // ходьба: какой «yaw камеры» отдать player.js
    V.moveCam = (C, P) => {
      const m = V.mode, moving = C ? Math.hypot(C.move.x, C.move.z) > .25 : false;
      if (m === 'side' && C) C.move.z = 0;   // вперёд/назад — нет (лестницы — прыжком)
      if (P) P.first = m === 'first' || m === 'shoulder';
      let yaw = rig.yaw;
      if (m === 'top' || m === 'side') yaw = 0;
      else if (m === 'iso') yaw = Math.PI / 4;
      else if (m === 'fixed') yaw = V.fixedYaw ?? rig.yaw;
      // смена камеры, а стик держат — идём, как шли (иначе «развернёт» на месте)
      if (m === 'fixed') { if (moving && V.heldYaw !== null) yaw = V.heldYaw; else if (!moving) V.heldYaw = null; if (moving && V.heldYaw === null) V.heldYaw = yaw; }
      return { yaw };
    };
    V.afterMove = P => {
      if (V.mode !== 'side' || !P?.ch) return;
      if (V.plane === null) V.plane = P.ch.z;
      P.ch.z = V.plane; P.ch.vz = 0;
    };
    // ── кадр ──
    const tmpV = T ? new T.Vector3() : null, tmpQ = T ? new T.Quaternion() : null, eu = T ? new T.Euler() : null;
    V.update = (dt, P, look, phys, C) => {
      const ch = P?.ch || P, m = V.mode;
      if (look?.zoom && look.zoom !== 1 && !RIGM.has(m)) d = Math.max(6, Math.min(90, d * look.zoom));
      const fovAdd = +root.D37Opt?.fovAdd || 0;
      if (RIGM.has(m)) {
        rig.update(dt, P, look, phys, C);
        if (m === 'shoulder' && camera.position) {   // за правым плечом: сдвиг вбок, взгляд тот же
          const r = rig.right(), off = camera.aspect < 1 ? .5 : .95; camera.position.x += r.x * off; camera.position.z += r.z * off;
        }
      } else {
        // цель — игрок (мягко); stepOff — плавные ступеньки
        const ty = ch.y + (P?.stepOff || 0) + 1.1;
        if (!tgt.ok) { tgt.x = ch.x; tgt.y = ty; tgt.z = ch.z; tgt.ok = true; }
        const k = 1 - Math.exp(-dt * 9);
        tgt.x += (ch.x - tgt.x) * k; tgt.y += (ty - tgt.y) * (1 - Math.exp(-dt * 6)); tgt.z += (ch.z - tgt.z) * k;
        let fov = 50;
        if (m === 'top') { const a = V.cfg.angle * DEG; camera.position.set(tgt.x, tgt.y + Math.sin(a) * d, tgt.z + Math.cos(a) * d); camera.lookAt(tgt.x, tgt.y, tgt.z); fov = 50; }
        else if (m === 'iso') { const e = 35.264 * DEG, y = Math.PI / 4; camera.position.set(tgt.x + Math.sin(y) * Math.cos(e) * d, tgt.y + Math.sin(e) * d, tgt.z + Math.cos(y) * Math.cos(e) * d); camera.lookAt(tgt.x, tgt.y, tgt.z); fov = 30; }
        else if (m === 'side') { const e = 8 * DEG; camera.position.set(tgt.x, tgt.y + Math.sin(e) * d + .6, tgt.z + Math.cos(e) * d); camera.lookAt(tgt.x, tgt.y + .6, tgt.z); fov = 40; }
        else if (m === 'fixed') {
          const id = pickCam(V.cams, [ch.x, ch.y + 1, ch.z], V.camId);
          if (id !== V.camId) { if (V.camId && last.p) blend = { from: { p: last.p.clone(), q: last.q.clone(), fov: last.fov }, t: 0, dur: .45 }; V.camId = id; }
          const c = V.cams.find(x => x.id === id);
          if (!c) { rig.update(dt, P, look, phys, C); V.fixedYaw = rig.yaw; }
          else {
            camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
            if (c.kind === 'track') { camera.lookAt(tgt.x, tgt.y, tgt.z); const fx = tgt.x - c.pos[0], fz = tgt.z - c.pos[2]; V.fixedYaw = Math.atan2(-fx, -fz); }
            else { eu.set((c.rot?.[0] || 0) * DEG, (c.rot?.[1] || 0) * DEG, (c.rot?.[2] || 0) * DEG, 'YXZ'); camera.quaternion.setFromEuler(eu); V.fixedYaw = camYaw(c.rot); }
            fov = c.fov || 50;
          }
        }
        const f = fov + fovAdd;
        if (Math.abs(camera.fov - f) > .01) { camera.fov = f; camera.updateProjectionMatrix(); }
      }
      // плавный переход из прежнего вида
      if (blend && T) {
        blend.t += dt; const kk = Math.min(1, blend.t / blend.dur), s = kk * kk * (3 - 2 * kk);
        tmpV.copy(blend.from.p).lerp(camera.position, s); camera.position.copy(tmpV);
        tmpQ.copy(blend.from.q).slerp(camera.quaternion, s); camera.quaternion.copy(tmpQ);
        const fv = blend.from.fov + (camera.fov - blend.from.fov) * s; if (Math.abs(camera.fov - fv) > .01) { camera.fov = fv; camera.updateProjectionMatrix(); }
        if (kk >= 1) blend = null;
      }
      if (T) { last.p = (last.p || new T.Vector3()).copy(camera.position); last.q = (last.q || new T.Quaternion()).copy(camera.quaternion); last.fov = camera.fov; }
      return true;
    };
    V.blending = () => !!blend;
    V.reset = () => { Object.assign(rig, { dist: V.rig0.dist, minD: V.rig0.minD, maxD: V.rig0.maxD, lift: V.rig0.lift }); blend = null; tgt.ok = false; };
    return V;
  }
  E.views = { MODES, IDS, cfg, wish, camYaw, pickCam, create };
})();
