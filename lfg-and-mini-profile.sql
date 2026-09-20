-- ═══════════════════════════════════════════════════════════════════
--  МИНИ-ПРОФИЛЬ: статус + любимые игры
--  ПОИСК ТИММЕЙТОВ: заявки по играм + рекомендации по общим играм
--  Выполнить в Supabase → SQL Editor. Один раз.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Статус (короткая строка под ником, как в Discord) + список игр —
--    используются и в мини-профиле, и для подбора тиммейтов ниже.
alter table public.profiles
  add column if not exists status_text text,
  add column if not exists favorite_games text[] not null default '{}';

-- 2. Заявки на поиск тиммейтов
create table if not exists public.lfg_posts (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.profiles(id) on delete cascade,
  game text not null,
  players_needed int not null default 1,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.lfg_posts enable row level security;

drop policy if exists "Заявки читают все" on public.lfg_posts;
create policy "Заявки читают все"
  on public.lfg_posts for select
  using (true);

drop policy if exists "Создать заявку можно только за себя" on public.lfg_posts;
create policy "Создать заявку можно только за себя"
  on public.lfg_posts for insert
  with check (auth.uid() = author_id);

drop policy if exists "Менять заявку может автор или модерация" on public.lfg_posts;
create policy "Менять заявку может автор или модерация"
  on public.lfg_posts for update
  using (
    auth.uid() = author_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','moderator'))
  )
  with check (
    auth.uid() = author_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','moderator'))
  );

drop policy if exists "Удалить заявку может автор или модерация" on public.lfg_posts;
create policy "Удалить заявку может автор или модерация"
  on public.lfg_posts for delete
  using (
    auth.uid() = author_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','moderator'))
  );

create index if not exists idx_lfg_posts_active on public.lfg_posts (active, created_at desc);
