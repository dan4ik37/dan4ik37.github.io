// Собирает по api/_lib/errlog.js (единственный исходник мониторинга ошибок, T-016):
//   • js/core/errlog.js — этап 2 (подгружается этапом 1 при первой ошибке);
//   • блок этапа 1 в <head> index.html между метками errlog:begin / errlog:end (нет меток — вставит после скрипта auth-guard).
// Запуск из корня сайта после любой правки api/_lib/errlog.js:  node scripts/make-errlog.mjs        (--check — только проверить, код 1 = устарело)
// Серверные страницы берут этап 1 прямо из api/_lib/errlog.js (ERR_HEAD) — им ничего пересобирать не надо.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const eolOf = s => (s.includes('\r\n') ? '\r\n' : '\n');
const lf = s => s.replace(/\r\n/g, '\n');

// api/ — во временную папку как ES-модули (в корне сайта package.json без "type": "module")
const tmp = fs.mkdtempSync(path.join(process.env.D37_TMP || os.tmpdir(), 'd37-errlog-'));
let stale = 0;
try {
  fs.cpSync(path.join(ROOT, 'api'), path.join(tmp, 'api'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  const M = await import(pathToFileURL(path.join(tmp, 'api/_lib/errlog.js')).href);

  // 1) js/core/errlog.js
  const jsFile = 'js/core/errlog.js';
  const have = fs.existsSync(path.join(ROOT, jsFile)) ? read(jsFile) : null;
  if (have === null || lf(have) !== M.ERR_FILE) {
    stale++;
    if (CHECK) console.log('УСТАРЕЛ', jsFile);
    else { fs.writeFileSync(path.join(ROOT, jsFile), M.ERR_FILE); console.log('записан', jsFile, `(${M.ERR_FILE.length} знаков, версия ${M.ERR_VER})`); }
  } else console.log('свежий ', jsFile);

  // 2) index.html
  const htmlFile = 'index.html';
  const html = read(htmlFile), eol = eolOf(html);
  const block = M.ERR_BLOCK.split('\n').join(eol);
  const i = html.indexOf('<!-- errlog:begin'), j = html.indexOf(M.ERR_END);
  let out;
  if (i >= 0 && j > i) out = html.slice(0, i) + block + html.slice(j + M.ERR_END.length);
  else {
    // первый раз: после скрипта, который стирает токены из адреса (до Метрики и рекламы), перед <link rel="manifest">
    const at = html.indexOf('<link rel="manifest"');
    if (at < 0) throw new Error('в index.html нет <link rel="manifest"> — некуда вставить блок');
    out = html.slice(0, at) + block + eol + html.slice(at);
  }
  if (out !== html) {
    stale++;
    if (CHECK) console.log('УСТАРЕЛ', htmlFile);
    else { fs.writeFileSync(path.join(ROOT, htmlFile), out); console.log('записан', htmlFile); }
  } else console.log('свежий ', htmlFile);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (CHECK && stale) process.exit(1);
