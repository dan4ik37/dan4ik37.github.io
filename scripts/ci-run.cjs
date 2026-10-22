// Прогон проверок сайта одной командой (T-016, docs/OPS.md): локально — перед выкладкой, в GitHub Actions — на каждый push в main и на PR
// (.github/workflows/tests.yml). Берёт быстрые проверки без браузера (минуты, не часы), запускает по несколько штук сразу, каждой — свой
// срок, печатает короткую строку на проверку и подробный хвост вывода только у упавших, итог пишет в сводку GitHub.
// Упавшую проверку (часть меряет время и проседает, когда рядом бегут другие) запускает ещё раз ОДНУ, когда машина свободна: прошла —
// «нестабильная» (в итоге предупреждение, не провал), упала снова — провал.
// Запуск из корня сайта:   node scripts/ci-run.cjs                 — всё быстрое
//                          node scripts/ci-run.cjs --only routes-test,pwa-test      — только перечисленное (без .cjs)
//                          node scripts/ci-run.cjs --list          — что в списке и чего ему не хватает
//                          node scripts/ci-run.cjs --e2e           — ещё и проверки в настоящем Chrome (нужны Chrome и интернет к jsDelivr)
// Что нужно, кроме Node: пакеты three@0.149.0, @dimforge/rapier3d-compat@0.19.3, @electric-sql/pglite — НЕ в репозитории, ставятся рядом:
//   npm install --prefix <папка> --no-save --ignore-scripts three@0.149.0 @dimforge/rapier3d-compat@0.19.3 @electric-sql/pglite@0.5.8
//   и переменная DEPS_DIR=<папка> (или THREE_PATH / RAPIER_PATH / PGLITE_PATH отдельно). Нет пакета — проверки, которым он нужен,
//   пропускаются с пометкой (в GitHub Actions CI_STRICT=1: пропуск = провал, чтобы проверки не отваливались тихо).
// Выкладку Vercel эти проверки по умолчанию НЕ задерживают: push в main выкатывается сразу, красный крестик на коммите — сигнал разбираться
// (задержку можно включить в панели Vercel — «Deployment Checks», см. docs/OPS.md).
// Временное — D37_TMP (диск C у владельца почти полный: E:\claude-tmp\…). Код выхода: 1 — есть упавшие обязательные проверки.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const opt = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : ''; };

// ═══ Список: файл, аргументы, срок (с), нужен пакет, повтор, одна за раз, необязательная ═══
//  needs: three | rapier | pglite | pwsh — без него проверка пропускается   soft: rapier — без него идёт урезанной, но в CI_STRICT это провал
//  t — срок в секундах (по умолчанию 150)   retry — сколько раз повторить сразу при провале   serial — не вместе с другими (замеры времени)
//  optional — провал только предупреждает   e2e — только с --e2e
const TESTS = [
  // сначала самое дешёвое и самое важное: «собирается ли вообще» и свежесть сгенерированного
  { f: 'syntax-test.cjs', t: 120 },
  { f: 'make-errlog.mjs', args: ['--check'], t: 60 }, { f: 'gen-city-defs.cjs', args: ['--check'], t: 60 },
  { f: 'routes-test.cjs' }, { f: 'pwa-test.cjs' }, { f: 'games-test.cjs' }, { f: 'auth-test.cjs' }, { f: 'age-test.cjs' },
  { f: 'xss-test.cjs', t: 300 },   // чужой текст не становится разметкой (T-011): разбор всех js/api + злые строки; ~30 с ЦП
  { f: 'errlog-test.cjs', serial: true }, { f: 'ops-test.cjs', t: 180 }, { f: 'backup-test.cjs', needs: 'pwsh', t: 420 }, { f: 'ops-sql-test.mjs', needs: 'pglite', t: 180 },
  { f: 'ads-test.cjs' }, { f: 'ad-direct-test.cjs' }, { f: 'pay-test.cjs' }, { f: 'referral-test.cjs' }, { f: 'economy-test.cjs' },
  { f: 'community-test.cjs' }, { f: 'settings-test.cjs' }, { f: 'room-net-test.cjs' }, { f: 'unity-test.cjs' }, { f: 'raid-test.cjs', args: ['--fast'] },
  { f: 'base-test.cjs' }, { f: 'climate-test.cjs' }, { f: 'net-test.cjs' }, { f: 'studio-net-test.cjs' }, { f: 'engine-test.cjs' },
  { f: 'physics-test.cjs', soft: 'rapier' }, { f: 'tiles-test.cjs' }, { f: 'mirplay-test.cjs' }, { f: 'kubomir-input-test.cjs' },
  { f: 'world-zones-test.cjs' }, { f: 'city-test.cjs' }, { f: 'city-sql-test.mjs', needs: 'pglite', t: 300 }, { f: 'city-sim.cjs', args: ['--days', '60', '--players', '20,100'], t: 180 },
  { f: 'vehicle-test.cjs' }, { f: 'waves-test.cjs', retry: 1 }, { f: 'mc-import-test.cjs' }, { f: 'model-test.cjs' }, { f: 'combat-test.cjs' }, { f: 'cloud-test.cjs' },
  { f: 'photo-test.cjs' },   // 🖼 фоторедактор: команды «d37 v1», «Мои материалы» (поддельная IndexedDB), проект .d37photo, связка раздела
  // языки скриптов ждут настоящие таймеры (по 5–60 мс): под нагрузкой других проверок опаздывают (так упала lang-cs-test) — идут по одной
  { f: 'lang-cs-test.cjs', serial: true }, { f: 'lang-java-test.cjs', serial: true }, { f: 'lang-lua-test.cjs', serial: true }, { f: 'lang-wasm-test.cjs', env: { D37_SKIP: 'cpp,rust' } },
  { f: 'voxel-test.cjs', serial: true, retry: 2 },
  // игры: бот против бота (число партий уменьшено — в CI достаточно)
  { f: 'domino-test.cjs' }, { f: 'fillword-test.cjs' }, { f: 'balda-test.cjs', args: ['300'] }, { f: 'krokodil-test.cjs' },
  { f: 'kletochki-test.cjs' }, { f: 'chervyachki-test.cjs' },
  // нужен three@0.149.0
  { f: 'char-test.cjs', args: ['{THREE}'], needs: 'three' }, { f: 'destruct-test.cjs', args: ['{THREE}'], needs: 'three' },
  { f: 'kubomir-hand-test.cjs', args: ['{THREE}'], needs: 'three' }, { f: 'kubomir-move-test.cjs', args: ['{THREE}'], needs: 'three' }, { f: 'kubomir-combat-test.cjs', args: ['{THREE}'], needs: 'three' },
  { f: 'render-test.cjs', args: ['{THREE}'], needs: 'three', t: 240 }, { f: 'sprite-test.cjs', args: ['{THREE}'], needs: 'three' },
  { f: 'studio-modes-test.cjs', args: ['{THREE}'], needs: 'three' }, { f: 'worldmap-test.cjs', args: ['{THREE}'], needs: 'three' },
  // в настоящем Chrome (--e2e)
  { f: 'errlog-e2e.cjs', e2e: true, t: 400 }, { f: 'routes-e2e.cjs', e2e: true, t: 600 }, { f: 'pwa-e2e.cjs', e2e: true, t: 400 },
  { f: 'war-hud-e2e.cjs', e2e: true, t: 600 },   // боевая зона: панель оружия отвечает (телефон, планшет, ПК)
  { f: 'photo-e2e.cjs', args: ['smoke'], e2e: true, t: 600 },   // фоторедактор: все команды, кнопки, отмена (fabric.js с jsDelivr)
  { f: 'city-e2e.cjs', e2e: true, needs: 'pglite', t: 900 },   // «Живой город»: работа с сервера (city.sql в PGlite), банк, окно экономики, два игрока
];

// ═══ Откуда брать пакеты ═══
const deps = process.env.DEPS_DIR || '';
const firstDir = (...c) => c.filter(Boolean).find(p => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }) || '';
const has = (base, rel) => { try { return fs.existsSync(path.join(base, rel)); } catch (e) { return false; } };
const D = {
  three: firstDir(process.env.THREE_PATH, deps && path.join(deps, 'node_modules/three')),
  rapier: [process.env.RAPIER_PATH, deps].find(p => p && has(p, 'node_modules/@dimforge/rapier3d-compat')) || '',   // physics-test без Rapier проходит урезанным (16 вместо 85 проверок)
  pglite: [process.env.PGLITE_PATH, deps].find(p => p && (has(p, 'node_modules/@electric-sql/pglite/package.json') || has(p, '@electric-sql/pglite/package.json') || (has(p, 'package.json') && fs.readFileSync(path.join(p, 'package.json'), 'utf8').includes('"@electric-sql/pglite"')))) || '',
};
D.pwsh = ['powershell.exe', 'pwsh'].some(exe => { const r = spawnSync(exe, ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }); return !r.error && r.status === 0; }) ? 'есть' : '';
const NEED_HINT = { three: 'three@0.149.0 (THREE_PATH или DEPS_DIR)', rapier: '@dimforge/rapier3d-compat@0.19.3 (RAPIER_PATH или DEPS_DIR)', pglite: '@electric-sql/pglite (PGLITE_PATH или DEPS_DIR)', pwsh: 'PowerShell (powershell.exe / pwsh)' };
const STRICT = !!process.env.CI_STRICT;

if (flag('list')) {
  console.log('Проверок в списке:', TESTS.length);
  for (const t of TESTS) {
    const dep = t.needs || t.soft;
    console.log(' ', t.f.padEnd(26), (t.args || []).join(' ').padEnd(12), dep ? (D[dep] ? '[' + dep + ': есть]' : '[' + dep + ': НЕТ — ' + NEED_HINT[dep] + ']') : '', t.e2e ? '(только --e2e)' : '', t.serial ? '(одна за раз)' : '');
  }
  process.exit(0);
}

// ═══ Выбор ═══
const only = (opt('only') || '').split(',').map(s => s.trim().replace(/\.(cjs|mjs)$/, '')).filter(Boolean);
const skip = (opt('skip') || '').split(',').map(s => s.trim().replace(/\.(cjs|mjs)$/, '')).filter(Boolean);
const key = t => t.f.replace(/\.(cjs|mjs)$/, '');
const list = TESTS.filter(t => (flag('e2e') ? true : !t.e2e) && (!only.length || only.includes(key(t))) && !skip.includes(key(t)));
if (only.length) { const bad = only.filter(o => !TESTS.some(t => key(t) === o)); if (bad.length) { console.log('Нет в списке:', bad.join(', ')); process.exit(2); } }
const PAR = Math.max(1, +opt('par') || +process.env.CI_PAR || Math.min(4, Math.max(1, os.cpus().length - 1)));
const TMP = process.env.D37_TMP || os.tmpdir();
const GH = !!process.env.GITHUB_ACTIONS;
const scale = +process.env.CI_TIME_SCALE || 1;

const results = [];
const skipped = [];
const runnable = [];
for (const t of list) {
  if (t.needs && !D[t.needs]) { skipped.push({ t, why: 'нет: ' + NEED_HINT[t.needs] }); continue; }
  runnable.push(t);
}
const softMissing = runnable.filter(t => t.soft && !D[t.soft]);   // идут, но урезанными

function runOne(t) {
  return new Promise(resolve => {
    const t0 = Date.now();
    const args = (t.args || []).map(a => a === '{THREE}' ? D.three : a);
    const env = { ...process.env, ...(t.env || {}), D37_TMP: TMP, TMP, TEMP: TMP };
    if (D.three) env.THREE_PATH = D.three;
    if (D.rapier) env.RAPIER_PATH = D.rapier;
    if (D.pglite) { env.PGLITE_PATH = D.pglite; if (STRICT) env.OPS_SQL_REQUIRED = '1'; }
    const p = spawn(process.execPath, [path.join(__dirname, t.f), ...args], { cwd: ROOT, env });
    let out = '', killed = false;
    const add = d => { out += d; if (out.length > 3e6) out = out.slice(-1.5e6); };
    p.stdout.on('data', add); p.stderr.on('data', add);
    const timer = setTimeout(() => { killed = true; try { p.kill('SIGKILL'); } catch (e) {} }, (t.t || 150) * 1000 * scale);
    p.on('error', e => { clearTimeout(timer); resolve({ code: -1, out: String(e), sec: 0, killed }); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, out, sec: (Date.now() - t0) / 1000, killed }); });
  });
}
const lastLine = out => { const l = out.trim().split(/\r?\n/).filter(Boolean); return (l[l.length - 1] || '').slice(0, 160); };
const tail = (out, n) => out.trim().split(/\r?\n/).slice(-n).join('\n');

// second — результат первой попытки, если это вторая (одна, когда машина свободна)
async function exec(t, second) {
  let r = await runOne(t), tries = 1;
  while (r.code !== 0 && tries <= (t.retry || 0)) { tries++; const again = await runOne(t); r = { ...again, sec: r.sec + again.sec, retried: tries - 1 }; }
  const res = { t, ...r, ok: r.code === 0, flaky: !!second && r.code === 0, firstOut: second ? second.out : '' };
  results.push(res);
  const mark = res.ok ? (second ? '~' : '✓') : (t.optional ? '!' : '✗');
  console.log(`${mark} ${key(t).padEnd(24)} ${res.sec.toFixed(1).padStart(6)} с${res.retried ? ` (повторов: ${res.retried})` : ''}${second ? ' (вторая попытка, одна)' : ''}  ${res.killed ? 'ПРЕВЫШЕН СРОК' : lastLine(res.out)}`);
  if (!res.ok) {
    const last = second || t.serial;   // последняя попытка — подробный хвост; первую покажем покороче: вдруг вторая пройдёт
    if (GH) console.log(`::group::Вывод ${key(t)} (${last ? 'последние 60 строк' : 'первая попытка, 30 строк'})`);
    console.log(tail(res.out, last ? 60 : 30));
    if (GH) console.log('::endgroup::');
    if (GH && last) console.log(`::${t.optional ? 'warning' : 'error'} title=Проверка ${key(t)} не прошла::${(res.killed ? 'превышен срок. ' : '') + lastLine(res.out).replace(/[\r\n%]/g, ' ')}`);
  }
  return res;
}

(async () => {
  const t0 = Date.now();
  console.log(`Проверок: ${runnable.length} (пропущено: ${skipped.length}); одновременно: ${PAR}; Node ${process.version}; ${os.platform()} ${os.cpus().length} ЦП; временное: ${TMP}`);
  for (const k of ['three', 'rapier', 'pglite', 'pwsh']) console.log(`  ${k.padEnd(7)} ${D[k] || 'нет'}`);
  fs.mkdirSync(TMP, { recursive: true });
  const parallel = runnable.filter(t => !t.serial), serial = runnable.filter(t => t.serial);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(PAR, parallel.length) }, async () => { while (i < parallel.length) await exec(parallel[i++]); }));
  for (const t of serial) await exec(t);   // замеры времени — когда остальные уже закончили
  // вторая попытка упавших вместе с другими: по одной, на свободной машине
  for (const f of results.filter(r => !r.ok && !r.t.serial)) {
    console.log(`↻ ${key(f.t)}: повтор одной, когда машина свободна`);
    results.splice(results.indexOf(f), 1);
    await exec(f.t, f);
  }
  const bad = results.filter(r => !r.ok && !r.t.optional), warn = results.filter(r => !r.ok && r.t.optional), flaky = results.filter(r => r.flaky);
  const hardSkips = skipped.filter(s => !s.t.soft), strictFail = STRICT && (hardSkips.length || softMissing.length);
  const secs = (Date.now() - t0) / 1000;
  console.log(`\nИтог: ${results.length - bad.length - warn.length} прошло, ${bad.length} упало, ${warn.length} предупреждений, ${flaky.length} нестабильных, ${skipped.length} пропущено — ${secs.toFixed(0)} с`);
  for (const s of skipped) console.log(`  пропущено ${key(s.t)} — ${s.why}`);
  for (const f of flaky) { console.log(`  нестабильная ${key(f.t)}: упала рядом с другими, прошла одна`); if (GH) console.log(`::warning title=Нестабильная проверка ${key(f.t)}::упала при параллельном запуске, прошла одна — проверка зависит от времени`); }
  if (strictFail) console.log(`CI_STRICT: нет пакетов для обязательных проверок (${[...hardSkips.map(s => key(s.t)), ...softMissing.map(t => key(t) + ' без ' + t.soft)].join(', ')}) — это провал`);
  console.log('  самые долгие:', [...results].sort((a, b) => b.sec - a.sec).slice(0, 5).map(r => `${key(r.t)} ${r.sec.toFixed(0)} с`).join(', '));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [`## Проверки сайта: ${bad.length || strictFail ? '❌ есть падения' : flaky.length ? '✅ всё прошло (есть нестабильные)' : '✅ всё прошло'}`, '',
      `Прошло ${results.length - bad.length - warn.length} из ${results.length}, пропущено ${skipped.length}, ${secs.toFixed(0)} с на ${os.platform()} (Node ${process.version}).`, '',
      ...(bad.length ? ['**Упали:**', ...bad.map(r => `- \`${key(r.t)}\` — ${r.killed ? 'превышен срок' : lastLine(r.out)}`), ''] : []),
      ...(strictFail ? ['**Нет пакетов для обязательных проверок (CI_STRICT):** ' + [...hardSkips.map(s => key(s.t)), ...softMissing.map(t => key(t))].join(', '), ''] : []),
      ...(flaky.length ? ['**Нестабильные (упали рядом с другими, прошли одни):**', ...flaky.map(r => `- \`${key(r.t)}\``), ''] : []),
      ...(warn.length ? ['**Предупреждения (необязательные):**', ...warn.map(r => `- \`${key(r.t)}\` — ${lastLine(r.out)}`), ''] : []),
      ...(skipped.length ? ['**Пропущено:**', ...skipped.map(s => `- \`${key(s.t)}\` — ${s.why}`), ''] : []),
      '| проверка | секунд | итог |', '|---|---:|---|', ...[...results].sort((a, b) => a.t.f.localeCompare(b.t.f)).map(r => `| ${key(r.t)} | ${r.sec.toFixed(1)} | ${r.ok ? (r.flaky ? '~ ' : '✓ ') + lastLine(r.out).replace(/\|/g, '/') : '✗'} |`), '',
      'Выкладку Vercel эти проверки по умолчанию не задерживают: красный крестик — сигнал разобраться (docs/OPS.md).'].join('\n');
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n'); } catch (e) {}
  }
  process.exit(bad.length || strictFail ? 1 : 0);
})();
