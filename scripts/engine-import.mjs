// engine-import.mjs — новая сборка движка D37 (Rust → wasm) на сайт: папка dist/web движка + его web/engine-host.js → d37/ сайта
// (её открывают и тестовая страница /d37/, и раздел /hub — js/features/hub.js, HUB_ENGINE в js/core/config.js) и d37/build.json:
// { id — первые 10 знаков sha256 (wasm + js), bridge — версия моста, wasm_raw — размер wasm без сжатия (полоса загрузки), files }.
// Только Node, без зависимостей. Запуск: node scripts/engine-import.mjs [папка движка, по умолчанию M:/d37/d37-engine]
// Репозиторий сайта ПУБЛИЧНЫЙ, каждый wasm остаётся в истории — только релизные сборки (pack.cmd), не чаще раза в день.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = path.resolve(process.argv[2] || 'M:/d37/d37-engine');
const dist = path.join(engine, 'dist', 'web');
const out = path.join(site, 'd37');
const die = (m) => { console.error('engine-import: ' + m); process.exit(1); };
for (const f of ['d37_web.js', 'd37_web_bg.wasm', 'd37-page.js', 'd37-terrain-worker.js', 'index.html', 'LICENSES.txt']) if (!fs.existsSync(path.join(dist, f))) die(`${dist}/${f} нет — сначала pack.cmd в движке`);
const hostSrc = [path.join(dist, 'engine-host.js'), path.join(engine, 'web', 'engine-host.js')].find((f) => fs.existsSync(f));
if (!hostSrc) die('нет web/engine-host.js в движке (мост v1)');
const glue = fs.readFileSync(path.join(dist, 'd37_web.js'), 'utf8');
if (!/export function bridge_version\b/.test(glue) || !/host_in\(/.test(glue)) die('в сборке нет моста v1 (bridge_version / host_in) — это старая сборка');
const wasm = fs.readFileSync(path.join(dist, 'd37_web_bg.wasm'));
// owner-side limit is load time; 14.11 coordinator raised for w12 content (was 16 MiB); binaryen wasm-opt would need the owner yes
if (wasm.length > 24 * 1048576) die(`wasm ${wasm.length} байт — больше 24 МБ, так не выкладываем`);

fs.mkdirSync(path.join(out, 'scenes'), { recursive: true });
const copied = {};
const copy = (from, rel) => { fs.copyFileSync(from, path.join(out, rel)); copied[rel] = fs.statSync(from).size; };
for (const f of fs.readdirSync(dist)) if (fs.statSync(path.join(dist, f)).isFile()) copy(path.join(dist, f), f);
for (const f of fs.readdirSync(path.join(dist, 'scenes'))) copy(path.join(dist, 'scenes', f), 'scenes/' + f);
copy(hostSrc, 'engine-host.js');
// тестовая страница открывается и как /d37 (без «/» в конце): свои файлы она ищет относительно <base href="/d37/">
const idx = path.join(out, 'index.html');
let html = fs.readFileSync(idx, 'utf8');
if (!/<base href=/.test(html)) { html = html.replace(/(<meta charset="utf-8">\r?\n)/, '$1<base href="/d37/">\n'); fs.writeFileSync(idx, html); }
const id = crypto.createHash('sha256').update(wasm).update(glue).update(fs.readFileSync(hostSrc)).digest('hex').slice(0, 10);
const bridge = +((/export const BRIDGE = (\d+)/.exec(fs.readFileSync(hostSrc, 'utf8')) || [])[1] || 0);
// T-166: таблица ключей настроек этой сборки — d37-config/keys.json (её читает scripts/engine-config-test.cjs) и справочник
// d37-config/REFERENCE.md; оба делает сам wasm (config_dump_json / config_dump_md), руками не правим. Сборка без EP14-config — пропуск.
// Все игры переходят на новый движок этим одним импортом в d37/ (их файлы в /d37-config/ не трогаются); вернуть одну игру — строка
// "engine": { "channel": "preview" } или { "build": "<id>" } в её /d37-config/games/<id>.json (docs/D37_CONFIG.md).
let configBuild = 0;
if (/export function config_dump_json\b/.test(glue)) {
  const { pathToFileURL } = await import('node:url');
  const mod = await import(pathToFileURL(path.join(out, 'd37_web.js')).href);
  await mod.default({ module_or_path: wasm });
  const table = mod.config_dump_json();
  configBuild = JSON.parse(table).build | 0;
  const cfgDir = path.join(site, 'd37-config');
  fs.mkdirSync(path.join(cfgDir, 'games'), { recursive: true });
  fs.writeFileSync(path.join(cfgDir, 'keys.json'), table);
  fs.writeFileSync(path.join(cfgDir, 'REFERENCE.md'), mod.config_dump_md());
  console.log(`engine-import: d37-config/keys.json и REFERENCE.md — таблица ключей поколения ${configBuild}`);
}
const info = { id, bridge, config_build: configBuild, wasm_raw: wasm.length, made: new Date().toISOString(), files: copied };
fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify(info, null, 1) + '\n');
console.log(`engine-import: d37/ ← ${dist} (id ${id}, мост v${bridge}, wasm ${(wasm.length / 1048576).toFixed(2)} МБ, файлов ${Object.keys(copied).length})`);
