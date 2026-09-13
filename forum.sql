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
