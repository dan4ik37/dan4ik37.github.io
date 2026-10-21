// «Кубомир» — тело игрока без браузера: node scripts/kubomir-move-test.cjs [путь к three@0.149]
// Лёд времён года (21.10.2026: владелец застрял подо льдом и не мог его разбить): подо льдом не запереть, лёд держит сверху,
// разбивается за ~0,75 с рукой, прорубь в мире и замерзает снова, вещи и мобы. Дальше — паркур (зацепиться, вылезти из воды),
// плавучесть, одинаковая физика при 30 / 60 / 144 кадрах, «🆘 Я застрял».
// VOXEL=путь — другой voxel.js (например, старый из git: показать, что раньше подо льдом запирало).
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
let THREE;
for (const p of [process.argv[2], process.env.THREE_PATH, 'three'].filter(Boolean)) {
  try { THREE = require(fs.existsSync(path.join(p, 'build/three.cjs')) ? path.join(p, 'build/three.cjs') : p); break; } catch (e) {}
}
if (!THREE) { console.log('Нет three.js r149: npm i three@0.149.0 во временной папке и node scripts/kubomir-move-test.cjs <путь>/node_modules/three'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sec = t => console.log('— ' + t);
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

globalThis.window = globalThis; globalThis.self = globalThis; globalThis.THREE = THREE;
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const run = f => vm.runInThisContext(fs.readFileSync(path.isAbsolute(f) ? f : path.join(SITE, f), 'utf8'), { filename: f });
const OLD = process.env.VOXEL || '';
for (const f of ['js/engine/core.js', 'js/engine/gfx.js', OLD || 'js/engine/voxel.js', 'js/engine/voxel-tex.js', 'js/engine/voxel-gen.js', 'js/engine/voxel-mesh.js', 'js/engine/voxel-render.js',
  'js/engine/physics.js', 'js/engine/controls.js', 'js/engine/player.js', 'js/games/kubomir-ents.js', 'js/games/kubomir-weather.js', 'js/games/kubomir.js']) run(f);
const E = window.D37E, V = E.vox, ID = V.ID, KB = window.GAME_IMPL.kubomir._test;
const T = THREE;

// ── мир: чанки −2…2 вокруг нуля; камень ниже floor, вода — water0…water1 (верх — гладь), остальное — воздух ──
function mkWorld(o = {}){
  const W = new V.World({ seed: 7 }), floor = o.floor ?? 46;
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
    const c = new V.Chunk(cx, cz);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < floor; y++) c.ids[(x << 11) | (z << 7) | y] = y === 0 ? ID.bedrock : ID.stone;
    W.add(c);
  }
  W.put = (x, y, z, name) => W.set(x, y, z, name ? V.cell(ID[name]) : 0, { silent: true, noEdit: true });
  W.fill = (x0, y0, z0, x1, y1, z1, name) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) W.put(x, y, z, name); };
  return W;
}
// озеро: вода в [x0..x1]×[z0..z1] от floor до top (включительно), берег вокруг — камень до top (верх берега — top + 1)
function lake(W, x0, z0, x1, z1, floor, top){ W.fill(x0 - 3, floor, z0 - 3, x1 + 3, top, z1 + 3, 'stone'); W.fill(x0, floor, z0, x1, top, z1, 'water'); }

// ── st для physics(): управление движка (как клавиши), камера-заглушка, игрок; погода (лёд и проруби) — настоящая ──
const PW = .6, PH = 1.8;
function mkSt(W, at = {}, o = {}){
  const C = E.controls({ listen: false });
  const rig = { yaw: o.yaw ?? Math.PI, fp: 0, tx: 0, tz: 0, motion: 1, fwd(){ return { x: -Math.sin(rig.yaw), z: -Math.cos(rig.yaw) }; }, right(){ return { x: Math.cos(rig.yaw), z: -Math.sin(rig.yaw) }; }, kick(){}, land(){}, shake(){} };
  const P = { x: 0, y: 80, z: 0, vx: 0, vy: 0, vz: 0, w: PW, h: PH, onGround: false, fly: false, sneak: false, sprint: false, water: 0, lava: 0, climb: false, eyeWater: false,
    fallTop: 80, hp: 20, food: 20, sat: 5, exh: 0, air: 15, regT: 0, starveT: 0, hurtT: 0, inv: new Array(36).fill(null), sel: 0, cursor: null, dead: false, stepT: 0, lastStepX: 0, lastStepZ: 0, bodyYaw: 0, swimT: 0 };
  Object.assign(P, at); P.fallTop = P.y;
  const sounds = [], fx = [];
  const st = { C, K: null, P, W, rig, I: { touch: !!o.touch }, creative: !!o.creative, meta: { diff: 'easy', ...(o.meta || {}) }, ox: 0, oz: 0, steps: 0,
    AU: { play: n => sounds.push(n), step(){}, loop: () => ({ set(){}, stop(){} }) }, ents: o.ents || { breakFx: (x, y, z, id) => fx.push(['break', x, y, z, id]), dust(){}, splash(){}, wake(){}, bubbles(){} },
    H: { toast(){} }, hit: null, mine: { key: '', t: 0, need: 0, st: -1, cool: 0 }, placeCool: 0, sounds, fx };
  st.R = { T, q: 'low', scene: new T.Scene(), camera: new T.PerspectiveCamera(70, 1, .1, 200), lighting: { time: 12 }, night: 0 };
  st.WX = window.KubomirWeather.create(st);
  return st;
}
const DT = 1 / 60;
// шаг игры: управление → тело; f — до шага (нажать / отпустить)
function steps(st, n, f){ for (let i = 0; i < n; i++) { f?.(i); st.C.step(DT); st.WX.iceTick(); KB.physics(st, DT); st.steps++; } }
const look = (st, dx, dy, dz) => { st.rig.yaw = Math.atan2(-dx, -dz); st.rig.fp = Math.atan2(-dy, Math.hypot(dx, dz)); };
KB.opts({});

(async () => {
  // ═══ 1. Лёд: подо льдом не запереть ═══
  sec('лёд времён года: подо льдом не запереть, держит сверху, разбивается, прорубь в мире');
  {
    // низкий уровень (moveBox): тело подо льдом всплывает со скоростью 3 блока/с — у старого voxel.js голова упиралась в лёд
    const W = mkWorld(); lake(W, -4, -4, 4, 4, 46, 51);
    V.iceTest = (Wd, x, y, z) => y === 51;
    const B = { x: .5, y: 47, z: .5, w: PW, h: PH };
    for (let i = 0; i < 180; i++) V.moveBox(W, B, 0, 3 * DT, 0);
    const surfaced = B.y + 1.62 > 51.875;
    if (OLD) console.log('  старый voxel.js:', surfaced ? 'всплыл' : `ЗАПЕРТ подо льдом (глаза на ${(B.y + 1.62).toFixed(2)}, лёд с 51)`);
    ok(surfaced, 'moveBox: всплываешь подо льдом — лёд снизу не держит (раньше голова упиралась в лёд, глаза под водой)', +(B.y + 1.62).toFixed(2));
    const hUp = V.raycast(W, .5, 50.2, .5, 0, 1, 0, 5);
    ok(hUp && hUp.y === 51 && hUp.ice, 'луч прицела снизу видит лёд (раньше — нет: лёд нельзя было разбить)', hUp);
    const hDown = V.raycast(W, .5, 53.6, .5, 0, -1, 0, 5);
    ok(hDown && hDown.y === 51 && hDown.ice && hDown.ny === 1 && near(hDown.t, 53.6 - 51.875, 1e-6) && hDown.box[4] === .875, 'сверху — лёд до глади (0,875), грань сверху', hDown);
    ok(!V.raycast(W, .5, 50.2, .5, 0, 1, 0, 5, t => V.T.opaque[t] === 1), 'камера (луч по непрозрачному) лёд не видит — не прижимается к нему');
    // сверху стоит, сбоку — стенка (из проруби не «выплыть» под край), boxHits его не считает (не «застрял в блоке»)
    const S2 = { x: .5, y: 54, z: .5, w: PW, h: PH };
    for (let i = 0; i < 60; i++) V.moveBox(W, S2, 0, -6 * DT, 0);
    ok(near(S2.y, 51.875, 1e-6) && S2.hitY, 'сверху — стоишь на льду (на гладь, 51,875)', S2.y);
    ok(!V.boxHits(W, .5, 51.2, .5, PW, PH), 'boxHits: лёд — не «застрял в блоке»');
    const S3 = { x: .5, y: 50.6, z: .5, w: PW, h: PH };
    V.moveBox(W, S3, 1, 0, 0);
    ok(S3.hitX && near(S3.x, 1 - .3, 1e-3), 'сбоку (тело в слое льда) — лёд стенка: вода в проруби, под край не протиснуться', S3.x);
    const T3 = V.touching(W, .5, 51.875, .5, PW, PH, {});
    ok(T3.water === 0 && T3.onIce && T3.under === ID.ice && T3.slip > 0, 'стоишь на льду: не в воде, под ногами — лёд (скользко, звук стекла)', T3);
    V.iceTest = null;
    if (OLD) { console.log(`\nkubomir-move-test (старый voxel.js, только лёд): ${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0); }
  }
  {
    // физика игры: подо льдом, мороз начался — держишь «прыжок» — всплыл, лёд над головой проломлен (прорубь), воздух вернулся
    const W = mkWorld(); lake(W, -6, -6, 6, 6, 46, 51);
    const st = mkSt(W, { x: .5, y: 47.2, z: .5 }); st.WX.iceForce = true; st.WX.iceTick();
    ok(V.isIce(W, .5, 51, .5) && st.WX.iceOn, 'мороз: верх озера — лёд');
    st.P.air = 6;
    let maxEye = 0;
    st.C.key('Space', true);
    steps(st, 240, () => { maxEye = Math.max(maxEye, st.P.y + 1.62); });
    st.C.key('Space', false);
    ok(maxEye > 51.9 && !st.P.eyeWater, 'держишь «прыжок» подо льдом — всплыл, голова над водой', { maxEye: +maxEye.toFixed(2), y: +st.P.y.toFixed(2) });
    ok(st.WX.isHole(.5, 51, .5) && st.sounds.includes('kb_ice') && st.fx.some(f => f[0] === 'break' && f[4] === ID.ice), 'лёд над головой проломлен: прорубь, треск, осколки льда', { holes: st.WX.holes.size, snd: st.sounds.slice(0, 6) });
    ok(st.meta.ice && st.meta.ice.h.some(h => h[0] === 0 && h[1] === 51 && h[2] === 0), 'прорубь записана в мир (meta.ice) — переживёт перезагрузку', st.meta.ice);
    // перезагрузка: новая погода с тем же meta — прорубь на месте
    const st2 = mkSt(W, { x: .5, y: 60, z: .5 }, { meta: st.meta }); st2.WX.iceForce = true; st2.WX.iceTick();
    ok(st2.WX.isHole(0, 51, 0) && !V.isIce(W, .5, 51, .5) && V.isIce(W, 3.5, 51, .5), 'после перезагрузки прорубь открыта, рядом — лёд');
    // замерзает снова через несколько минут (если ещё мороз)
    const r = st2.WX.holes.values().next().value; r[3] = Date.now() - st2.WX.ICE_REFREEZE - 1000; st2.WX.iceTick();
    ok(!st2.WX.isHole(0, 51, 0) && V.isIce(W, .5, 51, .5), 'через 5 минут прорубь замёрзла снова');
    // кончился мороз — проруби забыты (и в мире)
    st2.WX.hole(2, 51, 2); st2.WX.iceForce = false; st2.WX.iceTick();
    ok(!st2.WX.holes.size && !st2.meta.ice && !V.isIce(W, 2.5, 51, 2.5), 'оттаяло — льда нет, проруби забыты (meta.ice пусто)');
    st2.WX.dispose(); st.WX.dispose();
  }
  {
    // мороз начался, когда плыл у самой глади (тело в слое льда): тут же проломил — не заперт, а в проруби
    const W = mkWorld(); lake(W, -6, -6, 6, 6, 46, 51);
    const st = mkSt(W, { x: .5, y: 50.4, z: .5 }); st.WX.iceForce = true; st.WX.iceTick();
    steps(st, 2);
    ok(st.WX.isHole(0, 51, 0) && !V.isIce(W, .5, 51, .5), 'лёд замёрз вокруг пловца — сразу прорубь вокруг него');
    st.WX.dispose();
  }
  {
    // по льду: упал сверху — стоит на глади, идёт, не тонет; с берега на лёд и со льда на берег — без прыжка (край льда на 1/8 ниже)
    const W = mkWorld(); lake(W, -6, -6, 6, 6, 46, 51);
    const st = mkSt(W, { x: .5, y: 55, z: .5 }); st.WX.iceForce = true; st.WX.iceTick();
    steps(st, 60);
    ok(near(st.P.y, 51.875, 1e-6) && st.P.onGround && st.P.water === 0, 'упал на лёд — стоит на глади, не в воде', { y: st.P.y, water: st.P.water });
    st.rig.yaw = -Math.PI / 2;   // смотрим на +x
    st.C.key('KeyW', true); steps(st, 150); st.C.key('KeyW', false);
    ok(st.P.x > 7.5 && near(st.P.y, 52, 1e-6) && st.P.onGround, 'дошёл по льду до берега и шагнул на него без прыжка (ступенька 1/8)', { x: +st.P.x.toFixed(2), y: st.P.y });
    st.rig.yaw = Math.PI / 2;
    st.C.key('KeyW', true); steps(st, 90); st.C.key('KeyW', false);
    ok(st.P.x < 5 && near(st.P.y, 51.875, 1e-6), 'с берега обратно на лёд', { x: +st.P.x.toFixed(2), y: st.P.y });
    st.WX.dispose();
  }
  {
    // разбить лёд: прицел сверху, рукой ~0,75 с, киркой быстрее, в воде — не дольше; прорубь, вещей нет; падаешь в воду
    const W = mkWorld(); lake(W, -6, -6, 6, 6, 46, 51);
    const st = mkSt(W, { x: .5, y: 51.875, z: .5 }); st.WX.iceForce = true; st.WX.iceTick();
    steps(st, 2);
    const [ex, ey, ez] = [st.P.x, st.P.y + 1.62, st.P.z];
    const hit = V.raycast(W, ex, ey, ez, 1.5, -1.62, 0, 5);
    ok(hit && hit.ice && hit.x === 1 && hit.y === 51, 'прицел на лёд рядом', hit);
    const iceB = V.blocks[ID.ice];
    const tHand = KB.breakTime(st, iceB);
    st.P.inv[0] = { id: 'pick_wood', n: 1 }; const tPick = KB.breakTime(st, iceB);
    st.P.eyeWater = true; st.P.onGround = false; const tWater = KB.breakTime(st, iceB); st.P.inv[0] = null; const tWaterHand = KB.breakTime(st, iceB); st.P.eyeWater = false; st.P.onGround = true;
    ok(tHand >= .5 && tHand <= .8 && tPick < tHand && near(tWaterHand, tHand, 1e-9) && tWater === tPick, 'лёд: рукой 0,5…0,8 с, киркой быстрее, под водой и на плаву — не дольше', { tHand, tPick, tWater, tWaterHand });
    const items = []; st.ents.addItem = (x, y, z, s) => items.push(s);
    KB.breakBlock(st, hit);
    ok(st.WX.isHole(1, 51, 0) && !items.length && st.sounds.includes('kb_ice'), 'разбил: прорубь, треск, вещей нет', { items, holes: st.WX.holes.size });
    // разбил под собой — провалился в воду
    const h2 = V.raycast(W, ex, ey, ez, 0, -1, 0, 5); KB.breakBlock(st, h2);
    steps(st, 30);
    ok(st.P.y < 51.8 && st.P.water > .3, 'разбил лёд под собой — в воде', { y: +st.P.y.toFixed(2), water: +st.P.water.toFixed(2) });
    // настоящий блок льда над водой — водой, а не пустотой
    W.put(5, 51, 5, 'ice'); KB.breakBlock(st, { x: 5, y: 51, z: 5, nx: 0, ny: 1, nz: 0, t: 1, v: V.cell(ID.ice) });
    ok(W.get(5, 51, 5) === ID.water, 'блок льда над водой разбил — стал водой (как в Майнкрафте)', V.blocks[W.get(5, 51, 5)]?.name);
    st.WX.dispose();
  }
  {
    // вещи: подо льдом всплывают до льда (не сквозь), на льду лежат; моб подо льдом всплывает и проламывает
    const R = { T, r: { capabilities: { isWebGL2: true }, properties: { get: () => ({}) } }, scene: new T.Scene(), camera: new T.PerspectiveCamera(70, 1, .2, 500), q: 'high', night: 0, shadowDirty(){}, lighting: { time: 12 } };
    const VR = V.renderer(R);
    const W = mkWorld(); lake(W, -6, -6, 6, 6, 46, 51);
    W.chunk = W.chunk.bind(W);
    const S = { R, VR, W, P: { x: 20, y: 60, z: 20, dead: false, vx: 0, vz: 0 }, ox: 0, oz: 0, meta: { diff: 'easy' }, ST: { rd: 6 }, creative: true };
    V.iceTest = (Wd, x, y, z) => y === 51 && !(x === 3 && z === 3);
    const X = window.KubomirEnts.create(S); S.ents = X; X.spawnT = 1e9;
    const under = X.addItem(.5, 47, .5, { id: 'planks_oak', n: 1 }, false, [0, 0, 0]);
    const on = X.addItem(-2.5, 53, -2.5, { id: 'cobble', n: 1 }, false, [0, 0, 0]);
    for (let i = 0; i < 120; i++) X.tick(1 / 20);
    ok(under.y + .2 <= 51.02 && under.y > 50.2 && under.float, 'вещь подо льдом всплыла до льда — не сквозь него', { y: +under.y.toFixed(3) });
    ok(near(on.y, 51.875, .02) && !on.float && on.ground, 'вещь упала на лёд — лежит на нём', { y: +on.y.toFixed(3), float: on.float });
    const cracked = []; X.hookIce = (x, y, z) => cracked.push([x, y, z]);
    S.creative = false;
    const m = X.spawn('pig', -.5, 47, -.5, { quiet: true });
    for (let i = 0; i < 100 && !cracked.length; i++) X.tick(1 / 20);
    ok(cracked.length && cracked[0][1] === 51, 'свинья подо льдом всплыла — проломила лёд (прорубь)', { cracked, y: +m.y.toFixed(2) });
    X.dispose(); V.iceTest = null;
  }

  console.log(`\nkubomir-move-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
