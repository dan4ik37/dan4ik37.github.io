// Каждый файл сайта хотя бы разбирается (T-016, «тесты перед выкладкой»): опечатка в одном js-файле роняет целый раздел, а на Vercel Hobby
// выкладка идёт и без проверок. Здесь — компиляция без запуска:
//  • js/**/*.js, sw.js, studio/*.js (где нет import/export) — обычные скрипты (vm.Script);
//  • api/**/*.js — ES-модули (копия во временной папке с "type": "module", node --check);
//  • scripts/*.cjs / *.mjs — сами проверки и утилиты;
//  • встроенные <script> в index.html, 404.html, offline.html, privacy.html (без src и не JSON);
//  • *.json: vercel.json, manifest.json, package.json и т. п. разбираются как JSON.
// Запуск из корня сайта: node scripts/syntax-test.cjs
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { spawnSync } = require('child_process');
const SITE = process.argv[2] || path.join(__dirname, '..');
let pass = 0, fail = 0, files = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : (typeof extra === 'string' ? extra : JSON.stringify(extra))); } };
const SKIP = new Set(['node_modules', '.git', '.claude', 'dist', 'vendor', 'logs', 'apps', 'tools', 'assets', 'img', 'models', 'mods', 'sdk', 'docs']);

function walk(dir, exts, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(d.name) || d.name.startsWith('.')) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, exts, out);
    else if (exts.some(e => d.name.endsWith(e))) out.push(p);
  }
  return out;
}
const rel = p => path.relative(SITE, p).replace(/\\/g, '/');
const read = p => { const s = fs.readFileSync(p, 'utf8'); return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; };
const isModule = e => /Cannot use import statement|Unexpected token 'export'|import\.meta|Unexpected reserved word|await is only valid/.test(String(e && e.message));

// 1. обычные скрипты сайта
for (const f of [...walk(path.join(SITE, 'js'), ['.js']), path.join(SITE, 'sw.js'), ...walk(path.join(SITE, 'studio'), ['.js'])]) {
  files++;
  try { new vm.Script(read(f), { filename: rel(f) }); ok(true, rel(f)); }
  catch (e) {
    if (isModule(e)) {   // модуль (поток / рамка студии) — проверим как модуль
      const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: read(f), encoding: 'utf8' });
      ok(r.status === 0, rel(f) + ' (модуль)', (r.stderr || '').split('\n').slice(0, 4).join(' | '));
    } else ok(false, rel(f), (e.stack || String(e)).split('\n').slice(0, 3).join(' | '));
  }
}

// 2. api/ как ES-модули
{
  const tmp = fs.mkdtempSync(path.join(process.env.D37_TMP || os.tmpdir(), 'd37-syntax-'));
  try {
    fs.cpSync(path.join(SITE, 'api'), path.join(tmp, 'api'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
    for (const f of walk(path.join(tmp, 'api'), ['.js'])) {
      files++;
      const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
      ok(r.status === 0, 'api/' + path.relative(path.join(tmp, 'api'), f).replace(/\\/g, '/'), (r.stderr || '').split('\n').slice(0, 5).join(' | '));
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// 3. проверки и утилиты
for (const f of walk(path.join(SITE, 'scripts'), ['.cjs', '.mjs'])) {
  files++;
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  ok(r.status === 0, rel(f), (r.stderr || '').split('\n').slice(0, 5).join(' | '));
}

// 4. встроенные <script> страниц
for (const name of ['index.html', '404.html', 'offline.html', 'privacy.html']) {
  const p = path.join(SITE, name);
  if (!fs.existsSync(p)) continue;
  const html = read(p);
  let i = 0, n = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1], body = m[2];
    if (/\bsrc\s*=/.test(attrs) || !body.trim() || /type\s*=\s*["']?(?:application\/(?:ld\+)?json|text\/template|importmap)/i.test(attrs)) continue;
    n++; files++;
    try { new vm.Script(body, { filename: name + '#script' + (++i) }); ok(true, name + ' встроенный скрипт ' + i); }
    catch (e) { ok(false, `${name}: встроенный скрипт №${i} (с «${body.trim().slice(0, 50).replace(/\s+/g, ' ')}…»)`, e.message); }
  }
  ok(n > 0 || name !== 'index.html', name + ': встроенные скрипты найдены');
}

// 5. JSON
for (const f of ['vercel.json', 'manifest.json', 'package.json', 'package-lock.json']) {
  const p = path.join(SITE, f);
  if (!fs.existsSync(p)) continue;
  files++;
  try { JSON.parse(read(p)); ok(true, f); } catch (e) { ok(false, f, e.message); }
}

console.log(`syntax-test: ${pass} ok, ${fail} fail (файлов: ${files})`);
process.exit(fail ? 1 : 0);
