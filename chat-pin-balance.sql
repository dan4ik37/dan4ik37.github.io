-- ═══════════════════════════════════════════════════════════════════
--  БАЛАНС ПИНА В ЧАТЕ (патч поверх chat-pin.sql)
--  Выполнить в Supabase → SQL Editor. Один раз, после chat-pin.sql.
--
--  Что чиню:
--  1. Хелпер нигде больше не исключение (аватарка, ник в чате,
--     форматирование форума — стафф уровня хелпер имеет их везде), а
--     в пине почему-то был исключён. Добавляю.
--  2. Раньше все — от только что купившего Bronze VIP до админа —
--     получали одинаковые 15 минут. Явный перекос. Теперь длительность
--     растёт по роли/уровню:
--       Bronze VIP   → 10 мин
--       Хелпер       → 15 мин
--       Silver VIP   → 20 мин
--       Модератор    → 30 мин
--       Gold VIP     → 40 мин
--       Админ        → 60 мин
--     Пороги уровней (500₽/1500₽) — те же, что в VIP_TIERS
--     (js/features/profile.js) и в vip-tiers.sql. Поменяются там —
--     поменять и тут, они специально продублированы явно, а не
--     вынесены в общую функцию — чтобы не плодить ещё один слой
--     непрозрачной логики ради одной этой цифры.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
--  КУЛДАУН НА ПОВТОРНЫЙ ПИН
--
--  Без этого дыра: как только пин истекает, тот же человек тут же
--  закрепляет заново — фактически держит слот "навсегда", хотя пин
--  задуман как временный. Кулдаун = 2× от длительности пина: между
--  пинами простоя больше, чем самого пина. Модерация (admin/moderator)
--  от кулдауна освобождена — это их рабочий инструмент, а не плюшка,
--  и они и так могут снять чужой пин в любой момент (unpin_message).
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
  v_is_vip boolean;
  v_vip_until timestamptz;
  v_role text;
  v_total_donated numeric;
  v_last_pinned_at timestamptz;
  v_duration interval;
  v_cooldown interval;
  v_wait_minutes int;
begin
  select user_id into v_owner from public.messages where id = msg_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Можно закрепить только своё сообщение';
  end if;

  select is_vip, vip_until, role, coalesce(total_donated, 0), last_pinned_at
    into v_is_vip, v_vip_until, v_role, v_total_donated, v_last_pinned_at
  from public.profiles where id = auth.uid();

  if v_role = 'admin' then
    v_duration := interval '60 minutes';
  elsif v_role = 'moderator' then
    v_duration := interval '30 minutes';
  elsif v_role = 'helper' then
    v_duration := interval '15 minutes';
  elsif v_is_vip is true and (v_vip_until is null or v_vip_until > now()) then
    v_duration := case
      when v_total_donated >= 1500 then interval '40 minutes'  -- Gold
      when v_total_donated >= 500  then interval '20 minutes'  -- Silver
      else interval '10 minutes'                                -- Bronze
    end;
  else
    raise exception 'Закреп — только для VIP или стаффа (хелпер и выше)';
  end if;

  -- Кулдаун не действует на admin/moderator — им можно чаще, это
  -- инструмент модерации, не плюшка.
  if v_role not in ('admin', 'moderator') then
    v_cooldown := v_duration * 2;
    if v_last_pinned_at is not null and v_last_pinned_at + v_cooldown > now() then
      v_wait_minutes := ceil(extract(epoch from (v_last_pinned_at + v_cooldown - now())) / 60);
      raise exception 'Закреплять можно не чаще чем раз в % мин — подожди ещё % мин', extract(epoch from v_cooldown)/60, v_wait_minutes;
    end if;
  end if;

  update public.messages
  set pinned_until = now() + v_duration, pinned_by = auth.uid()
  where id = msg_id;

  update public.profiles set last_pinned_at = now() where id = auth.uid();
end;
$$;
grant execute on function public.pin_own_message(bigint) to authenticated;
