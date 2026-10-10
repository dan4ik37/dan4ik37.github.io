-- ═══════════════════════════════════════════════════════════════════
--  «МИР ДЕНЧИКА»: РАЙОН УЧАСТКОВ — свой участок, как база в Clash of Clans, и дом с мебелью, как в Аватарии
--  (js/games/mir-base.js). Выполнить целиком в Supabase → SQL Editor. Идемпотентно (можно запускать ещё раз).
--  Нужны (уже применены): profiles, friendships (friends-dm.sql), coin_wallet и coin_log (coins.sql).
--
--  Участок: номер 1…600 (улица = (номер − 1) / 6), ОДИН на человека (base_claim). Постройки — bases.layout (jsonb):
--  [{i, k, x, z, r, l, ul?, ue?, t0?}] — номер, вид, клетка 0…11, поворот 0…3, уровень (0 — строится), до какого
--  уровня и когда (ue — секунды эпохи) идёт стройка, с какого момента копит шахта (t0). Мебель — base_rooms.items
--  [{i, k, x, z, r}] (комната 9×9). Купленные украшения и мебель — own {"tree": 2, "f:tv": 1} (убранное — в запасе).
--  Меняется ТОЛЬКО через base_act (security definer): сервер сам проверяет каталог (base_defs — тот же, что DEFS/FURN
--  в mir-base.js; тест PGlite сверяет оба и прогоняет одни и те же ходы), клетки, пересечения, лимиты по уровню ратуши,
--  цену, строителей, время по своим часам. Добыча шахт и конец стройки — по отметкам времени: клиент только рисует.
--  Читать: участки — все (base_street и таблица bases); дом — кого пускает хозяин (base_room и RLS base_rooms): все /
--  друзья (friendships) / никто. Монеты 🪙 (coin_wallet) — только «ускорить стройку» и вещи за монеты.
--  Проверка после запуска: select public.base_street(0); → {"ok": true, …}
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.bases (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plot int not null unique
);
alter table public.bases add column if not exists bricks int not null default 0;
alter table public.bases add column if not exists layout jsonb not null default '[]'::jsonb;
alter table public.bases add column if not exists own jsonb not null default '{}'::jsonb;
alter table public.bases add column if not exists access text not null default 'all';
alter table public.bases add column if not exists seq int not null default 0;          -- последний номер постройки/мебели
alter table public.bases add column if not exists rev int not null default 0;          -- версия: растёт при каждом изменении
alter table public.bases add column if not exists likes int not null default 0;
alter table public.bases add column if not exists gift_day date;                       -- когда забран подарок дня
alter table public.bases add column if not exists act_t bigint not null default 0;     -- ограничение частоты: начало минуты
alter table public.bases add column if not exists act_n int not null default 0;        -- и ходов в ней
alter table public.bases add column if not exists created_at timestamptz not null default now();
alter table public.bases add column if not exists updated_at timestamptz not null default now();
do $$ begin alter table public.bases add constraint bases_plot_chk check (plot between 1 and 600); exception when duplicate_object then null; end $$;
do $$ begin alter table public.bases add constraint bases_bricks_chk check (bricks >= 0); exception when duplicate_object then null; end $$;
do $$ begin alter table public.bases add constraint bases_access_chk check (access in ('all', 'friends', 'nobody')); exception when duplicate_object then null; end $$;

create table if not exists public.base_rooms (
  user_id uuid primary key references public.bases(user_id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.base_likes (
  owner uuid not null references public.bases(user_id) on delete cascade,
  liker uuid not null,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (owner, liker, day)
);
create index if not exists idx_base_likes_liker on public.base_likes (liker, day);

-- ── Часы и каталог ──
create or replace function public.base_now() returns bigint language sql stable as $$
  select floor(extract(epoch from now()))::bigint
$$;
create or replace function public.base_today() returns date language sql stable as $$
  select (to_timestamp(public.base_now()) at time zone 'Europe/Moscow')::date
$$;
-- Каталог — КАК SERVER в mir-base.js: n — клеток участка, in — клеток комнаты, per — участков на улице, start — кирпичей
-- на старт, deco — лимит украшений по уровню ратуши, door — проход от двери (x0, x1, z0, z1); k — постройки, f — мебель
create or replace function public.base_defs() returns jsonb language sql immutable as $$
  select '{"n":12,"in":9,"per":6,"plots":600,"start":600,"deco":[6,10,15,20,25],"door":[3,6,7,9],
  "k":{
    "th":{"w":3,"d":3,"lv":5,"fixed":1,"cost":[0,500,2000,6000,15000],"time":[0,300,1800,7200,28800],"max":[1,1,1,1,1],"keep":[1000,1500,2500,4000,6000]},
    "house":{"w":5,"d":5,"lv":5,"fixed":1,"cost":[0,300,1200,4000,10000],"time":[0,120,1200,5400,21600],"max":[1,1,1,1,1],"furn":[8,14,20,28,36]},
    "mine":{"w":2,"d":2,"lv":5,"cost":[100,250,800,2500,7000],"time":[20,120,1200,5400,18000],"max":[1,2,3,3,4],"rate":[150,250,400,600,900],"hold":[1200,2000,3200,4800,7200]},
    "store":{"w":2,"d":2,"lv":5,"cost":[150,400,1200,3500,9000],"time":[20,180,1500,5400,18000],"max":[1,1,2,2,3],"keep":[1000,2500,5000,8000,12000]},
    "shop":{"w":2,"d":2,"lv":1,"cost":[1000],"time":[600],"max":[0,1,1,1,1]},
    "tower":{"w":2,"d":2,"lv":3,"cost":[600,2000,6000],"time":[300,3600,14400],"max":[0,0,1,1,2]},
    "wall":{"w":1,"d":1,"lv":5,"cost":[10,30,80,200,500],"time":[0,0,0,0,0],"max":[20,30,40,50,60]},
    "tree":{"w":1,"d":1,"lv":1,"cost":[30],"time":[0],"g":"deco"},
    "pine":{"w":1,"d":1,"lv":1,"cost":[30],"time":[0],"g":"deco"},
    "bush":{"w":1,"d":1,"lv":1,"cost":[15],"time":[0],"g":"deco"},
    "flowers":{"w":1,"d":1,"lv":1,"cost":[15],"time":[0],"g":"deco"},
    "rock":{"w":1,"d":1,"lv":1,"cost":[10],"time":[0],"g":"deco"},
    "lamp":{"w":1,"d":1,"lv":1,"cost":[40],"time":[0],"g":"deco"},
    "flag":{"w":1,"d":1,"lv":1,"cost":[50],"time":[0],"g":"deco"},
    "bench":{"w":2,"d":1,"lv":1,"cost":[60],"time":[0],"g":"deco"},
    "fountain":{"w":2,"d":2,"lv":1,"cost":[300],"time":[0],"g":"deco","th":2},
    "statue":{"w":1,"d":1,"lv":1,"cost":[0],"time":[0],"g":"deco","th":3,"coins":200}},
  "f":{
    "bed":{"w":2,"d":3,"cost":80,"coins":0}, "sofa":{"w":3,"d":1,"cost":100,"coins":0}, "chair":{"w":1,"d":1,"cost":20,"coins":0},
    "table":{"w":2,"d":2,"cost":50,"coins":0}, "rug":{"w":3,"d":3,"cost":40,"coins":0,"floor":1}, "lamp":{"w":1,"d":1,"cost":30,"coins":0},
    "plant":{"w":1,"d":1,"cost":20,"coins":0}, "shelf":{"w":2,"d":1,"cost":60,"coins":0}, "wardrobe":{"w":2,"d":1,"cost":80,"coins":0},
    "tv":{"w":2,"d":1,"cost":0,"coins":60}, "fire":{"w":2,"d":1,"cost":0,"coins":80}, "aqua":{"w":2,"d":1,"cost":0,"coins":100},
    "chess":{"w":2,"d":3,"cost":0,"coins":120}, "arcade":{"w":1,"d":1,"cost":0,"coins":150}}}'::jsonb
$$;

-- ── Помощники (как Rules в mir-base.js) ──
-- Размер в клетках с поворотом (постройка / мебель)
create or replace function public.base_fp(p_k text, p_r int) returns int[] language sql immutable as $$
  select case when q.d is null then array[1, 1] when p_r % 2 = 1 then array[(q.d->>'d')::int, (q.d->>'w')::int] else array[(q.d->>'w')::int, (q.d->>'d')::int] end
  from (select public.base_defs()->'k'->p_k as d) q
$$;
create or replace function public.base_ffp(p_k text, p_r int) returns int[] language sql immutable as $$
  select case when q.d is null then array[1, 1] when p_r % 2 = 1 then array[(q.d->>'d')::int, (q.d->>'w')::int] else array[(q.d->>'w')::int, (q.d->>'d')::int] end
  from (select public.base_defs()->'f'->p_k as d) q
$$;
-- Уровень ратуши и дома, вместимость склада, строители, сколько строек идёт (после base_norm — все с «ue»)
create or replace function public.base_th(p_l jsonb) returns int language sql immutable as $$
  select greatest(1, coalesce((select (q.e->>'l')::int from jsonb_array_elements(p_l) q(e) where q.e->>'k' = 'th' limit 1), 1))
$$;
create or replace function public.base_house_lv(p_l jsonb) returns int language sql immutable as $$
  select greatest(1, coalesce((select (q.e->>'l')::int from jsonb_array_elements(p_l) q(e) where q.e->>'k' = 'house' limit 1), 1))
$$;
create or replace function public.base_cap(p_l jsonb) returns int language sql immutable as $$
  select (public.base_defs()->'k'->'th'->'keep'->>(public.base_th(p_l) - 1))::int
    + coalesce((select sum((public.base_defs()->'k'->'store'->'keep'->>((q.e->>'l')::int - 1))::int) from jsonb_array_elements(p_l) q(e)
        where q.e->>'k' = 'store' and (q.e->>'l')::int >= 1), 0)::int
$$;
create or replace function public.base_builders(p_l jsonb) returns int language sql immutable as $$
  select 1 + case when exists (select 1 from jsonb_array_elements(p_l) q(e) where q.e->>'k' = 'shop' and (q.e->>'l')::int >= 1) then 1 else 0 end
$$;
create or replace function public.base_busy(p_l jsonb) returns int language sql immutable as $$
  select count(*)::int from jsonb_array_elements(p_l) q(e) where q.e ? 'ue'
$$;
-- Кирпичи в шахте сейчас: 8 часов добычи максимум; на стройке и при улучшении не копит
create or replace function public.base_prod(p_e jsonb, p_now bigint) returns int language sql immutable as $$
  select case when p_e->>'k' <> 'mine' or coalesce((p_e->>'l')::int, 0) < 1 or p_e ? 'ue' then 0
    else least((q.m->'hold'->>((p_e->>'l')::int - 1))::int,
      ((q.m->'rate'->>((p_e->>'l')::int - 1))::bigint * greatest(0, p_now - coalesce((p_e->>'t0')::bigint, p_now)) / 3600)::int) end
  from (select public.base_defs()->'k'->'mine' as m) q
$$;
-- Влезает ли прямоугольник на участок, не задевая других (p_skip — сама передвигаемая)
create or replace function public.base_fits(p_l jsonb, p_x int, p_z int, p_w int, p_d int, p_skip int) returns boolean language sql immutable as $$
  select p_x >= 0 and p_z >= 0 and p_x + p_w <= 12 and p_z + p_d <= 12 and not exists (
    select 1 from jsonb_array_elements(p_l) q(e), lateral (select public.base_fp(q.e->>'k', (q.e->>'r')::int) as f) s
    where (q.e->>'i')::int <> p_skip
      and p_x < (q.e->>'x')::int + s.f[1] and (q.e->>'x')::int < p_x + p_w and p_z < (q.e->>'z')::int + s.f[2] and (q.e->>'z')::int < p_z + p_d)
$$;
-- Мебель: в комнате, не на проходе от двери (кроме ковра); ковры пересекаются только с коврами, остальное — с остальным
create or replace function public.base_ffits(p_room jsonb, p_k text, p_x int, p_z int, p_w int, p_d int, p_skip int) returns boolean language sql immutable as $$
  select p_x >= 0 and p_z >= 0 and p_x + p_w <= 9 and p_z + p_d <= 9
    and (fl.f or not (p_x < 6 and 3 < p_x + p_w and p_z < 9 and 7 < p_z + p_d))
    and not exists (
      select 1 from jsonb_array_elements(p_room) q(e),
        lateral (select public.base_ffp(q.e->>'k', (q.e->>'r')::int) as g, coalesce((public.base_defs()->'f'->(q.e->>'k')->>'floor')::int, 0) = 1 as ef) s
      where (q.e->>'i')::int <> p_skip and s.ef = fl.f
        and p_x < (q.e->>'x')::int + s.g[1] and (q.e->>'x')::int < p_x + p_w and p_z < (q.e->>'z')::int + s.g[2] and (q.e->>'z')::int < p_z + p_d)
  from (select coalesce((public.base_defs()->'f'->p_k->>'floor')::int, 0) = 1 as f) fl
$$;
-- Достроилось к моменту p_now — новый уровень (шахта копит с конца стройки)
create or replace function public.base_norm(p_l jsonb, p_now bigint) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(case when q.e ? 'ue' and (q.e->>'ue')::bigint <= p_now
      then (q.e - 'ul' - 'ue') || jsonb_build_object('l', (q.e->>'ul')::int)
        || case when q.e->>'k' = 'mine' then jsonb_build_object('t0', (q.e->>'ue')::bigint) else '{}'::jsonb end
      else q.e end order by q.o), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_l, '[]'::jsonb)) with ordinality q(e, o)
$$;
-- Собрать из шахт (p_id — одна, null — все) на склад, сколько влезет; остаток остаётся в шахте
create or replace function public.base_collect_(p_l jsonb, p_bricks int, p_id int, p_now bigint, out o_l jsonb, out o_br int, out o_got int)
language plpgsql immutable as $$
declare v_e jsonb; v_o int; v_rate int; v_amt int; v_tk int; v_space int; v_rem int;
begin
  o_l := p_l; o_br := p_bricks; o_got := 0;
  v_space := greatest(0, public.base_cap(p_l) - p_bricks);
  for v_e, v_o in select q.e, (q.o - 1)::int from jsonb_array_elements(p_l) with ordinality q(e, o) loop
    if v_e->>'k' <> 'mine' or (p_id is not null and (v_e->>'i')::int <> p_id) then continue; end if;
    v_amt := public.base_prod(v_e, p_now);
    if v_amt <= 0 then continue; end if;
    v_tk := least(v_amt, v_space); v_space := v_space - v_tk; o_got := o_got + v_tk;
    v_rate := (public.base_defs()->'k'->'mine'->'rate'->>((v_e->>'l')::int - 1))::int; v_rem := v_amt - v_tk;
    o_l := jsonb_set(o_l, array[v_o::text], v_e || jsonb_build_object('t0', p_now - (v_rem * 3600 + v_rate - 1) / v_rate));
  end loop;
  o_br := o_br + o_got;
end $$;
-- Целое из аргументов клиента (0…mx) или null
create or replace function public.base_arg(p jsonb, f text, mx int) returns int language sql immutable as $$
  select case when jsonb_typeof(p->f) = 'number' and (p->>f) ~ '^\d{1,7}$' and (p->>f)::int <= mx then (p->>f)::int end
$$;
-- Монеты 🪙: сколько есть / списать (журнал coin_log, источник 'base')
create or replace function public.base_coins_(p_uid uuid) returns int language sql stable security definer set search_path = public as $$
  select coalesce((select w.coins from public.coin_wallet w where w.user_id = p_uid), 0)
$$;
create or replace function public.base_pay_(p_uid uuid, p_n int, p_ref text) returns boolean language plpgsql security definer set search_path = public as $$
declare v_bal int;
begin
  select w.coins into v_bal from public.coin_wallet w where w.user_id = p_uid for update;
  if coalesce(v_bal, 0) < p_n then return false; end if;
  update public.coin_wallet set coins = coins - p_n, updated_at = now() where user_id = p_uid;
  insert into public.coin_log (user_id, amount, source, ref) values (p_uid, -p_n, 'base', left(coalesce(p_ref, ''), 40));
  return true;
end $$;
-- Пускают ли в дом хозяина p_owner (для RLS base_rooms и base_room)
create or replace function public.base_can_enter(p_owner uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_owner = auth.uid(), false) or exists (
    select 1 from public.bases b where b.user_id = p_owner and (b.access = 'all' or (b.access = 'friends' and auth.uid() is not null and exists (
      select 1 from public.friendships f where f.status = 'accepted'
        and ((f.requester_id = p_owner and f.addressee_id = auth.uid()) or (f.requester_id = auth.uid() and f.addressee_id = p_owner)))))
  )
$$;
-- Всё о своём участке (ответ base_state / base_act / base_claim)
create or replace function public.base_view(p_uid uuid, p_now bigint) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'now', p_now, 'plot', b.plot, 'bricks', b.bricks, 'layout', public.base_norm(b.layout, p_now),
    'room', coalesce(r.items, '[]'::jsonb), 'own', b.own, 'access', b.access, 'seq', b.seq, 'rev', b.rev, 'likes', b.likes,
    'gift', b.gift_day is distinct from public.base_today(), 'coins', public.base_coins_(p_uid))
  from public.bases b left join public.base_rooms r on r.user_id = b.user_id where b.user_id = p_uid
$$;

-- ── Чтение ──
alter table public.bases enable row level security;
drop policy if exists "Участки видят все" on public.bases;
create policy "Участки видят все" on public.bases for select using (true);
alter table public.base_rooms enable row level security;
drop policy if exists "Дом видят те, кого пускают" on public.base_rooms;
create policy "Дом видят те, кого пускают" on public.base_rooms for select using (public.base_can_enter(user_id));
alter table public.base_likes enable row level security;
drop policy if exists "Свои лайки видит сам" on public.base_likes;
create policy "Свои лайки видит сам" on public.base_likes for select using (auth.uid() = liker);
-- писать напрямую нельзя никому — только функциями ниже

create or replace function public.base_state() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth', 'now', public.base_now()); end if;
  return coalesce(public.base_view(auth.uid(), public.base_now()), jsonb_build_object('ok', false, 'reason', 'none', 'now', public.base_now()));
end $$;

-- Улица: 6 участков (постройки, ник хозяина, доступ к дому, 👍) + самый большой занятый номер (сколько улиц)
create or replace function public.base_street(p_street int) returns jsonb language sql stable security definer set search_path = public as $$
  with s as (select greatest(0, least(99, coalesce(p_street, 0))) as n, public.base_now() as nw)
  select jsonb_build_object('ok', true, 'now', s.nw, 'street', s.n, 'max', coalesce((select max(b.plot) from public.bases b), 0),
    'plots', coalesce((select jsonb_agg(jsonb_build_object('p', b.plot, 'uid', b.user_id, 'nick', coalesce(pr.nick, 'Игрок'), 'layout', public.base_norm(b.layout, s.nw),
        'access', b.access, 'rev', b.rev, 'likes', b.likes) order by b.plot)
      from public.bases b left join public.profiles pr on pr.id = b.user_id
      where b.plot between s.n * 6 + 1 and s.n * 6 + 6), '[]'::jsonb))
  from s
$$;

-- Мебель чужого дома — если хозяин пускает
create or replace function public.base_room(p_owner uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select case when b.user_id is null then jsonb_build_object('ok', false, 'reason', 'none')
    when not public.base_can_enter(p_owner) then jsonb_build_object('ok', false, 'reason', 'access', 'access', b.access)
    else jsonb_build_object('ok', true, 'items', coalesce(r.items, '[]'::jsonb), 'rev', b.rev) end
  from (select p_owner as id) x left join public.bases b on b.user_id = x.id left join public.base_rooms r on r.user_id = b.user_id
$$;

-- ── Занять участок (один на человека). p_import — пробный участок из браузера: проверяется заново, уровни — до 2,
--    кирпичи — до 500, вещи за монеты не переносятся ──
create or replace function public.base_claim(p_plot int, p_import jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_now bigint := public.base_now(); v_dk jsonb := public.base_defs()->'k'; v_df jsonb := public.base_defs()->'f';
  v_l jsonb := '[]'::jsonb; v_rm jsonb := '[]'::jsonb; v_own jsonb := '{}'::jsonb; v_seq int := 0; v_br int := 600;
  v_imp jsonb; v_e jsonb; v_k text; v_def jsonb; v_x int; v_z int; v_r int; v_lv int; v_t int; v_fp int[]; v_lim int; v_cnt int; v_hl int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_plot is null or p_plot < 1 or p_plot > 600 then return jsonb_build_object('ok', false, 'reason', 'plot'); end if;
  if exists (select 1 from public.bases b where b.user_id = v_uid) then return jsonb_build_object('ok', false, 'reason', 'has'); end if;
  if exists (select 1 from public.bases b where b.plot = p_plot) then return jsonb_build_object('ok', false, 'reason', 'taken'); end if;
  if p_import is null or jsonb_typeof(p_import) <> 'object' then
    v_l := jsonb_build_array(
      jsonb_build_object('i', 1, 'k', 'th', 'x', 5, 'z', 2, 'r', 0, 'l', 1),
      jsonb_build_object('i', 2, 'k', 'house', 'x', 0, 'z', 6, 'r', 0, 'l', 1),
      jsonb_build_object('i', 3, 'k', 'mine', 'x', 9, 'z', 7, 'r', 0, 'l', 1, 't0', v_now));
    v_rm := jsonb_build_array(jsonb_build_object('i', 4, 'k', 'bed', 'x', 0, 'z', 0, 'r', 0), jsonb_build_object('i', 5, 'k', 'rug', 'x', 3, 'z', 3, 'r', 0));
    v_own := '{"f:bed": 1, "f:rug": 1}'::jsonb; v_seq := 5;
  else
    v_imp := case when jsonb_typeof(p_import->'layout') = 'array' then p_import->'layout' else '[]'::jsonb end;
    v_t := least(2, greatest(1, coalesce((select public.base_arg(q.e, 'l', 5) from jsonb_array_elements(v_imp) q(e) where q.e->>'k' = 'th' limit 1), 1)));
    -- ратуша и дом — первыми: на своих клетках, а если там нельзя — на стандартных
    foreach v_k in array array['th', 'house'] loop
      v_e := (select q.e from jsonb_array_elements(v_imp) q(e) where q.e->>'k' = v_k limit 1);
      v_x := public.base_arg(v_e, 'x', 11); v_z := public.base_arg(v_e, 'z', 11); v_r := public.base_arg(v_e, 'r', 3);
      if v_x is null or v_z is null or v_r is null then v_x := -1; end if;
      v_fp := public.base_fp(v_k, coalesce(v_r, 0));
      if v_x < 0 or not public.base_fits(v_l, v_x, v_z, v_fp[1], v_fp[2], 0) then
        v_x := case v_k when 'th' then 5 else 0 end; v_z := case v_k when 'th' then 2 else 6 end; v_r := 0; v_fp := public.base_fp(v_k, 0);
        if not public.base_fits(v_l, v_x, v_z, v_fp[1], v_fp[2], 0) then return jsonb_build_object('ok', false, 'reason', 'layout'); end if;
      end if;
      v_lv := case when v_k = 'th' then v_t else least(v_t, greatest(1, coalesce(public.base_arg(v_e, 'l', 5), 1))) end;
      v_seq := v_seq + 1;
      v_l := v_l || jsonb_build_array(jsonb_build_object('i', v_seq, 'k', v_k, 'x', v_x, 'z', v_z, 'r', v_r, 'l', v_lv));
    end loop;
    for v_e in select q.e from jsonb_array_elements(v_imp) q(e) limit 200 loop
      v_k := v_e->>'k'; v_def := v_dk->v_k;
      if v_def is null or v_def ? 'fixed' or coalesce((v_def->>'coins')::int, 0) > 0 or coalesce((v_def->>'th')::int, 1) > v_t then continue; end if;
      v_x := public.base_arg(v_e, 'x', 11); v_z := public.base_arg(v_e, 'z', 11); v_r := public.base_arg(v_e, 'r', 3);
      if v_x is null or v_z is null or v_r is null then continue; end if;
      if v_def->>'g' = 'deco' then
        v_lim := (public.base_defs()->'deco'->>(v_t - 1))::int;
        select count(*) into v_cnt from jsonb_array_elements(v_l) q(e) where v_dk->(q.e->>'k')->>'g' = 'deco';
      else
        v_lim := (v_def->'max'->>(v_t - 1))::int;
        select count(*) into v_cnt from jsonb_array_elements(v_l) q(e) where q.e->>'k' = v_k;
      end if;
      if v_cnt >= v_lim then continue; end if;
      v_fp := public.base_fp(v_k, v_r);
      if not public.base_fits(v_l, v_x, v_z, v_fp[1], v_fp[2], 0) then continue; end if;
      v_lv := least((v_def->>'lv')::int, v_t, greatest(1, coalesce(public.base_arg(v_e, 'l', 5), 1)));
      v_seq := v_seq + 1;
      v_l := v_l || jsonb_build_array(jsonb_build_object('i', v_seq, 'k', v_k, 'x', v_x, 'z', v_z, 'r', v_r, 'l', v_lv)
        || case when v_k = 'mine' then jsonb_build_object('t0', v_now) else '{}'::jsonb end);
      if v_def->>'g' = 'deco' then v_own := jsonb_set(v_own, array[v_k], to_jsonb(coalesce((v_own->>v_k)::int, 0) + 1)); end if;
    end loop;
    v_hl := public.base_house_lv(v_l);
    for v_e in select q.e from jsonb_array_elements(case when jsonb_typeof(p_import->'room') = 'array' then p_import->'room' else '[]'::jsonb end) q(e) limit 60 loop
      v_k := v_e->>'k'; v_def := v_df->v_k;
      if v_def is null or coalesce((v_def->>'coins')::int, 0) > 0 then continue; end if;
      v_x := public.base_arg(v_e, 'x', 8); v_z := public.base_arg(v_e, 'z', 8); v_r := public.base_arg(v_e, 'r', 3);
      if v_x is null or v_z is null or v_r is null then continue; end if;
      exit when jsonb_array_length(v_rm) >= (v_dk->'house'->'furn'->>(v_hl - 1))::int;
      v_fp := public.base_ffp(v_k, v_r);
      if not public.base_ffits(v_rm, v_k, v_x, v_z, v_fp[1], v_fp[2], 0) then continue; end if;
      v_seq := v_seq + 1;
      v_rm := v_rm || jsonb_build_array(jsonb_build_object('i', v_seq, 'k', v_k, 'x', v_x, 'z', v_z, 'r', v_r));
      v_own := jsonb_set(v_own, array['f:' || v_k], to_jsonb(coalesce((v_own->>('f:' || v_k))::int, 0) + 1));
    end loop;
    v_br := least(500, coalesce(public.base_arg(p_import, 'bricks', 1000000), 0));
  end if;
  begin
    insert into public.bases (user_id, plot, bricks, layout, own, seq, rev) values (v_uid, p_plot, v_br, v_l, v_own, v_seq, 1);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', case when exists (select 1 from public.bases b where b.user_id = v_uid) then 'has' else 'taken' end);
  end;
  insert into public.base_rooms (user_id, items) values (v_uid, v_rm)
    on conflict (user_id) do update set items = excluded.items, updated_at = now();
  return public.base_view(v_uid, v_now);
end $$;

-- ── Ход на своём участке (как Rules.act в mir-base.js; порядок проверок тот же) ──
--   place {k, x, z, r} · move {id, x, z, r} · remove {id} (украшение — в запас) · upgrade {id} · collect {id?} · finish {id} (за 🪙)
--   gift · access {a: all|friends|nobody} · fplace {k, x, z, r} · fmove {id, x, z, r} · fremove {id} · like {uid} (чужому участку)
--   Не больше 120 ходов в минуту. Ответ — всё о своём участке (как base_state) + got/id/spent или {ok: false, reason}.
create or replace function public.base_act(p_act text, p_a jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_now bigint := public.base_now(); v_dd jsonb := public.base_defs(); v_dk jsonb := v_dd->'k'; v_df jsonb := v_dd->'f';
  v_b public.bases%rowtype; v_tgt public.bases%rowtype;
  v_l jsonb; v_rm jsonb; v_own jsonb; v_br int; v_seq int; v_acc text; v_gd date; v_err text; v_xtra jsonb := '{}'::jsonb; v_room boolean := false;
  v_k text; v_def jsonb; v_x int; v_z int; v_r int; v_id int; v_idx int; v_it jsonb; v_fp int[]; v_t int; v_lim int; v_cnt int;
  v_tm int; v_cost int; v_coins int; v_nl int; v_inv boolean; v_got int; v_tot int; v_add int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  p_a := coalesce(p_a, '{}'::jsonb);
  if jsonb_typeof(p_a) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'args'); end if;

  -- 👍 чужому участку: раз в день от человека каждому участку, до 20 в день; хозяину +10 🧱 (сколько влезет)
  if p_act = 'like' then
    if coalesce(p_a->>'uid', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
    if (p_a->>'uid')::uuid = v_uid then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
    select * into v_tgt from public.bases b where b.user_id = (p_a->>'uid')::uuid for update;
    if not found then return jsonb_build_object('ok', false, 'reason', 'id'); end if;
    if (select count(*) from public.base_likes bl where bl.liker = v_uid and bl.day = public.base_today()) >= 20 then return jsonb_build_object('ok', false, 'reason', 'max'); end if;
    insert into public.base_likes (owner, liker, day) values (v_tgt.user_id, v_uid, public.base_today()) on conflict do nothing;
    if not found then return jsonb_build_object('ok', false, 'reason', 'done'); end if;
    v_add := least(10, greatest(0, public.base_cap(public.base_norm(v_tgt.layout, v_now)) - v_tgt.bricks));
    update public.bases set likes = likes + 1, bricks = bricks + v_add, rev = rev + 1, updated_at = now() where user_id = v_tgt.user_id returning likes, rev into v_cnt, v_tm;
    return jsonb_build_object('ok', true, 'likes', v_cnt, 'plot', v_tgt.plot, 'rev', v_tm, 'now', v_now);
  end if;

  select * into v_b from public.bases b where b.user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  if v_now - v_b.act_t >= 60 then v_b.act_t := v_now; v_b.act_n := 0; end if;
  if v_b.act_n >= 120 then return jsonb_build_object('ok', false, 'reason', 'too_fast'); end if;
  v_b.act_n := v_b.act_n + 1;
  v_l := public.base_norm(v_b.layout, v_now);
  v_rm := coalesce((select br.items from public.base_rooms br where br.user_id = v_uid), '[]'::jsonb);
  v_own := coalesce(v_b.own, '{}'::jsonb); v_br := v_b.bricks; v_seq := v_b.seq; v_acc := v_b.access; v_gd := v_b.gift_day;
  v_t := public.base_th(v_l);

  <<main>>
  begin
    if p_act = 'place' then
      v_k := p_a->>'k'; v_x := public.base_arg(p_a, 'x', 11); v_z := public.base_arg(p_a, 'z', 11); v_r := public.base_arg(p_a, 'r', 3);
      if v_k is null or v_x is null or v_z is null or v_r is null then v_err := 'args'; exit main; end if;
      v_def := v_dk->v_k;
      if v_def is null or v_def ? 'fixed' then v_err := 'kind'; exit main; end if;
      if coalesce((v_def->>'th')::int, 1) > v_t then v_err := 'th'; exit main; end if;
      if v_def->>'g' = 'deco' then
        v_lim := (v_dd->'deco'->>(v_t - 1))::int;
        select count(*) into v_cnt from jsonb_array_elements(v_l) q(e) where v_dk->(q.e->>'k')->>'g' = 'deco';
      else
        v_lim := (v_def->'max'->>(v_t - 1))::int;
        select count(*) into v_cnt from jsonb_array_elements(v_l) q(e) where q.e->>'k' = v_k;
      end if;
      if v_lim <= 0 then v_err := 'th'; exit main; end if;
      if v_cnt >= v_lim then v_err := 'max'; exit main; end if;
      v_fp := public.base_fp(v_k, v_r);
      if not public.base_fits(v_l, v_x, v_z, v_fp[1], v_fp[2], 0) then v_err := 'place'; exit main; end if;
      v_tm := (v_def->'time'->>0)::int; v_coins := coalesce((v_def->>'coins')::int, 0); v_cost := (v_def->'cost'->>0)::int;
      select count(*) into v_cnt from jsonb_array_elements(v_l) q(e) where q.e->>'k' = v_k;
      v_inv := v_def->>'g' = 'deco' and coalesce((v_own->>v_k)::int, 0) > v_cnt;
      if not v_inv then
        if v_coins > 0 then
          if public.base_coins_(v_uid) < v_coins then v_err := 'coins'; exit main; end if;
        elsif v_br < v_cost then v_err := 'bricks'; exit main;
        end if;
      end if;
      if v_tm > 0 and public.base_busy(v_l) >= public.base_builders(v_l) then v_err := 'builder'; exit main; end if;
      if not v_inv then
        if v_coins > 0 then
          if not public.base_pay_(v_uid, v_coins, 'place:' || v_k) then v_err := 'coins'; exit main; end if;
          v_xtra := jsonb_build_object('spent', v_coins);
        else v_br := v_br - v_cost;
        end if;
        if v_def->>'g' = 'deco' then v_own := jsonb_set(v_own, array[v_k], to_jsonb(coalesce((v_own->>v_k)::int, 0) + 1)); end if;
      end if;
      v_seq := v_seq + 1;
      v_it := jsonb_build_object('i', v_seq, 'k', v_k, 'x', v_x, 'z', v_z, 'r', v_r, 'l', case when v_tm > 0 then 0 else 1 end);
      if v_tm > 0 then v_it := v_it || jsonb_build_object('ul', 1, 'ue', v_now + v_tm);
      elsif v_k = 'mine' then v_it := v_it || jsonb_build_object('t0', v_now);
      end if;
      v_l := v_l || jsonb_build_array(v_it);
      v_xtra := v_xtra || jsonb_build_object('id', v_seq);

    elsif p_act = 'move' then
      v_id := public.base_arg(p_a, 'id', 1000000); v_x := public.base_arg(p_a, 'x', 11); v_z := public.base_arg(p_a, 'z', 11); v_r := public.base_arg(p_a, 'r', 3);
      if v_id is null or v_x is null or v_z is null or v_r is null then v_err := 'args'; exit main; end if;
      select q.e, (q.o - 1)::int into v_it, v_idx from jsonb_array_elements(v_l) with ordinality q(e, o) where (q.e->>'i')::int = v_id;
      if v_it is null then v_err := 'id'; exit main; end if;
      v_fp := public.base_fp(v_it->>'k', v_r);
      if not public.base_fits(v_l, v_x, v_z, v_fp[1], v_fp[2], v_id) then v_err := 'place'; exit main; end if;
      v_l := jsonb_set(v_l, array[v_idx::text], v_it || jsonb_build_object('x', v_x, 'z', v_z, 'r', v_r));

    elsif p_act = 'remove' then
      v_id := public.base_arg(p_a, 'id', 1000000);
      if v_id is null then v_err := 'args'; exit main; end if;
      select q.e, (q.o - 1)::int into v_it, v_idx from jsonb_array_elements(v_l) with ordinality q(e, o) where (q.e->>'i')::int = v_id;
      if v_it is null then v_err := 'id'; exit main; end if;
      if (v_dk->(v_it->>'k')->>'g') is distinct from 'deco' then v_err := 'fixed'; exit main; end if;
      v_l := v_l - v_idx;

    elsif p_act = 'upgrade' then
      v_id := public.base_arg(p_a, 'id', 1000000);
      if v_id is null then v_err := 'args'; exit main; end if;
      select q.e, (q.o - 1)::int into v_it, v_idx from jsonb_array_elements(v_l) with ordinality q(e, o) where (q.e->>'i')::int = v_id;
      if v_it is null then v_err := 'id'; exit main; end if;
      v_def := v_dk->(v_it->>'k');
      if v_it ? 'ue' then v_err := 'busy'; exit main; end if;
      v_nl := (v_it->>'l')::int + 1;
      if v_nl > (v_def->>'lv')::int then v_err := 'maxlv'; exit main; end if;
      if v_it->>'k' <> 'th' and v_nl > v_t then v_err := 'lvcap'; exit main; end if;
      v_cost := (v_def->'cost'->>(v_nl - 1))::int; v_tm := (v_def->'time'->>(v_nl - 1))::int;
      if v_br < v_cost then v_err := 'bricks'; exit main; end if;
      if v_tm > 0 and public.base_busy(v_l) >= public.base_builders(v_l) then v_err := 'builder'; exit main; end if;
      if v_it->>'k' = 'mine' and v_tm > 0 then   -- перед улучшением шахта отдаёт накопленное
        select c.o_l, c.o_br into v_l, v_br from public.base_collect_(v_l, v_br, v_id, v_now) c;
        v_it := v_l->v_idx;
      end if;
      v_br := v_br - v_cost;
      if v_tm > 0 then v_it := v_it || jsonb_build_object('ul', v_nl, 'ue', v_now + v_tm);
      else v_it := v_it || jsonb_build_object('l', v_nl);
      end if;
      v_l := jsonb_set(v_l, array[v_idx::text], v_it);

    elsif p_act = 'collect' then
      v_id := null;
      if p_a ? 'id' and jsonb_typeof(p_a->'id') <> 'null' then
        v_id := public.base_arg(p_a, 'id', 1000000);
        if v_id is null then v_err := 'args'; exit main; end if;
      end if;
      select coalesce(sum(public.base_prod(q.e, v_now)), 0) into v_tot from jsonb_array_elements(v_l) q(e) where q.e->>'k' = 'mine' and (v_id is null or (q.e->>'i')::int = v_id);
      if v_tot <= 0 then v_err := 'empty'; exit main; end if;
      if public.base_cap(v_l) - v_br <= 0 then v_err := 'full'; exit main; end if;
      select c.o_l, c.o_br, c.o_got into v_l, v_br, v_got from public.base_collect_(v_l, v_br, v_id, v_now) c;
      v_xtra := jsonb_build_object('got', v_got);

    elsif p_act = 'finish' then
      v_id := public.base_arg(p_a, 'id', 1000000);
      if v_id is null then v_err := 'args'; exit main; end if;
      select q.e, (q.o - 1)::int into v_it, v_idx from jsonb_array_elements(v_l) with ordinality q(e, o) where (q.e->>'i')::int = v_id;
      if v_it is null then v_err := 'id'; exit main; end if;
      if not v_it ? 'ue' then v_err := 'idle'; exit main; end if;
      v_coins := greatest(1, ((v_it->>'ue')::bigint - v_now + 119) / 120)::int;   -- 1 🪙 за каждые 2 минуты
      if public.base_coins_(v_uid) < v_coins then v_err := 'coins'; exit main; end if;
      if not public.base_pay_(v_uid, v_coins, 'finish') then v_err := 'coins'; exit main; end if;
      v_it := (v_it - 'ul' - 'ue') || jsonb_build_object('l', (v_it->>'ul')::int) || case when v_it->>'k' = 'mine' then jsonb_build_object('t0', v_now) else '{}'::jsonb end;
      v_l := jsonb_set(v_l, array[v_idx::text], v_it);
      v_xtra := jsonb_build_object('spent', v_coins);

    elsif p_act = 'gift' then
      if v_gd = public.base_today() then v_err := 'done'; exit main; end if;
      v_add := least(50 + 50 * v_t, greatest(0, public.base_cap(v_l) - v_br));
      if v_add <= 0 then v_err := 'full'; exit main; end if;
      v_br := v_br + v_add; v_gd := public.base_today();
      v_xtra := jsonb_build_object('got', v_add);

    elsif p_act = 'access' then
      if coalesce(p_a->>'a', '') not in ('all', 'friends', 'nobody') or jsonb_typeof(p_a->'a') <> 'string' then v_err := 'args'; exit main; end if;
      v_acc := p_a->>'a';

    elsif p_act = 'fplace' then
      v_k := p_a->>'k'; v_x := public.base_arg(p_a, 'x', 8); v_z := public.base_arg(p_a, 'z', 8); v_r := public.base_arg(p_a, 'r', 3);
      if v_k is null or v_x is null or v_z is null or v_r is null then v_err := 'args'; exit main; end if;
      v_def := v_df->v_k;
      if v_def is null then v_err := 'kind'; exit main; end if;
      if jsonb_array_length(v_rm) >= (v_dk->'house'->'furn'->>(public.base_house_lv(v_l) - 1))::int then v_err := 'house'; exit main; end if;
      v_fp := public.base_ffp(v_k, v_r);
      if not public.base_ffits(v_rm, v_k, v_x, v_z, v_fp[1], v_fp[2], 0) then v_err := 'place'; exit main; end if;
      select count(*) into v_cnt from jsonb_array_elements(v_rm) q(e) where q.e->>'k' = v_k;
      v_inv := coalesce((v_own->>('f:' || v_k))::int, 0) > v_cnt;
      v_coins := coalesce((v_def->>'coins')::int, 0); v_cost := coalesce((v_def->>'cost')::int, 0);
      if not v_inv then
        if v_coins > 0 then
          if public.base_coins_(v_uid) < v_coins then v_err := 'coins'; exit main; end if;
          if not public.base_pay_(v_uid, v_coins, 'furn:' || v_k) then v_err := 'coins'; exit main; end if;
          v_xtra := jsonb_build_object('spent', v_coins);
        elsif v_br < v_cost then v_err := 'bricks'; exit main;
        else v_br := v_br - v_cost;
        end if;
        v_own := jsonb_set(v_own, array['f:' || v_k], to_jsonb(coalesce((v_own->>('f:' || v_k))::int, 0) + 1));
      end if;
      v_seq := v_seq + 1;
      v_rm := v_rm || jsonb_build_array(jsonb_build_object('i', v_seq, 'k', v_k, 'x', v_x, 'z', v_z, 'r', v_r));
      v_room := true;
      v_xtra := v_xtra || jsonb_build_object('id', v_seq);

    elsif p_act = 'fmove' then
      v_id := public.base_arg(p_a, 'id', 1000000); v_x := public.base_arg(p_a, 'x', 8); v_z := public.base_arg(p_a, 'z', 8); v_r := public.base_arg(p_a, 'r', 3);
      if v_id is null or v_x is null or v_z is null or v_r is null then v_err := 'args'; exit main; end if;
      select q.e, (q.o - 1)::int into v_it, v_idx from jsonb_array_elements(v_rm) with ordinality q(e, o) where (q.e->>'i')::int = v_id;
      if v_it is null then v_err := 'id'; exit main; end if;
      v_fp := public.base_ffp(v_it->>'k', v_r);
      if not public.base_ffits(v_rm, v_it->>'k', v_x, v_z, v_fp[1], v_fp[2], v_id) then v_err := 'place'; exit main; end if;
      v_rm := jsonb_set(v_rm, array[v_idx::text], v_it || jsonb_build_object('x', v_x, 'z', v_z, 'r', v_r));
      v_room := true;

    elsif p_act = 'fremove' then
      v_id := public.base_arg(p_a, 'id', 1000000);
      if v_id is null then v_err := 'args'; exit main; end if;
      select q.e, (q.o - 1)::int into v_it, v_idx from jsonb_array_elements(v_rm) with ordinality q(e, o) where (q.e->>'i')::int = v_id;
      if v_it is null then v_err := 'id'; exit main; end if;
      v_rm := v_rm - v_idx;
      v_room := true;

    else v_err := 'args';
    end if;
  end;

  if v_err is not null then
    update public.bases set act_t = v_b.act_t, act_n = v_b.act_n where user_id = v_uid;
    return jsonb_build_object('ok', false, 'reason', v_err, 'now', v_now);
  end if;
  update public.bases set layout = v_l, bricks = v_br, own = v_own, seq = v_seq, access = v_acc, gift_day = v_gd, rev = rev + 1,
    act_t = v_b.act_t, act_n = v_b.act_n, updated_at = now() where user_id = v_uid;
  if v_room then
    insert into public.base_rooms (user_id, items) values (v_uid, v_rm)
      on conflict (user_id) do update set items = excluded.items, updated_at = now();
  end if;
  return public.base_view(v_uid, v_now) || v_xtra;
end $$;

-- ── Права: снаружи — только эти функции; помощники (списание монет, чужое состояние) закрыты ──
revoke execute on function public.base_pay_(uuid, int, text) from public, anon, authenticated;
revoke execute on function public.base_coins_(uuid) from public, anon, authenticated;
revoke execute on function public.base_view(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.base_collect_(jsonb, int, int, bigint) from public, anon, authenticated;
revoke execute on function public.base_state() from public, anon;
revoke execute on function public.base_act(text, jsonb) from public, anon;
revoke execute on function public.base_claim(int, jsonb) from public, anon;
grant execute on function public.base_state() to authenticated;
grant execute on function public.base_act(text, jsonb) to authenticated;
grant execute on function public.base_claim(int, jsonb) to authenticated;
grant execute on function public.base_street(int) to anon, authenticated;
grant execute on function public.base_room(uuid) to anon, authenticated;
grant execute on function public.base_can_enter(uuid) to anon, authenticated;
