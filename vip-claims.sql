-- ═══════════════════════════════════════════════════════════════════
--  «ЗАДОНАТИЛ, А VIP НЕ ПРИШЁЛ?» — самостоятельная привязка доната без абуза
-- ═══════════════════════════════════════════════════════════════════
--  Когда донат не сматчился автоматически (имя в DonationAlerts не совпало с логином для
--  доната), он лежит в vip_donation_log как matched = false. Здесь человек сам находит его:
--  вводит имя из DonationAlerts, сумму и день.
--
--  Защита от абуза:
--   • только НЕсопоставленные донаты (сматченный уже чей-то — его не забрать);
--   • точная сумма + имя (без учёта регистра/пробелов/._-) + дата ±1 день;
--   • АВТОМАТИЧЕСКИ — только если имя доната похоже на логин или ник заявителя (≤ 2 опечатки),
--     иначе заявка уходит админу (уведомление) — одобрить/отклонить одной кнопкой;
--   • каждый донат привязывается один раз (замок + matched), не больше 5 заявок в день;
--   • все заявки пишутся в donation_claims (кто, что ввёл, чем кончилось).
--  Начисление — та же арифметика, что в credit_donation (100 ₽ = месяц, остаток копится).
--  Нужны: vip_donation_log (+ donor_username/amount/currency/donated_at), profiles.donate_login /
--  vip_pending_rub / total_donated, is_admin_user(), notify(). Идемпотентно.

alter table public.vip_donation_log add column if not exists donor_username text;
alter table public.vip_donation_log add column if not exists amount numeric;
alter table public.vip_donation_log add column if not exists currency text;
alter table public.vip_donation_log add column if not exists donated_at timestamptz;

create table if not exists public.donation_claims (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  donation_id bigint,
  candidates int not null default 0,
  name_typed text,
  amount numeric,
  claim_date date,
  status text not null,          -- auto | review | approved | denied | manual | not_found
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create index if not exists idx_donation_claims_user on public.donation_claims (user_id, created_at desc);
alter table public.donation_claims enable row level security;
drop policy if exists "Свои заявки видит сам, все — админ" on public.donation_claims;
create policy "Свои заявки видит сам, все — админ" on public.donation_claims for select
  using (user_id = auth.uid() or public.is_admin_user(auth.uid()));
-- Писать напрямую нельзя — только через функции ниже

-- Нормализация имени: регистр, пробелы, . _ -
create or replace function public.d37_norm_name(t text)
returns text language sql immutable as $$
  select lower(regexp_replace(coalesce(t, ''), '[\s._\-]+', '', 'g'));
$$;

-- Расстояние Левенштейна (сколько правок между строками) — без расширений, строки короткие
create or replace function public.d37_lev(a text, b text)
returns int language plpgsql immutable as $$
declare
  la int := char_length(coalesce(a, '')); lb int := char_length(coalesce(b, ''));
  prev int[]; cur int[]; i int; j int; cost int;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      cost := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      cur := cur || least(prev[j + 1] + 1, cur[j] + 1, prev[j] + cost);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end; $$;

-- Начислить конкретный несопоставленный донат человеку (внутренняя: зовут claim/admin_resolve)
create or replace function public.apply_unmatched_donation(p_donation_id bigint, p_profile uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.vip_donation_log%rowtype;
  v_prof public.profiles%rowtype;
  v_pending numeric; v_months int; v_new_until timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('credit_donation'));   -- тот же замок, что у credit_donation
  select * into d from public.vip_donation_log where donation_id = p_donation_id for update;
  if not found then return jsonb_build_object('status', 'no_donation'); end if;
  if d.matched then return jsonb_build_object('status', 'taken'); end if;
  if upper(coalesce(d.currency, 'RUB')) <> 'RUB' or coalesce(d.amount, 0) <= 0 then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_prof from public.profiles where id = p_profile for update;
  if not found then return jsonb_build_object('status', 'no_profile'); end if;

  v_pending := coalesce(v_prof.vip_pending_rub, 0) + d.amount;
  v_months  := floor(v_pending / 100)::int;          -- 100 ₽ = 1 месяц, остаток копится
  v_new_until := v_prof.vip_until;
  if v_months >= 1 then
    if v_prof.is_vip is true and v_prof.vip_until is null then
      v_new_until := null;                             -- бессрочный остаётся бессрочным
    else
      v_new_until := (case when v_prof.is_vip is true and v_prof.vip_until > now() then v_prof.vip_until else now() end)
                     + make_interval(months => v_months);
    end if;
  end if;
  update public.profiles set
    total_donated   = coalesce(total_donated, 0) + d.amount,
    vip_pending_rub = v_pending - v_months * 100,
    is_vip          = case when v_months >= 1 then true else is_vip end,
    vip_until       = case when v_months >= 1 then v_new_until else vip_until end
  where id = p_profile;
  update public.vip_donation_log set matched = true, profile_id = p_profile, months_granted = v_months
  where donation_id = p_donation_id;
  return jsonb_build_object('status', 'credited', 'months', v_months, 'amount', d.amount);
end; $$;
revoke execute on function public.apply_unmatched_donation(bigint, uuid) from public, anon, authenticated;

-- Заявка «донатил — VIP не пришёл»
create or replace function public.claim_donation(p_name text, p_amount numeric, p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_login text; v_nick text;
  n int; v_id bigint; v_donor text;
  v_close boolean := false;
  r jsonb;
  adm record;
begin
  if uid is null then return jsonb_build_object('status', 'auth'); end if;
  if (select count(*) from public.donation_claims where user_id = uid and created_at > now() - interval '1 day') >= 5 then
    return jsonb_build_object('status', 'limit');
  end if;
  if coalesce(btrim(p_name), '') = '' or char_length(p_name) > 64 or p_amount is null or p_amount <= 0 or p_amount > 1000000
     or p_date is null or p_date > current_date + 1 or p_date < current_date - 180 then
    return jsonb_build_object('status', 'invalid');
  end if;

  select count(*), min(l.donation_id), min(l.donor_username) into n, v_id, v_donor
  from public.vip_donation_log l
  where l.matched = false and upper(coalesce(l.currency, 'RUB')) = 'RUB' and l.amount = p_amount
    and coalesce(l.donated_at, l.processed_at)::date between p_date - 1 and p_date + 1
    and public.d37_norm_name(l.donor_username) = public.d37_norm_name(p_name);

  if n = 0 then
    insert into public.donation_claims (user_id, name_typed, amount, claim_date, status)
      values (uid, left(p_name, 64), p_amount, p_date, 'not_found');
    return jsonb_build_object('status', 'not_found');
  end if;
  if n = 1 and exists (select 1 from public.donation_claims where donation_id = v_id and status = 'review') then
    return jsonb_build_object('status', 'already');
  end if;

  select donate_login, nick into v_login, v_nick from public.profiles where id = uid;
  v_close := (char_length(public.d37_norm_name(v_login)) >= 3 and public.d37_lev(public.d37_norm_name(v_donor), public.d37_norm_name(v_login)) <= 2)
          or (char_length(public.d37_norm_name(v_nick)) >= 3 and public.d37_lev(public.d37_norm_name(v_donor), public.d37_norm_name(v_nick)) <= 2);

  if n = 1 and v_close then
    r := public.apply_unmatched_donation(v_id, uid);
    insert into public.donation_claims (user_id, donation_id, candidates, name_typed, amount, claim_date, status, resolved_at)
      values (uid, v_id, n, left(p_name, 64), p_amount, p_date, case when r->>'status' = 'credited' then 'auto' else 'review' end, now());
    if r->>'status' = 'credited' then
      return jsonb_build_object('status', 'credited', 'months', (r->>'months')::int, 'amount', p_amount);
    end if;
  else
    insert into public.donation_claims (user_id, donation_id, candidates, name_typed, amount, claim_date, status)
      values (uid, case when n = 1 then v_id end, n, left(p_name, 64), p_amount, p_date, 'review');
  end if;
  -- На ручную проверку — уведомляем админов
  for adm in select id from public.profiles where role = 'admin' loop
    begin
      perform public.notify(adm.id, 'vip_claim', uid, '💸 Заявка на VIP по донату',
        format('%s ₽ от «%s» (%s) — проверь в профиле', p_amount, left(p_name, 30), p_date), '#/profile', null);
    exception when others then null; end;
  end loop;
  return jsonb_build_object('status', 'review');
end; $$;
revoke execute on function public.claim_donation(text, numeric, date) from public, anon;
grant execute on function public.claim_donation(text, numeric, date) to authenticated;

-- Заявки на проверку — только админ
create or replace function public.admin_donation_claims()
returns table(id bigint, user_id uuid, nick text, donate_login text, name_typed text, amount numeric, claim_date date,
              donation_id bigint, candidates int, donor_username text, donated_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.user_id, p.nick, p.donate_login, c.name_typed, c.amount, c.claim_date,
         c.donation_id, c.candidates, l.donor_username, coalesce(l.donated_at, l.processed_at), c.created_at
  from public.donation_claims c
  join public.profiles p on p.id = c.user_id
  left join public.vip_donation_log l on l.donation_id = c.donation_id
  where c.status = 'review' and public.is_admin_user(auth.uid())
  order by c.created_at;
$$;
grant execute on function public.admin_donation_claims() to authenticated;

-- Одобрить / отклонить
create or replace function public.admin_resolve_claim(p_id bigint, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.donation_claims%rowtype; r jsonb := '{}'::jsonb;
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'Только для админа'; end if;
  select * into c from public.donation_claims where id = p_id for update;
  if not found or c.status <> 'review' then return jsonb_build_object('status', 'gone'); end if;
  if p_approve then
    if c.donation_id is null then return jsonb_build_object('status', 'ambiguous'); end if;   -- несколько похожих донатов — выдать вручную
    r := public.apply_unmatched_donation(c.donation_id, c.user_id);
    if r->>'status' <> 'credited' then return r; end if;
  end if;
  update public.donation_claims set status = case when p_approve then 'approved' else 'denied' end,
    resolved_at = now(), resolved_by = auth.uid() where id = p_id;
  begin
    perform public.notify(c.user_id, 'vip_claim', null,
      case when p_approve then '✨ Донат привязан — VIP начислен' else '❌ Заявка по донату отклонена' end,
      case when p_approve then format('%s ₽ засчитаны в VIP. Спасибо за поддержку!', c.amount)
           else 'Если это ошибка — напиши админу в чат.' end, '#/profile', null);
  exception when others then null; end;
  return jsonb_build_object('status', case when p_approve then 'approved' else 'denied' end, 'months', r->'months');
end; $$;
grant execute on function public.admin_resolve_claim(bigint, boolean) to authenticated;

-- Закрыть заявку, когда VIP выдан вручную (несколько похожих донатов — система не угадывает, какой из них)
create or replace function public.admin_close_claim_manual(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.donation_claims%rowtype;
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'Только для админа'; end if;
  select * into c from public.donation_claims where id = p_id for update;
  if not found or c.status <> 'review' then return jsonb_build_object('status', 'gone'); end if;
  update public.donation_claims set status = 'manual', resolved_at = now(), resolved_by = auth.uid() where id = p_id;
  begin
    perform public.notify(c.user_id, 'vip_claim', null, '✨ Заявку по донату рассмотрели',
      'VIP выдан вручную — загляни в профиль. Спасибо за поддержку!', '#/profile', null);
  exception when others then null; end;
  return jsonb_build_object('status', 'manual');
end; $$;
grant execute on function public.admin_close_claim_manual(bigint) to authenticated;
