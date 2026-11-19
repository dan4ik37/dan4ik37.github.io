// T-169 ds3: community.sql ч. 16 (голосовые каналы сайта, лимит голосового сайта, пароль голосового сообщества, «в одном голосовом
// за раз») на PGlite — та же обвязка, что у ds2-sql-test.mjs (ч. 15 + 16 подряд, дважды — проверка повторного запуска).
// Без PGlite — пропуск (на этом ПК PGlite нет). Запуск из корня сайта: node scripts/ds3-sql-test.mjs (PGLITE_PATH / DEPS_DIR)
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
  const msg = 'ds3-sql-test: PGlite не найден — SQL-проверки пропущены (PGLITE_PATH=… или DEPS_DIR=…)';
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
create function public.comm_bad(t text) returns boolean language sql immutable as $$ select t ilike '%мат%' $$;
create function public.comm_has_link(t text) returns boolean language sql immutable as $$ select t ~* 'https?://' $$;
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

t((await q(`select public.ds3_info() r`)).v === 1, 'ds3_info v1');
await db.exec(`insert into site_config values ('voice_cap', '6') on conflict (key) do update set value = '6'`);
// ── голосовые сайта: список, лимит (баг «количество не редактируется»), создать / переименовать / удалить ──
await as(null); let L = await q(`select public.site_voice_list() r`);
t(L.ok && L.channels.length === 3 && L.channels[0].id === 0 && L.channels[0].name === 'Общий' && L.can === false, 'guest sees 3 site voice channels, cannot manage', L);
await as(AD); let w = await q(`select public.cv_who(0) r`); t(w.ok && w.can_set === false, 'user: site voice who, cannot set');
await as(ADM); w = await q(`select public.cv_who(0) r`); t(w.ok && w.can_set === true && w.max === 6, 'admin may set the site voice limit (was always false)', w);
let r = await q(`select public.cm_voice_limit_set(0, 4) r`); t(r.ok && r.max === 4, 'admin sets site voice limit 4 (was not_found)', r);
await as(AD); t((await q(`select public.cm_voice_limit_set(0, 2) r`)).reason === 'perm', 'user cannot set site limit');
await as(ADM); t((await q(`select public.cm_voice_limit_set(-9, 2) r`)).reason === 'not_found', 'unknown site channel');
r = await q(`select public.site_voice_save(null, 'Стрим', null, 3) r`); t(r.ok && r.id === -3, 'new site voice channel gets id -3', r);
t((await q(`select public.site_voice_save(null, 'мат', null, 0) r`)).reason === 'bad', 'bad words refused');
t((await q(`select public.site_voice_save(-3, 'Стрим 2', 5, 3) r`)).ok, 'rename / reorder');
await as(AD); t((await q(`select public.site_voice_save(null, 'x', null, 0) r`)).reason === 'perm', 'user cannot create');
await as(ADM); t((await q(`select public.site_voice_delete(0) r`)).reason === 'last', '«Общий» cannot be deleted');
// пропуск, предел, «в одном голосовом за раз»
await as(AD); let p1 = await q(`select public.cv_pass(-1, '${PUB}') r`); t(p1.ok && p1.max === 6, 'pass into site channel -1', p1);
let p2 = await q(`select public.cv_pass(-3, '${PUB}') r`); t(p2.ok && p2.max === 3 && p2.topic !== p1.topic, 'pass into -3: own limit 3, own room', p2);
t(+(await q(`select count(*)::int r from voice_here where user_id = '${AD}'`)) === 1, 'switching channel removes you from the previous «who is inside»');
await as(ADM); let ck = await q(`select public.cv_check(-3, '${p2.pass}', '${PUB}') r`); t(ck && ck.uid === AD, 'neighbour check on a site channel', ck);
t((await q(`select public.cv_check(-1, '${p1.pass}', '${PUB}') r`)) === null, 'old channel pass no longer admits after switching');
await as(KID); t((await q(`select public.cv_pass(-77, '${PUB}') r`)).reason === 'not_found', 'unknown site channel refused');
await as(ADM); t((await q(`select public.site_voice_delete(-3) r`)).ok, 'delete -3');
t(+(await q(`select count(*)::int r from voice_here where channel_id = -3`)) === 0, 'deleting clears who was inside');
// ── пароль на голосовой сообщества ──
await as(OWN); t((await q(`select public.cm_chan_pw_set(80, 'секрет1') r`)).locked === true, 'owner sets a voice channel password');
await as(T14); t((await q(`select public.cv_pass(80, '${PUB}') r`)).reason === 'pw', 'member without password gets no pass');
t((await q(`select public.cm_chan_pw_try(80, 'секрет1') r`)).ok, 'right password');
t((await q(`select public.cv_pass(80, '${PUB}') r`)).ok, 'then the pass is given');
await as(OWN); t((await q(`select public.cv_pass(80, '${PUB}') r`)).ok, 'manager needs no password');
const gr = (await db.query(`select has_function_privilege('anon', 'public.site_voice_list()', 'execute') a, has_function_privilege('anon', 'public.site_voice_save(bigint,text,integer,integer)', 'execute') b, has_function_privilege('anon', 'public.voice_limit_of(bigint)', 'execute') c`)).rows[0];
t(gr.a && !gr.b && !gr.c, 'grants: list for everyone, save not for anon, helpers private', gr);
console.log(`ds3-sql-test: ${n - bad}/${n} ok`);
process.exit(bad ? 1 : 0);
