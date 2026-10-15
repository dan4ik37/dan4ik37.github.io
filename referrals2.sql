-- ═══════════════════════════════════════════════════════════════════
--  👥 ПРИГЛАШЕНИЯ ДРУЗЕЙ 2.0 — реф-система (docs/REFERRALS.md; сайт — js/core/ref.js, js/features/invite.js, /r/<код>)
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно (можно запускать повторно — ничего не задвоится).
--  Порядок: после economy.sql (если его запускаешь; можно и без него). Нужны уже применённые: referrals.sql, xp.sql,
--  progression.sql, notifications.sql, coins.sql, premium.sql, privacy.sql, server-hardening.sql; age.sql — желательно
--  (без него детей не отличить).
--
--  Что меняется:
--   • Своя короткая ссылка dan4ik37.vercel.app/r/<код> (6 знаков без гласных, ref_codes); старые ?ref=<ник> работают.
--   • Привязка: регистрация по почте (метаданные ref, как раньше) — сразу; любой другой вход (Google, VK, Telegram…) — после
--     первого входа (ref_claim: код ждёт в браузере до keep_days дней). Аккаунту не старше claim_days дней, один раз.
--   • Награды — за игру друга, а не за регистрацию: друг дошёл до 3 / 5 / 10 уровня → пригласившему XP и монеты (ref_ladder.m);
--     новичку на 3 уровне — подарок (монеты + след «Конфетти», ref_ladder.w); ступени «N друзей дошли до уровня» — питомец,
--     вещь в руку, рамка «Посол», след и монеты (ref_ladder.t). Прежние 50–100 XP за регистрацию больше не начисляются
--     (триггер xp_on_referral убран) — те же 50 XP теперь за 3 и 5 уровень друга.
--   • Бонус за поддержку: друг получил 💎 за НАСТОЯЩИЕ деньги — premium_ledger kind 'pay' (не тестовый платёж) или 'donation';
--     донат в режиме «VIP сразу» — по курсу доната (vip_donation_log) → пригласившему pct % этих 💎, months месяцев после
--     регистрации друга, не больше gems_month 💎 в месяц (по МСК). Подарки админа (grant) и возвраты бонус не дают. Возврат денег —
--     бонус за этот платёж списывается (не хватает 💎 — долгом, как в premium_refund). Покупки детей (age.sql) бонус не приносят.
--   • Защита: себя (тот же аккаунт или то же устройство) — не засчитывается; тот же IP, общее устройство с другим аккаунтом, много
--     друзей с одного IP — награды «на проверке», решает админ (ref_admin_*); за уровни друзей — не больше day_cap наград в сутки
--     и month_cap за 30 дней (лишние ждут). IP и ключ устройства — только хешем (sha256 с секретом базы), marks_days дней, только
--     для этой проверки; только у тех, кто зовёт друзей, и у новичков по ссылке.
--   • referral_count = друзья, дошедшие до 3 уровня (не «написал сообщение»): ачивки «Амбассадор» / «Инфлюенсер» и заявки в друзья
--     за 5 приглашённых — только за настоящих. Дети: в топе — без ника; пригласивший видит у ребёнка только ник и уровень.
--  Числа — ref_rule() и ref_ladder() (клиент — js/core/ref.js RULES и LADDER; scripts/referral-test.cjs сверяет).
--  ВНИМАНИЕ: переопределены referral_count, top_referrers, prevent_referred_by_tamper (referrals.sql); убраны триггеры
--  xp_on_referral (xp.sql) и notif_on_referral (notifications.sql). Перезапустил referrals.sql, xp.sql или notifications.sql —
--  потом запусти этот ещё раз.
--  Проверка после запуска: /rpc/ref_rule {"p_key":"pct"} → 10 (PGRST202 — не применён); /rpc/ref_public гостем {"p_code":"zzzzzz"}
--  → {"ok":false,"reason":"not_found"}; /rpc/ref_claim гостем {"p_code":"x"} → {"ok":false,"reason":"auth"}.
-- ═══════════════════════════════════════════════════════════════════

-- ═══ 0. Колонки, на которые опирается файл (на базе есть; вдруг старый скрипт применился не целиком) ═══
alter table public.profiles add column if not exists referred_by uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists created_at timestamptz default now();
alter table public.profiles add column if not exists privacy_profile text not null default 'all';

-- ═══ 1. Числа — одно место (клиент: js/core/ref.js RULES / LADDER; scripts/referral-test.cjs сверяет) ═══
--   pct — бонус за поддержку, % от 💎 друга; months — столько месяцев после регистрации друга; gems_month — не больше 💎 в месяц;
--   claim_days — привязать можно аккаунт не старше стольких дней; keep_days — столько дней код ждёт в браузере;
--   day_cap / month_cap — наград за уровни друзей у одного пригласившего в сутки / за 30 дней (лишние ждут);
--   ip_burst — столько друзей с одного IP за 30 дней — на проверку; marks_days — сколько хранить хеши IP и устройства;
--   fresh_days — столько дней после привязки помним IP и устройство новичка
create or replace function public.ref_rule(p_key text) returns int language sql immutable as $$
  select case p_key
    when 'pct' then 10 when 'months' then 12 when 'gems_month' then 500
    when 'claim_days' then 7 when 'keep_days' then 30
    when 'day_cap' then 10 when 'month_cap' then 60
    when 'ip_burst' then 3 when 'marks_days' then 90 when 'fresh_days' then 30
  end
$$;
grant execute on function public.ref_rule(text) to anon, authenticated;

-- m — друг дошёл до уровня lv → пригласившему xp и coins (id l3 / l5 / l10 — колонки l3_at / l5_at / l10_at в ref_links);
-- w — подарок новичку на уровне lv: монеты и вещь персонажа (avatar.js PARTS, 8-е поле — «за приглашения»);
-- t — ступени пригласившего: n друзей дошли до уровня lv → вещь, рамка «Посол» (frame) или монеты, один раз
create or replace function public.ref_ladder() returns jsonb language sql immutable as $$
  select '{
    "m": [{"id":"l3","lv":3,"xp":25,"coins":30},{"id":"l5","lv":5,"xp":25,"coins":50},{"id":"l10","lv":10,"coins":100}],
    "w": {"lv":3,"coins":50,"part":"trail:confetti","text":"След «Конфетти»"},
    "t": [{"id":"t1","n":1,"lv":5,"part":"pet:parrot","text":"Питомец «Попугай»"},
          {"id":"t2","n":3,"lv":5,"part":"item:megaphone","text":"«Мегафон» в руку"},
          {"id":"t3","n":5,"lv":5,"frame":1,"text":"Рамка аватара «Посол»"},
          {"id":"t4","n":10,"lv":10,"coins":500,"part":"trail:fireworks","text":"След «Салют» и 500 🪙"}]
  }'::jsonb
$$;
grant execute on function public.ref_ladder() to anon, authenticated;

-- ═══ 2. Таблицы (читают и пишут только функции ниже: RLS без политик) ═══
create table if not exists public.ref_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null unique,
  hide_top boolean not null default false,   -- не показывать ник в топе пригласивших
  frame_on boolean not null default true,    -- рамка «Посол» вместо рамки уровня (когда заработана)
  active_at timestamptz,                     -- зовёт друзей (открыл приглашения / поделился ссылкой) — помним IP и устройство
  created_at timestamptz not null default now()
);

create table if not exists public.ref_links (
  invitee uuid primary key references public.profiles(id) on delete cascade,   -- кто пришёл
  inviter uuid not null references public.profiles(id) on delete cascade,      -- кто позвал
  code text,                                -- по какому коду (или старому нику)
  src text not null default 'link',         -- link | signup | game | room | world | studio | video | legacy …
  place text,                               -- куда звали (games/chess/abcd)
  status text not null default 'ok',        -- ok | hold (на проверке) | denied (админ отклонил) | self (сам себя)
  flags text[] not null default '{}',       -- same_dev, same_ip, dev_reuse, ip_burst
  l3_at timestamptz, l5_at timestamptz, l10_at timestamptz,   -- когда друг дошёл до уровня
  legacy boolean not null default false,    -- привязан по старым правилам (до этого файла)
  reviewed_by uuid, reviewed_at timestamptz, note text,
  created_at timestamptz not null default now(),
  constraint ref_links_status check (status in ('ok', 'hold', 'denied', 'self')),
  constraint ref_links_not_self check (invitee <> inviter)
);
create index if not exists idx_ref_links_inviter on public.ref_links (inviter, created_at desc);
create index if not exists idx_ref_links_review on public.ref_links (status, created_at) where status in ('hold', 'self');

-- Хеши IP и ключа устройства (без самих значений)
create table if not exists public.ref_marks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,                       -- ip | dev
  h text not null,
  day date not null default (now() at time zone 'Europe/Moscow')::date,   -- когда видели последний раз
  primary key (user_id, kind, h)
);
create index if not exists idx_ref_marks_h on public.ref_marks (kind, h);

-- Награды: одна строка — одна награда; (kind, ref) — один раз
create table if not exists public.ref_payouts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,   -- кому
  invitee uuid references public.profiles(id) on delete set null,           -- за какого друга (у ступеней — нет)
  kind text not null,       -- l3 l5 l10 — уровни друга; welcome — подарок новичку; t1…t4 — ступени; aff — бонус за поддержку
  ref text not null,        -- ключ события: id друга / id пригласившего / источник 💎
  xp int not null default 0, coins int not null default 0, gems int not null default 0, item text,
  status text not null default 'paid',      -- paid | hold (ждёт проверки или лимита) | denied | back (бонус списан целиком)
  reason text,              -- hold: link — приглашение на проверке; limit — лимит наград
  src text,                 -- aff: откуда 💎 — pay:<провайдер>:<номер> | don:<номер доната>
  back int not null default 0,              -- сколько 💎 бонуса уже списано (друг вернул деньги)
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (kind, ref)
);
create index if not exists idx_ref_payouts_user on public.ref_payouts (user_id, created_at desc);
create index if not exists idx_ref_payouts_invitee on public.ref_payouts (invitee);
create index if not exists idx_ref_payouts_hold on public.ref_payouts (user_id) where status = 'hold';

create table if not exists public.ref_secret (id int primary key default 1 check (id = 1), k text not null);
insert into public.ref_secret (id, k) values (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (id) do nothing;

alter table public.ref_codes enable row level security;
alter table public.ref_links enable row level security;
alter table public.ref_marks enable row level security;
alter table public.ref_payouts enable row level security;
alter table public.ref_secret enable row level security;
revoke all on public.ref_codes, public.ref_links, public.ref_marks, public.ref_payouts, public.ref_secret from anon, authenticated;

-- ═══ 3. Служебные (клиенту не даны — revoke в конце файла) ═══
-- Хеш IP / устройства: sha256 с секретом базы, 16 знаков — обратно значение не восстановить
create or replace function public.ref_hash(p_kind text, p_val text) returns text
language sql stable security definer set search_path = public as $$
  select left(encode(sha256(convert_to((select k from public.ref_secret where id = 1) || '|' || p_kind || '|' || p_val, 'UTF8')), 'hex'), 16)
$$;

-- IP запроса (как ugc_play); у IPv6 — только сеть /64 (адрес внутри неё меняется сам)
create or replace function public.ref_ip() returns text language plpgsql stable as $$
declare hdr json; ip text;
begin
  begin hdr := nullif(current_setting('request.headers', true), '')::json; exception when others then hdr := null; end;
  ip := btrim(coalesce(hdr ->> 'cf-connecting-ip', hdr ->> 'x-real-ip', split_part(coalesce(hdr ->> 'x-forwarded-for', ''), ',', 1), ''));
  if ip = '' then return null; end if;
  begin
    if family(ip::inet) = 6 then ip := host(network(set_masklen(ip::inet, 64))); else ip := host(ip::inet); end if;
  exception when others then null;
  end;
  return lower(ip);
end $$;

-- Запомнить IP и ключ устройства (хешем). p_dev — случайный ключ браузера (js/core/ref.js → localStorage d37_dev)
create or replace function public.ref_mark(p_uid uuid, p_dev text) returns void
language plpgsql security definer set search_path = public as $$
declare v_ip text := public.ref_ip(); d date := (now() at time zone 'Europe/Moscow')::date;
begin
  if p_uid is null then return; end if;
  if v_ip is not null then
    insert into public.ref_marks (user_id, kind, h, day) values (p_uid, 'ip', public.ref_hash('ip', v_ip), d)
      on conflict (user_id, kind, h) do update set day = excluded.day;
  end if;
  if coalesce(p_dev, '') ~ '^[A-Za-z0-9_-]{16,64}$' then
    insert into public.ref_marks (user_id, kind, h, day) values (p_uid, 'dev', public.ref_hash('dev', p_dev), d)
      on conflict (user_id, kind, h) do update set day = excluded.day;
  end if;
  -- не больше 30 свежих меток на человека; старше marks_days — прочь
  if (select count(*) from public.ref_marks where user_id = p_uid) > 40 then
    delete from public.ref_marks m where m.user_id = p_uid and (m.kind, m.h) not in
      (select x.kind, x.h from public.ref_marks x where x.user_id = p_uid order by x.day desc limit 30);
  end if;
  if random() < .02 then delete from public.ref_marks where day < d - public.ref_rule('marks_days'); end if;
end $$;

-- Ребёнок (age.sql)? Нет age.sql — нет
create or replace function public.ref_is_kid(p_uid uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare g text;
begin
  if p_uid is null or to_regprocedure('public.age_group_of(uuid)') is null then return false; end if;
  execute 'select public.age_group_of($1)' into g using p_uid;
  return g = 'child';
end $$;

-- Можно ли пригласившему видеть подробности о друге: профиль открыт ему (privacy.sql) и друг — не ребёнок.
-- Иначе — только ник и уровень (по ответу не понять, почему: скрыл профиль или ребёнок)
create or replace function public.ref_open(p_uid uuid, p_viewer uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare pv text; fr boolean := false;
begin
  select privacy_profile into pv from public.profiles where id = p_uid;
  if pv is null or public.ref_is_kid(p_uid) then return false; end if;
  if pv = 'all' then return true; end if;
  if pv = 'friends' and to_regprocedure('public.are_friends(uuid,uuid)') is not null then
    execute 'select public.are_friends($1, $2)' into fr using p_uid, p_viewer;
  end if;
  return coalesce(fr, false);
end $$;

-- Ник для показа (ник по умолчанию user_<id> — не ник)
create or replace function public.ref_nick(p_uid uuid) returns text language sql stable security definer set search_path = public as $$
  select case when nick ~ '^user_[0-9a-f]{6,32}$' then null else nick end from public.profiles where id = p_uid
$$;

-- Код: 6 знаков из цифр 2–9 и согласных (без гласных — слов не сложится; без l, x, y и похожих), без пары плохих сочетаний
create or replace function public.ref_new_code() returns text language plpgsql volatile set search_path = public as $$
declare a text := '23456789bcdfghjkmnpqrstvwz'; c text; i int;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
    continue when c ~ '(pzd|fck|fkn|bdsm|kkk|ss|wtf|gvn)';
    exit when not exists (select 1 from public.ref_codes where code = c);
  end loop;
  return c;
end $$;

-- Свой код (p_create — завести, если нет)
create or replace function public.ref_code_of(p_uid uuid, p_create boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare c text; i int;
begin
  select code into c from public.ref_codes where user_id = p_uid;
  if c is null and p_create and exists (select 1 from public.profiles where id = p_uid) then
    for i in 1..5 loop
      begin
        insert into public.ref_codes (user_id, code) values (p_uid, public.ref_new_code()) on conflict (user_id) do nothing;
        exit;
      exception when unique_violation then null;   -- тот же код в ту же секунду у другого — ещё раз
      end;
    end loop;
    select code into c from public.ref_codes where user_id = p_uid;
  end if;
  return c;
end $$;

-- Код (или старый ник из ?ref=<ник>) → кто позвал
create or replace function public.ref_resolve(p_code text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare c text := lower(btrim(coalesce(p_code, ''))); v uuid; n int;
begin
  if c = '' or char_length(c) > 24 then return null; end if;
  select user_id into v from public.ref_codes where code = c;
  if v is not null then return v; end if;
  select count(*), (array_agg(id))[1] into n, v from public.profiles where lower(nick) = c;
  return case when n = 1 then v end;
end $$;

create or replace function public.ref_notify(p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_dedupe text,
  p_link text default '#/invite')
returns void language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.notify(p_user, p_kind, p_actor, p_title, p_body, p_link, p_dedupe);
  exception when others then null;   -- нет notifications.sql — молча
  end;
end $$;

-- Признаки накрутки у приглашения друга p_invitee:
--   same_dev — то же устройство, что у пригласившего (= сам себя); same_ip — тот же IP за 30 дней;
--   dev_reuse — устройство друга есть ещё у какого-то аккаунта; ip_burst — с этого IP за 30 дней пришло ip_burst+ друзей того же
create or replace function public.ref_assess(p_invitee uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare v_inv uuid; f text[] := '{}'; n int; d date := (now() at time zone 'Europe/Moscow')::date - 30;
begin
  select inviter into v_inv from public.ref_links where invitee = p_invitee;
  if v_inv is null then return f; end if;
  if exists (select 1 from public.ref_marks a join public.ref_marks b on b.kind = 'dev' and b.h = a.h and b.user_id = v_inv
             where a.user_id = p_invitee and a.kind = 'dev') then f := array_append(f, 'same_dev'); end if;
  if exists (select 1 from public.ref_marks a join public.ref_marks b on b.kind = 'ip' and b.h = a.h and b.user_id = v_inv and b.day >= d
             where a.user_id = p_invitee and a.kind = 'ip' and a.day >= d) then f := array_append(f, 'same_ip'); end if;
  if exists (select 1 from public.ref_marks a join public.ref_marks b on b.kind = 'dev' and b.h = a.h and b.user_id <> p_invitee and b.user_id <> v_inv
             where a.user_id = p_invitee and a.kind = 'dev') then f := array_append(f, 'dev_reuse'); end if;
  select count(distinct b.user_id) into n from public.ref_marks a
    join public.ref_marks b on b.kind = 'ip' and b.h = a.h and b.user_id <> a.user_id and b.day >= d
    join public.ref_links x on x.invitee = b.user_id and x.inviter = v_inv
    where a.user_id = p_invitee and a.kind = 'ip' and a.day >= d;
  if n + 1 >= public.ref_rule('ip_burst') then f := array_append(f, 'ip_burst'); end if;
  return f;
end $$;

-- Состояние по признакам: то же устройство — «сам себя»; любой другой признак — на проверку
create or replace function public.ref_status_of(f text[]) returns text language sql immutable as $$
  select case when 'same_dev' = any(f) then 'self' when cardinality(f) > 0 then 'hold' else 'ok' end
$$;

-- Пересчитать признаки приглашения (пока админ не решил сам). Само становится только строже: ok → hold → self.
-- Друг уже играл (3 уровень), а потом зашёл с устройства пригласившего (в гостях) — это «на проверку», а не «сам себя»
create or replace function public.ref_reassess(p_invitee uuid) returns text
language plpgsql security definer set search_path = public as $$
declare l public.ref_links%rowtype; f text[]; st text;
begin
  select * into l from public.ref_links where invitee = p_invitee for update;
  if not found then return null; end if;
  if l.reviewed_at is not null or l.status in ('denied', 'self') then return l.status; end if;
  f := public.ref_assess(p_invitee);
  st := public.ref_status_of(f);
  if st = 'self' and l.l3_at is not null then st := 'hold'; end if;
  if l.status = 'hold' and st = 'ok' then st := 'hold'; end if;
  if st is distinct from l.status or f is distinct from l.flags then
    update public.ref_links set status = st, flags = f where invitee = p_invitee;
  end if;
  return st;
end $$;

-- Лимит наград за уровни друзей у одного пригласившего: day_cap за сутки и month_cap за 30 дней (выданных)
create or replace function public.ref_over_cap(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.ref_payouts where user_id = p_user and kind in ('l3', 'l5', 'l10') and status = 'paid'
            and paid_at > now() - interval '1 day') >= public.ref_rule('day_cap')
      or (select count(*) from public.ref_payouts where user_id = p_user and kind in ('l3', 'l5', 'l10') and status = 'paid'
            and paid_at > now() - interval '30 days') >= public.ref_rule('month_cap')
$$;

-- Выдать награду (строка ref_payouts уже есть и только что стала «выдана»): XP, монеты, 💎, вещь персонажа
create or replace function public.ref_apply(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare p public.ref_payouts%rowtype;
begin
  select * into p from public.ref_payouts where id = p_id;
  if not found then return; end if;
  -- XP: за друга, привязанного по старым правилам, XP за регистрацию уже был (xp.sql) — второй раз не даём
  if p.xp > 0 and to_regprocedure('public.xp_award(uuid,text,text,integer,integer)') is not null
     and not (p.invitee is not null and exists (select 1 from public.xp_ledger x
                where x.user_id = p.user_id and x.source = 'referral' and x.ref = p.invitee::text)) then
    perform public.xp_award(p.user_id, 'referral', coalesce(p.invitee::text, p.ref) || ':' || p.kind, p.xp);
  end if;
  if p.coins > 0 and to_regprocedure('public.coin_add(uuid,integer,text,text)') is not null then
    perform public.coin_add(p.user_id, p.coins, 'ref', p.kind || ':' || p.ref);
  end if;
  if p.gems > 0 and to_regprocedure('public.premium_add(uuid,integer,text,text,text,uuid)') is not null then
    perform public.premium_add(p.user_id, p.gems, 'ref', p.kind || ':' || p.ref, 'Бонус за друзей: друг поддержал сайт');
  end if;
  -- вещь персонажа — в купленное (coin_wallet.items): цены у неё нет, char_save наденет, раз она есть
  if p.item is not null and to_regclass('public.coin_wallet') is not null then
    insert into public.coin_wallet (user_id) values (p.user_id) on conflict (user_id) do nothing;
    update public.coin_wallet set items = array_append(items, p.item), updated_at = now()
      where user_id = p.user_id and not (p.item = any(items));
  end if;
end $$;

-- Записать награду (один раз на событие: kind + ref) и сразу выдать — или отложить (p_hold: link | limit). → id или null (уже была)
create or replace function public.ref_pay(p_user uuid, p_kind text, p_ref text, p_invitee uuid, p_xp int, p_coins int, p_gems int,
  p_item text, p_hold text, p_src text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.ref_payouts (user_id, invitee, kind, ref, xp, coins, gems, item, status, reason, src, paid_at)
    values (p_user, p_invitee, p_kind, p_ref, coalesce(p_xp, 0), coalesce(p_coins, 0), coalesce(p_gems, 0), p_item,
            case when p_hold is null then 'paid' else 'hold' end, p_hold, p_src, case when p_hold is null then now() end)
    on conflict (kind, ref) do nothing
    returning id into v_id;
  if v_id is not null and p_hold is null then perform public.ref_apply(v_id); end if;
  return v_id;
end $$;

-- «+25 XP и +30 🪙»
create or replace function public.ref_gift_text(p_xp int, p_coins int, p_gems int default 0) returns text language sql immutable as $$
  select concat_ws(' и ', case when coalesce(p_xp, 0) > 0 then '+' || p_xp || ' XP' end,
    case when coalesce(p_coins, 0) > 0 then '+' || p_coins || ' 🪙' end, case when coalesce(p_gems, 0) > 0 then '+' || p_gems || ' 💎' end)
$$;

-- Награды, отложенные из-за лимита, — когда лимит освободился (приглашение при этом в порядке)
create or replace function public.ref_release(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select y.id from public.ref_payouts y join public.ref_links l on l.invitee = y.invitee and l.status = 'ok'
           where y.user_id = p_user and y.status = 'hold' and y.reason = 'limit' order by y.id loop
    exit when public.ref_over_cap(p_user);
    update public.ref_payouts set status = 'paid', paid_at = now(), reason = null where id = r.id;
    perform public.ref_apply(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Ступени пригласившего: n друзей (приглашения в порядке) дошли до уровня lv → награда один раз
create or replace function public.ref_tiers(p_inviter uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t jsonb; n int;
begin
  if p_inviter is null then return; end if;
  for t in select x from jsonb_array_elements(public.ref_ladder() -> 't') x loop
    continue when exists (select 1 from public.ref_payouts where kind = t ->> 'id' and ref = p_inviter::text);
    select count(*) into n from public.ref_links where inviter = p_inviter and status = 'ok'
      and (case (t ->> 'lv')::int when 10 then l10_at when 5 then l5_at else l3_at end) is not null;
    if n >= (t ->> 'n')::int then
      if public.ref_pay(p_inviter, t ->> 'id', p_inviter::text, null, 0, coalesce((t ->> 'coins')::int, 0), 0,
           case when t ? 'part' then 'skin:' || (t ->> 'part') end, null) is not null then
        perform public.ref_notify(p_inviter, 'ref_reward', null, '🏆 ' || (t ->> 'text') || ' — твоё!',
          format('Друзей, дошедших до %s уровня: %s. Спасибо, что зовёшь!', t ->> 'lv', n), 'reft:' || (t ->> 'id'));
      end if;
    end if;
  end loop;
end $$;

-- Друг p_invitee вырос: новые уровни → награды пригласившему, подарок новичку, ступени
create or replace function public.ref_check(p_invitee uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.ref_links%rowtype; lv int; lad jsonb := public.ref_ladder(); m jsonb; w jsonb; st text; hold text; v_id bigint;
  reached timestamptz;
begin
  st := public.ref_reassess(p_invitee);
  if st is null or st in ('denied', 'self') then return; end if;
  select * into l from public.ref_links where invitee = p_invitee for update;
  lv := coalesce(public.user_level(p_invitee), 1);
  w := lad -> 'w';
  for m in select x from jsonb_array_elements(lad -> 'm') x order by (x ->> 'lv')::int loop
    exit when lv < (m ->> 'lv')::int;
    reached := case m ->> 'id' when 'l3' then l.l3_at when 'l5' then l.l5_at when 'l10' then l.l10_at end;
    continue when reached is not null;
    if m ->> 'id' = 'l3' then update public.ref_links set l3_at = now() where invitee = p_invitee;
    elsif m ->> 'id' = 'l5' then update public.ref_links set l5_at = now() where invitee = p_invitee;
    elsif m ->> 'id' = 'l10' then update public.ref_links set l10_at = now() where invitee = p_invitee;
    end if;
    hold := case when l.status = 'hold' then 'link' when public.ref_over_cap(l.inviter) then 'limit' end;
    v_id := public.ref_pay(l.inviter, m ->> 'id', p_invitee::text, p_invitee, (m ->> 'xp')::int, (m ->> 'coins')::int, 0, null, hold);
    if v_id is not null then
      if hold is null then
        perform public.ref_notify(l.inviter, 'ref_reward', p_invitee,
          format('дошёл(ла) до %s уровня — тебе %s 🎁', m ->> 'lv', public.ref_gift_text((m ->> 'xp')::int, (m ->> 'coins')::int)),
          'Спасибо, что зовёшь друзей! Все награды — в «Пригласи друзей».', 'refm:' || p_invitee || ':' || (m ->> 'id'));
      elsif hold = 'link' then
        perform public.ref_notify(l.inviter, 'ref_hold', p_invitee, format('дошёл(ла) до %s уровня — награда на проверке ⏳', m ->> 'lv'),
          'Проверяем, что это другой человек, а не второй аккаунт. Обычно — за сутки.', 'refh:' || p_invitee);
      else
        perform public.ref_notify(l.inviter, 'ref_hold', p_invitee, format('дошёл(ла) до %s уровня — награда придёт чуть позже ⏳', m ->> 'lv'),
          'Сегодня уже много наград за друзей — эта начислится, когда освободится лимит.', 'refl:' || p_invitee || ':' || (m ->> 'id'));
      end if;
    end if;
  end loop;
  -- подарок новичку (по старым правилам привязанным — нет: момент прошёл)
  if not l.legacy and lv >= (w ->> 'lv')::int then
    v_id := public.ref_pay(p_invitee, 'welcome', p_invitee::text, p_invitee, 0, (w ->> 'coins')::int, 0, 'skin:' || (w ->> 'part'),
      case when l.status = 'hold' then 'link' end);
    if v_id is not null and l.status = 'ok' then
      perform public.ref_notify(p_invitee, 'ref_reward', l.inviter,
        format('позвал(а) тебя на сайт — держи подарок: +%s 🪙 и %s 🎊', w ->> 'coins', w ->> 'text'),
        'Ты дошёл(ла) до ' || (w ->> 'lv') || ' уровня. След — в гардеробе.', 'refw', '#/games/wardrobe');
    end if;
  end if;
  perform public.ref_release(l.inviter);
  perform public.ref_tiers(l.inviter);
end $$;

-- Ответ новичку про его приглашение
create or replace function public.ref_claim_answer(p_uid uuid, p_already boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.ref_links%rowtype;
begin
  select * into l from public.ref_links where invitee = p_uid;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if l.status = 'self' then return jsonb_build_object('ok', false, 'reason', 'self_device'); end if;
  if l.status = 'denied' then return jsonb_build_object('ok', false, 'reason', 'denied'); end if;
  return jsonb_build_object('ok', true, 'already', p_already, 'inviter', public.ref_nick(l.inviter),
    'gift', public.ref_ladder() -> 'w', 'lv', coalesce(public.user_level(p_uid), 1),
    'got', exists (select 1 from public.ref_payouts where kind = 'welcome' and ref = p_uid::text and status = 'paid'));
end $$;

-- ═══ 4. Привязка ═══
-- После входа (любой способ: почта, Google, VK, Telegram…): код из ссылки, ключ устройства, откуда и куда звали
create or replace function public.ref_claim(p_code text, p_dev text default null, p_src text default null, p_place text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_inv uuid; v_created timestamptz; st text; m jsonb := public.ref_ladder() -> 'm' -> 0;
  v_src text := case when coalesce(p_src, '') ~ '^[a-z0-9_]{1,16}$' then p_src else 'link' end;
  v_place text := case when coalesce(p_place, '') ~ '^[A-Za-z0-9/_-]{1,80}$' then p_place end;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  perform pg_advisory_xact_lock(hashtext('ref_claim:' || uid::text));
  -- уже привязан (регистрация по почте с кодом, другой браузер) — освежить признаки
  if exists (select 1 from public.ref_links where invitee = uid) then
    perform public.ref_mark(uid, p_dev);
    perform public.ref_check(uid);
    return public.ref_claim_answer(uid, true);
  end if;
  v_inv := public.ref_resolve(p_code);
  if v_inv is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_inv = uid then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  select created_at into v_created from public.profiles where id = uid;
  if coalesce(v_created, '-infinity'::timestamptz) < now() - make_interval(days => public.ref_rule('claim_days')) then
    return jsonb_build_object('ok', false, 'reason', 'old');
  end if;
  -- по кругу нельзя: пригласивший сам пришёл по ссылке этого человека
  if exists (select 1 from public.ref_links where invitee = v_inv and inviter = uid) then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;
  perform public.ref_mark(uid, p_dev);
  insert into public.ref_links (invitee, inviter, code, src, place) values (uid, v_inv, left(lower(btrim(p_code)), 24), v_src, v_place)
    on conflict (invitee) do nothing;
  st := public.ref_reassess(uid);
  if st <> 'self' then
    update public.profiles set referred_by = v_inv where id = uid and referred_by is null;
    perform public.ref_notify(v_inv, 'ref_join', uid, 'пришёл(ла) по твоей ссылке 🎉',
      format('Дойдёт до %s уровня — тебе %s. Позови ещё!', m ->> 'lv', public.ref_gift_text((m ->> 'xp')::int, (m ->> 'coins')::int)), 'ref:' || uid);
  end if;
  perform public.ref_check(uid);
  return public.ref_claim_answer(uid, false);
end $$;

-- Регистрация по почте: метаданные ref (код или старый ник) → привязка сразу (handle_new_user уже искал по нику — код важнее).
-- Поменяли referred_by (ref_claim, админ) — запись приглашения, если её ещё нет. Сбой — никогда не ломает регистрацию
create or replace function public.ref_on_profile() returns trigger language plpgsql security definer set search_path = public as $$
declare v_ref text; v_inv uuid; n int; m jsonb;
begin
  begin
    if tg_op = 'INSERT' then
      begin
        execute 'select raw_user_meta_data ->> ''ref'' from auth.users where id = $1' into v_ref using new.id;
      exception when others then v_ref := null;
      end;
      v_inv := coalesce(public.ref_resolve(v_ref), new.referred_by);
    else
      v_inv := new.referred_by;
    end if;
    if v_inv is null or v_inv = new.id then return null; end if;
    insert into public.ref_links (invitee, inviter, code, src)
      values (new.id, v_inv, nullif(left(lower(btrim(coalesce(v_ref, ''))), 24), ''), case when tg_op = 'INSERT' then 'signup' else 'link' end)
      on conflict (invitee) do nothing;
    get diagnostics n = row_count;
    if n > 0 then
      if tg_op = 'INSERT' and v_inv is distinct from new.referred_by then
        update public.profiles set referred_by = v_inv where id = new.id;
      end if;
      m := public.ref_ladder() -> 'm' -> 0;
      perform public.ref_notify(v_inv, 'ref_join', new.id, 'пришёл(ла) по твоей ссылке 🎉',
        format('Дойдёт до %s уровня — тебе %s. Позови ещё!', m ->> 'lv', public.ref_gift_text((m ->> 'xp')::int, (m ->> 'coins')::int)), 'ref:' || new.id);
    end if;
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists ref_on_profile on public.profiles;
create trigger ref_on_profile after insert or update of referred_by on public.profiles
  for each row execute function public.ref_on_profile();

-- XP и уведомление за регистрацию по ссылке (xp.sql, notifications.sql) — больше не нужны: XP — за 3 и 5 уровень друга
drop trigger if exists xp_on_referral on public.profiles;
drop trigger if exists notif_on_referral on public.profiles;

-- referred_by: клиенту нельзя (как в referrals.sql), а функциям сервера (ref_claim, ref_on_profile) и админу — можно.
-- Без security definer: «кто меняет» — по current_user (в теле security definer-функции это владелец, не клиент)
create or replace function public.prevent_referred_by_tamper() returns trigger language plpgsql set search_path = public as $$
begin
  if new.referred_by is distinct from old.referred_by and current_user in ('authenticated', 'anon')
     and not coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false) then
    new.referred_by := old.referred_by;
  end if;
  return new;
end $$;

-- Друг вырос (progression.sql: level_progress обновляется с каждым XP) → награды
create or replace function public.ref_on_level() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if (tg_op = 'INSERT' or new.level > old.level) and exists (select 1 from public.ref_links where invitee = new.user_id) then
      perform public.ref_check(new.user_id);
    end if;
  exception when others then null;   -- награда никогда не ломает начисление XP
  end;
  return null;
end $$;
do $$ begin
  if to_regclass('public.level_progress') is not null then
    drop trigger if exists ref_on_level on public.level_progress;
    create trigger ref_on_level after insert or update of level on public.level_progress
      for each row execute function public.ref_on_level();
  end if;
end $$;

-- ═══ 5. Бонус за поддержку (💎 за настоящие деньги) ═══
-- Друг p_payer получил p_gems 💎 за деньги (p_src — источник, он же ключ «один раз»)
create or replace function public.ref_aff(p_payer uuid, p_src text, p_gems int) returns void
language plpgsql security definer set search_path = public as $$
declare l public.ref_links%rowtype; v_bonus int; v_used int;
  v_month timestamptz := date_trunc('month', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow';
begin
  if p_payer is null or coalesce(p_gems, 0) <= 0 or coalesce(p_src, '') = '' then return; end if;
  select * into l from public.ref_links where invitee = p_payer;
  if not found or l.status in ('denied', 'self') then return; end if;
  if l.created_at < now() - make_interval(months => public.ref_rule('months')) then return; end if;   -- срок вышел
  if public.ref_is_kid(p_payer) then return; end if;      -- покупки детей бонус не приносят
  v_bonus := floor(p_gems * public.ref_rule('pct') / 100.0)::int;
  if v_bonus <= 0 then return; end if;
  perform pg_advisory_xact_lock(hashtext('ref_aff:' || l.inviter::text));   -- две покупки разом не обойдут месячный лимит
  select coalesce(sum(gems - back), 0) into v_used from public.ref_payouts
    where user_id = l.inviter and kind = 'aff' and status in ('paid', 'hold', 'back') and created_at >= v_month;
  v_bonus := least(v_bonus, public.ref_rule('gems_month') - v_used);
  if v_bonus <= 0 then return; end if;
  if public.ref_pay(l.inviter, 'aff', p_src, p_payer, 0, 0, v_bonus, null, case when l.status = 'hold' then 'link' end, p_src) is not null
     and l.status = 'ok' then
    -- кто именно и сколько заплатил — не говорим (это его дело)
    perform public.ref_notify(l.inviter, 'ref_bonus', null, format('💎 +%s — бонус за друзей', v_bonus),
      'Друг, которого ты позвал, поддержал сайт. Спасибо, что зовёшь!', 'refa:' || p_src);
  end if;
end $$;

-- Друг вернул деньги (premium_refund: строка журнала 'refund', ref = <провайдер>:<номер возврата>) → бонус за этот платёж назад,
-- поровну доле возврата; уже выдан — списать у пригласившего, не хватает 💎 — долгом (как premium_refund)
create or replace function public.ref_aff_back(p_ref text) returns void
language plpgsql security definer set search_path = public as $$
declare v_prov text := split_part(coalesce(p_ref, ''), ':', 1); v_rid text;
  rf public.premium_payments%rowtype; pay public.premium_payments%rowtype; p public.ref_payouts%rowtype;
  v_done numeric; v_claw int; w public.premium_wallet%rowtype; v_take int; v_debt int; bal int;
begin
  v_rid := substr(coalesce(p_ref, ''), char_length(v_prov) + 2);
  if v_prov = '' or v_rid = '' then return; end if;
  select * into rf from public.premium_payments where provider = v_prov and payment_id = 'refund:' || v_rid;
  if not found or rf.refund_of is null then return; end if;
  select * into pay from public.premium_payments where provider = v_prov and payment_id = rf.refund_of;
  if not found or coalesce(pay.amount, 0) <= 0 then return; end if;
  select * into p from public.ref_payouts where kind = 'aff' and ref = 'pay:' || v_prov || ':' || rf.refund_of for update;
  if not found or p.status not in ('paid', 'hold') or p.gems - p.back <= 0 then return; end if;
  -- сколько по этому платежу уже вернули (вместе с этим возвратом): вернули всё — весь остаток бонуса
  select coalesce(sum(amount), 0) into v_done from public.premium_payments where provider = v_prov and refund_of = rf.refund_of;
  v_claw := case when v_done >= pay.amount then p.gems - p.back
                 else least(p.gems - p.back, floor(p.gems * coalesce(rf.amount, 0) / pay.amount)::int) end;
  if v_claw <= 0 then return; end if;
  update public.ref_payouts set back = back + v_claw, status = case when back + v_claw >= gems then 'back' else status end
    where id = p.id;
  if p.status = 'hold' then return; end if;   -- ещё не выдан — просто меньше
  insert into public.premium_wallet (user_id) values (p.user_id) on conflict (user_id) do nothing;
  select * into w from public.premium_wallet where user_id = p.user_id for update;
  v_take := least(w.balance, v_claw);
  v_debt := v_claw - v_take;
  update public.premium_wallet set balance = balance - v_take, debt = debt + v_debt, updated_at = now()
    where user_id = p.user_id returning balance into bal;
  insert into public.premium_ledger (user_id, amount, balance, kind, ref, note)
    values (p.user_id, -v_take, bal, 'ref_back', p.ref || ':' || v_rid,
      'Друг вернул деньги за покупку — бонус за друзей списан'
        || case when v_debt > 0 then format(' (не хватило %s 💎 — записано долгом)', v_debt) else '' end);
  perform public.ref_notify(p.user_id, 'ref_bonus', null, format('↩️ −%s 💎 бонуса за друзей', v_claw),
    'Друг вернул деньги за покупку — бонус за неё списан.', 'refb:' || v_prov || ':' || v_rid);
end $$;

-- Журнал кристаллов: pay (не тестовый) и donation — бонус; refund — назад. Остальное (grant, spend, ref…) — мимо
create or replace function public.ref_on_ledger() returns trigger language plpgsql security definer set search_path = public as $$
declare v_prov text; v_test boolean;
begin
  begin
    if new.kind = 'pay' and new.amount > 0 then
      v_prov := split_part(new.ref, ':', 1);
      select test into v_test from public.premium_payments where provider = v_prov and payment_id = substr(new.ref, char_length(v_prov) + 2);
      if not coalesce(v_test, false) then perform public.ref_aff(new.user_id, 'pay:' || new.ref, new.amount); end if;
    elsif new.kind = 'donation' and new.amount > 0 then
      perform public.ref_aff(new.user_id, 'don:' || new.ref, new.amount);
    elsif new.kind = 'refund' then
      perform public.ref_aff_back(new.ref);
    end if;
  exception when others then null;   -- бонус никогда не ломает оплату
  end;
  return null;
end $$;
do $$ begin
  if to_regclass('public.premium_ledger') is not null then
    drop trigger if exists ref_on_ledger on public.premium_ledger;
    create trigger ref_on_ledger after insert on public.premium_ledger for each row execute function public.ref_on_ledger();
  end if;
end $$;

-- Донат в режиме «VIP сразу» (кристаллов не было) — бонус по курсу доната (premium_settings.donate_rate, 1 ₽ = 1 💎)
create or replace function public.ref_on_donation() returns trigger language plpgsql security definer set search_path = public as $$
declare v_rate numeric := 1; v_gems int := 0;
begin
  begin
    if new.matched is true and new.profile_id is not null and upper(coalesce(new.currency, 'RUB')) = 'RUB' and coalesce(new.amount, 0) > 0
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
do $$ begin
  if to_regclass('public.vip_donation_log') is not null then
    drop trigger if exists ref_on_donation on public.vip_donation_log;
    create trigger ref_on_donation after insert or update of matched on public.vip_donation_log
      for each row execute function public.ref_on_donation();
  end if;
end $$;

-- ═══ 6. Для сайта ═══
-- Кто позвал по коду — для страницы /r/<код> и плашки новичку. Ник ребёнка и ник по умолчанию — не показываем
create or replace function public.ref_public(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid := public.ref_resolve(p_code);
begin
  if v is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'nick', case when public.ref_is_kid(v) then null else public.ref_nick(v) end,
    'gift', public.ref_ladder() -> 'w');
end $$;

-- Раз в день (и когда поделился ссылкой — p_active): свой код (заводится сам), метки — только у тех, кто зовёт друзей, и у новичков
create or replace function public.ref_ping(p_dev text default null, p_active boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c text; v_act timestamptz; fresh boolean;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  c := public.ref_code_of(uid, true);
  if coalesce(p_active, false) then update public.ref_codes set active_at = now() where user_id = uid; end if;
  select active_at into v_act from public.ref_codes where user_id = uid;
  fresh := exists (select 1 from public.ref_links where invitee = uid
                   and created_at > now() - make_interval(days => public.ref_rule('fresh_days')));
  if v_act is not null or fresh then perform public.ref_mark(uid, p_dev); end if;
  if fresh then perform public.ref_check(uid); end if;
  perform public.ref_release(uid);
  return jsonb_build_object('ok', true, 'code', c);
end $$;

-- Страница «👥 Пригласи друзей»: код, счётчики, награды, бонус месяца, ступени, друзья (у скрытых и детей — только ник и уровень),
-- и кто позвал меня (подарок новичку)
create or replace function public.ref_me(p_dev text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c public.ref_codes%rowtype; my public.ref_links%rowtype; lad jsonb := public.ref_ladder();
  v_month timestamptz := date_trunc('month', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow';
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  perform public.ref_code_of(uid, true);
  update public.ref_codes set active_at = now() where user_id = uid;
  perform public.ref_mark(uid, p_dev);
  perform public.ref_release(uid);
  select * into c from public.ref_codes where user_id = uid;
  select * into my from public.ref_links where invitee = uid;
  return jsonb_build_object('ok', true, 'code', c.code, 'hide_top', c.hide_top, 'frame_on', c.frame_on,
    'frame', exists (select 1 from public.ref_payouts where kind = 't3' and ref = uid::text and status = 'paid'),
    'stats', (select jsonb_build_object(
        'joined', count(*) filter (where status in ('ok', 'hold')),
        'l3', count(*) filter (where status = 'ok' and l3_at is not null),
        'l5', count(*) filter (where status = 'ok' and l5_at is not null),
        'l10', count(*) filter (where status = 'ok' and l10_at is not null),
        'hold', count(*) filter (where status = 'hold'),
        'week', count(*) filter (where status in ('ok', 'hold') and created_at > now() - interval '7 days'))
      from public.ref_links where inviter = uid),
    'earned', (select jsonb_build_object(
        'xp', coalesce(sum(xp) filter (where status = 'paid'), 0),
        'coins', coalesce(sum(coins) filter (where status = 'paid'), 0),
        'gems', coalesce(sum(gems - back) filter (where status in ('paid', 'back')), 0),
        'held', count(*) filter (where status = 'hold'),
        'items', coalesce(jsonb_agg(item) filter (where item is not null and status = 'paid'), '[]'::jsonb))
      from public.ref_payouts where user_id = uid and kind <> 'welcome'),
    'month', jsonb_build_object('gems', (select coalesce(sum(gems - back), 0) from public.ref_payouts where user_id = uid and kind = 'aff'
        and status in ('paid', 'hold', 'back') and created_at >= v_month), 'cap', public.ref_rule('gems_month')),
    'tiers', (select coalesce(jsonb_agg(t ->> 'id'), '[]'::jsonb) from jsonb_array_elements(lad -> 't') t
      where exists (select 1 from public.ref_payouts y where y.kind = t ->> 'id' and y.ref = uid::text and y.status = 'paid')),
    'list', coalesce((select jsonb_agg(e order by e_at desc) from (
        select l.created_at as e_at, o.open, jsonb_strip_nulls(jsonb_build_object(
          'nick', coalesce(public.ref_nick(l.invitee), 'Новичок'),
          'lv', coalesce(public.user_level(l.invitee), 1),
          'st', case when l.status = 'ok' then 'ok' when l.status = 'hold' then 'hold' else 'no' end,
          'm', jsonb_build_object('l3', l.l3_at is not null, 'l5', l.l5_at is not null, 'l10', l.l10_at is not null),
          'id', case when o.open then l.invitee end,
          'at', case when o.open then l.created_at end,
          'av', case when o.open then p.avatar_url end,
          'hid', case when not o.open then true end)) e
        from public.ref_links l join public.profiles p on p.id = l.invitee
        cross join lateral (select public.ref_open(l.invitee, uid) as open) o
        where l.inviter = uid order by l.created_at desc limit 100) s), '[]'::jsonb),
    'invited', case when my.invitee is null then null else jsonb_build_object(
        'nick', public.ref_nick(my.inviter), 'st', case when my.status in ('ok', 'hold') then 'ok' else 'no' end,
        'lv', coalesce(public.user_level(uid), 1), 'gift', lad -> 'w',
        'got', exists (select 1 from public.ref_payouts where kind = 'welcome' and ref = uid::text and status = 'paid'),
        'wait', exists (select 1 from public.ref_payouts where kind = 'welcome' and ref = uid::text and status = 'hold')) end);
end $$;

-- Настройки: не показывать в топе, рамка «Посол» вместо рамки уровня
create or replace function public.ref_set(p_hide_top boolean default null, p_frame boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c public.ref_codes%rowtype;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  perform public.ref_code_of(uid, true);
  update public.ref_codes set hide_top = coalesce(p_hide_top, hide_top), frame_on = coalesce(p_frame, frame_on)
    where user_id = uid returning * into c;
  return jsonb_build_object('ok', true, 'hide_top', c.hide_top, 'frame_on', c.frame_on);
end $$;

-- Топ пригласивших: друзья, дошедшие до 3 уровня (за неделю — дошли за 7 дней). Без ника (Аноним): выключил себя из топа,
-- профиль не для всех или ребёнок — по ответу не понять, почему. Себя видишь всегда
create or replace function public.ref_top(p_period text default 'week', p_lim int default 10) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_all boolean := p_period = 'all';
  v_from timestamptz := case when p_period = 'all' then '-infinity'::timestamptz else now() - interval '7 days' end;
begin
  return jsonb_build_object('period', case when v_all then 'all' else 'week' end, 'list', coalesce((
    select jsonb_agg(jsonb_build_object('rank', t.rk, 'n', t.n, 'me', t.inviter = uid,
        'nick', case when t.anon and t.inviter is distinct from uid then null else t.nick end,
        'id', case when t.anon and t.inviter is distinct from uid then null else t.inviter end) order by t.rk, t.first_at)
    from (
      select l.inviter, count(*) as n, min(l.l3_at) as first_at, rank() over (order by count(*) desc) as rk, public.ref_nick(l.inviter) as nick,
        (coalesce(max(c.hide_top::int), 0) = 1 or coalesce(max(p.privacy_profile), 'all') <> 'all' or public.ref_is_kid(l.inviter)
          or public.ref_nick(l.inviter) is null) as anon
      from public.ref_links l
      join public.profiles p on p.id = l.inviter
      left join public.ref_codes c on c.user_id = l.inviter
      where l.status = 'ok' and l.l3_at is not null and l.l3_at >= v_from
      group by l.inviter
      order by count(*) desc, min(l.l3_at)
      limit least(greatest(coalesce(p_lim, 10), 1), 50)) t), '[]'::jsonb));
end $$;

-- У кого рамка «Посол» (ступень t3 и не выключена) — для аватаров (xp.js applyLevelFrame)
create or replace function public.ref_frames(p_ids uuid[]) returns setof uuid
language sql stable security definer set search_path = public as $$
  select y.user_id from public.ref_payouts y join public.ref_codes c on c.user_id = y.user_id and c.frame_on
  where y.kind = 't3' and y.status = 'paid' and y.user_id = any(p_ids[1:200])
$$;

-- referrals.sql: «активный» друг — теперь дошедший до 3 уровня (не «написал сообщение»). Её зовут ачивки (referrer_1 / referrer_5),
-- заявки в друзья за 5 приглашённых (progression.sql) и профиль
create or replace function public.referral_count(uid uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from public.ref_links where inviter = uid and status = 'ok' and l3_at is not null
$$;

create or replace function public.top_referrers(lim int default 10)
returns table(id uuid, nick text, active_referrals bigint)
language sql stable security definer set search_path = public as $$
  select case when x.anon then null else x.inviter end, case when x.anon then 'Аноним' else x.nick end, x.n
  from (
    select l.inviter, public.ref_nick(l.inviter) as nick, count(*) as n,
      (coalesce(max(c.hide_top::int), 0) = 1 or coalesce(max(p.privacy_profile), 'all') <> 'all' or public.ref_is_kid(l.inviter)
        or public.ref_nick(l.inviter) is null) as anon
    from public.ref_links l join public.profiles p on p.id = l.inviter left join public.ref_codes c on c.user_id = l.inviter
    where l.status = 'ok' and l.l3_at is not null
    group by l.inviter
  ) x
  order by x.n desc
  limit least(greatest(coalesce(lim, 10), 1), 50);
$$;

-- ═══ 7. Админ: подозрительные приглашения, «одобрить / отклонить» ═══
-- p_what: review — на проверке, «сам себя» и с отложенными наградами; all — все; ok | hold | denied | self — по состоянию
create or replace function public.ref_admin_list(p_what text default 'review', p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'Только для админа'; end if;
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select l.invitee, l.inviter, pi.nick as invitee_nick, po.nick as inviter_nick, l.status, l.flags, l.src, l.place, l.code,
      l.created_at, l.reviewed_at, l.note, l.legacy, coalesce(public.user_level(l.invitee), 1) as lv,
      l.l3_at is not null as l3, l.l5_at is not null as l5, l.l10_at is not null as l10,
      (select count(*) from public.ref_payouts y where y.invitee = l.invitee and y.status = 'hold') as held,
      (select coalesce(sum(y.gems), 0) from public.ref_payouts y where y.invitee = l.invitee and y.kind = 'aff' and y.status = 'hold') as held_gems,
      -- у кого ещё такой же IP или устройство (до 8 ников)
      (select coalesce(jsonb_agg(s.nick), '[]'::jsonb) from (
         select distinct pp.nick from public.ref_marks a
         join public.ref_marks b on b.kind = a.kind and b.h = a.h and b.user_id <> a.user_id
         join public.profiles pp on pp.id = b.user_id
         where a.user_id = l.invitee limit 8) s) as same_as
    from public.ref_links l
    left join public.profiles pi on pi.id = l.invitee
    left join public.profiles po on po.id = l.inviter
    where case coalesce(p_what, 'review')
      when 'review' then l.status in ('hold', 'self') or exists (select 1 from public.ref_payouts y where y.invitee = l.invitee and y.status = 'hold')
      when 'all' then true
      else l.status = p_what end
    order by l.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500)) x), '[]'::jsonb);
end $$;

-- Одобрить: приглашение засчитано, отложенные награды выданы, пройденные уровни — тоже. Отклонить: отложенное — нет, дальше — ничего
-- (уже выданное не отнимаем)
create or replace function public.ref_admin_review(p_invitee uuid, p_ok boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.ref_links%rowtype; r record; n int := 0;
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'Только для админа'; end if;
  select * into l from public.ref_links where invitee = p_invitee for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  update public.ref_links set status = case when p_ok then 'ok' else 'denied' end, reviewed_by = auth.uid(), reviewed_at = now(),
    note = left(btrim(coalesce(p_note, '')), 200) where invitee = p_invitee;
  if p_ok then
    update public.profiles set referred_by = l.inviter where id = p_invitee and referred_by is null;
    for r in select id from public.ref_payouts where invitee = p_invitee and status = 'hold' order by id loop
      update public.ref_payouts set status = 'paid', paid_at = now(), reason = null where id = r.id;
      perform public.ref_apply(r.id);
      n := n + 1;
    end loop;
    perform public.ref_check(p_invitee);
    perform public.ref_tiers(l.inviter);
    perform public.ref_notify(l.inviter, 'ref_reward', p_invitee, 'прошёл(ла) проверку — награды за друга начислены ✅', '', 'refok:' || p_invitee);
  else
    update public.ref_payouts set status = 'denied' where invitee = p_invitee and status = 'hold';
    get diagnostics n = row_count;
    perform public.ref_notify(l.inviter, 'ref_hold', null, 'Награда за одного друга не начислена',
      'Приглашение не прошло проверку — похоже на второй аккаунт. Награды — только за других людей.', 'refno:' || p_invitee);
  end if;
  return jsonb_build_object('ok', true, 'status', case when p_ok then 'ok' else 'denied' end, 'payouts', n);
end $$;

create or replace function public.ref_admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin_user(auth.uid()) then raise exception 'Только для админа'; end if;
  return (select jsonb_build_object('links', count(*), 'ok', count(*) filter (where status = 'ok'),
      'hold', count(*) filter (where status = 'hold'), 'self', count(*) filter (where status = 'self'),
      'denied', count(*) filter (where status = 'denied'), 'l3', count(l3_at), 'l5', count(l5_at), 'l10', count(l10_at),
      'week', count(*) filter (where created_at > now() - interval '7 days'),
      'paid', (select jsonb_build_object('xp', coalesce(sum(xp), 0), 'coins', coalesce(sum(coins), 0), 'gems', coalesce(sum(gems - back), 0))
               from public.ref_payouts where status in ('paid', 'back')),
      'held', (select count(*) from public.ref_payouts where status = 'hold'))
    from public.ref_links);
end $$;

-- ═══ 8. Старые приглашения (referrals.sql, до этого файла): записать в ref_links. Пройденные уровни — отметить без наград
--  (за них уже был XP за регистрацию), дальше — по новым правилам ═══
do $$ begin
  if to_regprocedure('public.user_level(uuid)') is not null then
    insert into public.ref_links (invitee, inviter, src, legacy, l3_at, l5_at, l10_at, created_at)
    select p.id, p.referred_by, 'legacy', true,
      case when lv >= 3 then now() end, case when lv >= 5 then now() end, case when lv >= 10 then now() end,
      coalesce(p.created_at, now())
    from public.profiles p cross join lateral (select public.user_level(p.id) as lv) u
    where p.referred_by is not null and p.referred_by <> p.id
    on conflict (invitee) do nothing;
  end if;
end $$;

-- ═══ 9. Права: служебное — только изнутри ═══
revoke execute on function public.ref_hash(text, text) from public, anon, authenticated;
revoke execute on function public.ref_ip() from public, anon, authenticated;
revoke execute on function public.ref_mark(uuid, text) from public, anon, authenticated;
revoke execute on function public.ref_is_kid(uuid) from public, anon, authenticated;
revoke execute on function public.ref_open(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.ref_nick(uuid) from public, anon, authenticated;
revoke execute on function public.ref_new_code() from public, anon, authenticated;
revoke execute on function public.ref_code_of(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.ref_resolve(text) from public, anon, authenticated;
revoke execute on function public.ref_notify(uuid, text, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.ref_assess(uuid) from public, anon, authenticated;
revoke execute on function public.ref_reassess(uuid) from public, anon, authenticated;
revoke execute on function public.ref_over_cap(uuid) from public, anon, authenticated;
revoke execute on function public.ref_apply(bigint) from public, anon, authenticated;
revoke execute on function public.ref_pay(uuid, text, text, uuid, int, int, int, text, text, text) from public, anon, authenticated;
revoke execute on function public.ref_release(uuid) from public, anon, authenticated;
revoke execute on function public.ref_tiers(uuid) from public, anon, authenticated;
revoke execute on function public.ref_check(uuid) from public, anon, authenticated;
revoke execute on function public.ref_claim_answer(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.ref_aff(uuid, text, int) from public, anon, authenticated;
revoke execute on function public.ref_aff_back(text) from public, anon, authenticated;
revoke execute on function public.ref_on_profile() from public, anon, authenticated;
revoke execute on function public.ref_on_level() from public, anon, authenticated;
revoke execute on function public.ref_on_ledger() from public, anon, authenticated;
revoke execute on function public.ref_on_donation() from public, anon, authenticated;
revoke execute on function public.ref_claim(text, text, text, text) from public;
revoke execute on function public.ref_ping(text, boolean) from public, anon;
revoke execute on function public.ref_me(text) from public, anon;
revoke execute on function public.ref_set(boolean, boolean) from public, anon;
revoke execute on function public.ref_admin_list(text, int) from public, anon;
revoke execute on function public.ref_admin_review(uuid, boolean, text) from public, anon;
revoke execute on function public.ref_admin_stats() from public, anon;
grant execute on function public.ref_claim(text, text, text, text) to anon, authenticated;   -- гостю ответит «нужен вход»
grant execute on function public.ref_ping(text, boolean) to authenticated;
grant execute on function public.ref_me(text) to authenticated;
grant execute on function public.ref_set(boolean, boolean) to authenticated;
grant execute on function public.ref_admin_list(text, int) to authenticated;
grant execute on function public.ref_admin_review(uuid, boolean, text) to authenticated;
grant execute on function public.ref_admin_stats() to authenticated;
grant execute on function public.ref_public(text) to anon, authenticated;
grant execute on function public.ref_top(text, int) to anon, authenticated;
grant execute on function public.ref_frames(uuid[]) to anon, authenticated;
grant execute on function public.referral_count(uuid) to anon, authenticated;
grant execute on function public.top_referrers(int) to anon, authenticated;

-- Проверка (необязательно):
-- select public.ref_rule('pct');                       -- 10
-- select * from public.ref_links order by created_at desc limit 20;
-- select * from public.ref_payouts order by id desc limit 20;
