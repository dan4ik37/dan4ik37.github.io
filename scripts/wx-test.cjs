// Biome weather core (T-135, BIOME_WEATHER.md v2 WX0 + WX1; js/engine/wx.js + the climate.js hook) without a browser:
//   node scripts/wx-test.cjs            (CI: ~10^5 slots per check)      node scripts/wx-test.cjs --full   (10^6, the spec's size)
// Data tests (columns, ids, tokens, wind inside W bands, kids caps, the exhaustive acc ≤ 1000 grid), the integer twin of the ribbon
// (slotKindQ = slotEvent), season_q = C.seasonOf(phaseCal), golden: C.SPECIAL = false is today's climate.js byte for byte (HEAD copy
// in a separate context) and with it on every existing field is identical outside the specials' windows, `state` keeps the nine old
// values, the kids' city never gets a strong row, frequencies of §2.11 (±15 %), fronts move west → east, query order never changes a
// result, kids hail ≤ marble, AI sight (§6.1: never farther than the player's fog), cost of W.at.
const path = require('path'), fs = require('fs'), vm = require('vm'), cp = require('child_process');
const SITE = path.join(__dirname, '..');
const FULL = process.argv.includes('--full');
globalThis.window = undefined;
require(path.join(SITE, 'js/engine/climate.js'));
require(path.join(SITE, 'js/engine/wx.js'));
const C = globalThis.D37E.climate, X = globalThis.D37E.wx, H = C._h;
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
let T0 = Date.now(); const sec = t => { console.log('— ' + t + '  [' + (Date.now() - T0) + ' ms]'); };
const N = FULL ? 1e6 : 1e5;

// ═══ 1. Data (WX0) ═══
sec('данные: 53 строки × 30 столбцов, номера подряд, токены известны, целые строки в группах 1–3');
{
  const R = X.ROWS;
  ok(R.length >= 53 && R.every((r, i) => r.id === i + 1), 'номера 1…N подряд', R.map(r => r.id).slice(0, 5));
  ok(new Set(R.map(r => r.key)).size === R.length, 'ключи разные');
  ok(R.filter(r => r.g >= 1).every(r => !r.float), 'группы 1–3 — только целые условия');
  ok(R.filter(r => r.float).every(r => r.ai === 'none' && r.body.every(b => b === '-') && r.wfx === '-' && !r.vis && !r.db), 'дробные строки: без ИИ, тела, мира, видимости и шума');
  const W_LO = [0, 3, 16, 34, 55, 80, 108, 139, 172, 208, 245], W_HI = [2, 15, 33, 54, 79, 107, 138, 171, 207, 244, 284];   // dm/s, Beaufort (HL §2.1)
  const badW = R.filter(r => r.g === 1 && r.W && r.wind && r.wind[1] > 30 && (r.wind[0] < W_LO[r.W[0]] || r.wind[1] > W_HI[r.W[1]])).map(r => r.key);
  ok(!badW.length, 'ветер строки — внутри её ступеней W', badW);
  const badStrong = R.filter(r => r.strong && !(r.W || r.HA) && ![11, 25].includes(r.id)).map(r => r.key);
  ok(!badStrong.length, 'сильные строки — со ступенью (кроме 11, 25)', badStrong);
  const badKids = R.filter(r => (r.kW && (r.kW[1] > 9 || (r.kW[1] === 9 && !r.kW[2]))) || (r.kHA && r.kHA[1] > 1)).map(r => r.key);
  ok(!badKids.length, 'дети: ветер не выше W9 вполсилы, град не крупнее HA1', badKids);
  const links = R.flatMap(r => (r.wfx.match(/link:(\d+)/g) || []).map(t => +t.slice(5)));
  ok(links.every(n => n >= 25 && n <= 28), 'ссылки — только 25…28 (§6.9)', links);
  const KNOWN = /^(tint:(sand|dust|ochre|white|green|dark|smoke|warm|hue)|fog|flat|flash|flash_far|[gs]\d+|band|band2|band:white|shelf|cap|wallcloud|lenticular|fun\d|tum\d|drift|aur[12]|halo|haze|mir|spark\d+|leaf\d+|flake\d+|glow\d+|steam\d+|breath\d+|mist|curtain|puddle\+?|hailb|frost|glaze|icicles|slush|floes|bloom|dry_grass|dust_trails|spray|snow_plumes|whitecap_line|rain_up|snow_hue|-|)$/;
  const badG = []; for (const r of R) for (const g of r.gfx) for (const t of g.split('+')) if (!KNOWN.test(t)) badG.push(r.key + ':' + t);
  ok(!badG.length, 'токены картинки известны wx-fx', badG);
  ok(R.filter(r => r.rules === 1).every(r => r.cond.includes(18)), 'строки «абсурд» — только в абсурдных мирах');
  // hail harms for real (coordinator 29.10): crops damaged, dents; kids softer and never a knockout
  const hl = X.LV.hail;
  ok(hl.slice(1).every(h => h.b > 0 && h.c > 0 && h.c <= h.b && h.e >= 500 && h.d < h.e), 'град ранит (взрослые сильнее), у детей — мягче и не ниже 50 % здоровья', hl);
  ok(['hailstorm', 'supercell', 'tropic_hail'].every(k => /crop_damage/.test(X.row(k).wfx) && /dents/.test(X.row(k).wfx)), 'град портит посевы и оставляет вмятины');
  ok(/slip_car/.test(X.row('freezing_rain').body[0]) && X.glaze().steer === .7 && X.glaze().brake === .6 && X.glaze().spin === 0, 'ледяной дождь: скользко людям и машинам (руль ×0,7, тормоз ×0,6, без заносов)');
}
sec('данные: сумма ‰ строк группы 1 (и 2) ≤ 1000 при любом сочетании целых условий (сетка)');
{
  const { condOk } = X._ctx;
  const SEA = 4, PAR = [0, 1, 2, 3, 4, 5], DRY = [0, 4, 7, 8, 23, 24, 96], TS = [-31, -26, -25, -11, -10, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 7, 8, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31], IS = [500, 799, 800, 1000];
  let worst = 0, where = null, n = 0;
  for (let cls = 0; cls < X.CLASSES.length; cls++) for (let g = 1; g <= 2; g++) {
    const rows = X.BY[cls][g]; if (!rows.length) continue;
    // one hour per distinct pattern of the rows' hour masks (the sum can only change where a mask changes)
    const HRS = [...new Map(Array.from({ length: 24 }, (_, h) => [rows.map(r => (r.hours >> h) & 1).join(''), h])).values()];
    for (let sea = 0; sea < SEA; sea++) for (const pk of PAR) for (const hr of HRS) for (const dry of DRY) for (const T of TS) for (const I of IS) for (const sn of [0, 1]) for (const F of [0, 127]) {
      // every lazily computed input fixed to the grid point; flags at their most permissive (an over-approximation)
      let acc = 0;
      for (const r of rows) {
        if (r.float || r.hz || r.rules) continue;
        if (!(r.seas & (1 << sea)) || !(r.hours & (1 << hr)) || !(r.par & [32, 1, 2, 4, 8, 16][pk])) continue;
        let okc = true;
        for (let i = 0; i < r.cond.length && okc; i += 2) {
          const op = r.cond[i], v = r.cond[i + 1];
          okc = op === 1 ? dry >= v : op === 2 ? dry < v : op === 3 ? sn >= v : op === 4 ? T >= v : op === 5 ? T <= v : op === 6 ? I >= v : op === 12 ? !!(F & v) : op === 14 ? pk !== 1 && pk !== 2 : op === 20 ? pk === 0 : op === 18 ? false : op === 11 ? sea === 1 : true;
        }
        if (okc) acc += r.pm < 0 ? 0 : r.pm;
      }
      n++;
      if (acc > worst) { worst = acc; where = { cls: X.CLASSES[cls].key, g, sea, pk, hr, dry, T, I, sn, F }; }
    }
  }
  void condOk;
  ok(worst <= 1000, 'худший случай ≤ 1000 ‰ (' + n + ' точек сетки)', { worst, where });
  console.log('  худший случай: ' + worst + ' ‰', JSON.stringify(where));
}

// ═══ 2. Integer twin of the ribbon ═══
sec('двойник ленты: slotKindQ = slotEvent (вид, начало ≤ 125 мс, конец ≤ 250 мс, сила ≤ 1 ‰)');
{
  const keys = ['temperate', 'steppe', 'mountain', 'desert', 'sea', 'snow', 'tropic'], SN = ['spring', 'summer', 'autumn', 'winter'];
  let n = 0, kindBad = 0, tBad = 0, iBad = 0;
  const ev = {}, q = { k: 0, pa: 0, pe: 0, pI: 0 }, KN = ['', 'precip', 'thunder', 'fog', 'heat', 'cloud'];
  const per = Math.max(2000, Math.floor(N / 7 / 4 / 3));
  for (const seed of [C.seedOf('mir'), C.seedOf('kb:12345'), -7]) for (const k of keys) for (let si = 0; si < 4; si++) {
    const c = C.CLIMATES[k], cq = X._ctx.climQ(c);
    for (let s = 1000; s < 1000 + per; s++) {
      H.slotEvent(seed, s, c, SN[si], ev); X.slotKindQ(seed, s, cq, si, q); n++;
      if (ev.kind !== KN[q.k]) { kindBad++; continue; }
      if (!ev.kind) continue;
      if (Math.abs(ev.a * 3600 - q.pa) > 1 || Math.abs(ev.e * 3600 - q.pe) > 2) tBad++;
      if (Math.abs(ev.I * 1000 - q.pI) > 1) iBad++;
    }
  }
  ok(kindBad <= 4 * n / 1e6 + 1, 'вид совпадает (расхождений ≤ 4 на 10^6)', { n, kindBad });
  ok(tBad === 0 && iBad === 0, 'начало, конец и сила — в пределах', { tBad, iBad });
  console.log('  слотов: ' + n + ', расхождений вида: ' + kindBad);
}
sec('сезон слота (целый) = C.seasonOf(C.phaseCal) в середине каждого слота года; T_q — в пределах ±4° от дробной');
{
  const W = C.world({ seed: 'mir', mode: 'calendar' });
  let bad = 0, n = 0;
  const s0 = Math.floor(Date.UTC(2026, 0, 1) / 125 / 21600);
  for (let s = s0; s < s0 + 32 * 366; s++) { n++; if (['spring', 'summer', 'autumn', 'winter'][X.seasonQ(W, s, 0)] !== C.seasonOf(C.phaseCal((s * 21600 + 10800) * 125))) bad++; }
  ok(bad === 0, 'сезон совпадает на всех ' + n + ' слотах', bad);
  // T_q vs the float temperature without the slow noise (spec §1.3: within ±4 °C at the region's reference height)
  const ctx = X._ctx, st = ctx.stOf(W);
  let worst = 0;
  for (const k of ['temperate', 'steppe', 'desert', 'snow', 'mountain', 'sea', 'tropic']) {
    const c = C.CLIMATES[k], q = ctx.climQ(c), reg = X.regionOfClimate(k, {});
    for (let s = s0; s < s0 + 32 * 366; s += 7) {
      const x = ctx.setCtx(ctx.Ctx(), W, st, q, ctx.ckId(k), s, 0, reg), ms = (s * 21600 + 10800) * 125;
      const ph = C.phaseCal(ms), hr = Math.floor(C.parts(ms, C.ZONE).h), cld = [.15, .55, .55, .35, 0, .4][x.K.k] / .55;
      const Tf = C.seasonTemp(ph, c) + c.dayA * Math.cos(2 * Math.PI * (hr - 15) / 24) * (1 - .55 * cld);
      worst = Math.max(worst, Math.abs(ctx.TqOf(x) - Tf));
    }
  }
  ok(worst <= 4, 'T_q − дробная ≤ 4°', worst);
  console.log('  наибольшая разница T_q: ' + worst.toFixed(2) + '°');
}

// ═══ 3. Golden: SPECIAL off = today's climate.js; on = identical outside windows ═══
sec('эталон: C.SPECIAL = false — как climate.js до T-135 (копия из git HEAD в отдельном контексте)');
{
  let src = null;
  try { src = cp.execSync('git show main:js/engine/climate.js', { cwd: SITE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) {}
  if (!src || /SPECIAL/.test(src)) { try { src = cp.execSync('git show HEAD~0:js/engine/climate.js', { cwd: SITE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) {} }
  if (!src || /SPECIAL/.test(src)) { console.log('  (нет копии до T-135 — пропуск)'); }
  else {
    const ctx = { globalThis: null, Math, Date, Number, Object, Map, Set, String, Array, JSON, console, parseFloat, isFinite };
    ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
    const C0 = ctx.D37E.climate;
    const mk = (CC, o) => CC.world({ seed: 'mir', mode: 'calendar', climateAt: (x, z) => ['steppe', 'desert', 'snow', 'temperate', 'mountain', 'sea', 'tropic'][((Math.floor(x / 700) % 7) + 7) % 7], hourAt: ms => (ms / 60000) % 24, wx: true, ...o });
    const KEYS = ['season', 'phase', 'state', 'temp', 'feels', 'cloud', 'rain', 'snow', 'hail', 'thunder', 'fog', 'heat', 'wind', 'windDir', 'gust', 'humid', 'wet', 'puddle', 'snowCover', 'ice', 'autumn', 'bare', 'fresh', 'climate', 'hour', 'sun', 'w'];
    let bad = 0, badOn = 0, inWin = 0, n = 0, stOld = 0;
    const r = H.u01;
    for (const mode of ['calendar', 'cycle']) {
      C.SPECIAL = false;
      const Wa = mk(C0, { mode }), Wb = mk(C, { mode });
      const g = { day: 1, hour: 0 }; Wa.gameTime = Wb.gameTime = () => g;
      const Wc = mk(C, { mode }); Wc.gameTime = () => g;
      for (let i = 0; i < (FULL ? 20000 : 3000); i++) {
        const x = (r(5, i, 1) - .5) * 40000, z = (r(5, i, 2) - .5) * 40000, ms = Date.UTC(2026, 0, 1) + Math.floor(r(5, i, 3) * 365 * 86400000);
        g.day = 1 + Math.floor(r(5, i, 4) * 200); g.hour = r(5, i, 5) * 24;
        C.SPECIAL = false;
        const a = Wa.at(x, z, ms, 10), b = Wb.at(x, z, ms, 10);
        n++;
        if (KEYS.some(k => a[k] !== b[k]) || 'special' in b) bad++;
        C.SPECIAL = true;
        const c = Wc.at(x, z, ms, 10);
        if (!C.STATES.slice(0, 9).includes(c.state)) stOld++;
        const A = X.active(Wc, x, z, Wc.wNow(ms), ms, c.climate);
        if (A.r) { inWin++; continue; }   // inside [a − lead, e]: fields may follow the special
        // outside windows: the sample is identical (accumulators look back 30 w-h and may include a window — compare instant fields)
        if (['season', 'phase', 'state', 'temp', 'cloud', 'rain', 'snow', 'hail', 'thunder', 'fog', 'heat', 'wind', 'windDir', 'gust', 'humid', 'hour', 'sun'].some(k => a[k] !== c[k])) badOn++;
      }
    }
    ok(bad === 0, 'выключено — все поля как до T-135, новых полей нет', { n, bad });
    ok(badOn === 0, 'включено — вне окон особой погоды все поля как были', { n, inWin, badOn });
    ok(stOld === 0, 'state — только девять прежних состояний (новые — только в stateX)', stOld);
    console.log('  точек: ' + n + ', в окнах особой погоды: ' + inWin);
  }
  C.SPECIAL = true;
}

// ═══ 4. Behaviour ═══
const worldOf = (ck, o = {}) => C.world({ wx: o.wx !== false, seed: o.seed || 'mir', mode: o.mode || 'calendar', season: o.season, climateAt: () => ck, elements: o.elements || 'real', wxRegionAt: o.reg, storm: o.storm, realm: o.realm });
// picks of rows per real day over a simulated stretch (fixed season, calendar clock: 32 slots per day)
function freq(ck, season, slots, o = {}){
  const W = worldOf(ck, { mode: 'fixed', season, elements: o.elements || 'real' }), ctx = X._ctx, st = ctx.stOf(W), c = C.CLIMATES[ck], q = ctx.climQ(c), cid = ctx.ckId(ck);
  const reg = o.reg ? o.reg : X.regionOfClimate(ck, {}), rk = 999;
  const cnt = {};
  const s0 = Math.floor(Date.UTC(2026, 5, 1) / 125 / 21600);
  for (let s = s0; s < s0 + slots; s++) { const R = ctx.rollAt(W, st, q, cid, s, 0, reg, rk + s * 0); if (R.m) cnt[R.m.key] = (cnt[R.m.key] || 0) + 1; if (R.f) cnt[R.f.key] = (cnt[R.f.key] || 0) + 1; }
  for (const k in cnt) cnt[k] = cnt[k] / (slots / 32);
  return cnt;
}
sec('частота (§2.11, «как в жизни», ±15 %) за смоделированный срок');
{
  const S = FULL ? 320000 : 96000;
  const T = [
    ['desert', 'summer', 'sandstorm', .41], ['desert', 'summer', 'haboob', .20], ['steppe', 'spring', 'duststorm', .44], ['steppe', 'autumn', 'tumble_wind', 1.5],
    ['steppe', 'winter', 'buran', .83], ['steppe', 'winter', 'ground_blizzard', .89], ['snow', 'winter', 'whiteout', .96], ['mountain', 'summer', 'hailstorm', .55],
    ['temperate', 'summer', 'supercell', .15], ['sea', 'summer', 'waterspout', .72],
  ];
  const got = {};
  for (const [ck, sea, key, want] of T) {
    const f = freq(ck, sea, S)[key] || 0; got[ck + '/' + sea + '/' + key] = +f.toFixed(3);
    ok(Math.abs(f - want) <= want * .15, `${ck}, ${sea}: ${key} ≈ ${want} в день`, +f.toFixed(3));
  }
  console.log('  в день: ' + JSON.stringify(got));
  // steppe summer dry thunderstorm: spec §2.11 says 0.18; with its own recurrence (thunder resets the dry count) the expected value
  // is 0.112 thunder slots × 9/24 hours × P(dry ≥ 8) 0.132 × 0.5 × 32 = 0.089 — measured here and reported (spec errata)
  const dt = freq('steppe', 'summer', S).dry_thunder || 0;
  ok(Math.abs(dt - .089) <= .089 * .2, 'степь, лето: сухая гроза ≈ 0,089 в день (в спеке 0,18 — опечатка расчёта, см. отчёт)', +dt.toFixed(3));
  console.log('  сухая гроза в степи летом: ' + dt.toFixed(3) + ' в день');
  // «редко» (default): strong rows half as often, at full strength
  const r1 = freq('desert', 'summer', S).sandstorm || 0, r2 = freq('desert', 'summer', S, { elements: 'rare' }).sandstorm || 0;
  ok(Math.abs(r2 - r1 / 2) <= r1 * .12, '«редко» — сильные вдвое реже', { real: +r1.toFixed(3), rare: +r2.toFixed(3) });
  // realism: snow in a desert — only on winter nights, a few times in several game years; hail in the tropics — rare
  const yrs = FULL ? 30 : 10, dw = freq('desert', 'winter', 32 * 120 * yrs);
  const ds = (dw.desert_snow || 0) * 120;   // per game year (≈ 120 winter days a year: December–February + the fast winter)
  ok(ds > 0 && ds < .6, 'снег в пустыне — реже раза в 2 игровых года, но бывает', +ds.toFixed(3));
  const tr = freq('tropic', 'summer', 32 * 365);
  ok((tr.tropic_hail || 0) > 0 && (tr.tropic_hail || 0) < .08 && (tr.tropic_storm || 0) > 1, 'град в тропиках — редко, тропические грозы — часто', tr);
  console.log('  снег в пустыне: ' + ds.toFixed(3) + ' за игровой год; град в тропиках: ' + (tr.tropic_hail || 0).toFixed(3) + ' в день летом');
}
sec('детский городок (kc) и storm: false — никаких сильных строк; град у детей — не крупнее «горошины-ш шарика» (HA1)');
{
  let strong = 0, n = 0, hailBig = 0, hailAdult = 0;
  for (const ck of ['steppe', 'desert', 'temperate', 'mountain']) {
    const Wk = worldOf(ck, { reg: () => ({ ...X.regionOfClimate(ck, {}), kc: 1 }) }), Ws = worldOf(ck, { storm: false }), Wa = worldOf(ck, { realm: 'adult', elements: 'real' }), Wd = worldOf(ck, {});
    for (let i = 0; i < (FULL ? 40000 : 2500); i++) {
      const ms = Date.UTC(2026, 0, 1) + i * 2700000 + 777, x = (i * 37) % 5000;
      for (const W of [Wk, Ws]) { const A = X.active(W, x, 0, W.wNow(ms), ms, ck); n++; if (A.r && A.r.strong) strong++; }
      const s = Wd.at(x, 0, ms, 5); if (s.hailSize > 1.3) hailBig++;
      const sa = Wa.at(x, 0, ms, 5); if (sa.hailSize > 1.3) hailAdult++;
    }
  }
  ok(strong === 0, 'сильных строк нет', { n, strong });
  ok(hailBig === 0, 'дети: град ≤ 1,3 см', hailBig);
  { const Wh = worldOf('temperate', { realm: 'adult' }), Wk = worldOf('temperate', {}); Wh.set({ weather: 'hail' }); Wk.set({ weather: 'hail' }); const a = Wh.at(0, 0, Date.now(), 5).hailSize, k = Wk.at(0, 0, Date.now(), 5).hailSize; hailAdult += a > 1.3 ? 1 : 0; ok(hailAdult > 0 && k <= 1.3 && k > 0, 'град «один всегда»: взрослые (после проверки 18+) — крупнее, дети — «шарик» 1,3 см', { a, k }); }
}
sec('строка «по родителю» на пустой части — своя сила (туман в низинах есть); тропическая гроза — без града');
{
  const reg = () => ({ ...X.regionOfClimate('temperate', {}), F: 16 });   // a valley
  const W = worldOf('temperate', { reg, elements: 'real' }), Wt = worldOf('tropic', { elements: 'real' });
  let mist = 0, mistK = 0, trop = 0, tropHail = 0;
  for (let i = 0; i < (FULL ? 120000 : 30000); i++) {
    const ms = Date.UTC(2026, 3, 1) + i * 211111;
    const A = X.active(W, 0, 0, W.wNow(ms), ms, 'temperate');
    if (A.r && A.r.key === 'valley_mist' && A.phase >= 2) { mist++; if (A.k > 0) mistK++; }
    const s = Wt.at(0, 0, ms, 5); if (s.special === 'tropic_storm' && s.sp > .3) { trop++; if (s.hail > 0) tropHail++; }
  }
  ok(mist > 0 && mistK === mist, 'туман в низинах виден (сила > 0)', { mist, mistK });
  ok(trop > 0 && tropHail === 0, 'тропическая гроза — без града', { trop, tropHail });
}
sec('фронт идёт с запада на восток: то же явление восточнее — позже ровно на x / front');
{
  const W = worldOf('desert', { elements: 'real' }), W2 = worldOf('desert', { elements: 'real' });
  let seen = 0, same = 0;
  for (let i = 0; i < 20000 && seen < 300; i++) {
    const ms = Date.UTC(2026, 6, 1) + i * 1000003, x = 1000;
    const A = X.active(W, x, 0, W.wNow(ms), ms, 'desert'); if (!A.r || A.phase < 2) continue;
    seen++;
    const key = A.r.key, k = A.k, dx = 8000, ms2 = ms + Math.round(dx / W.front * 450000);
    const B = X.active(W2, x + dx, 0, W2.wNow(ms2), ms2, 'desert');
    if (B.r && B.r.key === key && Math.abs(B.k - k) <= 2) same++;
  }
  ok(seen > 50 && same / seen > .97, 'совпадает (≥ 97 %: край окна округляется до 125 мс)', { seen, same });
}
sec('порядок запросов не меняет ответ (кэши — чистая память); два мира с одним зерном — одна погода');
{
  const pts = []; for (let i = 0; i < 3000; i++) pts.push([(H.u01(9, i, 1) - .5) * 30000, (H.u01(9, i, 2) - .5) * 30000, Date.UTC(2026, 0, 1) + Math.floor(H.u01(9, i, 3) * 365 * 864e5)]);
  const run = (order) => { const W = C.world({ seed: 'mir', mode: 'calendar', climateAt: (x) => x > 0 ? 'steppe' : 'desert', elements: 'real', wx: true }); const out = new Array(pts.length); for (const i of order) { const s = W.at(pts[i][0], pts[i][1], pts[i][2], 5); out[i] = s.special + '|' + s.sp.toFixed(6) + '|' + s.vis + '|' + s.temp.toFixed(9); } return out.join(';'); };
  const ord = pts.map((_, i) => i), rev = ord.slice().reverse(), shuf = ord.slice().sort((a, b) => H.h32(3, a, 0) - H.h32(3, b, 0));
  const A = run(ord);
  ok(A === run(rev) && A === run(shuf), 'прямой, обратный и перемешанный порядок — одно и то же');
  ok(/sandstorm|duststorm|haboob|tumble_wind/.test(A), 'в выборке есть особая погода', A.length);
}
sec('видимость и ИИ (§6.1): существо видит не дальше игрока');
{
  const vq = 12;   // 24 m: inside a heavy sandstorm
  ok(X.sight(30, vq) === 0, 'игрок в 30 м в буре на 24 м — не замечен');
  ok(X.sight(20, vq) > 0 && X.sight(20, vq) < 1000, 'в 20 м — замечен медленнее', X.sight(20, vq));
  ok(Math.abs(X.sightLimit(vq, 300) / X.sightLimit(vq) - 1000 / 300) < 1e-9, 'житель пустыни (300 ‰) видит в 3,3 раза дальше');
  ok(X.sightLimit(vq, 1) === X.sightLimit(vq) * 4, 'и никто — дальше 4 видимостей');
  ok(X.sight(400, 255) === 1000 && X.sightLimit(255) === Infinity, 'ясно — без ограничений');
  // a live world: in a forced sandstorm the limit equals the fog end the player sees
  const W = worldOf('desert', {}); W.set({ weather: 'sandstorm' }); C.use(W);
  const s = W.at(0, 0, Date.now(), 5), lim = X.limitAt(0, 0);
  ok(s.special === 'sandstorm' && s.vis < 100 && Math.abs(lim - s.vis) < 2.1, 'буря «одна всегда»: предел ИИ = видимость игрока', { vis: s.vis, lim, sx: s.stateX });
  ok(s.stateX === 'sandstorm' && s.state !== 'sandstorm', 'stateX — «песчаная буря», state — прежний', { state: s.state, stateX: s.stateX });
  // D1: the cache must keep places apart (a time term in the key lost precision: cells ~65 km apart shared one value)
  {
    const vq0 = X.visQ, ms = Date.UTC(2026, 9, 30, 12);
    X.visQ = (Wd, x, z) => (z < 0 ? 20 : 255);   // storm south of z = 0, clear north
    const a = X.limitAt(10, -100, 1000, ms), b = X.limitAt(10, 5000, 1000, ms), c = X.limitAt(10, 5000, 1000, ms + 2000), d = X.limitAt(10, -100, 1000, ms + 2000);
    let far = 0; for (let i = 1; i <= 300; i++) if (X.limitAt(64 * i, 64 * 300 * (i & 1 ? 1 : -1), 1000, ms + 4000) !== ((i & 1) ? Infinity : 40)) far++;
    X.visQ = vq0;
    ok(a === 40 && b === Infinity && c === Infinity && d === 40 && far === 0, 'кэш предела ИИ не смешивает места: буря и ясно в 5 км — каждое своё, в любом порядке', { a, b, c, d, far });
  }
  C.use(null);
  ok(C.sanitize({ weather: 'buran' }).weather === 'buran' && C.sanitize({ weather: 'nope' }).weather === 'auto', 'sanitize знает новые состояния');
  const fx = ['sandstorm', 'duststorm', 'buran', 'whiteout', 'hail', 'downpour', 'freezing_rain', 'seafog'].map(st => { const Wf = worldOf('temperate', {}); Wf.set({ weather: st }); return Wf.at(0, 0, Date.now(), 5).stateX; });
  ok(fx.join() === 'sandstorm,duststorm,buran,whiteout,hail,downpour,freezing_rain,seafog', '«погода одна всегда» для каждого нового состояния', fx);
}
sec('целая запись для хостов (WxRec) и примеры особой погоды');
{
  const W = worldOf('steppe', { elements: 'real' });
  let seen = {}, recOk = 0, n = 0;
  for (let i = 0; i < (FULL ? 200000 : 12000); i++) {
    const ms = Date.UTC(2026, 0, 1) + i * 787001, s = W.at(500, 0, ms, 5);
    if (!s.special) continue;
    seen[s.special] = (seen[s.special] || 0) + 1;
    const r = X.at(W, 500, 0, ms, {}); n++;
    if (r.key === s.special && r.vis_q8 === Math.min(1020, s.vis * 2) && r.wlevel <= 9) recOk++;
  }
  ok(n > 0 && recOk === n, 'запись совпадает с картинкой (ключ, видимость, ступень ветра ≤ W9)', { n, recOk });
  ok(seen.duststorm && seen.buran, 'в степи бывают пыльная буря и буран', seen);
  console.log('  степь за год: ' + JSON.stringify(seen));
}
sec('скорость (node)');
{
  const W = C.world({ seed: 'mir', mode: 'calendar', climateAt: () => 'steppe', wx: true }), W0 = C.world({ seed: 'mir', mode: 'calendar', climateAt: () => 'steppe', wx: true });
  const t0 = Date.UTC(2026, 3, 1), M = 4000;
  const bench = (Wx, on) => { C.SPECIAL = on; let t = process.hrtime.bigint(); for (let i = 0; i < M; i++) Wx.at(100 + i * .3, 50, t0 + i * 500, 5); return Number(process.hrtime.bigint() - t) / 1e6 / M; };
  bench(W, true); bench(W0, false);
  const on = bench(W, true), off = bench(W0, false);
  C.SPECIAL = true;
  ok(on - off < .05, 'W.at с особой погодой — не дороже +0,05 мс (2 раза в секунду)', { on: +on.toFixed(4), off: +off.toFixed(4) });
  console.log(`  W.at: ${off.toFixed(4)} мс → ${on.toFixed(4)} мс (+${(on - off).toFixed(4)})`);
  // accum refill (new 0.25 w-h): 60 samples
  const W2 = C.world({ seed: 'mir2', mode: 'calendar', climateAt: () => 'desert', wx: true });
  let worst = 0; for (let i = 0; i < 40; i++) { const ms = t0 + i * 112500 * 4; const t = process.hrtime.bigint(); W2.at(0, 0, ms, 5); worst = Math.max(worst, Number(process.hrtime.bigint() - t) / 1e6); }
  console.log('  пересчёт накопителей (60 замеров): худший ' + worst.toFixed(3) + ' мс');
  ok(worst < 6, 'пересчёт накопителей — меньше 6 мс в node', worst);
}
sec('мир без wx: true (Студия 3D, «Подземье») — погода как до T-135, хотя wx.js в вкладке (D6)');
{
  const base = { seed: 'mir', mode: 'calendar', climateAt: () => 'desert', elements: 'real' };
  const Wn = C.world(base), Wy = C.world({ ...base, wx: true });
  let spN = 0, spY = 0, diff = 0;
  for (let i = 0; i < 3000; i++) {
    const ms = Date.UTC(2026, 5, 1) + i * 1187001, a = Wn.at(0, 0, ms, 5), b = Wy.at(0, 0, ms, 5);
    if (a.special) spN++; if (b.special) spY++;
  }
  C.SPECIAL = false; const Wo = C.world(base);
  for (let i = 0; i < 400; i++) { const ms = Date.UTC(2026, 5, 1) + i * 7187001, a = Wo.at(0, 0, ms, 5), b = Wn.at(0, 0, ms, 5); if (a.temp !== b.temp || a.rain !== b.rain || a.state !== b.state || a.fog !== b.fog || a.wind !== b.wind) diff++; }
  C.SPECIAL = true;
  ok(spN === 0 && spY > 0, 'пустыня: особая погода только у мира с wx: true', { spN, spY });
  ok(diff === 0, 'мир без wx: true — то же, что с выключенной особой погодой (температура, дождь, туман, ветер, состояние)', diff);
  Wn.set({ weather: 'sandstorm' }); C.use(Wn);
  ok(X.limitAt(0, 0) === Infinity && !Wn.at(0, 0, Date.now(), 5).special, 'без wx: true: «всегда буря» не включается, предел ИИ — без ограничения');
  C.use(null);
  ok(C.STATES_BASE.length === 9 && C.STATES.length > 9 && !C.STATES_BASE.includes('sandstorm'), 'C.STATES_BASE — девять прежних (их предлагает Студия), C.STATES — с новыми');
  const sw = fs.readFileSync(path.join(SITE, 'js/games/studio3d-weather.js'), 'utf8');
  ok(/\(C\.STATES_BASE \|\| C\.STATES\)\.map/.test(sw), 'выбор погоды Студии — из C.STATES_BASE');
}
sec('нет прогноза для интерфейса: файлы сайта вне движка не читают окна вперёд');
{
  const bad = [];
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.js$/.test(f.name)) { const s = fs.readFileSync(p, 'utf8'); if (/wx\.(active|_ctx)|\.signKey|\bsign\b.*wx/.test(s)) bad.push(path.relative(SITE, p)); } } };
  for (const d of ['js/ui', 'js/features', 'js/core']) if (fs.existsSync(path.join(SITE, d))) walk(path.join(SITE, d));
  ok(!bad.length, 'никто не читает будущее окно', bad);
}

console.log(`\nwx-test: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
