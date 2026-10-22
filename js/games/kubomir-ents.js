// ═══════════════════════════════════════
//  «КУБОМИР» — живое в мире: выпавшие вещи, крошки, падающий песок, мобы (днём — звери, ночью — зомби и слизни),
//  течение воды и лавы, рост ростков и травы, печи; «оживление» — осколки, клубы дыма и пыли, искры, анимации мобов
// ═══════════════════════════════════════
// window.KubomirEnts.create(S) → X: tick(dt) — 20 раз в секунду (ИИ мобов, вода, печи, вещи, падающий песок), frame(dt, t) —
// рисование; X.frac (0…1, ставит игра) — доля до следующего такта: мобы, вещи и песок рисуются плавно между тактами.
// addItem(x, y, z, вещь, разбросать, скорость), debris(x, y, z, блок) — точки, rayMob(…), damage(моб, урон, nx, nz), spawn(вид, x, y, z),
// onBlockChanged(x, y, z, было, стало) — соседей «будим» (вода течёт, песок падает), blocked(x, y, z) — моб в клетке,
// crumbs(x, y, z, вещь) — крошки еды, save()/load() — звери мира, dispose(). Свет мобов, вещей и человечков — плавный, как у
// кубиков (KubomirEnts.Lit); как рисуется моб — одно место (view, boxMobView). ИИ дешёвый и предсказуемый: у каждого моба свой генератор от номера, шаг 1/20 с,
// дальше 64 блоков — не думают. Вода: источник (0) и течение 1…7, падающая (8); лава течёт на 3 и медленнее;
// вода + лава → обсидиан (источник лавы) или булыжник.
// Эффекты (координаты — мир): breakFx / hitFx / placeFx (сломал, бьёт, поставил блок), shards (осколки-кубики кувыркаются и
// прыгают), dust (пыль цвета блока; ring — кольцом), smoke, bubbles, splash, wake, glow ('ember' | 'spark' | 'flame' | 'firefly');
// у факелов — дымок и ореол, у лавы — угольки, ночью — светлячки, у листвы — падающие листья (только рядом с игроком).
// Пулы постоянные (без мусора за кадр), на «низкой» графике частиц втрое меньше, на телефоне — 60 % (X.fxQ); случайность
// украшений — своя (FR), игре она не мешает. X.room(вещь) (ставит игра) — есть ли место: только тогда вещь тянется к игроку.
(() => {
  const V = () => window.D37E.vox;
  const CBK = () => window.D37E.combat;   // ядро боя (js/engine/combat.js); нет — мобы без стойкости и оглушения
  const now = () => performance.now();
  const MOBS = {
    cow: { title: 'Корова', hp: 10, w: .9, h: 1.3, speed: 1.3, passive: true, drops: [['meat_raw', 1, 3]], snd: 'kb_moo', body: '#5a3a26', spot: '#f2efe9', legs: '#3a2618', head: '#5a3a26' },
    pig: { title: 'Свинья', hp: 10, w: .9, h: 1, speed: 1.4, passive: true, drops: [['meat_raw', 1, 2]], snd: 'kb_oink', body: '#f0a3a8', spot: '#e48b93', legs: '#e48b93', head: '#f0a3a8' },
    chicken: { title: 'Курица', hp: 4, w: .45, h: .8, speed: 1.2, passive: true, drops: [['chicken_raw', 1, 1], ['feather', 0, 2]], snd: 'kb_cluck', body: '#f6f6f2', spot: '#e33', legs: '#f2b630', head: '#f6f6f2' },
    zombie: { title: 'Зомби', hp: 20, w: .6, h: 1.85, speed: 2.4, passive: false, dmg: 3, wind: .4, drops: [], snd: 'kb_groan', body: '#3b6fa8', spot: '#2c4e7a', legs: '#2c3f6b', head: '#5f9e5a', burns: true, cb: { poise: 1, invT: .45, stagT: .5, kbRes: .15 } },
    slime: { title: 'Слизень', hp: 8, w: .8, h: .8, speed: 3, passive: false, dmg: 2, wind: .3, drops: [['slime_ball', 1, 2]], snd: 'kb_squish', body: '#6fcf5a', spot: '#4caa40', legs: '#4caa40', head: '#6fcf5a', hop: true, cb: { poise: .6, invT: .35, stagT: .4, kbRes: 0 } },
  };
  // бой (docs/COMBAT.md, D37E.combat): у каждого моба — стойкость (сколько «силы ударов» держит до оглушения), неуязвимость после
  // удара, оглушение, стойкость к отбросу; звери — по умолчанию (ниже)
  const CB_DEF = { poise: .5, invT: .45, stagT: .35, kbRes: 0 };

  // ═══ Свет существ — как у кубиков, плавно ═══
  // Lit.sample(W, x, y, z, out) → out = [небо, R, G, B] — уровни 0…15 дробные: 8 клеток вокруг точки (веса — по расстоянию до
  // их середин), клетки внутри непрозрачных блоков не считаются (у стены не темнеет, в узком проходе — тоже). Lit.make(T) →
  // состояние { lv, tg, u } (u — униформа для VR.entityMaterial); Lit.update(E, st, x, y, z, dt, add) — свет в точке (мировые
  // координаты), по времени догоняет за ~0,1 с (dt = 0 — сразу); add — [R, G, B] уровни своего света (факел в руке).
  // Lit.vec(уровни, v, мерцание) — та же кривая, что у вершин кубиков (VS_BEGIN в voxel-render.js) → v.x небо, v.yzw — R, G, B.
  const Lit = {
    sample(W, x, y, z, out){
      const V = window.D37E.vox, op = V.T.opaque;
      const fx = x - .5, fy = y - .5, fz = z - .5, x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz), tx = fx - x0, ty = fy - y0, tz = fz - z0;
      let ws = 0, s = 0, r = 0, g = 0, b = 0;
      for (let i = 0; i < 8; i++) {
        const dx = i & 1, dy = (i >> 1) & 1, dz = i >> 2, w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
        if (w <= 1e-6) continue;
        const cx = x0 + dx, cy = y0 + dy, cz = z0 + dz, v = W.raw(cx, cy, cz);
        if (v > 0 && op[v & 0xfff]) continue;
        const L = W.lightAt(cx, cy, cz);
        ws += w; s += w * ((L >>> 12) & 15); r += w * ((L >>> 8) & 15); g += w * ((L >>> 4) & 15); b += w * (L & 15);
      }
      if (ws < 1e-4) { const L = W.lightAt(x, y, z); out[0] = (L >>> 12) & 15; out[1] = (L >>> 8) & 15; out[2] = (L >>> 4) & 15; out[3] = L & 15; return out; }
      out[0] = s / ws; out[1] = r / ws; out[2] = g / ws; out[3] = b / ws;
      return out;
    },
    vec(lv, v, fl = 1){
      const l = Math.max(0, Math.min(1, lv[0] / 15)), s = l / (4 - 3 * l), m = Math.max(0, Math.min(1, Math.max(lv[1], lv[2], lv[3]) / 15)), k = 4 - 3 * m, q = m / (k * k) * fl / 15;
      v.x = s * Math.sqrt(s); v.y = lv[1] * q; v.z = lv[2] * q; v.w = lv[3] * q;
      return v;
    },
    make(T){ return { lv: new Float32Array(4), tg: new Float32Array(4), init: false, u: { value: T ? new T.Vector4(1, 0, 0, 0) : { x: 1, y: 0, z: 0, w: 0 } } }; },
    // мерцание факелов — как у кубиков (по месту в сцене и времени шейдера)
    flick(U, rx, y, rz){ if (!U) return 1; const h = rx * 1.31 + rz * 1.73 + y * .71, t = U.uTime.value; return 1 + U.uFlick.value * (.07 * Math.sin(t * 8.7 + h) + .045 * Math.sin(t * 15.3 + h * 2.1)); },
    update(E, st, x, y, z, dt, add){
      Lit.sample(st.W, x, y, z, E.tg);
      if (add) for (let c = 0; c < 3; c++) if (add[c] > E.tg[c + 1]) E.tg[c + 1] = add[c];
      if (!E.init || !(dt > 0)) { E.lv.set(E.tg); E.init = true; }
      else { const k = 1 - Math.exp(-dt * 12); for (let i = 0; i < 4; i++) E.lv[i] += (E.tg[i] - E.lv[i]) * k; }
      Lit.vec(E.lv, E.u.value, Lit.flick(st.VR?.U, x - (st.ox || 0), y, z - (st.oz || 0)));
      return E;
    },
    // свой свет вещи в руке (факел, лава в ведре, светящийся блок мода): уровни R, G, B на шаг от источника; null — нет
    held(id, out){
      const V = window.D37E.vox, it = id ? V.item(id) : null, b = it?.place ? V.block(it.place) : null, e = b ? V.T.emit[b.id] : 0;
      if (!e) return null;
      for (let c = 0; c < 3; c++) out[c] = Math.max(0, V.T.ecol[b.id * 3 + c] / 17 - 1);
      return out;
    },
  };
  // Сложность: враги рядом не больше cap, попытка появиться — раз в every с (только в темноте, свет ≤ 6), урон × dmg
  // (зомби: «легко» 2, «обычно» 3, «сложно» 4,5 — как в Майнкрафте). Шаг логики — 20 раз в секунду от часов игры, не от частоты кадров.
  // Удар врага — с замахом (MOBS.wind с: зомби поднимает руки, слизень сжимается) и выпадом; отошёл за время замаха — промах,
  // ударили его — замах сбит. После удара — пауза 0,6 с: замах + пауза = 1 с, как раньше (урон в минуту тот же).
  const DIFF = { peaceful: { cap: 0, every: 2, dmg: 0 }, easy: { cap: 4, every: 4, dmg: .67 }, normal: { cap: 6, every: 3, dmg: 1 }, hard: { cap: 9, every: 2, dmg: 1.5 } };
  window.KubomirEnts = { MOBS, DIFF, create, onChunk(){}, onDrop(){}, lightTint: (L, min) => lightTint(L, min).slice(), Lit, mobView: null, boxMobView: c => boxMobView(c) };
  // цвет освещения существа по свету клетки: небо — белым, факелы и лава — своим цветом (как у кубиков) → [r, g, b, яркость]
  // (запасной путь, если свой кусок шейдера не собрался)
  const LTC = [1, 1, 1, 1];
  function lightTint(L, min = .06){
    // кривая — как у кубиков (voxel-render.js): по самому яркому каналу, в квадрате — оттенок света не меняется
    const s = (L >>> 12) & 15, sk = (s / 15) ** 2, r0 = (L >>> 8) & 15, g0 = (L >>> 4) & 15, b0 = L & 15, m = Math.max(r0, g0, b0) / 15, k = 1.5 / 15 * m / ((4 - 3 * m) ** 2);
    const r = r0 * k, g = g0 * k, b = b0 * k;
    LTC[0] = Math.min(1.4, Math.max(sk, r, min)); LTC[1] = Math.min(1.4, Math.max(sk, g, min)); LTC[2] = Math.min(1.4, Math.max(sk, b, min));
    LTC[3] = Math.max(LTC[0], LTC[1], LTC[2]);
    return LTC;
  }

  function create(S){
    const T = S.R.T, R = S.R, VR = S.VR, W = S.W;
    const X = { items: [], falling: [], mobs: [], dying: [], seq: 0, upd: new Map(), updQ: [], tickN: 0, furnaces: new Set(), spawnT: 0, frac: 1, rng: V().rng((V().hash(S.W.seed, 999) >>> 0) || 1) };
    const BOX = { x: 0, y: 0, z: 0, w: .25, h: .25, hitX: false, hitY: false, hitZ: false };
    const FR = V().rng((V().hash(S.W.seed, 4242) >>> 0) || 7);   // случайность украшений (частицы) — своя: игре (X.rng) не мешает
    const lerpA = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * k; };

    // ═══ Выпавшие вещи: летят дугой, прыгают, скользят и встают, на воде — качаются, рядом с игроком (есть место) —
    // тянутся к нему и «влетают» (pickup). Свои (Q, после смерти) — подобрать можно через 2 с, остальные — через 0,5 с ═══
    X.addItem = (x, y, z, stack, scatter, vel) => {
      if (!stack || !(stack.n > 0) || !V().item(stack.id)) return null;
      const r = X.rng;
      const e = { x, y, z, px: x, py: y, pz: z, vx: vel ? vel[0] : (r() - .5) * 2.4, vy: vel ? vel[1] : 3 + r() * 1.5, vz: vel ? vel[2] : (r() - .5) * 2.4, s: { id: stack.id, n: stack.n, d: stack.d | 0 }, age: 0, mesh: null, ph: r() * 6, lit: Lit.make(null), ground: false, float: false, tilt: 0, delay: vel || scatter ? 2 : .5 };
      if (scatter) { e.vx = (r() - .5) * 6; e.vz = (r() - .5) * 6; e.vy = 4; }
      e.mesh = VR.itemMesh(e.s.id, 15 << 12);
      const flat = e.mesh.geometry.userData.flat;
      e.mesh.scale.setScalar(flat ? .42 : .28); e.k = flat ? .21 : .14;
      R.scene.add(e.mesh);
      X.items.push(e);
      if (X.items.length > 300) dropItem(0);
      return e;
    };
    function dropItem(i){ const e = X.items[i]; R.scene.remove(e.mesh); e.mesh.geometry.dispose(); X.items.splice(i, 1); }
    function itemsTick(dt){
      const P = S.P, Vx = V(), Tl = Vx.T.liquid;
      for (let i = X.items.length - 1; i >= 0; i--) {
        const e = X.items[i];
        e.px = e.x; e.py = e.y; e.pz = e.z;
        e.age += dt;
        if (e.age > 300) { dropItem(i); continue; }
        if (!W.loaded(e.x, e.z)) continue;
        // вода: всплывает к поверхности и качается на ней (пружина), течёт медленнее; иначе — падает
        const wv = W.raw(e.x, e.y + .12, e.z), cy = Math.floor(e.y + .12);
        // лёд на озере (времена года): лежит на нём сверху — не плавает; подо льдом — всплывает до льда, не сквозь
        e.float = wv > 0 && Tl[wv & 0xfff] === 1 && !(Vx.iceTest && e.y >= cy + Vx.liquidHeight(wv) - .05 && Vx.isIce(W, e.x, cy, e.z, wv));
        if (e.float) {
          let top = cy, tv = wv;
          for (let n = 0; n < 4; n++) { const u = W.raw(e.x, top + 1, e.z); if (!(u > 0 && Tl[u & 0xfff] === 1)) break; top++; tv = u; }
          const surf = Vx.iceTest && Vx.isIce(W, e.x, top, e.z, tv) ? top - .14 : top + Vx.liquidHeight(tv);
          const dep = Math.min(1.5, surf - (e.y + .12));
          e.vy += (dep * 34 - e.vy * 5) * dt;
          const f = Math.exp(-dt * 2.2); e.vx *= f; e.vz *= f;
        } else e.vy = Math.max(-30, e.vy - 20 * dt);
        // магнит: игрок рядом и есть место — тянется к нему (сильнее ближе)
        const dx = P.x - e.x, dy = P.y + .9 - e.y, dz = P.z - e.z, dd = Math.hypot(dx, dy, dz);
        const pull = !P.dead && e.age > e.delay && dd < 2.6 && dd > .05 && (!X.room || X.room(e.s));
        if (pull) { const k = (8 + 22 * (1 - dd / 2.6)) * dt / dd; e.vx += dx * k; e.vy += dy * k * .8; e.vz += dz * k; }
        BOX.x = e.x; BOX.y = e.y; BOX.z = e.z;
        const vy0 = e.vy;
        Vx.moveBox(W, BOX, e.vx * dt, e.vy * dt, e.vz * dt);
        // ударилась о землю: быстро — подпрыгнула (всё ниже), медленно — легла и скользит до остановки
        if (BOX.hitY) { if (vy0 < -3 && !pull) { e.vy = -vy0 * .3; e.ground = false; } else { e.vy = 0; e.ground = vy0 <= 0; } }
        else e.ground = false;
        if (BOX.hitX) e.vx *= -.3; if (BOX.hitZ) e.vz *= -.3;
        const fr = e.ground && !pull ? Math.exp(-dt * 5) : Math.exp(-dt * .4); e.vx *= fr; e.vz *= fr;
        if (e.ground && Math.abs(e.vx) + Math.abs(e.vz) < .03) e.vx = e.vz = 0;
        // застрял в блоке — наверх
        if (Vx.boxHits(W, BOX.x, BOX.y + .01, BOX.z, .2, .2)) BOX.y += 2 * dt * 5;
        e.x = BOX.x; e.y = BOX.y; e.z = BOX.z;
        // подобрать
        if (!P.dead && e.age > e.delay && Math.abs(P.x - e.x) < 1.3 && Math.abs(P.z - e.z) < 1.3 && e.y > P.y - .6 && e.y < P.y + 2) {
          const left = X.give ? X.give(e.s) : e.s.n;
          if (left < e.s.n) { S.AU?.play('kb_pop', { vol: .35, rate: 1 + X.rng() * .3 }); if (e.s.id === 'iron_ingot') S.ents.hookUnlock?.('iron'); X.hookPickup?.(e.s.id, e.s.n - left); }
          if (left <= 0) { X.items.splice(i, 1); collect(e); continue; }
          e.s.n = left;
        }
      }
      // склеить одинаковые рядом (раз в секунду)
      if (X.tickN % 20 === 0) for (let i = 0; i < X.items.length; i++) for (let j = X.items.length - 1; j > i; j--) {
        const a = X.items[i], b = X.items[j], it = Vx.item(a.s.id);
        if (a.s.id !== b.s.id || it.tool || Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > .6 || Math.abs(a.z - b.z) > 1 || a.s.n + b.s.n > it.stack) continue;
        a.s.n += b.s.n; dropItem(j);
      }
    }
    // рисование: между тактами — плавно (X.frac); в полёте кувыркается, легла — выпрямилась, крутится и качается (на воде — сильнее);
    // свет — плавно (Lit), дальние (дальше 20 блоков) — раз в 4 кадра
    let fN = 0;
    function itemsFrame(t, dt, a){
      fN++;
      const P = S.P;
      for (let i = 0; i < X.items.length; i++) {
        const e = X.items[i], m = e.mesh;
        const x = e.px + (e.x - e.px) * a, y = e.py + (e.y - e.py) * a, z = e.pz + (e.z - e.pz) * a;
        if (!e.ground && !e.float) e.tilt += dt * (5 + Math.hypot(e.vx, e.vz) * 1.5);
        else if (e.tilt) { e.tilt -= Math.round(e.tilt / 6.2832) * 6.2832; e.tilt *= Math.exp(-dt * 12); if (Math.abs(e.tilt) < .01) e.tilt = 0; }
        const bob = e.float ? Math.sin(t * 2.2 + e.ph) * .07 : e.ground ? Math.sin(t * 2.4 + e.ph) * .05 : 0;
        m.position.set(x - S.ox, y + e.k + .08 + bob, z - S.oz);
        m.rotation.set(e.tilt, t * 1.6 + e.ph, 0);
        const far = Math.abs(e.x - P.x) > 20 || Math.abs(e.z - P.z) > 20;
        if (far && e.lit.init && ((fN + i) & 3)) continue;
        Lit.update(e.lit, S, e.x, e.y + e.k + .1, e.z, far ? dt * 4 : dt);
        VR.itemLightF(m.geometry, e.lit.lv);
      }
    }
    // подобрал: вещь летит к груди и исчезает (0,16 с)
    const flyers = [];
    function collect(e){ flyers.push({ m: e.mesh, t: 0, x: e.x, y: e.y + e.k + .08, z: e.z, s: e.mesh.scale.x }); }
    function flyersFrame(dt){
      const P = S.P;
      for (let i = flyers.length - 1; i >= 0; i--) {
        const f = flyers[i]; f.t += dt;
        const k = Math.min(1, f.t / .16), e = k * k, ty = P.y + (P.sneak ? .9 : 1.15);
        f.m.position.set(f.x + (P.x - f.x) * e - S.ox, f.y + (ty - f.y) * e + Math.sin(k * Math.PI) * .25, f.z + (P.z - f.z) * e - S.oz);
        f.m.scale.setScalar(f.s * (1 - .7 * k));
        if (k >= 1) { R.scene.remove(f.m); f.m.geometry.dispose(); flyers.splice(i, 1); }
      }
    }

    // ═══ Крошки при ломании (точки цвета текстуры) ═══
    const DN = 320, dPos = new Float32Array(DN * 3), dCol = new Float32Array(DN * 3), dVel = new Float32Array(DN * 3), dLife = new Float32Array(DN);
    const dGeo = new T.BufferGeometry();
    dGeo.setAttribute('position', new T.BufferAttribute(dPos, 3).setUsage(T.DynamicDrawUsage));
    dGeo.setAttribute('color', new T.BufferAttribute(dCol, 3).setUsage(T.DynamicDrawUsage));
    const dMat = new T.PointsMaterial({ size: .09, vertexColors: true, sizeAttenuation: true });
    const dPts = new T.Points(dGeo, dMat); dPts.frustumCulled = false; R.scene.add(dPts);
    let dHead = 0;
    const avgCol = new Map();
    function texAvg(layer){
      if (avgCol.has(layer)) return avgCol.get(layer);
      const t = V().tex[layer], d = V().paint(t.name, t.spec || V().TEX_SPECS[t.name]);
      let r = 0, g = 0, b = 0, n = 0; const pal = [];
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; if ((i >> 2) % 23 === 0) pal.push([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]); }
      const out = { avg: n ? [r / n / 255, g / n / 255, b / n / 255] : [.5, .5, .5], pal: pal.length ? pal : [[.5, .5, .5]] };
      avgCol.set(layer, out); return out;
    }
    X.debris = (x, y, z, bid, n = 14, colOverride) => {
      const b = V().blocks[bid], layer = b?.texf ? b.texf.side : 0, P = texAvg(layer), r = FR;
      dPts.visible = true;
      const L = W.lightAt(x, y + 1, z), k = Math.max((V().lSky(L) / 15) ** 2, (V().lBlk(L) / 15) ** 2, .08) * .8;
      for (let i = 0; i < n; i++) {
        const j = dHead; dHead = (dHead + 1) % DN;
        dPos[j * 3] = x + .5 + (r() - .5) * .7 - S.ox; dPos[j * 3 + 1] = y + .5 + (r() - .5) * .7; dPos[j * 3 + 2] = z + .5 + (r() - .5) * .7 - S.oz;
        dVel[j * 3] = (r() - .5) * 3.5; dVel[j * 3 + 1] = r() * 3.5 + 1; dVel[j * 3 + 2] = (r() - .5) * 3.5;
        const c = colOverride || P.pal[Math.floor(r() * P.pal.length)];
        dCol[j * 3] = c[0] * k; dCol[j * 3 + 1] = c[1] * k; dCol[j * 3 + 2] = c[2] * k;
        dLife[j] = .5 + r() * .5;
      }
    };
    X.particles = (kind, x, y, z, n = 10, color) => {   // color — «#rrggbb» (моды)
      const hx = /^#[0-9a-f]{6}$/i.test(color || '') ? parseInt(color.slice(1), 16) : -1;
      const c = hx >= 0 ? [(hx >> 16 & 255) / 255, (hx >> 8 & 255) / 255, (hx & 255) / 255] : kind === 'heart' ? [1, .3, .4] : kind === 'magic' ? [.7, .4, 1] : kind === 'smoke' ? [.4, .4, .4] : kind === 'fire' ? [1, .6, .2] : kind === 'water' ? [.4, .6, 1] : [1, 1, .6];
      X.debris(Math.floor(x), Math.floor(y), Math.floor(z), 0, Math.max(1, Math.min(40, n | 0)), c);
    };
    // крошки еды у рта (точная точка, цвета — по картинке вещи)
    X.crumbs = (x, y, z, id, n = 4) => {
      const it = V().item(id), b = it?.place ? V().block(it.place) : null, P = texAvg(it?.texL ?? b?.texf?.side ?? 0), r = FR;
      const L = W.lightAt(x, y, z), k = Math.max((V().lSky(L) / 15) ** 2, (V().lBlk(L) / 15) ** 2, .08) * .8;
      dPts.visible = true;
      for (let i = 0; i < n; i++) {
        const j = dHead; dHead = (dHead + 1) % DN;
        dPos[j * 3] = x + (r() - .5) * .16 - S.ox; dPos[j * 3 + 1] = y + (r() - .5) * .1; dPos[j * 3 + 2] = z + (r() - .5) * .16 - S.oz;
        dVel[j * 3] = (r() - .5) * 1.6; dVel[j * 3 + 1] = r() * .8 + .2; dVel[j * 3 + 2] = (r() - .5) * 1.6;
        const c = P.pal[Math.floor(r() * P.pal.length)];
        dCol[j * 3] = c[0] * k; dCol[j * 3 + 1] = c[1] * k; dCol[j * 3 + 2] = c[2] * k;
        dLife[j] = .35 + r() * .3;
      }
    };
    // капля (брызги воды): точка с заданной скоростью, цвет — уже со светом
    function drop(x, y, z, vx, vy, vz, r, g, b, life){
      const j = dHead; dHead = (dHead + 1) % DN;
      dPos[j * 3] = x - S.ox; dPos[j * 3 + 1] = y; dPos[j * 3 + 2] = z - S.oz;
      dVel[j * 3] = vx; dVel[j * 3 + 1] = vy; dVel[j * 3 + 2] = vz;
      dCol[j * 3] = r; dCol[j * 3 + 1] = g; dCol[j * 3 + 2] = b; dLife[j] = life;
      dPts.visible = true;
    }
    let dOX = 0, dOZ = 0;
    function debrisFrame(dt){
      if (!dPts.visible) return;
      // сдвиг начала координат — точки тоже
      if (dOX !== S.ox || dOZ !== S.oz) { const ax = S.ox - dOX, az = S.oz - dOZ; for (let j = 0; j < DN; j++) { dPos[j * 3] -= ax; dPos[j * 3 + 2] -= az; } dOX = S.ox; dOZ = S.oz; }
      let any = false, live = 0;
      for (let j = 0; j < DN; j++) {
        if (dLife[j] <= 0) { if (dPos[j * 3 + 1] > -900) { dPos[j * 3 + 1] = -1000; any = true; } continue; }
        dLife[j] -= dt; any = true; live++;
        dVel[j * 3 + 1] -= 14 * dt;
        dPos[j * 3] += dVel[j * 3] * dt; dPos[j * 3 + 1] += dVel[j * 3 + 1] * dt; dPos[j * 3 + 2] += dVel[j * 3 + 2] * dt;
        const v = W.raw(dPos[j * 3] + S.ox, dPos[j * 3 + 1], dPos[j * 3 + 2] + S.oz);
        if (v > 0 && V().T.solid[v & 0xfff]) { dVel[j * 3 + 1] = 0; dVel[j * 3] *= .5; dVel[j * 3 + 2] *= .5; dPos[j * 3 + 1] = Math.ceil(dPos[j * 3 + 1]) + .02; }
      }
      if (any) { dGeo.attributes.position.needsUpdate = true; dGeo.attributes.color.needsUpdate = true; }
      if (!live) dPts.visible = false;   // ни одной точки — без лишнего вызова отрисовки
    }

    // ═══ «Оживление»: осколки-кубики, клубы (дым, пыль, пар, пузыри, листья), светящиеся искры. Всё — постоянные пулы:
    // новые частицы пишутся по кругу поверх самых старых; ни одной живой — объект спрятан (нет вызова отрисовки) ═══
    const FXQ = X.fxQ = R.q === 'low' ? .35 : (window.D37E?.isMobile?.() || R.q === 'mid') ? .6 : 1;
    const nq = n => Math.max(1, Math.round(n * FXQ));
    // свет в точке → множитель цвета частиц (как у существ: небо по времени суток + цветной свет блоков)
    const LV = new Float32Array(4), LV4 = { x: 0, y: 0, z: 0, w: 0 }, LRGB = [1, 1, 1];
    function lightRGB(x, y, z){
      Lit.sample(W, x, y, z, LV); Lit.vec(LV, LV4, 1);
      const day = VR?.U?.uDay ? VR.U.uDay.value : 1 - Math.max(0, Math.min(1, R.night || 0)), s = Math.max(LV4.x * (.3 + .7 * day), .06);
      LRGB[0] = Math.min(1.3, s + LV4.y * 1.7); LRGB[1] = Math.min(1.3, s + LV4.z * 1.7); LRGB[2] = Math.min(1.3, s + LV4.w * 1.7);
      return LRGB;
    }
    const solidAt = (Ts, x, y, z) => { const v = W.raw(x, y, z); return v < 0 || (v > 0 && Ts[v & 0xfff] === 1); };

    // ── осколки блока: маленькие кубики (один InstancedMesh, грани чуть темнее — объём без света сцены) кувыркаются, прыгают по
    // земле и скользят до остановки, к концу жизни уменьшаются ──
    const SHN = 96, sx = new Float64Array(SHN), sy = new Float64Array(SHN), sz = new Float64Array(SHN);
    const F32 = () => new Float32Array(SHN), svx = F32(), svy = F32(), svz = F32(), srx = F32(), sry = F32(), srz = F32(), swx = F32(), swy = F32(), swz = F32(), ssz = F32(), slf = F32(), scr = F32(), scg = F32(), scb = F32();
    let sHead = 0, sLive = 0;
    const shGeo = new T.BoxGeometry(1, 1, 1);
    { const n = shGeo.attributes.position.count, c = new Float32Array(n * 3), SHD = [.82, .74, 1, .56, .9, .68]; for (let i = 0; i < n; i++) c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = SHD[Math.min(5, i >> 2)]; shGeo.setAttribute('color', new T.BufferAttribute(c, 3)); }
    const shMat = new T.MeshBasicMaterial({ vertexColors: true });
    const shMesh = new T.InstancedMesh(shGeo, shMat, SHN);
    shMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    shMesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(SHN * 3), 3); shMesh.instanceColor.setUsage(T.DynamicDrawUsage);
    shMesh.count = 0; shMesh.visible = false; shMesh.frustumCulled = false; R.scene.add(shMesh);
    const DUM = new T.Object3D();
    // осколки блока bid из клетки (x, y, z); face — { nx, ny, nz }: удар по грани — мелкие, летят от неё
    X.shards = (x, y, z, bid, n = 8, face) => {
      const b = V().blocks[bid], pal = texAvg(b?.texf ? b.texf.side : 0).pal, L = lightRGB(x + .5 + (face ? face.nx * .6 : 0), y + .5 + (face ? face.ny * .6 : .6), z + .5 + (face ? face.nz * .6 : 0));
      n = nq(n);
      for (let i = 0; i < n; i++) {
        const j = sHead; sHead = (sHead + 1) % SHN;
        if (face) {
          sx[j] = x + .5 + face.nx * .55 + (face.nx ? 0 : (FR() - .5) * .8); sy[j] = y + .5 + face.ny * .55 + (face.ny ? 0 : (FR() - .5) * .8); sz[j] = z + .5 + face.nz * .55 + (face.nz ? 0 : (FR() - .5) * .8);
          const sp = 1.2 + FR() * 1.6;
          svx[j] = face.nx * sp + (FR() - .5) * 1.6; svy[j] = face.ny * sp + 1.2 + FR() * 1.5; svz[j] = face.nz * sp + (FR() - .5) * 1.6;
          ssz[j] = .05 + FR() * .045; slf[j] = .45 + FR() * .35;
        } else {
          sx[j] = x + .5 + (FR() - .5) * .7; sy[j] = y + .25 + FR() * .6; sz[j] = z + .5 + (FR() - .5) * .7;
          svx[j] = (FR() - .5) * 4.2; svy[j] = 2.2 + FR() * 3.2; svz[j] = (FR() - .5) * 4.2;
          ssz[j] = .07 + FR() * .08; slf[j] = 1 + FR() * .8;
        }
        srx[j] = FR() * 6.28; sry[j] = FR() * 6.28; srz[j] = FR() * 6.28;
        swx[j] = (FR() - .5) * 16; swy[j] = (FR() - .5) * 16; swz[j] = (FR() - .5) * 16;
        const c = pal[Math.floor(FR() * pal.length)], k = .9 + FR() * .2;
        scr[j] = c[0] * k * L[0]; scg[j] = c[1] * k * L[1]; scb[j] = c[2] * k * L[2];
      }
      sLive = 1;
    };
    function shardsFrame(dt){
      if (!sLive) return;
      const Ts = V().T.solid, d = Math.min(dt, .05);
      let k = 0;
      for (let j = 0; j < SHN; j++) {
        if (slf[j] <= 0) continue;
        slf[j] -= d; if (slf[j] <= 0) continue;
        svy[j] = Math.max(-25, svy[j] - 22 * d);
        const hs = ssz[j] * .5;
        let nx = sx[j] + svx[j] * d, ny = sy[j] + svy[j] * d, nz = sz[j] + svz[j] * d;
        // пол: быстро — отскок (теряет скорость и вращение), медленно — лёг и скользит до остановки
        if (svy[j] <= 0 && solidAt(Ts, nx, ny - hs, nz)) {
          ny = Math.floor(ny - hs) + 1 + hs;
          if (svy[j] < -1.6) { svy[j] *= -.36; svx[j] *= .62; svz[j] *= .62; swx[j] *= .55; swy[j] *= .55; swz[j] *= .55; }
          else { svy[j] = 0; const f = Math.exp(-d * 9); svx[j] *= f; svz[j] *= f; swx[j] *= f; swy[j] *= f; swz[j] *= f; }
        }
        // стены: отскок назад
        if (solidAt(Ts, nx, ny, sz[j])) { nx = sx[j]; svx[j] *= -.35; }
        if (solidAt(Ts, nx, ny, nz)) { nz = sz[j]; svz[j] *= -.35; }
        sx[j] = nx; sy[j] = ny; sz[j] = nz;
        srx[j] += swx[j] * d; sry[j] += swy[j] * d; srz[j] += swz[j] * d;
        const sc = ssz[j] * Math.max(.2, Math.min(1, slf[j] / .25));
        DUM.position.set(nx - S.ox, ny, nz - S.oz); DUM.rotation.set(srx[j], sry[j], srz[j]); DUM.scale.set(sc, sc, sc); DUM.updateMatrix();
        shMesh.setMatrixAt(k, DUM.matrix); shMesh.instanceColor.setXYZ(k, scr[j], scg[j], scb[j]); k++;
      }
      shMesh.count = k; shMesh.visible = k > 0; sLive = k;
      if (k) { shMesh.instanceMatrix.needsUpdate = true; shMesh.instanceColor.needsUpdate = true; }
    }

    // ── клубы и искры: точки с мягкой картинкой-кружком, у каждой — свой размер (aSize) и прозрачность (альфа цвета) ──
    function dotTex(pow, k){
      const n = 32, d = new Uint8Array(n * n * 4);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const dx = (x + .5) / n * 2 - 1, dy = (y + .5) / n * 2 - 1, r = Math.sqrt(dx * dx + dy * dy), i = (y * n + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = r >= 1 ? 0 : Math.round(255 * Math.min(1, Math.pow(1 - r, pow) * k));
      }
      const t = new T.DataTexture(d, n, n, T.RGBAFormat); t.magFilter = t.minFilter = T.LinearFilter; t.needsUpdate = true;
      return t;
    }
    function pool(N, tex, add){
      const pos = new Float32Array(N * 3), col = new Float32Array(N * 4), siz = new Float32Array(N), g = new T.BufferGeometry();
      const A = (a, k) => new T.BufferAttribute(a, k).setUsage(T.DynamicDrawUsage);
      g.setAttribute('position', A(pos, 3)); g.setAttribute('color', A(col, 4)); g.setAttribute('aSize', A(siz, 1)); g.setDrawRange(0, 0);
      const m = new T.PointsMaterial({ size: 1, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: add ? T.AdditiveBlending : T.NormalBlending, toneMapped: !add });
      // размер у каждой точки свой: правим шейдер точек three, только если оба места на месте (иначе — обычные точки)
      m.onBeforeCompile = sh => { const vs = sh.vertexShader; if (vs.includes('uniform float size;') && vs.includes('gl_PointSize = size;')) sh.vertexShader = vs.replace('uniform float size;', 'uniform float size;\nattribute float aSize;').replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;'); };
      m.customProgramCacheKey = () => 'kbpts1' + (add ? 'a' : 'n');
      const o = new T.Points(g, m); o.frustumCulled = false; o.visible = false; o.renderOrder = add ? 7 : 6; R.scene.add(o);
      const F = () => new Float32Array(N), D = () => new Float64Array(N);
      return { N, o, g, m, tex, pos, col, siz, head: 0, live: 0, x: D(), y: D(), z: D(), vx: F(), vy: F(), vz: F(), life: F(), max: F(), s0: F(), s1: F(), a0: F(), cr: F(), cg: F(), cb: F(), drag: F(), up: F(), ph: F(), kind: new Uint8Array(N) };
    }
    const PF = pool(160, dotTex(1.6, 1.35), false), GL = pool(72, dotTex(2, 1), true);
    // kind: 0 — клуб (растёт и тает), 1 — пузырь (лопается над водой), 2 — лист (кружится и падает), 3 — светлячок (блуждает,
    // мигает), 4 — искра/уголёк (летит дугой); up — всплытие (+) или тяжесть (−), drag — сопротивление воздуха
    function emit(p, kind, x, y, z, vx, vy, vz, life, s0, s1, a0, r, g, b, drag, up){
      const j = p.head; p.head = (p.head + 1) % p.N;
      p.kind[j] = kind; p.x[j] = x; p.y[j] = y; p.z[j] = z; p.vx[j] = vx; p.vy[j] = vy; p.vz[j] = vz;
      p.life[j] = p.max[j] = life; p.s0[j] = s0; p.s1[j] = s1; p.a0[j] = a0; p.cr[j] = r; p.cg[j] = g; p.cb[j] = b; p.drag[j] = drag; p.up[j] = up; p.ph[j] = FR() * 6.283;
      p.live = 1;
    }
    function poolFrame(p, dt, t, extra){
      if (!p.live && !extra) { if (p.o.visible) p.o.visible = false; return; }
      const d = Math.min(dt, .05), Tl = V().T.liquid, Ts = V().T.solid;
      let k = 0;
      for (let j = 0; j < p.N; j++) {
        if (p.life[j] <= 0) continue;
        p.life[j] -= d; if (p.life[j] <= 0) continue;
        const kind = p.kind[j], f = Math.exp(-p.drag[j] * d);
        p.vx[j] *= f; p.vz[j] *= f; p.vy[j] = p.vy[j] * f + p.up[j] * d;
        if (kind === 2) { p.vx[j] += Math.sin(t * 2.1 + p.ph[j]) * 1.6 * d; p.vz[j] += Math.cos(t * 1.7 + p.ph[j]) * 1.6 * d; }
        else if (kind === 3) { p.vx[j] += Math.sin(t * .9 + p.ph[j]) * 1.1 * d; p.vz[j] += Math.cos(t * 1.1 + p.ph[j] * 1.3) * 1.1 * d; p.vy[j] += Math.sin(t * 1.4 + p.ph[j] * 2) * .6 * d; }
        p.x[j] += p.vx[j] * d; p.y[j] += p.vy[j] * d; p.z[j] += p.vz[j] * d;
        if (kind === 1) {   // пузырь: вынырнул — лопнул; по пути покачивается
          const v = W.raw(p.x[j], p.y[j], p.z[j]); if (!(v > 0 && Tl[v & 0xfff] === 1)) { p.life[j] = 0; continue; }
          p.x[j] += Math.sin(t * 9 + p.ph[j]) * .25 * d;
        } else if (kind === 2 || kind === 4) {   // лист и уголёк: упал на блок или в воду — лёг и тает
          const v = W.raw(p.x[j], p.y[j], p.z[j]);
          if (v < 0 || (v > 0 && (Ts[v & 0xfff] || Tl[v & 0xfff]))) { p.vx[j] = p.vy[j] = p.vz[j] = 0; p.up[j] = 0; if (p.life[j] > .35) p.life[j] = .35; }
        }
        const q = 1 - p.life[j] / p.max[j];
        let a = p.a0[j] * Math.min(1, q * 7) * (1 - q * q);
        if (kind === 3) a *= .3 + .7 * Math.pow(.5 + .5 * Math.sin(t * 2.6 + p.ph[j]), 3);
        const i3 = k * 3, i4 = k * 4;
        p.pos[i3] = p.x[j] - S.ox; p.pos[i3 + 1] = p.y[j]; p.pos[i3 + 2] = p.z[j] - S.oz;
        p.col[i4] = p.cr[j]; p.col[i4 + 1] = p.cg[j]; p.col[i4 + 2] = p.cb[j]; p.col[i4 + 3] = a;
        p.siz[k] = p.s0[j] + (p.s1[j] - p.s0[j]) * (1 - (1 - q) * (1 - q));
        k++;
      }
      p.live = k;
      if (extra) k = extra(p, k, t);
      p.g.setDrawRange(0, k); p.o.visible = k > 0;
      if (k) { const at = p.g.attributes; at.position.needsUpdate = true; at.color.needsUpdate = true; at.aSize.needsUpdate = true; }
    }
    // ореол у пламени ближних факелов (мерцает): не частицы — дописываются в конец светящихся точек каждый кадр
    function halos(p, k, t){
      const KL = S.KL, P = S.P; if (!KL?.recs) return k;
      const day = 1 - Math.max(0, Math.min(1, R.night || 0));
      for (const r of KL.recs.values()) {
        if (k >= p.N) break;
        if (r.own || r.k !== 'torch') continue;
        const dx = r.x + .5 - P.x, dz = r.z + .5 - P.z; if (dx * dx + dz * dz > 400) continue;
        const fl = 1 + .14 * Math.sin(t * 9.3 + r.seed) + .09 * Math.sin(t * 15.1 + r.seed * 2.3), i3 = k * 3, i4 = k * 4;
        p.pos[i3] = r.x + .5 - S.ox; p.pos[i3 + 1] = r.y + .08; p.pos[i3 + 2] = r.z + .5 - S.oz;
        p.col[i4] = 1; p.col[i4 + 1] = .6; p.col[i4 + 2] = .24; p.col[i4 + 3] = .3 * fl * (1 - .55 * day * (r.sky || 0));
        p.siz[k] = .6 * fl; k++;
      }
      return k;
    }

    // ── эффекты (координаты — мир) ──
    const SMOKE = [.92, .92, .95], SOOT = [.32, .31, .3], STEAM = [.95, .97, 1];
    // клубы дыма: появился / исчез моб, пар; w — ширина облачка. Клубки небольшие (0,2–0,6 блока), разные по размеру и тону,
    // мягкие по краю, быстро всплывают и тают — облачко читается числом, а не огромными дисками
    X.smoke = (x, y, z, n, w = .6, col = SMOKE, a0 = .8, sz = 1) => {
      const L = lightRGB(x, y, z); n = nq(n);
      for (let i = 0; i < n; i++) {
        const an = FR() * 6.283, r = FR() * w * .5, sp = .45 + FR() * .7, v = (.8 + FR() * .45) * sz, k = .82 + FR() * .22;
        emit(PF, 0, x + Math.cos(an) * r, y + FR() * w * .6, z + Math.sin(an) * r, Math.cos(an) * sp, .5 + FR() * .5, Math.sin(an) * sp, .4 + FR() * .25, (.18 + FR() * .09) * v, (.42 + FR() * .21) * v, a0, col[0] * k * L[0], col[1] * k * L[1], col[2] * k * L[2], 3.8, 1.4);
      }
    };
    // пыль цветом блока (верх блока: трава — зелёная, песок — жёлтый); o.ring — кольцом по земле (приземление), иначе — облачком
    X.dust = (x, y, z, bid, n, o = {}) => {
      const b = V().blocks[bid] || V().blocks[0], c = texAvg(b.texf ? b.texf.top : 0).avg, L = lightRGB(x, y + .3, z);
      n = nq(n);
      const sp = o.sp || 1, w = o.w || .5;
      for (let i = 0; i < n; i++) {
        let vx, vz, px = x, pz = z;
        if (o.ring) { const an = i / n * 6.283 + FR() * .6, v = sp * (.7 + FR() * .6); vx = Math.cos(an) * v; vz = Math.sin(an) * v; px += Math.cos(an) * .25; pz += Math.sin(an) * .25; }
        else { vx = (FR() - .5) * sp; vz = (FR() - .5) * sp; px += (FR() - .5) * w; pz += (FR() - .5) * w; }
        const k = .85 + FR() * .3;
        emit(PF, 0, px, y + .04 + FR() * .1, pz, vx, (o.vy ?? .5) + FR() * .4, vz, (o.life || .55) * (.8 + FR() * .4), (o.s || .22) * (.8 + FR() * .4), o.s1 || .55, o.a ?? .55,
          Math.min(1, c[0] * .75 + .2) * k * L[0], Math.min(1, c[1] * .75 + .2) * k * L[1], Math.min(1, c[2] * .75 + .2) * k * L[2], 4.5, -.5);
      }
    };
    // пузыри под водой (всплывают, у поверхности лопаются)
    X.bubbles = (x, y, z, n = 2) => {
      const L = lightRGB(x, y, z);
      for (let i = 0; i < n; i++) { const s = .06 + FR() * .05; emit(PF, 1, x + (FR() - .5) * .3, y + (FR() - .5) * .2, z + (FR() - .5) * .3, (FR() - .5) * .3, .4, (FR() - .5) * .3, 2.5, s, s * 1.3, .75, .8 * L[0], .9 * L[1], 1 * L[2], 2, 3); }
    };
    // всплеск: брызги дугой вверх и кольцо пены на воде; k — сила (0…1,5)
    X.splash = (x, y, z, k = 1) => {
      const L = lightRGB(x, y + .3, z), n = nq(Math.round(8 + 12 * k));
      for (let i = 0; i < n; i++) { const an = FR() * 6.283, v = (.6 + FR() * 1.6) * (.6 + k * .5); drop(x + Math.cos(an) * .3, y + .05, z + Math.sin(an) * .3, Math.cos(an) * v, 2.5 + FR() * 3.5 * k, Math.sin(an) * v, .72 * L[0], .84 * L[1], 1 * L[2], .5 + FR() * .4); }
      const m = nq(6);
      for (let i = 0; i < m; i++) { const an = i / m * 6.283 + FR() * .5, v = 1 + FR() * .8; emit(PF, 0, x + Math.cos(an) * .3, y + .04, z + Math.sin(an) * .3, Math.cos(an) * v, .2, Math.sin(an) * v, .5 + FR() * .3, .25, .65, .55, .95 * L[0], .97 * L[1], 1 * L[2], 3.5, -.3); }
    };
    // капля дождя разбилась о землю (kubomir-weather.js): две крошечные брызги, цвет — уже со светом
    X.drip = (x, y, z, r, g, b) => { for (let i = 0; i < 2; i++) drop(x, y + .03, z, (FR() - .5) * 1.3, .9 + FR() * 1.1, (FR() - .5) * 1.3, r, g, b, .16 + FR() * .12); };
    // след на воде, когда плывёшь
    X.wake = (x, y, z) => { const L = lightRGB(x, y + .3, z); emit(PF, 0, x + (FR() - .5) * .4, y + .03, z + (FR() - .5) * .4, (FR() - .5) * .6, 0, (FR() - .5) * .6, .7, .16, .5, .38, .95 * L[0], .97 * L[1], L[2], 2.5, 0); };
    // светится сам (не зависит от света вокруг): уголёк лавы, искра, язычок огня, светлячок
    X.glow = (kind, x, y, z, n = 1) => {
      for (let i = 0; i < n; i++) {
        if (kind === 'ember') emit(GL, 4, x + (FR() - .5) * .8, y, z + (FR() - .5) * .8, (FR() - .5) * 1.2, 1.6 + FR() * 1.8, (FR() - .5) * 1.2, .9 + FR() * .9, .11 + FR() * .06, .05, 1, 1.4, .5 + FR() * .25, .12, .6, -2.2);
        else if (kind === 'spark') emit(GL, 4, x, y, z, (FR() - .5) * 3, 1 + FR() * 2.5, (FR() - .5) * 3, .3 + FR() * .3, .07, .03, 1, 1.5, 1.1, .4, 1.2, -9);
        else if (kind === 'flame') emit(GL, 0, x + (FR() - .5) * .5, y + FR() * .4, z + (FR() - .5) * .5, (FR() - .5) * .3, 1.2 + FR(), (FR() - .5) * .3, .35 + FR() * .25, .24, .06, .9, 1.4, .55, .12, 2, 0);
        else if (kind === 'firefly') emit(GL, 3, x, y, z, 0, 0, 0, 5 + FR() * 4, .12, .12, .9, .75, 1.25, .35, 1.5, 0);
        else if (kind === 'star') { const an = FR() * 6.283; emit(GL, 3, x + Math.cos(an) * .32, y, z + Math.sin(an) * .32, -Math.sin(an) * 1.4, .15, Math.cos(an) * 1.4, .45, .1, .06, 1, 1.5, 1.3, .35, .5, 0); }   // оглушён: звёздочки кружат над головой
      }
    };
    // сломал блок: осколки-кубики + пыль; трава, цветы, факел, лестница — мелкими точками
    X.breakFx = (x, y, z, bid) => {
      const Vx = V(), sh = Vx.T.shape[bid];
      if (sh === Vx.SHAPE.cross || sh === Vx.SHAPE.torch || sh === Vx.SHAPE.ladder || sh === Vx.SHAPE.none) { X.debris(x, y, z, bid, 10); return; }
      X.shards(x, y, z, bid, 10);
      X.dust(x + .5, y + .15, z + .5, bid, 3, { w: .9, s: .3, s1: .75, a: .4, vy: .6 });
    };
    // удар по блоку (копает): пара осколков от грани
    X.hitFx = (x, y, z, bid, nx, ny, nz) => { const sh = V().T.shape[bid]; if (sh === V().SHAPE.cross || sh === V().SHAPE.torch) return; HF.nx = nx; HF.ny = ny; HF.nz = nz; X.shards(x, y, z, bid, 2, HF); };
    const HF = { nx: 0, ny: 1, nz: 0 };
    // поставил блок: «пружинка» (копия блока чуть больше раздувается и опадает, пока поток не пересоберёт сетку чанка) и пыль
    const pops = [];
    X.placeFx = (x, y, z, bid) => {
      const Vx = V(), b = Vx.blocks[bid]; if (!b) return;
      X.dust(x + .5, y + .02, z + .5, bid, 4, { ring: true, sp: 1.1, s: .2, s1: .45, a: .4, life: .45, vy: .2 });
      if (Vx.T.shape[bid] !== Vx.SHAPE.cube || !Vx.item(b.name)) return;
      if (pops.length >= 3) { const o = pops.shift(); R.scene.remove(o.m); o.m.geometry.dispose(); }
      const m = VR.itemMesh(b.name, 15 << 12), lit = Lit.make(null);
      Lit.update(lit, S, x + .5, y + .5, z + .5, 0); VR.itemLightF(m.geometry, lit.lv);
      m.position.set(x + .5 - S.ox, y + .5, z + .5 - S.oz); R.scene.add(m);
      const c = W.chunkAt ? W.chunkAt(x, z) : null;
      pops.push({ m, t: 0, x, y, z, c, rev: c ? c.dirty : 0 });
    };
    function popsFrame(dt){
      for (let i = pops.length - 1; i >= 0; i--) {
        const o = pops[i]; o.t += dt;
        const k = Math.min(1, o.t / .2);
        if (k >= 1 && (o.t > .8 || !o.c || o.c.meshRev >= o.rev)) { R.scene.remove(o.m); o.m.geometry.dispose(); pops.splice(i, 1); continue; }
        o.m.scale.setScalar(1.004 + .11 * Math.sin(Math.PI * k) * (1 - k * .4));
        o.m.position.set(o.x + .5 - S.ox, o.y + .5, o.z + .5 - S.oz);
      }
    }
    // вокруг игрока (10 раз в секунду): дымок над факелами, угольки над лавой, ночью — светлячки над травой, у листвы — листья
    let ambT = 0;
    function ambient(dt){
      if ((ambT -= dt) > 0) return;
      ambT = .1;
      const P = S.P, KL = S.KL, Vx = V(), ID = Vx.ID;
      if (KL?.recs) for (const r of KL.recs.values()) {
        if (r.own) continue;
        const dx = r.x + .5 - P.x, dy = r.y - P.y, dz = r.z + .5 - P.z, d2 = dx * dx + dy * dy + dz * dz;
        if (r.k === 'torch' && d2 < 196 && FR() < .2 * FXQ) { const L = lightRGB(r.x + .5, r.y + .4, r.z + .5); emit(PF, 0, r.x + .5 + (FR() - .5) * .06, r.y + .2, r.z + .5 + (FR() - .5) * .06, (FR() - .5) * .1, .5, (FR() - .5) * .1, 1.1 + FR() * .5, .07, .3, .4, SOOT[0] * L[0], SOOT[1] * L[1], SOOT[2] * L[2], 1.2, .25); if (FR() < .12) X.glow('spark', r.x + .5, r.y + .12, r.z + .5); }
        else if (r.k === 'lava' && d2 < 324 && FR() < .22 * FXQ) X.glow('ember', r.x + .5, r.y + .05, r.z + .5);
      }
      const night = R.night || 0;
      if (night > .6 && FXQ >= .5 && GL.live < 60 && FR() < .35) {
        let ff = 0; for (let j = 0; j < GL.N; j++) if (GL.life[j] > 0 && GL.kind[j] === 3) ff++;
        if (ff < 10 * FXQ) {
          const an = FR() * 6.283, rr = 3 + FR() * 10, x = Math.floor(P.x + Math.cos(an) * rr), z = Math.floor(P.z + Math.sin(an) * rr), h = W.heightAt(x, z);
          if (h > 0 && Math.abs(h - P.y) < 10 && W.get(x, h - 1, z) === ID.grass && Vx.lSky(W.lightAt(x, h, z)) >= 12) X.glow('firefly', x + FR(), h + .4 + FR() * 1.6, z + FR());
        }
      }
      if (FXQ >= .5 && PF.live < 120) for (let q = 0; q < 2; q++) {   // листья: случайная клетка над игроком — листва, под ней пусто
        const x = Math.floor(P.x + (FR() - .5) * 20), y = Math.floor(P.y + 2 + FR() * 9), z = Math.floor(P.z + (FR() - .5) * 20), v = W.raw(x, y, z);
        if (v <= 0 || W.raw(x, y - 1, z) !== 0) continue;
        const b = Vx.blocks[v & 0xfff]; if (!b || !/^leaves_/.test(b.name) || FR() > .45) continue;
        const c = texAvg(b.texf ? b.texf.side : 0).avg, L = lightRGB(x + .5, y - .5, z + .5), tint = b.name === 'leaves_spruce' ? [.55, .75, .5] : [.62, .95, .45];
        emit(PF, 2, x + FR(), y - .05, z + FR(), 0, -.25, 0, 4 + FR() * 2, .1, .1, .95, Math.min(1, c[0] * 1.6) * tint[0] * L[0], Math.min(1, c[1] * 1.6) * tint[1] * L[1], Math.min(1, c[2] * 1.6) * tint[2] * L[2], 1.8, -.35);
      }
    }

    // ═══ Падающий песок и гравий (как в Майнкрафте): блок без опоры летит сущностью и снова становится блоком; упал на
    // факел, цветок, лестницу — те выпадают вещью, песок встаёт на их место. Шаг — такт игры (20 раз в секунду, от часов игры,
    // не от частоты кадров), рисуется плавно (X.frac); после приземления копия висит, пока поток не пересоберёт сетку чанка ═══
    const fallStop = v => v < 0 || (v > 0 && V().T.solid[v & 0xfff] === 1);   // на что падающий блок встаёт (незагруженное — тоже)
    function startFall(x, y, z, v){
      W.set(x, y, z, 0, { urgent: 2 });
      const name = V().blocks[v & 0xfff].name, m = VR.itemMesh(name, 15 << 12);
      m.scale.setScalar(.999); R.scene.add(m);
      const f = { x: x + .5, y, z: z + .5, py: y, vy: 0, v, m, lit: Lit.make(null), done: 0, c: null, rev: 0 };
      X.falling.push(f);
      return f;
    }
    X.startFall = startFall;
    const byY = (a, b) => a.y - b.y;
    function fallingTick(dt){
      if (!X.falling.length) return;
      const Vx = V(), T = Vx.T;
      if (X.falling.length > 1) X.falling.sort(byY);   // снизу вверх: столбик песка — нижний встаёт первым, верхние — на него
      for (let i = 0; i < X.falling.length; i++) {
        const f = X.falling[i];
        f.py = f.y;
        if (f.done) { f.done += dt; if (f.done > .6 || !f.c || f.c.meshRev >= f.rev) { R.scene.remove(f.m); f.m.geometry.dispose(); X.falling.splice(i--, 1); } continue; }
        f.vy = Math.max(-40, f.vy - 32 * dt);
        const ny = f.y + f.vy * dt, bx = Math.floor(f.x), bz = Math.floor(f.z);
        // все клетки, через которые прошёл низ за такт (до 2 при скорости 40): первая твёрдая — опора (не проскочить
        // сквозь только что вставший песок под ним)
        let land = -1;
        for (let cy = Math.ceil(f.y) - 1; cy >= Math.floor(ny); cy--) if (cy < 1 || fallStop(W.raw(bx, cy, bz))) { land = cy + 1; break; }
        if (land < 0 && ny < 1) land = 1;
        if (land >= 0) {
          const y = Math.max(1, land), cur = W.raw(bx, y, bz), ct = cur > 0 ? cur & 0xfff : 0, cb = Vx.blocks[ct], fb = Vx.blocks[f.v & 0xfff];
          f.y = y; f.vy = 0;
          if (cur === 0 || (cur > 0 && (cb.replace || !T.solid[ct]))) {
            if (cur > 0 && !T.liquid[ct] && cb.drop && Vx.item(cb.drop)) {   // раздавил факел / цветок — выпал вещью
              X.addItem(bx + .5, y + .3, bz + .5, { id: cb.drop, n: 1 });
              X.debris(bx, y, bz, ct, 8);
              S.AU?.play('kb_pop', { x: bx + .5 - S.ox, y: y + .5, z: bz + .5 - S.oz, vol: .4, rate: .8 });
            }
            W.set(bx, y, bz, f.v, { urgent: 3 });
            X.dust(bx + .5, y + .02, bz + .5, f.v & 0xfff, 6, { ring: true, sp: 1.4, s: .25, s1: .6, a: .5, life: .6, vy: .2 });
            S.AU?.play(fb.sound === 'gravel' ? 'kb_step_gravel' : 'kb_dig_dirt', { x: bx + .5 - S.ox, y: y + .5, z: bz + .5 - S.oz, vol: .6, rate: .8 });
            f.done = 1e-6; f.c = W.chunkAt ? W.chunkAt(bx, bz) : null; f.rev = f.c ? f.c.dirty : 0;
          } else {   // некуда встать — вещью
            X.addItem(f.x, y + .2, f.z, { id: fb.name, n: 1 });
            R.scene.remove(f.m); f.m.geometry.dispose(); X.falling.splice(i--, 1);
          }
          continue;
        }
        f.y = ny;
      }
    }

    // ═══ Падающие куски (общее: X.fallGroup) и падающие деревья (X.fellTree), 16.10.2026 ═══
    // fallGroup(cells, pivot, dir, o): cells — [x, y, z, v, …] (уже убраны из мира), pivot — { x, y, z } (ось — горизонталь через
    // точку, поперёк dir), dir — { x, z } (куда валится, единичный). Одна сетка (склейка кубиков VR.itemGeo, материал листвы
    // движка: вырез по альфе, без качания), свет — как у вещей (Lit → VR.itemLightF). Логика — такт игры (20 раз в секунду,
    // плавно между тактами): угловое ускорение как у падающего столба (g · sin угла / высоту центра масс), по дуге проверяются
    // точки (стволы и крайние листья) — упёрлась в землю или блок: отскок и лёг; лёг совсем — o.onLand(группа, мир-место
    // клетки) раскладывает на вещи. Под ним моб или игрок — толчок (урон — только «обычно» и «сложно»). Не больше 3 сразу.
    const groups = X.groups = [];
    const GQ = new T.Quaternion(), GA = new T.Vector3(), GV = { x: 0, y: 0, z: 0 };
    // повернуть точку r (от оси) на угол th вокруг оси a (Родриг) → GV (общий объект: читать сразу)
    function rot(g, rx, ry, rz, th){
      const c = Math.cos(th), s = Math.sin(th), ax = g.ax, az = g.az, dot = ax * rx + az * rz;   // ось горизонтальная (ay = 0)
      const cx = -az * ry, cy = az * rx - ax * rz, cz = ax * ry;   // a × r
      GV.x = g.px + rx * c + cx * s + ax * dot * (1 - c); GV.y = g.py + ry * c + cy * s; GV.z = g.pz + rz * c + cz * s + az * dot * (1 - c);
      return GV;
    }
    X.fallGroup = (cells, pivot, dir, o = {}) => {
      if (groups.length >= (o.cap || 3) || !cells.length) return null;
      const Vx = V(), n = cells.length / 4;
      // склейка кубиков в одну сетку (координаты — от оси)
      const parts = []; let nv = 0, ni = 0;
      for (let i = 0; i < n; i++) {
        const b = Vx.blocks[cells[i * 4 + 3] & 0xfff]; if (!b || !Vx.item(b.name)) continue;
        const gq = VR.itemGeo(b.name, 15 << 12); parts.push([gq, cells[i * 4] + .5 - pivot.x, cells[i * 4 + 1] + .5 - pivot.y, cells[i * 4 + 2] + .5 - pivot.z]);
        nv += gq.attributes.position.count; ni += gq.index.count;
      }
      if (!parts.length) return null;
      const pos = new Float32Array(nv * 3), vd = new Uint16Array(nv * 4), cl = new Uint8Array(nv * 3), lt = new Uint8Array(nv * 4), idx = new Uint32Array(ni);
      let ov = 0, oi = 0;
      for (const [gq, dx, dy, dz] of parts) {
        const p = gq.attributes.position.array, m = gq.attributes.position.count;
        for (let k = 0; k < m; k++) { pos[(ov + k) * 3] = p[k * 3] + dx; pos[(ov + k) * 3 + 1] = p[k * 3 + 1] + dy; pos[(ov + k) * 3 + 2] = p[k * 3 + 2] + dz; }
        vd.set(gq.attributes.vd.array, ov * 4); cl.set(gq.attributes.color.array, ov * 3); lt.set(gq.attributes.lt.array, ov * 4);
        const ia = gq.index.array; for (let k = 0; k < ia.length; k++) idx[oi + k] = ia[k] + ov;
        ov += m; oi += ia.length; gq.dispose();
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('vd', new T.BufferAttribute(vd, 4)); geo.setAttribute('color', new T.BufferAttribute(cl, 3, true)); geo.setAttribute('lt', new T.BufferAttribute(lt, 4, false));
      geo.setIndex(new T.BufferAttribute(idx, 1)); geo.computeBoundingSphere();
      const mesh = new T.Mesh(geo, VR.mats?.foliage || VR.mats?.solid); mesh.castShadow = true; mesh.frustumCulled = false; R.scene.add(mesh);
      // центр масс, точки для удара: все стволы (до 48) и самые дальние от оси листья (до 24)
      let hc = 0, far = [];
      for (let i = 0; i < n; i++) { const ry = cells[i * 4 + 1] + .5 - pivot.y; hc += ry; far.push(i); }
      hc = Math.max(1, hc / n);
      const isTrunk = i => o.trunk ? o.trunk(cells[i * 4 + 3]) : true, dist = i => { const rx = cells[i * 4] + .5 - pivot.x, ry = cells[i * 4 + 1] + .5 - pivot.y, rz = cells[i * 4 + 2] + .5 - pivot.z; return rx * rx + ry * ry + rz * rz; };
      const smp = far.filter(isTrunk).slice(0, 48).concat(far.filter(i => !isTrunk(i)).sort((a, b) => dist(b) - dist(a)).slice(0, 24));
      const g = { cells: cells.slice(), n, mesh, geo, px: pivot.x, py: pivot.y, pz: pivot.z, ax: dir.z, az: -dir.x, dx: dir.x, dz: dir.z, th: 0, pth: 0, w: o.push ?? .35, hc, smp: Int32Array.from(smp), done: 0, bounced: false, hitIds: new Set(), lit: Lit.make(null), o, t: 0 };
      groups.push(g);
      S.AU?.play('kb_creak', { x: pivot.x - S.ox, y: pivot.y + 2, z: pivot.z - S.oz, vol: .7, rate: .9 + FR() * .2 });
      return g;
    };
    const solidHit = (x, y, z) => { const v = W.raw(x, y, z); if (v < 0) return true; if (!(v > 0)) return false; const t = v & 0xfff, Tt = V().T; return Tt.solid[t] === 1 && Tt.shape[t] !== V().SHAPE.cross; };
    function groupsTick(dt){
      for (let gi = groups.length - 1; gi >= 0; gi--) {
        const g = groups[gi];
        g.pth = g.th; g.t += dt;
        if (g.done) { g.done += dt; if (g.done > .3) { landGroup(g); groups.splice(gi, 1); } continue; }
        g.w += 9.8 * 1.5 / g.hc * Math.sin(Math.max(.12, g.th)) * dt;
        const nth = g.th + g.w * dt;
        let hit = nth >= 1.62;   // лёг совсем (чуть ниже горизонта — склон)
        for (let k = 0; k < g.smp.length && !hit; k++) {
          const i = g.smp[k], p = rot(g, g.cells[i * 4] + .5 - g.px, g.cells[i * 4 + 1] + .5 - g.py, g.cells[i * 4 + 2] + .5 - g.pz, nth);
          if (solidHit(p.x, p.y - .45, p.z)) hit = true;
        }
        if (hit) {
          if (!g.bounced && g.w > .9) { g.bounced = true; g.w = -g.w * .22; S.AU?.play('kb_thud', { x: g.px - S.ox, y: g.py + 1, z: g.pz - S.oz, vol: .8, rate: .95 }); }
          else { g.done = 1e-6; g.w = 0; }
          continue;
        }
        g.th = Math.max(0, nth);
        // под деревом моб или игрок — толкнуть в сторону падения (урон — только «обычно» / «сложно»)
        const hurtK = S.meta?.diff === 'normal' || S.meta?.diff === 'hard' ? 2 : 0;
        for (let k = 0; k < g.smp.length; k++) {
          const i = g.smp[k], p = rot(g, g.cells[i * 4] + .5 - g.px, g.cells[i * 4 + 1] + .5 - g.py, g.cells[i * 4 + 2] + .5 - g.pz, g.th);
          for (const m of X.mobs) {
            const M = MOBS[m.type]; if (g.hitIds.has(m.id) || Math.abs(m.x - p.x) > M.w / 2 + .5 || Math.abs(m.z - p.z) > M.w / 2 + .5 || p.y < m.y - .3 || p.y > m.y + M.h + .3) continue;
            g.hitIds.add(m.id); m.vx += g.dx * 5; m.vz += g.dz * 5; m.vy = Math.max(m.vy, 4); if (hurtK) X.damage(m, hurtK, g.dx, g.dz, 'tree'); else m.hurtT = .35;
          }
          const P = S.P;
          if (P && !P.dead && !g.hitIds.has(-1) && Math.abs(P.x - p.x) < .8 && Math.abs(P.z - p.z) < .8 && p.y > P.y - .3 && p.y < P.y + 2.1) {
            g.hitIds.add(-1); P.vx += g.dx * 6; P.vz += g.dz * 6; P.vy = Math.max(P.vy, 4.5); P.onGround = false;
            if (hurtK && !S.creative) S.ents?.hookHurt?.(hurtK, { x: g.px, y: g.py, z: g.pz });
          }
        }
      }
    }
    // лёг: пыль, листья, стук — и на вещи (o.onLand); сетка убрана
    function landGroup(g){
      const n = g.n, Vx = V();
      for (let i = 0; i < n; i++) {
        const p = rot(g, g.cells[i * 4] + .5 - g.px, g.cells[i * 4 + 1] + .5 - g.py, g.cells[i * 4 + 2] + .5 - g.pz, g.th), v = g.cells[i * 4 + 3], x = p.x, y = p.y, z = p.z;
        g.o.onLand?.(v, x, y, z, i);
        if ((i & 1) === 0) { const b = Vx.blocks[v & 0xfff]; if (g.o.trunk?.(v)) X.dust(x, Math.floor(y - .3) + 1, z, v & 0xfff, 2, { w: .8, sp: 1, s: .25, s1: .6, a: .45, vy: .4 }); else if (b) X.debris(Math.floor(x), Math.floor(y), Math.floor(z), b.id, 3); }
      }
      S.AU?.play('kb_thud', { x: g.px - S.ox, y: g.py + 1, z: g.pz - S.oz, vol: 1, rate: .8 });
      R.scene.remove(g.mesh); g.geo.dispose();
    }
    function groupsFrame(dt, a){
      for (const g of groups) {
        const th = g.pth + (g.th - g.pth) * a;
        GA.set(g.ax, 0, g.az); GQ.setFromAxisAngle(GA, th);
        g.mesh.quaternion.copy(GQ); g.mesh.position.set(g.px - S.ox, g.py, g.pz - S.oz);
        const c = rot(g, 0, g.hc, 0, th); Lit.update(g.lit, S, c.x, c.y, c.z, dt); VR.itemLightF(g.geo, g.lit.lv);
      }
    }
    // Дерево: сломал бревно — стволы над ним (только брёвна, связь по 6 соседям, до 48) не касаются ничего твёрдого, кроме
    // листвы (земля, доски, камень рядом — «держится» или постройка: как в Майнкрафте, ничего не падает), листва вокруг (до 4 шагов
    // от стволов, не меньше 3 листьев) — и всего не больше 220 блоков. Тогда всё это убирается из мира (обычные правки — сохранятся)
    // и валится от игрока одной сеткой; легло — брёвна вещами (каждое), из листвы — ростки, палки, яблоки по случаю
    let LOGF = null, LEAFF = null, flagsN = 0;
    function treeFlags(){ const Vx = V(); if (LOGF && flagsN === Vx.blocks.length) return; flagsN = Vx.blocks.length; LOGF = new Uint8Array(flagsN); LEAFF = new Uint8Array(flagsN); for (const b of Vx.blocks) { if (/^log_/.test(b.name)) LOGF[b.id] = 1; else if (/^leaves_/.test(b.name)) LEAFF[b.id] = 1; } }
    X.fellTree = (x, y, z, P) => {
      if (groups.length >= 3) return null;
      treeFlags();
      const Vx = V(), Tt = Vx.T, up = W.raw(x, y + 1, z);
      if (!(up > 0) || !LOGF[up & 0xfff]) return null;
      const soft = t => !Tt.solid[t] || LEAFF[t] || Tt.liquid[t] || Tt.shape[t] === Vx.SHAPE.cross || Tt.shape[t] === Vx.SHAPE.torch;
      const C = Vx.component(W, [[x, y + 1, z]], { take: v => LOGF[v & 0xfff] === 1, edge: v => (v < 0 ? 2 : v === 0 || soft(v & 0xfff) ? 0 : 2), max: 48 });
      if (!C || C.touch || C.grounded) return null;
      const inC = new Set(); for (let i = 0; i < C.cells.length; i += 4) inC.add(Vx.supportKey(C.cells[i], C.cells[i + 1], C.cells[i + 2]));
      const seeds = []; for (let i = 0; i < C.cells.length; i += 4) seeds.push([C.cells[i], C.cells[i + 1], C.cells[i + 2]]);
      const Lf = Vx.component(W, seeds, { take: (v, a, b, c) => LEAFF[v & 0xfff] === 1 || (LOGF[v & 0xfff] === 1 && inC.has(Vx.supportKey(a, b, c))), depth: 4, max: 220 });
      if (!Lf) return null;
      const leaves = Lf.n - C.n;
      if (leaves < 3) return null;   // голый столб из брёвен — не дерево
      const cells = Lf.cells;
      for (let i = 0; i < cells.length; i += 4) W.set(cells[i], cells[i + 1], cells[i + 2], 0, { urgent: 2 });
      // куда валится: от игрока (по горизонтали); игрок прямо у ствола — по взгляду
      let dx = x + .5 - (P ? P.x : x), dz = z + .5 - (P ? P.z : z), dl = Math.hypot(dx, dz);
      if (dl < .2) { dx = 1; dz = 0; dl = 1; }
      dx /= dl; dz /= dl;
      const sap = n => 'sapling_' + n.slice(7);
      return X.fallGroup(cells, { x: x + .5 + dx * .5, y: y + 1, z: z + .5 + dz * .5 }, { x: dx, z: dz }, {
        trunk: v => LOGF[v & 0xfff] === 1,
        onLand: (v, wx, wy, wz) => {
          const b = Vx.blocks[v & 0xfff], r = X.rng();
          if (LOGF[b.id]) { X.addItem(wx, wy, wz, { id: b.drop || b.name, n: 1 }); return; }
          if (r < .05 && Vx.item(sap(b.name))) X.addItem(wx, wy, wz, { id: sap(b.name), n: 1 });
          else if (r < .07) X.addItem(wx, wy, wz, { id: 'stick', n: 1 });
          else if (r < .08 && b.name === 'leaves_oak') X.addItem(wx, wy, wz, { id: 'apple', n: 1 });
        },
      });
    };

    // ═══ Мобы ═══
    // как моб рисуется — одно место: view (по умолчанию коробки — boxMobView ниже; KubomirEnts.mobView — свой вид);
    // свет — m.lit (Lit, тот же, что у кубиков), удар — m.hurtT, замах — m.wind, выпад — m.lunge, смерть — m.dying (с с начала);
    // место для рисования (между тактами, плавно) — m.rx / ry / rz / ryaw / rwalk
    const view = (window.KubomirEnts.mobView || boxMobView)({ T, R, VR, MOBS });
    X.view = view;
    X.spawn = (type, x, y, z, o = {}) => {
      if (!MOBS[type] || X.mobs.length >= 60) return null;
      const M = MOBS[type], id = ++X.seq;
      const m = { id, type, x, y, z, vx: 0, vy: 0, vz: 0, yaw: o.yaw ?? X.rng() * 6.28, hp: o.hp ?? M.hp, ground: false, walk: 0, state: 'idle', stT: 0, tgtYaw: 0, hurtT: 0, atkT: 0, flee: 0, hopT: 0, lit: Lit.make(T), sndT: 4 + X.rng() * 10, rng: V().rng(V().hash(W.seed, id, now() | 0)), burnT: 0, age: 0, wind: 0, lunge: 0, dying: 0, quiet: !!o.quiet };
      m.px = m.rx = x; m.py = m.ry = y; m.pz = m.rz = z; m.pyaw = m.ryaw = m.yaw; m.pwalk = m.rwalk = 0;
      window.D37E?.combat?.init(m, M.cb || CB_DEF);   // поля боя прямо в мобе: неуязвимость, стойкость, оглушение
      Lit.update(m.lit, S, x, y + M.h * .6, z, 0);
      view.add(m);
      X.mobs.push(m);
      if (!o.quiet) X.smoke(x, y + M.h * .35, z, 8, Math.max(M.w, .6));   // появился — облачком
      return m;
    };
    function removeMob(m){ const i = X.mobs.indexOf(m); if (i >= 0) X.mobs.splice(i, 1); view.remove(m); }
    // смерть: из мобов (не думает, не мешает, по нему не бьют) — в «падающие»: заваливается набок, белеет и сжимается,
    // через 0,62 с — «пуф» (облачко и звук), через 0,9 с — исчезает
    const DIE_T = .9, POOF_T = .62;
    function dieMob(m){ const i = X.mobs.indexOf(m); if (i >= 0) X.mobs.splice(i, 1); m.dying = 1e-4; m.wind = 0; m.lunge = 0; X.dying.push(m); }
    // res — итог удара ядра боя (CB.hit / CB.receive): отброс по оружию и силе, замах сбивает только оглушение (сильный удар);
    // без него — как раньше (любой удар сбивает замах, отброс 6)
    X.damage = (m, dmg, nx, nz, by, res) => {
      if (m.hp <= 0) return;
      m.hp -= dmg; m.hurtT = .35;
      if (res) { if (res.stagger) m.wind = 0; m.vx += res.kx; m.vz += res.kz; m.vy = Math.max(m.vy, res.ky); }
      else { m.wind = 0; m.vx += nx * 6; m.vz += nz * 6; m.vy = Math.max(m.vy, 4.5); }   // удар сбивает замах
      S.AU?.play(MOBS[m.type].snd, { x: m.x - S.ox, y: m.y + 1, z: m.z - S.oz, vol: .6, rate: 1.15 });
      if (MOBS[m.type].passive) { m.flee = 4; }
      if (m.hp <= 0) {
        for (const [id, a, b] of MOBS[m.type].drops) { const n = a + Math.floor(m.rng() * (b - a + 1)); if (n > 0) X.addItem(m.x, m.y + .5, m.z, { id, n }); }
        if (m.type === 'zombie' && by === 'player') S.ents.hookUnlock?.('zombie');
        X.hookKill?.(m, by);   // моды: событие mobKill
        dieMob(m);
      }
    };
    // падающие после смерти: долетают по инерции (отброс от последнего удара), без мозгов
    function dyingTick(dt){
      for (const m of X.dying) {
        const M = MOBS[m.type];
        m.px = m.x; m.py = m.y; m.pz = m.z; m.pyaw = m.yaw; m.pwalk = m.walk;
        m.vy = Math.max(-40, m.vy - 30 * dt);
        if (m.ground) { const f = Math.exp(-dt * 6); m.vx *= f; m.vz *= f; }
        MB.x = m.x; MB.y = m.y; MB.z = m.z; MB.w = M.w; MB.h = M.h;
        const vy0 = m.vy;
        V().moveBox(W, MB, m.vx * dt, m.vy * dt, m.vz * dt);
        m.ground = MB.hitY && vy0 <= 0; if (MB.hitY) m.vy = 0; if (MB.hitX) m.vx = 0; if (MB.hitZ) m.vz = 0;
        m.x = MB.x; m.y = MB.y; m.z = MB.z;
      }
    }
    // луч: первый моб на отрезке (коробка моба)
    X.rayMob = (ox, oy, oz, dx, dy, dz, maxT) => {
      let best = null, bt = maxT;
      for (const m of X.mobs) {
        const M = MOBS[m.type], hw = M.w / 2;
        const h = V().rayBox(ox - (m.x - hw), oy - m.y, oz - (m.z - hw), dx, dy, dz, [0, 0, 0, M.w, M.h, M.w]);
        if (h && h.t < bt) { bt = h.t; best = m; }
      }
      return best;
    };
    X.blocked = (x, y, z) => X.mobs.some(m => { const M = MOBS[m.type], hw = M.w / 2; return m.x + hw > x && m.x - hw < x + 1 && m.z + hw > z && m.z - hw < z + 1 && m.y + M.h > y && m.y < y + 1; });

    // ═══ Стрелы (лук игрока): летят дугой (тяжесть 20, лёгкое сопротивление), попали в блок — торчат (подобрать — пройти рядом,
    // лежат 60 с), в моба — урон и отброс через ядро боя (неуязвимость моба, стойкость) и исчезают. Все стрелы — одна сетка
    // (InstancedMesh, до 48), свет — по клетке (раз в такт), между тактами — плавно (X.frac) ═══
    const AN = 48, arrows = X.arrows = [];
    const aGeo = arrowGeo(T), aMat = new T.MeshBasicMaterial({ vertexColors: true });   // свет — цветом экземпляра (как у осколков)
    const aMesh = new T.InstancedMesh(aGeo, aMat, AN);
    aMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    aMesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(AN * 3), 3); aMesh.instanceColor.setUsage(T.DynamicDrawUsage);
    aMesh.count = 0; aMesh.visible = false; aMesh.frustumCulled = false; R.scene.add(aMesh);
    const AOUT = { dmg: 0, kb: 0, poise: 0, guardBreak: 0 }, AQ = new T.Quaternion(), AV = new T.Vector3(), AZ = new T.Vector3(0, 0, 1);
    const ARR_PICK = t => V().T.solid[t] === 1;
    // x, y, z — откуда (мир), v — скорость (блоков/с), dmg — урон, o: { pick — можно подобрать (выживание), crit — полная натяжка }
    X.shoot = (x, y, z, vx, vy, vz, dmg, o) => {
      if (arrows.length >= AN) { let k = arrows.findIndex(a => a.stuck); if (k < 0) k = 0; arrows.splice(k, 1); }
      const a = { x, y, z, px: x, py: y, pz: z, vx, vy, vz, dx: 0, dy: 0, dz: 1, dmg, stuck: false, age: 0, pick: !!o?.pick, crit: !!o?.crit, r: 1, g: 1, b: 1 };
      const l = Math.hypot(vx, vy, vz) || 1; a.dx = vx / l; a.dy = vy / l; a.dz = vz / l;
      arrows.push(a);
      return a;
    };
    function arrowsTick(dt){
      if (!arrows.length) return;
      const P = S.P, Vx = V();
      for (let i = arrows.length - 1; i >= 0; i--) {
        const a = arrows[i];
        a.px = a.x; a.py = a.y; a.pz = a.z; a.age += dt;
        if (a.stuck) {
          if (a.age > 60 || !W.loaded(a.x, a.z)) { arrows.splice(i, 1); continue; }
          if (a.pick && !P.dead && Math.abs(P.x - a.x) < 1.3 && Math.abs(P.z - a.z) < 1.3 && a.y > P.y - .6 && a.y < P.y + 2.2 && a.age > .5) {
            const left = X.give ? X.give({ id: 'arrow', n: 1 }) : 1;
            if (!left) { S.AU?.play('kb_pop', { vol: .35, rate: 1.2 }); X.hookPickup?.('arrow', 1); arrows.splice(i, 1); continue; }
          }
          if ((X.tickN + i) % 10 === 0) { const L = lightRGB(a.x, a.y, a.z); a.r = L[0]; a.g = L[1]; a.b = L[2]; }
          continue;
        }
        a.vy = Math.max(-40, a.vy - 20 * dt);
        const f = Math.exp(-dt * .3); a.vx *= f; a.vy *= f; a.vz *= f;
        const sp = Math.hypot(a.vx, a.vy, a.vz), len = sp * dt;
        if (len < 1e-6 || a.age > 12 || a.y < -10) { arrows.splice(i, 1); continue; }
        a.dx = a.vx / sp; a.dy = a.vy / sp; a.dz = a.vz / sp;
        const h = Vx.raycast(W, a.x, a.y, a.z, a.dx, a.dy, a.dz, len, ARR_PICK), tB = h ? h.t : len;
        const m = X.rayMob(a.x, a.y, a.z, a.dx, a.dy, a.dz, tB);
        if (m) {
          const C = CBK(), M = MOBS[m.type];
          AOUT.dmg = a.dmg; AOUT.kb = 3 + 3 * Math.min(1, sp / 30); AOUT.poise = a.crit ? 1.2 : .6; AOUT.guardBreak = 0;
          if (C && m.cf) C.receive(m, AOUT, a.x - a.dx, a.z - a.dz, m.x, m.z, null);
          else { AOUT.ignored = 0; AOUT.kx = a.dx * AOUT.kb; AOUT.kz = a.dz * AOUT.kb; AOUT.ky = 2.5; AOUT.stagger = 0; }
          if (!AOUT.ignored) {
            X.damage(m, AOUT.dmg, a.dx, a.dz, 'player', AOUT);
            X.glow('spark', a.x + a.dx * tB, a.y + a.dy * tB, a.z + a.dz * tB, a.crit ? 6 : 3);
            S.AU?.play('kb_arrow', { x: m.x - S.ox, y: m.y + M.h * .6, z: m.z - S.oz, vol: .6, rate: 1.2 });
            arrows.splice(i, 1); continue;
          }
        }
        if (h) {
          a.x += a.dx * Math.max(0, h.t - .12); a.y += a.dy * Math.max(0, h.t - .12); a.z += a.dz * Math.max(0, h.t - .12);
          a.stuck = true; a.age = 0; a.vx = a.vy = a.vz = 0;
          const L = lightRGB(a.x, a.y, a.z); a.r = L[0]; a.g = L[1]; a.b = L[2];
          S.AU?.play('kb_arrow', { x: a.x - S.ox, y: a.y, z: a.z - S.oz, vol: .45 });
          X.shards(h.x, h.y, h.z, h.v & 0xfff, 2, (HF.nx = h.nx, HF.ny = h.ny, HF.nz = h.nz, HF));
          continue;
        }
        a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
        if ((X.tickN + i) % 4 === 0) { const L = lightRGB(a.x, a.y, a.z); a.r = L[0]; a.g = L[1]; a.b = L[2]; }
        if (a.crit && (X.tickN & 1)) X.glow('spark', a.x, a.y, a.z, 1);   // полная натяжка — искры за стрелой
      }
    }
    function arrowsFrame(al){
      let k = 0;
      for (let i = 0; i < arrows.length; i++) {
        const a = arrows[i], q = a.stuck ? 1 : al;
        AV.set(a.dx, a.dy, a.dz); AQ.setFromUnitVectors(AZ, AV);
        DUM.position.set(a.px + (a.x - a.px) * q - S.ox, a.py + (a.y - a.py) * q, a.pz + (a.z - a.pz) * q - S.oz);
        DUM.quaternion.copy(AQ); DUM.scale.set(1, 1, 1); DUM.updateMatrix();
        aMesh.setMatrixAt(k, DUM.matrix); aMesh.instanceColor.setXYZ(k, a.r, a.g, a.b); k++;
      }
      aMesh.count = k; aMesh.visible = k > 0;
      if (k) { aMesh.instanceMatrix.needsUpdate = true; aMesh.instanceColor.needsUpdate = true; }
    }
    const MB = { x: 0, y: 0, z: 0, w: 1, h: 1, hitX: false, hitY: false, hitZ: false }, TC = {};
    function mobsTick(dt){
      const P = S.P, Vx = V(), night = isNight();
      for (let i = X.mobs.length - 1; i >= 0; i--) {
        const m = X.mobs[i], M = MOBS[m.type];
        m.px = m.x; m.py = m.y; m.pz = m.z; m.pyaw = m.yaw; m.pwalk = m.walk;   // откуда рисовать плавно до нового места
        m.age += dt; m.lunge = Math.max(0, m.lunge - dt);
        const dxp = P.x - m.x, dzp = P.z - m.z, dp = Math.hypot(dxp, dzp);
        // далеко — исчезает (враги) или замирает (звери)
        if (!M.passive && (dp > 72 || (S.meta.diff === 'peaceful'))) { removeMob(m); continue; }
        // враги вдали (или глубоко по высоте) понемногу исчезают — освобождают место ближним
        if (!M.passive && (dp > 40 || Math.abs(P.y - m.y) > 28) && m.age > 20 && m.rng() < dt / 25) { removeMob(m); continue; }
        if (dp > (S.ST.rd * 16 + 24)) { if (!M.passive || dp > S.ST.rd * 16 + 48) removeMob(m); continue; }
        if (!W.loaded(m.x, m.z) || !W.loaded(m.x + 8, m.z) || !W.loaded(m.x - 8, m.z)) continue;
        m.hurtT = Math.max(0, m.hurtT - dt); m.atkT -= dt; m.sndT -= dt;
        if (m.cf) CBK().step(m, dt);   // бой: неуязвимость, оглушение, стойкость — по тактам
        Vx.touching(W, m.x, m.y, m.z, M.w, M.h, TC);
        const inWater = TC.water > .4;
        // мозги
        let wx = 0, wz = 0, sp = M.speed;
        const hostile = !M.passive && !S.creative && !P.dead && S.meta.diff !== 'peaceful';
        if (m.stag > 0) {   // оглушён (отбили щитом или сбили с ног сильным ударом): не бьёт, топчется, над головой — звёздочки
          m.wind = 0; m.state = 'stag';
          if ((m.dzT = (m.dzT || 0) - dt) <= 0) { m.dzT = .2; X.glow('star', m.x, m.y + M.h + .25, m.z, 1); }
        } else if (hostile && dp < 18 && Math.abs(P.y - m.y) < 8) {
          wx = dxp / (dp || 1); wz = dzp / (dp || 1); m.state = 'chase';
          // удар: замах (видно, что сейчас ударит) → выпад; отошёл за время замаха — промах
          const reach = M.w / 2 + .75, near = Math.abs(P.y + .9 - (m.y + M.h / 2)) < 1.6;
          if (m.wind > 0) {
            m.wind -= dt; wx *= .25; wz *= .25;
            if (m.wind <= 0) {
              m.wind = 0; m.lunge = .22;
              if (dp < reach + .55 && near) { m.atkT = .6; const D = DIFF[S.meta.diff] || DIFF.easy; X.hits = (X.hits || 0) + 1; S.ents.hookHurt?.(Math.max(1, Math.round(M.dmg * D.dmg)), m); }
              else m.atkT = .45;
              const ux = dxp / (dp || 1), uz = dzp / (dp || 1);
              if (M.hop) { if (m.ground) { m.vy = 6.5; m.vx = ux * 4.2; m.vz = uz * 4.2; m.ground = false; m.hopT = .9; } }
              else { m.vx += ux * 2.2; m.vz += uz * 2.2; }
            }
          } else if (dp < reach && near && m.atkT <= 0) m.wind = M.wind || .35;
        } else if (m.flee > 0) {
          m.flee -= dt; wx = -dxp / (dp || 1); wz = -dzp / (dp || 1); sp *= 1.8; m.state = 'flee'; m.wind = 0;
        } else {
          m.wind = 0; if (m.state === 'chase') m.state = 'idle';
          m.stT -= dt;
          if (m.stT <= 0) { m.state = m.rng() < .45 ? 'walk' : 'idle'; m.stT = 2 + m.rng() * 5; m.tgtYaw = m.rng() * 6.283; }
          if (m.state === 'walk') { wx = Math.sin(m.tgtYaw); wz = Math.cos(m.tgtYaw); sp *= .55; }
        }
        // обрыв впереди (больше 3 блоков) — звери не идут
        if ((wx || wz) && M.passive && m.ground) {
          const fx = Math.floor(m.x + wx * 1.2), fz = Math.floor(m.z + wz * 1.2);
          let drop = 0; for (let y = Math.floor(m.y) - 1; y > Math.floor(m.y) - 5; y--) { const v = W.raw(fx, y, fz); if (v !== 0) break; drop++; }
          if (drop >= 3) { wx = wz = 0; m.stT = 0; }
        }
        // застрял (упёрся и стоит) — обойти: шаг вбок на 0,8 с
        if (m.side > 0) { m.side -= dt; const s2 = m.sideDir; const ox = wx; wx = -wz * s2; wz = ox * s2; }
        else if ((wx || wz) && m.blockedT > .7) { m.side = .8; m.sideDir = m.rng() < .5 ? 1 : -1; m.blockedT = 0; }
        // слизень — прыжками
        if (M.hop) { m.hopT -= dt; if (m.ground && m.hopT <= 0 && (wx || wz)) { m.vy = 7.5; m.vx = wx * sp; m.vz = wz * sp; m.hopT = .8 + m.rng() * .8; m.ground = false; } if (m.ground) { m.vx *= .7; m.vz *= .7; } }
        else { const k = 1 - Math.exp(-dt * (m.ground ? 10 : 2)); m.vx += (wx * sp - m.vx) * k; m.vz += (wz * sp - m.vz) * k; }
        if (wx || wz) m.yaw = angTo(m.yaw, Math.atan2(wx, wz), dt * 8);
        // вода — всплывают
        if (inWater) { m.vy = Math.min(m.vy + 24 * dt, 2); } else m.vy = Math.max(-40, m.vy - 30 * dt);
        MB.x = m.x; MB.y = m.y; MB.z = m.z; MB.w = M.w; MB.h = M.h;
        const vy0 = m.vy;
        Vx.moveBox(W, MB, m.vx * dt, m.vy * dt, m.vz * dt);
        // всплыл подо льдом — проломил (как игрок: подо льдом не запереть; прорубь и звук — игра, hookIce)
        if (inWater && Vx.iceTest && m.vy > 0) { const hw = M.w / 2, by = Math.floor(MB.y + M.h - .05); for (let bx = Math.floor(MB.x - hw); bx <= Math.floor(MB.x + hw); bx++) for (let bz = Math.floor(MB.z - hw); bz <= Math.floor(MB.z + hw); bz++) { const v = W.raw(bx, by, bz); if (v > 0 && Vx.T.liquid[v & 0xfff] === 1 && MB.y < by + Vx.liquidHeight(v) - .02 && Vx.isIce(W, bx, by, bz, v)) X.hookIce?.(bx, by, bz); } }
        // упёрся в ступеньку — прыжок
        if ((MB.hitX || MB.hitZ) && m.ground && !M.hop && (wx || wz)) m.vy = 8.2;
        m.ground = MB.hitY && vy0 <= 0; if (MB.hitY) m.vy = 0;
        if ((MB.hitX || MB.hitZ) && Math.hypot(MB.x - m.x, MB.z - m.z) < sp * dt * .3) m.blockedT = (m.blockedT || 0) + dt; else m.blockedT = Math.max(0, (m.blockedT || 0) - dt);
        m.x = MB.x; m.y = MB.y; m.z = MB.z;
        if (m.y < -10) { removeMob(m); continue; }
        m.walk += Math.hypot(m.vx, m.vz) * dt * 3.2;
        // зомби горят на солнце
        if (M.burns && !night) { const L = W.lightAt(m.x, m.y + M.h, m.z); if (V().lSky(L) >= 13) { m.burnT += dt; if (m.burnT > 1) { m.burnT = 0; X.glow('flame', m.x, m.y + .4, m.z, nq(5)); X.smoke(m.x, m.y + M.h, m.z, 2, .4, SOOT, .55, .5); X.damage(m, 2, 0, 0, 'sun'); if (m.hp <= 0) continue; } } }
        if (TC.lava > .1 || TC.hurt >= 4) X.damage(m, 4 * dt * 5, 0, 0, 'lava');
        if (m.sndT <= 0) { m.sndT = 6 + m.rng() * 14; if (dp < 20) S.AU?.play(M.snd, { x: m.x - S.ox, y: m.y + 1, z: m.z - S.oz, vol: .5, rate: .9 + m.rng() * .2 }); }
      }
    }
    // свет моба — плавно, по месту груди (дальние, дальше 32 блоков, — раз в 4 кадра); место — между тактами (a = X.frac); рисует view
    let mN = 0;
    function place(m, a){ m.rx = m.px + (m.x - m.px) * a; m.ry = m.py + (m.y - m.py) * a; m.rz = m.pz + (m.z - m.pz) * a; m.ryaw = lerpA(m.pyaw, m.yaw, a); m.rwalk = m.pwalk + (m.walk - m.pwalk) * a; }
    function mobsFrame(dt, t, a){
      mN++;
      const P = S.P;
      for (let i = 0; i < X.mobs.length; i++) {
        const m = X.mobs[i], M = MOBS[m.type], far = Math.abs(m.x - P.x) > 32 || Math.abs(m.z - P.z) > 32;
        if (!far || !((mN + i) & 3)) Lit.update(m.lit, S, m.x, m.y + M.h * .6, m.z, far ? dt * 4 : dt);
        place(m, a);
        view.frame(m, dt, t, S);
      }
      for (let i = X.dying.length - 1; i >= 0; i--) {
        const m = X.dying[i], M = MOBS[m.type], was = m.dying;
        m.dying += Math.min(dt, .05);
        place(m, a);
        if (was < POOF_T && m.dying >= POOF_T) { X.smoke(m.x, m.y + M.h * .25, m.z, 14, Math.max(M.w, M.h * .55)); S.AU?.play('kb_poof', { x: m.x - S.ox, y: m.y + .5, z: m.z - S.oz, vol: .55, rate: .9 + FR() * .2 }); }
        if (m.dying >= DIE_T) { X.dying.splice(i, 1); view.remove(m); continue; }
        view.frame(m, dt, t, S);
      }
    }
    function isNight(){ const t = S.R.lighting.time; return t < 5.6 || t > 18.8; }
    X.isNight = isNight;
    // появление: звери — днём на траве при свете, враги — ночью и в темноте
    function spawnTick(){
      const P = S.P, Vx = V(), night = isNight(), r = X.rng;
      // считаем тех, кто рядом по высоте (зомби глубоко в пещерах не мешают появляться наверху)
      let passive = 0, hostile = 0;
      for (const m of X.mobs) { if (Math.abs(m.y - P.y) > 20) continue; if (MOBS[m.type].passive) passive++; else hostile++; }
      const tryAt = (minD, maxD) => {
        const a = r() * 6.283, d = minD + r() * (maxD - minD), x = Math.floor(P.x + Math.cos(a) * d), z = Math.floor(P.z + Math.sin(a) * d);
        if (!W.loaded(x, z)) return null;
        return { x, z };
      };
      if (passive < 10 && r() < .5) {
        const q = tryAt(20, 44);
        if (q) {
          const h = W.heightAt(q.x, q.z), top = W.get(q.x, h - 1, q.z);
          if (h > 0 && (top === Vx.ID.grass || top === Vx.ID.snow_grass) && W.get(q.x, h, q.z) === 0 && W.get(q.x, h + 1, q.z) === 0 && (Vx.lSky(W.lightAt(q.x, h, q.z)) >= 9)) {
            const type = ['cow', 'cow', 'pig', 'pig', 'chicken'][Math.floor(r() * 5)], n = 1 + Math.floor(r() * 3);
            for (let k = 0; k < n; k++) X.spawn(type, q.x + .5 + (r() - .5) * 2, h + .01, q.z + .5 + (r() - .5) * 2);
          }
        }
      }
      const D = DIFF[S.meta.diff] || DIFF.easy;
      X.hostT = (X.hostT ?? D.every) - 2;   // spawnTick — раз в 2 с; врагам — раз в D.every с
      if (X.hostT <= 0 && hostile < D.cap && !S.creative) {
        X.hostT = D.every;
        const q = tryAt(16, 40);
        if (q) {
          // ищем пол со светом ≤ 6 (ночью — и под открытым небом)
          const h = W.heightAt(q.x, q.z);
          for (let y = Math.min(h + 1, V().H - 3); y > 2; y -= 1 + Math.floor(r() * 3)) {
            const f = W.get(q.x, y - 1, q.z), a = W.get(q.x, y, q.z), b = W.get(q.x, y + 1, q.z);
            if (f <= 0 || !Vx.T.solid[f] || Vx.T.shape[f] !== 1 || a !== 0 || b !== 0) continue;
            const L = W.lightAt(q.x, y, q.z), sky = Vx.lSky(L) * (night ? .25 : 1), lit = Math.max(sky, Vx.lBlk(L));
            if (lit > 6) continue;
            if (Math.abs(y - P.y) > 24) continue;
            X.spawn(r() < .8 ? 'zombie' : 'slime', q.x + .5, y + .01, q.z + .5);
            break;
          }
        }
      }
    }

    // ═══ Вода, лава, песок: обновление клеток по расписанию ═══
    function schedule(x, y, z, delay){
      const k = x + ',' + y + ',' + z;
      if (X.upd.has(k)) return;
      X.upd.set(k, X.tickN + delay);
      X.updQ.push([x, y, z, X.tickN + delay, k]);
    }
    X.onBlockChanged = (x, y, z, was, v) => {
      const Vx = V(), T = Vx.T;
      for (const [dx, dy, dz] of N6) {
        const nx = x + dx, ny = y + dy, nz = z + dz, nv = W.raw(nx, ny, nz); if (nv <= 0) continue;
        const nt = nv & 0xfff;
        if (T.liquid[nt]) schedule(nx, ny, nz, T.liquid[nt] === 2 ? 30 : 5);
        else if (Vx.blocks[nt].fall && dy === 1) schedule(nx, ny, nz, 2);
        else if (dy === 1 && (T.shape[nt] === Vx.SHAPE.cross || T.shape[nt] === Vx.SHAPE.torch) && !(W.get(x, y, z) > 0 && T.solid[W.get(x, y, z)])) schedule(nx, ny, nz, 1);   // растение/факел без опоры
      }
      const t = v & 0xfff;
      if (T.liquid[t]) schedule(x, y, z, T.liquid[t] === 2 ? 30 : 5);
      if (Vx.blocks[t]?.fall) schedule(x, y, z, 2);
      if (t === Vx.ID.furnace_lit || t === Vx.ID.furnace) X.furnaces.add(x + ',' + y + ',' + z);
    };
    const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    function updatesTick(){
      let n = 0;
      // готовые по времени (очередь не сортирована — проходим и оставляем будущие)
      const q = X.updQ, keep = [];
      for (let i = 0; i < q.length; i++) {
        const u = q[i];
        if (u[3] > X.tickN || n >= 400) { keep.push(u); continue; }
        X.upd.delete(u[4]); n++;
        try { cellUpdate(u[0], u[1], u[2]); } catch (e) { console.error(e); }
      }
      X.updQ = keep;
    }
    const replaceable = v => v === 0 || (v > 0 && V().blocks[v & 0xfff].replace && !V().T.liquid[v & 0xfff]);
    function cellUpdate(x, y, z){
      const Vx = V(), T = Vx.T, ID = Vx.ID, v = W.raw(x, y, z); if (v <= 0) return;
      const t = v & 0xfff, b = Vx.blocks[t];
      // песок и гравий падают
      // под ним не твёрдое (воздух, вода, трава, факел, цветок) — падает
      if (b.fall) { const bv = W.raw(x, y - 1, z); if (bv === 0 || (bv > 0 && !T.solid[bv & 0xfff])) startFall(x, y, z, v); return; }
      // растение или факел без опоры — выпадает
      if (T.shape[t] === Vx.SHAPE.cross || (T.shape[t] === Vx.SHAPE.torch && (v >>> 12) === 0)) {
        const bv = W.get(x, y - 1, z);
        if (!(bv > 0 && T.solid[bv])) { W.set(x, y, z, 0); if (b.drop && Vx.item(b.drop)) X.addItem(x + .5, y + .2, z + .5, { id: b.drop, n: 1 }); }
        return;
      }
      if (!T.liquid[t]) return;
      const lava = T.liquid[t] === 2, st = v >>> 12, lvl = st & 7, falling = st & 8, step = lava ? 2 : 1, maxL = lava ? 6 : 7;
      // встреча воды и лавы
      for (const [dx, dy, dz] of N6) {
        const nv = W.raw(x + dx, y + dy, z + dz); if (nv <= 0) continue;
        const nt = nv & 0xfff;
        if (lava && T.liquid[nt] === 1) { W.set(x, y, z, V().cell(lvl === 0 && !falling ? ID.obsidian : ID.cobble)); S.AU?.play('kb_pop', { x: x - S.ox, y, z: z - S.oz, vol: .3, rate: .6 }); X.debris(x, y, z, 0, 8, [.5, .5, .5]); X.smoke(x + .5, y + .9, z + .5, 5, .8, STEAM, .7); return; }
      }
      // течение (не источник): есть ли подпитка
      if (lvl !== 0 || falling) {
        const above = W.raw(x, y + 1, z);
        let best = 99;
        if (above > 0 && (above & 0xfff) === t) best = 0;   // сверху льётся — падающая
        else for (const [dx, dz] of N4) {
          const nv = W.raw(x + dx, y, z + dz); if (nv <= 0 || (nv & 0xfff) !== t) continue;
          const ns = nv >>> 12, nl = ns & 8 ? 0 : ns & 7;
          // течение сбоку — только если сосед стоит на опоре (не висит в воздухе)
          const under = W.raw(x + dx, y - 1, z + dz);
          if ((ns & 8) && under > 0 && (under & 0xfff) === t) continue;
          best = Math.min(best, nl + step);
        }
        // бесконечный источник воды: два источника рядом и опора снизу
        if (!lava) { let src = 0; for (const [dx, dz] of N4) { const nv = W.raw(x + dx, y, z + dz); if (nv > 0 && (nv & 0xfff) === t && (nv >>> 12) === 0) src++; } const un = W.raw(x, y - 1, z); if (src >= 2 && un > 0 && (T.solid[un & 0xfff] || ((un & 0xfff) === t && (un >>> 12) === 0))) best = -1; }
        let ns;
        if (best === -1) ns = 0; else if (best === 0) ns = 8; else if (best <= maxL) ns = best; else ns = -1;
        if (ns === -1) { W.set(x, y, z, 0); return; }
        if (ns !== st) { W.set(x, y, z, V().cell(t, ns)); return; }
      }
      // растекание: вниз, иначе в стороны
      const bv = W.raw(x, y - 1, z);
      if (y > 0 && (replaceable(bv) || (bv > 0 && (bv & 0xfff) === t && ((bv >>> 12) & 7) !== 0 && !((bv >>> 12) & 8)))) { if (bv > 0 && !T.liquid[bv & 0xfff] && Vx.blocks[bv & 0xfff].drop) breakPlant(x, y - 1, z, bv); W.set(x, y - 1, z, V().cell(t, 8)); return; }
      if (bv > 0 && T.liquid[bv & 0xfff] === (lava ? 1 : 2)) { W.set(x, y - 1, z, V().cell(lava ? ID.stone : ID.obsidian)); return; }
      const my = falling ? 0 : lvl;
      if (my + step > maxL) return;
      for (const [dx, dz] of N4) {
        const nx = x + dx, nz = z + dz, nv = W.raw(nx, y, nz);
        if (nv < 0) continue;
        if (replaceable(nv)) { if (nv > 0 && Vx.blocks[nv & 0xfff].drop) breakPlant(nx, y, nz, nv); W.set(nx, y, nz, V().cell(t, my + step)); }
        else if ((nv & 0xfff) === t) { const ns = nv >>> 12; if (!(ns & 8) && (ns & 7) > my + step) W.set(nx, y, nz, V().cell(t, my + step)); }
        else if (lava && T.liquid[nv & 0xfff] === 1) W.set(x, y, z, V().cell(ID.cobble));
      }
    }
    function breakPlant(x, y, z, v){ const b = V().blocks[v & 0xfff]; if (b.drop && V().item(b.drop) && b.hard === 0) X.addItem(x + .5, y + .3, z + .5, { id: b.drop, n: 1 }); }

    // ═══ Случайные такты: трава расползается, ростки растут ═══
    function randomTicks(){
      const P = S.P, Vx = V(), ID = Vx.ID, T = Vx.T, r = X.rng;
      const pcx = Math.floor(P.x) >> 4, pcz = Math.floor(P.z) >> 4;
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        const c = W.chunk(pcx + dx, pcz + dz); if (!c || !c.ready) continue;
        for (let k = 0; k < 3; k++) {
          const lx = Math.floor(r() * 16), lz = Math.floor(r() * 16), y = 1 + Math.floor(r() * (c.maxY || 100));
          const x = c.cx * 16 + lx, z = c.cz * 16 + lz, v = c.ids[(lx << 11) | (lz << 7) | y], t = v & 0xfff;
          if (t === ID.dirt) {   // трава с соседей
            const up = W.get(x, y + 1, z); if (up !== 0 || (V().lSky(W.lightAt(x, y + 1, z)) < 9)) continue;
            for (let q = 0; q < 4; q++) { const nx = x + Math.floor(r() * 3) - 1, ny = y + Math.floor(r() * 3) - 1, nz = z + Math.floor(r() * 3) - 1; if (W.get(nx, ny, nz) === ID.grass) { W.set(x, y, z, ID.grass, { urgent: 0 }); break; } }
          } else if (t === ID.grass) { const up = W.get(x, y + 1, z); if (up > 0 && T.opaque[up]) W.set(x, y, z, ID.dirt, { urgent: 0 }); }
          else if (Vx.blocks[t]?.name.startsWith('sapling_') && r() < .35) growTree(x, y, z, Vx.blocks[t].name.slice(8));
        }
      }
    }
    function growTree(x, y, z, kind){
      const Vx = V(), ID = Vx.ID, n = kind === 'spruce' ? 6 + Math.floor(X.rng() * 3) : 4 + Math.floor(X.rng() * 3);
      for (let k = 1; k < n + 2; k++) { const v = W.get(x, y + k, z); if (v !== 0 && !/^leaves_/.test(Vx.blocks[v]?.name || '')) return; }
      const log = ID['log_' + kind], leaf = ID['leaves_' + kind], top = y + n;
      const set = (a, b, c, v, only) => { const cur = W.get(a, b, c); if (cur === 0 || (only && cur !== v && Vx.blocks[cur]?.replace)) W.set(a, b, c, v, { urgent: 1 }); };
      for (let yy = top - 3; yy <= top; yy++) { const rr = yy >= top - 1 ? 1 : 2; for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) { if (Math.abs(dx) === rr && Math.abs(dz) === rr && X.rng() < .5) continue; set(x + dx, yy, z + dz, leaf, true); } }
      set(x, top + 1, z, leaf, true);
      for (let k = 0; k < n; k++) W.set(x, y + k, z, log, { urgent: 1 });
    }

    // ═══ Печи: топливо, плавка ═══
    function furnaceTick(dt){
      const Vx = V(), ID = Vx.ID;
      for (const k of [...X.furnaces]) {
        const [x, y, z] = k.split(',').map(Number), v = W.raw(x, y, z);
        if (v < 0) continue;
        const t = v & 0xfff;
        if (t !== ID.furnace && t !== ID.furnace_lit) { X.furnaces.delete(k); continue; }
        const f = W.tile(x, y, z, () => ({ in: null, fuel: null, out: null, burn: 0, burnMax: 0, cook: 0 }));
        const rec = f.in && Vx.smelting.get(f.in.id), rn = rec ? rec.n || 1 : 1, outOk = rec && (!f.out || (f.out.id === rec.out && f.out.n + rn <= Vx.item(rec.out).stack));
        if (f.burn > 0) f.burn -= dt;
        if (f.burn <= 0 && outOk && f.fuel && Vx.item(f.fuel.id)?.fuel) { f.burnMax = f.burn = Vx.item(f.fuel.id).fuel * (S.creative ? 1 : 1); f.fuel.n--; if (f.fuel.n <= 0) f.fuel = null; W.markTile(x, z); }
        if (f.burn > 0 && outOk) { f.cook += dt; if (f.cook >= rec.time) { f.cook = 0; f.in.n--; if (f.in.n <= 0) f.in = null; if (f.out) f.out.n += rn; else f.out = { id: rec.out, n: rn }; W.markTile(x, z); if (rec.out === 'iron_ingot') S.ents.hookUnlock?.('iron'); if (rec.out === 'meat_cooked' || rec.out === 'chicken_cooked') S.ents.hookUnlock?.('cook'); } }
        else f.cook = Math.max(0, f.cook - dt * 2);
        const lit = f.burn > 0;
        if (lit !== (t === ID.furnace_lit)) W.set(x, y, z, Vx.cell(lit ? ID.furnace_lit : ID.furnace, v >>> 12), { urgent: 1 });
        if (!lit && !f.in && !f.fuel) X.furnaces.delete(k);
      }
    }

    // ═══ Такт (20 раз в секунду) и кадр ═══
    X.tick = dt => {
      X.tickN++;
      itemsTick(dt);
      fallingTick(dt);
      groupsTick(dt);
      mobsTick(dt);
      arrowsTick(dt);
      dyingTick(dt);
      updatesTick();
      furnaceTick(dt);
      if (X.tickN % 4 === 0) randomTicks();
      if ((X.spawnT -= dt) <= 0) { X.spawnT = 2; spawnTick(); }
    };
    X.frame = (dt, t) => {
      const a = X.frac >= 0 && X.frac <= 1 ? X.frac : 1;
      itemsFrame(t, dt, a); mobsFrame(dt, t, a); arrowsFrame(a); debrisFrame(dt);
      for (const f of X.falling) { const y = f.py + (f.y - f.py) * a; f.m.position.set(f.x - S.ox, y + .5, f.z - S.oz); Lit.update(f.lit, S, f.x, y + .5, f.z, dt); VR.itemLightF(f.m.geometry, f.lit.lv); }
      flyersFrame(dt); popsFrame(dt); shardsFrame(dt); groupsFrame(dt, a);
      ambient(dt);
      poolFrame(PF, dt, t); poolFrame(GL, dt, t, S.KL?.recs?.size && FXQ >= .5 ? halos : null);
    };
    X.fxStats = () => ({ shards: sLive, puffs: PF.live, glows: GL.live, items: X.items.length, falling: X.falling.length, dying: X.dying.length, pops: pops.length, flyers: flyers.length, trees: groups.length, arrows: arrows.length });
    X.fxObjects = () => ({ shards: shMesh, puffs: PF.o, glows: GL.o });   // для проверок
    // звери мира сохраняются (враги — нет)
    X.save = () => X.mobs.filter(m => MOBS[m.type].passive).slice(0, 48).map(m => ({ t: m.type, x: +m.x.toFixed(2), y: +m.y.toFixed(2), z: +m.z.toFixed(2), hp: m.hp }));
    X.load = arr => { if (!Array.isArray(arr)) return; for (const o of arr.slice(0, 48)) if (MOBS[o.t] && MOBS[o.t].passive && [o.x, o.y, o.z].every(Number.isFinite)) X.spawn(o.t, o.x, o.y, o.z, { hp: o.hp, quiet: true }); };
    // чанк загрузился: печи с топливом — снова греются; сохранённое течение воды и лавы — снова течёт (или высыхает),
    // песок над пустотой — падает (запланированные обновления не хранятся — их создаём заново по правкам)
    X.onChunkTiles = c => {
      if (c.tiles) for (const [i, t] of c.tiles) if (t && ('fuel' in t || 'in' in t)) { const x = c.cx * 16 + (i >> 11), z = c.cz * 16 + ((i >> 7) & 15), y = i & 127; X.furnaces.add(x + ',' + y + ',' + z); }
      if (c.edits) { const T = V().T; let n = 0; for (const [i, v] of c.edits) { const t = v & 0xfff; if ((T.liquid[t] && (v >>> 12)) || V().blocks[t]?.fall) { schedule(c.cx * 16 + (i >> 11), i & 127, c.cz * 16 + ((i >> 7) & 15), 10 + (n++ & 15)); } } }
    };
    X.dispose = () => {
      for (const e of X.items) { R.scene.remove(e.mesh); e.mesh.geometry.dispose(); }
      for (const f of X.falling) { R.scene.remove(f.m); f.m.geometry.dispose(); }
      for (const o of [...flyers, ...pops]) { R.scene.remove(o.m); o.m.geometry.dispose(); }
      for (const g of groups) { R.scene.remove(g.mesh); g.geo.dispose(); } groups.length = 0;
      for (const m of [...X.mobs]) removeMob(m);
      for (const m of X.dying) view.remove(m);
      view.dispose();
      R.scene.remove(dPts); dGeo.dispose(); dMat.dispose();
      R.scene.remove(shMesh); shGeo.dispose(); shMat.dispose(); shMesh.dispose?.();
      R.scene.remove(aMesh); aGeo.dispose(); aMat.dispose(); aMesh.dispose?.(); arrows.length = 0;
      for (const p of [PF, GL]) { R.scene.remove(p.o); p.g.dispose(); p.m.dispose(); p.tex.dispose(); }
      X.items = []; X.falling = []; X.mobs = []; X.dying = []; flyers.length = 0; pops.length = 0;
    };
    // связи с игрой (ставит kubomir.js)
    X.hookHurt = null; X.hookUnlock = null;
    return X;
  }
  function angTo(a, b, k){ let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * Math.min(1, k); }

  // ═══ Как рисуются мобы: коробки (одно место — потом заменим плавными существами, общими с «Подземьем») ═══
  // view = boxMobView({ T, R, VR, MOBS }) → add(m), frame(m, dt, t, st), remove(m), dispose(). Другой вид — такая же функция в
  // KubomirEnts.mobView (до начала мира). Моб: m.type, m.x/y/z (мир; рисовать — m.rx/ry/rz, m.ryaw, m.rwalk: плавно между
  // тактами), m.yaw, m.walk (фаза шага), m.vx/vz, m.ground, m.hurtT (красная вспышка), m.wind (замах), m.lunge (выпад),
  // m.dying (с после смерти, 0 — жив), m.state ('chase' — гонится), m.lit.u — униформа света (VR.entityMaterial: тот же свет,
  // что у кубиков). Сдвиг сцены — st.ox / st.oz. Вызовов отрисовки на моба столько же, сколько частей (анимация — повороты).
  function boxMobView(ctx){
    const { T, R, VR, MOBS } = ctx, mobGeo = {};
    const base = new T.MeshLambertMaterial({ vertexColors: true });
    function geoFor(type){
      if (mobGeo[type]) return mobGeo[type];
      const M = MOBS[type], parts = {};
      const box = (w, h, d, x, y, z, col) => { const g = new T.BoxGeometry(w, h, d); g.translate(x, y, z); const c = new T.Color(col), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new T.BufferAttribute(a, 3)); return g; };
      const merge = list => mergeGeos(T, list);
      if (type === 'zombie') {
        parts.body = merge([box(.5, .7, .28, 0, 1.1, 0, M.body)]);
        parts.head = merge([box(.48, .48, .48, 0, .24, 0, M.head), box(.1, .08, .02, -.11, .3, .245, '#1b1b1b'), box(.1, .08, .02, .11, .3, .245, '#1b1b1b')]); parts.headY = 1.45;
        parts.leg = merge([box(.22, .75, .24, 0, -.375, 0, M.legs)]); parts.legY = .75; parts.legX = .13; parts.legZ = 0;
        parts.arm = merge([box(.2, .2, .7, 0, 0, .3, M.head)]); parts.armY = 1.35; parts.armX = .36;
      } else if (type === 'slime') {
        parts.body = merge([box(.8, .8, .8, 0, .4, 0, M.body), box(.12, .12, .02, -.16, .5, .41, '#1c3a18'), box(.12, .12, .02, .16, .5, .41, '#1c3a18'), box(.2, .06, .02, 0, .3, .41, '#2c5a26')]);
      } else if (type === 'chicken') {
        parts.body = merge([box(.4, .36, .5, 0, .48, 0, M.body), box(.06, .25, .3, -.22, .5, 0, '#e6e6e0'), box(.06, .25, .3, .22, .5, 0, '#e6e6e0')]);
        parts.head = merge([box(.26, .32, .2, 0, .16, 0, M.head), box(.12, .07, .1, 0, .12, .14, '#f2b630'), box(.08, .1, .05, 0, .02, .1, M.spot)]); parts.headY = .62; parts.headZ = .26;
        parts.leg = merge([box(.06, .3, .06, 0, -.15, 0, M.legs)]); parts.legY = .3; parts.legX = .1; parts.legZ = 0;
      } else {   // корова, свинья
        const pig = type === 'pig', L = pig ? .35 : .55;
        const spots = pig ? [] : [box(.62, .3, .3, 0, .95, .15, M.spot), box(.3, .25, .4, .2, .9, -.35, M.spot)];
        parts.body = merge([box(pig ? .7 : .75, pig ? .55 : .65, 1.15, 0, L + (pig ? .28 : .33), 0, M.body), ...spots]);
        parts.head = merge([box(pig ? .5 : .5, pig ? .45 : .5, .45, 0, .1, .2, M.head), pig ? box(.26, .18, .06, 0, .02, .44, '#e4747e') : box(.32, .18, .06, 0, -.02, .44, '#d8b9a6'),
          box(.08, .08, .02, -.14, .16, .43, '#111'), box(.08, .08, .02, .14, .16, .43, '#111'), ...(pig ? [] : [box(.08, .14, .08, -.24, .36, .2, '#e9e1cf'), box(.08, .14, .08, .24, .36, .2, '#e9e1cf')])]);
        parts.headY = L + (pig ? .45 : .62); parts.headZ = .55;
        parts.leg = merge([box(.22, L, .22, 0, -L / 2, 0, M.legs)]); parts.legY = L; parts.legX = .22; parts.legZ = .38;
      }
      mobGeo[type] = parts;
      return parts;
    }
    const ease3 = k => 1 - (1 - k) * (1 - k) * (1 - k);
    const backOut = k => { const c = 1.70158, q = k - 1; return 1 + (c + 1) * q * q * q + c * q * q; };   // с перелётом (появление)
    return {
      add(m){
        const p = geoFor(m.type), g = new T.Group();
        g.rotation.order = 'YXZ';   // поворот, потом наклон вперёд/назад, потом крен набок
        const mat = VR?.entityMaterial ? VR.entityMaterial(base, m.lit.u, { kind: 'mob' }) : base.clone();
        const mesh = geo => { const o = new T.Mesh(geo, mat); o.castShadow = true; return o; };
        const body = mesh(p.body); g.add(body);
        // pose: размах шага, пружина (sq), голова (hy, hp), замах и выпад (wk, lk) — плавные копии логики; bt — с появления
        m.parts = { g, mat, chk: 0, body, amp: 0, sq: 0, sqV: 0, hy: 0, hp: 0, wk: 0, lk: 0, sk: 0, bt: m.quiet ? 9 : 0, gw: true, headY: p.headY || 0, headZ: p.headZ || 0, cr: 1, cg: 1, cb: 1 };
        if (p.head) { const h = new T.Group(); h.rotation.order = 'YXZ'; h.position.set(0, p.headY, p.headZ || 0); h.add(mesh(p.head)); g.add(h); m.parts.head = h; }
        if (p.leg) { m.parts.legs = []; const zs = p.legZ ? [p.legZ, -p.legZ] : [0]; for (const z of zs) for (const x of [-p.legX, p.legX]) { const l = new T.Group(); l.position.set(x, p.legY, z); l.add(mesh(p.leg)); g.add(l); m.parts.legs.push(l); } }
        if (p.arm) { m.parts.arms = []; for (const x of [-p.armX, p.armX]) { const a = new T.Group(); a.position.set(x, p.armY, 0); a.add(mesh(p.arm)); g.add(a); m.parts.arms.push(a); } }
        R.scene.add(g);
      },
      // каждый кадр: место — m.rx/ry/rz (плавно между тактами); шаг (ноги и руки по скорости), дыхание стоя, голова — на цель
      // (враг гонится, зверь рядом с игроком), иначе осматривается; замах (руки вверх, слизень сжимается) и выпад; удар —
      // отпрянул и покраснел; приземлился — сплющился; появился — «выпрыгнул» из облачка; смерть — набок, белеет, сжимается
      frame(m, dt, t, st){
        const p = m.parts, g = p.g, M = MOBS[m.type], d = Math.min(.05, Math.max(0, dt)), dead = m.dying > 0;
        const x = m.rx ?? m.x, y = m.ry ?? m.y, z = m.rz ?? m.z, yaw = m.ryaw ?? m.yaw, walk = m.rwalk ?? m.walk;
        p.bt += d;
        const spd = dead ? 0 : Math.hypot(m.vx, m.vz);
        p.amp += (Math.min(1, spd / 1.2) - p.amp) * Math.min(1, d * 8);
        const sw = Math.sin(walk) * p.amp * .7, idle = 1 - p.amp;
        const wT = !dead && m.wind > 0 ? 1 : 0, lT = !dead && m.lunge > 0 ? 1 : 0;
        p.wk += (wT - p.wk) * Math.min(1, d * (wT ? 9 : 14)); p.lk += (lT - p.lk) * Math.min(1, d * (lT ? 22 : 7));
        if (!dead && m.ground && !p.gw) p.sqV -= M.hop ? 5.5 : 2.2;
        p.gw = m.ground;
        p.sqV += (-p.sq * 150 - p.sqV * 12) * d; p.sq += p.sqV * d;
        let sq = p.sq - p.wk * (M.hop ? .3 : .05);
        if (M.hop && !dead) sq += m.ground ? .03 * Math.sin(t * 3.1 + m.id) * idle : Math.max(-.12, Math.min(.22, m.vy * .035));
        const hk = !dead && m.hurtT > 0 ? m.hurtT / .35 : 0;
        let lean = M.hop ? 0 : p.lk * .3 - p.wk * .16, roll = 0, lift = 0, sc = p.bt < .3 ? Math.max(.05, backOut(p.bt / .3)) : 1;
        lean -= hk * hk * .38;
        // оглушён (отбили щитом): качается, отклонился назад, голова «плывёт»
        const skT = !dead && m.stag > 0 ? 1 : 0; p.sk += (skT - p.sk) * Math.min(1, d * 10);
        if (p.sk > .01) { lean -= .14 * p.sk; roll += Math.sin(t * 7.5 + m.id) * .13 * p.sk; }
        if (dead) {
          const k1 = Math.min(1, m.dying / .4), side = m.id & 1 ? 1 : -1;
          roll = side * Math.PI / 2 * ease3(k1);
          if (m.dying > .4 && m.dying < .6) roll -= side * Math.sin((m.dying - .4) / .2 * Math.PI) * .12;   // отскок от земли
          lift = M.w * .4 * Math.abs(Math.sin(roll));
          const k2 = Math.max(0, Math.min(1, (m.dying - .5) / .35)); sc *= 1 - .9 * k2 * k2; lean = 0;
        }
        g.position.set(x - st.ox, y + lift, z - st.oz);
        g.rotation.set(lean, yaw, roll);
        const sxz = sc * (1 - sq * .45);
        g.scale.set(sxz, sc * (1 + sq), sxz);
        if (!M.hop) p.body.scale.y = 1 + .022 * idle * Math.sin(t * 2.3 + m.id * 1.7);   // дышит
        if (p.legs) for (let i = 0; i < p.legs.length; i++) p.legs[i].rotation.x = i === 0 || i === 3 ? sw : -sw;
        // руки зомби: вперёд (как в Майнкрафте), на ходу — в такт, замах — вверх, выпад — вниз
        if (p.arms) for (let i = 0; i < p.arms.length; i++) p.arms[i].rotation.x = -1.0 * p.wk + .5 * p.lk + (i ? sw : -sw) * .3 + idle * .07 * Math.sin(t * 1.6 + i * 1.3 + m.id);
        if (p.head) {
          let hy = 0, hp = 0;
          const P = st.P;
          if (!dead && P) {
            const dx = P.x - x, dz = P.z - z, dist = Math.hypot(dx, dz);
            if (m.state === 'chase' || (M.passive && dist < 7 && m.state !== 'flee')) {
              hy = angTo(0, Math.atan2(dx, dz) - yaw, 1); hp = -Math.atan2(P.y + 1.5 - (y + p.headY), Math.max(.6, dist));
            } else if (Math.sin(t * .31 + m.id * 2.1) > .3) hy = Math.sin(t * .47 + m.id) * .8;
            hy = Math.max(-1.1, Math.min(1.1, hy)); hp = Math.max(-.6, Math.min(.5, hp));
          }
          p.hy += (hy - p.hy) * Math.min(1, d * 5); p.hp += (hp - p.hp) * Math.min(1, d * 5);
          p.head.rotation.y = p.hy; p.head.rotation.x = p.hp + Math.sin(walk * 2) * .07 * p.amp;
          p.head.rotation.z = p.sk > .01 ? Math.sin(t * 10 + m.id) * .3 * p.sk : 0;
          if (m.type === 'chicken') p.head.position.z = p.headZ + Math.max(0, Math.sin(walk * 2)) * .07 * p.amp;   // клюёт на ходу
        }
        // цвет: удар — красный (свет — в униформе m.lit.u); смерть — красный, потом белеет
        let cr = 1, cg = 1, cb = 1;
        if (dead) { const w = Math.max(0, Math.min(1, (m.dying - .45) / .3)); cr = 1.6 + .6 * w; cg = cb = .35 + 1.85 * w; }
        else if (m.hurtT > 0) { cr = 1.6; cg = cb = .35; }
        // свой кусок шейдера не собрался (старый телефон) — обычный материал с цветом по свету клетки
        if (p.chk < 3 && ++p.chk === 3 && VR?.failed?.(p.mat)) {
          const pl = base.clone(); g.traverse(o => { if (o.isMesh) o.material = pl; }); p.mat.dispose(); p.mat = pl; p.plain = true;
        }
        if (p.plain && cr === 1 && cg === 1) { const L = st.W.lightAt(m.x, m.y + M.h * .6, m.z), lc = lightTint(L, .06); p.mat.color.setRGB(lc[0], lc[1], lc[2]); p.cr = -1; }
        else if (p.cr !== cr || p.cg !== cg || p.cb !== cb) { p.cr = cr; p.cg = cg; p.cb = cb; p.mat.color.setRGB(cr, cg, cb); }
      },
      remove(m){ R.scene.remove(m.parts.g); m.parts.mat.dispose(); },
      dispose(){ for (const p of Object.values(mobGeo)) for (const g of Object.values(p)) if (g && g.isBufferGeometry) g.dispose(); base.dispose(); },
    };
  }
  // стрела: древко вдоль +z (острие — вперёд, начало координат — середина), наконечник, оперение крестом
  function arrowGeo(T){
    const box = (w, h, d, x, y, z, col) => { const g = new T.BoxGeometry(w, h, d); g.translate(x, y, z); const c = new T.Color(col), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new T.BufferAttribute(a, 3)); return g; };
    return mergeGeos(T, [box(.035, .035, .62, 0, 0, -.04, '#9c7444'), box(.07, .07, .1, 0, 0, .3, '#6b6b74'), box(.12, .012, .16, 0, 0, -.3, '#f2f2f2'), box(.012, .12, .16, 0, 0, -.3, '#e04848')]);
  }
  // склеить коробки (позиции, нормали, цвета) в одну геометрию
  function mergeGeos(T, list){
    let n = 0, ni = 0; for (const g of list) { n += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), idx = new Uint16Array(ni);
    let o = 0, oi = 0;
    for (const g of list) {
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
      const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx[oi + i] = ia[i] + o;
      o += g.attributes.position.count; oi += ia.length; g.dispose();
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3)); out.setAttribute('normal', new T.BufferAttribute(nor, 3)); out.setAttribute('color', new T.BufferAttribute(col, 3));
    out.setIndex(new T.BufferAttribute(idx, 1));
    return out;
  }
})();
