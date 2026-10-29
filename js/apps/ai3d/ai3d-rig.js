// ═══════════════════════════════════════
//  AI3D → shared skeleton (T-131, AI3D A2 "our Blender": skeleton + animations). Site code; the owner's editor stays in ai3d-core.js.
// ═══════════════════════════════════════
// AI3D characters are rigid parts with roles (rg: role, side, depth, pivot pv, rest p0/r0). Here they get the shared skeleton
// (js/engine/skel.js, Unity HumanBodyBones names): op «skel» marks each part with its bone (x.bone = bone id, x.rigp = rig prefix),
// op «actions» adds the shared action clips (D37E.skel, generated for this character's own proportions) as editor animations,
// and the GLB export (ai3d-gltf.js) writes a real skin: bones in a T-pose, the mesh bound in its own pose (arms down), one
// SkinnedMesh per material, library clips with their bone tracks, the editor's own clips converted exactly (a rigid part = its bone).
// D37AI3DRig: op(c, ctx) → note; rigOf(state, prefix) → rig; skinnedScene(T, group, state, ANIM, sc) → { clips, metas };
//   withExtras(glb, metas) → GLB with animations[i].extras.d37 (clips.csv-like metadata for D37E.models / Unity).
(function(){
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const SK = () => { const s = root.D37E && root.D37E.skel; if (!s) throw new Error('скелет: не загружен js/engine/skel.js'); return s; };
  const D2R = Math.PI / 180;
  // roles that keep their own bone (they move on their own in the editor's clips: tails, wings, ears, blinking lids, jiggle)
  const EXTRA = new Set(['tail', 'wing', 'ear', 'breast', 'lid', 'jaw', 'hair']);

  // ── which shared bone a part drives: by role, side and depth (the chain from the root, see rigAuto in ai3d-core) ──
  function coreBone(x, isRoot, quad, front){
    const g = x.rg || {}, L = g.side === 'R' ? 'Right' : 'Left', d = g.depth || 1;
    switch (g.role) {
      case 'body': return isRoot ? 'Hips' : 'Spine';
      case 'neck': return 'Neck';
      case 'head': return 'Head';
      case 'arm': return d === 1 ? L + 'UpperArm' : L + 'LowerArm';
      case 'hand': return L + 'Hand';
      case 'leg': if (quad && front) return d === 1 ? L + 'UpperArm' : L + 'LowerArm'; return d === 1 ? L + 'UpperLeg' : L + 'LowerLeg';
      case 'foot': return quad && front ? L + 'Hand' : L + 'Foot';
      default: return null;
    }
  }
  // rig of the parts with this prefix: bones (T-pose rest + bind pose), part → bone, generator skeleton for bipeds
  function rigOf(state, prefix, THREE){
    const parts = state.filter(x => x.name.startsWith(prefix) && x.rg);
    if (parts.length < 2) throw new Error('skel: нет частей с ригом ' + prefix + ' (сначала make или autorig)');
    const by = new Map(parts.map(x => [x.name, x])), rootP = parts.find(x => !x.parent || !by.has(x.parent));
    const legs1 = parts.filter(x => x.rg.role === 'leg' && x.rg.depth === 1), arms1 = parts.filter(x => x.rg.role === 'arm' && x.rg.depth === 1);
    const quad = legs1.length >= 4, biped = !quad && legs1.length === 2 && arms1.length === 2;
    const fz = x => (x.rg.pv || x.pos)[2] - (rootP.rg.pv || rootP.pos)[2];
    const S = SK(), bone = new Map(), extra = [];
    // 1) core parts → shared bones (first part wins); appendages → extra bones; the rest rides on its parent's bone
    for (const x of parts) { const b = coreBone(x, x === rootP, quad, quad && fz(x) > 0); if (b && S.index(b) >= 0 && ![...bone.values()].includes(b)) bone.set(x.name, b); }
    for (const x of parts) {
      if (bone.has(x.name)) continue;
      if (EXTRA.has(x.rg.role)) { const id = 'x_' + x.name.slice(prefix.length).replace(/[^\w]/g, '_'); bone.set(x.name, id); extra.push(x); }
    }
    const boneOfPart = x => { let p = x; for (let i = 0; p && i < 64; i++) { if (bone.has(p.name)) return bone.get(p.name); p = by.get(p.parent); } return 'Hips'; };
    const need = ['Hips', 'Spine', 'Head'];
    for (const n of need) if (![...bone.values()].includes(n)) throw new Error('skel: нет части для кости ' + n + ' (нужны тело, голова)');
    // 2) joint positions (bind pose = the parts as they stand) from the pivots
    const pv = x => (x.rg.pv || x.rg.p0 || x.pos).slice();
    const partOf = id => parts.find(x => bone.get(x.name) === id);
    const A = {};
    for (const b of S.BONES) { const x = partOf(b.id); if (x) A[b.id] = pv(x); }
    if (!A.Neck) A.Neck = [A.Head[0], A.Head[1] - .05, A.Head[2]];
    // feet: the ankle is the foot's pivot; hands: the wrist; legs/arms missing → a stub under/next to the hips (creatures)
    for (const s of ['Left', 'Right']) {
      const sg = s === 'Left' ? 1 : -1, h = A.Hips;
      if (!A[s + 'UpperLeg']) A[s + 'UpperLeg'] = [h[0] + sg * .08, h[1] - .03, h[2]];
      if (!A[s + 'LowerLeg']) A[s + 'LowerLeg'] = [A[s + 'UpperLeg'][0], A[s + 'UpperLeg'][1] * .55, A[s + 'UpperLeg'][2]];
      if (!A[s + 'Foot']) A[s + 'Foot'] = [A[s + 'LowerLeg'][0], Math.max(.02, A[s + 'LowerLeg'][1] * .12), A[s + 'LowerLeg'][2]];
      const sp = A.Spine, nk = A.Neck;
      if (!A[s + 'UpperArm']) A[s + 'UpperArm'] = [sp[0] + sg * .15, sp[1] + (nk[1] - sp[1]) * .85, sp[2]];
      if (!A[s + 'LowerArm']) A[s + 'LowerArm'] = [A[s + 'UpperArm'][0] + sg * .02, A[s + 'UpperArm'][1] - .25, A[s + 'UpperArm'][2]];
      if (!A[s + 'Hand']) A[s + 'Hand'] = [A[s + 'LowerArm'][0], A[s + 'LowerArm'][1] - .22, A[s + 'LowerArm'][2]];
    }
    // 3) T-pose for bipeds: arms laid out sideways with their own lengths (legs, spine and head keep their place)
    const Tp = {};
    for (const id in A) Tp[id] = A[id].slice();
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], len = v => Math.hypot(v[0], v[1], v[2]);
    if (biped) for (const s of ['Left', 'Right']) {
      const sg = s === 'Left' ? 1 : -1, ua = A[s + 'UpperArm'], la = A[s + 'LowerArm'], ha = A[s + 'Hand'];
      Tp[s + 'LowerArm'] = [ua[0] + sg * len(sub(la, ua)), ua[1], ua[2]];
      Tp[s + 'Hand'] = [Tp[s + 'LowerArm'][0] + sg * len(sub(ha, la)), ua[1], ua[2]];
    }
    const gen = S.fromJoints(Tp), o = gen.origin;   // the generator skeleton (recentred under the hips)
    const T = new Array(S.NB);
    for (let i = 0; i < S.NB; i++) T[i] = [gen.rest[i * 3] + o[0], gen.rest[i * 3 + 1], gen.rest[i * 3 + 2] + o[2]];
    // 4) bind pose = T-pose skeleton with the arms swung down to the real directions (world quats)
    const q = S.q, Gb = new Array(S.NB).fill(null).map(() => [0, 0, 0, 1]);
    if (biped) for (const s of ['Left', 'Right']) {
      const sg = s === 'Left' ? 1 : -1, iu = S.index(s + 'UpperArm'), il = S.index(s + 'LowerArm'), ih = S.index(s + 'Hand');
      Gb[iu] = q.arc([sg, 0, 0], sub(A[s + 'LowerArm'], A[s + 'UpperArm']));
      Gb[il] = q.arc([sg, 0, 0], sub(A[s + 'Hand'], A[s + 'LowerArm']));
      Gb[ih] = Gb[il].slice();
      for (const f of ['IndexProximal', 'MiddleProximal', 'LittleProximal']) Gb[S.index(s + f)] = Gb[il].slice();
    }
    // bind world positions by FK of the T-pose offsets with those rotations
    const Pb = new Array(S.NB);
    for (let i = 0; i < S.NB; i++) {
      const pi = S.BONES[i].parent;
      if (pi < 0) { Pb[i] = T[i].slice(); continue; }
      const off = sub(T[i], T[pi]), r = q.rot(Gb[pi], off);
      Pb[i] = [Pb[pi][0] + r[0], Pb[pi][1] + r[1], Pb[pi][2] + r[2]];
    }
    // 5) bones list: shared ones, then extras (head at the part's pivot, parent = the bone of the part's parent)
    const bones = S.BONES.map((b, i) => ({ id: b.id, parent: b.parent >= 0 ? S.BONES[b.parent].id : null, T: T[i], P: Pb[i], Q: Gb[i] }));
    const idx = new Map(bones.map((b, i) => [b.id, i]));
    for (const x of extra) {
      const id = bone.get(x.name), pid = boneOfPart(by.get(x.parent) || rootP), pb = bones[idx.get(pid)], P = pv(x);
      // T-pose position: carried with the parent from its bind pose to its T-pose
      const rel = q.rot(q.inv(pb.Q), sub(P, pb.P));
      bones.push({ id, parent: pid, T: [pb.T[0] + rel[0], pb.T[1] + rel[1], pb.T[2] + rel[2]], P, Q: pb.Q.slice(), extra: true });
      idx.set(id, bones.length - 1);
    }
    // 6) weights per part: rigid, or the torso across Spine/Chest/UpperChest by height, or the foot split at the toes
    const mode = x => { const b = bone.get(x.name); if (b === 'Spine') return 'spine'; if (b === 'LeftFoot' || b === 'RightFoot') return 'foot'; return 'rigid'; };
    const partBone = new Map(parts.map(x => [x.name, { bone: idx.get(boneOfPart(x)), mode: bone.has(x.name) ? mode(x) : 'rigid', own: bone.has(x.name) }]));
    return { prefix, biped, quad, bones, idx, partBone, gen, origin: o, parts, note: parts.length + ' частей → ' + bones.length + ' костей' + (extra.length ? ' (' + extra.length + ' своих: хвост, уши, крылья…)' : '') + (biped ? ', двуногий: общие действия доступны' : quad ? ', четвероногий: свои анимации (gait)' : '') };
  }

  // ── matrices (THREE) ──
  function partRest(T, x){
    const g = x.rg || {}, p = g.p0 || x.pos || [0, 0, 0], r = g.r0 || x.rot || [0, 0, 0];
    return new T.Matrix4().compose(new T.Vector3(p[0], p[1], p[2]), new T.Quaternion().setFromEuler(new T.Euler(r[0] * D2R, r[1] * D2R, r[2] * D2R)), new T.Vector3().setScalar(x.scale || 1));
  }
  const boneWorld = (T, b, posed) => new T.Matrix4().compose(new T.Vector3().fromArray(posed ? posed.P : b.P), new T.Quaternion().fromArray(posed ? posed.Q : b.Q), new T.Vector3(1, 1, 1));

  // ── library clip → editor keys (rigid parts follow their bone) ──
  function libKeys(T, rig, clip){
    const S = SK(), inplace = clip.loop, keys = [], o = rig.origin;
    const inv = rig.bones.map(b => boneWorld(T, b).invert());
    const rest = new Map(rig.parts.map(x => [x.name, partRest(T, x)]));
    const m = new T.Matrix4(), pos = new T.Vector3(), qq = new T.Quaternion(), sc = new T.Vector3(), e = new T.Euler();
    for (let i = 0; i < clip.n; i++) {
      const t = i / clip.fps, w = S.sample(rig.gen, clip, t, { inplace }), W = new Array(rig.bones.length), poses = {};
      for (let b = 0; b < S.NB; b++) W[b] = new T.Matrix4().compose(new T.Vector3(w.P[b][0] + o[0], w.P[b][1], w.P[b][2] + o[2]), new T.Quaternion().fromArray(w.G[b]), new T.Vector3(1, 1, 1));
      for (let b = S.NB; b < rig.bones.length; b++) {   // extras: rigid on their parent
        const bb = rig.bones[b], pi = rig.idx.get(bb.parent);
        W[b] = W[pi].clone().multiply(inv[pi]).multiply(boneWorld(T, bb));
      }
      for (const x of rig.parts) {
        const pb = rig.partBone.get(x.name), bi = pb.mode === 'spine' ? rig.idx.get('Chest') : pb.bone;
        m.copy(W[bi]).multiply(inv[bi]).multiply(rest.get(x.name)).decompose(pos, qq, sc);
        e.setFromQuaternion(qq);
        poses[x.name] = { pos: [pos.x, pos.y, pos.z].map(v => +v.toFixed(4)), rot: [e.x, e.y, e.z].map(v => +(v / D2R).toFixed(3)) };
      }
      keys.push({ t: +t.toFixed(4), poses });
    }
    return keys;
  }

  // ── op «skel» / «actions» (called by ai3d-core.js) ──
  function op(c, ctx){
    const { state, ANIM, THREE } = ctx, pre = c.prefix || '';
    if (!pre) throw new Error(c.op + ': нужен prefix (например "hm_")');
    if (c.op === 'skel') {
      const rig = rigOf(state, pre, THREE);
      for (const x of rig.parts) { x.bone = rig.bones[rig.partBone.get(x.name).bone].id; x.rigp = pre; }
      return 'скелет ' + pre + ': ' + rig.note + '. Дальше: actions{prefix:"' + pre + '"} — ходьба, бег, присед, повороты… (общие действия); экспорт GLB — со скелетом';
    }
    // actions: shared clips for this character → editor animations named by clip id (preview; the export regenerates them exactly)
    const rig = rigOf(state.filter(x => x.rigp === pre), pre, THREE);
    if (!rig.biped) throw new Error('actions: общие действия — для двуногих (человек, антро); у ' + pre + ' свои анимации: gait{prefix:"' + pre + '"}');
    const S = SK(), set = c.set || c.clips || 'loco';
    const SETS = { loco: ['loco.idle', 'loco.walk.fwd', 'loco.jog.fwd', 'loco.sprint.fwd', 'stance.crouch.fwd', 'loco.turn.l90'], all: S.LIST };
    const ids = Array.isArray(set) ? set : SETS[set] || [set];
    const bad = ids.filter(id => !S.SPEC[id]); if (bad.length) throw new Error('actions: нет действий ' + bad.join(', ') + '. Есть: ' + S.LIST.join(', '));
    for (const id of ids) {
      const clip = S.generate(rig.gen, id), nm = (c.name || '') + id;
      ANIM[nm] = { keys: libKeys(THREE, rig, clip), loop: clip.loop, lib: { id, prefix: pre } };
    }
    return 'действия ' + pre + ': ' + ids.length + ' (' + ids.join(', ') + '). «Играть»: play{anim:"' + ids[0] + '"}';
  }

  // ═══ Skinned export scene: replaces the rigged parts' clean copies in sc (from D37AI3DGltf.exportScene) ═══
  function mergeKey(g){ return Object.keys(g.attributes).filter(k => k !== 'skinIndex' && k !== 'skinWeight').sort().join(',') + '|' + (g.index ? 1 : 0); }
  function skinnedScene(T, group, state, ANIM, sc){
    const S = SK(), prefixes = [...new Set(state.filter(x => x.rigp && x.bone).map(x => x.rigp))], clips = [], metas = {};
    for (const pre of prefixes) {
      let rig; try { rig = rigOf(state.filter(x => x.rigp === pre), pre, T); } catch (e) { continue; }
      // bones: T-pose nodes, inverse bind = the parts' own pose
      const B = rig.bones.map(b => { const o = new T.Bone(); o.name = b.id; return o; });
      rig.bones.forEach((b, i) => { const pi = b.parent ? rig.idx.get(b.parent) : -1; B[i].position.set(b.T[0] - (pi >= 0 ? rig.bones[pi].T[0] : 0), b.T[1] - (pi >= 0 ? rig.bones[pi].T[1] : 0), b.T[2] - (pi >= 0 ? rig.bones[pi].T[2] : 0)); (pi >= 0 ? B[pi] : sc).add(B[i]); });
      const inv = rig.bones.map(b => boneWorld(T, b).invert());
      const skeleton = new T.Skeleton(B, inv.map(m => m.clone()));
      const ia = rig.idx, sp = ['Spine', 'Chest', 'UpperChest'].map(n => ia.get(n)), spY = sp.map(i => rig.bones[i].P[1]);
      // the clean copies of the rigged parts → merged per material with skin weights
      const groups = new Map(), drop = [];
      for (const m of sc.children) {
        if (!m.isMesh) continue;
        const x = rig.parts.find(p => p.name === m.name); if (!x) continue;
        drop.push(m);
        const pb = rig.partBone.get(x.name), M = partRest(T, x), g = m.geometry.clone().applyMatrix4(M), n = g.attributes.position.count;
        const mp = g.morphAttributes && g.morphAttributes.position;
        if (mp && mp.length) { const lin = new T.Matrix4().extractRotation(M).scale(new T.Vector3().setScalar(x.scale || 1)); g.morphAttributes.position = mp.map(a => { const c = a.clone(); c.applyMatrix4(g.morphTargetsRelative ? lin : M); return c; }); if (g.morphAttributes.normal) g.morphAttributes.normal = g.morphAttributes.normal.map(a => { const c = a.clone(); c.applyNormalMatrix(new T.Matrix3().getNormalMatrix(M)); return c; }); }
        const J = new Uint16Array(n * 4), W = new Float32Array(n * 4), P = g.attributes.position;
        for (let v = 0; v < n; v++) {
          if (pb.mode === 'spine') {   // torso: two neighbouring spine bones by height
            const y = P.getY(v); let k = 0; while (k < 1 && y > spY[k + 1]) k++;
            const f = Math.max(0, Math.min(1, (y - spY[k]) / ((spY[k + 1] - spY[k]) || 1))), s = f * f * (3 - 2 * f);
            J[v * 4] = sp[k]; W[v * 4] = 1 - s; J[v * 4 + 1] = sp[k + 1]; W[v * 4 + 1] = s;
          } else if (pb.mode === 'foot') {
            const toes = ia.get(rig.bones[pb.bone].id.replace('Foot', 'Toes')), tz = rig.bones[toes].P[2], f = Math.max(0, Math.min(1, (P.getZ(v) - tz + .015) / .03));
            J[v * 4] = pb.bone; W[v * 4] = 1 - f; J[v * 4 + 1] = toes; W[v * 4 + 1] = f;
          } else { J[v * 4] = pb.bone; W[v * 4] = 1; }
        }
        g.setAttribute('skinIndex', new T.Uint16BufferAttribute(J, 4));
        g.setAttribute('skinWeight', new T.Float32BufferAttribute(W, 4));
        const morph = g.morphAttributes && g.morphAttributes.position && g.morphAttributes.position.length;
        const key = morph ? 'm' + m.id : m.material.uuid + '|' + mergeKey(g);
        if (!groups.has(key)) groups.set(key, { mat: m.material, list: [], morph: morph ? m : null });
        groups.get(key).list.push(g);
      }
      for (const m of drop) sc.remove(m);
      const ident = new T.Matrix4();
      for (const [, gr] of groups) {
        const geo = gr.list.length === 1 ? gr.list[0] : merge(T, gr.list);
        const sm = new T.SkinnedMesh(geo, gr.mat); sm.name = pre + 'body';
        if (gr.morph && gr.morph.morphTargetInfluences) sm.morphTargetInfluences = gr.morph.morphTargetInfluences.slice();
        sm.bind(skeleton, ident); sc.add(sm);
      }
      // clips: library ones regenerated (exact bone tracks), the editor's own converted from the parts (rigid part = its bone)
      for (const [name, A] of Object.entries(ANIM)) {
        if (!A.keys || A.keys.length < 2) continue;
        if (A.lib && A.lib.prefix === pre && S.SPEC[A.lib.id]) {
          const gc = S.generate(rig.gen, A.lib.id), c = S.toThree(T, gc, { names: rig.bones.slice(0, S.NB).map(b => b.id), origin: rig.origin });
          c.name = name; clips.push(c); metas[name] = S.meta(gc);
        } else if (Object.keys(A.keys[0].poses).some(n => rig.partBone.has(n))) {
          const c = partClip(T, rig, name, A); if (c) clips.push(c);
        }
      }
    }
    return { clips, metas };
  }
  function merge(T, list){
    let nv = 0, ni = 0; for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const out = new T.BufferGeometry(), names = Object.keys(list[0].attributes);
    for (const k of names) { const a0 = list[0].attributes[k], C = k === 'skinIndex' ? Uint16Array : Float32Array, arr = new C(nv * a0.itemSize); let o = 0; for (const g of list) { const a = g.attributes[k]; for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[o++] = a.getComponent ? a.getComponent(i, c) : a.array[i * a.itemSize + c]; } out.setAttribute(k, new T.BufferAttribute(arr, a0.itemSize, a0.normalized)); }
    const I = new Uint32Array(ni); let o = 0, vo = 0;
    for (const g of list) { const n = g.attributes.position.count; if (g.index) for (let i = 0; i < g.index.count; i++) I[o++] = g.index.getX(i) + vo; else for (let i = 0; i < n; i++) I[o++] = i + vo; vo += n; }
    out.setIndex(new T.BufferAttribute(I, 1));
    return out;
  }
  // editor clip (part poses) → bone tracks: W_bone(t) = Part(t) · Part_rest⁻¹ · W_bone(bind); bones without a part follow their parent
  function partClip(T, rig, name, A){
    const nb = rig.bones.length, drv = new Array(nb).fill(null), rest = new Map(rig.parts.map(x => [x.name, partRest(T, x)]));
    // driver part of each bone: the part that owns it (else any part on it); the torso drives the three spine bones
    for (const own of [true, false]) for (const x of rig.parts) {
      const pb = rig.partBone.get(x.name); if (pb.own !== own) continue;
      if (pb.mode === 'spine') { for (const n of ['Spine', 'Chest', 'UpperChest']) { const i = rig.idx.get(n); drv[i] = drv[i] || x.name; } }
      else if (!drv[pb.bone]) drv[pb.bone] = x.name;
    }
    const bind = rig.bones.map(b => boneWorld(T, b)), times = A.keys.map(k => k.t), qT = rig.bones.map(() => []), pT = rig.bones.map(() => []);
    const qE = r => new T.Quaternion().setFromEuler(new T.Euler(r[0] * D2R, r[1] * D2R, r[2] * D2R));
    for (const key of A.keys) {
      const W = new Array(nb);
      for (let b = 0; b < nb; b++) {
        let d = drv[b], pi = b; while (!d && pi >= 0) { const pb = rig.bones[pi].parent; pi = pb ? rig.idx.get(pb) : -1; d = pi >= 0 ? drv[pi] : null; }
        const pose = d && key.poses[d];
        const P = pose ? new T.Matrix4().compose(new T.Vector3().fromArray(pose.pos), qE(pose.rot), new T.Vector3().setScalar((rig.parts.find(x => x.name === d).scale) || 1)) : null;
        W[b] = P ? P.multiply(rest.get(d).clone().invert()).multiply(bind[b]) : bind[b].clone();
      }
      for (let b = 0; b < nb; b++) {
        const pb = rig.bones[b].parent, L = pb ? W[rig.idx.get(pb)].clone().invert().multiply(W[b]) : W[b].clone(), p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3();
        L.decompose(p, q, s); qT[b].push(q.x, q.y, q.z, q.w); pT[b].push(p.x, p.y, p.z);
      }
    }
    const tr = [];
    rig.bones.forEach((b, i) => { tr.push(new T.QuaternionKeyframeTrack(b.id + '.quaternion', times, qT[i])); tr.push(new T.VectorKeyframeTrack(b.id + '.position', times, pT[i])); });
    return new T.AnimationClip(name, -1, tr);
  }

  // ── GLB: put the clip metadata into animations[i].extras.d37 (the exporter has no hook for it) ──
  function withExtras(buf, metas){
    if (!metas || !Object.keys(metas).length) return buf;
    const dv = new DataView(buf), jl = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
    let n = 0; for (const a of json.animations || []) if (metas[a.name]) { a.extras = Object.assign({}, a.extras, { d37: metas[a.name] }); n++; }
    if (!n) return buf;
    let js = new TextEncoder().encode(JSON.stringify(json)); const pad = (4 - js.length % 4) % 4;
    if (pad) { const t = new Uint8Array(js.length + pad); t.set(js); t.fill(0x20, js.length); js = t; }
    const rest = new Uint8Array(buf, 20 + jl), out = new Uint8Array(12 + 8 + js.length + rest.length), o = new DataView(out.buffer);
    out.set(new Uint8Array(buf, 0, 12)); o.setUint32(8, out.length, true); o.setUint32(12, js.length, true); o.setUint32(16, 0x4E4F534A, true); out.set(js, 20); out.set(rest, 20 + js.length);
    return out.buffer;
  }

  root.D37AI3DRig = { op, rigOf, libKeys, skinnedScene, partClip, withExtras };
})();
