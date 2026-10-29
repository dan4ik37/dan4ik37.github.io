// ═══════════════════════════════════════
//  AI3D → glTF (GLB) export and «📦 В Студию 3D». AI3D author: the site owner (dan4ik37); ported into the site 2026-10-29 (T-112, A1).
// ═══════════════════════════════════════
// The owner's editor (ai3d-core.js) called the r128 exporter as parse(group, cb, { binary: true }). Fixed here:
//  1) three r149 GLTFExporter (examples/jsm, MIT, jsDelivr, exact version) with the r149 signature parse(input, onDone, onError, options)
//     — the r128 call returned a JSON object on r149, not a GLB. The jsm file imports from 'three'; the site uses the UMD build
//     (window.THREE, the same copy the games and D37E use), so the import line is rewritten to read window.THREE and the module is
//     loaded from a blob: URL — no second copy of three.
//  2) no userData "extras": the editor keeps the full source geometry in mesh.userData.g0 (dog: 3.36 of 3.45 MB of the JSON chunk).
//     The export works on clean copies (new meshes, materials, shallow geometries) — nothing from userData is written. The exporter's
//     own small meshes[].extras.targetNames (morph target names) stays.
//  3) colours: the editor works with sRGB numbers (r128 maths, ColorManagement.legacyMode = true); glTF factors and COLOR_0 are linear.
//     baseColorFactor / emissiveFactor are converted when legacyMode is on ('#a8754a' → 0.392, was 0.659); vertex colours always
//     (the editor writes raw sRGB numbers into them); colour textures are tagged sRGB (glTF baseColorTexture is sRGB).
//  Also: full-detail geometry (the editor may be showing an LOD copy), culled objects are exported too, outline hulls are skipped,
//  COLOR_0 only when the material uses vertex colours (glTF always multiplies it in), only standard attributes, normals normalized,
//  TRS nodes (animated nodes must not use a matrix), the editor's own geometries are never modified, equal materials are written once
//  (the editor has one per mesh; Studio 3D merges parts by glTF material).
// Skeleton (T-131, A2): when parts carry a shared-skeleton bone (op «skel», ai3d-rig.js) those parts become SkinnedMeshes on one
// skeleton (T-pose bones, bound in their own pose), clips get bone tracks and clips.csv-like metadata in animations[i].extras.d37;
// rollback: D37AI3DGltf.SKIN = false → the old rigid-part export.
// D37AI3DGltf: exportGLB(group, clips, o) → Promise<ArrayBuffer>; toStudio(buf, name) → model (D37E.models compile + save, the
// same way the photo editor sends pictures); toModule(src) — for node tests; setExporter(cls) — node tests inject the class.
(function(){
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const EXPORTER_URL = 'https://cdn.jsdelivr.net/npm/three@0.149.0/examples/jsm/exporters/GLTFExporter.js';
  const ATTRS = new Set(['position', 'normal', 'uv', 'uv2', 'color']);
  const lin = c => c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);

  // jsm source → module that reads window.THREE (one import line from 'three', plain names only)
  function toModule(src){
    const re = /import\s*\{([^}]*)\}\s*from\s*['"]three['"]\s*;?/;
    const m = String(src).match(re);
    if (!m || /\bimport\s*[{*\w]/.test(src.slice(m.index + m[0].length))) throw new Error('GLTFExporter: неожиданный файл');
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
    if (!names.length || !names.every(n => /^[A-Za-z_$][\w$]*$/.test(n))) throw new Error('GLTFExporter: неожиданный импорт');
    return src.slice(0, m.index) + 'const { ' + names.join(', ') + ' } = globalThis.THREE;' + src.slice(m.index + m[0].length);
  }
  let Exporter = null, loading = null;
  function loadExporter(){
    if (Exporter) return Promise.resolve(Exporter);
    if (loading) return loading;
    loading = (async () => {
      const r = await fetch(EXPORTER_URL, { mode: 'cors', credentials: 'omit' });
      if (!r.ok) throw new Error('GLTFExporter не загрузился (' + r.status + ')');
      const code = toModule(await r.text()) + '\n//# sourceURL=three@0.149.0/GLTFExporter.js\n';
      const u = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      try { Exporter = (await import(u)).GLTFExporter; } finally { URL.revokeObjectURL(u); }
      if (typeof Exporter !== 'function') throw new Error('GLTFExporter не загрузился');
      return Exporter;
    })();
    loading.catch(() => { loading = null; });   // next time — another try
    return loading;
  }

  // ═══ Clean export copy of the editor group ═══
  function exportScene(T, group){
    const factorsSrgb = !!(T.ColorManagement && T.ColorManagement.legacyMode);   // legacy: Color.set('#hex') keeps sRGB numbers
    const made = [], geos = new Map(), mats = new Map(), texs = new Map();
    const linColor = c => { const o = c.clone(); if (factorsSrgb) o.convertSRGBToLinear(); return o; };
    function tex(t){
      if (!t) return null;
      if (texs.has(t)) return texs.get(t);
      const c = t.clone(); c.encoding = T.sRGBEncoding; c.userData = t.userData && t.userData.mimeType ? { mimeType: t.userData.mimeType } : {};
      texs.set(t, c); made.push(c); return c;
    }
    function geo(g0, vc){
      const k = g0.uuid + (vc ? '+c' : '');
      if (geos.has(k)) return geos.get(k);
      const g = new T.BufferGeometry();
      for (const name in g0.attributes) {
        if (!ATTRS.has(name) || (name === 'color' && !vc)) continue;
        let a = g0.attributes[name];
        if (name === 'color') {   // sRGB numbers → linear (alpha unchanged)
          const n = a.count, s = a.itemSize, out = new Float32Array(n * s);
          for (let i = 0; i < n; i++) { out[i * s] = lin(a.getX(i)); out[i * s + 1] = lin(a.getY(i)); out[i * s + 2] = lin(a.getZ(i)); if (s > 3) out[i * s + 3] = a.getW(i); }
          a = new T.BufferAttribute(out, s);
        } else if (name === 'normal') {   // the exporter would rewrite (and warn) on the shared geometry — normalize on the copy
          let bad = false;
          for (let i = 0; i < a.count && !bad; i++) { const l = Math.hypot(a.getX(i), a.getY(i), a.getZ(i)); if (Math.abs(l - 1) > 5e-4) bad = true; }
          if (bad) {
            const out = new Float32Array(a.count * 3);
            for (let i = 0; i < a.count; i++) {
              const x = a.getX(i), y = a.getY(i), z = a.getZ(i), l = Math.hypot(x, y, z);
              if (l > 1e-12) { out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l; } else out[i * 3 + 1] = 1;   // degenerate → up
            }
            a = new T.BufferAttribute(out, 3);
          }
        }
        g.setAttribute(name, a);
      }
      if (g0.index) g.setIndex(g0.index);
      const mp = g0.morphAttributes && g0.morphAttributes.position;
      if (mp && mp.length) { g.morphAttributes.position = mp; if (g0.morphAttributes.normal) g.morphAttributes.normal = g0.morphAttributes.normal; g.morphTargetsRelative = g0.morphTargetsRelative; }
      for (const gr of g0.groups || []) g.addGroup(gr.start, gr.count, gr.materialIndex);
      geos.set(k, g); made.push(g); return g;
    }
    // The editor makes a new material for every mesh (dog: 41 materials, 3 different). Equal materials → ONE glTF material, so Studio 3D's
    // compile (js/engine/model.js bake() merges parts by material index) makes a few parts, not one draw call per mesh.
    function mat(m){
      const basic = !!m.isMeshBasicMaterial, map = tex(m.map);
      const p = { name: m.name || '', color: m.color ? linColor(m.color) : new T.Color(1, 1, 1), opacity: m.opacity, transparent: !!m.transparent,
        alphaTest: m.alphaTest || 0, side: m.side, vertexColors: !!m.vertexColors, map };
      if (!basic) Object.assign(p, { roughness: m.roughness != null ? m.roughness : .9, metalness: m.metalness || 0, emissive: m.emissive ? linColor(m.emissive) : new T.Color(0, 0, 0) });
      const key = [basic ? 'b' : 's', p.name, p.color.r, p.color.g, p.color.b, p.opacity, p.transparent, p.alphaTest, p.side, p.vertexColors, map ? map.uuid : '',
        p.roughness, p.metalness, p.emissive ? p.emissive.r + ',' + p.emissive.g + ',' + p.emissive.b : ''].join('|');
      if (mats.has(key)) return mats.get(key);
      const o = basic ? new T.MeshBasicMaterial(p) : new T.MeshStandardMaterial(p);   // basic → KHR_materials_unlit (drawn cards)
      mats.set(key, o); made.push(o); return o;
    }
    const sc = new T.Group(); sc.name = 'AI3D';
    for (const m of group.children) {
      if (!m.isMesh || (m.userData && (m.userData.aux || m.userData.outline))) continue;
      const src = (m.userData && m.userData.g0) || m.geometry, mt = Array.isArray(m.material) ? m.material[0] : m.material;
      const e = new T.Mesh(geo(src, !!(mt && mt.vertexColors)), mat(mt));
      e.name = m.name; e.position.copy(m.position); e.quaternion.copy(m.quaternion); e.scale.copy(m.scale);
      if (m.morphTargetInfluences && e.morphTargetInfluences) for (let i = 0; i < e.morphTargetInfluences.length; i++) e.morphTargetInfluences[i] = m.morphTargetInfluences[i] || 0;
      sc.add(e);
    }
    return { sc, made };
  }

  async function exportGLB(group, clips, o = {}){
    const T = o.THREE || root.THREE;
    if (!T) throw new Error('3D не загрузился');
    const Exp = o.Exporter || Exporter || await loadExporter();
    const { sc, made } = exportScene(T, group);
    if (!sc.children.length) throw new Error('Сцена пустая — нечего сохранять');
    let metas = null;
    if (api.SKIN && o.state && root.D37AI3DRig && o.state.some(x => x.bone && x.rigp)) {
      const r = root.D37AI3DRig.skinnedScene(T, group, o.state, o.ANIM || {}, sc);
      metas = r.metas;
      // the editor's rigid-part clips: keep only tracks whose node is still in the export (rigged parts are bones now)
      const has = n => !!sc.getObjectByName(n);
      clips = (clips || []).filter(c => !r.clips.some(x => x.name === c.name)).map(c => { const tr = c.tracks.filter(t => has(t.name.slice(0, t.name.lastIndexOf('.')))); return tr.length ? new T.AnimationClip(c.name, c.duration, tr) : null; }).filter(Boolean).concat(r.clips);
      sc.traverse(x => { if (x.isSkinnedMesh) { made.push(x.geometry); } });
    }
    try {
      const buf = await new Promise((ok, no) => new Exp().parse(sc, ok, e => no(e instanceof Error ? e : new Error(String(e && e.message || e))),
        { binary: true, trs: true, onlyVisible: false, animations: clips || [], maxTextureSize: o.maxTextureSize || 2048 }));
      if (!(buf instanceof ArrayBuffer) || buf.byteLength < 20 || new DataView(buf).getUint32(0, true) !== 0x46546C67) throw new Error('экспорт вернул не GLB');
      return metas ? root.D37AI3DRig.withExtras(buf, metas) : buf;
    } finally { for (const x of made) { try { x.dispose(); } catch (e) {} } }
  }

  // ═══ «📦 В Студию 3D»: the model goes into D37E.models (IndexedDB «d37e», this browser), the list «🧩 Модели» ═══
  async function toStudio(buf, name){
    if (!root.D37E || !root.D37E.models) {
      if (typeof root.gamesLoadScript === 'function') await root.gamesLoadScript('js/engine/model.js');
      else await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/engine/model.js'; s.onload = res; s.onerror = () => rej(new Error('Не загрузилась «Студия 3D»')); document.head.appendChild(s); });
    }
    const M = root.D37E && root.D37E.models;
    if (!M) throw new Error('«Студия 3D» недоступна');
    const model = await M.compile([{ name: 'ai3d.glb', data: buf, size: buf.byteLength }], { name: String(name || 'AI3D').slice(0, 40) });
    await M.save(model);
    return model;
  }

  const api = root.D37AI3DGltf = { SKIN: true, EXPORTER_URL, toModule, loadExporter, exportScene, exportGLB, toStudio, setExporter(c){ Exporter = c; } };
})();
