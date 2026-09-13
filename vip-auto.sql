-- ═══════════════════════════════════════════════════════════════════
--  АВТО-VIP ПО ДОНАТУ
--  100₽ = 1 месяц VIP, дробная часть сгорает (250₽ = 2 месяца, не 2.5).
--  Выполнить целиком в Supabase → SQL Editor. Один раз.
-- ═══════════════════════════════════════════════════════════════════

-- Лог обработанных донатов — без него при каждом обновлении страницы
-- донатов (fetch /api/donations возвращает последние 20 донатов заново)
-- VIP выдавался бы повторно на один и тот же донат.
create table if not exists public.vip_donation_log (
  donation_id bigint primary key,
  profile_id uuid references public.profiles(id),
  matched boolean not null,
  months_granted int,
  processed_at timestamptz default now()
);

alter table public.vip_donation_log enable row level security;

drop policy if exists "Только админ видит лог VIP-донатов" on public.vip_donation_log;
create policy "Только админ видит лог VIP-донатов"
  on public.vip_donation_log for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "Только админ пишет в лог VIP-донатов" on public.vip_donation_log;
create policy "Только админ пишет в лог VIP-донатов"
  on public.vip_donation_log for insert
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ═══════════════════════════════════════════════════════════════════
--  ВАЖНОЕ ОГРАНИЧЕНИЕ (честно, без прикрас)
--  Автовыдача работает ТОЛЬКО пока у админа открыт сайт (залогинен как
--  admin) — либо в момент самого доната (живой алерт Centrifugo), либо
--  при следующем заходе на "💝 Донат" (там подтягиваются последние 20
--  донатов и все непроверенные сверяются с никами). Без постоянно
--  работающего сервера (у Vercel serverless функции не живут между
--  запросами) сделать по-другому нельзя — см. пояснение уже было про
--  живые алерты в donation-alerts.js, здесь та же причина.
--
--  Сопоставление — только по нику (без учёта регистра) и только для
--  донатов в рублях (donation.currency === 'RUB'). Донат в другой
--  валюте, опечатка в нике при донате, донат под другим ником — ничего
--  не сломается, просто останется необработанным, и это НОРМАЛЬНО:
--  для таких случаев остаётся ручная выдача VIP в "⚙️ Настройки сайта"
--  → "👥 Роли" (там же можно проверить лог: см. запрос ниже).
-- ═══════════════════════════════════════════════════════════════════

-- Посмотреть на необработанные/неопознанные донаты (не нашли ник):
select donation_id, processed_at from public.vip_donation_log where matched = false order by processed_at desc;

-- Посмотреть, кому и сколько уже выдано автоматически:
select l.processed_at, p.nick, l.months_granted
from public.vip_donation_log l
join public.profiles p on p.id = l.profile_id
where l.matched = true
order by l.processed_at desc;
