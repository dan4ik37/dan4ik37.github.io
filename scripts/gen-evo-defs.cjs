// Каталог «Пути от микроба» для сервера: evo_defs0() в evo.sql = D37Evo.SERVER из js/games/evo.js (одно место для чисел).
// Запуск из корня сайта: node scripts/gen-evo-defs.cjs          — переписать блок между метками gen:evo-defs в evo.sql
//                         node scripts/gen-evo-defs.cjs --check  — только сверить (код 1, если evo.sql устарел)
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const check = process.argv.includes('--check');
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/games/evo.js'), 'utf8'), { filename: 'evo.js' });
const E = globalThis.D37Evo;
const json = JSON.stringify(E.SERVER).replace(/'/g, "''");
const block = `-- gen:evo-defs:begin
create or replace function public.evo_defs0() returns jsonb language sql immutable as $$
  select '${json}'::jsonb
$$;
-- gen:evo-defs:end`;
const file = path.join(ROOT, 'evo.sql');
const sql = fs.readFileSync(file, 'utf8');
const eol = sql.includes('\r\n') ? '\r\n' : '\n';   // на Windows файл может прийти с CRLF — пишем тем же переводом строк
const re = /-- gen:evo-defs:begin[\s\S]*?-- gen:evo-defs:end/;
if (!re.test(sql)) { console.log('FAIL: в evo.sql нет меток gen:evo-defs'); process.exit(1); }
const out = sql.replace(re, () => block.replace(/\n/g, eol));
const lf = t => t.replace(/\r\n/g, '\n');
if (check) {
  if (lf(out) !== lf(sql)) { console.log('FAIL: evo.sql устарел — node scripts/gen-evo-defs.cjs'); process.exit(1); }
  console.log('evo_defs0: актуален (' + json.length + ' байт)');
} else {
  fs.writeFileSync(file, out);
  console.log('evo_defs0: записан (' + json.length + ' байт)');
}
