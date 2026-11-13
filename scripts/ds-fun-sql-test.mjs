// T-164 ds-fun: community.sql ч. 14 (свои эмодзи / стикеры / звуки с проверкой, звуковая панель, сцена, «с чего начать», метки,
// уровни) на PGlite с заглушками живых таблиц и помощников; часть выполняется дважды (идемпотентность).
// Запуск из корня сайта: node scripts/ds-fun-sql-test.mjs (PGLITE_PATH / DEPS_DIR)
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
  const msg = 'ds-fun-sql-test: PGlite не найден — SQL-проверки пропущены (PGLITE_PATH=… или DEPS_DIR=…)';
  if (process.env.CI_STRICT) { console.log('FAIL ' + msg); process.exit(1); }
  console.log('SKIP ' + msg);
  process.exit(0);
}

let sql = fs.readFileSync(path.join(SITE, 'community.sql'), 'utf8'); const k0 = sql.indexOf('-- ═══ часть 14 (ds-fun)');
if (k0 < 0) { console.log('FAIL part 14 not found'); process.exit(1); }
sql = sql.slice(k0); const k1 = sql.indexOf('\n-- ═══ часть 1', 10); if (k1 > 0) sql = sql.slice(0, k1);   // только своя часть
const db = new PGlite();
// заглушки — те же столбцы, что на живой базе (community.sql ч. 1, 5, 8, 10; profiles; messages)
await db.exec(`create role anon; create role authenticated; create schema auth;
create table cur(u uuid); insert into cur values (null);
create function auth.uid() returns uuid language sql as 'select u from cur';
create table public.profiles(id uuid primary key, role text, nick text);
create function public.chat_staff_role(p_uid uuid default auth.uid()) returns text language sql stable as $$ select role from public.profiles where id = p_uid and role in ('admin','moderator','helper') $$;
create function public.comm_is_staff(p_uid uuid default auth.uid()) returns boolean language sql stable as $$ select coalesce((select role in ('admin','moderator') from public.profiles where id = p_uid), false) $$;
create table public.communities(id bigint primary key, name text, owner_id uuid, status text default 'active', is_public boolean default true, members int default 0);
create table public.community_members(community_id bigint, user_id uuid, role text default 'member', muted_until timestamptz, joined_at timestamptz default now(), primary key (community_id, user_id));
create function public.chan_can_manage(p_cid bigint, p_uid uuid) returns boolean language sql stable as $$ select p_uid is not null and case when p_cid is null then coalesce(public.chat_staff_role(p_uid), '') in ('admin','moderator') else public.comm_is_staff(p_uid) or exists (select 1 from public.community_members where community_id = p_cid and user_id = p_uid and role in ('owner','mod')) end $$;
create function public.comm_bad(p text) returns boolean language sql immutable as $$ select coalesce(p, '') ~* 'бля|fuck' $$;
create table public.comm_modlog(community_id bigint, actor_id uuid, target_id uuid, action text, reason text, detail text);
create function public.comm_log(p_cid bigint, p_actor uuid, p_target uuid, p_tnick text, p_action text, p_reason text, p_detail text, p_channel text) returns void language sql as $$ insert into public.comm_modlog values (p_cid, p_actor, p_target, p_action, p_reason, p_detail) $$;
create table public.chat_channels(id text primary key, name text, kind text default 'text', archived boolean default false);
insert into public.chat_channels(id, name, kind) values ('general','общий','text'),('games','игры','text'),('voice','голос','voice'),('old','старый','text');
update public.chat_channels set archived = true where id = 'old';
create table public.community_channels(id bigint primary key, community_id bigint, name text, kind text default 'text', archived boolean default false);
create table public.messages(id bigint generated always as identity primary key, user_id uuid, channel text, text text);
create table public.community_messages(id bigint generated always as identity primary key, channel_id bigint, community_id bigint, user_id uuid, text text);`);
await db.exec(sql); await db.exec(sql);
const ADM = '11111111-1111-1111-1111-111111111111', KID = '22222222-2222-2222-2222-222222222222', OWN = '33333333-3333-3333-3333-333333333333', AD = '44444444-4444-4444-4444-444444444444', OUT = '55555555-5555-5555-5555-555555555555';
await db.exec(`insert into profiles values ('${ADM}','admin','адм'),('${KID}',null,'кид'),('${OWN}',null,'влад'),('${AD}',null,'взр'),('${OUT}',null,'чужой');
insert into communities(id, name, owner_id) values (7, 'клуб', '${OWN}'), (8, 'закрытый', '${AD}');
update communities set is_public = false where id = 8;
insert into community_members(community_id, user_id, role, joined_at) values (7, '${OWN}', 'owner', now() - interval '400 days'), (7, '${KID}', 'member', now() - interval '3 days'), (8, '${AD}', 'owner', now());
insert into community_channels values (70, 7, 'чат', 'text', false), (71, 7, 'голос', 'voice', false), (72, 7, 'архив', 'text', true), (80, 8, 'тайный', 'text', false);`);
const as = async u => db.exec(`update cur set u = ${u ? `'${u}'` : 'null'}`);
const q = async s => (await db.query(s)).rows[0].r;
let n = 0, bad = 0; const t = (c, m, x) => { n++; if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SND = 'data:audio/ogg;base64,T2dnUwACAAAAAAAAAAA=';
const add = (c, k, nm, d, dur = 0) => q(`select public.cf_media_add(${c}, '${k}', '${nm}', '${d}', ${dur}) r`);

// ── загрузка: права, проверки содержимого
await as(null); t((await add(7, 'emoji', 'pog', PNG)).reason === 'auth', 'guest cannot upload');
await as(KID); t((await add(7, 'emoji', 'pog', PNG)).reason === 'rights', 'plain member cannot upload');
await as(OUT); t((await add(7, 'emoji', 'pog', PNG)).reason === 'rights', 'outsider cannot upload');
await as(OWN);
t((await add(7, 'emoji', 'Pog!', PNG)).reason === 'name', 'bad name refused');
t((await add(7, 'emoji', 'ce_1', PNG)).reason === 'name', 'reserved ce_/stk_ prefix refused');
t((await add(7, 'emoji', 'fuck', PNG)).reason === 'bad', 'swear name refused');
t((await add(7, 'emoji', 'svg', 'data:image/svg+xml;base64,PHN2Zz4=')).reason === 'type', 'svg refused (script inside)');
t((await add(7, 'emoji', 'js', 'javascript:alert(1)')).reason === 'type', 'javascript: refused');
t((await add(7, 'emoji', 'quote', 'data:image/png;base64,AA"onerror="x')).reason === 'type', 'quote injection refused');
t((await add(7, 'emoji', 'huge', 'data:image/png;base64,' + 'A'.repeat(7000))).reason === 'size', 'emoji size cap 6000');
t((await add(7, 'sound', 'long', SND, 9000)).reason === 'dur', 'sound over 5 s refused');
t((await add(7, 'sound', 'img', PNG, 1000)).reason === 'type', 'image as sound refused');
let r = await add(7, 'emoji', 'pog', PNG); t(r.ok && r.status === 'pending', 'community emoji waits for review (kids audience)', r);
const POG = r.id;
t((await add(7, 'emoji', 'pog', PNG)).reason === 'taken', 'same name taken');
r = await add(7, 'sticker', 'wow', PNG); t(r.ok && r.status === 'pending', 'sticker pending'); const WOW = r.id;
r = await add(7, 'sound', 'boom', SND, 1200); t(r.ok && r.status === 'pending', 'sound pending'); const BOOM = r.id;
await as(ADM); r = await add(null, 'emoji', 'denchik', PNG); t(r.ok && r.status === 'ok', 'site staff upload to site server goes live'); const DEN = r.id;
await as(KID); t((await add(null, 'emoji', 'mine', PNG)).reason === 'rights', 'member cannot upload to site server');

// ── не проверенное никто не видит, кроме управляющих
await as(KID);
r = await q(`select public.cf_media_list(7) r`); t(r.ok && r.manage === false && r.list.length === 0, 'member sees no pending media', r);
r = await q(`select public.cf_media_get(array[${POG}, ${WOW}, ${DEN}]::bigint[]) r`); t(r.length === 1 && r[0].id === DEN, 'cf_media_get returns only reviewed', r);
await as(OWN); r = await q(`select public.cf_media_list(7) r`); t(r.manage === true && r.list.length === 3 && r.list.every(x => x.status === 'pending'), 'manager sees own pending list', r);
t(r.list.find(x => x.kind === 'emoji').data === PNG && r.list.find(x => x.kind === 'sticker').data == null, 'list carries image only for emoji');

// ── очередь проверки — только команда сайта
await as(OWN); t((await q(`select public.cf_media_queue() r`)).reason === 'rights', 'community owner has no review queue');
t((await q(`select public.cf_media_review(${POG}, true, '') r`)).reason === 'rights', 'community owner cannot approve own upload');
await as(ADM);
r = await q(`select public.cf_media_queue() r`); t(r.ok && r.list.length === 3 && r.list[0].cname === 'клуб', 'staff sees queue with server name', r);
t((await q(`select public.cf_media_review(${POG}, true, '') r`)).ok, 'staff approves emoji');
t((await q(`select public.cf_media_review(${BOOM}, true, '') r`)).ok, 'staff approves sound');
t((await q(`select public.cf_media_review(${WOW}, false, 'чужое лицо') r`)).ok, 'staff rejects sticker with reason');
t((await q(`select public.cf_media_review(${WOW}, true, '') r`)).reason === 'not_found', 'reviewed item cannot be re-reviewed');
await as(KID); r = await q(`select public.cf_media_list(7) r`); t(r.list.length === 2 && !r.list.some(x => x.status !== 'ok'), 'member sees approved only', r);
await as(OWN); r = await q(`select public.cf_media_list(7) r`); t(r.list.find(x => x.name === 'wow')?.note === 'чужое лицо', 'manager sees reject reason');
await as(OWN); r = await add(7, 'sticker', 'wow', PNG); t(r.ok, 'rejected name can be reused');
t((await db.query(`select count(*)::int n from comm_modlog where action in ('media_add','media_ok','media_no')`)).rows[0].n >= 7, 'audit log rows written');

// ── закрытое сообщество не видно чужим
await as(OUT); t((await q(`select public.cf_media_list(8) r`)).reason === 'not_found', 'private community media hidden');
t((await q(`select public.cf_server_get(8) r`)).reason === 'not_found', 'private community settings hidden');

// ── звуковая панель: сервер решает, раз в 4 с
await as(OUT); t((await q(`select public.cf_sound_play(7, ${BOOM}) r`)).reason === 'member', 'non-member cannot play');
await as(KID); t((await q(`select public.cf_sound_play(7, ${POG}) r`)).reason === 'not_found', 'emoji is not a sound');
t((await q(`select public.cf_sound_play(null, ${BOOM}) r`)).reason === 'not_found', 'sound of another server refused');
t((await q(`select public.cf_sound_play(7, ${BOOM}) r`)).ok, 'member plays sound');
r = await q(`select public.cf_sound_play(7, ${BOOM}) r`); t(r.reason === 'wait' && r.wait >= 1, 'cooldown enforced by server', r);
await db.exec(`update comm_sb_last set at = now() - interval '5 seconds'`);
await db.exec(`update community_members set muted_until = now() + interval '1 hour' where user_id = '${KID}'`);
t((await q(`select public.cf_sound_play(7, ${BOOM}) r`)).reason === 'muted', 'muted member cannot play');
await db.exec(`update community_members set muted_until = null where user_id = '${KID}'`);

// ── настройки: с чего начать, метки, сцена, уровни
await as(KID); t((await q(`select public.cf_server_set(7, array['70'], '{}', true, '{}') r`)).reason === 'rights', 'member cannot edit fun settings');
await as(OWN);
t((await q(`select public.cf_server_set(7, array['72'], '{}', true, '{}') r`)).reason === 'channel', 'archived channel refused as start');
t((await q(`select public.cf_server_set(7, array['80'], '{}', true, '{}') r`)).reason === 'channel', 'channel of another community refused');
t((await q(`select public.cf_server_set(7, array['70'], '{}', true, array['70']) r`)).reason === 'channel', 'text channel cannot be a stage');
t((await q(`select public.cf_server_set(7, array['70'], array['<b>x</b>'], true, '{}') r`)).reason === 'tag', 'markup tag refused');
t((await q(`select public.cf_server_set(7, array['70'], array['бля'], true, '{}') r`)).reason === 'tag', 'swear tag refused');
t((await q(`select public.cf_server_set(7, array['70','70'], array['Майнкрафт', 'стримы', 'майнкрафт'], true, array['71']) r`)).ok, 'owner saves settings');
r = await q(`select public.cf_server_get(7) r`);
t(JSON.stringify(r.start_chs) === '["70"]' && JSON.stringify(r.tags) === '["майнкрафт","стримы"]' && JSON.stringify(r.stage_chs) === '["71"]' && r.manage, 'settings read back (dedup, lower-case)', r);
t(r.me.since && Date.now() - Date.parse(r.me.since) > 399 * 864e5, 'since = joined_at (anniversary badge)', r.me);
await as(ADM); t((await q(`select public.cf_server_set(null, array['general','old'], array['x'], true, array['voice']) r`)).reason === 'channel', 'archived site channel refused');
t((await q(`select public.cf_server_set(null, array['general'], array['x'], true, array['voice']) r`)).ok, 'site staff saves site settings');
await as(null); r = await q(`select public.cf_server_get(null) r`); t(r.ok && r.me === null && JSON.stringify(r.tags) === '[]', 'guest reads site settings; site server has no tags', r);
r = await q(`select public.cf_tags(array[7, 8]::bigint[]) r`); t(r.length === 1 && r[0].id === 7, 'discovery tags: public only', r);

// ── сцена
await as(KID); t((await q(`select public.cf_stage_speaker(7, '71', '${KID}', true) r`)).reason === 'rights', 'member cannot grant the floor');
r = await q(`select public.cf_stage_get(7, '71') r`); t(r.stage === true && r.manage === false && r.speakers.length === 0, 'member sees stage', r);
t((await q(`select public.cf_stage_get(7, '70') r`)).stage === false, 'non-stage channel');
await as(OWN);
t((await q(`select public.cf_stage_speaker(7, '70', '${KID}', true) r`)).reason === 'not_stage', 'speaker only on stage channels');
t((await q(`select public.cf_stage_speaker(7, '71', '${KID}', true) r`)).ok, 'owner gives the floor');
t((await q(`select public.cf_stage_speaker(7, '71', '${KID}', true) r`)).speakers.length === 1, 'no duplicates');
t((await q(`select public.cf_stage_speaker(7, '71', '${KID}', false) r`)).speakers.length === 0, 'owner takes the floor back');

// ── уровни: +1 за сообщение, не чаще раза в минуту; выключатель
await db.exec(`insert into community_messages(channel_id, community_id, user_id, text) values (70, 7, '${KID}', 'a'), (70, 7, '${KID}', 'b')`);
r = (await db.query(`select xp from comm_xp where skey = '7' and user_id = '${KID}'`)).rows[0]; t(r?.xp === 1, 'one xp per minute', r);
await db.exec(`update comm_xp set last_at = now() - interval '2 minutes'`);
await db.exec(`insert into community_messages(channel_id, community_id, user_id, text) values (70, 7, '${KID}', 'c')`);
t((await db.query(`select xp from comm_xp where skey = '7' and user_id = '${KID}'`)).rows[0].xp === 2, 'xp after a minute');
await db.exec(`insert into messages(user_id, channel, text) values ('${AD}', 'general', 'hi'), (null, 'general', 'bot')`);
t((await db.query(`select count(*)::int n from comm_xp where skey = 'o'`)).rows[0].n === 1, 'site chat xp; bots skipped');
await db.exec(`update comm_xp set xp = 125 where skey = '7' and user_id = '${KID}'`);
await as(KID); r = await q(`select public.cf_server_get(7) r`); t(r.me.level === 5 && r.me.next === 180, 'level = floor(sqrt(xp/5))', r.me);
r = await q(`select public.cf_levels_top(7) r`); t(r.ok && r.list[0].nick === 'кид' && r.list[0].level === 5, 'levels top', r);
await as(OWN); await q(`select public.cf_server_set(7, array['70'], '{}', false, array['71']) r`);
await db.exec(`update comm_xp set last_at = now() - interval '2 minutes'`);
await db.exec(`insert into community_messages(channel_id, community_id, user_id, text) values (70, 7, '${KID}', 'd')`);
t((await db.query(`select xp from comm_xp where skey = '7' and user_id = '${KID}'`)).rows[0].xp === 125, 'levels off — no xp');
t((await q(`select public.cf_levels_top(7) r`)).off === true, 'levels off — empty top');
// триггер не ломает отправку, даже если таблица уровней сломана
await db.exec(`alter table comm_xp rename to comm_xp_x`); let threw = '';
try { await db.exec(`insert into messages(user_id, channel, text) values ('${AD}', 'general', 'still works')`); } catch (e) { threw = e.message; }
t(!threw, 'broken xp never blocks a message', threw); await db.exec(`alter table comm_xp_x rename to comm_xp`);

// ── удаление
await as(KID); t((await q(`select public.cf_media_del(${POG}) r`)).reason === 'rights', 'member cannot delete');
await as(OWN); t((await q(`select public.cf_media_del(${POG}) r`)).ok, 'manager deletes');
await as(OWN); t((await q(`select public.cf_media_del(${DEN}) r`)).reason === 'rights', 'community owner cannot delete site emoji');
// ── лимит загрузок в день
await as(OWN); for (let i = 0; i < 20; i++) await add(7, 'emoji', 'e' + i, PNG);
t((await add(7, 'emoji', 'last', PNG)).reason === 'rate', '20 uploads per day cap');
// ── гость не может вызывать служебные функции
const g = await db.query(`select has_function_privilege('anon', 'public.cf_media_add(bigint, text, text, text, int)', 'execute') a, has_function_privilege('anon', 'public.cf_media_review(bigint, boolean, text)', 'execute') b, has_function_privilege('authenticated', 'public.cf_xp_hook()', 'execute') c, has_function_privilege('anon', 'public.cf_media_list(bigint)', 'execute') d`);
t(!g.rows[0].a && !g.rows[0].b && !g.rows[0].c && g.rows[0].d, 'grants: guest reads, cannot write', g.rows[0]);
const rls = await db.query(`select count(*)::int n from pg_class where relname in ('comm_media','comm_fun','comm_stage','comm_xp','comm_sb_last') and relrowsecurity`);
t(rls.rows[0].n === 5, 'RLS on all part-14 tables (no direct access)');
console.log(bad ? `ds-fun SQL: ${bad}/${n} FAIL` : `ds-fun SQL OK (${n} checks, part applied twice)`);
process.exit(bad ? 1 : 0);
