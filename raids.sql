-- ═══════════════════════════════════════════════════════════════════
--  НАБЕГИ ⚔️ — нападения на ВОЕННЫЕ БАЗЫ боевой зоны «Мира Денчика» (docs/RAIDS.md; игра — js/games/raid.js; бой —
--  api/_lib/raid-sim.js). Выполнить целиком в Supabase → SQL Editor ПОСЛЕ bases.sql (военные базы: war_bases, war_members,
--  war_defs() с правилами набегов) и premium.sql. Идемпотентно (можно запускать ещё раз). Нужны: bases.sql, premium.sql
--  (premium_add), coins.sql (монеты — через base_pay_ из bases.sql), pgcrypto (в Supabase — схема extensions).
--  notifications.sql — желательно (🔔), нет — молчит.
--
--  Как устроено (честно, «без обходов»):
--   • Нападает БАЗА: её армия (war_bases.army — тренируют главарь и офицеры через war_act), в бой ведёт кто-то из состава —
--     главарь и офицеры (или все, если главарь разрешил: war_bases.raid_rank = 'soldier'). Армия общая — один набег базы за раз.
--     Возраст 12+ — и здесь (war_age_ok).
--   • raid_start: лимиты дня (у человека — бои и поиски; у базы — разбойники, добыча, потери), подбор базы-соперника, СНИМОК
--     её построек и доли добычи, замок (уникальные индексы: один активный набег у человека, у базы-нападающего и на базу-
--     защитника), зерно и жетон HMAC (секрет — raid_secret, его не видит никто). Армия уходит в бой (war_bases.army_out).
--   • raid_go — первая высадка или конец разведки (не позже raid.go с начала). Дальше уход = поражение.
--   • Итог присылает НЕ браузер: браузер шлёт ввод на /api/raid, сервер сайта прогоняет тот же бой (api/_lib/raid-sim.js)
--     и зовёт raid_settle — её можно вызвать только с ключом service_role. Добыча — в казну базы нападающих, по долям из
--     снимка и потолкам; кубки, щит, лиги — у баз; журнал, 🔔 всему составу базы-защитника — одной транзакцией; второй
--     вызов отдаёт тот же итог.
--   • Просрочки: не начал бой за raid.cancel — отмена (армия назад, замок снят); начал и не сдал за бой + raid.grace —
--     поражение (0★, армия потрачена). Чистит любой следующий вызов (raid_expire_).
--   • Твинки: хеши IP и устройства людей (сырой IP не храним) за 30 дней; если в базе-сопернике есть «похожий» на нападающего —
--     такую базу не подбираем, бой с ней — без добычи и кубков.
--   • За 💎 — только время и красота (щит базы, облики, ускорения). Силы за деньги нет (вторая казарма — постройка со штаба 3).
--  Цифры — war_defs()->'raid' (bases.sql = js/games/mir-base.js RAID; формулы = RaidSim.offer / settle / trophies — тест PGlite).
--  Проверка после запуска: /rpc/raid_state гостем → {"ok":false,"reason":"auth"} (PGRST202 — не применён); /rpc/raid_settle
--  гостем → отказ в правах; /rpc/raid_top {"p_kind":"all"} → [] или список баз.
-- ═══════════════════════════════════════════════════════════════════

-- ═══ 1. Таблицы ═══
create table if not exists public.raid_secret (id int primary key default 1 check (id = 1), s text not null);
insert into public.raid_secret (id, s) values (1, encode(extensions.gen_random_bytes(32), 'hex')) on conflict (id) do nothing;
alter table public.raid_secret enable row level security;   -- политик нет: читают только функции этого файла
revoke all on public.raid_secret from public, anon, authenticated;

-- Человек: счётчики дня (бои, поиски), учебный, облики армии, пропущенные «Следующим» базы, когда открывал набеги
create table if not exists public.raid_profile (user_id uuid primary key references public.profiles(id) on delete cascade);
alter table public.raid_profile add column if not exists seen_at bigint not null default 0;        -- открыт экран набегов (подбор)
alter table public.raid_profile add column if not exists day date;                                 -- день счётчиков (МСК)
alter table public.raid_profile add column if not exists n_battle int not null default 0;
alter table public.raid_profile add column if not exists n_search int not null default 0;
alter table public.raid_profile add column if not exists tut boolean not null default false;        -- награда за учебный — получена
alter table public.raid_profile add column if not exists skins text[] not null default '{}';        -- купленные облики армии: army:<id>
alter table public.raid_profile add column if not exists army_skin text not null default '';
alter table public.raid_profile add column if not exists skip_b int[] not null default '{}';        -- пропущенные «Следующим» базы (на час)
alter table public.raid_profile add column if not exists skip_at bigint not null default 0;
alter table public.raid_profile enable row level security;   -- политик нет: читают и пишут функции

-- База: защита новичка, стража, щит за 💎, счётчики дня (разбойники, добыча, потери), поход, неделя, итоги, облики базы
create table if not exists public.raid_base (base_id int primary key references public.war_bases(id) on delete cascade);
alter table public.raid_base add column if not exists newbie_until bigint not null default 0;   -- защита новой базы (секунды эпохи)
alter table public.raid_base add column if not exists guard_until bigint not null default 0;    -- стража после слабого набега
alter table public.raid_base add column if not exists shield_buy bigint not null default 0;     -- когда покупали щит
alter table public.raid_base add column if not exists day date;
alter table public.raid_base add column if not exists n_bot int not null default 0;             -- набегов на разбойников с добычей
alter table public.raid_base add column if not exists loot_day int not null default 0;          -- взято у баз сегодня
alter table public.raid_base add column if not exists loss_day int not null default 0;          -- потеряно в набегах сегодня
alter table public.raid_base add column if not exists camp jsonb not null default '{}'::jsonb;  -- {"1": 3, …} лучшие звёзды похода
alter table public.raid_base add column if not exists week text not null default '';
alter table public.raid_base add column if not exists week_stars int not null default 0;
alter table public.raid_base add column if not exists week_wins int not null default 0;
alter table public.raid_base add column if not exists chest_week text not null default '';
alter table public.raid_base add column if not exists wins int not null default 0;
alter table public.raid_base add column if not exists losses int not null default 0;
alter table public.raid_base add column if not exists def_won int not null default 0;
alter table public.raid_base add column if not exists def_lost int not null default 0;
alter table public.raid_base add column if not exists best_tr int not null default 0;
alter table public.raid_base add column if not exists skins text[] not null default '{}';       -- купленные облики базы: skin:<id>
alter table public.raid_base enable row level security;
revoke all on public.raid_base from anon, authenticated;

create table if not exists public.raids (
  id text primary key,
  attacker uuid not null references public.profiles(id) on delete cascade,   -- кто вёл армию
  mode text not null,                                  -- find | revenge | bot | camp | tut
  status text not null default 'active',               -- active | done | canceled | expired
  seed int not null,
  started_at bigint not null,
  deadline bigint not null
);
alter table public.raids add column if not exists att_base int references public.war_bases(id) on delete set null;   -- база нападающих
alter table public.raids add column if not exists def_base int references public.war_bases(id) on delete set null;   -- база-защитник
alter table public.raids add column if not exists att_info jsonb;                              -- {k, n, c} — имя и цвет базы на начало
alter table public.raids add column if not exists def_info jsonb;                              -- {k, n, c, nick} — и ник главаря
alter table public.raids add column if not exists lvl int;                                     -- разбойники: 0 учебный, 1…12 поход, 101…105 под штаб
alter table public.raids add column if not exists variant int not null default 0;
alter table public.raids add column if not exists snap jsonb;                                  -- снимок базы-защитника {layout, base}
alter table public.raids add column if not exists offer jsonb;                                 -- что можно взять {st, mn, total, …}
alter table public.raids add column if not exists army jsonb not null default '{}'::jsonb;     -- взяли в бой
alter table public.raids add column if not exists hero int not null default 0;                 -- уровень героя (штаб нападающих)
alter table public.raids add column if not exists att_th int not null default 1;
alter table public.raids add column if not exists def_th int not null default 1;
alter table public.raids add column if not exists att_tr int not null default 0;
alter table public.raids add column if not exists def_tr int not null default 0;
alter table public.raids add column if not exists att_skin text not null default '';
alter table public.raids add column if not exists def_skin text not null default '';
alter table public.raids add column if not exists go_at bigint;
alter table public.raids add column if not exists result jsonb;
alter table public.raids add column if not exists inputs jsonb;
alter table public.raids add column if not exists ver int;
alter table public.raids add column if not exists dv text;                                     -- md5 каталога на начало (повтор: те же цифры?)
alter table public.raids add column if not exists revenge_of text;
alter table public.raids add column if not exists revenged boolean not null default false;
alter table public.raids add column if not exists created_at timestamptz not null default now();
drop index if exists public.uq_raids_active_def;   -- прошлая версия (защитник — человек)
create unique index if not exists uq_raids_active_att on public.raids (attacker) where status = 'active';
create unique index if not exists uq_raids_active_abase on public.raids (att_base) where status = 'active' and att_base is not null and mode <> 'tut';
create unique index if not exists uq_raids_active_dbase on public.raids (def_base) where status = 'active' and def_base is not null;
create index if not exists idx_raids_dbase on public.raids (def_base, created_at desc);
create index if not exists idx_raids_abase on public.raids (att_base, created_at desc);
create index if not exists idx_raids_att on public.raids (attacker, created_at desc);
create index if not exists idx_raids_due on public.raids (deadline) where status = 'active';
alter table public.raids enable row level security;   -- политик нет: читать — raid_state, raid_replay

-- Отметки «кто с какого IP / устройства» — только хеши, 30 дней
create table if not exists public.raid_marks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  hash text not null,
  seen_at bigint not null,
  primary key (user_id, kind, hash)
);
create index if not exists idx_raid_marks_hash on public.raid_marks (kind, hash);
alter table public.raid_marks enable row level security;

-- ═══ 2. Помощники (внутренние: клиенту закрыты) ═══
create or replace function public.raid_week(p_now bigint) returns text language sql immutable as $$
  select to_char(to_timestamp(p_now) at time zone 'Europe/Moscow', 'IYYY-"W"IW')
$$;
create or replace function public.raid_league(p_tr int) returns int language sql immutable as $$
  select greatest(0, (select count(*)::int from jsonb_array_elements_text(public.war_defs()->'raid'->'league') v where coalesce(p_tr, 0) >= v::int) - 1)
$$;
create or replace function public.raid_token_(p_id text, p_uid uuid, p_seed int, p_t bigint) returns text
language sql stable security definer set search_path = public as $$
  select encode(extensions.hmac(p_id || ':' || p_uid::text || ':' || p_seed::text || ':' || p_t::text, (select s from public.raid_secret where id = 1), 'sha256'), 'hex')
$$;
-- Защищено от набега: штаб + склады (как RaidSim.offer)
create or replace function public.raid_prot_(p_l jsonb) returns int language sql immutable as $$
  select (public.war_defs()->'raid'->'loot'->'prot'->>(public.base_th(p_l) - 1))::int
    + coalesce((select sum((public.war_defs()->'raid'->'loot'->'sprot'->>(least((e->>'l')::int, jsonb_array_length(public.war_defs()->'raid'->'loot'->'sprot')) - 1))::int)
        from jsonb_array_elements(coalesce(p_l, '[]'::jsonb)) e where e->>'k' = 'store' and (e->>'l')::int >= 1), 0)::int
$$;
-- Что можно взять (снимок на начало): st — доли казны (штаб и склады), mn — производства (карьеры, заводы). Как RaidSim.offer
create or replace function public.raid_offer_(p_l jsonb, p_bricks int, p_att_th int, p_now bigint) returns jsonb
language plpgsql immutable as $$
declare
  R jsonb := public.war_defs()->'raid'->'loot'; K jsonb := public.war_defs()->'k';
  v_dth int := public.base_th(p_l); v_prot int := public.raid_prot_(p_l); v_free int; v_pct int; v_pool int;
  v_st jsonb := '{}'::jsonb; v_mn jsonb := '{}'::jsonb; v_th jsonb; v_ths int; v_rest int; v_sum int; v_n int; v_given int := 0;
  v_v int; v_e jsonb; v_first text := null; v_total int := 0; v_room int;
begin
  v_free := greatest(0, coalesce(p_bricks, 0) - v_prot);
  v_pct := case when p_att_th > v_dth then greatest((R->>'min')::int, (R->>'pct')::int - (R->>'step')::int * (p_att_th - v_dth)) else (R->>'pct')::int end;
  v_pool := least((R->'cap'->>(v_dth - 1))::int, v_free * v_pct / 100);
  select e into v_th from jsonb_array_elements(coalesce(p_l, '[]'::jsonb)) e where e->>'k' = 'th' limit 1;
  if v_th is not null and v_pool > 0 then
    select count(*)::int, coalesce(sum((K->'store'->'keep'->>((e->>'l')::int - 1))::int), 0)::int into v_n, v_sum
      from jsonb_array_elements(p_l) e where e->>'k' = 'store' and (e->>'l')::int >= 1;
    v_ths := case when v_n > 0 then v_pool * (R->>'th')::int / 100 else v_pool end;
    if v_ths > 0 then v_st := jsonb_build_object(v_th->>'i', v_ths); end if;
    v_rest := v_pool - v_ths;
    for v_e in select e from jsonb_array_elements(p_l) e where e->>'k' = 'store' and (e->>'l')::int >= 1 order by (e->>'i')::int loop
      if v_first is null then v_first := v_e->>'i'; end if;
      v_v := v_rest * (K->'store'->'keep'->>((v_e->>'l')::int - 1))::int / v_sum;
      if v_v > 0 then v_st := v_st || jsonb_build_object(v_e->>'i', v_v); end if;
      v_given := v_given + v_v;
    end loop;
    if v_first is not null and v_rest - v_given > 0 then
      v_st := v_st || jsonb_build_object(v_first, coalesce((v_st->>v_first)::int, 0) + v_rest - v_given);
    end if;
  end if;
  v_room := greatest(0, (R->'cap'->>(v_dth - 1))::int - v_pool);   -- потолок за набег — казна и производство вместе
  for v_e in select e from jsonb_array_elements(coalesce(p_l, '[]'::jsonb)) e where K->(e->>'k') ? 'rate' order by (e->>'i')::int loop
    v_v := least(v_room, public.war_prod(v_e, p_now) * (R->>'mine')::int / 100); v_room := v_room - v_v;
    if v_v > 0 then v_mn := v_mn || jsonb_build_object(v_e->>'i', v_v); end if;
  end loop;
  v_total := coalesce((select sum(value::int) from jsonb_each_text(v_st)), 0) + coalesce((select sum(value::int) from jsonb_each_text(v_mn)), 0);
  return jsonb_build_object('th', v_dth, 'prot', v_prot, 'pct', v_pct, 'pool', v_pool, 'st', v_st, 'mn', v_mn, 'total', v_total);
end $$;
-- Кубки: win — за 3★ (меньше звёзд — доля, вверх), lose — за поражение. Как RaidSim.trophies
create or replace function public.raid_trophies_(p_att int, p_def int, p_stars int) returns jsonb language plpgsql immutable as $$
declare T jsonb := public.war_defs()->'raid'->'tr'; v_win int; v_lose int;
begin
  v_win := least((T->>'wmax')::int, greatest((T->>'wmin')::int, (T->>'win')::int + (coalesce(p_def, 0) - coalesce(p_att, 0)) / (T->>'wdiv')::int));
  v_lose := least((T->>'lmax')::int, greatest((T->>'lmin')::int, (T->>'lose')::int + (coalesce(p_att, 0) - coalesce(p_def, 0)) / (T->>'ldiv')::int));
  return jsonb_build_object('win', v_win, 'lose', v_lose, 'delta', case when p_stars > 0 then (v_win * p_stars + 2) / 3 else -v_lose end);
end $$;
-- Человек: создать; новый день по МСК — счётчики с нуля
create or replace function public.raid_prof_(p_uid uuid, p_now bigint) returns public.raid_profile
language plpgsql security definer set search_path = public as $$
declare v public.raid_profile%rowtype;
begin
  insert into public.raid_profile (user_id) values (p_uid) on conflict (user_id) do nothing;
  select * into v from public.raid_profile where user_id = p_uid for update;
  if v.day is distinct from public.base_today() then
    update public.raid_profile set day = public.base_today(), n_battle = 0, n_search = 0 where user_id = p_uid returning * into v;
  end if;
  return v;
end $$;
-- База: создать (новая — под защитой новичка); новый день — счётчики дня с нуля; новая неделя — недельные
create or replace function public.raid_bprof_(p_base int, p_now bigint) returns public.raid_base
language plpgsql security definer set search_path = public as $$
declare v public.raid_base%rowtype; v_born bigint;
begin
  select floor(extract(epoch from b.created_at))::bigint into v_born from public.war_bases b where b.id = p_base;
  insert into public.raid_base (base_id, newbie_until) values (p_base, coalesce(v_born, p_now) + ((public.war_defs()->'raid'->'shield'->>'newbie')::int * 86400))
    on conflict (base_id) do nothing;
  select * into v from public.raid_base where base_id = p_base for update;
  if v.day is distinct from public.base_today() then
    update public.raid_base set day = public.base_today(), n_bot = 0, loot_day = 0, loss_day = 0 where base_id = p_base returning * into v;
  end if;
  if v.week <> public.raid_week(p_now) then
    update public.raid_base set week = public.raid_week(p_now), week_stars = 0, week_wins = 0 where base_id = p_base returning * into v;
  end if;
  return v;
end $$;
-- Отметки IP (из заголовков запроса) и устройства — только хеши
create or replace function public.raid_mark_(p_uid uuid, p_dev text, p_ip text, p_now bigint) returns void
language plpgsql security definer set search_path = public as $$
declare hdr json; ip text := btrim(coalesce(p_ip, ''));
begin
  if ip = '' then
    begin hdr := nullif(current_setting('request.headers', true), '')::json; exception when others then hdr := null; end;
    ip := btrim(coalesce(hdr ->> 'cf-connecting-ip', hdr ->> 'x-real-ip', split_part(coalesce(hdr ->> 'x-forwarded-for', ''), ',', 1), ''));
  end if;
  if ip <> '' then
    insert into public.raid_marks values (p_uid, 'ip', md5('d37raid:ip:' || ip), p_now) on conflict (user_id, kind, hash) do update set seen_at = excluded.seen_at;
  end if;
  if coalesce(p_dev, '') ~ '^[A-Za-z0-9_-]{8,64}$' then
    insert into public.raid_marks values (p_uid, 'dev', md5('d37raid:dev:' || p_dev), p_now) on conflict (user_id, kind, hash) do update set seen_at = excluded.seen_at;
  end if;
  delete from public.raid_marks where user_id = p_uid and seen_at < p_now - 30 * 86400;
end $$;
-- «Похожие» аккаунты: общий IP или устройство за 30 дней
create or replace function public.raid_alt_(p_a uuid, p_b uuid, p_now bigint) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.raid_marks a join public.raid_marks b on b.kind = a.kind and b.hash = a.hash
    where a.user_id = p_a and b.user_id = p_b and a.seen_at > p_now - 30 * 86400 and b.seen_at > p_now - 30 * 86400)
$$;
-- В базе p_base есть «похожий» на p_uid (не он сам)
create or replace function public.raid_alt_base_(p_uid uuid, p_base int, p_now bigint) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.war_members m where m.base_id = p_base and m.user_id <> p_uid and public.raid_alt_(p_uid, m.user_id, p_now))
$$;
-- {отряд: n} + {отряд: n}; минус — не ниже нуля, нули убираются
create or replace function public.raid_army_add_(p_a jsonb, p_b jsonb, p_sign int) returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, n) filter (where n > 0), '{}'::jsonb) from (
    select k, greatest(0, coalesce((p_a->>k)::int, 0) + p_sign * coalesce((p_b->>k)::int, 0)) n
    from (select jsonb_object_keys(coalesce(p_a, '{}'::jsonb)) k union select jsonb_object_keys(coalesce(p_b, '{}'::jsonb))) ks) s
$$;
create or replace function public.raid_notify_(p_user uuid, p_actor uuid, p_title text, p_body text, p_link text, p_dedupe text) returns void
language plpgsql security definer set search_path = public as $$
begin
  begin perform public.notify(p_user, 'raid', p_actor, p_title, p_body, p_link, p_dedupe); exception when others then null; end;
end $$;
-- 🔔 всему составу базы
create or replace function public.raid_notify_base_(p_base int, p_actor uuid, p_title text, p_body text, p_link text, p_dedupe text) returns void
language plpgsql security definer set search_path = public as $$
declare v_u uuid;
begin
  for v_u in select m.user_id from public.war_members m where m.base_id = p_base limit 40 loop
    perform public.raid_notify_(v_u, p_actor, p_title, p_body, p_link, p_dedupe);
  end loop;
end $$;
-- Закрыть набег без боя (отмена) или поражением (просрочка после начала боя)
create or replace function public.raid_close_(p_id text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.raids%rowtype; v_now bigint := public.base_now(); T jsonb; v_lose int;
begin
  select * into v from public.raids where id = p_id and status = 'active' for update;
  if not found then return; end if;
  if p_status = 'canceled' then
    if v.mode <> 'tut' and v.att_base is not null then
      update public.war_bases set army = public.raid_army_add_(army, v.army, 1), army_out = public.raid_army_add_(army_out, v.army, -1), rev = rev + 1 where id = v.att_base;
    end if;
    update public.raids set status = 'canceled', result = jsonb_build_object('canceled', true) where id = p_id;
    return;
  end if;
  -- просрочка после начала боя: поражение, армия потрачена
  if v.mode <> 'tut' and v.att_base is not null then
    update public.war_bases set army_out = public.raid_army_add_(army_out, v.army, -1), rev = rev + 1 where id = v.att_base;
  end if;
  v_lose := 0;
  if v.mode in ('find', 'revenge') and v.def_base is not null then
    T := public.raid_trophies_(v.att_tr, v.def_tr, 0); v_lose := (T->>'lose')::int;
    if v.att_base is not null then
      update public.war_bases set trophies = greatest(0, trophies - v_lose) where id = v.att_base;
      perform public.raid_bprof_(v.att_base, v_now);
      update public.raid_base set losses = losses + 1 where base_id = v.att_base;
    end if;
    update public.war_bases set trophies = trophies + v_lose, rev = rev + 1 where id = v.def_base;
    perform public.raid_bprof_(v.def_base, v_now);
    update public.raid_base set def_won = def_won + 1 where base_id = v.def_base;
  end if;
  update public.raids set status = 'expired', result = jsonb_build_object('stars', 0, 'pct', 0, 'expired', true, 'tr', -v_lose, 'loot', 0) where id = p_id;
end $$;
-- Просроченные: свои (нападающий, своя база нападает или защищается) и до 20 любых (чтобы замки не висели)
create or replace function public.raid_expire_(p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_now bigint := public.base_now(); r record; c int := (public.war_defs()->'raid'->>'cancel')::int; v_b int;
begin
  select m.base_id into v_b from public.war_members m where m.user_id = p_uid;
  for r in select id, go_at from public.raids where status = 'active'
      and ((go_at is null and started_at + c < v_now) or (go_at is not null and deadline < v_now))
      and (p_uid is null or attacker = p_uid or (v_b is not null and (att_base = v_b or def_base = v_b)))
    union select id, go_at from (select id, go_at from public.raids where status = 'active'
      and ((go_at is null and started_at + c < v_now) or (go_at is not null and deadline < v_now)) order by deadline limit 20) q loop
    perform public.raid_close_(r.id, case when r.go_at is null then 'canceled' else 'expired' end);
  end loop;
end $$;

-- ═══ 3. Для сайта ═══
-- Всё для экрана «⚔️ Набеги»: своя база (имя, звание, можно ли водить армию), кубки, лига, щит, счётчики дня, поход, облики,
-- неделя, активный набег (с жетоном — свой; чужой из состава — кто и когда), журнал защиты базы и набегов базы
create or replace function public.raid_state(p_dev text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_now bigint := public.base_now(); v_m public.war_members%rowtype; v_b public.war_bases%rowtype;
  v_p public.raid_profile%rowtype; v_pb public.raid_base%rowtype; v_r jsonb := public.war_defs()->'raid'; v_th int; v_act jsonb; v_bact jsonb; v_l int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth', 'now', v_now); end if;
  perform public.raid_expire_(v_uid);
  select * into v_m from public.war_members where user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'reason', 'none', 'now', v_now, 'age', public.war_age_ok(v_uid)); end if;
  select * into v_b from public.war_bases where id = v_m.base_id;
  v_p := public.raid_prof_(v_uid, v_now); v_pb := public.raid_bprof_(v_b.id, v_now);
  update public.raid_profile set seen_at = v_now where user_id = v_uid;
  perform public.raid_mark_(v_uid, p_dev, null, v_now);
  v_th := public.base_th(public.war_norm(v_b.layout, v_now)); v_l := public.raid_league(v_b.trophies);
  select jsonb_build_object('id', r.id, 'token', public.raid_token_(r.id, r.attacker, r.seed, r.started_at), 'mode', r.mode, 'started_at', r.started_at,
      'go_at', r.go_at, 'deadline', r.deadline) into v_act
    from public.raids r where r.attacker = v_uid and r.status = 'active';
  select jsonb_build_object('nick', coalesce(pr.nick, 'Игрок'), 'mode', r.mode, 'started_at', r.started_at, 'go_at', r.go_at, 'deadline', r.deadline) into v_bact
    from public.raids r left join public.profiles pr on pr.id = r.attacker where r.att_base = v_b.id and r.status = 'active' and r.mode <> 'tut' and r.attacker <> v_uid limit 1;
  return jsonb_build_object('ok', true, 'now', v_now, 'base', v_b.id, 'name_k', v_b.name_k, 'name_n', v_b.name_n, 'color', v_b.color, 'rank', v_m.rank,
    'can', v_m.rank in ('leader', 'officer') or v_b.raid_rank = 'soldier', 'raid_rank', v_b.raid_rank, 'age', public.war_age_ok(v_uid),
    'trophies', v_b.trophies, 'league', v_l, 'shield', v_b.shield_until, 'guard', v_pb.guard_until, 'newbie', v_pb.newbie_until, 'th', v_th,
    'skin', v_b.skin, 'base_skins', to_jsonb(v_pb.skins), 'army_skin', v_p.army_skin, 'skins', to_jsonb(v_p.skins), 'shield_buy', v_pb.shield_buy,
    'camp', v_pb.camp, 'tut', v_p.tut, 'dv', md5(public.war_defs()::text),
    'day', jsonb_build_object('battles', v_p.n_battle, 'search', v_p.n_search, 'bots', v_pb.n_bot, 'loot', v_pb.loot_day, 'lootCap', (v_r->'loot'->'day'->>(v_th - 1))::int),
    'week', jsonb_build_object('key', v_pb.week, 'stars', v_pb.week_stars, 'wins', v_pb.week_wins, 'chest', v_pb.week_wins >= (v_r->>'chestWins')::int and v_pb.chest_week <> v_pb.week),
    'stats', jsonb_build_object('wins', v_pb.wins, 'losses', v_pb.losses, 'def_won', v_pb.def_won, 'def_lost', v_pb.def_lost, 'best', v_pb.best_tr),
    'active', v_act, 'busy', v_bact,
    'log', coalesce((select jsonb_agg(x order by x.t desc) from (select r.id, extract(epoch from r.created_at)::bigint t, r.mode, coalesce(pr.nick, 'Игрок') nick, r.att_info base,
        coalesce((r.result->>'stars')::int, 0) stars, coalesce((r.result->>'pct')::int, 0) pct, coalesce((r.result->>'loot')::int, 0) loot,
        -coalesce((r.result->>'tr')::int, 0) tr, r.status,
        (r.status = 'done' and r.mode in ('find', 'revenge') and r.att_base is not null and not r.revenged and r.created_at > now() - interval '48 hours') revenge
      from public.raids r left join public.profiles pr on pr.id = r.attacker
      where r.def_base = v_b.id and r.status in ('done', 'expired') order by r.created_at desc limit 20) x), '[]'::jsonb),
    'attacks', coalesce((select jsonb_agg(x order by x.t desc) from (select r.id, extract(epoch from r.created_at)::bigint t, r.mode, r.lvl,
        coalesce(pr.nick, 'Игрок') who, r.def_info base, coalesce((r.result->>'stars')::int, 0) stars, coalesce((r.result->>'pct')::int, 0) pct,
        coalesce((r.result->>'added')::int, 0) loot, coalesce((r.result->>'tr')::int, 0) tr, r.status
      from public.raids r left join public.profiles pr on pr.id = r.attacker
      where r.att_base = v_b.id and r.status in ('done', 'expired') order by r.created_at desc limit 15) x), '[]'::jsonb));
end $$;

-- Начать набег: p_mode find (подбор) | next (пропустить текущую базу за кирпичи из казны) | revenge (p_ref — набег на свою базу) |
-- bot (разбойники под штаб) | camp (p_ref — лагерь 1…12) | tut (учебный: армия — учебная, любой из состава)
create or replace function public.raid_start(p_mode text, p_ref text default null, p_dev text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_now bigint := public.base_now(); v_dd jsonb := public.war_defs(); v_r jsonb := v_dd->'raid';
  v_m public.war_members%rowtype; v_me public.war_bases%rowtype; v_p public.raid_profile%rowtype; v_pb public.raid_base%rowtype;
  v_tg public.war_bases%rowtype; v_old public.raids%rowtype; v_rv public.raids%rowtype;
  v_mode text := p_mode; v_l jsonb; v_th int; v_army jsonb; v_q jsonb; v_seed int; v_id text; v_lvl int; v_var int := 0;
  v_snap jsonb; v_offer jsonb; v_def int; v_dth int := 1; v_dtr int := 0; v_dskin text := ''; v_dnick text := ''; v_cost int := 0;
  v_rng int; v_skip int[]; v_tok text; v_tl jsonb; v_newbie bigint := (v_r->'shield'->>'newbie')::int * 86400;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if coalesce(p_mode, '') not in ('find', 'next', 'revenge', 'bot', 'camp', 'tut') then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
  if not public.war_age_ok(v_uid) then return jsonb_build_object('ok', false, 'reason', 'age'); end if;
  perform public.raid_expire_(v_uid);
  select * into v_m from public.war_members where user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  select * into v_me from public.war_bases where id = v_m.base_id for update;
  if p_mode <> 'tut' and not (v_m.rank in ('leader', 'officer') or v_me.raid_rank = 'soldier') then return jsonb_build_object('ok', false, 'reason', 'rank'); end if;
  v_p := public.raid_prof_(v_uid, v_now); v_pb := public.raid_bprof_(v_me.id, v_now);
  perform public.raid_mark_(v_uid, p_dev, null, v_now);
  -- старые набеги (больше 30 дней) — убрать понемногу
  delete from public.raids where id in (select id from public.raids where created_at < now() - interval '30 days' and status <> 'active' limit 50);

  select * into v_old from public.raids where attacker = v_uid and status = 'active' for update;
  if found then
    if p_mode = 'next' and v_old.go_at is null and v_old.mode = 'find' then
      perform public.raid_close_(v_old.id, 'canceled');
      if v_old.def_base is not null then   -- пропущенную базу не подбираем ещё час (помним последних 10)
        v_skip := array_append(case when v_p.skip_at < v_now - 3600 then '{}'::int[] else v_p.skip_b end, v_old.def_base);
        if cardinality(v_skip) > 10 then v_skip := v_skip[cardinality(v_skip) - 9:cardinality(v_skip)]; end if;
        update public.raid_profile set skip_b = v_skip, skip_at = v_now where user_id = v_uid returning * into v_p;
      end if;
      select * into v_me from public.war_bases where id = v_m.base_id for update;   -- армия вернулась
    else
      return jsonb_build_object('ok', false, 'reason', 'active', 'id', v_old.id);
    end if;
  elsif p_mode = 'next' then v_mode := 'find';
  end if;
  if p_mode = 'next' and v_old.id is not null then v_mode := 'find'; v_cost := (v_r->'next'->>(public.base_th(public.war_norm(v_me.layout, v_now)) - 1))::int; end if;
  -- армию базы уже ведёт другой из состава
  if v_mode <> 'tut' and exists (select 1 from public.raids r where r.att_base = v_me.id and r.status = 'active' and r.mode <> 'tut') then
    return jsonb_build_object('ok', false, 'reason', 'army_out');
  end if;

  -- лагерь похода: есть такой и открыт (до проверки армии — понятнее)
  if v_mode = 'camp' then
    v_lvl := case when coalesce(p_ref, '') ~ '^\d{1,2}$' then p_ref::int end;
    if v_lvl is null or v_lvl < 1 or v_lvl > jsonb_array_length(v_r->'camp') then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
    if v_lvl > 1 and coalesce((v_pb.camp->>(v_lvl - 1)::text)::int, 0) < 1 then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  end if;
  v_l := public.war_norm(v_me.layout, v_now); v_th := public.base_th(v_l);
  select qn.o_q, qn.o_army into v_q, v_army from public.base_qnorm(v_me.queue, v_me.army, v_now) qn;
  if v_mode = 'tut' then v_army := v_r->'tutArmy';
  elsif not exists (select 1 from jsonb_each_text(v_army) a where a.value::int > 0) then return jsonb_build_object('ok', false, 'reason', 'army');
  end if;
  -- лимиты дня (у человека)
  if v_mode in ('find', 'revenge') and v_p.n_search >= (v_r->'day'->>'search')::int then return jsonb_build_object('ok', false, 'reason', 'limit_search'); end if;
  if v_p.n_battle >= (v_r->'day'->>'battles')::int then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
  if v_cost > 0 then
    if v_me.bricks < v_cost then return jsonb_build_object('ok', false, 'reason', 'bricks', 'need', v_cost); end if;
    update public.war_bases set bricks = bricks - v_cost where id = v_me.id;
  end if;
  v_seed := floor(random() * 2000000000)::int;

  -- цель
  if v_mode = 'find' then
    v_skip := case when v_p.skip_at < v_now - 3600 then '{}'::int[] else v_p.skip_b end;
    foreach v_rng in array array[200, 500, 1000000] loop
      select b.* into v_tg from public.war_bases b left join public.raid_base p on p.base_id = b.id
        where b.id <> v_me.id and not (b.id = any(v_skip))
          and b.shield_until <= v_now and coalesce(p.guard_until, 0) <= v_now
          and coalesce(p.newbie_until, floor(extract(epoch from b.created_at))::bigint + v_newbie) <= v_now
          and abs(public.base_th(public.war_norm(b.layout, v_now)) - v_th) <= 1 and abs(b.trophies - v_me.trophies) <= v_rng
          and not exists (select 1 from public.raids r where r.def_base = b.id and r.status = 'active')
          and not exists (select 1 from public.raids r where r.att_base = v_me.id and r.def_base = b.id and r.status in ('done', 'expired') and r.created_at > now() - interval '12 hours')
          and not public.raid_alt_base_(v_uid, b.id, v_now)
        order by (b.act_t > v_now - 300 or exists (select 1 from public.war_members wm join public.raid_profile q on q.user_id = wm.user_id where wm.base_id = b.id and q.seen_at > v_now - 120)),
          abs(b.trophies - v_me.trophies) / 50, md5(b.id::text || v_seed::text)
        limit 1;
      exit when found;
    end loop;
    if v_tg.id is null then
      update public.raid_profile set n_search = n_search + 1 where user_id = v_uid;
      return jsonb_build_object('ok', false, 'reason', 'nobody', 'bot', 100 + v_th, 'cost', v_cost);
    end if;
  elsif v_mode = 'revenge' then
    select * into v_rv from public.raids where id = coalesce(p_ref, '') and def_base = v_me.id for update;
    if not found or v_rv.status <> 'done' or v_rv.mode not in ('find', 'revenge') or v_rv.att_base is null then return jsonb_build_object('ok', false, 'reason', 'id'); end if;
    if v_rv.revenged or v_rv.created_at < now() - interval '48 hours' then return jsonb_build_object('ok', false, 'reason', 'revenged'); end if;
    select * into v_tg from public.war_bases where id = v_rv.att_base;
    if not found or v_tg.id = v_me.id then return jsonb_build_object('ok', false, 'reason', 'id'); end if;
    if v_tg.shield_until > v_now then return jsonb_build_object('ok', false, 'reason', 'shield', 'until', v_tg.shield_until); end if;
    if exists (select 1 from public.raids r where r.def_base = v_tg.id and r.status = 'active') then return jsonb_build_object('ok', false, 'reason', 'busy'); end if;
  elsif v_mode = 'bot' then v_lvl := 100 + v_th; v_var := v_seed % 4;
  elsif v_mode = 'camp' then null;   -- уровень проверен выше
  else v_lvl := 0;
  end if;

  if v_tg.id is not null then
    v_def := v_tg.id; v_tl := public.war_norm(v_tg.layout, v_now); v_dth := public.base_th(v_tl); v_dtr := v_tg.trophies; v_dskin := v_tg.skin;
    select coalesce(nick, 'Игрок') into v_dnick from public.profiles where id = v_tg.leader;
    v_snap := jsonb_build_object('layout', v_tl, 'base', v_tg.id);
    v_offer := public.raid_offer_(v_tl, v_tg.bricks, v_th, v_now);
  elsif v_mode = 'camp' then v_dth := (v_r->'campTh'->>(v_lvl - 1))::int;
  elsif v_mode = 'bot' then v_dth := v_th;
  else v_dth := 1;
  end if;

  v_id := 'r' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
  begin
    insert into public.raids (id, attacker, att_base, def_base, mode, status, seed, started_at, deadline, lvl, variant, snap, offer, army, hero, att_th, def_th,
        att_tr, def_tr, att_skin, def_skin, ver, dv, revenge_of, att_info, def_info)
      values (v_id, v_uid, v_me.id, v_def, v_mode, 'active', v_seed, v_now, v_now + (v_r->>'cancel')::int, v_lvl, v_var, v_snap, v_offer, v_army, v_th, v_th, v_dth,
        v_me.trophies, v_dtr, v_p.army_skin, v_dskin, null, md5(v_dd::text), case when v_mode = 'revenge' then v_rv.id end,
        jsonb_build_object('k', v_me.name_k, 'n', v_me.name_n, 'c', v_me.color),
        case when v_def is not null then jsonb_build_object('k', v_tg.name_k, 'n', v_tg.name_n, 'c', v_tg.color, 'nick', v_dnick) end);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'busy');   -- на эту базу только что напали — «⚔️ В бой» ещё раз
  end;
  if v_mode <> 'tut' then
    update public.war_bases set army = '{}'::jsonb, army_out = public.raid_army_add_(army_out, v_army, 1), queue = v_q, rev = rev + 1 where id = v_me.id;
  end if;
  if v_mode in ('find', 'revenge') then update public.raid_profile set n_search = n_search + 1 where user_id = v_uid; end if;
  if v_mode = 'revenge' then update public.raids set revenged = true where id = v_rv.id; end if;
  v_tok := public.raid_token_(v_id, v_uid, v_seed, v_now);
  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_tok, 'seed', v_seed, 'mode', v_mode, 'lvl', v_lvl, 'variant', v_var,
    'layout', v_snap->'layout', 'offer', v_offer, 'army', v_army, 'hero', v_th, 'now', v_now, 'started_at', v_now,
    'scout', (v_r->>'scout')::int, 'go', (v_r->>'go')::int, 'cost', v_cost, 'defs', v_dd,
    'def', case when v_def is not null then jsonb_build_object('nick', v_dnick, 'name_k', v_tg.name_k, 'name_n', v_tg.name_n, 'color', v_tg.color,
      'th', v_dth, 'tr', v_dtr, 'league', public.raid_league(v_dtr), 'skin', v_dskin, 'base', v_def) end,
    'tr', case when v_def is not null then jsonb_build_object('win', (public.raid_trophies_(v_me.trophies, v_dtr, 3)->>'win')::int, 'lose', (public.raid_trophies_(v_me.trophies, v_dtr, 0)->>'lose')::int) end,
    'pve', case when v_mode = 'bot' then jsonb_build_object('loot', case when v_pb.n_bot < (v_r->'day'->>'bots')::int then (v_r->'bot'->>(v_th - 1))::int else 0 end)
      when v_mode = 'camp' then jsonb_build_object('loot', (v_r->'camp'->>(v_lvl - 1))::int, 'best', coalesce((v_pb.camp->>v_lvl::text)::int, 0))
      when v_mode = 'tut' then jsonb_build_object('loot', case when v_p.tut then 0 else (v_r->>'tut')::int end) end);
end $$;

-- Бой начался: первая высадка или конец разведки. Нападение на базу снимает щит и защиту новичка СВОЕЙ базы
create or replace function public.raid_go(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_now bigint := public.base_now(); v public.raids%rowtype; v_r jsonb := public.war_defs()->'raid';
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into v from public.raids where id = coalesce(p_id, '') and attacker = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'id'); end if;
  if v.status <> 'active' then return jsonb_build_object('ok', false, 'reason', v.status); end if;
  if v.go_at is not null then return jsonb_build_object('ok', true, 'go_at', v.go_at, 'deadline', v.deadline, 'now', v_now); end if;
  if v_now > v.started_at + (v_r->>'go')::int then
    perform public.raid_close_(v.id, 'canceled');
    return jsonb_build_object('ok', false, 'reason', 'late');
  end if;
  update public.raids set go_at = v_now, deadline = v_now + (v_r->>'max')::int + (v_r->>'grace')::int where id = v.id returning * into v;
  perform public.raid_prof_(v_uid, v_now);
  update public.raid_profile set n_battle = n_battle + 1 where user_id = v_uid;
  if v.mode in ('find', 'revenge') and v.att_base is not null then
    update public.war_bases set shield_until = 0 where id = v.att_base and shield_until > v_now;
    perform public.raid_bprof_(v.att_base, v_now);
    update public.raid_base set newbie_until = 0 where base_id = v.att_base;
  end if;
  return jsonb_build_object('ok', true, 'go_at', v.go_at, 'deadline', v.deadline, 'now', v_now);
end $$;

-- Отменить до начала боя (армия назад, замок снят)
create or replace function public.raid_cancel(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v public.raids%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into v from public.raids where id = coalesce(p_id, '') and attacker = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'id'); end if;
  if v.status <> 'active' then return jsonb_build_object('ok', true, 'status', v.status); end if;
  if v.go_at is not null then return jsonb_build_object('ok', false, 'reason', 'started'); end if;
  perform public.raid_close_(v.id, 'canceled');
  return jsonb_build_object('ok', true, 'status', 'canceled');
end $$;

-- ═══ 4. Только сервер сайта (service_role): данные для пересчёта боя и итог ═══
create or replace function public.raid_load(p_id text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.raids%rowtype; v_now bigint := public.base_now();
begin
  select * into v from public.raids where id = coalesce(p_id, '');
  if not found or coalesce(p_token, '') <> public.raid_token_(v.id, v.attacker, v.seed, v.started_at) then return jsonb_build_object('ok', false, 'reason', 'token'); end if;
  if v.status = 'active' and ((v.go_at is null and v.started_at + (public.war_defs()->'raid'->>'cancel')::int < v_now) or (v.go_at is not null and v.deadline < v_now)) then
    perform public.raid_close_(v.id, case when v.go_at is null then 'canceled' else 'expired' end);
    select * into v from public.raids where id = v.id;
  end if;
  return jsonb_build_object('ok', true, 'status', v.status, 'mode', v.mode, 'seed', v.seed, 'lvl', v.lvl, 'variant', v.variant, 'layout', v.snap->'layout',
    'army', v.army, 'hero', v.hero, 'started_at', v.started_at, 'go_at', v.go_at, 'deadline', v.deadline, 'now', v_now, 'result', v.result,
    'defs', public.war_defs());
end $$;

-- Итог набега: p_res — итог пересчитанного сервером боя {stars, pct, th, ticks, destroyed, used, hero}. Добыча — по долям снимка
-- (raid_offer_) и потолкам — в казну базы нападающих, кубки, щит, журнал, 🔔. Повторный вызов — тот же итог. Как RaidSim.settle / pve
create or replace function public.raid_settle(p_id text, p_token text, p_res jsonb, p_inputs jsonb default '[]'::jsonb, p_ip text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_now bigint := public.base_now(); v_dd jsonb := public.war_defs(); v_r jsonb := v_dd->'raid'; v public.raids%rowtype;
  v_att public.war_bases%rowtype; v_def public.war_bases%rowtype; v_pa public.raid_base%rowtype; v_pd public.raid_base%rowtype; v_pu public.raid_profile%rowtype;
  v_stars int; v_pct int; v_ticks int; v_dead int[]; v_used jsonb; v_dep int; v_left int; v_st int := 0; v_mines jsonb := '{}'::jsonb;
  v_total int := 0; v_bonus int := 0; v_added int := 0; v_zero boolean := false; v_alt boolean := false; v_pair boolean := false;
  v_T jsonb; v_delta int := 0; v_dl jsonb; v_al jsonb; v_e jsonb; v_m int; v_idx int; v_rate int; v_rem int; v_cap int;
  v_loot int := 0; v_res jsonb; v_shield bigint := 0; v_best int; v_ret jsonb; v_k text; v_nick text; v_gone boolean := false;
begin
  select * into v from public.raids where id = coalesce(p_id, '') for update;
  if not found or coalesce(p_token, '') <> public.raid_token_(v.id, v.attacker, v.seed, v.started_at) then return jsonb_build_object('ok', false, 'reason', 'token'); end if;
  if v.status = 'done' then return v.result || jsonb_build_object('ok', true, 'again', true); end if;
  if v.status <> 'active' then return jsonb_build_object('ok', false, 'reason', v.status, 'result', v.result); end if;
  if (v.go_at is null and v.started_at + (v_r->>'cancel')::int < v_now) or (v.go_at is not null and v.deadline < v_now) then
    perform public.raid_close_(v.id, case when v.go_at is null then 'canceled' else 'expired' end);
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  -- итог боя: форма и «не больше, чем было в армии»
  if jsonb_typeof(p_res) <> 'object' or jsonb_typeof(p_res->'stars') <> 'number' or jsonb_typeof(p_res->'destroyed') <> 'array' or jsonb_typeof(p_res->'used') <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'bad');
  end if;
  v_stars := (p_res->>'stars')::int; v_pct := coalesce((p_res->>'pct')::int, 0); v_ticks := coalesce((p_res->>'ticks')::int, 0);
  if v_stars < 0 or v_stars > 3 or v_pct < 0 or v_pct > 100 or v_ticks < 0 or v_ticks > (v_r->>'max')::int * (v_r->>'tps')::int then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  v_used := p_res->'used';
  if exists (select 1 from jsonb_each_text(v_used) u where u.value !~ '^\d{1,4}$' or u.value::int > coalesce((v.army->>u.key)::int, 0)) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  select coalesce(array_agg(x::int), '{}') into v_dead from jsonb_array_elements_text(p_res->'destroyed') x where x ~ '^\d{1,7}$';
  v_dep := coalesce((select sum(u.value::int) from jsonb_each_text(v_used) u), 0) + case when coalesce((p_res->>'hero')::boolean, false) then 1 else 0 end;
  if v_dep = 0 then   -- никого не высадил — набег не состоялся
    perform public.raid_close_(v.id, 'canceled');
    return jsonb_build_object('ok', true, 'canceled', true);
  end if;
  if v.go_at is null then return jsonb_build_object('ok', false, 'reason', 'nogo'); end if;
  if v_ticks / (v_r->>'tps')::int > v_now - v.go_at + 5 then return jsonb_build_object('ok', false, 'reason', 'early', 'wait', v_ticks / (v_r->>'tps')::int - (v_now - v.go_at) - 5); end if;

  v_pu := public.raid_prof_(v.attacker, v_now);
  perform public.raid_mark_(v.attacker, null, p_ip, v_now);
  if v.att_base is not null then select * into v_att from public.war_bases where id = v.att_base for update; end if;
  if v_att.id is null then   -- базу нападающих распустили посреди боя: итог записан, награды класть некуда
    v_gone := true;
  else
    v_pa := public.raid_bprof_(v_att.id, v_now);
    v_al := public.war_norm(v_att.layout, v_now);
    v_cap := public.war_cap(v_al);
  end if;
  -- армия: высаженные — потрачены, остальные — назад в казарму
  v_ret := case when v.mode = 'tut' then '{}'::jsonb else public.raid_army_add_(v.army, v_used, -1) end;
  if v.mode in ('find', 'revenge') and v.def_base is not null and not v_gone then select * into v_def from public.war_bases where id = v.def_base for update; end if;

  if v_gone then
    v_loot := 0;
  elsif v.mode in ('find', 'revenge') and v_def.id is not null then
    v_dl := public.war_norm(v_def.layout, v_now);
    v_pd := public.raid_bprof_(v_def.id, v_now);
    v_alt := public.raid_alt_base_(v.attacker, v_def.id, v_now);
    v_pair := exists (select 1 from public.raids r where r.att_base = v.att_base and r.def_base = v.def_base and r.id <> v.id and r.status = 'done'
      and coalesce((r.result->>'loot')::int, 0) > 0 and r.created_at > now() - make_interval(hours => (v_r->'loot'->>'pair')::int));
    v_zero := v_alt or v_pair;
    -- казна: доли разрушенных, но не больше, чем сейчас сверх защиты
    select coalesce(sum(s.value::int), 0) into v_st from jsonb_each_text(coalesce(v.offer->'st', '{}'::jsonb)) s where s.key::int = any(v_dead);
    v_st := least(v_st, greatest(0, v_def.bricks - public.raid_prot_(v_dl)));
    -- производство: доля, но не больше, чем копится сейчас (по номеру)
    for v_k, v_m in select s.key, s.value::int from jsonb_each_text(coalesce(v.offer->'mn', '{}'::jsonb)) s where s.key::int = any(v_dead) order by s.key::int loop
      select coalesce((select public.war_prod(e, v_now) from jsonb_array_elements(v_dl) e where (e->>'i') = v_k limit 1), 0) into v_rem;
      v_mines := v_mines || jsonb_build_object(v_k, least(v_m, greatest(0, v_rem)));
    end loop;
    if v_zero then v_st := 0; select coalesce(jsonb_object_agg(key, 0), '{}'::jsonb) into v_mines from jsonb_each(v_mines); end if;
    -- потолки дня: взять (база нападающих) и потерять (база-защитник) — сначала казна, потом производство по номеру
    foreach v_left in array array[(v_r->'loot'->'day'->>(v.att_th - 1))::int - v_pa.loot_day, (v_r->'loot'->'lose'->>(coalesce((v.offer->>'th')::int, 1) - 1))::int - v_pd.loss_day] loop
      v_left := greatest(0, v_left);
      v_st := least(v_st, v_left); v_left := v_left - v_st;
      for v_k, v_m in select s.key, s.value::int from jsonb_each_text(v_mines) s order by s.key::int loop
        v_mines := jsonb_set(v_mines, array[v_k], to_jsonb(least(v_m, v_left))); v_left := v_left - least(v_m, v_left);
      end loop;
    end loop;
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_mines from jsonb_each(v_mines) where value::text::int > 0;
    v_total := v_st + coalesce((select sum(value::text::int) from jsonb_each(v_mines)), 0);
    v_T := case when v_zero then jsonb_build_object('win', 0, 'lose', 0, 'delta', 0) else public.raid_trophies_(v.att_tr, v.def_tr, v_stars) end;
    v_delta := (v_T->>'delta')::int;
    v_bonus := case when not v_zero and v_stars > 0 then (v_r->'bonus'->>public.raid_league(v.att_tr))::int * v_stars / 3 else 0 end;
    v_added := least(greatest(0, v_cap - v_att.bricks), v_total + v_bonus);
    -- защитник: кирпичи из казны, производство — меньше (как «собрал»), кубки, щит или стража
    for v_k, v_m in select key, value::text::int from jsonb_each(v_mines) loop
      select (q.o - 1)::int, q.e into v_idx, v_e from jsonb_array_elements(v_dl) with ordinality q(e, o) where q.e->>'i' = v_k;
      v_rate := (v_dd->'k'->(v_e->>'k')->'rate'->>((v_e->>'l')::int - 1))::int; v_rem := greatest(0, public.war_prod(v_e, v_now) - v_m);
      v_dl := jsonb_set(v_dl, array[v_idx::text], v_e || jsonb_build_object('t0', v_now - (v_rem * 3600 + v_rate - 1) / v_rate));
    end loop;
    if v_stars >= 2 then v_shield := v_now + (v_r->'shield'->>case when v_stars = 3 then 's3' else 's2' end)::int * 3600; end if;
    update public.war_bases set bricks = bricks - v_st, layout = v_dl, trophies = greatest(0, trophies - v_delta),
      shield_until = greatest(shield_until, v_shield), rev = rev + 1, updated_at = now() where id = v_def.id;
    update public.raid_base set loss_day = loss_day + v_total, guard_until = case when v_stars < 2 then greatest(guard_until, v_now + (v_r->'shield'->>'guard')::int * 60) else guard_until end,
      def_won = def_won + case when v_stars = 0 then 1 else 0 end, def_lost = def_lost + case when v_stars > 0 then 1 else 0 end where base_id = v_def.id;
    -- нападающие
    update public.war_bases set bricks = bricks + v_added, trophies = greatest(0, trophies + v_delta), army = public.raid_army_add_(army, v_ret, 1),
      army_out = public.raid_army_add_(army_out, v.army, -1), rev = rev + 1, updated_at = now() where id = v_att.id returning * into v_att;
    update public.raid_base set loot_day = loot_day + v_total, wins = wins + case when v_stars > 0 then 1 else 0 end, losses = losses + case when v_stars = 0 then 1 else 0 end,
      week_stars = week_stars + case when v_zero then 0 else v_stars end, week_wins = week_wins + case when v_stars > 0 and not v_zero then 1 else 0 end,
      best_tr = greatest(best_tr, v_att.trophies) where base_id = v_att.id;
    v_loot := v_total;
    select coalesce(nick, 'Игрок') into v_nick from public.profiles where id = v.attacker;
    if v_stars > 0 then
      perform public.raid_notify_base_(v_def.id, v.attacker, '⚔️ На вашу базу напали!',
        format('%s · %s · %s %% · забрали 🧱 %s%s. Посмотрите повтор — и отомстите!', v_nick, repeat('★', v_stars) || repeat('☆', 3 - v_stars), v_pct, v_total,
          case when v_shield > 0 then format(' · 🛡️ щит на %s ч', (v_shield - v_now) / 3600) else '' end), '#/games/raid/log', 'raid:' || v.id);
    else
      perform public.raid_notify_base_(v_def.id, v.attacker, '🛡️ База отбилась от набега!', format('%s не взял(а) ни одной звезды. 🏆 +%s', v_nick, -v_delta), '#/games/raid/log', 'raid:' || v.id);
    end if;
  elsif v.mode in ('find', 'revenge') then
    -- базу-защитника распустили посреди боя: без добычи и кубков, невысаженные — назад
    update public.war_bases set army = public.raid_army_add_(army, v_ret, 1), army_out = public.raid_army_add_(army_out, v.army, -1), rev = rev + 1, updated_at = now()
      where id = v_att.id returning * into v_att;
    v_loot := 0;
  else
    -- разбойники: добыча из правил (raid.bot / camp / tut), не из чужой казны
    v_loot := case v.mode
      when 'bot' then case when v_pa.n_bot < (v_r->'day'->>'bots')::int then (v_r->'bot'->>(least(5, greatest(1, v.lvl - 100)) - 1))::int * v_stars / 3 else 0 end
      when 'camp' then case when v_stars > coalesce((v_pa.camp->>v.lvl::text)::int, 0)
        then (v_r->'camp'->>(v.lvl - 1))::int * v_stars / 3 - (v_r->'camp'->>(v.lvl - 1))::int * least(3, coalesce((v_pa.camp->>v.lvl::text)::int, 0)) / 3 else 0 end
      when 'tut' then case when not v_pu.tut and v_stars > 0 then (v_r->>'tut')::int else 0 end
      else 0 end;
    v_added := least(greatest(0, v_cap - v_att.bricks), v_loot);
    update public.war_bases set bricks = bricks + v_added, army = case when v.mode = 'tut' then army else public.raid_army_add_(army, v_ret, 1) end,
      army_out = case when v.mode = 'tut' then army_out else public.raid_army_add_(army_out, v.army, -1) end, rev = rev + 1, updated_at = now() where id = v_att.id returning * into v_att;
    v_best := greatest(coalesce((v_pa.camp->>v.lvl::text)::int, 0), v_stars);
    update public.raid_base set n_bot = n_bot + case when v.mode = 'bot' and v_loot > 0 then 1 else 0 end,
      camp = case when v.mode = 'camp' then camp || jsonb_build_object(v.lvl::text, v_best) else camp end where base_id = v_att.id;
    if v.mode = 'tut' and v_stars > 0 then update public.raid_profile set tut = true where user_id = v.attacker; end if;
  end if;
  v_res := jsonb_build_object('stars', v_stars, 'pct', v_pct, 'th', coalesce((p_res->>'th')::boolean, false), 'ticks', v_ticks, 'loot', v_loot, 'st', v_st,
    'mines', v_mines, 'bonus', v_bonus, 'added', v_added, 'tr', v_delta, 'att_tr', coalesce(v_att.trophies, 0), 'zero', v_zero, 'alt', v_alt, 'used', v_used,
    'hero', coalesce((p_res->>'hero')::boolean, false), 'destroyed', to_jsonb(v_dead), 'shield', v_shield, 'bricks', v_att.bricks,
    'army', v_att.army, 'why', p_res->>'why', 'gone', v_gone);
  update public.raids set status = 'done', result = v_res, inputs = case when jsonb_typeof(p_inputs) = 'array' then p_inputs else '[]'::jsonb end,
    ver = (p_res->>'ver')::int where id = v.id;
  return v_res || jsonb_build_object('ok', true);
end $$;

-- ═══ 5. Повтор, топ, покупки, облики, сундук недели ═══
-- Повтор боя (журнал защиты, ссылка «смотри, как мы разнесли базу»): снимок, армия, зерно, ввод — бой пересчитывается тем же кодом
create or replace function public.raid_replay(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('ok', true, 'id', r.id, 'mode', r.mode, 'seed', r.seed, 'lvl', r.lvl, 'variant', r.variant, 'layout', r.snap->'layout',
      'army', r.army, 'hero', r.hero, 'inputs', coalesce(r.inputs, '[]'::jsonb), 'result', r.result, 'at', extract(epoch from r.created_at)::bigint,
      'att', jsonb_build_object('nick', coalesce(a.nick, 'Игрок'), 'skin', r.att_skin, 'tr', r.att_tr, 'th', r.att_th, 'base', r.att_info),
      'def', jsonb_build_object('nick', coalesce(r.def_info->>'nick', case when r.mode in ('find', 'revenge') then 'Игрок' else 'Разбойники' end), 'skin', r.def_skin,
        'tr', r.def_tr, 'th', r.def_th, 'base', r.def_info),
      'same', r.dv = md5(public.war_defs()::text), 'defs', public.war_defs())
    from public.raids r left join public.profiles a on a.id = r.attacker
    where r.id = coalesce(p_id, '') and r.status = 'done'), jsonb_build_object('ok', false, 'reason', 'id'))
$$;

-- Топ баз: week — звёзды за неделю (по МСК), all — кубки
create or replace function public.raid_top(p_kind text default 'week')
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_kind = 'all' then
    coalesce((select jsonb_agg(x) from (select b.id, b.name_k, b.name_n, b.color, coalesce(pr.nick, 'Игрок') nick, b.trophies tr, public.raid_league(b.trophies) league
      from public.war_bases b left join public.profiles pr on pr.id = b.leader where b.trophies > 0 order by b.trophies desc, b.id limit 30) x), '[]'::jsonb)
  else
    coalesce((select jsonb_agg(x) from (select b.id, b.name_k, b.name_n, b.color, coalesce(pr.nick, 'Игрок') nick, p.week_stars stars, p.week_wins wins, b.trophies tr,
        public.raid_league(b.trophies) league
      from public.raid_base p join public.war_bases b on b.id = p.base_id left join public.profiles pr on pr.id = b.leader
      where p.week = public.raid_week(public.base_now()) and p.week_stars > 0 order by p.week_stars desc, b.trophies desc, b.id limit 30) x), '[]'::jsonb)
  end
$$;

-- Покупки (честные: время и красота; любой из состава — в подарок базе): sh1 / sh2 — щит базы за 💎 (раз в неделю на базу, всего
-- ≤ shMax ч), skin:<id> — облик базы, army:<id> — свой облик армии (💎 или 🪙), tfin — дотренировать армию базы за 💎, bfin (p_ref —
-- постройка) — достроить за 💎. Вторую казарму не продаём: это постройка со штаба 3
create or replace function public.raid_buy(p_item text, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_now bigint := public.base_now(); v_dd jsonb := public.war_defs(); v_S jsonb := v_dd->'raid'->'shop';
  v_m public.war_members%rowtype; v_b public.war_bases%rowtype; v_p public.raid_profile%rowtype; v_pb public.raid_base%rowtype;
  v_g int := 0; v_c int := 0; v_bal int; v_title text; v_until bigint;
  v_q jsonb; v_army jsonb; v_e jsonb; v_l jsonb; v_idx int; v_it jsonb; v_id int; v_kind text; v_sk text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into v_m from public.war_members where user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  select * into v_b from public.war_bases where id = v_m.base_id for update;
  v_p := public.raid_prof_(v_uid, v_now); v_pb := public.raid_bprof_(v_b.id, v_now);
  if p_item in ('sh1', 'sh2') then
    if v_pb.shield_buy > v_now - (v_S->>'shWeek')::int * 86400 then return jsonb_build_object('ok', false, 'reason', 'week', 'next', v_pb.shield_buy + (v_S->>'shWeek')::int * 86400); end if;
    v_until := least(greatest(v_b.shield_until, v_now) + (v_S->p_item->>'h')::int * 3600, v_now + (v_S->>'shMax')::int * 3600);
    if v_until <= v_b.shield_until then return jsonb_build_object('ok', false, 'reason', 'max'); end if;
    v_g := (v_S->p_item->>'g')::int; v_title := format('Щит базы на %s ч', (v_S->p_item->>'h')::int);
  elsif p_item ~ '^(skin|army):[a-z]{2,12}$' then
    v_kind := split_part(p_item, ':', 1); v_sk := split_part(p_item, ':', 2);
    if v_S->v_kind->v_sk is null then return jsonb_build_object('ok', false, 'reason', 'item'); end if;
    if (v_kind = 'skin' and p_item = any(v_pb.skins)) or (v_kind = 'army' and p_item = any(v_p.skins)) then return jsonb_build_object('ok', false, 'reason', 'owned'); end if;
    v_g := coalesce((v_S->v_kind->v_sk->>'g')::int, 0); v_c := coalesce((v_S->v_kind->v_sk->>'c')::int, 0);
    v_title := case when v_kind = 'skin' then 'Облик базы: ' else 'Облик армии: ' end || v_sk;
  elsif p_item = 'tfin' then
    select qn.o_q, qn.o_army into v_q, v_army from public.base_qnorm(v_b.queue, v_b.army, v_now) qn;
    if jsonb_array_length(v_q) = 0 then return jsonb_build_object('ok', false, 'reason', 'noq'); end if;
    v_g := greatest(1, ((v_q->-1->>'ue')::bigint - v_now + (v_S->>'fin')::int - 1) / (v_S->>'fin')::int)::int;
    v_title := 'Дотренировать армию базы';
  elsif p_item = 'bfin' then
    v_id := case when coalesce(p_ref, '') ~ '^\d{1,7}$' then p_ref::int end;
    v_l := public.war_norm(v_b.layout, v_now);
    select (q.o - 1)::int, q.e into v_idx, v_it from jsonb_array_elements(v_l) with ordinality q(e, o) where (q.e->>'i')::int = v_id;
    if v_it is null then return jsonb_build_object('ok', false, 'reason', 'id'); end if;
    if not v_it ? 'ue' then return jsonb_build_object('ok', false, 'reason', 'idle'); end if;
    v_g := greatest(1, ((v_it->>'ue')::bigint - v_now + (v_S->>'fin')::int - 1) / (v_S->>'fin')::int)::int;
    v_title := 'Достроить сразу';
  else return jsonb_build_object('ok', false, 'reason', 'item');
  end if;
  -- оплата: 💎 — premium_add (журнал premium_ledger, выключатель магазина), 🪙 — base_pay_ (журнал coin_log, источник base)
  if v_g > 0 then
    if not coalesce((select shop_open from public.premium_settings where id = 1), true) then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
    v_bal := public.premium_add(v_uid, -v_g, 'spend', 'raid:' || p_item || coalesce(':' || p_ref, ''), v_title);
    if v_bal is null then return jsonb_build_object('ok', false, 'reason', 'gems', 'need', v_g); end if;
  elsif v_c > 0 then
    if not public.base_pay_(v_uid, v_c, 'raid:' || p_item) then return jsonb_build_object('ok', false, 'reason', 'coins', 'need', v_c); end if;
  end if;
  -- выдать
  if p_item in ('sh1', 'sh2') then
    update public.war_bases set shield_until = v_until, rev = rev + 1 where id = v_b.id;
    update public.raid_base set shield_buy = v_now where base_id = v_b.id;
  elsif v_kind = 'skin' then
    update public.raid_base set skins = array_append(skins, p_item) where base_id = v_b.id;
    update public.war_bases set skin = v_sk, rev = rev + 1 where id = v_b.id;
  elsif v_kind = 'army' then
    update public.raid_profile set skins = array_append(skins, p_item), army_skin = v_sk where user_id = v_uid;
  elsif p_item = 'tfin' then
    for v_e in select q.e from jsonb_array_elements(v_q) q(e) loop v_army := jsonb_set(v_army, array[v_e->>'u'], to_jsonb(coalesce((v_army->>(v_e->>'u'))::int, 0) + 1)); end loop;
    update public.war_bases set army = v_army, queue = '[]'::jsonb, rev = rev + 1 where id = v_b.id;
  elsif p_item = 'bfin' then
    v_it := (v_it - 'ul' - 'ue') || jsonb_build_object('l', (v_it->>'ul')::int) || case when v_dd->'k'->(v_it->>'k') ? 'rate' then jsonb_build_object('t0', v_now) else '{}'::jsonb end;
    update public.war_bases set layout = jsonb_set(v_l, array[v_idx::text], v_it), rev = rev + 1 where id = v_b.id;
  end if;
  return jsonb_build_object('ok', true, 'item', p_item, 'gems', v_g, 'coins', v_c, 'balance', v_bal,
    'shield', (select shield_until from public.war_bases where id = v_b.id));
end $$;

-- Надеть облик: skin — базе (главарь и офицеры, из купленных базой) | army — себе; '' — обычный
create or replace function public.raid_skin(p_kind text, p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_m public.war_members%rowtype; v_p public.raid_profile%rowtype; v_pb public.raid_base%rowtype; v_now bigint := public.base_now();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if coalesce(p_kind, '') not in ('skin', 'army') then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
  select * into v_m from public.war_members where user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  if p_kind = 'skin' then
    if v_m.rank not in ('leader', 'officer') then return jsonb_build_object('ok', false, 'reason', 'rank'); end if;
    v_pb := public.raid_bprof_(v_m.base_id, v_now);
    if coalesce(p_id, '') <> '' and not (('skin:' || p_id) = any(v_pb.skins)) then return jsonb_build_object('ok', false, 'reason', 'owned'); end if;
    update public.war_bases set skin = coalesce(p_id, ''), rev = rev + 1 where id = v_m.base_id;
  else
    v_p := public.raid_prof_(v_uid, v_now);
    if coalesce(p_id, '') <> '' and not (('army:' || p_id) = any(v_p.skins)) then return jsonb_build_object('ok', false, 'reason', 'owned'); end if;
    update public.raid_profile set army_skin = coalesce(p_id, '') where user_id = v_uid;
  end if;
  return jsonb_build_object('ok', true, 'kind', p_kind, 'id', coalesce(p_id, ''));
end $$;

-- Сундук недели базы: chestWins побед над базами за неделю (по МСК) — кирпичи в казну по лиге, раз в неделю (забрать может любой)
create or replace function public.raid_chest()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_now bigint := public.base_now(); v_r jsonb := public.war_defs()->'raid'; v_m public.war_members%rowtype;
  v_b public.war_bases%rowtype; v_pb public.raid_base%rowtype; v_add int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into v_m from public.war_members where user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  select * into v_b from public.war_bases where id = v_m.base_id for update;
  v_pb := public.raid_bprof_(v_b.id, v_now);
  if v_pb.chest_week = v_pb.week then return jsonb_build_object('ok', false, 'reason', 'done'); end if;
  if v_pb.week_wins < (v_r->>'chestWins')::int then return jsonb_build_object('ok', false, 'reason', 'wins', 'need', (v_r->>'chestWins')::int - v_pb.week_wins); end if;
  v_add := least(greatest(0, public.war_cap(public.war_norm(v_b.layout, v_now)) - v_b.bricks), (v_r->'chest'->>public.raid_league(v_b.trophies))::int);
  update public.war_bases set bricks = bricks + v_add, rev = rev + 1 where id = v_b.id;
  update public.raid_base set chest_week = week where base_id = v_b.id;
  return jsonb_build_object('ok', true, 'got', v_add);
end $$;

-- ═══ 6. Права: снаружи — только эти функции; итог и данные боя — только сервер сайта (service_role) ═══
revoke execute on function public.raid_token_(text, uuid, int, bigint) from public, anon, authenticated;
revoke execute on function public.raid_prof_(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.raid_bprof_(int, bigint) from public, anon, authenticated;
revoke execute on function public.raid_mark_(uuid, text, text, bigint) from public, anon, authenticated;
revoke execute on function public.raid_alt_(uuid, uuid, bigint) from public, anon, authenticated;
revoke execute on function public.raid_alt_base_(uuid, int, bigint) from public, anon, authenticated;
revoke execute on function public.raid_notify_(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.raid_notify_base_(int, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.raid_close_(text, text) from public, anon, authenticated;
revoke execute on function public.raid_expire_(uuid) from public, anon, authenticated;
revoke execute on function public.raid_offer_(jsonb, int, int, bigint) from public, anon, authenticated;
revoke execute on function public.raid_load(text, text) from public, anon, authenticated;
revoke execute on function public.raid_settle(text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.raid_load(text, text) to service_role;
grant execute on function public.raid_settle(text, text, jsonb, jsonb, text) to service_role;
revoke execute on function public.raid_state(text) from public;
revoke execute on function public.raid_start(text, text, text) from public, anon;
revoke execute on function public.raid_go(text) from public, anon;
revoke execute on function public.raid_cancel(text) from public, anon;
revoke execute on function public.raid_buy(text, text) from public, anon;
revoke execute on function public.raid_skin(text, text) from public, anon;
revoke execute on function public.raid_chest() from public, anon;
grant execute on function public.raid_state(text) to anon, authenticated;   -- гостю — reason auth (так проверяют, что файл применён)
grant execute on function public.raid_start(text, text, text) to authenticated;
grant execute on function public.raid_go(text) to authenticated;
grant execute on function public.raid_cancel(text) to authenticated;
grant execute on function public.raid_buy(text, text) to authenticated;
grant execute on function public.raid_skin(text, text) to authenticated;
grant execute on function public.raid_chest() to authenticated;
grant execute on function public.raid_replay(text) to anon, authenticated;
grant execute on function public.raid_top(text) to anon, authenticated;
grant execute on function public.raid_league(int) to anon, authenticated;
