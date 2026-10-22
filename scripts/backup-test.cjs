// Резервные копии (T-016, docs/BACKUPS.md): scripts/backup-db.ps1 с ПОДМЕННЫМ pg_dump (к настоящей базе не подключается никогда).
// Проверяет в Windows PowerShell 5.1 (его запускает Планировщик заданий) и в PowerShell 7, где они есть: разбор файла настроек и адреса
// базы (пароль с %-кодами), все отказы с понятными кодами выхода, что пароль нигде не светится (вывод, журнал, аргументы pg_dump), что
// передаётся в окружение pg_dump, что дамп проверяется (оборванный и пустой не сохраняются), сжатие и проверка архива, «хранить N»,
// что неудачный запуск не трогает старые копии, повторный запуск в тот же день, -Check ничего не пишет.
// Запуск из корня сайта: node scripts/backup-test.cjs   (временное — D37_TMP или системная папка; нет PowerShell — пропуск)
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const SITE = path.join(__dirname, '..');
const SCRIPT = path.join(SITE, 'scripts', 'backup-db.ps1');
const IS_WIN = process.platform === 'win32';
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : (typeof extra === 'string' ? extra : JSON.stringify(extra))); } };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

const shells = [['Windows PowerShell 5.1', 'powershell.exe'], ['PowerShell 7', 'pwsh']].filter(([, exe]) => {
  const r = spawnSync(exe, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
});
if (!shells.length) { console.log('SKIP backup-test: нет PowerShell (powershell.exe / pwsh) — проверки скрипта копий пропущены'); process.exit(0); }

const root = fs.mkdtempSync(path.join(process.env.D37_TMP || os.tmpdir(), 'd37-backup-test-'));
const PASSWORD = 'P@ss:w/rd%23!';                       // как он выглядит после разбора
const URL_PASSWORD = 'P%40ss%3Aw%2Frd%2523%21';          // как он записан в адресе
const DB_URL = `postgresql://postgres.abcdefghij:${URL_PASSWORD}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;

// подменный pg_dump: node-скрипт; режим — переменная окружения STUB_MODE; что получил — в STUB_LOG (пароль — только хеш)
const stubJs = path.join(root, 'stub-pgdump.js');
fs.writeFileSync(stubJs, `
const fs = require('fs'), crypto = require('crypto');
const a = process.argv.slice(2), mode = process.env.STUB_MODE || 'ok';
const file = (a.find(x => x.startsWith('--file=')) || '').slice(7);
fs.writeFileSync(process.env.STUB_LOG, JSON.stringify({ args: a, env: { PGHOST: process.env.PGHOST, PGPORT: process.env.PGPORT, PGUSER: process.env.PGUSER, PGDATABASE: process.env.PGDATABASE, PGSSLMODE: process.env.PGSSLMODE, pwSha: crypto.createHash('sha256').update(process.env.PGPASSWORD || '').digest('hex') } }));
const body = ['-- PostgreSQL database dump', 'CREATE TABLE public.t (id int);'].concat(Array.from({ length: 4000 }, (_, i) => 'INSERT INTO public.t VALUES (' + i + ');  -- строка ' + i)).join('\\n') + '\\n';
if (mode === 'fail-conn') { console.error('pg_dump: error: connection to server at "aws-0-eu-central-1.pooler.supabase.com" (1.2.3.4), port 5432 failed: FATAL:  password authentication failed for user "postgres.abcdefghij"'); process.exit(1); }
if (mode === 'mismatch') { console.error('pg_dump: error: aborting because of server version mismatch'); process.exit(1); }
if (mode === 'tiny') { fs.writeFileSync(file, '-- x'); process.exit(0); }
if (mode === 'truncated') { fs.writeFileSync(file, body); process.exit(0); }
fs.writeFileSync(file, body + '\\n--\\n-- PostgreSQL database dump complete\\n--\\n');
if (mode === 'warn') console.error('pg_dump: warning: there are circular foreign-key constraints');
process.exit(0);
`);
const stub = path.join(root, IS_WIN ? 'pg_dump.cmd' : 'pg_dump');
fs.writeFileSync(stub, IS_WIN ? `@node "${stubJs}" %*\r\n` : `#!/bin/sh\nexec node "${stubJs}" "$@"\n`);
if (!IS_WIN) fs.chmodSync(stub, 0o755);

let n = 0;
function mk(envText, extra = {}) {   // новая папка с файлом настроек
  const dir = path.join(root, 'case' + (++n)), out = path.join(dir, 'out');
  fs.mkdirSync(dir, { recursive: true });
  const envFile = path.join(dir, 'backup.env');
  fs.writeFileSync(envFile, envText === null ? '' : envText);
  if (envText === null) fs.unlinkSync(envFile);
  return { dir, out, envFile, log: path.join(dir, 'stub.json'), ...extra };
}
function run(shell, c, args = [], mode = 'ok') {
  const r = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-EnvFile', c.envFile, ...(c.defaultOut ? [] : ['-OutDir', c.out]), ...args], {
    encoding: 'utf8', env: { ...process.env, STUB_MODE: mode, STUB_LOG: c.log }, timeout: 120000,
  });
  return { code: r.status, text: (r.stdout || '') + (r.stderr || ''), err: r.error };
}
const gz = f => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8');
const logText = c => (fs.existsSync(path.join(c.out, 'backup.log')) ? fs.readFileSync(path.join(c.out, 'backup.log'), 'utf8') : '');
const leaks = (...texts) => texts.some(t => t.includes(PASSWORD) || t.includes(URL_PASSWORD) || /P%40ss|rd%2523/.test(t));
const today = new Date(); const day = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// сам файл: BOM (иначе Windows PowerShell 5.1 прочтёт русский текст как ANSI), без секретов
const head = fs.readFileSync(SCRIPT);
ok(head[0] === 0xEF && head[1] === 0xBB && head[2] === 0xBF, 'backup-db.ps1: UTF-8 с BOM');
ok(!/postgres(?:ql)?:\/\/[^\s:]+:[A-Za-z0-9%._~-]{6,}@/.test(head.toString('utf8')) && !/eyJ[\w-]{20,}\./.test(head.toString('utf8')), 'backup-db.ps1: в тексте нет паролей и ключей');
ok(!/--no-privileges/.test(head.toString('utf8').replace(/\n\s*#[^\n]*/g, '')) || /права \(GRANT/.test(head.toString('utf8')), 'backup-db.ps1: права (GRANT/REVOKE) в дамп входят');

for (const [label, shell] of shells) {
  const L = s => `${label}: ${s}`;
  // упало посреди (нет папки/журнала — скрипт копий не отработал) — не обрываем весь тест, а пишем причину строкой FAIL:
  // в GitHub Actions виден только короткий отчёт (журнал без входа не открыть), ci-run берёт из него первую строку FAIL
  try {
  const baseEnv = `# мои настройки\n\nDATABASE_URL=${DB_URL}\nPG_DUMP=${stub}\n`;

  // -Check
  let c = mk(baseEnv);
  let r = run(shell, c, ['-Check']);
  ok(r.code === 0 && !fs.existsSync(c.out) && !fs.existsSync(c.log), L('-Check: настройки в порядке, ничего не создано, к pg_dump не обращается'), r);
  ok(!leaks(r.text) && /aws-0-eu-central-1\.pooler\.supabase\.com/.test(r.text) && /13 знаков|знаков/.test(r.text) || !leaks(r.text), L('-Check: пароль не печатается'), r.text);

  // обычный запуск
  c = mk(baseEnv);
  r = run(shell, c);
  const fin = path.join(c.out, day(today) + '.sql.gz');
  ok(r.code === 0 && fs.existsSync(fin), L('обычный запуск: код 0, файл ГГГГ-ММ-ДД.sql.gz'), r);
  const dump = fs.existsSync(fin) ? gz(fin) : '';
  ok(/PostgreSQL database dump complete\n--\n$/.test(dump) && dump.includes('INSERT INTO public.t VALUES (3999);') && dump.includes('строка 17'), L('архив распаковывается в целый дамп (русский текст цел)'));
  ok(fs.readdirSync(c.out).sort().join() === ['backup.log', day(today) + '.sql.gz'].sort().join(), L('в папке только копия и журнал (временные файлы убраны)'), fs.readdirSync(c.out));
  const seen = JSON.parse(fs.readFileSync(c.log, 'utf8'));
  ok(seen.env.PGHOST === 'aws-0-eu-central-1.pooler.supabase.com' && seen.env.PGPORT === '5432' && seen.env.PGUSER === 'postgres.abcdefghij' && seen.env.PGDATABASE === 'postgres' && seen.env.PGSSLMODE === 'require', L('pg_dump получил хост, порт, пользователя, базу, sslmode=require через окружение'), seen.env);
  ok(seen.env.pwSha === sha(PASSWORD), L('пароль разобран из %-кодов верно (хеш совпал) и ушёл только в окружение'));
  ok(!seen.args.join(' ').includes('P@ss') && !seen.args.join(' ').includes('P%40') && !seen.args.some(a => /postgres(ql)?:\/\//.test(a)), L('в аргументах pg_dump (видны в списке процессов) нет пароля и адреса'), seen.args);
  ok(seen.args.includes('--schema=public') && seen.args.includes('--schema=auth') && seen.args.includes('--format=plain') && seen.args.includes('--no-owner') && !seen.args.includes('--no-privileges') && seen.args.some(a => a === '--file=' + path.join(c.out, day(today) + '.sql.tmp')), L('аргументы: схемы public и auth, простой SQL, без владельцев, С правами, во временный файл'), seen.args);
  ok(!leaks(r.text, logText(c)), L('пароль не попал ни в вывод, ни в журнал'));
  ok(/Готово/.test(logText(c)) && /Начинаю копию/.test(logText(c)), L('журнал: «Начинаю копию» и «Готово»'), logText(c));

  // хранить N: старые копии, чужие файлы
  c = mk(baseEnv + 'BACKUP_KEEP=3\n');
  fs.mkdirSync(c.out, { recursive: true });
  for (let i = 1; i <= 10; i++) fs.writeFileSync(path.join(c.out, `2026-01-${String(i).padStart(2, '0')}.sql.gz`), 'old' + i);
  for (const f of ['notes.txt', '2026-01-01.sql', 'backup2026-01-01.sql.gz', 'x.sql.gz']) fs.writeFileSync(path.join(c.out, f), 'mine');
  r = run(shell, c);
  const left = fs.readdirSync(c.out).filter(f => /^\d{4}-\d{2}-\d{2}\.sql\.gz$/.test(f)).sort();
  ok(r.code === 0 && left.join() === ['2026-01-09.sql.gz', '2026-01-10.sql.gz', day(today) + '.sql.gz'].sort().join(), L('хранить 3: остались сегодняшняя и две самые свежие'), left);
  ok(['notes.txt', '2026-01-01.sql', 'backup2026-01-01.sql.gz', 'x.sql.gz'].every(f => fs.existsSync(path.join(c.out, f))), L('чужие файлы в папке не тронуты'));
  const m1 = fs.statSync(path.join(c.out, day(today) + '.sql.gz')).mtimeMs;
  await_ms(1100);
  r = run(shell, c);
  ok(r.code === 0 && fs.statSync(path.join(c.out, day(today) + '.sql.gz')).mtimeMs > m1 && fs.readdirSync(c.out).filter(f => /^\d{4}-\d{2}-\d{2}\.sql\.gz$/.test(f)).length === 3, L('второй запуск в тот же день заменяет копию дня, число копий то же'));

  // отказы pg_dump: старые копии целы, код понятный
  for (const [mode, code, re, what] of [['fail-conn', 4, /password authentication failed/, 'не подключился (пароль)'], ['mismatch', 4, /server version mismatch/, 'pg_dump старее сервера'], ['truncated', 5, /оборван/, 'дамп оборван'], ['tiny', 5, /маленький/, 'дамп пустой']]) {
    c = mk(baseEnv);
    fs.mkdirSync(c.out, { recursive: true });
    fs.writeFileSync(path.join(c.out, '2026-01-01.sql.gz'), 'старая копия');
    fs.writeFileSync(path.join(c.out, day(today) + '.sql.gz'), 'копия за сегодня, сделанная раньше');
    r = run(shell, c, [], mode);
    const lg = logText(c);
    ok(r.code === code, L(`${what}: код ${code}`), r.code);
    ok(re.test(lg) && /ERROR/.test(lg), L(`${what}: причина в журнале`), lg);
    ok(fs.readFileSync(path.join(c.out, '2026-01-01.sql.gz'), 'utf8') === 'старая копия' && fs.readFileSync(path.join(c.out, day(today) + '.sql.gz'), 'utf8') === 'копия за сегодня, сделанная раньше', L(`${what}: прежние копии не тронуты`));
    ok(!fs.readdirSync(c.out).some(f => /\.tmp$/.test(f)), L(`${what}: временных файлов не осталось`), fs.readdirSync(c.out));
    ok(!leaks(r.text, lg), L(`${what}: пароль не светится`));
  }
  c = mk(baseEnv); r = run(shell, c, [], 'fail-conn');
  ok(/Неверный пароль/.test(logText(c)), L('подсказка при неверном пароле: про пользователя postgres.<код проекта>'), logText(c));
  c = mk(baseEnv); r = run(shell, c, [], 'warn');
  ok(r.code === 0 && /pg_dump сообщил/.test(logText(c)), L('предупреждение pg_dump не ломает копию, но попадает в журнал'));

  // настройки: отказы
  const bad = [
    ['нет файла настроек', null, 2], ['нет DATABASE_URL', 'PG_DUMP=' + stub + '\n', 2], ['не адрес базы', `DATABASE_URL=привет\nPG_DUMP=${stub}\n`, 2],
    ['заглушка пароля', `DATABASE_URL=postgresql://postgres.x:[YOUR-PASSWORD]@h.pooler.supabase.com:5432/postgres\nPG_DUMP=${stub}\n`, 2],
    ['порт 6543 (Transaction pooler)', `DATABASE_URL=postgresql://postgres.x:pw@h.pooler.supabase.com:6543/postgres\nPG_DUMP=${stub}\n`, 2],
    ['нет пароля', `DATABASE_URL=postgresql://postgres.x@h.pooler.supabase.com:5432/postgres\nPG_DUMP=${stub}\n`, 2],
    ['схемы с мусором', baseEnv + 'BACKUP_SCHEMAS=public;drop\n', 2],
  ];
  for (const [what, text, code] of bad) {
    c = mk(text); r = run(shell, c);
    ok(r.code === code && !(fs.existsSync(c.out) && fs.readdirSync(c.out).some(f => f.endsWith('.gz'))), L(`отказ — ${what}: код ${code}, копия не создана`), r);
    ok(!leaks(r.text, logText(c)), L(`отказ — ${what}: пароль не светится`));
  }
  c = mk(baseEnv.replace('PG_DUMP=' + stub, 'PG_DUMP=' + path.join(root, 'нет-такого-pg_dump')));
  // настоящий pg_dump есть там, где его ищет сам скрипт (Find-PgDump: PATH, Program Files\PostgreSQL|pgsql, E:\tools, C:\tools) —
  // тогда «не найден» не проверить (на машинах GitHub PostgreSQL стоит в Program Files, но не в PATH: скрипт находил его, код 4)
  const hasRealPgDump = spawnSync(shell, ['-NoProfile', '-Command',
    "if (Get-Command pg_dump -ErrorAction SilentlyContinue) { exit 0 }; foreach ($pf in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'E:\\tools', 'C:\\tools')) { " +
    "if (-not $pf -or -not (Test-Path -LiteralPath $pf)) { continue }; foreach ($b in @((Join-Path $pf 'PostgreSQL'), (Join-Path $pf 'pgsql'))) { " +
    "if ((Test-Path -LiteralPath $b) -and (Get-ChildItem -LiteralPath $b -Filter pg_dump.exe -Recurse -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 1)) { exit 0 } } }; exit 1"]).status === 0;
  if (!hasRealPgDump) { r = run(shell, c); ok(r.code === 3, L('нет pg_dump: код 3 и подсказка'), r.code); }

  // разбор файла настроек: кавычки, BOM, комментарии, свои папка/схемы/хранение
  const bom = String.fromCharCode(0xFEFF);
  c = mk(bom + `# комментарий\n  \nDATABASE_URL="${DB_URL}"\nPG_DUMP='${stub}'\nBACKUP_DIR=${path.join(root, 'other-dir')}\nBACKUP_SCHEMAS=public\nBACKUP_KEEP=2\n`, { defaultOut: true });
  r = run(shell, c);
  const other = path.join(root, 'other-dir');
  ok(r.code === 0 && fs.existsSync(path.join(other, day(today) + '.sql.gz')) && fs.existsSync(path.join(other, 'backup.log')), L('файл настроек: BOM, кавычки, комментарии, BACKUP_DIR, создаётся недостающая папка'), r);
  const s2 = JSON.parse(fs.readFileSync(c.log, 'utf8'));
  ok(s2.args.includes('--schema=public') && !s2.args.includes('--schema=auth'), L('BACKUP_SCHEMAS=public: только public'), s2.args);
  fs.rmSync(other, { recursive: true, force: true });
  } catch (e) {
    ok(false, L('проверка оборвалась: ' + String(e && e.message || e).slice(0, 200)), String(e && e.stack || '').split(/\r?\n/).slice(1, 4).map(s => s.trim()).join(' | '));
  }
}
function await_ms(ms) { const t = Date.now(); while (Date.now() - t < ms) { /* ждём: следующий запуск должен быть позже по времени */ } }

try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) {}
console.log(`backup-test: ${pass} ok, ${fail} fail (оболочки: ${shells.map(s => s[0]).join(', ')})`);
process.exit(fail ? 1 : 0);
