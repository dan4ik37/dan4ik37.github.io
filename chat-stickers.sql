-- ═══════════════════════════════════════════════════════════════════
--  СТИКЕРЫ В ЧАТЕ (VIP/стафф-эксклюзив)
--  Выполнить в Supabase → SQL Editor. Один раз.
-- ═══════════════════════════════════════════════════════════════════

alter table public.messages
  add column if not exists is_sticker boolean not null default false;
