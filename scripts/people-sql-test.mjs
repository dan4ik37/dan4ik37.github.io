// T-164 ds-people: community.sql ч. 13 (статусы, свой статус, карточка, ник на сервере, значок роли, друзья, игнор, группы ЛС)
// на PGlite с заглушками живых таблиц и помощников (как на сервере: profiles / friendships / user_blocks / comm_online / сообщества /
// роли; age.sql — kid_pair_ok / kid_why / age_u9); часть выполняется дважды (идемпотентность).
// Запуск из корня сайта: node scripts/people-sql-test.mjs (PGLITE_PATH / DEPS_DIR)
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
  const msg = 'people-sql-test: PGlite не найден — SQL-проверки пропущены (PGLITE_PATH=… или DEPS_DIR=…)';
  if (process.env.CI_STRICT) { console.log('FAIL ' + msg); process.exit(1); }
  console.log('SKIP ' + msg);
  process.exit(0);
}

let sql = fs.readFileSync(path.join(SITE, 'community.sql'), 'utf8'); const k0 = sql.indexOf('-- ═══ часть 13 (ds-people) ═══');
if (k0 < 0) { console.log('FAIL part 13 not found'); process.exit(1); }
sql = sql.slice(k0); const k1 = sql.indexOf('\n-- ═══ часть 1', 10); if (k1 > 0) sql = sql.slice(0, k1);   // только своя часть
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create role app; create schema auth; create schema extensions;
create table cur(u uuid, r text); insert into cur values (null, 'anon');
create function auth.uid() returns uuid language sql as 'select u from cur';
create table public.profiles(id uuid primary key, role text, nick text, privacy_profile text not null default 'all', privacy_invisible boolean not null default false,
  privacy_friend_requests text not null default 'all', created_at timestamptz not null default now());
create table public.user_age(user_id uuid primary key, birth_year int);
create function public.kidsafe_on() returns boolean language sql as 'select true';
create function public.age_year_now() returns int language sql as 'select extract(year from now())::int';
create function public.age_group_of(p_uid uuid) returns text language sql stable as $$ select coalesce((select case when public.age_year_now() - birth_year - 1 < 13 then 'child' when public.age_year_now() - birth_year - 1 < 18 then 'teen' else 'adult' end from public.user_age where user_id = p_uid and birth_year is not null), 'unknown') $$;
create function public.age_u9(p_uid uuid) returns boolean language sql stable as $$ select coalesce((select public.age_year_now() - birth_year - 1 < 9 from public.user_age where user_id = p_uid), false) $$;
create function public.kid_pair_ok(a uuid, b uuid) returns boolean language plpgsql stable as $$
declare ga text; gb text;
begin
  if a is null or b is null or a = b or not public.kidsafe_on() then return true; end if;
  ga := public.age_group_of(a); if ga not in ('child', 'adult', 'unknown') then return true; end if;
  gb := public.age_group_of(b);
  return not ((ga = 'child' and gb in ('adult', 'unknown')) or (gb = 'child' and ga in ('adult', 'unknown')));
end $$;
create function public.kid_why(p_me uuid, p_other uuid, p_dm boolean) returns text language plpgsql stable as $$
begin
  if p_me is null or p_other is null or p_me = p_other or not public.kidsafe_on() then return null; end if;
  if p_dm and public.age_u9(p_me) then return 'u9'; end if;
  if not public.kid_pair_ok(p_me, p_other) then return case when public.age_group_of(p_me) = 'child' then 'age' else 'no' end; end if;
  if p_dm and public.age_u9(p_other) then return 'no'; end if;
  return null;
end $$;
create table public.friendships(id bigint generated always as identity primary key, requester_id uuid, addressee_id uuid, status text not null default 'pending', created_at timestamptz default now(), unique (requester_id, addressee_id));
create table public.user_blocks(blocker_id uuid, blocked_id uuid, created_at timestamptz default now(), primary key (blocker_id, blocked_id));
create table public.comm_online(user_id uuid primary key, seen_at timestamptz not null default now(), place text not null default '');
create function public.accepts_friend_requests(uid uuid) returns boolean language sql stable as $$ select coalesce((select privacy_friend_requests = 'all' from public.profiles where id = uid), true) $$;
create function public.comm_friends(a uuid, b uuid) returns boolean language sql stable as $$ select a is not null and b is not null and exists (select 1 from public.friendships where status = 'accepted' and ((requester_id = a and addressee_id = b) or (requester_id = b and addressee_id = a))) $$;
create function public.comm_blocked(a uuid, b uuid) returns boolean language sql stable as $$ select a is not null and b is not null and exists (select 1 from public.user_blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)) $$;
create function public.comm_is_staff(p_uid uuid default auth.uid()) returns boolean language sql stable as $$ select coalesce((select role in ('admin','moderator') from public.profiles where id = p_uid), false) $$;
create table public.communities(id bigint primary key, name text, icon text default '💬', status text default 'active', members int default 0);
create table public.community_members(community_id bigint, user_id uuid, role text default 'member', joined_at timestamptz default now(), primary key (community_id, user_id));
create table public.community_bans(community_id bigint, user_id uuid, until timestamptz);
create table public.comm_roles(id bigint primary key, community_id bigint, name text, color text default '#99aab5', position int default 1, perms int default 0);
create table public.comm_member_roles(community_id bigint, user_id uuid, role_id bigint, primary key (role_id, user_id));
create function public.comm_role(p_cid bigint, p_uid uuid default auth.uid()) returns text language sql stable as $$ select role from public.community_members where community_id = p_cid and user_id = p_uid $$;
create function public.comm_banned(p_cid bigint, p_uid uuid) returns boolean language sql stable as $$ select exists (select 1 from public.community_bans where community_id = p_cid and user_id = p_uid and (until is null or until > now())) $$;
create function public.comm_perm(p_cid bigint, p_uid uuid, p_bit int) returns boolean language sql stable as $$ select public.comm_is_staff(p_uid) or coalesce(public.comm_role(p_cid, p_uid) in ('owner','mod'), false) $$;
create function public.comm_can_mod(p_cid bigint, p_actor uuid, p_target uuid) returns boolean language sql stable as $$ select p_actor <> p_target and coalesce(public.comm_role(p_cid, p_target), '') <> 'owner' and (public.comm_role(p_cid, p_actor) = 'owner' or (public.comm_role(p_cid, p_actor) = 'mod' and public.comm_role(p_cid, p_target) = 'member')) $$;
create function public.comm_norm(p text) returns text language sql immutable as $$ select lower(coalesce(p, '')) $$;
create function public.comm_bad(p text) returns boolean language sql immutable as $$ select coalesce(p, '') ~* 'бля' $$;
create function public.comm_has_link(p text) returns boolean language sql immutable as $$ select coalesce(p, '') ~* '(https?:|www\\.|t\\.me/)' $$;
create table public.comm_modlog(community_id bigint, actor_id uuid, target_id uuid, action text, detail text);
create function public.comm_log(p_cid bigint, p_actor uuid, p_target uuid, p_tnick text, p_action text, p_reason text, p_detail text, p_channel text) returns void language sql as $$ insert into public.comm_modlog values (p_cid, p_actor, p_target, p_action, p_detail) $$;
create table public.notes(u uuid, kind text, title text);
create function public.comm_notify(p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_link text, p_dedupe text) returns void language sql as $$ insert into public.notes values (p_user, p_kind, p_title) $$;
grant usage on schema public, auth to app; grant select on cur to app; grant execute on all functions in schema auth to app;`);
await db.exec(sql); await db.exec(sql);
await db.exec(`grant execute on all functions in schema public to app; grant usage, select on all sequences in schema public to app; grant authenticated to app;`);
const U = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;
const ADM = U(1), A = U(2), B = U(3), KID = U(4), T15 = U(5), C = U(6), K8 = U(7), OWN = U(8), STR = U(9);
const Y = new Date().getFullYear();
await db.exec(`insert into profiles(id, role, nick) values ('${ADM}','admin','адм'),('${A}',null,'Аня'),('${B}',null,'Боря'),('${KID}',null,'кид'),('${T15}',null,'подросток'),('${C}',null,'Ваня'),('${K8}',null,'малыш'),('${OWN}',null,'Влад'),('${STR}',null,'чужой');
insert into user_age values ('${A}', ${Y - 30}), ('${B}', ${Y - 25}), ('${KID}', ${Y - 11}), ('${T15}', ${Y - 16}), ('${C}', ${Y - 28}), ('${K8}', ${Y - 8}), ('${OWN}', ${Y - 30}), ('${STR}', ${Y - 30});
insert into friendships(requester_id, addressee_id, status) values ('${A}','${B}','accepted'),('${A}','${C}','accepted'),('${B}','${C}','accepted'),('${KID}','${T15}','accepted'),('${A}','${OWN}','accepted'),('${K8}','${KID}','accepted');
insert into communities(id, name, icon, members) values (7, 'клуб', '🎮', 4), (8, 'второй', '🐱', 2);
insert into community_members(community_id, user_id, role) values (7,'${OWN}','owner'),(7,'${A}','member'),(7,'${B}','mod'),(7,'${C}','member'),(8,'${A}','member'),(8,'${STR}','owner');
insert into comm_roles(id, community_id, name, color, position) values (70, 7, 'Строители', '#ff8800', 5);
insert into comm_member_roles values (7, '${A}', 70);
insert into comm_online(user_id, seen_at, place) values ('${A}', now(), 'g:chess'), ('${B}', now() - interval '1 hour', ''), ('${KID}', now(), 'g:durak'), ('${T15}', now(), '');`);
const as = async u => db.exec(`update cur set u = ${u ? `'${u}'` : 'null'}, r = '${u ? 'authenticated' : 'anon'}'`);
const q = async s => (await db.query(s)).rows[0].r;
const call = async (u, s) => { await as(u); return q(`select ${s} r`); };
const asApp = async (u, s) => { await as(u); await db.exec('set role app'); try { return await db.query(s); } finally { await db.exec('reset role'); } };
let n = 0, bad = 0; const t = (c, m, x) => { n++; if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const J = o => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
let r;

// ── карточка и статус ──
t((await call(null, `public.ds_card('00000000-0000-0000-0000-000000000000', null)`)).reason === 'not_found', 'guest: unknown card → not_found');
t((await call(null, `public.ds_status_set('{}'::jsonb)`)).reason === 'auth', 'guest cannot set status');
t((await call(A, `public.ds_status_set(${J({ status: 'away' })})`)).reason === 'status', 'unknown status rejected');
t((await call(A, `public.ds_status_set(${J({ ctext: 'бля' })})`)).reason === 'bad', 'swear in custom status rejected');
t((await call(A, `public.ds_status_set(${J({ ctext: 'см https://x.ru' })})`)).reason === 'link', 'link in custom status rejected');
t((await call(A, `public.ds_status_set(${J({ ctext: 'ок', cemoji: 'ab' })})`)).reason === 'emoji', 'letters as emoji rejected');
t((await call(A, `public.ds_status_set(${J({ ctext: 'ок', minutes: 7 })})`)).reason === 'minutes', 'odd expiry rejected');
t((await call(A, `public.ds_status_set(${J({ color: 'red' })})`)).reason === 'color', 'bad colour rejected');
r = await call(A, `public.ds_status_set(${J({ status: 'dnd', ctext: 'Строю замок', cemoji: '🏰', minutes: 60, color: '#22aa88', about: 'Люблю шахматы', seen_vis: 'friends' })})`);
t(r.ok && r.status === 'dnd' && r.ctext === 'Строю замок' && r.cuntil && r.color === '#22aa88', 'status saved', r);
r = await call(B, `public.ds_card('${A}', 'c7')`);
t(r.ok && r.status === 'dnd' && r.custom?.t === 'Строю замок' && r.custom?.e === '🏰' && r.about === 'Люблю шахматы' && r.color === '#22aa88', 'friend sees dnd + custom + about', r);
t(r.act === 'g:chess', 'friend sees activity', r.act);
t(r.srv?.crole === 'member' && r.srv?.roles?.[0]?.name === 'Строители' && r.srv?.joined, 'card shows server roles and join date', r.srv);
t(r.mutual.length === 1 && r.mutual[0].id === 7, 'mutual servers', r.mutual);
t(r.mfriends_n === 1 && r.mfriends[0].nick === 'Ваня', 'mutual friends (Ваня)', r);
t(r.friend === 'friends' && r.can_dm === true && r.can_friend === false, 'friend state + can_dm', r);
r = await call(STR, `public.ds_card('${A}', 'c7')`);
t(r.ok && r.srv == null, 'non-member of server: no server part', r.srv);
t(r.mutual.length === 1 && r.mutual[0].id === 8 && r.can_friend === true && r.can_dm === false, 'stranger: mutual server, can add friend, no DM', r);
// невидимка
await call(A, `public.ds_status_set(${J({ status: 'invisible' })})`);
r = await call(B, `public.ds_card('${A}', null)`);
t(r.status === 'offline' && r.custom === null && r.act === null && r.seen === null, 'invisible: offline, no custom, no activity, no last seen', r);
t((await call(A, `public.ds_card('${A}', null)`)).status === 'invisible', 'self sees own invisible');
r = await call(B, `public.friends_online()`);
t(!r.some(x => x.id === A), 'friends_online hides invisible', r);
await call(A, `public.ds_status_set(${J({ status: 'idle' })})`);
r = await call(B, `public.friends_online()`);
t(r.some(x => x.id === A && x.s === 'idle'), 'friends_online returns status', r);
// скрытый профиль: чужому — без «о себе» и своего статуса
await db.exec(`update profiles set privacy_profile = 'friends' where id = '${A}'`);
r = await call(STR, `public.ds_card('${A}', null)`);
t(r.hidden === true && r.about === null && r.custom === null && r.color === null && r.act === null, 'friends-only profile hidden from stranger', r);
t((await call(B, `public.ds_card('${A}', null)`)).about === 'Люблю шахматы', 'friends-only profile visible to friend');
await db.exec(`update profiles set privacy_profile = 'all' where id = '${A}'`);
// «был в сети»: Боря — 1 ч назад; по умолчанию — друзьям
t((await call(A, `public.ds_card('${B}', null)`)).seen != null, 'friend sees last seen');
t((await call(STR, `public.ds_card('${B}', null)`)).seen == null, 'stranger does not see last seen (default friends)');
await call(B, `public.ds_status_set(${J({ seen_vis: 'nobody' })})`);
t((await call(A, `public.ds_card('${B}', null)`)).seen == null, 'seen_vis nobody hides last seen from friends');
await call(B, `public.ds_status_set(${J({ seen_vis: 'all' })})`);
t((await call(STR, `public.ds_card('${B}', null)`)).seen != null, 'seen_vis all shows to everyone');
// дети ↔ взрослые
r = await call(A, `public.ds_card('${KID}', null)`);
t(r.status === 'offline' && r.act === null && r.can_friend === false && r.why === 'no', 'adult does not see child presence, cannot add', r);
r = await call(KID, `public.ds_card('${A}', null)`);
t(r.status === 'offline' && r.why === 'age' && r.can_friend === false, 'child does not see adult presence, why=age', r);
t((await call(T15, `public.ds_card('${KID}', null)`)).act === 'g:durak', 'teen friend sees child activity');
t((await call(null, `public.ds_card('${KID}', null)`)).status === 'offline', 'guest does not see child presence');
t((await call(null, `public.ds_card('${T15}', null)`)).status === 'online', 'guest sees teen presence (public profile)');
// ── друзья ──
t((await call(STR, `public.ds_friend('${C}', 'add')`)).state === 'out', 'friend request sent');
t((await q(`select count(*)::int r from notes where u = '${C}' and kind = 'friend'`)) === 1, 'request notifies');
t((await call(C, `public.ds_friends()`)).incoming.some(x => x.id === STR), 'incoming request listed');
t((await call(C, `public.ds_friend('${STR}', 'add')`)).state === 'friends', 'counter-request = accept');
t((await call(KID, `public.ds_friend('${C}', 'add')`)).reason === 'age', 'child cannot add adult');
await db.exec(`insert into user_blocks values ('${B}', '${STR}')`);
t((await call(STR, `public.ds_friend('${B}', 'add')`)).reason === 'blocked', 'blocked cannot add');
await db.exec(`update profiles set privacy_friend_requests = 'nobody' where id = '${OWN}'`);
t((await call(STR, `public.ds_friend('${OWN}', 'add')`)).reason === 'closed', 'closed requests respected');
t((await call(C, `public.ds_friend('${STR}', 'remove')`)).state === 'none', 'remove friend');
t((await call(B, `public.ds_card('${STR}', null)`)).blocked === true, 'card shows my block');
t((await call(A, `public.ds_ignore('${B}', true)`)).ok, 'ignore on');
r = await call(A, `public.ds_friends()`);
t(r.ignored.some(x => x.id === B) && r.friends.some(x => x.id === B && x.s === 'offline'), 'friends list: ignored + offline friend', r.friends);
t((await call(A, `public.ds_card('${B}', null)`)).ignored === true, 'card shows ignore');
r = await asApp(B, `select * from user_ignores`); t(r.rows.length === 0, 'ignore list private (RLS)');
r = await asApp(A, `select * from user_ignores`); t(r.rows.length === 1, 'own ignore list readable');
await call(A, `public.ds_ignore('${B}', false)`);
// ── ник на сервере, значок роли, список участников ──
t((await call(A, `public.ds_nick_set('c7', null, 'Аня-строитель')`)).ok, 'self server nick');
t((await call(A, `public.ds_nick_set('c7', null, 'Аня2')`)).reason === 'too_fast', 'nick change rate-limited');
t((await call(C, `public.ds_nick_set('c7', null, 'Денчик37')`)).reason === 'name', 'impersonation rejected');
t((await call(C, `public.ds_nick_set('c7', '${A}', 'лол')`)).reason === 'rights', 'member cannot rename others');
t((await call(B, `public.ds_nick_set('c7', '${OWN}', 'лол')`)).reason === 'rights', 'mod cannot rename owner');
t((await call(OWN, `public.ds_nick_set('c7', '${C}', 'Ваня-новичок')`)).ok, 'owner renames member');
t((await q(`select count(*)::int r from comm_modlog where action = 'nick'`)) === 1, 'rename by others logged');
t((await call(STR, `public.ds_nick_set('c7', null, 'Чужак')`)).reason === 'member', 'non-member cannot set nick');
t((await call(STR, `public.ds_nick_set('d37', null, 'Чужак')`)).ok, 'site server nick');
t((await call(STR, `public.ds_nick_set('x1', null, 'Чужак')`)).reason === 'bad', 'bad scope');
t((await call(A, `public.ds_role_icon(70, '🔨')`)).reason === 'rights', 'member cannot set role icon');
t((await call(OWN, `public.ds_role_icon(70, 'AB')`)).reason === 'emoji', 'letters as role icon rejected');
t((await call(OWN, `public.ds_role_icon(70, '🔨')`)).ok, 'owner sets role icon');
t((await call(STR, `public.ds_people_meta('c7', array['${A}']::uuid[])`)).reason === 'member', 'meta: non-member refused');
r = await call(B, `public.ds_people_meta('c7', array['${A}','${C}','${STR}']::uuid[])`);
const ma = r.list.find(x => x.id === A);
t(r.ok && ma?.n === 'Аня-строитель' && ma?.s === 'idle' && r.icons['70'] === '🔨' && !r.list.some(x => x.id === STR), 'meta: nick, status, icons, members only', r);
r = await call(null, `public.ds_people_meta('d37', array['${STR}','${KID}']::uuid[])`);
t(r.ok && r.list.find(x => x.id === STR)?.n === 'Чужак' && !r.list.find(x => x.id === KID)?.s, 'guest meta on site server: nick, child status hidden', r);
// ── группы ЛС ──
t((await call(A, `public.gdm_create(array['${STR}']::uuid[], 'x')`)).reason === 'friends', 'group: only friends');
t((await call(K8, `public.gdm_create(array['${KID}']::uuid[], '')`)).reason === 'u9', 'group: under 9 refused');
await db.exec(`insert into friendships(requester_id, addressee_id, status) values ('${T15}','${A}','accepted')`);
t((await call(T15, `public.gdm_create(array['${KID}','${A}']::uuid[], '')`)).reason === 'age', 'group: child + adult refused');
const TEN = Array.from({ length: 10 }, (_, i) => `'aaaaaaaa-0000-0000-0000-00000000000${i}'`).join(',');
t((await call(A, `public.gdm_create(array[${TEN}]::uuid[], '')`)).reason === 'full', 'group: max 10 people');
r = await call(A, `public.gdm_create(array['${B}','${C}']::uuid[], 'Шахматы')`);
t(r.ok && r.g.members.length === 3 && r.g.name === 'Шахматы', 'group created', r);
const G = r.g.id;
t((await call(C, `public.gdm_add(${G}, '${A}')`)).ok, 'adding existing member is a no-op');
t((await call(B, `public.gdm_add(${G}, '${STR}')`)).reason === 'friends', 'add: only own friends');
t((await call(A, `public.gdm_add(${G}, '${OWN}')`)).g.members.length === 4, 'friend added');
t((await call(STR, `public.gdm_send(${G}, 'hi', null)`)).reason === 'member', 'non-member cannot write');
r = await call(B, `public.gdm_send(${G}, 'Привет всем', null)`);
t(r.ok && r.m.text === 'Привет всем', 'member writes', r);
const M1 = r.m.id;
t((await call(B, `public.gdm_send(${G}, 'Привет всем', null)`)).reason === 'repeat', 'repeat refused');
r = await asApp(STR, `select id from gdm_messages`); t(r.rows.length === 0, 'RLS: outsider reads nothing');
r = await asApp(C, `select id from gdm_messages`); t(r.rows.length === 1, 'RLS: member reads');
r = await asApp(C, `select id from gdm_groups`); t(r.rows.length === 1, 'RLS: member sees group');
let denied = false; try { await asApp(C, `insert into gdm_messages(group_id, user_id, text) values (${G}, '${C}', 'x')`); } catch (er) { denied = true; }
t(denied, 'direct insert denied');
t((await call(C, `public.gdm_edit(${M1}, 'взлом')`)).reason === 'rights', 'cannot edit others');
t((await call(B, `public.gdm_edit(${M1}, 'Привет!')`)).m.edited_at, 'author edits');
t((await call(A, `public.gdm_delete(${M1})`)).ok, 'group owner deletes');
t((await call(A, `public.gdm_rename(${G}, 'Клуб', '♟️')`)).g.icon === '♟️', 'rename + icon');
t((await call(C, `public.gdm_leave(${G}, '${B}')`)).reason === 'rights', 'member cannot kick');
t((await call(A, `public.gdm_leave(${G}, null)`)).ok, 'owner leaves');
r = await call(B, `public.gdm_list()`);
t(r.list.length === 1 && r.list[0].owner === B && r.list[0].members.length === 3, 'ownership passes to oldest member', r);
t((await call(null, `public.gdm_list()`)).reason === 'auth', 'guest has no groups');

console.log(bad ? `people SQL: ${bad}/${n} FAIL` : `people SQL OK (${n} checks, part applied twice)`);
process.exit(bad ? 1 : 0);
