-- ═══════════════════════════════════════════════════════════════════
--  📣 РЕКЛАМА ЗА 💎 — кабинет рекламодателя (свой маленький «Google Ads»): #/adv (js/features/adcab.js),
--  показ на сайте — js/core/ad-direct.js через диспетчер мест js/core/ad-places.js, щит в «Мире Денчика» —
--  js/games/mir-promo.js, переход по рекламе — /go/<id> (api/_lib/routes/adgo.js), правила — /ads-terms.
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно (можно запускать повторно — данные не теряются).
--  Нужны уже применённые: premium.sql (premium_add — кошелёк 💎). Желательно: notifications.sql (уведомления 🔔),
--  vip-balance.sql / progression.sql (has_perks — VIP и персонал без рекламы). pgcrypto в схеме extensions (как world.sql).
--
--  Как устроено:
--   • Рекламодатель (любой вошедший, принявший правила) делает кампанию: креативы (карточка в ленте, баннер 300×250 /
--     728×90, столбик 160×600 / 300×600, щит в 3D-мире), ссылку https, таргетинг (разделы, устройства, возраст,
--     Россия / не Россия), даты и оплату: за 1000 показов (CPM, ставка не ниже минимальной) или пакет «по дням».
--   • Отправил на проверку → бюджет списывается с 💎 в «копилку» кампании (premium_add, вид 'ads'). Отклонили,
--     кампания закончилась, остановил сам, заблокировали — неизрасходованный остаток (целые 💎) сам возвращается
--     (вид 'ads_refund'). Баланс в минус не уходит (premium_add), повторно не списать и не вернуть: строка кампании
--     под замком + проверка budget ≥ spent + refunded прямо в таблице.
--   • Статусы: draft → review → active ⇄ paused → finished; rejected (с причиной); banned. Правка картинок, ссылки,
--     рекламодателя, erid или таргетинга у работающей кампании — снова на проверку (до одобрения не показывается).
--   • Показ: ad_pick(место, контекст) — среди подходящих (таргетинг, даты, бюджет, частота) выбирает с весом по ставке.
--     Показ засчитывается (ad_view) только после «видно ≥ 50 % не меньше секунды» (решает браузер, сервер проверяет
--     подпись выдачи и что прошла хотя бы секунда), один раз на зрителя на кампанию за 30 минут и не больше 6 в день;
--     свои показы рекламодателя не считаются; счётчики — по дням (одна строка на кампанию, день и место, не на показ).
--     Зритель — аккаунт или IP (как ugc_play). Клик — /go/<id> на сервере (ad_go, только service_role): засчитывается
--     раз в час на зрителя, без своих кликов и флуда. Клики не оплачиваются — только показы (или дни пакета).
--   • Закон: без erid кампания в России не показывается (страна неизвестна — считаем Россией); у каждой рекламы
--     пометка «Реклама · рекламодатель» (+ erid). Запрещённые темы (дети!) — список ad_bad_words + модерация.
--   • Картинки — закрытое хранилище 'ads' (webp/png/jpeg до 512 КБ, без SVG): видит автор и админ, остальные — только
--     у одобренной работающей кампании. Перезаписать или удалить автор не может (подменить одобренное нельзя).
--  Цифры по умолчанию (меняет админ в кабинете): ad_settings ниже; те же — js/core/ad-direct.js (DEF) и
--  api/_lib/ad-rules.js (тест сверяет).
--  Проверка после запуска: /rpc/ad_prices гостем → {"enabled": true, …} (PGRST202 = не применён).
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ═══ 1. Настройки и цены ═══
create table if not exists public.ad_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,           -- выключатель всей прямой рекламы
  -- 💎: cpm — минимальная ставка за 1000 показов, day — цена дня пакета (за каждый формат)
  prices jsonb not null default '{"native":{"cpm":70,"day":60},"banner":{"cpm":50,"day":50},"rail":{"cpm":60,"day":40},"board":{"cpm":100,"day":100}}'::jsonb,
  min_budget int not null default 200,             -- минимальный бюджет кампании CPM
  max_budget int not null default 100000,
  min_topup int not null default 50,               -- минимальное пополнение
  day_on boolean not null default true,            -- пакеты «по дням» включены
  max_days int not null default 30,
  dedup_min int not null default 30,               -- показ засчитывается раз в N минут на зрителя
  freq_day int not null default 6,                 -- и не больше N в день на зрителя (дальше — не выдаём)
  click_min int not null default 60,               -- клик — раз в N минут на зрителя
  terms_version text not null default '2026-10-15',
  swept_at timestamptz not null default '2000-01-01',
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.ad_settings (id) values (1) on conflict (id) do nothing;
update public.ad_settings set terms_version = '2026-10-15' where id = 1 and terms_version < '2026-10-15';
alter table public.ad_settings enable row level security;   -- политик нет: читают и пишут только функции
revoke all on public.ad_settings from anon, authenticated;

-- Секрет подписи выдачи (как world_secret): токен показа нельзя подделать
create table if not exists public.ad_secret (id int primary key default 1 check (id = 1), k text not null);
alter table public.ad_secret enable row level security;
revoke all on public.ad_secret from anon, authenticated;
insert into public.ad_secret (id, k) values (1, md5(gen_random_uuid()::text || clock_timestamp()::text) || md5(gen_random_uuid()::text))
  on conflict (id) do nothing;

-- ═══ 2. Таблицы ═══
create table if not exists public.ad_advertisers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  terms text,                                      -- какую редакцию правил принял
  terms_at timestamptz,
  name text not null default '',                   -- рекламодатель по умолчанию (подставляется в новые кампании)
  inn text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.ad_campaigns (
  id text primary key,
  owner uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'Кампания',
  status text not null default 'draft',
  created_at timestamptz not null default now()
);
alter table public.ad_campaigns add column if not exists pricing text not null default 'cpm';     -- cpm | day
alter table public.ad_campaigns add column if not exists bid int not null default 0;              -- 💎 за 1000 показов
alter table public.ad_campaigns add column if not exists days int not null default 0;             -- пакет: дней
alter table public.ad_campaigns add column if not exists day_price int not null default 0;        -- пакет: 💎 в день (фиксируется при отправке)
alter table public.ad_campaigns add column if not exists plan_budget int not null default 0;      -- CPM: сколько внести при отправке
alter table public.ad_campaigns add column if not exists budget int not null default 0;           -- всего внесено 💎
alter table public.ad_campaigns add column if not exists spent numeric(14,4) not null default 0;   -- потрачено
alter table public.ad_campaigns add column if not exists refunded int not null default 0;         -- возвращено 💎
alter table public.ad_campaigns add column if not exists views int not null default 0;
alter table public.ad_campaigns add column if not exists clicks int not null default 0;
alter table public.ad_campaigns add column if not exists day_paid date;                           -- пакет: последний оплаченный день
alter table public.ad_campaigns add column if not exists days_used int not null default 0;
alter table public.ad_campaigns add column if not exists start_date date;
alter table public.ad_campaigns add column if not exists end_date date;
alter table public.ad_campaigns add column if not exists sections text[] not null default '{}';   -- пусто = везде
alter table public.ad_campaigns add column if not exists devices text[] not null default '{}';
alter table public.ad_campaigns add column if not exists ages text[] not null default '{}';
alter table public.ad_campaigns add column if not exists geo text not null default 'any';         -- any | ru | not_ru
alter table public.ad_campaigns add column if not exists advertiser text not null default '';
alter table public.ad_campaigns add column if not exists inn text not null default '';
alter table public.ad_campaigns add column if not exists erid text not null default '';
alter table public.ad_campaigns add column if not exists url text not null default '';
alter table public.ad_campaigns add column if not exists approved boolean not null default false;
alter table public.ad_campaigns add column if not exists approved_hash text;
alter table public.ad_campaigns add column if not exists approved_at timestamptz;
alter table public.ad_campaigns add column if not exists approved_by uuid;
alter table public.ad_campaigns add column if not exists paused_by text;                          -- owner | admin | reports
alter table public.ad_campaigns add column if not exists finish_reason text;                      -- budget | date | owner | admin
alter table public.ad_campaigns add column if not exists reject_reason text;
alter table public.ad_campaigns add column if not exists reports int not null default 0;
alter table public.ad_campaigns add column if not exists age_rating int;                          -- метка 0/6/12/16/18 (выбирает рекламодатель)
alter table public.ad_campaigns add column if not exists submitted_at timestamptz;
alter table public.ad_campaigns add column if not exists finished_at timestamptz;
alter table public.ad_campaigns add column if not exists updated_at timestamptz not null default now();
alter table public.ad_campaigns drop constraint if exists ad_campaigns_check;
alter table public.ad_campaigns add constraint ad_campaigns_check check (
  status in ('draft', 'review', 'active', 'paused', 'finished', 'rejected', 'banned')
  and pricing in ('cpm', 'day') and geo in ('any', 'ru', 'not_ru')
  and id ~ '^[a-z0-9]{6,16}$' and char_length(title) between 1 and 60
  and budget >= 0 and refunded >= 0 and spent >= 0 and bid >= 0 and days >= 0 and day_price >= 0 and plan_budget >= 0
  and (age_rating is null or age_rating in (0, 6, 12, 16, 18))
  and refunded + spent <= budget);                 -- главная страховка: вернуть и потратить больше внесённого нельзя
create index if not exists ad_campaigns_owner on public.ad_campaigns (owner, created_at desc);
create index if not exists ad_campaigns_live on public.ad_campaigns (status, approved);

create table if not exists public.ad_creatives (
  id bigint generated always as identity primary key,
  campaign_id text not null references public.ad_campaigns(id) on delete cascade,
  kind text not null,                              -- native | b300x250 | b728x90 | r160x600 | r300x600 | board
  title text not null default '', body text not null default '', cta text not null default '',
  image text not null default '', w int not null default 0, h int not null default 0,
  created_at timestamptz not null default now(),
  unique (campaign_id, kind)
);
alter table public.ad_creatives drop constraint if exists ad_creatives_check;
alter table public.ad_creatives add constraint ad_creatives_check check (
  kind in ('native', 'b300x250', 'b728x90', 'r160x600', 'r300x600', 'board')
  and char_length(title) <= 40 and char_length(body) <= 90 and char_length(cta) <= 20 and char_length(image) <= 120);
create index if not exists ad_creatives_image on public.ad_creatives (image);

-- Статистика по дням: одна строка на кампанию, день и место (не строка на показ — лимиты бесплатного тарифа)
create table if not exists public.ad_stats (
  campaign_id text not null references public.ad_campaigns(id) on delete cascade,
  day date not null,
  place text not null default 'other',
  views int not null default 0,
  clicks int not null default 0,
  spent numeric(14,4) not null default 0,
  primary key (campaign_id, day, place)
);

-- Кто что видел: одна строка на кампанию и зрителя (хеш аккаунта или IP) — частота, повторы, клики
create table if not exists public.ad_seen (
  campaign_id text not null,
  vh text not null,
  day date,
  views int not null default 0,
  last_view timestamptz,
  last_click timestamptz,
  click_ip text,
  primary key (campaign_id, vh)
);
create index if not exists ad_seen_vh on public.ad_seen (vh, last_view desc);
create index if not exists ad_seen_ip on public.ad_seen (click_ip, last_click desc);

-- Журнал модерации и важных действий (видят автор кампании и админ)
create table if not exists public.ad_log (
  id bigint generated always as identity primary key,
  campaign_id text not null references public.ad_campaigns(id) on delete cascade,
  actor uuid,
  act text not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists ad_log_campaign on public.ad_log (campaign_id, id desc);

create table if not exists public.ad_reports (
  campaign_id text not null references public.ad_campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

-- ═══ 3. Доступ: читать — свои и админ; писать — только функциями ═══
create or replace function public.ad_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

alter table public.ad_advertisers enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_creatives enable row level security;
alter table public.ad_stats enable row level security;
alter table public.ad_seen enable row level security;
alter table public.ad_log enable row level security;
alter table public.ad_reports enable row level security;
drop policy if exists ad_advertisers_read on public.ad_advertisers;
create policy ad_advertisers_read on public.ad_advertisers for select using (user_id = auth.uid() or public.ad_admin());
drop policy if exists ad_campaigns_read on public.ad_campaigns;
create policy ad_campaigns_read on public.ad_campaigns for select using (owner = auth.uid() or public.ad_admin());
drop policy if exists ad_creatives_read on public.ad_creatives;
create policy ad_creatives_read on public.ad_creatives for select
  using (public.ad_admin() or exists (select 1 from public.ad_campaigns k where k.id = campaign_id and k.owner = auth.uid()));
drop policy if exists ad_stats_read on public.ad_stats;
create policy ad_stats_read on public.ad_stats for select
  using (public.ad_admin() or exists (select 1 from public.ad_campaigns k where k.id = campaign_id and k.owner = auth.uid()));
drop policy if exists ad_log_read on public.ad_log;
create policy ad_log_read on public.ad_log for select
  using (public.ad_admin() or exists (select 1 from public.ad_campaigns k where k.id = campaign_id and k.owner = auth.uid()));
revoke insert, update, delete on public.ad_advertisers, public.ad_campaigns, public.ad_creatives, public.ad_stats, public.ad_log
  from anon, authenticated;
revoke all on public.ad_seen, public.ad_reports from anon, authenticated;

-- ═══ 4. Справочники и проверки (те же списки — js/core/ad-direct.js и api/_lib/ad-rules.js; тест сверяет) ═══
create or replace function public.ad_today() returns date language sql stable as $$
  select (now() at time zone 'Europe/Moscow')::date
$$;

-- Запрещённые темы (аудитория — дети): азарт, кейсы, ставки, алкоголь, табак и вейпы, 18+, знакомства, оружие,
-- крипта и «лёгкие деньги», займы, лекарства, наркотики, обманные «скачай» / «ты выиграл» / «бесплатные робуксы»
create or replace function public.ad_bad_words() returns text[] language sql immutable as $$
  select array[
    'казино','casino','kazino','букмекер','bookmaker','betting','беттинг','ставки на спорт','ставка на спорт','тотализатор',
    '1xbet','1win','mostbet','melbet','fonbet','winline','parimatch','leonbets','betcity','ggbet','pin-up','pinup','vavada',
    'azino','азино','joycasino','рулетк','roulette','джекпот','jackpot','лотере','lottery','игровые автоматы','покер','poker',
    'ggdrop','casebattle','case-battle','case battle','кейсбатл','кейс батл','forcedrop','easydrop','bulldrop','skinbox',
    'открытие кейсов','открывай кейсы','промокод на деп','депозит',
    'алкогол','alcohol','водка','vodka','пиво','beer','коньяк','виски','whisky','whiskey',
    'сигарет','cigarette','табак','tobacco','вейп','вэйп','vape','электронк','снюс','snus','кальян','hookah','iqos','насвай',
    'порно','porn','xxx','секс','эротик','erotic','интим','18+','onlyfans','знакомства','dating','эскорт','escort',
    'оружи','weapon','пистолет','травмат','боеприпас','патрон',
    'криптовалют','crypto','bitcoin','биткоин','биткойн','nft','форекс','forex','трейдинг','инвестиц','пассивный доход',
    'легкие деньги','быстрые деньги','easy money','заработок без вложений','микрозайм','займ','кредит',
    'лекарств','таблетк','антибиотик','похуден','жиросжиг','бады',
    'наркот','марихуан','cannabis','спайс',
    'ты выиграл','вы выиграли','you won','скачай','бесплатные робуксы','робуксы бесплатно','free robux','free v-bucks',
    'читы','взлом аккаунт'
  ]::text[]
$$;

-- Короткие ссылки прячут, куда ведут, — нельзя (на карточке должен быть виден настоящий сайт)
create or replace function public.ad_short_hosts() returns text[] language sql immutable as $$
  select array['bit.ly','bitly.com','clck.ru','cutt.ly','tinyurl.com','goo.su','t.ly','is.gd','v.gd','ow.ly','rebrand.ly',
    'shorturl.at','u.to','vk.cc','rb.gy','tiny.cc','qps.ru','s.id','surl.li']::text[]
$$;

-- Нижний регистр и ё → е без оглядки на локаль базы (lower() в локали C кириллицу не трогает)
create or replace function public.ad_norm(p text) returns text language sql immutable as $$
  select replace(translate(lower(coalesce(p, '')), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'), 'ё', 'е')
$$;

-- Запрещённое слово в тексте → это слово, иначе null. Латинские «двойники» (кaзино с латинской a) тоже ловим
create or replace function public.ad_bad(p_text text) returns text language plpgsql immutable as $$
declare n text := public.ad_norm(p_text); l text; w text;
begin
  l := translate(n, 'aeopcxykmtbh', 'аеорсхукмтвн');
  foreach w in array public.ad_bad_words() loop
    if position(w in n) > 0 or position(w in l) > 0 then return w; end if;
  end loop;
  return null;
end $$;

-- Ссылка рекламы: '' — можно, иначе причина. Только https, без логина/порта/IP, без коротких ссылок и запрещённых тем
create or replace function public.ad_url_ok(p_url text) returns text language plpgsql immutable as $$
declare u text := btrim(coalesce(p_url, '')); h text; w text;
begin
  if u = '' then return 'empty'; end if;
  if char_length(u) > 500 then return 'long'; end if;
  if left(u, 8) <> 'https://' then return 'https'; end if;
  if u ~ '[[:space:][:cntrl:]<>"]' or strpos(u, chr(92)) > 0 then return 'chars'; end if;
  h := lower(coalesce(substring(u from '^https://([^/?#]*)'), ''));
  if h = '' or h ~ '[@:]' or h !~ '^[a-z0-9.-]+$' or h !~ '\.[a-z0-9-]{2,}$' or h ~ '^[0-9.]+$' or h ~ '\.\.' or h ~ '^[.-]' then
    return 'host';
  end if;
  foreach w in array public.ad_short_hosts() loop
    if h = w or right(h, char_length(w) + 1) = '.' || w then return 'short'; end if;
  end loop;
  if public.ad_bad(u) is not null then return 'bad'; end if;
  return '';
end $$;

-- Домен для показа на карточке (без www.)
create or replace function public.ad_host(p_url text) returns text language sql immutable as $$
  select regexp_replace(lower(coalesce(substring(btrim(coalesce(p_url, '')) from '^https://([^/?#]*)'), '')), '^www\.', '')
$$;

-- Форматы: размер картинки (её готовит кабинет) и группа цены
create or replace function public.ad_kind_size(p_kind text) returns int[] language sql immutable as $$
  select case p_kind when 'native' then array[640, 360] when 'b300x250' then array[600, 500] when 'b728x90' then array[1456, 180]
    when 'r160x600' then array[320, 1200] when 'r300x600' then array[600, 1200] when 'board' then array[1024, 512] end
$$;
create or replace function public.ad_kind_group(p_kind text) returns text language sql immutable as $$
  select case when p_kind = 'native' then 'native' when p_kind in ('b300x250', 'b728x90') then 'banner'
    when p_kind in ('r160x600', 'r300x600') then 'rail' when p_kind = 'board' then 'board' end
$$;
-- Место на сайте → группа форматов (ad-places.js: feed*, loading, break, game_over…; щит мира — billboard)
create or replace function public.ad_place_group(p_place text) returns text language sql immutable as $$
  select case when p_place in ('feed', 'feed_games', 'feed_videos', 'feed_ugc') then 'native'
    when p_place in ('loading', 'break', 'game_over', 'games_hub', 'seo_game', 'video_page', 'home_mid') then 'banner'
    when p_place = 'rail' then 'rail' when p_place = 'billboard' then 'board' end
$$;
create or replace function public.ad_place_ok(p_place text) returns text language sql immutable as $$
  select case when public.ad_place_group(p_place) is not null then p_place else 'other' end
$$;

-- Зритель: аккаунт, иначе IP (как ugc_play); хеш — для подписи выдачи и таблицы ad_seen
create or replace function public.ad_headers() returns json language plpgsql stable as $$
declare hdr json;
begin
  begin hdr := nullif(current_setting('request.headers', true), '')::json; exception when others then hdr := null; end;
  return hdr;
end $$;
create or replace function public.ad_viewer() returns text language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); hdr json := public.ad_headers(); ip text;
begin
  if uid is not null then return uid::text; end if;
  ip := coalesce(hdr ->> 'cf-connecting-ip', hdr ->> 'x-real-ip', split_part(coalesce(hdr ->> 'x-forwarded-for', ''), ',', 1), '');
  return 'ip:' || md5(btrim(ip));
end $$;
create or replace function public.ad_vh(p_viewer text) returns text language sql immutable as $$
  select left(md5('d37ad:' || coalesce(p_viewer, '')), 12)
$$;
create or replace function public.ad_is_bot(p_ua text) returns boolean language sql immutable as $$
  select lower(coalesce(p_ua, '')) ~ '(bot|crawl|spider|slurp|headless|lighthouse|preview|curl|wget|python|scrapy|httpclient)'
$$;

-- Возрастная группа зрителя (js/core/age.js; «не указан» браузер уже перевёл по ADS_RULES.age.unknown) → самая «взрослая» метка
-- рекламы, которую ему можно: до 13 — 6+, 13–15 — 12+, 16–17 — 16+, взрослым — 18+. Неизвестная группа — как подросток
create or replace function public.ad_age_max(p_group text) returns int language sql immutable as $$
  select case p_group when 'child' then 6 when 'teen' then 12 when 'teen16' then 16 when 'adult' then 18 else 12 end
$$;
create or replace function public.ad_age_group(p_group text) returns text language sql immutable as $$
  select case when p_group in ('child', 'teen', 'teen16', 'adult') then p_group else 'teen' end
$$;

-- Подпись выдачи: «время.зритель.место.подпись» — показ и клик засчитываются только по ней
create or replace function public.ad_sign(p text) returns text language sql stable security definer set search_path = public, extensions as $$
  select left(encode(extensions.hmac(p, (select k from public.ad_secret where id = 1), 'sha256'), 'hex'), 24)
$$;
create or replace function public.ad_token(p_id text, p_vh text, p_place text, p_ts bigint) returns text
language sql stable security definer set search_path = public as $$
  select p_ts::text || '.' || p_vh || '.' || p_place || '.' || public.ad_sign(p_id || '.' || p_ts::text || '.' || p_vh || '.' || p_place)
$$;
-- Разобрать и проверить: {ts, vh, place} или null
create or replace function public.ad_token_check(p_id text, p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(coalesce(p_token, ''), '.'); ts bigint;
begin
  if coalesce(array_length(parts, 1), 0) <> 4 or parts[2] !~ '^[0-9a-f]{12}$' or parts[3] !~ '^[a-z_]{2,20}$' then return null; end if;
  begin ts := parts[1]::bigint; exception when others then return null; end;
  if public.ad_sign(p_id || '.' || parts[1] || '.' || parts[2] || '.' || parts[3]) <> parts[4] then return null; end if;
  return jsonb_build_object('ts', ts, 'vh', parts[2], 'place', parts[3]);
end $$;

-- Уведомление 🔔 (notifications.sql). Нет его — молча
create or replace function public.ad_notify(p_uid uuid, p_title text, p_body text, p_link text, p_dedupe text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.notify(p_uid, 'ads', null, p_title, p_body, p_link, p_dedupe);
  exception when others then null;
  end;
end $$;
create or replace function public.ad_notify_admins(p_title text, p_body text, p_dedupe text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.profiles where role = 'admin' limit 5 loop
    perform public.ad_notify(r.id, p_title, p_body, '#/adv/admin', p_dedupe);
  end loop;
end $$;

-- VIP и персонал — без рекламы (has_perks из vip-balance.sql / progression.sql; нет её — молча «нет»)
create or replace function public.ad_perks(p_uid uuid) returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean := false;
begin
  if p_uid is null then return false; end if;
  if to_regprocedure('public.has_perks(uuid)') is not null then
    begin v := coalesce(public.has_perks(p_uid), false); exception when others then v := false; end;
  end if;
  return v;
end $$;

-- Отпечаток того, что видят зрители (одобряется именно он; поменялся — снова на проверку)
create or replace function public.ad_hash(p_id text) returns text language sql stable security definer set search_path = public as $$
  select md5(concat_ws('|', k.url, k.advertiser, k.inn, k.erid, array_to_string(k.sections, ','), array_to_string(k.devices, ','),
    array_to_string(k.ages, ','), k.geo, coalesce(k.age_rating, -1),
    (select string_agg(concat_ws('~', c.kind, c.title, c.body, c.cta, c.image, c.w, c.h), '^' order by c.kind)
       from public.ad_creatives c where c.campaign_id = k.id)))
  from public.ad_campaigns k where k.id = p_id
$$;

create or replace function public.ad_hash_with(p_id text, p_age int) returns text language sql stable security definer set search_path = public as $$
  select md5(concat_ws('|', k.url, k.advertiser, k.inn, k.erid, array_to_string(k.sections, ','), array_to_string(k.devices, ','),
    array_to_string(k.ages, ','), k.geo, coalesce(p_age, -1),
    (select string_agg(concat_ws('~', c.kind, c.title, c.body, c.cta, c.image, c.w, c.h), '^' order by c.kind)
       from public.ad_creatives c where c.campaign_id = k.id)))
  from public.ad_campaigns k where k.id = p_id
$$;

-- Группы форматов кампании (по её креативам) и цены за них
create or replace function public.ad_groups(p_id text) returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct public.ad_kind_group(c.kind) order by public.ad_kind_group(c.kind)), '{}'::text[])
  from public.ad_creatives c where c.campaign_id = p_id
$$;
create or replace function public.ad_floor(p_id text) returns int language sql stable security definer set search_path = public as $$
  select coalesce(max(((s.prices -> g) ->> 'cpm')::int), 0)
  from unnest(public.ad_groups(p_id)) g, public.ad_settings s where s.id = 1
$$;
create or replace function public.ad_dayprice(p_id text) returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(((s.prices -> g) ->> 'day')::int), 0)::int
  from unnest(public.ad_groups(p_id)) g, public.ad_settings s where s.id = 1
$$;

create or replace function public.ad_log_add(p_id text, p_act text, p_note text default null, p_actor uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into public.ad_log (campaign_id, actor, act, note) values (p_id, p_actor, p_act, left(p_note, 300))
$$;

-- ═══ 5. Деньги: вернуть остаток и закончить кампанию (только изнутри) ═══
-- Вернуть неизрасходованные целые 💎. Повтор безопасен: второй раз остаток уже 0
create or replace function public.ad_refund(p_id text, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare k public.ad_campaigns%rowtype; amt int;
begin
  select * into k from public.ad_campaigns where id = p_id for update;
  if not found then return 0; end if;
  amt := floor(k.budget - k.refunded - k.spent)::int;
  if amt <= 0 then return 0; end if;
  perform public.premium_add(k.owner, amt, 'ads_refund', k.id, coalesce(p_note, 'Возврат остатка рекламы: ' || k.title));
  update public.ad_campaigns set refunded = refunded + amt, updated_at = now() where id = p_id;
  perform public.ad_log_add(p_id, 'refund', format('Возвращено %s 💎', amt));
  return amt;
end $$;

create or replace function public.ad_finish(p_id text, p_reason text, p_actor uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare k public.ad_campaigns%rowtype; amt int;
begin
  select * into k from public.ad_campaigns where id = p_id for update;
  if not found or k.status not in ('review', 'active', 'paused') then return 0; end if;
  update public.ad_campaigns set status = 'finished', finish_reason = p_reason, finished_at = now(), paused_by = null, updated_at = now()
    where id = p_id;
  perform public.ad_log_add(p_id, 'finish', case p_reason when 'budget' then 'Бюджет израсходован' when 'date' then 'Кончились даты показа'
    when 'owner' then 'Остановлена рекламодателем' else 'Остановлена администратором' end, p_actor);
  amt := public.ad_refund(p_id);
  perform public.ad_notify(k.owner, '📣 Реклама завершена: ' || left(k.title, 60),
    case when amt > 0 then format('Неизрасходованные %s 💎 вернулись на баланс.', amt) else 'Бюджет израсходован полностью.' end,
    '#/adv/c/' || k.id, 'adfin:' || k.id || ':' || coalesce(k.finished_at::text, now()::text));
  return amt;
end $$;

-- Раз в 5 минут: закончить кампании, у которых прошли даты (с возвратом), и почистить старые отметки зрителей
create or replace function public.ad_sweep() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  update public.ad_settings set swept_at = now() where id = 1 and swept_at < now() - interval '5 minutes';
  if not found then return 0; end if;
  for r in select id from public.ad_campaigns where status in ('active', 'paused') and end_date is not null and end_date < public.ad_today() loop
    perform public.ad_finish(r.id, 'date'); n := n + 1;
  end loop;
  delete from public.ad_seen where greatest(coalesce(last_view, '2000-01-01'), coalesce(last_click, '2000-01-01')) < now() - interval '3 days';
  return n;
end $$;

-- ═══ 6. Для сайта: цены, что есть сейчас, выдача, показ ═══
create or replace function public.ad_prices() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('enabled', s.enabled, 'prices', s.prices, 'min_budget', s.min_budget, 'max_budget', s.max_budget,
    'min_topup', s.min_topup, 'day_on', s.day_on, 'max_days', s.max_days, 'dedup_min', s.dedup_min, 'freq_day', s.freq_day,
    'terms', s.terms_version)
  from public.ad_settings s where s.id = 1
$$;

-- Есть ли сейчас работающие кампании по группам форматов (подсказка браузеру: спрашивать ли ad_pick)
create or replace function public.ad_live() returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.ad_settings%rowtype; td date := public.ad_today(); f jsonb;
begin
  perform public.ad_sweep();
  select * into s from public.ad_settings where id = 1;
  if not s.enabled then return jsonb_build_object('on', false, 'f', '{}'::jsonb); end if;
  select coalesce(jsonb_object_agg(g, n), '{}'::jsonb) into f from (
    select public.ad_kind_group(c.kind) g, count(distinct k.id) n
    from public.ad_campaigns k join public.ad_creatives c on c.campaign_id = k.id
    where k.status = 'active' and k.approved and td >= k.start_date and (k.end_date is null or td <= k.end_date)
      and k.budget - k.refunded - k.spent > 0
    group by 1) t;
  return jsonb_build_object('on', true, 'f', f);
end $$;

-- Выдать рекламу для места. p_ctx: section (games|videos|world|studio|chat|other), device (mobile|desktop),
-- age (child|teen|teen16|adult|unknown), country (код страны или ''), w (ширина места, px), ex (уже показанные id)
create or replace function public.ad_pick(p_place text, p_ctx jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); s public.ad_settings%rowtype; td date := public.ad_today();
  g text := public.ad_place_group(p_place); pl text := public.ad_place_ok(p_place);
  ctx jsonb := case when jsonb_typeof(p_ctx) = 'object' then p_ctx else '{}'::jsonb end;
  v_sec text := lower(coalesce(ctx ->> 'section', 'other'));
  v_dev text := case when ctx ->> 'device' = 'mobile' then 'mobile' else 'desktop' end;
  v_age text := coalesce(nullif(ctx ->> 'age', ''), 'unknown');
  -- группа для метки: что прислал браузер (D37AdPlaces.adAge — «не указан» уже по ADS_RULES.age.unknown); нет — по age, иначе подросток
  v_ar text := public.ad_age_group(coalesce(nullif(ctx ->> 'ar', ''), nullif(ctx ->> 'age', '')));
  hdr json := public.ad_headers();
  v_cc text := upper(left(coalesce(nullif(hdr ->> 'cf-ipcountry', ''), ctx ->> 'country', ''), 2));
  v_ru boolean;
  v_w int := 0; v_ex text[] := '{}'; v_vh text := public.ad_vh(public.ad_viewer());
  c record; total numeric := 0; w numeric; best record; got boolean := false; cr jsonb;
begin
  if g is null then return null; end if;
  select * into s from public.ad_settings where id = 1;
  if not s.enabled or public.ad_perks(uid) then return null; end if;
  if g = 'board' and v_ar = 'child' then return null; end if;   -- детям — без спонсора на щитах мира (как ADS_RULES.age.child.off)
  -- Россия или страна неизвестна → считаем Россией (закон о маркировке: без erid там нельзя)
  -- (заголовок сервера важнее слов браузера; если хоть кто-то говорит «Россия» — Россия)
  v_ru := v_cc in ('', 'RU', 'XX', 'T1') or upper(coalesce(ctx ->> 'country', '')) = 'RU';
  begin v_w := greatest(0, least(4000, coalesce((ctx ->> 'w')::int, 0))); exception when others then v_w := 0; end;
  if jsonb_typeof(ctx -> 'ex') = 'array' then
    select coalesce(array_agg(x), '{}') into v_ex from (select jsonb_array_elements_text(ctx -> 'ex') x limit 20) t;
  end if;
  for c in
    select k.id, k.pricing, k.bid, k.day_price, k.day_paid, k.budget - k.refunded - k.spent avail, z.last_view, z.day zday, z.views zviews
    from public.ad_campaigns k
    left join public.ad_seen z on z.campaign_id = k.id and z.vh = v_vh
    where k.status = 'active' and k.approved
      and td >= k.start_date and (k.end_date is null or td <= k.end_date)
      and k.budget - k.refunded - k.spent > 0
      and (cardinality(k.sections) = 0 or v_sec = any(k.sections))
      and (cardinality(k.devices) = 0 or v_dev = any(k.devices))
      and (cardinality(k.ages) = 0 or v_age = any(k.ages))
      and coalesce(k.age_rating, 18) <= public.ad_age_max(v_ar)
      and (k.geo = 'any' or (k.geo = 'ru' and v_ru) or (k.geo = 'not_ru' and not v_ru))
      and (k.erid <> '' or not v_ru)
      and not (k.id = any(v_ex))
      and exists (select 1 from public.ad_creatives cc where cc.campaign_id = k.id and public.ad_kind_group(cc.kind) = g
        and (cc.kind not in ('b728x90') or v_w >= 728) and (cc.kind <> 'r300x600' or v_w = 0 or v_w >= 300))
  loop
    if c.zday = td and c.zviews >= s.freq_day then continue; end if;                       -- частота: на сегодня хватит
    if c.pricing = 'day' and c.day_paid is distinct from td and c.avail < c.day_price then continue; end if;
    w := case when c.pricing = 'cpm' then greatest(c.bid, 1)
              else greatest(((s.prices -> g) ->> 'cpm')::numeric, 1) * 2 end;                -- пакет «по дням» — вдвое чаще минимальной ставки
    if c.last_view is not null and c.last_view > now() - make_interval(mins => s.dedup_min) then w := w * 0.3; end if;   -- недавно видел — реже
    total := total + w;
    if random() * total < w then best := c; got := true; end if;
  end loop;
  if not got then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind', cc.kind, 'title', cc.title, 'body', cc.body, 'cta', cc.cta,
      'image', cc.image, 'w', cc.w, 'h', cc.h) order by cc.kind), '[]'::jsonb) into cr
    from public.ad_creatives cc where cc.campaign_id = best.id and public.ad_kind_group(cc.kind) = g;
  return (select jsonb_build_object('id', k.id, 'g', g, 'cr', cr, 'adv', k.advertiser, 'inn', k.inn, 'erid', k.erid,
      'host', public.ad_host(k.url), 'age', k.age_rating, 't', public.ad_token(k.id, v_vh, pl, extract(epoch from now())::bigint))
    from public.ad_campaigns k where k.id = best.id);
end $$;

-- Показ засчитан (браузер: видно ≥ 50 % не меньше секунды). Один раз на зрителя за dedup_min минут, не больше freq_day
-- в день, не свои, без флуда; списывает ставку / день пакета; бюджет кончился — кампания завершается
create or replace function public.ad_view(p_id text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); s public.ad_settings%rowtype; k public.ad_campaigns%rowtype; z public.ad_seen%rowtype;
  v_vh text := public.ad_vh(public.ad_viewer()); tk jsonb := public.ad_token_check(p_id, p_token); td date := public.ad_today();
  age numeric; n int; cost numeric := 0; avail numeric; pl text; paid boolean := false;
begin
  perform public.ad_sweep();
  select * into s from public.ad_settings where id = 1;
  if not s.enabled then return jsonb_build_object('ok', false, 'reason', 'off'); end if;
  if tk is null or tk ->> 'vh' <> v_vh then return jsonb_build_object('ok', false, 'reason', 'token'); end if;
  age := extract(epoch from now()) - (tk ->> 'ts')::numeric;
  if age < 1 or age > 7200 then return jsonb_build_object('ok', false, 'reason', 'token_age'); end if;
  if public.ad_is_bot(public.ad_headers() ->> 'user-agent') then return jsonb_build_object('ok', false, 'reason', 'bot'); end if;
  pl := public.ad_place_ok(tk ->> 'place');
  select * into k from public.ad_campaigns where id = p_id for update;
  if not found or k.status <> 'active' or not k.approved then return jsonb_build_object('ok', false, 'reason', 'inactive'); end if;
  if uid is not null and uid = k.owner then return jsonb_build_object('ok', true, 'counted', false, 'reason', 'own'); end if;
  select count(*) into n from public.ad_seen where ad_seen.vh = v_vh and last_view > now() - interval '1 minute';
  if n >= 10 then return jsonb_build_object('ok', true, 'counted', false, 'reason', 'flood'); end if;
  insert into public.ad_seen (campaign_id, vh) values (p_id, v_vh) on conflict do nothing;
  select * into z from public.ad_seen where campaign_id = p_id and ad_seen.vh = v_vh for update;
  if z.last_view is not null and z.last_view > now() - make_interval(mins => s.dedup_min) then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', 'dup');
  end if;
  if z.day = td and z.views >= s.freq_day then return jsonb_build_object('ok', true, 'counted', false, 'reason', 'cap'); end if;
  avail := k.budget - k.refunded - k.spent;
  if k.pricing = 'cpm' then
    cost := least(k.bid / 1000.0, avail);
    if cost <= 0 then perform public.ad_finish(p_id, 'budget'); return jsonb_build_object('ok', true, 'counted', false, 'reason', 'budget'); end if;
  elsif k.day_paid is distinct from td then
    if avail < k.day_price then perform public.ad_finish(p_id, 'budget'); return jsonb_build_object('ok', true, 'counted', false, 'reason', 'budget'); end if;
    cost := k.day_price; paid := true;
  end if;
  update public.ad_seen set views = case when day = td then views + 1 else 1 end, day = td, last_view = now()
    where campaign_id = p_id and ad_seen.vh = v_vh;
  update public.ad_campaigns set spent = spent + cost, views = views + 1,
    day_paid = case when paid then td else day_paid end, days_used = days_used + case when paid then 1 else 0 end
    where id = p_id returning * into k;
  insert into public.ad_stats (campaign_id, day, place, views, spent) values (p_id, td, pl, 1, cost)
    on conflict (campaign_id, day, place) do update set views = public.ad_stats.views + 1, spent = public.ad_stats.spent + excluded.spent;
  if k.pricing = 'cpm' and k.budget - k.refunded - k.spent < k.bid / 1000.0 then perform public.ad_finish(p_id, 'budget'); end if;
  return jsonb_build_object('ok', true, 'counted', true, 'cost', cost);
end $$;

-- Переход по рекламе: /go/<id> (сервер сайта с ключом service_role передаёт IP и браузер). Ссылку отдаём и для
-- остановленных/законченных (старая вкладка), клик считаем только у работающей и по верной подписи выдачи
create or replace function public.ad_go(p_id text, p_token text default '', p_ip text default '', p_ua text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare k public.ad_campaigns%rowtype; s public.ad_settings%rowtype; z public.ad_seen%rowtype; tk jsonb; iph text; n int;
  counted boolean := false; td date := public.ad_today(); v_vh text;
begin
  select * into k from public.ad_campaigns where id = p_id;
  if not found or not k.approved or k.status not in ('active', 'paused', 'finished') then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  if public.ad_url_ok(k.url) <> '' then return jsonb_build_object('ok', false, 'reason', 'url'); end if;
  select * into s from public.ad_settings where id = 1;
  tk := public.ad_token_check(p_id, p_token);
  iph := md5('d37ad:ip:' || btrim(coalesce(p_ip, '')));
  if k.status = 'active' and tk is not null and not public.ad_is_bot(p_ua)
     and extract(epoch from now()) - (tk ->> 'ts')::numeric between 0 and 86400
     and tk ->> 'vh' <> public.ad_vh(k.owner::text) then
    v_vh := tk ->> 'vh';
    select count(*) into n from public.ad_seen where click_ip = iph and last_click > now() - interval '1 minute';
    if n < 10 then
      insert into public.ad_seen (campaign_id, vh) values (p_id, v_vh) on conflict do nothing;
      select * into z from public.ad_seen where campaign_id = p_id and ad_seen.vh = v_vh for update;
      if z.last_click is null or z.last_click < now() - make_interval(mins => s.click_min) then
        update public.ad_seen set last_click = now(), click_ip = iph where campaign_id = p_id and ad_seen.vh = v_vh;
        update public.ad_campaigns set clicks = clicks + 1 where id = p_id;
        insert into public.ad_stats (campaign_id, day, place, clicks) values (p_id, td, public.ad_place_ok(tk ->> 'place'), 1)
          on conflict (campaign_id, day, place) do update set clicks = public.ad_stats.clicks + 1;
        counted := true;
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'url', k.url, 'counted', counted);
end $$;

-- Пожаловаться на рекламу (вошедшие, одна жалоба от человека): 3 жалобы — кампания на паузе до решения админа
create or replace function public.ad_report(p_id text, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); k public.ad_campaigns%rowtype; n int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into k from public.ad_campaigns where id = p_id for update;
  if not found or k.status not in ('active', 'paused') then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  insert into public.ad_reports (campaign_id, user_id, reason) values (p_id, uid, left(coalesce(p_reason, ''), 200))
    on conflict (campaign_id, user_id) do update set reason = excluded.reason, created_at = now();
  select count(*) into n from public.ad_reports where campaign_id = p_id;
  update public.ad_campaigns set reports = n where id = p_id;
  if n >= 3 and k.status = 'active' then
    update public.ad_campaigns set status = 'paused', paused_by = 'reports', updated_at = now() where id = p_id;
    perform public.ad_log_add(p_id, 'pause', format('Пауза: %s жалоб(ы) — ждёт решения администратора', n));
    perform public.ad_notify_admins('📣 Жалобы на рекламу: ' || left(k.title, 60), 'Кампания на паузе, посмотри и реши.', 'adrep:' || p_id);
  end if;
  return jsonb_build_object('ok', true, 'reports', n);
end $$;

-- ═══ 7. Кабинет рекламодателя ═══
create or replace function public.ad_new_id() returns text language plpgsql as $$
declare s text;
begin
  loop
    s := substr(md5(random()::text || clock_timestamp()::text), 1, 10);
    exit when not exists (select 1 from public.ad_campaigns where id = s);
  end loop;
  return s;
end $$;

-- Принять правила рекламы (/ads-terms). p_version — какую редакцию человек видел
create or replace function public.ad_terms_accept(p_version text, p_name text default null, p_inn text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v text := (select terms_version from public.ad_settings where id = 1);
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_version is distinct from v then return jsonb_build_object('ok', false, 'reason', 'version', 'terms', v); end if;
  insert into public.ad_advertisers (user_id, terms, terms_at, name, inn)
    values (uid, v, now(), left(btrim(coalesce(p_name, '')), 120), left(btrim(coalesce(p_inn, '')), 12))
    on conflict (user_id) do update set terms = v, terms_at = now(),
      name = case when btrim(coalesce(p_name, '')) <> '' then left(btrim(p_name), 120) else public.ad_advertisers.name end,
      inn = case when btrim(coalesce(p_inn, '')) <> '' then left(btrim(p_inn), 12) else public.ad_advertisers.inn end;
  return jsonb_build_object('ok', true, 'terms', v);
end $$;

-- Кампания для кабинета (без служебного)
create or replace function public.ad_card(k public.ad_campaigns) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', k.id, 'title', k.title, 'status', k.status, 'pricing', k.pricing, 'bid', k.bid, 'days', k.days,
    'day_price', k.day_price, 'plan_budget', k.plan_budget, 'budget', k.budget, 'spent', round(k.spent, 3), 'refunded', k.refunded,
    'avail', floor(k.budget - k.refunded - k.spent), 'views', k.views, 'clicks', k.clicks, 'days_used', k.days_used,
    'start_date', k.start_date, 'end_date', k.end_date, 'sections', k.sections, 'devices', k.devices, 'ages', k.ages, 'geo', k.geo,
    'advertiser', k.advertiser, 'inn', k.inn, 'erid', k.erid, 'url', k.url, 'host', public.ad_host(k.url),
    'approved', k.approved, 'paused_by', k.paused_by, 'finish_reason', k.finish_reason, 'reject_reason', k.reject_reason,
    'reports', k.reports, 'age_rating', k.age_rating, 'groups', public.ad_groups(k.id), 'created_at', k.created_at, 'submitted_at', k.submitted_at,
    'updated_at', k.updated_at, 'finished_at', k.finished_at,
    'changed', k.approved_hash is not null and k.approved_hash is distinct from public.ad_hash(k.id),
    'today', (select jsonb_build_object('views', coalesce(sum(t.views), 0), 'clicks', coalesce(sum(t.clicks), 0))
      from public.ad_stats t where t.campaign_id = k.id and t.day = public.ad_today()),
    'thumb', (select c.image from public.ad_creatives c where c.campaign_id = k.id order by (c.kind = 'native') desc, c.kind limit 1))
$$;

-- Мои кампании + цены + принял ли правила
create or replace function public.ad_my() returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); a public.ad_advertisers%rowtype; v text;
begin
  perform public.ad_sweep();
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth', 'cfg', public.ad_prices()); end if;
  select terms_version into v from public.ad_settings where id = 1;
  select * into a from public.ad_advertisers where user_id = uid;
  return jsonb_build_object('ok', true, 'cfg', public.ad_prices(), 'terms_ok', a.terms is not distinct from v and a.terms is not null,
    'advertiser', jsonb_build_object('name', coalesce(a.name, ''), 'inn', coalesce(a.inn, '')),
    'admin', public.ad_admin(),
    'campaigns', coalesce((select jsonb_agg(public.ad_card(k) order by k.created_at desc) from public.ad_campaigns k where k.owner = uid), '[]'::jsonb));
end $$;

-- Одна кампания: креативы, статистика по дням и местам, журнал. Автору и админу
create or replace function public.ad_get(p_id text) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); k public.ad_campaigns%rowtype;
begin
  select * into k from public.ad_campaigns where id = p_id;
  if not found or uid is null or (k.owner <> uid and not public.ad_admin()) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'c', public.ad_card(k), 'own', k.owner = uid,
    'owner_nick', (select nick from public.profiles where id = k.owner),
    'creatives', coalesce((select jsonb_agg(jsonb_build_object('kind', c.kind, 'title', c.title, 'body', c.body, 'cta', c.cta,
        'image', c.image, 'w', c.w, 'h', c.h) order by c.kind) from public.ad_creatives c where c.campaign_id = k.id), '[]'::jsonb),
    'stats', coalesce((select jsonb_agg(x order by x.day) from (select day, sum(views)::int views, sum(clicks)::int clicks,
        round(sum(spent), 3) spent from public.ad_stats where campaign_id = k.id and day > public.ad_today() - 90 group by day) x), '[]'::jsonb),
    'places', coalesce((select jsonb_agg(x order by x.views desc) from (select place, sum(views)::int views, sum(clicks)::int clicks
        from public.ad_stats where campaign_id = k.id group by place) x), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(x order by x.id desc) from (select id, act, note, created_at, actor is not null and actor <> k.owner admin
        from public.ad_log where campaign_id = k.id order by id desc limit 50) x), '[]'::jsonb));
end $$;

-- Сохранить кампанию (новая — p_id пусто). p: title, pricing, bid, days, plan_budget, start_date, end_date, sections, devices,
-- ages, geo, advertiser, inn, erid, url, creatives [{kind, title, body, cta, image, w, h}] (нет ключа — креативы как были).
-- Черновик можно сохранять неполным; неверное (не https, запрещённая тема, чужая картинка) — сразу отказ.
-- После отправки: тип оплаты, дни, бюджет и дата начала — как были; правка содержимого работающей кампании → снова проверка.
create or replace function public.ad_save(p_id text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); s public.ad_settings%rowtype; k public.ad_campaigns%rowtype; new_id text; locked boolean;
  v_title text; v_pricing text; v_bid int; v_days int; v_plan int; v_start date; v_end date; v_sections text[]; v_devices text[];
  v_ages text[]; v_geo text; v_adv text; v_inn text; v_erid text; v_url text; v_age int; bad text; ec jsonb; sz int[]; cw int; ch int; v_status text; td date := public.ad_today();
  kinds text[] := '{}';
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'data'); end if;
  select * into s from public.ad_settings where id = 1;
  if coalesce(p_id, '') <> '' then
    select * into k from public.ad_campaigns where id = p_id for update;
    if not found or k.owner <> uid then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if k.status in ('finished', 'banned') then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
    if k.updated_at > now() - interval '1 second' then return jsonb_build_object('ok', false, 'reason', 'too_fast'); end if;
  else
    if (select count(*) from public.ad_campaigns where owner = uid) >= 30 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
    if exists (select 1 from public.ad_campaigns where owner = uid and created_at > now() - interval '5 seconds') then
      return jsonb_build_object('ok', false, 'reason', 'too_fast');
    end if;
  end if;
  locked := k.id is not null and k.status not in ('draft', 'rejected');

  -- Поля (нет в p — как было)
  v_title := left(btrim(coalesce(p ->> 'title', k.title, 'Кампания')), 60);
  if char_length(v_title) < 1 then v_title := 'Кампания'; end if;
  v_pricing := coalesce(p ->> 'pricing', k.pricing, 'cpm');
  if v_pricing not in ('cpm', 'day') then return jsonb_build_object('ok', false, 'reason', 'pricing'); end if;
  begin
    v_bid := coalesce((p ->> 'bid')::int, k.bid, 0);
    v_days := coalesce((p ->> 'days')::int, k.days, 0);
    v_plan := coalesce((p ->> 'plan_budget')::int, k.plan_budget, 0);
    v_start := case when p ? 'start_date' then nullif(p ->> 'start_date', '')::date else k.start_date end;
    v_end := case when p ? 'end_date' then nullif(p ->> 'end_date', '')::date else k.end_date end;
  exception when others then return jsonb_build_object('ok', false, 'reason', 'number');
  end;
  if v_bid < 0 or v_bid > 100000 or v_days < 0 or v_days > 365 or v_plan < 0 or v_plan > 10000000 then
    return jsonb_build_object('ok', false, 'reason', 'number');
  end if;
  if locked then   -- после отправки: оплата и начало не меняются (бюджет уже в копилке)
    v_pricing := k.pricing; v_days := k.days; v_plan := k.plan_budget; v_start := k.start_date;
    if k.pricing = 'day' then v_end := k.end_date; v_bid := k.bid; end if;
    if k.pricing = 'cpm' and v_bid < public.ad_floor(k.id) then return jsonb_build_object('ok', false, 'reason', 'bid', 'need', public.ad_floor(k.id)); end if;
    if v_end is distinct from k.end_date and v_end is not null and v_end < td then return jsonb_build_object('ok', false, 'reason', 'dates'); end if;
  end if;
  if v_start is not null and v_end is not null and v_end < v_start then return jsonb_build_object('ok', false, 'reason', 'dates'); end if;

  if p ? 'sections' then
    select coalesce(array_agg(distinct x order by x), '{}') into v_sections from jsonb_array_elements_text(case when jsonb_typeof(p -> 'sections') = 'array' then p -> 'sections' else '[]' end) x
      where x in ('games', 'videos', 'world', 'studio', 'chat', 'other');
  else v_sections := coalesce(k.sections, '{}'); end if;
  if p ? 'devices' then
    select coalesce(array_agg(distinct x order by x), '{}') into v_devices from jsonb_array_elements_text(case when jsonb_typeof(p -> 'devices') = 'array' then p -> 'devices' else '[]' end) x
      where x in ('mobile', 'desktop');
  else v_devices := coalesce(k.devices, '{}'); end if;
  if p ? 'ages' then
    select coalesce(array_agg(distinct x order by x), '{}') into v_ages from jsonb_array_elements_text(case when jsonb_typeof(p -> 'ages') = 'array' then p -> 'ages' else '[]' end) x
      where x in ('child', 'teen', 'teen16', 'adult', 'unknown');
  else v_ages := coalesce(k.ages, '{}'); end if;
  v_geo := coalesce(p ->> 'geo', k.geo, 'any');
  if v_geo not in ('any', 'ru', 'not_ru') then return jsonb_build_object('ok', false, 'reason', 'geo'); end if;
  v_adv := left(btrim(coalesce(p ->> 'advertiser', k.advertiser, '')), 120);
  v_inn := btrim(coalesce(p ->> 'inn', k.inn, ''));
  if v_inn <> '' and v_inn !~ '^([0-9]{10}|[0-9]{12})$' then return jsonb_build_object('ok', false, 'reason', 'inn'); end if;
  if p ? 'age_rating' then
    begin v_age := nullif(p ->> 'age_rating', '')::int; exception when others then return jsonb_build_object('ok', false, 'reason', 'age'); end;
    if v_age is not null and v_age not in (0, 6, 12, 16, 18) then return jsonb_build_object('ok', false, 'reason', 'age'); end if;
  else v_age := k.age_rating; end if;
  v_erid := btrim(coalesce(p ->> 'erid', k.erid, ''));
  if v_erid <> '' and v_erid !~ '^[A-Za-z0-9_-]{4,64}$' then return jsonb_build_object('ok', false, 'reason', 'erid'); end if;
  v_url := btrim(coalesce(p ->> 'url', k.url, ''));
  if v_url <> '' and public.ad_url_ok(v_url) <> '' then return jsonb_build_object('ok', false, 'reason', 'url', 'why', public.ad_url_ok(v_url)); end if;
  bad := coalesce(public.ad_bad(v_title), public.ad_bad(v_adv));
  if bad is not null then return jsonb_build_object('ok', false, 'reason', 'bad', 'word', bad); end if;

  -- Креативы: проверить все до записи
  if p ? 'creatives' then
    if jsonb_typeof(p -> 'creatives') <> 'array' or jsonb_array_length(p -> 'creatives') > 6 then return jsonb_build_object('ok', false, 'reason', 'creatives'); end if;
    for ec in select * from jsonb_array_elements(p -> 'creatives') loop
      if jsonb_typeof(ec) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'creatives'); end if;
      sz := public.ad_kind_size(ec ->> 'kind');
      if sz is null or (ec ->> 'kind') = any(kinds) then return jsonb_build_object('ok', false, 'reason', 'kind', 'kind', ec ->> 'kind'); end if;
      kinds := kinds || (ec ->> 'kind');
      if coalesce(ec ->> 'image', '') !~ ('^' || uid::text || '/[a-z0-9]{8,40}\.(webp|png|jpg)$') then
        return jsonb_build_object('ok', false, 'reason', 'image', 'kind', ec ->> 'kind');
      end if;
      begin cw := coalesce((ec ->> 'w')::int, 0); ch := coalesce((ec ->> 'h')::int, 0);
      exception when others then return jsonb_build_object('ok', false, 'reason', 'size', 'kind', ec ->> 'kind'); end;
      if cw <> sz[1] or ch <> sz[2] then
        return jsonb_build_object('ok', false, 'reason', 'size', 'kind', ec ->> 'kind', 'need', sz);
      end if;
      if char_length(coalesce(ec ->> 'title', '')) > 40 or char_length(coalesce(ec ->> 'body', '')) > 90 or char_length(coalesce(ec ->> 'cta', '')) > 20 then
        return jsonb_build_object('ok', false, 'reason', 'text', 'kind', ec ->> 'kind');
      end if;
      if (ec ->> 'kind') = 'native' and char_length(btrim(coalesce(ec ->> 'title', ''))) < 2 then
        return jsonb_build_object('ok', false, 'reason', 'title', 'kind', 'native');
      end if;
      bad := coalesce(public.ad_bad(ec ->> 'title'), public.ad_bad(ec ->> 'body'), public.ad_bad(ec ->> 'cta'));
      if bad is not null then return jsonb_build_object('ok', false, 'reason', 'bad', 'word', bad, 'kind', ec ->> 'kind'); end if;
    end loop;
  end if;

  if k.id is null then
    new_id := public.ad_new_id();
    insert into public.ad_campaigns (id, owner, title) values (new_id, uid, v_title);
    select * into k from public.ad_campaigns where id = new_id for update;
    perform public.ad_log_add(new_id, 'create', null, uid);
  end if;
  v_status := case when k.status = 'rejected' then 'draft' else k.status end;   -- отклонённую поправили — снова черновик
  update public.ad_campaigns set title = v_title, pricing = v_pricing, bid = v_bid, days = v_days, plan_budget = v_plan,
    start_date = v_start, end_date = v_end, sections = v_sections, devices = v_devices, ages = v_ages, geo = v_geo,
    advertiser = v_adv, inn = v_inn, erid = v_erid, url = v_url, age_rating = v_age, status = v_status, updated_at = now()
    where id = k.id;
  if p ? 'creatives' then
    delete from public.ad_creatives where campaign_id = k.id;
    insert into public.ad_creatives (campaign_id, kind, title, body, cta, image, w, h)
      select k.id, x ->> 'kind', btrim(coalesce(x ->> 'title', '')), btrim(coalesce(x ->> 'body', '')), btrim(coalesce(x ->> 'cta', '')),
        x ->> 'image', (x ->> 'w')::int, (x ->> 'h')::int
      from jsonb_array_elements(p -> 'creatives') x;
  end if;
  -- Работающая кампания и поменялось то, что видят зрители, — снова на проверку (бюджет остаётся в копилке)
  if v_status in ('active', 'paused') and k.approved_hash is distinct from public.ad_hash(k.id) then
    update public.ad_campaigns set status = 'review', approved = false, paused_by = null, submitted_at = now() where id = k.id;
    perform public.ad_log_add(k.id, 'edit', 'Изменено содержимое — снова на проверке', uid);
    perform public.ad_notify_admins('📣 Реклама изменена — на проверку: ' || left(v_title, 60), 'Рекламодатель поправил кампанию.', 'adrev:' || k.id || ':' || now()::text);
    v_status := 'review';
  end if;
  return jsonb_build_object('ok', true, 'id', k.id, 'status', v_status);
end $$;

-- Действия рекламодателя: submit (на проверку + оплата), withdraw (отозвать с проверки, вернуть деньги), pause, resume,
-- stop (закончить и вернуть остаток), topup (p_amount 💎; у пакета — дней), dup (копия-черновик), delete (черновик/отклонённую)
create or replace function public.ad_act(p_id text, p_act text, p_amount int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); s public.ad_settings%rowtype; k public.ad_campaigns%rowtype; td date := public.ad_today();
  a public.ad_advertisers%rowtype; deposit int; bal int; fl int; dp int; v_start date; v_end date; new_id text; amt int; n int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into s from public.ad_settings where id = 1;
  select * into k from public.ad_campaigns where id = p_id for update;
  if not found or k.owner <> uid then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  if p_act = 'submit' then
    if k.status <> 'draft' then return jsonb_build_object('ok', false, 'reason', 'status', 'status', k.status); end if;
    if not s.enabled then return jsonb_build_object('ok', false, 'reason', 'off'); end if;
    select * into a from public.ad_advertisers where user_id = uid;
    if a.terms is distinct from s.terms_version then return jsonb_build_object('ok', false, 'reason', 'terms', 'terms', s.terms_version); end if;
    if char_length(k.advertiser) < 2 then return jsonb_build_object('ok', false, 'reason', 'advertiser'); end if;
    if public.ad_url_ok(k.url) <> '' then return jsonb_build_object('ok', false, 'reason', 'url', 'why', public.ad_url_ok(k.url)); end if;
    select count(*) into n from public.ad_creatives where campaign_id = k.id;
    if n = 0 then return jsonb_build_object('ok', false, 'reason', 'creatives'); end if;
    if k.age_rating is null then return jsonb_build_object('ok', false, 'reason', 'age'); end if;
    if k.geo = 'ru' and k.erid = '' then return jsonb_build_object('ok', false, 'reason', 'erid_ru'); end if;   -- «только Россия» без erid не покажется никому
    v_start := coalesce(k.start_date, td);
    if v_start < td then return jsonb_build_object('ok', false, 'reason', 'dates'); end if;
    if v_start > td + 90 then return jsonb_build_object('ok', false, 'reason', 'dates'); end if;
    if k.pricing = 'cpm' then
      fl := public.ad_floor(k.id);
      if k.bid < fl then return jsonb_build_object('ok', false, 'reason', 'bid', 'need', fl); end if;
      if k.plan_budget < s.min_budget or k.plan_budget > s.max_budget then
        return jsonb_build_object('ok', false, 'reason', 'budget', 'min', s.min_budget, 'max', s.max_budget);
      end if;
      v_end := k.end_date;
      if v_end is not null and (v_end < v_start or v_end > v_start + 365) then return jsonb_build_object('ok', false, 'reason', 'dates'); end if;
      deposit := k.plan_budget; dp := 0;
    else
      if not s.day_on then return jsonb_build_object('ok', false, 'reason', 'day_off'); end if;
      if k.days < 1 or k.days > s.max_days then return jsonb_build_object('ok', false, 'reason', 'days', 'max', s.max_days); end if;
      dp := public.ad_dayprice(k.id);
      deposit := k.days * dp; v_end := v_start + k.days - 1;
    end if;
    bal := public.premium_add(uid, -deposit, 'ads', k.id, 'Реклама: ' || k.title);
    if bal is null then return jsonb_build_object('ok', false, 'reason', 'gems', 'need', deposit); end if;
    update public.ad_campaigns set status = 'review', budget = budget + deposit, day_price = dp, start_date = v_start, end_date = v_end,
      reject_reason = null, finish_reason = null, approved = false, submitted_at = now(), updated_at = now() where id = k.id;
    perform public.ad_log_add(k.id, 'submit', format('На проверке, в копилке %s 💎', deposit), uid);
    perform public.ad_notify_admins('📣 Новая реклама на проверку: ' || left(k.title, 60), format('%s 💎, %s', deposit, k.advertiser), 'adrev:' || k.id || ':' || now()::text);
    return jsonb_build_object('ok', true, 'status', 'review', 'paid', deposit, 'balance', bal);

  elsif p_act = 'withdraw' then
    if k.status <> 'review' then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
    if k.approved_at is not null then   -- уже работала: остаток вернём, кампания — законченная
      amt := public.ad_finish(k.id, 'owner', uid);
      return jsonb_build_object('ok', true, 'status', 'finished', 'refund', amt);
    end if;
    update public.ad_campaigns set status = 'draft', updated_at = now() where id = k.id;
    perform public.ad_log_add(k.id, 'withdraw', 'Отозвана с проверки', uid);
    amt := public.ad_refund(k.id, 'Отозвана с проверки: ' || k.title);
    return jsonb_build_object('ok', true, 'status', 'draft', 'refund', amt);

  elsif p_act = 'pause' then
    if k.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
    update public.ad_campaigns set status = 'paused', paused_by = 'owner', updated_at = now() where id = k.id;
    perform public.ad_log_add(k.id, 'pause', null, uid);
    return jsonb_build_object('ok', true, 'status', 'paused');

  elsif p_act = 'resume' then
    if k.status <> 'paused' or k.paused_by is distinct from 'owner' then return jsonb_build_object('ok', false, 'reason', 'status', 'by', k.paused_by); end if;
    if not k.approved then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
    update public.ad_campaigns set status = 'active', paused_by = null, updated_at = now() where id = k.id;
    perform public.ad_log_add(k.id, 'resume', null, uid);
    return jsonb_build_object('ok', true, 'status', 'active');

  elsif p_act = 'stop' then
    if k.status not in ('active', 'paused') then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
    amt := public.ad_finish(k.id, 'owner', uid);
    return jsonb_build_object('ok', true, 'status', 'finished', 'refund', amt);

  elsif p_act = 'topup' then
    if k.status not in ('review', 'active', 'paused', 'finished') then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
    if k.pricing = 'day' then
      if k.status = 'finished' then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
      if coalesce(p_amount, 0) < 1 or k.days + p_amount > s.max_days then return jsonb_build_object('ok', false, 'reason', 'days', 'max', s.max_days); end if;
      deposit := p_amount * k.day_price;
    else
      if k.status = 'finished' and (not k.approved or k.approved_hash is distinct from public.ad_hash(k.id)
         or (k.end_date is not null and k.end_date < td) or k.finish_reason not in ('budget', 'owner')) then
        return jsonb_build_object('ok', false, 'reason', 'status');
      end if;
      if coalesce(p_amount, 0) < s.min_topup or p_amount > s.max_budget then
        return jsonb_build_object('ok', false, 'reason', 'amount', 'min', s.min_topup, 'max', s.max_budget);
      end if;
      deposit := p_amount;
    end if;
    bal := public.premium_add(uid, -deposit, 'ads', k.id, 'Пополнение рекламы: ' || k.title);
    if bal is null then return jsonb_build_object('ok', false, 'reason', 'gems', 'need', deposit); end if;
    update public.ad_campaigns set budget = budget + deposit,
      days = days + case when pricing = 'day' then p_amount else 0 end,
      end_date = case when pricing = 'day' then end_date + p_amount else end_date end,
      status = case when status = 'finished' then 'active' else status end,
      finish_reason = case when status = 'finished' then null else finish_reason end,
      finished_at = case when status = 'finished' then null else finished_at end, updated_at = now()
      where id = k.id;
    perform public.ad_log_add(k.id, 'topup', format('+%s 💎', deposit), uid);
    return jsonb_build_object('ok', true, 'paid', deposit, 'balance', bal,
      'status', (select status from public.ad_campaigns where id = k.id));

  elsif p_act = 'dup' then
    if (select count(*) from public.ad_campaigns where owner = uid) >= 30 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
    new_id := public.ad_new_id();
    insert into public.ad_campaigns (id, owner, title, pricing, bid, days, plan_budget, end_date, sections, devices, ages, geo,
        advertiser, inn, erid, url, age_rating)
      values (new_id, uid, left(k.title || ' (копия)', 60), k.pricing, k.bid, k.days, greatest(k.plan_budget, s.min_budget), null,
        k.sections, k.devices, k.ages, k.geo, k.advertiser, k.inn, k.erid, k.url, k.age_rating);
    insert into public.ad_creatives (campaign_id, kind, title, body, cta, image, w, h)
      select new_id, kind, title, body, cta, image, w, h from public.ad_creatives where campaign_id = k.id;
    perform public.ad_log_add(new_id, 'create', 'Копия ' || k.id, uid);
    return jsonb_build_object('ok', true, 'id', new_id, 'status', 'draft');

  elsif p_act = 'delete' then
    if k.status not in ('draft', 'rejected') then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
    if floor(k.budget - k.refunded - k.spent) > 0 then perform public.ad_refund(k.id); end if;   -- на всякий случай
    delete from public.ad_campaigns where id = k.id;
    return jsonb_build_object('ok', true, 'status', 'deleted');
  end if;
  return jsonb_build_object('ok', false, 'reason', 'act');
end $$;

-- ═══ 8. Админ: очередь проверки, все кампании, итоги, цены ═══
create or replace function public.ad_admin_list(p_status text default 'review')
returns jsonb language plpgsql security definer set search_path = public as $$
declare td date := public.ad_today();
begin
  if not public.ad_admin() then raise exception 'Только для админа'; end if;
  perform public.ad_sweep();
  return jsonb_build_object('ok', true, 'cfg', public.ad_prices(),
    'totals', jsonb_build_object(
      'escrow', coalesce((select floor(sum(budget - refunded - spent)) from public.ad_campaigns where status in ('review', 'active', 'paused')), 0),
      'earned', coalesce((select round(sum(spent), 2) from public.ad_campaigns), 0),
      'earned_7d', coalesce((select round(sum(spent), 2) from public.ad_stats where day > td - 7), 0),
      'views_today', coalesce((select sum(views) from public.ad_stats where day = td), 0),
      'clicks_today', coalesce((select sum(clicks) from public.ad_stats where day = td), 0),
      'views_7d', coalesce((select sum(views) from public.ad_stats where day > td - 7), 0),
      'clicks_7d', coalesce((select sum(clicks) from public.ad_stats where day > td - 7), 0),
      'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.ad_campaigns group by status) t), '{}'::jsonb)),
    'campaigns', coalesce((select jsonb_agg(public.ad_card(k) || jsonb_build_object('owner_nick', p.nick,
        'creatives', coalesce((select jsonb_agg(jsonb_build_object('kind', c.kind, 'title', c.title, 'body', c.body, 'cta', c.cta,
          'image', c.image, 'w', c.w, 'h', c.h) order by c.kind) from public.ad_creatives c where c.campaign_id = k.id), '[]'::jsonb))
        order by k.submitted_at nulls last, k.created_at)
      from public.ad_campaigns k left join public.profiles p on p.id = k.owner
      where (coalesce(p_status, '') = '' and k.status <> 'draft') or k.status = p_status
         or (p_status = 'live' and k.status in ('active', 'paused'))), '[]'::jsonb));
end $$;

-- approve / reject (нужна причина) / pause / resume / stop / ban — с причиной в журнале и уведомлением рекламодателю
create or replace function public.ad_admin_act(p_id text, p_act text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); k public.ad_campaigns%rowtype; td date := public.ad_today(); sh int; amt int;
  why text := left(btrim(coalesce(p_reason, '')), 300);
begin
  if not public.ad_admin() then raise exception 'Только для админа'; end if;
  select * into k from public.ad_campaigns where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  if p_act = 'approve' then
    if k.status <> 'review' then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
    sh := greatest(0, td - coalesce(k.start_date, td));   -- проверили позже даты начала — сдвигаем даты целиком
    update public.ad_campaigns set status = 'active', approved = true, approved_hash = public.ad_hash(k.id), approved_at = now(),
      approved_by = uid, paused_by = null, reject_reason = null, start_date = coalesce(start_date, td) + sh,
      end_date = case when end_date is null then null else end_date + sh end, updated_at = now() where id = k.id;
    perform public.ad_log_add(k.id, 'approve', nullif(why, ''), uid);
    perform public.ad_notify(k.owner, '✅ Реклама одобрена: ' || left(k.title, 60), 'Кампания запущена — статистика в кабинете.', '#/adv/c/' || k.id, 'adok:' || k.id || ':' || now()::text);
    return jsonb_build_object('ok', true, 'status', 'active');

  elsif p_act = 'reject' then
    if k.status <> 'review' then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
    if char_length(why) < 3 then return jsonb_build_object('ok', false, 'reason', 'why'); end if;
    update public.ad_campaigns set status = 'rejected', approved = false, reject_reason = why, updated_at = now() where id = k.id;
    perform public.ad_log_add(k.id, 'reject', why, uid);
    amt := public.ad_refund(k.id, 'Реклама отклонена: ' || k.title);
    perform public.ad_notify(k.owner, '⛔ Реклама отклонена: ' || left(k.title, 60), why || case when amt > 0 then format(' · %s 💎 вернулись на баланс.', amt) else '' end,
      '#/adv/c/' || k.id, 'adno:' || k.id || ':' || now()::text);
    return jsonb_build_object('ok', true, 'status', 'rejected', 'refund', amt);

  elsif p_act = 'pause' then
    if k.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
    update public.ad_campaigns set status = 'paused', paused_by = 'admin', updated_at = now() where id = k.id;
    perform public.ad_log_add(k.id, 'pause', coalesce(nullif(why, ''), 'Пауза администратора'), uid);
    perform public.ad_notify(k.owner, '⏸ Реклама на паузе: ' || left(k.title, 60), coalesce(nullif(why, ''), 'Администратор поставил кампанию на паузу.'), '#/adv/c/' || k.id);
    return jsonb_build_object('ok', true, 'status', 'paused');

  elsif p_act = 'resume' then
    if k.status <> 'paused' or not k.approved then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
    update public.ad_campaigns set status = 'active', paused_by = null, updated_at = now() where id = k.id;
    if k.paused_by = 'reports' then delete from public.ad_reports where campaign_id = k.id; update public.ad_campaigns set reports = 0 where id = k.id; end if;
    perform public.ad_log_add(k.id, 'resume', nullif(why, ''), uid);
    return jsonb_build_object('ok', true, 'status', 'active');

  elsif p_act = 'stop' then
    if k.status not in ('active', 'paused', 'review') then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
    if k.status = 'review' and k.approved_at is null then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
    amt := public.ad_finish(k.id, 'admin', uid);
    if why <> '' then perform public.ad_log_add(k.id, 'note', why, uid); end if;
    return jsonb_build_object('ok', true, 'status', 'finished', 'refund', amt);

  elsif p_act = 'rate' then
    if why !~ '^(0|6|12|16|18)$' then return jsonb_build_object('ok', false, 'reason', 'age'); end if;
    update public.ad_campaigns set age_rating = why::int, updated_at = now() where id = k.id;
    -- одобренное содержимое не менялось — метку админа считаем частью одобренного (иначе «изменена»)
    if k.approved and k.approved_hash is not distinct from public.ad_hash_with(k.id, k.age_rating) then
      update public.ad_campaigns set approved_hash = public.ad_hash(k.id) where id = k.id;
    end if;
    perform public.ad_log_add(k.id, 'rate', 'Возрастная метка: ' || why || '+', uid);
    perform public.ad_notify(k.owner, '🔞 Метка рекламы: ' || why || '+', 'Администратор поменял возрастную метку кампании «' || left(k.title, 60) || '».', '#/adv/c/' || k.id);
    return jsonb_build_object('ok', true, 'status', k.status, 'age_rating', why::int);

  elsif p_act = 'ban' then
    if k.status = 'banned' then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
    if char_length(why) < 3 then return jsonb_build_object('ok', false, 'reason', 'why'); end if;
    update public.ad_campaigns set status = 'banned', approved = false, reject_reason = why, paused_by = null, updated_at = now() where id = k.id;
    perform public.ad_log_add(k.id, 'ban', why, uid);
    amt := public.ad_refund(k.id, 'Реклама заблокирована: ' || k.title);
    perform public.ad_notify(k.owner, '🚫 Реклама заблокирована: ' || left(k.title, 60), why || case when amt > 0 then format(' · %s 💎 вернулись на баланс.', amt) else '' end,
      '#/adv/c/' || k.id);
    return jsonb_build_object('ok', true, 'status', 'banned', 'refund', amt);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'act');
end $$;

-- Цены и настройки (в кабинете у админа). Новые цены — для новых отправок; кампании в работе — по своей цене
create or replace function public.ad_admin_settings(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.ad_settings%rowtype; g text; pr jsonb;
begin
  if not public.ad_admin() then raise exception 'Только для админа'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'data'); end if;
  select * into s from public.ad_settings where id = 1 for update;
  begin
    if p ? 'enabled' then s.enabled := (p ->> 'enabled')::boolean; end if;
    if p ? 'day_on' then s.day_on := (p ->> 'day_on')::boolean; end if;
    if p ? 'min_budget' then s.min_budget := greatest(1, least(1000000, (p ->> 'min_budget')::int)); end if;
    if p ? 'max_budget' then s.max_budget := greatest(s.min_budget, least(10000000, (p ->> 'max_budget')::int)); end if;
    if p ? 'min_topup' then s.min_topup := greatest(1, least(1000000, (p ->> 'min_topup')::int)); end if;
    if p ? 'max_days' then s.max_days := greatest(1, least(365, (p ->> 'max_days')::int)); end if;
    if p ? 'dedup_min' then s.dedup_min := greatest(1, least(1440, (p ->> 'dedup_min')::int)); end if;
    if p ? 'freq_day' then s.freq_day := greatest(1, least(100, (p ->> 'freq_day')::int)); end if;
    if p ? 'click_min' then s.click_min := greatest(1, least(1440, (p ->> 'click_min')::int)); end if;
    if jsonb_typeof(p -> 'prices') = 'object' then
      pr := s.prices;
      foreach g in array array['native', 'banner', 'rail', 'board'] loop
        if jsonb_typeof(p -> 'prices' -> g) = 'object' then
          pr := jsonb_set(pr, array[g], jsonb_build_object(
            'cpm', greatest(1, least(100000, coalesce((p -> 'prices' -> g ->> 'cpm')::int, (pr -> g ->> 'cpm')::int))),
            'day', greatest(1, least(100000, coalesce((p -> 'prices' -> g ->> 'day')::int, (pr -> g ->> 'day')::int)))));
        end if;
      end loop;
      s.prices := pr;
    end if;
  exception when others then return jsonb_build_object('ok', false, 'reason', 'number');
  end;
  update public.ad_settings set enabled = s.enabled, day_on = s.day_on, min_budget = s.min_budget, max_budget = s.max_budget,
    min_topup = s.min_topup, max_days = s.max_days, dedup_min = s.dedup_min, freq_day = s.freq_day, click_min = s.click_min,
    prices = s.prices, updated_at = now(), updated_by = auth.uid() where id = 1;
  return jsonb_build_object('ok', true, 'cfg', public.ad_prices());
end $$;

-- ═══ 9. Права на функции ═══
-- Служебные — только изнутри
revoke execute on function public.ad_sign(text) from public, anon, authenticated;
revoke execute on function public.ad_token(text, text, text, bigint) from public, anon, authenticated;
revoke execute on function public.ad_token_check(text, text) from public, anon, authenticated;
revoke execute on function public.ad_refund(text, text) from public, anon, authenticated;
revoke execute on function public.ad_finish(text, text, uuid) from public, anon, authenticated;
revoke execute on function public.ad_sweep() from public, anon, authenticated;
revoke execute on function public.ad_notify(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.ad_notify_admins(text, text, text) from public, anon, authenticated;
revoke execute on function public.ad_log_add(text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.ad_viewer() from public, anon, authenticated;
revoke execute on function public.ad_new_id() from public, anon, authenticated;
revoke execute on function public.ad_card(public.ad_campaigns) from public, anon, authenticated;
revoke execute on function public.ad_hash(text) from public, anon, authenticated;
revoke execute on function public.ad_hash_with(text, int) from public, anon, authenticated;
revoke execute on function public.ad_perks(uuid) from public, anon, authenticated;
revoke execute on function public.ad_groups(text) from public, anon, authenticated;
revoke execute on function public.ad_floor(text) from public, anon, authenticated;
revoke execute on function public.ad_dayprice(text) from public, anon, authenticated;
-- Сервер сайта (/go/<id>)
revoke execute on function public.ad_go(text, text, text, text) from public, anon, authenticated;
grant execute on function public.ad_go(text, text, text, text) to service_role;
-- Всем (гостям тоже): цены, что работает, выдача и показ
grant execute on function public.ad_prices() to anon, authenticated;
grant execute on function public.ad_live() to anon, authenticated;
grant execute on function public.ad_pick(text, jsonb) to anon, authenticated;
grant execute on function public.ad_view(text, text) to anon, authenticated;
-- Вошедшим: кабинет и жалоба
revoke execute on function public.ad_report(text, text) from public, anon;
grant execute on function public.ad_report(text, text) to authenticated;
revoke execute on function public.ad_terms_accept(text, text, text) from public, anon;
grant execute on function public.ad_terms_accept(text, text, text) to authenticated;
revoke execute on function public.ad_my() from public;
grant execute on function public.ad_my() to anon, authenticated;
revoke execute on function public.ad_get(text) from public, anon;
grant execute on function public.ad_get(text) to authenticated;
revoke execute on function public.ad_save(text, jsonb) from public, anon;
grant execute on function public.ad_save(text, jsonb) to authenticated;
revoke execute on function public.ad_act(text, text, int) from public, anon;
grant execute on function public.ad_act(text, text, int) to authenticated;
revoke execute on function public.ad_admin_list(text) from public, anon;
grant execute on function public.ad_admin_list(text) to authenticated;
revoke execute on function public.ad_admin_act(text, text, text) from public, anon;
grant execute on function public.ad_admin_act(text, text, text) to authenticated;
revoke execute on function public.ad_admin_settings(jsonb) from public, anon;
grant execute on function public.ad_admin_settings(jsonb) to authenticated;

-- ═══ 10. Хранилище картинок 'ads' — закрытое ═══
-- Загрузить — только в свою папку <id аккаунта>/<случайное>.webp|png|jpg, не больше 60 файлов; перезаписать и удалить
-- рекламодатель не может (подменить одобренную картинку нельзя). Смотреть: автор, админ, остальные — только картинки
-- одобренной работающей кампании (через подписанную ссылку — js/core/ad-direct.js)
create or replace function public.ad_img_count() returns int language sql stable security definer set search_path = public, storage as $$
  select count(*)::int from storage.objects where bucket_id = 'ads' and name like auth.uid()::text || '/%'
$$;
create or replace function public.ad_img_live(p_name text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ad_creatives c join public.ad_campaigns k on k.id = c.campaign_id
    where c.image = p_name and k.approved and k.status in ('active', 'paused'))
$$;
grant execute on function public.ad_img_count() to authenticated;
grant execute on function public.ad_img_live(text) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ads', 'ads', false, 524288, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 524288, allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg'];

drop policy if exists "ads: загрузить картинку" on storage.objects;
create policy "ads: загрузить картинку" on storage.objects for insert to authenticated
  with check (bucket_id = 'ads' and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-f-]{36}/[a-z0-9]{8,40}\.(webp|png|jpg)$' and public.ad_img_count() < 60);
drop policy if exists "ads: смотреть картинки" on storage.objects;
create policy "ads: смотреть картинки" on storage.objects for select to anon, authenticated
  using (bucket_id = 'ads' and ((storage.foldername(name))[1] = auth.uid()::text or public.ad_admin() or public.ad_img_live(name)));
drop policy if exists "ads: удалить картинку (админ)" on storage.objects;
create policy "ads: удалить картинку (админ)" on storage.objects for delete to authenticated
  using (bucket_id = 'ads' and public.ad_admin());

-- Проверка (необязательно):
-- select public.ad_prices();                 -- {"enabled": true, "prices": {…}, …}
-- select public.ad_live();                   -- {"on": true, "f": {}}
-- select id, title, status, budget, spent, refunded from public.ad_campaigns order by created_at desc limit 20;
