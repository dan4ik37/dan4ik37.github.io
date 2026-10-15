// ═══════════════════════════════════════
//  «КУБОМИР» — живое в мире: выпавшие вещи, крошки, падающий песок, мобы (днём — звери, ночью — зомби и слизни),
//  течение воды и лавы, рост ростков и травы, печи
// ═══════════════════════════════════════
// window.KubomirEnts.create(S) → X: tick(dt) — 20 раз в секунду (ИИ мобов, вода, печи), frame(dt, t) — рисование,
// addItem(x, y, z, вещь, разбросать, скорость), debris(x, y, z, блок), rayMob(…), damage(моб, урон, nx, nz), spawn(вид, x, y, z),
// onBlockChanged(x, y, z, было, стало) — соседей «будим» (вода течёт, песок падает), blocked(x, y, z) — моб в клетке,
// crumbs(x, y, z, вещь) — крошки еды, save()/load() — звери мира, dispose(). Свет мобов, вещей и человечков — плавный, как у
// кубиков (KubomirEnts.Lit); как рисуется моб — одно место (view, boxMobView). ИИ дешёвый и предсказуемый: у каждого моба свой генератор от номера, шаг 1/20 с,
// дальше 64 блоков — не думают. Вода: источник (0) и течение 1…7, падающая (8); лава течёт на 3 и медленнее;
// вода + лава → обсидиан (источник лавы) или булыжник.
(() => {
  const V = () => window.D37E.vox;
  const now = () => performance.now();
  const MOBS = {
    cow: { title: 'Корова', hp: 10, w: .9, h: 1.3, speed: 1.3, passive: true, drops: [['meat_raw', 1, 3]], snd: 'kb_moo', body: '#5a3a26', spot: '#f2efe9', legs: '#3a2618', head: '#5a3a26' },
    pig: { title: 'Свинья', hp: 10, w: .9, h: 1, speed: 1.4, passive: true, drops: [['meat_raw', 1, 2]], snd: 'kb_oink', body: '#f0a3a8', spot: '#e48b93', legs: '#e48b93', head: '#f0a3a8' },
    chicken: { title: 'Курица', hp: 4, w: .45, h: .8, speed: 1.2, passive: true, drops: [['chicken_raw', 1, 1], ['feather', 0, 2]], snd: 'kb_cluck', body: '#f6f6f2', spot: '#e33', legs: '#f2b630', head: '#f6f6f2' },
    zombie: { title: 'Зомби', hp: 20, w: .6, h: 1.85, speed: 2.4, passive: false, dmg: 3, drops: [], snd: 'kb_groan', body: '#3b6fa8', spot: '#2c4e7a', legs: '#2c3f6b', head: '#5f9e5a', burns: true },
    slime: { title: 'Слизень', hp: 8, w: .8, h: .8, speed: 3, passive: false, dmg: 2, drops: [['slime_ball', 1, 2]], snd: 'kb_squish', body: '#6fcf5a', spot: '#4caa40', legs: '#4caa40', head: '#6fcf5a', hop: true },
  };

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
  // (зомби: «легко» 2, «обычно» 3 — как в Майнкрафте). Шаг логики — 20 раз в секунду от часов игры, не от частоты кадров.
  const DIFF = { peaceful: { cap: 0, every: 2, dmg: 0 }, easy: { cap: 4, every: 4, dmg: .67 }, normal: { cap: 6, every: 3, dmg: 1 } };
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
    const X = { items: [], falling: [], mobs: [], seq: 0, upd: new Map(), updQ: [], tickN: 0, furnaces: new Set(), spawnT: 0, rng: V().rng((V().hash(S.W.seed, 999) >>> 0) || 1) };
    const BOX = { x: 0, y: 0, z: 0, w: .25, h: .25, hitX: false, hitY: false, hitZ: false };

    // ═══ Выпавшие вещи ═══
    X.addItem = (x, y, z, stack, scatter, vel) => {
      if (!stack || !(stack.n > 0) || !V().item(stack.id)) return null;
      const r = X.rng;
      const e = { x, y, z, vx: vel ? vel[0] : (r() - .5) * 2.4, vy: vel ? vel[1] : 3 + r() * 1.5, vz: vel ? vel[2] : (r() - .5) * 2.4, s: { id: stack.id, n: stack.n, d: stack.d | 0 }, age: 0, mesh: null, ph: r() * 6, lit: Lit.make(null), ground: false };
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
      const P = S.P;
      for (let i = X.items.length - 1; i >= 0; i--) {
        const e = X.items[i];
        e.age += dt;
        if (e.age > 300) { dropItem(i); continue; }
        if (!W.loaded(e.x, e.z)) continue;
        e.vy = Math.max(-30, e.vy - 20 * dt);
        const v = W.raw(e.x, e.y + .1, e.z); if (v > 0 && V().T.liquid[v & 0xfff] === 1) { e.vy = Math.min(e.vy + 30 * dt, 1.2); }
        BOX.x = e.x; BOX.y = e.y; BOX.z = e.z;
        V().moveBox(W, BOX, e.vx * dt, e.vy * dt, e.vz * dt);
        if (BOX.hitY) { e.vy = 0; e.ground = true; } else e.ground = false;
        if (BOX.hitX) e.vx = 0; if (BOX.hitZ) e.vz = 0;
        const fr = e.ground ? Math.exp(-dt * 8) : Math.exp(-dt * .5); e.vx *= fr; e.vz *= fr;
        // застрял в блоке — наверх
        if (V().boxHits(W, BOX.x, BOX.y + .01, BOX.z, .2, .2)) BOX.y += 2 * dt * 5;
        e.x = BOX.x; e.y = BOX.y; e.z = BOX.z;
        // подобрать
        if (!P.dead && e.age > .6 && Math.abs(P.x - e.x) < 1.3 && Math.abs(P.z - e.z) < 1.3 && e.y > P.y - .6 && e.y < P.y + 2) {
          const left = X.give ? X.give(e.s) : e.s.n;
          if (left < e.s.n) { S.AU?.play('kb_pop', { vol: .35, rate: 1 + X.rng() * .3 }); if (e.s.id === 'iron_ingot') S.ents.hookUnlock?.('iron'); X.hookPickup?.(e.s.id, e.s.n - left); }
          if (left <= 0) { dropItem(i); continue; }
          e.s.n = left;
        }
      }
      // склеить одинаковые рядом (раз в секунду)
      if (X.tickN % 20 === 0) for (let i = 0; i < X.items.length; i++) for (let j = X.items.length - 1; j > i; j--) {
        const a = X.items[i], b = X.items[j], it = V().item(a.s.id);
        if (a.s.id !== b.s.id || it.tool || Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > .6 || Math.abs(a.z - b.z) > 1 || a.s.n + b.s.n > it.stack) continue;
        a.s.n += b.s.n; dropItem(j);
      }
    }
    // свет вещи — плавно (Lit); дальние (дальше 20 блоков) — раз в 4 кадра
    let fN = 0;
    function itemsFrame(t, dt){
      fN++;
      const P = S.P;
      for (let i = 0; i < X.items.length; i++) {
        const e = X.items[i], m = e.mesh;
        m.position.set(e.x - S.ox, e.y + e.k + .08 + Math.sin(t * 2.4 + e.ph) * .05, e.z - S.oz);
        m.rotation.y = t * 1.6 + e.ph;
        const far = Math.abs(e.x - P.x) > 20 || Math.abs(e.z - P.z) > 20;
        if (far && e.lit.init && ((fN + i) & 3)) continue;
        Lit.update(e.lit, S, e.x, e.y + e.k + .1, e.z, far ? dt * 4 : dt);
        VR.itemLightF(m.geometry, e.lit.lv);
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
      const b = V().blocks[bid], layer = b?.texf ? b.texf.side : 0, P = texAvg(layer), r = X.rng;
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
      const it = V().item(id), b = it?.place ? V().block(it.place) : null, P = texAvg(it?.texL ?? b?.texf?.side ?? 0), r = X.rng;
      const L = W.lightAt(x, y, z), k = Math.max((V().lSky(L) / 15) ** 2, (V().lBlk(L) / 15) ** 2, .08) * .8;
      for (let i = 0; i < n; i++) {
        const j = dHead; dHead = (dHead + 1) % DN;
        dPos[j * 3] = x + (r() - .5) * .16 - S.ox; dPos[j * 3 + 1] = y + (r() - .5) * .1; dPos[j * 3 + 2] = z + (r() - .5) * .16 - S.oz;
        dVel[j * 3] = (r() - .5) * 1.6; dVel[j * 3 + 1] = r() * .8 + .2; dVel[j * 3 + 2] = (r() - .5) * 1.6;
        const c = P.pal[Math.floor(r() * P.pal.length)];
        dCol[j * 3] = c[0] * k; dCol[j * 3 + 1] = c[1] * k; dCol[j * 3 + 2] = c[2] * k;
        dLife[j] = .35 + r() * .3;
      }
    };
    let dOX = 0, dOZ = 0;
    function debrisFrame(dt){
      // сдвиг начала координат — точки тоже
      if (dOX !== S.ox || dOZ !== S.oz) { const ax = S.ox - dOX, az = S.oz - dOZ; for (let j = 0; j < DN; j++) { dPos[j * 3] -= ax; dPos[j * 3 + 2] -= az; } dOX = S.ox; dOZ = S.oz; }
      let any = false;
      for (let j = 0; j < DN; j++) {
        if (dLife[j] <= 0) { if (dPos[j * 3 + 1] > -900) { dPos[j * 3 + 1] = -1000; any = true; } continue; }
        dLife[j] -= dt; any = true;
        dVel[j * 3 + 1] -= 14 * dt;
        dPos[j * 3] += dVel[j * 3] * dt; dPos[j * 3 + 1] += dVel[j * 3 + 1] * dt; dPos[j * 3 + 2] += dVel[j * 3 + 2] * dt;
        const v = W.raw(dPos[j * 3] + S.ox, dPos[j * 3 + 1], dPos[j * 3 + 2] + S.oz);
        if (v > 0 && V().T.solid[v & 0xfff]) { dVel[j * 3 + 1] = 0; dVel[j * 3] *= .5; dVel[j * 3 + 2] *= .5; dPos[j * 3 + 1] = Math.ceil(dPos[j * 3 + 1]) + .02; }
      }
      if (any) { dGeo.attributes.position.needsUpdate = true; dGeo.attributes.color.needsUpdate = true; }
    }

    // ═══ Падающий песок и гравий ═══
    function startFall(x, y, z, v){
      W.set(x, y, z, 0, { urgent: 2 });
      const name = V().blocks[v & 0xfff].name, m = VR.itemMesh(name, 15 << 12);
      m.scale.setScalar(1); R.scene.add(m);
      X.falling.push({ x: x + .5, y, z: z + .5, vy: 0, v, m, lit: Lit.make(null) });
    }
    function fallingTick(dt){
      for (let i = X.falling.length - 1; i >= 0; i--) {
        const f = X.falling[i];
        f.vy = Math.max(-40, f.vy - 32 * dt);
        const ny = f.y + f.vy * dt, bx = Math.floor(f.x), bz = Math.floor(f.z);
        const below = W.raw(bx, Math.floor(ny), bz);
        if (ny < 0 || (below > 0 && !V().blocks[below & 0xfff].replace) || below < 0) {
          const y = Math.max(1, Math.floor(ny) + 1), cur = W.get(bx, y, bz);
          if (cur >= 0 && V().blocks[cur].replace) W.set(bx, y, bz, f.v, { urgent: 2 });
          else X.addItem(f.x, y + .2, f.z, { id: V().blocks[f.v & 0xfff].name, n: 1 });
          R.scene.remove(f.m); f.m.geometry.dispose(); X.falling.splice(i, 1);
          continue;
        }
        f.y = ny;
      }
    }

    // ═══ Мобы ═══
    // как моб рисуется — одно место: view (по умолчанию коробки — boxMobView ниже; KubomirEnts.mobView — свой вид);
    // свет — m.lit (Lit, тот же, что у кубиков), удар — m.hurtT
    const view = (window.KubomirEnts.mobView || boxMobView)({ T, R, VR, MOBS });
    X.view = view;
    X.spawn = (type, x, y, z, o = {}) => {
      if (!MOBS[type] || X.mobs.length >= 60) return null;
      const M = MOBS[type], id = ++X.seq;
      const m = { id, type, x, y, z, vx: 0, vy: 0, vz: 0, yaw: o.yaw ?? X.rng() * 6.28, hp: o.hp ?? M.hp, ground: false, walk: 0, state: 'idle', stT: 0, tgtYaw: 0, hurtT: 0, atkT: 0, flee: 0, hopT: 0, lit: Lit.make(T), sndT: 4 + X.rng() * 10, rng: V().rng(V().hash(W.seed, id, now() | 0)), burnT: 0, age: 0 };
      Lit.update(m.lit, S, x, y + M.h * .6, z, 0);
      view.add(m);
      X.mobs.push(m);
      return m;
    };
    function removeMob(m){ const i = X.mobs.indexOf(m); if (i >= 0) X.mobs.splice(i, 1); view.remove(m); }
    X.damage = (m, dmg, nx, nz, by) => {
      if (m.hp <= 0) return;
      m.hp -= dmg; m.hurtT = .35;
      m.vx += nx * 6; m.vz += nz * 6; m.vy = Math.max(m.vy, 4.5);
      S.AU?.play(MOBS[m.type].snd, { x: m.x - S.ox, y: m.y + 1, z: m.z - S.oz, vol: .6, rate: 1.15 });
      if (MOBS[m.type].passive) { m.flee = 4; }
      if (m.hp <= 0) {
        for (const [id, a, b] of MOBS[m.type].drops) { const n = a + Math.floor(m.rng() * (b - a + 1)); if (n > 0) X.addItem(m.x, m.y + .5, m.z, { id, n }); }
        X.debris(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z), 0, 18, [.85, .85, .85]);
        if (m.type === 'zombie' && by === 'player') S.ents.hookUnlock?.('zombie');
        X.hookKill?.(m, by);   // моды: событие mobKill
        removeMob(m);
      }
    };
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
    const MB = { x: 0, y: 0, z: 0, w: 1, h: 1, hitX: false, hitY: false, hitZ: false }, TC = {};
    function mobsTick(dt){
      const P = S.P, Vx = V(), night = isNight();
      for (let i = X.mobs.length - 1; i >= 0; i--) {
        const m = X.mobs[i], M = MOBS[m.type];
        m.age += dt;
        const dxp = P.x - m.x, dzp = P.z - m.z, dp = Math.hypot(dxp, dzp);
        // далеко — исчезает (враги) или замирает (звери)
        if (!M.passive && (dp > 72 || (S.meta.diff === 'peaceful'))) { removeMob(m); continue; }
        // враги вдали (или глубоко по высоте) понемногу исчезают — освобождают место ближним
        if (!M.passive && (dp > 40 || Math.abs(P.y - m.y) > 28) && m.age > 20 && m.rng() < dt / 25) { removeMob(m); continue; }
        if (dp > (S.ST.rd * 16 + 24)) { if (!M.passive || dp > S.ST.rd * 16 + 48) removeMob(m); continue; }
        if (!W.loaded(m.x, m.z) || !W.loaded(m.x + 8, m.z) || !W.loaded(m.x - 8, m.z)) continue;
        m.hurtT = Math.max(0, m.hurtT - dt); m.atkT -= dt; m.sndT -= dt;
        Vx.touching(W, m.x, m.y, m.z, M.w, M.h, TC);
        const inWater = TC.water > .4;
        // мозги
        let wx = 0, wz = 0, sp = M.speed;
        const hostile = !M.passive && !S.creative && !P.dead && S.meta.diff !== 'peaceful';
        if (hostile && dp < 18 && Math.abs(P.y - m.y) < 8) {
          wx = dxp / (dp || 1); wz = dzp / (dp || 1); m.state = 'chase';
          if (dp < (M.w / 2 + .75) && Math.abs(P.y + .9 - (m.y + M.h / 2)) < 1.6 && m.atkT <= 0) { m.atkT = 1; const D = DIFF[S.meta.diff] || DIFF.easy; X.hits = (X.hits || 0) + 1; S.ents.hookHurt?.(Math.max(1, Math.round(M.dmg * D.dmg))); }
        } else if (m.flee > 0) {
          m.flee -= dt; wx = -dxp / (dp || 1); wz = -dzp / (dp || 1); sp *= 1.8; m.state = 'flee';
        } else {
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
        // упёрся в ступеньку — прыжок
        if ((MB.hitX || MB.hitZ) && m.ground && !M.hop && (wx || wz)) m.vy = 8.2;
        m.ground = MB.hitY && vy0 <= 0; if (MB.hitY) m.vy = 0;
        if ((MB.hitX || MB.hitZ) && Math.hypot(MB.x - m.x, MB.z - m.z) < sp * dt * .3) m.blockedT = (m.blockedT || 0) + dt; else m.blockedT = Math.max(0, (m.blockedT || 0) - dt);
        m.x = MB.x; m.y = MB.y; m.z = MB.z;
        if (m.y < -10) { removeMob(m); continue; }
        m.walk += Math.hypot(m.vx, m.vz) * dt * 3.2;
        // зомби горят на солнце
        if (M.burns && !night) { const L = W.lightAt(m.x, m.y + M.h, m.z); if (V().lSky(L) >= 13) { m.burnT += dt; if (m.burnT > 1) { m.burnT = 0; X.debris(Math.floor(m.x), Math.floor(m.y + 1), Math.floor(m.z), 0, 6, [1, .5, .1]); X.damage(m, 2, 0, 0, 'sun'); if (m.hp <= 0) continue; } } }
        if (TC.lava > .1 || TC.hurt >= 4) X.damage(m, 4 * dt * 5, 0, 0, 'lava');
        if (m.sndT <= 0) { m.sndT = 6 + m.rng() * 14; if (dp < 20) S.AU?.play(M.snd, { x: m.x - S.ox, y: m.y + 1, z: m.z - S.oz, vol: .5, rate: .9 + m.rng() * .2 }); }
      }
    }
    // свет моба — плавно, по месту груди (дальние, дальше 32 блоков, — раз в 4 кадра); рисует view
    let mN = 0;
    function mobsFrame(dt, t){
      mN++;
      const P = S.P;
      for (let i = 0; i < X.mobs.length; i++) {
        const m = X.mobs[i], M = MOBS[m.type], far = Math.abs(m.x - P.x) > 32 || Math.abs(m.z - P.z) > 32;
        if (!far || !((mN + i) & 3)) Lit.update(m.lit, S, m.x, m.y + M.h * .6, m.z, far ? dt * 4 : dt);
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
      if (b.fall) { const bv = W.raw(x, y - 1, z); if (bv === 0 || (bv > 0 && T.liquid[bv & 0xfff]) || (bv > 0 && Vx.blocks[bv & 0xfff].replace)) startFall(x, y, z, v); return; }
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
        if (lava && T.liquid[nt] === 1) { W.set(x, y, z, V().cell(lvl === 0 && !falling ? ID.obsidian : ID.cobble)); S.AU?.play('kb_pop', { x: x - S.ox, y, z: z - S.oz, vol: .3, rate: .6 }); X.debris(x, y, z, 0, 8, [.5, .5, .5]); return; }
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
      mobsTick(dt);
      updatesTick();
      furnaceTick(dt);
      if (X.tickN % 4 === 0) randomTicks();
      if ((X.spawnT -= dt) <= 0) { X.spawnT = 2; spawnTick(); }
    };
    X.frame = (dt, t) => {
      itemsFrame(t, dt); mobsFrame(dt, t); debrisFrame(dt);
      for (const f of X.falling) { f.m.position.set(f.x - S.ox, f.y + .5, f.z - S.oz); Lit.update(f.lit, S, f.x, f.y + .5, f.z, dt); VR.itemLightF(f.m.geometry, f.lit.lv); }
    };
    // звери мира сохраняются (враги — нет)
    X.save = () => X.mobs.filter(m => MOBS[m.type].passive).slice(0, 48).map(m => ({ t: m.type, x: +m.x.toFixed(2), y: +m.y.toFixed(2), z: +m.z.toFixed(2), hp: m.hp }));
    X.load = arr => { if (!Array.isArray(arr)) return; for (const o of arr.slice(0, 48)) if (MOBS[o.t] && MOBS[o.t].passive && [o.x, o.y, o.z].every(Number.isFinite)) X.spawn(o.t, o.x, o.y, o.z, { hp: o.hp }); };
    // чанк загрузился: печи с топливом — снова греются; сохранённое течение воды и лавы — снова течёт (или высыхает),
    // песок над пустотой — падает (запланированные обновления не хранятся — их создаём заново по правкам)
    X.onChunkTiles = c => {
      if (c.tiles) for (const [i, t] of c.tiles) if (t && ('fuel' in t || 'in' in t)) { const x = c.cx * 16 + (i >> 11), z = c.cz * 16 + ((i >> 7) & 15), y = i & 127; X.furnaces.add(x + ',' + y + ',' + z); }
      if (c.edits) { const T = V().T; let n = 0; for (const [i, v] of c.edits) { const t = v & 0xfff; if ((T.liquid[t] && (v >>> 12)) || V().blocks[t]?.fall) { schedule(c.cx * 16 + (i >> 11), i & 127, c.cz * 16 + ((i >> 7) & 15), 10 + (n++ & 15)); } } }
    };
    X.dispose = () => {
      for (const e of X.items) { R.scene.remove(e.mesh); e.mesh.geometry.dispose(); }
      for (const f of X.falling) { R.scene.remove(f.m); f.m.geometry.dispose(); }
      for (const m of [...X.mobs]) removeMob(m);
      view.dispose();
      R.scene.remove(dPts); dGeo.dispose(); dMat.dispose();
      X.items = []; X.falling = []; X.mobs = [];
    };
    // связи с игрой (ставит kubomir.js)
    X.hookHurt = null; X.hookUnlock = null;
    return X;
  }
  function angTo(a, b, k){ let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * Math.min(1, k); }

  // ═══ Как рисуются мобы: коробки (одно место — потом заменим плавными существами, общими с «Подземьем») ═══
  // view = boxMobView({ T, R, VR, MOBS }) → add(m), frame(m, dt, t, st), remove(m), dispose(). Другой вид — такая же функция в
  // KubomirEnts.mobView (до начала мира). Моб: m.type, m.x/y/z (мир), m.yaw, m.walk (фаза шага), m.vx/vz, m.ground, m.hurtT
  // (красная вспышка), m.lit.u — униформа света (VR.entityMaterial: тот же свет, что у кубиков). Сдвиг сцены — st.ox / st.oz.
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
    return {
      add(m){
        const p = geoFor(m.type), g = new T.Group();
        const mat = VR?.entityMaterial ? VR.entityMaterial(base, m.lit.u, { kind: 'mob' }) : base.clone();
        const mesh = geo => { const o = new T.Mesh(geo, mat); o.castShadow = true; return o; };
        g.add(mesh(p.body));
        m.parts = { g, mat, chk: 0 };
        if (p.head) { const h = new T.Group(); h.position.set(0, p.headY, p.headZ || 0); h.add(mesh(p.head)); g.add(h); m.parts.head = h; }
        if (p.leg) { m.parts.legs = []; const zs = p.legZ ? [p.legZ, -p.legZ] : [0]; for (const z of zs) for (const x of [-p.legX, p.legX]) { const l = new T.Group(); l.position.set(x, p.legY, z); l.add(mesh(p.leg)); g.add(l); m.parts.legs.push(l); } }
        if (p.arm) { m.parts.arms = []; for (const x of [-p.armX, p.armX]) { const a = new T.Group(); a.position.set(x, p.armY, 0); a.add(mesh(p.arm)); g.add(a); m.parts.arms.push(a); } }
        R.scene.add(g);
      },
      frame(m, dt, t, st){
        const g = m.parts.g, M = MOBS[m.type];
        g.position.set(m.x - st.ox, m.y, m.z - st.oz); g.rotation.y = m.yaw;
        const sw = Math.sin(m.walk) * Math.min(1, Math.hypot(m.vx, m.vz) / 1.2) * .7;
        if (m.parts.legs) m.parts.legs.forEach((l, i) => { l.rotation.x = (i === 0 || i === 3 ? sw : -sw); });
        if (m.parts.arms) m.parts.arms.forEach((a, i) => { a.rotation.x = -1.35 + (i ? sw : -sw) * .3; });
        if (M.hop) { const sq = m.ground ? 1 : 1.12; g.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)); }
        // красная вспышка при уроне (свет — в униформе m.lit.u)
        const hurt = m.hurtT > 0;
        if (hurt !== !!m.parts.hurt) { m.parts.hurt = hurt; m.parts.mat.color.setRGB(hurt ? 1.6 : 1, hurt ? .35 : 1, hurt ? .35 : 1); }
        // свой кусок шейдера не собрался (старый телефон) — обычный материал с цветом по свету клетки
        if (m.parts.chk < 3 && ++m.parts.chk === 3 && VR?.failed?.(m.parts.mat)) {
          const pl = base.clone(); g.traverse(o => { if (o.isMesh) o.material = pl; }); m.parts.mat.dispose(); m.parts.mat = pl; m.parts.plain = true;
        }
        if (m.parts.plain && !hurt) { const L = st.W.lightAt(m.x, m.y + M.h * .6, m.z), lc = lightTint(L, .06); m.parts.mat.color.setRGB(lc[0], lc[1], lc[2]); }
      },
      remove(m){ R.scene.remove(m.parts.g); m.parts.mat.dispose(); },
      dispose(){ for (const p of Object.values(mobGeo)) for (const g of Object.values(p)) if (g && g.isBufferGeometry) g.dispose(); base.dispose(); },
    };
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
