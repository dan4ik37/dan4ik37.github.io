-- ═══════════════════════════════════════════════════════════════════
--  УРОВНИ VIP (Bronze/Silver/Gold) + ВИДИМОСТЬ VIP В ЧАТЕ/ФОРУМЕ
--  Выполнить в Supabase → SQL Editor. Один раз, после vip-auto.sql
--  и vip-log-upgrade.sql (использует их таблицы).
-- ═══════════════════════════════════════════════════════════════════

-- 1. Сумма донатов за всё время — от неё считается уровень VIP
--    (пороги зашиты в js/features/profile.js → VIP_TIERS, менять
--    можно там без новой миграции).
alter table public.profiles
  add column if not exists total_donated numeric not null default 0;

-- Бэкфилл для тех, кто уже VIP — по логу автовыдачи. Тем, кому VIP
-- выдали вручную (не через донат), total_donated останется 0 —
-- это ок, они попадают в базовый уровень VIP, доначислить сумму
-- можно вручную (update profiles set total_donated = ... where ...).
update public.profiles p
set total_donated = coalesce((
  select sum(l.amount) from public.vip_donation_log l
  where l.profile_id = p.id and l.matched = true
), 0)
where p.is_vip = true;

-- 2. Снимок VIP-статуса на момент отправки сообщения в чат — по той
--    же логике, что уже есть для role (см. messages.role): чат живёт
--    через realtime-поток, дешевле хранить снимок, чем джойнить
--    profiles на каждое сообщение.
alter table public.messages
  add column if not exists vip_tier text;

-- 3. Свой акцентный цвет интерфейса — виден только самому VIP,
--    ни на кого больше не влияет (личная тема, не публичная).
alter table public.profiles
  add column if not exists theme_accent text;
