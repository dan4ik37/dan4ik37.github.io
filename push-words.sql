-- ═══════════════════════════════════════════════════════════════════
--  НАПОМИНАНИЕ «НОВОЕ СЛОВО ДНЯ» («5 букв») — push раз в день, только тем, кто сам включил
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно. Нужен push.sql (он уже применён).
--
--  Кнопка «🔔 Напоминать о новом слове» — в конце слова дня (js/games/words.js → pushWordsReminder
--  в js/features/push-pwa.js). Рассылает api/push-check.js (checkWords) после 12:00 по МСК.
--  Как и push_subscribe: знание endpoint (длинный секретный адрес от браузера) — доказательство, что подписка своя.
-- ═══════════════════════════════════════════════════════════════════

alter table public.push_subscriptions add column if not exists want_words boolean not null default false;

-- true — отметка поставлена; null — такой подписки нет (её сначала создаёт push_subscribe)
create or replace function public.push_set_words(p_endpoint text, p_on boolean)
returns boolean language sql security definer set search_path = public as $$
  update public.push_subscriptions set want_words = coalesce(p_on, false), updated_at = now()
  where endpoint = p_endpoint returning true;
$$;

grant execute on function public.push_set_words(text, boolean) to anon, authenticated;
