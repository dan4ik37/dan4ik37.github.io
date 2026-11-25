// T-176 S3: community.sql ч. 19 («Арена» студии: сохранить, выложить за 500 🪙, по мотивам, автоскрытие) на PGlite (Postgres в памяти —
// без сети и без настоящей базы). Настоящие: ugc.sql (таблицы и функции игр игроков, до «СВОИ 3D-МОДЕЛИ»), фильтр слов comm_norm /
// comm_bad / comm_has_link из community.sql. Заглушки: profiles, auth.uid(), кошелёк монет (coin_wallet / coin_log как в coins.sql),
// колонки возраста (как age.sql). Ч. 19 выполняется ДВАЖДЫ (идемпотентность).
// Запуск из корня сайта: node scripts/part19-sql-test.mjs (PGLITE_PATH / DEPS_DIR)
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
  const msg = 'part19-sql-test: PGlite не найден — SQL-проверки пропущены (PGLITE_PATH=… или DEPS_DIR=…)';
  if (process.env.CI_STRICT) { console.log('FAIL ' + msg); process.exit(1); }
  console.log('SKIP ' + msg); process.exit(0);
}
const rd = f => fs.readFileSync(path.join(SITE, f), 'utf8').replace(/\r\n/g, '\n');
const ALL = rd('community.sql');
const k0 = ALL.indexOf('\n-- ЧАСТЬ 19 ');
if (k0 < 0) { console.log('FAIL part 19 not found'); process.exit(1); }
const k20 = ALL.indexOf('\n-- ЧАСТЬ 20 ');   // ч. 20 (❤ на сайте) — своя проверка, scripts/part20-sql-test.mjs
const PART = ALL.slice(ALL.lastIndexOf('\n-- ═', k0), k20 > 0 ? ALL.lastIndexOf('\n-- ═', k20) : undefined);
const fn = (src, name) => { const a = src.indexOf('create or replace function public.' + name + '('); const b = src.indexOf('$$;', src.indexOf('$$', a) + 2); if (a < 0 || b < 0) throw new Error('no ' + name); return src.slice(a, b + 3); };
const WORDS = ['comm_norm', 'comm_bad', 'comm_has_link'].map(x => fn(ALL, x)).join('\n');
const UGC0 = rd('ugc.sql');
const UGC = UGC0.slice(0, UGC0.indexOf('--  СВОИ 3D-МОДЕЛИ'));

let n = 0, fails = 0;
const ok = (c, m, x) => { n++; if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
const db = new PGlite();
const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', MOD = '00000000-0000-4000-8000-00000000000c',
  R1 = '00000000-0000-4000-8000-000000000001', R2 = '00000000-0000-4000-8000-000000000002', R3 = '00000000-0000-4000-8000-000000000003';
await db.exec(`create role anon; create role authenticated; create schema auth;
create table cur(u uuid); insert into cur values (null);
create function auth.uid() returns uuid language sql as 'select u from cur';
create table public.profiles(id uuid primary key, role text default 'user', nick text);
create table public.coin_wallet(user_id uuid primary key references public.profiles(id), coins int not null default 0 check (coins >= 0), items text[] not null default '{}', updated_at timestamptz not null default now());
create table public.coin_log(id bigint generated always as identity primary key, user_id uuid not null, amount int not null, source text not null, ref text not null default '', day date not null default current_date, created_at timestamptz not null default now());
create function public.coin_today() returns date language sql stable as 'select current_date';
create function public.coin_add(p_uid uuid, p_amount int, p_source text, p_ref text default '') returns int language plpgsql as $$
declare bal int; begin insert into public.coin_wallet (user_id, coins) values (p_uid, greatest(p_amount, 0)) on conflict (user_id) do update set coins = public.coin_wallet.coins + p_amount returning coins into bal;
insert into public.coin_log (user_id, amount, source, ref) values (p_uid, p_amount, p_source, coalesce(p_ref, '')); return bal; end $$;
create table public.site_config(key text primary key, value text);
insert into public.profiles(id, role, nick) values ('${A}','user','a'),('${B}','user','b'),('${MOD}','moderator','m'),('${R1}','user','r1'),('${R2}','user','r2'),('${R3}','user','r3');
insert into public.coin_wallet(user_id, coins) values ('${A}', 1200), ('${B}', 499);`);
await db.exec(WORDS);
await db.exec(UGC);
await db.exec(`alter table public.ugc_games add column if not exists age_rating smallint not null default 12;
alter table public.ugc_games add column if not exists age_mod boolean not null default false;`);
// старая игра (вид tpl) — до части 19: должна остаться как была
await db.exec(`update cur set u = '${A}';`);
const rpc = async (who, f, args) => { await db.query('update cur set u = $1', [who]); const r = await db.query(`select public.${f}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as r`, args); return r.rows[0].r; };
const slow = () => db.exec(`update public.ugc_games set created_at = created_at - interval '1 minute', updated_at = updated_at - interval '1 minute'`);
const old = await rpc(A, 'ugc_save', ['', 'Старая игра', '', '🎮', 'tpl', 'runner', '{"a":1}', null]);
ok(old.ok, 'старый ugc_save (tpl) работает до части 19', old);
await slow();

await db.exec(PART); await db.exec(PART);
ok(true, 'часть 19 выполнена дважды');
ok((await rpc(null, 'part19_info', [])).v === 1, 'part19_info → v 1');
ok((await db.query(`select value from public.site_config where key = 'part19'`)).rows[0]?.value === '1', 'метка site_config part19 = 1');
const oldRow = (await db.query(`select kind, status, data from public.ugc_games where id = $1`, [old.id])).rows[0];
ok(oldRow.kind === 'tpl' && oldRow.status === 'draft' && oldRow.data.a === 1, 'старая игра не изменилась', oldRow);
const old2 = await rpc(A, 'ugc_save', ['', 'Старая 2', '', '🎮', 'html', null, null, '<html><body>hello world game</body></html>']);
ok(old2.ok, 'старый ugc_save (html) работает после части 19', old2);
ok((await rpc(A, 'ugc_save', ['', 'Арена через старое', '', '⚡', 'arena', null, '{"format":1}', null])).reason === 'kind', 'старый ugc_save не принимает вид arena');
await slow();

const FILE = { format: 1, kind: 'arena', engine_min: 1, arena: { kernel: 'free' }, rules: [], objects: [], laws: [], texts: { t1: 'Привет' } };
ok((await rpc(null, 'ugc_arena_save', ['', 'Гость', '', '⚡', JSON.stringify(FILE), 12])).reason === 'auth', 'гость не сохраняет');
ok((await rpc(null, 'ugc_arena_publish', ['x'])).reason === 'auth', 'гость не выкладывает');
ok((await rpc(A, 'ugc_arena_save', ['', 'Плохо', '', '⚡', JSON.stringify({ ...FILE, texts: { t1: 'ну бля' } }), 12])).reason === 'words', 'фильтр слов — текст внутри файла');
ok((await rpc(A, 'ugc_arena_save', ['', 'Иди на example.com', '', '⚡', JSON.stringify(FILE), 12])).reason === 'words', 'фильтр ссылок — название');
ok((await rpc(A, 'ugc_arena_save', ['', 'Большая', '', '⚡', JSON.stringify({ ...FILE, texts: { t1: 'я'.repeat(40000) } }), 12])).reason === 'data', 'больше 64 КБ — отказ');
ok((await rpc(A, 'ugc_arena_save', ['', 'Без формата', '', '⚡', '{"kind":"arena"}', 12])).reason === 'data', 'не файл режима — отказ');
ok((await rpc(A, 'ugc_arena_save', ['', 'Возраст', '', '⚡', JSON.stringify(FILE), 18])).reason === 'age', 'метка 18 автору нельзя');
const s1 = await rpc(A, 'ugc_arena_save', ['', 'Моя арена', 'Описание', '⚡', JSON.stringify(FILE), null]);
ok(s1.ok && s1.status === 'draft', 'арена сохранена черновиком', s1);
const id = s1.id;
ok((await rpc(A, 'ugc_arena_publish', [id])).reason === 'age', 'без выбранной метки возраста выложить нельзя');
ok((await rpc(B, 'ugc_arena_publish', [id])).reason === 'not_found', 'чужую арену выложить нельзя');
ok((await rpc(A, 'ugc_arena_publish', [old.id])).reason === 'kind', 'не арену этой функцией не выложить (вид)');
ok((await rpc(A, 'ugc_status', [id, 'link'])).status === 'link', 'ссылка для друзей — старой ugc_status');
ok((await rpc(A, 'ugc_arena_save', [id, 'Моя арена', 'Описание', '⚡', JSON.stringify(FILE), 6])).ok, 'метка 6+ выбрана');
const p1 = await rpc(A, 'ugc_arena_publish', [id]);
ok(p1.ok && p1.charged === 500 && p1.coins === 700, 'выложено: списано 500, осталось 700', p1);
let row = (await db.query(`select status, unchecked, paid_at from public.ugc_games where id = $1`, [id])).rows[0];
ok(row.status === 'public' && row.unchecked && row.paid_at, 'в каталоге, «не проверено»', row);
const p2 = await rpc(A, 'ugc_arena_publish', [id]);
ok(p2.ok && p2.charged === 0, 'второй раз — без списания', p2);
await slow();
ok((await rpc(A, 'ugc_arena_save', [id, 'Моя арена 2', 'Описание', '⚡', JSON.stringify({ ...FILE, texts: { t1: 'Новое' } }), null])).status === 'public', 'правка выложенной: статус public, без проверки');
await rpc(A, 'ugc_status', [id, 'hidden']);
const p3 = await rpc(A, 'ugc_arena_publish', [id]);
ok(p3.ok && p3.charged === 0, 'скрыл и снова выложил — без списания', p3);
let w = (await db.query(`select coins from public.coin_wallet where user_id = $1`, [A])).rows[0].coins;
let logs = (await db.query(`select count(*)::int c, sum(amount)::int s from public.coin_log where user_id = $1 and source = 'ugc_publish'`, [A])).rows[0];
ok(w === 700 && logs.c === 1 && logs.s === -500, 'в журнале одна запись −500, кошелёк 700', { w, logs });

// не хватает монет
await db.exec(`update public.ugc_games set created_at = created_at - interval '1 minute'`);
const sb = await rpc(B, 'ugc_arena_save', ['', 'Арена Б', '', '⚡', JSON.stringify({ ...FILE, texts: { t1: 'Б' } }), 0]);
const pb = await rpc(B, 'ugc_arena_publish', [sb.id]);
ok(!pb.ok && pb.reason === 'coins' && pb.coins === 499 && pb.price === 500, 'не хватает монет — отказ', pb);
ok((await db.query(`select coins from public.coin_wallet where user_id = $1`, [B])).rows[0].coins === 499, 'монеты не тронуты');
ok((await db.query(`select status from public.ugc_games where id = $1`, [sb.id])).rows[0].status === 'draft', 'статус не тронут');

// копирования нет; клон чужой выложенной арены не выкладывается, своя копия — можно
ok(!/ugc_arena_remix/.test((await db.query(`select string_agg(proname, ',') s from pg_proc`)).rows[0].s), 'функции «по мотивам» нет');
await slow();
const pubData = JSON.stringify((await db.query(`select data from public.ugc_games where id = $1`, [id])).rows[0].data);
await db.exec(`update public.coin_wallet set coins = 900 where user_id = '${B}'`);
const cl = await rpc(B, 'ugc_arena_save', ['', 'Клон', '', '⚡', pubData, 12]);
const pr = await rpc(B, 'ugc_arena_publish', [cl.id]);
ok(!pr.ok && pr.reason === 'clone', 'клон чужой выложенной арены — отказ', pr);
ok((await db.query(`select coins from public.coin_wallet where user_id = $1`, [B])).rows[0].coins === 900, 'за отказ «клон» монеты не списаны');
await slow();
await rpc(B, 'ugc_arena_save', [cl.id, 'Своя', '', '⚡', JSON.stringify({ ...FILE, texts: { t1: 'Моё' } }), 12]);
const pr2 = await rpc(B, 'ugc_arena_publish', [cl.id]);
ok(pr2.ok && pr2.charged === 500, 'свой другой режим выложен', pr2);
await slow();
const own = await rpc(A, 'ugc_arena_save', ['', 'Моя копия', '', '⚡', pubData, 12]);
const po = await rpc(A, 'ugc_arena_publish', [own.id]);
ok(po.ok && po.charged === 500, 'копия своей же арены — можно', po);

// жалобы → автоскрытие
for (const r of [R1, R2]) await rpc(r, 'ugc_report', [id, 'x']);
ok((await db.query(`select held, status from public.ugc_games where id = $1`, [id])).rows[0].held === false, '2 жалобы — ещё видна');
await rpc(R3, 'ugc_report', [id, 'x']);
row = (await db.query(`select held, status from public.ugc_games where id = $1`, [id])).rows[0];
ok(row.held && row.status === 'review', '3 жалобы — скрыта до модератора', row);
ok((await rpc(A, 'ugc_arena_publish', [id])).reason === 'held', 'автор не выложит скрытую сам');
await rpc(A, 'ugc_status', [id, 'link']);
ok((await db.query(`select status from public.ugc_games where id = $1`, [id])).rows[0].status === 'review', 'и «по ссылке» сам не вернёт');
await db.query('update cur set u = $1', [R1]);
await db.exec('grant usage on schema auth to authenticated; grant select on cur to authenticated; grant execute on function auth.uid() to authenticated; set role authenticated');
const vis = (await db.query(`select count(*)::int c from public.ugc_games where id = '${id}'`)).rows[0].c;
await db.exec('reset role');
ok(vis === 0, 'скрытая не видна другим (правило чтения)', vis);
const rv = await rpc(MOD, 'ugc_review', [id, 'public']);
row = (await db.query(`select held, status, unchecked, reports from public.ugc_games where id = $1`, [id])).rows[0];
ok(rv.ok && !row.held && row.status === 'public' && !row.unchecked && row.reports === 0, 'модератор вернул: видна, «проверено»', row);
ok((await rpc(MOD, 'ugc_review', [id, 'banned'])).ok && (await rpc(A, 'ugc_arena_publish', [id])).reason === 'banned', 'модератор убрал — автор не вернёт');
// выключатели
await db.exec(`update public.ugc_arena_rules set value = 0 where key = 'words'`);
ok((await rpc(R1, 'ugc_arena_save', ['', 'Слова выкл', '', '⚡', JSON.stringify({ ...FILE, texts: { t1: 'бля' } }), 12])).ok, 'фильтр слов выключается строкой правил');
await db.exec(`update public.ugc_arena_rules set value = 1 where key = 'words'`);

console.log(`\npart19-sql-test: ${n - fails}/${n} ${fails ? 'FAIL' : 'OK'}`);
process.exit(fails ? 1 : 0);
