// T-164 ds-mod 🛡 центр модерации: community.sql ч. 11 на PGlite. Таблицы жалоб, журнала и общего чата — КОПИЯ определений из
// community.sql (как на живой базе), помощники ч. 1–10 — заглушки с тем же смыслом; часть выполняется дважды (идемпотентность).
// Проверяет: на себя и на создателя жаловаться нельзя (в т. ч. файл — из-за этого у владельца было «Жалобы — 0»), жалоба на команду —
// только создателю и не скрывает сообщение, статусы и «рассмотрено», снимок переписки, участники и заметки, бан ника, режим рейда,
// запрещённые слова и медленный режим новичкам (сервер), тайм-аут общего чата (chat_guard ч. 1), обзор и журнал, права.
// Запуск из корня сайта: node scripts/mod-sql-test.mjs (PGLITE_PATH / DEPS_DIR)
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
  const msg = 'mod-sql-test: PGlite не найден — SQL-проверки пропущены (PGLITE_PATH=… или DEPS_DIR=…)';
  if (process.env.CI_STRICT) { console.log('FAIL ' + msg); process.exit(1); }
  console.log('SKIP ' + msg);
  process.exit(0);
}

const ALL = fs.readFileSync(path.join(SITE, 'community.sql'), 'utf8');
const k0 = ALL.indexOf('-- ═══ часть 11 (ds-mod) ═══');
if (k0 < 0) { console.log('FAIL part 11 not found'); process.exit(1); }
const k1 = ALL.indexOf('\n-- ═══ часть 1', k0 + 10);   // следующая часть другой полосы (если допишут после)
const PART0 = ALL.slice(k0, k1 > 0 ? k1 : undefined);
const PART = process.env.MOD_DEBUG ? PART0.replace('exception when others then verdict := null;', '') : PART0;
// определения как на живой базе — берём из самого community.sql
const table = name => { const m = new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`).exec(ALL); if (!m) throw new Error('no table ' + name); return m[0]; };
const fn = name => { const i = ALL.indexOf(`create or replace function public.${name}`); const j = ALL.indexOf('end $$;', i); if (i < 0 || j < 0) throw new Error('no fn ' + name); return ALL.slice(i, j + 7); };
const after = (s, re) => { const m = re.exec(ALL); if (!m) throw new Error('no ' + re); return m[0]; };

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create table cur(u uuid, r text); insert into cur values (null, 'anon');
create function auth.uid() returns uuid language sql as 'select u from cur';
create function auth.role() returns text language sql as 'select r from cur';
create table public.profiles(id uuid primary key, role text, nick text, created_at timestamptz not null default now());
create function public.chat_staff_role(p_uid uuid default auth.uid()) returns text language sql stable as $$ select role from public.profiles where id = p_uid and role in ('admin','moderator','helper') $$;
create function public.comm_is_staff(p_uid uuid default auth.uid()) returns boolean language sql stable as $$ select coalesce((select role in ('admin','moderator') from public.profiles where id = p_uid), false) $$;
create table public.communities(id bigint primary key, name text, owner_id uuid, status text default 'active', is_public boolean default true, invite_code text default 'abc');
create table public.community_members(community_id bigint, user_id uuid, role text not null default 'member', muted_until timestamptz, joined_at timestamptz not null default now(), primary key (community_id, user_id));
create table public.community_bans(community_id bigint, user_id uuid, by_id uuid, reason text not null default '', until timestamptz, created_at timestamptz not null default now(), primary key (community_id, user_id));
create table public.community_channels(id bigint primary key, community_id bigint, name text, kind text default 'text');
create function public.comm_is_member(p_cid bigint) returns boolean language sql stable as $$ select exists (select 1 from public.community_members where community_id = p_cid and user_id = auth.uid()) $$;
create function public.comm_perm(p_cid bigint, p_uid uuid, p_bit int) returns boolean language sql stable as $$ select p_uid is not null and (public.comm_is_staff(p_uid) or coalesce((select role in ('owner','mod') from public.community_members where community_id = p_cid and user_id = p_uid), false)) $$;
create function public.comm_bad(p text) returns boolean language sql immutable as $$ select coalesce(p, '') ~* 'бля' $$;
create table public.notes(user_id uuid, kind text, title text, body text, dedupe text);
create function public.comm_notify(p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_link text, p_dedupe text) returns void language sql as $$ insert into public.notes select p_user, p_kind, p_title, p_body, p_dedupe where p_user is not null and p_user is distinct from p_actor and not exists (select 1 from public.notes where dedupe = p_dedupe and user_id = p_user) $$;
create function public.kidsafe_on() returns boolean language sql as 'select false';
create function public.age_u9(p_uid uuid) returns boolean language sql as 'select false';
create table public.messages(id bigint generated always as identity primary key, nick text, text text, color text, role text, user_id uuid, deleted boolean default false,
  created_at timestamptz not null default now(), channel text, reply_to bigint, edited_at timestamptz, is_sticker boolean default false, att jsonb);
create table public.community_messages(id bigint generated always as identity primary key, channel_id bigint not null, community_id bigint not null, user_id uuid, nick text not null default '',
  text text not null default '', reply_to bigint, reactions jsonb not null default '{}'::jsonb, edited_at timestamptz, deleted boolean not null default false, hidden boolean not null default false,
  created_at timestamptz not null default now(), att jsonb);
create table public.banned_nicks(nick text, banned_by uuid, created_at timestamptz default now());
create table public.file_block(phash text primary key, reason text, by_uid uuid, created_at timestamptz default now());
create table public.chat_channels(id text primary key, name text, kind text not null default 'text', position int default 0, slow_sec int not null default 0, mods_only boolean not null default false, about text default '');
insert into public.chat_channels(id, name) values ('general', 'общий'), ('games', 'игры');
grant usage on schema public, auth to anon, authenticated; grant select on cur to anon, authenticated; grant execute on all functions in schema auth to anon, authenticated;`);
// таблицы жалоб, тайм-аутов и журнала — как на сервере (из community.sql)
await db.exec([table('community_reports'), after('', /create unique index if not exists creport_once[^\n]*\n/), table('chat_reports'), after('', /create unique index if not exists chat_report_once[^\n]*\n/),
  table('file_reports').replace(/references public\.profiles\(id\) on delete set null/, ''), table('chat_mutes'), table('comm_modlog')].join('\n'));
await db.exec([fn('comm_can_see_log'), fn('comm_log').replace(/exception when others then null;/, 'exception when others then raise;'), fn('chat_guard'),
  'create trigger chat_guard before insert on public.messages for each row execute function public.chat_guard();'].join('\n'));
await db.exec(PART); await db.exec(PART);   // дважды — идемпотентность

const ADM = '11111111-1111-1111-1111-111111111111', MOD = '22222222-2222-2222-2222-222222222222', HLP = '33333333-3333-3333-3333-333333333333',
  U1 = '44444444-4444-4444-4444-444444444444', U2 = '55555555-5555-5555-5555-555555555555', U3 = '66666666-6666-6666-6666-666666666666',
  OWN = '77777777-7777-7777-7777-777777777777', NEW = '88888888-8888-8888-8888-888888888888', CMOD = '99999999-9999-9999-9999-999999999999';
const H = 'ab'.repeat(32), H2 = 'cd'.repeat(32);
await db.exec(`insert into profiles(id, role, nick, created_at) values ('${ADM}','admin','Денчик37', now() - interval '1 year'), ('${MOD}','moderator','модер', now() - interval '100 days'),
  ('${HLP}','helper','хелпер', now() - interval '50 days'), ('${U1}',null,'вася', now() - interval '30 days'), ('${U2}',null,'петя', now() - interval '30 days'),
  ('${U3}',null,'коля', now() - interval '30 days'), ('${OWN}',null,'владелец', now() - interval '30 days'), ('${NEW}',null,'новичок', now() - interval '1 hour'), ('${CMOD}',null,'кмодер', now() - interval '30 days');
insert into communities(id, name, owner_id) values (7, 'клуб', '${OWN}');
insert into community_members(community_id, user_id, role, joined_at) values (7,'${OWN}','owner', now() - interval '20 days'), (7,'${CMOD}','mod', now() - interval '20 days'),
  (7,'${U1}','member', now() - interval '20 days'), (7,'${U2}','member', now() - interval '20 days'), (7,'${U3}','member', now() - interval '20 days'), (7,'${NEW}','member', now());
insert into community_channels values (70, 7, 'чат');
insert into messages(nick, text, user_id, att) values ('вася','привет всем','${U1}',null), ('петя','как дела','${U2}',null), ('вася','плохое сообщение','${U1}',null),
  ('Денчик37','я создатель','${ADM}',null), ('модер','я модер','${MOD}',null), ('вася','файл','${U1}','{"phash":"${H}","name":"a.png","thumb":"x"}'),
  ('Денчик37','мой файл','${ADM}','{"phash":"${H2}","name":"b.png"}');
insert into community_messages(channel_id, community_id, user_id, nick, text) values (70,7,'${U1}','вася','раз'), (70,7,'${U1}','вася','спам спам'),
  (70,7,'${CMOD}','кмодер','я модер клуба'), (70,7,'${OWN}','владелец','я владелец клуба');`);
const as = async u => db.exec(`update cur set u = ${u ? `'${u}'` : 'null'}, r = '${u ? 'authenticated' : 'anon'}'`);
const q = async s => (await db.query(s)).rows[0]?.r;
const err = async s => { try { await db.query(s); return ''; } catch (e) { return e.message; } };
const errx = async s => { try { await db.exec(s); return ''; } catch (e) { return e.message; } };
let n = 0, bad = 0; const t = (c, m, x) => { n++; if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const ids = async (tbl, where) => (await db.query(`select id from ${tbl} where ${where} order by id`)).rows.map(r => +r.id);
const [c1, c2, c3, cAdm, cMod, cFile, cAdmFile] = await ids('messages', 'true');
const [m1, m2, mCmod, mOwn] = await ids('community_messages', 'true');

// ── 1. на себя и на создателя нельзя (общий чат, сообщество, файл) ──
await as(U1);
t((await q(`select public.chat_report(${c1}, 'тест') r`)).reason === 'self', 'chat: self report refused');
t((await q(`select public.cm_report(${m1}, 'тест', null) r`)).reason === 'self', 'cm: self report refused');
t((await q(`select public.file_report('chat', ${cFile}, '') r`)).reason === 'self', 'file: self report refused (the owner bug)');
t((await q(`select public.chat_report(${cAdm}, 'тест') r`)).reason === 'creator', 'chat: creator cannot be reported');
t((await q(`select public.file_report('chat', ${cAdmFile}, '') r`)).reason === 'creator', 'file: creator cannot be reported');
await as(ADM);
t((await q(`select public.file_report('chat', ${cAdmFile}, '') r`)).reason === 'self', 'creator: own file refused too');
t(+(await q(`select count(*) r from file_reports`)) === 0 && +(await q(`select count(*) r from chat_reports`)) === 0, 'nothing stored after refused reports');

// ── 2. обычная жалоба: снимок переписки, 🔔 команде, видна в общем списке ──
await as(U2);
let r = await q(`select public.chat_report(${c3}, 'Оскорбления') r`);
t(r.ok && !r.to_owner, 'chat report ok', r);
t((await q(`select public.chat_report(${c3}, 'Оскорбления') r`)).again === true, 'second report by same person — again');
const ctx = await q(`select ctx r from chat_reports where message_id = ${c3}`);
t(Array.isArray(ctx) && ctx.length === 3 && ctx[ctx.length - 1].text === 'плохое сообщение', 'context snapshot: previous messages + the message', ctx);
t(+(await q(`select count(*) r from notes where kind = 'cm_report' and user_id in ('${ADM}','${MOD}')`)) === 2, 'admin and moderator notified');
t(+(await q(`select count(*) r from notes where kind = 'cm_report' and user_id = '${U1}'`)) === 0, 'reported person not notified');
await as(MOD);
r = await q(`select public.mod_reports(null, 'here', 'open', null) r`);
t(r.ok && r.list.length === 1 && r.list[0].kind === 'chat' && r.list[0].state === 'new' && r.list[0].author === 'вася', 'moderator sees the site report', r);
await as(HLP);
t((await q(`select public.mod_reports(null, 'here', 'open', null) r`)).list.length === 1, 'helper sees site reports in the hub');
await as(U3);
t((await q(`select public.mod_reports(null, 'here', 'open', null) r`)).reason === 'rights', 'plain user: no access');
t((await q(`select public.mod_reports(7, 'here', 'open', null) r`)).reason === 'rights', 'plain member: no access to community reports');

// ── 3. жалоба на команду — только создателю, не скрывает, модератор её не видит ──
for (const u of [U1, U2, U3]) { await as(u); r = await q(`select public.chat_report(${cMod}, 'Другое') r`); t(r.ok && r.to_owner && !r.hidden, 'report about staff goes to owner, not hidden', r); }
t((await q(`select deleted r from messages where id = ${cMod}`)) === false, 'staff message not auto-hidden by 3 reports');
t(+(await q(`select count(*) r from notes where dedupe = 'chrep:${cMod}' and user_id = '${MOD}'`)) === 0, 'reported moderator not notified');
t(+(await q(`select count(*) r from notes where dedupe = 'chrep:${cMod}' and user_id = '${ADM}'`)) === 1, 'creator notified about staff report');
await as(MOD);
t(!(await q(`select public.mod_reports(null, 'here', 'open', null) r`)).list.some(x => +x.mid === cMod), 'moderator does not see report about himself');
t((await q(`select public.mod_reports(null, 'owner', 'open', null) r`)).reason === 'rights', 'owner scope — creator only');
t(!(await q(`select public.chat_reports_list() r`)).some(x => +x.mid === cMod), 'old list also hides staff report from moderator');
t(['self', 'rights'].includes((await q(`select public.mod_report_set('chat', ${cMod}, 'rejected', '', '') r`)).reason), 'moderator cannot close report about staff');
await as(ADM);
r = await q(`select public.mod_reports(null, 'owner', 'open', null) r`);
t(r.ok && r.list.length === 1 && +r.list[0].mid === cMod && r.list[0].to_owner, 'creator sees staff report in owner scope', r);
// сообщество: жалоба на модератора клуба — только создателю сайта
await as(U1);
r = await q(`select public.cm_report(${mCmod}, 'Другое', null) r`);
t(r.ok && r.to_owner, 'community: report about community mod → owner', r);
t((await q(`select public.cm_report(${mOwn}, 'Другое', null) r`)).to_owner === true, 'community: report about community owner → owner');
await as(OWN);
r = await q(`select public.mod_reports(7, 'here', 'open', null) r`);
t(r.ok && r.list.length === 0, 'community owner does not see reports about the team', r);
t((await q(`select public.cm_reports(7) r`)).length === 0, 'old cm_reports hides them too');

// ── 4. статусы: в работу → готово (удалить) → жалобщику 🔔, журнал ──
await as(U2); await q(`select public.cm_report(${m2}, 'Спам', null) r`);
await as(U3); await q(`select public.cm_report(${m2}, 'Спам', null) r`);
await as(CMOD);
r = await q(`select public.mod_reports(7, 'here', 'open', null) r`);
const cmItem = r.list.find(x => +x.mid === m2);
t(cmItem && +cmItem.n === 2 && cmItem.reasons === 'Спам', 'community mod sees grouped report', r);
t((await q(`select public.mod_report_set('cm', ${cmItem.key}, 'work', '', '') r`)).ok, 'take into work');
r = await q(`select public.mod_reports(7, 'here', 'work', null) r`);
t(r.list.length === 1 && r.list[0].by_nick === 'кмодер', 'work state shows who took it', r);
t((await q(`select public.mod_report_set('cm', ${cmItem.key}, 'done', 'delete', 'спам') r`)).n === 2, 'done + delete closes both reports');
t((await q(`select deleted r from community_messages where id = ${m2}`)) === true, 'message deleted');
t(+(await q(`select count(*) r from notes where kind = 'report_done' and user_id in ('${U2}','${U3}')`)) === 2, 'reporters get «рассмотрено»');
t(+(await q(`select count(*) r from comm_modlog where community_id = 7 and action = 'report_done' and actor_id = '${CMOD}'`)) === 1, 'audit log row');
t((await q(`select public.mod_report_set('cm', ${cmItem.key}, 'done', '', '') r`)).reason === 'closed', 'closed report cannot be closed twice');
t((await q(`select public.mod_reports(7, 'here', 'closed', null) r`)).list.some(x => +x.mid === m2 && x.state === 'done'), 'closed list has it');
// отклонить: скрытое жалобами возвращается
await db.exec(`update community_messages set hidden = true where id = ${m1}`);
await as(U2); await q(`select public.cm_report(${m1}, 'Другое', null) r`);
await as(CMOD);
const kr1 = (await q(`select public.mod_reports(7, 'here', 'new', null) r`)).list.find(x => +x.mid === m1).key;
t((await q(`select public.mod_report_set('cm', ${kr1}, 'rejected', '', 'нормально') r`)).ok, 'reject');
t((await q(`select hidden r from community_messages where id = ${m1}`)) === false, 'reject unhides the message');
t((await q(`select body r from notes where kind = 'report_done' and user_id = '${U2}' and dedupe like 'repdone:cm:${kr1}%'`)) || '', 'rejected notice text');
// общий чат: готово
await as(MOD);
t((await q(`select public.mod_report_set('chat', ${c3}, 'done', 'delete', '') r`)).ok, 'site chat report done');
t((await q(`select deleted r from messages where id = ${c3}`)) === true, 'site message deleted');
t((await q(`select state r from chat_reports where message_id = ${c3}`)) === 'done' && (await q(`select status r from chat_reports where message_id = ${c3}`)) === 'done', 'state and legacy status in sync');
// старая кнопка «Оставить» (status = done) — триггер ставит статус и кто
await as(U3); await q(`select public.chat_report(${c2}, 'Спам') r`);
await as(MOD); await db.exec(`update chat_reports set status = 'done' where message_id = ${c2}`);
t((await q(`select state r from chat_reports where message_id = ${c2}`)) === 'done' && (await q(`select handled_by r from chat_reports where message_id = ${c2}`)) === MOD, 'legacy resolve stamps state + handler');

// ── 5. файлы: в общем списке, «запретить» — только admin / moderator ──
await as(U2);
t((await q(`select public.file_report('chat', ${cFile}, 'плохой файл') r`)).ok, 'file report about someone else ok');
await as(HLP);
r = await q(`select public.mod_reports(null, 'here', 'open', 'file') r`);
const fItem = r.list.find(x => x.kind === 'file');
t(fItem && fItem.att.name === 'a.png' && !fItem.att.thumb && fItem.author === 'вася', 'file report in the hub list (no thumb kept)', r);
t((await q(`select public.mod_report_set('file', ${fItem.key}, 'done', 'block', '') r`)).reason === 'rights', 'helper cannot block files');
await as(MOD);
t((await q(`select public.mod_report_set('file', ${fItem.key}, 'done', 'block', '') r`)).ok, 'moderator blocks file');
t(+(await q(`select count(*) r from file_block where phash = '${H}'`)) === 1 && (await q(`select status r from file_reports where mid = ${cFile}`)) === 'blocked', 'file blocked + legacy status');

// ── 6. участники, заметки, бан ника ──
await as(MOD);
r = await q(`select public.mod_members(null, 'пе', 'all') r`);
t(r.ok && r.list.length === 1 && r.list[0].nick === 'петя' && !('birth_year' in r.list[0]), 'site member search by nick prefix', r);
t((await q(`select public.mod_members(null, '', 'staff') r`)).list.length === 3, 'site staff list');
t((await q(`select public.mod_members(null, '', 'all') r`)).list.length >= 3, 'recent chat authors without query');
await as(CMOD);
await db.exec(`update community_members set muted_until = now() + interval '1 hour' where community_id = 7 and user_id = '${U3}'`);
t((await q(`select public.mod_members(7, '', 'muted') r`)).list.map(x => x.nick).join() === 'коля', 'community muted filter');
t((await q(`select public.mod_members(7, 'вас', 'all') r`)).list.length === 1, 'community search');
t((await q(`select public.mod_note_add(7, '${U1}', 'спамит в лс') r`)).ok, 'note added');
t((await q(`select public.mod_note_add(7, '${CMOD}', 'сам') r`)).reason === 'self', 'no notes about yourself');
r = await q(`select public.mod_member(7, '${U1}') r`);
t(r.ok && r.notes.length === 1 && r.notes[0].text === 'спамит в лс' && r.notes[0].mine, 'member card: notes', r);
t(+(await q(`select (public.mod_members(7, 'вас', 'all')->'list'->0->>'notes')::int r`)) === 1, 'notes counter in list');
await as(U1);
t((await q(`select public.mod_member(7, '${U1}') r`)).reason === 'rights', 'a person never sees notes about himself');
await as(MOD);
t((await q(`select public.mod_site_ban('${ADM}', true, '') r`)).reason === 'creator', 'nobody bans the creator');
t((await q(`select public.mod_site_ban('${HLP}', true, '') r`)).reason === 'rights', 'moderator cannot ban staff');
t((await q(`select public.mod_site_ban('${U1}', true, 'спам') r`)).ok && +(await q(`select count(*) r from banned_nicks where nick = 'вася'`)) === 1, 'site ban by nick');
t((await q(`select public.mod_members(null, '', 'banned') r`)).list[0].nick === 'вася', 'banned filter');
t((await q(`select public.mod_site_ban('${U1}', false, '') r`)).ok && +(await q(`select count(*) r from banned_nicks`)) === 0, 'unban');
await as(HLP);
t((await q(`select public.mod_site_ban('${U2}', true, '') r`)).reason === 'staff', 'helper cannot ban nicks');

// ── 7. тайм-аут общего чата держит сервер (chat_guard ч. 1) ──
await db.exec(`insert into chat_mutes(user_id, nick, until, by_id, reason) values ('${U2}', 'петя', now() + interval '30 minutes', '${MOD}', 'флуд')`);
await as(U2);
t(/заглушили/.test(await err(`insert into messages(nick, text, user_id) values ('петя', 'хочу писать', '${U2}')`)), 'muted user cannot post (server)');
r = await q(`select public.mod_overview(null) r`);
t(r.reason === 'rights', 'overview: team only');

// ── 8. автомодерация сервера: запрещённые слова, режим рейда, медленный режим новичкам ──
await as(HLP);
t((await q(`select public.mod_cfg_set(null, '{"words":["казино"],"newslow":30}') r`)).reason === 'rights', 'helper cannot change automod config');
await as(MOD);
r = await q(`select public.mod_cfg_set(null, '{"words":["Казино","  x ","казино","ставки"],"newslow":30}') r`);
t(r.ok && r.cfg.words.length === 2 && r.cfg.newslow === 30, 'cfg sanitized (lowercase, unique, 2+ chars)', r);
t((await q(`select public.mod_cfg_set(null, '{"newslow":7}') r`)).reason === 'slow', 'only allowed slow values');
await db.exec(`update cur set u = '${U3}', r = 'authenticated'`);
t(/запрещено/.test(await err(`insert into messages(nick, text, user_id) values ('коля', 'го в КАЗИНО', '${U3}')`)), 'banned word blocked by server');
t((await err(`insert into messages(nick, text, user_id) values ('коля', 'обычный текст', '${U3}')`)) === '', 'normal message passes');
await as(NEW);
t((await err(`insert into messages(nick, text, user_id) values ('новичок', 'первое', '${NEW}')`)) === '', 'new account: first message ok');
t(/Новичкам/.test(await err(`insert into messages(nick, text, user_id) values ('новичок', 'второе', '${NEW}')`)), 'new account: slow mode');
await as(MOD);
t((await err(`insert into messages(nick, text, user_id) values ('модер', 'казино — нельзя', '${MOD}')`)) === '', 'staff not touched by automod');
await as(HLP);
r = await q(`select public.mod_raid(null, 30) r`);
t(r.ok && r.until, 'helper can switch raid mode on', r);
await as(NEW);
t(/рейда/.test(await err(`insert into messages(nick, text, user_id) values ('новичок', 'привет', '${NEW}')`)), 'raid mode: new account read-only');
await as(U3);
t((await err(`insert into messages(nick, text, user_id) values ('коля', 'я давно тут', '${U3}')`)) === '', 'raid mode: old account can post');
await as(null);
t(/рейда/.test(await err(`insert into messages(nick, text, user_id) values ('гость', 'привет', null)`)), 'raid mode: guest read-only');
// сообщество: новичок клуба в рейд
await as(CMOD); await q(`select public.mod_raid(7, 15) r`); await q(`select public.mod_cfg_set(7, '{"words":["рекламa"]}') r`);
await as(NEW);
t(/рейда/.test(await err(`insert into community_messages(channel_id, community_id, user_id, nick, text) values (70, 7, '${NEW}', 'новичок', 'всем привет')`)), 'community raid: new member blocked');
await as(U1);
t((await err(`insert into community_messages(channel_id, community_id, user_id, nick, text) values (70, 7, '${U1}', 'вася', 'ок')`)) === '', 'community: old member posts');
await as(CMOD);
t((await q(`select public.mod_raid(7, 0) r`)).ok, 'raid off');
await as(NEW);
t((await err(`insert into community_messages(channel_id, community_id, user_id, nick, text) values (70, 7, '${NEW}', 'новичок', 'теперь можно')`)) === '', 'after raid off new member posts');

// ── 9. обзор и журнал ──
await as(MOD);
r = await q(`select public.mod_overview(null) r`);
t(r.ok && r.raid_until && +r.muted === 1 && r.owner === null && Array.isArray(r.log) && r.log.length > 0, 'overview (site, moderator)', r);
await as(ADM);
r = await q(`select public.mod_overview(null) r`);
t(+r.owner >= 1, 'overview shows creator the staff reports', r);
await as(MOD);
r = await q(`select public.mod_log(null, 'report', '', null) r`);
t(r.ok && r.list.length >= 1 && r.list.every(x => x.action.startsWith('report_')), 'log filter: reports', r);
r = await q(`select public.mod_log(null, 'settings', '', null) r`);
t(r.list.some(x => x.action === 'raid_on') && r.list.some(x => x.action === 'modcfg'), 'log filter: settings (raid, cfg)', r);
t((await q(`select public.mod_log(null, 'all', 'хелп', null) r`)).list.every(x => /хелп/.test(x.actor_nick + x.target_nick)), 'log search by nick');
await as(HLP);
t((await q(`select public.mod_log(null, 'all', '', null) r`)).reason === 'rights', 'helper: no audit log (as before)');

// ── 10. права на функции ──
t(/permission denied/.test(await errx(`set role anon; select public.mod_reports(null, 'here', 'open', null)`)), 'anon cannot call mod_reports');
await db.exec('reset role');
t(/permission denied/.test(await errx(`set role authenticated; select public.mod_ctx_chat(1)`)), 'helpers not callable from outside');
await db.exec('reset role');

console.log(bad ? `mod-sql-test: ${bad} of ${n} FAILED` : `mod-sql-test: ${n} ok`);
process.exit(bad ? 1 : 0);
