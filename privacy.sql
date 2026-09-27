-- ═══════════════════════════════════════════════════════════════════
--  ПРИВАТНОСТЬ ПРОФИЛЯ
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно.
--  Сначала должен быть выложен сайт с js, который читает profiles_public
--  (иначе старые вкладки не смогут прочитать профили — select * на profiles
--  после этого скрипта запрещён).
--
--  Настройки (меняет сам владелец в «Настройках аккаунта»):
--   • privacy_profile         all | friends | nobody — кто видит «о себе», статус,
--                             игры, фон, дату регистрации, ачивки и XP;
--                             ник, аватар, роль и значок VIP видны всегда
--   • privacy_invisible       мои заходы не пишутся в «Гости профиля»
--   • privacy_friend_requests all | nobody — кто может прислать заявку в друзья
--   • privacy_hide_donations  сумма донатов скрыта в профиле и в топе донатеров
--                             (уровень VIP остаётся виден)
--
--  Персонал тоже соблюдает приватность: модератор/админ на скрытом профиле видит
--  только служебные данные (дата регистрации, роль, VIP, остаток до следующего
--  месяца VIP). Админ дополнительно всегда видит сумму донатов и логин
--  DonationAlerts — нужно для разбора VIP.
--
--  Как защищено: прямое чтение таблицы profiles оставлено только для публичных
--  колонок (id, nick, role, avatar_url, is_vip, vip_until, theme_accent — их
--  используют встроенные запросы чата/форума/гостей). Всё остальное читается
--  через представление profiles_public, которое само прячет закрытые поля.
--  !!! Новая колонка в profiles по умолчанию НЕ читается клиентом — добавить
--  её в profiles_public (и, если она публичная, в grant ниже).
-- ═══════════════════════════════════════════════════════════════════

-- Колонки мини-профиля (из lfg-and-mini-profile.sql) — на случай, если тот не запускался
alter table public.profiles
  add column if not exists status_text text,
  add column if not exists favorite_games text[] not null default '{}';

alter table public.profiles
  add column if not exists privacy_profile text not null default 'all',
  add column if not exists privacy_invisible boolean not null default false,
  add column if not exists privacy_friend_requests text not null default 'all',
  add column if not exists privacy_hide_donations boolean not null default false;

do $$ begin
  alter table public.profiles add constraint profiles_privacy_profile_chk check (privacy_profile in ('all', 'friends', 'nobody'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.profiles add constraint profiles_privacy_requests_chk check (privacy_friend_requests in ('all', 'nobody'));
exception when duplicate_object then null; end $$;

-- ── Вспомогательные функции (security definer — не зависят от прав читающего) ──
create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((requester_id = a and addressee_id = b) or (requester_id = b and addressee_id = a))
  );
$$;

create or replace function public.viewer_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_invisible(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select privacy_invisible from public.profiles where id = uid), false);
$$;

create or replace function public.accepts_friend_requests(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select privacy_friend_requests = 'all' from public.profiles where id = uid), true);
$$;

-- ── Представление: то, что видит конкретный читающий ──
drop view if exists public.profiles_public;
create view public.profiles_public as
select
  p.id, p.nick, p.role, p.avatar_url, p.is_vip, p.vip_until, p.theme_accent,
  case when v.can_see then p.banner_url end                       as banner_url,
  case when v.can_see then p.bio end                              as bio,
  case when v.can_see then p.status_text end                      as status_text,
  case when v.can_see then p.favorite_games else '{}'::text[] end as favorite_games,
  case when v.can_see or v.staff then p.created_at end            as created_at,
  -- Скрытая сумма заменяется порогом уровня: значок Bronze/Silver/Gold считается как раньше
  case when v.money then p.total_donated
       when p.total_donated >= 1500 then 1500
       when p.total_donated >= 500 then 500
       else 0 end                                                 as total_donated,
  not v.money                                                     as donations_hidden,
  case when v.self or v.admin then p.donate_login end             as donate_login,
  case when v.self or v.staff then p.vip_pending_rub end          as vip_pending_rub,
  case when v.self then p.last_pinned_at end                      as last_pinned_at,
  case when v.self or v.admin then p.referred_by end              as referred_by,
  p.privacy_profile                                               as profile_visibility,
  p.privacy_friend_requests = 'all'                               as accepts_friend_requests,
  not v.can_see                                                   as profile_hidden,
  (not v.can_see and v.staff)                                     as staff_view,
  case when v.self then p.privacy_invisible end                   as privacy_invisible,
  case when v.self then p.privacy_hide_donations end              as privacy_hide_donations
from public.profiles p
cross join (select auth.uid() as uid, public.viewer_role() as vrole) me
cross join lateral (
  select
    coalesce(p.id = me.uid, false) as self,
    coalesce(me.vrole = 'admin', false) as admin,
    coalesce(me.vrole in ('admin', 'moderator'), false) as staff,
    coalesce(p.id = me.uid, false)
      or p.privacy_profile = 'all'
      or (p.privacy_profile = 'friends' and public.are_friends(p.id, me.uid)) as can_see,
    coalesce(p.id = me.uid, false)
      or coalesce(me.vrole = 'admin', false)
      or not p.privacy_hide_donations as money
) v;

grant select on public.profiles_public to anon, authenticated;

-- ── Прямое чтение profiles — только публичные колонки ──
-- (запись не трогаем: update своих полей идёт как раньше, по RLS и триггерам)
revoke select on public.profiles from anon, authenticated;
grant select (id, nick, role, avatar_url, is_vip, vip_until, theme_accent) on public.profiles to anon, authenticated;

-- ── Невидимка: визит не записывается (проверка на сервере, не только в js) ──
drop policy if exists "Можно записать только свой визит" on public.profile_views;
create policy "Можно записать только свой визит"
  on public.profile_views for insert
  with check (auth.uid() = viewer_id and not public.is_invisible(auth.uid()));

drop policy if exists "Обновлять можно только свою запись визита" on public.profile_views;
create policy "Обновлять можно только свою запись визита"
  on public.profile_views for update
  using (auth.uid() = viewer_id)
  with check (auth.uid() = viewer_id and not public.is_invisible(auth.uid()));

-- Включив невидимку, человек стирает и уже записанные свои заходы
drop policy if exists "Свои заходы можно стереть" on public.profile_views;
create policy "Свои заходы можно стереть"
  on public.profile_views for delete
  using (auth.uid() = viewer_id);

-- ── Заявки в друзья: «ни от кого» ──
drop policy if exists "Отправить заявку можно только от себя" on public.friendships;
create policy "Отправить заявку можно только от себя"
  on public.friendships for insert
  with check (auth.uid() = requester_id and public.accepts_friend_requests(addressee_id));
