// ═══════════════════════════════════════
//  3D «МИРА ДЕНЧИКА» И ГАРДЕРОБА — Three.js: объёмная карта и милые человечки-чиби, собранные по частям (как в Роблоксе)
// ═══════════════════════════════════════
// Части человечка — слоты D37Char.PARTS с body: 1 (avatar.js): фигура, кожа, рост, телосложение, голова, цвет глаз, брови,
// ресницы, щёчки, причёска и цвет волос, верх/низ/обувь и их цвета, очки, шея, спина, на руках, стиль лица и ЧАСТИ ТЕЛА:
// у головы, туловища, каждой руки и ноги своя форма (пакеты: обычные, классика-блоки, стройные, силач, робот, рыцарь —
// вперемешку) и свой цвет (кожа этой части или цвет брони). Плюс части гардероба: цвет одежды (look.color), глаза, рот, шапка,
// предмет в руке, питомец, след. Не выбранное — по «отпечатку» ключа игрока (resolve), чтобы толпа была разной; формы и цвета
// частей, стиль лица и перчатки — «как было до них» (PART_DEF): старые образы выглядят как раньше.
// kit(T, { q }) — материалы, геометрии, сборка (build) и анимация (animate); q — качество low/mid/high (на high больше сегментов
// и мелочей). create() — мир (карта 2400×1600 px, 1 единица 3D = 20 px); preview() — витрина гардероба (крутится пальцем,
// нажатие на часть тела — onPick, подсветка части — highlight) и картинки вариантов (thumb).
// Скелет: тело → ноги (бедро → колено) и туловище → руки (плечо → локоть → кисть), шея → голова → лицо (наборы выражений).
// Склейка (bake): все меши кости с одним материалом — одна индексированная геометрия; обычные цвета — в вершинах (общий
// материал на всех человечков), поэтому вызовов отрисовки ~15–20 на человечка; перекраска палитрой — переписать цвета вершин
// (recolor), без пересборки. build(look, key, { lod: 1 }) — дальний человечек: меньше сегментов, без мелочей и выражений.
// Анимация: поза — массив суставов (без мусора каждый кадр); стойка/шаг/бег смешиваются весами, смена состояния (прыжок,
// сидит, плывёт, вис…) — плавным переходом; таз и плечи — навстречу, колени и локти, взгляд (o.look), приземление, эмоции
// с выражением лица (EMOTES).
// Нет WebGL или не загрузился Three.js → мир и гардероб остаются в 2D.
(() => {
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js';
  const U = 20;
  const PI = Math.PI, TAU = PI * 2;
  let loading = null;

  function supported(){
    try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
  }
  function load(){
    if (window.THREE) return Promise.resolve(true);
    if (loading) return loading;
    loading = new Promise(res => {
      const s = document.createElement('script');
      s.src = THREE_URL; s.async = true;
      s.onload = () => res(!!window.THREE);
      s.onerror = () => { loading = null; res(false); };
      document.head.appendChild(s);
      setTimeout(() => res(!!window.THREE), 15000);
    });
    return loading;
  }

  // ── Внешность ──
  const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const D = () => window.D37Char;
  const partV = (slot, id, def) => { const p = D()?.part(slot, id); return p && p.v ? p.v : def; };
  function shade(hex, amt){
    const n = parseInt(String(hex).slice(1, 7), 16) || 0, t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v + (t - v) * p).toString(16).padStart(2, '0')).join('');
  }
  const light = c => { const n = parseInt(String(c).slice(1, 7), 16) || 0; return ((n >> 16) * .3 + ((n >> 8) & 255) * .59 + (n & 255) * .11) > 215; };
  // Новые слоты: нет в образе — «как было до них» (не по отпечатку: иначе у тех, кто не открывал редактор, сменилась бы внешность)
  const PART_DEF = { psh: 'round', pst: 'base', psal: 'base', psar: 'base', psll: 'base', pslr: 'base', pch: 'auto', pct: 'auto', pcal: 'auto', pcar: 'auto', pcll: 'auto', pclr: 'auto', face: 'anime', glove: 'none', glovec: 'auto' };
  // Полный набор частей: выбранное игроком + недостающее по отпечатку ключа
  function resolve(look, key){
    const L = D() ? D().norm(look) : { ...(look || {}) };
    const h = hash(key || 'x'), pick = (a, sh) => a[(h >>> sh) % a.length];
    const r = (s, def) => (L[s] !== undefined && L[s] !== null ? String(L[s]) : def);
    const body = r('body', h & 1 ? 'girl' : 'boy'), girl = body === 'girl';
    const out = {
      color: L.color || 'blue', eyes: L.eyes || 'normal', mouth: L.mouth || 'smile', hat: L.hat || 'none', item: L.item || 'none', pet: L.pet || 'none', trail: L.trail || 'none',
      body,
      tone: r('tone', pick(['t2', 't3', 't4', 't5', 't6', 't3', 't2', 't7'], 3)),
      hgt: r('hgt', '2'), wid: r('wid', '2'), head: r('head', '2'),
      eyec: r('eyec', pick(['brown', 'dark', 'blue', 'green', 'brown', 'gray'], 6)),
      brows: r('brows', 'soft'), lash: r('lash', girl ? 'yes' : 'no'), cheek: r('cheek', 'blush'),
      hair: r('hair', girl ? pick(['ponytail', 'long', 'buns', 'bob'], 9) : pick(['short', 'side', 'spiky', 'curly'], 9)),
      hairc: r('hairc', pick(['black', 'dark', 'brown', 'caramel', 'blond', 'ginger', 'dark', 'brown'], 12)),
      top: r('top', 'hoodie'), bottom: r('bottom', girl && (h >>> 15) & 1 ? 'skirt' : 'pants'),
      botc: r('botc', pick(['graphite', 'denim', 'black', 'khaki', 'denim'], 16)),
      shoes: r('shoes', 'sneakers'), shoec: r('shoec', pick(['white', 'white', 'black', 'red', 'blue'], 19)),
      glasses: r('glasses', 'none'), neck: r('neck', 'none'), back: r('back', 'none'),
      trim: r('trim', 'auto'), hatc: r('hatc', 'auto'), glassc: r('glassc', 'auto'), neckc: r('neckc', 'auto'), backc: r('backc', 'auto'),
    };
    for (const s in PART_DEF) out[s] = r(s, PART_DEF[s]);
    return out;
  }
  // Цвета частей: готовый цвет или свой из палитры; «как задумано» (auto) — свой цвет у каждой вещи
  const PALS = ['color', 'tone', 'eyec', 'hairc', 'trim', 'botc', 'shoec', 'hatc', 'glassc', 'neckc', 'backc', 'pch', 'pct', 'pcal', 'pcar', 'pcll', 'pclr', 'glovec'];
  const SPECIAL = { color: ['galaxy', 'gold', 'rainbow'], tone: ['goldskin'], eyec: ['glow', 'fire'], hairc: ['neon', 'rainbow'] };
  const AUTO_HARD = ['hatc', 'glassc', 'neckc', 'backc'];   // у этих «как задумано» бывает особым материалом (золото, узор) — перекраской не обойтись
  const DEFC = { color: '#4f8df7', tone: '#f7cba5', eyec: '#7a4a25', hairc: '#3e2819', trim: '#f4f5f7', botc: '#3b4252', shoec: '#f4f4f6', hatc: '#e8384f', glassc: '#1f1f27', neckc: '#e11d48', backc: '#f59e0b', glovec: '#e23b4e' };
  function colorOf(R, slot){ const v = partV(slot, R[slot], DEFC[slot] || '#888888'); return v && v[0] === '#' ? v : DEFC[slot] || '#888888'; }
  // ── Части тела: ключ → [слот формы, слот цвета]; броня (робот, рыцарь) — свой металл «как задумано»
  const PARTS3 = { head: ['psh', 'pch'], torso: ['pst', 'pct'], armL: ['psal', 'pcal'], armR: ['psar', 'pcar'], legL: ['psll', 'pcll'], legR: ['pslr', 'pclr'] };
  const ARMOR = { robot: '#b9c3cd', knight: '#c3cad6' };
  const isArmor = sh => sh === 'robot' || sh === 'knight';
  function partCol(R, part){ const ps = PARTS3[part], v = R[ps[1]]; if (v && v !== 'auto') return colorOf(R, ps[1]); return isArmor(R[ps[0]]) ? ARMOR[R[ps[0]]] : colorOf(R, 'tone'); }
  // Силуэт туловища (радиус, высота 0…1): у девочки талия и бёдра, у силача — широкие плечи
  const PROF = {
    boy: [[.001, 0], [.7, .015], [.92, .07], [1, .22], [.99, .45], [.96, .65], [.88, .83], [.66, .95], [.32, 1], [.001, 1]],
    girl: [[.001, 0], [.66, .015], [.9, .07], [.99, .2], [.9, .42], [.86, .56], [.9, .72], [.84, .85], [.62, .95], [.3, 1], [.001, 1]],
    chunky: [[.001, 0], [.72, .015], [.93, .07], [.98, .22], [.97, .42], [1.08, .62], [1.14, .78], [.96, .9], [.62, .97], [.3, 1], [.001, 1]],
  };
  const rAt = (prof, f) => { for (let i = 1; i < prof.length; i++) if (prof[i][1] >= f) { const [r0, y0] = prof[i - 1], [r1, y1] = prof[i]; return r0 + (r1 - r0) * ((f - y0) / Math.max(1e-6, y1 - y0)); } return 0; };
  // Плавный силуэт: точки профиля → больше точек по Катмулл-Рому (на высоком качестве без «изломов»)
  function smoothProf(prof, sub){
    if (sub < 2) return prof;
    const out = [], n = prof.length, Pp = i => prof[Math.max(0, Math.min(n - 1, i))];
    const cr = (a, b, c, d, t) => .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    for (let i = 0; i < n - 1; i++) {
      const p0 = Pp(i - 1), p1 = Pp(i), p2 = Pp(i + 1), p3 = Pp(i + 2);
      for (let k = 0; k < sub; k++) {
        const t = k / sub, prev = out.length ? out[out.length - 1][1] : 0;
        out.push([Math.max(.001, cr(p0[0], p1[0], p2[0], p3[0], t)), Math.max(prev, Math.min(1, cr(p0[1], p1[1], p2[1], p3[1], t)))]);
      }
    }
    out.push(prof[n - 1]);
    return out;
  }
  // Формы головы: ell — эллипсоид (доли радиуса .56), cyl — цилиндр со скруглением (классика), box — скруглённый кубик.
  // hair — растяжка причёски под форму, hat — [растяжка по x, подъём, растяжка по z] шапки, top — верх головы (доли), ex — разлёт глаз
  const HEADS = {
    round: { k: 'ell', s: [1.04, .96, .98], hair: [1, 1, 1], hat: [1, 0, 1], top: 1.04, ex: 1 },
    egg: { k: 'ell', s: [.95, 1.07, .96], hair: [.92, 1.11, .98], hat: [.94, .06, .98], top: 1.15, ex: .93 },
    wide: { k: 'ell', s: [1.16, .88, 1.0], hair: [1.12, .92, 1.02], hat: [1.1, -.04, 1.02], top: .97, ex: 1.1 },
    block: { k: 'cyl', r: .58, h: .5, c: .2, hair: [1.08, 1.0, 1.1], hat: [1.06, -.03, 1.08], top: 1.0, ex: 1.0 },
    cube: { k: 'box', s: [.55, .53, .52], c: .14, p: 6, hair: [1.16, 1.04, 1.18], hat: [1.14, 0, 1.16], top: 1.04, ex: .98 },
    robot: { k: 'box', s: [.53, .5, .5], c: .1, p: 8, hat: [1.1, -.03, 1.1], top: 1.0, ex: .95 },
    knight: { k: 'ell', s: [1.1, 1.06, 1.08], hat: [1.1, .05, 1.1], top: 1.12, ex: 1 },
  };
  // ── Поза: суставы в массиве (без мусора каждый кадр) ──
  // BY/BZ — тело вверх/вперёд, BX/BRY/BRZ — повороты тела (кувырок, таз, крен), BS — размер, SQ — сплющить (приземление,
  // присед); TX/TY/TZ/TS — туловище (наклон, поворот плеч, крен, дыхание); HX/HY/HZ — голова; руки: AL*/AR* — плечо,
  // EL/ER — локоть (−: кисть вперёд); ноги: LL*/LR* — бедро (−: нога вперёд), KL/KR — колено (+: голень назад)
  const J = { BY: 0, BZ: 1, BX: 2, BRY: 3, BRZ: 4, BS: 5, SQ: 6, TX: 7, TY: 8, TZ: 9, TS: 10, HX: 11, HY: 12, HZ: 13,
    ALX: 14, ALY: 15, ALZ: 16, EL: 17, ARX: 18, ARY: 19, ARZ: 20, ER: 21, LLX: 22, LLZ: 23, KL: 24, LRX: 25, LRZ: 26, KR: 27 };
  const NJ = 28;
  const REST = new Float32Array(NJ);
  REST[J.BS] = 1; REST[J.SQ] = 1; REST[J.TS] = 1; REST[J.ALZ] = -.16; REST[J.ARZ] = .16; REST[J.EL] = -.12; REST[J.ER] = -.12; REST[J.KL] = .05; REST[J.KR] = .05;
  const pose = o => { const a = REST.slice(); for (const k in o) a[J[k]] = o[k]; return a; };
  // Паркур — ключевые позы по прогрессу 0…1 (между ними — плавно)
  const PK = {
    vault: [[0, pose({ ARX: -1.0, ARZ: .2, ALX: -.6, ALZ: -.5, LLX: -.5, LRX: -.5, KL: .8, KR: .8, TX: .35 })],
      [.3, pose({ ARX: -1.0, ARZ: .2, ALX: -.6, ALZ: -.5, LLX: -.5, LRX: -.5, KL: .8, KR: .8, TX: .35 })],
      [.42, pose({ ARX: -.35, ARZ: .45, ALX: -1.4, ALZ: -.9, LLX: -1.3, LRX: -1.1, KL: 1.2, KR: .6, BRZ: .3, TX: .2 })],
      [.62, pose({ ARX: -.35, ARZ: .45, ALX: -1.4, ALZ: -.9, LLX: -1.3, LRX: -1.1, KL: 1.2, KR: .6, BRZ: .3, TX: .2 })],
      [.75, pose({ ALX: -.8, ALZ: -.8, ARX: -.8, ARZ: .8, LLX: -.35, LRX: .3, KL: .4, KR: .3, TX: .15 })], [1, pose({ ALX: -.8, ALZ: -.8, ARX: -.8, ARZ: .8, LLX: -.35, LRX: .3, KL: .3, KR: .2, TX: .15 })]],
    hang: [[0, pose({ ALX: -2.9, ALZ: -.15, ARX: -2.9, ARZ: .15, EL: -.15, ER: -.15, LLX: -.2, LRX: .1, KL: .3, KR: .2 })], [1, pose({ ALX: -2.9, ALZ: -.15, ARX: -2.9, ARZ: .15, EL: -.15, ER: -.15, LLX: -.2, LRX: .1, KL: .3, KR: .2 })]],
    up: [[0, pose({ ALX: -2.9, ALZ: -.15, ARX: -2.9, ARZ: .15, EL: -.1, ER: -.1, LLX: -.15, LRX: .1, KL: .25, KR: .2 })],
      [.38, pose({ ALX: -2.9, ALZ: -.15, ARX: -2.9, ARZ: .15, EL: -.1, ER: -.1, LLX: -.15, LRX: .1, KL: .25, KR: .2 })],
      [.62, pose({ ALX: -1.3, ALZ: -.3, ARX: -1.3, ARZ: .3, EL: -1.5, ER: -1.5, LLX: -.5, LRX: .05, KL: .9, KR: .3, TX: .3 })],
      [.8, pose({ ALX: -.45, ALZ: -.35, ARX: -.45, ARZ: .35, EL: -.3, ER: -.3, LLX: -1.35, LRX: .2, KL: 1.9, KR: .4, TX: .45 })], [1, pose({ ALX: -.45, ALZ: -.35, ARX: -.45, ARZ: .35, EL: -.3, ER: -.3, LLX: -1.0, LRX: .1, KL: 1.4, KR: .3, TX: .3 })]],
  };
  // Переход между состояниями (с): 0 земля, 1 кувырок, 2 вис, 3 лестница, 4 перелезть, 5 плывёт, 6 воздух, 7 сидит,
  // 8 вис паркура, 9 подтянуться, 10 нырок, 11 держится на воде, 12 ползком (лёг — o.crawl, «Кубомир»: лаз высотой в блок),
  // 13 лежит на спине (o.lie: на кровати или на земле; o.sleep — глаза закрыты; T-123)
  const XD = [.2, .07, .12, .15, .1, .3, .14, .25, .1, .1, .25, .3, .22, .3];
  // Эмоции: длительность и выражение лица
  const EMOTES = ['👋', '😂', '❤️', '🔥', '🎉', '😎', '😭', '👍', '💃', '👏', '🤔', '😮', '😡', '🙇', '🤸'];
  const EMO_T = { '💃': 3.2, '🤔': 2.4, '🙇': 1.9, '🤸': 1.15, '👏': 1.8 };
  const EMO_EXPR = { '👋': 'joy', '😂': 'laugh', '❤️': 'love', '🔥': 'fierce', '🎉': 'joy', '😎': 'cool', '😭': 'sad', '👍': 'wink', '💃': 'joy', '👏': 'joy', '🤔': 'think', '😮': 'wow', '😡': 'mad', '🙇': 'calm', '🤸': 'joy' };
  // Выражения: глаза (arc ^^, squeeze ><, heart, shades, wink, wide, closed), веки, брови (up, angry, worried, one), рот, слёзы, взгляд
  const EXPR = {
    base: {},
    joy: { eyes: 'arc', mouth: 'open', brow: 'up' },
    laugh: { eyes: 'squeeze', mouth: 'laugh', brow: 'up', tears: 1 },
    love: { eyes: 'heart', mouth: 'open' },
    fierce: { lid: 'angry', mouth: 'grin', brow: 'angry' },
    cool: { eyes: 'shades', mouth: 'smirk' },
    sad: { mouth: 'frown', brow: 'worried', tears: 2 },
    wink: { eyes: 'wink', mouth: 'open' },
    think: { gaze: [.7, .8], mouth: 'flat', brow: 'one' },
    wow: { eyes: 'wide', mouth: 'o', brow: 'up' },
    mad: { lid: 'angry', mouth: 'frown', brow: 'angry' },
    calm: { eyes: 'closed', mouth: 'smile' },
  };
  // ── Телефон 📱 (как в ГТА): режимы use — в руке перед грудью, голова к экрану; call — у уха, свободная рука жестикулирует;
  //    play — боком двумя руками, большие пальцы бегают; photo — двумя руками перед собой, «щёлк» со вспышкой. Код по сети:
  //    0 — нет, 1 use, 2 call, 3 play, 4 photo. Переходы: достать (рука к карману, телефон вверх) и убрать — тот же путь назад.
  const PH_MODES = ['use', 'call', 'play', 'photo'];
  const phIdx = v => typeof v === 'number' ? (v >= 1 && v <= 4 ? (v | 0) - 1 : -1) : PH_MODES.indexOf(v);
  const PHW = .2, PHH = .36, PHD = .032;   // корпус: ширина, высота, толщина (человечек ~2,3 ростом; чиби — крупнее, чтобы читался)
  // суставы слоя телефона (в этом порядке — в массивах калибровки): туловище, голова, левая рука, правая рука; последние два —
  // плечи вверх (их нет в позе: у чиби короткие руки, плечо помогает дотянуться до уха — пишутся в ch.phS.sh)
  const PHJ = [J.TX, J.TY, J.TZ, J.HX, J.HY, J.HZ, J.ALX, J.ALY, J.ALZ, J.EL, J.ARX, J.ARY, J.ARZ, J.ER, -1, -1];
  const NPH = PHJ.length;
  // Режим: h — голова (вниз, к руке, наклон), t — туловище (вперёд), sh — плечи вверх [левое, правое], r — куда кисть от плеча
  // (направление в осях туловища + доля длины руки), ear — кисть у уха, two — двумя руками, l — свободная левая (жест);
  // маски: сколько сустава забирает телефон (mt — туловище, mh — голова, ml — левая рука; правая — вся)
  const PHM = [
    { h: [.4, .1, .03], t: [.06, 0, 0], sh: [0, 0], r: [-.5, .02, .87, .88], mt: .55, mh: .9, ml: 0, scr: 'home', spd: 4.6 },
    { h: [.07, -.05, -.37], t: [.02, 0, 0], sh: [0, .055], ear: 1, l: [-.6, .1, -.1, -1.25], mt: .4, mh: .85, ml: .75, scr: 'call', spd: 6 },
    { h: [.32, 0, 0], t: [.13, 0, 0], sh: [0, 0], r: [-.55, -.12, .82, .92], two: 1, mt: .7, mh: .95, ml: 1, scr: 'game', spd: 3 },
    { h: [.14, .04, 0], t: [-.03, 0, 0], sh: [.03, .03], r: [-.42, .03, .9, .97], two: 1, mt: .6, mh: .85, ml: 1, scr: 'camera', spd: 3.2 },
  ];
  // рука у кармана (сбоку у бедра, чуть назад), голова глянула туда же
  const PH_POCKET = { h: [.16, .22, 0], t: [.08, .1, 0], sh: [0, 0], r: [.12, -.95, -.28, .97], mt: .5, mh: .6, ml: 0 };

  // ── Руки и предметы (бой, инструменты — D37E.combat, docs/COMBAT.md): слой поверх позы, только если игра дала o.hold ──
  //    o.hold = { r, l, m, mh, v, g, d, p }: что в правой и левой (номер HOLDS), движение (MOTIONS) правой (mh 0) или левой (mh 1),
  //    его фаза v 0…3 (0…1 — замах, 1…2 — удар, 2…3 — возврат), щит поднят g 0…1, лук натянут d 0…1, наклон взгляда p (рад, «+» —
  //    вверх). Номера — те же, что CB.HOLDS / CB.MOTIONS (только дописывать в конец; combat-test сверяет). Без o.hold позы — как были.
  //    Углы руки — как у суставов позы: a — плечо вперёд-вверх (−), b — поворот вокруг вертикали (−: к груди), c — в сторону (+:
  //    наружу), e — локоть (−: кисть вперёд) — заданы для руки armR (сторона +x); другой руке — зеркально (b и c с другим знаком).
  //    ВАЖНО: у человечка armL / handL — его ПРАВАЯ рука (сам он смотрит на +z, armL — на −x; «левая» — для того, кто смотрит на
  //    него спереди, как в гардеробе). Поэтому правая (главная, r) — суставы armL, левая (l) — armR. ty — поворот плеч, tx — наклон
  const HOLDS = ['', 'fist', 'tool', 'sword', 'axe', 'pick', 'shovel', 'block', 'item', 'torch', 'food', 'shield', 'bow'];
  const MOTIONS = ['', 'jab', 'slash', 'back', 'thrust', 'chop', 'dig', 'scoop', 'swing', 'push', 'eat', 'shoot', 'bash'];
  // держит: [a, b, c, e, вес] (вес < 1 — руке остаётся немного шага)
  const HOLD_TOOL = [-.45, 0, .12, -.62, .72];
  // (углы подобраны под точку кисти у человечка обычного роста: факел — у плеча вверху, щит — перед животом, лук — перед собой)
  const HOLD_P = [null, null, HOLD_TOOL, [-.5, -.08, .14, -.72, .75], HOLD_TOOL, HOLD_TOOL, HOLD_TOOL, [-.58, 0, .1, -.8, .75], HOLD_TOOL,
    [-2.36, -.22, .2, -.25, .85], HOLD_TOOL, [-.65, -1.04, .19, -.63, .8], [.09, -1.5, .9, -.19, .8]];
  const GUARD_P = [-1.16, 0, -.42, -.83, 1];                 // щит поднят (левая — зеркально): перед грудью
  const BOW_L = [-1.53, 0, .11, -.14, 1];                    // лук натянут: левая вытянута вперёд (a — ещё и по наклону взгляда)
  const BOW_R = [-2.11, 0, -.89, 0, 1];                      // правая тянет тетиву к подбородку
  const BOW_IDLE_R = [-.83, 0, -.76, -.13, .8];              // лук в руках, не натянут: правая — у тетивы
  // движения: [замах, конец удара] × [a, b, c, e, ty, tx]
  const MOT_P = [null,
    [[-.85, -.25, .3, -1.75, .22, 0], [-1.55, .05, .06, -.08, -.28, .05]],     // jab — кулак назад и вперёд
    [[-1.24, -.11, .73, -.7, .4, 0], [-1.15, 0, -.41, -.02, -.5, .08]],       // slash — справа налево (замах — в сторону, не за голову)
    [[-1.77, 0, -.54, -.01, -.5, 0], [-.85, .56, .2, -1.18, .45, .06]],       // back — слева направо
    [[-.96, .7, -.11, -2.43, .35, -.04], [-1.47, 0, -.08, 0, -.25, .1]],      // thrust — укол
    [[-2.8, 0, .02, -.05, .1, -.1], [-.99, 0, -.1, -.05, -.08, .22]],         // chop — сверху вниз (замах — над плечом, не за головой)
    [[-2.4, .1, .12, -.9, .05, -.05], [-.75, .05, .1, -.3, -.05, .15]],        // dig — дуга кирки
    [[-.35, 0, .1, -.3, 0, .1], [-1.65, 0, .1, -.6, 0, -.05]],                 // scoop — лопатой снизу вверх
    [[-2.1, .5, .1, -.6, .05, 0], [-.6, .15, .05, -.4, -.05, .08]],            // swing — копает (как в Майнкрафте)
    [[-1.0, 0, .1, -.6, 0, 0], [-1.35, 0, .05, -.05, 0, .04]],                 // push — поставить, нажать
    null,                                                                      // eat — отдельно (рука у рта)
    [[-2.11, 0, -.89, 0, .25, 0], [-1.6, .3, .2, -.6, .2, 0]],                // shoot — тетива отпущена: кисть назад
    [[-.65, -1.04, .19, -.63, -.15, 0], [-1.54, 0, -.62, 0, -.3, .06]],       // bash — толчок щитом
  ];
  const EAT_P = [-2.32, 0, -.48, -.01, 1];
  const hsm = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  const HJ = [[J.ARX, J.ARY, J.ARZ, J.ER], [J.ALX, J.ALY, J.ALZ, J.EL]];
  // дробные числа — через типизированный массив, а не аргументами (иначе на вызове без встраивания каждое — новый объект-число):
  // HN[0] dt, HN[1] t, HN[2] вес эмоции, HN[3] вес руки (holdArm)
  const HN = new Float64Array(4);
  // плечо руки s (0 — armR, 1 — armL) — к углам A (a, b, c, e) с весом HN[3]; armL — зеркально
  function holdArm(Pt, s, A){
    const w = HN[3];
    if (!A || w <= 0) return;
    const j = HJ[s], m = s ? -1 : 1;
    Pt[j[0]] += (A[0] - Pt[j[0]]) * w; Pt[j[1]] += (A[1] * m - Pt[j[1]]) * w; Pt[j[2]] += (A[2] * m - Pt[j[2]]) * w; Pt[j[3]] += (A[3] - Pt[j[3]]) * w;
  }
  const HA = new Float32Array(5), HB = new Float32Array(5);
  // Слой: держит (плавно при смене вещи — ch.hdS), щит, лук, еда; движение — по фазе (без сглаживания: фаза идёт от боя)
  function holdLayer(ch, Pt, H, snap, cat){
    const dt = HN[0], t = HN[1], emw = HN[2];
    let S = ch.hdS;
    if (!S) S = ch.hdS = { w: new Float32Array(2), c: new Int8Array(2), on: 0 };
    const cap = (cat === 0 || cat === 6 || cat === 7 ? 1 : 0) * (1 - emw);   // земля, прыжок, сидит; эмоция — руки ей
    S.on = snap ? cap : S.on + (cap - S.on) * Math.min(1, dt * 12);
    const k = S.on; if (k < .001) return;
    const two = H.r === 12 && H.l === 12;   // лук — обеими
    // держит (смена вещи: вес к нулю — и к новой позе); s 0 — правая (суставы armL: j = 1), 1 — левая (armR: j = 0)
    for (let s = 0; s < 2; s++) {
      const code = s ? H.l : H.r, want = HOLD_P[code] ? 1 : 0, js = 1 - s;
      if (S.c[s] !== code) { if (snap || S.w[s] < .05 || !HOLD_P[S.c[s]]) S.c[s] = code; else { S.w[s] = Math.max(0, S.w[s] - dt / .12); continue; } }
      S.w[s] = snap ? want : Math.min(1, Math.max(0, S.w[s] + (want ? dt : -dt) / .18));
      const P0 = HOLD_P[S.c[s]];
      if (!P0) continue;
      let A = P0;
      if (two) { A = s ? BOW_L : BOW_R; const d = H.d || 0; for (let i = 0; i < 4; i++) HA[i] = (s ? HOLD_P[12] : BOW_IDLE_R)[i] + (A[i] - (s ? HOLD_P[12] : BOW_IDLE_R)[i]) * hsm(d); if (s) HA[0] -= (H.p || 0) * hsm(d); else HA[0] -= (H.p || 0) * .6 * hsm(d); A = HA; }
      else if (S.c[s] === 11 && H.g > 0) { const g = hsm(H.g); for (let i = 0; i < 4; i++) HA[i] = P0[i] + (GUARD_P[i] - P0[i]) * g; HA[0] -= (H.p || 0) * .5 * g; A = HA; }
      HN[3] = S.w[s] * (two ? 1 : P0[4]) * k; holdArm(Pt, js, A);
    }
    // плечи: лук — левым плечом к цели, щит — чуть к щиту (зеркально: правая — суставы armL)
    if (two) { const d = hsm(H.d || 0); Pt[J.TY] -= .25 * d * k; Pt[J.HY] += .25 * d * k; }
    else if (H.l === 11 && H.g > 0) Pt[J.TY] += .15 * hsm(H.g) * k;
    // движение: правая (mh 0) — суставы armL, левая (mh 1) — armR
    const m = H.m | 0, s = H.mh ? 0 : 1, v = Math.max(0, Math.min(3, H.v || 0));
    if (m === 10) {   // еда: рука у рта (v — 0…1 насколько), жуёт
      const e = hsm(v) * k, ch2 = Math.abs(Math.sin(t * 14)) * e;
      HN[3] = e; holdArm(Pt, s, EAT_P);
      const j = HJ[s]; Pt[j[0]] -= .1 * ch2; Pt[j[3]] += .15 * ch2; Pt[J.HX] += .12 * e;
      return;
    }
    const K = MOT_P[m]; if (!K) return;
    // от «держит» к замаху, к концу удара, обратно; края — плавно (вес)
    const seg = v < 1 ? 0 : v < 2 ? 1 : 2, u = hsm(v - seg), w = hsm(Math.min(1, v * 5, (3 - v) * 5)) * k;
    const j = HJ[s], mm = s ? -1 : 1;
    // «держит» — то, что сейчас в позе (уже со слоем держания)
    HB[0] = Pt[j[0]]; HB[1] = Pt[j[1]] * mm; HB[2] = Pt[j[2]] * mm; HB[3] = Pt[j[3]];
    const A0 = seg === 0 ? HB : K[seg - 1], A1 = seg === 2 ? HB : K[seg];
    for (let i = 0; i < 4; i++) HA[i] = A0[i] + (A1[i] - A0[i]) * u;
    HN[3] = w; holdArm(Pt, s, HA);
    const ty0 = seg === 0 ? 0 : K[seg - 1][4], ty1 = seg === 2 ? 0 : K[seg][4], tx0 = seg === 0 ? 0 : K[seg - 1][5], tx1 = seg === 2 ? 0 : K[seg][5];
    Pt[J.TY] += (ty0 + (ty1 - ty0) * u) * mm * w; Pt[J.TX] += (tx0 + (tx1 - tx0) * u) * w;
  }
  const wrapA = a => { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; };
  const autoQ = () => { try { return window.D37E?.gfxQuality?.() || (document.body?.classList.contains('low') ? 'low' : 'high'); } catch (e) { return 'high'; } };

  // ═══ Набор: материалы, геометрии, сборка и анимация персонажа ═══
  function kit(T, ko = {}){
    if (T.ColorManagement && 'legacyMode' in T.ColorManagement) T.ColorManagement.legacyMode = false;
    const grad = new T.DataTexture(new Uint8Array([140, 140, 140, 255, 200, 200, 200, 255, 255, 255, 255, 255]), 3, 1, T.RGBAFormat);
    grad.minFilter = grad.magFilter = T.NearestFilter; grad.needsUpdate = true;
    const mats = new Map(), geos = new Map(), texs = new Map(), emo = new Map();
    const cache = (m, k, f) => { let v = m.get(k); if (!v) { v = f(); m.set(k, v); } return v; };
    const Q = ['low', 'mid', 'high'].includes(ko.q) ? ko.q : autoQ(), QF = { low: .72, mid: 1, high: 1.35 }[Q] || 1;
    let DQ = QF;   // подробность сборки (дальний человечек — грубее)
    const sg = (n, min = 3, r = 1) => Math.max(min, Math.round(n * (r < .1 ? Math.min(DQ, 1) : DQ)));   // мелочь — не дробнее «среднего»
    const toon = (c, ds) => cache(mats, 't' + c + (ds ? 'd' : ''), () => new T.MeshToonMaterial({ color: c, gradientMap: grad, side: ds ? T.DoubleSide : T.FrontSide }));
    const basic = (c, op) => cache(mats, 'b' + c + (op || ''), () => new T.MeshBasicMaterial(op ? { color: c, transparent: true, opacity: op, depthWrite: false } : { color: c }));
    const geo = (k, f) => cache(geos, k, f);
    const f3 = v => (+v).toFixed(3);
    const sph = (r, w = 16, h = 12) => { const W = sg(w, 6, r), H = sg(h, 4, r); return geo(`s${f3(r)}_${W}_${H}`, () => new T.SphereGeometry(r, W, H)); };
    const cap = (r, l, rs = 12) => { const S = sg(rs, 5, r), C = Math.max(2, Math.round(4 * Math.min(DQ, r < .1 ? 1 : DQ))); return geo(`c${f3(r)}_${f3(l)}_${S}_${C}`, () => new T.CapsuleGeometry(r, Math.max(.001, l), C, S)); };
    const cone = (r, h, s = 12) => { const S = sg(s, 4, r); return geo(`k${f3(r)}_${f3(h)}_${S}`, () => new T.ConeGeometry(r, h, S)); };
    const cyl = (r1, r2, h, s = 16, open) => { const S = sg(s, 5, Math.max(r1, r2)); return geo(`y${f3(r1)}_${f3(r2)}_${f3(h)}_${S}_${open ? 1 : 0}`, () => new T.CylinderGeometry(r1, r2, h, S, 1, !!open)); };
    const tor = (r, t, rs, ts, arc = TAU) => { const A = sg(rs, 3, t * 3), B2 = sg(ts, 4, r); return geo(`o${f3(r)}_${f3(t)}_${A}_${B2}_${f3(arc)}`, () => new T.TorusGeometry(r, t, A, B2, arc)); };
    const box = (x, y, z) => geo(`x${f3(x)}_${f3(y)}_${f3(z)}`, () => new T.BoxGeometry(x, y, z));
    // Тело по сечениям: rows [[полуширина, полуглубина, y], …] снизу вверх, сечение — суперэллипс степени p (2 — эллипс,
    // 5…8 — скруглённый квадрат); a0…a1 — дуга (вся — замкнутый шов с общей нормалью). Полюса (ширина ≈ 0) — нормаль вверх/вниз
    function sweepGeo(rows, p, S, a0 = 0, a1 = TAU){
      const n = rows.length, C = S + 1, full = a1 - a0 >= TAU - 1e-6, e = 2 / p;
      const pos = new Float32Array(n * C * 3), uv = new Float32Array(n * C * 2), idx = [];
      const y0 = rows[0][2], y1 = rows[n - 1][2] - y0 || 1;
      for (let i = 0; i < n; i++) {
        const w = rows[i][0], d = rows[i][1], y = rows[i][2];
        for (let j = 0; j < C; j++) {
          const a = a0 + (full ? (j % S) / S : j / S) * (a1 - a0), c = Math.cos(a), s = Math.sin(a), k = i * C + j;
          pos[k * 3] = w * Math.sign(c) * Math.pow(Math.abs(c), e); pos[k * 3 + 1] = y; pos[k * 3 + 2] = d * Math.sign(s) * Math.pow(Math.abs(s), e);
          uv[k * 2] = j / S; uv[k * 2 + 1] = (y - y0) / y1;
        }
      }
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < S; j++) { const a = i * C + j, b = a + C; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2)); g.setIndex(idx);
      g.computeVertexNormals();
      const N = g.attributes.normal.array;
      for (let i = 0; i < n; i++) {
        const pole = rows[i][0] < .002 && rows[i][1] < .002 && (i === 0 || i === n - 1);
        if (pole) { for (let j = 0; j < C; j++) { const k = (i * C + j) * 3; N[k] = 0; N[k + 1] = i ? 1 : -1; N[k + 2] = 0; } continue; }
        if (!full) continue;
        const a = i * C * 3, b = (i * C + S) * 3;
        let x = N[a] + N[b], y = N[a + 1] + N[b + 1], z = N[a + 2] + N[b + 2]; const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
        N[a] = N[b] = x; N[a + 1] = N[b + 1] = y; N[a + 2] = N[b + 2] = z;
      }
      g.computeBoundingSphere();
      return g;
    }
    // Скруглённый брусок: полуразмеры, радиус скругления торцов, m — колец на скругление
    function rboxRows(hw, hh, hd, rr, m){
      rr = Math.min(rr, hw * .95, hh * .95, hd * .95);
      const rows = [[.001, .001, -hh]];
      for (let k = 0; k <= m; k++) { const a = -PI / 2 + k / m * PI / 2, q = rr * (1 - Math.cos(a)); rows.push([Math.max(.001, hw - q), Math.max(.001, hd - q), -hh + rr + rr * Math.sin(a)]); }
      for (let k = 0; k <= m; k++) { const a = k / m * PI / 2, q = rr * (1 - Math.cos(a)); rows.push([Math.max(.001, hw - q), Math.max(.001, hd - q), hh - rr + rr * Math.sin(a)]); }
      rows.push([.001, .001, hh]);
      return rows;
    }
    const rbox = (w, h, d, r, p = 6, s = 14) => { const S = sg(s, 6), m = Math.max(1, Math.round(2 * DQ)); return geo(`rb${f3(w)}_${f3(h)}_${f3(d)}_${f3(r)}_${p}_${S}_${m}`, () => sweepGeo(rboxRows(w / 2, h / 2, d / 2, r, m), p, S)); };
    // Подошва: плоская плитка со скруглённым краем (след ноги — суперэллипс)
    const sole = (w, l, h, p = 2.6) => { const S = sg(18, 8); return geo(`sole${f3(w)}_${f3(l)}_${f3(h)}_${p}_${S}`, () => sweepGeo([[.001, .001, -h / 2], [w * .9, l * .93, -h / 2], [w, l, -h / 2 + h * .32], [w, l, h / 2 - h * .25], [w * .94, l * .96, h / 2], [.001, .001, h / 2]], p, S)); };
    function heartShape(){ const s = new T.Shape(); s.moveTo(0, -.42); s.bezierCurveTo(-.12, -.3, -.5, -.08, -.5, .16); s.bezierCurveTo(-.5, .42, -.16, .5, 0, .28); s.bezierCurveTo(.16, .5, .5, .42, .5, .16); s.bezierCurveTo(.5, -.08, .12, -.3, 0, -.42); return s; }
    function starShape(){ const s = new T.Shape(); for (let i = 0; i <= 10; i++) { const a = PI / 2 + i * PI / 5, r = i % 2 ? .21 : .5; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r); } return s; }
    const flat = (name, depth = .14) => geo('sh' + name + depth, () => { const g = new T.ExtrudeGeometry(name === 'heart' ? heartShape() : starShape(), { depth, bevelEnabled: true, bevelThickness: depth * .35, bevelSize: .04, bevelSegments: 2, curveSegments: 8 }); g.center(); return g; });
    function canvasTex(k, w, h, draw){
      return cache(texs, k, () => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t; });
    }
    // Ткань одежды: обычный цвет или особые (радуга, космос, золото)
    function cloth(id, hex, ds){
      const side = ds ? T.DoubleSide : T.FrontSide;
      if (id === 'rainbow') return cache(mats, 'top:rainbow' + (ds ? 'd' : ''), () => new T.MeshToonMaterial({ gradientMap: grad, side, map: canvasTex('rainbow', 4, 64, (g, w, h) => { for (let i = 0; i < h; i++) { g.fillStyle = `hsl(${Math.round(i / h * 330)},90%,62%)`; g.fillRect(0, i, w, 1); } }) }));
      if (id === 'galaxy') return cache(mats, 'top:galaxy' + (ds ? 'd' : ''), () => new T.MeshToonMaterial({ gradientMap: grad, side, emissive: new T.Color('#1d1450'), map: canvasTex('galaxy', 64, 64, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#2b1f7a'); gr.addColorStop(.5, '#4a2a9c'); gr.addColorStop(1, '#1b1450'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
        let s = 7; for (let i = 0; i < 46; i++) { s = (s * 16807) % 2147483647; const x = s % w; s = (s * 16807) % 2147483647; const y = s % h; g.fillStyle = i % 5 ? 'rgba(255,255,255,.85)' : '#ffd6ff'; g.fillRect(x, y, i % 7 ? 1 : 2, i % 7 ? 1 : 2); }
      }) }));
      if (id === 'gold') return cache(mats, 'top:gold' + (ds ? 'd' : ''), () => new T.MeshPhongMaterial({ color: '#e6ad1f', specular: '#fff2c0', shininess: 70, emissive: '#3a2600', side }));
      return toon(hex, ds);
    }
    const emojiTex = e => cache(emo, e, () => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'); g.font = '104px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#000'; g.fillText(e, 64, 70);
      const tx = new T.CanvasTexture(c); tx.encoding = T.sRGBEncoding; return tx;
    });
    function emojiSprite(e, size){
      const s = new T.Sprite(new T.SpriteMaterial({ map: emojiTex(e), transparent: true, depthWrite: false }));
      s.scale.set(size, size, size);
      return s;
    }
    // «Краски»: цвет — в вершинах, материал общий на всех: t — мультяшный, d — он же с двух сторон, m — металл, b — без света
    // g — кристалл (грани, блик, лёгкое свечение)
    const vcMat = cls => cache(mats, 'vc' + cls, () => {
      const m = cls === 'm' ? new T.MeshPhongMaterial({ vertexColors: true, specular: '#8d96a3', shininess: 48 })
        : cls === 'g' ? new T.MeshPhongMaterial({ vertexColors: true, flatShading: true, specular: '#ffffff', shininess: 120, emissive: new T.Color('#3a1a7a'), emissiveIntensity: .55 })
        : cls === 'b' ? new T.MeshBasicMaterial({ vertexColors: true })
        : new T.MeshToonMaterial({ vertexColors: true, gradientMap: grad, side: cls === 'd' ? T.DoubleSide : T.FrontSide });
      m.userData.vc = cls;
      return m;
    });
    function M(parent, g, m, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0){
      const paint = m && m.paint ? m : null;
      const o = new T.Mesh(g, paint ? vcMat(paint.cls) : m);
      if (paint) o.userData.paint = paint;
      o.position.set(x, y, z);
      if (sx !== 1 || sy !== 1 || sz !== 1) o.scale.set(sx, sy, sz);
      if (rx || ry || rz) o.rotation.set(rx, ry, rz);
      parent.add(o);
      return o;
    }
    const G = (parent, x = 0, y = 0, z = 0) => { const g = new T.Group(); g.position.set(x, y, z); parent.add(g); return g; };
    // Кость: двигается сама (анимация) или прячется целиком (наборы выражений) — склеивается отдельно от родителя
    const B = (parent, x = 0, y = 0, z = 0, part) => { const g = G(parent, x, y, z); g.userData.bone = true; if (part) g.userData.part = part; return g; };
    // ── Склейка кости: меши (и в статичных подгруппах) с одним материалом → одна индексированная геометрия; у красок —
    //    цвет в вершинах и диапазоны для перекраски (ch.ranges). Зеркальные (масштаб −1) — с перевёрнутым обходом
    const _n3 = new T.Matrix3(), _v = new T.Vector3(), _c = new T.Color(), linC = new Map();
    function linear(hex){ let c = linC.get(hex); if (!c) { _c.set(hex); c = [_c.r, _c.g, _c.b]; linC.set(hex, c); } return c; }
    function merge(list, mat, ch){
      const vc = !!mat.vertexColors;
      let nv = 0, ni = 0;
      for (const [o] of list) { const g = o.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = vc ? new Float32Array(nv * 3) : null, uv = vc ? null : new Float32Array(nv * 2);
      const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), mg = new T.BufferGeometry();
      let v0 = 0, i0 = 0;
      for (const [o, m] of list) {
        const g = o.geometry, pa = g.attributes.position, na = g.attributes.normal, n = pa.count;
        _n3.getNormalMatrix(m);
        for (let k = 0; k < n; k++) {
          const q = (v0 + k) * 3;
          _v.fromBufferAttribute(pa, k).applyMatrix4(m); pos[q] = _v.x; pos[q + 1] = _v.y; pos[q + 2] = _v.z;
          if (na) { _v.fromBufferAttribute(na, k).applyMatrix3(_n3).normalize(); nor[q] = _v.x; nor[q + 1] = _v.y; nor[q + 2] = _v.z; }
        }
        if (uv && g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, n * 2), v0 * 2);
        const fl = m.determinant() < 0, a1 = fl ? 2 : 1, a2 = fl ? 1 : 2;
        if (g.index) { const I = g.index.array; for (let k = 0; k < I.length; k += 3) { idx[i0 + k] = I[k] + v0; idx[i0 + k + 1] = I[k + a1] + v0; idx[i0 + k + 2] = I[k + a2] + v0; } i0 += I.length; }
        else { for (let k = 0; k < n; k += 3) { idx[i0 + k] = v0 + k; idx[i0 + k + 1] = v0 + k + a1; idx[i0 + k + 2] = v0 + k + a2; } i0 += n; }
        if (col) {
          const p = o.userData.paint, fn = typeof p.col === 'function', c = linear(fn ? p.col(ch.R) : p.col);
          for (let k = 0; k < n; k++) { const q = (v0 + k) * 3; col[q] = c[0]; col[q + 1] = c[1]; col[q + 2] = c[2]; }
          if (fn) ch.ranges.push({ g: mg, a: v0, n, col: p.col });
        }
        v0 += n;
      }
      mg.setAttribute('position', new T.BufferAttribute(pos, 3));
      mg.setAttribute('normal', new T.BufferAttribute(nor, 3));
      if (col) mg.setAttribute('color', new T.BufferAttribute(col, 3));
      if (uv) mg.setAttribute('uv', new T.BufferAttribute(uv, 2));
      mg.setIndex(new T.BufferAttribute(idx, 1));
      mg.computeBoundingSphere();
      return mg;
    }
    function bake(bone, ch){
      if (bone.userData.baked) return;
      bone.userData.baked = true;
      const by = new Map(), order = [];
      const walk = (node, mat) => {
        for (const o of node.children.slice()) {
          if (o.userData.bone) { bake(o, ch); continue; }
          o.updateMatrix();
          const m = mat ? new T.Matrix4().multiplyMatrices(mat, o.matrix) : o.matrix.clone();
          if (o.isMesh && !o.userData.keep) { let l = by.get(o.material); if (!l) { by.set(o.material, l = []); order.push(o.material); } l.push([o, m]); }
          else if (o.isGroup) walk(o, m);
        }
      };
      walk(bone, null);
      for (const mat of order) {
        const list = by.get(mat);
        if (list.length < 2 && !list[0][0].userData.paint) continue;   // один обычный меш — как есть
        const mesh = new T.Mesh(merge(list, mat, ch), mat);
        mesh.userData.own = true;
        for (const [o] of list) o.parent.remove(o);
        bone.add(mesh);
      }
      const prune = node => { for (const o of node.children.slice()) if (o.isGroup && !o.userData.bone) { prune(o); if (!o.children.length && !o.userData.anchor) node.remove(o); } };
      prune(bone);
    }

    const gold = ds => cache(mats, 'gold' + (ds ? 'd' : ''), () => new T.MeshPhongMaterial({ color: '#f2b91e', specular: '#fff2c0', shininess: 80, emissive: '#3a2600', side: ds ? T.DoubleSide : T.FrontSide }));
    // ── Сборка человечка ──
    function build(look, key, bo = {}){
      const R = resolve(look, key), lod = bo.lod ? 1 : 0, d0 = DQ;
      DQ = QF * (lod ? .55 : 1);
      try { return assemble(R, key, lod); } finally { DQ = d0; }
    }
    function assemble(R, key, lod){
      const girl = R.body === 'girl', hi = !lod && Q !== 'low';   // мелочи (ресницы, шнурки, пуговицы…) — только вблизи
      // все поля — сразу одним объектом: числа анимации пишутся каждый кадр, объект не должен уйти в «словарь» (иначе мусор)
      const ch = { R, key, lod, ranges: [], own: [], anims: [], sets: new Map(), eyes: [], seed: (hash(key || 'x') % 997) / 158.7 + .5,
        root: null, body: null, torso: null, headP: null, head: null, legL: null, legR: null, kneeL: null, kneeR: null, armL: null, armR: null, elbowL: null, elbowR: null, handL: null, handR: null,
        face: null, faceSet: null, expr: 'base', mkSet: null, blink: false, pet: null, top: 2.3, headY: 1.6, hipY: .52, hs: 1,
        yaw: 0.5, phase: Math.random() * 6 + .5, blinkAt: Math.random() * 4 + .5, emote: null, emoteT: 0.5,
        P: REST.slice(), Pt: REST.slice(), Ps: REST.slice(), cat: 0, xf: 1.5, xd: .2, wMove: 0.5, wRun: 0.5, land: 0.5, lookX: 0.5, lookY: 0.5, cw: 0.5,
        phS: null, ph: null, phC: null, phWant: null, phD: null, handC: '' };   // телефон: состояние, корпус в руке, калибровка, что нужно, размеры, цвет кисти
      ch.yaw = 0; ch.emoteT = 0; ch.wMove = 0; ch.wRun = 0; ch.land = 0; ch.lookX = 0; ch.lookY = 0; ch.cw = 0; ch.xf = 1;
      const anims = ch.anims, rainbow = [];
      // краски: P(цвет | X => цвет, класс); PS — из слота палитры; acc — у аксессуара «как задумано» = свой цвет вещи
      const P = (col, cls) => ({ paint: 1, cls: cls || 't', col });
      const PS = (slot, fn, cls) => P(fn ? X => fn(colorOf(X, slot)) : X => colorOf(X, slot), cls);
      const tn = (c, ds) => P(c, ds ? 'd' : 't');
      const acc = (slot, def, fn, ds) => P(X => { const c = X[slot] === 'auto' ? def : colorOf(X, slot); return fn ? fn(c) : c; }, ds ? 'd' : 't');
      const skin = part => R[PARTS3[part][1]] === 'auto' && R.tone === 'goldskin' && !isArmor(R[PARTS3[part][0]]) ? gold() : P(X => partCol(X, part));
      const metal = (part, fn) => P(X => fn ? fn(partCol(X, part)) : partCol(X, part), 'm');
      const topC = colorOf(R, 'color'), special = SPECIAL.color.includes(R.color);
      const topM = special ? cloth(R.color, topC) : PS('color'), topDS = special ? cloth(R.color, topC, 1) : PS('color', null, 'd'), topD = PS('color', c => shade(c, -.25));
      const trimM = def => acc('trim', def);
      const botM = PS('botc'), botDS = PS('botc', null, 'd'), botD = PS('botc', c => shade(c, -.2)), botL = PS('botc', c => shade(c, .3));
      const shoeM = PS('shoec');
      const whiteM = tn('#f4f5f7'), blackM = tn('#1f1f27'), eyeDark = tn('#2a1c17'), whiteB = P('#ffffff', 'b');
      const hairMat = ds => {
        if (R.hairc === 'neon') return cache(mats, 'hair:neon' + (ds ? 'd' : ''), () => new T.MeshToonMaterial({ color: '#ff4fd8', emissive: new T.Color('#b0208f'), gradientMap: grad, side: ds ? T.DoubleSide : T.FrontSide }));
        if (R.hairc === 'rainbow') { const m = new T.MeshToonMaterial({ color: '#ff4d6d', gradientMap: grad, side: ds ? T.DoubleSide : T.FrontSide }); m.userData = { own: true }; rainbow.push(m); ch.own.push(m); return m; }
        return PS('hairc', null, ds ? 'd' : 't');
      };
      const hairM = hairMat(false), hairDS = hairMat(true), browM = PS('hairc', c => shade(c, -.3));
      const glowEyes = R.eyec === 'glow' || R.eyec === 'fire';
      const irisM = glowEyes ? P(X => colorOf(X, 'eyec'), 'b') : PS('eyec'), irisL = glowEyes ? irisM : PS('eyec', c => shade(c, .38));
      if (rainbow.length) anims.push(t => { for (let i = 0; i < rainbow.length; i++) rainbow[i].color.setHSL((t * .12) % 1, .75, .6); });
      // ── размеры (как раньше: части тела меняют обхват, не рост — места крепления и высота те же)
      const kh = (+R.hgt - 2) || 0, kw = (+R.wid - 2) || 0, kd = (+R.head - 2) || 0;
      const ls = 1 + .13 * kh, ts = 1 + .07 * kh, tw = 1 + .1 * kw, lw = 1 + .07 * kw, hs = 1 + .085 * kd;
      const hipY = .52 * ls, rT = .33 * tw * (girl ? .94 : 1), Th = .86 * ts, yB = -.12, yT = yB + Th;
      const shT = R.pst, armT = isArmor(shT);
      const dressOn = R.top === 'dress' && !armT, skirt = !dressOn && R.bottom === 'skirt', bare = dressOn || skirt, shorts = !dressOn && R.bottom === 'shorts';
      const root = new T.Group(), body = B(root);
      const shadow = M(root, geo('shadow', () => new T.CircleGeometry(.55, 24)), basic('#000000', .22), 0, .02, 0, tw, 1, tw, -PI / 2);
      shadow.userData.keep = true;

      // ── туловище: форма (сечения) + места крепления (ширина/глубина на высоте f)
      const prof0 = PROF[girl ? 'girl' : 'boy'];
      const TD = (() => {
        if (shT === 'block' || shT === 'robot') {
          const hw = rT * (shT === 'robot' ? 1.04 : 1.0), hd = rT * (shT === 'robot' ? .74 : .66), m = Math.max(1, Math.round(2 * DQ)), rr = .085;
          const rows = rboxRows(hw, Th / 2, hd, rr, m).map(([w, d, y]) => [w, d, y + yB + Th / 2]);
          return { rows, p: shT === 'robot' ? 7 : 5, w: () => hw, d: () => hd, box: 1 };
        }
        let prof = prof0, kx = 1, kz = .84, p = 2;
        if (shT === 'slim') { kx = .86; kz = .8; }
        else if (shT === 'chunky') { prof = PROF.chunky; kx = 1.07; kz = .8; }
        else if (shT === 'knight') { prof = PROF.boy; kx = 1.08; kz = .86; p = 2.3; }
        const sp = smoothProf(prof, DQ > 1.2 ? 3 : DQ > .85 ? 2 : 1);
        return { rows: sp.map(([r, f]) => [Math.max(.001, r * rT * kx), Math.max(.001, r * rT * kx * kz), yB + f * Th]), p, w: f => rAt(prof, f) * rT * kx, d: f => rAt(prof, f) * rT * kx * kz };
      })();
      const yAt = f => yB + f * Th, zAt = (f, d = 0) => TD.d(f) + d;
      const torso = B(body, 0, hipY, 0, 'torso');
      const tKey = `${shT}${girl ? 1 : 0}_${f3(rT)}_${f3(Th)}_${f3(DQ)}`;
      const torsoGeo = (k, a0, a1, cut) => geo(`tor:${tKey}_${f3(k)}_${f3(a0 || 0)}_${f3(a1 || TAU)}_${cut ? 1 : 0}`, () => sweepGeo((cut ? TD.rows.slice(1, -2) : TD.rows).map(([w, d, y]) => [w * k, d * k, y]), TD.p, sg(22, 10), a0, a1));
      // полоса по форме туловища (пояс, полоски, кайма): от f0 до f1, раздута на k
      const band = (f0, f1, k) => geo(`band:${tKey}_${f3(f0)}_${f3(f1)}_${f3(k)}`, () => { const fs = [f0, f0 + (f1 - f0) * .25, f1 - (f1 - f0) * .25, f1], ks = [1, k, k, 1]; return sweepGeo(fs.map((f, i) => [TD.w(f) * ks[i], TD.d(f) * ks[i], yAt(f)]), TD.p, sg(22, 10)); });
      // шея — цвета туловища (видна, когда голова поворачивается)
      if (!armT) M(torso, cyl(.12 * tw, .13 * tw, .16, 14), skin('torso'), 0, yT - .02, 0);
      if (!armT) {
        const shell = ['jacket', 'suit'].includes(R.top);
        M(torso, torsoGeo(1), shell ? trimM('#f4f5f7') : topM);
        if (shell) { const op = R.top === 'suit' ? .32 : .42; M(torso, torsoGeo(1.07, PI / 2 + op, PI / 2 + TAU - op, 1), topDS); }
        if (R.top === 'hoodie') {
          M(torso, tor(.21 * tw, .09, 8, 22, PI * 1.3), topM, 0, yT - .07, -.05, 1, 1, 1, -PI / 2 + .25, 0, PI * 1.85);
          M(torso, sph(.17, 16, 10), topD, 0, yAt(.27), zAt(.27, -.045), 1.15 * tw, .5, .3);
          if (hi) { const sm = trimM('#f4f5f7'); for (const s of [-1, 1]) { M(torso, cyl(.015, .015, .2, 6), sm, s * .075, yAt(.78) - .08, zAt(.78, .005)); M(torso, sph(.024, 8, 6), sm, s * .075, yAt(.78) - .18, zAt(.7, .01)); } }
        } else if (R.top === 'tshirt') {
          M(torso, tor(.16 * tw, .026, 6, 22), P(X => X.trim === 'auto' ? shade(colorOf(X, 'color'), -.25) : colorOf(X, 'trim')), 0, yT - .045, 0, 1, .84, 1, PI / 2);
        } else if (R.top === 'sweater') {
          const stripe = P(X => X.trim !== 'auto' ? colorOf(X, 'trim') : light(colorOf(X, 'color')) ? shade(colorOf(X, 'color'), -.25) : '#f4f5f7');
          for (const f of [.42, .55]) M(torso, band(f - .03, f + .03, 1.02), stripe);
          M(torso, cyl(.17 * tw, .19 * tw, .1, 18), topD, 0, yT - .03, 0, 1, 1, .9);
        } else if (R.top === 'jersey') {
          for (const s of [-1, 1]) M(torso, box(.03, .17, .02), trimM('#f4f5f7'), s * .045, yT - .1, zAt(.9, -.005), 1, 1, 1, -.35, 0, s * .45);
          const num = canvasTex('jersey37', 128, 128, (g, w, h) => {
            g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
            g.font = '900 22px Montserrat, Arial, sans-serif'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.45)'; g.strokeText('DAN4IK', 64, 26); g.fillStyle = '#fff'; g.fillText('DAN4IK', 64, 26);
            g.font = '900 72px Oswald, Montserrat, Arial, sans-serif'; g.lineWidth = 8; g.strokeText('37', 64, 84); g.fillText('37', 64, 84);
          });
          const dm = cache(mats, 'jersey37', () => new T.MeshBasicMaterial({ map: num, transparent: true, depthWrite: false }));
          const bw = TD.w(.55) * 1.01, bd = TD.d(.55) * 1.01;
          const d = M(torso, geo(`jback${f3(bw)}_${f3(bd)}`, () => { const g = new T.CylinderGeometry(1, 1, .44, 16, 1, true, PI - .75, 1.5); g.scale(bw, 1, bd); return g; }), dm, 0, yAt(.55), 0);
          d.userData.keep = true;
        } else if (R.top === 'suit') {
          const tm = acc('neckc', '#d6213f');
          M(torso, box(.09, .05, .03), tm, 0, yT - .1, zAt(.9, .0));
          M(torso, geo('tieblade', () => new T.CylinderGeometry(.04, .065, .34, 4)), tm, 0, yAt(.6), zAt(.6, .005), 1, 1, .35, -.12, PI / 4, 0);
          if (hi) for (const f of [.42, .28]) M(torso, sph(.018, 8, 6), topD, .07, yAt(f), zAt(f, .02));
        } else if (R.top === 'jacket') {
          M(torso, tor(.19 * tw, .045, 6, 22, PI * 1.4), topD, 0, yT - .04, -.02, 1, 1, 1, -PI / 2 + .3, 0, PI * 1.8);
          M(torso, box(.025, Th * .55, .02), tn('#c9ccd3'), .1, yAt(.5), zAt(.5, -.01));
        } else if (dressOn) {
          M(torso, band(.06, .14, 1.025), trimM('#f4f5f7'));
          M(torso, tor(.15 * tw, .024, 6, 22), trimM('#f4f5f7'), 0, yT - .045, 0, 1, .84, 1, PI / 2);
        }
        if (shT === 'chunky') for (const s of [-1, 1]) M(torso, sph(.13 * tw, 14, 10), topM, s * .1 * tw, yAt(.7), zAt(.7, -.06), 1.15, .75, .55);   // грудь силача
      } else if (shT === 'robot') {   // корпус робота: стальной ящик, экран с огоньками, пояс-шарнир
        const mm = metal('torso'), dk = metal('torso', c => shade(c, -.38));
        M(torso, torsoGeo(1), mm);
        M(torso, rbox(TD.w() * 1.1, .1, TD.d() * 1.12, .04, 8), dk, 0, yAt(.08), 0);
        M(torso, rbox(.3 * tw, .2, .04, .03, 8), tn('#1b2330'), 0, yAt(.62), TD.d() + .005);
        const ledC = ['#3ee8ff', '#7cf29c', '#ffcc33'];
        for (let i = 0; i < 3; i++) M(torso, sph(.022, 8, 6), P(ledC[i], 'b'), (i - 1) * .075, yAt(.62), TD.d() + .03, 1, 1, .5);
        if (hi) for (const s of [-1, 1]) for (const f of [.25, .85]) M(torso, sph(.018, 6, 4), dk, s * TD.w() * .78, yAt(f), TD.d() + .002);
        M(torso, cyl(.13 * tw, .15 * tw, .12, 14), dk, 0, yT, 0);   // шея-шарнир
      } else {   // кираса рыцаря: латы, ребро посередине, золотая кайма, юбка-пластины
        const mm = metal('torso'), gd = tn('#e1b63e');
        M(torso, torsoGeo(1), mm);
        M(torso, box(.035, Th * .7, .04), metal('torso', c => shade(c, .15)), 0, yAt(.55), zAt(.55, .0));
        M(torso, band(.04, .11, 1.04), gd);
        M(torso, tor(.17 * tw, .03, 6, 22), gd, 0, yT - .03, 0, 1, .86, 1, PI / 2);
        M(torso, cyl(.12 * tw, .13 * tw, .16, 14), tn('#5b6370'), 0, yT - .02, 0);   // кольчужный ворот
      }

      // ── таз и юбки (на теле — не поворачиваются с туловищем)
      const flare = (m, y0, y1, r0, r1) => {
        const pts = [[r0, y0], [r0 * 1.04, y0 - (y0 - y1) * .3], [r1 * .97, y1 + .03], [r1, y1]].map(([r, y]) => new T.Vector2(r, y));
        const S = sg(22, 10);
        M(body, geo(`flare${f3(y0)}_${f3(y1)}_${f3(r0)}_${f3(r1)}_${S}`, () => new T.LatheGeometry(pts.slice().reverse(), S)), m, 0, 0, 0, 1, 1, .9);
      };
      if (shT === 'robot') M(body, rbox(rT * 1.6, .2, rT * 1.2, .06, 8), metal('torso', c => shade(c, -.38)), 0, hipY - .04, 0);
      else if (shT === 'knight') {
        const mm = metal('torso', c => shade(c, -.08));
        for (let i = 0; i < 3; i++) M(body, cyl(rT * (1.0 + i * .06), rT * (1.06 + i * .06), .07, 18, true), P(X => shade(partCol(X, 'torso'), -.08 - i * .05), 'm'), 0, hipY - .02 - i * .065, 0, 1, 1, .9);
        M(body, sph(rT * .97, 18, 12), mm, 0, hipY - .03, 0, 1, .5, .84);
      } else if (!bare) {
        if (TD.box) M(body, rbox(rT * 2.0, .2, rT * 1.32, .07), botM, 0, hipY - .04, 0);
        else M(body, sph(rT * .97, 18, 12), botM, 0, hipY - .03, 0, 1, .52, .84);
      }
      if (skirt) { flare(botDS, hipY + .05, hipY - .3, rT * 1.0, rT * 1.45); M(body, tor(rT * .99, .03, 6, 22), botD, 0, hipY + .05, 0, 1, .9, 1, PI / 2); }
      if (dressOn) flare(topDS, hipY - .02, hipY - .36, rT * .95, rT * 1.5);

      // ── ноги: бедро (кость таза) → колено → стопа
      const kneeY = (.04 + (-hipY + .13)) / 2, ankY = -hipY + .13 - kneeY, footY = -hipY + .075 - kneeY;
      const segM = (g, r, y0, y1, m, blk) => blk ? M(g, rbox(r * 2.05, Math.max(.03, y0 - y1), r * 2.05, r * .6, 6, 12), m, 0, (y0 + y1) / 2, 0)
        : M(g, cap(r, Math.max(.001, y0 - y1 - 2 * r)), m, 0, (y0 + y1) / 2, 0);
      const shoe = (F, s, sw, blk) => {
        const soleM = P(X => X.shoes === 'kedy' || !light(colorOf(X, 'shoec')) ? '#f4f5f7' : '#dfe3ea');
        if (R.shoes === 'boots') {
          M(F, cyl(.125 * sw, .135 * sw, .2, 14), shoeM, 0, .1, -.03);
          M(F, blk ? rbox(.27 * sw, .17, .36, .06) : sph(.15, 16, 10), shoeM, 0, 0, 0, blk ? 1 : .9 * sw, blk ? 1 : .62, blk ? 1 : 1.22);
          M(F, sole(.145 * sw, .2, .05), tn('#3a2a20'), 0, -.055, .005);
          if (hi) M(F, box(.15 * sw, .05, .09), tn('#3a2a20'), 0, -.06, -.12);
        } else if (R.shoes === 'bunny') {
          M(F, sph(.17, 16, 12), shoeM, 0, .01, .01, sw, .72, 1.22);
          M(F, sole(.15 * sw, .2, .035), tn('#f9d3e0'), 0, -.075, .01);
          for (const e of [-1, 1]) M(F, cap(.035, .1, 8), shoeM, e * .055, .14, .1, 1, 1, 1, -.5, 0, e * .25);
          for (const e of [-1, 1]) M(F, sph(.018, 8, 6), blackM, e * .055, .07, .2);
          M(F, sph(.02, 8, 6), tn('#ff8fb0'), 0, .045, .215);
        } else {
          if (blk) M(F, rbox(.26 * sw, .15, .35, .06), shoeM, 0, .01, .005);
          else M(F, sph(.15, 18, 12), shoeM, 0, .015, 0, .86 * sw, .56, 1.2);
          M(F, sole(.14 * sw, .19, .05), soleM, 0, -.045, .005);
          if (R.shoes === 'kedy') M(F, sph(.1, 12, 8), whiteM, 0, -.005, .1, .85 * sw, .5, .7);
          else M(F, sph(.08, 10, 8), topM, s * .115 * sw, .005, -.01, .22, .45, .9);
          if (hi && R.shoes !== 'kedy') for (let i = 0; i < 3; i++) M(F, box(.07 * sw, .012, .018), whiteM, 0, .085 - i * .012, .025 + i * .045, 1, 1, 1, -.5 - i * .15, 0, 0);
          if (hi && R.shoes === 'kedy') for (let i = 0; i < 2; i++) M(F, box(.07 * sw, .012, .018), whiteM, 0, .07 - i * .01, .02 + i * .045, 1, 1, 1, -.4, 0, 0);
        }
      };
      function leg(s){
        const part = s < 0 ? 'legL' : 'legR', sh = R[PARTS3[part][0]];
        const hx = .155 * tw + (sh === 'chunky' ? .02 : sh === 'slim' ? -.012 : 0);
        const L = B(body, s * hx, hipY, 0, part), K = B(L, 0, kneeY, 0, part), F = G(K, 0, footY, .035);
        if (sh === 'robot') {
          const mm = metal(part), dk = metal(part, c => shade(c, -.38));
          M(L, sph(.105, 14, 10), dk, 0, .0, 0);
          M(L, cyl(.072, .08, -kneeY - .02, 14), mm, 0, kneeY / 2, 0);
          M(K, sph(.088, 14, 10), dk);
          M(K, cyl(.085, .1, -ankY - .04, 14), mm, 0, ankY / 2 - .01, 0);
          M(F, rbox(.22, .12, .32, .045, 8), mm, 0, .015, .01);
          M(F, rbox(.23, .04, .33, .015, 8), dk, 0, -.055, .01);
          if (hi) M(F, box(.12, .025, .02), P('#3ee8ff', 'b'), 0, .03, .175);
        } else if (sh === 'knight') {
          const mm = metal(part), gd = tn('#e1b63e');
          M(L, cap(.115 * lw, Math.max(.001, -kneeY - .2), 12), tn('#5b6370'), 0, kneeY / 2 + .01, 0);
          M(L, cyl(.13 * lw, .118 * lw, -kneeY - .02, 16), mm, 0, kneeY / 2 - .01, 0);
          M(K, sph(.1, 14, 10), mm, 0, 0, .02, 1, 1, 1.05);
          M(K, cone(.07, .09, 10), mm, 0, .0, .085, 1, 1, .5, PI / 2, 0, 0);
          M(K, cyl(.118 * lw, .108 * lw, -ankY - .02, 16), mm, 0, ankY / 2 - .01, 0);
          M(K, tor(.11 * lw, .014, 5, 16), gd, 0, ankY + .05, 0, 1, 1, 1, PI / 2);
          M(F, rbox(.25 * lw, .14, .36, .06, 6), mm, 0, .0, .01);
          M(F, cone(.07, .1, 8), mm, 0, -.01, .19, 1, 1, .7, PI / 2, 0, 0);
          M(F, sole(.13 * lw, .19, .035), tn('#3a3f48'), 0, -.07, .01);
        } else {
          const kr = sh === 'slim' ? .78 : sh === 'chunky' ? 1.28 : 1, blk = sh === 'block', sk = skin(part);
          const lr = .125 * lw * (girl ? .94 : 1) * kr, sw = lw * (sh === 'chunky' ? 1.1 : sh === 'slim' ? .92 : 1);
          if (bare) { segM(L, lr * .86, .04, kneeY - .04, sk, blk); segM(K, lr * .84, .04, ankY, sk, blk); }
          else if (shorts) {
            // шорты как раньше: широкие, ниже колена (голень при шаге выходит из штанины)
            M(L, blk ? rbox(lr * 2.3, .45, lr * 2.3, .06) : cap(lr * 1.08, .2), botM, 0, -.08, 0);
            segM(L, lr * .9, -.12, kneeY - .04, sk, blk); segM(K, lr * .88, .04, ankY, sk, blk);
          } else {
            segM(L, lr, .04, kneeY - .04, botM, blk); segM(K, lr * .97, .04, ankY, botM, blk);
            if (R.bottom === 'jeans' && hi) M(K, blk ? rbox(lr * 2.12, .05, lr * 2.12, .02) : tor(lr * 1.0, .028, 6, 18), botL, 0, ankY + .05, 0, 1, 1, 1, blk ? 0 : PI / 2);
            if (R.bottom === 'cargo') M(L, box(.07, .14, .13), botD, s * lr * .95, -hipY * .42, 0);
          }
          if (sh === 'chunky') M(K, sph(lr * .9, 12, 10), bare || shorts ? sk : botM, 0, ankY * .45, -lr * .3, 1, 1.25, .9);   // икра
          shoe(F, s, sw, blk);
        }
        return { L, K };
      }
      const legsLR = [leg(-1), leg(1)];

      // ── руки: плечо (кость туловища) → локоть → кисть; место крепления — по форме туловища
      const La = .42 * ts, Lu = La * .46, Lf = La - Lu - .03, shortS = ['tshirt', 'jersey', 'dress'].includes(R.top);
      const GLOVE = { wrist: '#f4f5f7', mitts: '#e23b4e', gloves: '#2b2b33', watch: '#2b2b33', boxing: '#d6213f' };
      const gloveM = acc('glovec', GLOVE[R.glove] || '#e23b4e');
      function hand(H, E, s, hr, m, blk){
        const g = R.glove, wrap = g === 'mitts' || g === 'gloves' || g === 'boxing', hm = wrap ? gloveM : m, k = g === 'boxing' ? 1.55 : g === 'mitts' ? 1.12 : g === 'gloves' ? 1.04 : 1;
        if (blk) {
          M(H, rbox(hr * 1.8 * k, hr * 1.9 * k, hr * 1.6 * k, hr * .45), hm);
          if (g !== 'boxing') M(H, rbox(hr * .62, hr * .9, hr * .62, hr * .25), hm, -s * hr * .95, hr * .25, hr * .3, 1, 1, 1, .2, 0, -s * .35);
        } else {
          M(H, sph(hr * k, 14, 10), hm, 0, 0, 0, .92, 1.08, .82);   // варежка
          if (g !== 'boxing' && DQ > .5) M(H, cap(hr * .32, hr * .5, 8), hm, -s * hr * .78, hr * .18, hr * .32, 1, 1, 1, .35, 0, -s * .55);   // большой палец
        }
        const wy = -Lf + hr * .95;   // запястье (в кости локтя)
        if (g === 'mitts') M(E, tor(hr * .78, hr * .22, 6, 16), whiteM, 0, wy, 0, 1, 1, 1, PI / 2);
        if (g === 'boxing') M(E, cyl(hr * .9, hr * .82, hr * .55, 14), whiteM, 0, wy - .01, 0);
        if (g === 'wrist') M(E, cyl(hr * .82, hr * .82, hr * .6, 14), gloveM, 0, wy + .01, 0);
        if (g === 'watch' && s < 0) { M(E, cyl(hr * .78, hr * .78, hr * .3, 14), gloveM, 0, wy + .01, 0); M(E, cyl(hr * .38, hr * .38, .03, 14), tn('#e9f1ff'), 0, wy + .01, hr * .78, 1, 1, 1, PI / 2, 0, 0); }
      }
      function arm(s){
        const part = s < 0 ? 'armL' : 'armR', sh = R[PARTS3[part][0]];
        const ar0 = .098 * lw, kr = sh === 'slim' ? .74 : sh === 'chunky' ? 1.3 : 1, ar = ar0 * kr;
        const shX = shT === 'base' && !TD.box ? rT * .93 + .035 : TD.w(.77) * (TD.box ? .98 : .97) + .035;
        const A = B(torso, s * (shX + (ar - ar0) * .7 + (isArmor(sh) ? .015 : 0)), yT - .2, 0, part);
        A.rotation.z = s * .16; A.userData.y0 = A.position.y;   // y0 — плечо на месте (поднять — SLY/SRY)
        const E = B(A, 0, -Lu, 0, part), H = G(E, 0, -Lf, 0);
        H.userData.anchor = true;   // точка кисти остаётся (в неё берут предметы)
        A.userData.La = La; A.userData.hand = H;   // как раньше: длина руки и кисть
        if (sh === 'robot') {
          const mm = metal(part), dk = metal(part, c => shade(c, -.38));
          M(A, sph(.112, 16, 12), dk, 0, -.01, 0);
          M(A, cyl(.066, .072, Lu - .04, 14), mm, 0, -Lu / 2, 0);
          M(E, sph(.08, 14, 10), dk);
          M(E, cyl(.09, .072, Lf - .05, 14), mm, 0, -(Lf - .05) / 2 - .02, 0);
          if (hi) M(E, box(.022, (Lf - .05) * .5, .012), P('#3ee8ff', 'b'), 0, -(Lf - .05) / 2 - .02, .088);
          M(H, rbox(.15, .1, .13, .03, 8), mm, 0, .03, 0);
          for (const k of [-1, 1]) M(H, rbox(.04, .12, .05, .015, 6), dk, k * .045, -.06, .02, 1, 1, 1, .15, 0, k * .1);
          M(H, rbox(.04, .09, .05, .015, 6), dk, -s * .08, -.02, .035, 1, 1, 1, .2, 0, -s * .5);
        } else if (sh === 'knight') {
          const mm = metal(part), gd = tn('#e1b63e');
          M(A, sph(.16, 16, 10), mm, s * .02, .02, 0, 1.1, .62, 1.08, 0, 0, s * -.3);   // наплечник
          M(A, tor(.12, .022, 5, 16, PI), gd, s * .02, -.02, 0, 1.15, 1, 1.05, 0, PI / 2, 0);
          M(A, cap(.09 * lw, Math.max(.001, Lu - .16), 12), tn('#5b6370'), 0, -Lu / 2, 0);
          M(E, sph(.08, 12, 10), mm, 0, 0, -.01, 1, 1, 1.1);
          M(E, cone(.05, .08, 8), mm, 0, 0, -.08, 1, 1, .5, -PI / 2, 0, 0);
          M(E, cyl(.095, .085, Lf - .06, 16), mm, 0, -(Lf - .06) / 2 - .02, 0);
          M(H, cyl(.08, .11, .07, 14), mm, 0, .06, 0);
          M(H, sph(.105, 14, 10), mm, 0, -.01, 0, .95, 1.05, .85);
          if (hi) for (let i = 0; i < 2; i++) M(H, tor(.07, .012, 4, 12, PI), gd, 0, -.03 - i * .035, .03, 1, 1, 1, 0, 0, PI);
        } else {
          const blk = sh === 'block', sk = skin(part), hr = .105 * lw * (sh === 'slim' ? .86 : sh === 'chunky' ? 1.22 : 1);
          const sleeve = armT ? 'none' : shortS ? 'short' : 'long';
          if (sleeve === 'none') { segM(A, ar * .92, .03, -Lu - .03, sk, blk); segM(E, ar * .88, .03, -Lf + hr * .3, sk, blk); }
          else if (sleeve === 'short') {
            if (dressOn) M(A, sph(ar * 1.45, 14, 10), topM, 0, -.06, 0);
            else M(A, blk ? rbox(ar * 2.3, .16, ar * 2.3, .05) : cap(ar * 1.1, .07), topM, 0, -.06, 0);
            segM(A, ar * .86, -.02, -Lu - .03, sk, blk); segM(E, ar * .84, .03, -Lf + hr * .3, sk, blk);
            if (R.top === 'jersey') M(A, blk ? rbox(ar * 2.35, .03, ar * 2.35, .01) : tor(ar * 1.08, .02, 6, 14), trimM('#f4f5f7'), 0, -.15, 0, 1, 1, 1, blk ? 0 : PI / 2);
          } else {
            segM(A, ar, .03, -Lu - .03, topM, blk); segM(E, ar * .96, .03, -Lf + hr * .5, topM, blk);
            const cy = -La + .14 + Lu;   // манжета — там же, где была
            if (R.top === 'sweater' || R.top === 'hoodie') M(E, blk ? rbox(ar * 2.1, .05, ar * 2.1, .02) : tor(ar * .95, .028, 6, 14), topD, 0, cy, 0, 1, 1, 1, blk ? 0 : PI / 2);
            if (R.top === 'suit') M(E, blk ? rbox(ar * 2.05, .04, ar * 2.05, .015) : tor(ar * .9, .022, 6, 14), trimM('#f4f5f7'), 0, -La + .11 + Lu, 0, 1, 1, 1, blk ? 0 : PI / 2);
          }
          if (sh === 'chunky') M(A, sph(ar * .78, 12, 10), sleeve === 'long' ? topM : sk, 0, -Lu * .45, ar * .3, 1, 1.15, 1);   // бицепс
          hand(H, E, s, hr, sk, blk);
        }
        return { A, E, H };
      }
      const armsLR = [arm(-1), arm(1)];

      // ── на шее (по форме туловища: шея, грудь)
      const yN = yT - .07;
      if (R.neck === 'bowtie') { const g = G(torso, 0, yN - .06, zAt(.88, .02)); for (const s of [-1, 1]) M(g, cone(.065, .12, 10), acc('neckc', '#e11d48'), s * .062, 0, 0, 1, 1, .6, 0, 0, s * PI / 2); M(g, sph(.034, 8, 6), acc('neckc', '#e11d48', c => shade(c, -.25))); }
      else if (R.neck === 'tie') { const tm = acc('neckc', '#2563eb'); M(torso, sph(.042, 10, 8), tm, 0, yN - .07, zAt(.9, .0)); M(torso, geo('tieblade', () => new T.CylinderGeometry(.04, .065, .34, 4)), tm, 0, yAt(.6), zAt(.6, .01), 1, 1, .35, -.12, PI / 4, 0); }
      else if (R.neck === 'scarf') {
        const sm = R.neckc !== 'auto' ? PS('neckc') : cache(mats, 'scarf', () => new T.MeshToonMaterial({ gradientMap: grad, map: canvasTex('scarf', 16, 16, (g) => { for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#fff4e6' : '#e0313f'; g.fillRect(i * 4, 0, 4, 16); } }) }));
        M(torso, tor(.23 * tw, .085, 10, 24), sm, 0, yN + .02, 0, 1, .9, 1, PI / 2);
        M(torso, box(.13, .32, .05), sm, .12 * tw, yN - .17, zAt(.82, .03), 1, 1, 1, -.2, 0, .1);
      } else if (R.neck === 'chain') {
        const cm = R.neckc === 'auto' ? gold() : PS('neckc');
        M(torso, tor(.22 * tw, .018, 6, 28), cm, 0, yN - .07, .05, 1, 1, 1, PI / 2 - .5);
        M(torso, cyl(.065, .065, .022, 18), cm, 0, yAt(.66), zAt(.66, .02), 1, 1, 1, PI / 2 - .15);
      }
      // ── на спине (по глубине туловища)
      const backZ = -TD.d(.55);
      if (R.back === 'backpack') {
        M(torso, sph(.27, 16, 12), acc('backc', '#f59e0b'), 0, yAt(.52), backZ - .1, 1.05 * tw, 1.15, .55);
        M(torso, sph(.17, 12, 10), acc('backc', '#f59e0b', c => shade(c, -.18)), 0, yAt(.36), backZ - .22, 1, .7, .4);
        for (const s of [-1, 1]) M(torso, cap(.028, .34, 6), tn('#7c4a12'), s * .15 * tw, yAt(.66), zAt(.66, .005), 1, 1, 1, -.15);
      } else if (R.back === 'guitar') {
        const g = G(torso, 0, yAt(.48), backZ - .07); g.rotation.z = .65;
        const gm = acc('backc', '#d23b3b');
        M(g, sph(.22, 16, 12), gm, 0, -.16, 0, 1, 1, .3); M(g, sph(.165, 16, 12), gm, 0, .14, 0, 1, 1, .3);
        M(g, geo('ghole', () => new T.CircleGeometry(.055, 14)), tn('#2b1a12'), 0, .0, -.068, 1, 1, 1, 0, PI, 0);
        M(g, box(.07, .55, .04), tn('#8b5a2b'), 0, .52, 0); M(g, box(.1, .15, .05), tn('#2b1a12'), 0, .84, 0);
        M(torso, box(.035, Th * 1.1, .02), tn('#3b2a1c'), 0, yAt(.55), zAt(.55, .01), 1, 1, 1, 0, 0, -.7);
      } else if (R.back === 'tail') {
        const g = B(torso, 0, yAt(.14), backZ + .05);
        const tm = R.backc === 'auto' ? hairM : PS('backc');
        for (let i = 0; i < 9; i++) { const k = i / 8; M(g, sph(.095 - k * .035, 10, 8), tm, 0, k * k * .62 - .06, -k * .5); }
        anims.push((t, dt, mv) => { g.rotation.y = Math.sin(t * (mv ? 9 : 2.6)) * (mv ? .45 : .3); g.rotation.x = -.15 + Math.sin(t * 1.3) * .08; });
      } else if (R.back === 'cape') {
        const g = B(torso, 0, yT - .1, backZ + .12);
        M(g, geo(`cape${f3(tw)}_${f3(hipY)}`, () => {
          const len = yT - .1 + hipY - .22, w = .74 * tw, pg = new T.PlaneGeometry(w, len, 6, 8), p = pg.attributes.position;
          for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), k = (len / 2 - y) / len, xx = x * (1 + k * .35); p.setXYZ(i, xx, y - len / 2, -(xx * xx) * .9 - k * .08); }
          pg.computeVertexNormals(); return pg;
        }), acc('backc', '#d62839', null, true));
        for (const s of [-1, 1]) M(torso, sph(.035, 8, 6), tn('#f2b91e'), s * .17 * tw, yT - .1, zAt(.85, .0));
        anims.push((t, dt, mv, s) => { g.rotation.x = mv ? .32 + s * .06 : .05 + Math.sin(t * 1.4) * .025; });
      } else if (R.back === 'wings' || R.back === 'batwings' || R.back === 'dragon') {
        const angel = R.back === 'wings', big = R.back === 'dragon' ? 1.35 : 1;
        const wdef = angel ? '#fbfbff' : R.back === 'dragon' ? '#1f9d78' : '#4a1f5c';
        const wm = acc('backc', wdef, null, true), bm = R.back === 'dragon' && R.backc === 'auto' ? tn('#f5c518') : acc('backc', wdef, c => shade(c, angel ? -.08 : -.35));
        const wings = [-1, 1].map(s => {
          const g = B(torso, s * .1, yAt(.66), backZ + .02);
          if (angel) for (let i = 0; i < 4; i++) M(g, sph(.26, 14, 10), wm, s * (.34 + i * .03), .14 - i * .15, -.02 * i, (1.35 - i * .2), .32, .12, 0, 0, s * (.42 - i * .25));
          else {
            M(g, geo('bwing', () => {
              const sh = new T.Shape(); sh.moveTo(0, .05); sh.lineTo(.42, .4); sh.lineTo(.78, .28); sh.quadraticCurveTo(.66, .14, .7, -.02); sh.quadraticCurveTo(.55, -.04, .5, -.16); sh.quadraticCurveTo(.36, -.12, .28, -.24); sh.quadraticCurveTo(.16, -.1, 0, -.12); sh.lineTo(0, .05);
              return new T.ShapeGeometry(sh, 6);
            }), wm, 0, 0, 0, s * big, big, 1);
            M(g, cap(.02, .5 * big, 6), bm, s * .21 * big, .22 * big, .005, 1, 1, 1, 0, 0, s * -1.0);
          }
          g.rotation.y = s * .55;
          return g;
        });
        anims.push((t, dt, mv) => { const f = Math.sin(t * (mv ? 7 : 2.2)) * (mv ? .32 : .14); wings[0].rotation.y = -.55 - f; wings[1].rotation.y = .55 + f; });
      } else if (R.back === 'gemwings') {   // кристальные крылья (только за 💎): веер граней-кристаллов, машут
        const gemG = geo('gemcut', () => new T.OctahedronGeometry(.5, 0)), GC = ['#7ef0ff', '#8cc8ff', '#b98cff', '#ff8ce6', '#c8a2ff'];
        const wings = [-1, 1].map(s => {
          const g = B(torso, s * .1, yAt(.66), backZ + .02);
          for (let i = 0; i < 5; i++) {
            const a = 1.1 - i * .38, len = (.62 - Math.abs(i - 1.2) * .07) * 1.35, cx = Math.cos(a) * len * .5, cy = Math.sin(a) * len * .5;
            M(g, gemG, R.backc === 'auto' ? P(GC[i], 'g') : PS('backc', c => shade(c, i * .08 - .1), 'g'), s * (.12 + cx), .08 + cy, -.03 * i, .12, len, .07, 0, 0, s * -(PI / 2 - a));
          }
          M(g, gemG, P('#ffffff', 'g'), s * .1, .06, .02, .09, .09, .09);
          g.rotation.y = s * .55;
          return g;
        });
        anims.push((t, dt, mv) => { const f = Math.sin(t * (mv ? 6 : 2)) * (mv ? .28 : .12); wings[0].rotation.y = -.55 - f; wings[1].rotation.y = .55 + f; });
      }

      // ── голова (кость шеи → центр головы; всё лицо — в единицах головы радиусом .56)
      const headSh = R.psh, HD = HEADS[headSh] || HEADS.round, robotH = headSh === 'robot', knightH = headSh === 'knight';
      const headP = B(torso, 0, yT - .06, 0, 'head'), hr = .56 * hs, head = B(headP, 0, hr * .86, 0, 'head');
      headP.rotation.order = 'YXZ';
      head.scale.setScalar(hs);
      const skH = skin('head'), headM = robotH || knightH ? metal('head') : skH;
      if (HD.k === 'ell') M(head, sph(.56, 30, 22), headM, 0, 0, 0, HD.s[0], HD.s[1], HD.s[2]);
      else if (HD.k === 'cyl') { const S = sg(30, 12), m = Math.max(2, Math.round(3 * DQ)); M(head, geo(`hcyl${S}_${m}`, () => sweepGeo(rboxRows(HD.r, HD.h, HD.r, HD.c, m), 2, S)), headM); }
      else { const S = sg(26, 10), m = Math.max(2, Math.round(3 * DQ)); M(head, geo(`hbox${headSh}${S}_${m}`, () => sweepGeo(rboxRows(HD.s[0], HD.s[1], HD.s[2], HD.c, m), HD.p, S)), headM); }
      if (HD.k === 'ell' && !knightH) for (const s of [-1, 1]) M(head, sph(.085, 10, 8), skH, s * .565 * HD.s[0] / 1.04, -.07, 0, .55, 1, .8);
      // точка на лице (x, y) → z и нормаль (общий объект — без мусора)
      const SF = { z: 0, nx: 0, ny: 0, nz: 1 };
      function surf(x, y){
        if (HD.k === 'ell') {
          const a = .56 * HD.s[0], b = .56 * HD.s[1], c = .56 * HD.s[2], q = Math.max(.02, 1 - x * x / (a * a) - y * y / (b * b));
          SF.z = c * Math.sqrt(q);
          const nx = x / (a * a), ny = y / (b * b), nz = SF.z / (c * c), l = Math.hypot(nx, ny, nz) || 1;
          SF.nx = nx / l; SF.ny = ny / l; SF.nz = nz / l;
        } else if (HD.k === 'cyl') { const r = HD.r; SF.z = Math.sqrt(Math.max(.001, r * r - x * x)); SF.nx = x / r; SF.ny = 0; SF.nz = SF.z / r; }
        else { SF.z = HD.s[2]; SF.nx = 0; SF.ny = 0; SF.nz = 1; }
        return SF;
      }
      // поставить деталь лица: в точку (x, y) на d над кожей, лицом по нормали (наклон по высоте — вполовину: глаза смотрят вперёд)
      function onFace(o, x, y, d = 0, tilt = .5){
        const s = surf(x, y);
        o.position.set(x + s.nx * d, y + s.ny * d, s.z + s.nz * d);
        o.rotation.order = 'YXZ'; o.rotation.x = -Math.asin(Math.max(-1, Math.min(1, s.ny))) * tilt; o.rotation.y = Math.atan2(s.nx, s.nz);
        return o;
      }
      const EX = .2 * HD.ex, EY = -.08, MY = -.215;
      // ── лицо: наборы (обычное + выражения при эмоциях, строятся при первой эмоции)
      const face = lod ? G(head) : B(head);   // вдали лицо склеивается с головой
      const lidK = R.face === 'dots' ? .55 : R.face === 'classic' ? .75 : R.face === 'toon' ? .95 : 1;
      const robotEye = () => ['brown', 'dark', 'gray', 'amber'].includes(R.eyec) ? '#3ee8ff' : colorOf(R, 'eyec');
      function eyeArc(g, up, w = .068){ M(g, tor(w, .021, 6, 16, PI), eyeDark, 0, up ? -.035 : .02, .02, 1, 1, 1, 0, 0, up ? 0 : PI); }
      function openEye(g, s, ex){
        const st = R.face, wide = ex.eyes === 'wide', k = wide ? 1.14 : 1, gx = ex.gaze ? ex.gaze[0] * .03 : 0, gy = ex.gaze ? ex.gaze[1] * .03 : 0;
        if (st === 'classic') { M(g, sph(.068, 12, 10), eyeDark, gx * .5, gy * .5, 0, .78 * k, 1.28 * k, .32); M(g, sph(.017, 8, 6), whiteB, gx * .5 - .018, gy * .5 + .045, .024); }
        else if (st === 'dots') { M(g, sph(.046 * k, 10, 8), eyeDark, gx * .6, -.01 + gy * .6, 0, 1, 1.08, .42); M(g, sph(.013, 6, 4), whiteB, gx * .6 - .015, gy * .6 + .01, .02); }
        else if (st === 'toon') {
          M(g, sph(.106, 16, 12), eyeDark, 0, 0, -.006, .9 * k, 1.13 * k, .3);
          M(g, sph(.1, 16, 12), whiteM, 0, 0, 0, .86 * k, 1.1 * k, .34);
          M(g, sph(.056 * (wide ? .85 : 1), 12, 10), irisM, gx, -.012 + gy, .022, .9, .95, .3);
          M(g, sph(.032 * (wide ? .8 : 1), 10, 8), eyeDark, gx, -.012 + gy, .032, .9, .95, .3);
          M(g, sph(.017, 8, 6), whiteB, gx - .022, .016 + gy, .04);
        } else {   // аниме и кавай: обводка, радужка (снизу светлее), зрачок, два блика (у кавай — больше и с искрой)
          const kw = st === 'kawaii' ? 1.18 : 1, kk = k * kw;
          M(g, sph(.105, 18, 14), eyeDark, 0, 0, 0, .82 * kk, kk, .36);
          M(g, sph(.082, 16, 12), irisM, gx, -.026 * kk + gy, .014, .84 * kk, .84 * kk, .3);
          if (hi) M(g, sph(.062, 12, 8), irisL, gx, -.054 * kk + gy, .02, .76 * kk, .46 * kk, .28);
          M(g, sph(.042 * (wide ? .7 : 1), 12, 8), eyeDark, gx, -.02 * kk + gy, .026, .8 * kw, .9 * kw, .3);
          M(g, sph(.034 * kw, 10, 8), whiteB, gx - .032 * kk, .042 * kk + gy, .036);
          M(g, sph(.016 * kw, 8, 6), whiteB, gx + .032 * kk, -.05 * kk + gy, .036);
          if (st === 'kawaii') { M(g, sph(.013, 6, 4), whiteB, gx + .012 * kk, .068 * kk + gy, .038); if (hi) M(g, flat('star', .05), whiteB, gx - .05 * kk, -.04 * kk + gy, .04, .045, .045, .045); }
        }
        // веки: сонные и злые глаза, «злое» выражение
        const lid = ex.lid || (R.eyes === 'sleepy' ? 'sleepy' : R.eyes === 'angry' ? 'angry' : null);
        if (lid === 'sleepy') M(g, sph(.112 * lidK, 16, 10), skH, 0, .05 * lidK, .012, .88, .62, .44);
        if (lid === 'angry') M(g, sph(.112 * lidK, 16, 10), skH, s * .025 * lidK, .075 * lidK, .012, .95, .5, .44, 0, 0, s * .45);
        if (R.lash !== 'no' && hi && (st === 'anime' || st === 'kawaii' || st === 'toon')) {
          const th = R.lash === 'long' ? .017 : .012, kk = st === 'kawaii' ? 1.18 : st === 'toon' ? 1.06 : 1;
          M(g, tor(.098 * kk, th, 5, 18, PI * .95), eyeDark, 0, 0, .028, 1, 1.02 * (st === 'toon' ? 1.1 : 1), 1, 0, 0, PI * .025);
          M(g, cap(th, .045, 6), eyeDark, s * .088 * kk, .068 * kk, .028, 1, 1, 1, 0, 0, s * -.9);
          if (R.lash === 'long') M(g, cap(th, .04, 6), eyeDark, s * .06 * kk, .094 * kk, .026, 1, 1, 1, 0, 0, s * -.5);
        }
      }
      function eyes(set, ex){
        const eg = B(set, 0, EY, 0);
        set.userData.eyes = eg;
        const kind = R.eyes, own = ['cyclops', 'robot', 'cool', 'heart', 'star', 'dizzy', 'happy'].includes(kind);
        if (kind === 'cyclops') {
          const g = G(eg); onFace(g, 0, EY + .02, -.01); g.position.y -= EY;
          M(g, sph(.17, 18, 14), eyeDark, 0, 0, 0, .9, 1, .36);
          M(g, sph(.13, 16, 12), irisM, 0, -.03, .02, .86, .86, .3);
          M(g, sph(.06, 12, 8), eyeDark, 0, -.025, .045, .85, .9, .3);
          M(g, sph(.05, 10, 8), whiteB, -.05, .06, .06); M(g, sph(.024, 8, 6), whiteB, .05, -.07, .06);
          set.userData.blink = true;
          return;
        }
        if (kind === 'robot') { M(eg, box(.78, .2, .14), blackM, 0, 0, surf(0, EY).z - .1); M(eg, box(.7, .11, .02), P('#3ee8ff', 'b'), 0, 0, surf(0, EY).z - .025); return; }
        if (kind === 'cool') M(eg, cyl(.013, .013, .12, 6), blackM, 0, .01, surf(0, EY).z + .02, 1, 1, 1, 0, 0, PI / 2);
        let blink = false;
        for (const s of [-1, 1]) {
          const g = G(eg); onFace(g, s * EX, EY, -.012); g.position.y -= EY;
          const e = own ? kind : ex.eyes === 'wink' ? (s > 0 ? 'arc' : null) : ex.eyes === 'wide' ? null : ex.eyes || null;
          if (e === 'happy' || e === 'arc') eyeArc(g, true);
          else if (e === 'closed') eyeArc(g, false, .062);
          else if (e === 'squeeze') { for (const k of [-1, 1]) M(g, cap(.016, .07, 6), eyeDark, 0, k * .022, .02, 1, 1, 1, 0, 0, PI / 2 + s * k * .45); }
          else if (e === 'dizzy') { M(g, tor(.075, .014, 6, 20), eyeDark, 0, 0, .01); M(g, tor(.038, .014, 6, 16), eyeDark, 0, 0, .012); M(g, sph(.014, 6, 4), eyeDark, 0, 0, .015); }
          else if (e === 'heart') { M(g, flat('heart'), tn('#ff3d7f'), 0, -.01, .015, .25, .25, .25); M(g, sph(.022, 8, 6), whiteB, -.045, .03, .04); }
          else if (e === 'star') M(g, flat('star'), tn('#ffcc33'), 0, -.01, .015, .28, .28, .28);
          else if (e === 'cool' || e === 'shades') { M(g, sph(.135, 18, 12), blackM, 0, -.01, .015, 1.08, .72, .26); M(g, box(.05, .02, .01), whiteB, -.05, .025, .05, 1, 1, 1, 0, 0, -.5); }
          else { openEye(g, s, ex); blink = true; }
        }
        if (ex.eyes === 'shades' && !own) M(eg, cyl(.013, .013, .12, 6), blackM, 0, .01, surf(0, EY).z + .02, 1, 1, 1, 0, 0, PI / 2);
        set.userData.blink = blink;
      }
      function brows(set, ex){
        if (R.brows === 'none' || R.eyes === 'robot') return;
        const Bd = { soft: [.024, .065, -.06], thin: [.013, .1, -.1], thick: [.034, .095, .03], angry: [.03, .1, .42] }[R.brows] || [.024, .065, -.06];
        for (const s of [-1, 1]) {
          const tilt = ex.brow === 'angry' ? .42 : ex.brow === 'worried' ? -.4 : ex.brow === 'up' ? Bd[2] - .1 : Bd[2];
          const y = ex.brow === 'up' || (ex.brow === 'one' && s > 0) ? .145 : .1;
          const o = onFace(M(set, cap(Bd[0], Bd[1], 6), browM, 0, 0, 0, 1, 1, .6), s * .2 * HD.ex, y, .012);
          o.rotation.z = PI / 2 + s * tilt;
        }
      }
      function mouth(set, kind){
        const st = R.face, wk = st === 'classic' ? 1.3 : st === 'dots' ? .72 : 1, mm = tn('#4a2a22'), red = tn('#5b1f2a'), pink = tn('#ff7a95');
        const at = (o, x, y, d, rz = 0) => { onFace(o, x, y, d, 1); o.rotation.z = rz; return o; };
        if (kind === 'cat') for (const s of [-1, 1]) at(M(set, tor(.032, .013, 5, 12, PI), mm), s * .032, MY + .01, .006, PI);
        else if (kind === 'o') { at(M(set, tor(.034, .015, 6, 16), mm), 0, MY - .01, .006); at(M(set, geo('mouthO', () => new T.CircleGeometry(.03, 14)), red), 0, MY - .01, .004); }
        else if (kind === 'grin') {
          at(M(set, geo('grin', () => new T.CircleGeometry(.075, 18, PI, PI)), red), 0, MY + .025, .006);
          at(M(set, geo('grinT', () => new T.CircleGeometry(.04, 12, PI, PI)), pink), 0, MY - .012, .009);
          at(M(set, box(.1, .02, .006), whiteB), 0, MY + .015, .01);
        } else if (kind === 'open' || kind === 'laugh') {
          const r = kind === 'laugh' ? .085 : .062;
          at(M(set, geo('mopen' + r, () => new T.CircleGeometry(r, 18, PI, PI)), red), 0, MY + .02, .006);
          at(M(set, geo('mopenT' + r, () => new T.CircleGeometry(r * .55, 12, PI, PI)), pink), 0, MY + .02 - r * .5, .009);
          if (kind === 'laugh') at(M(set, box(r * 1.5, .016, .006), whiteB), 0, MY + .012, .01);
        } else if (kind === 'frown') at(M(set, tor(.055 * wk, .015, 6, 16, PI), mm), 0, MY - .03, .006, 0);
        else if (kind === 'flat') at(M(set, cap(.014, .05, 6), mm), .01, MY - .005, .006, PI / 2);
        else if (kind === 'smirk') at(M(set, tor(.05, .015, 6, 14, PI * .7), mm), .03, MY + .015, .006, PI * 1.15);
        else {
          at(M(set, tor(.058 * wk, st === 'classic' ? .012 : .016, 6, 16, PI), mm), 0, MY + .02, .006, PI);
          if (kind === 'tongue') at(M(set, sph(.034, 10, 8), tn('#ff6f8e'), 0, 0, 0, 1, .8, .5), .018, MY - .045, -.005);
          if (kind === 'fangs') for (const s of [-1, 1]) at(M(set, cone(.014, .04, 6), whiteM), s * .03, MY - .045, -.005, PI);
        }
        if (R.mouth === 'mustache') for (const s of [-1, 1]) at(M(set, sph(.065, 12, 8), tn('#3b2412'), 0, 0, 0, 1.3, .45, .45), s * .06, MY + .07, 0, s * -.25);
      }
      function tears(set, n){
        const tm = P('#8fd8ff', 'b');
        for (const s of [-1, 1]) {
          if (n > 1) onFace(M(set, cap(.016, .16, 6), tm), s * (EX + .02), EY - .17, .012);
          else onFace(M(set, sph(.026, 10, 8), tm, 0, 0, 0, .8, 1.2, .5), s * (EX + .1), EY + .02, .02);
        }
      }
      function ledFace(set, ex){   // голова робота: экран, глаза и рот — огоньки
        const eg = B(set, 0, EY + .02, 0), z = HD.s[2] + .028, led = P(robotEye(), 'b'), e = ex.eyes;
        set.userData.eyes = eg; set.userData.blink = !e || e === 'wide';
        for (const s of [-1, 1]) {
          if (e === 'arc' || e === 'squeeze' || e === 'closed' || (e === 'wink' && s > 0)) M(eg, tor(.06, .016, 4, 10, PI), led, s * .19, -.02, z, 1, 1, 1, 0, 0, e === 'closed' ? PI : 0);
          else if (e === 'heart') M(eg, flat('heart', .04), P('#ff3d7f', 'b'), s * .19, 0, z, .2, .2, .2);
          else { const w = e === 'wide' ? 1.25 : 1; M(eg, rbox(.12 * w, .15 * w, .02, .02, 6), led, s * .19, 0, z); }
        }
        const mk = ex.mouth || 'smile';
        if (mk === 'o') M(set, tor(.04, .014, 4, 12), led, 0, MY + .02, z);
        else if (mk === 'flat' || mk === 'frown') M(set, rbox(.16, .022, .02, .008, 6), led, 0, MY + .02, z, 1, 1, 1, 0, 0, mk === 'frown' ? .2 : 0);
        else M(set, tor(.07, .014, 4, 12, PI), led, 0, MY + .06, z, 1, .8, 1, 0, 0, PI);
      }
      function mkSet(name){
        const ex = EXPR[name] || EXPR.base, set = lod ? G(face) : B(face);
        set.visible = false; set.userData.blink = false;
        if (robotH) ledFace(set, ex);
        else if (!knightH) { eyes(set, ex); brows(set, ex); mouth(set, ex.mouth || R.mouth); if (ex.tears) tears(set, ex.tears); }
        if (!lod) bake(set, ch);   // вдали — склеится вместе с головой
        ch.sets.set(name, set);
        return set;
      }
      if (robotH) {   // экран, антенна, болты-уши
        M(head, rbox(.82, .58, .06, .04, 8), tn('#141a24'), 0, -.06, HD.s[2] - .015);
        M(head, cyl(.016, .016, .22, 6), metal('head', c => shade(c, -.35)), 0, HD.s[1] + .1, 0);
        M(head, sph(.045, 10, 8), P('#ff4d6d', 'b'), 0, HD.s[1] + .22, 0);
        for (const s of [-1, 1]) M(head, cyl(.1, .1, .07, 14), metal('head', c => shade(c, -.35)), s * (HD.s[0] + .02), -.04, 0, 1, 1, 1, 0, 0, PI / 2);
      } else if (knightH) {   // шлем: прорезь забрала, дыхательные дырочки, золотой обод, плюмаж цвета волос
        const zf = surf(0, EY + .02).z;
        M(head, rbox(.66, .075, .06, .03, 6), tn('#11141a'), 0, EY + .02, zf - .01);
        if (hi) for (let i = 0; i < 5; i++) M(head, sph(.013, 6, 4), tn('#11141a'), (i - 2) * .05, MY - .02, surf((i - 2) * .05, MY - .02).z - .004);
        M(head, tor(.6, .025, 5, 30), tn('#e1b63e'), 0, -.12, 0, HD.s[0] * .98, 1, HD.s[2] * .98, PI / 2);
        for (let i = 0; i < 6; i++) { const a = -.5 + i * .3, o = M(head, sph(.12, 10, 8), hairM, 0, Math.cos(a) * .64 + .02, -Math.sin(a) * .64 - .05, .5, 1.3 - i * .1, 1); o.rotation.x = -a; }
      }
      const base = mkSet('base');
      base.visible = true;
      if (lod) { base.userData.blink = false; if (base.userData.eyes) base.userData.eyes.userData.bone = false; }
      ch.face = face; ch.faceSet = base; ch.expr = 'base';
      ch.mkSet = lod ? null : name => { const dd = DQ; DQ = QF; try { return mkSet(name); } finally { DQ = dd; } };
      // щёчки
      if (!robotH && !knightH) for (const s of [-1, 1]) {
        const ck = R.cheek;
        if (ck === 'blush' || ck === 'both') onFace(M(head, sph(.072, 14, 10), basic('#ff7f9f', .45), 0, 0, 0, 1.15, .62, .3), s * .32 * HD.ex, -.17, .01, 1);
        if ((ck === 'freckles' || ck === 'both') && hi) for (let i = 0; i < 3; i++) { const x = (.24 + i * .045) * HD.ex, y = -.1 - (i % 2) * .035; onFace(M(head, sph(.012, 6, 4), tn('#b9774f')), s * x, y, .002); }
        if (ck === 'stars') onFace(M(head, flat('star'), tn('#ffd23f'), 0, 0, 0, .09, .09, .09), s * .32 * HD.ex, -.17, .01, 1);
        if (ck === 'hearts') onFace(M(head, flat('heart'), tn('#ff5c8a'), 0, 0, 0, .085, .085, .085), s * .32 * HD.ex, -.17, .01, 1);
      }

      // ── причёска (в своей подгруппе: под форму головы растягивается; у робота и рыцаря — нет)
      const H = robotH || knightH ? 'bald' : R.hair, HG = G(head);
      if (HD.hair) HG.scale.set(HD.hair[0], HD.hair[1], HD.hair[2]);
      const hairCap = (tilt = -.36, r = 1.07, th = .5) => M(HG, geo(`hcap${f3(r)}_${f3(th)}_${sg(30, 12)}`, () => new T.SphereGeometry(.56 * r, sg(30, 12), sg(12, 6), 0, TAU, 0, PI * th)), hairM, 0, .03, -.02, 1, 1, 1, tilt);
      const hairBack = (r = 1.06, t0 = .42, t1 = .8) => M(HG, geo(`hback${f3(r)}_${f3(t0)}_${f3(t1)}_${sg(26, 10)}`, () => new T.SphereGeometry(.56 * r, sg(26, 10), sg(10, 5), PI, PI, PI * t0, PI * (t1 - t0))), hairDS, 0, 0, -.01);
      const shellH = (r, t1, open, y = 0, z = -.02) => M(HG, geo(`hshell${f3(r)}_${f3(t1)}_${f3(open)}_${sg(32, 12)}`, () => new T.SphereGeometry(.56 * r, sg(32, 12), sg(16, 6), PI / 2 + open, TAU - 2 * open, 0, PI * t1)), hairDS, 0, y, z);
      const clump = (a, e, sx, sy, sz2, rz = 0, rad = .53) => {
        const o = M(HG, sph(.16, 14, 10), hairM, Math.sin(a) * Math.cos(e) * rad * 1.04, Math.sin(e) * rad * .96 + .02, Math.cos(a) * Math.cos(e) * rad * .98, sx, sy, sz2);
        o.rotation.order = 'YXZ'; o.rotation.set(-e * .85, a, rz);
        return o;
      };
      const bangs = (n, spread, e, sx = 1.25, sy = .78) => { for (let i = 0; i < n; i++) { const t = n === 1 ? 0 : i / (n - 1) - .5; clump(t * spread, e - t * t * .4, sx, sy, .5, -t * .5); } };
      const up = new T.Vector3(0, 1, 0), v3 = new T.Vector3();
      const spike = (a, e, r, h, back = 0, lift = .35, dist = .5) => {
        const x = Math.sin(a) * Math.cos(e), y = Math.sin(e), z = Math.cos(a) * Math.cos(e);
        const o = M(HG, cone(r, h, 8), hairM, x * (dist + h * .28), y * (dist + h * .28) + .04, z * (dist + h * .28) - .02);
        o.quaternion.setFromUnitVectors(up, v3.set(x, y + lift, z - back).normalize());
        o.userData.tuft = true;
        return o;
      };
      const ball = (x, y, z, r) => { const o = M(HG, sph(r, 10, 8), hairM, x, y, z); o.userData.tuft = true; return o; };
      const curls = (n, rad, r, minY, oy = 0, oz = 0, faceCut = .5) => {
        const nn = lod ? Math.ceil(n * .6) : n;
        for (let i = 0; i < nn; i++) {
          const y = 1 - (i + .5) / nn * (1 - minY), rr = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.39996, x = Math.cos(th) * rr, z = Math.sin(th) * rr;
          if (z > faceCut && y < .5) continue;
          ball(x * rad, y * rad + oy, z * rad + oz, r * (lod ? 1.15 : 1));
        }
      };
      const sideburns = () => { for (const s of [-1, 1]) clump(s * 1.32, .1, .72, 1.05, .45, 0); };
      const tie = (x, y, z, rx = 1.2) => M(HG, tor(.07, .03, 6, 14), tn('#ff4fa3'), x, y, z, 1, 1, 1, rx);
      // хвостики, пучки, коса — двигаются (свои кости), одни и те же на любой голове
      function tails(){
        if (H === 'ponytail') {
          tie(0, .2, -.56);
          const g = B(HG, 0, .2, -.6);
          M(g, cap(.13, .34, 10), hairM, 0, -.22, -.1, 1, 1, 1, .35); M(g, sph(.12, 10, 8), hairM, 0, -.46, -.2);
          anims.push((t, dt, mv, s) => { g.rotation.z = (mv ? s * .2 : 0) + Math.sin(t * 1.7) * .05; g.rotation.x = mv ? -.12 : 0; });
        } else if (H === 'buns') {
          for (const s of [-1, 1]) { M(HG, sph(.21, 14, 10), hairM, s * .36, .46, -.12).userData.tuft = true; tie(s * .3, .34, -.1, .7).userData.tuft = true; }
        } else if (H === 'twintails') {
          const tl = [-1, 1].map(s => {
            tie(s * .5, .18, -.18, .5);
            const g = B(HG, s * .54, .14, -.2);
            M(g, cap(.12, .42, 10), hairM, s * .1, -.3, -.04, 1, 1, 1, 0, 0, s * .28); M(g, sph(.105, 10, 8), hairM, s * .2, -.6, -.06);
            return g;
          });
          anims.push((t, dt, mv, s) => { tl[0].rotation.z = (mv ? s * .18 : 0) + Math.sin(t * 1.8) * .05; tl[1].rotation.z = (mv ? s * .18 : 0) + Math.sin(t * 1.8 + 1) * .05; });
        } else if (H === 'braid') {
          const g = B(HG, 0, -.18, -.52);
          for (let i = 0; i < 6; i++) M(g, sph(.125 - i * .01, 10, 8), hairM, (i % 2 ? .025 : -.025), -i * .15, -i * .03, 1.1, .95, .9);
          M(g, tor(.06, .025, 6, 12), tn('#ff4fa3'), 0, -.86, -.17, 1, 1, 1, PI / 2); M(g, cone(.08, .14, 8), hairM, 0, -.98, -.18, 1, 1, 1, PI);
          anims.push((t, dt, mv, s) => { g.rotation.z = (mv ? s * .14 : 0) + Math.sin(t * 1.5) * .04; g.rotation.x = mv ? -.1 : 0; });
        }
      }
      // голова-кубик: причёска «из конструктора» — шапочка, чёлка, затылок, бока (без растяжки — по размерам кубика)
      let HB = null;
      if (HD.k === 'box') {
        HB = G(head);
        const hx = HD.s[0], hy = HD.s[1], hz = HD.s[2];
        const slab = (w, h, d, x, y, z, rx = 0, rz = 0) => M(HB, rbox(w, h, d, Math.min(w, h, d) * .32, 6, 12), hairM, x, y, z, 1, 1, 1, rx, 0, rz);
        const thin = H === 'buzz' || H === 'mohawk', longH = H === 'long' || H === 'wavy';
        if (H === 'afro') slab(2 * hx + .36, .66, 2 * hz + .32, 0, hy - .06, -.04);
        else if (H !== 'bald') {
          slab(2 * hx + .07, thin ? .08 : .16, 2 * hz + .07, 0, hy + (thin ? .02 : .05), 0);
          if (!thin) {
            if (H === 'side') slab(2 * hx * .75, .14, .08, -hx * .25, hy - .07, hz + .02, 0, .14);
            else slab(2 * hx + .03, H === 'bob' ? .17 : .12, .08, 0, hy - .07, hz + .02);
            slab(2 * hx + .07, longH ? 2 * hy + .3 : hy * 1.3, .1, 0, longH ? -.15 : hy * .35, -hz - .04);
            if (H === 'bob' || longH) for (const s of [-1, 1]) slab(.1, H === 'bob' ? hy * 1.5 : 2 * hy + .1, 2 * hz * .9, s * (hx + .04), H === 'bob' ? hy * .25 : -.1, -.04);
            else for (const s of [-1, 1]) slab(.08, hy * .8, hz * .9, s * (hx + .03), hy * .45, -hz * .3);
          }
          if (H === 'spiky' || H === 'anime') for (let i = 0; i < 8; i++) { const x = ((i % 4) - 1.5) * hx * .52, z = (i < 4 ? .25 : -.3) * hz, o = M(HB, cone(H === 'anime' ? .13 : .1, H === 'anime' ? .36 : .26, 6), hairM, x, hy + .22, z, 1, 1, 1, i < 4 ? .25 : -.35, 0, -x * .6); o.userData.tuft = true; }
          if (H === 'curly') for (let i = 0; i < 9; i++) { const o = M(HB, sph(.12, 10, 8), hairM, ((i % 3) - 1) * hx * .6, hy + .14, ((i / 3 | 0) - 1) * hz * .6); o.userData.tuft = true; }
          if (H === 'mohawk') for (let i = 0; i < 5; i++) { const o = M(HB, rbox(.1, .26 - Math.abs(i - 2) * .03, .2, .04, 6, 10), hairM, 0, hy + .16, hz * (.62 - i * .31)); o.userData.tuft = true; }
          tails();
        }
      } else {
        if (H !== 'bald' && H !== 'afro') {
          if (H === 'buzz' || H === 'mohawk') hairCap(-.5, 1.025, .54);
          else hairCap(-.36);
        }
        if (['short', 'side', 'spiky', 'curly', 'ponytail', 'buns', 'twintails', 'braid', 'anime'].includes(H)) hairBack();
        if (H === 'short') { bangs(4, 1.15, .62); sideburns(); }
        else if (H === 'side') { clump(-.62, .74, 1.0, .72, .5, .35); clump(-.3, .72, 1.2, .78, .5, .2); clump(.1, .56, 2.3, .85, .55, -.5); clump(.55, .38, 1.4, .8, .5, -.9); sideburns(); }
        else if (H === 'spiky') {
          bangs(3, .9, .62, 1.1, .8); sideburns();
          [[0, 1.25], [.85, .95], [-.85, .95], [1.7, .72], [-1.7, .72], [2.5, .55], [-2.5, .55], [PI, .5], [.42, 1.05], [-.42, 1.05], [2.1, .95], [-2.1, .95], [PI, 1.0]].forEach(([a, e]) => spike(a, e, .12, .34, .3));
        } else if (H === 'curly') {
          hairBack(1.1, .4, .78);
          curls(30, .6, .125, -.3, .02, -.02, .45);
          for (let i = 0; i < 5; i++) { const t = i / 4 - .5; ball(t * .5, .3 - t * t * .3, .5 - Math.abs(t) * .1, .1); }
        } else if (H === 'buzz') { /* только «ёжик» на шапочке */ }
        else if (H === 'bob') { shellH(1.12, .64, .9); bangs(6, 1.45, .55, 1.0, .92); }
        else if (H === 'long') {
          shellH(1.1, .72, .95); bangs(5, 1.25, .58);
          M(HG, cap(.4, .5, 14), hairM, 0, -.62, -.3, 1.15, 1, .42);
          for (const s of [-1, 1]) M(HG, cap(.1, .46, 8), hairM, s * .5, -.45, .14, 1, 1, .8, 0, 0, s * .06);
        } else if (H === 'wavy') {
          shellH(1.13, .72, .95); bangs(5, 1.25, .58);
          M(HG, cap(.42, .45, 14), hairM, 0, -.62, -.32, 1.18, 1, .45);
          for (let i = 0; i < 9; i++) { const a = PI + (i / 8 - .5) * 2.4; ball(Math.sin(a) * .42, -.95 + (i % 2) * .05, Math.cos(a) * .2 - .3, .14); }
          for (const s of [-1, 1]) for (let i = 0; i < 4; i++) ball(s * (.5 + (i % 2) * .05), -.2 - i * .16, .14, .1 - i * .008);
        } else if (H === 'ponytail' || H === 'buns' || H === 'twintails') { bangs(5, 1.25, .58); tails(); }
        else if (H === 'braid') { bangs(4, 1.15, .6); tails(); }
        else if (H === 'mohawk') {
          for (let i = 0; i < 7; i++) { const a = -.35 + i * .37, o = M(HG, sph(.15, 12, 10), hairM, 0, Math.cos(a) * .6 + .06, -Math.sin(a) * .6 - .02, .34, 1.25 - i * .07, .95); o.rotation.x = -a; o.userData.tuft = true; }
        } else if (H === 'afro') {
          shellH(1.42, .6, 1.02, .1, -.06);
          curls(46, .76, .16, -.25, .1, -.06, .42);
          for (let i = 0; i < 5; i++) { const t = i / 4 - .5; ball(t * .6, .36 - t * t * .3, .48 - Math.abs(t) * .1, .12); }
        } else if (H === 'anime') {
          bangs(3, .8, .66, 1.1, .8);
          [[2.2, .55], [-2.2, .55], [2.8, .35], [-2.8, .35], [PI, .8], [1.6, .9], [-1.6, .9], [2.6, 1.0], [-2.6, 1.0], [0, 1.25]].forEach(([a, e]) => spike(a, e, .17, .52, .55, .2, .48));
          for (const t of [-.3, 0, .3]) { const o = M(HG, cone(.085, .34, 8), hairM, t * .5, .2, .5 - Math.abs(t) * .1); o.rotation.set(PI + .35, 0, t * .5); }
          for (const s of [-1, 1]) { const o = M(HG, cone(.1, .55, 8), hairM, s * .5, -.2, .14); o.rotation.set(PI, 0, s * -.12); }
        }

      }
      // ── шапка из гардероба (растянута под форму головы)
      const hat = R.hat, cover = ['cap', 'grad', 'helmet', 'army', 'top', 'propeller'].includes(hat) && H !== 'afro';
      if (cover) for (const grp of [HG, HB]) if (grp) for (const o of [...grp.children]) if (o.userData.tuft && o.position.y > .06) grp.remove(o);
      const lift = cover ? 0 : ({ afro: .26, anime: .12, spiky: .12, curly: .07, mohawk: .2, buns: .04 }[H] || 0) + (HB && H !== 'bald' ? .09 : 0), hatK = H === 'afro' ? 1.22 : 1;
      let hatTop = .56;
      if (hat !== 'none') {
        const hg = G(head, 0, lift + HD.hat[1], 0); hg.scale.set(hatK * HD.hat[0], hatK, hatK * HD.hat[2]);
        const hm = (def, fn) => acc('hatc', def, fn);
        if (hat === 'bow') { const g = G(hg, .32, .44, .12); g.rotation.z = -.45; for (const s of [-1, 1]) M(g, cone(.1, .17, 10), hm('#ff4f9a'), s * .085, 0, 0, 1, 1, .7, 0, 0, s * PI / 2); M(g, sph(.05, 8, 6), hm('#ff4f9a', c => shade(c, -.15))); }
        else if (hat === 'cap') {
          const cm = hm('#e8384f');
          M(hg, geo(`capcrown${sg(26, 10)}`, () => new T.SphereGeometry(.62, sg(26, 10), sg(10, 5), 0, TAU, 0, PI * .5)), cm, 0, .1, -.02, 1, .78, 1, -.15);
          M(hg, cyl(.34, .34, .035, 26), hm('#e8384f', c => shade(c, -.18)), 0, .2, .62, 1, 1, .85, .25);
          M(hg, sph(.04, 8, 6), hm('#e8384f', c => shade(c, -.18)), 0, .53, -.06); hatTop = .58;
        } else if (hat === 'party') {
          const pm = R.hatc !== 'auto' ? PS('hatc') : cache(mats, 'party', () => new T.MeshToonMaterial({ gradientMap: grad, map: canvasTex('party', 32, 32, g => { for (let i = 0; i < 8; i++) { g.fillStyle = ['#ff4f9a', '#ffd23f', '#38bdf8', '#7cf29c'][i % 4]; g.fillRect(0, i * 4, 32, 4); } }) }));
          const g = G(hg, .08, .64, 0); g.rotation.z = -.22;
          M(g, cone(.25, .55, 18), pm); M(g, sph(.075, 10, 8), whiteM, 0, .3, 0); hatTop = 1.2;
        } else if (hat === 'grad') {
          M(hg, cyl(.36, .36, .17, 20), hm('#1f1f27'), 0, .5, -.02);
          M(hg, box(.9, .045, .9), hm('#1f1f27'), 0, .6, -.02, 1, 1, 1, 0, PI / 4, 0);
          M(hg, sph(.035, 8, 6), tn('#f2b91e'), 0, .635, -.02);
          M(hg, cyl(.012, .012, .26, 5), tn('#f2b91e'), .4, .48, .2); M(hg, cyl(.03, .02, .1, 6), tn('#f2b91e'), .4, .32, .2); hatTop = .66;
        } else if (hat === 'helmet') {
          M(hg, geo(`hardhat${sg(26, 10)}`, () => new T.SphereGeometry(.63, sg(26, 10), sg(10, 5), 0, TAU, 0, PI * .5)), hm('#facc15'), 0, .06, 0, 1, .82, 1);
          M(hg, cyl(.7, .7, .035, 28), hm('#facc15', c => shade(c, -.1)), 0, .08, .05, 1, 1, 1.08); M(hg, box(.08, .06, .7), hm('#facc15', c => shade(c, -.1)), 0, .56, 0); hatTop = .6;
        } else if (hat === 'army') {
          M(hg, geo(`armyhat${sg(26, 10)}`, () => new T.SphereGeometry(.66, sg(26, 10), sg(10, 5), 0, TAU, 0, PI * .5)), hm('#556b3a'), 0, .02, 0, 1, .82, 1);
          M(hg, tor(.65, .04, 6, 30), hm('#556b3a', c => shade(c, -.2)), 0, .03, 0, 1, 1, 1, PI / 2); hatTop = .58;
        } else if (hat === 'top') {
          M(hg, cyl(.3, .3, .5, 22), hm('#1f1f27'), 0, .8, -.02); M(hg, cyl(.52, .52, .035, 26), hm('#1f1f27'), 0, .56, -.02); M(hg, cyl(.305, .305, .08, 22), tn('#d6213f'), 0, .62, -.02); hatTop = 1.05;
        } else if (hat === 'ears') {
          for (const s of [-1, 1]) { M(hg, cone(.15, .3, 10), R.hatc === 'auto' ? hairM : PS('hatc'), s * .34, .5, -.04, 1, 1, .7, 0, 0, s * -.38); M(hg, cone(.08, .18, 8), tn('#ffb3c7'), s * .33, .48, .03, 1, 1, .5, 0, 0, s * -.38); }
          hatTop = .72;
        } else if (hat === 'horns') {
          for (const s of [-1, 1]) { M(hg, cone(.09, .3, 10), hm('#e11d48'), s * .3, .52, .06, 1, 1, 1, .25, 0, s * -.45); M(hg, cone(.045, .14, 8), hm('#e11d48'), s * .42, .7, .1, 1, 1, 1, .4, 0, s * -1.1); }
          hatTop = .78;
        } else if (hat === 'propeller') {
          const bm = R.hatc !== 'auto' ? PS('hatc') : cache(mats, 'beanie', () => new T.MeshToonMaterial({ gradientMap: grad, map: canvasTex('beanie', 32, 8, g => { ['#e23b4e', '#facc15', '#3b82f6', '#22c55e'].forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 8, 0, 8, 8); }); }) }));
          M(hg, geo(`beanie${sg(24, 10)}`, () => new T.SphereGeometry(.6, sg(24, 10), sg(10, 5), 0, TAU, 0, PI * .5)), bm, 0, .06, 0, 1, .72, 1);
          M(hg, cyl(.022, .022, .14, 6), blackM, 0, .55, 0);
          const pg = B(hg, 0, .62, 0);
          M(pg, box(.52, .02, .09), tn('#e23b4e'), 0, 0, 0, 1, 1, 1, .15); M(pg, box(.09, .02, .52), tn('#3b82f6'), 0, 0, 0, .15);
          M(pg, sph(.035, 8, 6), tn('#facc15'));
          anims.push((t, dt) => { pg.rotation.y += dt * 14; }); hatTop = .68;
        } else if (hat === 'halo') {
          const g = M(hg, tor(.3, .045, 8, 30), basic(R.hatc === 'auto' ? '#ffd84d' : colorOf(R, 'hatc')), 0, .86, 0, 1, 1, 1, PI / 2);
          g.userData.keep = true;
          anims.push(t => { g.position.y = .86 + Math.sin(t * 2.2) * .04; }); hatTop = .9;
        } else if (hat === 'crown') {
          const cg = R.hatc === 'auto' ? gold() : PS('hatc'), gm = R.hatc === 'auto' ? gold(1) : PS('hatc', null, 'd');
          M(hg, cyl(.3, .27, .2, 8, true), gm, 0, .64, -.02);
          for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; M(hg, cone(.05, .14, 6), cg, Math.sin(a) * .3, .8, Math.cos(a) * .3 - .02); }
          for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; M(hg, sph(.035, 8, 6), tn(i % 2 ? '#3b82f6' : '#e11d48'), Math.sin(a) * .29, .63, Math.cos(a) * .29 - .02); }
          hatTop = .9;
        } else if (hat === 'headphones') {
          const led = new T.MeshBasicMaterial({ color: '#ff2d55' }); led.userData.own = true; ch.own.push(led);
          M(hg, tor(.62, .045, 8, 28, PI), hm('#26262e'), 0, .02, 0);
          for (const s of [-1, 1]) { M(hg, cyl(.17, .17, .13, 20), hm('#26262e'), s * .62, -.02, 0, 1, 1, 1, 0, 0, PI / 2); const r = M(hg, tor(.14, .026, 6, 22), led, s * .695, -.02, 0, 1, 1, 1, 0, PI / 2, 0); r.userData.keep = true; }
          M(hg, cyl(.014, .014, .42, 6), tn('#26262e'), -.5, -.25, .28, 1, 1, 1, .9, 0, .5);
          M(hg, sph(.045, 10, 8), tn('#3a3a46'), -.28, -.36, .48);
          anims.push(t => { led.color.setHSL((t * .25) % 1, .95, .55); });
          hatTop = .66;
        } else if (hat === 'gemcrown') {   // кристальная корона (только за 💎): серебряный обруч, кристаллы-зубцы, камень спереди
          const band = R.hatc === 'auto' ? P('#e4e9ff', 'm') : PS('hatc', null, 'm'), gemG = geo('gemcut', () => new T.OctahedronGeometry(.5, 0));
          M(hg, tor(.3, .045, 8, 32), band, 0, .58, -.02, 1, 1, 1, PI / 2);
          M(hg, tor(.295, .028, 8, 32), band, 0, .69, -.02, 1, 1, 1, PI / 2);
          const GC = ['#7ef0ff', '#b98cff', '#ff8ce6', '#8cc8ff', '#c8a2ff', '#7ef0ff', '#ff8ce6'];
          for (let i = 0; i < 7; i++) { const a = i / 7 * TAU, hh = i % 2 ? .2 : .3; M(hg, gemG, P(GC[i], 'g'), Math.sin(a) * .3, .69 + hh * .45, Math.cos(a) * .3 - .02, .13, hh, .13, 0, a, 0); }
          M(hg, gemG, P('#ff7ce6', 'g'), 0, .635, .3, .13, .15, .08);
          for (let i = 0; i < 6; i++) { const a = (i + .5) / 6 * TAU; M(hg, gemG, P(i % 2 ? '#7ef0ff' : '#b98cff', 'g'), Math.sin(a) * .31, .635, Math.cos(a) * .31 - .02, .05, .06, .05); }
          hatTop = .97;
        }
      }
      // ── очки (на лице любой формы; у робота и рыцаря — нет)
      if (R.glasses !== 'none' && R.eyes !== 'robot' && !robotH && !knightH) {
        const gy = EY + .005, gm = def => acc('glassc', def);
        const lens = (g, m, x, sx, d = .03, ry) => { const o = onFace(M(head, g, m, 0, 0, 0, sx, sx, sx), x, gy, d, .3); if (ry != null) o.rotation.y += ry; return o; };
        if (R.glasses === 'round' || R.glasses === 'square') {
          const sq = R.glasses === 'square', fm = gm('#1f1f27');
          for (const s of [-1, 1]) { const o = lens(sq ? tor(.15, .017, 6, 4) : tor(.118, .016, 6, 24), fm, s * EX, 1, .03); if (sq) o.rotation.z = PI / 4; }
          M(head, cyl(.012, .012, .12, 6), fm, 0, gy + .02, surf(0, gy).z + .015, 1, 1, 1, 0, 0, PI / 2);
          for (const s of [-1, 1]) M(head, cyl(.011, .011, .3, 5), fm, s * .4 * HD.ex, gy + .02, HD.k === 'box' ? HD.s[2] - .16 : .32 * HD.s[2] / .98, 1, 1, 1, PI / 2, 0, 0);
        } else if (R.glasses === 'heart') {
          for (const s of [-1, 1]) lens(flat('heart', .1), gm('#ff4f8b'), s * EX, .3, .04);
          M(head, cyl(.012, .012, .1, 6), gm('#ff4f8b'), 0, gy + .02, surf(0, gy).z + .02, 1, 1, 1, 0, 0, PI / 2);
        } else if (R.glasses === 'star') {
          for (const s of [-1, 1]) { lens(flat('star', .1), gm('#ffc83d'), s * EX, .36, .03); lens(flat('star', .06), blackM, s * EX * 1.02, .22, .055); }
        } else if (R.glasses === 'monocle') {
          const mg = R.glassc === 'auto' ? gold() : PS('glassc');
          const r = lens(tor(.125, .017, 6, 24), mg, EX, 1, .03);
          lens(geo('mglass', () => new T.CircleGeometry(.115, 20)), basic('#dff4ff', .25), EX, 1, .025);
          M(head, cyl(.008, .008, .4, 4), mg, EX + .12, gy - .25, r.position.z - .05, 1, 1, 1, 0, 0, .25);
        }
      }

      // ── предмет в правой руке: шарик — объёмный, остальное — эмодзи
      const HR = armsLR[1].H;
      if (R.item === 'balloon') {
        const g = B(HR, 0, -.01, .05);
        M(g, cyl(.006, .006, .95, 4), whiteM, 0, .47, 0);
        M(g, sph(.21, 16, 12), tn('#ef3b4f'), 0, 1.05, 0, 1, 1.15, 1); M(g, cone(.035, .06, 6), tn('#ef3b4f'), 0, .82, 0, 1, 1, 1, PI);
        g.rotation.x = .62;
        const elb = armsLR[1].E;   // шарик держится как раньше: локоть его не наклоняет
        anims.push((t, dt, mv) => { g.rotation.x = .5 - (mv ? .25 : 0) - elb.rotation.x; g.rotation.z = Math.sin(t * 1.3) * .12; });
      } else if (R.item !== 'none') {
        const e = partV('item', R.item, '');
        if (e) { const sp = emojiSprite(e, .5); sp.position.set(.04, -.13, .12); HR.add(sp); }
      }
      // питомец — отдельный объект (его ставит в сцену тот, кто рисует)
      const petE = R.pet !== 'none' ? partV('pet', R.pet, '') : '';
      const pet = petE ? emojiSprite(petE, .75) : null;

      bake(body, ch);
      const ht = robotH ? HD.top + .4 : knightH ? HD.top + .3 : H === 'afro' ? 1.35 * (HD.hair ? HD.hair[1] : 1) : HD.top;
      const top = hipY + yT - .06 + hr * .86 + hr * ht + ({ spiky: .2, anime: .24, mohawk: .26, buns: .16, curly: .08 }[H] || 0) * (cover ? 0 : hs) + (hat !== 'none' ? (hatTop - .56 + HD.hat[1]) * hs * hatK + lift * hs : 0);
      ch.root = root; ch.body = body; ch.torso = torso; ch.headP = headP; ch.head = head;
      ch.legL = legsLR[0].L; ch.legR = legsLR[1].L; ch.kneeL = legsLR[0].K; ch.kneeR = legsLR[1].K;
      ch.armL = armsLR[0].A; ch.armR = armsLR[1].A; ch.elbowL = armsLR[0].E; ch.elbowR = armsLR[1].E; ch.handL = armsLR[0].H; ch.handR = HR;
      ch.blink = !!base.userData.blink; ch.pet = pet; ch.top = top; ch.headY = hipY + yT - .06 + hr * .86; ch.hipY = hipY; ch.hs = hs;
      // для телефона: полуширина и глубина головы (до масштаба hs) — где ухо и глаза; цвет кисти (большие пальцы на экране)
      ch.phD = { hw: HD.k === 'ell' ? .56 * HD.s[0] : HD.k === 'cyl' ? HD.r : HD.s[0], hy: HD.k === 'ell' ? .56 * HD.s[1] : HD.k === 'cyl' ? HD.h + HD.c : HD.s[1],
        hz: HD.k === 'ell' ? .56 * HD.s[2] : HD.k === 'cyl' ? HD.r : HD.s[2], box: HD.k !== 'ell', tw: TD.w(.6), td: TD.d(.6), y0: yB, y1: yT };
      ch.handC = handColor(R);
      return ch;
    }
    // Цвет кисти: варежки/перчатки — их цвет, иначе кожа (или металл брони) правой руки
    function handColor(R){
      const g = R.glove;
      if (g === 'mitts' || g === 'gloves' || g === 'boxing') return R.glovec === 'auto' ? { mitts: '#e23b4e', gloves: '#2b2b33', boxing: '#d6213f' }[g] : colorOf(R, 'glovec');
      return partCol(R, 'armR');
    }

    // Перекрасить готового человечка, если поменялись только цвета (обычные, не особые материалы). false — нужна пересборка
    function recolor(ch, look){
      const R = resolve(look, ch.key), O = ch.R;
      for (const s in R) if (!PALS.includes(s) && R[s] !== O[s]) return false;
      for (const s of PALS) {
        if (R[s] === O[s]) continue;
        if ((SPECIAL[s] || []).includes(R[s]) || (SPECIAL[s] || []).includes(O[s])) return false;
        if (AUTO_HARD.includes(s) && (R[s] === 'auto') !== (O[s] === 'auto')) return false;
        if (s[0] === 'p' && s[1] === 'c' && R.tone === 'goldskin' && (R[s] === 'auto') !== (O[s] === 'auto')) return false;   // часть стала/перестала быть золотой
      }
      ch.R = R;
      ch.handC = handColor(R);
      if (ch.ph) for (const th of ch.ph.thumbs) th.material = toon(ch.handC);   // большие пальцы на экране телефона
      for (const r of ch.ranges) {
        const c = linear(r.col(R)), at = r.g.attributes.color, a = at.array;
        for (let k = 0; k < r.n; k++) { const q = (r.a + k) * 3; a[q] = c[0]; a[q + 1] = c[1]; a[q + 2] = c[2]; }
        at.needsUpdate = true;
      }
      return true;
    }
    // Выражение лица: набор строится при первой эмоции (у дальнего, LOD, — только обычное лицо, склеенное с головой)
    function setExpr(ch, name){
      let set = ch.sets.get(name);
      if (!set && ch.mkSet) { try { set = ch.mkSet(name); } catch (e) { set = null; } }
      if (!set) set = ch.sets.get('base');
      if (ch.faceSet && ch.faceSet !== set) { ch.faceSet.visible = false; if (ch.faceSet.userData.eyes) ch.faceSet.userData.eyes.scale.y = 1; }
      set.visible = true; ch.faceSet = set; ch.expr = name;
    }

    // ═══ Телефон 📱 — как в ГТА (владелец 15.10.2026): достать из кармана, смотреть в экран, говорить у уха, играть двумя
    // руками, снимать; убрать обратно. Слой поверх любой позы (идёт, сидит, присел, прыгнул): руки, голова, плечи — от
    // телефона, ноги — свои. Состояние ch.phS: o — «насколько достал» 0…2 (0 — рука своя, 1 — рука у кармана, телефон
    // появляется, 2 — в руке в позе режима; убрать — тот же путь назад, без рывков), w — веса режимов (смена — плавно).
    // Позы рук — двухзвенная рука (IK) от размеров ЭТОГО человечка (у чиби короткие руки и большая голова): считаются
    // один раз (ch.phC). Корпус — общие геометрия и материалы на всех; появляется в handR при первом «достать».
    const pv = () => new T.Vector3(), pq = () => new T.Quaternion();
    const IKD = pv(), IKN = pv(), IKa = pv(), IKb = pv(), IKc = pv(), IKa2 = pv(), IKb2 = pv(), IKc2 = pv(), IKm1 = new T.Matrix4(), IKm2 = new T.Matrix4(), IKe = new T.Euler();
    // Рука: плечо S (оси туловища), длины Lu (до локтя) и Lf (до кисти), цель P, hint — куда смотрит локоть → out[o…o+3] = углы плеча
    // (Эйлер XYZ) и локтя. Не достаёт — вытянута к цели. Возвращает, сколько было до цели
    function armIK(S, Lu, Lf, P, hint, out, o){
      IKD.subVectors(P, S);
      const reach = IKD.length();
      const d = Math.max(Math.abs(Lu - Lf) + .02, Math.min((Lu + Lf) * .995, reach));
      IKD.normalize();
      const e = -Math.acos(Math.max(-1, Math.min(1, (d * d - Lu * Lu - Lf * Lf) / (2 * Lu * Lf))));
      IKa.set(0, -Lu - Lf * Math.cos(e), -Lf * Math.sin(e)).normalize();
      IKb.set(0, -1, 0).addScaledVector(IKa, IKa.y).normalize(); IKc.crossVectors(IKa, IKb);   // локоть ⟂ кисти (в осях плеча)
      const ca = Math.max(-1, Math.min(1, (Lu * Lu + d * d - Lf * Lf) / (2 * Lu * d))), sa = Math.sqrt(1 - ca * ca);
      IKN.copy(hint).addScaledVector(IKD, -hint.dot(IKD));
      if (IKN.lengthSq() < 1e-8) IKN.set(0, -1, 0).addScaledVector(IKD, -IKD.y);
      IKN.normalize();
      IKb2.copy(IKD).multiplyScalar(ca).addScaledVector(IKN, sa);
      IKb2.addScaledVector(IKD, -IKb2.dot(IKD)).normalize(); IKc2.crossVectors(IKD, IKb2); IKa2.copy(IKD);
      IKm1.makeBasis(IKa, IKb, IKc).transpose(); IKm2.makeBasis(IKa2, IKb2, IKc2).multiply(IKm1);
      IKe.setFromRotationMatrix(IKm2, 'XYZ');
      out[o] = IKe.x; out[o + 1] = IKe.y; out[o + 2] = IKe.z; out[o + 3] = e;
      return reach;
    }
    const FKq = pq(), FKq2 = pq(), FKe = new T.Euler(), FKx = new T.Vector3(1, 0, 0), FKv = pv();
    // Кисть по углам: положение и поворот в осях туловища
    function armFK(S, Lu, Lf, a, o, pos, q){
      FKe.set(a[o], a[o + 1], a[o + 2], 'XYZ'); q.setFromEuler(FKe);
      FKq2.setFromAxisAngle(FKx, a[o + 3]);
      FKv.set(0, -Lf, 0).applyQuaternion(FKq2); FKv.y -= Lu;
      pos.copy(FKv).applyQuaternion(q).add(S);
      q.multiply(FKq2);
    }
    const HDq = pq(), HDe = new T.Euler();
    // Точка головы (x, y, z — в осях головы до масштаба hs) при повороте головы h → в осях туловища
    function headPt(ch, h, x, y, z, out){
      HDe.set(h[0], h[1], h[2], 'YXZ'); HDq.setFromEuler(HDe);
      out.set(x * ch.hs, y * ch.hs, z * ch.hs).add(ch.head.position).applyQuaternion(HDq).add(ch.headP.position);
      return out;
    }
    // Не залез ли телефон (центр c, оси x, u, n — в осях туловища) в голову (поза головы h) или в грудь: насколько вытолкнуть
    // (единиц) и куда — в out. Голова — эллипсоид с запасом (у кубика и робота — больше), туловище — эллиптический цилиндр
    const PNq = pq(), PNqi = pq(), PNe = new T.Euler(), PNp = pv(), PNl = pv();
    function phPen(ch, h, c, x, u, n, out, m){
      const D = ch.phD, hs = ch.hs, k = D.box ? 1.12 : 1;
      PNe.set(h[0], h[1], h[2], 'YXZ'); PNq.setFromEuler(PNe); PNqi.copy(PNq).invert();
      let best = 0;
      for (let i = 0; i < 18; i++) {
        const sx = (i % 3) - 1, sy = ((i / 3 | 0) % 3) - 1, sz = i < 9 ? -1 : 1;
        PNp.copy(c).addScaledVector(x, sx * PHW / 2).addScaledVector(u, sy * PHH / 2).addScaledVector(n, sz * PHD / 2);
        // голова: в её оси (до масштаба)
        PNl.copy(PNp).sub(ch.headP.position).applyQuaternion(PNqi).sub(ch.head.position).multiplyScalar(1 / hs);
        const ax = D.hw * k + m, ay = D.hy * k + m, az = D.hz * k + m, e = Math.hypot(PNl.x / ax, PNl.y / ay, PNl.z / az);
        if (e < 1) {
          const dep = (1 - e) * Math.min(ax, ay, az) * hs;
          if (dep > best) { best = dep; out.set(PNl.x / (ax * ax), PNl.y / (ay * ay), PNl.z / (az * az)).applyQuaternion(PNq).normalize(); }   // наружу по нормали
        }
        // грудь: на высоте туловища — снаружи эллипса (полуширина, полуглубина) с запасом
        if (PNp.y > D.y0 && PNp.y < D.y1) {
          const e2 = Math.hypot(PNp.x / (D.tw + .02), PNp.z / (D.td + .02));
          if (e2 < 1) { const dep = (1 - e2) * Math.min(D.tw, D.td); if (dep > best) { best = dep; out.set(PNp.x / D.tw, 0, PNp.z / D.td).normalize(); } }
        }
      }
      return best;
    }
    // Калибровка (один раз на человечка): для каждого режима и кармана — суставы слоя (в порядке PHJ), маски, где телефон
    // в кисти (pos, q), где большие пальцы на экране (thR, thL — в осях телефона)
    function phCal(ch){
      if (ch.phC) return ch.phC;
      const A = [ch.armL, ch.armR], Ls = [-ch.elbowL.position.y, -ch.elbowR.position.y], Lh = [-ch.handL.position.y, -ch.handR.position.y];
      const S = [pv(), pv()], H = [pv(), pv()], HQ = [pq(), pq()], eye = pv(), ear = pv(), n = pv(), u = pv(), x = pv(), c = pv(), tgt = pv(), hint = pv(), tmp = pv();
      const PQm = new T.Matrix4(), Pq = pq(), Pqi = pq(), ang = new Float32Array(8);
      const D = ch.phD || { hw: .58, hz: .55 };
      const one = (d, i) => {
        const a = new Float32Array(NPH), mk = new Float32Array(NPH);
        a.set(d.t, 0); a.set(d.h, 3);
        const he = [d.h[0] * d.mh, d.h[1] * d.mh, d.h[2] * d.mh];   // голова на деле (маска: остальное — своя поза, стоит почти прямо)
        for (const s of [0, 1]) S[s].set(A[s].position.x, (A[s].userData.y0 ?? A[s].position.y) + (d.sh ? d.sh[s] : 0), A[s].position.z);
        // кисть правой: у уха (по голове этого человечка) или по направлению от плеча
        if (d.ear) {
          headPt(ch, he, D.hw, -.07, 0, ear);
          HDe.set(he[0], he[1], he[2], 'YXZ'); HDq.setFromEuler(HDe);
          n.set(-1, 0, 0).applyQuaternion(HDq); u.set(0, .8, -.6).normalize().applyQuaternion(HDq);
          c.copy(ear).addScaledVector(n, -(PHD / 2 + .016)).addScaledVector(u, -(PHH / 2 - .026));   // где хотим центр телефона
          tgt.copy(c).addScaledVector(n, -.04).addScaledVector(u, -.09);
          hint.set(1, -.15, .25);
        } else {
          tgt.set(d.r[0], d.r[1], d.r[2]).normalize().multiplyScalar((Ls[1] + Lh[1]) * d.r[3]).add(S[1]);
          hint.set(1, -1, d.two ? 0 : -.3);
        }
        const hint0 = hint.normalize().clone();
        armIK(S[1], Ls[1], Lh[1], tgt, hint0, ang, 4);
        armFK(S[1], Ls[1], Lh[1], ang, 4, H[1], HQ[1]);
        // как держим: n — экран (к глазам / к щеке / наружу), u — верх телефона (вперёд / к левой руке / вверх)
        if (!d.ear) {
          if (i === 3) n.set(0, .35, -1).normalize();
          else if (i < 0) n.set(1, 0, .2).normalize();
          else n.subVectors(headPt(ch, he, 0, -.08, D.hz, eye), H[1]).normalize();
          // боком: верх — к левому плечу смотрящего (как от 1-го лица: картинка игры у него ровная), правая держит верхний конец
          if (i === 0) u.set(0, .3, 1); else if (i < 0) u.set(0, 1, .25); else u.set(1, 0, 0);
          u.addScaledVector(n, -u.dot(n)).normalize();
        }
        x.crossVectors(u, n);
        const g = d.two ? -.135 : d.ear ? .09 : i < 0 ? .025 : .11, gn = d.two ? .036 : .04;   // кисть держит низ (двумя — концы)
        c.copy(H[1]).addScaledVector(n, gn).addScaledVector(u, g);   // центр телефона — у кисти (телефон не отрывается)
        // залез в голову или в грудь (большая голова, короткие руки) — кисть наружу, руку заново
        if (i >= 0) for (let it = 0; it < 6; it++) {
          const dep = phPen(ch, he, c, x, u, n, tmp, d.ear ? .012 : .03);   // у уха — вплотную к щеке
          if (dep < .004) break;
          tgt.copy(H[1]).addScaledVector(tmp, dep + .012);
          armIK(S[1], Ls[1], Lh[1], tgt, hint0, ang, 4);
          armFK(S[1], Ls[1], Lh[1], ang, 4, H[1], HQ[1]);
          c.copy(H[1]).addScaledVector(n, gn).addScaledVector(u, g);
        }
        PQm.makeBasis(x, u, n); Pq.setFromRotationMatrix(PQm);
        // левая: держит другой конец (двумя руками) или своя поза (жест у уха / свободна)
        if (d.two) {
          tgt.copy(c).addScaledVector(u, g).addScaledVector(n, -gn);
          armIK(S[0], Ls[0], Lh[0], tgt, hint.set(-1, -1, 0).normalize(), ang, 0);
          armFK(S[0], Ls[0], Lh[0], ang, 0, H[0], HQ[0]);
        } else if (d.l) ang.set(d.l, 0);
        else ang.fill(0, 0, 4);
        a.set(ang, 6); a[14] = d.sh ? d.sh[0] : 0; a[15] = d.sh ? d.sh[1] : 0;
        mk.fill(d.mt, 0, 3); mk.fill(d.mh, 3, 6); mk.fill(d.ml, 6, 10); mk.fill(1, 10, 16);
        // телефон в осях кисти
        Pqi.copy(HQ[1]).invert();
        const pos = tmp.copy(c).sub(H[1]).applyQuaternion(Pqi).clone(), q = Pqi.clone().multiply(Pq);
        // большие пальцы: где кисть — оттуда палец на экран (в осях телефона)
        const thumb = s => { const iq = Pq.clone().invert(), p = pv().subVectors(H[s], c).applyQuaternion(iq);
          return pv().set(Math.max(-(PHW / 2 - .028), Math.min(PHW / 2 - .028, p.x * .55)), Math.max(-(PHH / 2 - .04), Math.min(PHH / 2 - .04, p.y * .55 + (d.two ? 0 : .035))), PHD / 2 + .02); };
        return { a, mk, pos, q, thR: thumb(1), thL: d.two ? thumb(0) : null };
      };
      ch.phC = { m: PHM.map((d, i) => one(d, i)), pk: one(PH_POCKET, -1) };
      return ch.phC;
    }
    // Состояние телефона человечка (создаётся при первом «достать»; при смене внешности/дальности переносится в новый)
    const phState = () => ({ o: 0, want: -1, w: new Float32Array(4), snapT: -9, manual: false, snapOn: false, ev: 0, env: 0, shL: 0, shR: 0 });
    // события кадра (ch.phS.ev, звуки — у того, кто рисует): 1 — шорох кармана, 2 — касание экрана, 4 — щелчок камеры
    const PHE_POCKET = 1, PHE_TAP = 2, PHE_SHUTTER = 4;
    const PHT = new Float32Array(NPH), PHN = new Float32Array(NPH), PHDN = new Float32Array(NPH);
    // значения суставов режима m в этот миг: калибровка + живое движение по фазе f
    function phMode(ch, m, C, f, S, out){
      out.set(C.m[m].a);
      if (m === 0) {   // в руке: изредка поднимает глаза, большой палец стучит — предплечье чуть вздрагивает
        const g = Math.pow(Math.max(0, Math.sin(f)), 6), tap = Math.max(0, Math.sin(f * 7));
        out[3] -= .34 * g; out[4] *= 1 - g; out[13] -= .035 * tap * tap;
      } else if (m === 1) {   // у уха: кивает, смотрит по сторонам, свободная рука жестикулирует
        out[3] += .05 * Math.sin(5 * f) * (.6 + .4 * Math.sin(2 * f)); out[4] += .1 * Math.sin(f + 1);
        out[6] += .22 * Math.sin(3 * f + .5) + .1 * Math.sin(7 * f); out[7] += .2 * Math.sin(3 * f); out[8] += .12 * Math.sin(2 * f + 1); out[9] += .3 * Math.sin(4 * f + 2);
      } else if (m === 2) {   // играет: наклонился, пальцы бегают — предплечья подрагивают, голова — за игрой
        out[0] += .02 * Math.sin(2 * f); out[4] += .05 * Math.sin(f);
        out[9] += .025 * Math.sin(17 * f); out[13] += .025 * Math.sin(13 * f + 1);
      } else {   // снимает: держит ровно, «щёлк» — руки чуть вперёд
        const s = S.env;
        out[3] += .02 * Math.sin(f); out[9] += .2 * s; out[13] += .2 * s; out[6] -= .08 * s; out[10] -= .08 * s;
      }
    }
    // Слой телефона поверх позы Pt (до перехода между состояниями — смена состояния его тоже сглаживает).
    // cap — можно с телефоном (земля, воздух, сидит); вода, лестница, кувырок, паркур — телефон сразу в карман
    function phoneLayer(ch, Pt, t, dt, o, snap, cat, emw){
      let want = phIdx(o && o.phone != null ? o.phone : ch.phWant);
      let S = ch.phS;
      if (!S) { if (want < 0) return; S = ch.phS = phState(); }
      const cap = cat === 0 || cat === 6 || cat === 7;
      if (!cap) want = -1;
      S.ev = 0; S.want = want;
      const o0 = S.o;
      if (snap) {
        S.o = want < 0 ? 0 : 2 * Math.max(0, Math.min(1, o.phoneK ?? 1));
        if (want >= 0) { S.w.fill(0); S.w[want] = 1; }
      } else if (want >= 0) {
        if (S.o <= 1) { S.w.fill(0); S.w[want] = 1; }   // ещё в кармане — сразу нужный режим
        else { let sum = 0; for (let i = 0; i < 4; i++) { S.w[i] = E3moveTo(S.w[i], i === want ? 1 : 0, dt / .28); sum += S.w[i]; } if (sum > 0) for (let i = 0; i < 4; i++) S.w[i] /= sum; }
        S.o = Math.min(2, S.o + dt * (S.o < 1 ? 1 / .15 : 1 / .35));
      } else {
        S.o = Math.max(0, S.o - dt * (!cap ? 1 / .06 : S.o > 1 ? 1 / .3 : 1 / .15));
        if (!cap && S.o > .99) S.o = .99;   // нельзя с телефоном — в карман сразу
      }
      if (!snap) {   // звуки: достал/убрал (шорох), экран включился/выключился (касание)
        if ((o0 <= 1) !== (S.o <= 1)) S.ev |= PHE_POCKET;
        if ((o0 < 1.75) !== (S.o < 1.75)) S.ev |= PHE_TAP;
      }
      if (S.o <= 0) { S.env = 0; S.shL = S.shR = 0; return; }
      const C = phCal(ch);
      // фаза живого движения: у спрайтов — своя (o.phonePh, цикл замкнут), иначе — по времени и «отпечатку» человечка
      const own = o && o.phonePh != null;
      // «щёлк» камеры: по кнопке (phoneSnap) или сам раз в цикл (чужие, у кого кнопки нет)
      let env = 0;
      if (S.w[3] > .01) {
        if (S.manual) { const x = (t - S.snapT) / .3; env = x >= 0 && x < 1 ? Math.sin(x * PI) : 0; }
        else { const f = own ? o.phonePh : t * TAU / PHM[3].spd + ch.seed * 2, x = ((f % TAU) + TAU) % TAU - 4.9; env = x > 0 && x < 1 ? Math.sin(x * PI) : 0; }
      }
      S.env = env;
      if (!snap && (env > .5) !== S.snapOn) { S.snapOn = env > .5; if (S.snapOn) S.ev |= PHE_SHUTTER; }
      PHN.fill(0); PHDN.fill(0);
      for (let m = 0; m < 4; m++) {
        const w = S.w[m]; if (w < .001) continue;
        phMode(ch, m, C, own ? o.phonePh : t * TAU / PHM[m].spd + ch.seed * 2, S, PHT);
        const mk = C.m[m].mk;
        for (let j = 0; j < NPH; j++) { PHN[j] += w * mk[j] * PHT[j]; PHDN[j] += w * mk[j]; }
      }
      const L = E3smooth(Math.min(1, S.o)) * (1 - emw), r = E3smooth(Math.max(0, S.o - 1)), pk = C.pk;
      for (let j = 0; j < NPH - 2; j++) {
        const ji = PHJ[j], b = Pt[ji];
        Pt[ji] = b + L * ((1 - r) * pk.mk[j] * (pk.a[j] - b) + r * (PHN[j] - PHDN[j] * b));
      }
      S.shL = L * ((1 - r) * pk.a[NPH - 2] + r * PHN[NPH - 2]); S.shR = L * ((1 - r) * pk.a[NPH - 1] + r * PHN[NPH - 1]);   // плечи (без сустава в позе)
    }
    // Новый человечек вместо старого (сменил образ, дальний/ближний): телефон в том же положении, без «достать» заново
    function phoneKeep(from, to){ if (!from || !to || from === to) return; to.phWant = from.phWant; if (from.phS) { to.phS = from.phS; to.phS.snapOn = false; } }
    const E3moveTo = (a, b, d) => Math.abs(b - a) <= d ? b : a + Math.sign(b - a) * d;
    const E3smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

    // ── Корпус: скруглённая плитка, экран-картинка по режиму, мягкое свечение (mid/high), камера и вспышка сзади, большие
    //    пальцы на экране (цвет кисти). Дальний (LOD) и «низкое» качество — проще ──
    const phBodyGeo = () => rbox(PHW, PHH, PHD, .012, 8, 14);
    const phScrGeo = () => geo('phScr', () => new T.PlaneGeometry(PHW - .02, PHH - .032));
    const phGlowGeo = () => geo('phGlow', () => new T.PlaneGeometry(PHW * 1.75, PHH * 1.32));
    // Картинки экрана (128×256, кодом): домашний экран, звонок, игра (телефон боком), камера
    function phTex(name){
      return canvasTex('ph:' + name, 128, 256, (g, w, h) => {
        const rr = (x, y, ww, hh, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + ww, y, x + ww, y + hh, r); g.arcTo(x + ww, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + ww, y, r); g.closePath(); };
        const lin = (x0, y0, x1, y1, st) => { const gr = g.createLinearGradient(x0, y0, x1, y1); for (const [k, c] of st) gr.addColorStop(k, c); return gr; };
        const dot = (x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
        g.textAlign = 'center'; g.textBaseline = 'middle';
        if (name === 'home') {
          g.fillStyle = lin(0, 0, w * .4, h, [[0, '#4c1d95'], [.55, '#be185d'], [1, '#f59e0b']]); g.fillRect(0, 0, w, h);
          dot(26, 70, 38, 'rgba(255,255,255,.1)'); dot(112, 176, 48, 'rgba(255,255,255,.08)');
          g.fillStyle = '#fff'; g.font = '800 34px sans-serif'; g.fillText('12:37', 64, 46); g.font = '700 11px sans-serif'; g.fillText('Мир Денчика', 64, 70);
          const IC = ['#22c55e', '#38bdf8', '#f472b6', '#fbbf24', '#a78bfa', '#fb7185', '#34d399', '#60a5fa', '#f97316', '#e879f9', '#facc15', '#4ade80'];
          for (let i = 0; i < 12; i++) { const x = 13 + (i % 4) * 27, y = 92 + (i / 4 | 0) * 33; g.fillStyle = IC[i]; rr(x, y, 21, 21, 6); g.fill(); dot(x + 10.5, y + 10.5, 4.5, 'rgba(255,255,255,.75)'); }
          g.fillStyle = 'rgba(255,255,255,.22)'; rr(8, 206, 112, 36, 13); g.fill();
          for (let i = 0; i < 4; i++) { g.fillStyle = ['#22c55e', '#34d399', '#818cf8', '#f472b6'][i]; rr(15 + i * 26, 213, 21, 21, 6); g.fill(); }
        } else if (name === 'call') {
          g.fillStyle = lin(0, 0, 0, h, [[0, '#047857'], [1, '#022c22']]); g.fillRect(0, 0, w, h);
          g.strokeStyle = 'rgba(134,239,172,.45)'; g.lineWidth = 4; g.beginPath(); g.arc(64, 88, 41, 0, TAU); g.stroke();
          dot(64, 88, 31, '#e5e7eb'); dot(64, 80, 11, '#9ca3af'); g.fillStyle = '#9ca3af'; g.beginPath(); g.arc(64, 112, 19, PI, TAU); g.fill();
          g.fillStyle = '#fff'; rr(34, 136, 60, 9, 4); g.fill(); g.font = '700 15px sans-serif'; g.fillText('0:37', 64, 162);
          dot(30, 222, 12, 'rgba(255,255,255,.22)'); dot(98, 222, 12, 'rgba(255,255,255,.22)'); dot(64, 222, 17, '#ef4444');
          g.fillStyle = '#fff'; rr(55, 219, 18, 6, 3); g.fill();
        } else if (name === 'game') {   // игра «Птичка» боком: телефон держат горизонтально
          g.translate(w, 0); g.rotate(PI / 2);
          const W2 = h, H2 = w;
          g.fillStyle = lin(0, 0, 0, H2, [[0, '#38bdf8'], [1, '#bae6fd']]); g.fillRect(0, 0, W2, H2);
          dot(40, 26, 12, 'rgba(255,255,255,.85)'); dot(54, 24, 9, 'rgba(255,255,255,.85)'); dot(190, 34, 10, 'rgba(255,255,255,.8)');
          g.fillStyle = '#16a34a'; for (const [x, y0, y1] of [[64, 0, 34], [64, 76, 104], [150, 0, 18], [150, 60, 104], [226, 0, 46], [226, 88, 104]]) { g.fillRect(x, y0, 22, y1 - y0); }
          g.fillStyle = '#65a30d'; g.fillRect(0, 104, W2, 24); g.fillStyle = '#a16207'; g.fillRect(0, 112, W2, 16);
          dot(112, 56, 10, '#facc15'); dot(116, 52, 3.5, '#fff'); dot(117, 52, 1.6, '#111'); g.fillStyle = '#f97316'; g.beginPath(); g.moveTo(121, 56); g.lineTo(129, 58); g.lineTo(121, 61); g.fill();
          g.fillStyle = '#fff'; g.font = '900 22px sans-serif'; g.fillText('37', W2 / 2, 18);
        } else if (name === 'camera') {   // видоискатель — тоже боком (снимают, держа телефон горизонтально)
          g.translate(w, 0); g.rotate(PI / 2);
          const W2 = h, H2 = w, X1 = 210;
          g.fillStyle = lin(0, 0, 0, H2, [[0, '#7dd3fc'], [1, '#e0f2fe']]); g.fillRect(0, 0, W2, H2);
          dot(150, 30, 12, '#fde047'); g.fillStyle = '#4ade80'; g.beginPath(); g.ellipse(60, 128, 100, 44, 0, 0, TAU); g.fill(); g.fillStyle = '#22c55e'; g.beginPath(); g.ellipse(170, 134, 90, 40, 0, 0, TAU); g.fill();
          g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1; for (const k of [1, 2]) { g.beginPath(); g.moveTo(X1 * k / 3, 0); g.lineTo(X1 * k / 3, H2); g.stroke(); g.beginPath(); g.moveTo(0, H2 * k / 3); g.lineTo(X1, H2 * k / 3); g.stroke(); }
          g.fillStyle = 'rgba(0,0,0,.82)'; g.fillRect(X1, 0, W2 - X1, H2);
          g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(233, 64, 16, 0, TAU); g.stroke(); dot(233, 64, 11.5, '#fff');
          g.fillStyle = '#9ca3af'; rr(225, 100, 16, 16, 4); g.fill(); dot(233, 20, 7, 'rgba(255,255,255,.3)');
          g.fillStyle = '#facc15'; g.font = '700 10px sans-serif'; g.fillText('ФОТО', 105, 12);
        }
      });
    }
    // Экран: картинка без света (на «низком» — тусклее: свечения нет), выключенный — чёрный, вспышка — белый
    const phScreen = name => cache(mats, 'phs:' + name, () => name === 'off' ? new T.MeshBasicMaterial({ color: '#07080b' })
      : name === 'flash' ? new T.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
      : new T.MeshBasicMaterial({ map: phTex(name), color: Q === 'low' ? '#a4a9b4' : '#ffffff', toneMapped: false }));
    const phGlowTex = () => canvasTex('phGlow', 64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 6, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.85)'); gr.addColorStop(.55, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    const phGlowMat = () => cache(mats, 'phGlowM', () => new T.MeshBasicMaterial({ map: phGlowTex(), color: '#cfe2ff', transparent: true, opacity: .42, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
    // материалы экранов (движку — свечение: R.bloom на mid/high)
    const phoneMats = () => ['home', 'call', 'game', 'camera', 'flash'].map(phScreen);
    function phoneBuild(ch){
      const g = new T.Group(), lod = !!ch.lod, lowQ = Q === 'low';
      g.name = 'phone'; g.visible = false;
      const items = ch.handR.children.slice();   // предмет в руке (шарик, эмодзи) — прячется, пока в руке телефон
      g.add(new T.Mesh(phBodyGeo(), toon('#23262e')));
      const scr = new T.Mesh(phScrGeo(), phScreen('off')); scr.position.z = PHD / 2 + .0012; g.add(scr);
      let glow = null, flash = null; const thumbs = [];
      if (!lod) {
        if (!lowQ) { glow = new T.Mesh(phGlowGeo(), phGlowMat()); glow.position.z = PHD / 2 + .0004; glow.renderOrder = 6; g.add(glow); }
        M(g, cyl(.024, .024, .01, 12), toon('#0e1015'), PHW / 2 - .044, PHH / 2 - .046, -PHD / 2 - .004, 1, 1, 1, PI / 2, 0, 0);
        M(g, sph(.012, 8, 6), basic('#5b8fd6'), PHW / 2 - .044, PHH / 2 - .046, -PHD / 2 - .009);
        if (!lowQ) { flash = M(g, sph(.011, 8, 6), basic('#fff6c8'), PHW / 2 - .088, PHH / 2 - .04, -PHD / 2 - .004); flash.visible = false; }
        for (let i = 0; i < 2; i++) { const th = new T.Mesh(sph(.04, 10, 8), toon(ch.handC || '#f7cba5')); th.scale.set(1, 1.18, .72); th.visible = false; g.add(th); thumbs.push(th); }
      }
      ch.handR.add(g);
      return { g, scr, glow, flash, thumbs, items, scrK: 'off', shown: false };
    }
    const PPq = pq(), PPq2 = pq(), PPv = pv();
    // Корпус после костей: виден, где в кисти, какой экран, пальцы, вспышка
    function phoneProp(ch, t, o){
      const S = ch.phS; if (!S) return;
      const vis = S.o > 1;
      if (vis && !ch.ph) ch.ph = phoneBuild(ch);
      const ph = ch.ph; if (!ph) return;
      if (ph.shown !== vis) { ph.shown = vis; ph.g.visible = vis; for (const it of ph.items) it.visible = !vis; }
      if (!vis) return;
      const C = ch.phC, r = E3smooth(Math.max(0, S.o - 1)), pk = C.pk;
      // где в кисти: смесь режимов (кватернионы — по одну сторону), из кармана — к ней
      PPv.set(0, 0, 0); PPq.set(0, 0, 0, 0);
      let best = 0, bw = -1;
      for (let m = 0; m < 4; m++) {
        const w = S.w[m]; if (w < .001) continue;
        if (w > bw) { bw = w; best = m; }
        const c = C.m[m], s = PPq.x * c.q.x + PPq.y * c.q.y + PPq.z * c.q.z + PPq.w * c.q.w < 0 ? -w : w;
        PPv.addScaledVector(c.pos, w); PPq.x += c.q.x * s; PPq.y += c.q.y * s; PPq.z += c.q.z * s; PPq.w += c.q.w * s;
      }
      PPq.normalize();
      ph.g.position.copy(pk.pos).lerp(PPv, r);
      ph.g.quaternion.copy(pk.q).slerp(PPq, r);
      // экран: выключен в кармане, включается у лица; «щёлк» — белая вспышка
      const k = S.o < 1.75 ? 'off' : S.env > .55 ? 'flash' : PHM[best].scr;
      if (k !== ph.scrK) { ph.scrK = k; ph.scr.material = phScreen(k); if (ph.glow) ph.glow.visible = k !== 'off'; }
      if (ph.flash) ph.flash.visible = S.env > .55;
      // большие пальцы: в руке (use) — стучит по экрану, играет (play) — оба бегают
      if (ph.thumbs.length) {
        const own = o && o.phonePh != null, f = own ? o.phonePh : t * TAU / PHM[best].spd + ch.seed * 2;
        const onR = r > .7 && (best === 0 || best === 2), onL = r > .7 && best === 2;
        const tR = ph.thumbs[0], tL = ph.thumbs[1];
        tR.visible = onR; tL.visible = onL;
        if (onR) {
          const c = C.m[best];
          if (best === 0) { const tap = Math.max(0, Math.sin(f * 7)); tR.position.set(c.thR.x + .012 * Math.sin(3 * f), c.thR.y + .015 * Math.sin(2 * f + 1), c.thR.z - .014 * tap * tap); }
          else tR.position.set(c.thR.x + .01 * Math.sin(11 * f), c.thR.y + .008 * Math.cos(9 * f), c.thR.z - .012 * Math.max(0, Math.sin(17 * f)));
        }
        if (onL) { const c = C.m[2]; tL.position.set(c.thL.x + .01 * Math.cos(10 * f), c.thL.y + .008 * Math.sin(12 * f), c.thL.z - .012 * Math.max(0, Math.sin(13 * f + 1))); }
      }
    }
    // ── От 1-го лица (как в ГТА): своего человечка не видно — у камеры кисть с телефоном внизу экрана, рукав, вторая кисть
    //    (игра, камера). Рисуется поверх мира (свои материалы без глубины), плавно поднимается снизу и опускается.
    //    v = phoneView(ch) → v.g (в сцену), v.place(camera, ch, t, bob) каждый кадр (bob: { ph, w, k } — покачивание камеры), v.dispose()
    // режимы (в осях камеры): где телефон, поворот (x, y, z), где кисти — в осях телефона (вторая — только двумя руками)
    const VM = [
      { p: [.17, -.23, -.64], r: [-.42, .22, .1], hr: [.095, -.1, -.035], hl: null },
      { p: [.36, -.19, -.42], r: [.05, -1.2, .2], hr: [.08, -.09, -.035], hl: null },
      { p: [0, -.21, -.62], r: [-.36, 0, PI / 2], hr: [0, -.16, -.035], hl: [0, .16, -.035] },
      { p: [.02, -.15, -.6], r: [-.1, 0, PI / 2], hr: [0, -.16, -.035], hl: [0, .16, -.035] },
    ];
    const VMS = .85;   // телефон от 1-го лица чуть меньше (как в ГТА: внизу экрана, видна кисть)
    const vmQ = VM.map(v => new T.Quaternion().setFromEuler(new T.Euler(v.r[0], v.r[1], v.r[2], 'YXZ')));
    const VMv = pv(), VMv2 = pv(), VMq = pq(), VMup = new T.Vector3(0, 1, 0), VMe = new T.Euler();
    function phoneView(ch){
      // материалы поверх мира: копия без проверки глубины (порядок — renderOrder: рукав, кисть, телефон, экран, пальцы)
      const top = (m, k) => cache(mats, 'vm:' + k, () => { const c = m.clone(); c.depthTest = false; c.depthWrite = false; return c; });
      const sleeve = ['tshirt', 'jersey', 'dress'].includes(ch.R.top) || isArmor(ch.R.psar) ? ch.handC : colorOf(ch.R, 'color');
      const g = new T.Group(), hold = new T.Group(), phone = new T.Group();
      g.visible = false; g.add(hold); hold.add(phone); phone.scale.setScalar(VMS);
      const mk = (geom, mat, ro, parent) => { const m = new T.Mesh(geom, mat); m.renderOrder = ro; m.frustumCulled = false; (parent || hold).add(m); return m; };
      mk(phBodyGeo(), top(toon('#23262e'), 'body'), 993, phone);
      const scr = mk(phScrGeo(), top(phScreen('home'), 'home'), 994, phone); scr.position.z = PHD / 2 + .0012;
      const hands = [0, 1].map(s => mk(sph(.07, 16, 12), top(toon(ch.handC || '#f7cba5'), 'h' + ch.handC), 992));
      for (const h of hands) h.scale.set(1, 1.1, .82);
      const arms = [0, 1].map(s => mk(cap(.055, .5, 12), top(toon(sleeve), 's' + sleeve), 991));
      const thumb = mk(sph(.026, 10, 8), top(toon(ch.handC || '#f7cba5'), 'h' + ch.handC), 995, phone); thumb.scale.set(1, 1.2, .7);
      let scrK = 'home';
      const ELB = [pv().set(-.42, -.66, -.12), pv().set(.42, -.66, -.12)];
      return {
        g,
        place(camera, ch2, t, bob){
          const S = ch2.phS, on = !!S && S.o > 1;
          g.visible = on; if (!on) return;
          g.position.copy(camera.position); g.quaternion.copy(camera.quaternion);
          const r = E3smooth(S.o - 1);
          let bw = -1, best = 0; VMv.set(0, 0, 0); VMq.set(0, 0, 0, 0);
          for (let m = 0; m < 4; m++) {
            const w = S.w[m]; if (w < .001) continue;
            if (w > bw) { bw = w; best = m; }
            const q = vmQ[m], s = VMq.dot(q) < 0 ? -w : w;
            VMv.x += VM[m].p[0] * w; VMv.y += VM[m].p[1] * w; VMv.z += VM[m].p[2] * w;
            VMq.x += q.x * s; VMq.y += q.y * s; VMq.z += q.z * s; VMq.w += q.w * s;
          }
          VMq.normalize();
          // поднимается снизу (достал) и уходит вниз (убрал); на ходу — покачивание (настройка «Покачивание камеры»)
          const k = bob ? bob.k : 0, bw2 = bob ? bob.w : 0, bp = bob ? bob.ph : 0;
          phone.position.set(VMv.x + Math.cos(bp) * .009 * bw2 * k, VMv.y - .5 * (1 - r) - Math.abs(Math.sin(bp)) * .013 * bw2 * k + Math.sin(t * 1.3) * .003, VMv.z);
          VMe.set(-.7 * (1 - r), 0, 0); phone.quaternion.setFromEuler(VMe).multiply(VMq);
          // экран — как у человечка
          const sk = S.o < 1.75 ? 'off' : S.env > .55 ? 'flash' : PHM[best].scr;
          if (sk !== scrK) { scrK = sk; scr.material = top(phScreen(sk), sk); }
          // кисти: правая всегда, левая — пока режим «двумя руками» (иначе ушла вниз за край)
          const two = S.w[2] + S.w[3], d = VM[best];
          for (let s = 0; s < 2; s++) {
            const hp = s ? (d.hr || VM[0].hr) : (d.hl || VM[2].hl), h = hands[s];
            h.position.set(hp[0] * VMS, hp[1] * VMS, hp[2] * VMS).applyQuaternion(phone.quaternion).add(phone.position);
            if (!s) h.position.y -= .45 * (1 - Math.min(1, two));
            h.visible = s === 1 || two > .05;
            // рукав: от кисти к локтю за краем экрана
            VMv2.subVectors(ELB[s], h.position); const L = VMv2.length();
            arms[s].visible = h.visible; arms[s].position.copy(h.position).addScaledVector(VMv2, .5);
            arms[s].quaternion.setFromUnitVectors(VMup, VMv2.multiplyScalar(1 / L)); arms[s].scale.set(1, L / .6, 1);
          }
          // большой палец стучит по экрану (в руке и в игре)
          thumb.visible = r > .7 && (best === 0 || best === 2);
          if (thumb.visible) { const f = t * 6; thumb.position.set(best === 2 ? .02 * Math.sin(f * 2) : .028 + .01 * Math.sin(f * .5), best === 2 ? -.085 : -.05 + .012 * Math.sin(f * .7), PHD / 2 + .02 - .01 * Math.max(0, Math.sin(f * (best === 2 ? 2.6 : 1.2)))); }
        },
        dispose(){ g.parent?.remove(g); },
      };
    }

    // ── Анимация: поза из состояния → плавный переход → кости ──
    // o (движок): rate — частота шага (бег быстрее), air, sit, crouch, roll, hang, ladder, pk, swim/dive, crawl; look — куда смотреть {x, y, z}
    const mx = (P, j, v, w) => { P[j] += (v - P[j]) * w; };
    function keyed(Pt, frames, k){
      let i = 0;
      while (i < frames.length - 2 && k > frames[i + 1][0]) i++;
      const k0 = frames[i][0], A = frames[i][1], k1 = frames[i + 1][0], Bf = frames[i + 1][1], u = Math.max(0, Math.min(1, (k - k0) / Math.max(1e-4, k1 - k0))), w = u * u * (3 - 2 * u);
      for (let j = 0; j < NJ; j++) Pt[j] = A[j] + (Bf[j] - A[j]) * w;
    }
    function ground(ch, Pt, t){
      const s = Math.sin(ch.phase), c = Math.cos(ch.phase), w = ch.wMove, wr = ch.wRun, iw = 1 - w, sd = ch.seed;
      const br = Math.sin(t * 2.4 + sd);
      // стойка: дыхание, вес с ноги на ногу, руки чуть качаются
      Pt[J.TS] = 1 + br * .012 * iw;
      Pt[J.HZ] = Math.sin(t * .9 + sd) * .035 * iw;
      Pt[J.BRZ] = Math.sin(t * .6 + sd) * .012 * iw + s * .03 * w;
      Pt[J.ALZ] = -.16 - br * .015 * iw; Pt[J.ARZ] = .16 + br * .015 * iw;
      // шаг и бег: бёдра, колени (сгиб в маховой фазе), руки навстречу ногам, локти, таз и плечи навстречу друг другу
      const A = .62 + .3 * wr, Aa = .55 + .4 * wr, Kw = .8 + .6 * wr;
      Pt[J.LLX] = s * A * w; Pt[J.LRX] = -s * A * w;
      Pt[J.KL] = .05 + (Math.max(0, -c) * Kw + .07 * Math.max(0, c)) * w;
      Pt[J.KR] = .05 + (Math.max(0, c) * Kw + .07 * Math.max(0, -c)) * w;
      Pt[J.ALX] = -s * Aa * w + Math.sin(t * .8 + sd) * .03 * iw; Pt[J.ARX] = s * Aa * w - Math.sin(t * .8 + sd) * .03 * iw;
      Pt[J.EL] = -.12 - (.18 + .55 * wr + .32 * Math.max(0, s)) * w;
      Pt[J.ER] = -.12 - (.18 + .55 * wr + .32 * Math.max(0, -s)) * w;
      Pt[J.BY] = Math.abs(c) * (.05 + .045 * wr) * w;
      Pt[J.BRY] = -s * (.08 + .04 * wr) * w;
      Pt[J.TY] = s * (.17 + .1 * wr) * w;
      Pt[J.TX] = (.06 + .12 * wr) * w;
      Pt[J.HY] = -s * .1 * w; Pt[J.HX] = -(.03 + .07 * wr) * w;
    }
    // o.snap — поза сразу по (ch.phase, t, o): без сглаживания, переходов и случайного моргания (запекание спрайтов,
    // картинки). o.land 0…1 — приземление, o.blink — закрыть глаза. Остальное как обычно
    function animate(ch, moving, dt, t, o){
      dt = Math.min(Math.max(dt || 0, 0), .1);
      const rate = o?.rate || 10.5, Pt = ch.Pt, P = ch.P, snap = !!o?.snap, runW = Math.max(0, Math.min(1, (rate - 10) / 3));
      if (moving) ch.phase += dt * rate;
      if (snap) { ch.wMove = moving ? 1 : 0; ch.wRun = runW; }
      else { ch.wMove += ((moving ? 1 : 0) - ch.wMove) * Math.min(1, dt * 9); ch.wRun += (runW - ch.wRun) * Math.min(1, dt * 5); }
      const mv = moving ? 1 : 0, s = Math.sin(ch.phase);
      // состояние (у паркура и воды — свои подсостояния, между ними тоже плавно)
      const cat = !o ? 0 : o.roll >= 0 ? 1 : o.hang ? 2 : o.ladder ? 3 : o.pk ? (o.pk === 'vault' ? 4 : o.pk === 'hang' ? 8 : 9)
        : o.swim ? (o.dive ? 10 : moving ? 5 : 11) : o.crawl ? 12 : o.lie ? 13 : o.air ? 6 : o.sit ? 7 : 0;
      if (cat !== ch.cat) {
        ch.Ps.set(P); ch.Ps[J.BX] = wrapA(ch.Ps[J.BX]); ch.Ps[J.BRY] = wrapA(ch.Ps[J.BRY]); ch.Ps[J.BRZ] = wrapA(ch.Ps[J.BRZ]);
        if (ch.cat === 6 && cat === 0 && !snap) { ch.land = 1; ch.xd = .08; } else ch.xd = XD[cat];
        ch.xf = snap ? 1 : 0; ch.cat = cat;
      }
      Pt.set(REST);
      if (cat === 0) ground(ch, Pt, t);
      else if (cat === 1) {   // кувырок клубком через голову (назад — в обратную сторону)
        const k = o.roll, curl = Math.sin(Math.min(1, k * 1.08) * PI), a = (o.rollBack ? -1 : 1) * TAU * k * k * (3 - 2 * k), hc = (ch.top || 2.3) * .45;
        Pt[J.BS] = 1 - .28 * curl; Pt[J.BX] = a; Pt[J.BY] = hc * (1 - Math.cos(a)); Pt[J.BZ] = -hc * Math.sin(a);
        Pt[J.LLX] = Pt[J.LRX] = -1.25 * curl; Pt[J.KL] = Pt[J.KR] = .05 + 2.0 * curl;
        Pt[J.ALX] = Pt[J.ARX] = -1.3 * curl; Pt[J.EL] = Pt[J.ER] = -.12 - 1.3 * curl; Pt[J.ALZ] = -.3; Pt[J.ARZ] = .3;
        Pt[J.HX] = .45 * curl; Pt[J.TX] = .5 * curl;
      } else if (cat === 2) {   // вис: руки на краю, ноги болтаются; по краю — перехват руками
        const q = Math.sin(t * 2.1);
        Pt[J.ALX] = -2.95; Pt[J.ARX] = -2.95; Pt[J.EL] = Pt[J.ER] = -.15;
        Pt[J.ALZ] = -.14 - (mv ? Math.max(0, s) * .3 : 0); Pt[J.ARZ] = .14 + (mv ? Math.max(0, -s) * .3 : 0);
        Pt[J.LLX] = q * .12 + (mv ? s * .2 : 0); Pt[J.LRX] = -q * .1 - (mv ? s * .2 : 0); Pt[J.KL] = .25 + q * .08; Pt[J.KR] = .3 - q * .08;
        Pt[J.TX] = -.06; Pt[J.HX] = -.18;
      } else if (cat === 3) {   // лестница: руки и ноги по очереди, колени и локти сгибаются
        const q = Math.sin(o.climbPh || 0);
        Pt[J.ALX] = -2.5 - q * .45; Pt[J.ARX] = -2.5 + q * .45; Pt[J.ALZ] = -.1; Pt[J.ARZ] = .1;
        Pt[J.EL] = -.45 - Math.max(0, q) * .6; Pt[J.ER] = -.45 - Math.max(0, -q) * .6;
        Pt[J.LLX] = -.35 - Math.max(0, q) * .7; Pt[J.LRX] = -.35 - Math.max(0, -q) * .7;
        Pt[J.KL] = .45 + Math.max(0, q) * 1.0; Pt[J.KR] = .45 + Math.max(0, -q) * 1.0;
        Pt[J.TX] = -.05; Pt[J.HX] = -.2;
      } else if (cat === 4 || cat === 8 || cat === 9) {   // паркур: ключевые позы по прогрессу
        keyed(Pt, cat === 4 ? PK.vault : cat === 8 ? PK.hang : PK.up, o.pkK || 0);
      } else if (cat === 5 || cat === 10 || cat === 11) {   // вода: кроль на ходу, на месте — держится (руки «гребут восьмёркой», ноги крутят), нырок — рыбкой
        if (cat === 10) {
          const q = Math.sin(t * 8);
          Pt[J.BX] = 1.4; Pt[J.ALX] = Pt[J.ARX] = -2.95; Pt[J.ALZ] = .08; Pt[J.ARZ] = -.08; Pt[J.EL] = Pt[J.ER] = -.05;
          Pt[J.LLX] = q * .3; Pt[J.LRX] = -q * .3; Pt[J.KL] = .15 + .25 * Math.max(0, q); Pt[J.KR] = .15 + .25 * Math.max(0, -q); Pt[J.HX] = -.3;
        } else if (cat === 5) {
          const a = (t * 3.4 + ch.seed) % TAU, b = (a + PI) % TAU, q = Math.sin(t * 9);
          Pt[J.BX] = 1.15; Pt[J.BRY] = Math.sin(a) * .22;
          Pt[J.ALX] = -PI + a; Pt[J.ARX] = -PI + b; Pt[J.ALZ] = -.25; Pt[J.ARZ] = .25;
          Pt[J.EL] = -.25 - .85 * Math.max(0, Math.sin(a)); Pt[J.ER] = -.25 - .85 * Math.max(0, Math.sin(b));
          Pt[J.LLX] = q * .28; Pt[J.LRX] = -q * .28; Pt[J.KL] = .12 + .25 * Math.max(0, -q); Pt[J.KR] = .12 + .25 * Math.max(0, q);
          Pt[J.HX] = -.85; Pt[J.HY] = .65 * Math.pow(Math.max(0, Math.sin(a * .5)), 4);
        } else {
          const q = Math.sin(t * 2.6 + ch.phase), c3 = Math.sin(t * 3);
          Pt[J.BX] = .3; Pt[J.BY] = -.75 + Math.sin(t * 1.7) * .05;
          Pt[J.ALX] = -.9 + q * .35; Pt[J.ALZ] = -.9 - q * .15; Pt[J.ARX] = -.9 - q * .35; Pt[J.ARZ] = .9 + q * .15; Pt[J.EL] = Pt[J.ER] = -.45;
          Pt[J.LLX] = -.3 + c3 * .35; Pt[J.LRX] = -.3 - c3 * .35; Pt[J.KL] = .6 + .4 * Math.sin(t * 3 + 1); Pt[J.KR] = .6 + .4 * Math.sin(t * 3 + 1 + PI);
          Pt[J.HX] = -.15;
        }
      } else if (cat === 12) {   // ползком: лёг на живот (середина тела — над местом), руки тянутся вперёд по очереди, ноги толкаются
        const k = (ch.top || 2.3) / 2.3, w = ch.wMove, q = Math.sin(ch.phase * .75), br = Math.sin(t * 2.4 + ch.seed);
        Pt[J.BX] = 1.48; Pt[J.BY] = .22 * k; Pt[J.BZ] = -.9 * k;
        Pt[J.HX] = -.82 + br * .02;
        Pt[J.ALX] = -2.55 - q * .55 * w; Pt[J.ARX] = -2.55 + q * .55 * w; Pt[J.ALZ] = -.42; Pt[J.ARZ] = .42;
        Pt[J.EL] = -.75 - Math.max(0, q) * .65 * w; Pt[J.ER] = -.75 - Math.max(0, -q) * .65 * w;
        Pt[J.LLX] = .08 + q * .32 * w; Pt[J.LRX] = .08 - q * .32 * w; Pt[J.LLZ] = -.16; Pt[J.LRZ] = .16;
        Pt[J.KL] = .3 + Math.max(0, -q) * .85 * w; Pt[J.KR] = .3 + Math.max(0, q) * .85 * w;
        Pt[J.BRY] = q * .06 * w; Pt[J.TS] = 1 + br * .012 * (1 - w);
      } else if (cat === 13) {   // лежит на спине: тело назад (голова — к −z места), середина тела — над местом, руки вдоль тела, дышит
        const k = (ch.top || 2.3) / 2.3, br = Math.sin(t * 1.6 + ch.seed);
        Pt[J.BX] = -1.5; Pt[J.BY] = .2 * k; Pt[J.BZ] = .9 * k;
        Pt[J.HX] = -.06; Pt[J.HZ] = Math.sin(t * 1.6 + ch.seed + 1.2) * .04;   // частота = дыхание (цикл спрайта «lie» = TAU/1.6 замкнут)
        Pt[J.ALX] = -.08; Pt[J.ARX] = -.08; Pt[J.ALZ] = -.2; Pt[J.ARZ] = .2; Pt[J.EL] = Pt[J.ER] = -.18;
        Pt[J.LLX] = Pt[J.LRX] = .02; Pt[J.LLZ] = -.05; Pt[J.LRZ] = .05; Pt[J.KL] = Pt[J.KR] = .06;
        Pt[J.TS] = 1 + br * .02;
      } else if (cat === 6) {   // в воздухе: ноги врозь, колено к груди, руки вверх-в стороны
        Pt[J.LLX] = -.6; Pt[J.KL] = .75; Pt[J.LRX] = .4; Pt[J.KR] = .35;
        Pt[J.ALX] = -.5; Pt[J.ALZ] = -.75; Pt[J.ARX] = -.5; Pt[J.ARZ] = .75; Pt[J.EL] = Pt[J.ER] = -.35; Pt[J.TX] = .05; Pt[J.HX] = -.08;
      } else {   // сидит: бёдра вперёд, голени вниз, руки на коленях
        Pt[J.LLX] = Pt[J.LRX] = -1.45; Pt[J.KL] = Pt[J.KR] = 1.42;
        Pt[J.ALX] = Pt[J.ARX] = -.62; Pt[J.ALZ] = -.12; Pt[J.ARZ] = .12; Pt[J.EL] = Pt[J.ER] = -.55; Pt[J.TX] = -.04;
        Pt[J.TS] = 1 + Math.sin(t * 2.4 + ch.seed) * .01;
      }
      // присед: колени сгибаются, корпус вперёд, по-мультяшному сжимается (плавно — у чужих по сети приходит рывком)
      const cwT = cat === 0 ? o?.crouch || 0 : 0;
      ch.cw = snap ? cwT : ch.cw + (cwT - ch.cw) * Math.min(1, dt * 12);
      if (snap) ch.land = o.land || 0;
      const cw = ch.cw;
      if (cw > .01) {
        Pt[J.SQ] = 1 - .2 * cw; Pt[J.BY] -= .035 * cw; Pt[J.TX] += .28 * cw;
        Pt[J.LLX] -= .45 * cw; Pt[J.LRX] -= .45 * cw; Pt[J.KL] += .9 * cw; Pt[J.KR] += .9 * cw;
        Pt[J.ALX] -= .35 * cw; Pt[J.ARX] -= .35 * cw; Pt[J.EL] -= .3 * cw; Pt[J.ER] -= .3 * cw;
      }
      // приземление: присел и выпрямился
      if (ch.land > 0) {
        const q = ch.land * ch.land;
        Pt[J.SQ] *= 1 - .16 * q; Pt[J.KL] += .55 * q; Pt[J.KR] += .55 * q; Pt[J.LLX] -= .3 * q; Pt[J.LRX] -= .3 * q; Pt[J.ALZ] -= .25 * q; Pt[J.ARZ] += .25 * q; Pt[J.TX] += .15 * q;
        if (!snap) ch.land = Math.max(0, ch.land - dt * 4);
      }
      // эмоции (только на земле): плавно входят и выходят
      if (cat !== 0 && cat !== 6 && cat !== 7) ch.emote = null;   // кувырок, вис, лестница, паркур, вода — не до эмоций
      const e = ch.emote, el = t - ch.emoteT, dur = EMO_T[e] || 1.6;
      let emw = 0;   // вес эмоции (телефон в это время уступает руки)
      if (e && el >= 0 && el < dur) {
        const w = Math.max(0, Math.min(1, el / .15, (dur - el) / .25)), k = el * 10;
        emw = w;
        if (e === '👋') { mx(Pt, J.ARX, -2.7, w); mx(Pt, J.ARZ, .3 + Math.sin(k) * .45, w); mx(Pt, J.ER, -.35 + Math.sin(k) * .2, w); mx(Pt, J.HZ, .1, w); mx(Pt, J.TY, -.12, w); }
        else if (e === '🎉') { const j = Math.max(0, Math.sin(k * .8)); Pt[J.BY] += j * .45 * w; mx(Pt, J.ALX, -2.9, w); mx(Pt, J.ALZ, -.35, w); mx(Pt, J.ARX, -2.9, w); mx(Pt, J.ARZ, .35, w); mx(Pt, J.EL, -.2, w); mx(Pt, J.ER, -.2, w); Pt[J.KL] += j * .5 * w; Pt[J.KR] += j * .5 * w; }
        else if (e === '🔥') { const j = Math.max(0, Math.sin(k * .8)); Pt[J.BY] += j * .5 * w; mx(Pt, J.ARX, -2.6, w); mx(Pt, J.ER, -1.2, w); mx(Pt, J.ALX, -.5, w); mx(Pt, J.EL, -1.4, w); Pt[J.KL] += j * .4 * w; }
        else if (e === '👍') { mx(Pt, J.ARX, -1.4, w); mx(Pt, J.ARZ, .1, w); mx(Pt, J.ER, -.25, w); Pt[J.HX] += Math.sin(k * .6) * .1 * w; mx(Pt, J.HZ, -.12, w); }
        else if (e === '😂') { Pt[J.BRZ] += Math.sin(k * 2) * .12 * w; mx(Pt, J.HX, -.2, w); mx(Pt, J.ALX, -.45, w); mx(Pt, J.EL, -1.6, w); mx(Pt, J.ALZ, .3, w); mx(Pt, J.ARX, -.5, w); mx(Pt, J.ER, -1.5, w); mx(Pt, J.TX, .12 + Math.sin(k * 2) * .05, w); }
        else if (e === '❤️') { mx(Pt, J.ALX, -.95, w); mx(Pt, J.ALZ, .5, w); mx(Pt, J.EL, -1.9, w); mx(Pt, J.ARX, -.95, w); mx(Pt, J.ARZ, -.5, w); mx(Pt, J.ER, -1.9, w); mx(Pt, J.HZ, Math.sin(k * .5) * .15, w); mx(Pt, J.HX, .1, w); }
        else if (e === '😎') { mx(Pt, J.ALX, -.7, w); mx(Pt, J.ALZ, .55, w); mx(Pt, J.EL, -2.0, w); mx(Pt, J.ARX, -.6, w); mx(Pt, J.ARZ, -.5, w); mx(Pt, J.ER, -2.0, w); Pt[J.HX] += Math.sin(k) * .12 * w; mx(Pt, J.TX, -.08, w); }
        else if (e === '😭') { mx(Pt, J.ALX, -2.0, w); mx(Pt, J.ALZ, .4, w); mx(Pt, J.EL, -2.1, w); mx(Pt, J.ARX, -2.0, w); mx(Pt, J.ARZ, -.4, w); mx(Pt, J.ER, -2.1, w); mx(Pt, J.HX, .3, w); Pt[J.BRZ] += Math.sin(k * 3) * .03 * w; Pt[J.TS] += Math.sin(k * 3) * .02 * w; }
        else if (e === '💃') {
          const d = Math.sin(k * .55);
          Pt[J.BRZ] += d * .14 * w; Pt[J.BY] += Math.abs(Math.cos(k * .55)) * .08 * w; mx(Pt, J.BRY, d * .25, w);
          mx(Pt, J.ALX, -1.55 - 1.25 * d, w); mx(Pt, J.ARX, -1.55 + 1.25 * d, w); mx(Pt, J.ALZ, -.4, w); mx(Pt, J.ARZ, .4, w); mx(Pt, J.EL, -.5, w); mx(Pt, J.ER, -.5, w);
          mx(Pt, J.LLX, -Math.max(0, d) * .5, w); mx(Pt, J.LRX, -Math.max(0, -d) * .5, w); mx(Pt, J.KL, .1 + Math.max(0, d) * .7, w); mx(Pt, J.KR, .1 + Math.max(0, -d) * .7, w); mx(Pt, J.HZ, -d * .12, w);
        } else if (e === '👏') { const c2 = .5 + .5 * Math.sin(k * 2.2); mx(Pt, J.ALX, -1.25, w); mx(Pt, J.ARX, -1.25, w); mx(Pt, J.ALZ, .15 + .35 * c2, w); mx(Pt, J.ARZ, -.15 - .35 * c2, w); mx(Pt, J.EL, -.9, w); mx(Pt, J.ER, -.9, w); Pt[J.BY] += Math.abs(Math.sin(k * .5)) * .04 * w; }
        else if (e === '🤔') { mx(Pt, J.ARX, -1.75, w); mx(Pt, J.ARZ, -.38, w); mx(Pt, J.ER, -2.35, w); mx(Pt, J.ALX, -.75, w); mx(Pt, J.ALZ, .6, w); mx(Pt, J.EL, -1.7, w); mx(Pt, J.HZ, .18, w); mx(Pt, J.HX, -.14, w); mx(Pt, J.TY, .1, w); }
        else if (e === '😮') { mx(Pt, J.ALX, -2.3, w); mx(Pt, J.ALZ, .22, w); mx(Pt, J.EL, -2.2, w); mx(Pt, J.ARX, -2.3, w); mx(Pt, J.ARZ, -.22, w); mx(Pt, J.ER, -2.2, w); mx(Pt, J.TX, -.14, w); mx(Pt, J.HX, -.1, w); }
        else if (e === '😡') { const st = Math.sin(k * 1.4); mx(Pt, J.LLX, -.45 * Math.max(0, st), w); mx(Pt, J.KL, .1 + .7 * Math.max(0, st), w); mx(Pt, J.ALX, .2, w); mx(Pt, J.ALZ, -.45, w); mx(Pt, J.EL, -.6, w); mx(Pt, J.ARX, .2, w); mx(Pt, J.ARZ, .45, w); mx(Pt, J.ER, -.6, w); mx(Pt, J.TX, .15, w); Pt[J.BRZ] += Math.sin(k * 3) * .04 * w; mx(Pt, J.HX, .12, w); }
        else if (e === '🙇') { const b = Math.sin(Math.min(1, el / dur) * PI); mx(Pt, J.TX, .95 * b, w); mx(Pt, J.HX, .25 * b, w); mx(Pt, J.ALX, -.3, w); mx(Pt, J.ALZ, .3, w); mx(Pt, J.EL, -.6, w); mx(Pt, J.ARX, -.3, w); mx(Pt, J.ARZ, -.3, w); mx(Pt, J.ER, -.6, w); }
        else if (e === '🤸') {   // сальто назад
          const u = Math.min(1, el / dur), a = -TAU * u * u * (3 - 2 * u), hc = (ch.top || 2.3) * .45, tk = Math.sin(u * PI);
          Pt[J.BX] = a; Pt[J.BY] = hc * (1 - Math.cos(a)) + tk * .9; Pt[J.BZ] = -hc * Math.sin(a);
          Pt[J.LLX] = Pt[J.LRX] = -1.2 * tk; Pt[J.KL] = Pt[J.KR] = .05 + 1.8 * tk; Pt[J.ALX] = Pt[J.ARX] = -2.6 + 1.2 * tk; Pt[J.EL] = Pt[J.ER] = -.2 - .8 * tk;
        }
      } else if (e) ch.emote = null;
      // взгляд: голова (и чуть плечи) поворачивается к точке o.look — к камере или соседу; за спиной — не выворачивается
      let ly = 0, lx = 0;
      if (o?.look && (cat === 0 || cat === 7) && !ch.emote) {
        const r = ch.root.position, dx = o.look.x - r.x, dz = o.look.z - r.z, dd = Math.hypot(dx, dz);
        if (dd > .3) {
          const a = wrapA(Math.atan2(dx, dz) - ch.root.rotation.y);
          if (Math.abs(a) < 1.9) { ly = Math.max(-1, Math.min(1, a)); lx = Math.max(-.45, Math.min(.35, -Math.atan2(o.look.y - (r.y + (ch.headY || 1.6)), dd))); }
        }
      }
      const kl = snap ? 1 : Math.min(1, dt * 5);
      ch.lookY += (ly - ch.lookY) * kl; ch.lookX += (lx - ch.lookX) * kl;
      Pt[J.HY] += ch.lookY * .75; Pt[J.TY] += ch.lookY * .25 * (1 - ch.wMove); Pt[J.HX] += ch.lookX;
      // руки и предметы (бой, инструменты): только если игра дала o.hold — иначе позы как были
      if (o && o.hold) { HN[0] = dt; HN[1] = t; HN[2] = emw; holdLayer(ch, Pt, o.hold, snap, cat); }
      // телефон 📱: руки, голова, плечи — поверх позы (ноги свои: идёт и пишет, как в ГТА)
      if (ch.phS || (o && o.phone) || ch.phWant) phoneLayer(ch, Pt, t, dt, o, snap, cat, emw);
      // плавный переход между состояниями
      if (ch.xf < 1 && !snap) {
        ch.xf = Math.min(1, ch.xf + dt / ch.xd);
        const k = ch.xf * ch.xf * (3 - 2 * ch.xf), Ps = ch.Ps;
        for (let i = 0; i < NJ; i++) P[i] = Ps[i] + (Pt[i] - Ps[i]) * k;
      } else P.set(Pt);
      // кости
      const b = ch.body, sq = P[J.SQ], sx = P[J.BS] * (1 + (1 - sq) * .45);
      b.position.y = P[J.BY]; b.position.z = P[J.BZ]; b.rotation.set(P[J.BX], P[J.BRY], P[J.BRZ]); b.scale.set(sx, P[J.BS] * sq, sx);
      ch.torso.rotation.set(P[J.TX], P[J.TY], P[J.TZ]); ch.torso.scale.y = P[J.TS];
      ch.headP.rotation.set(P[J.HX], P[J.HY], P[J.HZ]);
      ch.armL.rotation.set(P[J.ALX], P[J.ALY], P[J.ALZ]); ch.elbowL.rotation.x = P[J.EL];
      ch.armR.rotation.set(P[J.ARX], P[J.ARY], P[J.ARZ]); ch.elbowR.rotation.x = P[J.ER];
      const PS = ch.phS; ch.armL.position.y = ch.armL.userData.y0 + (PS ? PS.shL : 0); ch.armR.position.y = ch.armR.userData.y0 + (PS ? PS.shR : 0);
      ch.legL.rotation.set(P[J.LLX], 0, P[J.LLZ]); ch.kneeL.rotation.x = P[J.KL];
      ch.legR.rotation.set(P[J.LRX], 0, P[J.LRZ]); ch.kneeR.rotation.x = P[J.KR];
      // лицо: выражение по эмоции, моргание
      const want = ch.emote ? EMO_EXPR[ch.emote] || 'base' : 'base';
      if (want !== ch.expr) setExpr(ch, want);
      const fs = ch.faceSet;
      if (fs && fs.userData.eyes && cat === 13 && o.sleep) fs.userData.eyes.scale.y = .12;   // спит — глаза закрыты
      else if (fs && fs.userData.blink && fs.userData.eyes) fs.userData.eyes.scale.y = (snap ? !!o.blink : (t + ch.blinkAt) % 4 > 3.86) ? .12 : 1;
      for (let i = 0; i < ch.anims.length; i++) ch.anims[i](t, dt, mv, s);
      if (ch.phS) phoneProp(ch, t, o);   // корпус телефона в кисти, экран, пальцы
    }
    function dispose(ch){
      if (!ch) return;
      ch.root.parent?.remove(ch.root);
      if (ch.pet) { ch.pet.parent?.remove(ch.pet); ch.pet.material.dispose(); }
      for (const set of ch.sets.values()) if (!set.parent) set.traverse(o => { if (o.isMesh && o.userData.own) o.geometry.dispose(); });
      ch.root.traverse(o => {
        if (o.isSprite) o.material.dispose();
        if (o.isMesh && o.userData.own) o.geometry.dispose();
        if (o.isMesh && o.material.userData?.own) o.material.dispose();
      });
    }
    // ── След за бегущим: эмодзи из гардероба, радуга — цветные кружки ──
    function trails(scene){
      const pool = [], live = [];
      const dot = cache(texs, 'dot', () => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 2, 16, 16, 15); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); const t = new T.CanvasTexture(c); return t; });
      function emit(trail, x, y, z, t){
        if (!trail || trail === 'none') return;
        let s = pool.pop();
        if (!s) { s = new T.Sprite(new T.SpriteMaterial({ map: dot, transparent: true, depthWrite: false })); scene.add(s); }
        s.visible = true;
        if (trail === 'rainbow') { s.material.map = dot; s.material.color.setHSL((t * .6) % 1, .9, .6); s.scale.setScalar(.32); }
        else if (trail === 'gems') {   // кристаллы (только за 💎): камешки и искорки голубого, сиреневого, розового
          if (Math.random() < .5) { s.material.map = emojiTex('💎'); s.material.color.set('#ffffff'); s.scale.setScalar(.3); }
          else { s.material.map = dot; s.material.color.setHSL(.5 + Math.random() * .4, .9, .72); s.scale.setScalar(.24); }
        }
        else { const e = partV('trail', trail, ''); if (!e) { pool.push(s); s.visible = false; return; } s.material.map = emojiTex(e); s.material.color.set('#ffffff'); s.scale.setScalar(.34); }
        s.position.set(x + (Math.random() - .5) * .3, y + .15 + Math.random() * .5, z + (Math.random() - .5) * .3);
        live.push({ s, life: .9, vy: .5 + Math.random() * .4 });
      }
      function update(dt){
        for (let i = live.length - 1; i >= 0; i--) {
          const p = live[i]; p.life -= dt;
          if (p.life <= 0) { p.s.visible = false; pool.push(p.s); live.splice(i, 1); continue; }
          p.s.position.y += p.vy * dt; p.s.material.opacity = Math.min(1, p.life * 1.6);
        }
      }
      function clear(){ for (const p of live) { p.s.visible = false; pool.push(p.s); } live.length = 0; }
      return { emit, update, clear };
    }
    function lights(scene){
      scene.add(new T.HemisphereLight('#ffffff', '#b8a68c', .62));
      const sun = new T.DirectionalLight('#fff6e8', .5);
      sun.position.set(-30, 60, 40);
      scene.add(sun);
      return sun;
    }
    // Подсветка части тела в редакторе: материалы её мешей → светящиеся копии (и обратно)
    const hlMats = new Map();
    function highlight(ch, part){
      ch.root.traverse(o => {
        if (!o.isMesh) return;
        if (o.userData.hl0) { o.material = o.userData.hl0; o.userData.hl0 = null; }
        if (!part) return;
        let p = o.parent; while (p && !p.userData.part) p = p.parent;
        if (!p || p.userData.part !== part || !o.material.isMaterial || o.material.isMeshBasicMaterial || o.material.transparent) return;
        let h = hlMats.get(o.material);
        if (!h) { h = o.material.clone(); h.emissive = new T.Color('#8f6bff'); h.emissiveIntensity = .7; hlMats.set(o.material, h); }
        o.userData.hl0 = o.material; o.material = h;
      });
    }
    const pulseHL = t => { const k = .62 + .25 * Math.sin(t * 5); for (const h of hlMats.values()) h.emissiveIntensity = k; };
    return { T, Q, grad, toon, basic, geo, sph, cyl, tor, box, cone, rbox, emojiSprite, build, recolor, animate, dispose, trails, lights, cloth, mats, geos, texs, highlight, pulseHL, setExpr, EMOTES,
      phoneView, phoneMats, phoneKeep, PHE: { POCKET: PHE_POCKET, TAP: PHE_TAP, SHUTTER: PHE_SHUTTER } };
  }

  // ═══ Мир ═══
  function create(container, opts){
    const T = window.THREE, K = kit(T);
    const { M, PORTALS, ground, STAGE, CX, CY, W, H } = opts;
    const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, document.body.classList.contains('low') ? 1.25 : 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.domElement.className = 'wld-gl';
    container.prepend(renderer.domElement);
    const scene = new T.Scene();
    scene.background = new T.Color('#a8dcff');
    scene.fog = new T.Fog('#a8dcff', 60, 140);
    const camera = new T.PerspectiveCamera(40, 1, .3, 400);
    K.lights(scene);
    const toon = K.toon, geo = K.geo;

    // ── Земля (картинка 2D-карты) ──
    const tex = new T.CanvasTexture(ground);
    tex.encoding = T.sRGBEncoding;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const groundMesh = new T.Mesh(new T.PlaneGeometry(W / U, H / U), new T.MeshLambertMaterial({ map: tex }));
    groundMesh.rotation.x = -PI / 2;
    groundMesh.position.set(W / U / 2, 0, H / U / 2);
    scene.add(groundMesh);
    const outer = new T.Mesh(new T.PlaneGeometry(600, 600), new T.MeshLambertMaterial({ color: '#3a7a44' }));
    outer.rotation.x = -PI / 2; outer.position.set(W / U / 2, -.02, H / U / 2);
    scene.add(outer);

    // ── Деревья: ствол + 3 шара кроны (InstancedMesh) ──
    const trees = M.trees;
    const trunk = new T.InstancedMesh(new T.CylinderGeometry(.22, .3, 1.6, 7), toon('#7a4f2c'), trees.length);
    const crown = new T.InstancedMesh(new T.IcosahedronGeometry(1, 1), toon('#ffffff'), trees.length * 3);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), col = new T.Color();
    const greens = ['#2f8a3f', '#3fa24c', '#58b85a', '#2c7a3a'];
    trees.forEach((t, i) => {
      const k = t.r / 26, x = t.x / U, z = t.y / U;
      m4.compose(ps.set(x, .8 * k, z), q.identity(), sc.set(k, k, k)); trunk.setMatrixAt(i, m4);
      [[0, 2.1, 0, 1.15], [-.6, 1.75, .2, .8], [.62, 1.8, -.1, .85]].forEach(([dx, dy, dz, r], j) => {
        m4.compose(ps.set(x + dx * k, dy * k, z + dz * k), q.identity(), sc.set(r * k, r * k * .92, r * k)); crown.setMatrixAt(i * 3 + j, m4);
        crown.setColorAt(i * 3 + j, col.set(greens[(t.v + j) % greens.length]));
      });
    });
    scene.add(trunk, crown);
    // ── Фонари и скамейки ──
    const pole = new T.InstancedMesh(new T.CylinderGeometry(.07, .09, 2.6, 6), toon('#2d2a3a'), M.lamps.length);
    const bulb = new T.InstancedMesh(new T.SphereGeometry(.22, 12, 8), new T.MeshBasicMaterial({ color: '#fff3b0' }), M.lamps.length);
    M.lamps.forEach((l, i) => {
      m4.compose(ps.set(l.x / U, 1.3, l.y / U), q.identity(), sc.set(1, 1, 1)); pole.setMatrixAt(i, m4);
      m4.compose(ps.set(l.x / U, 2.7, l.y / U), q.identity(), sc.set(1, 1, 1)); bulb.setMatrixAt(i, m4);
    });
    scene.add(pole, bulb);
    const benchG = new T.Group();
    M.benches.forEach(b => {
      const g = new T.Group();
      const seat = new T.Mesh(geo('seat', () => new T.BoxGeometry(2.2, .14, .6)), toon('#a0673a')); seat.position.y = .55;
      const back = new T.Mesh(geo('back', () => new T.BoxGeometry(2.2, .5, .12)), toon('#8b5a2b')); back.position.set(0, .9, -.26);
      const legs = new T.Mesh(geo('blegs', () => new T.BoxGeometry(1.9, .5, .4)), toon('#3b2a1c')); legs.position.y = .25;
      g.add(seat, back, legs);
      g.position.set(b.x / U, 0, b.y / U);
      g.rotation.y = -b.a - PI / 2;   // спинкой к фонтану
      benchG.add(g);
    });
    scene.add(benchG);

    // ── Фонтан ──
    const fx = CX / U, fz = CY / U;
    const rim = new T.Mesh(new T.CylinderGeometry(5.1, 5.3, .9, 40, 1, true), toon('#a8b0bb', 1));
    rim.position.set(fx, .45, fz);
    const rimTop = new T.Mesh(new T.TorusGeometry(5.05, .28, 8, 48), toon('#c5ccd6'));
    rimTop.rotation.x = PI / 2; rimTop.position.set(fx, .9, fz);
    const water = new T.Mesh(new T.CircleGeometry(4.9, 40), new T.MeshLambertMaterial({ color: '#4fb8f0', transparent: true, opacity: .9 }));
    water.rotation.x = -PI / 2; water.position.set(fx, .62, fz);
    const pillar = new T.Mesh(new T.CylinderGeometry(.45, .7, 2.2, 16), toon('#c5ccd6'));
    pillar.position.set(fx, 1.1, fz);
    const bowl = new T.Mesh(new T.CylinderGeometry(1.6, .6, .45, 24), toon('#c5ccd6'));
    bowl.position.set(fx, 2.2, fz);
    scene.add(rim, rimTop, water, pillar, bowl);
    const ripples = [0, 1, 2].map(() => { const r = new T.Mesh(new T.RingGeometry(.9, 1.05, 40), new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .6, side: T.DoubleSide })); r.rotation.x = -PI / 2; r.position.set(fx, .64, fz); scene.add(r); return r; });
    const drops = new T.InstancedMesh(new T.SphereGeometry(.12, 6, 5), new T.MeshBasicMaterial({ color: '#bfe8ff' }), 18);
    scene.add(drops);

    // ── Порталы: арка + парящий значок ──
    const portals = PORTALS.map((p, i) => {
      const g = new T.Group();
      g.position.set(p.x / U, 0, p.y / U);
      const arch = new T.Mesh(geo('arch', () => new T.TorusGeometry(2.4, .26, 10, 40, PI)), new T.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: .7, roughness: .4 }));
      arch.position.y = .1;
      arch.rotation.y = Math.atan2(p.x / U - fx, p.y / U - fz);   // аркой к площади
      const ring = new T.Mesh(geo('pring', () => new T.TorusGeometry(3.2, .12, 8, 48)), new T.MeshBasicMaterial({ color: p.color, transparent: true, opacity: .8 }));
      ring.rotation.x = PI / 2; ring.position.y = .08;
      const icon = K.emojiSprite(p.e, 2.4);
      icon.position.y = 3.6;
      g.add(arch, ring, icon);
      scene.add(g);
      return { g, ring, icon, phase: i };
    });
    // ── Экран сцены ──
    const scrC = document.createElement('canvas'); scrC.width = 512; scrC.height = 256;
    const scrT = new T.CanvasTexture(scrC); scrT.encoding = T.sRGBEncoding;
    let scrLive = null;
    function drawScreen(live){
      if (scrLive === live) return;
      scrLive = live;
      const g = scrC.getContext('2d'), gr = g.createLinearGradient(0, 0, 512, 256);
      gr.addColorStop(0, live ? '#7c3aed' : '#1e1b4b'); gr.addColorStop(1, live ? '#db2777' : '#312e81');
      g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '900 64px Oswald, Montserrat, sans-serif'; g.fillText(live ? '🔴 В ЭФИРЕ' : 'DAN4IK37', 256, 105);
      g.font = '700 28px Montserrat, sans-serif'; g.fillStyle = 'rgba(255,255,255,.88)';
      g.fillText(live ? 'Денчик стримит — заходи!' : 'Стрим скоро · смотри видео', 256, 185);
      scrT.needsUpdate = true;
    }
    drawScreen(false);
    const scr = new T.Group();
    const sw = STAGE.w / U, sh = STAGE.h / U;
    const frame = new T.Mesh(new T.BoxGeometry(sw + .6, sh + .6, .4), toon('#111827'));
    const screen = new T.Mesh(new T.PlaneGeometry(sw, sh), new T.MeshBasicMaterial({ map: scrT }));
    screen.position.z = .21;
    const legsS = new T.Mesh(new T.BoxGeometry(.5, 3, .5), toon('#374151')); legsS.position.y = -sh / 2 - 1.2;
    scr.add(frame, screen, legsS);
    scr.position.set((STAGE.x + STAGE.w / 2) / U, sh / 2 + 2.6, (STAGE.y + STAGE.h / 2) / U);
    scene.add(scr);

    // ── Игроки ──
    const chars = new Map();   // key → { ch, sig, op }
    const trail = K.trails(scene);
    function setPlayer(key, look){
      const sig = JSON.stringify(look || {});
      const cur = chars.get(key);
      if (cur && cur.sig === sig) return;
      const ch = K.build(look, key);
      scene.add(ch.root);
      if (ch.pet) scene.add(ch.pet);
      if (cur) { ch.yaw = cur.ch.yaw; ch.root.position.copy(cur.ch.root.position); if (ch.pet && cur.ch.pet) ch.pet.position.copy(cur.ch.pet.position); K.dispose(cur.ch); }
      chars.set(key, { ch, sig, op: 1, lastTrail: 0 });
    }
    function removePlayer(key){ const c = chars.get(key); if (c) { K.dispose(c.ch); chars.delete(key); } }
    // Каждый кадр: позиция (координаты карты), идёт ли, прозрачность (вход/выход), телефон 📱 (код 0…4 или 'use' / 'call'…)
    const UAO = { phone: '' };
    function updatePlayer(key, x, y, moving, dt, t, fade, phone){
      const c = chars.get(key);
      if (!c) return;
      const ch = c.ch, X = x / U, Z = y / U, r = ch.root;
      const dx = X - r.position.x, dz = Z - r.position.z;
      if (Math.abs(dx) + Math.abs(dz) > .002 && dx * dx + dz * dz < 4) {
        const want = Math.atan2(dx, dz);
        let d = want - ch.yaw; while (d > PI) d -= TAU; while (d < -PI) d += TAU;
        ch.yaw += d * Math.min(1, dt * 12);
      }
      r.position.set(X, 0, Z);
      r.rotation.y = ch.yaw;
      UAO.phone = phone || '';
      K.animate(ch, moving, dt, t, phone || ch.phS ? UAO : undefined);
      if (moving && ch.R.trail !== 'none' && t - c.lastTrail > .09) { c.lastTrail = t; trail.emit(ch.R.trail, X - Math.sin(ch.yaw) * .4, 0, Z - Math.cos(ch.yaw) * .4, t); }
      if (ch.pet) {
        const tx = X - Math.sin(ch.yaw) * .9 + Math.cos(ch.yaw) * .7, tz = Z - Math.cos(ch.yaw) * .9 - Math.sin(ch.yaw) * .7, p = ch.pet.position;
        p.x += (tx - p.x) * Math.min(1, dt * 5); p.z += (tz - p.z) * Math.min(1, dt * 5);
        p.y = .45 + Math.abs(Math.sin(t * 7 + ch.phase)) * (moving ? .25 : .06);
      }
      const op = fade == null ? 1 : fade;
      if (c.op !== op) { c.op = op; ch.root.visible = op > .02; if (ch.pet) ch.pet.visible = op > .02; }
    }
    function emote(key, e, t){ const c = chars.get(key); if (c) { c.ch.emote = e; c.ch.emoteT = t; } }
    const tagY = key => (chars.get(key)?.ch.top || 2.3) + .42;

    // ── Камера, кадр, выбор точки ──
    let zoom = 1, camX = W / U / 2, camZ = H / U / 2, w = 1, h = 1, paused = false;
    const ray = new T.Raycaster(), ndc = new T.Vector2(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3(), v3 = new T.Vector3();
    function resize(){
      const r = container.getBoundingClientRect();
      w = Math.max(100, r.width); h = Math.max(100, r.height);
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
      camera.aspect = w / h; camera.fov = w < h ? 50 : 40; camera.updateProjectionMatrix();
    }
    function render(t, dt, fx2, fy2){
      const tx = fx2 / U, tz = fy2 / U;
      camX += (tx - camX) * Math.min(1, dt * 6); camZ += (tz - camZ) * Math.min(1, dt * 6);
      const dist = (w < 600 ? 11.5 : 10.5) * zoom;
      camera.position.set(camX, 1.2 + dist * .58, camZ + dist * .82);
      camera.lookAt(camX, 1.1, camZ);
      trail.update(dt);
      if (paused) return;
      water.material.color.setHSL(.56, .78, .6 + Math.sin(t * 2) * .03);
      ripples.forEach((r, i) => { const k = ((t * .45 + i / 3) % 1); r.scale.setScalar(1 + k * 3.6); r.material.opacity = .6 * (1 - k); });
      for (let i = 0; i < 18; i++) { const a = i / 18 * TAU + t * .3, k = ((t * .8 + i * .37) % 1), rr = .4 + k * 1.6; m4.compose(ps.set(fx + Math.cos(a) * rr, 2.5 + Math.sin(k * PI) * 1.6, fz + Math.sin(a) * rr), q.identity(), sc.set(1, 1, 1)); drops.setMatrixAt(i, m4); }
      drops.instanceMatrix.needsUpdate = true;
      portals.forEach(p => { p.icon.position.y = 3.6 + Math.sin(t * 2 + p.phase) * .25; const s = 1 + Math.sin(t * 3 + p.phase) * .06; p.ring.scale.set(s, s, s); });
      renderer.render(scene, camera);
    }
    function pickGround(cx, cy){
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(plane, hit) ? [hit.x * U, hit.z * U] : null;
    }
    // Экранные координаты точки карты на высоте hh (в единицах 3D) — для подписей и пузырей
    function project(x, y, hh){
      v3.set(x / U, hh, y / U).project(camera);
      return [(v3.x + 1) / 2 * w, (1 - v3.y) / 2 * h, v3.z < 1 && Math.abs(v3.x) < 1.3 && Math.abs(v3.y) < 1.3];
    }
    let G3 = null;   // zoom — обычное поле (не геттер, T-085: свой геттер V8 держит в общей «форме» объекта — жил бы прошлый вид)
    function setZoom(z){ zoom = Math.max(.55, Math.min(1.8, z)); if (G3) G3.zoom = zoom; }
    function dispose(){
      chars.forEach(c => K.dispose(c.ch)); chars.clear();
      renderer.dispose(); renderer.forceContextLoss?.();
      renderer.domElement.remove();
    }
    resize();
    G3 = { setPlayer, removePlayer, updatePlayer, emote, render, pickGround, project, resize, dispose, tagY, setLive: drawScreen, zoom, setZoom, setPaused(v){ paused = !!v; }, has: k => chars.has(k), keys: () => [...chars.keys()] };
    return G3;
  }

  // ═══ Витрина гардероба: человечек на подставке, крутится пальцем; картинки вариантов (thumb) ═══
  // Кадр витрины по настоящим размерам человечка (рост, голова, шапка): куда смотрим (ty), откуда (y, d), поворот
  const VIEWS = { full: 1, head: 1, hat: 1, top: 1, legs: 1, feet: 1, back: 1, armL: 1, armR: 1, legL: 1, legR: 1, torso: 1 };
  // ty — центр кадра, rh/rw — половина высоты/ширины того, что должно влезть, up — камера чуть выше центра,
  // yaw — поворот витрины, rot — поворот человечка на картинке варианта
  function frameOf(v, ch){
    const top = ch.top, hy = ch.headY, hs = ch.hs, hip = ch.hipY;
    if (v === 'head') return { ty: hy + .03, rh: .8 * hs + .1, rw: .9 * hs + .15, up: .2 };
    if (v === 'hat') { const ty = (hy - .25 + top) / 2; return { ty, rh: (top - hy + .75) / 2 + .12, rw: .85 * hs, up: .2 }; }
    if (v === 'top' || v === 'torso') { const lo = hip - .15, hi = hy + .62 * hs; return { ty: (lo + hi) / 2, rh: (hi - lo) / 2 + .1, rw: .85, up: .25 }; }
    if (v === 'armL' || v === 'armR') { const lo = hip - .35, hi = hy + .45 * hs; return { ty: (lo + hi) / 2, rh: (hi - lo) / 2 + .15, rw: .95, up: .25, rot: v === 'armL' ? -.75 : .75 }; }
    if (v === 'legs') return { ty: hip * .58, rh: hip * .58 + .16, rw: .6, up: .35 };
    if (v === 'legL' || v === 'legR') return { ty: hip * .62, rh: hip * .78 + .28, rw: .8, up: .35, rot: v === 'legL' ? -.6 : .6 };
    if (v === 'feet') return { ty: .13, rh: .3, rw: .48, up: .35 };
    if (v === 'back') return { ty: top / 2, rh: top / 2 + .22, rw: 1.15, up: .3, yaw: PI };
    return { ty: top / 2, rh: top / 2 + .22, rw: .85, up: .3 };
  }
  // Расстояние камеры, чтобы кадр влез и по высоте, и по ширине (узкая витрина на телефоне)
  const camDist = (V, fov, aspect) => { const t = Math.tan(fov * PI / 360); return Math.max(V.rh / t, V.rw / (t * aspect)); };
  function preview(container, opts = {}){
    const T = window.THREE, K = kit(T, { q: document.body.classList.contains('low') ? 'mid' : 'high' });
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.domElement.className = 'ce-gl';
    container.appendChild(renderer.domElement);
    const scene = new T.Scene();
    K.lights(scene);
    const fill = new T.DirectionalLight('#dfe8ff', .22); fill.position.set(30, 20, 30); scene.add(fill);
    const camera = new T.PerspectiveCamera(32, 1, .1, 60);
    const stand = new T.Mesh(new T.CylinderGeometry(1.15, 1.25, .16, 40), K.toon(opts.stand || '#2d2560'));
    stand.position.y = -.08; scene.add(stand);
    const ring = new T.Mesh(new T.TorusGeometry(1.2, .025, 6, 60), new T.MeshBasicMaterial({ color: opts.ring || '#9b6dff' }));
    ring.rotation.x = PI / 2; ring.position.y = .005; scene.add(ring);
    const trail = K.trails(scene);
    let ch = null, yaw = .45, auto = true, drag = null, lastDrag = -9, walk = false, view = 'full', w = 1, h = 1, raf = 0, last = performance.now(), dead = false, lastTrail = 0, hl = null, onPick = null;
    const cam = { up: .3, d: 6, ty: 1.15 }, look = { x: 0, y: 0, z: 0 }, ao = { rate: 10.5, look };
    let PV = null;   // ch / walking — обычные поля (не геттеры, T-085: свой геттер V8 держит в общей «форме» объекта — жила бы прошлая витрина)
    function set(look2, key){
      const nch = K.build(look2, key || opts.key || 'me');
      scene.add(nch.root);
      if (nch.pet) scene.add(nch.pet);
      if (ch) { nch.phase = ch.phase; K.dispose(ch); }
      ch = nch;
      if (PV) PV.ch = ch;
      if (hl) K.highlight(ch, hl);
    }
    function focus(v){ view = VIEWS[v] ? v : 'full'; if (view === 'back') yaw = PI; else if (view === 'armL' || view === 'legL') { yaw = -.8; lastDrag = performance.now() / 1000; } else if (view === 'armR' || view === 'legR') { yaw = .8; lastDrag = performance.now() / 1000; } }
    function resize(){
      const r = container.getBoundingClientRect();
      w = Math.max(60, r.width); h = Math.max(60, r.height);
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    const el = renderer.domElement, ray = new T.Raycaster(), ndc = new T.Vector2();
    // Нажатие (без протягивания) — какая часть тела под пальцем: head, torso, armL, armR, legL, legR
    function partAt(cx, cy){
      if (!ch) return null;
      const r = el.getBoundingClientRect();
      ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObject(ch.body, true);
      for (const hh of hits) { let p = hh.object; while (p && !p.userData.part) p = p.parent; if (p && p.visible !== false) return p.userData.part; if (!p) return 'torso'; }
      return null;
    }
    el.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw, t: performance.now(), moved: false }; el.setPointerCapture?.(e.pointerId); });
    el.addEventListener('pointermove', e => { if (!drag) return; if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6) drag.moved = true; yaw = drag.yaw + (e.clientX - drag.x) * .012; lastDrag = performance.now() / 1000; });
    const up = e => {
      const d = drag; drag = null; lastDrag = performance.now() / 1000;
      if (d && !d.moved && e.type === 'pointerup' && performance.now() - d.t < 600 && onPick) { const p = partAt(e.clientX, e.clientY); if (p) { yaw = d.yaw; onPick(p); } }
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    function frame(now){
      if (dead) return;
      raf = requestAnimationFrame(frame);
      const t = now / 1000, dt = Math.min(.05, (now - last) / 1000); last = now;
      if (!ch) return;
      if (auto && !drag && t - lastDrag > 2.5 && view !== 'back' && !hl) yaw += dt * .35;
      const V = frameOf(view, ch), want = { ty: V.ty, up: V.up, d: camDist(V, camera.fov, w / h) * 1.06 };
      for (const k of ['up', 'd', 'ty']) cam[k] += (want[k] - cam[k]) * Math.min(1, dt * 6);
      camera.position.set(0, cam.ty + cam.up, cam.d); camera.lookAt(0, cam.ty, 0);
      ch.root.rotation.y = yaw;
      look.x = camera.position.x; look.y = camera.position.y; look.z = camera.position.z;
      K.animate(ch, walk, dt, t, ao);
      if (hl) K.pulseHL(t);
      if (walk && ch.R.trail !== 'none' && t - lastTrail > .09) { lastTrail = t; trail.emit(ch.R.trail, -Math.sin(yaw) * .4, 0, -Math.cos(yaw) * .4, t); }
      trail.update(dt);
      if (ch.pet) { const a = yaw + 2.3; ch.pet.position.set(Math.sin(a) * .95, .5 + Math.abs(Math.sin(t * (walk ? 7 : 2.5))) * (walk ? .2 : .06), Math.cos(a) * .95); }
      renderer.render(scene, camera);
    }
    resize();
    raf = requestAnimationFrame(frame);
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    ro?.observe(container);
    window.addEventListener('resize', resize);
    // Картинки вариантов: свой маленький рендерер, по несколько штук за кадр
    let tr = null, tscene = null, tcam = null;
    const queue = [];
    let qBusy = false;
    function thumb(look2, key, v, canvas){
      queue.push({ look: look2, key, v, canvas });
      if (!qBusy) { qBusy = true; requestAnimationFrame(pump); }
    }
    function pump(){
      if (dead) return;
      if (!tr) {
        tr = new T.WebGLRenderer({ antialias: true, alpha: true });
        tr.outputEncoding = T.sRGBEncoding;
        tr.setPixelRatio(1);
        tscene = new T.Scene(); K.lights(tscene);
        const f2 = new T.DirectionalLight('#dfe8ff', .22); f2.position.set(30, 20, 30); tscene.add(f2);
        tcam = new T.PerspectiveCamera(30, 1, .1, 60);
      }
      const t0 = performance.now();
      while (queue.length && performance.now() - t0 < 14) {
        const j = queue.shift();
        if (!j.canvas.isConnected) continue;
        const size = j.canvas.width;
        tr.setSize(size, size, false);
        const c = K.build(j.look, j.key);
        tscene.add(c.root);
        c.blinkAt = 0; c.phase = 0;
        K.animate(c, false, 0, 0);
        const V = frameOf(j.v, c);
        c.root.rotation.y = V.rot != null ? V.rot : V.yaw != null ? V.yaw + .5 : .38;
        tcam.position.set(0, V.ty + V.up, camDist(V, tcam.fov, 1) * 1.04); tcam.lookAt(0, V.ty, 0);
        tr.render(tscene, tcam);
        const g = j.canvas.getContext('2d'); g.clearRect(0, 0, size, size); g.drawImage(tr.domElement, 0, 0, size, size);
        K.dispose(c);
      }
      if (queue.length) requestAnimationFrame(pump); else qBusy = false;
    }
    function dispose(){
      dead = true; cancelAnimationFrame(raf);
      ro?.disconnect(); window.removeEventListener('resize', resize);
      if (ch) K.dispose(ch);
      renderer.dispose(); renderer.forceContextLoss?.(); el.remove();
      if (tr) { tr.dispose(); tr.forceContextLoss?.(); }
    }
    PV = {
      set, focus, resize, dispose, thumb, recolor: look2 => !!ch && K.recolor(ch, look2), walk(v){ walk = !!v; PV.walking = walk; if (!walk) trail.clear(); }, walking: walk,
      emote(e){ if (ch) { ch.emote = e; ch.emoteT = performance.now() / 1000; } }, spin(d){ yaw += d; lastDrag = performance.now() / 1000; }, setYaw(v){ yaw = v; }, auto(v){ auto = !!v; },
      onPick(fn){ onPick = fn; }, highlight(part){ hl = part || null; if (ch) K.highlight(ch, hl); }, partAt,
      ch, renderer, scene, camera,
    };
    return PV;
  }

  // Версия внешности человечка: менять при любой правке геометрии, цветов или поз (кэш спрайтов и картинок по ней сбрасывается).
  // 1 — до частей тела; 2 — части тела, колени и локти, новые лица (15.10.2026); 3 — телефон 📱, плечи поднимаются (15.10.2026)
  const CHAR_VERSION = 5;   // 4 — поза «ползком» (T-096a); 5 — поза «лежит» (T-123)
  // Телефон человечка (без набора kit): phonePose(ch, 'use' | 'call' | 'play' | 'photo' | '' или код 0…4) — что держать
  // (достанет / уберёт сам, плавно); если animate получает o.phone — главнее оно. phoneSnap(ch, t) — «щёлк» камеры сейчас (t — то же
  // время, что в animate; дальше — только по кнопке). phoneCode('call') → 2, phoneName(2) → 'call'
  const phonePose = (ch, s) => { if (ch) ch.phWant = s == null ? '' : s; };
  const phoneSnap = (ch, t) => { if (ch?.phS) { ch.phS.snapT = t; ch.phS.manual = true; } };
  const phoneCode = s => phIdx(s) + 1;
  const phoneName = c => PH_MODES[phIdx(c)] || '';
  window.World3D = { supported, load, create, preview, resolve, kit, frameOf, PART_DEF, EMOTES, HEADS, CHAR_VERSION, PH_MODES, phonePose, phoneSnap, phoneCode, phoneName, HOLDS, MOTIONS };
})();
