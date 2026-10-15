// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — поток «Кубомира»: генерация чанков, свет и сетки (чтобы кадр не ждал)
// ═══════════════════════════════════════
// new Worker('js/engine/voxel-worker.js?v=…') — сам подгружает voxel.js, voxel-gen.js, voxel-mesh.js с тем же ?v=.
// Сообщения: { t: 'init', T, seed, features } · { t: 'gen', id, cx, cz } → { id, ids, biome, tint, ms }
// · { t: 'mesh', id, reg, tint } → { id, reg (вернули — переиспользовать), light, lights, solid, cutout, water, yMax, ms }.
// Ошибка → { id, err }. Подключён обычным <script> в окне (список файлов игры — для кэша приложения) — ничего не делает.
(() => {
  if (typeof window !== 'undefined' || typeof importScripts !== 'function') return;
  const q = (self.location && self.location.search) || '';
  importScripts('voxel.js' + q, 'voxel-gen.js' + q, 'voxel-mesh.js' + q);
  const V = self.D37E.vox;
  let G = null;
  const now = () => (self.performance ? performance.now() : Date.now());
  self.onmessage = e => {
    const d = e.data || {};
    try {
      if (d.t === 'init') {
        if (d.T) { V.T = d.T; V.compiled = true; }
        G = V.genInit(d.seed, { features: d.features || [] });
        self.postMessage({ t: 'ready' });
        return;
      }
      if (d.t === 'gen') {
        const t0 = now(), r = V.genChunk(G, d.cx, d.cz);
        self.postMessage({ id: d.id, ids: r.ids, biome: r.biome, tint: r.tint, ms: now() - t0 }, [r.ids.buffer, r.biome.buffer, r.tint.buffer]);
        return;
      }
      if (d.t === 'mesh') {
        const t0 = now(), L = V.lightRegion(d.reg, V.T), m = V.meshChunk(d.reg, L, V.T, d.tint);
        const tr = [d.reg.buffer, m.light.buffer];
        for (const k of ['solid', 'cutout', 'water']) if (m[k]) tr.push(m[k].pos.buffer, m[k].vd.buffer, m[k].col.buffer, m[k].lt.buffer);
        if (m.lights) tr.push(m.lights.buffer);
        self.postMessage({ id: d.id, reg: d.reg, light: m.light, lights: m.lights, solid: m.solid, cutout: m.cutout, water: m.water, yMax: m.yMax, ms: now() - t0 }, tr);
        return;
      }
    } catch (err) { self.postMessage({ id: d.id, err: String(err && err.message || err) }); }
  };
})();
