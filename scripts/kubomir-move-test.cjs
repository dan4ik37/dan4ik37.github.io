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

  // ═══ 2. Паркур — тот же движок, что у человечка «Мира Денчика» (E.grip по кубикам через V.gripPhys) ═══
  sec('паркур: залезть на 2 блока, повиснуть на 3, по краю, наверх, отпустить; 1 блок — обычный прыжок; 4 — не достать');
  const wallWorld = h => { const W = mkWorld(); W.fill(2, 46, -4, 5, 45 + h, 4, 'stone'); return W; };
  const faceX = st => { st.rig.yaw = -Math.PI / 2; };   // смотрим на +x
  {
    // гриф (V.gripPhys) отвечает как физика движка
    const W = wallWorld(2), G = V.gripPhys(W);
    const h = G.raycast(.5, 47, .5, 1, 0, 0, 5);
    ok(h && near(h.x, 2, 1e-9) && h.nx === -1 && h.col, 'V.gripPhys: луч в стену — грань стены, нормаль к нам', h);
    ok(!G.raycast(2.5, 46.5, .5, 1, 0, 0, 5) || G.raycast(2.5, 46.5, .5, 1, 0, 0, 5).x >= 6, 'луч, начатый внутри блока, этот блок не видит (как в Unity)');
    ok(G.blocked(1.9, .5, 46.1, 47.5, .3) && !G.blocked(1.5, .5, 46.1, 47.5, .3), 'blocked — цилиндр тела задевает стену / не задевает');
    ok(near(G.supportAt(3.5, .5, .3, 60).y, 48, 1e-9) && near(G.supportAt(.5, .5, .3, 60).y, 46, 1e-9), 'supportAt — верх стены 48, пол 46');
    const L = E.grip.findLedge(G, { x: 1.3, y: 46, z: .5 }, { x: 1, z: 0 }, .5, 2.6, 1.8 / 2.1);
    ok(L && near(L.lip.y, 48, 1e-6) && near(L.height, 2, 1e-6) && L.face.x === -1, 'E.grip.findLedge нашёл край стены в 2 блока', L && { lip: L.lip, h: L.height, face: L.face });
  }
  {
    const st = mkSt(wallWorld(2), { x: .5, y: 46, z: .5 }); faceX(st);
    let maxPk = 0;
    st.C.key('KeyW', true); steps(st, 20); st.C.key('Space', true); steps(st, 80, () => { if (st.P.pk) maxPk = Math.max(maxPk, st.P.pk.k); }); st.C.key('Space', false); st.C.key('KeyW', false); steps(st, 20);
    ok(near(st.P.y, 48, 1e-6) && st.P.x > 2 && st.P.onGround && st.pkN === 1 && maxPk > .9, 'стена в 2 блока: «вперёд» + «прыжок» — залез наверх (путь движка)', { y: st.P.y, x: +st.P.x.toFixed(2), pkN: st.pkN });
    ok(st.sounds.includes('kb_grab') && st.P.exh > .2 && st.P.exh < .6, 'залезть — шорох рук и немного голода', st.P.exh);
  }
  {
    const st = mkSt(wallWorld(1), { x: .5, y: 46, z: .5 }); faceX(st);
    st.C.key('KeyW', true); steps(st, 20); st.C.key('Space', true); steps(st, 60); st.C.key('Space', false); st.C.key('KeyW', false); steps(st, 20);
    ok(near(st.P.y, 47, 1e-6) && !st.pkN, 'ступенька в 1 блок — обычный прыжок (как в Майнкрафте), без паркура', { y: st.P.y, pkN: st.pkN });
  }
  {
    // стена в 3 блока: прыжок с «вперёд» — схватился, держишь «вперёд» — залез
    const st = mkSt(wallWorld(3), { x: 1.5, y: 46, z: .5 }); faceX(st);
    let hung = false, done = false;
    st.C.key('KeyW', true); st.C.key('Space', true); steps(st, 160, () => { if (st.P.hang) hung = true; if (!done && st.P.onGround && st.P.y > 48.9) { done = true; st.C.key('Space', false); st.C.key('KeyW', false); } }); steps(st, 20);
    ok(hung && near(st.P.y, 49, 1e-6) && st.P.x > 2, 'стена в 3 блока: схватился за край и залез наверх', { hung, y: st.P.y, x: +st.P.x.toFixed(2) });
  }
  {
    // вис без «вперёд»: висит, по краю вбок, «прыжок» — наверх; другой раз — «красться» — отпустил и упал
    const hangNow = () => { const st = mkSt(wallWorld(3), { x: 1.5, y: 46, z: .5 }); faceX(st); st.C.key('KeyW', true); st.C.key('Space', true); steps(st, 60, i => { if (st.P.hang || st.P.pk?.move === 'hang') st.C.key('KeyW', false); }); st.C.key('Space', false); steps(st, 30); return st; };
    let st = hangNow();
    ok(st.P.hang && near(st.P.y, 47, .05) && near(st.P.x, 2 - .36, .05), 'висит: руки на краю (48), ноги на 2 ниже, у стены', { hang: !!st.P.hang, y: +st.P.y.toFixed(3), x: +st.P.x.toFixed(3) });
    const z0 = st.P.z; st.C.key('KeyD', true); steps(st, 60); st.C.key('KeyD', false); steps(st, 5);
    ok(st.P.hang && Math.abs(st.P.z - z0) > .5 && near(st.P.y, 47, .05), 'вбок — идёт по краю', { dz: +(st.P.z - z0).toFixed(2) });
    const za = st.P.z; st.C.key('KeyD', true); steps(st, 400); st.C.key('KeyD', false);
    ok(st.P.hang && st.P.z > za && st.P.z < 4.85 && st.P.z > 4.5, 'по краю — до конца стены (стена до z 5, руки — по 0,2 от середины), дальше не уходит', { z: +st.P.z.toFixed(2) });
    st.C.key('Space', true); steps(st, 2); st.C.key('Space', false); steps(st, 80);
    ok(!st.P.hang && near(st.P.y, 49, 1e-6), '«прыжок» в висе — залез наверх', { y: st.P.y });
    st = hangNow();
    st.C.key('KeyC', true); steps(st, 2); st.C.key('KeyC', false); steps(st, 60);   // «красться» (в игре — Shift, здесь — общее «присесть»)
    ok(!st.P.hang && near(st.P.y, 46, 1e-6) && st.P.onGround, '«красться» в висе — отпустил, стоит внизу', { y: st.P.y });
    st = hangNow();
    st.W.fill(2, 46, -4, 5, 48, 4, null);      // стену сломали целиком — сорвался
    steps(st, 3);
    ok(!st.P.hang, 'край сломали — сорвался (не висит в воздухе)');
  }
  {
    const st = mkSt(wallWorld(4), { x: 1.5, y: 46, z: .5 }); faceX(st);
    st.C.key('KeyW', true); st.C.key('Space', true); steps(st, 120); st.C.key('Space', false); st.C.key('KeyW', false); steps(st, 60);
    ok(near(st.P.y, 46, 1e-6) && !st.pkN, 'стена в 4 блока — не достать (не залез, не висит)', { y: st.P.y, pkN: st.pkN });
  }
  {
    // выключено в ⚙️ — как раньше (стена в 2 блока — не залезть)
    KB.opts({ climb: false });
    const st = mkSt(wallWorld(2), { x: .5, y: 46, z: .5 }); faceX(st);
    st.C.key('KeyW', true); st.C.key('Space', true); steps(st, 90); st.C.key('Space', false); st.C.key('KeyW', false);
    ok(st.P.y < 47.5 && !st.pkN, '⚙️ «Цепляться за края» выкл — как раньше', st.P.y);
    KB.opts({});
  }

  // ═══ 3. Вода: плавучесть, вылезти на берег ═══
  sec('вода: держишься на плаву (голова над водой), «красться» — нырнуть, вылезти на берег, из проруби — на лёд');
  {
    const W = mkWorld(); lake(W, -6, -6, 6, 6, 40, 51);
    const st = mkSt(W, { x: .5, y: 44, z: .5 });
    steps(st, 600);
    const eye = st.P.y + 1.62;
    ok(eye > 51.875 + .05 && !st.P.eyeWater && Math.abs(st.P.vy) < .2, 'ничего не жмёшь — всплыл и держится: голова над водой (не тонет)', { eye: +eye.toFixed(2), vy: +st.P.vy.toFixed(3) });
    st.P.air = 15;
    st.C.key('KeyC', true); steps(st, 120); st.C.key('KeyC', false);
    ok(st.P.eyeWater && st.P.y < 49, '«красться» — нырнул', +st.P.y.toFixed(2));
    steps(st, 600);
    ok(!st.P.eyeWater, 'отпустил — снова всплыл');
  }
  {
    // берег в 1 блок над водой (край 1/8 над гладью) — просто плыви к нему («вперёд»): выталкивает, вышел сам
    const W = mkWorld(); lake(W, -6, -6, 6, 6, 40, 51); W.fill(7, 40, -9, 30, 51, 9, 'stone');
    const st = mkSt(W, { x: 4.5, y: 50.5, z: .5 }); faceX(st);
    st.C.key('KeyW', true); steps(st, 240, () => { if (st.P.onGround && st.P.x > 8) st.C.key('KeyW', false); });
    ok(st.P.x > 7.2 && near(st.P.y, 52, 1e-6), 'низкий берег: плывёшь «вперёд» — выталкивает (как в Майнкрафте), вышел', { x: +st.P.x.toFixed(2), y: st.P.y });
  }
  {
    // берег на 1 блок выше гладь (+1,125): «вперёд» + «прыжок» — вылез (путь «залезть»)
    const W = mkWorld(); lake(W, -6, -6, 6, 6, 40, 51); W.fill(7, 40, -9, 30, 52, 9, 'stone');
    const st = mkSt(W, { x: 4.5, y: 50.4, z: .5 }); faceX(st);
    st.C.key('KeyW', true); st.C.key('Space', true); steps(st, 240, () => { if (st.P.onGround && st.P.x > 7.5) { st.C.key('Space', false); st.C.key('KeyW', false); } }); steps(st, 20);
    ok(st.P.x > 7.2 && near(st.P.y, 53, 1e-6) && st.pkN >= 1, 'берег на блок выше воды: «вперёд» + «прыжок» — вылез', { x: +st.P.x.toFixed(2), y: st.P.y, pkN: st.pkN });
    // слишком высокий (2 блока над водой) — не вылезти (ищи место пониже)
    const W2 = mkWorld(); lake(W2, -6, -6, 6, 6, 40, 51); W2.fill(7, 40, -9, 30, 53, 9, 'stone');
    const s2 = mkSt(W2, { x: 4.5, y: 50.4, z: .5 }); faceX(s2);
    s2.C.key('KeyW', true); s2.C.key('Space', true); steps(s2, 200); s2.C.key('Space', false); s2.C.key('KeyW', false);
    ok(s2.P.x < 7 && !s2.pkN, 'берег в 2 блока над водой — не вылезти', { x: +s2.P.x.toFixed(2) });
  }
  {
    // прорубь: лёд вокруг, вылез на лёд
    const W = mkWorld(); lake(W, -6, -6, 6, 6, 40, 51);
    const st = mkSt(W, { x: .5, y: 50.3, z: .5 }); st.WX.iceForce = true; st.WX.iceTick();
    steps(st, 3);   // лёд вокруг пловца проломан — он в проруби
    faceX(st); st.C.key('KeyW', true); st.C.key('Space', true); steps(st, 160, () => { if (st.P.onGround && st.P.water === 0 && st.P.x > 1.2) { st.C.key('Space', false); st.C.key('KeyW', false); } }); steps(st, 20);
    ok(near(st.P.y, 51.875, 1e-6) && st.P.x > 1 && st.P.onGround && st.P.water === 0, 'из проруби — на лёд («вперёд» + «прыжок»)', { x: +st.P.x.toFixed(2), y: st.P.y });
    st.WX.dispose();
  }

  // ═══ 4. Одинаково при 30, 60 и 144 кадрах (на телефоне плыву, на ПК тону — так не будет) ═══
  sec('частота кадров: тот же ввод при 33,3 / 16,7 / 6,9 мс на кадр — те же места (цикл движка с шагом 1/60)');
  {
    // настоящий E.loop: подставные requestAnimationFrame и часы; ввод — по времени игры (шагам) и по времени кадров (как события DOM)
    const loopRun = (frameMs, sec2, update) => {
      let now = 0; const q = [];
      const raf0 = globalThis.requestAnimationFrame, perf0 = globalThis.performance, doc0 = globalThis.document;
      globalThis.requestAnimationFrame = cb => { q.push(cb); return q.length; }; globalThis.cancelAnimationFrame = () => {};
      globalThis.performance = { now: () => now }; globalThis.document = { hidden: false };
      try { const L = E.loop(update, () => {}); while (now < sec2 * 1000) { now += frameMs; for (const cb of q.splice(0)) cb(now); } L.stop(); }
      finally { globalThis.requestAnimationFrame = raf0; globalThis.performance = perf0; globalThis.document = doc0; }
    };
    // «Кубомир»: прыжок в озеро с берега, плывём к другому берегу, вылезаем; ввод — по шагам (точно) и по кадрам (как DOM)
    const kbRun = (frameMs, byFrame) => {
      const W = mkWorld(); lake(W, -6, -6, 6, 6, 40, 51); W.fill(-9, 40, -9, -7, 53, 9, 'stone'); W.fill(7, 40, -9, 40, 52, 9, 'stone');
      const st = mkSt(W, { x: -8.5, y: 54, z: .5 }); faceX(st);
      let n = 0, tGame = 0, frameT = 0;
      const plan = t => { st.C.key('KeyW', t >= .2); st.C.key('Space', t >= 4 && t < 9); };
      loopRun(frameMs, 12, dt => { if (!byFrame) plan(tGame); st.C.step(dt); st.WX.iceTick(); KB.physics(st, dt); n++; tGame += dt; });
      void frameT;
      st.WX.dispose();
      return { x: st.P.x, y: st.P.y, z: st.P.z, n };
    };
    const A = kbRun(1000 / 60), B = kbRun(1000 / 144), C3 = kbRun(1000 / 30);
    ok(A.n === B.n && A.n === C3.n && near(A.x, B.x, 1e-9) && near(A.y, B.y, 1e-9) && near(A.x, C3.x, 1e-9) && near(A.y, C3.y, 1e-9), '«Кубомир» (ввод по шагам): 60, 144 и 30 кадров — одинаково до 1e-9', { A, B, C3 });
    ok(A.x > 7 && near(A.y, 53, 1e-6), '…и сценарий честный: спрыгнул в озеро, переплыл, вылез на берег', A);
    // ввод «как события DOM» — между кадрами: разница — не больше пути за один кадр
    const kbRunDom = frameMs => {
      const W = mkWorld(); lake(W, -6, -6, 6, 6, 40, 51); W.fill(-9, 40, -9, -7, 53, 9, 'stone'); W.fill(7, 40, -9, 40, 52, 9, 'stone');
      const st = mkSt(W, { x: -8.5, y: 54, z: .5 }); faceX(st);
      let now = 0; const q = [];
      const raf0 = globalThis.requestAnimationFrame, perf0 = globalThis.performance, doc0 = globalThis.document;
      globalThis.requestAnimationFrame = cb => { q.push(cb); return q.length; }; globalThis.performance = { now: () => now }; globalThis.document = { hidden: false };
      try {
        const L = E.loop(dt => { st.C.step(dt); st.WX.iceTick(); KB.physics(st, dt); }, () => {});
        while (now < 12000) { now += frameMs; const t = now / 1000; st.C.key('KeyW', t >= .2); st.C.key('Space', t >= 4 && t < 9); for (const cb of q.splice(0)) cb(now); }
        L.stop();
      } finally { globalThis.requestAnimationFrame = raf0; globalThis.performance = perf0; globalThis.document = doc0; }
      st.WX.dispose();
      return { x: st.P.x, y: st.P.y, z: st.P.z };
    };
    const D1 = kbRunDom(1000 / 60), D2 = kbRunDom(1000 / 144), D3 = kbRunDom(1000 / 30);
    ok(Math.hypot(D1.x - D2.x, D1.y - D2.y) < .15 && Math.hypot(D1.x - D3.x, D1.y - D3.y) < .25 && near(D1.y, 53, 1e-6) && near(D3.y, 53, 1e-6), '«Кубомир» (ввод между кадрами): все вылезли на тот же берег, разница — меньше шага за кадр', { D1, D2, D3 });
    // движок («Мир Денчика», «Студия 3D»): плавание человечка (player.js) — то же
    const engRun = frameMs => {
      const ph = new E.Phys({ ground: -4 }), U = E.UNIT;
      ph.addBox({ x: -10, y: -2, z: 0, hx: 12, hy: 2, hz: 20 });   // суша слева: верх 0, до x = 2
      ph.addBox({ x: 42, y: -2, z: 0, hx: 12, hy: 2, hz: 20 });    // суша справа: от x = 30
      ph.waterLevel = (x, z) => x > 2 && x < 30 ? 0 : -Infinity;
      const P = E.player(ph, { x: 0, y: 0, z: 0 }), C = E.controls({ listen: false }), cam = { yaw: -Math.PI / 2 };
      let t = 0;
      loopRun(frameMs, 8, dt => { C.key('KeyW', t >= .2 && t < 5); C.step(dt); P.update(dt, C, cam); t += dt; });
      void U;
      return { x: P.ch.x, y: P.ch.y, swim: P.swim };
    };
    const e1 = engRun(1000 / 60), e2 = engRun(1000 / 144), e3 = engRun(1000 / 30);
    ok(near(e1.x, e2.x, 1e-9) && near(e1.y, e2.y, 1e-9) && near(e1.x, e3.x, 1e-9) && near(e1.y, e3.y, 1e-9) && e1.swim && e1.x > 3, 'движок (player.js): плывёт одинаково при 60, 144 и 30 кадрах', { e1, e2, e3 });
  }

  console.log(`\nkubomir-move-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
