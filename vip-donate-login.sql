-- ═══════════════════════════════════════════════════════════════════
--  ЛОГИН ДЛЯ ДОНАТА ≠ НИК (принцип как в Steam: логин — служебный,
--  для входа/доната, почти не меняется; ник — витрина, меняй как хочешь)
--  Выполнить в Supabase → SQL Editor. ПОСЛЕ vip-secure.sql.
--
--  Это лучше, чем защита самого ника (vip-secure.sql): там ник всё
--  ещё приходится делать уникальным и запрещать смену на "чужой
--  бывший" — рабочая, но чуть неудобная схема (ощущается как
--  ограничение личного профиля). Тут ник вообще снова свободен, а вся
--  защита сосредоточена на отдельном служебном поле, которое обычный
--  человек трогает один раз и забывает.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Новое поле
alter table public.profiles
  add column if not exists donate_login text;

-- 2. Снимаем защиту с nick — она больше не нужна, донат её не
--    использует. Ник снова можно менять свободно и сколько угодно раз.
drop trigger if exists trg_enforce_unique_nick on public.profiles;

-- 3. Бэкфилл: по умолчанию логин для доната = текущий ник на момент
--    миграции — у кого он уже был указан на донат-платформе под своим
--    ником, matching не ломается. Дальше каждый может явно поставить
--    другой логин в профиле.
update public.profiles set donate_login = nick where donate_login is null and nick is not null;

-- 4. Та же защита, что раньше висела на нике (reserved_nicks в
--    vip-secure.sql), теперь на donate_login: уникален, и однажды
--    занятый — закреплён за этим profile_id навсегда. САМ хозяин может
--    свободно возвращать себе свои же старые логины (см. комментарий
--    в vip-secure.sql про "profile_id is distinct from new.id") —
--    запрет только на чужие аккаунты.
--
--    FK на profiles(id) тут обычный, БЕЗ deferrable — в отличие от
--    reserved_nicks. Там deferred был нужен, потому что nick
--    проставляется прямо во время INSERT новой строки profiles (курица
--    и яйцо: строка ещё пишется, а мы уже пытаемся на неё сослаться).
--    donate_login же при INSERT никогда не задаётся (см. handle_new_user
--    в vip-secure.sql — там только id/nick/role) — заполняется позже,
--    отдельным UPDATE, когда строка profiles уже точно существует.
--    Обычной проверки достаточно, и она не мешает включить RLS сразу же.
create table if not exists public.reserved_donate_logins (
  login_lower text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  reserved_at timestamptz not null default now()
);

-- RLS включаем СРАЗУ после создания таблицы, ДО первого INSERT в неё —
-- иначе (а) Supabase-редактор сам допишет ALTER TABLE...ENABLE RLS в
-- конец скрипта при нажатии "Run and enable RLS", и это упадёт с
-- ошибкой 55006 (нельзя менять таблицу, пока по ней в этой же
-- транзакции есть непроведённые события триггеров — INSERT ниже как
-- раз их создаёт), и (б) без RLS таблица торчит наружу через
-- Supabase API для anon/authenticated ключей — трогать её могут только
-- SECURITY DEFINER-функции ниже, обычным клиентам делать там нечего.
alter table public.reserved_donate_logins enable row level security;

drop policy if exists "reserved_donate_logins закрыта от прямого доступа" on public.reserved_donate_logins;
create policy "reserved_donate_logins закрыта от прямого доступа"
  on public.reserved_donate_logins for all
  using (false)
  with check (false);

insert into public.reserved_donate_logins (login_lower, profile_id)
select lower(donate_login), id from public.profiles
where donate_login is not null
on conflict (login_lower) do nothing;

create or replace function public.enforce_unique_donate_login()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.donate_login is null then return new; end if;
  if TG_OP = 'UPDATE' and old.donate_login is not distinct from new.donate_login then
    return new;
  end if;

  if exists (
    select 1 from public.reserved_donate_logins r
    where r.login_lower = lower(new.donate_login) and r.profile_id is distinct from new.id
  ) then
    raise exception 'Логин для доната «%» уже занят — в том числе кем-то, кто раньше его использовал', new.donate_login
      using errcode = '23505';
  end if;

  insert into public.reserved_donate_logins (login_lower, profile_id)
  values (lower(new.donate_login), new.id)
  on conflict (login_lower) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_enforce_unique_donate_login on public.profiles;
create trigger trg_enforce_unique_donate_login
  before insert or update of donate_login on public.profiles
  for each row execute function public.enforce_unique_donate_login();
