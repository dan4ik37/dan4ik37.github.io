// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — поток планеты: сетки кусков (высоты, нормали, цвет, вода) строятся здесь, чтобы кадр не ждал
// ═══════════════════════════════════════
// new Worker('js/engine/planet-worker.js?v=…') — сам подгружает planet.js с тем же ?v=.
// Сообщения: { t: 'init', def } (профиль планеты) → { t: 'ready' } · { t: 'build', id, f, L, i, j, N } → { id, key, centre, pos, nrm,
// col, md, np, colp (перетекание LOD: форма родителя), mscale (масштаб сдвига), err (точность куска, ед.), hmin, hmax, radius, ms }
// (массивы передаются без копии). Ошибка сборки → { id, err: 'текст' } (строка; у собранного err — число).
// Подключён обычным <script> в окне (список файлов игры — для кэша приложения) — ничего не делает.
(() => {
  if (typeof window !== 'undefined' || typeof importScripts !== 'function') return;
  const q = (self.location && self.location.search) || '';
  importScripts('planet.js' + q);
  const PL = self.D37E.planet;
  let P = null;
  const now = () => (self.performance ? performance.now() : Date.now());
  self.onmessage = e => {
    const d = e.data || {};
    try {
      if (d.t === 'init') { P = PL.create(d.def); self.postMessage({ t: 'ready' }); return; }
      if (d.t === 'build') {
        if (!P) throw new Error('планета не готова');
        const t0 = now(), r = P.buildChunk(d.f, d.L, d.i, d.j, d.N || 32);
        r.id = d.id; r.ms = now() - t0;
        self.postMessage(r, [r.pos.buffer, r.nrm.buffer, r.col.buffer, r.centre.buffer, r.md.buffer, r.np.buffer, r.colp.buffer]);
      }
    } catch (err) { self.postMessage({ id: d.id, err: String(err && err.message || err) }); }
  };
})();
