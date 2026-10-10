// Тесты «своих моделей» (js/engine/model.js) в node: .glb/.gltf/.obj собираются прямо здесь, без файлов из интернета.
// Разбор, мир-матрицы узлов, нормали, полоса треугольников, цвета вершин, материалы, текстура, подгонка размера, ошибки
// (Draco, ссылка в интернет, нет .bin, слишком много треугольников), упаковка для файла мира и проверка битых данных.
// Запуск из корня сайта: node scripts/model-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const SITE = process.argv[2] || path.join(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/core.js'), 'utf8'), { filename: 'core.js' });
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/model.js'), 'utf8'), { filename: 'model.js' });
const E = globalThis.D37E, M = E.models, U = E.UNIT;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra ?? ''); } };
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;
const rejects = async (p, re, name) => { try { await p; ok(false, name, 'не было ошибки'); } catch (e) { ok(re.test(e.message), name, e.message); } };

// ── маленький PNG 2×2 ──
function png(){
  const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xFFFFFFFF; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// ── сборщик glTF: буфер из кусков, accessors, bufferViews ──
function gltfBuilder(){
  const bin = [], J = { asset: { version: '2.0' }, buffers: [], bufferViews: [], accessors: [], meshes: [], nodes: [], scenes: [{ nodes: [] }], scene: 0, materials: [], textures: [], images: [] };
  let off = 0;
  const view = (u8, target) => { while (off % 4) { bin.push(0); off++; } const i = J.bufferViews.length; J.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: u8.length, ...(target ? { target } : {}) }); for (const b of u8) bin.push(b); off += u8.length; return i; };
  const acc = (arr, type, ct, extra = {}) => {
    const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const k = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const a = { bufferView: view(u8), componentType: ct, count: arr.length / k, type, ...extra };
    if (type === 'VEC3' && ct === 5126) { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < arr.length; i += 3) for (let j = 0; j < 3; j++) { mn[j] = Math.min(mn[j], arr[i + j]); mx[j] = Math.max(mx[j], arr[i + j]); } a.min = mn; a.max = mx; }
    J.accessors.push(a); return J.accessors.length - 1;
  };
  return { J, acc, view, glb(){
    const B = Uint8Array.from(bin);
    J.buffers = [{ byteLength: B.length }];
    let js = Buffer.from(JSON.stringify(J)); while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')]);
    let bb = Buffer.from(B); while (bb.length % 4) bb = Buffer.concat([bb, Buffer.alloc(1)]);
    const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bb.length, 8);
    const c1 = Buffer.alloc(8); c1.writeUInt32LE(js.length, 0); c1.writeUInt32LE(0x4E4F534A, 4);
    const c2 = Buffer.alloc(8); c2.writeUInt32LE(bb.length, 0); c2.writeUInt32LE(0x004E4942, 4);
    const all = Buffer.concat([head, c1, js, c2, bb]);
    return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
  }, bin: () => Uint8Array.from(bin) };
}
// куб 1×1×1 вокруг нуля: 24 вершины, 12 треугольников
function cube(){
  const P = [], N = [], T = [], I = [];
  const faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]], [[0, 0, 1], [0, 1, 0], [-1, 0, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
  for (const [n, u, v] of faces) {
    const b = P.length / 3;
    for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      P.push(n[0] * .5 + u[0] * a * .5 + v[0] * c * .5, n[1] * .5 + u[1] * a * .5 + v[1] * c * .5, n[2] * .5 + u[2] * a * .5 + v[2] * c * .5);
      N.push(...n); T.push((a + 1) / 2, (c + 1) / 2);
    }
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { P: Float32Array.from(P), N: Float32Array.from(N), T: Float32Array.from(T), I: Uint16Array.from(I) };
}

(async () => {
  // ═══ GLB: два узла (поворот + масштаб, дочерний узел), текстура, цвета вершин, полоса треугольников ═══
  {
    const g = gltfBuilder(), c = cube(), J = g.J;
    const pos = g.acc(c.P, 'VEC3', 5126), nor = g.acc(c.N, 'VEC3', 5126), uv = g.acc(c.T, 'VEC2', 5126), idx = g.acc(c.I, 'SCALAR', 5123);
    J.images.push({ bufferView: g.view(png()), mimeType: 'image/png' });
    J.textures.push({ source: 0 });
    J.materials.push({ name: 'красный', pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1], metallicFactor: 0, roughnessFactor: .5, baseColorTexture: { index: 0 } } });
    J.materials.push({ name: 'листва', alphaMode: 'MASK', alphaCutoff: .4, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0, 1, 0, 1], metallicFactor: 0 } });
    // цвета вершин (нормализованные байты, VEC4) и полоса из 4 вершин (2 треугольника)
    const sp = g.acc(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 'VEC3', 5126);
    const col = g.acc(Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]), 'VEC4', 5121, { normalized: true });
    J.meshes.push({ primitives: [{ attributes: { POSITION: pos, NORMAL: nor, TEXCOORD_0: uv }, indices: idx, material: 0 }] });
    J.meshes.push({ primitives: [{ attributes: { POSITION: sp, COLOR_0: col }, mode: 5, material: 1 }, { attributes: { POSITION: sp }, mode: 1 }] });
    // узел 0: куб 2 м, повёрнут на 90° вокруг Y, поднят на 1 м; узел 1 → дочерний узел 2 с полосой
    const q = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    J.nodes.push({ mesh: 0, translation: [0, 1, 0], rotation: q, scale: [2, 2, 2] });
    J.nodes.push({ translation: [3, 0, 0], children: [2] });
    J.nodes.push({ mesh: 1, scale: [1, 1, 1] });
    J.scenes[0].nodes = [0, 1];
    const steps = [];
    const m = await M.compile([{ name: 'Тест.glb', data: g.glb() }], { onStep: s => steps.push(s) });
    ok(steps.join() === 'read,check,tex,done', 'шаги компиляции', steps.join());
    ok(m.name === 'Тест' && m.tris === 14, 'имя и треугольники (12 куба + 2 полосы, линии — пропущены)', [m.name, m.tris]);
    // размер: куб 2 м (x от −1 до 1) + полоса до x = 4 → по x 5 м; по y 0..2; по z −1..1
    ok(near(m.size[0], 5 * U, 1e-3) && near(m.size[1], 2 * U, 1e-3) && near(m.size[2], 2 * U, 1e-3), 'размер в единицах движка (м × U)', m.size);
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of m.parts) for (let i = 0; i < p.p.length; i += 3) for (let j = 0; j < 3; j++) { mn[j] = Math.min(mn[j], p.p[i + j]); mx[j] = Math.max(mx[j], p.p[i + j]); }
    ok(near(mn[1], 0, 1e-4) && near(mn[0], -mx[0], 1e-3) && near(mn[2], -mx[2], 1e-3), 'низ — y = 0, центр по x/z', [mn, mx]);
    ok(m.parts.length === 2 && m.mats.length === 2, 'склейка по материалам: 2 части', m.parts.length);
    const cubeP = m.parts.find(p => p.u), stripP = m.parts.find(p => p.c);
    // нормали повёрнуты вместе с кубом: грань +X стала −Z
    let foundRot = false;
    for (let i = 0; i < cubeP.n.length; i += 3) if (cubeP.n[i + 2] <= -126 && Math.abs(cubeP.n[i]) < 2) foundRot = true;
    ok(foundRot, 'нормали повёрнуты матрицей узла');
    let unit = true; for (let i = 0; i < cubeP.n.length; i += 3) { const l = Math.hypot(cubeP.n[i], cubeP.n[i + 1], cubeP.n[i + 2]) / 127; if (Math.abs(l - 1) > .02) unit = false; }
    ok(unit, 'нормали — единичной длины (Int8)');
    ok(cubeP.i instanceof Uint16Array && cubeP.i.length === 36 && cubeP.u.length === 48, 'индексы и UV куба');
    ok(stripP && stripP.c.length === 12 && stripP.c[0] === 255 && stripP.c[1] === 0 && stripP.c[4] === 255, 'цвета вершин → байты RGB', stripP && [...stripP.c]);
    ok(stripP.i.length === 6, 'полоса → 2 треугольника');
    const red = m.mats[cubeP.m], leaf = m.mats[stripP.m];
    ok(red.c[0] === 1 && red.c[1] === 0 && red.r === .5 && red.m === 0 && red.tex === 0, 'материал: цвет, шероховатость, текстура', red);
    ok(leaf.at === .4 && leaf.d === true && leaf.vc === true, 'материал: альфа-отсечка, две стороны, цвета вершин', leaf);
    ok(m.tex.length === 1 && m.tex[0].raw?.length > 50, 'текстура сохранена (в node — как есть)');
    ok(m.bytes > 0 && /^m/.test(m.id), 'размер и номер модели');
    // упаковка ↔ распаковка
    const packed = await M.pack(m), back = M.unpack(JSON.parse(JSON.stringify(packed)));
    ok(back && back.tris === m.tris && back.parts.length === 2 && back.parts[0].p.length === m.parts[0].p.length && back.parts[0].p[5] === m.parts[0].p[5], 'pack/unpack без потерь');
    ok(back && back.parts.find(p => p.c)?.c[0] === 255 && back.tex.length === 1, 'pack/unpack: цвета и текстура');
    // битые данные из файла мира — отказ
    const bad = JSON.parse(JSON.stringify(packed));
    { const p = bad.parts[0]; const I = Buffer.from(p.i.d, 'base64'); I.writeUInt16LE(60000, 0); p.i.d = I.toString('base64'); }
    ok(M.unpack(bad) === null, 'unpack: номер вершины за краем — отказ');
    const bad2 = JSON.parse(JSON.stringify(packed)); bad2.parts[0].n.d = bad2.parts[0].n.d.slice(0, 8);
    ok(M.unpack(bad2) === null, 'unpack: длины не сходятся — отказ');
    const bad3 = JSON.parse(JSON.stringify(packed)); { const p = bad3.parts[0]; const P = Buffer.from(p.p.d, 'base64'); P.writeFloatLE(NaN, 4); p.p.d = P.toString('base64'); }
    ok(M.unpack(bad3) === null, 'unpack: NaN в вершинах — отказ');
    ok(M.unpack({ v: 2 }) === null && M.unpack(null) === null, 'unpack: чужой формат — отказ');
    const bad4 = JSON.parse(JSON.stringify(packed)); bad4.mats[0].c = ['x', 1e9, -5]; bad4.mats[0].tex = 99;
    const b4 = M.unpack(bad4); ok(b4 && b4.mats[0].c[0] === 1 && b4.mats[0].c[1] === 10 && b4.mats[0].c[2] === 0 && b4.mats[0].tex === 7, 'unpack: значения материалов зажаты', b4?.mats[0]);
  }
  // ═══ Точные столкновения: коробки по поверхности (пустой внутри куб, пол без «подъёма») ═══
  {
    const g = gltfBuilder(), J = g.J, c = cube();
    J.meshes.push({ primitives: [{ attributes: { POSITION: g.acc(c.P, 'VEC3', 5126) }, indices: g.acc(c.I, 'SCALAR', 5123) }] });
    J.nodes.push({ mesh: 0, scale: [4, 4, 4] }); J.scenes[0].nodes = [0];
    const m = await M.compile([{ name: 'куб.glb', data: g.glb() }]);
    const boxes = M.colliders(m), S = m.size;
    ok(boxes.length >= 6 && boxes.length < 200, 'коробки по поверхности куба', boxes.length);
    const inside = (p, b) => Math.abs(p[0] - b[0]) <= b[3] && Math.abs(p[1] - b[1]) <= b[4] && Math.abs(p[2] - b[2]) <= b[5];
    ok(!boxes.some(b => inside([0, S[1] / 2, 0], b)), 'внутри закрытой модели пусто');
    ok(boxes.some(b => inside([0, S[1] - .01, 0], b)) && boxes.some(b => inside([S[0] / 2 - .01, S[1] / 2, 0], b)), 'крыша и стены — твёрдые');
    const top = Math.max(...boxes.map(b => b[1] + b[4])), bottom = Math.min(...boxes.map(b => b[1] - b[4]));
    ok(near(top, S[1] + .05, .06) && near(bottom, -.05, .06), 'коробки не выше и не ниже модели', [top, bottom]);
    ok(boxes.every(b => Math.abs(b[0]) - b[3] <= S[0] / 2 + .06 && Math.abs(b[2]) - b[5] <= S[2] / 2 + .06), 'не шире модели');
    ok(M.colliders(m) === boxes, 'считается один раз');
    // плоский пол 6 × 6 м: верх коробок — у самого пола, а не на высоте кубика
    const g2 = gltfBuilder(), J2 = g2.J;
    J2.meshes.push({ primitives: [{ attributes: { POSITION: g2.acc(Float32Array.from([-3, 0, -3, 3, 0, -3, 3, 0, 3, -3, 0, 3]), 'VEC3', 5126) }, indices: g2.acc(Uint16Array.from([0, 2, 1, 0, 3, 2]), 'SCALAR', 5123) }] });
    J2.nodes.push({ mesh: 0 }); J2.scenes[0].nodes = [0];
    const f = await M.compile([{ name: 'пол.glb', data: g2.glb() }]), fb = M.colliders(f);
    ok(fb.length >= 1 && fb.every(b => near(b[1] + b[4], .05, .02)), 'пол: верх коробок — у пола (0,05)', fb.slice(0, 2));
  }
  // ═══ Отрицательный масштаб (зеркало) разворачивает треугольники ═══
  {
    const g = gltfBuilder(), J = g.J;
    const P = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]), pos = g.acc(P, 'VEC3', 5126);
    J.meshes.push({ primitives: [{ attributes: { POSITION: pos } }] });
    J.nodes.push({ mesh: 0, scale: [-1, 1, 1] }); J.scenes[0].nodes = [0];
    const m = await M.compile([{ name: 'z.glb', data: g.glb() }]);
    const p = m.parts[0], [a, b, c] = p.i;
    const ux = p.p[b * 3] - p.p[a * 3], uy = p.p[b * 3 + 1] - p.p[a * 3 + 1], vx = p.p[c * 3] - p.p[a * 3], vy = p.p[c * 3 + 1] - p.p[a * 3 + 1];
    ok(ux * vy - uy * vx > 0, 'зеркальный узел: треугольник развёрнут, лицевая сторона к +z');
    ok(p.n[2] > 100, 'нормаль посчитана, когда её нет в файле', [...p.n.slice(0, 3)]);
  }
  // ═══ .gltf с отдельным .bin; ошибки ═══
  {
    const g = gltfBuilder(), J = g.J, c = cube();
    const pos = g.acc(c.P, 'VEC3', 5126), idx = g.acc(c.I, 'SCALAR', 5123);
    J.meshes.push({ primitives: [{ attributes: { POSITION: pos }, indices: idx }] }); J.nodes.push({ mesh: 0 }); J.scenes[0].nodes = [0];
    const B = g.bin(); J.buffers = [{ byteLength: B.length, uri: 'Модель%20тест.bin' }];
    const m = await M.compile([{ name: 'a.gltf', data: JSON.stringify(J) }, { name: 'Модель тест.bin', data: B.buffer }]);
    ok(m.tris === 12 && near(m.size[1], U, 1e-3), '.gltf + .bin (имя с пробелом)');
    await rejects(M.compile([{ name: 'a.gltf', data: JSON.stringify(J) }]), /Модель тест\.bin/, '.gltf без .bin — понятная ошибка с именем файла');
    const J2 = JSON.parse(JSON.stringify(J)); J2.buffers[0].uri = 'https://example.com/x.bin';
    await rejects(M.compile([{ name: 'a.gltf', data: JSON.stringify(J2) }]), /интернете/, 'ссылка в интернет — запрещена');
    const J3 = JSON.parse(JSON.stringify(J)); J3.extensionsRequired = ['KHR_draco_mesh_compression'];
    await rejects(M.compile([{ name: 'a.gltf', data: JSON.stringify(J3) }, { name: 'Модель тест.bin', data: B.buffer }]), /Draco/, 'Draco — понятная ошибка');
    await rejects(M.compile([{ name: 'a.fbx', data: new ArrayBuffer(8) }]), /FBX/, 'FBX — подсказка про Blender');
    await rejects(M.compile([{ name: 'b.glb', data: new ArrayBuffer(30) }]), /не \.glb/, 'битый .glb');
    const J4 = JSON.parse(JSON.stringify(J)); J4.accessors[1].count = 99999;
    await rejects(M.compile([{ name: 'a.gltf', data: JSON.stringify(J4) }, { name: 'Модель тест.bin', data: B.buffer }]), /за краем/, 'accessor за краем буфера — ошибка, не падение');
  }
  // ═══ Лимит треугольников ═══
  {
    const n = M.LIMIT.tris + 10, g = gltfBuilder(), J = g.J;
    const P = new Float32Array(9).fill(0); P[3] = 1; P[7] = 1;
    const pos = g.acc(P, 'VEC3', 5126), I = new Uint32Array(n * 3);
    const idx = g.acc(I, 'SCALAR', 5125);
    J.meshes.push({ primitives: [{ attributes: { POSITION: pos }, indices: idx }] }); J.nodes.push({ mesh: 0 }); J.scenes[0].nodes = [0];
    await rejects(M.compile([{ name: 'big.glb', data: g.glb() }]), /Слишком тяжёлая/, 'больше 100 000 треугольников — отказ');
  }
  // ═══ OBJ + MTL: четырёхугольники, отрицательные номера, материалы, UV снизу ═══
  {
    const obj = [
      'mtllib a.mtl', 'v 0 0 0', 'v 100 0 0', 'v 100 100 0', 'v 0 100 0', 'v 0 0 100',
      'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'vn 0 0 1',
      'usemtl Кирпич', 'f 1/1/1 2/2/1 3/3/1 4/4/1',
      'usemtl Стекло', 'f -5 -4 -1',
    ].join('\n');
    const mtl = 'newmtl Кирпич\nKd 1 0.5 0\nmap_Kd tex/brick.png\nnewmtl Стекло\nKd 0 0 1\nd 0.3\n';
    const m = await M.compile([{ name: 'дом.obj', data: obj }, { name: 'a.mtl', data: mtl }, { name: 'brick.png', data: png().buffer.slice(0) }]);
    ok(m.tris === 3 && m.parts.length === 2, 'OBJ: четырёхугольник → 2 треугольника + 1', [m.tris, m.parts.length]);
    ok(m.fitted && near(Math.max(...m.size), 4, 1e-3), 'OBJ в сантиметрах — подогнан к 4 единицам', m.size);
    const brick = m.mats.find(x => x.tex >= 0), glass = m.mats.find(x => x.blend);
    ok(brick && near(brick.c[1], Math.pow((.5 + .055) / 1.055, 2.4), 1e-6) && brick.c[0] === 1, 'MTL: Kd из sRGB в линейный', brick?.c);
    ok(glass && near(glass.a, .3), 'MTL: прозрачность d', glass?.a);
    const bp = m.parts[m.mats.indexOf(brick)];
    ok(bp.u && near(bp.u[1], 1) && near(bp.u[5], 0), 'OBJ: v перевёрнут (как в glTF)', bp && [...bp.u]);
    const gp = m.parts.find(p => !p.u);
    ok(bp.n[2] === 127, 'OBJ: нормаль из vn', [...bp.n.slice(0, 3)]);
    ok(gp && gp.n[1] === -127, 'OBJ: нормаль посчитана, где нет vn', gp && [...gp.n.slice(0, 3)]);
  }
  setTimeout(() => { console.log(`\n${pass} ок, ${fail} ошибок`); process.exitCode = fail ? 1 : 0; }, 10);
})().catch(e => { console.log('СБОЙ', e); process.exitCode = 1; });
