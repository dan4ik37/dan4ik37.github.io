// Блоки статей форума для браузера: js/features/forum-blocks.js — ТОТ ЖЕ код, что у серверных страниц (api/_lib/forum-blocks.js,
// makeForumBlocks.toString()). Поменял api/_lib/forum-blocks.js → node scripts/make-forum-blocks.mjs.
// --check — только проверить, что копия свежая (так делает scripts/forum-test.cjs).
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const SITE = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { makeForumBlocks } = await import(pathToFileURL(path.join(SITE, 'api/_lib/forum-blocks.js')).href);
const out = `// АВТОМАТИЧЕСКИ из api/_lib/forum-blocks.js (node scripts/make-forum-blocks.mjs) — руками не править: страницы форума на сервере — этим же кодом.
(function(){
  var root = typeof window !== 'undefined' ? window : globalThis;
  var makeForumBlocks = ${makeForumBlocks.toString()};
  root.D37ForumBlocks = makeForumBlocks();
})();
`.replace(/\r\n/g, '\n');
const file = path.join(SITE, 'js/features/forum-blocks.js');
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
  const same = cur === out;
  console.log(same ? 'js/features/forum-blocks.js — свежая копия' : 'js/features/forum-blocks.js УСТАРЕЛ — node scripts/make-forum-blocks.mjs');
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(file, out);
console.log('js/features/forum-blocks.js собран из api/_lib/forum-blocks.js');
