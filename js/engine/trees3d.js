// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — деревья в 3D (D37E.trees3d, T-022b): сетки three.js из движка деревьев (js/engine/trees.js) — кэш
//  геометрий по породе и зерну, общие материалы (ветер R.wave, времена года E.leafMaterial, зимой лиственные голые), готовые
//  предметы «Студии 3D» (tree_<порода>), срез для падения (разрушения)
// ═══════════════════════════════════════
// T3.geometry(R, sp, seed, { lod, g, rk, k }) → BufferGeometry: кора и крона одной сеткой, цвет — в вершинах (линейный), aBare —
//   порог «опадания» у вершин лиственной кроны (у коры и хвои 2 — никогда), userData: { H, crown, trunkR, box } (единицы сетки:
//   скелет × k). Одна сетка — один экземпляр (InstancedMesh) на всё дерево: кора и листва — один вызов отрисовки.
// T3.parts(R, sp, seed, { lod, k }) → [{ geo, color: '#rrggbb', kind }] — без цвета в вершинах (склейка студии: цвет — материалом
//   R.mat, batch.js сливает одинаковые).
// Кэш геометрий — свой у каждого рендерера (WeakMap): общая на страницу геометрия держала бы закрытый мир (three вешает на неё
//   слушатель «dispose» своего рендерера — T-085); числа сетки (TR.mesh) — общие на страницу.
// T3.materials(R, o) → { leaves, needles, depth, dispose } — материалы мира: ствол и листва в одном (d37Leaf погоды красит только
//   зелёное — кора не желтеет), ветер — как у травы (R.wave kind 1: верх качается, корень стоит; h — высота), D37_LEAF 2 / 3 (хвоя
//   осенью не желтеет). Зимой (E.GFXU.cl2.y — «зима» погоды движка) вершины лиственной кроны с порогом ниже зимы схлопываются —
//   ветви голые (и в тени: depth — свой материал глубины).
// T3.cut(R, geo, y) — сетка выше среза y (падающий верх, разрушения). E.prefabs['tree_<порода>'] — предмет «Студии 3D».
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const T3 = E.trees3d = E.trees3d || {};
  const meshes = new Map();       // ключ → TR.mesh (числа; общие на страницу, до 64)
  const perR = new WeakMap();     // рендерер → Map(ключ → геометрия / части)
  const lin = c => { c /= 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };   // sRGB → линейный (цвета вершин)
  const cacheOf = R => { let m = perR.get(R); if (!m) perR.set(R, m = new Map()); return m; };
  function meshOf(sp, seed, lod, g, rk){
    const key = sp + '|' + (seed >>> 0) + '|' + lod + '|' + g + '|' + (rk ?? '');
    let M = meshes.get(key);
    if (M) return M;
    const TR = E.trees;
    M = TR.mesh(TR.grow(sp, seed, { g }), { lod, rk });
    if (meshes.size >= 64) meshes.delete(meshes.keys().next().value);
    meshes.set(key, M);
    return M;
  }
  T3.geometry = (R, sp, seed, o = {}) => {
    const T = R.T, lod = o.lod | 0, g = o.g ?? 1, k = o.k ?? 1, C = cacheOf(R), key = 'g|' + sp + '|' + (seed >>> 0) + '|' + lod + '|' + g + '|' + (o.rk ?? '') + '|' + k;
    let geo = C.get(key);
    if (geo) return geo;
    const TR = E.trees, M = meshOf(sp, seed, lod, g, o.rk);
    let nv = 0, ni = 0; for (const p of M.parts) { nv += p.pos.length / 3; ni += p.idx.length; }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3), bare = new Float32Array(nv), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let ov = 0, oi = 0;
    const decid = (TR.SPECIES[sp] || {}).leaf === 'leaves';
    for (const p of M.parts) {
      const n = p.pos.length / 3, c0 = lin(p.color[0]), c1 = lin(p.color[1]), c2 = lin(p.color[2]), leafy = p.kind === 'leaves' && decid;
      for (let i = 0; i < n; i++) {
        const v = ov + i, b = .5 + p.tone[i] / 255;   // тон 0,5 — свой цвет; светлее/темнее
        pos[v * 3] = p.pos[i * 3] * k; pos[v * 3 + 1] = p.pos[i * 3 + 1] * k; pos[v * 3 + 2] = p.pos[i * 3 + 2] * k;
        nrm[v * 3] = p.nrm[i * 3]; nrm[v * 3 + 1] = p.nrm[i * 3 + 1]; nrm[v * 3 + 2] = p.nrm[i * 3 + 2];
        col[v * 3] = c0 * b; col[v * 3 + 1] = c1 * b; col[v * 3 + 2] = c2 * b;
        bare[v] = 2;
      }
      if (leafy) {   // порог «опадания» — один на облако (связные вершины): облако пропадает целиком, а не дырками
        const owner = new Int32Array(n).fill(-1);
        for (let t = 0; t < p.idx.length; t += 3) { const a = p.idx[t], b = p.idx[t + 1], c = p.idx[t + 2], r = owner[a] >= 0 ? owner[a] : owner[b] >= 0 ? owner[b] : owner[c] >= 0 ? owner[c] : a; owner[a] = owner[b] = owner[c] = r; }
        for (let i = 0; i < n; i++) bare[ov + i] = .05 + (TR.hash(owner[i] >= 0 ? owner[i] : i, seed, 91) & 1023) / 1023 * .9;
      }
      for (let t = 0; t < p.idx.length; t++) idx[oi + t] = p.idx[t] + ov;
      ov += n; oi += p.idx.length;
    }
    geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3)); geo.setAttribute('aBare', new T.BufferAttribute(bare, 1));
    geo.setIndex(new T.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    geo.userData = { H: M.H * k, crown: M.crown * k, trunkR: M.trunkR * k, box: M.box.map(v => v * k), sp, seed, lod, tree: true };
    C.set(key, geo);
    return geo;
  };
  T3.parts = (R, sp, seed, o = {}) => {
    const T = R.T, lod = o.lod | 0, k = o.k ?? 1, C = cacheOf(R), key = 'p|' + sp + '|' + (seed >>> 0) + '|' + lod + '|' + k;
    let L = C.get(key);
    if (L) return L;
    const M = meshOf(sp, seed, lod, o.g ?? 1);
    L = M.parts.map(p => {
      const geo = new T.BufferGeometry(), pos = new Float32Array(p.pos.length);
      for (let i = 0; i < pos.length; i++) pos[i] = p.pos[i] * k;
      geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(Float32Array.from(p.nrm), 3));
      geo.setIndex(new T.BufferAttribute(p.idx, 1)); geo.computeBoundingSphere();
      return { geo, color: '#' + p.color.map(c => c.toString(16).padStart(2, '0')).join(''), kind: p.kind };
    });
    L.H = M.H * k; L.trunkR = M.trunkR * k;
    C.set(key, L);
    return L;
  };
  // убрать из видеокарты всё, что этот рендерер взял (мир закрыли): числа остаются
  T3.release = R => { const C = perR.get(R); if (!C) return; for (const v of C.values()) { if (Array.isArray(v)) v.forEach(p => p.geo.dispose()); else v.dispose(); } C.clear(); perR.delete(R); };
  // Срез: часть геометрии выше y (вершины ниже — на срез; треугольники целиком ниже — прочь). Новая геометрия (её диспоуз — у вызвавшего)
  T3.cut = (R, geo, y) => {
    const T = R.T, P = geo.attributes.position.array, N = geo.attributes.normal.array, C = geo.attributes.color?.array, I = geo.index.array, nv = P.length / 3;
    const map = new Int32Array(nv).fill(-1), pos = [], nrm = [], col = [], idx = [];
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      if (P[a * 3 + 1] < y && P[b * 3 + 1] < y && P[c * 3 + 1] < y) continue;
      for (const v of [a, b, c]) {
        if (map[v] < 0) { map[v] = pos.length / 3; pos.push(P[v * 3], Math.max(y, P[v * 3 + 1]), P[v * 3 + 2]); nrm.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); if (C) col.push(C[v * 3], C[v * 3 + 1], C[v * 3 + 2]); }
        idx.push(map[v]);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3));
    if (C) g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeBoundingSphere();
    return g;
  };
  // ── Материалы: ствол и листва одним материалом (цвет — вершины); зимой — лиственные голые (вершины кроны схлопываются) ──
  const BARE_V = `#include <begin_vertex>
#ifdef D37_BARE
if ( aBare < uD37Cl2.y * 0.95 ) transformed = vec3( 0.0 );
#endif`;
  const BARE_H = `#include <common>
#ifdef D37_BARE
attribute float aBare;
uniform vec4 uD37Cl2;
#endif`;
  function barePatch(sh){
    const U = E.GFXU?.cl2;
    if (!U) return;
    sh.uniforms.uD37Cl2 = { value: U };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', BARE_H).replace('#include <begin_vertex>', BARE_V);
  }
  T3.barePatch = barePatch;
  T3.materials = (R, o = {}) => {
    const T = R.T, low = R.q === 'low', own = [], bareOk = o.bare !== false && !!E.GFXU?.cl2;
    const mk = kind => {
      const m = low ? new T.MeshLambertMaterial({ vertexColors: true }) : new T.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: 0, envMapIntensity: .55 });
      if (o.wave !== false && R.wave) R.wave(m, { kind: 'grass', h: o.h || 10 });   // ветер: верх качается, у корня стоит
      E.leafMaterial?.(m, kind);
      if (kind === 'leaves' && bareOk) { m.defines = { ...(m.defines || {}), D37_BARE: 1 }; m.onBeforeCompile = barePatch; m.customProgramCacheKey = () => 'd37bare'; }
      own.push(m);
      return m;
    };
    const leaves = mk('leaves'), needles = mk('needles');
    let depth = null;   // тени лиственных: свой материал глубины (зимой голая крона — без тени листвы)
    if (!low && bareOk) {
      depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
      depth.defines = { D37_BARE: 1 }; depth.onBeforeCompile = barePatch; depth.customProgramCacheKey = () => 'd37bareD';
      own.push(depth);
    }
    return { leaves, needles, depth, dispose(){ for (const m of own) m.dispose(); own.length = 0; } };
  };
  T3.stats = R => ({ meshes: meshes.size, geos: R ? perR.get(R)?.size || 0 : null });

  // ═══ Предметы «Студии 3D»: tree_<порода> (render.js R.prefab: свои → игры → этот список) ═══
  // Зерно — объект сцены (o.tseed — «🎲 Другое» в свойствах, иначе o.id: перенёс дерево — та же форма), размер — o.k. Части — с
  // цветом материала (R.mat: склейка студии сливает одинаковые), листва качается (wave), тело ствола — цилиндр
  const P = E.prefabs = E.prefabs || {};
  const seedOf = o => { const s = o.tseed ?? o.id; if (typeof s === 'number' && Number.isFinite(s) && s) return s >>> 0; const t = String(s ?? (o.x + ':' + o.z)); let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  T3.seedOf = seedOf;
  T3.STUDIO_K = .78;   // скелет — в блоках «Кубомира»; в студии дерево чуть ниже (рядом с прежними «Дерево» и «Ёлка»)
  const prefab = sp => (o, ph, R) => {
    const T = R.T, g = new T.Group(), k = (o.k || 1) * T3.STUDIO_K, seed = seedOf(o);
    g.position.set(o.x || 0, 0, o.z || 0); g.rotation.y = o.yaw || 0; (o.parent || R.static || R.scene).add(g);
    const L = T3.parts(R, sp, seed, { lod: R.q === 'low' ? 1 : 0, k });
    for (const p of L) {
      const m = new T.Mesh(p.geo, R.mat(p.color, { rough: .92, wave: p.kind === 'bark' ? '' : p.kind === 'needles' ? 'needles' : 'leaves' }));
      m.castShadow = true; m.receiveShadow = true; g.add(m);
    }
    const tr = Math.max(.2, L.trunkR * 1.05), hy = Math.min(2.4, L.H * .3);
    ph?.addCyl({ x: o.x || 0, z: o.z || 0, y: hy, r: tr, hy, tag: 'tree' });
    return g;
  };
  for (const sp of (E.trees?.LIST || [])) P['tree_' + sp] = prefab(sp);
})();
