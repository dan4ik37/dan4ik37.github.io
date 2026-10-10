-- ═══════════════════════════════════════════════════════════════════
--  МОНЕТЫ 🪙 — игровая валюта сайта (js/core/coins.js) и СВОЙ ПЕРСОНАЖ 🎭 (js/core/avatar.js)
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно.
--  Нужны: games.sql (game_log), xp.sql (xp_ledger), vip-balance.sql (has_perks) — они уже применены.
--
--  Откуда монеты: монеты из забега в «Орде»/«Башнях» (coins_run, до 300 за забег и 1500 в день),
--  победа в любой игре сайта (+5, до 20 раз в день — триггер на game_log), бонус дня (coins_daily),
--  задание дня (+50 — триггер на xp_ledger), реклама за награду (coins_ad: +40 до 8 раз в день или
--  «×2 за забег» до 5 раз в день). VIP и персонал получают за забеги и бонус дня вдвое больше.
--  На что: возрождение (30), герои и улучшения «Орды», части своего персонажа (coins_buy, цены — coin_price).
--  Персонаж: надетое — coin_wallet.look, сохраняет char_save (только своё, бесплатное или VIP-часть у VIP),
--  чужих показывает char_looks (рекорды, профиль, игры вдвоём).
--  Цены и лимиты продублированы в js/core/coins.js (RULES, PRICES) и js/core/avatar.js (PARTS):
--  поменял тут — поменяй там.
--
--  Как и с очками игр, сервер верит клиенту только в пределах лимитов: монеты тратятся только на
--  игровое, поэтому накрутка в рамках лимитов ничего не ломает.
--  Проверка после запуска: select public.coin_price('hero:ninja'); → 400
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.coin_wallet (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  coins int not null default 0 check (coins >= 0),
  items text[] not null default '{}',          -- купленное навсегда: 'hero:ninja', 'up:might:2', 'skin:hat:crown' …
  updated_at timestamptz not null default now()
);
alter table public.coin_wallet add column if not exists look jsonb not null default '{}'::jsonb;   -- надетый персонаж
alter table public.coin_wallet enable row level security;
drop policy if exists "Свой кошелёк видит сам" on public.coin_wallet;
create policy "Свой кошелёк видит сам" on public.coin_wallet for select using (auth.uid() = user_id);
-- Писать напрямую нельзя — только через функции ниже

create table if not exists public.coin_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount int not null,                         -- + начислено, − потрачено
  source text not null,                        -- run, vip, win, daily, quest, ad, double, import, buy, revive
  ref text not null default '',
  day date not null default (now() at time zone 'Europe/Moscow')::date,
  created_at timestamptz not null default now()
);
create index if not exists idx_coin_log_user_day on public.coin_log (user_id, day, source);
-- Разовые награды: один забег, один бонус дня, один перенос гостевых монет
create unique index if not exists uq_coin_log_once on public.coin_log (user_id, source, ref)
  where source in ('run', 'daily', 'double', 'import', 'quest');
alter table public.coin_log enable row level security;
drop policy if exists "Свой журнал монет видит сам" on public.coin_log;
create policy "Свой журнал монет видит сам" on public.coin_log for select using (auth.uid() = user_id);

-- ── Ядро: начислить/списать (только из функций ниже, клиенту нельзя) ──
create or replace function public.coin_add(p_uid uuid, p_amount int, p_source text, p_ref text default '')
returns int language plpgsql security definer set search_path = public as $$
declare bal int;
begin
  if p_uid is null or coalesce(p_amount, 0) = 0 then
    select coins into bal from public.coin_wallet where user_id = p_uid;
    return coalesce(bal, 0);
  end if;
  insert into public.coin_wallet (user_id, coins) values (p_uid, greatest(p_amount, 0))
    on conflict (user_id) do update set coins = public.coin_wallet.coins + p_amount, updated_at = now()
    returning coins into bal;
  insert into public.coin_log (user_id, amount, source, ref) values (p_uid, p_amount, p_source, coalesce(p_ref, ''));
  return bal;
end; $$;
revoke execute on function public.coin_add(uuid, int, text, text) from public, anon, authenticated;

create or replace function public.coin_today() returns date language sql stable as $$
  select (now() at time zone 'Europe/Moscow')::date
$$;

-- Цены (как в coins.js и avatar.js). null — такого товара нет, 0 — бесплатная часть персонажа
create or replace function public.coin_price(p_item text) returns int language sql immutable as $$
  select case
    when p_item = 'revive' then 30
    when p_item = 'hero:ninja' then 400
    when p_item = 'hero:knight' then 400
    when p_item = 'hero:vampire' then 800
    when p_item = 'hero:robot' then 1200
    when p_item = 'hero:streamer' then 2500
    when p_item ~ '^up:(might|hp|speed|magnet|greed):[1-5]$' then (array[100, 200, 400, 700, 1000])[split_part(p_item, ':', 3)::int]
    when p_item ~ '^up:armor:[1-3]$' then (array[150, 400, 800])[split_part(p_item, ':', 3)::int]
    when p_item like 'skin:%' then (select v.p from (values
      ('skin:color:blue', 0), ('skin:color:red', 0), ('skin:color:green', 0), ('skin:color:yellow', 60), ('skin:color:orange', 60),
      ('skin:color:purple', 60), ('skin:color:pink', 60), ('skin:color:teal', 60), ('skin:color:white', 100), ('skin:color:black', 100),
      ('skin:color:galaxy', 350), ('skin:color:gold', 800), ('skin:color:rainbow', 3000),
      ('skin:eyes:normal', 0), ('skin:eyes:happy', 0), ('skin:eyes:angry', 50), ('skin:eyes:sleepy', 50), ('skin:eyes:dizzy', 80),
      ('skin:eyes:heart', 100), ('skin:eyes:star', 100), ('skin:eyes:cool', 120), ('skin:eyes:cyclops', 150), ('skin:eyes:robot', 200),
      ('skin:mouth:smile', 0), ('skin:mouth:cat', 0), ('skin:mouth:grin', 40), ('skin:mouth:o', 40), ('skin:mouth:tongue', 60),
      ('skin:mouth:fangs', 80), ('skin:mouth:mustache', 120),
      ('skin:hat:none', 0), ('skin:hat:bow', 100), ('skin:hat:cap', 100), ('skin:hat:party', 120), ('skin:hat:grad', 150),
      ('skin:hat:helmet', 150), ('skin:hat:army', 150), ('skin:hat:top', 200), ('skin:hat:ears', 200), ('skin:hat:horns', 250),
      ('skin:hat:propeller', 250), ('skin:hat:halo', 300), ('skin:hat:crown', 800), ('skin:hat:headphones', 3000),
      ('skin:item:none', 0), ('skin:item:rose', 80), ('skin:item:pizza', 80), ('skin:item:balloon', 100), ('skin:item:mic', 100),
      ('skin:item:gamepad', 120), ('skin:item:flashlight', 120), ('skin:item:sword', 150), ('skin:item:trophy', 300),
      ('skin:pet:none', 0), ('skin:pet:dog', 300), ('skin:pet:cat', 300), ('skin:pet:frog', 300), ('skin:pet:fox', 400),
      ('skin:pet:ghost', 400), ('skin:pet:robot', 500), ('skin:pet:unicorn', 700), ('skin:pet:dragon', 900),
      ('skin:trail:none', 0), ('skin:trail:dust', 100), ('skin:trail:sparks', 250), ('skin:trail:hearts', 250), ('skin:trail:notes', 300),
      ('skin:trail:stars', 300), ('skin:trail:fire', 350), ('skin:trail:rainbow', 3000)
    ) v(i, p) where v.i = p_item)
  end
$$;

-- Части персонажа, бесплатные для VIP/персонала (остальным — за монеты по цене выше)
create or replace function public.coin_vip_item(p_item text) returns boolean language sql immutable as $$
  select p_item in ('skin:color:rainbow', 'skin:hat:headphones', 'skin:trail:rainbow')
$$;

-- Сколько монет можно принести из одного забега (как RUN_CAP в coins.js)
create or replace function public.coin_run_cap(p_game text) returns int language sql immutable as $$
  select case p_game when 'horde' then 300 when 'td' then 300 when 'blocks' then 150 when 'kosynka' then 40 when 'pauk' then 100 when 'freecell' then 30 when 'miner' then 60 when 'mahjong' then 40 end
$$;

-- ── Состояние кошелька (для витрины) ──
create or replace function public.coins_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); w public.coin_wallet%rowtype;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into w from public.coin_wallet where user_id = uid;
  return jsonb_build_object('ok', true,
    'coins', coalesce(w.coins, 0),
    'items', to_jsonb(coalesce(w.items, '{}'::text[])),
    'look', coalesce(w.look, '{}'::jsonb),
    'daily', exists (select 1 from public.coin_log where user_id = uid and source = 'daily' and ref = public.coin_today()::text),
    'ads', (select count(*) from public.coin_log where user_id = uid and source = 'ad' and day = public.coin_today()),
    'doubles', (select count(*) from public.coin_log where user_id = uid and source = 'double' and day = public.coin_today()),
    'imported', exists (select 1 from public.coin_log where user_id = uid and source = 'import'),
    'perks', coalesce(public.has_perks(uid), false));
end; $$;
grant execute on function public.coins_state() to authenticated;

-- ── Бонус дня: 30 монет (VIP/персонал — 60), раз в сутки по МСК ──
create or replace function public.coins_daily()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); got int := 30; bal int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if exists (select 1 from public.coin_log where user_id = uid and source = 'daily' and ref = public.coin_today()::text) then
    return jsonb_build_object('ok', false, 'reason', 'done');
  end if;
  bal := public.coin_add(uid, 30, 'daily', public.coin_today()::text);
  if coalesce(public.has_perks(uid), false) then bal := public.coin_add(uid, 30, 'vip', 'daily'); got := 60; end if;
  return jsonb_build_object('ok', true, 'got', got, 'coins', bal);
end; $$;
grant execute on function public.coins_daily() to authenticated;

-- ── Монеты из забега: p_ref — номер забега (один раз), не чаще раза в 20 с, до 1500 в день ──
create or replace function public.coins_run(p_game text, p_amount int, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cap int := public.coin_run_cap(p_game); amt int; today int; bal int; got int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if cap is null then return jsonb_build_object('ok', false, 'reason', 'game'); end if;
  if coalesce(p_ref, '') = '' or length(p_ref) > 40 then return jsonb_build_object('ok', false, 'reason', 'ref'); end if;
  amt := least(greatest(coalesce(p_amount, 0), 0), cap);
  if amt = 0 then return jsonb_build_object('ok', true, 'got', 0, 'coins', public.coin_add(uid, 0, '', '')); end if;
  if exists (select 1 from public.coin_log where user_id = uid and source = 'run' and created_at > now() - interval '20 seconds') then
    return jsonb_build_object('ok', false, 'reason', 'too_fast');
  end if;
  select coalesce(sum(amount), 0) into today from public.coin_log where user_id = uid and source = 'run' and day = public.coin_today();
  amt := least(amt, greatest(0, 1500 - today));
  if amt = 0 then return jsonb_build_object('ok', false, 'reason', 'day_cap'); end if;
  if exists (select 1 from public.coin_log where user_id = uid and source = 'run' and ref = p_ref) then
    return jsonb_build_object('ok', false, 'reason', 'dup');
  end if;
  bal := public.coin_add(uid, amt, 'run', p_ref);
  got := amt;
  if coalesce(public.has_perks(uid), false) then bal := public.coin_add(uid, amt, 'vip', p_ref); got := amt * 2; end if;
  return jsonb_build_object('ok', true, 'got', got, 'base', amt, 'coins', bal);
end; $$;
grant execute on function public.coins_run(text, int, text) to authenticated;

-- ── Реклама за награду (кнопка «📺 Смотреть рекламу» — награда, только если досмотрел) ──
--   p_kind 'coins'  — +40 монет, до 8 раз в день, не чаще раза в 45 с;
--   p_kind 'double' — ещё столько же, сколько принёс забег p_ref (за последние 15 минут), до 5 раз в день.
create or replace function public.coins_ad(p_kind text, p_ref text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int; run_amt int; bal int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_kind = 'coins' then
    select count(*) into n from public.coin_log where user_id = uid and source = 'ad' and day = public.coin_today();
    if n >= 8 then return jsonb_build_object('ok', false, 'reason', 'day_cap'); end if;
    if exists (select 1 from public.coin_log where user_id = uid and source = 'ad' and created_at > now() - interval '45 seconds') then
      return jsonb_build_object('ok', false, 'reason', 'too_fast');
    end if;
    bal := public.coin_add(uid, 40, 'ad', '');
    return jsonb_build_object('ok', true, 'got', 40, 'coins', bal);
  elsif p_kind = 'double' then
    select count(*) into n from public.coin_log where user_id = uid and source = 'double' and day = public.coin_today();
    if n >= 5 then return jsonb_build_object('ok', false, 'reason', 'day_cap'); end if;
    select amount into run_amt from public.coin_log
      where user_id = uid and source = 'run' and ref = coalesce(p_ref, '') and created_at > now() - interval '15 minutes';
    if run_amt is null then return jsonb_build_object('ok', false, 'reason', 'run'); end if;
    if exists (select 1 from public.coin_log where user_id = uid and source = 'double' and ref = p_ref) then
      return jsonb_build_object('ok', false, 'reason', 'dup');
    end if;
    bal := public.coin_add(uid, run_amt, 'double', p_ref);
    return jsonb_build_object('ok', true, 'got', run_amt, 'coins', bal);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'kind');
end; $$;
grant execute on function public.coins_ad(text, text) to authenticated;

-- ── Покупка навсегда (герои, улучшения, части персонажа). Улучшения — по порядку уровней ──
create or replace function public.coins_buy(p_item text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); price int := public.coin_price(p_item); w public.coin_wallet%rowtype; lvl int; prev text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if price is null or price = 0 or p_item = 'revive' then return jsonb_build_object('ok', false, 'reason', 'item'); end if;
  insert into public.coin_wallet (user_id) values (uid) on conflict (user_id) do nothing;
  select * into w from public.coin_wallet where user_id = uid for update;
  if p_item = any(w.items) then
    return jsonb_build_object('ok', false, 'reason', 'owned', 'coins', w.coins, 'items', to_jsonb(w.items));
  end if;
  if p_item like 'up:%' then
    lvl := split_part(p_item, ':', 3)::int;
    prev := split_part(p_item, ':', 1) || ':' || split_part(p_item, ':', 2) || ':' || (lvl - 1);
    if lvl > 1 and not (prev = any(w.items)) then
      return jsonb_build_object('ok', false, 'reason', 'order', 'coins', w.coins, 'items', to_jsonb(w.items));
    end if;
  end if;
  if w.coins < price then
    return jsonb_build_object('ok', false, 'reason', 'coins', 'coins', w.coins, 'items', to_jsonb(w.items));
  end if;
  update public.coin_wallet set coins = coins - price, items = array_append(items, p_item), updated_at = now()
    where user_id = uid returning * into w;
  insert into public.coin_log (user_id, amount, source, ref) values (uid, -price, 'buy', p_item);
  return jsonb_build_object('ok', true, 'coins', w.coins, 'items', to_jsonb(w.items));
end; $$;
grant execute on function public.coins_buy(text) to authenticated;

-- ── Возрождение за монеты (раз за забег — следит игра) ──
create or replace function public.coins_revive(p_game text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); price int := public.coin_price('revive'); w public.coin_wallet%rowtype;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if public.coin_run_cap(p_game) is null then return jsonb_build_object('ok', false, 'reason', 'game'); end if;
  select * into w from public.coin_wallet where user_id = uid for update;
  if not found or w.coins < price then return jsonb_build_object('ok', false, 'reason', 'coins', 'coins', coalesce(w.coins, 0)); end if;
  update public.coin_wallet set coins = coins - price, updated_at = now() where user_id = uid returning * into w;
  insert into public.coin_log (user_id, amount, source, ref) values (uid, -price, 'revive', p_game);
  return jsonb_build_object('ok', true, 'coins', w.coins);
end; $$;
grant execute on function public.coins_revive(text) to authenticated;

-- ── Перенос монет, накопленных без входа: один раз, до 1000 ──
create or replace function public.coins_import(p_amount int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); amt int := least(greatest(coalesce(p_amount, 0), 0), 1000); bal int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if exists (select 1 from public.coin_log where user_id = uid and source = 'import') then
    return jsonb_build_object('ok', false, 'reason', 'done');
  end if;
  if amt = 0 then return jsonb_build_object('ok', true, 'got', 0); end if;
  bal := public.coin_add(uid, amt, 'import', 'guest');
  return jsonb_build_object('ok', true, 'got', amt, 'coins', bal);
end; $$;
grant execute on function public.coins_import(int) to authenticated;

-- ── Надеть персонажа: каждая часть — бесплатная, купленная или VIP-часть у VIP/персонала ──
create or replace function public.char_save(p_look jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); slot text; val text; item text; pr int; owned text[]; perks boolean; clean jsonb := '{}'::jsonb;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_look is null or jsonb_typeof(p_look) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  select items into owned from public.coin_wallet where user_id = uid;
  perks := coalesce(public.has_perks(uid), false);
  foreach slot in array array['color', 'eyes', 'mouth', 'hat', 'item', 'pet', 'trail'] loop
    val := p_look ->> slot;
    if val is null or val = '' then continue; end if;
    if val !~ '^[a-z0-9]{1,20}$' then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
    item := 'skin:' || slot || ':' || val;
    pr := public.coin_price(item);
    if pr is null then return jsonb_build_object('ok', false, 'reason', 'item', 'item', item); end if;
    if pr > 0 and not (item = any(coalesce(owned, '{}'::text[]))) and not (perks and public.coin_vip_item(item)) then
      return jsonb_build_object('ok', false, 'reason', 'not_owned', 'item', item);
    end if;
    clean := clean || jsonb_build_object(slot, val);
  end loop;
  insert into public.coin_wallet (user_id, look) values (uid, clean)
    on conflict (user_id) do update set look = excluded.look, updated_at = now();
  return jsonb_build_object('ok', true, 'look', clean);
end; $$;
grant execute on function public.char_save(jsonb) to authenticated;

-- Персонажи других людей — для рекордов, профиля и игр вдвоём (только внешний вид, до 100 за раз)
create or replace function public.char_looks(p_ids uuid[])
returns table(user_id uuid, look jsonb) language sql stable security definer set search_path = public as $$
  select w.user_id, w.look from public.coin_wallet w
  where w.user_id = any(p_ids[1:100]) and w.look <> '{}'::jsonb
$$;
grant execute on function public.char_looks(uuid[]) to anon, authenticated;

-- ── Победа в любой игре сайта: +5 монет, до 20 раз в день (пишет game_result через game_log) ──
create or replace function public.coins_on_game_win()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.win then
    begin
      if (select count(*) from public.coin_log where user_id = new.user_id and source = 'win' and day = public.coin_today()) < 20 then
        perform public.coin_add(new.user_id, 5, 'win', new.game);
      end if;
    exception when others then null;   -- монеты никогда не ломают запись результата
    end;
  end if;
  return new;
end; $$;
drop trigger if exists trg_coins_on_game_win on public.game_log;
create trigger trg_coins_on_game_win after insert on public.game_log
  for each row execute function public.coins_on_game_win();

-- ── Задание дня выполнено (claim_daily_quest пишет XP с source 'daily'): +50 монет ──
create or replace function public.coins_on_daily_quest()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'daily' then
    begin
      if not exists (select 1 from public.coin_log where user_id = new.user_id and source = 'quest' and ref = new.ref) then
        perform public.coin_add(new.user_id, 50, 'quest', new.ref);
      end if;
    exception when others then null;
    end;
  end if;
  return new;
end; $$;
drop trigger if exists trg_coins_on_daily_quest on public.xp_ledger;
create trigger trg_coins_on_daily_quest after insert on public.xp_ledger
  for each row execute function public.coins_on_daily_quest();
