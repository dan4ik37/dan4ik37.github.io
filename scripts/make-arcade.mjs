// Мини-игры (T-140, docs/ARCADE.md): собирает общие места сайта из карточек js/games/arcade/<id>.json — руками их не править.
//   js/features/games.js   — строки GAMES и GAME_TAGS между ⟦arcade⟧ и ⟦/arcade⟧
//   api/_lib/age.js        — GAME_AGE (все мини-игры 0+)
//   api/_lib/games-seo-arcade.js — целиком: страницы /games/<id> (поиск, sitemap, 📣 вызов) и подписи счёта
//   games-more.sql         — game_score_cap и game_win_xp (ключи <id> и <id>_duel) между ⟦arcade⟧ и ⟦/arcade⟧
//   img/games/_make-cards.py — строки картинок-превью (сами PNG: python -X utf8 img/games/_make-cards.py <id> …)
//   js/games/rules-data.js — окно «📖 Правила» (node scripts/make-rules.mjs, зовётся отсюда)
// Запуск из корня сайта:  node scripts/make-arcade.mjs          — собрать
//                         node scripts/make-arcade.mjs --check  — только проверить, что всё собрано (CI)
// Конфликт слияния внутри ⟦arcade⟧ … ⟦/arcade⟧ или в games-seo-arcade.js / rules-data.js: возьми любую сторону, запусти
// этот скрипт (он пересоберёт области из всех карточек) и добавь файлы в коммит.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(SITE, 'js/games/arcade');
const CHECK = process.argv.includes('--check');
const errs = [];

// ── карточки ──
const cards = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort().map(f => {
  let c;
  try { c = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { errs.push(`${f}: не JSON — ${e.message}`); return null; }
  const id = f.slice(0, -5), bad = m => errs.push(`${f}: ${m}`);
  if (c.id !== id) bad(`id «${c.id}» ≠ имя файла`);
  // id — ключ сервера: только латиница (game_family в economy.sql режет по «_» и цифрам на конце)
  if (!/^[a-z]{2,16}$/.test(id)) bad('id — 2–16 латинских строчных букв, без «_» и цифр');
  if (!fs.existsSync(path.join(DIR, id + '.js'))) bad(`нет js/games/arcade/${id}.js`);
  for (const k of ['icon', 'title', 'color', 'desc', 'tags']) if (typeof c[k] !== 'string' || !c[k].trim()) bad(`нет поля ${k}`);
  if (!/^#[0-9a-f]{6}$/i.test(c.color || '')) bad('color — #rrggbb');
  if (!(c.tags || '').split(' ').includes('mini')) bad('tags без «mini»');
  if (!Array.isArray(c.unit) || c.unit.length !== 3 || !c.unit.every(u => typeof u === 'string' && u)) bad('unit — три формы: ["очко", "очка", "очков"]');
  const S = c.server || {};
  for (const k of ['cap', 'capDuel']) if (!(Number.isInteger(S[k]) && S[k] > 0 && S[k] <= 10000000)) bad(`server.${k} — целое 1…10 000 000`);
  for (const k of ['xp', 'xpDuel']) if (!(Number.isInteger(S[k]) && S[k] >= 0 && S[k] <= 20)) bad(`server.${k} — целое 0…20 (как у похожих игр в game_win_xp)`);
  const P = c.seo || {};
  for (const k of ['title', 'h1', 'description', 'lead']) if (typeof P[k] !== 'string' || !P[k].trim()) bad(`нет seo.${k}`);
  for (const k of ['features', 'rules', 'tips']) if (!Array.isArray(P[k]) || !P[k].length) bad(`seo.${k} — непустой список`);
  if (!Array.isArray(P.faq) || !P.faq.every(x => Array.isArray(x) && x.length === 2)) bad('seo.faq — список пар [вопрос, ответ]');
  return c;
}).filter(Boolean);

const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n') + "'";
const qa = a => '[' + a.map(q).join(', ') + ']';
const SCRIPTS = id => ['js/games/room.js', 'js/games/versus.js', 'js/games/arcade/core.js', `js/games/arcade/${id}.js`];

// ── области ──
const regions = [
  { file: 'js/features/games.js', nth: 0, indent: '  ', lines: cards.map(c => `{ id: ${q(c.id)}, age: '0+', icon: ${q(c.icon)}, title: ${q(c.title)}, desc: ${q(c.desc)}, scripts: ${qa(SCRIPTS(c.id))}, top: ${q(c.id)}, topLabel: ${q(c.unit[2])}, unit: ${qa(c.unit)}, color: ${q(c.color)} },`) },
  { file: 'js/features/games.js', nth: 1, indent: '  ', lines: cards.map(c => `${c.id}: ${q(c.tags)},`) },
  { file: 'api/_lib/age.js', nth: 0, indent: '  ', lines: cards.map(c => `${c.id}: [0, ''],`) },
  { file: 'games-more.sql', nth: 0, indent: '    ', lines: cards.flatMap(c => c.server.cap === c.server.capDuel
      ? [`when p_game in ('${c.id}', '${c.id}_duel') then ${c.server.cap}`]
      : [`when p_game = '${c.id}' then ${c.server.cap}`, `when p_game = '${c.id}_duel' then ${c.server.capDuel}`]) },
  { file: 'games-more.sql', nth: 1, indent: '    ', lines: cards.map(c => `when '${c.id}' then ${c.server.xp} when '${c.id}_duel' then ${c.server.xpDuel}`) },
  { file: 'img/games/_make-cards.py', nth: 0, indent: '    ', lines: cards.map(c => `(${q(c.id)}, ${q(c.icon)}, ${q(c.title)}, ${q(c.color)}),`) },
];

const out = new Map();   // файл → новый текст
const read = f => out.get(f) ?? fs.readFileSync(path.join(SITE, f), 'utf8');
for (const R of regions) {
  const src = read(R.file);
  // n-я пара маркеров (⟦arcade⟧ … ⟦/arcade⟧); всё между ними (и любые следы конфликта) заменяется
  let from = 0, b = -1, e = -1;
  for (let i = 0; i <= R.nth; i++) {
    b = src.indexOf('⟦arcade⟧', from);
    if (b < 0) break;
    e = src.indexOf('⟦/arcade⟧', src.indexOf(String.fromCharCode(10), b));   // закрывающий — на одной из следующих строк
    from = e + 1;
  }
  if (b < 0 || e < 0) { errs.push(`${R.file}: нет маркеров ⟦arcade⟧ … ⟦/arcade⟧ №${R.nth + 1}`); continue; }
  const s0 = src.indexOf('\n', b) + 1, s1 = src.lastIndexOf('\n', e) + 1;
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  out.set(R.file, src.slice(0, s0) + R.lines.map(l => R.indent + l + nl).join('') + src.slice(s1));
}

// ── страницы для поиска (целиком) ──
const pages = cards.map(c => ({ id: c.id, icon: c.icon, name: c.title, ...c.seo }));
out.set('api/_lib/games-seo-arcade.js', '// Страницы /games/<id> мини-игр (T-140). СОБРАНО: node scripts/make-arcade.mjs из js/games/arcade/<id>.json — руками не править.\n'
  + 'export const ARCADE_PAGES = ' + JSON.stringify(pages, null, 2) + ';\n'
  + 'export const ARCADE_UNITS = ' + JSON.stringify(Object.fromEntries(cards.map(c => [c.id, c.unit]))) + ';\n');

if (errs.length) { for (const e of errs) console.log('✗', e); process.exit(1); }

let stale = 0;
for (const [f, txt] of out) {
  const p = path.join(SITE, f), old = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  // CRLF / LF не в счёт: на Windows git (autocrlf) отдаёт файлы с CRLF, в CI (Linux) — с LF
  const lf = x => x.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  if (old !== null && lf(old) === lf(txt)) continue;
  stale++;
  if (CHECK) console.log('✗ не собрано:', f);
  else fs.writeFileSync(p, txt);
}
// правила для окна «📖 Правила»
const rules = fs.readFileSync(path.join(SITE, 'js/games/rules-data.js'), 'utf8');
const noRules = cards.filter(c => !rules.includes(`"${c.id}":`));
if (CHECK) {
  if (noRules.length) console.log('✗ нет правил в js/games/rules-data.js:', noRules.map(c => c.id).join(', '));
  if (stale || noRules.length) { console.log('Запусти: node scripts/make-arcade.mjs'); process.exit(1); }
  console.log(`make-arcade: собрано, мини-игр: ${cards.length}`);
} else {
  const r = spawnSync(process.execPath, [path.join(SITE, 'scripts/make-rules.mjs')], { cwd: SITE, encoding: 'utf8' });
  if (r.status) { console.log(r.stdout, r.stderr); process.exit(1); }
  console.log(`make-arcade: мини-игр ${cards.length}, обновлено файлов: ${stale}; ${r.stdout.trim()}`);
  console.log('Картинки-превью новых игр: python -X utf8 img/games/_make-cards.py ' + cards.map(c => c.id).join(' '));
}
