<#
.SYNOPSIS
  Резервная копия базы Supabase на ЭТОТ компьютер: pg_dump -> E:\backups\dan4ik37\ГГГГ-ММ-ДД.sql.gz (хранится последние N штук).

.DESCRIPTION
  Подробная инструкция для владельца — docs/BACKUPS.md (как получить строку подключения, поставить pg_dump, включить расписание,
  как восстановить). Коротко:
    1) в файле настроек (по умолчанию E:\backups\dan4ik37\backup.env, создаёт ВЛАДЕЛЕЦ, в репозиторий не попадает) лежит строка
       DATABASE_URL=postgresql://...  (Supabase -> Connect -> Session pooler);
    2) скрипт находит pg_dump, снимает копию схем public и auth в простой SQL, проверяет, что дамп дописан до конца, сжимает в .sql.gz,
       проверяет архив и стирает самые старые копии сверх лимита;
    3) пароль нигде не печатается и не пишется в журнал; передаётся pg_dump только через переменные окружения его процесса.
  Репозиторий открытый, поэтому копии НИКОГДА не выкладываются на GitHub (ни файлами, ни артефактами Actions) — только этот компьютер.
  Работает в Windows PowerShell 5.1 (его запускает Планировщик заданий) и в PowerShell 7.

.PARAMETER EnvFile   Файл настроек (KEY=VALUE). По умолчанию E:\backups\dan4ik37\backup.env.
.PARAMETER OutDir    Куда класть копии. По умолчанию BACKUP_DIR из файла настроек или папка файла настроек.
.PARAMETER Keep      Сколько последних копий хранить (по умолчанию BACKUP_KEEP из файла или 8).
.PARAMETER PgDump    Путь к pg_dump (иначе PG_DUMP из файла, потом PATH, потом C:\Program Files\PostgreSQL\*\bin).
.PARAMETER Check     Только проверить настройки и найти pg_dump (к базе НЕ подключается, ничего не пишет).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File E:\site\dan4ik37.github.io\scripts\backup-db.ps1
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File E:\site\dan4ik37.github.io\scripts\backup-db.ps1 -Check

Коды выхода: 0 — готово; 2 — нет/неверный файл настроек; 3 — не найден pg_dump; 4 — pg_dump не справился; 5 — копия не прошла проверку.
#>
[CmdletBinding()]
param(
  [string]$EnvFile = 'E:\backups\dan4ik37\backup.env',
  [string]$OutDir = '',
  [int]$Keep = 0,
  [string]$PgDump = '',
  [switch]$Check
)

$ErrorActionPreference = 'Stop'
$script:LogFile = $null

function Write-Log([string]$msg, [string]$level = 'INFO') {
  $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $level, $msg
  if ($level -eq 'ERROR') { Write-Host $line -ForegroundColor Red } elseif ($level -eq 'WARN') { Write-Host $line -ForegroundColor Yellow } else { Write-Host $line }
  if ($script:LogFile) { try { Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8 } catch { } }
}
function Stop-Backup([int]$code, [string]$msg) {
  Write-Log $msg 'ERROR'
  exit $code
}

# --- 1. Файл настроек ---
function Read-EnvFile([string]$path) {
  $r = @{}
  foreach ($raw in [IO.File]::ReadAllLines($path, [Text.Encoding]::UTF8)) {
    $line = $raw.Trim().TrimStart([char]0xFEFF)
    if (-not $line -or $line.StartsWith('#')) { continue }
    $i = $line.IndexOf('=')
    if ($i -lt 1) { continue }
    $k = $line.Substring(0, $i).Trim()
    $v = $line.Substring($i + 1).Trim()
    if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) { $v = $v.Substring(1, $v.Length - 2) }
    $r[$k] = $v
  }
  return $r
}

# postgresql://польз:пароль@хост:порт/база?параметры -> части (пароль может быть записан с %-кодами)
function Parse-DbUrl([string]$url) {
  $m = [regex]::Match($url, '^postgres(?:ql)?://([^:/?#@]+)(?::(.*))?@([^@/:?#]+)(?::(\d+))?/([^?#]*)')
  if (-not $m.Success) { return $null }
  $pw = ''
  if ($m.Groups[2].Success) { $pw = [Uri]::UnescapeDataString($m.Groups[2].Value) }
  $port = '5432'
  if ($m.Groups[4].Success) { $port = $m.Groups[4].Value }
  return @{
    User = [Uri]::UnescapeDataString($m.Groups[1].Value)
    Password = $pw
    Host = $m.Groups[3].Value
    Port = $port
    Db = [Uri]::UnescapeDataString($m.Groups[5].Value)
  }
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
  Write-Host ("Нет файла настроек: {0}" -f $EnvFile) -ForegroundColor Red
  Write-Host 'Создай его по инструкции docs/BACKUPS.md (шаг 2): в нём одна строка DATABASE_URL=... из Supabase. Файл никуда не загружай.' -ForegroundColor Red
  exit 2
}
$cfg = Read-EnvFile $EnvFile
$envDir = Split-Path -Parent (Resolve-Path -LiteralPath $EnvFile).Path
if (-not $OutDir) { $OutDir = if ($cfg['BACKUP_DIR']) { $cfg['BACKUP_DIR'] } else { $envDir } }
if ($Keep -le 0) { $Keep = 8; if ($cfg['BACKUP_KEEP'] -match '^\d+$' -and [int]$cfg['BACKUP_KEEP'] -ge 1) { $Keep = [int]$cfg['BACKUP_KEEP'] } }
$schemas = @('public', 'auth')
if ($cfg['BACKUP_SCHEMAS']) {
  $schemas = @($cfg['BACKUP_SCHEMAS'].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*$' })
  if ($schemas.Count -eq 0) { Write-Host 'BACKUP_SCHEMAS в файле настроек пустой или неверный (пример: public,auth)' -ForegroundColor Red; exit 2 }
}
if (-not $Check) {
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $script:LogFile = Join-Path $OutDir 'backup.log'
}

$db = $null
if ($cfg['DATABASE_URL']) { $db = Parse-DbUrl $cfg['DATABASE_URL'] }
if (-not $db) { Stop-Backup 2 'В файле настроек нет верной строки DATABASE_URL=postgresql://польз:пароль@хост:5432/postgres (Supabase -> Connect -> Session pooler).' }
if ($cfg['DATABASE_URL'] -match '\[YOUR-PASSWORD\]|ВАШ_ПАРОЛЬ|ПАРОЛЬ_БАЗЫ|<password>|<пароль>') { Stop-Backup 2 'В DATABASE_URL вместо пароля всё ещё заглушка: впиши пароль базы (docs/BACKUPS.md, шаг 1).' }
if (-not $db.Password) { Stop-Backup 2 'В DATABASE_URL нет пароля (postgresql://польз:ПАРОЛЬ@хост...).' }
if ($db.Port -eq '6543') { Stop-Backup 2 'Порт 6543 — это «Transaction pooler», с pg_dump он не работает. Возьми «Session pooler» (порт 5432): Supabase -> Connect -> Session pooler.' }
if (-not $db.Db) { $db.Db = 'postgres' }

# --- 2. pg_dump ---
function Find-PgDump {
  $cands = New-Object System.Collections.ArrayList
  if ($PgDump) { [void]$cands.Add($PgDump) }
  if ($cfg['PG_DUMP']) { [void]$cands.Add($cfg['PG_DUMP']) }
  $cmd = Get-Command pg_dump -ErrorAction SilentlyContinue
  if ($cmd) { [void]$cands.Add($cmd.Source) }
  foreach ($pf in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'E:\tools', 'C:\tools')) {
    # нет такого диска (например, E: на другом компьютере) — Join-Path в Windows PowerShell 5.1 падает, поэтому сначала Test-Path
    if (-not $pf -or -not (Test-Path -LiteralPath $pf)) { continue }
    foreach ($base in @((Join-Path $pf 'PostgreSQL'), (Join-Path $pf 'pgsql'))) {
      if (Test-Path -LiteralPath $base) {
        Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue | Sort-Object { $_.Name } -Descending | ForEach-Object { [void]$cands.Add((Join-Path $_.FullName 'bin\pg_dump.exe')) }
        [void]$cands.Add((Join-Path $base 'bin\pg_dump.exe'))
      }
    }
  }
  foreach ($c in $cands) { if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { return (Resolve-Path -LiteralPath $c).Path } }
  return $null
}
$pgdump = Find-PgDump
if (-not $pgdump) { Stop-Backup 3 'Не найден pg_dump. Поставь его (docs/BACKUPS.md, шаг 3) или впиши путь в файл настроек: PG_DUMP=C:\Program Files\PostgreSQL\17\bin\pg_dump.exe' }

if ($Check) {
  Write-Host ('Файл настроек: {0}' -f $EnvFile)
  Write-Host ('База: {0}:{1} / {2}, пользователь {3}, пароль задан ({4} знаков, не показываю)' -f $db.Host, $db.Port, $db.Db, $db.User, $db.Password.Length)
  Write-Host ('pg_dump: {0}' -f $pgdump)
  Write-Host ('Схемы: {0}; папка копий: {1}; хранить: {2}' -f ($schemas -join ', '), $OutDir, $Keep)
  Write-Host 'Настройки в порядке (к базе не подключался).' -ForegroundColor Green
  exit 0
}

# --- 3. Запуск pg_dump (пароль — только в окружении его процесса) ---
$started = Get-Date
$stamp = $started.ToString('yyyy-MM-dd')
$final = Join-Path $OutDir ($stamp + '.sql.gz')
$tmpSql = Join-Path $OutDir ($stamp + '.sql.tmp')
$tmpGz = Join-Path $OutDir ($stamp + '.sql.gz.tmp')
$marker = 'PostgreSQL database dump complete'
Write-Log ('Начинаю копию: {0}:{1}/{2}, схемы {3}, pg_dump {4}' -f $db.Host, $db.Port, $db.Db, ($schemas -join '+'), $pgdump)

function Quote-Arg([string]$a) { if ($a -match '[\s"]') { return '"' + $a.Replace('"', '\"') + '"' } else { return $a } }
function Tail-Text([string]$path, [int]$bytes) {
  $fs = [IO.File]::OpenRead($path)
  try { $n = [Math]::Min($bytes, $fs.Length); [void]$fs.Seek(-$n, [IO.SeekOrigin]::End); $buf = New-Object byte[] $n; [void]$fs.Read($buf, 0, $n); return [Text.Encoding]::UTF8.GetString($buf) }
  finally { $fs.Dispose() }
}
function Tail-Gz([string]$path, [int]$bytes) {
  $fs = [IO.File]::OpenRead($path); $gz = New-Object IO.Compression.GZipStream($fs, [IO.Compression.CompressionMode]::Decompress)
  try {
    $buf = New-Object byte[] 65536; $keep = New-Object byte[] 0; $total = 0L
    while (($n = $gz.Read($buf, 0, $buf.Length)) -gt 0) {
      $total += $n
      $all = New-Object byte[] ($keep.Length + $n); [Array]::Copy($keep, 0, $all, 0, $keep.Length); [Array]::Copy($buf, 0, $all, $keep.Length, $n)
      if ($all.Length -gt $bytes) { $keep = New-Object byte[] $bytes; [Array]::Copy($all, $all.Length - $bytes, $keep, 0, $bytes) } else { $keep = $all }
    }
    return @{ Total = $total; Tail = [Text.Encoding]::UTF8.GetString($keep) }
  } finally { $gz.Dispose(); $fs.Dispose() }
}

try {
  foreach ($t in @($tmpSql, $tmpGz)) { if (Test-Path -LiteralPath $t) { Remove-Item -LiteralPath $t -Force } }
  # права (GRANT/REVOKE) в дамп входят: без них после восстановления закрытые таблицы стали бы открытыми
  $ddArgs = New-Object System.Collections.ArrayList
  foreach ($a in @('--format=plain', '--encoding=UTF8', '--no-owner', ('--file=' + $tmpSql))) { [void]$ddArgs.Add($a) }
  foreach ($s in $schemas) { [void]$ddArgs.Add('--schema=' + $s) }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $pgdump
  $psi.Arguments = ($ddArgs | ForEach-Object { Quote-Arg $_ }) -join ' '
  $psi.UseShellExecute = $false
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardOutput = $true
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['PGHOST'] = $db.Host
  $psi.EnvironmentVariables['PGPORT'] = $db.Port
  $psi.EnvironmentVariables['PGUSER'] = $db.User
  $psi.EnvironmentVariables['PGPASSWORD'] = $db.Password
  $psi.EnvironmentVariables['PGDATABASE'] = $db.Db
  $psi.EnvironmentVariables['PGSSLMODE'] = 'require'
  $psi.EnvironmentVariables['PGCONNECT_TIMEOUT'] = '30'
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  [void]$proc.Start()
  $errTask = $proc.StandardError.ReadToEndAsync()
  $outTask = $proc.StandardOutput.ReadToEndAsync()
  $proc.WaitForExit()
  $err = ($errTask.Result + '').Trim()
  [void]$outTask.Result
  if ($proc.ExitCode -ne 0) {
    $hint = ''
    if ($err -match 'could not translate host name|Network is unreachable|No route to host|timeout expired') { $hint = ' Похоже на сеть/IPv6: возьми «Session pooler» (адрес aws-0-….pooler.supabase.com), а не прямой db.….supabase.co.' }
    elseif ($err -match 'password authentication failed|SCRAM') { $hint = ' Неверный пароль базы или пользователь (для pooler пользователь выглядит как postgres.<код проекта>).' }
    elseif ($err -match 'server version|aborting because of server version mismatch') { $hint = ' pg_dump старее сервера: поставь свежую версию PostgreSQL tools (docs/BACKUPS.md, шаг 3).' }
    Stop-Backup 4 ('pg_dump завершился с кодом {0}: {1}{2}' -f $proc.ExitCode, ($err -replace '\s+', ' '), $hint)
  }
  if ($err) { Write-Log ('pg_dump сообщил: ' + ($err -replace '\s+', ' ')) 'WARN' }
  if (-not (Test-Path -LiteralPath $tmpSql) -or (Get-Item -LiteralPath $tmpSql).Length -lt 1024) { Stop-Backup 5 'Дамп пустой или слишком маленький — копию не сохраняю.' }
  if ((Tail-Text $tmpSql 4096) -notmatch [regex]::Escape($marker)) { Stop-Backup 5 'Дамп оборван: в конце нет строки «PostgreSQL database dump complete» — копию не сохраняю.' }
  $rawSize = (Get-Item -LiteralPath $tmpSql).Length

  # --- 4. Сжать и проверить архив ---
  $in = [IO.File]::OpenRead($tmpSql); $out = [IO.File]::Create($tmpGz)
  try {
    $gz = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionLevel]::Optimal)
    try { $in.CopyTo($gz) } finally { $gz.Dispose() }
  } finally { $in.Dispose(); $out.Dispose() }
  $chk = Tail-Gz $tmpGz 4096
  if ($chk.Total -ne $rawSize -or $chk.Tail -notmatch [regex]::Escape($marker)) { Stop-Backup 5 'Архив не прошёл проверку (размер или конец файла не совпали) — старые копии не тронуты.' }
  Move-Item -LiteralPath $tmpGz -Destination $final -Force
  $gzSize = (Get-Item -LiteralPath $final).Length

  # --- 5. Хранить последние N ---
  $all = @(Get-ChildItem -LiteralPath $OutDir -File | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}\.sql\.gz$' } | Sort-Object Name -Descending)
  $removed = 0
  if ($all.Count -gt $Keep) {
    foreach ($f in $all | Select-Object -Skip $Keep) { Remove-Item -LiteralPath $f.FullName -Force; $removed++ }
  }
  $secs = [int]((Get-Date) - $started).TotalSeconds
  Write-Log ('Готово: {0} ({1:N1} МБ, дамп {2:N1} МБ), {3} с. Копий в папке: {4}, стёрто старых: {5}.' -f $final, ($gzSize / 1MB), ($rawSize / 1MB), $secs, [Math]::Min($all.Count, $Keep), $removed)
  # журнал не растёт бесконечно
  try {
    $lines = Get-Content -LiteralPath $script:LogFile -Encoding UTF8
    if ($lines.Count -gt 400) { $lines | Select-Object -Last 300 | Set-Content -LiteralPath $script:LogFile -Encoding UTF8 }
  } catch { }
  exit 0
} catch {
  Write-Log ('Сбой: ' + $_.Exception.Message) 'ERROR'
  exit 4
} finally {
  foreach ($t in @($tmpSql, $tmpGz)) { try { if (Test-Path -LiteralPath $t) { Remove-Item -LiteralPath $t -Force } } catch { } }
}
