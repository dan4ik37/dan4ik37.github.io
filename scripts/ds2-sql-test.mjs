// T-167 ds2: community.sql ч. 15 (лимит голосового и «кто внутри», камера по возрасту, потолок участников, канал с паролем,
// реестр картинок с сервера сообщества) на PGlite с заглушками живых таблиц и помощников; часть выполняется дважды (идемпотентность).
// pgcrypto заменён заглушками (crypt / gen_salt / hmac / digest на md5) — проверяется логика, не стойкость bcrypt.
// Запуск из корня сайта: node scripts/ds2-sql-test.mjs (PGLITE_PATH / DEPS_DIR)
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
  const msg = 'ds2-sql-test: PGlite не найден — SQL-проверки пропущены (PGLITE_PATH=… или DEPS_DIR=…)';
  if (process.env.CI_STRICT) { console.log('FAIL ' + msg); process.exit(1); }
  console.log('SKIP ' + msg);
  process.exit(0);
}
let sql = fs.readFileSync(path.join(SITE, 'community.sql'), 'utf8'); const k0 = sql.indexOf('-- ═══ часть 15 (ds2)');
if (k0 < 0) { console.log('FAIL part 15 not found'); process.exit(1); }
sql = sql.slice(k0);
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create role app; create schema auth; create schema extensions;
create table cur(u uuid, r text); insert into cur values (null, 'anon');
create function auth.uid() returns uuid language sql as 'select u from cur';
create function auth.role() returns text language sql as 'select r from cur';
create function extensions.gen_salt(t text, n int) returns text language sql volatile as $$ select 'bf' || floor(random() * 1e9)::bigint || '$' $$;
create function extensions.crypt(p text, s text) returns text language sql immutable as $$ select split_part(s, '$', 1) || '$' || md5(split_part(s, '$', 1) || p) $$;
create function extensions.hmac(a text, b text, t text) returns bytea language sql immutable as $$ select decode(md5(a || '|' || b), 'hex') $$;
create function extensions.digest(a text, t text) returns bytea language sql immutable as $$ select decode(md5(a), 'hex') $$;
create table public.site_config(key text primary key, value text);
create table public.profiles(id uuid primary key, role text, nick text, created_at timestamptz default now() - interval '10 days');
create table public.user_age(user_id uuid primary key, birth_year int);
create function public.age_group_of(p_uid uuid) returns text language sql stable as $$ select coalesce((select case when extract(year from now())::int - birth_year - 1 < 13 then 'child' when extract(year from now())::int - birth_year - 1 < 16 then 'teen' when extract(year from now())::int - birth_year - 1 < 18 then 'teen16' else 'adult' end from public.user_age where user_id = p_uid), 'unknown') $$;
create function public.age_u9(p_uid uuid) returns boolean language sql stable as $$ select coalesce((select extract(year from now())::int - birth_year - 1 < 9 from public.user_age where user_id = p_uid), false) $$;
create function public.kidsafe_on() returns boolean language sql stable as 'select true';
create function public.chat_staff_role(p_uid uuid default auth.uid()) returns text language sql stable as $$ select role from public.profiles where id = p_uid and role in ('admin','moderator','helper') $$;
create function public.comm_is_staff(p_uid uuid default auth.uid()) returns boolean language sql stable as $$ select coalesce((select role in ('admin','moderator') from public.profiles where id = p_uid), false) $$;
create table public.communities(id bigint primary key, name text, status text default 'active', is_public boolean default true, members int default 0, age int default 0, invite_code text);
create table public.community_members(community_id bigint, user_id uuid, role text default 'member', joined_at timestamptz default now() - interval '1 day');
create table public.community_bans(community_id bigint, user_id uuid, until timestamptz);
create table public.community_channels(id bigint primary key, community_id bigint, name text, kind text default 'text', archived boolean default false);
create table public.community_messages(id bigint generated always as identity primary key, channel_id bigint, user_id uuid, text text);
create table public.comm_secret(id int primary key, k text); insert into public.comm_secret values (1, 'sekret');
create table public.banned_nicks(nick text); create table public.chat_mutes(user_id uuid, nick text default '', until timestamptz);
create function public.comm_role(p_cid bigint, p_uid uuid default auth.uid()) returns text language sql stable as $$ select role from public.community_members where community_id = p_cid and user_id = p_uid $$;
create function public.comm_banned(p_cid bigint, p_uid uuid) returns boolean language sql stable as $$ select exists (select 1 from public.community_bans where community_id = p_cid and user_id = p_uid and (until is null or until > now())) $$;
create function public.chan_can_manage(p_cid bigint, p_uid uuid) returns boolean language sql stable as $$ select p_uid is not null and case when p_cid is null then coalesce(public.chat_staff_role(p_uid), '') in ('admin','moderator') else coalesce(public.comm_role(p_cid, p_uid) in ('owner','mod'), false) end $$;
create function public.comm_by_code(p_code text) returns bigint language sql stable as $$ select id from public.communities where invite_code = p_code $$;
create function public.comm_age_cap(p_uid uuid) returns int language sql stable as 'select 99';
alter table public.community_messages enable row level security;
create policy c_read on public.community_messages for select using (true); create policy c_ins on public.community_messages for insert with check (true);
grant select, insert on public.community_messages to app; grant usage on schema public, auth, extensions to app;
grant select on cur to app; grant execute on all functions in schema auth to app; grant execute on all functions in schema extensions to app;`);
await db.exec(sql); await db.exec(sql);
await db.exec(`grant execute on all functions in schema public to app; grant usage, select on all sequences in schema public to app;`);
const ADM = '11111111-1111-1111-1111-111111111111', KID = '22222222-2222-2222-2222-222222222222', T14 = '33333333-3333-3333-3333-333333333333', AD = '44444444-4444-4444-4444-444444444444',
  OWN = '55555555-5555-5555-5555-555555555555', NOAGE = '66666666-6666-6666-6666-666666666666', OUT = '77777777-7777-7777-7777-777777777777';
await db.exec(`insert into profiles(id, role, nick) values ('${ADM}','admin','адм'),('${KID}',null,'кид'),('${T14}',null,'т14'),('${AD}',null,'взр'),('${OWN}',null,'влад'),('${NOAGE}',null,'без'),('${OUT}',null,'чужой');
insert into user_age values ('${KID}', extract(year from now())::int - 11), ('${T14}', extract(year from now())::int - 15), ('${AD}', extract(year from now())::int - 30), ('${OWN}', extract(year from now())::int - 30);
insert into communities(id, name, invite_code) values (7, 'клуб', 'klub7');
insert into community_members(community_id, user_id, role) values (7, '${OWN}', 'owner'), (7, '${KID}', 'member'), (7, '${T14}', 'member'), (7, '${AD}', 'member'), (7, '${NOAGE}', 'member');
insert into community_channels(id, community_id, name, kind) values (70, 7, 'чат', 'text'), (71, 7, 'тайный', 'text'), (80, 7, 'голос', 'voice');
insert into community_messages(channel_id, user_id, text) values (70, '${AD}', 'a'), (71, '${AD}', 'b');`);
const as = async (u, r) => db.exec(`update cur set u = ${u ? `'${u}'` : 'null'}, r = '${r || (u ? 'authenticated' : 'anon')}'`);
const q = async s => (await db.query(s)).rows[0].r;
const asApp = async (u, s) => { await as(u); await db.exec('set role app'); try { return await db.query(s); } finally { await db.exec('reset role'); } };
let n = 0, bad = 0; const t = (c, m, x) => { n++; if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const PUB = 'p'.repeat(60);

t((await q(`select public.ds2_info() r`)).v === 1, 'ds2_info v1');
// ── (а) голосовой: лимит, «кто внутри», проверка соседа ──
await db.exec(`insert into site_config values ('voice_cap', '3')`);
await as(OWN); let a = await q(`select public.cv_pass(80, '${PUB}') r`); t(a.ok && a.max === 3, 'owner gets pass, max = cap 3', a);
await as(T14); const b = await q(`select public.cv_pass(80, '${PUB}') r`); t(b.ok, 'second in');
await as(AD); t((await q(`select public.cv_pass(80, '${PUB}') r`)).ok, 'third in');
await as(NOAGE); let d = await q(`select public.cv_pass(80, '${PUB}') r`); t(d.ok === false && d.reason === 'full' && d.max === 3, 'fourth: full', d);
await as(OUT); t((await q(`select public.cv_pass(80, '${PUB}') r`)).reason === 'member', 'non-member refused');
await as(OWN); let ck = await q(`select public.cv_check(80, '${b.pass}', '${PUB}') r`); t(ck && ck.uid === T14, 'neighbour check passes for someone inside', ck);
await as(T14); t((await q(`select public.cv_leave(80) r`)).ok, 'leave');
await as(OWN); ck = await q(`select public.cv_check(80, '${b.pass}', '${PUB}') r`); t(ck === null, 'after leaving, old pass no longer admits');
await as(NOAGE); d = await q(`select public.cv_pass(80, '${PUB}') r`); t(d.ok, 'place freed → next one in');
await db.exec(`update voice_here set seen_at = now() - interval '2 minutes' where user_id = '${AD}'`);
await as(T14); t((await q(`select public.cv_pass(80, '${PUB}') r`)).ok, 'stale (no ping 75 s) does not count');
await as(NOAGE); t((await q(`select public.cv_ping(80) r`)).ok === true, 'ping updates own row');
await as(OUT); t((await q(`select public.cv_ping(80) r`)).ok === false, 'ping without row → false');
await as(OWN); let w = await q(`select public.cv_who(80) r`); t(w.ok && w.can_set === true && w.people.length === 3 && w.max === 3, 'owner sees who is inside and may set limit', w);
await as(KID); w = await q(`select public.cv_who(80) r`); t(w.ok && w.can_set === false, 'member sees list, cannot set');
await as(OUT); t((await q(`select public.cv_who(80) r`)).reason === 'member', 'outsider cannot see');
await as(KID); t((await q(`select public.cm_voice_limit_set(80, 2) r`)).reason === 'perm', 'member cannot set limit');
await as(OWN); t((await q(`select public.cm_voice_limit_set(80, 200) r`)).reason === 'bad', 'limit range');
let L = await q(`select public.cm_voice_limit_set(80, 2) r`); t(L.ok && L.max === 2, 'owner sets 2', L);
L = await q(`select public.cm_voice_limit_set(80, 10) r`); t(L.ok && L.max === 3, 'limit above site cap → cap', L);
await db.exec(`update community_channels set user_limit = 2 where id = 80; delete from voice_here`);
await as(OWN); await q(`select public.cv_pass(80, '${PUB}') r`); await as(T14); await q(`select public.cv_pass(80, '${PUB}') r`);
await as(AD); t((await q(`select public.cv_pass(80, '${PUB}') r`)).reason === 'full', 'channel limit 2 enforced');
// ── (б) камера ──
const cam = async u => { await as(u); return (await q(`select public.cam_me() r`)).cam; };
t(await cam(KID) === false && await cam(NOAGE) === false, 'camera: under 13 and unknown age — never');
t(await cam(T14) === true && await cam(AD) === true, 'camera: 13+ by default (call_video teen)');
await db.exec(`insert into site_config values ('call_video', 'adult')`); t(await cam(T14) === false && await cam(AD) === true, 'call_video adult: only 18+');
await db.exec(`update site_config set value = 'off' where key = 'call_video'`); t(await cam(AD) === false, 'call_video off: nobody');
await as(T14); await db.exec(`delete from voice_here`); await db.exec(`update site_config set value = 'teen' where key = 'call_video'`);
t((await q(`select public.cv_pass(80, '${PUB}') r`)).cam === true, 'cv_pass carries cam');
// ── потолок участников ──
await db.exec(`insert into site_config values ('comm_member_cap', '10'); update communities set members = 10 where id = 7`);
await as(OUT); t((await q(`select public.cm_join(7, null) r`)).reason === 'full', 'member cap from site_config');
await db.exec(`update communities set members = 5 where id = 7`); t((await q(`select public.cm_join(7, null) r`)).ok, 'joins under cap');
// ── (в) пароль ──
await as(KID); t((await q(`select public.cm_chan_pw_set(71, 'abcd') r`)).reason === 'perm', 'member cannot set password');
await as(OWN); t((await q(`select public.cm_chan_pw_set(71, 'ab') r`)).reason === 'len', 'password length');
t((await q(`select public.cm_chan_pw_set(80, 'abcd') r`)).reason === 'not_found', 'voice channel: no password');
t((await q(`select public.cm_chan_pw_set(71, 'tajna1') r`)).locked === true, 'owner sets password');
let r = await asApp(KID, `select channel_id from community_messages order by id`); t(r.rows.length === 1 && r.rows[0].channel_id === 70, 'locked channel hidden from member (RLS)', r.rows);
r = await asApp(OWN, `select channel_id from community_messages order by id`); t(r.rows.length === 2, 'manager reads locked channel');
let threw = ''; try { await asApp(KID, `insert into community_messages(channel_id, user_id, text) values (71, '${KID}', 'hi')`); } catch (e) { threw = e.message; }
t(/пароль/.test(threw), 'member cannot write into locked channel', threw);
threw = ''; try { await asApp(KID, `select hash from chan_pw`); } catch (e) { threw = e.message; }
t(/permission|denied/i.test(threw), 'password hash not readable by clients', threw);
await as(KID); let tr = await q(`select public.cm_chan_pw_try(71, 'nope') r`); t(tr.ok === false && tr.reason === 'wrong' && tr.left === 4, 'wrong password', tr);
tr = await q(`select public.cm_chan_pw_try(71, 'tajna1') r`); t(tr.ok === true, 'right password');
r = await asApp(KID, `select channel_id from community_messages order by id`); t(r.rows.length === 2, 'after password: reads');
await as(KID); let st = await q(`select public.cm_chan_pw_state(7) r`); t(st.length === 1 && st[0].id === 71 && st[0].ok === true, 'state: locked + open for me', st);
await as(OUT); t((await q(`select public.cm_chan_pw_try(71, 'tajna1') r`)).reason === 'member', 'outsider cannot try');
await as(T14); for (let i = 0; i < 5; i++) await q(`select public.cm_chan_pw_try(71, 'x${i}') r`);
t((await q(`select public.cm_chan_pw_try(71, 'tajna1') r`)).reason === 'rate', 'attempt limit 5 / 15 min');
await as(OWN); await q(`select public.cm_chan_pw_set(71, 'novyi22') r`);
r = await asApp(KID, `select channel_id from community_messages order by id`); t(r.rows.length === 1, 'password changed → everyone re-enters');
await as(OWN); t((await q(`select public.cm_chan_pw_set(71, '') r`)).locked === false, 'password removed');
r = await asApp(KID, `select channel_id from community_messages order by id`); t(r.rows.length === 2, 'open again');
// ── (г) картинки с сервера сообщества ──
await as(OWN); t((await q(`select public.cf_ext_add(7, 'emoji', 'smile', 'https://pics.example.com/s.png') r`)).reason === 'off', 'ext media off by default');
await db.exec(`insert into site_config values ('ext_media', 'on')`);
await as(KID); t((await q(`select public.cf_ext_hosts_set(7, array['pics.example.com']) r`)).reason === 'perm', 'member cannot set hosts');
await as(OWN); t((await q(`select public.cf_ext_hosts_set(7, array['localhost']) r`)).reason === 'host', 'localhost refused');
t((await q(`select public.cf_ext_hosts_set(7, array['10.0.0.1']) r`)).reason === 'host', 'IP refused');
t((await q(`select public.cf_ext_hosts_set(7, array['pics.example.com']) r`)).ok, 'owner sets host');
t((await q(`select public.cf_ext_add(7, 'emoji', 'smile', 'https://evil.example.net/s.png') r`)).reason === 'host', 'other host refused');
t((await q(`select public.cf_ext_add(7, 'emoji', 'smile', 'http://pics.example.com/s.png') r`)).reason === 'url', 'http refused');
const ad = await q(`select public.cf_ext_add(7, 'emoji', 'smile', 'https://pics.example.com/s.png') r`); t(ad.ok && ad.id > 0, 'owner adds picture', ad);
t((await q(`select public.cf_ext_add(7, 'emoji', 'smile', 'https://pics.example.com/s2.png') r`)).reason === 'dup', 'duplicate name');
await as(KID); let ls = await q(`select public.cf_ext_list(7) r`); t(ls.ok && ls.list.length === 0, 'member sees nothing before approval');
await as(OWN); ls = await q(`select public.cf_ext_list(7) r`); t(ls.manage && ls.list[0].status === 'checking', 'owner sees checking');
await as(null, 'service_role'); t((await q(`select public.cf_ext_todo(${ad.id}) r`)).url === 'https://pics.example.com/s.png', 'server reads todo');
t((await q(`select public.cf_ext_verified(${ad.id}, true, '${'a'.repeat(64)}', 1000, 64, 64, 'image/png', '') r`)).ok, 'server marks verified → pending');
await as(KID); t((await q(`select public.cf_ext_review(${ad.id}, true, '') r`)).reason === 'perm', 'member cannot approve');
await as(ADM); t((await q(`select public.cf_ext_queue() r`)).length === 1, 'staff queue');
t((await q(`select public.cf_ext_review(${ad.id}, true, '') r`)).ok, 'staff approves');
await as(KID); ls = await q(`select public.cf_ext_list(7) r`); t(ls.list.length === 1 && ls.list[0].sha256 === 'a'.repeat(64), 'member sees approved with hash', ls);
await as(null); t((await q(`select public.cf_ext_list(7) r`)).reason === 'off', 'guest never gets the list');
await as(ADM); t((await q(`select public.cf_ext_off(7, true) r`)).ok, 'staff disables community pictures');
await as(KID); t((await q(`select public.cf_ext_list(7) r`)).reason === 'off', 'disabled community → nothing');
const gr = (await db.query(`select has_function_privilege('anon', 'public.cf_ext_verified(bigint, boolean, text, int, int, int, text, text)', 'execute') a, has_function_privilege('authenticated', 'public.cv_pass(bigint, text)', 'execute') b, has_function_privilege('anon', 'public.cv_pass(bigint, text)', 'execute') c`)).rows[0];
t(!gr.a && gr.b && !gr.c, 'grants: verified only for service, cv_pass not for anon', gr);
console.log(`ds2-sql-test: ${n - bad}/${n} ok`);
process.exit(bad ? 1 : 0);
