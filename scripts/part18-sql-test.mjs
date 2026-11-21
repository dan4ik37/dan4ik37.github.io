// T-177 остатки + T-170: community.sql ч. 18 на PGlite (Postgres в памяти — без сети и без настоящей базы). Помощники прежних частей —
// заглушки с тем же смыслом (как в mod-sql-test.mjs); сама ч. 18 берётся из community.sql и выполняется ДВАЖДЫ (идемпотентность).
// Проверяет: убрать из голосового (права, срок, запрет входа, снять запрет, cv_ping2), роль из карточки (только админ, не админа,
// не себя), удаление последних сообщений во всех каналах, жалоба на человека (на себя и создателя нельзя, на команду — создателю,
// статусы, «рассмотрено»), «следить» (возраст, блокировка, скрытый профиль, счётчик, лента, 🔔 только с колокольчиком).
// Запуск из корня сайта: node scripts/part18-sql-test.mjs (PGLITE_PATH / DEPS_DIR)
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
  const msg = 'part18-sql-test: PGlite не найден — SQL-проверки пропущены (PGLITE_PATH=… или DEPS_DIR=…)';
  if (process.env.CI_STRICT) { console.log('FAIL ' + msg); process.exit(1); }
  console.log('SKIP ' + msg); process.exit(0);
}
const ALL = fs.readFileSync(path.join(SITE, 'community.sql'), 'utf8').replace(/\r\n/g, '\n');
const k0 = ALL.indexOf('\n-- ЧАСТЬ 18 ');
if (k0 < 0) { console.log('FAIL part 18 not found'); process.exit(1); }
const k1 = ALL.indexOf('\n-- ЧАСТЬ 19 ', k0);
const PART = ALL.slice(k0, k1 > 0 ? k1 : undefined);

let n = 0, fails = 0;
const ok = (c, m, x) => { n++; if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 500) : '')); };
const db = new PGlite();
const A = '00000000-0000-4000-8000-00000000000a', MOD = '00000000-0000-4000-8000-00000000000b', HLP = '00000000-0000-4000-8000-00000000000c',
  U1 = '00000000-0000-4000-8000-000000000001', U2 = '00000000-0000-4000-8000-000000000002', KID = '00000000-0000-4000-8000-000000000003',
  OWN = '00000000-0000-4000-8000-000000000004', HID = '00000000-0000-4000-8000-000000000005';
await db.exec(`create role anon; create role authenticated; create schema auth;
create table cur(u uuid); insert into cur values (null);
create function auth.uid() returns uuid language sql as 'select u from cur';
create table public.profiles(id uuid primary key, role text default 'user', nick text, grp text default 'adult', privacy_profile text default 'all', created_at timestamptz not null default now());
create function public.is_admin_user(uid uuid) returns boolean language sql stable as $$ select coalesce((select role = 'admin' from public.profiles where id = uid), false) $$;
create function public.mod_is_owner(p_uid uuid) returns boolean language sql stable as $$ select p_uid is not null and coalesce((select role = 'admin' from public.profiles where id = p_uid), false) $$;
create function public.chat_staff_role(p_uid uuid default auth.uid()) returns text language sql stable as $$ select role from public.profiles where id = p_uid and role in ('admin','moderator','helper') $$;
create function public.comm_is_staff(p_uid uuid default auth.uid()) returns boolean language sql stable as $$ select coalesce((select role in ('admin','moderator') from public.profiles where id = p_uid), false) $$;
create function public.mod_target_staff(p_cid bigint, p_uid uuid) returns boolean language sql stable as $$ select p_uid is not null and public.chat_staff_role(p_uid) is not null $$;
create function public.mod_report_guard(p_reporter uuid, p_target uuid) returns text language sql stable as $$
  select case when p_target is not null and p_target = p_reporter then 'self' when p_target is not null and public.mod_is_owner(p_target) then 'creator' end $$;
create table public.communities(id bigint primary key, name text);
create table public.community_members(community_id bigint, user_id uuid, role text not null default 'member', primary key (community_id, user_id));
create table public.community_channels(id bigint primary key, community_id bigint, name text, kind text default 'text');
create table public.community_messages(id bigserial primary key, channel_id bigint, user_id uuid, text text default '', deleted boolean not null default false, hidden boolean not null default false, reactions jsonb default '{}');
create table public.messages(id bigserial primary key, user_id uuid, nick text, text text, channel text, deleted boolean default false);
create function public.comm_can_mod(p_cid bigint, p_actor uuid, p_target uuid) returns boolean language sql stable as $$
  select p_actor is not null and p_target is not null and p_actor <> p_target and (public.comm_is_staff(p_actor)
    or (select role from public.community_members where community_id = p_cid and user_id = p_actor) = 'owner') $$;
create function public.comm_bad(p text) returns boolean language sql immutable as $$ select coalesce(p, '') ~* 'бля' $$;
create function public.comm_bucket(p_min int default 5) returns text language sql stable as $$ select '0' $$;
create table public.user_blocks(blocker_id uuid, blocked_id uuid);
create function public.comm_blocked(a uuid, b uuid) returns boolean language sql stable as $$
  select a is not null and b is not null and exists (select 1 from public.user_blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)) $$;
create table public.friendships(requester_id uuid, addressee_id uuid, status text);
create function public.comm_friends(a uuid, b uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.friendships where status = 'accepted' and ((requester_id = a and addressee_id = b) or (requester_id = b and addressee_id = a))) $$;
create function public.kid_pair_ok(a uuid, b uuid) returns boolean language sql stable as $$
  select a is null or b is null or a = b or not ((select grp from public.profiles where id = a) = 'child' and (select grp from public.profiles where id = b) in ('adult', 'unknown'))
    and not ((select grp from public.profiles where id = b) = 'child' and (select grp from public.profiles where id = a) in ('adult', 'unknown')) $$;
create function public.ds_vis(p_viewer uuid, p_uid uuid) returns boolean language sql stable as $$
  select coalesce(p_viewer = p_uid, false) or coalesce((select case p.privacy_profile when 'all' then true when 'friends' then public.comm_friends(p_viewer, p_uid) else false end from public.profiles p where p.id = p_uid), false) $$;
create table public.notes(user_id uuid, kind text, title text, body text, link text, dedupe text);
create function public.comm_notify(p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_link text, p_dedupe text) returns void language sql as $$
  insert into public.notes select p_user, p_kind, p_title, p_body, p_link, p_dedupe where p_user is not null and p_user is distinct from p_actor $$;
create function public.notify(p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_link text, p_dedupe text default null) returns void language sql as $$
  insert into public.notes select p_user, p_kind, p_title, p_body, p_link, p_dedupe where p_user is not null and p_user is distinct from p_actor $$;
create function public.mod_done_notice(p_user uuid, p_state text, p_key text) returns void language sql as $$
  insert into public.notes values (p_user, 'report_done', '✅ Твою жалобу рассмотрели', p_state, '', 'repdone:' || p_key) $$;
create table public.comm_modlog(id bigserial primary key, community_id bigint, actor_id uuid, target_id uuid, target_nick text, action text, reason text, detail text, channel text, created_at timestamptz not null default now());
create function public.comm_log(p_cid bigint, p_actor uuid, p_target uuid, p_tnick text, p_action text, p_reason text, p_detail text, p_channel text) returns void language sql as $$
  insert into public.comm_modlog (community_id, actor_id, target_id, target_nick, action, reason, detail, channel) values (p_cid, p_actor, p_target, p_tnick, p_action, p_reason, p_detail, p_channel) $$;
create table public.voice_here(channel_id bigint not null, user_id uuid not null, nick text not null default '', seen_at timestamptz not null default now(), primary key (channel_id, user_id));
-- как cv_pass на живой базе в той части, что важна: запись в «кто внутри» (вставка с on conflict)
create function public.cv_pass_stub(p_channel bigint) returns jsonb language plpgsql security definer as $$
begin
  insert into public.voice_here (channel_id, user_id, nick, seen_at) values (p_channel, auth.uid(), '', now()) on conflict (channel_id, user_id) do update set seen_at = now();
  return jsonb_build_object('ok', true);
end $$;
create table public.forum_threads(id bigserial primary key, author_id uuid, title text, status text not null default 'published', age_min smallint not null default 12, realm text not null default 'kids',
  excerpt text not null default '', published_at timestamptz, created_at timestamptz default now());
create table public.forum_follows(follower uuid not null, author uuid not null, created_at timestamptz not null default now(), primary key (follower, author), check (follower <> author));
create function public.forum_cap(p_uid uuid) returns int language sql stable as $$ select case when (select grp from public.profiles where id = p_uid) = 'child' then 6 else 16 end $$;
create function public.forum_can_see(p_status text, p_author uuid, p_age int, p_realm text, p_uid uuid) returns boolean language sql stable as $$
  select coalesce((auth.uid() is not null and p_author = auth.uid()) or (p_status = 'published' and p_age <= public.forum_cap(auth.uid()) and p_realm = 'kids'), false) $$;
create table public.site_config(key text primary key, value text);
create table public.ugc_games(id text primary key, author uuid, title text, descr text not null default '', icon text not null default '🎮', kind text not null default 'tpl', status text not null default 'draft', updated_at timestamptz not null default now());
create table public.unity_games(id text primary key, author uuid, title text, descr text not null default '', icon text not null default '🕹️', status text not null default 'draft', updated_at timestamptz not null default now());
`);
await db.query(`insert into public.profiles (id, role, nick, grp, privacy_profile) values ($1,'admin','dan4ik37','adult','all'), ($2,'moderator','Модер','adult','all'), ($3,'helper','Хелпер','adult','all'),
  ($4,'user','Вася','adult','all'), ($5,'user','Петя','adult','all'), ($6,'user','Малыш','child','all'), ($7,'user','Хозяин','adult','all'), ($8,'user','Тихий','adult','nobody')`, [A, MOD, HLP, U1, U2, KID, OWN, HID]);
await db.exec(`insert into public.communities values (7, 'Клуб'); insert into public.community_members values (7, '${OWN}', 'owner'), (7, '${U1}', 'member'), (7, '${U2}', 'member');
  insert into public.community_channels values (70, 7, 'общий', 'text'), (71, 7, 'флуд', 'text'), (72, 7, 'Голос', 'voice');`);

try { await db.exec(PART); ok(true, 'часть 18 выполнилась'); } catch (e) { ok(false, 'часть 18 выполнилась', String(e.message || e)); console.log(e); process.exit(1); }
try { await db.exec(PART); ok(true, 'часть 18 выполнилась второй раз (повторный запуск безопасен)'); } catch (e) { ok(false, 'повторный запуск', String(e.message || e)); }

const as = async u => { await db.query('update cur set u = $1', [u]); };
const rpc = async (u, sql, p) => { await as(u); return (await db.query('select ' + sql + ' as r', p)).rows[0].r; };
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const enter = async (u, ch) => { await as(u); try { await db.query('select public.cv_pass_stub($1)', [ch]); return 'ok'; } catch (e) { return String(e.message || e); } };

// ═══ info ═══
r0: { const i = await rpc(null, 'public.part18_info()'); ok(i.ok === true && i.v === 1 && Object.keys(i).length === 2, 'part18_info → {"ok":true,"v":1}', i); }

ok((await one(`select value from public.site_config where key = 'part18'`))?.value === '1' && (await one(`select count(*)::int c from public.site_config`)).c === 1, 'метка для сайта: site_config part18 = 1 (одна строка и после второго запуска)');

// ═══ 18.1 убрать из голосового ═══
ok(await enter(U1, 0) === 'ok' && await enter(U2, 0) === 'ok' && await enter(MOD, 0) === 'ok', 'трое вошли в голосовой сайта');
let r = await rpc(U2, 'public.mod_voice_kick($1, null, 10, $2)', [U1, 'шум']);
ok(r.ok === false && r.reason === 'rights', 'обычный игрок убрать из голосового не может', r);
r = await rpc(HLP, 'public.mod_voice_kick($1, null, 120, $2)', [U1, 'шум']);
ok(r.ok === false && r.reason === 'minutes', 'хелпер — не дольше часа', r);
r = await rpc(HLP, 'public.mod_voice_kick($1, null, 10, $2)', [MOD, 'шум']);
ok(r.ok === false && r.reason === 'rights', 'хелпер не убирает модератора (команду — только админ)', r);
r = await rpc(MOD, 'public.mod_voice_kick($1, null, 10, $2)', [A, '']);
ok(r.ok === false && r.reason === 'creator', 'создателя убрать нельзя', r);
r = await rpc(MOD, 'public.mod_voice_kick($1, null, 10, $2)', [MOD, '']);
ok(r.ok === false && r.reason === 'self', 'себя — нельзя', r);
r = await rpc(MOD, 'public.mod_voice_kick($1, null, 10, $2)', [KID, '']);
ok(r.ok === false && r.reason === 'not_in_voice', 'кого нет в голосовом — «не в голосовом»', r);
r = await rpc(MOD, 'public.mod_voice_kick($1, null, 10, $2)', [U1, 'бля']);
ok(r.ok === false && r.reason === 'bad', 'причина с матом — отказ', r);
r = await rpc(MOD, 'public.mod_voice_kick($1, null, 10, $2)', [U1, 'шумит']);
ok(r.ok === true && r.n === 1 && r.minutes === 10, 'модератор убрал игрока на 10 минут', r);
ok((await one('select count(*)::int c from public.voice_here where user_id = $1', [U1])).c === 0, 'его нет в «кто внутри»');
const e1 = await enter(U1, 0);
ok(/voice_kicked:\d+/.test(e1), 'вернуться раньше срока нельзя: сервер отвечает voice_kicked:<минут>', e1);
ok(await enter(U1, -1) === 'ok', 'в другой канал сайта войти можно (запрет — на тот канал)');
ok(await enter(U2, 0) === 'ok', 'остальных вход не касается');
r = await rpc(U1, 'public.cv_ping2(0)');
ok(r.ok === false && r.kicked === true && r.reason === 'шумит' && Array.isArray(r.out) && r.out.length === 0, 'cv_ping2 выгнанному: kicked = true, причина; списка «кого убрали» ему не дают', r);
r = await rpc(U2, 'public.cv_ping2(0)');
ok(r.ok === true && r.kicked === false && r.out.length === 1 && r.out[0] === U1, 'cv_ping2 соседу: ok, в out — выгнанный (сосед отключит его у себя)', r);
r = await rpc(null, 'public.cv_ping2(0)');
ok(r.ok === false && r.reason === 'auth', 'cv_ping2 гостю — auth', r);
ok((await one(`select count(*)::int c from public.comm_modlog where action = 'vkick' and target_id = $1 and reason = 'шумит' and detail = '10 мин'`, [U1])).c === 1, 'в журнале — запись «убрал из голосового» с причиной и сроком');
ok((await one(`select count(*)::int c from public.notes where user_id = $1 and title like '🔇%'`, [U1])).c === 1, 'ему — 🔔 с причиной');
r = await rpc(U2, 'public.mod_voice_kick($1, null, 0, $2)', [U1, '']);
ok(r.ok === false && r.reason === 'rights', 'снять запрет игрок не может', r);
r = await rpc(HLP, 'public.mod_voice_kick($1, null, 0, $2)', [U1, '']);
ok(r.ok === true && r.undone === true, 'хелпер снял запрет', r);
ok(await enter(U1, 0) === 'ok', 'после снятия — входит');
r = await rpc(MOD, 'public.mod_voice_kick($1, null, 0, $2)', [U1, '']);
ok(r.ok === false && r.reason === 'not_kicked', 'снимать нечего — not_kicked', r);
// сообщество: владелец убирает участника, участник — нет; модератор сайта — может
await enter(U1, 72); await enter(U2, 72);
r = await rpc(U2, 'public.mod_voice_kick($1, 72, 5, $2)', [U1, '']);
ok(r.ok === false && r.reason === 'rights', 'сообщество: участник убрать не может', r);
r = await rpc(OWN, 'public.mod_voice_kick($1, 72, 1440, $2)', [U1, '']);
ok(r.ok === true && r.n === 1, 'сообщество: владелец убрал на день', r);
ok((await one(`select community_id c from public.comm_modlog where action = 'vkick' and channel = '72'`)).c == 7, 'запись — в журнале сообщества');
r = await rpc(OWN, 'public.mod_voice_kick($1, 0, 5, $2)', [U2, '']);
ok(r.ok === false && r.reason === 'rights', 'владелец сообщества в голосовом сайта прав не имеет', r);
r = await rpc(OWN, 'public.mod_voice_kick($1, null, 2000, $2)', [U2, '']);
ok(r.ok === false && r.reason === 'minutes', 'дольше суток — отказ', r);

// ═══ 18.2 роль из карточки ═══
r = await rpc(MOD, 'public.mod_role_set($1, $2, $3)', [U1, 'helper', '']);
ok(r.ok === false && r.reason === 'admin_only', 'роль выдаёт только админ', r);
r = await rpc(A, 'public.mod_role_set($1, $2, $3)', [U1, 'admin', '']);
ok(r.ok === false && r.reason === 'role', 'админом из карточки не назначить', r);
r = await rpc(A, 'public.mod_role_set($1, $2, $3)', [A, 'user', '']);
ok(r.ok === false && r.reason === 'self', 'себе — нельзя', r);
r = await rpc(A, 'public.mod_role_set($1, $2, $3)', [U1, 'helper', 'помогает в чате']);
ok(r.ok === true && r.old === 'user' && r.role === 'helper' && (await one('select role from public.profiles where id = $1', [U1])).role === 'helper', 'админ выдал «хелпер»', r);
r = await rpc(A, 'public.mod_role_set($1, $2, $3)', [U1, 'helper', '']);
ok(r.ok === false && r.reason === 'same_role', 'та же роль — same_role', r);
r = await rpc(A, 'public.mod_role_set($1, $2, $3)', [U1, 'user', '']);
ok(r.ok === true && (await one('select role from public.profiles where id = $1', [U1])).role === 'user', 'админ снял роль', r);
ok((await one(`select count(*)::int c from public.comm_modlog where action = 'role_set' and target_id = $1`, [U1])).c === 2 && (await one(`select count(*)::int c from public.notes where user_id = $1 and link = '/profile'`, [U1])).c === 2, 'журнал и 🔔 — на каждую смену роли');
r = await rpc(null, 'public.mod_role_set($1, $2, $3)', [U1, 'helper', '']);
ok(r.ok === false && r.reason === 'admin_only', 'гость — отказ', r);

// ═══ 18.3 удалить последние сообщения во всех каналах ═══
await db.exec(`insert into public.messages (user_id, nick, text, channel) select '${U1}', 'Вася', 'спам ' || g, case when g % 2 = 0 then null else 'memes' end from generate_series(1, 30) g;
  insert into public.messages (user_id, nick, text) values ('${U2}', 'Петя', 'привет'), ('${MOD}', 'Модер', 'я модер');
  insert into public.community_messages (channel_id, user_id, text) select case when g % 2 = 0 then 70 else 71 end, '${U1}', 'спам ' || g from generate_series(1, 12) g;
  insert into public.community_messages (channel_id, user_id, text) values (70, '${U2}', 'привет');`);
r = await rpc(U2, 'public.mod_purge_user(null, $1, 25, $2)', [U1, '']);
ok(r.ok === false && r.reason === 'staff', 'игрок чужие сообщения не удаляет', r);
r = await rpc(HLP, 'public.mod_purge_user(null, $1, 25, $2)', [MOD, '']);
ok(r.ok === false && r.reason === 'rights', 'хелпер не чистит модератора', r);
r = await rpc(HLP, 'public.mod_purge_user(null, $1, 25, $2)', [U1, 'спам']);
ok(r.ok === true && r.n === 25, 'хелпер удалил 25 последних (оба канала)', r);
let c = await one(`select count(*) filter (where not deleted)::int live, count(*) filter (where deleted and channel = 'memes')::int m, count(*) filter (where deleted and channel is null)::int g from public.messages where user_id = $1`, [U1]);
ok(c.live === 5 && c.m > 0 && c.g > 0, 'осталось 5 самых старых; удалены в обоих каналах', c);
ok((await one(`select count(*)::int c from public.messages where user_id <> $1 and deleted`, [U1])).c === 0, 'чужие сообщения не тронуты');
r = await rpc(MOD, 'public.mod_purge_user(null, $1, 1000, $2)', [U1, '']);
ok(r.ok === true && r.n === 5, 'больше 100 за раз не удаляет (тут — оставшиеся 5)', r);
r = await rpc(U2, 'public.mod_purge_user(7, $1, 10, $2)', [U1, '']);
ok(r.ok === false && r.reason === 'rights', 'сообщество: участник — отказ', r);
r = await rpc(OWN, 'public.mod_purge_user(7, $1, 10, $2)', [U1, 'спам']);
ok(r.ok === true && r.n === 10 && (await one(`select count(*)::int c from public.community_messages where user_id = $1 and not deleted`, [U1])).c === 2, 'сообщество: владелец удалил 10 последних в двух каналах', r);
ok((await one(`select count(*)::int c from public.comm_modlog where action = 'purge'`)).c === 3, 'журнал: три записи «чистка»');
r = await rpc(A, 'public.mod_purge_user(null, $1, 10, $2)', [A, '']);
ok(r.ok === false && r.reason === 'self', 'себя — нельзя', r);

// ═══ 18.4 жалоба на человека ═══
r = await rpc(null, 'public.user_report($1, $2, $3, $4)', [U1, 'nick', 'плохой ник', 'card']);
ok(r.ok === false && r.reason === 'auth', 'гость пожаловаться не может', r);
r = await rpc(U1, 'public.user_report($1, $2, $3, $4)', [U1, 'nick', 'плохой ник', 'card']);
ok(r.ok === false && r.reason === 'self', 'на себя — нельзя', r);
r = await rpc(U1, 'public.user_report($1, $2, $3, $4)', [A, 'nick', 'плохой ник', 'card']);
ok(r.ok === false && r.reason === 'creator', 'на создателя — нельзя', r);
r = await rpc(U1, 'public.user_report($1, $2, $3, $4)', [U2, 'nick', 'аб', 'card']);
ok(r.ok === false && r.reason === 'reason_req', 'без причины (меньше 3 знаков) — отказ', r);
r = await rpc(U1, 'public.user_report($1, $2, $3, $4)', [U2, 'что-то', 'оскорбляет в голосовом', 'card']);
ok(r.ok === true && r.to_owner === false && (await one('select kind from public.user_reports where target_id = $1', [U2])).kind === 'other', 'жалоба принята; неизвестный вид → «другое»', r);
r = await rpc(U1, 'public.user_report($1, $2, $3, $4)', [U2, 'nick', 'ещё раз', 'card']);
ok(r.ok === true && r.again === true && (await one('select count(*)::int c from public.user_reports where target_id = $1', [U2])).c === 1, 'повторная от того же — не дублируется', r);
await rpc(KID, 'public.user_report($1, $2, $3, $4)', [U2, 'avatar', 'страшная картинка', 'profile']);
ok((await one(`select count(*)::int c from public.notes where kind = 'cm_report' and dedupe = 'urep:' || $1`, [U2])).c === 2, 'команде (админ + модератор) — 🔔 один раз на человека');
r = await rpc(U1, 'public.user_report($1, $2, $3, $4)', [MOD, 'behavior', 'грубит игрокам', 'card']);
ok(r.ok === true && r.to_owner === true, 'жалоба на модератора — «создателю»', r);
r = await rpc(U1, 'public.mod_user_reports($1)', ['open']);
ok(r.ok === false && r.reason === 'staff', 'список жалоб игроку не виден', r);
r = await rpc(HLP, 'public.mod_user_reports($1)', ['open']);
ok(r.ok === true && r.list.length === 1 && r.list[0].target === U2 && r.list[0].n === 2 && r.list[0].state === 'new' && /страшная/.test(r.list[0].reasons), 'хелпер видит жалобы на игрока (2 в одной строке), на команду — нет', r);
r = await rpc(MOD, 'public.mod_user_reports($1)', ['open']);
ok(r.ok === true && r.list.length === 1, 'модератор жалобу на себя не видит', r);
r = await rpc(A, 'public.mod_user_reports($1)', ['open']);
ok(r.ok === true && r.list.length === 2 && r.list.some(x => x.target === MOD && x.to_owner), 'создатель видит и жалобу на команду', r);
r = await rpc(HLP, 'public.mod_user_report_set($1, $2, $3)', [MOD, 'done', '']);
ok(r.ok === false && r.reason === 'closed', 'хелпер жалобу на команду закрыть не может', r);
r = await rpc(HLP, 'public.mod_user_report_set($1, $2, $3)', [U2, 'work', '']);
ok(r.ok === true && r.n === 2, 'хелпер взял в работу', r);
r = await rpc(MOD, 'public.mod_user_reports($1)', ['work']);
ok(r.list.length === 1 && r.list[0].state === 'work' && r.list[0].by_nick === 'Хелпер', 'статус «в работе», видно кто взял', r);
r = await rpc(MOD, 'public.mod_user_report_set($1, $2, $3)', [U2, 'done', 'предупредили']);
ok(r.ok === true && r.n === 2, 'модератор закрыл: нарушение', r);
ok((await one(`select count(*)::int c from public.notes where kind = 'report_done'`)).c === 2, 'обоим жалобщикам — «жалобу рассмотрели»');
r = await rpc(MOD, 'public.mod_user_report_set($1, $2, $3)', [U2, 'done', '']);
ok(r.ok === false && r.reason === 'closed', 'закрытую второй раз — closed', r);
r = await rpc(U1, 'public.user_report($1, $2, $3, $4)', [U2, 'nick', 'снова за своё', 'card']);
ok(r.ok === true && !r.again, 'после закрытия можно пожаловаться снова', r);
await db.exec(`insert into public.user_reports (target_id, reporter_id, kind, reason, state, created_at) select '${OWN}', '${U1}', 'other', 'спам жалобами', 'done', now() from generate_series(1, 9)`);
r = await rpc(U1, 'public.user_report($1, $2, $3, $4)', [HID, 'nick', 'плохой ник', '']);
ok(r.ok === false && r.reason === 'rate', 'не больше 10 жалоб в час от одного человека', r);

// ═══ 18.5 «следить» ═══
r = await rpc(null, 'public.follow_set($1, true)', [U2]);
ok(r.ok === false && r.reason === 'auth', 'гость следить не может', r);
r = await rpc(U1, 'public.follow_set($1, true)', [U1]);
ok(r.ok === false && r.reason === 'own', 'за собой — нельзя', r);
r = await rpc(KID, 'public.follow_set($1, true)', [U2]);
ok(r.ok === false && r.reason === 'age', 'ребёнок за взрослым — нельзя (как дружба)', r);
r = await rpc(U2, 'public.follow_set($1, true)', [KID]);
ok(r.ok === false && r.reason === 'age', 'взрослый за ребёнком — нельзя', r);
r = await rpc(U1, 'public.follow_set($1, true)', [HID]);
ok(r.ok === false && r.reason === 'hidden', 'за скрытым профилем — нельзя', r);
await db.exec(`insert into public.user_blocks values ('${OWN}', '${U1}')`);
r = await rpc(U1, 'public.follow_set($1, true)', [OWN]);
ok(r.ok === false && r.reason === 'blocked', 'заблокировал — следить нельзя', r);
r = await rpc(U1, 'public.follow_set($1, true)', [U2]);
ok(r.ok === true && r.follow === true && r.notify === false && r.followers === 1, 'слежу: колокольчик по умолчанию выключен, счётчик 1', r);
r = await rpc(U1, 'public.follow_set($1, true, true)', [U2]);
ok(r.ok === true && r.notify === true && r.followers === 1, 'включил колокольчик — без второй подписки', r);
r = await rpc(U1, 'public.follow_set($1, true)', [U2]);
ok(r.ok === true && r.notify === true, 'повторное «слежу» колокольчик не сбрасывает', r);
await rpc(MOD, 'public.follow_set($1, true)', [U2]);
r = await rpc(null, 'public.follow_info($1)', [U2]);
ok(r.ok === true && r.followers === 2 && r.following === false && r.can === false, 'гостю: число подписчиков, без «слежу»', r);
r = await rpc(U1, 'public.follow_info($1)', [U2]);
ok(r.followers === 2 && r.following === true && r.notify === true && r.can === true && r.why == null, 'мне: слежу, колокольчик включён', r);
r = await rpc(MOD, 'public.follow_info($1)', [HID]);
ok(r.ok === true && r.followers == null && r.can === false && r.why === 'hidden', 'скрытый профиль: числа нет, причина — hidden', r);
r = await rpc(U2, 'public.follow_info($1)', [U2]);
ok(r.followers === 2 && r.mine === 0 && r.can === false, 'себе: сколько следят за мной и за сколькими слежу я', r);
r = await rpc(U1, 'public.follow_list()');
ok(r.ok === true && r.list.length === 1 && r.list[0].id === U2 && r.list[0].nick === 'Петя' && r.list[0].notify === true, 'за кем слежу', r);
// лента и 🔔
await db.exec(`delete from public.notes;
  insert into public.forum_threads (author_id, title, status, age_min) values ('${U2}', 'Как строить дом', 'published', 12), ('${U2}', 'Черновик', 'draft', 12), ('${U2}', 'Взрослая', 'published', 18), ('${OWN}', 'Чужая', 'published', 0);
  insert into public.ugc_games (id, author, title, status, kind) values ('g1', '${U2}', 'Гонки', 'public', 'tpl'), ('g2', '${U2}', 'Секрет', 'draft', 'tpl'), ('g3', '${U2}', 'Мир', 'review', 'place');
  insert into public.unity_games (id, author, title, status) values ('u1', '${U2}', 'Платформер', 'public');`);
r = await rpc(U1, 'public.follow_feed(30)');
const kinds = (r.list || []).map(x => x.kind + ':' + x.title).sort();
ok(r.ok === true && JSON.stringify(kinds) === JSON.stringify(['game:Гонки', 'thread:Как строить дом', 'unity:Платформер']) && r.list.every(x => x.nick === 'Петя'), 'лента: опубликованная статья и опубликованные игры; черновики, 18+ и чужие — нет', kinds);
r = await rpc(null, 'public.follow_feed(30)');
ok(r.ok === false && r.reason === 'auth', 'лента гостю — auth', r);
c = (await db.query(`select user_id, title from public.notes where kind = 'follow_new' order by title`)).rows;
ok(c.length === 3 && c.every(x => x.user_id === U1), '🔔 только тому, кто включил колокольчик (не модератору без колокольчика): статья, игра, игра Unity', c);
await db.exec(`update public.ugc_games set status = 'public' where id = 'g3'; update public.ugc_games set title = 'Гонки 2' where id = 'g1'; update public.forum_threads set status = 'published' where title = 'Черновик';`);
c = (await db.query(`select title, body, link from public.notes where kind = 'follow_new' order by link`)).rows;
ok(c.length === 5 && c.some(x => x.link === '#/games/studio3d/play/g3') && c.some(x => x.link === '#/games/studio/play/g1') && c.some(x => x.link === '#/games/unity/play/u1') && c.filter(x => /^\/forum\/\d+$/.test(x.link)).length === 2,
  '🔔 при публикации позже (3D-мир, статья из черновика) — со ссылкой; правка названия 🔔 не шлёт', c);
await db.exec(`insert into public.user_blocks values ('${U2}', '${U1}')`);
r = await rpc(U1, 'public.follow_feed(30)');
ok(r.ok === true && r.list.length === 0, 'после блокировки лента пустая', r);
r = await rpc(U1, 'public.follow_set($1, false)', [U2]);
ok(r.ok === true && r.follow === false && r.followers === 1, 'отписался (можно всегда, даже после блокировки)', r);
// сломанная функция уведомлений не ломает публикацию
await db.exec(`delete from public.user_blocks; drop function public.notify(uuid, text, uuid, text, text, text, text);`);
await rpc(U1, 'public.follow_set($1, true, true)', [U2]);
let pubOk = true; try { await db.exec(`insert into public.forum_threads (author_id, title, status) values ('${U2}', 'После поломки', 'published')`); } catch (e) { pubOk = false; }
ok(pubOk, 'ошибка в уведомлениях не ломает публикацию статьи');

// ═══ права: гость (anon) функции модерации вызвать не может ═══
const acl = (await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') an, has_function_privilege('authenticated', p.oid, 'execute') au from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('mod_voice_kick','cv_ping2','mod_role_set','mod_purge_user','user_report','mod_user_reports','mod_user_report_set','follow_set','follow_list','follow_feed','follow_info','part18_info','follow_why','follow_notify','voice_here_guard')`)).rows;
const A1 = Object.fromEntries(acl.map(x => [x.proname, (x.an ? 'a' : '-') + (x.au ? 'u' : '-')]));
ok(acl.length === 15 && ['mod_voice_kick', 'cv_ping2', 'mod_role_set', 'mod_purge_user', 'user_report', 'mod_user_reports', 'mod_user_report_set', 'follow_set', 'follow_list', 'follow_feed'].every(f => A1[f] === '-u')
  && A1.follow_info === 'au' && A1.part18_info === 'au' && ['follow_why', 'follow_notify', 'voice_here_guard'].every(f => A1[f] === '--'), 'права: гостю — только follow_info и part18_info; служебные закрыты всем', A1);
const tb = (await db.query(`select has_table_privilege('authenticated', 'public.voice_kicks', 'select') a, has_table_privilege('authenticated', 'public.user_reports', 'select') b`)).rows[0];
ok(!tb.a && !tb.b, 'таблицы voice_kicks и user_reports закрыты от прямого чтения');

console.log(`\n${fails ? 'FAIL' : 'OK'} part18-sql-test: ${n - fails}/${n}`);
process.exit(fails ? 1 : 0);
