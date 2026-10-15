-- ═══════════════════════════════════════════════════════════════════
--  💎 КРИСТАЛЛЫ — донатная валюта сайта (как робуксы): магазин #/shop (js/features/shop.js),
--  кошелёк в браузере js/core/premium.js, оплата картой — api/pay.js (TipTop Pay, Freedom Pay, Kaspi вручную).
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно (можно запускать повторно).
--  Нужны уже применённые: server-hardening.sql (credit_donation, is_admin_user), vip-claims.sql
--  (apply_unmatched_donation), coins.sql (coin_wallet, coin_add — обмен 💎→🪙 и вещи персонажа).
--  Желательно: xp.sql (XP за поддержку), notifications.sql (уведомления 🔔) — без них просто молчат.
--
--  ВНИМАНИЕ: здесь переопределяются credit_donation (server-hardening.sql) и apply_unmatched_donation
--  (vip-claims.sql) — чтобы донат мог давать 💎. Если когда-то перезапустить те файлы, после них —
--  перезапустить и этот.
--
--  Как устроено:
--   • Кристаллы отдельно от монет 🪙: покупаются только за деньги (пакеты premium_packs или донат), тратятся
--     только на сервере (premium_spend): VIP, VIP в подарок, обмен на монеты, вещи персонажа. Без лутбоксов.
--   • Кошелёк premium_wallet (баланс не бывает меньше нуля) + журнал premium_ledger: каждое изменение — строка.
--   • Оплата картой: заказ premium_order_create (только сервер; лимиты в сутки/месяц, согласие взрослого) →
--     уведомление провайдера с проверенной подписью → premium_credit (только сервер). Один и тот же платёж
--     (провайдер + номер) начисляется один раз; сумма и валюта сверяются с заказом. Возврат — premium_refund:
--     не хватает 💎 (уже потратил) — остаток записывается долгом и гасится из следующих начислений.
--   • Донат DonationAlerts: каждый сам выбирает (premium_set_mode) — «VIP сразу» (как раньше, по умолчанию:
--     100 ₽ = месяц, остаток копится) или «💎 кристаллы» (1 ₽ = 1 💎 + бонус за крупный донат, как у пакетов).
--     При переходе на кристаллы накопленный остаток к VIP-месяцу превращается в 💎 — ничего не сгорает.
--     В обоих режимах растёт «сумма поддержки» (total_donated) — от неё уровень VIP Silver/Gold.
--   • VIP за 💎 — те же месяцы, что за донат (profiles.is_vip / vip_until); покупка кристаллов за деньги тоже
--     растит сумму поддержки, поэтому уровни VIP работают как раньше.
--  Цифры — premium_packs / premium_items / premium_settings; продублированы в js/core/premium.js и
--  api/_lib/premium.js (тест сверяет). Курс доната и лимиты админ меняет в магазине (premium_admin_settings).
--  Проверка после запуска: /rpc/premium_state гостем → {"ok":false,"reason":"auth",…} (PGRST202 = не применён).
-- ═══════════════════════════════════════════════════════════════════

-- Колонки, на которые опирается файл (на базе есть, но вдруг старый скрипт применился не целиком)
alter table public.profiles add column if not exists vip_pending_rub numeric not null default 0;
alter table public.profiles add column if not exists total_donated numeric not null default 0;
alter table public.profiles add column if not exists donate_login text;
alter table public.vip_donation_log add column if not exists donor_username text;
alter table public.vip_donation_log add column if not exists amount numeric;
alter table public.vip_donation_log add column if not exists currency text;
alter table public.vip_donation_log add column if not exists donated_at timestamptz;
alter table public.vip_donation_log add column if not exists gems_granted int;   -- сколько 💎 дал донат (режим «кристаллы»)

-- ═══ 1. Таблицы ═══
-- Настройки — одна строка (меняет админ в магазине)
create table if not exists public.premium_settings (
  id int primary key default 1 check (id = 1),
  donate_rate numeric not null default 1,          -- сколько 💎 за 1 ₽ доната
  donate_bonus boolean not null default true,      -- бонус за крупный донат, как у пакетов (+10/20/30 %)
  day_rub int not null default 3000,               -- лимит покупок картой на человека за сутки (в рублях)
  month_rub int not null default 10000,            -- и за 30 дней
  shop_open boolean not null default true,         -- тратить 💎 можно (выключатель на крайний случай)
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.premium_settings (id) values (1) on conflict (id) do nothing;
alter table public.premium_settings enable row level security;   -- политик нет: читают и пишут только функции

create table if not exists public.premium_wallet (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance int not null default 0 check (balance >= 0),
  debt int not null default 0 check (debt >= 0),    -- вернул деньги, а 💎 уже потратил — гасится из новых
  donate_mode text not null default 'vip' check (donate_mode in ('vip', 'gems')),
  consent_at timestamptz,                           -- первая покупка с отметкой «платит взрослый / с разрешения»
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.premium_wallet enable row level security;
drop policy if exists "Свой кошелёк кристаллов видит сам" on public.premium_wallet;
create policy "Свой кошелёк кристаллов видит сам" on public.premium_wallet for select using (auth.uid() = user_id);

create table if not exists public.premium_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount int not null,                  -- + начислено, − списано
  balance int not null,                 -- остаток после операции
  kind text not null,                   -- pay donation convert grant revoke spend gift refund debt
  ref text not null default '',         -- платёж, донат, товар
  note text,                            -- понятная подпись (что купил, причина у админа)
  actor uuid,                           -- кто начислил вручную
  created_at timestamptz not null default now()
);
create index if not exists idx_premium_ledger_user on public.premium_ledger (user_id, id desc);
-- Страховка от двойного начисления: один платёж / один донат / один возврат — одна строка
create unique index if not exists uq_premium_ledger_once on public.premium_ledger (kind, ref) where kind in ('pay', 'donation', 'refund');
alter table public.premium_ledger enable row level security;
drop policy if exists "Свой журнал кристаллов видит сам" on public.premium_ledger;
create policy "Свой журнал кристаллов видит сам" on public.premium_ledger for select using (auth.uid() = user_id);

-- Заказы на оплату картой. Хранятся и после удаления аккаунта (учёт денег)
create table if not exists public.premium_orders (
  id text primary key,                  -- D37-…: этот номер видит покупатель и провайдер
  user_id uuid references public.profiles(id) on delete set null,
  pack text not null,
  gems int not null check (gems > 0),
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null,
  rub int not null default 0,           -- сколько это в рублях: сумма поддержки (уровень VIP) и лимиты
  provider text not null,               -- tiptop | freedom | kaspi
  status text not null default 'new',   -- new | paid | failed | refunded
  payment_id text,
  test boolean not null default false,
  consent boolean not null default false,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  note text
);
create index if not exists idx_premium_orders_user on public.premium_orders (user_id, created_at desc);
create index if not exists idx_premium_orders_new on public.premium_orders (provider, created_at) where status = 'new';
alter table public.premium_orders enable row level security;
drop policy if exists "Свои заказы видит сам" on public.premium_orders;
create policy "Свои заказы видит сам" on public.premium_orders for select using (auth.uid() = user_id);

-- Уведомления провайдеров: (провайдер, номер платежа) — один раз. Номера карт, почту и IP не храним
create table if not exists public.premium_payments (
  provider text not null,
  payment_id text not null,
  order_id text,
  user_id uuid,
  amount numeric(12, 2),
  currency text,
  status text not null,                 -- credited | extra | mismatch | no_order | refund
  test boolean not null default false,
  raw jsonb,
  created_at timestamptz not null default now(),
  primary key (provider, payment_id)
);
alter table public.premium_payments add column if not exists refund_of text;   -- у возврата: номер исходного платежа
alter table public.premium_payments enable row level security;   -- политик нет: только сервер и админ (функции)

-- ═══ 2. Цифры (продублированы в js/core/premium.js и api/_lib/premium.js — тест сверяет) ═══
-- Пакеты: rub/kzt — цена, bonus — сколько 💎 сверху уже входит в gems
create or replace function public.premium_packs() returns jsonb language sql immutable as $$
  select '[
    {"id":"p100","gems":100,"bonus":0,"rub":100,"kzt":590},
    {"id":"p300","gems":300,"bonus":0,"rub":300,"kzt":1770},
    {"id":"p550","gems":550,"bonus":50,"rub":500,"kzt":2950},
    {"id":"p1200","gems":1200,"bonus":200,"rub":1000,"kzt":5900},
    {"id":"p2600","gems":2600,"bonus":600,"rub":2000,"kzt":11800}
  ]'::jsonb
$$;

-- Что продаётся за 💎. VIP — те же месяцы, что за донат (100 ₽ = месяц ↔ 100 💎), подольше — дешевле.
-- Вещи персонажа (skin:…) — каталог у гардероба (js/core/avatar.js); пока части там нет, магазин её не показывает.
create or replace function public.premium_items() returns jsonb language sql immutable as $$
  select '[
    {"id":"vip:1","kind":"vip","months":1,"price":100,"title":"VIP на 1 месяц"},
    {"id":"vip:3","kind":"vip","months":3,"price":270,"title":"VIP на 3 месяца"},
    {"id":"vip:12","kind":"vip","months":12,"price":960,"title":"VIP на 12 месяцев"},
    {"id":"gift:1","kind":"gift","months":1,"price":100,"title":"VIP на месяц в подарок"},
    {"id":"coins:100","kind":"coins","coins":100,"price":10,"title":"100 монет"},
    {"id":"coins:550","kind":"coins","coins":550,"price":50,"title":"550 монет"},
    {"id":"coins:1200","kind":"coins","coins":1200,"price":100,"title":"1200 монет"},
    {"id":"skin:hat:gemcrown","kind":"skin","price":150,"title":"Кристальная корона"},
    {"id":"skin:back:gemwings","kind":"skin","price":300,"title":"Кристальные крылья"},
    {"id":"skin:trail:gems","kind":"skin","price":100,"title":"След из кристаллов"}
  ]'::jsonb
$$;

create or replace function public.premium_pack(p_id text) returns jsonb language sql immutable as $$
  select e from jsonb_array_elements(public.premium_packs()) e where e->>'id' = p_id
$$;
create or replace function public.premium_item(p_id text) returns jsonb language sql immutable as $$
  select e from jsonb_array_elements(public.premium_items()) e where e->>'id' = p_id
$$;

-- Сколько 💎 даёт донат в рублях: курс + бонус за крупную сумму (как у пакетов: 500 → +10 %, 1000 → +20 %, 2000 → +30 %)
create or replace function public.premium_donation_gems(p_rub numeric)
returns int language sql stable security definer set search_path = public as $$
  select case when coalesce(p_rub, 0) <= 0 then 0 else
    floor(p_rub * s.donate_rate)::int
    + case when s.donate_bonus then floor(floor(p_rub * s.donate_rate) *
        (case when p_rub >= 2000 then 30 when p_rub >= 1000 then 20 when p_rub >= 500 then 10 else 0 end) / 100.0)::int
      else 0 end
  end
  from public.premium_settings s where s.id = 1
$$;

create or replace function public.premium_mode(p_uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select donate_mode from public.premium_wallet where user_id = p_uid), 'vip')
$$;

-- ═══ 3. Ядро: начислить / списать (только из функций этого файла — клиенту нельзя) ═══
-- Возвращает новый баланс; null — не хватило 💎 (ничего не изменилось). Положительное начисление сначала гасит долг.
create or replace function public.premium_add(p_uid uuid, p_amount int, p_kind text, p_ref text default '',
  p_note text default null, p_actor uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare w public.premium_wallet%rowtype; bal int; v_pay int;
begin
  if p_uid is null then raise exception 'premium_add: не указан пользователь'; end if;
  insert into public.premium_wallet (user_id) values (p_uid) on conflict (user_id) do nothing;
  select * into w from public.premium_wallet where user_id = p_uid for update;
  if coalesce(p_amount, 0) = 0 then return w.balance; end if;
  if w.balance + p_amount < 0 then return null; end if;
  update public.premium_wallet set balance = balance + p_amount, updated_at = now() where user_id = p_uid returning balance into bal;
  insert into public.premium_ledger (user_id, amount, balance, kind, ref, note, actor)
    values (p_uid, p_amount, bal, p_kind, coalesce(p_ref, ''), left(p_note, 200), p_actor);
  if p_amount > 0 and w.debt > 0 then
    v_pay := least(w.debt, bal);
    update public.premium_wallet set balance = balance - v_pay, debt = debt - v_pay where user_id = p_uid returning balance into bal;
    insert into public.premium_ledger (user_id, amount, balance, kind, ref, note)
      values (p_uid, -v_pay, bal, 'debt', coalesce(p_ref, ''), 'Погашение долга после возврата денег');
  end if;
  return bal;
end; $$;
revoke execute on function public.premium_add(uuid, int, text, text, text, uuid) from public, anon, authenticated;

-- Уведомление 🔔 (notifications.sql). Нет его — молча
create or replace function public.premium_notify(p_uid uuid, p_title text, p_body text, p_dedupe text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.notify(p_uid, 'premium', null, p_title, p_body, '#/shop', p_dedupe);
  exception when others then null;
  end;
end; $$;
revoke execute on function public.premium_notify(uuid, text, text, text) from public, anon, authenticated;

-- Продлить VIP на N месяцев (как донат: от текущего конца или от сейчас). false — бессрочный VIP, продлевать нечего
create or replace function public.premium_extend_vip(p_uid uuid, p_months int)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_prof public.profiles%rowtype; v_until timestamptz;
begin
  select * into v_prof from public.profiles where id = p_uid for update;
  if not found then return null; end if;
  if v_prof.is_vip is true and v_prof.vip_until is null then return 'infinity'::timestamptz; end if;
  v_until := (case when v_prof.is_vip is true and v_prof.vip_until > now() then v_prof.vip_until else now() end)
             + make_interval(months => p_months);
  update public.profiles set is_vip = true, vip_until = v_until where id = p_uid;
  return v_until;
end; $$;
revoke execute on function public.premium_extend_vip(uuid, int) from public, anon, authenticated;

-- ═══ 4. Для сайта ═══
-- Состояние: баланс, режим доната, пакеты и товары, лимиты, история. Гостю — только витрина.
-- Возраст (age.sql → age_shop_caps): 13–17 лет — свои лимиты, до 13 — cards: false (картой нельзя). Нет age.sql — как раньше
create or replace function public.premium_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); w public.premium_wallet%rowtype; s public.premium_settings%rowtype;
  v_day numeric; v_month numeric; v_pending numeric; v_caps jsonb;
begin
  select * into s from public.premium_settings where id = 1;
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth', 'packs', public.premium_packs(), 'items', public.premium_items(),
      'rate', s.donate_rate, 'bonus', s.donate_bonus, 'open', s.shop_open);
  end if;
  select * into w from public.premium_wallet where user_id = uid;
  select coalesce(sum(rub) filter (where created_at > now() - interval '1 day'), 0), coalesce(sum(rub), 0)
    into v_day, v_month from public.premium_orders
    where user_id = uid and status in ('paid', 'refunded') and created_at > now() - interval '30 days';
  select coalesce(vip_pending_rub, 0) into v_pending from public.profiles where id = uid;
  if to_regprocedure('public.age_shop_caps(uuid)') is not null then
    execute 'select public.age_shop_caps($1)' into v_caps using uid;
  end if;
  return jsonb_build_object('ok', true,
    'balance', coalesce(w.balance, 0), 'debt', coalesce(w.debt, 0), 'mode', coalesce(w.donate_mode, 'vip'),
    'consent', w.consent_at is not null, 'pending_rub', floor(coalesce(v_pending, 0)),
    'rate', s.donate_rate, 'bonus', s.donate_bonus, 'open', s.shop_open,
    'limits', jsonb_build_object('day_rub', coalesce((v_caps->>'day_rub')::int, s.day_rub), 'month_rub', coalesce((v_caps->>'month_rub')::int, s.month_rub),
      'used_day', v_day, 'used_month', v_month),
    'cards', coalesce((v_caps->>'cards')::boolean, true),
    'packs', public.premium_packs(), 'items', public.premium_items(),
    'history', coalesce((select jsonb_agg(h order by h.id desc) from (
        select id, amount, balance, kind, ref, note, created_at from public.premium_ledger
        where user_id = uid order by id desc limit 30) h), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(o order by o.created_at desc) from (
        select id, pack, gems, amount, currency, provider, status, test, created_at, paid_at from public.premium_orders
        where user_id = uid order by created_at desc limit 10) o), '[]'::jsonb));
end; $$;
grant execute on function public.premium_state() to anon, authenticated;

-- Режим доната: 'vip' — «VIP сразу» (как было), 'gems' — донат превращается в 💎.
-- На кристаллы — накопленный остаток к VIP-месяцу тоже становится 💎 (по курсу, без бонуса)
create or replace function public.premium_set_mode(p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_pending numeric; v_gems int := 0; bal int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_mode not in ('vip', 'gems') then return jsonb_build_object('ok', false, 'reason', 'mode'); end if;
  insert into public.premium_wallet (user_id) values (uid) on conflict (user_id) do nothing;
  perform 1 from public.premium_wallet where user_id = uid for update;
  update public.premium_wallet set donate_mode = p_mode, updated_at = now() where user_id = uid;
  if p_mode = 'gems' then
    select coalesce(vip_pending_rub, 0) into v_pending from public.profiles where id = uid for update;
    v_gems := floor(coalesce(v_pending, 0) * (select donate_rate from public.premium_settings where id = 1))::int;
    if v_pending > 0 then
      update public.profiles set vip_pending_rub = 0 where id = uid;
      if v_gems > 0 then
        perform public.premium_add(uid, v_gems, 'convert', 'pending', format('Остаток доната к VIP-месяцу: %s ₽', floor(v_pending)));
      end if;
    end if;
  end if;
  select balance into bal from public.premium_wallet where user_id = uid;
  return jsonb_build_object('ok', true, 'mode', p_mode, 'converted', v_gems, 'balance', bal);
end; $$;
revoke execute on function public.premium_set_mode(text) from public, anon;
grant execute on function public.premium_set_mode(text) to authenticated;

-- Потратить 💎: VIP, VIP в подарок (p_target — ник), обмен на монеты 🪙, вещь персонажа
create or replace function public.premium_spend(p_item text, p_target text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); it jsonb := public.premium_item(p_item); v_kind text; v_price int; bal int;
  v_until timestamptz; v_to public.profiles%rowtype; v_nick text; v_coins int; v_owned text[]; n int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if it is null then return jsonb_build_object('ok', false, 'reason', 'item'); end if;
  if not coalesce((select shop_open from public.premium_settings where id = 1), true) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  v_kind := it->>'kind'; v_price := (it->>'price')::int;

  if v_kind = 'vip' then
    if exists (select 1 from public.profiles where id = uid and is_vip is true and vip_until is null) then
      return jsonb_build_object('ok', false, 'reason', 'forever');   -- бессрочный VIP: тратить 💎 незачем
    end if;
    bal := public.premium_add(uid, -v_price, 'spend', p_item, it->>'title');
    if bal is null then return jsonb_build_object('ok', false, 'reason', 'gems', 'need', v_price); end if;
    v_until := public.premium_extend_vip(uid, (it->>'months')::int);
    return jsonb_build_object('ok', true, 'balance', bal, 'vip_until', v_until);

  elsif v_kind = 'gift' then
    if coalesce(btrim(p_target), '') = '' then return jsonb_build_object('ok', false, 'reason', 'target'); end if;
    select count(*) into n from public.profiles where lower(nick) = lower(btrim(p_target));
    if n <> 1 then return jsonb_build_object('ok', false, 'reason', 'target'); end if;
    select * into v_to from public.profiles where lower(nick) = lower(btrim(p_target));
    if v_to.id = uid then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
    if v_to.is_vip is true and v_to.vip_until is null then return jsonb_build_object('ok', false, 'reason', 'forever'); end if;
    if (select count(*) from public.premium_ledger where user_id = uid and kind = 'gift' and created_at > now() - interval '1 day') >= 5 then
      return jsonb_build_object('ok', false, 'reason', 'limit');
    end if;
    bal := public.premium_add(uid, -v_price, 'gift', p_item || ':' || v_to.id, 'VIP в подарок: ' || v_to.nick);
    if bal is null then return jsonb_build_object('ok', false, 'reason', 'gems', 'need', v_price); end if;
    v_until := public.premium_extend_vip(v_to.id, (it->>'months')::int);
    select nick into v_nick from public.profiles where id = uid;
    perform public.premium_notify(v_to.id, '🎁 Тебе подарили VIP!',
      format('%s подарил(а) тебе VIP на %s мес. Загляни в профиль!', coalesce(v_nick, 'Кто-то'), it->>'months'), null);
    return jsonb_build_object('ok', true, 'balance', bal, 'to', v_to.nick);

  elsif v_kind = 'coins' then
    if to_regprocedure('public.coin_add(uuid,integer,text,text)') is null then
      return jsonb_build_object('ok', false, 'reason', 'coins_off');
    end if;
    bal := public.premium_add(uid, -v_price, 'spend', p_item, it->>'title');
    if bal is null then return jsonb_build_object('ok', false, 'reason', 'gems', 'need', v_price); end if;
    v_coins := public.coin_add(uid, (it->>'coins')::int, 'premium', p_item);
    return jsonb_build_object('ok', true, 'balance', bal, 'coins', v_coins, 'got', (it->>'coins')::int);

  elsif v_kind = 'skin' then
    if to_regclass('public.coin_wallet') is null then return jsonb_build_object('ok', false, 'reason', 'coins_off'); end if;
    insert into public.coin_wallet (user_id) values (uid) on conflict (user_id) do nothing;
    select items into v_owned from public.coin_wallet where user_id = uid for update;
    if p_item = any(coalesce(v_owned, '{}'::text[])) then return jsonb_build_object('ok', false, 'reason', 'owned'); end if;
    bal := public.premium_add(uid, -v_price, 'spend', p_item, it->>'title');
    if bal is null then return jsonb_build_object('ok', false, 'reason', 'gems', 'need', v_price); end if;
    update public.coin_wallet set items = array_append(items, p_item), updated_at = now() where user_id = uid;
    return jsonb_build_object('ok', true, 'balance', bal, 'item', p_item);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'item');
end; $$;
revoke execute on function public.premium_spend(text, text) from public, anon;
grant execute on function public.premium_spend(text, text) to authenticated;

-- Статус своего заказа (магазин ждёт оплату после виджета или возврата со страницы оплаты)
create or replace function public.premium_order_status(p_order text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('ok', true, 'status', o.status, 'gems', o.gems, 'paid_at', o.paid_at,
      'balance', (select balance from public.premium_wallet where user_id = o.user_id))
    from public.premium_orders o where o.id = p_order and o.user_id = auth.uid()),
    jsonb_build_object('ok', false, 'reason', 'not_found'));
$$;
revoke execute on function public.premium_order_status(text) from public, anon;
grant execute on function public.premium_order_status(text) to authenticated;

-- ═══ 5. Для сервера (api/pay.js, ключ service_role). Клиенту и гостю — нельзя ═══
-- Заказ: пакет, провайдер, валюта; согласие взрослого; возраст (age.sql → age_shop_caps: до 13 — картой нельзя, 13–17 —
-- свои лимиты); лимиты (в рублях: сутки и 30 дней); не больше 10 неоплаченных за час
create or replace function public.premium_order_create(p_user uuid, p_pack text, p_provider text,
  p_currency text default 'KZT', p_consent boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pk jsonb := public.premium_pack(p_pack); s public.premium_settings%rowtype; v_amount numeric; v_rub int;
  v_day numeric; v_month numeric; v_id text; v_cur text := upper(coalesce(p_currency, 'KZT'));
  v_caps jsonb; v_day_cap int; v_month_cap int;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if pk is null then return jsonb_build_object('ok', false, 'reason', 'pack'); end if;
  if p_provider not in ('tiptop', 'freedom', 'kaspi') then return jsonb_build_object('ok', false, 'reason', 'provider'); end if;
  if v_cur not in ('KZT', 'RUB') then return jsonb_build_object('ok', false, 'reason', 'currency'); end if;
  if p_consent is not true then return jsonb_build_object('ok', false, 'reason', 'consent'); end if;
  if to_regprocedure('public.age_shop_caps(uuid)') is not null then
    execute 'select public.age_shop_caps($1)' into v_caps using p_user;
  end if;
  if not coalesce((v_caps->>'cards')::boolean, true) then return jsonb_build_object('ok', false, 'reason', 'age_child'); end if;
  select * into s from public.premium_settings where id = 1;
  v_day_cap := coalesce((v_caps->>'day_rub')::int, s.day_rub);
  v_month_cap := coalesce((v_caps->>'month_rub')::int, s.month_rub);
  v_amount := case v_cur when 'KZT' then (pk->>'kzt')::numeric else (pk->>'rub')::numeric end;
  v_rub := (pk->>'rub')::int;
  -- Один человек — по очереди (два заказа в одну секунду не обойдут лимит)
  perform pg_advisory_xact_lock(hashtext('premium_order:' || p_user::text));
  select coalesce(sum(rub) filter (where created_at > now() - interval '1 day'), 0), coalesce(sum(rub), 0)
    into v_day, v_month from public.premium_orders
    where user_id = p_user and status in ('paid', 'refunded') and created_at > now() - interval '30 days';
  if v_day + v_rub > v_day_cap then
    return jsonb_build_object('ok', false, 'reason', 'limit_day', 'left', greatest(0, v_day_cap - v_day));
  end if;
  if v_month + v_rub > v_month_cap then
    return jsonb_build_object('ok', false, 'reason', 'limit_month', 'left', greatest(0, v_month_cap - v_month));
  end if;
  if (select count(*) from public.premium_orders where user_id = p_user and status = 'new' and created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  v_id := 'D37-' || to_char(now() at time zone 'Asia/Almaty', 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.premium_wallet (user_id) values (p_user) on conflict (user_id) do nothing;
  update public.premium_wallet set consent_at = coalesce(consent_at, now()) where user_id = p_user;
  insert into public.premium_orders (id, user_id, pack, gems, amount, currency, rub, provider, consent)
    values (v_id, p_user, p_pack, (pk->>'gems')::int, v_amount, v_cur, v_rub, p_provider, true);
  return jsonb_build_object('ok', true, 'order', v_id, 'pack', p_pack, 'gems', (pk->>'gems')::int,
    'amount', v_amount, 'currency', v_cur, 'user', p_user);
end; $$;
revoke execute on function public.premium_order_create(uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.premium_order_create(uuid, text, text, text, boolean) to service_role;

create or replace function public.premium_order_get(p_order text)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(o) from public.premium_orders o where o.id = p_order
$$;
revoke execute on function public.premium_order_get(text) from public, anon, authenticated;
grant execute on function public.premium_order_get(text) to service_role;

-- Оплата прошла (подпись уже проверил сервер). Идемпотентно по (провайдер, номер платежа);
-- сумма и валюта должны совпасть с заказом, иначе — 'mismatch' (ничего не начисляем, видно админу)
create or replace function public.premium_credit(p_provider text, p_payment_id text, p_order text,
  p_amount numeric, p_currency text, p_test boolean default false, p_raw jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.premium_orders%rowtype; v_new int; bal int; v_status text;
begin
  if coalesce(p_provider, '') = '' or coalesce(p_payment_id, '') = '' then return jsonb_build_object('status', 'invalid'); end if;
  insert into public.premium_payments (provider, payment_id, order_id, amount, currency, status, test, raw)
    values (p_provider, p_payment_id, p_order, p_amount, upper(p_currency), 'new', coalesce(p_test, false), p_raw)
    on conflict (provider, payment_id) do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then
    select status into v_status from public.premium_payments where provider = p_provider and payment_id = p_payment_id;
    return jsonb_build_object('status', 'duplicate', 'was', v_status);
  end if;
  select * into o from public.premium_orders where id = p_order for update;
  if not found or o.user_id is null then
    update public.premium_payments set status = 'no_order' where provider = p_provider and payment_id = p_payment_id;
    return jsonb_build_object('status', 'no_order');
  end if;
  update public.premium_payments set user_id = o.user_id where provider = p_provider and payment_id = p_payment_id;
  if o.provider <> p_provider or round(coalesce(p_amount, -1), 2) <> o.amount or upper(coalesce(p_currency, '')) <> o.currency then
    update public.premium_payments set status = 'mismatch' where provider = p_provider and payment_id = p_payment_id;
    return jsonb_build_object('status', 'mismatch', 'want', o.amount, 'currency', o.currency);
  end if;
  -- Заказ уже оплачен другим платежом (человек заплатил дважды) — деньги пришли, 💎 тоже честно начисляем
  v_status := case when o.status = 'new' or o.status = 'failed' then 'credited' else 'extra' end;
  bal := public.premium_add(o.user_id, o.gems, 'pay', p_provider || ':' || p_payment_id,
    format('Покупка: %s 💎, заказ %s%s', o.gems, o.id, case when p_test then ' (тест)' else '' end));
  update public.premium_payments set status = v_status where provider = p_provider and payment_id = p_payment_id;
  update public.premium_orders set status = 'paid', paid_at = coalesce(paid_at, now()),
    payment_id = coalesce(payment_id, p_payment_id), test = coalesce(p_test, false) where id = o.id;
  if not coalesce(p_test, false) then
    -- Сумма поддержки → уровень VIP (Silver от 500 ₽, Gold от 1500 ₽), как у донатов; и 1 XP за 1 ₽ (до 1000)
    update public.profiles set total_donated = coalesce(total_donated, 0) + o.rub where id = o.user_id;
    begin
      perform public.xp_award(o.user_id, 'donation', 'pay:' || o.id || ':' || p_payment_id, least(1000, greatest(1, o.rub)), null);
    exception when others then null;
    end;
  end if;
  perform public.premium_notify(o.user_id, format('💎 +%s кристаллов', o.gems), 'Оплата прошла — кристаллы уже на балансе. Спасибо за поддержку!', 'pay:' || o.id);
  return jsonb_build_object('status', v_status, 'gems', o.gems, 'balance', bal, 'user', o.user_id, 'order', o.id);
end; $$;
revoke execute on function public.premium_credit(text, text, text, numeric, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.premium_credit(text, text, text, numeric, text, boolean, jsonb) to service_role;

-- Возврат денег (уведомление провайдера или админ). p_amount null — всё, что ещё не вернули. Идемпотентно по
-- p_refund_id; вернуть больше, чем заплатили, нельзя (сумма возвратов по платежу считается).
-- 💎 списываются, сколько есть; не хватило (уже потратил) — долг, гасится из следующих начислений
create or replace function public.premium_refund(p_provider text, p_payment_id text, p_refund_id text, p_amount numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pay public.premium_payments%rowtype; o public.premium_orders%rowtype; w public.premium_wallet%rowtype;
  v_done numeric; v_amt numeric; v_back int; v_take int; v_debt int; v_rub int; bal int;
begin
  if coalesce(p_refund_id, '') = '' then return jsonb_build_object('status', 'invalid'); end if;
  -- Замок на исходный платёж: возвраты по нему идут строго по одному
  select * into pay from public.premium_payments where provider = p_provider and payment_id = p_payment_id for update;
  if not found or pay.status not in ('credited', 'extra') then return jsonb_build_object('status', 'no_payment'); end if;
  if exists (select 1 from public.premium_payments where provider = p_provider and payment_id = 'refund:' || p_refund_id) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  select coalesce(sum(amount), 0) into v_done from public.premium_payments where provider = p_provider and refund_of = p_payment_id;
  v_amt := least(coalesce(p_amount, pay.amount - v_done), pay.amount - v_done);
  if v_amt <= 0 then return jsonb_build_object('status', 'already'); end if;
  insert into public.premium_payments (provider, payment_id, order_id, user_id, amount, currency, status, test, refund_of)
    values (p_provider, 'refund:' || p_refund_id, pay.order_id, pay.user_id, v_amt, pay.currency, 'refund', pay.test, p_payment_id);
  select * into o from public.premium_orders where id = pay.order_id for update;
  v_back := floor(o.gems * v_amt / pay.amount)::int;
  v_rub := floor(o.rub * v_amt / pay.amount)::int;
  insert into public.premium_wallet (user_id) values (pay.user_id) on conflict (user_id) do nothing;
  select * into w from public.premium_wallet where user_id = pay.user_id for update;
  v_take := least(w.balance, v_back);
  v_debt := v_back - v_take;
  update public.premium_wallet set balance = balance - v_take, debt = debt + v_debt, updated_at = now()
    where user_id = pay.user_id returning balance into bal;
  insert into public.premium_ledger (user_id, amount, balance, kind, ref, note)
    values (pay.user_id, -v_take, bal, 'refund', p_provider || ':' || p_refund_id,
      format('Возврат денег за заказ %s%s', o.id, case when v_debt > 0 then format(' (не хватило %s 💎 — записано долгом)', v_debt) else '' end));
  if v_done + v_amt >= pay.amount then update public.premium_orders set status = 'refunded' where id = o.id; end if;
  if not pay.test then
    update public.profiles set total_donated = greatest(0, coalesce(total_donated, 0) - v_rub) where id = pay.user_id;
  end if;
  perform public.premium_notify(pay.user_id, '↩️ Возврат денег за кристаллы',
    format('Деньги за заказ %s возвращены, списано %s 💎%s.', o.id, v_take,
      case when v_debt > 0 then format(', долг %s 💎 спишется из следующих начислений', v_debt) else '' end), null);
  return jsonb_build_object('status', 'refunded', 'gems', v_back, 'taken', v_take, 'debt', v_debt, 'balance', bal);
end; $$;
revoke execute on function public.premium_refund(text, text, text, numeric) from public, anon, authenticated;
grant execute on function public.premium_refund(text, text, text, numeric) to service_role;

-- Оплата не прошла (для истории заказа)
create or replace function public.premium_order_fail(p_order text, p_reason text default null)
returns jsonb language sql security definer set search_path = public as $$
  update public.premium_orders set status = 'failed', note = left(p_reason, 200) where id = p_order and status = 'new';
  select jsonb_build_object('status', 'ok');
$$;
revoke execute on function public.premium_order_fail(text, text) from public, anon, authenticated;
grant execute on function public.premium_order_fail(text, text) to service_role;

-- ═══ 6. Донат DonationAlerts → 💎 (режим «кристаллы») ═══
create or replace function public.premium_donation_credit(p_uid uuid, p_rub numeric, p_donation_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare v_gems int := public.premium_donation_gems(p_rub);
begin
  if v_gems <= 0 then return 0; end if;
  perform public.premium_add(p_uid, v_gems, 'donation', p_donation_id::text, format('Донат %s ₽', round(p_rub, 2)));
  perform public.premium_notify(p_uid, format('💎 +%s кристаллов за донат', v_gems), 'Спасибо за поддержку! Потратить — в магазине.', 'don:' || p_donation_id);
  return v_gems;
end; $$;
revoke execute on function public.premium_donation_credit(uuid, numeric, bigint) from public, anon, authenticated;

-- credit_donation — как в server-hardening.sql, плюс режим «кристаллы» (premium_mode = 'gems')
create or replace function public.credit_donation(
  p_id         bigint,
  p_username   text,
  p_amount     numeric,
  p_currency   text default 'RUB',
  p_donated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof      public.profiles%rowtype;
  v_claimed   int;
  v_pending   numeric;
  v_months    int;
  v_new_until timestamptz;
  v_gems      int;
begin
  if coalesce(auth.role(), '') not in ('', 'service_role') and not public.is_admin_user(auth.uid()) then
    raise exception 'Нет прав начислять донаты';
  end if;

  if p_id is null or p_amount is null or p_amount <= 0 or coalesce(btrim(p_username), '') = '' then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtext('credit_donation'));

  insert into public.vip_donation_log (donation_id, matched, donor_username, amount, currency, donated_at)
  values (p_id, false, left(btrim(p_username), 64), p_amount, upper(coalesce(p_currency, 'RUB')), coalesce(p_donated_at, now()))
  on conflict (donation_id) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    return jsonb_build_object('status', 'duplicate');
  end if;

  if upper(coalesce(p_currency, 'RUB')) <> 'RUB' then
    return jsonb_build_object('status', 'unmatched', 'reason', 'currency');
  end if;

  select * into v_prof from public.profiles
  where lower(donate_login) = lower(btrim(p_username))
  limit 1
  for update;
  if not found then
    return jsonb_build_object('status', 'unmatched', 'reason', 'no_profile');
  end if;

  -- 💎 Человек выбрал «донат → кристаллы»: кристаллы вместо месяцев VIP, сумма поддержки растёт как обычно
  if public.premium_mode(v_prof.id) = 'gems' then
    v_gems := public.premium_donation_credit(v_prof.id, p_amount, p_id);
    update public.profiles set total_donated = coalesce(total_donated, 0) + p_amount where id = v_prof.id;
    update public.vip_donation_log set matched = true, profile_id = v_prof.id, months_granted = 0, gems_granted = v_gems
    where donation_id = p_id;
    return jsonb_build_object('status', 'credited', 'months', 0, 'gems', v_gems, 'nick', v_prof.nick);
  end if;

  v_pending := coalesce(v_prof.vip_pending_rub, 0) + p_amount;
  v_months  := floor(v_pending / 100)::int;

  v_new_until := v_prof.vip_until;
  if v_months >= 1 then
    if v_prof.is_vip is true and v_prof.vip_until is null then
      v_new_until := null;
    else
      v_new_until := (case when v_prof.is_vip is true and v_prof.vip_until > now() then v_prof.vip_until else now() end)
                     + make_interval(months => v_months);
    end if;
  end if;

  update public.profiles set
    total_donated   = coalesce(total_donated, 0) + p_amount,
    vip_pending_rub = v_pending - v_months * 100,
    is_vip          = case when v_months >= 1 then true else is_vip end,
    vip_until       = case when v_months >= 1 then v_new_until else vip_until end
  where id = v_prof.id;

  update public.vip_donation_log
  set matched = true, profile_id = v_prof.id, months_granted = v_months
  where donation_id = p_id;

  return jsonb_build_object('status', 'credited', 'months', v_months, 'nick', v_prof.nick);
end;
$$;
revoke all on function public.credit_donation(bigint, text, numeric, text, timestamptz) from public, anon;
grant execute on function public.credit_donation(bigint, text, numeric, text, timestamptz) to authenticated, service_role;

-- apply_unmatched_donation — как в vip-claims.sql («задонатил, а VIP не пришёл»), плюс режим «кристаллы»
create or replace function public.apply_unmatched_donation(p_donation_id bigint, p_profile uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.vip_donation_log%rowtype;
  v_prof public.profiles%rowtype;
  v_pending numeric; v_months int; v_new_until timestamptz; v_gems int;
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

  if public.premium_mode(p_profile) = 'gems' then
    v_gems := public.premium_donation_credit(p_profile, d.amount, p_donation_id);
    update public.profiles set total_donated = coalesce(total_donated, 0) + d.amount where id = p_profile;
    update public.vip_donation_log set matched = true, profile_id = p_profile, months_granted = 0, gems_granted = v_gems
    where donation_id = p_donation_id;
    return jsonb_build_object('status', 'credited', 'months', 0, 'gems', v_gems, 'amount', d.amount);
  end if;

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

-- ═══ 7. Админ (кнопки в магазине, только role = admin) ═══
create or replace function public.premium_admin_check()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'Только для админа'; end if;
end; $$;

-- Найти человека по нику (кусок ника, без учёта регистра)
create or replace function public.premium_admin_find(p_q text)
returns table(user_id uuid, nick text, balance int, debt int, mode text, total_donated numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.premium_admin_check();
  return query
    select p.id, p.nick, coalesce(w.balance, 0), coalesce(w.debt, 0), coalesce(w.donate_mode, 'vip'), coalesce(p.total_donated, 0)
    from public.profiles p left join public.premium_wallet w on w.user_id = p.id
    where char_length(btrim(coalesce(p_q, ''))) >= 2 and position(lower(btrim(p_q)) in lower(coalesce(p.nick, ''))) > 0
    order by (lower(p.nick) = lower(btrim(p_q))) desc, p.nick
    limit 20;
end; $$;
grant execute on function public.premium_admin_find(text) to authenticated;

-- Начислить (+) или списать (−) с причиной. Списать больше, чем есть, нельзя
create or replace function public.premium_admin_grant(p_user uuid, p_amount int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare bal int;
begin
  perform public.premium_admin_check();
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then return jsonb_build_object('ok', false, 'reason', 'reason'); end if;
  if not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('ok', false, 'reason', 'user'); end if;
  bal := public.premium_add(p_user, p_amount, case when p_amount > 0 then 'grant' else 'revoke' end,
    'admin:' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'), btrim(p_reason), auth.uid());
  if bal is null then return jsonb_build_object('ok', false, 'reason', 'gems'); end if;
  if p_amount > 0 then
    perform public.premium_notify(p_user, format('💎 +%s кристаллов', p_amount), left(btrim(p_reason), 150), null);
  end if;
  return jsonb_build_object('ok', true, 'balance', bal);
end; $$;
grant execute on function public.premium_admin_grant(uuid, int, text) to authenticated;

-- Журнал любого человека
create or replace function public.premium_admin_history(p_user uuid, p_limit int default 50)
returns setof public.premium_ledger language plpgsql stable security definer set search_path = public as $$
begin
  perform public.premium_admin_check();
  return query select * from public.premium_ledger where user_id = p_user order by id desc limit least(greatest(coalesce(p_limit, 50), 1), 500);
end; $$;
grant execute on function public.premium_admin_history(uuid, int) to authenticated;

-- Что требует внимания: заказы Kaspi (ждут проверки оплаты), платежи с несовпавшей суммой, последние оплаты
create or replace function public.premium_admin_orders()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.premium_admin_check();
  return jsonb_build_object(
    'kaspi', coalesce((select jsonb_agg(x order by x.created_at) from (
      select o.id, o.user_id, p.nick, o.pack, o.gems, o.amount, o.currency, o.created_at from public.premium_orders o
      left join public.profiles p on p.id = o.user_id
      where o.provider = 'kaspi' and o.status = 'new' and o.created_at > now() - interval '14 days') x), '[]'::jsonb),
    'problems', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select y.provider, y.payment_id, y.order_id, y.user_id, p.nick, y.amount, y.currency, y.status, y.created_at
      from public.premium_payments y left join public.profiles p on p.id = y.user_id
      where y.status in ('mismatch', 'no_order') and y.created_at > now() - interval '60 days' limit 50) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x order by x.paid_at desc) from (
      select o.id, o.user_id, p.nick, o.gems, o.amount, o.currency, o.provider, o.status, o.test, o.paid_at from public.premium_orders o
      left join public.profiles p on p.id = o.user_id
      where o.status in ('paid', 'refunded') order by o.paid_at desc nulls last limit 20) x), '[]'::jsonb),
    'settings', (select to_jsonb(s) from public.premium_settings s where s.id = 1));
end; $$;
grant execute on function public.premium_admin_orders() to authenticated;

-- Kaspi (оплата без API): админ увидел деньги в Kaspi Pay → «Оплачено» → 💎 начисляются как за обычную покупку
create or replace function public.premium_admin_mark_paid(p_order text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.premium_orders%rowtype;
begin
  perform public.premium_admin_check();
  select * into o from public.premium_orders where id = p_order;
  if not found or o.status <> 'new' then return jsonb_build_object('status', 'gone'); end if;
  return public.premium_credit(o.provider, 'manual:' || o.id, o.id, o.amount, o.currency, false,
    jsonb_build_object('admin', auth.uid(), 'note', left(p_note, 200)));
end; $$;
grant execute on function public.premium_admin_mark_paid(text, text) to authenticated;

-- Админ вернул деньги сам (в кабинете провайдера или в Kaspi) → списать 💎 за этот заказ
create or replace function public.premium_admin_refund(p_order text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.premium_orders%rowtype; pid text;
begin
  perform public.premium_admin_check();
  select * into o from public.premium_orders where id = p_order;
  if not found or o.status <> 'paid' then return jsonb_build_object('status', 'gone'); end if;
  select payment_id into pid from public.premium_payments
    where order_id = o.id and status in ('credited', 'extra') order by created_at limit 1;
  if pid is null then return jsonb_build_object('status', 'no_payment'); end if;
  return public.premium_refund(o.provider, pid, 'admin:' || o.id, null);
end; $$;
grant execute on function public.premium_admin_refund(text) to authenticated;

-- Настройки: курс доната (💎 за 1 ₽), бонус, лимиты в рублях, открыт ли магазин
create or replace function public.premium_admin_settings(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.premium_settings%rowtype;
begin
  perform public.premium_admin_check();
  select * into s from public.premium_settings where id = 1 for update;
  if p ? 'donate_rate' then s.donate_rate := greatest(0.01, least(100, (p->>'donate_rate')::numeric)); end if;
  if p ? 'donate_bonus' then s.donate_bonus := (p->>'donate_bonus')::boolean; end if;
  if p ? 'day_rub' then s.day_rub := greatest(0, least(1000000, (p->>'day_rub')::int)); end if;
  if p ? 'month_rub' then s.month_rub := greatest(0, least(10000000, (p->>'month_rub')::int)); end if;
  if p ? 'shop_open' then s.shop_open := (p->>'shop_open')::boolean; end if;
  update public.premium_settings set donate_rate = s.donate_rate, donate_bonus = s.donate_bonus, day_rub = s.day_rub,
    month_rub = s.month_rub, shop_open = s.shop_open, updated_at = now(), updated_by = auth.uid() where id = 1
    returning * into s;
  return to_jsonb(s);
end; $$;
grant execute on function public.premium_admin_settings(jsonb) to authenticated;

-- Служебные — только изнутри
revoke execute on function public.premium_admin_check() from public, anon;
revoke execute on function public.premium_donation_gems(numeric) from public, anon, authenticated;
revoke execute on function public.premium_mode(uuid) from public, anon, authenticated;

-- Проверка (необязательно):
-- select public.premium_state();                      -- в SQL Editor: {"ok": false, "reason": "auth", …}
-- select * from public.premium_ledger order by id desc limit 20;
-- select * from public.premium_orders order by created_at desc limit 20;
