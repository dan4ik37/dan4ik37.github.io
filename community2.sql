-- ═══════════════════════════════════════════════════════════════════
--  СООБЩЕСТВА 2 («как Дискорд», продолжение): «Денчик-бот» 📢 в сервере «Денчик37»
--  (js/features/community2.js, community.js, msgview.js, chat.js, api/push-check.js)
--  Выполнить целиком в Supabase → SQL Editor ПОСЛЕ community.sql и premium.sql (оба уже применены).
--  Идемпотентно — можно запускать ещё раз. Писать в новые таблицы напрямую нельзя — только функциями ниже.
--
--  Что внутри:
--   • канал «📢 новости» (#news) сервера «Денчик37»: пишут только команда сайта и Денчик-бот;
--     бот пишет туда сам (api/push-check.js раз в 5 минут): «🔴 Денчик в эфире», «🎬 Новое видео» — функция bot_post,
--     её может вызвать ТОЛЬКО сервер (service_role), один и тот же повод — один раз (bot_posts)
--   • колонка messages.is_sticker (chat-stickers.sql): на живой базе её не было, а триггер vip-balance.sql её ждёт
--
--  Проверка после запуска (гостем, publishable-ключ):
--   /rest/v1/chat_channels?id=eq.news → [{"id":"news",…,"mods_only":true}]
--   /rpc/bot_post гостем {"p_channel":"news","p_text":"x"} → 401 «permission denied» (PGRST202 = файл не применён)
-- ═══════════════════════════════════════════════════════════════════

-- chat-stickers.sql на живой базе не применён, а триггер messages_enforce_status (vip-balance.sql) пишет new.is_sticker
alter table public.messages add column if not exists is_sticker boolean not null default false;

-- ═══ 1. «Денчик-бот» и канал «📢 новости» ═══
-- position −1 — над #общий (как «объявления» в Дискорде); сайт по умолчанию всё равно открывает #общий
insert into public.chat_channels (id, name, kind, position, mods_only, about) values
  ('news', 'новости', 'text', -1, true, '📢 Эфиры, новые видео и события — пишут Денчик-бот и команда сайта')
on conflict (id) do nothing;

-- Что бот уже написал (повод → сообщение): один и тот же эфир / ролик / праздник — один раз
create table if not exists public.bot_posts (
  key text primary key check (char_length(key) between 1 and 80),
  message_id bigint,
  created_at timestamptz not null default now()
);
alter table public.bot_posts enable row level security;
revoke all on public.bot_posts from anon, authenticated;

-- Сообщение от бота в канал сервера «Денчик37». Только для сервера (service_role): триггеры чата (chat_guard,
-- messages_enforce_status, флуд) такие вставки пропускают как есть — поэтому браузеру функция не выдаётся.
-- p_key — повод («stream:…», «video:<id>»): уже было — { ok, dup: true }, второго сообщения нет.
create or replace function public.bot_post(p_channel text, p_text text, p_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ch text := coalesce(nullif(btrim(coalesce(p_channel, '')), ''), 'news'); v_text text := left(btrim(coalesce(p_text, '')), 500);
  v_key text := left(nullif(btrim(coalesce(p_key, '')), ''), 80); v_id bigint;
begin
  if v_text = '' then return jsonb_build_object('ok', false, 'reason', 'len'); end if;
  if not exists (select 1 from public.chat_channels where id = v_ch and kind = 'text') then v_ch := 'general'; end if;
  if v_key is not null then
    insert into public.bot_posts (key) values (v_key) on conflict (key) do nothing;
    if not found then return jsonb_build_object('ok', true, 'dup', true); end if;
  end if;
  insert into public.messages (nick, text, color, role, user_id, channel)
    values ('Денчик-бот', v_text, '#5865f2', 'bot', null, case when v_ch = 'general' then null else v_ch end)
    returning id into v_id;
  if v_key is not null then update public.bot_posts set message_id = v_id where key = v_key; end if;
  delete from public.bot_posts where created_at < now() - interval '400 days';
  return jsonb_build_object('ok', true, 'id', v_id, 'channel', v_ch);
end $$;
revoke all on function public.bot_post(text, text, text) from public, anon, authenticated;
grant execute on function public.bot_post(text, text, text) to service_role;
