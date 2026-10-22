// «Студия 3D» — огонь (js/games/studio3d-fire.js поверх js/engine/fire.js) без браузера: node scripts/studio-fire-test.cjs
// Горючее — по материалу вида и своё (burn); «Горит»: при ▶ / вечный огонь; в игре огонь перекидывается, сгоревшее исчезает (и то,
// что на нём держалось, обрушивается — прочность построек), вечный не сгорает, под водой гаснет; гость не считает; Fire.* в
// скриптах JavaScript, Lua, C#, Java; одинаково при 30 / 60 / 144 кадрах.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
globalThis.window = globalThis;
globalThis.document = { hidden: false, body: { classList: { contains: () => false } }, getElementById: () => null, createElement: () => ({ style: {}, addEventListener(){}, classList: { add(){}, remove(){} } }), head: { appendChild(){} } };
for (const f of ['js/engine/core.js', 'js/engine/support.js', 'js/engine/fire.js', 'js/engine/script.js', 'js/engine/lang-lua.js', 'js/engine/lang-cs.js', 'js/engine/lang-java.js', 'js/games/studio3d-support.js', 'js/games/studio3d-fire.js'])
  vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
const E = window.D37E, SF = E.studioFire, SS = E.studioSupport;
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sec = t => console.log('— ' + t);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── сцена как SC (только то, что нужно модулям) ──
function scene(support = 'off'){
  const objects = new Map(), order = [], ev = { add: [], remove: [], change: [] };
  const SC = { settings: { support: { mode: support } }, objects,
    all: () => order.slice(), get: id => objects.get(id) || null,
    on(e, f){ ev[e].push(f); return () => { const i = ev[e].indexOf(f); if (i >= 0) ev[e].splice(i, 1); }; },
    add(o){ o.cls = o.cls || 'Part'; o.rot = o.rot || [0, 0, 0]; o.anchored = o.anchored !== false; o.mat = o.mat || 'concrete'; o.color = o.color || '#a3a2a5'; objects.set(o.id, o); order.push(o); ev.add.forEach(f => f(o)); return o; },
    remove(o){ if (!objects.has(o.id)) return; objects.delete(o.id); order.splice(order.indexOf(o), 1); ev.remove.forEach(f => f(o)); },
    set(o, k, v){ o[k] = v; ev.change.forEach(f => f({ obj: o, key: k })); },
  };
  return SC;
}
// хижина: бетонный пол, деревянные стены из досок вплотную, крыша-доски; костёр (вечный огонь) рядом; камень в стороне
function hut(SC){
  SC.add({ id: 'floor', pos: [0, .25, 0], size: [16, .5, 16] });
  let n = 0;
  for (let i = -3; i <= 3; i++) { SC.add({ id: 'wn' + (n++), pos: [i * 2, 2.5, -6], size: [2, 4, .5], mat: 'planks' }); SC.add({ id: 'ws' + (n++), pos: [i * 2, 2.5, 6], size: [2, 4, .5], mat: 'planks' }); }
  for (let j = -2; j <= 2; j++) { SC.add({ id: 'ww' + (n++), pos: [-7, 2.5, j * 2.4], size: [.5, 4, 2.4], mat: 'wood' }); SC.add({ id: 'we' + (n++), pos: [7, 2.5, j * 2.4], size: [.5, 4, 2.4], mat: 'wood' }); }
  SC.add({ id: 'rug', pos: [0, .6, 0], size: [4, .2, 3], mat: 'fabric' });
  SC.add({ id: 'camp', pos: [12, .5, 0], size: [1.5, 1, 1.5], mat: 'wood', fire: 'eternal' });
  SC.add({ id: 'rock', pos: [-12, 1, 0], size: [2, 2, 2], mat: 'rock' });
  SC.add({ id: 'start', pos: [-6, 2.5, -6], size: [2, 4, .5], mat: 'planks', fire: 'start' });
}
function papiOf(SC, role = 'solo', water = null){
  const events = [], prints = [], hurts = [];
  return { events, prints, hurts, SC, ed: { ph: { groundAt: () => 0 }, FX: null, TR: { water: water == null ? { on: false } : { on: true, level: water } } },
    live: () => role === 'solo' || role === 'host', role: () => role,
    scriptEvent: (e, d) => events.push([e, JSON.parse(JSON.stringify(d))]), print: t => prints.push(t), hurt: d => hurts.push(d), sendAll(){}, toast(){} };
}
const run = (P, sec, dt = 1 / 60) => { for (let i = 0; i < Math.round(sec / dt); i++) { SF.play.step(dt); SS?.play.step(dt); } };

sec('горючее — по материалу вида и своё');
{
  ok(SF.burnKey({ mat: 'wood' }) === 'wood' && SF.burnKey({ mat: 'planks' }) === 'planks' && SF.burnKey({ mat: 'fabric' }) === 'cloth' && SF.burnKey({ mat: 'grass' }) === 'grass', 'дерево, доски, ткань, трава — горят по виду');
  ok(SF.burnKey({ mat: 'concrete' }) === '' && SF.burnKey({ mat: 'metal' }) === '' && SF.burnKey({ mat: 'wood', burn: 'none' }) === '' && SF.burnKey({ mat: 'metal', burn: 'fuel' }) === 'fuel', 'бетон и металл — нет; своё: «не горит», «горючее» — главнее вида');
  const h = SF.ext.propsHtml('<div><!--s3x--></div>', { cls: 'Part', id: 'x', pos: [0, 0, 0], size: [1, 1, 1], mat: 'wood', burn: 'planks', fire: 'start' });
  ok(/data-p="burn"/.test(h) && /data-p="fire"/.test(h) && /value="planks" selected/.test(h) && /value="start" selected/.test(h), 'в «Свойствах» детали — «Горючее» и «Горит»');
}

sec('игра: стена загорается при ▶, огонь идёт по стенам хижины; сгоревшее исчезает; бетон и камень целы; вечный огонь не сгорает');
{
  const SC = scene(); hut(SC);
  const P = papiOf(SC); SF.play.start(P); SF.play.world();
  run(P, 1);
  ok(SC.get('start').onfire > 0 && SC.get('camp').onfire > 0, 'при ▶ горят «Загорится при ▶» и костёр (onfire — картинка у всех)', { start: SC.get('start').onfire, camp: SC.get('camp').onfire });
  run(P, 120);
  const st = SF.stats(), gone = ['wn', 'ws', 'ww', 'we'].reduce((a, k) => a + [...Array(20).keys()].filter(i => !SC.get(k + i) && SC.objects.size >= 0).length, 0);
  ok(st.ignited > 8 && st.burnt > 5, 'огонь перекинулся по стенам хижины, сгоревшие исчезли', st);
  ok(!!SC.get('floor') && !!SC.get('rock') && !!SC.get('camp'), 'бетонный пол и камень целы, вечный огонь — не сгорел', { floor: !!SC.get('floor'), rock: !!SC.get('rock'), camp: !!SC.get('camp') });
  const evs = P.events.filter(e => e[0] === 'fire');
  ok(evs.length > 0 && evs.some(e => e[1].ign.length) && evs.some(e => e[1].burnt.length), 'скриптам — события: загорелось, догорело', evs.length);
  console.log(`  хижина: загорелось ${st.ignited}, сгорело ${st.burnt}, вечный огонь перезажигался ${st.eternal} раз`);
  SF.play.stop();
}

sec('гость не считает; под водой — гаснет; Fire.Ignite негорючего — погаснет, не исчезнет; Fire.Extinguish');
{
  const SC = scene(); hut(SC);
  const G = papiOf(SC, 'guest'); SF.play.start(G); run(G, 5);
  ok(!SF.core() && !SC.get('start').onfire, 'гость: ядра нет, ничего не горит (считает хозяин)');
  SF.play.stop();
  const SC2 = scene(); hut(SC2); SC2.get('start').pos = [-6, -1, -6];   // стена под водой
  const W = papiOf(SC2, 'solo', 0); SF.play.start(W); SF.play.world(); run(W, 2);
  ok(!SC2.get('start').onfire && !!SC2.get('start'), 'под водой — погасло (и не сгорело)', { onfire: SC2.get('start').onfire });
  SF.play.stop();
  const SC3 = scene(); hut(SC3);
  const P = papiOf(SC3); SF.play.start(P); SF.play.world(); run(P, .1);
  SF.play.cmd({ t: 'mode', cmd: 'fire', op: 'ignite', id: 'rock' }); run(P, 1);
  ok(SC3.get('rock').onfire > 0, 'Fire.Ignite(камень) — горит');
  run(P, 10);
  ok(!!SC3.get('rock') && !SC3.get('rock').onfire, 'негорючее, подожжённое скриптом, — погасло, не исчезло');
  SF.play.cmd({ t: 'mode', cmd: 'fire', op: 'out', id: 'camp' }); run(P, .2);
  ok(!SC3.get('camp').onfire, 'Fire.Extinguish(костёр) — погас');
  SF.play.cmd({ t: 'mode', cmd: 'fire', op: 'at', pos: [6, 2.5, 6], r: 2 }); run(P, .2);
  ok(SC3.get('ws13')?.onfire > 0 || SC3.get('ws11')?.onfire > 0, 'Fire.IgniteAt — загорелось у точки');
  SF.play.stop();
}

sec('сгорел столб — то, что на нём держалось, обрушилось (прочность построек)');
{
  const SC = scene('real');
  SC.add({ id: 'ground', pos: [0, .25, 0], size: [20, .5, 20] });
  SC.add({ id: 'post', pos: [0, 3, 0], size: [1, 5, 1], mat: 'wood', fire: 'start' });
  for (let i = 1; i <= 4; i++) SC.add({ id: 'beam' + i, pos: [i, 5.75, 0], size: [1, .5, 1], mat: 'concrete' });
  const P = papiOf(SC); SF.play.start(P); SS.play.start(P); SF.play.world(); SS.play.world();
  run(P, 70);
  ok(!SC.get('post') && SC.get('beam1')?.anchored === false, 'столб сгорел — балка открепилась (упадёт физикой)', { post: !!SC.get('post'), beam1: SC.get('beam1')?.anchored });
  SF.play.stop(); SS.play.stop();
}

sec('одинаково при 30 / 60 / 144 кадрах');
{
  const one = hz => { const SC = scene(); hut(SC); const P = papiOf(SC); SF.play.start(P); SF.play.world(); run(P, 60, 1 / hz); const s = SF.stats(); const left = SC.all().map(o => o.id + ':' + (o.onfire | 0)).sort().join(','); SF.play.stop(); return { s, left }; };
  const a = one(60), b = one(30), c = one(144);
  ok(a.left === b.left && a.left === c.left && a.s.ignited === b.s.ignited && a.s.ignited === c.s.ignited, 'те же детали сгорели и горят', [a.s, b.s, c.s]);
}

// ── Fire.* в скриптах: JavaScript, Lua, C#, Java ──
async function scripts(){
  const part = (id, name) => ({ id, cls: 'Part', parent: null, p: { name, pos: [0, 1, 0], size: [4, 1, 2], rot: [0, 0, 0], color: '#a3a2a5', mat: 'wood', alpha: 0, collide: true, anchored: true } });
  const libs = {}; for (const k of ['lua', 'cs', 'java']) libs[k] = '(' + E.langs[k].worker.toString() + ')();';
  const run1 = async (lang, code) => {
    const msgs = [];
    const ctx = vm.createContext({ postMessage: m => msgs.push(JSON.parse(JSON.stringify(m))), onmessage: null, setTimeout, clearTimeout, console });
    vm.runInContext('(' + E.scripts.runtime.toString() + ')()', ctx);
    const send = d => ctx.onmessage({ data: d });
    send({ t: 'init', players: [{ id: 'me', name: 'Тест', pos: [0, 0, 0] }], objs: [part('a', 'Стена'), part('b', 'Костёр')], scripts: [{ name: 's', parent: 'a', lang, code }], libs: lang === 'js' ? {} : { [lang]: libs[lang] } });
    await sleep(60);
    send({ t: 'ev', ev: 'fire', ign: ['a'], out: [], burnt: [], burning: { a: 1 } });
    await sleep(240);
    send({ t: 'ev', ev: 'fire', ign: [], out: [], burnt: ['a'], burning: {} });
    await sleep(220);
    return { prints: msgs.filter(m => m.t === 'print').map(m => m.text), errors: msgs.filter(m => m.t === 'error'), modes: msgs.filter(m => m.t === 'mode') };
  };
  const js = await run1('js', `Fire.Ignited.Connect(p => print('горит ' + p.Name));\nFire.Burnt.Connect(p => print('сгорела ' + p.Name));\nawait task.wait(0.15);\nprint('IsBurning ' + Fire.IsBurning(script.Parent) + ' ' + Fire.Count);\nFire.Ignite(workspace.Костёр); Fire.Extinguish(workspace.Костёр);`);
  ok(!js.errors.length && js.prints.includes('горит Стена') && js.prints.includes('IsBurning true 1') && js.prints.includes('сгорела Стена') && js.modes.some(m => m.cmd === 'fire' && m.op === 'ignite' && m.id === 'b') && js.modes.some(m => m.op === 'out'), 'JavaScript: Fire.Ignited / Burnt, IsBurning, Count, Ignite / Extinguish → хозяину', js);
  const lua = await run1('lua', `Fire.Ignited:Connect(function(p) print("горит " .. p.Name) end)\ntask.wait(0.15)\nprint("IsBurning", Fire:IsBurning(script.Parent))\nFire:Ignite(workspace.Костёр)`);
  ok(!lua.errors.length && lua.prints.includes('горит Стена') && lua.prints.some(t => /IsBurning\s+true/.test(t)) && lua.modes.some(m => m.op === 'ignite'), 'Lua: Fire.Ignited:Connect, Fire:IsBurning, Fire:Ignite', lua);
  const cs = await run1('cs', `Fire.Ignited.Connect(p => Debug.Log("горит " + p.Name));\nFire.Burnt.Connect(p => Debug.Log("сгорела " + p.Name));`);
  ok(!cs.errors.length && cs.prints.includes('горит Стена') && cs.prints.includes('сгорела Стена'), 'C#: Fire.Ignited / Fire.Burnt.Connect', cs);
  const java = await run1('java', `Fire.Ignited.Connect(p -> System.out.println("горит " + p.Name));\nFire.Burnt.Connect(p -> System.out.println("сгорела " + p.Name));`);
  ok(!java.errors.length && java.prints.includes('горит Стена') && java.prints.includes('сгорела Стена'), 'Java: Fire.Ignited / Fire.Burnt.Connect', java);
}

(async () => {
  sec('скрипты: Fire.* в JavaScript, Lua, C#, Java');
  await scripts();
  console.log(`\nСтудия 3D, огонь: ${pass} прошло, ${fail} не прошло`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
