-- ═══════════════════════════════════════════════════════════════════
--  РЕФЕРАЛЬНАЯ СИСТЕМА
--  Выполнить целиком в Supabase → SQL Editor. Один раз.
--  Ничего в server-hardening.sql / vip-secure.sql / registration.sql не
--  трогает — отдельный небольшой файл под конкретную фичу.
--
--  Идея: приглашающий делится ссылкой вида ?ref=<его_nick> (nick уже
--  гарантированно уникален — trg_enforce_unique_nick в vip-secure.sql,
--  переустановлен раньше остальных как a1_... в server-hardening.sql).
--  Отдельный код приглашения не нужен.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Колонка "кто пригласил". Отдельный слот статистики — НЕ путать с
--    системой друзей (таблица friendships, panel "Заявки в друзья") —
--    это разные вещи, README демки-источника сам предупреждал об этом
--    риске совпадения имён.
alter table public.profiles
  add column if not exists referred_by uuid references public.profiles(id) on delete set null;

create index if not exists idx_profiles_referred_by on public.profiles(referred_by);

-- 2. ПЕРЕОПРЕДЕЛЯЕМ handle_new_user() ЕЩЁ РАЗ (см. registration.sql,
--    затем vip-secure.sql) — сохраняем последнюю рабочую версию (дефолтный
--    ник строится из id, коллизия невозможна) и добавляем поверх чтение
--    ref из raw_user_meta_data. create or replace — предыдущая версия
--    просто заменяется, DROP не нужен.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ref_nick text;
  ref_id uuid;
begin
  ref_nick := new.raw_user_meta_data ->> 'ref';
  if ref_nick is not null and length(trim(ref_nick)) > 0 then
    select id into ref_id
    from public.profiles
    where lower(nick) = lower(trim(ref_nick))
    limit 1;
  end if;

  insert into public.profiles (id, nick, role, referred_by)
  values (
    new.id,
    'user_' || replace(new.id::text, '-', ''),
    'user',
    ref_id
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Триггер on_auth_user_created уже существует (registration.sql) и
-- вызывает public.handle_new_user() — саму привязку триггер→функция
-- трогать не нужно, create or replace function достаточно.

-- 3. Защита колонки referred_by от подделки через обычный
--    profiles.update() с клиента (RLS "Пользователь редактирует свой
--    профиль" разрешает менять любую свою колонку) — по аналогии с
--    prevent_self_role_escalation для role в registration.sql.
--    Разрешаем менять referred_by только когда её меняет сам админ.
create or replace function public.prevent_referred_by_tamper()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  acting_role text;
begin
  if new.referred_by is distinct from old.referred_by then
    select role into acting_role from public.profiles where id = auth.uid();
    if acting_role is distinct from 'admin' then
      new.referred_by := old.referred_by;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_referred_by_tamper on public.profiles;
create trigger trg_prevent_referred_by_tamper
  before update on public.profiles
  for each row execute function public.prevent_referred_by_tamper();

-- 4. Публичные функции статистики (SECURITY DEFINER — обходят RLS
--    безопасно, т.к. сами ничего не пишут, только считают).
--
--    "Активный" приглашённый — прокси-критерий: есть хотя бы одно
--    сообщение в messages от его user_id. Отсекает мусорные регистрации
--    ради накрутки счётчика.
create or replace function public.referral_count(uid uuid)
returns bigint
language sql
stable
security definer set search_path = public
as $$
  select count(*)
  from public.profiles p
  where p.referred_by = uid
    and exists (
      select 1 from public.messages m where m.user_id = p.id
    );
$$;

create or replace function public.top_referrers(lim int default 10)
returns table(id uuid, nick text, active_referrals bigint)
language sql
stable
security definer set search_path = public
as $$
  select p.id, p.nick, public.referral_count(p.id) as active_referrals
  from public.profiles p
  where public.referral_count(p.id) > 0
  order by active_referrals desc
  limit lim;
$$;

-- 5. Осознанно НЕ включено в эту миграцию (см. инструкцию):
--    автоматическая выдача наград по лесенке (цветной ник за 3 реферала,
--    роль "Посол сообщества" за 5 и т.п.) — трогает систему VIP-уровней
--    и цветов ника, легко налажать на автомате. Награды — вручную через
--    существующую админку ролей, глядя на referral_count() /
--    top_referrers(). Автоматизация — отдельным заходом, если понадобится.
