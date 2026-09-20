-- ═══════════════════════════════════════════════════════════════════
--  ГОСТИ ПРОФИЛЯ (VIP-плюшка: видно, кто заходил на твою страницу)
--  Выполнить в Supabase → SQL Editor. Один раз.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.profile_views (
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (viewer_id, viewed_id)
);

create index if not exists idx_profile_views_viewed on public.profile_views (viewed_id, viewed_at desc);

alter table public.profile_views enable row level security;

-- Записать визит может только сам заходящий, за себя
drop policy if exists "Можно записать только свой визит" on public.profile_views;
create policy "Можно записать только свой визит"
  on public.profile_views for insert
  with check (auth.uid() = viewer_id);

-- Обновить время визита (повторный заход) — тоже только своё
drop policy if exists "Обновлять можно только свою запись визита" on public.profile_views;
create policy "Обновлять можно только свою запись визита"
  on public.profile_views for update
  using (auth.uid() = viewer_id)
  with check (auth.uid() = viewer_id);

-- Список гостей видит ТОЛЬКО хозяин профиля (кого посетили) — сам факт
-- захода на чужую страницу это приватность заходившего, не палим её
-- никому, кроме владельца профиля, который смотрит список своих гостей.
drop policy if exists "Видеть гостей может только хозяин профиля" on public.profile_views;
create policy "Видеть гостей может только хозяин профиля"
  on public.profile_views for select
  using (auth.uid() = viewed_id);
