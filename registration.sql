-- ═══════════════════════════════════════════════════════════════════
--  РЕГИСТРАЦИЯ ОБЫЧНЫХ ЗРИТЕЛЕЙ
--  Выполнить целиком в Supabase → SQL Editor. Один раз.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Автосоздание строки в profiles при регистрации нового аккаунта.
--    SECURITY DEFINER — выполняется от имени владельца функции, поэтому
--    отрабатывает независимо от RLS-политик и независимо от того, включено
--    ли подтверждение email (триггер срабатывает на INSERT в auth.users,
--    это происходит сразу при signUp, до подтверждения почты).
--    Ник по умолчанию — часть email до @; фронтенд (doGlobalRegister)
--    сразу же перезаписывает его тем, что человек ввёл в форму, если
--    подтверждение email выключено. Если включено — ник временно хранится
--    в localStorage (d37_pending_nick) и применяется при первом входе
--    после подтверждения (см. onAuthStateChange в chat.js).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nick, role)
  values (new.id, split_part(new.email, '@', 1), 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. RLS: разрешить пользователю читать и обновлять СВОЮ строку профиля
--    (нужно, чтобы doGlobalRegister/onAuthStateChange могли дописать ник).
--    Если у тебя уже есть похожая политика — просто пропусти этот блок,
--    DROP POLICY IF EXISTS ниже безопасен и не сломает существующую.
alter table public.profiles enable row level security;

drop policy if exists "Профили читают все" on public.profiles;
create policy "Профили читают все"
  on public.profiles for select
  using (true);

drop policy if exists "Пользователь редактирует свой профиль" on public.profiles;
create policy "Пользователь редактирует свой профиль"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 2b. Отдельная политика — админ может редактировать ЛЮБОЙ профиль
--     (нужно для UI назначения ролей в "⚙️ Настройки сайта" → "Роли").
--     RLS-политики для одной операции складываются через OR: эта не
--     отменяет предыдущую, а добавляет ещё один разрешённый случай.
--     Защита от подделки роли (см. пункт 3 ниже) при этом не ослабляется —
--     она проверяет роль ДЕЙСТВУЮЩЕГО пользователя, а не то, чья это
--     политика позволила дойти до UPDATE.
drop policy if exists "Админ редактирует любой профиль" on public.profiles;
create policy "Админ редактирует любой профиль"
  on public.profiles for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (true);

-- 3. Защита от подделки роли: RLS-политика выше физически позволяет
--    обновить любую колонку своей строки, включая role — то есть
--    обычный пользователь через фронтенд-запрос мог бы сам себе
--    прописать role='admin'. Блокируем это триггером: менять role
--    может только тот, у кого уже role='admin'.
create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  acting_role text;
begin
  if new.role is distinct from old.role then
    select role into acting_role from public.profiles where id = auth.uid();
    if acting_role is distinct from 'admin' then
      new.role := old.role;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_role_change on public.profiles;
create trigger on_profile_role_change
  before update on public.profiles
  for each row execute procedure public.prevent_self_role_escalation();

-- ═══════════════════════════════════════════════════════════════════
--  РОЛЬ "HELPER" (младший модератор)
--  Права: удаляет сообщения, НЕ банит (это осталось только у
--  admin/moderator) и не видит админские панели (опросы/расписание/
--  цель/настройки). Никаких доп. изменений в SQL не требуется — role
--  это просто text-поле, без CHECK-ограничения на список значений.
--
--  Назначать роль (helper/moderator/admin) теперь можно через UI:
--  "⚙️ Настройки сайта" → раздел "👥 Роли" → поиск по нику → сохранить.
--  Человек должен сначала сам зарегистрироваться на сайте — тогда для
--  него появится строка в profiles с role='user', и его можно будет
--  найти по нику в этом разделе.
--
--  Ручной SQL ниже — на случай, если UI недоступен (например ещё не
--  задеплоен) или нужно исправить роль себе самому в самый первый раз,
--  когда назначать ещё некому:
--
--       update public.profiles
--       set role = 'admin'   -- или 'moderator' / 'helper'
--       where id = (select id from auth.users where email = 'его@почта.ру');
--
--  Роль применится сразу же при следующем входе на сайт (или при
--  обновлении страницы, если человек уже залогинен).
-- ═══════════════════════════════════════════════════════════════════
