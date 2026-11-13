// T-164 ds-msg: community.sql ч. 12 (ветки, история правок, опросы, форумы, @here / @роль без детей) на PGlite с заглушками живых
// таблиц и помощников (колонки — как на сервере 13.11); часть выполняется дважды (идемпотентность).
// Запуск из корня сайта: node scripts/ds-msg-sql-test.mjs (PGLITE_PATH / DEPS_DIR)
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
  const msg = 'ds-msg-sql-test: PGlite не найден — SQL-проверки пропущены (PGLITE_PATH=… или DEPS_DIR=…)';
  if (process.env.CI_STRICT) { console.log('FAIL ' + msg); process.exit(1); }
  console.log('SKIP ' + msg);
  process.exit(0);
}

let sql = fs.readFileSync(path.join(SITE, 'community.sql'), 'utf8'); const k0 = sql.indexOf('-- ═══ часть 12 (ds-msg) ═══');
if (k0 < 0) { console.log('FAIL part 12 not found'); process.exit(1); }
const k1 = sql.indexOf('-- ═══ часть 1', k0 + 10); sql = sql.slice(k0, k1 > 0 ? k1 : undefined);
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create role app; create schema auth;
create table cur(u uuid, r text); insert into cur values (null, 'anon');
create function auth.uid() returns uuid language sql as 'select u from cur';
create function auth.role() returns text language sql as 'select r from cur';
create table public.profiles(id uuid primary key, role text, nick text);
create table public.user_age(user_id uuid primary key, birth_year int);
create function public.age_year_now() returns int language sql as 'select extract(year from now())::int';
create function public.kidsafe_on() returns boolean language sql as 'select true';
create function public.age_group_of(p_uid uuid) returns text language sql stable as $$ select coalesce((select case when public.age_year_now() - birth_year - 1 < 13 then 'child' when public.age_year_now() - birth_year - 1 < 16 then 'teen' when public.age_year_now() - birth_year - 1 < 18 then 'teen16' else 'adult' end from public.user_age where user_id = p_uid and birth_year is not null), 'unknown') $$;
create function public.age_u9(p_uid uuid) returns boolean language sql stable as $$ select coalesce((select public.age_year_now() - birth_year - 1 < 9 from public.user_age where user_id = p_uid), false) $$;
create function public.chat_staff_role(p_uid uuid default auth.uid()) returns text language sql stable as $$ select role from public.profiles where id = p_uid and role in ('admin','moderator','helper') $$;
create function public.comm_is_staff(p_uid uuid default auth.uid()) returns boolean language sql stable as $$ select coalesce((select role in ('admin','moderator') from public.profiles where id = p_uid), false) $$;
create table public.communities(id bigint primary key, name text, status text default 'active', is_public boolean default true, everyone_at timestamptz);
create table public.community_members(community_id bigint, user_id uuid, role text default 'member', muted_until timestamptz);
create table public.comm_roles(id bigint primary key, community_id bigint, name text, perms int default 0);
create table public.comm_member_roles(community_id bigint, role_id bigint, user_id uuid);
create table public.comm_online(user_id uuid primary key, seen_at timestamptz default now(), place text default '');
create function public.comm_is_member(p_cid bigint) returns boolean language sql stable as $$ select exists (select 1 from public.community_members where community_id = p_cid and user_id = auth.uid()) $$;
create function public.comm_perm(p_cid bigint, p_uid uuid, p_bit int) returns boolean language sql stable as $$ select p_uid is not null and (public.comm_is_staff(p_uid) or coalesce((select role in ('owner','mod') from public.community_members where community_id = p_cid and user_id = p_uid), false) or exists (select 1 from public.comm_member_roles m join public.comm_roles r on r.id = m.role_id where m.community_id = p_cid and m.user_id = p_uid and (r.perms & p_bit) <> 0)) $$;
create function public.chan_can_manage(p_cid bigint, p_uid uuid) returns boolean language sql stable as $$ select p_uid is not null and case when p_cid is null then coalesce(public.chat_staff_role(p_uid), '') in ('admin','moderator') else public.comm_perm(p_cid, p_uid, 1) end $$;
create function public.comm_bad(p text) returns boolean language sql immutable as $$ select coalesce(p, '') ~* 'бля' $$;
create function public.comm_has_link(p text) returns boolean language sql immutable as $$ select coalesce(p, '') ~* '(https?:|www\\.|t\\.me/)' $$;
create function public.comm_bucket(p_min int default 5) returns text language sql as $$ select '0' $$;
create table public.notif(u uuid, kind text, actor uuid, title text, link text, dedupe text);
create function public.comm_notify(p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_link text, p_dedupe text) returns void language sql as $$ insert into public.notif select p_user, p_kind, p_actor, p_title, p_link, p_dedupe where p_user is distinct from p_actor $$;
create table public.comm_modlog(community_id bigint, actor_id uuid, action text, detail text);
create function public.comm_log(p_cid bigint, p_actor uuid, p_target uuid, p_tnick text, p_action text, p_reason text, p_detail text, p_channel text) returns void language sql as $$ insert into public.comm_modlog values (p_cid, p_actor, p_action, p_detail) $$;
create table public.chat_channels(id text primary key, name text, kind text default 'text', archived boolean default false, mods_only boolean default false, min_age int default 0);
insert into public.chat_channels(id, name) values ('general','общий'),('news','новости'),('games','игры'),('memes','мемы');
update public.chat_channels set min_age = 13 where id = 'games'; update public.chat_channels set mods_only = true where id = 'news';
create table public.chat_mutes(user_id uuid, nick text default '', until timestamptz);
create table public.community_channels(id bigint primary key, community_id bigint, name text, kind text default 'text', archived boolean default false, mods_only boolean default false, min_age int default 0);
create function public.chat_chan_age_ok(p_ch text) returns boolean language sql stable as $$ select p_ch is null or coalesce((select min_age from public.chat_channels where id = p_ch), 0) <= 0 or (public.age_group_of(auth.uid()) in ('teen','teen16','adult')) or public.chat_staff_role(auth.uid()) in ('admin','moderator') $$;
create function public.cm_chan_age_ok(p_ch bigint) returns boolean language sql stable as $$ select coalesce((select min_age from public.community_channels where id = p_ch), 0) <= 0 or public.age_group_of(auth.uid()) in ('teen16','adult') $$;
create table public.messages(id bigint generated always as identity primary key, nick text, text text, color text, role text, user_id uuid, deleted boolean not null default false, created_at timestamptz not null default now(), vip_tier text, pinned_until timestamptz, pinned_by uuid, channel text, reply_to bigint, edited_at timestamptz, is_sticker boolean not null default false, att jsonb);
create table public.community_messages(id bigint generated always as identity primary key, channel_id bigint not null, community_id bigint not null, user_id uuid, nick text not null default '', text text not null default '', reply_to bigint, reactions jsonb not null default '{}', edited_at timestamptz, deleted boolean not null default false, hidden boolean not null default false, created_at timestamptz not null default now(), pinned_at timestamptz, att jsonb);
-- как chat_guard на сервере: 'general' → null
create function public.chat_guard() returns trigger language plpgsql as $$ begin if new.channel = 'general' then new.channel := null; end if; return new; end $$;
create trigger chat_guard before insert on public.messages for each row execute function public.chat_guard();
-- cm_send — упрощённо (участник, длина), как в ч. 4: вставка + сообщение строкой
create function public.cm_send(p_channel bigint, p_text text, p_reply bigint default null) returns jsonb language plpgsql security definer as $$
declare ch record; v_row record;
begin
  select * into ch from public.community_channels where id = p_channel;
  if not exists (select 1 from public.community_members where community_id = ch.community_id and user_id = auth.uid()) then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  insert into public.community_messages (channel_id, community_id, user_id, nick, text, reply_to) values (p_channel, ch.community_id, auth.uid(), 'n', p_text, p_reply) returning * into v_row;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'msg', to_jsonb(v_row));
end $$;
alter table public.messages enable row level security; alter table public.community_messages enable row level security;
create policy m_read on public.messages for select using (public.chat_chan_age_ok(channel));
create policy m_ins on public.messages for insert with check (true); create policy m_upd on public.messages for update using (true);
create policy c_read on public.community_messages for select using (public.comm_is_member(community_id) and public.cm_chan_age_ok(channel_id));
grant select, insert, update on public.messages to app; grant select on public.community_messages to app; grant usage on schema public, auth to app;
grant select on cur to app; grant execute on all functions in schema auth to app;`);
await db.exec(sql); await db.exec(sql);
await db.exec(`grant execute on all functions in schema public to app; grant select on all tables in schema public to app; grant usage, select on all sequences in schema public to app;`);
const ADM = '11111111-1111-1111-1111-111111111111', KID = '22222222-2222-2222-2222-222222222222', T14 = '33333333-3333-3333-3333-333333333333', AD = '44444444-4444-4444-4444-444444444444', OWN = '55555555-5555-5555-5555-555555555555', U8 = '66666666-6666-6666-6666-666666666666', OUT = '77777777-7777-7777-7777-777777777777';
await db.exec(`insert into profiles values ('${ADM}','admin','адм'),('${KID}',null,'кид'),('${T14}',null,'т14'),('${AD}',null,'взр'),('${OWN}',null,'влад'),('${U8}',null,'малыш'),('${OUT}',null,'чужой');
insert into user_age values ('${KID}', extract(year from now())::int - 11), ('${T14}', extract(year from now())::int - 15), ('${AD}', extract(year from now())::int - 30), ('${OWN}', extract(year from now())::int - 20), ('${U8}', extract(year from now())::int - 7);
insert into communities values (7, 'клуб'); insert into community_members values (7, '${OWN}', 'owner', null), (7, '${KID}', 'member', null), (7, '${T14}', 'member', null), (7, '${AD}', 'member', null);
insert into community_channels(id, community_id, name, kind, min_age) values (70, 7, 'чат', 'text', 0), (71, 7, 'взрослые', 'text', 16), (72, 7, 'голос', 'voice', 0);
insert into comm_roles values (1, 7, 'игроки', 0), (2, 7, 'ведущие', 16); insert into comm_member_roles values (7, 1, '${KID}'), (7, 1, '${T14}'), (7, 2, '${AD}');
insert into comm_online values ('${T14}', now()), ('${KID}', now()), ('${OWN}', now() - interval '1 hour');`);
const as = async (u, r) => db.exec(`update cur set u = ${u ? `'${u}'` : 'null'}, r = '${r || (u ? 'authenticated' : 'anon')}'`);
const q = async s => (await db.query(s)).rows[0].r;
const one = async s => (await db.query(s)).rows[0];
let n = 0, bad = 0; const t = (c, m, x) => { n++; if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const asApp = async (u, s) => { await as(u); await db.exec('set role app'); try { return await db.query(s); } finally { await db.exec('reset role'); } };

t((await q(`select public.dsm_info() r`)).ok === true, 'dsm_info answers');
// ── 🧵 ветки: сервер сайта (браузер пишет строку сам) ──
let r = await asApp(AD, `insert into messages(user_id, nick, channel, text) values ('${AD}', 'взр', 'general', 'корень') returning id`); const ROOT = r.rows[0].id;
r = await asApp(T14, `insert into messages(user_id, nick, channel, text, thread_id, thread_n) values ('${T14}', 'т14', 'general', 'ответ в ветке', ${ROOT}, 999) returning thread_id, thread_n`);
t(+r.rows[0].thread_id === +ROOT && r.rows[0].thread_n === 0, 'site thread reply accepted, forged thread_n reset', r.rows[0]);
let root = await one(`select thread_n, thread_at from messages where id = ${ROOT}`);
t(root.thread_n === 1 && root.thread_at, 'root counter +1', root);
r = await asApp(T14, `insert into messages(user_id, nick, channel, text, thread_id) values ('${T14}', 'т14', 'memes', 'чужой канал', ${ROOT}) returning thread_id`);
t(r.rows[0].thread_id === null, 'thread_id from another channel dropped');
const R2 = (await asApp(T14, `insert into messages(user_id, nick, channel, text, thread_id) values ('${T14}', 'т14', null, 'ещё', ${ROOT}) returning id`)).rows[0].id;
r = await asApp(AD, `insert into messages(user_id, nick, text, thread_id) values ('${AD}', 'взр', 'ветка в ветке', ${R2}) returning thread_id`);
t(r.rows[0].thread_id === null, 'no thread inside a thread reply');
await asApp(KID, `update messages set thread_n = 500, thread_id = 1 where id = ${ROOT}`);
root = await one(`select thread_n, thread_id from messages where id = ${ROOT}`);
t(root.thread_n === 2 && root.thread_id === null, 'browser cannot forge thread counter / thread_id', root);
t(+(await one(`select count(*)::int c from notif where u = '${AD}' and title = 'новое в ветке'`)).c >= 1, 'root author notified about replies');
t(+(await one(`select count(*)::int c from dsm_follows where root_id = ${ROOT} and kind = 'o'`)).c === 2, 'root author + replier follow');
await asApp(T14, `update messages set deleted = true where id = ${R2}`);
t((await one(`select thread_n from messages where id = ${ROOT}`)).thread_n === 1, 'deleted reply → counter −1');
await as(T14); t((await q(`select public.dsm_follow('o', ${ROOT}, false) r`)).on === false, 'unfollow');
await db.exec(`delete from notif`);
await asApp(AD, `insert into messages(user_id, nick, text, thread_id) values ('${AD}', 'взр', 'снова', ${ROOT})`);
t(+(await one(`select count(*)::int c from notif where u = '${T14}'`)).c === 0, 'unfollowed user gets no thread ping');
await as(null); t((await q(`select public.dsm_follow('o', ${ROOT}, true) r`)).reason === 'auth', 'guest cannot follow');
// 13+ канал: ребёнок не подпишется на ветку, которую не видит
const RG = (await asApp(AD, `insert into messages(user_id, nick, channel, text) values ('${AD}', 'взр', 'games', 'игры') returning id`)).rows[0].id;
await as(KID); t((await q(`select public.dsm_follow('o', ${RG}, true) r`)).reason === 'not_found', 'kid cannot follow thread in 13+ channel');
// ── 🧵 ветки: сообщество (только через dsm_thread_send → cm_send) ──
await as(AD); const CROOT = (await q(`select public.cm_send(70, 'корень клуба') r`)).id;
await as(T14); r = await q(`select public.dsm_thread_send(${CROOT}, 'ответ клуба') r`);
t(r.ok && +r.msg.thread_id === +CROOT, 'community thread reply via dsm_thread_send', r);
t((await one(`select thread_n from community_messages where id = ${CROOT}`)).thread_n === 1, 'community root counter');
r = await q(`select public.cm_send(70, 'обычное') r`); t(r.ok && r.msg.thread_id === null, 'normal cm_send stays out of threads (GUC reset)', r);
await as(OUT); t((await q(`select public.dsm_thread_send(${CROOT}, 'чужак') r`)).reason === 'member', 'non-member cannot reply in community thread');
await as(T14); t((await q(`select public.dsm_thread_send(${r.id}, 'x') r`)).ok === true, 'any root works');
// ── 🕘 история правок ──
await asApp(AD, `update messages set text = 'корень v2', edited_at = now() where id = ${ROOT}`);
await asApp(AD, `update messages set text = 'корень v3', edited_at = now() where id = ${ROOT}`);
await as(AD); r = await q(`select public.dsm_edits_get('o', ${ROOT}) r`);
t(r.ok && r.now === 'корень v3' && r.list.length === 2 && r.list[0].text === 'корень v2' && r.list[1].text === 'корень', 'author sees previous versions', r);
await as(T14); t((await q(`select public.dsm_edits_get('o', ${ROOT}) r`)).reason === 'rights', 'other member cannot read edit history');
await as(ADM); t((await q(`select public.dsm_edits_get('o', ${ROOT}) r`)).ok === true, 'site staff reads edit history');
await db.exec(`update community_messages set text = 'клуб v2' where id = ${CROOT}`);
await as(OWN); t((await q(`select public.dsm_edits_get('c', ${CROOT}) r`)).list.length === 1, 'community owner (moderation) reads history');
await as(KID); t((await q(`select public.dsm_edits_get('c', ${CROOT}) r`)).reason === 'rights', 'community member cannot');
r = await asApp(KID, `select count(*)::int c from dsm_edits`); t(r.rows[0].c === 0, 'dsm_edits not readable directly');
// ── 📊 опросы ──
await as(T14);
r = await q(`select public.dsm_poll_create('o', null, 'general', 'Во что играем?', '["Кубомир", "Подземье", "  ", "Мир"]', 60, false) r`);
t(r.ok, 'poll created', r); const P1 = r.id;
t((await q(`select public.dsm_poll_create('o', null, 'general', 'q', '["один"]', 60, false) r`)).reason === 'options', 'poll needs 2+ options');
t((await q(`select public.dsm_poll_create('o', null, 'general', 'бля', '["a","b"]', 60, false) r`)).reason === 'bad', 'swearing refused');
t((await q(`select public.dsm_poll_create('o', null, 'general', 'q', '["https://x.y","b"]', 60, false) r`)).reason === 'link', 'links refused');
t((await q(`select public.dsm_poll_create('o', null, 'general', 'q', '["a","b"]', 1, false) r`)).reason === 'time', 'too short poll refused');
t((await q(`select public.dsm_poll_create('o', null, 'news', 'q', '["a","b"]', 60, false) r`)).reason === 'rights', 'mods-only channel refused');
await as(U8); t((await q(`select public.dsm_poll_create('o', null, 'general', 'q', '["a","b"]', 60, false) r`)).reason === 'rights', 'under 9 cannot create polls');
t((await q(`select public.dsm_poll_vote(${P1}, '{1}') r`)).ok === true, 'under 9 can vote (like a reaction)');
await as(KID); r = await q(`select public.dsm_poll_vote(${P1}, '{0}') r`);
t(r.ok && r.poll.counts[0] === 1 && r.poll.counts[1] === 1 && JSON.stringify(r.poll.my) === '[0]', 'vote counted', r.poll);
r = await q(`select public.dsm_poll_vote(${P1}, '{2}') r`); t(r.poll.counts[0] === 0 && r.poll.counts[2] === 1 && r.poll.voters === 2, 'change vote — still one vote per person', r.poll);
t((await q(`select public.dsm_poll_vote(${P1}, '{0,1}') r`)).reason === 'one', 'single-choice poll refuses two options');
t((await q(`select public.dsm_poll_vote(${P1}, '{9}') r`)).reason === 'options', 'bad option index');
t((await q(`select public.dsm_poll_end(${P1}) r`)).reason === 'rights', 'stranger cannot end poll');
await as(null); r = await q(`select public.dsm_poll_get(${P1}) r`); t(r.ok && r.poll.voters === 2 && r.poll.can_end === false, 'guest sees results'); t((await q(`select public.dsm_poll_vote(${P1}, '{0}') r`)).reason === 'auth', 'guest cannot vote');
await as(T14); t((await q(`select public.dsm_poll_end(${P1}) r`)).poll.closed === true, 'author ends poll');
await as(KID); t((await q(`select public.dsm_poll_vote(${P1}, '{0}') r`)).reason === 'closed', 'closed poll refuses votes');
await as(AD); r = await q(`select public.dsm_poll_create('o', null, 'games', 'q13', '["a","b"]', 60, true) r`); const P2 = r.id;
await as(KID); t((await q(`select public.dsm_poll_get(${P2}) r`)).reason === 'not_found', 'kid cannot see poll in 13+ channel');
await as(AD); t((await q(`select public.dsm_poll_vote(${P2}, '{0,1}') r`)).poll.voters === 1, 'multi-choice poll takes two options');
await as(OWN); r = await q(`select public.dsm_poll_create('c', 7, '71', 'клуб16', '["a","b"]', 60, false) r`); const P3 = r.id; t(r.ok, 'community poll');
await as(T14); t((await q(`select public.dsm_poll_get(${P3}) r`)).reason === 'not_found', '15-year-old cannot see poll in 16+ community channel');
await as(OUT); t((await q(`select public.dsm_poll_get(${P3}) r`)).reason === 'not_found', 'non-member cannot see community poll');
await as(OWN); t((await q(`select public.dsm_poll_create('c', 7, '72', 'q', '["a","b"]', 60, false) r`)).reason === 'rights', 'no polls in voice channels');
await as(T14); for (let i = 0; i < 5; i++) await q(`select public.dsm_poll_create('o', null, 'memes', 'q${i}', '["a","b"]', 60, false) r`);
t((await q(`select public.dsm_poll_create('o', null, 'memes', 'q6', '["a","b"]', 60, false) r`)).reason === 'rate', 'poll rate limit 5/hour');
r = await asApp(T14, `select count(*)::int c from dsm_poll_votes`); t(r.rows[0].c === 0, 'votes not readable directly (who voted is private)');
// ── 🗂 форумы ──
await as(T14); t((await q(`select public.dsm_forum_set(null, 'memes', true, '{"вопрос"}') r`)).reason === 'rights', 'member cannot make a forum');
await as(ADM); t((await q(`select public.dsm_forum_set(null, 'general', true, '{}') r`)).reason === 'last', '#общий cannot become a forum');
t((await q(`select public.dsm_forum_set(null, 'memes', true, '{"вопрос","идея","идея","бля"}') r`)).reason === 'tag', 'bad tag refused');
t((await q(`select public.dsm_forum_set(null, 'memes', true, '{"вопрос","идея","идея"}') r`)).ok === true, 'admin makes forum (dedup tags)');
t(JSON.stringify((await one(`select tags from dsm_forums where channel = 'memes'`)).tags) === '["вопрос","идея"]', 'tags stored once');
const PM = (await asApp(T14, `insert into messages(user_id, nick, channel, text) values ('${T14}', 'т14', 'memes', 'текст поста') returning id`)).rows[0].id;
await as(T14); t((await q(`select public.dsm_post_meta('o', ${PM}, 'Заголовок', '{"идея","левый"}') r`)).ok === true, 'author sets post title + tags');
t(JSON.stringify((await one(`select tags from dsm_posts where msg_id = ${PM}`)).tags) === '["идея"]', 'only forum tags kept');
await as(AD); t((await q(`select public.dsm_post_meta('o', ${PM}, 'Чужой', '{}') r`)).reason === 'not_found', 'other user cannot retitle');
await as(T14); t((await q(`select public.dsm_post_meta('o', ${ROOT}, 'x', '{}') r`)).reason === 'not_found', 'not own message refused');
r = await asApp(KID, `select title from dsm_posts`); t(r.rows.length === 1 && r.rows[0].title === 'Заголовок', 'post title readable when message is visible');
await asApp(T14, `update messages set deleted = true where id = ${PM}`);
r = await asApp(KID, `select title from dsm_posts`); t(r.rows.length === 0, 'deleted post title hidden');
await as(OWN); t((await q(`select public.dsm_forum_set(7, '70', true, '{"баг"}') r`)).ok === true, 'community owner makes forum');
r = await asApp(OUT, `select * from dsm_forums where kind = 'c'`); t(r.rows.length === 0, 'non-member does not see community forum settings');
await as(OWN); t((await q(`select public.dsm_forum_set(7, '70', false, null) r`)).ok === true, 'forum off');
// ── @here / @everyone / @роль ──
await db.exec(`delete from notif; update communities set everyone_at = null, role_ping_at = null`);
await as(KID); await q(`select public.cm_send(70, '@everyone смотрите') r`);
t(+(await one(`select count(*)::int c from notif`)).c === 0, 'kid without perm: no mass ping');
await as(AD); await q(`select public.cm_send(70, '@here кто тут?') r`);
let rows = (await db.query(`select u from notif where title like '@here%'`)).rows.map(x => x.u);
t(rows.includes(T14) && !rows.includes(KID) && !rows.includes(OWN), '@here → online only, no kids', rows);
await db.exec(`delete from notif; update communities set everyone_at = null`);
await as(AD); await q(`select public.cm_send(70, 'внимание @игроки') r`);
rows = (await db.query(`select u from notif where title like '@игроки%'`)).rows.map(x => x.u);
t(rows.includes(T14) && !rows.includes(KID), '@role → role members, kids skipped', rows);
await db.exec(`delete from notif`); await q(`select public.cm_send(70, 'ещё раз @игроки') r`);
t(+(await one(`select count(*)::int c from notif`)).c === 0, '@role rate limit 10 min');
// дети не шлют массовые упоминания даже с правом
await db.exec(`delete from notif; update communities set everyone_at = null, role_ping_at = null; insert into comm_member_roles values (7, 2, '${KID}')`);
await as(KID); await q(`select public.cm_send(70, '@everyone @игроки') r`);
t(+(await one(`select count(*)::int c from notif`)).c === 0, 'kid with @everyone right still cannot mass-ping');
console.log(bad ? `ds-msg SQL: ${bad}/${n} FAIL` : `ds-msg SQL OK (${n} checks, part applied twice)`);
process.exit(bad ? 1 : 0);
