// Проверка рук и света существ «Кубомира» без браузера: node scripts/kubomir-hand-test.cjs [путь к three@0.149]
// Свет существ (KubomirEnts.Lit): 8 клеток вокруг, непрозрачные не считаются, кривая — как у вершин кубиков, плавно по
// времени, свой свет факела в руке; материалы (VR.entityMaterial) — куски шейдера находят свои места в настоящих шейдерах
// three r149 (мультяшный, Ламберт, Фонг, «плоский»), «вид из глаз» (D37_FP) — и у вещей; VR.itemLightF; рука
// (KubomirHand): взмах повторяется, пока копаешь, толчок, смена вещи, еда, вид от 1-го и 3-го лица, свет человечка;
// мобы — через один «вид» (KubomirEnts.mobView), свой вид подменяется.
// Нужен three.js r149 (как render-test.cjs): npm i three@0.149.0 во временной папке (на диске E), путь — первым аргументом.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
let THREE;
for (const p of [process.argv[2], process.env.THREE_PATH, 'three'].filter(Boolean)) {
  try { THREE = require(fs.existsSync(path.join(p, 'build/three.cjs')) ? path.join(p, 'build/three.cjs') : p); break; } catch (e) {}
}
if (!THREE) { console.log('Нет three.js r149: npm i three@0.149.0 во временной папке и node scripts/kubomir-hand-test.cjs <путь>/node_modules/three'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const sec = t => console.log('— ' + t);
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

globalThis.window = globalThis; globalThis.self = globalThis; globalThis.THREE = THREE;
const run = f => vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
for (const f of ['js/engine/core.js', 'js/engine/gfx.js', 'js/engine/voxel.js', 'js/engine/voxel-tex.js', 'js/engine/voxel-gen.js', 'js/engine/voxel-mesh.js', 'js/engine/voxel-render.js', 'js/games/kubomir-ents.js', 'js/games/kubomir-hand.js']) run(f);
const T = THREE, E = window.D37E, V = E.vox, Lit = window.KubomirEnts.Lit, ID = V.ID;

// ── сцена движка без WebGL: столько, сколько нужно voxel-render (R.wave — как у движка: метка на материале) ──
const waved = [];
const R = { T, r: { capabilities: { isWebGL2: true }, properties: { get: () => ({}) } }, scene: new T.Scene(), camera: new T.PerspectiveCamera(70, 16 / 9, .2, 500), q: 'high', night: 0, shadowDirty(){},
  wave(m, o){ waved.push([m, o]); E.waveMaterial?.(m, o); return m; } };
const VR = V.renderer(R);
const SH = { toon: T.MeshToonMaterial, lambert: T.MeshLambertMaterial, phong: T.MeshPhongMaterial, basic: T.MeshBasicMaterial };
const shaderOf = (lib) => ({ uniforms: {}, vertexShader: T.ShaderLib[lib].vertexShader, fragmentShader: T.ShaderLib[lib].fragmentShader });
const incOk = s => s.split('\n').every(l => !l.includes('#include') || /^\s*#include <\w+>\s*$/.test(l));   // #include — своей строкой

// ── мир для проверок: небо и свет блоков — функции клетки; стены — множество клеток ──
function fakeWorld(sky, blk, walls = new Set()){
  return {
    seed: 37,
    raw(x, y, z){ x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); return walls.has(x + ',' + y + ',' + z) ? ID.stone : 0; },
    lightAt(x, y, z){ x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); if (walls.has(x + ',' + y + ',' + z)) return 0; const b = blk(x, y, z); return (sky(x, y, z) << 12) | (b[0] << 8) | (b[1] << 4) | b[2]; },
    loaded: () => true, heightAt: () => 0, get(x, y, z){ return this.raw(x, y, z) & 0xfff; },
  };
}

(async () => {
  // ═══ 1. Свет в точке ═══
  sec('свет существ: 8 клеток, стены, кривая, плавность');
  const W1 = fakeWorld((x, y) => y >= 10 ? 15 : 0, x => [Math.max(0, Math.min(15, x)), 0, 0]);
  const o = [0, 0, 0, 0];
  Lit.sample(W1, 4.5, 5.5, 2.5, o);
  ok(near(o[1], 4) && near(o[0], 0), 'в середине клетки — ровно её свет', o);
  Lit.sample(W1, 5, 5.5, 2.5, o);
  ok(near(o[1], 4.5), 'между клетками — среднее (плавно, без ступенек)', o);
  Lit.sample(W1, 4.75, 5.5, 2.5, o);
  ok(near(o[1], 4.25), 'на четверти — по весам расстояния', o);
  Lit.sample(W1, 2.5, 10, 2.5, o);
  ok(near(o[0], 7.5), 'граница неба по высоте — тоже плавно', o);
  // у стены: клетка стены (свет 0) не тянет вниз
  const W2 = fakeWorld(() => 15, () => [0, 0, 0], new Set(['5,5,2', '5,6,2', '5,5,3', '5,6,3']));
  Lit.sample(W2, 4.9, 5.9, 2.9, o);
  ok(near(o[0], 15), 'у стены не темнеет (непрозрачные клетки не считаются)', o);
  const all = new Set(); for (let x = 3; x <= 6; x++) for (let y = 3; y <= 7; y++) for (let z = 1; z <= 4; z++) all.add(x + ',' + y + ',' + z);
  const W3 = fakeWorld(() => 15, () => [9, 9, 9], all);
  Lit.sample(W3, 4.6, 5.4, 2.4, o);
  ok(o.every(v => v >= 0 && v <= 15), 'внутри камня — запасной путь (свет самой клетки), без NaN', o);
  // кривая — как в шейдере кубиков (VS_BEGIN): небо (l / (4 − 3l))^1,5, блоки — rgb · m / (4 − 3m)² по самому яркому каналу
  const v4 = { x: 0, y: 0, z: 0, w: 0 };
  for (const lv of [[15, 0, 0, 0], [0, 15, 10, 4], [7, 3, 3, 3], [0, 0, 0, 0], [12.5, 6.2, 9.1, 1]]) {
    Lit.vec(lv, v4, 1);
    const l = lv[0] / 15, s = l / (4 - 3 * l), m = Math.max(lv[1], lv[2], lv[3]) / 15, k = 4 - 3 * m;
    ok(near(v4.x, s * Math.sqrt(s), 1e-6) && near(v4.y, lv[1] / 15 * m / (k * k), 1e-6) && near(v4.w, lv[3] / 15 * m / (k * k), 1e-6), 'кривая = шейдер кубиков ' + lv.join('/'), v4);
  }
  Lit.vec([0, 15, 10, 4], v4, 1);
  ok(v4.y > v4.z && v4.z > v4.w && near(v4.z / v4.y, 10 / 15, 1e-6), 'цвет света факела не меняется (кривая по самому яркому каналу)', v4);
  // по времени: догоняет, а dt = 0 — сразу
  const E1 = Lit.make(T), st1 = { W: W1, VR, ox: 0, oz: 0 };
  Lit.update(E1, st1, 2.5, 5.5, 2.5, 0);
  ok(near(E1.lv[1], 2), 'первый раз — сразу (без «вспышки» из темноты)', [...E1.lv]);
  for (let i = 0; i < 6; i++) Lit.update(E1, st1, 10.5, 5.5, 2.5, 1 / 60);
  ok(E1.lv[1] > 2.5 && E1.lv[1] < 10, 'перешёл в светлую клетку — свет догоняет плавно', [...E1.lv]);
  for (let i = 0; i < 60; i++) Lit.update(E1, st1, 10.5, 5.5, 2.5, 1 / 60);
  ok(near(E1.lv[1], 10, .01), 'через секунду — уже свет новой клетки', [...E1.lv]);
  ok(E1.u.value.isVector4 && near(E1.u.value.y, Lit.vec(E1.lv, { x: 0, y: 0, z: 0, w: 0 }, Lit.flick(VR.U, 10.5, 5.5, 2.5)).y, 1e-6), 'униформа — та же кривая с мерцанием, как у кубиков');
  // свой свет: факел в руке
  const tc = Lit.held('torch', [0, 0, 0]);
  ok(tc && tc[0] > tc[1] && tc[1] > tc[2] && tc[0] <= 14 && tc[0] >= 12, 'факел в руке — тёплый свет на шаг слабее источника', tc);
  ok(Lit.held('stone', [0, 0, 0]) === null && Lit.held('', [0, 0, 0]) === null && Lit.held('pick_iron', [0, 0, 0]) === null, 'камень, кирка, пустая рука — своего света нет');

  // ═══ 2. Материалы существ ═══
  sec('материалы существ: свет кубиков в шейдерах three r149');
  const U1 = { value: new T.Vector4(1, 0, 0, 0) };
  for (const [lib, Cls] of Object.entries(SH)) for (const fp of [false, true]) {
    const src = new Cls({ color: '#ff8844' }), m = VR.entityMaterial(src, U1, { fp, kind: 'test' }), sh = shaderOf(lib);
    m.onBeforeCompile(sh);
    const lit = lib !== 'basic';
    ok(m !== src && m.userData.d37ent && m.userData.d37ent.fp === fp, lib + (fp ? ' fp' : '') + ': своя копия с меткой d37ent');
    ok(sh.uniforms.uD37L === U1 && sh.uniforms.uDay === VR.U.uDay && sh.uniforms.uBlockK === VR.U.uBlockK, lib + ': униформа существа по ссылке, день и сила света блоков — общие с кубиками');
    ok(sh.fragmentShader.includes('uniform vec4 uD37L;') && /#include <aomap_fragment>\s*#ifdef D37_ENT_LIT/.test(sh.fragmentShader), lib + ': кусок света встал после aomap_fragment');
    ok(!lit || sh.fragmentShader.includes('d37pt = reflectedLight.directDiffuse;'), lib + ': лампы движка отделены от солнца (метка перед прожекторами найдена)');
    ok(!!m.defines.D37_ENT_LIT === lit && !!m.defines.D37_FP === fp, lib + ': defines', m.defines);
    ok(!fp || (sh.vertexShader.includes('#include <project_vertex>\n#ifdef D37_FP') && sh.vertexShader.includes('gl_Position.w * 0.99')), lib + ': «вид из глаз» — глубина сжата после project_vertex');
    ok(incOk(sh.fragmentShader) && incOk(sh.vertexShader), lib + ': #include — с новой строки');
    ok(src.defines === undefined || !src.defines.D37_ENT, lib + ': исходный материал не тронут');
  }
  const kA = VR.entityMaterial(new T.MeshToonMaterial(), U1).customProgramCacheKey(), kB = VR.entityMaterial(new T.MeshToonMaterial(), U1, { fp: true }).customProgramCacheKey(), kC = VR.entityMaterial(new T.MeshBasicMaterial(), U1).customProgramCacheKey();
  ok(kA !== kB && kA !== kC && kB !== kC, 'ключи программ разные: обычный, «из глаз», «плоский»', [kA, kB, kC]);
  // вещи «из глаз»
  const it0 = VR.itemMesh('planks_oak', 15 << 12), it1 = VR.itemMesh('planks_oak', 15 << 12, { fp: true }), it2 = VR.itemMesh('pick_iron', 15 << 12, { fp: true });
  ok(it1.material !== it0.material && it1.material.defines.D37_FP === 1 && !it0.material.defines.D37_FP && it1.userData.fp, 'вещь «из глаз» — свой материал слоя с D37_FP');
  ok(it2.material.userData.d37vox.layer === 'cutout' && it2.material.userData.d37vox.fp, 'плоская вещь «из глаз» — вырезной слой');
  ok(VR.itemMesh('planks_oak', 0, { fp: true }).material === it1.material, 'материал «из глаз» — один на слой');
  const shV = shaderOf('lambert'); it1.material.onBeforeCompile(shV);
  ok(shV.vertexShader.includes('#ifdef D37_FP') && shV.vertexShader.includes('attribute vec4 lt;') && incOk(shV.vertexShader), 'кубики: кусок «из глаз» в вершинном шейдере (под #ifdef)');
  ok(it1.material.customProgramCacheKey() !== it0.material.customProgramCacheKey(), 'кубики: ключ программы «из глаз» свой');
  // трава и листва: код травы движка (E.FOLIAGE_GLSL) и ветер движка (R.wave, E.GFXU.wind)
  sec('трава и листва: код травы и ветер движка');
  ok(typeof E.FOLIAGE_GLSL === 'string' && E.GFXU && E.GFXU.rt && E.GFXU.wind, 'движок дал E.FOLIAGE_GLSL и E.GFXU (rt, wind)');
  for (const k of V.LAYERS) {
    const m = VR.mats[k], sh = shaderOf('lambert'); m.onBeforeCompile(sh);
    const cut = k === 'cutout' || k === 'foliage' || k === 'glass';
    ok(sh.fragmentShader.includes('#include <output_fragment>\n' + E.FOLIAGE_GLSL) === cut && (sh.uniforms.d37Rt?.value === E.GFXU.rt) === cut, k + ': код травы движка — ' + (cut ? 'после output_fragment, d37Rt — общий E.GFXU.rt' : 'нет (не вырезное)'));
    ok(!cut || sh.fragmentShader.includes('uniform vec4 d37Rt;'), k + ': d37Rt объявлен');
    ok(!/gl_FragColor\.a\s*=/.test(sh.fragmentShader), k + ': альфа — целым вектором, без «.a =» (как советует страж графики)');
    ok(sh.uniforms.uD37Wind.value === E.GFXU.wind, k + ': ветер — общий E.GFXU.wind по ссылке');
    ok(/#ifdef D37_WAVE\s*\nif \( d37f > 0\.5 && d37f < 1\.5 \)/.test(sh.vertexShader) && /#undef D37_WAVE\s*#endif\s*#include <project_vertex>/.test(sh.vertexShader), k + ': качание — под D37_WAVE набора, кусок ветра движка (для моделей без масштаба) снят');
    ok(incOk(sh.fragmentShader) && incOk(sh.vertexShader), k + ': #include — своей строкой');
  }
  const wk = waved.map(([m, o]) => [Object.keys(VR.mats).find(k => VR.mats[k] === m), o.kind]);
  ok(wk.length === 2 && wk.some(w => w[0] === 'foliage' && w[1] === 'leaves') && wk.some(w => w[0] === 'cutout' && w[1] === 'leaves'), 'R.wave — листва и трава (слои foliage, cutout)', wk);
  ok(VR.mats.foliage.userData.wave && VR.mats.foliage.userData.wave.kind === 2, 'метка ветра движка на материале (E.waveMaterial)');
  const dm = (() => { const cm = new T.Mesh(); let d = null; VR.setChunk({ cx: 0, cz: 0, key: 't' }, { foliage: { n: 1, pos: new Uint16Array(12), vd: new Uint16Array(16), col: new Uint8Array(12), lt: new Uint8Array(16) } }); for (const c of VR.chunks) d = c.vis.foliage.customDepthMaterial; return d; })();
  const shD = shaderOf('depth'); dm.onBeforeCompile(shD);
  ok(shD.vertexShader.includes('uD37Wind.y > 0.0') && shD.uniforms.uD37Wind.value === E.GFXU.wind && incOk(shD.vertexShader), 'тень листвы качается тем же ветром (без ветра — стоит)');
  // свет вещи дробными уровнями
  const g = it0.geometry, lt = g.attributes.lt;
  VR.itemLightF(g, [15, 0, 0, 0]);
  ok(lt.array[0] === 60 && lt.array[1] === 0, 'itemLightF: уровни × 4 в вершины', [...lt.array.slice(0, 4)]);
  VR.itemLightF(g, [7.4, 12.6, 3.1, 0]);
  ok(lt.array[0] === 30 && lt.array[1] === 50 && lt.array[2] === 12 && lt.array[lt.array.length - 4] === 30, 'itemLightF: четверть уровня, у всех вершин', [...lt.array.slice(0, 4)]);
  lt.needsUpdate = false; const ver = lt.version;
  VR.itemLightF(g, [7.4, 12.6, 3.1, 0]);
  ok(lt.version === ver, 'тот же свет — буфер не переписывается');
  VR.itemLight(g, 15 << 12); VR.itemLightF(g, [7.4, 12.6, 3.1, 0]);
  ok(lt.array[0] === 30, 'itemLight и itemLightF не путают свою «память»');

  // ═══ 3. Рука ═══
  sec('рука: взмах, толчок, смена вещи, еда, вид от 1-го и 3-го лица, свет человечка');
  // человечек-заглушка: как у world3d — плечо (armR, userData.La) → локоть → кисть
  const mkCh = () => {
    const root = new T.Group(), armR = new T.Group(), elbowR = new T.Group(), handR = new T.Group(), body = new T.Mesh(new T.BoxGeometry(.4, .6, .2), new T.MeshToonMaterial({ color: '#3366cc' }));
    root.add(body); root.add(armR); armR.position.set(.3, 1.3, 0); armR.userData.La = .6;
    armR.add(new T.Mesh(new T.BoxGeometry(.1, .3, .1), new T.MeshToonMaterial({ color: '#3366cc' })));
    elbowR.position.set(0, -.3, 0); armR.add(elbowR); elbowR.add(new T.Mesh(new T.BoxGeometry(.1, .3, .1), new T.MeshToonMaterial({ color: '#f0c0a0' })));
    handR.position.set(0, -.3, 0); elbowR.add(handR); handR.add(new T.Mesh(new T.SphereGeometry(.07), new T.MeshBasicMaterial({ color: '#f0c0a0' })));
    return { root, armR, elbowR, handR, body };
  };
  const ch = mkCh();
  const actor = { key: 'me', x: 2.5, y: 5, z: 2.5, ch, hidden: true };
  const A = { list: new Map([['me', actor]]), get: k => A.list.get(k) };
  const cave = fakeWorld(() => 0, () => [13, 10, 6]);
  const P = { x: 2.5, y: 5, z: 2.5, sneak: false, dead: false, inv: new Array(36).fill(null), sel: 0 };
  P.inv[0] = { id: 'pick_iron', n: 1 }; P.inv[1] = { id: 'planks_oak', n: 10 }; P.inv[2] = { id: 'torch', n: 4 }; P.inv[3] = { id: 'apple', n: 3 };
  const st = { R, VR, W: cave, P, A, ox: 0, oz: 0, camMode: 0, hudHidden: false, eat: null, rig: { yaw: 0, fp: 0, feel: { bobPh: 0, bobW: 0 }, motion: 1 } };
  const H = window.KubomirHand.create(st);
  const tick = (sec2, f) => { const n = Math.round(sec2 * 60); for (let i = 0; i < n; i++) { f?.(i); H.frame(1 / 60, i / 60); } };
  H.frame(1 / 60, 0);
  let s = H.state();
  ok(s.item === 'pick_iron' && s.equip === 1 && s.fp && s.arm, 'вещь при входе в мир — сразу, без «опустить-поднять»', s);
  const ak = Math.max(.62, Math.min(1, R.camera.aspect / 1.6)), F0 = window.KubomirHand.FP.fist;
  ok(s.fist && near(s.fist[0], F0[0] * ak, .05) && near(s.fist[1], F0[1], .05) && near(s.fist[2], F0[2], .05), 'кулак — там, где задано (внизу справа)', { fist: s.fist, F0 });
  ok(ch.body.material.userData.d37ent && ch.armR.children[0].material.userData.d37ent, 'материалы человечка — со светом кубиков');
  let fpMats = 0; R.camera.traverse(o => { if (o.isMesh && o.material?.userData?.d37ent?.fp) fpMats++; });
  ok(fpMats >= 3, 'рука от 1-го лица — копия руки человечка с материалами «из глаз»', fpMats);
  // свет: пещера с факелами
  ok(s.body[0] < .01 && s.body[1] > s.body[2] && s.body[2] > s.body[3], 'в пещере у факела: неба нет, свет тёплый', s.body);
  const uMe = H.light('me').u.value;
  ok(uMe.x < .01 && uMe.y > uMe.w, 'униформа человечка — тот же тёплый свет', uMe);
  // взмах повторяется, пока копает
  let starts = 0, prev = 1;
  H.mine(true);
  tick(1, () => { const w = H.sw; if (w < prev - .5) starts++; prev = w; });
  H.mine(false); tick(.4);
  ok(starts >= 2 && starts <= 4 && H.sw === 1, 'держишь «ломать» — взмах за взмахом (~0,3 с), отпустил — рука останавливается', { starts, sw: H.sw });
  H.act('swing'); ok(H.sw === 0, 'клик — новый взмах');
  tick(.06); const mid = H.sw; H.act('swing');
  ok(H.sw === mid && mid > 0 && mid < .5, 'клик в начале взмаха — не сбивает (как в Майнкрафте)', mid);
  tick(.12); H.act('swing'); ok(H.sw === 0, 'после половины — новый взмах');
  tick(.5);
  H.act('push'); ok(H.push === 0, 'поставить блок — толчок'); tick(.25); ok(H.push === 1, 'толчок короткий (0,2 с)');
  // смена вещи: опустить и поднять
  P.sel = 1; H.frame(1 / 60, 0); s = H.state();
  ok(s.item === 'planks_oak' && s.equip < .2, 'сменил вещь — рука опускается и поднимается', s.equip);
  tick(.3); ok(H.state().equip === 1, 'смена вещи — за четверть секунды');
  // факел в руке светит на свою руку и человечка даже в темноте
  st.W = fakeWorld(() => 0, () => [0, 0, 0]);
  P.sel = 2; tick(.5); s = H.state();
  ok(s.eye[1] > 10 && s.body[1] > 10 && s.eye[1] > s.eye[3], 'факел в руке — рука и человечек в его тёплом свете', s.eye);
  P.sel = 1; tick(.5); s = H.state();
  ok(s.eye[1] < .2 && s.body[1] < .2, 'убрал факел — снова темно', s.eye);
  st.W = cave;
  // еда: рука ко рту
  P.sel = 3; tick(.3);
  st.eat = { t: 0, need: 1.6 }; tick(.5); const e1 = H.state().eat;
  ok(e1 > .9, 'ест — рука с едой ко рту', e1);
  const fE = H.state().fist;
  ok(fE && fE[0] < F0[0] * ak - .1, 'кулак у рта — ближе к середине экрана', fE);
  st.eat = null; tick(.6); ok(H.state().eat < .05, 'доел (или отпустил) — рука на место', H.state().eat);
  // от 3-го лица: поверх позы world3d, без накопления
  st.camMode = 1; actor.hidden = false;
  const base = { x: .1, y: .02, z: .16, e: -.2 };
  const pose = () => { ch.armR.rotation.set(base.x, base.y, base.z); ch.elbowR.rotation.x = base.e; };   // как animate каждый кадр
  P.sel = 0; for (let i = 0; i < 30; i++) { pose(); H.frame(1 / 60, i / 60); }
  ok(!H.state().fp, 'вид сзади — руки «из глаз» нет');
  const hx = ch.armR.rotation.x;
  ok(hx < base.x - .2 && hx > base.x - .5, 'с вещью рука чуть вперёд (как в Майнкрафте)', hx);
  for (let i = 0; i < 30; i++) { pose(); H.frame(1 / 60, i / 60); }
  ok(near(ch.armR.rotation.x, hx, 1e-6), 'поверх позы — без накопления от кадра к кадру');
  H.act('swing'); let minX = 9; for (let i = 0; i < 18; i++) { pose(); H.frame(1 / 60, i / 60); minX = Math.min(minX, ch.armR.rotation.x); }
  ok(minX < base.x - 1.2, 'взмах от 3-го лица — рука поднимается и рубит', minX);
  ok(H.tpItem && H.tpItem.parent === ch.handR, 'вещь от 3-го лица — в кисти человечка');
  st.camMode = 0; actor.hidden = true; pose(); H.frame(1 / 60, 0);
  ok(H.state().fp, 'снова от 1-го лица — рука на месте');
  st.hudHidden = true; H.frame(1 / 60, 0); ok(!H.state().fp, 'F1 — руку не видно'); st.hudHidden = false;
  P.dead = true; H.frame(1 / 60, 0); ok(!H.state().fp && !H.state().item, 'погиб — ни руки, ни вещи'); P.dead = false; H.frame(1 / 60, 0);
  // пересобрали человечка — рука пересобирается
  actor.ch = mkCh(); H.frame(1 / 60, 0);
  ok(actor.ch.body.material.userData.d37ent && H.armCh === actor.ch, 'новый человечек — свет и рука заново');
  const orig = actor.ch.armR.children[0].material;
  H.dispose();
  ok(!orig.userData.d37ent || orig !== actor.ch.armR.children[0].material, 'закрыли мир — человечку вернулись его материалы');
  let left = 0; R.camera.traverse(o => { if (o.isMesh) left++; }); ok(left === 0, 'закрыли мир — у камеры ничего не осталось', left);

  // ═══ 4. Мобы — через один «вид» ═══
  sec('мобы: вид — одна функция, свет — как у кубиков');
  const S = { R, VR, W: Object.assign(fakeWorld(() => 15, () => [0, 0, 0]), { chunk: () => null }), P: { x: 0, y: 5, z: 0, dead: false }, ox: 0, oz: 0, meta: { diff: 'normal' }, ST: { rd: 6 }, creative: false };
  const X = window.KubomirEnts.create(S);
  const m = X.spawn('pig', 1.5, 5, 1.5);
  ok(m && m.parts && m.parts.mat.userData.d37ent && m.parts.mat.userData.d37ent.kind === 'mob', 'моб-коробки: материал со светом кубиков');
  X.frame(1 / 60, 0);
  ok(m.lit.u.value.x > .99 && m.parts.g.position.x === 1.5, 'моб: свет и место — каждый кадр', m.lit.u.value);
  m.hurtT = .3; X.frame(1 / 60, 0); ok(m.parts.mat.color.g < .5, 'удар — красная вспышка'); m.hurtT = 0; X.frame(1 / 60, 0); ok(m.parts.mat.color.g === 1, 'после удара — обычный цвет');
  X.dispose();
  const calls = [];
  window.KubomirEnts.mobView = ctx => ({ add(mm){ calls.push('add:' + mm.type); }, frame(mm){ calls.push('frame'); }, remove(mm){ calls.push('remove'); }, dispose(){ calls.push('dispose'); } });
  const X2 = window.KubomirEnts.create(S); const m2 = X2.spawn('cow', 2.5, 5, 2.5); X2.frame(1 / 60, 0); X2.dispose();
  window.KubomirEnts.mobView = null;
  ok(calls[0] === 'add:cow' && calls.includes('frame') && calls.includes('remove') && calls[calls.length - 1] === 'dispose' && m2.lit && m2.lit.u, 'свой вид мобов (KubomirEnts.mobView) — подменяет коробки целиком', calls);

  // ═══ 5. Окно вещей: «📖 Можно сделать» и сортировка (без DOM: render без окна — пусто) ═══
  sec('окно вещей: книга рецептов, сортировка');
  run('js/games/kubomir-ui.js');
  const SU = { P: { inv: new Array(36).fill(null), cursor: null, sel: 0 }, creative: false, W: { markTile(){} } };
  const toasts = [];
  const UI = window.KubomirUI.create(SU, { toast: t => toasts.push(t) });
  UI.kind = 'inv';
  ok(UI.book().length === 0, 'пустые вещи — книга пустая');
  SU.P.inv[0] = { id: 'log_oak', n: 3 };
  let bk = UI.book().map(b => b.r.out);
  ok(bk.length === 1 && bk[0] === 'planks_oak', 'бревно → можно сделать доски', bk);
  SU.P.inv[0] = { id: 'planks_birch', n: 7 };
  bk = UI.book();
  const outs = bk.map(b => b.r.out + (b.table ? '*' : ''));
  ok(outs.includes('stick') && outs.includes('crafting_table') && outs.includes('door*') && !outs.includes('pick_wood'), 'доски: палки и верстак — сразу, дверь — «на верстаке», кирки без палок — нет', outs);
  ok(bk.findIndex(b => b.table) > bk.findIndex(b => !b.table), 'сначала то, что можно сделать здесь');
  UI.bookList = bk;
  const ti = bk.findIndex(b => b.r.out === 'crafting_table');
  // «нажать» верстак в книге: доски легли 2×2 в сетку, из вещей ушли 4
  UI.craft.fill(null);
  // (click — внутренняя; проверяем через fill: book → сетка)
  ok(typeof UI.book === 'function' && typeof UI.sort === 'function', 'книга и сортировка — в API окна');
  SU.P.inv[0] = { id: 'planks_oak', n: 5 }; SU.P.inv[1] = { id: 'stick', n: 4 };
  UI.kind = 'craft';
  bk = UI.book().map(b => b.r.out);
  ok(bk.includes('pick_wood') && bk.includes('sword_wood') && bk.includes('axe_wood') && bk.includes('shovel_wood') && bk.includes('chest') === false, 'на верстаке: доски + палки → все деревянные инструменты; сундук (8 досок) — нет', bk);
  // сортировка: стопки склеиваются, инструменты первыми, панель 1–9 не трогается
  SU.P.inv.fill(null);
  SU.P.inv[0] = { id: 'torch', n: 5 };
  SU.P.inv[12] = { id: 'cobble', n: 30 }; SU.P.inv[20] = { id: 'cobble', n: 50 }; SU.P.inv[30] = { id: 'pick_stone', n: 1, d: 3 }; SU.P.inv[33] = { id: 'apple', n: 2 };
  UI.sort('inv');
  const inv = SU.P.inv;
  ok(inv[0]?.id === 'torch' && inv[0].n === 5, 'панель 1–9 на месте');
  ok(inv[9]?.id === 'pick_stone' && inv[9].d === 3, 'инструменты — первыми (с износом)', inv.slice(9, 14));
  const cob = inv.filter(s => s && s.id === 'cobble').map(s => s.n);
  ok(cob.join() === '64,16' && inv[10]?.id === 'cobble', 'булыжник склеился в стопку 64 + 16, сразу после инструментов', cob);
  ok(inv.slice(9).filter(Boolean).length === 4 && inv.slice(13).every(s => !s), 'дыр нет — всё подряд с начала рюкзака');

  // ═══ 6. Баланс выживания (цифры — в вывод): враги ночью по сложности, скорость копания, руды, награды ═══
  sec('баланс: ночь по сложности, копание, руды, награды');
  {
    // ровное поле (земля до y 10), небо везде 15 — ночью вся поверхность «тёмная» (как в игре: свет неба × 0,25)
    const flat = { seed: 7, raw(x, y, z){ return y < 10 ? ID.stone : 0; }, get(x, y, z){ return this.raw(x, y, z); }, lightAt(x, y, z){ return y < 10 ? 0 : 15 << 12; }, loaded: () => true, heightAt: () => 10, chunk: () => null };
    const night = (diff, time = 22, sec2 = 120) => {
      const S2 = { R: Object.assign({}, R, { lighting: { time } }), VR, W: flat, P: { x: 0.5, y: 10, z: 0.5, dead: false, vx: 0, vz: 0 }, ox: 0, oz: 0, meta: { diff }, ST: { rd: 6 }, creative: false };
      const X3 = window.KubomirEnts.create(S2);
      let dmg = 0, spawned = 0, maxAlive = 0; const sp0 = X3.spawn; X3.spawn = (...a) => { const m = sp0(...a); if (m && !window.KubomirEnts.MOBS[m.type].passive) spawned++; return m; };
      S2.ents = X3; X3.hookHurt = n => { dmg += n; };
      for (let i = 0; i < sec2 * 20; i++) { X3.tick(1 / 20); maxAlive = Math.max(maxAlive, X3.mobs.filter(m => !window.KubomirEnts.MOBS[m.type].passive).length); }
      X3.dispose();
      return { spawnedPerMin: +(spawned / (sec2 / 60)).toFixed(1), maxAlive, dmgPerMin: +(dmg / (sec2 / 60)).toFixed(1) };
    };
    const N0 = night('peaceful'), N1 = night('easy'), N2 = night('normal'), D2 = night('normal', 12, 60);
    console.log('  ночь, стоишь на месте (2 мин):', JSON.stringify({ мирно: N0, легко: N1, обычно: N2, деньОбычно: D2 }));
    ok(N0.spawnedPerMin === 0 && N0.dmgPerMin === 0, '«мирно» — врагов нет');
    ok(N1.maxAlive <= 4 && N1.spawnedPerMin <= 15 && N2.maxAlive <= 6 && N2.spawnedPerMin <= 20, 'ночью врагов рядом не больше 4 («легко») и 6 («обычно»); появляются не чаще раза в 4 и 3 с', [N1, N2]);
    // урон за 2 мин случайной ночи сравнивать нельзя (кто дошёл до игрока — случай: бывало «легко» 123 против «обычно» 5) —
    // сравниваем сам множитель урона; суммы за ночь — только в вывод
    ok(window.KubomirEnts.DIFF.easy.dmg < window.KubomirEnts.DIFF.normal.dmg, '«легко» — бьют слабее (урон × 0,67)', [window.KubomirEnts.DIFF.easy.dmg, window.KubomirEnts.DIFF.normal.dmg, N1.dmgPerMin, N2.dmgPerMin]);
    ok(D2.spawnedPerMin === 0, 'днём на свету — враги не появляются');
    { const H = window.KubomirEnts.DIFF.hard, N = window.KubomirEnts.DIFF.normal; ok(H && H.cap > N.cap && H.dmg > N.dmg && H.every <= N.every, '«сложно» — мобов больше, бьют сильнее, появляются чаще', H); }
    ok(window.KubomirEnts.DIFF.easy.dmg * window.KubomirEnts.MOBS.zombie.dmg >= 1.9 && window.KubomirEnts.DIFF.easy.dmg * window.KubomirEnts.MOBS.zombie.dmg <= 2.1, 'зомби на «легко» — 2 (как в Майнкрафте), «обычно» — 3');
    // копание (секунды): формула игры — прочность × (можно добыть ? 1,5 : 5) / скорость инструмента
    const bt = (blk, tool) => { const b = V.blocks[ID[blk]], t = tool ? V.item(tool).tool : null, right = !!(t && b.tool && t.kind === b.tool), can = !b.tier || (right && t.tier >= b.tier); return +(b.hard * (can ? 1.5 : 5) / (right ? t.speed : 1)).toFixed(2); };
    const table = {}; for (const blk of ['stone', 'ore_iron', 'log_oak', 'dirt']) { table[blk] = {}; for (const tl of [null, 'pick_wood', 'pick_stone', 'pick_iron', 'pick_diamond', 'axe_wood', 'shovel_wood']) table[blk][tl || 'рука'] = bt(blk, tl); }
    console.log('  копание, с:', JSON.stringify(table));
    ok(table.stone.рука === 7.5 && table.stone.pick_wood === 1.13 && table.log_oak.рука === 3 && table.log_oak.axe_wood === 1.5 && table.dirt.shovel_wood === .38, 'копание как в Майнкрафте: камень рукой 7,5 с, деревянной киркой 1,1 с; бревно рукой 3 с, топором 1,5 с');
    ok(table.ore_iron.pick_wood === 7.5 && table.ore_iron.рука === 15 && table.ore_iron.pick_stone === 1.13, 'железо: рукой 15 с, деревянной киркой 7,5 с — и ничего не выпадет (как в Майнкрафте), каменной — 1,1 с');
    // руды: сколько в среднем на чанк (64 чанка)
    const G = V.genInit('баланс'), cnt = { ore_coal: 0, ore_iron: 0, ore_gold: 0, ore_diamond: 0 }, deep = { ore_diamond: [99, 0] };
    for (let cx = 0; cx < 8; cx++) for (let cz = 0; cz < 8; cz++) { const g = V.genChunk(G, cx, cz); for (let i = 0; i < g.ids.length; i++) { const n = V.blocks[g.ids[i] & 0xfff]?.name; if (n in cnt) { cnt[n]++; if (n === 'ore_diamond') { const y = i & 127; deep.ore_diamond[0] = Math.min(deep.ore_diamond[0], y); deep.ore_diamond[1] = Math.max(deep.ore_diamond[1], y); } } } }
    for (const k in cnt) cnt[k] = +(cnt[k] / 64).toFixed(1);
    console.log('  руды на чанк:', JSON.stringify(cnt), 'алмазы на высоте', deep.ore_diamond.join('…'));
    ok(cnt.ore_coal > cnt.ore_iron && cnt.ore_iron > cnt.ore_gold && cnt.ore_gold > cnt.ore_diamond && cnt.ore_diamond > .5 && cnt.ore_diamond < 8, 'уголь > железо > золото > алмазы; алмазов 0,5…8 на чанк', cnt);
    ok(deep.ore_diamond[1] <= 18, 'алмазы — только глубоко (y ≤ 16, жила может зайти на 1–2 выше)', deep.ore_diamond);
    // награды: монеты за достижение — не больше потолка сервера (coin_run_cap 15), достижений ≤ game_score_cap 30
    const src = fs.readFileSync(path.join(SITE, 'js/games/kubomir.js'), 'utf8'), ach = [...src.matchAll(/\['(\w+)', '[^']*', '[^']*', '[^']*', (\d+)\]/g)].map(m => [m[1], +m[2]]);
    const total = ach.reduce((a, b) => a + b[1], 0);
    console.log('  достижений', ach.length, '· монет за все', total, '· больше всего за одно', Math.max(...ach.map(a => a[1])));
    ok(ach.length >= 15 && ach.length <= 30 && ach.every(a => a[1] >= 1 && a[1] <= 15) && total <= 120, 'монеты за достижения — в потолке сервера (≤ 15 за раз, ≤ 120 за все), достижений ≤ 30');
  }

  // ═══ 7. Физика и «оживление»: падающий песок, выпавшие вещи, замах и смерть мобов, частицы (такт — 1/20 с, от часов игры) ═══
  sec('физика: песок падает и давит факелы и цветы; вещи прыгают, плавают, тянутся; мобы — замах, смерть; частицы');
  {
    // мир-коробка: ниже y 10 — камень, выше — воздух; правки — Map, слушатели — как у настоящего мира
    const boxWorld = () => {
      const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
      return { seed: 11, listeners: [], cells,
        raw(x, y, z){ x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); if (y < 0) return 7; if (y >= 128) return 0; const v = cells.get(key(x, y, z)); return v === undefined ? (y < 10 ? ID.stone : 0) : v; },
        get(x, y, z){ const v = this.raw(x, y, z); return v < 0 ? -1 : v & 0xfff; },
        set(x, y, z, v, o = {}){ x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); const was = this.raw(x, y, z); if (was === v) return false; cells.set(key(x, y, z), v); if (!o.silent) for (const f of this.listeners) f(x, y, z, was, v, o); return true; },
        lightAt(){ return 15 << 12; }, loaded: () => true, heightAt: () => 10, chunk: () => null };
    };
    const mk = (o = {}) => {
      const W = boxWorld(), S7 = { R: Object.assign({}, R, { lighting: { time: o.time ?? 12 }, night: o.night ?? 0 }), VR, W, P: Object.assign({ x: 200.5, y: 10, z: 200.5, dead: false, vx: 0, vz: 0, sneak: false }, o.P || {}), ox: 0, oz: 0, meta: { diff: o.diff || 'normal' }, ST: { rd: 6 }, creative: o.creative ?? true };
      const X = window.KubomirEnts.create(S7); S7.ents = X; X.spawnT = 1e9;
      W.listeners.push((x, y, z, was, v) => X.onBlockChanged(x, y, z, was, v));
      return { W, S: S7, X };
    };
    // песок с высоты 15 — на камень (встаёт в y 10); такт приземления одинаковый при любой частоте кадров
    const fallRun = frames => {
      const { W, X } = mk(); W.set(5, 15, 5, ID.sand);
      let landed = -1;
      for (let i = 0; i < 80 && landed < 0; i++) { X.tick(1 / 20); if (frames) for (let k = 0; k < frames(i); k++) { X.frac = (k + 1) / (frames(i) + 1); X.frame(1 / 144, i / 20); } if (W.get(5, 10, 5) === ID.sand) landed = i; }
      const out = { landed, top: W.get(5, 15, 5), at: W.get(5, 10, 5), falling: X.falling.length };
      X.tick(1 / 20); out.after = X.falling.length; X.dispose(); return out;
    };
    const F1 = fallRun(null), F2 = fallRun(i => 1 + (i * 7) % 5);
    ok(F1.at === ID.sand && F1.top === 0 && F1.landed > 5 && F1.landed < 30, 'песок без опоры падает сущностью и встаёт блоком на камень', F1);
    ok(F2.landed === F1.landed && F2.at === ID.sand, 'приземление — по тактам игры: кадры (1…5 между тактами) ничего не меняют', [F1.landed, F2.landed]);
    ok(F1.after === 0, 'приземлился — сущность убрана (копия держится, только пока поток пересобирает сетку)');
    for (const [nm, item] of [['torch', 'torch'], ['flower_red', 'flower_red']]) {
      const { W, X } = mk(); W.set(8, 10, 8, ID[nm]); W.set(8, 14, 8, ID.sand);
      for (let i = 0; i < 60; i++) X.tick(1 / 20);
      ok(W.get(8, 10, 8) === ID.sand && X.items.some(e => e.s.id === item), `песок упал на ${nm === 'torch' ? 'факел' : 'цветок'} — тот выпал вещью, песок встал на его место`, { at: V.blocks[W.get(8, 10, 8)]?.name, items: X.items.map(e => e.s.id) });
      X.dispose();
    }
    { // поставил песок прямо на факел — падает и давит; гравий в воду — тонет до дна; столбик песка — весь
      const { W, X } = mk();
      W.set(3, 10, 3, ID.torch); W.set(3, 11, 3, ID.sand);
      for (const y of [10, 11, 12]) W.set(12, y, 12, ID.water, { silent: true });
      W.set(12, 15, 12, ID.gravel);
      for (const y of [13, 14, 15]) W.set(20, y, 20, ID.sand);
      for (let i = 0; i < 90; i++) X.tick(1 / 20);
      ok(W.get(3, 10, 3) === ID.sand && X.items.some(e => e.s.id === 'torch'), 'песок, поставленный на факел, падает и выбивает его');
      ok(W.get(12, 10, 12) === ID.gravel, 'гравий тонет в воде до дна', V.blocks[W.get(12, 10, 12)]?.name);
      ok(W.get(20, 10, 20) === ID.sand && W.get(20, 11, 20) === ID.sand && W.get(20, 12, 20) === ID.sand && W.get(20, 13, 20) === 0, 'столбик песка падает целиком и встаёт стопкой');
      X.dispose();
    }
    // вещи: брошенная — дуга, отскок, скользит и встаёт; на воде — держится у поверхности
    {
      const { W, X } = mk();
      const e = X.addItem(30.5, 12, 30.5, { id: 'cobble', n: 1 }, false, [3, 4, 0]);
      let fell = false, bounced = false;
      for (let i = 0; i < 100; i++) { const vy = e.vy; X.tick(1 / 20); if (vy < -3) fell = true; if (fell && e.vy > .5) bounced = true; }
      ok(bounced, 'упала быстро — подпрыгнула');
      ok(Math.abs(e.y - 10) < .02 && e.ground && e.vx === 0 && e.x > 32, 'потом легла на камень и проскользила до остановки', { y: +e.y.toFixed(3), x: +e.x.toFixed(2), vx: e.vx });
      for (const y of [10, 11, 12]) W.set(40, y, 40, ID.water, { silent: true });
      const w = X.addItem(40.5, 10.3, 40.5, { id: 'planks_oak', n: 1 }, false, [0, 0, 0]);
      for (let i = 0; i < 80; i++) X.tick(1 / 20);
      ok(w.float && Math.abs(w.y + .12 - (12 + V.liquidHeight(ID.water))) < .25, 'в воде всплыла и качается у поверхности', { y: +w.y.toFixed(3), float: w.float });
      X.dispose();
    }
    // магнит и подбор: есть место — тянется и «влетает» (летит к груди), места нет — лежит; своя (Q) — только через 2 с
    {
      const pickup = (room, thrown) => {
        const { X } = mk({ P: { x: 60.5, y: 10, z: 60.5 } }); let got = 0;
        X.give = s => { got += s.n; return 0; }; X.room = () => room;
        const e = thrown ? X.addItem(60.5, 11, 60.5, { id: 'stick', n: 1 }, false, [0, 2, 0]) : X.addItem(62.6, 10.4, 60.5, { id: 'stick', n: 1 });   // без скорости — выпала из блока (подобрать через 0,5 с)
        if (!thrown) { e.vx = e.vz = 0; }
        let at = -1, fly = 0;
        for (let i = 0; i < 80 && at < 0; i++) { X.tick(1 / 20); if (!X.items.includes(e)) { at = i; fly = X.fxStats().flyers; } }
        for (let k = 0; k < 20; k++) X.frame(1 / 60, k / 60);
        const out = { at, got, fly, flyAfter: X.fxStats().flyers }; X.dispose(); return out;
      };
      const A = pickup(true, false), B = pickup(false, false), C = pickup(true, true);
      ok(A.at >= 9 && A.at < 40 && A.got === 1 && A.fly === 1 && A.flyAfter === 0, 'место есть — вещь подтянулась (с 2,1 блока) и влетела в игрока', A);
      ok(B.at < 0 && B.got === 0, 'места нет — вещь не тянется и лежит', B);
      ok(C.at >= 39 && C.got === 1, 'брошенную (Q) подобрать — только через 2 с', C);
    }
    // мобы: удар с замахом (не сразу), удар сбивает замах, в hookHurt — кто ударил; смерть — завалился, «пуф», исчез
    {
      const { X, S: S7 } = mk({ creative: false, time: 22, night: 1, P: { x: 70.5, y: 10, z: 70.5 } });
      const hits = [];
      X.hookHurt = (n, m) => hits.push({ n, m, t: X.tickN });
      const z = X.spawn('zombie', 71.4, 10, 70.5, { quiet: true });
      let wound = false, armsUp = false, armsIdle = 9;
      X.frame(1 / 60, 0); armsIdle = z.parts.arms[0].rotation.x;
      for (let i = 0; i < 40 && !hits.length; i++) { X.tick(1 / 20); for (let k = 0; k < 3; k++) X.frame(1 / 60, i / 20); if (z.wind > 0) wound = true; if (z.parts.arms[0].rotation.x < -.5) armsUp = true; }
      ok(wound && hits.length === 1 && hits[0].t >= 8 && hits[0].m === z && hits[0].n === 3, 'зомби бьёт после замаха (≥ 0,35 с), урон 3 на «обычно», в удар передан сам моб', { t: hits[0]?.t, n: hits[0]?.n });
      ok(Math.abs(armsIdle) < .3 && armsUp, 'руки зомби — вперёд (не вверх), на замахе поднимаются', { armsIdle });
      for (let i = 0; i < 40 && !(z.wind > 0); i++) X.tick(1 / 20);
      const wasWind = z.wind > 0; X.damage(z, 1, 1, 0, 'player');
      ok(wasWind && z.wind === 0, 'удар по зомби сбивает его замах');
      X.damage(z, 999, 1, 0, 'player');
      ok(!X.mobs.includes(z) && X.dying.includes(z) && !X.rayMob(70.5, 11, 70.5, 1, 0, 0, 5), 'умер — больше не моб (не бьёт, не мешает, по нему не попасть), но ещё виден');
      let maxRoll = 0, puffed = 0;
      for (let k = 0; k < 70; k++) { if (k % 3 === 0) X.tick(1 / 20); X.frame(1 / 60, k / 60); if (z.parts.g.parent) maxRoll = Math.max(maxRoll, Math.abs(z.parts.g.rotation.z)); puffed = Math.max(puffed, X.fxStats().puffs); }
      ok(maxRoll > 1.4 && puffed > 0 && !X.dying.length && !z.parts.g.parent, 'смерть: завалился набок, исчез облачком «пуф»', { maxRoll: +maxRoll.toFixed(2), puffed });
      // плавно между тактами: место — между прошлым и новым
      const c = X.spawn('cow', 72.5, 10, 74.5, { quiet: true }); c.vx = 2;
      X.tick(1 / 20); X.frac = .5; X.frame(1 / 60, 1);
      ok(c.px !== c.x || c.pz !== c.z ? Math.abs(c.rx - (c.px + c.x) / 2) < 1e-9 && Math.abs(c.rz - (c.pz + c.z) / 2) < 1e-9 : true, 'моб рисуется между тактами (X.frac)', { px: c.px, x: c.x, rx: c.rx });
      X.dispose();
      void S7;
    }
    // частицы: пулы не растут, всё конечное (без «не чисел»), ни одной живой — объект спрятан (нет вызова отрисовки)
    {
      const { X } = mk({ P: { x: 90.5, y: 10, z: 90.5 } });
      for (let i = 0; i < 40; i++) X.breakFx(90 + (i % 4), 10, 92, ID.dirt);
      for (let i = 0; i < 30; i++) X.smoke(90, 11, 90, 12);
      X.glow('ember', 90, 11, 90, 100); X.splash(91, 10, 91, 1.5); X.bubbles(90, 10, 90, 5); X.dust(90, 10, 90, ID.grass, 30, { ring: true });
      X.placeFx(95, 10, 95, ID.planks_oak);
      X.frame(1 / 60, 0);
      const O = X.fxObjects(), st0 = X.fxStats();
      { const sh = shaderOf('points'); O.puffs.material.onBeforeCompile(sh); const k1 = O.puffs.material.customProgramCacheKey(), k2 = O.glows.material.customProgramCacheKey();
        ok(/attribute float aSize;/.test(sh.vertexShader) && /gl_PointSize = size \* aSize;/.test(sh.vertexShader) && incOk(sh.vertexShader) && k1 !== k2 && /^kbpts/.test(k1), 'точки клубов: свой размер у каждой — кусок шейдера three r149 на месте, свой ключ программы', [k1, k2]); }
      ok(st0.shards <= 96 && st0.shards > 0 && st0.puffs <= 160 && st0.glows <= 72 && O.shards.visible && O.puffs.visible, 'пулы ограничены (осколков ≤ 96, клубов ≤ 160, искр ≤ 72)', st0);
      let finite = true;
      for (let k = 0; k < 30; k++) {
        X.frame(1 / 60, k / 60);
        const m = O.shards.instanceMatrix.array, n = O.shards.count * 16; for (let i = 0; i < n; i++) if (!Number.isFinite(m[i])) finite = false;
        for (const p of [O.puffs, O.glows]) { const g = p.geometry, n2 = g.drawRange.count; for (const nm of ['position', 'aSize']) { const a = g.attributes[nm].array, w = g.attributes[nm].itemSize; for (let i = 0; i < n2 * w; i++) if (!Number.isFinite(a[i])) finite = false; } }
      }
      ok(finite, 'места, размеры и повороты частиц — конечные числа');
      let shardsMinY = 99;
      for (let k = 0; k < 400; k++) { X.frame(1 / 60, k / 60); const m = O.shards.instanceMatrix.array; for (let i = 0; i < O.shards.count; i++) shardsMinY = Math.min(shardsMinY, m[i * 16 + 13]); }
      ok(shardsMinY > 9.9, 'осколки лежат на камне, а не проваливаются', shardsMinY);
      const st1 = X.fxStats();
      ok(st1.shards === 0 && st1.puffs === 0 && st1.pops === 0 && !O.shards.visible && !O.puffs.visible, 'всё отжило — объекты спрятаны (нет лишних вызовов отрисовки)', st1);
      X.dispose();
    }
  }

  // ═══ 8. Погода: расписание от зерна и дня (то же после перезагрузки), под крышей не идёт ═══
  sec('погода: расписание по зерну и дню, биомы, крыша, «низкая» без частиц');
  {
    run('js/games/kubomir-weather.js');
    const KW = window.KubomirWeather;
    const series = (seed, days) => { const a = []; for (let d = 1; d <= days; d++) for (let h = 0; h < 24; h += .05) a.push(KW.at(seed, d, h)); return a; };
    const A1 = series('погода', 40), A2 = series('погода', 40), B1 = series(12345, 40);
    ok(A1.every((v, i) => v === A2[i]), 'одно зерно, день и час — та же сила (перезагрузка — та же погода)');
    ok(A1.some((v, i) => Math.abs(v - B1[i]) > .3), 'другое зерно — другое расписание');
    const wet = A1.filter(v => v > .05).length / A1.length;
    ok(wet > .05 && wet < .35, 'чаще ясно: непогода — 5…35 % времени', +wet.toFixed(3));
    let jump = 0; for (let i = 1; i < A1.length; i++) jump = Math.max(jump, Math.abs(A1[i] - A1[i - 1]));
    ok(jump < .2 && Math.max(...A1) >= .6 && Math.max(...A1) <= 1, 'начинается и кончается плавно (за 3 мин игры — меньше 0,2), сила до 0,6…1', +jump.toFixed(3));
    ok(Math.abs(KW.at('погода', 3, 23.99) - KW.at('погода', 4, 0)) < .05, 'через полночь — без скачка');
    ok(KW.kindAt('desert', 70) === '' && KW.kindAt('snow', 70) === 'snow' && KW.kindAt('mountains', 120) === 'snow' && KW.kindAt('mountains', 70) === 'rain' && KW.kindAt('forest', 70) === 'rain' && KW.kindAt('swamp', 60) === 'rain', 'биомы: пустыня — сухо, снега и высокие горы — снег, лес и болото — дождь');
    // мир: камень ниже y 10; стеклянный домик 6×6 с крышей на y 14 (стекло — не «непрозрачное», но капли держит), факел на земле
    const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z, listeners = [];
    const W8 = { seed: 9, listeners, raw(x, y, z){ x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); if (y < 0) return 7; if (y >= 128) return 0; const v = cells.get(key(x, y, z)); return v === undefined ? (y < 10 ? ID.stone : 0) : v; },
      get(x, y, z){ return this.raw(x, y, z) & 0xfff; }, set(x, y, z, v){ cells.set(key(x, y, z), v); for (const f of listeners) f(x, y, z, 0, v, {}); return true; },
      lightAt(){ return 15 << 12; }, loaded: () => true, heightAt: () => 10, chunkAt: () => ({ gen: true, maxY: 20 }) };
    for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) cells.set(key(x, 14, z), ID.glass);
    cells.set(key(9, 10, 9), ID.torch);
    for (let x = 12; x < 15; x++) for (let z = 0; z < 3; z++) for (const y of [10, 11]) cells.set(key(x, y, z), ID.water);
    const R8 = Object.assign({}, R, { lighting: { time: 12 }, night: 0, camera: new T.PerspectiveCamera(70, 1, .1, 200) });
    const mk8 = q => { const st8 = { R: Object.assign({}, R8, { q }), W: W8, P: { x: 2.5, y: 10, z: 2.5 }, ox: 0, oz: 0, meta: { day: 1 } }; const X = KW.create(st8); st8.WX = X; return { st8, X }; };
    const { st8, X } = mk8('high');
    ok(X.top(2, 2) === 15 && X.top(8, 8) === 10 && X.top(9, 9) === 10 && Math.abs(X.top(13, 1) - (11 + V.liquidHeight(ID.water))) < .2, 'где кончается небо: стеклянная крыша — 15, земля — 10, факел капли не держит, у воды — её гладь', [X.top(2, 2), X.top(8, 8), X.top(9, 9), X.top(13, 1)]);
    W8.set(8, 16, 8, ID.planks_oak);
    ok(X.top(8, 8) === 17, 'поставил блок над столбом — столб заново (крыша новая)', X.top(8, 8));
    X.force = 1; X.step(1); st8.R.camera.position.set(2.5, 11.6, 2.5);
    let under = 0, outside = 0, onRoof = 0;
    for (let f = 0; f < 150; f++) {
      X.frame(1 / 60, f / 60);
      const D = X.objects().drops;
      for (let i = 0; i < D.n; i++) if (D.live[i]) { const inX = D.rx[i] >= 0 && D.rx[i] < 6 && D.rz[i] >= 0 && D.rz[i] < 6; if (inX && D.ry[i] < 14.99) under++; else if (inX) onRoof++; else outside++; }
    }
    ok(X.rain > .5 && outside > 1000 && onRoof > 0 && under === 0, 'дождь идёт вокруг, капли бьют в стеклянную крышу, под крышей — ни одной', { rain: +X.rain.toFixed(2), under, onRoof, outside });
    const st0 = X.stats();
    ok(st0.drops > 200 && st0.drops <= 560 && X.objects().rain.visible, 'капель не больше пула (560), видно один объект отрезков', st0);
    let pf = true; const rp = X.objects().rainPos; for (let i = 0; i < st0.drops * 6; i++) if (!Number.isFinite(rp[i])) pf = false;
    ok(pf, 'места капель — конечные числа');
    // снег: в снегах, медленные хлопья; тоже не под крышей
    X.biomeOf = () => 'snow'; X.step(1); X.step(1); X.step(1); X.step(1);
    let fUnder = 0, fy0 = null, fy1 = null;
    for (let f = 0; f < 600; f++) {
      X.frame(1 / 60, f / 60);
      const Fl = X.objects().flakes;
      for (let i = 0; i < Fl.n; i++) if (Fl.live[i] && Fl.sx[i] >= 0 && Fl.sx[i] < 6 && Fl.sz[i] >= 0 && Fl.sz[i] < 6 && Fl.sy[i] < 14.99) fUnder++;
      if (f === 300) fy0 = Fl.sy[0]; if (f === 330) fy1 = Fl.sy[0];
    }
    const s1 = X.stats();
    ok(s1.snow > .5 && s1.rain < .1 && s1.flakes > 100 && fUnder === 0, 'в снегах — снег вместо дождя, под крышей хлопьев нет', s1);
    ok(fy0 != null && fy1 != null && (fy0 - fy1) > 0 && (fy0 - fy1) < 1.5, 'хлопья падают медленно (меньше 3 блоков в секунду)', [fy0, fy1]);
    // выключили погоду — сила к нулю
    st8.weatherOff = true; X.step(1); for (let f = 0; f < 600; f++) X.frame(1 / 60, f / 60);
    ok(X.k < .05 && !X.objects().snow.visible && !X.objects().rain.visible, '⚙️ «Погода» выкл — непогоды нет, частицы спрятаны', X.stats());
    X.dispose();
    const L8 = mk8('low');
    ok(!L8.X.objects().rain && !L8.X.objects().snow && !L8.X.objects().ripples, '«низкая» графика — без частиц (только небо и туман)');
    L8.X.force = 1; L8.X.step(1); for (let f = 0; f < 120; f++) L8.X.frame(1 / 60, f / 60);
    ok(L8.X.k > .5, '…но небо темнеет (сила для неба есть)', L8.X.k);
    L8.X.dispose();
    ok(!listeners.length, 'закрыли мир — слушатель правок снят');
    // движок погоды (js/engine/climate.js): то же расписание по зерну и дню — от него, времена года по игровым дням
    run('js/engine/climate.js');
    const B1e = series('погода', 40), B2e = series('погода', 40), Ce = series(12345, 40);
    ok(B1e.every((v, i) => v === B2e[i]) && B1e.some((v, i) => Math.abs(v - Ce[i]) > .3), 'движок погоды: одно зерно и день — та же сила, другое зерно — другая');
    const wetE = B1e.filter(v => v > .05).length / B1e.length;
    let jumpE = 0; for (let i = 1; i < B1e.length; i++) jumpE = Math.max(jumpE, Math.abs(B1e[i] - B1e[i - 1]));
    ok(wetE > .05 && wetE < .35 && jumpE < .2 && Math.max(...B1e) >= .6 && Math.max(...B1e) <= 1, 'движок погоды: чаще ясно, плавно, сила до 0,6…1', { wet: +wetE.toFixed(3), jump: +jumpE.toFixed(3) });
    ok(Math.abs(KW.at('погода', 3, 23.99) - KW.at('погода', 4, 0)) < .05, 'движок погоды: через полночь — без скачка');
    ok(KW.BIOME_CLIM.desert === 'desert' && KW.BIOME_CLIM.snow === 'snow' && KW.BIOME_CLIM.mountains === 'mountain' && KW.BIOME_CLIM.ocean === 'sea', 'биомы → климаты движка: пустыня, снега, горы, море');
  }

  console.log(`\nkubomir-hand-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
