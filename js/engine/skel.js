// ═══════════════════════════════════════
//  D37 ENGINE — shared skeleton + procedural action clips (T-131, AI3D A2 "our Blender": skeleton and animations).
//  Layer-1 contract: E:\d37-core\spec\BODY.md, spec/data/skeleton.json (bone ids = Unity HumanBodyBones, left/right = the
//  character's own side), spec/data/actions.csv (every clip name starts with an action id). The same clips go to the site
//  (D37E.models skinned playback, AI3D export) and to Backrooms (FBX pack E:\d37-core\anim, imported as Humanoid).
// ═══════════════════════════════════════
// Frame: right-handed, Y up, the character faces +Z, +X is the character's LEFT (glTF). Units: meters (any skeleton works:
// gait sizes scale with leg length, times with its square root — dynamic similarity).
// Rest pose = T-pose with IDENTITY rotations on every bone, so a clip's local rotation is the bone's whole local rotation.
// S = D37E.skel:
//   S.BONES [{ id, parent, req }]; S.NB; S.index(id) → bone number (−1 if not a shared bone).
//   S.reference({ height, sex }) → skeleton (BaseBody_Male/Female proportions, Backrooms); S.fromJoints({ id: [x,y,z] }) → skeleton
//     from T-pose joint positions (missing optional bones are made up); S.restPose(sk) → { pos, q } of the rest.
//   S.LIST — first-batch clip ids; S.generate(sk, id) → clip; S.batch(sk, ids) → clips (deterministic: same input → same bytes).
//   clip = { name, action, variant, loop, additive, pose, fps, dur, n, t: Float32Array(n), q: Float32Array(n·NB·4) local
//     rotations, p: Float32Array(n·3) Hips position in the ROOT frame (in place), root: Float32Array(n·3) root x, z, yaw (rad)
//     in the clip world, speed (m/s at the end), dir [x, z], heading (deg), contacts { L: [[plant, lift, flatFrom, toeFrom]…], R }
//     in seconds, sync, blend [in, out], slide { L, R } (m/s, filled by S.footSlide) }.
//   S.sample(sk, clip, t, out, o) → world joint positions (Float64Array NB·3), interpolated like an engine (slerp/lerp).
//   S.footSlide(sk, clip) → { L, R, max } — speed of the planted contact point (heel / ankle / ball), m/s; the bar is ≤ 0.01.
//   S.csv(clips) → clips.csv text (S.CSV_COLUMNS); S.hash(clip) → FNV-1a of the arrays.
//   S.toThree(T, clip, o) → THREE.AnimationClip; o = { names (bone number → node name), root: 'inplace'|'bake', target
//     (retarget: { R: world rest quats, L: local rest quats, par, map (shared bone → target bone), hipsP, hipsK }) }.
(() => {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const VERSION = 1;
  const D2R = Math.PI / 180;

  // ═══ Bones (order: parents first). Eyes are skipped (no eye bones on the site). ═══
  const BONES = [
    ['Hips', -1, 1], ['Spine', 0, 1], ['Chest', 1, 0], ['UpperChest', 2, 0], ['Neck', 3, 0], ['Head', 4, 1],
    ['LeftShoulder', 3, 0], ['LeftUpperArm', 6, 1], ['LeftLowerArm', 7, 1], ['LeftHand', 8, 1],
    ['LeftIndexProximal', 9, 0], ['LeftMiddleProximal', 9, 0], ['LeftLittleProximal', 9, 0],
    ['RightShoulder', 3, 0], ['RightUpperArm', 13, 1], ['RightLowerArm', 14, 1], ['RightHand', 15, 1],
    ['RightIndexProximal', 16, 0], ['RightMiddleProximal', 16, 0], ['RightLittleProximal', 16, 0],
    ['LeftUpperLeg', 0, 1], ['LeftLowerLeg', 20, 1], ['LeftFoot', 21, 1], ['LeftToes', 22, 0],
    ['RightUpperLeg', 0, 1], ['RightLowerLeg', 24, 1], ['RightFoot', 25, 1], ['RightToes', 26, 0],
  ].map(([id, parent, req]) => ({ id, parent, req: !!req }));
  const NB = BONES.length, IDX = {};
  BONES.forEach((b, i) => { IDX[b.id] = i; });
  const I = IDX;
  // side tables: [left, right]
  const UL = [I.LeftUpperLeg, I.RightUpperLeg], LL = [I.LeftLowerLeg, I.RightLowerLeg], FT = [I.LeftFoot, I.RightFoot], TO = [I.LeftToes, I.RightToes];
  const SH = [I.LeftShoulder, I.RightShoulder], UA = [I.LeftUpperArm, I.RightUpperArm], LA = [I.LeftLowerArm, I.RightLowerArm], HA = [I.LeftHand, I.RightHand];
  const FI = [[I.LeftIndexProximal, I.LeftMiddleProximal, I.LeftLittleProximal], [I.RightIndexProximal, I.RightMiddleProximal, I.RightLittleProximal]];

  // ═══ Quaternions [x, y, z, w] on plain arrays (generation runs once per skeleton; the hot path is three's mixer) ═══
  const qId = () => [0, 0, 0, 1];
  function qMul(a, b){ return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]; }
  const qInv = q => [-q[0], -q[1], -q[2], q[3]];
  function qAx(x, y, z, deg){ const h = deg * D2R / 2, s = Math.sin(h); return [x * s, y * s, z * s, Math.cos(h)]; }
  const qX = d => qAx(1, 0, 0, d), qY = d => qAx(0, 1, 0, d), qZ = d => qAx(0, 0, 1, d);
  // yaw · pitch · roll (Y, then X, then Z — in the parent frame: R = Ry·Rx·Rz)
  const qYXZ = (pitch, yaw, roll) => qMul(qMul(qY(yaw), qX(pitch)), qZ(roll));
  function qRot(q, v){ const x = v[0], y = v[1], z = v[2], qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx]; }
  function qNorm(q){ const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; }
  function qSlerp(a, b, t){
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], s = 1;
    if (d < 0) { d = -d; s = -1; }
    if (d > .9995) return qNorm([a[0] + (s * b[0] - a[0]) * t, a[1] + (s * b[1] - a[1]) * t, a[2] + (s * b[2] - a[2]) * t, a[3] + (s * b[3] - a[3]) * t]);
    const th = Math.acos(d), sn = Math.sin(th), k0 = Math.sin((1 - t) * th) / sn, k1 = s * Math.sin(t * th) / sn;
    return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1, a[3] * k0 + b[3] * k1];
  }
  // rotation matrix columns (x, y, z) → quaternion
  function qFromM(m00, m01, m02, m10, m11, m12, m20, m21, m22){
    const tr = m00 + m11 + m22; let x, y, z, w;
    if (tr > 0) { const s = .5 / Math.sqrt(tr + 1); w = .25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s; }
    else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = .25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
    else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = .25 * s; z = (m12 + m21) / s; }
    else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = .25 * s; }
    return qNorm([x, y, z, w]);
  }
  const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const vSc = (a, k) => [a[0] * k, a[1] * k, a[2] * k], vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const vLen = a => Math.hypot(a[0], a[1], a[2]), vN = a => { const l = vLen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  // rotation taking frame (x0, y0) to frame (x1, y1); x unit, y ⊥ x (made so here)
  function qFrames(x0, y0, x1, y1){
    const o = (x, y) => { x = vN(x); y = vN(vSub(y, vSc(x, vDot(x, y)))); return [x, y, vCross(x, y)]; };
    const [a, b, c] = o(x0, y0), [d, e, f] = o(x1, y1);
    // M = [d e f]·[a b c]ᵀ
    const m = (i, j) => d[i] * a[j] + e[i] * b[j] + f[i] * c[j];
    return qFromM(m(0, 0), m(0, 1), m(0, 2), m(1, 0), m(1, 1), m(1, 2), m(2, 0), m(2, 1), m(2, 2));
  }
  function qArc(u, v){ u = vN(u); v = vN(v); const d = vDot(u, v); if (d > .999999) return qId(); if (d < -.999999) { const ax = Math.abs(u[0]) < .9 ? vN(vCross(u, [1, 0, 0])) : vN(vCross(u, [0, 1, 0])); return [ax[0], ax[1], ax[2], 0]; } const c = vCross(u, v); return qNorm([c[0], c[1], c[2], 1 + d]); }

  // ═══ Skeletons ═══
  // BaseBody_Male.fbx (Backrooms, 1.80 m, Mixamo T-pose), symmetrised; measured headless in Blender 5.2 (E:\claude-tmp\t138).
  const REF_M = { Hips: [0, .946, -.03], Spine: [0, 1.037, -.025], Chest: [0, 1.15, -.015], UpperChest: [0, 1.283, -.01], Neck: [0, 1.48, -.005], Head: [0, 1.586, .015],
    LeftShoulder: [.036, 1.438, .02], LeftUpperArm: [.172, 1.431, -.046], LeftLowerArm: [.45, 1.403, -.046], LeftHand: [.666, 1.402, -.047],
    LeftIndexProximal: [.803, 1.402, -.01], LeftMiddleProximal: [.803, 1.404, -.033], LeftLittleProximal: [.79, 1.393, -.077],
    LeftUpperLeg: [.092, .918, .003], LeftLowerLeg: [.113, .51, -.01], LeftFoot: [.113, .102, -.06], LeftToes: [.134, .032, .081] };
  const REF_F = { Hips: [0, .876, .016], Spine: [0, .948, .016], Chest: [0, 1.099, .016], UpperChest: [0, 1.23, -.003], Neck: [0, 1.401, -.023], Head: [0, 1.506, -.01],
    LeftShoulder: [.043, 1.368, -.003], LeftUpperArm: [.161, 1.349, -.036], LeftLowerArm: [.423, 1.309, -.03], LeftHand: [.622, 1.301, -.021],
    LeftIndexProximal: [.75, 1.30, .012], LeftMiddleProximal: [.752, 1.302, -.01], LeftLittleProximal: [.74, 1.292, -.05],
    LeftUpperLeg: [.102, .85, .01], LeftLowerLeg: [.115, .45, -.003], LeftFoot: [.115, .069, -.01], LeftToes: [.128, .023, .115] };
  const REF_H = { m: 1.80, f: 1.68 };
  const mirror = p => [-p[0], p[1], p[2]];
  function fullMap(half){ const m = { ...half }; for (const k in half) if (k.startsWith('Left')) m['Right' + k.slice(4)] = mirror(half[k]); return m; }
  function reference(o){
    o = o || {}; const f = o.sex === 'f', base = fullMap(f ? REF_F : REF_M), k = (o.height || REF_H[f ? 'f' : 'm']) / REF_H[f ? 'f' : 'm'], m = {};
    for (const id in base) m[id] = base[id].map(v => v * k);
    return fromJoints(m);
  }
  // T-pose joint positions → skeleton. Missing optional bones are placed from their neighbours.
  function fromJoints(J){
    const P = new Float64Array(NB * 3), has = new Uint8Array(NB);
    for (let i = 0; i < NB; i++) { const p = J[BONES[i].id]; if (p && p.length >= 3 && p.every(Number.isFinite)) { P.set([p[0], p[1], p[2]], i * 3); has[i] = 1; } }
    const g = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], s = (i, v) => { P.set(v, i * 3); has[i] = 1; }, lerp = (a, b, t) => vAdd(a, vSc(vSub(b, a), t));
    for (const b of BONES) if (b.req && !has[I[b.id]]) throw new Error('skel: no bone ' + b.id);
    const sp = g(I.Spine), hd = g(I.Head);
    if (!has[I.Neck]) s(I.Neck, lerp(sp, hd, .82));
    const nk = g(I.Neck);
    if (!has[I.Chest]) s(I.Chest, lerp(sp, nk, .25));
    if (!has[I.UpperChest]) s(I.UpperChest, lerp(sp, nk, .55));
    for (let k = 0; k < 2; k++) {
      const ua = g(UA[k]), uc = g(I.UpperChest);
      if (!has[SH[k]]) s(SH[k], [lerp(uc, ua, .25)[0], ua[1], ua[2]]);
      const la = g(LA[k]), ha = g(HA[k]), dir = vN(vSub(ha, la)), hl = vLen(vSub(ha, la)) * .62;
      const fz = [[0, .035], [0, .01], [0, -.03]];
      FI[k].forEach((fi, j) => { if (!has[fi]) s(fi, vAdd(ha, [dir[0] * hl, dir[1] * hl - .002, fz[j][1] * hl / .14])); });
      const an = g(FT[k]), kn = g(LL[k]);
      if (!has[TO[k]]) s(TO[k], [an[0] + (an[0] - kn[0]) * .3, an[1] * .3, an[2] + an[1] * 1.35]);
    }
    const parent = new Int8Array(NB), off = new Float64Array(NB * 3);
    for (let i = 0; i < NB; i++) { const pi = BONES[i].parent; parent[i] = pi; for (let c = 0; c < 3; c++) off[i * 3 + c] = P[i * 3 + c] - (pi >= 0 ? P[pi * 3 + c] : 0); }
    const len = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
    const legLen = (len(UL[0], LL[0]) + len(LL[0], FT[0]) + len(UL[1], LL[1]) + len(LL[1], FT[1])) / 2;
    const ankleH = (P[FT[0] * 3 + 1] + P[FT[1] * 3 + 1]) / 2;
    // heel contact point (ground, behind the ankle) and ball (= the toes joint): foot-local offsets from the ankle
    const heel = [0, 1].map(k => [0, -P[FT[k] * 3 + 1], -Math.max(.03, P[FT[k] * 3 + 1] * .62)]);
    const ball = [0, 1].map(k => vSub(g(TO[k]), g(FT[k])));
    return { v: VERSION, rest: P, off, parent, legLen, ankleH, hipH: P[1], heel, ball, k: legLen / .816 };
  }
  const restPose = sk => ({ pos: sk.rest, q: new Float32Array(NB * 4).map((_, i) => i % 4 === 3 ? 1 : 0) });

  // ═══ FK: locals → world (root frame) ═══
  function fk(sk, Q, hp, rootQ, rootP){
    const G = new Array(NB), P = new Array(NB);
    for (let i = 0; i < NB; i++) {
      const pi = sk.parent[i], o = [sk.off[i * 3], sk.off[i * 3 + 1], sk.off[i * 3 + 2]];
      if (pi < 0) { G[i] = rootQ ? qMul(rootQ, Q[i]) : Q[i]; P[i] = rootQ ? vAdd(rootP, qRot(rootQ, hp)) : hp.slice(); }
      else { G[i] = qMul(G[pi], Q[i]); P[i] = vAdd(P[pi], qRot(G[pi], o)); }
    }
    return { G, P };
  }

  // ═══ Clip specs (first batch, owner 29.10 via the Backrooms advice): locomotion walk/jog/run × 4 directions, crouch, carry,
  //     idles + additive fidgets, turn-in-place 90/180 L/R, start/stop on the L/R foot, look and flinch additives ═══
  // Gait numbers for a 0.82 m leg (BaseBody_Male): v m/s, T cycle s, beta duty, land = heel ahead of the root at touchdown,
  // sHeel/sToe = stance fractions where the heel roll ends / the toe roll starts, heel/toe = roll pitch (deg), clear = swing lift,
  // kick = heel lift behind (run), bob/sway (m), hipK = nominal hips height × rest, yawP/listP/tiltP = pelvis (deg), lean = spine
  // forward (deg), arm/elbow (deg), out = arm abduction (deg), width = stance width × rest.
  const GAIT = {
    walk: { v: 1.5, T: 1.0, beta: .6, land: .33, sHeel: .14, sToe: .5, heel: 14, toe: 55, clear: .05, kick: .07, bob: .018, sway: .022, hipK: .985, yawP: 4, listP: 3, tiltP: 3, lean: 2, arm: 17, elbow: 14, elbowSw: 12, out: 8, width: .9, blend: [.2, .2] },
    jog: { v: 3.4, T: .72, beta: .3, land: .26, sHeel: 0, sToe: .38, heel: 0, toe: 52, clear: .09, kick: .2, bob: -.022, sway: .012, hipK: .965, yawP: 7, listP: 2, tiltP: 6, lean: 5, arm: 30, elbow: 78, elbowSw: 14, out: 12, width: .78, blend: [.2, .2] },
    sprint: { v: 6, T: .62, beta: .2, land: .24, sHeel: 0, sToe: .3, heel: 0, toe: 55, clear: .12, kick: .32, bob: -.028, sway: .008, hipK: .955, yawP: 9, listP: 2, tiltP: 9, lean: 8, arm: 44, elbow: 88, elbowSw: 16, out: 14, width: .7, blend: [.2, .2] },
    crouch: { v: 1.4, T: 1.12, beta: .64, land: .28, sHeel: .1, sToe: .58, heel: 8, toe: 30, clear: .06, kick: .05, bob: .01, sway: .02, hipK: .7, yawP: 3, listP: 2, tiltP: 24, lean: 12, arm: 8, elbow: 32, elbowSw: 6, out: 14, width: 1, blend: [.25, .25], crouch: 1 },
    carry: { v: 1.2, T: 1.05, beta: .62, land: .3, sHeel: .14, sToe: .52, heel: 12, toe: 50, clear: .05, kick: .06, bob: .014, sway: .02, hipK: .98, yawP: 2, listP: 2, tiltP: 0, lean: -3, arm: 0, elbow: 0, elbowSw: 0, out: 8, width: .95, blend: [.3, .3], carry: 1 },
  };
  // directions: d = travel in the character frame [x (left), z (forward)], speed and cadence factors, roll on/off
  const DIRS = { fwd: { d: [0, 1], kv: 1, kT: 1, roll: 1 }, back: { d: [0, -1], kv: .72, kT: .94, roll: 0 }, left: { d: [1, 0], kv: .5, kT: .85, roll: 0 }, right: { d: [-1, 0], kv: .5, kT: .85, roll: 0 } };
  const LIST = [];
  const SPEC = {};
  const add = (name, s) => { SPEC[name] = s; LIST.push(name); };
  add('loco.idle', { kind: 'idle', action: 'loco.idle', variant: '', dur: 4, blend: [.3, .3] });
  for (const [g, act] of [['walk', 'loco.walk'], ['jog', 'loco.jog'], ['sprint', 'loco.sprint']]) for (const dn of ['fwd', 'back', 'left', 'right']) add(act + '.' + dn, { kind: 'gait', gait: g, dir: dn, action: act, variant: dn });
  add('stance.crouch.idle', { kind: 'idle', crouch: 1, action: 'stance.crouch', variant: 'idle', dur: 3.2, blend: [.25, .25] });
  add('stance.crouch.fwd', { kind: 'gait', gait: 'crouch', dir: 'fwd', action: 'stance.crouch', variant: 'fwd' });
  add('carry.carry.idle', { kind: 'idle', carry: 1, action: 'carry.carry', variant: 'idle', dur: 3.2, blend: [.3, .3] });
  add('carry.carry.fwd', { kind: 'gait', gait: 'carry', dir: 'fwd', action: 'carry.carry', variant: 'fwd' });
  add('loco.idle.fidget_look', { kind: 'fidget', f: 'look', action: 'loco.idle', variant: 'fidget_look', dur: 3.2, blend: [.4, .4] });
  add('loco.idle.fidget_shift', { kind: 'fidget', f: 'shift', action: 'loco.idle', variant: 'fidget_shift', dur: 3.4, blend: [.4, .4] });
  add('loco.idle.fidget_hands', { kind: 'fidget', f: 'hands', action: 'loco.idle', variant: 'fidget_hands', dur: 3, blend: [.4, .4] });
  add('gesture.stretch', { kind: 'fidget', f: 'stretch', action: 'gesture.stretch', variant: '', dur: 3.6, blend: [.4, .4] });
  for (const [nm, a] of [['l90', 90], ['r90', -90], ['l180', 180], ['r180', -180]]) add('loco.turn.' + nm, { kind: 'turn', angle: a, action: 'loco.turn', variant: nm, dur: Math.abs(a) > 100 ? 1.4 : .9, blend: [.1, .15] });
  for (const [nm, stop, foot] of [['start_l', 0, 0], ['start_r', 0, 1], ['stop_l', 1, 0], ['stop_r', 1, 1]]) add('loco.walk.' + nm, { kind: 'gait', gait: 'walk', dir: 'fwd', prof: stop ? 'stop' : 'start', foot, action: 'loco.walk', variant: nm, blend: stop ? [.2, .25] : [.15, .2] });
  for (const [nm, p, y] of [['left', 0, 60], ['right', 0, -60], ['up', -40, 0], ['down', 45, 0]]) add('look.aim.' + nm, { kind: 'look', pitch: p, yaw: y, action: 'look.aim', variant: nm, dur: 1 / 30, blend: [.2, .2] });
  add('hit.flinch.front', { kind: 'flinch', sgn: 1, action: 'hit.flinch', variant: 'front', dur: .5, blend: [.05, .2] });
  add('hit.flinch.back', { kind: 'flinch', sgn: -1, action: 'hit.flinch', variant: 'back', dur: .5, blend: [.05, .2] });
  // action ids that are not rows of actions.csv yet (proposed to the Backrooms lead)
  const PROPOSED = { 'look.aim': 'additive aim layer (head/neck/chest); no row in actions.csv yet' };

  // ═══ Planner state → local rotations (+ leg IK) ═══
  // st: { hp [x,y,z] (root frame), hq (hips quat), spine [[p,y,r]×3], neck, head, arm [ {sh, swing, out, elbow, inward, curl}×2 ],
  //       foot [ { a [x,y,z] ankle (root frame), q foot quat (root frame), tq toes quat (root frame), pole [x,y,z] }×2 ] }
  let reach = 0;   // IK targets out of reach (diagnostic, should stay 0)
  function solve(sk, st){
    const Q = new Array(NB);
    for (let i = 0; i < NB; i++) Q[i] = qId();
    Q[I.Hips] = st.hq;
    const sp = st.spine; Q[I.Spine] = qYXZ(sp[0][0], sp[0][1], sp[0][2]); Q[I.Chest] = qYXZ(sp[1][0], sp[1][1], sp[1][2]); Q[I.UpperChest] = qYXZ(sp[2][0], sp[2][1], sp[2][2]);
    Q[I.Neck] = qYXZ(st.neck[0], st.neck[1], st.neck[2]); Q[I.Head] = qYXZ(st.head[0], st.head[1], st.head[2]);
    for (let k = 0; k < 2; k++) {
      const a = st.arm[k], sg = k ? -1 : 1;   // left: +X, right: −X
      Q[SH[k]] = qZ(sg * (a.sh || 0));
      Q[UA[k]] = qMul(qMul(qY(-sg * (a.inward || 0)), qX(-a.swing)), qZ(-sg * (90 - a.out)));
      Q[LA[k]] = qY(-sg * a.elbow);
      Q[HA[k]] = qMul(qX(a.wrist || 0), qZ(-sg * (a.hand || 0)));
      for (const fi of FI[k]) Q[fi] = qZ(-sg * (a.curl || 0));
    }
    // legs: two-bone IK in the root frame
    const hq = st.hq, hp = st.hp;
    for (let k = 0; k < 2; k++) {
      const f = st.foot[k], ul = UL[k], ll = LL[k], ft = FT[k];
      const H = vAdd(hp, qRot(hq, [sk.off[ul * 3], sk.off[ul * 3 + 1], sk.off[ul * 3 + 2]]));
      const v1 = [sk.off[ll * 3], sk.off[ll * 3 + 1], sk.off[ll * 3 + 2]], v2 = [sk.off[ft * 3], sk.off[ft * 3 + 1], sk.off[ft * 3 + 2]];
      const L1 = vLen(v1), L2 = vLen(v2), D = vSub(f.a, H);
      let d = vLen(D);
      const dMax = (L1 + L2) * .9999, dMin = Math.abs(L1 - L2) + 1e-4;
      if (d > dMax) { if (d > dMax + 1e-4) reach++; d = dMax; } if (d < dMin) d = dMin;
      const Dn = vN(D), pole = vN(f.pole), pp = vN(vSub(pole, vSc(Dn, vDot(Dn, pole))));
      const ca = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))), sa = Math.sqrt(1 - ca * ca);
      const th = vAdd(vSc(Dn, ca), vSc(pp, sa)), K = vAdd(H, vSc(th, L1)), sh = vN(vSub(vAdd(H, vSc(Dn, d)), K));
      const thY = vSub(vSc(pp, ca), vSc(Dn, sa)), shY = vN(vSub(pp, vSc(sh, vDot(sh, pp))));
      // rest frames: the bone direction and the rest knee pole (+Z)
      const G1 = qFrames(v1, [0, 0, 1], th, thY), G2 = qFrames(v2, [0, 0, 1], sh, shY);
      Q[ul] = qMul(qInv(hq), G1); Q[ll] = qMul(qInv(G1), G2);
      Q[ft] = qMul(qInv(G2), f.q); Q[TO[k]] = qMul(qInv(f.q), f.tq);
    }
    return Q;
  }

  // ═══ Planners ═══
  const frac = x => x - Math.floor(x);
  const S3 = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  const ease0 = w => w - Math.sin(2 * Math.PI * w) / (2 * Math.PI);   // zero speed at both ends
  const I3 = x => x * x * x - x * x * x * x / 2;   // ∫₀ˣ S3
  function idleBase(sk, o, t){
    const T = o.dur || 4, ph = 2 * Math.PI * t / T, br = Math.sin(ph), k = sk.k, cr = o.crouch ? 1 : 0, ca = o.carry ? 1 : 0;
    const hy = sk.hipH * (cr ? .72 : .995) - .002 * k * (1 - Math.cos(ph)) / 2;
    const st = { hp: [.006 * k * Math.sin(ph + .4), hy, cr ? -.03 * k : 0], hq: qYXZ(cr ? 26 : 1, 0, .6 * br),
      spine: [[cr ? 8 : 0, 0, -.25 * br], [(cr ? 6 : .5) - .6 * br, 0, -.2 * br], [(cr ? 4 : .5) - .8 * br, 0, 0]],
      neck: [cr ? -16 : -1, 0, 0], head: [(cr ? -14 : -1) + .6 * Math.sin(ph * .5), .8 * Math.sin(ph * .5 + 1), 0],
      arm: [0, 1].map(s => ca ? carryArm(s) : { sh: 1.2 * br, swing: (cr ? 14 : 2) + 1.5 * Math.sin(ph + 1 + s), out: cr ? 16 : 9, elbow: cr ? 34 : 14, curl: 18 }),
      foot: [0, 1].map(s => standFoot(sk, s, o.crouch ? 1.15 : 1, 8)) };
    if (cr) st.foot.forEach(f => { f.pole = [s3x(f.a), 0, 1]; });
    return st;
  }
  const s3x = a => a[0] > 0 ? .25 : -.25;
  const carryArm = () => ({ sh: 3, swing: 25, out: 4, inward: 6, elbow: 85, wrist: 0, hand: 0, curl: 40 });   // forearms forward, hands a box apart
  function standFoot(sk, s, wk, toeOut){
    const fi = FT[s], x = sk.rest[fi * 3] * wk, z = sk.rest[fi * 3 + 2];
    const yaw = (s ? -1 : 1) * toeOut, q = qY(yaw);
    return { a: [x, sk.rest[fi * 3 + 1], z], q, tq: q, pole: [s ? -.12 : .12, 0, 1] };
  }
  // gait (loops, starts, stops) — feet planned in the clip world from contacts, then expressed in the root frame
  function gaitPlanner(sk, spec){
    const g0 = GAIT[spec.gait], dr = DIRS[spec.dir], k = sk.k, sq = Math.sqrt(k);
    const kv = spec.dir === 'fwd' ? 1 : dr.kv * (spec.gait === 'sprint' ? .85 : 1);
    const g = { ...g0, v: g0.v * kv * sq, T: g0.T * dr.kT * sq };
    const roll = dr.roll ? 1 : 0, d = dr.d, dz = d[1], lat = Math.abs(d[0]);
    const T = g.T, beta = g.beta, v = g.v, D = v * beta * T;
    const prof = spec.prof || 'loop', ofs = [0, .5];
    // clock τ = t + τ0; speed factor f(t) ∈ [0, 1]; root travel R(t) (× v·d)
    let tau0 = 0, dur = T, fOf = () => 1, ROf = t => t;
    if (prof === 'start') {   // standing; the chosen foot lifts first at t ≈ .22 s; speed ramps up from t0
      const ta = .9 * T, t0 = .3 * sq;
      tau0 = (ofs[spec.foot] + beta) * T - .22 * sq; dur = 1.75 * T + .3 * sq;
      fOf = t => S3((t - t0) / ta);
      ROf = t => { const x = (t - t0) / ta; return x <= 0 ? 0 : x >= 1 ? ta / 2 + (t - t0 - ta) : ta * I3(x); };
    } else if (prof === 'stop') {   // full speed at loop phase 0; the root stops between the last two steps so the chosen foot plants last
      const tdLast = (2 + ofs[spec.foot]) * T, tStop = tdLast - (.75 - beta / 2) * T, ta = .8 * T, t0 = tStop - ta;
      dur = tdLast + .45 * sq;
      fOf = t => 1 - S3((t - t0) / ta);
      ROf = t => { const x = (t - t0) / ta; return x <= 0 ? t : x >= 1 ? t0 + ta / 2 : t0 + ta * (x - I3(x)); };
    }
    return gaitBuild(sk, spec, g, { d, dz, lat, roll, T, beta, v, D, tau0, dur, fOf, ROf, ofs, k, prof });
  }

  function gaitBuild(sk, spec, g, P){
    const { d, dz, lat, roll, T, beta, v, D, tau0, fOf, ROf, ofs, k, prof } = P;
    const dur = prof === 'loop' ? T : P.dur;
    const heelOff = sk.heel, ballOff = sk.ball;
    const toeOut = 6, rest = sk.rest;
    const cOf = s => [rest[FT[s] * 3] * g.width, rest[FT[s] * 3 + 2]];
    const ankleY = s => rest[FT[s] * 3 + 1];
    const yawOf = s => (s ? -1 : 1) * toeOut;
    const hz = -heelOff[0][2];   // heel behind the ankle (m)
    const bias = g.land * k + hz * Math.max(0, dz) * roll - D / 2;
    // strafes: the lead foot (on the travel side) plants further out, the trail foot closes in short of it — the legs never cross
    const gapMin = .12 * k, wid = Math.abs(cOf(0)[0] - cOf(1)[0]), e = lat ? Math.max(0, (gapMin - wid + D * Math.max(.5, 1.5 - beta)) / 2) : 0;
    const biasOf = s => bias + (lat ? Math.sign(cOf(s)[0] * d[0]) * e : 0);
    // stance m of foot s: clock times (touchdown, lift), centre in clip time, flat ankle position (world)
    const stance = (s, m) => {
      const td = (m + ofs[s]) * T - tau0, lf = td + beta * T, tc = (td + lf) / 2, f = fOf(tc), c = cOf(s);
      const r = v * ROf(tc) + f * biasOf(s);
      return { td, lf, f, A: [c[0] + d[0] * r, ankleY(s), c[1] + d[1] * r], yaw: yawOf(s) };
    };
    // ankle + foot rotation at stance progress u (0..1) — pivots heel → flat → ball
    const sHeel = roll ? g.sHeel : 0, sToe = roll ? g.sToe : 1;
    const contactPose = (s, st, u) => {
      const yq = qY(st.yaw), f = st.f, ho = heelOff[s], bo = ballOff[s];
      let pitch = 0, piv = null;
      if (u < sHeel) { pitch = -g.heel * f * (1 - u / sHeel); piv = ho; }
      else if (u > sToe) { pitch = g.toe * f * (u - sToe) / (1 - sToe); piv = bo; }
      const q = qMul(yq, qX(pitch));
      if (!piv) return { a: st.A.slice(), q, tq: q, pitch };
      const pw = vAdd(st.A, qRot(yq, piv)), a = vSub(pw, qRot(q, piv));
      return { a, q, tq: u > sToe ? yq : q, pitch };
    };
    const contacts = [[], []];
    const footAt = (s, t) => {
      const tau = t + tau0, m = Math.floor(tau / T - ofs[s]), st = stance(s, m), u = (t - st.td) / (beta * T);
      if (u < 1) return contactPose(s, st, Math.max(0, u));
      const nx = stance(s, m + 1), A0 = contactPose(s, st, 1), A1 = contactPose(s, nx, 0);
      const w = Math.max(0, Math.min(1, (t - st.lf) / (nx.td - st.lf))), dist = vLen(vSub(A1.a, A0.a));
      const m0 = dist > 1e-6 ? Math.min(2, .6 * v * fOf(st.lf) * (nx.td - st.lf) / dist) : 0, e = m0 * (w * w * w - 2 * w * w + w) + w * w * (3 - 2 * w);
      const amt = Math.min(1, dist / Math.max(.05 * k, .25 * D));
      const a = vAdd(A0.a, vSc(vSub(A1.a, A0.a), e));
      a[1] += (g.clear * k * Math.sin(Math.PI * w) + g.kick * k * Math.sin(Math.PI * Math.min(1, w / .65)) * (1 - .5 * w)) * amt;
      const pitch = A0.pitch + (A1.pitch - A0.pitch) * e - 8 * Math.sin(Math.PI * w) * amt * roll;
      const yaw = st.yaw + (nx.yaw - st.yaw) * e, q = qMul(qY(yaw), qX(pitch));
      // toes: bend up after the push-off, flat again before the touchdown
      return { a, q, tq: qMul(q, qX(-14 * Math.sin(Math.PI * Math.min(1, w * 1.4)) * amt * roll)), pitch };
    };
    // contact list (seconds, in [0, dur]); flat / toe sub-phases for the slide metric
    for (let s = 0; s < 2; s++) {
      const m0 = Math.floor((tau0 - T) / T) - 2, m1 = Math.ceil((dur + tau0) / T) + 2;
      for (let m = m0; m <= m1; m++) {
        const st = stance(s, m), nx = stance(s, m + 1), A0 = contactPose(s, st, 1), A1 = contactPose(s, nx, 0);
        if (st.lf < 0 || st.td > dur) continue;
        // a "swing" with no displacement (standing still before a start / after a stop) keeps the foot planted
        const still = vLen(vSub(A1.a, A0.a)) < 1e-4 && st.f < 1e-6 && nx.f < 1e-6;
        contacts[s].push([st.td, still ? nx.lf : st.lf, st.td + sHeel * beta * T, st.td + sToe * beta * T, st.f]);
      }
      // merge touching intervals (still feet)
      const c = contacts[s].sort((a, b) => a[0] - b[0]), out = [];
      for (const x of c) { const l = out[out.length - 1]; if (l && x[0] <= l[1] + 1e-9) { l[1] = Math.max(l[1], x[1]); if (x[4] > l[4]) { l[2] = x[2]; l[3] = x[3]; } } else out.push(x.slice()); }
      contacts[s] = out;
    }
    const plan = t => {
      const tau = t + tau0, f = fOf(t), R = v * ROf(t), ph = tau / T;
      const rootX = d[0] * R, rootZ = d[1] * R;
      const yawP = -g.yawP * Math.cos(2 * Math.PI * ph) * f * (dz > 0 ? 1 : dz < 0 ? -1 : .3);
      const listP = g.listP * Math.cos(2 * Math.PI * (ph - beta / 2)) * f;
      const cr = g.crouch ? 1 : 0, ca = g.carry ? 1 : 0;
      const tilt = g.tiltP * (cr ? 1 : f) + (cr ? 0 : 1 - f) * 1, lean = g.lean * (cr ? 1 : f);
      const hq = qYXZ(tilt, yawP, listP);
      const hy = sk.hipH * (g.hipK * f + .995 * (1 - f) + (cr ? (g.hipK - .995) * (1 - f) : 0)) + g.bob * k * Math.cos(4 * Math.PI * (ph - beta / 2)) * f;
      const sway = g.sway * k * Math.cos(2 * Math.PI * (ph - beta / 2)) * f * (1 - .7 * lat);
      const hp = [sway, hy, cr ? -.03 * k : 0];
      const cy = -1.6 * yawP / 3, cl = -.8 * listP / 3;
      const spine = [[lean * .3, cy, cl], [lean * .35, cy, cl], [lean * .35, cy, cl]];
      const tl = tilt + lean, neck = [-tl * .38, .35 * yawP, -listP * .2], head = [-tl * .38, .25 * yawP, 0];   // the head stays level and looks ahead
      const arm = [0, 1].map(s => {
        if (ca) return carryArm(s);
        const sw = (s ? 1 : -1) * g.arm * Math.cos(2 * Math.PI * ph) * f * (Math.abs(dz) + .35 * lat) * (dz < 0 ? .8 : 1);
        return { sh: 0, swing: sw + (cr ? 12 : 3), out: g.out, elbow: g.elbow * (cr || f > .5 ? 1 : .4 + .6 * f) + g.elbowSw * Math.max(0, sw / Math.max(1, g.arm)), curl: g.elbow > 60 ? 45 : 20, wrist: 0 };
      });
      const foot = [0, 1].map(s => {
        const fw = footAt(s, t);
        // world → root frame (no root yaw for gaits)
        fw.a = [fw.a[0] - rootX, fw.a[1], fw.a[2] - rootZ];
        fw.pole = [s ? -.1 : .1, 0, 1];
        if (cr) fw.pole = [s ? -.3 : .3, 0, 1];
        return fw;
      });
      return { root: [rootX, rootZ, 0], hp, hq, spine, neck, head, arm, foot, f };
    };
    const sp = Math.hypot(d[0], d[1]) * v;
    return { plan, dur, contacts, speed: prof === 'stop' ? 0 : sp, dir: d, heading: 0, sync: prof === 'start' ? frac((dur + tau0) / T) : prof === 'stop' ? frac(tau0 / T) : 0, loop: prof === 'loop', blend: spec.blend || g.blend, fps: g.v / Math.sqrt(k) > 3 ? 60 : 30 };
  }
  // turn in place: steps scheduled per foot, the root yaws
  function turnPlanner(sk, spec){
    const A = spec.angle, sgn = A > 0 ? 1 : -1, k = sk.k, sq = Math.sqrt(k), dur = spec.dur * sq, big = Math.abs(A) > 100;
    const first = sgn > 0 ? 0 : 1, second = 1 - first;   // turning left: the left foot steps first
    const steps = big ? [[first, .0, .26, .5], [second, .2, .46, .5], [first, .45, .7, 1], [second, .65, .9, 1]] : [[first, .08, .44, 1], [second, .42, .8, 1]];
    const yawAt = t => A * S3((t / dur - .04) / .86);
    const base = idleBase(sk, { dur: 4 }, 0);
    const feet0 = [0, 1].map(s => standFoot(sk, s, 1, 8));
    const contacts = [[], []];
    for (let s = 0; s < 2; s++) { let a = 0; for (const [f, w0, w1] of steps) if (f === s) { contacts[s].push([a * dur, w0 * dur, a * dur, w0 * dur, 1]); a = w1; } contacts[s].push([a * dur, dur, a * dur, dur, 1]); }
    const footWorld = (s, ang) => { const f = feet0[s], q = qY(ang); return { a: qRot(q, f.a), q: qMul(q, f.q) }; };
    const plan = t => {
      const u = t / dur, yaw = yawAt(t), qr = qY(-yaw);
      const foot = [0, 1].map(s => {
        let ang = 0, w = -1;
        for (const [f, w0, w1, frac2] of steps) if (f === s) { if (u >= w1) ang = A * frac2; else if (u > w0) { w = (u - w0) / (w1 - w0); const a0 = ang, a1 = A * frac2; ang = a0 + (a1 - a0) * ease0(w); break; } }
        const fw = footWorld(s, ang);
        if (w >= 0) fw.a[1] += .045 * k * Math.sin(Math.PI * w);
        const a = qRot(qr, fw.a), q = qMul(qr, fw.q);
        return { a, q, tq: q, pole: vAdd(qRot(qMul(qr, fw.q), [0, 0, 1]), [0, 0, 1]).map((x, i) => i === 1 ? 0 : x) };
      });
      const dip = .012 * k * Math.sin(Math.PI * u);
      const st = { ...base, root: [0, 0, yaw * D2R], hp: [base.hp[0], base.hp[1] - dip, 0], hq: qYXZ(2, -sgn * 6 * Math.sin(Math.PI * u), 0), foot };
      st.head = [0, sgn * 14 * Math.sin(Math.PI * Math.min(1, u * 1.6)), 0];
      st.neck = [0, sgn * 8 * Math.sin(Math.PI * Math.min(1, u * 1.6)), 0];
      st.arm = st.arm.map((a, s) => ({ ...a, swing: a.swing + (s === first ? 1 : -1) * 6 * Math.sin(Math.PI * u) }));
      return st;
    };
    return { plan, dur, contacts, speed: 0, dir: [0, 0], heading: A, sync: 0, loop: false, blend: spec.blend, fps: 30 };
  }
  // idles (loop) and additive overlays on the idle reference pose (frame 0 = reference)
  function idlePlanner(sk, spec){
    const dur = spec.dur * Math.sqrt(sk.k);
    const contacts = [[[0, dur, 0, dur, 1]], [[0, dur, 0, dur, 1]]];
    return { plan: t => ({ ...idleBase(sk, { ...spec, dur }, t), root: [0, 0, 0] }), dur, contacts, speed: 0, dir: [0, 0], heading: 0, sync: 0, loop: true, blend: spec.blend, fps: 30 };
  }
  function overlayPlanner(sk, spec){
    const dur = spec.kind === 'look' ? 1 / 30 : spec.dur * Math.sqrt(sk.k), k = sk.k;
    const contacts = [[[0, dur, 0, dur, 1]], [[0, dur, 0, dur, 1]]];
    const plan = t => {
      const st = { ...idleBase(sk, { dur: 4 }, 0), root: [0, 0, 0] }, u = t / dur;
      const env = spec.kind === 'look' ? (t > 0 ? 1 : 0) : spec.kind === 'flinch' ? (u < .16 ? S3(u / .16) : 1 - S3((u - .16) / .84)) : S3(u / .25) * (1 - S3((u - .75) / .25));
      st.spine = st.spine.map(a => a.slice()); st.neck = st.neck.slice(); st.head = st.head.slice(); st.arm = st.arm.map(a => ({ ...a }));
      const addP = (a, i, v) => { a[i] += v; };
      if (spec.kind === 'look') {
        const p = spec.pitch * env, y = spec.yaw * env;
        addP(st.head, 0, p * .5); addP(st.neck, 0, p * .3); addP(st.spine[2], 0, p * .12); addP(st.spine[1], 0, p * .08);
        addP(st.head, 1, y * .45); addP(st.neck, 1, y * .3); addP(st.spine[2], 1, y * .15); addP(st.spine[1], 1, y * .1);
      } else if (spec.kind === 'flinch') {
        const s = spec.sgn * env;   // front hit: chest and head snap back, shoulders up, arms half up
        addP(st.spine[1], 0, -7 * s); addP(st.spine[2], 0, -9 * s); addP(st.neck, 0, -8 * s); addP(st.head, 0, -10 * s);
        st.hp = [st.hp[0], st.hp[1] - .02 * k * env, st.hp[2] - .025 * k * s];
        st.arm.forEach(a => { a.sh += 8 * env; a.swing += 22 * env; a.elbow += 45 * env; a.out += 6 * env; a.curl += 30 * env; });
      } else if (spec.f === 'look') {
        const y = 38 * Math.sin(2 * Math.PI * Math.min(1, u * 1.1)) * env;
        addP(st.head, 1, y * .55); addP(st.neck, 1, y * .3); addP(st.spine[2], 1, y * .15); addP(st.head, 0, -4 * env);
      } else if (spec.f === 'shift') {
        const x = .045 * k * Math.sin(Math.PI * u) * env;
        st.hp = [st.hp[0] + x, st.hp[1] - .006 * k * env, st.hp[2]];
        st.hq = qMul(st.hq, qZ(4 * env * Math.sin(Math.PI * u)));
        addP(st.spine[1], 2, -3 * env); addP(st.head, 2, -2 * env);
      } else if (spec.f === 'hands') {
        const r = Math.sin(2 * Math.PI * u * 3) * env;
        st.arm.forEach((a, s) => { a.swing += 18 * env; a.inward = 12 * env; a.elbow += 72 * env + 5 * r * (s ? -1 : 1); a.out -= 4 * env; a.curl += 10 * env; });
        addP(st.head, 0, 12 * env); addP(st.neck, 0, 8 * env);
      } else if (spec.f === 'stretch') {
        st.arm.forEach(a => { a.out += 152 * env; a.swing += 6 * env; a.elbow -= 10 * env; a.sh += 14 * env; a.curl -= 10 * env; });   // arms up overhead
        addP(st.spine[2], 0, -6 * env); addP(st.spine[1], 0, -4 * env); addP(st.head, 0, -14 * env);
        st.hp = [st.hp[0], st.hp[1] + .004 * k * env, st.hp[2]];
      }
      return st;
    };
    return { plan, dur, contacts, speed: 0, dir: [0, 0], heading: 0, sync: 0, loop: false, additive: true, pose: spec.kind === 'look', blend: spec.blend, fps: 30 };
  }

  // ═══ Generate one clip ═══
  function generate(sk, id){
    const spec = SPEC[id]; if (!spec) throw new Error('skel: unknown clip ' + id);
    const pl = spec.kind === 'gait' ? gaitPlanner(sk, spec) : spec.kind === 'turn' ? turnPlanner(sk, spec) : spec.kind === 'idle' ? idlePlanner(sk, spec) : overlayPlanner(sk, spec);
    const fps = pl.fps, frames = Math.max(1, Math.round(pl.dur * fps)), dur = frames / fps, n = frames + 1;
    const kt = pl.dur / dur;   // planner time per clip time (≈ 1; loops close exactly at the last frame)
    // hips height: nominal, limited by leg reach (both legs), smoothed, limited again
    const SUB = 8, NF = frames * SUB + 1, hN = new Float64Array(NF), hM = new Float64Array(NF), sts = new Array(n);
    const reachMax = (st) => {
      let m = Infinity;
      for (let s = 0; s < 2; s++) {
        const ul = UL[s], o = qRot(st.hq, [sk.off[ul * 3], sk.off[ul * 3 + 1], sk.off[ul * 3 + 2]]), f = st.foot[s];
        const ll = LL[s], ft = FT[s], L = (Math.hypot(sk.off[ll * 3], sk.off[ll * 3 + 1], sk.off[ll * 3 + 2]) + Math.hypot(sk.off[ft * 3], sk.off[ft * 3 + 1], sk.off[ft * 3 + 2])) * .985;
        const dx = f.a[0] - st.hp[0] - o[0], dz = f.a[2] - st.hp[2] - o[2], h2 = L * L - dx * dx - dz * dz;
        m = Math.min(m, f.a[1] - o[1] + Math.sqrt(Math.max(1e-6, h2)));
      }
      return m;
    };
    for (let j = 0; j < NF; j++) { const st = pl.plan(j / SUB / fps * kt); hN[j] = st.hp[1]; hM[j] = reachMax(st); if (j % SUB === 0) sts[j / SUB] = st; }
    const h0 = new Float64Array(NF); for (let j = 0; j < NF; j++) h0[j] = Math.min(hN[j], hM[j]);
    let h = h0;
    if (!pl.additive) for (let pass = 0; pass < 3; pass++) {   // box filter ±.05 s (wraps for loops)
      const r = Math.max(1, Math.round(.05 * fps * SUB)), o = new Float64Array(NF);
      for (let j = 0; j < NF; j++) { let s = 0, c = 0; for (let q = -r; q <= r; q++) { let x = j + q; if (pl.loop) x = ((x % (NF - 1)) + (NF - 1)) % (NF - 1); else x = Math.max(0, Math.min(NF - 1, x)); s += h[x]; c++; } o[j] = Math.min(s / c, hM[j]); }
      h = o;
    }
    const q = new Float32Array(n * NB * 4), p = new Float32Array(n * 3), rt = new Float32Array(n * 3), tt = new Float32Array(n);
    reach = 0;
    for (let i = 0; i < n; i++) {
      const st = sts[i]; st.hp = [st.hp[0], h[i * SUB], st.hp[2]];
      const Q = solve(sk, st);
      for (let b = 0; b < NB; b++) { let qq = Q[b]; if (i > 0) { const o = (i - 1) * NB * 4 + b * 4; if (qq[0] * q[o] + qq[1] * q[o + 1] + qq[2] * q[o + 2] + qq[3] * q[o + 3] < 0) qq = qq.map(x => -x); } q.set(qq, (i * NB + b) * 4); }
      p.set(st.hp, i * 3); rt.set(st.root, i * 3); tt[i] = i / fps;
    }
    // loops: the last frame equals the first in the root frame (root keeps moving)
    if (pl.loop) { for (let b = 0; b < NB * 4; b++) q[(n - 1) * NB * 4 + b] = q[b]; for (let c = 0; c < 3; c++) p[(n - 1) * 3 + c] = p[c]; }
    const sc = 1 / kt, cl = L => L.map(c => c.slice(0, 4).map(x => Math.max(0, Math.min(dur, x * sc)))).filter(c => c[1] - c[0] > 1e-6), contacts = { L: cl(pl.contacts[0]), R: cl(pl.contacts[1]) };
    const clip = { name: id, action: spec.action, variant: spec.variant, loop: !!pl.loop, additive: !!pl.additive, pose: !!pl.pose, fps, dur, n, t: tt, q, p, root: rt,
      speed: +pl.speed.toFixed(4), dir: pl.dir, heading: pl.heading, contacts, sync: +pl.sync.toFixed(4), blend: pl.blend, reach, v: VERSION };
    clip.slide = footSlide(sk, clip);
    return clip;
  }
  const batch = (sk, ids) => (ids || LIST).map(id => generate(sk, id));

  // ═══ Sampling like an engine: slerp rotations, lerp positions and root ═══
  function frameAt(clip, t){
    const n = clip.n; if (n < 2) return [0, 0, 0];
    let x = t * clip.fps; if (x < 0) x = 0; if (x > n - 1) x = n - 1;
    const i = Math.min(n - 2, Math.floor(x)); return [i, i + 1, x - i];
  }
  function localsAt(clip, t){
    const [a, b, f] = frameAt(clip, t), Q = new Array(NB), q = clip.q;
    for (let k = 0; k < NB; k++) { const oa = (a * NB + k) * 4, ob = (b * NB + k) * 4; Q[k] = qSlerp([q[oa], q[oa + 1], q[oa + 2], q[oa + 3]], [q[ob], q[ob + 1], q[ob + 2], q[ob + 3]], f); }
    const L = (arr, c) => arr[a * 3 + c] + (arr[b * 3 + c] - arr[a * 3 + c]) * f;
    return { Q, hp: [L(clip.p, 0), L(clip.p, 1), L(clip.p, 2)], root: [L(clip.root, 0), L(clip.root, 1), L(clip.root, 2)] };
  }
  function sample(sk, clip, t){
    const s = localsAt(clip, t), r = s.root, w = fk(sk, s.Q, s.hp, qY(r[2] / D2R), [r[0], 0, r[1]]), out = new Float64Array(NB * 3);
    for (let i = 0; i < NB; i++) out.set(w.P[i], i * 3);
    return { pos: out, G: w.G, P: w.P };
  }
  // contact point of foot s at time t: heel during the heel roll, ankle when flat, ball (toes joint) during the toe roll
  function pivotAt(sk, w, s, kind){ const ft = FT[s]; if (kind === 2) return w.P[TO[s]]; if (kind === 1) return vAdd(w.P[ft], qRot(w.G[ft], sk.heel[s])); return w.P[ft]; }
  // Planted window = the key frames inside a contact (an engine interpolates across the touchdown/lift key gap).
  // L/R/max — contact point speed between consecutive keys (what a clip stores; bar ≤ 0.01 m/s); wob — the largest
  // in-between bulge at 120 Hz with slerp/lerp like an engine (mm, sub-mm = invisible).
  function footSlide(sk, clip){
    const res = { L: 0, R: 0, max: 0, wob: 0 }, fps = clip.fps;
    for (let s = 0; s < 2; s++) for (const c of clip.contacts[s ? 'R' : 'L']) {
      const [a0, b0, flat, toe] = c;
      const ka = Math.ceil(a0 * fps - 1e-6), kb = Math.floor(b0 * fps + 1e-6);
      for (let k = ka; k < kb; k++) {
        const t0 = k / fps, t1 = (k + 1) / fps, kind = t0 < flat - 1e-9 ? 1 : t1 > toe + 1e-9 ? 2 : 0;   // heel and ball stay put through the flat part too
        const p0 = pivotAt(sk, sample(sk, clip, t0), s, kind), p1 = pivotAt(sk, sample(sk, clip, t1), s, kind);
        const sp = vLen(vSub(p1, p0)) * fps, side = s ? 'R' : 'L';
        if (sp > res[side]) res[side] = sp;
        for (let j = 1; j < 4; j++) { const pm = pivotAt(sk, sample(sk, clip, t0 + j / (4 * fps)), s, kind), lin = vAdd(p0, vSc(vSub(p1, p0), j / 4)); res.wob = Math.max(res.wob, vLen(vSub(pm, lin)) * 1000); }
      }
    }
    res.L = +res.L.toFixed(5); res.R = +res.R.toFixed(5); res.max = Math.max(res.L, res.R); res.wob = +res.wob.toFixed(2);
    return res;
  }

  // ═══ clips.csv (Layer-1 metadata, one row per clip) ═══
  const CSV_COLUMNS = ['clip', 'action', 'variant', 'loop', 'additive', 'ref', 'pose', 'dur_s', 'fps', 'frames', 'speed_mps', 'dir_x', 'dir_z', 'heading_deg', 'rot_offset_deg', 'root_motion',
    'L_plant', 'L_lift', 'R_plant', 'R_lift', 'L_contacts', 'R_contacts', 'sync', 'blend_in_s', 'blend_out_s', 'foot_slide_mps', 'notes'];
  function csv(clips){
    const f3 = x => (+x).toFixed(3), cell = v => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [CSV_COLUMNS.join(',')];
    for (const c of clips) {
      const nr = x => c.dur > 0 ? x / c.dur : 0, iv = L => L.map(x => f3(nr(x[0])) + '-' + f3(nr(x[1]))).join(';');
      // loops: the first plant inside the cycle and its lift (lift may wrap past 1)
      const pl = L => { if (!c.loop || !L.length || (L.length === 1 && L[0][0] < 1e-6 && L[0][1] > c.dur - 1e-6)) return ['', '']; const x = L.find(q => q[0] > 1e-6) || L[0]; let lift = x[1]; if (lift >= c.dur - 1e-6 && L[0][0] < 1e-6 && L.length > 1) lift = L[0][1] + c.dur; return [f3(nr(x[0]) % 1), f3(nr(lift) % 1)]; };
      const [lp, ll] = pl(c.contacts.L), [rp, rl] = pl(c.contacts.R);
      const rm = c.additive ? 'none' : c.heading ? 'xz+yaw' : (c.speed > 0 || /^(start|stop)/.test(c.variant)) ? 'xz' : 'none';
      const notes = [PROPOSED[c.action] ? 'PROPOSED action id: ' + PROPOSED[c.action] : '', c.additive ? (c.pose ? 'additive pose: play the last frame, weight = amount' : 'additive overlay on loco.idle') : '',
        c.sync && !c.loop ? (c.variant.startsWith('start') ? 'ends at loop phase ' + f3(c.sync) : 'starts at loop phase ' + f3(c.sync)) : ''].filter(Boolean).join('; ');
      rows.push([c.name, c.action, c.variant, c.loop ? 'Y' : 'N', c.additive ? 'Y' : 'N', c.additive ? 'frame0' : '', c.pose ? 'Y' : 'N', f3(c.dur), c.fps, c.n - 1, f3(c.speed), f3(c.dir[0]), f3(c.dir[1]), c.heading, 0, rm,
        lp, ll, rp, rl, iv(c.contacts.L), iv(c.contacts.R), f3(c.sync), c.blend[0], c.blend[1], (c.slide ? c.slide.max : 0).toFixed(4), notes].map(cell).join(','));
    }
    return rows.join('\n') + '\n';
  }
  function hash(c){
    let h = 2166136261 >>> 0;
    const eat = a => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; } };
    eat(c.q); eat(c.p); eat(c.root); eat(c.t);
    return ('0000000' + h.toString(16)).slice(-8);
  }

  // ═══ three.js clip (shared by every instance of a model: tracks are read-only) ═══
  // o.names[b] — node name for shared bone b (null = the model has no such bone); o.root: 'inplace' (default for loops) or 'bake'
  // (Hips carries the root motion: one-shots show their turn/steps); o.target — retarget onto another rest pose:
  // { R: Float64Array(NB·4) world rest quats of the target bones (shared order), T: same but "as in a T-pose" (see model.js),
  //   chain: for each shared bone the nearest mapped ancestor, hipsP: target rest hips position, hipsK: target/source hips height }
  function toThree(T, clip, o){
    o = o || {};
    const names = o.names || BONES.map(b => b.id), bake = o.root ? o.root === 'bake' : !clip.loop, n = clip.n, tr = [];
    const times = Float32Array.from(clip.t), tg = o.target, has = names.map(Boolean);
    const quat = new Array(NB).fill(0).map(() => new Float32Array(n * 4)), hipsP = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const ry = qY(clip.root[i * 3 + 2] / D2R), Q = new Array(NB);
      for (let b = 0; b < NB; b++) { const k = (i * NB + b) * 4; Q[b] = [clip.q[k], clip.q[k + 1], clip.q[k + 2], clip.q[k + 3]]; }
      if (bake) Q[0] = qMul(ry, Q[0]);
      let hp = [clip.p[i * 3], clip.p[i * 3 + 1], clip.p[i * 3 + 2]];
      if (bake) hp = vAdd(qRot(ry, hp), [clip.root[i * 3], 0, clip.root[i * 3 + 1]]);
      if (tg) {
        // canonical world rotations → target: G'_j = G_j · Tw_j; local = G'_parent⁻¹ · G'_j (parent = nearest mapped ancestor)
        const G = new Array(NB), Gt = new Array(NB);
        for (let b = 0; b < NB; b++) { const pi = BONES[b].parent; G[b] = pi < 0 ? Q[b] : qMul(G[pi], Q[b]); }
        for (let b = 0; b < NB; b++) {
          if (!has[b]) continue;
          Gt[b] = qMul(G[b], tg.Tw[b]);
          const pa = tg.chain[b], L = pa < 0 ? qMul(qInv(tg.pw || qId()), Gt[b]) : qMul(qInv(Gt[pa]), Gt[b]);
          Q[b] = L;
        }
        hp = vAdd(tg.hipsP, vSc(vSub(hp, tg.srcHips), tg.hipsK));
      }
      for (let b = 0; b < NB; b++) { let qq = Q[b]; if (i > 0) { const a = quat[b], o2 = (i - 1) * 4; if (qq[0] * a[o2] + qq[1] * a[o2 + 1] + qq[2] * a[o2 + 2] + qq[3] * a[o2 + 3] < 0) qq = qq.map(x => -x); } quat[b].set(qq, i * 4); }
      hipsP.set(hp, i * 3);
    }
    const scale = o.scale || 1;
    if (scale !== 1) for (let i = 0; i < hipsP.length; i++) hipsP[i] *= scale;
    if (has[0]) tr.push(new T.VectorKeyframeTrack(names[0] + '.position', times, hipsP));
    for (let b = 0; b < NB; b++) if (has[b]) tr.push(new T.QuaternionKeyframeTrack(names[b] + '.quaternion', times, quat[b]));
    const c = new T.AnimationClip(clip.name, clip.dur, tr);
    c.userData = { d37: meta(clip) };
    return c;
  }
  const meta = c => ({ action: c.action, variant: c.variant, loop: c.loop, additive: c.additive, pose: c.pose, speed: c.speed, dir: c.dir, heading: c.heading, sync: c.sync, blend: c.blend });

  const planner = (sk, id) => { const spec = SPEC[id]; return spec.kind === 'gait' ? gaitPlanner(sk, spec) : spec.kind === 'turn' ? turnPlanner(sk, spec) : spec.kind === 'idle' ? idlePlanner(sk, spec) : overlayPlanner(sk, spec); };
  E.skel = { VERSION, planner, BONES, NB, IDX, index: id => IDX[id] ?? -1, reference, fromJoints, restPose, LIST, SPEC, GAIT, PROPOSED, generate, batch, sample, footSlide, csv, CSV_COLUMNS, hash, toThree, meta, fk,
    q: { mul: qMul, inv: qInv, rot: qRot, slerp: qSlerp, arc: qArc, axis: qAx, frames: qFrames, norm: qNorm } };
  if (typeof module !== 'undefined' && module.exports) module.exports = E.skel;
})();
