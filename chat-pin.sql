-- ═══════════════════════════════════════════════════════════════════
--  ЗАКРЕПЛЁННЫЕ СООБЩЕНИЯ В ЧАТЕ (VIP + модерация)
--  Выполнить в Supabase → SQL Editor. Один раз.
--
--  ВАЖНО: таблицы public.messages в этом репозитории нет (она создана
--  раньше, до модульного рефакторинга, и её RLS-политики мы не видим).
--  Поэтому вместо "create policy ... for update on messages" (рискованно
--  вслепую трогать чужие политики) — две функции SECURITY DEFINER: они
--  сами проверяют права и обходят RLS только после проверки. Это и
--  безопаснее, и не зависит от того, что там уже настроено.
-- ═══════════════════════════════════════════════════════════════════

alter table public.messages
  add column if not exists pinned_until timestamptz,
  add column if not exists pinned_by uuid references public.profiles(id);

-- Пин ставит либо сам автор сообщения (если у него активный VIP или
-- он админ/модератор), либо это же условие проверяется явно — гостям
-- и обычным пользователям функция откажет исключением.
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
begin
  select user_id into v_owner from public.messages where id = msg_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Можно закрепить только своё сообщение';
  end if;

  select is_vip, vip_until, role into v_is_vip, v_vip_until, v_role
  from public.profiles where id = auth.uid();

  if coalesce(v_role, '') not in ('admin', 'moderator')
     and (v_is_vip is not true or (v_vip_until is not null and v_vip_until < now())) then
    raise exception 'Закреп — только для VIP или модерации';
  end if;

  update public.messages
  set pinned_until = now() + interval '15 minutes', pinned_by = auth.uid()
  where id = msg_id;
end;
$$;
grant execute on function public.pin_own_message(bigint) to authenticated;

-- Открепить может автор либо admin/moderator (модерация может снять
-- чужой пин, например если он оскорбительный).
create or replace function public.unpin_message(msg_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_role text;
begin
  select user_id into v_owner from public.messages where id = msg_id;
  select role into v_role from public.profiles where id = auth.uid();

  if v_owner is distinct from auth.uid() and coalesce(v_role, '') not in ('admin', 'moderator') then
    raise exception 'Нет прав открепить это сообщение';
  end if;

  update public.messages set pinned_until = null, pinned_by = null where id = msg_id;
end;
$$;
grant execute on function public.unpin_message(bigint) to authenticated;
