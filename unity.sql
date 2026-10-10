-- ═══════════════════════════════════════════════════════════════════
--  UNITY-ИГРЫ 🕹️ — игры игроков, собранные в Unity (WebGL), на сайте: js/games/unity-host.js, SDK — sdk/unity
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно (можно запускать повторно). Порядок с другими файлами не важен:
--  без ugc.sql сам создаёт ugc_is_staff(); без games.sql / xp.sql / coins.sql просто не пишет общую статистику, XP и монеты.
--
--  Сборка игры лежит у автора (GitHub Pages, itch.io, свой сайт): здесь только ссылка на её index.html — https, не наш сайт
--  (unity_url проверяет и приводит к одному виду; origin — адрес сайта сборки, по нему сайт проверяет сообщения игры).
--  Отдельная таблица, а не ugc_games: каталог и модерация «Студии игр» не знают Unity-игр (там пустой экран), а повторный
--  запуск ugc.sql упал бы на проверке kind, если в ugc_games уже лежат строки 'unity'.
--  Статусы — как в «Студии игр»: draft (видит автор) → link (по ссылке) → review (ждёт модератора) → public (каталог, реклама
--  вокруг игры); hidden — скрыл автор, banned — заблокировал модератор. Изменил игру из каталога — снова на проверку,
--  3 жалобы — из каталога до проверки. Запуски: чужие, раз в 30 мин с человека; каждые 10 — 1 🪙 автору (общий с «Студией игр»
--  лимит 100 в день, источник 'ugc').
--  Очки: unity_result — у каждой игры свои рекорды (unity_scores, unity_top) + общая статистика сайта под ОДНИМ ключом 'unity'
--  (game_stats/game_log: профиль, «Задание дня», +5 🪙 за победу). Один ключ, а не по ключу на игру: игры пишут игроки,
--  и любую можно накрутить — поэтому у всех Unity-игр общие лимиты, а не новые на каждую. Результат — не чаще раза в 10 с
--  (по всем Unity-играм), XP за победу — 10 в общем дневном лимите игр (15 начислений), монеты раунда — до 50, в общем
--  дневном лимите забегов (1500, не чаще раза в 20 с), VIP — вдвое. За свою игру автор наград не получает (только рекорд).
--  Проверка после запуска: /rpc/unity_play гостем {"p_id":"x"} → {"ok":false,"reason":"not_found"} (PGRST202 = не применён)
-- ═══════════════════════════════════════════════════════════════════

-- Модератор/админ (как в ugc.sql; создаём, только если ugc.sql ещё не запускали — его версию не трогаем)
do $do$ begin
  if to_regprocedure('public.ugc_is_staff()') is null then
    execute $f$ create function public.ugc_is_staff() returns boolean
      language sql stable security definer set search_path = public as $b$
        select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'moderator'))
      $b$ $f$;
  end if;
end $do$;

-- ── Ссылка на сборку: https, обычное имя сайта (не IP, без порта, логина и #), не наш сайт; до 300 знаков ──
--    Возвращает ссылку в одном виде (имя сайта маленькими буквами) или null.
create or replace function public.unity_url(p_url text) returns text
language plpgsql immutable as $$
declare m text[]; host text; rest text;
begin
  if p_url is null or char_length(p_url) > 300 then return null; end if;
  m := regexp_match(btrim(p_url), '^[Hh][Tt][Tt][Pp][Ss]://([A-Za-z0-9.-]+)([/?][^[:space:][:cntrl:]"''<>\\`^{}|#]*)?$');
  if m is null then return null; end if;
  host := lower(m[1]);
  rest := coalesce(m[2], '/');
  if left(rest, 1) = '?' then rest := '/' || rest; end if;
  if char_length(host) > 253 or host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24}|xn--[a-z0-9-]{1,59})$' then return null; end if;
  if host in ('dan4ik37.vercel.app', 'dan4ik37.github.io') or host ~ '(^|\.)supabase\.(co|in)$' then return null; end if;
  if char_length('https://' || host || rest) > 300 then return null; end if;
  return 'https://' || host || rest;
end $$;

create table if not exists public.unity_games (
  id text primary key,
  author uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  url text not null,
  created_at timestamptz not null default now()
);
alter table public.unity_games add column if not exists descr text not null default '';
alter table public.unity_games add column if not exists icon text not null default '🕹️';
alter table public.unity_games add column if not exists origin text not null default '';
alter table public.unity_games add column if not exists aspect text not null default '16:9';   -- форма окна игры
alter table public.unity_games add column if not exists players int not null default 1;        -- 1 — одиночная, 2–8 — комнаты
alter table public.unity_games add column if not exists status text not null default 'draft';
alter table public.unity_games add column if not exists plays int not null default 0;
alter table public.unity_games add column if not exists likes int not null default 0;
alter table public.unity_games add column if not exists reports int not null default 0;
alter table public.unity_games add column if not exists updated_at timestamptz not null default now();
alter table public.unity_games add column if not exists reviewed_by uuid;
alter table public.unity_games add column if not exists reviewed_at timestamptz;
alter table public.unity_games drop constraint if exists unity_games_check;
alter table public.unity_games add constraint unity_games_check check (
  status in ('draft', 'link', 'review', 'public', 'hidden', 'banned')
  and char_length(title) between 2 and 60 and char_length(descr) <= 300 and char_length(icon) between 1 and 16
  and aspect in ('16:9', '4:3', '1:1', '3:4', '9:16', 'full') and players between 1 and 8
  and char_length(url) <= 300 and url = public.unity_url(url) and origin = substring(url from '^https://[^/?]+'));
create index if not exists unity_games_cat on public.unity_games (status, plays desc);
create index if not exists unity_games_author on public.unity_games (author, updated_at desc);

create table if not exists public.unity_likes (
  game_id text not null references public.unity_games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (game_id, user_id)
);
create table if not exists public.unity_reports (
  game_id text not null references public.unity_games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (game_id, user_id)
);
create table if not exists public.unity_plays (
  game_id text not null,
  viewer text not null,
  at timestamptz not null default now()
);
create index if not exists unity_plays_recent on public.unity_plays (game_id, viewer, at desc);
-- Рекорды каждой игры (больше — лучше)
create table if not exists public.unity_scores (
  game_id text not null references public.unity_games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  best int not null default 0,
  plays int not null default 0,
  wins int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (game_id, user_id)
);
create index if not exists unity_scores_top on public.unity_scores (game_id, best desc);
create index if not exists unity_scores_user on public.unity_scores (user_id, updated_at desc);

alter table public.unity_games enable row level security;
alter table public.unity_likes enable row level security;
alter table public.unity_reports enable row level security;
alter table public.unity_plays enable row level security;
alter table public.unity_scores enable row level security;

-- Читать: по ссылке, на проверке и в каталоге — всем; свои — автору; всё — модераторам. Писать — только функциями ниже
drop policy if exists unity_games_read on public.unity_games;
create policy unity_games_read on public.unity_games for select
  using (status in ('link', 'review', 'public') or author = auth.uid() or public.ugc_is_staff());
grant select on public.unity_games to anon, authenticated;
revoke insert, update, delete on public.unity_games from anon, authenticated;
revoke all on public.unity_likes, public.unity_reports, public.unity_plays, public.unity_scores from anon, authenticated;

-- Короткий номер игры для ссылки #/games/unity/play/<id>
create or replace function public.unity_new_id() returns text language plpgsql as $$
declare s text;
begin
  loop
    s := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    exit when not exists (select 1 from public.unity_games where id = s);
  end loop;
  return s;
end $$;
revoke execute on function public.unity_new_id() from public, anon, authenticated;

-- ── Сохранить игру (новую — p_id пусто) ──
create or replace function public.unity_save(p_id text, p_title text, p_descr text, p_icon text, p_url text, p_aspect text, p_players int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); g public.unity_games%rowtype;
  t text := btrim(coalesce(p_title, '')); d text := left(btrim(coalesce(p_descr, '')), 300); ic text := btrim(coalesce(p_icon, ''));
  u text := public.unity_url(p_url); o text; a text := coalesce(p_aspect, ''); pl int := coalesce(p_players, 1);
  v_status text; new_id text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if char_length(t) < 2 or char_length(t) > 60 then return jsonb_build_object('ok', false, 'reason', 'title'); end if;
  if ic = '' or char_length(ic) > 16 then ic := '🕹️'; end if;
  if u is null then return jsonb_build_object('ok', false, 'reason', 'url'); end if;
  o := substring(u from '^https://[^/?]+');
  if a not in ('16:9', '4:3', '1:1', '3:4', '9:16', 'full') then a := '16:9'; end if;
  if pl < 1 or pl > 8 then return jsonb_build_object('ok', false, 'reason', 'players'); end if;

  if coalesce(p_id, '') = '' then
    if (select count(*) from public.unity_games where author = uid) >= 30 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
    if exists (select 1 from public.unity_games where author = uid and created_at > now() - interval '20 seconds') then
      return jsonb_build_object('ok', false, 'reason', 'too_fast');
    end if;
    new_id := public.unity_new_id();
    insert into public.unity_games (id, author, title, descr, icon, url, origin, aspect, players, status)
      values (new_id, uid, t, d, ic, u, o, a, pl, 'draft');
    return jsonb_build_object('ok', true, 'id', new_id, 'status', 'draft', 'url', u, 'origin', o);
  end if;

  select * into g from public.unity_games where id = p_id for update;
  if not found or g.author <> uid then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if g.status = 'banned' then return jsonb_build_object('ok', false, 'reason', 'banned'); end if;
  if g.title = t and g.descr = d and g.icon = ic and g.url = u and g.aspect = a and g.players = pl then
    return jsonb_build_object('ok', true, 'id', g.id, 'status', g.status, 'url', u, 'origin', o, 'same', true);
  end if;
  if g.updated_at > now() - interval '2 seconds' then return jsonb_build_object('ok', false, 'reason', 'too_fast'); end if;
  v_status := case when g.status = 'public' then 'review' else g.status end;   -- изменили игру из каталога — снова на проверку
  update public.unity_games set title = t, descr = d, icon = ic, url = u, origin = o, aspect = a, players = pl,
    status = v_status, updated_at = now() where id = g.id;
  return jsonb_build_object('ok', true, 'id', g.id, 'status', v_status, 'url', u, 'origin', o);
end $$;
grant execute on function public.unity_save(text, text, text, text, text, text, int) to authenticated;

-- ── Автор: черновик / по ссылке / в каталог (на проверку) / скрыть / удалить ──
create or replace function public.unity_status(p_id text, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); g public.unity_games%rowtype;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into g from public.unity_games where id = p_id for update;
  if not found or g.author <> uid then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_status = 'deleted' then
    if g.status = 'banned' then return jsonb_build_object('ok', false, 'reason', 'banned'); end if;   -- заблокированная остаётся для истории
    delete from public.unity_games where id = g.id;
    return jsonb_build_object('ok', true, 'status', 'deleted');
  end if;
  if g.status = 'banned' then return jsonb_build_object('ok', false, 'reason', 'banned'); end if;
  if p_status not in ('draft', 'link', 'review', 'hidden') then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if p_status = 'review' and g.status = 'public' then return jsonb_build_object('ok', true, 'status', 'public'); end if;
  update public.unity_games set status = p_status, updated_at = now() where id = g.id;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;
grant execute on function public.unity_status(text, text) to authenticated;

-- ── Модератор: в каталог / только по ссылке / заблокировать ──
create or replace function public.unity_review(p_id text, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.ugc_is_staff() then return jsonb_build_object('ok', false, 'reason', 'staff'); end if;
  if p_status not in ('public', 'link', 'banned') then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  update public.unity_games set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
    reports = case when p_status = 'public' then 0 else reports end
    where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_status = 'public' then delete from public.unity_reports where game_id = p_id; end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;
grant execute on function public.unity_review(text, text) to authenticated;

-- ── Запуск игры: +1 (не свой, не чаще раза в 30 мин с одного человека), монеты автору ──
create or replace function public.unity_play(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); g public.unity_games%rowtype; hdr json; ip text; v_viewer text; n int; earned int;
begin
  select * into g from public.unity_games where id = p_id;
  if not found or g.status not in ('link', 'review', 'public') then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if uid is not null and uid = g.author then return jsonb_build_object('ok', true, 'counted', false, 'own', true); end if;
  begin hdr := nullif(current_setting('request.headers', true), '')::json; exception when others then hdr := null; end;
  ip := coalesce(hdr ->> 'cf-connecting-ip', hdr ->> 'x-real-ip', split_part(coalesce(hdr ->> 'x-forwarded-for', ''), ',', 1), '');
  v_viewer := coalesce(uid::text, 'ip:' || md5(ip));
  if exists (select 1 from public.unity_plays p where p.game_id = g.id and p.viewer = v_viewer and p.at > now() - interval '30 minutes') then
    return jsonb_build_object('ok', true, 'counted', false);
  end if;
  insert into public.unity_plays (game_id, viewer) values (g.id, v_viewer);
  update public.unity_games set plays = plays + 1 where id = g.id returning plays into n;
  if n % 10 = 0 and to_regprocedure('public.coin_add(uuid,integer,text,text)') is not null and to_regclass('public.coin_log') is not null then
    select coalesce(sum(amount), 0) into earned from public.coin_log
      where user_id = g.author and source = 'ugc' and day = (now() at time zone 'Europe/Moscow')::date;
    if earned < 100 then perform public.coin_add(g.author, 1, 'ugc', 'u:' || g.id); end if;
  end if;
  if random() < .02 then delete from public.unity_plays where at < now() - interval '2 days'; end if;
  return jsonb_build_object('ok', true, 'counted', true, 'plays', n);
end $$;
grant execute on function public.unity_play(text) to anon, authenticated;

-- ── Лайк (повторно — убрать) ──
create or replace function public.unity_like(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_liked boolean; n int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not exists (select 1 from public.unity_games where id = p_id and status in ('link', 'review', 'public')) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if exists (select 1 from public.unity_likes where game_id = p_id and user_id = uid) then
    delete from public.unity_likes where game_id = p_id and user_id = uid; v_liked := false;
  else
    insert into public.unity_likes (game_id, user_id) values (p_id, uid); v_liked := true;
  end if;
  update public.unity_games set likes = (select count(*) from public.unity_likes where game_id = p_id) where id = p_id returning likes into n;
  return jsonb_build_object('ok', true, 'liked', v_liked, 'likes', n);
end $$;
grant execute on function public.unity_like(text) to authenticated;

-- ── Жалоба: одна от человека; 3 жалобы — игра уходит из каталога до проверки ──
create or replace function public.unity_report(p_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not exists (select 1 from public.unity_games where id = p_id and status in ('link', 'review', 'public')) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  insert into public.unity_reports (game_id, user_id, reason) values (p_id, uid, left(coalesce(p_reason, ''), 200))
    on conflict (game_id, user_id) do update set reason = excluded.reason, created_at = now();
  update public.unity_games set reports = (select count(*) from public.unity_reports where game_id = p_id) where id = p_id returning reports into n;
  if n >= 3 then update public.unity_games set status = 'review' where id = p_id and status = 'public'; end if;
  return jsonb_build_object('ok', true, 'reports', n);
end $$;
grant execute on function public.unity_report(text, text) to authenticated;

-- ── Итог раунда: рекорд игры + общая статистика 'unity', XP за победу, монеты раунда (p_ref — номер раунда, один раз) ──
create or replace function public.unity_result(p_id text, p_score int, p_win boolean, p_coins int, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); g public.unity_games%rowtype; sc public.unity_scores%rowtype;
  s int := least(greatest(coalesce(p_score, 0), 0), 1000000000); w boolean := coalesce(p_win, false);
  old_best int; own boolean; got_xp int := 0; got_coins int := 0; bal int; amt int; today int; cref text; c_reason text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into g from public.unity_games where id = p_id;
  if not found or not (g.status in ('link', 'review', 'public') or (g.author = uid and g.status <> 'banned')) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if exists (select 1 from public.unity_scores where user_id = uid and updated_at > now() - interval '10 seconds') then
    return jsonb_build_object('ok', false, 'reason', 'too_fast');
  end if;
  own := g.author = uid;
  select best into old_best from public.unity_scores where game_id = g.id and user_id = uid for update;
  insert into public.unity_scores as x (game_id, user_id, best, plays, wins, updated_at)
    values (g.id, uid, s, 1, case when w then 1 else 0 end, now())
  on conflict (game_id, user_id) do update set best = greatest(x.best, excluded.best), plays = x.plays + 1,
    wins = x.wins + excluded.wins, updated_at = now()
  returning * into sc;

  if not own then
    -- общая статистика сайта: один ключ 'unity' на все Unity-игры (профиль, «Задание дня», +5 🪙 за победу — триггер coins.sql)
    if to_regclass('public.game_stats') is not null then
      insert into public.game_stats as gs (user_id, game, plays, wins, best_score, last_at)
        values (uid, 'unity', 1, case when w then 1 else 0 end, least(s, 1000000), now())
      on conflict (user_id, game) do update set plays = gs.plays + 1, wins = gs.wins + excluded.wins,
        best_score = greatest(gs.best_score, excluded.best_score), last_at = now();
    end if;
    if to_regclass('public.game_log') is not null then
      insert into public.game_log (user_id, game, win, score) values (uid, 'unity', w, least(s, 1000000));
      delete from public.game_log where user_id = uid and day < (now() at time zone 'Europe/Moscow')::date - 14;
    end if;
    if w and to_regprocedure('public.xp_award(uuid,text,text,integer,integer)') is not null then
      begin
        got_xp := public.xp_award(uid, 'game', 'unity:' || g.id || ':' || sc.plays, 10, 15);
      exception when others then got_xp := 0;
      end;
    end if;
    -- монеты раунда — по правилам coins_run: один раз на номер раунда, не чаще раза в 20 с, до 1500 в день на все забеги
    amt := least(greatest(coalesce(p_coins, 0), 0), 50);
    if amt > 0 then
      if to_regprocedure('public.coin_add(uuid,integer,text,text)') is null or to_regclass('public.coin_log') is null then
        c_reason := 'no_coins';
      elsif coalesce(p_ref, '') !~ '^[A-Za-z0-9_-]{4,24}$' then
        c_reason := 'ref';
      else
        cref := 'u:' || g.id || ':' || p_ref;
        if exists (select 1 from public.coin_log where user_id = uid and source = 'run' and created_at > now() - interval '20 seconds') then
          c_reason := 'too_fast';
        elsif exists (select 1 from public.coin_log where user_id = uid and source = 'run' and ref = cref) then
          c_reason := 'dup';
        else
          select coalesce(sum(amount), 0) into today from public.coin_log
            where user_id = uid and source = 'run' and day = (now() at time zone 'Europe/Moscow')::date;
          amt := least(amt, greatest(0, 1500 - today));
          if amt = 0 then
            c_reason := 'day_cap';
          else
            begin
              bal := public.coin_add(uid, amt, 'run', cref);
              got_coins := amt;
              if to_regprocedure('public.has_perks(uuid)') is not null and coalesce(public.has_perks(uid), false) then
                bal := public.coin_add(uid, amt, 'vip', cref);
                got_coins := amt * 2;
              end if;
            exception when unique_violation then c_reason := 'dup'; got_coins := 0; bal := null;
            end;
          end if;
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'xp', got_xp, 'coins', got_coins, 'coins_reason', c_reason, 'balance', bal,
    'best', sc.best, 'plays', sc.plays, 'wins', sc.wins, 'record', s > 0 and s > coalesce(old_best, 0), 'own', own);
end $$;
grant execute on function public.unity_result(text, int, boolean, int, text) to authenticated;

-- ── Рекорды игры (видны там же, где сама игра) ──
create or replace function public.unity_top(p_id text, lim int default 10)
returns table(user_id uuid, nick text, best int, wins int, plays int)
language sql stable security definer set search_path = public as $$
  select s.user_id, p.nick, s.best, s.wins, s.plays
  from public.unity_scores s
  join public.profiles p on p.id = s.user_id
  where s.game_id = p_id and s.best > 0
    and exists (select 1 from public.unity_games g where g.id = p_id
                and (g.status in ('link', 'review', 'public') or g.author = auth.uid() or public.ugc_is_staff()))
  order by s.best desc, s.updated_at asc
  limit least(greatest(coalesce(lim, 10), 1), 50);
$$;
grant execute on function public.unity_top(text, int) to anon, authenticated;
