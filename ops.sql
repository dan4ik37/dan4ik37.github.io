-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--  ops.sql — мониторинг сайта (T-016, docs/OPS.md). НОВАЯ ОБЛАСТЬ, один файл. Идемпотентен: запускать можно сколько угодно раз.
--
--  Что это. Ошибки в браузерах посетителей: js/core/errlog.js → POST /api/diag (api/_lib/routes/diag.js) → ops_err_ingest().
--  Хранится только очищенное: сообщение без личных данных, файл:строка, раздел сайта, версия (GAMES_VER), семейство браузера и системы,
--  класс устройства (телефон/планшет/компьютер) и счётчики. Ни ников, ни id, ни адресов с запросами, ни IP. Срок хранения — 14 суток.
--  Пишет ТОЛЬКО сервер сайта (ключ service_role, ops_err_ingest закрыта для anon и authenticated); читает ТОЛЬКО админ
--  (профиль → «👑 Панель администратора» → «🩺 Ошибки сайта»: ops_err_admin / ops_err_act; прямое чтение таблиц — по политике тоже админу).
--  Потолки на сутки (по МСК) — в ops_cfg(): 6000 отчётов, 20 000 ошибок, 300 новых разных; сверх — сервер велит браузерам молчать
--  (ответ { stop }), новые разные ошибки сверх потолка складываются в одну строку «overflow». Уборка — сама, раз в сутки, при первом отчёте.
--  От других файлов не зависит (нужна лишь таблица profiles с колонкой role — она есть с самого начала).
--
--  Проверка после запуска (REST, publishable-ключ, гостем):
--    /rpc/ops_err_admin {"p_days":7}     → 401, 42501 «permission denied for function ops_err_admin»  (PGRST202 = файл не применён)
--    /rpc/ops_err_ingest {"p_items":[]}  → 401, 42501 «permission denied for function ops_err_ingest» (закрыта для всех, кроме сервера)
--    /rest/v1/ops_err?select=k&limit=1   → 401, 42501 «permission denied for table ops_err» (таблица закрыта для гостя)
--  Вошедшему не-админу ops_err_admin отвечает «Только для админа» (42501); админу — сводку.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ─── 1. Таблицы ───
-- по одной строке на разную ошибку (ключ — отпечаток «тип | сообщение | файл | строка»)
create table if not exists public.ops_err (
  k        text primary key,
  t        text not null default 'e',        -- e — ошибка скрипта, p — необработанное обещание, r — не загрузился файл, x — сообщили вручную, o — служебная «overflow»
  m        text not null,                    -- сообщение (очищено в браузере и ещё раз на сервере)
  f        text not null default '',         -- файл: путь на сайте или cdn:/…
  l        int  not null default 0,          -- строка
  st       text,                             -- пример стека (первый присланный)
  first_at timestamptz not null default now(),
  last_at  timestamptz not null default now(),
  first_v  text not null default '',         -- версия сайта (GAMES_VER), когда увидели впервые
  last_v   text not null default '',         -- и в последний раз
  n        bigint not null default 0,        -- сколько раз случилась (сумма по отчётам)
  s        bigint not null default 0,        -- в скольких отчётах (≈ визитов, где случилась)
  v        jsonb not null default '{}'::jsonb,   -- версии сайта → отчётов (не больше 12 разных, остальное в «~»)
  r        jsonb not null default '{}'::jsonb,   -- разделы
  b        jsonb not null default '{}'::jsonb,   -- браузеры (chrome/129)
  o        jsonb not null default '{}'::jsonb,   -- системы
  d        jsonb not null default '{}'::jsonb,   -- устройства: m — телефон, t — планшет, d — компьютер
  ign      boolean not null default false    -- админ скрыл (не показывать в списке по умолчанию)
);
create index if not exists ops_err_last_idx on public.ops_err (last_at);

-- по дням (для «сегодня», «за неделю» и графика)
create table if not exists public.ops_err_day (
  day date not null,
  k   text not null references public.ops_err(k) on delete cascade,
  n   int  not null default 0,
  s   int  not null default 0,
  primary key (day, k)
);
create index if not exists ops_err_day_k_idx on public.ops_err_day (k);

-- потолки на сутки по МСК
create table if not exists public.ops_quota (
  day    date primary key,
  calls  int not null default 0,
  items  int not null default 0,
  newk   int not null default 0,
  purged boolean not null default false
);

alter table public.ops_err enable row level security;
alter table public.ops_err_day enable row level security;
alter table public.ops_quota enable row level security;
revoke all on public.ops_err, public.ops_err_day, public.ops_quota from anon, authenticated;

-- ─── 2. Мелкие помощники ───
-- админ ли тот, кто спрашивает (свой, без зависимости от других файлов)
create or replace function public.ops_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

-- настройки: сколько хранить и потолки на сутки. Меняешь число — запусти файл ещё раз
create or replace function public.ops_cfg() returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('keep_days', 14, 'calls_day', 6000, 'items_day', 20000, 'newk_day', 300, 'map_keys', 12)
$$;

create or replace function public.ops_today() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'Europe/Moscow')::date $$;

-- сколько секунд до полуночи по МСК (когда потолок обнулится), не меньше минуты
create or replace function public.ops_secs_left() returns int
language sql stable set search_path = public as $$
  select greatest(60, least(86400, ceil(extract(epoch from (((now() at time zone 'Europe/Moscow')::date + 1)::timestamp at time zone 'Europe/Moscow') - now()))::int))
$$;

-- счётчик в словаре {"ключ": число}: +by; разных ключей не больше 12, лишнее — в "~"
create or replace function public.ops_inc(a jsonb, kk text, by int default 1) returns jsonb
language plpgsql immutable set search_path = public as $$
declare m jsonb := coalesce(a, '{}'::jsonb);
begin
  if kk is null or kk = '' then return m; end if;
  if m ? kk then return jsonb_set(m, array[kk], to_jsonb(coalesce((m->>kk)::int, 0) + by)); end if;
  if (select count(*) from jsonb_object_keys(m)) >= 12 then
    return jsonb_set(m, array['~'], to_jsonb(coalesce((m->>'~')::int, 0) + by));
  end if;
  return m || jsonb_build_object(kk, by);
end $$;

-- ─── 3. Приём отчётов: ТОЛЬКО сервер сайта (service_role) ───
-- p_items: [{ t, m, f, l, c, r, n, s }], p_meta: { v, b, o, d, x }. Всё ещё раз проверяется и обрезается.
-- Ответ: { ok, rate } или { ok: false, stop: секунд } — потолок дня исчерпан.
create or replace function public.ops_err_ingest(p_items jsonb, p_meta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := public.ops_cfg();
  td date := public.ops_today();
  q public.ops_quota%rowtype;
  it jsonb;
  kk text; typ text; msg text; fil text; ln int; cn int; rt text; stk text;
  ver text; brw text; os_ text; dev text;
  cnt int := 0; newc int := 0; usage numeric;
  lim_calls int := (cfg->>'calls_day')::int;
  lim_items int := (cfg->>'items_day')::int;
  lim_new int := (cfg->>'newk_day')::int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'shape');
  end if;
  p_meta := coalesce(p_meta, '{}'::jsonb);
  ver := left(regexp_replace(coalesce(p_meta->>'v', ''), '[^0-9A-Za-z._-]', '', 'g'), 12);
  brw := coalesce(p_meta->>'b', 'other');
  if brw !~ '^(chrome|edge|firefox|safari|opera|yandex|samsung|other)(/[0-9]{1,3})?$' then brw := 'other'; end if;
  os_ := coalesce(p_meta->>'o', 'other');
  if os_ not in ('windows', 'android', 'ios', 'mac', 'linux', 'chromeos', 'other') then os_ := 'other'; end if;
  dev := coalesce(p_meta->>'d', 'd');
  if dev not in ('m', 't', 'd') then dev := 'd'; end if;

  -- потолок дня (строку держим до конца — вызовы встают в очередь, считают честно)
  insert into public.ops_quota (day) values (td) on conflict (day) do nothing;
  select * into q from public.ops_quota where day = td for update;
  if q.calls >= lim_calls or q.items >= lim_items then
    return jsonb_build_object('ok', false, 'stop', public.ops_secs_left());
  end if;
  -- уборка раз в сутки: старые ошибки, дни и потолки
  if not q.purged then
    update public.ops_quota set purged = true where day = td;
    delete from public.ops_err where last_at < now() - make_interval(days => (cfg->>'keep_days')::int);
    delete from public.ops_err_day where day < td - (cfg->>'keep_days')::int;
    delete from public.ops_quota where day < td - 60;
  end if;

  for it in select value from jsonb_array_elements(p_items) limit 12 loop
    if jsonb_typeof(it) <> 'object' then continue; end if;
    typ := coalesce(it->>'t', 'e');
    if typ not in ('e', 'p', 'r', 'x') then typ := 'e'; end if;
    msg := left(btrim(regexp_replace(regexp_replace(coalesce(it->>'m', ''), '[[:cntrl:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')), 200);
    if msg = '' then continue; end if;
    fil := left(regexp_replace(coalesce(it->>'f', ''), '[^A-Za-z0-9_/.@~+:-]', '', 'g'), 100);
    ln := case when it->>'l' ~ '^[0-9]{1,8}$' then (it->>'l')::int else 0 end;
    cn := case when it->>'n' ~ '^[0-9]{1,9}$' then least((it->>'n')::int, 1000) else 1 end;
    if cn < 1 then cn := 1; end if;
    rt := coalesce(it->>'r', 'other');
    if rt !~ '^[a-z][a-z0-9_-]{0,19}(/[a-z][a-z0-9_-]{0,23})?$' then rt := 'other'; end if;
    stk := nullif(left(regexp_replace(coalesce(it->>'s', ''), '[^A-Za-z0-9_$.<>/@~+:\[\] \n-]', '', 'g'), 400), '');
    kk := left(md5(typ || '|' || msg || '|' || fil || '|' || ln::text), 16);
    -- новых разных ошибок за сутки уже много — считаем в одну строку «overflow»
    if not exists (select 1 from public.ops_err where k = kk) then
      if q.newk + newc >= lim_new then
        kk := 'overflow'; typ := 'o'; msg := 'Слишком много разных новых ошибок за сутки — часть не записана'; fil := ''; ln := 0; stk := null;
      else
        newc := newc + 1;
      end if;
    end if;
    insert into public.ops_err as e (k, t, m, f, l, st, first_v, last_v, n, s, v, r, b, o, d)
    values (kk, typ, msg, fil, ln, stk, ver, ver, cn, 1,
            public.ops_inc('{}'::jsonb, ver, 1), public.ops_inc('{}'::jsonb, rt, 1), public.ops_inc('{}'::jsonb, brw, 1),
            public.ops_inc('{}'::jsonb, os_, 1), public.ops_inc('{}'::jsonb, dev, 1))
    on conflict (k) do update set
      last_at = now(),
      last_v  = case when ver <> '' then ver else e.last_v end,
      st      = coalesce(e.st, excluded.st),
      n       = e.n + cn,
      s       = e.s + 1,
      v       = public.ops_inc(e.v, ver, 1),
      r       = public.ops_inc(e.r, rt, 1),
      b       = public.ops_inc(e.b, brw, 1),
      o       = public.ops_inc(e.o, os_, 1),
      d       = public.ops_inc(e.d, dev, 1);
    insert into public.ops_err_day (day, k, n, s) values (td, kk, cn, 1)
    on conflict (day, k) do update set n = public.ops_err_day.n + excluded.n, s = public.ops_err_day.s + 1;
    cnt := cnt + 1;
  end loop;

  update public.ops_quota set calls = calls + 1, items = items + cnt, newk = newk + newc where day = td;
  -- чем ближе к потолку, тем меньшей доле визитов браузер разрешает отправлять
  usage := greatest((q.calls + 1)::numeric / lim_calls, (q.items + cnt)::numeric / lim_items);
  return jsonb_build_object('ok', true, 'rate', case when usage >= 0.9 then 0.1 when usage >= 0.7 then 0.3 when usage >= 0.5 then 0.6 else 1 end);
end $$;

-- ─── 4. Чтение и управление: ТОЛЬКО админ ───
-- Сводка за p_days (1…14) суток: потолки, график по дням, список ошибок (по числу случаев, до 80)
create or replace function public.ops_err_admin(p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  td date := public.ops_today();
  dd int := greatest(1, least(coalesce(p_days, 7), 14));
  d0 date;
begin
  if not public.ops_admin() then raise exception 'Только для админа' using errcode = '42501'; end if;
  d0 := td - (dd - 1);
  return jsonb_build_object(
    'ok', true, 'now', now(), 'today', td, 'days', dd, 'cfg', public.ops_cfg(),
    'quota', coalesce((select to_jsonb(qq) - 'purged' from public.ops_quota qq where qq.day = td), '{}'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d0 + g.i, 'n', coalesce(a.n, 0), 's', coalesce(a.s, 0), 'keys', coalesce(a.keys, 0)) order by g.i)
      from generate_series(0, dd - 1) as g(i)
      left join (select day, sum(n)::int as n, sum(s)::int as s, count(*)::int as keys from public.ops_err_day where day >= d0 group by day) a on a.day = d0 + g.i
    ), '[]'::jsonb),
    'top', coalesce((
      select jsonb_agg(to_jsonb(tt) order by tt.n_win desc, tt.last_at desc)
      from (
        select e.k, e.t, e.m, e.f, e.l, e.st, e.first_at, e.last_at, e.first_v, e.last_v, e.ign, e.v, e.r, e.b, e.o, e.d, e.n as n_all,
               w.n_win, w.s_win, w.n_today
        from public.ops_err e
        join (select k, sum(n)::int as n_win, sum(s)::int as s_win, coalesce(sum(n) filter (where day = td), 0)::int as n_today
              from public.ops_err_day where day >= d0 group by k) w on w.k = e.k
        order by w.n_win desc, e.last_at desc
        limit 80
      ) tt
    ), '[]'::jsonb),
    'keys_total', (select count(*) from public.ops_err)
  );
end $$;

-- Действия над одной ошибкой или всеми: ign — скрыть, unign — вернуть, del — стереть, clear — стереть всё
create or replace function public.ops_err_act(p_act text, p_k text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.ops_admin() then raise exception 'Только для админа' using errcode = '42501'; end if;
  if p_act = 'ign' then update public.ops_err set ign = true where k = p_k;
  elsif p_act = 'unign' then update public.ops_err set ign = false where k = p_k;
  elsif p_act = 'del' then delete from public.ops_err where k = p_k;
  elsif p_act = 'clear' then delete from public.ops_err where true;
  else return jsonb_build_object('ok', false, 'reason', 'act');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ─── 5. Права ───
-- прямое чтение таблиц — только админу (список лучше брать через ops_err_admin)
drop policy if exists ops_err_admin_read on public.ops_err;
create policy ops_err_admin_read on public.ops_err for select to authenticated using ((select public.ops_admin()));
drop policy if exists ops_err_day_admin_read on public.ops_err_day;
create policy ops_err_day_admin_read on public.ops_err_day for select to authenticated using ((select public.ops_admin()));
grant select on public.ops_err, public.ops_err_day to authenticated;

revoke execute on function public.ops_cfg(), public.ops_today(), public.ops_secs_left(), public.ops_inc(jsonb, text, int) from public, anon, authenticated;
revoke execute on function public.ops_err_ingest(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ops_err_ingest(jsonb, jsonb) to service_role;
revoke execute on function public.ops_admin() from public, anon;
grant execute on function public.ops_admin() to authenticated, service_role;
revoke execute on function public.ops_err_admin(int) from public, anon;
grant execute on function public.ops_err_admin(int) to authenticated;
revoke execute on function public.ops_err_act(text, text) from public, anon;
grant execute on function public.ops_err_act(text, text) to authenticated;
