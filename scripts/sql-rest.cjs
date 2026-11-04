// Проверка «SQL применён?» с сервера гостем (скилл .claude/skills/d37-sql-verify; docs/areas/sql-history.md).
// Адрес и publishable-ключ (публичный, как в браузере) берутся из js/features/chat.js — ключ никуда не печатается.
// Запуск из корня сайта:
//   node scripts/sql-rest.cjs world_now '{}' game_win_xp '{"p_game":"tiles"}'   — POST /rest/v1/rpc/<функция> с телом JSON
//   node scripts/sql-rest.cjs table:cloud_saves                                  — GET /rest/v1/<таблица>?select=*&limit=0
// Печатает строку на проверку: имя → HTTP-код, ответ и вывод. PGRST202 (функции нет) / PGRST205 (таблицы нет) = файл НЕ применён,
// НО: PGRST202 с подсказкой «Perhaps you meant to call the function public.<та же функция>(…)» = функция ЕСТЬ, а имена аргументов
// в проверке неверные (поправь тело запроса, SQL заново не нужен). Подсказка печатается целиком. Без такой подсказки скрипт
// ещё раз смотрит GET /rest/v1/rpc/<функция> без параметров (только чтение) — так видна и функция без аргументов.
// Код выхода: 0 — всё есть, 2 — чего-то нет (не применено), 3 — функция есть, но аргументы проверки неверные, 1 — сеть / запуск.
const fs = require('fs'), path = require('path');

// ответ сервера → { kind: 'ok' | 'missing' | 'bad_args' | 'other', note }
function classify(name, isFn, status, text) {
  let j = null; try { j = JSON.parse(text); } catch (e) {}
  const code = j && j.code, hint = (j && j.hint) || '';
  if (isFn && code === 'PGRST202') {
    const same = new RegExp('\\bpublic\\.' + name + '\\s*\\(').test(hint);
    return same ? { kind: 'bad_args', note: 'функция ЕСТЬ, аргументы неверные — ' + hint } : { kind: 'missing', note: 'НЕ применён' + (hint ? ' (' + hint + ')' : '') };
  }
  if (!isFn && code === 'PGRST205') return { kind: 'missing', note: 'НЕ применён' + (hint ? ' (' + hint + ')' : '') };
  if (/Could not find the (function|table)/.test(text)) return { kind: 'missing', note: 'НЕ применён' };
  if (status >= 200 && status < 300) return { kind: 'ok', note: 'есть' };
  if (code === '42501') return { kind: 'ok', note: 'есть, закрыто для гостя (часто так задумано)' };
  return { kind: 'other', note: 'проверь ответ' };
}
// Второй взгляд, когда POST дал PGRST202 без подсказки про ту же функцию (например, функции без аргументов передали лишний):
// GET /rest/v1/rpc/<fn> без параметров — PostgREST выполняет GET в транзакции ТОЛЬКО ДЛЯ ЧТЕНИЯ, записать ничего нельзя.
// Любой ответ, кроме PGRST202 без той же функции в подсказке, значит «функция есть».
function probeSays(name, status, text) {
  const c = classify(name, true, status, text);
  return c.kind === 'missing' ? 'missing' : 'exists';
}
module.exports = { classify, probeSays };

if (require.main === module) {
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
    let missing = 0, bad = 0, failed = 0;
    for (const j of jobs) {
      const name = j.fn ? 'rpc/' + j.fn : 'table ' + j.table;
      if (!/^[a-z_0-9]+$/.test(j.fn || j.table)) { console.log(`${name}: недопустимое имя`); failed++; continue; }
      try {
        const r = j.fn ? await fetch(`${URL0}/rest/v1/rpc/${j.fn}`, { method: 'POST', headers: H, body: j.body })
          : await fetch(`${URL0}/rest/v1/${j.table}?select=*&limit=0`, { headers: H });
        const raw = await r.text();
        let c = classify(j.fn || j.table, !!j.fn, r.status, raw);
        if (j.fn && c.kind === 'missing') {   // read-only GET without parameters: does the function exist with other arguments?
          const g = await fetch(`${URL0}/rest/v1/rpc/${j.fn}`, { headers: H });
          if (probeSays(j.fn, g.status, await g.text()) === 'exists') c = { kind: 'bad_args', note: `функция ЕСТЬ (GET без параметров → ${g.status}), аргументы проверки неверные` };
        }
        if (c.kind === 'missing') missing++; else if (c.kind === 'bad_args') bad++;
        const t = raw.replace(/\s+/g, ' ');
        console.log(`${name} ${j.body || ''} → ${r.status} ${t.length > 240 ? t.slice(0, 240) + '…' : t}   ← ${c.note}`);
      } catch (e) { failed++; console.log(`${name}: сеть: ${e.message}`); }
    }
    console.log(`итог: ${jobs.length} проверок, нет на сервере: ${missing}, неверные аргументы проверки: ${bad}, ошибок сети: ${failed}`);
    process.exit(failed ? 1 : missing ? 2 : bad ? 3 : 0);
  })();
}
