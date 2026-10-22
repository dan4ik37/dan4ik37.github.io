// ops.sql (мониторинг ошибок сайта, T-016) на PGlite с заглушками живой базы Supabase: роли anon / authenticated / service_role,
// auth.uid() через request.jwt.claim.sub, profiles(id, role), права по умолчанию «всем всё» (как у Supabase — файл обязан сам закрыть).
// Проверяет: файл применяется дважды; приём отчётов (только service_role), очистка, счётчики и словари, ключ, потолки дня (stop,
// overflow, rate), уборка старого, сводка админа, действия, права гостя / игрока / админа, RLS, инъекции текстом.
// Запуск из корня сайта: node scripts/ops-sql-test.mjs
// PGlite в репозиторий НЕ кладём. Нет пакета — тест пропускается (код 0), а с OPS_SQL_REQUIRED=1 (так в CI) — падает.
//   npm install --prefix <папка> @electric-sql/pglite    и    PGLITE_PATH=<папка> (или папка пакета)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// пакет ищем по папкам (PGLITE_PATH = папка с node_modules, папка пакета или папка, куда ставили npm install --prefix)
async function findPglite() {
  const cands = [process.env.PGLITE_PATH, path.join(os.tmpdir(), 'd37-pglite'), path.join(SITE, '..', 'd37-pglite'), SITE].filter(Boolean);
  const pick = x => (typeof x === 'string' ? x : x && (pick(x.import) || pick(x.default) || pick(x.module)));
  for (const c of cands) {
    for (const dir of [c, path.join(c, '@electric-sql/pglite'), path.join(c, 'node_modules/@electric-sql/pglite')]) {
      try {
        const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (pj.name !== '@electric-sql/pglite') continue;
        const entry = path.join(dir, pick(pj.exports && pj.exports['.']) || pj.module || pj.main || 'dist/index.js');
        const m = await import(pathToFileURL(entry).href);
        if (m.PGlite) return m.PGlite;
      } catch (e) { /* дальше */ }
    }
  }
  return null;
}
const PGlite = await findPglite();
if (!PGlite) {
  const msg = 'ops-sql-test: PGlite не найден — SQL-проверки пропущены. Поставь: npm install --prefix "' + path.join(os.tmpdir(), 'd37-pglite') + '" @electric-sql/pglite  (или PGLITE_PATH=…)';
  if (process.env.OPS_SQL_REQUIRED) { console.log('FAIL ' + msg); process.exit(1); }
  console.log('SKIP ' + msg);
  process.exit(0);
}

const OPS = fs.readFileSync(path.join(SITE, 'ops.sql'), 'utf8');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key);
grant usage on schema auth to anon, authenticated, service_role;
create table public.profiles (id uuid primary key, nick text, role text default 'user');
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant select on public.profiles to anon, authenticated, service_role;
`);
const U = c => `${c.repeat(8)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(12)}`;
const ADMIN = U('a'), USER = U('1');
await db.exec(`insert into auth.users values ('${ADMIN}'), ('${USER}');
  insert into public.profiles(id, nick, role) values ('${ADMIN}', 'dan4ik37', 'admin'), ('${USER}', 'Vasya', 'user');`);

const as = async (role, id) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${id || ''}', false);
  select set_config('request.jwt.claim.role', '${role || ''}', false); ${role ? 'set role ' + role + ';' : ''}`);
const fn = async (s, args) => (await db.query(`select ${s} r`, args || [])).rows[0].r;
const rows = async (s, args) => (await db.query(s, args || [])).rows;
const one = async (s, args) => (await db.query(s, args || [])).rows[0];
const err = async (s, args) => { try { await db.query(s, args || []); return null; } catch (e) { return e.message + ' ' + (e.code || ''); } };
const J = o => JSON.stringify(o);

// ═══ 1. Применение ═══
await as(null);
await db.exec('begin;\n' + OPS + '\ncommit;');
await db.exec('begin;\n' + OPS + '\ncommit;');
ok(true, 'ops.sql применён дважды без ошибок (идемпотентен)');
ok((await one(`select count(*)::int n from pg_proc where proname like 'ops\\_%'`)).n >= 8, 'функции на месте');

// ═══ 2. Права ═══
const ITEM = (o = {}) => ({ t: 'e', m: "Cannot read properties of undefined (reading 'length')", f: '/js/games/kubomir.js', l: 120, c: 5, r: 'play/kubomir', n: 3, s: 'tick /js/games/kubomir.js:120:5\nloop /js/games/kubomir.js:200:7', ...o });
const META = (o = {}) => ({ v: '115', b: 'chrome/129', o: 'windows', d: 'd', x: 0, ...o });
const ING = (items, meta) => `public.ops_err_ingest($1::jsonb, $2::jsonb)`;
const ing = async (items, meta = META()) => (await db.query(`select public.ops_err_ingest($1::jsonb, $2::jsonb) r`, [J(items), J(meta)])).rows[0].r;

for (const [who, role, id] of [['гость (anon)', 'anon', ''], ['игрок', 'authenticated', USER], ['админ', 'authenticated', ADMIN]]) {
  await as(role, id);
  const e = await err(`select public.ops_err_ingest($1::jsonb, '{}'::jsonb)`, [J([ITEM()])]);
  ok(e && /permission denied/i.test(e), `ops_err_ingest закрыта для: ${who}`, e);
}
await as('anon', '');
let e = await err(`select public.ops_err_admin(7)`);
ok(e && /permission denied/i.test(e), 'ops_err_admin: гостю — нет прав', e);
e = await err(`select public.ops_err_act('clear')`);
ok(e && /permission denied/i.test(e), 'ops_err_act: гостю — нет прав', e);
e = await err(`select k from public.ops_err limit 1`);
ok(e && /permission denied/i.test(e), 'таблица ops_err: гостю — нет прав', e);
e = await err(`select 1 from public.ops_quota limit 1`);
ok(e && /permission denied/i.test(e), 'таблица ops_quota: гостю — нет прав', e);
await as('authenticated', USER);
e = await err(`select public.ops_err_admin(7)`);
ok(e && /Только для админа/.test(e) && /42501/.test(e), 'ops_err_admin: игроку — «Только для админа» (42501)', e);
e = await err(`select public.ops_err_act('clear')`);
ok(e && /Только для админа/.test(e), 'ops_err_act: игроку — «Только для админа»', e);
e = await err(`select public.ops_cfg()`);
ok(e && /permission denied/i.test(e), 'ops_cfg (помощник): игроку закрыт', e);
e = await err(`select public.ops_inc('{}'::jsonb, 'a', 1)`);
ok(e && /permission denied/i.test(e), 'ops_inc (помощник): игроку закрыт', e);

// ═══ 3. Приём отчётов (service_role) ═══
await as('service_role');
let r = await ing([ITEM(), ITEM({ t: 'p', m: 'TypeError: x is not a function', f: '/js/features/chat.js', l: 77, r: 'chat', n: 1, s: '' }), ITEM({ t: 'r', m: 'load failed: script', f: '/js/games/podzem.js', l: 0, r: 'play/podzem', n: 1, s: '' })]);
ok(r.ok === true && r.rate === 1, 'приём: ok, rate = 1', r);
let a = await one(`select count(*)::int n, sum(n)::int sn, sum(s)::int ss from public.ops_err`);
ok(a.n === 3 && a.sn === 5 && a.ss === 3, 'три разные ошибки: строк 3, случаев 3+1+1, отчётов 3', a);
let x = await one(`select * from public.ops_err where m like 'Cannot read%'`);
ok(x.k.length === 16 && x.t === 'e' && x.f === '/js/games/kubomir.js' && x.l === 120 && x.n === 3 && x.s === 1 && x.first_v === '115' && x.last_v === '115', 'строка ошибки: ключ 16 знаков, файл, строка, n = 3, версии', x);
ok(x.v['115'] === 1 && x.r['play/kubomir'] === 1 && x.b['chrome/129'] === 1 && x.o.windows === 1 && x.d.d === 1, 'словари: версия, раздел, браузер, система, устройство', x);
ok(/^tick \/js\/games\/kubomir\.js:120:5\nloop/.test(x.st), 'пример стека сохранён', x.st);
ok((await one(`select count(*)::int n from public.ops_err_day where day = public.ops_today()`)).n === 3, 'по дням — три строки за сегодня');

// та же ошибка из другого браузера и версии: счётчики растут, первый стек и first_v остаются
r = await ing([ITEM({ n: 2, s: 'other /js/x.js:1:1' })], META({ v: '116', b: 'safari/17', o: 'ios', d: 'm' }));
x = await one(`select * from public.ops_err where m like 'Cannot read%'`);
ok(x.n === 5 && x.s === 2 && x.first_v === '115' && x.last_v === '116' && x.v['115'] === 1 && x.v['116'] === 1, 'повтор: n = 5, отчётов 2, first_v = 115, last_v = 116', x);
ok(x.b['safari/17'] === 1 && x.o.ios === 1 && x.d.m === 1 && /^tick/.test(x.st), 'повтор: новые браузер/система/устройство; стек — первый', x);
ok((await one(`select n, s from public.ops_err_day where k = '${x.k}' and day = public.ops_today()`)).n === 5, 'по дням: n = 5');

// ═══ 4. Проверка присланного ═══
await db.exec(`delete from public.ops_err where true`);
r = await ing([
  { t: 'zzz', m: "Мусор\u0007\n  с   пробелами", f: "/js/a b;'drop.js", l: '12abc', c: -4, r: 'Bad Route!', n: 99999, s: "<script>alert(1)</script>\nfn /js/ok.js:1:2" },
  { m: '', f: '/js/x.js' },          // пустое сообщение — пропускаем
  'строка', null, 5, [],            // не объекты — пропускаем
  { m: "O'Reilly'; drop table public.ops_err; --", f: '/js/q.js', l: 5, r: 'chat', n: 1 },
], { v: '1 5!', b: '<b>', o: 'beos', d: 'x', x: 3 });
ok(r.ok === true, 'мусорные поля не ломают приём', r);
a = await rows(`select * from public.ops_err order by m`);
ok(a.length === 2, 'пустые и не-объекты пропущены', a.length);
x = a.find(z => /^Мусор/.test(z.m));
ok(x && x.t === 'e' && x.m === 'Мусор с пробелами' && x.l === 0 && x.n === 1000 && x.f === '/js/abdrop.js' && x.first_v === '15', 'тип → e, управляющие знаки вон, строка → 0, n ≤ 1000, файл очищен, версия очищена', x);
ok(x.r.other === 1 && x.b.other === 1 && x.o.other === 1 && x.d.d === 1, 'раздел/браузер/система/устройство вне списка → other / d', x);
ok(/fn \/js\/ok\.js:1:2$/.test(x.st) && !/[()]/.test(x.st), 'стек: скобки и прочие лишние знаки убраны, кадр цел', x.st);
ok(await one(`select to_regclass('public.ops_err') t`).then(z => !!z.t), 'таблица на месте после «инъекции» в тексте');
ok(a.some(z => z.m.startsWith("O'Reilly'; drop table")), 'кавычки и SQL в тексте хранятся как текст');
r = await ing('не массив');
ok(r.ok === false && r.reason === 'shape', 'не массив → shape', r);
r = await ing([{ m: 'x'.repeat(5000), f: '/js/long.js', l: 1 }]);
ok((await one(`select length(m) n from public.ops_err where f = '/js/long.js'`)).n === 200, 'сообщение режется до 200 знаков');
// 12 разных версий: лишние идут в «~»
await db.exec(`delete from public.ops_err where true`);
for (let i = 0; i < 15; i++) await ing([{ m: 'same', f: '/js/s.js', l: 1, r: 'chat', n: 1 }], META({ v: 'v' + i }));
x = await one(`select v, s from public.ops_err where f = '/js/s.js'`);
ok(Object.keys(x.v).length === 13 && x.v['~'] === 3 && x.s === 15, 'версий в словаре ≤ 12, лишние — в «~»', x);

// ═══ 5. Потолки дня ═══
await as(null);
await db.exec(`create or replace function public.ops_cfg() returns jsonb language sql stable as $$ select jsonb_build_object('keep_days', 14, 'calls_day', 6, 'items_day', 50, 'newk_day', 4, 'map_keys', 12) $$;
  delete from public.ops_err where true; delete from public.ops_quota where true;`);
await as('service_role');
const uniq = (n, tag = 'u') => Array.from({ length: n }, (_, i) => ({ m: `${tag} error ${i} here`, f: `/js/${tag}${i}.js`, l: i + 1, n: 1 }));
r = await ing(uniq(3));
ok(r.ok === true && r.rate === 1, 'потолок 6 вызовов: 1-й — ok', r);
r = await ing(uniq(3, 'w'));
x = await one(`select count(*)::int n from public.ops_err where t = 'o'`);
ok(r.ok === true && x.n === 1, 'новых разных сверх 4 в сутки — в одну строку «overflow» (t = o)', x);
x = await one(`select m, n, s from public.ops_err where k = 'overflow'`);
ok(x && /Слишком много/.test(x.m) && x.n === 2, 'overflow считает, сколько не записано отдельно', x);
ok((await one(`select count(*)::int n from public.ops_err where t <> 'o'`)).n === 4, 'отдельно записано ровно 4 новых');
r = await ing(uniq(3));   // старые ключи не считаются новыми
ok(r.ok === true, 'старые ключи принимаются и после потолка новых', r);
const qd = await one(`select calls, items, newk from public.ops_quota where day = public.ops_today()`);
ok(qd.calls === 3 && qd.items === 9 && qd.newk === 4, 'потолок: 3 вызова, 9 ошибок, 4 новых', qd);
r = await ing(uniq(3));
ok(r.ok === true && r.rate === 0.6, '4-й вызов из 6 (≥ 50 %): rate = 0.6', r);
r = await ing(uniq(1));
ok(r.ok === true && r.rate === 0.3, '5-й вызов (≥ 70 %): rate = 0.3', r);
r = await ing(uniq(1));
ok(r.ok === true && r.rate === 0.1, '6-й вызов (≥ 90 %): rate = 0.1', r);
r = await ing(uniq(1));
ok(r.ok === false && r.stop >= 60 && r.stop <= 86400, '7-й вызов: потолок исчерпан → { ok: false, stop }', r);
ok((await one(`select calls from public.ops_quota where day = public.ops_today()`)).calls === 6, 'отказ потолок не двигает');
// потолок по числу ошибок
await as(null);
await db.exec(`update public.ops_quota set calls = 0, items = 49 where day = public.ops_today()`);
await as('service_role');
r = await ing(uniq(2));
ok(r.ok === true, 'на 49 из 50: принять ещё (после — потолок)', r);
r = await ing(uniq(1));
ok(r.ok === false && r.stop > 0, 'на 51 из 50: stop', r);

// ═══ 6. Уборка старого (раз в сутки, при первом отчёте дня) ═══
await as(null);
await db.exec(`create or replace function public.ops_cfg() returns jsonb language sql stable as $$ select jsonb_build_object('keep_days', 14, 'calls_day', 6000, 'items_day', 20000, 'newk_day', 300, 'map_keys', 12) $$;
  delete from public.ops_err where true; delete from public.ops_quota where true;
  insert into public.ops_err (k, m, f, last_at) values ('old1', 'старая', '/js/o.js', now() - interval '20 days'), ('new1', 'свежая', '/js/n.js', now() - interval '3 days');
  insert into public.ops_err_day (day, k, n, s) values (public.ops_today() - 20, 'old1', 5, 1), (public.ops_today() - 3, 'new1', 2, 1);
  insert into public.ops_quota (day, calls) values (public.ops_today() - 90, 1), (public.ops_today() - 5, 1);`);
await as('service_role');
await ing([ITEM({ f: '/js/fresh.js' })]);
a = await rows(`select k from public.ops_err where k in ('old1', 'new1') order by k`);
ok(a.length === 1 && a[0].k === 'new1', 'уборка: ошибка старше 14 суток удалена, свежая осталась', a);
ok((await one(`select count(*)::int n from public.ops_err_day where k = 'old1'`)).n === 0, 'уборка: дни старой ошибки ушли каскадом');
ok((await one(`select count(*)::int n from public.ops_quota`)).n === 2, 'уборка: потолки старше 60 суток удалены, недавние остались');
await as(null);
await db.exec(`insert into public.ops_err (k, m, f, last_at) values ('old2', 'ещё старая', '/js/o2.js', now() - interval '30 days')`);
await as('service_role');
await ing([ITEM({ f: '/js/fresh2.js' })]);
ok((await one(`select count(*)::int n from public.ops_err where k in ('new1', 'old2')`)).n === 2, 'уборка повторно в тот же день не запускается (old2 осталась)');

// ═══ 7. Сводка админа ═══
await as(null);
await db.exec(`delete from public.ops_err where true; delete from public.ops_quota where true;`);
await as('service_role');
await ing([ITEM({ m: 'Частая ошибка', f: '/js/a.js', l: 1, n: 10 }), ITEM({ m: 'Редкая ошибка', f: '/js/b.js', l: 2, n: 1 })]);
await ing([ITEM({ m: 'Частая ошибка', f: '/js/a.js', l: 1, n: 5 })], META({ v: '120', d: 'm', b: 'chrome/130', o: 'android' }));
await as(null);
// вчерашний день и 10 суток назад — для окон
const kA = (await one(`select k from public.ops_err where f = '/js/a.js'`)).k, kB = (await one(`select k from public.ops_err where f = '/js/b.js'`)).k;
await db.exec(`insert into public.ops_err_day (day, k, n, s) values (public.ops_today() - 1, '${kA}', 7, 2), (public.ops_today() - 10, '${kB}', 4, 1);
  update public.ops_err set ign = true where k = '${kB}';`);
await as('authenticated', ADMIN);
let S = await fn(`public.ops_err_admin(7)`);
ok(S.ok === true && S.days === 7 && S.daily.length === 7 && S.top.length === 2, 'сводка за 7 суток: ok, 7 дней, 2 ошибки', { days: S.days, daily: S.daily.length, top: S.top.length });
ok(S.top[0].k === kA && S.top[0].n_win === 22 && S.top[0].n_today === 15 && S.top[0].s_win === 4, 'главная ошибка: за окно 22 (15 сегодня + 7 вчера), отчётов 4', S.top[0]);
ok(S.top[1].k === kB && S.top[1].n_win === 1 && S.top[1].ign === true, 'вторая: за окно 1 (4 десять суток назад не в счёт), скрыта', S.top[1]);
ok(S.daily[6].n === 16 && S.daily[5].n === 7 && S.daily[0].n === 0, 'график по дням: сегодня 16 (15 + 1), вчера 7, 6 суток назад 0', S.daily.map(d => d.n));
ok(S.daily[6].day === S.today && S.quota.calls === 2 && S.cfg.keep_days === 14, 'сегодня — последний день; потолок и настройки в ответе', { q: S.quota, c: S.cfg });
ok(S.top[0].v['115'] === 1 && S.top[0].v['120'] === 1 && S.top[0].first_v === '115' && S.top[0].last_v === '120', 'версии: 115 и 120, first_v / last_v', S.top[0]);
S = await fn(`public.ops_err_admin(1)`);
ok(S.days === 1 && S.daily.length === 1 && S.top.length === 2 && S.top.every(z => z.n_win <= 15), 'окно в 1 сутки', { n: S.top.map(z => z.n_win) });
S = await fn(`public.ops_err_admin(14)`);
ok(S.top.find(z => z.k === kB).n_win === 5 && S.daily.length === 14, 'окно в 14 суток захватывает старое (1 + 4)', S.top.find(z => z.k === kB));
S = await fn(`public.ops_err_admin(500)`);
ok(S.days === 14, 'окно не больше 14 суток');
S = await fn(`public.ops_err_admin(null)`);
ok(S.days === 7, 'p_days = null → 7');
// админ читает таблицы напрямую, игрок видит пусто
ok((await rows(`select k from public.ops_err`)).length === 2, 'админ читает ops_err напрямую (политика)');
ok((await rows(`select k from public.ops_err_day`)).length >= 3, 'админ читает ops_err_day напрямую');
e = await err(`delete from public.ops_err where true`);
ok(e && /permission denied/i.test(e), 'админ не может удалять напрямую (только через ops_err_act)', e);
e = await err(`insert into public.ops_err (k, m) values ('hack', 'x')`);
ok(e && /permission denied/i.test(e), 'админ не может писать в таблицу напрямую', e);
await as('authenticated', USER);
ok((await rows(`select k from public.ops_err`)).length === 0, 'игрок: ops_err пусто (RLS)');
ok((await rows(`select k from public.ops_err_day`)).length === 0, 'игрок: ops_err_day пусто (RLS)');

// ═══ 8. Действия ═══
await as('authenticated', ADMIN);
ok((await fn(`public.ops_err_act('ign', '${kA}')`)).ok === true && (await one(`select ign from public.ops_err where k = '${kA}'`)).ign === true, 'ign: скрыть');
await fn(`public.ops_err_act('unign', '${kA}')`);
ok((await one(`select ign from public.ops_err where k = '${kA}'`)).ign === false, 'unign: вернуть');
ok((await fn(`public.ops_err_act('boom', '${kA}')`)).reason === 'act', 'неизвестное действие → reason act');
await fn(`public.ops_err_act('del', '${kB}')`);
ok((await rows(`select k from public.ops_err`)).length === 1 && (await rows(`select 1 from public.ops_err_day where k = '${kB}'`)).length === 0, 'del: ошибка и её дни стёрты');
await fn(`public.ops_err_act('clear')`);
ok((await rows(`select k from public.ops_err`)).length === 0 && (await rows(`select 1 from public.ops_err_day`)).length === 0, 'clear: всё стёрто');
S = await fn(`public.ops_err_admin(7)`);
ok(S.top.length === 0 && S.keys_total === 0 && S.daily.length === 7, 'пустая база: пустой список, график из нулей');

// ═══ 9. Третий запуск не стирает данные ═══
await as('service_role');
await ing([ITEM()]);
await as(null);
await db.exec('begin;\n' + OPS + '\ncommit;');
ok((await one(`select count(*)::int n from public.ops_err`)).n === 1, 'повторный запуск файла данные не трогает');
ok((await one(`select count(*)::int n from pg_policies where tablename in ('ops_err', 'ops_err_day')`)).n === 2, 'политики — по одной на таблицу (не задваиваются)');

console.log(`ops-sql-test: ${pass} ok, ${fail} fail`);
await db.close?.();
process.exit(fail ? 1 : 0);
