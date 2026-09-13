-- ═══════════════════════════════════════════════════════════════════
--  ЗАЩИТА №1: автоочистка profiles при удалении аккаунта
--  Смысл роли ("роль привязана к id, не к нику") сама по себе безопасна
--  — см. объяснение в чате. Но если удалить пользователя в Supabase
--  (Auth → Users → Delete), а profiles.id не настроен на ON DELETE
--  CASCADE — строка в profiles останется висеть сиротой: юзера больше
--  нет, а роль (даже 'admin') всё ещё лежит в базе как мусор.
--
--  Сначала проверь, что сейчас: выполни это и посмотри на delete_rule.
-- ═══════════════════════════════════════════════════════════════════
select
  tc.constraint_name, rc.delete_rule
from information_schema.table_constraints tc
join information_schema.referential_constraints rc
  on tc.constraint_name = rc.constraint_name
where tc.table_name = 'profiles' and tc.constraint_type = 'FOREIGN KEY';

-- Если delete_rule НЕ 'CASCADE' (или запрос вообще ничего не вернул —
-- значит FK на auth.users в profiles не настроен) — выполни это:
alter table public.profiles
  drop constraint if exists profiles_id_fkey;
alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade;

-- Теперь удаление аккаунта в Supabase автоматически удалит и его
-- строку в profiles — никаких висящих ролей-сирот.

-- ═══════════════════════════════════════════════════════════════════
--  ЗАЩИТА №2: одноразовая проверка на дубли ников
--  Не блокирует новые регистрации намертво (уникальный nick усложнил бы
--  сценарий смены ника и другие мелочи) — просто разовая проверка,
--  нет ли уже путаницы, чтобы знать, кому написать и попросить сменить.
-- ═══════════════════════════════════════════════════════════════════
select nick, count(*), array_agg(id) as ids
from public.profiles
where nick is not null
group by nick
having count(*) > 1;
