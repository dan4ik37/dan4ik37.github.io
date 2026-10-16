// ═══════════════════════════════════════
//  «КУБОМИР» — погода по биому: дождь (равнины, леса, березняк, болото, реки, берег, океан; в горах — ниже 95), снег
//  (снега, горы выше 95), в пустыне — сухо. Дождь: небо и туман темнее, капли вокруг камеры, брызги на земле, круги на
//  воде, шум дождя (под крышей — глухо), изредка далёкий гром со вспышкой (мягко: игра 6+). Снег — медленные хлопья, ветер.
// ═══════════════════════════════════════
// KubomirWeather.at(зерно, день, час) → сила 0…1. Расписание: сутки игры — 4 части по 6 ч; в каждой с шансом 25 % идёт
// дождь (начало, длина 1,5–4 ч, сила 0,6–1 — от хеша зерна и номера части), края плавные (0,4 ч ≈ 20 с). Только от зерна и
// часов игры (meta.day, R.lighting.time): перезагрузка — та же погода. kindAt(биом, высота) → 'rain' | 'snow' | ''.
// X = KubomirWeather.create(st): step(dt) — шаг логики (расписание — раз в 0,5 с, биом — раз в 2 с), frame(dt, t) —
// частицы, звук, гром; X.k — сила для неба и тумана (дождь целиком, снег — вполсилы), X.rain / X.snow — сила сейчас (плавно),
// X.force — /weather (null — по расписанию), top(x, z) — где по столбу кончается небо: первый сверху не пустой блок (кроме
// травы, цветов, факелов), у воды — её гладь. Капля появляется только выше этого места и разбивается о него: под крышей
// дождя нет. Столбы — в кэше (правка блока — столб заново, весь кэш — раз в 4 с: подгрузились чанки).
// Частицы — пулы вокруг камеры: дождь — отрезки (LineSegments, сверху прозрачные), снег — точки, круги на воде —
// InstancedMesh колец (сложение); ни одной — объект спрятан. «Низкая» графика — без частиц (только небо, туман, звук),
// телефон и «средняя» — 45 %. ⚙️ «🧊 Кубомир» → «Погода» выкл — st.weatherOff (сила 0).
// Времена года (16.10.2026, движок — js/engine/climate.js, docs/SEASONS.md): погода и сезон — у движка (W.at: климат по биому —
// пустыня сухая, снега и горы холодные, море ветреное; дождь или снег — по температуре в точке), частицы под крышей — свои.
// ⚙️ «Времена года»: как в общем мире (calendar, по умолчанию) / по игровым дням (3 суток на сезон) / выкл (всегда лето, погода
// идёт). Зимой на верхних гранях снег (по свету неба блока — в пещерах и домах нет; кусок шейдера движка D37_CLIM), осенью
// листва и трава желтеют (цвет биома, крючок VR.onShader), озёра под открытым небом замерзают: вид льда + по льду можно ходить
// (V.iceTest — без правки блоков мира), весной тает. Без движка погоды (нет climate.js) — прежнее расписание по зерну и дню.
(() => {
  const V = () => window.D37E.vox;
  const P_RAIN = .25, SLOT = 6, RAMP = .4, RAD = 13;
  const sm = q => q * q * (3 - 2 * q);
  const CLIM = () => window.D37E?.climate || null;
  // Биом «Кубомира» → климат движка
  const BIOME_CLIM = { ocean: 'sea', beach: 'sea', plains: 'temperate', forest: 'temperate', birch: 'temperate', desert: 'desert', snow: 'snow', mountains: 'mountain', swamp: 'temperate', river: 'temperate' };
  const wCache = new Map();
  // Сила непогоды 0…1 в сутки day и час hour (по игровым дням, 3 суток на сезон; умеренный климат) — у всех одинаково
  function at(seed, day, hour){
    const C = CLIM(); if (!C) return atOld(seed, day, hour);
    const k = String(seed);
    let w = wCache.get(k);
    if (!w) { const g = { day: 1, hour: 0 }; w = { g, W: C.world({ seed: 'kb:' + k, mode: 'cycle', days: 3, front: 0, gameTime: () => w.g }) }; if (wCache.size > 8) wCache.clear(); wCache.set(k, w); }
    w.g.day = day | 0; w.g.hour = hour;
    const s = w.W.at(0, 0, 0, 60);
    return Math.max(s.rain, s.snow);
  }
  function atOld(seed, day, hour){
    const s = V().seedOf(seed), T = (day | 0) * 24 + hour, k = Math.floor(T / SLOT);
    let w = 0;
    for (let j = k - 1; j <= k; j++) {   // дождь прошлой части может зайти в эту
      const h = V().hash(s, j, 0x77e1);
      if ((h & 0xffff) / 65536 >= P_RAIN) continue;
      const a = j * SLOT + 1 + ((h >>> 16) & 255) / 255 * 2, e = a + 1.5 + ((h >>> 24) & 255) / 255 * 2.5, r = Math.min(T - a, e - T) / RAMP;
      if (r <= 0) continue;
      w = Math.max(w, (.6 + .4 * (V().hash(s, j, 0x77e2) & 255) / 255) * sm(Math.min(1, r)));
    }
    return w;
  }
  const kindAt = (b, y) => b === 'desert' ? '' : b === 'snow' || (b === 'mountains' && y > 95) ? 'snow' : 'rain';
  window.KubomirWeather = { at, atOld, kindAt, create, BIOME_CLIM };

  function create(st){
    const R = st.R, T = R.T, W = st.W, Vx = V(), E = window.D37E, TT = Vx.T, SH = Vx.SHAPE;
    const q = R.q === 'low' ? 0 : E.isMobile?.() || R.q === 'mid' ? .45 : 1;
    const X = { k: 0, rain: 0, snow: 0, wantR: 0, wantS: 0, biome: 'plains', force: null, q, top };
    const FR = Vx.rng((Vx.hash(Vx.seedOf(W.seed), 0x77e3) >>> 0) || 5);
    const wa = (Vx.hash(Vx.seedOf(W.seed), 0x77e4) & 1023) / 1023 * 6.283, windX = Math.cos(wa) * 1.1, windZ = Math.sin(wa) * 1.1;   // ветер мира
    let tq = 0, tb = 0;
    // ── движок погоды (времена года): мир по зерну, климат по биому; картинка поверхностей — attach без своих частиц ──
    const C = CLIM();
    const seasonsMode = () => st.seasons || 'calendar';
    const worldCfg = () => { const m = seasonsMode(); return { seed: 'kb:' + W.seed, mode: m === 'off' ? 'fixed' : m === 'cycle' ? 'cycle' : 'calendar', season: 'summer', days: 3, lapse: -.12, seaY: Vx.SEA || 52, front: 0,
      climateAt: (x, z) => BIOME_CLIM[X.biome] || 'temperate', hourAt: () => R.lighting.time, gameTime: () => ({ day: st.meta?.day || 1, hour: R.lighting.time || 0 }) }; };
    if (C?.attach) {
      try {
        X.clim = C.attach(R, { world: worldCfg(), where: () => [st.P.x - st.ox, st.P.y, st.P.z - st.oz], origin: () => [st.ox, st.oz], particles: false, sky: false, occlusion: false });
      } catch (e) { console.warn('Кубомир: погода движка', e); X.clim = null; }
    }
    X.setSeasons = m => { st.seasons = m; X.clim?.setWorld(worldCfg()); tq = 0; };
    // осень и зима — цвет биома (трава, листва) по сезону; лёд — у воды под открытым небом (крючок шейдеров движка)
    const VR = st.VR, offShader = [];
    if (VR?.onShader && C && window.D37E?.climShaders) {
      offShader.push(VR.onShader('*', sh => {
        if (!window.D37E?.climShaders) return;   // страж графики снял погоду — без крючка
        sh.fragmentShader = sh.fragmentShader.replace('diffuseColor.rgb *= vColor * vColor;', `vec3 d37bc = vColor;
#ifdef D37_CLIM
if ( d37Cl2.x + d37Cl2.y + d37Cl2.z > 0.0 ) {
  vec3 d37Vk = - vViewPosition;
  vec2 d37Qk = d37ClO.xy + vec2( dot( viewMatrix[ 0 ].xyz, d37Vk ), dot( viewMatrix[ 2 ].xyz, d37Vk ) );
  d37bc = d37Leaf( vColor, d37Cn( d37Qk * 0.0625, 16.0 ), 2.0 );
}
#endif
diffuseColor.rgb *= d37bc * d37bc;`);
      }, 'clim-leaf'));
      offShader.push(VR.onShader('water', sh => {
        if (!window.D37E?.climShaders) return;
        sh.fragmentShader = sh.fragmentShader.replace('d37uv.xy += vec2( uTime * 0.03, uTime * 0.05 );', 'd37uv.xy += vec2( uTime * 0.03, uTime * 0.05 ) * ( 1.0 - step( 0.3, d37Cl.w ) );')
          .replace('#include <emissivemap_fragment>', `#ifdef D37_CLIM
if ( d37Cl.w > 0.0 ) {
  vec3 d37Vi = - vViewPosition;
  vec2 d37Qi = d37ClO.xy + vec2( dot( viewMatrix[ 0 ].xyz, d37Vi ), dot( viewMatrix[ 2 ].xyz, d37Vi ) );
  float d37i1 = d37Cn( d37Qi * 0.5, 128.0 ), d37i2 = d37Cn( d37Qi * 2.0, 512.0 );
  vec3 d37ic = mix( vec3( 0.66, 0.8, 0.9 ), vec3( 0.88, 0.94, 0.99 ), d37i2 ) * ( 1.0 - 0.2 * ( 1.0 - smoothstep( 0.0, 0.05, abs( d37i1 - 0.5 ) ) ) );
  d37ic = mix( d37ic, vec3( 0.88, 0.91, 0.96 ), smoothstep( d37i2 - 0.1, d37i2 + 0.1, d37Cl.x ) * 0.85 );
  float d37ik = smoothstep( 0.0, 0.35, d37Cl.w ) * smoothstep( 0.5, 0.9, vLt.x );
  diffuseColor = vec4( mix( diffuseColor.rgb, d37ic, d37ik ), mix( diffuseColor.a, 0.97, d37ik ) );
}
#endif
#include <emissivemap_fragment>`);
      }, 'clim-ice'));
    }
    // по льду можно ходить: верхний блок воды под открытым небом — твёрдый до глади (блоки мира не меняются)
    Vx.iceTest = (Wd, x, y, z) => {
      if (!X.clim || X.clim.vis.ice < .8 || st.weatherOff) return false;
      const up = Wd.raw(x, y + 1, z); if (up < 0 || TT.liquid[up & 0xfff]) return false;
      return !Wd.lightAt || Vx.lSky(Wd.lightAt(x, y + 1, z)) >= 13;
    };

    // ── столбы: где кончается небо (код: верх × 8 · 2 + вода) ──
    const cols = new Map();
    let colsT = 0, topW = false;
    const ckey = (x, z) => (x + 5e5) * 1e6 + (z + 5e5);
    function top(x, z){
      x = Math.floor(x); z = Math.floor(z);
      const key = ckey(x, z);
      let c = cols.get(key);
      if (c === undefined) {
        const ch = W.chunkAt ? W.chunkAt(x, z) : null;
        let y = Math.min(Vx.H - 1, ch && ch.maxY != null ? ch.maxY + 1 : Vx.H - 1), tp = 0, wet = 0;
        if (ch && !ch.gen) tp = 999;   // не загружено — неба нет
        else {
          for (; y >= 0; y--) {
            const v = W.raw(x, y, z); if (v === 0) continue;
            if (v < 0) { tp = 999; break; }
            const t = v & 0xfff, sh = TT.shape[t];
            if (sh === SH.cross || sh === SH.torch) continue;
            if (TT.liquid[t]) { tp = y + Vx.liquidHeight(v); wet = TT.liquid[t] === 1 ? 1 : 0; } else tp = y + 1;
            break;
          }
        }
        c = Math.round(Math.min(999, tp) * 8) * 2 + wet;
        cols.set(key, c);
      }
      topW = (c & 1) === 1;
      return (c >> 1) / 8;
    }
    X.top = top;
    const onEdit = (x, y, z) => cols.delete(ckey(Math.floor(x), Math.floor(z)));
    W.listeners?.push(onEdit);

    // ── дождь: отрезки вокруг камеры (низ видно, верх прозрачный) ──
    const RN = Math.round(560 * q), rx = new Float64Array(RN), ry = new Float64Array(RN), rz = new Float64Array(RN), rv = new Float32Array(RN), rl = new Float32Array(RN), rt = new Float32Array(RN), rw = new Uint8Array(RN), rlive = new Uint8Array(RN), rcx = new Int32Array(RN), rcz = new Int32Array(RN);
    let rainO = null, rPos = null, rCol = null;
    if (RN) {
      rPos = new Float32Array(RN * 6); rCol = new Float32Array(RN * 8);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(rPos, 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('color', new T.BufferAttribute(rCol, 4).setUsage(T.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      rainO = new T.LineSegments(g, new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
      rainO.frustumCulled = false; rainO.visible = false; rainO.renderOrder = 6; R.scene.add(rainO);
    }
    // ── снег: точки-хлопья ──
    const SN = Math.round(480 * q), sx = new Float64Array(SN), sy = new Float64Array(SN), sz = new Float64Array(SN), sv = new Float32Array(SN), sp = new Float32Array(SN), stp = new Float32Array(SN), slive = new Uint8Array(SN), scx = new Int32Array(SN), scz = new Int32Array(SN);
    let snowO = null, sPos = null, sCol = null, flakeTex = null;
    if (SN) {
      sPos = new Float32Array(SN * 3); sCol = new Float32Array(SN * 3);
      const n = 16, d = new Uint8Array(n * n * 4);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const dx = (x + .5) / n * 2 - 1, dy = (y + .5) / n * 2 - 1, r = Math.sqrt(dx * dx + dy * dy), i = (y * n + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = r >= 1 ? 0 : Math.round(255 * Math.min(1, (1 - r) * 1.8)); }
      flakeTex = new T.DataTexture(d, n, n, T.RGBAFormat); flakeTex.magFilter = flakeTex.minFilter = T.LinearFilter; flakeTex.needsUpdate = true;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(sPos, 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('color', new T.BufferAttribute(sCol, 3).setUsage(T.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      snowO = new T.Points(g, new T.PointsMaterial({ size: .13, map: flakeTex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
      snowO.frustumCulled = false; snowO.visible = false; snowO.renderOrder = 6; R.scene.add(snowO);
    }
    // ── круги на воде: кольца плашмя (сложение: гаснут цветом) ──
    const RPN = q ? 32 : 0, ppx = new Float64Array(RPN), ppy = new Float32Array(RPN), ppz = new Float64Array(RPN), ppt = new Float32Array(RPN);
    let ripO = null, rpHead = 0, rpLive = 0;
    const DUM = new T.Object3D();
    if (RPN) {
      const g = new T.RingGeometry(.3, .38, 18); g.rotateX(-Math.PI / 2);
      ripO = new T.InstancedMesh(g, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: .55, toneMapped: false }), RPN);
      ripO.instanceMatrix.setUsage(T.DynamicDrawUsage);
      ripO.instanceColor = new T.InstancedBufferAttribute(new Float32Array(RPN * 3), 3); ripO.instanceColor.setUsage(T.DynamicDrawUsage);
      ripO.count = 0; ripO.visible = false; ripO.frustumCulled = false; ripO.renderOrder = 6; R.scene.add(ripO);
      for (let i = 0; i < RPN; i++) ppt[i] = 9;
    }
    function ripple(x, y, z){ const j = rpHead; rpHead = (rpHead + 1) % RPN; ppx[j] = x; ppy[j] = y; ppz[j] = z; ppt[j] = 0; rpLive = 1; }

    // капля: в случайной точке над камерой, только если столб там открыт выше точки (крыша, дерево — не тут)
    function spawnDrop(i, cx, cy, cz, fill){
      for (let k = 0; k < 3; k++) {
        const x = cx + (FR() - .5) * 2 * RAD, z = cz + (FR() - .5) * 2 * RAD, y = fill ? cy - 4 + FR() * 18 : cy + 6 + FR() * 8, tp = top(x, z);
        if (tp >= y - .5) continue;
        rx[i] = x; ry[i] = y; rz[i] = z; rt[i] = tp; rw[i] = topW ? 1 : 0; rv[i] = 13 + FR() * 4; rl[i] = .65 + FR() * .4; rlive[i] = 1; rcx[i] = Math.floor(x); rcz[i] = Math.floor(z);
        return;
      }
      rlive[i] = 0;
    }
    function spawnFlake(i, cx, cy, cz, fill){
      for (let k = 0; k < 3; k++) {
        const x = cx + (FR() - .5) * 2 * RAD, z = cz + (FR() - .5) * 2 * RAD, y = fill ? cy - 4 + FR() * 16 : cy + 8 + FR() * 5, tp = top(x, z);
        if (tp >= y - .3) continue;
        sx[i] = x; sy[i] = y; sz[i] = z; stp[i] = tp; sv[i] = 1 + FR() * .8; sp[i] = FR() * 6.283; slive[i] = 1; scx[i] = Math.floor(x); scz[i] = Math.floor(z);
        return;
      }
      slive[i] = 0;
    }

    // ── логика: расписание и биом (от часов игры) ──
    X.biomeOf = (x, z) => { const col = st.G ? Vx.genColumn(st.G, Math.floor(x), Math.floor(z), {}) : null; return col ? Vx.BIOME_IDS[col.b] : 'plains'; };
    X.step = dt => {
      if ((tq -= dt) > 0) return;
      tq = .5;
      const L = R.lighting, P = st.P;
      if ((tb -= .5) <= 0) { tb = 2; try { X.biome = X.biomeOf(P.x, P.z); } catch (e) {} }
      if (X.clim && X.force == null) {
        const s = X.clim.state, off = st.weatherOff;
        X.wantR = off ? 0 : Math.min(1, s.rain || 0); X.wantS = off ? 0 : Math.min(1, s.snow || 0);
        X.season = s.season; X.temp = s.temp;
        return;
      }
      const w = st.weatherOff ? 0 : X.force != null ? X.force : at(W.seed, st.meta?.day || 1, L.time || 0), kind = kindAt(X.biome, P.y);
      X.wantR = kind === 'rain' ? w : 0; X.wantS = kind === 'snow' ? w : 0;
    };

    // ── кадр: сила — плавно, частицы вокруг камеры, звук, гром ──
    let hR = null, hS = null, thT = 20, thS = -1, fillR = true, fillS = true, naW = 0, nsW = 0;
    X.frame = (dt, t) => {
      try { X.clim?.frame(dt); } catch (e) {}   // состояние погоды, сезон, снег/лёд/листва для шейдеров (данные — на время кадра)
      const d = Math.min(.05, Math.max(0, dt)), P = st.P;
      X.rain += (X.wantR - X.rain) * Math.min(1, d * .7); if (X.rain < .003 && !X.wantR) X.rain = 0;
      X.snow += (X.wantS - X.snow) * Math.min(1, d * .7); if (X.snow < .003 && !X.wantS) X.snow = 0;
      X.k = Math.max(X.rain, X.snow * .5);
      if ((colsT -= d) <= 0) { colsT = 4; cols.clear(); }
      const cam = R.camera.position, cx = cam.x + st.ox, cy = cam.y, cz = cam.z + st.oz;
      // свет: небо по времени суток (ночью капли темнее); вспышка грома — светлее
      const day = 1 - Math.max(0, Math.min(1, R.night || 0)), lum = .32 + .55 * day;
      // дождь
      const na = rainO ? Math.round(RN * X.rain) : 0;
      if (rainO) {
        if (!na) { if (rainO.visible) { rainO.visible = false; rlive.fill(0); fillR = true; naW = 0; } }
        else {
          let born = 0;
          const cr = .7 * lum, cg = .78 * lum, cb = .94 * lum, a = .62;
          for (let i = 0; i < na; i++) {
            if (!rlive[i]) { if (born < 80) { spawnDrop(i, cx, cy, cz, fillR); born++; } }
            else {
              ry[i] -= rv[i] * d; rx[i] += windX * d; rz[i] += windZ * d;
              // ветер снёс в соседний столб: там крыша или стена выше капли — разбилась о неё (под навес и сквозь стены не залетает)
              const ix = Math.floor(rx[i]), iz = Math.floor(rz[i]);
              if (ix !== rcx[i] || iz !== rcz[i]) { rcx[i] = ix; rcz[i] = iz; const tp = top(rx[i], rz[i]); if (tp > ry[i]) spawnDrop(i, cx, cy, cz, false); else { rt[i] = tp; rw[i] = topW ? 1 : 0; } }
              if (rlive[i] && ry[i] <= rt[i]) {   // долетела: брызги или круг на воде (рядом с камерой), новая капля
                const dx = rx[i] - cx, dz = rz[i] - cz;
                if (dx * dx + dz * dz < 81 && FR() < .35) { if (rw[i]) { if (ripO) ripple(rx[i], rt[i], rz[i]); } else st.ents?.drip?.(rx[i], rt[i], rz[i], cr * 1.2, cg * 1.2, cb * 1.2); }
                spawnDrop(i, cx, cy, cz, false);
              } else if (rlive[i] && (Math.abs(rx[i] - cx) > RAD + 3 || Math.abs(rz[i] - cz) > RAD + 3)) spawnDrop(i, cx, cy, cz, false);
            }
            const j6 = i * 6, j8 = i * 8;
            if (rlive[i]) {
              const x = rx[i] - st.ox, z = rz[i] - st.oz, l = rl[i];
              rPos[j6] = x; rPos[j6 + 1] = ry[i]; rPos[j6 + 2] = z; rPos[j6 + 3] = x - windX * l * .07; rPos[j6 + 4] = ry[i] + l; rPos[j6 + 5] = z - windZ * l * .07;
              rCol[j8] = cr; rCol[j8 + 1] = cg; rCol[j8 + 2] = cb; rCol[j8 + 3] = a; rCol[j8 + 4] = cr; rCol[j8 + 5] = cg; rCol[j8 + 6] = cb; rCol[j8 + 7] = 0;
            } else { rCol[j8 + 3] = 0; rCol[j8 + 7] = 0; rPos[j6 + 1] = rPos[j6 + 4] = -999; }
          }
          fillR = false;
          for (let i = na; i < naW; i++) rlive[i] = 0;   // дождь слабеет — лишние капли гаснут (потом — заново сверху)
          naW = na;
          const g = rainO.geometry; g.setDrawRange(0, na * 2); g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; rainO.visible = true;
        }
      }
      // круги на воде
      if (ripO && rpLive) {
        let k = 0;
        for (let j = 0; j < RPN; j++) {
          if (ppt[j] >= .55) continue;
          ppt[j] += d; if (ppt[j] >= .55) continue;
          const f = ppt[j] / .55, s = .25 + .95 * f, c = .5 * (1 - f) * lum;
          DUM.position.set(ppx[j] - st.ox, ppy[j] + .015, ppz[j] - st.oz); DUM.scale.set(s, 1, s); DUM.updateMatrix();
          ripO.setMatrixAt(k, DUM.matrix); ripO.instanceColor.setXYZ(k, c * .8, c * .9, c); k++;
        }
        ripO.count = k; ripO.visible = k > 0; rpLive = k;
        if (k) { ripO.instanceMatrix.needsUpdate = true; ripO.instanceColor.needsUpdate = true; }
      } else if (ripO && ripO.visible) ripO.visible = false;
      // снег
      const ns = snowO ? Math.round(SN * X.snow) : 0;
      if (snowO) {
        if (!ns) { if (snowO.visible) { snowO.visible = false; slive.fill(0); fillS = true; nsW = 0; } }
        else {
          let born = 0;
          const c = .9 * lum;
          for (let i = 0; i < ns; i++) {
            if (!slive[i]) { if (born < 60) { spawnFlake(i, cx, cy, cz, fillS); born++; } }
            else {
              sy[i] -= sv[i] * d; sx[i] += (windX * .35 + Math.sin(t * 1.3 + sp[i]) * .45) * d; sz[i] += (windZ * .35 + Math.cos(t * 1.1 + sp[i] * 1.3) * .45) * d;
              const ix = Math.floor(sx[i]), iz = Math.floor(sz[i]);
              if (ix !== scx[i] || iz !== scz[i]) { scx[i] = ix; scz[i] = iz; const tp = top(sx[i], sz[i]); if (tp > sy[i]) spawnFlake(i, cx, cy, cz, false); else stp[i] = tp; }
              if (slive[i] && (sy[i] <= stp[i] || Math.abs(sx[i] - cx) > RAD + 3 || Math.abs(sz[i] - cz) > RAD + 3)) spawnFlake(i, cx, cy, cz, false);
            }
            const j3 = i * 3;
            if (slive[i]) { sPos[j3] = sx[i] - st.ox; sPos[j3 + 1] = sy[i]; sPos[j3 + 2] = sz[i] - st.oz; sCol[j3] = c; sCol[j3 + 1] = c; sCol[j3 + 2] = c * 1.05; }
            else sPos[j3 + 1] = -999;
          }
          fillS = false;
          for (let i = ns; i < nsW; i++) slive[i] = 0;
          nsW = ns;
          const g = snowO.geometry; g.setDrawRange(0, ns); g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; snowO.visible = true;
        }
      }
      // звук: под крышей (столб над глазами закрыт) — тише и глуше, в пещере — почти не слышно
      const A = st.AU;
      if (A?.loop) {
        const eye = P.y + 1.6, cov = top(P.x, P.z) > eye + .2, sky = Vx.lSky(W.lightAt(P.x, eye, P.z)) / 15;
        const vr = X.rain * .55 * (cov ? .35 * sky : 1), vs = X.snow * .4 * (cov ? .3 * sky : 1);
        if (vr > .005 && !hR) hR = A.loop('amb_rain', { vol: 0 });
        if (hR) { if (vr <= .005 && !X.rain) { hR.stop(); hR = null; } else hR.set({ vol: vr, rate: cov ? .76 : 1 }); }
        if (vs > .005 && !hS) hS = A.loop('amb_wind', { vol: 0 });
        if (hS) { if (vs <= .005 && !X.snow) { hS.stop(); hS = null; } else hS.set({ vol: vs, rate: cov ? .8 : 1 }); }
        // гром: в сильный дождь, раз в 25–60 с, далеко (сначала вспышка, через 1–3 с — раскат), только под открытым небом
        if (X.rain > .75 && !st.weatherOff) {
          if ((thT -= d) <= 0) { thT = 25 + FR() * 35; if (!cov && sky > .6) { st.flash?.(.14 + .08 * FR()); thS = 1 + FR() * 2; } }
        }
        if (thS > 0 && (thS -= d) <= 0) { thS = -1; A.play('kb_thunder', { vol: .38 + .2 * FR(), rate: .85 + FR() * .3 }); }
      }
    };
    X.stats = () => ({ biome: X.biome, season: X.clim?.state.season || '', temp: X.clim ? Math.round(X.clim.state.temp) : null, cover: X.clim ? +X.clim.vis.snowCover.toFixed(2) : 0, ice: X.clim ? +X.clim.vis.ice.toFixed(2) : 0, rain: +X.rain.toFixed(2), snow: +X.snow.toFixed(2), drops: rainO?.visible ? rainO.geometry.drawRange.count / 2 : 0, flakes: snowO?.visible ? snowO.geometry.drawRange.count : 0, ripples: ripO?.visible ? ripO.count : 0, cols: cols.size });
    X.objects = () => ({ rain: rainO, snow: snowO, ripples: ripO, rainPos: rPos, snowPos: sPos, drops: { rx, ry, rz, rt, live: rlive, n: RN }, flakes: { sx, sy, sz, stp, live: slive, n: SN } });
    X.dispose = () => {
      hR?.stop(); hS?.stop(); hR = hS = null;
      try { X.clim?.dispose(); } catch (e) {}
      X.clim = null; for (const f of offShader) try { f(); } catch (e) {}
      if (Vx.iceTest) Vx.iceTest = null;
      const i = W.listeners ? W.listeners.indexOf(onEdit) : -1; if (i >= 0) W.listeners.splice(i, 1);
      for (const o of [rainO, snowO, ripO]) if (o) { R.scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
      flakeTex?.dispose(); cols.clear();
    };
    return X;
  }
})();
