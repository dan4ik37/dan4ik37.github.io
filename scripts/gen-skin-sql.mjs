// Цены частей персонажа, VIP-части и слоты char_save в coins.sql — из js/core/avatar.js (PARTS — один источник правды).
// Запуск: node scripts/gen-skin-sql.mjs (из корня репозитория). Потом — тест PGlite (сверяет все цены) и «запусти coins.sql ещё раз».
import fs from 'fs';
import vm from 'vm';
const win = {};
vm.runInNewContext(fs.readFileSync('js/core/avatar.js', 'utf8'), { window: win, document: {}, localStorage: { getItem: () => null }, console });
const C = win.D37Char, P = C.PARTS;
const rows = [], vip = [];
for (const slot of C.SLOTS) for (const [id, , price, , isVip] of P[slot].list) {
  rows.push(`('skin:${slot}:${id}', ${price})`);
  if (isVip) vip.push(`'skin:${slot}:${id}'`);
}
const lines = [];
for (let i = 0; i < rows.length; i += 5) lines.push('      ' + rows.slice(i, i + 5).join(', ') + (i + 5 < rows.length ? ',' : ''));
const pal = C.SLOTS.filter(s => P[s].pal);
let sql = fs.readFileSync('coins.sql', 'utf8');
const a = sql.indexOf("    when p_item like 'skin:%' then (select v.p from (values\n");
const b = sql.indexOf('    ) v(i, p) where v.i = p_item)');
if (a < 0 || b < 0) throw new Error('coin_price: не нашёл список цен');
sql = sql.slice(0, a) + "    when p_item like 'skin:%' then (select v.p from (values\n" + lines.join('\n') + '\n' + sql.slice(b);
sql = sql.replace(/  select p_item in \([^)]*\)\n\$\$;/, () => `  select p_item in (${vip.join(', ')})\n$$;`);
const loop = /  foreach slot in array array\[[^\]]*\] loop\n/;
if (!loop.test(sql)) throw new Error('char_save: не нашёл цикл по слотам');
sql = sql.replace(loop, () => `  foreach slot in array array[${C.SLOTS.map(s => `'${s}'`).join(', ')}] loop\n`);
sql = sql.replace(/and slot = any\(array\[[^\]]*\]\) then clean/, () => `and slot = any(array[${pal.map(s => `'${s}'`).join(', ')}]) then clean`);
fs.writeFileSync('coins.sql', sql);
console.log(`${rows.length} частей, ${C.SLOTS.length} слотов, палитра: ${pal.length}; VIP: ${vip.join(', ')}`);
