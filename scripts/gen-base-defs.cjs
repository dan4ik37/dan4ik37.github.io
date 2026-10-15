// Каталог «Района участков» и набегов: base_defs() в bases.sql собирается из SERVER (js/games/mir-base.js — DEFS, FURN, UNITS,
// HERO, RAID). Поменял цифры в mir-base.js → node scripts/gen-base-defs.cjs (перепишет тело base_defs() в bases.sql) → тесты
// base-test.cjs и PGlite сверят. Без аргументов — пишет; --check — только проверить, что bases.sql совпадает.
const fs = require('fs'), vm = require('vm'), path = require('path');
const SITE = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(__dirname, '..');
const check = process.argv.includes('--check');
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/games/mir-base.js'), 'utf8'), { filename: 'mir-base.js' });
const S = globalThis.MirBase.SERVER, J = v => JSON.stringify(v);
const L = [];
L.push(`  select '{"n":${S.n},"in":${S.in},"per":${S.per},"plots":${S.plots},"start":${S.start},"deco":${J(S.deco)},"door":${J(S.door)},`);
const block = (name, obj, last, perLine = 1) => {
  L.push(`  "${name}":{`);
  const e = Object.entries(obj);
  for (let i = 0; i < e.length; i += perLine) L.push('    ' + e.slice(i, i + perLine).map(([k, v]) => `${J(k)}:${J(v)}`).join(', ') + (i + perLine < e.length ? ',' : '}' + (last ? '' : ',')));
};
block('k', S.k);
block('f', S.f, false, 3);
block('u', S.u);
L.push(`  "hero":${J(S.hero)},`);
const R = S.raid, rk = Object.keys(R);
L.push('  "raid":{');
const rows = [];
let cur = [];
for (const k of rk) { const s = `${J(k)}:${J(R[k])}`; if (cur.length && (cur.join(',').length + s.length > 150 || typeof R[k] === 'object' && !Array.isArray(R[k]))) { rows.push(cur.join(',')); cur = []; } cur.push(s); }
if (cur.length) rows.push(cur.join(','));
rows.forEach((r, i) => L.push('    ' + r + (i < rows.length - 1 ? ',' : "}}'::jsonb")));
const body = L.join('\n');
if (body.split("'").length !== 3) throw new Error('апостроф внутри каталога — SQL сломается');
JSON.parse(body.slice(body.indexOf("'") + 1, body.lastIndexOf("'")));   // это правильный JSON
const file = path.join(SITE, 'bases.sql'), raw = fs.readFileSync(file, 'utf8'), eol = raw.includes('\r\n') ? '\r\n' : '\n', sql = raw.replace(/\r\n/g, '\n');
const head = 'create or replace function public.base_defs() returns jsonb language sql immutable as $$\n';
const a = sql.indexOf(head), b = sql.indexOf('\n$$;', a);
if (a < 0 || b < 0) throw new Error('в bases.sql не найдено base_defs()');
const next = sql.slice(0, a + head.length) + body + sql.slice(b);
if (check) { const same = next === sql; console.log(same ? 'bases.sql: base_defs() совпадает с mir-base.js' : 'bases.sql: base_defs() УСТАРЕЛ — node scripts/gen-base-defs.cjs'); process.exit(same ? 0 : 1); }
fs.writeFileSync(file, eol === '\n' ? next : next.replace(/\n/g, eol));
console.log('bases.sql: base_defs() пересобран из mir-base.js');
