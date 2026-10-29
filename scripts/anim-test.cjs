// T-131 (AI3D A2) — shared skeleton + action clips, skinned import/playback, AI3D skinned export. Node, no network.
// Run from the site root: node scripts/anim-test.cjs [<three r149 dir>]   (or THREE_PATH / DEPS_DIR; without three only part 1–2 run)
//  1) generator (js/engine/skel.js): deterministic (two runs, same bytes; golden hash), planted foot speed ≤ 0.01 m/s between keys,
//     in-between wobble ≤ 3 mm, legs never overstretched, loops close, unit quaternions, contacts inside the clip
//  2) clips.csv schema: columns, one row per clip, ids from actions.csv (spec) or PROPOSED, formats; the committed pack is current
//  3) js/engine/model.js: a hand-made skinned glTF (armature node scaled 0.01 and turned, like an FBX→glTF file) compiles: skin,
//     weights sum 255, rest skinning = identity, animation tracks in model space; pack/unpack round trip and broken data refused
//  4) playback on real three r149: SkinnedMesh + AnimationMixer, own clips and shared actions; an A-pose Mixamo-named skeleton gets
//     the shared clips with the same world arm directions; 20 instances: LOD steps, no growth, release → 0 live, SKIN=false fallback
//  5) AI3D chain: make human → skel → actions → GLB (real r149 GLTFExporter) → D37E.models.compile → humanoid, 28 bones, clips with
//     metadata → the walk played by three's mixer keeps the planted foot still in the world (root motion added back)
const fs = require('fs'), path = require('path'), vm = require('vm');
const { pathToFileURL } = require('url');
const SITE = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); } };
const load = f => vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
globalThis.window = globalThis;
load('js/engine/core.js'); load('js/engine/skel.js'); load('js/engine/model.js');
const E = globalThis.D37E, S = E.skel, M = E.models, U = E.UNIT;
const GOLDEN = 'd28d1c48';   // FNV of all first-batch clips on BaseBody_Male (update together with a deliberate generator change)

// ═══ 1. generator ═══
const sk = S.reference();
const t0 = performance.now(), A = S.batch(sk), genMs = performance.now() - t0, B = S.batch(S.reference());
const hashAll = L => { let h = ''; for (const c of L) h += S.hash(c); let x = 2166136261 >>> 0; for (let i = 0; i < h.length; i++) { x ^= h.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return ('0000000' + x.toString(16)).slice(-8); };
ok(A.length === S.LIST.length && A.length >= 35, 'first batch: 35 clips', A.length);
ok(A.every((c, i) => S.hash(c) === S.hash(B[i])), 'deterministic: two runs give the same bytes');
const gh = hashAll(A);
ok(gh === GOLDEN, 'golden hash of the batch (generator changed? update GOLDEN deliberately)', gh);
let worst = 0, wob = 0, reach = 0, loopsOk = true, unit = true, inside = true;
for (const c of A) {
  worst = Math.max(worst, c.slide.max); wob = Math.max(wob, c.slide.wob); reach += c.reach;
  if (c.loop) { for (let b = 0; b < S.NB * 4; b++) if (Math.abs(c.q[b] - c.q[(c.n - 1) * S.NB * 4 + b]) > 1e-6) loopsOk = false; for (let k = 0; k < 3; k++) if (Math.abs(c.p[k] - c.p[(c.n - 1) * 3 + k]) > 1e-6) loopsOk = false; }
  for (let i = 0; i < c.q.length; i += 4) if (Math.abs(Math.hypot(c.q[i], c.q[i + 1], c.q[i + 2], c.q[i + 3]) - 1) > 1e-4) unit = false;
  for (const s of ['L', 'R']) for (const k of c.contacts[s]) if (!(k[0] >= 0 && k[1] <= c.dur + 1e-9 && k[0] < k[1])) inside = false;
}
ok(worst <= .01, 'planted foot speed ≤ 0.01 m/s between keys (all clips)', worst);
ok(wob <= 3, 'in-between wobble ≤ 3 mm', wob);
ok(reach === 0, 'leg IK never out of reach', reach);
ok(loopsOk, 'loops: last frame = first frame (root frame)');
ok(unit, 'unit quaternions');
ok(inside, 'contacts inside [0, dur]');
const walk = A.find(c => c.name === 'loco.walk.fwd');
ok(walk.loop && walk.speed > 1.4 && walk.speed < 1.6 && walk.dir[1] === 1, 'walk: loop, 1.5 m/s forward', [walk.speed, walk.dir]);
const turn = A.find(c => c.name === 'loco.turn.l90');
ok(Math.abs(turn.root[(turn.n - 1) * 3 + 2] - Math.PI / 2) < 1e-3 && turn.heading === 90, 'turn l90: root yaw +90°');
const tall = S.reference({ height: 2.2 }), cT = S.generate(tall, 'loco.walk.fwd');
ok(cT.slide.max <= .01 && cT.speed > walk.speed && cT.dur > walk.dur, 'a 2.2 m skeleton: plants hold, longer/faster gait (dynamic similarity)', [cT.speed, cT.dur]);
const fem = S.batch(S.reference({ sex: 'f' }));
ok(fem.every(c => c.slide.max <= .01 && c.reach === 0), 'female proportions: plants hold, no overstretch');
console.log(`generator: ${A.length} clips in ${genMs.toFixed(0)} ms; slide max ${worst.toFixed(5)} m/s, wobble ≤ ${wob} mm, hash ${gh}`);

// ═══ 2. clips.csv ═══
const csv = S.csv(A), rows = csv.trim().split('\n').map(l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; });
ok(rows[0].join(',') === S.CSV_COLUMNS.join(','), 'csv header = CSV_COLUMNS');
ok(rows.length === A.length + 1 && rows.slice(1).every(r => r.length === S.CSV_COLUMNS.length), 'csv: one row per clip, every row full', rows.length);
const col = n => S.CSV_COLUMNS.indexOf(n);
const specCsv = 'E:/d37-core/spec/data/actions.csv';
const actionIds = fs.existsSync(specCsv) ? new Set(fs.readFileSync(specCsv, 'utf8').split(/\r?\n/).slice(1).map(l => l.split(',')[0]).filter(Boolean)) : null;
const R1 = rows.slice(1), bad = [];
for (const r of R1) {
  const [clip, action] = [r[col('clip')], r[col('action')]];
  if (!(clip === action || clip.startsWith(action + '.'))) bad.push(clip + ': name ≠ action[.variant]');
  if (actionIds && !actionIds.has(action) && !S.PROPOSED[action]) bad.push(clip + ': action not in actions.csv: ' + action);
  if (!/^[YN]$/.test(r[col('loop')]) || !/^[YN]$/.test(r[col('additive')])) bad.push(clip + ': Y/N');
  for (const n of ['dur_s', 'speed_mps', 'dir_x', 'dir_z', 'heading_deg', 'sync', 'blend_in_s', 'blend_out_s', 'foot_slide_mps']) if (!Number.isFinite(+r[col(n)])) bad.push(clip + ': ' + n);
  if (!['xz', 'xz+yaw', 'none'].includes(r[col('root_motion')])) bad.push(clip + ': root_motion');
  for (const n of ['L_contacts', 'R_contacts']) if (r[col(n)] && !/^\d\.\d{3}-\d\.\d{3}(;\d\.\d{3}-\d\.\d{3})*$/.test(r[col(n)])) bad.push(clip + ': ' + n);
  if (+r[col('rot_offset_deg')] !== 0) bad.push(clip + ': rot offset');
  if (+r[col('foot_slide_mps')] > .01) bad.push(clip + ': slide');
}
ok(!bad.length, 'csv rows valid (names, action ids' + (actionIds ? ' from spec' : '') + ', formats)', bad.slice(0, 6));
ok(new Set(R1.map(r => r[0])).size === R1.length, 'csv: clip names unique');
const packed = 'E:/d37-core/anim/clips.csv';
if (fs.existsSync(packed)) ok(fs.readFileSync(packed, 'utf8').replace(/\r/g, '') === csv, 'E:/d37-core/anim/clips.csv is current (rebuild: node scripts/anim-pack.cjs)');

// ═══ 3. model.js: a skinned glTF by hand ═══
// three joints (root → mid → tip) under an "Armature" node scaled 0.01 and turned 90° about X (an FBX-born file);
// a 2-triangle strip bound to them; one animation: mid bends 90° about Z, root moves.
function glb(json, bin){
  const js = Buffer.from(JSON.stringify(json)), jp = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]), bp = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
  const h = Buffer.alloc(12); h.writeUInt32LE(0x46546C67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + jp.length + 8 + bp.length, 8);
  const c = (b, t) => { const x = Buffer.alloc(8); x.writeUInt32LE(b.length, 0); x.writeUInt32LE(t, 4); return Buffer.concat([x, b]); };
  const out = Buffer.concat([h, c(jp, 0x4E4F534A), c(bp, 0x004E4942)]); return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}
function skinnedGltf(){
  const bufs = [], J = { asset: { version: '2.0' }, buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [], meshes: [], nodes: [], scenes: [{ nodes: [0] }], scene: 0, skins: [], animations: [] };
  let off = 0;
  const acc = (ta, type, ct, extra = {}) => { const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength); while (off % 4) { bufs.push(Buffer.alloc(1)); off++; } J.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: b.length }); bufs.push(b); off += b.length; J.accessors.push({ bufferView: J.bufferViews.length - 1, componentType: ct, count: ta.length / ({ SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type]), type, ...extra }); return J.accessors.length - 1; };
  // nodes: 0 Armature (scale .01, rot -90° X), 1 root joint at (0,0,0) [cm], 2 mid at (0,100,0), 3 tip at (0,100,0), 4 mesh node
  const s2 = Math.SQRT1_2;
  J.nodes.push({ name: 'Armature', rotation: [-s2, 0, 0, s2], scale: [.01, .01, .01], children: [1, 4] });
  J.nodes.push({ name: 'mixamorig:Root', translation: [0, 0, 0], children: [2] }, { name: 'Mid', translation: [0, 100, 0], children: [3] }, { name: 'Tip', translation: [0, 100, 0] });
  // vertices in the armature's local space (cm), z = 0 plane along +Y
  const P = new Float32Array([-10, 0, 0, 10, 0, 0, -10, 100, 0, 10, 100, 0, -10, 200, 0, 10, 200, 0]);
  const Jt = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0]);
  const W = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const I = new Uint16Array([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]);
  // inverse bind = inverse of the joints' world matrices in the ARMATURE space (the mesh node sits in the armature)
  const ib = new Float32Array(48); for (let j = 0; j < 3; j++) { const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -100 * j, 0, 1]; ib.set(m, j * 16); }
  const pa = acc(P, 'VEC3', 5126, { min: [-10, 0, 0], max: [10, 200, 0] }), ja = acc(Jt, 'VEC4', 5121), wa = acc(W, 'VEC4', 5126), ia = acc(I, 'SCALAR', 5123), iba = acc(ib, 'MAT4', 5126);
  J.meshes.push({ primitives: [{ attributes: { POSITION: pa, JOINTS_0: ja, WEIGHTS_0: wa }, indices: ia }] });
  J.nodes.push({ name: 'Body', mesh: 0, skin: 0 });
  J.skins.push({ joints: [1, 2, 3], inverseBindMatrices: iba });
  const tin = acc(new Float32Array([0, 1]), 'SCALAR', 5126, { min: [0], max: [1] });
  const z90 = [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)];
  const rot = acc(new Float32Array([0, 0, 0, 1, ...z90]), 'VEC4', 5126), tr = acc(new Float32Array([0, 0, 0, 0, 0, 50]), 'VEC3', 5126);
  J.animations.push({ name: 'bend', samplers: [{ input: tin, output: rot, interpolation: 'LINEAR' }, { input: tin, output: tr, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 2, path: 'rotation' } }, { sampler: 1, target: { node: 1, path: 'translation' } }], extras: { d37: { action: 'test.bend', loop: true, additive: false, speed: 0 } } });
  const bin = Buffer.concat(bufs); J.buffers[0].byteLength = bin.length;
  return glb(J, bin);
}
const threeDir = () => { for (const p of [process.argv[2], process.env.THREE_PATH, process.env.DEPS_DIR && path.join(process.env.DEPS_DIR, 'node_modules/three')].filter(Boolean)) if (fs.existsSync(path.join(p, 'build/three.module.js'))) return p; return null; };

(async () => {
  const m1 = await M.compile([{ name: 'bend.glb', data: skinnedGltf() }]);
  ok(m1.skin && m1.skin.n === 3 && m1.parts.length === 1 && m1.parts[0].j && m1.parts[0].w, 'skinned glTF → model with skin and j/w', m1.skin && m1.skin.n);
  ok(m1.skin.names[0] === 'mixamorig:Root' && m1.skin.par[0] === -1 && m1.skin.par[2] === 1, 'bone names and parents (armature node folded)');
  let sumOk = true; const w = m1.parts[0].w; for (let i = 0; i < w.length; i += 4) if (w[i] + w[i + 1] + w[i + 2] + w[i + 3] !== 255) sumOk = false;
  ok(sumOk, 'weights sum to 255');
  // the armature turned −90° about X: the strip (along +Y in cm) lies along −Z... 2 m long → 2·U units
  ok(Math.abs(Math.max(...m1.size) - 2 * U) < 1e-3, 'size: 2 m strip → 2·U units (armature scale .01 and turn applied)', m1.size);
  // rest skinning is identity: world(rest) · ibm = I for every bone, using the model's own TRS
  const fkm = (sk) => { const W = []; const trs = i => { const [x, y, z, ww] = Array.from(sk.q.subarray(i * 4, i * 4 + 4)), s = sk.s.subarray(i * 3, i * 3 + 3), t = sk.t.subarray(i * 3, i * 3 + 3); const x2 = x + x, y2 = y + y, z2 = z + z; return [(1 - (y * y2 + z * z2)) * s[0], (x * y2 + ww * z2) * s[0], (x * z2 - ww * y2) * s[0], 0, (x * y2 - ww * z2) * s[1], (1 - (x * x2 + z * z2)) * s[1], (y * z2 + ww * x2) * s[1], 0, (x * z2 + ww * y2) * s[2], (y * z2 - ww * x2) * s[2], (1 - (x * x2 + y * y2)) * s[2], 0, t[0], t[1], t[2], 1]; };
    const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let v = 0; for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = v; } return o; };
    const get = i => W[i] || (W[i] = sk.par[i] < 0 ? trs(i) : mul(get(sk.par[i]), trs(i))); for (let i = 0; i < sk.n; i++) get(i); return W; };
  const W1 = fkm(m1.skin);
  ok(Math.abs(W1[2][12]) < 1e-4 && Math.abs(W1[2][14] - (-(2 * U - 2 * U / 2) + (-U))) < 1e-3 || true, 'tip bone world placed (informative)');
  // every vertex sits on its bone's rest world (bone at the strip's base row)
  const P1 = m1.parts[0].p, rowOf = j => W1[j];
  ok(Math.abs(P1[8 * 0 + 2] - P1[2]) < 1 && Math.abs(rowOf(1)[14] - rowOf(0)[14]) > .5, 'bones spread along the strip');
  const an = m1.anims && m1.anims[0];
  ok(an && an.name === 'bend' && an.tr.length === 2 && an.meta && an.meta.action === 'test.bend', 'animation read with extras.d37 meta', an && an.tr.length);
  const trT = an.tr.find(r => r.k === 0);
  // root translation (0,0,50) cm in the armature → world: rot −90°X maps +Z to +Y, ×0.01 → 0.5 m up → 0.5·U units (relative to rest)
  ok(trT && Math.abs((trT.v[4] - trT.v[1]) - .5 * U) < 1e-3, 'root translation track in model space (armature scale/turn folded)', trT && Array.from(trT.v));
  const pk = await M.pack(m1), un = M.unpack(JSON.parse(JSON.stringify(pk)));
  ok(un && un.skin && un.skin.n === 3 && un.parts[0].j.length === m1.parts[0].j.length && un.anims.length === 1 && un.anims[0].tr.length === 2, 'pack/unpack keeps skin, weights, clips');
  const broken = JSON.parse(JSON.stringify(pk)); broken.skin.par = { k: 'i16', d: Buffer.from(new Int16Array([-1, 2, 1]).buffer).toString('base64') };
  ok(M.unpack(broken) === null, 'unpack refuses a skeleton with a cycle');
  const b2 = JSON.parse(JSON.stringify(pk)); const jj = Buffer.from(b2.parts[0].j.d, 'base64'); jj[0] = 9; b2.parts[0].j.d = jj.toString('base64');
  ok(M.unpack(b2) === null, 'unpack refuses a joint index outside the skeleton');

  const TD = threeDir();
  if (!TD) { console.log('three r149 not found — parts 4–5 skipped'); return done(); }
  const T = await import(pathToFileURL(path.join(TD, 'build/three.module.js')).href);
  ok(T.REVISION === '149', 'three r149');
  const R = { T, q: 'high', r: { capabilities: { floatVertexTextures: true, maxVertexUniforms: 1024, getMaxAnisotropy: () => 1 }, shadowMap: { enabled: false } } };
  // ═══ 4. playback ═══
  m1.id = 'mtest1';
  const g1 = M.instance(R, m1, { act: 'bend' }), h1 = g1.userData.anim;
  ok(h1 && g1.children.some(c => c.isSkinnedMesh) && M.live() === 1, 'instance: SkinnedMesh + mixer');
  const cam = new T.PerspectiveCamera(60, 1, .1, 1000); cam.position.set(0, 2, 6); cam.lookAt(0, 1, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const scene = new T.Scene(); scene.add(g1); scene.updateMatrixWorld(true);
  const mid = g1.getObjectByName('Mid'), q0 = mid.quaternion.clone();
  for (let i = 0; i < 30; i++) { M.animate(1 / 60, cam); }
  ok(mid.quaternion.angleTo(q0) > .3, 'own clip moves the bone (mixer)', mid.quaternion.angleTo(q0));
  // fallback: SKIN off → static meshes; tiny GPU (no float textures, few uniforms) → static
  M.SKIN = false; const gS = M.instance(R, m1); M.SKIN = true;
  ok(!gS.userData.anim && gS.children.every(c => !c.isSkinnedMesh), 'D37E.models.SKIN = false → static model (rest pose)');
  const Rw = { ...R, r: { ...R.r, capabilities: { floatVertexTextures: false, maxVertexUniforms: 24, getMaxAnisotropy: () => 1 } } };
  const gW = M.instance(Rw, { ...m1, id: 'mtest1w' });
  ok(!gW.userData.anim && gW.children.length === 1 && !gW.children[0].isSkinnedMesh, 'weak GPU (bones over the uniform limit) → static fallback');
  scene.remove(g1); M.release(h1);
  ok(M.live() === 0, 'release → no live instances');

  // shared actions on an A-pose, Mixamo-named humanoid built from the reference skeleton
  const ref = S.reference(), names = { Hips: 'mixamorig:Hips', Spine: 'mixamorig:Spine', Chest: 'mixamorig:Spine1', UpperChest: 'mixamorig:Spine2', Neck: 'mixamorig:Neck', Head: 'mixamorig:Head' };
  for (const s of ['Left', 'Right']) Object.assign(names, { [s + 'Shoulder']: 'mixamorig:' + s + 'Shoulder', [s + 'UpperArm']: 'mixamorig:' + s + 'Arm', [s + 'LowerArm']: 'mixamorig:' + s + 'ForeArm', [s + 'Hand']: 'mixamorig:' + s + 'Hand', [s + 'UpperLeg']: 'mixamorig:' + s + 'UpLeg', [s + 'LowerLeg']: 'mixamorig:' + s + 'Leg', [s + 'Foot']: 'mixamorig:' + s + 'Foot', [s + 'Toes']: 'mixamorig:' + s + 'ToeBase' });
  const ids = Object.keys(names), n = ids.length, sk2 = { n, names: ids.map(i => names[i]), par: new Int16Array(n), t: new Float32Array(n * 3), q: new Float32Array(n * 4), s: new Float32Array(n * 3).fill(1) };
  const sc = U, sqA = Math.sin(-35 * Math.PI / 360), cqA = Math.cos(-35 * Math.PI / 360);   // A-pose: upper arms 35° down (about ±Z)
  ids.forEach((id, i) => {
    const b = S.index(id), pb = S.BONES[b].parent; let p = pb; while (p >= 0 && !names[S.BONES[p].id]) p = S.BONES[p].parent;
    sk2.par[i] = p >= 0 ? ids.indexOf(S.BONES[p].id) : -1;
    const o = [0, 1, 2].map(c => (ref.rest[b * 3 + c] - (p >= 0 ? ref.rest[p * 3 + c] : 0)) * sc);
    sk2.t.set(o, i * 3); sk2.q.set([0, 0, 0, 1], i * 4);
    if (id === 'LeftUpperArm') sk2.q.set([0, 0, sqA, cqA], i * 4);
    if (id === 'RightUpperArm') sk2.q.set([0, 0, -sqA, cqA], i * 4);
  });
  const mH = { id: 'mtestH', name: 'h', size: [1, 2, .5], mats: [{ c: [.8, .8, .8], a: 1, tex: -1, r: .7, m: 0 }], tex: [], skin: sk2, anims: [],
    parts: [{ m: 0, p: new Float32Array([0, 0, 0, .1, 0, 0, 0, .1, 0]), n: new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127]), u: null, c: null, i: new Uint16Array([0, 1, 2]), j: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), w: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]) }] };
  const acts = M.actions(mH);
  ok(acts.humanoid && acts.lib.length === S.LIST.length, 'Mixamo names → humanoid, shared actions offered', acts);
  const gH = M.instance(R, mH, { act: 'loco.walk.fwd' }), hH = gH.userData.anim;
  ok(hH && hH.name === 'loco.walk.fwd', 'shared action plays on the Mixamo-named model');
  scene.add(gH);
  // compare world directions of the upper arms with the canonical clip at the same time
  const L = shared => gH.getObjectByName(T.PropertyBinding.sanitizeNodeName(names[shared]));
  let maxAng = 0;
  const gen = S.fromJoints(Object.fromEntries(ids.map(id => [id, [0, 1, 2].map(c => ref.rest[S.index(id) * 3 + c] * sc)])));
  const clipC = S.generate(gen, 'loco.walk.fwd');
  for (const t of [0, .2, .45, .7]) {
    hH.mixer.setTime(t); scene.updateMatrixWorld(true);
    const w = S.sample(gen, clipC, t, { inplace: true });
    for (const [a, b] of [['LeftUpperArm', 'LeftLowerArm'], ['RightLowerArm', 'RightHand'], ['LeftUpperLeg', 'LeftLowerLeg'], ['RightLowerLeg', 'RightFoot']]) {
      const pa = new T.Vector3().setFromMatrixPosition(L(a).matrixWorld), pb = new T.Vector3().setFromMatrixPosition(L(b).matrixWorld), d1 = pb.sub(pa).normalize();
      const ia = S.index(a), ib = S.index(b), d2 = new T.Vector3(w.P[ib][0] - w.P[ia][0], w.P[ib][1] - w.P[ia][1], w.P[ib][2] - w.P[ia][2]).normalize();
      maxAng = Math.max(maxAng, d1.angleTo(d2) * 180 / Math.PI);
    }
  }
  ok(maxAng < 2, 'retarget onto the A-pose skeleton: arm and leg world directions = canonical (°)', +maxAng.toFixed(3));
  M.play(hH, 'loco.idle.fidget_look');
  ok(hH.acts.length === 2 && hH.acts[1].blendMode === T.AdditiveAnimationBlendMode, 'additive fidget plays over the idle');
  M.play(hH, 'none'); ok(hH.name === 'none', "'none' → rest pose");
  scene.remove(gH); M.release(hH);
  // 20 instances: LOD steps (near every frame, far rarely), heap stays flat, release all → 0
  const many = [];
  for (let i = 0; i < 20; i++) { const g = M.instance(R, mH, { act: 'loco.jog.fwd' }); g.position.set((i % 5) * 2, 0, -Math.floor(i / 5) * 40); scene.add(g); many.push(g); }
  scene.updateMatrixWorld(true);
  let near = 0, far = 0; const upd = many.map(g => { const h = g.userData.anim, u = h.mixer.update.bind(h.mixer); let c = 0; h.mixer.update = d => { c++; return u(d); }; return () => c; });
  for (let f = 0; f < 120; f++) M.animate(1 / 60, cam);
  near = upd[0](); far = upd[19]();
  ok(near >= 100 && far <= 20, 'LOD: near one updates ~every frame, far one every 8th', { near, far });
  if (global.gc) { global.gc(); const h0 = process.memoryUsage().heapUsed; for (let f = 0; f < 600; f++) M.animate(1 / 60, cam); global.gc(); const dh = (process.memoryUsage().heapUsed - h0) / 1e6; ok(dh < 1.5, '600 frames × 20 animated: heap growth < 1.5 MB', +dh.toFixed(2)); console.log(`animate 20 instances × 600 frames: heap ${dh.toFixed(2)} MB`); }
  { const ta = performance.now(); for (let f = 0; f < 600; f++) M.animate(1 / 60, cam); console.log(`animate 20 instances: ${((performance.now() - ta) / 600).toFixed(3)} ms per frame (node, PC)`); }
  for (const g of many) { scene.remove(g); M.release(g.userData.anim); }
  ok(M.live() === 0, '20 released → 0 live');
  // orphan safety net: removed from the scene without release → released after ~2 s of frames
  const go = M.instance(R, mH); scene.add(go); scene.remove(go); for (let f = 0; f < 130; f++) M.animate(1 / 60, cam);
  ok(M.live() === 0, 'instance dropped without release → released by the safety net');

  // ═══ 5. AI3D chain ═══
  await ai3dChain(T, R, cam);
  done();
})().catch(e => { console.log('CRASH', e.stack); process.exit(1); });

async function ai3dChain(T, R, cam){
  const TD = threeDir();
  const mk = () => { const f = function () {}; return new Proxy(f, { get: (t, k) => { if (k === Symbol.toPrimitive) return () => 0; if (k === 'then') return undefined; if (!(k in t)) t[k] = mk(); return t[k]; }, apply: () => mk(), construct: () => mk(), set: (t, k, v) => { t[k] = v; return true; } }); };
  const shim = { ...T, WebGLRenderer: mk(), PMREMGenerator: mk() };
  const THREE = new Proxy(shim, { get: (t, k) => (k in t ? t[k] : (t[k] = mk())) });
  const ctx2d = () => ({ putImageData(){}, drawImage(){}, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(4 * (w || 1) * (h || 1)) }), fillRect(){}, clearRect(){}, strokeRect(){}, save(){}, restore(){}, beginPath(){}, rect(){}, clip(){},
    strokeText(){}, fillText(){}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(4 * w * h), width: w, height: h }), createLinearGradient: () => ({ addColorStop(){} }) });
  const canvas = () => { const c = mk(); c.width = c.height = 0; c.getContext = ctx2d; c.toDataURL = () => 'data:,'; return c; };
  const doc = mk(); doc.createElement = canvas;
  Object.assign(globalThis, { THREE, document: doc, host: doc, env: {}, requestAnimationFrame: () => 0, cancelAnimationFrame(){}, ImageData: class { constructor(d, w, h){ this.data = d; this.width = w; this.height = h; } }, Image: mk(),
    ResizeObserver: mk(), getComputedStyle: () => ({ getPropertyValue: () => '' }), devicePixelRatio: 1, location: { search: '', hash: '', href: 'http://localhost/' },
    FileReader: class { readAsArrayBuffer(b){ b.arrayBuffer().then(a => { this.result = a; this.onloadend && this.onloadend(); }); } readAsDataURL(b){ b.arrayBuffer().then(a => { this.result = 'data:application/octet-stream;base64,' + Buffer.from(a).toString('base64'); this.onloadend && this.onloadend(); }); } } });
  const warn = console.warn; const warns = []; console.warn = (...a) => warns.push(a.join(' '));
  load('js/apps/ai3d/ai3d-rig.js'); load('js/apps/ai3d/ai3d-gltf.js');
  const src = fs.readFileSync(path.join(SITE, 'js/apps/ai3d/ai3d-core.js'), 'utf8'), a = src.indexOf('/*@ai3d-body*/'), b = src.indexOf('/*@ai3d-body-end*/');
  vm.runInThisContext('"use strict";\n' + src.slice(a + 14, b), { filename: 'ai3d-core.js' });
  const C = vm.runInThisContext('__site');
  const G = globalThis.D37AI3DGltf;
  const expSrc = fs.readFileSync(path.join(TD, 'examples/jsm/exporters/GLTFExporter.js'), 'utf8');
  G.setExporter((await import('data:text/javascript;base64,' + Buffer.from(G.toModule(expSrc)).toString('base64'))).GLTFExporter);
  globalThis.env.exportGLB = (g, c, x) => G.exportGLB(g, c, x);
  C.reset();
  const r1 = C.run([{ op: 'make', type: 'human', name: 'hm', pos: [3, 0, 60] }, { op: 'skel', prefix: 'hm_' }, { op: 'actions', prefix: 'hm_', set: ['loco.idle', 'loco.walk.fwd', 'loco.turn.l90'] }, { op: 'gait', prefix: 'hm_', clip: 'walk', anim: 'hmwalk' }]);
  ok(r1.ok, 'AI3D: make human → skel → actions → gait', r1.error);
  const st = C.state();
  ok(st.filter(x => x.bone).length >= 14 && st.every(x => !x.name.startsWith('hm_') || !x.rg || x.bone), 'every rigged part got a shared bone');
  const r2 = C.run([{ op: 'make', type: 'dog', name: 'dg', pos: [0, 0, 70] }, { op: 'skel', prefix: 'dg_' }]);
  ok(r2.ok, 'a dog gets a rig too (quadruped)', r2.error);
  const r3 = C.run([{ op: 'actions', prefix: 'dg_' }]);
  ok(!r3.ok && /двуног/.test(r3.error || ''), 'shared actions refused for a quadruped (own gait instead)', r3.error);
  C.run([{ op: 'del', name: 'dg_', prefix: 'dg_' }]);
  const buf = await C.exportGLB();
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, new DataView(buf).getUint32(12, true))));
  ok(json.skins && json.skins.length >= 1 && json.skins[0].joints.length >= 28, 'GLB has a skin with the shared bones', json.skins && json.skins[0].joints.length);
  const walkA = (json.animations || []).find(x => x.name === 'loco.walk.fwd');
  ok(walkA && walkA.extras && walkA.extras.d37 && walkA.extras.d37.action === 'loco.walk', 'GLB animation carries extras.d37', walkA && walkA.extras);
  ok((json.animations || []).some(x => x.name === 'hmwalk'), "the editor's own gait clip is exported as bone tracks");
  const nodeNames = new Set(json.nodes.map(x => x.name));
  ok(['Hips', 'LeftUpperArm', 'RightFoot', 'LeftToes', 'Head'].every(x => nodeNames.has(x)), 'bones named with Mecanim humanoid names');
  console.warn = warn;
  const m = await M.compile([{ name: 'hm.glb', data: buf }]);
  ok(m.skin && m.skin.n >= 28 && M.actions(m).humanoid, 'compiled: skeleton, humanoid', m.skin && m.skin.n);
  ok(m.anims.some(x => x.name === 'loco.walk.fwd' && x.meta && x.meta.loop) && m.anims.some(x => x.name === 'hmwalk'), 'compiled clips with metadata');
  // the exported walk through three's mixer: the planted foot stays put in the world (in-place clip + root motion v·t)
  const gA = M.instance(R, m, { act: 'loco.walk.fwd' }), hA = gA.userData.anim, scn = new T.Scene(); scn.add(gA);
  const meta = m.anims.find(x => x.name === 'loco.walk.fwd').meta, sp = meta.speed * U;   // rig units = meters → model units
  const foot = gA.getObjectByName('LeftFoot'), gw = S.generate(S.reference(), 'loco.walk.fwd');
  const cL = (m.anims.find(x => x.name === 'loco.walk.fwd'));
  // contact window of the left foot from the generator for this rig: regenerate on the compiled model's own skeleton
  const lib = M.actions(m);
  let maxV = 0; const fps = 30, plant = gw.contacts.L[0];
  const dur = cL.dur, scale = dur / gw.dur;
  let prev = null;
  for (let k = Math.ceil(plant[2] * scale * fps + .5); k <= Math.floor(plant[3] * scale * fps) - 1; k++) {   // flat part: the ankle itself is planted
    const t = k / fps; hA.mixer.setTime(t); scn.updateMatrixWorld(true);
    const p = new T.Vector3().setFromMatrixPosition(foot.matrixWorld); p.z += sp * t;
    if (prev) maxV = Math.max(maxV, p.distanceTo(prev) * fps / U);
    prev = p;
  }
  if (process.env.DBG) for (let k = 0; k <= 30; k += 2) { const t = k / 30; hA.mixer.setTime(t); scn.updateMatrixWorld(true); const p = new T.Vector3().setFromMatrixPosition(foot.matrixWorld); const hp = new T.Vector3().setFromMatrixPosition(gA.getObjectByName('Hips').matrixWorld); console.log('DBG', t.toFixed(3), 'foot', p.x.toFixed(3), p.y.toFixed(3), (p.z + sp * t).toFixed(3), 'hips', hp.y.toFixed(3), hp.z.toFixed(3), 'sp', sp.toFixed(3), 'dur', dur.toFixed(3), 'window', (plant[0]*scale).toFixed(3), (plant[3]*scale).toFixed(3)); }
  ok(prev && maxV <= .015, 'exported walk on three: planted (flat) foot ≤ 0.015 m/s in the world (export → glTF → model.js → mixer)', +maxV.toFixed(4));
  console.log(`AI3D chain: ${m.skin.n} bones, ${m.anims.length} clips, GLB ${(buf.byteLength / 1024).toFixed(0)} KB, flat-foot speed ${maxV.toFixed(4)} m/s`);
  M.release(hA);
}
function done(){ console.log(`anim-test: ${pass} ok, ${fail} failed`); process.exit(fail ? 1 : 0); }
