// AI3D /tools/3d (T-112, A1) in node — the owner's checks + real three r149 + GLB export + import into D37E.models.
//  1) the owner's test.mjs (unit checks) and test-run.mjs (integration on stub THREE), ported to read js/apps/ai3d/ai3d-core.js;
//  2) the editor body in strict mode on REAL three r149 (only GPU objects stubbed): every self-test command row, selftest(), the six demo
//     scenes of ai3d-ui.js;
//  3) GLB export through ai3d-gltf.js with the r149 GLTFExporter loaded the same way as in the browser (import line rewritten to read
//     globalThis.THREE): binary GLB ('glTF' magic, version 2, lengths), no userData extras (only meshes[].extras.targetNames), JSON chunk
//     small, linear colours ('#a8754a' → 0.392 ± 0.001, COLOR_0 = linear of the editor's colours), full-detail geometry while the editor
//     shows LOD copies / culls far objects, no outline hulls, the editor's geometries untouched, animations kept;
//  4) the r149 GLTFLoader reads every GLB back (meshes, animations, colours); D37E.models.compile accepts all six (js/engine/model.js).
// GLBs are written to D37_TMP/t112/glb (Blender check: E:\claude-tmp\t112\blender\check.py).
// Run from the site root: node scripts/ai3d-test.cjs <path to node_modules/three r149>   (or THREE_PATH / DEPS_DIR)
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const SITE = path.join(__dirname, '..');
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const OUT = path.join(TMP, 't112', 'glb');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : (typeof extra === 'string' ? extra : JSON.stringify(extra))); } };
const lin = c => c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);

function threeDir(){
  for (const p of [process.argv[2], process.env.THREE_PATH, process.env.DEPS_DIR && path.join(process.env.DEPS_DIR, 'node_modules/three')].filter(Boolean))
    if (fs.existsSync(path.join(p, 'build/three.module.js'))) return p;
  return null;
}

(async () => {
  // ═══ 1. The owner's suites ═══
  for (const [f, re] of [['owner-test.mjs', /Все проверки прошли: (\d+)/], ['owner-run.mjs', /Интеграционные проверки прошли/]]) {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'ai3d', f)], { encoding: 'utf8', timeout: 120000 });
    const outp = (r.stdout || '') + (r.stderr || ''), m = outp.match(re);
    const rows = (outp.match(/^✓ /gm) || []).length, skips = (outp.match(/^· /gm) || []).length;
    ok(r.status === 0 && m, 'owner ' + f, outp.split('\n').filter(l => /^(✗|ОШИБ|FAIL|Error)/.test(l)).slice(0, 8).join(' | ') || outp.slice(-400));
    console.log(`owner ${f}: exit ${r.status}${m && m[1] ? ', checks ' + m[1] : ''}${rows ? ', rows ok ' + rows : ''}${skips ? ', skipped on stubs ' + skips : ''}`);
  }

  const TD = threeDir();
  if (!TD) { console.log('three r149 not found (argument, THREE_PATH or DEPS_DIR) — only the owner suites ran'); console.log(`ai3d-test: ${pass} ok, ${fail} failed`); process.exit(fail ? 1 : 0); }
  const T = await import(pathToFileURL(path.join(TD, 'build/three.module.js')).href);
  ok(T.REVISION === '149', 'three r149', T.REVISION);

  // ═══ 2. Editor body on real three r149, strict mode, in this realm (one set of typed arrays for three and the exporter) ═══
  const mk = () => { const f = function () {}; return new Proxy(f, { get: (t, k) => { if (k === Symbol.toPrimitive) return () => 0; if (k === 'then') return undefined; if (!(k in t)) t[k] = mk(); return t[k]; }, apply: () => mk(), construct: () => mk(), set: (t, k, v) => { t[k] = v; return true; } }); };
  const warns = [], origWarn = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  const missing = new Set();
  const shim = { ...T, WebGLRenderer: mk(), PMREMGenerator: mk() };
  const THREE = new Proxy(shim, { get: (t, k) => { if (k in t) return t[k]; missing.add(String(k)); return (t[k] = mk()); } });
  const ctx2d = () => ({ putImageData(){}, drawImage(){}, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(4 * (w || 1) * (h || 1)) }), fillRect(){}, clearRect(){}, strokeRect(){}, save(){}, restore(){}, beginPath(){}, rect(){}, clip(){},
    strokeText(){}, fillText(){}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(4 * w * h), width: w, height: h }), createLinearGradient: () => ({ addColorStop(){} }) });
  const canvas = () => { const c = mk(); c.width = c.height = 0; c.getContext = ctx2d; c.toDataURL = () => 'data:,'; return c; };
  const doc = mk(); doc.createElement = canvas;
  class ImgData { constructor(d, w, h){ this.data = d; this.width = w; this.height = h; } }
  Object.assign(globalThis, { THREE, document: doc, window: globalThis, host: doc, env: {}, requestAnimationFrame: () => 0, cancelAnimationFrame(){}, ImageData: ImgData, Image: mk(),
    ResizeObserver: mk(), getComputedStyle: () => ({ getPropertyValue: () => '' }), devicePixelRatio: 1, location: { search: '', hash: '', href: 'http://localhost/' },
    FileReader: class { readAsArrayBuffer(b){ b.arrayBuffer().then(a => { this.result = a; this.onloadend && this.onloadend(); }); } readAsDataURL(b){ b.arrayBuffer().then(a => { this.result = 'data:application/octet-stream;base64,' + Buffer.from(a).toString('base64'); this.onloadend && this.onloadend(); }); } } });
  const src = fs.readFileSync(path.join(SITE, 'js/apps/ai3d/ai3d-core.js'), 'utf8');
  const a = src.indexOf('/*@ai3d-body*/'), b = src.indexOf('/*@ai3d-body-end*/');
  ok(a > 0 && b > a && /\nreturn __site;\n\}\nwindow\.D37AI3DCore=\{create\};/.test(src.slice(b)), 'core: body markers and factory');
  const body = '"use strict";\n' + src.slice(a + 14, b);   // strict: an implicit global anywhere throws (in the browser it would leak onto window)
  const t0 = performance.now();
  try { vm.runInThisContext(body, { filename: 'ai3d-core.js' }); } catch (e) { console.log('BODY LOAD ERROR', e.stack.split('\n').slice(0, 4).join('\n')); process.exit(1); }
  console.log(`editor body loaded on real three r${T.REVISION} (strict) in ${(performance.now() - t0).toFixed(0)} ms`);
  const S = vm.runInThisContext('__site');
  ok(S && typeof S.dispose === 'function' && typeof S.exportGLB === 'function' && S.api === globalThis.AI3D, 'core: __site API and window.AI3D');
  ok(THREE.ColorManagement.legacyMode === true, 'core: legacy colour maths while open');
  // self-test command rows
  const rows = vm.runInThisContext(`(()=>{const T=${src.slice(src.indexOf('const T=[', a) + 8, src.indexOf('];', src.indexOf('const T=[', a)) + 1)};return T.map(r=>[r[0],Array.isArray(r[1])?r[1]:null])})()`);
  S.reset(); let rp = 0, rf = 0, fnRows = 0; const rfails = [];
  for (const [n, c] of rows) { if (!c) { fnRows++; continue; } let r; try { r = S.run(c); } catch (e) { r = { ok: false, error: 'THROW ' + e.message }; } if (r.ok) rp++; else { rf++; rfails.push(n + ': ' + r.error); } }
  ok(rf === 0 && rp >= 36, 'self-test command rows on real r149', rfails);
  console.log(`self-test command rows: ${rp} ok, ${rf} failed, ${fnRows} function rows (run by selftest())`);
  const st = String(globalThis.AI3D.selftest()), stBad = st.split('\n').filter(l => l.startsWith('✗'));
  const stN = +(st.match(/из (\d+)|Все (\d+)/) || []).slice(1).find(Boolean);
  ok(stN >= 50 && stBad.length === 0, 'selftest() on real r149 (canvas stub)', stBad);
  console.log('selftest():', st.split('\n')[0]);

  // ═══ 3. GLB export (ai3d-gltf.js, exporter module rewritten like in the browser) ═══
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/apps/ai3d/ai3d-gltf.js'), 'utf8'), { filename: 'ai3d-gltf.js' });
  const G = globalThis.D37AI3DGltf;
  const expSrc = fs.readFileSync(path.join(TD, 'examples/jsm/exporters/GLTFExporter.js'), 'utf8');
  let Exporter = null;
  try { Exporter = (await import('data:text/javascript;base64,' + Buffer.from(G.toModule(expSrc)).toString('base64'))).GLTFExporter; } catch (e) { console.log('exporter module:', e.message); }
  ok(typeof Exporter === 'function', 'r149 GLTFExporter loads through toModule() (reads globalThis.THREE)');
  let threw = false; try { G.toModule('export const x = 1;'); } catch (e) { threw = true; } ok(threw, 'toModule: refuses an unexpected file');
  G.setExporter(Exporter);
  globalThis.env.exportGLB = (group, clips) => G.exportGLB(group, clips);   // what ai3d-ui.js passes in the browser
  const { GLTFLoader } = await import(pathToFileURL(path.join(TD, 'examples/jsm/loaders/GLTFLoader.js')).href);
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/core.js'), 'utf8'), { filename: 'core.js' });
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/model.js'), 'utf8'), { filename: 'model.js' });
  const M = globalThis.D37E.models;
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/apps/ai3d/ai3d-ui.js'), 'utf8'), { filename: 'ai3d-ui.js' });
  const DEMOS = globalThis.D37AI3DUI.DEMOS;
  ok(DEMOS.length === 6 && ['table', 'dog', 'human', 'fox', 'dragon', 'land'].every((id, i) => DEMOS[i].id === id), 'six demo scenes');
  fs.mkdirSync(OUT, { recursive: true });
  const parseGLB = buf => {
    const dv = new DataView(buf), jl = dv.getUint32(12, true);
    return { magic: dv.getUint32(0, true), ver: dv.getUint32(4, true), len: dv.getUint32(8, true), jl, jtype: dv.getUint32(16, true), json: JSON.parse(Buffer.from(buf, 20, jl).toString('utf8')),
      bin: dv.getUint32(20 + jl + 4, true) === 0x004E4942 ? new Uint8Array(buf, 20 + jl + 8, dv.getUint32(20 + jl, true)) : null };
  };
  const accRead = (g, i) => {   // float accessor → Float32Array (COLOR_0 check)
    const ac = g.json.accessors[i], bv = g.json.bufferViews[ac.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[ac.type];
    if (ac.componentType !== 5126) return null;
    const st = bv.byteStride || n * 4, o = new Float32Array(ac.count * n), dv = new DataView(g.bin.buffer, g.bin.byteOffset + (bv.byteOffset || 0) + (ac.byteOffset || 0));
    for (let k = 0; k < ac.count; k++) for (let j = 0; j < n; j++) o[k * n + j] = dv.getFloat32(k * st + j * 4, true);
    return o;
  };
  const sizes = {};
  for (const D of DEMOS) {
    S.reset();
    const ts = performance.now(), r = S.run(D.cmds), tRun = performance.now() - ts;
    ok(r.ok, D.id + ': commands run', r.error);
    if (D.id === 'land') { const m = /рассеяно (\d+)\/(\d+)/.exec(r.summary || ''), n = +(D.t.match(/\d+/) || [0])[0];
      ok(m && +m[1] === +m[2] && +m[1] === n && !/ограничено бюджетом/.test(r.summary), 'land: the picker title = pines placed (not cut by the scatter budget)', { title: D.t, scattered: m && m[0] }); }
    if (!r.ok) continue;
    const group = vm.runInThisContext('group'), clips = S.clips();
    const live = group.children.filter(m => !m.userData.aux);
    let tris = 0; for (const m of live) { const g = m.userData.g0 || m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; }
    const keep = live.map(m => [m.userData.g0 || m.geometry, Object.keys((m.userData.g0 || m.geometry).attributes).join(), (m.userData.g0 || m.geometry).attributes.normal]);
    // far camera: the editor now shows LOD copies and culls small far meshes — the export must not care
    vm.runInThisContext('dist=150;th=.8;ph=1.1;place();SET.lod=true;SET.cull=true;lodUpdate(false)');
    const lodNow = live.filter(m => m.geometry !== m.userData.g0).length, culled = live.filter(m => !m.visible).length;
    const te = performance.now();
    let buf = null;
    try { buf = await S.exportGLB(); } catch (e) { ok(false, D.id + ': export', e.stack); continue; }
    const tExp = performance.now() - te;
    vm.runInThisContext('lodUpdate(true)');
    fs.writeFileSync(path.join(OUT, D.id + '.glb'), Buffer.from(buf));
    const g = parseGLB(buf), J = g.json;
    ok(g.magic === 0x46546C67 && g.ver === 2 && g.len === buf.byteLength && g.jtype === 0x4E4F534A && g.bin, D.id + ': binary GLB (magic, version 2, length, JSON + BIN chunks)');
    const jsonTxt = JSON.stringify(J);
    const extras = []; (function walk(o, p){ if (o && typeof o === 'object') for (const k in o) { if (k === 'extras') extras.push(p + '.extras:' + Object.keys(o[k]).join('|')); walk(o[k], p + '.' + k); } })(J, '');
    ok(extras.every(x => /^\.meshes\.\d+\.extras:targetNames$/.test(x)), D.id + ': no userData extras (only morph targetNames)', extras.slice(0, 5));
    ok(!/"g0"|"aux"|"outline"/.test(jsonTxt), D.id + ': no editor userData in JSON');
    ok(g.jl < Math.min(300e3, Math.max(40e3, buf.byteLength * .2)), D.id + ': JSON chunk small (was 97% extras)', { json: g.jl, total: buf.byteLength });
    const meshNodes = J.nodes.filter(n => n.mesh !== undefined);
    const nMats = (J.materials || []).length, msig = new Set((J.materials || []).map(m => JSON.stringify(m)));
    ok(msig.size === nMats && nMats <= meshNodes.length, D.id + ': equal materials written once (the editor has one per mesh)', { materials: nMats, distinct: msig.size, meshes: meshNodes.length });
    ok(meshNodes.length === live.filter(m => m.isMesh).length, D.id + ': every editor mesh exported (incl. culled)', { nodes: meshNodes.length, live: live.length, culled });
    ok(J.nodes.every(n => !n.matrix), D.id + ': TRS nodes (no matrix)');
    let gTris = 0; for (const n of meshNodes) for (const p of J.meshes[n.mesh].primitives) gTris += (p.indices !== undefined ? J.accessors[p.indices].count : J.accessors[p.attributes.POSITION].count) / 3;
    ok(Math.abs(gTris - tris) < 1, D.id + ': full-detail triangles (not the LOD copies on screen)', { glb: gTris, full: tris, lodNow });
    ok((J.animations || []).length === clips.length, D.id + ': animations kept', { glb: (J.animations || []).length, clips: clips.length });
    ok(keep.every(([g0, attrs, nrm]) => Object.keys(g0.attributes).join() === attrs && g0.attributes.normal === nrm), D.id + ': editor geometries untouched');
    // colours
    const matOf = name => { const n = J.nodes.find(x => x.name === name); return n && J.materials[J.meshes[n.mesh].primitives[0].material]; };
    if (D.id === 'table') {
      const top = matOf('столешница'), bf = top && top.pbrMetallicRoughness.baseColorFactor;
      ok(bf && Math.abs(bf[0] - 0.392) <= 0.001 && Math.abs(bf[0] - lin(0xa8 / 255)) < 1e-6, "table: '#a8754a' → baseColorFactor 0.392 (linear)", bf);
      ok(bf && Math.abs(bf[1] - lin(0x75 / 255)) < 1e-6 && Math.abs(bf[2] - lin(0x4a / 255)) < 1e-6 && bf[3] === 1, 'table: G, B linear, alpha 1', bf);
      sizes.tableTop = bf && bf.slice(0, 3).map(v => +v.toFixed(4));
    }
    // COLOR_0: the editor's vertex colours, converted to linear
    const vcMesh = live.find(m => m.material.vertexColors && (m.userData.g0 || m.geometry).attributes.color);
    if (vcMesh) {
      const n = J.nodes.find(x => x.name === vcMesh.name), pr = J.meshes[n.mesh].primitives[0], ca = pr.attributes.COLOR_0;
      const A = ca !== undefined ? accRead(g, ca) : null, src0 = (vcMesh.userData.g0 || vcMesh.geometry).attributes.color, s = src0.itemSize;
      let maxErr = 0; if (A) for (let i = 0; i < Math.min(src0.count, 500); i++) for (let j = 0; j < 3; j++) maxErr = Math.max(maxErr, Math.abs(A[i * s + j] - lin(src0.array[i * s + j])));
      ok(A && maxErr < 1e-6, D.id + ': COLOR_0 = linear of the editor colours (' + vcMesh.name + ')', { maxErr });
    }
    const noVc = live.filter(m => !m.material.vertexColors && (m.userData.g0 || m.geometry).attributes.color).map(m => m.name);
    ok(noVc.every(nm => { const n = J.nodes.find(x => x.name === nm); return J.meshes[n.mesh].primitives.every(p => p.attributes.COLOR_0 === undefined); }), D.id + ': no COLOR_0 where the material ignores vertex colours', noVc.slice(0, 4));
    ok(meshNodes.every(n => J.meshes[n.mesh].primitives.every(p => Object.keys(p.attributes).every(k => /^(POSITION|NORMAL|TEXCOORD_[01]|COLOR_0)$/.test(k)))), D.id + ': standard attributes only');
    // r149 GLTFLoader reads it back
    let back = null;
    try { back = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej)); } catch (e) { ok(false, D.id + ': GLTFLoader', e.message); }
    if (back) {
      let bm = 0; back.scene.traverse(o => { if (o.isMesh) bm++; });
      ok(bm === meshNodes.length && back.animations.length === clips.length, D.id + ': r149 GLTFLoader reads meshes and animations back', { meshes: bm, anims: back.animations.length });
      if (D.id === 'table') { let c = null; back.scene.traverse(o => { if (o.name === 'столешница') c = o.material.color; }); ok(c && Math.abs(c.r - 0.392) < .001, 'table: loader colour 0.392', c && c.r); }
    }
    // Studio 3D: D37E.models.compile
    let model = null; const tc = performance.now();
    try { model = await M.compile([{ name: D.id + '.glb', data: buf, size: buf.byteLength }], { name: D.id }); } catch (e) { ok(false, D.id + ': D37E.models.compile', e.message); }
    const tComp = performance.now() - tc;
    if (model) {
      ok(model.tris > 0 && model.parts.length > 0, D.id + ': D37E.models.compile accepts it');
      ok(model.parts.length <= Math.max(2, nMats * 2) && (meshNodes.length < 10 || model.parts.length * 3 <= meshNodes.length), D.id + ': Studio 3D merges the meshes into a few parts (draw calls)', { meshes: meshNodes.length, materials: nMats, parts: model.parts.length });
      if (D.id === 'table') ok(model.mats.some(m => Math.abs(m.c[0] - 0.392) < .001), 'table: Studio 3D material colour linear 0.392', model.mats.map(m => m.c.map(v => +v.toFixed(3))));
    }
    sizes[D.id] = { run: Math.round(tRun), meshes: meshNodes.length, tris: Math.round(tris), lodOnScreen: lodNow, culledOnScreen: culled, anims: (J.animations || []).length,
      glbKB: Math.round(buf.byteLength / 1024), jsonKB: +(g.jl / 1024).toFixed(1), exportMs: Math.round(tExp), compileMs: Math.round(tComp), materials: nMats, studioParts: model && model.parts.length, studioTris: model && model.tris, studioKB: model && Math.round((model.bytes || 0) / 1024) };
    console.log(D.id.padEnd(7), JSON.stringify(sizes[D.id]));
  }
  // the ops the self-test rows and demos do not reach (scripts/ai3d/ops-extra.json — the e2e smoke runs them in Chrome too)
  const extra = JSON.parse(fs.readFileSync(path.join(__dirname, 'ai3d', 'ops-extra.json'), 'utf8'));
  S.reset(); const exFail = [];
  for (const [n, c] of extra) { let r; try { r = S.run(c); } catch (e) { r = { ok: false, error: 'THROW ' + e.message }; } if (!r.ok) exFail.push(n + ': ' + r.error); }
  ok(!exFail.length, 'remaining ops (mesh, parent, unconstrain, fur, addon, play, anim_del, jiggle, del, clear)', exFail);
  const runSrc = src.slice(src.indexOf('function run(cmds){', a), src.indexOf('function snap(', a));
  const allOps = new Set([...runSrc.matchAll(/c\.op==='([a-z_0-9]+)'/g)].map(m => m[1])), reached = new Set();
  for (const [, c] of rows) if (c) c.forEach(x => reached.add(x.op));
  const tA = src.indexOf('const T=[', a); for (const m of src.slice(tA, src.indexOf('];', tA)).matchAll(/op:'([a-z_0-9]+)'/g)) reached.add(m[1]);   // + ops inside selftest() function rows (photo, texture)
  for (const D of DEMOS) D.cmds.forEach(x => reached.add(x.op));
  for (const [, c] of extra) c.forEach(x => reached.add(x.op));
  ok(allOps.size === 63 && [...allOps].every(o => reached.has(o)), 'every op of run() is exercised (63)', { ops: allOps.size, missing: [...allOps].filter(o => !reached.has(o)) });
  // the geometry cache follows the scene: after selftest() (hundreds of objects) and an empty scene it is back to ≤ 60
  S.reset(); globalThis.AI3D.selftest(); const gcBig = vm.runInThisContext('GC.size'); S.reset(); S.run(DEMOS[0].cmds);
  const gcNow = vm.runInThisContext('GC.size');
  ok(gcNow <= 60, 'geometry cache pruned to the scene', { afterSelftest: gcBig, now: gcNow });
  // drawn/painted textures (TEXS) are freed when nothing refers to them, kept while undo can bring their objects back
  ok(vm.runInThisContext('Object.keys(TEXS).length') <= 8, 'textures of the self-test scene freed', vm.runInThisContext('Object.keys(TEXS).length'));
  S.reset();
  S.run(Array.from({ length: 10 }, (_, i) => ({ op: 'art', name: 'ar' + i, pos: [i, 1, 0], w: .3, h: .3, shapes: [{ t: 'ell', c: [.5, .5], r: [.4, .4], fill: '#ff8a3a' }] })));
  S.run(Array.from({ length: 10 }, (_, i) => ({ op: 'del', name: 'ar' + i })));
  const texKept = vm.runInThisContext('Object.keys(TEXS).length');
  vm.runInThisContext('state=JSON.parse(hist.pop());build()');   // what «Отменить» does
  const mapped = vm.runInThisContext('group.children.filter(m=>m.material.map).length');
  ok(texKept === 10 && mapped === 10, 'undo brings drawn cards back with their textures', { texKept, mapped });
  // undo snapshots stay bounded (terrain JSON ~4 MB each)
  S.reset(); S.run(DEMOS[5].cmds); for (let i = 0; i < 12; i++) S.run([{ op: 'set', name: 'land', pos: [0, i * .01, 0] }]);
  const histChars = vm.runInThisContext('hist.reduce((s,x)=>s+x.length,0)'), histN = vm.runInThisContext('hist.length');
  ok(histChars <= 12e6 + 5e6 && histN >= 1, 'undo history capped (~12M chars)', { histChars, histN });
  console.log(`undo history after 13 terrain edits: ${histN} snapshots, ${(histChars / 1e6).toFixed(1)}M chars`);
  // rollback still works with a capped history
  const before = JSON.stringify(globalThis.AI3D.state()).length, rb = S.run([{ op: 'set', name: 'land', pos: [0, 5, 0] }, { op: 'nope' }]);
  ok(!rb.ok && JSON.stringify(globalThis.AI3D.state()).length === before && globalThis.AI3D.state().find(o => o.name === 'land').pos[1] !== 5, 'atomic rollback after the cap');
  // dispose
  S.dispose();
  ok(THREE.ColorManagement.legacyMode === true && globalThis.AI3D === undefined, 'dispose: window.AI3D removed, colour mode restored');
  console.warn = origWarn;
  const uniq = [...new Set(warns.map(w => w.replace(/\d+/g, 'N').slice(0, 120)))];
  ok(!uniq.some(w => /morphTargets|Creating normalized normal/.test(w)), 'no r149 morphTargets / normal warnings', uniq);
  ok(missing.size === 0, 'every THREE name the editor uses exists in r149', [...missing]);
  console.log('three warnings (unique):', uniq.length ? uniq.join(' | ') : 'none');
  console.log(`GLBs: ${OUT}`);
  console.log(`ai3d-test: ${pass} ok, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e.stack); process.exit(1); });
