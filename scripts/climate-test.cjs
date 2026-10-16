// Проверка погоды, времён года и праздников движка (js/engine/climate.js) без браузера: node scripts/climate-test.cjs
// Календарь владельца (ноябрь — осень, декабрь–январь — зима, февраль–октябрь — 38 быстрых сезонов, фаза непрерывна), праздники
// (местная полночь, отсчёт, таблицы 2026–2040, Наурыз, Энкутаташ в високосные), новогоднее задание, детерминизм погоды,
// температура в пределах, накопители (снег, лёд, мокро), режимы мира, «ощущается», холод для персонажей, события.
const path = require('path');
const SITE = path.join(__dirname, '..');
globalThis.window = undefined;
require(path.join(SITE, 'js/engine/climate.js'));
const C = globalThis.D37E.climate;
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const sec = t => console.log('— ' + t);
const H = 3600000, D = 86400000, MSK = 180;
const mskMs = (y, m, d, h = 0) => Date.UTC(y, m - 1, d, h) - MSK * 60000;

// ═══ 1. Календарь владельца ═══
sec('календарь: ноябрь — осень, декабрь–январь — зима, февраль–октябрь — 38 быстрых сезонов');
{
  let badNov = 0, badWin = 0, jumps = 0, maxStep = 0, years = 0;
  for (let y = 2026; y <= 2040; y++) {
    years++;
    let prev = null, changes = 0, first = '', last = '', lens = [], segStart = mskMs(y, 2, 1);
    for (let t = mskMs(y, 1, 1); t < mskMs(y + 1, 1, 1); t += 3 * H) {
      const ph = C.phaseCal(t), s = C.seasonOf(ph), m = new Date(t + MSK * 60000).getUTCMonth() + 1;
      if (m === 11 && s !== 'autumn') badNov++;
      if ((m === 12 || m === 1) && s !== 'winter') badWin++;
      if (prev) { const d = Math.abs(((ph - prev.ph + 6) % 4) - 2); maxStep = Math.max(maxStep, d); if (d > .1) jumps++; }
      if (m >= 2 && m <= 10) {
        if (!first) first = s;
        last = s;
        if (prev && prev.m >= 2 && prev.s !== s) { changes++; lens.push((t - segStart) / D); segStart = t; }
      }
      prev = { ph, s, m };
    }
    if (y === 2026) {
      ok(first === 'spring' && last === 'summer', '1 февраля — весна (сразу после зимы), конец октября — лето (дальше ноябрьская осень)', { first, last });
      ok(changes === 37, 'февраль–октябрь: 38 сезонов (37 смен)', changes);
      const mid = lens.slice(1);   // первый отрезок — от 1 февраля
      ok(mid.every(l => l > 7.05 && l < 7.35), 'быстрый сезон — около недели (7,18 суток)', [Math.min(...mid).toFixed(2), Math.max(...mid).toFixed(2)]);
    }
  }
  ok(!badNov, 'ноябрь — всегда осень (2026–2040)', badNov);
  ok(!badWin, 'декабрь и январь — всегда зима (2026–2040)', badWin);
  ok(!jumps && maxStep < .1, 'фаза года непрерывна (за 3 ч сдвиг < 0,1 на всех стыках)', { jumps, maxStep: +maxStep.toFixed(4), years });
  // стыки точно
  ok(C.seasonOf(C.phaseCal(mskMs(2027, 2, 1) - 1000)) === 'winter' && C.seasonOf(C.phaseCal(mskMs(2027, 2, 1) + 1000)) === 'spring', '31 января 23:59:59 МСК — зима, 1 февраля 00:00:01 — весна');
  ok(C.seasonOf(C.phaseCal(mskMs(2027, 11, 1) - 1000)) === 'summer' && C.seasonOf(C.phaseCal(mskMs(2027, 11, 1) + 1000)) === 'autumn', '31 октября — лето, 1 ноября — осень');
  ok(C.seasonOf(C.phaseCal(mskMs(2027, 12, 1) + 1000)) === 'winter' && Math.abs(C.phaseCal(mskMs(2028, 1, 1)) - 3.5) < .01, '1 декабря — зима, 1 января — середина зимы (самый холод)', C.phaseCal(mskMs(2028, 1, 1)));
  const leapLen = (mskMs(2028, 11, 1) - mskMs(2028, 2, 1)) / D, normLen = (mskMs(2027, 11, 1) - mskMs(2027, 2, 1)) / D;
  ok(leapLen === 274 && normLen === 273, 'високосный год: февраль–октябрь 274 суток, обычный 273', [leapLen, normLen]);
  // листва: осенью желтеет, зимой тусклая, весной свежая, летом обычная
  const L2 = C.leafOf(2.7), L3 = C.leafOf(3.5), L0 = C.leafOf(.3), L1 = C.leafOf(1.4);
  ok(L2.autumn > .9 && L3.bare > .9 && L3.autumn < .05 && L0.fresh > .9 && L1.autumn === 0 && L1.bare === 0 && L1.fresh === 0, 'листва: осень — жёлтая, зима — голая, весна — свежая, лето — как есть', { L2, L3, L0, L1 });
  // температура сезона: середина лета — пик, середина зимы — минимум
  ok(C.seasonTemp(1.5) > C.seasonTemp(.5) && C.seasonTemp(3.5) < C.seasonTemp(2.5) && Math.abs(C.seasonTemp(0) - C.seasonTemp(4)) < 1e-9, 'температура сезона гладкая: пик летом, минимум зимой, на стыке круга — без скачка');
}

// ═══ 2. Праздники ═══
sec('праздники: местная полночь, отсчёт, таблицы, торжественные — без салюта');
{
  const zones = [-600, -180, 0, 180, 300, 330, 540, 840];
  let okNY = 0;
  for (const tz of zones) {
    const mid = Date.UTC(2027, 0, 1) - tz * 60000;
    const at = dt => C.holidays(mid + dt, { tz }).find(h => h.id === 'newyear');
    const a = at(-11000), b = at(-5000), c = at(1000), d = at(4 * 60000), e = at(2 * D + 1000);
    if (!a && b?.phase === 'pre' && Math.abs(b.left - 5) < .01 && c?.phase === 'burst' && d?.phase === 'day' && !e && b.newYear === 2027) okNY++;
  }
  ok(okNY === zones.length, 'Новый год: у каждого в его местную полночь — за 10 с отсчёт, в 00:00 салют, через 3 мин — праздник, через 2 суток — всё', okNY);
  const L = C.HOLIDAYS.find(h => h.id === 'lunar'), RH = C.HOLIDAYS.find(h => h.id === 'roshhashana'), HJ = C.HOLIDAYS.find(h => h.id === 'hijri');
  const yrs = Array.from({ length: 15 }, (_, i) => 2026 + i);
  ok(yrs.every(y => { const d = C.holidayDate(L, y); return d && ((d[0] === 1 && d[1] >= 21) || (d[0] === 2 && d[1] <= 20)); }), 'Лунный Новый год: таблица 2026–2040, всегда 21 января … 20 февраля');
  ok(C.holidayDate(L, 2026).join('-') === '2-17' && C.holidayDate(L, 2040).join('-') === '2-12', 'лунный: 2026 — 17 февраля, 2040 — 12 февраля');
  const lun = C.holidays(Date.UTC(2026, 1, 17, 0, 0, 30) - 480 * 60000, { tz: 480 }).find(h => h.id === 'lunar');
  ok(lun?.phase === 'burst' && /Лошади/.test(lun.sub) && lun.fireworks === 'big', 'лунный в Пекине: в полночь 17.02.2026 салют, «Год Лошади»', lun && lun.sub);
  ok(yrs.every(y => !!C.holidayDate(RH, y) && !!C.holidayDate(HJ, y)), 'Рош ха-Шана и 1 мухаррама — таблицы 2026–2040');
  ok(C.holidayDate(RH, 2026).join('-') === '9-12' && C.holidayDate(RH, 2027).join('-') === '10-2' && C.holidayDate(HJ, 2026).join('-') === '6-16', 'Рош ха-Шана 2026 — 12 сентября, 2027 — 2 октября; хиджра 2026 — 16 июня');
  const nz = d => C.holidays(Date.UTC(2027, 2, d, 12) - 300 * 60000, { tz: 300 }).some(h => h.id === 'nauryz');
  ok(!nz(20) && nz(21) && nz(22) && nz(23) && !nz(24), 'Наурыз — 21, 22, 23 марта (Казахстан)');
  const nzH = C.HOLIDAYS.find(h => h.id === 'nauryz');
  ok(/Наурыз құтты болсын/.test(nzH.greet) && nzH.style === 'spring' && nzH.decor.includes('yurt') && nzH.decor.includes('kozhe'), 'Наурыз: «Наурыз құтты болсын!», весна, крючки юрты и көже');
  const EN = C.HOLIDAYS.find(h => h.id === 'enkutatash');
  ok(C.holidayDate(EN, 2026).join('-') === '9-11' && C.holidayDate(EN, 2027).join('-') === '9-12' && C.holidayDate(EN, 2028).join('-') === '9-11', 'Энкутаташ: 11 сентября, 12 — перед високосным годом (2027)');
  ok(['roshhashana', 'hijri', 'songkran', 'enkutatash'].every(id => C.HOLIDAYS.find(h => h.id === id).fireworks === 'none') && ['roshhashana', 'hijri'].every(id => C.HOLIDAYS.find(h => h.id === id).style === 'calm'), 'торжественные — только поздравление, без салюта');
  const old = C.holidays(Date.UTC(2027, 0, 14, 0, 0, 20) - 180 * 60000, { tz: 180 }).find(h => h.id === 'oldnewyear');
  ok(old?.phase === 'burst' && old.fireworks === 'small' && !C.HOLIDAYS.find(h => h.id === 'oldnewyear').countdown, 'Старый Новый год 14 января — полегче: малый салют, без отсчёта');
  ok(C.HOLIDAYS.every(h => h.greet && h.name && h.style && (h.fixed || h.dates || h.rule)), 'у каждого праздника: имя, поздравление, стиль, дата');
  const nx = C.nextHoliday(Date.UTC(2026, 11, 20) - 300 * 60000, { tz: 300, id: 'newyear' });
  ok(nx && nx.year === 2027 && nx.start === Date.UTC(2027, 0, 1) - 300 * 60000, 'ближайший Новый год из 20 декабря — 1 января 00:00 местного', nx && nx.year);
}

// ═══ 3. Новогоднее задание ═══
sec('новогоднее задание: 1–31 декабря по местному, до полуночи 1 января');
{
  const tz = 300, at = (m, d, h) => C.advent(Date.UTC(2026, m - 1, d, h) - tz * 60000, { tz });
  ok(!at(11, 30, 23) && at(12, 1, 0)?.day === 1 && at(12, 31, 23)?.day === 31 && !at(1, 1, 0), 'идёт с 1 декабря 00:00 до 1 января 00:00');
  const a = at(12, 31, 23);
  ok(Math.abs(a.left - 3600) < 1 && a.newYear === 2027, 'отсчёт до Нового года — от местной полуночи', a.left);
}

// ═══ 4. Погода: детерминизм, плавность, пределы ═══
sec('погода: одно зерно — одна погода у всех, плавно, в пределах');
{
  const t0 = Date.UTC(2026, 9, 16, 9), A = C.world({ seed: 'mir' }), B = C.world({ seed: 'mir' }), X = C.world({ seed: 'другой' });
  const ser = (W, n = 600, step = 120000) => Array.from({ length: n }, (_, i) => W.at(10, -20, t0 + i * step));
  const a = ser(A), b = ser(B), x = ser(X);
  ok(a.every((s, i) => JSON.stringify(s) === JSON.stringify(b[i])), 'одно зерно и время — та же погода (без сети)');
  ok(a.some((s, i) => Math.abs(s.cloud - x[i].cloud) > .3 || s.state !== x[i].state), 'другое зерно — другая погода');
  let jump = 0; const m = ser(A, 1200, 30000);
  for (let i = 1; i < m.length; i++) for (const k of ['rain', 'snow', 'cloud', 'fog', 'thunder']) jump = Math.max(jump, Math.abs(m[i][k] - m[i - 1][k]));
  ok(jump < .2, 'части погоды меняются плавно (за 30 с — меньше 0,2)', +jump.toFixed(3));
  let bad = 0;
  for (const s of a) { for (const k of ['rain', 'snow', 'cloud', 'fog', 'heat', 'thunder', 'hail', 'wet', 'puddle', 'snowCover', 'ice', 'autumn', 'bare', 'fresh']) if (!(s[k] >= 0 && s[k] <= 1)) bad++; if (!(s.temp > -45 && s.temp < 50) || !Number.isFinite(s.feels) || !(s.wind >= 0 && s.wind < 40) || !C.STATES.includes(s.state)) bad++; }
  ok(!bad, 'все части 0…1, температура −45…+50, ветер 0…40 м/с, состояние из списка', bad);
  // чаще ясно: осадки — меньшая часть времени
  const yearS = Array.from({ length: 3000 }, (_, i) => A.at(0, 0, Date.UTC(2026, 0, 1) + i * (3 * H + 7 * 60000)));   // шаг не кратен части погоды (иначе — «стробоскоп»)
  const wetShare = yearS.filter(s => s.rain > .08 || s.snow > .08).length / yearS.length;
  ok(wetShare > .05 && wetShare < .35, 'чаще ясно: осадки — 5…35 % времени', +wetShare.toFixed(3));
  const states = new Set(yearS.map(s => s.state));
  ok(['clear', 'cloudy', 'overcast', 'rain', 'snow'].every(k => states.has(k)), 'за год бывают ясно, облачно, пасмурно, дождь, снег', [...states]);
  // гроза и метель — тоже есть (по всем климатам); детский городок — без гроз
  let th = 0, bz = 0, thK = 0;
  const Wm = C.world({ seed: 'mir', climate: 'mountain' }), Wt = C.world({ seed: 'mir', climate: 'tropic' }), Wk = C.world({ seed: 'mir', climate: 'tropic', storm: false });
  for (let i = 0; i < 3000; i++) { const t = Date.UTC(2026, 0, 1) + i * (3 * H + 7 * 60000); if (Wt.at(0, 0, t).state === 'thunderstorm') th++; if (Wm.at(0, 0, t).state === 'blizzard') bz++; if (Wk.at(0, 0, t).thunder > 0) thK++; }
  ok(th > 10 && bz > 10 && !thK, 'грозы (тропики), метели (горы); без гроз (детский городок, storm: false) — ни одной', { th, bz, thK });
}

// ═══ 5. Климаты и температура ═══
sec('климаты: горы холоднее и снежнее, пустыня жаркая и сухая, море ветреное и туманное');
{
  const W = C.world({ seed: 7, climateAt: x => x < 0 ? 'desert' : x < 1000 ? 'temperate' : x < 2000 ? 'mountain' : 'sea', front: 0 });
  const stat = (x, from, n = 800, step = 2 * H) => { let t = 0, rain = 0, snow = 0, wind = 0, fog = 0; for (let i = 0; i < n; i++) { const s = W.at(x, 0, from + i * step); t += s.temp; rain += s.rain > .08; snow += s.snow > .08; wind += s.wind; fog += s.fog > .4; } return { t: t / n, rain: rain / n, snow: snow / n, wind: wind / n, fog: fog / n }; };
  const win = Date.UTC(2026, 11, 2), D1 = stat(-500, win), T1 = stat(500, win), M1 = stat(1500, win), S1 = stat(2500, win);
  ok(T1.t < 0 && D1.t > T1.t + 10 && M1.t < T1.t, 'зимой: в умеренном — ниже нуля, в пустыне — заметно теплее, в горах — холоднее', { d: D1.t.toFixed(1), t: T1.t.toFixed(1), m: M1.t.toFixed(1) });
  ok(M1.snow > T1.snow * .9 && D1.snow < T1.snow * .5, 'снег: в горах не меньше, в пустыне — почти нет', { m: M1.snow, t: T1.snow, d: D1.snow });
  ok(S1.wind > T1.wind + 2 && S1.fog >= T1.fog, 'море — ветренее и туманнее', { s: S1.wind.toFixed(1), t: T1.wind.toFixed(1), sf: S1.fog, tf: T1.fog });
  // лето: быстрое лето в июле (фаза 1…2)
  let sumStart = 0; for (let t = Date.UTC(2026, 6, 1); t < Date.UTC(2026, 7, 1); t += H) if (C.seasonOf(C.phaseCal(t)) === 'summer') { sumStart = t; break; }
  const T2 = stat(500, sumStart + 2 * D, 60, H), D2 = stat(-500, sumStart + 2 * D, 60, H);
  ok(T2.t > 12 && D2.t > 25, 'летом: в умеренном тепло, в пустыне жарко', { t: T2.t.toFixed(1), d: D2.t.toFixed(1) });
  // высота: выше — холоднее
  const lo = W.at(500, 0, win, 0).temp, hi = W.at(500, 0, win, 150).temp;
  ok(hi < lo - 10, 'на 150 единиц выше — холоднее (lapse)', [lo.toFixed(1), hi.toFixed(1)]);
  // «ощущается»: на ветру в мороз холоднее, в жару и духоту — жарче
  ok(C.feels(-10, 8, 60) < -15 && C.feels(-10, 0, 60) === -10 && C.feels(32, 1, 80) > 34 && Math.abs(C.feels(18, 2, 60) - 18) < 4, '«ощущается»: ветер в мороз холоднее, духота в жару — жарче', [C.feels(-10, 8, 60), C.feels(32, 1, 80), C.feels(18, 2, 60)]);
}

// ═══ 6. Накопители: снег лежит зимой, тает весной; лёд; мокро после дождя ═══
sec('накопители: снег на земле, лёд на воде, мокро и лужи');
{
  const W = C.world({ seed: 'mir' });
  const deep = W.at(0, 0, mskMs(2027, 1, 5, 12)), summer = (() => { for (let t = mskMs(2026, 7, 1); ; t += H) if (C.seasonOf(C.phaseCal(t)) === 'summer' && C.phaseCal(t) > 1.4) return W.at(0, 0, t); })();
  ok(deep.snowCover > .8 && deep.ice > .8, 'середина зимы: снег лежит, озёра во льду', { s: deep.snowCover, i: deep.ice });
  ok(summer.snowCover === 0 && summer.ice === 0, 'лето: ни снега, ни льда', { s: summer.snowCover, i: summer.ice });
  // после дождя мокро, потом высыхает
  let rainT = 0; for (let t = Date.UTC(2026, 6, 1); t < Date.UTC(2026, 8, 1); t += 10 * 60000) { const s = W.at(0, 0, t); if (s.rain > .6 && s.temp > 5) { rainT = t; break; } }
  ok(rainT > 0, 'летом бывает сильный дождь');
  let endT = rainT; while (W.at(0, 0, endT).rain > .02 && endT < rainT + 6 * H) endT += 60000;   // дождь кончился
  const wetNow = W.at(0, 0, endT).wet, pudNow = W.at(0, 0, endT).puddle; let dryAt = 0;
  for (let t = endT; t < endT + 12 * H; t += 60000) { const s = W.at(0, 0, t); if (s.rain > .02) break; if (s.wet < .05) { dryAt = t; break; } }
  ok(wetNow > .7 && pudNow > .2, 'дождь кончился — мокро и лужи', { wetNow, pudNow });
  ok(dryAt > endT + 8 * 60000 && dryAt < endT + 40 * 60000, 'высыхает за 10–40 минут (общий мир: 1,5–5 погодных часов)', dryAt ? ((dryAt - endT) / 60000).toFixed(0) + ' мин' : 'снова дождь');
  // весна: снег тает (первая весна февраля — φ 0…1 — снег уходит)
  const feb = W.at(0, 0, mskMs(2027, 2, 6, 14));
  ok(feb.season === 'spring' && feb.snowCover < deep.snowCover, 'весной снег тает', { s: feb.snowCover });
  ok(W.iceAt(0, 0, mskMs(2027, 1, 5, 12)) === deep.ice, 'W.iceAt — для «можно ли ходить по льду»');
}

// ═══ 7. Режимы мира ═══
sec('режимы: календарь, по игровым дням, один сезон, выкл; погода — авто или одна');
{
  let g = { day: 1, hour: 6 };
  const Wc = C.world({ seed: 3, mode: 'cycle', days: 2, gameTime: () => g });
  const seq = [];
  for (let d = 1; d <= 16; d++) { g = { day: d, hour: 12 }; seq.push(Wc.at(0, 0, 0).season); }
  const changes = seq.filter((s, i) => i && s !== seq[i - 1]).length;
  ok(changes >= 7 && changes <= 8 && seq.includes('winter') && seq.includes('summer'), 'по игровым дням (2 дня на сезон): за 16 дней — 8 сезонов по кругу', seq.join(','));
  g = { day: 5, hour: 23.99 }; const a = Wc.at(0, 0, 0).phase; g = { day: 6, hour: .01 }; const b = Wc.at(0, 0, 0).phase;
  ok(Math.abs(b - a) < .01, 'через полночь игры — без скачка', [a, b]);
  const Wf = C.world({ seed: 3, mode: 'fixed', season: 'winter' });
  ok([0, 1, 2, 3].every(k => Wf.at(0, 0, Date.UTC(2026, k * 3, 10)).season === 'winter'), 'один сезон — всегда он');
  const Wo = C.world({ mode: 'off' }), o = Wo.at(0, 0, Date.UTC(2026, 11, 31));
  ok(o.state === 'clear' && o.snowCover === 0 && o.season === 'summer' && o.temp === 20, 'выкл — ясно, лето, +20');
  const Ws = C.world({ seed: 3, weather: 'snow' }), s = Ws.at(0, 0, Date.UTC(2026, 6, 10, 12));
  ok(s.snow > .5 && s.temp <= 0 && (s.state === 'snow' || s.state === 'blizzard'), 'погода «снег» — снег даже летом', { snow: s.snow, t: s.temp, st: s.state });
  const Wr = C.world({ seed: 3, weather: 'rain' }), r = Wr.at(0, 0, Date.UTC(2027, 0, 5, 12));
  ok(r.rain > .5 && r.snow === 0 && r.state === 'rain', 'погода «дождь» — дождь даже зимой', { rain: r.rain, st: r.state });
  const S = C.sanitize({ mode: 'cycle', days: 999, season: 'xx', weather: 'tornado', seed: { a: 1 } });
  ok(S.mode === 'cycle' && S.days === 60 && S.season === 'winter' && S.weather === 'auto' && S.seed === '', 'настройки мира из файла — только известное и в пределах', S);
  Wc.set({ days: 4 }); ok(Wc.days === 4, 'W.set меняет на ходу');
}

// ═══ 8. Персонажи (задел «как в Симс») ═══
sec('холод, жара, мокро для персонажей');
{
  const cold = { ...C.blank(), temp: -15, feels: -22, rain: 0, snow: .8 }, rainS = { ...C.blank(), temp: 12, feels: 10, rain: .9 }, hot = { ...C.blank(), temp: 36, feels: 39 };
  const e1 = C.exposure(cold), e2 = C.exposure(cold, { clothes: 1 }), e3 = C.exposure(cold, { inside: true }), e4 = C.exposure(rainS), e5 = C.exposure(rainS, { umbrella: true }), e6 = C.exposure(hot);
  ok(e1.cold > .8 && e2.cold < e1.cold - .3 && e3.cold === 0 && e4.wet > .7 && e5.wet === 0 && e6.heat > .7, 'мороз — холодно (куртка меньше, в доме — нет), дождь — мокро (зонт — нет), жара — жарко', { e1, e2, e4, e6 });
}

// ═══ 9. События ═══
sec('события: праздник и смена сезона');
{
  C._reset();
  const got = [];
  const off = C.on('holiday', r => got.push(r.id + ':' + r.phase));
  C.on('season', s => got.push('season:' + s.season));
  const tz = 300, mid = Date.UTC(2027, 0, 1) - tz * 60000;
  for (const dt of [-20000, -9000, -1000, 500, 200000, 3 * D]) C.tick(mid + dt, { tz });
  ok(got.includes('newyear:pre') && got.includes('newyear:burst') && got.includes('newyear:day') && got.includes('newyear:end'), 'Новый год: pre → burst → day → end', got);
  C.tick(mskMs(2027, 2, 1) - 1000, { tz }); C.tick(mskMs(2027, 2, 1) + 1000, { tz });
  ok(got.includes('season:spring'), 'смена сезона — событие', got.slice(-3));
  off(); const n = got.length; C.tick(mid + 20000, { tz }); ok(got.filter(x => x.startsWith('newyear')).length === got.slice(0, n).filter(x => x.startsWith('newyear')).length, 'отписка работает');
  let threw = false; C.on('weather', () => { throw new Error('x'); }); const w0 = console.warn; console.warn = () => {}; try { C.emit('weather', {}); } catch (e) { threw = true; } console.warn = w0;
  ok(!threw, 'ошибка в обработчике не роняет движок');
}

// ═══ 10. Скорость ═══
sec('скорость');
{
  const W = C.world({ seed: 'mir' }), t0 = Date.now();
  let t = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) W.at((i % 50) * 37, 0, t0 + i * 61000);
  const ms = Number(process.hrtime.bigint() - t) / 1e6 / 2000;
  ok(ms < .5, 'W.at — меньше 0,5 мс (зовут 2–4 раза в секунду)', +ms.toFixed(3));
  console.log(`  W.at: ${ms.toFixed(3)} мс`);
}

console.log(`\nclimate-test: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
