// 👥 Приглашения друзей 2.0 — без браузера: код (генерация, разбор), ловля кода из ссылки (SPA — js/core/ref.js и серверные страницы —
// REF_HEAD в api/_lib/page.js ведут себя одинаково), срок 30 дней и первое касание, вход любым способом (почта — зеркало d37_ref,
// Google/VK/Telegram… — ref_claim после входа), «позвать в игру» (wrap), «Поделиться», QR-код (js/core/qr.js: коды Рида — Соломона,
// формат, версия; есть Python + OpenCV — ещё и расшифровка настоящим декодером), числа клиента = сервера (referrals2.sql), вещи
// «за друзей» в avatar.js, страница /r/<код> (api/_lib/routes/ref.js), страница #/invite (js/features/invite.js).
// Запуск из корня сайта: node scripts/referral-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os'), cp = require('child_process'), { pathToFileURL } = require('url');
const SITE = path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(SITE, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('✗', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); } };
const DAY = 864e5;

// ── Окружение браузера: localStorage, location, history, время; window === глобальный объект ──
function env(href, o = {}){
  const store = { ...(o.store || {}) };
  const clock = { t: o.t || Date.UTC(2026, 9, 15, 12) };
  class FakeDate extends Date { constructor(...a){ super(...(a.length ? a : [clock.t])); } static now(){ return clock.t; } }
  const loc = { u: new URL(href) };
  const ctx = {
    URL, URLSearchParams, Math, JSON, Promise, console, TextEncoder, Uint8Array, Map, Set, Number, String, Object, Array, RegExp, Error,
    encodeURIComponent, decodeURIComponent, unescape, Date: FakeDate,
    setTimeout: o.timers ? setTimeout : () => 0, clearTimeout: () => {},
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { get href(){ return loc.u.href; }, get origin(){ return loc.u.origin; }, get search(){ return loc.u.search; }, get hash(){ return loc.u.hash; }, get pathname(){ return loc.u.pathname; } },
    history: { state: null, calls: 0, replaceState(s, t, u){ loc.u = new URL(u, loc.u.href); this.calls++; } },
    crypto: require('crypto').webcrypto, listeners: {},
  };
  ctx.addEventListener = (t, f) => { (ctx.listeners[t] = ctx.listeners[t] || []).push(f); };
  ctx.dispatchEvent = e => { (ctx.listeners[e.type] || []).forEach(f => f(e)); };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  return { ctx, store, clock, url: () => loc.u.href, run: code => vm.runInContext(code, ctx) };
}
const REF = src('js/core/ref.js');
function spa(href, o){ const e = env(href, o); e.run(REF); e.R = e.ctx.D37Ref; return e; }
const stored = e => { try { const r = JSON.parse(e.store.d37_ref2 || 'null'); if (r) delete r.t; return r; } catch (x) { return 'bad'; } };

(async () => {
  // ═══ 1. Код: генерация и разбор ═══
  {
    const e = spa('https://dan4ik37.vercel.app/'), R = e.R;
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const codes = Array.from({ length: 3000 }, () => R.gen(rnd));
    ok(codes.every(c => R.valid(c) && c.length === 6 && !/[aeiouylx01]/.test(c)), 'генератор: 6 знаков, без гласных, l, x, 0, 1');
    ok(codes.every(c => !/(pzd|fck|fkn|bdsm|kkk|ss|wtf|gvn)/.test(c)), 'генератор: без плохих сочетаний');
    ok(new Set(codes).size > 2990, 'генератор: коды почти не повторяются', new Set(codes).size);
    ok(new Set(codes.join('')).size === R.ALPHABET.length, 'генератор: весь алфавит в ходу (26 знаков)');
    const P = s => JSON.stringify(R.parse(s));
    ok(P('k7m2qz') === '{"c":"k7m2qz","k":"code"}', 'разбор: код');
    ok(P('  K7M-2QZ ') === '{"c":"k7m2qz","k":"code"}' && P('k7m 2qz') === '{"c":"k7m2qz","k":"code"}', 'разбор: регистр, пробелы и дефис не мешают');
    ok(P('https://dan4ik37.vercel.app/r/K7M2QZ?to=games%2Fchess') === '{"c":"k7m2qz","k":"code"}', 'разбор: ссылка /r/<код>');
    ok(P('https://dan4ik37.vercel.app/games/chess?ref=bcd234&s=5') === '{"c":"bcd234","k":"code"}', 'разбор: ?ref= в ссылке');
    ok(P('Вася') === '{"c":"вася","k":"nick"}' && P('?ref=%D0%92%D0%B0%D1%81%D1%8F') === '{"c":"вася","k":"nick"}', 'разбор: старый ник (кириллица, из ссылки)');
    ok(R.parse('') === null && R.parse('<script>') === null && R.parse('a'.repeat(25)) === null && R.parse(null) === null, 'разбор: мусор — null');
    ok(R.sourceOf('games/chess/abcd') === 'room' && R.sourceOf('games/horde/coop/ab12cd') === 'room' && R.sourceOf('games/world') === 'world'
      && R.sourceOf('games/studio3d/play/x1') === 'studio' && R.sourceOf('g/abc') === 'studio' && R.sourceOf('games/chess') === 'game'
      && R.sourceOf('v/abcdefghijk') === 'video' && R.sourceOf('c/abcdef') === 'community' && R.sourceOf('') === 'link', 'откуда: комната, мир, студия, игра, ролик, сообщество');
  }

  // ═══ 2. Ловля кода: SPA = серверные страницы; первое касание, 30 дней, свой код, адрес чистится ═══
  const pageMod = await (async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd37-ref-api-'));
    fs.cpSync(path.join(SITE, 'api'), path.join(tmp, 'api'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
    return { tmp, page: await import(pathToFileURL(path.join(tmp, 'api/_lib/page.js')).href) };
  })();
  const HEAD = /^<script>([\s\S]+)<\/script>$/.exec(pageMod.page.REF_HEAD)[1];
  ok(!/birth|d37_age/.test(pageMod.page.REF_HEAD), 'REF_HEAD не трогает возраст');
  function head(href, o){ const e = env(href, o); e.run(HEAD); return e; }
  const CASES = [
    ['комната в игре', 'https://dan4ik37.vercel.app/?ref=K7M2QZ#/games/chess/abcd', 'https://dan4ik37.vercel.app/#/games/chess/abcd'],
    ['страница игры', 'https://dan4ik37.vercel.app/games/chess?s=12&ref=k7m2qz', 'https://dan4ik37.vercel.app/games/chess?s=12'],
    ['игра игрока /g/', 'https://dan4ik37.vercel.app/g/AbC123?ref=k7m2qz', 'https://dan4ik37.vercel.app/g/AbC123'],
    ['ролик /v/', 'https://dan4ik37.vercel.app/v/dQw4w9WgXcQ?ref=k7m2qz', 'https://dan4ik37.vercel.app/v/dQw4w9WgXcQ'],
    ['сообщество /c/', 'https://dan4ik37.vercel.app/c/abcdef?ref=k7m2qz', 'https://dan4ik37.vercel.app/c/abcdef'],
    ['старый ник', 'https://dan4ik37.vercel.app/?ref=%D0%92%D0%B0%D1%81%D1%8F', 'https://dan4ik37.vercel.app/'],
    ['мусор', 'https://dan4ik37.vercel.app/?ref=%3Cscript%3E&x=1#/home', 'https://dan4ik37.vercel.app/?x=1#/home'],
    ['без ref', 'https://dan4ik37.vercel.app/#/home', 'https://dan4ik37.vercel.app/#/home'],
  ];
  for (const [name, href, clean] of CASES) {
    const a = spa(href), b = head(href);
    ok(JSON.stringify(stored(a)) === JSON.stringify(stored(b)), 'SPA = серверная страница: ' + name, [stored(a), stored(b)]);
    ok(a.url() === clean && b.url() === clean, 'адрес почищен от ?ref=: ' + name, [a.url(), b.url()]);
    if (name !== 'мусор' && name !== 'без ref') ok(a.store.d37_ref === stored(a)?.c, 'зеркало d37_ref (его читает регистрация по почте): ' + name);
  }
  ok(JSON.stringify(stored(spa(CASES[0][1]))) === '{"c":"k7m2qz","k":"code","s":"room","p":"games/chess/abcd"}', 'записано: код, откуда (room) и куда звали');
  ok(stored(spa(CASES[1][1])).s === 'game' && stored(spa(CASES[2][1])).s === 'studio' && stored(spa(CASES[3][1])).s === 'video' && stored(spa(CASES[4][1])).s === 'community', 'откуда: игра, студия, ролик, сообщество');
  for (const [label, mk] of [['SPA', spa], ['серверная страница', head]]) {
    const first = mk('https://dan4ik37.vercel.app/?ref=k7m2qz');
    const t0 = first.clock.t;
    const second = mk('https://dan4ik37.vercel.app/?ref=bcd234', { store: first.store, t: t0 + 10 * DAY });
    ok(stored(second).c === 'k7m2qz' && second.store.d37_ref === 'k7m2qz', label + ': первое касание — чужая ссылка позже не перебивает');
    const third = mk('https://dan4ik37.vercel.app/?ref=bcd234', { store: second.store, t: t0 + 31 * DAY });
    ok(stored(third).c === 'bcd234', label + ': через 30 дней — новая ссылка');
    const mine = mk('https://dan4ik37.vercel.app/?ref=k7m2qz', { store: { d37_ref_my: JSON.stringify({ u: 'me', c: 'k7m2qz' }) } });
    ok(stored(mine) === null, label + ': свой код не записывается');
  }
  {
    const a = spa('https://dan4ik37.vercel.app/?ref=k7m2qz'), t0 = a.clock.t;
    const late = spa('https://dan4ik37.vercel.app/#/home', { store: a.store, t: t0 + 30 * DAY + 1 });
    ok(late.R.pending() === null && !('d37_ref' in late.store) && !('d37_ref2' in late.store), 'через 30 дней код сам стирается (и зеркало)');
    const fresh = spa('https://dan4ik37.vercel.app/#/home', { store: a.store, t: t0 + 29 * DAY });
    ok(fresh.R.code() === 'k7m2qz', 'через 29 дней — ещё ждёт');
    const future = spa('https://dan4ik37.vercel.app/#/home', { store: { d37_ref2: JSON.stringify({ c: 'k7m2qz', k: 'code', t: t0 + 5 * DAY }) }, t: t0 });
    ok(future.R.pending() === null, 'запись «из будущего» (часы перевели) — не верим');
  }
  // /r/<код>: d37RefStore — то же правило
  {
    const e = head('https://dan4ik37.vercel.app/r/k7m2qz');
    e.run(`d37RefStore('k7m2qz', 'link', 'games/world')`);
    ok(JSON.stringify(stored(e)) === '{"c":"k7m2qz","k":"code","s":"link","p":"games/world"}', '/r/<код>: d37RefStore записывает код и «куда»');
    e.run(`d37RefStore('bcd234', 'link', '')`);
    ok(stored(e).c === 'k7m2qz', '/r/<код>: первое касание');
  }

  // ═══ 3. Вход любым способом: почта (метаданные), Google/VK/Telegram (ref_claim после входа) ═══
  function withSb(e, answers){
    const calls = [];
    e.ctx.sbClient = { rpc: async (name, args) => { calls.push([name, args]); const a = answers[name]; return typeof a === 'function' ? a(args) : (a || { data: null, error: null }); } };
    return calls;
  }
  {
    const e = spa('https://dan4ik37.vercel.app/?ref=k7m2qz#/games/chess/abcd');
    ok(e.store.d37_ref === 'k7m2qz', 'почта: global-auth.js отдаст код в метаданные регистрации (зеркало d37_ref)');
    // OAuth: ушёл на Google и вернулся — localStorage тот же; d37:auth → ref_claim
    const events = []; e.R.on((t, d) => events.push([t, d]));
    const calls = withSb(e, { ref_claim: { data: { ok: true, already: false, inviter: 'Vasya', gift: { lv: 3, coins: 50 } }, error: null },
      ref_ping: { data: { ok: true, code: 'mnp234' }, error: null } });
    e.ctx.currentUser = { id: 'u1' };
    e.ctx.dispatchEvent({ type: 'd37:auth' });
    await new Promise(r => setTimeout(r, 20));
    const cl = calls.find(c => c[0] === 'ref_claim');
    ok(cl && cl[1].p_code === 'k7m2qz' && cl[1].p_src === 'room' && cl[1].p_place === 'games/chess/abcd' && /^[A-Za-z0-9_-]{24}$/.test(cl[1].p_dev), 'Google/VK/Telegram: после входа — ref_claim с кодом, откуда/куда и ключом браузера', cl);
    ok(e.R.pending() === null && e.store.d37_ref_done === 'u1' && !('d37_ref' in e.store), 'ответ окончательный — код стёрт');
    ok(events.some(([t, d]) => t === 'claim' && d.inviter === 'Vasya'), 'страница узнала: «тебя позвал Vasya»');
    ok(calls.some(c => c[0] === 'ref_ping' && c[1].p_active === false) && JSON.parse(e.store.d37_ref_my).c === 'mnp234', 'раз в день — ref_ping: свой код запомнен');
    const n = calls.length;
    await e.R.afterAuth();
    ok(calls.length === n, 'второй вход в тот же день — ничего лишнего');
    // свой код в ссылках «позвать»
    ok(e.R.wrap('https://dan4ik37.vercel.app/#/games/chess/xyz1') === 'https://dan4ik37.vercel.app/?ref=mnp234#/games/chess/xyz1', 'wrap: комната — с моим кодом');
    ok(e.R.wrap('https://dan4ik37.vercel.app/g/AbC123') === 'https://dan4ik37.vercel.app/g/AbC123?ref=mnp234', 'wrap: игра игрока /g/');
    ok(e.R.wrap('https://dan4ik37.vercel.app/games/chess?s=5&n=x') === 'https://dan4ik37.vercel.app/games/chess?s=5&n=x&ref=mnp234', 'wrap: «Вызов» с рекордом');
    ok(e.R.wrap('https://example.com/x') === 'https://example.com/x' && e.R.wrap('https://dan4ik37.vercel.app/?ref=bcd234') === 'https://dan4ik37.vercel.app/?ref=bcd234'
      && e.R.wrap('https://dan4ik37.vercel.app/r/mnp234') === 'https://dan4ik37.vercel.app/r/mnp234', 'wrap: чужой сайт, уже с ref, /r/ — как есть');
    await new Promise(r => setTimeout(r, 10));
    ok(calls.filter(c => c[0] === 'ref_ping' && c[1].p_active === true).length === 1, 'поделился — один ref_ping(p_active) в день (сервер запомнит IP/устройство)');
    e.ctx.currentUser = { id: 'u2' };
    ok(e.R.wrap('https://dan4ik37.vercel.app/#/games/world') === 'https://dan4ik37.vercel.app/#/games/world', 'wrap: другой аккаунт — без чужого кода');
  }
  {
    // social-login.js: новый аккаунт любым способом → d37:signup { provider, userId } (currentUser мог ещё не встать)
    const e = spa('https://dan4ik37.vercel.app/?ref=k7m2qz#/home');
    let resolveClaim;
    const calls = withSb(e, { ref_claim: () => new Promise(r => { resolveClaim = () => r({ data: { ok: true, already: false, inviter: 'Vasya' }, error: null }); }),
      ref_ping: { data: { ok: true, code: 'qrs234' }, error: null } });
    e.ctx.dispatchEvent({ type: 'd37:signup', detail: { provider: 'vk', userId: 'u9' } });
    e.ctx.currentUser = { id: 'u9' };
    e.ctx.dispatchEvent({ type: 'd37:auth' });   // пришло почти одновременно — второй раз не спрашиваем
    await new Promise(r => setTimeout(r, 10));
    resolveClaim && resolveClaim();
    await new Promise(r => setTimeout(r, 30));
    ok(calls.filter(c => c[0] === 'ref_claim').length === 1 && e.store.d37_ref_done === 'u9' && e.R.pending() === null, 'd37:signup (VK, Яндекс, Telegram…): привязка сразу, один раз — даже если d37:auth пришёл рядом', calls.map(c => c[0]));
    ok(!('d37_oauth' in e.store) && !Object.keys(e.store).some(k => /^d37_signup_|^d37_login_fails/.test(k)), 'ключи входа (d37_oauth, d37_signup_*, d37_login_fails) не трогаем');
  }
  {
    // referrals2.sql ещё не запущен — код ждёт (не теряем)
    const e = spa('https://dan4ik37.vercel.app/?ref=k7m2qz');
    withSb(e, { ref_claim: { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }, ref_ping: { data: null, error: { code: 'PGRST202' } } });
    e.ctx.currentUser = { id: 'u3' };
    await e.R.afterAuth();
    ok(e.R.code() === 'k7m2qz' && !e.store.d37_ref_done, 'нет referrals2.sql — код ждёт следующего входа');
    // сеть упала — тоже ждёт
    withSb(e, { ref_claim: { data: null, error: { message: 'Failed to fetch' } } });
    await e.R.afterAuth();
    ok(e.R.code() === 'k7m2qz', 'сеть упала — код ждёт');
    // старый аккаунт — окончательно
    withSb(e, { ref_claim: { data: { ok: false, reason: 'old' }, error: null } });
    await e.R.afterAuth();
    ok(e.R.code() === '' && e.store.d37_ref_done === 'u3', 'старый аккаунт — код стёрт, больше не спрашиваем');
    // код истёк до входа — ref_claim не зовём
    const x = spa('https://dan4ik37.vercel.app/?ref=k7m2qz'), t0 = x.clock.t;
    const y = spa('https://dan4ik37.vercel.app/#/home', { store: x.store, t: t0 + 31 * DAY });
    const calls = withSb(y, {}); y.ctx.currentUser = { id: 'u4' };
    await y.R.afterAuth();
    ok(!calls.some(c => c[0] === 'ref_claim'), 'код истёк до входа — привязки нет');
  }
  {
    // ссылка и «Поделиться»
    const e = spa('https://dan4ik37.vercel.app/#/invite'), R = e.R;
    ok(R.link('k7m2qz') === 'https://dan4ik37.vercel.app/r/k7m2qz' && R.link('k7m2qz', 'games/chess/abcd') === 'https://dan4ik37.vercel.app/r/k7m2qz?to=games%2Fchess%2Fabcd'
      && R.link('k7m2qz', '#/games/world') === 'https://dan4ik37.vercel.app/r/k7m2qz?to=games%2Fworld', 'ссылка: /r/<код> и ?to=<куда>');
    ok(R.link('k7m2qz', '"><script>') === 'https://dan4ik37.vercel.app/r/k7m2qz' && R.link('плохо') === '', 'ссылка: мусор в «куда» отброшен, плохой код — пусто');
    const loc = spa('http://localhost:5558/#/invite');
    ok(loc.R.link('k7m2qz') === 'http://localhost:5558/r/k7m2qz', 'ссылка: свой адрес сайта (локально — localhost)');
    const s = R.shareUrls('https://dan4ik37.vercel.app/r/k7m2qz', 'Залетай & играй 🎁');
    ok(s.tg === 'https://t.me/share/url?url=https%3A%2F%2Fdan4ik37.vercel.app%2Fr%2Fk7m2qz&text=%D0%97%D0%B0%D0%BB%D0%B5%D1%82%D0%B0%D0%B9%20%26%20%D0%B8%D0%B3%D1%80%D0%B0%D0%B9%20%F0%9F%8E%81'
      && s.vk.startsWith('https://vk.com/share.php?url=https%3A%2F%2Fdan4ik37.vercel.app%2Fr%2Fk7m2qz&title=') && s.wa.startsWith('https://wa.me/?text=') && s.wa.endsWith('%20https%3A%2F%2Fdan4ik37.vercel.app%2Fr%2Fk7m2qz'), '«Поделиться»: Telegram, ВКонтакте, WhatsApp', s);
    const d1 = R.device(), d2 = R.device();
    ok(/^[A-Za-z0-9_-]{24}$/.test(d1) && d1 === d2, 'ключ браузера: случайный, один и тот же');
  }

  // ═══ 4. Числа клиента = сервера (referrals2.sql), экономика, вещи «за друзей» ═══
  {
    const sql = src('referrals2.sql');
    const fn = name => { const i = sql.indexOf('create or replace function public.' + name + '('); return sql.slice(i, sql.indexOf('$$;', sql.indexOf('$$', i) + 2)); };
    const e = spa('https://dan4ik37.vercel.app/'), R = e.R;
    const pairs = [...fn('ref_rule').matchAll(/when '([a-z_]+)' then (\d+)/g)].map(m => [m[1], +m[2]]);
    const camel = k => k.replace(/_([a-z])/g, (m, c) => c.toUpperCase());
    ok(pairs.length === 10 && pairs.every(([k, v]) => R.RULES[camel(k)] === v) && Object.keys(R.RULES).length === pairs.length, 'ref_rule = D37Ref.RULES (все 10)', [pairs, R.RULES]);
    const lad = JSON.parse(/select '(\{[\s\S]+?\})'::jsonb/.exec(fn('ref_ladder'))[1]);
    ok(JSON.stringify(lad) === JSON.stringify(JSON.parse(JSON.stringify(R.LADDER))), 'ref_ladder = D37Ref.LADDER', [lad, R.LADDER]);
    ok(lad.m.every(m => ['l3', 'l5', 'l10'].includes(m.id) && m.id === 'l' + m.lv), 'уровни друга — l3/l5/l10 (колонки ref_links)');
    ok(new RegExp(`declare a text := '${R.ALPHABET}'`).test(fn('ref_new_code')) && fn('ref_new_code').includes("c ~ '(pzd|fck|fkn|bdsm|kkk|ss|wtf|gvn)'"), 'ref_new_code: тот же алфавит и стоп-сочетания');
    ok(src('api/_lib/routes/ref.js').includes(`const CODE = /${R.CODE_RE.source}/;`) && HEAD.includes(`C = /${R.CODE_RE.source}/`), '/r/<код> и REF_HEAD: тот же формат кода');
    // экономика: XP за друга = xp_rule('referral') (economy.sql) = XP_NUM.referral (xp.js)
    const xpSum = lad.m.reduce((s, m) => s + (m.xp || 0), 0);
    const eco = /when 'referral' then (\d+)/.exec(src('economy.sql'));
    const xpNum = /referral: (\d+)/.exec(src('js/features/xp.js'));
    ok(eco && +eco[1] === xpSum && xpNum && +xpNum[1] === xpSum, 'XP за друга: 25 + 25 = xp_rule referral (economy.sql) = XP_NUM.referral', [xpSum, eco && eco[1], xpNum && xpNum[1]]);
    ok(lad.w.coins <= 2 * 20 * 2 && lad.m.every(m => (m.coins || 0) <= 100) && lad.t.every(t => (t.coins || 0) <= 500), 'монеты скромные: подарок ≤ двух бонусов дня, за уровень друга ≤ 100, ступень ≤ 500');
    // вещи «за друзей» есть в avatar.js (8-е поле), не продаются
    const av = env('https://dan4ik37.vercel.app/'); av.ctx.document = {}; av.run(src('js/core/avatar.js'));
    const C = av.ctx.D37Char;
    const parts = [lad.w.part, ...lad.t.filter(t => t.part).map(t => t.part)];
    ok(parts.length === 4 && parts.every(p => { const [s, id] = p.split(':'); const q = C.PARTS[s]?.list.find(x => x[0] === id); return q && q[7] === 1 && /\p{Extended_Pictographic}/u.test(q[3] || '') && C.price('skin:' + p) === null && C.refOf('skin:' + p) === 1; }), 'вещи «за друзей» — в PARTS (8-е поле), эмодзи, без цены', parts);
    ok(!src('coins.sql').match(/skin:(trail:confetti|pet:parrot|item:megaphone|trail:fireworks)/), 'coins.sql их не продаёт (char_save наденет выданное)');
    av.ctx.D37Coins = { owns: it => it === 'skin:pet:parrot', perks: () => false, level: () => 1 };
    ok(C.owns('pet', 'parrot') === true && C.owns('trail', 'confetti') === false && C.wearable({ trail: 'confetti', pet: 'parrot' }).trail === 'none', 'носить можно только выданное');
    // сервер: внутреннее закрыто клиенту, нужное открыто
    for (const f of ['ref_pay', 'ref_apply', 'ref_check', 'ref_aff', 'ref_is_kid', 'ref_mark', 'ref_resolve'])
      ok(new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\) from public, anon, authenticated;`).test(sql), 'referrals2.sql: ' + f + ' — только изнутри');
    ok(/grant execute on function public\.ref_public\(text\) to anon, authenticated;/.test(sql) && /grant execute on function public\.ref_me\(text\) to authenticated;/.test(sql), 'referrals2.sql: ref_public — всем, ref_me — вошедшим');
    ok(/drop trigger if exists xp_on_referral on public\.profiles;/.test(sql), 'XP за саму регистрацию убран (xp_on_referral)');
  }

  // ═══ 5. QR-код ═══
  {
    const e = env('https://dan4ik37.vercel.app/'); e.run(src('js/core/qr.js'));
    const Q = e.ctx.D37QR, T = Q._test;
    const FMT_M = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
    ok(FMT_M.every((f, m) => T.formatBits(m).toString(2).padStart(15, '0') === f), 'формат (уровень M, 8 масок) — как в таблице стандарта');
    ok([14, 26, 42, 62, 84, 106, 122, 152, 180, 213].every((c, i) => T.capacity(i + 1) === c), 'вместимость версий 1–10 (M, байты)');
    // коды Рида — Соломона: многочлен блока делится на генератор (все синдромы — ноль)
    const syn = (cw, n) => { for (let i = 0; i < n; i++) { let s = 0; for (const c of cw) s = T.mul(s, T.EXP[i]) ^ c; if (s) return false; } return true; };
    let rsOk = true;
    for (let k = 0; k < 40; k++) { const d = Array.from({ length: 30 }, (_, i) => (i * 37 + k * 11) & 255); if (!syn([...d, ...T.rsEncode(d, 16)], 16)) rsOk = false; }
    ok(rsOk, 'коды коррекции: синдромы — ноль');
    const verInfo = v => { let rem = v; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25); return (v << 12) | rem; };
    ok(verInfo(7) === 0x07c94 && verInfo(8) === 0x085bc && verInfo(9) === 0x09a99 && verInfo(10) === 0x0a4d3, 'сведения о версии 7–10 — как в стандарте');
    const texts = ['https://dan4ik37.vercel.app/r/k7m2qz', 'https://dan4ik37.vercel.app/r/k7m2qz?to=games%2Fchess%2Fabcd', 'Привет, это Денчик37! 🎁',
      'x', 'https://dan4ik37.vercel.app/r/k7m2qz?to=games%2Fstudio3d%2Fplay%2Fabcdefghijkl%2Fqwerty1234567890abcdefghij1234567890' + 'z'.repeat(60), 'https://dan4ik37.vercel.app/r/k7m2qz?to=' + 'q'.repeat(171)];
    const qs = texts.map(t => Q.make(t));
    ok(qs.every(q => q && q.size === 17 + 4 * q.version && q.mask >= 0 && q.mask < 8), 'make: размер по версии, маска 0–7', qs.map(q => q && [q.version, q.mask]));
    ok(qs[0].version === 3 && qs[4].version >= 7 && qs[5].version === 10, 'короткая ссылка — версия 3, длинные — 9 и 10 (блок версии, блоки разной длины)', qs.map(q => q.version));
    ok(Q.make('я'.repeat(200)) === null, 'слишком длинно — null');
    const finderOk = q => { const f = (x0, y0) => { for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) { const d = Math.max(Math.abs(x - 3), Math.abs(y - 3)); if (q.dark(x0 + x, y0 + y) !== (d !== 2)) return false; } return true; };
      return f(0, 0) && f(q.size - 7, 0) && f(0, q.size - 7); };
    ok(qs.every(finderOk), 'три искателя по углам');
    ok(qs.every(q => { for (let i = 8; i < q.size - 8; i++) if (q.dark(i, 6) !== (i % 2 === 0) || q.dark(6, i) !== (i % 2 === 0)) return false; return q.dark(8, q.size - 8); }), 'полосы синхронизации и тёмный модуль');
    const svg = Q.svg(texts[0], { px: 4, margin: 2 });
    ok(/^<svg [^>]*viewBox="0 0 33 33"[^>]*>/.test(svg) && svg.includes('<path d="M') && svg.includes('role="img"'), 'svg: картинка с рамкой', svg.slice(0, 120));
    // настоящий декодер (если есть Python + OpenCV)
    const py = cp.spawnSync('python', ['-c', 'import cv2;print(cv2.__version__)'], { encoding: 'utf8' });
    if (py.status === 0) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd37-qr-'));
      texts.forEach((t, i) => {
        const q = qs[i], s = 8, m = 4, n = (q.size + 2 * m) * s, buf = Buffer.alloc(n * n, 255);
        for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.dark(x, y)) for (let dy = 0; dy < s; dy++) buf.fill(0, ((y + m) * s + dy) * n + (x + m) * s, ((y + m) * s + dy) * n + (x + m + 1) * s);
        fs.writeFileSync(path.join(dir, i + '.pgm'), Buffer.concat([Buffer.from(`P5\n${n} ${n}\n255\n`), buf]));
      });
      // два декодера OpenCV: обычный иногда не находит код (это его слабость: тот же код читает второй и камеры телефонов)
      const code = ['import cv2,sys,json', 'ds=[cv2.QRCodeDetector()]+([cv2.QRCodeDetectorAruco()] if hasattr(cv2,"QRCodeDetectorAruco") else [])', 'out=[]',
        `for i in range(${texts.length}):`, '  img=cv2.imread(sys.argv[1]+"/"+str(i)+".pgm",0)', '  got=""',
        '  for d in ds:', '    t,_,_=d.detectAndDecode(img)', '    if t: got=t; break', '  out.append(got)', 'print(json.dumps(out))'].join('\n');
      fs.writeFileSync(path.join(dir, 'dec.py'), code);
      const r = cp.spawnSync('python', ['-X', 'utf8', path.join(dir, 'dec.py'), dir], { encoding: 'utf8' });
      let got = null; try { got = JSON.parse(r.stdout.trim().split('\n').pop()); } catch (x) {}
      ok(got && got.every((t, i) => t === texts[i]), 'OpenCV расшифровал все QR-коды (ссылки, кириллица, эмодзи, версия 7+)', got || r.stderr.slice(0, 300));
      console.log('  QR: OpenCV ' + py.stdout.trim() + ' — расшифровано ' + (got ? got.filter((t, i) => t === texts[i]).length : 0) + ' из ' + texts.length);
    } else console.log('  QR: Python + OpenCV не найден — расшифровка настоящим декодером пропущена');
  }

  // ═══ 6. Страница /r/<код> ═══
  {
    const mod = await import(pathToFileURL(path.join(pageMod.tmp, 'api/_lib/routes/ref.js')).href);
    const call = async (q, fetchAns) => {
      const res = { code: 0, h: {}, body: '', status(c){ this.code = c; return this; }, setHeader(k, v){ this.h[k.toLowerCase()] = v; return this; }, send(b){ this.body = b; } };
      const saved = { ...process.env }, oldFetch = global.fetch;
      if (fetchAns) { process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(fetchAns) }); }
      try { await mod.default({ query: q }, res); } finally { process.env = saved; global.fetch = oldFetch; }
      return res;
    };
    let r = await call({ code: 'k7m2qz' });
    ok(r.code === 200 && r.body.includes('<meta name="robots" content="noindex">') && r.body.includes('/img/share/invite.png') && r.body.includes('d37RefStore("k7m2qz","link","")') && !r.body.includes('location.replace'),
      '/r/<код>: страница-приглашение (noindex, превью, код в браузер, без перехода)', r.body.slice(0, 200));
    ok(!r.body.includes('pagead2.googlesyndication.com') && r.body.includes('function refHead'), '/r/<код>: без рекламы; ловля кода — в <head>');
    r = await call({ code: 'K7M2QZ', to: 'games/chess/abcd' });
    ok(r.code === 200 && r.body.includes('location.replace("/?ref=k7m2qz#/games/chess/abcd")') && r.body.includes('«Шахматы»') && r.body.includes('d37RefStore("k7m2qz","link","games/chess/abcd")'), '/r/<код>?to=… — сразу в комнату игры (и «Шахматы» в превью)');
    r = await call({ code: 'k7m2qz', to: '"><script>alert(1)</script>' });
    ok(r.code === 200 && !r.body.includes('<script>alert') && !r.body.includes('location.replace'), '/r/<код>: мусор в «куда» отброшен');
    r = await call({ code: 'плохо' });
    ok(r.code === 404 && r.body.includes('Приглашение не найдено'), '/r/<плохой код> — 404');
    r = await call({ code: 'k7m2qz' }, { ok: true, nick: 'Vasya', gift: { lv: 3, coins: 50, text: 'След «Конфетти»' } });
    ok(r.code === 200 && r.body.includes('<title>Vasya зовёт тебя на сайт Денчика37</title>') && r.body.includes('og:title'), '/r/<код>: ник пригласившего в заголовке и превью');
    r = await call({ code: 'k7m2qz' }, { ok: true, nick: null, gift: { lv: 3, coins: 50, text: 'След «Конфетти»' } });
    ok(r.body.includes('<title>Тебя зовут на сайт Денчика37</title>'), '/r/<код>: ник ребёнка не показываем (сервер отдал null)');
    r = await call({ code: 'k7m2qz' }, { ok: false, reason: 'not_found' });
    ok(r.code === 404, '/r/<неизвестный код> — 404');
    const pages = src('api/pages.js'), vj = JSON.parse(src('vercel.json'));
    ok(/r: ref[,\s}]/.test(pages) && vj.rewrites.some(x => x.source === '/r/:code' && x.destination === '/api/pages?page=r&code=:code'), 'маршрут /r/:code → api/pages.js (новой функции нет)');
    ok(fs.readdirSync(path.join(SITE, 'api')).filter(f => f.endsWith('.js')).length <= 12, 'функций Vercel — не больше 12');
    ok(fs.existsSync(path.join(SITE, 'img/share/invite.png')), 'картинка превью img/share/invite.png');
  }

  // ═══ 7. Страница #/invite (js/features/invite.js) — разметка без браузера ═══
  {
    const e = spa('https://dan4ik37.vercel.app/#/invite');
    const doc = { body: { classList: { contains: () => false } }, getElementById: () => null, createElement: () => ({ setAttribute(){}, classList: { add(){}, remove(){} }, style: {} }), head: { appendChild(){} } };
    Object.assign(e.ctx, { document: doc, navigator: {}, sessionStorage: e.ctx.localStorage, GAMES: [{ id: 'chess', icon: '♟️', title: 'Шахматы' }, { id: 'world', icon: '🌍', title: 'Мир' }],
      requestAnimationFrame: () => 0, currentUser: null, currentRole: null, currentProfile: null });
    e.ctx.D37Age = { kid: () => false };
    e.run(src('js/core/avatar.js'));
    e.run(src('js/features/invite.js'));
    const I = e.ctx.D37Invite, ST = I.state();
    let h = I._test.page();
    ok(h.includes('Создать профиль') && !h.includes('rfUrl') && h.includes('Топ пригласивших') && h.includes('Как это работает'), 'гость: зовём войти, ссылки нет, топ и правила — есть');
    ok(h.includes('3 уровень') && h.includes('+25 XP и +30 🪙') && h.includes('+100 🪙'), 'гость: награды за уровни друга');
    e.ctx.currentUser = { id: 'u1' }; e.ctx.currentProfile = { nick: 'Vasya' };
    Object.assign(ST, { me: { ok: true, code: 'k7m2qz', hide_top: false, frame_on: true, frame: true, stats: { joined: 7, l3: 6, l5: 5, l10: 1, hold: 0, week: 2 },
      earned: { xp: 225, coins: 450, gems: 500, held: 3, items: ['skin:pet:parrot', 'skin:item:megaphone'] }, month: { gems: 120, cap: 500 }, tiers: ['t1', 't2', 't3'],
      list: [{ nick: 'GoogleGuy', lv: 13, st: 'ok', m: { l3: true, l5: true, l10: true }, id: 'g1', at: '2026-10-15T09:00:00Z' }, { nick: 'Malysh', lv: 3, st: 'ok', m: { l3: true, l5: false, l10: false }, hid: true },
        { nick: 'Dvoinik', lv: 3, st: 'no', m: { l3: true, l5: false, l10: false } }], invited: null }, off: false, err: false, place: '' });
    h = I._test.page();
    ok(h.includes('value="https://dan4ik37.vercel.app/r/k7m2qz"') && h.includes('data-a="tg"') && h.includes('data-a="vk"') && h.includes('data-a="wa"') && h.includes('data-a="qr"') && h.includes('data-a="copy"'), 'вошёл: ссылка /r/<код>, Telegram, ВК, WhatsApp, QR, «Скопировать»');
    ok(h.includes('id="rfPlace"') && h.includes('value="games/chess"') && h.includes('🌍 Мир Денчика'), '«Куда позвать»: мир и игры');
    ok(h.includes('🏆 Все ступени пройдены') === false && h.includes('След «Салют»') && h.includes('1 из 10'), 'ступени: следующая — «Салют», 1 из 10 друзей до 10 ур.');
    ok(h.includes('💎 Бонус за поддержку') && h.includes('120 из 500'), 'бонус за поддержку: 120 из 500 в этом месяце');
    ok(h.includes('href="#/profile/g1"') && h.includes('🔒') && h.includes('🚫 не засчитан') && !h.includes('#/profile/undefined'), 'мои приглашения: открытый — ссылка, скрытый — 🔒, не засчитан — 🚫');
    ok(h.includes('Попугай') && h.includes('Мегафон') && h.includes('Рамка «Посол» вместо рамки уровня'), 'заработанное: вещи и переключатель рамки');
    ok(h.includes('3 награды ждут'), 'отложенные награды — видно');
    ST.place = 'games/chess';
    ok(I.myLink() === 'https://dan4ik37.vercel.app/r/k7m2qz?to=games%2Fchess' && /«Шахматы»/.test(I.shareText()), '«Куда позвать»: игра → ссылка ?to= и текст «Сыграй со мной в «Шахматы»»');
    ST.place = '';
    e.ctx.D37Age = { kid: () => true };
    h = I._test.page();
    ok(!h.includes('💎 Бонус за поддержку') && !h.includes('кристаллов 💎 твои') && !h.includes('Бонус за поддержку — как это?'), 'ребёнку — без «бонуса за поддержку»');
    e.ctx.D37Age = { kid: () => false };
    Object.assign(ST, { me: null, off: true });
    h = I._test.page();
    ok(h.includes('value="https://dan4ik37.vercel.app/?ref=Vasya"') && h.includes('появятся, когда сайт обновится'), 'без referrals2.sql: временная ссылка ?ref=<ник> и честное «скоро»');
    // окно входа: «Тебя пригласил(а) <ник>» над «Войти через…» (#gauthRef)
    const box = { hidden: true, innerHTML: '' };
    e.ctx.document.getElementById = id => (id === 'gauthRef' ? box : null);
    e.ctx.currentUser = null;
    e.store.d37_ref2 = JSON.stringify({ c: 'k7m2qz', k: 'code', t: e.clock.t, s: 'link', p: '' });
    e.ctx.sbClient = { rpc: async n => (n === 'ref_public' ? { data: { ok: true, nick: 'Vasya' }, error: null } : { data: null, error: { code: 'PGRST202' } }) };
    await I._test.authLine();
    ok(!box.hidden && box.innerHTML.includes('Тебя пригласил(а) <b>Vasya</b>') && box.innerHTML.includes('50 🪙'), 'окно входа: «🎁 Тебя пригласил(а) Vasya» и подарок', box.innerHTML);
    e.ctx.currentUser = { id: 'u1' };
    await I._test.authLine();
    ok(box.hidden, 'вошёл — строки в окне входа нет');
  }

  fs.rmSync(pageMod.tmp, { recursive: true, force: true });
  console.log(`\nreferral-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
