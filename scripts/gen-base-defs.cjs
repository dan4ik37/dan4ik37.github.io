// Каталоги района участков и военных баз: base_defs() и war_defs() в bases.sql собираются из js/games/mir-base.js — SERVER (район:
// DEFS, FURN) и WSERVER (база: WDEFS, UNITS, HERO, RAID, VEH). Поменял цифры в mir-base.js → node scripts/gen-base-defs.cjs (перепишет
// тела обеих функций в bases.sql) → тесты base-test.cjs и PGlite сверят. Без аргументов — пишет; --check — только проверить.
const fs = require('fs'), vm = require('vm'), path = require('path');
const SITE = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(__dirname, '..');
const check = process.argv.includes('--check');
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/games/mir-base.js'), 'utf8'), { filename: 'mir-base.js' });
const MB = globalThis.MirBase, J = v => JSON.stringify(v);
// тело одной функции: шапка (скаляры), блоки-объекты по строке на вид, остальное — строками до 150 знаков
function body(S, head, blocks){
  const L = [];
  L.push(`  select '{${head.map(k => `${J(k)}:${J(S[k])}`).join(',')},`);
  const block = (name, obj, last, perLine = 1) => {
    L.push(`  "${name}":{`);
    const e = Object.entries(obj);
    for (let i = 0; i < e.length; i += perLine) L.push('    ' + e.slice(i, i + perLine).map(([k, v]) => `${J(k)}:${J(v)}`).join(', ') + (i + perLine < e.length ? ',' : '}' + (last ? "}'::jsonb" : ',')));
  };
  blocks.forEach(([name, per], i) => {
    const last = i === blocks.length - 1, v = S[name];
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).some(x => x && typeof x === 'object')) block(name, v, last, per || 1);
    else L.push(`  "${name}":${J(v)}` + (last ? "}'::jsonb" : ','));
  });
  const out = L.join('\n');
  if (out.split("'").length !== 3) throw new Error('апостроф внутри каталога — SQL сломается');
  JSON.parse(out.slice(out.indexOf("'") + 1, out.lastIndexOf("'")));   // это правильный JSON
  return out;
}
// длинные объекты правил (raid) — строками до 150 знаков, как раньше
function rows(name, R, last){
  const out = [`  "${name}":{`], cur = [], all = [];
  for (const k of Object.keys(R)) { const s = `${J(k)}:${J(R[k])}`; if (cur.length && (cur.join(',').length + s.length > 150 || typeof R[k] === 'object' && !Array.isArray(R[k]))) { all.push(cur.join(',')); cur.length = 0; } cur.push(s); }
  if (cur.length) all.push(cur.join(','));
  all.forEach((r, i) => out.push('    ' + r + (i < all.length - 1 ? ',' : '}' + (last ? "}'::jsonb" : ','))));
  return out.join('\n');
}
const S = MB.SERVER, W = MB.WSERVER;
const bodyB = body(S, ['n', 'in', 'per', 'plots', 'start', 'deco', 'door'], [['k'], ['f', 3]]);
let bodyW = body(W, ['n', 'ring', 'per', 'plots', 'start', 'deco', 'give', 'block', 'names', 'colors'], [['k'], ['u'], ['hero'], ['veh', 3]]);
// raid — строками (как было у base_defs): вставить перед последним блоком
bodyW = bodyW.replace(/\}'::jsonb$/, () => ',\n' + rows('raid', W.raid, true));
JSON.parse(bodyW.slice(bodyW.indexOf("'") + 1, bodyW.lastIndexOf("'")));
const file = path.join(SITE, 'bases.sql'), raw = fs.readFileSync(file, 'utf8'), eol = raw.includes('\r\n') ? '\r\n' : '\n';
let sql = raw.replace(/\r\n/g, '\n');
for (const [fn, b] of [['base_defs', bodyB], ['war_defs', bodyW]]) {
  const head = `create or replace function public.${fn}() returns jsonb language sql immutable as $$\n`;
  const a = sql.indexOf(head), e = sql.indexOf('\n$$;', a);
  if (a < 0 || e < 0) throw new Error(`в bases.sql не найдено ${fn}()`);
  sql = sql.slice(0, a + head.length) + b + sql.slice(e);
}
const cur = raw.replace(/\r\n/g, '\n');
if (check) { const same = sql === cur; console.log(same ? 'bases.sql: base_defs() и war_defs() совпадают с mir-base.js' : 'bases.sql: каталоги УСТАРЕЛИ — node scripts/gen-base-defs.cjs'); process.exit(same ? 0 : 1); }
fs.writeFileSync(file, eol === '\n' ? sql : sql.replace(/\n/g, eol));
console.log('bases.sql: base_defs() и war_defs() пересобраны из mir-base.js');
