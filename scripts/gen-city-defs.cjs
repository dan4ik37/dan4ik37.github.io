// Каталог «Живого города» для сервера: city_defs0() в city.sql = MirEcon.SERVER из js/games/mir-econ.js (одно место для чисел).
// Запуск из корня сайта: node scripts/gen-city-defs.cjs          — переписать блок между метками gen:city-defs в city.sql
//                         node scripts/gen-city-defs.cjs --check  — только сверить (код 1, если city.sql устарел)
// Возраст «Большого города» в каталоге обязан совпадать с MirZones.ADULT_AGE (js/games/mir-zones.js) — сверяется здесь же.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const check = process.argv.includes('--check');
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/games/mir-econ.js'), 'utf8'), { filename: 'mir-econ.js' });
const M = globalThis.MirEcon;
// ADULT_AGE — без загрузки всего mir-zones.js (ему нужен движок): строка-константа
const zones = fs.readFileSync(path.join(ROOT, 'js/games/mir-zones.js'), 'utf8');
const adult = +(/const ADULT_AGE = (\d+);/.exec(zones) || [])[1];
if (!adult || M.SERVER.cities.metro.age !== adult) { console.log(`FAIL: возраст «Большого города» в каталоге (${M.SERVER.cities.metro.age}) ≠ MirZones.ADULT_AGE (${adult})`); process.exit(1); }
const json = JSON.stringify(M.SERVER).replace(/'/g, "''");
const block = `-- gen:city-defs:begin
create or replace function public.city_defs0() returns jsonb language sql immutable as $$
  select '${json}'::jsonb
$$;
-- gen:city-defs:end`;
const file = path.join(ROOT, 'city.sql');
const sql = fs.readFileSync(file, 'utf8');
const re = /-- gen:city-defs:begin[\s\S]*?-- gen:city-defs:end/;
if (!re.test(sql)) { console.log('FAIL: в city.sql нет меток gen:city-defs'); process.exit(1); }
const out = sql.replace(re, () => block);
if (check) {
  if (out !== sql) { console.log('FAIL: city.sql устарел — node scripts/gen-city-defs.cjs'); process.exit(1); }
  console.log('city_defs0: актуален (' + json.length + ' байт)');
} else {
  fs.writeFileSync(file, out);
  console.log('city_defs0: записан (' + json.length + ' байт)');
}
