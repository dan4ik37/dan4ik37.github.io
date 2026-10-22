// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — деревья «как в модах» (D37E.trees, T-022b): породы → рост по зерну → скелет (ствол толще у корня,
//  ветви, корни, кроны) → кубики («Кубомир»), сетка (3D-миры, «Студия 3D»), клетки сбоку (2D)
// ═══════════════════════════════════════
// Без Three.js и DOM: работает в окне, в потоке (voxel-worker.js) и в node (scripts/trees-test.cjs). Только + − × ÷ floor sqrt
// и свои синус/косинус многочленом (без Math.sin/pow/exp/hypot/atan2): одно зерно — одно и то же дерево до бита в любом
// браузере и на телефоне (кубики «Кубомира» у гостей игры вместе строятся сами по зерну — расхождение дало бы «чужие» блоки).
// Единицы скелета — блоки «Кубомира» (≈ метр); 3D-миры масштабируют сами (k).
// TR.grow(вид, зерно, { g }) → скелет S: { sp, seed, g, H, R0, segs, blobs, hang, box } — segs: по 11 чисел на отрезок
//   [ax, ay, az, bx, by, bz, ra, rb, глубина (0 ствол, 1 сук, 2+ ветки), вид (0 ствол, 1 ветвь, 2 корень), цепочка];
//   blobs: по 8 [x, y, z, rx, ry, rz, вид (0 листва, 1 хвоя, 2 «юбка» хвои — конус), тон 0…1]; hang: по 5 [x, y, z, длина, тон]
//   (свисающие пряди ивы, лианы). g — рост 0…1 (росток → молодое → взрослое; меньше — ниже, тоньше, меньше ветвей).
// TR.voxels(S) → { n, x, y, z: Int8Array (от клетки-начала), t: Uint8Array (0 листва, 1 тонкая ветка, 2 бревно, 3 корень),
//   a: Uint8Array (ось бревна: 0 y, 1 x, 2 z), box } — ствол толще 0,7 — 2×2 (ось на углу клетки), толще 1,4 — 3×3; ветви —
//   цепочкой по граням (6-связно: падающее дерево и обрушение видят его целым), не дальше 15 блоков от ствола по x/z.
// TR.mesh(S, { lod }) → { parts: [{ kind: 'bark' | 'leaves' | 'needles', grp, color: [r, g, b], pos, nrm, tone, idx }], H, crown,
//   trunkR } — трубы коры (кольца по цепочкам), кроны — «облака» (икосаэдры с шумом), хвоя — юбки-конусы; lod 0 — полная,
//   1 — проще (меньше граней, без веточек), 2 — дальняя (ствол и 1–3 облака / 1–2 конуса). tone — яркость вершины (0…255).
// TR.cells2d(S) → { n, x, y, t } — дерево сбоку (2D-миры: «Подземье»): проекция скелета на плоскость x-y.
// TR.cut(part, y) — часть сетки выше среза (падающий верх дерева, destruct.js); TR.source(префикс, f) / TR.lookup(id) — кто
// рисует дерево с этим id (3D-мир отдаёт разрушениям сетку и место своего дерева).
// TR.src — текст этого модуля: поток, собранный из строки (поток «Подземья»), выполняет его перед своим кодом.
(function d37Trees(){
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const TR = E.trees = E.trees || {};
  // Форма — часть сохранённых миров («Кубомир» genVer 3, «Подземье» trees 3): несохранённые чанки строятся заново по зерну, и правка
  // роста, кубиков, клеток сбоку или чисел пород дала бы полдерева на границе со старыми чанками. Менять — только новой версией
  // мира (genVer 4 / trees 4: своя ветка, эта — как есть); trees-test сверяет контрольную сумму. Сетку (TR.mesh) — можно: не хранится.
  TR.VERSION = 1;
  const imul = Math.imul, floor = Math.floor, sqrt = Math.sqrt, abs = Math.abs;
  const PI = 3.141592653589793, TAU = 6.283185307179586, HPI = 1.5707963267948966, DEG = PI / 180;

  // ═══ Числа, одинаковые везде ═══
  const hash = (a, b = 0, c = 0, d = 0) => {
    let h = (a | 0) ^ imul(b | 0, 0x27d4eb2d) ^ imul(c | 0, 0x165667b1) ^ imul(d | 0, 0x9e3779b1);
    h = imul(h ^ (h >>> 15), 0x85ebca6b); h = imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  };
  const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = imul(t ^ (t >>> 15), t | 1); t ^= t + imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  // синус многочленом: угол → [−π/2, π/2] (симметрии), ряд до x¹³ (ошибка < 1e-9); только + − × ÷ floor
  function sin(a){
    a -= TAU * floor((a + PI) / TAU);
    if (a > HPI) a = PI - a; else if (a < -HPI) a = -PI - a;
    const x2 = a * a;
    return a * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72 * (1 - x2 / 110 * (1 - x2 / 156))))));
  }
  const cos = a => sin(a + HPI);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const between = (r, p) => p[0] + (p[1] - p[0]) * r();
  TR.hash = hash; TR.rng = rng; TR.sin = sin; TR.cos = cos;

  // ═══ Породы (данные): размеры — у взрослого дерева (g = 1), блоки ≈ метры ═══
  // form: broad (дуб, дуб-старик — раскидистые сучья, облака на концах), birch (тонкий высокий, узкая крона), cone (ель —
  // мутовки и юбки хвои), pine (сосна — голый ствол, крона сверху), acacia (вилка, плоские кроны), willow (дуги сучьев и пряди),
  // tropical (высокий ствол, корни-подпорки, крона наверху), dead (сухое: сучья без листвы, обломанная верхушка).
  // h — высота, r0 — радиус у корня, top — радиус у макушки, b — где растут сучья (доли высоты), nb — сколько сучьев, el — угол
  // сучка от вертикали (°), bl — длина сучка (доля высоты), up — «тянется вверх», depth — сколько раз ветвится, kids — веток на
  // сучке, blob — радиус облака кроны, roots — сколько корней видно, leaf — листва / хвоя, bark / leafC — цвет (3D), rk3 — толщина
  // коры в 3D-сетке от «кубической» (в кубиках ствол нарочно толще: 2×2 у корня — сразу видно, что дерево старое)
  // Толщина у корня в кубиках: < 0,62 — один блок; 0,7…1,05 — 2×2 (ось на углу клетки) и вверху — 1×1; ≥ 1,42 — 3×3 и шире
  const SP = TR.SPECIES = {
    oak: { title: 'Дуб', icon: '🌳', form: 'broad', leaf: 'leaves', h: [7, 11], r0: [.84, 1.02], top: .16, taper: 1.0, lean: .1, wob: .08, b: [.38, .74], nb: [4, 6], el: [42, 70], bl: [.34, .48], up: .28, depth: 2, kids: [2, 3], blob: [2.0, 2.8], roots: 0, rk3: .48,
      bark: [107, 79, 44], leafC: [[79, 154, 69], [90, 166, 74], [63, 138, 58]] },
    birch: { title: 'Берёза', icon: '🌳', form: 'birch', leaf: 'leaves', h: [8, 13], r0: [.24, .32], top: .1, taper: 1.1, lean: .14, wob: .1, b: [.42, .92], nb: [5, 8], el: [22, 42], bl: [.15, .24], up: .5, depth: 1, kids: [1, 2], blob: [1.45, 2.0], roots: 0, rk3: 1,
      bark: [231, 226, 214], leafC: [[128, 176, 88], [140, 186, 96], [112, 160, 76]] },
    spruce: { title: 'Ель', icon: '🌲', form: 'cone', leaf: 'needles', h: [9, 15], r0: [.3, .42], top: .06, taper: 1.2, lean: .04, wob: .04, b: [.12, .98], whorl: [1.0, 1.35], nw: [4, 6], el: [84, 100], bl: [.3, .38], up: 0, depth: 1, kids: [0, 0], blob: [0, 0], roots: 0, rk3: .9,
      bark: [75, 53, 32], leafC: [[47, 107, 58], [56, 118, 64], [40, 96, 52]] },
    pine: { title: 'Сосна', icon: '🌲', form: 'pine', leaf: 'needles', h: [11, 16], r0: [.3, .4], top: .1, taper: 1.0, lean: .1, wob: .07, b: [.6, .93], nb: [4, 6], el: [52, 78], bl: [.17, .25], up: .18, depth: 1, kids: [1, 2], blob: [1.5, 2.2], roots: 0, rk3: 1,
      bark: [128, 84, 52], leafC: [[52, 110, 62], [62, 122, 66], [44, 98, 54]] },
    acacia: { title: 'Акация', icon: '🌳', form: 'acacia', leaf: 'leaves', h: [6, 9], r0: [.3, .4], top: .14, taper: 1.2, lean: .22, wob: .12, b: [.36, .52], nb: [2, 3], el: [32, 55], bl: [.45, .62], up: .12, depth: 2, kids: [1, 2], blob: [2.6, 3.8], roots: 0, rk3: 1,
      bark: [120, 108, 96], leafC: [[106, 150, 62], [118, 160, 70], [96, 138, 56]] },
    willow: { title: 'Ива', icon: '🌳', form: 'willow', leaf: 'leaves', h: [7, 10], r0: [.55, .85], top: .16, taper: 1.2, lean: .14, wob: .1, b: [.42, .7], nb: [4, 6], el: [40, 62], bl: [.42, .55], up: .35, depth: 1, kids: [1, 2], blob: [1.5, 2.2], roots: 3, hang: [3, 6], rk3: .6,
      bark: [96, 78, 56], leafC: [[118, 170, 84], [130, 180, 92], [104, 156, 72]] },
    tropical: { title: 'Тропическое', icon: '🌴', form: 'tropical', leaf: 'leaves', h: [13, 21], r0: [.6, .95], top: .2, taper: 1.0, lean: .06, wob: .05, b: [.72, .9], nb: [3, 5], el: [40, 66], bl: [.18, .26], up: .3, depth: 1, kids: [1, 2], blob: [2.2, 3.2], roots: 5, hang: [2, 5], rk3: .6,
      bark: [104, 84, 58], leafC: [[48, 146, 58], [60, 160, 66], [40, 128, 50]] },
    dead: { title: 'Сухое дерево', icon: '🪵', form: 'dead', leaf: '', h: [6, 10], r0: [.3, .44], top: .2, taper: 1.0, lean: .16, wob: .14, b: [.38, .85], nb: [2, 4], el: [35, 68], bl: [.22, .36], up: .15, depth: 2, kids: [1, 2], blob: [0, 0], roots: 2, rk3: 1,
      bark: [118, 104, 88], leafC: [[110, 100, 80]] },
    giant_oak: { title: 'Дуб-великан', icon: '🌳', form: 'broad', leaf: 'leaves', h: [18, 24], r0: [1.6, 1.95], top: .3, taper: 1.4, lean: .05, wob: .06, b: [.3, .68], nb: [5, 7], el: [46, 74], bl: [.33, .42], up: .24, depth: 3, kids: [2, 3], blob: [2.6, 3.4], roots: 6, rk3: .5,
      bark: [92, 68, 40], leafC: [[72, 144, 62], [84, 158, 70], [58, 128, 54]] },
    giant_spruce: { title: 'Ель-великан', icon: '🌲', form: 'cone', leaf: 'needles', h: [22, 30], r0: [.95, 1.04], top: .1, taper: .7, lean: .03, wob: .03, b: [.16, .98], whorl: [1.1, 1.5], nw: [5, 7], el: [84, 102], bl: [.26, .32], up: 0, depth: 1, kids: [0, 0], blob: [0, 0], roots: 4, rk3: .65,
      bark: [70, 48, 30], leafC: [[42, 98, 54], [50, 110, 60], [36, 88, 48]] },
  };
  TR.LIST = Object.keys(SP);
  const SPI = {}; TR.LIST.forEach((k, i) => { SPI[k] = i + 1; });

  // ═══ Рост: скелет ═══
  const V3 = (x, y, z) => [x, y, z];
  const norm = v => { const l = sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; };
  // направление: азимут a (от +z к +x), угол от вертикали e
  const dirOf = (a, e) => V3(sin(e) * sin(a), cos(e), sin(e) * cos(a));
  TR.grow = (sp, seed, o = {}) => {
    const S = SP[sp] || SP.oak;
    sp = SP[sp] ? sp : 'oak';
    const r = rng(hash(seed >>> 0, SPI[sp], 7331, TR.VERSION));
    const g = clamp(o.g ?? 1, .12, 1), gk = .3 + .7 * g;
    const H = between(r, S.h) * gk, R0 = between(r, S.r0) * (.32 + .68 * g), RT = S.top * (.5 + .5 * g);
    const segs = [], blobs = [], hang = [];
    let chain = 0;
    const seg = (a, b, ra, rb, depth, kind, ch) => { segs.push(a[0], a[1], a[2], b[0], b[1], b[2], ra, rb, depth, kind, ch); };
    const blob = (x, y, z, rx, ry, rz, kind, tone) => { blobs.push(x, y, z, rx, ry, rz, kind, tone); };
    // ── ствол: ломаная по ~1 блоку, слегка «гуляет», радиус — к макушке тоньше (taper). Толстый (2×2 и шире) — прямее: старое
    //    дерево стоит ровно, а в кубиках сдвиг оси на треть блока «ломает» 2×2 в ступеньку ──
    const stiff = R0 >= .7 ? .3 : 1;
    const la = r() * TAU, ln = S.lean * r() * (.5 + .5 * g) * stiff;
    let d = norm(V3(sin(la) * ln, 1, cos(la) * ln));
    const nT = Math.max(3, Math.round(H / (H > 14 ? 1.25 : 1)));
    const trunk = [V3(0, 0, 0)];
    const rad = t => RT + (R0 - RT) * pw(1 - t, S.taper);
    let topH = H;
    if (S.form === 'dead') topH = H * (.75 + .2 * r());   // обломанная верхушка
    const stepL = topH / nT;
    for (let i = 1; i <= nT; i++) {
      const w = S.wob * 2 * (i / nT < .5 ? stiff : 1);
      d[0] += (r() - .5) * w; d[2] += (r() - .5) * w;
      d[1] = Math.max(d[1], .86); norm(d);
      const p = trunk[i - 1];
      trunk.push(V3(p[0] + d[0] * stepL, p[1] + d[1] * stepL, p[2] + d[2] * stepL));
    }
    const ch0 = chain++;
    for (let i = 0; i < nT; i++) seg(trunk[i], trunk[i + 1], rad(i / nT), rad((i + 1) / nT), 0, 0, ch0);
    // точка ствола на доле высоты t
    const at = t => { const f = clamp(t, 0, 1) * nT, i = Math.min(nT - 1, floor(f)), k = f - i, a = trunk[i], b = trunk[i + 1]; return V3(lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)); };
    const tips = [];   // концы веток: [x, y, z, длина ветки, глубина]
    // ветвь: из точки p по направлению dir длиной L, радиус ra → rb, n кусков; изгиб вверх (up) или вниз (droop)
    function branch(p, dir, L, ra, rb, depth, n, up, droop){
      const ch = chain++;
      let q = p, dd = norm(dir.slice());
      const pts = [p];
      for (let i = 0; i < n; i++) {
        dd[1] += up * (1 / n) - droop * (i + 1) / n * .55; dd[0] += (r() - .5) * .22; dd[2] += (r() - .5) * .22; norm(dd);
        const s = L / n, nq = V3(q[0] + dd[0] * s, q[1] + dd[1] * s, q[2] + dd[2] * s);
        seg(q, nq, lerp(ra, rb, i / n), lerp(ra, rb, (i + 1) / n), depth, 1, ch);
        pts.push(nq); q = nq;
      }
      tips.push(q[0], q[1], q[2], L, depth);
      return pts;
    }
    const nOf = p => Math.max(1, Math.round(between(r, p) * (.45 + .55 * g)));
    const golden = 2.399963229728653;
    let az = r() * TAU;
    const tone = () => r();
    const blobR = () => between(r, S.blob) * (.45 + .55 * g);
    if (S.form === 'broad' || S.form === 'birch' || S.form === 'pine' || S.form === 'willow' || S.form === 'tropical' || S.form === 'dead') {
      const nb = nOf(S.nb), depth = g < .45 ? 1 : S.depth, even = S.form !== 'birch', mids = [];
      for (let k = 0; k < nb; k++) {
        const t = lerp(S.b[0], S.b[1], (k + .3 + r() * .4) / nb);
        // сучья по кругу: у раскидистых — ровно (k-й из nb, крона не однобокая), у берёзы — «золотым углом»
        az = even ? az + TAU / nb + (r() - .5) * (TAU / nb) * .45 : az + golden + (r() - .5) * .6;
        const low = 1 - (t - S.b[0]) / Math.max(.01, S.b[1] - S.b[0]);   // нижние — длиннее и положе
        const el = lerp(S.el[0], S.el[1], .35 * r() + .65 * low) * DEG;
        const L = H * between(r, S.bl) * (S.form === 'birch' ? .8 + .4 * low : .75 + .45 * low) * (S.form === 'dead' ? 1 : 1);
        const p = at(t), ra = rad(t) * (S.form === 'broad' ? .62 : .5), rb = Math.max(.07, ra * .3);
        const pts = branch(p, dirOf(az, el), L, ra, rb, 1, L > 3.2 ? 3 : 2, S.up, S.form === 'willow' ? 1.25 : 0);
        if (pts.length > 2 && (S.form === 'broad' || S.form === 'tropical')) mids.push(pts[pts.length - 2]);   // облако и посередине сука — крона без дыр
        // ветки на сучке
        if (depth >= 2) {
          const nk = nOf(S.kids);
          for (let j = 0; j < nk; j++) {
            const f = .4 + .5 * (j + r() * .6) / nk, i = Math.min(pts.length - 2, floor(f * (pts.length - 1))), q = pts[i + 1];
            const ka = az + (r() < .5 ? -1 : 1) * (.6 + r() * .9), ke = el * (.55 + .3 * r());
            const kL = L * (.42 + .2 * r()), kr = Math.max(.06, ra * .45);
            const kp = branch(q, dirOf(ka, ke), kL, kr, Math.max(.05, kr * .4), 2, 2, S.up * .8, 0);
            if (depth >= 3 && kL > 2.5) { const q3 = kp[kp.length - 1]; branch(q3, dirOf(ka + (r() - .5) * 1.6, ke * .8), kL * .55, Math.max(.05, kr * .45), .05, 3, 1, S.up * .6, 0); }
          }
        }
      }
      // крона: облака на концах веток (у сухого — нет), у макушки — своё облако
      if (S.form !== 'dead') {
        for (const q of mids) { const R = blobR() * .82; blob(q[0], q[1] + R * .15, q[2], R, R * .78, R, 0, tone()); }
        for (let i = 0; i < tips.length; i += 5) {
          const R = blobR() * (tips[i + 4] >= 2 ? .85 : 1), x = tips[i], y = tips[i + 1], z = tips[i + 2];
          const flat = S.form === 'pine' ? .62 : S.form === 'birch' ? .95 : .78;
          blob(x, y + R * .2, z, R, R * flat, R, S.leaf === 'needles' ? 1 : 0, tone());
          if (S.form === 'willow' && S.hang) {   // пряди ивы: с края облака вниз
            const nh = 3 + floor(r() * 3);
            for (let h = 0; h < nh; h++) { const a = r() * TAU, rr = R * (.3 + .42 * r()); hang.push(x + sin(a) * rr, y - R * .12, z + cos(a) * rr, between(r, S.hang) * gk + R * .2, tone()); }   // из глубины облака — прядь держится за крону
          }
        }
        const tp = trunk[nT], tr = blobR() * (S.form === 'birch' ? .9 : S.form === 'tropical' ? 1.35 : 1.05);
        blob(tp[0], tp[1] + tr * (S.form === 'birch' ? .1 : .05), tp[2], tr, tr * (S.form === 'pine' ? .6 : .85), tr, S.leaf === 'needles' ? 1 : 0, tone());
        if (S.form === 'birch') {   // берёза: узкая крона — облака и вдоль ствола сверху
          for (let t = .55; t < .95; t += .16) { const p = at(t), R = blobR() * .85; blob(p[0], p[1], p[2], R, R * 1.1, R, 0, tone()); }
        }
        if (S.form === 'tropical' && S.hang) for (let h = 0; h < 4 + floor(r() * 3); h++) { const a = r() * TAU, rr = tr * (.5 + .4 * r()); hang.push(tp[0] + sin(a) * rr, tp[1] - tr * .2, tp[2] + cos(a) * rr, between(r, S.hang) * gk, tone()); }
      } else {   // сухое: тонкие веточки на концах — без листвы
        for (let i = 0; i < tips.length; i += 5) if (tips[i + 4] < 2 && g > .4) { const q = V3(tips[i], tips[i + 1], tips[i + 2]); branch(q, dirOf(r() * TAU, (25 + r() * 40) * DEG), 1 + r() * 1.2, .08, .05, 3, 1, 0, 0); }
      }
    } else if (S.form === 'cone') {
      // ель: мутовки снизу вверх; длина ветки — конусом; хвоя — «юбки» у ствола (конус над каждой мутовкой) и лапы на ветках
      const wl = between(r, S.whorl) * (.6 + .4 * g);
      const t0 = S.b[0] + r() * .06;
      const Lmax = H * between(r, S.bl);
      let k = 0;
      for (let y = t0 * H; y < H * S.b[1] - .4; y += wl * (.85 + r() * .3), k++) {
        const t = y / H, p = at(t), L = Math.max(.6, Lmax * pw(1 - t, 1.05) + .35);
        const nw = Math.max(3, Math.round(between(r, S.nw))), a0 = r() * TAU;
        for (let j = 0; j < nw; j++) {
          const a = a0 + j * TAU / nw + (r() - .5) * .5, el = between(r, S.el) * DEG;
          branch(p, dirOf(a, el), L, Math.max(.06, rad(t) * .35), .05, 2, 1, 0, .25);
        }
        // юбка: конус от этой мутовки вверх (основание шире ветки — лапы свисают)
        const sh = Math.min(wl * 1.9, 2.6), sk = L * (1.02 + .1 * r());
        blob(p[0], p[1] - .35, p[2], sk, sh, sk, 2, tone());
      }
      const tp = trunk[nT];
      blob(tp[0], tp[1] - 1.2, tp[2], .9, 2.2, .9, 2, tone());   // макушка
    } else if (S.form === 'acacia') {
      // акация: ствол до вилки, 2–3 толстых сука наружу и вверх, на концах — плоские широкие кроны
      const tf = between(r, S.b), nb = Math.max(2, nOf(S.nb));
      // ствол выше вилки не нужен: обрезать отрезки ствола выше tf (их добавили выше) — оставляем только до вилки
      const keep = Math.max(1, Math.round(tf * nT));
      segs.length = keep * 11;
      const fp = trunk[keep];
      for (let k = 0; k < nb; k++) {
        az += TAU / nb + (r() - .5) * .9;
        const el = between(r, S.el) * DEG, L = H * between(r, S.bl) * (.85 + .3 * r());
        const ra = rad(tf) * .75;
        const pts = branch(fp, dirOf(az, el), L, ra, Math.max(.08, ra * .4), 1, 3, S.up, 0);
        const q = pts[pts.length - 1], R = blobR();
        blob(q[0], q[1] + .45, q[2], R, R * .3, R * (.85 + .3 * r()), 0, tone());
        if (g >= .45 && r() < .7) {   // второй ярус: ветка сбоку с маленькой плоской кроной
          const mid = pts[1 + floor(r() * (pts.length - 2))];
          const kp = branch(mid, dirOf(az + (r() < .5 ? -1 : 1) * (.7 + r() * .6), el * .8), L * .5, Math.max(.06, ra * .45), .05, 2, 2, .2, 0);
          const q2 = kp[kp.length - 1], R2 = R * (.55 + .2 * r());
          blob(q2[0], q2[1] + .35, q2[2], R2, R2 * .32, R2, 0, tone());
        }
      }
      topH = fp[1];
    }
    // ── корни: у толстых — видны у земли, расходятся и уходят в землю ──
    const nr = g >= .6 ? S.roots : 0;
    if (nr) {
      let ra0 = r() * TAU;
      for (let k = 0; k < nr; k++) {
        const a = ra0 + k * TAU / nr + (r() - .5) * .6, L = R0 * (1.6 + 1.6 * r()) + 1.2, ch = chain++;
        const da = V3(sin(a), 0, cos(a));
        const p0 = V3(da[0] * R0 * .55, .55 + .4 * r(), da[2] * R0 * .55), p1 = V3(da[0] * (R0 + L * .45), .1, da[2] * (R0 + L * .45)), p2 = V3(da[0] * (R0 + L), -.75, da[2] * (R0 + L));
        const rr = Math.max(.22, R0 * .5);
        segs.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], rr, rr * .65, 1, 2, ch);
        segs.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], rr * .65, Math.max(.12, rr * .35), 1, 2, ch);
      }
    }
    // рамка
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    const grow = (x, y, z, rx, ry, rz) => { if (x - rx < x0) x0 = x - rx; if (x + rx > x1) x1 = x + rx; if (y - ry < y0) y0 = y - ry; if (y + ry > y1) y1 = y + ry; if (z - rz < z0) z0 = z - rz; if (z + rz > z1) z1 = z + rz; };
    for (let i = 0; i < segs.length; i += 11) { grow(segs[i], segs[i + 1], segs[i + 2], segs[i + 6], segs[i + 6], segs[i + 6]); grow(segs[i + 3], segs[i + 4], segs[i + 5], segs[i + 7], segs[i + 7], segs[i + 7]); }
    for (let i = 0; i < blobs.length; i += 8) grow(blobs[i], blobs[i + 1], blobs[i + 2], blobs[i + 3], blobs[i + 4], blobs[i + 5]);
    for (let i = 0; i < hang.length; i += 5) grow(hang[i], hang[i + 1] - hang[i + 3], hang[i + 2], .5, 0, .5);
    return { sp, seed: seed >>> 0, g, H: Math.max(topH, y1), R0, segs, blobs, hang, box: [x0, y0, z0, x1, y1, z1], leaf: S.leaf, form: S.form };
  };
  // степень без Math.pow (одинаково везде): целая часть — умножением, дробная — четвертями (x^¼ = √√x)
  function pw(x, p){
    if (x <= 0) return 0;
    let v = 1; const n = floor(p), q = Math.round((p - n) * 4);
    for (let i = 0; i < n; i++) v *= x;
    if (q) { const s = sqrt(x), s4 = sqrt(s); v *= q === 1 ? s4 : q === 2 ? s : q === 3 ? s * s4 : x; }
    return v;
  }
  TR.pw = pw;

  // ═══ Кубики («Кубомир»): ствол и ветви — по клеткам, крона — облака с рваным краем ═══
  // Сетка во временном буфере (до 33 × 56 × 33): тип по старшинству (бревно > корень > тонкая ветка > листва) и ось
  const GX = 33, GY = 60, GZ = 33, GN = GX * GY * GZ, GOX = 16, GOY = 6, GOZ = 16;
  let GT = null, GA = null, GL = null;   // тип + 1 (0 — пусто), ось; список занятых
  const LIM = 15;   // дальше от ствола по x/z — нельзя (генератор «Кубомира» смотрит соседей только 3 × 3 чанка)
  TR.voxels = (S, o = {}) => {
    if (!GT) { GT = new Uint8Array(GN); GA = new Uint8Array(GN); GL = new Int32Array(GN); }
    let nl = 0;
    const thin = o.thin !== false;
    // ось ствола: толщина 0,7…1,05 (2×2) — на углу клетки, иначе — посередине
    const off = S.R0 >= .7 && S.R0 < 1.05 ? 0 : .5;
    const put = (x, y, z, t, a) => {
      if (x < -LIM || x > LIM || z < -LIM || z > LIM || y < -GOY || y >= GY - GOY) return;
      const i = ((x + GOX) * GY + (y + GOY)) * GZ + (z + GOZ), c = GT[i];
      if (c && PRI[c - 1] >= PRI[t]) return;
      if (!c) GL[nl++] = i;
      GT[i] = t + 1; GA[i] = a;
    };
    const segs = S.segs, cone = S.form === 'cone';
    // ── ветви и ствол (ствол — не ниже земли; веточки мутовок ели — только хвоя, как у настоящей: снаружи веток не видно) ──
    for (let s = 0; s < segs.length; s += 11) {
      const ax = segs[s] + off, ay = segs[s + 1], az = segs[s + 2] + off, bx = segs[s + 3] + off, by = segs[s + 4], bz = segs[s + 5] + off;
      const ra = segs[s + 6], rb = segs[s + 7], depth = segs[s + 8], kind = segs[s + 9];
      if (cone && depth >= 2) continue;
      const y0 = kind === 0 ? 0 : -GOY;
      const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz;
      const adx = abs(dx), ady = abs(dy), adz = abs(dz);
      const axis = ady >= adx && ady >= adz ? 0 : adx >= adz ? 1 : 2;
      const t = kind === 2 ? 3 : thin && depth >= 2 && (ra + rb) * .5 < .2 ? 1 : 2;
      const rmax = ra > rb ? ra : rb;
      if (rmax >= .62) {   // толстое: все клетки, чьи середины ближе радиуса к оси
        const lo = Math.min(ax, bx) - rmax, hi = Math.max(ax, bx) + rmax, ly = Math.min(ay, by) - rmax, hy = Math.max(ay, by) + rmax, lz = Math.min(az, bz) - rmax, hz = Math.max(az, bz) + rmax;
        for (let x = floor(lo); x <= floor(hi); x++) for (let y = Math.max(y0, floor(ly)); y <= floor(hy); y++) for (let z = floor(lz); z <= floor(hz); z++) {
          const px = x + .5 - ax, py = y + .5 - ay, pz = z + .5 - az;
          let k = L2 > 0 ? (px * dx + py * dy + pz * dz) / L2 : 0; k = k < 0 ? 0 : k > 1 ? 1 : k;
          const qx = px - dx * k, qy = py - dy * k, qz = pz - dz * k, rr = ra + (rb - ra) * k;
          if (qx * qx + qy * qy + qz * qz <= rr * rr + 1e-9) put(x, y, z, t, kind === 0 ? 0 : axis);
        }
      }
      // ось — по клеткам подряд через грани (DDA): тонкая ветка не рвётся
      dda(ax, ay, az, bx, by, bz, (x, y, z) => { if (y >= y0) put(x, y, z, t, kind === 0 ? 0 : axis); });
    }
    // ── крона: облака (эллипсоиды) с рваным краем; юбки хвои — конусы; пряди — столбики вниз ──
    const bl = S.blobs, sd = S.seed;
    for (let b = 0; b < bl.length; b += 8) {
      const cx = bl[b] + off, cy = bl[b + 1], cz = bl[b + 2] + off, rx = bl[b + 3], ry = bl[b + 4], rz = bl[b + 5], kind = bl[b + 6];
      if (kind === 2) {   // конус: основание на cy, вершина на cy + ry
        for (let y = floor(cy); y <= floor(cy + ry); y++) {
          const f = (y + .5 - cy) / ry; if (f < 0 || f > 1) continue;
          const R = rx * (1 - f) + .35;
          for (let x = floor(cx - R); x <= floor(cx + R); x++) for (let z = floor(cz - R); z <= floor(cz + R); z++) {
            const px = x + .5 - cx, pz = z + .5 - cz, n = (hash(x, y, z, sd) & 1023) / 1023 - .5;
            if (px * px + pz * pz <= R * R * (1 + n * .45)) put(x, y, z, 0, 0);
          }
        }
        continue;
      }
      for (let x = floor(cx - rx - .5); x <= floor(cx + rx + .5); x++) for (let y = floor(cy - ry - .5); y <= floor(cy + ry + .5); y++) for (let z = floor(cz - rz - .5); z <= floor(cz + rz + .5); z++) {
        const px = (x + .5 - cx) / rx, py = (y + .5 - cy) / ry, pz = (z + .5 - cz) / rz, n = (hash(x, y, z, sd ^ 0x51) & 1023) / 1023 - .5;
        if (px * px + py * py + pz * pz <= 1 + n * .5) put(x, y, z, 0, 0);
      }
    }
    const hg = S.hang;
    for (let h = 0; h < hg.length; h += 5) {
      const x = floor(hg[h] + off), z = floor(hg[h + 2] + off), y0 = floor(hg[h + 1]), n = Math.max(1, Math.round(hg[h + 3]));
      for (let k = 0; k < n; k++) put(x, y0 - k, z, 0, 0);
    }
    // в список (и почистить буфер)
    const X = new Int8Array(nl), Y = new Int8Array(nl), Z = new Int8Array(nl), Tt = new Uint8Array(nl), A = new Uint8Array(nl);
    let bx0 = 99, by0 = 99, bz0 = 99, bx1 = -99, by1 = -99, bz1 = -99;
    for (let k = 0; k < nl; k++) {
      const i = GL[k], z = i % GZ, r2 = (i - z) / GZ, y = r2 % GY, x = (r2 - y) / GY;
      X[k] = x - GOX; Y[k] = y - GOY; Z[k] = z - GOZ; Tt[k] = GT[i] - 1; A[k] = GA[i];
      GT[i] = 0; GA[i] = 0;
      if (X[k] < bx0) bx0 = X[k]; if (X[k] > bx1) bx1 = X[k]; if (Y[k] < by0) by0 = Y[k]; if (Y[k] > by1) by1 = Y[k]; if (Z[k] < bz0) bz0 = Z[k]; if (Z[k] > bz1) bz1 = Z[k];
    }
    return { n: nl, x: X, y: Y, z: Z, t: Tt, a: A, box: [bx0, by0, bz0, bx1, by1, bz1] };
  };
  const PRI = [1, 2, 4, 3];   // старшинство: листва < тонкая ветка < корень < бревно
  TR.T_LEAF = 0; TR.T_THIN = 1; TR.T_LOG = 2; TR.T_ROOT = 3;
  // клетки вдоль отрезка подряд через грани (Amanatides–Woo)
  function dda(ax, ay, az, bx, by, bz, cb){
    let x = floor(ax), y = floor(ay), z = floor(az);
    const ex = floor(bx), ey = floor(by), ez = floor(bz);
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx ? abs(1 / dx) : 1e30, tdy = dy ? abs(1 / dy) : 1e30, tdz = dz ? abs(1 / dz) : 1e30;
    let tx = dx ? (dx > 0 ? x + 1 - ax : ax - x) * tdx : 1e30, ty = dy ? (dy > 0 ? y + 1 - ay : ay - y) * tdy : 1e30, tz = dz ? (dz > 0 ? z + 1 - az : az - z) * tdz : 1e30;
    cb(x, y, z);
    for (let n = 0; n < 256 && (x !== ex || y !== ey || z !== ez); n++) {
      if (tx <= ty && tx <= tz) { if (tx > 1) break; x += sx; tx += tdx; }
      else if (ty <= tz) { if (ty > 1) break; y += sy; ty += tdy; }
      else { if (tz > 1) break; z += sz; tz += tdz; }
      cb(x, y, z);
    }
  }
  TR.dda = dda;

  // ═══ Сбоку (2D): клетки дерева на плоскости x-y (y вверх) — ствол, ветви, крона; z скелета не смотрим ═══
  // o.style 'side' — как в играх сбоку (Террария): ствол — один прямой столбец (плитка коры узкая: ступенька выглядела бы
  // разрывом), сучья — листвой (у сухого — без сучьев: голые ветки плиткой коры — «висящие обрубки»), без корней, крона крупнее
  // (o.blobK, по умолчанию 1,25): картинка «плитками» без своих плиток для толстых стволов и веток
  TR.cells2d = (S, o = {}) => {
    const out = new Map(), key = (x, y) => x * 4096 + y, side = o.style === 'side', bk = side ? o.blobK ?? 1.25 : 1, bare = S.form === 'dead';
    const put = (x, y, t) => { if (x < -LIM || x > LIM) return; const k = key(x, y), c = out.get(k); if (c === undefined || PRI[c] < PRI[t]) out.set(k, t); };
    const segs = S.segs, off = side || !(S.R0 >= .7 && S.R0 < 1.05) ? .5 : 0, tcol = floor((segs[0] || 0) + off);
    for (let s = 0; s < segs.length; s += 11) {
      const ax = segs[s] + off, ay = segs[s + 1], bx = segs[s + 3] + off, by = segs[s + 4], ra = segs[s + 6], rb = segs[s + 7], kind = segs[s + 9], depth = segs[s + 8];
      if (kind === 2 && (o.roots === false || side)) continue;
      if (side && kind === 1) {   // сук — листвой вдоль (крона связна со стволом); у сухого и ели — нет
        if (!bare && S.form !== 'cone') { const n = depth >= 2 ? 1 : 0; dda(ax, ay, .5, bx, by, .5, (x, y) => { put(x, y, 0); if (n) put(x, y + 1, 0); }); }
        continue;
      }
      if (side) { dda(ax, ay, .5, bx, by, .5, (x, y) => put(tcol, y, 2)); continue; }   // ствол — один столбец (без «лесенки»)
      const t = kind === 2 ? 3 : depth >= 2 && (ra + rb) * .5 < .2 ? 1 : 2, rmax = ra > rb ? ra : rb;
      if (rmax >= .62) {
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        for (let x = floor(Math.min(ax, bx) - rmax); x <= floor(Math.max(ax, bx) + rmax); x++) for (let y = floor(Math.min(ay, by) - rmax); y <= floor(Math.max(ay, by) + rmax); y++) {
          const px = x + .5 - ax, py = y + .5 - ay; let k = L2 > 0 ? (px * dx + py * dy) / L2 : 0; k = k < 0 ? 0 : k > 1 ? 1 : k;
          const qx = px - dx * k, qy = py - dy * k, rr = ra + (rb - ra) * k;
          if (qx * qx + qy * qy <= rr * rr + 1e-9) put(x, y, t);
        }
      }
      dda(ax, ay, .5, bx, by, .5, (x, y) => put(x, y, t));
    }
    const bl = S.blobs, sd = S.seed;
    for (let b = 0; b < bl.length; b += 8) {
      const cx = bl[b] + off, cy = bl[b + 1], rx = bl[b + 3] * bk, ry = bl[b + 4] * bk, kind = bl[b + 6];
      if (kind === 2) { for (let y = floor(cy); y <= floor(cy + ry); y++) { const f = (y + .5 - cy) / ry; if (f < 0 || f > 1) continue; const R = rx * (1 - f) + .35; for (let x = floor(cx - R); x <= floor(cx + R); x++) put(x, y, 0); } continue; }
      for (let x = floor(cx - rx - .5); x <= floor(cx + rx + .5); x++) for (let y = floor(cy - ry - .5); y <= floor(cy + ry + .5); y++) {
        const px = (x + .5 - cx) / rx, py = (y + .5 - cy) / ry, n = (hash(x, y, 7, sd ^ 0x51) & 1023) / 1023 - .5;
        if (px * px + py * py <= 1 + n * .5) put(x, y, 0);
      }
    }
    for (let h = 0; h < S.hang.length; h += 5) { const x = floor(S.hang[h] + off), y0 = floor(S.hang[h + 1]); for (let k = 0; k < Math.max(1, Math.round(S.hang[h + 3])); k++) put(x, y0 - k, 0); }
    const n = out.size, X = new Int8Array(n), Y = new Int8Array(n), Tt = new Uint8Array(n); let i = 0;
    for (const [k, t] of out) { const y = ((k % 4096) + 4096) % 4096, yy = y >= 2048 ? y - 4096 : y; X[i] = (k - yy) / 4096; Y[i] = yy; Tt[i] = t; i++; }
    return { n, x: X, y: Y, t: Tt };
  };

  // ═══ Сетка (3D): кора — трубы по цепочкам отрезков, листва — облака, хвоя — юбки-конусы ═══
  // Буферы — обычные массивы во время сборки (сборка — один раз на вид дерева, кэш у игры), на выходе — типизированные
  function Part(kind, grp, color){ return { kind, grp, color, pos: [], nrm: [], tone: [], idx: [] }; }
  // кольцо вокруг точки p с осью d: базис — перпендикуляры к d (опорный — «вверх» или «вбок», если ось почти вертикальна)
  function frame(d){
    let ux = 0, uy = 1, uz = 0;
    if (abs(d[1]) > .9) { ux = 1; uy = 0; uz = 0; }
    // e1 = norm(ref × d), e2 = d × e1
    let e1x = uy * d[2] - uz * d[1], e1y = uz * d[0] - ux * d[2], e1z = ux * d[1] - uy * d[0];
    const l1 = sqrt(e1x * e1x + e1y * e1y + e1z * e1z) || 1; e1x /= l1; e1y /= l1; e1z /= l1;
    const e2x = d[1] * e1z - d[2] * e1y, e2y = d[2] * e1x - d[0] * e1z, e2z = d[0] * e1y - d[1] * e1x;
    return [e1x, e1y, e1z, e2x, e2y, e2z];
  }
  function ring(P, p, d, rr, n, tone, rot){
    const f = frame(d), base = P.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const a = rot + i * TAU / n, c = cos(a), s = sin(a);
      const nx = f[0] * c + f[3] * s, ny = f[1] * c + f[4] * s, nz = f[2] * c + f[5] * s;
      P.pos.push(p[0] + nx * rr, p[1] + ny * rr, p[2] + nz * rr); P.nrm.push(nx, ny, nz); P.tone.push(tone);
    }
    return base;
  }
  function tube(P, a, b, n){ for (let i = 0; i < n; i++) { const j = (i + 1) % n; P.idx.push(a + i, a + j, b + i, b + i, a + j, b + j); } }
  function cap(P, base, n, p, d, tone){ const c = P.pos.length / 3; P.pos.push(p[0], p[1], p[2]); P.nrm.push(d[0], d[1], d[2]); P.tone.push(tone); for (let i = 0; i < n; i++) P.idx.push(base + i, base + (i + 1) % n, c); }
  // икосаэдр (узлы и грани), уровень 1 — каждое ребро пополам; кэш единичных сфер
  const ICO = [];
  function icoUnit(det){
    if (ICO[det]) return ICO[det];
    const t = (1 + sqrt(5)) / 2;
    let v = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
    let f = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
    for (let i = 0; i < v.length; i += 3) { const l = sqrt(v[i] * v[i] + v[i + 1] * v[i + 1] + v[i + 2] * v[i + 2]); v[i] /= l; v[i + 1] /= l; v[i + 2] /= l; }
    for (let d = 0; d < det; d++) {
      const mid = new Map(), nf = [];
      const m = (a, b) => { const k = a < b ? a * 65536 + b : b * 65536 + a; let i = mid.get(k); if (i !== undefined) return i; let x = v[a * 3] + v[b * 3], y = v[a * 3 + 1] + v[b * 3 + 1], z = v[a * 3 + 2] + v[b * 3 + 2]; const l = sqrt(x * x + y * y + z * z); i = v.length / 3; v.push(x / l, y / l, z / l); mid.set(k, i); return i; };
      for (let i = 0; i < f.length; i += 3) { const a = f[i], b = f[i + 1], c = f[i + 2], ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca); }
      f = nf;
    }
    return (ICO[det] = { v, f });
  }
  function cloud(P, x, y, z, rx, ry, rz, det, seed, tone){
    const U = icoUnit(det), base = P.pos.length / 3, v = U.v;
    for (let i = 0; i < v.length; i += 3) {
      const j = 1 + ((hash(i, seed, 13) & 1023) / 1023 - .5) * .36;   // рваная поверхность
      const nx = v[i], ny = v[i + 1], nz = v[i + 2];
      P.pos.push(x + nx * rx * j, y + ny * ry * j, z + nz * rz * j);
      let mx = nx / rx, my = ny / ry, mz = nz / rz; const l = sqrt(mx * mx + my * my + mz * mz) || 1;
      P.nrm.push(mx / l, my / l, mz / l); P.tone.push(clamp(tone + (ny > 0 ? .06 : -.08) * 255 / 255, 0, 1));
    }
    for (let i = 0; i < U.f.length; i++) P.idx.push(base + U.f[i]);
  }
  // юбка хвои: конус (основание на y, вершина выше на h), край с неровными «лапами», низ — внутрь (видно снизу тень)
  function skirt(P, x, y, z, R, h, n, seed, tone){
    const base = P.pos.length / 3, sl = R / sqrt(R * R + h * h), cy = h / sqrt(R * R + h * h);
    for (let i = 0; i < n; i++) {
      const a = i * TAU / n + (seed & 7) * .1, j = 1 + ((hash(i, seed, 29) & 1023) / 1023 - .5) * .3, c = cos(a), s = sin(a), dr = ((hash(i, seed, 31) & 1023) / 1023) * .25 * h;
      P.pos.push(x + s * R * j, y - dr, z + c * R * j); P.nrm.push(s * cy, sl, c * cy); P.tone.push(tone);
    }
    const top = P.pos.length / 3; P.pos.push(x, y + h, z); P.nrm.push(0, 1, 0); P.tone.push(clamp(tone + .05, 0, 1));
    const bot = P.pos.length / 3; P.pos.push(x, y + h * .18, z); P.nrm.push(0, -1, 0); P.tone.push(clamp(tone - .2, 0, 1));
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; P.idx.push(base + i, base + j, top, base + j, base + i, bot); }
  }
  // пряди (ива, лианы): две скрещённые узкие ленты сверху вниз
  function strand(P, x, y, z, L, seed, tone){
    const w = .22, a = (seed & 15) / 16 * PI;
    for (let k = 0; k < 2; k++) {
      const c = cos(a + k * HPI) * w, s = sin(a + k * HPI) * w, b = P.pos.length / 3, nx = -s / w, nz = c / w;
      P.pos.push(x - c, y, z - s, x + c, y, z + s, x + c * .4, y - L, z + s * .4, x - c * .4, y - L, z - s * .4);
      for (let q = 0; q < 4; q++) { P.nrm.push(nx * .3, .9, nz * .3); P.tone.push(tone); }
      P.idx.push(b, b + 1, b + 2, b, b + 2, b + 3, b + 2, b + 1, b, b + 3, b + 2, b);
    }
  }
  TR.mesh = (S, o = {}) => {
    const lod = o.lod | 0, sp = SP[S.sp] || SP.oak, LC = sp.leafC, NG = Math.min(LC.length, lod >= 2 ? 1 : 3);
    const bark = Part('bark', 0, sp.bark);
    const leaf = []; for (let i = 0; i < NG; i++) leaf.push(Part(sp.leaf === 'needles' ? 'needles' : 'leaves', i + 1, LC[i]));
    const segs = S.segs, rk = o.rk ?? sp.rk3 ?? 1;
    // ── кора: цепочки отрезков — общие кольца (без швов на изгибах); число граней — по толщине и lod. У ели веточки мутовок
    //    спрятаны в юбках хвои — их не рисуем; ветка начинается внутри родителя — без «донышка», конец — колпачок ──
    let i = 0;
    while (i < segs.length) {
      const ch = segs[i + 10], depth = segs[i + 8], kind = segs[i + 9];
      let j = i; while (j + 11 < segs.length && segs[j + 11 + 10] === ch) j += 11;   // конец цепочки
      const skip = (lod >= 1 && depth >= 2) || (lod >= 2 && (depth >= 1 || kind === 2)) || (sp.form === 'cone' && depth >= 2);
      if (!skip) {
        const r0 = segs[i + 6] * rk, n = lod >= 2 ? 4 : r0 > .32 ? (lod ? 6 : 8) : r0 > .12 ? (lod ? 4 : 5) : 3;
        const rot = ((hash(ch, S.seed, 5) & 255) / 255) * TAU;
        let d = norm([segs[i + 3] - segs[i], segs[i + 4] - segs[i + 1], segs[i + 5] - segs[i + 2]]);
        const t0 = kind === 2 ? .42 : .46 + (depth ? .04 : 0);   // тон коры (0,5 — свой цвет): у корня темнее, к макушке светлее
        let prev = ring(bark, [segs[i], segs[i + 1] - (kind === 0 && i === 0 ? .25 : 0), segs[i + 2]], d, r0, n, kind === 0 ? t0 - .06 : t0, rot);
        for (let k = i; k <= j; k += 11) {
          const dn = norm([segs[k + 3] - segs[k], segs[k + 4] - segs[k + 1], segs[k + 5] - segs[k + 2]]);
          let dd = dn;
          if (k + 11 <= j) { const nx = norm([segs[k + 14] - segs[k + 11], segs[k + 15] - segs[k + 12], segs[k + 16] - segs[k + 13]]); dd = norm([dn[0] + nx[0], dn[1] + nx[1], dn[2] + nx[2]]); }
          const cur = ring(bark, [segs[k + 3], segs[k + 4], segs[k + 5]], dd, segs[k + 7] * rk, n, Math.min(.7, t0 + (segs[k + 4] / Math.max(4, S.H)) * .12), rot);
          tube(bark, prev, cur, n); prev = cur; d = dn;
        }
        const re = segs[j + 7] * rk;
        cap(bark, prev, n, [segs[j + 3] + d[0] * re * .8, segs[j + 4] + d[1] * re * .8, segs[j + 5] + d[2] * re * .8], d, .52);
      }
      i = j + 11;
    }
    // ── крона ──
    const bl = S.blobs;
    if (lod >= 2 && bl.length) {   // дальняя: облака сливаются в 1–3 (или юбки — в 1–2 конуса)
      const cone = bl[6] === 2;
      if (cone) {
        let yb = 1e9, yt = -1e9, rmax = 0, cx = 0, cz = 0, n = 0;
        for (let b = 0; b < bl.length; b += 8) { if (bl[b + 6] !== 2) continue; yb = Math.min(yb, bl[b + 1]); yt = Math.max(yt, bl[b + 1] + bl[b + 4]); rmax = Math.max(rmax, bl[b + 3]); cx += bl[b]; cz += bl[b + 2]; n++; }
        cx /= n; cz /= n;
        skirt(leaf[0], cx, yb, cz, rmax, (yt - yb) * .55, 7, S.seed, .5);
        skirt(leaf[0], cx, yb + (yt - yb) * .42, cz, rmax * .7, (yt - yb) * .58, 7, S.seed + 1, .55);
      } else {
        const groups = [[], [], []], b0 = S.box;
        for (let b = 0; b < bl.length; b += 8) { const f = (bl[b + 1] - b0[1]) / Math.max(1, b0[4] - b0[1]); groups[f > .66 ? 2 : f > .33 ? 1 : 0].push(b); }
        for (const G of groups) {
          if (!G.length) continue;
          let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
          for (const b of G) { x0 = Math.min(x0, bl[b] - bl[b + 3]); x1 = Math.max(x1, bl[b] + bl[b + 3]); y0 = Math.min(y0, bl[b + 1] - bl[b + 4]); y1 = Math.max(y1, bl[b + 1] + bl[b + 4]); z0 = Math.min(z0, bl[b + 2] - bl[b + 5]); z1 = Math.max(z1, bl[b + 2] + bl[b + 5]); }
          cloud(leaf[0], (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2 * .92, (y1 - y0) / 2 * .92, (z1 - z0) / 2 * .92, 0, S.seed + G[0], .5);
        }
      }
    } else for (let b = 0; b < bl.length; b += 8) {
      const g = (hash(b, S.seed, 41) % NG), P = leaf[g], kind = bl[b + 6], tn = .35 + bl[b + 7] * .3;
      if (kind === 2) skirt(P, bl[b], bl[b + 1], bl[b + 2], bl[b + 3], bl[b + 4], lod ? 7 : 9, S.seed + b, tn);
      else cloud(P, bl[b], bl[b + 1], bl[b + 2], bl[b + 3], bl[b + 4], bl[b + 5], !lod && bl[b + 3] > 1.25 ? 1 : 0, S.seed + b, tn);
    }
    if (lod < 2) for (let h = 0; h < S.hang.length; h += 5) strand(leaf[(hash(h, S.seed, 43) % NG)], S.hang[h], S.hang[h + 1], S.hang[h + 2], S.hang[h + 3], S.seed + h, .45 + S.hang[h + 4] * .2);
    // на выход — типизированные массивы
    const parts = [bark, ...leaf].filter(P => P.idx.length).map(P => {
      const nv = P.pos.length / 3;
      return { kind: P.kind, grp: P.grp, color: P.color, pos: Float32Array.from(P.pos), nrm: Float32Array.from(P.nrm), tone: Uint8Array.from(P.tone, t => clamp(Math.round(t * 255), 0, 255)), idx: nv > 65535 ? Uint32Array.from(P.idx) : Uint16Array.from(P.idx) };
    });
    let crown = 0; for (let b = 0; b < bl.length; b += 8) crown = Math.max(crown, sqrt(bl[b] * bl[b] + bl[b + 2] * bl[b + 2]) + bl[b + 3]);
    return { parts, H: S.H, crown, trunkR: S.R0 * rk, box: S.box, sp: S.sp, lod };
  };
  // сколько вершин и треугольников в сетке (замеры, проверки)
  TR.meshStats = M => { let v = 0, t = 0; for (const p of M.parts) { v += p.pos.length / 3; t += p.idx.length / 3; } return { v, t }; };

  // Часть сетки выше среза y (падающий верх дерева): треугольники целиком ниже — прочь; вершины ниже среза — на срез
  TR.cut = (P, y) => {
    const nv = P.pos.length / 3, keep = new Int32Array(nv).fill(-1), pos = [], nrm = [], tone = [], idx = [];
    for (let i = 0; i < P.idx.length; i += 3) {
      const a = P.idx[i], b = P.idx[i + 1], c = P.idx[i + 2];
      if (P.pos[a * 3 + 1] < y && P.pos[b * 3 + 1] < y && P.pos[c * 3 + 1] < y) continue;
      for (const v of [a, b, c]) {
        if (keep[v] < 0) { keep[v] = pos.length / 3; pos.push(P.pos[v * 3], Math.max(y, P.pos[v * 3 + 1]), P.pos[v * 3 + 2]); nrm.push(P.nrm[v * 3], P.nrm[v * 3 + 1], P.nrm[v * 3 + 2]); tone.push(P.tone ? P.tone[v] : 160); }
        idx.push(keep[v]);
      }
    }
    return { kind: P.kind, grp: P.grp, color: P.color, pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), tone: Uint8Array.from(tone), idx: pos.length / 3 > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx) };
  };

  // ═══ Кто рисует дерево с этим id (3D-миры): разрушениям — сетка и место ═══
  const SRC = new Map();
  TR.source = (prefix, f) => { if (f) SRC.set(prefix, f); else SRC.delete(prefix); return () => { if (SRC.get(prefix) === f) SRC.delete(prefix); }; };
  TR.lookup = id => { if (typeof id !== 'string') return null; const k = id.indexOf(':'); const f = k > 0 ? SRC.get(id.slice(0, k)) : null; try { return f ? f(id) : null; } catch (e) { return null; } };
  TR.src = '(' + d37Trees + ')();';
})();
