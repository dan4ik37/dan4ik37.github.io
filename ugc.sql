-- ═══════════════════════════════════════════════════════════════════
--  СТУДИЯ ИГР 🛠️ — игры игроков (js/games/studio.js, страница /g/<id>)
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно (можно запускать повторно).
--  Нужны: profiles; coins.sql (coin_add, coin_log, coin_today — монеты автору за популярные игры).
--
--  Статусы игры: draft — черновик (видит только автор), link — по ссылке (видят все, кто знает ссылку),
--  review — автор попросил в каталог (по ссылке играть можно, ждёт модератора), public — в каталоге (одобрил
--  модератор; только у таких игр сайт показывает рекламу), hidden — скрыл автор, banned — заблокировал модератор.
--  Писать в таблицу напрямую нельзя — только функциями ниже (проверка длины, лимиты, статусы).
--  Изменил игру из каталога — она снова уходит на проверку. 3 жалобы — игра уходит из каталога до проверки.
--  Монеты автору: каждые 10 засчитанных запусков (чужих, не чаще раза в 30 мин с одного человека) — 1 🪙, до 100 в день.
--  Проверка после запуска: /rpc/ugc_play гостем с {"p_id":"x"} → {"ok":false,"reason":"not_found"}
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.ugc_games (
  id text primary key,
  author uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);
alter table public.ugc_games add column if not exists descr text not null default '';
alter table public.ugc_games add column if not exists icon text not null default '🎮';
alter table public.ugc_games add column if not exists kind text not null default 'tpl';
alter table public.ugc_games add column if not exists tpl text;
alter table public.ugc_games add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.ugc_games add column if not exists html text;
alter table public.ugc_games add column if not exists status text not null default 'draft';
alter table public.ugc_games add column if not exists plays int not null default 0;
alter table public.ugc_games add column if not exists likes int not null default 0;
alter table public.ugc_games add column if not exists reports int not null default 0;
alter table public.ugc_games add column if not exists updated_at timestamptz not null default now();
alter table public.ugc_games add column if not exists reviewed_by uuid;
alter table public.ugc_games add column if not exists reviewed_at timestamptz;
do $$ begin
  alter table public.ugc_games add constraint ugc_games_kind check (kind in ('tpl', 'html'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ugc_games add constraint ugc_games_status check (status in ('draft', 'link', 'review', 'public', 'hidden', 'banned'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ugc_games add constraint ugc_games_sizes check (char_length(title) between 2 and 60 and char_length(descr) <= 300
    and char_length(icon) <= 16 and (html is null or char_length(html) <= 200000));
exception when duplicate_object then null; end $$;
create index if not exists ugc_games_cat on public.ugc_games (status, plays desc);
create index if not exists ugc_games_author on public.ugc_games (author, updated_at desc);

create table if not exists public.ugc_likes (
  game_id text not null references public.ugc_games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (game_id, user_id)
);
create table if not exists public.ugc_reports (
  game_id text not null references public.ugc_games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (game_id, user_id)
);
create table if not exists public.ugc_plays (
  game_id text not null,
  viewer text not null,
  at timestamptz not null default now()
);
create index if not exists ugc_plays_recent on public.ugc_plays (game_id, viewer, at desc);

alter table public.ugc_games enable row level security;
alter table public.ugc_likes enable row level security;
alter table public.ugc_reports enable row level security;
alter table public.ugc_plays enable row level security;

create or replace function public.ugc_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'moderator'))
$$;

-- Читать: игры по ссылке, на проверке и в каталоге — всем; свои — автору; всё — модераторам
drop policy if exists ugc_games_read on public.ugc_games;
create policy ugc_games_read on public.ugc_games for select
  using (status in ('link', 'review', 'public') or author = auth.uid() or public.ugc_is_staff());
grant select on public.ugc_games to anon, authenticated;
revoke insert, update, delete on public.ugc_games from anon, authenticated;
revoke all on public.ugc_likes, public.ugc_reports, public.ugc_plays from anon, authenticated;

-- Короткий номер игры для ссылки /g/<id>
create or replace function public.ugc_new_id() returns text language plpgsql as $$
declare s text;
begin
  loop
    s := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    exit when not exists (select 1 from public.ugc_games where id = s);
  end loop;
  return s;
end $$;
revoke execute on function public.ugc_new_id() from public, anon, authenticated;

-- ── Сохранить игру (новую — p_id пусто). Шаблон: p_tpl + p_data; свой код: p_html ──
create or replace function public.ugc_save(p_id text, p_title text, p_descr text, p_icon text, p_kind text, p_tpl text, p_data jsonb, p_html text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); g public.ugc_games%rowtype;
  t text := btrim(coalesce(p_title, '')); d text := left(btrim(coalesce(p_descr, '')), 300); ic text := btrim(coalesce(p_icon, ''));
  v_tpl text; v_data jsonb; v_html text; v_status text; new_id text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if char_length(t) < 2 or char_length(t) > 60 then return jsonb_build_object('ok', false, 'reason', 'title'); end if;
  if ic = '' or char_length(ic) > 16 then ic := '🎮'; end if;
  if p_kind = 'tpl' then
    if coalesce(p_tpl, '') !~ '^[a-z]{2,20}$' then return jsonb_build_object('ok', false, 'reason', 'tpl'); end if;
    if p_data is null or jsonb_typeof(p_data) <> 'object' or char_length(p_data::text) > 30000 then return jsonb_build_object('ok', false, 'reason', 'data'); end if;
    v_tpl := p_tpl; v_data := p_data; v_html := null;
  elsif p_kind = 'html' then
    if p_html is null or char_length(p_html) < 20 or char_length(p_html) > 200000 then return jsonb_build_object('ok', false, 'reason', 'html'); end if;
    v_tpl := null; v_data := '{}'::jsonb; v_html := p_html;
  else
    return jsonb_build_object('ok', false, 'reason', 'kind');
  end if;

  if coalesce(p_id, '') = '' then
    if (select count(*) from public.ugc_games where author = uid) >= 30 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
    if exists (select 1 from public.ugc_games where author = uid and created_at > now() - interval '20 seconds') then
      return jsonb_build_object('ok', false, 'reason', 'too_fast');
    end if;
    new_id := public.ugc_new_id();
    insert into public.ugc_games (id, author, title, descr, icon, kind, tpl, data, html, status)
      values (new_id, uid, t, d, ic, p_kind, v_tpl, v_data, v_html, 'draft');
    return jsonb_build_object('ok', true, 'id', new_id, 'status', 'draft');
  end if;

  select * into g from public.ugc_games where id = p_id for update;
  if not found or g.author <> uid then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if g.status = 'banned' then return jsonb_build_object('ok', false, 'reason', 'banned'); end if;
  -- ничего не поменялось — просто ok (статус не трогаем)
  if g.title = t and g.descr = d and g.icon = ic and g.kind = p_kind and g.tpl is not distinct from v_tpl
     and g.data = v_data and g.html is not distinct from v_html then
    return jsonb_build_object('ok', true, 'id', g.id, 'status', g.status, 'same', true);
  end if;
  if g.updated_at > now() - interval '2 seconds' then return jsonb_build_object('ok', false, 'reason', 'too_fast'); end if;
  v_status := case when g.status = 'public' then 'review' else g.status end;   -- изменили игру из каталога — снова на проверку
  update public.ugc_games set title = t, descr = d, icon = ic, kind = p_kind, tpl = v_tpl, data = v_data, html = v_html,
    status = v_status, updated_at = now() where id = g.id;
  return jsonb_build_object('ok', true, 'id', g.id, 'status', v_status);
end $$;
grant execute on function public.ugc_save(text, text, text, text, text, text, jsonb, text) to authenticated;

-- ── Автор: черновик / по ссылке / в каталог (на проверку) / скрыть / удалить ──
create or replace function public.ugc_status(p_id text, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); g public.ugc_games%rowtype;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into g from public.ugc_games where id = p_id for update;
  if not found or g.author <> uid then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_status = 'deleted' then
    delete from public.ugc_games where id = g.id;
    return jsonb_build_object('ok', true, 'status', 'deleted');
  end if;
  if g.status = 'banned' then return jsonb_build_object('ok', false, 'reason', 'banned'); end if;
  if p_status not in ('draft', 'link', 'review', 'hidden') then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if p_status = 'review' and g.status = 'public' then return jsonb_build_object('ok', true, 'status', 'public'); end if;
  update public.ugc_games set status = p_status, updated_at = now() where id = g.id;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;
grant execute on function public.ugc_status(text, text) to authenticated;

-- ── Модератор: в каталог / только по ссылке / заблокировать ──
create or replace function public.ugc_review(p_id text, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.ugc_is_staff() then return jsonb_build_object('ok', false, 'reason', 'staff'); end if;
  if p_status not in ('public', 'link', 'banned') then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  update public.ugc_games set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
    reports = case when p_status = 'public' then 0 else reports end
    where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_status = 'public' then delete from public.ugc_reports where game_id = p_id; end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;
grant execute on function public.ugc_review(text, text) to authenticated;

-- ── Запуск игры: +1 (не свой, не чаще раза в 30 мин с одного человека), монеты автору ──
create or replace function public.ugc_play(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); g public.ugc_games%rowtype; hdr json; ip text; v_viewer text; n int; earned int;
begin
  select * into g from public.ugc_games where id = p_id;
  if not found or g.status not in ('link', 'review', 'public') then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if uid is not null and uid = g.author then return jsonb_build_object('ok', true, 'counted', false, 'own', true); end if;
  begin hdr := nullif(current_setting('request.headers', true), '')::json; exception when others then hdr := null; end;
  ip := coalesce(hdr ->> 'cf-connecting-ip', hdr ->> 'x-real-ip', split_part(coalesce(hdr ->> 'x-forwarded-for', ''), ',', 1), '');
  v_viewer := coalesce(uid::text, 'ip:' || md5(ip));
  if exists (select 1 from public.ugc_plays p where p.game_id = g.id and p.viewer = v_viewer and p.at > now() - interval '30 minutes') then
    return jsonb_build_object('ok', true, 'counted', false);
  end if;
  insert into public.ugc_plays (game_id, viewer) values (g.id, v_viewer);
  update public.ugc_games set plays = plays + 1 where id = g.id returning plays into n;
  if n % 10 = 0 and to_regprocedure('public.coin_add(uuid,integer,text,text)') is not null then
    select coalesce(sum(amount), 0) into earned from public.coin_log where user_id = g.author and source = 'ugc' and day = public.coin_today();
    if earned < 100 then perform public.coin_add(g.author, 1, 'ugc', g.id); end if;
  end if;
  if random() < .02 then delete from public.ugc_plays where at < now() - interval '2 days'; end if;
  return jsonb_build_object('ok', true, 'counted', true, 'plays', n);
end $$;
grant execute on function public.ugc_play(text) to anon, authenticated;

-- ── Лайк (повторно — убрать) ──
create or replace function public.ugc_like(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_liked boolean; n int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not exists (select 1 from public.ugc_games where id = p_id and status in ('link', 'review', 'public')) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if exists (select 1 from public.ugc_likes where game_id = p_id and user_id = uid) then
    delete from public.ugc_likes where game_id = p_id and user_id = uid; v_liked := false;
  else
    insert into public.ugc_likes (game_id, user_id) values (p_id, uid); v_liked := true;
  end if;
  update public.ugc_games set likes = (select count(*) from public.ugc_likes where game_id = p_id) where id = p_id returning likes into n;
  return jsonb_build_object('ok', true, 'liked', v_liked, 'likes', n);
end $$;
grant execute on function public.ugc_like(text) to authenticated;

-- ── Жалоба: одна от человека; 3 жалобы — игра уходит из каталога до проверки ──
create or replace function public.ugc_report(p_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not exists (select 1 from public.ugc_games where id = p_id and status in ('link', 'review', 'public')) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  insert into public.ugc_reports (game_id, user_id, reason) values (p_id, uid, left(coalesce(p_reason, ''), 200))
    on conflict (game_id, user_id) do update set reason = excluded.reason, created_at = now();
  update public.ugc_games set reports = (select count(*) from public.ugc_reports where game_id = p_id) where id = p_id returning reports into n;
  if n >= 3 then update public.ugc_games set status = 'review' where id = p_id and status = 'public'; end if;
  return jsonb_build_object('ok', true, 'reports', n);
end $$;
grant execute on function public.ugc_report(text, text) to authenticated;
