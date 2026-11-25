-- ❤ НА САЙТЕ (community.sql, часть 20) — отдельным файлом, чтобы вставить ЦЕЛИКОМ в Supabase → SQL Editor → Run.
-- Копия конца community.sql один в один (scripts/part20-sql-test.mjs сверяет: правка — только в community.sql, потом сюда). Повторный запуск безопасен.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ЧАСТЬ 20 (25.11.2026): ❤ на сайте у роликов и стрима — владелец: «вход через гугл и другие платформы, чтобы люди могли ставить
--   нормально лайк и смотреть видео и стримы наконец». Лайк на YouTube сайт ставить не может (нужна проверка приложения Google —
--   docs/areas/architecture.md «Видео»), поэтому у ролика и у сегодняшнего стрима — своё «❤ на сайте»: один от человека, повторно —
--   убрать. Наград за ❤ нет и не будет (ни XP, ни 🪙, ни заданий). Это не общение — ❤ доступно всем возрастам; кто поставил — не
--   показывается никому (только число). Повторный запуск безопасен (if not exists / create or replace / drop … if exists). Нужны:
--   auth.users (есть всегда), site_config (есть на базе; без неё метки просто не будет).
--   Сайт работает и без этой части: кнопки ❤ нет (js/features/site-like.js смотрит метку site_config part20).
--   Проверка с сервера: rpc part20_info → {"ok":true,"v":1}; таблица site_config, строка key = 'part20' → value '1' (видна гостю);
--   rpc site_like гостем {"p_kind":"video","p_item":"dQw4w9WgXcQ"} → {"ok":false,"reason":"auth"};
--   rpc site_like_info гостем {"p_kind":"video","p_items":["dQw4w9WgXcQ"]} → {"ok":true,"items":{"dQw4w9WgXcQ":{"n":0,"mine":false}}}.
--   Что лайкают: kind 'video' — номер ролика YouTube (11 знаков); kind 'stream' — эфир Twitch ЭТОГО дня по Москве: сайт шлёт 'live',
--   сервер сам ставит дату ('tw-2026-11-25') — лайкнуть другой день нельзя.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- 20.1 Таблица: одна строка = один ❤ одного человека. Напрямую её не читает и не пишет никто — только функции ниже
create table if not exists public.site_likes (
  kind text not null check (kind in ('video', 'stream')),
  item text not null check (item ~ '^[A-Za-z0-9_-]{1,40}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (kind, item, user_id)
);
create index if not exists site_likes_user on public.site_likes (user_id, created_at desc);
alter table public.site_likes enable row level security;   -- политик нет: только через функции
revoke all on public.site_likes from anon, authenticated;

-- 20.2 Номер того, что лайкают (или null — нельзя): ролик — 11 знаков YouTube; стрим — 'live' → сегодняшний день по Москве
create or replace function public.site_like_item(p_kind text, p_item text)
returns text language sql stable set search_path = public as $$
  select case
    when p_kind = 'video' and p_item ~ '^[A-Za-z0-9_-]{11}$' then p_item
    when p_kind = 'stream' and p_item = 'live' then 'tw-' || to_char(now() at time zone 'Europe/Moscow', 'YYYY-MM-DD')
    when p_kind = 'stream' and p_item ~ '^tw-[0-9]{4}-[0-9]{2}-[0-9]{2}$' then p_item   -- только для чтения (site_like_info)
    else null end
$$;
revoke all on function public.site_like_item(text, text) from public;
grant execute on function public.site_like_item(text, text) to anon, authenticated;

-- 20.3 Поставить / убрать ❤. p_on: true — поставить (уже стоит — ничего), false — убрать, null — наоборот тому, что есть.
--   Стрим: только сегодняшний ('live'). → { ok, liked, n } | { ok:false, reason: 'auth' | 'bad' | 'slow' }
create or replace function public.site_like(p_kind text, p_item text, p_on boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_item text; v_has boolean; v_on boolean; v_n int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_kind = 'stream' and p_item is distinct from 'live' then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  v_item := public.site_like_item(p_kind, p_item);
  if v_item is null then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  v_has := exists (select 1 from public.site_likes where kind = p_kind and item = v_item and user_id = uid);
  v_on := coalesce(p_on, not v_has);
  if v_on and not v_has then
    -- защита от мусора: не больше 300 новых ❤ за сутки от одного человека (обычному зрителю не достать; без неё один аккаунт
    -- скриптом забил бы таблицу выдуманными номерами роликов)
    if (select count(*) from public.site_likes where user_id = uid and created_at > now() - interval '1 day') >= 300 then
      return jsonb_build_object('ok', false, 'reason', 'slow');
    end if;
    insert into public.site_likes (kind, item, user_id) values (p_kind, v_item, uid) on conflict do nothing;
  elsif not v_on and v_has then
    delete from public.site_likes where kind = p_kind and item = v_item and user_id = uid;
  end if;
  select count(*) into v_n from public.site_likes where kind = p_kind and item = v_item;
  return jsonb_build_object('ok', true, 'liked', v_on, 'n', v_n);
end $$;
revoke all on function public.site_like(text, text, boolean) from public, anon;
grant execute on function public.site_like(text, text, boolean) to authenticated;

-- 20.4 Сколько ❤ и стоит ли мой (гостю — только число). Не больше 60 номеров за раз. → { ok, items: { <номер как прислали>: { n, mine } } }
create or replace function public.site_like_info(p_kind text, p_items text[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_res jsonb := '{}'::jsonb; v_raw text; v_item text; v_n int; v_mine boolean;
begin
  if p_kind not in ('video', 'stream') or p_items is null then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  foreach v_raw in array p_items[1:60] loop
    v_item := public.site_like_item(p_kind, v_raw);
    if v_item is null then continue; end if;
    select count(*), coalesce(bool_or(user_id = uid), false) into v_n, v_mine from public.site_likes where kind = p_kind and item = v_item;
    v_res := v_res || jsonb_build_object(v_raw, jsonb_build_object('n', v_n, 'mine', coalesce(v_mine, false)));
  end loop;
  return jsonb_build_object('ok', true, 'items', v_res);
end $$;
revoke all on function public.site_like_info(text, text[]) from public;
grant execute on function public.site_like_info(text, text[]) to anon, authenticated;

-- 20.5 Проверка и метка для сайта (как у частей 18 / 19: строку видят и гости)
create or replace function public.part20_info()
returns jsonb language sql stable as $$ select jsonb_build_object('ok', true, 'v', 1) $$;
revoke all on function public.part20_info() from public;
grant execute on function public.part20_info() to anon, authenticated;
do $$ begin
  if to_regclass('public.site_config') is not null then
    update public.site_config set value = '1' where key = 'part20';
    if not found then insert into public.site_config (key, value) values ('part20', '1'); end if;
  end if;
exception when others then raise warning 'ч. 20: метка site_config part20 не поставлена: %', sqlerrm;
end $$;
do $$ begin
  if to_regclass('public.site_config') is not null then
    drop policy if exists site_config_part20_read on public.site_config;
    create policy site_config_part20_read on public.site_config for select to anon, authenticated using (key = 'part20');
  end if;
exception when others then raise warning 'ч. 20: правило чтения метки part20 не создано: %', sqlerrm;
end $$;
