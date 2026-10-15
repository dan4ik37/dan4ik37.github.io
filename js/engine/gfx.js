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
  E.sunAt = (t, out = [0, 1, 0]) => {
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

  // ═══ Общие данные для шейдеров (Float32Array — общие для всех материалов) ═══
  // fogA: xyz — направление на солнце (мир), w — сила свечения тумана к солнцу; fogB: rgb — цвет тумана у солнца,
  // a — плотность высотного тумана; fogC: x — высота «пола» тумана, y — спад с высотой, z, w — запас;
  // sh: x — выборок PCF (каждая — 2×2 текселя с весами), y — поиск заслонок (0 — без PCSS), z — тексели полутени на 1 ед.
  // глубины карты, w — 2: без наклона приёмника (для проверок), иначе с ним
  // rt: x — мокрые поверхности мира 0…1 (пол глаже и темнее), y — 1: метить блестящее в альфе буфера сцены для отражений
  // (только пока рисуется буфер постобработки с трассировкой — на холст альфа < 1 не попадает), z — 1: трава и листва (вырез по
  // альфе) пишут свой код 1 + 4/1024 — для AO (только пока рисуется буфер постобработки с AO), w — запас
  const U = E.GFXU = E.GFXU || { fogA: new Float32Array(4), fogB: new Float32Array(4), fogC: new Float32Array(4), sh: new Float32Array(4) };
  U.rt = U.rt || new Float32Array(4);

  // ═══ Куски шейдеров three.js (один раз на всю страницу) ═══
  const FOG_PARS_V = `#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vD37Fog;
#endif`;
  const FOG_V = `#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vD37Fog = mvPosition.xyz;
#endif`;
  const FOG_PARS_F = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vD37Fog;
	uniform vec4 d37FogA;
	uniform vec4 d37FogB;
	uniform vec4 d37FogC;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;
  // туман: обычный (по расстоянию) + высотный (плотнее у земли, интеграл по лучу) + к солнцу — тёплый (как небо у солнца)
  const FOG_F = `#ifdef USE_FOG
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
	gl_FragColor.rgb = mix( gl_FragColor.rgb, d37Fc, fogFactor );
#endif`;
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
  // код из альфы (как читает post.js) — для проверок: { kind: 'clear' | 'gloss' | 'metal' | 'foliage' | null, gloss }
  // (null — обычное и светящееся: не блестит; 'foliage' — трава и листва: не блестит и без AO)
  E.rtDecode = a => a < .25 ? { kind: 'clear', gloss: 1 - a * 4 } : a >= .75 && a < .999 ? { kind: a >= .875 ? 'metal' : 'gloss', gloss: Math.max(0, Math.min(1, (a - (a >= .875 ? .875 : .75)) / .12)) }
    : a > 1.0005 && a < 1.01 ? { kind: 'foliage', gloss: 0 } : { kind: null, gloss: 0 };
  E.rtEncode = (rough, metal) => { const t = Math.max(0, Math.min(1, (rough - .55) / (.12 - .55))), g = t * t * (3 - 2 * t); return g > .01 ? (metal > .5 ? .875 : .75) + .12 * g : 1; };
  const LIT = ['basic', 'lambert', 'phong', 'standard', 'physical', 'toon', 'matcap', 'points', 'sprite', 'dashed'];
  // куски three до правки — для безопасного режима (страж графики, post.js: программа сцены не собралась → E.gfxUnpatch)
  const PATCHED = ['fog_pars_vertex', 'fog_vertex', 'fog_pars_fragment', 'fog_fragment', 'shadowmap_pars_fragment', 'roughnessmap_pars_fragment', 'normal_fragment_maps', 'output_fragment'];
  let ORIG = null;
  E.gfxUnpatch = T => {
    const C = T && T.ShaderChunk;
    if (!C || !C.__d37 || !ORIG) return false;
    for (const k of PATCHED) if (k in ORIG) C[k] = ORIG[k];
    C.__d37 = 0;
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
    for (const k of LIT) {
      const L = T.ShaderLib && T.ShaderLib[k]; if (!L || !L.uniforms) continue;
      L.uniforms.d37FogA = { value: U.fogA }; L.uniforms.d37FogB = { value: U.fogB }; L.uniforms.d37FogC = { value: U.fogC };
      if (k !== 'basic' && k !== 'matcap' && k !== 'points' && k !== 'sprite' && k !== 'dashed') L.uniforms.d37Sh = { value: U.sh };
      if (k === 'standard' || k === 'physical') L.uniforms.d37Rt = { value: U.rt };
    }
    try { Object.defineProperty(C, '__d37', { value: 1, enumerable: false, writable: true, configurable: true }); } catch (e) { C.__d37 = 1; }
    return true;
  };

  // ═══ Купол неба (рисуется ПОСЛЕ непрозрачного — пиксели под зданиями не считаются; на дальней плоскости) ═══
  E.skyMaterial = (T, env) => {
    const u = {
      uSun: { value: new T.Vector3(0, 1, 0) }, uMoon: { value: new T.Vector3(0, -1, 0) },
      uZen: { value: new T.Color() }, uHor: { value: new T.Color() }, uGnd: { value: new T.Color() }, uGlow: { value: new T.Color() }, uDusk: { value: new T.Color() }, uSunC: { value: new T.Color() },
      uP: { value: new T.Vector4(1, .25, 0, 0) }, uM: { value: new T.Vector4(0, 0, 0, 0) },
    };
    return new T.ShaderMaterial({
      name: 'sky', uniforms: u, depthWrite: false, depthTest: !env, fog: false, side: T.BackSide, toneMapped: false, extensions: { derivatives: true },
      vertexShader: `varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p;${env ? '' : ' gl_Position.z = p.w * 0.99999;'} }`,
      // #include — только с новой строки (иначе шейдер не собирается)
      fragmentShader: `uniform vec3 uSun; uniform vec3 uMoon; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGnd; uniform vec3 uGlow; uniform vec3 uDusk; uniform vec3 uSunC;
uniform vec4 uP; uniform vec4 uM; varying vec3 vDir;
float d37Hash( vec3 p ){ p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
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
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, WU, own);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vD37W;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvD37W = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vD37W;
uniform float uTime; uniform float uClear; uniform float uFoam; uniform float uWQ;
uniform vec4 uDepR;
#ifdef D37_WDEPTH
${PREC_HI}uniform sampler2D tDep;
${PREC_LO}#endif`)
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
  normal = normalize( mix( normal, wv, flatK ) );
#endif`)
        // цвет и прозрачность по глубине, пена у берега
        .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
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
  }`)
        // френель: у горизонта вода — зеркало (непрозрачнее)
        .replace('#include <output_fragment>', `#include <output_fragment>
  float fr = pow( 1.0 - clamp( abs( dot( normal, normalize( vViewPosition ) ) ), 0.0, 1.0 ), 4.0 );
  gl_FragColor.a = clamp( mix( gl_FragColor.a, 1.0, fr * 0.6 ), 0.0, 1.0 );`);
    };
    m.customProgramCacheKey = () => 'd37-water2' + (dep?.tex ? 'd' : '');
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
})();
