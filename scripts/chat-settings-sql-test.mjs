// T-162 ⚙️ настройки «как в Дискорде»: community.sql ч. 10 (значок и возраст канала, правила / приветствие / канал по умолчанию,
// RLS «с N лет» на чтение, триггер на запись) на PGlite с заглушками живых таблиц и помощников; часть выполняется дважды.
// Запуск из корня сайта: node scripts/chat-settings-sql-test.mjs (PGLITE_PATH / DEPS_DIR)
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
  const msg = 'chat-settings-sql-test: PGlite не найден — SQL-проверки пропущены (PGLITE_PATH=… или DEPS_DIR=…)';
  if (process.env.CI_STRICT) { console.log('FAIL ' + msg); process.exit(1); }
  console.log('SKIP ' + msg);
  process.exit(0);
}

let sql = fs.readFileSync(path.join(SITE, 'community.sql'), 'utf8'); const k0 = sql.indexOf('-- ═══ 10. ⚙️'); sql = sql.slice(k0);
if (k0 < 0) { console.log('FAIL part 10 not found'); process.exit(1); }
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create role app; create schema auth;
create table cur(u uuid, r text); insert into cur values (null, 'anon');
create function auth.uid() returns uuid language sql as 'select u from cur';
create function auth.role() returns text language sql as 'select r from cur';
create table public.profiles(id uuid primary key, role text, nick text);
create table public.user_age(user_id uuid primary key, birth_year int);
create function public.age_year_now() returns int language sql as 'select extract(year from now())::int';
create function public.age_rank(g text) returns int language sql immutable as $$ select case g when 'child' then 0 when 'teen' then 1 when 'teen16' then 2 when 'adult' then 3 else 9 end $$;
create function public.age_group_of(p_uid uuid) returns text language sql stable as $$ select coalesce((select case when public.age_year_now() - birth_year - 1 < 13 then 'child' when public.age_year_now() - birth_year - 1 < 16 then 'teen' when public.age_year_now() - birth_year - 1 < 18 then 'teen16' else 'adult' end from public.user_age where user_id = p_uid and birth_year is not null), 'unknown') $$;
create function public.age_u9(p_uid uuid) returns boolean language sql stable as $$ select coalesce((select public.age_year_now() - birth_year - 1 < 9 from public.user_age where user_id = p_uid), false) $$;
create function public.chat_staff_role(p_uid uuid default auth.uid()) returns text language sql stable as $$ select role from public.profiles where id = p_uid and role in ('admin','moderator','helper') $$;
create function public.comm_is_staff(p_uid uuid default auth.uid()) returns boolean language sql stable as $$ select coalesce((select role in ('admin','moderator') from public.profiles where id = p_uid), false) $$;
create table public.communities(id bigint primary key, name text, status text default 'active', is_public boolean default true);
create table public.community_members(community_id bigint, user_id uuid, role text default 'member');
create function public.chan_can_manage(p_cid bigint, p_uid uuid) returns boolean language sql stable as $$ select p_uid is not null and case when p_cid is null then coalesce(public.chat_staff_role(p_uid), '') in ('admin','moderator') else public.comm_is_staff(p_uid) or exists (select 1 from public.community_members where community_id = p_cid and user_id = p_uid and role in ('owner','mod')) end $$;
create function public.comm_bad(p text) returns boolean language sql immutable as $$ select coalesce(p, '') ~* 'бля' $$;
create function public.comm_has_link(p text) returns boolean language sql immutable as $$ select coalesce(p, '') ~* '(https?:|www\\.|t\\.me/)' $$;
create table public.comm_modlog(community_id bigint, actor_id uuid, action text, detail text);
create function public.comm_log(p_cid bigint, p_actor uuid, p_target uuid, p_tnick text, p_action text, p_reason text, p_detail text, p_channel text) returns void language sql as $$ insert into public.comm_modlog values (p_cid, p_actor, p_action, p_detail) $$;
create table public.chat_channels(id text primary key, name text, kind text default 'text', archived boolean default false);
insert into public.chat_channels(id, name) values ('general','общий'),('news','новости'),('games','игры'),('memes','мемы');
create table public.chat_settings(id int primary key default 1); insert into public.chat_settings values (1);
create table public.community_channels(id bigint primary key, community_id bigint, name text, kind text default 'text', archived boolean default false);
create table public.messages(id bigint generated always as identity primary key, user_id uuid, channel text, text text);
create table public.community_messages(id bigint generated always as identity primary key, channel_id bigint, user_id uuid, text text);
alter table public.messages enable row level security; alter table public.community_messages enable row level security;
create policy m_read on public.messages for select using (true); create policy m_ins on public.messages for insert with check (true);
create policy c_read on public.community_messages for select using (true); create policy c_ins on public.community_messages for insert with check (true);
grant select, insert on public.messages, public.community_messages to app; grant usage on schema public, auth to app;
grant select on cur to app; grant execute on all functions in schema auth to app;`);
await db.exec(sql); await db.exec(sql);
await db.exec(`grant execute on all functions in schema public to app; grant select on all tables in schema public to app; grant usage, select on all sequences in schema public to app;`);
const ADM = '11111111-1111-1111-1111-111111111111', KID = '22222222-2222-2222-2222-222222222222', T14 = '33333333-3333-3333-3333-333333333333', AD = '44444444-4444-4444-4444-444444444444', OWN = '55555555-5555-5555-5555-555555555555';
await db.exec(`insert into profiles values ('${ADM}','admin','адм'),('${KID}',null,'кид'),('${T14}',null,'т14'),('${AD}',null,'взр'),('${OWN}',null,'влад');
insert into user_age values ('${KID}', extract(year from now())::int - 11), ('${T14}', extract(year from now())::int - 15), ('${AD}', extract(year from now())::int - 30), ('${OWN}', extract(year from now())::int - 12);
insert into communities values (7, 'клуб'); insert into community_members values (7, '${OWN}', 'owner'), (7, '${KID}', 'member'), (7, '${T14}', 'member');
insert into community_channels values (70, 7, 'чат'), (71, 7, 'взрослые');
insert into messages(user_id, channel, text) values ('${AD}', null, 'g'), ('${AD}', 'games', 'x'), ('${AD}', 'memes', 'm');
insert into community_messages(channel_id, user_id, text) values (70, '${AD}', 'a'), (71, '${AD}', 'b');`);
const as = async (u, r) => db.exec(`update cur set u = ${u ? `'${u}'` : 'null'}, r = '${r || (u ? 'authenticated' : 'anon')}'`);
const q = async s => (await db.query(s)).rows[0].r;
let n = 0, bad = 0; const t = (c, m, x) => { n++; if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
// права
await as(KID);
t((await q(`select public.cm_chan_extra(null, 'games', '🎮', 13) r`)).reason === 'rights', 'member cannot edit site channel');
t((await q(`select public.cm_server_set(null, 'x', 'y', null) r`)).reason === 'rights', 'member cannot edit site rules');
t((await q(`select public.cm_server_set(7, 'x', 'y', null) r`)).reason === 'rights', 'member cannot edit community rules');
await as(null);
t((await q(`select public.cm_chan_extra(null, 'games', '🎮', 13) r`)).reason === 'auth', 'guest refused');
await as(ADM);
t((await q(`select public.cm_chan_extra(null, 'games', '🎮', 13) r`)).ok === true, 'admin sets emoji + 13+');
t((await q(`select public.cm_chan_extra(null, 'memes', 'abc', 0) r`)).reason === 'emoji', 'letters in emoji refused');
t((await q(`select public.cm_chan_extra(null, 'memes', '<b>', 0) r`)).reason === 'emoji', 'markup in emoji refused');
t((await q(`select public.cm_chan_extra(null, 'memes', '😂', 18) r`)).reason === 'age', '18+ channel refused (kids site, no NSFW)');
t((await q(`select public.cm_chan_extra(null, 'general', '', 13) r`)).reason === 'last', '#общий stays for everyone');
t((await q(`select public.cm_chan_extra(null, 'news', '', 9) r`)).reason === 'last', 'news stays for everyone');
t((await q(`select public.cm_chan_extra(null, 'nope', '', 0) r`)).reason === 'not_found', 'unknown channel');
t((await q(`select public.cm_server_set(null, 'Без мата', 'Привет!', 'games') r`)).reason === 'channel', 'default channel must be open to all');
t((await q(`select public.cm_server_set(null, 'Будь добрым', 'Привет!', 'memes') r`)).ok === true, 'admin saves rules/welcome/default');
t((await q(`select public.cm_server_set(null, 'зайди на https://evil.example', '', null) r`)).reason === 'link', 'links in rules refused');
t((await q(`select public.cm_server_set(null, 'бля', '', null) r`)).reason === 'bad', 'swearing in rules refused');
t((await q(`select public.cm_server_set(null, repeat('a', 2001), '', null) r`)).reason === 'rules', 'rules length cap');
t((await q(`select public.cm_chan_extra(null, 'memes', '', 13) r`)).reason === 'last', 'default channel cannot get an age limit');
t((await db.query(`select count(*)::int n from comm_modlog where action in ('chan_edit','server_edit')`)).rows[0].n === 2, 'audit log rows written');
// чтение настроек
await as(KID);
let g = await q(`select public.cm_server_get(null) r`);
t(g.ok && g.rules === 'Будь добрым' && g.welcome === 'Привет!' && g.default_ch === 'memes' && g.manage === false, 'kid reads site settings', g);
t(g.chans.find(c => c.id === 'games').ok === false && g.chans.find(c => c.id === 'games').emoji === '🎮', 'kid: games 13+ not allowed', g.chans);
await as(T14); g = await q(`select public.cm_server_get(null) r`); t(g.chans.find(c => c.id === 'games').ok === true, '15-year-old: 13+ allowed');
// RLS чтение и триггер записи — от роли app (не владелец таблиц)
const asApp = async (u, s) => { await as(u); await db.exec('set role app'); try { return await db.query(s); } finally { await db.exec('reset role'); } };
let r = await asApp(KID, `select channel from messages order by id`); t(r.rows.length === 2 && !r.rows.some(x => x.channel === 'games'), 'kid cannot read 13+ channel', r.rows);
r = await asApp(null, `select channel from messages order by id`); t(r.rows.length === 2, 'guest cannot read 13+ channel');
r = await asApp(T14, `select channel from messages order by id`); t(r.rows.length === 3, '15-year-old reads 13+ channel');
r = await asApp(ADM, `select channel from messages order by id`); t(r.rows.length === 3, 'admin reads all');
let threw = ''; try { await asApp(KID, `insert into messages(user_id, channel, text) values ('${KID}', 'games', 'hi')`); } catch (e) { threw = e.message; }
t(/старше/.test(threw), 'kid cannot write into 13+ channel', threw);
threw = ''; try { await asApp(KID, `insert into messages(user_id, channel, text) values ('${KID}', 'memes', 'hi')`); } catch (e) { threw = e.message; }
t(!threw, 'kid writes into open channel', threw);
await as(null, 'service_role'); threw = ''; try { await db.exec(`insert into messages(user_id, channel, text) values (null, 'games', 'bot')`); } catch (e) { threw = e.message; } t(!threw, 'server (service_role) bypasses guard');
// сообщество: владелец 12 лет ставит 16+ и сам не запирается
await as(OWN);
t((await q(`select public.cm_chan_extra(7, '71', '🎬', 16) r`)).ok === true, 'owner sets 16+ on community channel');
t((await q(`select public.cm_chan_extra(8, '71', '', 0) r`)).reason === 'rights', 'other community refused');
t((await q(`select public.cm_server_set(7, 'Правила клуба', 'Добро пожаловать', '71') r`)).reason === 'channel', 'age-limited default refused');
t((await q(`select public.cm_server_set(7, 'Правила клуба', 'Добро пожаловать', '70') r`)).ok === true, 'owner saves community rules');
r = await asApp(OWN, `select channel_id from community_messages`); t(r.rows.length === 2, 'manager still reads own 16+ channel');
r = await asApp(T14, `select channel_id from community_messages`); t(r.rows.length === 1, '15-year-old cannot read 16+ channel');
g = await (async () => { await as(T14); return q(`select public.cm_server_get(7) r`); })();
t(g.ok && g.rules === 'Правила клуба' && String(g.default_ch) === '70' && g.chans.find(c => String(c.id) === '71').ok === false, 'member reads community settings', g);
await db.exec(`update communities set is_public = false`); await as(AD);
t((await q(`select public.cm_server_get(7) r`)).reason === 'private', 'private community hidden from non-members');
console.log(bad ? `chat-settings SQL: ${bad}/${n} FAIL` : `chat-settings SQL OK (${n} checks, part applied twice)`);
process.exit(bad ? 1 : 0);
