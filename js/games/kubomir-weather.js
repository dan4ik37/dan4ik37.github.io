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
// Климатические зоны (21.10.2026, владелец: «где-то чаще дождь, где-то нет, где-то всегда зима, где-то зимы нет»; зона столба —
// V.climZone генератора, в сетке — у вершин): 0 — обычная (умеренный климат, времена года; погода одна на всю зону — что
// идёт, то и ложится), 1 — всегда зима (снега и вершины гор: снег лежит всегда, вода подо льдом, осадки — только снег),
// 2 — зимы нет (пустыня — почти без дождей, болото — часто дождь, жаркий край): ни снега, ни льда. Снег в обычной зоне ложится
// по реальному времени (coverStep): заметно — за 2–3 мин снегопада, бело — за 15–20 мин, в тепло тает; хранится в мире (meta.snow).
(() => {
  const V = () => window.D37E.vox;
  const P_RAIN = .25, SLOT = 6, RAMP = .4, RAD = 13;
  const sm = q => q * q * (3 - 2 * q);
  const CLIM = () => window.D37E?.climate || null;
  // Климаты «Кубомира» (дописываются в таблицу движка): вечная зима никогда не теплеет выше −7°, в тёплых зонах — не холоднее +10°
  const KB_CLIMATES = {
    kb_snow: { name: 'вечная зима', t: -16, amp: 4, dayA: 3, wet: .9, snowy: 1.5, fog: .8, wind: [4, 10], thunder: 0, heat: 0, cloud: .7, rh: 70 },
    kb_desert: { name: 'пустыня', t: 27, amp: 5, dayA: 8, wet: .04, snowy: 0, fog: .05, wind: [3, 8], thunder: .05, heat: 1.8, cloud: .15, rh: 20 },
    kb_swamp: { name: 'болото', t: 21, amp: 5, dayA: 4, wet: 1.7, snowy: 0, fog: 1.6, wind: [1, 5], thunder: 1.2, heat: .5, cloud: .8, rh: 90 },
    kb_warm: { name: 'тёплый край', t: 23, amp: 5, dayA: 6, wet: .8, snowy: 0, fog: .5, wind: [2, 7], thunder: 1, heat: 1, cloud: .55, rh: 60 },
  };
  // Биом и зона → климат движка (зона 0 — один умеренный климат на всю зону: где идёт снег, туда он и ложится)
  const BIOME_CLIM = { ocean: 'temperate', beach: 'temperate', plains: 'temperate', forest: 'temperate', birch: 'temperate', desert: 'kb_desert', snow: 'kb_snow', mountains: 'temperate', swamp: 'kb_swamp', river: 'temperate' };
  const climKey = (biome, zone) => zone === 1 ? 'kb_snow' : zone === 2 ? (biome === 'desert' ? 'kb_desert' : biome === 'swamp' ? 'kb_swamp' : 'kb_warm') : 'temperate';
  // Снег на земле обычной зоны (0…1) за dt реальных секунд: snow — сила снегопада, temp — °C, rain, sun, cloud — 0…1. Первые 0,3
  // (снег «пятнами» — видно) — быстрее, дальше медленнее; тает от +0,5° (солнце и дождь — быстрее)
  function coverStep(c, dt, snow, temp, rain = 0, sun = 0, cloud = 1){
    if (snow > .03) c += dt * (c < .3 ? .0018 : .00085) * Math.sqrt(Math.min(1, snow) / .7);
    if (temp > .5) c -= dt * ((.0008 + .00025 * temp) * (1 + .4 * sun * (1 - cloud)) + .002 * rain);
    return c < 0 ? 0 : c > 1 ? 1 : c;
  }
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
  window.KubomirWeather = { at, atOld, kindAt, create, BIOME_CLIM, KB_CLIMATES, climKey, coverStep };

  function create(st){
    const R = st.R, T = R.T, W = st.W, Vx = V(), E = window.D37E, TT = Vx.T, SH = Vx.SHAPE;
    const q = R.q === 'low' ? 0 : E.isMobile?.() || R.q === 'mid' ? .45 : 1;
    const X = { k: 0, rain: 0, snow: 0, wantR: 0, wantS: 0, biome: 'plains', force: null, q, top };
    const FR = Vx.rng((Vx.hash(Vx.seedOf(W.seed), 0x77e3) >>> 0) || 5);
    const wa = (Vx.hash(Vx.seedOf(W.seed), 0x77e4) & 1023) / 1023 * 6.283, windX = Math.cos(wa) * 1.1, windZ = Math.sin(wa) * 1.1;   // ветер мира
    let tq = 0, tb = 0;
    // ── движок погоды (времена года): мир по зерну, климат по зоне и биому; картинка поверхностей — attach без своих частиц ──
    const C = CLIM();
    if (C?.CLIMATES) for (const k in KB_CLIMATES) if (!C.CLIMATES[k]) C.CLIMATES[k] = KB_CLIMATES[k];
    // зона столба: из чанка (сетка знает её же), нет чанка — генератор (кэш); нет генератора — обычная
    const zCache = new Map(), zCol = {};
    const zoneAt = (x, z) => {
      const c = W.chunk ? W.chunk(x >> 4, z >> 4) : null, zz = c && c.zone;
      if (zz) return zz[((x & 15) << 4) | (z & 15)];
      if (!st.G || !Vx.climZoneAt) return 0;
      const k = x * 65536 + z; let v = zCache.get(k);
      if (v === undefined) { v = Vx.climZoneAt(st.G, x, z, zCol); if (zCache.size > 4096) zCache.clear(); zCache.set(k, v); }
      return v;
    };
    X.zoneAt = zoneAt; X.zone = 0; X.climKey = 'temperate';
    // ── особая погода по биому (T-135, js/engine/wx.js): запись места — на клетку погоды 128×128 блоков (BIOME_WEATHER §7.1). Зоны 1
    //    и 2 — свой класс (вечная зима — снега, пустыня, болото, тёплый край); обычная зона — большинство из пяти проб генератора
    //    (центр и ±32): пустыня → песчаные бури (климат дождя и снега при этом умеренный — где идёт снег, туда он и ложится), снега,
    //    болото, горы; поверхности и приметы (берег, река, вершины выше 95) — из тех же проб. От зерна мира: у всех игроков одна ──
    const wxCells = new Map(), WXB = { desert: 3, snow: 5, swamp: 7, mountains: 2 }, WXS = { desert: 0x3, beach: 0x1, ocean: 0x80, river: 0x80, plains: 0x6 | 0x20, forest: 0xa | 0x20, birch: 0xa | 0x20, mountains: 0x30, snow: 0x60, swamp: 0x184 };
    const wxCol = {}; let kbSrc = null, kbSrcG = null;   // kbSrc — источник D37E.biomes для мира (новый мир — новый источник)
    function kbRegion(x, z){
      const cx = Math.floor(x / 128), cz = Math.floor(z / 128), key = cx * 65536 + cz;
      let r = wxCells.get(key);
      if (r) return r;
      const mx = cx * 128 + 64, mz = cz * 128 + 64, zone = zoneAt(mx, mz), votes = {};
      // мир v4 (логичные биомы T-116, js/engine/biomes.js): обычная зона — запись места из D37E.biomes (степь и саванна — по жаре
      // и сухости, тропики, берег, вершины), зоны 1 и 2 — как ниже
      if (zone === 0 && st.G && st.G.ver >= 4 && window.D37E.biomes?.region) {
        const q = window.D37E.biomes.region(kbSrcG === st.G ? kbSrc : (kbSrcG = st.G, kbSrc = window.D37E.biomes.kb(st.G)), mx, mz, 128, {});
        r = { cls: q.cls | 0, smask: q.smask | 0, F: q.F | 0, alt: 0, kc: 0 };
        if (wxCells.size > 512) wxCells.clear();
        wxCells.set(key, r);
        return r;
      }
      let smask = 0, F = 0, best = '', bn = 0;
      for (const [dx, dz] of [[0, 0], [32, 0], [-32, 0], [0, 32], [0, -32]]) {
        const col = st.G ? Vx.genColumn(st.G, mx + dx, mz + dz, wxCol) : null, b = col ? Vx.BIOME_IDS[col.b] : 'plains';
        smask |= WXS[b] || 0x6;
        if (b === 'ocean' || b === 'beach') F |= 1; if (b === 'river') F |= 2; if (col && col.h > 95) F |= 8;
        votes[b] = (votes[b] || 0) + (dx === 0 && dz === 0 ? 1.5 : 1);   // ничья — к центру
        if (votes[b] > bn) { bn = votes[b]; best = b; }
      }
      const cls = zone === 1 ? 5 : zone === 2 ? (best === 'desert' ? 3 : best === 'swamp' ? 7 : 8) : (WXB[best] ?? 0);
      r = { cls, smask: smask | (zone === 1 ? 0x60 : 0), F, alt: 0, kc: 0 };
      if (wxCells.size > 512) wxCells.clear();
      wxCells.set(key, r);
      return r;
    }
    let cOver = null;   // свой климат на один замер (умеренный — для снега и луж обычной зоны)
    const seasonsMode = () => st.seasons || 'calendar';
    const worldCfg = () => { const m = seasonsMode(); return { seed: 'kb:' + W.seed, mode: m === 'off' ? 'fixed' : m === 'cycle' ? 'cycle' : 'calendar', season: 'summer', days: 3, lapse: 0, seaY: Vx.SEA || 52, front: 0,
      climateAt: () => cOver || X.climKey, hourAt: () => R.lighting.time, gameTime: () => ({ day: st.meta?.day || 1, hour: R.lighting.time || 0 }), wxRegionAt: kbRegion, realm: 'kids' }; };
    if (C?.attach) {
      try {
        X.clim = C.attach(R, { world: worldCfg(), where: () => [st.P.x - st.ox, st.P.y, st.P.z - st.oz], origin: () => [st.ox, st.oz], particles: false, sky: false, occlusion: false });
      } catch (e) { console.warn('Кубомир: погода движка', e); X.clim = null; }
    }
    // картинка особой погоды (wx-fx.js): песок, пыль и снег в воздухе, позёмка; небо и туман «Кубомир» темнит сам — wx-fx только
    // добавляет цвет бури и видимость (R.setWeather), пока она идёт
    const WXO = [0, 0];
    X.wfx = E.wxfx?.attach ? E.wxfx.attach(R, { top: (x, z) => top(x, z), origin: () => { WXO[0] = st.ox; WXO[1] = st.oz; return WXO; }, q }) : null;
    X.setSeasons = m => { st.seasons = m; X.clim?.setWorld(worldCfg()); tq = 0; X.cover = -1; };   // снег на земле — заново по новому календарю
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
      // лёд на воде: виден ровно тогда, когда по нему можно ходить (uKbIce.x — X.iceK, плавно за X.iceOn); проруби (uKbHoles:
      // клетка и сколько ещё открыта) — открытая вода, к концу срока затягиваются
      offShader.push(VR.onShader('water', sh => {
        if (!window.D37E?.climShaders) return;
        sh.uniforms.uKbIce = uIce; sh.uniforms.uKbHoles = uHoles;
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec4 uKbIce;
uniform vec4 uKbHoles[ ${HN} ];`)
          .replace('d37uv.xy += vec2( uTime * 0.03, uTime * 0.05 );', `float d37IZ = uKbIce.z > 0.5 ? ( vD37Z < 0.5 ? uKbIce.x : ( vD37Z < 1.5 ? uKbIce.y : 0.0 ) ) : uKbIce.x;
d37uv.xy += vec2( uTime * 0.03, uTime * 0.05 ) * ( 1.0 - step( 0.3, d37IZ ) );`)
          .replace('#include <emissivemap_fragment>', `#ifdef D37_CLIM
if ( d37IZ > 0.0 ) {
  vec3 d37Vi = - vViewPosition;
  vec2 d37Qi = d37ClO.xy + vec2( dot( viewMatrix[ 0 ].xyz, d37Vi ), dot( viewMatrix[ 2 ].xyz, d37Vi ) );
  float d37i1 = d37Cn( d37Qi * 0.5, 128.0 ), d37i2 = d37Cn( d37Qi * 2.0, 512.0 );
  vec3 d37ic = mix( vec3( 0.66, 0.8, 0.9 ), vec3( 0.88, 0.94, 0.99 ), d37i2 ) * ( 1.0 - 0.2 * ( 1.0 - smoothstep( 0.0, 0.05, abs( d37i1 - 0.5 ) ) ) );
  d37ic = mix( d37ic, vec3( 0.88, 0.91, 0.96 ), smoothstep( d37i2 - 0.1, d37i2 + 0.1, d37Cl.x ) * 0.45 );   // снег на льду — пятнами (лёд видно)
  float d37h = 0.0;
  for ( int i = 0; i < ${HN}; i ++ ) {
    vec4 hq = uKbHoles[ i ];
    vec3 dd = vWp - hq.xyz;
    d37h = max( d37h, step( 0.0, dd.x ) * step( dd.x, 1.0 ) * step( 0.0, dd.z ) * step( dd.z, 1.0 ) * step( abs( dd.y - 0.5 ), 0.6 ) * hq.w );
  }
  float d37ik = d37IZ * smoothstep( 0.5, 0.9, vLt.x ) * ( 1.0 - d37h );
  diffuseColor = vec4( mix( diffuseColor.rgb, d37ic, d37ik ), mix( diffuseColor.a, 0.97, d37ik ) );
  d37IceK = d37ik;   // шейдер воды (voxel-render.js): подо льдом — без волн, пены и прозрачности по глубине
}
#endif
#include <emissivemap_fragment>`);
      }, 'clim-ice2'));
    }
    // ── лёд (21.10.2026: владелец застрял подо льдом и не мог его сломать). Верхний блок воды под открытым небом — лёд (блоки
    // мира не меняются): держит сверху и сбоку, снизу — нет (voxel.js). X.iceOn — мороз: включается, когда лёд по погоде ≥ 0,8,
    // гаснет ниже 0,72 (без мигания на границе); вид льда в шейдере идёт за ним же (X.iceK — плавно за 2 с): что видно, по тому
    // и можно ходить. Проруби (разбил, проломил снизу) — X.holes, в мире (meta.ice, переживают перезагрузку): открыта ICE_REFREEZE
    // реального времени и замерзает снова, если ещё мороз; кончился мороз — все проруби забыты ──
    const ICE_REFREEZE = 5 * 60000, ICE_FADE = 20000, HOLES_MAX = 256;
    X.iceOn = false; X.iceK = 0; X.iceForce = null;   // iceForce — проверки (node): true / false — мороз «вручную»
    X.ice1On = false; X.ice1K = 0;   // зона «всегда зима»: лёд всегда (пока погода и её шейдеры включены)
    const ssrLook = R.ssrLook = { ripple: 1, soft: 0 };   // вид воды и льда в отражениях движка (post.js), только пока мир открыт
    X.ICE_REFREEZE = ICE_REFREEZE;
    const holes = X.holes = new Map();   // клетка → время, когда разбили (Date.now())
    let holesDirty = true, holesT = 0;
    const hkey = (x, y, z) => (x + 5e5) * 1e6 * 128 + (z + 5e5) * 128 + y;
    {   // проруби из мира
      const h = st.meta?.ice?.h;
      if (Array.isArray(h)) for (const r of h) if (Array.isArray(r) && r.length >= 4 && r.slice(0, 4).every(Number.isFinite)) holes.set(hkey(r[0] | 0, r[1] | 0, r[2] | 0), [r[0] | 0, r[1] | 0, r[2] | 0, +r[3]]);
    }
    const holesSave = () => { if (st.meta) st.meta.ice = holes.size ? { h: [...holes.values()] } : undefined; };
    X.hole = (x, y, z, t = Date.now()) => {
      x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      const k = hkey(x, y, z), had = holes.has(k);
      holes.set(k, [x, y, z, t]);
      if (holes.size > HOLES_MAX) holes.delete(holes.keys().next().value);   // самая старая — замёрзла
      holesSave(); holesDirty = true;
      return !had;
    };
    X.isHole = (x, y, z) => holes.has(hkey(Math.floor(x), Math.floor(y), Math.floor(z)));
    // мороз по погоде: с запасом (вкл ≥ 0,8, выкл < 0,72); выключили погоду или страж графики снял кусок погоды в шейдерах
    // (льда не видно) — льда нет: что видно, по тому и ходишь
    X.iceTick = () => {
      const on = !st.weatherOff && !!X.clim && !!window.D37E?.climShaders, v = on ? (X.tz ? X.tz.ice : X.clim.vis.ice) || 0 : 0;
      if (X.iceForce != null) X.iceOn = !!X.iceForce;
      else if (!X.iceOn && v >= .8) X.iceOn = true;
      else if (X.iceOn && v < .72) X.iceOn = false;
      X.ice1On = X.iceForce != null ? !!X.iceForce : on;
      if (holes.size) {   // оттаяло — проруби не нужны; замёрзшие снова — забыть (без мусора: forEach с готовой функцией)
        refNow = Date.now(); refCh = false; holes.forEach(refCb); if (refCh) { holesSave(); holesDirty = true; }
      }
    };
    let refNow = 0, refCh = false;
    const refCb = (r, k) => {
      const zn = zoneAt(r[0], r[2]), frozen = zn === 1 ? X.ice1On : zn === 0 && X.iceOn;
      if (!frozen || refNow - r[3] > ICE_REFREEZE) { holes.delete(k); refCh = true; }
    };
    Vx.iceTest = (Wd, x, y, z) => {
      const zn = zoneAt(x, z);
      if (zn === 2 || !(zn === 1 ? X.ice1On : X.iceOn)) return false;
      const up = Wd.raw(x, y + 1, z); if (up < 0 || TT.liquid[up & 0xfff]) return false;
      if (holes.size && holes.has(hkey(x, y, z))) return false;
      return !Wd.lightAt || Vx.lSky(Wd.lightAt(x, y + 1, z)) >= 13;
    };
    // проруби — в шейдер воды (до 16 ближних к игроку): клетка (x − ox, y, z − oz) и сколько открыта (1 — вода, к концу — тонкий лёд)
    const HN = 16, uHoles = { value: Array.from({ length: HN }, () => new T.Vector4(0, -999, 0, 0)) }, uIce = { value: new T.Vector4(0, 0, 0, 0) };
    // ближние 16 — выбором (прорубей ≤ 256), без массивов на каждый вызов
    const hList = new Array(HOLES_MAX + 1).fill(null), hDist = new Float64Array(HOLES_MAX + 1);
    let hN = 0, hPx = 0, hPz = 0;
    const hAdd = r => { const d = Math.abs(r[0] + .5 - hPx) + Math.abs(r[2] + .5 - hPz); if (d < 96 && hN <= HOLES_MAX) { hList[hN] = r; hDist[hN] = d; hN++; } };
    function holesUniform(){
      const now = Date.now();
      hN = 0; hPx = st.P.x; hPz = st.P.z;
      if (holes.size) holes.forEach(hAdd);
      for (let i = 0; i < HN; i++) {
        const v = uHoles.value[i];
        if (i >= hN) { v.set(0, -999, 0, 0); continue; }
        let b = i; for (let j = i + 1; j < hN; j++) if (hDist[j] < hDist[b]) b = j;
        if (b !== i) { const tr = hList[i], td = hDist[i]; hList[i] = hList[b]; hDist[i] = hDist[b]; hList[b] = tr; hDist[b] = td; }
        const r = hList[i], left = ICE_REFREEZE - (now - r[3]);
        v.set(r[0] - st.ox, r[1], r[2] - st.oz, Math.max(0, Math.min(1, left / ICE_FADE)));
      }
      for (let i = 0; i < hN; i++) hList[i] = null;
      holesDirty = false;
    }

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
    // снег на земле обычной зоны (0…1), по реальному времени; −1 — взять оценку движка (прошлые 30 погодных часов). Из мира —
    // только свежий (меньше 10 мин назад), иначе погода за это время своя
    const snowM = st.meta ? (st.meta.snow && typeof st.meta.snow === 'object' ? st.meta.snow : (st.meta.snow = { c: 0, t: 0 })) : { c: 0, t: 0 };
    X.cover = snowM.t && Date.now() - snowM.t < 10 * 60000 && Number.isFinite(+snowM.c) ? Math.max(0, Math.min(1, +snowM.c)) : -1;
    let coverAt = 0;
    X.step = dt => {
      if ((tq -= dt) > 0) return;
      tq = .5;
      const L = R.lighting, P = st.P;
      if ((tb -= .5) <= 0) {
        tb = 2;
        try { X.biome = X.biomeOf(P.x, P.z); X.zone = zoneAt(Math.floor(P.x), Math.floor(P.z)); X.climKey = climKey(X.biome, X.zone); } catch (e) {}
      }
      if (X.clim) {
        // обычная зона — один умеренный климат (снег, мокрое, лёд), где бы ни стоял игрок
        cOver = 'temperate';
        try { X.tz = X.clim.W.at(P.x, P.z, Date.now(), P.y); } catch (e) { X.tz = null; }
        cOver = null;
        const now = Date.now(), dtr = coverAt ? Math.min(5, Math.max(0, (now - coverAt) / 1000)) : 0, tz = X.tz;
        coverAt = now;
        if (st.weatherOff || !tz) X.cover = 0;
        else {
          if (X.cover < 0) X.cover = tz.snowCover || 0;
          const forced = X.force != null && X.zone === 0, sn = forced ? X.wantS : tz.snow, tp = forced && X.wantS > .03 ? Math.min(0, tz.temp) : tz.temp;
          X.cover = coverStep(X.cover, dtr, sn, tp, forced ? X.wantR : tz.rain, tz.sun || 0, tz.cloud || 0);
        }
        snowM.c = Math.round(X.cover * 1000) / 1000; snowM.t = now;
      }
      if (X.clim && X.force == null) {
        const s = X.clim.state, off = st.weatherOff;
        X.wantR = off ? 0 : Math.min(1, s.rain || 0); X.wantS = off ? 0 : Math.min(1, s.snow || 0);
        X.season = s.season; X.temp = s.temp;
        return;
      }
      const w = st.weatherOff ? 0 : X.force != null ? X.force : at(W.seed, st.meta?.day || 1, L.time || 0);
      const kind = X.clim ? (X.zone === 1 ? 'snow' : X.biome === 'desert' ? '' : X.zone === 0 && X.tz && X.tz.temp < .5 ? 'snow' : 'rain') : kindAt(X.biome, P.y);
      X.wantR = kind === 'rain' ? w : 0; X.wantS = kind === 'snow' ? w : 0;
    };

    // ── кадр: сила — плавно, частицы вокруг камеры, звук, гром ──
    let hR = null, hS = null, thT = 20, thS = -1, fillR = true, fillS = true, naW = 0, nsW = 0;
    X.frame = (dt, t) => {
      try { X.clim?.frame(dt); } catch (e) {}   // состояние погоды, сезон, снег/лёд/листва для шейдеров (данные — на время кадра)
      if (X.wfx) try {   // особая погода по биому: буря плавно, частицы, цвет неба и видимость (сломалась — без неё)
        const o2 = X.clim?.opts, on = X.clim && !st.weatherOff && o2?.fx !== false;
        X.wfx.frame(dt, on ? X.clim.state : null, o2 ? o2.amount : 1, 1 - Math.max(0, Math.min(1, R.night || 0)));
        X.wfx.pushSky(R);
      } catch (e) { console.warn('Кубомир: особая погода', e); try { X.wfx.dispose(); } catch (e2) {} X.wfx = null; }
      const d = Math.min(.05, Math.max(0, dt)), P = st.P;
      // лёд: мороз (с запасом), вид — плавно за ним, проруби — в шейдер (раз в 0,5 с или сразу, если новая)
      X.iceTick();
      X.iceK += ((X.iceOn ? 1 : 0) - X.iceK) * Math.min(1, d * 1.5); if (Math.abs(X.iceK - (X.iceOn ? 1 : 0)) < .002) X.iceK = X.iceOn ? 1 : 0;
      X.ice1K += ((X.ice1On ? 1 : 0) - X.ice1K) * Math.min(1, d * 1.5); if (Math.abs(X.ice1K - (X.ice1On ? 1 : 0)) < .002) X.ice1K = X.ice1On ? 1 : 0;
      uIce.value.x = X.iceK; uIce.value.y = X.ice1K; uIce.value.z = X.clim ? 1 : 0;
      // поверхности по зонам (кусок D37_CLIM движка, у вершин — зона): обычная — снег, мокрое и лужи умеренного климата,
      // «всегда зима» — снег всегда, «зимы нет» — без снега; мокрое там — своё, пока игрок в этой зоне (дождь на болоте), иначе сухо
      if (X.clim) {
        const vis = X.clim.vis, tz = X.tz, fx = X.clim.opts?.fx !== false, k3 = 1 - Math.exp(-d / 3), S0 = X.clim.state, warm = fx && X.zone === 2;
        if (X.cover >= 0) vis.snowCover += ((fx ? X.cover : 0) - vis.snowCover) * k3;
        if (tz) { vis.wet += ((fx ? tz.wet || 0 : 0) - vis.wet) * k3 * .5; vis.puddle += ((fx ? tz.puddle || 0 : 0) - vis.puddle) * k3 * .5; }
        const zu = VR?.U?.d37ClZ?.value;
        if (zu) {
          zu[0] = fx && X.ice1On ? 1 : 0;
          zu[1] += ((warm ? S0.wet || 0 : 0) - zu[1]) * k3; zu[2] += ((warm ? S0.puddle || 0 : 0) - zu[2]) * k3; zu[3] = 1;
        }
      }
      if (holesDirty || (holesT -= d) <= 0) { holesT = .5; holesUniform(); }
      // отражения в экране: вода — как зеркало по френелю (с рябью), лёд — чуть блестит, мягко и без ряби (слабее),
      // снег и блоки — матовые (кода блеска нет)
      const rf = Math.round((1 - .7 * X.iceK) * 20) / 20;
      if (rf !== X.reflNow && R.setLighting) { X.reflNow = rf; R.setLighting({ gfx: { rt: { refl: rf } } }); }
      ssrLook.ripple = 1 - X.iceK; ssrLook.soft = .85 * X.iceK;
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
    X.stats = () => ({ biome: X.biome, zone: X.zone, clim: X.climKey, season: X.clim?.state.season || '', temp: X.clim ? Math.round(X.clim.state.temp) : null, cover: X.clim ? +X.clim.vis.snowCover.toFixed(2) : 0, cover0: +Math.max(0, X.cover).toFixed(3), ice: X.tz ? +(X.tz.ice || 0).toFixed(2) : 0, iceOn: X.iceOn, ice1On: X.ice1On, holes: holes.size, rain: +X.rain.toFixed(2), snow: +X.snow.toFixed(2), drops: rainO?.visible ? rainO.geometry.drawRange.count / 2 : 0, flakes: snowO?.visible ? snowO.geometry.drawRange.count : 0, ripples: ripO?.visible ? ripO.count : 0, cols: cols.size });
    X.objects = () => ({ rain: rainO, snow: snowO, ripples: ripO, rainPos: rPos, snowPos: sPos, drops: { rx, ry, rz, rt, live: rlive, n: RN }, flakes: { sx, sy, sz, stp, live: slive, n: SN } });
    X.dispose = () => {
      hR?.stop(); hS?.stop(); hR = hS = null;
      try { X.clim?.dispose(); } catch (e) {}
      try { X.wfx?.dispose(); } catch (e) {}
      X.clim = null; X.wfx = null; wxCells.clear(); for (const f of offShader) try { f(); } catch (e) {}
      if (Vx.iceTest) Vx.iceTest = null;
      const i = W.listeners ? W.listeners.indexOf(onEdit) : -1; if (i >= 0) W.listeners.splice(i, 1);
      for (const o of [rainO, snowO, ripO]) if (o) { R.scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
      flakeTex?.dispose(); cols.clear();
      if (R.ssrLook === ssrLook) R.ssrLook = null;
      const zu = VR?.U?.d37ClZ?.value; if (zu) zu[3] = 0;
      zCache.clear();
    };
    return X;
  }
})();
