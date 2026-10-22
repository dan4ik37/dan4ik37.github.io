# Резервные копии базы сайта (T-016)

**Зачем.** База (Supabase) — это аккаунты, чат, форум, кристаллы 💎, монеты 🪙, игры. Бесплатный тариф Supabase копий не хранит.
Скрипт `scripts/backup-db.ps1` раз в неделю снимает полную копию на **твой компьютер** в `E:\backups\dan4ik37\ГГГГ-ММ-ДД.sql.gz`
и хранит последние 8 штук (примерно два месяца). Первый раз настраивать минут 20, дальше работает само.

**Важно.**
- Копия содержит почты и защищённые пароли людей. Хранится **только на твоём диске**. Не клади её в GitHub (репозиторий открытый!),
  в общий чат, в облако без пароля. Папка копий лежит вне репозитория, а файл настроек `backup.env` занесён в `.gitignore`.
- В копию входят схемы `public` (все таблицы сайта) и `auth` (аккаунты). **Не входят**: файлы из «Storage» (аватарки, баннеры,
  модели игроков, картинки рекламы), настройки проекта (вход через Google и т. п., адреса возврата) и ключи Vercel.
- Копии на GitHub Actions НЕ делаются именно потому, что репозиторий открытый: журналы и файлы Actions видит любой.

## Шаг 1. Строка подключения к базе (Supabase)

1. Supabase → твой проект → вверху кнопка **Connect** (если её нет: Project Settings → Database → Connection string).
2. Способ (Method) — **Session pooler** (порт 5432; он работает и без IPv6). **Не** «Transaction pooler» (порт 6543) — с ним копия не получится.
3. Скопируй адрес. Он выглядит так: `postgresql://postgres.abcdefghij:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`.
4. Вместо `[YOUR-PASSWORD]` впиши **пароль базы**. Не помнишь — Project Settings → Database → **Reset database password**
   (сайт от этого не ломается: он ходит в базу по ключам API, а не по этому паролю). Спецсимволы в пароле (`@ : / % # ?`) лучше
   не использовать; если они есть, скрипт всё равно поймёт их записанными как `%40 %3A %2F %25 %23 %3F`.

## Шаг 2. Файл настроек (создаёшь ты, один раз)

1. Создай папку `E:\backups\dan4ik37`.
2. В ней создай текстовый файл `backup.env` (в Проводнике включи «Показывать расширения имён файлов», чтобы не получился `backup.env.txt`).
3. Открой в Блокноте и впиши (свою строку из шага 1):

```
DATABASE_URL=postgresql://postgres.abcdefghij:ТВОЙ_ПАРОЛЬ@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
```

Необязательные строки (если не нужны — не пиши): `PG_DUMP=E:\tools\pgsql\pgsql\bin\pg_dump.exe` (путь к pg_dump, шаг 3),
`BACKUP_KEEP=8` (сколько копий хранить), `BACKUP_DIR=E:\backups\dan4ik37` (куда класть), `BACKUP_SCHEMAS=public,auth`.
Сохрани файл («Сохранить как» → кодировка UTF-8). Никому его не показывай: в нём пароль базы.

## Шаг 3. Поставить pg_dump (программа, которая снимает копию)

Нужна версия **не старше** базы; бери самую свежую (17 или новее).

- Вариант проще, без установки: https://www.enterprisedb.com/download-postgresql-binaries → Windows x86-64 → скачай **zip** →
  распакуй в `E:\tools\pgsql`. Нужный файл будет `E:\tools\pgsql\pgsql\bin\pg_dump.exe` — скрипт его найдёт сам.
- Или обычный установщик с https://www.postgresql.org/download/windows/ — на шаге выбора компонентов оставь **только «Command Line Tools»**
  (сервер ставить не нужно). Скрипт найдёт `C:\Program Files\PostgreSQL\<версия>\bin\pg_dump.exe`.

Если скрипт его не нашёл — впиши путь в `backup.env` строкой `PG_DUMP=...`.

## Шаг 4. Первый запуск вручную

Открой PowerShell (Пуск → «PowerShell») и по очереди выполни две команды.

Проверка настроек (к базе не подключается, пароль не показывает):

```
powershell -NoProfile -ExecutionPolicy Bypass -File E:\site\dan4ik37.github.io\scripts\backup-db.ps1 -Check
```

Сама копия (1–3 минуты):

```
powershell -NoProfile -ExecutionPolicy Bypass -File E:\site\dan4ik37.github.io\scripts\backup-db.ps1
```

Должно появиться «Готово: E:\backups\dan4ik37\2026-…sql.gz (… МБ)». Что-то пошло не так — причина в строке «ERROR» и в файле
`E:\backups\dan4ik37\backup.log` (пароль там не пишется). Частые причины: неверный пароль или пользователь (для pooler он `postgres.<код проекта>`),
порт 6543 вместо 5432, `pg_dump` старее базы.

## Шаг 5. Раз в неделю само (Планировщик заданий)

Одна команда в PowerShell (воскресенье 04:00; если компьютер был выключен — запустится при следующем включении):

```
Register-ScheduledTask -TaskName 'dan4ik37 backup' -Description 'Копия базы сайта на этот компьютер' -Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "E:\site\dan4ik37.github.io\scripts\backup-db.ps1"') -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 4:00am) -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1))
```

Проверить, что работает: `Get-ScheduledTask 'dan4ik37 backup' | Get-ScheduledTaskInfo` (LastTaskResult = 0 — всё хорошо) или просто раз в месяц
посмотри папку `E:\backups\dan4ik37` — там должны лежать свежие файлы. Убрать задание: `Unregister-ScheduledTask 'dan4ik37 backup' -Confirm:$false`.
(Путь в команде — к твоей папке сайта; если репозиторий лежит в другом месте, поправь его.)

## Восстановление

Сначала решить, что случилось.

- **Потерялись или испортились отдельные данные** (удалили таблицу, затёрли строки). Не лезь в рабочую базу сам: дай свежую копию
  Claude — он поднимет её во временной базе, достанет нужные строки и аккуратно вернёт.
- **Потерян весь проект.** Новый проект Supabase (тот же регион), и в нём:
  1. Распакуй копию — получится `ГГГГ-ММ-ДД.sql`. Либо 7-Zip («Распаковать здесь»), либо одной командой в PowerShell (подставь свою дату):

```
$f='E:\backups\dan4ik37\2026-10-22.sql.gz'; $i=[IO.File]::OpenRead($f); $o=[IO.File]::Create($f -replace '\.gz$',''); $g=New-Object IO.Compression.GZipStream($i,[IO.Compression.CompressionMode]::Decompress); $g.CopyTo($o); $g.Dispose(); $o.Dispose(); $i.Dispose()
```

  2. Возьми Session pooler-адрес НОВОГО проекта (шаг 1) и выполни (путь к `psql.exe` лежит рядом с `pg_dump.exe`):

```
& "E:\tools\pgsql\pgsql\bin\psql.exe" "postgresql://postgres.НОВЫЙ_КОД:ПАРОЛЬ@aws-0-…pooler.supabase.com:5432/postgres" -c "SET session_replication_role = replica;" -f E:\backups\dan4ik37\2026-10-22.sql
```

  Сообщения «already exists» про схему `auth` — нормально (в новом проекте она уже есть, данные всё равно загрузятся).
  3. Потом нужно перенести настройки: адрес и ключи Supabase в `js/core/config.js` и в переменные Vercel, вход через Google и т. п., адреса
     возврата, файлы Storage. Это работа для Claude — дай ему копию и скажи «восстанавливаем из копии».

**Проверь заранее, что восстановление работает**: раз в квартал (или после смены схемы базы) попроси Claude прогнать копию во
временном проекте. Копия, которую ни разу не пробовали восстановить, может оказаться пустой.

## Если копии перестали идти

`backup.log` в папке копий — последние запуски; `LastTaskResult` в планировщике; частые причины — сменился пароль базы (шаг 1 заново),
переустановлен Windows (шаги 3 и 5 заново), сменился адрес репозитория на диске.
