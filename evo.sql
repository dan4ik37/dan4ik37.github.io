-- ═══════════════════════════════════════════════════════════════════
--  «ПУТЬ ОТ МИКРОБА» (Вселенная Денчика) — род игрока на сервере. Шаг 1 — «Клетка» (T-056, docs/plans/universe-path.md §1.2, §0, прил. A).
--  Стадия клетки: ДНК (за день — не больше caps.day по Москве, за жизнь — не больше caps.rate в минуту по часам сервера: билет start → life),
--  части клетки за ДНК, облик (6 мест на мембране, форма колонии, раскраска), вехи стадий (Клетка → Органоиды → Колония → Готов к суше →
--  На суше), «На сушу» (план тела и питание — шаблон для стадии «Существо»), «Микромир» (кого встретил род), рекорды рода, задание дня,
--  перенос пробного рода из браузера (один раз, не дальше «Колонии»). Сюда же потом (один файл области): существо, разум, виды, находки.
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно (можно запускать ещё раз). Нужны (уже применены): profiles, banned_nicks.
--  Ценное меняется ТОЛЬКО здесь (security definer): клиент шлёт намерения, показывает сразу по тем же правилам (js/games/evo.js → Rules)
--  и сверяется. Каталог evo_defs0() собирает node scripts/gen-evo-defs.cjs из D37Evo.SERVER (руками JSON не править); числа без кода
--  меняет админ: evo_admin('cfg') — ключи из белого списка cfgk. Тест: node scripts/evo-sql-test.mjs (PGlite).
--  Ничего не продаётся: ни ДНК, ни части, ни стадии (красные линии); 🪙 / 💎 / XP отсюда не выдаются — их дают только старые ключи
--  «Клеточек». Обман (свои цифры ДНК в отчёте жизни) упирается в лимиты и вредит только своему роду.
--  Проверка после запуска (publishable-ключ гостем; PGRST202 = функции нет, файл не применён):
--    /rpc/evo_defs → {"v":1,"slots":6,…}; /rpc/evo_state {} → 401 / 42501 (только вошедшим);
--    /rpc/evo_act {"p_act":"start","p_a":{}} → 401 / 42501; /rpc/evo_admin {"p_act":"sum"} → 401 / 42501.
-- ═══════════════════════════════════════════════════════════════════

-- ═══ 1. Таблицы ═══
create table if not exists public.evo_lineage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  slot smallint not null default 0 check (slot between 0 and 3),   -- номер рода (пока один; VIP / донатер +1 — позже, только удобство)
  stage smallint not null default 1 check (stage between 1 and 5), -- 1 Клетка · 2 Органоиды · 3 Колония · 4 Готов к суше · 5 На суше
  dna int not null default 0 check (dna >= 0),                      -- ДНК сейчас
  earned int not null default 0 check (earned >= 0),                -- ДНК получено всего (вехи)
  day date,                                                         -- день счётчиков today / raw (Москва)
  today int not null default 0,                                     -- ДНК в род сегодня (лимит caps.day)
  raw int not null default 0,                                       -- сырой ДНК сегодня («отдохнувший»: первые caps.rest ×2)
  owned jsonb not null default '{}'::jsonb,                         -- купленные части {id: штук}
  design jsonb not null default '{"s":["","","","","",""],"f":"chain","k":{"p":5,"a":"#4ade80","b":"#166534"}}'::jsonb,
  name jsonb not null default '{"a":0,"b":0}'::jsonb,               -- имя рода — номера готовых слов
  home jsonb not null default '{}'::jsonb,                          -- родина рода {id, region, x, z}
  plan text, diet text, land jsonb,                                 -- «На сушу»: план тела, питание, облик и части на тот момент
  play int not null default 0,                                      -- секунд пути (по часам сервера; жизнь — не больше caps.life)
  biomes jsonb not null default '[]'::jsonb,                        -- где род побывал
  col smallint not null default 1,                                  -- самая большая колония
  finds jsonb not null default '[]'::jsonb,                         -- «Микромир»: кого встретил
  rec jsonb not null default '{"mass":0,"life":0,"kills":0,"lives":0}'::jsonb,
  tday date,                                                        -- когда сделано задание дня
  tk text, tt bigint not null default 0, tb text, tc smallint not null default 1,   -- билет жизни: номер, с какого времени, биом, колония облика
  act_t bigint not null default 0, act_n int not null default 0,    -- частота ходов (начало минуты и ходов в ней)
  imported boolean not null default false,                          -- пробный род уже переносили
  awake bigint not null default 0,                                  -- когда открылось «Пробуждение» (временно — с «На сушу», план §0)
  cut int not null default 0,                                       -- сколько сырой ДНК срезали лимиты (для статистики админа)
  realm text not null default 'all',                                -- мир по возрасту (docs/REALMS.md) — на будущее разделение
  rev int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);
create table if not exists public.evo_cfg (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,                          -- настройки админа поверх каталога: {"caps.day": 400, …}
  rev int not null default 0,
  hist jsonb not null default '[]'::jsonb,                          -- последние 30 правок
  updated_at timestamptz not null default now()
);
create table if not exists public.evo_days (
  day date primary key,
  stats jsonb not null default '{}'::jsonb                          -- счётчики дня: жизни, ДНК, срезано, задания, покупки, «на сушу»… (без личных данных)
);
alter table public.evo_lineage enable row level security;
alter table public.evo_cfg enable row level security;
alter table public.evo_days enable row level security;
revoke all on public.evo_lineage, public.evo_cfg, public.evo_days from anon, authenticated;

-- ═══ 2. Часы и каталог ═══
create or replace function public.evo_now() returns bigint language sql stable as $$
  select floor(extract(epoch from now()))::bigint
$$;
create or replace function public.evo_day_(p_now bigint) returns date language sql stable as $$
  select (to_timestamp(p_now) at time zone 'Europe/Moscow')::date
$$;
-- Каталог — КАК D37Evo.SERVER в js/games/evo.js. Собирает node scripts/gen-evo-defs.cjs (--check — сверка)
-- gen:evo-defs:begin
create or replace function public.evo_defs0() returns jsonb language sql immutable as $$
  select '{"v":1,"slots":6,"parts":["flagellum","cilia","eye","leaf","jaw","spikes","photo","adhesion","armour","toxin","pigment"],"biomeIds":["pool","reef","deep"],"cell":{"flagellum":{"cost":25,"slots":1,"at":1,"max":2},"cilia":{"cost":20,"slots":1,"at":1,"max":1},"eye":{"cost":25,"slots":1,"at":1,"max":2},"leaf":{"cost":30,"slots":1,"at":1,"max":3},"jaw":{"cost":40,"slots":1,"at":2,"max":1},"spikes":{"cost":35,"slots":1,"at":2,"max":1},"photo":{"cost":45,"slots":1,"at":2,"max":2},"adhesion":{"cost":60,"slots":1,"at":2,"max":3},"armour":{"cost":50,"slots":2,"at":3,"max":1},"toxin":{"cost":55,"slots":1,"at":3,"max":1},"pigment":{"cost":15,"slots":0,"at":1,"max":1}},"biomes":{"pool":{"at":1,"min":0},"reef":{"at":2,"min":0},"deep":{"at":3,"min":1}},"micro":[["drop","pool"],["green","pool"],["teeth","reef"],["hedge","reef"],["firefly","deep"],["giant","deep"],["spike","any"],["mineral","deep"]],"forms":["chain","ring","wedge"],"plans":["crawler","swimmer","shell"],"diets":["plant","meat","both"],"miles":{"2":{"parts":1},"3":{"earned":250,"colony":3,"min":20},"4":{"earned":550,"colony":5,"min":55,"biomes":["reef","deep"]}},"caps":{"day":300,"rest":60,"actMin":30,"life":330,"minLife":5,"rate":40,"slack":15,"goal":8,"task":25,"mass":50000,"kills":60,"imp":{"earned":400,"dna":300,"play":1500,"col":3}},"tasks":[["pel",60],["life",150],["mass",150],["kills",2],["pel",100],["mass",250]],"names":[24,24],"patterns":10,"homes":[{"id":"pond","region":"mir","x":38,"z":34},{"id":"zerk","region":"mir","x":-890,"z":-750},{"id":"tihoe","region":"mir","x":1115,"z":700},{"id":"gornoe","region":"mir","x":-1550,"z":-2150},{"id":"bystraya","region":"mir","x":-900,"z":-1100},{"id":"svetlaya","region":"mir","x":820,"z":1400},{"id":"sea","region":"mir","x":-1200,"z":70}],"awake":1,"cfgk":[["caps.day",0,5000],["caps.rest",0,1000],["caps.actMin",5,300],["caps.rate",1,1000],["caps.slack",0,500],["caps.task",0,500],["caps.goal",0,100],["cell.*.cost",0,5000],["miles.3.earned",0,100000],["miles.3.min",0,600],["miles.4.earned",0,100000],["miles.4.min",0,600],["awake",0,1]]}'::jsonb
$$;
-- gen:evo-defs:end
-- Ключ настройки из белого списка (cfgk) и целое число в его пределах (то же — D37Evo.cfgOk)
create or replace function public.evo_cfgok_(p_base jsonb, p_key text, p_val jsonb) returns boolean language plpgsql immutable as $$
declare k text[]; r jsonb; pat text[]; i int; m boolean; v numeric;
begin
  if p_key is null or p_key !~ '^[a-zA-Z0-9_.]{1,60}$' then return false; end if;
  k := string_to_array(p_key, '.');
  if jsonb_typeof(p_base #> k) is distinct from 'number' then return false; end if;
  if p_val is null or jsonb_typeof(p_val) = 'null' then return true; end if;
  if jsonb_typeof(p_val) <> 'number' then return false; end if;
  v := (p_val #>> '{}')::numeric;
  if v <> trunc(v) then return false; end if;
  for r in select e from jsonb_array_elements(p_base->'cfgk') e loop
    pat := string_to_array(r->>0, '.');
    if array_length(pat, 1) <> array_length(k, 1) then continue; end if;
    m := true;
    for i in 1 .. array_length(k, 1) loop
      if pat[i] <> '*' and pat[i] <> k[i] then m := false; exit; end if;
    end loop;
    if m then return v between (r->>1)::numeric and (r->>2)::numeric; end if;
  end loop;
  return false;
end $$;
-- Каталог с настройками админа (то же — D37Evo.merge) + cv (версия настроек)
create or replace function public.evo_defs() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d jsonb := public.evo_defs0(); r record; v_data jsonb; v_rev int;
begin
  select c.data, c.rev into v_data, v_rev from public.evo_cfg c where c.id = 1;
  for r in select e.key, e.value from jsonb_each(coalesce(v_data, '{}'::jsonb)) e loop
    if public.evo_cfgok_(public.evo_defs0(), r.key, r.value) and jsonb_typeof(r.value) = 'number' then
      d := jsonb_set(d, string_to_array(r.key, '.'), r.value, false);
    end if;
  end loop;
  return d || jsonb_build_object('cv', coalesce(v_rev, 0));
end $$;

-- ═══ 3. Помощники (как D37Evo.Rules) ═══
-- целое число из JSON в пределах (не число, дробь, вне пределов — null); как int() в evo.js
create or replace function public.evo_i_(p jsonb, p_lo bigint, p_hi bigint) returns bigint language sql immutable as $$
  select case when jsonb_typeof(p) = 'number' and (p #>> '{}')::numeric = trunc((p #>> '{}')::numeric)
    and (p #>> '{}')::numeric between p_lo and p_hi then (p #>> '{}')::bigint end
$$;
create or replace function public.evo_nonce_() returns text language sql volatile as $$
  select substr(md5(random()::text || clock_timestamp()::text), 1, 8)
$$;
create or replace function public.evo_inc_(s jsonb, p_key text, p_n bigint) returns jsonb language sql immutable as $$
  select jsonb_set(coalesce(s, '{}'::jsonb), array[p_key], to_jsonb(coalesce((s->>p_key)::bigint, 0) + p_n), true)
$$;
-- раскраска: узор 0…7 (с «Пигментом» — до 9), два цвета #rrggbb → нормальный вид или null (как skinOk)
create or replace function public.evo_skin_(k jsonb, p_pig boolean) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(k) = 'object' and public.evo_i_(k->'p', 0, case when p_pig then 9 else 7 end) is not null
    and jsonb_typeof(k->'a') = 'string' and (k->>'a') ~* '^#[0-9a-f]{6}$' and jsonb_typeof(k->'b') = 'string' and (k->>'b') ~* '^#[0-9a-f]{6}$'
    then jsonb_build_object('p', public.evo_i_(k->'p', 0, 9), 'a', lower(k->>'a'), 'b', lower(k->>'b')) end
$$;
-- облик: '' — можно, иначе причина (args / owned) — как designWhy
create or replace function public.evo_design_why_(d jsonb, p_owned jsonb, p_defs jsonb) returns text language plpgsql immutable as $$
declare n int; i int; j int; q int; id text; nslots int; cov boolean[] := array[false, false, false, false, false, false]; cnt jsonb := '{}'::jsonb; r record;
begin
  n := (p_defs->>'slots')::int;
  if jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'s') is distinct from 'array' or jsonb_array_length(d->'s') <> n then return 'args'; end if;
  if jsonb_typeof(d->'f') is distinct from 'string' or not (p_defs->'forms' ? (d->>'f')) then return 'args'; end if;
  for i in 0 .. n - 1 loop
    if jsonb_typeof(d->'s'->i) is distinct from 'string' then return 'args'; end if;
    id := d->'s'->>i;
    if id = '' or id = '=' then continue; end if;
    if not (p_defs->'cell' ? id) then return 'args'; end if;
    nslots := (p_defs->'cell'->id->>'slots')::int;
    if nslots < 1 then return 'args'; end if;
    for j in 1 .. nslots - 1 loop
      q := (i + j) % n;
      if (d->'s'->>q) is distinct from '=' or cov[q + 1] then return 'args'; end if;
      cov[q + 1] := true;
    end loop;
    cnt := public.evo_inc_(cnt, id, 1);
  end loop;
  for i in 0 .. n - 1 loop
    if (d->'s'->>i) = '=' and not cov[i + 1] then return 'args'; end if;
  end loop;
  for r in select e.key, (e.value #>> '{}')::int v from jsonb_each(cnt) e loop
    if r.v > coalesce((p_owned->>r.key)::int, 0) or r.v > (p_defs->'cell'->r.key->>'max')::int then return 'owned'; end if;
  end loop;
  if public.evo_skin_(d->'k', coalesce((p_owned->>'pigment')::int, 0) > 0) is null then return 'args'; end if;
  return '';
end $$;
-- колония облика: 1 + 2 за каждую «Липкость» на мембране, не больше 7 (как capacity)
create or replace function public.evo_cap_(d jsonb) returns int language sql immutable as $$
  select least(7, 1 + 2 * coalesce((select count(*) from jsonb_array_elements_text(case when jsonb_typeof(d->'s') = 'array' then d->'s' else '[]'::jsonb end) e where e = 'adhesion'), 0))::int
$$;
-- разных купленных частей с местом на мембране (веха «Органоиды»)
create or replace function public.evo_parts_(p_owned jsonb, p_defs jsonb) returns int language sql immutable as $$
  select count(*)::int from jsonb_each(p_defs->'cell') c where (c.value->>'slots')::int > 0 and coalesce((p_owned->>c.key)::int, 0) > 0
$$;
-- стадия по вехам (не опускается; 5 — только «На сушу») — как stageOf
create or replace function public.evo_stage_(p_defs jsonb, p public.evo_lineage) returns int language plpgsql immutable as $$
declare m jsonb := p_defs->'miles'; s int := 1;
begin
  if p.stage >= 5 then return 5; end if;
  if public.evo_parts_(p.owned, p_defs) >= (m->'2'->>'parts')::int then s := 2; end if;
  if s = 2 and p.earned >= (m->'3'->>'earned')::int and p.col >= (m->'3'->>'colony')::int and p.play >= (m->'3'->>'min')::int * 60 then s := 3; end if;
  if s = 3 and p.earned >= (m->'4'->>'earned')::int and p.col >= (m->'4'->>'colony')::int and p.play >= (m->'4'->>'min')::int * 60
     and not exists (select 1 from jsonb_array_elements_text(m->'4'->'biomes') b where not (p.biomes ? b)) then s := 4; end if;
  return greatest(p.stage, s);
end $$;
-- род → JSON (те же поля, что D37Evo.Rules.fresh)
create or replace function public.evo_st_(p public.evo_lineage) returns jsonb language sql immutable as $$
  select jsonb_build_object('stage', p.stage, 'dna', p.dna, 'earned', p.earned, 'day', to_char(p.day, 'YYYY-MM-DD'), 'today', p.today, 'raw', p.raw,
    'owned', p.owned, 'design', p.design, 'name', p.name, 'home', p.home, 'plan', p.plan, 'diet', p.diet, 'land', p.land, 'play', p.play,
    'biomes', p.biomes, 'col', p.col, 'finds', p.finds, 'rec', p.rec, 'tday', to_char(p.tday, 'YYYY-MM-DD'), 'tk', p.tk, 'tt', p.tt, 'tb', p.tb, 'tc', p.tc,
    'act_t', p.act_t, 'act_n', p.act_n, 'imported', p.imported, 'awake', p.awake, 'cut', p.cut, 'rev', p.rev)
$$;
create or replace function public.evo_banned_(p_uid uuid) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('public.banned_nicks') is null then return false; end if;
  return exists (select 1 from public.banned_nicks b join public.profiles p on lower(b.nick) = lower(p.nick) where p.id = p_uid);
end $$;
-- новый род: родина — по номеру аккаунта (у каждого своя, у всех одинаково)
create or replace function public.evo_home_(p_uid uuid, p_defs jsonb) returns jsonb language sql immutable as $$
  select p_defs->'homes'->(abs(hashtext(p_uid::text)::bigint) % greatest(1, jsonb_array_length(p_defs->'homes')))::int
$$;
create or replace function public.evo_stat_(p_key text, p_n bigint) returns void language plpgsql security definer set search_path = public as $$
declare v_day date := public.evo_day_(public.evo_now());
begin
  if coalesce(p_n, 0) = 0 then return; end if;
  insert into public.evo_days as x (day, stats) values (v_day, jsonb_build_object(p_key, p_n))
  on conflict (day) do update set stats = public.evo_inc_(x.stats, p_key, p_n);
end $$;
-- отказ: запомнить частоту и смену дня (как Rules.act — состояние уходит и при отказе)
create or replace function public.evo_fail_(p public.evo_lineage, p_reason text, p_x jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update public.evo_lineage set act_t = p.act_t, act_n = p.act_n, day = p.day, today = p.today, raw = p.raw where user_id = p.user_id and slot = p.slot;
  return jsonb_build_object('ok', false, 'reason', p_reason, 'now', public.evo_now(), 'st', public.evo_st_(p)) || coalesce(p_x, '{}'::jsonb);
end $$;
-- выполнено ли задание дня этой жизнью (как taskDone)
create or replace function public.evo_task_ok_(t jsonb, p_pel bigint, p_life bigint, p_mass bigint, p_kills bigint, p_col int, p_min bigint, p_dur bigint) returns boolean
language sql immutable as $$
  select case t->>0 when 'pel' then p_pel >= (t->>1)::int when 'life' then least(p_life, p_dur) >= (t->>1)::int when 'mass' then p_mass >= (t->>1)::int
    when 'kills' then p_kills >= (t->>1)::int when 'col' then p_col >= (t->>1)::int when 'min' then p_min >= (t->>1)::int else false end
$$;

-- ═══ 4. Своё: род ═══
create or replace function public.evo_state(p_slot int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); p public.evo_lineage%rowtype; d jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  d := public.evo_defs();
  select * into p from public.evo_lineage where user_id = v_uid and slot = 0;
  if not found then
    p.user_id := v_uid; p.slot := 0; p.stage := 1; p.dna := 0; p.earned := 0; p.today := 0; p.raw := 0; p.owned := '{}'::jsonb;
    p.design := '{"s":["","","","","",""],"f":"chain","k":{"p":5,"a":"#4ade80","b":"#166534"}}'::jsonb; p.name := '{"a":0,"b":0}'::jsonb;
    p.home := public.evo_home_(v_uid, d); p.play := 0; p.biomes := '[]'::jsonb; p.col := 1; p.finds := '[]'::jsonb;
    p.rec := '{"mass":0,"life":0,"kills":0,"lives":0}'::jsonb; p.tt := 0; p.tc := 1; p.act_t := 0; p.act_n := 0; p.imported := false; p.awake := 0; p.cut := 0; p.rev := 0;
    return jsonb_build_object('ok', true, 'new', true, 'now', public.evo_now(), 'v', d->'v', 'cv', d->'cv', 'st', public.evo_st_(p), 'banned', public.evo_banned_(v_uid));
  end if;
  return jsonb_build_object('ok', true, 'new', false, 'now', public.evo_now(), 'v', d->'v', 'cv', d->'cv', 'st', public.evo_st_(p), 'banned', public.evo_banned_(v_uid));
end $$;

-- Ход: start {b} · life {n, s, p, m, g, col, kills, mass, life, pel, seen} · buy {part} · design {d} · name {a, b} · land {plan, diet} · import {st}
-- Ответ: {ok, now, st, got} или {ok: false, reason, now, st}. p_dev — ключ браузера (на будущее: античит T-073), пока не хранится.
create or replace function public.evo_act(p_act text, p_a jsonb default '{}'::jsonb, p_dev text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_now bigint := public.evo_now(); v_today date; d jsonb; c jsonb; p public.evo_lineage%rowtype;
  v_b text; v_id text; v_n bigint; v_x bigint; v_y bigint; v_s0 int; v_why text; v_dur bigint; v_m bigint; v_g bigint;
  v_s bigint; v_p bigint; v_col bigint; v_kills bigint; v_mass bigint; v_life bigint; v_pel bigint;
  v_raw0 bigint; v_raw bigint; v_bonus bigint; v_gain bigint; v_task int := 0; v_ti int; v_c int; v_t jsonb;
  v_earned bigint; v_dna bigint; v_own jsonb; v_spent bigint; v_k text; v_d jsonb; r record; v_imp jsonb; v_pig boolean; v_tow jsonb; v_td jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_act is null or p_act not in ('start', 'life', 'buy', 'design', 'name', 'land', 'import') then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
  if not exists (select 1 from public.profiles where id = v_uid) then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  p_a := coalesce(p_a, '{}'::jsonb);
  if jsonb_typeof(p_a) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
  d := public.evo_defs(); c := d->'caps';
  insert into public.evo_lineage (user_id, slot, home) values (v_uid, 0, public.evo_home_(v_uid, d)) on conflict (user_id, slot) do nothing;
  select * into p from public.evo_lineage where user_id = v_uid and slot = 0 for update;
  -- частота
  if v_now - p.act_t >= 60 then p.act_t := v_now; p.act_n := 0; end if;
  if p.act_n >= (c->>'actMin')::int then perform public.evo_stat_('fast', 1); return public.evo_fail_(p, 'too_fast'); end if;
  p.act_n := p.act_n + 1;
  -- новый день (Москва)
  v_today := public.evo_day_(v_now);
  if p.day is distinct from v_today then p.day := v_today; p.today := 0; p.raw := 0; end if;

  if p_act = 'start' then
    v_b := case when jsonb_typeof(p_a->'b') = 'string' then p_a->>'b' end;
    if v_b is null or not (d->'biomes' ? v_b) then return public.evo_fail_(p, 'args'); end if;
    if p.stage < (d->'biomes'->v_b->>'at')::int then return public.evo_fail_(p, 'locked'); end if;
    p.tk := public.evo_nonce_(); p.tt := v_now; p.tb := v_b; p.tc := public.evo_cap_(p.design); p.rev := p.rev + 1;
    update public.evo_lineage set tk = p.tk, tt = p.tt, tb = p.tb, tc = p.tc, act_t = p.act_t, act_n = p.act_n, day = p.day, today = p.today, raw = p.raw,
      rev = p.rev, updated_at = now() where user_id = v_uid and slot = 0;
    perform public.evo_stat_('starts', 1);
    return jsonb_build_object('ok', true, 'now', v_now, 'st', public.evo_st_(p), 'got', jsonb_build_object('n', p.tk));

  elsif p_act = 'life' then
    if p.tk is null or jsonb_typeof(p_a->'n') is distinct from 'string' or (p_a->>'n') <> p.tk then perform public.evo_stat_('nonce', 1); return public.evo_fail_(p, 'nonce'); end if;
    if public.evo_banned_(v_uid) then return public.evo_fail_(p, 'banned'); end if;
    -- поля жизни: целые 0…1 000 000 (нет поля или null — 0)
    v_s := case when coalesce(jsonb_typeof(p_a->'s'), 'null') = 'null' then 0 else public.evo_i_(p_a->'s', 0, 1000000) end;
    v_p := case when coalesce(jsonb_typeof(p_a->'p'), 'null') = 'null' then 0 else public.evo_i_(p_a->'p', 0, 1000000) end;
    v_m := case when coalesce(jsonb_typeof(p_a->'m'), 'null') = 'null' then 0 else public.evo_i_(p_a->'m', 0, 1000000) end;
    v_g := case when coalesce(jsonb_typeof(p_a->'g'), 'null') = 'null' then 0 else public.evo_i_(p_a->'g', 0, 1000000) end;
    v_col := case when coalesce(jsonb_typeof(p_a->'col'), 'null') = 'null' then 0 else public.evo_i_(p_a->'col', 0, 1000000) end;
    v_kills := case when coalesce(jsonb_typeof(p_a->'kills'), 'null') = 'null' then 0 else public.evo_i_(p_a->'kills', 0, 1000000) end;
    v_mass := case when coalesce(jsonb_typeof(p_a->'mass'), 'null') = 'null' then 0 else public.evo_i_(p_a->'mass', 0, 1000000) end;
    v_life := case when coalesce(jsonb_typeof(p_a->'life'), 'null') = 'null' then 0 else public.evo_i_(p_a->'life', 0, 1000000) end;
    v_pel := case when coalesce(jsonb_typeof(p_a->'pel'), 'null') = 'null' then 0 else public.evo_i_(p_a->'pel', 0, 1000000) end;
    if v_s is null or v_p is null or v_m is null or v_g is null or v_col is null or v_kills is null or v_mass is null or v_life is null or v_pel is null then
      return public.evo_fail_(p, 'args');
    end if;
    v_dur := greatest(0, least(v_now - p.tt, (c->>'life')::int));
    -- ДНК жизни: сахар + белок + 2 × минерал (только где они есть) + цель; не больше rate в минуту жизни (+ slack); «отдохнувший» ×2; лимит дня
    if coalesce((d->'biomes'->p.tb->>'min')::int, 0) = 0 then v_m := 0; end if;
    v_raw0 := v_s + v_p + 2 * v_m + (c->>'goal')::int * least(1, v_g);
    v_raw := least(v_raw0, v_dur * (c->>'rate')::int / 60 + (c->>'slack')::int);
    v_bonus := least(v_raw, greatest(0, (c->>'rest')::int - p.raw));
    v_gain := least(v_raw + v_bonus, greatest(0, (c->>'day')::int - p.today));
    p.raw := p.raw + v_raw; p.today := p.today + v_gain; p.dna := p.dna + v_gain; p.earned := p.earned + v_gain; p.cut := p.cut + (v_raw0 - v_raw);
    if v_dur >= (c->>'minLife')::int then
      p.play := p.play + v_dur;
      if not (p.biomes ? p.tb) then
        p.biomes := coalesce((select jsonb_agg(b order by o) from jsonb_array_elements_text(d->'biomeIds') with ordinality q(b, o) where b = p.tb or p.biomes ? b), '[]'::jsonb);
      end if;
    end if;
    v_c := least(v_col, 7, greatest(p.tc, public.evo_cap_(p.design)))::int;
    if v_c > p.col then p.col := v_c; end if;
    if jsonb_typeof(p_a->'seen') = 'array' then
      if exists (select 1 from jsonb_array_elements(d->'micro') e where (p_a->'seen') ? (e->>0) and (e->>1 = 'any' or e->>1 = p.tb) and not (p.finds ? (e->>0))) then
        p.finds := coalesce((select jsonb_agg(e->>0 order by o) from jsonb_array_elements(d->'micro') with ordinality q(e, o)
          where p.finds ? (e->>0) or ((p_a->'seen') ? (e->>0) and (e->>1 = 'any' or e->>1 = p.tb))), '[]'::jsonb);
      end if;
    end if;
    p.rec := jsonb_build_object('mass', greatest((p.rec->>'mass')::bigint, least(v_mass, (c->>'mass')::int)), 'life', greatest((p.rec->>'life')::bigint, least(v_life, v_dur)),
      'kills', greatest((p.rec->>'kills')::bigint, least(v_kills, (c->>'kills')::int)), 'lives', (p.rec->>'lives')::bigint + 1);
    -- задание дня (одно на всех, по номеру дня; сверх лимита дня)
    v_ti := ((((v_today - date '2026-01-01') % jsonb_array_length(d->'tasks')) + jsonb_array_length(d->'tasks')) % jsonb_array_length(d->'tasks'));
    v_t := d->'tasks'->v_ti;
    if p.tday is distinct from v_today and v_t is not null and public.evo_task_ok_(v_t, v_pel, v_life, v_mass, v_kills, v_c, v_m, v_dur) then
      v_task := (c->>'task')::int; p.dna := p.dna + v_task; p.earned := p.earned + v_task; p.tday := v_today;
    end if;
    v_s0 := p.stage;
    p.stage := public.evo_stage_(d, p);
    p.tk := null; p.rev := p.rev + 1;
    update public.evo_lineage set stage = p.stage, dna = p.dna, earned = p.earned, day = p.day, today = p.today, raw = p.raw, play = p.play, biomes = p.biomes,
      col = p.col, finds = p.finds, rec = p.rec, tday = p.tday, tk = p.tk, cut = p.cut, act_t = p.act_t, act_n = p.act_n, rev = p.rev, updated_at = now()
    where user_id = v_uid and slot = 0;
    insert into public.evo_days as x (day, stats) values (v_today, jsonb_build_object('lives', 1, 'gain', v_gain + v_task, 'raw', v_raw, 'cut', v_raw0 - v_raw, 'task', case when v_task > 0 then 1 else 0 end,
        'up', case when p.stage > v_s0 then 1 else 0 end))
    on conflict (day) do update set stats = public.evo_inc_(public.evo_inc_(public.evo_inc_(public.evo_inc_(public.evo_inc_(public.evo_inc_(x.stats, 'lives', 1), 'gain', v_gain + v_task), 'raw', v_raw),
      'cut', v_raw0 - v_raw), 'task', case when v_task > 0 then 1 else 0 end), 'up', case when p.stage > v_s0 then 1 else 0 end);
    return jsonb_build_object('ok', true, 'now', v_now, 'st', public.evo_st_(p),
      'got', jsonb_build_object('raw', v_raw, 'bonus', v_bonus, 'gain', v_gain, 'cut', v_raw0 - v_raw, 'task', v_task, 'dur', v_dur, 'up', case when p.stage > v_s0 then p.stage else 0 end));

  elsif p_act = 'buy' then
    v_id := case when jsonb_typeof(p_a->'part') = 'string' then p_a->>'part' end;
    if v_id is null or not (d->'cell' ? v_id) then return public.evo_fail_(p, 'args'); end if;
    if p.stage < (d->'cell'->v_id->>'at')::int then return public.evo_fail_(p, 'stage'); end if;
    if coalesce((p.owned->>v_id)::int, 0) >= (d->'cell'->v_id->>'max')::int then return public.evo_fail_(p, 'max'); end if;
    if p.dna < (d->'cell'->v_id->>'cost')::int then return public.evo_fail_(p, 'dna', jsonb_build_object('need', (d->'cell'->v_id->>'cost')::int)); end if;
    p.dna := p.dna - (d->'cell'->v_id->>'cost')::int;
    p.owned := jsonb_set(p.owned, array[v_id], to_jsonb(coalesce((p.owned->>v_id)::int, 0) + 1), true);
    v_s0 := p.stage;
    p.stage := public.evo_stage_(d, p); p.rev := p.rev + 1;
    update public.evo_lineage set dna = p.dna, owned = p.owned, stage = p.stage, act_t = p.act_t, act_n = p.act_n, day = p.day, today = p.today, raw = p.raw,
      rev = p.rev, updated_at = now() where user_id = v_uid and slot = 0;
    perform public.evo_stat_('buys', 1);
    return jsonb_build_object('ok', true, 'now', v_now, 'st', public.evo_st_(p),
      'got', jsonb_build_object('part', v_id, 'cost', (d->'cell'->v_id->>'cost')::int, 'up', case when p.stage > v_s0 then p.stage else 0 end));

  elsif p_act = 'design' then
    v_why := public.evo_design_why_(p_a->'d', p.owned, d);
    if v_why <> '' then return public.evo_fail_(p, v_why); end if;
    p.design := jsonb_build_object('s', p_a->'d'->'s', 'f', p_a->'d'->>'f', 'k', public.evo_skin_(p_a->'d'->'k', coalesce((p.owned->>'pigment')::int, 0) > 0));
    p.rev := p.rev + 1;
    update public.evo_lineage set design = p.design, act_t = p.act_t, act_n = p.act_n, day = p.day, today = p.today, raw = p.raw, rev = p.rev, updated_at = now()
    where user_id = v_uid and slot = 0;
    return jsonb_build_object('ok', true, 'now', v_now, 'st', public.evo_st_(p), 'got', '{}'::jsonb);

  elsif p_act = 'name' then
    v_x := public.evo_i_(p_a->'a', 0, (d->'names'->>0)::int - 1); v_y := public.evo_i_(p_a->'b', 0, (d->'names'->>1)::int - 1);
    if v_x is null or v_y is null then return public.evo_fail_(p, 'args'); end if;
    p.name := jsonb_build_object('a', v_x, 'b', v_y); p.rev := p.rev + 1;
    update public.evo_lineage set name = p.name, act_t = p.act_t, act_n = p.act_n, day = p.day, today = p.today, raw = p.raw, rev = p.rev, updated_at = now()
    where user_id = v_uid and slot = 0;
    return jsonb_build_object('ok', true, 'now', v_now, 'st', public.evo_st_(p), 'got', '{}'::jsonb);

  elsif p_act = 'land' then
    if p.stage <> 4 then return public.evo_fail_(p, 'stage'); end if;
    if jsonb_typeof(p_a->'plan') is distinct from 'string' or not (d->'plans' ? (p_a->>'plan')) or jsonb_typeof(p_a->'diet') is distinct from 'string' or not (d->'diets' ? (p_a->>'diet')) then
      return public.evo_fail_(p, 'args');
    end if;
    if public.evo_banned_(v_uid) then return public.evo_fail_(p, 'banned'); end if;
    p.stage := 5; p.plan := p_a->>'plan'; p.diet := p_a->>'diet';
    p.land := jsonb_build_object('plan', p.plan, 'diet', p.diet, 'design', p.design, 'owned', p.owned, 'at', v_now);
    if coalesce((d->>'awake')::int, 0) = 1 then p.awake := v_now; end if;
    p.rev := p.rev + 1;
    update public.evo_lineage set stage = p.stage, plan = p.plan, diet = p.diet, land = p.land, awake = p.awake, act_t = p.act_t, act_n = p.act_n, day = p.day,
      today = p.today, raw = p.raw, rev = p.rev, updated_at = now() where user_id = v_uid and slot = 0;
    perform public.evo_stat_('lands', 1);
    return jsonb_build_object('ok', true, 'now', v_now, 'st', public.evo_st_(p), 'got', jsonb_build_object('awake', coalesce((d->>'awake')::int, 0) = 1));

  else   -- import: пробный род из браузера — один раз, в пустой род, не дальше «Колонии» (как Rules.act 'import')
    if p.imported then return public.evo_fail_(p, 'done'); end if;
    if p.earned > 0 or p.play > 0 then return public.evo_fail_(p, 'has'); end if;
    v_imp := case when jsonb_typeof(p_a->'st') = 'object' then p_a->'st' else '{}'::jsonb end;
    -- как sanitize(): купленное — только целые в пределах max (иначе не переносится)
    v_tow := '{}'::jsonb;
    for r in select q.k, (d->'cell'->q.k->>'max')::int mx from jsonb_array_elements_text(d->'parts') with ordinality q(k, o) order by o loop
      v_x := case when jsonb_typeof(v_imp->'owned') = 'object' then public.evo_i_(v_imp->'owned'->r.k, 0, r.mx) end;
      if coalesce(v_x, 0) > 0 then v_tow := v_tow || jsonb_build_object(r.k, v_x); end if;
    end loop;
    v_pig := coalesce((v_tow->>'pigment')::int, 0) > 0;
    v_td := case when public.evo_design_why_(v_imp->'design', v_tow, d) = ''
      then jsonb_build_object('s', v_imp->'design'->'s', 'f', v_imp->'design'->>'f', 'k', public.evo_skin_(v_imp->'design'->'k', v_pig))
      else '{"s":["","","","","",""],"f":"chain","k":{"p":5,"a":"#4ade80","b":"#166534"}}'::jsonb end;
    v_earned := least(coalesce(public.evo_i_(v_imp->'earned', 0, 2000000000), 0), (c->'imp'->>'earned')::int);
    v_dna := least(coalesce(public.evo_i_(v_imp->'dna', 0, 2000000000), 0), (c->'imp'->>'dna')::int, v_earned);
    -- купленное — не дороже потраченного (earned − остаток): лишнее с конца каталога не переносится
    v_own := '{}'::jsonb; v_spent := 0;
    for r in select q.k from jsonb_array_elements_text(d->'parts') with ordinality q(k, o) order by o loop
      v_n := least(coalesce((v_tow->>r.k)::int, 0), (d->'cell'->r.k->>'max')::int);
      if v_n > 0 and (d->'cell'->r.k->>'at')::int <= 3 then v_own := v_own || jsonb_build_object(r.k, v_n); v_spent := v_spent + v_n * (d->'cell'->r.k->>'cost')::int; end if;
    end loop;
    for r in select q.k from jsonb_array_elements_text(d->'parts') with ordinality q(k, o) order by o desc loop
      while coalesce((v_own->>r.k)::int, 0) > 0 and v_spent > v_earned - v_dna loop
        v_spent := v_spent - (d->'cell'->r.k->>'cost')::int;
        if (v_own->>r.k)::int <= 1 then v_own := v_own - r.k; else v_own := jsonb_set(v_own, array[r.k], to_jsonb((v_own->>r.k)::int - 1)); end if;
      end loop;
    end loop;
    p.earned := v_earned; p.dna := v_dna; p.owned := v_own;
    p.play := least(coalesce(public.evo_i_(v_imp->'play', 0, 2000000000), 0), (c->'imp'->>'play')::int);
    p.col := greatest(1, least(greatest(1, least(7, coalesce(public.evo_i_(v_imp->'col', 0, 2000000000), 1))), (c->'imp'->>'col')::int));
    p.finds := coalesce((select jsonb_agg(e->>0 order by o) from jsonb_array_elements(d->'micro') with ordinality q(e, o)
      where jsonb_typeof(v_imp->'finds') = 'array' and (v_imp->'finds') ? (e->>0)), '[]'::jsonb);
    p.rec := jsonb_build_object('mass', coalesce(public.evo_i_(v_imp->'rec'->'mass', 0, (c->>'mass')::int), 0), 'life', coalesce(public.evo_i_(v_imp->'rec'->'life', 0, 1000000), 0),
      'kills', coalesce(public.evo_i_(v_imp->'rec'->'kills', 0, 10000), 0), 'lives', coalesce(public.evo_i_(v_imp->'rec'->'lives', 0, 1000000000), 0));
    p.name := case when public.evo_i_(v_imp->'name'->'a', 0, (d->'names'->>0)::int - 1) is not null and public.evo_i_(v_imp->'name'->'b', 0, (d->'names'->>1)::int - 1) is not null
      then jsonb_build_object('a', (v_imp->'name'->>'a')::int, 'b', (v_imp->'name'->>'b')::int) else '{"a":0,"b":0}'::jsonb end;
    p.design := case when public.evo_design_why_(v_td, v_own, d) = '' then v_td
      else jsonb_build_object('s', '["","","","","",""]'::jsonb, 'f', v_td->>'f', 'k', coalesce(public.evo_skin_(v_td->'k', coalesce((v_own->>'pigment')::int, 0) > 0), '{"p":5,"a":"#4ade80","b":"#166534"}'::jsonb)) end;
    p.biomes := '[]'::jsonb; p.stage := 1;
    p.stage := least(3, public.evo_stage_(d, p));
    p.biomes := coalesce((select jsonb_agg(b order by o) from jsonb_array_elements_text(d->'biomeIds') with ordinality q(b, o)
      where jsonb_typeof(v_imp->'biomes') = 'array' and (v_imp->'biomes') ? b and (d->'biomes'->b->>'at')::int <= p.stage), '[]'::jsonb);
    p.imported := true; p.rev := p.rev + 1;
    update public.evo_lineage set earned = p.earned, dna = p.dna, owned = p.owned, play = p.play, col = p.col, finds = p.finds, rec = p.rec, name = p.name,
      design = p.design, biomes = p.biomes, stage = p.stage, imported = true, act_t = p.act_t, act_n = p.act_n, day = p.day, today = p.today, raw = p.raw,
      rev = p.rev, updated_at = now() where user_id = v_uid and slot = 0;
    perform public.evo_stat_('imports', 1);
    return jsonb_build_object('ok', true, 'now', v_now, 'st', public.evo_st_(p), 'got', jsonb_build_object('earned', v_earned, 'dna', v_dna));
  end if;
end $$;

-- ═══ 5. Админ: сводка, дни, настройки чисел ═══
-- Читать (sum, days, cfg без set) — admin и moderator; менять (cfg set) — только admin.
create or replace function public.evo_admin(p_act text, p_a jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_set jsonb; v_data jsonb; v_key text; v_val jsonb; v_days int;
begin
  select role into v_role from public.profiles where id = v_uid;
  if v_uid is null or v_role is null or v_role not in ('admin', 'moderator') then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  p_a := coalesce(p_a, '{}'::jsonb);
  if p_act = 'sum' then
    return jsonb_build_object('ok', true, 'now', public.evo_now(), 'lineages', (select count(*) from public.evo_lineage),
      'stages', coalesce((select jsonb_object_agg(s.stage, s.n) from (select stage, count(*) n from public.evo_lineage group by stage) s), '{}'::jsonb),
      'dna', coalesce((select sum(dna) from public.evo_lineage), 0), 'earned', coalesce((select sum(earned) from public.evo_lineage), 0),
      'cut', coalesce((select sum(cut) from public.evo_lineage), 0), 'awake', (select count(*) from public.evo_lineage where awake > 0),
      'today', coalesce((select stats from public.evo_days where day = public.evo_day_(public.evo_now())), '{}'::jsonb));
  elsif p_act = 'days' then
    v_days := least(90, greatest(1, coalesce(public.evo_i_(p_a->'days', 1, 90), 30)::int));
    return jsonb_build_object('ok', true, 'days', coalesce((select jsonb_agg(jsonb_build_object('d', to_char(x.day, 'YYYY-MM-DD'), 's', x.stats) order by x.day desc)
      from public.evo_days x where x.day >= public.evo_day_(public.evo_now()) - v_days), '[]'::jsonb));
  elsif p_act = 'cfg' then
    if p_a ? 'set' then
      if v_role <> 'admin' then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
      v_set := p_a->'set';
      if jsonb_typeof(v_set) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
      insert into public.evo_cfg (id) values (1) on conflict (id) do nothing;
      select data into v_data from public.evo_cfg where id = 1 for update;
      for v_key, v_val in select e.key, e.value from jsonb_each(v_set) e loop
        if not public.evo_cfgok_(public.evo_defs0(), v_key, v_val) then return jsonb_build_object('ok', false, 'reason', 'args', 'key', v_key); end if;
        if jsonb_typeof(v_val) = 'null' then v_data := v_data - v_key; else v_data := v_data || jsonb_build_object(v_key, v_val); end if;
      end loop;
      update public.evo_cfg set data = v_data, rev = rev + 1, updated_at = now(),
        hist = (select coalesce(jsonb_agg(h.e order by h.o), '[]'::jsonb) from (select e, o from jsonb_array_elements(jsonb_build_array(jsonb_build_object('at', public.evo_now(), 'by', left(v_uid::text, 8), 'set', v_set)) || hist) with ordinality q(e, o) order by o limit 30) h)
      where id = 1;
    end if;
    return (select jsonb_build_object('ok', true, 'data', x.data, 'rev', x.rev, 'hist', x.hist, 'base', public.evo_defs0(), 'defs', public.evo_defs()) from public.evo_cfg x where x.id = 1);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'args');
end $$;

-- ═══ 6. Начальные строки ═══
insert into public.evo_cfg (id) values (1) on conflict (id) do nothing;

-- ═══ 7. Права ═══
revoke execute on function public.evo_now() from public, anon, authenticated;
revoke execute on function public.evo_day_(bigint) from public, anon, authenticated;
revoke execute on function public.evo_defs0() from public, anon, authenticated;
revoke execute on function public.evo_cfgok_(jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function public.evo_i_(jsonb, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.evo_nonce_() from public, anon, authenticated;
revoke execute on function public.evo_inc_(jsonb, text, bigint) from public, anon, authenticated;
revoke execute on function public.evo_skin_(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.evo_design_why_(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.evo_cap_(jsonb) from public, anon, authenticated;
revoke execute on function public.evo_parts_(jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.evo_stage_(jsonb, public.evo_lineage) from public, anon, authenticated;
revoke execute on function public.evo_st_(public.evo_lineage) from public, anon, authenticated;
revoke execute on function public.evo_banned_(uuid) from public, anon, authenticated;
revoke execute on function public.evo_home_(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.evo_stat_(text, bigint) from public, anon, authenticated;
revoke execute on function public.evo_fail_(public.evo_lineage, text, jsonb) from public, anon, authenticated;
revoke execute on function public.evo_task_ok_(jsonb, bigint, bigint, bigint, bigint, int, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.evo_defs() from public;
revoke execute on function public.evo_state(int) from public, anon;
revoke execute on function public.evo_act(text, jsonb, text) from public, anon;
revoke execute on function public.evo_admin(text, jsonb) from public, anon;
grant execute on function public.evo_defs() to anon, authenticated;
grant execute on function public.evo_state(int) to authenticated;
grant execute on function public.evo_act(text, jsonb, text) to authenticated;
grant execute on function public.evo_admin(text, jsonb) to authenticated;
