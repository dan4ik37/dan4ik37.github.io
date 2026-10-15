// Собирает js/games/rules-data.js — правила игр для окна «📖 Правила» (js/games/gamekit.js) — из api/_lib/games-seo.js
// (там правила и советы для поиска; одни и те же тексты и на сайте, и в поиске). Поменял правила в games-seo.js или
// добавил игру — пересобери: node scripts/make-rules.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { GAME_PAGES } = await import(pathToFileURL(path.join(SITE, 'api/_lib/games-seo.js')).href);
const out = {};
for (const p of GAME_PAGES) {
  if (!p.rules?.length) continue;
  out[p.id] = { rt: p.rulesTitle || 'Как играть', rules: p.rules, tt: p.tipsTitle || 'Советы', tips: p.tips || [] };
}
const head = '// Правила игр для окна «📖 Правила» (js/games/gamekit.js). СОБРАНО: node scripts/make-rules.mjs из api/_lib/games-seo.js —\n'
  + '// правишь правила, правь там и пересобери (руками этот файл не менять).\n';
const body = 'window.GAME_RULES = ' + JSON.stringify(out, null, 0).replace(/},"/g, '},\n"') + ';\n';
fs.writeFileSync(path.join(SITE, 'js/games/rules-data.js'), head + body);
console.log('js/games/rules-data.js:', Object.keys(out).length, 'игр,', Buffer.byteLength(head + body), 'байт');
