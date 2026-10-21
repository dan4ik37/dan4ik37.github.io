-- ═══════════════════════════════════════════════════════════════════
--  «МИР ДЕНЧИКА»: РАЙОН УЧАСТКОВ (мирный: дом с мебелью, гости — как в Аватарии) и ВОЕННЫЕ БАЗЫ боевой зоны (12+: главарь, состав,
--  оборона, казарма, техника — как Clash of Clans и Military Tycoon; js/games/mir-base.js). Выполнить целиком в Supabase → SQL Editor.
--  Идемпотентно (можно запускать ещё раз). Нужны (уже применены): profiles, friendships (friends-dm.sql), coin_wallet и coin_log
--  (coins.sql); age.sql — желательно (возраст 12+ для баз; нет — пускаем всех); notifications.sql — желательно (🔔).
--
--  РАЙОН. Участок: номер 1…600 (улица = (номер − 1) / 6), ОДИН на человека (base_claim). Постройки — bases.layout (jsonb):
--  [{i, k, x, z, r, l, ul?, ue?, t0?}] — номер, вид, клетка 0…11, поворот 0…3, уровень (0 — строится), до какого
--  уровня и когда (ue — секунды эпохи) идёт стройка, с какого момента копит шахта (t0). Мебель — base_rooms.items
--  [{i, k, x, z, r}] (комната 9×9). Купленные украшения и мебель — own {"tree": 2, "f:tv": 1} (убранное — в запасе).
--  Меняется ТОЛЬКО через base_act (security definer): сервер сам проверяет каталог (base_defs — тот же, что DEFS/FURN
--  в mir-base.js; тест PGlite сверяет оба и прогоняет одни и те же ходы), клетки, пересечения, лимиты по уровню ратуши,
--  цену, строителей, время по своим часам. Добыча шахт и конец стройки — по отметкам времени: клиент только рисует.
--  Читать: участки — все (base_street и таблица bases); дом — кого пускает хозяин (base_room и RLS base_rooms): все /
--  друзья (friendships) / никто. Монеты 🪙 (coin_wallet) — только «ускорить стройку» и вещи за монеты.
--  Набегов на район НЕТ (владелец 15.10, п. 31): оборона, казарма и армия переехали в военные базы. Перенос (ниже): если на участке
--  остались казарма, пушки, мортиры, бомбы, воздушные мины, армия или вышка выше 3 уровня (так было в черновике набегов) — всё
--  уходит, а кирпичи за постройки и отряды возвращаются на участок (вышка остаётся смотровой, 3 ур.). На живой базе такого не было.
--  ВОЕННЫЕ БАЗЫ — раздел ниже (war_*). Набеги — raids.sql (ПОСЛЕ этого файла).
--  Каталоги base_defs() и war_defs() собирает scripts/gen-base-defs.cjs из js/games/mir-base.js (руками не править).
--  Проверка после запуска: /rpc/base_street {"p_street":0} → {"ok": true, …}; /rpc/war_state гостем → {"ok":false,"reason":"auth"}
--  (PGRST202 — не применён); /rpc/war_sector {"p_sector":0} → {"ok":true,"bases":[…]}; /rpc/war_defs → есть "ring" и "veh".
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
-- на старт, deco — лимит украшений по уровню ратуши, door — проход от двери (x0, x1, z0, z1); k — постройки, f — мебель,
-- u — отряды казармы, hero — герой, raid — правила набегов (raids.sql). Собирает node scripts/gen-base-defs.cjs
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
-- ── Очередь тренировки (армия военной базы; как WRules.qnorm в mir-base.js) ──
-- Очередь тренировки: готовые (ue ≤ сейчас) — в армию. Очередь — одна цепочка, ue растут
create or replace function public.base_qnorm(p_q jsonb, p_army jsonb, p_now bigint, out o_q jsonb, out o_army jsonb)
language plpgsql immutable as $$
declare v_e jsonb;
begin
  o_q := '[]'::jsonb; o_army := coalesce(p_army, '{}'::jsonb);
  for v_e in select q.e from jsonb_array_elements(coalesce(p_q, '[]'::jsonb)) with ordinality q(e, o) order by q.o loop
    if (v_e->>'ue')::bigint <= p_now then
      o_army := jsonb_set(o_army, array[v_e->>'u'], to_jsonb(coalesce((o_army->>(v_e->>'u'))::int, 0) + 1));
    else o_q := o_q || jsonb_build_array(v_e);
    end if;
  end loop;
end $$;
drop function if exists public.base_barracks_lv(jsonb);
drop function if exists public.base_space(jsonb, jsonb, jsonb);

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

-- ═══════════════════════════════════════════════════════════════════
--  ВОЕННЫЕ БАЗЫ боевой зоны (12+; js/games/mir-base.js — startWar, WDEFS, WRules; набеги — raids.sql ПОСЛЕ этого файла).
--  Участок базы — один из 12 участков сектора боевой зоны (js/games/mir-war.js PLOTS wb01…wb12); номер базы 1…1200, сектор =
--  (номер − 1) / 12. Основал — главарь (war_claim); состав — war_members: главарь, офицеры, бойцы; вступают по ссылке-приглашению
--  (war_join, код — у главаря и офицеров), выходят (war_leave), главарь управляет составом (war_member) и настройками (war_set).
--  Имя — из готовых (war_defs()->'names' штук) + номер 1…99, без своего текста (детская аудитория). Возраст — 12+ и на сервере
--  (war_age_ok: год из age.sql). Постройки — war_bases.layout (как участок района, сетка 32 × 32, открытая часть по штабу —
--  war_defs()->'ring', занятые клетки у въезда — 'block'), казна — bricks; армия базы — army / army_out / queue; техника — veh.
--  Строят, тренируют, покупают технику — главарь и офицеры (war_act); собирать, дарить кирпичи из района (give), ускорять за 🪙,
--  забирать подарок дня — любой из состава. Читать — только функциями (war_sector — всем, без ловушек; war_state — своим).
-- ═══════════════════════════════════════════════════════════════════
create table if not exists public.war_bases (
  id int primary key,
  leader uuid not null unique references public.profiles(id) on delete cascade
);
alter table public.war_bases add column if not exists name_k int not null default 0;
alter table public.war_bases add column if not exists name_n int not null default 1;
alter table public.war_bases add column if not exists color int not null default 0;
alter table public.war_bases add column if not exists bricks int not null default 0;
alter table public.war_bases add column if not exists layout jsonb not null default '[]'::jsonb;
alter table public.war_bases add column if not exists own jsonb not null default '{}'::jsonb;
alter table public.war_bases add column if not exists seq int not null default 0;
alter table public.war_bases add column if not exists rev int not null default 0;
alter table public.war_bases add column if not exists gift_day date;
alter table public.war_bases add column if not exists act_t bigint not null default 0;
alter table public.war_bases add column if not exists act_n int not null default 0;
alter table public.war_bases add column if not exists army jsonb not null default '{}'::jsonb;
alter table public.war_bases add column if not exists army_out jsonb not null default '{}'::jsonb;
alter table public.war_bases add column if not exists queue jsonb not null default '[]'::jsonb;
alter table public.war_bases add column if not exists veh jsonb not null default '{}'::jsonb;
alter table public.war_bases add column if not exists invite text;
alter table public.war_bases add column if not exists raid_rank text not null default 'officer';
alter table public.war_bases add column if not exists trophies int not null default 0;          -- кубки набегов (raids.sql)
alter table public.war_bases add column if not exists skin text not null default '';            -- облик базы (raids.sql)
alter table public.war_bases add column if not exists shield_until bigint not null default 0;   -- щит от набегов (raids.sql)
alter table public.war_bases add column if not exists created_at timestamptz not null default now();
alter table public.war_bases add column if not exists updated_at timestamptz not null default now();
do $$ begin alter table public.war_bases add constraint war_bases_id_chk check (id between 1 and 1200); exception when duplicate_object then null; end $$;
do $$ begin alter table public.war_bases add constraint war_bases_bricks_chk check (bricks >= 0); exception when duplicate_object then null; end $$;
do $$ begin alter table public.war_bases add constraint war_bases_rank_chk check (raid_rank in ('officer', 'soldier')); exception when duplicate_object then null; end $$;
create unique index if not exists uq_war_bases_name on public.war_bases (name_k, name_n);
create unique index if not exists uq_war_bases_invite on public.war_bases (invite) where invite is not null;

create table if not exists public.war_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  base_id int not null references public.war_bases(id) on delete cascade
);
alter table public.war_members add column if not exists rank text not null default 'soldier';
alter table public.war_members add column if not exists joined_at timestamptz not null default now();
alter table public.war_members add column if not exists given int not null default 0;            -- сколько кирпичей подарил в казну
alter table public.war_members add column if not exists give_day date;
alter table public.war_members add column if not exists give_n int not null default 0;
do $$ begin alter table public.war_members add constraint war_members_rank_chk check (rank in ('leader', 'officer', 'soldier')); exception when duplicate_object then null; end $$;
create index if not exists idx_war_members_base on public.war_members (base_id);
-- после выхода / роспуска — 10 минут нельзя основать или вступить (без «карусели» баз)
create table if not exists public.war_cool (user_id uuid primary key references public.profiles(id) on delete cascade, until bigint not null default 0);

-- читать и писать напрямую нельзя никому — только функциями ниже
alter table public.war_bases enable row level security;
alter table public.war_members enable row level security;
alter table public.war_cool enable row level security;
revoke all on public.war_bases, public.war_members, public.war_cool from anon, authenticated;

-- Каталог военной базы — КАК WSERVER в mir-base.js (собирает node scripts/gen-base-defs.cjs): n — клеток участка, ring — открытая
-- часть по штабу, per — участков в секторе, plots — номеров, start — 🧱 в казне на старт, deco — лимит украшений, give — 🧱 в день
-- от человека в казну, block — занятые клетки [x, z, w, d], names / colors — сколько готовых имён и цветов; k — постройки, u — отряды,
-- hero — герой, veh — техника, raid — правила набегов (raids.sql)
create or replace function public.war_defs() returns jsonb language sql immutable as $$
  select '{"n":32,"ring":[16,20,24,28,32],"per":12,"plots":1200,"start":1000,"deco":[10,16,24,32,40],"give":1000,"block":[[6,26,5,5],[14,28,4,4]],"names":16,"colors":8,
  "k":{
    "th":{"w":3,"d":3,"lv":5,"fixed":1,"cost":[0,500,2000,6000,15000],"time":[0,300,1800,7200,28800],"max":[1,1,1,1,1],"keep":[1000,1500,2500,4000,6000],"hp":[1700,2000,2350,2650,3050],"crew":[6,9,12,16,20]},
    "mine":{"w":2,"d":2,"lv":5,"cost":[100,250,800,2500,7000],"time":[20,120,1200,5400,18000],"max":[2,3,4,5,6],"rate":[150,250,400,600,900],"hold":[1200,2000,3200,4800,7200],"hp":[420,480,550,610,680]},
    "factory":{"w":3,"d":3,"lv":4,"cost":[1500,4000,9000,18000],"time":[600,3600,14400,28800],"max":[0,1,1,2,2],"rate":[500,750,1050,1400],"hold":[4000,6000,8400,11200],"th":2,"hp":[900,1050,1200,1400]},
    "store":{"w":2,"d":2,"lv":5,"cost":[150,400,1200,3500,9000],"time":[20,180,1500,5400,18000],"max":[1,2,3,4,5],"keep":[1000,2500,5000,8000,12000],"hp":[550,620,700,790,880]},
    "shop":{"w":2,"d":2,"lv":1,"cost":[1000],"time":[600],"max":[0,1,1,2,2],"hp":[650]},
    "barracks":{"w":2,"d":2,"lv":5,"cost":[200,600,1800,4500,10000],"time":[60,600,3600,10800,21600],"max":[1,1,2,2,2],"hp":[550,620,700,790,880],"army":[18,38,76,110,155]},
    "tower":{"w":2,"d":2,"lv":5,"cost":[400,1200,3000,7000,14000],"time":[120,1200,5400,14400,28800],"max":[1,2,3,4,5],"hp":[520,580,650,730,800],"atk":{"dmg":[26,31,35,42,48],"cd":0.6,"rng":5.5,"min":0,"sp":0,"fly":0,"gnd":1,"air":1}},
    "cannon":{"w":2,"d":2,"lv":5,"cost":[250,700,2000,5000,11000],"time":[60,600,3600,10800,21600],"max":[2,3,4,5,6],"hp":[570,650,730,810,900],"atk":{"dmg":[44,53,62,70,79],"cd":1,"rng":4.5,"min":0,"sp":0,"fly":0,"gnd":1,"air":0}},
    "mortar":{"w":2,"d":2,"lv":4,"cost":[800,2500,6000,12000],"time":[600,3600,10800,28800],"max":[0,1,2,2,3],"th":2,"hp":[680,770,860,960],"atk":{"dmg":[46,55,64,74],"cd":4,"rng":7,"min":2,"sp":1.2,"fly":1,"gnd":1,"air":0}},
    "bomb":{"w":1,"d":1,"lv":3,"cost":[100,400,1200],"time":[0,0,0],"max":[3,5,7,9,12],"trap":{"dmg":[100,125,155],"trig":0.6,"sp":1.5,"delay":0.5,"gnd":1,"air":0}},
    "airmine":{"w":1,"d":1,"lv":3,"cost":[300,900,2500],"time":[0,0,0],"max":[0,0,2,3,4],"th":3,"trap":{"dmg":[250,320,390],"trig":1.5,"sp":0,"delay":0,"gnd":0,"air":1}},
    "wall":{"w":1,"d":1,"lv":5,"cost":[10,30,80,200,500],"time":[0,0,0,0,0],"max":[40,70,100,130,160],"hp":[260,550,990,1380,1860]},
    "garage":{"w":3,"d":3,"lv":3,"cost":[300,1500,5000],"time":[60,1200,7200],"max":[1,1,1,2,2],"hp":[700,850,1000],"slots":[1,2,3]},
    "helipad":{"w":3,"d":3,"lv":2,"cost":[2000,6000],"time":[600,7200],"max":[0,1,1,1,1],"th":2,"hp":[500,650],"slots":[1,2]},
    "hangar":{"w":4,"d":4,"lv":2,"cost":[5000,12000],"time":[3600,14400],"max":[0,0,1,1,1],"th":3,"hp":[1200,1500],"slots":[1,2]},
    "dock":{"w":3,"d":3,"lv":2,"cost":[1500,5000],"time":[600,7200],"max":[0,1,1,1,1],"th":2,"hp":[500,650],"slots":[1,2]},
    "bunker":{"w":2,"d":2,"lv":1,"cost":[500],"time":[300],"max":[1,1,1,1,1],"hp":[900]},
    "flag":{"w":1,"d":1,"lv":1,"cost":[50],"time":[0],"g":"deco"},
    "lamp":{"w":1,"d":1,"lv":1,"cost":[40],"time":[0],"g":"deco"},
    "rock":{"w":1,"d":1,"lv":1,"cost":[10],"time":[0],"g":"deco"},
    "pine":{"w":1,"d":1,"lv":1,"cost":[30],"time":[0],"g":"deco"},
    "bush":{"w":1,"d":1,"lv":1,"cost":[15],"time":[0],"g":"deco"},
    "bags":{"w":2,"d":1,"lv":1,"cost":[40],"time":[0],"g":"deco"},
    "crates":{"w":1,"d":1,"lv":1,"cost":[30],"time":[0],"g":"deco"}},
  "u":{
    "fighter":{"sp":1,"cost":5,"time":15,"lv":1,"hp":90,"dmg":10,"cd":1,"rng":0.6,"spd":1.6,"tgt":"any"},
    "archer":{"sp":1,"cost":8,"time":18,"lv":1,"hp":40,"dmg":9,"cd":1,"rng":3,"spd":1.6,"tgt":"any"},
    "tank":{"sp":4,"cost":30,"time":60,"lv":2,"hp":650,"dmg":18,"cd":2,"rng":0.6,"spd":1,"tgt":"def"},
    "breaker":{"sp":2,"cost":20,"time":40,"lv":3,"hp":30,"dmg":40,"cd":1,"rng":0.5,"spd":2.4,"tgt":"wall","wdmg":300,"boom":1},
    "flyer":{"sp":3,"cost":40,"time":75,"lv":4,"hp":180,"dmg":60,"cd":2,"rng":0.4,"spd":1.2,"tgt":"def","air":1,"splash":0.6},
    "healer":{"sp":5,"cost":60,"time":120,"lv":5,"hp":300,"cd":1,"rng":1,"spd":1.4,"tgt":"heal","air":1,"heal":30,"hr":2}},
  "hero":{
    "hp":[420,550,680,810,940],
    "dmg":[30,40,50,60,70],
    "cd":1,
    "rng":0.7,
    "spd":1.8,
    "tgt":"any",
    "ab":[200,280,360,440,520],
    "abr":2},
  "veh":{
    "jeep":{"b":"garage","lv":1,"cost":400}, "tank":{"b":"garage","lv":3,"cost":6000}, "heli":{"b":"helipad","lv":1,"cost":3000},
    "plane":{"b":"hangar","lv":1,"cost":8000}, "motorboat":{"b":"dock","lv":1,"cost":600}, "patrol":{"b":"dock","lv":2,"cost":3500}},
  "raid":{
    "tps":20,"max":180,"scout":30,"go":45,"cancel":60,"grace":240,
    "loot":{"pct":20,"step":6,"min":5,"mine":35,"th":40,"prot":[400,600,900,1300,1800],"sprot":[150,300,500,800,1200],"cap":[800,1600,3000,5000,8000],"day":[3000,6000,10000,16000,24000],"lose":[1600,3200,6000,10000,16000],"pair":20},
    "tr":{"win":20,"wdiv":10,"wmin":6,"wmax":36,"lose":14,"ldiv":12,"lmin":4,"lmax":28},
    "shield":{"s2":8,"s3":12,"guard":30,"newbie":3},
    "day":{"battles":20,"search":100,"bots":3},"next":[10,25,50,80,120],"league":[0,100,400,800,1300,1900,2600],"bonus":[0,20,40,70,110,160,220],
    "chest":[100,200,400,700,1000,1500,2000],"chestWins":3,"bot":[120,250,450,700,1000],"camp":[150,200,300,400,500,650,800,1000,1200,1500,1800,2200],
    "campTh":[1,1,2,2,2,3,3,3,4,4,5,5],"tut":300,
    "tutArmy":{"fighter":12,"archer":8},
    "shop":{"sh1":{"g":30,"h":24},"sh2":{"g":50,"h":48},"shWeek":7,"shMax":72,"fin":1200,"skin":{"winter":{"g":100},"gold":{"g":100},"neon":{"g":100},"autumn":{"c":800}},"army":{"knight":{"g":80},"robot":{"g":80}}}}}'::jsonb
$$;

-- ── Помощники (как WRules в mir-base.js) ──
create or replace function public.war_fp(p_k text, p_r int) returns int[] language sql immutable as $$
  select case when q.d is null then array[1, 1] when p_r % 2 = 1 then array[(q.d->>'d')::int, (q.d->>'w')::int] else array[(q.d->>'w')::int, (q.d->>'d')::int] end
  from (select public.war_defs()->'k'->p_k as d) q
$$;
-- Открытая часть участка по уровню штаба: [o, o + S)
create or replace function public.war_box(p_l jsonb) returns int[] language sql immutable as $$
  select array[(n - s) / 2, (n - s) / 2 + s] from (select (public.war_defs()->>'n')::int as n,
    (public.war_defs()->'ring'->>(least(jsonb_array_length(public.war_defs()->'ring'), public.base_th(p_l)) - 1))::int as s) q
$$;
create or replace function public.war_cap(p_l jsonb) returns int language sql immutable as $$
  select (public.war_defs()->'k'->'th'->'keep'->>(public.base_th(p_l) - 1))::int
    + coalesce((select sum((public.war_defs()->'k'->'store'->'keep'->>((q.e->>'l')::int - 1))::int) from jsonb_array_elements(p_l) q(e)
        where q.e->>'k' = 'store' and (q.e->>'l')::int >= 1), 0)::int
$$;
-- строители: 1 + каждая готовая мастерская
create or replace function public.war_builders(p_l jsonb) returns int language sql immutable as $$
  select 1 + (select count(*)::int from jsonb_array_elements(p_l) q(e) where q.e->>'k' = 'shop' and (q.e->>'l')::int >= 1)
$$;
-- производство (всё, у чего в каталоге есть rate): сколько копится сейчас, 8 часов максимум; на стройке не копит
create or replace function public.war_prod(p_e jsonb, p_now bigint) returns int language sql immutable as $$
  select case when q.m is null or not (q.m ? 'rate') or coalesce((p_e->>'l')::int, 0) < 1 or p_e ? 'ue' then 0
    else least((q.m->'hold'->>((p_e->>'l')::int - 1))::int,
      ((q.m->'rate'->>((p_e->>'l')::int - 1))::bigint * greatest(0, p_now - coalesce((p_e->>'t0')::bigint, p_now)) / 3600)::int) end
  from (select public.war_defs()->'k'->(p_e->>'k') as m) q
$$;
-- влезает ли прямоугольник в открытую часть, мимо занятых клеток и других построек (p_skip — сама передвигаемая)
create or replace function public.war_fits(p_l jsonb, p_x int, p_z int, p_w int, p_d int, p_skip int) returns boolean language sql immutable as $$
  select p_x >= b.v[1] and p_z >= b.v[1] and p_x + p_w <= b.v[2] and p_z + p_d <= b.v[2]
    and not exists (select 1 from jsonb_array_elements(public.war_defs()->'block') k(c)
      where p_x < (k.c->>0)::int + (k.c->>2)::int and (k.c->>0)::int < p_x + p_w and p_z < (k.c->>1)::int + (k.c->>3)::int and (k.c->>1)::int < p_z + p_d)
    and not exists (select 1 from jsonb_array_elements(p_l) q(e), lateral (select public.war_fp(q.e->>'k', (q.e->>'r')::int) as f) s
      where (q.e->>'i')::int <> p_skip
        and p_x < (q.e->>'x')::int + s.f[1] and (q.e->>'x')::int < p_x + p_w and p_z < (q.e->>'z')::int + s.f[2] and (q.e->>'z')::int < p_z + p_d)
  from (select public.war_box(p_l) as v) b
$$;
-- достроилось к моменту p_now — новый уровень (производство копит с конца стройки)
create or replace function public.war_norm(p_l jsonb, p_now bigint) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(case when q.e ? 'ue' and (q.e->>'ue')::bigint <= p_now
      then (q.e - 'ul' - 'ue') || jsonb_build_object('l', (q.e->>'ul')::int)
        || case when public.war_defs()->'k'->(q.e->>'k') ? 'rate' then jsonb_build_object('t0', (q.e->>'ue')::bigint) else '{}'::jsonb end
      else q.e end order by q.o), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_l, '[]'::jsonb)) with ordinality q(e, o)
$$;
-- собрать с производства (p_id — одно, null — всё) в казну, сколько влезет; остаток остаётся там
create or replace function public.war_collect_(p_l jsonb, p_bricks int, p_id int, p_now bigint, out o_l jsonb, out o_br int, out o_got int)
language plpgsql immutable as $$
declare v_e jsonb; v_o int; v_rate int; v_amt int; v_tk int; v_space int; v_rem int;
begin
  o_l := p_l; o_br := p_bricks; o_got := 0;
  v_space := greatest(0, public.war_cap(p_l) - p_bricks);
  for v_e, v_o in select q.e, (q.o - 1)::int from jsonb_array_elements(p_l) with ordinality q(e, o) loop
    if not (public.war_defs()->'k'->(v_e->>'k') ? 'rate') or (p_id is not null and (v_e->>'i')::int <> p_id) then continue; end if;
    v_amt := public.war_prod(v_e, p_now);
    if v_amt <= 0 then continue; end if;
    v_tk := least(v_amt, v_space); v_space := v_space - v_tk; o_got := o_got + v_tk;
    v_rate := (public.war_defs()->'k'->(v_e->>'k')->'rate'->>((v_e->>'l')::int - 1))::int; v_rem := v_amt - v_tk;
    o_l := jsonb_set(o_l, array[v_o::text], v_e || jsonb_build_object('t0', p_now - (v_rem * 3600 + v_rate - 1) / v_rate));
  end loop;
  o_br := o_br + o_got;
end $$;
-- армия: уровень лучшей казармы (0 — нет готовой), сколько готовых казарм, сколько мест занято (в казарме, в набеге, в очереди)
create or replace function public.war_barracks_lv(p_l jsonb) returns int language sql immutable as $$
  select coalesce(max((q.e->>'l')::int), 0)::int from jsonb_array_elements(coalesce(p_l, '[]'::jsonb)) q(e) where q.e->>'k' = 'barracks' and (q.e->>'l')::int >= 1
$$;
create or replace function public.war_barracks_n(p_l jsonb) returns int language sql immutable as $$
  select count(*)::int from jsonb_array_elements(coalesce(p_l, '[]'::jsonb)) q(e) where q.e->>'k' = 'barracks' and (q.e->>'l')::int >= 1
$$;
create or replace function public.war_space(p_army jsonb, p_out jsonb, p_q jsonb) returns int language sql immutable as $$
  select (coalesce((select sum(((public.war_defs()->'u'->a.key->>'sp')::int) * (a.value #>> '{}')::int) from jsonb_each(coalesce(p_army, '{}'::jsonb)) a where public.war_defs()->'u' ? a.key), 0)
    + coalesce((select sum(((public.war_defs()->'u'->a.key->>'sp')::int) * (a.value #>> '{}')::int) from jsonb_each(coalesce(p_out, '{}'::jsonb)) a where public.war_defs()->'u' ? a.key), 0)
    + coalesce((select sum((public.war_defs()->'u'->(q.e->>'u')->>'sp')::int) from jsonb_array_elements(coalesce(p_q, '[]'::jsonb)) q(e)), 0))::int
$$;
-- техника: мест у построек вида p_b (готовые, по уровню), лучший уровень такой постройки, сколько техники этого вида уже стоит
create or replace function public.war_slots(p_l jsonb, p_b text) returns int language sql immutable as $$
  select coalesce(sum((public.war_defs()->'k'->p_b->'slots'->>(least((q.e->>'l')::int, jsonb_array_length(public.war_defs()->'k'->p_b->'slots')) - 1))::int), 0)::int
  from jsonb_array_elements(coalesce(p_l, '[]'::jsonb)) q(e) where q.e->>'k' = p_b and (q.e->>'l')::int >= 1 and public.war_defs()->'k'->p_b ? 'slots'
$$;
create or replace function public.war_best_lv(p_l jsonb, p_b text) returns int language sql immutable as $$
  select coalesce(max((q.e->>'l')::int), 0)::int from jsonb_array_elements(coalesce(p_l, '[]'::jsonb)) q(e) where q.e->>'k' = p_b and (q.e->>'l')::int >= 1
$$;
create or replace function public.war_veh_in(p_veh jsonb, p_b text) returns int language sql immutable as $$
  select coalesce(sum((a.value #>> '{}')::int), 0)::int from jsonb_each(coalesce(p_veh, '{}'::jsonb)) a where public.war_defs()->'veh'->a.key->>'b' = p_b
$$;
-- Возраст 12+ (как D37Age.allows(12) в браузере): год из age.sql, «остывание» — не старше той группы. Нет age.sql — пускаем
create or replace function public.war_age_ok(p_uid uuid) returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_y int; v_fg text; v_fu timestamptz; a int; m int;
begin
  if p_uid is null then return false; end if;
  if to_regclass('public.user_age') is null then return true; end if;   -- запрос ниже планируется только здесь (plpgsql — лениво)
  select u.birth_year, u.floor_group, u.floor_until into v_y, v_fg, v_fu from public.user_age u where u.user_id = p_uid;
  if not found then return false; end if;
  a := case when v_y is null then null else extract(year from (now() at time zone 'Europe/Moscow'))::int - v_y - 1 end;
  if v_fg is not null and v_fu > now() then
    m := case v_fg when 'child' then 12 when 'teen' then 15 when 'teen16' then 17 else 99 end;
    a := least(coalesce(a, m), m);
  end if;
  return coalesce(a, 0) >= 12;
end $$;
-- Новый код приглашения (8 знаков a-z0-9, без похожих)
create or replace function public.war_code_() returns text language sql volatile as $$
  select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 8)
$$;
-- Всё о своей базе (ответ war_state / war_act / war_claim …): состав, казна, армия, техника; приглашение — главарю и офицерам;
-- give_left — сколько кирпичей можно отдать сегодня, district — сколько их на своём участке района
create or replace function public.war_view(p_uid uuid, p_now bigint) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'now', p_now, 'id', b.id, 'name_k', b.name_k, 'name_n', b.name_n, 'color', b.color,
    'bricks', b.bricks, 'layout', public.war_norm(b.layout, p_now), 'own', b.own, 'seq', b.seq, 'rev', b.rev,
    'gift', b.gift_day is distinct from public.base_today(), 'coins', public.base_coins_(p_uid),
    'army', qn.o_army, 'out', b.army_out, 'queue', qn.o_q, 'veh', b.veh, 'trophies', b.trophies, 'skin', b.skin, 'shield', b.shield_until,
    'raid_rank', b.raid_rank, 'rank', m.rank, 'invite', case when m.rank in ('leader', 'officer') then b.invite end,
    'give_left', greatest(0, (public.war_defs()->>'give')::int - case when m.give_day = public.base_today() then m.give_n else 0 end),
    'district', (select d.bricks from public.bases d where d.user_id = p_uid),
    'members', coalesce((select jsonb_agg(jsonb_build_object('uid', w.user_id, 'nick', coalesce(p.nick, 'Игрок'), 'rank', w.rank, 'given', w.given)
        order by case w.rank when 'leader' then 0 when 'officer' then 1 else 2 end, w.joined_at)
      from public.war_members w left join public.profiles p on p.id = w.user_id where w.base_id = b.id), '[]'::jsonb))
  from public.war_members m join public.war_bases b on b.id = m.base_id, lateral public.base_qnorm(b.queue, b.army, p_now) qn
  where m.user_id = p_uid
$$;

-- ── Для сайта ──
-- Своя база (или почему её нет: auth / none)
create or replace function public.war_state() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth', 'now', public.base_now()); end if;
  return coalesce(public.war_view(auth.uid(), public.base_now()), jsonb_build_object('ok', false, 'reason', 'none', 'now', public.base_now(), 'age', public.war_age_ok(auth.uid())));
end $$;
-- Сектор: 12 баз (имя, цвет, главарь, постройки БЕЗ ловушек, кубки, щит, облик, людей) + самый большой номер (сколько секторов)
create or replace function public.war_sector(p_sector int) returns jsonb language sql stable security definer set search_path = public as $$
  with s as (select greatest(0, least(99, coalesce(p_sector, 0))) as n, public.base_now() as nw)
  select jsonb_build_object('ok', true, 'now', s.nw, 'sector', s.n, 'max', coalesce((select max(b.id) from public.war_bases b), 0),
    'bases', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name_k', b.name_k, 'name_n', b.name_n, 'color', b.color, 'uid', b.leader, 'nick', coalesce(pr.nick, 'Игрок'),
        'layout', (select coalesce(jsonb_agg(q.e order by q.o), '[]'::jsonb) from jsonb_array_elements(public.war_norm(b.layout, s.nw)) with ordinality q(e, o) where not (public.war_defs()->'k'->(q.e->>'k') ? 'trap')),
        'rev', b.rev, 'tr', b.trophies, 'skin', b.skin, 'sh', b.shield_until, 'n', (select count(*)::int from public.war_members m where m.base_id = b.id)) order by b.id)
      from public.war_bases b left join public.profiles pr on pr.id = b.leader
      where b.id between s.n * 12 + 1 and s.n * 12 + 12), '[]'::jsonb))
  from s
$$;
-- Что за база по приглашению (экран «Вступить»): имя, цвет, главарь, людей, штаб, кубки — без постройки и кода
create or replace function public.war_invite_info(p_code text) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('ok', true, 'id', b.id, 'name_k', b.name_k, 'name_n', b.name_n, 'color', b.color, 'nick', coalesce(pr.nick, 'Игрок'),
      'n', (select count(*)::int from public.war_members m where m.base_id = b.id), 'th', public.base_th(b.layout), 'tr', b.trophies)
    from public.war_bases b left join public.profiles pr on pr.id = b.leader where b.invite = lower(coalesce(p_code, '')) and coalesce(p_code, '') ~ '^[a-zA-Z0-9]{8}$'),
    jsonb_build_object('ok', false, 'reason', 'code'))
$$;

-- ── Основать базу: свободный участок, имя из готовых (номер — первый свободный 1…99, если не задан), цвет. Ты — главарь ──
create or replace function public.war_claim(p_plot int, p_name int, p_num int default null, p_color int default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_now bigint := public.base_now(); v_dd jsonb := public.war_defs(); v_n int; v_try int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public.war_age_ok(v_uid) then return jsonb_build_object('ok', false, 'reason', 'age'); end if;
  if p_plot is null or p_plot < 1 or p_plot > (v_dd->>'plots')::int then return jsonb_build_object('ok', false, 'reason', 'plot'); end if;
  if p_name is null or p_name < 0 or p_name >= (v_dd->>'names')::int or coalesce(p_color, 0) < 0 or coalesce(p_color, 0) >= (v_dd->>'colors')::int then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
  if exists (select 1 from public.war_members m where m.user_id = v_uid) then return jsonb_build_object('ok', false, 'reason', 'in_base'); end if;
  if exists (select 1 from public.war_cool c where c.user_id = v_uid and c.until > v_now) then return jsonb_build_object('ok', false, 'reason', 'too_fast'); end if;
  if exists (select 1 from public.war_bases b where b.id = p_plot) then return jsonb_build_object('ok', false, 'reason', 'taken'); end if;
  if p_num is not null then
    if p_num < 1 or p_num > 99 then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
    if exists (select 1 from public.war_bases b where b.name_k = p_name and b.name_n = p_num) then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
    v_n := p_num;
  else
    select min(g) into v_n from generate_series(1, 99) g where not exists (select 1 from public.war_bases b where b.name_k = p_name and b.name_n = g);
    if v_n is null then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  end if;
  begin
    insert into public.war_bases (id, leader, name_k, name_n, color, bricks, seq, rev, invite, layout) values (p_plot, v_uid, p_name, v_n, coalesce(p_color, 0), (v_dd->>'start')::int, 2, 1,
      public.war_code_(), jsonb_build_array(jsonb_build_object('i', 1, 'k', 'th', 'x', 14, 'z', 14, 'r', 0, 'l', 1), jsonb_build_object('i', 2, 'k', 'mine', 'x', 10, 'z', 15, 'r', 0, 'l', 1, 't0', v_now)));
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', case when exists (select 1 from public.war_bases b where b.id = p_plot) then 'taken'
      when exists (select 1 from public.war_bases b where b.leader = v_uid) then 'in_base' else 'name' end);
  end;
  insert into public.war_members (user_id, base_id, rank) values (v_uid, p_plot, 'leader');
  return public.war_view(v_uid, v_now);
end $$;

-- ── Вступить по ссылке-приглашению (бойцом) ──
create or replace function public.war_join(p_code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_now bigint := public.base_now(); v_b public.war_bases%rowtype; v_n int; v_nick text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public.war_age_ok(v_uid) then return jsonb_build_object('ok', false, 'reason', 'age'); end if;
  if coalesce(p_code, '') !~ '^[a-zA-Z0-9]{8}$' then return jsonb_build_object('ok', false, 'reason', 'code'); end if;
  if exists (select 1 from public.war_members m where m.user_id = v_uid) then return jsonb_build_object('ok', false, 'reason', 'in_base'); end if;
  if exists (select 1 from public.war_cool c where c.user_id = v_uid and c.until > v_now) then return jsonb_build_object('ok', false, 'reason', 'too_fast'); end if;
  select * into v_b from public.war_bases b where b.invite = lower(p_code) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'code'); end if;
  select count(*)::int into v_n from public.war_members m where m.base_id = v_b.id;
  if v_n >= (public.war_defs()->'k'->'th'->'crew'->>(public.base_th(public.war_norm(v_b.layout, v_now)) - 1))::int then return jsonb_build_object('ok', false, 'reason', 'crew'); end if;
  begin
    insert into public.war_members (user_id, base_id, rank) values (v_uid, v_b.id, 'soldier');
  exception when unique_violation then return jsonb_build_object('ok', false, 'reason', 'in_base');
  end;
  select coalesce(nick, 'Игрок') into v_nick from public.profiles where id = v_uid;
  begin perform public.notify(v_b.leader, 'war', v_uid, '🏯 Новый боец в базе', format('%s вступил(а) в твою базу по приглашению', v_nick), '#/games/world', 'warjoin:' || v_uid::text || ':' || v_b.id); exception when others then null; end;
  return public.war_view(v_uid, v_now);
end $$;

-- ── Выйти. Главарь выходит последним (сначала передай главаря); последний — база распускается, участок свободен ──
create or replace function public.war_leave() returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_now bigint := public.base_now(); v_m public.war_members%rowtype; v_n int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into v_m from public.war_members m where m.user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  perform 1 from public.war_bases b where b.id = v_m.base_id for update;
  select count(*)::int into v_n from public.war_members m where m.base_id = v_m.base_id;
  if v_m.rank = 'leader' and v_n > 1 then return jsonb_build_object('ok', false, 'reason', 'last'); end if;
  if v_m.rank = 'leader' then delete from public.war_bases where id = v_m.base_id;   -- состав — каскадом
  else delete from public.war_members where user_id = v_uid; update public.war_bases set rev = rev + 1 where id = v_m.base_id; end if;
  insert into public.war_cool (user_id, until) values (v_uid, v_now + 600) on conflict (user_id) do update set until = excluded.until;
  return jsonb_build_object('ok', true, 'now', v_now, 'disbanded', v_m.rank = 'leader');
end $$;

-- ── Состав: kick (главарь — любого, офицер — бойца), promote / demote (главарь), lead — передать главаря (сам станет офицером) ──
create or replace function public.war_member(p_act text, p_uid uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_now bigint := public.base_now(); v_me public.war_members%rowtype; v_t public.war_members%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if coalesce(p_act, '') not in ('kick', 'promote', 'demote', 'lead') or p_uid is null then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
  select * into v_me from public.war_members m where m.user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  perform 1 from public.war_bases b where b.id = v_me.base_id for update;
  if p_uid = v_uid then return jsonb_build_object('ok', false, 'reason', 'self_kick'); end if;
  select * into v_t from public.war_members m where m.user_id = p_uid and m.base_id = v_me.base_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  if p_act = 'kick' then
    if not (v_me.rank = 'leader' or (v_me.rank = 'officer' and v_t.rank = 'soldier')) then return jsonb_build_object('ok', false, 'reason', 'rank'); end if;
    delete from public.war_members where user_id = p_uid;
    insert into public.war_cool (user_id, until) values (p_uid, v_now + 600) on conflict (user_id) do update set until = excluded.until;
    begin perform public.notify(p_uid, 'war', v_uid, '🏯 Тебя исключили из базы', 'Можно вступить в другую базу или основать свою.', '#/games/world', 'warkick:' || p_uid::text || ':' || v_now); exception when others then null; end;
  else
    if v_me.rank <> 'leader' then return jsonb_build_object('ok', false, 'reason', 'leader'); end if;
    if p_act = 'promote' then update public.war_members set rank = 'officer' where user_id = p_uid;
    elsif p_act = 'demote' then update public.war_members set rank = 'soldier' where user_id = p_uid;
    else
      update public.war_members set rank = 'officer' where user_id = v_uid;
      update public.war_members set rank = 'leader' where user_id = p_uid;
      update public.war_bases set leader = p_uid where id = v_me.base_id;
    end if;
  end if;
  update public.war_bases set rev = rev + 1, updated_at = now() where id = v_me.base_id;
  return public.war_view(v_uid, v_now);
end $$;

-- ── Настройки базы: {name: k} (главарь; номер — первый свободный, своё имя — как было), {color: c} (главарь),
--    {raid: 'officer' | 'soldier'} — кто ходит в набеги армией базы (главарь), {code: true} — новая ссылка (главарь; офицер — если нет) ──
create or replace function public.war_set(p_a jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_now bigint := public.base_now(); v_me public.war_members%rowtype; v_b public.war_bases%rowtype; v_k int; v_n int; v_dd jsonb := public.war_defs();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  p_a := coalesce(p_a, '{}'::jsonb);
  if jsonb_typeof(p_a) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
  select * into v_me from public.war_members m where m.user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  select * into v_b from public.war_bases b where b.id = v_me.base_id for update;
  if p_a ? 'code' then
    if not (v_me.rank = 'leader' or (v_me.rank = 'officer' and v_b.invite is null)) then return jsonb_build_object('ok', false, 'reason', 'rank'); end if;
    for v_n in 1 .. 5 loop
      begin update public.war_bases set invite = public.war_code_() where id = v_b.id; exit; exception when unique_violation then null; end;
    end loop;
  end if;
  if p_a ? 'name' or p_a ? 'color' or p_a ? 'raid' then
    if v_me.rank <> 'leader' then return jsonb_build_object('ok', false, 'reason', 'leader'); end if;
    if p_a ? 'name' then
      v_k := public.base_arg(p_a, 'name', 99);
      if v_k is null or v_k >= (v_dd->>'names')::int then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
      if v_k <> v_b.name_k then
        select min(g) into v_n from generate_series(1, 99) g where not exists (select 1 from public.war_bases b where b.name_k = v_k and b.name_n = g);
        if v_n is null then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
        begin update public.war_bases set name_k = v_k, name_n = v_n where id = v_b.id; exception when unique_violation then return jsonb_build_object('ok', false, 'reason', 'name'); end;
      end if;
    end if;
    if p_a ? 'color' then
      v_k := public.base_arg(p_a, 'color', 99);
      if v_k is null or v_k >= (v_dd->>'colors')::int then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
      update public.war_bases set color = v_k where id = v_b.id;
    end if;
    if p_a ? 'raid' then
      if coalesce(p_a->>'raid', '') not in ('officer', 'soldier') then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
      update public.war_bases set raid_rank = p_a->>'raid' where id = v_b.id;
    end if;
  end if;
  update public.war_bases set rev = rev + 1, updated_at = now() where id = v_b.id;
  return public.war_view(v_uid, v_now);
end $$;

-- ── Ход на своей базе (как WRules.act в mir-base.js; порядок проверок тот же). Главарь и офицеры: place · move · remove · upgrade ·
--    train · untrain · unarm · vbuy {v} · vsell {v}; любой из состава: collect {id?} · finish {id} (за 🪙) · tfinish (за 🪙) · gift ·
--    give {n} (кирпичи со своего участка района в казну, лимит в день). Не больше 120 ходов в минуту на базу ──
create or replace function public.war_act(p_act text, p_a jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_now bigint := public.base_now(); v_dd jsonb := public.war_defs(); v_dk jsonb := v_dd->'k';
  v_me public.war_members%rowtype; v_b public.war_bases%rowtype; v_d public.bases%rowtype;
  v_l jsonb; v_own jsonb; v_br int; v_seq int; v_gd date; v_err text; v_xtra jsonb := '{}'::jsonb; v_veh jsonb;
  v_k text; v_def jsonb; v_x int; v_z int; v_r int; v_id int; v_idx int; v_it jsonb; v_fp int[]; v_t int; v_lim int; v_cnt int;
  v_tm int; v_cost int; v_coins int; v_nl int; v_inv boolean; v_got int; v_tot int; v_add int; v_n int; v_last bigint; v_i int; v_e jsonb;
  v_army jsonb; v_out jsonb; v_q jsonb; v_bl int; v_left int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  p_a := coalesce(p_a, '{}'::jsonb);
  if jsonb_typeof(p_a) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'args'); end if;
  select * into v_me from public.war_members m where m.user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'reason', 'none'); end if;
  if p_act in ('place', 'move', 'remove', 'upgrade', 'train', 'untrain', 'unarm', 'vbuy', 'vsell') and v_me.rank not in ('leader', 'officer') then
    return jsonb_build_object('ok', false, 'reason', 'rank');
  end if;
  select * into v_b from public.war_bases b where b.id = v_me.base_id for update;
  if v_now - v_b.act_t >= 60 then v_b.act_t := v_now; v_b.act_n := 0; end if;
  if v_b.act_n >= 120 then return jsonb_build_object('ok', false, 'reason', 'too_fast'); end if;
  v_b.act_n := v_b.act_n + 1;
  v_l := public.war_norm(v_b.layout, v_now);
  v_own := coalesce(v_b.own, '{}'::jsonb); v_br := v_b.bricks; v_seq := v_b.seq; v_gd := v_b.gift_day; v_veh := coalesce(v_b.veh, '{}'::jsonb);
  v_t := public.base_th(v_l);
  select qn.o_q, qn.o_army into v_q, v_army from public.base_qnorm(v_b.queue, v_b.army, v_now) qn;   -- дотренировались — в армию
  v_out := coalesce(v_b.army_out, '{}'::jsonb);

  <<main>>
  begin
    if p_act = 'place' then
      v_k := p_a->>'k'; v_x := public.base_arg(p_a, 'x', (v_dd->>'n')::int - 1); v_z := public.base_arg(p_a, 'z', (v_dd->>'n')::int - 1); v_r := public.base_arg(p_a, 'r', 3);
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
      v_fp := public.war_fp(v_k, v_r);
      if not public.war_fits(v_l, v_x, v_z, v_fp[1], v_fp[2], 0) then v_err := 'place'; exit main; end if;
      v_tm := (v_def->'time'->>0)::int; v_coins := coalesce((v_def->>'coins')::int, 0); v_cost := (v_def->'cost'->>0)::int;
      select count(*) into v_cnt from jsonb_array_elements(v_l) q(e) where q.e->>'k' = v_k;
      v_inv := v_def->>'g' = 'deco' and coalesce((v_own->>v_k)::int, 0) > v_cnt;
      if not v_inv then
        if v_coins > 0 then
          if public.base_coins_(v_uid) < v_coins then v_err := 'coins'; exit main; end if;
        elsif v_br < v_cost then v_err := 'bricks'; exit main;
        end if;
      end if;
      if v_tm > 0 and public.base_busy(v_l) >= public.war_builders(v_l) then v_err := 'builder'; exit main; end if;
      if not v_inv then
        if v_coins > 0 then
          if not public.base_pay_(v_uid, v_coins, 'war:place:' || v_k) then v_err := 'coins'; exit main; end if;
          v_xtra := jsonb_build_object('spent', v_coins);
        else v_br := v_br - v_cost;
        end if;
        if v_def->>'g' = 'deco' then v_own := jsonb_set(v_own, array[v_k], to_jsonb(coalesce((v_own->>v_k)::int, 0) + 1)); end if;
      end if;
      v_seq := v_seq + 1;
      v_it := jsonb_build_object('i', v_seq, 'k', v_k, 'x', v_x, 'z', v_z, 'r', v_r, 'l', case when v_tm > 0 then 0 else 1 end);
      if v_tm > 0 then v_it := v_it || jsonb_build_object('ul', 1, 'ue', v_now + v_tm);
      elsif v_def ? 'rate' then v_it := v_it || jsonb_build_object('t0', v_now);
      end if;
      v_l := v_l || jsonb_build_array(v_it);
      v_xtra := v_xtra || jsonb_build_object('id', v_seq);

    elsif p_act = 'move' then
      v_id := public.base_arg(p_a, 'id', 1000000); v_x := public.base_arg(p_a, 'x', (v_dd->>'n')::int - 1); v_z := public.base_arg(p_a, 'z', (v_dd->>'n')::int - 1); v_r := public.base_arg(p_a, 'r', 3);
      if v_id is null or v_x is null or v_z is null or v_r is null then v_err := 'args'; exit main; end if;
      select q.e, (q.o - 1)::int into v_it, v_idx from jsonb_array_elements(v_l) with ordinality q(e, o) where (q.e->>'i')::int = v_id;
      if v_it is null then v_err := 'id'; exit main; end if;
      v_fp := public.war_fp(v_it->>'k', v_r);
      if not public.war_fits(v_l, v_x, v_z, v_fp[1], v_fp[2], v_id) then v_err := 'place'; exit main; end if;
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
      if v_tm > 0 and public.base_busy(v_l) >= public.war_builders(v_l) then v_err := 'builder'; exit main; end if;
      if v_def ? 'rate' and v_tm > 0 then   -- перед улучшением производство отдаёт накопленное
        select c.o_l, c.o_br into v_l, v_br from public.war_collect_(v_l, v_br, v_id, v_now) c;
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
      select coalesce(sum(public.war_prod(q.e, v_now)), 0) into v_tot from jsonb_array_elements(v_l) q(e) where v_dk->(q.e->>'k') ? 'rate' and (v_id is null or (q.e->>'i')::int = v_id);
      if v_tot <= 0 then v_err := 'empty'; exit main; end if;
      if public.war_cap(v_l) - v_br <= 0 then v_err := 'full'; exit main; end if;
      select c.o_l, c.o_br, c.o_got into v_l, v_br, v_got from public.war_collect_(v_l, v_br, v_id, v_now) c;
      v_xtra := jsonb_build_object('got', v_got);

    elsif p_act = 'finish' then
      v_id := public.base_arg(p_a, 'id', 1000000);
      if v_id is null then v_err := 'args'; exit main; end if;
      select q.e, (q.o - 1)::int into v_it, v_idx from jsonb_array_elements(v_l) with ordinality q(e, o) where (q.e->>'i')::int = v_id;
      if v_it is null then v_err := 'id'; exit main; end if;
      if not v_it ? 'ue' then v_err := 'idle'; exit main; end if;
      v_coins := greatest(1, ((v_it->>'ue')::bigint - v_now + 119) / 120)::int;   -- 1 🪙 за каждые 2 минуты
      if public.base_coins_(v_uid) < v_coins then v_err := 'coins'; exit main; end if;
      if not public.base_pay_(v_uid, v_coins, 'war:finish') then v_err := 'coins'; exit main; end if;
      v_it := (v_it - 'ul' - 'ue') || jsonb_build_object('l', (v_it->>'ul')::int) || case when v_dk->(v_it->>'k') ? 'rate' then jsonb_build_object('t0', v_now) else '{}'::jsonb end;
      v_l := jsonb_set(v_l, array[v_idx::text], v_it);
      v_xtra := jsonb_build_object('spent', v_coins);

    elsif p_act = 'gift' then
      if v_gd = public.base_today() then v_err := 'done'; exit main; end if;
      v_add := least(50 + 50 * v_t, greatest(0, public.war_cap(v_l) - v_br));
      if v_add <= 0 then v_err := 'full'; exit main; end if;
      v_br := v_br + v_add; v_gd := public.base_today();
      v_xtra := jsonb_build_object('got', v_add);

    -- ── Казарма: train {u, n?} · untrain {u?} · tfinish (за 🪙) · unarm {u, n?}. Две готовые казармы — учат вдвое быстрее ──
    elsif p_act = 'train' then
      v_k := p_a->>'u';
      v_n := case when p_a ? 'n' and jsonb_typeof(p_a->'n') <> 'null' then public.base_arg(p_a, 'n', 30) else 1 end;
      if v_k is null or v_n is null or v_n < 1 then v_err := 'args'; exit main; end if;
      v_def := v_dd->'u'->v_k;
      if v_def is null then v_err := 'kind'; exit main; end if;
      v_bl := public.war_barracks_lv(v_l);
      if v_bl = 0 then v_err := 'barracks'; exit main; end if;
      if (v_def->>'lv')::int > v_bl then v_err := 'ulock'; exit main; end if;
      if public.war_space(v_army, v_out, v_q) + v_n * (v_def->>'sp')::int > (v_dk->'barracks'->'army'->>(v_bl - 1))::int then v_err := 'space'; exit main; end if;
      if v_br < v_n * (v_def->>'cost')::int then v_err := 'bricks'; exit main; end if;
      v_br := v_br - v_n * (v_def->>'cost')::int;
      v_tm := case when public.war_barracks_n(v_l) >= 2 then ((v_def->>'time')::int + 1) / 2 else (v_def->>'time')::int end;
      v_last := case when jsonb_array_length(v_q) > 0 then (v_q->-1->>'ue')::bigint else v_now end;
      for v_i in 1 .. v_n loop
        v_last := greatest(v_last, v_now) + v_tm;
        v_q := v_q || jsonb_build_array(jsonb_build_object('u', v_k, 'ue', v_last, 't', v_tm));
      end loop;

    elsif p_act = 'untrain' then
      v_k := null;
      if p_a ? 'u' and jsonb_typeof(p_a->'u') <> 'null' then
        v_k := p_a->>'u';
        if v_dd->'u'->v_k is null then v_err := 'args'; exit main; end if;
      end if;
      select max(q.o - 1)::int into v_idx from jsonb_array_elements(v_q) with ordinality q(e, o) where v_k is null or q.e->>'u' = v_k;
      if v_idx is null then v_err := 'noq'; exit main; end if;
      v_it := v_q->v_idx;
      v_q := v_q - v_idx;
      v_br := greatest(v_br, least(public.war_cap(v_l), v_br + (v_dd->'u'->(v_it->>'u')->>'cost')::int));
      v_last := case when v_idx > 0 then (v_q->(v_idx - 1)->>'ue')::bigint else v_now end;   -- следующие — раньше
      for v_i in v_idx .. jsonb_array_length(v_q) - 1 loop
        v_last := greatest(v_last, v_now) + (v_q->v_i->>'t')::int;
        v_q := jsonb_set(v_q, array[v_i::text], (v_q->v_i) || jsonb_build_object('ue', v_last));
      end loop;

    elsif p_act = 'tfinish' then
      if jsonb_array_length(v_q) = 0 then v_err := 'noq'; exit main; end if;
      v_coins := greatest(1, ((v_q->-1->>'ue')::bigint - v_now + 119) / 120)::int;   -- 1 🪙 за каждые 2 минуты, как стройка
      if public.base_coins_(v_uid) < v_coins then v_err := 'coins'; exit main; end if;
      if not public.base_pay_(v_uid, v_coins, 'war:train') then v_err := 'coins'; exit main; end if;
      for v_e in select q.e from jsonb_array_elements(v_q) q(e) loop
        v_army := jsonb_set(v_army, array[v_e->>'u'], to_jsonb(coalesce((v_army->>(v_e->>'u'))::int, 0) + 1));
      end loop;
      v_q := '[]'::jsonb;
      v_xtra := jsonb_build_object('spent', v_coins);

    elsif p_act = 'unarm' then
      v_k := p_a->>'u';
      v_n := case when p_a ? 'n' and jsonb_typeof(p_a->'n') <> 'null' then public.base_arg(p_a, 'n', 100) else 1 end;
      if v_k is null or v_dd->'u'->v_k is null or v_n is null or v_n < 1 then v_err := 'args'; exit main; end if;
      if coalesce((v_army->>v_k)::int, 0) < v_n then v_err := 'noarmy'; exit main; end if;
      if (v_army->>v_k)::int = v_n then v_army := v_army - v_k; else v_army := jsonb_set(v_army, array[v_k], to_jsonb((v_army->>v_k)::int - v_n)); end if;

    -- ── Техника: купить в свою постройку (🧱 из казны) / списать (кирпичи не возвращаются) ──
    elsif p_act = 'vbuy' then
      v_k := p_a->>'v'; v_def := v_dd->'veh'->v_k;
      if v_k is null or v_def is null then v_err := 'args'; exit main; end if;
      if public.war_best_lv(v_l, v_def->>'b') < (v_def->>'lv')::int then v_err := 'vlock'; exit main; end if;
      if public.war_veh_in(v_veh, v_def->>'b') >= public.war_slots(v_l, v_def->>'b') then v_err := 'vfull'; exit main; end if;
      if v_br < (v_def->>'cost')::int then v_err := 'bricks'; exit main; end if;
      v_br := v_br - (v_def->>'cost')::int;
      v_veh := jsonb_set(v_veh, array[v_k], to_jsonb(coalesce((v_veh->>v_k)::int, 0) + 1));

    elsif p_act = 'vsell' then
      v_k := p_a->>'v';
      if v_k is null or v_dd->'veh'->v_k is null then v_err := 'args'; exit main; end if;
      if coalesce((v_veh->>v_k)::int, 0) < 1 then v_err := 'noveh'; exit main; end if;
      if (v_veh->>v_k)::int = 1 then v_veh := v_veh - v_k; else v_veh := jsonb_set(v_veh, array[v_k], to_jsonb((v_veh->>v_k)::int - 1)); end if;

    -- ── Кирпичи со своего участка района — в казну (n, не больше дневного лимита и места в казне) ──
    elsif p_act = 'give' then
      v_n := public.base_arg(p_a, 'n', 1000000);
      if v_n is null or v_n < 1 then v_err := 'args'; exit main; end if;
      select * into v_d from public.bases d where d.user_id = v_uid for update;
      if not found then v_err := 'nodonor'; exit main; end if;
      v_left := (v_dd->>'give')::int - case when v_me.give_day = public.base_today() then v_me.give_n else 0 end;
      if v_n > v_left then v_err := 'givemax'; exit main; end if;
      if v_d.bricks < v_n then v_err := 'bricks'; exit main; end if;
      if public.war_cap(v_l) - v_br < v_n then v_err := 'full'; exit main; end if;
      update public.bases set bricks = bricks - v_n, rev = rev + 1, updated_at = now() where user_id = v_uid;
      update public.war_members set given = given + v_n, give_n = case when give_day = public.base_today() then give_n else 0 end + v_n, give_day = public.base_today() where user_id = v_uid;
      v_br := v_br + v_n;
      v_xtra := jsonb_build_object('got', v_n);

    else v_err := 'args';
    end if;
  end;

  if v_err is not null then
    update public.war_bases set act_t = v_b.act_t, act_n = v_b.act_n where id = v_b.id;
    return jsonb_build_object('ok', false, 'reason', v_err, 'now', v_now);
  end if;
  update public.war_bases set layout = v_l, bricks = v_br, own = v_own, seq = v_seq, gift_day = v_gd, rev = rev + 1,
    army = v_army, queue = v_q, veh = v_veh, act_t = v_b.act_t, act_n = v_b.act_n, updated_at = now() where id = v_b.id;
  return public.war_view(v_uid, v_now) || v_xtra;
end $$;

-- ── Права: снаружи — только эти функции; помощники и чужое состояние закрыты ──
revoke execute on function public.war_view(uuid, bigint) from public, anon, authenticated;
revoke execute on function public.war_collect_(jsonb, int, int, bigint) from public, anon, authenticated;
revoke execute on function public.war_age_ok(uuid) from public, anon, authenticated;
revoke execute on function public.war_code_() from public, anon, authenticated;
revoke execute on function public.war_state() from public;
revoke execute on function public.war_claim(int, int, int, int) from public, anon;
revoke execute on function public.war_join(text) from public, anon;
revoke execute on function public.war_leave() from public, anon;
revoke execute on function public.war_member(text, uuid) from public, anon;
revoke execute on function public.war_set(jsonb) from public, anon;
revoke execute on function public.war_act(text, jsonb) from public, anon;
grant execute on function public.war_state() to anon, authenticated;   -- гостю — reason auth (так проверяют, что файл применён)
grant execute on function public.war_claim(int, int, int, int) to authenticated;
grant execute on function public.war_join(text) to authenticated;
grant execute on function public.war_leave() to authenticated;
grant execute on function public.war_member(text, uuid) to authenticated;
grant execute on function public.war_set(jsonb) to authenticated;
grant execute on function public.war_act(text, jsonb) to authenticated;
grant execute on function public.war_sector(int) to anon, authenticated;
grant execute on function public.war_invite_info(text) to anon, authenticated;
grant execute on function public.war_defs() to anon, authenticated;

-- ═══ Перенос (владелец 15.10, п. 31): оборона, казарма и армия района → кирпичи хозяину участка. Идемпотентно: второй запуск
--     ничего не находит. Цены — из war_defs() (те же, что были у обороны района в черновике набегов); вышка — смотровая, до 3 ур. ═══
do $$
declare r record; v_k jsonb := public.war_defs()->'k'; v_u jsonb := public.war_defs()->'u'; v_ref int; v_l jsonb; v_e jsonb; v_lv int;
begin
  for r in select b.user_id, b.layout from public.bases b where exists (select 1 from jsonb_array_elements(b.layout) e
      where e->>'k' in ('barracks', 'cannon', 'mortar', 'bomb', 'airmine') or (e->>'k' = 'tower' and greatest(coalesce((e->>'l')::int, 0), coalesce((e->>'ul')::int, 0)) > 3)) loop
    v_ref := 0; v_l := '[]'::jsonb;
    for v_e in select e from jsonb_array_elements(r.layout) e loop
      v_lv := greatest(coalesce((v_e->>'l')::int, 0), coalesce((v_e->>'ul')::int, 0));   -- идущая стройка уже оплачена
      if v_e->>'k' in ('barracks', 'cannon', 'mortar', 'bomb', 'airmine') then
        v_ref := v_ref + coalesce((select sum(c::int) from jsonb_array_elements_text(v_k->(v_e->>'k')->'cost') with ordinality q(c, o) where q.o <= v_lv), 0);
      elsif v_e->>'k' = 'tower' and v_lv > 3 then
        v_ref := v_ref + coalesce((select sum(c::int) from jsonb_array_elements_text(v_k->'tower'->'cost') with ordinality q(c, o) where q.o > 3 and q.o <= v_lv), 0);
        v_l := v_l || jsonb_build_array((v_e - 'ul' - 'ue') || jsonb_build_object('l', 3));
      else v_l := v_l || jsonb_build_array(v_e);
      end if;
    end loop;
    update public.bases set layout = v_l, bricks = bricks + v_ref, rev = rev + 1, updated_at = now() where user_id = r.user_id;
  end loop;
  -- армия района (если колонки остались от черновика набегов): обученные, ушедшие в набег и в очереди — кирпичами
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bases' and column_name = 'army') then
    execute $q$
      update public.bases b set bricks = b.bricks
          + coalesce((select sum((v.u->a.key->>'cost')::int * (a.value #>> '{}')::int) from jsonb_each(coalesce(b.army, '{}'::jsonb)) a, (select $1 as u) v where v.u ? a.key), 0)
          + coalesce((select sum((v.u->a.key->>'cost')::int * (a.value #>> '{}')::int) from jsonb_each(coalesce(b.army_out, '{}'::jsonb)) a, (select $1 as u) v where v.u ? a.key), 0)
          + coalesce((select sum((v.u->(q.e->>'u')->>'cost')::int) from jsonb_array_elements(coalesce(b.queue, '[]'::jsonb)) q(e), (select $1 as u) v where v.u ? (q.e->>'u')), 0),
        army = '{}'::jsonb, army_out = '{}'::jsonb, queue = '[]'::jsonb, rev = b.rev + 1
      where b.army <> '{}'::jsonb or b.army_out <> '{}'::jsonb or b.queue <> '[]'::jsonb $q$ using v_u;
  end if;
end $$;
