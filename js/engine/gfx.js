// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — графика v3: небо по времени суток (солнце, луна, звёзды, заря, дымка), свет неба, туман с высотой
//  и свечением к солнцу, мягкие тени (PCSS-lite), вода v2, пресеты качества и настройки игрока, настройки графики мира
//  (lighting.gfx: небо, туман, цвет кадра, свечение, вода, мягкость теней), цветокоррекция, автокачество
// ═══════════════════════════════════════
// Подключается перед render.js. Чистые функции (проверяются в node, scripts/render-test.cjs):
//   E.gfxResolve(настройки игрока, { q }) → что включено (тени и их качество, затенение AO, вода, отражения, сглаживание,
//   туман, дальность, цвет кадра, лимит FPS, масштаб разрешения, экономия батареи); E.autoSteps(o) — лесенка автокачества;
//   E.worldGfx(d) — настройки графики мира (lighting.gfx) с проверкой; E.WORLD_PRESETS — Солнечный день, Закат, Ночь…;
//   E.GRADES / E.gradeOf(имя) — цветокоррекция; E.sunAt(время) / E.skyModel(время, небо) / E.skyColor(модель, направление) —
//   небо; E.dayClock(мс, минут в сутках, доля ночи) — общее время суток мира.
// С three.js: E.gfxPatch(T) — один раз меняет куски шейдеров three (туман, тени) для ВСЕХ материалов, данные — общие
// массивы E.GFXU (Float32Array: three копирует их по ссылке, одно обновление доходит до всех материалов); без данных
// (нули) шейдеры работают как раньше. E.skyMaterial(T) — купол неба; E.waterMaterial(R, цвет, opts) — вода v2.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const PI = Math.PI, DEG = PI / 180;
  const cl = (v, a, b) => v < a ? a : v > b ? b : v;
  const num = (v, d) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : d; };
  const sm = (a, b, x) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mixA = (a, b, t, out) => { for (let i = 0; i < 3; i++) out[i] = a[i] + (b[i] - a[i]) * t; return out; };
  // '#rrggbb' (sRGB) → линейные [r, g, b]
  const toLin = x => x <= .04045 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4);
  E.lin = (hex, out = [0, 0, 0]) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) { out[0] = out[1] = out[2] = 0; return out; }
    const v = parseInt(m[1], 16);
    out[0] = toLin((v >> 16 & 255) / 255); out[1] = toLin((v >> 8 & 255) / 255); out[2] = toLin((v & 255) / 255);
    return out;
  };
  const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  // ACES как в three.js r149 (для цвета тумана и проверок): линейное → «на экране» (линейное 0…1)
  E.aces = (c, exposure = 1, out = [0, 0, 0]) => {
    const k = exposure / .6, r = c[0] * k, g = c[1] * k, b = c[2] * k;
    const a0 = .59719 * r + .35458 * g + .04823 * b, a1 = .076 * r + .90834 * g + .01566 * b, a2 = .0284 * r + .13383 * g + .83777 * b;
    const f = x => (x * (x + .0245786) - .000090537) / (x * (.983729 * x + .432951) + .238081);
    const b0 = f(a0), b1 = f(a1), b2 = f(a2);
    out[0] = cl(1.60475 * b0 - .53108 * b1 - .07367 * b2, 0, 1); out[1] = cl(-.10208 * b0 + 1.10813 * b1 - .00605 * b2, 0, 1); out[2] = cl(-.00327 * b0 - .07276 * b1 + 1.07602 * b2, 0, 1);
    return out;
  };

  // ═══ Качество: пресеты и настройки игрока ═══
  // tier — «каркас» рендерера (low — Ламберт без теней и постобработки; mid; high — MSAA, рельеф текстур, 8 ламп): меняется
  // только пересборкой мира. Остальное меняется на живую (R.applyGfx).
  const SHQ = ['low', 'mid', 'high', 'ultra'];
  // rt — «Трассировка лучей» (post.js): off; on — отражения в экране + контактные тени; high — больше шагов луча и цветной отскок
  const P = E.GFX_PRESETS = {
    low: { tier: 'low', shadows: false, shadowQ: 'low', ao: 'off', water: 'simple', refl: false, aa: 'off', fog: true, dist: .8, grade: false, rt: 'off' },
    mid: { tier: 'mid', shadows: true, shadowQ: 'mid', ao: 'off', water: 'good', refl: true, aa: 'fxaa', fog: true, dist: 1, grade: true, rt: 'off' },
    high: { tier: 'high', shadows: true, shadowQ: 'high', ao: 'on', water: 'good', refl: true, aa: 'msaa', fog: true, dist: 1.25, grade: true, rt: 'on' },
    ultra: { tier: 'high', shadows: true, shadowQ: 'ultra', ao: 'high', water: 'good', refl: true, aa: 'msaa', fog: true, dist: 1.6, grade: true, rt: 'high' },
  };
  // Значения настроек игрока (js/core/gfx-settings.js кладёт их в window.D37Opt.gfx)
  E.GFX_KEYS = {
    preset: ['auto', 'low', 'mid', 'high', 'ultra', 'custom'], shadowQ: SHQ, ao: ['off', 'on', 'high'], water: ['simple', 'good'],
    aa: ['off', 'fxaa', 'msaa'], fpsCap: [0, 30, 45, 60, 90, 120], upscaler: ['fsr', 'nis', 'off'], rt: ['off', 'on', 'high'],
  };
  const pick = (v, list, d) => list.includes(v) ? v : d;
  // s — настройки игрока: { preset, shadows, shadowQ, ao, water, refl, aa, fog, dist (0,5…2), grade, fpsCap, res (50…100), battery }
  // dev — { q: каркас рендерера / устройства (low|mid|high), gl2, mobile — телефон/планшет (E.isMobile), depthFx — глубина
  // кадра читается точно (post.js: P.depthOK) }. Возвращает включённое (без лишних полей)
  E.gfxResolve = (s = {}, dev = {}) => {
    const q = ['low', 'mid', 'high'].includes(dev.q) ? dev.q : 'mid';
    const preset = pick(s.preset, E.GFX_KEYS.preset, 'auto'), own = preset === 'auto' || preset === 'custom';
    const base = P[own ? q : preset];
    const o = { ...base, preset, auto: preset === 'auto', tier: own ? q : base.tier };
    if (preset === 'custom') {
      if (typeof s.shadows === 'boolean') o.shadows = s.shadows;
      o.shadowQ = pick(s.shadowQ, SHQ, o.shadowQ); o.ao = pick(s.ao, E.GFX_KEYS.ao, o.ao); o.water = pick(s.water, E.GFX_KEYS.water, o.water);
      if (typeof s.refl === 'boolean') o.refl = s.refl;
      o.aa = pick(s.aa, E.GFX_KEYS.aa, o.aa);
      o.rt = pick(s.rt, E.GFX_KEYS.rt, o.rt);
      if (typeof s.fog === 'boolean') o.fog = s.fog;
      if (s.dist !== undefined) o.dist = cl(num(s.dist, o.dist), .5, 2);
      if (typeof s.grade === 'boolean') o.grade = s.grade;
    } else if (s.shadows === false) o.shadows = false;   // «Тени: выкл» в любом пресете (как было до пресетов)
    o.fpsCap = E.GFX_KEYS.fpsCap.includes(+s.fpsCap) ? +s.fpsCap : 0;
    o.res = cl(Math.round(num(s.res, 100)), 50, 100);
    // апскейлер уменьшенного кадра (FSR 1 — AMD, NIS — NVIDIA, выкл) и резкость 0…1 — не зависят от пресета
    o.upscaler = pick(s.upscaler, E.GFX_KEYS.upscaler, 'fsr');
    o.sharp = cl(Math.round(num(s.sharp, 50)), 0, 100) / 100;
    o.framegen = s.framegen === true;   // «Генерация кадров (×2)» — выключена, пока игрок не включит
    // набор шейдеров (E.PACKS) — какой хочет игрок; что включится на этом устройстве, решает render.js (E.packResolve)
    // ключ настройки — общий с 2D-наборами (js/engine/shade2d.js): 'shaders'; старое имя 'pack' — тоже
    { const w = s.shaders ?? s.pack; o.pack = w === 'auto' || (typeof w === 'string' && E.PACKS && E.PACKS[w]) ? w : 'auto'; }
    o.crt = s.crt === true;   // «Полоски CRT» (только у «Ретро»)
    o.dof = s.dof !== false;   // «Глубина резкости» набора «Ультра» (автофокус по середине кадра) — включена, пока игрок не выключит
    o.battery = !!s.battery;
    o.prCap = o.tier === 'low' ? 1 : o.tier === 'mid' ? 1.5 : 2;
    if (o.battery) {   // экономия батареи: 30 кадров, без AO и трассировки, тени попроще, ближе дальность, плотность пикселей 1
      o.fpsCap = o.fpsCap ? Math.min(o.fpsCap, 30) : 30;
      o.ao = 'off'; o.rt = 'off'; if (SHQ.indexOf(o.shadowQ) > 1) o.shadowQ = 'mid';
      if (o.aa === 'msaa') o.aa = 'fxaa';
      o.dist = Math.min(o.dist, 1); o.prCap = 1;
    }
    if (o.tier === 'low') { o.shadows = false; o.ao = 'off'; o.aa = 'off'; o.grade = false; o.water = 'simple'; o.refl = false; o.rt = 'off'; o.framegen = false; }   // каркас low: без постобработки
    // телефон (E.isMobile): «Авто» — без трассировки лучей (её включают сами: «Высокая», «Ультра» или «Своя»)
    if (dev.mobile && o.auto) o.rt = 'off';
    // видеокарта читает глубину неточно (post.js: проверка при запуске) — всё, что строится по глубине кадра, выключено:
    // иначе пятна и полосы на ровном полу
    if (dev.depthFx === false) { o.ao = 'off'; o.rt = 'off'; o.framegen = false; }
    if (o.aa === 'msaa' && dev.gl2 === false) o.aa = 'fxaa';
    return o;
  };
  // Лесенка автокачества (пресет «Авто»): [0] — лучшее, дальше — по ступеньке дешевле (трассировка → AO → тени → MSAA →
  // дальность → тени выкл)
  E.autoSteps = base => {
    const L = [{ ...base }], same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const step = f => { const o = { ...L[L.length - 1] }; f(o); if (!same(o, L[L.length - 1])) L.push(o); };
    // набор шейдеров (не «Обычные» — render.js ставит base.packFx): сначала дешевле он — без лучей и вторых облаков, потом без
    // облаков слоем и ветра (packLite 1 / 2)
    if (base.packFx && base.packFx !== 'normal') { step(o => { o.packLite = 1; }); step(o => { o.packLite = 2; }); }
    step(o => { if (o.rt === 'high') o.rt = 'on'; });
    step(o => { o.rt = 'off'; });
    step(o => { if (o.ao === 'high') o.ao = 'on'; });
    step(o => { o.ao = 'off'; });
    step(o => { const i = SHQ.indexOf(o.shadowQ); if (i > 1) o.shadowQ = SHQ[i - 1]; });
    step(o => { if (o.aa === 'msaa') o.aa = 'fxaa'; });
    step(o => { o.dist = Math.min(o.dist, .85); });
    step(o => { const i = SHQ.indexOf(o.shadowQ); if (i > 0) o.shadowQ = SHQ[i - 1]; });
    step(o => { o.shadows = false; });
    return L;
  };
  // Тени по качеству: карта, коробка (полуразмер, ед.), выборок PCF (каждая — 2×2 текселя), поиск заслонок (PCSS), радиус
  // (тексели), как часто при движении
  E.SHADOW_Q = {
    low: { map: 1024, box: 22, taps: 4, blk: 0, radius: 1.2, every: 3 },
    mid: { map: 1024, box: 26, taps: 5, blk: 0, radius: 1.5, every: 2 },
    high: { map: 2048, box: 34, taps: 9, blk: 6, radius: 2, every: 1 },
    ultra: { map: 4096, box: 44, taps: 16, blk: 10, radius: 2.5, every: 1 },
  };

  // ═══ Настройки графики мира (R.lighting.gfx; сохраняются в файле мира, едут гостям в блоке world) ═══
  const WG = E.WORLD_GFX = {
    preset: '',
    sky: { haze: .25, sun: 1, moon: true, stars: 1, clouds: 1 },
    fog: { density: .15, height: 0, sun: .6, color: '' },
    grade: 'neutral', bloom: 1, exposure: 0,
    water: { color: '', clarity: .55, foam: .6 },
    shadow: { soft: .35 },
    // «Трассировка лучей» мира: сила отражений (у игроков, у кого она включена) и мокрые поверхности (для всех)
    rt: { refl: 1, wet: 0 },
  };
  const G01 = v => cl(num(v, 0), 0, 1);
  E.worldGfx = (d = {}) => {
    d = d && typeof d === 'object' ? d : {};
    const s = d.sky && typeof d.sky === 'object' ? d.sky : {}, f = d.fog && typeof d.fog === 'object' ? d.fog : {};
    const w = d.water && typeof d.water === 'object' ? d.water : {}, sh = d.shadow && typeof d.shadow === 'object' ? d.shadow : {};
    const rt = d.rt && typeof d.rt === 'object' ? d.rt : {};
    return {
      preset: typeof d.preset === 'string' && E.WORLD_PRESETS[d.preset] ? d.preset : '',
      sky: { haze: cl(num(s.haze, WG.sky.haze), 0, 1), sun: cl(num(s.sun, WG.sky.sun), .3, 3), moon: s.moon !== false, stars: cl(num(s.stars, WG.sky.stars), 0, 1), clouds: cl(num(s.clouds, WG.sky.clouds), 0, 1) },
      fog: { density: cl(num(f.density, WG.fog.density), 0, 1), height: cl(num(f.height, WG.fog.height), -20, 80), sun: cl(num(f.sun, WG.fog.sun), 0, 1), color: isHex(f.color) ? f.color.toLowerCase() : '' },
      grade: E.GRADES[d.grade] ? d.grade : WG.grade,
      bloom: cl(num(d.bloom, WG.bloom), 0, 2.5), exposure: cl(num(d.exposure, WG.exposure), -1, 1),
      water: { color: isHex(w.color) ? w.color.toLowerCase() : '', clarity: cl(num(w.clarity, WG.water.clarity), 0, 1), foam: cl(num(w.foam, WG.water.foam), 0, 1) },
      shadow: { soft: cl(num(sh.soft, WG.shadow.soft), 0, 1) },
      rt: { refl: cl(num(rt.refl, WG.rt.refl), 0, 2), wet: cl(num(rt.wet, WG.rt.wet), 0, 1) },
    };
  };
  // Освещение мира: cur — R.lighting, L — новое (R.setLighting). Полный объект (есть time, brightness и fogEnd: мир загрузили
  // из файла, шаблон, блок world гостю) — графика мира заново из L.gfx (нет — по умолчанию: от прошлого мира ничего не тянется);
  // частичный (ползунок, смена суток) — дописывается. Меняет cur, возвращает его же
  E.mergeLighting = (cur, L) => {
    if (!L || typeof L !== 'object') return cur;
    const g0 = cur.gfx || E.worldGfx();
    for (const k in L) if (k !== 'gfx') cur[k] = L[k];
    if ('time' in L && 'brightness' in L && 'fogEnd' in L) cur.gfx = E.worldGfx(L.gfx);
    else if (L.gfx && typeof L.gfx === 'object') {
      const b = L.gfx, o = { ...g0, ...b };
      for (const k of ['sky', 'fog', 'water', 'shadow', 'rt']) if (b[k] && typeof b[k] === 'object') o[k] = { ...g0[k], ...b[k] };
      cur.gfx = E.worldGfx(o);
    } else if (!cur.gfx) cur.gfx = g0;
    return cur;
  };
  // Готовые настроения мира (панель «🎨 Графика» студии): свет (как Lighting в Roblox) + графика
  E.WORLD_PRESETS = {
    day: { name: 'Солнечный день', icon: '☀️', lighting: { time: 13, brightness: 1.1, ambient: 1, fogEnd: 420 },
      gfx: { sky: { haze: .12, clouds: .8, stars: 1 }, fog: { density: .06, height: 0, sun: .4 }, grade: 'vivid', bloom: .8, exposure: 0, water: { clarity: .7, foam: .5 }, shadow: { soft: .25 } } },
    sunset: { name: 'Закат', icon: '🌇', lighting: { time: 17.7, brightness: 1.25, ambient: .95, fogEnd: 320 },
      gfx: { sky: { haze: .45, clouds: 1, sun: 1.4 }, fog: { density: .25, height: 0, sun: 1 }, grade: 'warm', bloom: 1.3, exposure: .05, water: { clarity: .5, foam: .5 }, shadow: { soft: .55 } } },
    night: { name: 'Ночь', icon: '🌙', lighting: { time: .5, brightness: 1, ambient: 1.2, fogEnd: 240 },
      gfx: { sky: { haze: .1, stars: 1, moon: true, clouds: .6 }, fog: { density: .18, height: 0, sun: .3 }, grade: 'cold', bloom: 1.5, exposure: .2, water: { clarity: .4, foam: .4 }, shadow: { soft: .4 } } },
    foggy: { name: 'Туманный лес', icon: '🌫️', lighting: { time: 8.6, brightness: .75, ambient: 1.25, fogEnd: 150 },
      gfx: { sky: { haze: .9, clouds: 1 }, fog: { density: .75, height: 1, sun: .6 }, grade: 'soft', bloom: .7, exposure: .05, water: { clarity: .3, foam: .3 }, shadow: { soft: .85 }, rt: { refl: 1, wet: .35 } } },
    neon: { name: 'Неон-город', icon: '🌃', lighting: { time: 22.4, brightness: .6, ambient: .85, fogEnd: 260 },
      gfx: { sky: { haze: .35, stars: .35, clouds: .4 }, fog: { density: .35, height: 0, sun: .1, color: '#2a1b4d' }, grade: 'neon', bloom: 2, exposure: .12, water: { clarity: .45, foam: .3 }, shadow: { soft: .45 }, rt: { refl: 1.3, wet: .75 } } },
  };

  // ═══ Цветокоррекция (последний проход post.js): экспозиция, контраст, насыщенность, температура, оттенок, виньетка ═══
  E.GRADES = {
    neutral: { name: 'Обычный', exposure: 0, contrast: 0, saturation: 1, temp: 0, tint: 0, vignette: .14 },
    vivid: { name: 'Яркий', exposure: .02, contrast: .08, saturation: 1.12, temp: .03, tint: 0, vignette: .16 },
    warm: { name: 'Тёплый', exposure: 0, contrast: .06, saturation: 1.06, temp: .3, tint: .03, vignette: .22 },
    cold: { name: 'Холодный', exposure: 0, contrast: .05, saturation: .92, temp: -.3, tint: -.02, vignette: .22 },
    cinema: { name: 'Кино', exposure: -.04, contrast: .2, saturation: .88, temp: .06, tint: 0, vignette: .38 },
    soft: { name: 'Мягкий', exposure: .02, contrast: -.12, saturation: .94, temp: .04, tint: 0, vignette: .1 },
    neon: { name: 'Неон', exposure: 0, contrast: .16, saturation: 1.35, temp: -.18, tint: .1, vignette: .34 },
    retro: { name: 'Ретро', exposure: 0, contrast: .1, saturation: .68, temp: .22, tint: .05, vignette: .4 },
    bw: { name: 'Ч/Б', exposure: 0, contrast: .18, saturation: 0, temp: 0, tint: 0, vignette: .3 },
  };
  E.gradeOf = name => E.GRADES[name] || E.GRADES.neutral;
  // Числа для шейдера: усиление по каналам (экспозиция × температура × оттенок), насыщенность, контраст, виньетка
  E.gradeUniforms = (g, on = true, extraEv = 0, out = { gain: [1, 1, 1], sat: 1, con: 0, vig: 0 }) => {
    if (!on) { out.gain[0] = out.gain[1] = out.gain[2] = Math.pow(2, extraEv); out.sat = 1; out.con = 0; out.vig = 0; return out; }
    const ev = Math.pow(2, num(g.exposure, 0) + extraEv), t = num(g.temp, 0), ti = num(g.tint, 0);
    out.gain[0] = ev * (1 + .16 * t - .04 * ti); out.gain[1] = ev * (1 + .06 * ti); out.gain[2] = ev * (1 - .2 * t - .04 * ti);
    out.sat = cl(num(g.saturation, 1), 0, 2); out.con = cl(num(g.contrast, 0), -.5, .6); out.vig = cl(num(g.vignette, 0), 0, 1);
    return out;
  };

  // ═══ Время суток и небо ═══
  // Солнце: восход в 6, закат в 18, в полдень выше всего (64°), с востока через юг на запад (как раньше в render.js)
  const MAXEL = 64 * DEG;
  // Поставщик солнца (T-075): пока задан (планета — js/engine/planet-view.js), E.sunAt берёт направление у него — небо, свет и
  // отражения движка следуют настоящему солнцу игры; off = E.setSunProvider(f(t, out) → out), off() — снять (только свой)
  let SUNPROV = null;
  E.setSunProvider = f => { const me = SUNPROV = typeof f === 'function' ? f : null; return () => { if (SUNPROV === me) SUNPROV = null; }; };
  E.sunProvider = () => SUNPROV;
  E.sunAt = (t, out = [0, 1, 0]) => {
    if (SUNPROV) return SUNPROV(t, out);
    const h = ((num(t, 14) % 24) + 24) % 24, el = Math.asin(Math.sin(MAXEL) * Math.sin((h - 6) / 12 * PI));
    const az = PI * .25 + (h - 12) / 12 * PI * .9, ce = Math.cos(el);
    out[0] = Math.cos(az) * ce; out[1] = Math.sin(el); out[2] = Math.sin(az) * ce;
    return out;
  };
  // Общее время суток мира (у всех игроков одно): сутки — cycle минут, ночь (18…6) — доля night от суток
  E.dayClock = (ms, cycle = 32, night = .25) => {
    const p = ((ms / 60000 / Math.max(.5, cycle)) % 1 + 1) % 1, d = 1 - cl(night, .05, .95);
    return p < d ? 6 + p / d * 12 : (18 + (p - d) / (1 - d) * 12) % 24;
  };
  // Воздушная масса (Кастен — Янг): во сколько раз путь света длиннее, чем в зенит
  const airmass = sinEl => { const z = Math.min(90, 90 - Math.asin(cl(sinEl, -1, 1)) / DEG); return 1 / (Math.cos(z * DEG) + .50572 * Math.pow(96.07995 - z, -1.6364)); };
  E.airmass = airmass;
  // Рэлей (оптическая толщина в зенит для 650/560/460 нм) + Ми (дымка): цвет и сила солнца у земли
  const TAU_R = [.034, .1, .33];
  // Ключи неба по высоте солнца (sin): цвета на экране, линейные. zen — зенит, hor — горизонт от солнца, dusk — заря у солнца
  const SKY_KEYS = [
    [-.35, '#04081a', '#0c1630', '#000000'],
    [-.16, '#0b1638', '#1d2b55', '#2a1d3a'],
    [-.05, '#22397a', '#6b5d8f', '#c8644a'],
    [.03, '#3156a3', '#b8949a', '#ff8a4a'],
    [.14, '#3f6fc4', '#c8c9cf', '#ffb06a'],
    [.32, '#3d7fdb', '#b9d7f0', '#ffd9a8'],
    [.6, '#3f88ea', '#b4d6f5', '#fff1d6'],
    [1, '#3b86ec', '#acd2f5', '#fff8ea'],
  ].map(([y, a, b, c]) => [y, E.lin(a), E.lin(b), E.lin(c)]);
  const _k = [0, 0, 0], _T = [0, 0, 0];
  // Модель неба на время t (часы) и настройки неба мира: всё, что нужно шейдеру неба, туману, свету и облакам
  E.skyModel = (t, sky = WG.sky, out) => {
    const M = out || { sun: [0, 1, 0], moon: [0, -1, 0], zen: [0, 0, 0], hor: [0, 0, 0], dusk: [0, 0, 0], gnd: [0, 0, 0], glow: [0, 0, 0], sunC: [0, 0, 0],
      light: [1, 1, 1], lightDir: [0, 1, 0], lightI: 0, ambSky: [0, 0, 0], ambGnd: [0, 0, 0], cloud: [1, 1, 1], fogSun: [0, 0, 0], day: 1, night: 0, dusk01: 0, stars: 0, moonI: 0, haze: 0, sunSize: 1 };
    const haze = cl(num(sky.haze, .25), 0, 1);
    E.sunAt(t, M.sun);
    M.moon[0] = -M.sun[0]; M.moon[1] = -M.sun[1]; M.moon[2] = -M.sun[2];   // луна — напротив солнца (полнолуние)
    const sy = M.sun[1];
    // цвета неба: между ключами по высоте солнца
    let i = 0; while (i < SKY_KEYS.length - 2 && sy > SKY_KEYS[i + 1][0]) i++;
    const A = SKY_KEYS[i], B = SKY_KEYS[i + 1], k = sm(A[0], B[0], sy);
    mixA(A[1], B[1], k, M.zen); mixA(A[2], B[2], k, M.hor); mixA(A[3], B[3], k, M.dusk);
    // дымка: горизонт белее и серее, зенит светлее
    const hz = haze * haze, day = M.day = sm(-.12, .12, sy), night = M.night = 1 - sm(-.2, .02, sy);
    const hazeC = E.lin('#d9e1ea', _k), lum = .3 * M.hor[0] + .59 * M.hor[1] + .11 * M.hor[2];
    for (let j = 0; j < 3; j++) {
      M.hor[j] += (Math.max(M.hor[j], lum * hazeC[j] * 1.1) - M.hor[j]) * haze * .8;
      M.zen[j] += (M.hor[j] - M.zen[j]) * hz * .55;
    }
    M.dusk01 = Math.exp(-Math.pow((sy - .02) / .1, 2));
    // солнце сквозь воздух (Рэлей + Ми): цвет света и диска; у горизонта — тёплое и слабое (смягчено для игры)
    const tm = .01 + .1 * haze, ms = Math.min(airmass(sy), 40);
    for (let j = 0; j < 3; j++) _T[j] = Math.exp(-(TAU_R[j] + tm) * Math.min(ms, 16) * .55);
    const t0 = Math.exp(-(TAU_R[1] + tm) * .55);   // в зенит (зелёный) — для нормировки
    const sunVis = sm(-.03, .05, sy), moonVis = sm(-.02, .12, M.moon[1]);
    M.sunSize = cl(num(sky.sun, 1), .3, 3);
    for (let j = 0; j < 3; j++) {
      M.sunC[j] = _T[j] / t0 * 6 * sunVis;                        // диск: яркий, светится (метка свечения — альфа)
      M.glow[j] = _T[j] / t0 * (.35 + .9 * haze) * sunVis * (1 - .5 * night);
    }
    M.haze = haze; M.stars = cl(num(sky.stars, 1), 0, 1) * night * (1 - .7 * haze);
    M.moonI = sky.moon === false ? 0 : moonVis;
    // земля под горизонтом — в дымке, темнее
    for (let j = 0; j < 3; j++) M.gnd[j] = M.hor[j] * (.42 + .2 * haze);
    // направленный свет: днём солнце, ночью луна (без скачка: в сумерках оба почти гаснут)
    const sunL = sy > -.01;
    const src = sunL ? M.sun : M.moon;
    M.lightDir[0] = src[0]; M.lightDir[1] = Math.max(sunL ? .07 : .25, src[1]); M.lightDir[2] = src[2];
    const ld = Math.hypot(M.lightDir[0], M.lightDir[1], M.lightDir[2]); M.lightDir[0] /= ld; M.lightDir[1] /= ld; M.lightDir[2] /= ld;
    if (sunL) {
      const n = Math.max(_T[0], _T[1], _T[2]);
      for (let j = 0; j < 3; j++) M.light[j] = _T[j] / n;
      M.lightI = (.2126 * _T[0] + .7152 * _T[1] + .0722 * _T[2]) / t0 * sm(-.01, .1, sy);
    } else {
      E.lin('#a9bfff', M.light);
      M.lightI = .16 * M.moonI * (sky.moon === false ? .5 : 1);
    }
    // свет неба (полусфера): сверху — небо, снизу — отражённое от земли (тёплое днём)
    for (let j = 0; j < 3; j++) {
      M.ambSky[j] = M.zen[j] * .45 + M.hor[j] * .55;
      M.ambGnd[j] = (M.hor[j] * .35 + M.light[j] * M.lightI * .12) * [.62, .55, .4][j] * 1.2;
    }
    // облака: днём белые, на заре — тёплые снизу, ночью — тёмно-синие (не светятся сами)
    for (let j = 0; j < 3; j++) M.cloud[j] = cl(M.hor[j] * .5 + M.light[j] * M.lightI * .55 + M.dusk[j] * M.dusk01 * .35, 0, 1.2);
    // туман к солнцу: горизонт + заря + свечение
    for (let j = 0; j < 3; j++) M.fogSun[j] = M.hor[j] + M.dusk[j] * M.dusk01 * .9 + M.glow[j] * .25;
    return M;
  };
  // Цвет неба в направлении d (как в шейдере неба; для тумана, света, проверок) — линейный «на экране»
  E.skyColor = (M, d, out = [0, 0, 0]) => {
    const h = d[1], t = Math.pow(cl(h, 0, 1), .45 + .35 * M.haze);
    mixA(M.hor, M.zen, t, out);
    if (h < 0) mixA(M.hor, M.gnd, sm(0, .25, -h), out);
    const cs = d[0] * M.sun[0] + d[1] * M.sun[1] + d[2] * M.sun[2], g = .76, hg = (1 - g * g) / Math.pow(1 + g * g - 2 * g * cs, 1.5);
    const lx = Math.hypot(d[0], d[2]) || 1, sx = Math.hypot(M.sun[0], M.sun[2]) || 1, az = Math.max(0, (d[0] * M.sun[0] + d[2] * M.sun[2]) / lx / sx);
    const band = Math.pow(az, 3) * Math.exp(-Math.max(h, 0) * 6) * M.dusk01;
    for (let j = 0; j < 3; j++) out[j] += M.glow[j] * hg * .02 * (1 - .4 * t) + M.dusk[j] * band;
    return out;
  };

  // ═══ Погода → небо, свет, облака (render.js R.setWeather; чистая функция). wx: { cloud, rain, snow, fog, heat, storm } 0…1 ═══
  // Пасмурно — небо серее и темнее, солнце за тучами (диск и ореол гаснут, прямой свет слабее — но не до нуля: castShadow не
  // меняется, иначе пересборка шейдеров), свет неба — почти как был (рассеянный); снег — белёсый горизонт; зной — дымка и тепло
  const lumA = a => .2126 * a[0] + .7152 * a[1] + .0722 * a[2];
  E.weatherSky = (M, wx) => {
    if (!M || !wx) return M;
    const cloud = cl(num(wx.cloud, 0), 0, 1), rain = cl(num(wx.rain, 0), 0, 1), snow = cl(num(wx.snow, 0), 0, 1), fog = cl(num(wx.fog, 0), 0, 1);
    const heat = cl(num(wx.heat, 0), 0, 1), storm = cl(num(wx.storm, 0), 0, 1), over = cloud * cloud;
    const dark = .3 * over + .16 * rain + .26 * storm, oc = cl(over * .85 + .1 * rain + .4 * fog, 0, 1);
    const lz = lumA(M.zen), lh = lumA(M.hor);
    const GZ = [.92, .96, 1.04], GH = [.96, .98, 1.01];
    for (let j = 0; j < 3; j++) {
      M.zen[j] = (M.zen[j] + (lz * GZ[j] * .95 - M.zen[j]) * oc) * (1 - dark);
      M.hor[j] = (M.hor[j] + (lh * GH[j] - M.hor[j]) * oc) * (1 - dark * .75);
      M.hor[j] += ([.8, .84, .9][j] * Math.max(lh, .05) * 1.4 - M.hor[j]) * snow * .35;
      M.hor[j] += [.05, .025, 0][j] * heat * (M.day || 0);
      M.gnd[j] *= 1 - dark;
      M.glow[j] *= 1 - over * .9;
      M.sunC[j] *= 1 - Math.min(1, over * 1.05 + fog * .5);
      M.dusk[j] *= 1 - over * .75;
      M.cloud[j] = (M.cloud[j] + (lumA(M.cloud) * [.86, .88, .92][j] * .78 - M.cloud[j]) * Math.min(1, over * 1.2)) * (1 - dark * .55);
      M.fogSun[j] += (M.hor[j] - M.fogSun[j]) * over;
      M.ambSky[j] *= 1 - .3 * dark;
    }
    M.stars *= 1 - cloud;
    M.moonI *= 1 - over * .9;
    const li = M.lightI;
    M.lightI = li * (1 - .78 * over - .1 * fog);
    if (li > .021) M.lightI = Math.max(.021, M.lightI);   // тени не выключаются (castShadow — пересборка шейдеров)
    M.haze = Math.max(M.haze, .3 * cloud + .45 * fog + .35 * heat + .25 * rain);
    // особая погода по биому (T-135, js/engine/wx.js, wx-fx.js): небо и горизонт — к цвету бури (песок, охра, белая мгла, зелёная
    // туча града), солнце — бледный диск, свет слабее, но не темнее 45 % (детский мир: без страшной тьмы); flat — белая мгла:
    // небо цвета земли, без теней и горизонта. wx.tint — [r, g, b] (линейный), wx.tintK, wx.dust, wx.flat — 0…1
    const tk = cl(num(wx.tintK, 0), 0, 1), du = cl(num(wx.dust, 0), 0, 1), fl = cl(num(wx.flat, 0), 0, 1), tn = wx.tint;
    if (tk > 0 && tn && tn.length === 3) {
      const lh = Math.max(lumA(M.hor), .035), lz = Math.max(lumA(M.zen), .03);
      for (let j = 0; j < 3; j++) {
        M.hor[j] += (tn[j] * lh * 1.25 - M.hor[j]) * tk;
        M.zen[j] += (tn[j] * lz * 1.15 - M.zen[j]) * tk * (.55 + .4 * du + .45 * fl);
        M.gnd[j] += (tn[j] * lh * .8 - M.gnd[j]) * tk * .6;
        M.fogSun[j] += (M.hor[j] - M.fogSun[j]) * Math.min(1, tk * 1.2);
        M.cloud[j] += (tn[j] * lumA(M.cloud) - M.cloud[j]) * tk * .5;
        M.sunC[j] *= 1 - .75 * du - .9 * fl;
        M.glow[j] *= 1 - .8 * Math.max(du, fl);
      }
      if (fl > 0) for (let j = 0; j < 3; j++) M.zen[j] += (M.hor[j] - M.zen[j]) * fl;
      M.lightI = Math.max(Math.min(M.lightI, .021), M.lightI * (1 - .55 * Math.max(du * tk, fl * .8)));
      M.stars *= 1 - Math.max(du, fl);
      M.haze = Math.max(M.haze, .7 * du + .5 * fl);
    }
    M.wx = { over, dark, fog, rain, snow, storm, heat, dust: du, flat: fl };
    return M;
  };

  // ═══ Общие данные для шейдеров (Float32Array — общие для всех материалов) ═══
  // fogA: xyz — направление на солнце (мир), w — сила свечения тумана к солнцу; fogB: rgb — цвет тумана у солнца,
  // a — плотность высотного тумана; fogC: x — высота «пола» тумана, y — спад с высотой, z, w — запас;
  // sh: x — выборок PCF (каждая — 2×2 текселя с весами), y — поиск заслонок (0 — без PCSS), z — тексели полутени на 1 ед.
  // глубины карты, w — 2: без наклона приёмника (для проверок), иначе с ним
  // rt: x — мокрые поверхности мира 0…1 (пол глаже и темнее), y — 1: метить блестящее в альфе буфера сцены для отражений
  // (только пока рисуется буфер постобработки с трассировкой — на холст альфа < 1 не попадает), z — 1: трава и листва (вырез по
  // альфе) пишут свой код 1 + 4/1024 — для AO (только пока рисуется буфер постобработки с AO), w — запас
  // wind: x — время (с), y — сила ветра (0 — трава и листва стоят: шейдер набора «Обычные» тот же), zw — направление (по миру)
  const U = E.GFXU = E.GFXU || { fogA: new Float32Array(4), fogB: new Float32Array(4), fogC: new Float32Array(4), sh: new Float32Array(4) };
  U.rt = U.rt || new Float32Array(4);
  U.wind = U.wind || new Float32Array([0, 0, .8, .6]);
  // Погода на поверхностях (js/engine/climate.js + precip.js; только на время кадра — после кадра нули, как rt.x):
  // cl: x — снег на земле 0…1, y — мокро, z — лужи, w — лёд на воде; cl2: x — осень листвы, y — зима (листва тусклая),
  // z — весна (свежая), w — дождь сейчас; clO: xy — начало шума (камера по миру mod 256: узор не плывёт), z — время (с),
  // w — 1: карта «что над головой» готова; clM: xy — центр карты минус камера (x, z), z — 1 / ширина карты, w — низ высот
  // карты минус высота камеры (высоты в карте — 16 бит на 256 единиц)
  U.cl = U.cl || new Float32Array(4);
  U.cl2 = U.cl2 || new Float32Array(4);
  U.clO = U.clO || new Float32Array(4);
  U.clM = U.clM || new Float32Array(4);
  // Дымка «как в атмосфере» вместо тумана (T-075: планета, planet-view.js ставит каждый кадр; apA.w = 0 — обычный туман):
  // apA: rgb — рассеяние Рэлея у камеры (1/ед.), w — включено; apB: x — Ми у камеры, y — фаза Ми g, z, w — 1 / высоты однородной
  // толщи (Рэлей, Ми); apC: xyz — направление на солнце (мир), w — сила дымки; apD: rgb — пропускание воздуха до солнца у камеры
  U.apA = U.apA || new Float32Array(4);
  U.apB = U.apB || new Float32Array(4);
  U.apC = U.apC || new Float32Array(4);
  U.apD = U.apD || new Float32Array(4);
  // Кусок тумана с дымкой ставит сама планета, пока открыта (E.aerialPatch(T, true) — planet-view.js; закрыли — прежний кусок):
  // у остального сайта туман — ровно прежний. E.aerialFog — кусок с дымкой сейчас стоит. Страж графики (post.js): ключ 'aerial' —
  // кадр с дымкой «не числа» / днём чёрный → без дымки сразу (d37ApA.w = 0), не собралась программа с ней → прежний кусок
  E.aerialFog = false;
  const AP_PARS = `
	uniform vec4 d37ApA;
	uniform vec4 d37ApB;
	uniform vec4 d37ApC;
	uniform vec4 d37ApD;
	float d37ApG( float x ){ return abs( x ) < 1e-3 ? 1.0 - 0.5 * x : ( 1.0 - exp( - x ) ) / x; }`;

  // ═══ Куски шейдеров three.js (один раз на всю страницу) ═══
  // Ветер (шейдеры-наборы, 16.10.2026): у материала с define D37_WAVE (R.wave / E.waveMaterial: 1 — трава, верх качается,
  // D37_WAVE_H — 1/высота кустика; 2 — листва, вся крона чуть «дышит») вершина сдвигается в мировых координатах. Без define —
  // кусок вырезан препроцессором: у всех остальных материалов шейдер тот же, что и раньше. Тени не качаются (их материал — свой)
  const FOG_PARS_V = `#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vD37Fog;
#endif
#ifdef D37_WAVE
	uniform vec4 d37Wind;
#endif`;
  const WAVE_V = `#ifdef D37_WAVE
	{
		vec3 d37Wp = ( modelMatrix * mvPosition ).xyz;
		float d37Ph = dot( d37Wp.xz, d37Wind.zw ) * 0.35 + d37Wind.x * 1.7;
		float d37Gust = 0.65 + 0.35 * sin( d37Wind.x * 0.31 + d37Wp.x * 0.021 + d37Wp.z * 0.017 );
		#if D37_WAVE == 1
		float d37Hh = clamp( position.y * D37_WAVE_H, 0.0, 1.0 );
		vec3 d37Off = vec3( d37Wind.z, 0.0, d37Wind.w ) * ( sin( d37Ph ) * 0.6 + 0.4 ) * 0.14 * d37Hh * d37Hh;
		#else
		vec3 d37Off = vec3( sin( d37Ph + d37Wp.y * 1.3 ), 0.4 * sin( d37Ph * 1.3 + d37Wp.x ), cos( d37Ph * 0.9 + d37Wp.z ) ) * 0.04;
		#endif
		mvPosition.xyz += ( vec4( d37Off * ( d37Wind.y * d37Gust ), 0.0 ) * modelMatrix ).xyz;
	}
#endif
`;
  // вставка ветра в project_vertex three (после instanceMatrix, до modelViewMatrix)
  E.patchWave = src => {
    const k = 'mvPosition = modelViewMatrix * mvPosition;', i = src.indexOf(k);
    if (i < 0 || src.includes('d37Wind')) return src;
    return src.slice(0, i) + WAVE_V + src.slice(i);
  };
  const FOG_V = `#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vD37Fog = mvPosition.xyz;
#endif`;
  const fogParsF = ap => `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vD37Fog;
	uniform vec4 d37FogA;
	uniform vec4 d37FogB;
	uniform vec4 d37FogC;${ap ? AP_PARS : ''}
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;
  const FOG_PARS_F = fogParsF(false), FOG_PARS_F_AP = fogParsF(true);
  // туман: обычный (по расстоянию) + высотный (плотнее у земли, интеграл по лучу) + к солнцу — тёплый (как небо у солнца).
  // Дымка атмосферы (кусок с дымкой — только пока открыта планета; d37ApA.w > 0): та же, что у земли планеты — пропускание по лучу
  // (Рэлей по каналам + Ми, плотность у камеры × средняя по высоте луча) и свет, рассеянный солнцем (фазы Рэлея и Ми к солнцу);
  // «бесконечная толща» — тональной кривой, как и остальное после неё
  const AP_F = `
	if ( d37ApA.w > 0.0 ) {
		vec3 d37Rel = vec3( dot( viewMatrix[ 0 ].xyz, vD37Fog ), dot( viewMatrix[ 1 ].xyz, vD37Fog ), dot( viewMatrix[ 2 ].xyz, vD37Fog ) );
		float d37L = length( d37Rel ), d37C = dot( d37Rel, d37ApC.xyz ) / max( d37L, 1e-4 );
		vec3 d37SR = d37ApA.rgb * d37ApG( d37Rel.y * d37ApB.z );
		float d37SM = d37ApB.x * d37ApG( d37Rel.y * d37ApB.w ), d37Gm = d37ApB.y, d37G2 = d37Gm * d37Gm;
		vec3 d37Ex = max( d37SR + vec3( d37SM * 1.1 ), vec3( 1e-9 ) );
		vec3 d37Tv = exp( - d37Ex * d37L );
		float d37PR = 0.0596831 * ( 1.0 + d37C * d37C );
		float d37PM = 0.1193662 * ( 1.0 - d37G2 ) * ( 1.0 + d37C * d37C ) / ( ( 2.0 + d37G2 ) * pow( max( 1.0 + d37G2 - 2.0 * d37Gm * d37C, 1e-4 ), 1.5 ) );
		vec3 d37Inf = d37ApC.w * d37ApD.rgb * ( d37SR * d37PR + vec3( d37SM * d37PM ) ) / d37Ex;
		#ifdef TONE_MAPPING
			d37Inf = toneMapping( d37Inf );
		#endif
		gl_FragColor.rgb = gl_FragColor.rgb * d37Tv + d37Inf * ( 1.0 - d37Tv );
	} else {`;
  const fogF = ap => `#ifdef USE_FOG${ap ? AP_F : ''}
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	vec3 d37Fc = fogColor;
	if ( d37FogA.w > 0.0 || d37FogB.a > 0.0 ) {
		vec3 d37Rel = vec3( dot( viewMatrix[ 0 ].xyz, vD37Fog ), dot( viewMatrix[ 1 ].xyz, vD37Fog ), dot( viewMatrix[ 2 ].xyz, vD37Fog ) );
		if ( d37FogA.w > 0.0 ) {
			float d37Az = max( dot( d37Rel.xz, d37FogA.xz ) * inversesqrt( max( dot( d37Rel.xz, d37Rel.xz ), 1e-6 ) ), 0.0 );
			d37Fc = mix( fogColor, d37FogB.rgb, d37FogA.w * d37Az * d37Az * d37Az );
		}
		if ( d37FogB.a > 0.0 ) {
			float d37Dy = d37Rel.y * d37FogC.y;
			float d37G = abs( d37Dy ) < 1e-3 ? 1.0 - 0.5 * d37Dy : ( 1.0 - exp( - d37Dy ) ) / d37Dy;
			fogFactor = max( fogFactor, 1.0 - exp( - max( d37FogC.z * length( d37Rel ) * d37G, 0.0 ) ) );
		}
	}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, d37Fc, fogFactor );${ap ? `
	}` : ''}
#endif`;
  const FOG_F = fogF(false), FOG_F_AP = fogF(true);
  // Мягкие тени без шума и «ряби» (15.10.2026: на полу была рябь — шум поворота выборок по пикселям экрана ползал при
  // движении, на склонах к солнцу ядро затеняло само себя):
  // • каждая выборка — 2×2 текселя с весами по положению (как билинейная): край тени плавный и без поворота-шума;
  // • наклон приёмника (receiver plane depth bias): глубину приёмника для каждого текселя берём по его плоскости в карте
  //   (производные координат тени по экрану) — широкое ядро и низкое солнце не дают «самозатенения» (acne);
  // • PCSS-lite: заслонки ищем так же по плоскости, полутень шире, чем дальше заслонка; спираль Фогеля постоянная.
  // Спираль без синусов на каждую выборку: поворот на «золотой угол» — умножением на постоянную матрицу.
  const SH_FN = `uniform vec4 d37Sh;
	float d37Cmp( sampler2D map, vec2 uv, float z ) { return step( z, unpackRGBAToDepth( texture2D( map, uv ) ) ); }
	// 4 соседних текселя: у каждого — глубина приёмника по плоскости (g — изменение глубины на 1 по uv), смесь по весам
	float d37Bil( sampler2D map, vec2 size, vec2 uv, vec3 c, vec2 g ) {
		vec2 e = 1.0 / size, tc = uv * size - 0.5, f = fract( tc ), b = ( floor( tc ) + 0.5 ) * e;
		float z0 = c.z + dot( g, b - c.xy ), gx = g.x * e.x, gy = g.y * e.y;
		float s00 = d37Cmp( map, b, z0 ), s10 = d37Cmp( map, b + vec2( e.x, 0.0 ), z0 + gx );
		float s01 = d37Cmp( map, b + vec2( 0.0, e.y ), z0 + gy ), s11 = d37Cmp( map, b + e, z0 + gx + gy );
		return mix( mix( s00, s10, f.x ), mix( s01, s11, f.x ), f.y );
	}
	float d37Pcf( sampler2D map, vec2 size, float radius, vec3 c, vec2 g ) {
		vec2 texel = 1.0 / size;
		float n = d37Sh.x > 0.5 ? d37Sh.x : 6.0, rad = max( radius, 0.5 );
		mat2 ga = mat2( -0.7373688, 0.6754904, -0.6754904, -0.7373688 );
		vec2 d = vec2( 0.8660254, 0.5 );
		if ( d37Sh.y > 0.5 ) {
			float sum = 0.0, cnt = 0.0, sr = rad * 3.0;
			for ( int i = 0; i < 16; i ++ ) {
				if ( float( i ) >= d37Sh.y ) break;
				vec2 o = d * sqrt( ( float( i ) + 0.5 ) / d37Sh.y ) * sr * texel;
				float zr = c.z + dot( g, o ), z = unpackRGBAToDepth( texture2D( map, c.xy + o ) );
				if ( z < zr ) { sum += zr - z; cnt += 1.0; }
				d = ga * d;
			}
			if ( cnt < 0.5 ) return 1.0;
			rad = clamp( sum / cnt * d37Sh.z, rad * 0.5, rad * 2.5 );   // не уже полрадиуса: у самой заслонки — без «лесенки» текселей
			d = vec2( 0.8660254, 0.5 );
		}
		float s = 0.0;
		for ( int i = 0; i < 32; i ++ ) {
			if ( float( i ) >= n ) break;
			s += d37Bil( map, size, c.xy + d * sqrt( ( float( i ) + 0.5 ) / n ) * rad * texel, c, g );
			d = ga * d;
		}
		return s / n;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		// наклон приёмника в карте теней — до ветвлений (производные — только в общем для всех пикселей коде)
		// (WebGL1 — без наклона: производные там только с расширением, которое three включает не всем материалам)
		vec2 g = vec2( 0.0 );
		#if __VERSION__ >= 300
		if ( d37Sh.w < 1.5 ) {
			vec3 cx = dFdx( shadowCoord.xyz ), cy = dFdy( shadowCoord.xyz );
			float det = cx.x * cy.y - cx.y * cy.x;
			if ( abs( det ) > 1e-14 ) g = vec2( cy.y * cx.z - cx.y * cy.z, cx.x * cy.z - cy.x * cx.z ) / det;
			float gm = length( g );
			if ( gm > 16.0 ) g *= 16.0 / gm;   // почти вдоль луча (солнце ниже ~1°, силуэт) — не дальше разумного
		}
		#endif
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT )
			shadow = d37Pcf( shadowMap, shadowMapSize, shadowRadius, shadowCoord.xyz, g );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return shadow;
	}
	`;
  // Точность сэмплеров (15.10.2026, телефон владельца): у sampler2D во фрагментном шейдере по умолчанию lowp, и на телефонах
  // значение из текстуры приходит в половинной точности (fp16). Карте теней (глубина, упакованная в RGBA8) и карте глубины
  // воды это мало: кусок теней целиком — в highp, после него — снова как было (lowp: цвету и нормалям хватает, так быстрее).
  // highp в GLSL ES 3.00 есть всегда; в WebGL1 — если видеокарта умеет. Постобработка — E.POST_PREC (post.js).
  const PREC_HI = '#if __VERSION__ >= 300 || defined( GL_FRAGMENT_PRECISION_HIGH )\nprecision highp sampler2D;\n#endif\n';
  const PREC_LO = '#if __VERSION__ >= 300 || defined( GL_FRAGMENT_PRECISION_HIGH )\nprecision lowp sampler2D;\n#endif\n';
  E.SAMPLER_PREC = { hi: PREC_HI, lo: PREC_LO };
  // Заменить getShadow в куске three (от «float getShadow(» до «vec2 cubeToUV(») — устойчиво к пробелам сборки
  E.patchShadowChunk = src => {
    const a = src.indexOf('float getShadow('), b = src.indexOf('vec2 cubeToUV(');
    if (a < 0 || b < a || src.includes('d37Pcf')) return src;
    return src.slice(0, a) + SH_FN + src.slice(b);
  };
  // ── «Трассировка лучей»: что блестит (для отражений в экране, post.js) и мокрые поверхности ──
  // Стандартные материалы (PBR) пишут в альфу буфера сцены код блеска: [0,75 … 0,87] — гладкое (не металл), [0,875 … 0,995] —
  // металл; доля внутри — глянец (по шероховатости: 0,55 — ещё нет, 0,12 — зеркало). Вода и стекло (прозрачные) пишут 0
  // (смешивание альфы — ноль, post.js). Обычное — 1, светящееся — 1 + сила (свечение). Код — только пока d37Rt.y = 1.
  const RT_PARS = `
uniform vec4 d37Rt;`;
  // мокрое: на горизонтальном (нормаль поверхности вверх) — гладче и темнее, как после дождя (на любом качестве, кроме low)
  const RT_WET = `
#ifdef STANDARD
	if ( d37Rt.x > 0.0 ) {
		float d37Up = dot( geometryNormal, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) );
		float d37Wt = d37Rt.x * smoothstep( 0.55, 0.85, d37Up );
		roughnessFactor = mix( roughnessFactor, 0.07, d37Wt );
		diffuseColor.rgb *= 1.0 - 0.35 * d37Wt;
	}
#endif`;
  // Трава и листва (вырезанное по альфе: кустики травы mir.js, листья и сетки моделей — glTF MASK) — свой код 1 + 4/1024
  // (16.10.2026, «мерцание у травы»): AO и контактные тени их не учитывают ни как заслонку, ни как то, что затеняется (тонкие
  // травинки в глубине кадра давали вокруг каждого кустика тёмное пятно). Код чуть больше 1: край травинки при MSAA (среднее с
  // соседом 1) — 1,001…1,004, в коды блеска [0,75; 0,999) не попадает; в половинном float записывается точно. Свечение — от 1,01.
  // Пишется только пока d37Rt.z = 1 (post.js: AO или трассировка включены и страж графики не выключил) — у остального
  // ничего не меняется (после «чёрной земли» на телефоне 15.10: путь блеска — как был, только пока d37Rt.y = 1).
  // Запись — целым вектором без ветвления (не «.a = …» внутри if): так меньше простора драйверу ошибиться; страж графики
  // (post.js) проверяет, что цвет с кодами и без них одинаковый.
  // smoothstep — только с edge0 < edge1 (иначе по стандарту GLSL результат не определён — телефоны вправе вернуть что угодно)
  E.FOLIAGE_A = 1 + 4 / 1024;
  const RT_OUT = `
#if defined( STANDARD ) && defined( OPAQUE )
	#ifdef USE_ALPHATEST
	gl_FragColor = vec4( gl_FragColor.rgb, d37Rt.z > 0.5 ? ${E.FOLIAGE_A.toFixed(8)} : gl_FragColor.a );
	#else
	if ( d37Rt.y > 0.5 ) {
		float d37G = 1.0 - smoothstep( 0.12, 0.55, roughnessFactor );
		if ( d37G > 0.01 ) gl_FragColor.a = ( metalnessFactor > 0.5 ? 0.875 : 0.75 ) + 0.12 * d37G;
	}
	#endif
#endif`;
  // Для своих шейдеров (вырезанное по альфе в «Кубомире» — voxel-render.js и т. п.): код травы — этой строкой после
  // #include <output_fragment>, с uniform vec4 d37Rt = { value: E.GFXU.rt } (флаг z ставит post.js, страж его проверяет)
  E.FOLIAGE_GLSL = `gl_FragColor = vec4( gl_FragColor.rgb, d37Rt.z > 0.5 ? ${E.FOLIAGE_A.toFixed(8)} : gl_FragColor.a );`;
  // код из альфы (как читает post.js) — для проверок: { kind: 'clear' | 'gloss' | 'metal' | 'foliage' | null, gloss }
  // (null — обычное и светящееся: не блестит; 'foliage' — трава и листва: не блестит и без AO)
  E.rtDecode = a => a < .25 ? { kind: 'clear', gloss: 1 - a * 4 } : a >= .75 && a < .999 ? { kind: a >= .875 ? 'metal' : 'gloss', gloss: Math.max(0, Math.min(1, (a - (a >= .875 ? .875 : .75)) / .12)) }
    : a > 1.0005 && a < 1.01 ? { kind: 'foliage', gloss: 0 } : { kind: null, gloss: 0 };
  E.rtEncode = (rough, metal) => { const t = Math.max(0, Math.min(1, (rough - .55) / (.12 - .55))), g = t * t * (3 - 2 * t); return g > .01 ? (metal > .5 ? .875 : .75) + .12 * g : 1; };
  // ── Погода на поверхностях (16.10.2026, docs/SEASONS.md): снег на смотрящем вверх (шумный край, растёт и тает), мокро и
  // лужи-зеркала на ровном, листва по сезону (D37_LEAF у материала: 1 — трава, 2 — листва, 3 — хвоя), лёд на воде (вода
  // движка). Только STANDARD и LAMBERT (человечки — toon/phong — не трогаются), только непрозрачное, без D37_NOCLIM.
  // Где «над головой» что-то есть (крыша, крона, потолок) — ни снега, ни мокрого: карта высот сверху (precip.js рисует её
  // раз в ~2 с), у «Кубомира» (D37_VOX) — свет неба блока. Весь кусок — под D37_CLIM (страж графики, ключ 'clim', снимает
  // его: без него программы — прежние). Внутри — только ветвление по uniform (одинаково для всех пикселей), без циклов,
  // texelFetch и continue; smoothstep — edge0 < edge1; шум — хешем без синуса (как у неба).
  const CLIM_PARS = `
#define D37_CLIM
uniform vec4 d37Cl;
uniform vec4 d37Cl2;
uniform vec4 d37ClO;
uniform vec4 d37ClM;
${PREC_HI}uniform sampler2D d37ClTex;
${PREC_LO}float d37Ch( vec2 p ){ vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
float d37Cn( vec2 p, float per ){
	vec2 i = floor( p ), f = fract( p ), i0 = mod( i, per ), i1 = mod( i + 1.0, per );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( d37Ch( i0 ), d37Ch( vec2( i1.x, i0.y ) ), f.x ), mix( d37Ch( vec2( i0.x, i1.y ) ), d37Ch( i1 ), f.x ), f.y );
}
#if defined( D37_VOX ) && defined( D37_VOXZ )
uniform vec4 d37ClZ;
float d37Zn(){ return d37ClZ.w > 0.5 ? floor( vD37Z + 0.5 ) : 0.0; }   // климатическая зона столба «Кубомира»: 0 / 1 — всегда зима / 2 — зимы нет
#endif
vec3 d37Leaf( vec3 c, float n, float kind ){
	vec3 d37L2 = d37Cl2.xyz;
	#if defined( D37_VOX ) && defined( D37_VOXZ )
	if ( d37Zn() > 0.5 ) d37L2 = vec3( 0.0 );   // «всегда зима» и «зимы нет» — листва без осени (вечнозелёная)
	#endif
	float g = clamp( ( c.g - max( c.r, c.b ) * 0.85 ) / max( c.g, 0.001 ), 0.0, 1.0 ), gk = smoothstep( 0.0, 0.25, g );
	float lum = dot( c, vec3( 0.3, 0.59, 0.11 ) );
	vec3 au = mix( vec3( 1.0, 0.7, 0.16 ), vec3( 0.95, 0.32, 0.1 ), n ) * lum * 2.0;
	float k = kind > 2.5 ? 0.0 : d37L2.x * gk * ( 0.62 + 0.38 * n );
	c = mix( c, au, k );
	c = mix( c, vec3( dot( c, vec3( 0.3, 0.59, 0.11 ) ) ) * vec3( 0.95, 0.86, 0.7 ), d37L2.y * ( kind > 2.5 ? 0.3 : 0.72 ) * gk );
	return mix( c, c * vec3( 0.95, 1.12, 0.88 ) + vec3( 0.015, 0.035, 0.0 ), d37L2.z * 0.5 * gk );
}`;
  const CLIM_FRAG = `
#ifdef D37_CLIM
#if ( defined( STANDARD ) || defined( LAMBERT ) ) && defined( OPAQUE ) && ! defined( D37_NOCLIM ) && ! defined( D37_FP )
	vec4 d37C = d37Cl;
	#if defined( D37_VOX ) && defined( D37_VOXZ )
	float d37Zv = d37Zn();   // зоны «Кубомира»: всегда зима — снег не меньше d37ClZ.x, без луж; зимы нет — без снега, мокрое и лужи — d37ClZ.y / .z
	if ( d37Zv > 0.5 ) d37C = d37Zv < 1.5 ? vec4( max( d37Cl.x, d37ClZ.x ), 0.0, 0.0, d37Cl.w ) : vec4( 0.0, d37ClZ.y, d37ClZ.z, 0.0 );
	#endif
	if ( d37C.x + d37C.y + d37C.z + d37Cl2.x + d37Cl2.y + d37Cl2.z > 0.0 ) {
		vec3 d37Vp = - vViewPosition;
		vec3 d37Rw = vec3( dot( viewMatrix[ 0 ].xyz, d37Vp ), dot( viewMatrix[ 1 ].xyz, d37Vp ), dot( viewMatrix[ 2 ].xyz, d37Vp ) );
		vec2 d37Q = d37ClO.xy + d37Rw.xz;
		float d37Up = dot( geometryNormal, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) );
		#ifdef D37_VOX
		float d37Op = smoothstep( 0.8, 0.97, vLt.x );
		#else
		vec2 d37Ou = vec2( d37Rw.x - d37ClM.x, d37ClM.y - d37Rw.z ) * d37ClM.z + 0.5;
		vec4 d37Oc = texture2D( d37ClTex, clamp( d37Ou, 0.001, 0.999 ) );
		float d37Top = d37ClM.w + ( d37Oc.r * 65280.0 + d37Oc.g * 255.0 ) / 65535.0 * 256.0;
		float d37In = step( 0.001, d37Ou.x ) * step( d37Ou.x, 0.999 ) * step( 0.001, d37Ou.y ) * step( d37Ou.y, 0.999 ) * step( 0.5, d37ClO.w ) * step( 0.5, d37Oc.b );
		float d37Op = 1.0 - d37In * ( 1.0 - smoothstep( -0.7, -0.2, d37Rw.y - d37Top ) );
		#endif
		#ifdef D37_LEAF
		diffuseColor = vec4( d37Leaf( diffuseColor.rgb, d37Cn( d37Q * 0.0625, 16.0 ), float( D37_LEAF ) ), diffuseColor.a );
		#endif
		float d37S = 0.0;
		if ( d37C.x > 0.0 ) {
			float d37Nz = d37Cn( d37Q * 0.5, 128.0 ) * 0.62 + d37Cn( d37Q * 2.0, 512.0 ) * 0.38;
			d37S = smoothstep( 0.42, 0.82, d37Up ) * d37Op * smoothstep( d37Nz - 0.09, d37Nz + 0.09, d37C.x * 1.12 );
			diffuseColor = vec4( mix( diffuseColor.rgb, vec3( 0.86, 0.9, 0.96 ) * ( 0.94 + 0.06 * d37Nz ), d37S ), diffuseColor.a );
		}
		float d37W = d37C.y * d37Op * smoothstep( 0.3, 0.75, d37Up ) * ( 1.0 - d37S ), d37P = 0.0;
		if ( d37C.z > 0.0 ) {
			float d37Pn = d37Cn( d37Q * 0.125, 32.0 ) * 0.7 + d37Cn( d37Q * 0.5, 128.0 ) * 0.3;
			d37P = d37C.z * d37Op * smoothstep( 0.9, 0.98, d37Up ) * ( 1.0 - d37S ) * smoothstep( d37Pn - 0.06, d37Pn + 0.06, d37C.z * 0.75 );
		}
		diffuseColor = vec4( diffuseColor.rgb * ( 1.0 - 0.3 * d37W ) * ( 1.0 - 0.35 * d37P ), diffuseColor.a );
		#ifdef STANDARD
		roughnessFactor = mix( mix( mix( roughnessFactor, 0.85, d37S ), 0.14 + 0.25 * roughnessFactor, d37W * 0.85 ), 0.03, d37P );
		metalnessFactor = mix( metalnessFactor, 0.0, max( d37S, d37P ) );
		#endif
	}
#endif
#endif`;
  E.CLIM_GLSL = { pars: CLIM_PARS, frag: CLIM_FRAG };
  E.climShaders = false;   // кусок погоды установлен (E.gfxPatch); страж графики снимает — E.climUnpatch
  const LIT = ['basic', 'lambert', 'phong', 'standard', 'physical', 'toon', 'matcap', 'points', 'sprite', 'dashed'];
  // куски three до правки — для безопасного режима (страж графики, post.js: программа сцены не собралась → E.gfxUnpatch)
  const PATCHED = ['fog_pars_vertex', 'fog_vertex', 'fog_pars_fragment', 'fog_fragment', 'shadowmap_pars_fragment', 'roughnessmap_pars_fragment', 'normal_fragment_maps', 'output_fragment', 'project_vertex', 'normal_pars_fragment'];
  let ORIG = null;
  E.gfxUnpatch = T => {
    const C = T && T.ShaderChunk;
    if (!C || !C.__d37 || !ORIG) return false;
    for (const k of PATCHED) if (k in ORIG) C[k] = ORIG[k];
    C.__d37 = 0; E.climShaders = false; E.aerialFog = false; U.apA[3] = 0;
    return true;
  };
  E.climUnpatch = T => {
    const C = T && T.ShaderChunk;
    if (!C || !E.climShaders) return false;
    C.normal_pars_fragment = C.normal_pars_fragment.replace(CLIM_PARS, ''); C.normal_fragment_maps = C.normal_fragment_maps.replace(CLIM_FRAG, '');
    E.climShaders = false;
    for (const k of ['cl', 'cl2', 'clO', 'clM']) U[k].fill(0);
    return true;
  };
  E.gfxPatch = T => {
    const C = T && T.ShaderChunk;
    if (!C || C.__d37) return !!C;
    if (E.gfxSafe?.()) return false;   // страж запомнил: на этом устройстве — без своих кусков (сброс — новая версия сайта)
    if (!ORIG) { ORIG = {}; for (const k of PATCHED) ORIG[k] = C[k]; }
    C.fog_pars_vertex = FOG_PARS_V; C.fog_vertex = FOG_V; C.fog_pars_fragment = FOG_PARS_F; C.fog_fragment = FOG_F;
    C.shadowmap_pars_fragment = PREC_HI + E.patchShadowChunk(C.shadowmap_pars_fragment || '') + '\n' + PREC_LO;   // карта теней — highp
    // трассировка лучей: данные — в кусок шероховатости (он есть только у стандартных), мокрое — после нормалей, код блеска — в конце
    if (C.roughnessmap_pars_fragment != null && !C.roughnessmap_pars_fragment.includes('d37Rt')) C.roughnessmap_pars_fragment += RT_PARS;
    if (C.normal_fragment_maps != null && !C.normal_fragment_maps.includes('d37Rt')) C.normal_fragment_maps += RT_WET;
    if (C.output_fragment != null && !C.output_fragment.includes('d37Rt')) C.output_fragment += RT_OUT;
    if (C.project_vertex != null) C.project_vertex = E.patchWave(C.project_vertex);   // ветер — только у материалов с D37_WAVE
    // погода на поверхностях: объявления — в normal_pars_fragment (до main), сам кусок — после нормалей (до света)
    if (!E.gfxSafe?.('clim') && C.normal_pars_fragment != null && C.normal_fragment_maps != null && !C.normal_pars_fragment.includes('D37_CLIM')) {
      C.normal_pars_fragment += CLIM_PARS; C.normal_fragment_maps += CLIM_FRAG; E.climShaders = true;
    }
    // карта «что над головой» — одна текстура на всю страницу: three копирует текстуры uniform при сборке (clone) — эта
    // отдаёт себя же (рисует в неё precip.js); не нарисована — чтение даёт 0 (небо открыто)
    if (!U.occRT && T.WebGLRenderTarget) {
      U.occRT = new T.WebGLRenderTarget(256, 256, { depthBuffer: true, stencilBuffer: false });
      const ot = U.occRT.texture; ot.minFilter = ot.magFilter = T.NearestFilter; ot.generateMipmaps = false; ot.name = 'd37occ';
      ot.clone = function (){ return this; };
    }
    for (const k of LIT) {
      const L = T.ShaderLib && T.ShaderLib[k]; if (!L || !L.uniforms) continue;
      L.uniforms.d37FogA = { value: U.fogA }; L.uniforms.d37FogB = { value: U.fogB }; L.uniforms.d37FogC = { value: U.fogC };
      if (E.aerialFog) { L.uniforms.d37ApA = { value: U.apA }; L.uniforms.d37ApB = { value: U.apB }; L.uniforms.d37ApC = { value: U.apC }; L.uniforms.d37ApD = { value: U.apD }; }
      L.uniforms.d37Wind = { value: U.wind };
      if (k !== 'basic' && k !== 'matcap' && k !== 'points' && k !== 'sprite' && k !== 'dashed') L.uniforms.d37Sh = { value: U.sh };
      if (k === 'standard' || k === 'physical') L.uniforms.d37Rt = { value: U.rt };
      if (k === 'standard' || k === 'physical' || k === 'lambert' || k === 'phong' || k === 'toon') {
        L.uniforms.d37Cl = { value: U.cl }; L.uniforms.d37Cl2 = { value: U.cl2 }; L.uniforms.d37ClO = { value: U.clO }; L.uniforms.d37ClM = { value: U.clM };
        if (U.occRT) L.uniforms.d37ClTex = { value: U.occRT.texture };
      }
    }
    try { Object.defineProperty(C, '__d37', { value: 1, enumerable: false, writable: true, configurable: true }); } catch (e) { C.__d37 = 1; }
    return true;
  };
  // дымка атмосферы в тумане (T-075): on — кусок с дымкой (только поверх своих кусков и если страж не запомнил 'aerial'), off —
  // прежний кусок и d37ApA.w = 0. Ставить ДО сборки материалов сцены (программы three кэшируются по параметрам, не по тексту)
  E.aerialPatch = (T, on) => {
    const C = T && T.ShaderChunk;
    if (!C) return false;
    if (on) {
      if (!C.__d37 || E.gfxSafe?.('aerial')) return false;
      C.fog_pars_fragment = FOG_PARS_F_AP; C.fog_fragment = FOG_F_AP;
      for (const k of LIT) {
        const L = T.ShaderLib && T.ShaderLib[k]; if (!L || !L.uniforms) continue;
        L.uniforms.d37ApA = { value: U.apA }; L.uniforms.d37ApB = { value: U.apB }; L.uniforms.d37ApC = { value: U.apC }; L.uniforms.d37ApD = { value: U.apD };
      }
      E.aerialFog = true;
      return true;
    }
    if (C.fog_fragment === FOG_F_AP) { C.fog_pars_fragment = FOG_PARS_F; C.fog_fragment = FOG_F; }
    E.aerialFog = false; U.apA[3] = 0;
    return true;
  };

  // ═══ Купол неба (рисуется ПОСЛЕ непрозрачного — пиксели под зданиями не считаются; на дальней плоскости) ═══
  E.skyMaterial = (T, env) => {
    const u = {
      uSun: { value: new T.Vector3(0, 1, 0) }, uMoon: { value: new T.Vector3(0, -1, 0) },
      uZen: { value: new T.Color() }, uHor: { value: new T.Color() }, uGnd: { value: new T.Color() }, uGlow: { value: new T.Color() }, uDusk: { value: new T.Color() }, uSunC: { value: new T.Color() },
      uP: { value: new T.Vector4(1, .25, 0, 0) }, uM: { value: new T.Vector4(0, 0, 0, 0) },
      // небо v2 (наборы шейдеров, define D37_SKY2): облака слоем по небу — x облачность, y время, z слоёв (1/2), w — сила зари
      uCl: { value: new T.Vector4(0, 0, 1, 1) }, uClC: { value: new T.Color(1, 1, 1) }, uClD: { value: new T.Color(.6, .65, .72) },
      uRb: { value: new T.Vector4(0, 0, 0, 0) },   // радуга (погода, D37_RBOW): x — сила
    };
    return new T.ShaderMaterial({
      name: 'sky', uniforms: u, depthWrite: false, depthTest: !env, fog: false, side: T.BackSide, toneMapped: false, extensions: { derivatives: true },
      vertexShader: `varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p;${env ? '' : ' gl_Position.z = p.w * 0.99999;'} }`,
      // #include — только с новой строки (иначе шейдер не собирается)
      fragmentShader: `uniform vec3 uSun; uniform vec3 uMoon; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGnd; uniform vec3 uGlow; uniform vec3 uDusk; uniform vec3 uSunC;
uniform vec4 uP; uniform vec4 uM; varying vec3 vDir;
#ifdef D37_RBOW
uniform vec4 uRb;
#endif
float d37Hash( vec3 p ){ p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
#ifdef D37_SKY2
uniform vec4 uCl; uniform vec3 uClC; uniform vec3 uClD;
float d37H2( vec2 p ){ vec3 q = fract( vec3( p.xyx ) * 0.1031 ); q += dot( q, q.yzx + 33.33 ); return fract( ( q.x + q.y ) * q.z ); }
float d37N2( vec2 p ){
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( d37H2( i ), d37H2( i + vec2( 1.0, 0.0 ) ), f.x ), mix( d37H2( i + vec2( 0.0, 1.0 ) ), d37H2( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float d37Fbm( vec2 p, float oct ){
  float s = 0.0, a = 0.5, n = 0.0;
  for ( int i = 0; i < 5; i ++ ) { if ( float( i ) >= oct ) break; s += a * d37N2( p ); n += a; p = p * 2.02 + vec2( 11.7, 5.3 ); a *= 0.5; }
  return s / n;
}
#endif
void main(){
  vec3 d = normalize( vDir );
  float h = d.y, t = pow( clamp( h, 0.0, 1.0 ), 0.45 + 0.35 * uP.y );
  vec3 c = mix( uHor, uZen, t );
  if ( h < 0.0 ) c = mix( uHor, uGnd, smoothstep( 0.0, 0.25, -h ) );
  float cs = dot( d, uSun ), g = 0.76, hg = ( 1.0 - g * g ) / pow( 1.0 + g * g - 2.0 * g * cs, 1.5 );
  c += uGlow * hg * 0.02 * ( 1.0 - 0.4 * t );
  vec2 dh = d.xz / max( length( d.xz ), 1e-4 ), sh = uSun.xz / max( length( uSun.xz ), 1e-4 );
  float az = max( dot( dh, sh ), 0.0 );
  c += uDusk * ( az * az * az * exp( - max( h, 0.0 ) * 6.0 ) * uM.w );
  float r = 0.00006 * uP.x * uP.x, glow = 0.0;
  float sd = smoothstep( 1.0 - r * 1.6, 1.0 - r, cs ) * step( -0.05, h );
  c += uSunC * sd; glow += sd * 0.6;
  if ( uM.x > 0.001 ) {
    float cm = dot( d, uMoon ), mr = 0.00012;
    float disc = smoothstep( 1.0 - mr * 1.25, 1.0 - mr, cm );
    c = mix( c, vec3( 0.78, 0.82, 0.95 ) * ( 0.9 + 0.1 * sin( d.x * 900.0 + d.z * 700.0 ) ), disc * uM.x );
    c += vec3( 0.05, 0.07, 0.12 ) * uM.x * pow( max( cm, 0.0 ), 400.0 );
    glow += disc * uM.x * 0.3;
  }
  if ( uP.z > 0.001 && h > 0.0 ) {
    vec3 sp = d * 170.0, ci = floor( sp ), f = sp - ci - 0.5;
    float rnd = d37Hash( ci );
    if ( rnd > 0.996 ) {
      vec3 o = vec3( d37Hash( ci + 1.7 ), d37Hash( ci + 3.1 ), d37Hash( ci + 5.9 ) ) - 0.5;
      float dist = length( f - o * 0.6 ), w = max( fwidth( dist ), 0.02 );
      float tw = 0.65 + 0.35 * sin( uP.w * ( 1.5 + rnd * 3.0 ) + rnd * 60.0 );
      c += vec3( 0.85, 0.9, 1.0 ) * ( 1.0 - smoothstep( 0.04, 0.04 + w * 1.5, dist ) ) * uP.z * tw * smoothstep( 0.0, 0.18, h ) * ( rnd - 0.996 ) * 300.0;
    }
  }
#ifdef D37_SKY2
  // небо v2: шире ореол солнца и заря у горизонта; облака слоем (шум по проекции на плоскость, плывут; к солнцу — светлее,
  // в толще — темнее, солнце и звёзды за облаком гаснут); второй слой — тонкие перистые (высокий набор)
  c += uGlow * pow( max( cs, 0.0 ), 24.0 ) * 0.25 * ( 1.0 - 0.5 * t );
  c += uDusk * ( az * az * exp( - max( h, 0.0 ) * 3.0 ) * uM.w ) * 0.35 * uCl.w;
  if ( uM.x > 0.001 ) c += vec3( 0.06, 0.075, 0.12 ) * uM.x * pow( max( dot( d, uMoon ), 0.0 ), 60.0 );   // ореол луны
  if ( uP.z > 0.001 && h > 0.0 ) {   // второй слой звёзд — мельче и с цветом (тёплые и голубые)
    vec3 sq = d * 290.0, cj = floor( sq ), fq = sq - cj - 0.5;
    float rq = d37Hash( cj + 7.7 );
    if ( rq > 0.9965 ) {
      float dq = length( fq ), wq = max( fwidth( dq ), 0.02 );
      vec3 sc = mix( vec3( 1.0, 0.82, 0.62 ), vec3( 0.7, 0.82, 1.0 ), d37Hash( cj + 2.3 ) );
      c += sc * ( 1.0 - smoothstep( 0.03, 0.03 + wq * 1.5, dq ) ) * uP.z * smoothstep( 0.05, 0.25, h ) * ( rq - 0.9965 ) * 260.0 * ( 0.7 + 0.3 * sin( uP.w * ( 2.0 + rq * 5.0 ) + rq * 40.0 ) );
    }
  }
  if ( uCl.x > 0.001 && h > 0.0 ) {
    vec2 cp = d.xz / ( h + 0.08 ) * 0.9 + uCl.y * vec2( 0.012, 0.005 );
    float n = d37Fbm( cp * 1.6, uCl.z > 1.5 ? 5.0 : 3.0 );
    float th = 1.0 - uCl.x * 0.8;
    float cov = smoothstep( th, th + 0.26, n );
    float ln = d37Fbm( cp * 1.6 + uSun.xz * 0.09, 3.0 );
    float shade = clamp( 0.6 + ( n - ln ) * 2.4, 0.2, 1.0 );
    float fwd = pow( max( cs, 0.0 ), 6.0 );
    vec3 cc = mix( uClD, uClC, shade ) + uGlow * fwd * 0.3 * ( 1.0 - cov * 0.5 );
    cov *= smoothstep( 0.0, 0.14, h );
    if ( uCl.z > 1.5 ) {
      float ci = d37Fbm( vec2( cp.x * 0.7, cp.y * 3.2 ) * 1.1 - uCl.y * vec2( 0.02, 0.0 ), 4.0 );
      float cv2 = smoothstep( 0.55, 0.85, ci ) * 0.35 * smoothstep( 0.05, 0.3, h ) * ( 1.0 - cov );
      c = mix( c, uClC * 1.05 + uGlow * fwd * 0.2, cv2 );
    }
    c = mix( c, cc, cov * 0.94 );
    glow *= 1.0 - cov;
  }
#endif
#ifdef D37_RBOW
  // радуга: дуга вокруг точки напротив солнца, ~40–42° (снаружи красный, внутри фиолетовый); после дождя, солнце за спиной
  if ( uRb.x > 0.001 && h > 0.0 ) {
    float ra = acos( clamp( dot( d, - uSun ), -1.0, 1.0 ) ) * 57.29578, rt = ( ra - 40.2 ) / 2.4;
    vec3 rc = clamp( abs( fract( ( 1.0 - clamp( rt, 0.0, 1.0 ) ) * 0.78 + vec3( 0.0, 0.6667, 0.3333 ) ) * 6.0 - 3.0 ) - 1.0, 0.0, 1.0 );
    c += rc * smoothstep( -0.2, 0.08, rt ) * ( 1.0 - smoothstep( 0.92, 1.2, rt ) ) * uRb.x * 0.3 * smoothstep( 0.0, 0.1, h );
  }
#endif
  gl_FragColor = vec4( max( c, vec3( 0.0 ) ), 1.0 + glow );
#include <encodings_fragment>
}`,
    });
  };
  // Модель → uniform купола (u — skyMaterial().uniforms)
  E.skyUniforms = (u, M, time = 0) => {
    u.uSun.value.set(M.sun[0], M.sun[1], M.sun[2]); u.uMoon.value.set(M.moon[0], M.moon[1], M.moon[2]);
    u.uZen.value.setRGB(M.zen[0], M.zen[1], M.zen[2]); u.uHor.value.setRGB(M.hor[0], M.hor[1], M.hor[2]); u.uGnd.value.setRGB(M.gnd[0], M.gnd[1], M.gnd[2]);
    u.uGlow.value.setRGB(M.glow[0], M.glow[1], M.glow[2]); u.uDusk.value.setRGB(M.dusk[0], M.dusk[1], M.dusk[2]); u.uSunC.value.setRGB(M.sunC[0], M.sunC[1], M.sunC[2]);
    u.uP.value.set(M.sunSize, M.haze, M.stars, time % 1000);
    u.uM.value.set(M.moonI * M.night, 0, 0, M.dusk01);
    if (u.uClC) {   // облака неба v2: освещённая сторона — как облака-спрайты, тень — темнее и с цветом неба
      u.uClC.value.setRGB(M.cloud[0], M.cloud[1], M.cloud[2]);
      u.uClD.value.setRGB(M.cloud[0] * .52 + M.zen[0] * .12, M.cloud[1] * .54 + M.zen[1] * .12, M.cloud[2] * .58 + M.zen[2] * .14);
    }
  };

  // ═══ Вода v2: два слоя ряби по миру, френель (у горизонта — зеркало неба), цвет и прозрачность по глубине, пена у берега ═══
  // opts.depth — { tex: DataTexture высот дна (R), rect: [x0, z0, ширина, глубина] } (ландшафт студии, пруд мира); нет — «глубоко»
  // Общие для мира (R.waterU): uTime, uClear (0…1 прозрачность), uFoam (0…1). Цвет — цвет материала (мелко — светлее,
  // глубоко — темнее). Только mid/high (на low — простая полупрозрачная).
  E.waterMaterial = (R, c, opts = {}) => {
    const T = R.T, WU = R.waterU;
    const nm = R.normalFrom('waterN2', 256, n => {
      const H = new Float32Array(n * n), rnd = E.rng(29), waves = Array.from({ length: 12 }, () => [1 + (rnd() * 6 | 0), (rnd() * 13 | 0) - 6, rnd() * PI * 2, .25 + rnd() * .75]);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let h = 0; for (const [a, b, p, k] of waves) h += Math.sin((a * x + b * y) / n * PI * 2 + p) * k / Math.hypot(a, b); H[y * n + x] = h * .5; }
      return H;
    }, 2.2);
    const m = new T.MeshStandardMaterial({ color: c, roughness: .08, metalness: 0, transparent: true, opacity: .9, normalMap: nm, envMapIntensity: 1.1 });
    m.normalScale = new T.Vector2(.5, .5);
    m.name = 'water';   // имя — для стража графики (какая программа не собралась)
    m.userData.tile = 4 * (E.UNIT || 1); m.userData.noCast = true; m.userData.noAO = true; m.userData.water = true;
    const dep = opts.depth || null;
    const own = { tDep: { value: dep?.tex || null }, uDepR: { value: new T.Vector4(...(dep?.rect || [0, 0, 1, 1])) } };
    m.userData.waterU = own;
    m.defines = { D37_WATER: 1 };
    if (dep?.tex) m.defines.D37_WDEPTH = 1;
    // волны (js/engine/waves.js, T-022c): opts.waves — поле волн этой воды, wavesMode 'v' — смещение вершин («блин»), 'f' — нормали
    const GW = E.waves?.GLSL || null;
    if (opts.waves && E.waves?.can?.(R)) E.waves.use(m, opts.waves, opts.wavesMode || 'f');
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, WU, own, m.userData.gwU || {});
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vD37W;' + (GW ? GW.pars() : ''))
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>' + (GW ? GW.vNormal : ''))
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvD37W = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;' + (GW ? GW.vBegin : ''));
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vD37W;
uniform float uTime; uniform float uClear; uniform float uFoam; uniform float uWQ;
uniform vec4 uDepR;
#ifdef D37_WDEPTH
${PREC_HI}uniform sampler2D tDep;
${PREC_LO}#endif${GW ? GW.pars() + GW.fPars() : ''}`)
        // нормаль: два слоя ряби в мировых координатах (только у горизонтальной поверхности)
        .replace('#include <normal_fragment_maps>', `#ifdef USE_NORMALMAP
  vec2 wq = vD37W.xz;
  vec3 n1 = texture2D( normalMap, wq * 0.052 + uTime * vec2( 0.021, 0.013 ) ).xyz * 2.0 - 1.0;
  vec2 nn = n1.xy * 0.8;
  if ( uWQ > 0.5 ) { vec3 n2 = texture2D( normalMap, wq * 0.137 + uTime * vec2( -0.017, 0.026 ) ).xyz * 2.0 - 1.0; nn = n1.xy * 0.65 + n2.xy * 0.45; }
  nn *= normalScale.x;
  vec3 wn = normalize( vec3( nn.x, 1.0, nn.y ) );
  vec3 up = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  float flatK = smoothstep( 0.6, 0.9, abs( dot( normal, up ) ) );
  vec3 wv = normalize( ( viewMatrix * vec4( wn, 0.0 ) ).xyz ) * ( dot( normal, up ) < 0.0 ? -1.0 : 1.0 );
#ifdef D37_GW
  wv = d37GwView( normal, nn, up );   // волны Герстнера (waves.js) + рябь поверх
#endif
#ifdef D37_CLIM
  flatK *= 1.0 - smoothstep( 0.0, 0.35, d37Cl.w );   // лёд: ряби нет
#endif
  normal = normalize( mix( normal, wv, flatK ) );
#endif
#ifdef D37_CLIM
  roughnessFactor = mix( roughnessFactor, 0.32, smoothstep( 0.0, 0.35, d37Cl.w ) );
#endif`)
        // цвет и прозрачность по глубине, пена у берега
        .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>${GW ? GW.fMask : ''}
  float wDepth = 1.6;
#ifdef D37_WDEPTH
  vec2 duv = ( vD37W.xz - uDepR.xy ) / uDepR.zw;
  if ( uWQ > 0.5 && duv.x > 0.0 && duv.y > 0.0 && duv.x < 1.0 && duv.y < 1.0 ) wDepth = max( vD37W.y - texture2D( tDep, duv ).r, 0.0 );
#endif
  float wk = 1.0 - exp( - wDepth * mix( 1.4, 0.18, uClear ) ), wa = 1.0 - exp( - wDepth * mix( 2.6, 0.45, uClear ) );
  diffuseColor.rgb = mix( diffuse * vec3( 0.55, 0.7, 0.7 ) + 0.01, diffuse * vec3( 0.025, 0.06, 0.1 ), wk );
  diffuseColor.a = mix( mix( 0.35, 0.1, uClear ), mix( 0.97, 0.88, uClear ), wa );
  if ( uWQ > 0.5 && wDepth < 0.6 ) {
    float fn = texture2D( normalMap, vD37W.xz * 0.21 - uTime * vec2( 0.03, 0.02 ) ).x;
    float foam = uFoam * 0.85 * ( 1.0 - smoothstep( 0.0, 0.16 + 0.14 * fn, wDepth ) ) * smoothstep( 0.4, 0.65, fn + 0.3 * ( 1.0 - wDepth / 0.3 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.95 ), foam );
    diffuseColor.a = max( diffuseColor.a, foam * 0.9 );
  }
#ifdef D37_CLIM
  if ( d37Cl.w > 0.0 ) {   // лёд (погода): белёсый, с трещинами и пятнами, вода под ним не видна; сверху — снег
    vec2 iq = d37ClO.xy + ( vD37W.xz - cameraPosition.xz );
    float in1 = d37Cn( iq * 0.5, 128.0 ), in2 = d37Cn( iq * 2.0, 512.0 );
    float icr = 1.0 - smoothstep( 0.0, 0.05, abs( in1 - 0.5 ) );
    vec3 ice = mix( vec3( 0.66, 0.8, 0.9 ), vec3( 0.88, 0.94, 0.99 ), in2 ) * ( 1.0 - 0.2 * icr );
    ice = mix( ice, vec3( 0.88, 0.91, 0.96 ), smoothstep( in2 - 0.1, in2 + 0.1, d37Cl.x ) * 0.85 );
    float ik = smoothstep( 0.0, 0.35, d37Cl.w );
    diffuseColor = vec4( mix( diffuseColor.rgb, ice, ik ), mix( diffuseColor.a, 0.97, ik ) );
  }
#endif
#ifdef D37_WATER3
  {   // вода v3 (наборы шейдеров): каустика — свет «пляшет» по мелкому дну, вода чище и бирюзовее у берега
    vec2 cq = vD37W.xz * 0.33;
    float c1 = texture2D( normalMap, cq + uTime * vec2( 0.031, 0.017 ) ).x;
    float c2 = texture2D( normalMap, cq * 1.37 - uTime * vec2( 0.023, 0.029 ) ).y;
    float ca = pow( clamp( 1.0 - abs( c1 + c2 - 1.0 ) * 2.6, 0.0, 1.0 ), 6.0 );
    float sh = exp( - wDepth * 1.5 );
    diffuseColor.rgb += vec3( 0.5, 0.72, 0.66 ) * ca * sh * 0.5;
    diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.86, 1.04, 1.08 ), sh );
  }
#endif${GW ? GW.fFoam : ''}`)
        // френель: у горизонта вода — зеркало (непрозрачнее)
        .replace('#include <output_fragment>', `#include <output_fragment>
  float fr = pow( 1.0 - clamp( abs( dot( normal, normalize( vViewPosition ) ) ), 0.0, 1.0 ), 4.0 );
  gl_FragColor.a = clamp( mix( gl_FragColor.a, 1.0, fr * 0.6 ), 0.0, 1.0 );`);
    };
    m.customProgramCacheKey = () => 'd37-water2' + (dep?.tex ? 'd' : '');   // D37_WATER3 — в defines (ключ программы его учитывает)
    return m;
  };
  // Вода и стекло для отражений (post.js): пока трассировка включена, их смешивание пишет в альфу буфера сцены 0 (цвет —
  // как обычно, по их прозрачности) — так отражения знают, где «прозрачное блестящее». Выключена — обычное смешивание.
  // Смешивание — состояние GL, шейдер не пересобирается
  E.rtMark = (T, m, on) => {
    if (!m || !m.transparent) return m;
    if (on) Object.assign(m, { blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.SrcAlphaFactor, blendDst: T.OneMinusSrcAlphaFactor,
      blendEquationAlpha: T.AddEquation, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.ZeroFactor });
    else Object.assign(m, { blending: T.NormalBlending, blendEquationAlpha: null, blendSrcAlpha: null, blendDstAlpha: null });
    return m;
  };
  // Текстура высот дна для воды: f(x, z) → высота дна, прямоугольник [x0, z0, w, d], n×n точек (половинные float, WebGL2)
  E.waterDepthTex = (R, f, rect, n = 64) => {
    const T = R.T;
    if (!R.r.capabilities.isWebGL2 || !T.DataUtils?.toHalfFloat) return null;
    const data = new Uint16Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = T.DataUtils.toHalfFloat(f(rect[0] + (i + .5) / n * rect[2], rect[1] + (j + .5) / n * rect[3]));
    const t = new T.DataTexture(data, n, n, T.RedFormat, T.HalfFloatType);
    t.magFilter = t.minFilter = T.LinearFilter; t.wrapS = t.wrapT = T.ClampToEdgeWrapping; t.needsUpdate = true;
    R.own?.push(t);
    return t;
  };

  // ═══ Наборы шейдеров (16.10.2026, владелец: «сделай шейдеры для нашего движка, чтобы Майн, Террария и другие режимы
  //     работали красиво» — как наборы шейдеров для Майнкрафта, но свои и внутри движка) ═══
  // Набор — ДАННЫЕ поверх переключателей движка и новых эффектов (никакого GLSL от игроков): тон (ACES как сейчас / AgX —
  // мягче к ярким, как в кино), цвет кадра (LUT 32³ печётся здесь, в JS), свечение, лучи солнца и луны сквозь листву
  // (post.js), облака слоем по небу и небо v2 (купол, D37_SKY2), ветер в траве и листве (D37_WAVE), вода v3 (каустика,
  // D37_WATER3; под водой — тон и колыхание кадра), мультяшный (полосы света + контуры), ретро (крупные пиксели, 64 цвета,
  // точечный узор). «Обычные» — ровно сегодняшние шейдеры: ни одного нового куска не собирается. Новое у других наборов
  // включается define'ом — страж графики (post.js) проверяет каждую такую программу: не собралась / кадр гаснет → набор
  // запоминается как «не работает здесь» и включается предыдущий (ultra → pretty → normal).
  // Числа эффектов — ступени (0 — выкл): rays 1 — четверть кадра, 24 шага; 2 — половина, 40 шагов; clouds 1 — слой, 3 октавы;
  // 2 — два слоя (кучевые + перистые), 5 октав; water 1 — каустика; dof, mblur — только «Ультра» на компьютере (позже).
  const LOOK0 = { ev: 0, sat: 1, con: 0, warm: 0, tint: 0, lift: [0, 0, 0], gain: [1, 1, 1], shT: [0, 0, 0], hiT: [0, 0, 0], split: 0 };
  E.PACKS = {
    normal: { name: 'Обычные', icon: '🎨', hint: 'Как сейчас: проверено на всех устройствах, самое быстрое.', tone: 'aces', bloom: 1 },
    pretty: { name: 'Красивые', icon: '✨', hint: 'Мягкий кинотон (AgX), лучи солнца сквозь листву, облака по небу, трава и листва на ветру, вода с бликами по дну.',
      tone: 'agx', look: { ev: .22, agx: { power: 1.5, sat: 1.35 }, con: .04, warm: .03, shT: [.005, .012, .03], hiT: [.04, .025, 0], split: .45 }, bloom: 1.25, rays: 1, clouds: 1, sky: 1, wave: 1, water: 1, under: 1, halo: 1.2 },
    ultra: { name: 'Ультра', icon: '💎', hint: 'Всё из «Красивых», лучи и облака в полном качестве, перистые облака, глубина резкости с автофокусом (резко там, куда смотришь; мягко размыта только даль) — для мощных компьютеров.',
      tone: 'agx', look: { ev: .24, agx: { power: 1.55, sat: 1.4 }, con: .06, warm: .04, shT: [.006, .014, .035], hiT: [.045, .028, 0], split: .5 }, bloom: 1.4, rays: 2, clouds: 2, sky: 1, wave: 1, water: 1, under: 1, halo: 1.4, dof: 1 },
    toon: { name: 'Мультяшные', icon: '🖍', hint: 'Как мультфильм: свет полосами, чёрные контуры, сочные цвета.',
      tone: 'aces', look: { ev: .05, sat: 1.18, con: .04 }, bloom: .8, clouds: 1, sky: 1, wave: 1, water: 1, under: 1, toon: { bands: 4, line: 1 } },
    retro: { name: 'Ретро/пиксели', icon: '👾', hint: 'Крупные пиксели и цвет полосами — как в старых играх.',
      tone: 'aces', look: { ev: .05, sat: 1.1, con: .08 }, bloom: .55, clouds: 1, retro: { pixel: 3, dither: 0, levels: 6 } },
  };
  E.PACK_IDS = Object.keys(E.PACKS);
  E.PACK_FALLBACK = { ultra: 'pretty', pretty: 'normal', toon: 'normal', retro: 'normal', normal: 'normal' };
  // Сильный телефон (для «Авто»): по видеокарте (E.gpuInfo в post.js) и ядрам
  E.strongPhone = (gpu, cores) => {
    if (!gpu) return false;
    const m = String(gpu.model || ''), num = +(/(\d{3,4})/.exec(m) || [])[1] || 0;
    const ok = gpu.fam === 'apple' || gpu.fam === 'xclipse' || (gpu.fam === 'adreno' && num >= 730) || (gpu.fam === 'mali' && /g7[1-9]\d|g9\d\d|immortalis/i.test(m));
    return ok && (cores || 8) >= 6;
  };
  // «Авто»: по пресету графики, как у 2D-наборов (ультра → «Ультра», высокая → «Красивые», низкая/средняя → «Обычные»); пресет
  // «Авто»/«Своя» — по устройству: телефон — «Обычные» (сильный — «Красивые»), компьютер с высокой основой — «Красивые»
  E.packAuto = (dev = {}) => {
    if (dev.q === 'low') return 'normal';
    const p = dev.preset;
    if (p === 'ultra') return 'ultra';
    if (p === 'high') return 'pretty';
    if (p === 'low' || p === 'mid') return 'normal';
    return dev.mobile ? (E.strongPhone(dev.gpu, dev.cores) ? 'pretty' : 'normal') : dev.q === 'high' ? 'pretty' : 'normal';
  };
  // Набор → что включить на этом устройстве. want — 'auto' | id; dev — { q, mobile, gpu, cores, off (решения стража), post: false —
  // без постобработки }. Не работает здесь (страж) — предыдущий по лесенке; low / без постобработки — «Обычные»
  E.packResolve = (want = 'auto', dev = {}) => {
    let id = want === 'auto' || !E.PACKS[want] ? E.packAuto(dev) : want;
    const off = dev.off || {};
    for (let i = 0; i < 4 && off['pack:' + id]; i++) id = E.PACK_FALLBACK[id] || 'normal';
    if (dev.q === 'low' || dev.post === false) id = 'normal';
    const p = E.PACKS[id] || E.PACKS.normal, cap = dev.mobile ? 1 : dev.q === 'high' ? 2 : 1;
    const look = { ...LOOK0, ...(p.look || {}) };
    const fx = { id, want, name: p.name, tone: p.tone === 'agx' ? 'agx' : 'aces', look, bloom: num(p.bloom, 1), halo: num(p.halo, 1),
      rays: Math.min(p.rays | 0, cap), clouds: Math.min(p.clouds | 0, cap), sky: p.sky | 0, wave: p.wave ? 1 : 0, water: p.water ? 1 : 0, under: p.under ? 1 : 0,
      toon: p.toon ? { bands: cl(p.toon.bands | 0, 2, 8), line: p.toon.line ? 1 : 0 } : null,
      retro: p.retro ? { pixel: cl(p.retro.pixel | 0, 2, 6), dither: p.retro.dither ? 1 : 0, levels: cl(p.retro.levels | 0, 2, 8) } : null,
      dof: dev.mobile ? 0 : p.dof | 0, mblur: dev.mobile ? 0 : p.mblur | 0, crt: !!(p.retro && dev.crt) };
    fx.lut = fx.tone !== 'aces' || !!fx.retro || JSON.stringify(look) !== JSON.stringify(LOOK0);
    return fx;
  };
  // Набор из данных (мир, мод — потом): только известные поля, числа в пределах; GLSL нельзя
  E.packSanitize = d => {
    if (!d || typeof d !== 'object') return null;
    const L = d.look && typeof d.look === 'object' ? d.look : {}, v3 = (a, lo, hi, def) => Array.isArray(a) && a.length === 3 ? a.map(x => cl(num(x, def), lo, hi)) : [def, def, def];
    return { name: String(d.name || 'Свой').slice(0, 24), icon: '🎨', tone: d.tone === 'agx' ? 'agx' : 'aces',
      look: { ev: cl(num(L.ev, 0), -1, 1), sat: cl(num(L.sat, 1), 0, 2), agx: L.agx && typeof L.agx === 'object' ? { power: cl(num(L.agx.power, 1), .5, 2), sat: cl(num(L.agx.sat, 1), 0, 2) } : undefined, con: cl(num(L.con, 0), -.5, .5), warm: cl(num(L.warm, 0), -.5, .5), tint: cl(num(L.tint, 0), -.5, .5),
        lift: v3(L.lift, -.1, .1, 0), gain: v3(L.gain, .5, 1.5, 1), shT: v3(L.shT, 0, .2, 0), hiT: v3(L.hiT, 0, .2, 0), split: cl(num(L.split, 0), 0, 1) },
      bloom: cl(num(d.bloom, 1), 0, 2.5), rays: cl(d.rays | 0, 0, 2), clouds: cl(d.clouds | 0, 0, 2), sky: d.sky ? 1 : 0, wave: d.wave ? 1 : 0, water: d.water ? 1 : 0, under: d.under ? 1 : 0 };
  };

  // ── Тон и цвет кадра: LUT 32³ (sRGB → sRGB) — сборка кадра (post.js, D37_LUT) переводит им «как нарисовано» в «как в наборе».
  // Материалы рисуют с ACES (как и раньше): для AgX значение возвращается назад через обратный ACES (точно: ACES в three —
  // матрица × дробь по каналам, обратная дробь — корень квадратного уравнения) и проходит AgX. Потом — цвет набора.
  const MUL = (m, v, o) => { const x = v[0], y = v[1], z = v[2]; o[0] = m[0] * x + m[1] * y + m[2] * z; o[1] = m[3] * x + m[4] * y + m[5] * z; o[2] = m[6] * x + m[7] * y + m[8] * z; return o; };
  const INV3 = m => {
    const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  };
  // строки матриц (a = M · c), как в E.aces
  const ACES_IN = [.59719, .35458, .04823, .076, .90834, .01566, .0284, .13383, .83777], ACES_OUT = [1.60475, -.53108, -.07367, -.10208, 1.10813, -.00605, -.00327, -.07276, 1.07602];
  const ACES_IN_I = INV3(ACES_IN), ACES_OUT_I = INV3(ACES_OUT);
  const rrtInv = w => {   // (a² + 0,0245786a − 0,000090537) / (0,983729a² + 0,432951a + 0,238081) = w → a ≥ 0
    w = cl(w, 0, 1.0162);
    const A = 1 - .983729 * w, B = .0245786 - .432951 * w, C = -(.000090537 + .238081 * w);
    return Math.max(0, (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A));
  };
  // выход ACES (линейный 0…1) → вход до кривой (уже с экспозицией) — то, что увидел бы AgX
  E.acesInv = (y, out = [0, 0, 0]) => {
    const w = MUL(ACES_OUT_I, y, [0, 0, 0]);
    w[0] = rrtInv(w[0]); w[1] = rrtInv(w[1]); w[2] = rrtInv(w[2]);
    return MUL(ACES_IN_I, w, out);
  };
  // AgX (Трой Собетка, Blender; вариант Filament / three.js — MIT, Apache-2.0): линейный sRGB (с экспозицией) → линейный 0…1
  const S2020 = [.6274, .3293, .0433, .0691, .9195, .0113, .0164, .088, .8956], R2020 = [1.6605, -.5876, -.0728, -.1246, 1.1329, -.0083, -.0182, -.1006, 1.1187];
  const AGX_IN = [.856627153315983, .0951212405381588, .0482516061458583, .137318972929847, .761241990602591, .101439036467562, .11189821299995, .0767994186031903, .811302368396859];
  const AGX_OUT = [1.1271005818144368, -.11060664309660323, -.016493938717834573, -.1413297634984383, 1.157823702216272, -.016493938717834257, -.14132976349843826, -.11060664309660294, 1.2519364065950405];
  const AGX_MIN = -12.47393, AGX_MAX = 4.026069;
  const agxCurve = x => { const x2 = x * x, x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + .4298 * x2 + .1191 * x - .00232; };
  // look — «взгляд» AgX (как в Filament/Blender): { power, sat } после кривой («сочный» — 1,35 и 1,4)
  E.agx = (v, out = [0, 0, 0], look = null) => {
    const c = MUL(AGX_IN, MUL(S2020, v, [0, 0, 0]), [0, 0, 0]);
    for (let k = 0; k < 3; k++) c[k] = agxCurve(cl((Math.log2(Math.max(c[k], 1e-10)) - AGX_MIN) / (AGX_MAX - AGX_MIN), 0, 1));
    if (look) {
      const pw = look.power || 1, st = look.sat ?? 1;
      for (let k = 0; k < 3; k++) c[k] = Math.pow(Math.max(0, c[k]), pw);
      const lu = .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
      for (let k = 0; k < 3; k++) c[k] = lu + st * (c[k] - lu);
    }
    MUL(AGX_OUT, c, c);
    for (let k = 0; k < 3; k++) c[k] = Math.pow(Math.max(0, c[k]), 2.2);
    MUL(R2020, c, out);
    for (let k = 0; k < 3; k++) out[k] = cl(out[k], 0, 1);
    return out;
  };
  const toS = x => x <= .0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - .055, fromS = x => x <= .04045 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4);
  // Цвет набора (в линейном 0…1 после тона): экспозиция, баланс тепла/оттенка, насыщенность, «подъём/усиление», сплит-тон
  // (тени — холоднее, света — теплее), контраст S-кривой (в sRGB). Возвращает sRGB 0…1
  E.lookApply = (lin, L, out = [0, 0, 0]) => {
    const e = Math.pow(2, L.ev || 0), w = L.warm || 0, ti = L.tint || 0;
    let r = lin[0] * e * (1 + .16 * w - .04 * ti), g = lin[1] * e * (1 + .06 * ti), b = lin[2] * e * (1 - .2 * w - .04 * ti);
    const lum = .2126 * r + .7152 * g + .0722 * b, s = L.sat ?? 1;
    r = lum + (r - lum) * s; g = lum + (g - lum) * s; b = lum + (b - lum) * s;
    if (L.split) { const k = L.split, sh = Math.max(0, 1 - lum * 3), hi = cl((lum - .35) * 1.6, 0, 1); r += (L.shT[0] * sh + L.hiT[0] * hi) * k; g += (L.shT[1] * sh + L.hiT[1] * hi) * k; b += (L.shT[2] * sh + L.hiT[2] * hi) * k; }
    const c = [r, g, b];
    for (let k = 0; k < 3; k++) {
      let x = toS(cl(c[k], 0, 1));
      x = cl(x * (L.gain ? L.gain[k] : 1) + (L.lift ? L.lift[k] : 0) * (1 - x), 0, 1);
      if (L.con) x = cl(x + L.con * (x * x * (3 - 2 * x) - x) * 2, 0, 1);
      out[k] = x;
    }
    return out;
  };
  // Ретро: цвет «полосами» в HSV — оттенок 24 ступени, насыщенность (по корню: у бледных — тоже ступени) и яркость — по lv + 2;
  // так светлое бежевое не становится белым или розовым (как у палитры «каждый канал отдельно»). o — sRGB 0…1, меняется на месте
  E.posterize = (o, lv) => {
    const mx = Math.max(o[0], o[1], o[2]), mn = Math.min(o[0], o[1], o[2]), d = mx - mn;
    let h = 0;
    if (d > 1e-6) h = mx === o[0] ? ((o[1] - o[2]) / d + 6) % 6 : mx === o[1] ? (o[2] - o[0]) / d + 2 : (o[0] - o[1]) / d + 4;
    let s = mx > 1e-6 ? d / mx : 0, v = mx;
    h = Math.round(h * 4) / 4;   // 24 оттенка
    const sl = lv - 1; s = Math.pow(Math.round(Math.sqrt(s) * sl) / sl, 2);
    const vl = lv + 1; v = Math.round(v * vl) / vl;
    const c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c, k = Math.floor(h) % 6;
    const rgb = k === 0 ? [c, x, 0] : k === 1 ? [x, c, 0] : k === 2 ? [0, c, x] : k === 3 ? [0, x, c] : k === 4 ? [x, 0, c] : [c, 0, x];
    o[0] = rgb[0] + m; o[1] = rgb[1] + m; o[2] = rgb[2] + m;
    return o;
  };
  // LUT набора: Uint8Array RGBA, раскладка size*size × size (x = r + b*size, y = g); fx — E.packResolve(…)
  E.packLUT = (fx, size = 32) => {
    const n = size, data = new Uint8Array(n * n * n * 4), lin = [0, 0, 0], v = [0, 0, 0], t = [0, 0, 0], o = [0, 0, 0];
    const lv = fx.retro ? fx.retro.levels : 0;
    for (let bi = 0; bi < n; bi++) for (let gi = 0; gi < n; gi++) for (let ri = 0; ri < n; ri++) {
      lin[0] = fromS(ri / (n - 1)); lin[1] = fromS(gi / (n - 1)); lin[2] = fromS(bi / (n - 1));
      if (fx.tone === 'agx') { E.acesInv(lin, v); E.agx(v, t, fx.look?.agx || null); } else { t[0] = lin[0]; t[1] = lin[1]; t[2] = lin[2]; }
      E.lookApply(t, fx.look || LOOK0, o);
      if (lv) E.posterize(o, lv);
      const i = ((gi * n * n) + ri + bi * n) * 4;
      data[i] = Math.round(o[0] * 255); data[i + 1] = Math.round(o[1] * 255); data[i + 2] = Math.round(o[2] * 255); data[i + 3] = 255;
    }
    return data;
  };
  // Листва для погоды (осенью желтеет, зимой тусклая, весной свежая): 'grass' | 'leaves' | 'needles' (хвоя — не желтеет)
  // — define D37_LEAF (кусок погоды); лучше до первого кадра (иначе — одна пересборка программы)
  E.LEAF_KINDS = { grass: 1, leaves: 2, needles: 3 };
  E.leafMaterial = (m, kind = 'leaves') => {
    if (!m || !m.isMaterial) return m;
    const v = E.LEAF_KINDS[kind] || 2;
    if (m.defines?.D37_LEAF === v) return m;
    m.defines = { ...(m.defines || {}), D37_LEAF: v }; m.userData.leaf = v; m.needsUpdate = true;
    return m;
  };
  // для своих материалов (игры, «Кубомир»): ветер — трава/листва (без R — те же define и данные, что у R.wave)
  E.waveMaterial = (m, o = {}) => {
    if (!m || !m.isMaterial) return m;
    m.userData.wave = { kind: o.kind === 'leaves' || o.kind === 'needles' ? 2 : 1, h: o.h > 0 ? +o.h : .5 };
    E.leafMaterial(m, o.kind);
    return m;
  };
})();
