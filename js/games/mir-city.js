// ═══════════════════════════════════════
//  «МИР ДЕНЧИКА»: ГОРОДА — «Солнечный городок» (0+, детский) и «Большой город» (MirZones.ADULT_AGE+, для взрослых)
// ═══════════════════════════════════════
// Владелец 15.10.2026: «действия разные с городами, тип город для детей и город для взрослых». У каждого города — свои роли,
// работы и действия (🎬). Детский: школа (урок-викторина), детская площадка (горка, качели, батут), питомцы, мороженое, пекарня
// (готовка), семейные роли, добрые работы — пекарь, пожарный, врач, ветеринар, строитель; без оружия и «преступлений», чат
// строгий у всех, кто внутри. Взрослый: работы с зарплатой — полицейский, кассир банка, продавец, повар, врач, судья, бизнесмен,
// таксист (с машинами), грабитель (полиция ловит: розыск ⭐, тюрьма, залог); банк, бизнес, автосалон, суд. Без 18+, без
// алкоголя/наркотиков и без азартных игр (AdSense).
// Деньги городов — свои, только для игры в городе: ⭐ звёздочки (детский) и 💵 кэш (взрослый), в браузере (localStorage). Настоящие
// монеты 🪙 — понемногу за работу: MirZones.payTask → D37Coins.run('rp') (сервер режет: coin_run_cap('rp') = 10, 600 в день).
// Работа: щит «🧰 Работа» → роль (форма над человечком у всех — поле zx.r) → задания по шагам: метка над целью, «[E] …» (держать),
// в руках — что несёшь (zx.a = 'carry'). Дома: «Сделать своим» (на время визита, zx.hs) — кровать, диван, кухня.
// Сеть: только zx в 'st' и редкие 'z' (арест, лечение игрока) — всё проверяет тот, кого касается (хоста в мире нет).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const MZ = root.MirZones; if (!MZ) return;
  const PI = Math.PI, esc = MZ.esc;
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const now = () => (root.performance ? root.performance.now() : Date.now());

  // ═══ Деньги города (в браузере): kids — ⭐, metro — 💵 ═══
  const WALLET = { kids: { key: 'd37_mir_kids', icon: '⭐', name: 'звёздочек', start: 5 }, metro: { key: 'd37_mir_metro', icon: '💵', name: 'кэша', start: 100 } };
  function wallet(city){
    const W = WALLET[city];
    let s = null;
    try { s = JSON.parse(root.localStorage?.getItem(W.key) || 'null'); } catch (e) {}
    if (!s || typeof s !== 'object') s = {};
    s.cash = Number.isFinite(s.cash) ? Math.max(0, Math.min(1e7, Math.floor(s.cash))) : W.start;
    s.bank = Number.isFinite(s.bank) ? Math.max(0, Math.min(1e7, Math.floor(s.bank))) : 0;
    s.inv = s.inv && typeof s.inv === 'object' ? s.inv : {};
    s.biz = Array.isArray(s.biz) ? s.biz.filter(b => typeof b === 'string').slice(0, 3) : [];
    return s;
  }
  const walletSave = (city, s) => { try { root.localStorage?.setItem(WALLET[city].key, JSON.stringify(s)); } catch (e) {} };

  // ═══ Роли (работы): значок, форма (шапка и жилет), город, оплата за задание ═══
  const ROLES_K = {
    baker: { icon: '🥐', name: 'Пекарь', hat: 'chef', vest: '#f8fafc', pay: 3, desc: 'Замеси тесто, испеки булочки и отнеси их жителям.' },
    fireman: { icon: '🚒', name: 'Пожарный', hat: 'fire', vest: '#dc2626', stripe: 1, pay: 3, desc: 'В городе загорается мусорный бак или костёр — потуши его!' },
    doctor: { icon: '🩺', name: 'Врач', hat: 'doc', vest: '#f8fafc', pay: 3, desc: 'Осмотри пациента, принеси лекарство — и он здоров. Можно лечить и игроков.' },
    vet: { icon: '🐾', name: 'Ветеринар', hat: 'vet', vest: '#16a34a', pay: 3, desc: 'Найди приболевшего питомца и вылечи его в клинике.' },
    builder: { icon: '👷', name: 'Строитель', hat: 'hard', vest: '#f97316', stripe: 1, pay: 3, desc: 'Носи кирпичи на стройку — дом растёт на глазах.' },
    icecream: { icon: '🍦', name: 'Продавец мороженого', hat: 'chefPink', vest: '#f9a8d4', pay: 2, desc: 'Обслужи покупателей у окошка киоска.' },
  };
  const ROLES_M = {
    police: { icon: '👮', name: 'Полицейский', hat: 'police', vest: '#1e3a8a', pay: 40, desc: 'Патрулируй улицы, лови грабителей и отвози их в участок.' },
    robber: { icon: '🦹', name: 'Грабитель', hat: 'robber', vest: '#111827', stripe: 2, pay: 0, desc: 'Ограбь кассу или банк — и не попадись полиции! Пойманного ждёт тюрьма.' },
    cashier: { icon: '🏦', name: 'Кассир банка', hat: 'visor', vest: '#166534', pay: 35, desc: 'Обслуживай клиентов банка у окошка.' },
    seller: { icon: '🛒', name: 'Продавец', hat: 'cap', vest: '#dc2626', pay: 30, desc: 'Работай на кассе супермаркета.' },
    cook: { icon: '👨‍🍳', name: 'Повар', hat: 'chef', vest: '#f8fafc', pay: 35, desc: 'Готовь заказы в ресторане и подавай гостям.' },
    medic: { icon: '🚑', name: 'Врач', hat: 'doc', vest: '#f8fafc', pay: 45, desc: 'Лечи пациентов в больнице. Больница — место, где все поправляются.' },
    judge: { icon: '⚖️', name: 'Судья', hat: 'judge', vest: '#111827', pay: 50, desc: 'Рассматривай дела в суде и выноси приговоры.' },
    biz: { icon: '💼', name: 'Бизнесмен', hat: 'none', vest: '#334155', pay: 30, desc: 'Купи свой бизнес — он приносит 💵, пока ты в городе. Закупай товар.' },
    taxi: { icon: '🚕', name: 'Таксист', hat: 'taxi', vest: '#facc15', pay: 40, desc: 'Вози пассажиров по городу на такси.', car: true },
  };

  // ═══ Точки заданий (одно место: постройка ставит рядом предметы, задания ведут сюда) — [x, y, z] ═══
  const SPOTS = {
    k_teacher: [132, 1.2, -61.2], k_tramp: [168, .6, -48], k_bed0: [194, .8, -61.5], k_bed1: [198, .8, -61.5], k_bed2: [202, .8, -61.5], k_med: [192.6, 1.2, -54],
    k_vettable: [212, 1.3, -58], k_hose: [242.8, 1.2, -50], k_oven: [121.2, 1.2, 2.2], k_dough: [134, 1.1, 1.7], k_icewin: [148, 1.2, -10.2], k_icecounter: [148, 1.2, -7.8],
    k_bricks: [197.4, 1, 19.6], k_site: [205, 1, 24],
    m_fount: [182, 1, 146], m_desk: [110, 1.2, 146.6], m_judge: [116, 1.4, 177.4], m_defend: [109, 1.2, 183.2], m_dock: [113.8, 1.2, 241.6], m_teller: [246, 1.2, 149.6],
    m_client: [246, 1.2, 148.6], m_vault: [246, 1.2, 158.4], m_bed0: [238, .8, 179.4], m_bed1: [242, .8, 179.4], m_bed2: [250, .8, 179.4], m_bed3: [254, .8, 179.4],
    m_meds: [236.6, 1.2, 187], m_dealer: [182, 1.2, 116], m_till: [99, 1.2, 228], m_buyer: [99, 1.2, 227], m_stove: [130, 1.2, 240.4], m_fridge: [137.2, 1.2, 241],
    m_biz_coffee: [166, 1.2, 230.6], m_biz_flowers: [182, 1.2, 230.6], m_biz_wash: [198, 1.2, 230.6],
  };
  const spotsOf = city => { const o = {}; for (const [id, p] of Object.entries(SPOTS)) if (id[0] === city[0]) o[id] = { x: p[0], y: p[1], z: p[2] }; return o; };

  // ═══ «Солнечный городок» (детский, 0+): x 110…250, z −80…40 ═══
  const KZ = MZ.ZONES.kids;
  const K_STREETS = [{ w: 8, pts: [[110, -24], [250, -24]] }, { w: 8, pts: [[180, -80], [180, 40]] }];
  const K_FOOT = [
    [132, -56, 28, 18, '#fbbf24', 4.2], [204, -56, 26, 18, '#f1f5f9', 4], [236, -56, 20, 18, '#dc2626', 4.6], [128, -2, 18, 14, '#fdba74', 3.8],
    [148, -6, 9, 7, '#f9a8d4', 3.2], [165, -2, 12, 12, '#86efac', 3.6], [196, -4, 11, 10, '#fde68a', 3.4], [218, -4, 11, 10, '#a5f3fc', 3.4],
    [240, -4, 11, 10, '#f5d0fe', 3.4], [241, 25, 11, 10, '#bbf7d0', 3.4], [204, 24, 20, 16, '#d6b98c', 0], [161, -54, 22, 34, '#e9d5a1', 0], [142, 25, 56, 26, '#6ec466', 0],
  ];
  const K_PLACES = [
    { id: 'k_school', icon: '🏫', name: 'Школа', x: 132, z: -42, lx: 132, lz: -56, sub: 1 },
    { id: 'k_play', icon: '🛝', name: 'Детская площадка', x: 161, z: -34, lx: 161, lz: -54, sub: 1 },
    { id: 'k_hosp', icon: '🏥', name: 'Больница и ветклиника', x: 204, z: -40, lx: 204, lz: -56, sub: 1 },
    { id: 'k_fire', icon: '🚒', name: 'Пожарная часть', x: 236, z: -40, lx: 236, lz: -56, sub: 1 },
    { id: 'k_bake', icon: '🥐', name: 'Пекарня', x: 128, z: -14, lx: 128, lz: -2, sub: 1 },
    { id: 'k_pets', icon: '🐶', name: 'Зоомагазин', x: 165, z: -13, lx: 165, lz: -2, sub: 1 },
    { id: 'k_park', icon: '🌳', name: 'Парк городка', x: 142, z: 14, lx: 142, lz: 25, sub: 1 },
    { id: 'k_build', icon: '🏗️', name: 'Стройка', x: 192, z: 14, lx: 204, lz: 24, sub: 1 },
  ];
  // точки заданий
  const K_FIRES = [[126, -38], [151, -13], [176, 9], [199, -13], [222, -13], [236, 13], [170, -38], [190, 35], [118, 6], [214, 36]];
  const K_CUST = [[148, 31], [196, -13], [240, -13], [125, -41], [160, -38], [218, -13], [126, 18], [172, 4]];
  const K_PETS = [[140, 28], [165, 35], [157, -44], [212, 36], [232, -14], [120, 30], [188, -2]];
  const PETS = { dog: ['🐶', 'Щенок'], cat: ['🐱', 'Котёнок'], rabbit: ['🐰', 'Кролик'], hamster: ['🐹', 'Хомячок'], parrot: ['🦜', 'Попугай'], turtle: ['🐢', 'Черепашка'] };
  const QUIZ = [
    ['Сколько ног у паука?', ['8', '6', '10'], 0], ['Какого цвета небо в ясный день?', ['Голубого', 'Зелёного', 'Красного'], 0], ['Сколько будет 7 + 5?', ['12', '11', '13'], 0],
    ['Кто говорит «мяу»?', ['Кошка', 'Собака', 'Корова'], 0], ['Самая большая планета?', ['Юпитер', 'Марс', 'Земля'], 0], ['Сколько дней в неделе?', ['7', '5', '10'], 0],
    ['Что растёт на ёлке?', ['Шишки', 'Яблоки', 'Бананы'], 0], ['Сколько будет 3 × 4?', ['12', '7', '14'], 0], ['Какой звук у буквы «Ж»?', ['Жужжит', 'Свистит', 'Молчит'], 0],
    ['Где живёт рыба?', ['В воде', 'На дереве', 'В пустыне'], 0], ['Сколько будет 20 − 8?', ['12', '10', '14'], 0], ['Какое время года после зимы?', ['Весна', 'Осень', 'Лето'], 0],
    ['Кто строит плотины?', ['Бобры', 'Зайцы', 'Совы'], 0], ['Сколько цветов у радуги?', ['7', '5', '9'], 0], ['Что нужно растению?', ['Вода и свет', 'Только темнота', 'Только песок'], 0],
  ];
  MZ.def('kids', {
    roles: ROLES_K, footprints: K_FOOT, streets: K_STREETS, places: K_PLACES,
    ground: [[180, -24, 140, 8, '#5b6270'], [180, -20, 8, 120, '#5b6270'], [117, -24, 14, 28, '#e7dcc2']],
    actions: rt => {
      const W = wallet('kids'), L = [
        { id: 'wave', icon: '👋', name: 'Помахать' }, { id: 'dance', icon: '💃', name: 'Танцевать' }, { id: 'clap', icon: '👏', name: 'Хлопать' },
        { id: 'sit', icon: '🪑', name: 'Сесть' }, { id: 'sleep', icon: '😴', name: 'Спать', hint: 'У кровати: в домах и в больнице' },
        { id: 'call', icon: '📞', name: 'Позвонить маме' }, { id: 'photo', icon: '📸', name: 'Сфоткать' },
      ];
      for (const k of ['icecream', 'bun', 'apple']) if ((W.inv[k] || 0) > 0) L.push({ id: 'eat:' + k, icon: rt.FOOD[k], name: `Съесть (${W.inv[k]})` });
      if (rt.zx.pt) L.push({ id: 'k_pet', icon: (PETS[rt.zx.pt] || ['🐾'])[0], name: 'Погладить питомца' }, { id: 'k_feed', icon: '🦴', name: 'Покормить (⭐1)' });
      L.push({ id: 'me', icon: '💬', name: '/me действие' });
      return L;
    },
    *build(K){ yield* buildKids(K); },
    start: (rt, K) => cityMod(rt, K, 'kids'),
  });

  // ═══ «Большой город» (для взрослых, ADULT_AGE+): x 90…270, z 100…260 ═══
  const MC = MZ.ZONES.metro;
  const M_STREETS = [{ w: 8, pts: [[90, 130], [270, 130]] }, { w: 8, pts: [[90, 205], [270, 205]] }, { w: 8, pts: [[150, 100], [150, 260]] }, { w: 8, pts: [[215, 100], [215, 260]] }];
  const M_FOOT = [
    [116, 152, 26, 18, '#1e3a8a', 5], [116, 184, 24, 16, '#e5e7eb', 5.5], [182, 175, 28, 22, '#fef3c7', 7], [246, 152, 24, 18, '#d6d3d1', 6], [246, 184, 22, 14, '#f8fafc', 5],
    [182, 112, 28, 14, '#93c5fd', 5], [246, 112, 20, 14, '#facc15', 4.5], [115, 113, 16, 9, '#ef4444', 4.6], [105, 234, 22, 18, '#86efac', 5], [131, 234, 16, 18, '#fca5a5', 4.6],
    [166, 230, 12, 10, '#a78bfa', 4], [182, 230, 12, 10, '#f9a8d4', 4], [198, 230, 12, 10, '#67e8f9', 4], [235, 236, 14, 14, '#fde68a', 8], [258, 236, 14, 14, '#c4b5fd', 9],
  ];
  const M_PLACES = [
    { id: 'm_hall', icon: '🏛️', name: 'Мэрия — работа', x: 182, z: 140, lx: 182, lz: 175, sub: 1 },
    { id: 'm_police', icon: '👮', name: 'Полиция и тюрьма', x: 116, z: 138, lx: 116, lz: 152, sub: 1 },
    { id: 'm_court', icon: '⚖️', name: 'Суд', x: 116, z: 198, lx: 116, lz: 184, sub: 1 },
    { id: 'm_bank', icon: '🏦', name: 'Банк', x: 246, z: 138, lx: 246, lz: 152, sub: 1 },
    { id: 'm_hosp', icon: '🏥', name: 'Больница', x: 246, z: 198, lx: 246, lz: 184, sub: 1 },
    { id: 'm_cars', icon: '🚗', name: 'Автосалон', x: 182, z: 123, lx: 182, lz: 112, sub: 1 },
    { id: 'm_taxi', icon: '🚕', name: 'Такси', x: 246, z: 123, lx: 246, lz: 112, sub: 1 },
    { id: 'm_shop', icon: '🛒', name: 'Супермаркет и ресторан', x: 118, z: 212, lx: 118, lz: 234, sub: 1 },
    { id: 'm_biz', icon: '💼', name: 'Бизнес-центр', x: 182, z: 212, lx: 182, lz: 230, sub: 1 },
  ];
  MZ.def('metro', {
    roles: ROLES_M, footprints: M_FOOT, streets: M_STREETS, places: M_PLACES,
    ground: [[180, 130, 180, 8, '#5b6270'], [180, 205, 180, 8, '#5b6270'], [150, 180, 8, 160, '#5b6270'], [215, 180, 8, 160, '#5b6270'], [182, 150, 40, 26, '#d6d3d1']],
    actions: rt => {
      const W = wallet('metro'), L = [
        { id: 'wave', icon: '👋', name: 'Помахать' }, { id: 'dance', icon: '💃', name: 'Танцевать' }, { id: 'clap', icon: '👏', name: 'Аплодировать' },
        { id: 'sit', icon: '🪑', name: 'Сесть' }, { id: 'sleep', icon: '😴', name: 'Спать', hint: 'У кровати: в квартирах и в больнице' },
        { id: 'call', icon: '📞', name: 'Позвонить' }, { id: 'photo', icon: '📸', name: 'Сфоткать' },
      ];
      for (const k of ['coffee', 'burger', 'pizza', 'soup', 'apple', 'juice']) if ((W.inv[k] || 0) > 0) L.push({ id: 'eat:' + k, icon: rt.FOOD[k] || '🍽️', name: `${k === 'coffee' || k === 'juice' ? 'Выпить' : 'Съесть'} (${W.inv[k]})` });
      if (rt.zx.r === 'robber' && rt.zx.wn) L.push({ id: 'm_hide', icon: '🫣', name: 'Спрятать лицо' });
      L.push({ id: 'me', icon: '💬', name: '/me действие' });
      return L;
    },
    *build(K){ yield* buildMetro(K); },
    start: (rt, K) => cityMod(rt, K, 'metro'),
  });
  MZ.FOOD_EXTRA = { coffee: '☕', burger: '🍔', soup: '🍲', juice: '🧃' };

  // ═══ ПОСТРОЙКА: Солнечный городок ═══
  function* buildKids(K){
    const { R } = K, M = K.M;
    K.spots = spotsOf(K.Z.id);
    const spot = id => K.spots[id];
    // ── улицы, перекрёсток, площадь у входа ──
    K.chunk('streets');
    K.road(110, -24, 176, -24, 8); K.road(184, -24, 250, -24, 8);
    K.road(180, -80, 180, -28, 8); K.road(180, -20, 180, 40, 8);
    K.part({ s: 'box', x: 180, y: .025, z: -24, w: 8, h: .02, d: 8, m: M.asphalt });
    for (const [x, z, yaw] of [[171, -24, PI / 2], [189, -24, PI / 2], [180, -33, 0], [180, -15, 0]]) K.zebra(x, z, 8, yaw);
    K.part({ s: 'box', x: 117, y: .03, z: -24, w: 14, h: .03, d: 28, m: M.plaza });   // площадь у входа
    for (const [x, z] of [[124, -31], [124, -17]]) { K.cyl(x, 0, z, 1.1, .16, '#d6cfc0', { solid: true }); K.prefab('flowers', { x, z, n: 9, seed: x + z, c: '#f472b6' }); }
    for (let x = 130; x < 250; x += 16) for (const s of [-1, 1]) if (Math.abs(x - 180) > 9) K.lamp(x, -24 + s * 5.6);
    for (let z = -72; z < 38; z += 16) for (const s of [-1, 1]) if (Math.abs(z + 24) > 9) K.lamp(180 + s * 5.6, z);
    for (let x = 136; x < 246; x += 22) for (const s of [-1, 1]) if (Math.abs(x - 180) > 10) K.tree(x + 6, -24 + s * 7.6, .75, (x / 22 | 0) % 4);
    K.board(120, 2.2, -36.8, 3, 1.5, 0, '🧰 Работа в городке', { bg: '#166534' });
    K.box(120, 0, -37, .16, 1.5, .16, '#6b4426', { solid: true });
    K.board(113.5, 2.2, -36.8, 3, 1.5, 0, '👪 Семья: выбери роль', { bg: '#9d174d' });
    K.box(113.5, 0, -37, .16, 1.5, .16, '#6b4426', { solid: true });
    K.item({ x: 120, y: 1.6, z: -35.8, r: 1.2, prompt: () => '🧰 Работа: выбрать профессию', act: () => K.rt.city?.kids?.jobBoard() });
    K.item({ x: 113.5, y: 1.6, z: -35.8, r: 1.2, prompt: () => '👪 Семья: выбрать роль', act: () => K.rt.city?.kids?.familyBoard() });
    K.label.sign('🧸 Солнечный городок', 117, 3.1, -11, 6, .9, PI, { bg: '#ca8a04', w: 768, h: 116 });
    K.box(117, 0, -10.8, 6.4, 2.6, .25, '#92400e', { solid: true });
    yield;
    // ── Школа ──
    K.chunk('school');
    K.building({ id: 'k_school', x: 132, z: -56, w: 28, d: 18, h: 4.2, wall: '#fde68a', trim: '#b45309', roofC: '#c2410c', floor: '#d4a373',
      doors: [{ side: 's', at: 0, w: 3 }], windows: [{ side: 's', at: -9, w: 4 }, { side: 's', at: 9, w: 4 }, { side: 'e', at: 0, w: 4 }, { side: 'w', at: 0, w: 4 }, { side: 'n', at: -8, w: 3 }, { side: 'n', at: 8, w: 3 }],
      sign: '🏫 Школа', signBg: '#b45309' });
    K.box(132, .12, -64.4, 9, 2.4, .12, '#14532d');   // доска
    K.label.sign('2 + 2 = 4   🍎 Урок!', 132, 2.2, -64.28, 8, 1.4, 0, { bg: '#14532d', w: 768, h: 134, border: false });
    K.table(132, -60.5, 2, 1, '#92400e');
    for (let r = 0; r < 3; r++) for (const dx of [-8, -3, 3, 8]) { K.table(132 + dx, -56 + r * 3.2, 1.6, .7, '#d97706', .72); K.chair(132 + dx, -55.2 + r * 3.2, PI, '#2563eb'); }
    K.lampIn(126, 3.5, -56); K.lampIn(138, 3.5, -56);
    spot('k_teacher');
    K.npc({ id: 'k_teacher', name: '👩‍🏫 Учительница', x: 132, z: -62.2, yaw: 0, seed: 'uchit1', say: ['Садись за парту — начнём урок! 📚', 'Подойди ко мне и нажми E — задам вопрос', 'Молодец! Знания — это сила 💪'] });
    K.item({ x: 132, y: 1.3, z: -61.2, r: 1.2, prompt: () => '📚 Урок: ответить на вопрос учительницы', act: () => K.rt.city?.kids?.quiz() });
    // двор: флаг и скамейки
    K.cyl(132, 0, -42, .08, 7, '#9ca3af', { solid: true });
    K.part({ s: 'box', x: 133, y: 6.4, z: -42, w: 2, h: 1.2, d: .04, c: '#38bdf8' });
    for (const x of [122, 142]) K.bench(x, -40, PI);
    yield;
    // ── Детская площадка ──
    K.chunk('play');
    K.part({ s: 'box', x: 161, y: .03, z: -54, w: 22, h: .03, d: 34, m: M.sand });
    // горка: лестница-ступени, площадка, скат (клин)
    K.box(155, 0, -64, 3, 2.8, 3, '#f97316', { solid: true, floor: 'metal' });
    for (let i = 0; i < 6; i++) K.box(157.6, 0, -66.2 + i * .45, 1.4, (i + 1) * .45, .45, '#facc15', { solid: true, floor: 'metal' });
    K.part({ s: 'box', x: 155, y: 1.45, z: -59.4, w: 2, h: .14, d: 6.4, rx: .42, c: '#ef4444' });
    K.wedge({ x: 155, z: -59.6, y: 1.4, hx: 1, hy: 1.4, hz: 3, yaw: 0, data: { floor: 'metal' } });
    // качели: рама и два сиденья
    for (const s of [-1, 1]) K.box(166 + s * 3.2, 0, -64, .2, 3, .2, '#2563eb', { solid: true });
    K.part({ s: 'box', x: 166, y: 3, z: -64, w: 6.6, h: .2, d: .2, c: '#2563eb' });
    for (const s of [-1, 1]) { K.part({ s: 'box', x: 166 + s * 1.4, y: .7, z: -64, w: 1, h: .08, d: .5, c: '#f8fafc' }); for (const t of [-1, 1]) K.part({ s: 'cyl', x: 166 + s * 1.4 + t * .45, y: 1.85, z: -64, r: .02, h: 2.3, c: '#94a3b8' }); K.seat(166 + s * 1.4, .72, -64, 0, { name: 'Покачаться на качелях' }); }
    // песочница
    for (const [x, z, w, d] of [[160, -50.6, 6, .25], [160, -45.4, 6, .25], [157.1, -48, .25, 5], [162.9, -48, .25, 5]]) K.box(x, 0, z, w, .4, d, '#b45309', { solid: true });
    K.part({ s: 'box', x: 160, y: .06, z: -48, w: 5.6, h: .1, d: 5, m: M.sand });
    K.part({ s: 'cone', x: 159, y: .35, z: -47.5, r: .7, h: .6, c: '#e6c27a' });
    // батут
    K.cyl(168, 0, -48, 2.2, .55, '#1e40af', { solid: true, seg: 20 }); K.part({ s: 'cyl', x: 168, y: .58, z: -48, r: 2, h: .04, c: '#111827', seg: 20 });
    spot('k_tramp');
    // карусель
    K.cyl(161, 0, -40, 2.4, .3, '#a855f7', { solid: true, seg: 16 }); K.part({ s: 'cyl', x: 161, y: 1.3, z: -40, r: .12, h: 2.2, c: '#facc15' }); K.part({ s: 'cone', x: 161, y: 2.6, z: -40, r: 2.4, h: .7, c: '#ec4899', seg: 16 });
    for (let i = 0; i < 4; i++) { const a = i * PI / 2; K.seat(161 + Math.cos(a) * 1.7, .5, -40 + Math.sin(a) * 1.7, -a, { name: 'Сесть на карусель' }); }
    for (const [x, z, yaw] of [[151.5, -42, PI / 2], [151.5, -52, PI / 2], [170.5, -60, -PI / 2]]) K.bench(x, z, yaw);
    for (const [x, z] of [[151, -70], [171, -70], [151, -38], [171, -36]]) K.tree(x, z, .9, 1);
    K.npc({ id: 'k_kid1', name: '🧒 Миша', x: 162, z: -52, yaw: 0, seed: 'misha7', act: 'wander', radius: 6, say: ['Давай кататься с горки! 🛝', 'На батуте можно прыгать высоко-высоко!'] });
    yield;
    // ── Больница и ветклиника ──
    K.chunk('hosp');
    K.building({ id: 'k_hosp', x: 204, z: -56, w: 26, d: 18, h: 4, wall: '#f8fafc', trim: '#ef4444', roofC: '#94a3b8', floor: '#e2e8f0', floorType: 'tile', floorM: M.walk,
      doors: [{ side: 's', at: -6, w: 2.8 }, { side: 's', at: 7, w: 2.8 }], windows: [{ side: 's', at: -11, w: 2.4 }, { side: 's', at: 1, w: 2.4 }, { side: 'e', at: 0, w: 3 }, { side: 'w', at: 0, w: 3 }],
      sign: '🏥 Больница', signBg: '#dc2626' });
    K.label.sign('🐾 Ветклиника', 211, 3.4, -46.8, 5, .9, 0, { bg: '#16a34a', w: 512, h: 92 });
    K.box(204.2, .12, -56, .2, 3.6, 12, '#e2e8f0', { solid: true, cam: true });   // перегородка
    for (const [i, x] of [194, 198, 202].entries()) { K.bed(x, -61.5, PI, '#93c5fd'); spot('k_bed' + i); }
    K.counter(195.5, -50.5, 3.2, .9, '#e5e7eb', '#ffffff');
    K.box(191.6, .12, -54, .6, 2, 1.6, '#f1f5f9', { solid: true }); K.part({ s: 'box', x: 191.9, y: 1.3, z: -54, w: .05, h: .5, d: .5, c: '#ef4444' });
    spot('k_med');
    K.npc({ id: 'k_doc', name: '🩺 Доктор Айболит', x: 195.5, z: -52.2, yaw: 180, seed: 'aibolit', say: ['Здравствуй! Кто тут приболел? 🤒', 'Стань врачом на щите «Работа» у входа в городок', 'Не забывай мыть руки! 🧼'] });
    // ветклиника
    K.counter(212, -58, 2.4, 1.2, '#16a34a', '#dcfce7'); spot('k_vettable');
    for (let i = 0; i < 3; i++) { K.box(216.2, .12, -62 + i * 2.2, 1.4, 1.2, 1.4, '#94a3b8', { solid: true }); K.part({ s: 'box', x: 215.48, y: .72, z: -62 + i * 2.2, w: .02, h: 1, d: 1.3, c: '#cbd5e1' }); }
    K.npc({ id: 'k_vet', name: '🐾 Ветеринар', x: 210, z: -60.5, yaw: 0, seed: 'vetdoc', say: ['Котики, собачки, хомячки — всех вылечим! 🐾', 'Принеси приболевшего питомца на стол'] });
    yield;
    // ── Пожарная часть ──
    K.chunk('fire');
    K.building({ id: 'k_fire', x: 236, z: -56, w: 20, d: 18, h: 4.6, wall: '#fca5a5', trim: '#991b1b', roofC: '#7f1d1d', floor: '#9ca3af', floorType: 'concrete', floorM: M.concrete,
      doors: [{ side: 's', at: -3, w: 6, h: 3.6 }, { side: 's', at: 6, w: 2.4 }], windows: [{ side: 'e', at: 0, w: 3 }, { side: 'w', at: -3, w: 3 }], sign: '🚒 Пожарная часть', signBg: '#991b1b' });
    fireTruck(K, 233, -57, 0);
    K.box(243.6, .12, -50, .3, 2, 2, '#9ca3af', { solid: true }); K.part({ s: 'torus', x: 243.4, y: 1.3, z: -50, r: .5, t: .1, yaw: PI / 2, c: '#facc15' });
    spot('k_hose');
    K.npc({ id: 'k_fireman', name: '🚒 Пожарный Петя', x: 241, z: -54, yaw: 200, seed: 'petya01', say: ['Огонь — не игрушка! 🔥', 'Стань пожарным — будешь тушить пожары в городке', 'Шланг — у стены, бери и беги!'] });
    yield;
    // ── Пекарня ──
    K.chunk('bake');
    K.building({ id: 'k_bake', x: 128, z: -2, w: 18, d: 14, h: 3.8, wall: '#fed7aa', trim: '#9a3412', roofC: '#9a3412', floor: '#c8956a',
      doors: [{ side: 'n', at: 0, w: 2.6 }], windows: [{ side: 'n', at: -5.5, w: 3 }, { side: 'n', at: 5.5, w: 3 }, { side: 'e', at: 0, w: 2.4 }], sign: '🥐 Пекарня «Булочка»', signBg: '#9a3412' });
    K.counter(128, -4.4, 8, .9, '#9a3412', '#fde68a');
    for (let i = 0; i < 5; i++) K.part({ s: 'ball', x: 125 + i * 1.5, y: 1.25, z: -4.4, r: .18, c: '#d97706', seg: 8 });
    K.box(121.2, .12, 3.6, 2.6, 2.2, 1.6, '#b91c1c', { solid: true });   // печь
    K.part({ s: 'box', x: 121.2, y: 1, z: 2.78, w: 1.4, h: .8, d: .04, c: '#ff8a3d', m: 'glow' });
    spot('k_oven');
    K.table(134, 2.6, 2.4, 1.2, '#d6a77a'); spot('k_dough');
    K.part({ s: 'ball', x: 134, y: .95, z: 2.6, r: .35, c: '#fef3c7', sy: .5, seg: 12 });
    for (const [x, z] of [[123, -7.2], [133, -7.2]]) { K.table(x, z, .9, .9, '#f8fafc', .75); K.chair(x - .9, z, PI / 2); K.chair(x + .9, z, -PI / 2); }
    K.npc({ id: 'k_baker', name: '👨‍🍳 Пекарь Булкин', x: 128, z: -2.4, yaw: 180, seed: 'bulkin', say: ['Свежие булочки! 🥐 Всего ⭐1', 'Хочешь печь сам? Стань пекарем на щите «Работа»', 'Тесто любит, когда его месят с любовью'] });
    K.item({ x: 128, y: 1.2, z: -5.6, r: 1.2, prompt: () => '🥐 Купить булочку (⭐1)', act: () => K.rt.city?.kids?.buy('bun', 1) });
    // ── Киоск мороженого ──
    K.building({ id: 'k_ice', x: 148, z: -6, w: 9, d: 7, h: 3.2, wall: '#fbcfe8', trim: '#db2777', roofC: '#f472b6', floor: '#fce7f3', interior: true,
      doors: [{ side: 'e', at: 1, w: 2 }], windows: [{ side: 'n', at: 0, w: 4, h: 1.2 }], sign: '🍦 Мороженое', signBg: '#db2777' });
    K.counter(148, -8.6, 4.6, .8, '#f9a8d4', '#ffffff');
    spot('k_icewin'); spot('k_icecounter');
    K.npc({ id: 'k_icelady', name: '🍦 Мороженщица', x: 147, z: -7.4, yaw: 180, seed: 'morozh', say: ['Мороженое! Пломбир, шоколадное, клубничное 🍦', 'Всего одна звёздочка ⭐'] });
    K.item({ x: 148, y: 1.2, z: -10.4, r: 1.2, prompt: () => '🍦 Купить мороженое (⭐1)', act: () => K.rt.city?.kids?.buy('icecream', 1) });
    yield;
    // ── Зоомагазин ──
    K.chunk('pets');
    K.building({ id: 'k_pets', x: 165, z: -2, w: 12, d: 12, h: 3.6, wall: '#bbf7d0', trim: '#15803d', roofC: '#166534', floor: '#d9f99d',
      doors: [{ side: 'n', at: 0, w: 2.6 }], windows: [{ side: 'n', at: -3.6, w: 2 }, { side: 'n', at: 3.6, w: 2 }], sign: '🐶 Зоомагазин', signBg: '#15803d' });
    K.counter(165, -4.6, 4, .8, '#15803d', '#dcfce7');
    Object.values(PETS).forEach(([e], i) => { const x = 160.8 + i * 1.65, z = 3.2; K.box(x, .12, z, 1.3, 1.1, 1.3, '#cbd5e1', { solid: true }); K.label.sign(e, x, 1.6, z - .7, .9, .9, PI, { bg: '#ecfccb', w: 96, h: 96, border: false }); });
    K.npc({ id: 'k_petseller', name: '🐹 Продавец зоомагазина', x: 165, z: -2.8, yaw: 180, seed: 'zooman', say: ['Возьми питомца — он будет ходить за тобой! 🐾', 'Корм для питомца — ⭐1'] });
    K.item({ x: 165, y: 1.2, z: -6, r: 1.2, prompt: () => '🐾 Взять питомца', act: () => K.rt.city?.kids?.petShop() });
    yield;
    // ── Парк ──
    K.chunk('park');
    for (const [x1, z1, x2, z2] of [[115, 14, 170, 14], [142, 4, 142, 37]]) K.part({ s: 'box', x: (x1 + x2) / 2, y: .025, z: (z1 + z2) / 2, w: x1 === x2 ? 2.4 : Math.abs(x2 - x1), h: .02, d: z1 === z2 ? 2.4 : Math.abs(z2 - z1), m: M.walk });
    K.part({ s: 'disc', x: 128, y: .04, z: 27, r: 5, rx: -PI / 2, m: K.R.water('#38bdf8', { key: 'mzkpond', fixedColor: true }) });
    K.part({ s: 'ring', x: 128, y: .05, z: 27, r: 5.6, r2: 4.95, rx: -PI / 2, c: '#94a3b8' });
    for (const [x, z, yaw] of [[136, 20, PI], [148, 20, PI], [156, 30, -PI / 2], [120, 20, PI]]) K.bench(x, z, yaw);
    for (const [x, z] of [[114, 34], [118, 9], [150, 36], [160, 9], [166, 22], [134, 36], [124, 36], [168, 34]]) K.tree(x, z, 1, (x + z) % 4);
    for (const [x, z, c] of [[146, 26, '#f472b6'], [138, 30, '#facc15'], [152, 25, '#a78bfa']]) K.prefab('flowers', { x, z, seed: x, c });
    K.table(160, 27, 2, 1.2, '#a16207'); K.chair(160, 25.8, 0); K.chair(160, 28.2, PI);
    K.npc({ id: 'k_mom', name: '👩 Мама Света', x: 152, z: 28, yaw: 0, seed: 'sveta3', act: 'wander', radius: 8, say: ['Какой чудесный день! ☀️', 'В зоомагазине можно взять питомца 🐶'] });
    K.npc({ id: 'k_kid2', name: '👧 Аня', x: 130, z: 18, yaw: 90, seed: 'anya44', act: 'wander', radius: 9, say: ['Пойдём есть мороженое! 🍦', 'Я хочу стать ветеринаром 🐾'] });
    yield;
    // ── Дома семей (сделать своим) ──
    K.chunk('houses');
    const HOUSES = [['k_h1', 196, -4, 'n', '#fde68a'], ['k_h2', 218, -4, 'n', '#a5f3fc'], ['k_h3', 240, -4, 'n', '#f5d0fe'], ['k_h4', 241, 25, 'w', '#bbf7d0']];
    K.houses = [];
    for (const [id, x, z, side, wall] of HOUSES) {
      K.building({ id, x, z, w: 11, d: 10, h: 3.4, wall, trim: '#7c2d12', roofC: '#b91c1c', floor: '#d6a77a',
        doors: [{ side, at: 0, w: 2.2 }], windows: [{ side, at: -3.4, w: 1.6 }, { side, at: 3.4, w: 1.6 }, { side: side === 'n' ? 's' : 'e', at: 0, w: 2 }] });
      const fx = side === 'n' ? 0 : -1, fz = side === 'n' ? -1 : 0;   // куда дверь
      K.bed(x + (side === 'n' ? 3 : 2.6), z + (side === 'n' ? 2.6 : -2.6), side === 'n' ? PI : PI / 2, pick(['#60a5fa', '#f472b6', '#4ade80', '#facc15']));
      K.sofa(x - 2.8, z + (side === 'n' ? 2.8 : 2.4), side === 'n' ? PI : -PI / 2, pick(['#7c3aed', '#ea580c', '#0891b2']));
      K.table(x - 1.5, z - .5, 1.2, .9, '#a16207'); K.chair(x - 2.5, z - .5, PI / 2); K.chair(x - .5, z - .5, -PI / 2);
      K.box(x + 4.6 * (side === 'n' ? 1 : 0) - (side === 'w' ? 0 : 0), .12, z + (side === 'n' ? -2.2 : 3.6), 1.4, .9, .8, '#e5e7eb', { solid: true });   // плита
      K.rug(x, z, 4, 3, pick(['#fde68a', '#fecaca', '#bfdbfe']));
      const door = { x: x + fx * 5.9, z: z + fz * 5.4 };
      K.houses.push({ id, x, z, door, cook: { x: x + (side === 'n' ? 4.6 : 0), z: z + (side === 'n' ? -1.5 : 2.9) } });
      K.item({ x: door.x, y: 1.4, z: door.z, r: 1.1, prompt: () => K.rt.city?.kids?.housePrompt(id), act: () => K.rt.city?.kids?.houseAct(id) });
      K.item({ x: x + (side === 'n' ? 4.6 : 0), y: 1.2, z: z + (side === 'n' ? -1.4 : 2.8), r: 1, prompt: () => '🍳 Приготовить обед', act: () => K.rt.city?.kids?.cookHome() });
    }
    yield;
    // ── Стройка ──
    K.chunk('site');
    K.part({ s: 'box', x: 204, y: .03, z: 24, w: 20, h: .03, d: 16, m: M.dirt });
    for (const [x1, z1, x2, z2] of [[194, 16, 214, 16], [194, 32, 214, 32], [214, 16, 214, 32]]) K.prefab('fence', { x1, z1, x2, z2, c: '#f59e0b' });
    K.prefab('fence', { x1: 194, z1: 16, x2: 194, z2: 21, c: '#f59e0b' }); K.prefab('fence', { x1: 194, z1: 27, x2: 194, z2: 32, c: '#f59e0b' });
    for (let i = 0; i < 6; i++) K.part({ s: 'box', x: 197 + (i % 3) * .5, y: .15 + Math.floor(i / 3) * .3, z: 18.5, w: .45, h: .28, d: .9, c: '#c2410c' });
    spot('k_bricks');
    K.cyl(212, 0, 30, .3, 12, '#facc15', { solid: true }); K.part({ s: 'box', x: 208, y: 12, z: 30, w: 10, h: .4, d: .4, c: '#facc15' }); K.part({ s: 'cyl', x: 204, y: 10, z: 30, r: .02, h: 4, c: '#374151' });
    spot('k_site');
    K.npc({ id: 'k_foreman', name: '👷 Прораб Иван', x: 199, z: 29, yaw: 120, seed: 'prorab', say: ['Каска — обязательно! ⛑️', 'Носи кирпичи на стройку — дом растёт!', 'Строителем можно стать на щите «Работа»'] });
    yield;
    K.flush();
    K.done = true;
  }
  // пожарная машина (декорация)
  function fireTruck(K, x, z, yaw){
    const g = K.group(x, 0, z, yaw), P = p => K.R.part(g, p);
    P({ s: 'box', y: 1.2, z: -.8, w: 2.4, h: 1.6, d: 5.2, c: '#dc2626' }); P({ s: 'box', y: 1.4, z: 2.4, w: 2.4, h: 2, d: 1.8, c: '#b91c1c' });
    P({ s: 'box', y: 1.9, z: 3.2, w: 2.2, h: .8, d: .1, c: '#bfdbfe' }); P({ s: 'box', y: 2.2, z: -.8, w: .5, h: .2, d: 5, c: '#e5e7eb' });
    for (const [sx, sz] of [[-1.2, 2.2], [1.2, 2.2], [-1.2, -2], [1.2, -2]]) P({ s: 'cyl', x: sx, y: .5, z: sz, r: .5, h: .4, rz: PI / 2, c: '#111827', seg: 12 });
    P({ s: 'box', y: 2.5, z: 2.4, w: .8, h: .2, d: .3, c: '#60a5fa', m: 'glow' });
    K.body({ x, z, y: 1.3, hx: 1.3, hy: 1.3, hz: 3.4, yaw, tag: 'car' });
  }
  // ═══ ПОСТРОЙКА: Большой город ═══
  function* buildMetro(K){
    const { R } = K, M = K.M;
    K.spots = spotsOf(K.Z.id);
    const spot = id => K.spots[id];
    K.chunk('streets');
    K.road(90, 130, 146, 130); K.road(154, 130, 211, 130); K.road(219, 130, 270, 130);
    K.road(90, 205, 146, 205); K.road(154, 205, 211, 205); K.road(219, 205, 270, 205);
    K.road(150, 100, 150, 126); K.road(150, 134, 150, 201); K.road(150, 209, 150, 260);
    K.road(215, 100, 215, 126); K.road(215, 134, 215, 201); K.road(215, 209, 215, 260);
    for (const [x, z] of [[150, 130], [215, 130], [150, 205], [215, 205]]) {
      K.part({ s: 'box', x, y: .025, z, w: 8, h: .02, d: 8, m: M.asphalt });
      for (const [dx, dz, yaw] of [[-9, 0, PI / 2], [9, 0, PI / 2], [0, -9, 0], [0, 9, 0]]) K.zebra(x + dx, z + dz, 8, yaw);
      // светофоры (огни светятся)
      for (const [sx, sz] of [[-5.4, -5.4], [5.4, 5.4]]) { K.box(x + sx, 0, z + sz, .16, 3.2, .16, '#1f2937', { solid: true }); K.part({ s: 'box', x: x + sx, y: 3.4, z: z + sz, w: .4, h: 1, d: .3, c: '#111827' }); K.part({ s: 'ball', x: x + sx, y: 3.7, z: z + sz + .16, r: .1, c: '#ef4444', m: 'glow' }); K.part({ s: 'ball', x: x + sx, y: 3.1, z: z + sz + .16, r: .1, c: '#22c55e', m: 'glow' }); }
    }
    for (let x = 100; x < 268; x += 18) for (const zz of [130, 205]) for (const s of [-1, 1]) if (Math.abs(x - 150) > 8 && Math.abs(x - 215) > 8) K.lamp(x, zz + s * 5.6);
    for (let z = 108; z < 258; z += 18) for (const xx of [150, 215]) for (const s of [-1, 1]) if (Math.abs(z - 130) > 8 && Math.abs(z - 205) > 8) K.lamp(xx + s * 5.6, z);
    for (let x = 108; x < 268; x += 24) for (const zz of [130, 205]) if (Math.abs(x - 150) > 10 && Math.abs(x - 215) > 10) K.tree(x + 5, zz + 7.8, .8, (x / 24 | 0) % 4);
    K.board(96, 2.2, 140.2, 3, 1.5, PI, '🏛️ Работа — в мэрии', { bg: '#1e3a8a' });
    K.box(96, 0, 140.4, .16, 1.5, .16, '#475569', { solid: true });
    K.item({ x: 96, y: 1.6, z: 139.2, r: 1.2, prompt: () => '🧰 Работа: выбрать профессию', act: () => K.rt.city?.metro?.jobBoard() });
    yield;
    // ── Мэрия и площадь с фонтаном ──
    K.chunk('hall');
    K.building({ id: 'm_hall', x: 182, z: 175, w: 28, d: 22, h: 7, wall: '#fef3c7', trim: '#92400e', roofC: '#78350f', floor: '#e7d3a8', floorM: M.walk,
      doors: [{ side: 'n', at: 0, w: 3.4, h: 3.6 }], windows: [{ side: 'n', at: -9, w: 3, h: 2.6 }, { side: 'n', at: 9, w: 3, h: 2.6 }, { side: 'e', at: 0, w: 4, h: 2.6 }, { side: 'w', at: 0, w: 4, h: 2.6 }],
      sign: '🏛️ Мэрия', signBg: '#92400e' });
    for (const x of [172, 177, 187, 192]) K.cyl(x, 0, 163, .45, 6.6, '#f5f5f4', { solid: true });
    K.counter(182, 180, 8, 1, '#78350f', '#fde68a');
    K.board(182, 3, 185.8, 5, 2, PI, '📋 Вакансии города', { bg: '#1e3a8a' });
    K.item({ x: 182, y: 1.3, z: 178.5, r: 1.6, prompt: () => '🧰 Работа: выбрать профессию', act: () => K.rt.city?.metro?.jobBoard() });
    K.npc({ id: 'm_mayor', name: '🎩 Мэр города', x: 182, z: 181.6, yaw: 180, seed: 'mayor1', say: ['Добро пожаловать в Большой город! 🏙️', 'Работа есть для всех — выбирай на стойке', 'Грабителей у нас ловят быстро 👮'] });
    K.part({ s: 'box', x: 182, y: .03, z: 150, w: 40, h: .03, d: 26, m: M.plaza });
    K.cyl(182, 0, 150, 3.4, .6, '#d6d3d1', { solid: true, seg: 24 }); K.part({ s: 'cyl', x: 182, y: .34, z: 150, r: 3.1, h: .5, c: '#38bdf8', seg: 24, m: K.R.water('#38bdf8', { key: 'mzmfount', fixedColor: true }) });
    K.part({ s: 'cyl', x: 182, y: 1.1, z: 150, r: .35, h: 1.6, c: '#e7e5e4' });
    for (const [x, z, yaw] of [[171, 145, PI / 2], [193, 145, -PI / 2], [171, 155, PI / 2], [193, 155, -PI / 2]]) K.bench(x, z, yaw);
    for (const [x, z] of [[165, 140], [199, 140], [165, 160], [199, 160]]) K.tree(x, z, 1, 1);
    spot('m_fount');
    yield;
    // ── Полиция и тюрьма ──
    K.chunk('police');
    K.building({ id: 'm_police', x: 116, z: 152, w: 26, d: 18, h: 5, wall: '#cbd5e1', trim: '#1e3a8a', roofC: '#1e3a8a', floor: '#e2e8f0', floorType: 'tile', floorM: M.walk,
      doors: [{ side: 'n', at: -4, w: 3 }], windows: [{ side: 'n', at: -10, w: 2.6 }, { side: 'n', at: 4, w: 2.6 }, { side: 'w', at: 0, w: 3 }], sign: '👮 Полиция', signBg: '#1e3a8a' });
    K.counter(110, 148, 6, 1, '#1e3a8a', '#e2e8f0');
    for (const x of [118, 123]) { K.table(x, 147, 1.6, .9, '#475569'); K.chair(x, 148, PI); }
    // камеры: решётки (тела), внутри — нары
    K.box(116, .12, 155, 26 - .6, .1, .1, '#334155');
    const CELLS = [];
    for (let i = 0; i < 3; i++) {
      const cx = 110 + i * 6, cz = 158;
      K.box(cx - 3, .12, cz, .2, 4.8, 5.4, '#475569', { solid: true, cam: true });
      for (let k = 0; k < 9; k++) K.part({ s: 'cyl', x: cx - 2.4 + k * .6, y: 1.6, z: 155.3, r: .05, h: 3.2, c: '#94a3b8', seg: 6 });
      K.body({ x: cx, z: 155.3, y: 1.6, hx: 2.9, hy: 1.6, hz: .12, tag: 'bars', data: { cam: false } });
      K.box(cx + 1.6, .12, cz + 1.5, 1.6, .5, 1.8, '#64748b', { solid: true });
      CELLS.push({ x: cx, z: cz - .2 });
    }
    K.box(125.5, .12, 158, .2, 4.8, 5.4, '#475569', { solid: true, cam: true });
    K.cells = CELLS; K.jailOut = { x: 112, z: 139 };
    spot('m_desk');
    K.npc({ id: 'm_cop', name: '👮 Сержант Петров', x: 110, z: 149.6, yaw: 180, seed: 'petrov', say: ['Полиция Большого города — на страже! 👮', 'Стать полицейским можно в мэрии', 'Грабитель? Подойди ближе и задержи его (держи E)'] });
    yield;
    // ── Суд ──
    K.chunk('court');
    K.building({ id: 'm_court', x: 116, z: 184, w: 24, d: 16, h: 5.5, wall: '#f5f5f4', trim: '#57534e', roofC: '#44403c', floor: '#d6d3d1', floorM: M.walk,
      doors: [{ side: 's', at: 0, w: 3 }], windows: [{ side: 's', at: -8, w: 2.4 }, { side: 's', at: 8, w: 2.4 }, { side: 'e', at: 0, w: 3 }], sign: '⚖️ Суд', signBg: '#57534e' });
    K.box(116, .12, 179, 6, 1.4, 1.4, '#7c2d12', { solid: true }); K.box(116, 1.52, 179, 6.2, .1, 1.6, '#a16207');
    K.chair(116, 177.2, 0, '#7c2d12');
    spot('m_judge');
    for (let r = 0; r < 3; r++) K.bench(116 + (r - 1) * 0, 184 + r * 2.4, PI);
    K.box(109, .12, 182, 1.4, 1, 1.4, '#a8a29e', { solid: true }); spot('m_defend');
    K.npc({ id: 'm_judgeNpc', name: '⚖️ Секретарь суда', x: 122, z: 180, yaw: 270, seed: 'secret', say: ['Встать, суд идёт! ⚖️', 'Судьёй можно стать в мэрии'] });
    yield;
    // ── Банк ──
    K.chunk('bank');
    K.building({ id: 'm_bank', x: 246, z: 152, w: 24, d: 18, h: 6, wall: '#e7e5e4', trim: '#166534', roofC: '#14532d', floor: '#f5f5f4', floorType: 'tile', floorM: M.walk,
      doors: [{ side: 'n', at: 0, w: 3.2 }], windows: [{ side: 'n', at: -7, w: 3, h: 2.2 }, { side: 'n', at: 7, w: 3, h: 2.2 }], sign: '🏦 Банк', signBg: '#166534' });
    for (const x of [240, 252]) K.cyl(x, 0, 142.6, .4, 5.4, '#f5f5f4', { solid: true });
    K.counter(246, 151, 14, 1, '#166534', '#dcfce7');
    for (const x of [242, 250]) K.part({ s: 'box', x, y: 1.7, z: 151, w: 2.4, h: 1, d: .05, m: K.M.glass });
    spot('m_teller'); spot('m_client');
    // хранилище: дверь-сейф и золото
    K.box(246, .12, 159.2, 8, 4, .3, '#64748b', { solid: true, cam: true });
    K.cyl(246, .12, 159, 1.3, .3, '#94a3b8', { rx: PI / 2 }); K.part({ s: 'torus', x: 246, y: 1.42, z: 158.75, r: .6, t: .08, c: '#facc15' });
    for (let i = 0; i < 6; i++) K.part({ s: 'box', x: 243 + (i % 3) * .7, y: .32 + Math.floor(i / 3) * .25, z: 160.4, w: .6, h: .22, d: .3, c: '#facc15', metal: .8, rough: .3 });
    spot('m_vault');
    K.box(237.2, 0, 141.6, .9, 1.9, .6, '#334155', { solid: true }); K.part({ s: 'box', x: 237.2, y: 1.3, z: 141.28, w: .6, h: .4, d: .02, c: '#22d3ee', m: 'glow' });
    K.item({ x: 237.2, y: 1.2, z: 140.6, r: 1, prompt: () => '🏧 Банкомат: положить / снять', act: () => K.rt.city?.metro?.bankPanel() });
    K.npc({ id: 'm_teller', name: '🏦 Кассир Анна', x: 246, z: 153, yaw: 180, seed: 'kassir', say: ['Добро пожаловать в банк! 🏦', 'Положить или снять кэш — в банкомате у входа', 'Хотите работать у нас? Вакансии — в мэрии'] });
    yield;
    // ── Больница ──
    K.chunk('hosp');
    K.building({ id: 'm_hosp', x: 246, z: 184, w: 22, d: 14, h: 5, wall: '#f8fafc', trim: '#dc2626', roofC: '#94a3b8', floor: '#e2e8f0', floorType: 'tile', floorM: M.walk,
      doors: [{ side: 's', at: 0, w: 3 }], windows: [{ side: 's', at: -7, w: 2.4 }, { side: 's', at: 7, w: 2.4 }], sign: '🏥 Больница', signBg: '#dc2626' });
    for (const [i, x] of [238, 242, 250, 254].entries()) { K.bed(x, 179.4, 0, '#bfdbfe'); spot('m_bed' + i); }
    K.counter(246, 186, 4, .9, '#e5e7eb', '#ffffff'); spot('m_meds');
    K.box(236, .12, 187, .6, 2, 1.6, '#f1f5f9', { solid: true });
    K.npc({ id: 'm_doc', name: '🩺 Доктор Иванова', x: 246, z: 184.6, yaw: 0, seed: 'ivanova', say: ['Здоровья вам! 🩺', 'Больница — место, где все поправляются'] });
    yield;
    // ── Автосалон, такси, заправка ──
    K.chunk('cars');
    K.building({ id: 'm_cars', x: 182, z: 112, w: 28, d: 14, h: 5, wall: '#e0f2fe', trim: '#0369a1', roofC: '#0c4a6e', floor: '#f1f5f9', floorType: 'tile', floorM: M.walk,
      doors: [{ side: 's', at: 0, w: 4 }], windows: [{ side: 's', at: -9, w: 7, h: 2.6 }, { side: 's', at: 9, w: 7, h: 2.6 }], sign: '🚗 Автосалон', signBg: '#0369a1' });
    for (const [x, c] of [[172, '#ef4444'], [182, '#2563eb'], [192, '#22c55e']]) { K.cyl(x, .12, 110, 2.6, .2, '#cbd5e1', { seg: 20 }); carModel(K, x, 110, PI / 6, c, .32); }
    spot('m_dealer');
    K.npc({ id: 'm_dealer', name: '🚗 Продавец машин', x: 186, z: 116.4, yaw: 200, seed: 'automan', say: ['Лучшие машины города! 🚗', 'Машины можно будет водить — уже скоро'] });
    K.item({ x: 182, y: 1.2, z: 117.5, r: 1.6, prompt: () => '🚗 Машины: посмотреть', act: () => K.rt.city?.metro?.dealer() });
    K.building({ id: 'm_taxi', x: 246, z: 112, w: 20, d: 14, h: 4.5, wall: '#fef9c3', trim: '#a16207', roofC: '#713f12', floor: '#e5e7eb', floorM: M.concrete, floorType: 'concrete',
      doors: [{ side: 's', at: -4, w: 5, h: 3.4 }, { side: 's', at: 5, w: 2.4 }], sign: '🚕 Такси', signBg: '#a16207' });
    carModel(K, 239, 121.6, PI / 2, '#facc15', 0); carModel(K, 253, 121.6, PI / 2, '#facc15', 0);
    K.npc({ id: 'm_disp', name: '🚕 Диспетчер', x: 250, z: 110, yaw: 180, seed: 'dispet', say: ['Такси! Куда едем? 🚕', 'Таксистом можно стать в мэрии'] });
    // заправка: навес на столбах, колонки
    for (const [sx, sz] of [[-7, -3.6], [7, -3.6], [-7, 3.6], [7, 3.6]]) K.box(115 + sx, 0, 113 + sz, .4, 4.4, .4, '#e5e7eb', { solid: true });
    K.part({ s: 'box', x: 115, y: 4.6, z: 113, w: 16, h: .4, d: 9, c: '#ef4444' });
    K.label.sign('⛽ Заправка', 115, 4.6, 117.55, 6, .5, 0, { bg: '#b91c1c', w: 512, h: 64 });
    for (const x of [111, 119]) { K.box(x, 0, 113, .8, 1.6, .6, '#f8fafc', { solid: true }); K.part({ s: 'box', x, y: 1.3, z: 112.68, w: .5, h: .3, d: .02, c: '#22c55e', m: 'glow' }); }
    K.part({ s: 'box', x: 115, y: .03, z: 113, w: 20, h: .02, d: 12, m: M.concrete });
    yield;
    // ── Супермаркет и ресторан ──
    K.chunk('shops');
    K.building({ id: 'm_shop', x: 105, z: 234, w: 22, d: 18, h: 5, wall: '#dcfce7', trim: '#15803d', roofC: '#14532d', floor: '#f1f5f9', floorType: 'tile', floorM: M.walk,
      doors: [{ side: 'n', at: -3, w: 3.4 }], windows: [{ side: 'n', at: 5, w: 6, h: 2.4 }], sign: '🛒 Супермаркет', signBg: '#15803d' });
    for (let i = 0; i < 3; i++) K.shelf(100 + i * 5, 238, 3.2, 0);
    K.counter(99, 229, 3, 1, '#15803d', '#dcfce7'); spot('m_till'); spot('m_buyer');
    K.box(115, .12, 242, 2, 2, 1, '#94a3b8', { solid: true }); spot('m_dock');
    K.npc({ id: 'm_shopper', name: '🧑 Покупатель', x: 104, z: 236, yaw: 0, seed: 'pokup2', act: 'wander', radius: 4, say: ['Где тут свежий хлеб? 🍞'] });
    K.item({ x: 99, y: 1.2, z: 227.6, r: 1.2, prompt: () => '🛒 Купить продукты', act: () => K.rt.city?.metro?.shop('market') });
    K.building({ id: 'm_rest', x: 131, z: 234, w: 16, d: 18, h: 4.6, wall: '#fee2e2', trim: '#b91c1c', roofC: '#7f1d1d', floor: '#c8956a',
      doors: [{ side: 'n', at: 0, w: 2.8 }], windows: [{ side: 'n', at: -5, w: 2.6 }, { side: 'n', at: 5, w: 2.6 }, { side: 'e', at: 2, w: 3 }], sign: '🍝 Ресторан «Вкусно»', signBg: '#b91c1c' });
    for (const [x, z] of [[127, 229], [135, 229], [127, 234], [135, 234]]) { K.table(x, z, 1.1, 1.1, '#f8fafc', .76); K.chair(x - 1, z, PI / 2, '#7f1d1d'); K.chair(x + 1, z, -PI / 2, '#7f1d1d'); }
    K.box(131, .12, 241.6, 6, 1, 1, '#9ca3af', { solid: true }); K.part({ s: 'box', x: 129, y: 1.15, z: 241.6, w: 1.4, h: .1, d: .8, c: '#f97316', m: 'glow' });
    spot('m_stove'); spot('m_fridge');
    K.box(137.6, .12, 241.8, 1, 2.2, .9, '#e2e8f0', { solid: true });
    K.npc({ id: 'm_chef', name: '👨‍🍳 Шеф Марко', x: 133, z: 240.4, yaw: 180, seed: 'marko5', say: ['Паста, пицца, суп — всё свежее! 🍝', 'Поваром можно стать в мэрии'] });
    K.item({ x: 131, y: 1.2, z: 227.4, r: 1.2, prompt: () => '🍝 Заказать еду', act: () => K.rt.city?.metro?.shop('rest') });
    yield;
    // ── Бизнес-центр: три киоска (купить бизнес) ──
    K.chunk('biz');
    K.part({ s: 'box', x: 182, y: .03, z: 238, w: 50, h: .02, d: 20, m: M.concrete });
    for (const [id, x, name, c, e] of [['coffee', 166, '☕ Кофейня', '#7c3aed', '☕'], ['flowers', 182, '💐 Цветы', '#db2777', '💐'], ['wash', 198, '🚿 Автомойка', '#0891b2', '🚿']]) {
      K.building({ id: 'm_' + id, x, z: 230, w: 12, d: 10, h: 4, wall: '#f8fafc', trim: c, roofC: c, floor: '#e5e7eb', floorM: M.walk,
        doors: [{ side: 'n', at: 0, w: 2.6 }], windows: [{ side: 'n', at: -3.6, w: 2 }, { side: 'n', at: 3.6, w: 2 }], sign: name, signBg: c });
      K.counter(x, 232, 4, .9, c, '#ffffff');
      spot('m_biz_' + id);
      K.item({ x, y: 1.2, z: 224.4, r: 1.2, prompt: () => K.rt.city?.metro?.bizPrompt(id, name), act: () => K.rt.city?.metro?.bizAct(id, name, e) });
    }
    yield;
    // ── Жилые дома (квартиры) ──
    K.chunk('homes');
    K.houses = [];
    for (const [id, x, z, wall, h] of [['m_h1', 235, 236, '#fde68a', 8], ['m_h2', 258, 236, '#c4b5fd', 9]]) {
      const b = K.building({ id, x, z, w: 14, d: 14, h: 4, wall, trim: '#57534e', roofC: '#44403c', floor: '#d6a77a', doors: [{ side: 'n', at: 0, w: 2.4 }], windows: [{ side: 'n', at: -4.5, w: 2 }, { side: 'n', at: 4.5, w: 2 }, { side: 's', at: 0, w: 3 }] });
      // верхние этажи — в группе крыши (изнутри прячутся вместе с ней), тело камеру не держит
      K.R.part(b.roof, { s: 'box', y: 4.36 + (h - 4) / 2, w: 13.4, h: h - 4, d: 13.4, c: wall });
      for (let f = 0; f < Math.floor((h - 4) / 2); f++) for (const s of [-1, 1]) K.R.part(b.roof, { s: 'box', x: s * 3.5, y: 5.6 + f * 2, z: -6.73, w: 2.2, h: 1.2, d: .06, c: '#93c5fd' });
      K.body({ x, z, y: 4.36 + (h - 4) / 2, hx: 6.7, hy: (h - 4) / 2, hz: 6.7, data: { cam: false } });
      K.bed(x + 4, z + 3.5, PI, '#93c5fd'); K.sofa(x - 3.5, z + 4.2, PI, '#475569');
      K.table(x - 3, z - 1, 1.4, .9, '#78350f'); K.chair(x - 4, z - 1, PI / 2); K.chair(x - 2, z - 1, -PI / 2);
      K.box(x + 5.4, .12, z - 3, 1.4, .9, 2, '#e5e7eb', { solid: true });
      K.rug(x, z + 1, 4, 3, '#bfdbfe');
      K.houses.push({ id, x, z, door: { x, z: z - 7.4 } });
      K.item({ x, y: 1.4, z: z - 7.4, r: 1.1, prompt: () => K.rt.city?.metro?.housePrompt(id), act: () => K.rt.city?.metro?.houseAct(id) });
    }
    K.npc({ id: 'm_walker1', name: '🧑‍💼 Прохожий', x: 182, z: 150, yaw: 0, seed: 'walk01', act: 'wander', radius: 16, phone: 1, say: ['Отличная погода для прогулки!'] });
    K.npc({ id: 'm_patrol', name: '👮 Патрульный', x: 182, z: 205, yaw: 0, seed: 'patrol', act: 'wander', radius: 26, say: ['Порядок в городе! 👮'] });
    yield;
    K.flush();
    K.done = true;
  }
  // машинка (декорация; ездить — vehicle.js, когда будет)
  function carModel(K, x, z, yaw, c, y0 = 0){
    const g = K.group(x, y0, z, yaw), P = p => K.R.part(g, p);
    P({ s: 'box', y: .75, w: 2, h: .7, d: 4.2, c }); P({ s: 'box', y: 1.35, z: -.2, w: 1.8, h: .6, d: 2.2, c: '#dbeafe' });
    P({ s: 'box', y: 1.68, z: -.2, w: 1.8, h: .06, d: 2.2, c });
    for (const [sx, sz] of [[-1, 1.3], [1, 1.3], [-1, -1.3], [1, -1.3]]) P({ s: 'cyl', x: sx, y: .4, z: sz, r: .4, h: .3, rz: PI / 2, c: '#111827', seg: 10 });
    for (const s of [-1, 1]) P({ s: 'box', x: s * .6, y: .85, z: 2.12, w: .4, h: .16, d: .04, c: '#fef9c3', m: 'glow' });
    K.body({ x, z, y: y0 + 1, hx: 1, hy: 1, hz: 2.1, yaw, tag: 'car' });
  }

  // ═══ Задания по ролям (чистая функция — проверяется в node): шаги { text, at (точка), hold (с), act (поза), carry, icon, … } ═══
  function taskList(role, city, spots, r = Math.random, biz = []){
    const SP = id => spots[id], P3 = (x, z, y = 1) => ({ x, y, z }), pick = a => a[Math.floor(r() * a.length)];
    switch (role) {
      case 'baker': { const c = pick(K_CUST); return [
        { text: 'Замеси тесто', at: SP('k_dough'), hold: 2, act: 'cook', icon: '🥣' },
        { text: 'Испеки булочки в печи', at: SP('k_oven'), hold: 3, act: 'cook', icon: '🔥', fx: 'oven' },
        { text: 'Отнеси булочки жителю', at: P3(c[0], c[1]), carry: 'bun', icon: '🙋', cust: true, done: 'Спасибо, вкусно!' }]; }
      case 'fireman': { const f = pick(K_FIRES); return [
        { text: 'Возьми шланг в пожарной части', at: SP('k_hose'), hold: 1, icon: '🧯' },
        { text: 'Пожар! Беги и потуши его (держи E)', at: P3(f[0], f[1]), hold: 3.2, act: 'hose', icon: '🔥', fire: true, done: 'Огонь потушен! 🚒' }]; }
      case 'doctor': case 'medic': { const i = Math.floor(r() * (city === 'kids' ? 3 : 4)), bed = SP((city === 'kids' ? 'k_bed' : 'm_bed') + i); return [
        { text: 'Осмотри пациента', at: bed, hold: 2, act: 'heal', icon: '🤒', patient: true },
        { text: 'Возьми лекарство в шкафу', at: SP(city === 'kids' ? 'k_med' : 'm_meds'), hold: 1, icon: '💊', carry: 'med' },
        { text: 'Дай лекарство пациенту', at: bed, hold: 1.5, act: 'heal', icon: '🤒', patient: true, done: 'Пациент здоров! ✨' }]; }
      case 'vet': { const p = pick(K_PETS); return [
        { text: 'Найди приболевшего питомца', at: P3(p[0], p[1], .5), hold: 1, icon: '🐶', sick: true },
        { text: 'Отнеси питомца в ветклинику', at: SP('k_vettable'), hold: 2.5, act: 'heal', icon: '🩹', carry: 'pet', done: 'Питомец здоров и весел! 🐾' }]; }
      case 'builder': { const L = []; for (let i = 0; i < 3; i++) L.push({ text: `Возьми кирпичи (${i + 1}/3)`, at: SP('k_bricks'), hold: .8, icon: '🧱' }, { text: `Положи кирпичи на стройку (${i + 1}/3)`, at: SP('k_site'), hold: 1, act: 'fix', icon: '🏗️', carry: 'brick', site: i === 2 }); return L; }
      case 'icecream': { const L = []; for (let i = 0; i < 3; i++) L.push({ text: `Обслужи покупателя (${i + 1}/3)`, at: SP('k_icecounter'), hold: 1.5, icon: '🙋', act: 'cook', cust2: SP('k_icewin') }); return L; }
      case 'police': {
        if (r() < .5) { const L = [[130, 125], [205, 140], [232, 200], [160, 212], [100, 200]].sort(() => r() - .5).slice(0, 3); return L.map((p, i) => ({ text: `Патруль: дойди до точки ${i + 1}/3`, at: P3(p[0], p[1]), icon: '🚨', walk: true })); }
        const s = pick([[99, 227, 'в супермаркете'], [166, 224, 'у кофейни'], [131, 226, 'у ресторана']]);
        return [{ text: `Ограбление ${s[2]}! Задержи грабителя (держи E)`, at: P3(s[0], s[1]), hold: 1.6, icon: '🦹', robber: true, done: 'Грабитель задержан! 👮' }]; }
      case 'robber': { const o = r() < .25 ? ['Взломай хранилище банка! (держи E)', 'm_vault', 6] : r() < .5 ? ['Ограбь кассу кофейни (держи E)', 'm_biz_coffee', 3] : ['Ограбь кассу супермаркета (держи E)', 'm_till', 3];
        return [{ text: o[0], at: SP(o[1]), hold: o[2], icon: '💰', rob: 1 }]; }
      case 'cashier': { const L = []; for (let i = 0; i < 3; i++) L.push({ text: `Обслужи клиента банка (${i + 1}/3)`, at: SP('m_teller'), hold: 1.5, icon: '🙋', act: 'cook', cust2: SP('m_client') }); return L; }
      case 'seller': { const L = []; for (let i = 0; i < 3; i++) L.push({ text: `Пробей покупки (${i + 1}/3)`, at: SP('m_till'), hold: 1.5, icon: '🛒', act: 'cook', cust2: SP('m_buyer') }); return L; }
      case 'cook': { const t = pick([[127, 229], [135, 229], [127, 234], [135, 234]]); return [
        { text: 'Возьми продукты из холодильника', at: SP('m_fridge'), hold: 1, icon: '🥩' },
        { text: 'Приготовь блюдо на плите', at: SP('m_stove'), hold: 3, act: 'cook', icon: '🍳', carry: 'food' },
        { text: 'Подай блюдо гостю', at: P3(t[0], t[1]), hold: .8, icon: '🙋', carry: 'food', cust: true, done: 'Гость доволен! ⭐⭐⭐⭐⭐' }]; }
      case 'judge': return [{ text: 'Подсудимый ждёт: займи место судьи', at: SP('m_judge'), hold: 1.5, icon: '⚖️', trial: true }];
      case 'biz': { if (!biz.length) return [{ text: 'Купи бизнес в бизнес-центре (киоски на юге)', at: P3(182, 224), icon: '💼', walk: true, nobiz: true }];
        const b = pick(biz); return [{ text: 'Закупи товар на складе супермаркета', at: SP('m_dock'), hold: 1.2, icon: '📦' }, { text: 'Привези товар в свой бизнес', at: SP('m_biz_' + b), hold: 1.2, icon: '💼', carry: 'box', done: 'Полки полные — продажи растут! 📈' }]; }
      case 'taxi': return null;
    }
    return null;
  }

  // ═══ ИГРА В ГОРОДЕ: щиты, роли, задания, магазины, дома, полиция и грабители ═══
  function cityMod(rt, K, city){
    const S = rt.S, R = rt.R, T = rt.T, ph = rt.ph, X = rt.X, Z = MZ.ZONES[city];
    const ROLES = city === 'kids' ? ROLES_K : ROLES_M, W0 = WALLET[city];
    const H = rt.H, toast = rt.toast;
    rt.city = rt.city || {};
    rt.CARRY = Object.assign(rt.CARRY || {}, { bun: '🥐', brick: '🧱', pet: '🐶', med: '💊', box: '📦', money: '💰', food: '🍲', icecream: '🍦', coffee: '☕' });
    Object.assign(rt.FOOD, MZ.FOOD_EXTRA);
    const C = { city, K, job: null, step: 0, task: null, marker: null, fires: [], cust: null, pet: null, petT: 0, wantedT: 0, prisonT: 0, bizT: 0, holdOn: false };
    const W = () => wallet(city);
    const earn = (n, why) => { const s = W(); s.cash += n; walletSave(city, s); drawWallet(); if (n) toast(`${W0.icon} +${n}${why ? ' — ' + why : ''}`, true); };
    const spend = n => { const s = W(); if (s.cash < n) { toast(`Не хватает ${W0.name}: нужно ${W0.icon}${n}`, false); return false; } s.cash -= n; walletSave(city, s); drawWallet(); return true; };
    // кошелёк города — слева сверху, пока ты в городе
    const wEl = document.createElement('div'); wEl.className = 'mz-wallet'; wEl.hidden = true; rt.hud.appendChild(wEl);
    function drawWallet(){ const s = W(); wEl.innerHTML = `<span>${W0.icon} ${s.cash.toLocaleString('ru')}</span>${city === 'metro' && s.bank ? `<span>🏦 ${s.bank.toLocaleString('ru')}</span>` : ''}${rt.zx.r && ROLES[rt.zx.r] ? `<span>${ROLES[rt.zx.r].icon} ${esc(ROLES[rt.zx.r].name)}</span>` : ''}`; }
    const inCity = () => MZ.inRect(Z, S.P.ch.x, S.P.ch.z, 2);
    // ── метка цели задания: светящееся кольцо + значок (один объект на город) ──
    const mk = new T.Group(); mk.visible = false; R.scene.add(mk);
    const ringM = new T.Mesh(R.K.geo('mzMkRing', () => new T.RingGeometry(.7, .95, 28)), R.glow('#facc15')); ringM.rotation.x = -PI / 2; ringM.position.y = .06; mk.add(ringM);
    const iconS = new T.Sprite(rt.spriteMat('⬇️')); iconS.scale.setScalar(.9); iconS.position.y = 2.6; mk.add(iconS);
    let jobItem = null;
    function setTarget(p, icon, prompt, hold, act){
      mk.visible = !!p;
      if (jobItem) { X.remove(jobItem); jobItem = null; }
      if (!p) return;
      mk.position.set(p.x, p.y != null ? Math.max(0, p.y - 1.2) : 0, p.z);
      iconS.material = rt.spriteMat(icon || '⬇️');
      jobItem = X.add({ x: p.x, y: (p.y ?? 1) + .2, z: p.z, r: 1.3, hold: hold || 0, prompt: () => prompt, act: () => act() });
    }
    const SP = id => K.spots[id];
    const tasksFor = role => taskList(role, city, K.spots, Math.random, W().biz);
    // ── работа: начать, шаг, конец ──
    function setJob(role){
      if (role && !ROLES[role]) return;
      endTask(true);
      C.job = role || null;
      rt.setZX({ r: role || null, a: null, w: null });
      drawWallet();
      if (!role) { toast('Ты свободен — без работы'); return; }
      const R0 = ROLES[role];
      if (R0.car && !root.D37E?.vehicles) { toast(`${R0.icon} ${R0.name}: такси поедет, когда в мире появятся машины — скоро!`); return; }
      toast(`${R0.icon} Ты — ${R0.name}! ${R0.desc}`, true);
      setTimeout(() => { if (C.job === role && !C.task) nextTask(); }, 900);
    }
    function nextTask(){
      if (!C.job) return;
      const L = tasksFor(C.job); if (!L || !L.length) return;
      C.task = L; C.step = 0;
      showStep();
    }
    function showStep(){
      const st = C.task?.[C.step];
      if (!st) return;
      if (st.carry && C.step > 0) rt.setZX({ a: 'carry', w: st.carry }); else if (!st.carry) rt.setZX({ a: rt.zx.a === 'carry' ? null : rt.zx.a, w: rt.zx.a === 'carry' ? null : rt.zx.w });
      if (st.fire) startFire(st.at);
      if (st.patient) patient(st.at, true);
      if (st.sick) sickPet(st.at, true);
      if (st.cust || st.cust2 || st.robber) customer(st.cust2 || st.at, st.robber ? '🦹' : '🙋');
      if (st.trial) customer(SP('m_defend'), '🦹');
      if (st.walk) setTarget(st.at, st.icon, null, 0, () => {});
      else setTarget(st.at, st.icon, `${st.icon} ${st.text}`, st.hold, () => stepDone());
      drawTask();
    }
    function stepDone(){
      const st = C.task?.[C.step]; if (!st) return;
      rt.sfx('click');
      if (st.fx === 'oven') burst(st.at, 'sparkles', '#ffb347');
      if (st.fire) stopFire(true);
      if (st.sick) { sickPet(null); }
      if (st.site) siteGrow();
      if (st.rob) return robDone(st);
      if (st.trial) return trialPanel();
      if (st.nobiz) { endTask(); return; }
      C.step++;
      if (C.step >= C.task.length) return taskDone(st);
      showStep();
    }
    async function taskDone(last){
      const role = C.job, R0 = ROLES[role] || {};
      endTask();
      if (last?.done) toast(last.done, true);
      burst(S.P.ch, 'confetti');
      if (R0.pay) earn(R0.pay, R0.name);
      await rt.payTask(R0.name);
      setTimeout(() => { if (C.job === role && !C.task) nextTask(); }, 2600);
    }
    function endTask(quiet){
      if (C.fireOn) stopFire(false);
      patient(null); sickPet(null); customer(null);
      C.task = null; C.step = 0;
      setTarget(null);
      if (rt.zx.a === 'carry' || rt.zx.a === 'hose' || rt.zx.a === 'heal' || rt.zx.a === 'fix' || rt.zx.a === 'cook') rt.setZX({ a: null, w: null });
      drawTask();
    }
    function drawTask(){
      const el = rt.q('.mz-task');
      if (!C.task || !inCity()) { if (el.dataset.city === city) { el.hidden = true; el.dataset.city = ''; } return; }
      const st = C.task[C.step], R0 = ROLES[C.job];
      el.dataset.city = city; el.hidden = false;
      el.innerHTML = `<span>${R0.icon} <b>${esc(R0.name)}:</b> ${esc(st.text)}</span><span class="mz-dist"></span><button type="button" data-mz="c:${city}:quit">Уйти с работы</button>`;
    }
    // ── пожар (пожарный): огонь + дым + треск; тушишь — водяные пузыри ──
    const FX = S.FX;
    function startFire(p){
      stopFire(false);
      if (!FX || !p) return;
      C.fires = [FX.emitter({ kind: 'fire', at: [p.x, .2, p.z], size: 1.1 }), FX.emitter({ kind: 'smoke', at: [p.x, 1.4, p.z], rate: .8, size: 1 })];
      C.fireOn = true;
      C.fireLoop = S.AU?.loop?.('amb_fire', { x: p.x, y: .5, z: p.z, vol: .7 });
      C.fireMesh = new T.Mesh(R.K.geo('mzBin', () => new T.CylinderGeometry(.45, .38, 1, 10)), R.mat('#4b5563')); C.fireMesh.position.set(p.x, .5, p.z); R.scene.add(C.fireMesh);
    }
    function stopFire(win){
      for (const e of C.fires) { try { e.dispose(); } catch (er) {} }
      C.fires = []; C.fireOn = false;
      try { C.fireLoop?.stop?.(); } catch (e) {}
      C.fireLoop = null;
      if (C.fireMesh) { R.scene.remove(C.fireMesh); C.fireMesh = null; }
      if (win && C.task) { const p = C.task[C.step].at; burst(p, 'bubbles', '#bae6fd'); }
    }
    function burst(p, kind, color){
      if (!FX || !p) return;
      const e = FX.emitter({ kind, at: [p.x, (p.y || 0) + .8, p.z], rate: 0, color, color2: color });
      e.burst?.(kind === 'confetti' ? 40 : 26);
      setTimeout(() => { try { e.dispose(); } catch (er) {} }, 3500);
    }
    // ── значки-«люди» для заданий (пациент на кровати, покупатель, питомец, грабитель) — спрайты, без лишних человечков ──
    const marks = {};
    function sprite(slot, p, e, h = 1.4, s = 1){
      let sp = marks[slot];
      if (!p) { if (sp) sp.visible = false; return; }
      if (!sp) { sp = marks[slot] = new T.Sprite(rt.spriteMat(e)); R.scene.add(sp); }
      sp.material = rt.spriteMat(e); sp.position.set(p.x, (p.y != null ? p.y : 0) + h, p.z); sp.scale.setScalar(s); sp.visible = true;
    }
    const patient = (p, on) => sprite('pat', on ? p : null, '🤒', .25, 1.1);
    const sickPet = (p, on) => sprite('pet', on ? p : null, '🤕', .1, .9);
    const customer = (p, e) => sprite('cust', p, e || '🙋', .4, 1.2);
    // ── стройка растёт (у каждого своя стадия — подсказка, сколько построил) ──
    const site = K.spots.k_site ? new T.Group() : null;
    if (site) { site.position.set(205, 0, 24); R.scene.add(site); }
    function siteGrow(){
      if (!site) return;
      C.siteN = ((C.siteN || 0) + 1) % 5;
      site.clear();
      const n = C.siteN;
      if (n >= 1) R.part(site, { s: 'box', y: .25, w: 8, h: .5, d: 6, c: '#9ca3af' });
      if (n >= 2) for (const [x, z, w, d] of [[0, -3, 8, .4], [0, 3, 8, .4], [-4, 0, .4, 6], [4, 0, .4, 6]]) R.part(site, { s: 'box', x, z, y: .5 + (n >= 3 ? 1.2 : .6), w, h: n >= 3 ? 2.4 : 1.2, d, c: '#c2410c' });
      if (n >= 4) R.part(site, { s: 'box', y: 3.2, w: 8.6, h: .3, d: 6.6, c: '#7c2d12' });
      R.shadowsOn?.(site);
      toast(n === 0 ? '🏠 Дом достроен! Начинаем новый' : `🏗️ Стройка: этап ${n} из 4`, true);
    }
    // ── пожарный: распылитель, пока держишь E у огня ──
    let sprayE = null;
    function sprayTick(){
      const st = C.task?.[C.step], holding = !!(st?.fire && X.cur === jobItem && X.progress > 0);
      if (holding && !sprayE && FX) { const p = st.at; sprayE = FX.emitter({ kind: 'fountain', at: [p.x, .3, p.z], rate: 1.4, size: 1.2, color: '#e0f2fe', color2: '#7dd3fc' }); rt.setZX({ a: 'hose' }); }
      else if (!holding && sprayE) { sprayE.dispose(); sprayE = null; if (rt.zx.a === 'hose') rt.setZX({ a: null }); }
      // во время удержания у плиты/кровати — поза работы
      const act = st && X.cur === jobItem && X.progress > 0 ? st.act : null;
      if (act && act !== 'hose' && rt.zx.a !== act) rt.setZX({ a: act });
      else if (!act && st && rt.zx.a && ['cook', 'heal', 'fix'].includes(rt.zx.a)) rt.setZX({ a: st.carry && C.step > 0 ? 'carry' : null, w: st.carry && C.step > 0 ? st.carry : null });
    }
    // ═══ Окна: работа, семья, питомцы, магазины, банк, бизнес, дома ═══
    function jobBoard(){
      const s = W(), cur = rt.zx.r;
      const rows = Object.entries(ROLES).map(([id, r]) => `<div class="mz-job${cur === id ? ' on' : ''}"><i>${r.icon}</i><div><b>${esc(r.name)}</b><small>${esc(r.desc)}${r.pay ? ` · ${W0.icon}${r.pay} за задание + немного 🪙` : ''}</small></div>${cur === id ? `<button type="button" data-mz="c:${city}:job:">Уволиться</button>` : `<button type="button" class="ct-start" data-mz="c:${city}:job:${id}">${r.car && !root.D37E?.vehicles ? 'Скоро' : 'Работать'}</button>`}</div>`).join('');
      H.panel(`<span class="wld-pe">🧰</span><b>Работа · ${esc(Z.name)}</b>`, `<div class="mz-cash"><span>${W0.icon} ${s.cash.toLocaleString('ru')}</span><span>🪙 за работу сегодня: ${MZ.payState().got}/${MZ.PAY.day}</span></div><div class="mz-jobs">${rows}</div>`);
    }
    function familyBoard(){
      const cur = rt.zx.f;
      H.panel('<span class="wld-pe">👪</span><b>Семья — кто ты сегодня?</b>', `<p>Роль видна всем над твоим ником. Играйте семьёй: дома, в парке, в школе!</p><div class="wld-acts">${Object.entries(MZ.FAMILY).map(([id, f]) => `<button type="button"${cur === id ? ' class="ct-start"' : ''} data-mz="c:kids:fam:${id}">${f[0]} ${esc(f[1])}</button>`).join('')}<button type="button" data-mz="c:kids:fam:">Без роли</button></div>`);
    }
    function petShop(){
      const s = W();
      H.panel('<span class="wld-pe">🐾</span><b>Зоомагазин</b>', `<p>Питомец ходит за тобой, пока ты в мире, — его видят все. Корм — ⭐1.</p><div class="mz-cash"><span>⭐ ${s.cash}</span></div><div class="wld-acts">${Object.entries(PETS).map(([id, p]) => `<button type="button"${rt.zx.pt === id ? ' class="ct-start"' : ''} data-mz="c:kids:pet:${id}">${p[0]} ${esc(p[1])}</button>`).join('')}${rt.zx.pt ? '<button type="button" data-mz="c:kids:pet:">Отпустить домой</button>' : ''}</div>`);
    }
    const SHOPS = { kids: { icecream: ['🍦 Мороженое', 1], bun: ['🥐 Булочка', 1], apple: ['🍎 Яблоко', 1] },
      market: { apple: ['🍎 Яблоко', 5], juice: ['🧃 Сок', 6], burger: ['🍔 Бургер', 12] }, rest: { pizza: ['🍕 Пицца', 15], soup: ['🍲 Суп', 12], coffee: ['☕ Кофе', 8] } };
    function shop(kind){
      const L = SHOPS[kind], s = W();
      H.panel(`<span class="wld-pe">${kind === 'rest' ? '🍝' : '🛒'}</span><b>${kind === 'rest' ? 'Ресторан «Вкусно»' : 'Супермаркет'}</b>`, `<div class="mz-cash"><span>💵 ${s.cash}</span></div><div class="wld-acts">${Object.entries(L).map(([id, [n, p]]) => `<button type="button" data-mz="c:metro:buy:${id}:${p}">${n} — 💵${p}</button>`).join('')}</div><p><small>Купленное — в 🎬 «Действия»: съесть или выпить.</small></p>`);
    }
    function buy(item, price){
      if (!spend(price)) return;
      const s = W(); s.inv[item] = Math.min(99, (s.inv[item] || 0) + 1); walletSave(city, s);
      toast(`${rt.FOOD[item] || '🛍️'} Куплено! Съесть — 🎬 «Действия»`, true);
      rt.sfx('coin');
    }
    function eatItem(item){
      const s = W(); if (!(s.inv[item] > 0)) return false;
      s.inv[item]--; walletSave(city, s);
      rt.eat(item);
      return true;
    }
    function bankPanel(){
      const s = W();
      H.panel('<span class="wld-pe">🏦</span><b>Банкомат</b>', `<p>Кэш в кармане грабитель может забрать только у кассы, а в банке он в безопасности.</p><div class="mz-cash"><span>💵 в кармане: ${s.cash}</span><span>🏦 в банке: ${s.bank}</span></div><div class="wld-acts"><button type="button" data-mz="c:metro:dep:100">Положить 100</button><button type="button" data-mz="c:metro:dep:all">Положить всё</button><button type="button" data-mz="c:metro:wd:100">Снять 100</button><button type="button" data-mz="c:metro:wd:all">Снять всё</button></div>`);
    }
    const BIZ = { coffee: 300, flowers: 400, wash: 500 };
    const bizPrompt = (id, name) => (W().biz.includes(id) ? `${name}: твой бизнес — собрать выручку` : `${name}: купить бизнес (💵${BIZ[id]})`);
    function bizAct(id, name){
      const s = W();
      if (s.biz.includes(id)) { const n = Math.floor(C.bizCash || 0); C.bizCash = 0; earn(n, 'выручка'); if (!n) toast('Выручки пока нет — она копится, пока ты в городе'); return; }
      if (s.biz.length >= 3) { toast('Хватит бизнесов 🙂'); return; }
      if (!spend(BIZ[id])) return;
      const s2 = W(); s2.biz.push(id); walletSave(city, s2);
      toast(`💼 ${name} — теперь твой бизнес! Выручка копится, пока ты в городе`, true);
    }
    function dealer(){
      H.panel('<span class="wld-pe">🚗</span><b>Автосалон</b>', `<p>${root.D37E?.vehicles ? 'Выбери машину — она появится у салона.' : 'Машины скоро можно будет водить по дорогам мира! Пока — посмотри модели в зале. 🚗'}</p>`);
    }
    // ── урок в школе (детский) ──
    function quiz(){
      const [qn, opts, ok] = pick(QUIZ), order = opts.map((o, i) => i).sort(() => Math.random() - .5);
      C.quizOk = ok;
      H.panel('<span class="wld-pe">📚</span><b>Урок</b>', `<p><b>${esc(qn)}</b></p><div class="wld-acts">${order.map(i => `<button type="button" data-mz="c:kids:ans:${i}">${esc(opts[i])}</button>`).join('')}</div>`);
    }
    function answer(i){
      H.closePops();
      if (+i === C.quizOk) { earn(1, 'правильный ответ'); rt.sfx('coin'); H.emote?.('🎉'); if ((C.quizN = (C.quizN || 0) + 1) % 3 === 0) rt.payTask('урок'); }
      else toast('Почти! Попробуй ещё раз 🙂');
    }
    // ── дома: «сделать своим» на время визита (zx.hs), чужой — «занят» ──
    const owner = id => { if (rt.zx.hs === id) return S.me; for (const p of S.players.values()) if (p.zx?.hs === id && !p.leaving) return p; return null; };
    function housePrompt(id){ const o = owner(id); return o === S.me ? '🏠 Твой дом — отказаться' : o ? `🏠 Дом игрока ${o.nick}` : '🏠 Сделать этот дом своим'; }
    function houseAct(id){
      const o = owner(id);
      if (o === S.me) { rt.setZX({ hs: null }); toast('Дом снова свободен'); return; }
      if (o) { toast(`Здесь живёт ${o.nick} — попроси пустить в гости 🙂`); return; }
      rt.setZX({ hs: id }); toast('🏠 Это твой дом, пока ты в мире! Кровать — поспать, кухня — приготовить обед', true);
    }
    function cookHome(){ rt.setZX({ a: 'cook' }); setTimeout(() => { if (rt.zx.a === 'cook') { rt.setZX({ a: null }); rt.eat(pick(['soup', 'pizza', 'apple'])); } }, 2200); }
    // ── грабитель: касса/банк → розыск ⭐, полиция ловит (игроки и патрульные) ──
    function robDone(st){
      const big = st.at === SP('m_vault'), loot = big ? 300 : 80;
      endTask();
      C.loot = (C.loot || 0) + loot;
      C.wantedT = big ? 120 : 60;
      rt.setZX({ wn: big ? 2 : 1 });
      toast(`💰 +💵${loot} в мешке! Тебя ищет полиция ⭐ — продержись ${C.wantedT} с`, true);
      S.H?.toast?.('🚨 Сигнализация!');
      rt.sfx('buzz', { vol: .6 });
    }
    function wantedTick(dt){
      if (!rt.zx.wn) return;
      C.wantedT -= dt;
      // патрульные полиции рядом 2 с — задержали
      let near = false;
      for (const o of K.npcs) if (/👮/.test(o.name || '')) { const e = S.NPC?.list.get(o.id), a = e && S.NPC.A.get(e.key); if (a && Math.hypot(a.x - S.P.ch.x, a.z - S.P.ch.z) < 5) near = true; }
      C.copNear = near ? (C.copNear || 0) + dt : 0;
      if (C.copNear > 2) { arrested(null); return; }
      if (C.wantedT <= 0) { rt.setZX({ wn: null }); earn(C.loot || 0, 'ушёл от погони'); C.loot = 0; toast('😮‍💨 Розыск снят — оторвался!'); rt.payTask('удачное дело'); }
    }
    function arrested(byKey){
      const cell = pick(K.cells || [{ x: 112, z: 158 }]);
      C.loot = 0; C.wantedT = 0;
      rt.setZX({ wn: null, pr: 1 });
      C.prisonT = 45;
      rt.place(cell.x, cell.z, PI);
      toast('🚔 Тебя задержали! 45 с в камере (или залог 💵100 — 🎬)', false);
      if (byKey) rt.send({ k: 'arrested', by: byKey });
    }
    function prisonTick(dt){
      if (!rt.zx.pr) return;
      C.prisonT -= dt;
      const c = K.jailOut;
      if (C.prisonT <= 0) { rt.setZX({ pr: null }); rt.place(c.x, c.z, PI); toast('🔓 Ты на свободе. Веди себя хорошо!', true); }
    }
    // полицейский задерживает игрока в розыске (держи E рядом) — решает сам задержанный (проверяет, что полицейский рядом)
    const arrestItems = new Map();
    // ещё: врач лечит игроков рядом (держи E) — тому приходит «тебя полечили» (раз в 20 с на человека)
    const healedAt = new Map();
    function arrestTick(){
      const iAmCop = city === 'metro' && rt.zx.r === 'police', iAmDoc = rt.zx.r === 'doctor' || rt.zx.r === 'medic';
      for (const p of S.players.values()) {
        const inZ = !p.leaving && MZ.inRect(Z, p.ch.x, p.ch.z, 4);
        const kind = iAmCop && p.zx?.wn && inZ ? 'arrest' : iAmDoc && inZ && !p.zx?.wn ? 'heal' : '';
        let it = arrestItems.get(p.key);
        if (it && it.kind !== kind) { X.remove(it); arrestItems.delete(p.key); it = null; }
        if (kind && !it) {
          it = kind === 'arrest'
            ? X.add({ x: p.ch.x, y: p.ch.y + 1.2, z: p.ch.z, r: 1, hold: 1.5, prompt: () => `👮 Задержать: ${p.nick}`, act: () => { rt.send({ k: 'arrest', to: p.key }); toast(`👮 Задерживаем ${p.nick}…`); } })
            : X.add({ x: p.ch.x, y: p.ch.y + 1.2, z: p.ch.z, r: 1, hold: 1.5, prompt: () => (Date.now() - (healedAt.get(p.key) || 0) < 20e3 ? null : `✨ Полечить: ${p.nick}`), act: () => { healedAt.set(p.key, Date.now()); rt.send({ k: 'heal', to: p.key }); burst(p.ch, 'magic'); earn(1, 'забота о пациенте'); } });
          it.kind = kind; arrestItems.set(p.key, it);
        }
        if (it) { it.x = p.ch.x; it.y = p.ch.y + 1.2; it.z = p.ch.z; }
      }
      for (const [k, it] of arrestItems) if (!S.players.has(k)) { X.remove(it); arrestItems.delete(k); }
    }
    // ── суд: подсудимый → приговор ──
    function trialPanel(){
      endTask();
      H.panel('<span class="wld-pe">⚖️</span><b>Дело №' + (100 + Math.floor(Math.random() * 900)) + '</b>', `<p>Подсудимый: ${pick(['перешёл дорогу на красный', 'шумел ночью', 'не вернул книгу в библиотеку', 'ограбил киоск с мороженым', 'парковался на газоне'])}. Ваше решение?</p><div class="wld-acts"><button type="button" data-mz="c:metro:verdict:free">Оправдать</button><button type="button" data-mz="c:metro:verdict:fine">Штраф</button><button type="button" data-mz="c:metro:verdict:jail">30 суток метлой подметать улицы</button></div>`);
    }
    // ── питомец рядом с хозяином (свой и чужие — по zx.pt) ──
    const petS = new Map();
    function petsFrame(dt, t){
      const all = [[S.key, rt.zx.pt, S.A.get(S.key)], ...[...S.players.values()].map(p => [p.key, p.zx?.pt, S.A.get(p.key)])];
      const seen = new Set();
      for (const [key, pt, a] of all) {
        if (!pt || !PETS[pt] || !a || !a.ch?.root.visible) continue;
        seen.add(key);
        let s = petS.get(key);
        if (!s) { s = { sp: new T.Sprite(rt.spriteMat(PETS[pt][0])), x: a.x, z: a.z }; s.sp.scale.setScalar(.8); R.scene.add(s.sp); petS.set(key, s); }
        s.sp.material = rt.spriteMat(PETS[pt][0]);
        const yaw = a.ch.yaw, tx = a.x - Math.sin(yaw) * 1.1 - Math.cos(yaw) * .8, tz = a.z - Math.cos(yaw) * 1.1 + Math.sin(yaw) * .8;
        s.x += (tx - s.x) * Math.min(1, dt * 4); s.z += (tz - s.z) * Math.min(1, dt * 4);
        const hop = Math.abs(Math.sin(t * 8 + key.length)) * (Math.hypot(tx - s.x, tz - s.z) > .3 ? .25 : .04);
        s.sp.position.set(s.x, a.y + .45 + hop, s.z);
      }
      for (const [k, s] of petS) if (!seen.has(k)) { R.scene.remove(s.sp); petS.delete(k); }
    }
    // ── щелчки по кнопкам окон ──
    function click(a){
      if (!a.startsWith('c:' + city + ':')) return false;
      const [, , cmd, v, v2] = a.split(':');
      if (cmd === 'quit') { setJob(null); H.closePops(); return true; }
      if (cmd === 'job') { H.closePops(); setJob(v || null); return true; }
      if (cmd === 'fam') { H.closePops(); rt.setZX({ f: v || null }); toast(v ? `${MZ.FAMILY[v][0]} Ты — ${MZ.FAMILY[v][1]}!` : 'Без роли в семье', true); return true; }
      if (cmd === 'pet') {
        H.closePops();
        if (!v) { rt.setZX({ pt: null }); toast('🐾 Питомец ушёл домой'); return true; }
        if (!rt.zx.pt && W().cash < 2) { toast('Питомец стоит ⭐2 — поработай немного!', false); return true; }
        if (!rt.zx.pt && !spend(2)) return true;
        rt.setZX({ pt: v }); toast(`${PETS[v][0]} ${PETS[v][1]} теперь с тобой!`, true); rt.sfx('pickup'); return true;
      }
      if (cmd === 'ans') { answer(v); return true; }
      if (cmd === 'buy') { buy(v, +v2); return true; }
      if (cmd === 'dep' || cmd === 'wd') {
        const s = W(), n = v === 'all' ? (cmd === 'dep' ? s.cash : s.bank) : 100;
        if (cmd === 'dep') { const m = Math.min(n, s.cash); s.cash -= m; s.bank += m; } else { const m = Math.min(n, s.bank); s.bank -= m; s.cash += m; }
        walletSave(city, s); drawWallet(); bankPanel(); rt.sfx('coin'); return true;
      }
      if (cmd === 'verdict') { H.closePops(); toast({ free: '⚖️ Оправдан! Зал аплодирует 👏', fine: '⚖️ Штраф выписан', jail: '⚖️ Приговор: подметать улицы 🧹' }[v], true); taskDone({ done: '' }); return true; }
      return false;
    }
    // ── действия 🎬 своего города ──
    function act(id){
      if (id.startsWith('eat:')) return eatItem(id.slice(4)) || (toast('Сначала купи 🙂'), true);
      if (id === 'k_pet') { H.emote?.('❤️'); burst(S.P.ch, 'sparkles', '#fda4af'); return true; }
      if (id === 'k_feed') { if (spend(1)) { toast(`${(PETS[rt.zx.pt] || ['🐾'])[0]} Ням-ням! Питомец доволен`, true); burst(S.P.ch, 'confetti'); } return true; }
      if (id === 'm_hide') { toast('🫣 Ты натянул шапку на глаза… полиция всё равно ищет'); return true; }
      if (id === 'm_bail') { if (rt.zx.pr && spend(100)) { C.prisonT = 0; } return true; }
      return false;
    }
    // ── сеть: арест / задержан ──
    function onMsg(p, d){
      if (d.t !== 'z') return false;
      if (d.k === 'arrest' && d.to === S.key && city === 'metro') {
        // меня задерживают: я в розыске, он — полицейский и рядом
        const ok = rt.zx.wn && p.zx?.r === 'police' && Math.hypot(p.ch.x - S.P.ch.x, p.ch.z - S.P.ch.z) < 5 && MZ.inRect(Z, S.P.ch.x, S.P.ch.z, 4);
        if (ok) arrested(p.key);
        return true;
      }
      if (d.k === 'arrested' && d.by === S.key && city === 'metro' && rt.zx.r === 'police') { earn(60, `задержан ${p.nick}`); rt.payTask('задержание'); return true; }
      if (d.k === 'heal' && d.to === S.key) { if (p.zx?.r === 'doctor' || p.zx?.r === 'medic') { toast(`✨ ${p.nick} тебя полечил — ты как новенький!`, true); burst(S.P.ch, 'magic'); } return true; }
      return false;
    }
    // ── шаг и кадр ──
    let tagT = 0;
    const mod = {
      update(dt){
        const here = inCity();
        if (here !== C.here) { C.here = here; wEl.hidden = !here; if (here) drawWallet(); drawTask(); }
        if (C.task) {
          sprayTick();
          // метка — расстояние
          const st = C.task[C.step], el = rt.q('.mz-task .mz-dist');
          if (st?.at && el) { const d = Math.hypot(st.at.x - S.P.ch.x, st.at.z - S.P.ch.z); el.textContent = d > 3 ? Math.round(d / 1.17) + ' м' : '✋ здесь'; if (st.walk && d < 2.5) stepDone(); }
        }
        if (city === 'kids' && here && K.spots.k_tramp) { const t0 = K.spots.k_tramp, ch = S.P.ch; if (Math.hypot(ch.x - t0.x, ch.z - t0.z) < 1.9 && ch.grounded && ch.y > .5 && S.P.mode === 'move') { S.P.push(0, 15, 0); rt.sfx('jump', { vol: .5, rate: 1.4 }); } }
        if (city === 'metro') { wantedTick(dt); prisonTick(dt); }
        arrestTick();
        if (city === 'metro' && here && W().biz.length) { C.bizCash = Math.min(500, (C.bizCash || 0) + dt * W().biz.length * 10 / 60); }
        tagT -= dt;
      },
      frame(dt, t){
        mk.rotation.y += dt * 1.5; iconS.position.y = 2.6 + Math.sin(t * 3) * .15;
        petsFrame(dt, t);
      },
      area(a, prev){
        if (a?.id === city) {
          if (city === 'kids') rt.toast?.('🧸 Чат здесь строгий: телефоны, адреса и ссылки скрываются у всех');
        }
        if (prev?.id === city && a?.id !== city) { if (C.job) toast(`Ты вышел из города — работа «${ROLES[C.job].name}» ждёт тебя здесь`); }
      },
      marks(){
        const L = [];
        if (C.task) { const st = C.task[C.step]; if (st?.at) L.push({ icon: st.icon || '⬇️', x: st.at.x, z: st.at.z }); }
        if (city === 'metro' && rt.zx.r === 'police') for (const p of S.players.values()) if (p.zx?.wn) L.push({ icon: '🚨', x: p.ch.x, z: p.ch.z });
        return L;
      },
      click, act, onMsg,
      esc(){ return false; },
      shown(on){ if (!on && C.fireOn) stopFire(false); },
      stop(){ endTask(true); mk.parent?.remove(mk); for (const s of petS.values()) R.scene.remove(s.sp); for (const sp of Object.values(marks)) R.scene.remove(sp); if (site) R.scene.remove(site); for (const it of arrestItems.values()) X.remove(it); wEl.remove(); },
      // для проверки
      _: { C, setJob, nextTask, stepDone, tasksFor, wallet: W, arrested },
    };
    rt.city[city] = { jobBoard, familyBoard, petShop, buy, shop, bankPanel, bizPrompt, bizAct, dealer, quiz, housePrompt, houseAct, cookHome, mod };
    // свой залог в 🎬 — когда сидишь
    const acts0 = MZ.DEFS[city].actions;
    MZ.DEFS[city].actions = r => { const L = acts0(r); if (city === 'metro' && r.zx.pr) L.unshift({ id: 'm_bail', icon: '💵', name: 'Залог 💵100' }); return L; };
    return mod;
  }

  root.MirCity = { taskList, SPOTS, spotsOf, ROLES_K, ROLES_M, PETS, QUIZ, WALLET, wallet, K_FIRES, K_CUST, K_PETS, K_FOOT, M_FOOT };
})();
