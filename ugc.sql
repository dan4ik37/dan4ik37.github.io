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
--  3D-миры «Студии 3D» — тоже здесь (kind = 'place', data — мир). Свои 3D-модели — ugc_models + хранилище ugc3d (в конце файла).
--  Облачные сохранения игр (☁️ «Кубомир») — cloud_saves + закрытое хранилище saves (самый конец файла; от остального не зависит).
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
-- виды: tpl — шаблон, html — свой код, place — 3D-мир из «Студии 3D» (data — мир: объекты, свет, ландшафт)
alter table public.ugc_games drop constraint if exists ugc_games_kind;
alter table public.ugc_games add constraint ugc_games_kind check (kind in ('tpl', 'html', 'place'));
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
  elsif p_kind = 'place' then
    -- 3D-мир: объекты (массив), свет, ландшафт (сжатый), список моделей; до 900 000 знаков
    if p_data is null or jsonb_typeof(p_data) <> 'object' or jsonb_typeof(p_data -> 'objects') is distinct from 'array'
       or jsonb_array_length(p_data -> 'objects') > 3000 or char_length(p_data::text) > 900000 then
      return jsonb_build_object('ok', false, 'reason', 'data');
    end if;
    v_tpl := null; v_data := p_data; v_html := null;
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

-- ═══════════════════════════════════════════════════════════════════
--  СВОИ 3D-МОДЕЛИ «СТУДИИ 3D» (js/engine/model.js, js/games/studio3d.js)
--  Файл модели — в закрытом хранилище ugc3d: models/<автор>/<номер>.json (не меняется: изменённая модель = новый номер).
--  Строка — в ugc_models. Новая модель — на проверке: видят только автор и модераторы, в чужих мирах на её месте пустая
--  коробка. Одобрил модератор — видят все. Заблокированная — не видна никому, кроме автора и модераторов.
--  Проверка после запуска: /rpc/ugc_model_save гостем {"p_id":"abcdef","p_name":"x","p_tris":1,"p_bytes":1} → reason auth
-- ═══════════════════════════════════════════════════════════════════
create table if not exists public.ugc_models (
  id text primary key,
  author uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'Модель',
  created_at timestamptz not null default now()
);
alter table public.ugc_models add column if not exists tris int not null default 0;
alter table public.ugc_models add column if not exists bytes int not null default 0;
alter table public.ugc_models add column if not exists status text not null default 'review';
alter table public.ugc_models add column if not exists updated_at timestamptz not null default now();
alter table public.ugc_models add column if not exists reviewed_by uuid;
alter table public.ugc_models add column if not exists reviewed_at timestamptz;
alter table public.ugc_models drop constraint if exists ugc_models_check;
alter table public.ugc_models add constraint ugc_models_check check (status in ('review', 'public', 'banned')
  and char_length(name) between 1 and 40 and id ~ '^[a-z0-9]{6,24}$' and tris between 0 and 100000 and bytes between 0 and 20000000);
create index if not exists ugc_models_review on public.ugc_models (status, updated_at desc);
create index if not exists ugc_models_author on public.ugc_models (author, created_at desc);
alter table public.ugc_models enable row level security;
drop policy if exists ugc_models_read on public.ugc_models;
create policy ugc_models_read on public.ugc_models for select using (status = 'public' or author = auth.uid() or public.ugc_is_staff());
grant select on public.ugc_models to anon, authenticated;
revoke insert, update, delete on public.ugc_models from anon, authenticated;

-- ── Автор: записать модель после загрузки файла (новая — на проверку; уже есть — только имя) ──
create or replace function public.ugc_model_save(p_id text, p_name text, p_tris int, p_bytes int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.ugc_models%rowtype; nm text := left(btrim(coalesce(p_name, '')), 40);
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if coalesce(p_id, '') !~ '^[a-z0-9]{6,24}$' then return jsonb_build_object('ok', false, 'reason', 'id'); end if;
  if nm = '' then nm := 'Модель'; end if;
  if p_tris is null or p_tris < 0 or p_tris > 100000 or p_bytes is null or p_bytes < 0 or p_bytes > 20000000 then
    return jsonb_build_object('ok', false, 'reason', 'size');
  end if;
  select * into m from public.ugc_models where id = p_id for update;
  if found then
    if m.author <> uid then return jsonb_build_object('ok', false, 'reason', 'taken'); end if;
    if m.name <> nm and m.status <> 'banned' then update public.ugc_models set name = nm, updated_at = now() where id = p_id; end if;
    return jsonb_build_object('ok', true, 'status', m.status, 'same', true);
  end if;
  if (select count(*) from public.ugc_models where author = uid) >= 60 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
  if exists (select 1 from public.ugc_models where author = uid and created_at > now() - interval '2 seconds') then
    return jsonb_build_object('ok', false, 'reason', 'too_fast');
  end if;
  insert into public.ugc_models (id, author, name, tris, bytes, status) values (p_id, uid, nm, p_tris, p_bytes, 'review');
  return jsonb_build_object('ok', true, 'status', 'review');
end $$;
grant execute on function public.ugc_model_save(text, text, int, int) to authenticated;

-- ── Модератор: одобрить / вернуть на проверку / заблокировать ──
create or replace function public.ugc_model_review(p_id text, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.ugc_is_staff() then return jsonb_build_object('ok', false, 'reason', 'staff'); end if;
  if p_status not in ('public', 'review', 'banned') then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  update public.ugc_models set status = p_status, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;
grant execute on function public.ugc_model_review(text, text) to authenticated;

-- ── Автор: удалить свою модель (заблокированная остаётся — для истории) ──
create or replace function public.ugc_model_delete(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  delete from public.ugc_models where id = p_id and author = auth.uid() and status <> 'banned';
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.ugc_model_delete(text) to authenticated;

-- ── Хранилище файлов моделей: закрытое; писать — только в свою папку, файл не перезаписывается ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ugc3d', 'ugc3d', false, 20971520, array['application/json'])
on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = array['application/json'];

drop policy if exists "ugc3d: загрузить свою модель" on storage.objects;
create policy "ugc3d: загрузить свою модель" on storage.objects for insert to authenticated
  with check (bucket_id = 'ugc3d' and (storage.foldername(name))[1] = 'models' and (storage.foldername(name))[2] = auth.uid()::text
    and name ~ '^models/[0-9a-f-]{36}/[a-z0-9]{6,24}\.json$');
drop policy if exists "ugc3d: удалить свою модель" on storage.objects;
create policy "ugc3d: удалить свою модель" on storage.objects for delete to authenticated
  using (bucket_id = 'ugc3d' and (storage.foldername(name))[1] = 'models' and (storage.foldername(name))[2] = auth.uid()::text);
drop policy if exists "ugc3d: читать свои, проверенные, модераторам" on storage.objects;
create policy "ugc3d: читать свои, проверенные, модераторам" on storage.objects for select to anon, authenticated
  using (bucket_id = 'ugc3d' and (
    (storage.foldername(name))[2] = auth.uid()::text
    or public.ugc_is_staff()
    or exists (select 1 from public.ugc_models m where m.status = 'public' and storage.objects.name = 'models/' || m.author::text || '/' || m.id || '.json')));

-- ═══════════════════════════════════════════════════════════════════
--  ☁️ ОБЛАЧНЫЕ СОХРАНЕНИЯ ИГР (js/core/cloud.js; сейчас «Кубомир», потом «Подземье»; T-019, 22.10.2026)
--  Мир живёт в браузере (IndexedDB), облако — копия: войти с другого устройства — мир там же. Файл мира — в закрытом хранилище
--  saves: <uid>/<игра>/<мир>/<версия>-<случ>.kbw (сжатый gzip). Читает и пишет только хозяин аккаунта. Загрузить можно только тот
--  путь, что выдал cloud_begin (место проверено), новая версия — новый файл, старый удаляется после cloud_commit.
--  Строка мира — cloud_saves: имя, размер, версия (растёт на каждой записи — по ней видно, что мир меняли с другого устройства),
--  игровое время (gt, с), устройство. Писать в таблицу напрямую нельзя — только функциями ниже.
--  Числа — cloud_rule(): мест 3 (VIP — 5, только удобство), файл до 5 МБ, всего на сайт — 700 МБ (бесплатный тариф Supabase —
--  1 ГБ на всё хранилище), записывать мир не чаще раза в 20 с. Предложения — меняет владелец здесь (копия в js/core/cloud.js RULES).
--  Нужны: только auth.users и storage (есть всегда); vip_tier_of — если есть (progression.sql), иначе VIP-мест нет.
--  Проверка после запуска (гостем): /rpc/cloud_rule {"p_key":"slots"} → 3; /rpc/cloud_list {"p_game":"kubomir"} → {"ok":false,"reason":"auth"};
--  /rest/v1/cloud_saves?select=world&limit=0 → 200 (404/PGRST205 — не применён).
-- ═══════════════════════════════════════════════════════════════════
create table if not exists public.cloud_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null,
  world text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, game, world)
);
alter table public.cloud_saves add column if not exists name text not null default '';
alter table public.cloud_saves add column if not exists bytes bigint not null default 0;
alter table public.cloud_saves add column if not exists ver int not null default 0;
alter table public.cloud_saves add column if not exists gt double precision not null default 0;
alter table public.cloud_saves add column if not exists device text not null default '';
alter table public.cloud_saves add column if not exists path text;
alter table public.cloud_saves add column if not exists pending text;
alter table public.cloud_saves add column if not exists pend_at timestamptz;
alter table public.cloud_saves add column if not exists updated_at timestamptz not null default now();
alter table public.cloud_saves drop constraint if exists cloud_saves_check;
alter table public.cloud_saves add constraint cloud_saves_check check (game ~ '^[a-z]{2,16}$' and world ~ '^[A-Za-z0-9_-]{2,40}$'
  and char_length(name) <= 40 and bytes between 0 and 52428800 and char_length(device) <= 24 and ver >= 0 and gt >= 0);
alter table public.cloud_saves enable row level security;
drop policy if exists cloud_saves_read on public.cloud_saves;
create policy cloud_saves_read on public.cloud_saves for select using (user_id = auth.uid());
grant select on public.cloud_saves to authenticated;
revoke insert, update, delete on public.cloud_saves from anon, authenticated;
revoke all on public.cloud_saves from anon;

-- ── Числа облака (одно место) ──
create or replace function public.cloud_rule(p_key text) returns bigint language sql immutable as $$
  select case p_key when 'slots' then 3 when 'slots_vip' then 5 when 'max_bytes' then 5242880 when 'total_mb' then 700
    when 'min_gap_s' then 20 when 'pending_min' then 15 else null end::bigint
$$;
grant execute on function public.cloud_rule(text) to anon, authenticated;

-- мест у человека: VIP (любого уровня, в т. ч. за уровень) — больше; нет vip_tier_of — как у всех
create or replace function public.cloud_slots(uid uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare t text;
begin
  if to_regprocedure('public.vip_tier_of(uuid)') is not null then
    begin execute 'select public.vip_tier_of($1)' into t using uid; exception when others then t := null; end;
  end if;
  return (case when t is not null then public.cloud_rule('slots_vip') else public.cloud_rule('slots') end)::int;
end $$;
revoke execute on function public.cloud_slots(uuid) from public, anon, authenticated;

-- ── Свои миры в облаке ──
create or replace function public.cloud_list(p_game text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  return jsonb_build_object('ok', true, 'slots', public.cloud_slots(uid), 'max_bytes', public.cloud_rule('max_bytes'),
    'used', (select count(*) from public.cloud_saves s where s.user_id = uid and s.game = p_game and s.path is not null),
    'list', coalesce((select jsonb_agg(jsonb_build_object('world', s.world, 'name', s.name, 'bytes', s.bytes, 'ver', s.ver, 'gt', s.gt,
        'device', s.device, 'path', s.path, 'at', s.updated_at) order by s.updated_at desc)
      from public.cloud_saves s where s.user_id = uid and s.game = p_game and s.path is not null), '[]'::jsonb));
end $$;
grant execute on function public.cloud_list(text) to anon, authenticated;

-- ── Записать версию, шаг 1: место и путь для файла. p_base — с какой версией облака совпадала копия (null — ни с какой);
--    другая — 'conflict' (мир меняли с другого устройства: игра спросит, какую версию оставить; p_force — «оставить эту») ──
create or replace function public.cloud_begin(p_game text, p_world text, p_name text, p_bytes bigint, p_base int, p_gt double precision, p_device text, p_force boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s public.cloud_saves%rowtype; n int; sl int; tot bigint; p text; gap int := public.cloud_rule('min_gap_s')::int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if coalesce(p_game, '') !~ '^[a-z]{2,16}$' or coalesce(p_world, '') !~ '^[A-Za-z0-9_-]{2,40}$' then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > public.cloud_rule('max_bytes') then
    return jsonb_build_object('ok', false, 'reason', 'size', 'max', public.cloud_rule('max_bytes'));
  end if;
  -- брошенные места (файл так и не дошёл) — освободить
  delete from public.cloud_saves where user_id = uid and path is null and coalesce(pend_at, created_at) < now() - make_interval(mins => public.cloud_rule('pending_min')::int);
  select * into s from public.cloud_saves where user_id = uid and game = p_game and world = p_world for update;
  if found then
    if s.path is not null and s.updated_at > now() - make_interval(secs => gap) then
      return jsonb_build_object('ok', false, 'reason', 'too_fast', 'wait', ceil(extract(epoch from (s.updated_at + make_interval(secs => gap) - now()))));
    end if;
    if s.path is not null and not coalesce(p_force, false) and p_base is distinct from s.ver then
      return jsonb_build_object('ok', false, 'reason', 'conflict', 'ver', s.ver, 'gt', s.gt, 'at', s.updated_at, 'device', s.device, 'bytes', s.bytes, 'name', s.name);
    end if;
  else
    sl := public.cloud_slots(uid);
    select count(*) into n from public.cloud_saves where user_id = uid and game = p_game;
    if n >= sl then return jsonb_build_object('ok', false, 'reason', 'slots', 'slots', sl, 'used', n); end if;
    insert into public.cloud_saves (user_id, game, world, name, pend_at) values (uid, p_game, p_world, left(btrim(coalesce(p_name, '')), 40), now())
      returning * into s;
  end if;
  -- всё облако сайта (бесплатный тариф): не больше total_mb
  select coalesce(sum(bytes), 0) into tot from public.cloud_saves;
  if tot - s.bytes + p_bytes > public.cloud_rule('total_mb') * 1048576 then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
  p := uid::text || '/' || p_game || '/' || p_world || '/' || (s.ver + 1)::text || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10) || '.kbw';
  update public.cloud_saves set pending = p, pend_at = now() where user_id = uid and game = p_game and world = p_world;
  return jsonb_build_object('ok', true, 'path', p, 'ver', s.ver);
end $$;
revoke execute on function public.cloud_begin(text, text, text, bigint, int, double precision, text, boolean) from public, anon;
grant execute on function public.cloud_begin(text, text, text, bigint, int, double precision, text, boolean) to authenticated;

-- ── Шаг 2 (файл уже в хранилище): новая версия. Размер — настоящий (из хранилища), путь — только выданный в cloud_begin ──
create or replace function public.cloud_commit(p_game text, p_world text, p_path text, p_bytes bigint, p_gt double precision, p_device text, p_name text, p_base int, p_force boolean)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare uid uuid := auth.uid(); s public.cloud_saves%rowtype; sz bigint; nm text := left(btrim(coalesce(p_name, '')), 40);
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into s from public.cloud_saves where user_id = uid and game = p_game and world = p_world for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if s.pending is distinct from p_path then return jsonb_build_object('ok', false, 'reason', 'stale'); end if;
  if s.path is not null and not coalesce(p_force, false) and p_base is distinct from s.ver then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'ver', s.ver, 'gt', s.gt, 'at', s.updated_at, 'device', s.device, 'bytes', s.bytes, 'name', s.name);
  end if;
  begin
    select coalesce(nullif(o.metadata ->> 'size', '')::bigint, p_bytes) into sz from storage.objects o where o.bucket_id = 'saves' and o.name = p_path;
    if not found then return jsonb_build_object('ok', false, 'reason', 'nofile'); end if;
  exception when insufficient_privilege or undefined_table or undefined_column then sz := p_bytes;   -- нет доступа к хранилищу — размер со слов браузера
  end;
  update public.cloud_saves set ver = s.ver + 1, path = p_path, pending = null, pend_at = null, bytes = greatest(0, least(sz, 52428800)),
    gt = greatest(0, coalesce(p_gt, 0)), device = left(coalesce(p_device, ''), 24), name = case when nm <> '' then nm else s.name end, updated_at = now()
    where user_id = uid and game = p_game and world = p_world;
  return jsonb_build_object('ok', true, 'ver', s.ver + 1, 'old', s.path);
end $$;
revoke execute on function public.cloud_commit(text, text, text, bigint, double precision, text, text, int, boolean) from public, anon;
grant execute on function public.cloud_commit(text, text, text, bigint, double precision, text, text, int, boolean) to authenticated;

-- ── Убрать мир из облака (файлы удаляет браузер — пути в ответе) ──
create or replace function public.cloud_delete(p_game text, p_world text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p text; pe text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  delete from public.cloud_saves where user_id = uid and game = p_game and world = p_world returning path, pending into p, pe;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'path', p, 'pending', pe);
end $$;
revoke execute on function public.cloud_delete(text, text) from public, anon;
grant execute on function public.cloud_delete(text, text) to authenticated;

-- ── Хранилище saves: закрытое, файл до 5 МБ; загрузить — только выданный путь (место проверено), читать и удалять — свою папку ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('saves', 'saves', false, 5242880, array['application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['application/octet-stream'];

drop policy if exists "saves: загрузить выданный путь" on storage.objects;
create policy "saves: загрузить выданный путь" on storage.objects for insert to authenticated
  with check (bucket_id = 'saves' and (storage.foldername(name))[1] = auth.uid()::text and exists (select 1 from public.cloud_saves s
    where s.user_id = auth.uid() and s.pending = storage.objects.name and s.pend_at > now() - interval '15 minutes'));
drop policy if exists "saves: читать свою папку" on storage.objects;
create policy "saves: читать свою папку" on storage.objects for select to authenticated
  using (bucket_id = 'saves' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "saves: удалить из своей папки" on storage.objects;
create policy "saves: удалить из своей папки" on storage.objects for delete to authenticated
  using (bucket_id = 'saves' and (storage.foldername(name))[1] = auth.uid()::text);
