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
--
--  22.10.2026 (владелец: «донаты переделать — просто будет донатер»; «абуз с ником "Аноним" решить»; оплата — пока только Kaspi):
--   • Выключатель site_config 'donate_rewards': 'off' (по умолчанию, строки нет) — донат НЕ даёт VIP, 💎, XP и бонус пригласившему,
--     а даёт статус «💛 Донатер» на 30 дней; 'vip' — как было (каждый сам выбирает VIP / 💎), 'gems' — все донаты в 💎.
--   • «💛 Донатер» — временный статус: уровень = сумма привязанных донатов за последние 30 дней (скользящее окно), уровни —
--     donor_levels() (= js/core/premium.js D37Donor.LEVELS = api/_lib/premium.js DONOR_LEVELS; тест сверяет). Бонусы — как у VIP
--     того же ранга (perk_tier_of = лучшее из VIP и донатера): has_perks, закреп, невидимка, лимит друзей — переопределены здесь.
--   • Привязка доната: имена «Аноним», «гость», «без имени»… (donor_name_reserved) не бывают ни логином, ни ником и ни к кому не
--     привязываются; донат засчитывается, только если сделан ПОСЛЕ регистрации и после того, как этот логин стал твоим
--     (reserved_donate_logins) — раньше только решением админа; «похожее имя» (≤ 2 опечатки) — само только до donor_rule('auto_max') ₽.
--   • Остаток к VIP-месяцу (vip_pending_rub) при выключенных наградах — один раз в дни VIP пропорционально (donor_convert_pending).
--   • Платежи: до 14 лет — нельзя, 14–17 — лимиты и галочка взрослого, год не указан — сначала указать (premium_pay_age); перед
--     оплатой — согласие на обработку данных (premium_order_create p_pd). Налог — ставка и период у владельца, отчёт premium_admin_income.
--  ‼ Здесь переопределены функции других файлов: has_perks, pin_own_message (vip-balance.sql), can_be_invisible,
--    can_send_friend_requests (progression.sql), friend_limit (economy.sql), claim_donation, apply_unmatched_donation,
--    admin_resolve_claim, admin_close_claim_manual (vip-claims.sql), credit_donation (server-hardening.sql), xp_on_donation
--    (progression.sql), ref_on_donation (referrals2.sql), premium_state и premium_order_create (раньше копия была и в age.sql).
--    Перезапустил любой из этих файлов — потом снова premium.sql.
--  Проверка (22.10): /rpc/donor_me гостем → {"ok":false,"reason":"auth",…}; /rpc/donor_levels → [{"lv":1,"min":100,…},…].
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
-- 22.10: что дал донат и разбор привязки (раздел 8)
alter table public.vip_donation_log add column if not exists reward text;        -- vip | gems | status («Донатер») | null — старые записи
alter table public.vip_donation_log add column if not exists excluded boolean not null default false;   -- админ: не считать в статус
alter table public.vip_donation_log add column if not exists checked_at timestamptz;   -- админ посмотрел подозрительное: «всё в порядке»
alter table public.vip_donation_log add column if not exists hold text;          -- почему не привязан сам: reserved | before_reg | before_login | no_profile | currency
alter table public.vip_donation_log add column if not exists hold_profile uuid;  -- чей логин совпал (решает админ)
alter table public.vip_donation_log add column if not exists message text;       -- текст доната (только у непривязанных — для админа, до 200 знаков)
create index if not exists idx_vip_donation_log_donor on public.vip_donation_log (profile_id) where matched;
do $$ begin
  if to_regclass('public.donation_claims') is not null then
    alter table public.donation_claims add column if not exists flags text[] not null default '{}';   -- почему не само: big, ambiguous…
    alter table public.donation_claims add column if not exists note text;
  end if;
end $$;

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
-- Налог (22.10): ставка и период задаёт владелец (уточнить у бухгалтера); пусто — «не указано». Цены на сайте — окончательные
alter table public.premium_settings add column if not exists tax_pct numeric;     -- % (например 4); null — не указана
alter table public.premium_settings add column if not exists tax_period text;     -- month | quarter | half | year; null — не выбран
do $$ begin
  alter table public.premium_settings add constraint premium_settings_tax check ((tax_pct is null or (tax_pct >= 0 and tax_pct <= 100))
    and (tax_period is null or tax_period in ('month', 'quarter', 'half', 'year')));
exception when duplicate_object then null; end $$;

create table if not exists public.premium_wallet (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance int not null default 0 check (balance >= 0),
  debt int not null default 0 check (debt >= 0),    -- вернул деньги, а 💎 уже потратил — гасится из новых
  donate_mode text not null default 'vip' check (donate_mode in ('vip', 'gems')),
  consent_at timestamptz,                           -- первая покупка с отметкой «платит взрослый / с разрешения»
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.premium_wallet add column if not exists pd_consent_at timestamptz;   -- первое согласие на обработку данных (22.10)
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
alter table public.premium_orders add column if not exists pd_consent boolean not null default false;   -- согласие на обработку данных (22.10)
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
-- Можно ли платить по возрасту (22.10, docs/REALMS.md): до 14 лет — нельзя; 14–17 — можно с лимитами (age.sql → age_shop_caps) и
-- галочкой взрослого; год не указан — сначала указать (его видит только сам человек); 18+ — как раньше. «Остывание» age.sql (стал
-- «старше» — 30 дней правила прежней группы): прежняя группа «до 13» или «13–15» — как до 14 (точный прежний год не хранится).
-- → { ok, reason: age_unknown | age_child }. Нет age.sql (таблицы user_age) — год указать негде: age_unknown
create or replace function public.premium_pay_age(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_year int; v_floor text; v_until timestamptz; v_now int; v_age int;
begin
  if p_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if to_regclass('public.user_age') is null then return jsonb_build_object('ok', false, 'reason', 'age_unknown'); end if;
  execute 'select birth_year, floor_group, floor_until from public.user_age where user_id = $1' into v_year, v_floor, v_until using p_uid;
  if v_floor in ('child', 'teen') and v_until > now() then return jsonb_build_object('ok', false, 'reason', 'age_child'); end if;
  if v_year is null then return jsonb_build_object('ok', false, 'reason', 'age_unknown'); end if;
  v_now := extract(year from (now() at time zone 'Europe/Moscow'))::int;
  v_age := v_now - v_year - 1;                      -- возраст «не меньше» (как age_group_year в age.sql)
  if v_age < 14 then return jsonb_build_object('ok', false, 'reason', 'age_child'); end if;
  return jsonb_build_object('ok', true, 'teen', v_age < 18);
end $$;
revoke execute on function public.premium_pay_age(uuid) from public, anon, authenticated;

-- Состояние: баланс, режим доната, пакеты и товары, лимиты, история. Гостю — только витрина.
-- Возраст: pay_age (premium_pay_age) — можно ли платить; 14–17 лет — свои лимиты (age.sql → age_shop_caps). Нет age.sql — лимиты общие
create or replace function public.premium_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); w public.premium_wallet%rowtype; s public.premium_settings%rowtype;
  v_day numeric; v_month numeric; v_pending numeric; v_caps jsonb; v_age jsonb;
begin
  select * into s from public.premium_settings where id = 1;
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth', 'packs', public.premium_packs(), 'items', public.premium_items(),
      'rate', s.donate_rate, 'bonus', s.donate_bonus, 'open', s.shop_open, 'donate_rewards', public.donate_rewards_mode());
  end if;
  select * into w from public.premium_wallet where user_id = uid;
  select coalesce(sum(rub) filter (where created_at > now() - interval '1 day'), 0), coalesce(sum(rub), 0)
    into v_day, v_month from public.premium_orders
    where user_id = uid and status in ('paid', 'refunded') and created_at > now() - interval '30 days';
  select coalesce(vip_pending_rub, 0) into v_pending from public.profiles where id = uid;
  if to_regprocedure('public.age_shop_caps(uuid)') is not null then
    execute 'select public.age_shop_caps($1)' into v_caps using uid;
  end if;
  v_age := public.premium_pay_age(uid);
  return jsonb_build_object('ok', true,
    'balance', coalesce(w.balance, 0), 'debt', coalesce(w.debt, 0), 'mode', coalesce(w.donate_mode, 'vip'),
    'consent', w.consent_at is not null, 'pending_rub', floor(coalesce(v_pending, 0)),
    'rate', s.donate_rate, 'bonus', s.donate_bonus, 'open', s.shop_open, 'donate_rewards', public.donate_rewards_mode(),
    'limits', jsonb_build_object('day_rub', coalesce((v_caps->>'day_rub')::int, s.day_rub), 'month_rub', coalesce((v_caps->>'month_rub')::int, s.month_rub),
      'used_day', v_day, 'used_month', v_month),
    'cards', coalesce((v_age->>'ok')::boolean, false), 'pay_age', v_age->>'reason',
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
  -- 22.10: донаты не дают ни VIP, ни 💎 (выключатель donate_rewards) — выбирать нечего
  if public.donate_rewards_mode() = 'off' then return jsonb_build_object('ok', false, 'reason', 'off'); end if;
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
-- Заказ: пакет, провайдер, валюта; согласие взрослого (p_consent) и на обработку данных (p_pd); возраст (premium_pay_age: до 14 —
-- нельзя, год не указан — сначала указать; 14–17 — лимиты age.sql → age_shop_caps); лимиты (в рублях: сутки и 30 дней); не больше
-- 10 неоплаченных за час. 22.10: + p_pd (старый вариант без него удаляется — иначе PostgREST не выберет между двумя)
drop function if exists public.premium_order_create(uuid, text, text, text, boolean);
create or replace function public.premium_order_create(p_user uuid, p_pack text, p_provider text,
  p_currency text default 'KZT', p_consent boolean default false, p_pd boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pk jsonb := public.premium_pack(p_pack); s public.premium_settings%rowtype; v_amount numeric; v_rub int;
  v_day numeric; v_month numeric; v_id text; v_cur text := upper(coalesce(p_currency, 'KZT'));
  v_caps jsonb; v_day_cap int; v_month_cap int; v_age jsonb;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if pk is null then return jsonb_build_object('ok', false, 'reason', 'pack'); end if;
  if p_provider not in ('tiptop', 'freedom', 'kaspi') then return jsonb_build_object('ok', false, 'reason', 'provider'); end if;
  if v_cur not in ('KZT', 'RUB') then return jsonb_build_object('ok', false, 'reason', 'currency'); end if;
  if p_consent is not true then return jsonb_build_object('ok', false, 'reason', 'consent'); end if;
  if p_pd is not true then return jsonb_build_object('ok', false, 'reason', 'pd'); end if;
  v_age := public.premium_pay_age(p_user);
  if not coalesce((v_age->>'ok')::boolean, false) then return jsonb_build_object('ok', false, 'reason', coalesce(v_age->>'reason', 'age_unknown')); end if;
  if to_regprocedure('public.age_shop_caps(uuid)') is not null then
    execute 'select public.age_shop_caps($1)' into v_caps using p_user;
  end if;
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
  update public.premium_wallet set consent_at = coalesce(consent_at, now()), pd_consent_at = coalesce(pd_consent_at, now()) where user_id = p_user;
  insert into public.premium_orders (id, user_id, pack, gems, amount, currency, rub, provider, consent, pd_consent)
    values (v_id, p_user, p_pack, (pk->>'gems')::int, v_amount, v_cur, v_rub, p_provider, true, true);
  return jsonb_build_object('ok', true, 'order', v_id, 'pack', p_pack, 'gems', (pk->>'gems')::int,
    'amount', v_amount, 'currency', v_cur, 'user', p_user);
end; $$;
revoke execute on function public.premium_order_create(uuid, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.premium_order_create(uuid, text, text, text, boolean, boolean) to service_role;

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

-- ═══ 6. Донаты DonationAlerts: выключатель, «💛 Донатер», привязка без абуза (22.10.2026) ═══
-- Выключатель: site_config 'donate_rewards' — 'off' (по умолчанию: строки нет) — донат даёт статус «Донатер» (без VIP, 💎, XP и
-- бонуса пригласившему); 'vip' — как было до 22.10 (каждый сам выбирает: месяц VIP за 100 ₽ или 💎); 'gems' — все донаты в 💎.
-- Вернуть как было — одна строка: insert into site_config(key, value) values ('donate_rewards', 'vip') on conflict (key) do update set value = 'vip';
create or replace function public.donate_rewards_mode()
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if to_regclass('public.site_config') is null then return 'off'; end if;
  select value into v from public.site_config where key = 'donate_rewards';
  v := lower(btrim(coalesce(v, ''), '" '));
  return case when v in ('vip', 'gems') then v else 'off' end;
end $$;
grant execute on function public.donate_rewards_mode() to anon, authenticated;

-- Числа — ОДНО место (= js/core/premium.js D37Donor.LEVELS / RULES = api/_lib/premium.js DONOR_LEVELS / DONOR_RULES; тесты сверяют).
-- ПРЕДЛОЖЕНИЕ — решает владелец. lv — уровень «Донатер I…IV»; min — сколько ₽ донатов за последние days дней;
-- perk — бонусы как у VIP этого ранга (bronze — как VIP, silver, gold). auto_max — «похожее имя» (≤ 2 опечатки) привязывается само
-- только для доната меньше этой суммы, крупнее — решает админ; claims_day — заявок «донат не привязался» в сутки
create or replace function public.donor_levels() returns jsonb language sql immutable as $$
  select '[{"lv":1,"min":100,"perk":"bronze"},{"lv":2,"min":300,"perk":"silver"},{"lv":3,"min":700,"perk":"gold"},{"lv":4,"min":1500,"perk":"gold"}]'::jsonb
$$;
create or replace function public.donor_rule(p_key text) returns int language sql immutable as $$
  select case p_key when 'days' then 30 when 'auto_max' then 300 when 'claims_day' then 5 end
$$;
grant execute on function public.donor_levels() to anon, authenticated;
grant execute on function public.donor_rule(text) to anon, authenticated;

-- ── Имена, которые ни к кому не привязываются и не бывают ни ником, ни логином для доната ──
-- Ключ имени: регистр, ё → е, латинские «двойники» (a, e, o, p, c, x, y, k, m, h, b, t, 0) → кириллица, без пробелов и знаков.
-- Кириллица в нижний регистр — через translate (lower() у базы без нужной локали её не трогает). Тот же ключ — в js/core/premium.js
-- и api/_lib/premium.js (donorNameKey)
create or replace function public.donor_name_key(t text) returns text language sql immutable as $$
  select regexp_replace(
    translate(lower(translate(coalesce(t, ''), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё', 'абвгдеежзийклмнопрстуфхцчшщъыьэюяе')),
      'aeopcxykmhbt0', 'аеорсхукмнвто'),
    '[^a-zа-я0-9]', '', 'g')
$$;
-- Слова — те же списки в js/core/premium.js (D37Donor.RESERVED) и api/_lib/premium.js (DONOR_RESERVED); тест сверяет.
-- Пустое имя (только пробелы, знаки, смайлики) — тоже «аноним»
create or replace function public.donor_name_reserved(t text) returns boolean language sql immutable as $$
  select k = ''
    or k = any (array(select public.donor_name_key(w) from unnest(array[
      'аноним', 'анонимно', 'анонимный', 'анонимная', 'анонимус', 'анон', 'anonymous', 'anonym', 'anonim', 'anonimus', 'anon',
      'гость', 'гостья', 'guest', 'без имени', 'безымянный', 'безымянная', 'noname', 'no name', 'nameless', 'unknown',
      'неизвестный', 'неизвестная', 'неизвестно', 'нет имени', 'ваше имя', 'your name', 'имя', 'name', 'никто', 'nobody',
      'user', 'пользователь', 'donationalerts', 'донатер', 'донатёр', 'donater', 'donator', 'donor']) w))
    or exists (select 1 from unnest(array['аноним', 'anonym', 'anonim']) p where k like public.donor_name_key(p) || '%')
  from (select public.donor_name_key(t) k) x
$$;
grant execute on function public.donor_name_key(text) to anon, authenticated;
grant execute on function public.donor_name_reserved(text) to anon, authenticated;

-- ── Статус «Донатер»: уровень по сумме привязанных донатов за последние days дней (скользящее окно) ──
-- В статус идут донаты с reward = 'status' (после 22.10; прежние уже дали VIP/💎), не исключённые админом. Считается при чтении —
-- без расписаний: новый донат и истечение срока видны сразу. Индекс — по человеку и времени (на каждом сообщении чата — дёшево)
create index if not exists idx_vip_donation_log_status on public.vip_donation_log (profile_id, (coalesce(donated_at, processed_at)))
  where matched and reward = 'status' and not excluded;
create index if not exists idx_vip_donation_log_open on public.vip_donation_log (amount) where not matched;
create index if not exists idx_vip_donation_log_name on public.vip_donation_log (lower(btrim(donor_username))) where matched;

create or replace function public.donor_level_for(p_sum numeric) returns int language sql immutable as $$
  select coalesce(max((e->>'lv')::int), 0) from jsonb_array_elements(public.donor_levels()) e where coalesce(p_sum, 0) >= (e->>'min')::numeric
$$;
create or replace function public.donor_sum(p_uid uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.amount), 0) from public.vip_donation_log l
  where l.profile_id = p_uid and l.matched and l.reward = 'status' and not l.excluded
    and coalesce(l.donated_at, l.processed_at) > now() - make_interval(days => public.donor_rule('days'))
$$;
create or replace function public.donor_level_of(p_uid uuid) returns int language sql stable security definer set search_path = public as $$
  select public.donor_level_for(public.donor_sum(p_uid))
$$;
-- Ранг бонусов донатера (bronze / silver / gold) или null
create or replace function public.donor_perk_of(p_uid uuid) returns text language sql stable security definer set search_path = public as $$
  select e->>'perk' from jsonb_array_elements(public.donor_levels()) e where (e->>'lv')::int = public.donor_level_of(p_uid)
$$;
-- Уровень, сумма, до когда держится этот уровень (until) и статус вообще (until_any), сколько до следующего
create or replace function public.donor_status(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_days int := public.donor_rule('days'); v_from timestamptz := now() - make_interval(days => public.donor_rule('days'));
  v_sum numeric := 0; v_lv int; v_min numeric; v_min1 numeric; v_left numeric; v_until timestamptz; v_any timestamptz; v_next jsonb; r record;
begin
  if p_uid is null then return jsonb_build_object('level', 0, 'sum', 0); end if;
  select coalesce(sum(l.amount), 0) into v_sum from public.vip_donation_log l
    where l.profile_id = p_uid and l.matched and l.reward = 'status' and not l.excluded and coalesce(l.donated_at, l.processed_at) > v_from;
  v_lv := public.donor_level_for(v_sum);
  select (e->>'min')::numeric into v_min1 from jsonb_array_elements(public.donor_levels()) e where (e->>'lv')::int = 1;
  select e into v_next from jsonb_array_elements(public.donor_levels()) e where (e->>'lv')::int = v_lv + 1;
  if v_lv > 0 then
    select (e->>'min')::numeric into v_min from jsonb_array_elements(public.donor_levels()) e where (e->>'lv')::int = v_lv;
    v_left := v_sum;
    -- старые донаты выпадают из окна первыми: уровень держится, пока остаток не меньше порога
    for r in select l.amount a, coalesce(l.donated_at, l.processed_at) t from public.vip_donation_log l
      where l.profile_id = p_uid and l.matched and l.reward = 'status' and not l.excluded and coalesce(l.donated_at, l.processed_at) > v_from
      order by 2 loop
      v_left := v_left - r.a;
      if v_until is null and v_left < v_min then v_until := r.t + make_interval(days => v_days); end if;
      if v_left < v_min1 then v_any := r.t + make_interval(days => v_days); exit; end if;
    end loop;
  end if;
  return jsonb_build_object('level', v_lv, 'sum', v_sum, 'until', v_until, 'until_any', v_any,
    'next', case when v_next is not null then jsonb_build_object('level', (v_next->>'lv')::int, 'need', greatest(0, (v_next->>'min')::numeric - v_sum)) end);
end $$;
revoke execute on function public.donor_sum(uuid) from public, anon, authenticated;
revoke execute on function public.donor_status(uuid) from public, anon, authenticated;
grant execute on function public.donor_level_for(numeric) to anon, authenticated;

create or replace function public.donor_roman(p_lv int) returns text language sql immutable as $$
  select (array['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'])[greatest(1, least(8, p_lv))]
$$;

-- Уведомление 🔔 про донат (notifications.sql). Нет его — молча
create or replace function public.donor_notify(p_uid uuid, p_title text, p_body text, p_dedupe text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.notify(p_uid, 'donor', null, p_title, p_body, '#/profile', p_dedupe);
  exception when others then null;
  end;
end; $$;
revoke execute on function public.donor_notify(uuid, text, text, text) from public, anon, authenticated;

-- Донат → 💎 (режимы 'gems' и 'vip' с выбором «кристаллы»)
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

-- Привязать донат к человеку — по выключателю. Внутренняя: проверки и замок — у вызывающего (credit_donation, apply_unmatched_donation).
-- 'off' — статус «Донатер» (VIP, 💎, сумма поддержки total_donated и XP — не меняются); 'gems' или выбор «кристаллы» — 💎;
-- 'vip' — 100 ₽ = месяц VIP, остаток копится (как до 22.10)
create or replace function public.donor_apply(p_donation_id bigint, p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.vip_donation_log%rowtype; v_prof public.profiles%rowtype; v_mode text := public.donate_rewards_mode();
  v_pending numeric; v_months int; v_new_until timestamptz; v_gems int; st jsonb;
begin
  select * into d from public.vip_donation_log where donation_id = p_donation_id for update;
  select * into v_prof from public.profiles where id = p_uid for update;
  if v_mode = 'off' then
    update public.vip_donation_log set matched = true, profile_id = p_uid, months_granted = 0, gems_granted = 0, reward = 'status',
      hold = null, hold_profile = null, message = null where donation_id = p_donation_id;
    st := public.donor_status(p_uid);
    perform public.donor_notify(p_uid, '💛 Спасибо за поддержку стрима!',
      case when (st->>'level')::int > 0
        then format('%s ₽ засчитаны. Ты — «Донатер %s» до %s.', round(d.amount), public.donor_roman((st->>'level')::int),
          to_char((st->>'until')::timestamptz at time zone 'Europe/Moscow', 'DD.MM'))
        else format('%s ₽ засчитаны. До статуса «Донатер I» — ещё %s ₽ за %s дней.', round(d.amount),
          round(coalesce((st->'next'->>'need')::numeric, 0)), public.donor_rule('days')) end,
      'don:' || p_donation_id);
    return jsonb_build_object('status', 'credited', 'months', 0, 'gems', 0, 'reward', 'status', 'level', (st->>'level')::int,
      'until', st->'until', 'nick', v_prof.nick, 'amount', d.amount);
  end if;
  if v_mode = 'gems' or public.premium_mode(p_uid) = 'gems' then
    v_gems := public.premium_donation_credit(p_uid, d.amount, p_donation_id);
    update public.profiles set total_donated = coalesce(total_donated, 0) + d.amount where id = p_uid;
    update public.vip_donation_log set matched = true, profile_id = p_uid, months_granted = 0, gems_granted = v_gems, reward = 'gems',
      hold = null, hold_profile = null, message = null where donation_id = p_donation_id;
    return jsonb_build_object('status', 'credited', 'months', 0, 'gems', v_gems, 'reward', 'gems', 'nick', v_prof.nick, 'amount', d.amount);
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
  where id = p_uid;
  update public.vip_donation_log set matched = true, profile_id = p_uid, months_granted = v_months, reward = 'vip',
    hold = null, hold_profile = null, message = null where donation_id = p_donation_id;
  return jsonb_build_object('status', 'credited', 'months', v_months, 'reward', 'vip', 'nick', v_prof.nick, 'amount', d.amount);
end; $$;
revoke execute on function public.donor_apply(bigint, uuid) from public, anon, authenticated;

-- credit_donation — зовёт api/vip-sync.js (ключ service_role) на каждый новый донат. Идемпотентно (номер доната — один раз).
-- Привязывается сам, только если: рубли; имя не «аноним» (donor_name_reserved); логин для доната совпал без учёта регистра;
-- донат сделан ПОСЛЕ регистрации и после того, как этот логин стал твоим (reserved_donate_logins). Иначе — ждёт: hold (почему)
-- и hold_profile (чей логин совпал) — видно админу, он решает (donor_admin_assign); человек может подать заявку (claim_donation).
-- 22.10: + p_message (текст доната — только у непривязанных, для админа); анонимные донаты (пустое имя) тоже пишутся — для цели.
drop function if exists public.credit_donation(bigint, text, numeric, text, timestamptz);
create or replace function public.credit_donation(
  p_id         bigint,
  p_username   text,
  p_amount     numeric,
  p_currency   text default 'RUB',
  p_donated_at timestamptz default null,
  p_message    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := left(btrim(coalesce(p_username, '')), 64);
  v_cur  text := upper(coalesce(p_currency, 'RUB'));
  v_at   timestamptz := coalesce(p_donated_at, now());
  v_msg  text := nullif(left(btrim(coalesce(p_message, '')), 200), '');
  v_claimed int; v_prof public.profiles%rowtype; v_hold text; v_reg timestamptz; v_login_at timestamptz;
begin
  if coalesce(auth.role(), '') not in ('', 'service_role') and not public.is_admin_user(auth.uid()) then
    raise exception 'Нет прав начислять донаты';
  end if;
  if p_id is null or p_amount is null or p_amount <= 0 then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtext('credit_donation'));

  insert into public.vip_donation_log (donation_id, matched, donor_username, amount, currency, donated_at)
  values (p_id, false, nullif(v_name, ''), p_amount, v_cur, v_at)
  on conflict (donation_id) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    return jsonb_build_object('status', 'duplicate');
  end if;

  if v_cur <> 'RUB' then
    v_hold := 'currency';
  elsif public.donor_name_reserved(v_name) then
    v_hold := 'reserved';
  else
    select * into v_prof from public.profiles where lower(donate_login) = lower(v_name) limit 1 for update;
    if not found then
      v_hold := 'no_profile';
    else
      v_reg := (to_jsonb(v_prof)->>'created_at')::timestamptz;
      if to_regclass('public.reserved_donate_logins') is not null then
        select reserved_at into v_login_at from public.reserved_donate_logins
          where login_lower = lower(v_prof.donate_login) and profile_id = v_prof.id;
      end if;
      if v_reg is not null and v_at < v_reg then v_hold := 'before_reg';
      elsif v_login_at is null or v_at < v_login_at then v_hold := 'before_login';
      end if;
    end if;
  end if;

  if v_hold is not null then
    update public.vip_donation_log set hold = v_hold,
      hold_profile = case when v_hold in ('before_reg', 'before_login') then v_prof.id end,
      message = case when v_hold <> 'reserved' then v_msg end      -- анонимный донат никому не привязать — текст не храним
    where donation_id = p_id;
    return jsonb_build_object('status', 'unmatched', 'reason', v_hold);
  end if;
  return public.donor_apply(p_id, v_prof.id);
end;
$$;
revoke all on function public.credit_donation(bigint, text, numeric, text, timestamptz, text) from public, anon;
grant execute on function public.credit_donation(bigint, text, numeric, text, timestamptz, text) to authenticated, service_role;

-- Привязать конкретный непривязанный донат к человеку (заявка — claim_donation, админ — admin_resolve_claim, donor_admin_assign).
-- Анонимный (имя «аноним» и т. п.) — никогда: status 'reserved'. Один донат — один аккаунт ('taken')
create or replace function public.apply_unmatched_donation(p_donation_id bigint, p_profile uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.vip_donation_log%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('credit_donation'));   -- тот же замок, что у credit_donation
  select * into d from public.vip_donation_log where donation_id = p_donation_id for update;
  if not found then return jsonb_build_object('status', 'no_donation'); end if;
  if d.matched then return jsonb_build_object('status', 'taken'); end if;
  if upper(coalesce(d.currency, 'RUB')) <> 'RUB' or coalesce(d.amount, 0) <= 0 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if public.donor_name_reserved(d.donor_username) then return jsonb_build_object('status', 'reserved'); end if;
  if not exists (select 1 from public.profiles where id = p_profile) then return jsonb_build_object('status', 'no_profile'); end if;
  return public.donor_apply(p_donation_id, p_profile);
end; $$;
revoke execute on function public.apply_unmatched_donation(bigint, uuid) from public, anon, authenticated;

-- Заявка «задонатил — не привязалось» (как в vip-claims.sql, строже). Донат ищется по имени (без регистра, пробелов, . _ -), точной
-- сумме и дню ±1. Сам привязывается, только если: один такой донат, сумма меньше donor_rule('auto_max'), имя ≤ 2 опечатки от
-- ТВОЕГО ЛОГИНА для доната (ник меняется свободно — только подсказка админу), донат после регистрации и после того, как логин
-- стал твоим. Иначе — заявка админу с причинами (flags) и доказательствами. Анонимные — нельзя. Не больше claims_day в сутки
create or replace function public.claim_donation(p_name text, p_amount numeric, p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_login text; v_nick text; v_reg timestamptz; v_login_at timestamptz;
  n int; v_id bigint; v_donor text; v_at timestamptz;
  v_flags text[] := '{}'; r jsonb; adm record; v_claim bigint; v_status text;
begin
  if uid is null then return jsonb_build_object('status', 'auth'); end if;
  if (select count(*) from public.donation_claims where user_id = uid and created_at > now() - interval '1 day') >= public.donor_rule('claims_day') then
    return jsonb_build_object('status', 'limit');
  end if;
  if coalesce(btrim(p_name), '') = '' or char_length(p_name) > 64 or p_amount is null or p_amount <= 0 or p_amount > 1000000
     or p_date is null or p_date > current_date + 1 or p_date < current_date - 180 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if public.donor_name_reserved(p_name) then
    insert into public.donation_claims (user_id, name_typed, amount, claim_date, status, flags)
      values (uid, left(p_name, 64), p_amount, p_date, 'not_found', '{reserved}');
    return jsonb_build_object('status', 'reserved');
  end if;

  select count(*), min(l.donation_id), min(l.donor_username), min(coalesce(l.donated_at, l.processed_at)) into n, v_id, v_donor, v_at
  from public.vip_donation_log l
  where l.matched = false and upper(coalesce(l.currency, 'RUB')) = 'RUB' and l.amount = p_amount
    and coalesce(l.donated_at, l.processed_at)::date between p_date - 1 and p_date + 1
    and public.d37_norm_name(l.donor_username) = public.d37_norm_name(p_name)
    and not public.donor_name_reserved(l.donor_username);

  if n = 0 then
    insert into public.donation_claims (user_id, name_typed, amount, claim_date, status)
      values (uid, left(p_name, 64), p_amount, p_date, 'not_found');
    return jsonb_build_object('status', 'not_found');
  end if;
  if n = 1 and exists (select 1 from public.donation_claims where donation_id = v_id and status = 'review' and user_id = uid) then
    return jsonb_build_object('status', 'already');
  end if;

  select p.donate_login, p.nick, (to_jsonb(p)->>'created_at')::timestamptz into v_login, v_nick, v_reg from public.profiles p where p.id = uid;
  if v_login is not null and to_regclass('public.reserved_donate_logins') is not null then
    select reserved_at into v_login_at from public.reserved_donate_logins where login_lower = lower(v_login) and profile_id = uid;
  end if;
  if n > 1 then v_flags := v_flags || 'ambiguous'::text; end if;
  if p_amount >= public.donor_rule('auto_max') then v_flags := v_flags || 'big'::text; end if;
  if char_length(public.d37_norm_name(v_login)) < 3 or public.d37_lev(public.d37_norm_name(v_donor), public.d37_norm_name(v_login)) > 2 then
    v_flags := v_flags || (case when char_length(public.d37_norm_name(v_nick)) >= 3
      and public.d37_lev(public.d37_norm_name(v_donor), public.d37_norm_name(v_nick)) <= 2 then 'nick_only' else 'not_similar' end);
  end if;
  if n = 1 and v_reg is not null and v_at < v_reg then v_flags := v_flags || 'before_reg'::text; end if;
  if n = 1 and (v_login_at is null or v_at < v_login_at) then v_flags := v_flags || 'before_login'::text; end if;

  if cardinality(v_flags) = 0 then
    r := public.apply_unmatched_donation(v_id, uid);
    v_status := case when r->>'status' = 'credited' then 'auto' else 'review' end;
    insert into public.donation_claims (user_id, donation_id, candidates, name_typed, amount, claim_date, status, resolved_at, flags)
      values (uid, v_id, n, left(p_name, 64), p_amount, p_date, v_status, case when v_status = 'auto' then now() end,
        case when v_status = 'review' then array['race'] else '{}'::text[] end)
      returning id into v_claim;
    if v_status = 'auto' then
      return jsonb_build_object('status', 'credited', 'months', coalesce((r->>'months')::int, 0), 'gems', coalesce((r->>'gems')::int, 0),
        'reward', r->>'reward', 'level', r->'level', 'until', r->'until', 'amount', p_amount);
    end if;
  else
    insert into public.donation_claims (user_id, donation_id, candidates, name_typed, amount, claim_date, status, flags)
      values (uid, case when n = 1 then v_id end, n, left(p_name, 64), p_amount, p_date, 'review', v_flags)
      returning id into v_claim;
  end if;
  -- На проверку — админам (один раз на заявку)
  for adm in select id from public.profiles where role = 'admin' loop
    begin
      perform public.notify(adm.id, 'vip_claim', uid, '💸 Заявка по донату — проверь',
        format('%s ₽ от «%s» (%s) — в профиле, «Донаты: проверка»', p_amount, left(p_name, 30), p_date), '#/profile', 'claim:' || v_claim);
    exception when others then null; end;
  end loop;
  return jsonb_build_object('status', 'review', 'flags', to_jsonb(v_flags));
end; $$;
revoke execute on function public.claim_donation(text, numeric, date) from public, anon;
grant execute on function public.claim_donation(text, numeric, date) to authenticated;

-- Админ: одобрить / отклонить заявку (как в vip-claims.sql; тексты — по выключателю). Привязал — остальные заявки на этот же донат
-- отклоняются (один донат — один аккаунт)
create or replace function public.admin_resolve_claim(p_id bigint, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.donation_claims%rowtype; r jsonb := '{}'::jsonb; o record;
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'Только для админа'; end if;
  select * into c from public.donation_claims where id = p_id for update;
  if not found or c.status <> 'review' then return jsonb_build_object('status', 'gone'); end if;
  if p_approve then
    if c.donation_id is null then return jsonb_build_object('status', 'ambiguous'); end if;   -- несколько похожих — выбрать донат вручную
    r := public.apply_unmatched_donation(c.donation_id, c.user_id);
    if r->>'status' <> 'credited' then return r; end if;
  end if;
  update public.donation_claims set status = case when p_approve then 'approved' else 'denied' end,
    resolved_at = now(), resolved_by = auth.uid() where id = p_id;
  perform public.donor_notify(c.user_id,
    case when not p_approve then '❌ Заявка по донату отклонена'
         when r->>'reward' = 'status' then '💛 Донат привязан — спасибо!'
         when r->>'reward' = 'gems' then '💎 Донат привязан — кристаллы начислены'
         else '✨ Донат привязан — VIP начислен' end,
    case when not p_approve then 'Если это ошибка — напиши админу в чат.'
         when r->>'reward' = 'status' then format('%s ₽ засчитаны в статус «Донатер». Спасибо за поддержку стрима!', c.amount)
         else format('%s ₽ засчитаны. Спасибо за поддержку!', c.amount) end, null);
  if p_approve then
    for o in select id, user_id from public.donation_claims where donation_id = c.donation_id and status = 'review' and id <> c.id loop
      update public.donation_claims set status = 'denied', resolved_at = now(), resolved_by = auth.uid(), note = 'донат привязан к другому аккаунту' where id = o.id;
      perform public.donor_notify(o.user_id, '❌ Заявка по донату отклонена', 'Этот донат уже привязан к другому аккаунту.', null);
    end loop;
  end if;
  return jsonb_build_object('status', case when p_approve then 'approved' else 'denied' end, 'months', r->'months', 'reward', r->'reward');
end; $$;
grant execute on function public.admin_resolve_claim(bigint, boolean) to authenticated;

-- Админ решил сам (например, выбрал донат из нескольких — donor_admin_assign) — закрыть заявку
create or replace function public.admin_close_claim_manual(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.donation_claims%rowtype;
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'Только для админа'; end if;
  select * into c from public.donation_claims where id = p_id for update;
  if not found or c.status <> 'review' then return jsonb_build_object('status', 'gone'); end if;
  update public.donation_claims set status = 'manual', resolved_at = now(), resolved_by = auth.uid() where id = p_id;
  perform public.donor_notify(c.user_id, '✨ Заявку по донату рассмотрели', 'Админ решил вручную — загляни в профиль. Спасибо за поддержку!', null);
  return jsonb_build_object('status', 'manual');
end; $$;
grant execute on function public.admin_close_claim_manual(bigint) to authenticated;

-- XP за донат (как progression.sql) — кроме статуса «Донатер»: деньги не дают опыт (рейтинги XP — без денег)
create or replace function public.xp_on_donation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.matched is true and new.profile_id is not null and coalesce(new.currency, 'RUB') = 'RUB'
     and coalesce(to_jsonb(new)->>'reward', '') <> 'status'
     and (tg_op = 'INSERT' or old.matched is distinct from true) then
    begin
      perform public.xp_award(new.profile_id, 'donation', new.donation_id::text,
        least(1000, greatest(1, floor(coalesce(new.amount, 0))::int)));
    exception when others then null;
    end;
  end if;
  return null;
end; $$;

-- Бонус пригласившему с доната (как referrals2.sql) — кроме статуса «Донатер»: донат без встречной выдачи — и без 💎 другим
create or replace function public.ref_on_donation() returns trigger language plpgsql security definer set search_path = public as $$
declare v_rate numeric := 1; v_gems int := 0;
begin
  begin
    if new.matched is true and new.profile_id is not null and upper(coalesce(new.currency, 'RUB')) = 'RUB' and coalesce(new.amount, 0) > 0
       and coalesce(to_jsonb(new)->>'reward', '') <> 'status'
       and (tg_op = 'INSERT' or old.matched is distinct from true) then
      begin v_gems := coalesce(new.gems_granted, 0); exception when others then v_gems := 0; end;
      if v_gems = 0 then   -- донат пришёл кристаллами — бонус уже дал журнал кристаллов (ref_on_ledger)
        if to_regclass('public.premium_settings') is not null then
          select donate_rate into v_rate from public.premium_settings where id = 1;
        end if;
        perform public.ref_aff(new.profile_id, 'don:' || new.donation_id, floor(new.amount * coalesce(v_rate, 1))::int);
      end if;
    end if;
  exception when others then null;
  end;
  return null;
end $$;
revoke execute on function public.ref_on_donation() from public, anon, authenticated;

-- Остаток к VIP-месяцу (vip_pending_rub) — один раз, когда донаты больше не дают VIP: дни VIP пропорционально — ⌈остаток × 30 / 100⌉
-- (50 ₽ → 15 дней), от конца текущего VIP; у бессрочного VIP — 💎 по курсу доната. Повторный вызов — 0 (остатков больше нет)
create or replace function public.donor_convert_pending() returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_days int; v_until timestamptz; v_gems int; v_rate numeric; n int := 0;
begin
  if public.donate_rewards_mode() <> 'off' then return 0; end if;
  select donate_rate into v_rate from public.premium_settings where id = 1;
  for r in select id, vip_pending_rub as p, is_vip, vip_until from public.profiles where vip_pending_rub > 0 for update loop
    if r.is_vip is true and r.vip_until is null then
      v_gems := floor(r.p * coalesce(v_rate, 1))::int;
      if v_gems > 0 then
        perform public.premium_add(r.id, v_gems, 'convert', 'pending', format('Остаток доната к VIP-месяцу: %s ₽ (VIP бессрочный)', floor(r.p)));
      end if;
      update public.profiles set vip_pending_rub = 0 where id = r.id;
      perform public.donor_notify(r.id, '💛 Остаток доната учтён',
        format('Накопленные %s ₽ к месяцу VIP стали %s 💎 — VIP у тебя и так бессрочный.', floor(r.p), v_gems), 'pending_conv');
    else
      v_days := ceil(r.p * 30 / 100.0)::int;
      v_until := greatest(now(), coalesce(case when r.is_vip is true then r.vip_until end, now())) + make_interval(days => v_days);
      update public.profiles set is_vip = true, vip_until = v_until, vip_pending_rub = 0 where id = r.id;
      perform public.donor_notify(r.id, format('✨ +%s дн. VIP', v_days),
        format('Донаты больше не копятся к месяцу VIP — накопленные %s ₽ стали %s дн. VIP (до %s). Спасибо за поддержку!',
          floor(r.p), v_days, to_char(v_until at time zone 'Europe/Moscow', 'DD.MM.YYYY')), 'pending_conv');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.donor_convert_pending() from public, anon, authenticated;

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
  -- налог (22.10): пусто — «не указано»; ставку и период уточнить у бухгалтера
  if p ? 'tax_pct' then s.tax_pct := case when nullif(btrim(coalesce(p->>'tax_pct', '')), '') is null then null
    else greatest(0, least(100, (p->>'tax_pct')::numeric)) end; end if;
  if p ? 'tax_period' then s.tax_period := case when p->>'tax_period' in ('month', 'quarter', 'half', 'year') then p->>'tax_period' end; end if;
  update public.premium_settings set donate_rate = s.donate_rate, donate_bonus = s.donate_bonus, day_rub = s.day_rub,
    month_rub = s.month_rub, shop_open = s.shop_open, tax_pct = s.tax_pct, tax_period = s.tax_period,
    updated_at = now(), updated_by = auth.uid() where id = 1
    returning * into s;
  return to_jsonb(s);
end; $$;
grant execute on function public.premium_admin_settings(jsonb) to authenticated;

-- 🧾 Доход и налог (22.10): платежи за период [p_from, p_to] (дни по времени Казахстана, Asia/Almaty) — каждый платёж и возврат
-- строкой (пишет только сервер: подпись провайдера или «Оплачено» админа у Kaspi), итоги по валютам: оплаты, возвраты, «чистыми»,
-- налог по ставке владельца (ориентир; ставки нет — null). Тестовые — в списке, но не в итогах. Донаты DonationAlerts — отдельной
-- строкой (как их учитывать — решает бухгалтер)
create index if not exists idx_premium_payments_at on public.premium_payments (created_at);
create or replace function public.premium_admin_income(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.premium_settings%rowtype; v_from timestamptz; v_to timestamptz;
begin
  perform public.premium_admin_check();
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then return jsonb_build_object('ok', false, 'reason', 'period'); end if;
  select * into s from public.premium_settings where id = 1;
  v_from := p_from::timestamp at time zone 'Asia/Almaty';
  v_to := (p_to + 1)::timestamp at time zone 'Asia/Almaty';
  return jsonb_build_object('ok', true, 'from', p_from, 'to', p_to, 'tax_pct', s.tax_pct, 'tax_period', s.tax_period,
    'rows', coalesce((select jsonb_agg(x order by x.at) from (
        select y.created_at as at, y.provider, y.payment_id, coalesce(y.order_id, '') as order_id, y.amount, y.currency, y.status, y.test,
          y.refund_of, o.pack, o.gems, p.nick
        from public.premium_payments y
        left join public.premium_orders o on o.id = y.order_id
        left join public.profiles p on p.id = y.user_id
        where y.created_at >= v_from and y.created_at < v_to
        order by y.created_at limit 5000) x), '[]'::jsonb),
    'totals', coalesce((select jsonb_object_agg(t.currency, jsonb_build_object('count', t.cnt, 'paid', t.paid, 'refunds', t.refunds,
        'net', t.paid - t.refunds, 'open', t.open,
        'tax', case when s.tax_pct is null then null else round((t.paid - t.refunds) * s.tax_pct / 100, 2) end))
      from (select y.currency,
          count(*) filter (where y.status in ('credited', 'extra')) as cnt,
          coalesce(sum(y.amount) filter (where y.status in ('credited', 'extra')), 0) as paid,
          coalesce(sum(y.amount) filter (where y.status = 'refund'), 0) as refunds,
          coalesce(sum(y.amount) filter (where y.status in ('mismatch', 'no_order')), 0) as open
        from public.premium_payments y
        where y.created_at >= v_from and y.created_at < v_to and not y.test
        group by y.currency) t), '{}'::jsonb),
    'donations', (select jsonb_build_object('count', count(*), 'rub', coalesce(sum(l.amount), 0))
        from public.vip_donation_log l
        where upper(coalesce(l.currency, 'RUB')) = 'RUB' and coalesce(l.donated_at, l.processed_at) >= v_from
          and coalesce(l.donated_at, l.processed_at) < v_to));
end; $$;
grant execute on function public.premium_admin_income(date, date) to authenticated;

-- ═══ 8. «💛 Донатер» на сайте: бонусы как у VIP, значки, проверка админом (22.10.2026) ═══
-- Лучшее из двух веток: VIP (vip_tier_of — за уровень или 💎) и донатер (donor_perk_of) → 'bronze' / 'silver' / 'gold' или null.
-- Бонусы обеих веток — только сайт и чат (закреп, стикеры, гости, GIF, тема, невидимка, без рекламы); на итоги игр и рейтинги не влияют
create or replace function public.perk_tier_of(p_uid uuid) returns text language sql stable security definer set search_path = public as $$
  select case when public.vip_tier_rank(x.d) > public.vip_tier_rank(x.v) then x.d else x.v end
  from (select public.vip_tier_of(p_uid) as v, public.donor_perk_of(p_uid) as d) x
$$;
grant execute on function public.perk_tier_of(uuid) to authenticated, anon;

-- has_perks (vip-balance.sql): стикеры, GIF-аватар, ×2 монет, без рекламы — персонал, VIP или донатер
create or replace function public.has_perks(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.role in ('admin', 'moderator', 'helper') from public.profiles p where p.id = uid), false)
    or public.vip_tier_of(uid) is not null
    or public.donor_level_of(uid) > 0;
$$;
grant execute on function public.has_perks(uuid) to authenticated, anon;

-- Закреп своего сообщения (vip-balance.sql): длительность и пауза — по лучшей ветке (VIP или донатер)
create or replace function public.pin_own_message(msg_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_role text; v_tier text; v_last timestamptz; v_minutes int; v_cooldown int; v_wait int;
begin
  select user_id into v_owner from public.messages where id = msg_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Можно закрепить только своё сообщение';
  end if;
  select role, last_pinned_at into v_role, v_last from public.profiles where id = auth.uid();
  v_tier := public.perk_tier_of(auth.uid());
  if    v_role = 'admin'     then v_minutes := 60; v_cooldown := 0;
  elsif v_role = 'moderator' then v_minutes := 30; v_cooldown := 0;
  elsif v_role = 'helper'    then v_minutes := 15; v_cooldown := 30;
  elsif v_tier = 'gold'      then v_minutes := 40; v_cooldown := 60;
  elsif v_tier = 'silver'    then v_minutes := 20; v_cooldown := 40;
  elsif v_tier = 'bronze'    then v_minutes := 10; v_cooldown := 30;
  else
    raise exception 'Закреп — для VIP, донатеров и команды сайта';
  end if;
  if v_cooldown > 0 and v_last is not null and v_last + make_interval(mins => v_cooldown) > now() then
    v_wait := ceil(extract(epoch from (v_last + make_interval(mins => v_cooldown) - now())) / 60);
    raise exception 'Закреплять можно раз в % мин — подожди ещё % мин', v_cooldown, v_wait;
  end if;
  update public.messages set pinned_until = now() + make_interval(mins => v_minutes), pinned_by = auth.uid() where id = msg_id;
  update public.profiles set last_pinned_at = now() where id = auth.uid();
end; $$;
grant execute on function public.pin_own_message(bigint) to authenticated;

-- Невидимка (progression.sql): персонал или ранг Silver и выше — VIP или донатер
create or replace function public.can_be_invisible(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff_user(uid) or public.vip_tier_rank(public.perk_tier_of(uid)) >= 2;
$$;

-- Заявки в друзья (progression.sql): + VIP или донатер сейчас, + любой привязанный донат когда-либо
create or replace function public.can_send_friend_requests(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select uid is not null and (
    public.is_staff_user(uid)
    or public.perk_tier_of(uid) is not null
    or coalesce((select total_donated > 0 from public.profiles where id = uid), false)
    or exists (select 1 from public.vip_donation_log l where l.profile_id = uid and l.matched)
    or public.user_level(uid) >= 5
    or public.referral_count(uid) >= 5
  );
$$;

-- Лимит друзей (economy.sql): 15 → +5 каждые 5 уровней (до 45); VIP или донатер 50/70/100; персонал без лимита (null)
create or replace function public.friend_limit(uid uuid)
returns int language plpgsql stable security definer set search_path = public as $$
declare lv int; tier text;
begin
  if public.is_staff_user(uid) then return null; end if;
  tier := public.perk_tier_of(uid);
  if tier = 'gold' then return 100; elsif tier = 'silver' then return 70; elsif tier = 'bronze' then return 50; end if;
  lv := public.user_level(uid);
  if lv < 15 then return 15; end if;
  return least(45, 15 + 5 * (lv / 5 - 2));
end; $$;

-- ── Для сайта ──
-- Свой статус: уровень, сумма за окно, до когда, сколько до следующего; всего за всё время; логин и когда он стал твоим; последние донаты
create or replace function public.donor_me()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); st jsonb; v_total numeric; v_login text; v_login_at timestamptz;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth', 'mode', public.donate_rewards_mode(), 'levels', public.donor_levels(), 'days', public.donor_rule('days'));
  end if;
  st := public.donor_status(uid);
  select coalesce(sum(amount), 0) into v_total from public.vip_donation_log
    where profile_id = uid and matched and upper(coalesce(currency, 'RUB')) = 'RUB';
  select donate_login into v_login from public.profiles where id = uid;
  if v_login is not null and to_regclass('public.reserved_donate_logins') is not null then
    select reserved_at into v_login_at from public.reserved_donate_logins where login_lower = lower(v_login) and profile_id = uid;
  end if;
  return st || jsonb_build_object('ok', true, 'mode', public.donate_rewards_mode(), 'levels', public.donor_levels(), 'days', public.donor_rule('days'),
    'total', v_total, 'login', v_login, 'login_at', v_login_at,
    'recent', coalesce((select jsonb_agg(x order by x.at desc) from (
      select l.amount, coalesce(l.donated_at, l.processed_at) as at, l.reward, l.excluded from public.vip_donation_log l
      where l.profile_id = uid and l.matched order by coalesce(l.donated_at, l.processed_at) desc limit 10) x), '[]'::jsonb));
end $$;
grant execute on function public.donor_me() to anon, authenticated;

-- Значки донатеров пачкой (чат, профиль, мини-профиль): [{id, lv, until}] — только у кого статус сейчас есть и кто не скрыл донаты
-- (privacy.sql); себе и админу — всегда. До 200 за раз; по индексу — у кого донатов в окне нет, тот не считается
create or replace function public.donor_badges(p_uids uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'lv', (x.s->>'level')::int, 'until', x.s->'until')), '[]'::jsonb)
  from (
    select p.id, public.donor_status(p.id) as s
    from public.profiles p
    where p.id = any (p_uids[1:200])
      and (not coalesce(p.privacy_hide_donations, false) or p.id = auth.uid() or public.is_admin_user(auth.uid()))
      and exists (select 1 from public.vip_donation_log l
                  where l.profile_id = p.id and l.matched and l.reward = 'status' and not l.excluded
                    and coalesce(l.donated_at, l.processed_at) > now() - make_interval(days => public.donor_rule('days')))
  ) x
  where (x.s->>'level')::int > 0
$$;
grant execute on function public.donor_badges(uuid[]) to anon, authenticated;

-- Топ донатеров (api/donations.js, ключ service_role): имя в DonationAlerts → уровень донатера его аккаунта (кто не скрыл донаты)
create or replace function public.donor_names_levels(p_names text[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(t.n, t.lv), '{}'::jsonb) from (
    select lower(btrim(l.donor_username)) as n, max(public.donor_level_of(l.profile_id)) as lv
    from public.vip_donation_log l join public.profiles p on p.id = l.profile_id
    where l.matched and lower(btrim(l.donor_username)) = any (select lower(btrim(x)) from unnest(p_names[1:60]) x)
      and not coalesce(p.privacy_hide_donations, false)
    group by 1
  ) t where t.lv > 0
$$;
revoke execute on function public.donor_names_levels(text[]) from public, anon, authenticated;
grant execute on function public.donor_names_levels(text[]) to service_role;

-- Ник и логин для доната не бывают «Аноним», «гость», «без имени»… (donor_name_reserved). Сам человек — понятная ошибка;
-- регистрация и вход через сервисы (не браузер) — ник по умолчанию, логин не ставится. Старые ники не трогаем — админ видит их списком
create or replace function public.profile_reserved_names()
returns trigger language plpgsql as $$
declare v_nick boolean := true; v_login boolean := true;
begin
  if tg_op = 'UPDATE' then
    v_nick := new.nick is distinct from old.nick;
    v_login := new.donate_login is distinct from old.donate_login;
  end if;
  if v_nick and new.nick is not null and public.donor_name_reserved(new.nick) then
    if tg_op = 'UPDATE' and public.is_client_session() then
      raise exception 'Ник «%» занят системой: так подписаны анонимные донаты и гости — выбери другой', new.nick using errcode = '23514';
    end if;
    new.nick := 'user' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;
  if v_login and new.donate_login is not null and public.donor_name_reserved(new.donate_login) then
    if public.is_client_session() then
      raise exception 'Логин для доната «%» нельзя: так DonationAlerts подписывает анонимные донаты — придумай свой', new.donate_login using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' then new.donate_login := old.donate_login; else new.donate_login := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists a2_profile_reserved_names on public.profiles;
create trigger a2_profile_reserved_names before insert or update of nick, donate_login on public.profiles
  for each row execute function public.profile_reserved_names();

-- ── Админ: проверка донатов ──
-- Всё, что ждёт решения: заявки (с доказательствами и причинами), донаты, где логин совпал, но донат раньше регистрации/логина,
-- крупные непривязанные, уже привязанные подозрительные (никого не лишаем — «всё в порядке» или «не считать в статус»),
-- ники/логины, которые теперь заняты системой
create or replace function public.donor_admin_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_max int := public.donor_rule('auto_max');
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'Только для админа'; end if;
  return jsonb_build_object(
    'mode', public.donate_rewards_mode(), 'levels', public.donor_levels(),
    'rules', jsonb_build_object('days', public.donor_rule('days'), 'auto_max', v_max, 'claims_day', public.donor_rule('claims_day')),
    'claims', coalesce((select jsonb_agg(x order by x.created_at) from (
        select c.id, c.user_id, p.nick, p.donate_login, (to_jsonb(p)->>'created_at')::timestamptz as reg_at, rl.reserved_at as login_at,
          c.name_typed, c.amount, c.claim_date, c.flags, c.candidates, c.created_at,
          c.donation_id, l.donor_username, coalesce(l.donated_at, l.processed_at) as donated_at, l.message
        from public.donation_claims c
        join public.profiles p on p.id = c.user_id
        left join public.vip_donation_log l on l.donation_id = c.donation_id
        left join public.reserved_donate_logins rl on rl.login_lower = lower(p.donate_login) and rl.profile_id = p.id
        where c.status = 'review' order by c.created_at limit 100) x), '[]'::jsonb),
    'held', coalesce((select jsonb_agg(x order by x.at desc) from (
        select l.donation_id, l.donor_username, l.amount, coalesce(l.donated_at, l.processed_at) as at, l.hold, l.message,
          l.hold_profile as user_id, p.nick, p.donate_login
        from public.vip_donation_log l left join public.profiles p on p.id = l.hold_profile
        where not l.matched and (l.hold in ('before_reg', 'before_login') or (l.hold = 'no_profile' and l.amount >= v_max))
          and coalesce(l.donated_at, l.processed_at) > now() - interval '180 days'
        order by coalesce(l.donated_at, l.processed_at) desc limit 100) x), '[]'::jsonb),
    'suspicious', coalesce((select jsonb_agg(x order by x.at desc) from (
        select y.donation_id, y.donor_username, y.amount, y.at, y.reward, y.excluded, y.user_id, y.nick, y.donate_login, y.flags
        from (
          select l.donation_id, l.donor_username, l.amount, coalesce(l.donated_at, l.processed_at) as at, l.reward, l.excluded,
            l.profile_id as user_id, p.nick, p.donate_login,
            array_remove(array[
              case when public.donor_name_reserved(l.donor_username) then 'reserved' end,
              case when (to_jsonb(p)->>'created_at')::timestamptz > coalesce(l.donated_at, l.processed_at) then 'before_reg' end,
              case when coalesce(rl.reserved_at, rl2.reserved_at) is null or coalesce(rl.reserved_at, rl2.reserved_at) > coalesce(l.donated_at, l.processed_at) then 'before_login' end,
              case when l.amount >= v_max and exists (select 1 from public.donation_claims c where c.donation_id = l.donation_id and c.status = 'auto')
                then 'claim_big' end], null) as flags
          from public.vip_donation_log l
          join public.profiles p on p.id = l.profile_id
          left join public.reserved_donate_logins rl on rl.login_lower = lower(btrim(l.donor_username)) and rl.profile_id = l.profile_id
          left join public.reserved_donate_logins rl2 on rl2.login_lower = lower(p.donate_login) and rl2.profile_id = l.profile_id
          where l.matched and l.checked_at is null
        ) y where cardinality(y.flags) > 0
        order by y.at desc limit 100) x), '[]'::jsonb),
    'names', coalesce((select jsonb_agg(x) from (
        select p.id, p.nick, p.donate_login from public.profiles p
        where public.donor_name_reserved(p.nick) or (p.donate_login is not null and public.donor_name_reserved(p.donate_login))
        limit 50) x), '[]'::jsonb));
end $$;
grant execute on function public.donor_admin_state() to authenticated;

-- Выключатель наград за донат: 'off' (статус «Донатер») | 'vip' | 'gems'. На 'off' — остатки к VIP-месяцу сразу в дни VIP
create or replace function public.donor_admin_set(p_key text, p_value text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v text := lower(btrim(coalesce(p_value, ''))); n int := 0;
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'Только для админа'; end if;
  if p_key is distinct from 'donate_rewards' or v not in ('off', 'vip', 'gems') then return jsonb_build_object('ok', false, 'reason', 'value'); end if;
  if to_regclass('public.site_config') is null then return jsonb_build_object('ok', false, 'reason', 'no_config'); end if;
  insert into public.site_config (key, value) values ('donate_rewards', v) on conflict (key) do update set value = excluded.value;
  if v = 'off' then n := public.donor_convert_pending(); end if;
  return jsonb_build_object('ok', true, 'mode', public.donate_rewards_mode(), 'converted', n);
end $$;
grant execute on function public.donor_admin_set(text, text) to authenticated;

-- Привязать донат к человеку решением админа (донат раньше регистрации/логина, несколько похожих, крупный). Анонимный — нельзя.
-- Заявки на этот донат закрываются: его — «одобрено», чужие — «отклонено» (один донат — один аккаунт)
create or replace function public.donor_admin_assign(p_donation bigint, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; o record;
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'Только для админа'; end if;
  r := public.apply_unmatched_donation(p_donation, p_user);
  if r->>'status' = 'credited' then
    update public.vip_donation_log set checked_at = now() where donation_id = p_donation;
    for o in select id, user_id from public.donation_claims where donation_id = p_donation and status = 'review' loop
      update public.donation_claims set status = case when o.user_id = p_user then 'approved' else 'denied' end,
        resolved_at = now(), resolved_by = auth.uid(),
        note = case when o.user_id <> p_user then 'донат привязан к другому аккаунту' end where id = o.id;
      if o.user_id <> p_user then
        perform public.donor_notify(o.user_id, '❌ Заявка по донату отклонена', 'Этот донат привязан к другому аккаунту.', null);
      end if;
    end loop;
  end if;
  return r;
end $$;
grant execute on function public.donor_admin_assign(bigint, uuid) to authenticated;

-- Не считать донат в статус «Донатер» (p_on = true) или вернуть (false). Выданное раньше (VIP, 💎) не трогает
create or replace function public.donor_admin_exclude(p_donation bigint, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'Только для админа'; end if;
  update public.vip_donation_log set excluded = coalesce(p_on, true), checked_at = now()
    where donation_id = p_donation and matched returning profile_id into v_uid;
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'excluded', coalesce(p_on, true), 'level', public.donor_level_of(v_uid));
end $$;
grant execute on function public.donor_admin_exclude(bigint, boolean) to authenticated;

-- Подозрительное посмотрел — «всё в порядке» (пропадает из списка)
create or replace function public.donor_admin_checked(p_donation bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'Только для админа'; end if;
  update public.vip_donation_log set checked_at = now() where donation_id = p_donation;
  return jsonb_build_object('ok', found);
end $$;
grant execute on function public.donor_admin_checked(bigint) to authenticated;

-- Служебные — только изнутри
revoke execute on function public.premium_admin_check() from public, anon;
revoke execute on function public.premium_donation_gems(numeric) from public, anon, authenticated;
revoke execute on function public.premium_mode(uuid) from public, anon, authenticated;

-- Проверка (необязательно):
-- select public.premium_state();                      -- в SQL Editor: {"ok": false, "reason": "auth", …}
-- select * from public.premium_ledger order by id desc limit 20;
-- select * from public.premium_orders order by created_at desc limit 20;

-- Один раз при запуске файла (донаты выключены — 'off' по умолчанию): остатки к VIP-месяцу → дни VIP. Повторный запуск — 0
select public.donor_convert_pending() as converted_pending;
