-- ═══════════════════════════════════════════════════════════════════
--  ДОСКА ИДЕЙ ДЛЯ ВИДЕО (#/ideas, js/features/ideas.js)
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно — повторный
--  запуск ничего не ломает. Нужен server-hardening.sql (is_admin_user,
--  is_staff_user) — он уже выполнен, если работает остальной сайт.
--
--  Правила (все проверяются в БД, клиенту не доверяем):
--   • предлагать и голосовать — только вошедшим; не больше 3 идей в сутки
--   • статус и ссылку на ролик меняет только admin
--   • счётчик голосов ведёт триггер — руками его не накрутить
--   • за свою идею голосовать нельзя; один голос на идею
--   • удалить идею: автор, пока она «новая», или стафф
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.ideas (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 5 and 120),
  body text not null default '' check (char_length(body) <= 500),
  status text not null default 'new' check (status in ('new', 'planned', 'done', 'rejected')),
  video_id text check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$'),
  votes int not null default 0,
  created_at timestamptz not null default now(),
  status_changed_at timestamptz
);
create index if not exists idx_ideas_votes on public.ideas (votes desc, created_at desc);
create index if not exists idx_ideas_author_created on public.ideas (author_id, created_at);

create table if not exists public.idea_votes (
  idea_id bigint not null references public.ideas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (idea_id, user_id)
);
create index if not exists idx_idea_votes_user on public.idea_votes (user_id);

alter table public.ideas enable row level security;
alter table public.idea_votes enable row level security;

-- ── RLS: ideas ──
drop policy if exists "Идеи читают все" on public.ideas;
create policy "Идеи читают все" on public.ideas for select using (true);

drop policy if exists "Идею предлагает вошедший от своего имени" on public.ideas;
create policy "Идею предлагает вошедший от своего имени" on public.ideas
  for insert with check (auth.uid() = author_id);

drop policy if exists "Идею меняет только админ" on public.ideas;
create policy "Идею меняет только админ" on public.ideas
  for update using (public.is_admin_user(auth.uid())) with check (public.is_admin_user(auth.uid()));

drop policy if exists "Идею удаляет автор (пока новая) или стафф" on public.ideas;
create policy "Идею удаляет автор (пока новая) или стафф" on public.ideas
  for delete using (
    (auth.uid() = author_id and status = 'new') or public.is_staff_user(auth.uid())
  );

-- ── RLS: idea_votes ── (кто за что голосовал — видит только сам голосующий)
drop policy if exists "Свои голоса видит сам" on public.idea_votes;
create policy "Свои голоса видит сам" on public.idea_votes
  for select using (auth.uid() = user_id);

drop policy if exists "Голосует вошедший, не за свою идею" on public.idea_votes;
create policy "Голосует вошедший, не за свою идею" on public.idea_votes
  for insert with check (
    auth.uid() = user_id
    and not exists (select 1 from public.ideas i where i.id = idea_id and i.author_id = auth.uid())
  );

drop policy if exists "Свой голос можно снять" on public.idea_votes;
create policy "Свой голос можно снять" on public.idea_votes
  for delete using (auth.uid() = user_id);

-- ── Вставка идеи: чистим поля, которые клиент задавать не должен + лимит 3/сутки ──
create or replace function public.ideas_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  new.title := btrim(regexp_replace(new.title, '\s+', ' ', 'g'));
  new.body := btrim(coalesce(new.body, ''));
  new.created_at := now();
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    new.status := 'new';
    new.video_id := null;
    new.votes := 0;
    new.status_changed_at := null;
    select count(*) into n from public.ideas
      where author_id = new.author_id and created_at > now() - interval '24 hours';
    if n >= 3 then
      raise exception 'Не больше 3 идей в сутки — загляни завтра' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ideas_before_insert on public.ideas;
create trigger ideas_before_insert before insert on public.ideas
  for each row execute function public.ideas_before_insert();

-- ── Обновление идеи: votes/author/created_at руками не меняются ──
--   Исключение — счётчик голосов из триггера idea_votes_count (он ставит флаг).
create or replace function public.ideas_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  if coalesce(current_setting('d37.idea_vote_count', true), '') <> '1' then
    new.votes := old.votes;
  end if;
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists ideas_before_update on public.ideas;
create trigger ideas_before_update before update on public.ideas
  for each row execute function public.ideas_before_update();

-- ── Счётчик голосов ──
create or replace function public.idea_votes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('d37.idea_vote_count', '1', true);
  if tg_op = 'INSERT' then
    update public.ideas set votes = votes + 1 where id = new.idea_id;
  elsif tg_op = 'DELETE' then
    update public.ideas set votes = greatest(votes - 1, 0) where id = old.idea_id;
  end if;
  perform set_config('d37.idea_vote_count', '', true);
  return null;
end;
$$;

drop trigger if exists idea_votes_count on public.idea_votes;
create trigger idea_votes_count after insert or delete on public.idea_votes
  for each row execute function public.idea_votes_count();

-- ── Ник/роль автора вместе с идеями (profiles не связаны напрямую через FK-подсказку
--    в PostgREST у всех установок — так надёжнее и одним запросом) ──
create or replace function public.list_ideas(p_status text default null, p_sort text default 'top', p_limit int default 100)
returns table (
  id bigint, author_id uuid, author_nick text, author_role text,
  title text, body text, status text, video_id text, votes int,
  created_at timestamptz, status_changed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.author_id, p.nick, p.role,
         i.title, i.body, i.status, i.video_id, i.votes, i.created_at, i.status_changed_at
  from public.ideas i
  left join public.profiles p on p.id = i.author_id
  where p_status is null or i.status = p_status
  order by
    case when p_sort = 'new' then extract(epoch from i.created_at) else i.votes end desc,
    i.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

grant execute on function public.list_ideas(text, text, int) to anon, authenticated;
