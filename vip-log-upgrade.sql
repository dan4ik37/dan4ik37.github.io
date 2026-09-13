-- ═══════════════════════════════════════════════════════════════════
--  ДОРАБОТКА ЛОГА ДОНАТОВ — добавляем сами данные доната, не только
--  результат сопоставления. Выполнить после vip-auto.sql, один раз.
-- ═══════════════════════════════════════════════════════════════════
alter table public.vip_donation_log
  add column if not exists donor_username text,
  add column if not exists amount numeric,
  add column if not exists currency text;
