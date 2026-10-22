// ═══════════════════════════════════════
//  «МИР ДЕНЧИКА»: ГОРОДА — «Солнечный городок» (0+, детский) и «Большой город» (MirZones.ADULT_AGE+, для взрослых)
// ═══════════════════════════════════════
// Владелец 15.10.2026: «действия разные с городами, тип город для детей и город для взрослых». У каждого города — свои роли,
// работы и действия (🎬). Детский: школа (урок-викторина), детская площадка (горка, качели, батут), питомцы, мороженое, пекарня
// (готовка), семейные роли, добрые работы — пекарь, пожарный, врач, ветеринар, строитель; без оружия и «преступлений», чат
// строгий у всех, кто внутри. Взрослый: работы с зарплатой — полицейский, кассир банка, продавец, повар, врач, судья, бизнесмен,
// таксист (с машинами), грабитель (полиция ловит: розыск ⭐, тюрьма, залог); банк, бизнес, автосалон, суд. Без 18+, без
// алкоголя/наркотиков и без азартных игр (AdSense).
// Деньги — ДЕНКИ 💵 «Живого города» (22.10.2026, T-032; js/games/mir-econ.js + city.sql): один кошелёк на оба города, на сервере;
// гость или пока city.sql не выполнен — «🧪 пробные» в этом браузере (MirEcon.api.mode). Работа: щит «🧰 Работа» → роль (форма над
// человечком у всех — поле zx.r) = профессия сервера (prof) в здании (place) → city_act('job') выдаёт номер задания → шаги задания
// (метка над целью, «[E] …» держать, в руках — что несёшь, zx.a = 'carry'; цели — от номера: после перезагрузки то же задание) →
// TaskRunner сдаёт работу (city_act('task')), не раньше минимального времени — зарплата, навык ★, усталость и лимиты решает сервер.
// Роли без денег (РП): грабитель, судья, семья, питомцы; «бизнесмен» — скоро (P7). Монеты 🪙 за работу — как раньше:
// MirZones.payTask → D37Coins.run('rp') (сервер режет: coin_run_cap('rp') = 10, 600 в день). Еда в магазинах — за денки, бонус к зарплате.
// Общая стройка: этап — от сервера (city_public: site), у всех одинаковый; сменился — строитель шлёт 'z' {k:'cty'} (не чаще раза в минуту).
// Сеть: только zx в 'st' и редкие 'z' (арест, лечение игрока, город) — всё проверяет тот, кого касается (хоста в мире нет).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const MZ = root.MirZones; if (!MZ) return;
  const PI = Math.PI, esc = MZ.esc;
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const now = () => (root.performance ? root.performance.now() : Date.now());

  // ═══ Роли (форма у всех — zx.r): prof + place — профессия сервера (MirEcon.PROFS) и здание; rp — роль без денег; soon — скоро ═══
  const ROLES_K = {
    baker: { icon: '🥐', name: 'Пекарь', hat: 'chef', vest: '#f8fafc', prof: 'cook', place: 'k_bake', desc: 'Возьми муку, замеси тесто, испеки булочки и отнеси жителю.' },
    icecream: { icon: '🍦', name: 'Продавец мороженого', hat: 'chefPink', vest: '#f9a8d4', prof: 'seller', place: 'k_ice', desc: 'Набери мороженое и отдай покупателю у окошка.' },
    doctor: { icon: '🩺', name: 'Врач', hat: 'doc', vest: '#f8fafc', prof: 'doctor', place: 'k_hosp', desc: 'Осмотри пациентов и дай лекарство — и они здоровы. Можно лечить и игроков.' },
    vet: { icon: '🐾', name: 'Ветеринар', hat: 'vet', vest: '#16a34a', prof: 'doctor', place: 'k_hosp', desc: 'Найди приболевшего питомца и вылечи его в клинике.' },
    fireman: { icon: '🚒', name: 'Пожарный', hat: 'fire', vest: '#dc2626', stripe: 1, prof: 'fire', place: 'k_fire', desc: 'В городке загорается мусорный бак или костёр — потуши его!' },
    builder: { icon: '👷', name: 'Строитель', hat: 'hard', vest: '#f97316', stripe: 1, prof: 'builder', place: 'k_site', desc: 'Носи кирпичи на стройку — общий дом растёт у всех на глазах.' },
    teacher: { icon: '📚', name: 'Учитель', hat: 'none', vest: '#7c3aed', prof: 'teacher', place: 'k_school', desc: 'Напиши тему на доске, проверь тетради учеников и объясни урок.' },
    mech: { icon: '🔧', name: 'Механик', hat: 'cap', vest: '#2563eb', prof: 'mech', place: 'k_play', desc: 'Возьми инструменты и почини качели, горку, карусель.' },
  };
  const ROLES_M = {
    police: { icon: '👮', name: 'Полицейский', hat: 'police', vest: '#1e3a8a', prof: 'police', place: 'm_police', desc: 'Патрулируй улицы, лови грабителей и отвози их в участок.' },
    robber: { icon: '🦹', name: 'Грабитель', hat: 'robber', vest: '#111827', stripe: 2, rp: 1, desc: 'Роль понарошку: ограбь кассу — и не попадись полиции! Денег не даёт.' },
    cashier: { icon: '🏦', name: 'Кассир банка', hat: 'visor', vest: '#166534', prof: 'seller', place: 'm_bank', desc: 'Прими заявку, принеси деньги из хранилища и выдай клиенту.' },
    seller: { icon: '🛒', name: 'Продавец', hat: 'cap', vest: '#dc2626', prof: 'seller', place: 'm_shop', desc: 'Возьми товар с полки и пробей на кассе супермаркета.' },
    cook: { icon: '👨‍🍳', name: 'Повар', hat: 'chef', vest: '#f8fafc', prof: 'cook', place: 'm_rest', desc: 'Готовь заказы в ресторане и подавай гостям.' },
    medic: { icon: '🚑', name: 'Врач', hat: 'doc', vest: '#f8fafc', prof: 'doctor', place: 'm_hosp', desc: 'Лечи пациентов в больнице. Больница — место, где все поправляются.' },
    fire_m: { icon: '🚒', name: 'Пожарный', hat: 'fire', vest: '#dc2626', stripe: 1, prof: 'fire', place: 'm_fire', desc: 'Пожар в Большом городе — бери шланг и туши!' },
    builder_m: { icon: '👷', name: 'Строитель', hat: 'hard', vest: '#f97316', stripe: 1, prof: 'builder', place: 'm_lot1', desc: 'Стройка у пожарной части: носи кирпичи — дом растёт у всех.' },
    scientist: { icon: '🔬', name: 'Учёный', hat: 'none', vest: '#e2e8f0', prof: 'teacher', place: 'm_city3', desc: 'Возьми пробы в сквере «Сити» и изучи их в лаборатории на площади.' },
    mech_m: { icon: '🔧', name: 'Механик', hat: 'cap', vest: '#1d4ed8', prof: 'mech', place: 'm_gas', desc: 'Чини машины на заправке.' },
    taxi: { icon: '🚕', name: 'Таксист', hat: 'taxi', vest: '#facc15', prof: 'driver', place: 'm_taxi', desc: 'Вози пассажиров по городу на такси.', car: true },
    judge: { icon: '⚖️', name: 'Судья', hat: 'judge', vest: '#111827', rp: 1, desc: 'Роль понарошку: рассматривай дела в суде и выноси приговоры.' },
    biz: { icon: '💼', name: 'Бизнесмен', hat: 'none', vest: '#334155', soon: 1, desc: 'Свой бизнес — скоро: аренда помещения, товар, выручка.' },
  };
  // что несёт в руках (zx.w) — значок над человечком
  const CARRY = { bun: '🥐', brick: '🧱', pet: '🐶', med: '💊', box: '📦', money: '💰', food: '🍲', icecream: '🍦', coffee: '☕', flour: '🌾', tools: '🧰', book: '📓', sample: '🧪' };

  // ═══ Точки заданий (одно место: постройка ставит рядом предметы, задания ведут сюда) — [x, y, z] ═══
  const SPOTS = {
    k_teacher: [132, 1.2, -61.2], k_tramp: [168, .6, -48], k_bed0: [194, .8, -61.5], k_bed1: [198, .8, -61.5], k_bed2: [202, .8, -61.5], k_med: [192.6, 1.2, -54],
    k_vettable: [212, 1.3, -58], k_hose: [242.8, 1.2, -50], k_oven: [121.2, 1.2, 2.2], k_dough: [134, 1.1, 1.7], k_icewin: [148, 1.2, -10.2], k_icecounter: [148, 1.2, -7.8],
    k_bricks: [197.4, 1, 19.6], k_site: [205, 1, 24],
    k_flour: [135.2, 1, -1.5], k_freezer: [146, 1.1, -4.4], k_board: [128.5, 1.4, -63.4], k_desk0: [124, 1, -57.1], k_desk1: [129, 1, -57.1], k_desk2: [135, 1, -57.1], k_desk3: [140, 1, -57.1],
    k_tools: [147.6, 1, -34], k_atm: [279, 1.2, -46.6],
    m_fount: [182, 1, 146], m_desk: [110, 1.2, 146.6], m_judge: [116, 1.4, 177.4], m_defend: [109, 1.2, 183.2], m_dock: [113.8, 1.2, 241.6], m_teller: [246, 1.2, 149.6],
    m_client: [246, 1.2, 148.6], m_vault: [246, 1.2, 158.4], m_bed0: [238, .8, 179.4], m_bed1: [242, .8, 179.4], m_bed2: [250, .8, 179.4], m_bed3: [254, .8, 179.4],
    m_meds: [236.6, 1.2, 187], m_dealer: [182, 1.2, 116], m_till: [99, 1.2, 228], m_buyer: [99, 1.2, 227], m_stove: [130, 1.2, 240.4], m_fridge: [137.2, 1.2, 241],
    m_biz_coffee: [166, 1.2, 230.6], m_biz_flowers: [182, 1.2, 230.6], m_biz_wash: [198, 1.2, 230.6],
    m_shelf0: [100, 1, 236.8], m_shelf1: [105, 1, 236.8], m_shelf2: [110, 1, 236.8], m_hose: [310.1, 1.2, 108], m_bricks: [321.4, 1, 117.2], m_site: [329, 1, 111],
    m_tools: [125.2, 1, 111], m_pump0: [111, 1, 115.4], m_pump1: [119, 1, 115.4], m_sample0: [298, 1, 182.2], m_sample1: [301.5, 1, 191.5], m_sample2: [294.5, 1, 191.5],
    m_lab0: [293.5, 1, 141.7], m_lab1: [302.5, 1, 141.7],
  };
  // где чинит механик (детская площадка) и где горит в Большом городе — на тротуарах, не в зданиях (city-test проверяет)
  const K_FIX = [[166, -61.4, 'качели'], [159.4, -64.2, 'горку'], [161, -43.2, 'карусель'], [168, -45.2, 'батут'], [163.6, -48, 'песочницу']];
  const M_FIRES = [[166, 135.5], [232, 124.5], [258, 210.5], [190, 199.5], [144, 180], [286, 240], [221, 160], [170, 279.5]];
  // экономика города (js/games/mir-econ.js): нет файла — работы без денег не запускаются (подсказка), остальное как было
  const ECON = () => root.MirEcon || null;
  // еда в кармане → 🎬 «Действия» (id 'food:…', не 'eat:' — то зоны мира сразу играют без сервера)
  function foodActs(){
    const E = ECON(); if (!E) return [];
    return Object.entries(E.api.st?.food || {}).filter(([k, n]) => n > 0 && E.GOODS[k])
      .map(([k, n]) => ({ id: 'food:' + k, icon: E.GOODS[k].e, name: `${k === 'coffee' || k === 'juice' ? 'Выпить' : 'Съесть'} (${n})`, hint: `+${E.D.goods[k]?.buff?.[0] || 0} % к зарплате` }));
  }
  const spotsOf = city => { const o = {}; for (const [id, p] of Object.entries(SPOTS)) if (id[0] === city[0]) o[id] = { x: p[0], y: p[1], z: p[2] }; return o; };

  // ═══ «Солнечный городок» (детский, 0+): x 110…250, z −80…40 ═══
  const KZ = MZ.ZONES.kids;
  const K_STREETS = [{ w: 8, pts: [[110, -24], [290, -24]] }, { w: 8, pts: [[180, -80], [180, 40]] }];
  // Таблица зданий (MirZones: стабильные id, тип, помещения). Детский город — невысокий и цветной; на востоке — ратуша и участки
  const K_BLD = [
    { id: 'k_play', type: 'park', name: 'Детская площадка', x: 161, z: -54, w: 22, d: 34, h: 0, wall: '#e9d5a1' },
    { id: 'k_park', type: 'park', name: 'Парк городка', x: 142, z: 25, w: 56, d: 26, h: 0 },
    { id: 'k_site', type: 'lot', sub: 'site', name: 'Стройка', x: 204, z: 24, w: 20, d: 16, h: 0 },
    { id: 'k_school', type: 'public', sub: 'school', name: 'Школа', x: 132, z: -56, w: 28, d: 18, h: 4.2, wall: '#fde68a' },
    { id: 'k_hosp', type: 'public', sub: 'hospital', name: 'Больница и ветклиника', x: 204, z: -56, w: 26, d: 18, h: 4, wall: '#f8fafc', lots: [{ kind: 'clinic', name: '🐾 Ветклиника' }] },
    { id: 'k_fire', type: 'public', sub: 'fire', name: 'Пожарная часть', x: 236, z: -56, w: 20, d: 18, h: 4.6, wall: '#fca5a5' },
    { id: 'k_bake', type: 'cafe', sub: 'bakery', name: 'Пекарня «Булочка»', x: 128, z: -2, w: 18, d: 14, h: 3.8, wall: '#fed7aa' },
    { id: 'k_ice', type: 'cafe', sub: 'icecream', name: 'Мороженое', x: 148, z: -6, w: 9, d: 7, h: 3.2, wall: '#fbcfe8' },
    { id: 'k_pets', type: 'shop', sub: 'pets', name: 'Зоомагазин', x: 165, z: -2, w: 12, d: 12, h: 3.6, wall: '#bbf7d0' },
    { id: 'k_h1', type: 'house', name: 'Жёлтый домик', x: 196, z: -4, w: 11, d: 10, h: 3.4, wall: '#fde68a' },
    { id: 'k_h2', type: 'house', name: 'Голубой домик', x: 218, z: -4, w: 11, d: 10, h: 3.4, wall: '#a5f3fc' },
    { id: 'k_h3', type: 'house', name: 'Сиреневый домик', x: 240, z: -4, w: 11, d: 10, h: 3.4, wall: '#f5d0fe' },
    { id: 'k_h4', type: 'house', name: 'Зелёный домик', x: 241, z: 25, w: 11, d: 10, h: 3.4, wall: '#bbf7d0' },
    // восток: ратуша (кабинет будущего мэра), «Радужный дом», свободные участки под рост
    { id: 'k_hall', type: 'public', sub: 'hall', name: 'Ратуша Солнечного городка', x: 272, z: -54, w: 28, d: 20, h: 5.2, wall: '#fef3c7' },
    { id: 'k_flats', type: 'apartment', name: 'Радужный дом', x: 264, z: 4, w: 16, d: 12.8, h: 9.6, wall: '#fff1f7', style: 'kids', tint: '#ffe4f1' },
    { id: 'k_lot1', type: 'lot', name: 'Свободный участок', x: 282.5, z: 4, w: 13, d: 12, h: 0 },
    { id: 'k_lot2', type: 'lot', name: 'Свободный участок у парка', x: 272, z: 28, w: 32, d: 16, h: 0 },
  ];
  const KB = id => K_BLD.find(b => b.id === id);
  const K_PLACES = [
    { id: 'k_school', icon: '🏫', name: 'Школа', x: 132, z: -42, lx: 132, lz: -56, sub: 1 },
    { id: 'k_play', icon: '🛝', name: 'Детская площадка', x: 161, z: -34, lx: 161, lz: -54, sub: 1 },
    { id: 'k_hosp', icon: '🏥', name: 'Больница и ветклиника', x: 204, z: -40, lx: 204, lz: -56, sub: 1 },
    { id: 'k_fire', icon: '🚒', name: 'Пожарная часть', x: 236, z: -40, lx: 236, lz: -56, sub: 1 },
    { id: 'k_bake', icon: '🥐', name: 'Пекарня', x: 128, z: -14, lx: 128, lz: -2, sub: 1 },
    { id: 'k_pets', icon: '🐶', name: 'Зоомагазин', x: 165, z: -13, lx: 165, lz: -2, sub: 1 },
    { id: 'k_park', icon: '🌳', name: 'Парк городка', x: 142, z: 14, lx: 142, lz: 25, sub: 1 },
    { id: 'k_build', icon: '🏗️', name: 'Стройка', x: 192, z: 14, lx: 204, lz: 24, sub: 1 },
    { id: 'k_halltp', icon: '🏛️', name: 'Ратуша', x: 272, z: -40, lx: 272, lz: -54, sub: 1 },
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
    roles: ROLES_K, buildings: K_BLD, streets: K_STREETS, places: K_PLACES, residents: 14,   // жители по расписанию (MirZones.residents)
    // карты у детской площадки (катаются только по городку)
    vehicles: [152, 157, 162].map((x, i) => ({ id: 'k_kart' + (i + 1), def: 'kart', x, z: -33.5, yaw: 0, area: 'kids' })),   // рядом, носом к улице (не друг в друга)
    ground: [[200, -24, 180, 8, '#5b6270'], [180, -20, 8, 120, '#5b6270'], [117, -24, 14, 28, '#e7dcc2']],
    actions: rt => {
      const L = [
        { id: 'wave', icon: '👋', name: 'Помахать' }, { id: 'dance', icon: '💃', name: 'Танцевать' }, { id: 'clap', icon: '👏', name: 'Хлопать' },
        { id: 'sit', icon: '🪑', name: 'Сесть' }, { id: 'sleep', icon: '😴', name: 'Спать', hint: 'У кровати: в домах и в больнице' },
        { id: 'call', icon: '📞', name: 'Позвонить маме' }, { id: 'photo', icon: '📸', name: 'Сфоткать' },
      ];
      L.push(...foodActs());
      if (rt.zx.pt) L.push({ id: 'k_pet', icon: (PETS[rt.zx.pt] || ['🐾'])[0], name: 'Погладить питомца' }, { id: 'k_feed', icon: '🦴', name: 'Покормить' });
      L.push({ id: 'me', icon: '💬', name: '/me действие' });
      return L;
    },
    *build(K){ yield* buildKids(K); },
    start: (rt, K) => cityMod(rt, K, 'kids'),
  });

  // ═══ «Большой город» (для взрослых, ADULT_AGE+): x 90…340, z 100…350 ═══
  // Улицы: с запада на восток z 130, 205, 274; с севера на юг x 150, 215, 280 (на x 280 — эстакада над каналом и улицей 274).
  // Канал z 252…264 (MZ.CANAL) — мосты на проспектах 150 и 215, пешеходные мостики. Старый центр (полиция, суд, мэрия, банк,
  // больница, автосалон, такси, магазины, бизнес-центр) — на прежних местах; новые кварталы: «Сити» (небоскрёбы), ТЦ «Галерея»,
  // телебашня, «Гранд Отель», паркинг, ЖК «Солнечный», «Денчик-Тауэр», пожарная часть, свободные участки под застройку.
  const MC = MZ.ZONES.metro;
  const M_STREETS = [
    { w: 8, pts: [[90, 130], [340, 130]] }, { w: 8, pts: [[90, 205], [340, 205]] }, { w: 8, pts: [[90, 274], [340, 274]] },
    { w: 8, pts: [[150, 100], [150, 350]] }, { w: 8, pts: [[215, 100], [215, 350]] }, { w: 8, pts: [[280, 100], [280, 350]] },
  ];
  // Таблица зданий (MirZones: стабильные id, тип, помещения). Высоты небоскрёбов кратны этажу 3,2; style — фасад
  const M_BLD = [
    // площади и парки (земля — рисуются первыми)
    { id: 'm_plaza', type: 'park', name: 'Площадь у мэрии', x: 182, z: 150, w: 40, d: 26, h: 0, wall: '#d6d3d1' },
    { id: 'm_cityplaza', type: 'park', name: 'Площадь «Сити»', x: 298, z: 141, w: 22, d: 12, h: 0, wall: '#d6d3d1' },
    { id: 'm_citygarden', type: 'park', name: 'Сквер «Сити»', x: 298, z: 186, w: 22, d: 26, h: 0 },
    { id: 'm_tvpark', type: 'park', name: 'Парк у телебашни', x: 182, z: 306, w: 56, d: 48, h: 0 },
    // старый центр
    { id: 'm_police', type: 'public', sub: 'police', name: 'Полиция и тюрьма', x: 116, z: 152, w: 26, d: 18, h: 5, wall: '#cbd5e1' },
    { id: 'm_court', type: 'public', sub: 'court', name: 'Суд', x: 116, z: 184, w: 24, d: 16, h: 5.5, wall: '#f5f5f4' },
    { id: 'm_hall', type: 'public', sub: 'hall', name: 'Мэрия', x: 182, z: 175, w: 28, d: 22, h: 7, wall: '#fef3c7' },
    { id: 'm_bank', type: 'office', sub: 'bank', name: 'Банк', x: 246, z: 152, w: 24, d: 18, h: 6, wall: '#e7e5e4', lots: [{ kind: 'bank', name: 'Банк' }] },
    { id: 'm_hosp', type: 'public', sub: 'hospital', name: 'Больница', x: 246, z: 184, w: 22, d: 14, h: 5, wall: '#f8fafc' },
    { id: 'm_cars', type: 'shop', sub: 'cars', name: 'Автосалон', x: 182, z: 112, w: 28, d: 14, h: 5, wall: '#e0f2fe' },
    { id: 'm_taxi', type: 'service', sub: 'taxi', name: 'Такси', x: 246, z: 112, w: 20, d: 14, h: 4.5, wall: '#fef9c3' },
    { id: 'm_gas', type: 'service', sub: 'gas', name: 'Заправка', x: 115, z: 113, w: 16, d: 9, h: 4.8, wall: '#ef4444' },
    { id: 'm_shop', type: 'shop', sub: 'market', name: 'Супермаркет', x: 105, z: 234, w: 22, d: 18, h: 5, wall: '#dcfce7' },
    { id: 'm_rest', type: 'cafe', sub: 'restaurant', name: 'Ресторан «Вкусно»', x: 131, z: 234, w: 16, d: 18, h: 4.6, wall: '#fee2e2' },
    { id: 'm_coffee', type: 'cafe', name: 'Кофейня', x: 166, z: 230, w: 12, d: 10, h: 4, wall: '#f8fafc' },
    { id: 'm_flowers', type: 'shop', name: 'Цветы', x: 182, z: 230, w: 12, d: 10, h: 4, wall: '#f8fafc' },
    { id: 'm_wash', type: 'service', sub: 'carwash', name: 'Автомойка', x: 198, z: 230, w: 12, d: 10, h: 4, wall: '#f8fafc' },
    { id: 'm_h1', type: 'apartment', name: 'Дом на Садовой', x: 235, z: 236, w: 14, d: 14, h: 28.8, wall: '#fde68a', style: 'flat', tint: '#fff1c2' },
    { id: 'm_h2', type: 'apartment', name: 'Дом у канала', x: 258, z: 236, w: 14, d: 14, h: 38.4, wall: '#c4b5fd', style: 'brick' },
    // новые кварталы
    { id: 'm_fire', type: 'public', sub: 'fire', name: 'Пожарная часть', x: 300, z: 113, w: 26, d: 16, h: 6.4, wall: '#fca5a5' },
    { id: 'm_lot1', type: 'lot', sub: 'site', name: 'Стройка у пожарной части', x: 327, z: 113, w: 20, d: 14, h: 0 },
    { id: 'm_city1', type: 'office', name: 'Сити-1', x: 298.4, z: 160, w: 22.4, d: 22.4, h: 92.8, style: 'glass', enter: true },
    { id: 'm_city2', type: 'office', name: 'Сити-2', x: 326.4, z: 150, w: 19.2, d: 22.4, h: 70.4, style: 'dark' },
    { id: 'm_city3', type: 'office', name: 'Бизнес-центр «37»', x: 326.4, z: 186, w: 19.2, d: 22.4, h: 48, style: 'office' },
    { id: 'm_pharm', type: 'shop', sub: 'pharmacy', name: 'Аптека', x: 230, z: 217, w: 14, d: 10, h: 9.6, wall: '#f0fdf4', style: 'flat', base: 'shop', flats: true },
    { id: 'm_books', type: 'shop', sub: 'books', name: 'Книжный', x: 248, z: 217, w: 14, d: 10, h: 9.6, wall: '#fefce8', style: 'brick', base: 'shop', flats: true },
    { id: 'm_gym', type: 'service', sub: 'gym', name: 'Спортзал', x: 266, z: 217, w: 14, d: 10, h: 9.6, wall: '#eff6ff', style: 'office', base: 'shop' },
    { id: 'm_mall', type: 'shop', sub: 'mall', name: 'ТЦ «Галерея»', x: 313, z: 228, w: 48, d: 32, h: 10.4, wall: '#e2e8f0', enter: true,
      lots: [{ kind: 'shop', name: '👕 Одежда' }, { kind: 'shop', name: '👟 Обувь' }, { kind: 'shop', name: '📱 Электроника' }, { kind: 'shop', name: '🧸 Игрушки' },
        { kind: 'cafe', name: '🍔 Фуд-корт' }, { kind: 'cinema', name: '🎬 Кинотеатр', floor: 1 }, { kind: 'arcade', name: '🕹️ Автоматы', floor: 1 }, { kind: 'cafe', name: '☕ Кафе на 2-м этаже', floor: 1 }] },
    { id: 'm_flat1', type: 'apartment', name: 'ЖК «Солнечный», дом 1', x: 106, z: 298, w: 19.2, d: 16, h: 35.2, style: 'flat', base: 'shop', shops: 2 },
    { id: 'm_flat2', type: 'apartment', name: 'ЖК «Солнечный», дом 2', x: 134, z: 298, w: 16, d: 16, h: 28.8, style: 'brick' },
    { id: 'm_flat3', type: 'apartment', name: 'ЖК «Солнечный», дом 3', x: 120, z: 332, w: 35.2, d: 12.8, h: 22.4, style: 'flat', tint: '#f3e6ff' },
    { id: 'm_tv', type: 'public', sub: 'tv', name: 'Телебашня', x: 182, z: 316, w: 16, d: 16, h: 6.4, wall: '#e5e7eb', enter: true },
    { id: 'm_hotel', type: 'hotel', name: 'Гранд Отель', x: 247, z: 298, w: 28.8, d: 19.2, h: 64, style: 'brick', tint: '#ffe7da', enter: true },
    { id: 'm_park', type: 'parking', name: 'Паркинг', x: 247, z: 332, w: 48, d: 26, h: 7.2, enter: true },
    { id: 'm_tower', type: 'office', name: 'Денчик-Тауэр', x: 312, z: 300, w: 25.6, d: 22.4, h: 118.4, style: 'dark' },
    { id: 'm_office5', type: 'office', name: 'Деловой дом «Канал»', x: 316, z: 334, w: 32, d: 16, h: 41.6, style: 'office' },
    { id: 'm_lot2', type: 'lot', name: 'Свободный участок у парка', x: 199, z: 340, w: 16, d: 14, h: 0 },
  ];
  const MB = id => M_BLD.find(b => b.id === id);
  // здание для генератора интерьеров (js/engine/interior.js): тип и вид — из таблицы, вход — door, этажи — по 3,2
  const gen = (B, o = {}) => ({ id: B.id, name: B.name, type: B.type, sub: B.sub, x: B.x, z: B.z, w: B.w, d: B.d, h: B.h, style: B.style, tint: B.tint, roof: B.roof, shops: B.shops, flats: B.flats, ...o });
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
    { id: 'm_citytp', icon: '🏙️', name: 'Небоскрёбы «Сити»', x: 298, z: 142, lx: 298, lz: 160, sub: 1 },
    { id: 'm_malltp', icon: '🛍️', name: 'ТЦ «Галерея»', x: 313, z: 210.4, lx: 313, lz: 228, sub: 1 },
    { id: 'm_canal', icon: '🌉', name: 'Набережная канала', x: 182, z: 249, lx: 182, lz: 258, sub: 1 },
    { id: 'm_tvtp', icon: '📡', name: 'Телебашня — вид сверху', x: 182, z: 300, lx: 182, lz: 316, sub: 1 },
    { id: 'm_hoteltp', icon: '🏨', name: 'Гранд Отель', x: 247, z: 285.5, lx: 247, lz: 298, sub: 1 },
    { id: 'm_parktp', icon: '🅿️', name: 'Паркинг', x: 219, z: 332, lx: 247, lz: 332, sub: 1 },
    { id: 'm_firetp', icon: '🚒', name: 'Пожарная часть', x: 300, z: 125, lx: 300, lz: 113, sub: 1 },
    { id: 'm_flatstp', icon: '🏢', name: 'ЖК «Солнечный»', x: 120, z: 316, lx: 120, lz: 298, sub: 1 },
  ];
  MZ.def('metro', {
    roles: ROLES_M, buildings: M_BLD, streets: M_STREETS, places: M_PLACES, residents: 24,   // жители по расписанию (MirZones.residents)
    // фоновое движение по кварталам (mir-veh.js): по часовой стрелке, правый ряд; место — по часам, у всех одинаково
    traffic: [
      { id: 'a1', def: 'taxi', rect: [150, 130, 215, 205], speed: 8, phase: 0 }, { id: 'a2', def: 'sedan', rect: [150, 130, 215, 205], speed: 8, phase: .5 },
      { id: 'b1', def: 'sedan_red', rect: [215, 130, 280, 205], speed: 9, phase: .2 }, { id: 'b2', def: 'police_car', rect: [215, 130, 280, 205], speed: 9, phase: .7 },
      { id: 'c1', def: 'sedan', rect: [150, 205, 215, 274], speed: 8, phase: .35 },
    ],
    // транспорт города: такси у стоянки, машины в паркинге, катера на канале, вертолёт на площадке крыши «Сити-1» (y — высота крыши)
    vehicles: [
      { id: 'm_heli1', def: 'heli_city', x: 298.4, z: 160, yaw: PI / 2, y: 109.3 },
      { id: 'm_taxi1', def: 'taxi', x: 239, z: 121.6, yaw: 0 }, { id: 'm_taxi2', def: 'taxi', x: 253, z: 121.6, yaw: 0 },   // носом к проспекту
      { id: 'm_car1', def: 'sedan_red', x: 230, z: 332, yaw: 0 }, { id: 'm_car2', def: 'sedan', x: 242, z: 332, yaw: 0 }, { id: 'm_car3', def: 'police_car', x: 254, z: 332, yaw: 0 },
      { id: 'm_boat1', def: 'motorboat', x: 160, z: 261.6, yaw: PI / 2 }, { id: 'm_boat2', def: 'motorboat', x: 228, z: 261.6, yaw: PI / 2 }, { id: 'm_boat3', def: 'motorboat', x: 300, z: 261.6, yaw: -PI / 2 },
    ],
    // силуэт издалека выше зданий: телебашня, ярусы «Денчик-Тауэр» — [x, z, w, d, цвет, верх, низ, фасад]
    skyline: [[182, 316, 6, 6, '#e5e7eb', 96, 6.4], [182, 316, 18, 18, '#cbd5e1', 104, 96], [182, 316, 1.4, 1.4, '#e5e7eb', 140, 104], [312, 300, 19.2, 16, '#0f172a', 140.8, 118.4, 'dark'], [298.4, 160, 16, 16, '#1e3a8a', 108.8, 92.8, 'glass']],
    ground: [[215, 130, 250, 8, '#5b6270'], [215, 205, 250, 8, '#5b6270'], [215, 274, 250, 8, '#5b6270'], [150, 225, 8, 250, '#5b6270'], [215, 225, 8, 250, '#5b6270'], [280, 156, 8, 112, '#5b6270']],
    actions: rt => {
      const L = [
        { id: 'wave', icon: '👋', name: 'Помахать' }, { id: 'dance', icon: '💃', name: 'Танцевать' }, { id: 'clap', icon: '👏', name: 'Аплодировать' },
        { id: 'sit', icon: '🪑', name: 'Сесть' }, { id: 'sleep', icon: '😴', name: 'Спать', hint: 'У кровати: в квартирах и в больнице' },
        { id: 'call', icon: '📞', name: 'Позвонить' }, { id: 'photo', icon: '📸', name: 'Сфоткать' },
      ];
      L.push(...foodActs());
      if (rt.zx.r === 'robber' && rt.zx.wn) L.push({ id: 'm_hide', icon: '🫣', name: 'Спрятать лицо' });
      L.push({ id: 'me', icon: '💬', name: '/me действие' });
      return L;
    },
    *build(K){ yield* buildMetro(K); },
    start: (rt, K) => cityMod(rt, K, 'metro'),
  });
  MZ.FOOD_EXTRA = { coffee: '☕', burger: '🍔', soup: '🍲', juice: '🧃', pie: '🥧' };

  // ═══ ПОСТРОЙКА: Солнечный городок ═══
  function* buildKids(K){
    // постройка — кусочками: после каждого оператора — yield (бюджет кадра считает stepBuild в mir-zones.js; одна зона за раз)
    const { R } = K, M = K.M; yield;
    K.spots = spotsOf(K.Z.id); yield;
    const spot = id => K.spots[id]; yield;
    // ── улицы, перекрёсток, площадь у входа ──
    K.chunk('streets'); yield;
    K.road(110, -24, 176, -24, 8); yield; K.road(184, -24, 290, -24, 8); yield;
    K.road(180, -80, 180, -28, 8); yield; K.road(180, -20, 180, 40, 8); yield;
    K.part({ s: 'box', x: 180, y: .025, z: -24, w: 8, h: .02, d: 8, m: M.asphalt }); yield;
    for (const [x, z, yaw] of [[171, -24, PI / 2], [189, -24, PI / 2], [180, -33, 0], [180, -15, 0]]) K.zebra(x, z, 8, yaw); yield;
    K.part({ s: 'box', x: 117, y: .03, z: -24, w: 14, h: .03, d: 28, m: M.plaza }); yield;   // площадь у входа
    for (const [x, z] of [[124, -31], [124, -17]]) { K.cyl(x, 0, z, 1.1, .16, '#d6cfc0', { solid: true }); yield; K.prefab('flowers', { x, z, n: 9, seed: x + z, c: '#f472b6' }); yield; }
    for (let x = 130; x < 290; x += 16) for (const s of [-1, 1]) if (Math.abs(x - 180) > 9) K.lamp(x, -24 + s * 5.6); yield;
    for (let z = -72; z < 38; z += 16) for (const s of [-1, 1]) if (Math.abs(z + 24) > 9) K.lamp(180 + s * 5.6, z); yield;
    for (let x = 136; x < 286; x += 22) for (const s of [-1, 1]) if (Math.abs(x - 180) > 10) K.tree(x + 6, -24 + s * 7.6, .75, (x / 22 | 0) % 4); yield;
    K.board(120, 2.2, -36.8, 3, 1.5, 0, '🧰 Работа в городке', { bg: '#166534' }); yield;
    K.box(120, 0, -37, .16, 1.5, .16, '#6b4426', { solid: true }); yield;
    K.board(113.5, 2.2, -36.8, 3, 1.5, 0, '👪 Семья: выбери роль', { bg: '#9d174d' }); yield;
    K.box(113.5, 0, -37, .16, 1.5, .16, '#6b4426', { solid: true }); yield;
    K.item({ x: 120, y: 1.6, z: -35.8, r: 1.2, prompt: () => '🧰 Работа: выбрать профессию', act: () => K.rt.city?.kids?.jobBoard() }); yield;
    K.item({ x: 113.5, y: 1.6, z: -35.8, r: 1.2, prompt: () => '👪 Семья: выбрать роль', act: () => K.rt.city?.kids?.familyBoard() }); yield;
    K.label.sign('🧸 Солнечный городок', 117, 3.1, -11, 6, .9, PI, { bg: '#ca8a04', w: 768, h: 116 }); yield;
    K.box(117, 0, -10.8, 6.4, 2.6, .25, '#92400e', { solid: true }); yield;
    yield;
    // ── Школа ──
    K.chunk('school'); yield;
    K.building({ id: 'k_school', x: 132, z: -56, w: 28, d: 18, h: 4.2, wall: '#fde68a', trim: '#b45309', roofC: KB('k_school').roof, floor: '#d4a373',
      doors: [{ side: 's', at: 0, w: 3 }], windows: [{ side: 's', at: -9, w: 4 }, { side: 's', at: 9, w: 4 }, { side: 'e', at: 0, w: 4 }, { side: 'w', at: 0, w: 4 }, { side: 'n', at: -8, w: 3 }, { side: 'n', at: 8, w: 3 }],
      sign: '🏫 Школа', signBg: '#b45309' }); yield;
    K.box(132, .12, -64.4, 9, 2.4, .12, '#14532d'); yield;   // доска
    K.label.sign('2 + 2 = 4   🍎 Урок!', 132, 2.2, -64.28, 8, 1.4, 0, { bg: '#14532d', w: 768, h: 134, border: false }); yield;
    K.table(132, -60.5, 2, 1, '#92400e'); yield;
    for (let r = 0; r < 3; r++) for (const dx of [-8, -3, 3, 8]) { K.table(132 + dx, -56 + r * 3.2, 1.6, .7, '#d97706', .72); yield; K.chair(132 + dx, -55.2 + r * 3.2, PI, '#2563eb'); yield; }
    K.lampIn(126, 3.5, -56); yield; K.lampIn(138, 3.5, -56); yield;
    spot('k_teacher'); yield;
    K.npc({ id: 'k_teacher', name: '👩‍🏫 Учительница', x: 132, z: -62.2, yaw: 0, seed: 'uchit1', say: ['Садись за парту — начнём урок! 📚', 'Подойди ко мне и нажми E — задам вопрос', 'Молодец! Знания — это сила 💪'] }); yield;
    K.item({ x: 132, y: 1.3, z: -61.2, r: 1.2, prompt: () => '📚 Урок: ответить на вопрос учительницы', act: () => K.rt.city?.kids?.quiz() }); yield;
    // двор: флаг и скамейки
    K.cyl(132, 0, -42, .08, 7, '#9ca3af', { solid: true }); yield;
    K.part({ s: 'box', x: 133, y: 6.4, z: -42, w: 2, h: 1.2, d: .04, c: '#38bdf8' }); yield;
    for (const x of [122, 142]) K.bench(x, -40, PI); yield;
    yield;
    // ── Детская площадка ──
    K.chunk('play'); yield;
    K.part({ s: 'box', x: 161, y: .03, z: -54, w: 22, h: .03, d: 34, m: M.sand }); yield;
    // горка: лестница-ступени, площадка, скат (клин)
    K.box(155, 0, -64, 3, 2.8, 3, '#f97316', { solid: true, floor: 'metal' }); yield;
    for (let i = 0; i < 6; i++) K.box(157.6, 0, -66.2 + i * .45, 1.4, (i + 1) * .45, .45, '#facc15', { solid: true, floor: 'metal' }); yield;
    K.part({ s: 'box', x: 155, y: 1.45, z: -59.4, w: 2, h: .14, d: 6.4, rx: .42, c: '#ef4444' }); yield;
    K.wedge({ x: 155, z: -59.6, y: 1.4, hx: 1, hy: 1.4, hz: 3, yaw: 0, data: { floor: 'metal' } }); yield;
    // качели: рама и два сиденья
    for (const s of [-1, 1]) K.box(166 + s * 3.2, 0, -64, .2, 3, .2, '#2563eb', { solid: true }); yield;
    K.part({ s: 'box', x: 166, y: 3, z: -64, w: 6.6, h: .2, d: .2, c: '#2563eb' }); yield;
    for (const s of [-1, 1]) { K.part({ s: 'box', x: 166 + s * 1.4, y: .7, z: -64, w: 1, h: .08, d: .5, c: '#f8fafc' }); yield; for (const t of [-1, 1]) K.part({ s: 'cyl', x: 166 + s * 1.4 + t * .45, y: 1.85, z: -64, r: .02, h: 2.3, c: '#94a3b8' }); yield; K.seat(166 + s * 1.4, .72, -64, 0, { name: 'Покачаться на качелях' }); yield; }
    // песочница
    for (const [x, z, w, d] of [[160, -50.6, 6, .25], [160, -45.4, 6, .25], [157.1, -48, .25, 5], [162.9, -48, .25, 5]]) K.box(x, 0, z, w, .4, d, '#b45309', { solid: true }); yield;
    K.part({ s: 'box', x: 160, y: .06, z: -48, w: 5.6, h: .1, d: 5, m: M.sand }); yield;
    K.part({ s: 'cone', x: 159, y: .35, z: -47.5, r: .7, h: .6, c: '#e6c27a' }); yield;
    // батут
    K.cyl(168, 0, -48, 2.2, .55, '#1e40af', { solid: true, seg: 20 }); yield; K.part({ s: 'cyl', x: 168, y: .58, z: -48, r: 2, h: .04, c: '#111827', seg: 20 }); yield;
    spot('k_tramp'); yield;
    // карусель
    K.cyl(161, 0, -40, 2.4, .3, '#a855f7', { solid: true, seg: 16 }); yield; K.part({ s: 'cyl', x: 161, y: 1.3, z: -40, r: .12, h: 2.2, c: '#facc15' }); yield; K.part({ s: 'cone', x: 161, y: 2.6, z: -40, r: 2.4, h: .7, c: '#ec4899', seg: 16 }); yield;
    for (let i = 0; i < 4; i++) { const a = i * PI / 2; yield; K.seat(161 + Math.cos(a) * 1.7, .5, -40 + Math.sin(a) * 1.7, -a, { name: 'Сесть на карусель' }); yield; }
    for (const [x, z, yaw] of [[151.5, -42, PI / 2], [151.5, -52, PI / 2], [170.5, -60, -PI / 2]]) K.bench(x, z, yaw); yield;
    for (const [x, z] of [[151, -70], [171, -70], [151, -38], [171, -36]]) K.tree(x, z, .9, 1); yield;
    K.box(146.6, 0, -34, .9, .55, .5, '#dc2626', { solid: true }); yield; K.part({ s: 'box', x: 146.6, y: .62, z: -34, w: .5, h: .08, d: .12, c: '#111827' }); yield; spot('k_tools'); yield;   // ящик механика
    K.npc({ id: 'k_kid1', name: '🧒 Миша', x: 162, z: -52, yaw: 0, seed: 'misha7', act: 'wander', radius: 6, say: ['Давай кататься с горки! 🛝', 'На батуте можно прыгать высоко-высоко!'] }); yield;
    yield;
    // ── Больница и ветклиника ──
    K.chunk('hosp'); yield;
    K.building({ id: 'k_hosp', x: 204, z: -56, w: 26, d: 18, h: 4, wall: '#f8fafc', trim: '#ef4444', roofC: KB('k_hosp').roof, floor: '#e2e8f0', floorType: 'tile', floorM: M.walk,
      doors: [{ side: 's', at: -6, w: 2.8 }, { side: 's', at: 7, w: 2.8 }], windows: [{ side: 's', at: -11, w: 2.4 }, { side: 's', at: 1, w: 2.4 }, { side: 'e', at: 0, w: 3 }, { side: 'w', at: 0, w: 3 }],
      sign: '🏥 Больница', signBg: '#dc2626' }); yield;
    K.label.sign('🐾 Ветклиника', 211, 3.4, -46.8, 5, .9, 0, { bg: '#16a34a', w: 512, h: 92 }); yield;
    K.box(204.2, .12, -56, .2, 3.6, 12, '#e2e8f0', { solid: true, cam: true }); yield;   // перегородка
    for (const [i, x] of [194, 198, 202].entries()) { K.bed(x, -61.5, PI, '#93c5fd'); yield; spot('k_bed' + i); yield; }
    K.counter(195.5, -50.5, 3.2, .9, '#e5e7eb', '#ffffff'); yield;
    K.box(191.6, .12, -54, .6, 2, 1.6, '#f1f5f9', { solid: true }); yield; K.part({ s: 'box', x: 191.9, y: 1.3, z: -54, w: .05, h: .5, d: .5, c: '#ef4444' }); yield;
    spot('k_med'); yield;
    K.npc({ id: 'k_doc', name: '🩺 Доктор Айболит', x: 195.5, z: -52.2, yaw: 180, seed: 'aibolit', say: ['Здравствуй! Кто тут приболел? 🤒', 'Стань врачом на щите «Работа» у входа в городок', 'Не забывай мыть руки! 🧼'] }); yield;
    // ветклиника
    K.counter(212, -58, 2.4, 1.2, '#16a34a', '#dcfce7'); yield; spot('k_vettable'); yield;
    for (let i = 0; i < 3; i++) { K.box(216.2, .12, -62 + i * 2.2, 1.4, 1.2, 1.4, '#94a3b8', { solid: true }); yield; K.part({ s: 'box', x: 215.48, y: .72, z: -62 + i * 2.2, w: .02, h: 1, d: 1.3, c: '#cbd5e1' }); yield; }
    K.npc({ id: 'k_vet', name: '🐾 Ветеринар', x: 210, z: -60.5, yaw: 0, seed: 'vetdoc', say: ['Котики, собачки, хомячки — всех вылечим! 🐾', 'Принеси приболевшего питомца на стол'] }); yield;
    yield;
    // ── Пожарная часть ──
    K.chunk('fire'); yield;
    K.building({ id: 'k_fire', x: 236, z: -56, w: 20, d: 18, h: 4.6, wall: '#fca5a5', trim: '#991b1b', roofC: KB('k_fire').roof, floor: '#9ca3af', floorType: 'concrete', floorM: M.concrete,
      doors: [{ side: 's', at: -3, w: 6, h: 3.6 }, { side: 's', at: 6, w: 2.4 }], windows: [{ side: 'e', at: 0, w: 3 }, { side: 'w', at: -3, w: 3 }], sign: '🚒 Пожарная часть', signBg: '#991b1b' }); yield;
    fireTruck(K, 233, -57, 0); yield;
    K.box(243.6, .12, -50, .3, 2, 2, '#9ca3af', { solid: true }); yield; K.part({ s: 'torus', x: 243.4, y: 1.3, z: -50, r: .5, t: .1, yaw: PI / 2, c: '#facc15' }); yield;
    spot('k_hose'); yield;
    K.npc({ id: 'k_fireman', name: '🚒 Пожарный Петя', x: 241, z: -54, yaw: 200, seed: 'petya01', say: ['Огонь — не игрушка! 🔥', 'Стань пожарным — будешь тушить пожары в городке', 'Шланг — у стены, бери и беги!'] }); yield;
    yield;
    // ── Пекарня ──
    K.chunk('bake'); yield;
    K.building({ id: 'k_bake', x: 128, z: -2, w: 18, d: 14, h: 3.8, wall: '#fed7aa', trim: '#9a3412', roofC: KB('k_bake').roof, floor: '#c8956a',
      doors: [{ side: 'n', at: 0, w: 2.6 }], windows: [{ side: 'n', at: -5.5, w: 3 }, { side: 'n', at: 5.5, w: 3 }, { side: 'e', at: 0, w: 2.4 }], sign: '🥐 Пекарня «Булочка»', signBg: '#9a3412' }); yield;
    K.counter(128, -4.4, 8, .9, '#9a3412', '#fde68a'); yield;
    for (let i = 0; i < 5; i++) K.part({ s: 'ball', x: 125 + i * 1.5, y: 1.25, z: -4.4, r: .18, c: '#d97706', seg: 8 }); yield;
    K.box(121.2, .12, 3.6, 2.6, 2.2, 1.6, '#b91c1c', { solid: true }); yield;   // печь
    K.part({ s: 'box', x: 121.2, y: 1, z: 2.78, w: 1.4, h: .8, d: .04, c: '#ff8a3d', m: 'glow' }); yield;
    spot('k_oven'); yield;
    K.table(134, 2.6, 2.4, 1.2, '#d6a77a'); yield; spot('k_dough'); yield;
    K.box(136.2, .12, -1.5, .8, .9, .7, '#e7e5e4', { solid: true }); yield; K.part({ s: 'box', x: 136.2, y: 1.1, z: -.6, w: .7, h: .5, d: .5, c: '#d6d3d1' }); yield; spot('k_flour'); yield;   // мука
    K.part({ s: 'ball', x: 134, y: .95, z: 2.6, r: .35, c: '#fef3c7', sy: .5, seg: 12 }); yield;
    for (const [x, z] of [[123, -7.2], [133, -7.2]]) { K.table(x, z, .9, .9, '#f8fafc', .75); yield; K.chair(x - .9, z, PI / 2); yield; K.chair(x + .9, z, -PI / 2); yield; }
    K.npc({ id: 'k_baker', name: '👨‍🍳 Пекарь Булкин', x: 128, z: -2.4, yaw: 180, seed: 'bulkin', say: ['Свежие булочки! 🥐 Всего ⭐1', 'Хочешь печь сам? Стань пекарем на щите «Работа»', 'Тесто любит, когда его месят с любовью'] }); yield;
    K.item({ x: 128, y: 1.2, z: -5.6, r: 1.2, prompt: () => '🥐 Пекарня: купить булочку или пирог', act: () => K.rt.city?.kids?.shop('k_bake') }); yield;
    // ── Киоск мороженого ──
    K.building({ id: 'k_ice', x: 148, z: -6, w: 9, d: 7, h: 3.2, wall: '#fbcfe8', trim: '#db2777', roofC: KB('k_ice').roof, floor: '#fce7f3', interior: true,
      doors: [{ side: 'e', at: 1, w: 2 }], windows: [{ side: 'n', at: 0, w: 4, h: 1.2 }], sign: '🍦 Мороженое', signBg: '#db2777' }); yield;
    K.counter(148, -8.6, 4.6, .8, '#f9a8d4', '#ffffff'); yield;
    spot('k_icewin'); yield; spot('k_icecounter'); yield;
    K.box(146, .12, -3.4, 1.8, 1, .9, '#e0f2fe', { solid: true }); yield; K.part({ s: 'box', x: 146, y: 1.14, z: -3.4, w: 1.7, h: .04, d: .8, m: K.M.glass }); yield; spot('k_freezer'); yield;   // морозильник
    K.npc({ id: 'k_icelady', name: '🍦 Мороженщица', x: 147, z: -7.4, yaw: 180, seed: 'morozh', say: ['Мороженое! Пломбир, шоколадное, клубничное 🍦', 'Всего одна звёздочка ⭐'] }); yield;
    K.item({ x: 148, y: 1.2, z: -10.4, r: 1.2, prompt: () => '🍦 Купить мороженое', act: () => K.rt.city?.kids?.shop('k_ice') }); yield;
    yield;
    // ── Зоомагазин ──
    K.chunk('pets'); yield;
    K.building({ id: 'k_pets', x: 165, z: -2, w: 12, d: 12, h: 3.6, wall: '#bbf7d0', trim: '#15803d', roofC: KB('k_pets').roof, floor: '#d9f99d',
      doors: [{ side: 'n', at: 0, w: 2.6 }], windows: [{ side: 'n', at: -3.6, w: 2 }, { side: 'n', at: 3.6, w: 2 }], sign: '🐶 Зоомагазин', signBg: '#15803d' }); yield;
    K.counter(165, -4.6, 4, .8, '#15803d', '#dcfce7'); yield;
    Object.values(PETS).forEach(([e], i) => { const x = 160.8 + i * 1.65, z = 3.2; K.box(x, .12, z, 1.3, 1.1, 1.3, '#cbd5e1', { solid: true }); K.label.sign(e, x, 1.6, z - .7, .9, .9, PI, { bg: '#ecfccb', w: 96, h: 96, border: false }); }); yield;
    K.npc({ id: 'k_petseller', name: '🐹 Продавец зоомагазина', x: 165, z: -2.8, yaw: 180, seed: 'zooman', say: ['Возьми питомца — он будет ходить за тобой! 🐾', 'Корм для питомца — ⭐1'] }); yield;
    K.item({ x: 165, y: 1.2, z: -6, r: 1.2, prompt: () => '🐾 Взять питомца', act: () => K.rt.city?.kids?.petShop() }); yield;
    yield;
    // ── Парк ──
    K.chunk('park'); yield;
    for (const [x1, z1, x2, z2] of [[115, 14, 170, 14], [142, 4, 142, 37]]) K.part({ s: 'box', x: (x1 + x2) / 2, y: .025, z: (z1 + z2) / 2, w: x1 === x2 ? 2.4 : Math.abs(x2 - x1), h: .02, d: z1 === z2 ? 2.4 : Math.abs(z2 - z1), m: M.walk }); yield;
    K.part({ s: 'disc', x: 128, y: .04, z: 27, r: 5, rx: -PI / 2, m: K.R.water('#38bdf8', { key: 'mzkpond', fixedColor: true }) }); yield;
    K.part({ s: 'ring', x: 128, y: .05, z: 27, r: 5.6, r2: 4.95, rx: -PI / 2, c: '#94a3b8' }); yield;
    for (const [x, z, yaw] of [[136, 20, PI], [148, 20, PI], [156, 30, -PI / 2], [120, 20, PI]]) K.bench(x, z, yaw); yield;
    for (const [x, z] of [[114, 34], [118, 9], [150, 36], [160, 9], [166, 22], [134, 36], [124, 36], [168, 34]]) K.tree(x, z, 1, (x + z) % 4); yield;
    for (const [x, z, c] of [[146, 26, '#f472b6'], [138, 30, '#facc15'], [152, 25, '#a78bfa']]) K.prefab('flowers', { x, z, seed: x, c }); yield;
    K.table(160, 27, 2, 1.2, '#a16207'); yield; K.chair(160, 25.8, 0); yield; K.chair(160, 28.2, PI); yield;
    K.npc({ id: 'k_mom', name: '👩 Мама Света', x: 152, z: 28, yaw: 0, seed: 'sveta3', act: 'wander', radius: 8, say: ['Какой чудесный день! ☀️', 'В зоомагазине можно взять питомца 🐶'] }); yield;
    K.npc({ id: 'k_kid2', name: '👧 Аня', x: 130, z: 18, yaw: 90, seed: 'anya44', act: 'wander', radius: 9, say: ['Пойдём есть мороженое! 🍦', 'Я хочу стать ветеринаром 🐾'] }); yield;
    yield;
    // ── Дома семей (сделать своим) ──
    K.chunk('houses'); yield;
    const HOUSES = [['k_h1', 196, -4, 'n', '#fde68a'], ['k_h2', 218, -4, 'n', '#a5f3fc'], ['k_h3', 240, -4, 'n', '#f5d0fe'], ['k_h4', 241, 25, 'w', '#bbf7d0']]; yield;
    K.houses = []; yield;
    for (const [id, x, z, side, wall] of HOUSES) {
      K.building({ id, x, z, w: 11, d: 10, h: 3.4, wall, trim: '#7c2d12', roofC: KB(id).roof, floor: '#d6a77a',
        doors: [{ side, at: 0, w: 2.2 }], windows: [{ side, at: -3.4, w: 1.6 }, { side, at: 3.4, w: 1.6 }, { side: side === 'n' ? 's' : 'e', at: 0, w: 2 }] }); yield;
      const fx = side === 'n' ? 0 : -1, fz = side === 'n' ? -1 : 0; yield;   // куда дверь
      K.bed(x + (side === 'n' ? 3 : 2.6), z + (side === 'n' ? 2.6 : -2.6), side === 'n' ? PI : PI / 2, pick(['#60a5fa', '#f472b6', '#4ade80', '#facc15'])); yield;
      K.sofa(x - 2.8, z + (side === 'n' ? 2.8 : 2.4), side === 'n' ? PI : -PI / 2, pick(['#7c3aed', '#ea580c', '#0891b2'])); yield;
      K.table(x - 1.5, z - .5, 1.2, .9, '#a16207'); yield; K.chair(x - 2.5, z - .5, PI / 2); yield; K.chair(x - .5, z - .5, -PI / 2); yield;
      K.box(x + 4.6 * (side === 'n' ? 1 : 0) - (side === 'w' ? 0 : 0), .12, z + (side === 'n' ? -2.2 : 3.6), 1.4, .9, .8, '#e5e7eb', { solid: true }); yield;   // плита
      K.rug(x, z, 4, 3, pick(['#fde68a', '#fecaca', '#bfdbfe'])); yield;
      const door = { x: x + fx * 5.9, z: z + fz * 5.4 }; yield;
      K.houses.push({ id, x, z, door, cook: { x: x + (side === 'n' ? 4.6 : 0), z: z + (side === 'n' ? -1.5 : 2.9) } }); yield;
      K.item({ x: door.x, y: 1.4, z: door.z, r: 1.1, prompt: () => K.rt.city?.kids?.housePrompt(id), act: () => K.rt.city?.kids?.houseAct(id) }); yield;
      K.item({ x: x + (side === 'n' ? 4.6 : 0), y: 1.2, z: z + (side === 'n' ? -1.4 : 2.8), r: 1, prompt: () => '🍳 Приготовить обед', act: () => K.rt.city?.kids?.cookHome() }); yield;
    }
    yield;
    // ── Стройка ──
    K.chunk('site'); yield;
    K.part({ s: 'box', x: 204, y: .03, z: 24, w: 20, h: .03, d: 16, m: M.dirt }); yield;
    for (const [x1, z1, x2, z2] of [[194, 16, 214, 16], [194, 32, 214, 32], [214, 16, 214, 32]]) K.prefab('fence', { x1, z1, x2, z2, c: '#f59e0b' }); yield;
    K.prefab('fence', { x1: 194, z1: 16, x2: 194, z2: 21, c: '#f59e0b' }); yield; K.prefab('fence', { x1: 194, z1: 27, x2: 194, z2: 32, c: '#f59e0b' }); yield;
    for (let i = 0; i < 6; i++) K.part({ s: 'box', x: 197 + (i % 3) * .5, y: .15 + Math.floor(i / 3) * .3, z: 18.5, w: .45, h: .28, d: .9, c: '#c2410c' }); yield;
    spot('k_bricks'); yield;
    K.cyl(212, 0, 30, .3, 12, '#facc15', { solid: true }); yield; K.part({ s: 'box', x: 208, y: 12, z: 30, w: 10, h: .4, d: .4, c: '#facc15' }); yield; K.part({ s: 'cyl', x: 204, y: 10, z: 30, r: .02, h: 4, c: '#374151' }); yield;
    spot('k_site'); yield;
    K.npc({ id: 'k_foreman', name: '👷 Прораб Иван', x: 199, z: 29, yaw: 120, seed: 'prorab', say: ['Каска — обязательно! ⛑️', 'Носи кирпичи на стройку — дом растёт!', 'Строителем можно стать на щите «Работа»'] }); yield;
    yield;
    // ── Восток: ратуша (кабинет будущего мэра), «Радужный дом» (цветной фасад), свободные участки ──
    K.chunk('east'); yield;
    {
      const B = KB('k_hall'); yield;
      const hb = K.building({ id: 'k_hall', x: B.x, z: B.z, w: B.w, d: B.d, h: B.h, wall: B.wall, trim: '#b45309', roofC: B.roof, floor: '#f5e6c8', floorM: M.walk,
        doors: [{ side: 's', at: 0, w: 3.2, h: 3.2 }], windows: [{ side: 's', at: -8, w: 3, h: 2 }, { side: 's', at: 8, w: 3, h: 2 }, { side: 'e', at: 0, w: 4 }, { side: 'w', at: 0, w: 4 }], sign: '🏛️ Ратуша', signBg: '#b45309' }); yield;
      // часовая башня (цветная, видно с площади)
      const rp = p => K.R.part(hb.roof, p); yield;   // башня — в группе крыши (изнутри ратуши прячется вместе с крышей)
      rp({ s: 'box', y: B.h + 3.24, z: -3, w: 5, h: 6, d: 5, c: '#fde68a' }); yield; K.body({ x: B.x, z: B.z - 3, y: B.h + 3.24, hx: 2.5, hy: 3, hz: 2.5, tag: 'tower', data: { cam: false } }); yield;
      rp({ s: 'cone', y: B.h + 7.74, z: -3, r: 3.9, h: 3, seg: 4, yaw: PI / 4, c: '#dc2626' }); yield;
      for (const [s, yaw] of [[1, 0], [-1, PI]]) { rp({ s: 'cyl', y: B.h + 3.6, z: -3 + s * 2.52, r: 1.4, h: .1, rx: PI / 2, c: '#f8fafc', seg: 20 }); yield; rp({ s: 'box', y: B.h + 3.9, z: -3 + s * 2.6, w: .12, h: .8, d: .04, c: '#111827' }); yield; rp({ s: 'box', x: .25, y: B.h + 3.6, z: -3 + s * 2.6, w: .6, h: .1, d: .04, c: '#111827', yaw }); yield; }
      K.counter(B.x, B.z - 2, 7, 1, '#b45309', '#fde68a'); yield;
      mayorOffice(K, B.x - 8, B.z - 5, 'kids'); yield;
      K.box(279, 0, -45.6, .9, 1.9, .6, '#334155', { solid: true }); yield; K.part({ s: 'box', x: 279, y: 1.3, z: -45.92, w: .6, h: .4, d: .02, c: '#22d3ee', m: 'glow' }); yield;   // банкомат
      K.item({ x: 279, y: 1.2, z: -46.6, r: 1, prompt: () => '🏦 Банк: денки, зарплаты и навыки', act: () => K.rt.city?.kids?.bankPanel() }); yield;
      for (const [x, c] of [[B.x - 11, '#facc15'], [B.x + 11, '#60a5fa']]) { K.cyl(x, 0, B.z + B.d / 2 + 2, .06, 4.5, '#d6d3d1'); yield; K.part({ s: 'box', x: x + .55, y: 4, z: B.z + B.d / 2 + 2, w: 1.1, h: .7, d: .03, c }); yield; }
      K.npc({ id: 'k_mayor', name: '🎩 Мэр городка', x: B.x, z: B.z - 3.2, yaw: 0, seed: 'kidmayor', say: ['Добро пожаловать в ратушу! 🏛️', 'Скоро в городке пройдут выборы мэра 🗳️', 'На свободных участках что-нибудь построим вместе!'] }); yield;
      const F = KB('k_flats'); yield;
      K.tower({ id: 'k_flats', name: F.name, type: F.type, x: F.x, z: F.z, w: F.w, d: F.d, h: F.h, style: F.style, tint: F.tint, roof: F.roof, crown: 'pyramid', door: { side: 'n', at: 0 }, roofKind: 'none' }); yield;
      K.label.sign('🌈 Радужный дом', F.x, 2.4, F.z - F.d / 2 - .08, 5, .9, PI, { bg: '#db2777', w: 512, h: 92 }); yield;
      lotSign(K, KB('k_lot1')); yield; lotSign(K, KB('k_lot2')); yield;
      for (const [x, z] of [[256, -36], [288, -36], [254, 16], [289, 16]]) K.tree(x, z, .8, (x + z) % 4); yield;
    }
    yield;
    K.flush(); yield;
    K.done = true; yield;
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
  // Небоскрёбы — фасадом (окна картинкой, ночью светятся), внутрь — холл, лифт 🛗 на этажи и на крышу; мебель этажей — лениво.
  function* buildMetro(K){
    // постройка — кусочками: после каждого оператора — yield (бюджет кадра считает stepBuild в mir-zones.js; одна зона за раз)
    const { R } = K, M = K.M, T = K.T; yield;
    K.spots = spotsOf(K.Z.id); yield;
    const spot = id => K.spots[id]; yield;
    const roofOf = id => MB(id).roof; yield;
    const XS = [150, 215, 280], ZS = [130, 205, 274], X0 = MC.x0, X1 = MC.x1, Z0 = MC.z0, Z1 = MC.z1, CN = MZ.CANAL; yield;
    const nearX = x => XS.some(c => Math.abs(x - c) < 9), nearZ = z => ZS.some(c => Math.abs(z - c) < 9); yield;
    // ── улицы: с запада на восток (под эстакадой улица 274 идёт насквозь), с севера на юг — с мостами через канал ──
    K.chunk('streets'); yield;
    for (const zz of ZS) {
      let a = X0; yield;
      for (const c of XS) { if (zz === 274 && c === 280) continue; yield; K.road(a, zz, c - 4, zz); yield; a = c + 4; yield; }
      K.road(a, zz, X1, zz); yield;
    }
    for (const xx of XS) {
      const segs = xx === 280 ? [[Z0, 126], [134, 201], [209, 212], [336, Z1]] : [[Z0, 126], [134, 201], [209, CN.z0 - 2], [CN.z1 + 2, 270], [278, Z1]]; yield;
      for (const [a, b] of segs) if (b - a > .5) K.road(xx, a, xx, b); yield;
    }
    for (const x of XS) for (const z of ZS) {
      if (x === 280 && z === 274) continue; yield;   // под эстакадой
      K.part({ s: 'box', x, y: .025, z, w: 8, h: .02, d: 8, m: M.asphalt }); yield;
      for (const [dx, dz, yaw] of [[-9, 0, PI / 2], [9, 0, PI / 2], [0, -9, 0], [0, 9, 0]]) { if (x === 280 && z === 205 && dz > 0) continue; yield; K.zebra(x + dx, z + dz, 8, yaw); yield; }
      for (const [sx, sz] of [[-5.4, -5.4], [5.4, 5.4]]) { K.box(x + sx, 0, z + sz, .16, 3.2, .16, '#1f2937', { solid: true }); yield; K.part({ s: 'box', x: x + sx, y: 3.4, z: z + sz, w: .4, h: 1, d: .3, c: '#111827' }); yield; K.part({ s: 'ball', x: x + sx, y: 3.7, z: z + sz + .16, r: .1, c: '#ef4444', m: 'glow' }); yield; K.part({ s: 'ball', x: x + sx, y: 3.1, z: z + sz + .16, r: .1, c: '#22c55e', m: 'glow' }); yield; }
    }
    for (let x = X0 + 10; x < X1 - 2; x += 18) for (const zz of ZS) for (const s of [-1, 1]) if (!nearX(x) && !(zz === 274 && Math.abs(x - 280) < 10)) K.lamp(x, zz + s * 5.6); yield;
    for (let z = Z0 + 8; z < Z1 - 2; z += 18) for (const xx of XS) for (const s of [-1, 1]) if (!nearZ(z) && !(z > CN.z0 - 6 && z < CN.z1 + 6) && !(xx === 280 && z > 208 && z < 338)) K.lamp(xx + s * 5.6, z); yield;
    for (let x = X0 + 18; x < X1 - 6; x += 24) for (const zz of [130, 205]) if (!nearX(x) && Math.abs(x - 298) > 14) K.tree(x + 5, zz + 7.8, .8, (x / 24 | 0) % 4); yield;
    K.board(96, 2.2, 140.2, 3, 1.5, PI, '🏛️ Работа — в мэрии', { bg: '#1e3a8a' }); yield;
    K.box(96, 0, 140.4, .16, 1.5, .16, '#475569', { solid: true }); yield;
    K.item({ x: 96, y: 1.6, z: 139.2, r: 1.2, prompt: () => '🧰 Работа: выбрать профессию', act: () => K.rt.city?.metro?.jobBoard() }); yield;
    yield;
    // ── Мэрия (кабинет будущего мэра) и площадь с фонтаном ──
    K.chunk('hall'); yield;
    K.building({ id: 'm_hall', x: 182, z: 175, w: 28, d: 22, h: 7, wall: '#fef3c7', trim: '#92400e', roofC: roofOf('m_hall'), floor: '#e7d3a8', floorM: M.walk,
      doors: [{ side: 'n', at: 0, w: 3.4, h: 3.6 }], windows: [{ side: 'n', at: -9, w: 3, h: 2.6 }, { side: 'n', at: 9, w: 3, h: 2.6 }, { side: 'e', at: 0, w: 4, h: 2.6 }, { side: 'w', at: 0, w: 4, h: 2.6 }],
      sign: '🏛️ Мэрия', signBg: '#92400e' }); yield;
    for (const x of [172, 177, 187, 192]) K.cyl(x, 0, 163, .45, 6.6, '#f5f5f4', { solid: true }); yield;
    K.counter(182, 180, 8, 1, '#78350f', '#fde68a'); yield;
    K.board(182, 3, 185.8, 5, 2, PI, '📋 Вакансии города', { bg: '#1e3a8a' }); yield;
    K.item({ x: 182, y: 1.3, z: 178.5, r: 1.6, prompt: () => '🧰 Работа: выбрать профессию', act: () => K.rt.city?.metro?.jobBoard() }); yield;
    mayorOffice(K, 172, 181, 'metro'); yield;
    K.npc({ id: 'm_mayor', name: '🎩 Мэр города', x: 182, z: 181.6, yaw: 180, seed: 'mayor1', say: ['Добро пожаловать в Большой город! 🏙️', 'Работа есть для всех — выбирай на стойке', 'Скоро — выборы мэра! 🗳️'] }); yield;
    K.part({ s: 'box', x: 182, y: .03, z: 150, w: 40, h: .03, d: 26, m: M.plaza }); yield;
    K.cyl(182, 0, 150, 3.4, .6, '#d6d3d1', { solid: true, seg: 24 }); yield; K.part({ s: 'cyl', x: 182, y: .34, z: 150, r: 3.1, h: .5, c: '#38bdf8', seg: 24, m: K.R.water('#38bdf8', { key: 'mzmfount', fixedColor: true }) }); yield;
    K.part({ s: 'cyl', x: 182, y: 1.1, z: 150, r: .35, h: 1.6, c: '#e7e5e4' }); yield;
    for (const [x, z, yaw] of [[171, 145, PI / 2], [193, 145, -PI / 2], [171, 155, PI / 2], [193, 155, -PI / 2]]) K.bench(x, z, yaw); yield;
    for (const [x, z] of [[165, 140], [199, 140], [165, 160], [199, 160]]) K.tree(x, z, 1, 1); yield;
    spot('m_fount'); yield;
    yield;
    // ── Полиция и тюрьма ──
    K.chunk('police'); yield;
    K.building({ id: 'm_police', x: 116, z: 152, w: 26, d: 18, h: 5, wall: '#cbd5e1', trim: '#1e3a8a', roofC: roofOf('m_police'), floor: '#e2e8f0', floorType: 'tile', floorM: M.walk,
      doors: [{ side: 'n', at: -4, w: 3 }], windows: [{ side: 'n', at: -10, w: 2.6 }, { side: 'n', at: 4, w: 2.6 }, { side: 'w', at: 0, w: 3 }], sign: '👮 Полиция', signBg: '#1e3a8a' }); yield;
    K.counter(110, 148, 6, 1, '#1e3a8a', '#e2e8f0'); yield;
    for (const x of [118, 123]) { K.table(x, 147, 1.6, .9, '#475569'); yield; K.chair(x, 148, PI); yield; }
    K.box(116, .12, 155, 26 - .6, .1, .1, '#334155'); yield;
    const CELLS = []; yield;
    for (let i = 0; i < 3; i++) {
      const cx = 110 + i * 6, cz = 158; yield;
      K.box(cx - 3, .12, cz, .2, 4.8, 5.4, '#475569', { solid: true, cam: true }); yield;
      for (let k = 0; k < 9; k++) K.part({ s: 'cyl', x: cx - 2.4 + k * .6, y: 1.6, z: 155.3, r: .05, h: 3.2, c: '#94a3b8', seg: 6 }); yield;
      K.body({ x: cx, z: 155.3, y: 1.6, hx: 2.9, hy: 1.6, hz: .12, tag: 'bars', data: { cam: false } }); yield;
      K.box(cx + 1.6, .12, cz + 1.5, 1.6, .5, 1.8, '#64748b', { solid: true }); yield;
      CELLS.push({ x: cx, z: cz - .2 }); yield;
    }
    K.box(125.5, .12, 158, .2, 4.8, 5.4, '#475569', { solid: true, cam: true }); yield;
    K.cells = CELLS; yield; K.jailOut = { x: 112, z: 139 }; yield;
    spot('m_desk'); yield;
    K.npc({ id: 'm_cop', name: '👮 Сержант Петров', x: 110, z: 149.6, yaw: 180, seed: 'petrov', say: ['Полиция Большого города — на страже! 👮', 'Стать полицейским можно в мэрии', 'Грабитель? Подойди ближе и задержи его (держи E)'] }); yield;
    yield;
    // ── Суд ──
    K.chunk('court'); yield;
    K.building({ id: 'm_court', x: 116, z: 184, w: 24, d: 16, h: 5.5, wall: '#f5f5f4', trim: '#57534e', roofC: roofOf('m_court'), floor: '#d6d3d1', floorM: M.walk,
      doors: [{ side: 's', at: 0, w: 3 }], windows: [{ side: 's', at: -8, w: 2.4 }, { side: 's', at: 8, w: 2.4 }, { side: 'e', at: 0, w: 3 }], sign: '⚖️ Суд', signBg: '#57534e' }); yield;
    K.box(116, .12, 179, 6, 1.4, 1.4, '#7c2d12', { solid: true }); yield; K.box(116, 1.52, 179, 6.2, .1, 1.6, '#a16207'); yield;
    K.chair(116, 177.2, 0, '#7c2d12'); yield;
    spot('m_judge'); yield;
    for (let r = 0; r < 3; r++) K.bench(116, 184 + r * 2.4, PI); yield;
    K.box(109, .12, 182, 1.4, 1, 1.4, '#a8a29e', { solid: true }); yield; spot('m_defend'); yield;
    K.npc({ id: 'm_judgeNpc', name: '⚖️ Секретарь суда', x: 122, z: 180, yaw: 270, seed: 'secret', say: ['Встать, суд идёт! ⚖️', 'Судьёй можно стать в мэрии'] }); yield;
    yield;
    // ── Банк ──
    K.chunk('bank'); yield;
    K.building({ id: 'm_bank', x: 246, z: 152, w: 24, d: 18, h: 6, wall: '#e7e5e4', trim: '#166534', roofC: roofOf('m_bank'), floor: '#f5f5f4', floorType: 'tile', floorM: M.walk,
      doors: [{ side: 'n', at: 0, w: 3.2 }], windows: [{ side: 'n', at: -7, w: 3, h: 2.2 }, { side: 'n', at: 7, w: 3, h: 2.2 }], sign: '🏦 Банк', signBg: '#166534' }); yield;
    for (const x of [240, 252]) K.cyl(x, 0, 142.6, .4, 5.4, '#f5f5f4', { solid: true }); yield;
    K.counter(246, 151, 14, 1, '#166534', '#dcfce7'); yield;
    for (const x of [242, 250]) K.part({ s: 'box', x, y: 1.7, z: 151, w: 2.4, h: 1, d: .05, m: K.M.glass }); yield;
    spot('m_teller'); yield; spot('m_client'); yield;
    K.box(246, .12, 159.2, 8, 4, .3, '#64748b', { solid: true, cam: true }); yield;
    K.cyl(246, .12, 159, 1.3, .3, '#94a3b8', { rx: PI / 2 }); yield; K.part({ s: 'torus', x: 246, y: 1.42, z: 158.75, r: .6, t: .08, c: '#facc15' }); yield;
    for (let i = 0; i < 6; i++) K.part({ s: 'box', x: 243 + (i % 3) * .7, y: .32 + Math.floor(i / 3) * .25, z: 160.4, w: .6, h: .22, d: .3, c: '#facc15', metal: .8, rough: .3 }); yield;
    spot('m_vault'); yield;
    K.box(237.2, 0, 141.6, .9, 1.9, .6, '#334155', { solid: true }); yield; K.part({ s: 'box', x: 237.2, y: 1.3, z: 141.28, w: .6, h: .4, d: .02, c: '#22d3ee', m: 'glow' }); yield;
    K.item({ x: 237.2, y: 1.2, z: 140.6, r: 1, prompt: () => '🏧 Банк: денки, зарплаты и навыки', act: () => K.rt.city?.metro?.bankPanel() }); yield;
    K.npc({ id: 'm_teller', name: '🏦 Кассир Анна', x: 246, z: 153, yaw: 180, seed: 'kassir', say: ['Добро пожаловать в банк! 🏦', 'Положить или снять кэш — в банкомате у входа', 'Хотите работать у нас? Вакансии — в мэрии'] }); yield;
    yield;
    // ── Больница ──
    K.chunk('hosp'); yield;
    K.building({ id: 'm_hosp', x: 246, z: 184, w: 22, d: 14, h: 5, wall: '#f8fafc', trim: '#dc2626', roofC: roofOf('m_hosp'), floor: '#e2e8f0', floorType: 'tile', floorM: M.walk,
      doors: [{ side: 's', at: 0, w: 3 }], windows: [{ side: 's', at: -7, w: 2.4 }, { side: 's', at: 7, w: 2.4 }], sign: '🏥 Больница', signBg: '#dc2626' }); yield;
    for (const [i, x] of [238, 242, 250, 254].entries()) { K.bed(x, 179.4, 0, '#bfdbfe'); yield; spot('m_bed' + i); yield; }
    K.counter(246, 186, 4, .9, '#e5e7eb', '#ffffff'); yield; spot('m_meds'); yield;
    K.box(236, .12, 187, .6, 2, 1.6, '#f1f5f9', { solid: true }); yield;
    K.part({ s: 'box', x: 246, y: 5.6, z: 184, w: 6, h: .4, d: 6, c: '#dc2626' }); yield; K.part({ s: 'box', x: 246, y: 5.85, z: 184, w: 4, h: .1, d: 1.2, c: '#f8fafc' }); yield; K.part({ s: 'box', x: 246, y: 5.85, z: 184, w: 1.2, h: .1, d: 4, c: '#f8fafc' }); yield;   // крест на крыше (видно сверху)
    K.npc({ id: 'm_doc', name: '🩺 Доктор Иванова', x: 246, z: 184.6, yaw: 0, seed: 'ivanova', say: ['Здоровья вам! 🩺', 'Больница — место, где все поправляются'] }); yield;
    yield;
    // ── Автосалон, такси, заправка ──
    K.chunk('cars'); yield;
    K.building({ id: 'm_cars', x: 182, z: 112, w: 28, d: 14, h: 5, wall: '#e0f2fe', trim: '#0369a1', roofC: roofOf('m_cars'), floor: '#f1f5f9', floorType: 'tile', floorM: M.walk,
      doors: [{ side: 's', at: 0, w: 4 }], windows: [{ side: 's', at: -9, w: 7, h: 2.6 }, { side: 's', at: 9, w: 7, h: 2.6 }], sign: '🚗 Автосалон', signBg: '#0369a1' }); yield;
    for (const [x, c] of [[172, '#ef4444'], [182, '#2563eb'], [192, '#22c55e']]) { K.cyl(x, .12, 110, 2.6, .2, '#cbd5e1', { seg: 20 }); yield; carModel(K, x, 110, PI / 6, c, .32); yield; }
    spot('m_dealer'); yield;
    K.npc({ id: 'm_dealer', name: '🚗 Продавец машин', x: 186, z: 116.4, yaw: 200, seed: 'automan', say: ['Лучшие машины города! 🚗', 'Тест-драйв — по проспектам, мостам и эстакаде'] }); yield;
    K.item({ x: 182, y: 1.2, z: 117.5, r: 1.6, prompt: () => '🚗 Машины: посмотреть', act: () => K.rt.city?.metro?.dealer() }); yield;
    K.building({ id: 'm_taxi', x: 246, z: 112, w: 20, d: 14, h: 4.5, wall: '#fef9c3', trim: '#a16207', roofC: roofOf('m_taxi'), floor: '#e5e7eb', floorM: M.concrete, floorType: 'concrete',
      doors: [{ side: 's', at: -4, w: 5, h: 3.4 }, { side: 's', at: 5, w: 2.4 }], sign: '🚕 Такси', signBg: '#a16207' }); yield;
    K.npc({ id: 'm_disp', name: '🚕 Диспетчер', x: 250, z: 110, yaw: 180, seed: 'dispet', say: ['Такси! Куда едем? 🚕', 'Таксистом можно стать в мэрии'] }); yield;
    for (const [sx, sz] of [[-7, -3.6], [7, -3.6], [-7, 3.6], [7, 3.6]]) K.box(115 + sx, 0, 113 + sz, .4, 4.4, .4, '#e5e7eb', { solid: true }); yield;
    K.part({ s: 'box', x: 115, y: 4.6, z: 113, w: 16, h: .4, d: 9, c: roofOf('m_gas') }); yield;
    K.label.sign('⛽ Заправка', 115, 4.6, 117.55, 6, .5, 0, { bg: '#b91c1c', w: 512, h: 64 }); yield;
    for (const x of [111, 119]) { K.box(x, 0, 113, .8, 1.6, .6, '#f8fafc', { solid: true }); yield; K.part({ s: 'box', x, y: 1.3, z: 112.68, w: .5, h: .3, d: .02, c: '#22c55e', m: 'glow' }); yield; }
    K.box(126.2, 0, 111, 1, .6, .55, '#dc2626', { solid: true }); yield; K.part({ s: 'box', x: 126.2, y: .68, z: 111, w: .55, h: .08, d: .12, c: '#111827' }); yield; spot('m_tools'); yield;   // ящик механика
    spot('m_pump0'); yield; spot('m_pump1'); yield;
    K.part({ s: 'box', x: 115, y: .03, z: 113, w: 20, h: .02, d: 12, m: M.concrete }); yield;
    yield;
    // ── Супермаркет и ресторан ──
    K.chunk('shops'); yield;
    K.building({ id: 'm_shop', x: 105, z: 234, w: 22, d: 18, h: 5, wall: '#dcfce7', trim: '#15803d', roofC: roofOf('m_shop'), floor: '#f1f5f9', floorType: 'tile', floorM: M.walk,
      doors: [{ side: 'n', at: -3, w: 3.4 }], windows: [{ side: 'n', at: 5, w: 6, h: 2.4 }], sign: '🛒 Супермаркет', signBg: '#15803d' }); yield;
    for (let i = 0; i < 3; i++) K.shelf(100 + i * 5, 238, 3.2, 0); yield;
    K.counter(99, 229, 3, 1, '#15803d', '#dcfce7'); yield; spot('m_till'); yield; spot('m_buyer'); yield;
    K.box(115, .12, 242, 2, 2, 1, '#94a3b8', { solid: true }); yield; spot('m_dock'); yield;
    K.npc({ id: 'm_shopper', name: '🧑 Покупатель', x: 104, z: 236, yaw: 0, seed: 'pokup2', act: 'wander', radius: 4, say: ['Где тут свежий хлеб? 🍞'] }); yield;
    K.item({ x: 99, y: 1.2, z: 227.6, r: 1.2, prompt: () => '🛒 Купить продукты', act: () => K.rt.city?.metro?.shop('m_shop') }); yield;
    for (let i = 0; i < 3; i++) { spot('m_shelf' + i); yield; }
    K.building({ id: 'm_rest', x: 131, z: 234, w: 16, d: 18, h: 4.6, wall: '#fee2e2', trim: '#b91c1c', roofC: roofOf('m_rest'), floor: '#c8956a',
      doors: [{ side: 'n', at: 0, w: 2.8 }], windows: [{ side: 'n', at: -5, w: 2.6 }, { side: 'n', at: 5, w: 2.6 }, { side: 'e', at: 2, w: 3 }], sign: '🍝 Ресторан «Вкусно»', signBg: '#b91c1c' }); yield;
    for (const [x, z] of [[127, 229], [135, 229], [127, 234], [135, 234]]) { K.table(x, z, 1.1, 1.1, '#f8fafc', .76); yield; K.chair(x - 1, z, PI / 2, '#7f1d1d'); yield; K.chair(x + 1, z, -PI / 2, '#7f1d1d'); yield; }
    K.box(131, .12, 241.6, 6, 1, 1, '#9ca3af', { solid: true }); yield; K.part({ s: 'box', x: 129, y: 1.15, z: 241.6, w: 1.4, h: .1, d: .8, c: '#f97316', m: 'glow' }); yield;
    spot('m_stove'); yield; spot('m_fridge'); yield;
    K.box(137.6, .12, 241.8, 1, 2.2, .9, '#e2e8f0', { solid: true }); yield;
    K.npc({ id: 'm_chef', name: '👨‍🍳 Шеф Марко', x: 133, z: 240.4, yaw: 180, seed: 'marko5', say: ['Паста, пицца, суп — всё свежее! 🍝', 'Поваром можно стать в мэрии'] }); yield;
    K.item({ x: 131, y: 1.2, z: 227.4, r: 1.2, prompt: () => '🍝 Заказать еду', act: () => K.rt.city?.metro?.shop('m_rest') }); yield;
    yield;
    // ── Бизнес-центр: три киоска (купить бизнес) ──
    K.chunk('biz'); yield;
    K.part({ s: 'box', x: 182, y: .03, z: 237, w: 50, h: .02, d: 18, m: M.concrete }); yield;
    for (const [id, x, name, c, e] of [['coffee', 166, '☕ Кофейня', '#7c3aed', '☕'], ['flowers', 182, '💐 Цветы', '#db2777', '💐'], ['wash', 198, '🚿 Автомойка', '#0891b2', '🚿']]) {
      K.building({ id: 'm_' + id, x, z: 230, w: 12, d: 10, h: 4, wall: '#f8fafc', trim: c, roofC: roofOf('m_' + id), floor: '#e5e7eb', floorM: M.walk,
        doors: [{ side: 'n', at: 0, w: 2.6 }], windows: [{ side: 'n', at: -3.6, w: 2 }, { side: 'n', at: 3.6, w: 2 }], sign: name, signBg: c }); yield;
      K.counter(x, 232, 4, .9, c, '#ffffff'); yield;
      spot('m_biz_' + id); yield;
      K.item({ x, y: 1.2, z: 224.4, r: 1.2, prompt: () => K.rt.city?.metro?.bizPrompt(id, name), act: () => K.rt.city?.metro?.bizAct(id, name, e) }); yield;
    }
    yield;
    // ── Жилые дома у канала: квартира на 1-м этаже («сделать своим»), этажи выше — фасадом, лифт на крышу ──
    K.chunk('homes'); yield;
    K.houses = []; yield;
    for (const id of ['m_h1', 'm_h2']) {
      const B = MB(id), x = B.x, z = B.z; yield;
      const b = K.building({ id, x, z, w: 14, d: 14, h: 2.96, wall: B.wall, trim: '#57534e', roofC: B.roof, floor: '#d6a77a', doors: [{ side: 'n', at: 0, w: 2.4 }], windows: [{ side: 'n', at: -4.5, w: 2 }, { side: 'n', at: 4.5, w: 2 }, { side: 's', at: 0, w: 3 }] }); yield;
      // этажи выше — генератор интерьеров (квартиры по коридору), первый этаж — эта квартира (skip0), лифт — из угла
      const spec = gen(B, { w: 14, d: 14, y0: 3.2, base0: 3.2, door: { side: 'n', at: 0 }, shellFrom: 3.2, skip0: true, home0: { x: x + 4, z: z + 5.4, y: .12, yaw: PI / 2 } }); yield;
      K.tower(spec, b.roof); yield;
      K.bed(x + 4, z + 3.5, PI, '#93c5fd'); yield; K.sofa(x - 3.5, z + 4.2, PI, '#475569'); yield;
      K.table(x - 3, z - 1, 1.4, .9, '#78350f'); yield; K.chair(x - 4, z - 1, PI / 2); yield; K.chair(x - 2, z - 1, -PI / 2); yield;
      K.box(x + 5.4, .12, z - 3, 1.4, .9, 2, '#e5e7eb', { solid: true }); yield;
      K.rug(x, z + 1, 4, 3, '#bfdbfe'); yield;
      K.houses.push({ id, x, z, door: { x, z: z - 7.4 } }); yield;
      K.item({ x, y: 1.4, z: z - 7.4, r: 1.1, prompt: () => K.rt.city?.metro?.housePrompt(id), act: () => K.rt.city?.metro?.houseAct(id) }); yield;
      K.box(x + 5.6, .12, z + 5.6, 1.6, 2.6, 1.6, '#cbd5e1', { solid: true }); yield;   // лифт в углу квартиры
      K.item({ x: x + 4.4, y: 1.2, z: z + 5.6, r: 1.4, prompt: () => '🛗 Лифт · этажи и крыша', act: () => K.rt.intLiftPanel?.(spec, 0) }); yield;
    }
    K.npc({ id: 'm_walker1', name: '🧑‍💼 Прохожий', x: 182, z: 150, yaw: 0, seed: 'walk01', act: 'wander', radius: 16, phone: 1, say: ['Отличная погода для прогулки!'] }); yield;
    K.npc({ id: 'm_patrol', name: '👮 Патрульный', x: 182, z: 205, yaw: 0, seed: 'patrol', act: 'wander', radius: 26, say: ['Порядок в городе! 👮'] }); yield;
    yield;
    // ── Пожарная часть и свободный участок (северо-восток) ──
    K.chunk('fire'); yield;
    {
      const B = MB('m_fire'); yield;
      K.building({ id: 'm_fire', x: B.x, z: B.z, w: B.w, d: B.d, h: B.h, wall: B.wall, trim: '#991b1b', roofC: B.roof, floor: '#9ca3af', floorType: 'concrete', floorM: M.concrete,
        doors: [{ side: 's', at: -7, w: 6, h: 4.2 }, { side: 's', at: 2, w: 6, h: 4.2 }, { side: 's', at: 9.5, w: 2.4 }], windows: [{ side: 'e', at: 0, w: 4 }, { side: 'w', at: 0, w: 4 }, { side: 'n', at: -6, w: 3 }, { side: 'n', at: 6, w: 3 }], sign: '🚒 Пожарная часть', signBg: '#991b1b' }); yield;
      fireTruck(K, B.x - 7, B.z - 1, 0); yield; fireTruck(K, B.x + 2, B.z - 1, 0); yield;
      spot('m_hose'); yield;
      K.box(B.x + 11, .12, B.z - 5, .3, 2, 2, '#9ca3af', { solid: true }); yield; K.part({ s: 'torus', x: B.x + 10.8, y: 1.3, z: B.z - 5, r: .5, t: .1, yaw: PI / 2, c: '#facc15' }); yield;
      K.npc({ id: 'm_fireman', name: '🚒 Пожарный Сергей', x: B.x + 9, z: B.z + 3, yaw: 180, seed: 'sergey9', say: ['Пожарная часть Большого города! 🚒', 'Скоро и здесь можно будет работать пожарным'] }); yield;
      yield* siteYard(K, MB('m_lot1'), 'm'); yield;
    }
    yield;
    // ── «Сити»: три небоскрёба (в «Сити-1» — холл, лифт на 10 и 20 этаж и на крышу с вертолётной площадкой) ──
    K.chunk('city'); yield;
    {
      const B = MB('m_city1'); yield;
      K.tower(gen(B, { tiers: [{ w: 16, d: 16, h: 108.8 }], crown: 'helipad', base0: 6.4, door: { side: 'n', at: 0, w: 3 }, trim: '#1e3a8a', sign: '🏙️ Сити-1', signBg: '#1e3a8a', special: { 19: 'skycafe' }, roofKind: 'view' })); yield;
      const C2 = MB('m_city2'), C3 = MB('m_city3'); yield;
      K.tower(gen(C2, { base: 'shop', baseH: 3.2, crown: 'antenna', door: { side: 'n', at: 0 }, sign: '🏢 Сити-2', signBg: '#0f172a' })); yield;
      K.tower(gen(C3, { base: 'shop', baseH: 3.2, crown: 'pyramid', logo: '37', door: { side: 's', at: 0 }, sign: '🏢 БЦ «37»', signBg: '#334155' })); yield;
      // площадь «Сити» и сквер с фонтаном
      K.part({ s: 'box', x: 298, y: .03, z: 141, w: 22, h: .03, d: 12, m: M.plaza }); yield;
      K.board(298, 2.4, 136.2, 5, 1.6, PI, '🏙️ «Сити» — деловой квартал', { bg: '#1e3a8a' }); yield; K.box(298, 0, 136.4, .16, 1.6, .16, '#334155', { solid: true }); yield;
      // лаборатория учёных под открытым небом: два стола с микроскопами
      for (const x of [293.5, 302.5]) { K.table(x, 140.5, 1.8, .9, '#e2e8f0'); yield; K.part({ s: 'cyl', x: x - .3, y: 1.02, z: 140.5, r: .12, h: .36, c: '#334155' }); yield; K.part({ s: 'box', x: x + .4, y: .9, z: 140.5, w: .5, h: .08, d: .35, c: '#bae6fd' }); yield; }
      K.label.sign('🔬 Лаборатория «37»', 298, 2.1, 139.2, 4, .7, PI, { bg: '#0f766e', w: 512, h: 90 }); yield;
      spot('m_lab0'); yield; spot('m_lab1'); yield;
      for (const x of [290, 306]) K.bench(x, 143, PI); yield;
      K.part({ s: 'box', x: 298, y: .03, z: 186, w: 22, h: .03, d: 26, m: M.walk }); yield;
      K.cyl(298, 0, 186, 2.8, .5, '#d6d3d1', { solid: true, seg: 20 }); yield; K.part({ s: 'cyl', x: 298, y: .3, z: 186, r: 2.5, h: .4, seg: 20, m: K.R.water('#38bdf8', { key: 'mzcityfount', fixedColor: true }) }); yield;
      for (const [x, z] of [[290, 178], [306, 178], [290, 194], [306, 194]]) K.tree(x, z, .9, 2); yield;
      for (const [x, z, yaw] of [[293, 186, PI / 2], [303, 186, -PI / 2]]) K.bench(x, z, yaw); yield;
      for (let i = 0; i < 3; i++) { spot('m_sample' + i); yield; }
    }
    yield;
    // ── Дома с магазинами внизу (аптека, книжный, спортзал) — фасады ──
    K.chunk('rowshops'); yield;
    for (const id of ['m_pharm', 'm_books', 'm_gym']) {
      const B = MB(id); yield;
      K.tower(gen(B, { base: 'shop', baseH: 3.2, trim: '#334155', door: { side: 'n', at: 0 }, sign: { m_pharm: '💊 Аптека', m_books: '📚 Книги', m_gym: '💪 Спортзал' }[id], signBg: { m_pharm: '#15803d', m_books: '#a16207', m_gym: '#1d4ed8' }[id] })); yield;
    }
    yield;
    // ── ТЦ «Галерея»: 2 этажа, атриум с эскалатором, лифт до крыши; магазины, фуд-корт, кино и автоматы — лениво ──
    K.chunk('mall'); yield;
    {
      const B = MB('m_mall'), x0 = B.x, z0 = B.z, w = B.w, d = B.d, F2 = 5.2; yield;
      const l1 = K.building({ id: 'm_mall', x: x0, z: z0, w, d, h: F2, wall: B.wall, trim: '#0f766e', floor: '#e7e5e4', floorType: 'tile', floorM: M.walk, open: true,
        doors: [{ side: 'n', at: 0, w: 6, h: 3.6 }, { side: 'n', at: -17, w: 3 }, { side: 'n', at: 17, w: 3 }],
        windows: [{ side: 'n', at: -9, w: 8, h: 3, y0: .5 }, { side: 'n', at: 9, w: 8, h: 3, y0: .5 }, { side: 'w', at: 0, w: 14, h: 3, y0: .5 }, { side: 'e', at: 0, w: 14, h: 3, y0: .5 }],
        sign: '🛍️ ТЦ «Галерея»', signBg: '#0f766e' }); yield;
      const hx0 = x0 - 8, hx1 = x0 + 8, hz0 = z0 - 6, hz1 = z0 + 6; yield;   // атриум
      for (const [a, b, c, e] of [[x0 - w / 2, x0 + w / 2, z0 - d / 2, hz0], [x0 - w / 2, x0 + w / 2, hz1, z0 + d / 2], [x0 - w / 2, hx0, hz0, hz1], [hx1, x0 + w / 2, hz0, hz1]]) {
        R.part(l1.roof, { s: 'box', x: (a + b) / 2 - x0, y: F2 - .12, z: (c + e) / 2 - z0, w: b - a, h: .24, d: e - c, m: M.walk }); yield;
        K.body({ x: (a + b) / 2, z: (c + e) / 2, y: F2 - .12, hx: (b - a) / 2, hy: .12, hz: (e - c) / 2, tag: 'deck', data: { cam: false, floor: 'tile' } }); yield;
      }
      // перила атриума (кроме выхода эскалатора на востоке)
      for (const [a, b, c, e] of [[hx0, hx1, hz0 - .05, hz0 + .05], [hx0, hx1 - 3.4, hz1 - .05, hz1 + .05], [hx0 - .05, hx0 + .05, hz0, hz1], [hx1 - .05, hx1 + .05, hz0, hz1 - 3.4]]) {
        R.part(l1.roof, { s: 'box', x: (a + b) / 2 - x0, y: F2 + .5, z: (c + e) / 2 - z0, w: b - a, h: 1, d: e - c, m: K.M.glass }); yield;
        R.part(l1.roof, { s: 'box', x: (a + b) / 2 - x0, y: F2 + 1.02, z: (c + e) / 2 - z0, w: Math.max(b - a, .12), h: .07, d: Math.max(e - c, .12), c: '#94a3b8' }); yield;
        K.body({ x: (a + b) / 2, z: (c + e) / 2, y: F2 + .5, hx: Math.max(b - a, .2) / 2, hy: .5, hz: Math.max(e - c, .2) / 2, tag: 'rail', data: { cam: false } }); yield;
      }
      // эскалатор: пандус с 1-го на 2-й этаж вдоль южного края атриума
      K.prism(hx1 - 7, hz1 - 1.7, 3, 14, F2, -PI / 2, R.mat('#94a3b8', { metal: .3, rough: .4 })); yield;
      for (const s of [-1, 1]) K.part({ s: 'box', x: hx1 - 7, y: F2 / 2 + 1, z: hz1 - 1.7 + s * 1.55, w: Math.hypot(14, F2), h: .1, d: .1, rz: Math.atan2(F2, 14), c: '#1f2937' }); yield;
      for (let k = 1; k < 9; k++) K.part({ s: 'box', x: hx1 - 14 + k * 1.55, y: F2 * k * 1.55 / 14 + .03, z: hz1 - 1.7, w: .06, h: .02, d: 2.8, c: '#facc15', m: 'glow' }); yield;
      // 2-й этаж: стены с окнами (крыша — своя, прячется изнутри)
      const l2 = K.building({ id: 'm_mall2', x: x0, z: z0, w, d, h: F2, y0: F2, into: l1.roof, noFloor: true, wall: B.wall, trim: '#0f766e', roofC: B.roof,
        windows: [{ side: 'n', at: -14, w: 10, h: 2.6 }, { side: 'n', at: 0, w: 10, h: 2.6 }, { side: 'n', at: 14, w: 10, h: 2.6 }, { side: 'e', at: 0, w: 18, h: 2.6 }, { side: 'w', at: 0, w: 18, h: 2.6 }] }); yield;
      // вывески магазинов (внутри, у стен)
      for (const [t, x, z, yaw, c] of [['👕 Одежда', x0 - 18, z0 + d / 2 - .4, PI, '#be185d'], ['👟 Обувь', x0 - 6, z0 + d / 2 - .4, PI, '#7c3aed'], ['📱 Электроника', x0 + 6, z0 + d / 2 - .4, PI, '#0369a1'], ['🧸 Игрушки', x0 + 18, z0 + d / 2 - .4, PI, '#ea580c'], ['🍔 Фуд-корт', x0 - w / 2 + .4, z0, PI / 2, '#b91c1c']])
        K.label.sign(t, x, 3.6, z, 5, .8, yaw, { bg: c, w: 512, h: 82 }); yield;
      for (const [t, x, z, yaw, c] of [['🎬 Кино', x0 - w / 2 + .4, z0 - 9, PI / 2, '#111827'], ['🕹️ Автоматы', x0 + w / 2 - .4, z0 - 9, -PI / 2, '#4c1d95'], ['☕ Кафе', x0 + 6, z0 - d / 2 + .4, 0, '#92400e']])
        K.label.sign(t, x, F2 + 3.4, z, 5, .8, yaw, { bg: c, w: 512, h: 82 }); yield;
      K.lazy(x0, z0, 46, KK => mallFloor1(KK, x0, z0, w, d, hx0, hx1, hz0, hz1)); yield;
      K.lazy(x0, z0, 46, KK => mallFloor2(KK, x0, z0, w, d, hx0, hx1, hz0, hz1), F2, l1.roof); yield;
      // лифт: 1 этаж, 2 этаж, крыша (с видом на канал)
      const ex = x0 + w / 2 - 2.4, ez = z0 + d / 2 - 2; yield;
      K.box(ex + 1, .12, ez + 1, 1.6, 2.6, 1.6, '#cbd5e1', { solid: true }); yield;
      R.part(l1.roof, { s: 'box', x: ex + 1 - x0, y: F2 + 1.3, z: ez + 1 - z0, w: 1.6, h: 2.6, d: 1.6, c: '#cbd5e1' }); yield; K.body({ x: ex + 1, z: ez + 1, y: F2 + 1.3, hx: .8, hy: 1.3, hz: .8, tag: 'lift' }); yield;
      K.addLift('m_mall', B.name, [{ name: '1 этаж — магазины', at: .12, x: ex - 1, z: ez, yaw: PI, ix: ex, iz: ez + .6 }, { name: '2 этаж — кино и автоматы', at: F2, x: ex - 1, z: ez, yaw: PI, ix: ex, iz: ez + .6 },
        { name: 'Крыша — вид на канал', at: 2 * F2 + .24, x: x0, z: z0 + d / 2 - 3, yaw: PI }]); yield;
      void l2; yield;
      K.npc({ id: 'm_mall_guard', name: '🛡️ Охранник ТЦ', x: x0 + 3, z: z0 - d / 2 + 2.4, yaw: 180, seed: 'ohrana', say: ['Добро пожаловать в «Галерею»! 🛍️', 'Эскалатор — в атриуме, лифт — в углу'] }); yield;
    }
    yield;
    // ── Канал: набережные, перила, мосты на проспектах, пешеходные мостики, лестницы к воде, лодки ──
    K.chunk('canal'); yield;
    {
      const zN = CN.z0, zS = CN.z1, gapsN = [[118, 1.9], [150, 6.8], [182, 1.9], [215, 6.8], [248, 1.9], [312, 1.9]]; yield;
      K.part({ s: 'box', x: (X0 + X1) / 2, y: .03, z: zN - 3, w: X1 - X0, h: .04, d: 6, m: M.walk }); yield;   // набережная (север)
      K.part({ s: 'box', x: (X0 + X1) / 2, y: .03, z: zS + 1.7, w: X1 - X0, h: .04, d: 3.4, m: M.walk }); yield;   // набережная (юг)
      // перила вдоль воды (с проходами на мосты)
      for (const zz of [zN - .12, zS + .12]) {
        const cuts = gapsN.map(([x, h]) => [x - h, x + h]).sort((a, b) => a[0] - b[0]); yield;
        let a = X0; yield;
        for (const [l, r] of [...cuts, [X1, X1]]) {
          if (l - a > .5) {
            K.part({ s: 'box', x: (a + l) / 2, y: .95, z: zz, w: l - a, h: .07, d: .07, c: '#475569' }); yield;
            for (let px = a + .5; px < l; px += 2.5) K.part({ s: 'box', x: px, y: .48, z: zz, w: .07, h: .95, d: .07, c: '#475569' }); yield;
            K.body({ x: (a + l) / 2, z: zz, y: .5, hx: (l - a) / 2, hy: .5, hz: .08, tag: 'rail', data: { cam: false } }); yield;
          }
          a = r; yield;
        }
      }
      // мосты на проспектах 150 и 215: дорога, тротуары, перила, арка снизу
      for (const x of [150, 215]) {
        K.box(x, -.62, (zN + zS) / 2, 13.2, .64, zS - zN + 4, '#a8a29e', { solid: true, floor: 'concrete' }); yield;
        K.part({ s: 'box', x, y: .025, z: (zN + zS) / 2, w: 8, h: .02, d: zS - zN + 4, m: M.asphalt }); yield;
        for (const s of [-1, 1]) {
          K.part({ s: 'box', x: x + s * 5.3, y: .08, z: (zN + zS) / 2, w: 2.6, h: .12, d: zS - zN + 4, m: M.walk }); yield;
          K.box(x + s * 6.5, .02, (zN + zS) / 2, .22, 1, zS - zN + 2, '#e2e8f0', { solid: true, data: { cam: false } }); yield;
          K.part({ s: 'torus', x: x + s * 6.3, y: CN.floor, z: (zN + zS) / 2, r: 5.6, t: .3, arc: PI, yaw: PI / 2, c: '#94a3b8' }); yield;
        }
      }
      // пешеходные мостики (арочкой не надо — ровные, с перилами)
      for (const x of [118, 182, 248, 312]) {
        K.box(x, -.3, (zN + zS) / 2, 3.4, .35, zS - zN + 1, '#d6d3d1', { solid: true, floor: 'wood' }); yield;
        K.part({ s: 'box', x, y: .06, z: (zN + zS) / 2, w: 3, h: .02, d: zS - zN + 1, m: M.planks }); yield;
        for (const s of [-1, 1]) K.box(x + s * 1.65, .05, (zN + zS) / 2, .1, .95, zS - zN, '#78350f', { solid: true, data: { cam: false } }); yield;
      }
      // лестницы из воды (вплавь — к ним)
      if (K.E.ladder) for (const x of [134, 198, 264, 326]) {
        K.part({ s: 'box', x, y: CN.wl / 2 - .2, z: zN + .45, w: .8, h: -CN.wl + .5, d: .08, c: '#e5e7eb' }); yield;
        K.E.ladder(K.ph, { x, z: zN + 1, yaw: PI, top: .02, w: .9 }); yield;
        K.part({ s: 'box', x: x + 8, y: CN.wl / 2 - .2, z: zS - .45, w: .8, h: -CN.wl + .5, d: .08, c: '#e5e7eb' }); yield;
        K.E.ladder(K.ph, { x: x + 8, z: zS - 1, yaw: 0, top: .02, w: .9 }); yield;
      }
      // фонари, деревья в кадках, скамейки на северной набережной
      for (let x = X0 + 6; x < X1 - 4; x += 16) if (!gapsN.some(([g, h]) => Math.abs(x - g) < h + 2)) { K.lamp(x, zN - 4.8); yield; }
      for (let x = X0 + 14; x < X1 - 4; x += 32) if (!gapsN.some(([g, h]) => Math.abs(x - g) < h + 4)) { K.bench(x, zN - 2.2, 0); yield; K.cyl(x + 5, 0, zN - 4.6, .7, .6, '#78716c', { solid: true }); yield; K.tree(x + 5, zN - 4.6, .7, 2); yield; }
      // катера у причальной стенки — настоящие (vehicles в описании города)
      K.board(182, 2.2, zN - 5.8, 4.4, 1.4, PI, '🌉 Набережная канала', { bg: '#0e7490' }); yield; K.box(182, 0, zN - 5.6, .16, 1.5, .16, '#334155', { solid: true }); yield;
    }
    yield;
    // ── Эстакада: проспект 280 поднимается над каналом и улицей 274 (z 212…336, верх 6,5) ──
    K.chunk('overpass'); yield;
    {
      const x = 280, OVH = 6.5, ow = 11, L = 36, ang = Math.atan2(OVH, L), conc = M.concrete; yield;
      K.prism(x, 212 + L / 2, ow, L, OVH, PI, conc); yield;        // въезд: низ у z 212, верх у z 248
      K.prism(x, 336 - L / 2, ow, L, OVH, 0, conc); yield;          // съезд: верх у z 300, низ у z 336
      K.box(x, OVH - .7, 274, ow, .7, 52, '#9ca3af', { solid: true, data: { cam: false, floor: 'concrete' } }); yield;   // пролёт z 248…300
      for (const [zc, rx] of [[212 + L / 2, -ang], [336 - L / 2, ang]]) {
        K.part({ s: 'box', x, y: OVH / 2 + .02, z: zc, w: 8, h: .02, d: Math.hypot(L, OVH), rx, m: M.asphalt }); yield;
        for (const s of [-1, 1]) K.part({ s: 'box', x: x + s * (ow / 2 - .15), y: OVH / 2 + .55, z: zc, w: .3, h: .9, d: Math.hypot(L, OVH), rx, c: '#d6d3d1' }); yield;
        // ограждение пандуса — ступеньками (тела коробок не наклоняются)
        for (let k = 0; k < 6; k++) {
          const z1 = zc - L / 2 + (k + .5) * L / 6, f = rx < 0 ? (z1 - (zc - L / 2)) / L : 1 - (z1 - (zc - L / 2)) / L, ys = f * OVH; yield;
          for (const s of [-1, 1]) K.body({ x: x + s * (ow / 2 - .15), z: z1, y: ys + .45, hx: .15, hy: .95, hz: L / 12, tag: 'rail', data: { cam: false } }); yield;
        }
      }
      K.part({ s: 'box', x, y: OVH + .015, z: 274, w: 8, h: .02, d: 52, m: M.asphalt }); yield;
      for (let k = 4; k < 50; k += 5) K.part({ s: 'box', x, y: OVH + .03, z: 248 + k, w: .22, h: .01, d: 2, c: '#f1f5f9' }); yield;
      for (const s of [-1, 1]) { K.box(x + s * (ow / 2 - .15), OVH, 274, .3, 1, 52, '#d6d3d1', { solid: true, data: { cam: false } }); yield; }
      for (const z of [258, 284, 296]) for (const s of [-1, 1]) { const y0 = z < 266 ? CN.floor : 0; yield; K.cyl(x + s * 3.2, y0, z, .7, OVH - .7 - y0, '#a8a29e', { solid: true }); yield; }
      for (const z of [256, 276, 292]) { K.part({ s: 'cyl', x: x - ow / 2 + .5, y: OVH + 2, z, r: .08, h: 4, c: '#2d2a3a', seg: 6 }); yield; K.part({ s: 'ball', x: x - ow / 2 + .5, y: OVH + 4.1, z, r: .26, c: '#fff3b0', m: 'glow', seg: 8 }); yield; }
      K.label.sign('↑ Эстакада', x, OVH + 3.8, 247.8, 3.6, .7, PI, { bg: '#1d4ed8', w: 512, h: 100 }); yield;
    }
    yield;
    // ── ЖК «Солнечный»: три жилых дома (фасады) и двор ──
    K.chunk('flats'); yield;
    for (const id of ['m_flat1', 'm_flat2', 'm_flat3']) {
      const B = MB(id); yield;
      K.tower(gen(B, { base: B.base, baseH: 3.2, door: { side: 'n', at: 0 }, sign: '🏢 ' + B.name.replace('ЖК «Солнечный», ', ''), signBg: '#16a34a' })); yield;
    }
    K.part({ s: 'box', x: 120, y: .03, z: 316, w: 40, h: .03, d: 14, m: M.walk }); yield;
    for (const [x, z] of [[104, 314], [136, 318], [112, 320]]) K.tree(x, z, 1, (x + z) % 4); yield;
    for (const [x, z, yaw] of [[116, 312, 0], [126, 312, 0]]) K.bench(x, z, yaw); yield;
    K.label.sign('🏢 ЖК «Солнечный»', 106, 2.6, 289.92, 6, 1, PI, { bg: '#16a34a', w: 512, h: 86 }); yield;
    yield;
    // ── Телебашня: павильон с лифтом, ствол, смотровая площадка 96 м, антенна до 140 м ──
    K.chunk('tv'); yield;
    {
      const B = MB('m_tv'), x = B.x, z = B.z, D0 = 96, PR = 9; yield;
      const lb = K.building({ id: 'm_tv', x, z, w: 16, d: 16, h: 6.4, wall: '#e5e7eb', trim: '#1e40af', roofC: B.roof, floor: '#e7e5e4', floorType: 'tile', floorM: M.walk,
        doors: [{ side: 'n', at: 0, w: 3.2, h: 3.2 }], windows: [{ side: 'n', at: -5, w: 3, h: 2.6 }, { side: 'n', at: 5, w: 3, h: 2.6 }, { side: 'e', at: 0, w: 6, h: 2.6 }, { side: 'w', at: 0, w: 6, h: 2.6 }], sign: '📡 Телебашня', signBg: '#1e40af' }); yield;
      const g = lb.roof; yield;
      R.part(g, { s: 'cyl', y: 6.64 + (D0 - 6.64) / 2, r: 2.2, r2: 3.6, h: D0 - 6.64, c: '#eef2f7', seg: 16 }); yield;
      K.bodies.push(K.ph.addCyl({ x, z, y: 6.64 + (D0 - 6.64) / 2, r: 3, hy: (D0 - 6.64) / 2, tag: 'tower', data: { cam: true } })); yield;
      for (let k = 1; k < 9; k++) R.part(g, { s: 'cyl', y: 6.64 + k * 10, r: 3.6 - k * .15 + .08, h: 1.4, c: k % 2 ? '#ef4444' : '#f8fafc', seg: 16 }); yield;
      R.part(g, { s: 'cyl', y: D0 - .3, r: PR, h: .6, c: '#94a3b8', seg: 28 }); yield;
      K.bodies.push(K.ph.addCyl({ x, z, y: D0 - .3, r: PR, hy: .3, tag: 'deck', data: { cam: false, floor: 'concrete' } })); yield;
      for (let i = 0; i < 14; i++) {   // стеклянное кольцо (14 панелей)
        const a = i / 14 * PI * 2, th = -a - PI / 2, pw = 2 * PR * Math.sin(PI / 14) + .06, px = Math.cos(a) * (PR - .15), pz = Math.sin(a) * (PR - .15); yield;
        R.part(g, { s: 'box', x: px, y: D0 + 1.7, z: pz, w: pw, h: 3.4, d: .08, yaw: th, m: K.M.glass }); yield;
        K.body({ x: x + px, z: z + pz, y: D0 + 1.7, hx: pw / 2, hy: 1.7, hz: .16, yaw: th, tag: 'glass', data: { cam: false } }); yield;
      }
      R.part(g, { s: 'torus', y: D0 + 1.05, r: PR - .4, t: .05, rx: -PI / 2, c: '#64748b' }); yield;
      const up = new T.Group(); yield; up.userData.dyn = true; yield; g.add(up); yield; K.roofs.push(up); yield;
      R.part(up, { s: 'cyl', y: D0 + 3.6, r: PR + .5, h: .5, c: '#1e40af', seg: 28 }); yield;
      R.part(up, { s: 'cyl', y: D0 + 4.2, r: PR * .7, r2: PR + .2, h: .7, c: '#1e3a8a', seg: 28 }); yield;
      R.part(up, { s: 'cyl', y: D0 + 4.6 + 20, r: .25, r2: 1, h: 40, c: '#e5e7eb', seg: 10 }); yield;
      for (const k of [14, 28]) R.part(up, { s: 'ball', y: D0 + 4.6 + k, r: .3, m: R.glow('#ff3b3b'), seg: 8 }); yield;
      R.part(up, { s: 'ball', y: D0 + 44.8, r: .45, m: R.glow('#ff3b3b'), seg: 8 }); yield;
      K.body({ x, z, y: D0 + 1.7, hx: PR - 1.2, hy: 1.7, hz: PR - 1.2, trigger: true, tag: 'room', data: { room: 'm_tv:deck', roof: up } }); yield;
      K.lazy(x, z, 40, KK => tvDeck(KK, x, z, PR), D0, g); yield;
      K.box(x + 5.6, .12, z + 5.6, 1.6, 2.6, 1.6, '#cbd5e1', { solid: true }); yield;
      K.addLift('m_tv', 'Телебашня', [{ name: 'Вход', at: .12, x: x + 3.6, z: z + 5.4, yaw: PI / 2, ix: x + 4.2, iz: z + 5.6 }, { name: 'Смотровая площадка — 96 м', at: D0, x: x + 5.2, z, yaw: PI / 2, ix: x + 5.6, iz: z + 1.6 }]); yield;
      K.npc({ id: 'm_tv_guide', name: '📡 Экскурсовод', x: x - 4, z: z + 3, yaw: 90, seed: 'ekskurs', say: ['Лифт на смотровую — 96 метров! 📡', 'Сверху видно весь мир: и детский городок, и боевую зону'] }); yield;
      // парк вокруг: дорожки крестом, клумбы, деревья, скамейки
      K.part({ s: 'box', x, y: .025, z: 306, w: 2.6, h: .02, d: 48, m: M.walk }); yield; K.part({ s: 'box', x, y: .025, z: 302, w: 56, h: .02, d: 2.6, m: M.walk }); yield;
      for (const [px, pz] of [[160, 286], [204, 286], [160, 326], [204, 326], [166, 300], [198, 300]]) K.tree(px, pz, 1.1, (px + pz) % 4); yield;
      for (const [px, pz, c] of [[170, 312, '#f472b6'], [194, 312, '#facc15'], [170, 292, '#a78bfa'], [194, 292, '#60a5fa']]) K.prefab('flowers', { x: px, z: pz, seed: px + pz, c }); yield;
      for (const [px, pz, yaw] of [[176, 296, PI], [188, 296, PI], [176, 326, 0], [188, 326, 0]]) K.bench(px, pz, yaw); yield;
      lotSign(K, MB('m_lot2')); yield;
    }
    yield;
    // ── «Гранд Отель»: холл, лифт на 12 этаж (номера) и на крышу с бассейном ──
    K.chunk('hotel'); yield;
    {
      const B = MB('m_hotel'); yield;
      K.tower(gen(B, { base0: 6.4, door: { side: 'n', at: 0, w: 3 }, trim: '#7c2d12', sign: '🏨 Гранд Отель', signBg: '#7c2d12', roofKind: 'pool' })); yield;
    }
    yield;
    // ── Паркинг (3 яруса, пандусы, лифт) ──
    K.chunk('parking'); yield;
    {
      const B = MB('m_park'); yield;
      K.garage({ id: 'm_park', name: B.name, x: B.x, z: B.z, w: B.w, d: B.d, levels: 3, lh: 3.6 }); yield;
      K.label.sign('🅿️ Паркинг', B.x - B.w / 2 - .1, 2.6, B.z + 6, 4, 1, -PI / 2, { bg: '#1d4ed8', w: 512, h: 128 }); yield;
    }
    yield;
    // ── «Денчик-Тауэр» (самый высокий, светящийся венец и «37») и деловой дом «Канал» ──
    K.chunk('towers'); yield;
    {
      const B = MB('m_tower'), O = MB('m_office5'); yield;
      K.tower(gen(B, { tiers: [{ w: 19.2, d: 16, h: 140.8 }], base: 'shop', baseH: 6.4, base0: 6.4, crown: 'glow', glowC: '#a78bfa', logo: '37', door: { side: 'n', at: 0, w: 3 }, roofKind: 'view' })); yield;
      K.tower(gen(O, { base: 'shop', baseH: 3.2, crown: 'antenna', door: { side: 'n', at: 0 }, sign: '🏢 «Канал»', signBg: '#334155' })); yield;
      K.label.sign('🏙️ Денчик-Тауэр', B.x, 5, B.z - B.d / 2 - .1, 8, 1.4, PI, { bg: '#4c1d95', w: 640, h: 112 }); yield;
    }
    yield;
    K.flush(); yield;
    K.done = true; yield;
  }
  // стройка Большого города (строитель, общий этап — от сервера): земля, забор с проходом с юга, кирпичи, кран, щит, прораб
  function* siteYard(K, B){
    const { x, z, w, d } = B, M = K.M, spot = id => K.spots[id]; yield;
    K.part({ s: 'box', x, y: .03, z, w, h: .03, d, m: M.dirt }); yield;
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2; yield;
    for (const [a1, b1, a2, b2] of [[x0, z0, x1, z0], [x0, z0, x0, z1], [x1, z0, x1, z1], [x0, z1, x - 3, z1], [x + 3, z1, x1, z1]]) K.prefab('fence', { x1: a1, z1: b1, x2: a2, z2: b2, c: '#f59e0b' }); yield;
    for (let i = 0; i < 9; i++) K.part({ s: 'box', x: 320.6 + (i % 3) * .5, y: .15 + Math.floor(i / 3) * .3, z: 116, w: .45, h: .28, d: .9, c: '#c2410c' }); yield;
    spot('m_bricks'); yield; spot('m_site'); yield;
    K.cyl(335, 0, 108.4, .3, 14, '#facc15', { solid: true }); yield; K.part({ s: 'box', x: 331, y: 14, z: 108.4, w: 10, h: .4, d: .4, c: '#facc15' }); yield; K.part({ s: 'cyl', x: 328, y: 12, z: 108.4, r: .02, h: 4, c: '#374151' }); yield;
    K.board(x - 6, 1.9, z1 + .3, 3.4, 1.3, PI, '🏗️ Стройка', { bg: '#c2410c' }); yield; K.box(x - 6, 0, z1 + .5, .14, 1.2, .14, '#57534e', { solid: true }); yield;
    K.npc({ id: 'm_foreman', name: '👷 Прораб Степан', x: 322.5, z: 110, yaw: 90, seed: 'prorabm', say: ['Каска — обязательно! ⛑️', 'Носи кирпичи — дом растёт у всех на глазах', 'Строителем можно стать в мэрии'] }); yield;
  }
  // табличка «Свободный участок» (будущий «градостроитель»: здесь можно будет строить) — забор, земля, щит
  function lotSign(K, B){
    const { x, z, w, d } = B, M = K.M;
    K.part({ s: 'box', x, y: .03, z, w, h: .03, d, m: M.dirt });
    for (const [x1, z1, x2, z2] of [[x - w / 2, z - d / 2, x + w / 2, z - d / 2], [x - w / 2, z + d / 2, x + w / 2, z + d / 2], [x - w / 2, z - d / 2, x - w / 2, z + d / 2], [x + w / 2, z - d / 2, x + w / 2, z + d / 2]]) K.prefab('fence', { x1, z1, x2, z2, c: '#a3a3a3' });
    K.board(x, 1.8, z, 3.6, 1.4, PI, '🚧 Свободный участок', { bg: '#65a30d' });
    K.box(x, 0, z + .1, .14, 1.1, .14, '#57534e', { solid: true });
    K.item({ x, y: 1.4, z: z - .8, r: 1.4, prompt: () => '🚧 Свободный участок', act: () => K.rt.H?.panel('<span class="wld-pe">🚧</span><b>Свободный участок</b>', '<p>Здесь пока пусто. Скоро в городе появится градостроитель: участки можно будет занять, построить свой магазин или дом, развивать бизнес — а самый деловой житель станет мэром на выборах. 🗳️</p>') });
  }
  // кабинет мэра (будущие выборы): стол, кресло, флаг, табличка
  function mayorOffice(K, x, z, city){
    K.table(x, z, 2.2, 1, '#78350f', .8); K.chair(x, z + 1, PI, '#7f1d1d');
    K.cyl(x + 1.8, 0, z + 1.4, .05, 2.4, '#d6d3d1'); K.part({ s: 'box', x: x + 2.25, y: 2.1, z: z + 1.4, w: .9, h: .55, d: .03, c: city === 'kids' ? '#facc15' : '#2563eb' });
    K.item({ x, y: 1.2, z: z - .9, r: 1.4, prompt: () => '🗳️ Кабинет мэра', act: () => K.rt.H?.panel('<span class="wld-pe">🗳️</span><b>Кабинет мэра</b>', `<p>${city === 'kids' ? 'В Солнечном городке' : 'В Большом городе'} скоро пройдут <b>выборы мэра</b>. Мэр будет решать, что строить на свободных участках, какие бизнесы открывать и как развивать город.</p><p><small>Готовим «градостроитель» — следи за новостями канала.</small></p><div class="wld-acts"><button type="button" class="ct-start" data-mz="ov:${city}">🏙️ Город сверху (вид мэра)</button></div>`) });
  }
  // мебель этажей (лениво, K.yo — высота этажа): офис, кафе, номера отеля, смотровая, ТЦ



  function tvDeck(K, x0, z0, PR){
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * PI * 2 + PI / 4, x = x0 + Math.cos(a) * (PR - 1.6), z = z0 + Math.sin(a) * (PR - 1.6);
      K.cyl(x, 0, z, .08, 1.1, '#475569'); K.part({ s: 'cyl', x, y: 1.25, z, r: .1, r2: .16, h: .7, rz: PI / 2.4, yaw: -a, c: '#1f2937', seg: 8 });
      K.seat(x - Math.cos(a) * 1.2, .5, z - Math.sin(a) * 1.2, -a + PI / 2, { name: 'Посмотреть в бинокль' });
    }
    K.npc({ id: 'm_tv_deck', name: '📸 Турист', x: x0 + 5, z: z0 - 3, yaw: 0, seed: 'turist96', phone: 1, say: ['Отсюда видно весь мир! 🌍', 'Вон боевая зона — а там детский городок'] });
  }
  function mallFloor1(K, x0, z0, w, d, hx0, hx1, hz0, hz1){
    const zs = z0 + d / 2 - 2.4;   // южная стена: одежда, обувь, электроника, игрушки
    for (const [i, cx] of [x0 - 18, x0 - 6, x0 + 6, x0 + 18].entries()) {
      K.counter(cx, zs - 2.6, 3, .8, ['#be185d', '#7c3aed', '#0369a1', '#ea580c'][i], '#f8fafc');
      if (i === 0) for (let k = 0; k < 3; k++) { K.cyl(cx - 3 + k * 2, 0, zs, .04, 1.6, '#64748b'); for (let j = 0; j < 4; j++) K.part({ s: 'box', x: cx - 3.5 + k * 2 + j * .3, y: 1.1, z: zs, w: .12, h: .9, d: .5, c: ['#f472b6', '#60a5fa', '#facc15', '#34d399'][j] }); }
      if (i === 1) K.shelf(cx, zs + .6, 5, 0, ['#111827', '#f8fafc', '#dc2626', '#2563eb']);
      if (i === 2) for (let k = 0; k < 3; k++) { K.box(cx - 2.4 + k * 2.4, 0, zs, 1.6, .9, .7, '#e5e7eb', { solid: true }); K.part({ s: 'box', x: cx - 2.4 + k * 2.4, y: 1.3, z: zs - .1, w: 1.2, h: .7, d: .05, c: '#38bdf8', m: 'glow' }); }
      if (i === 3) { K.part({ s: 'ball', x: cx - 2, y: .5, z: zs, r: .5, c: '#f87171' }); K.part({ s: 'ball', x: cx, y: .45, z: zs, r: .45, c: '#a78bfa' }); K.part({ s: 'ball', x: cx + 2, y: .7, z: zs, r: .4, c: '#b45309' }); K.part({ s: 'ball', x: cx + 2, y: 1.3, z: zs, r: .3, c: '#b45309' }); }
      K.npc({ id: 'm_mall_s' + i, name: ['👗 Продавщица', '👟 Продавец', '📱 Консультант', '🧸 Продавец игрушек'][i], x: cx, z: zs - 1.6, yaw: 0, seed: 'mallseller' + i, say: [['Новая коллекция! 👕', 'Примерочные справа'], ['Кроссовки для бега 👟'], ['Новые телефоны уже здесь! 📱'], ['Игрушки для всех возрастов 🧸']][i] });
    }
    // фуд-корт: стойки у западной стены, столики под атриумом
    for (const [k, c] of ['#b91c1c', '#ca8a04', '#15803d'].entries()) K.counter(x0 - w / 2 + 1.6, z0 - 6 + k * 6, 1.2, 4, c, '#fef3c7', 0);
    for (const [x, z] of [[x0 - 5, z0 - 3], [x0, z0 - 3], [x0 + 5, z0 - 3], [x0 - 5, z0 + 1], [x0, z0 + 1]]) { K.table(x, z, 1.1, 1.1, '#f8fafc', .76); K.chair(x - 1, z, PI / 2, '#0f766e'); K.chair(x + 1, z, -PI / 2, '#0f766e'); }
    K.item({ x: x0 - w / 2 + 3, y: 1.2, z: z0, r: 1.6, prompt: () => '🍔 Фуд-корт: купить еду', act: () => K.rt.city?.metro?.shop('m_mall') });
  }
  function mallFloor2(K, x0, z0, w, d, hx0, hx1, hz0, hz1){
    // кино: экран у западной стены, ряды кресел (можно сесть)
    K.part({ s: 'box', x: x0 - w / 2 + .5, y: 2.4, z: z0 - 9, w: .1, h: 3, d: 10, c: '#7dd3fc', m: 'glow' });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) K.chair(x0 - w / 2 + 5 + r * 2, z0 - 13 + c * 2.4, -PI / 2, '#7f1d1d');
    // автоматы: игры сайта поверх мира
    for (const [i, g] of ['catch', 'reaction', 'memory', 'fillword'].entries()) {
      const x = x0 + w / 2 - 1.2, z = z0 - 14 + i * 2.6;
      K.box(x, 0, z, 1.2, 2.1, 1.4, ['#7c3aed', '#db2777', '#0891b2', '#16a34a'][i], { solid: true });
      K.part({ s: 'box', x: x - .62, y: 1.45, z, w: .03, h: .7, d: 1, c: '#a5f3fc', m: 'glow' });
      K.item({ x: x - 1.4, y: 1.2, z, r: 1.2, prompt: () => `🕹️ Сыграть: ${(typeof GAMES !== 'undefined' && GAMES.find(q => q.id === g)?.title) || g}`, act: () => K.rt.H?.go?.('#/games/' + g) });
    }
    // кафе: стойка и столики у северной стены
    K.counter(x0 + 6, z0 - d / 2 + 1.6, 6, 1, '#92400e', '#fde68a');
    for (const x of [x0 - 2, x0 + 2, x0 + 10]) { K.table(x, z0 - d / 2 + 5, 1.1, 1.1, '#f8fafc', .76); K.chair(x - 1, z0 - d / 2 + 5, PI / 2, '#92400e'); K.chair(x + 1, z0 - d / 2 + 5, -PI / 2, '#92400e'); }
    K.item({ x: x0 + 6, y: 1.2, z: z0 - d / 2 + 2.8, r: 1.4, prompt: () => '☕ Кафе: заказать', act: () => K.rt.city?.metro?.shop('m_mall') });
  }
  // лодочка (пока стоит у стенки канала)
  function boatSmall(K, x, y, z, c){
    const g = K.group(x, y, z, PI / 2), P = p => K.R.part(g, p);
    P({ s: 'box', y: .15, w: 1.6, h: .5, d: 4, c }); P({ s: 'cone', y: .15, z: 2.3, r: .8, h: .9, rx: PI / 2, seg: 4, c }); P({ s: 'box', y: .5, z: -.6, w: 1.2, h: .25, d: .5, c: '#78350f' });
  }
  // машинка (декорация; ездить — vehicle.js)
  function carModel(K, x, z, yaw, c, y0 = 0){
    const g = K.group(x, y0, z, yaw), P = p => K.R.part(g, p);
    P({ s: 'box', y: .75, w: 2, h: .7, d: 4.2, c }); P({ s: 'box', y: 1.35, z: -.2, w: 1.8, h: .6, d: 2.2, c: '#dbeafe' });
    P({ s: 'box', y: 1.68, z: -.2, w: 1.8, h: .06, d: 2.2, c });
    for (const [sx, sz] of [[-1, 1.3], [1, 1.3], [-1, -1.3], [1, -1.3]]) P({ s: 'cyl', x: sx, y: .4, z: sz, r: .4, h: .3, rz: PI / 2, c: '#111827', seg: 10 });
    for (const s of [-1, 1]) P({ s: 'box', x: s * .6, y: .85, z: 2.12, w: .4, h: .16, d: .04, c: '#fef9c3', m: 'glow' });
    K.body({ x, z, y: y0 + 1, hx: 1, hy: 1, hz: 2.1, yaw, tag: 'car' });
  }

  // остановки такси — на дорогах Большого города (доедет машина): [x, z, куда]
  const TAXI_STOPS = [[182, 134, 'площадь у мэрии'], [246, 134, 'банк'], [120, 134, 'полиция'], [280, 180, 'небоскрёбы «Сити»'], [215, 184, 'больница'],
    [230, 209, 'аптека'], [150, 240, 'ресторан у канала'], [247, 278, 'Гранд Отель'], [150, 300, 'ЖК «Солнечный»'], [313, 209, 'торговый центр']];
  // ═══ Задания по ролям (чистая функция — проверяется в node): шаги { text, at (точка), hold (с), act (поза), carry, icon, … } ═══
  // r — случайность: у работ сервера — от номера задания (MirEcon.rng(n)): после перезагрузки — те же цели
  const shuffle = (a, r) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function taskList(role, city, spots, r = Math.random, biz = []){
    const SP = id => spots[id], P3 = (x, z, y = 1) => ({ x, y, z }), pick = a => a[Math.floor(r() * a.length)];
    const two = n => { const a = Math.floor(r() * n); let b = Math.floor(r() * n); if (b === a) b = (a + 1) % n; return [a, b]; };
    switch (role) {
      case 'baker': { const c = pick(K_CUST); return [
        { text: 'Возьми муку на складе', at: SP('k_flour'), hold: 1, icon: '🌾' },
        { text: 'Замеси тесто', at: SP('k_dough'), hold: 2, act: 'cook', icon: '🥣', carry: 'flour' },
        { text: 'Испеки булочки в печи', at: SP('k_oven'), hold: 3, act: 'cook', icon: '🔥', fx: 'oven' },
        { text: 'Отнеси булочки жителю', at: P3(c[0], c[1]), carry: 'bun', icon: '🙋', cust: true, done: 'Спасибо, вкусно!' }]; }
      case 'icecream': { const L = []; for (let i = 0; i < 3; i++) L.push(
        { text: `Набери мороженое (${i + 1}/3)`, at: SP('k_freezer'), hold: 2.5, act: 'cook', icon: '🍨' },
        { text: `Отдай мороженое покупателю (${i + 1}/3)`, at: SP('k_icecounter'), hold: 1, icon: '🙋', carry: 'icecream', cust2: SP('k_icewin'), done: i === 2 ? 'Все покупатели довольны! 🍦' : '' }); return L; }
      case 'fireman': case 'fire_m': { const f = pick(city === 'kids' ? K_FIRES : M_FIRES), h = SP(city === 'kids' ? 'k_hose' : 'm_hose'); return [
        { text: 'Возьми шланг в пожарной части', at: h, hold: 1, icon: '🧯' },
        { text: 'Пожар! Беги и потуши его (держи E)', at: P3(f[0], f[1]), hold: 3.2, act: 'hose', icon: '🔥', fire: true },
        { text: 'Верни шланг в пожарную часть', at: h, hold: .8, icon: '🧯', done: 'Огонь потушен! 🚒' }]; }
      case 'doctor': case 'medic': { const kids = city === 'kids', med = SP(kids ? 'k_med' : 'm_meds'), L = [];
        two(kids ? 3 : 4).forEach((i, k) => { const bed = SP((kids ? 'k_bed' : 'm_bed') + i); L.push(
          { text: `Осмотри пациента (${k + 1}/2)`, at: bed, hold: 2.5, act: 'heal', icon: '🤒', patient: true },
          { text: `Возьми лекарство в шкафу (${k + 1}/2)`, at: med, hold: 1.2, icon: '💊' },
          { text: `Дай лекарство пациенту (${k + 1}/2)`, at: bed, hold: 1.5, act: 'heal', icon: '🤒', carry: 'med', patient: true, done: k ? 'Пациенты здоровы! ✨' : '' }); });
        return L; }
      case 'vet': { const p = pick(K_PETS); return [
        { text: 'Найди приболевшего питомца', at: P3(p[0], p[1], .5), hold: 1, icon: '🐶', sick: true },
        { text: 'Отнеси питомца в ветклинику', at: SP('k_vettable'), hold: 2.5, act: 'heal', icon: '🩹', carry: 'pet', done: 'Питомец здоров и весел! 🐾' }]; }
      case 'builder': case 'builder_m': { const kids = city === 'kids', b = SP(kids ? 'k_bricks' : 'm_bricks'), s = SP(kids ? 'k_site' : 'm_site'), L = [];
        for (let i = 0; i < 4; i++) L.push({ text: `Возьми кирпичи (${i + 1}/4)`, at: b, hold: 1, icon: '🧱' },
          { text: `Положи кирпичи на стройку (${i + 1}/4)`, at: s, hold: 1.2, act: 'fix', icon: '🏗️', carry: 'brick', done: i === 3 ? 'Стройка растёт! 🏗️' : '' });
        return L; }
      case 'teacher': { const L = [{ text: 'Напиши тему урока на доске', at: SP('k_board'), hold: 2.5, act: 'fix', icon: '✏️' }];
        shuffle([0, 1, 2, 3], r).forEach((i, k) => { const d = SP('k_desk' + i); L.push({ text: `Проверь тетрадь ученика (${k + 1}/4)`, at: d, hold: 1.5, act: 'heal', icon: '📓', cust2: d && P3(d.x, d.z + 1.9, .6), custE: '🧒' }); });
        L.push({ text: 'Объясни ответы у доски', at: SP('k_board'), hold: 2, act: 'fix', icon: '👩‍🏫', done: 'Урок окончен — все поняли! 📚' });
        return L; }
      case 'scientist': { const [a, b] = two(3); return [
        { text: 'Возьми пробу воздуха в сквере «Сити» (1/2)', at: SP('m_sample' + a), hold: 2, act: 'heal', icon: '🧪' },
        { text: 'Возьми вторую пробу (2/2)', at: SP('m_sample' + b), hold: 2, act: 'heal', icon: '🧪', carry: 'sample' },
        { text: 'Изучи пробы под микроскопом на площади «Сити»', at: SP('m_lab0'), hold: 3, act: 'cook', icon: '🔬', carry: 'sample' },
        { text: 'Запиши открытие в журнал', at: SP('m_lab1'), hold: 1.5, act: 'cook', icon: '📒', done: 'Открытие! Город гордится тобой 🔬' }]; }
      case 'mech': { const [a, b] = two(K_FIX.length), t = SP('k_tools'); return [
        { text: 'Возьми ящик с инструментами', at: t, hold: 1, icon: '🧰' },
        { text: `Почини ${K_FIX[a][2]} (держи E)`, at: P3(K_FIX[a][0], K_FIX[a][1]), hold: 3, act: 'fix', icon: '🔧', carry: 'tools' },
        { text: `Почини ${K_FIX[b][2]} (держи E)`, at: P3(K_FIX[b][0], K_FIX[b][1]), hold: 3, act: 'fix', icon: '🔧', carry: 'tools' },
        { text: 'Верни инструменты на место', at: t, hold: .8, icon: '🧰', carry: 'tools', done: 'Площадка как новая! 🔧' }]; }
      case 'mech_m': { const [a, b] = two(2), t = SP('m_tools'); return [
        { text: 'Возьми инструменты', at: t, hold: 1, icon: '🧰' },
        { text: 'Почини машину у колонки (держи E)', at: SP('m_pump' + a), hold: 3, act: 'fix', icon: '🔧', carry: 'tools', cust: true, custE: '🚗' },
        { text: 'Почини вторую машину (держи E)', at: SP('m_pump' + b), hold: 3, act: 'fix', icon: '🔧', carry: 'tools', cust: true, custE: '🚙' },
        { text: 'Верни инструменты', at: t, hold: .8, icon: '🧰', carry: 'tools', done: 'Машины как новые! 🔧' }]; }
      case 'police': {
        if (r() < .5) { const L = shuffle([[130, 125], [205, 140], [232, 200], [160, 212], [100, 200]], r).slice(0, 3); return L.map((p, i) => ({ text: `Патруль: дойди до точки ${i + 1}/3`, at: P3(p[0], p[1]), icon: '🚨', walk: true })); }
        const s = pick([[99, 227, 'в супермаркете'], [166, 224, 'у кофейни'], [131, 226, 'у ресторана']]);
        return [{ text: `Ограбление ${s[2]}! Задержи грабителя (держи E)`, at: P3(s[0], s[1]), hold: 1.6, icon: '🦹', robber: true, done: 'Грабитель задержан! 👮' }]; }
      case 'robber': { const o = r() < .25 ? ['Взломай хранилище банка! (держи E)', 'm_vault', 6] : r() < .5 ? ['Ограбь кассу кофейни (держи E)', 'm_biz_coffee', 3] : ['Ограбь кассу супермаркета (держи E)', 'm_till', 3];
        return [{ text: o[0], at: SP(o[1]), hold: o[2], icon: '💰', rob: 1 }]; }
      case 'cashier': { const L = []; for (let i = 0; i < 2; i++) L.push(
        { text: `Прими заявку клиента (${i + 1}/2)`, at: SP('m_teller'), hold: 1.2, icon: '🙋', act: 'cook', cust2: SP('m_client') },
        { text: `Возьми деньги в хранилище (${i + 1}/2)`, at: SP('m_vault'), hold: 1.5, icon: '💰' },
        { text: `Выдай деньги клиенту (${i + 1}/2)`, at: SP('m_teller'), hold: 1, icon: '🙋', act: 'cook', carry: 'money', cust2: SP('m_client'), done: i ? 'Клиенты довольны! 🏦' : '' }); return L; }
      case 'seller': { const L = []; for (let i = 0; i < 3; i++) L.push(
        { text: `Возьми товар с полки (${i + 1}/3)`, at: SP('m_shelf' + Math.floor(r() * 3)), hold: 1, icon: '📦' },
        { text: `Пробей покупку на кассе (${i + 1}/3)`, at: SP('m_till'), hold: 1.8, icon: '🛒', act: 'cook', carry: 'box', cust2: SP('m_buyer'), done: i === 2 ? 'Очередь пуста — отлично! 🛒' : '' }); return L; }
      case 'cook': { const T4 = [[127, 229], [135, 229], [127, 234], [135, 234]], L = [];
        two(4).forEach((t, k) => L.push(
          { text: `Возьми продукты из холодильника (${k + 1}/2)`, at: SP('m_fridge'), hold: 1, icon: '🥩' },
          { text: `Приготовь блюдо на плите (${k + 1}/2)`, at: SP('m_stove'), hold: 3, act: 'cook', icon: '🍳', carry: 'food' },
          { text: `Подай блюдо гостю (${k + 1}/2)`, at: P3(T4[t][0], T4[t][1]), hold: .8, icon: '🙋', carry: 'food', cust: true, done: k ? 'Гости довольны! ⭐⭐⭐⭐⭐' : '' }));
        return L; }
      case 'judge': return [{ text: 'Подсудимый ждёт: займи место судьи', at: SP('m_judge'), hold: 1.5, icon: '⚖️', trial: true }];
      case 'biz': { if (!biz.length) return [{ text: 'Купи бизнес в бизнес-центре (киоски на юге)', at: P3(182, 224), icon: '💼', walk: true, nobiz: true }];
        const b = pick(biz); return [{ text: 'Закупи товар на складе супермаркета', at: SP('m_dock'), hold: 1.2, icon: '📦' }, { text: 'Привези товар в свой бизнес', at: SP('m_biz_' + b), hold: 1.2, icon: '💼', carry: 'box', done: 'Полки полные — продажи растут! 📈' }]; }
      case 'taxi': {   // таксист: за руль такси → забери пассажира → отвези (остановки — у дорог, доедет машина)
        const a = pick(TAXI_STOPS); let b = pick(TAXI_STOPS); for (let i = 0; i < 6 && b === a; i++) b = pick(TAXI_STOPS);
        if (b === a) b = TAXI_STOPS[(TAXI_STOPS.indexOf(a) + 1) % TAXI_STOPS.length];
        return [
          { text: 'Сядь за руль такси (стоянка у «Такси»)', at: P3(246, 124), drive: 'taxi', any: true, icon: '🚕' },
          { text: `Забери пассажира: ${a[2]}`, at: P3(a[0], a[1]), drive: 'taxi', icon: '🙋', cust: true },
          { text: `Отвези пассажира: ${b[2]}`, at: P3(b[0], b[1]), drive: 'taxi', icon: '🏁', done: 'Пассажир доволен — чаевые! 💵' }]; }
    }
    return null;
  }
  // какую роль показать для работы сервера (врач и ветеринар — одна профессия в одном здании: запомненный выбор)
  function roleFor(job, city){
    const R = city === 'kids' ? ROLES_K : ROLES_M;
    let mem = null; try { mem = JSON.parse(root.localStorage?.getItem('d37_city_role') || 'null'); } catch (e) {}
    const want = mem && mem[job.prof + '@' + job.place];
    if (want && R[want] && R[want].prof === job.prof && R[want].place === job.place) return want;
    return Object.keys(R).find(id => R[id].prof === job.prof && R[id].place === job.place) || null;
  }
  function rememberRole(id, R0){
    try { const m = JSON.parse(root.localStorage?.getItem('d37_city_role') || '{}') || {}; m[R0.prof + '@' + R0.place] = id; root.localStorage?.setItem('d37_city_role', JSON.stringify(m)); } catch (e) {}
  }
  // этап общей стройки: 0 — пусто, 1 — фундамент, 2–3 — стены, 4 — крыша (детали склеены в одну сетку)
  function siteParts(n){
    const L = [];
    if (n >= 1) L.push({ s: 'box', y: .25, w: 8, h: .5, d: 6, c: '#9ca3af' });
    if (n >= 2) for (const [x, z, w, d] of [[0, -3, 8, .4], [0, 3, 8, .4], [-4, 0, .4, 6], [4, 0, .4, 6]]) L.push({ s: 'box', x, z, y: .5 + (n >= 3 ? 1.2 : .6), w, h: n >= 3 ? 2.4 : 1.2, d, c: '#c2410c' });
    if (n >= 4) L.push({ s: 'box', y: 3.2, w: 8.6, h: .3, d: 6.6, c: '#7c2d12' });
    return L;
  }

  // ═══ ИГРА В ГОРОДЕ: щиты, роли, задания, магазины, дома, полиция и грабители ═══
  function cityMod(rt, K, city){
    const S = rt.S, R = rt.R, T = rt.T, X = rt.X, Z = MZ.ZONES[city];
    const ROLES = city === 'kids' ? ROLES_K : ROLES_M;
    const H = rt.H, toast = rt.toast;
    const E = ECON(), A = E ? E.api : null;
    rt.city = rt.city || {};
    rt.CARRY = Object.assign(rt.CARRY || {}, CARRY);
    Object.assign(rt.FOOD, MZ.FOOD_EXTRA);
    const C = { city, K, job: null, step: 0, task: null, srv: false, fin: null, fires: [], cust: null, wantedT: 0, prisonT: 0, here: false, pubT: 0, ctyT: 0, leftT: 0, siteN: null, stopped: false };
    const fmt = n => (E ? E.fmt(n) : String(n | 0));
    // «сдать работу»: не раньше минимального времени задания (MirEcon.TaskRunner, шаги логики 1/60 с)
    C.run = E ? E.TaskRunner({ clock: () => A.clock(), send: n => A.act('task', { n }), after: r => { if (!C.stopped) onTask(r); } }) : null;
    // кошелёк — слева сверху, пока ты в городе (💵 — открыть 🏦 Банк)
    const wEl = document.createElement('div'); wEl.className = 'mz-wallet'; wEl.hidden = true; rt.hud.appendChild(wEl);
    function drawWallet(){
      const R0 = ROLES[rt.zx.r];
      if (!A) { wEl.innerHTML = R0 ? `<span>${R0.icon} ${esc(R0.name)}</span>` : ''; return; }
      const st = A.st, sk = R0?.prof ? E.ui.skill(A.D, st, R0.prof) : null, bf = E.Rules.buffP(A.D, st, A.clock());
      wEl.innerHTML = `<button type="button" class="mz-wbank" data-mz="c:${city}:bank" title="🏦 Банк: денки, зарплаты, навыки">💵 ${fmt(st.cash)}${A.mode === 'server' ? '' : ' <em title="пробные — только в этом браузере">🧪</em>'}</button>${R0 ? `<span>${R0.icon} ${esc(R0.name)}${sk ? ` <em class="mz-stars">${'★'.repeat(sk.L + 1)}</em>` : ''}</span>` : ''}${bf ? `<span>🍽 +${bf} %</span>` : ''}`;
    }
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
    const tasksFor = (role, r) => taskList(role, city, K.spots, r || Math.random, []);
    // ── работа: выбрать (сервер выдаёт номер задания), шаг, сдать ──
    async function setJob(role, quiet){
      if (role && !ROLES[role]) return;
      const R0 = role ? ROLES[role] : null;
      if (R0?.soon) { toast(`${R0.icon} ${R0.name} — скоро: свой бизнес появится в городе позже`); return; }
      if (R0?.car && !root.D37E?.vehicle) { toast(`${R0.icon} ${R0.name}: такси поедет, когда в мире появятся машины — скоро!`); return; }
      endTask(true);
      const was = C.job;
      if (!role) {
        C.job = null; rt.setZX({ r: null, a: null, w: null }); drawWallet();
        if (A && was && ROLES[was]?.prof && A.st.job) A.act('quit');
        if (!quiet) toast('Ты свободен — без работы');
        return;
      }
      if (R0.rp) {   // роль без денег — сразу (и работу сервера, если была, — закончить)
        if (A && A.st.job) A.act('quit');
        C.job = role; rt.setZX({ r: role, a: null, w: null }); drawWallet();
        toast(`${R0.icon} Ты — ${R0.name}! ${R0.desc}`, true);
        setTimeout(() => { if (C.job === role && !C.task) nextTask(); }, 900);
        return;
      }
      if (!A) { toast('Работа заработает, когда сайт обновится'); return; }
      C.pend = true;
      const r = await A.act('job', { city, prof: R0.prof, mode: 'city', place: R0.place });
      C.pend = false;
      if (C.stopped) return;
      if (!r.ok) { toast(E.why(r), false); rt.sfx('buzz'); drawWallet(); return; }
      rememberRole(role, R0);
      C.job = role; rt.setZX({ r: role, a: null, w: null }); drawWallet();
      toast(r.got?.grant ? `🎁 Подарок новичку: +${r.got.grant} 💵! ${R0.icon} Ты — ${R0.name}` : `${R0.icon} Ты — ${R0.name}! ${R0.desc}`, true);
      setTimeout(() => { if (C.job === role && !C.task) nextTask(); }, 900);
    }
    // вернулся (перезагрузка, другая вкладка) — продолжаем ту же работу с тем же заданием
    function resume(){
      if (!A || C.job || C.pend || C.stopped) return;
      const J = A.st.job; if (!J || J.city !== city) return;
      const role = roleFor(J, city); if (!role) return;
      C.job = role; rt.setZX({ r: role, a: null, w: null }); drawWallet();
      toast(`${ROLES[role].icon} Продолжаем работу: ${ROLES[role].name}`, true);
      nextTask();
    }
    function nextTask(){
      if (!C.job || C.task || C.stopped) return;
      const R0 = ROLES[C.job];
      if (R0.rp) { const L = tasksFor(C.job); if (!L?.length) return; C.task = L; C.step = 0; C.srv = false; showStep(); return; }
      const J = A?.st.job;
      if (!J || J.city !== city || J.prof !== R0.prof || J.place !== R0.place) { setJob(null, true); return; }
      const L = tasksFor(C.job, E.rng(J.n)); if (!L?.length) return;
      C.task = L; C.step = 0; C.srv = true; C.fin = null;
      C.run.begin(J.n, J.t, E.Rules.minS(A.D, R0.prof, E.Rules.lvl(A.D, A.st.skills[R0.prof] | 0)), L.length);
      showStep();
    }
    function showStep(){
      const st = C.task?.[C.step];
      if (!st) return;
      if (st.carry && C.step > 0) rt.setZX({ a: 'carry', w: st.carry }); else if (!st.carry) rt.setZX({ a: rt.zx.a === 'carry' ? null : rt.zx.a, w: rt.zx.a === 'carry' ? null : rt.zx.w });
      if (st.fire) startFire(st.at);
      patient(st.at, !!st.patient);
      if (st.sick) sickPet(st.at, true);
      if (st.cust || st.cust2 || st.robber) customer(st.cust2 || st.at, st.robber ? '🦹' : st.custE || '🙋');
      else if (st.drive && C.step > 0) { customer(null); toast('🚕 Пассажир в машине — вези!', true); }   // такси: пассажир сел
      else customer(null);
      if (st.trial) customer(SP('m_defend'), '🦹');
      if (st.walk || st.drive) setTarget(st.at, st.icon, null, 0, () => {});   // дойти / доехать — шаг засчитается сам
      else setTarget(st.at, st.icon, `${st.icon} ${st.text}`, st.hold, () => stepDone());
      drawTask();
    }
    function stepDone(){
      const st = C.task?.[C.step]; if (!st) return;
      rt.sfx('click');
      if (st.fx === 'oven') burst(st.at, 'sparkles', '#ffb347');
      if (st.fire) stopFire(true);
      if (st.sick) sickPet(null);
      if (st.rob) return robDone(st);
      if (st.trial) return trialPanel();
      if (st.nobiz) { endTask(); return; }
      C.step++;
      if (C.srv) C.run.done();
      if (C.step >= C.task.length) return taskDone(st);
      showStep();
    }
    function taskDone(last){
      const role = C.job, R0 = ROLES[role] || {};
      if (!C.srv) {   // роль без денег: только 🪙 за работу (как раньше)
        endTask();
        if (last?.done) toast(last.done, true);
        burst(S.P.ch, 'confetti');
        rt.payTask(R0.name);
        setTimeout(() => { if (C.job === role && !C.task) nextTask(); }, 2600);
        return;
      }
      C.fin = last || {};   // шаги сделаны — TaskRunner сдаст работу, когда пройдёт минимальное время задания
      clearMarks(); setTarget(null);
      if (rt.zx.a === 'carry') rt.setZX({ a: null, w: null });
      drawTask();
    }
    function onTask(r){
      const role = C.job, R0 = ROLES[role] || {};
      if (!C.task || !C.srv) return;
      if (r.ok) {
        const fin = C.fin;
        endTask();
        burst(S.P.ch, 'confetti');
        const g = r.got || {}, sk = E.ui.skill(A.D, A.st, R0.prof);
        toast(`${fin?.done ? fin.done + ' ' : ''}+${g.net} 💵${g.rate < 100 ? ` (ставка города ${g.rate} %)` : ''} · ${R0.name} ${'★'.repeat(sk.L + 1)}${sk.next ? ` ${sk.xp}/${sk.next}` : ''}`, true);
        if (g.up) setTimeout(() => toast(`🎉 Новый уровень: ${E.ui.lvlName(g.lvl)} — зарплата выше!`, true), 1200);
        if (g.tired && !C.tiredHint) { C.tiredHint = true; setTimeout(() => toast('😮‍💨 Устал от этой работы: дальше — половина зарплаты. Смени профессию!'), 2400); }
        rt.sfx('coin');
        rt.payTask(R0.name);
        if (r.c) onPub(r.c, true);
        C.netN = 0;
        setTimeout(() => { if (C.job === role && !C.task) nextTask(); }, 2600);
        return;
      }
      if (r.reason === 'too_soon') { C.run.retry((r.wait || 1) + .3); return; }
      if (r.reason === 'net' && (C.netN = (C.netN || 0) + 1) <= 5) { C.run.retry(3); if (C.netN === 1) toast('📡 Нет связи — сдадим работу ещё раз'); return; }
      C.netN = 0;
      if (r.reason === 'nonce') { toast(E.why(r)); endTask(true); A.init(true).then(() => { if (!C.stopped && C.job === role && !C.task) nextTask(); }); return; }
      toast(E.why(r), false); rt.sfx('buzz');
      endTask(true);
      setJob(null, true);
    }
    function endTask(quiet){
      if (C.fireOn) stopFire(false);
      clearMarks();
      C.task = null; C.step = 0; C.fin = null;
      C.run?.stop();
      setTarget(null);
      if (rt.zx.a === 'carry' || rt.zx.a === 'hose' || rt.zx.a === 'heal' || rt.zx.a === 'fix' || rt.zx.a === 'cook') rt.setZX({ a: null, w: null });
      drawTask();
    }
    function drawTask(){
      const el = rt.q('.mz-task');
      if (!C.task || !inCity()) { if (el.dataset.city === city) { el.hidden = true; el.dataset.city = ''; } return; }
      const st = C.task[C.step], R0 = ROLES[C.job];
      el.dataset.city = city; el.hidden = false;
      const txt = st ? esc(st.text) : C.run?.st === 'sent' ? 'сдаём работу…' : '⏳ работа готова — сдаём через <b class="mz-left"></b>';
      el.innerHTML = `<span>${R0.icon} <b>${esc(R0.name)}:</b> ${txt}</span><span class="mz-dist"></span><button type="button" data-mz="c:${city}:quit">Уйти с работы</button>`;
      C.leftT = 0; C.distEl = null; C.distK = NaN;
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
      if (win && C.task) { const p = C.task[C.step]?.at; if (p) burst(p, 'bubbles', '#bae6fd'); }
    }
    function burst(p, kind, color){
      if (!FX || !p) return;
      const e = FX.emitter({ kind, at: [p.x, (p.y || 0) + .8, p.z], rate: 0, color, color2: color });
      e.burst?.(kind === 'confetti' ? 40 : 26);
      setTimeout(() => { try { e.dispose(); } catch (er) {} }, 3500);
    }
    // ── значки-«люди» для заданий (пациент на кровати, покупатель, питомец, ученик, машина) — спрайты, без лишних человечков ──
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
    const clearMarks = () => { patient(null); sickPet(null); customer(null); };
    // ── общая стройка: этап — от сервера (у всех одинаковый); склеено в одну сетку ──
    const siteAt = city === 'kids' ? SP('k_site') : SP('m_site');
    const site = siteAt ? new T.Group() : null;
    if (site) { site.position.set(siteAt.x, 0, siteAt.z); R.scene.add(site); }
    function siteDraw(n){
      if (!site || n === C.siteN) return;
      C.siteN = n;
      for (const m of site.children) if (m.userData.mzOwn) m.geometry.dispose();
      site.clear();
      for (const p of siteParts(n)) R.part(site, p);
      if (site.children.length) MZ.merge(R, site, { ao: false });
      R.shadowsOn?.(site); R.shadowDirty?.();
    }
    function onPub(p, mine){
      if (!p || p.city !== city) return;
      C.hire = p.hire !== false && !p.frozen;
      if (p.stage == null) return;
      const old = C.siteN;
      siteDraw(p.stage);
      if (mine && old != null && p.stage !== old) {
        const t = now(); if (t - C.ctyT > 60e3) { C.ctyT = t; rt.send({ k: 'cty', c: city, r: p.rev | 0 }); }   // другим — перечитать город (не чаще раза в минуту)
        toast(p.stage === 0 ? '🏠 Дом достроен! Начинаем новый' : `🏗️ Стройка: этап ${p.stage} из ${A.D.site.stages - 1}`, true);
      }
    }
    // ── пожарный: распылитель, пока держишь E у огня ──
    let sprayE = null;
    const WORK_POSE = ['cook', 'heal', 'fix'];
    function sprayTick(){
      const st = C.task?.[C.step], holding = !!(st?.fire && X.cur === jobItem && X.progress > 0);
      if (holding && !sprayE && FX) { const p = st.at; sprayE = FX.emitter({ kind: 'fountain', at: [p.x, .3, p.z], rate: 1.4, size: 1.2, color: '#e0f2fe', color2: '#7dd3fc' }); rt.setZX({ a: 'hose' }); }
      else if (!holding && sprayE) { sprayE.dispose(); sprayE = null; if (rt.zx.a === 'hose') rt.setZX({ a: null }); }
      // во время удержания у плиты/кровати — поза работы
      const act = st && X.cur === jobItem && X.progress > 0 ? st.act : null;
      if (act && act !== 'hose' && rt.zx.a !== act) rt.setZX({ a: act });
      else if (!act && st && rt.zx.a && WORK_POSE.includes(rt.zx.a)) rt.setZX({ a: st.carry && C.step > 0 ? 'carry' : null, w: st.carry && C.step > 0 ? st.carry : null });
    }
    // ═══ Окна: работа, семья, питомцы, магазины, банк, дома ═══
    const w1 = v => (Math.round(v * 10) / 10).toLocaleString('ru-RU');
    function jobBoard(){
      const cur = rt.zx.r, D = A?.D, st = A?.st, now0 = A ? A.clock() : 0, pc = A?.pub[city];
      if (A) A.pubGet(city).then(p => { onPub(p); });
      const hire = !pc || (pc.hire !== false && !pc.frozen), cRate = A ? E.ui.rate(D, city, pc) : 100;
      const rows = [], rp = [];
      for (const [id, r] of Object.entries(ROLES)) {
        const btn = cur === id ? `<button type="button" data-mz="c:${city}:job:">Уволиться</button>` : (r.car && !root.D37E?.vehicle) || r.soon ? '<button type="button" disabled>Скоро</button>' : `<button type="button" class="ct-start" data-mz="c:${city}:job:${id}">${r.rp ? 'Играть' : 'Работать'}</button>`;
        if (r.rp || r.soon || !A) { rp.push(`<div class="mz-job${cur === id ? ' on' : ''}"><i>${r.icon}</i><div><b>${esc(r.name)}</b><small>${esc(r.desc)}</small></div>${btn}</div>`); continue; }
        const P = D.profs[r.prof]; if (!P || !(P.cities[city] || []).includes(r.place)) continue;
        const sk = E.ui.skill(D, st, r.prof), min = E.Rules.minS(D, r.prof, sk.L), tired = sk.today >= D.caps.full, out = sk.today >= D.caps.half;
        rows.push(`<div class="mz-job${cur === id ? ' on' : ''}"><i>${r.icon}</i><div><b>${esc(r.name)} <em class="mz-stars">${'★'.repeat(sk.L + 1)}</em></b><small>${esc(r.desc)}</small>`
          + `<small class="mz-jobm">≈ ${w1(E.ui.wageNow(D, st, r.prof, city, now0, pc))} 💵 за задание · от ${min} с · ${esc(sk.name)}${sk.next ? ` ${sk.xp}/${sk.next}` : ''}${sk.today ? ` · сегодня ${sk.today}` : ''}${out ? ' · 😴 на сегодня всё' : tired ? ' · 😮‍💨 половина зарплаты' : ''}</small>`
          + `<i class="mz-xpbar" style="--p:${sk.pct}%"></i></div>${btn}</div>`);
      }
      const note = A ? E.ui.trialNote() : 'Работы с зарплатой появятся, когда сайт обновится.';
      const wd = A && st.day === E.Rules.day(now0) ? st.wd : 0;
      H.panel(`<span class="wld-pe">🧰</span><b>Работа · ${esc(Z.name)}</b>`,
        `${note ? `<p class="mz-eco-note">${esc(note)}</p>` : ''}<div class="mz-cash">${A ? `<span>💵 ${fmt(st.cash)}</span><span>${hire ? (cRate < 100 ? `🏙️ Город нанимает · казна бедная: ставка ${cRate} %` : '🏙️ Город нанимает') : pc?.frozen ? '⏸ Город на паузе' : '🔒 Касса пуста — завтра'}</span><span>Сегодня: ${E.fmt100(wd)} из ${fmt(D.caps.wageDay)} 💵</span>` : ''}<span>🪙 за работу: ${MZ.payState().got}/${MZ.PAY.day}</span></div>`
        + `<div class="mz-jobs">${rows.join('')}</div>${rp.length ? `<div class="mz-eco-sec">🎭 Роли без зарплаты</div><div class="mz-jobs">${rp.join('')}</div>` : ''}`
        + (A ? '<p><small>Зарплата — денки 💵 (один кошелёк на оба города). Навык ★ растёт с каждым заданием — платят больше. После 40 заданий одной работы — половина зарплаты, после 60 — смени работу. Еда в магазинах даёт бонус к зарплате.</small></p>' : ''));
    }
    function familyBoard(){
      const cur = rt.zx.f;
      H.panel('<span class="wld-pe">👪</span><b>Семья — кто ты сегодня?</b>', `<p>Роль видна всем над твоим ником. Играйте семьёй: дома, в парке, в школе!</p><div class="wld-acts">${Object.entries(MZ.FAMILY).map(([id, f]) => `<button type="button"${cur === id ? ' class="ct-start"' : ''} data-mz="c:kids:fam:${id}">${f[0]} ${esc(f[1])}</button>`).join('')}<button type="button" data-mz="c:kids:fam:">Без роли</button></div>`);
    }
    function petShop(){
      H.panel('<span class="wld-pe">🐾</span><b>Зоомагазин</b>', `<p>Питомец ходит за тобой, пока ты в мире, — его видят все. Взять и покормить — бесплатно.</p><div class="wld-acts">${Object.entries(PETS).map(([id, p]) => `<button type="button"${rt.zx.pt === id ? ' class="ct-start"' : ''} data-mz="c:kids:pet:${id}">${p[0]} ${esc(p[1])}</button>`).join('')}${rt.zx.pt ? '<button type="button" data-mz="c:kids:pet:">Отпустить домой</button>' : ''}</div>`);
    }
    // ── магазины еды (денки; цена и бонус — каталог MirEcon, решает сервер) ──
    const SHOP_T = { k_bake: ['🥐', 'Пекарня «Булочка»'], k_ice: ['🍦', 'Мороженое'], m_shop: ['🛒', 'Супермаркет'], m_rest: ['🍝', 'Ресторан «Вкусно»'], m_mall: ['🍔', 'ТЦ «Галерея»: еда'] };
    function shop(place){
      if (!A) { toast('Магазины заработают, когда сайт обновится'); return; }
      const D = A.D, items = D.cities[city]?.shops?.[place] || [], st = A.st, T0 = SHOP_T[place] || ['🛍️', 'Магазин'];
      const bf = E.Rules.buffP(D, st, A.clock()), note = E.ui.trialNote();
      const pocket = Object.entries(st.food || {}).map(([k, n]) => `${E.GOODS[k]?.e || '🍽'}×${n}`).join(' ');
      C.shopOpen = place;
      H.panel(`<span class="wld-pe">${T0[0]}</span><b>${esc(T0[1])}</b>`, `${note ? `<p class="mz-eco-note">${esc(note)}</p>` : ''}<div class="mz-cash"><span>💵 ${fmt(st.cash)}</span>${bf ? `<span>🍽 сыт: +${bf} %</span>` : ''}${pocket ? `<span>🎒 ${pocket}</span>` : ''}</div>`
        + `<div class="wld-acts">${items.map(it => { const G = E.GOODS[it] || {}, g = D.goods[it] || {}; return `<button type="button" data-mz="c:${city}:buy:${place}:${it}">${G.e || '🍽'} ${esc(G.n || it)} — 💵${E.Rules.price(D, it)} <small>+${g.buff?.[0] || 0} % · ${g.buff?.[1] || 0} мин</small></button>`; }).join('')}</div>`
        + `<p><small>Еда — в карман; съесть — 🎬 «Действия»: зарплата выше (бонусы складываются до +${D.buff.max} %).</small></p>`);
    }
    async function buy(place, item){
      if (!A) return;
      const r = await A.act('buy', { city, place, item, qty: 1 });
      if (C.stopped) return;
      if (!r.ok) { toast(E.why(r), false); rt.sfx('buzz'); return; }
      toast(`${E.GOODS[item]?.e || '🛍️'} Куплено за 💵${r.got.cost}${r.got.grant ? ` (🎁 +${r.got.grant} 💵 подарок новичку)` : ''}. Съесть — 🎬 «Действия»`, true);
      rt.sfx('coin');
      drawWallet();
      if (C.shopOpen === place && !S.q('.wld-panel').hidden) shop(place);
    }
    async function eatFood(item){
      if (!A) return;
      const r = await A.act('eat', { item });
      if (C.stopped) return;
      if (!r.ok) { toast(E.why(r), false); return; }
      rt.eat(item);   // поза «ест» — видят все
      toast(`${E.GOODS[item]?.e || '🍽'} Вкусно! +${r.got.p} % к зарплате — ещё ${Math.max(1, Math.round((r.got.u - A.clock()) / 60))} мин`, true);
      drawWallet();
    }
    // банк: 📱 «🏦 Банк» (баланс, сегодня, навыки, история); без телефона — коротко здесь
    function bankPanel(){
      if (root.D37Phone?.open) { H.closePops(); root.D37Phone.open('bank'); return; }
      const st = A?.st;
      H.panel('<span class="wld-pe">🏦</span><b>Банк</b>', A ? `<div class="mz-cash"><span>💵 ${fmt(st.cash)}</span></div>${E.ui.trialNote() ? `<p class="mz-eco-note">${esc(E.ui.trialNote())}</p>` : ''}` : '<p>Банк появится, когда сайт обновится.</p>');
    }
    const bizPrompt = (id, name) => `${name}: свой бизнес — скоро`;
    function bizAct(id, name){ H.panel('<span class="wld-pe">💼</span><b>' + esc(name) + '</b>', '<p>Свой бизнес — скоро: аренда помещения, закупка товара и выручка по времени. Пока можно работать в городе за денки 💵 — щит «🧰 Работа» в мэрии.</p>'); }
    // автосалон: тест-драйв (машина появится у салона на 5 минут — видна всем; покупка — позже, гаражи на сервере)
    function dealer(){
      const ok = !!root.D37E?.vehicle && !!rt.veh?.testDrive;
      H.panel('<span class="wld-pe">🚗</span><b>Автосалон</b>', ok
        ? `<p>Выбери машину для тест-драйва — она появится у салона на 5 минут. Покатайся по проспектам, мостам и эстакаде!</p><div class="wld-acts">${[['sedan', '🚗 Седан (синий)'], ['sedan_red', '🚗 Седан (красный)']].filter(([d]) => root.D37E.vehicle.get(d)).map(([d, t]) => `<button type="button" class="ct-start" data-mz="c:${city}:drive:${d}">${t}</button>`).join('')}</div><p><small>Купить свою машину и гараж — скоро.</small></p>`
        : '<p>Машины скоро можно будет водить по дорогам мира! Пока — посмотри модели в зале. 🚗</p>');
    }
    // ── урок в школе (детский; ученик): правильные ответы — немного 🪙 (денек за урок нет — их дают работы) ──
    function quiz(){
      const [qn, opts, ok] = pick(QUIZ), order = opts.map((o, i) => i).sort(() => Math.random() - .5);
      C.quizOk = ok;
      H.panel('<span class="wld-pe">📚</span><b>Урок</b>', `<p><b>${esc(qn)}</b></p><div class="wld-acts">${order.map(i => `<button type="button" data-mz="c:kids:ans:${i}">${esc(opts[i])}</button>`).join('')}</div>`);
    }
    function answer(i){
      H.closePops();
      if (+i === C.quizOk) { toast('🎉 Правильно!', true); rt.sfx('coin'); H.emote?.('🎉'); if ((C.quizN = (C.quizN || 0) + 1) % 3 === 0) rt.payTask('урок'); }
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
    // ── грабитель (роль понарошку): касса/банк → розыск ⭐, полиция ловит (игроки и патрульные); денег не даёт ──
    function robDone(st){
      const big = st.at === SP('m_vault');
      endTask();
      C.wantedT = big ? 120 : 60;
      rt.setZX({ wn: big ? 2 : 1 });
      toast(`💰 Мешок с «добычей» (понарошку)! Тебя ищет полиция ⭐ — продержись ${C.wantedT} с`, true);
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
      if (C.wantedT <= 0) { rt.setZX({ wn: null }); toast('😮‍💨 Розыск снят — оторвался!'); rt.payTask('удачное дело'); }
    }
    function arrested(byKey){
      const cell = pick(K.cells || [{ x: 112, z: 158 }]);
      C.wantedT = 0;
      rt.setZX({ wn: null, pr: 1 });
      C.prisonT = 45;
      rt.place(cell.x, cell.z, PI);
      toast('🚔 Тебя задержали! 45 с в камере — подумай о своём поведении', false);
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
            : X.add({ x: p.ch.x, y: p.ch.y + 1.2, z: p.ch.z, r: 1, hold: 1.5, prompt: () => (Date.now() - (healedAt.get(p.key) || 0) < 20e3 ? null : `✨ Полечить: ${p.nick}`), act: () => { healedAt.set(p.key, Date.now()); rt.send({ k: 'heal', to: p.key }); burst(p.ch, 'magic'); toast('✨ Забота о пациенте — спасибо!', true); } });
          it.kind = kind; arrestItems.set(p.key, it);
        }
        if (it) { it.x = p.ch.x; it.y = p.ch.y + 1.2; it.z = p.ch.z; }
      }
      for (const [k, it] of arrestItems) if (!S.players.has(k)) { X.remove(it); arrestItems.delete(k); }
    }
    // ── суд (роль понарошку): подсудимый → приговор ──
    function trialPanel(){
      endTask();
      H.panel('<span class="wld-pe">⚖️</span><b>Дело №' + (100 + Math.floor(Math.random() * 900)) + '</b>', `<p>Подсудимый: ${pick(['перешёл дорогу на красный', 'шумел ночью', 'не вернул книгу в библиотеку', 'ограбил киоск с мороженым', 'парковался на газоне'])}. Ваше решение?</p><div class="wld-acts"><button type="button" data-mz="c:metro:verdict:free">Оправдать</button><button type="button" data-mz="c:metro:verdict:fine">Штраф</button><button type="button" data-mz="c:metro:verdict:jail">30 суток метлой подметать улицы</button></div>`);
    }
    // ── питомец рядом с хозяином (свой и чужие — по zx.pt). Рисует ОДИН город (первый построенный; был двойной — по спрайту в каждом
    // городе на одном месте), без мусора за кадр: отметка кадра вместо нового Set и массивов ──
    const petS = new Map(); let petStamp = 0;
    function petOne(key, pt, a, dt, t){
      if (!pt || !PETS[pt] || !a || !a.ch?.root.visible) return;
      let s = petS.get(key);
      if (!s) { s = { sp: new T.Sprite(rt.spriteMat(PETS[pt][0])), x: a.x, z: a.z, pt: '', seen: 0 }; s.sp.scale.setScalar(.8); R.scene.add(s.sp); petS.set(key, s); }
      if (s.pt !== pt) { s.pt = pt; s.sp.material = rt.spriteMat(PETS[pt][0]); }
      s.seen = petStamp;
      const yaw = a.ch.yaw, tx = a.x - Math.sin(yaw) * 1.1 - Math.cos(yaw) * .8, tz = a.z - Math.cos(yaw) * 1.1 + Math.sin(yaw) * .8;
      s.x += (tx - s.x) * Math.min(1, dt * 4); s.z += (tz - s.z) * Math.min(1, dt * 4);
      const hop = Math.abs(Math.sin(t * 8 + key.length)) * (Math.hypot(tx - s.x, tz - s.z) > .3 ? .25 : .04);
      s.sp.position.set(s.x, a.y + .45 + hop, s.z);
    }
    function petsFrame(dt, t){
      if (rt.petsBy && rt.petsBy !== city) return;
      rt.petsBy = city; petStamp++;
      petOne(S.key, rt.zx.pt, S.A.get(S.key), dt, t);
      for (const p of S.players.values()) petOne(p.key, p.zx?.pt, S.A.get(p.key), dt, t);
      if (petS.size) petS.forEach(petGone);
    }
    function petGone(s, k){ if (s.seen !== petStamp) { R.scene.remove(s.sp); petS.delete(k); } }
    // ── щелчки по кнопкам окон ──
    function click(a){
      if (!a.startsWith('c:' + city + ':')) return false;
      const [, , cmd, v, v2] = a.split(':');
      if (cmd === 'quit') { setJob(null); H.closePops(); return true; }
      if (cmd === 'job') { H.closePops(); setJob(v || null); return true; }
      if (cmd === 'bank') { bankPanel(); return true; }
      if (cmd === 'buy') { buy(v, v2); return true; }
      if (cmd === 'drive') { H.closePops(); rt.veh?.testDrive?.(v, { x: 182, z: 125, yaw: PI / 2, zone: city }); return true; }
      if (cmd === 'fam') { H.closePops(); rt.setZX({ f: v || null }); toast(v ? `${MZ.FAMILY[v][0]} Ты — ${MZ.FAMILY[v][1]}!` : 'Без роли в семье', true); return true; }
      if (cmd === 'pet') {
        H.closePops();
        if (!v) { rt.setZX({ pt: null }); toast('🐾 Питомец ушёл домой'); return true; }
        rt.setZX({ pt: v }); toast(`${PETS[v][0]} ${PETS[v][1]} теперь с тобой!`, true); rt.sfx('pickup'); return true;
      }
      if (cmd === 'ans') { answer(v); return true; }
      if (cmd === 'verdict') { H.closePops(); toast({ free: '⚖️ Оправдан! Зал аплодирует 👏', fine: '⚖️ Штраф выписан (понарошку)', jail: '⚖️ Приговор: подметать улицы 🧹' }[v], true); taskDone({ done: '' }); return true; }
      return false;
    }
    // ── действия 🎬 своего города ──
    function act(id){
      if (id.startsWith('food:')) { eatFood(id.slice(5)); return true; }
      if (id === 'k_pet') { H.emote?.('❤️'); burst(S.P.ch, 'sparkles', '#fda4af'); return true; }
      if (id === 'k_feed') { toast(`${(PETS[rt.zx.pt] || ['🐾'])[0]} Ням-ням! Питомец доволен`, true); burst(S.P.ch, 'confetti'); return true; }
      if (id === 'm_hide') { toast('🫣 Ты натянул шапку на глаза… полиция всё равно ищет'); return true; }
      return false;
    }
    // ── сеть: арест / задержан, город изменился ──
    function onMsg(p, d){
      if (d.t !== 'z') return false;
      if (d.k === 'cty') { if (d.c === city && A && !(A.pub[city]?.rev >= (d.r | 0))) A.pubGet(city, true).then(q => onPub(q)); return d.c === city; }
      if (d.k === 'arrest' && d.to === S.key && city === 'metro') {
        // меня задерживают: я в розыске, он — полицейский и рядом
        const ok = rt.zx.wn && p.zx?.r === 'police' && Math.hypot(p.ch.x - S.P.ch.x, p.ch.z - S.P.ch.z) < 5 && MZ.inRect(Z, S.P.ch.x, S.P.ch.z, 4);
        if (ok) arrested(p.key);
        return true;
      }
      if (d.k === 'arrested' && d.by === S.key && city === 'metro' && rt.zx.r === 'police') { toast(`👮 Задержан ${p.nick}!`, true); rt.payTask('задержание'); return true; }
      if (d.k === 'heal' && d.to === S.key) { if (p.zx?.r === 'doctor' || p.zx?.r === 'medic') { toast(`✨ ${p.nick} тебя полечил — ты как новенький!`, true); burst(S.P.ch, 'magic'); } return true; }
      return false;
    }
    // ── состояние денег: перерисовать, продолжить работу, бросить чужую (работу взяли в другом городе / вкладке) ──
    const offState = A ? A.on('state', () => {
      if (C.stopped) return;
      drawWallet();
      const R0 = ROLES[C.job], J = A.st.job;
      if (R0?.prof && !C.pend && (!J || J.city !== city || J.prof !== R0.prof || J.place !== R0.place)) {
        endTask(true); C.job = null;
        if (MZ.ROLES[rt.zx.r]?.zone === city) rt.setZX({ r: null, a: null, w: null });
      }
      if (!C.job) resume();
    }) : null;
    const offPub = A ? A.on('pub', p => { if (!C.stopped) onPub(p); }) : null;
    // ── шаг и кадр ──
    const mod = {
      update(dt){
        const here = inCity();
        if (here !== C.here) { C.here = here; wEl.hidden = !here; if (here) { drawWallet(); C.pubT = 0; } drawTask(); }
        if (here && A) { C.pubT -= dt; if (C.pubT <= 0) { C.pubT = 120; A.pubGet(city).then(p => { if (!C.stopped) onPub(p); }); } }   // город раз в 2 мин (без изменений — {same})
        if (C.task) {
          C.run?.update(dt);
          sprayTick();
          // метка — расстояние; работа готова — сколько ждать сдачи (подпись пишется, только когда поменялась: шаг логики — 60 раз в секунду)
          let el = C.distEl; if (!el || !el.isConnected) { el = C.distEl = rt.q('.mz-task .mz-dist'); C.distK = NaN; }
          const st = C.task[C.step];
          if (st?.at && el) {
            const d = Math.hypot(st.at.x - S.P.ch.x, st.at.z - S.P.ch.z), me = rt.veh?.me, inCar = !!st.drive && me?.seat === 0 && me.v.def.id === st.drive;
            const slow = inCar && Math.abs(me.v.spd || 0) < 3;   // такси: пассажир садится и выходит, только когда машина стоит
            const k = st.any ? (inCar ? -1 : -2) : d > 3 ? Math.round(d / 1.17) : inCar && !slow ? -3 : -4;
            if (k !== C.distK) { C.distK = k; el.textContent = k === -1 ? '✅' : k === -2 ? '' : k === -3 ? '🛑 остановись' : k === -4 ? '✋ здесь' : k + ' м'; }
            if ((st.walk && d < 2.5) || (inCar && (st.any || (d < 7 && slow)))) stepDone();   // такси: доехал и остановился (за рулём такси) — засчитано
          } else if (!st && C.srv && (C.leftT -= dt) <= 0) {
            C.leftT = .25;
            const L = rt.q('.mz-task .mz-left'); if (L) L.textContent = Math.max(1, Math.ceil(C.run.left())) + ' с';
            else if (C.run.st === 'sent' && !rt.q('.mz-task').hidden && !/сдаём работу…/.test(rt.q('.mz-task').textContent)) drawTask();
          }
        }
        if (city === 'kids' && here && K.spots.k_tramp) { const t0 = K.spots.k_tramp, ch = S.P.ch; if (Math.hypot(ch.x - t0.x, ch.z - t0.z) < 1.9 && ch.grounded && ch.y > .5 && S.P.mode === 'move') { S.P.push(0, 15, 0); rt.sfx('jump', { vol: .5, rate: 1.4 }); } }
        if (city === 'metro') { wantedTick(dt); prisonTick(dt); }
        arrestTick();
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
      stop(){
        C.stopped = true; offState?.(); offPub?.();
        if (rt.petsBy === city) rt.petsBy = null;
        endTask(true); mk.parent?.remove(mk); for (const s of petS.values()) R.scene.remove(s.sp); for (const sp of Object.values(marks)) R.scene.remove(sp);
        if (site) { for (const m of site.children) if (m.userData.mzOwn) m.geometry.dispose(); R.scene.remove(site); }
        for (const it of arrestItems.values()) X.remove(it); wEl.remove();
      },
      // для проверки
      _: { C, setJob, nextTask, stepDone, tasksFor, arrested, onPub, siteDraw },
    };
    rt.city[city] = { jobBoard, familyBoard, petShop, shop, buy, bankPanel, bizPrompt, bizAct, dealer, quiz, housePrompt, houseAct, cookHome, mod };
    // начало: стройка — из сервера (или пробная), деньги и работа — как в прошлый раз
    if (A) {
      A.init().then(() => { if (C.stopped) return; drawWallet(); resume(); return A.pubGet(city); }).then(p => { if (!C.stopped && p) onPub(p); }, () => {});
    } else siteDraw(0);
    return mod;
  }

  root.MirCity = { taskList, SPOTS, spotsOf, ROLES_K, ROLES_M, CARRY, PETS, QUIZ, K_FIRES, K_CUST, K_PETS, K_FIX, M_FIRES, K_BLD, M_BLD, TAXI_STOPS, roleFor, siteParts, shuffle };
})();
