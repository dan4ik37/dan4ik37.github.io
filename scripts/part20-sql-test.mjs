// AUTH_SOCIAL (владелец 25.11): community.sql ч. 20 (❤ на сайте у роликов и стрима) на PGlite (Postgres в памяти — без сети и без
// настоящей базы). Заглушки: auth.users, auth.uid(), site_config, роли anon / authenticated. Ч. 20 выполняется ДВАЖДЫ (идемпотентность).
// Запуск из корня сайта: node scripts/part20-sql-test.mjs (PGLITE_PATH / DEPS_DIR)
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
async function findPglite() {
  const cands = [process.env.PGLITE_PATH, process.env.DEPS_DIR, 'M:/d37/claude-tmp/t157/deps', path.join(os.tmpdir(), 'd37-pglite'), path.join(SITE, '..', 'd37-pglite'), SITE].filter(Boolean);
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
  const msg = 'part20-sql-test: PGlite не найден — SQL-проверки пропущены (PGLITE_PATH=… или DEPS_DIR=…)';
  if (process.env.CI_STRICT) { console.log('FAIL ' + msg); process.exit(1); }
  console.log('SKIP ' + msg); process.exit(0);
}
const ALL = fs.readFileSync(path.join(SITE, 'community.sql'), 'utf8').replace(/\r\n/g, '\n');
const k0 = ALL.indexOf('\n-- ЧАСТЬ 20 ');
if (k0 < 0) { console.log('FAIL part 20 not found'); process.exit(1); }
const PART = ALL.slice(ALL.lastIndexOf('\n-- ═', k0));

let n = 0, fails = 0;
const ok = (c, m, x) => { n++; if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
const db = new PGlite();
const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b';
await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key);
create table cur(u uuid); insert into cur values (null);
create function auth.uid() returns uuid language sql as 'select u from cur';
create table public.site_config(key text primary key, value text);
alter table public.site_config enable row level security;
insert into auth.users values ('${A}'), ('${B}');`);
await db.exec(PART);
await db.exec(PART);   // второй раз — без ошибок и без дублей
ok(true, 'ч. 20 выполняется дважды без ошибок');
// site-like.sql — та же ч. 20 отдельным файлом для владельца (вставить целиком с телефона): должна совпадать с community.sql
{
  const f = path.join(SITE, 'site-like.sql');
  const own = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n') : '';
  ok(own.endsWith(PART.slice(1)) && own.length - PART.length < 400, 'site-like.sql = конец community.sql (ч. 20) один в один');
  await db.exec(own);   // и сам файл выполняется (третий раз — без ошибок)
}
const as = async u => db.query(`update cur set u = ${u ? `'${u}'` : 'null'}`);
const call = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const like = async (kind, item, on) => (await call(`select public.site_like($1, $2${on === undefined ? '' : ', $3'}) r`, on === undefined ? [kind, item] : [kind, item, on])).r;
const info = async (kind, items) => (await call('select public.site_like_info($1, $2::text[]) r', [kind, items])).r;
const V = 'dQw4w9WgXcQ', V2 = 'abcdefghijk';

ok((await call('select public.part20_info() r')).r?.ok === true, 'part20_info → ok');
ok((await call(`select value from public.site_config where key = 'part20'`))?.value === '1', 'метка site_config part20 = 1 (одна строка)');
ok(+(await call(`select count(*) c from public.site_config where key = 'part20'`)).c === 1, 'метка не задвоилась');
ok(+(await call(`select count(*) c from pg_policies where policyname = 'site_config_part20_read'`)).c === 1, 'гость может читать метку (правило чтения есть)');

await as(null);
ok((await like('video', V)).reason === 'auth', 'гость не ставит ❤ (auth)');
let r = await info('video', [V]);
ok(r.ok && r.items[V].n === 0 && r.items[V].mine === false, 'гость видит число (0)', r);

await as(A);
r = await like('video', V);
ok(r.ok && r.liked === true && r.n === 1, 'A: ❤ поставлен (переключатель)', r);
r = await like('video', V, true);
ok(r.ok && r.liked === true && r.n === 1, 'A: «поставить» ещё раз — не дублирует и не снимает (p_on = true)', r);
r = await info('video', [V, V2, 'bad id!']);
ok(r.items[V].n === 1 && r.items[V].mine === true && r.items[V2].n === 0 && !('bad id!' in r.items), 'A: info — мой ❤ виден, плохой номер пропущен', r);
await as(B);
r = await like('video', V, true);
ok(r.n === 2, 'B: второй ❤ — 2', r);
r = await info('video', [V]);
ok(r.items[V].mine === true && r.items[V].n === 2, 'B видит свой ❤ и число', r);
r = await like('video', V);
ok(r.liked === false && r.n === 1, 'B: повторно — убрал', r);
r = await like('video', V, false);
ok(r.liked === false && r.n === 1, 'B: «убрать» без ❤ — ничего не ломает', r);
ok((await like('video', 'short')).reason === 'bad' && (await like('podcast', V)).reason === 'bad', 'неверный ролик / вид — bad');

// стрим: только сегодняшний день (live), другой день лайкнуть нельзя, прочитать — можно
r = await like('stream', 'live');
ok(r.ok && r.liked && r.n === 1, 'B: ❤ сегодняшнему стриму', r);
ok((await like('stream', 'tw-2020-01-01')).reason === 'bad', 'лайкнуть другой день нельзя');
const today = (await call(`select 'tw-' || to_char(now() at time zone 'Europe/Moscow', 'YYYY-MM-DD') d`)).d;
r = await info('stream', ['live', today]);
ok(r.items.live.n === 1 && r.items[today].n === 1 && r.items.live.mine, 'info: live = сегодняшний день', r);

// защита от мусора: 300 новых ❤ за сутки от одного человека, дальше — slow; убрать свой ❤ можно всегда; старые ❤ в счёт не идут
await db.exec(`insert into public.site_likes (kind, item, user_id) select 'video', 'x' || lpad(g::text, 10, '0'), '${B}' from generate_series(1, 300) g`);
r = await like('video', V2, true);
ok(r.ok === false && r.reason === 'slow', 'B: больше 300 новых ❤ за сутки — slow', r);
r = await like('stream', 'live', false);
ok(r.ok && r.liked === false, 'B: убрать свой ❤ при этом можно', r);
await db.exec(`update public.site_likes set created_at = now() - interval '2 days' where user_id = '${B}'`);
r = await like('video', V2, true);
ok(r.ok && r.liked === true, 'B: вчерашние и старше ❤ в суточный счёт не идут', r);
await db.exec(`delete from public.site_likes where user_id = '${B}'`);

// напрямую таблицу не прочитать и не записать
let denied = false;
try { await db.exec(`set role authenticated; insert into public.site_likes (kind, item, user_id) values ('video', '${V2}', '${A}');`); } catch (e) { denied = true; }
await db.exec('reset role');
ok(denied, 'напрямую в таблицу писать нельзя (только через функции)');
denied = false;
try { await db.exec(`set role anon; select * from public.site_likes;`); } catch (e) { denied = true; }
await db.exec('reset role');
ok(denied, 'гость таблицу не читает (кто поставил ❤ — не видно)');
denied = false;
try { await db.exec(`set role anon; select public.site_like('video', '${V}');`); } catch (e) { denied = true; }
await db.exec('reset role');
ok(denied, 'site_like гостю (anon) не выдана вовсе');

// удалили аккаунт — его ❤ уходят
await db.exec(`delete from auth.users where id = '${A}'`);
await as(null);
r = await info('video', [V]);
ok(r.items[V].n === 0, 'аккаунт удалён — его ❤ тоже', r);

console.log(`\npart20-sql-test: ${n - fails} ок, ${fails} ошибок`);
process.exit(fails ? 1 : 0);
