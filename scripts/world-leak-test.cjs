// «Мир Денчика»: без утечек при закрытии и открытии (T-085) — проверки в node, без браузера. Что держало закрытый мир в памяти
// (каждый вход +25–30 МБ JS и +1 контекст WebGL; полная проверка в Chrome — scripts/world-reopen-e2e.cjs), здесь ловится заранее:
//  1) свои геттеры/сеттеры у объектов, которые создаются заново на каждый мир (get x(){} в объекте внутри функции,
//     Object.defineProperty(o, 'x', { get }) внутри функции, класс с геттерами внутри функции): V8 хранит такой геттер в общей
//     «форме» объекта (Map → DescriptorArray → AccessorPair), и после закрытия через него жил последний мир. Можно: геттер на
//     прототипе уровня модуля (class на уровне файла, Object.create(PROTO)) или обычное поле;
//  2) подписка на долгоживущий объект сайта (D37Age.on) без отписки — результат on() выброшен;
//  3) mir.js: слушатель на рамке игры (el — #gamesStageBox живёт дольше мира) снимается в cleanupUi; данные модуля (TABLES) не
//     получают вещей мира; mir-zones.js отпускает BUILT; render.js снимает «dispose» рендерера с общих на страницу вещей three
//     (геометрия спрайтов, карта погоды «что над головой» GFXU.occRT);
//  4) движок в node: E.loop, E.player, E.controls — после остановки ничто из модуля не держит мир (WeakRef + сборка мусора).
// Проверки по дереву JS (acorn из самого Node — перезапуск с --expose-internals, ставить ничего не надо).
// Запуск из корня сайта: node scripts/world-leak-test.cjs
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.env.SITE_DIR || path.join(__dirname, '..');   // SITE_DIR — другая копия сайта (проверить, что старый код ловится)
let acorn = null;
try { acorn = require('internal/deps/acorn/acorn/dist/acorn'); } catch (e) {}
if (!acorn || typeof global.gc !== 'function') {
  if (process.execArgv.includes('--expose-internals')) { console.log('world-leak-test: в этой версии Node нет встроенного acorn или --expose-gc'); process.exit(2); }
  const r = require('child_process').spawnSync(process.execPath, ['--expose-internals', '--expose-gc', ...process.execArgv, process.argv[1], ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 900)); } };
const read = f => fs.readFileSync(path.join(SITE, f), 'utf8');

// ═══ Какие файлы грузит мир: scripts записи 'world' в js/features/games.js (+ чат «🌍 Весь мир», он живёт вместе с миром) ═══
const gamesSrc = read('js/features/games.js');
const wi = gamesSrc.indexOf("id: 'world'"), ws = gamesSrc.indexOf('scripts: [', wi), we = gamesSrc.indexOf(']', ws);
const WORLD = wi > 0 && ws > 0 ? [...gamesSrc.slice(ws, we).matchAll(/'([^']+\.js)'/g)].map(m => m[1]) : [];
ok(WORLD.length > 20 && WORLD.includes('js/games/mir.js') && WORLD.includes('js/engine/render.js'), 'список скриптов мира прочитан из games.js', WORLD.length);
const FILES = [...new Set([...WORLD, 'js/features/worldchat.js'])].filter(f => fs.existsSync(path.join(SITE, f)));

// ═══ 1–2. Дерево JS: свои геттеры у объектов «на каждый мир», подписки без отписки ═══
// Исключения — с причиной (объект создаётся один раз на страницу, а не на каждый мир)
const ALLOW = {
  // 'файл:имя': 'почему можно'
};
function scan(file){
  const src = read(file), out = [];
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, locations: true }); }
  catch (e) { out.push({ file, line: e.loc?.line, what: 'не разобрался: ' + e.message }); return out; }
  const isFn = n => n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');
  const keyName = k => (k ? k.name || k.value || '?' : '?');
  const isAgeOn = c => {   // D37Age.on(…), root.D37Age?.on?.(…), window.D37Age.on(…)
    const cal = c.type === 'ChainExpression' ? c.expression : c;
    if (!cal || cal.type !== 'CallExpression') return false;
    const m = cal.callee; if (!m || m.type !== 'MemberExpression' || keyName(m.property) !== 'on') return false;
    const o = m.object; return (o.type === 'Identifier' && o.name === 'D37Age') || (o.type === 'MemberExpression' && keyName(o.property) === 'D37Age');
  };
  // обёртка файла (() => { … })() — это ещё «уровень модуля»: её тело создаётся один раз на страницу
  const wrappers = new Set();
  for (const st of ast.body) {
    let e = st.type === 'ExpressionStatement' ? st.expression : null;
    if (e?.type === 'UnaryExpression') e = e.argument;
    if (e?.type === 'CallExpression' && isFn(e.callee)) wrappers.add(e.callee);
  }
  (function walk(n, depth){
    if (!n || typeof n.type !== 'string') return;
    const d = isFn(n) && !wrappers.has(n) ? depth + 1 : depth;
    if (d > 0 && n.type === 'ObjectExpression') for (const p of n.properties) if (p.type === 'Property' && (p.kind === 'get' || p.kind === 'set')) out.push({ file, line: p.loc.start.line, what: `${p.kind} ${keyName(p.key)}() в объекте внутри функции` });
    if (d > 0 && n.type === 'ClassBody') for (const m of n.body) if (m.type === 'MethodDefinition' && (m.kind === 'get' || m.kind === 'set') && !m.static) out.push({ file, line: m.loc.start.line, what: `класс с ${m.kind} ${keyName(m.key)}() внутри функции` });
    if (d > 0 && n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && keyName(n.callee.property) === 'defineProperty' && keyName(n.callee.object) === 'Object') {
      const desc = n.arguments[2];
      if (desc?.type === 'ObjectExpression' && desc.properties.some(p => p.type === 'Property' && ['get', 'set'].includes(keyName(p.key)))) out.push({ file, line: n.loc.start.line, what: `Object.defineProperty(…, ${n.arguments[1]?.value ? "'" + n.arguments[1].value + "'" : '…'}, { get/set }) внутри функции` });
    }
    if (n.type === 'ExpressionStatement' && isAgeOn(n.expression)) out.push({ file, line: n.loc.start.line, what: 'D37Age.on(…) без отписки (результат выброшен)' });
    for (const k in n) { if (k === 'loc' || k === 'start' || k === 'end') continue; const v = n[k]; if (Array.isArray(v)) for (const x of v) walk(x, d); else if (v && typeof v.type === 'string') walk(v, d); }
  })(ast, 0);
  return out.filter(f => !ALLOW[f.file + ':' + f.what]);
}
const found = [];
for (const f of FILES) found.push(...scan(f));
ok(!found.length, `${FILES.length} файлов мира: ни своих геттеров у объектов «на каждый мир», ни подписок без отписки`, found.map(f => `${f.file}:${f.line} — ${f.what}`));

// ═══ 3. Точечные места, где держался прошлый мир ═══
const mir = read('js/games/mir.js'), mz = read('js/games/mir-zones.js'), rnd = read('js/engine/render.js'), war = read('js/games/mir-war.js');
ok(/el\.addEventListener\('click', onClick\)/.test(mir) && /el\.removeEventListener\('click', onClick\)/.test(mir), 'mir.js: слушатель «click» на рамке игры снимается при закрытии');
ok(!/\bt\.tag\s*=/.test(mir), 'mir.js: TABLES (данные модуля) не получают вещей мира (t.tag)');
ok(/BUILT = null/.test(mz.slice(mz.indexOf('rt.dispose = () =>'), mz.indexOf('rt.dispose = () =>') + 600)), 'mir-zones.js: rt.dispose отпускает BUILT');
ok(/rt\.offAge\?\.\(\)/.test(mz), 'mir-zones.js: отписка от D37Age при закрытии');
const rDisp = rnd.slice(rnd.indexOf('R.dispose = () =>'), rnd.indexOf('R.dispose = () =>') + 3000);
ok(/new T\.Sprite\(\)\.geometry\)\)\.dispose\(\)/.test(rDisp), 'render.js: R.dispose снимает «dispose» рендерера с общей геометрии спрайтов three');
ok(/E\.GFXU\?\.occRT\?\.dispose\(\)/.test(rDisp), 'render.js: R.dispose снимает «dispose» рендерера с общей карты «что над головой» (GFXU.occRT — в дождь и снег)');
ok(/for \(const f of \[\.\.\.R\.preRender\]\) f\.dispose/.test(rDisp), 'render.js: R.dispose обходит копию R.preRender (dispose крючка убирает его из списка)');
ok(/function openChannel\(shard\)/.test(mir) && !/async function join[\s\S]{0,2200}sbClient\.channel\(/.test(mir.slice(mir.indexOf('async function join'), mir.indexOf('function openChannel'))), 'mir.js: обработчики канала мира — в openChannel (без st закрытого мира)');
ok(/W\.stopped = true/.test(war) && /if \(W\.stopped \|\|/.test(war) && /function relayChannel/.test(war), 'mir-war.js: остановленный бой не открывает канал заново, обработчики канала — через реле');
// T-090: открытый мир рос на +10 МБ/с — подгрузка (4 раза в секунду) начинала зону заново, пока шли клетки/склейка/доделка (zs.it
// уже null, zs.built ещё false): на медленном кадре без конца, и каждая копия (сетки, тела физики, предметы, BRK) оставалась.
// Первая строка beginBuild — выход, если постройка уже начата на любом этапе (zs.grp или busy(zs)), а не только пока идёт zs.it
{
  const i = mz.indexOf('function beginBuild(zs)'), body = i > 0 ? mz.slice(i, mz.indexOf('\n    }', i)) : '';
  const guard = (body.split('\n').map(l => l.trim()).find(l => /^if \(.*\) return;/.test(l)) || '');
  ok(/\bzs\.grp\b|\bbusy\(zs\)/.test(guard), 'mir-zones.js: зона строится один раз — beginBuild не начинает заново, пока идут клетки/склейка/доделка', guard || '(нет beginBuild)');
}

// ═══ 4. Движок в node: после остановки модуль не держит мир (WeakRef + сборка мусора) ═══
(async () => {
  const store = {};
  globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  let raf = 0; globalThis.requestAnimationFrame = f => ++raf; globalThis.cancelAnimationFrame = () => {};
  globalThis.document = globalThis.document || { hidden: false };
  for (const f of ['core', 'physics', 'controls', 'player']) vm.runInThisContext(read('js/engine/' + f + '.js'), { filename: f + '.js' });
  const E = globalThis.D37E;
  const refs = [];
  for (let k = 0; k < 8; k++) {
    (() => {
      const world = { big: new Array(2e4).fill(k) };   // «мир»: всё, на что ссылаются обработчики
      const ph = new E.Phys({ ground: 0 });
      for (let i = 0; i < 50; i++) ph.addBox({ x: i, z: 0, y: .5, hx: .5, hy: .5, hz: .5 });
      const P = E.player(ph, { x: 0, z: 0 });
      P.floorAt = () => world.big.length;
      const C = E.controls({ listen: false });
      for (let i = 0; i < 90; i++) P.update(1 / 60, C, null);
      const L = E.loop(() => world.big.length, () => world.big[0]);
      L.pause(true); L.pause(false); const paused = L.paused; L.stop();
      ok(paused === false && typeof L.paused === 'boolean', 'E.loop: paused — обычное поле, как раньше');
      C.dispose?.();
      refs.push(new WeakRef(world));
    })();
    await new Promise(r => setTimeout(r, 5));
  }
  for (let i = 0; i < 4; i++) { global.gc(); await new Promise(r => setTimeout(r, 20)); }
  const alive = refs.map((r, i) => (r.deref() ? i + 1 : 0)).filter(Boolean);
  ok(!alive.length, '8 «миров» (игрок, физика, управление, цикл): после остановки и сборки мусора — ни одного', alive);
  // геттеров у объектов движка «на каждый мир» нет (их держит общая «форма» объекта): игрок, цикл
  const ph = new E.Phys({ ground: 0 }), P = E.player(ph, { x: 0, z: 0 }), L = E.loop(() => {}, () => {});
  const acc = o => Object.entries(Object.getOwnPropertyDescriptors(o)).filter(([, d]) => d.get || d.set).map(([k]) => k);
  ok(!acc(P).length && !acc(L).length, 'E.player и E.loop: без своих геттеров', { player: acc(P), loop: acc(L) });
  L.stop();
  console.log(`world-leak-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL исключение', e.stack || e); process.exit(1); });
