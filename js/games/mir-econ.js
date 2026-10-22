// ═══════════════════════════════════════
//  «ЖИВОЙ ГОРОД»: ДЕНКИ 💵 И СМЕНЫ (P1, docs/plans/universe-step1.md §7, docs/CITY_ECONOMY.md) — window.MirEcon
// ═══════════════════════════════════════
// Один файл без Three.js и без DOM при загрузке (грузится и в node — тесты, генератор city_defs, симуляция):
//   • каталог (CITIES, PROFS, GOODS, SKILL, CAPS, BUFF, BANK, SITE) — ВСЕ числа экономики в одном месте; SERVER → city_defs() в city.sql
//     (собирает node scripts/gen-city-defs.cjs; руками JSON в city.sql не править). Админ меняет числа без кода: «⚙️ Экономика города»
//     (city_cfg: ключи из белого списка cfgk — города, профессии, лимиты, налоги, эмиссия, цены еды);
//   • Rules — те же правила, что city_act (job / quit / task / buy / eat) и ежедневный расчёт: клиент показывает сразу, сервер решает;
//     тест PGlite гоняет одни и те же случайные ходы через оба (scripts/city-sql-test.mjs);
//   • TaskRunner — «сдать работу»: никогда не раньше минимального времени задания (сервер всё равно проверит), по шагам логики 1/60 с —
//     одинаково при 30/60/144 FPS (scripts/city-test.cjs);
//   • api — сервер (city.sql) или «пробные» денки в браузере (гость, или city.sql ещё не выполнен; d37_city_trial, не переносятся);
//   • 📱 «🏦 Банк» — приложение телефона (баланс, сегодня, навыки, история).
// Денки — целые; зарплата считается в сотых («копейки» копятся в frac): +5 % еды и +10 % навыка видны и при зарплате 6 💵.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.MirEcon) return;   // мир и телефон грузят один файл с разными ?v= — оставляем первый

  // ═══ Каталог (числа — предложение плана, владелец 22.10: «да, потом посмотрим по журналу»; меняются в «⚙️ Экономика города») ═══
  const V = 1;                // фаза сервера: city_defs ->> 'v' (клиент включает возможности по MirEcon.sv >= n)
  const START = 50;           // подарок новичку — один раз на аккаунт, при первой работе или покупке
  // Города: возраст, стартовая казна, неприкосновенный запас (ниже — «касса пуста»), казна не больше capDays дней эмиссии,
  // налоги (%, коридоры — cfgk), эмиссия в день: min(cap, base + per × A7) × k / 1000 (A7 — жители с 5+ заданиями хотя бы 2 дня из 7),
  // магазины еды: здание → что продаёт (цена = ref × 1,25)
  const CITIES = {
    kids: { n: 'Солнечный городок', icon: '🧸', age: 0, seed: 5000, reserve: 300, capDays: 30, tax: { income: 5, sales: 3 }, issue: { base: 300, per: 120, cap: 6000 },
      shops: { k_bake: ['bun', 'pie'], k_ice: ['icecream'] } },
    metro: { n: 'Большой город', icon: '🏙️', age: 16, seed: 10000, reserve: 500, capDays: 30, tax: { income: 10, sales: 5 }, issue: { base: 500, per: 160, cap: 12000 },
      shops: { m_shop: ['apple', 'juice', 'burger'], m_rest: ['pizza', 'soup', 'coffee'], m_mall: ['burger', 'pizza', 'juice', 'coffee', 'icecream'] } },
  };
  // Навык: опыт = число заданий профессии. Уровни 0/30/150/500/1500 — множитель зарплаты (%) и время задания (% от min)
  const SKILL = { at: [0, 30, 150, 500, 1500], mult: [100, 110, 125, 140, 160], fast: [100, 95, 90, 85, 80], names: ['Ученик', 'Работник', 'Специалист', 'Эксперт', 'Мастер'] };
  // Лимиты: в профессии за день — 1–40 полная зарплата, 41–60 половина, дальше «смени работу»; зарплата в день (валовая) ≤ wageDay;
  // еды купить в день ≤ foodDay, в кармане одного вида ≤ foodHold; city_act ≤ actMin в минуту; покупка — до qtyMax штук
  const CAPS = { full: 40, half: 60, wageDay: 400, foodDay: 20, foodHold: 10, actMin: 60, qtyMax: 5 };
  const BUFF = { max: 20 };   // бонусы к зарплате складываются не больше чем до +20 %
  // Центробанк (раз в день, глобально): M — средний кошелёк игроков за 14 дней, цель T; k (‰) множит эмиссию
  const BANK = { T: 1500, k0: 1000, kMin: 500, kMax: 1500, hi2: 130, hi1: 110, lo1: 90, lo2: 70, d2: 50, d1: 20, drift: 10, mDays: 14, a7: [5, 2] };
  // Ставка города: пока казна выше запаса хотя бы на days дневных бюджетов (бюджет — base + per × A7, без k) — зарплата полная; меньше —
  // ниже, до min % (у запаса). Бедный город платит всем понемногу (и опыт идёт), а не первым — всё, остальным — «касса пуста»
  // (city-sim: без ставки при 300 игроках у детей и «иногда» отказ в 33–39 % заданий, и A7 падал по спирали)
  const RATE = { min: 10, days: 1 };
  const SITE = { units: 10, stages: 5 };   // общая стройка: units заданий строителей — этап, stages этапов — дом
  const KEEP = { ledger: 30, marks: 30, contrib: 56, batch: 5000 };   // хранение (дней) и сколько строк убирать за раз
  // Профессии P1 (ph — фаза). cities — где работают (здания K_BLD / M_BLD), age — с какого возраста (метро и так 16+), min — секунд на
  // задание у «Ученика» (меньше нельзя: сервер скажет too_soon), wage — 💵 за задание (до множителей), site — двигает общую стройку
  const PROFS = {
    cook: { n: 'Повар', e: '👨‍🍳', ph: 1, cities: { kids: ['k_bake'], metro: ['m_rest'] }, age: 0, kind: 'svc', modes: ['city'], min: 20, wage: 6, desc: 'Печёт булочки и готовит обеды' },
    seller: { n: 'Продавец', e: '🛒', ph: 1, cities: { kids: ['k_ice'], metro: ['m_shop', 'm_bank'] }, age: 0, kind: 'svc', modes: ['city'], min: 15, wage: 5, desc: 'Обслуживает покупателей' },
    doctor: { n: 'Врач', e: '🩺', ph: 1, cities: { kids: ['k_hosp'], metro: ['m_hosp'] }, age: 0, kind: 'svc', modes: ['city'], min: 20, wage: 6, desc: 'Лечит жителей и питомцев' },
    fire: { n: 'Пожарный', e: '🚒', ph: 1, cities: { kids: ['k_fire'], metro: ['m_fire'] }, age: 0, kind: 'svc', modes: ['city'], min: 25, wage: 6, desc: 'Тушит пожары в городе' },
    builder: { n: 'Строитель', e: '👷', ph: 1, cities: { kids: ['k_site'], metro: ['m_lot1'] }, age: 0, kind: 'build', modes: ['city'], min: 20, wage: 7, site: 1, desc: 'Строит общий дом — его видят все' },
    teacher: { n: 'Учитель', e: '📚', ph: 1, cities: { kids: ['k_school'], metro: ['m_city3'] }, age: 0, kind: 'svc', modes: ['city'], min: 20, wage: 6, desc: 'Ведёт уроки и исследования' },
    police: { n: 'Полицейский', e: '👮', ph: 1, cities: { metro: ['m_police'] }, age: 16, kind: 'svc', modes: ['city'], min: 25, wage: 7, desc: 'Патрулирует улицы' },
    driver: { n: 'Водитель', e: '🚕', ph: 1, cities: { metro: ['m_taxi'] }, age: 16, kind: 'svc', modes: ['city'], min: 40, wage: 10, desc: 'Возит пассажиров на такси' },
    mech: { n: 'Механик', e: '🔧', ph: 1, cities: { kids: ['k_play'], metro: ['m_gas'] }, age: 0, kind: 'svc', modes: ['city'], min: 15, wage: 6, desc: 'Чинит машины и аттракционы' },
  };
  // Еда (P1): ref — опорная цена (в магазине ×1,25), buff — [+% к зарплате, минут]
  const GOODS = {
    bun: { n: 'Булочка', e: '🥐', cat: 'food', ref: 4, buff: [5, 30] }, pie: { n: 'Пирог', e: '🥧', cat: 'food', ref: 12, buff: [10, 60] },
    icecream: { n: 'Мороженое', e: '🍦', cat: 'food', ref: 4, buff: [5, 30] }, apple: { n: 'Яблоко', e: '🍎', cat: 'food', ref: 3, buff: [3, 20] },
    juice: { n: 'Сок', e: '🧃', cat: 'food', ref: 4, buff: [5, 30] }, coffee: { n: 'Кофе', e: '☕', cat: 'food', ref: 6, buff: [5, 30] },
    burger: { n: 'Бургер', e: '🍔', cat: 'food', ref: 10, buff: [10, 60] }, pizza: { n: 'Пицца', e: '🍕', cat: 'food', ref: 12, buff: [10, 60] },
    soup: { n: 'Суп', e: '🍲', cat: 'food', ref: 10, buff: [10, 60] },
  };
  // Что админ может поменять без кода (city_admin cfg): [путь, мин, макс] — целые; * — любой существующий ключ
  const CFGK = [
    ['start', 0, 1000], ['profs.*.wage', 1, 100], ['profs.*.min', 5, 600],
    ['caps.wageDay', 0, 5000], ['caps.full', 1, 300], ['caps.half', 1, 300], ['caps.foodDay', 0, 100], ['caps.foodHold', 1, 50],
    ['cities.kids.tax.income', 0, 10], ['cities.kids.tax.sales', 0, 8], ['cities.metro.tax.income', 0, 15], ['cities.metro.tax.sales', 0, 12],
    ['cities.*.issue.base', 0, 100000], ['cities.*.issue.per', 0, 10000], ['cities.*.issue.cap', 0, 1000000], ['cities.*.reserve', 0, 1000000], ['cities.*.capDays', 1, 365],
    ['bank.T', 100, 1000000], ['goods.*.ref', 1, 10000], ['site.units', 1, 1000], ['rate.min', 0, 100], ['rate.days', 1, 30],
  ];
  const pickKeys = (o, keys) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.fromEntries(keys.filter(f => v[f] != null).map(f => [f, v[f]]))]));
  // то, что знает сервер (city_defs0 в city.sql — генерируется из этого объекта)
  const SERVER = {
    v: V, start: START,
    cities: pickKeys(CITIES, ['age', 'seed', 'reserve', 'capDays', 'tax', 'issue', 'shops']),
    profs: pickKeys(PROFS, ['ph', 'cities', 'age', 'kind', 'modes', 'min', 'wage', 'site']),
    goods: pickKeys(GOODS, ['cat', 'ref', 'buff']),
    skill: { at: SKILL.at, mult: SKILL.mult, fast: SKILL.fast }, caps: CAPS, buff: BUFF, bank: BANK, rate: RATE, site: SITE, keep: KEEP, cfgk: CFGK,
  };

  const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const get = (o, path) => path.reduce((a, k) => (a != null && typeof a === 'object' ? a[k] : undefined), o);
  // Ключ настройки из белого списка? (то же — city_cfgok_ в city.sql)
  function cfgOk(base, key, val){
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_.]{1,60}$/.test(key)) return false;
    const k = key.split('.');
    if (typeof get(base, k) !== 'number') return false;
    if (val === null) return true;   // сброс к каталогу
    if (typeof val !== 'number' || !Number.isInteger(val)) return false;
    for (const [pat, lo, hi] of base.cfgk || []) {
      const p = pat.split('.');
      if (p.length !== k.length || !p.every((s, i) => s === '*' || s === k[i])) continue;
      return val >= lo && val <= hi;
    }
    return false;
  }
  // Каталог + настройки админа (то же — city_defs() в city.sql)
  function merge(base, data, cv = 0){
    const d = clone(base);
    for (const [key, val] of Object.entries(data || {})) {
      const k = key.split('.'); const par = get(d, k.slice(0, -1));
      if (par && typeof par === 'object' && typeof par[k[k.length - 1]] === 'number' && typeof val === 'number') par[k[k.length - 1]] = val;
    }
    d.cv = cv;
    return d;
  }

  // ═══ Правила (те же, что city_act и расчёт дня в city.sql — меняешь одно, меняй другое; тест сверяет) ═══
  const Rules = (() => {
    const day = now => new Date((Math.floor(now) + 10800) * 1000).toISOString().slice(0, 10);   // день по Москве (UTC+3, без перехода)
    const lvl = (D, xp) => { const a = D.skill.at; let L = 0; for (let i = 1; i < a.length; i++) if ((xp | 0) >= a[i]) L = i; return L; };
    const minS = (D, prof, L) => { const P = D.profs[prof]; return P ? Math.floor((P.min * D.skill.fast[L] + 99) / 100) : 0; };
    const price = (D, item) => { const g = D.goods[item]; return g ? Math.floor((g.ref * 125 + 50) / 100) : 0; };
    const buffP = (D, st, now) => { const f = st && st.buffs && st.buffs.food; return f && f.u > now ? Math.min(D.buff.max, f.p | 0) : 0; };
    // валовая зарплата в сотых: wage × навык% × (100 + бонус)% × ставка города%
    const g100 = (D, prof, L, buff, wk) => Math.floor(D.profs[prof].wage * D.skill.mult[L] * (100 + buff) * wk / 10000);
    const stage = (D, site) => Math.floor((site | 0) / D.site.units) % D.site.stages;
    // ставка города, % (то же — city_rate_ в city.sql): (казна − запас) × 100 / (дней × бюджет дня), в коридоре min…100; без казны — 100
    const rate = (D, city, cs) => {
      const C = D.cities[city], R0 = D.rate || RATE;
      if (!C || !cs || cs.treasury == null) return 100;
      const b = Math.max(cs.bud | 0, C.issue.base | 0, 1) * R0.days;
      return Math.max(R0.min, Math.min(100, Math.floor((cs.treasury - C.reserve) * 100 / b)));
    };
    const fresh = () => ({ cash: 0, frac: 0, granted: false, skills: {}, xpd: {}, day: null, wd: 0, fd: 0, food: {}, buffs: {}, job: null, act_t: 0, act_n: 0, rev: 0 });
    const hex8 = rnd => { let s = ''; for (let i = 0; i < 8; i++) s += '0123456789abcdef'[Math.floor(rnd() * 16) & 15]; return s; };
    // Состояние из сервера / браузера → проверенное (мусор отбрасывается)
    function sanitize(o){
      const f = fresh(); if (!o || typeof o !== 'object') return f;
      const int = (v, d = 0) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : d);
      const map = v => { const out = {}; if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, n] of Object.entries(v)) if (/^[a-z][a-z0-9_]{0,23}$/.test(k) && Number.isFinite(n) && n > 0) out[k] = Math.floor(n); return out; };
      f.cash = int(o.cash); f.frac = Math.min(99, int(o.frac)); f.granted = !!o.granted; f.skills = map(o.skills); f.xpd = map(o.xpd);
      f.day = typeof o.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.day) ? o.day : null;
      f.wd = int(o.wd); f.fd = int(o.fd); f.food = map(o.food); f.act_t = int(o.act_t); f.act_n = int(o.act_n); f.rev = int(o.rev);
      const b = o.buffs && o.buffs.food; if (b && Number.isFinite(b.p) && Number.isFinite(b.u)) f.buffs = { food: { p: Math.floor(b.p), u: Math.floor(b.u) } };
      const j = o.job;
      if (j && typeof j === 'object' && typeof j.prof === 'string' && typeof j.city === 'string') f.job = { prof: j.prof, city: j.city, mode: typeof j.mode === 'string' ? j.mode : 'city', place: typeof j.place === 'string' ? j.place : '', n: typeof j.n === 'string' ? j.n : '', t: int(j.t), k: int(j.k) };
      return f;
    }
    // Ход: D — каталог (с настройками), st — человек, a — действие, g — аргументы, now — секунды сервера, cs — город
    // ({ treasury, frozen, wage_k, site }: для task — город работы, для buy — город магазина), rnd — случайность (номер задания, цель)
    // → { ok, reason, wait?, cap?, st, cs, got }. При отказе st — прежний, кроме счётчика частоты (как в city_act).
    function act(D, st0, a, g, now, cs0, rnd = Math.random){
      g = g && typeof g === 'object' ? g : {}; now = Math.floor(now);
      const base = clone(st0 || fresh());
      if (now - (base.act_t | 0) >= 60) { base.act_t = now; base.act_n = 0; }
      if ((base.act_n | 0) >= D.caps.actMin) return { ok: false, reason: 'too_fast', st: base, cs: cs0 };
      base.act_n = (base.act_n | 0) + 1;
      const st = clone(base), cs = cs0 ? { ...cs0 } : { treasury: 0, frozen: false, wage_k: 100, site: 0 };
      const fail = (reason, x) => ({ ok: false, reason, ...(x || {}), st: base, cs: cs0 });
      const today = day(now);
      const roll = () => { if (st.day !== today) { st.day = today; st.xpd = {}; st.wd = 0; st.fd = 0; } };
      const newTask = () => { st.job.n = hex8(rnd); st.job.t = now; st.job.k = Math.min(9, Math.floor(rnd() * 10)); };
      if (a === 'quit') {
        if (!st.job) return { ok: true, st: base, cs: cs0, got: {} };
        st.job = null; st.rev++;
        return { ok: true, st, cs, got: {} };
      }
      if (a === 'job') {
        const C = D.cities[g.city]; if (!C) return fail('city');
        const P = D.profs[g.prof]; if (!P || (P.ph || 1) > D.v) return fail('prof');
        const mode = g.mode || 'city'; if (!(P.modes || ['city']).includes(mode)) return fail('mode');
        const pl = (P.cities || {})[g.city]; if (!pl || !pl.includes(g.place)) return fail('args');
        if (cs.frozen) return fail('frozen');
        let gr = 0; if (!st.granted) { gr = D.start; st.granted = true; st.cash += gr; }
        st.job = { prof: g.prof, city: g.city, mode, place: g.place, n: '', t: now, k: 0 };
        newTask(); st.rev++;
        return { ok: true, st, cs, got: { grant: gr } };
      }
      if (a === 'task') {
        const J = st.job; if (!J) return fail('job');
        const P = D.profs[J.prof], C = D.cities[J.city]; if (!P || !C) return fail('prof');
        if (g.n !== J.n) return fail('nonce');
        const xp = st.skills[J.prof] | 0, L = lvl(D, xp), need = minS(D, J.prof, L);
        if (now - J.t < need) return fail('too_soon', { wait: need - (now - J.t) });
        roll();
        const nT = st.xpd[J.prof] | 0;
        if (nT >= D.caps.half) return fail('day_cap', { cap: 'prof' });
        const room = D.caps.wageDay * 100 - st.wd;
        if (room <= 0) return fail('day_cap', { cap: 'wage' });
        if (cs.frozen) return fail('frozen');
        let gr = g100(D, J.prof, L, buffP(D, st, now), cs.wage_k == null ? 100 : cs.wage_k);
        const rt = rate(D, J.city, cs);
        gr = Math.floor(gr * rt / 100);
        if (nT >= D.caps.full) gr = Math.floor(gr / 2);
        gr = Math.min(gr, room);
        const tx = Math.floor(gr * C.tax.income / 100), f = st.frac + gr - tx, net = Math.floor(f / 100);
        if (cs.treasury - net < C.reserve) return fail('no_slots');
        st.frac = f % 100; st.cash += net; st.wd += gr;
        st.xpd[J.prof] = nT + 1; st.skills[J.prof] = xp + 1;
        cs.treasury -= net;
        if (P.site) cs.site = (cs.site | 0) + 1;
        const L2 = lvl(D, xp + 1);
        newTask(); st.rev++;
        return { ok: true, st, cs, got: { net, g100: gr, t100: tx, xp: 1, lvl: L2, up: L2 > L, tired: nT + 1 >= D.caps.full, rate: rt } };
      }
      if (a === 'buy') {
        const C = D.cities[g.city]; if (!C) return fail('city');
        const items = (C.shops || {})[g.place]; if (!items || !items.includes(g.item) || !D.goods[g.item]) return fail('args');
        const q = g.qty == null ? 1 : g.qty; if (!Number.isInteger(q) || q < 1 || q > D.caps.qtyMax) return fail('args');
        if (cs.frozen) return fail('frozen');
        roll();
        if (st.fd + q > D.caps.foodDay) return fail('day_cap', { cap: 'food' });
        if ((st.food[g.item] | 0) + q > D.caps.foodHold) return fail('full');
        const cost = price(D, g.item) * q, gr = st.granted ? 0 : D.start;
        if (st.cash + gr < cost) return fail('cash', { need: cost });
        if (gr) { st.granted = true; st.cash += gr; }
        st.cash -= cost; st.food[g.item] = (st.food[g.item] | 0) + q; st.fd += q;
        cs.treasury += cost; st.rev++;
        return { ok: true, st, cs, got: { cost, grant: gr } };
      }
      if (a === 'eat') {
        const G = D.goods[g.item]; if (!G || !G.buff) return fail('args');
        if (!((st.food[g.item] | 0) > 0)) return fail('none');
        st.food[g.item]--; if (!st.food[g.item]) delete st.food[g.item];
        const [p, m] = G.buff, cur = st.buffs.food;
        if (!(cur && cur.u > now && cur.p > p)) st.buffs.food = { p, u: now + m * 60 };
        st.rev++;
        return { ok: true, st, cs: cs0, got: { p: st.buffs.food.p, u: st.buffs.food.u } };
      }
      return fail('args');
    }
    // Центробанк: новый k по среднему кошельку M (то же — city_knext_)
    function kNext(D, k, M){
      const B = D.bank, r = Math.floor(M * 100 / B.T);
      let n = k;
      if (r > B.hi2) n = k - B.d2; else if (r > B.hi1) n = k - B.d1; else if (r < B.lo2) n = k + B.d2; else if (r < B.lo1) n = k + B.d1;
      else n = k > B.k0 ? Math.max(B.k0, k - B.drift) : Math.min(B.k0, k + B.drift);
      return Math.max(B.kMin, Math.min(B.kMax, n));
    }
    // Эмиссия за день (до k) и потолок казны
    const budget = (D, city, a7) => { const I = D.cities[city].issue; return Math.min(I.cap, I.base + I.per * a7); };
    const issue = (D, city, a7, k) => Math.floor(budget(D, city, a7) * k / 1000);
    const capT = (D, city, a7) => D.cities[city].capDays * budget(D, city, a7);
    return { day, lvl, minS, price, buffP, g100, stage, rate, fresh, sanitize, act, kNext, budget, issue, capT };
  })();

  // ═══ Случайность от номера задания: у одного номера — одни и те же цели (после перезагрузки — то же задание) ═══
  function rng(seed){
    let h = 2166136261;
    for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    let a = h >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ═══ «Сдать работу»: по шагам логики (update(dt) — 1/60 с) — раньше минимального времени не отправит ═══
  // o: { clock() → секунды сервера, send(n) → Promise<ответ>, margin (с) }. begin(n, t, need, steps) — новое задание (t — когда сервер
  // его выдал), done() — шаг сделан (true — последний), update(dt) — шаг логики: отсчитывает и шлёт ОДИН раз; left() — сколько ждать.
  function TaskRunner(o){
    const margin = o.margin ?? .35;
    const R = { st: 'idle', n: null, t0: 0, need: 0, steps: 0, i: 0, gt: 0, sends: 0, res: null };
    // только что выдано — считаем с нуля (часы клиента могут спешить); выдано давно (перезагрузка) — уже прошло clock − t (минус 1 с запаса)
    R.begin = (n, t, need, steps) => { const el = o.clock() - t; Object.assign(R, { st: 'run', n, t0: t, need, steps, i: 0, gt: el > 5 ? Math.max(0, el - 1) : 0, res: null }); };
    R.done = () => { if (R.st !== 'run') return false; R.i++; if (R.i >= R.steps) { R.st = 'wait'; return true; } return false; };
    R.ready = () => R.gt >= R.need + margin && o.clock() >= R.t0 + R.need + margin;
    R.left = () => Math.max(0, R.need + margin - R.gt, R.t0 + R.need + margin - o.clock());
    R.retry = wait => { if (R.st !== 'sent') return; R.st = 'wait'; R.need = Math.max(R.need, R.gt + (wait || 1)); };   // сервер сказал «рано» — ждём ещё
    R.update = dt => {
      if (R.st === 'run' || R.st === 'wait') R.gt += dt;
      if (R.st !== 'wait' || !R.ready()) return;
      R.st = 'sent'; R.sends++;
      Promise.resolve(o.send(R.n)).then(res => { R.res = res; o.after?.(res); }, e => { R.res = { ok: false, reason: 'net' }; o.after?.(R.res); });
    };
    R.stop = () => { R.st = 'idle'; };
    return R;
  }

  // ═══ Тексты отказов ═══
  const WHY = {
    auth: 'Войди, чтобы зарплата копилась в аккаунте', args: 'Что-то пошло не так — обнови страницу', city: 'Такого города нет', prof: 'Такой работы нет',
    mode: 'Работа «на себя» откроется позже', job: 'Сначала выбери работу на щите «🧰 Работа»', nonce: 'Работу уже сдали (в другой вкладке?) — продолжаем',
    too_soon: 'Работа ещё не готова — подожди немного', too_fast: 'Слишком часто — подожди минутку', no_slots: 'Касса города пуста — работа «на город» снова завтра',
    cash: 'Не хватает 💵', full: 'Больше не унести', none: 'Сначала купи', frozen: 'Город на паузе — работы и магазины закрыты', age: 'Эта работа — с 16 лет',
    banned: 'Работа в городе недоступна', sv: 'Появится, когда сайт обновится', nosql: 'Банк города появится, когда сайт обновится', net: 'Нет связи — попробуй ещё раз',
    rights: 'Только для администрации', treasury: 'В казне столько нет',
    day_cap_prof: 'Ты устал от этой работы — смени профессию до завтра', day_cap_wage: 'Зарплата на сегодня — всё. Приходи завтра!', day_cap_food: 'Еды на сегодня хватит 🙂',
  };
  const why = r => (r?.reason === 'day_cap' ? WHY['day_cap_' + (r.cap || 'wage')] : WHY[r?.reason]) || WHY.args;
  const fmt = n => Math.floor(n || 0).toLocaleString('ru-RU');
  const fmt100 = n => { const v = Math.floor(n || 0); return Math.floor(v / 100) + (v % 100 ? ',' + String(v % 100).padStart(2, '0') : ''); };

  // ═══ Связь: сервер (city.sql) или «пробные» денки в браузере ═══
  const api = (() => {
    const A = { mode: 'trial', why: 'guest', sv: 0, D: merge(SERVER, {}), st: Rules.fresh(), pub: {}, off: 0, sql: null, loading: null, hist: null };
    const L = new Map();
    A.on = (ev, f) => { if (!L.has(ev)) L.set(ev, new Set()); L.get(ev).add(f); return () => L.get(ev)?.delete(f); };
    const emit = (ev, x) => { for (const f of [...(L.get(ev) || [])]) { try { f(x); } catch (e) { console.error(e); } } };
    const authed = () => typeof currentUser !== 'undefined' && !!currentUser;
    const sb = () => (typeof sbClient !== 'undefined' && sbClient) || null;
    const lsGet = k => { try { return JSON.parse(root.localStorage?.getItem(k) || 'null'); } catch (e) { return null; } };
    const lsSet = (k, v) => { try { root.localStorage?.setItem(k, JSON.stringify(v)); } catch (e) {} };
    A.clock = () => Date.now() / 1000 + (A.mode === 'server' ? A.off : 0);
    async function rpc(name, args){
      const c = sb(); if (!c) return { ok: false, reason: 'net' };
      try {
        const { data, error } = await c.rpc(name, args || {});
        if (error) { if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || '')) { A.sql = false; return { ok: false, reason: 'nosql' }; } return { ok: false, reason: error.code === '42501' ? 'rights' : 'net', error }; }
        if (data && typeof data.now === 'number') A.off = data.now - Date.now() / 1000;
        return data ?? { ok: false, reason: 'net' };
      } catch (e) { return { ok: false, reason: 'net' }; }
    }
    A.rpc = rpc;
    // каталог: из кэша сразу, свежий — если сервер сказал другую версию (v / cv)
    const cached = lsGet('d37_city_defs');
    if (cached && cached.d && cached.d.v === V) A.D = cached.d;
    async function defsFor(v, cv){
      if (A.D && A.D.v === v && (A.D.cv | 0) === (cv | 0) && A.D.profs) return;
      const d = await rpc('city_defs');
      if (d && d.profs && d.cities) { A.D = d; lsSet('d37_city_defs', { d }); }
    }
    // пробный режим: тот же Rules.act над состоянием в браузере
    const TKEY = 'd37_city_trial';
    function trialLoad(){ const o = lsGet(TKEY) || {}; return { st: Rules.sanitize(o.st), site: { kids: o.site?.kids | 0, metro: o.site?.metro | 0 }, h: Array.isArray(o.h) ? o.h.slice(0, 30) : [] }; }
    let T = trialLoad();
    const trialSave = () => lsSet(TKEY, { st: T.st, site: T.site, h: T.h.slice(0, 30) });
    const trialCs = city => ({ city, treasury: 1e12, frozen: false, wage_k: 100, site: T.site[city] | 0 });
    function pubTrial(city){ const D = A.D, C = D.cities[city]; return { city, rev: 0, treasury: null, reserve: C?.reserve || 0, hire: true, site: T.site[city] | 0, stage: Rules.stage(D, T.site[city]), frozen: false, wage_k: 100, tax: C?.tax, trial: true }; }
    A.init = (force) => {
      if (A.loading && !force) return A.loading;
      A.loading = (async () => {
        if (!authed()) { A.mode = 'trial'; A.why = 'guest'; A.sv = 0; T = trialLoad(); A.st = T.st; emit('state', A); return A; }
        const r = await rpc('city_state', { p_city: null, p_hist: 0 });
        if (r.reason === 'nosql') { A.mode = 'trial'; A.why = 'nosql'; A.sv = 0; T = trialLoad(); A.st = T.st; }
        else if (r.ok) { A.mode = 'server'; A.why = ''; A.sv = r.v | 0; A.st = Rules.sanitize(r.st); A.age = r.age || {}; A.banned = !!r.banned; await defsFor(r.v, r.cv); }
        else { A.mode = 'trial'; A.why = 'net'; A.sv = 0; T = trialLoad(); A.st = T.st; }
        emit('state', A);
        return A;
      })();
      return A.loading;
    };
    // ход (по очереди: ответы приходят в порядке ходов)
    let chain = Promise.resolve();
    A.act = (a, g = {}) => (chain = chain.then(() => actNow(a, g), () => actNow(a, g)));
    async function actNow(a, g){
      if (A.mode !== 'server') {
        const city = a === 'task' ? T.st.job?.city : g.city;
        const r = Rules.act(A.D, T.st, a, g, Math.floor(A.clock()), city ? trialCs(city) : null);
        T.st = r.st;
        if (r.ok) {
          if (r.cs && city) T.site[city] = r.cs.site | 0;
          const t = Math.floor(A.clock());
          if (r.got?.grant) T.h.unshift({ a: r.got.grant, k: 'grant', r: '', t, c: city });
          if (a === 'task') T.h.unshift({ a: r.got.net, f: r.got.t100, k: 'wage', r: T.st.job?.prof || '', t, c: city });
          if (a === 'buy') T.h.unshift({ a: -r.got.cost, k: 'food', r: g.item, t, c: city });
          T.h.length = Math.min(T.h.length, 30);
          if (a === 'task' && r.cs) r.c = pubTrial(city);
        }
        trialSave(); A.st = T.st;
        emit('state', A); if (r.c) { A.pub[r.c.city] = r.c; emit('pub', r.c); }
        return r;
      }
      const dev = root.D37Ref?.device?.() || null;
      const r = await rpc('city_act', { p_act: a, p_a: g, p_dev: dev });
      if (r.reason === 'nosql') { await A.init(true); return r; }
      if (r.st) { A.st = Rules.sanitize(r.st); emit('state', A); }
      if (r.c) { A.pub[r.c.city] = { ...A.pub[r.c.city], ...r.c }; emit('pub', A.pub[r.c.city]); }
      return r;
    }
    // город: казна, найм, стройка (раз в 2 мин, пока ты в городе; «same» — ничего не поменялось)
    A.pubGet = async (city, force) => {
      if (A.mode !== 'server') { const p = pubTrial(city); A.pub[city] = p; emit('pub', p); return p; }
      const old = A.pub[city];
      const r = await rpc('city_public', { p_city: city, p_rev: !force && old ? old.rev : null });
      if (r.same) return old;
      if (r.ok) { A.pub[city] = r; emit('pub', r); if ((r.cv | 0) !== (A.D.cv | 0) || (r.v | 0) !== A.D.v) defsFor(r.v, r.cv).then(() => emit('state', A)); return r; }
      return old || null;
    };
    A.history = async () => {
      if (A.mode !== 'server') return T.h.slice(0, 30);
      const r = await rpc('city_state', { p_city: null, p_hist: 30 });
      if (r.ok) { A.st = Rules.sanitize(r.st); return r.hist || []; }
      return [];
    };
    A.trialReset = () => { T = { st: Rules.fresh(), site: { kids: 0, metro: 0 }, h: [] }; trialSave(); if (A.mode !== 'server') { A.st = T.st; emit('state', A); } };
    if (typeof root.addEventListener === 'function') root.addEventListener('d37:auth', () => { A.pub = {}; A.init(true); });
    return A;
  })();

  // ═══ Подписи для окон: уровень навыка, сегодня ═══
  const ui = {
    lvlName: L => SKILL.names[L] || SKILL.names[0],
    stars: L => '★'.repeat(L + 1),
    skill(D, st, prof){
      const xp = st.skills?.[prof] | 0, L = Rules.lvl(D, xp), next = D.skill.at[L + 1];
      return { xp, L, name: SKILL.names[L], next: next ?? null, pct: next ? Math.round((xp - D.skill.at[L]) / (next - D.skill.at[L]) * 100) : 100, today: st.day === Rules.day(api.clock()) ? st.xpd?.[prof] | 0 : 0 };
    },
    // ставка города по последним данным города (pc — city_public; пробный режим и нет данных — 100)
    rate: (D, city, pc) => (pc && pc.treasury != null ? Rules.rate(D, city, pc) : 100),
    wageNow(D, st, prof, city, now, pc){
      const P = D.profs[prof]; if (!P) return 0;
      const L = Rules.lvl(D, st.skills?.[prof] | 0), C = D.cities[city];
      const g0 = Rules.g100(D, prof, L, Rules.buffP(D, st, now), pc?.wage_k ?? 100), g = Math.floor(g0 * ui.rate(D, city, pc) / 100);
      return (g - Math.floor(g * (C?.tax?.income || 0) / 100)) / 100;
    },
    trialNote(){
      if (api.mode === 'server') return '';
      return api.why === 'nosql' ? '🏦 Банк города появится, когда сайт обновится. Пока — 🧪 пробные денки: только в этом браузере, не переносятся.'
        : api.why === 'net' ? '📡 Нет связи с банком — пока 🧪 пробные денки (только в этом браузере).'
        : '🧪 Пробные денки — только в этом браузере. Войди, чтобы зарплата копилась в аккаунте.';
    },
  };
  const H_KIND = { grant: ['🎁', 'Подарок новичку'], wage: ['🧰', 'Зарплата'], food: ['🛍️', 'Покупка'], adm: ['🛠', 'Поправка'] };

  // ═══ 📱 «🏦 Банк» (приложение телефона; phone.js → APPS, мод econ) ═══
  function bankApp(el, arg){
    const P = root.D37Phone, e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    ensureCss();
    el.innerHTML = P.head('🏦 Банк') + '<div class="ph-body eco-bank"><div class="ph-load"><i></i>Загружаем…</div></div>';
    const b = el.querySelector('.ph-body');
    let alive = true;
    const draw = (hist) => {
      if (!alive) return;
      const D = api.D, st = api.st, now = api.clock(), today = st.day === Rules.day(now);
      const bf = Rules.buffP(D, st, now), bu = st.buffs?.food;
      const profs = Object.keys(D.profs).filter(p => (st.skills?.[p] | 0) > 0);
      const note = ui.trialNote();
      const isAdm = typeof currentRole !== 'undefined' && (currentRole === 'admin' || currentRole === 'moderator');
      b.innerHTML = `${note ? `<div class="eco-note">${e(note)}</div>` : ''}
        <div class="eco-bal"><span>💵</span><b>${fmt(st.cash)}</b><small>денки${api.mode === 'server' ? '' : ' · пробные'}</small></div>
        <div class="eco-today">Сегодня: заработано <b>${today ? fmt100(st.wd) : 0}</b> из ${fmt(D.caps.wageDay)} 💵<i style="--p:${today ? Math.min(100, st.wd / D.caps.wageDay) : 0}%"></i></div>
        ${bf ? `<div class="eco-buff">🍽 Сыт: +${bf} % к зарплате ещё ${Math.max(1, Math.ceil((bu.u - now) / 60))} мин</div>` : ''}
        ${Object.keys(st.food || {}).length ? `<div class="eco-buff">🎒 В кармане: ${Object.entries(st.food).map(([k, n]) => `${(GOODS[k] || {}).e || '🍽'}×${n}`).join(' ')} — съесть: 🎬 «Действия»</div>` : ''}
        <div class="ph-sec">Навыки</div>
        ${profs.length ? `<div class="ph-list">${profs.map(p => { const s = ui.skill(D, st, p), I = PROFS[p] || {}; return `<div class="ph-item eco-sk"><span class="eco-ic">${I.e || '🧰'}</span><span><b>${e(I.n || p)} <em>${ui.stars(s.L)}</em></b><small>${e(s.name)} · ${s.next ? `${s.xp}/${s.next}` : s.xp + ' — максимум'}${s.today ? ` · сегодня ${s.today}` : ''}</small><i class="eco-bar" style="--p:${s.pct}%"></i></span></div>`; }).join('')}</div>`
          : '<div class="ph-dim eco-pad">Пока нет — выбери работу на щите «🧰 Работа» в городе «Мира Денчика».</div>'}
        <div class="ph-sec">История</div>
        ${hist && hist.length ? `<div class="ph-list">${hist.map(h => { const K = H_KIND[h.k] || ['💵', h.k], nm = h.k === 'wage' ? (PROFS[h.r]?.n || h.r) : h.k === 'food' ? ((GOODS[h.r]?.e || '') + ' ' + (GOODS[h.r]?.n || h.r)) : h.k === 'adm' ? 'Поправка' : K[1]; return `<div class="ph-item eco-h"><span class="eco-ic">${K[0]}</span><span><b>${e(nm)}</b><small>${h.c === 'metro' ? '🏙️' : '🧸'}${h.f ? ` · налог ${fmt100(h.f)}` : ''}</small></span><time>${new Date(h.t * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time><b class="${h.a < 0 ? 'eco-m' : 'eco-p'}">${h.a < 0 ? '−' : '+'}${fmt(Math.abs(h.a))}</b></div>`; }).join('')}</div>`
          : '<div class="ph-dim eco-pad">Здесь будут зарплаты и покупки.</div>'}
        <div class="ph-row eco-pad"><a class="ph-btn" href="#/games/world">🌍 В мир — работать</a>${isAdm ? '<button type="button" class="ph-chip" data-eco="adm">📊 Экономика города</button>' : ''}</div>`;
    };
    b.addEventListener('click', ev => { if (ev.target.closest('[data-eco="adm"]') && typeof root.openCityEconomy === 'function') root.openCityEconomy(); });
    api.init().then(() => api.history()).then(draw, () => draw([]));
    const off = api.on('state', () => api.history().then(draw));
    return () => { alive = false; off(); };
  }
  function ensureCss(){
    if (typeof document === 'undefined' || document.getElementById('ecoCss')) return;
    const s = document.createElement('style'); s.id = 'ecoCss';
    s.textContent = `.eco-note{margin:4px 2px 10px;padding:9px 11px;border-radius:12px;background:rgba(250,204,21,.12);border:1px solid rgba(250,204,21,.35);font-size:12.5px;line-height:1.45}
.eco-bal{display:flex;align-items:baseline;gap:8px;padding:8px 6px 2px}.eco-bal span{font-size:26px}.eco-bal b{font:900 34px/1 Montserrat,sans-serif}.eco-bal small{color:var(--muted);font-weight:700}
.eco-today{position:relative;margin:6px 6px 4px;padding-bottom:9px;font-size:12.5px;color:var(--muted)}.eco-today b{color:var(--text)}
.eco-today i,.eco-bar{display:block;height:5px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;position:relative;margin-top:5px}
.eco-today i::after,.eco-bar::after{content:'';position:absolute;inset:0;width:var(--p);background:linear-gradient(90deg,#facc15,#4ade80)}
.eco-buff{margin:4px 6px;font-size:12.5px}.eco-ic{font-size:22px;width:30px;text-align:center;flex:none}.eco-sk>span:nth-child(2),.eco-h>span:nth-child(2){flex:1;min-width:0;display:flex;flex-direction:column}
.eco-sk em{font-style:normal;color:#facc15;font-size:12px}.eco-p{color:#4ade80;flex:none}.eco-m{color:#f87171;flex:none}.eco-pad{padding:8px 6px}`;
    document.head.appendChild(s);
  }

  root.MirEcon = {
    V, START, CITIES, PROFS, GOODS, SKILL, CAPS, BUFF, BANK, RATE, SITE, KEEP, CFGK, SERVER,
    Rules, TaskRunner, rng, merge, cfgOk, api, ui, WHY, why, fmt, fmt100, bankApp,
    get sv(){ return api.mode === 'server' ? api.sv : 0; },
    get D(){ return api.D; },
  };
  if (root.D37Phone?.define) root.D37Phone.define('bank', { title: 'Банк', render: bankApp });
})();
