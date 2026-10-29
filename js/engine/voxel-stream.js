// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — подгрузка мира «Кубомира» вокруг игрока: потоки, очередь заданий, бюджет кадра, выгрузка
// ═══════════════════════════════════════
// S = V.streamer({ world, seed, features, rd, workers, url, load(c) → null | Promise<правки>, onGen(c), onMesh(c, m),
//   onDrop(c), log }) · каждый кадр S.update(px, pz, fx, fz) (позиция и куда смотрит) · S.setRd(n) · S.close().
// Порядок: сгенерировать чанки в радиусе rd + 1 (ближние и спереди — раньше) → свет и сетка, когда все 8 соседей есть →
// результаты применяются не больше бюджета за кадр (сетки — по числу квадратов): ни рывков на границе чанка, ни мусора.
// Правка блока → сетка этого чанка срочно; соседи — если правка у края (AO, грани) или у края поменялся свет (новая
// волна света ушла к соседу) — тогда и соседа заново. Далеко (rd + 3) — чанк выгружается (onDrop: сохранить правки).
// Нет потоков (старый браузер, ошибка) — то же самое прямо в кадре, по чуть-чуть (бюджет по времени).
// o.bare() — сколько лиственной листвы опало (0…1, зима; T-022b): сетка рисует ветви без части листвы; поменялось — все сетки
// понемногу заново (S.bare — с каким числом собраны новые сетки).
// S.extra — другие точки (игра вместе: где гости, [[x, z], …] в блоках): вокруг них чанки только генерируются (без сеток — их не
// видно) в радиусе S.extraR (3) и не выгружаются, пока гость рядом — хозяину есть где считать мобов, вещи и проверять правки.
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const V = E.vox = E.vox || {};
  const now = () => (root.performance ? performance.now() : Date.now());
  // спираль: смещения (dx, dz) по расстоянию — до радиуса 40
  const SPIRAL = (() => { const a = []; for (let dx = -40; dx <= 40; dx++) for (let dz = -40; dz <= 40; dz++) a.push([dx, dz, dx * dx + dz * dz]); a.sort((p, q) => p[2] - q[2] || p[0] - q[0] || p[1] - q[1]); return a; })();
  V.SPIRAL = SPIRAL;

  V.streamer = (o = {}) => {
    const W = o.world, RCN = V.REGION * V.REGION * V.H;
    const S = { bare: 0, rd: Math.max(2, Math.min(32, o.rd | 0 || 8)), dead: false, workers: [], inline: false, stats: { gen: 0, mesh: 0, genMs: 0, meshMs: 0, uploads: 0, dropped: 0, errors: 0, pend: 0 },
      pcx: 1e9, pcz: 1e9, budgetQuads: o.budgetQuads || 14000, budgetMs: o.budgetMs || 4, maxJobs: 0, extra: [], extraR: 3 };
    const jobs = new Map();      // id → задание
    const results = [];          // готовые ответы (применяются по бюджету)
    const regions = [];          // запасные буферы областей
    let seq = 0;
    const T = V.T;
    // ── потоки ──
    const nW = Math.max(1, Math.min(4, o.workers ?? ((root.navigator?.hardwareConcurrency || 4) - 2)));
    if (o.url && typeof Worker !== 'undefined' && o.inline !== true) {
      try {
        for (let i = 0; i < nW; i++) {
          const w = new Worker(o.url);
          w.n = 0;   // заданий в работе
          w.onmessage = e => onResult(e.data, w);
          w.onerror = e => { S.stats.errors++; o.log?.('поток: ' + (e.message || 'ошибка')); try { e.preventDefault(); } catch (er) {} fallback(); };
          w.postMessage({ t: 'init', T, seed: W.seed, features: o.features || [], ver: o.genVer || 1 });
          S.workers.push(w);
        }
      } catch (e) { o.log?.('без потоков: ' + (e.message || e)); S.workers.forEach(w => w.terminate()); S.workers = []; }
    }
    if (!S.workers.length) S.inline = true;
    S.maxJobs = S.inline ? 1 : S.workers.length * 2;
    let G = null;   // генератор для работы в кадре
    function fallback(){
      if (S.inline) return;
      S.workers.forEach(w => w.terminate()); S.workers = []; S.inline = true; S.maxJobs = 1;
      // задания, что были у потоков, — заново
      for (const j of jobs.values()) { j.c[j.t === 'gen' ? 'genJob' : 'meshJob'] = 0; }
      jobs.clear();
    }
    function inlineRun(j){
      if (!G) G = V.genInit(W.seed, { features: o.features || [], ver: o.genVer || 1 });
      const t0 = now();
      if (j.t === 'gen') { const r = V.genChunk(G, j.c.cx, j.c.cz); onResult({ id: j.id, ids: r.ids, biome: r.biome, tint: r.tint, zone: r.zone, ms: now() - t0 }); }
      else { V.applyCuts?.(j.reg, j.cuts); V.shedLeaves?.(j.reg, V.T, j.zone, j.bare, j.c.cx, j.c.cz); const L = V.lightRegion(j.reg, V.T), m = V.meshChunk(j.reg, L, V.T, j.tint, j.zone, j.cuts), r = { id: j.id, reg: j.reg, light: m.light, lights: m.lights, yMax: m.yMax, ms: now() - t0 }; for (const k of V.LAYERS) r[k] = m[k]; onResult(r); }
    }
    function send(j, msg, tr){
      if (S.inline) { j.reg = msg.reg; j.tint = msg.tint; j.zone = msg.zone; j.bare = msg.bare; j.cuts = msg.cuts || null; inlineRun(j); return; }
      let w = S.workers[0];
      for (const x of S.workers) if (x.n < w.n) w = x;
      w.n++; j.w = w;
      w.postMessage(msg, tr || []);
    }
    function onResult(d, w){
      if (w) w.n = Math.max(0, w.n - 1);
      if (d.t === 'ready') return;
      const j = jobs.get(d.id); jobs.delete(d.id);
      if (d.reg && regions.length < 8 && d.reg.length === RCN) regions.push(d.reg);
      if (!j || S.dead) return;
      if (d.err) { S.stats.errors++; o.log?.('задание: ' + d.err); j.c[j.t === 'gen' ? 'genJob' : 'meshJob'] = 0; return; }
      j.d = d; results.push(j);
    }

    // ── состояние чанков ──
    // c.genJob — ждём генерацию; c.ready — есть блоки (и правки применены); c.meshJob — ждём сетку; c.meshRev — правка сетки
    const wantGen = (c) => !c.ready && !c.genJob && !c.loading;
    function ensureChunk(cx, cz){
      let c = W.chunk(cx, cz);
      if (!c) { c = new V.Chunk(cx, cz, null); c.gen = false; c.ready = false; c.genJob = 0; c.meshJob = 0; c.urgent = 0; W.add(c); }
      return c;
    }
    function startGen(c){
      const id = ++seq, j = { id, t: 'gen', c };
      c.genJob = id; jobs.set(id, j);
      send(j, { t: 'gen', id, cx: c.cx, cz: c.cz });
    }
    const neighborsReady = (cx, cz) => { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const n = W.chunk(cx + dx, cz + dz); if (!n || !n.ready) return false; } return true; };
    function startMesh(c){
      const id = ++seq, j = { id, t: 'mesh', c, rev: c.rev };
      c.meshJob = id; c.urgent = 0; jobs.set(id, j);
      const reg = V.buildRegion((x, z) => { const n = W.chunk(x, z); return n && n.ready ? n.ids : null; }, c.cx, c.cz, regions.pop());
      c.bare = S.bare;
      const cuts = o.cuts ? o.cuts(c.cx, c.cz) : null;   // T-138 F1: надрубленные клетки области (нет — null, как было)
      send(j, cuts ? { t: 'mesh', id, reg, tint: c.tint, zone: c.zone, bare: S.bare, cx: c.cx, cz: c.cz, cuts } : { t: 'mesh', id, reg, tint: c.tint, zone: c.zone, bare: S.bare, cx: c.cx, cz: c.cz }, S.inline ? null : [reg.buffer]);
    }

    // ── применить готовое (по бюджету) ──
    function apply(j){
      const c = j.c, d = j.d;
      if (W.chunk(c.cx, c.cz) !== c) return 0;   // успели выгрузить
      if (j.t === 'gen') {
        c.genJob = 0;
        c.ids = d.ids; c.biome = d.biome; c.tint = d.tint; c.zone = d.zone || null; c.gen = true;
        S.stats.gen++; S.stats.genMs += d.ms || 0;
        const fin = saved => {
          if (W.chunk(c.cx, c.cz) !== c) return;
          if (saved) try { o.applySaved?.(c, saved); } catch (e) { o.log?.('сохранение чанка: ' + (e.message || e)); }
          c.calcHmap(); c.ready = true; c.rev = ++W.rev; c.loading = false;
          o.onGen?.(c);
        };
        const p = o.load ? o.load(c) : null;
        if (p && typeof p.then === 'function') { c.loading = true; p.then(fin, () => fin(null)); } else fin(p);
        return 1;
      }
      // сетка
      c.meshJob = 0;
      const old = c.light;
      c.light = d.light; c.lightRev = j.rev; c.meshRev = j.rev; c.yMax = d.yMax;
      S.stats.mesh++; S.stats.meshMs += d.ms || 0;
      // у края поменялся свет — соседу тоже заново (свет перетёк через границу)
      if (old && c.meshedOnce) borderLight(c, old, d.light);
      c.meshedOnce = true;
      try { o.onMesh?.(c, d); } catch (e) { S.stats.errors++; o.log?.('сетка: ' + (e.message || e)); }
      S.stats.uploads++;
      let q = 200; for (const k of V.LAYERS) q += d[k]?.n || 0;
      return q;
    }
    function borderLight(c, a, b){
      const H = V.H;
      const diff = (x0, x1, z0, z1) => { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const i = (x << 11) | (z << 7); for (let y = 0; y < H; y++) if (a[i | y] !== b[i | y]) return true; } return false; };
      if (diff(0, 0, 0, 15)) dirty(c.cx - 1, c.cz, 0);
      if (diff(15, 15, 0, 15)) dirty(c.cx + 1, c.cz, 0);
      if (diff(0, 15, 0, 0)) dirty(c.cx, c.cz - 1, 0);
      if (diff(0, 15, 15, 15)) dirty(c.cx, c.cz + 1, 0);
    }
    function dirty(cx, cz, urgent){ const n = W.chunk(cx, cz); if (n && n.ready) { n.dirty = n.rev = ++W.rev; if (urgent) n.urgent = Math.max(n.urgent || 0, urgent); } }
    // Правка блока (x, y, z): сетку чанка — срочно; у края — и соседей (грани, AO)
    S.touch = (x, z, urgent = 2) => {
      const cx = Math.floor(x) >> 4, cz = Math.floor(z) >> 4, lx = Math.floor(x) & 15, lz = Math.floor(z) & 15;
      dirty(cx, cz, urgent);
      const ex = lx === 0 ? -1 : lx === 15 ? 1 : 0, ez = lz === 0 ? -1 : lz === 15 ? 1 : 0;
      if (ex) dirty(cx + ex, cz, urgent);
      if (ez) dirty(cx, cz + ez, urgent);
      if (ex && ez) dirty(cx + ex, cz + ez, urgent);
    };

    // ── кадр ──
    let dropT = 0, bareT = 0;
    S.update = (px, pz, fx = 0, fz = 0) => {
      if (S.dead) return;
      const t0 = now();
      // зима: опала листва (раз в секунду) — сетки всех чанков понемногу заново (не срочно: ближние раньше, по спирали)
      if (o.bare && t0 - bareT > 1000) { bareT = t0; let b = 0; try { b = +o.bare() || 0; } catch (e) {} if (b !== S.bare) { S.bare = b; for (const c of W.chunks.values()) if (c.ready && c.meshRev >= 0) { c.dirty = c.rev = ++W.rev; } } }
      const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
      S.pcx = pcx; S.pcz = pcz;
      // 1) готовое — по бюджету (сначала генерация: она дешёвая и открывает сетки соседям)
      let quads = 0;
      results.sort((p, q) => (p.t === 'gen' ? 0 : 1) - (q.t === 'gen' ? 0 : 1) || prio(p.c, pcx, pcz, fx, fz) - prio(q.c, pcx, pcz, fx, fz));
      while (results.length && quads < S.budgetQuads && now() - t0 < S.budgetMs) quads += apply(results.shift());
      S.stats.pend = results.length;
      // 2) новые задания: сначала срочные правки, потом сетки и генерация по спирали (спереди — раньше)
      // сетки — в круге R² + R; генерация — в круге (R + 2)²: у каждого чанка с сеткой есть все 8 соседей
      const R = S.rd, RG = R + 2;
      let free = S.maxJobs - jobs.size;
      if (S.inline) free = 1;
      if (free > 0) {
        // срочные: правки игрока
        for (let i = 0; i < SPIRAL.length && free > 0; i++) {
          const s = SPIRAL[i]; if (s[2] > R * R + R) break;
          const c = W.chunk(pcx + s[0], pcz + s[1]);
          if (c && c.urgent && c.ready && !c.meshJob && c.dirty > c.meshRev && neighborsReady(c.cx, c.cz)) { startMesh(c); free--; }
        }
        // спереди и рядом, потом остальное
        for (let pass = 0; pass < 2 && free > 0; pass++) for (let i = 0; i < SPIRAL.length && free > 0; i++) {
          const s = SPIRAL[i]; if (s[2] > RG * RG) break;
          const front = s[2] <= 4 || s[0] * fx + s[1] * fz >= -.35 * Math.sqrt(s[2]);
          if ((pass === 0) !== front) continue;
          const cx = pcx + s[0], cz = pcz + s[1];
          if (Math.abs(cx * 16) > V.LIMIT || Math.abs(cz * 16) > V.LIMIT) continue;
          const c = ensureChunk(cx, cz);
          if (wantGen(c)) { startGen(c); free--; continue; }
          if (s[2] <= R * R + R && c.ready && !c.meshJob && (c.meshRev < 0 || c.dirty > c.meshRev) && !(c.thr && now() < c.thr) && neighborsReady(cx, cz)) { startMesh(c); free--; if (c.dirty > c.meshRev && c.meshedOnce && !c.urgent) c.thr = now() + 120; }
          if (S.inline && now() - t0 > S.budgetMs + 4) break;
        }
        // вокруг гостей — только генерация (свои — раньше: они в кадре)
        const XR = S.extraR * S.extraR;
        for (let e = 0; e < S.extra.length && free > 0; e++) {
          const ex = Math.floor(S.extra[e][0]) >> 4, ez = Math.floor(S.extra[e][1]) >> 4;
          for (let i = 0; i < SPIRAL.length && free > 0; i++) {
            const s = SPIRAL[i]; if (s[2] > XR) break;
            const cx = ex + s[0], cz = ez + s[1];
            if (Math.abs(cx * 16) > V.LIMIT || Math.abs(cz * 16) > V.LIMIT) continue;
            const c = ensureChunk(cx, cz);
            if (wantGen(c)) { startGen(c); free--; }
          }
        }
      }
      // 3) выгрузка далёких — раз в полсекунды
      if (t0 - dropT > 500) {
        dropT = t0;
        const far = R + 3, xf = S.extraR + 2;
        for (const c of [...W.chunks.values()]) {
          if (Math.abs(c.cx - pcx) <= far && Math.abs(c.cz - pcz) <= far) continue;
          if (S.extra.length && S.extra.some(p => Math.abs(c.cx - (Math.floor(p[0]) >> 4)) <= xf && Math.abs(c.cz - (Math.floor(p[1]) >> 4)) <= xf)) continue;
          if (c.genJob || c.meshJob || c.loading) continue;
          try { o.onDrop?.(c); } catch (e) { o.log?.('выгрузка: ' + (e.message || e)); }
          W.remove(c); S.stats.dropped++;
        }
      }
      S.stats.jobs = jobs.size; S.stats.chunks = W.chunks.size;
    };
    // приоритет ответа: ближе и спереди — раньше
    function prio(c, pcx, pcz, fx, fz){ const dx = c.cx - pcx, dz = c.cz - pcz, d = dx * dx + dz * dz; return (c.urgent ? -1e6 : 0) + d - (dx * fx + dz * fz) * Math.sqrt(d) * .5; }
    S.setRd = n => { S.rd = Math.max(2, Math.min(32, n | 0)); };
    // готов ли чанк вокруг точки (для появления игрока)
    S.readyAt = (x, z) => { const c = W.chunkAt(x, z); return !!(c && c.ready && c.meshRev >= 0); };
    S.pending = () => jobs.size + results.length;
    S.close = () => { S.dead = true; S.workers.forEach(w => w.terminate()); S.workers = []; jobs.clear(); results.length = 0; };
    // переинициализация потоков (моды поменялись): таблицы и фичи генерации
    S.reinit = (features) => { o.features = features || []; G = null; for (const w of S.workers) w.postMessage({ t: 'init', T: V.T, seed: W.seed, features: o.features, ver: o.genVer || 1 }); };
    return S;
  };
})();
