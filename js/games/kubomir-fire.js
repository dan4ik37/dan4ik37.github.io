// ═══════════════════════════════════════
//  «КУБОМИР» — огонь (T-022d, docs/PHYSICS_PLAN.md §4): переходник кубиков к ядру движка D37E.fire + пламя движка (fx.js)
// ═══════════════════════════════════════
// Горят блоки — по их данным (V.burnOf: дерево, доски, листва, трава, дёрн, шерсть; новые блоки модов и деревьев — сами).
// Горящему блоку ставится «огонь» в соседнюю пустую клетку (сверху, иначе сбоку, иначе снизу): он светит (свет блоков, лампы
// kubomir-light.js), жжётся, гаснет водой, поверх него можно поставить блок — и огонь погаснет. Догорел: листва и трава — в воздух,
// дёрн — в землю (то, что из него выпадает), доски сначала чернеют (обугленные доски), потом осыпаются; бревно дерева — дерево
// валится тем же путём, что от топора (ents.fellTree), постройка — обрушение (kubomir-support.js), сундук — вещи выпадают.
// Мир выбирает при создании: «🔥 Огонь распространяется» (meta.fire = 'spread'; старые миры — выкл; «реализм» обрушения — вкл по
// умолчанию), меняется в ⚙️ «🧊 Кубомир». Выкл — горит только подожжённое огнивом (не перекидывается), лава и молния не поджигают.
// Вкл — перекидывается на соседей по ветру (погода движка), дождь гасит под открытым небом, лава поджигает горючее рядом, молния
// в грозу — верхушки деревьев. Считает хозяин мира (или один игрок): правки блоков уходят гостям сами (kubomir-coop.js), гость
// поджигает просьбой хозяину; пламя у всех рисуется по блокам «огонь» (у гостя — по правкам хозяина). Такт — 20 в секунду (с
// мобами), бюджет обхода — постоянный (одинаково на телефоне и ПК).
//   X = KubomirFire.attach(st) → { F (ядро; у гостя — null), spread, tick(), frame(dt, t), useIgniter(s, it, which, hit),
//   igniteAt(x, y, z, nx, ny, nz, by), onEdit(x, y, z, was, v, o), onChunk(c), onMesh(c, m), onDrop(c), touching(P), save(),
//   setSpread(on), stats, dispose() }
(() => {
  const VX = () => window.D37E.vox, FIR = () => window.D37E.fire;
  const KF = window.KubomirFire = window.KubomirFire || {};
  KF.NOTE = 'Огонь перекидывается на соседние деревья, траву и деревянные постройки (по ветру — быстрее), дождь его гасит, лава и молния поджигают. Выкл — горит только то, что поджёг огнивом.';
  // по умолчанию при создании мира: «реализм» обрушения — вкл
  KF.defaultFor = support => support === 'real';
  KF.on = meta => meta?.fire === 'spread';

  // ── материал огня по блоку (по данным: V.burnOf) — таблица на все виды блоков; пересобирается, когда блоков стало больше ──
  let FM = null, fmN = -1;
  function tables(){
    const V = VX(), F = FIR();
    if (FM && fmN === V.blocks.length) return FM;
    fmN = V.blocks.length; FM = new Uint8Array(fmN);
    for (const b of V.blocks) FM[b.id] = F.mat(V.burnOf ? V.burnOf(b) : '');
    return FM;
  }
  KF.matOf = id => (tables()[id] | 0);

  KF.attach = st => {
    const V = VX(), FI = FIR(); if (!V || !FI || !V.ID.fire) return null;
    tables();
    const W = st.W, guest = !!st.coopGuest, FIRE = V.ID.fire, CHAR = V.ID.charred_planks, MF = FI.MAT;
    const X = { stats: { blocks: 0, lava: 0, bolts: 0, burnt: 0, fell: 0, collapsed: 0, coal: 0 }, spread: KF.on(st.meta), F: null };
    // ── чтение клетки для ядра: −1 — не загружено, 0 — не горит / пусто, иначе материал (блок огня — «пламя») ──
    let lc = null, lcx = 1e9, lcz = 1e9;
    const H = V.H;
    const raw = (x, y, z) => {
      if (y < 0 || y >= H) return 0;
      const cx = x >> 4, cz = z >> 4;
      if (cx !== lcx || cz !== lcz) { lc = W.chunk(cx, cz); lcx = cx; lcz = cz; }
      const c = lc; if (!c || !c.gen || !c.ids) return W.raw ? W.raw(x, y, z) : -1;
      return c.ids[((x & 15) << 11) | ((z & 15) << 7) | y];
    };
    const fresh = () => { lc = null; lcx = lcz = 1e9; };
    const read = (x, y, z) => {
      const v = raw(x, y, z); if (v < 0) return -1; if (!v) return 0;
      const t = v & 0xfff;
      return t === FIRE ? MF.flame : FM[t] | 0;
    };
    // под открытым небом (дождь): свет неба над клеткой почти полный
    const open = (x, y, z) => V.lSky(W.lightAt(x, y + 1, z)) >= 13;
    // ── «огонь» рядом с горящим: сверху, иначе сбоку (с места по хешу — не всегда одна сторона), иначе снизу; aux — куда (1…6) ──
    const DIRS = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
    let busy = false;   // свои правки (onEdit их не считает «залили / закрыли огонь»)
    const set = (x, y, z, v) => { busy = true; try { return W.set(x, y, z, v, { urgent: 0 }); } finally { busy = false; } };
    // pref — какая грань сначала (1…6: огниво — та, по которой ударил)
    function placeFlame(x, y, z, pref){
      for (let k = pref >= 1 && pref <= 6 ? -1 : 0; k < 6; k++) {
        const j = k < 0 ? pref - 1 : k === 0 || k === 5 ? k : 1 + ((k - 1 + (FI.hash(x, y, z, 0x9f, 0) & 3)) & 3), d = DIRS[j];
        const fx = x + d[0], fy = y + d[1], fz = z + d[2];
        if (fy < 1 || fy >= H - 1) continue;
        if (raw(fx, fy, fz) !== 0) continue;
        if (set(fx, fy, fz, FIRE)) return j + 1;
      }
      return 0;
    }
    function dropFlame(x, y, z, aux){
      if (aux === 7) { if ((raw(x, y, z) & 0xfff) === FIRE) set(x, y, z, 0); return; }
      if (!(aux >= 1 && aux <= 6)) return;
      const d = DIRS[aux - 1], fx = x + d[0], fy = y + d[1], fz = z + d[2];
      if ((raw(fx, fy, fz) & 0xfff) === FIRE) set(fx, fy, fz, 0);
    }
    const coalChance = m => m === MF.wood ? .15 : m === MF.planks ? .08 : 0;
    // догорел: блок — в то, что из него остаётся; дерево валится (путь топора), постройка рушится (путь обрушения)
    function burnt(x, y, z, m, aux){
      fresh();
      dropFlame(x, y, z, aux);
      if (m === MF.flame) return;
      const v = raw(x, y, z); if (!(v > 0)) return;
      const t = v & 0xfff, b = V.blocks[t]; if (!b) return;
      const sc = st.sup ? st.sup.code(x, y, z) : 0;
      // дверь — обе половины; сундук и печь — вещи выпадают (в «Творчестве» — нет)
      if (b.shape === V.SHAPE.door) { const oy = (v >>> 12) & 8 ? -1 : 1, o = raw(x, y + oy, z); if (o > 0 && (o & 0xfff) === t) set(x, y + oy, z, 0); }
      const to = m === MF.turf && b.drop && V.block(b.drop) ? V.cell(V.block(b.drop).id, 0) : 0;   // дёрн — в землю (что из него выпадает)
      set(x, y, z, to);
      X.stats.burnt++;
      if (!st.creative) {
        const tile = W.dropTile ? W.dropTile(x, y, z) : null;
        if (tile) for (const q of [...(tile.items || []), tile.in, tile.fuel, tile.out]) if (q && q.n > 0) st.ents?.addItem(x + .5, y + .5, z + .5, q);
        const cc = coalChance(m);
        if (cc && (FI.hash(x, y, z, 0xc0a1, X.F.T) & 1023) < cc * 1024) { st.ents?.addItem(x + .5, y + .4, z + .5, { id: 'coal', n: 1 }); X.stats.coal++; }
      }
      // пепел: серая пыль и осколки цветом блока
      st.ents?.smoke?.(x + .5, y + .6, z + .5, 3, .8, ASH, .55);
      if (FI.hash(x, y, z, 0xd1, 0) & 1) st.ents?.debris?.(x, y, z, t, 5);
      // ствол настоящего дерева — валится, как от топора (та же проверка: брёвна + листва без опоры)
      if (m === MF.wood && b.axis && st.fellOn?.() !== false && st.ents?.fellTree) { if (st.ents.fellTree(x, y, z, null)) X.stats.fell++; }
      if (sc && st.sup) { if (st.sup.removed(x, y, z, sc)) X.stats.collapsed++; }
    }
    const ASH = [.42, .4, .38];
    // ── ядро (у хозяина и одного игрока) ──
    if (!guest) {
      const F = X.F = FI.grid({ dims: 3, down: -1, hz: 20, cap: 4096, budget: 180, seed: V.seedOf(st.meta.seed) ^ 0x5eed, read, open,
        spread: X.spread,
        onIgnite: (x, y, z, m, s) => {
          fresh();
          if (m === MF.flame) { if (raw(x, y, z) === 0) set(x, y, z, FIRE); F.AUX[s] = 7; return; }   // огонь без топлива — сам себе клетка
          F.AUX[s] = placeFlame(x, y, z, F.AUX[s]);   // AUX до этого — грань по просьбе (огниво)
        },
        onBurnt: burnt,
        onOut: (x, y, z, m, aux) => { fresh(); dropFlame(x, y, z, aux); },
        // доски почернели (горят дальше уже обугленными); брёвна дерева — нет (дерево должно остаться деревом, чтобы упасть)
        onChar: (x, y, z, m) => {
          if (m !== MF.planks || !CHAR) return;
          fresh(); const v = raw(x, y, z); if (!(v > 0)) return;
          const b = V.blocks[v & 0xfff]; if (!b || b.shape !== V.SHAPE.cube || b.ui) return;
          set(x, y, z, V.cell(CHAR, v >>> 12));
        },
      });
      if (st.meta.fireState) { try { F.load(st.meta.fireState); } catch (e) { console.warn('огонь: не загрузился', e); } }
    }
    X.setSpread = on => { X.spread = !!on; st.meta.fire = on ? 'spread' : 'off'; if (X.F) X.F.spread = X.spread; };
    X.save = () => (X.F ? X.F.save() : null);

    // ── поджечь клетку (огниво, просьба гостя, молния): горючее — само; негорючее — огонь на грани (nx, ny, nz) ──
    X.igniteAt = (x, y, z, nx = 0, ny = 1, nz = 0, force) => {
      const F = X.F; if (!F) return false;
      fresh();
      const v = raw(x, y, z), m = v > 0 ? FM[v & 0xfff] : 0;
      if (m && m !== MF.flame) { IO.aux = faceDir(nx, ny, nz); IO.force = !!force; return F.ignite(x, y, z, 0, IO) >= 0; }
      const fx = x + nx, fy = y + ny, fz = z + nz;
      if (fy < 1 || fy >= H - 1 || raw(fx, fy, fz) !== 0) return false;
      // на горючее сбоку/сверху — пусть горит оно; на камне — пламя без топлива (несколько секунд)
      return F.ignite(fx, fy, fz, MF.flame) >= 0;
    };
    const FORCE = { force: true }, IO = { aux: 0, force: false };
    const faceDir = (nx, ny, nz) => ny > 0 ? 1 : nx > 0 ? 2 : nx < 0 ? 3 : nz > 0 ? 4 : nz < 0 ? 5 : ny < 0 ? 6 : 0;   // номер в DIRS + 1
    // ── огниво (ПКМ): своё — поджечь; гость — просьба хозяину (звук и искры — сразу) ──
    X.useIgniter = (s, it, which, hit) => {
      if (!hit || it.use !== 'ignite') return false;
      const now = performance.now(); if (now - (X.useT || 0) < 250) return true;
      X.useT = now;
      const px = hit.x + .5 + hit.nx * .5, py = hit.y + .5 + hit.ny * .5, pz = hit.z + .5 + hit.nz * .5;
      st.AU?.play('flint_strike', { x: px - st.ox, y: py, z: pz - st.oz, vol: .7, rate: .92 + Math.random() * .16 });
      st.ents?.glow?.('spark', px, py, pz, 6);
      let ok = false;
      if (st.coopGuest) { st.net?.reqFire?.(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz); ok = true; }
      else ok = X.igniteAt(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz);
      if (ok && !st.creative) {   // износ: огниво — 64 раза
        s.d = (s.d | 0) + 1;
        if (s.d >= (it.dur || 64)) { if (which === 'off') st.P.off = null; else { const i = st.P.inv.indexOf(s); if (i >= 0) st.P.inv[i] = null; } st.AU?.play('break', { vol: .5 }); st.H?.toast('🔨 ' + it.title + ' сломалось'); }
      }
      if (ok) st.AU?.play('fire_ignite', { x: px - st.ox, y: py, z: pz - st.oz, vol: .5 });
      return true;
    };

    // ── где стоят блоки «огонь» (у всех — по правкам мира): для пламени, звука, ожога ──
    const FS = X.blocks = FI.cellSet(8192, 3);
    X.onEdit = (x, y, z, was, v) => {
      const wt = was & 0xfff, vt = v & 0xfff;
      if (vt === FIRE) FS.add(x, y, z);
      else if (wt === FIRE && was > 0) {
        FS.del(x, y, z);
        // огонь убрали не мы (поставили блок поверх, залили, сломали) — горящее рядом гаснет
        if (!busy && X.F) X.F.douse(x, y, z, 1);
      }
      // вода пришла — гасит вокруг
      if (!busy && X.F && v > 0 && V.T.liquid[vt] === 1) X.F.douse(x, y, z, 1);
    };
    // чанк загрузился: блоки «огонь» из правок (сохранённый пожар); у хозяина — «сироты» (огонь без горящего рядом: ядро не
    // сохранилось) — горят пламенем без топлива несколько секунд и гаснут
    X.onChunk = c => {
      if (!c?.edits) return;
      for (const [i, v] of c.edits) {
        if ((v & 0xfff) !== FIRE) continue;
        const x = c.cx * 16 + (i >> 11), z = c.cz * 16 + ((i >> 7) & 15), y = i & 127;
        FS.add(x, y, z);
        if (X.F && !owned(x, y, z)) X.F.ignite(x, y, z, MF.flame);
      }
    };
    function owned(x, y, z){
      const F = X.F; if (F.find(x, y, z) >= 0) return true;
      for (let j = 0; j < 6; j++) { const d = DIRS[j], s = F.find(x - d[0], y - d[1], z - d[2]); if (s >= 0 && F.AUX[s] === j + 1) return true; }
      return false;
    }
    X.onDrop = c => {
      if (!c?.edits) return;
      for (const [i, v] of c.edits) if ((v & 0xfff) === FIRE) FS.del(c.cx * 16 + (i >> 11), i & 127, c.cz * 16 + ((i >> 7) & 15));
      LAVA.delete(c.key);
    };
    // лава в чанке (светящиеся клетки потока: одна на поверхность 4×4) — для «лава поджигает»
    const LAVA = new Map();
    X.onMesh = (c, m) => {
      const L = m?.lights; if (!L || !L.length) { LAVA.delete(c.key); return; }
      let a = null;
      for (let k = 0; k < L.length; k++) { const t = L[k] >>> 15; if (V.T.liquid[t] === 2) (a || (a = [])).push(L[k] & 32767); }
      if (a) LAVA.set(c.key, { cx: c.cx, cz: c.cz, a: Int32Array.from(a) }); else LAVA.delete(c.key);
    };
    // ожог: стоит в огне (для причины нокаута)
    X.touching = P => {
      if (!FS.n) return false;
      const x0 = Math.floor(P.x - .3), x1 = Math.floor(P.x + .3), z0 = Math.floor(P.z - .3), z1 = Math.floor(P.z + .3), y0 = Math.floor(P.y), y1 = Math.floor(P.y + 1.7);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) if (FS.has(x, y, z)) return true;
      return false;
    };

    // ═══ Такт (20 в секунду, вместе с мобами): ветер и дождь, лава, молния, ядро ═══
    let wxT = 0, lavaT = 0;
    X.tick = () => {
      const F = X.F; if (!F) return;
      if (--wxT <= 0) {   // погода — раз в 2 с (округлённо: у всех одно и то же)
        wxT = 40;
        const WX = st.WX, s = WX?.clim?.state, off = st.weatherOff;
        F.setWind(off ? 2 : s ? s.wind : 3, s ? s.windDir : 0);
        F.setRain(off ? 0 : WX ? WX.rain || 0 : 0);
        const tz = WX?.tz, temp = s ? s.temp : 18, wet = tz ? tz.wet || 0 : 0;
        F.setDry(Math.max(.5, Math.min(1.4, 1 + (temp - 15) / 45 - .5 * wet)));
      }
      if (X.spread) {
        if (--lavaT <= 0) { lavaT = 10; lavaTick(F); }   // лава — 2 раза в секунду
        if (!st.weatherOff && (st.WX?.rain || 0) > .75) boltTick(F);
      }
      F.tick();
    };
    // лава поджигает: 4 случайные клетки лавы рядом с игроком (до 32 блоков) — над ней и вокруг (до 2 выше) горючее загорается
    function lavaTick(F){
      if (!LAVA.size) return;
      const P = st.P, pcx = Math.floor(P.x) >> 4, pcz = Math.floor(P.z) >> 4;
      let k = 0;
      for (const e of LAVA.values()) {
        if (Math.abs(e.cx - pcx) > 2 || Math.abs(e.cz - pcz) > 2) continue;
        const h = FI.hash(e.cx, e.cz, F.T, 0x1a7a, 0), i = e.a[h % e.a.length];
        const x = e.cx * 16 + (i >> 11), z = e.cz * 16 + ((i >> 7) & 15), y = i & 127;
        for (let q = 0; q < 6; q++) {
          const dx = q === 1 ? 1 : q === 2 ? -1 : 0, dz = q === 3 ? 1 : q === 4 ? -1 : 0, dy = q === 0 ? 1 : q === 5 ? 2 : (h >> (q + 3)) & 1;
          const m = read(x + dx, y + dy, z + dz);
          if (m > 0 && m !== MF.flame && (h >> (q * 3)) % 8 < 3 && F.ignite(x + dx, y + dy, z + dz) >= 0) { X.stats.lava++; break; }
        }
        if (++k >= 4) break;
      }
    }
    // молния в грозу: в среднем раз в 40 с, в 8…40 блоках от игрока; самое высокое горючее (листва, дерево, трава) — загорается
    function boltTick(F){
      if (FI.hash(F.seed, F.T, 0xb017, 0, 0) % 800 !== 0) return;
      const P = st.P, h = FI.hash(F.seed, F.T, 0xb018, 0, 0), a = (h & 1023) / 1023 * 6.283, d = 8 + ((h >> 10) & 31);
      const x = Math.floor(P.x + Math.cos(a) * d), z = Math.floor(P.z + Math.sin(a) * d);
      fresh();
      let y = H - 2; while (y > 1 && raw(x, y, z) === 0) y--;
      if (raw(x, y, z) < 0) return;
      X.stats.bolts++;
      st.flash?.(.22);
      st.AU?.play('kb_thunder', { vol: .75, rate: 1.1 });
      st.ents?.glow?.('spark', x + .5, y + 1, z + .5, 14);
      const m = read(x, y, z);
      if (m > 0 && m !== MF.flame) F.ignite(x, y, z, 0, FORCE);
      else X.igniteAt(x, y, z, 0, 1, 0, true);
    }

    // ═══ Кадр: пламя на блоках «огонь» рядом с камерой, дым и угли, звук ═══
    const FX = st.FX || (st.FX = window.D37E.fx ? window.D37E.fx(st.R) : null);
    const night = () => Math.max(0, Math.min(1, st.R.night || 0));
    const LIT = new Float32Array(3);
    const lit = (x, y, z) => { const L = W.lightAt(x + st.ox, y, z + st.oz), sky = V.lSky(L) / 15 * (1 - .8 * night()), blk = V.lBlk(L) / 15; const k = Math.max(.14, sky, blk * .9); LIT[0] = k; LIT[1] = k * .97; LIT[2] = k * .95; return LIT; };
    const FL = X.FL = FX?.flames ? FX.flames({ lights: 0, lit }) : null;   // свет — у блоков «огонь» (свет кубиков, лампы kubomir-light.js)
    let snd = null, sndBig = null;
    X.frame = (dt, t) => {
      if (!FL) return;
      const cam = st.R.camera.position, cx = cam.x + st.ox, cy = cam.y, cz = cam.z + st.oz, F = X.F, Q = FL.Q;
      FL.begin(cam);
      let near = 1e9, nx = 0, ny = 0, nz = 0, cnt = 0;
      const R2 = 56 * 56;
      for (let pass = 0; pass < 2; pass++) {   // сначала ближние (до 24 блоков), потом дальние — пока есть место
        for (let i = 0; i < FS.n; i++) {
          const x = FS.X[i], y = FS.Y[i], z = FS.Z[i], dx = x + .5 - cx, dy = y + .5 - cy, dz = z + .5 - cz, d2 = dx * dx + dy * dy + dz * dz;
          if (pass === 0 ? d2 > 576 : d2 <= 576 || d2 > R2) continue;
          const o = FL.push(); if (o < 0) { pass = 2; break; }
          let heat = .92, ox = 0, oz = 0;
          if (F) {   // хозяин знает, кто горит: разгорается / догорает; у огня сбоку — язык прижат к горящему
            const s = ownerOf(x, y, z);
            if (s >= 0) {
              const L = F.LIFE[s] || 1, ph = F.AGE[s] / L; heat = ph < .1 ? .3 + 7 * ph : ph > .85 ? Math.max(.35, 1 - (ph - .85) / .15 * .65) : 1;
              const a = F.AUX[s]; if (a >= 2 && a <= 5) { const dd = DIRS[a - 1]; ox = -dd[0] * .28; oz = -dd[2] * .28; }
            }
          }
          const seed = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0;
          Q[o] = x + .5 + ox - st.ox; Q[o + 1] = y; Q[o + 2] = z + .5 + oz - st.oz; Q[o + 3] = 1; Q[o + 4] = heat; Q[o + 5] = (seed % 1000) / 1000; Q[o + 6] = .8; Q[o + 7] = 1;
          cnt++;
          if (d2 < near) { near = d2; nx = x + .5; ny = y + .4; nz = z + .5; }
        }
      }
      const s = st.WX?.clim?.state;
      FL.windIn[0] = s ? Math.cos(s.windDir) * s.wind : 0; FL.windIn[1] = s ? Math.sin(s.windDir) * s.wind : 0;
      FL.dt = dt; FL.t = t;
      FL.end();
      FX.update(dt);
      X.stats.blocks = FS.n; X.stats.drawn = cnt;
      // треск — у ближайшего огня (до 24 блоков); большой пожар — ещё и гул
      const A = st.AU;
      if (A?.loop) {
        const on = near < 576;
        if (on && !snd) snd = A.loop('amb_fire', { vol: 0 });
        if (snd) { if (!on) { snd.stop(); snd = null; } else snd.set({ x: nx - st.ox, y: ny, z: nz - st.oz, vol: .55 * (1 - Math.sqrt(near) / 24) + .1 }); }
        const big = cnt >= 24 && near < 900;
        if (big && !sndBig) sndBig = A.loop('fire_roar', { vol: 0 });
        if (sndBig) { if (!big) { sndBig.stop(); sndBig = null; } else sndBig.set({ x: nx - st.ox, y: ny, z: nz - st.oz, vol: Math.min(.6, cnt / 120) }); }
      }
    };
    function ownerOf(x, y, z){
      const F = X.F; let s = F.find(x, y, z); if (s >= 0) return s;
      for (let j = 0; j < 6; j++) { const d = DIRS[j]; s = F.find(x - d[0], y - d[1], z - d[2]); if (s >= 0 && F.AUX[s] === j + 1) return s; }
      return -1;
    }
    X.dispose = () => { snd?.stop(); sndBig?.stop(); snd = sndBig = null; FL?.dispose(); FS.clear(); LAVA.clear(); };
    return X;
  };
})();
