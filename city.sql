-- ═══════════════════════════════════════════════════════════════════
--  «ЖИВОЙ ГОРОД» (шаг 1 «Вселенной», docs/plans/universe-step1.md, docs/CITY_ECONOMY.md) — денки 💵 на сервере.
--  P1 «Денки и смены»: кошелёк, работы в «Солнечном городке» (0+) и «Большом городе» (16+), навыки, усталость и лимиты,
--  еда с бонусом к зарплате, общая стройка, казна городов, ежедневная эмиссия с «центробанком», журнал для админа.
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно (можно запускать ещё раз — так и будет после каждой фазы).
--  Нужны (уже применены): profiles, banned_nicks, age.sql (age_group_of). Без age.sql «Большой город» просто никому не откроется.
--  Деньги меняются ТОЛЬКО здесь (security definer): клиент шлёт намерения, показывает сразу по тем же правилам (js/games/mir-econ.js
--  → Rules) и сверяется. Каталог city_defs0() собирает node scripts/gen-city-defs.cjs из MirEcon.SERVER (руками JSON не править);
--  числа без кода меняет админ: city_admin('cfg') — ключи из белого списка cfgk. Тест: node scripts/city-sql-test.mjs (PGlite).
--  Денки не меняются на 🪙/💎 и обратно, переводов между игроками нет. Деньги приходят: подарок новичку (раз на аккаунт), эмиссия
--  в казну раз в день; уходят: сверх потолка казны. Сохранение: Σ кошельков + Σ казны = Σ выпущено − Σ уничтожено (city_admin('sum')).
--  Проверка после запуска (publishable-ключ гостем; PGRST202 = функции нет, файл не применён):
--    /rpc/city_defs → {"v":1,…,"profs":{"cook":…}}; /rpc/city_public {"p_city":"kids"} → {"ok":true,"city":"kids","treasury":5000,…};
--    /rpc/city_state {} → 401 / 42501 (только вошедшим); /rpc/city_act {"p_act":"job"} → 401 / 42501; /rpc/city_admin {"p_act":"sum"} → 401.
-- ═══════════════════════════════════════════════════════════════════

-- ═══ 1. Таблицы ═══
create table if not exists public.city_cfg (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,          -- настройки админа поверх каталога: {"profs.cook.wage": 8, …}
  rev int not null default 0,                       -- версия настроек (клиент перечитывает каталог)
  hist jsonb not null default '[]'::jsonb,          -- последние 30 правок: кто, когда, что
  salt text not null default md5(random()::text || clock_timestamp()::text),   -- соль хешей IP/устройства (не читается снаружи)
  updated_at timestamptz not null default now()
);
create table if not exists public.city_bank (
  id int primary key default 1 check (id = 1),
  k int not null default 1000,                      -- множитель эмиссии, ‰ (500…1500)
  m_avg int not null default 0,                     -- средний кошелёк игроков за 14 дней (M)
  actives int not null default 0,                   -- сколько таких игроков
  day date,                                         -- когда считали
  stats jsonb not null default '{}'::jsonb
);
create table if not exists public.cities (
  id text primary key check (id in ('kids', 'metro')),
  treasury bigint not null default 0 check (treasury >= 0),
  wage_k int not null default 100,                  -- ставка зарплат города, % (мэр — P6)
  site int not null default 0,                      -- общая стройка: сколько заданий строителей сделано
  frozen boolean not null default false,            -- пауза (админ): работы и магазины закрыты
  minted bigint not null default 0,                 -- всего выпущено в этот город (стартовая казна, подарки новичкам, эмиссия, админ)
  burned bigint not null default 0,                 -- всего уничтожено (сверх потолка казны, админ, удалённые аккаунты)
  day date,                                         -- день, за который копится stats
  t_tick bigint not null default 0,
  rev int not null default 0,                       -- растёт, когда меняется видимое всем (этап стройки, найм, новый день, настройки)
  stats jsonb not null default '{}'::jsonb          -- счётчики сегодняшнего дня (снимок — в city_days)
);
create table if not exists public.city_people (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  cash bigint not null default 0 check (cash >= 0),
  frac int not null default 0 check (frac between 0 and 99),   -- «копейки» зарплаты (сотые денки), копятся до целой
  granted boolean not null default false,           -- подарок новичку получен
  skills jsonb not null default '{}'::jsonb,        -- {профессия: заданий всего} — уровень навыка
  xpd jsonb not null default '{}'::jsonb,           -- {профессия: заданий сегодня} — усталость
  day date,                                         -- день счётчиков xpd / wd / fd (по Москве)
  wd int not null default 0,                        -- валовая зарплата сегодня, сотые (лимит caps.wageDay × 100)
  fd int not null default 0,                        -- еды куплено сегодня
  food jsonb not null default '{}'::jsonb,          -- еда в кармане {вид: штук}
  buffs jsonb not null default '{}'::jsonb,         -- {"food": {"p": %, "u": до (секунды)}}
  job text, job_city text, job_mode text, job_place text,
  task_n text,                                      -- номер текущего задания (сдать можно только его)
  task_t bigint not null default 0,                 -- когда выдано (секунды сервера)
  task_k int not null default 0,                    -- цель задания 0…9 (клиент выбирает место)
  act_t bigint not null default 0,                  -- частота: начало минуты
  act_n int not null default 0,                     -- и ходов в ней
  seen_at bigint not null default 0,                -- последний успешный ход
  rev int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.city_ledger (
  id bigserial primary key,
  user_id uuid,                                     -- null — казна города (эмиссия, потолок, админ)
  city text not null,
  amount int not null,                              -- + пришло, − ушло (целые денки)
  fee int not null default 0,                       -- налог с зарплаты, СОТЫЕ денки
  bal bigint not null,                              -- кошелёк (или казна) после
  kind text not null,                               -- grant / wage / food / issue / cap / adm
  ref text not null default '',
  at bigint not null,
  day date not null
);
create index if not exists idx_city_ledger_user on public.city_ledger (user_id, id desc);
create index if not exists idx_city_ledger_day on public.city_ledger (city, day, kind);
create table if not exists public.city_contrib (
  city text not null, user_id uuid not null, week text not null,
  pts int not null default 0, days int not null default 0, last_day date,
  primary key (city, user_id, week)
);
create index if not exists idx_city_contrib_week on public.city_contrib (city, week, pts desc);
create table if not exists public.city_marks (
  user_id uuid not null, kind text not null check (kind in ('ip', 'dev')), hash text not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, kind, hash)
);
create index if not exists idx_city_marks_hash on public.city_marks (kind, hash);
create table if not exists public.city_days (
  city text not null, day date not null, stats jsonb not null default '{}'::jsonb,
  primary key (city, day)
);
-- снаружи не читается и не пишется ничего: только функции ниже
alter table public.city_cfg enable row level security;
alter table public.city_bank enable row level security;
alter table public.cities enable row level security;
alter table public.city_people enable row level security;
alter table public.city_ledger enable row level security;
alter table public.city_contrib enable row level security;
alter table public.city_marks enable row level security;
alter table public.city_days enable row level security;
revoke all on public.city_cfg, public.city_bank, public.cities, public.city_people, public.city_ledger, public.city_contrib, public.city_marks, public.city_days from anon, authenticated;
revoke all on sequence public.city_ledger_id_seq from anon, authenticated;

-- ═══ 2. Часы и каталог ═══
create or replace function public.city_now() returns bigint language sql stable as $$
  select floor(extract(epoch from now()))::bigint
$$;
create or replace function public.city_today() returns date language sql stable as $$
  select (to_timestamp(public.city_now()) at time zone 'Europe/Moscow')::date
$$;
-- Каталог — КАК MirEcon.SERVER в js/games/mir-econ.js. Собирает node scripts/gen-city-defs.cjs (--check — сверка)
-- gen:city-defs:begin
create or replace function public.city_defs0() returns jsonb language sql immutable as $$
  select '{"v":1,"start":50,"cities":{"kids":{"age":0,"seed":5000,"reserve":300,"capDays":30,"tax":{"income":5,"sales":3},"issue":{"base":300,"per":120,"cap":6000},"shops":{"k_bake":["bun","pie"],"k_ice":["icecream"]}},"metro":{"age":16,"seed":10000,"reserve":500,"capDays":30,"tax":{"income":10,"sales":5},"issue":{"base":500,"per":160,"cap":12000},"shops":{"m_shop":["apple","juice","burger"],"m_rest":["pizza","soup","coffee"],"m_mall":["burger","pizza","juice","coffee","icecream"]}}},"profs":{"cook":{"ph":1,"cities":{"kids":["k_bake"],"metro":["m_rest"]},"age":0,"kind":"svc","modes":["city"],"min":25,"wage":6},"seller":{"ph":1,"cities":{"kids":["k_ice"],"metro":["m_shop","m_bank"]},"age":0,"kind":"svc","modes":["city"],"min":15,"wage":5},"doctor":{"ph":1,"cities":{"kids":["k_hosp"],"metro":["m_hosp"]},"age":0,"kind":"svc","modes":["city"],"min":20,"wage":6},"fire":{"ph":1,"cities":{"kids":["k_fire"],"metro":["m_fire"]},"age":0,"kind":"svc","modes":["city"],"min":25,"wage":6},"builder":{"ph":1,"cities":{"kids":["k_site"],"metro":["m_lot1"]},"age":0,"kind":"build","modes":["city"],"min":20,"wage":7,"site":1},"teacher":{"ph":1,"cities":{"kids":["k_school"],"metro":["m_city3"]},"age":0,"kind":"svc","modes":["city"],"min":20,"wage":6},"police":{"ph":1,"cities":{"metro":["m_police"]},"age":16,"kind":"svc","modes":["city"],"min":25,"wage":7},"driver":{"ph":1,"cities":{"metro":["m_taxi"]},"age":16,"kind":"svc","modes":["city"],"min":40,"wage":10},"mech":{"ph":1,"cities":{"kids":["k_play"],"metro":["m_gas"]},"age":0,"kind":"svc","modes":["city"],"min":15,"wage":6}},"goods":{"bun":{"cat":"food","ref":4,"buff":[5,30]},"pie":{"cat":"food","ref":12,"buff":[10,60]},"icecream":{"cat":"food","ref":4,"buff":[5,30]},"apple":{"cat":"food","ref":3,"buff":[3,20]},"juice":{"cat":"food","ref":4,"buff":[5,30]},"coffee":{"cat":"food","ref":6,"buff":[5,30]},"burger":{"cat":"food","ref":10,"buff":[10,60]},"pizza":{"cat":"food","ref":12,"buff":[10,60]},"soup":{"cat":"food","ref":10,"buff":[10,60]}},"skill":{"at":[0,30,150,500,1500],"mult":[100,110,125,140,160],"fast":[100,95,90,85,80]},"caps":{"full":40,"half":60,"wageDay":400,"foodDay":20,"foodHold":10,"actMin":60,"qtyMax":5},"buff":{"max":20},"bank":{"T":1500,"k0":1000,"kMin":500,"kMax":1500,"hi2":130,"hi1":110,"lo1":90,"lo2":70,"d2":50,"d1":20,"drift":10,"mDays":14,"a7":[5,2]},"site":{"units":10,"stages":5},"keep":{"ledger":30,"marks":30,"contrib":56,"batch":5000},"cfgk":[["start",0,1000],["profs.*.wage",1,100],["profs.*.min",5,600],["caps.wageDay",0,5000],["caps.full",1,300],["caps.half",1,300],["caps.foodDay",0,100],["caps.foodHold",1,50],["cities.kids.tax.income",0,10],["cities.kids.tax.sales",0,8],["cities.metro.tax.income",0,15],["cities.metro.tax.sales",0,12],["cities.*.issue.base",0,100000],["cities.*.issue.per",0,10000],["cities.*.issue.cap",0,1000000],["cities.*.reserve",0,1000000],["cities.*.capDays",1,365],["bank.T",100,1000000],["goods.*.ref",1,10000],["site.units",1,1000]]}'::jsonb
$$;
-- gen:city-defs:end
-- Ключ настройки из белого списка (cfgk) и число в его пределах (то же — MirEcon.cfgOk)
create or replace function public.city_cfgok_(p_base jsonb, p_key text, p_val jsonb) returns boolean language plpgsql immutable as $$
declare k text[]; r jsonb; pat text[]; i int; m boolean; v numeric;
begin
  if p_key is null or p_key !~ '^[a-zA-Z0-9_.]{1,60}$' then return false; end if;
  k := string_to_array(p_key, '.');
  if jsonb_typeof(p_base #> k) is distinct from 'number' then return false; end if;
  if p_val is null or jsonb_typeof(p_val) = 'null' then return true; end if;
  if jsonb_typeof(p_val) <> 'number' then return false; end if;
  v := (p_val #>> '{}')::numeric;
  for r in select e from jsonb_array_elements(p_base->'cfgk') e loop
    pat := string_to_array(r->>0, '.');
    if array_length(pat, 1) <> array_length(k, 1) then continue; end if;
    m := true;
    for i in 1 .. array_length(k, 1) loop
      if pat[i] <> '*' and pat[i] <> k[i] then m := false; exit; end if;
    end loop;
    if m then return v = trunc(v) and v between (r->>1)::numeric and (r->>2)::numeric; end if;
  end loop;
  return false;
end $$;
-- Каталог с настройками админа (то же — MirEcon.merge) + cv (версия настроек)
create or replace function public.city_defs() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d jsonb := public.city_defs0(); r record; v_data jsonb; v_rev int;
begin
  select c.data, c.rev into v_data, v_rev from public.city_cfg c where c.id = 1;
  for r in select e.key, e.value from jsonb_each(coalesce(v_data, '{}'::jsonb)) e loop
    if jsonb_typeof(d #> string_to_array(r.key, '.')) = 'number' and jsonb_typeof(r.value) = 'number' then
      d := jsonb_set(d, string_to_array(r.key, '.'), r.value, false);
    end if;
  end loop;
  return d || jsonb_build_object('cv', coalesce(v_rev, 0));
end $$;

-- ═══ 3. Помощники (как MirEcon.Rules) ═══
create or replace function public.city_lvl_(d jsonb, p_xp int) returns int language sql immutable as $$
  select coalesce(max(q.o - 1), 0)::int from jsonb_array_elements_text(d->'skill'->'at') with ordinality q(v, o) where coalesce(p_xp, 0) >= q.v::int
$$;
create or replace function public.city_stage_(d jsonb, p_site int) returns int language sql immutable as $$
  select (coalesce(p_site, 0) / greatest(1, (d->'site'->>'units')::int)) % greatest(1, (d->'site'->>'stages')::int)
$$;
create or replace function public.city_buff_(d jsonb, p_buffs jsonb, p_now bigint) returns int language sql immutable as $$
  select case when coalesce((p_buffs->'food'->>'u')::bigint, 0) > p_now then least((d->'buff'->>'max')::int, coalesce((p_buffs->'food'->>'p')::int, 0)) else 0 end
$$;
create or replace function public.city_price_(d jsonb, p_item text) returns int language sql immutable as $$
  select coalesce(((d->'goods'->p_item->>'ref')::int * 125 + 50) / 100, 0)
$$;
create or replace function public.city_nonce_() returns text language sql volatile as $$
  select substr(md5(random()::text || clock_timestamp()::text), 1, 8)
$$;
create or replace function public.city_inc_(s jsonb, p_path text[], p_n bigint) returns jsonb language sql immutable as $$
  select jsonb_set(coalesce(s, '{}'::jsonb), p_path, to_jsonb(coalesce((s #>> p_path)::bigint, 0) + p_n), true)
$$;
create or replace function public.city_stats0_(p_day date) returns jsonb language sql immutable as $$
  select jsonb_build_object('d', to_char(p_day, 'YYYY-MM-DD'),
    'mint', jsonb_build_object('grant', 0, 'issue', 0, 'adm', 0), 'burn', jsonb_build_object('cap', 0, 'adm', 0, 'gone', 0),
    'tr', jsonb_build_object('wage', 0, 'g100', 0, 't100', 0, 'food', 0),
    'n', jsonb_build_object('tasks', 0, 'jobs', 0, 'buys', 0, 'caphit', 0, 'tired', 0, 'noslot', 0, 'soon', 0, 'nonce', 0),
    'pt', '{}'::jsonb, 'pn', '{}'::jsonb, 'fs', '{}'::jsonb)
$$;
create or replace function public.city_int_(p jsonb, p_key text) returns int language sql immutable as $$
  select case when jsonb_typeof(p->p_key) = 'number' and (p->>p_key)::numeric = trunc((p->>p_key)::numeric) and abs((p->>p_key)::numeric) < 2000000000
    then (p->>p_key)::int end
$$;
-- Центробанк: новый k по среднему кошельку (то же — Rules.kNext)
create or replace function public.city_knext_(d jsonb, p_k int, p_m int) returns int language plpgsql immutable as $$
declare b jsonb := d->'bank'; r int; n int;
begin
  r := (p_m::bigint * 100 / greatest(1, (b->>'T')::int))::int;
  if r > (b->>'hi2')::int then n := p_k - (b->>'d2')::int;
  elsif r > (b->>'hi1')::int then n := p_k - (b->>'d1')::int;
  elsif r < (b->>'lo2')::int then n := p_k + (b->>'d2')::int;
  elsif r < (b->>'lo1')::int then n := p_k + (b->>'d1')::int;
  elsif p_k > (b->>'k0')::int then n := greatest((b->>'k0')::int, p_k - (b->>'drift')::int);
  else n := least((b->>'k0')::int, p_k + (b->>'drift')::int);
  end if;
  return greatest((b->>'kMin')::int, least((b->>'kMax')::int, n));
end $$;
-- Возраст для города/профессии: 0 — всем; 16 — с 16 лет (teen16, adult); возраст не указан — нельзя. Без age.sql — нельзя
create or replace function public.city_age_ok_(p_uid uuid, p_age int) returns boolean language plpgsql stable security definer set search_path = public as $$
declare g text;
begin
  if coalesce(p_age, 0) <= 0 then return true; end if;
  if to_regprocedure('public.age_group_of(uuid)') is null then return false; end if;
  g := public.age_group_of(p_uid);
  return case when p_age <= 13 then g in ('teen', 'teen16', 'adult') when p_age <= 16 then g in ('teen16', 'adult') else g = 'adult' end;
end $$;
create or replace function public.city_banned_(p_uid uuid) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('public.banned_nicks') is null then return false; end if;
  return exists (select 1 from public.banned_nicks b join public.profiles p on lower(b.nick) = lower(p.nick) where p.id = p_uid);
end $$;
-- Отметки двойников: хеш IP (из заголовков запроса) и случайного ключа браузера (D37Ref.device) — с солью, 30 дней
create or replace function public.city_mark_(p_uid uuid, p_dev text) returns void language plpgsql security definer set search_path = public as $$
declare v_ip text; v_salt text;
begin
  select salt into v_salt from public.city_cfg where id = 1;
  begin
    v_ip := nullif(btrim(split_part(coalesce((current_setting('request.headers', true))::json->>'x-forwarded-for', ''), ',', 1)), '');
  exception when others then v_ip := null;
  end;
  if v_ip is not null then
    insert into public.city_marks (user_id, kind, hash) values (p_uid, 'ip', md5(coalesce(v_salt, '') || ':ip:' || v_ip))
    on conflict (user_id, kind, hash) do update set seen_at = now();
  end if;
  if p_dev ~ '^[A-Za-z0-9_-]{16,64}$' then
    insert into public.city_marks (user_id, kind, hash) values (p_uid, 'dev', md5(coalesce(v_salt, '') || ':dev:' || p_dev))
    on conflict (user_id, kind, hash) do update set seen_at = now();
  end if;
end $$;
-- Человек → JSON (те же поля, что MirEcon.Rules.fresh)
create or replace function public.city_st_(p public.city_people) returns jsonb language sql immutable as $$
  select jsonb_build_object('cash', p.cash, 'frac', p.frac, 'granted', p.granted, 'skills', p.skills, 'xpd', p.xpd,
    'day', to_char(p.day, 'YYYY-MM-DD'), 'wd', p.wd, 'fd', p.fd, 'food', p.food, 'buffs', p.buffs,
    'job', case when p.job is null then null else jsonb_build_object('prof', p.job, 'city', p.job_city, 'mode', p.job_mode, 'place', p.job_place,
      'n', p.task_n, 't', p.task_t, 'k', p.task_k) end,
    'act_t', p.act_t, 'act_n', p.act_n, 'rev', p.rev)
$$;
-- Город → JSON для всех (казна, найм, стройка) — ≤ 1 КБ
create or replace function public.city_pub_(c public.cities, d jsonb) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('city', c.id, 'rev', c.rev, 'treasury', c.treasury, 'reserve', (d->'cities'->c.id->>'reserve')::int,
    'hire', c.treasury > (d->'cities'->c.id->>'reserve')::int, 'site', c.site, 'stage', public.city_stage_(d, c.site), 'units', (d->'site'->>'units')::int,
    'frozen', c.frozen, 'day', to_char(c.day, 'YYYY-MM-DD'), 'wage_k', c.wage_k, 'tax', d->'cities'->c.id->'tax',
    'k', (select b.k from public.city_bank b where b.id = 1), 'v', d->'v', 'cv', d->'cv')
$$;
create or replace function public.city_fail_(p_uid uuid, p_t bigint, p_n int, p_reason text, p_x jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update public.city_people set act_t = p_t, act_n = p_n where user_id = p_uid;
  return jsonb_build_object('ok', false, 'reason', p_reason, 'now', public.city_now()) || coalesce(p_x, '{}'::jsonb);
end $$;

-- ═══ 4. День города: эмиссия, центробанк, потолок казны, уборка, снимок для журнала ═══
-- (вызывать, держа замок строки города: city_lock_ / city_tick_)
create or replace function public.city_settle_(p_city text) returns void language plpgsql security definer set search_path = public as $$
declare
  c public.cities%rowtype; d jsonb := public.city_defs(); v_today date := public.city_today(); v_now bigint := public.city_now();
  b public.city_bank%rowtype; v_n int; v_a7 int; v_people int; v_bud bigint; v_i bigint; v_cap bigint; v_burn bigint := 0; v_m int; v_cnt int;
  v_keep jsonb := d->'keep'; v_snap jsonb;
begin
  select * into c from public.cities where id = p_city;
  if not found or c.day >= v_today then return; end if;
  v_n := least(7, v_today - coalesce(c.day, v_today - 1));
  -- A7: жители, у кого ≥ a7[0] заданий в день хотя бы a7[1] дня из последних 7 (по журналу)
  select count(*) into v_a7 from (
    select q.user_id from (
      select l.user_id, l.day from public.city_ledger l
      where l.city = p_city and l.kind = 'wage' and l.day >= v_today - 7 and l.day < v_today
      group by l.user_id, l.day having count(*) >= (d->'bank'->'a7'->>0)::int) q
    group by q.user_id having count(*) >= (d->'bank'->'a7'->>1)::int) a;
  select count(distinct l.user_id) into v_people from public.city_ledger l where l.city = p_city and l.kind = 'wage' and l.day = c.day;
  -- центробанк — раз в день на оба города
  select * into b from public.city_bank where id = 1 for update;
  if b.day is distinct from v_today then
    select coalesce(avg(p.cash), 0)::int, count(*) into v_m, v_cnt from public.city_people p
      where p.granted and p.seen_at >= v_now - (d->'bank'->>'mDays')::int * 86400;
    b.k := public.city_knext_(d, b.k, v_m); b.m_avg := v_m; b.actives := v_cnt;
    update public.city_bank set k = b.k, m_avg = v_m, actives = v_cnt, day = v_today where id = 1;
  end if;
  -- снимок прошедшего дня (журнал «📊 Экономика города»)
  if c.day is not null then
    v_snap := coalesce(c.stats, '{}'::jsonb) || jsonb_build_object('treasury', c.treasury, 'minted', c.minted, 'burned', c.burned, 'a7', v_a7,
      'k', b.k, 'M', b.m_avg, 'T', (d->'bank'->>'T')::int, 'people', v_people, 'actives', b.actives);
    insert into public.city_days (city, day, stats) values (p_city, c.day, v_snap) on conflict (city, day) do update set stats = excluded.stats;
  end if;
  c.stats := public.city_stats0_(v_today);
  -- эмиссия за пропущенные дни (не больше 7): min(cap, base + per × A7) × k / 1000 в день
  v_bud := least((d->'cities'->p_city->'issue'->>'cap')::bigint, (d->'cities'->p_city->'issue'->>'base')::bigint + (d->'cities'->p_city->'issue'->>'per')::bigint * v_a7);
  v_i := v_bud * b.k / 1000 * v_n;
  if v_i > 0 then
    c.treasury := c.treasury + v_i; c.minted := c.minted + v_i;
    c.stats := public.city_inc_(c.stats, '{mint,issue}', v_i);
    insert into public.city_ledger (user_id, city, amount, bal, kind, ref, at, day) values (null, p_city, v_i, c.treasury, 'issue', v_n || 'd', v_now, v_today);
  end if;
  -- потолок казны: capDays дней эмиссии — лишнее уничтожается
  v_cap := (d->'cities'->p_city->>'capDays')::bigint * v_bud;
  if c.treasury > v_cap then
    v_burn := c.treasury - v_cap;
    c.treasury := v_cap; c.burned := c.burned + v_burn;
    c.stats := public.city_inc_(c.stats, '{burn,cap}', v_burn);
    insert into public.city_ledger (user_id, city, amount, bal, kind, ref, at, day) values (null, p_city, -v_burn::int, c.treasury, 'cap', '', v_now, v_today);
  end if;
  -- уборка (не больше batch строк за раз)
  delete from public.city_ledger where id in (select l.id from public.city_ledger l where l.city = p_city and l.day < v_today - (v_keep->>'ledger')::int limit (v_keep->>'batch')::int);
  if p_city = 'kids' then
    delete from public.city_marks where ctid in (select m.ctid from public.city_marks m where m.seen_at < now() - make_interval(days => (v_keep->>'marks')::int) limit (v_keep->>'batch')::int);
    delete from public.city_contrib where ctid in (select x.ctid from public.city_contrib x where x.last_day < v_today - (v_keep->>'contrib')::int limit (v_keep->>'batch')::int);
  end if;
  update public.cities set treasury = c.treasury, minted = c.minted, burned = c.burned, stats = c.stats, day = v_today, t_tick = v_now, rev = rev + 1
  where id = p_city;
end $$;
-- Замок строки города (по порядку: сначала человек, потом город) + новый день, если наступил
create or replace function public.city_lock_(p_city text) returns setof public.cities language plpgsql security definer set search_path = public as $$
declare c public.cities%rowtype;
begin
  select * into c from public.cities where id = p_city for update;
  if not found then return; end if;
  if c.day is null or c.day < public.city_today() then
    perform public.city_settle_(p_city);
    select * into c from public.cities where id = p_city;
  end if;
  return next c;
end $$;
-- Ленивый «тик» для чтения (city_public): новый день, только если строка свободна (не ждём чужой замок)
create or replace function public.city_tick_(p_city text) returns void language plpgsql security definer set search_path = public as $$
declare v_day date; c public.cities%rowtype;
begin
  select day into v_day from public.cities where id = p_city;
  if v_day is not null and v_day >= public.city_today() then return; end if;
  select * into c from public.cities where id = p_city for update skip locked;
  if not found then return; end if;
  perform public.city_settle_(p_city);
end $$;

-- ═══ 5. Для всех: каталог и город ═══
create or replace function public.city_public(p_city text, p_rev int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.cities%rowtype;
begin
  if p_city is null or p_city not in ('kids', 'metro') then return jsonb_build_object('ok', false, 'reason', 'city'); end if;
  perform public.city_tick_(p_city);
  select * into c from public.cities where id = p_city;
  if not found then return jsonb_build_object('ok', false, 'reason', 'city'); end if;
  if p_rev is not null and p_rev = c.rev then return jsonb_build_object('ok', true, 'same', true, 'rev', c.rev, 'now', public.city_now()); end if;
  return public.city_pub_(c, public.city_defs()) || jsonb_build_object('ok', true, 'now', public.city_now());
end $$;

-- ═══ 6. Своё: кошелёк, навыки, работа, история ═══
create or replace function public.city_state(p_city text default null, p_hist int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); p public.city_people%rowtype; d jsonb; v_h jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  d := public.city_defs();
  select * into p from public.city_people where user_id = v_uid;
  if coalesce(p_hist, 0) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object('a', q.amount, 'f', q.fee, 'b', q.bal, 'k', q.kind, 'r', q.ref, 't', q.at, 'c', q.city) order by q.id desc), '[]'::jsonb) into v_h
    from (select l.* from public.city_ledger l where l.user_id = v_uid order by l.id desc limit least(p_hist, 50)) q;
  end if;
  return jsonb_build_object('ok', true, 'now', public.city_now(), 'v', d->'v', 'cv', d->'cv', 'new', p.user_id is null,
    'st', case when p.user_id is null then '{"cash":0,"frac":0,"granted":false,"skills":{},"xpd":{},"day":null,"wd":0,"fd":0,"food":{},"buffs":{},"job":null,"act_t":0,"act_n":0,"rev":0}'::jsonb
      else public.city_st_(p) end,
    'age', jsonb_build_object('metro', public.city_age_ok_(v_uid, (d->'cities'->'metro'->>'age')::int)),
    'banned', public.city_banned_(v_uid), 'hist', coalesce(v_h, '[]'::jsonb));
end $$;

-- Ход: job {city, prof, mode, place} · quit · task {n} · buy {city, place, item, qty} · eat {item}. Не чаще caps.actMin в минуту.
-- Ответ: {ok, now, st, got, c} или {ok: false, reason, now, wait?, cap?}
create or replace function public.city_act(p_act text, p_a jsonb default '{}'::jsonb, p_dev text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_now bigint := public.city_now(); v_today date := public.city_today(); d jsonb;
  p public.city_people%rowtype; c public.cities%rowtype;
  v_at bigint; v_an int;
  v_city text; v_prof text; v_pr jsonb; v_cc jsonb; v_place text; v_mode text; v_item text; v_g jsonb;
  v_xp int; v_l int; v_l2 int; v_need int; v_nt int; v_room int; v_gr int; v_tx int; v_f int; v_net int; v_q int; v_cost int; v_gift int := 0;
  v_s0 int; v_hire boolean; v_cur jsonb; v_res jsonb; v_week text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_act is null or p_act not in ('job', 'quit', 'task', 'buy', 'eat') then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
  if not exists (select 1 from public.profiles where id = v_uid) then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  p_a := coalesce(p_a, '{}'::jsonb);
  if jsonb_typeof(p_a) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
  d := public.city_defs();
  insert into public.city_people (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into p from public.city_people where user_id = v_uid for update;
  -- частота
  if v_now - p.act_t >= 60 then p.act_t := v_now; p.act_n := 0; end if;
  if p.act_n >= (d->'caps'->>'actMin')::int then return public.city_fail_(v_uid, p.act_t, p.act_n, 'too_fast'); end if;
  p.act_n := p.act_n + 1; v_at := p.act_t; v_an := p.act_n;

  if p_act = 'quit' then
    if p.job is not null then p.job := null; p.job_city := null; p.job_mode := null; p.job_place := null; p.task_n := null; p.rev := p.rev + 1; end if;
    update public.city_people set job = p.job, job_city = p.job_city, job_mode = p.job_mode, job_place = p.job_place, task_n = p.task_n,
      act_t = p.act_t, act_n = p.act_n, rev = p.rev, updated_at = now() where user_id = v_uid;
    return jsonb_build_object('ok', true, 'now', v_now, 'st', public.city_st_(p), 'got', '{}'::jsonb);

  elsif p_act = 'job' then
    v_city := p_a->>'city'; v_cc := d->'cities'->v_city;
    if v_city is null or v_cc is null then return public.city_fail_(v_uid, v_at, v_an, 'city'); end if;
    v_prof := p_a->>'prof'; v_pr := d->'profs'->v_prof;
    if v_prof is null or v_pr is null or coalesce((v_pr->>'ph')::int, 1) > (d->>'v')::int then return public.city_fail_(v_uid, v_at, v_an, 'prof'); end if;
    v_mode := coalesce(p_a->>'mode', 'city');
    if not (coalesce(v_pr->'modes', '["city"]'::jsonb) ? v_mode) then return public.city_fail_(v_uid, v_at, v_an, 'mode'); end if;
    v_place := p_a->>'place';
    if v_place is null or not (coalesce(v_pr->'cities'->v_city, '[]'::jsonb) ? v_place) then return public.city_fail_(v_uid, v_at, v_an, 'args'); end if;
    if not public.city_age_ok_(v_uid, greatest(coalesce((v_cc->>'age')::int, 0), coalesce((v_pr->>'age')::int, 0))) then return public.city_fail_(v_uid, v_at, v_an, 'age'); end if;
    if public.city_banned_(v_uid) then return public.city_fail_(v_uid, v_at, v_an, 'banned'); end if;
    select * into c from public.city_lock_(v_city);
    if c.frozen then return public.city_fail_(v_uid, v_at, v_an, 'frozen'); end if;
    if not p.granted then
      v_gift := (d->>'start')::int; p.granted := true; p.cash := p.cash + v_gift;
      c.minted := c.minted + v_gift; c.stats := public.city_inc_(c.stats, '{mint,grant}', v_gift);
      insert into public.city_ledger (user_id, city, amount, bal, kind, at, day) values (v_uid, v_city, v_gift, p.cash, 'grant', v_now, v_today);
    end if;
    c.stats := public.city_inc_(c.stats, '{n,jobs}', 1);
    p.job := v_prof; p.job_city := v_city; p.job_mode := v_mode; p.job_place := v_place;
    p.task_n := public.city_nonce_(); p.task_t := v_now; p.task_k := least(9, floor(random() * 10)::int);
    p.rev := p.rev + 1; p.seen_at := v_now;
    update public.cities set minted = c.minted, stats = c.stats where id = v_city;
    update public.city_people set cash = p.cash, granted = p.granted, job = p.job, job_city = p.job_city, job_mode = p.job_mode, job_place = p.job_place,
      task_n = p.task_n, task_t = p.task_t, task_k = p.task_k, act_t = p.act_t, act_n = p.act_n, seen_at = p.seen_at, rev = p.rev, updated_at = now()
    where user_id = v_uid;
    perform public.city_mark_(v_uid, p_dev);
    return jsonb_build_object('ok', true, 'now', v_now, 'st', public.city_st_(p), 'got', jsonb_build_object('grant', v_gift), 'c', public.city_pub_(c, d));

  elsif p_act = 'task' then
    if p.job is null then return public.city_fail_(v_uid, v_at, v_an, 'job'); end if;
    v_prof := p.job; v_city := p.job_city; v_pr := d->'profs'->v_prof; v_cc := d->'cities'->v_city;
    if v_pr is null or v_cc is null then return public.city_fail_(v_uid, v_at, v_an, 'prof'); end if;
    select * into c from public.city_lock_(v_city);
    if (p_a->>'n') is distinct from p.task_n then
      update public.cities set stats = public.city_inc_(stats, '{n,nonce}', 1) where id = v_city;
      return public.city_fail_(v_uid, v_at, v_an, 'nonce');
    end if;
    v_xp := coalesce((p.skills->>v_prof)::int, 0); v_l := public.city_lvl_(d, v_xp);
    v_need := ((v_pr->>'min')::int * (d->'skill'->'fast'->>v_l)::int + 99) / 100;
    if v_now - p.task_t < v_need then
      update public.cities set stats = public.city_inc_(stats, '{n,soon}', 1) where id = v_city;
      return public.city_fail_(v_uid, v_at, v_an, 'too_soon', jsonb_build_object('wait', v_need - (v_now - p.task_t)));
    end if;
    if p.day is distinct from v_today then p.day := v_today; p.xpd := '{}'::jsonb; p.wd := 0; p.fd := 0; end if;
    v_nt := coalesce((p.xpd->>v_prof)::int, 0);
    if v_nt >= (d->'caps'->>'half')::int then
      update public.cities set stats = public.city_inc_(stats, '{n,tired}', 1) where id = v_city;
      return public.city_fail_(v_uid, v_at, v_an, 'day_cap', '{"cap":"prof"}'::jsonb);
    end if;
    v_room := (d->'caps'->>'wageDay')::int * 100 - p.wd;
    if v_room <= 0 then
      update public.cities set stats = public.city_inc_(stats, '{n,caphit}', 1) where id = v_city;
      return public.city_fail_(v_uid, v_at, v_an, 'day_cap', '{"cap":"wage"}'::jsonb);
    end if;
    if c.frozen then return public.city_fail_(v_uid, v_at, v_an, 'frozen'); end if;
    -- зарплата в сотых: wage × навык% × (100 + бонус)% × ставка% ; 41–60-е задание — половина; не больше остатка дневного лимита
    v_gr := ((v_pr->>'wage')::bigint * (d->'skill'->'mult'->>v_l)::int * (100 + public.city_buff_(d, p.buffs, v_now)) * c.wage_k / 10000)::int;
    if v_nt >= (d->'caps'->>'full')::int then v_gr := v_gr / 2; end if;
    v_gr := least(v_gr, v_room);
    v_tx := v_gr * (v_cc->'tax'->>'income')::int / 100;
    v_f := p.frac + v_gr - v_tx; v_net := v_f / 100;
    if c.treasury - v_net < (v_cc->>'reserve')::int then
      update public.cities set stats = public.city_inc_(stats, '{n,noslot}', 1) where id = v_city;
      return public.city_fail_(v_uid, v_at, v_an, 'no_slots');
    end if;
    v_hire := c.treasury > (v_cc->>'reserve')::int;
    p.frac := v_f % 100; p.cash := p.cash + v_net; p.wd := p.wd + v_gr;
    p.xpd := jsonb_set(p.xpd, array[v_prof], to_jsonb(v_nt + 1), true);
    p.skills := jsonb_set(p.skills, array[v_prof], to_jsonb(v_xp + 1), true);
    c.treasury := c.treasury - v_net;
    if (c.treasury > (v_cc->>'reserve')::int) <> v_hire then c.rev := c.rev + 1; end if;
    if coalesce((v_pr->>'site')::int, 0) = 1 then
      v_s0 := public.city_stage_(d, c.site); c.site := c.site + 1;
      if public.city_stage_(d, c.site) <> v_s0 then c.rev := c.rev + 1; end if;
    end if;
    c.stats := public.city_inc_(public.city_inc_(public.city_inc_(public.city_inc_(c.stats, '{n,tasks}', 1), '{tr,wage}', v_net), '{tr,g100}', v_gr), '{tr,t100}', v_tx);
    c.stats := public.city_inc_(public.city_inc_(c.stats, array['pt', v_prof], 1), array['pn', v_prof], v_net);
    insert into public.city_ledger (user_id, city, amount, fee, bal, kind, ref, at, day) values (v_uid, v_city, v_net, v_tx, p.cash, 'wage', v_prof, v_now, v_today);
    v_week := to_char(v_today, 'IYYY-IW');
    insert into public.city_contrib as x (city, user_id, week, pts, days, last_day) values (v_city, v_uid, v_week, 1, 1, v_today)
    on conflict (city, user_id, week) do update set pts = x.pts + 1, days = x.days + case when x.last_day is distinct from excluded.last_day then 1 else 0 end, last_day = excluded.last_day;
    v_l2 := public.city_lvl_(d, v_xp + 1);
    p.task_n := public.city_nonce_(); p.task_t := v_now; p.task_k := least(9, floor(random() * 10)::int);
    p.rev := p.rev + 1; p.seen_at := v_now;
    update public.cities set treasury = c.treasury, site = c.site, stats = c.stats, rev = c.rev where id = v_city;
    update public.city_people set cash = p.cash, frac = p.frac, wd = p.wd, xpd = p.xpd, skills = p.skills, day = p.day, fd = p.fd,
      task_n = p.task_n, task_t = p.task_t, task_k = p.task_k, act_t = p.act_t, act_n = p.act_n, seen_at = p.seen_at, rev = p.rev, updated_at = now()
    where user_id = v_uid;
    return jsonb_build_object('ok', true, 'now', v_now, 'st', public.city_st_(p),
      'got', jsonb_build_object('net', v_net, 'g100', v_gr, 't100', v_tx, 'xp', 1, 'lvl', v_l2, 'up', v_l2 > v_l, 'tired', v_nt + 1 >= (d->'caps'->>'full')::int),
      'c', public.city_pub_(c, d));

  elsif p_act = 'buy' then
    v_city := p_a->>'city'; v_cc := d->'cities'->v_city;
    if v_city is null or v_cc is null then return public.city_fail_(v_uid, v_at, v_an, 'city'); end if;
    v_place := p_a->>'place'; v_item := p_a->>'item'; v_g := d->'goods'->v_item;
    if v_place is null or v_item is null or v_g is null or not (coalesce(v_cc->'shops'->v_place, '[]'::jsonb) ? v_item) then return public.city_fail_(v_uid, v_at, v_an, 'args'); end if;
    v_q := case when p_a ? 'qty' then public.city_int_(p_a, 'qty') else 1 end;
    if v_q is null or v_q < 1 or v_q > (d->'caps'->>'qtyMax')::int then return public.city_fail_(v_uid, v_at, v_an, 'args'); end if;
    if not public.city_age_ok_(v_uid, coalesce((v_cc->>'age')::int, 0)) then return public.city_fail_(v_uid, v_at, v_an, 'age'); end if;
    if public.city_banned_(v_uid) then return public.city_fail_(v_uid, v_at, v_an, 'banned'); end if;
    select * into c from public.city_lock_(v_city);
    if c.frozen then return public.city_fail_(v_uid, v_at, v_an, 'frozen'); end if;
    if p.day is distinct from v_today then p.day := v_today; p.xpd := '{}'::jsonb; p.wd := 0; p.fd := 0; end if;
    if p.fd + v_q > (d->'caps'->>'foodDay')::int then return public.city_fail_(v_uid, v_at, v_an, 'day_cap', '{"cap":"food"}'::jsonb); end if;
    if coalesce((p.food->>v_item)::int, 0) + v_q > (d->'caps'->>'foodHold')::int then return public.city_fail_(v_uid, v_at, v_an, 'full'); end if;
    v_cost := public.city_price_(d, v_item) * v_q;
    v_gift := case when p.granted then 0 else (d->>'start')::int end;
    if p.cash + v_gift < v_cost then return public.city_fail_(v_uid, v_at, v_an, 'cash', jsonb_build_object('need', v_cost)); end if;
    if v_gift > 0 then
      p.granted := true; p.cash := p.cash + v_gift;
      c.minted := c.minted + v_gift; c.stats := public.city_inc_(c.stats, '{mint,grant}', v_gift);
      insert into public.city_ledger (user_id, city, amount, bal, kind, at, day) values (v_uid, v_city, v_gift, p.cash, 'grant', v_now, v_today);
    end if;
    p.cash := p.cash - v_cost; p.fd := p.fd + v_q;
    p.food := jsonb_set(p.food, array[v_item], to_jsonb(coalesce((p.food->>v_item)::int, 0) + v_q), true);
    v_hire := c.treasury > (v_cc->>'reserve')::int;
    c.treasury := c.treasury + v_cost;
    if (c.treasury > (v_cc->>'reserve')::int) <> v_hire then c.rev := c.rev + 1; end if;
    c.stats := public.city_inc_(public.city_inc_(public.city_inc_(c.stats, '{tr,food}', v_cost), '{n,buys}', 1), array['fs', v_item], v_q);
    insert into public.city_ledger (user_id, city, amount, bal, kind, ref, at, day) values (v_uid, v_city, -v_cost, p.cash, 'food', v_item, v_now, v_today);
    p.rev := p.rev + 1; p.seen_at := v_now;
    update public.cities set treasury = c.treasury, minted = c.minted, stats = c.stats, rev = c.rev where id = v_city;
    update public.city_people set cash = p.cash, granted = p.granted, food = p.food, fd = p.fd, day = p.day, xpd = p.xpd, wd = p.wd,
      act_t = p.act_t, act_n = p.act_n, seen_at = p.seen_at, rev = p.rev, updated_at = now() where user_id = v_uid;
    return jsonb_build_object('ok', true, 'now', v_now, 'st', public.city_st_(p), 'got', jsonb_build_object('cost', v_cost, 'grant', v_gift), 'c', public.city_pub_(c, d));

  else   -- eat
    v_item := p_a->>'item'; v_g := d->'goods'->v_item;
    if v_item is null or v_g is null or v_g->'buff' is null then return public.city_fail_(v_uid, v_at, v_an, 'args'); end if;
    if coalesce((p.food->>v_item)::int, 0) <= 0 then return public.city_fail_(v_uid, v_at, v_an, 'none'); end if;
    p.food := case when (p.food->>v_item)::int <= 1 then p.food - v_item else jsonb_set(p.food, array[v_item], to_jsonb((p.food->>v_item)::int - 1)) end;
    v_cur := p.buffs->'food';
    if not (v_cur is not null and coalesce((v_cur->>'u')::bigint, 0) > v_now and coalesce((v_cur->>'p')::int, 0) > (v_g->'buff'->>0)::int) then
      p.buffs := jsonb_set(coalesce(p.buffs, '{}'::jsonb), '{food}', jsonb_build_object('p', (v_g->'buff'->>0)::int, 'u', v_now + (v_g->'buff'->>1)::int * 60), true);
    end if;
    p.rev := p.rev + 1; p.seen_at := v_now;
    update public.city_people set food = p.food, buffs = p.buffs, act_t = p.act_t, act_n = p.act_n, seen_at = p.seen_at, rev = p.rev, updated_at = now()
    where user_id = v_uid;
    return jsonb_build_object('ok', true, 'now', v_now, 'st', public.city_st_(p), 'got', jsonb_build_object('p', (p.buffs->'food'->>'p')::int, 'u', (p.buffs->'food'->>'u')::bigint));
  end if;
end $$;

-- ═══ 7. Админ: журнал «📊 Экономика города», настройки «⚙️», проверка сохранения, двойники, пауза, поправка казны ═══
-- Читать (log, sum, twins, audit, cfg без set) — admin и moderator; менять (cfg set, grant, freeze) — только admin.
create or replace function public.city_admin(p_act text, p_a jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_role text; d jsonb; v_res jsonb; v_city text; v_n bigint; v_days int; r record; c public.cities%rowtype;
  v_data jsonb; v_set jsonb; v_key text; v_val jsonb; v_today date := public.city_today(); v_now bigint := public.city_now(); v_who uuid;
  v_rows int := 0; v_breaks int := 0; v_prev bigint; v_last bigint; v_cash bigint;
begin
  select role into v_role from public.profiles where id = v_uid;
  if v_uid is null or v_role is null or v_role not in ('admin', 'moderator') then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  p_a := coalesce(p_a, '{}'::jsonb);
  d := public.city_defs();
  if p_act = 'sum' then
    select jsonb_build_object('ok', true, 'cash', coalesce((select sum(cash) from public.city_people), 0), 'people', (select count(*) from public.city_people where granted),
      'treasury', coalesce((select sum(treasury) from public.cities), 0), 'minted', coalesce((select sum(minted) from public.cities), 0),
      'burned', coalesce((select sum(burned) from public.cities), 0)) into v_res;
    return v_res || jsonb_build_object('drift', (v_res->>'cash')::bigint + (v_res->>'treasury')::bigint - (v_res->>'minted')::bigint + (v_res->>'burned')::bigint);
  elsif p_act = 'log' then
    v_days := least(90, greatest(1, coalesce(public.city_int_(p_a, 'days'), 30)));
    return jsonb_build_object('ok', true, 'now', v_now, 'today', to_char(v_today, 'YYYY-MM-DD'),
      'bank', (select jsonb_build_object('k', b.k, 'M', b.m_avg, 'actives', b.actives, 'day', to_char(b.day, 'YYYY-MM-DD'), 'T', (d->'bank'->>'T')::int) from public.city_bank b where b.id = 1),
      'cities', (select jsonb_object_agg(x.id, jsonb_build_object('treasury', x.treasury, 'minted', x.minted, 'burned', x.burned, 'frozen', x.frozen, 'site', x.site,
          'reserve', (d->'cities'->x.id->>'reserve')::int, 'day', to_char(x.day, 'YYYY-MM-DD'), 'today', x.stats)) from public.cities x),
      'days', coalesce((select jsonb_agg(jsonb_build_object('c', y.city, 'd', to_char(y.day, 'YYYY-MM-DD'), 's', y.stats) order by y.day desc, y.city)
          from public.city_days y where y.day >= v_today - v_days), '[]'::jsonb));
  elsif p_act = 'twins' then
    -- аккаунты с общим IP или браузером за 30 дней; ники детей и тех, кто не указал возраст, не показываем
    return jsonb_build_object('ok', true, 'list', coalesce((
      select jsonb_agg(jsonb_build_object('kind', m.kind, 'h', left(m.hash, 6), 'n', m.n, 'acc', (
        select jsonb_agg(jsonb_build_object('id', left(u.uid::text, 8),
          'nick', case when to_regprocedure('public.age_group_of(uuid)') is not null and public.age_group_of(u.uid) in ('teen', 'teen16', 'adult') then (select pr.nick from public.profiles pr where pr.id = u.uid) end,
          'cash', coalesce((select cp.cash from public.city_people cp where cp.user_id = u.uid), 0),
          'w7', coalesce((select sum(l.amount) from public.city_ledger l where l.user_id = u.uid and l.kind = 'wage' and l.day >= v_today - 7), 0)))
        from unnest(m.us) u(uid))) order by m.n desc)
      from (select mk.kind, mk.hash, array_agg(distinct mk.user_id) us, count(distinct mk.user_id) n from public.city_marks mk
            where mk.seen_at > now() - interval '30 days' group by mk.kind, mk.hash having count(distinct mk.user_id) > 1 order by count(distinct mk.user_id) desc limit 30) m), '[]'::jsonb));
  elsif p_act = 'audit' then
    begin v_who := (p_a->>'uid')::uuid; exception when others then v_who := null; end;
    if v_who is null then
      select p.user_id into v_who from public.city_people p where left(p.user_id::text, 8) = left(coalesce(p_a->>'uid', ''), 8) limit 1;
    end if;
    if v_who is null then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
    for r in select l.amount, l.bal from (select * from public.city_ledger where user_id = v_who order by id desc limit 500) l order by l.id loop
      if v_prev is not null and v_prev + r.amount <> r.bal then v_breaks := v_breaks + 1; end if;
      v_prev := r.bal; v_rows := v_rows + 1;
    end loop;
    select cash into v_cash from public.city_people where user_id = v_who;
    return jsonb_build_object('ok', true, 'id', left(v_who::text, 8), 'rows', v_rows, 'breaks', v_breaks, 'cash', coalesce(v_cash, 0), 'last', v_prev,
      'match', v_prev is null or v_prev = coalesce(v_cash, 0));
  elsif p_act = 'cfg' then
    if p_a ? 'set' then
      if v_role <> 'admin' then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
      v_set := p_a->'set';
      if jsonb_typeof(v_set) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
      select data into v_data from public.city_cfg where id = 1 for update;
      for v_key, v_val in select e.key, e.value from jsonb_each(v_set) e loop
        if not public.city_cfgok_(public.city_defs0(), v_key, v_val) then return jsonb_build_object('ok', false, 'reason', 'args', 'key', v_key); end if;
        if jsonb_typeof(v_val) = 'null' then v_data := v_data - v_key; else v_data := v_data || jsonb_build_object(v_key, v_val); end if;
      end loop;
      update public.city_cfg set data = v_data, rev = rev + 1, updated_at = now(),
        hist = (select coalesce(jsonb_agg(h.e order by h.o), '[]'::jsonb) from (select e, o from jsonb_array_elements(jsonb_build_array(jsonb_build_object('at', v_now, 'by', left(v_uid::text, 8), 'set', v_set)) || hist) with ordinality q(e, o) order by o limit 30) h)
      where id = 1;
      update public.cities set rev = rev + 1;
    end if;
    return (select jsonb_build_object('ok', true, 'data', x.data, 'rev', x.rev, 'hist', x.hist, 'base', public.city_defs0(), 'defs', public.city_defs()) from public.city_cfg x where x.id = 1);
  elsif p_act in ('grant', 'freeze') then
    if v_role <> 'admin' then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
    v_city := p_a->>'city';
    if v_city is null or v_city not in ('kids', 'metro') then return jsonb_build_object('ok', false, 'reason', 'city'); end if;
    select * into c from public.city_lock_(v_city);
    if p_act = 'freeze' then
      update public.cities set frozen = coalesce((p_a->>'on')::boolean, false), rev = rev + 1 where id = v_city;
      return jsonb_build_object('ok', true, 'frozen', coalesce((p_a->>'on')::boolean, false));
    end if;
    v_n := public.city_int_(p_a, 'n');
    if v_n is null or v_n = 0 or abs(v_n) > 1000000 then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
    if c.treasury + v_n < 0 then return jsonb_build_object('ok', false, 'reason', 'treasury'); end if;
    c.treasury := c.treasury + v_n;
    if v_n > 0 then c.minted := c.minted + v_n; c.stats := public.city_inc_(c.stats, '{mint,adm}', v_n);
    else c.burned := c.burned - v_n; c.stats := public.city_inc_(c.stats, '{burn,adm}', -v_n); end if;
    insert into public.city_ledger (user_id, city, amount, bal, kind, ref, at, day) values (null, v_city, v_n, c.treasury, 'adm', left(coalesce(p_a->>'why', ''), 60), v_now, v_today);
    update public.cities set treasury = c.treasury, minted = c.minted, burned = c.burned, stats = c.stats, rev = rev + 1 where id = v_city;
    return jsonb_build_object('ok', true, 'treasury', c.treasury);
  elsif p_act = 'mayor' then
    return jsonb_build_object('ok', false, 'reason', 'sv');   -- мэр — фаза P6
  end if;
  return jsonb_build_object('ok', false, 'reason', 'args');
end $$;

-- ═══ 8. Удалили аккаунт — его денки уничтожены (иначе сумма не сойдётся) ═══
create or replace function public.city_people_gone_() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.cash > 0 then
    update public.cities set burned = burned + old.cash, stats = public.city_inc_(stats, '{burn,gone}', old.cash) where id = coalesce(old.job_city, 'kids');
  end if;
  return old;
end $$;
drop trigger if exists city_people_gone on public.city_people;
create trigger city_people_gone before delete on public.city_people for each row execute function public.city_people_gone_();

-- ═══ 9. Начальные строки: настройки, центробанк, казна городов (стартовая казна — «выпущено») ═══
insert into public.city_cfg (id) values (1) on conflict (id) do nothing;
insert into public.city_bank (id, k) values (1, (public.city_defs0()->'bank'->>'k0')::int) on conflict (id) do nothing;
insert into public.cities (id, treasury, minted, day, stats)
  select e.key, (e.value->>'seed')::bigint, (e.value->>'seed')::bigint, public.city_today(), public.city_stats0_(public.city_today())
  from jsonb_each(public.city_defs0()->'cities') e
on conflict (id) do nothing;

-- ═══ 10. Права ═══
revoke execute on function public.city_now() from public, anon, authenticated;
revoke execute on function public.city_today() from public, anon, authenticated;
revoke execute on function public.city_defs0() from public, anon, authenticated;
revoke execute on function public.city_cfgok_(jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function public.city_lvl_(jsonb, int) from public, anon, authenticated;
revoke execute on function public.city_stage_(jsonb, int) from public, anon, authenticated;
revoke execute on function public.city_buff_(jsonb, jsonb, bigint) from public, anon, authenticated;
revoke execute on function public.city_price_(jsonb, text) from public, anon, authenticated;
revoke execute on function public.city_nonce_() from public, anon, authenticated;
revoke execute on function public.city_inc_(jsonb, text[], bigint) from public, anon, authenticated;
revoke execute on function public.city_stats0_(date) from public, anon, authenticated;
revoke execute on function public.city_int_(jsonb, text) from public, anon, authenticated;
revoke execute on function public.city_knext_(jsonb, int, int) from public, anon, authenticated;
revoke execute on function public.city_age_ok_(uuid, int) from public, anon, authenticated;
revoke execute on function public.city_banned_(uuid) from public, anon, authenticated;
revoke execute on function public.city_mark_(uuid, text) from public, anon, authenticated;
revoke execute on function public.city_st_(public.city_people) from public, anon, authenticated;
revoke execute on function public.city_pub_(public.cities, jsonb) from public, anon, authenticated;
revoke execute on function public.city_fail_(uuid, bigint, int, text, jsonb) from public, anon, authenticated;
revoke execute on function public.city_settle_(text) from public, anon, authenticated;
revoke execute on function public.city_lock_(text) from public, anon, authenticated;
revoke execute on function public.city_tick_(text) from public, anon, authenticated;
revoke execute on function public.city_people_gone_() from public, anon, authenticated;
revoke execute on function public.city_defs() from public;
revoke execute on function public.city_public(text, int) from public;
revoke execute on function public.city_state(text, int) from public, anon;
revoke execute on function public.city_act(text, jsonb, text) from public, anon;
revoke execute on function public.city_admin(text, jsonb) from public, anon;
grant execute on function public.city_defs() to anon, authenticated;
grant execute on function public.city_public(text, int) to anon, authenticated;
grant execute on function public.city_state(text, int) to authenticated;
grant execute on function public.city_act(text, jsonb, text) to authenticated;
grant execute on function public.city_admin(text, jsonb) to authenticated;
