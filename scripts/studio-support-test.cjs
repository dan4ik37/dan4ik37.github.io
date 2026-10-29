// «Студия 3D» — прочность построек (js/games/studio3d-support.js поверх js/engine/support.js) без браузера:
// node scripts/studio-support-test.cjs
// Коробки деталей (поворот — описанная коробка), материал прочности по виду и свой (smat: якорь, «не участвует»), граф касаний;
// модуль игры: при старте падает то, что не держится, сломал опору (Destroy, Support.Break, открепил) — что держалось через неё,
// открепляется (падает физикой), у гостя — ничего не считает; скрипты Support.* в JavaScript, Lua, C# и Java.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
globalThis.window = globalThis;
globalThis.document = { hidden: false, body: { classList: { contains: () => false } }, getElementById: () => null, createElement: () => ({ style: {}, addEventListener(){}, classList: { add(){}, remove(){} } }), head: { appendChild(){} } };
for (const f of ['js/engine/core.js', 'js/engine/support.js', 'js/engine/script.js', 'js/engine/lang-lua.js', 'js/engine/lang-cs.js', 'js/engine/lang-java.js', 'js/games/studio3d-support.js'])
  vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
const E = window.D37E, S = E.support, SS = E.studioSupport;
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sec = t => console.log('— ' + t);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── сцена как SC (только то, что нужно модулю): объекты, set/remove, события ──
function scene(mode){
  const objects = new Map(), order = [], ev = { add: [], remove: [], change: [] };
  const SC = { settings: { support: { mode } }, objects,
    all: () => order.slice(), get: id => objects.get(id) || null,
    on(e, f){ ev[e].push(f); return () => { const i = ev[e].indexOf(f); if (i >= 0) ev[e].splice(i, 1); }; },
    add(o){ o.cls = o.cls || 'Part'; o.rot = o.rot || [0, 0, 0]; o.anchored = o.anchored !== false; o.mat = o.mat || 'concrete'; objects.set(o.id, o); order.push(o); ev.add.forEach(f => f(o)); return o; },
    remove(o){ objects.delete(o.id); order.splice(order.indexOf(o), 1); ev.remove.forEach(f => f(o)); },
    set(o, k, v){ o[k] = v; ev.change.forEach(f => f({ obj: o, key: k })); },
  };
  return SC;
}
// дом: пол на земле, 4 колонны, 4 балки по верху, плита крыши; ещё — висящая в воздухе деталь
function house(SC){
  SC.add({ id: 'floor', pos: [0, .25, 0], size: [12, .5, 12] });
  for (const [i, x, z] of [[1, -5, -5], [2, 5, -5], [3, -5, 5], [4, 5, 5]]) SC.add({ id: 'col' + i, pos: [x, 3, z], size: [1, 5, 1] });
  SC.add({ id: 'beamN', pos: [0, 5.75, -5], size: [11, .5, 1], mat: 'wood' });
  SC.add({ id: 'beamS', pos: [0, 5.75, 5], size: [11, .5, 1], mat: 'wood' });
  SC.add({ id: 'roof', pos: [0, 6.25, 0], size: [12, .5, 12], mat: 'wood' });
  SC.add({ id: 'cloud', pos: [30, 20, 0], size: [4, 1, 4] });
}
function papiOf(SC, role = 'solo'){
  const events = [], prints = [];
  return { events, prints, SC, ed: { ph: { groundAt: () => 0 }, FX: null }, live: () => role === 'solo' || role === 'host', role: () => role,
    scriptEvent: (e, d) => events.push([e, d]), print: t => prints.push(t), sendAll(){}, toast(){} };
}

sec('коробки и материалы');
{
  const a = SS.aabb({ pos: [0, 0, 0], size: [4, 1, 2], rot: [0, 90, 0] });
  ok(Math.abs(a[0] + 1) < 1e-9 && Math.abs(a[3] - 1) < 1e-9 && Math.abs(a[2] + 2) < 1e-9 && Math.abs(a[5] - 2) < 1e-9, 'поворот на 90° по Y — коробка повёрнута (2×4 вместо 4×2)', Array.from(a));
  ok(SS.matOf({ mat: 'wood' }) === S.MAT.wood && SS.matOf({ mat: 'brick' }) === S.MAT.brick && SS.matOf({ mat: 'metal' }) === S.MAT.metal && SS.matOf({ mat: 'neon' }) === S.MAT.glass, 'материал прочности — по виду детали (дерево, кирпич, металл, неон — как стекло)');
  ok(SS.matOf({ mat: 'wood', smat: 'metal' }) === S.MAT.metal && SS.matOf({ mat: 'wood', smat: 'anchor' }) === S.MAT.steel && !SS.takes({ cls: 'Part', smat: 'none', anchored: true, pos: [0, 0, 0], size: [1, 1, 1] }) && !SS.takes({ cls: 'Part', anchored: false, pos: [0, 0, 0], size: [1, 1, 1] }), 'свой материал, ⚓ якорь; «не участвует» и незакреплённые — вне графа');
  ok(SS.SMATS.length >= 8, 'список «Материал прочности» в свойствах детали');
}

sec('игра: при старте падает то, что не держится; сломал колонну — падает то, что держалось через неё');
{
  const SC = scene('real'); house(SC);
  const P = papiOf(SC); SS.play.start(P); SS.play.world(); SS.play.step(1 / 60);
  ok(SC.get('cloud').anchored === false && SC.get('roof').anchored !== false && SC.get('col1').anchored !== false, 'старт: висящая в воздухе деталь открепилась (упадёт физикой), дом стоит', { cloud: SC.get('cloud').anchored, roof: SC.get('roof').anchored });
  const ev0 = P.events.find(e => e[0] === 'support');
  ok(ev0 && ev0[1].mode === 'real' && ev0[1].fell.includes('cloud') && ev0[1].sup.floor > 90 && ev0[1].sup.roof > 0, 'скриптам: режим, держание деталей (0…100) и что упало', ev0 && ev0[1].sup);
  // убрали обе колонны с севера — северная балка и, может, крыша без опоры
  SC.remove(SC.get('col1')); SC.remove(SC.get('col2'));
  SS.play.step(1 / 60);
  ok(SC.get('beamN').anchored !== false && SC.get('roof').anchored !== false, 'убрали колонны под северной балкой — балка висит на крыше (крыша — одна деталь, её держит южная балка): стоит', { beamN: SC.get('beamN').anchored, roof: SC.get('roof').anchored });
  ok(SC.get('beamS').anchored !== false && SC.get('col3').anchored !== false, 'южная половина стоит');
  // Support.Break из скрипта
  SS.play.cmd({ t: 'mode', cmd: 'support', op: 'break', id: 'col3' }); SS.play.cmd({ t: 'mode', cmd: 'support', op: 'break', id: 'col4' }); SS.play.step(1 / 60);
  ok(!SC.get('col3') && SC.get('beamS').anchored === false && SC.get('roof').anchored === false, 'Support.Break обеих южных колонн — южная балка и крыша падают', { beamS: SC.get('beamS')?.anchored, roof: SC.get('roof')?.anchored });
  ok(P.prints.some(t => /Обрушилось/.test(t)), 'в «Вывод» — сколько обрушилось');
  SS.play.stop();
}

sec('без крыши: убрали колонны под балкой — балка падает');
{
  const SC = scene('real'); house(SC); SC.remove(SC.get('roof'));
  const P = papiOf(SC); SS.play.start(P); SS.play.world(); SS.play.step(1 / 60);
  SC.remove(SC.get('col1')); SC.remove(SC.get('col2')); SS.play.step(1 / 60);
  ok(SC.get('beamN').anchored === false && SC.get('beamS').anchored !== false, 'северная балка без колонн открепилась (падает физикой), южная стоит', { beamN: SC.get('beamN').anchored, beamS: SC.get('beamS').anchored });
  SS.play.stop();
}

// ═══ T-124 SH1: нагрузка (settings.phys.load = 1) — вес деталей и площадь касания ═══
// разбор SH1 (4): металлическая плита на двух деревянных столбиках — убрали один, плита падает, а перегруженный второй (раздавлен) —
// тоже вниз (раньше оставался стоять: раздавленных нет в группах)
sec('нагрузка: раздавленная деталь тоже падает (её нет в группах)');
{
  const SC = scene('real'); SC.settings.phys = { load: 1 };
  SC.add({ id: 'pa', pos: [.3, 1.5, .3], size: [.6, 3, .6], mat: 'wood' }); SC.add({ id: 'pb', pos: [3.7, 1.5, .3], size: [.6, 3, .6], mat: 'wood' });
  SC.add({ id: 'slab', pos: [2, 3.15, 2], size: [4, .3, 4], mat: 'metal' });
  const P = papiOf(SC); SS.play.start(P); SS.play.world(); SS.play.step(1 / 60);
  const start = ['pa', 'pb', 'slab'].map(k => SC.get(k).anchored !== false);
  SC.remove(SC.get('pb')); SS.play.step(1 / 60);
  const r = { start, slab: SC.get('slab').anchored, pa: SC.get('pa').anchored, crushed: SS.B.loadJob().res?.crushed };
  ok(r.start.every(Boolean) && r.slab === false && r.pa === false && r.crushed >= 1, 'плита на двух столбиках: убрали один — плита падает, раздавленный второй столбик — тоже', r);
  SS.play.stop();
}
sec('нагрузка: бетон на балке между стенами — убрали стену, балка с бетоном падает (без нагрузки — висит, как раньше)');
{
  const mk = load => { const SC = scene('real'); if (load) SC.settings.phys = { load: 1 };
    SC.add({ id: 'wa', pos: [0, 1.5, 0], size: [.3, 3, 1] }); SC.add({ id: 'wb', pos: [4.3, 1.5, 0], size: [.3, 3, 1] });
    SC.add({ id: 'beam', pos: [2.15, 2.75, 0], size: [4, .5, 1], mat: 'wood' }); SC.add({ id: 'block', pos: [2.15, 3.3, 0], size: [.6, .6, 1] });
    SC.add({ id: 'shed', pos: [9, 1, 0], size: [1, 2, 1] }); SC.add({ id: 'shedTop', pos: [9, 2.25, 0], size: [3, .5, 1], mat: 'wood' });
    return SC; };
  const run = load => { const SC = mk(load), P = papiOf(SC); SS.play.start(P); SS.play.world(); SS.play.step(1 / 60);
    const start = ['beam', 'block'].every(k => SC.get(k).anchored !== false);
    SC.remove(SC.get('wb')); SS.play.step(1 / 60);
    const r = { start, beam: SC.get('beam').anchored, block: SC.get('block').anchored, shed: SC.get('shedTop').anchored };
    SS.play.stop(); return r; };
  const v2 = run(true), v1 = run(false);
  ok(v2.start && v2.beam === false && v2.block === false && v2.shed !== false, 'нагрузка: убрали стену — балка с бетоном стала консолью и упала', v2);
  ok(v1.start && v1.beam !== false && v1.block !== false, 'без нагрузки (старые миры) — как было: балка держится вбок от одной стены', v1);
  // «держалось до»: перегруженное от посторонней правки не падает
  const SC = mk(true); SC.add({ id: 'lead', pos: [2.15, 3.9, 0], size: [.6, .6, 1], mat: 'metal' });   // металл сверху — балка перегружена ещё «до»
  const P = papiOf(SC); SS.play.start(P); SS.play.world(); SS.play.step(1 / 60);
  SC.remove(SC.get('shed')); SS.play.step(1 / 60);
  ok(SC.get('beam').anchored !== false && SC.get('lead').anchored !== false && SC.get('shedTop').anchored === false, 'перегруженная балка (металл сверху) от посторонней правки (сломали сарай рядом) не падает; крыша сарая — падает', { beam: SC.get('beam').anchored, lead: SC.get('lead').anchored, shed: SC.get('shedTop').anchored });
  SS.play.stop();
}

sec('мягкое держит дольше; гость не считает; выкл — как было');
{
  const mk = mode => { const SC = scene(mode); SC.add({ id: 'post', pos: [0, 2, 0], size: [1, 4, 1] }); for (let i = 1; i <= 7; i++) SC.add({ id: 'b' + i, pos: [i, 3.75, 0], size: [1, .5, 1], mat: 'wood' }); return SC; };
  const run = (mode, role) => { const SC = mk(mode); const P = papiOf(SC, role); SS.play.start(P); SS.play.world(); SS.play.step(1 / 60); const n = [...SC.all()].filter(o => o.anchored === false).length; SS.play.stop(); return n; };
  const r = run('real', 'solo'), s = run('soft', 'solo'), g = run('real', 'guest'), o = run('off', 'solo');
  ok(r > 0 && s < r, 'балка из 7 деталей на столбе: реализм — конец падает, «мягкое» — держит больше', { real: r, soft: s });
  ok(g === 0 && o === 0, 'гость ничего не считает (считает хозяин); «выкл» — ничего не падает', { guest: g, off: o });
}

sec('открепил деталь скриптом — то, что держалось на ней, падает');
{
  const SC = scene('real');
  SC.add({ id: 'base', pos: [0, 1, 0], size: [2, 2, 2] }); SC.add({ id: 'top', pos: [0, 2.5, 0], size: [2, 1, 2] }); SC.add({ id: 'arm', pos: [2, 2.5, 0], size: [2, 1, 2] });
  const P = papiOf(SC); SS.play.start(P); SS.play.world(); SS.play.step(1 / 60);
  SC.set(SC.get('base'), 'anchored', false); SS.play.step(1 / 60);
  ok(SC.get('top').anchored === false && SC.get('arm').anchored === false, 'открепил низ — верх и вынос открепились', { top: SC.get('top').anchored, arm: SC.get('arm').anchored });
  SS.play.stop();
}

sec('время: 1000 деталей — граф и пересчёт');
{
  const SC = scene('real');
  let n = 0;
  for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) for (let y = 0; y < 10; y++) SC.add({ id: 'p' + (n++), pos: [x * 2 + 1, y * 2 + 1, z * 2 + 1], size: [2, 2, 2], mat: y % 2 ? 'wood' : 'concrete' });
  const P = papiOf(SC); SS.play.start(P); SS.play.world();
  let t0 = performance.now(); SS.play.step(1 / 60); const tStart = performance.now() - t0;
  const ts = [];
  for (let k = 0; k < 10; k++) { const o = SC.get('p' + (k * 10)); if (!o) continue; t0 = performance.now(); SC.remove(o); SS.play.step(1 / 60); ts.push(performance.now() - t0); }
  ts.sort((a, b) => a - b);
  console.log(`  1000 деталей: старт ${tStart.toFixed(1)} мс, сломал деталь — медиана ${ts[ts.length >> 1].toFixed(1)} мс (граф + до/после + открепление)`);
  ok(tStart < 120 && ts[ts.length >> 1] < 120, 'пересчёт 1000 деталей — быстрее 120 мс (событие, не каждый кадр)', { tStart, med: ts[ts.length >> 1] });
  SS.play.stop();
}

// ── Support.* в скриптах: JavaScript, Lua, C#, Java ──
async function scripts(){
  const part = (id, name) => ({ id, cls: 'Part', parent: null, p: { name, pos: [0, 1, 0], size: [4, 1, 2], rot: [0, 0, 0], color: '#a3a2a5', mat: 'plastic', alpha: 0, collide: true, anchored: true } });
  const libs = {}; for (const k of ['lua', 'cs', 'java']) libs[k] = '(' + E.langs[k].worker.toString() + ')();';
  const run = async (lang, code) => {
    const msgs = [];
    const ctx = vm.createContext({ postMessage: m => msgs.push(JSON.parse(JSON.stringify(m))), onmessage: null, setTimeout, clearTimeout, console });
    vm.runInContext('(' + E.scripts.runtime.toString() + ')()', ctx);
    const send = d => ctx.onmessage({ data: d });
    send({ t: 'init', players: [{ id: 'me', name: 'Тест', pos: [0, 0, 0] }], objs: [part('a', 'Балка'), part('b', 'Колонна')], scripts: [{ name: 's', parent: 'a', lang, code }], libs: lang === 'js' ? {} : { [lang]: libs[lang] } });
    await sleep(60);
    send({ t: 'ev', ev: 'support', mode: 'real', sup: { a: 37, b: 100 }, fell: [] });
    await sleep(240);
    send({ t: 'ev', ev: 'support', mode: 'real', sup: {}, fell: ['a'] });
    await sleep(220);
    return { prints: msgs.filter(m => m.t === 'print').map(m => m.text), errors: msgs.filter(m => m.t === 'error'), modes: msgs.filter(m => m.t === 'mode') };
  };
  const js = await run('js', `Support.Collapsed.Connect(p => print('упала ' + p.Name));\nawait task.wait(0.15);\nprint('держит ' + Support.Holds(script.Parent) + ' ' + Support.Get(script.Parent) + ' ' + Support.Mode);\nSupport.Break(workspace.Колонна);`);
  ok(!js.errors.length && js.prints.includes('держит true 37 real') && js.prints.includes('упала Балка') && js.modes.some(m => m.cmd === 'support' && m.op === 'break' && m.id === 'b'), 'JavaScript: Support.Holds / Get / Mode, Collapsed, Break → хозяину', js);
  const lua = await run('lua', `Support.Collapsed:Connect(function(p) print("упала " .. p.Name) end)\ntask.wait(0.15)\nprint("держит", Support:Holds(script.Parent), Support:Get(script.Parent), Support.Mode)\nSupport:Break(workspace.Колонна)`);
  ok(!lua.errors.length && lua.prints.some(t => /держит\s+true\s+37\s+real/.test(t)) && lua.prints.includes('упала Балка') && lua.modes.some(m => m.op === 'break'), 'Lua: Support:Holds / Get, Collapsed:Connect, Break', lua);
  const cs = await run('cs', `Support.Collapsed.Connect(p => Debug.Log("упала " + p.Name));\nDebug.Log("режим " + Support.Mode);`);
  ok(!cs.errors.length && cs.prints.includes('упала Балка') && cs.prints.some(t => /режим/.test(t)), 'C#: Support.Collapsed.Connect, Support.Mode', cs);
  const java = await run('java', `Support.Collapsed.Connect(p -> System.out.println("упала " + p.Name));\nSystem.out.println("режим " + Support.Mode);`);
  ok(!java.errors.length && java.prints.includes('упала Балка') && java.prints.some(t => /режим/.test(t)), 'Java: Support.Collapsed.Connect, Support.Mode', java);
}

(async () => {
  sec('скрипты: Support.* в JavaScript, Lua, C#, Java');
  await scripts();
  console.log(`\nСтудия 3D, прочность: ${pass} прошло, ${fail} не прошло`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
