-- ═══════════════════════════════════════════════════════════════════
--  ФИКС: аккаунт без строки в profiles (заведён до триггера регистрации)
--  Подставь свой email и желаемый ник, выполни один раз.
--  ON CONFLICT — на случай, если строка ЧАСТИЧНО есть (например только
--  что-то одно из nick/role) — не упадёт в обоих случаях: и если строки
--  вообще нет, и если она уже есть.
-- ═══════════════════════════════════════════════════════════════════
insert into public.profiles (id, nick, role)
select id, 'ТвойНик', 'admin'
from auth.users
where email = 'твой@email.ру'
on conflict (id) do update
set nick = excluded.nick,
    role = excluded.role;

-- Проверка результата:
select u.email, p.nick, p.role
from auth.users u
join public.profiles p on p.id = u.id
where u.email = 'твой@email.ру';
