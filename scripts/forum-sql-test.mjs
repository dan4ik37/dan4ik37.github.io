// T-157 форум 2.0: forum.sql целиком (старый форум + статьи из блоков) на PGlite с заглушками живых таблиц (profiles, auth.users,
// site_config, user_age, chat_mutes, xp_ledger…; мат и ссылки — настоящие comm_bad / comm_has_link из community.sql, XP — xp_award
// из xp.sql). Файл выполняется дважды (идемпотентно). Запуск из корня сайта: node scripts/forum-sql-test.mjs (PGLITE_PATH / DEPS_DIR)
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
  const msg = 'forum-sql-test: PGlite не найден — SQL-проверки пропущены (PGLITE_PATH=… или DEPS_DIR=…)';
  if (process.env.CI_STRICT) { console.log('FAIL ' + msg); process.exit(1); }
  console.log('SKIP ' + msg);
  process.exit(0);
}

const read = f => fs.readFileSync(path.join(SITE, f), 'utf8');
const forum = read('forum.sql');
const comm = read('community.sql');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + 1); if (i < 0 || j < 0) throw new Error('marker ' + a); return s.slice(i, j); };
const badFns = cut(comm, 'create or replace function public.comm_norm(p text)', '-- Код приглашения');
const xp = read('xp.sql');
const xpAward = cut(xp, 'create or replace function public.xp_award(', '-- Вызывать напрямую клиенту нельзя');

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create table cur(u uuid); insert into cur values (null); grant select on cur to anon, authenticated;
create function auth.uid() returns uuid language sql stable as 'select u from public.cur';
create table auth.users(id uuid primary key, created_at timestamptz default now());
create table public.profiles(id uuid primary key, nick text, role text default 'user');
create table public.site_config(key text primary key, value text);
create table public.user_age(user_id uuid primary key, birth_year int, u9_until timestamptz);
create function public.age_year_now() returns int language sql as 'select extract(year from now())::int';
create function public.kidsafe_on() returns boolean language sql as 'select true';
create function public.age_u9(p_uid uuid) returns boolean language sql stable as $$ select coalesce((select (a.birth_year is not null and public.age_year_now() - a.birth_year - 1 < 9) from public.user_age a where a.user_id = p_uid), false) $$;
create function public.age_group_of(p_uid uuid) returns text language sql stable as $$ select coalesce((select case when a.birth_year is null then 'unknown'
  when public.age_year_now() - a.birth_year - 1 < 13 then 'child' when public.age_year_now() - a.birth_year - 1 < 16 then 'teen'
  when public.age_year_now() - a.birth_year - 1 < 18 then 'teen16' else 'adult' end from public.user_age a where a.user_id = p_uid), 'unknown') $$;
create table public.chat_mutes(id bigint generated always as identity primary key, user_id uuid, nick text not null default '', until timestamptz not null);
create table public.xp_ledger(id bigint generated always as identity primary key, user_id uuid not null, source text not null, ref text not null default '',
  amount int not null, day date not null default current_date, created_at timestamptz not null default now(), unique (user_id, source, ref, day));
create function public.xp_rule(p_key text) returns int language sql immutable as $$ select case p_key when 'forum_thread' then 8 when 'forum_thread_day' then 3 when 'forum_post' then 2 when 'forum_post_day' then 10 end $$;
create table public.notes(u uuid, kind text, link text);
create function public.comm_notify(p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_link text, p_dedupe text) returns void language sql as $$ insert into public.notes values (p_user, p_kind, p_link) $$;
grant select on public.profiles to anon, authenticated; grant usage on schema auth to anon, authenticated;`);
await db.exec(badFns);
await db.exec(xpAward);
// старая часть xp.sql: триггеры XP на форум (их форум 2.0 заменяет)
await db.exec(`create or replace function public.xp_on_forum_thread() returns trigger language plpgsql as $$ begin perform public.xp_award(new.author_id, 'forum_thread', new.id::text, 8, 3); return null; end $$;
create or replace function public.xp_on_forum_post() returns trigger language plpgsql as $$ begin return null; end $$;`);
const legacyEnd = forum.indexOf('-- ═══ 1. Колонки статьи');
await db.exec(forum.slice(0, legacyEnd));   // сначала старый форум — как на живой базе
await db.exec(`create trigger xp_on_forum_thread after insert on public.forum_threads for each row execute function public.xp_on_forum_thread();
create trigger xp_on_forum_post after insert on public.forum_posts for each row execute function public.xp_on_forum_post();
grant select, insert, update, delete on public.forum_threads, public.forum_posts to anon, authenticated;`);
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222', K = '33333333-3333-3333-3333-333333333333',
  M = '44444444-4444-4444-4444-444444444444', T = '55555555-5555-5555-5555-555555555555', C = '66666666-6666-6666-6666-666666666666';
await db.exec(`insert into auth.users values ('${A}', now() - interval '30 days'),('${B}', now() - interval '30 days'),('${K}', now() - interval '30 days'),
  ('${M}', now() - interval '30 days'),('${T}', now() - interval '30 days'),('${C}', now() - interval '30 days');
insert into profiles values ('${A}','alice','user'),('${B}','bob','user'),('${K}','kid','user'),('${M}','mod','moderator'),('${T}','teen','user'),('${C}','child','user');
insert into user_age values ('${K}', extract(year from now())::int - 7, null), ('${T}', extract(year from now())::int - 15, null), ('${C}', extract(year from now())::int - 11, null);`);
// старые данные: тема с телом и двумя ответами
await db.exec(`insert into forum_threads(author_id, title) values ('${A}', 'Старая тема');
insert into forum_posts(thread_id, author_id, body) values (1, '${A}', 'Текст первой темы'), (1, '${B}', 'Ответ раз'), (1, '${A}', 'Ответ два');`);
await db.exec(`update forum_posts set created_at = now() - interval '1 day'`);
await db.exec(forum); await db.exec(forum);   // дважды: идемпотентно

const as = async u => db.exec(`update cur set u = ${u ? `'${u}'` : 'null'}`);
const q = async (s, p) => (await db.query(s, p)).rows[0].r;
const rpc = async (fn, args) => q(`select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(', ')}) r`, args);
let n = 0, bad = 0; const t = (c, m, x) => { n++; if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } };
const doc = o => JSON.stringify(Object.assign({ title: 'Как пройти первый уровень', blocks: [{ t: 'p', r: [{ x: 'Это длинный и полезный текст статьи про игру. '.repeat(10) }] }], tags: ['гайд'] }, o));

// ── перенос старого ──
const old = await q(`select row_to_json(t) r from forum_threads t where id = 1`);
t(old.status === 'published' && old.blocks?.[0]?.r?.[0]?.x === 'Текст первой темы', 'old thread became an article with one text block', old);
t(old.comments === 2, 'old posts counted as comments', old.comments);
t((await q(`select count(*)::int r from forum_posts where thread_id = 1 and is_body`)) === 1, 'exactly one body post after two runs');

// ── проверка блоков ──
await as(A);
const chk = d => rpc('forum_check', [JSON.stringify(d), A, true]);
t((await chk({ title: 'Заголовок нормальный', blocks: [{ t: 'script', x: 1 }] })).reason === 'block_type', 'unknown block type refused');
t((await chk({ title: 'Заголовок нормальный', blocks: [{ t: 'p', r: [{ x: 'текст', h: 'javascript:alert(1)' }] }] })).reason === 'link', 'javascript: link refused');
t((await chk({ title: 'Заголовок нормальный', blocks: [{ t: 'p', r: [{ x: 'текст', h: 'http://example.com' }] }] })).reason === 'link', 'http (not https) link refused');
t((await chk({ title: 'Заголовок нормальный', blocks: [{ t: 'p', r: [{ x: 'текст', h: 'https://user@evil.com/' }] }] })).reason === 'link', 'userinfo link refused');
t((await chk({ title: 'Заголовок нормальный', blocks: [{ t: 'video', p: 'yt', id: '<iframe>' }] })).reason === 'video', 'bad video id refused');
t((await chk({ title: 'Заголовок нормальный', blocks: [{ t: 'video', p: 'dailymotion', id: 'x7abc' }] })).reason === 'video', 'provider outside allow-list refused');
t((await chk({ title: 'Заголовок нормальный', blocks: [{ t: 'p', r: [{ x: 'a'.repeat(5001) }] }] })).reason === 'text_long', 'paragraph over 5000 refused');
t((await chk({ title: 'Ку', blocks: [] })).reason === 'title_short', 'short title refused on publish');
t((await rpc('forum_check', [JSON.stringify({ title: '', blocks: [] }), A, false])).ok === true, 'empty draft allowed');
t((await chk({ title: 'Заголовок нормальный', blocks: Array(61).fill({ t: 'hr' }) })).reason === 'blocks_many', '61 blocks refused');
t((await chk({ title: 'Заголовок нормальный', blocks: [{ t: 'img', src: `${A}/abcdefabcdefabcdef.webp` }] })).reason === 'media_off', 'images off until site_config media=true');
t((await chk({ title: 'Заголовок нормальный', tags: ['<b>'], blocks: [{ t: 'p', r: [{ x: 'текст текст текст текст' }] }] })).reason === 'tag', 'bad tag refused');
t((await chk({ title: 'Заголовок нормальный', source_url: 'ftp://x.ru/a', blocks: [{ t: 'p', r: [{ x: 'текст текст текст текст' }] }] })).reason === 'source', 'non-https source refused');
t((await chk({ title: 'Заголовок нормальный', blocks: [{ t: 'p', r: [{ x: 'ты сука такая и вообще' }] }] })).reason === 'bad', 'profanity refused (comm_bad)');
const okv = await chk({ title: 'Заголовок нормальный', age: 18, blocks: [{ t: 'p', r: [{ x: 'Жирный', b: 1, evil: '<x>' }, { x: ' и ссылка', h: 'https://example.com/a?b=1' }] },
  { t: 'h', x: 'Раздел', l: 9 }, { t: 'list', o: 1, items: ['раз', 'два', ''] }, { t: 'quote', x: 'цитата', by: 'кто-то' },
  { t: 'video', p: 'yt', id: 'dQw4w9WgXcQ', cap: 'ролик' }, { t: 'video', p: 'vk', id: '-123_456' }, { t: 'video', p: 'rt', id: 'a'.repeat(32) }, { t: 'video', p: 'tw', id: 'c:FunnyClip-abc' },
  { t: 'hr' }, { t: 'p', r: [{ x: '' }] }] });
t(okv.ok && okv.blocks.length === 9, 'valid doc with every text/video type accepted, empty paragraph dropped', okv);
t(okv.ok && !('evil' in okv.blocks[0].r[0]) && okv.blocks[1].l === 2, 'unknown run keys stripped, heading level normalised');
t(okv.ok && okv.age === 16, 'author cannot set 18+ (capped to 16)', okv.age);
t(okv.ok && okv.links === 1 && okv.videos === 4, 'links and videos counted', okv);

// ── сохранение: новичок → на проверку ──
let r = await rpc('forum_save', [null, doc({ title: '' , blocks: [] }), false]);
t(r.ok && r.status === 'draft', 'draft saved', r);
const draftId = r.id;
await as(B);
t((await rpc('forum_get', [draftId])).ok === false, 'other user cannot read a draft');
t((await rpc('forum_save', [draftId, doc(), true])).reason === 'not_yours', 'other user cannot publish my draft');
await as(A);
r = await rpc('forum_save', [draftId, doc(), true]);
t(r.ok && r.status === 'pending', 'new author: first article goes to pre-moderation', r);
t((await q(`select count(*)::int r from xp_ledger where source = 'forum_thread' and ref = '${draftId}'`)) === 0, 'no XP for pending article');
await as(null);
t((await rpc('forum_feed', ['new', null, null, 0, 20])).every(c => c.id !== draftId), 'pending not in public feed');
await as(B);
t((await rpc('forum_vote', [draftId, 1])).reason === 'not_found', 'cannot vote on pending');
t((await rpc('forum_comment', [draftId, null, 'привет'])).reason === 'not_found', 'cannot comment on pending');
await as(M);
const qu = await rpc('forum_mod_queue', []);
t(qu.ok && qu.pending.some(c => c.id === draftId), 'moderator sees it in the queue', qu);
await as(B);
t((await rpc('forum_mod_queue', [])).ok === false, 'non-moderator has no queue');
t((await rpc('forum_mod', ['approve', draftId, ''])).reason === 'mod', 'non-moderator cannot approve');
await as(M);
t((await rpc('forum_mod', ['approve', draftId, 'ок'])).ok, 'moderator approves');
t((await q(`select count(*)::int r from xp_ledger where source = 'forum_thread' and ref = '${draftId}'`)) === 1, 'XP once the article is published');
await as(null);
const feed = await rpc('forum_feed', ['new', null, null, 0, 20]);
t(feed.some(c => c.id === draftId && c.slug === 'kak-proiti-pervyi-uroven'), 'published article in the feed with slug', feed.map(c => c.slug));
t((await rpc('forum_feed', ['new', 'гайд', null, 0, 20])).length === 1, 'tag feed');
t((await rpc('forum_feed', ['hot', null, null, 0, 20])).length >= 1 && (await rpc('forum_feed', ['best', null, null, 0, 20])).length >= 1, 'hot and best feeds');

// ── оценки ──
await as(A);
t((await rpc('forum_vote', [draftId, 1])).reason === 'own', 'cannot vote own');
await as(B);
r = await rpc('forum_vote', [draftId, 1]); t(r.ok && r.rating === 1, 'upvote', r);
r = await rpc('forum_vote', [draftId, 1]); t(r.ok && r.rating === 1, 'second upvote does not stack', r);
r = await rpc('forum_vote', [draftId, -1]); t(r.ok && r.rating === -1, 'switch to downvote', r);
r = await rpc('forum_vote', [draftId, 0]); t(r.ok && r.rating === 0, 'remove vote', r);
await rpc('forum_vote', [draftId, 1]);
t((await rpc('forum_bookmark', [draftId, true])).bm === true && (await rpc('forum_feed', ['bookmarks', null, null, 0, 20])).length === 1, 'bookmark + bookmarks feed');
t((await rpc('forum_follow', [A, true])).follow === true && (await rpc('forum_feed', ['follow', null, null, 0, 20])).every(c => c.author_id === A), 'follow + following feed');
t((await rpc('forum_follow', [B, true])).reason === 'own', 'cannot follow self');

// ── комментарии деревом ──
r = await rpc('forum_comment', [draftId, null, 'Классная статья']); t(r.ok, 'comment', r);
const c1 = r.id;
await as(A);
r = await rpc('forum_comment', [draftId, c1, 'Спасибо!']); t(r.ok, 'reply to comment', r);
t((await q(`select depth r from forum_posts where id = ${r.id}`)) === 1, 'reply depth 1');
t((await q(`select count(*)::int r from notes where kind = 'forum_reply' and u = '${B}'`)) === 1, 'reply notifies the parent author');
t((await rpc('forum_comment', [draftId, null, 'ещё'])).reason === 'too_fast', 'comment gap enforced');
const cm = await rpc('forum_comments', [draftId]);
t(cm.length === 2 && cm[1].parent === c1, 'comments tree returned', cm);
t((await rpc('forum_comment_edit', [c1, 'чужой', false])).reason === 'not_yours', 'cannot edit others comment');
t((await q(`select comments r from forum_threads where id = ${draftId}`)) === 2, 'comment counter');

// ── жалобы ──
await as(B);
t((await rpc('forum_report', ['comment', c1, 'спам'])).ok, 'report comment');
t((await rpc('forum_report', ['comment', c1, 'спам'])).dup === true, 'duplicate report collapses');
await as(M);
const q2 = await rpc('forum_mod_queue', []);
t(q2.reports.some(x => x.target === c1 && x.kind === 'comment'), 'report in queue', q2.reports);
t((await rpc('forum_mod', ['delete_comment', c1, ''])).ok && (await q(`select deleted r from forum_posts where id = ${c1}`)) === true, 'mod deletes comment (soft)');
t((await rpc('forum_mod', ['hide', draftId, 'правила'])).ok, 'mod hides article');
await as(null);
t((await rpc('forum_get', [draftId])).ok === false, 'hidden article invisible to guests');
await as(A);
t((await rpc('forum_get', [draftId])).ok === true, 'author still sees hidden article');
t((await rpc('forum_save', [draftId, doc(), true])).reason === 'hidden', 'author cannot republish hidden');
await as(M); await rpc('forum_mod', ['restore', draftId, '']);

// ── доверенный автор публикует сразу; автоскрытие по жалобам ──
await as(A);
r = await rpc('forum_save', [null, doc({ title: 'Вторая статья автора' }), true]);
t(r.status === 'published', 'migrated old thread counts as checked: second article published (premod_n=2)', r);
await as(M); await rpc('forum_mod', ['approve', r.id, '']);
await as(A);
r = await rpc('forum_save', [null, doc({ title: 'Третья статья с источником', age: 6, source_url: 'https://example.com/news', source_title: 'Новости' }), true]);
t(r.status === 'published', 'trusted author publishes directly', r);
const third = r.id;
await db.exec(`insert into site_config values ('forum', '{"auto_hide":2}')`);
await as(B); await rpc('forum_report', ['article', third, 'фейк']);
await as(M); await rpc('forum_report', ['article', third, 'фейк']);
t((await q(`select status r from forum_threads where id = ${third}`)) === 'pending', 'auto_hide after N reports');
await as(M); await rpc('forum_mod', ['approve', third, '']);
t((await q(`select reports_open r from forum_threads where id = ${third}`)) === 0, 'approve clears reports');

// ── возраст: до 9 — только читать, оценка можно; ребёнок не видит 16+ ──
await as(K);
t((await rpc('forum_save', [null, doc(), true])).reason === 'u9', 'under 9 cannot write articles');
t((await rpc('forum_comment', [third, null, 'привет всем'])).reason === 'u9', 'under 9 cannot comment');
t((await rpc('forum_vote', [third, 1])).ok, 'under 9 may vote (like reactions in chat)');
await as(A);
r = await rpc('forum_save', [null, doc({ title: 'Статья для старших', age: 16 }), true]);
const older = r.id;
t((await q(`select age_min r from forum_threads where id = ${older}`)) === 16, 'age 16 stored');
await as(C);
t((await rpc('forum_get', [older])).reason === 'age', 'child (11) cannot open 16+ article');
t((await rpc('forum_feed', ['new', null, null, 0, 50])).every(c => c.age <= 6), 'child feed only 0+/6+');
await as(T);
t((await rpc('forum_feed', ['new', null, null, 0, 50])).every(c => c.age <= 12), 'teen (15) feed only up to 12+');
await as(null);
t((await rpc('forum_feed', ['new', null, null, 0, 50])).some(c => c.id === older), 'guest (unknown age) sees up to 16+ like chat');
await db.exec(`insert into chat_mutes(user_id, until) values ('${B}', now() + interval '1 hour')`);
await as(B);
t((await rpc('forum_comment', [third, null, 'хм'])).reason === 'muted', 'muted in chat → cannot comment');
await db.exec(`delete from chat_mutes`);

// ── RLS и прямые записи (старый клиент) ──
await db.exec(`update site_config set value = '{}' where key = 'forum'`);
await as(B);
await db.exec(`set role authenticated`);
let rows = (await db.query(`select id, status from forum_threads order by id`)).rows;
t(rows.every(x => x.status === 'published'), 'RLS: B sees only published rows', rows);
await db.exec(`insert into forum_threads(author_id, title, status, rating) values ('${B}', 'Прямая тема', 'published', 999)`);
const direct = (await db.query(`select id, status, rating from forum_threads where title = 'Прямая тема'`)).rows[0];
t(direct && direct.status === 'pending' && direct.rating === 0, 'direct insert: server decides status, rating forced', direct);
await db.exec(`insert into forum_posts(thread_id, author_id, body) values (${direct.id}, '${B}', 'тело прямой темы')`);
await db.exec(`update forum_threads set status = 'published', rating = 50 where id = ${third}`).catch(() => {});
await db.exec(`reset role`);
t((await q(`select rating r from forum_threads where id = ${third}`)) !== 50, 'direct update cannot touch rating of others');
t((await q(`select blocks->0->'r'->0->>'x' r from forum_threads where id = ${direct.id}`)) === 'тело прямой темы', 'legacy body post becomes the text block');
await as(A); await db.exec(`set role authenticated`);
rows = (await db.query(`select id from forum_threads where id = ${direct.id}`)).rows;
t(rows.length === 0, 'RLS: pending direct thread hidden from others');
await db.exec(`reset role`);
await as(K); await db.exec(`set role authenticated`);
let err = ''; try { await db.exec(`insert into forum_posts(thread_id, author_id, body) values (${third}, '${K}', 'я маленький')`); } catch (e) { err = e.message; }
await db.exec(`reset role`);
t(/9 лет/.test(err), 'direct insert by under-9 refused like chat', err);

// ── частота, лимиты, удаление ──
await as(A);
await db.exec(`insert into site_config values ('forum', '{"hour_saves":3}') on conflict (key) do update set value = excluded.value`);
await db.exec(`delete from forum_rate`);
for (let i = 0; i < 3; i++) await rpc('forum_save', [null, doc({ title: '' , blocks: [] }), false]);
t((await rpc('forum_save', [null, doc({ title: '', blocks: [] }), false])).reason === 'too_fast', 'hourly save limit');
await db.exec(`update site_config set value = '{}' where key = 'forum'`);
t((await rpc('forum_delete', [third])).ok && (await q(`select count(*)::int r from forum_threads where id = ${third}`)) === 0, 'author deletes own article');
await as(B);
t((await rpc('forum_delete', [older])).reason === 'not_yours', 'cannot delete others');

// ── медиа: включено — ключ только своей папки и только существующий объект ──
await db.exec(`create schema storage; create table storage.objects(bucket_id text, name text, metadata jsonb)`);
await db.exec(`update site_config set value = '{"media":true}' where key = 'forum'`);
await db.exec(`insert into storage.objects values ('forum-media', '${A}/abcdefabcdefabcdef.webp', '{"size":1000,"mimetype":"image/webp"}'), ('forum-media', '${A}/bbbbbbbbbbbbbbbbbb.pdf', '{"size":20000000,"mimetype":"application/pdf"}')`);
t((await rpc('forum_check', [JSON.stringify({ title: 'Картинка своя ок', blocks: [{ t: 'img', src: `${A}/abcdefabcdefabcdef.webp`, w: 800, h: 600 }] }), A, true])).cover === `${A}/abcdefabcdefabcdef.webp`, 'own uploaded image ok, becomes cover');
t((await rpc('forum_check', [JSON.stringify({ title: 'Картинка чужая', blocks: [{ t: 'img', src: `${A}/abcdefabcdefabcdef.webp` }] }), B, true])).reason === 'media_key', 'someone else image key refused');
t((await rpc('forum_check', [JSON.stringify({ title: 'Нет такой', blocks: [{ t: 'img', src: `${A}/cccccccccccccccccc.webp` }] }), A, true])).reason === 'media_missing', 'missing object refused');
t((await rpc('forum_check', [JSON.stringify({ title: 'Файл большой', blocks: [{ t: 'file', key: `${A}/bbbbbbbbbbbbbbbbbb.pdf`, name: 'a.pdf', size: 1 }] }), A, true])).reason === 'media_size', 'file over file_mb refused (real size from storage)');
t((await rpc('forum_check', [JSON.stringify({ title: 'Файл exe', blocks: [{ t: 'file', key: `${A}/bbbbbbbbbbbbbbbbbb.exe`, name: 'a.exe' }] }), A, true])).reason === 'media_type', 'file type outside allow-list refused');
t((await q(`select public.forum_cfg() r`)).premod_n === 2, 'cfg defaults merged');
t((await q(`select public.forum_slug('Привет, Мир! Щука и ёж') r`)) === 'privet-mir-schuka-i-ezh', 'slug transliteration');

// ── взлом (проверка 12.11): возраст чужого не узнать, прямые записи старого клиента не обходят правила ──
await db.exec(`update site_config set value = '{"comment_gap_s":0}' where key = 'forum'`);
await as(A);
const atk = (await rpc('forum_save', [null, doc({ title: 'Статья для проверки взлома' }), true])).id;
await as(B);
const bc = (await rpc('forum_comment', [atk, null, 'обычный комментарий'])).id;
t(atk && bc, 'attack setup: article and comment', { atk, bc });
const denied = async (role, uid, sql) => { await as(uid); await db.exec(`set role ${role}`); let e = ''; try { await db.query(sql); } catch (x) { e = x.message; } await db.exec(`reset role`); return /permission denied/i.test(e); };
for (const [fn, sql] of [['forum_cap', `select public.forum_cap('${C}')`], ['forum_u9', `select public.forum_u9('${K}')`], ['forum_muted', `select public.forum_muted('${B}')`],
  ['forum_check', `select public.forum_check('{"title":"x","age":16}'::jsonb, '${C}', false)`]]) {
  t(await denied('anon', null, sql), `guest cannot call ${fn} (would leak someone's age band / mute)`);
  t(await denied('authenticated', B, sql), `user cannot call ${fn} for someone else`);
}
// forum_can_see открыт (нужен политике RLS), но чужой uid не учитывает: гость про ребёнка узнаёт то же, что про себя
await as(null); await db.exec(`set role anon`);
const seeKid = (await db.query(`select public.forum_can_see('published', null, 16, 'kids', '${C}') r`)).rows[0].r;
await db.exec(`reset role`);
t(seeKid === true, 'forum_can_see ignores a foreign p_uid (no age oracle for guests)', seeKid);
// прямые правки комментария: не перенести в другую тему, не обойти длину, не подделать время, не вернуть текст удалённого
await as(B); await db.exec(`set role authenticated`);
await db.query(`update forum_posts set thread_id = ${older}, created_at = now() - interval '3 days' where id = ${bc}`).catch(() => {});
let longErr = ''; try { await db.query(`update forum_posts set body = repeat('a', 5000) where id = ${bc}`); } catch (e) { longErr = e.message; }
let titleErr = ''; try { await db.query(`insert into forum_threads(author_id, title) values ('${B}', repeat('я', 5000))`); } catch (e) { titleErr = e.message; }
await db.query(`insert into forum_posts(thread_id, author_id, body, created_at) values (${atk}, '${B}', 'из прошлого', now() - interval '5 days')`).catch(() => {});
await db.query(`update forum_threads set author_id = '${A}', created_at = now() - interval '9 days' where id = ${direct.id}`).catch(() => {});
await db.exec(`reset role`);
const dRow = await q(`select row_to_json(t) r from forum_threads t where id = ${direct.id}`);
t(dRow.author_id === B, 'direct update cannot hand an own thread to another author (impersonation)', dRow.author_id);
const bcRow = await q(`select row_to_json(p) r from forum_posts p where id = ${bc}`);
t(bcRow.thread_id === atk, 'direct update cannot move a comment to another article', bcRow.thread_id);
t(Date.now() - new Date(bcRow.created_at).getTime() < 3600e3, 'direct update cannot forge created_at', bcRow.created_at);
t(/длинн/i.test(longErr), 'direct update cannot exceed 4000 chars', longErr);
t(/длинн/i.test(titleErr), 'direct insert cannot store a 5000-char title', titleErr);
const past = await q(`select created_at r from forum_posts where body = 'из прошлого'`);
t(past && Date.now() - new Date(past).getTime() < 3600e3, 'direct insert cannot forge created_at', past);
await as(M); await rpc('forum_mod', ['delete_comment', bc, '']);
await as(B); await db.exec(`set role authenticated`);
await db.query(`update forum_posts set body = 'вернул текст' where id = ${bc}`).catch(() => {});
await db.exec(`reset role`);
t((await q(`select body r from forum_posts where id = ${bc}`)) === '', 'deleted comment text cannot be refilled directly', await q(`select body r from forum_posts where id = ${bc}`));
// новичок не протащит ссылку прямой правкой комментария (как forum_comment: link_new)
await db.exec(`insert into auth.users values ('77777777-7777-7777-7777-777777777777', now()); insert into profiles values ('77777777-7777-7777-7777-777777777777', 'newbie', 'user')`);
await as('77777777-7777-7777-7777-777777777777');
const nc = (await rpc('forum_comment', [atk, null, 'привет без ссылок'])).id;
await db.exec(`set role authenticated`);
let linkErr = ''; try { await db.query(`update forum_posts set body = 'заходи https://evil.example.com' where id = ${nc}`); } catch (e) { linkErr = e.message; }
await db.exec(`reset role`);
t(nc && /Ссылки/.test(linkErr), 'new account cannot add a link by direct update', linkErr);

console.log(bad ? `forum SQL: ${bad}/${n} FAIL`: `forum SQL OK (${n} checks, file applied twice)`);
process.exit(bad ? 1 : 0);
