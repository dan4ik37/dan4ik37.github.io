// Проверка «SQL применён?» с сервера гостем (скилл .claude/skills/d37-sql-verify; docs/areas/sql-history.md).
// Адрес и publishable-ключ (публичный, как в браузере) берутся из js/features/chat.js — ключ никуда не печатается.
// Запуск из корня сайта:
//   node scripts/sql-rest.cjs world_now '{}' game_win_xp '{"p_game":"tiles"}'   — POST /rest/v1/rpc/<функция> с телом JSON
//   node scripts/sql-rest.cjs table:cloud_saves                                  — GET /rest/v1/<таблица>?select=*&limit=0
// Печатает строку на проверку: имя → HTTP-код и начало ответа. PGRST202 (функции нет) / PGRST205 (таблицы нет) = файл НЕ применён.
// Код выхода: 0 — всё есть, 2 — чего-то нет (не применено), 1 — сеть / ошибка запуска.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'features', 'chat.js'), 'utf8');
const URL0 = (/const SB_URL = '([^']+)'/.exec(src) || [])[1], KEY = (/const SB_KEY = '([^']+)'/.exec(src) || [])[1];
if (!URL0 || !KEY) { console.log('нет SB_URL / SB_KEY в js/features/chat.js'); process.exit(1); }
if (!/^sb_publishable_|^eyJ/.test(KEY)) { console.log('ключ в chat.js не похож на publishable — стоп'); process.exit(1); }
const args = process.argv.slice(2), jobs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('table:')) { jobs.push({ table: args[i].slice(6) }); continue; }
  const fn = args[i];
  let body = '{}';
  if (i + 1 < args.length && /^\s*[{[]/.test(args[i + 1])) body = args[++i];
  try { JSON.parse(body); } catch (e) { console.log(`${fn}: тело не JSON: ${body}`); process.exit(1); }
  jobs.push({ fn, body });
}
if (!jobs.length) { console.log("usage: node scripts/sql-rest.cjs <rpc> ['{json}'] … | table:<name>"); process.exit(1); }
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Accept: 'application/json' };
(async () => {
  let missing = 0, failed = 0;
  for (const j of jobs) {
    const name = j.fn ? 'rpc/' + j.fn : 'table ' + j.table;
    if (!/^[a-z_0-9]+$/.test(j.fn || j.table)) { console.log(`${name}: недопустимое имя`); failed++; continue; }
    try {
      const r = j.fn ? await fetch(`${URL0}/rest/v1/rpc/${j.fn}`, { method: 'POST', headers: H, body: j.body })
        : await fetch(`${URL0}/rest/v1/${j.table}?select=*&limit=0`, { headers: H });
      const t = (await r.text()).replace(/\s+/g, ' ').slice(0, 240);
      const gone = /PGRST202|PGRST205|Could not find the (function|table)/.test(t);
      if (gone) missing++;
      console.log(`${name} ${j.body || ''} → ${r.status} ${t}${gone ? '   ← НЕ применён' : ''}`);
    } catch (e) { failed++; console.log(`${name}: сеть: ${e.message}`); }
  }
  console.log(`итог: ${jobs.length} проверок, нет на сервере: ${missing}, ошибок сети: ${failed}`);
  process.exit(failed ? 1 : missing ? 2 : 0);
})();
