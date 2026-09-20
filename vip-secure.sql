-- ═══════════════════════════════════════════════════════════════════
--  НАДЁЖНОСТЬ VIP: ник нельзя "передать" другому + гибкое накопление
--  Выполнить в Supabase → SQL Editor. Один раз.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- 1. УНИКАЛЬНОСТЬ НИКА + ЗАПРЕТ ПОВТОРНОГО ИСПОЛЬЗОВАНИЯ
--
-- Проблема, которую чинит этот блок: донаты сопоставляются с профилем
-- по нику (ilike). Раньше ники не были уникальны, и если Вася задонатил,
-- стал VIP, потом сменил ник на "Петя" — его старый ник "Вася"
-- освобождался. Если кто-то ДРУГОЙ регистрировался как "Вася" и ему
-- донатили по привычке под старым именем — донат ушёл бы не тому
-- человеку. Теперь: (а) ник уникален в любой момент времени, (б) ник,
-- который у кого-то КОГДА-ЛИБО был, закреплён за его profile_id — но
-- запрет действует только на ЧУЖИЕ аккаунты (see enforce_unique_nick:
-- "profile_id is distinct from new.id"). САМ хозяин может свободно
-- переключаться туда-обратно между всеми своими бывшими никами —
-- ничего у него не "сгорает". Донат на нике, который сейчас ни у кого
-- не активен и никогда не принадлежал текущему получателю, просто не
-- сматчится (уйдёт в "не сопоставлен" на ручной разбор админом) — это
-- безопасно, в отличие от матча не с тем человеком.
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.reserved_nicks (
  nick_lower text primary key,
  -- deferrable initially deferred — ОБЯЗАТЕЛЬНО: триггер ниже пишет сюда
  -- из BEFORE INSERT на profiles, то есть строка в profiles на этот
  -- момент ещё не существует физически (появится только когда основной
  -- INSERT завершится). Без deferred проверка FK упадёт мгновенно.
  -- Deferred переносит проверку на конец транзакции, когда строка уже есть.
  profile_id uuid not null references public.profiles(id) on delete cascade deferrable initially deferred,
  reserved_at timestamptz not null default now()
);

-- RLS включаем СРАЗУ после создания таблицы, ДО первого INSERT в неё —
-- если сделать это после, Supabase-редактор (при "Run and enable RLS")
-- допишет ALTER TABLE в конец скрипта, а к тому моменту INSERT ниже уже
-- создаст отложенные (deferred) события проверки FK — Postgres откажется
-- менять таблицу, пока они не разрешены (ошибка 55006). Плюс без RLS
-- таблица торчит наружу через API — а трогать её должны только
-- SECURITY DEFINER-функции ниже, не обычные клиенты.
alter table public.reserved_nicks enable row level security;

drop policy if exists "reserved_nicks закрыта от прямого доступа" on public.reserved_nicks;
create policy "reserved_nicks закрыта от прямого доступа"
  on public.reserved_nicks for all
  using (false)
  with check (false);

-- Бэкфилл текущих ников как уже "зарезервированных" за их хозяевами —
-- иначе первый же UPDATE/INSERT после включения триггера упадёт, не
-- найдя текущий ник пользователя в reserved_nicks (chicken-egg).
insert into public.reserved_nicks (nick_lower, profile_id)
select lower(nick), id from public.profiles
where nick is not null
on conflict (nick_lower) do nothing;

create or replace function public.enforce_unique_nick()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.nick is null then return new; end if;
  if TG_OP = 'UPDATE' and old.nick is not distinct from new.nick then
    return new; -- ник не менялся, проверять нечего
  end if;

  if exists (
    select 1 from public.reserved_nicks r
    where r.nick_lower = lower(new.nick) and r.profile_id is distinct from new.id
  ) then
    raise exception 'Ник «%» уже занят — в том числе кем-то, кто раньше его носил', new.nick
      using errcode = '23505';
  end if;

  insert into public.reserved_nicks (nick_lower, profile_id)
  values (lower(new.nick), new.id)
  on conflict (nick_lower) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_enforce_unique_nick on public.profiles;
create trigger trg_enforce_unique_nick
  before insert or update of nick on public.profiles
  for each row execute function public.enforce_unique_nick();

-- ─────────────────────────────────────────────────────────────────
-- 2. ГИБКОЕ НАКОПЛЕНИЕ К МЕСЯЦУ VIP (100₽ можно набрать частями)
--
-- Раньше дробный остаток доната (донатнул 130₽ — 30₽ сверху просто
-- сгорали) терялся. Теперь остаток копится в vip_pending_rub и
-- участвует в следующем донате — можно набирать месяц хоть по 10₽.
-- Логика расчёта — в js/features/profile.js (processDonationForVip),
-- эта колонка только хранит состояние.
-- ─────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists vip_pending_rub numeric not null default 0;

-- ─────────────────────────────────────────────────────────────────
-- 3. ПЕРЕОПРЕДЕЛЯЕМ handle_new_user (см. registration.sql)
--
-- Раньше дефолтный ник новой регистрации брался как часть email до
-- "@" (split_part). Теперь ник уникален — если два человека
-- регистрируются с почтами "ivan@gmail.com" и "ivan@yandex.ru", их
-- дефолтные ники совпадут, и ВТОРАЯ регистрация упадёт с ошибкой
-- прямо в триггере auth.users, что сломает вход целиком. Вместо
-- этого дефолтный ник строим из id пользователя — он гарантированно
-- уникален сам по себе, коллизия невозможна в принципе. Реальный
-- ник, который человек ввёл в форме, дописывается поверх сразу же
-- (doGlobalRegister / d37_pending_nick, см. profile.js и global-auth.js)
-- — этот дефолт живёт доли секунды и почти никогда не виден.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nick, role)
  values (new.id, 'user_' || replace(new.id::text, '-', ''), 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;
