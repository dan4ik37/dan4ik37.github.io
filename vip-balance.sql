-- ═══════════════════════════════════════════════════════════════════
--  БАЛАНС VIP + СЕРВЕРНАЯ ЗАЩИТА ПЕРКОВ
--  Выполнить в Supabase → SQL Editor. Можно перезапускать сколько угодно
--  раз (везде create or replace / drop … if exists).
--  Порядок: ПОСЛЕ chat-pin-balance.sql, vip-tiers.sql, chat-stickers.sql.
--
--  Зачем. До сих пор сервер верил клиенту: сообщение приходило с полями
--  role / vip_tier / is_sticker, которые браузер проставлял сам. Через
--  консоль можно было отправить сообщение с плашкой ADMIN, золотым VIP или
--  стикером без VIP; GIF-аватарку/фон тоже мог залить кто угодно, проверка
--  «только VIP» была лишь в JS. Здесь всё проверяется на сервере — по факту
--  из таблицы profiles, а то, что прислал клиент, игнорируется.
--
--  Цифры баланса (JS-зеркало — VIP_TIERS в js/features/profile.js;
--  поменял тут — поменяй и там):
--
--                    закреп   повтор через   порог (донаты за всё время)
--    VIP (Bronze)    10 мин       30 мин          с 1-го месяца
--    Silver          20 мин       40 мин          от  500 ₽
--    Gold            40 мин       60 мин          от 1500 ₽
--    Хелпер          15 мин       30 мин          —
--    Модератор       30 мин       нет паузы       —
--    Админ           60 мин       нет паузы       —
--
--  Логика: пауза = длительность × 3 / × 2 / × 1.5 — чем выше уровень, тем
--  большую долю времени можно держать закреп (25% → 33% → 40%), а не только
--  «дольше за раз». Раньше пауза была везде ×2, и у Bronze и у Gold доля
--  времени в закрепе была одинаковой (33%) — уровень давал лишь «подольше».
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  1. ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ: кто сейчас какого уровня
-- ─────────────────────────────────────────────────────────────────
-- 'bronze' | 'silver' | 'gold' — или NULL, если VIP не активен
create or replace function public.vip_tier_of(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.is_vip is true and (p.vip_until is null or p.vip_until > now()) then
      case
        when coalesce(p.total_donated, 0) >= 1500 then 'gold'
        when coalesce(p.total_donated, 0) >= 500  then 'silver'
        else 'bronze'
      end
    else null
  end
  from public.profiles p
  where p.id = uid;
$$;
grant execute on function public.vip_tier_of(uuid) to authenticated, anon;

-- Есть ли перки: активный VIP или стафф (стикеры, анимация, гости)
create or replace function public.has_perks(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role in ('admin', 'moderator', 'helper') from public.profiles p where p.id = uid),
    false
  ) or public.vip_tier_of(uid) is not null;
$$;
grant execute on function public.has_perks(uuid) to authenticated, anon;


-- ─────────────────────────────────────────────────────────────────
--  2. ЗАКРЕП: новые цифры (заменяет версию из chat-pin-balance.sql)
-- ─────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists last_pinned_at timestamptz;

create or replace function public.pin_own_message(msg_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_role text;
  v_tier text;
  v_last timestamptz;
  v_minutes int;
  v_cooldown int;   -- минут паузы; 0 — без паузы
  v_wait int;
begin
  select user_id into v_owner from public.messages where id = msg_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Можно закрепить только своё сообщение';
  end if;

  select role, last_pinned_at into v_role, v_last from public.profiles where id = auth.uid();
  v_tier := public.vip_tier_of(auth.uid());

  if    v_role = 'admin'     then v_minutes := 60; v_cooldown := 0;
  elsif v_role = 'moderator' then v_minutes := 30; v_cooldown := 0;
  elsif v_role = 'helper'    then v_minutes := 15; v_cooldown := 30;
  elsif v_tier = 'gold'      then v_minutes := 40; v_cooldown := 60;
  elsif v_tier = 'silver'    then v_minutes := 20; v_cooldown := 40;
  elsif v_tier = 'bronze'    then v_minutes := 10; v_cooldown := 30;
  else
    raise exception 'Закреп — только для VIP или команды сайта';
  end if;

  if v_cooldown > 0 and v_last is not null
     and v_last + make_interval(mins => v_cooldown) > now() then
    v_wait := ceil(extract(epoch from (v_last + make_interval(mins => v_cooldown) - now())) / 60);
    raise exception 'Закреплять можно раз в % мин — подожди ещё % мин', v_cooldown, v_wait;
  end if;

  update public.messages
  set pinned_until = now() + make_interval(mins => v_minutes), pinned_by = auth.uid()
  where id = msg_id;

  update public.profiles set last_pinned_at = now() where id = auth.uid();
end;
$$;
grant execute on function public.pin_own_message(bigint) to authenticated;


-- ─────────────────────────────────────────────────────────────────
--  3. СООБЩЕНИЯ ЧАТА: сервер сам решает role / vip_tier / is_sticker
--     BEFORE INSERT-триггер, поэтому фронтенд переписывать не нужно —
--     он по-прежнему шлёт эти поля, просто их значения игнорируются.
--     Таблицу messages и её RLS-политики триггер не трогает.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.messages_enforce_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- Не браузер (service_role, SQL Editor, миграции, боты) — вставляем как есть.
  -- В SQL Editor JWT нет вообще (auth.role() = NULL), и вставка с user_id от имени
  -- админа раньше отвергалась как «чужой аккаунт».
  -- Смотрим именно на JWT-роль, а не на current_user: функция SECURITY DEFINER, и
  -- внутри неё current_user — всегда владелец, то есть проверка по нему пропускала бы всех.
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  -- Простая защита от простыни: клиент режет на 200, сервер — на 500
  if new.text is not null and char_length(new.text) > 500 then
    raise exception 'Сообщение слишком длинное (максимум 500 символов)';
  end if;

  -- Ник в сообщении попадает в HTML-атрибуты у ВСЕХ, кто смотрит чат, поэтому
  -- оставляем только буквы, цифры, пробел, _ . - (ник вида  x" onmouseover="…
  -- иначе выполнил бы скрипт у каждого зрителя). Клиент дополнительно экранирует
  -- (jsAttr в utils.js) — это второй слой.
  new.nick := left(btrim(regexp_replace(coalesce(new.nick, ''), '[^A-Za-zА-Яа-яЁё0-9_. -]', '', 'g')), 24);
  if new.nick = '' then
    new.nick := case when new.user_id is null then 'guest' else 'user' end;
  end if;

  -- Гость (без аккаунта): ни роли, ни VIP, ни стикеров
  if new.user_id is null then
    new.role := 'guest';
    new.vip_tier := null;
    new.is_sticker := false;
    return new;
  end if;

  -- Нельзя писать от имени чужого аккаунта (иначе подделывается мини-профиль по клику на ник)
  if new.user_id is distinct from auth.uid() then
    raise exception 'Нельзя писать от имени другого аккаунта';
  end if;

  select role into v_role from public.profiles where id = new.user_id;
  new.role := coalesce(v_role, 'user');
  new.vip_tier := public.vip_tier_of(new.user_id);

  if coalesce(new.is_sticker, false) and not public.has_perks(new.user_id) then
    raise exception 'Стикеры — только для VIP и команды сайта';
  end if;
  new.is_sticker := coalesce(new.is_sticker, false);

  return new;
end;
$$;

drop trigger if exists messages_enforce_status on public.messages;
create trigger messages_enforce_status
  before insert on public.messages
  for each row execute function public.messages_enforce_status();


-- ─────────────────────────────────────────────────────────────────
--  4. GIF-АВАТАРКИ И ФОН — только VIP и стафф (на уровне Storage)
--     Restrictive-политика накладывается ПОВЕРХ уже существующих
--     (те, что из profile-system.sql, остаются как есть).
--     Имена политик латиницей и короткие: Postgres режет имена до 63 БАЙТ,
--     а кириллица — по 2 байта на букву, поэтому длинные русские имена
--     двух политик обрезались бы до одинаковых и затирали друг друга.
--     Ограничение: проверяется расширение .gif. Анимированный WEBP/APNG
--     под ним не ловится — на практике сайт выдаёт их как обычные фото.
-- ─────────────────────────────────────────────────────────────────
drop policy if exists gif_only_for_perks_insert on storage.objects;
create policy gif_only_for_perks_insert
  on storage.objects
  as restrictive
  for insert
  to authenticated
  with check (
    bucket_id not in ('avatars', 'profile-bg')
    or lower(name) not like '%.gif'
    or public.has_perks(auth.uid())
  );

drop policy if exists gif_only_for_perks_update on storage.objects;
create policy gif_only_for_perks_update
  on storage.objects
  as restrictive
  for update
  to authenticated
  using (
    bucket_id not in ('avatars', 'profile-bg')
    or lower(name) not like '%.gif'
    or public.has_perks(auth.uid())
  )
  with check (
    bucket_id not in ('avatars', 'profile-bg')
    or lower(name) not like '%.gif'
    or public.has_perks(auth.uid())
  );


-- ─────────────────────────────────────────────────────────────────
--  5. ПРОВЕРКА (необязательно): посмотреть, кто какого уровня
-- ─────────────────────────────────────────────────────────────────
-- select nick, role, total_donated, vip_until, public.vip_tier_of(id) as tier
-- from public.profiles where is_vip is true order by total_donated desc;
