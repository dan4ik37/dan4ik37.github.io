// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — погода, времена года и праздники (свойство движка, 16.10.2026; владелец: «не как в Майне, а лучше:
//  погода меняется везде, с временами года и эффектами как в Симс, с холодом и другим»). Подробно — docs/SEASONS.md
// ═══════════════════════════════════════
// Без three.js и DOM (проверяется в node: scripts/climate-test.cjs; грузится и на обычных страницах сайта — js/core/celebrate.js).
// Всё — от зерна мира и времени: у всех игроков одна и та же погода без сети (как E.dayClock).
//   C = D37E.climate
//   C.calendar(мс, { tz }) — время года по календарю владельца + праздники; C.holidays(мс, { tz }) — что празднуем сейчас;
//   W = C.world({ seed, mode, days, season, weather, climateAt, lapse, seaY, front, hourAt, gameTime, storm }) — мир погоды;
//   W.at(x, z, мс, y) — погода в точке: { season, phase, state, temp, feels, cloud, rain, snow, hail, thunder, fog, heat, wind,
//   windDir, gust, humid, wet, puddle, snowCover, ice, autumn, bare, fresh, climate };
//   C.use(W) / C.at(x, z, мс, y) — «текущий» мир; C.exposure(состояние, о) — холод/жара/мокро для персонажей (Симс — потом);
//   C.on('holiday' | 'season' | 'weather', f) → отписка; C.tick(мс) — проверить смену праздника и сезона.
// Календарь (правила владельца): декабрь–февраль — зима, ноябрь — всегда осень, март–ноябрь — 7 сезонов по ≈ 39 суток (владелец
// 21.10: «не так быстро, хотя бы реальный месяц»; до этого было 38 сезонов по неделе): весна, лето, осень, зима, весна, лето,
// осень. Наурыз (21 марта) — весной. Фаза года φ ∈ [0, 4) непрерывна на всех стыках.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  if (E.climate && E.climate.v) return;
  const C = E.climate = Object.assign(E.climate || {}, { v: 1 });
  const DAY = 86400000, PI2 = Math.PI * 2;
  const cl = (v, a, b) => v < a ? a : v > b ? b : v;
  const num = (v, d) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : d; };
  const sm = (a, b, x) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };   // a < b
  const lerp = (a, b, t) => a + (b - a) * t;

  // ═══ Время ═══
  // «Время мира» для времён года — Москва (UTC+3, как «день по МСК» у остального сайта): у всех игроков общего мира один сезон.
  // Праздники — по МЕСТНОМУ времени игрока (tz — минут к востоку от UTC; по умолчанию — часовой пояс браузера)
  C.ZONE = 180;
  C.localTz = ms => { try { return -new Date(ms).getTimezoneOffset(); } catch (e) { return C.ZONE; } };
  const parts = (ms, tz) => { const d = new Date(ms + tz * 60000); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600, dow: d.getUTCDay() }; };
  C.parts = parts;
  // полночь даты (год, месяц 1…12, день) в часовом поясе tz → мс UTC
  const midnight = (y, m, d, tz) => Date.UTC(y, m - 1, d) - tz * 60000;
  C.midnight = midnight;

  // ═══ Календарь владельца: фаза года φ (0…1 весна, 1…2 лето, 2…3 осень, 3…4 зима) ═══
  C.SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  C.SEASON_NAMES = { spring: 'весна', summer: 'лето', autumn: 'осень', winter: 'зима' };
  C.SEASON_ICONS = { spring: '🌱', summer: '☀️', autumn: '🍂', winter: '❄️' };
  C.FAST = 7;   // сезонов с 1 марта по 30 ноября: весна, лето, осень, зима, весна, лето, осень — по 275 / 7 ≈ 39,3 суток
  C.phaseCal = (ms, tz = C.ZONE) => {
    const t = ms + tz * 60000, d = new Date(t), Y = d.getUTCFullYear(), M = d.getUTCMonth();
    if (M === 11) return 3 + (t - Date.UTC(Y, 11, 1)) / (Date.UTC(Y + 1, 2, 1) - Date.UTC(Y, 11, 1));   // зима: 1 дек … 1 мар (90–91 сут)
    if (M <= 1) return 3 + (t - Date.UTC(Y - 1, 11, 1)) / (Date.UTC(Y, 2, 1) - Date.UTC(Y - 1, 11, 1));
    const L = Date.UTC(Y, 11, 1) - Date.UTC(Y, 2, 1);   // 1 марта … 1 декабря — всегда 275 суток; ноябрь целиком в последней осени
    return (C.FAST * (t - Date.UTC(Y, 2, 1)) / L) % 4;
  };
  C.seasonOf = ph => C.SEASONS[Math.floor(((ph % 4) + 4) % 4) % 4];
  // Осенняя листва, зимняя «голая» (тусклая), весенняя свежая — гладко по фазе
  C.leafOf = ph => {
    ph = ((ph % 4) + 4) % 4;
    const autumn = sm(1.85, 2.5, ph) * (1 - sm(3.05, 3.4, ph));
    const bare = sm(2.95, 3.35, ph) * (1 - sm(3.78, 3.99, ph));
    const fresh = sm(0, .25, ph) * (1 - sm(.6, 1, ph));
    return { autumn, bare, fresh };
  };

  // ═══ Климаты мест (игра даёт climateAt(x, z)): температура (средняя, размах по году, по суткам), осадки, снег, туман,
  //     ветер (м/с), грозы, зной, влажность ═══
  C.CLIMATES = {
    temperate: { name: 'умеренный', t: 8, amp: 16, dayA: 5, wet: 1, snowy: 1, fog: 1, wind: [2, 6], thunder: 1, heat: .35, cloud: .7, rh: 65 },
    steppe: { name: 'степь', t: 7, amp: 21, dayA: 7, wet: .6, snowy: .85, fog: .5, wind: [4, 9], thunder: .8, heat: 1, cloud: .5, rh: 45 },
    mountain: { name: 'горы', t: -1, amp: 13, dayA: 6, wet: 1.3, snowy: 1.4, fog: 1.3, wind: [5, 12], thunder: .9, heat: 0, cloud: .8, rh: 60 },
    desert: { name: 'пустыня', t: 20, amp: 13, dayA: 9, wet: .15, snowy: .2, fog: .15, wind: [3, 8], thunder: .3, heat: 1.6, cloud: .25, rh: 25 },
    sea: { name: 'море', t: 11, amp: 8, dayA: 2.5, wet: 1.1, snowy: .7, fog: 2, wind: [6, 12], thunder: .9, heat: .3, cloud: .8, rh: 80 },
    snow: { name: 'снега', t: -11, amp: 9, dayA: 4, wet: .9, snowy: 1.5, fog: .9, wind: [4, 10], thunder: .1, heat: 0, cloud: .7, rh: 70 },
    tropic: { name: 'тропики', t: 26, amp: 3, dayA: 5, wet: 1.6, snowy: 0, fog: .8, wind: [2, 7], thunder: 1.5, heat: .8, cloud: .75, rh: 85 },
  };
  const clim = k => C.CLIMATES[k] || C.CLIMATES.temperate;
  // Температура сезона: пик — середина лета (φ = 1,5), минимум — середина зимы (φ = 3,5)
  C.seasonTemp = (ph, c = 'temperate') => { const k = typeof c === 'string' ? clim(c) : c; return k.t + k.amp * Math.cos(PI2 * (ph - 1.5) / 4); };

  // ═══ Хеши и шум (целые — одинаково во всех браузерах) ═══
  const imul = Math.imul;
  const h32 = (a, b, c) => {   // три целых → 32 бита
    let h = (imul(a | 0, 0x27d4eb2d) ^ imul(b | 0, 0x165667b1) ^ imul(c | 0, 0x9e3779b1)) >>> 0;
    h = imul(h ^ (h >>> 15), 0x85ebca6b); h = imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const u01 = (a, b, c) => h32(a, b, c) / 4294967296;
  C.seedOf = s => {
    if (typeof s === 'number' && Number.isFinite(s)) return s | 0;
    let h = 0x811c9dc5; const str = String(s ?? '');
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = imul(h, 0x01000193); }
    return h | 0;
  };
  // плавный шум по одной оси (значения в целых точках, косинусная смесь): 0…1
  const noise1 = (seed, salt, x) => { const i = Math.floor(x), f = x - i, a = u01(seed, i, salt), b = u01(seed, i + 1, salt), k = (1 - Math.cos(f * Math.PI)) / 2; return a + (b - a) * k; };
  C._h = { h32, u01, noise1 };   // + slotEvent, KIND_SEASON (ниже) — целый двойник ленты в wx.js сверяется с ними (scripts/wx-test.cjs)

  // ═══ Погода: события по частям «погодных часов» ═══
  // w — погодные часы: в общем мире (calendar) 1 ч = 7,5 реальных минут; по игровым дням (cycle) — игровые часы.
  // Часть — 6 w-ч (45 мин в общем мире); в части — одно событие или ничего: осадки, гроза, туман, зной или только облака.
  // Вероятность и вид — от сезона и климата; начало 0…3 w-ч от начала части, длина 1,5…4,5, края по 0,5 (плавно).
  const SLOT = 6, RAMP = .6;
  C.W_MIN = 7.5;   // реальных минут в погодном часе общего мира
  const KIND_SEASON = {   // множители вида по сезону: осадки, гроза, туман, зной
    spring: [1.1, .25, .3, .1], summer: [.8, .6, .1, .7], autumn: [1.2, .08, .5, .1], winter: [1, 0, .3, 0],
  };
  const P_EVENT = .5;   // доля частей с событием (дальше вид может быть «только облака»)
  function slotEvent(seed, j, c, season, out){
    out.kind = ''; out.a = 0; out.e = 0; out.I = 0;
    if (u01(seed, j, 11) >= P_EVENT) return out;
    const ks = KIND_SEASON[season] || KIND_SEASON.summer;
    const wP = c.wet * ks[0], wT = c.thunder * ks[1], wF = c.fog * ks[2] * .7, wH = c.heat * ks[3], wN = .45;
    let u = u01(seed, j, 12) * (wP + wT + wF + wH + wN);
    out.kind = (u -= wP) < 0 ? 'precip' : (u -= wT) < 0 ? 'thunder' : (u -= wF) < 0 ? 'fog' : (u -= wH) < 0 ? 'heat' : 'cloud';
    out.a = j * SLOT + u01(seed, j, 13) * 3;
    out.e = out.a + 1.5 + u01(seed, j, 14) * 3;
    out.I = .5 + .5 * u01(seed, j, 15);
    out.hail = u01(seed, j, 16);
    return out;
  }
  const _ev = { kind: '', a: 0, e: 0, I: 0, hail: 0 };
  C._h.slotEvent = slotEvent; C._h.KIND_SEASON = KIND_SEASON;
  // Части погоды в момент w (без температуры): осадки, гроза, туман, зной, облака
  function mix(seed, w, c, seasonAt, o){
    o.precip = 0; o.thunder = 0; o.fog = 0; o.heat = 0; o.cloud = 0; o.hail = 0;
    const j0 = Math.floor(w / SLOT);
    for (let j = j0 - 1; j <= j0 + 1; j++) {   // событие прошлой части заходит в эту, тучи следующей собираются заранее
      const ev = slotEvent(seed, j, c, seasonAt(j * SLOT + SLOT / 2), _ev);
      if (!ev.kind) continue;
      // тучи собираются за 1 w-ч до осадков и расходятся через 1 w-ч после (небо темнеет заранее, без скачка)
      if (ev.kind === 'precip' || ev.kind === 'thunder') { const rc = Math.min(w - ev.a + 1, ev.e + 1 - w) / 1.3; if (rc > 0) o.cloud = Math.max(o.cloud, sm(0, 1, Math.min(1, rc)) * (.62 + .38 * ev.I)); }
      const r = Math.min(w - ev.a, ev.e - w) / RAMP;
      if (r <= 0) continue;
      const k = sm(0, 1, Math.min(1, r)) * ev.I;
      if (ev.kind === 'precip') o.precip = Math.max(o.precip, k);
      else if (ev.kind === 'thunder') { o.thunder = Math.max(o.thunder, k); if (ev.hail < .3) o.hail = Math.max(o.hail, k); }
      else if (ev.kind === 'fog') o.fog = Math.max(o.fog, k);
      else if (ev.kind === 'heat') o.heat = Math.max(o.heat, k);
      else o.cloud = Math.max(o.cloud, .9 * k);
    }
    // фон облаков — плавный шум (период ~5 w-ч), у сухих климатов меньше
    const bg = cl(noise1(seed, 21, w / 5) * 1.25 - .25, 0, 1) * c.cloud;
    o.cloud = Math.max(o.cloud, bg, o.fog * .7);
    if (o.heat > 0) o.cloud *= 1 - .8 * o.heat;
    return o;
  }

  // Состояния (для скриптов, телефона, подписей) — по силе частей
  C.STATES = ['clear', 'cloudy', 'overcast', 'rain', 'thunderstorm', 'snow', 'blizzard', 'fog', 'heat'];
  C.STATE_NAMES = { clear: 'ясно', cloudy: 'облачно', overcast: 'пасмурно', rain: 'дождь', thunderstorm: 'гроза', snow: 'снег', blizzard: 'метель', fog: 'туман', heat: 'зной' };
  C.STATE_ICONS = { clear: '☀️', cloudy: '⛅', overcast: '☁️', rain: '🌧', thunderstorm: '⛈', snow: '🌨', blizzard: '❄️', fog: '🌫', heat: '🔥' };
  // Особая погода по биому (T-135, BIOME_WEATHER.md v2, js/engine/wx.js): её состояния (песчаная буря, буран…) дописывает в конец
  // C.STATES сам wx.js — только в играх, где он есть (на страницах сайта и в «Студии 3D» без него список прежний); видны только
  // в s.stateX (C.labelX), s.state и C.label — как были
  C.SPECIAL = true;   // откат одной строкой: false — погода как до T-135 (особой погоды нет, wx.js не зовётся)
  C.labelX = s => (s ? s.state : 'clear');   // wx.js заменяет: состояние с особой погодой
  C.label = s => s.thunder > .35 ? 'thunderstorm' : s.snow > .5 && s.wind > 10 ? 'blizzard' : s.snow > .08 ? 'snow' : s.rain > .08 ? 'rain'
    : s.fog > .5 ? 'fog' : s.heat > .5 ? 'heat' : s.cloud > .72 ? 'overcast' : s.cloud > .38 ? 'cloudy' : 'clear';
  // погода «одна всегда» (настройка мира): части
  const FIXED = {
    clear: { cloud: .05 }, cloudy: { cloud: .5 }, overcast: { cloud: .9 }, rain: { cloud: .95, precip: .75, rainOnly: 1 },
    thunderstorm: { cloud: 1, thunder: .9, rainOnly: 1 }, snow: { cloud: .92, precip: .7, snowOnly: 1 }, blizzard: { cloud: 1, precip: 1, snowOnly: 1, wind: 8 },
    fog: { cloud: .6, fog: .9 }, heat: { cloud: .02, heat: .9 },
    // особая погода «одна всегда» (Студия, настройка мира): основа ленты + сама особая погода (wx.js FIXED_SP)
    sandstorm: { cloud: .3 }, duststorm: { cloud: .4 }, buran: { cloud: 1, precip: 1, snowOnly: 1, wind: 8 }, whiteout: { cloud: .95, precip: .3, snowOnly: 1 },
    hail: { cloud: 1, thunder: .9, rainOnly: 1 }, downpour: { cloud: 1, precip: 1, rainOnly: 1 }, freezing_rain: { cloud: .95, precip: .8, rainOnly: 1 }, seafog: { cloud: .6, fog: 1 },
  };

  // ═══ Мир погоды ═══
  // o: seed, mode ('calendar' | 'cycle' | 'fixed' | 'off'), days (игровых суток на сезон, cycle), season (fixed), weather ('auto' |
  // состояние), climateAt(x, z) → климат, lapse (°C на единицу высоты над seaY), seaY, front (единиц за w-ч: фронт идёт с запада на
  // восток; 0 — везде одновременно), hourAt(мс) → время суток игры (calendar), gameTime() → { day, hour } (cycle), storm (false —
  // без гроз: детский городок), zone (минут к востоку от UTC для календаря; по умолчанию МСК),
  // placeAt(x, z) → { t, amp, ph } | null — свой климат места (T-145, WORLD_RULES §1: температура — от места + сезон): t — средняя за
  // год (°C, на уровне моря / земли места), amp — полуразмах по году (°C), ph — сдвиг сезона в четвертях года (2 — южное полушарие:
  // там зима, когда у нас лето; в mode fixed / off не сдвигается). Нет placeAt (или null) — как раньше: t и amp — у класса климата.
  // Значения — постоянные в своей клетке (игра квантует сама): по ним же считает особая погода (wx.js, целые)
  C.MODES = ['calendar', 'cycle', 'fixed', 'off'];
  C.sanitize = (d = {}) => {   // настройки мира из файла / сети: только известное, в пределах
    d = d && typeof d === 'object' ? d : {};
    return {
      mode: C.MODES.includes(d.mode) ? d.mode : 'calendar',
      days: cl(Math.round(num(d.days, 3)), 1, 60),
      season: C.SEASONS.includes(d.season) ? d.season : 'winter',
      weather: d.weather === 'auto' || C.STATES.includes(d.weather) ? d.weather : 'auto',
      climate: C.CLIMATES[d.climate] ? d.climate : 'temperate',
      seed: typeof d.seed === 'string' || typeof d.seed === 'number' ? String(d.seed).slice(0, 40) : '',
    };
  };
  C.world = (o = {}) => {
    const W = {
      seed: C.seedOf(o.seed ?? 'world'), mode: C.MODES.includes(o.mode) ? o.mode : 'calendar', days: cl(num(o.days, 3), .25, 60),
      season: C.SEASONS.includes(o.season) ? o.season : 'winter', weather: o.weather === 'auto' || C.STATES.includes(o.weather) ? o.weather || 'auto' : 'auto',
      climateAt: typeof o.climateAt === 'function' ? o.climateAt : () => o.climate || 'temperate',
      lapse: num(o.lapse, -.12), seaY: num(o.seaY, 0), front: num(o.front, 4000), zone: num(o.zone, C.ZONE), storm: o.storm !== false,
      hourAt: typeof o.hourAt === 'function' ? o.hourAt : null, gameTime: typeof o.gameTime === 'function' ? o.gameTime : null,
      placeAt: typeof o.placeAt === 'function' ? o.placeAt : null,
      // особая погода (wx.js): запись места (класс климата, поверхности, приметы, детский городок), биом, мир детей/взрослых, «Стихии»
      wxRegionAt: typeof o.wxRegionAt === 'function' ? o.wxRegionAt : null, biomeAt: typeof o.biomeAt === 'function' ? o.biomeAt : null,
      realm: o.realm === 'adult' ? 'adult' : 'kids', elements: ['rare', 'real', 'off'].includes(o.elements) ? o.elements : 'rare', rules: o.rules === 'absurd' ? 'absurd' : 'earth',
    };
    // часы погоды и время суток
    W.wNow = ms => W.mode === 'cycle' && W.gameTime ? (() => { const g = W.gameTime() || {}; return num(g.day, 1) * 24 + num(g.hour, 12); })() : ms / (C.W_MIN * 60000);
    W.hourAtW = (w, ms) => {
      if (W.mode === 'cycle') return ((w % 24) + 24) % 24;
      if (W.hourAt) { const h = W.hourAt(ms); if (Number.isFinite(h)) return ((h % 24) + 24) % 24; }
      return parts(ms, W.zone).h;
    };
    // фаза года в момент (w, ms)
    W.phaseAt = (w, ms) => W.mode === 'calendar' ? C.phaseCal(ms, W.zone) : W.mode === 'cycle' ? (((w / 24) / W.days) % 4 + 4) % 4
      : W.mode === 'fixed' ? C.SEASONS.indexOf(W.season) + .5 : 1.5;
    W.set = p => { if (p && typeof p === 'object') for (const k of ['mode', 'days', 'season', 'weather', 'storm', 'elements', 'realm']) if (p[k] !== undefined) W[k] = k === 'days' ? cl(num(p[k], 3), .25, 60) : p[k]; if (p?.seed !== undefined) W.seed = C.seedOf(p.seed); cache.clear(); return W; };
    const cache = new Map();
    const tmp = { precip: 0, thunder: 0, fog: 0, heat: 0, cloud: 0, hail: 0 };
    // место: сдвиг сезона (четверти года) — только в calendar / cycle; температура сезона места (пик — середина лета)
    const shiftOf = PL => (W.mode === 'calendar' || W.mode === 'cycle') && PL.ph ? ((+PL.ph % 4) + 4) % 4 : 0;
    const placeTemp = (PL, ph) => PL.t + PL.amp * Math.cos(PI2 * (ph - 1.5) / 4);
    // погода и температура в момент w (ms — тот же момент в реальном времени) в точке
    function sample(x, z, y, w, ms, cKey, o){
      const c = clim(cKey), wl = W.front ? w - x / W.front : w;
      // свой климат места (placeAt): средняя, размах, сдвиг сезона (южное полушарие); нет — у класса климата, как раньше
      const PL = W.placeAt ? W.placeAt(x, z) : null, sh = PL ? shiftOf(PL) : 0;
      const ph = sh ? (W.phaseAt(wl, ms) + sh) % 4 : W.phaseAt(wl, ms), season = C.seasonOf(ph), hour = W.hourAtW(wl, ms);
      const seasonAt = W.mode === 'calendar' ? ww => C.seasonOf(C.phaseCal(ms + (ww - wl) * C.W_MIN * 60000, W.zone) + sh) : ww => C.seasonOf(W.phaseAt(ww, ms) + sh);
      if (W.weather !== 'auto') { const f = FIXED[W.weather] || FIXED.clear; tmp.precip = f.precip || 0; tmp.thunder = f.thunder || 0; tmp.fog = f.fog || 0; tmp.heat = f.heat || 0; tmp.cloud = f.cloud || 0; tmp.hail = 0; }
      else mix(W.seed, wl, c, seasonAt, tmp);   // одна лента событий на мир: фронт везде тот же, климат решает, во что он выльется
      // особая погода по биому (wx.js): в своём окне поднимает части ленты под себя; вне окон — null, и всё ниже — как было
      const sp = C.SPECIAL && E.wx ? E.wx.apply(W, x, z, w, ms, cKey, tmp) : null;
      if (!W.storm) { tmp.precip = Math.max(tmp.precip, tmp.thunder * .8); tmp.thunder = 0; tmp.hail = 0; }
      const sun = sm(6, 9, hour) * (1 - sm(18, 21, hour));   // день (0 — ночь)
      // температура: сезон + сутки (облака сглаживают) + высота + медленный шум
      const T0 = (PL ? placeTemp(PL, ph) : C.seasonTemp(ph, c)) + c.dayA * Math.cos(PI2 * (hour - 15) / 24) * (1 - .55 * tmp.cloud) + W.lapse * Math.max(0, y - W.seaY) + (noise1(W.seed, 31, w / 12) - .5) * 4 + (sp ? sp.tAdd : 0);
      let snowF = 1 - sm(.5, 2.5, T0);
      const fx = W.weather !== 'auto' ? FIXED[W.weather] : null;
      if (fx?.snowOnly || sp?.snowOnly) snowF = 1; else if (fx?.rainOnly || sp?.rainOnly) snowF = 0;
      const warmStorm = fx ? 1 : sm(4, 12, T0);
      const thunder = tmp.thunder * warmStorm, precip = Math.max(tmp.precip, tmp.thunder * (1 - warmStorm));
      o.rain = cl(precip * (1 - snowF) + thunder, 0, 1);
      o.snow = cl(precip * snowF, 0, 1);
      o.thunder = thunder; o.hail = tmp.hail * warmStorm * sm(6, 10, T0) * (1 - sm(26, 32, T0));
      if (sp && sp.hail >= 0) o.hail = sp.hail;   // град особой погоды — свой (класс по силе), без него — нет
      o.fog = cl(tmp.fog * (1 - .6 * sun * (1 - tmp.cloud)), 0, 1);
      o.heat = cl(tmp.heat * sun * sm(22, 28, T0 + 6 * tmp.heat), 0, 1);
      o.cloud = tmp.cloud;
      let T = T0 - 3 * o.rain - 2 * thunder + 6 * o.heat;
      if (o.snow > .02) T = Math.min(T, 1);
      if (fx?.snowOnly) T = Math.min(T, -2); else if (fx?.rainOnly) T = Math.max(T, 3);
      if (sp) T = E.wx.clampT(sp, T);   // буран ≤ −2°, ледяной дождь −3…−0,5°, мокрый снег +0,5…+2°
      o.temp = T; o.T0 = T0; o.phase = ph; o.season = season; o.hour = hour; o.sun = sun;
      // ветер: климат + погода; направление медленно поворачивается; порывы (для картинки)
      const wn = noise1(W.seed, 41, w / 3);
      o.wind = lerp(c.wind[0], c.wind[1], wn) + 3 * precip + 6 * thunder + (o.snow > .55 ? 5 * (o.snow - .55) / .45 * (c === C.CLIMATES.mountain || c === C.CLIMATES.snow || c === C.CLIMATES.steppe ? 1.6 : 1) : 0) + (fx?.wind || 0);
      o.windDir = (noise1(W.seed, 43, w / 20) * PI2 * 2) % PI2;   // куда дует (радианы, по миру), медленно поворачивается
      o.gust = noise1(W.seed, 47, w * 8);
      o.humid = cl(c.rh + 30 * o.rain + 25 * o.fog + 20 * o.snow - 15 * o.heat, 10, 100);
      if (C.SPECIAL && E.wx) E.wx.post(sp, o);   // ветер и направление особой погоды, новые поля (special, sp, vis, dust, tint, hailSize…)
      return o;
    }
    const prev = {};
    // Накопители по прошлому этой точки: мокро, лужи, снег на земле, лёд на воде (30 w-ч назад, шаг 0,5 w-ч)
    function accum(x, z, y, w, ms, cKey){
      const PL = W.placeAt ? W.placeAt(x, z) : null, sh = PL ? shiftOf(PL) : 0;
      const c = clim(cKey), key = cKey + '|' + Math.round(y / 8) + '|' + (W.front ? Math.round(x / 500) : 0) + '|' + Math.floor(w * 4) + '|' + W.weather + W.mode + (C.SPECIAL && E.wx ? '|wx' + Math.round(x / 128) + ',' + Math.round(z / 128) : '')
        + (PL ? '|p' + PL.t + ',' + PL.amp + ',' + sh : '');
      const hit = cache.get(key); if (hit) return hit;
      if (cache.size > 64) cache.clear();
      const N = 60, dt = .5, msPerW = W.mode === 'calendar' ? C.W_MIN * 60000 : 0;
      // начало окна — «как обычно в это время года» (зимой снег лежит, озёра во льду)
      const w0 = w - N * dt, ms0 = ms - N * dt * msPerW, ph0 = (W.phaseAt(W.front ? w0 - x / W.front : w0, ms0) + sh) % 4, Tm = (PL ? placeTemp(PL, ph0) : C.seasonTemp(ph0, c)) + W.lapse * Math.max(0, y - W.seaY);
      let glaze = 0, drift = 0, wet = 0, puddle = 0, snowC = W.weather === 'auto' ? cl((-Tm - 1) / 6, 0, 1) * Math.min(1, c.snowy) : 0, ice = W.weather === 'auto' ? cl((-Tm - 3) / 5, 0, 1) : 0;
      for (let i = N - 1; i >= 0; i--) {
        const s = sample(x, z, y, w - i * dt, ms - i * dt * msPerW, cKey, prev), T = s.temp;
        // мокро: дождь — быстро, сохнет (теплее, ветрено, солнце — быстрее); в мороз не сохнет, а «замерзает»
        if (s.rain > .05) wet = Math.min(1, wet + s.rain * 2.5 * dt);
        else if (T > 0) wet = Math.max(0, wet - (.25 + .012 * T + .015 * s.wind) * (1 - .4 * s.cloud) * dt);   // ~2 w-ч
        else wet = Math.max(0, wet - .15 * dt);
        if (s.rain > .25) puddle = Math.min(1, puddle + (s.rain - .2) * 1.1 * dt);
        else puddle = Math.max(0, puddle - (T > 0 ? .12 + .008 * T : .1) * dt);   // лужи сохнут дольше (~4 w-ч)
        // снег: растёт в снегопад (полный — ~2,5 w-ч), тает от +0,5° (тёплый дождь — быстро)
        if (s.snow > .03) snowC = Math.min(1, snowC + s.snow * .42 * dt);
        if (T > .5) snowC = Math.max(0, snowC - ((.06 + .045 * T) * (1 + .4 * s.sun * (1 - s.cloud)) + .5 * s.rain) * dt);
        // лёд: ниже −2° намерзает (~4 w-ч), от +1° тает
        if (T < -2) ice = Math.min(1, ice + .24 * cl(-T / 5, .5, 2) * dt);
        else if (T > 1) ice = Math.max(0, ice - (.3 + .05 * T) * dt);
        if (s.sp !== undefined) {   // особая погода: наледь (мм; ледяной дождь — 2 мм за минуту ядра, тает от +1°), намёты песка и снега (за ~8 w-ч оседают)
          if (s.freezing > 0) glaze = Math.min(25, glaze + s.freezing * 7.5 * dt * 2); else if (T > 1) glaze = Math.max(0, glaze - (1.5 + .5 * T) * dt * 2);
          if (s.dust > 0) drift = Math.min(1, drift + s.dust * .5 * dt); else drift = Math.max(0, drift - .0625 * dt * 2);
        }
      }
      const r = { wet, puddle, snowC, ice, glaze, drift };
      cache.set(key, r);
      return r;
    }
    // Погода в точке (x, z) на высоте y в момент ms (реальное время; для cycle — игровое из gameTime)
    W.at = (x = 0, z = 0, ms = Date.now(), y) => {
      x = num(x, 0); z = num(z, 0); y = num(y, W.seaY);
      if (W._sp !== C.SPECIAL) { W._sp = C.SPECIAL; cache.clear(); }   // включили/выключили особую погоду — накопители заново
      const ck = W.climateAt(x, z), cKey = C.CLIMATES[ck] ? ck : 'temperate';
      if (W.mode === 'off') return Object.assign(blank(), { climate: cKey, mode: 'off' });
      const w = W.wNow(ms), s = sample(x, z, y, w, ms, cKey, {});
      const A = accum(x, z, y, w, ms, cKey), L = C.leafOf(s.phase);
      s.wet = A.wet; s.puddle = A.puddle; s.snowCover = A.snowC; s.ice = A.ice;
      s.autumn = L.autumn; s.bare = L.bare; s.fresh = L.fresh;
      s.climate = cKey; s.mode = W.mode; s.w = w;
      s.feels = C.feels(s.temp, s.wind, s.humid);
      s.state = C.label(s);
      if (s.sp !== undefined) { s.stateX = C.labelX(s); s.glaze = A.glaze; s.drift = A.drift; }
      s.progress = s.phase - Math.floor(s.phase);
      delete s.T0;
      return s;
    };
    W.iceAt = (x, z, ms, y) => W.at(x, z, ms, y).ice;
    return W;
  };
  function blank(){
    return { season: 'summer', phase: 1.5, progress: .5, state: 'clear', temp: 20, feels: 20, cloud: .1, rain: 0, snow: 0, hail: 0, thunder: 0, fog: 0, heat: 0,
      wind: 2, windDir: 0, gust: .5, humid: 55, wet: 0, puddle: 0, snowCover: 0, ice: 0, autumn: 0, bare: 0, fresh: 0, hour: 12, sun: 1, w: 0 };
  }
  C.blank = blank;
  // «Ощущается»: ветро-холодовой индекс (Канада) и кажущаяся температура (BoM, Австралия); между ними — плавно
  C.feels = (T, ws, rh = 60) => {
    const v = Math.max(0, ws) * 3.6, cold = v >= 4.8 ? 13.12 + .6215 * T - 11.37 * Math.pow(v, .16) + .3965 * T * Math.pow(v, .16) : T;
    const e = rh / 100 * 6.105 * Math.exp(17.27 * T / (237.7 + T)), warm = T + .33 * e - .7 * ws - 4;
    const k = sm(10, 26, T);
    return Math.round(((1 - k) * Math.min(T, cold) + k * warm) * 10) / 10;
  };
  // Для персонажей (как в Симс — после 21.10): насколько холодно, жарко, мокро 0…1
  // o: clothes 0…1 (куртка ~ .5), inside (под крышей/в доме), umbrella, near: 'fire', moving, shade
  C.exposure = (s, o = {}) => {
    s = s || blank();
    const clothes = cl(num(o.clothes, 0), 0, 1), inside = !!o.inside;
    let cold = inside ? 0 : cl((8 - s.feels) / 28 - clothes * .5, 0, 1);
    if (o.near === 'fire') cold *= .3;
    if (o.moving) cold *= .85;
    const heat = inside ? 0 : cl((s.feels - 28) / 12 - (o.shade ? .3 : 0) - clothes * -.2, 0, 1);
    const wet = inside || o.umbrella ? 0 : cl(s.rain * .9 + s.snow * .4 + (s.hail || 0) * .5, 0, 1);
    return { cold, heat, wet };
  };

  // ═══ Праздники (данные; по МЕСТНОМУ времени игрока). Торжественные — только поздравление, без салюта ═══
  // fixed: [месяц, день] | dates: { год: 'ММ-ДД' } | rule(год) → 'ММ-ДД'; days — сколько суток; countdown — секунд отсчёта
  // перед началом; burst — минут салюта после начала; fireworks: big | small | none; style — вид праздника (celebrate.js);
  // decor — крючки украшений (модели — потом)
  const ANIMALS = [['Крысы', '🐀'], ['Быка', '🐂'], ['Тигра', '🐅'], ['Кролика', '🐇'], ['Дракона', '🐉'], ['Змеи', '🐍'], ['Лошади', '🐎'], ['Козы', '🐐'], ['Обезьяны', '🐒'], ['Петуха', '🐓'], ['Собаки', '🐕'], ['Свиньи', '🐖']];
  C.animalOf = y => ANIMALS[(((y - 2020) % 12) + 12) % 12];
  C.HOLIDAYS = [
    { id: 'newyear', name: 'Новый год', icon: '🎆', greet: '🎆 С Новым годом!', sub: 'Счастья, удачи и побольше побед в новом году!', fixed: [1, 1], days: 2, countdown: 10, burst: 3, fireworks: 'big', style: 'fireworks', decor: ['tree', 'garland', 'snowman', 'gifts'] },
    { id: 'oldnewyear', name: 'Старый Новый год', icon: '🎄', greet: '🎄 Со Старым Новым годом!', sub: 'Ещё один повод загадать желание.', fixed: [1, 14], days: 1, burst: 1, fireworks: 'small', style: 'light', decor: ['tree', 'garland'] },
    { id: 'lunar', name: 'Лунный Новый год', icon: '🏮', greet: '🏮 С Лунным Новым годом!', sub: '新年快乐 · 새해 복 많이 받으세요 · Chúc mừng năm mới', days: 2, burst: 3, fireworks: 'big', style: 'lanterns', animal: true, decor: ['lanterns', 'red-gold'],
      dates: { 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03', 2031: '01-23', 2032: '02-11', 2033: '01-31', 2034: '02-19', 2035: '02-08', 2036: '01-28', 2037: '02-15', 2038: '02-04', 2039: '01-24', 2040: '02-12' } },
    { id: 'nauryz', name: 'Наурыз', icon: '🌷', greet: '🌷 Наурыз құтты болсын!', sub: 'С праздником весны и обновления! Ұлыстың ұлы күні құтты болсын!', fixed: [3, 21], days: 3, burst: 2, fireworks: 'small', style: 'spring', decor: ['yurt', 'kozhe', 'flowers', 'altybakan'] },
    { id: 'songkran', name: 'Сонгкран', icon: '💦', greet: '💦 Счастливого Сонгкрана!', sub: 'Тайский Новый год — праздник воды.', fixed: [4, 13], days: 3, fireworks: 'none', style: 'water', decor: ['water'] },
    { id: 'roshhashana', name: 'Рош ха-Шана', icon: '🍎', greet: '🍎 Шана това!', sub: 'С Новым годом по еврейскому календарю.', days: 2, fireworks: 'none', style: 'calm',
      dates: { 2026: '09-12', 2027: '10-02', 2028: '09-21', 2029: '09-10', 2030: '09-28', 2031: '09-18', 2032: '09-06', 2033: '09-24', 2034: '09-14', 2035: '10-04', 2036: '09-22', 2037: '09-10', 2038: '09-30', 2039: '09-19', 2040: '09-08' } },
    { id: 'hijri', name: 'Новый год по хиджре', icon: '🌙', greet: '🌙 С Новым годом по хиджре!', sub: '1 мухаррама — начало нового года исламского календаря.', days: 1, fireworks: 'none', style: 'calm',
      dates: { 2026: '06-16', 2027: '06-06', 2028: '05-25', 2029: '05-14', 2030: '05-04', 2031: '04-23', 2032: '04-11', 2033: '04-01', 2034: '03-21', 2035: '03-11', 2036: '02-28', 2037: '02-16', 2038: '02-05', 2039: '01-25', 2040: '01-15' } },
    { id: 'enkutatash', name: 'Энкутаташ', icon: '🌼', greet: '🌼 Мелькам Аддис Амет!', sub: 'С Новым годом по эфиопскому календарю!', rule: y => (y + 1) % 4 === 0 ? '09-12' : '09-11', days: 1, fireworks: 'none', style: 'flowers', decor: ['adey-abeba'] },
    { id: 'pumpkin', name: 'Тыквенная ночь', icon: '🎃', greet: '🎃 Тыквенная ночь!', sub: 'Тыквы светятся, а в мирах — весёлые тыквоголовые.', fixed: [10, 31], days: 1, burst: 1, fireworks: 'small', style: 'pumpkin', decor: ['pumpkins'] },
  ];
  // дата праздника в году y → [месяц, день] или null (нет в таблице)
  C.holidayDate = (h, y) => {
    if (h.fixed) return h.fixed;
    const s = h.rule ? h.rule(y) : h.dates ? h.dates[y] : null;
    if (!s) return null;
    const m = /^(\d\d)-(\d\d)$/.exec(s); return m ? [+m[1], +m[2]] : null;
  };
  // Праздники сейчас: [{ id, h, phase: 'pre' | 'burst' | 'day', start, end, left (с до начала — у pre), year, name, greet, sub }]
  C.holidays = (ms = Date.now(), o = {}) => {
    const tz = num(o.tz, C.localTz(ms)), p = parts(ms, tz), out = [];
    for (const h of o.list || C.HOLIDAYS) for (const y of [p.y - 1, p.y, p.y + 1]) {
      const dd = C.holidayDate(h, y); if (!dd) continue;
      const start = midnight(y, dd[0], dd[1], tz), end = start + (h.days || 1) * DAY, pre = (h.countdown || 0) * 1000;
      if (ms < start - pre || ms >= end) continue;
      const phase = ms < start ? 'pre' : ms < start + (h.burst || 0) * 60000 ? 'burst' : 'day';
      const r = { id: h.id, h, phase, start, end, year: y, name: h.name, icon: h.icon, greet: h.greet, sub: h.sub, style: h.style, fireworks: h.fireworks || 'none' };
      if (phase === 'pre') r.left = (start - ms) / 1000;
      if (h.animal) { const a = C.animalOf(y); r.sub = `Год ${a[0]} ${a[1]} · ${h.sub}`; }
      if (h.id === 'newyear') r.newYear = y;
      out.push(r);
    }
    return out;
  };
  // Ближайший праздник впереди (для «до Нового года …»): { id, start, h }
  C.nextHoliday = (ms = Date.now(), o = {}) => {
    const tz = num(o.tz, C.localTz(ms)), p = parts(ms, tz);
    let best = null;
    for (const h of o.list || C.HOLIDAYS) {
      if (o.id && h.id !== o.id) continue;
      for (const y of [p.y, p.y + 1]) {
        const dd = C.holidayDate(h, y); if (!dd) continue;
        const start = midnight(y, dd[0], dd[1], tz);
        if (start > ms && (!best || start < best.start)) best = { id: h.id, h, start, year: y };
      }
    }
    return best;
  };
  // Новогоднее задание (адвент-календарь): 1–31 декабря по местному времени → { day 1…31, year, left (с до Нового года) } | null
  C.advent = (ms = Date.now(), o = {}) => {
    const tz = num(o.tz, C.localTz(ms)), p = parts(ms, tz);
    if (p.m !== 12) return null;
    const ny = midnight(p.y + 1, 1, 1, tz);
    return { day: p.d, year: p.y, left: (ny - ms) / 1000, newYear: p.y + 1, end: ny };
  };
  // Календарь общего мира + праздники игрока
  C.calendar = (ms = Date.now(), o = {}) => {
    const tz = num(o.tz, C.localTz(ms)), ph = C.phaseCal(ms, num(o.zone, C.ZONE)), season = C.seasonOf(ph), p = parts(ms, tz);
    const fast = p.m >= 3 && p.m <= 10;   // месяцы, где сезоны сменяются; ноябрь — закреплённая осень, декабрь–февраль — зима
    return { season, phase: ph, progress: ph - Math.floor(ph), name: C.SEASON_NAMES[season], icon: C.SEASON_ICONS[season], fast,
      year: p.y, month: p.m, day: p.d, hour: p.h, tz, holidays: C.holidays(ms, { tz }), next: C.nextHoliday(ms, { tz }), advent: C.advent(ms, { tz }) };
  };

  // ═══ «Текущий» мир (attach делает C.use) и события ═══
  let cur = null;
  C.use = W => { cur = W || null; return cur; };
  C.current = () => cur;
  C.at = (x, z, ms, y) => (cur || (cur = C.world({ seed: 'world' }))).at(x, z, ms, y);
  const subs = { holiday: new Set(), season: new Set(), weather: new Set() };
  C.on = (ev, f) => { if (!subs[ev] || typeof f !== 'function') return () => {}; subs[ev].add(f); return () => subs[ev].delete(f); };
  C.emit = (ev, d) => { for (const f of subs[ev] ? [...subs[ev]] : []) { try { f(d); } catch (e) { try { console.warn('климат, событие ' + ev, e); } catch (e2) {} } } };
  // Проверить смену: праздник (фаза у каждого) и сезон общего мира. Зовут celebrate.js (раз в секунду) и attach
  const seenH = new Map();
  let seenSeason = '';
  C.tick = (ms = Date.now(), o = {}) => {
    const L = C.holidays(ms, o), now = new Set();
    for (const r of L) {
      const k = r.id + ':' + r.year; now.add(k);
      if (seenH.get(k) !== r.phase) { seenH.set(k, r.phase); C.emit('holiday', r); }
    }
    for (const k of [...seenH.keys()]) if (!now.has(k)) { seenH.delete(k); const [id, y] = k.split(':'); C.emit('holiday', { id, year: +y, phase: 'end' }); }
    const s = C.seasonOf(C.phaseCal(ms));
    if (s !== seenSeason) { const was = seenSeason; seenSeason = s; if (was) C.emit('season', { season: s, prev: was }); }
    return L;
  };
  C._reset = () => { seenH.clear(); seenSeason = ''; cur = null; for (const k in subs) subs[k].clear(); };
})();
