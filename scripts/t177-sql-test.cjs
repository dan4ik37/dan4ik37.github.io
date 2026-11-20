// T-177: community.sql ч. 17 на PGlite (Postgres в памяти, без сети и без настоящей базы): ники из смайликов, проверки ника,
// смена / сброс ника админом (замок на время / навсегда, «сгоревший» старый ник), смайлики в нике сообщения и в @упоминаниях,
// повторный запуск ч. 17. Заглушки — как на живой базе (auth.uid(), роли authenticated / anon, profiles, banned_nicks, журнал, 🔔).
// Запуск: node scripts/t177-sql-test.cjs   (PGLITE_PATH=<папка @electric-sql/pglite> или DEPS_DIR=<папка node_modules>)
const fs = require('fs'), path = require('path');
const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..');
let n = 0, fails = 0;
const ok = (c, m, x) => { n++; if (!c) fails++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
function findPglite(){
  const c = [process.env.PGLITE_PATH, process.env.DEPS_DIR && path.join(process.env.DEPS_DIR, '@electric-sql/pglite'), process.env.DEPS_DIR && path.join(process.env.DEPS_DIR, 'node_modules/@electric-sql/pglite'),
    'M:/d37/claude-tmp/t157/deps/node_modules/@electric-sql/pglite'].filter(Boolean);
  return c.find(p => fs.existsSync(path.join(p, 'package.json')));
}
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
// одна функция из файла: от «create or replace function public.<name>» до первого «$$;» после тела
function fn(file, name){
  const s = read(file), i = s.indexOf('create or replace function public.' + name + '(');
  if (i < 0) throw new Error(name + ' нет в ' + file);
  const a = s.indexOf('$$', i), b = s.indexOf('$$', a + 2), e = s.indexOf(';', b);
  return s.slice(i, e + 1);
}
(async () => {
  const pg = findPglite();
  if (!pg) { console.log('  — PGlite не найден (PGLITE_PATH / DEPS_DIR) — проверка SQL пропущена'); process.exit(0); }
  const { PGlite } = await import(pathToFileURL(path.join(pg, 'dist/index.js')).href);
  const db = new PGlite();
  const q = async (sql, p) => (await db.query(sql, p)).rows;
  const ex = sql => db.exec(sql);
  const A = '00000000-0000-4000-8000-00000000000a', U = '00000000-0000-4000-8000-000000000001', U2 = '00000000-0000-4000-8000-000000000002', M = '00000000-0000-4000-8000-00000000000m'.replace('m', 'b');
  await ex(`
    create role authenticated; create role anon;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
    create table public.profiles (id uuid primary key, nick text, role text default 'user', donate_login text, created_at timestamptz default now());
    grant select, update on public.profiles to authenticated;
    create table public.banned_nicks (nick text primary key, banned_by uuid, created_at timestamptz default now());
    create table public.comm_modlog (id bigserial primary key, community_id bigint, actor_id uuid, actor_nick text, target_id uuid, target_nick text, action text, reason text, detail text, channel text, created_at timestamptz default now());
    create table public.notifications (id bigserial primary key, user_id uuid, kind text, actor_id uuid, title text, body text, link text);
    create table public.messages (id bigserial primary key, user_id uuid, nick text, text text, role text, vip_tier text, is_sticker boolean);
    grant insert, select on public.messages to authenticated; grant usage on sequence public.messages_id_seq to authenticated;
    create table public.mentions_seen (m text);
    create function public.is_client_session() returns boolean language sql stable as $$ select current_user in ('authenticated', 'anon') $$;
    create function public.is_admin_user(uid uuid) returns boolean language sql stable security definer set search_path = public as $$ select coalesce((select role = 'admin' from public.profiles where id = uid), false) $$;
    create function public.mod_is_owner(p_uid uuid) returns boolean language sql stable security definer set search_path = public as $$ select p_uid is not null and coalesce((select role = 'admin' from public.profiles where id = p_uid), false) $$;
    create function public.comm_log(p_cid bigint, p_actor uuid, p_target uuid, p_tnick text, p_action text, p_reason text, p_detail text, p_channel text) returns void language sql security definer set search_path = public as $$
      insert into public.comm_modlog (community_id, actor_id, target_id, target_nick, action, reason, detail, channel) values (p_cid, p_actor, p_target, p_tnick, p_action, p_reason, p_detail, p_channel) $$;
    create function public.notify(p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_link text, p_dedupe text default null) returns void language sql security definer set search_path = public as $$
      insert into public.notifications (user_id, kind, actor_id, title, body, link) values (p_user, p_kind, p_actor, p_title, p_body, p_link) $$;
    -- как vip-balance.sql messages_enforce_status (часть, где чистится ник) и community.sql (@упоминания) — со СТАРЫМ классом символов
    create function public.messages_enforce_status() returns trigger language plpgsql security definer set search_path = public as $$
    begin
      new.nick := left(btrim(regexp_replace(coalesce(new.nick, ''), '[^A-Za-zА-Яа-яЁё0-9_. -]', '', 'g')), 24);
      if new.nick = '' then new.nick := 'user'; end if;
      return new;
    end $$;
    create trigger messages_enforce_status before insert on public.messages for each row execute function public.messages_enforce_status();
    create function public.t_mentions(v_text text) returns text[] language plpgsql as $$
    declare m text; r text[] := '{}';
    begin
      for m in select distinct lower((regexp_matches(v_text, '@([A-Za-zА-Яа-яЁё0-9_.-]{2,24})', 'g'))[1]) loop r := r || m; end loop;
      return r;
    end $$;
  `);
  await ex([fn('premium.sql', 'donor_name_key'), fn('premium.sql', 'donor_name_reserved'), fn('community.sql', 'comm_norm'), fn('community.sql', 'comm_bad'),
    fn('server-hardening.sql', 'profile_nick_sanitize'),
    `create trigger a1_profile_nick_sanitize before insert or update of nick on public.profiles for each row execute function public.profile_nick_sanitize();`].join('\n'));
  await q(`insert into public.profiles (id, nick, role) values ($1, 'dan4ik37', 'admin'), ($2, 'Вася', 'user'), ($3, 'Петя', 'user'), ($4, 'Модер', 'moderator')`, [A, U, U2, M]);
  // ДО ч. 17: ник из смайликов вырезается (то, что видел владелец)
  const asUser = async (uid, sql, p) => { await ex(`select set_config('t.uid', '${uid}', false); set role authenticated;`); try { return await q(sql, p); } finally { await ex('reset role;'); } };
  let before = null; try { await asUser(U, `update public.profiles set nick = '🔥🔥' where id = $1`, [U]); } catch (e) { before = e.message; }
  ok(/от 2 до 24/.test(before || ''), 'до ч. 17: ник «🔥🔥» отвергается (смайлики вырезались) — причина подтверждена', before);
  // ═══ ч. 17 — два раза подряд (повторный запуск) ═══
  const s = read('community.sql'), i = s.indexOf('-- ЧАСТЬ 17');
  const part = s.slice(s.lastIndexOf('\n-- ═══', i), s.indexOf('\n-- ЧАСТЬ 18') > 0 ? s.indexOf('\n-- ЧАСТЬ 18') : undefined);
  let e1 = null; try { await ex(part); await ex(part); } catch (e) { e1 = e.message; }
  ok(!e1, 'ч. 17 выполняется, и повторно тоже', e1);
  ok((await q(`select public.nick17_info() v`))[0].v.ok === true, 'nick17_info → ok');
  const setNick = async (uid, nick) => { try { await asUser(uid, `update public.profiles set nick = $1 where id = $2`, [nick, uid]); return 'ok:' + (await q(`select nick from public.profiles where id = $1`, [uid]))[0].nick; } catch (e) { return 'err:' + e.message; } };
  // ═══ ники из смайликов ═══
  for (const nk of ['🔥🔥', '🐱 Вася', 'Ника✨', '👨‍👩‍👧 семья', '❤️❤️', '1️⃣2️⃣', '🇰🇿🇰🇿']) { const r = await setNick(U, nk); ok(r === 'ok:' + nk, `ник «${nk}» принят как есть`, r); }
  const bad = [['🔥', 'от 2 до 24'], ['   ', 'от 2 до 24'], ['_._', 'только из пробелов'], ['Аноним🔥', 'занят системой'], ['dan4ik37🔥', 'команды'], ['dаn4ik37', 'команды'],
    ['DAN4IK37 фан', 'команды'], ['Денчик37', 'команды'], ['модер', 'команды'], ['сука🔥', 'мата'], ['🔥'.repeat(25), 'от 2 до 24']];
  for (const [nk, why] of bad) { const r = await setNick(U, nk); ok(r.startsWith('err:') && r.includes(why), `«${nk.slice(0, 12)}» — отказ: ${why}`, r); }
  const cleaned = await setNick(U, 'Ва\u200bся\u202e🔥');
  ok(cleaned === 'ok:Вася🔥', 'невидимые символы (нулевой ширины, направление текста) вырезаются сервером', cleaned);
  const zwj = await setNick(U, 'а\u200d🔥б');
  ok(zwj === 'ok:а🔥б', 'лишний ZWJ рядом с буквой вырезается', zwj);
  ok((await setNick(M, 'Модер🛡')).startsWith('ok:'), 'сам модератор может менять свой ник');
  await setNick(M, 'Модер');
  // ═══ смайлики в нике сообщения и в @упоминаниях ═══
  await asUser(U, `insert into public.messages (user_id, nick, text) values ($1, '🐱 Вася', 'привет')`, [U]);
  ok((await q(`select nick from public.messages order by id desc limit 1`))[0].nick === '🐱 Вася', 'сообщение: ник со смайликом сохраняется (раньше — «Вася» / «user»)');
  ok((await q(`select public.t_mentions('привет @🔥🔥 и @Вася') r`))[0].r.join(',') === '🔥🔥,вася', '@упоминание ника из смайликов находится', (await q(`select public.t_mentions('привет @🔥🔥 и @Вася') r`))[0].r);
  // ═══ админ меняет ник ═══
  const asAdm = (sql, p) => asUser(A, sql, p);
  await setNick(U, 'Вася');
  const r0 = (await asUser(U2, `select public.nick_admin_set($1, 'Тихоня', 'тест', 60) r`, [U]))[0].r;
  ok(r0.ok === false && r0.reason === 'admin_only', 'не админ — nick_admin_set: отказ (admin_only)', r0);
  const r0m = (await asUser(M, `select public.nick_admin_reset($1, 'тест') r`, [U]))[0].r;
  ok(r0m.ok === false && r0m.reason === 'admin_only', 'модератор — тоже отказ (права не расширены)', r0m);
  ok((await asAdm(`select public.nick_admin_set($1, 'Тихоня', '', 60) r`, [U]))[0].r.reason === 'reason_req', 'без причины — отказ');
  ok((await asAdm(`select public.nick_admin_set($1, 'Тихоня', 'флуд', 5) r`, [U]))[0].r.reason === 'minutes', 'срок только 1 ч / 1 день / 7 / 30 дней / навсегда');
  ok((await asAdm(`select public.nick_admin_set($1, 'x', 'флуд', 0) r`, [A]))[0].r.reason === 'self', 'себе — нельзя');
  const r1 = (await asAdm(`select public.nick_admin_set($1, 'Тихоня🙂', 'оскорбительный ник', 60) r`, [U]))[0].r;
  ok(r1.ok === true && r1.nick === 'Тихоня🙂' && r1.old === 'Вася' && r1.until, 'админ: ник «Вася» → «Тихоня🙂» на 1 час', r1);
  ok((await setNick(U, 'Новый')).includes('свой сможешь выбрать после'), 'на время: сам сменить нельзя, понятная причина');
  ok((await asUser(U, `select public.nick_my_lock() r`))[0].r.locked === true, 'nick_my_lock: замок виден самому игроку');
  const nt = await q(`select title, body, kind from public.notifications where user_id = $1 order by id desc limit 1`, [U]);
  ok(nt[0] && nt[0].kind === 'nick_admin' && nt[0].body.includes('оскорбительный ник') && nt[0].title.includes('Тихоня'), '🔔 игроку: что сделали и почему', nt[0]);
  const lg = await q(`select action, reason, detail from public.comm_modlog order by id desc limit 1`);
  ok(lg[0].action === 'nick_set' && lg[0].detail.includes('Вася → Тихоня🙂'), '📜 журнал модерации: nick_set, «Вася → Тихоня🙂»', lg[0]);
  // срок вышел — ник НЕ возвращается, свой выбрать можно, кроме «сгоревшего» (и его простых вариантов)
  await q(`update public.nick_lock set until = now() - interval '1 minute' where user_id = $1`, [U]);
  ok((await q(`select nick from public.profiles where id = $1`, [U]))[0].nick === 'Тихоня🙂', 'срок вышел: ник админа остаётся (старый не возвращается)');
  for (const v of ['Вася', 'ВАСЯ', 'Bacя', 'вася!', 'Вася 🔥', 'В а с я']) { const r = await setNick(U, v); ok(r.includes('убрал админ'), `«сгоревший» ник «${v}» — нельзя`, r); }
  ok((await setNick(U, 'Василёк')) === 'ok:Василёк', 'после срока свой новый ник — можно');
  // навсегда
  const r2 = (await asAdm(`select public.nick_admin_set($1, 'Игрок1', 'реклама в нике', 0) r`, [U]))[0].r;
  ok(r2.ok && r2.forever === true, 'админ: «навсегда»', r2);
  await q(`update public.nick_lock set set_at = now() - interval '400 days' where user_id = $1`, [U]);
  ok((await setNick(U, 'Свобода')).includes('навсегда'), 'навсегда: сам не сменит никогда');
  ok((await asUser(U, `select public.nick_my_lock() r`))[0].r.forever === true, 'nick_my_lock: forever');
  // сброс: нейтральный ник, старый сгорает, выбрать свой — сразу
  const r3 = (await asAdm(`select public.nick_admin_reset($1, 'ник под админа') r`, [U2]))[0].r;
  ok(r3.ok && /^Игрок\d{6}$/.test(r3.nick) && r3.old === 'Петя', '«Сбросить ник» → «Игрок» + 6 цифр', r3);
  ok((await setNick(U2, 'Петя')).includes('убрал админ'), 'после сброса старый ник — нельзя');
  ok((await setNick(U2, 'Пётр🎸')) === 'ok:Пётр🎸', 'после сброса свой новый — сразу можно');
  ok((await q(`select count(*)::int c from public.comm_modlog where action = 'nick_reset'`))[0].c === 1, 'сброс записан в журнал');
  // бан ника не теряется при смене
  await q(`insert into public.banned_nicks (nick) values ('Пётр🎸')`);
  const r4 = (await asAdm(`select public.nick_admin_set($1, 'Тихий', 'нарушитель', 1440) r`, [U2]))[0].r;
  ok(r4.ok && (await q(`select count(*)::int c from public.banned_nicks where nick = 'Тихий'`))[0].c === 1, 'бан ника переходит на новый ник', r4);
  // anon не может звать функции админа
  let anonErr = null; try { await ex(`set role anon; select public.nick_admin_set('${U}', 'x', 'y', 0); reset role;`); } catch (e) { anonErr = e.message; await ex('reset role;'); }
  ok(/permission denied/.test(anonErr || ''), 'гость (anon) — нет доступа к nick_admin_set', anonErr);
  console.log(`\n${n - fails}/${n} ✓${fails ? ' — ОШИБКИ: ' + fails : ''}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
