// engine-config-test.cjs — T-166: файлы настроек движка (/d37-config) нельзя выложить сломанными.
// Проверяет каждый d37-config/engine.json и d37-config/games/*.json тем же кодом, что и движок: если в d37/d37_web.js есть
// config_check (сборка с EP14-config) — самим wasm движка; иначе — по таблице ключей d37-config/keys.json (её делает
// `d37 config dump --json`, обновляет scripts/engine-import.mjs) по тем же правилам (crates/d37-app/src/config.rs).
// Файл не проходит, если: не JSON, нет "format": 1, сборка вне min_build..max_build, неизвестный ключ, не число, число вне диапазона,
// неизвестное поле. Файл игры ещё: id = имя файла, engine.channel — stable / preview, engine.build — id сборки, сцена есть в d37/scenes.
// И сам проверяющий проверен: заведомо плохие примеры должны падать. Запуск: node scripts/engine-config-test.cjs [--engine <папка сборки>]
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'd37-config');
let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.error('FAIL ' + msg); } };

const FIELDS = ['format', 'min_build', 'max_build', 'note', 'values', 'id', 'title', 'scene', 'engine', 'texts', 'game'];
function jsCheck(table, text) {
  const warn = [];
  let v;
  try { v = JSON.parse(text); } catch (e) { return { ok: false, skipped: 'не JSON: ' + e.message, warn }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, skipped: 'не объект', warn };
  if (v.format !== table.format) return { ok: false, skipped: 'format ' + v.format, warn };
  const int = (x) => x === undefined || x === null || (Number.isInteger(x) && x >= 0);
  if (!int(v.min_build) || !int(v.max_build)) return { ok: false, skipped: 'min_build / max_build — целые', warn };
  if (v.min_build != null && table.build < v.min_build) return { ok: false, skipped: 'min_build ' + v.min_build, warn };
  if (v.max_build != null && table.build > v.max_build) return { ok: false, skipped: 'max_build ' + v.max_build, warn };
  for (const f of Object.keys(v)) if (!FIELDS.includes(f)) warn.push('неизвестное поле ' + f);
  const vals = v.values == null ? {} : v.values;
  if (typeof vals !== 'object' || Array.isArray(vals)) return { ok: false, skipped: 'values — объект', warn };
  for (const [k, x] of Object.entries(vals)) {
    const key = table.keys.find((t) => t.key === k);
    if (!key) { warn.push(k + ': нет такого ключа'); continue; }
    if (x && typeof x === 'object' && typeof x.expr === 'string') { warn.push(k + ': expr зарезервировано'); continue; }
    if (typeof x !== 'number' || !isFinite(x)) { warn.push(k + ': не число'); continue; }
    if (x < key.min || x > key.max) warn.push(k + ': ' + x + ' вне ' + key.min + ' .. ' + key.max);
  }
  return { ok: warn.length === 0, skipped: '', warn };
}

(async () => {
  const table = JSON.parse(fs.readFileSync(path.join(dir, 'keys.json'), 'utf8'));
  ok(table.format === 1 && Number.isInteger(table.build) && Array.isArray(table.keys) && table.keys.length >= 40, 'keys.json: таблица ключей (format, build, keys)');
  ok(table.keys.some((k) => k.kind === 'RULE') && table.keys.some((k) => k.kind === 'LOOK'), 'keys.json: есть LOOK и RULE');
  // движок сам, если сборка уже умеет
  let check = (name, text) => jsCheck(table, text), how = 'keys.json';
  // --engine <папка сборки> — проверить другой сборкой (по умолчанию d37/ сайта)
  const ei = process.argv.indexOf('--engine');
  const engDir = ei > 0 ? path.resolve(process.argv[ei + 1]) : path.join(root, 'd37');
  const glue = path.join(engDir, 'd37_web.js');
  if (fs.existsSync(glue) && /export function config_check\b/.test(fs.readFileSync(glue, 'utf8'))) {
    const mod = await import(pathToFileURL(glue).href);
    await mod.default({ module_or_path: fs.readFileSync(path.join(engDir, 'd37_web_bg.wasm')) });
    check = (name, text) => JSON.parse(mod.config_check(name, text));
    how = 'wasm движка';
    const wasmTable = JSON.parse(mod.config_dump_json());
    ok(JSON.stringify(wasmTable.keys.map((k) => k.key)) === JSON.stringify(table.keys.map((k) => k.key)), 'keys.json совпадает с таблицей движка в d37/ (обнови: node scripts/engine-import.mjs)');
  }
  // проверяющий ловит плохое (и тем же кодом, и запасным)
  const bad = ['{', '[]', '{"values":{}}', '{"format":2}', '{"format":1,"min_build":99999}', '{"format":1,"values":{"nope":1}}', '{"format":1,"values":{"rim":"x"}}', '{"format":1,"values":{"rim":99}}', '{"format":1,"colour":1}', '{"format":1,"values":{"rim":{"expr":"t"}}}'];
  for (const b of bad) { ok(!check('bad', b).ok, how + ': плохой пример прошёл: ' + b); ok(!jsCheck(table, b).ok, 'keys.json: плохой пример прошёл: ' + b); }
  ok(check('good', '{"format":1,"values":{"rim":1,"hunger_days":3}}').ok, how + ': хороший пример не прошёл');
  // все файлы
  const files = [path.join(dir, 'engine.json')].concat(fs.readdirSync(path.join(dir, 'games')).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, 'games', f)));
  ok(fs.existsSync(files[0]), 'd37-config/engine.json есть');
  for (const f of files) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    const text = fs.readFileSync(f, 'utf8');
    const r = check(rel, text);
    ok(r.ok, rel + ': ' + (r.skipped || (r.warn || []).join('; ')));
    if (rel.includes('/games/')) {
      let g = {}; try { g = JSON.parse(text); } catch (e) { /* выше */ }
      const id = path.basename(f, '.json');
      ok(/^[a-z0-9_-]{1,32}$/.test(id) && g.id === id, rel + ': id = имя файла');
      const e = g.engine || {};
      ok(e.channel === undefined || e.channel === 'stable' || e.channel === 'preview', rel + ': engine.channel — stable или preview');
      ok(e.build === undefined || /^[0-9a-f]{6,16}$/.test(String(e.build)), rel + ': engine.build — id сборки (hex)');
      ok(!g.scene || fs.existsSync(path.join(root, 'd37', 'scenes', g.scene + '.ron')), rel + ': сцена ' + g.scene + ' есть в d37/scenes');
    }
  }
  // справочник сделан из той же таблицы
  const ref = fs.existsSync(path.join(dir, 'REFERENCE.md')) ? fs.readFileSync(path.join(dir, 'REFERENCE.md'), 'utf8') : '';
  ok(table.keys.every((k) => ref.includes('`' + k.key + '`')), 'd37-config/REFERENCE.md: все ключи (d37 config dump --md)');
  // хаб (js/features/hub.js в песочнице): целое сохранение отличает от пустого / обрезанного / испорченного; канал и закреплённая
  // сборка игры выбирают папку движка
  {
    const vm = require('vm');
    const files = {
      '/d37/build.json': '{"id":"aaaaaa1111","bridge":1}', '/d37-preview/build.json': '{"id":"bbbbbb2222","bridge":1}',
      '/d37-config/games/valley.json': '{"format":1,"id":"valley","engine":{"channel":"stable"}}',
      '/d37-config/games/creative.json': '{"format":1,"id":"creative","engine":{"channel":"preview"}}',
      '/d37-config/games/klet.json': '{"format":1,"id":"klet","engine":{"build":"bbbbbb2222"}}',
      '/d37-config/games/wardrobe.json': '{"format":1,"id":"wardrobe","engine":{"build":"cccccc3333"}}',
    };
    const reports = [];
    const ctx = { console, setTimeout, clearTimeout, Math, JSON, Uint8Array, Promise, HUB_ENGINE: '/d37/',
      fetch: async (u) => { const t = files[String(u).split('?')[0]]; return { ok: t != null, status: t != null ? 200 : 404, text: async () => t, json: async () => JSON.parse(t) }; },
      d37Err: (w, e) => reports.push(w + ': ' + (e && e.message)) };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'features', 'hub.js'), 'utf8'), ctx);
    const H = ctx.D37Hub;
    const fnv = (b) => { let h = 0x811c9dc5; for (const c of b) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h; };
    const body = [68, 51, 55, 83, 1, 0, 0, 0, 9, 9, 9, 9];
    const sum = fnv(body), save = new Uint8Array(body.concat([sum & 255, sum >>> 8 & 255, sum >>> 16 & 255, sum >>> 24]));
    ok(H.okSave(save), 'hub okSave: целое сохранение D37S принимается');
    ok(!H.okSave(new Uint8Array(0)) && !H.okSave(save.slice(0, 12)) && !H.okSave(null), 'hub okSave: пустое / обрезанное не пишется');
    const broken = save.slice(); broken[9] ^= 1;
    ok(!H.okSave(broken), 'hub okSave: испорченное (контрольная сумма) не пишется');
    const v = await H.resolveGame('valley'), cr = await H.resolveGame('creative'), kl = await H.resolveGame('klet'), wr = await H.resolveGame('wardrobe'), none = await H.resolveGame('nope');
    ok(v.base === '/d37/' && v.channel === 'stable' && v.build.id === 'aaaaaa1111' && v.text, 'hub resolveGame: stable — /d37/');
    ok(cr.base === '/d37-preview/' && cr.channel === 'preview' && cr.build.id === 'bbbbbb2222', 'hub resolveGame: preview — /d37-preview/');
    ok(kl.base === '/d37-preview/' && kl.channel === 'pin' && kl.build.id === 'bbbbbb2222', 'hub resolveGame: закреплённая сборка найдена в preview');
    ok(wr.base === '/d37/' && /cccccc3333/.test(wr.note) && reports.some((r) => /pin/.test(r)), 'hub resolveGame: закреплённой сборки нет — stable и отчёт');
    ok(none.base === '/d37/' && none.text === null && none.channel === 'stable', 'hub resolveGame: игры без файла — stable, без слоя');
  }
  console.log(`engine-config-test: ${checks - fails}/${checks} ок (проверка: ${how}, файлов ${files.length})`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
