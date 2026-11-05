// Проверка разборщиков карты модулей (scripts/module-map.cjs, ревью шага 0 от 05.11: D3 — RPC через обёртки, D5 — флаги CI с '{THREE}').
// Запуск из корня сайта: node scripts/module-map-test.cjs → строка на случай и «module-map-test: N/N OK»; код выхода ≠ 0 при ошибке.
const MM = require('./module-map.cjs');
let ok = 0, n = 0;
const check = (name, cond, extra) => { n++; if (cond) ok++; console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── RPC: все формы вызова по имени, ничего лишнего ──
const js = [
  "await sbClient.rpc('coins_add', { p: 1 });",
  "const r = await rpc('age_set', { y });",            // локальная обёртка (js/core/age.js)
  "await sbRpc('auth_link_add', args);",                // api/_lib/store.js
  "rpcOk('community_join', {}, 'ok');",
  'pushRpc("push_subscribe", sub);',
  'fetch(SB_URL + "/rest/v1/rpc/world_now", opt);',
  'P.rpc(`game_win_xp`, {});',
  "async function rpc(name, args) { return sbClient.rpc(name, args); }",   // определение — не вызов
  "rpc(`dyn_${kind}`, {});",                             // имя собрано на лету — не видно
  "kidRpc({ a: 1 });",                                   // первый аргумент не строка
  "rpcLog('Ошибка сети');",                              // не snake_case-имя — не функция базы
].join('\n');
const got = MM.rpcNames(js).sort();
const want = ['age_set', 'auth_link_add', 'coins_add', 'community_join', 'game_win_xp', 'push_subscribe', 'world_now'].sort();
check('rpcNames: .rpc, rpc, sbRpc, rpcOk, pushRpc, /rpc/x, template literal', same(got, want), got.join(','));
check('rpcNames: definitions, names built at run time and non-string args are not calls', !got.includes('name') && !got.some(s => s.startsWith('dyn')));

// ── CI: объекты TESTS со скобками внутри строк и вложенными env ──
const src = `
  { f: 'render-test.cjs', args: ['{THREE}'], needs: 'three', t: 240 },   // комментарий { со скобкой
  { f: 'fire-test.cjs', args: ['--fast', '{THREE}'], soft: 'three' }, { f: 'mir-fire-test.cjs' },
  { f: 'menu-e2e.cjs', args: ['all'], env: { KB_WORLD: '0' }, e2e: true, t: 1500 },
  // { f: 'commented-out.cjs' },
  { f: 'flaky-test.cjs', retry: 2, serial: true, optional: true },`;
const objs = MM.topObjects(src), rows = objs.map(MM.ciEntry);
check('topObjects: 5 entries, the commented one skipped', objs.length === 5, String(objs.length));
check("ciEntry: '{THREE}' args keep needs and t", same(rows[0], ['render-test.cjs', 'args {THREE}, needs three, t 240 s']), rows[0] && rows[0][1]);
check("ciEntry: '--fast {THREE}' + soft", same(rows[1], ['fire-test.cjs', 'args --fast {THREE}, soft three']), rows[1] && rows[1][1]);
check('ciEntry: entry without flags', same(rows[2], ['mir-fire-test.cjs', '']));
check('ciEntry: nested env {…} keeps e2e and t', same(rows[3], ['menu-e2e.cjs', 'args all, env KB_WORLD=0, e2e, t 1500 s']), rows[3] && rows[3][1]);
check('ciEntry: retry / serial / optional', same(rows[4], ['flaky-test.cjs', 'optional, serial, retry 2']), rows[4] && rows[4][1]);

// ── на настоящем репозитории ──
const text = MM.build();
const three = text.split('\n').filter(l => /^\| [\w-]+\.c?js \| args (--fast )?\{THREE\}/.test(l));
check("real map: every CI entry with '{THREE}' shows its flags (13 on 05.11)", three.length >= 13 && three.every(l => /(needs|soft) three/.test(l)), String(three.length));
const called = +(/(\d+) names called from js\/ or api\//.exec(text) || [])[1];
check('real map: RPC names called from js/ api/ include wrappers (≥ 240 on 05.11, was 141)', called >= 240, String(called));
check('real map: age_set / ad_view / auth_link_add have callers', /^\| age_set \| age\.sql \| js\/core\/age\.js \|$/m.test(text) && /^\| ad_view \| ads\.sql \| js\/core\/ad-direct\.js \|$/m.test(text) && /^\| auth_link_add \| [^|]+ \| api\/_lib\/routes\/oauth\.js \|$/m.test(text));
check('real map: no name is called but undefined', /Called but not defined in any root \.sql[^:]*: none\./.test(text));
check('real map: two builds are identical', MM.build() === text);

console.log(`module-map-test: ${ok}/${n} ${ok === n ? 'OK' : 'FAILED'}`);
process.exit(ok === n ? 0 : 1);
