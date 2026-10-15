// Цены частей персонажа и пакетов частей тела, VIP-части и слоты char_save в coins.sql — из js/core/avatar.js
// (PARTS и PACKS — один источник правды), части «за уровень» — coin_level_item. Запуск: node scripts/gen-skin-sql.mjs (из корня репозитория).
// Потом — node scripts/char-test.cjs (сверяет coins.sql с PARTS), тест PGlite (сверяет все цены на базе) и «запусти coins.sql ещё раз».
import fs from 'fs';
import vm from 'vm';
const win = {};
vm.runInNewContext(fs.readFileSync('js/core/avatar.js', 'utf8'), { window: win, document: {}, localStorage: { getItem: () => null }, console });
const C = win.D37Char, P = C.PARTS;
const rows = [], vip = [], gems = [], lvls = [];
for (const slot of C.SLOTS) for (const [id, , price, , isVip, gemPrice, lvl, ref] of P[slot].list) {
  // за приглашения друзей (8-е поле) — не продаётся: цены нет, char_save надевает выданное (referrals2.sql кладёт в coin_wallet.items)
  if (ref) continue;
  // только за 💎 — цены в монетах нет (coins_buy откажет), char_save наденет купленное в магазине
  if (gemPrice) { gems.push(`'skin:${slot}:${id}'`); continue; }
  rows.push(`('skin:${slot}:${id}', ${price})`);
  if (isVip) vip.push(`'skin:${slot}:${id}'`);
  // «за уровень» (7-е поле): цена 0, char_save надевает с этого уровня (coin_level_item)
  if (lvl) lvls.push(`('skin:${slot}:${id}', ${lvl})`);
}
// пакеты частей тела: купил пакет — все его части (char_save сверяет владение по пакету)
for (const [id, [, price, isVip, gemPrice]] of Object.entries(C.PACKS)) {
  if (gemPrice) { gems.push(`'skin:pack:${id}'`); continue; }
  rows.push(`('skin:pack:${id}', ${price})`);
  if (isVip) vip.push(`'skin:pack:${id}'`);
}
const lines = [];
for (let i = 0; i < rows.length; i += 5) lines.push('      ' + rows.slice(i, i + 5).join(', ') + (i + 5 < rows.length ? ',' : ''));
const pal = C.SLOTS.filter(s => P[s].pal), packSlots = C.SLOTS.filter(s => P[s].pack);
// концы строк: на Windows файл может быть с \r\n (git autocrlf) — работаем с \n и возвращаем как было
const raw = fs.readFileSync('coins.sql', 'utf8'), crlf = raw.includes('\r\n');
let sql = raw.replace(/\r\n/g, '\n');
const a = sql.indexOf("    when p_item like 'skin:%' then (select v.p from (values\n");
const b = sql.indexOf('    ) v(i, p) where v.i = p_item)');
if (a < 0 || b < 0) throw new Error('coin_price: не нашёл список цен');
sql = sql.slice(0, a) + "    when p_item like 'skin:%' then (select v.p from (values\n" + lines.join('\n') + '\n' + sql.slice(b);
const vipRe = /(coin_vip_item\(p_item text\) returns boolean language sql immutable as \$\$\n  select p_item in \()[^)]*(\)\n\$\$;)/;
const gemsRe = /(coin_gems_item\(p_item text\) returns boolean language sql immutable as \$\$\n  select p_item in \()[^)]*(\)\n\$\$;)/;
if (!vipRe.test(sql) || !gemsRe.test(sql)) throw new Error('не нашёл coin_vip_item / coin_gems_item');
sql = sql.replace(vipRe, (m, a, b) => a + vip.join(', ') + b);
sql = sql.replace(gemsRe, (m, a, b) => a + (gems.length ? gems.join(', ') : "''") + b);
const lvlRe = /(coin_level_item\(p_item text\) returns int language sql immutable as \$\$\n  select v\.l from \(values )[^\n]*(\) v\(i, l\) where v\.i = p_item\n\$\$;)/;
if (!lvlRe.test(sql)) throw new Error('не нашёл coin_level_item');
sql = sql.replace(lvlRe, (m, a, b) => a + (lvls.length ? lvls.join(', ') : "('', 0)") + b);
const loop = /  foreach slot in array array\[[^\]]*\] loop\n/;
if (!loop.test(sql)) throw new Error('char_save: не нашёл цикл по слотам');
sql = sql.replace(loop, () => `  foreach slot in array array[${C.SLOTS.map(s => `'${s}'`).join(', ')}] loop\n`);
sql = sql.replace(/and slot = any\(array\[[^\]]*\]\) then clean/, () => `and slot = any(array[${pal.map(s => `'${s}'`).join(', ')}]) then clean`);
const packRe = /if slot = any\(array\[[^\]]*\]\) and public\.coin_price\('skin:pack:' \|\| val\) is not null then/;
if (!packRe.test(sql)) throw new Error('char_save: не нашёл строку пакетов');
sql = sql.replace(packRe, () => `if slot = any(array[${packSlots.map(s => `'${s}'`).join(', ')}]) and public.coin_price('skin:pack:' || val) is not null then`);
fs.writeFileSync('coins.sql', crlf ? sql.replace(/\n/g, '\r\n') : sql);
console.log(`${rows.length} цен (частей и пакетов), ${C.SLOTS.length} слотов, палитра: ${pal.length}, части из пакетов: ${packSlots.length}; VIP: ${vip.join(', ')}; только за 💎: ${gems.join(', ')}; за уровень: ${lvls.join(', ')}`);
