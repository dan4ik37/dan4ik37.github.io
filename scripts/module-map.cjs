// Карта модулей сайта (Step 0 плана движка, M:\d37\d37-core\spec\ENGINE_PLAN_2026-11.md §E): разделы и адреса, игры и их скрипты,
// функции базы (RPC) и кто их зовёт, проверки — в docs/MODULES.md. Файл СОБИРАЕТСЯ, руками не править.
// Запуск из корня сайта:  node scripts/module-map.cjs           — перезаписать docs/MODULES.md
//                         node scripts/module-map.cjs --check   — код выхода 1, если docs/MODULES.md устарел (в ci-run — предупреждение)
// Вывод детерминированный: всё отсортировано (по кодам символов), без дат и хэшей; размеры — по тексту с LF (одинаково в Windows
// с autocrlf и в GitHub Actions). Карта ядра (ABI d37-core / d37-terrain) — M:\d37\d37-core\spec\MODULES.md.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'MODULES.md');
const rd = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return ''; } };
const rel = f => path.relative(ROOT, f).split(path.sep).join('/');
const cell = s => String(s).replace(/\|/g, '\\|');
function walk(dir, ok) {
  const out = [], st = [path.join(ROOT, dir)];
  while (st.length) {
    const d = st.pop(); let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) { const p = path.join(d, e.name); if (/node_modules|vendor|\.git$/.test(e.name)) continue; e.isDirectory() ? st.push(p) : ok(p) && out.push(p); }
  }
  return out.map(rel).sort();
}

// ═══ 1. Разделы и адреса ═══
function routes(L) {
  const r = rd('js/ui/router.js'), m = /const PAGES = \{([\s\S]*?)\n\};/.exec(r), pages = [];
  if (m) for (const l of m[1].split('\n')) { const x = /^\s*([a-z0-9_]+):\s*\[([^\]]*)\]/.exec(l); if (x) pages.push([x[1], (x[2].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1))]); }
  const swm = /const SPA_PATH = (\/.*\/);/.exec(rd('sw.js'));
  let spa = null; try { spa = swm ? eval(swm[1]) : null; } catch (e) {}   // своё регулярное выражение из sw.js (наш файл)
  let vj = {}; try { vj = JSON.parse(rd('vercel.json')); } catch (e) {}
  const rw = (vj.rewrites || []).map(x => [x.source, x.destination]);
  const special = new Map([...r.matchAll(/if \(r === '(\w+)'\) return '(\/[^']*)'/g)].map(x => [x[1], x[2]]));   // D37Route.toPath: #/ai3d → /tools/3d…
  const url = id => id === 'home' ? '/' : id === 'games' ? '/play' : special.get(id) || '/' + id;
  L.push('## 1. Routes', '', `SPA sections: js/ui/router.js \`PAGES\` (${pages.length}); service-worker shell: sw.js \`SPA_PATH\`; rewrites: vercel.json (${rw.length}); server pages: api/pages.js \`ROUTES\`.`, '');
  L.push('| Section id | URL | Page blocks | sw.js shell | vercel.json rewrite |', '|---|---|---|---|---|');
  for (const [id, blocks] of pages) {
    const u = url(id), hit = rw.filter(([s]) => s === u || s.startsWith(u + '/') || s.startsWith(u + '(')).map(([s, d]) => `${s} → ${d}`);
    L.push(`| ${id} | ${u} | ${cell(blocks.join(', '))} | ${spa ? (u === '/' || spa.test(u) ? 'yes' : '—') : '?'} | ${cell(hit.join('; ') || '—')} |`);
  }
  const p = rd('api/pages.js'), imp = new Map([...p.matchAll(/import (\w+) from '\.\/(_lib\/routes\/[^']+)'/g)].map(x => [x[1], 'api/' + x[2]]));
  const rm = /const ROUTES = \{([\s\S]*?)\};/.exec(p), rts = [];
  if (rm) for (const part of rm[1].replace(/\/\/.*$/gm, '').split(',')) { const x = /^\s*([\w-]+)(?:\s*:\s*(\w+))?\s*$/.exec(part); if (x) rts.push([x[1], imp.get(x[2] || x[1]) || '?']); }
  L.push('', `Server pages (api/pages.js ROUTES, ${rts.length}; one Vercel function serves them all):`, '', '| Key | Module |', '|---|---|');
  for (const [k, f] of rts.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) L.push(`| ${k} | ${f} |`);
  L.push('', 'Vercel rewrites (vercel.json, in file order — order matters):', '', '| # | Source | Destination |', '|---|---|---|');
  rw.forEach(([s, d], i) => L.push(`| ${i + 1} | ${cell(s)} | ${cell(d)} |`));
  const fns = walk('api', f => /\.js$/.test(f) && !/[\\/]_lib[\\/]/.test(f));
  L.push('', `Serverless functions (api/*.js outside _lib; Vercel Hobby limit 12): ${fns.length} — ${fns.join(', ')}.`, '');
}

// ═══ 2. Игры и их скрипты ═══
function games(L) {
  const g = rd('js/features/games.js'), rows = [];
  let list = '?';
  for (const l of g.split('\n')) {
    const a = /^const (\w+) = \[/.exec(l); if (a) list = a[1];
    const m = /^\s*\{ id: '([^']+)'/.exec(l); if (!m) continue;
    const sm = /scripts: \[([^\]]*)\]/.exec(l), age = /age: '([^']+)'/.exec(l), title = /title: '([^']+)'/.exec(l);
    rows.push({ id: m[1], list, age: age ? age[1] : '—', title: title ? title[1] : '', scripts: sm ? (sm[1].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1)) : [] });
  }
  const ver = (/const GAMES_VER = '([^']+)'/.exec(g) || [])[1] || '?';
  L.push('## 2. Games', '', `js/features/games.js: ${rows.length} rows, GAMES_VER '${ver}' (bump on any game / engine file change; merge rule: skill d37-merge). Lists: ` +
    [...new Set(rows.map(r => r.list))].map(n => `${n} ${rows.filter(r => r.list === n).length}`).join(', ') + '.', '');
  L.push('| Game | List | Age | Title | Scripts | Own scripts (not js/engine, js/core) |', '|---|---|---|---|---|---|');
  for (const r of rows) L.push(`| ${r.id} | ${r.list} | ${r.age} | ${cell(r.title)} | ${r.scripts.length} | ${cell(r.scripts.filter(s => !/^js\/(engine|core)\//.test(s)).join(', ') || '—')} |`);
  const use = new Map();
  for (const r of rows) for (const s of r.scripts) { if (!use.has(s)) use.set(s, new Set()); use.get(s).add(r.id); }
  const eng = walk('js/engine', f => f.endsWith('.js'));
  L.push('', 'Engine files → games that load them (a change here means: bump GAMES_VER, open these games once):', '', '| File | KiB | Games |', '|---|---|---|');
  for (const f of eng) { const n = use.get(f); L.push(`| ${f} | ${(Buffer.byteLength(rd(f)) / 1024).toFixed(1)} | ${n ? [...n].sort().join(', ') : '— (not in any game\'s scripts)'} |`); }
  const missing = [...use.keys()].filter(s => !fs.existsSync(path.join(ROOT, s))).sort();
  L.push('', `Scripts listed by games but missing on disk: ${missing.length ? missing.join(', ') : 'none'}.`, '');
}

// ═══ 3. Функции базы (RPC) и SQL ═══
// Имена RPC, которые файл зовёт по имени: .rpc('x'), обёртки rpc('x') / sbRpc / rpcOk / pushRpc / kidRpc… (любое имя с «rpc»,
// первый аргумент — строка) и адрес /rpc/x. Имя, собранное из переменной (`x_${…}`), не видно — так и пишем в карте.
function rpcNames(t) {
  const seen = new Set();
  for (const m of t.matchAll(/(?<![\w$])[\w$.]*?(?:rpc|Rpc|RPC)[\w$]*\(\s*['"`]([a-z_0-9]+)['"`]|\/rpc\/([a-z_0-9]+)/g)) seen.add(m[1] || m[2]);
  return [...seen];
}
function rpc(L) {
  const sql = fs.readdirSync(ROOT).filter(f => f.endsWith('.sql')).sort(), def = new Map(), tables = new Map();
  for (const f of sql) {
    const t = rd(f).replace(/--.*$/gm, '');
    for (const m of t.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(/gi)) { const n = m[1].toLowerCase(); if (!def.has(n)) def.set(n, new Set()); def.get(n).add(f); }
    tables.set(f, new Set([...t.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)/gi)].map(m => m[1].toLowerCase())));
  }
  const call = new Map();
  for (const f of [...walk('js', p => p.endsWith('.js')), ...walk('api', p => p.endsWith('.js'))]) {
    for (const n of rpcNames(rd(f))) { if (!call.has(n)) call.set(n, new Set()); call.get(n).add(f); }
  }
  L.push('## 3. RPC and SQL', '', `${sql.length} SQL files in the root (applied by the owner by hand; verify with skill d37-sql-verify), ${def.size} functions, ` +
    `${call.size} names called from js/ or api/ (\`.rpc('x')\`, any \`*rpc*('x')\` wrapper such as rpc / sbRpc / rpcOk / pushRpc, or \`/rpc/x\`).`, '');
  L.push('| SQL file | Functions | Tables created |', '|---|---|---|');
  for (const f of sql) L.push(`| ${f} | ${[...def].filter(([, s]) => s.has(f)).length} | ${cell([...tables.get(f)].sort().join(', ') || '—')} |`);
  L.push('', '| Function | Defined in | Called from |', '|---|---|---|');
  for (const n of [...def.keys()].sort()) L.push(`| ${n} | ${[...def.get(n)].sort().join(', ')} | ${call.has(n) ? [...call.get(n)].sort().join(', ') : '— (no call by name in js/ or api/: server-side, trigger, or the name is built at run time)'} |`);
  const und = [...call.keys()].filter(n => !def.has(n)).sort();
  L.push('', `Called but not defined in any root .sql (built-in, removed, or a typo — check): ${und.length ? und.map(n => `${n} (${[...call.get(n)].sort().join(', ')})`).join('; ') : 'none'}.`, '');
}

// ═══ 4. Проверки ═══
// Объекты верхнего уровня `{…}` из текста массива: скобки внутри строк ('{THREE}') и комментарии // не считаются.
function topObjects(src) {
  const out = []; let depth = 0, start = -1, q = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
    if (ch === '{') { if (!depth++) start = i; } else if (ch === '}' && depth && !--depth) out.push(src.slice(start, i + 1));
  }
  return out;
}
// одна запись TESTS `{ f: '…', args: […], env: {…}, needs, soft, e2e, optional, serial, t, retry }` → [файл, 'флаги'] или null
function ciEntry(obj) {
  const x = /^\{\s*f:\s*'([^']+)'([\s\S]*)\}$/.exec(obj); if (!x) return null;
  const o = x[2], fl = [];
  const a = /args:\s*\[([^\]]*)\]/.exec(o); if (a) fl.push('args ' + (a[1].match(/'([^']*)'/g) || []).map(s => s.slice(1, -1)).join(' '));
  const ev = /env:\s*\{([^}]*)\}/.exec(o); if (ev) fl.push('env ' + [...ev[1].matchAll(/(\w+):\s*'([^']*)'/g)].map(y => y[1] + '=' + y[2]).join(' '));
  for (const k of ['needs', 'soft']) { const v = new RegExp('\\b' + k + ":\\s*'([^']+)'").exec(o); if (v) fl.push(k + ' ' + v[1]); }
  for (const k of ['e2e', 'optional', 'serial']) if (new RegExp('\\b' + k + ':\\s*true').test(o)) fl.push(k);
  const t = /\bt:\s*(\d+)/.exec(o); if (t) fl.push('t ' + t[1] + ' s');
  const r = /\bretry:\s*(\d+)/.exec(o); if (r) fl.push('retry ' + r[1]);
  return [x[1], fl.join(', ')];
}
function tests(L) {
  const c = rd('scripts/ci-run.cjs'), m = /const TESTS = \[([\s\S]*?)\n\];/.exec(c), ci = [];
  if (m) for (const obj of topObjects(m[1])) { const e = ciEntry(obj); if (e) ci.push(e); }
  const inCi = new Set(ci.map(x => x[0]));
  const all = fs.readdirSync(path.join(ROOT, 'scripts')).filter(f => /-(test|e2e|sim|bench|perf)\.(c?js|mjs)$|^(world|planet)-perf\.cjs$/.test(f)).sort();
  L.push('## 4. Tests', '', `scripts/ci-run.cjs runs ${ci.length} entries (= GitHub Actions on push; \`--e2e\` adds the Chrome ones). ` +
    'Heavy runs (the full CI, Chrome e2e with CPU ×4, perf) take M:\\d37\\claude-tmp\\HEAVY.lock first (M:\\d37\\d37-core\\spec\\HEAVY_LOCK.md).', '');
  L.push('| CI entry | Flags |', '|---|---|');
  for (const [f, fl] of ci) L.push(`| ${f} | ${cell(fl || '—')} |`);
  const out = all.filter(f => !inCi.has(f));
  L.push('', `Test / e2e / perf scripts NOT in the CI list (${out.length}; run by hand when their area changes): ${out.join(', ') || 'none'}.`, '');
}

function build() {
  const L = ['# Site module map — GENERATED by scripts/module-map.cjs, do not edit', '',
    'Regenerate: `node scripts/module-map.cjs` (check: `--check`; ci-run.cjs warns when stale). Core ABI map: M:\\d37\\d37-core\\spec\\MODULES.md;',
    'shared board: M:\\d37\\d37-core\\spec\\BOARD.md; site board: docs/TASKS.md.', ''];
  routes(L); games(L); rpc(L); tests(L);
  return L.join('\n');
}
module.exports = { topObjects, ciEntry, rpcNames, build };   // для scripts/module-map-test.cjs

if (require.main === module) {
  const text = build();
  if (process.argv.includes('--check')) {
    const cur = rd('docs/MODULES.md');
    if (cur !== text) { console.log('docs/MODULES.md устарел — запусти: node scripts/module-map.cjs'); process.exit(1); }
    console.log('docs/MODULES.md актуален'); process.exit(0);
  }
  fs.writeFileSync(OUT, text, 'utf8');
  console.log(`docs/MODULES.md: ${text.split('\n').length} строк`);
}
