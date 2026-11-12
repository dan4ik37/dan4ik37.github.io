// T-141 📎 файлы: community.sql ч. 9 (msg_attach, file_cfg, file_blocked, file_report, file_block_set, триггеры att) на PGlite с заглушками
// живых таблиц; часть выполняется дважды (идемпотентно). Запуск из корня сайта: node scripts/files-sql-test.mjs (PGLITE_PATH / DEPS_DIR)
import fs from 'fs'; import os from 'os'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
async function findPglite() {
  const cands = [process.env.PGLITE_PATH, process.env.DEPS_DIR, path.join(os.tmpdir(), 'd37-pglite'), path.join(SITE, '..', 'd37-pglite'), SITE].filter(Boolean);
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
  const msg = 'files-sql-test: PGlite не найден — SQL-проверки пропущены (PGLITE_PATH=… или DEPS_DIR=…)';
  if (process.env.CI_STRICT) { console.log('FAIL ' + msg); process.exit(1); }
  console.log('SKIP ' + msg);
  process.exit(0);
}

let sql = fs.readFileSync(path.join(SITE, 'community.sql'), 'utf8'); const k0 = sql.indexOf('-- ═══ 9. 📎'); sql = sql.slice(k0);
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create table cur(u uuid); insert into cur values (null);
create function auth.uid() returns uuid language sql as 'select u from cur';
create table auth.users(id uuid primary key);
create table public.profiles(id uuid primary key, role text);
create table public.site_config(key text primary key, value text);
create table public.messages(id bigint generated always as identity primary key, user_id uuid, text text, deleted boolean default false, created_at timestamptz default now());
create table public.community_messages(id bigint generated always as identity primary key, community_id bigint, user_id uuid, text text, deleted boolean default false, created_at timestamptz default now());
create table public.community_members(community_id bigint, user_id uuid);
create table public.direct_messages(id bigint generated always as identity primary key, sender_id uuid, recipient_id uuid, text text, created_at timestamptz default now());
create table public.user_age(user_id uuid primary key, birth_year int, u9_until timestamptz);
create function public.age_year_now() returns int language sql as 'select extract(year from now())::int';
create function public.age_u9(p_uid uuid) returns boolean language sql stable as $$ select coalesce((select (a.birth_year is not null and public.age_year_now() - a.birth_year - 1 < 9) from public.user_age a where a.user_id = p_uid), false) $$;
create function public.chat_staff_role(p_uid uuid default auth.uid()) returns text language sql stable as $$ select role from public.profiles where id = p_uid and role in ('admin','moderator','helper') $$;`);
await db.exec(sql); await db.exec(sql);
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222', K = '33333333-3333-3333-3333-333333333333', M = '44444444-4444-4444-4444-444444444444';
await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${K}'),('${M}'); insert into profiles values ('${A}', null),('${B}', null),('${K}', null),('${M}','moderator');
insert into user_age values ('${K}', extract(year from now())::int - 7, null);
insert into messages(user_id, text) values ('${A}', 'x'), ('${B}', 'y'); insert into community_messages(community_id, user_id, text) values (5, '${A}', 'z');
insert into community_members values (5, '${A}'); insert into direct_messages(sender_id, recipient_id, text) values ('${A}', '${B}', 'dm'), ('${A}', '${K}', 'dm kid');`);
const as = async u => db.exec(`update cur set u = ${u ? `'${u}'` : 'null'}`);
const q = async s => (await db.query(s)).rows[0].r;
const h = 'a'.repeat(64);
const att = o => `'${JSON.stringify(Object.assign({ v: 1, enc: 'none', kid: '', name: 'cat.png', size: 1000, mime: 'image/png', chash: h, phash: h }, o))}'::jsonb`;
let n = 0, bad = 0; const t = (c, m, x) => { n++; if (!c) { bad++; console.log('FAIL', m, x ?? ''); } };
await as(null);
t((await q(`select public.msg_attach('chat', 1, ${att({})}) r`)).reason === 'auth', 'guest refused');
await as(A);
t((await q(`select public.msg_attach('chat', 1, ${att({ name: 'x.exe', mime: 'application/x-msdownload' })}) r`)).reason === 'type', 'exe refused');
t((await q(`select public.msg_attach('chat', 1, ${att({ name: 'a.svg', mime: 'image/svg+xml' })}) r`)).reason === 'type', 'svg refused');
t((await q(`select public.msg_attach('chat', 1, ${att({ name: 'a.png', mime: 'image/jpeg' })}) r`)).reason === 'type', 'ext/mime mismatch refused');
t((await q(`select public.msg_attach('chat', 1, ${att({ size: 11 * 1048576 })}) r`)).reason === 'big', 'over file cap refused');
t((await q(`select public.msg_attach('chat', 1, ${att({ enc: 'aes' })}) r`)).reason === 'enc', 'enc other than none refused (T-155)');
t((await q(`select public.msg_attach('chat', 1, ${att({ thumb: 'data:text/html;base64,AAAA' })}) r`)).reason === 'thumb', 'html thumb refused');
t((await q(`select public.msg_attach('chat', 1, ${att({ evil: 1 })}) r`)).reason === 'bad', 'unknown key refused');
t((await q(`select public.msg_attach('chat', 2, ${att({})}) r`)).reason === 'not_found', 'not my message refused');
t((await q(`select public.msg_attach('chat', 1, ${att({ thumb: 'data:image/webp;base64,AAAA', w: 160, h: 90 })}) r`)).ok === true, 'chat attach ok');
t((await q(`select public.msg_attach('chat', 1, ${att({})}) r`)).reason === 'dup', 'second attach refused');
t((await q(`select public.msg_attach('cm', 1, ${att({ name: 'a.pdf', mime: 'application/pdf' })}) r`)).ok === true, 'community attach ok');
t((await q(`select public.msg_attach('dm', 1, ${att({ name: 'a.zip', mime: 'application/zip' })}) r`)).ok === true, 'dm attach ok');
t((await q(`select public.msg_attach('dm', 2, ${att({})}) r`)).reason === 'u9', 'dm to <9 refused');
await db.exec(`update messages set att = '{"v":1}' where id = 2`);
t((await db.query(`select att from messages where id = 2`)).rows[0].att === null, 'direct update of att ignored (trigger)');
await db.exec(`insert into messages(user_id, text, att) values ('${A}', 'w', '{"x":1}')`);
t((await db.query(`select att from messages order by id desc limit 1`)).rows[0].att === null, 'insert with att stripped (trigger)');
await db.exec(`update messages set created_at = now() - interval '5 minutes' where id = 3`);
t((await q(`select public.msg_attach('chat', 3, ${att({})}) r`)).reason === 'late', 'late attach refused');
await db.exec(`insert into site_config values ('chat_files', '{"day_n":3}')`);
await db.exec(`insert into messages(user_id, text) values ('${A}', 'm4')`);
t((await q(`select public.msg_attach('chat', 4, ${att({})}) r`)).reason === 'day', 'daily count cap from site_config');
await as(K); await db.exec(`insert into messages(user_id, text) values ('${K}', 'k')`);
t((await q(`select public.msg_attach('chat', 5, ${att({})}) r`)).reason === 'u9', '<9 cannot send');
await as(B);
t((await q(`select public.file_report('cm', 1, 'spam') r`)).reason === 'not_found', 'report of channel not visible refused');
t((await q(`select public.file_report('chat', 1, 'bad') r`)).ok === true, 'report ok');
t((await q(`select public.file_reports_list() r`)).length === 0, 'non-staff sees no reports');
t((await q(`select public.file_block_set('${h}', true) r`)).reason === 'perm', 'non-staff cannot block');
await as(M);
t((await q(`select public.file_reports_list() r`)).length === 1, 'staff sees report');
t((await q(`select public.file_block_set('${h}', true, 'x') r`)).ok === true, 'staff blocks hash');
t((await q(`select public.file_blocked(array['${h}','${'b'.repeat(64)}']) r`)).length === 1, 'file_blocked answers only matches');
await as(A); await db.exec(`insert into messages(user_id, text) values ('${A}', 'm6')`); await db.exec(`delete from file_day`);
t((await q(`select public.msg_attach('chat', 6, ${att({})}) r`)).reason === 'blocked', 'blocked hash cannot be re-attached');
t((await q(`select public.file_cfg() r`)).file_mb === 10, 'cfg defaults merged');
console.log(bad ? `files SQL: ${bad}/${n} FAIL` : `files SQL OK (${n} checks, file applied twice)`);
process.exit(bad ? 1 : 0);
