// Тесты 3D-человечка в node: js/core/avatar.js (части, пакеты, цены, миграция образов) + js/games/world3d.js (сборка, анимация).
//  · миграция: старые образы (до частей тела) — всё выбранное на месте, новые слоты «как было», внешность та же (resolve);
//  · сборка против эталона старой версии (scripts/char-ref.json, коммит c65d51b): кости, высота, габариты, все прежние цвета,
//    вызовов отрисовки не больше +20 % на высоком качестве и не больше прежнего на низком;
//  · формы частей (классика, стройный, силач, робот, рыцарь; головы; стили лица; перчатки) — геометрия без NaN, в разумных
//    размерах, индексы в пределах; дальний человечек (LOD) — заметно легче; перекраска палитрой без пересборки;
//  · анимация: все состояния движка и эмоции — без NaN, без рывков при смене состояний; кадр без мусора (сборщик молчит);
//  · цены: пакеты, «что купить», владение; coins.sql пересобран из PARTS (scripts/gen-skin-sql.mjs).
// Нужен three.js r149: node scripts/char-test.cjs <путь к node_modules/three> (или THREE_PATH). Запуск из корня сайта.
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const SITE = path.join(__dirname, '..');
let THREE, threePath = '';
for (const p of [process.argv[2], process.env.THREE_PATH, 'three'].filter(Boolean)) {
  try { const f = fs.existsSync(path.join(p, 'build/three.cjs')) ? path.join(p, 'build/three.cjs') : p; THREE = require(f); threePath = p; break; } catch (e) {}
}
if (!THREE) { console.log('Нет three.js r149: npm i three@0.149.0 во временной папке и node scripts/char-test.cjs <путь>/node_modules/three'); process.exit(1); }
globalThis.window = globalThis;
globalThis.THREE = THREE;
const ctx2d = new Proxy({}, { get: (o, k) => k in o ? o[k] : () => ({ addColorStop(){} }), set: (o, k, v) => { o[k] = v; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }), body: { classList: { contains: () => false } } };
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const owned = new Set();
let perks = false;
globalThis.D37Coins = { owns: i => owned.has(i), perks: () => perks };
for (const f of ['js/core/avatar.js', 'js/games/world3d.js']) vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
const C = globalThis.D37Char, W = globalThis.World3D, T = THREE;
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; if (fail < 60) console.log('FAIL', name, extra ?? ''); } };
const near = (a, b, e) => Math.abs(a - b) <= e;
const ALLOC = process.argv.includes('--alloc');

// ═══ Кадр без мусора: отдельный процесс с большим «молодым» поколением (уборок нет) — прирост кучи за 60 000 кадров ═══
if (ALLOC) {
  const K = W.kit(T, { q: 'high' });
  const chs = [{ hair: 'ponytail', back: 'tail', hairc: 'rainbow' }, { psal: 'robot', pst: 'knight', hat: 'propeller' }, { psh: 'cube', back: 'wings', item: 'balloon' }].map((l, i) => K.build(l, 'a' + i));
  const o = { rate: 10.5, air: false, sit: false, crouch: 0, roll: -1, rollBack: false, hang: false, ladder: false, climbPh: 0, pk: '', pkK: 0, swim: false, dive: false, look: { x: 2, y: 1.6, z: 5 } };
  const states = [() => {}, () => { o.rate = 13; }, () => { o.air = true; }, () => { o.sit = true; }, () => { o.swim = true; }, () => { o.swim = true; o.dive = true; }, () => { o.roll = .4; }, () => { o.hang = true; }, () => { o.ladder = true; o.climbPh += .1; }, () => { o.pk = 'vault'; o.pkK = .5; }, () => { o.crouch = 1; }];
  const reset = () => { o.rate = 10.5; o.air = o.sit = o.swim = o.dive = o.hang = o.ladder = false; o.roll = -1; o.pk = ''; o.pkK = 0; o.crouch = 0; };
  const tt = new Float64Array(1);
  const run = n => { for (let i = 0; i < n; i++) { tt[0] += 1 / 60; reset(); states[(i >> 6) % states.length](); for (let c = 0; c < chs.length; c++) { const ch = chs[c]; if (i % 900 === 300) { ch.emote = W.EMOTES[(i / 900 | 0) % W.EMOTES.length]; ch.emoteT = tt[0]; } K.animate(ch, (i >> 5) % 3 !== 0, 1 / 60, tt[0], o); } } };
  run(30000);   // разогрев: все состояния, все эмоции (наборы лица строятся один раз)
  let best = Infinity;   // три замера, берём меньший (шум кучи: служебные выделения V8)
  for (let k = 0; k < 3; k++) {
    global.gc(); global.gc();
    const h0 = process.memoryUsage().heapUsed;
    run(40000);
    best = Math.min(best, (process.memoryUsage().heapUsed - h0) / (40000 * chs.length));
  }
  console.log(JSON.stringify({ perCall: best }));
  return;
}

// ═══ 1. Образы: нормализация и миграция ═══
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'char-ref.json'), 'utf8'));
{
  ok(C.SLOTS.length === 46 && C.BODY_SLOTS.length === 39 && C.SLOTS2D.length === 7, 'слотов 46 (2D — 7)', C.SLOTS.length);
  for (const s in C.PART_DEFAULT) ok(C.PARTS[s] && C.PARTS[s].list.some(x => x[0] === C.PART_DEFAULT[s]), 'умолчание есть в списке: ' + s);
  ok(JSON.stringify(W.PART_DEF) === JSON.stringify(C.PART_DEFAULT), 'умолчания частей — одни и те же в avatar.js и world3d.js');
  for (const s of C.SLOTS) for (const p of C.PARTS[s].list) ok(/^[a-z0-9]{1,20}$/.test(p[0]) && Number.isInteger(p[2]) && p[2] >= 0, 'id и цена годятся для char_save: ' + s + ':' + p[0]);
  for (const s of C.SLOTS) ok(new Set(C.PARTS[s].list.map(p => p[0])).size === C.PARTS[s].list.length, 'id в слоте не повторяются: ' + s);
  const n = C.norm({ psal: 'zzz', hair: 'nope', pst: 'robot', pcal: 'x12ab34', pch: 'xzz0000', face: 'toon', glove: 'boxing' });
  ok(n.psal === undefined && n.hair === undefined && n.pst === 'robot' && n.pcal === 'x12ab34' && n.pch === undefined && n.face === 'toon' && n.glove === 'boxing', 'norm: мусор отброшен, своё — на месте');
  let same = 0;
  for (const r of ref.looks) {
    const nn = C.norm(r.l), u = C.upgrade(r.l);
    for (const s in r.l) if (C.SLOTS.includes(s) && nn[s] !== undefined) ok(u[s] === nn[s], 'миграция сохранила ' + s, r.k);
    for (const s in C.PART_DEFAULT) ok(u[s] === C.PART_DEFAULT[s], 'миграция: новый слот «как было» ' + s, r.k);
    ok(JSON.stringify(C.upgrade(u)) === JSON.stringify(u), 'миграция повторно ничего не меняет', r.k);
    const R = W.resolve(r.l, r.k), Ru = W.resolve(u, r.k);
    let all = true;
    for (const s in r.R) if (R[s] !== r.R[s]) { all = false; ok(false, 'resolve как раньше: ' + s, r.k + ' ' + R[s] + ' ≠ ' + r.R[s]); }
    for (const s in W.PART_DEF) ok(R[s] === W.PART_DEF[s], 'resolve: новые части «как было» ' + s, r.k);
    ok(JSON.stringify(Ru) === JSON.stringify(R), 'внешность после миграции та же', r.k);
    if (all) same++;
  }
  ok(same === ref.looks.length, 'все старые образы выглядят так же (resolve)', same + '/' + ref.looks.length);
}

// ═══ 2. Цены, пакеты, владение ═══
{
  ok(C.price('skin:pack:robot') === 700 && C.price('skin:pack:knight') === 900 && C.price('skin:pack:base') === 0 && C.price('skin:pack:zzz') === null, 'цены пакетов');
  ok(C.price('skin:psal:robot') === 700 && C.price('skin:psh:robot') === 700 && C.price('skin:psh:cube') === 80, 'цена части = цена пакета / своя');
  ok(C.price('skin:pcal:x00ff00') === 0 && C.price('skin:pcal:yellow') === 0 && C.price('skin:glove:boxing') === 200, 'цвета частей бесплатно, перчатки — по цене');
  ok(C.buyItem('psal', 'robot').item === 'skin:pack:robot' && C.buyItem('psh', 'knight').item === 'skin:pack:knight' && C.buyItem('psh', 'cube').item === 'skin:psh:cube' && C.buyItem('hat', 'crown').item === 'skin:hat:crown', 'что купить: пакет или часть');
  ok(C.owns('psal', 'block') && C.owns('pst', 'base') && C.owns('psh', 'egg') && !C.owns('psal', 'robot') && !C.owns('psh', 'cube'), 'бесплатное — своё, платное — нет');
  owned.add('skin:pack:robot');
  ok(C.owns('psal', 'robot') && C.owns('psar', 'robot') && C.owns('psh', 'robot') && C.owns('pslr', 'robot') && !C.owns('psal', 'knight'), 'купил пакет — все его части');
  const w = C.wearable({ psal: 'robot', psar: 'knight', psh: 'cube', pst: 'chunky', pcal: 'x00ff00' });
  ok(w.psal === 'robot' && w.psar === undefined && w.psh === undefined && w.pst === undefined && w.pcal === 'x00ff00', 'надеть можно только своё', JSON.stringify(w));
  owned.delete('skin:pack:robot');
  for (const s of C.SLOTS) if (C.PARTS[s].pack) for (const p of C.PARTS[s].list) { const pk = C.packOf(s, p[0]); if (pk) ok(pk.price === p[2], 'цена части пакета = цене пакета: ' + s + ':' + p[0]); }
  ok(C.part('psal', 'robot').premium === false && C.packOf('psal', 'robot').premium === false, 'поле «премиум» есть (у пакетов пока нет)');
  // только за 💎: магазин видит цену (price ≠ null), за монеты — нельзя (gemsOf), бесплатной не считается
  for (const [s, id, g] of [['hat', 'gemcrown', 150], ['back', 'gemwings', 300], ['trail', 'gems', 100]]) {
    const p = C.part(s, id), b = C.buyItem(s, id);
    ok(p.gems === g && p.price === g && p.premium && C.price(`skin:${s}:${id}`) === g && C.gemsOf(`skin:${s}:${id}`) === g && b.gems === g && b.item === `skin:${s}:${id}`, 'вещь за 💎: цена в кристаллах', id);
    ok(!C.owns(s, id), 'за 💎 — не своя, пока не куплена', id);
    owned.add(`skin:${s}:${id}`); ok(C.owns(s, id), 'купил в магазине — своя', id); owned.delete(`skin:${s}:${id}`);
  }
  ok(C.gemsOf('skin:hat:crown') === 0 && C.gemsOf('skin:pack:robot') === 0 && C.wearable({ hat: 'gemcrown' }).hat === 'none', 'обычные — за монеты; чужую корону за 💎 не надеть');
}

// ═══ 3. Сборка против эталона старой версии ═══
const hex = (r, g, b) => new T.Color(r, g, b).getHexString();
const _p = new T.Vector3();
const cdist = (a, b) => { const x = parseInt(a, 16), y = parseInt(b, 16); return Math.max(Math.abs((x >> 16) - (y >> 16)), Math.abs(((x >> 8) & 255) - ((y >> 8) & 255)), Math.abs((x & 255) - (y & 255))); };
function measure(K, look, key, bo){
  const ch = K.build(look, key, bo); ch.seed = 0; ch.phase = 0; ch.blinkAt = 0;
  K.animate(ch, false, 0, 0);
  ch.root.updateMatrixWorld(true);
  const wp = o => { const v = new T.Vector3(); o.getWorldPosition(v); return [v.x, v.y, v.z]; };
  const box = new T.Box3(), cols = new Set();
  let meshes = 0, tris = 0, bad = 0;
  ch.root.traverse(o => {
    if (!o.isMesh) return;
    let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
    if (!vis) return;
    meshes++;
    const g = o.geometry, pa = g.attributes.position;
    tris += (g.index ? g.index.count : pa.count) / 3;
    for (let i = 0; i < pa.array.length; i++) if (!Number.isFinite(pa.array[i])) { bad++; break; }
    if (g.index) { const I = g.index.array; for (let i = 0; i < I.length; i++) if (I[i] >= pa.count) { bad++; break; } }
    if (o.parent === ch.root) return;   // тень
    for (let i = 0; i < pa.count; i++) box.expandByPoint(_p.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld));
    const m = o.material;
    if (m.vertexColors && g.attributes.color) { const a = g.attributes.color.array; for (let i = 0; i < a.length; i += 3) cols.add(hex(a[i], a[i + 1], a[i + 2])); }
    else if (m.color && !m.map && !m.transparent) cols.add(m.color.getHexString());
  });
  return { ch, top: ch.top, headY: ch.headY, hipY: ch.hipY, bones: { legL: wp(ch.legL), legR: wp(ch.legR), armL: wp(ch.armL), armR: wp(ch.armR), headP: wp(ch.headP), head: wp(ch.head), handL: wp(ch.handL), handR: wp(ch.handR) }, box, cols, meshes, tris, bad };
}
const kits = { low: W.kit(T, { q: 'low' }), mid: W.kit(T, { q: 'mid' }), high: W.kit(T, { q: 'high' }) };
{
  let maxBone = 0, maxBox = 0, missing = 0, sumOld = 0, sumHi = 0, sumLow = 0, worst = '';
  for (const r of ref.looks) {
    const m = measure(kits.mid, r.l, r.k), hi = measure(kits.high, r.l, r.k), lo = measure(kits.low, r.l, r.k);
    ok(!m.bad && !hi.bad && !lo.bad, 'геометрия без NaN и с верными индексами', r.k);
    ok(near(m.top, r.top, 1e-3) && near(m.headY, r.headY, 1e-3) && near(m.hipY, r.hipY, 1e-3), 'рост, голова, таз — как раньше', r.k + ` top ${m.top.toFixed(3)}/${r.top}`);
    for (const b in r.bones) { const d = Math.hypot(...m.bones[b].map((v, i) => v - r.bones[b][i])); if (d > maxBone) { maxBone = d; worst = r.k + ' ' + b; } ok(d < (b.startsWith('hand') ? .045 : .012), 'кость на месте: ' + b, r.k + ' ' + d.toFixed(4)); }
    const bd = Math.max(...m.box.min.toArray().map((v, i) => Math.abs(v - r.box[0][i])), ...m.box.max.toArray().map((v, i) => Math.abs(v - r.box[1][i])));
    maxBox = Math.max(maxBox, bd);
    ok(bd < .09, 'габариты как раньше (±9 см)', r.k + ' ' + bd.toFixed(3));
    for (const c of r.colors) if (![...m.cols].some(x => cdist(x, c) <= 2)) { missing++; ok(false, 'прежний цвет на месте #' + c, r.k); }
    sumOld += r.meshes; sumHi += hi.meshes; sumLow += lo.meshes;
    ok(hi.meshes <= Math.ceil(r.meshes * 1.2), 'вызовов отрисовки на высоком ≤ +20 %', r.k + ` ${hi.meshes}/${r.meshes}`);
    ok(lo.meshes <= r.meshes, 'вызовов отрисовки на низком ≤ прежнего', r.k + ` ${lo.meshes}/${r.meshes}`);
  }
  console.log(`  эталон: ${ref.looks.length} старых образов; кости — до ${maxBone.toFixed(3)} (${worst}), габариты — до ${maxBox.toFixed(3)}; вызовов отрисовки в среднем было ${(sumOld / ref.looks.length).toFixed(1)}, стало: высокое ${(sumHi / ref.looks.length).toFixed(1)}, низкое ${(sumLow / ref.looks.length).toFixed(1)}`);
}

// ═══ 4. Формы частей, головы, лица, перчатки: геометрия в порядке ═══
{
  const packs = Object.keys(C.PACKS), heads = C.PARTS.psh.list.map(p => p[0]), faces = C.PARTS.face.list.map(p => p[0]), gloves = C.PARTS.glove.list.map(p => p[0]);
  const looks = [];
  for (const p of packs) looks.push({ pst: p, psal: p, psar: p, psll: p, pslr: p, top: 'hoodie', bottom: 'jeans' }, { pst: p, psal: p, psar: packs[(packs.indexOf(p) + 2) % packs.length], psll: p, pslr: 'base', top: 'tshirt', bottom: 'shorts', body: 'girl' }, { pst: p, top: 'dress', body: 'girl', psll: p, pslr: p, hat: 'crown', back: 'cape', neck: 'scarf' });
  heads.forEach((h, i) => looks.push({ psh: h, face: faces[i % faces.length], hair: C.PARTS.hair.list[i * 3 % C.PARTS.hair.list.length][0], hat: C.PARTS.hat.list[i * 2 % C.PARTS.hat.list.length][0], glasses: C.PARTS.glasses.list[i % C.PARTS.glasses.list.length][0], cheek: 'both', lash: 'long' }));
  faces.forEach(f => C.PARTS.eyes.list.forEach(e => looks.push({ face: f, eyes: e[0], mouth: C.PARTS.mouth.list[e[0].length % C.PARTS.mouth.list.length][0] })));
  gloves.forEach(g => looks.push({ glove: g, glovec: 'x33cc99', psal: 'block' }, { glove: g, item: 'balloon' }));
  let n = 0, tri0 = 0, tri1 = 0;
  for (const q of ['low', 'high']) for (const [i, l] of looks.entries()) for (const lod of [0, 1]) {
    const m = measure(kits[q], l, 'shape' + i, { lod });
    n++;
    ok(!m.bad, 'геометрия без NaN и с верными индексами', q + ' ' + JSON.stringify(l));
    const b = m.box;
    ok(b.min.x > -2.3 && b.max.x < 2.3 && b.min.y > -.25 && b.max.y < 3.8 && b.min.z > -2.1 && b.max.z < 2.1, 'размеры разумные', JSON.stringify(l) + ' ' + JSON.stringify([b.min, b.max]));
    ok(m.top > 1.5 && m.top < 3.6, 'высота для подписи разумная', m.top);
    if (q === 'high') { if (lod) tri1 += m.tris; else tri0 += m.tris; }
    // нормали — единичные
    let badN = 0;
    m.ch.root.traverse(o => { if (!o.isMesh || !o.geometry.attributes.normal) return; const a = o.geometry.attributes.normal.array; for (let k = 0; k < a.length; k += 3) { const L = Math.hypot(a[k], a[k + 1], a[k + 2]); if (L > 0 && Math.abs(L - 1) > .03) badN++; } });
    ok(!badN, 'нормали единичные', badN);
  }
  ok(tri1 < tri0 * .5, 'дальний человечек (LOD) — меньше половины треугольников', `${Math.round(tri1)} / ${Math.round(tri0)}`);
  console.log(`  формы: ${looks.length} образов × 2 качества × 2 LOD = ${n} сборок; треугольников на высоком: вблизи ${Math.round(tri0 / looks.length)}, вдали ${Math.round(tri1 / looks.length)}`);
}

// ═══ 5. Перекраска палитрой (без пересборки) ═══
{
  const K = kits.high;
  const look = { color: 'red', tone: 't3', pcal: 'auto', psal: 'robot', pcar: 'x22aa44', hairc: 'blond', trim: 'auto', top: 'tshirt', glove: 'wrist', glovec: 'auto' };
  const m = measure(K, look, 'rc');
  const has = (ch, c) => { let f = false; ch.root.traverse(o => { if (!o.isMesh || !o.geometry.attributes.color) return; const a = o.geometry.attributes.color.array; for (let i = 0; i < a.length && !f; i += 3) if (cdist(hex(a[i], a[i + 1], a[i + 2]), c) <= 2) f = true; }); return f; };
  ok(K.recolor(m.ch, { ...look, color: 'x123456', tone: 'xaabbcc', pcar: 'x0000ff', pcal: 'xff0000', trim: 'x00ffee', glovec: 'xffff00' }), 'перекраска без пересборки');
  ok(has(m.ch, '123456') && has(m.ch, 'aabbcc') && has(m.ch, '0000ff') && has(m.ch, 'ff0000') && has(m.ch, '00ffee') && has(m.ch, 'ffff00'), 'новые цвета в вершинах (одежда, кожа, части тела, отделка, перчатки)');
  ok(!K.recolor(m.ch, { ...look, psal: 'base' }), 'другая форма части — пересборка');
  ok(!K.recolor(m.ch, { ...look, color: 'gold' }), 'особый материал — пересборка');
  ok(!K.recolor(m.ch, { ...look, hatc: 'red', hat: 'crown' }), 'другая шапка — пересборка');
}

// ═══ 6. Анимация: все состояния и эмоции без NaN, без рывков при смене состояния ═══
{
  const K = kits.high, J = 28;
  const chs = [{}, { psal: 'robot', pst: 'knight', psll: 'chunky' }, { psh: 'cube', pst: 'block', back: 'wings', hair: 'twintails' }].map((l, i) => K.build(l, 'anim' + i));
  const o = { rate: 10.5, air: false, sit: false, crouch: 0, roll: -1, rollBack: false, hang: false, ladder: false, climbPh: 0, pk: '', pkK: 0, swim: false, dive: false, look: null };
  const plan = [['стоит', 60, {}, 0], ['идёт', 90, {}, 1], ['бежит', 60, { rate: 13 }, 1], ['остановился', 60, {}, 0], ['присел', 40, { crouch: 1 }, 0], ['прыжок', 30, { air: true }, 1], ['приземлился', 30, {}, 0],
    ['сел', 50, { sit: true }, 0], ['встал', 30, {}, 0], ['плывёт', 80, { swim: true }, 1], ['держится на воде', 50, { swim: true }, 0], ['нырнул', 40, { swim: true, dive: true }, 1], ['вышел', 30, {}, 0],
    ['кувырок', 30, { roll: 'k' }, 1], ['вис', 40, { hang: true }, 1], ['лестница', 50, { ladder: true }, 1], ['перелез', 40, { pk: 'vault' }, 1], ['подтянулся', 40, { pk: 'mantle' }, 1], ['смотрит', 60, { look: { x: 3, y: 1.7, z: 4 } }, 0]];
  let t = 0, worstJump = 0, worstName = '', nan = 0;
  const prev = new Float32Array(J);
  const wrapA = a => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
  for (const ch of chs) {
    t = 0; ch.P.set(ch.P);
    for (const [name, frames, set, mv] of plan) {
      for (let f = 0; f < frames; f++) {
        t += 1 / 60;
        Object.assign(o, { rate: 10.5, air: false, sit: false, crouch: 0, roll: -1, hang: false, ladder: false, pk: '', pkK: 0, swim: false, dive: false, look: null }, set);
        if (set.roll) o.roll = f / frames;
        if (set.pk) o.pkK = f / frames;
        if (set.ladder) o.climbPh = t * 6;
        prev.set(ch.P);
        K.animate(ch, !!mv, 1 / 60, t, o);
        for (let j = 0; j < J; j++) {
          if (!Number.isFinite(ch.P[j])) nan++;
          const d = Math.abs(wrapA(ch.P[j] - prev[j]));
          // кувырок и гребок крутят быстро по замыслу; остальное — плавно (рывок — смена позы за кадр)
          if (f > 0 && name !== 'кувырок' && name !== 'плывёт' && j !== 2 && d > worstJump) { worstJump = d; worstName = name + ' / сустав ' + j; }
          if (f === 0 && d > .35) ok(false, 'смена состояния без рывка: ' + name, 'сустав ' + j + ' на ' + d.toFixed(2));
        }
      }
    }
    for (const e of W.EMOTES) { ch.emote = e; ch.emoteT = t; for (let f = 0; f < 200; f++) { t += 1 / 60; prev.set(ch.P); K.animate(ch, false, 1 / 60, t, null); for (let j = 0; j < J; j++) { if (!Number.isFinite(ch.P[j])) nan++; if (e !== '🤸' && Math.abs(wrapA(ch.P[j] - prev[j])) > .45) ok(false, 'эмоция без рывка: ' + e, 'сустав ' + j); } } ok(ch.expr === 'base' && ch.emote === null, 'эмоция кончилась — обычное лицо', e); }
    ok(ch.sets.size > 6, 'выражения лица строятся при эмоциях', ch.sets.size);
  }
  ok(!nan, 'нет NaN в позе', nan);
  ok(worstJump < .65, 'внутри состояния — без рывков', worstJump.toFixed(3) + ' ' + worstName);
  // snap: поза зависит только от (ch.phase, t, o) — для запекания спрайтов (js/core/char2d.js) и картинок
  {
    const a = K.build({ hair: 'ponytail', back: 'cape' }, 'snap'), b = K.build({ hair: 'ponytail', back: 'cape' }, 'snap');
    for (let f = 0; f < 200; f++) K.animate(a, f % 50 < 30, 1 / 60, f / 60, { rate: 13, air: f % 70 > 60, look: { x: 1, y: 1, z: 3 } });   // у «a» — своя история
    let same = true;
    for (const [mv, o] of [[true, { snap: true, rate: 10.5 }], [true, { snap: true, rate: 13 }], [false, { snap: true, sit: true }], [false, { snap: true, swim: true }], [true, { snap: true, roll: .4 }], [false, { snap: true, air: true, land: .5 }], [false, { snap: true, crouch: 1 }]]) {
      a.phase = b.phase = 1.234;
      K.animate(a, mv, 0, 5, o); K.animate(b, mv, 0, 5, o);
      for (let j = 0; j < 28; j++) if (Math.abs(a.P[j] - b.P[j]) > 1e-6) same = false;
    }
    ok(same, 'snap: одна и та же поза при любой истории');
    a.emote = b.emote = '🎉'; a.emoteT = b.emoteT = 4.5;
    K.animate(a, false, 0, 5, { snap: true }); K.animate(b, false, 0, 5, { snap: true });
    ok(a.expr === 'joy' && b.expr === 'joy' && a.P.every((v, j) => Math.abs(v - b.P[j]) < 1e-6), 'snap: эмоция — та же поза и лицо');
    ok(a.faceSet.userData.eyes.scale.y === 1, 'snap: без случайного моргания');
    ok(W.CHAR_VERSION >= 2 && a.armL.userData.La > 0 && a.armL.userData.hand === a.handL, 'версия внешности и старые поля руки (La, hand)');
  }
  // дальний человечек — выражений не строит, лицо обычное
  const far = K.build({}, 'far', { lod: 1 }); far.emote = '😂'; far.emoteT = 0; K.animate(far, false, 1 / 60, .5, null);
  ok(far.sets.size === 1 && far.faceSet === far.sets.get('base'), 'вдали — без выражений (дешевле)');
  // взгляд: голова поворачивается к точке, за спиной — нет
  const ch = K.build({}, 'look'); ch.root.rotation.y = 0;
  for (let f = 0; f < 120; f++) K.animate(ch, false, 1 / 60, f / 60, { look: { x: 3, y: 1.6, z: 3 } });
  ok(ch.headP.rotation.y > .45, 'смотрит на соседа справа', ch.headP.rotation.y.toFixed(2));
  for (let f = 0; f < 120; f++) K.animate(ch, false, 1 / 60, 2 + f / 60, { look: { x: 0, y: 1.6, z: -5 } });
  ok(Math.abs(ch.headP.rotation.y) < .1, 'за спиной — голову не выворачивает', ch.headP.rotation.y.toFixed(2));
}

// ═══ 7. Кадр без мусора (отдельный процесс) ═══
{
  const r = cp.spawnSync(process.execPath, ['--expose-gc', '--max-semi-space-size=128', __filename, threePath, '--alloc'], { encoding: 'utf8', timeout: 180000 });
  let res = null;
  try { res = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (e) {}
  // до 32 байт — упакованные числа-аргументы (время) на вызове; объект или массив за кадр дали бы больше
  ok(res && res.perCall < 32, 'анимация не мусорит (байт на кадр человечка)', res ? res.perCall.toFixed(1) : (r.stderr || r.stdout || '').slice(0, 300));
  if (res) console.log(`  анимация: ${res.perCall.toFixed(1)} байт на кадр человечка (все состояния, эмоции, аксессуары)`);
}

// ═══ 8. coins.sql пересобран из PARTS (scripts/gen-skin-sql.mjs) ═══
{
  const sql = fs.readFileSync(path.join(SITE, 'coins.sql'), 'utf8');
  let miss = 0;
  const gemItems = [];
  for (const s of C.SLOTS) for (const p of C.PARTS[s].list) {
    if (p[5]) { gemItems.push(`'skin:${s}:${p[0]}'`); ok(!new RegExp(`\\('skin:${s}:${p[0]}', \\d+\\)`).test(sql), 'вещь за 💎 не продаётся за монеты', p[0]); continue; }
    if (!sql.includes(`('skin:${s}:${p[0]}', ${p[2]})`)) { miss++; if (miss < 5) ok(false, 'цена в coins.sql', `skin:${s}:${p[0]}`); }
  }
  ok(gemItems.length === 3 && sql.includes(`select p_item in (${gemItems.join(', ')})`), 'coin_gems_item — все вещи только за 💎', gemItems.join(', '));
  for (const [id, p] of Object.entries(C.PACKS)) if (!sql.includes(`('skin:pack:${id}', ${p[1]})`)) { miss++; ok(false, 'цена пакета в coins.sql', id); }
  ok(!miss, 'все цены частей и пакетов — в coins.sql', miss);
  ok(sql.includes(`foreach slot in array array[${C.SLOTS.map(s => `'${s}'`).join(', ')}] loop`), 'char_save знает все слоты');
  const packSlots = C.SLOTS.filter(s => C.PARTS[s].pack);
  ok(sql.includes(`if slot = any(array[${packSlots.map(s => `'${s}'`).join(', ')}]) and public.coin_price('skin:pack:' || val) is not null then item := 'skin:pack:' || val;`), 'char_save: части пакетов — по купленному пакету');
  ok(sql.includes(`and slot = any(array[${C.SLOTS.filter(s => C.PARTS[s].pal).map(s => `'${s}'`).join(', ')}]) then clean`), 'char_save: свои цвета у всех палитр');
}

console.log(`${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);
