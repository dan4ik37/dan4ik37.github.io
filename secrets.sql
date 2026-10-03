-- ═══════════════════════════════════════════════════════════════════
--  ОХОТА ЗА СЕКРЕТАМИ: 7 спрятанных ✦ на сайте → радужный ник на 30 дней + 100 XP
-- ═══════════════════════════════════════════════════════════════════
--  Клиент: js/features/secrets.js (коды фрагментов — те же, что в secret_codes() ниже).
--  Нужны: xp.sql (xp_award), profiles. Идемпотентно — можно запускать повторно.
--  Честно: коды видны в коде сайта, программист может «найти» всё вызовом RPC —
--  награда небольшая (ник на месяц), поэтому это приемлемо.

create table if not exists public.secret_hunt (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  found text[] not null default '{}',
  completed_at timestamptz,
  reward_until timestamptz
);
alter table public.secret_hunt enable row level security;
drop policy if exists "Свою охоту видит сам" on public.secret_hunt;
create policy "Свою охоту видит сам" on public.secret_hunt for select using (user_id = auth.uid());
-- Писать напрямую нельзя — только через secret_found()

create or replace function public.secret_codes()
returns text[] language sql immutable as $$
  select array['avatar', 'footer', 'games', 'archive', 'horror', 'levels', 'words'];
$$;

-- Отметить найденный фрагмент. Все 7 → радужный ник на 30 дней (продлевает текущий) + 100 XP один раз.
create or replace function public.secret_found(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  total int := cardinality(public.secret_codes());
  r public.secret_hunt%rowtype;
  got int := 0;
  just_done boolean := false;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_code is null or not (p_code = any(public.secret_codes())) then
    return jsonb_build_object('ok', false, 'reason', 'code');
  end if;
  insert into public.secret_hunt as s (user_id, found) values (uid, array[p_code])
    on conflict (user_id) do update
      set found = case when p_code = any(s.found) then s.found else s.found || p_code end
    returning * into r;
  if cardinality(r.found) >= total and r.completed_at is null then
    update public.secret_hunt
      set completed_at = now(),
          reward_until = greatest(coalesce(reward_until, now()), now()) + interval '30 days'
      where user_id = uid
      returning * into r;
    just_done := true;
    begin got := public.xp_award(uid, 'secret', 'hunt', 100); exception when others then got := 0; end;
    begin
      perform public.notify(uid, 'secret', null, '🌈 Все секреты найдены!',
        'Радужный ник — твой на 30 дней. Его видно в чате и в профиле.', '#/profile', 'secret-hunt');
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'found', r.found, 'total', total,
    'completed', r.completed_at is not null, 'just_done', just_done,
    'reward_until', r.reward_until, 'xp', got);
end; $$;
revoke execute on function public.secret_found(text) from public, anon;
grant execute on function public.secret_found(text) to authenticated;

-- Мой прогресс (для панели «Охота за секретами»)
create or replace function public.secret_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('found', s.found, 'total', cardinality(public.secret_codes()),
       'completed', s.completed_at is not null, 'reward_until', s.reward_until)
     from public.secret_hunt s where s.user_id = auth.uid()),
    jsonb_build_object('found', '[]'::jsonb, 'total', cardinality(public.secret_codes()), 'completed', false, 'reward_until', null));
$$;
grant execute on function public.secret_status() to authenticated;

-- У кого сейчас радужный ник — сайт подсвечивает их в чате и профиле
create or replace function public.nick_fx_users()
returns setof uuid language sql stable security definer set search_path = public as $$
  select user_id from public.secret_hunt where reward_until > now();
$$;
grant execute on function public.nick_fx_users() to anon, authenticated;
