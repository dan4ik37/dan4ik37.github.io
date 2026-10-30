// ═══════════════════════════════════════
//  «КУБОМИР» — свет вокруг игрока: настоящие лампы движка у ближних факелов, лавы и ламп, мерцание, свет факела в руке;
//  туман в пещере (тёмный и ближе — вдаль пещеры не «светлеет небом») и лёгкий цвет тумана по биому
// ═══════════════════════════════════════
// KL = window.KubomirLight.create(st) → onChunk(c, m) / onDrop(c) — светящиеся клетки чанка (m.lights из потока: клетка |
// вид << 15), frame(dt, t) — каждый кадр (мерцание, места ламп, туман), afterSky() — после смены освещения движком (берём
// его туман за основу), dispose(). Лампы — R.lights движка: настоящих на «высокой» 8, на «средней» 4 (самые нужные — сами),
// у всех — ореол-свечение; на «низкой» — без ламп (быстрее), только запечённый свет кубиков.
(() => {
  const V = () => window.D37E.vox;
  window.KubomirLight = { create };
  // вид источника: цвет, сила, дальность (блоков), мерцание. Лампа движка — добавка к «запечённому» свету кубиков: даёт
  // объём рядом с источником (грани к нему — светлее), поэтому слабее и короче самого света блоков
  // факел (T-096a, владелец: «факел с кругом»): лампа — не в середине клетки, а над пламенем и от стены (на стене пламя в 3/16
  // от неё: лампа вплотную давала яркий круг на стене), чуть слабее и шире; ореола движка нет (halo: 0) — светится само пламя
  const KIND = {
    torch: { c: '#ffb36b', i: 1.15, d: 8, fl: 1, halo: 0 },
    lava: { c: '#ff7a2a', i: 1.8, d: 9, fl: .35 },
    lamp: { c: '#ffe4b5', i: 1.5, d: 9, fl: 0 },
    furnace: { c: '#ff9a52', i: 1.0, d: 6, fl: .7 },
    fire: { c: '#ff8a3a', i: 1.6, d: 9, fl: 1.3 },   // огонь (T-022d): пожар мерцает сильнее факела
    other: { c: '', i: 1.3, d: 8, fl: .2 },
  };
  // туман по биому (днём, слегка): болото — зеленоватый, пустыня — жёлтая дымка, снег и горы — белёсый
  const BIOME_FOG = { swamp: [.42, .48, .36], desert: [.86, .78, .6], snow: [.86, .9, .95], mountains: [.72, .77, .84] };
  const CAVE = [.03, .033, .045];

  function create(st){
    const R = st.R, T = R.T, W = st.W;
    const X = { per: new Map(), recs: new Map(), hand: null, scanT: 0, caveK: 0, base: null, n: 0 };
    const on = R.q !== 'low' && !!R.lights;
    const kindOf = t => {
      const b = V().blocks[t]; if (!b) return 'other';
      if (b.name === 'torch') return 'torch';
      if (b.liquid === 'lava') return 'lava';
      if (b.name === 'lamp') return 'lamp';
      if (b.name === 'furnace_lit') return 'furnace';
      if (b.name === 'fire') return 'fire';
      return 'other';
    };
    const colorOf = (t, k) => {
      if (KIND[k].c) return new T.Color(KIND[k].c);
      const E3 = V().T.ecol, m = Math.max(E3[t * 3], E3[t * 3 + 1], E3[t * 3 + 2], 1);
      return new T.Color(E3[t * 3] / m, E3[t * 3 + 1] / m, E3[t * 3 + 2] / m);
    };
    // ── светящиеся клетки чанков (из потока) ──
    X.onChunk = (c, m) => { if (!on) return; if (m.lights && m.lights.length) X.per.set(c.key, { cx: c.cx, cz: c.cz, L: m.lights }); else X.per.delete(c.key); X.scanT = 0; };
    X.onDrop = c => { if (X.per.delete(c.key)) X.scanT = 0; };
    // sky — свет неба у источника (0…1): днём под открытым небом лампа почти не видна (как свет блоков в шейдере)
    const add = (key, x, y, z, k, t, own) => {
      const K = KIND[k], src = { position: new T.Vector3(), color: colorOf(t, k), intensity: K.i, distance: K.d, decay: 2, visible: true, halo: own ? 1 : K.halo ?? 1 };
      const rec = R.lights.add(src);
      const r = { key, x, y, z, k, src, rec, base: K.i, fl: K.fl, seed: (x * 73 + y * 37 + z * 19) % 100 / 10, own, sky: own ? 0 : V().lSky(W.lightAt(x, y + .5, z)) / 15, dx: .5, dz: .5, fx: x + .5, fy: y, fz: z + .5 };
      X.recs.set(key, r);
      return r;
    };
    const drop = r => { R.lights.remove(r.rec); X.recs.delete(r.key); };
    // раз в 0,3 с: до 40 ближних источников (в 28 блоках) → лампы движка (лишние убрать)
    const near = [];
    function scan(){
      const P = st.P;
      near.length = 0;
      for (const e of X.per.values()) {
        const bx = e.cx * 16, bz = e.cz * 16;
        if (Math.abs(bx + 8 - P.x) > 40 || Math.abs(bz + 8 - P.z) > 40) continue;
        for (let k = 0; k < e.L.length; k++) {
          const v = e.L[k], i = v & 32767, t = v >>> 15, x = bx + (i >> 11), z = bz + ((i >> 7) & 15), y = i & 127;
          const dx = x + .5 - P.x, dy = y + .5 - P.y, dz = z + .5 - P.z, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 28 * 28) near.push({ d2, x, y, z, t });
        }
      }
      near.sort((a, b) => a.d2 - b.d2);
      if (near.length > 40) near.length = 40;
      const keep = new Set();
      for (const s of near) {
        const key = s.x + ',' + s.y + ',' + s.z; keep.add(key);
        const r0 = X.recs.get(key);
        if (!r0) {
          const k = kindOf(s.t), r = add(key, s.x, s.y + (k === 'lava' ? .95 : k === 'torch' ? 1 : k === 'fire' ? .35 : .5), s.z, k, s.t, false);
          if (k === 'torch') {   // пламя (fx, fy, fz — ореол kubomir-ents.js) и лампа над ним, на стене — от стены
            const f = (W.raw(s.x, s.y, s.z) >>> 12) & 7, dd = f >= 1 && f <= 4 ? V().FACING[f - 1] : null;
            r.fx = s.x + .5 - (dd ? dd[0] * 5 / 16 : 0); r.fz = s.z + .5 - (dd ? dd[2] * 5 / 16 : 0); r.fy = s.y + (dd ? 3 / 16 : 0) + 11 / 16;
            r.dx = .5 + (dd ? dd[0] * .24 : 0); r.dz = .5 + (dd ? dd[2] * .24 : 0); r.y = s.y + (dd ? 1.05 : .95);
          }
        }
        else r0.sky = V().lSky(W.lightAt(r0.x, r0.y + .5, r0.z)) / 15;   // крышу построили / сломали
      }
      for (const r of [...X.recs.values()]) if (!r.own && !keep.has(r.key)) drop(r);
    }
    // факел (или другой светящийся блок) в руке — лампа у игрока; в левой руке (P.off) — тоже, светит то, что ярче
    const emitOf = s => { const it = s ? V().item(s.id) : null, b = it?.place ? V().block(it.place) : null; return b && V().T.emit[b.id] > 0 ? b : null; };
    function handLight(){
      const P = st.P, bm = emitOf(P.inv[P.sel]), bo = emitOf(P.off), b = bm && bo ? (V().T.emit[bo.id] > V().T.emit[bm.id] ? bo : bm) : bm || bo;
      const want = !P.dead && b ? b.id : 0;
      if (X.hand && X.hand.t !== want) { drop(X.hand); X.hand = null; }
      if (want && !X.hand) { const k = kindOf(want); X.hand = add('hand', P.x, P.y + 1.4, P.z, k, want, true); X.hand.t = want; X.hand.base *= .85; X.hand.src.distance = KIND[k].d + 1; }
      if (X.hand) { X.hand.x = P.x; X.hand.y = P.y + 1.35; X.hand.z = P.z; X.hand.sky = V().lSky(W.lightAt(P.x, P.y + 1.4, P.z)) / 15; }
    }
    // ── туман: основа — туман движка (небо по времени суток), в пещере — к тёмному и ближе, по биому — чуть цвета ──
    X.afterSky = () => {
      const f = R.scene.fog; if (!f || st.uwK > 0) { X.base = null; return; }   // под водой туман ведёт R.setUnder
      const c = f.color.clone();
      // стена бури (песок, пыль, буран, белая мгла; wx-fx): небо движок красит в цвет горизонта — туман того же цвета, без своих
      // оттенков, иначе дальняя земля стоит силуэтом на небе (T-145 проверка D2)
      const K = st.WX?.wfx?.K, vq = K ? +K.vis || 510 : 510;
      const keep = 1 - (K && (K.tintK || 0) > 0 ? Math.min(1, Math.max(1.5 * (K.dust || 0) * K.tintK, K.flat || 0, vq < 400 ? (400 - vq) / 250 : 0)) : 0);   // как gfx.js weatherSky
      // биом (днём; ночью туман и так тёмный)
      try {
        const col = st.G ? V().genColumn(st.G, Math.floor(st.P.x), Math.floor(st.P.z), {}) : null, id = col ? V().BIOME_IDS[col.b] : '', bt = BIOME_FOG[id];
        if (bt) { const k = .22 * (1 - (R.night || 0)) * keep; c.r += (bt[0] * c.r * 1.4 - c.r) * k; c.g += (bt[1] * c.g * 1.4 - c.g) * k; c.b += (bt[2] * c.b * 1.4 - c.b) * k; }
      } catch (e) {}
      // непогода (kubomir-weather.js, W.k 0…1): туман серее, темнее и ближе
      const wk = st.WX?.k || 0, wc = wk * keep;
      if (wc > 0) { const g = (c.r + c.g + c.b) / 3; for (const ch of ['r', 'g', 'b']) c[ch] = (c[ch] + (g * .9 - c[ch]) * .65 * wc) * (1 - .38 * wc); }
      X.base = { c, near: f.near * (1 - .4 * wk), far: f.far * (1 - .25 * wk) };   // дымка в непогоду — мягче (не «мыло»)
      applyFog();
    };
    function applyFog(){
      const f = R.scene.fog, B = X.base; if (!f || !B || st.uwK > 0) return;
      const k = X.caveK;
      f.color.setRGB(B.c.r + (CAVE[0] - B.c.r) * k, B.c.g + (CAVE[1] - B.c.g) * k, B.c.b + (CAVE[2] - B.c.b) * k);
      f.near = B.near + (Math.min(B.near, 8) - B.near) * k;
      f.far = B.far + (Math.min(B.far, 64) - B.far) * k;
      if (R.scene.background?.isColor) R.scene.background.copy(f.color);
    }
    // ── каждый кадр ──
    X.frame = (dt, t) => {
      if (on) {
        if ((X.scanT -= dt) <= 0) { X.scanT = .3; scan(); }
        handLight();
        const day = 1 - Math.max(0, Math.min(1, R.night || 0));
        for (const r of X.recs.values()) {
          r.src.position.set(r.x + (r.own ? 0 : r.dx) - st.ox, r.y, r.z + (r.own ? 0 : r.dz) - st.oz);
          r.src.intensity = r.base * (1 - .75 * day * r.sky) * (r.fl ? 1 + r.fl * (.12 * Math.sin(t * 9.1 + r.seed) + .08 * Math.sin(t * 15.7 + r.seed * 2.3)) : 1);
        }
      }
      // пещера: свет неба у глаз мал — туман тёмный и ближе (плавно)
      const P = st.P, Ls = V().lSky(W.lightAt(P.x, P.y + 1.6, P.z)), want = st.uwK > 0 ? 0 : Ls <= 2 ? 1 : Ls >= 9 ? 0 : (9 - Ls) / 7;
      const k0 = X.caveK;
      X.caveK += (want - X.caveK) * Math.min(1, dt * 1.6);
      if (Math.abs(X.caveK - k0) > .002) applyFog();
    };
    X.stats = () => ({ sources: X.per.size, lamps: X.recs.size, lit: R.lights?.lit || 0, cave: +X.caveK.toFixed(2) });
    X.dispose = () => { for (const r of [...X.recs.values()]) drop(r); X.per.clear(); X.hand = null; };
    return X;
  }
})();
