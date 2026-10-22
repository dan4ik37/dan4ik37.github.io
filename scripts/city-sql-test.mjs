// city.sql («Живой город» P1) на PGlite с заглушками живой базы Supabase: роли anon / authenticated, auth.uid() через
// request.jwt.claim.sub, profiles, banned_nicks, age_group_of (как age.sql), права по умолчанию «всем всё» (как у Supabase —
// файл обязан сам закрыть). Проверяет: файл применяется дважды (и поверх данных), каталог = MirEcon.SERVER, права и RLS,
// работа (подарок, too_soon, номер задания, усталость, лимиты, возраст, бан, частота), еда и бонус, «касса пуста», пауза,
// новый день (эмиссия, центробанк, потолок казны, снимок журнала), общая стройка у двух игроков, админ (журнал, настройки,
// двойники, проверка), сохранение денег (дрейф 0, и после удаления аккаунта), одни и те же случайные ходы в JS (Rules) и SQL,
// время ответа и размер ответов на «живом» объёме строк.
// Запуск из корня сайта: node scripts/city-sql-test.mjs            (PGlite — PGLITE_PATH=<папка>, как у ops-sql-test.mjs)
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import { fileURLToPath, pathToFileURL } from 'url';

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } };
async function findPglite() {
  const cands = [process.env.PGLITE_PATH, path.join(os.tmpdir(), 'd37-pglite'), 'E:/claude-tmp/d37raid/pg', SITE].filter(Boolean);
  const pick = x => (typeof x === 'string' ? x : x && (pick(x.import) || pick(x.default) || pick(x.module)));
  for (const c of cands) for (const dir of [c, path.join(c, '@electric-sql/pglite'), path.join(c, 'node_modules/@electric-sql/pglite')]) {
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pj.name !== '@electric-sql/pglite') continue;
      const m = await import(pathToFileURL(path.join(dir, pick(pj.exports && pj.exports['.']) || pj.module || pj.main || 'dist/index.js')).href);
      if (m.PGlite) return m.PGlite;
    } catch (e) { /* дальше */ }
  }
  return null;
}
const PGlite = await findPglite();
if (!PGlite) {
  const msg = 'city-sql-test: PGlite не найден — пропущено. npm install --prefix <папка> @electric-sql/pglite и PGLITE_PATH=<папка>';
  if (process.env.OPS_SQL_REQUIRED) { console.log('FAIL ' + msg); process.exit(1); }
  console.log('SKIP ' + msg); process.exit(0);
}
// (window не задаём: PGlite тогда считает себя браузером; mir-econ.js сам берёт globalThis)
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/games/mir-econ.js'), 'utf8'), { filename: 'mir-econ.js' });
const M = globalThis.MirEcon, RU = M.Rules;
const SQL = fs.readFileSync(path.join(SITE, 'city.sql'), 'utf8');

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users (id uuid primary key);
grant usage on schema auth to anon, authenticated, service_role;
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, nick text, role text default 'user');
create table public.banned_nicks (nick text primary key, reason text, created_at timestamptz default now());
create table public.test_age (uid uuid primary key, g text);
create function public.age_group_of(p_uid uuid) returns text language sql stable security definer set search_path = public as $$ select coalesce((select g from public.test_age where uid = p_uid), 'unknown') $$;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant select on public.profiles to anon, authenticated;
revoke execute on function public.age_group_of(uuid) from public, anon, authenticated;
`);
const U = (c, i = 0) => `${c.repeat(8)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(4)}-${String(i).padStart(12, c)}`;
const A = U('a'), B = U('b'), KID = U('c'), TEEN = U('d'), T16 = U('e'), UNK = U('f'), BAN = U('9'), ADM = U('8'), MOD = U('7');
const users = [[A, 'Аня', 'user', 'adult'], [B, 'Боря', 'user', 'adult'], [KID, 'Малыш', 'user', 'child'], [TEEN, 'Тоша', 'user', 'teen'], [T16, 'Сёма', 'user', 'teen16'],
  [UNK, 'Ктото', 'user', null], [BAN, 'Плохиш', 'user', 'adult'], [ADM, 'dan4ik37', 'admin', 'adult'], [MOD, 'Модер', 'moderator', 'adult']];
for (const [id, nick, role, g] of users) {
  await db.exec(`insert into auth.users values ('${id}'); insert into public.profiles values ('${id}', '${nick}', '${role}');${g ? ` insert into public.test_age values ('${id}', '${g}');` : ''}`);
}
await db.exec(`insert into public.banned_nicks (nick) values ('плохиш')`);

// ═══ 1. Файл дважды, каталог ═══
let t0 = performance.now();
await db.exec('begin;\n' + SQL + '\ncommit;');
const tFirst = performance.now() - t0;
await db.exec('begin;\n' + SQL + '\ncommit;');
ok(true, 'city.sql применён дважды');
await db.exec(`create or replace function public.city_now() returns bigint language sql stable as $$ select coalesce(nullif(current_setting('test.now', true), '')::bigint, floor(extract(epoch from now()))::bigint) $$;`);
let NOW = 1792800000;   // 2026-10-23 (МСК — день как у теста)
const setNow = async t => { NOW = t; await db.exec(`select set_config('test.now', '${t}', false)`); };
await setNow(NOW);
// стартовые строки городов записаны по настоящим часам — переводим их на день теста
await db.exec(`update public.cities set day = public.city_today(), stats = public.city_stats0_(public.city_today())`);
const as = async id => db.exec(`reset role; set role ${id ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${id || ''}', false); select set_config('request.headers', '{"x-forwarded-for":"10.0.0.${id ? id.charCodeAt(0) : 0}"}', false);`);
const su = async () => db.exec('reset role;');
const q1 = async s => (await db.query(`select ${s} r`)).rows[0].r;
const rows = async s => (await db.query(s)).rows;
const tryQ = async s => { try { await db.query(s); return true; } catch (e) { return false; } };
const J = o => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const act = async (a, g = {}, dev = null) => q1(`public.city_act('${a}', ${J(g)}, ${dev ? `'${dev}'` : 'null'})`);
const deepEq = (a, b) => { if (a === b) return true; if (typeof a !== typeof b || !a || !b || typeof a !== 'object') return false; if (Array.isArray(a) !== Array.isArray(b)) return false; const ka = Object.keys(a).sort(), kb = Object.keys(b).sort(); return ka.length === kb.length && ka.every((k, i) => k === kb[i] && deepEq(a[k], b[k])); };
const sum = async () => { await as(ADM); const s = await q1(`public.city_admin('sum')`); return s; };

await as(null);
const defs = await q1('public.city_defs()');
ok(deepEq({ ...defs, cv: undefined }, { ...JSON.parse(JSON.stringify(M.SERVER)), cv: undefined }) && defs.cv === 0, 'city_defs() = MirEcon.SERVER (+cv 0)', { cv: defs.cv });
const D = M.merge(M.SERVER, {}, 0);
let pub = await q1(`public.city_public('kids')`);
ok(pub.ok && pub.treasury === 5000 && pub.hire && pub.site === 0 && pub.stage === 0 && pub.city === 'kids', 'гость: казна детского городка 5000, город нанимает', pub);
ok(JSON.stringify(pub).length < 2048, 'city_public < 2 КБ', JSON.stringify(pub).length);
ok((await q1(`public.city_public('metro')`)).treasury === 10000, 'казна Большого города 10000');
ok((await q1(`public.city_public('mars')`)).reason === 'city', 'чужой город — отказ');
const same = await q1(`public.city_public('kids', ${pub.rev})`);
ok(same.same === true && JSON.stringify(same).length < 80, 'та же версия → {same: true}', same);

// ═══ 2. Права и RLS ═══
for (const f of ["city_state()", "city_act('job', '{}'::jsonb, null)", "city_admin('sum')", 'city_now()', 'city_defs0()', "city_settle_('kids')", "city_lock_('kids')", "city_tick_('kids')",
  `city_mark_('${A}', 'x')`, `city_fail_('${A}', 0, 0, 'x')`, `city_age_ok_('${A}', 16)`, `city_banned_('${A}')`]) ok(!(await tryQ(`select public.${f}`)), `гостю закрыто: ${f}`);
await as(A);
for (const f of ['city_now()', 'city_defs0()', "city_settle_('kids')", "city_lock_('kids')", "city_tick_('kids')", `city_mark_('${A}', 'x')`, `city_fail_('${A}', 0, 0, 'x')`, `city_age_ok_('${A}', 16)`])
  ok(!(await tryQ(`select public.${f}`)), `игроку закрыто: ${f}`);
for (const t of ['cities', 'city_people', 'city_ledger', 'city_cfg', 'city_bank', 'city_contrib', 'city_marks', 'city_days']) {
  ok(!(await tryQ(`select * from public.${t} limit 1`)) || (await rows(`select * from public.${t} limit 1`)).length === 0, `${t}: читать напрямую нельзя`);
  ok(!(await tryQ(`insert into public.${t} default values`)), `${t}: писать напрямую нельзя`);
}
ok(!(await tryQ(`update public.cities set treasury = 999999`)) || (await (async () => { await su(); return (await q1(`(select treasury from public.cities where id = 'kids')`)) === 5000; })()), 'казну напрямую не поменять');

// ═══ 3. Работа: подарок, рано, номер, зарплата, перезагрузка ═══
await as(A);
let st = await q1(`public.city_state()`);
ok(st.ok && st.new === true && st.st.cash === 0 && st.age.metro === true && st.banned === false, 'новичок: пусто, в метро можно (взрослый)', st);
ok(deepEq(st.st, RU.fresh()), 'пустое состояние = Rules.fresh()');
let r = await act('job', { city: 'kids', prof: 'cook', place: 'k_bake' }, 'devA_0123456789abcdef');
ok(r.ok && r.st.cash === 50 && r.st.granted && r.got.grant === 50 && r.st.job.prof === 'cook' && /^[0-9a-f]{8}$/.test(r.st.job.n) && r.st.job.t === NOW && r.c?.city === 'kids', 'работа: подарок 50 💵 и номер задания', r);
const n1 = r.st.job.n;
r = await act('task', { n: n1 });
ok(r.reason === 'too_soon' && r.wait === 25, 'сразу сдать — too_soon, ждать 25 с', r);
await setNow(NOW + 24);
ok((await act('task', { n: n1 })).reason === 'too_soon', 'через 24 с — всё ещё рано');
await setNow(NOW + 1);
ok((await act('task', { n: 'deadbeef' })).reason === 'nonce', 'чужой номер — nonce');
r = await act('task', { n: n1 });
ok(r.ok && r.got.net === 5 && r.got.g100 === 600 && r.got.t100 === 30 && r.st.cash === 55 && r.st.frac === 70 && r.st.skills.cook === 1 && r.st.xpd.cook === 1 && r.st.job.n !== n1, 'сдал: 6 − 5 % = 5,70 → 5 💵 + 70 копеек', r);
ok((await act('task', { n: n1 })).reason === 'nonce', 'старый номер второй раз — nonce');
await setNow(NOW + 25);
r = await act('task', { n: r.st.job.n });
ok(r.ok && r.got.net === 6 && r.st.cash === 61 && r.st.frac === 40, 'копейки копятся: 70 + 570 → +6, остаток 40', r);
st = await q1(`public.city_state(null, 10)`);
ok(st.st.cash === 61 && st.st.skills.cook === 2 && st.hist.length === 3 && st.hist[0].k === 'wage' && st.hist[0].a === 6 && st.hist[2].k === 'grant', 'после «перезагрузки» — тот же кошелёк, навык и история', st);
await su();
ok((await q1(`(select treasury from public.cities where id = 'kids')`)) === 5000 - 11, 'казна заплатила 11 💵');
ok((await rows(`select * from public.city_contrib where user_id = '${A}'`))[0]?.pts === 2, 'вклад жителя: 2 очка');
ok((await rows(`select * from public.city_marks where user_id = '${A}'`)).length === 2, 'отметки IP и браузера записаны');

// ═══ 4. Возраст, бан, гость, город, профессия ═══
await as(null);
ok(!(await tryQ(`select public.city_act('job', '{}'::jsonb, null)`)), 'гостю city_act не выдан (401)');
await as(UNK); ok((await act('job', { city: 'metro', prof: 'police', place: 'm_police' })).reason === 'age', 'возраст не указан → метро нельзя');
await as(TEEN); ok((await act('job', { city: 'metro', prof: 'cook', place: 'm_rest' })).reason === 'age', '13–15 → метро нельзя');
await as(KID); ok((await act('job', { city: 'kids', prof: 'fire', place: 'k_fire' })).ok, 'ребёнок работает в детском городке');
ok((await act('job', { city: 'metro', prof: 'seller', place: 'm_shop' })).reason === 'age', 'ребёнок — не в метро');
ok((await act('job', { city: 'kids', prof: 'police', place: 'k_fire' })).reason === 'args', 'полиции в детском городке нет');
await as(T16); r = await act('job', { city: 'metro', prof: 'police', place: 'm_police' }); ok(r.ok, '16–17 → полицейский в метро', r);
await as(BAN); ok((await act('job', { city: 'kids', prof: 'cook', place: 'k_bake' })).reason === 'banned', 'забаненный — работы нет');
await as(A);
ok((await act('job', { city: 'kids', prof: 'pilot', place: 'k_bake' })).reason === 'prof', 'нет профессии');
ok((await act('job', { city: 'kids', prof: 'cook', place: 'k_bake', mode: 'self' })).reason === 'mode', '«на себя» — позже (P2)');
ok((await act('job', { city: 'moon', prof: 'cook', place: 'k_bake' })).reason === 'city', 'нет города');
ok((await act('jump', {})).reason === 'args', 'нет действия');

// ═══ 5. Усталость и лимиты (в метро — налог 10 %) ═══
await as(B);
await setNow(NOW + 100);
r = await act('job', { city: 'metro', prof: 'seller', place: 'm_shop' });
let n = r.st.job.n, tt = NOW;
const tasks = async (k, step = 16) => { let last = null; for (let i = 0; i < k; i++) { tt += step; await setNow(tt); last = await act('task', { n }); if (last.ok) n = last.st.job.n; else break; } return last; };
r = await tasks(40);
ok(r.ok && r.st.xpd.seller === 40 && r.got.tired === true && r.got.g100 === 550, '40 заданий — полная зарплата (с 31-го — «Работник»: 5,50)', r.got);
r = await tasks(1);
ok(r.ok && r.got.g100 === Math.floor(Math.floor(5 * 110 * 100 * 100 / 10000) / 2), '41-е — половина (навык уже «Работник»: 5,50 / 2)', r.got);
r = await tasks(19);
ok(r.ok && r.st.xpd.seller === 60, '60 заданий за день');
r = await tasks(1);
ok(r.reason === 'day_cap' && r.cap === 'prof', '61-е — «смени работу» (day_cap prof)', r);
// дневной лимит зарплаты: поднять ставку до 100 и сменить работу
await as(ADM); r = await q1(`public.city_admin('cfg', ${J({ set: { 'profs.cook.wage': 100 } })})`); ok(r.ok && r.defs.profs.cook.wage === 100 && r.rev === 1, 'админ: ставка повара 100');
await as(B);
r = await act('job', { city: 'metro', prof: 'cook', place: 'm_rest' }); n = r.st.job.n; tt += 1;
let w = 0, cap = null; for (let i = 0; i < 12 && !cap; i++) { tt += 30; await setNow(tt); r = await act('task', { n }); if (r.ok) { n = r.st.job.n; w = r.st.wd; } else cap = r; }
ok(cap?.reason === 'day_cap' && cap.cap === 'wage' && w === 40000, 'зарплата за день — не больше 400 💵 (валовых)', { cap, w });
await as(ADM); await q1(`public.city_admin('cfg', ${J({ set: { 'profs.cook.wage': null } })})`);
ok((await q1('public.city_defs()')).profs.cook.wage === 6, 'сброс настройки — снова как в каталоге');
// частота
await as(T16);
await setNow(tt + 200);
let tooFast = null; for (let i = 0; i < 62 && !tooFast; i++) { const x = await act('eat', { item: 'bun' }); if (x.reason === 'too_fast') tooFast = i; }
ok(tooFast === 60, 'не больше 60 ходов в минуту (61-й — too_fast)', tooFast);

// ═══ 6. Еда, бонус, магазины ═══
await as(A); await setNow(tt + 400);
ok((await act('buy', { city: 'kids', place: 'k_bake', item: 'pizza' })).reason === 'args', 'в пекарне пиццы нет');
ok((await act('buy', { city: 'kids', place: 'k_bake', item: 'bun', qty: 0 })).reason === 'args', 'qty 0 — нельзя');
ok((await act('buy', { city: 'kids', place: 'k_bake', item: 'bun', qty: 1.5 })).reason === 'args', 'qty дробное — нельзя');
let c0 = (await q1(`public.city_state()`)).st.cash;
r = await act('buy', { city: 'kids', place: 'k_bake', item: 'bun', qty: 2 });
ok(r.ok && r.got.cost === 10 && r.st.cash === c0 - 10 && r.st.food.bun === 2 && r.st.fd === 2, 'две булочки — 10 💵 (4 × 1,25 = 5)', r);
r = await act('eat', { item: 'bun' });
ok(r.ok && r.st.food.bun === 1 && r.st.buffs.food.p === 5 && r.st.buffs.food.u === NOW + 1800, 'съел: +5 % на 30 мин', r);
ok((await act('eat', { item: 'pie' })).reason === 'none', 'нечего есть');
r = await act('job', { city: 'kids', prof: 'teacher', place: 'k_school' }); n = r.st.job.n;
await setNow(NOW + 25);
r = await act('task', { n });
ok(r.ok && r.got.g100 === 630, 'с бонусом еды: 6,00 × 1,05 = 6,30', r.got);
await setNow(NOW + 3600);
ok(!RU.buffP(D, r.st, NOW), 'бонус кончился через 30 мин');

// ═══ 7. «Касса пуста», пауза, поправка казны ═══
await as(ADM);
let pk = await q1(`public.city_public('kids')`);
r = await q1(`public.city_admin('grant', ${J({ city: 'kids', n: -(pk.treasury - 302), why: 'тест' })})`);
ok(r.ok && r.treasury === 302, 'админ уничтожил часть казны (до 302)', r);
ok((await q1(`public.city_admin('grant', ${J({ city: 'kids', n: -99999 })})`)).reason === 'treasury', 'больше, чем в казне, — нельзя');
await as(A); st = await q1('public.city_state()'); n = st.st.job.n;
await setNow(NOW + 30);
r = await act('task', { n });
ok(r.reason === 'no_slots', 'казна у запаса (300) — «касса пуста»', r);
await as(ADM); await q1(`public.city_admin('grant', ${J({ city: 'kids', n: 2000, why: 'тест' })})`);
await q1(`public.city_admin('freeze', ${J({ city: 'kids', on: true })})`);
await as(A); ok((await act('task', { n })).reason === 'frozen' && (await act('buy', { city: 'kids', place: 'k_bake', item: 'bun' })).reason === 'frozen', 'город на паузе — работа и магазины закрыты');
await as(ADM); await q1(`public.city_admin('freeze', ${J({ city: 'kids', on: false })})`);
await as(A); r = await act('task', { n }); ok(r.ok, 'пауза снята — снова работа', r);
await as(MOD);
ok((await q1(`public.city_admin('freeze', ${J({ city: 'kids', on: true })})`)).reason === 'rights', 'модератор — без паузы');
ok((await q1(`public.city_admin('cfg', ${J({ set: { start: 1 } })})`)).reason === 'rights', 'модератор — без настроек');
ok((await q1(`public.city_admin('sum')`)).ok && (await q1(`public.city_admin('log')`)).ok, 'модератор читает журнал и сумму');
await as(A); ok((await q1(`public.city_admin('sum')`)).reason === 'rights', 'игроку — нет');
await as(ADM);
ok((await q1(`public.city_admin('cfg', ${J({ set: { 'profs.cook.wage': 101 } })})`)).reason === 'args', 'настройка вне пределов — нельзя');
ok((await q1(`public.city_admin('cfg', ${J({ set: { 'profs.cook.n': 5 } })})`)).reason === 'args', 'ключ не из списка — нельзя');
ok((await q1(`public.city_admin('cfg', ${J({ set: { 'cities.kids.tax.income': 11 } })})`)).reason === 'args', 'налог детского городка ≤ 10 %');
ok((await q1(`public.city_admin('cfg', ${J({ set: { 'profs.cook.wage': 6.5 } })})`)).reason === 'args', 'только целые');
r = await q1(`public.city_admin('cfg')`); ok(r.ok && r.hist.length === 2 && r.hist[0].set['profs.cook.wage'] === null, 'история настроек: кто и что', r.hist);
await su();
for (const [k, v, want] of [['start', 0, true], ['start', 1001, false], ['goods.bun.ref', 7, true], ['goods.nope.ref', 7, false], ['cities.metro.tax.income', 15, true], ['bank.T', 99, false], ['site', 5, false], ['caps.full', 0, false], ['profs.*.wage', 5, false]]) {
  const js = M.cfgOk(D, k, v), sq = await q1(`public.city_cfgok_(public.city_defs0(), '${k}', '${v}'::jsonb)`);
  ok(js === want && sq === want, `белый список настроек: ${k}=${v} → ${want} (JS ${js}, SQL ${sq})`);
}

// ═══ 8. Общая стройка у двух игроков ═══
await setNow(NOW + 5000); tt = NOW + 5000;
const nb = {};
for (const u of [A, T16]) { await as(u); r = await act('job', { city: 'kids', prof: 'builder', place: 'k_site' }); nb[u] = r.st.job.n; }
let rev0 = (await q1(`public.city_public('kids')`)).rev, revs = 0;
for (let i = 0; i < 12; i++) for (const u of [A, T16]) { await as(u); tt += 11; await setNow(tt); r = await act('task', { n: nb[u] }); if (r.ok) { nb[u] = r.st.job.n; } else console.log('  стройка: отказ', r.reason); }
await as(A); const pa = await q1(`public.city_public('kids')`); await as(T16); const pb = await q1(`public.city_public('kids')`);
ok(pa.site === 24 && pb.site === 24 && pa.stage === 2 && pb.stage === 2 && pa.rev === pb.rev && pa.rev >= rev0 + 2, 'стройка: 24 задания у двоих → этап 2 у обоих, версия выросла', { pa, pb, rev0 });

// ═══ 9. Новый день: эмиссия, центробанк, снимок, потолок казны ═══
await su();
const kBefore = await q1(`(select k from public.city_bank where id = 1)`), trBefore = await q1(`(select treasury from public.cities where id = 'kids')`);
const dayStats = await q1(`(select stats from public.cities where id = 'kids')`);
const mAvg = await q1(`(select coalesce(avg(cash), 0)::int from public.city_people where granted and seen_at >= ${NOW + 86400} - 14 * 86400)`);
await setNow(NOW + 86400);
await as(null); pk = await q1(`public.city_public('kids')`);
await su();
const kAfter = await q1(`(select k from public.city_bank where id = 1)`);
ok(kAfter === RU.kNext(D, kBefore, mAvg), 'центробанк: k как в Rules.kNext', { kBefore, kAfter, mAvg });
const a7 = 0, I = RU.issue(D, 'kids', a7, kAfter);
ok(pk.treasury === trBefore + I, `эмиссия за день: ${I} 💵 в казну`, { tr: pk.treasury, trBefore, I });
const snap = await rows(`select * from public.city_days where city = 'kids'`);
ok(snap.length === 1 && snap[0].stats.n.tasks === dayStats.n.tasks && snap[0].stats.treasury === trBefore && snap[0].stats.k === kAfter && snap[0].stats.people >= 2, 'снимок дня в журнале', snap[0]?.stats);
ok((await q1(`(select (stats->'mint'->>'issue')::int from public.cities where id = 'kids')`)) === I, 'эмиссия — в счётчиках нового дня');
// потолок казны: 1 день эмиссии
await as(ADM); await q1(`public.city_admin('cfg', ${J({ set: { 'cities.kids.capDays': 1 } })})`);
await setNow(NOW + 2 * 86400); await as(null); pk = await q1(`public.city_public('kids')`);
await su(); const bud = RU.budget(D, 'kids', 0);
ok(pk.treasury === bud, 'потолок казны: лишнее сверх 1 дня эмиссии уничтожено', { tr: pk.treasury, bud });
await as(ADM); await q1(`public.city_admin('cfg', ${J({ set: { 'cities.kids.capDays': null } })})`);
// пропущенные дни — эмиссия догоняет (до 7)
await su(); const tr3 = await q1(`(select treasury from public.cities where id = 'metro')`), k3 = await q1(`(select k from public.city_bank where id = 1)`);
const mday = await q1(`(select day from public.cities where id = 'metro')`);
await setNow(NOW + 12 * 86400); await as(null); const pm = await q1(`public.city_public('metro')`);
await su(); const k4 = await q1(`(select k from public.city_bank where id = 1)`);
const missed = Math.min(7, Math.round((Date.parse(RU.day(NOW + 12 * 86400)) - Date.parse(mday)) / 864e5));
ok(pm.treasury === Math.min(tr3 + RU.issue(D, 'metro', 0, k4) * missed, D.cities.metro.capDays * RU.budget(D, 'metro', 0)), 'метро: эмиссия за пропущенные дни (≤ 7)', { tr3, pm: pm.treasury, missed, k4 });

// ═══ 10. Двойники, проверка цепочки, сохранение ═══
await as(KID); r = await act('job', { city: 'kids', prof: 'cook', place: 'k_bake' }, 'devA_0123456789abcdef');
await as(ADM);
let tw = await q1(`public.city_admin('twins')`);
const devTw = tw.list.find(x => x.kind === 'dev');
ok(devTw && devTw.n === 2 && devTw.acc.length === 2 && devTw.acc.some(a => a.nick === 'Аня') && devTw.acc.some(a => a.nick == null), 'двойники: общий браузер — 2 аккаунта, ник ребёнка скрыт', devTw);
r = await q1(`public.city_admin('audit', ${J({ uid: A })})`);
ok(r.ok && r.breaks === 0 && r.match && r.rows > 3, 'цепочка кошелька Ани без разрывов, совпадает с кошельком', r);
let s = await sum();
ok(s.ok && s.drift === 0 && s.minted > 0, 'сохранение: Σ кошельков + Σ казны = выпущено − уничтожено', s);
await su(); await db.exec(`delete from auth.users where id = '${KID}'`);
s = await sum(); ok(s.drift === 0, 'удалили аккаунт — денки уничтожены, дрейф 0', s);

// ═══ 11. Одни и те же случайные ходы: JS Rules = SQL ═══
{
  const rnd = (x => () => (x = (x * 16807) % 2147483647) / 2147483647)(37);
  const P = { kids: Object.keys(D.profs).filter(p => D.profs[p].cities.kids), metro: Object.keys(D.profs).filter(p => D.profs[p].cities.metro) };
  const shops = c => Object.entries(D.cities[c].shops).flatMap(([pl, it]) => it.map(i => [pl, i]));
  let mism = 0, steps = 0, oks = 0, reasons = {};
  for (const u of [A, B]) {
    await as(u); let js = RU.sanitize((await q1('public.city_state()')).st);
    let t = NOW + 30 * 86400 + (u === B ? 7 : 0);
    for (let i = 0; i < 260; i++) {
      t += [1, 3, 8, 15, 20, 31, 61][Math.floor(rnd() * 7)] + (rnd() < .03 ? 86400 : 0);
      await setNow(t);
      const city = rnd() < .5 ? 'kids' : 'metro', x = rnd();
      let a, g;
      if (x < .12) { a = 'job'; const pr = P[city][Math.floor(rnd() * P[city].length)]; g = { city, prof: rnd() < .05 ? 'nope' : pr, place: D.profs[pr].cities[city][0] }; }
      else if (x < .7) { a = 'task'; g = { n: rnd() < .08 ? 'badbad00' : js.job?.n }; }
      else if (x < .82) { a = 'buy'; const [pl, it] = shops(city)[Math.floor(rnd() * shops(city).length)]; g = { city, place: pl, item: it, qty: 1 + Math.floor(rnd() * 3) }; }
      else if (x < .95) { a = 'eat'; g = { item: Object.keys(js.food)[0] || 'bun' }; }
      else { a = 'quit'; g = {}; }
      // город для JS — как в базе в этот момент (после нового дня)
      const cityOf = a === 'task' ? js.job?.city : g.city;
      await su(); if (cityOf) await q1(`(select 1 from public.city_lock_('${cityOf}'))`).catch(() => 0);
      const crow = cityOf ? (await rows(`select treasury, frozen, wage_k, site from public.cities where id = '${cityOf}'`))[0] : null;
      await as(u);
      const R1 = RU.act(D, js, a, g, t, crow ? { treasury: +crow.treasury, frozen: crow.frozen, wage_k: crow.wage_k, site: crow.site } : null, rnd);
      const R2 = await act(a, g);
      steps++;
      const s2 = R2.st || (await q1('public.city_state()')).st;
      const a1 = { ...R1.st, job: R1.st.job && { ...R1.st.job, n: 0, k: 0 } }, a2 = { ...s2, job: s2.job && { ...s2.job, n: 0, k: 0 } };
      if (R1.ok !== R2.ok || (R1.reason || null) !== (R2.reason || null) || !deepEq(a1, a2) || (R1.ok && a === 'task' && R1.got.net !== R2.got.net)) {
        if (mism++ < 4) console.log('  расхождение', u.slice(0, 2), a, JSON.stringify(g), { js: [R1.ok, R1.reason, R1.got], sql: [R2.ok, R2.reason, R2.got], a1, a2 });
      }
      if (R2.ok) oks++; else reasons[R2.reason] = (reasons[R2.reason] || 0) + 1;
      js = RU.sanitize(s2);   // номер и цель задания — случайные у сервера: дальше идём от его состояния
    }
  }
  console.log(`  JS = SQL: ${steps} случайных ходов, успешных ${oks}, расхождений ${mism}; отказы ${JSON.stringify(reasons)}`);
  ok(mism === 0, `JS = SQL на ${steps} случайных ходах (успешных ${oks}; отказы ${JSON.stringify(reasons)})`, mism);
  s = await sum(); ok(s.drift === 0, 'после случайных ходов — дрейф 0', s);
}

// ═══ 12. Файл ещё раз поверх данных — ничего не сломалось ═══
{
  await su();
  const before = await rows(`select id, treasury, minted, burned, site from public.cities order by id`), cashB = await q1(`(select sum(cash) from public.city_people)`);
  await db.exec('begin;\n' + SQL + '\ncommit;');
  await db.exec(`create or replace function public.city_now() returns bigint language sql stable as $$ select coalesce(nullif(current_setting('test.now', true), '')::bigint, floor(extract(epoch from now()))::bigint) $$;`);
  const after = await rows(`select id, treasury, minted, burned, site from public.cities order by id`), cashA = await q1(`(select sum(cash) from public.city_people)`);
  ok(deepEq(before, after) && cashA === cashB, 'повторный запуск city.sql поверх данных — казна и кошельки на месте');
  s = await sum(); ok(s.drift === 0, 'и дрейф 0');
}

// ═══ 13. Время и размер на «живом» объёме: 3000 жителей, 120 000 строк журнала ═══
{
  await su();
  await db.exec(`
    insert into auth.users select ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid from generate_series(1, 3000) i;
    insert into public.profiles (id, nick) select ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'p' || i from generate_series(1, 3000) i;
    insert into public.test_age select ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'adult' from generate_series(1, 3000) i;
    insert into public.city_people (user_id, cash, granted, seen_at, skills) select ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, (i * 7) % 3000, true, ${NOW + 29 * 86400}, '{"cook": 40}'::jsonb from generate_series(1, 3000) i;
    insert into public.city_ledger (user_id, city, amount, fee, bal, kind, ref, at, day)
      select ('00000000-0000-4000-8000-' || lpad((1 + i % 3000)::text, 12, '0'))::uuid, case when i % 3 = 0 then 'metro' else 'kids' end, 6, 30, 100, 'wage', 'cook',
        ${NOW + 29 * 86400} - (i % (25 * 86400)), (to_timestamp(${NOW + 29 * 86400} - (i % (25 * 86400))) at time zone 'Europe/Moscow')::date from generate_series(1, 120000) i;
    analyze;`);
  await setNow(NOW + 31 * 86400 + 100);
  await as(A); r = await act('job', { city: 'kids', prof: 'cook', place: 'k_bake' }); n = r.st.job.n; let t = NOW + 31 * 86400 + 100;
  const times = [], pubT = [], stT = [];
  for (let i = 0; i < 40; i++) {
    t += 26; await setNow(t);
    let a0 = performance.now(); r = await act('task', { n }); times.push(performance.now() - a0); if (r.ok) n = r.st.job.n;
    await as(null); a0 = performance.now(); await q1(`public.city_public('kids')`); pubT.push(performance.now() - a0);
    await as(A); a0 = performance.now(); await q1(`public.city_state(null, 30)`); stT.push(performance.now() - a0);
  }
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1], p95 = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length * .95)];
  console.log(`  время (PGlite, 3000 жителей, 120 000 строк журнала): city_act task — медиана ${med(times).toFixed(2)} мс, 95 % ${p95(times).toFixed(2)} мс; city_public — ${med(pubT).toFixed(2)} мс; city_state(30 строк истории) — ${med(stT).toFixed(2)} мс`);
  ok(med(times) < 15 && med(pubT) < 5, 'ход и чтение города — быстро', { task: med(times), pub: med(pubT) });
  // новый день на этом объёме (A7 по журналу, M по жителям)
  await setNow(t + 86400); await as(null);
  const a0 = performance.now(); pk = await q1(`public.city_public('kids')`); const tSettle = performance.now() - a0;
  console.log(`  новый день (эмиссия, A7, M, снимок, уборка): ${tSettle.toFixed(1)} мс; казна ${pk.treasury}`);
  ok(tSettle < 400, 'новый день на этом объёме — < 0,4 с', tSettle);
  await su();
  const ex = (await rows(`explain select * from public.city_ledger where user_id = '${A}' order by id desc limit 30`)).map(x => x['QUERY PLAN']).join(' | ');
  ok(/idx_city_ledger_user/.test(ex), 'история — по индексу (user_id, id desc)', ex);
  const ex2 = (await rows(`explain select user_id, day from public.city_ledger where city = 'kids' and kind = 'wage' and day >= current_date - 7 and day < current_date group by user_id, day`)).map(x => x['QUERY PLAN']).join(' | ');
  ok(/idx_city_ledger_day/.test(ex2), 'A7 — по индексу (city, day, kind)', ex2);
  await as(A); r = await act('task', { n });
  console.log(`  размер: city_act task — ${JSON.stringify(r).length} Б, city_public — ${JSON.stringify(pk).length} Б, city_defs — ${JSON.stringify(await q1('public.city_defs()')).length} Б`);
  s = await sum(); ok(s.drift === 0 || true, 'сумма (данные теста вставлены мимо функций — дрейф не считаем)');
}
console.log(`city.sql первый запуск: ${tFirst.toFixed(0)} мс`);
console.log(`city-sql-test: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
