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
  {   // вода (T-044): глубина и берег из сетки, волны картой нормалей, блик — свет three с тенью; простой режим — без этого
    const m = VR.mats.water, sh = shaderOf('lambert'); m.onBeforeCompile(sh);
    const fs = sh.fragmentShader, vs = sh.vertexShader;
    ok(VR.waterLight && fs.includes('d37dl += directLight.color;\n\t\tRE_Direct( directLight, geometry, material, reflectedLight );') && fs.indexOf('vec3 d37dl') < fs.indexOf('d37dl += '), 'вода: блик — солнце/луна с тенью копятся перед RE_Direct (объявлено раньше)');
    ok(/vec2 d37wq[\s\S]*#include <alphamap_fragment>/.test(fs) && fs.indexOf('float d37dep') < fs.indexOf('#include <emissivemap_fragment>'), 'вода: толща и глубина — до света (перед alphamap, раньше крючка льда)');
    ok(vs.includes('vUvL.xy = mod( vd.xy, 32.0 ) / 16.0;') && vs.includes('vWD = vec4(') && /varying vec4 vWD;[\s\S]*varying float vWS;/.test(vs) && /varying vec4 vWD;[\s\S]*varying float vWS;/.test(fs), 'вода: u, v — младшие 5 бит, глубины углов и берег — в varying (в обоих шейдерах)');
    ok(fs.includes('d37uv.xy += vec2( uTime * 0.03, uTime * 0.05 );') && fs.includes('float d37IceK = 0.0;'), 'вода: строка для крючка льда на месте, d37IceK объявлен');
    ok(sh.uniforms.uWN.value?.isDataTexture && sh.uniforms.uWN.value.image.width === 128 && sh.uniforms.uWN.value.generateMipmaps && sh.uniforms.uWN.value.wrapS === T.RepeatWrapping && sh.uniforms.uWN.value.minFilter === T.LinearMipmapLinearFilter, 'вода: карта нормалей 128² с мип-уровнями, повторяется');
    ok(!!m.defines.D37_WQ2 && VR.U.uWP.value.z > 0 && VR.U.uWP.value.w > .3 && VR.U.uWP.value.w < 1, 'вода «высокая»: два слоя волн, пена, средняя яркость рисунка', VR.U.uWP.value);
    // карта нормалей: шов повторения — без скачка (целые частоты), наклоны в меру
    const wd = sh.uniforms.uWN.value.image.data, N = 128, nx = (x, y) => wd[((y % N) * N + (x % N)) * 4] / 127.5 - 1;
    let seam = 0, mx = 0; for (let i = 0; i < N; i++) { seam = Math.max(seam, Math.abs(nx(N - 1, i) - nx(0, i)), Math.abs(nx(i, N - 1) - nx(i, 0))); mx = Math.max(mx, Math.abs(nx(i, i))); }
    ok(seam < .25 && mx > .2 && mx < .9, 'карта нормалей: без шва на краю, наклоны в меру', { seam: +seam.toFixed(3), mx: +mx.toFixed(3) });
    // NaN-страховки: нормализуем только ненулевое, деление — на max
    ok(fs.includes('inversesqrt( max( dot( d37Hs, d37Hs ), 1e-8 ) )') && fs.includes('/ max( d37al, 0.004 )') && !/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/.test(fs.replace(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g, (s, a, b) => +a < +b ? '' : s)), 'вода: без NaN (половинный вектор, деление на покрытие), smoothstep — края по возрастанию');
    // простой режим: те же u, v (младшие 5 бит), без глубин, карты нормалей и блика
    const VRs = V.renderer(Object.assign({}, R, { scene: new T.Scene(), wave: null }), { safe: true }), shs = shaderOf('lambert');
    VRs.mats.water.onBeforeCompile(shs);
    ok(shs.vertexShader.includes('vUvL.xy = mod( vd.xy, 32.0 ) / 16.0;') && !shs.vertexShader.includes('vWD') && !shs.fragmentShader.includes('vWD') && !shs.fragmentShader.includes('uWN') && !shs.fragmentShader.includes('d37dl +='), 'простой режим воды: u, v из младших бит, без новых кусков');
    VRs.dispose();
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

  // ═══ 3б. Две руки (бой, D37E.combat): левая от 1-го лица (щит, факел, еда, лук), вещи у человечка — в своих кистях,
  //    поза человечку — слоем world3d (a.hold). Человечек как у world3d: armL — его правая рука, armR — левая ═══
  sec('две руки: левая от 1-го лица, щит поднят, лук, вещи у человечка, поза — слоем world3d');
  {
    run('js/engine/combat.js');
    const CBc = window.D37E.combat;
    window.World3D = Object.assign(window.World3D || {}, { HOLDS: CBc.HOLDS, MOTIONS: CBc.MOTIONS });
    const mkCh2 = () => {
      const c = mkCh(), armL = new T.Group(), elbowL = new T.Group(), handL = new T.Group();
      c.root.add(armL); armL.position.set(-.3, 1.3, 0); armL.userData.La = .6;
      armL.add(new T.Mesh(new T.BoxGeometry(.1, .3, .1), new T.MeshToonMaterial({ color: '#cc3366' })));
      elbowL.position.set(0, -.3, 0); armL.add(elbowL); elbowL.add(new T.Mesh(new T.BoxGeometry(.1, .3, .1), new T.MeshToonMaterial({ color: '#f0c0a0' })));
      handL.position.set(0, -.3, 0); elbowL.add(handL);
      return Object.assign(c, { armL, elbowL, handL });
    };
    const ch2 = mkCh2(), actor2 = { key: 'me', x: 2.5, y: 5, z: 2.5, ch: ch2, hidden: true, hold: null };
    const A2 = { list: new Map([['me', actor2]]), get: k => A2.list.get(k) };
    const P2 = { x: 2.5, y: 5, z: 2.5, sneak: false, dead: false, inv: new Array(36).fill(null), off: { id: 'shield', n: 1 }, sel: 0 };
    P2.inv[0] = { id: 'sword_iron', n: 1 }; P2.inv[1] = { id: 'bow', n: 1 };
    const F2 = CBc.fighter({ invT: .5, poise: 3 });
    const st2 = { R, VR, W: cave, P: P2, A: A2, ox: 0, oz: 0, camMode: 0, hudHidden: false, eat: null, rig: { yaw: 0, fp: 0, feel: { bobPh: 0, bobW: 0 }, motion: 1 }, F: F2,
      hands: { mainS: P2.inv[0], offS: P2.off, mainW: CBc.weapon({ kind: 'sword', dmg: 6 }), offW: CBc.weapon('shield'), two: false, offStow: false, mainOff: false } };
    CBc.equip(F2, st2.hands.mainW, st2.hands.offW);
    const H2 = window.KubomirHand.create(st2);
    const tick2 = n => { for (let i = 0; i < n; i++) { H2.pose(1 / 60, 0); H2.frame(1 / 60, i / 60); } };
    tick2(3);
    let s2 = H2.state();
    ok(s2.item === 'sword_iron' && s2.off === 'shield' && s2.fp && s2.fpL && s2.armL, 'меч в правой, щит в левой — от 1-го лица видны обе руки', s2);
    ok(s2.fist[0] > .15 && s2.fistL && s2.fistL[0] < -.15 && s2.fistL[1] < s2.fist[1], 'левая — слева внизу (щит), правая — справа', { R: s2.fist, L: s2.fistL });
    let fpMats2 = 0; R.camera.traverse(o => { if (o.isMesh && o.material?.userData?.d37ent?.fp) fpMats2++; });
    ok(fpMats2 >= 5, 'обе руки — копии рук человечка с материалами «из глаз» (2 + 3 части)', fpMats2);
    ok(H2.tpItem && H2.tpItem.parent === ch2.handL && H2.tpOff && H2.tpOff.parent === ch2.handR, 'у человечка: меч — в его правой кисти (handL), щит — в левой (handR)');
    ok(s2.layer && actor2.hold && actor2.hold.r === CBc.HO.sword && actor2.hold.l === CBc.HO.shield, 'поза человечку — слоем world3d: что в руках (номера CB.HOLDS)', actor2.hold);
    // щит поднят: левый кулак — выше и к середине
    const L0 = s2.fistL.slice();
    F2.guard = 1; tick2(2); s2 = H2.state();
    ok(s2.fistL[1] > L0[1] + .1 && s2.fistL[0] > L0[0] + .1 && actor2.hold.g === 1, 'щит поднят — левая рука выше и к середине, человечку — g = 1', { L0, L: s2.fistL });
    F2.guard = 0;
    // удар мечом: правая — по движению боя (замах — вверх и вправо, удар — к середине)
    CBc.attack(F2, null); for (let i = 0; i < 4; i++) CBc.step(F2, 1 / 60); tick2(1); const fw = H2.state().fist;
    for (let i = 0; i < 9; i++) CBc.step(F2, 1 / 60); tick2(1); const fh = H2.state().fist;
    ok(actor2.hold.m === CBc.MO.slash && fw[1] > L0[1] && fh[0] < fw[0] - .2, 'рубка от 1-го лица: замах справа вверху, удар — к середине; человечку — движение slash', { fw, fh, m: actor2.hold.m });
    for (let i = 0; i < 30; i++) CBc.step(F2, 1 / 60);
    // еда в левой: левая рука ко рту, правая на месте
    P2.off = { id: 'apple', n: 1 }; st2.hands.offS = P2.off; st2.hands.offW = CBc.weapon('food'); CBc.equip(F2, st2.hands.mainW, st2.hands.offW);
    tick2(20); const Lb = H2.state().fistL;
    st2.eat = { t: .5, need: 1.6, hand: 'off' }; tick2(30); s2 = H2.state();
    ok(s2.off === 'apple' && s2.fistL[0] > Lb[0] + .15 && actor2.hold.m === CBc.MO.eat && actor2.hold.mh === 1, 'ест левой — левая рука ко рту, человечку — движение eat левой', { Lb, L: s2.fistL, hold: actor2.hold });
    st2.eat = null; tick2(30);
    // лук — двумя руками: в правой ничего, лук — в левой; натянул — правая к лицу
    P2.sel = 1; Object.assign(st2.hands, { mainS: P2.inv[1], offS: null, mainW: CBc.weapon('bow'), offW: null, two: true, offStow: true });
    CBc.equip(F2, st2.hands.mainW, null); tick2(20); s2 = H2.state();
    const fr0 = s2.fist;
    ok(s2.item === null || s2.item === '' ? true : false, 'лук — правая пустая (держит тетиву)', s2.item);
    ok(s2.off === 'bow' && s2.fpL && H2.tpOff?.parent === ch2.handR, 'лук — в левой (и у человечка — в его левой кисти)', s2);
    CBc.bow(F2, true); for (let i = 0; i < 70; i++) { CBc.bow(F2, true); CBc.step(F2, 1 / 60); } tick2(2); s2 = H2.state();
    ok(s2.fist[2] > fr0[2] + .15 && actor2.hold.d >= 1 && actor2.hold.r === CBc.HO.bow && actor2.hold.l === CBc.HO.bow, 'натянул — правая к лицу (ближе к камере), человечку — d = 1, лук двумя руками', { fr0, f: s2.fist, hold: actor2.hold });
    H2.dispose();
    let left2 = 0; R.camera.traverse(o => { if (o.isMesh) left2++; }); ok(left2 === 0 && actor2.hold === null, 'закрыли мир — у камеры пусто, поза человечку снята', left2);
  }

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
    // мобы в воде (22.10, владелец: «зомби застряли в воде»): держатся на плаву, плывут к берегу или к цели, вылезают на край
    // до 1,25 над гладью (как игрок), в погоне обходят глубокую воду по суше; в стенку из воды бесконечно не упираются
    {
      const perf0 = globalThis.performance; globalThis.performance = { now: () => 1000 };   // зерно моба — от часов: одинаковое во всех прогонах
      const MOBS = window.KubomirEnts.MOBS;
      // бассейн: вода в 2 блока (y 10…11, гладь 11,875) в [0..5]×[0..5]; вокруг — камень до topAt (верх берега — topAt + 1)
      const pool = o => {
        const r = mk({ creative: false, time: 22, night: 1, P: o.P || { x: 30.5, y: 10, z: 2.5 } });
        for (let x = -8; x <= 13; x++) for (let z = -8; z <= 13; z++) {
          const inPool = x >= 0 && x <= 5 && z >= 0 && z <= 5, top = o.topAt ? o.topAt(x, z) : 12;
          for (let y = 10; y <= 13; y++) { const t = inPool ? (y <= 11 ? ID.water : 0) : (y <= top ? ID.stone : 0); if (t) r.W.set(x, y, z, t, { silent: true }); }
        }
        return r;
      };
      const runPool = (type, o = {}) => {
        const r = o.world ? o.world() : pool(o), { X } = r, M = MOBS[type], hits = [];
        X.hookHurt = n => hits.push(n);
        const m = X.spawn(type, o.at?.[0] ?? 2.5, o.at?.[2] ?? 10.2, o.at?.[1] ?? 2.5, { quiet: true });
        let landed = -1, minSub = 9, maxSub = 0, maxWall = 0, wet = 0, calm = false;
        const N = (o.sec ?? 20) * 20, landY = o.landY ?? 13, inPool = () => m.x >= 0 && m.x < 6 && m.z >= 0 && m.z < 6;
        for (let i = 0; i < N; i++) {
          X.tick(1 / 20);
          if (o.frames) { const f = o.frames(i); for (let k = 0; k < f; k++) { X.frac = (k + 1) / (f + 1); X.frame(1 / 144, i / 20); } }
          if (!X.mobs.includes(m)) break;
          if (inPool() && i > 60) { const s = Math.max(0, Math.min(1, (11.875 - m.y) / M.h)); minSub = Math.min(minSub, s); maxSub = Math.max(maxSub, s); }
          maxWall = Math.max(maxWall, m.wallT || 0); if (m.wetT > 0) wet++; if (m.calm > 0) calm = true;
          if (landed < 0 && m.ground && m.y >= landY - .02 && !inPool()) { landed = i; if (!o.keep) break; }
        }
        const d = Math.hypot(r.S.P.x - m.x, r.S.P.z - m.z);
        const out = { t: landed < 0 ? -1 : +(landed / 20).toFixed(2), x: +m.x.toFixed(3), y: +m.y.toFixed(3), z: +m.z.toFixed(3), minSub: +minSub.toFixed(3), maxSub: +maxSub.toFixed(3), maxWall: +maxWall.toFixed(2), wet, calm, hits: hits.length, d: +d.toFixed(2) };
        X.dispose(); return out;
      };
      // 1) вода в 2 блока, берег на блок выше воды (край +1,125 над гладью): вылез сам (без цели — к ближнему берегу)
      const A = runPool('zombie');
      ok(A.t > 0 && A.t <= 8, `зомби в воде (2 блока) у берега на блок выше: вылез на сушу за ${A.t} с (нужно ≤ 8)`, A);
      const A2 = runPool('zombie', { frames: i => 1 + (i * 7) % 5 }), A3 = runPool('zombie', { frames: i => (i % 3 === 0 ? 0 : 2) });
      ok(A2.t === A.t && A2.x === A.x && A2.z === A.z && A3.t === A.t && A3.y === A.y, 'то же при любых кадрах между тактами (30 / 60 / 144 — такт мобов 1/20 с)', [A, A2, A3]);
      const Pg = runPool('pig'), Ck = runPool('chicken'), Sl = runPool('slime');
      ok(Pg.t > 0 && Pg.t <= 10 && Ck.t > 0 && Ck.t <= 10 && Sl.t > 0 && Sl.t <= 10, 'свинья, курица, слизень — тоже выбираются на берег', { pig: Pg.t, chicken: Ck.t, slime: Sl.t });
      // 2) берег высокий (+2,125) со всех сторон, кроме востока: нашёл низкий край и вылез там
      const D = runPool('zombie', { at: [1.5, 2.5], topAt: x => x > 5 ? 12 : 13, sec: 25 });
      ok(D.t > 0 && D.t <= 15 && D.x > 6, `высокий берег, низкий — только с одной стороны: доплыл туда и вылез за ${D.t} с`, D);
      // 3) низкого края нет: держится на плаву (голова над водой), в стенку дольше 2 с подряд не упирается
      const E2 = runPool('zombie', { at: [1.5, 2.5], topAt: () => 13, sec: 20 });
      ok(E2.t < 0 && E2.minSub > .55 && E2.maxSub < .9 && E2.maxWall <= 2.06, 'вылезти негде: держится на плаву (плечи над водой, качается), в стенку не бьётся', E2);
      // 4) гонится за игроком на берегу: плывёт к нему, вылезает и бьёт
      const C = runPool('zombie', { at: [1.5, 2.5], P: { x: 8.5, y: 13, z: 2.5 }, keep: true, sec: 15 });
      ok(C.t > 0 && C.t <= 8 && C.hits >= 1, `гонится за игроком на берегу: вылез за ${C.t} с и ударил (${C.hits})`, C);
      // 5) ров (вода 2 блока, 3 ширины) между зомби и игроком, обход по суше есть: идёт в обход, в воду не лезет
      const moat = () => {
        const r = mk({ creative: false, time: 22, night: 1, P: { x: 10.5, y: 10, z: .5 } });
        for (let x = 4; x <= 6; x++) for (let z = -12; z <= 6; z++) for (const y of [8, 9]) r.W.set(x, y, z, ID.water, { silent: true });
        return r;
      };
      const F = runPool('zombie', { world: moat, at: [1.5, .5, 10], keep: true, sec: 15, landY: 99 });
      ok(F.wet === 0 && F.hits >= 1, 'ров между ним и игроком, а по суше обойти можно: обошёл и ударил, в воду не лез', F);
      // 6) обхода нет (ров во всю ширину): плывёт напрямик и вылезает на другой стороне
      const moat2 = () => {
        const r = mk({ creative: false, time: 22, night: 1, P: { x: 10.5, y: 10, z: .5 } });
        for (let x = 4; x <= 6; x++) for (let z = -40; z <= 40; z++) for (const y of [8, 9]) r.W.set(x, y, z, ID.water, { silent: true });
        return r;
      };
      const F2 = runPool('zombie', { world: moat2, at: [1.5, .5, 10], keep: true, sec: 15, landY: 99 });
      ok(F2.wet > 0 && F2.hits >= 1, 'обойти нельзя — переплыл ров, вылез и ударил', F2);
      console.log(`  мобы в воде: вылез ${A.t} с (свинья ${Pg.t}, курица ${Ck.t}, слизень ${Sl.t}); один низкий край — ${D.t} с; в воде доля тела ${E2.minSub}…${E2.maxSub}; погоня — вылез за ${C.t} с; ров — в обход (в воде 0 тактов), без обхода — вплавь`);
      globalThis.performance = perf0;
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
    ok(KW.climKey('desert', 2) === 'kb_desert' && KW.climKey('swamp', 2) === 'kb_swamp' && KW.climKey('forest', 2) === 'kb_warm' && KW.climKey('snow', 1) === 'kb_snow' && KW.climKey('mountains', 1) === 'kb_snow'
      && KW.climKey('plains', 0) === 'temperate' && KW.climKey('ocean', 0) === 'temperate', 'зона и биом → климат: всегда зима, пустыня, болото, тёплый край; обычная зона — один умеренный (что идёт, то и ложится)');
  }

  // ═══ 8б. Климатические зоны и снег по времени (21.10.2026: «снег идёт, а блоки не меняются»; «где-то всегда зима, где-то зимы нет») ═══
  sec('погода по зонам: вечная зима — только снег, пустыня — сухо и без снега, снег ложится за минуты и тает');
  {
    const KW = window.KubomirWeather, Cl = window.D37E.climate;
    for (const k in KW.KB_CLIMATES) if (!Cl.CLIMATES[k]) Cl.CLIMATES[k] = KW.KB_CLIMATES[k];
    // целый год по календарю (замер раз в 2 ч): доля дождя и снега, крайние температуры
    const year = key => {
      const Wc = Cl.world({ seed: 'kb:зоны', mode: 'calendar', lapse: 0, seaY: 52, front: 0, climateAt: () => key });
      let rain = 0, snow = 0, n = 0, tmax = -99, tmin = 99; const t0 = Date.UTC(2026, 0, 1);
      for (let h = 0; h < 365 * 24; h += 2) { const q = Wc.at(0, 0, t0 + h * 3600e3, 60); n++; if (q.rain > .05) rain++; if (q.snow > .05) snow++; tmax = Math.max(tmax, q.temp); tmin = Math.min(tmin, q.temp); }
      return { rain: +(rain / n).toFixed(3), snow: +(snow / n).toFixed(3), tmax: +tmax.toFixed(1), tmin: +tmin.toFixed(1) };
    };
    const yS = year('kb_snow'), yD = year('kb_desert'), yW = year('kb_warm'), yB = year('kb_swamp'), yT = year('temperate');
    ok(yS.rain === 0 && yS.snow > .02 && yS.tmax < .5, 'вечная зима: весь год только снег, теплее −0,5° не бывает', yS);
    ok(yD.snow === 0 && yD.rain < .03 && yD.tmin > 2.5, 'пустыня: снега нет никогда, дождь — редкость', yD);
    ok(yW.snow === 0 && yB.snow === 0 && yW.tmin > 2.5 && yB.tmin > 2.5, 'тёплый край и болото: зимы нет — снега нет', { yW, yB });
    ok(yB.rain > yT.rain && yT.rain > yD.rain && yT.snow > .003 && yT.rain > .02, 'болото — дождь чаще всех, в обычной зоне есть и дождь, и снег (зимой)', { yB, yT, yD });
    // снег ложится по реальному времени (секунды): заметно — за 2–3 мин, бело — за 15–20 мин, тает в тепло, в мороз лежит
    const until = (c, goal, snow, temp, lim = 3600) => { let t = 0; const up = goal > c; while ((up ? c < goal : c > goal) && t < lim) { c = KW.coverStep(c, .5, snow, temp, 0, 1, 0); t += .5; } return t; };
    const tVis = until(0, .25, .7, -3), tFull = until(0, .97, .7, -3), tStrong = until(0, .97, 1, -6), tMelt = until(1, 0, 0, 5), tMeltHot = until(1, 0, 0, 15);
    ok(tVis >= 100 && tVis <= 180 && tFull >= 13 * 60 && tFull <= 20 * 60 && tStrong < tFull, 'снегопад: заметно за 2–3 мин, бело за 15–20 мин (сильный — быстрее)', { tVis, tFull, tStrong });
    ok(tMelt >= 3 * 60 && tMelt <= 12 * 60 && tMeltHot < tMelt && KW.coverStep(.6, 600, 0, -5) === .6 && KW.coverStep(.6, 60, 0, 2, 1) < KW.coverStep(.6, 60, 0, 2, 0), 'тает при +5° за 3–12 мин (в жару и под дождём — быстрее), в мороз лежит', { tMelt, tMeltHot });
    // в мире: обычная зона копит снег по времени; «всегда зима» — снег и лёд всегда; «зимы нет» — ни снега, ни льда
    const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z, zones = new Map();
    const Wz = { seed: 'зоны', listeners: [], raw(x, y, z){ x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); if (y < 0) return 7; if (y >= 128) return 0; const v = cells.get(key(x, y, z)); return v === undefined ? (y < 50 ? ID.stone : 0) : v; },
      get(x, y, z){ return this.raw(x, y, z) & 0xfff; }, set(){ return true; }, lightAt(){ return 15 << 12; }, loaded: () => true, heightAt: () => 50, chunkAt: () => ({ gen: true, maxY: 60 }),
      chunk(cx, cz){ const zn = zones.get(cx + ',' + cz); return zn === undefined ? null : { zone: new Uint8Array(256).fill(zn) }; } };
    zones.set('0,0', 0); zones.set('1,0', 1); zones.set('2,0', 2);
    for (const cx of [0, 1, 2]) for (let x = 2; x < 6; x++) for (let z = 2; z < 6; z++) cells.set(key(cx * 16 + x, 50, z), ID.water);
    const Rz = Object.assign({}, R, { lighting: { time: 12 }, night: 0, camera: new T.PerspectiveCamera(70, 1, .1, 200) });
    const stz = { R: Object.assign({}, Rz, { q: 'high' }), W: Wz, P: { x: 3.5, y: 51, z: 3.5 }, ox: 0, oz: 0, meta: { day: 1 }, VR: { U: { d37ClZ: { value: new Float32Array([0, 0, .5, 0]) } } } };
    const XZ = KW.create(stz); stz.WX = XZ;
    const fakeClim = { state: Cl.blank(), vis: { snowCover: 0, wet: 0, puddle: 0, ice: 0 }, opts: { fx: true }, frame(){}, dispose(){},
      W: { at: () => ({ snow: XZ._sn, rain: 0, temp: XZ._tp, sun: 0, cloud: 1, snowCover: 0, wet: 0, puddle: 0, ice: XZ._ice }) } };
    XZ.clim = fakeClim; XZ._sn = .8; XZ._tp = -4; XZ._ice = 0;
    const climOn = window.D37E.climShaders; window.D37E.climShaders = true;
    const now0 = Date.now; let fakeNow = now0();
    Date.now = () => fakeNow;
    try {
      for (let i = 0; i < 2; i++) { XZ.step(1); fakeNow += 500; }
      const c0 = XZ.cover;
      for (let i = 0; i < 360; i++) { fakeNow += 500; XZ.step(.5); }   // 3 мин снегопада
      const c3 = XZ.cover;
      XZ.frame(1 / 60, 0);
      ok(c0 < .02 && c3 > .25 && c3 < .5 && stz.meta.snow && Math.abs(stz.meta.snow.c - XZ.cover) < .002, 'снегопад в обычной зоне: за 3 мин снег пятнами (в мире — meta.snow)', { c0, c3, m: stz.meta.snow });
      const zu = stz.VR.U.d37ClZ.value;
      ok(zu[3] === 1 && zu[0] === 1 && zu[1] === 0, 'шейдеру: зоны включены, «всегда зима» — снег всегда, «зимы нет» — без снега', [...zu]);
      // лёд: обычная зона — по погоде (ещё нет), «всегда зима» — есть, «зимы нет» — нет
      XZ.iceTick();
      ok(!V.isIce(Wz, 3, 50, 3) && V.isIce(Wz, 19, 50, 3) && !V.isIce(Wz, 35, 50, 3), 'лёд: обычная зона — по погоде, «всегда зима» — всегда, «зимы нет» — никогда', [V.isIce(Wz, 3, 50, 3), V.isIce(Wz, 19, 50, 3), V.isIce(Wz, 35, 50, 3)]);
      XZ._ice = 1; fakeNow += 500; XZ.step(.5); XZ.iceTick();
      ok(V.isIce(Wz, 3, 50, 3) && !V.isIce(Wz, 35, 50, 3), 'мороз в обычной зоне — лёд и там; в тёплой — всё равно нет');
      // прорубь в «всегда зима» не замерзает сразу, когда в обычной зоне тает
      XZ.hole(19, 50, 3); XZ._ice = 0; fakeNow += 500; XZ.step(.5); XZ.iceTick(); XZ.iceTick();
      ok(XZ.isHole(19, 50, 3) && !V.isIce(Wz, 19, 50, 3) && V.isIce(Wz, 20, 50, 3) && !V.isIce(Wz, 3, 50, 3), 'прорубь в вечной зиме живёт своё время, хоть в обычной зоне и оттаяло');
      // тепло — тает; погоду выключили — снега нет
      XZ._sn = 0; XZ._tp = 8; for (let i = 0; i < 1200; i++) { fakeNow += 500; XZ.step(.5); }
      ok(XZ.cover === 0, 'потеплело (+8°) — за 10 мин растаял', XZ.cover);
      XZ._sn = .8; XZ._tp = -4; for (let i = 0; i < 200; i++) { fakeNow += 500; XZ.step(.5); }
      stz.weatherOff = true; fakeNow += 500; XZ.step(.5); XZ.iceTick(); XZ.frame(1 / 60, 0);
      ok(XZ.cover === 0 && !V.isIce(Wz, 19, 50, 3) && zu[0] === 0, '⚙️ «Погода» выкл — ни снега, ни льда (и в вечной зиме)', { cover: XZ.cover, z: [...zu] });
    } finally { Date.now = now0; window.D37E.climShaders = climOn; XZ.clim = null; XZ.dispose(); }
    ok(stz.VR.U.d37ClZ.value[3] === 0 && !V.iceTest, 'закрыли мир — зоны в шейдере выключены, лёд не проверяется');
  }

  // ═══ 9. Генератор: старые миры (genVer нет / 1) — блоки ровно как раньше, новые (2) — извилистые границы и пятна снега ═══
  sec('генератор: v1 — как было, v2 — извилистые границы биомов и переходная полоса у снегов');
  {
    const sumIds = ver => { let h = 0; for (const seed of ['test-v1', 12345]) { const G = V.genInit(seed, { ver }); for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) { const r = V.genChunk(G, cx * 7, cz * 5); for (let i = 0; i < r.ids.length; i++) h = (Math.imul(h, 31) + r.ids[i]) | 0; } } return h; };
    const s1 = sumIds(1);
    ok(s1 === 1214627954, 'v1 (миры до 16.10): блоки ровно как раньше — несохранённые чанки не вырастут другими', s1);
    ok(sumIds(2) !== s1, 'v2 (новые миры) — свой рельеф у границ');
    const strip = ver => {
      const G = V.genInit('kubik', { ver }); let mixed = 0, cells = 0;
      for (let cx = -1; cx <= 3; cx++) for (let cz = 9; cz <= 12; cz++) {
        const r = V.genChunk(G, cx, cz);
        for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
          let top = 0; for (let y = 127; y > 0; y--) { const v = r.ids[(x << 11) | (z << 7) | y] & 0xfff; if (v) { top = v; break; } }
          if (top !== ID.grass && top !== ID.snow_grass) continue;
          cells++; if ((top === ID.snow_grass) !== (r.biome[x * 16 + z] === 6)) mixed++;
        }
      }
      return { mixed, cells };
    };
    const a1 = strip(1), a2 = strip(2);
    ok(a1.mixed === 0 && a2.mixed > 40 && a2.cells > 1000, 'у границы снегов: v1 — ровная смена по биому, v2 — снег и трава пятнами (переходная полоса)', [a1, a2]);
    // цвет травы — плавно (шатёр по 8 блоков): у соседних столбцов разница маленькая и в v1
    const G1 = V.genInit('kubik', { ver: 1 }); let dmax = 0;
    for (let cz = 9; cz <= 12; cz++) { const r = V.genChunk(G1, 1, cz); for (let x = 0; x < 16; x++) for (let z = 0; z < 15; z++) { const o = (x * 16 + z) * 9, o2 = (x * 16 + z + 1) * 9; for (let q = 0; q < 3; q++) dmax = Math.max(dmax, Math.abs(r.tint[o + q] - r.tint[o2 + q])); } }
    ok(dmax <= 12, 'цвет травы между соседними столбцами меняется плавно (≤ 12 из 255)', dmax);
  }

  // ═══ 10. Вещь в руке и на земле: выдавлена по пикселям (бока — своим цветом), не «бумажная» и не чёрная ═══
  sec('вещь в руке: толщина 1/16, бока по краю пикселей своим цветом');
  {
    const g = VR.itemGeo('pick_wood'), pos = g.attributes.position.array, cl = g.attributes.color.array, n = g.attributes.position.count / 4;
    let zmin = 9, zmax = -9, dark = 0;
    for (let i = 2; i < pos.length; i += 3) { zmin = Math.min(zmin, pos[i]); zmax = Math.max(zmax, pos[i]); }
    for (let i = 0; i < cl.length; i += 3) if (cl[i] + cl[i + 1] + cl[i + 2] < 30) dark++;
    ok(g.userData.flat && n > 60 && zmax - zmin > .05 && zmax - zmin < .08 && dark === 0, 'кирка: лицо, спина и борта по краю (больше 60 граней), толщина 1/16, без чёрных граней', { n, th: +(zmax - zmin).toFixed(3), dark });
    ok(VR.itemGeo('torch').attributes.position.count === 8, 'факел и растения (блоки) — как были: две плоскости');
  }

  // ═══ 11. Падающие деревья (V.component + X.fallGroup): валятся только настоящие, лёг — брёвна вещами ═══
  sec('деревья: подрубил — валится только настоящее дерево; лёг — брёвна вещами; время падения — по тактам');
  {
    const key = (x, y, z) => x + ',' + y + ',' + z;
    const mkW = () => { const cells = new Map(); return { seed: 5, listeners: [], cells,
      raw(x, y, z){ x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); if (y < 0) return 7; if (y >= 128) return 0; const v = cells.get(key(x, y, z)); return v === undefined ? (y < 10 ? ID.stone : 0) : v; },
      get(x, y, z){ const v = this.raw(x, y, z); return v < 0 ? -1 : v & 0xfff; }, set(x, y, z, v){ cells.set(key(Math.floor(x), Math.floor(y), Math.floor(z)), v); return true; },
      lightAt(){ return 15 << 12; }, loaded: () => true, heightAt: () => 10, chunkAt: () => null, chunk: () => null }; };
    const tree = (W, x, z, h = 5, r = 2, layers = 3) => {
      for (let y = 10; y < 10 + h; y++) W.cells.set(key(x, y, z), ID.log_oak);
      const top = 10 + h - 1;
      for (let y = top - layers + 1; y <= top + 1; y++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (W.raw(x + dx, y, z + dz) === 0 && (y <= top || (Math.abs(dx) <= 1 && Math.abs(dz) <= 1))) W.cells.set(key(x + dx, y, z + dz), ID.leaves_oak);
    };
    const mk = (W, diff = 'easy') => { const S11 = { R: Object.assign({}, R, { lighting: { time: 12 }, night: 0 }), VR, W, P: { x: 47.5, y: 10, z: 50.5, vx: 0, vy: 0, vz: 0, dead: false }, ox: 0, oz: 0, meta: { diff }, ST: { rd: 6 }, creative: false }; const X = window.KubomirEnts.create(S11); S11.ents = X; X.spawnT = 1e9; return { X, S11 }; };
    const fell = (frames) => {
      const W = mkW(); tree(W, 50, 50); const { X, S11 } = mk(W);
      W.set(50, 10, 50, 0);   // подрубил нижнее бревно
      const g = X.fellTree(50, 10, 50, S11.P);
      const res = { ok: !!g, removed: W.get(50, 12, 50) === 0 && W.get(51, 13, 51) === 0 && W.get(52, 12, 52) === 0, ticks: -1, logs: 0, dir: g ? [g.dx, g.dz] : null };
      for (let i = 0; i < 200 && X.groups.length; i++) { X.tick(1 / 20); if (frames) for (let k = 0; k < frames(i); k++) { X.frac = (k + 1) / (frames(i) + 1); X.frame(1 / 144, i / 20); } if (!X.groups.length) res.ticks = i; }
      res.logs = X.items.filter(e => e.s.id === 'log_oak').reduce((a, e) => a + e.s.n, 0);
      res.items = X.items.length; X.dispose(); return res;
    };
    const A = fell(null), B = fell(i => 1 + (i * 5) % 4);
    ok(A.ok && A.removed, 'подрубил дерево — стволы и листва убраны из мира (обычные правки), падает одна сетка', A);
    ok(A.dir && A.dir[0] > .9, 'валится от игрока (игрок с запада — дерево на восток)', A.dir);
    ok(A.ticks > 5 && A.ticks < 80 && B.ticks === A.ticks, 'время падения — по тактам игры, кадры не влияют', [A.ticks, B.ticks]);
    ok(A.logs === 4, 'лёг — каждое бревно стало вещью (4 над срезом)', A.logs);
    // не валится: голый столб, дом из брёвен, дерево у досок, слишком большое
    const none = (build, cut) => { const W = mkW(); build(W); const { X, S11 } = mk(W); W.set(cut[0], cut[1], cut[2], 0); const g = X.fellTree(cut[0], cut[1], cut[2], S11.P); const st = W.get(cut[0], cut[1] + 1, cut[2]); X.dispose(); return !g && st === ID.log_oak; };
    ok(none(W => { for (let y = 10; y < 15; y++) W.cells.set(key(50, y, 50), ID.log_oak); }, [50, 10, 50]), 'голый столб из брёвен (без листвы) — стоит');
    ok(none(W => { for (let y = 10; y < 13; y++) for (let x = 48; x <= 52; x++) for (let z = 48; z <= 52; z++) if (x === 48 || x === 52 || z === 48 || z === 52) W.cells.set(key(x, y, z), ID.log_oak); for (let x = 48; x <= 52; x++) for (let z = 48; z <= 52; z++) W.cells.set(key(x, 13, z), ID.leaves_oak); }, [50, 10, 48]), 'дом из брёвен (даже с крышей из листвы) — стоит: стены держатся за землю');
    ok(none(W => { tree(W, 50, 50); W.cells.set(key(51, 12, 50), ID.planks_oak); }, [50, 10, 50]), 'дерево касается досок (постройка) — не валится');
    ok(none(W => tree(W, 50, 50, 10, 4, 8), [50, 10, 50]), 'слишком большое (больше 220 блоков) — как в Майнкрафте, ничего не падает');
    // не больше 3 сразу
    { const W = mkW(); for (let k = 0; k < 4; k++) tree(W, 50 + k * 8, 50); const { X, S11 } = mk(W); let n = 0; for (let k = 0; k < 4; k++) { W.set(50 + k * 8, 10, 50, 0); if (X.fellTree(50 + k * 8, 10, 50, S11.P)) n++; } ok(n === 3 && X.groups.length === 3, 'падает не больше 3 деревьев сразу', n); X.dispose(); }
    // V.component: опора и «чужое»
    { const W = mkW(); for (let y = 10; y < 13; y++) W.cells.set(key(5, y, 5), ID.log_oak);
      const c = V.component(W, [[5, 11, 5]], { take: v => (v & 0xfff) === ID.log_oak, edge: (v, x, y, z, dy) => v === ID.stone && dy < 0 ? 1 : 0, max: 10 });
      ok(c && c.n === 3 && c.grounded && c.box[1] === 10 && c.box[4] === 12, 'V.component: кусок, опора снизу, рамка', c && { n: c.n, g: c.grounded, box: c.box });
      ok(V.component(W, [[5, 11, 5]], { take: v => (v & 0xfff) === ID.log_oak, max: 2 }) === null && V.stabilityOf(V.blocks[ID.log_oak]).base > 0, 'V.component: больше предела — null; запас прочности (на будущее) — данные есть'); }
  }

  // ═══ 12. Обрушение и прочность (T-022a: D37E.support + kubomir-support.js + fallGroup drop) ═══
  sec('обрушение: постройка держится по материалу, подрубил опору — падает куском и ложится блоками; своды пещер в «реализме»');
  {
    run('js/engine/support.js'); run('js/games/kubomir-support.js');
    const KS = window.KubomirSupport, SUP = E.support, key = (x, y, z) => x + ',' + y + ',' + z;
    // мир: ниже y 10 — природный камень; правки игрока — в «чанке» (edits по номеру клетки, как у V.World)
    const mkSW = (floor = 10) => { const cells = new Map(), chunks = new Map(); const W = { seed: 9, rev: 0, listeners: [], cells, chunks,
      raw(x, y, z){ x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); if (y < 0) return 7; if (y >= 128) return 0; const v = cells.get(key(x, y, z)); return v === undefined ? (y < floor ? ID.stone : 0) : v; },
      get(x, y, z){ const v = this.raw(x, y, z); return v < 0 ? -1 : v & 0xfff; },
      chunk(cx, cz){ const k = cx + '|' + cz; let c = chunks.get(k); if (!c) chunks.set(k, c = { cx, cz, edits: null, gen: true }); return c; },
      set(x, y, z, v, o = {}){ x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); cells.set(key(x, y, z), v); this.rev++; if (!o.nat) { const c = this.chunk(x >> 4, z >> 4); (c.edits || (c.edits = new Map())).set(((x & 15) << 11) | ((z & 15) << 7) | y, v); } return true; },
      lightAt(){ return 15 << 12; }, loaded: () => true, heightAt: () => floor, chunkAt(x, z){ return this.chunk(Math.floor(x) >> 4, Math.floor(z) >> 4); } }; return W; };
    const mkS = (W, support, diff = 'easy') => { const S12 = { R: Object.assign({}, R, { lighting: { time: 12 }, night: 0 }), VR, W, P: { x: 30.5, y: 10, z: 30.5, vx: 0, vy: 0, vz: 0, dead: false }, ox: 0, oz: 0, meta: { diff, support }, ST: { rd: 6 }, creative: false };
      const X = window.KubomirEnts.create(S12); S12.ents = X; X.spawnT = 1e9; S12.sup = KS.attach(S12); return { X, S12 }; };
    const PL = V.cell(ID.planks_oak), CB = V.cell(ID.cobble);
    ok(KS.attach({ meta: {}, W: mkSW() }) === null && KS.attach({ meta: { support: 'off' }, W: mkSW() }) === null, 'старый мир (нет meta.support) и «выкл» — без обрушения');
    // постройка: доски — столб 5 и балка вбок
    const build = W => { for (let y = 10; y < 15; y++) W.set(50, y, 50, PL); for (let x = 51; x <= 54; x++) W.set(x, 14, 50, PL); };
    { const W = mkSW(); build(W); const { X, S12 } = mkS(W, 'real');
      const s = S12.sup;
      ok(s.code(50, 12, 50) === ((SUP.MAT.wood << 2) | 2) && s.code(50, 5, 50) === ((SUP.MAT.rock << 2) | 3) && s.code(50, 20, 50) === 0, 'код клетки: доска — постройка (дерево), камень под землёй — природная скала, воздух — пусто');
      const b = V.blocks[ID.planks_oak];
      ok(!s.canPlace(55, 14, 50, b) && s.canPlace(54, 15, 50, b), 'реализм: столб из досок 5 и балка 4 — пятый вбок уже не держится, сверху на конец балки — можно');
      const T1 = { x: 51, y: 15, z: 50 }, T2 = { x: 55, y: 14, z: 50 };
      const c1 = s.tint(T1, b).slice(), l1 = s.level(), c2 = s.tint(T2, b).slice(), l2 = s.level();
      ok(l1 <= 2 && l2 >= 3 && c1.join() !== c2.join(), 'рамка «куда встанет блок» — цветом: у столба крепко, на конце балки — красная', { l1, l2 });
      X.dispose(); }
    // подрубил столб: верх столба и балка падают куском, ложатся блоками (сколько было — столько и есть: блоками или вещами)
    const collapse = (frames) => {
      const W = mkSW(); build(W); const { X, S12 } = mkS(W, 'soft');
      const code = S12.sup.code(50, 11, 50); W.set(50, 11, 50, 0);
      const ng = S12.sup.removed(50, 11, 50, code);
      const res = { ng, groups: X.groups.length, drop: !!X.groups[0]?.F, removed: W.get(50, 14, 50) === 0 && W.get(53, 14, 50) === 0, ticks: -1 };
      for (let i = 0; i < 400 && X.groups.length; i++) { X.tick(1 / 20); if (frames) for (let k = 0; k < frames(i); k++) { X.frac = (k + 1) / (frames(i) + 1); X.frame(1 / 144, i / 20); } if (!X.groups.length) res.ticks = i; }
      let blocks = 0; for (const [k, v] of W.cells) if ((v & 0xfff) === ID.planks_oak) blocks++;
      res.blocks = blocks; res.items = X.items.reduce((a, e) => a + (e.s.id === 'planks_oak' ? e.s.n : 0), 0);
      res.top = []; for (let x = 50; x <= 54; x++) { let y = 20; while (y > 9 && W.get(x, y, 50) !== ID.planks_oak) y--; res.top.push(y); }
      X.dispose(); return res;
    };
    const A = collapse(null), B = collapse(i => 1 + (i * 7) % 5);
    ok(A.ng === 1 && A.groups === 1 && A.drop && A.removed, 'подрубил столб — верх столба и балка падают одним куском (drop)', A);
    ok(A.ticks > 2 && A.ticks < 60 && B.ticks === A.ticks && A.top.join() === B.top.join(), 'падает по тактам игры: кадры не влияют (тот же такт и то же место)', [A.ticks, B.ticks, A.top, B.top]);
    ok(A.blocks + A.items === 4 + 3 + 1, 'ничего не потерялось: 7 упавших + 1 оставшийся — блоками или вещами', A);
    ok(A.top.every(y => y === 13), 'лёг блоками на остаток столба (упал на 1 блок), балка — держится и после падения', A.top);
    { const W = mkSW(); build(W); const { X, S12 } = mkS(W, 'soft'); ok(S12.sup.canPlace(55, 14, 50, V.blocks[ID.planks_oak]) && !S12.sup.canPlace(57, 14, 50, V.blocks[ID.planks_oak]), '«мягкое»: природное — опора, балка длиннее (5-й вбок можно); в воздухе без соседей — нельзя'); X.dispose(); }
    // легло и не держится само (лёг краем на столб) — падает дальше: проверка после падения (каскад, X.recheck)
    { const W = mkSW(); for (let y = 10; y < 15; y++) W.set(60, y, 50, PL); for (let x = 61; x <= 69; x++) W.set(x, 14, 50, PL);   // «легла» балка 9 — дальше 4 не держится
      const { X, S12 } = mkS(W, 'real'); const xyz = []; for (let x = 61; x <= 69; x++) xyz.push(x, 14, 50);
      S12.sup.recheck(xyz);
      for (let i = 0; i < 600 && X.groups.length; i++) X.tick(1 / 20);
      let hang = 0, ground = 0; for (let x = 61; x <= 69; x++) { if (W.get(x, 14, 50) === ID.planks_oak) hang++; if (W.get(x, 10, 50) === ID.planks_oak) ground++; }
      ok(hang === 4 && ground === 5 && S12.sup.stats.groups === 1, 'легла и не держится — дальняя часть балки падает дальше и ложится на землю', { hang, ground, groups: S12.sup.stats.groups });
      X.dispose(); }
    // сетка падающего куска: грани между кубиками куска не рисуются (3×3×3 досок — только наружные 54 квадрата)
    { const W = mkSW(); const { X } = mkS(W, 'soft'); const cells = []; for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) cells.push(60 + x, 20 + y, 60 + z, PL);
      const g = X.fallGroup(cells, { x: 61.5, y: 20, z: 61.5 }, { x: 1, z: 0 }, { drop: true, cap: 8 });
      ok(g && g.geo.attributes.position.count === 54 * 4 && g.geo.index.count === 54 * 6, 'сетка падающего куска 3×3×3: только наружные грани (54 квадрата вместо 162)', g && g.geo.attributes.position.count);
      X.dispose(); }
    // факел на падающем — отпадает вещью
    { const W = mkSW(); build(W); W.set(52, 15, 50, V.cell(ID.torch, 0)); const { X, S12 } = mkS(W, 'soft');
      const code = S12.sup.code(50, 11, 50); W.set(50, 11, 50, 0); S12.sup.removed(50, 11, 50, code);
      ok(W.get(52, 15, 50) === 0 && X.items.some(e => e.s.id === 'torch'), 'факел на падающей балке — отпал вещью'); X.dispose(); }
    // своды пещер: «реализм» — широкий зал обваливается (лёг булыжником), «мягкое» — нет
    const cave = (support) => {
      const W = mkSW(40);
      for (let x = 15; x < 38; x++) for (let z = 5; z < 28; z++) for (let y = 25; y < 28; y++) if (!(x === 37 && z === 16)) W.set(x, y, z, 0, { nat: false });
      const { X, S12 } = mkS(W, support);
      const code = S12.sup.code(37, 26, 16); W.set(37, 26, 16, 0);
      // выкопали «вручную» без пересчёта весь зал, кроме одной клетки у стены — дальше по-честному: последняя клетка
      const ng = S12.sup.removed(37, 26, 16, code);
      for (let i = 0; i < 400 && X.groups.length; i++) X.tick(1 / 20);
      let cob = 0; for (const [, v] of W.cells) if ((v & 0xfff) === ID.cobble) cob++;
      X.dispose(); return { ng, cob, ms: S12.sup.stats.maxMs };
    };
    const Cr = cave('real'), Cs = cave('soft');
    ok(Cs.ng === 0 && Cs.cob === 0, '«мягкое»: свод пещеры не обваливается', Cs);
    ok(Cr.ng >= 0 && typeof Cr.ms === 'number', 'реализм: пересчёт свода — ' + Cr.ms.toFixed(1) + ' мс', Cr);
    // зал: сначала 13×13 честно по клеткам (держится), потом шире — середина падает и ложится булыжником
    { const W = mkSW(40); const { X, S12 } = mkS(W, 'real'); let fell = 0;
      const dig = (x, y, z) => { const c = S12.sup.code(x, y, z); W.set(x, y, z, 0); fell += S12.sup.removed(x, y, z, c); };
      for (let x = 20; x < 33; x++) for (let z = 10; z < 23; z++) for (let y = 25; y < 28; y++) dig(x, y, z);
      const f13 = fell;
      for (let x = 15; x < 38; x++) for (let z = 5; z < 28; z++) for (let y = 25; y < 28; y++) if (W.get(x, y, z)) dig(x, y, z);
      for (let i = 0; i < 400 && X.groups.length; i++) X.tick(1 / 20);
      let cob = 0; for (const [, v] of W.cells) if ((v & 0xfff) === ID.cobble) cob++;
      ok(f13 === 0 && fell > 0 && cob > 0, 'реализм: зал 13×13 держится; выкопал до 23×23 — свод обвалился и лёг булыжником', { f13, fell, cob, solves: S12.sup.stats.solves, avgMs: +(S12.sup.stats.ms / S12.sup.stats.solves).toFixed(2), maxMs: +S12.sup.stats.maxMs.toFixed(1) });
      console.log(`  реализм, копание зала по клетке: ${S12.sup.stats.solves} пересчётов, в среднем ${(S12.sup.stats.ms / S12.sup.stats.solves).toFixed(2)} мс, худший ${S12.sup.stats.maxMs.toFixed(1)} мс`);
      X.dispose(); }
  }

  // ═══ 13. Огонь (T-022d: D37E.fire + kubomir-fire.js + пламя движка fx.js) ═══
  sec('огонь: огниво поджигает, дом сгорает (доски чернеют), дерево валится, дёрн — в землю, вода и дождь гасят, лава поджигает, «выкл» — не перекидывается');
  {
    run('js/engine/fire.js'); run('js/engine/fx.js'); run('js/games/kubomir-fire.js');
    if (!E.support) run('js/engine/support.js');
    if (!window.KubomirSupport) run('js/games/kubomir-support.js');
    const KF = window.KubomirFire, key = (x, y, z) => x + ',' + y + ',' + z;
    // горючесть — по полям блока (без списков имён): новые деревья и моды горят сами
    const bo = n => V.burnOf(V.block(n));
    ok(bo('log_oak') === 'wood' && bo('leaves_spruce') === 'leaves' && bo('planks_birch') === 'planks' && bo('grass') === 'turf' && bo('tall_grass') === 'grass' && bo('bed') === 'cloth' && bo('chest') === 'planks',
      'горит: брёвна, листва, доски, дёрн, трава, лежанка, сундук', ['log_oak', 'leaves_spruce', 'planks_birch', 'grass', 'tall_grass', 'bed', 'chest'].map(bo));
    ok(['stone', 'dirt', 'sand', 'water', 'lava', 'torch', 'glass', 'cactus', 'bouncer', 'snow_grass', 'iron_block', 'lamp', 'furnace'].every(n => bo(n) === ''), 'не горит: камень, земля, песок, вода, лава, факел, стекло, кактус, батут, снег, железо, лампа, печь');
    ok(V.burnOf({ name: 'log_new_tree', shape: V.SHAPE.cube, sound: 'wood', axis: true, tool: 'axe' }) === 'wood' && V.burnOf({ name: 'x_leaves', layer: V.LAYER.cutout, tint: V.TINT.foliage, shape: V.SHAPE.cube }) === 'leaves' && V.burnOf({ name: 'branch', foliage: true }) === 'leaves'
      && V.burnOf({ name: 'stone_wood_look', sound: 'wood', burn: '' }) === '' && V.burnOf({ name: 'oil', burn: 'fuel' }) === 'fuel', 'новый блок (другое дерево, ветка, мод) — по полям; своё поле burn главнее');
    ok(bo('fire') === 'flame' && bo('charred_planks') === 'char' && V.item('flint_steel')?.use === 'ignite' && V.craft(['iron_ingot', 'flint', null, null], 2, 2)?.out === 'flint_steel', 'блоки «огонь» и «обугленные доски», огниво (железо + кремень)');
    // мир: ниже y 9 — камень, y 9 — дёрн; правки — в чанке (как у V.World), слушатели правок — как у V.World
    const mkFW = () => { const cells = new Map(), chunks = new Map(); const W = { seed: 21, rev: 0, listeners: [], cells, chunks,
      raw(x, y, z){ x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); if (y < 0) return 7; if (y >= 128) return 0; const v = cells.get(key(x, y, z)); return v === undefined ? (y < 9 ? ID.stone : y === 9 ? ID.grass : 0) : v; },
      get(x, y, z){ const v = this.raw(x, y, z); return v < 0 ? -1 : v & 0xfff; },
      chunk(cx, cz){ const k = cx + '|' + cz; let c = chunks.get(k); if (!c) chunks.set(k, c = { cx, cz, key: k, edits: null, gen: true }); return c; },
      set(x, y, z, v, o = {}){ x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); const was = this.raw(x, y, z); if (was === v) return false; cells.set(key(x, y, z), v); this.rev++; const c = this.chunk(x >> 4, z >> 4); (c.edits || (c.edits = new Map())).set(((x & 15) << 11) | ((z & 15) << 7) | y, v); for (const f of this.listeners) f(x, y, z, was, v, o); return true; },
      lightAt(){ return 15 << 12; }, loaded: () => true, heightAt: () => 10, chunkAt(x, z){ return this.chunk(Math.floor(x) >> 4, Math.floor(z) >> 4); } }; return W; };
    const R13 = Object.assign({}, R, { lighting: { time: 12 }, night: 0 });
    const mkF = (W, o = {}) => {
      const S13 = { R: R13, VR, W, P: { x: 30.5, y: 10, z: 30.5, vx: 0, vy: 0, vz: 0, dead: false, inv: [] }, ox: 0, oz: 0, meta: Object.assign({ diff: 'easy', seed: 'fire' }, o.meta || {}), ST: { rd: 6 }, creative: false, coopGuest: !!o.guest, net: o.net || null, WX: o.WX || null, fellOn: () => true };
      const X = window.KubomirEnts.create(S13); S13.ents = X; X.spawnT = 1e9;
      S13.sup = window.KubomirSupport.attach(S13);
      S13.fire = KF.attach(S13);
      W.listeners.push((x, y, z, was, v, ev) => { S13.ents.onBlockChanged(x, y, z, was, v); S13.fire?.onEdit(x, y, z, was, v, ev); });
      return { X, S13, F: S13.fire };
    };
    const ticks = (S, n) => { for (let i = 0; i < n; i++) { S.fire.tick(); S.ents.tick(1 / 20); S.sup?.step(); } };
    const PL = V.cell(ID.planks_oak);
    const house = W => { for (let x = 20; x < 26; x++) for (let z = 20; z < 26; z++) for (let y = 10; y <= 13; y++) if (x === 20 || x === 25 || z === 20 || z === 25 || y === 13) W.set(x, y, z, PL); };
    const count = (W, id) => { let n = 0; for (const v of W.cells.values()) if ((v & 0xfff) === id) n++; return n; };
    { const F0 = KF.attach({ meta: {}, W: mkFW(), R: R13, coopGuest: false }); ok(F0.spread === false, 'старый мир (нет meta.fire) — огонь не распространяется'); F0.dispose(); }
    // огниво по дому: загорелась доска, рядом — блок «огонь»
    const burnHouse = (spread, extra) => {
      const W = mkFW(); house(W); const { X, S13, F } = mkF(W, { meta: { fire: spread ? 'spread' : 'off', support: 'soft' } });
      const s = { id: 'flint_steel', n: 1, d: 0 }; S13.P.inv = [s];
      const used = F.useIgniter(s, V.item('flint_steel'), 'main', { x: 20, y: 10, z: 22, nx: -1, ny: 0, nz: 0, v: PL });
      const r = { used, fire0: count(W, ID.fire), burning0: F.F.n, wear: s.d, charMax: 0, fireMax: 0 };
      extra?.(W, S13, F);
      for (let t = 0; t < 20 * 240 && F.F.n; t++) { ticks(S13, 1); if (t % 40 === 0) { r.charMax = Math.max(r.charMax, count(W, ID.charred_planks)); r.fireMax = Math.max(r.fireMax, count(W, ID.fire)); } }
      r.planks = count(W, ID.planks_oak) + count(W, ID.charred_planks); r.fire = count(W, ID.fire); r.burnt = F.stats.burnt; r.n = F.F.n; r.sec = F.F.T / 20; r.coal = F.stats.coal;
      r.hash = [...W.cells.entries()].filter(([, v]) => v).map(([k, v]) => k + '=' + v).sort().join(';').length + ':' + F.F.stats.ignited + ':' + F.F.T;
      X.dispose(); F.dispose();
      return r;
    };
    const H1 = burnHouse(true), H2 = burnHouse(true);
    ok(H1.used && H1.burning0 === 1 && H1.fire0 === 1 && H1.wear === 1, 'огниво: доска горит, рядом блок «огонь», огниво износилось', H1);
    ok(H1.planks <= 15 && H1.burnt > 60, 'дом из досок сгорел (огонь перекинулся: из 96 досок — 81 и больше)', H1);
    ok(H1.charMax > 0, 'доски чернеют, прежде чем осыпаться (обугленные доски)', H1.charMax);
    ok(H1.fire === 0 && H1.fireMax > 3, 'догорело — блоков «огонь» не осталось (во время пожара — были)', { fire: H1.fire, max: H1.fireMax });
    ok(H1.hash === H2.hash, 'одинаково при повторе (одно зерно мира)', [H1.hash, H2.hash]);
    const H0 = burnHouse(false);
    ok(H0.burnt === 1 && H0.planks >= 6 * 6 + 4 * 3 * 4 - 2, '«Огонь распространяется: выкл» — сгорела только подожжённая доска', H0);
    // вода гасит: вода в клетке «огня» рядом с доской — погасло
    const HW = burnHouse(true, (W, S13) => { ticks(S13, 4); W.set(19, 10, 22, V.cell(ID.water)); });
    ok(HW.burnt === 0 && HW.fire === 0, 'вода рядом — погасло', HW);
    // поставил блок на «огонь» — погасло
    const HB = burnHouse(true, (W, S13) => { ticks(S13, 2); W.set(19, 10, 22, V.cell(ID.cobble)); });
    ok(HB.burnt === 0, 'закрыл огонь блоком — погасло', HB);
    // дерево: загорелась верхушка — листва сгорела, бревно догорело — дерево валится (путь топора) или сгорает целиком
    {
      const W = mkFW(); for (let y = 10; y < 15; y++) W.set(40, y, 40, V.cell(ID.log_oak));
      for (let y = 13; y <= 15; y++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (W.raw(40 + dx, y, 40 + dz) === 0) W.set(40 + dx, y, 40 + dz, V.cell(ID.leaves_oak));
      const { X, S13, F } = mkF(W, { meta: { fire: 'spread' } });
      F.igniteAt(40, 15, 40, 0, 1, 0);
      let fellSeen = false;
      for (let t = 0; t < 20 * 200 && F.F.n; t++) { ticks(S13, 1); if (X.groups.length) fellSeen = true; }
      ok(count(W, ID.leaves_oak) <= 7, 'листва сгорела (почти вся: 66 из 73 и больше)', count(W, ID.leaves_oak));
      ok(count(W, ID.log_oak) < 5 && (F.stats.fell > 0 || count(W, ID.log_oak) === 0), 'ствол догорел: дерево свалилось (путь топора) или сгорело', { logs: count(W, ID.log_oak), fell: F.stats.fell, fellSeen });
      X.dispose(); F.dispose();
    }
    // дёрн: загорелся — стал землёй
    {
      const W = mkFW(); const { X, S13, F } = mkF(W, { meta: { fire: 'off' } });
      F.igniteAt(30, 9, 30, 0, 1, 0); ok(F.F.n === 1 && W.get(30, 10, 30) === ID.fire, 'дёрн горит, огонь — над ним');
      ticks(S13, 20 * 4);
      ok(W.get(30, 9, 30) === ID.dirt && W.get(30, 10, 30) === 0, 'дёрн догорел — земля, огня нет', [W.get(30, 9, 30), W.get(30, 10, 30)]);
      X.dispose(); F.dispose();
    }
    {
      const W = mkFW(); W.set(50, 10, 50, V.cell(ID.cobble)); const { X, S13, F } = mkF(W, { meta: { fire: 'off' } });
      ok(F.igniteAt(50, 10, 50, 0, 1, 0) && W.get(50, 11, 50) === ID.fire, 'огниво по камню — пламя без топлива на нём');
      ticks(S13, 20 * 8);
      ok(W.get(50, 11, 50) === 0 && F.F.n === 0, '…несколько секунд — и гаснет само');
      X.dispose(); F.dispose();
    }
    // дождь гасит то, что под открытым небом
    {
      const rainHouse = rain => { const W = mkFW(); house(W); const WX = { rain, clim: { state: { wind: 0, windDir: 0, temp: 15 } }, tz: { wet: 0 } };
        const { X, S13, F } = mkF(W, { meta: { fire: 'spread' }, WX }); F.igniteAt(22, 13, 22, 0, 1, 0);
        for (let t = 0; t < 20 * 120 && F.F.n; t++) ticks(S13, 1);
        const r = { burnt: F.stats.burnt, out: F.F.stats.out }; X.dispose(); F.dispose(); return r; };
      const dry = rainHouse(0), wet = rainHouse(1);
      ok(wet.burnt < dry.burnt * .5 && wet.out > 0, 'ливень — крыша горит хуже и гаснет', { dry, wet });
    }
    // лава поджигает горючее рядом (поток сообщил, где лава)
    {
      const W = mkFW(); W.set(30, 10, 30, V.cell(ID.lava)); W.set(30, 11, 31, PL); W.set(31, 11, 30, PL); W.set(30, 11, 30, 0);
      const { X, S13, F } = mkF(W, { meta: { fire: 'spread' } });
      const c = W.chunk(1, 1); F.onMesh(c, { lights: Int32Array.from([((30 & 15) << 11) | ((30 & 15) << 7) | 10 | (ID.lava << 15)]) });
      ticks(S13, 20 * 20);
      ok(F.stats.lava > 0, 'лава подожгла доски рядом', F.stats);
      X.dispose(); F.dispose();
    }
    // чанк с лавой выгрузили (без правок) — его лава забыта: не поджигает и не копится
    {
      const W = mkFW(); W.set(30, 10, 30, V.cell(ID.lava)); W.set(30, 11, 31, PL); W.set(31, 11, 30, PL); W.set(30, 11, 30, 0);
      const { X, S13, F } = mkF(W, { meta: { fire: 'spread' } });
      const c = W.chunk(1, 1); F.onMesh(c, { lights: Int32Array.from([((30 & 15) << 11) | ((30 & 15) << 7) | 10 | (ID.lava << 15)]) });
      F.onDrop({ key: c.key, cx: c.cx, cz: c.cz });
      ticks(S13, 20 * 20);
      ok(F.stats.lava === 0, 'выгруженный чанк без правок — его лава забыта', F.stats);
      X.dispose(); F.dispose();
    }
    // гость: ядра нет — огниво просит хозяина; пламя — по блокам «огонь» из правок
    {
      const W = mkFW(); const asks = [];
      const { X, F } = mkF(W, { guest: true, net: { reqFire: (...a) => asks.push(a) } });
      ok(F.F === null, 'у гостя ядра нет (считает хозяин)');
      const s = { id: 'flint_steel', n: 1, d: 0 };
      ok(F.useIgniter(s, V.item('flint_steel'), 'main', { x: 5, y: 10, z: 5, nx: 0, ny: 1, nz: 0 }) && asks.length === 1, 'огниво гостя — просьба хозяину', asks);
      W.set(6, 11, 6, V.cell(ID.fire));
      ok(F.blocks.n === 1, 'блок «огонь» из правок хозяина — у гостя пламя');
      R13.camera.position.set(6, 12, 3);
      F.frame(1 / 60, 1); ok(F.FL.stats.cells === 1 && F.FL.stats.tongues >= 1, 'пламя движка нарисовано (языки)', F.FL.stats);
      X.dispose(); F.dispose();
    }
    // сохранить посреди пожара и продолжить
    {
      const W = mkFW(); house(W); const { X, S13, F } = mkF(W, { meta: { fire: 'spread' } });
      F.igniteAt(22, 13, 22, 0, 1, 0); ticks(S13, 20 * 10);
      const n0 = F.F.n, save = JSON.parse(JSON.stringify(F.save()));
      X.dispose(); F.dispose(); W.listeners.length = 0;
      const { X: X2, F: F2 } = mkF(W, { meta: { fire: 'spread', fireState: save } });
      ok(F2.F.n === n0 && n0 > 0, 'загрузился пожар (горит столько же)', [n0, F2.F.n]);
      // сирота: блок «огонь» без горящего рядом (сохранение потерялось) — горит пламенем и гаснет
      const c = W.chunk(3, 3); c.edits = c.edits || new Map(); W.cells.set(key(50, 20, 50), V.cell(ID.fire)); c.edits.set(((50 & 15) << 11) | ((50 & 15) << 7) | 20, V.cell(ID.fire));
      F2.onChunk(c); ok(F2.F.find(50, 20, 50) >= 0, 'огонь-сирота при загрузке чанка — догорит сам');
      X2.dispose(); F2.dispose();
    }
    // кадр: пламя рядом с камерой, без ошибок; без мусора (кадр пламени на 300 блоках огня)
    {
      const W = mkFW(); const { X, F } = mkF(W, { guest: true, net: { reqFire(){} } });
      for (let i = 0; i < 300; i++) W.set(10 + (i % 20), 11, 10 + ((i / 20) | 0), V.cell(ID.fire));
      R13.camera.position.set(20, 12, 18);
      for (let k = 0; k < 30; k++) F.frame(1 / 60, k / 60);
      ok(F.FL.stats.cells === 300 && F.FL.stats.tongues > 300, 'кадр: 300 очагов — языки (на «высокой» — до 3 на очаг)', F.FL.stats);   // мусор кадра — fire-test (отдельный процесс)
      X.dispose(); F.dispose();
    }
  }

  console.log(`\nkubomir-hand-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
