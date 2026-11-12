-- ═══════════════════════════════════════════════════════════════════
--  ФОРУМ
--  Выполнить целиком в Supabase → SQL Editor. Один раз.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.forum_threads (
  id bigint generated always as identity primary key,
  author_id uuid references auth.users(id) not null,
  title text not null,
  pinned boolean default false,
  locked boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.forum_posts (
  id bigint generated always as identity primary key,
  thread_id bigint references public.forum_threads(id) on delete cascade not null,
  author_id uuid references auth.users(id) not null,
  body text not null,
  created_at timestamptz default now(),
  edited_at timestamptz
);

alter table public.forum_threads enable row level security;
alter table public.forum_posts enable row level security;

-- Читать может любой, даже гость
drop policy if exists "Темы читают все" on public.forum_threads;
create policy "Темы читают все" on public.forum_threads for select using (true);
drop policy if exists "Посты читают все" on public.forum_posts;
create policy "Посты читают все" on public.forum_posts for select using (true);

-- Создавать темы/посты — только зарегистрированные, и только от своего
-- имени (auth.uid() = author_id). Гостям форум специально не открыт —
-- в отличие от чата, здесь нет смысла в анонимных сообщениях, только
-- спам без возможности разобраться, кто писал.
drop policy if exists "Создать тему может только зарегистрированный" on public.forum_threads;
create policy "Создать тему может только зарегистрированный"
  on public.forum_threads for insert
  with check (auth.uid() = author_id);

drop policy if exists "Написать пост может только зарегистрированный" on public.forum_posts;
create policy "Написать пост может только зарегистрированный"
  on public.forum_posts for insert
  with check (
    auth.uid() = author_id
    and not exists (select 1 from public.forum_threads t where t.id = thread_id and t.locked = true)
  );

-- Редактировать: заголовок темы и текст поста — только автор (или
-- админ). Пин/лок — только админ, даже для автора темы. Разграничение
-- по колонкам делает триггер ниже (RLS сам по себе построчный, не
-- поколоночный).
drop policy if exists "Править тему может автор или админ" on public.forum_threads;
create policy "Править тему может автор или админ"
  on public.forum_threads for update
  using (auth.uid() = author_id or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (true);

drop policy if exists "Править пост может только автор" on public.forum_posts;
create policy "Править пост может только автор"
  on public.forum_posts for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

-- Удалять — автор, либо стафф (admin/moderator/helper) — та же модель
-- прав, что уже есть в чате на удаление сообщений.
drop policy if exists "Удалить тему может автор или стафф" on public.forum_threads;
create policy "Удалить тему может автор или стафф"
  on public.forum_threads for delete
  using (
    auth.uid() = author_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','moderator','helper'))
  );

drop policy if exists "Удалить пост может автор или стафф" on public.forum_posts;
create policy "Удалить пост может автор или стафф"
  on public.forum_posts for delete
  using (
    auth.uid() = author_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','moderator','helper'))
  );

-- Триггер: pinned/locked может менять только админ (даже если RLS выше
-- пустил автора темы до UPDATE ради смены заголовка) — та же идея, что
-- и защита от подделки роли в registration.sql.
create or replace function public.protect_thread_moderation_fields()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  acting_role text;
begin
  if (new.pinned is distinct from old.pinned) or (new.locked is distinct from old.locked) then
    select role into acting_role from public.profiles where id = auth.uid();
    if acting_role is distinct from 'admin' then
      new.pinned := old.pinned;
      new.locked := old.locked;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_thread_moderation_change on public.forum_threads;
create trigger on_thread_moderation_change
  before update on public.forum_threads
  for each row execute procedure public.protect_thread_moderation_fields();

-- ═══════════════════════════════════════════════════════════════════
--  ФОРУМ 2.0 — СТАТЬИ ИЗ БЛОКОВ (T-157, владелец 12.11.2026: «нельзя нормально людям выкладывать статьи свои встраивать видео,
--  с файлами. И источником. Как в новостных лентах или пикабу»). Клиент — js/features/forum2.js (флаг FORUM2 в js/core/config.js),
--  проверка блоков в браузере и на сервере страниц — api/_lib/forum-blocks.js; серверные страницы — api/_lib/routes/forum.js.
--  Выполнить ВЕСЬ файл целиком (часть выше — старый форум — тоже). Идемпотентно. Нужны (уже применены): profiles, xp.sql,
--  economy.sql (xp_rule), age.sql (age_group_of, age_u9, kidsafe_on), community.sql (comm_bad, comm_has_link, chat_mutes, comm_notify).
--  Нет какой-то функции — шаг с ней пропускается (to_regprocedure), ничего не падает.
--  ВНИМАНИЕ: перезапустили xp.sql или economy.sql — после них запустить этот файл ещё раз (XP за статью — только после публикации).
--
--  Что есть:
--   • статья = строка forum_threads: blocks (JSON-блоки: p — текст с жирным / курсивом / ссылкой, h — заголовок, list, quote, img,
--     video — только провайдер + id из списка YouTube / VK Видео / RuTube / Twitch, file, hr), cover, tags, source_url + source_title,
--     status (draft / pending / published / hidden), age_min (0 / 6 / 12 / 16 / 18), realm (kids / adult — adult выключен, пока нет
--     проверки 18+), рейтинг и счётчики. Сырой HTML не хранится и не выводится — только данные;
--   • старые темы — статьи с одним текстовым блоком (первый пост темы = тело, is_body), остальные посты — комментарии
--     (parent_id — дерево). Старый клиент (FORUM2 = false) работает как раньше: прямые вставки идут через охранный триггер;
--   • оценки +/−, закладки, подписки на автора, жалобы, очередь модерации; все записи — через функции ниже (security definer),
--     они проверяют блоки, ссылки (только https), видео, длины, лимиты частоты, возраст (до 9 лет — только читать и оценивать, как
--     чат), мут в чате, предпроверку новичков;
--   • RLS: черновики, «на проверке» и скрытые видят только автор и модераторы (admin / moderator / helper).
--  Числа — site_config key 'forum' (JSON; нет строки — значения ниже, их подтверждает владелец):
--    {"premod_n":2,"new_hours":72,"media":false,"img_kb":900,"file_mb":10,"user_mb":200,"files":["pdf","txt","zip"],
--     "day_articles":5,"hour_saves":240,"day_comments":80,"comment_gap_s":10,"hour_votes":120,"day_reports":20,"auto_hide":5,
--     "min_chars_xp":300}
--    media — картинки и файлы в статьях (хранилище 'forum-media'): false, пока владелец не утвердит лимиты (img_kb, file_mb, user_mb).
--    Включить: insert into public.site_config (key, value) values ('forum', '{"media":true}') on conflict (key) do update set value = excluded.value;
--  Проверка после запуска (гостем, publishable key): /rpc/forum_feed {"p_sort":"new"} → массив; /rpc/forum_cfg → JSON с premod_n;
--  /rpc/forum_save гостем → {"ok":false,"reason":"auth"} (PGRST202 — файл не применён).
-- ═══════════════════════════════════════════════════════════════════

-- ═══ 1. Колонки статьи ═══
alter table public.forum_threads add column if not exists blocks jsonb;
alter table public.forum_threads add column if not exists status text not null default 'published';
alter table public.forum_threads add column if not exists cover text;
alter table public.forum_threads add column if not exists tags text[] not null default '{}';
alter table public.forum_threads add column if not exists source_url text;
alter table public.forum_threads add column if not exists source_title text;
alter table public.forum_threads add column if not exists excerpt text not null default '';
alter table public.forum_threads add column if not exists chars int not null default 0;
alter table public.forum_threads add column if not exists age_min smallint not null default 12;
alter table public.forum_threads add column if not exists realm text not null default 'kids';
alter table public.forum_threads add column if not exists rating int not null default 0;
alter table public.forum_threads add column if not exists votes_up int not null default 0;
alter table public.forum_threads add column if not exists votes_down int not null default 0;
alter table public.forum_threads add column if not exists comments int not null default 0;
alter table public.forum_threads add column if not exists reports_open int not null default 0;
alter table public.forum_threads add column if not exists published_at timestamptz;
alter table public.forum_threads add column if not exists edited_at timestamptz;
alter table public.forum_threads add column if not exists updated_at timestamptz not null default now();
alter table public.forum_threads add column if not exists mod_note text not null default '';
alter table public.forum_threads add column if not exists trusted boolean not null default false;   -- автор прошёл предпроверку на момент публикации (реклама рядом можно)
alter table public.forum_threads add column if not exists pinged_at timestamptz;                    -- IndexNow уже сообщили (api/_lib/routes/forum.js)
do $$ begin
  alter table public.forum_threads add constraint forum_threads_status check (status in ('draft', 'pending', 'published', 'hidden'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.forum_threads add constraint forum_threads_age check (age_min in (0, 6, 12, 16, 18));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.forum_threads add constraint forum_threads_realm check (realm in ('kids', 'adult'));
exception when duplicate_object then null; end $$;

alter table public.forum_posts add column if not exists parent_id bigint references public.forum_posts(id) on delete cascade;
alter table public.forum_posts add column if not exists is_body boolean not null default false;
alter table public.forum_posts add column if not exists deleted boolean not null default false;
alter table public.forum_posts add column if not exists depth smallint not null default 0;

-- Три ленты, метки, автор, комментарии
create index if not exists idx_forum_new on public.forum_threads (published_at desc) where status = 'published';
create index if not exists idx_forum_best on public.forum_threads (rating desc, published_at desc) where status = 'published';
create index if not exists idx_forum_tags on public.forum_threads using gin (tags);
create index if not exists idx_forum_author on public.forum_threads (author_id, updated_at desc);
create index if not exists idx_forum_status on public.forum_threads (status, updated_at) where status in ('pending', 'hidden');
create index if not exists idx_forum_posts_thread on public.forum_posts (thread_id, created_at);
create index if not exists idx_forum_posts_author on public.forum_posts (author_id, created_at desc);

-- ═══ 2. Оценки, закладки, подписки, жалобы, частота ═══
create table if not exists public.forum_votes (
  thread_id bigint not null references public.forum_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  v smallint not null check (v in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);
create index if not exists idx_forum_votes_user on public.forum_votes (user_id, created_at desc);
create table if not exists public.forum_bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id bigint not null references public.forum_threads(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, thread_id)
);
create table if not exists public.forum_follows (
  follower uuid not null references auth.users(id) on delete cascade,
  author uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, author),
  check (follower <> author)
);
create index if not exists idx_forum_follows_author on public.forum_follows (author);
create table if not exists public.forum_reports (
  id bigint generated always as identity primary key,
  reporter uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('article', 'comment')),
  target bigint not null,
  thread_id bigint references public.forum_threads(id) on delete cascade,
  why text not null default '' check (char_length(why) <= 300),
  status text not null default 'new' check (status in ('new', 'done', 'dismissed')),
  by_mod uuid,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists idx_forum_reports_once on public.forum_reports (reporter, kind, target) where status = 'new';
create index if not exists idx_forum_reports_new on public.forum_reports (created_at) where status = 'new';
create table if not exists public.forum_rate (            -- счётчики частоты (окно — час или день)
  user_id uuid not null references auth.users(id) on delete cascade,
  k text not null,
  win timestamptz not null,
  n int not null default 0,
  primary key (user_id, k, win)
);
create table if not exists public.forum_mod_log (
  id bigint generated always as identity primary key,
  mod_id uuid, action text not null, kind text not null, target bigint not null, note text not null default '',
  created_at timestamptz not null default now()
);

alter table public.forum_votes enable row level security;
alter table public.forum_bookmarks enable row level security;
alter table public.forum_follows enable row level security;
alter table public.forum_reports enable row level security;
alter table public.forum_rate enable row level security;
alter table public.forum_mod_log enable row level security;
revoke all on public.forum_votes, public.forum_bookmarks, public.forum_follows, public.forum_reports, public.forum_rate, public.forum_mod_log from anon, authenticated;
grant select on public.forum_votes, public.forum_bookmarks, public.forum_follows to authenticated;
drop policy if exists "forum: свои оценки" on public.forum_votes;
create policy "forum: свои оценки" on public.forum_votes for select to authenticated using (user_id = auth.uid());
drop policy if exists "forum: свои закладки" on public.forum_bookmarks;
create policy "forum: свои закладки" on public.forum_bookmarks for select to authenticated using (user_id = auth.uid());
drop policy if exists "forum: свои подписки" on public.forum_follows;
create policy "forum: свои подписки" on public.forum_follows for select to authenticated using (follower = auth.uid());

-- ═══ 3. Помощники (клиенту не даны) ═══
create or replace function public.forum_cfg() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d jsonb := '{"premod_n":2,"new_hours":72,"media":false,"img_kb":900,"file_mb":10,"user_mb":200,"files":["pdf","txt","zip"],"day_articles":5,"hour_saves":240,"day_comments":80,"comment_gap_s":10,"hour_votes":120,"day_reports":20,"auto_hide":5,"min_chars_xp":300}'::jsonb;
  v text;
begin
  if to_regclass('public.site_config') is not null then
    execute 'select value::text from public.site_config where key = $1' into v using 'forum';
    if v is not null then begin d := d || v::jsonb; exception when others then null; end; end if;
  end if;
  return d;
end $$;
grant execute on function public.forum_cfg() to anon, authenticated;

create or replace function public.forum_is_mod(p_uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'moderator', 'helper') from public.profiles where id = p_uid), false)
$$;
grant execute on function public.forum_is_mod(uuid) to anon, authenticated;

-- Сколько «+» можно видеть (как сообщества, community.sql comm_age_cap): до 13 — 6+, 13–15 — 12+, 16–17 — 16+, 18+ — 18,
-- возраст не указан и гость — 16+
create or replace function public.forum_cap(p_uid uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare g text := 'unknown';
begin
  if p_uid is not null and to_regprocedure('public.age_group_of(uuid)') is not null then execute 'select public.age_group_of($1)' into g using p_uid; end if;
  return case g when 'child' then 6 when 'teen' then 12 when 'teen16' then 16 when 'adult' then 18 else 16 end;
end $$;
-- Мир 18+ (docs/REALMS.md): нет поставщика проверки возраста — выключено для всех (код готов, включит владелец)
create or replace function public.forum_adult_ok(p_uid uuid) returns boolean language sql stable as $$ select false $$;
create or replace function public.forum_u9(p_uid uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r boolean := false; ks boolean := true;
begin
  if p_uid is null or to_regprocedure('public.age_u9(uuid)') is null then return false; end if;
  if to_regprocedure('public.kidsafe_on()') is not null then execute 'select public.kidsafe_on()' into ks; end if;
  if not ks then return false; end if;
  execute 'select public.age_u9($1)' into r using p_uid;
  return coalesce(r, false);
end $$;
create or replace function public.forum_muted(p_uid uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r boolean := false;
begin
  if p_uid is null or to_regclass('public.chat_mutes') is null then return false; end if;
  execute 'select exists (select 1 from public.chat_mutes where user_id = $1 and until > now())' into r using p_uid;
  return r;
end $$;
create or replace function public.forum_bad(p text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r boolean := false;
begin
  if p is null or p = '' or to_regprocedure('public.comm_bad(text)') is null then return false; end if;
  execute 'select public.comm_bad($1)' into r using p;
  return coalesce(r, false);
end $$;
create or replace function public.forum_link_in(p text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r boolean := false;
begin
  if p is null or p = '' then return false; end if;
  if to_regprocedure('public.comm_has_link(text)') is null then return p ~* '(https?:|www\.)'; end if;
  execute 'select public.comm_has_link($1)' into r using p;
  return coalesce(r, false);
end $$;
-- Видит ли p_uid статью
create or replace function public.forum_can_see(p_status text, p_author uuid, p_age int, p_realm text, p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (p_uid is not null and p_author = p_uid) or public.forum_is_mod(p_uid)
    or (p_status = 'published' and p_age <= public.forum_cap(p_uid) and (p_realm = 'kids' or public.forum_adult_ok(p_uid)))
$$;
grant execute on function public.forum_can_see(text, uuid, int, text, uuid) to anon, authenticated;
-- Новичок: меньше premod_n опубликованных проверенных статей или аккаунту меньше new_hours часов
create or replace function public.forum_is_new(p_uid uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare c jsonb := public.forum_cfg(); n int; born timestamptz;
begin
  if public.forum_is_mod(p_uid) then return false; end if;
  select count(*) into n from public.forum_threads where author_id = p_uid and status = 'published' and trusted;
  if n < coalesce((c->>'premod_n')::int, 2) then return true; end if;
  begin execute 'select created_at from auth.users where id = $1' into born using p_uid; exception when others then born := null; end;
  return born is not null and born > now() - make_interval(hours => coalesce((c->>'new_hours')::int, 72));
end $$;
-- Частота: true — можно (и засчитано), false — лимит
create or replace function public.forum_rl(p_uid uuid, p_k text, p_hour boolean, p_max int) returns boolean
language plpgsql security definer set search_path = public as $$
declare w timestamptz := date_trunc(case when p_hour then 'hour' else 'day' end, now()); v int;
begin
  if p_max is null or p_max <= 0 then return true; end if;
  insert into public.forum_rate (user_id, k, win, n) values (p_uid, p_k, w, 1)
    on conflict (user_id, k, win) do update set n = public.forum_rate.n + 1 returning n into v;
  if v > p_max then return false; end if;
  if random() < 0.01 then delete from public.forum_rate where win < now() - interval '3 days'; end if;
  return true;
end $$;
-- Короткий адрес статьи: /forum/<id>-<slug> (латиница из кириллицы)
create or replace function public.forum_slug(p text) returns text language sql immutable as $$
  select left(trim(both '-' from regexp_replace(
    replace(replace(replace(replace(replace(replace(replace(translate(lower(coalesce(p, '')),
      'абвгдезийклмнопрстуфхцыэё', 'abvgdeziiklmnoprstufhcyee'), 'ж', 'zh'), 'ч', 'ch'), 'ш', 'sh'), 'щ', 'sch'), 'ю', 'yu'), 'я', 'ya'), 'ь', ''),
    '[^a-z0-9]+', '-', 'g')), 60)
$$;
grant execute on function public.forum_slug(text) to anon, authenticated;

-- ═══ 4. Проверка статьи (единственный источник правды; копия для подсказок — api/_lib/forum-blocks.js, тест сверяет) ═══
-- p_doc: { title, blocks: [...], tags: [...], cover, source_url, source_title, age }
-- Блоки:
--   {t:'p', r:[{x:'текст', b:1?, i:1?, h:'https://…'?}]}   {t:'h', x, l:2|3}   {t:'list', o:0|1, items:['…']}   {t:'quote', x, by?}
--   {t:'img', src:'<uid>/<имя>.webp|jpg', w?, h?, cap?}   {t:'video', p:'yt'|'vk'|'rt'|'tw', id, cap?}
--   {t:'file', key:'<uid>/<имя>.<ext>', name, size, mime}   {t:'hr'}
-- Ответ: { ok, reason?, at? (номер блока), blocks (чистые), text, excerpt, chars, links, media, tags, cover, src, src_title, age, title }
create or replace function public.forum_https(u text) returns boolean language sql immutable as $$
  select u is not null and char_length(u) between 12 and 500 and u ~ '^https://[a-zA-Z0-9а-яА-ЯёЁ.-]+\.[a-zA-Zа-яА-ЯёЁ]{2,}(:[0-9]{2,5})?([/?#][^[:space:]<>"''`\\]*)?$'
    and u !~ '^https://[^/]*@'
$$;
grant execute on function public.forum_https(text) to anon, authenticated;
create or replace function public.forum_video_ok(p text, id text) returns boolean language sql immutable as $$
  select case p when 'yt' then id ~ '^[A-Za-z0-9_-]{11}$' when 'vk' then id ~ '^-?[0-9]{1,12}_[0-9]{1,12}$'
    when 'rt' then id ~ '^[0-9a-f]{32}$' when 'tw' then id ~ '^(v[0-9]{5,12}|c:[A-Za-z0-9_-]{4,100})$' else false end
$$;
grant execute on function public.forum_video_ok(text, text) to anon, authenticated;
create or replace function public.forum_str(v jsonb) returns text language sql immutable as $$
  select case when jsonb_typeof(v) = 'string' then regexp_replace(replace(v #>> '{}', chr(13), ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g') else null end
$$;
create or replace function public.forum_media_ok(p_key text, p_uid uuid, p_kind text, p_cfg jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare ext text; sz bigint; mt text; found_ boolean := false;
begin
  if not coalesce((p_cfg->>'media')::boolean, false) then return 'media_off'; end if;
  if p_key is null or p_key !~ ('^' || p_uid::text || '/[a-z0-9]{16,40}\.[a-z0-9]{2,5}$') then return 'media_key'; end if;
  ext := substring(p_key from '\.([a-z0-9]+)$');
  if p_kind = 'img' and ext not in ('webp', 'jpg') then return 'media_type'; end if;
  if p_kind = 'file' and not (p_cfg->'files') ? ext then return 'media_type'; end if;
  if to_regclass('storage.objects') is not null then
    execute 'select true, coalesce((metadata->>''size'')::bigint, 0), coalesce(metadata->>''mimetype'', '''') from storage.objects where bucket_id = ''forum-media'' and name = $1'
      into found_, sz, mt using p_key;
    if not coalesce(found_, false) then return 'media_missing'; end if;
    if p_kind = 'img' and sz > coalesce((p_cfg->>'img_kb')::int, 900) * 1024 then return 'media_size'; end if;
    if p_kind = 'file' and sz > coalesce((p_cfg->>'file_mb')::int, 10) * 1048576 then return 'media_size'; end if;
  end if;
  return '';
end $$;

create or replace function public.forum_check(p_doc jsonb, p_uid uuid, p_publish boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb := public.forum_cfg(); b jsonb; r jsonb; nb jsonb; runs jsonb; out_ jsonb := '[]'::jsonb; i int := 0; k int;
  t text; x text; s text; txt text := ''; links int := 0; media int := 0; imgs int := 0; vids int := 0; files int := 0; chars int := 0;
  title text; tags text[] := '{}'; tg text; cover text; src text; srct text; age int; items jsonb; m text;
begin
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'doc'); end if;
  if char_length(p_doc::text) > 200000 then return jsonb_build_object('ok', false, 'reason', 'too_big'); end if;
  title := btrim(coalesce(public.forum_str(p_doc->'title'), ''));
  if char_length(title) > 140 then return jsonb_build_object('ok', false, 'reason', 'title_long'); end if;
  if p_publish and char_length(title) < 5 then return jsonb_build_object('ok', false, 'reason', 'title_short'); end if;
  if public.forum_bad(title) then return jsonb_build_object('ok', false, 'reason', 'bad', 'at', -1); end if;
  if jsonb_typeof(coalesce(p_doc->'blocks', '[]'::jsonb)) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'blocks'); end if;
  if jsonb_array_length(coalesce(p_doc->'blocks', '[]'::jsonb)) > 60 then return jsonb_build_object('ok', false, 'reason', 'blocks_many'); end if;
  for b in select value from jsonb_array_elements(coalesce(p_doc->'blocks', '[]'::jsonb)) loop
    if jsonb_typeof(b) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'block', 'at', i); end if;
    t := b->>'t';
    if t = 'p' then
      runs := '[]'::jsonb; k := 0;
      if jsonb_typeof(b->'r') <> 'array' or jsonb_array_length(b->'r') > 200 then return jsonb_build_object('ok', false, 'reason', 'block', 'at', i); end if;
      for r in select value from jsonb_array_elements(b->'r') loop
        x := public.forum_str(r->'x');
        if x is null or x = '' then continue; end if;
        k := k + char_length(x);
        nb := jsonb_build_object('x', x);
        if (r->>'b') in ('1', 'true') then nb := nb || '{"b":1}'; end if;
        if (r->>'i') in ('1', 'true') then nb := nb || '{"i":1}'; end if;
        if r ? 'h' and coalesce(r->>'h', '') <> '' then
          if not public.forum_https(r->>'h') then return jsonb_build_object('ok', false, 'reason', 'link', 'at', i); end if;
          nb := nb || jsonb_build_object('h', r->>'h'); links := links + 1;
        end if;
        runs := runs || jsonb_build_array(nb); txt := txt || x;
      end loop;
      if k > 5000 then return jsonb_build_object('ok', false, 'reason', 'text_long', 'at', i); end if;
      if jsonb_array_length(runs) = 0 then i := i + 1; continue; end if;   -- пустой абзац — выбросить
      chars := chars + k; txt := txt || chr(10);
      out_ := out_ || jsonb_build_array(jsonb_build_object('t', 'p', 'r', runs));
    elsif t = 'h' then
      x := btrim(coalesce(public.forum_str(b->'x'), ''));
      if x = '' then i := i + 1; continue; end if;
      if char_length(x) > 200 then return jsonb_build_object('ok', false, 'reason', 'text_long', 'at', i); end if;
      chars := chars + char_length(x); txt := txt || x || chr(10);
      out_ := out_ || jsonb_build_array(jsonb_build_object('t', 'h', 'x', x, 'l', case when (b->>'l') = '3' then 3 else 2 end));
    elsif t = 'list' then
      if jsonb_typeof(b->'items') <> 'array' or jsonb_array_length(b->'items') > 30 then return jsonb_build_object('ok', false, 'reason', 'block', 'at', i); end if;
      items := '[]'::jsonb;
      for r in select value from jsonb_array_elements(b->'items') loop
        x := btrim(coalesce(public.forum_str(r), ''));
        if x = '' then continue; end if;
        if char_length(x) > 500 then return jsonb_build_object('ok', false, 'reason', 'text_long', 'at', i); end if;
        items := items || to_jsonb(x); chars := chars + char_length(x); txt := txt || '• ' || x || chr(10);
      end loop;
      if jsonb_array_length(items) = 0 then i := i + 1; continue; end if;
      out_ := out_ || jsonb_build_array(jsonb_build_object('t', 'list', 'o', case when (b->>'o') in ('1', 'true') then 1 else 0 end, 'items', items));
    elsif t = 'quote' then
      x := btrim(coalesce(public.forum_str(b->'x'), '')); s := btrim(coalesce(public.forum_str(b->'by'), ''));
      if x = '' then i := i + 1; continue; end if;
      if char_length(x) > 2000 or char_length(s) > 120 then return jsonb_build_object('ok', false, 'reason', 'text_long', 'at', i); end if;
      chars := chars + char_length(x); txt := txt || '«' || x || '»' || chr(10);
      nb := jsonb_build_object('t', 'quote', 'x', x); if s <> '' then nb := nb || jsonb_build_object('by', s); end if;
      out_ := out_ || jsonb_build_array(nb);
    elsif t = 'img' then
      m := public.forum_media_ok(b->>'src', p_uid, 'img', c);
      if m <> '' then return jsonb_build_object('ok', false, 'reason', m, 'at', i); end if;
      s := btrim(coalesce(public.forum_str(b->'cap'), ''));
      if char_length(s) > 300 then return jsonb_build_object('ok', false, 'reason', 'text_long', 'at', i); end if;
      imgs := imgs + 1; media := media + 1;
      nb := jsonb_build_object('t', 'img', 'src', b->>'src');
      if (b->>'w') ~ '^[0-9]{1,4}$' and (b->>'h') ~ '^[0-9]{1,4}$' then nb := nb || jsonb_build_object('w', (b->>'w')::int, 'h', (b->>'h')::int); end if;
      if s <> '' then nb := nb || jsonb_build_object('cap', s); txt := txt || s || chr(10); end if;
      out_ := out_ || jsonb_build_array(nb);
    elsif t = 'video' then
      if not public.forum_video_ok(b->>'p', b->>'id') then return jsonb_build_object('ok', false, 'reason', 'video', 'at', i); end if;
      s := btrim(coalesce(public.forum_str(b->'cap'), ''));
      if char_length(s) > 300 then return jsonb_build_object('ok', false, 'reason', 'text_long', 'at', i); end if;
      vids := vids + 1;
      nb := jsonb_build_object('t', 'video', 'p', b->>'p', 'id', b->>'id'); if s <> '' then nb := nb || jsonb_build_object('cap', s); end if;
      out_ := out_ || jsonb_build_array(nb);
    elsif t = 'file' then
      m := public.forum_media_ok(b->>'key', p_uid, 'file', c);
      if m <> '' then return jsonb_build_object('ok', false, 'reason', m, 'at', i); end if;
      s := btrim(coalesce(public.forum_str(b->'name'), ''));
      if s = '' or char_length(s) > 120 or s ~ '[/\\<>]' then return jsonb_build_object('ok', false, 'reason', 'file_name', 'at', i); end if;
      files := files + 1; media := media + 1;
      out_ := out_ || jsonb_build_array(jsonb_build_object('t', 'file', 'key', b->>'key', 'name', s,
        'size', case when (b->>'size') ~ '^[0-9]{1,10}$' then (b->>'size')::bigint else 0 end,
        'mime', left(coalesce(b->>'mime', ''), 80)));
    elsif t = 'hr' then
      out_ := out_ || '[{"t":"hr"}]'::jsonb;
    else
      return jsonb_build_object('ok', false, 'reason', 'block_type', 'at', i);
    end if;
    i := i + 1;
  end loop;
  if imgs > 20 or vids > 10 or files > 5 then return jsonb_build_object('ok', false, 'reason', 'media_many'); end if;
  if chars > 40000 then return jsonb_build_object('ok', false, 'reason', 'too_long'); end if;
  if public.forum_bad(txt) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if p_publish and chars < 20 and imgs + vids = 0 then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  -- метки: 0–5, буквы / цифры / дефис, 2–24 знака, в нижнем регистре
  if p_doc ? 'tags' and jsonb_typeof(p_doc->'tags') = 'array' then
    for r in select value from jsonb_array_elements(p_doc->'tags') loop
      tg := lower(btrim(coalesce(public.forum_str(r), ''), ' #'));
      if tg = '' then continue; end if;
      if tg !~ '^[a-zа-яё0-9][a-zа-яё0-9-]{1,23}$' then return jsonb_build_object('ok', false, 'reason', 'tag'); end if;
      if public.forum_bad(tg) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
      if not tg = any(tags) then tags := tags || tg; end if;
    end loop;
    if cardinality(tags) > 5 then return jsonb_build_object('ok', false, 'reason', 'tags_many'); end if;
  end if;
  -- обложка — одна из своих картинок этой статьи
  cover := nullif(btrim(coalesce(p_doc->>'cover', '')), '');
  if cover is not null and not exists (select 1 from jsonb_array_elements(out_) e where e.value->>'t' = 'img' and e.value->>'src' = cover) then cover := null; end if;
  if cover is null then select e.value->>'src' into cover from jsonb_array_elements(out_) e where e.value->>'t' = 'img' limit 1; end if;
  -- источник
  src := nullif(btrim(coalesce(p_doc->>'source_url', '')), '');
  srct := btrim(coalesce(public.forum_str(p_doc->'source_title'), ''));
  if src is not null and not public.forum_https(src) then return jsonb_build_object('ok', false, 'reason', 'source'); end if;
  if char_length(srct) > 140 then return jsonb_build_object('ok', false, 'reason', 'source'); end if;
  if public.forum_bad(srct) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if src is not null then links := links + 1; end if;
  -- возраст: автор — не выше своего и не выше 16+ (18+ — только модератор)
  age := case when (p_doc->>'age') ~ '^(0|6|12|16|18)$' then (p_doc->>'age')::int else 12 end;
  if age = 18 and not public.forum_is_mod(p_uid) then age := 16; end if;
  if age > public.forum_cap(p_uid) and not public.forum_is_mod(p_uid) then age := greatest(0, public.forum_cap(p_uid)); end if;
  return jsonb_build_object('ok', true, 'title', title, 'blocks', out_, 'text', txt, 'chars', chars, 'links', links, 'media', media,
    'excerpt', left(regexp_replace(btrim(txt), '\s+', ' ', 'g'), 300), 'tags', to_jsonb(tags), 'cover', cover,
    'src', src, 'src_title', nullif(srct, ''), 'age', age, 'videos', vids);
end $$;
grant execute on function public.forum_check(jsonb, uuid, boolean) to authenticated;   -- подсказки редактору; пишет только forum_save

-- ═══ 5. Охрана прямых записей (старый клиент) и счётчики ═══
-- Прямая вставка темы (FORUM2 = false): статья — «как раньше», но статус решает сервер (новичок — на проверку), новые поля —
-- значения по умолчанию; правка напрямую не меняет статус, блоки, рейтинг и т. п. Функции ниже (security definer) не задеваются.
-- Помощники охраны (security definer: считают лимиты и предпроверку только для себя — auth.uid())
-- Новая тема напрямую → статус ('pending' — новичок) или исключение с понятным текстом
create or replace function public.forum_legacy_thread() returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Войди, чтобы писать на форуме'; end if;
  if public.forum_u9(uid) and not public.forum_is_mod(uid) then raise exception '👀 Писать на форуме можно с 9 лет — пока можно читать'; end if;
  if public.forum_muted(uid) then raise exception 'Тебя заглушили в чате — на форуме пока тоже нельзя'; end if;
  if not public.forum_rl(uid, 'article', false, coalesce((public.forum_cfg()->>'day_articles')::int, 5)) then raise exception 'На сегодня хватит новых тем — завтра снова можно'; end if;
  return case when public.forum_is_new(uid) then 'pending' else 'published' end;
end $$;
-- Новый пост напрямую → true, если это тело статьи (первый пост автора в его теме без тела), или исключение
create or replace function public.forum_legacy_post(p_thread bigint, p_body text) returns boolean language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t public.forum_threads%rowtype;
begin
  if uid is null then raise exception 'Войди, чтобы писать на форуме'; end if;
  if public.forum_u9(uid) and not public.forum_is_mod(uid) then raise exception '👀 Писать на форуме можно с 9 лет — пока можно читать'; end if;
  if public.forum_muted(uid) then raise exception 'Тебя заглушили в чате — на форуме пока тоже нельзя'; end if;
  select * into t from public.forum_threads where id = p_thread;
  if not found or not (t.status = 'published' or t.author_id = uid) then raise exception 'Тема ещё на проверке или скрыта'; end if;
  if t.author_id = uid and t.blocks is null and not exists (select 1 from public.forum_posts p where p.thread_id = p_thread and p.is_body) then return true; end if;
  if public.forum_link_in(p_body) and public.forum_is_new(uid) then raise exception 'Ссылки в ответах — после первых проверенных статей'; end if;
  if not public.forum_rl(uid, 'comment', false, coalesce((public.forum_cfg()->>'day_comments')::int, 80)) then raise exception 'На сегодня хватит ответов — завтра снова можно'; end if;
  return false;
end $$;
grant execute on function public.forum_legacy_thread() to authenticated;
grant execute on function public.forum_legacy_post(bigint, text) to authenticated;

create or replace function public.forum2_threads_guard() returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if public.forum_bad(new.title) then raise exception 'В заголовке есть грубые слова'; end if;
    new.status := public.forum_legacy_thread();
    new.published_at := case when new.status = 'published' then now() end;
    new.trusted := new.status = 'published';
    new.blocks := null; new.cover := null; new.tags := '{}'; new.source_url := null; new.source_title := null; new.age_min := 12; new.realm := 'kids';
    new.rating := 0; new.votes_up := 0; new.votes_down := 0; new.comments := 0; new.reports_open := 0; new.mod_note := ''; new.pinged_at := null;
    new.excerpt := ''; new.chars := 0; new.edited_at := null; new.updated_at := now();
  else
    new.blocks := old.blocks; new.status := old.status; new.cover := old.cover; new.tags := old.tags; new.source_url := old.source_url;
    new.source_title := old.source_title; new.age_min := old.age_min; new.realm := old.realm; new.rating := old.rating;
    new.votes_up := old.votes_up; new.votes_down := old.votes_down; new.comments := old.comments; new.reports_open := old.reports_open;
    new.published_at := old.published_at; new.mod_note := old.mod_note; new.trusted := old.trusted; new.pinged_at := old.pinged_at;
    new.excerpt := old.excerpt; new.chars := old.chars;
    if new.title is distinct from old.title then
      if public.forum_bad(new.title) then raise exception 'В заголовке есть грубые слова'; end if;
      new.edited_at := now();
    else new.edited_at := old.edited_at; end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists forum2_threads_guard on public.forum_threads;
create trigger forum2_threads_guard before insert or update on public.forum_threads
  for each row execute function public.forum2_threads_guard();

create or replace function public.forum2_posts_guard() returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if char_length(coalesce(new.body, '')) > 4000 then raise exception 'Слишком длинный ответ'; end if;
    if public.forum_bad(new.body) then raise exception 'В ответе есть грубые слова'; end if;
    new.parent_id := null; new.depth := 0; new.deleted := false; new.edited_at := null;
    new.is_body := public.forum_legacy_post(new.thread_id, new.body);
  else
    new.parent_id := old.parent_id; new.is_body := old.is_body; new.deleted := old.deleted; new.depth := old.depth;
    if new.body is distinct from old.body and public.forum_bad(new.body) then raise exception 'В ответе есть грубые слова'; end if;
  end if;
  return new;
end $$;
drop trigger if exists forum2_posts_guard on public.forum_posts;
create trigger forum2_posts_guard before insert or update on public.forum_posts
  for each row execute function public.forum2_posts_guard();

-- Тело статьи из старого поста (вставка напрямую) и счётчик комментариев
create or replace function public.forum2_posts_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.is_body then
      update public.forum_threads set blocks = jsonb_build_array(jsonb_build_object('t', 'p', 'r', jsonb_build_array(jsonb_build_object('x', left(new.body, 5000))))),
        excerpt = left(regexp_replace(btrim(new.body), '\s+', ' ', 'g'), 300), chars = char_length(new.body)
        where id = new.thread_id and blocks is null;
    else
      update public.forum_threads set comments = comments + 1 where id = new.thread_id;
    end if;
  elsif tg_op = 'DELETE' then
    if not old.is_body and not old.deleted then update public.forum_threads set comments = greatest(0, comments - 1) where id = old.thread_id; end if;
  elsif tg_op = 'UPDATE' then
    if new.is_body and new.body is distinct from old.body then
      update public.forum_threads set blocks = jsonb_build_array(jsonb_build_object('t', 'p', 'r', jsonb_build_array(jsonb_build_object('x', left(new.body, 5000))))),
        excerpt = left(regexp_replace(btrim(new.body), '\s+', ' ', 'g'), 300), chars = char_length(new.body), edited_at = now()
        where id = new.thread_id and jsonb_array_length(coalesce(blocks, '[]')) <= 1 and coalesce(blocks->0->>'t', 'p') = 'p'
          and current_setting('d37.forum_save', true) is distinct from '1';
    end if;
    if not new.is_body and new.deleted and not old.deleted then update public.forum_threads set comments = greatest(0, comments - 1) where id = new.thread_id; end if;
  end if;
  return null;
end $$;
drop trigger if exists forum2_posts_after on public.forum_posts;
create trigger forum2_posts_after after insert or update or delete on public.forum_posts
  for each row execute function public.forum2_posts_after();

-- Перенос старых тем: первый пост автора — тело статьи, остальное — комментарии (один раз; повторный запуск ничего не меняет)
do $$
declare r record;
begin
  for r in select t.id, t.author_id from public.forum_threads t where t.blocks is null loop
    update public.forum_posts p set is_body = true
      where p.id = (select p2.id from public.forum_posts p2 where p2.thread_id = r.id order by p2.created_at, p2.id limit 1)
        and not exists (select 1 from public.forum_posts p3 where p3.thread_id = r.id and p3.is_body);
    update public.forum_threads t set
      blocks = coalesce((select jsonb_build_array(jsonb_build_object('t', 'p', 'r', jsonb_build_array(jsonb_build_object('x', left(p.body, 5000)))))
        from public.forum_posts p where p.thread_id = r.id and p.is_body limit 1), '[]'::jsonb),
      excerpt = coalesce((select left(regexp_replace(btrim(p.body), '\s+', ' ', 'g'), 300) from public.forum_posts p where p.thread_id = r.id and p.is_body limit 1), ''),
      chars = coalesce((select char_length(p.body) from public.forum_posts p where p.thread_id = r.id and p.is_body limit 1), 0),
      comments = (select count(*) from public.forum_posts p where p.thread_id = r.id and not p.is_body and not p.deleted),
      published_at = coalesce(t.published_at, t.created_at), trusted = true
      where t.id = r.id;
  end loop;
end $$;

-- ═══ 6. RLS: скрытое и «на проверке» — только автор и модераторы ═══
drop policy if exists "Темы читают все" on public.forum_threads;
drop policy if exists "forum: статьи по статусу и возрасту" on public.forum_threads;
create policy "forum: статьи по статусу и возрасту" on public.forum_threads for select
  using (public.forum_can_see(status, author_id, age_min, realm, auth.uid()));
drop policy if exists "Посты читают все" on public.forum_posts;
drop policy if exists "forum: комментарии видимых статей" on public.forum_posts;
create policy "forum: комментарии видимых статей" on public.forum_posts for select
  using (exists (select 1 from public.forum_threads t where t.id = thread_id));   -- сама строка темы — под RLS выше

-- ═══ 7. XP за статью — только после публикации, один раз на статью (не за черновики и не за перепубликацию) ═══
drop trigger if exists xp_on_forum_thread on public.forum_threads;
create or replace function public.forum_xp_publish() returns trigger language plpgsql security definer set search_path = public as $$
declare amt int := 8; cap int := 3;
begin
  if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then return null; end if;
  -- коротыши — без XP (старый клиент: тело приходит отдельным постом — как раньше, лимит в день)
  if new.blocks is not null and new.chars < coalesce((public.forum_cfg()->>'min_chars_xp')::int, 300) then return null; end if;
  begin
    if exists (select 1 from public.xp_ledger where user_id = new.author_id and source = 'forum_thread' and ref = new.id::text) then return null; end if;
    if to_regprocedure('public.xp_rule(text)') is not null then
      execute 'select public.xp_rule($1), public.xp_rule($2)' into amt, cap using 'forum_thread', 'forum_thread_day';
    end if;
    perform public.xp_award(new.author_id, 'forum_thread', new.id::text, coalesce(amt, 8), coalesce(cap, 3));
  exception when others then null; end;
  return null;
end $$;
drop trigger if exists forum_xp_publish on public.forum_threads;
create trigger forum_xp_publish after insert or update of status on public.forum_threads
  for each row execute function public.forum_xp_publish();
-- комментарий: XP как раньше (xp_on_forum_post), но не за тело статьи
create or replace function public.xp_on_forum_post() returns trigger language plpgsql security definer set search_path = public as $$
declare amt int := 2; cap int := 10;
begin
  if new.is_body then return null; end if;
  begin
    if to_regprocedure('public.xp_rule(text)') is not null then
      execute 'select public.xp_rule($1), public.xp_rule($2)' into amt, cap using 'forum_post', 'forum_post_day';
    end if;
    perform public.xp_award(new.author_id, 'forum_post', new.id::text, coalesce(amt, 2), coalesce(cap, 10));
  exception when others then null; end;
  return null;
end $$;

-- ═══ 8. Сохранить / опубликовать статью ═══
-- p_id null — новая; p_publish false — черновик (проверка мягче: заголовок может быть пустым). Ответ: { ok, id, status, slug, reason, at }
create or replace function public.forum_save(p_id bigint, p_doc jsonb, p_publish boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c jsonb := public.forum_cfg(); v jsonb; th public.forum_threads%rowtype; st text; nid bigint;
  is_new boolean; mod boolean;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  mod := public.forum_is_mod(uid);
  if public.forum_u9(uid) and not mod then return jsonb_build_object('ok', false, 'reason', 'u9'); end if;
  if public.forum_muted(uid) then return jsonb_build_object('ok', false, 'reason', 'muted'); end if;
  if not public.forum_rl(uid, 'save', true, coalesce((c->>'hour_saves')::int, 240)) then return jsonb_build_object('ok', false, 'reason', 'too_fast'); end if;
  if p_id is not null then
    select * into th from public.forum_threads where id = p_id for update;
    if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if th.author_id <> uid then return jsonb_build_object('ok', false, 'reason', 'not_yours'); end if;
    if th.status = 'hidden' then return jsonb_build_object('ok', false, 'reason', 'hidden'); end if;
    if th.locked and not mod then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  end if;
  v := public.forum_check(p_doc, uid, coalesce(p_publish, false));
  if not (v->>'ok')::boolean then return v; end if;
  is_new := public.forum_is_new(uid);
  -- статус: черновик — как был (у опубликованной правка сразу видна); публикация — новичок или ссылки / файлы новичка — на проверку
  if not coalesce(p_publish, false) then
    st := case when p_id is null then 'draft' else th.status end;
    if st = 'published' then   -- правка опубликованной без «опубликовать» — тоже проверяем как публикацию
      v := public.forum_check(p_doc, uid, true);
      if not (v->>'ok')::boolean then return v; end if;
      if is_new and ((v->>'links')::int > 0 or (v->>'media')::int > 0) then st := 'pending'; end if;
    end if;
  else
    if p_id is null or th.status = 'draft' then
      if not public.forum_rl(uid, 'article', false, coalesce((c->>'day_articles')::int, 5)) then return jsonb_build_object('ok', false, 'reason', 'day_limit'); end if;
    end if;
    st := case when mod then 'published' when is_new then 'pending' else 'published' end;
    if p_id is not null and th.status = 'pending' then st := 'pending'; end if;
  end if;
  perform set_config('d37.forum_save', '1', true);
  if p_id is null then
    insert into public.forum_threads (author_id, title, blocks, status, cover, tags, source_url, source_title, excerpt, chars, age_min, realm,
        published_at, trusted, updated_at)
      values (uid, v->>'title', v->'blocks', st, v->>'cover', array(select jsonb_array_elements_text(v->'tags')), v->>'src', v->>'src_title',
        v->>'excerpt', (v->>'chars')::int, (v->>'age')::int, 'kids', case when st = 'published' then now() end, st = 'published', now())
      returning id into nid;
    insert into public.forum_posts (thread_id, author_id, body, is_body) values (nid, uid, left(v->>'text', 4000), true);
  else
    nid := p_id;
    update public.forum_threads set title = v->>'title', blocks = v->'blocks', status = st, cover = v->>'cover',
        tags = array(select jsonb_array_elements_text(v->'tags')), source_url = v->>'src', source_title = v->>'src_title',
        excerpt = v->>'excerpt', chars = (v->>'chars')::int, age_min = (v->>'age')::int,
        published_at = case when st = 'published' then coalesce(published_at, now()) else published_at end,
        trusted = case when st = 'published' and th.status <> 'published' then true else trusted end,
        edited_at = case when th.status = 'published' then now() else edited_at end, updated_at = now()
      where id = nid;
    update public.forum_posts set body = left(v->>'text', 4000), edited_at = now() where thread_id = nid and is_body;
    if not found then insert into public.forum_posts (thread_id, author_id, body, is_body) values (nid, uid, left(v->>'text', 4000), true); end if;
  end if;
  perform set_config('d37.forum_save', '', true);
  return jsonb_build_object('ok', true, 'id', nid, 'status', st, 'slug', public.forum_slug(v->>'title'), 'at', now());
end $$;
grant execute on function public.forum_save(bigint, jsonb, boolean) to authenticated;

create or replace function public.forum_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); a uuid;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select author_id into a from public.forum_threads where id = p_id;
  if a is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if a <> uid and not public.forum_is_mod(uid) then return jsonb_build_object('ok', false, 'reason', 'not_yours'); end if;
  delete from public.forum_threads where id = p_id;
  if a <> uid then insert into public.forum_mod_log (mod_id, action, kind, target) values (uid, 'delete', 'article', p_id); end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.forum_delete(bigint) to authenticated;

-- ═══ 9. Чтение: лента, статья, комментарии ═══
create or replace function public.forum_card(t public.forum_threads, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', t.id, 'title', t.title, 'slug', public.forum_slug(t.title), 'excerpt', t.excerpt, 'cover', t.cover, 'tags', to_jsonb(t.tags),
    'rating', t.rating, 'comments', t.comments, 'status', t.status, 'age', t.age_min, 'pinned', t.pinned, 'locked', t.locked,
    'at', coalesce(t.published_at, t.updated_at, t.created_at), 'edited_at', t.edited_at, 'author_id', t.author_id,
    'nick', (select pr.nick from public.profiles pr where pr.id = t.author_id), 'role', (select pr.role from public.profiles pr where pr.id = t.author_id),
    'video', (select e.value from jsonb_array_elements(coalesce(t.blocks, '[]')) e where e.value->>'t' = 'video' limit 1),
    'my', case when p_uid is null then 0 else coalesce((select v.v from public.forum_votes v where v.thread_id = t.id and v.user_id = p_uid), 0) end,
    'bm', p_uid is not null and exists (select 1 from public.forum_bookmarks b where b.thread_id = t.id and b.user_id = p_uid),
    'ads', t.status = 'published' and t.trusted and t.reports_open = 0 and t.age_min <= 12)
$$;
-- p_sort: new | hot | best | best_week | best_month | follow | bookmarks | mine | drafts; p_tag; p_author; p_offset
create or replace function public.forum_feed(p_sort text default 'new', p_tag text default null, p_author uuid default null, p_offset int default 0, p_limit int default 20)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); cap int := public.forum_cap(auth.uid()); lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
  off int := least(greatest(coalesce(p_offset, 0), 0), 1000); tg text := nullif(lower(btrim(coalesce(p_tag, ''), ' #')), ''); res jsonb;
begin
  if p_sort in ('mine', 'drafts') then
    if uid is null then return '[]'::jsonb; end if;
    select coalesce(jsonb_agg(public.forum_card(x.r, uid) order by x.ord desc), '[]') into res from (
      select t as r, t.updated_at as ord from public.forum_threads t where t.author_id = uid and (p_sort = 'mine' or t.status = 'draft')
      order by t.updated_at desc offset off limit lim) x;
    return res;
  end if;
  if p_sort = 'bookmarks' then
    if uid is null then return '[]'::jsonb; end if;
    select coalesce(jsonb_agg(public.forum_card(x.r, uid) order by x.ord desc), '[]') into res from (
      select t as r, b.created_at as ord from public.forum_bookmarks b join public.forum_threads t on t.id = b.thread_id
      where b.user_id = uid and public.forum_can_see(t.status, t.author_id, t.age_min, t.realm, uid)
      order by b.created_at desc offset off limit lim) x;
    return res;
  end if;
  select coalesce(jsonb_agg(public.forum_card(x.r, uid) order by x.ord desc), '[]') into res from (
    select t as r, case
        when p_sort = 'hot' then (t.rating + 1 + least(t.comments, 50) * 0.3) / power(greatest(extract(epoch from (now() - coalesce(t.published_at, t.created_at))), 0) / 3600 + 2, 1.5)
        when p_sort like 'best%' then t.rating::float8 * 1e10 + extract(epoch from coalesce(t.published_at, t.created_at))
        else extract(epoch from coalesce(t.published_at, t.created_at)) end
        + case when t.pinned and p_sort = 'new' and tg is null and p_author is null then 1e12 else 0 end as ord
    from public.forum_threads t
    where t.status = 'published' and t.age_min <= cap and (t.realm = 'kids' or public.forum_adult_ok(uid))
      and (tg is null or t.tags @> array[tg])
      and (p_author is null or t.author_id = p_author)
      and (p_sort <> 'follow' or exists (select 1 from public.forum_follows f where f.follower = uid and f.author = t.author_id))
      and (p_sort <> 'hot' or t.published_at > now() - interval '14 days')
      and (p_sort <> 'best_week' or t.published_at > now() - interval '7 days')
      and (p_sort <> 'best_month' or t.published_at > now() - interval '30 days')
    order by ord desc offset off limit lim) x;
  return res;
end $$;
grant execute on function public.forum_feed(text, text, uuid, int, int) to anon, authenticated;

create or replace function public.forum_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); t public.forum_threads%rowtype; mod boolean := public.forum_is_mod(auth.uid());
begin
  select * into t from public.forum_threads where id = p_id;
  if not found or not public.forum_can_see(t.status, t.author_id, t.age_min, t.realm, uid) then
    return jsonb_build_object('ok', false, 'reason', case when found and t.status = 'published' then 'age' else 'not_found' end);
  end if;
  return public.forum_card(t, uid) || jsonb_build_object('ok', true, 'blocks', coalesce(t.blocks, '[]'), 'source_url', t.source_url,
    'source_title', t.source_title, 'votes_up', t.votes_up, 'votes_down', t.votes_down, 'created_at', t.created_at,
    'mine', uid is not null and uid = t.author_id, 'mod', mod,
    'reports', case when mod then t.reports_open end, 'mod_note', case when mod or uid = t.author_id then t.mod_note end,
    'follow', uid is not null and exists (select 1 from public.forum_follows f where f.follower = uid and f.author = t.author_id));
end $$;
grant execute on function public.forum_get(bigint) to anon, authenticated;

create or replace function public.forum_comments(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); t public.forum_threads%rowtype; res jsonb;
begin
  select * into t from public.forum_threads where id = p_id;
  if not found or not public.forum_can_see(t.status, t.author_id, t.age_min, t.realm, uid) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'parent', p.parent_id, 'author_id', p.author_id,
      'nick', pr.nick, 'role', pr.role, 'body', case when p.deleted then '' else p.body end, 'deleted', p.deleted,
      'at', p.created_at, 'edited_at', p.edited_at, 'mine', uid is not null and p.author_id = uid) order by p.created_at, p.id), '[]')
    into res
    from (select * from public.forum_posts where thread_id = p_id and not is_body order by created_at, id limit 1000) p
    left join public.profiles pr on pr.id = p.author_id;
  return res;
end $$;
grant execute on function public.forum_comments(bigint) to anon, authenticated;

-- ═══ 10. Комментарии ═══
create or replace function public.forum_comment(p_thread bigint, p_parent bigint, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c jsonb := public.forum_cfg(); t public.forum_threads%rowtype; b text := btrim(coalesce(p_body, ''));
  d int := 0; pa uuid; nid bigint; last_ timestamptz;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if public.forum_u9(uid) and not public.forum_is_mod(uid) then return jsonb_build_object('ok', false, 'reason', 'u9'); end if;
  if public.forum_muted(uid) then return jsonb_build_object('ok', false, 'reason', 'muted'); end if;
  select * into t from public.forum_threads where id = p_thread;
  if not found or not public.forum_can_see(t.status, t.author_id, t.age_min, t.realm, uid) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if t.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'not_published'); end if;
  if t.locked and not public.forum_is_mod(uid) then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  b := regexp_replace(replace(b, chr(13), ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g');
  if char_length(b) < 1 then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  if char_length(b) > 4000 then return jsonb_build_object('ok', false, 'reason', 'text_long'); end if;
  if public.forum_bad(b) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if public.forum_link_in(b) and public.forum_is_new(uid) then return jsonb_build_object('ok', false, 'reason', 'link_new'); end if;
  select max(created_at) into last_ from public.forum_posts where author_id = uid and not is_body and created_at > now() - make_interval(secs => coalesce((c->>'comment_gap_s')::int, 10));
  if last_ is not null then return jsonb_build_object('ok', false, 'reason', 'too_fast'); end if;
  if p_parent is not null then
    select depth + 1, author_id into d, pa from public.forum_posts where id = p_parent and thread_id = p_thread and not is_body;
    if d is null then return jsonb_build_object('ok', false, 'reason', 'parent'); end if;
    d := least(d, 6);
  end if;
  if not public.forum_rl(uid, 'comment', false, coalesce((c->>'day_comments')::int, 80)) then return jsonb_build_object('ok', false, 'reason', 'day_limit'); end if;
  insert into public.forum_posts (thread_id, author_id, body, parent_id, depth) values (p_thread, uid, b, p_parent, coalesce(d, 0)) returning id into nid;
  if to_regprocedure('public.comm_notify(uuid,text,uuid,text,text,text,text)') is not null then
    begin
      perform public.comm_notify(coalesce(pa, t.author_id), 'forum_reply', uid, case when pa is null then 'ответил(а) на твою статью' else 'ответил(а) тебе на форуме' end,
        left(t.title, 80), '/forum/' || t.id || '#c' || nid, 'fr:' || t.id || ':' || coalesce(pa, t.author_id));
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'id', nid);
end $$;
grant execute on function public.forum_comment(bigint, bigint, text) to authenticated;

create or replace function public.forum_comment_edit(p_id bigint, p_body text, p_delete boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p public.forum_posts%rowtype; b text := btrim(coalesce(p_body, '')); mod boolean := public.forum_is_mod(auth.uid());
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into p from public.forum_posts where id = p_id and not is_body;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p.author_id <> uid and not (mod and p_delete) then return jsonb_build_object('ok', false, 'reason', 'not_yours'); end if;
  if p_delete then
    update public.forum_posts set deleted = true, body = '' where id = p_id;
    if p.author_id <> uid then insert into public.forum_mod_log (mod_id, action, kind, target) values (uid, 'delete', 'comment', p_id); end if;
    return jsonb_build_object('ok', true);
  end if;
  if p.deleted then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p.created_at < now() - interval '24 hours' then return jsonb_build_object('ok', false, 'reason', 'too_old'); end if;
  b := regexp_replace(replace(b, chr(13), ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g');
  if char_length(b) < 1 or char_length(b) > 4000 then return jsonb_build_object('ok', false, 'reason', 'text_long'); end if;
  if public.forum_bad(b) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if public.forum_link_in(b) and public.forum_is_new(uid) then return jsonb_build_object('ok', false, 'reason', 'link_new'); end if;
  update public.forum_posts set body = b, edited_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.forum_comment_edit(bigint, text, boolean) to authenticated;

-- ═══ 11. Оценки, закладки, подписки ═══
create or replace function public.forum_vote(p_id bigint, p_v int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t public.forum_threads%rowtype; old_ int; v int := sign(coalesce(p_v, 0))::int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into t from public.forum_threads where id = p_id for update;
  if not found or t.status <> 'published' or not public.forum_can_see(t.status, t.author_id, t.age_min, t.realm, uid) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if t.author_id = uid then return jsonb_build_object('ok', false, 'reason', 'own'); end if;
  if not public.forum_rl(uid, 'vote', true, coalesce((public.forum_cfg()->>'hour_votes')::int, 120)) then return jsonb_build_object('ok', false, 'reason', 'too_fast'); end if;
  select fv.v into old_ from public.forum_votes fv where fv.thread_id = p_id and fv.user_id = uid;
  old_ := coalesce(old_, 0);
  if v = 0 then delete from public.forum_votes where thread_id = p_id and user_id = uid;
  else insert into public.forum_votes (thread_id, user_id, v) values (p_id, uid, v) on conflict (thread_id, user_id) do update set v = excluded.v, created_at = now(); end if;
  update public.forum_threads set
    votes_up = votes_up - (case when old_ = 1 then 1 else 0 end) + (case when v = 1 then 1 else 0 end),
    votes_down = votes_down - (case when old_ = -1 then 1 else 0 end) + (case when v = -1 then 1 else 0 end),
    rating = rating - old_ + v
    where id = p_id returning rating into old_;
  return jsonb_build_object('ok', true, 'rating', old_, 'my', v);
end $$;
grant execute on function public.forum_vote(bigint, int) to authenticated;

create or replace function public.forum_bookmark(p_id bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t public.forum_threads%rowtype;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not p_on then delete from public.forum_bookmarks where user_id = uid and thread_id = p_id; return jsonb_build_object('ok', true, 'bm', false); end if;
  select * into t from public.forum_threads where id = p_id;
  if not found or not public.forum_can_see(t.status, t.author_id, t.age_min, t.realm, uid) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if (select count(*) from public.forum_bookmarks where user_id = uid) >= 1000 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
  insert into public.forum_bookmarks (user_id, thread_id) values (uid, p_id) on conflict do nothing;
  return jsonb_build_object('ok', true, 'bm', true);
end $$;
grant execute on function public.forum_bookmark(bigint, boolean) to authenticated;

create or replace function public.forum_follow(p_author uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_author is null or p_author = uid then return jsonb_build_object('ok', false, 'reason', 'own'); end if;
  if not p_on then delete from public.forum_follows where follower = uid and author = p_author; return jsonb_build_object('ok', true, 'follow', false); end if;
  if not exists (select 1 from public.profiles where id = p_author) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if (select count(*) from public.forum_follows where follower = uid) >= 500 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
  insert into public.forum_follows (follower, author) values (uid, p_author) on conflict do nothing;
  return jsonb_build_object('ok', true, 'follow', true);
end $$;
grant execute on function public.forum_follow(uuid, boolean) to authenticated;

-- ═══ 12. Жалобы и модерация ═══
create or replace function public.forum_report(p_kind text, p_id bigint, p_why text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c jsonb := public.forum_cfg(); th bigint; n int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_kind = 'article' then
    select id into th from public.forum_threads t where id = p_id and public.forum_can_see(t.status, t.author_id, t.age_min, t.realm, uid);
  elsif p_kind = 'comment' then
    select p.thread_id into th from public.forum_posts p join public.forum_threads t on t.id = p.thread_id
      where p.id = p_id and not p.is_body and public.forum_can_see(t.status, t.author_id, t.age_min, t.realm, uid);
  else return jsonb_build_object('ok', false, 'reason', 'kind'); end if;
  if th is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if exists (select 1 from public.forum_reports where reporter = uid and kind = p_kind and target = p_id and status = 'new') then
    return jsonb_build_object('ok', true, 'dup', true); end if;
  if not public.forum_rl(uid, 'report', false, coalesce((c->>'day_reports')::int, 20)) then return jsonb_build_object('ok', false, 'reason', 'day_limit'); end if;
  insert into public.forum_reports (reporter, kind, target, thread_id, why) values (uid, p_kind, p_id, th, left(btrim(coalesce(p_why, '')), 300));
  if p_kind = 'article' then
    update public.forum_threads set reports_open = reports_open + 1 where id = p_id returning reports_open into n;
    -- много жалоб от разных людей — статья уходит на проверку сама (вернуть — модератор)
    if n >= coalesce((c->>'auto_hide')::int, 5) then
      update public.forum_threads set status = 'pending', mod_note = 'жалобы' where id = p_id and status = 'published';
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.forum_report(text, bigint, text) to authenticated;

-- Очередь: статьи на проверке, скрытые и жалобы (только модераторы)
create or replace function public.forum_mod_queue() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if not public.forum_is_mod(uid) then return jsonb_build_object('ok', false, 'reason', 'mod'); end if;
  return jsonb_build_object('ok', true,
    'pending', coalesce((select jsonb_agg(public.forum_card(x.r, uid) || jsonb_build_object('mod_note', (x.r).mod_note, 'reports', (x.r).reports_open) order by x.ord)
      from (select t as r, t.updated_at as ord from public.forum_threads t where t.status = 'pending' order by t.updated_at limit 100) x), '[]'),
    'hidden', coalesce((select jsonb_agg(public.forum_card(x.r, uid) || jsonb_build_object('mod_note', (x.r).mod_note) order by x.ord desc)
      from (select t as r, t.updated_at as ord from public.forum_threads t where t.status = 'hidden' order by t.updated_at desc limit 50) x), '[]'),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'target', r.target, 'thread_id', r.thread_id, 'why', r.why, 'at', r.created_at,
        'title', (select t.title from public.forum_threads t where t.id = r.thread_id),
        'text', case when r.kind = 'comment' then (select left(p.body, 300) from public.forum_posts p where p.id = r.target) end,
        'n', (select count(*) from public.forum_reports r2 where r2.kind = r.kind and r2.target = r.target and r2.status = 'new')) order by r.created_at)
      from (select distinct on (kind, target) * from public.forum_reports where status = 'new' order by kind, target, created_at limit 200) r), '[]'));
end $$;
grant execute on function public.forum_mod_queue() to authenticated;

-- p_action: approve | hide | restore | lock | unlock | pin | unpin | dismiss (жалобы) | delete_comment
create or replace function public.forum_mod(p_action text, p_id bigint, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n text := left(btrim(coalesce(p_note, '')), 200); a uuid;
begin
  if not public.forum_is_mod(uid) then return jsonb_build_object('ok', false, 'reason', 'mod'); end if;
  if p_action = 'approve' or p_action = 'restore' then
    update public.forum_threads set status = 'published', trusted = true, reports_open = 0, mod_note = n,
      published_at = coalesce(published_at, now()), updated_at = now() where id = p_id and status in ('pending', 'hidden') returning author_id into a;
    update public.forum_reports set status = 'done', by_mod = uid, closed_at = now() where kind = 'article' and target = p_id and status = 'new';
  elsif p_action = 'hide' then
    update public.forum_threads set status = 'hidden', mod_note = n, updated_at = now() where id = p_id and status <> 'draft' returning author_id into a;
    update public.forum_reports set status = 'done', by_mod = uid, closed_at = now() where kind = 'article' and target = p_id and status = 'new';
  elsif p_action in ('lock', 'unlock') then
    update public.forum_threads set locked = (p_action = 'lock') where id = p_id returning author_id into a;
  elsif p_action in ('pin', 'unpin') then
    update public.forum_threads set pinned = (p_action = 'pin') where id = p_id returning author_id into a;
  elsif p_action = 'dismiss' then
    update public.forum_reports set status = 'dismissed', by_mod = uid, closed_at = now() where id = p_id and status = 'new';
    update public.forum_reports r set status = 'dismissed', by_mod = uid, closed_at = now()
      from public.forum_reports x where x.id = p_id and r.kind = x.kind and r.target = x.target and r.status = 'new';
    update public.forum_threads t set reports_open = (select count(*) from public.forum_reports r where r.kind = 'article' and r.target = t.id and r.status = 'new')
      where t.id = (select target from public.forum_reports where id = p_id and kind = 'article');
    a := uid;
  elsif p_action = 'delete_comment' then
    update public.forum_posts set deleted = true, body = '' where id = p_id and not is_body returning author_id into a;
    update public.forum_reports set status = 'done', by_mod = uid, closed_at = now() where kind = 'comment' and target = p_id and status = 'new';
  else return jsonb_build_object('ok', false, 'reason', 'action'); end if;
  if a is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  insert into public.forum_mod_log (mod_id, action, kind, target, note) values (uid, p_action, case when p_action in ('dismiss') then 'report' when p_action = 'delete_comment' then 'comment' else 'article' end, p_id, n);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.forum_mod(text, bigint, text) to authenticated;

-- Служебные — клиенту не даны
revoke execute on function public.forum_rl(uuid, text, boolean, int) from public, anon, authenticated;
revoke execute on function public.forum_media_ok(text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.forum_is_new(uuid) from public, anon, authenticated;
revoke execute on function public.forum_card(public.forum_threads, uuid) from public, anon, authenticated;

-- ═══ 13. Хранилище картинок и файлов 'forum-media' (выключено, пока site_config forum.media не true) ═══
-- Публичное чтение (картинки статей видят все, как обложки); загрузить — только в свою папку <id>/<случайное>.<расширение>,
-- не больше user_mb всего; перезаписать нельзя; удалить — автор или модератор. Тип и размер — ещё раз в forum_save (forum_media_ok).
create or replace function public.forum_media_used() returns bigint language plpgsql stable security definer set search_path = public as $$
declare n bigint := 0;
begin
  if to_regclass('storage.objects') is null then return 0; end if;
  execute 'select coalesce(sum((metadata->>''size'')::bigint), 0) from storage.objects where bucket_id = ''forum-media'' and name like $1' into n using auth.uid()::text || '/%';
  return n;
end $$;
create or replace function public.forum_media_can() returns boolean language plpgsql stable security definer set search_path = public as $$
declare c jsonb := public.forum_cfg();
begin
  return coalesce((c->>'media')::boolean, false) and auth.uid() is not null and not public.forum_u9(auth.uid()) and not public.forum_muted(auth.uid())
    and public.forum_media_used() < coalesce((c->>'user_mb')::bigint, 200) * 1048576;
end $$;
grant execute on function public.forum_media_used() to authenticated;
grant execute on function public.forum_media_can() to authenticated;
do $$ begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('forum-media', 'forum-media', true, 10485760, array['image/webp', 'image/jpeg', 'application/pdf', 'text/plain', 'application/zip'])
    on conflict (id) do update set public = true, file_size_limit = 10485760, allowed_mime_types = array['image/webp', 'image/jpeg', 'application/pdf', 'text/plain', 'application/zip'];
  drop policy if exists "forum-media: загрузить" on storage.objects;
  create policy "forum-media: загрузить" on storage.objects for insert to authenticated
    with check (bucket_id = 'forum-media' and (storage.foldername(name))[1] = auth.uid()::text
      and name ~ '^[0-9a-f-]{36}/[a-z0-9]{16,40}\.(webp|jpg|pdf|txt|zip)$' and public.forum_media_can());
  drop policy if exists "forum-media: смотреть" on storage.objects;
  create policy "forum-media: смотреть" on storage.objects for select to anon, authenticated using (bucket_id = 'forum-media');
  drop policy if exists "forum-media: удалить" on storage.objects;
  create policy "forum-media: удалить" on storage.objects for delete to authenticated
    using (bucket_id = 'forum-media' and ((storage.foldername(name))[1] = auth.uid()::text or public.forum_is_mod(auth.uid())));
end $$;
