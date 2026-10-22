// ═══════════════════════════════════════
//  «МИР ДЕНЧИКА»: ЗОНЫ — лобби с телепортами, дороги, карта мира (M и телефон 📱), подгрузка зон рядом с игроком,
//  возрастные ворота (12+ / 16+), общее для городов и боевой зоны: здания, склейка, роли, действия, награды
// ═══════════════════════════════════════
// Владелец 15.10.2026: «город, где РП, боевая зона, связать РП-зону, лобби и другое по карте»; «тип город для детей и город
// для взрослых»; «боевая зона как в Military Tycoon… в ту зону 12+ будет вход». mir.js подключает этот файл маленькими
// «крючками» (помечены «зоны мира»): постройка (дороги, телепорты, силуэты зон), шаг, кадр, сеть ('z' и поле zx в 'st'),
// чат (/me, строгий фильтр детского города), подписи (роль у ника), Esc, телефон. Нет файла — мир как раньше.
// Содержимое зон — свои файлы: mir-city.js (Солнечный городок 0+, Большой город ADULT_AGE+) и mir-war.js (Боевая зона 12+);
// они регистрируются через MirZones.def(id, { build*, show, hide, start, update, frame, onMsg, roles, actions, places, footprints }).
//
// КАРТА (единицы движка; +x — восток, +z — юг; площадь — 0,0). Район участков (северо-запад) НЕ трогаем: там растут участки.
//   зона         │ x            │ z            │ возраст      │ вход
//   Лобби        │ площадь r 18 │              │ 0+           │ 10 телепортов по кругу, щит-карта
//   Солнечный г. │ 110 … 250    │ −80 … 40     │ 0+           │ запад (110, −24) — дорога с площади на северо-восток
//   Большой город│ 90 … 270     │ 100 … 260    │ ADULT_AGE+   │ запад (90, 130) — дорога с развилки (0, 130)
//   Боевая зона  │ −340 … −70   │ 100 … 400    │ 12+          │ КПП на востоке (−70, 130); море x < −262, бункер, аэродром
//   Район участков (не наше) — x −81 … −10, z −66 … −12 и всё к северо-западу от него оставлено пустым под рост.
// Подгрузка: у каждой зоны «силуэт» (склеенные коробки зданий, строится сразу) и подробное содержимое — строится по кусочку
// за кадр, когда игрок ближе LOAD_D к зоне, видно ближе SHOW_D, прячется дальше HIDE_D (жители — только пока видно).
// Сеть: своё состояние игрока (роль, действие, команда, жизни, оружие…) — поле zx в 'st' (шлётся при смене, как телефон), новичку —
// повтор 'st' после его 'hi'. События — 'z' { k } в канале мира (редкие); бой — свой канал (mir-war.js). Presence не трогаем.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const PI = Math.PI;
  const INTF = () => root.D37E?.interior;   // генератор интерьеров (js/engine/interior.js)
  // ── Возраст зон. Большой город — 16+ (с 22.10.2026: контента 18+ там нет — docs/REALMS.md «лёгкий вариант»; было 18) ──
  const ADULT_AGE = 16;
  const WAR_AGE = 12;

  // ═══ Зоны (прямоугольники) ═══
  // 15.10.2026 (владелец: «город побольше в высоту, разных зданий»): Большой город вырос на восток и юг — небоскрёбы, ТЦ,
  // телебашня, отель, паркинг, канал с мостами и эстакада; детский — на восток (ратуша, цветные дома, свободные участки)
  const ZONES = {
    kids: { id: 'kids', name: 'Солнечный городок', short: 'Детский город', icon: '🧸', age: 0, x0: 110, x1: 290, z0: -80, z1: 40, color: '#facc15',
      entry: { x: 118, z: -24, yaw: PI / 2 }, gate: { x: 110, z: -24 }, sub: 'Детский город: работы, школа, питомцы, игровая площадка' },
    metro: { id: 'metro', name: 'Большой город', short: 'Город', icon: '🏙️', age: ADULT_AGE, x0: 90, x1: 340, z0: 100, z1: 350, color: '#60a5fa',
      entry: { x: 98, z: 130, yaw: PI / 2 }, gate: { x: 90, z: 130 }, sub: 'Город для старших (16+): небоскрёбы, работы с зарплатой, полиция и грабители, банк, бизнес' },
    // 15.10.2026 (владелец): боевая зона — дом военных баз игроков (как Military Tycoon): 12 участков кольцом (mir-war.js PLOTS),
    // нейтральные центр с бункером, порт, аэродром и лагерь у КПП
    war: { id: 'war', name: 'Боевая зона', short: 'Боевая зона', icon: '🪖', age: WAR_AGE, x0: -506, x1: -70, z0: 100, z1: 460, color: '#ef4444',
      entry: { x: -84, z: 130, yaw: -PI / 2 }, gate: { x: -70, z: 130 }, sub: 'Мультяшный бой: участки военных баз, бункер, порт, аэродром, наёмники' },
  };
  const ZLIST = [ZONES.kids, ZONES.metro, ZONES.war];
  // Под рост района участков (агент набегов: участки 32×32 кольцами, 4 на улицу) — здесь ничего своего не строим; край мира — шире
  const RESERVE = { x0: -133, x1: -12, z0: -137, z1: -12 };
  // Море и бункер боевой зоны: дыры в земле, дно (ph.terrain) и вода (ph.waterLevel) — нужны миру сразу, до подгрузки зоны
  // (берег — x −364,8: западный край кольца участков; у 4 участков — свой берег под доки; бункер — в нейтральном центре кольца)
  const SEA = { x0: -500, x1: -364.8, z0: 104, z1: 456, wl: -.55, floor: -7 };
  const BUNKER = { x0: -260.4, x1: -234.4, z0: 218.4, z1: 240.4, floor: -5.4, roof: -.35 };
  // Канал Большого города (с востока на запад через весь город): мосты на проспектах, эстакада над ним, пешеходные мостики
  const CANAL = { x0: 90, x1: 340, z0: 252, z1: 264, wl: -2.4, floor: -5.6 };   // вода ниже улиц: под мостами проходят лодки
  // Места под рост городов (будущий «градостроитель»): здесь ничего своего не строим — ни деревьев, ни холмов
  const EXPAND = [
    { id: 'kids_e', zone: 'kids', x0: 290, x1: 350, z0: -80, z1: 40, name: 'Рост Солнечного городка (восток)' },
    { id: 'metro_e', zone: 'metro', x0: 340, x1: 420, z0: 100, z1: 350, name: 'Рост Большого города (восток)' },
    { id: 'metro_s', zone: 'metro', x0: 90, x1: 340, z0: 350, z1: 420, name: 'Рост Большого города (юг)' },
  ];
  // ═══ Типы зданий (одна таблица для будущей «симуляции города»): цвет крыши — по типу, чтобы город читался сверху ═══
  // жильё — зелёное, торговля и офисы — синие, производство — жёлтое, город (мэрия, школа, больница, полиция, пожарные) — красное
  const BTYPES = {
    house: ['🏠', 'Дом', '#4d9a3c'], apartment: ['🏢', 'Жилой дом', '#2f7d4a'], shop: ['🛍️', 'Магазин', '#2f6fd6'], cafe: ['☕', 'Кафе', '#4f8fe8'],
    office: ['🏙️', 'Офис', '#22489c'], hotel: ['🏨', 'Отель', '#5b57d0'], service: ['🔧', 'Сервис', '#b0761e'], factory: ['🏭', 'Производство', '#d6a21e'],
    public: ['🏛️', 'Городское здание', '#c23a3a'], parking: ['🅿️', 'Паркинг', '#6b7280'], park: ['🌳', 'Парк', '#6ec466'], lot: ['🚧', 'Свободный участок', '#b7d77a'],
    military: ['🪖', 'Военный объект', '#5b6b2e'],
  };
  const roofColor = b => (b.type === 'public' && b.sub === 'hall' ? '#a3242a' : (BTYPES[b.type] || BTYPES.lot)[2]);
  // Старые места мира — для плашки «где я» и карты (как в mir.js buildWorld)
  const AREAS = [
    { id: 'cafe', icon: '☕', name: 'Кафе «У Денчика»', x0: -11, x1: 11, z0: -43, z1: -29 },
    { id: 'club', icon: '🕹️', name: 'Игровой клуб', x0: 28, x1: 44, z0: -12, z1: 8 },
    { id: 'stage', icon: '🎤', name: 'Сцена', x0: -45, x1: -24, z0: -9, z1: 7 },
    { id: 'wardrobe', icon: '🎭', name: 'Гардероб', x0: -26.5, x1: -17.5, z0: 20, z1: 28 },
    { id: 'street', icon: '🏠', name: 'Улица с домиками', x0: -18, x1: 18, z0: 18, z1: 76 },
    { id: 'park', icon: '🌳', name: 'Парк и пруд', x0: 20, x1: 52, z0: 18, z1: 58 },
  ];
  const PLAZA_R = 18;
  // Дороги: ломаные [x, z], ширина асфальта; по краям — тротуар
  const ROADS = [
    { id: 'east', w: 7, pts: [[13.5, -13.5], [30, -24], [110, -24]] },   // лобби → Солнечный городок
    { id: 'south', w: 7, pts: [[0, 75], [0, 130]] },                     // улица с домиками → развилка
    { id: 'metro', w: 7, pts: [[0, 130], [90, 130]] },                   // развилка → Большой город
    { id: 'war', w: 7, pts: [[0, 130], [-70, 130]] },                    // развилка → Боевая зона
    { id: 'link', w: 7, pts: [[180, 40], [180, 100]] },                  // Солнечный городок → Большой город
  ];
  // Телепорты на площади: смотрят в сторону своего места (угол — от востока по часовой, как atan2(z, x)); r — от фонтана
  const PAD_R = 13.4;
  const PADS = [
    { a: 0, to: 'club' }, { a: 40, to: 'park' }, { a: 72, to: 'metro' }, { a: 140, to: 'wardrobe' }, { a: 165, to: 'war' },
    { a: 192, to: 'stage' }, { a: 228, to: 'district' }, { a: 270, to: 'cafe' }, { a: 315, to: 'kids' }, { a: 340, to: 'studio' },
  ].map(p => ({ ...p, x: Math.round(Math.cos(p.a * PI / 180) * PAD_R * 100) / 100, z: Math.round(Math.sin(p.a * PI / 180) * PAD_R * 100) / 100 }));
  // Места для карты и телепорта: [id, значок, название, куда (x, z), куда смотреть (x, z), зона]
  const PLACES0 = [
    ['hub', '⛲', 'Лобби — площадь', 0, 11, 0, 0],
    ['cafe', '☕', 'Кафе «У Денчика»', 0, -25, 0, -36],
    ['club', '🕹️', 'Игровой клуб', 25, -1, 36, -2],
    ['stage', '🎤', 'Сцена', -31, -1, -38, -1],
    ['wardrobe', '🎭', 'Гардероб', -16, 18, -22, 24],
    ['street', '🏠', 'Улица с домиками', 0, 40, 0, 60],
    ['park', '🌳', 'Парк и пруд', 24, 27, 32, 34],
    ['camp', '🔥', 'Костёр', 37, 46, 40, 50],
    ['gates', '🧟', 'Ворота игр: «Орда», «Арена», «Башни»', 43, 32, 47, 32],
    ['kubomir', '🧊', '«Кубомир» — ворота в парке', 43, 32, 47, 32],
    ['podzem', '⛏', '«Подземье» — ворота в парке', 43, 48, 47, 48],
    ['district', '🏘️', 'Район участков', -10.4, -13.6, -11.8, -24],   // у арки со стороны площади (за аркой — район, он растёт)
    ['kids', '🧸', 'Солнечный городок', ZONES.kids.entry.x, ZONES.kids.entry.z, 140, -24, 'kids'],
    ['metro', '🏙️', 'Большой город', ZONES.metro.entry.x, ZONES.metro.entry.z, 130, 130, 'metro'],
    ['war', '🪖', 'Боевая зона', ZONES.war.entry.x, ZONES.war.entry.z, -110, 130, 'war'],
  ];
  const STUDIO = { id: 'studio', icon: '🧱', name: 'Студия 3D — свой мир' };
  // Ворота больших песочниц (координатор 15.10: «Кубомир» искали «в списке» — в мире входа не было): в парке, в ряд с воротами
  // «Орда» (z 24) и «Арена» (z 40) у восточного края; открываются своей страницей (мир закрывается), не окном поверх мира
  const BIG_GATES = [
    { g: 'kubomir', x: 47, z: 32, yaw: -PI / 2, name: 'Кубомир', e: '🧊', c: '#16a34a', what: 'Свой бесконечный мир из кубиков: копай, строй, крафти, выживай ночью.' },
    { g: 'podzem', x: 47, z: 48, yaw: -PI / 2, name: 'Подземье', e: '⛏', c: '#b45309', what: 'Песочница сбоку, как Террария: копай вглубь, строй дом, сражайся с боссами.' },
  ];

  // ═══ Геометрия (без браузера — проверяется в node) ═══
  const inRect = (r, x, z, m = 0) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
  const distRect = (r, x, z) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
  const rectsOverlap = (a, b, m = 0) => a.x0 - m < b.x1 && a.x1 + m > b.x0 && a.z0 - m < b.z1 && a.z1 + m > b.z0;
  const zoneAt = (x, z) => { for (const Z of ZLIST) if (inRect(Z, x, z)) return Z; return null; };
  const segDist = (px, pz, x1, z1, x2, z2) => { const dx = x2 - x1, dz = z2 - z1, l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / l)) : 0; return Math.hypot(px - x1 - t * dx, pz - z1 - t * dz); };
  function roadDist(x, z){ let best = Infinity; for (const r of ROADS) for (let i = 1; i < r.pts.length; i++) best = Math.min(best, segDist(x, z, r.pts[i - 1][0], r.pts[i - 1][1], r.pts[i][0], r.pts[i][1]) - r.w / 2); return best; }
  // Район участков (mir-base.js) — его границы, если он их отдаёт; иначе — как сейчас
  const district = () => root.MirBase?.Geo?.ZONE || { x0: -81, x1: -10, z0: -66, z1: -12 };
  // Где игрок (плашка при входе): новая зона, лобби, старые места, район участков
  function areaAt(x, z){
    const Z = zoneAt(x, z); if (Z) return { id: Z.id, icon: Z.icon, name: Z.name, age: Z.age, zone: Z };
    if (Math.hypot(x, z) < PLAZA_R) return { id: 'hub', icon: '⛲', name: 'Лобби', age: 0 };
    const D = district();
    if (root.MirBase?.Geo?.inDistrict ? root.MirBase.Geo.inDistrict(x, z) : inRect(D, x, z)) return { id: 'district', icon: '🏘️', name: 'Район участков', age: 0 };
    for (const A of AREAS) if (inRect(A, x, z)) return A;
    return null;
  }
  // Граница мира: старый мир + зоны + запас (и район участков, если он вырос и говорит об этом)
  function bounds(){
    let x0 = -84, x1 = 84, z0 = -72, z1 = 92;
    for (const Z of [...ZLIST, RESERVE]) { x0 = Math.min(x0, Z.x0 - 10); x1 = Math.max(x1, Z.x1 + 10); z0 = Math.min(z0, Z.z0 - 10); z1 = Math.max(z1, Z.z1 + 10); }
    const B = root.MirBase?.bounds?.();
    if (B) { x0 = Math.min(x0, B[0]); z0 = Math.min(z0, B[1]); x1 = Math.max(x1, B[2]); z1 = Math.max(z1, B[3]); }
    return [x0, z0, x1, z1];
  }
  const groundRect = () => { if (worldMap()) { const c = clusterRect(); return [c.x0, c.z0 - 6, c.x1 + 6, c.z1 + 6]; } const [x0, z0, x1, z1] = bounds(); return [x0 - 220, z0 - 220, x1 + 220, z1 + 220]; };
  // Деревья и трава мира — не на дорогах, телепортах и в зонах
  const blocked = (x, z) => ZLIST.some(Z => inRect(Z, x, z, 6)) || inRect(RESERVE, x, z) || EXPAND.some(r => inRect(r, x, z, 4)) || roadDist(x, z) < 4 || PADS.some(p => Math.hypot(p.x - x, p.z - z) < 2.2) || BIG_GATES.some(g => Math.hypot(g.x - x, g.z - z) < 5);
  // Холм на горизонте: только целиком за краем мира (иначе — насквозь проходимая гора посреди зоны) и не на месте роста городов
  const hillOk = (x, z, r) => { if (worldMap()) return false; const [x0, z0, x1, z1] = bounds(); return (x + r < x0 || x - r > x1 || z + r < z0 || z - r > z1) && !EXPAND.some(e => rectsOverlap(e, { x0: x - r, x1: x + r, z0: z - r, z1: z + r })); };
  // ═══ Большая карта-рельеф (js/engine/worldmap.js, docs/WORLD_MAP.md): вокруг мира — горы, равнины, реки, озёра, море.
  //     Мир (столица и зоны) — ровная площадка (как было); гавань боевой зоны открыта в океан. У всех одно и то же по зерну ═══
  const MAP = { seed: 37, half: 3072 };
  const mapBounds = () => [-MAP.half, -MAP.half, MAP.half, MAP.half];
  const HOLES = [BUNKER, CANAL];   // тут рельеф не рисуется (свои стены и пол); mir.js добавляет чашу пруда
  // площадка мира: всё старое (зоны, места роста, район) — ровно; запад — до набережной гавани (дальше — море)
  function clusterRect(){
    const [x0, z0, x1, z1] = bounds();
    let X1 = x1, Z1 = z1, Z0 = z0;
    for (const e of EXPAND) { X1 = Math.max(X1, e.x1 + 10); Z1 = Math.max(Z1, e.z1 + 10); Z0 = Math.min(Z0, e.z0 - 10); }
    return { x0: Math.max(x0, SEA.x1), x1: X1, z0: Z0, z1: Z1 };
  }
  function mapLayout(){
    return {
      seed: MAP.seed, half: MAP.half, sea: SEA.wl,
      pads: [{ id: 'world', ...clusterRect(), y: 0, m: 8, blend: 120 }],
      // гавань боевой зоны (ровное дно у набережной) и пролив из неё в океан
      oceans: [{ ...SEA, floor: SEA.floor }, { x0: -MAP.half - 200, x1: SEA.x0, z0: SEA.z0 - 30, z1: SEA.z1 + 30 }],
      rivers: [
        { id: 'bystraya', name: 'Быстрая', w0: 6, w1: 18, depth: 2.2, pts: [[-1350, -2350], [-1150, -1700], [-900, -1100], [-760, -600], [-700, -200], [-640, 80], [-700, 200]] },
        { id: 'svetlaya', name: 'Светлая', w0: 7, w1: 24, depth: 2.6, pts: [[1500, -2450], [1250, -1800], [1000, -1250], [820, -700], [700, -200], [640, 300], [700, 800], [820, 1400], [760, 1900], [640, 2500], [600, 2950]] },
      ],
      lakes: [{ id: 'zerk', name: 'Зеркальное', x: -950, z: -750, r: 60 }, { id: 'tihoe', name: 'Тихое', x: 1200, z: 700, r: 85 }, { id: 'gornoe', name: 'Горное', x: -1600, z: -2150, r: 50, depth: 7 }],
      roads: [], holes: HOLES,
    };
  }
  let WM = null;
  const worldMap = () => WM || (root.D37E?.worldMap ? (WM = root.D37E.worldMap(mapLayout())) : null);
  const addHole = r => { if (r && !HOLES.some(h => h.x0 === r.x0 && h.z0 === r.z0)) HOLES.push(r); };
  // Рельеф: гавань (дно SEA.floor, у берега отвесная набережная), бункер (пол ниже земли), канал Большого города, дальше — карта
  // Подвалы военных баз (mir-war.js PLOTS[].cellar; бункер базы — mir-base.js): пол ниже земли — только когда сверху уже лежит плита
  // участка (зона построена: CELLAR.on), иначе — обычная земля (никто не провалится, пока зона строится). Рельеф там рисуется как был
  const CELLAR = { on: false, list: [] };
  const cellarAt = (x, z) => { if (!CELLAR.on || !inRect(ZONES.war, x, z)) return null; for (const c of CELLAR.list) if (inRect(c, x, z)) return c.floor; return null; };
  const terrain = (x, z) => inRect(SEA, x, z) ? SEA.floor : inRect(BUNKER, x, z) ? BUNKER.floor : inRect(CANAL, x, z) ? CANAL.floor : cellarAt(x, z) ?? (worldMap()?.ground(x, z) ?? 0);
  const water = (x, z) => inRect(SEA, x, z) ? SEA.wl : inRect(CANAL, x, z) ? CANAL.wl : (worldMap()?.water(x, z) ?? -Infinity);
  // ═══ Жители по расписанию (задел «города-симулятора»): у каждого — дом, работа, любимый магазин из таблицы зданий зоны.
  //     По часам мира (E.dayClock — у всех одинаково): ночью дома (не видно), утром — по дороге, днём — у работы, вечером — у
  //     магазина, потом — гуляет у дома. По зерну зоны: у всех игроков одни и те же люди в тех же местах. Дёшево: без путей —
  //     переходят, пока игрок далеко. D.residents — сколько (def зоны) ═══
  const RES_NAMES = ['Аня', 'Борис', 'Вика', 'Гоша', 'Даша', 'Егор', 'Женя', 'Зоя', 'Игорь', 'Катя', 'Лёва', 'Маша', 'Никита', 'Оля', 'Паша', 'Рита', 'Саша', 'Таня', 'Федя', 'Юля', 'Артём', 'Ксюша', 'Миша', 'Соня'];
  const hashS = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const prng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  // точка у входа: сторона здания, ближняя к улице зоны, в 2,5 м от стены
  function doorSpot(b, D){
    const sides = [[0, -b.d / 2 - 2.5], [0, b.d / 2 + 2.5], [-b.w / 2 - 2.5, 0], [b.w / 2 + 2.5, 0]];
    let best = null, bd = Infinity;
    for (const [dx, dz] of sides) {
      const x = b.x + dx, z = b.z + dz;
      let d = Infinity; for (const r of D.streets || []) for (let i = 1; i < r.pts.length; i++) d = Math.min(d, segDist(x, z, r.pts[i - 1][0], r.pts[i - 1][1], r.pts[i][0], r.pts[i][1]));
      if (d < bd) { bd = d; best = [x, z]; }
    }
    return best || [b.x, b.z + b.d / 2 + 2.5];
  }
  function residents(zid){
    const D = DEFS[zid]; if (!D?.residents) return [];
    if (D._res) return D._res;
    const B = (D.buildings || []).filter(b => b.h > 0);
    const homes = B.filter(b => b.type === 'apartment' || b.type === 'house'), works = B.filter(b => ['office', 'shop', 'cafe', 'service', 'public', 'hotel', 'factory'].includes(b.type));
    const shops = B.filter(b => b.type === 'shop' || b.type === 'cafe' || b.sub === 'mall');
    if (!homes.length || !works.length) return (D._res = []);
    const r = prng(hashS('res|' + zid)), pick = a => a[Math.floor(r() * a.length)];
    const out = [];
    for (let i = 0; i < D.residents; i++) {
      const home = pick(homes), work = pick(works), shop = pick(shops.length ? shops : works);
      out.push({ id: `${zid}_r${i}`, zone: zid, name: RES_NAMES[Math.floor(r() * RES_NAMES.length)], home: home.id, work: work.id, shop: shop.id,
        hs: doorSpot(home, D), ws: doorSpot(work, D), ss: doorSpot(shop, D), shift: Math.round((r() * 2 - 1) * 100) / 100, j: [Math.round((r() * 2 - 1) * 300) / 100, Math.round((r() * 2 - 1) * 300) / 100], seed: 'res' + zid + i,
        says: [`Живу: ${home.name}`, `Работаю: ${work.name}`, `Вечером — в «${shop.name.replace(/[«»]/g, '')}»`] });
    }
    return (D._res = out);
  }
  // где житель в час h: { phase, x, z } (phase 'home' — дома, не видно)
  function residentAt(R, h){
    const t = ((h - R.shift) % 24 + 24) % 24, j = R.j;
    if (t < 7 || t >= 22.5) return { phase: 'home', x: R.hs[0], z: R.hs[1] };
    if (t < 8.5) { const k = (t - 7) / 1.5; return free(R, 'go', R.hs[0] + (R.ws[0] - R.hs[0]) * k + j[0], R.hs[1] + (R.ws[1] - R.hs[1]) * k + j[1], true); }
    if (t < 17) return free(R, 'work', R.ws[0] + j[0], R.ws[1] + j[1]);
    if (t < 19.5) return free(R, 'shop', R.ss[0] + j[0], R.ss[1] + j[1]);
    return free(R, 'walk', R.hs[0] + j[0] * 2, R.hs[1] + j[1] * 2);
  }
  // точка жителя занята (здание, стена, вода, за зоной) или он в пути — на ближайший тротуар улицы зоны
  function free(R, phase, x, z, street){
    const D = DEFS[R.zone], Z = ZONES[R.zone];
    const bad = !Z || !inRect(Z, x, z, -1) || (D?.buildings || []).some(b => b.h > 0 && Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1) || water(x, z) > -Infinity;
    if (!bad && !street) return { phase, x, z };
    let best = null, bd = Infinity;
    for (const r of D?.streets || []) for (let i = 1; i < r.pts.length; i++) {
      const [x1, z1] = r.pts[i - 1], [x2, z2] = r.pts[i], dx = x2 - x1, dz = z2 - z1, l = dx * dx + dz * dz || 1;
      const k = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l)), px = x1 + dx * k, pz = z1 + dz * k, d = Math.hypot(x - px, z - pz);
      if (d < bd) { const L = Math.sqrt(l), s = ((x - px) * -dz + (z - pz) * dx) >= 0 ? 1 : -1, o = r.w / 2 + 1.3; bd = d; best = [px - dz / L * o * s, pz + dx / L * o * s]; }
    }
    return best ? { phase, x: Math.round(best[0] * 100) / 100, z: Math.round(best[1] * 100) / 100 } : { phase, x, z };
  }
  // Возрастные ворота: { ok } | { ok: false, why: 'unknown' | 'young' }
  function gateOf(Z, A = root.D37Age){
    if (!Z || !Z.age || !A) return { ok: true };
    if (!A.known()) return { ok: false, why: 'unknown' };
    return A.canOpen(Z.age) ? { ok: true } : { ok: false, why: 'young' };
  }

  // ═══ Здания — ОДНА таблица (для будущей «симуляции города»: владение, бизнесы, выборы мэра) ═══
  // Файлы зон отдают def(…, { buildings: [...] }): { id (стабильный, не менять), type (BTYPES), sub (мэрия hall, школа school,
  // больница hospital, полиция police, пожарные fire, суд court…), name, icon, x, z, w, d, h, wall, style (фасад небоскрёба),
  // lots (помещения — их потом смогут покупать игроки; нет — посчитаются сами) }. Отсюда же — силуэты зон и карта.
  const FLOOR_H = 3.2;
  function lotsOf(b){
    const L = [], add = (kind, name, floor = 0) => L.push({ id: `${b.id}:${L.length + 1}`, kind, name, floor });
    if (Array.isArray(b.lots)) { for (const l of b.lots) add(l.kind || b.type, l.name || b.name, l.floor || 0); return L; }
    const floors = Math.max(1, Math.round((b.h || FLOOR_H) / FLOOR_H));
    if (b.type === 'public') { if (b.sub === 'hall') add('mayor', 'Кабинет мэра', 0); return L; }
    if (b.type === 'park' || b.type === 'military') return L;
    if (b.type === 'lot') { add('land', 'Земля под застройку'); return L; }
    if (b.type === 'apartment') {
      const per = b.w * b.d > 320 ? 4 : 2, from = b.shops ? 1 : 0;
      for (let i = 0; i < (b.shops || 0); i++) add('shop', `Магазин ${i + 1} на 1-м этаже`, 0);
      for (let f = from; f < Math.min(floors, 30); f++) for (let k = 0; k < per; k++) add('flat', `Квартира ${f + 1}${String.fromCharCode(1072 + k)}`, f);
      return L;
    }
    if (b.type === 'office') { for (let f = 0; f < Math.min(floors, 40); f++) add('office', f ? `Офис на ${f + 1}-м этаже` : 'Холл и приёмная', f); return L; }
    add(b.type === 'house' ? 'home' : b.type, b.name, 0);
    for (let f = 1; f < floors && b.flats; f++) add('flat', `Квартира на ${f + 1}-м этаже`, f);
    return L;
  }
  const buildings = zone => { const out = []; for (const [id, d] of Object.entries(DEFS)) if (!zone || zone === id) for (const b of d.buildings || []) out.push(b); return out; };
  const building = id => { for (const d of Object.values(DEFS)) for (const b of d.buildings || []) if (b.id === id) return b; return null; };

  // ═══ Роли и действия (их дают файлы зон): ROLES[id] = { icon, name, zone, hat, vest, color, pay } ═══
  const DEFS = {}, ROLES = {};
  const def = (id, d) => {
    DEFS[id] = d;
    for (const [k, r] of Object.entries(d.roles || {})) ROLES[k] = { ...r, id: k, zone: id };
    // таблица зданий: зона, помещения, цвет крыши; силуэты и карта — из неё (+ площади и парки — extraFoot)
    for (const b of d.buildings || []) { b.zone = id; b.lots = lotsOf(b); b.roof = b.roof || roofColor(b); if (!b.icon) b.icon = (BTYPES[b.type] || BTYPES.lot)[0]; }
    // сначала земля (площади, перрон, порт), сверху — здания (на карте ангары не прячутся под перроном)
    if (!d.footprints) d.footprints = [...(d.extraFoot || []), ...(d.buildings || []).map(b => [b.x, b.z, b.w, b.d, b.wall || b.roof, b.h ?? 4, b.style || null, b.roof])];
    return d;
  };

  // ═══ Своё состояние игрока по сети (поле zx в 'st'): что можно — белым списком ═══
  // r роль · f семья · a действие · sl [x, y, z, yaw] место (сесть/лечь) · t команда 1/2 · h жизни 0…10 · w оружие · m наёмников
  // pt питомец · wn розыск 0…3 · pr в тюрьме · v транспорт (mir-war / vehicle.js) · c город (детский — строгий чат)
  const ACTS = new Set(['sit', 'sleep', 'eat', 'carry', 'hose', 'aim', 'heal', 'cook', 'drink', 'dance', 'fix', 'hold']);
  const ID_RE = /^[a-z][a-z0-9_]{0,15}$/;
  const fin = v => typeof v === 'number' && isFinite(v);
  function cleanZX(o){
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const z = {};
    if (typeof o.r === 'string' && ROLES[o.r]) z.r = o.r;
    if (typeof o.f === 'string' && ID_RE.test(o.f)) z.f = o.f;
    if (typeof o.a === 'string' && ACTS.has(o.a)) z.a = o.a;
    if (Array.isArray(o.sl) && o.sl.length === 4 && o.sl.every(fin)) z.sl = o.sl.map(v => Math.round(v * 100) / 100);
    if (o.t === 1 || o.t === 2) z.t = o.t;
    if (Number.isInteger(o.h) && o.h >= 0 && o.h <= 10) z.h = o.h;
    if (typeof o.w === 'string' && ID_RE.test(o.w)) z.w = o.w;
    if (Number.isInteger(o.m) && o.m >= 0 && o.m <= 3) z.m = o.m;
    if (typeof o.pt === 'string' && ID_RE.test(o.pt)) z.pt = o.pt;
    if (Number.isInteger(o.wn) && o.wn >= 0 && o.wn <= 3) z.wn = o.wn;
    if (o.pr === 1) z.pr = 1;
    if (typeof o.hs === 'string' && ID_RE.test(o.hs)) z.hs = o.hs;
    if (Array.isArray(o.v) && o.v.length >= 2 && o.v.length <= 16 && typeof o.v[0] === 'string' && ID_RE.test(o.v[0]) && o.v.slice(1).every(fin)) z.v = o.v.slice();
    return Object.keys(z).length ? z : null;
  }

  // ═══ Награды: монеты за работу — пачкой через существующий D37Coins.run (сервер режет: coin_run_cap, 600 в день, раз в 20 с) ═══
  const PAY = { task: 2, batch: 6, cap: 10, day: 60 };   // 🪙 за задание, когда выплачивать, за раз (= coin_run_cap 'rp'), в день (клиент)
  function payState(){
    const day = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
    let s = null;
    try { s = JSON.parse(root.localStorage?.getItem('d37_mir_pay') || 'null'); } catch (e) {}
    if (!s || s.day !== day) s = { day, got: 0, pend: 0, n: 0 };
    return s;
  }
  const paySave = s => { try { root.localStorage?.setItem('d37_mir_pay', JSON.stringify(s)); } catch (e) {} };
  // Сколько начислить за задание с учётом дневного лимита (чистая функция для теста)
  const payAdd = (s, n = PAY.task) => { const add = Math.max(0, Math.min(n, PAY.day - s.got - s.pend)); s.pend += add; return add; };

  // ═══ Карта: общий рисунок для окна M и телефона 📱 ═══
  const FOOT0 = [['Кафе', 0, -36, 22, 14, '#9a3412'], ['Клуб', 36, -2, 16, 20, '#4c1d95'], ['Гардероб', -22, 24, 9, 8, '#db2777'], ['Сцена', -38, -1, 7, 13, '#3b2a5a'],
    ['', -12, 30, 9, 9, '#b91c1c'], ['', 12, 30, 9, 9, '#1d4ed8'], ['', -12.5, 52, 10, 11, '#15803d'], ['', 12, 52, 9, 9, '#7e22ce']];
  const fullView = () => { const [x0, z0, x1, z1] = bounds(); return { x0: x0 - 6, z0: z0 - 6, x1: x1 + 6, z1: z1 + 6 }; };
  function places(){
    const out = PLACES0.map(p => ({ id: p[0], icon: p[1], name: p[2], x: p[3], z: p[4], lx: p[5], lz: p[6], zone: p[7] || null }));
    for (const [id, d] of Object.entries(DEFS)) for (const p of d.places || []) out.push({ ...p, zone: id });
    for (const p of out) { const Z = p.zone ? ZONES[p.zone] : null; p.age = Z ? Z.age : 0; p.yaw = Math.atan2(p.lx - p.x, p.lz - p.z); }
    return out;
  }
  function drawMap(g, W, H, view, o = {}){
    const v = view || fullView(), sc = Math.min(W / (v.x1 - v.x0), H / (v.z1 - v.z0));
    const ox = (W - (v.x1 - v.x0) * sc) / 2 - v.x0 * sc, oz = (H - (v.z1 - v.z0) * sc) / 2 - v.z0 * sc;
    const sx = x => ox + x * sc, sz = z => oz + z * sc, rr = (r, c, a) => { g.globalAlpha = a ?? 1; g.fillStyle = c; g.fillRect(sx(r.x0), sz(r.z0), (r.x1 - r.x0) * sc, (r.z1 - r.z0) * sc); g.globalAlpha = 1; };
    g.fillStyle = '#3f8f3a'; g.fillRect(0, 0, W, H);
    const B = bounds();
    g.fillStyle = '#4c9a41'; g.fillRect(sx(B[0]), sz(B[1]), (B[2] - B[0]) * sc, (B[3] - B[1]) * sc);
    rr(SEA, '#2f7fc1');
    // район участков — пунктир
    const D = district();
    rr(RESERVE, 'rgba(147,207,124,.32)'); rr(D, 'rgba(147,207,124,.55)');
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.setLineDash([5, 4]); g.strokeRect(sx(RESERVE.x0), sz(RESERVE.z0), (RESERVE.x1 - RESERVE.x0) * sc, (RESERVE.z1 - RESERVE.z0) * sc); g.setLineDash([]);
    // места роста городов — пунктир
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.setLineDash([3, 4]);
    for (const e of EXPAND) g.strokeRect(sx(e.x0), sz(e.z0), (e.x1 - e.x0) * sc, (e.z1 - e.z0) * sc);
    g.setLineDash([]);
    // зоны
    for (const Z of ZLIST) { rr(Z, Z.id === 'war' ? '#8a7f5a' : Z.id === 'kids' ? '#7fc96a' : '#8b95a6', .9); g.strokeStyle = Z.color; g.lineWidth = Math.max(1.5, sc * 1.2); g.strokeRect(sx(Z.x0), sz(Z.z0), (Z.x1 - Z.x0) * sc, (Z.z1 - Z.z0) * sc); }
    rr(SEA, '#2f7fc1'); rr(CANAL, '#3a8fd0');
    // дороги
    g.lineCap = 'round'; g.lineJoin = 'round';
    const road = (pts, w, c) => { g.strokeStyle = c; g.lineWidth = Math.max(2, w * sc); g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sz(z)) : g.moveTo(sx(x), sz(z)))); g.stroke(); };
    for (const r of ROADS) road(r.pts, r.w, '#5b6270');
    road([[0, 17], [0, 75]], 7, '#5b6270');
    for (const [x1, z1, x2, z2, w] of [[0, -17, 0, -29, 4.2], [17, -1, 28, -1, 4.2], [-17, -1, -27, -1, 4.2], [-12, 12, -19, 19, 3], [13, 12, 28, 28, 3.4], [-11.5, -13.5, -12.5, -38, 3]]) road([[x1, z1], [x2, z2]], w, '#e8dcc0');
    for (const [, d] of Object.entries(DEFS)) for (const r of d.streets || []) road(r.pts, r.w, '#596070');
    // площадь, фонтан, пруд
    g.fillStyle = '#ece2cb'; g.beginPath(); g.arc(sx(0), sz(0), Math.max(3, PLAZA_R * sc), 0, 7); g.fill();
    g.fillStyle = '#5ec8f2'; g.beginPath(); g.arc(sx(0), sz(0), Math.max(1.5, 3.3 * sc), 0, 7); g.fill();
    g.fillStyle = '#3aa6dc'; g.beginPath(); g.arc(sx(32), sz(34), Math.max(1.5, 6.6 * sc), 0, 7); g.fill();
    // здания: старые и зон
    const foot = (x, z, w, d, c) => { g.fillStyle = c; g.fillRect(sx(x - w / 2), sz(z - d / 2), Math.max(1, w * sc), Math.max(1, d * sc)); };
    for (const [, x, z, w, d, c] of FOOT0) foot(x, z, w, d, c);
    for (const d of Object.values(DEFS)) for (const f of d.footprints || []) foot(f[0], f[1], f[2], f[3], f[7] || f[4]);   // сверху — крыша (цвет по типу здания)
    // участки военных баз (боевая зона): пунктир и номер; занятые — цвет базы (o.plots: { id: { c, name } } — от системы баз)
    for (const d of Object.values(DEFS)) for (const P of d.plots || []) {
      const own = o.plots?.[P.id];
      if (own?.c) { g.globalAlpha = .35; g.fillStyle = own.c; g.fillRect(sx(P.x0), sz(P.z0), (P.x1 - P.x0) * sc, (P.z1 - P.z0) * sc); g.globalAlpha = 1; }
      g.strokeStyle = own?.c || 'rgba(255,255,255,.75)'; g.lineWidth = Math.max(1, sc * .6); g.setLineDash([4, 3]);
      g.strokeRect(sx(P.x0), sz(P.z0), (P.x1 - P.x0) * sc, (P.z1 - P.z0) * sc); g.setLineDash([]);
      if ((P.x1 - P.x0) * sc > 16) { g.fillStyle = '#fff'; g.font = `800 ${Math.max(9, Math.min(16, (P.x1 - P.x0) * sc / 3))}px Montserrat, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(P.n), sx(P.cx), sz(P.cz)); }
    }
    // названия зон и метки возраста
    const fs = Math.max(10, Math.min(18, W / 34));
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const Z of ZLIST) {
      const cx = sx((Z.x0 + Z.x1) / 2), cy = sz(Z.z0) + fs * 1.1;
      g.font = `800 ${fs}px Montserrat, Arial, sans-serif`;
      const t = `${Z.icon} ${Z.short || Z.name}`, tw = g.measureText(t).width;
      g.fillStyle = 'rgba(10,8,24,.72)'; g.fillRect(cx - tw / 2 - 6, cy - fs * .75, tw + 12 + (Z.age ? fs * 2.2 : 0), fs * 1.5);
      g.fillStyle = '#fff'; g.fillText(t, cx - (Z.age ? fs * .2 : 0) + (Z.age ? -fs * .1 : 0), cy);
      if (Z.age) { const bx = cx + tw / 2 + 4; g.fillStyle = Z.age >= 18 ? '#b91c1c' : Z.age >= 16 ? '#c2410c' : '#a16207'; g.fillRect(bx, cy - fs * .6, fs * 1.9, fs * 1.2); g.fillStyle = '#fff'; g.font = `900 ${fs * .72}px Montserrat, Arial, sans-serif`; g.fillText(Z.age + '+', bx + fs * .95, cy + 1); }
    }
    // места (значки)
    const pts = o.points || places();
    g.font = `${Math.max(12, Math.min(22, W / 28))}px sans-serif`;
    for (const p of pts) if (!p.sub || sc > 1.4) g.fillText(p.icon, sx(p.lx), sz(p.lz));
    // игроки и я
    for (const pl of o.players || []) { g.fillStyle = pl.friend ? '#4ade80' : pl.hot ? '#f87171' : '#e2e8f0'; g.beginPath(); g.arc(sx(pl.x), sz(pl.z), Math.max(3, W / 110), 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1.2; g.stroke(); }
    for (const m of o.marks || []) { g.font = `${Math.max(14, W / 30)}px sans-serif`; g.fillText(m.icon, sx(m.x), sz(m.z) - 4); }
    const me = o.me;
    if (me) { const s = Math.max(8, W / 60); g.save(); g.translate(sx(me.x), sz(me.z)); g.rotate(-me.yaw + PI); g.fillStyle = '#facc15'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -s * 1.4); g.lineTo(s, s); g.lineTo(0, s * .45); g.lineTo(-s, s); g.closePath(); g.fill(); g.stroke(); g.restore(); }
    return { sx, sz, sc, inv: (px, py) => [(px - ox) / sc, (py - oz) / sc] };
  }

  // ═══ Склейка группы: простые цвета — в вершины (одна сетка на кусок), светящиеся — отдельно, с картинкой/прозрачные — по материалу.
  //     Стены темнее внизу (как тень у земли в bakeStatic). Куски — сеткой chunk (м): дальние куски отсекаются по видимости ═══
  const SHARED = new WeakMap();   // R → общие материалы склейки
  function sharedMats(R){
    let m = SHARED.get(R);
    if (m) return m;
    const T = R.T, low = R.q === 'low';
    m = {
      std: low ? new T.MeshLambertMaterial({ vertexColors: true }) : new T.MeshStandardMaterial({ vertexColors: true, roughness: .82, metalness: 0, envMapIntensity: .65 }),
      glow: R.bloom ? R.bloom(new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 1) : new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    };
    R.own.push(m.std, m.glow);
    SHARED.set(R, m);
    return m;
  }
  function boxUV(px, py, pz, nx, ny, nz, tile, out, i){
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let u, v;
    if (ay >= ax && ay >= az) { u = px; v = ny > 0 ? -pz : pz; } else if (ax >= az) { u = nx > 0 ? -pz : pz; v = py; } else { u = nz > 0 ? px : -px; v = py; }
    out[i * 2] = u / tile; out[i * 2 + 1] = v / tile;
  }
  // Ломаемые вещи внутри склеенных сеток: id → [{ mesh, start, count, orig }] — «спрятать» = стянуть их вершины в точку
  const BRK = new Map();
  function brkHide(id, on){
    const L = BRK.get(id); if (!L) return false;
    for (const r of L) {
      const a = r.mesh.geometry.attributes.position, arr = a.array;
      if (on) { if (!r.orig) r.orig = arr.slice(r.start * 3, (r.start + r.count) * 3); for (let i = r.start * 3; i < (r.start + r.count) * 3; i += 3) { arr[i] = r.orig[0]; arr[i + 1] = -500; arr[i + 2] = r.orig[2]; } }
      else if (r.orig) arr.set(r.orig, r.start * 3);
      a.needsUpdate = true;
    }
    return true;
  }
  // склейка: merge() — сразу целиком; mergeIt() — по шагам (зона строится кусочками, не больше бюджета за кадр)
  function merge(R, grp, o){ const it = mergeIt(R, grp, o); let r; do r = it.next(); while (!r.done); return r.value; }
  function* mergeIt(R, grp, o = {}){
    const T = R.T, M = sharedMats(R), low = R.q === 'low', CH = o.chunk || 0;
    grp.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(grp.matrixWorld).invert(), m4 = new T.Matrix4(), sph = new T.Sphere();
    const buckets = new Map(), drop = [], list = [];
    grp.traverse(x => {
      if (!x.isMesh || x.isInstancedMesh || x.userData.dyn || x.userData.mzOwn) return;
      for (let p = x.parent; p && p !== grp; p = p.parent) if (p.userData.dyn) return;
      if (!Array.isArray(x.material)) list.push(x);
    });
    let n = 0, kv = 0;
    for (const x of list) {
      const mat = x.material;
      const plain = !mat.map && !mat.transparent && !mat.normalMap && !(mat.metalness > .01) && !(mat.emissive && mat.emissive.r + mat.emissive.g + mat.emissive.b > 0);
      let ck = '';
      if (CH > 0) { if (!x.geometry.boundingSphere) x.geometry.computeBoundingSphere(); sph.copy(x.geometry.boundingSphere).applyMatrix4(x.matrixWorld); if (sph.radius < CH * .75) ck = Math.floor(sph.center.x / CH) + ',' + Math.floor(sph.center.z / CH); }
      const key = (plain ? (mat.isMeshBasicMaterial ? 'glow' : 'std') : mat.uuid) + '|' + ck;
      let b = buckets.get(key);
      if (!b) buckets.set(key, b = { mat, plain, glow: plain && mat.isMeshBasicMaterial, list: [], n: 0 });
      m4.multiplyMatrices(inv, x.matrixWorld);
      const g = x.geometry.index ? x.geometry.toNonIndexed() : x.geometry.clone();
      g.applyMatrix4(m4);
      if (mat.flatShading) g.computeVertexNormals();
      let brk = x.userData.brk; for (let p = x.parent; !brk && p && p !== grp; p = p.parent) brk = p.userData.brk;
      b.list.push({ g, c: mat.color, brk }); b.n += g.attributes.position.count;
      drop.push(x);
      kv += g.attributes.position.count;
      if (++n % 24 === 0 || kv > 6000) { kv = 0; yield; }
    }
    const out = [];
    for (const b of buckets.values()) {
      const pos = new Float32Array(b.n * 3), nor = new Float32Array(b.n * 3), col = b.plain ? new Float32Array(b.n * 3) : null, uv = b.plain ? null : new Float32Array(b.n * 2);
      const tile = !b.plain && b.mat.userData?.tile;
      let k = 0, j = 0; const ranges = [];
      for (const { g, c, brk } of b.list) {
        const gp = g.attributes.position, gn = g.attributes.normal, gu = g.attributes.uv;
        if (brk) ranges.push({ id: brk, start: k, count: gp.count });
        pos.set(gp.array, k * 3); if (gn) nor.set(gn.array, k * 3);
        for (let i = 0; i < gp.count; i++) {
          if (col) {
            const ny = gn ? gn.getY(i) : 1, a = b.glow || Math.abs(ny) >= .6 || low || o.ao === false ? 1 : .62 + .38 * Math.min(1, Math.max(0, gp.getY(i) / 1.4));
            col[(k + i) * 3] = c.r * a; col[(k + i) * 3 + 1] = c.g * a; col[(k + i) * 3 + 2] = c.b * a;
          } else if (tile && gn) boxUV(gp.getX(i), gp.getY(i), gp.getZ(i), gn.getX(i), gn.getY(i), gn.getZ(i), tile, uv, k + i);
          else if (gu) { uv[(k + i) * 2] = gu.getX(i); uv[(k + i) * 2 + 1] = gu.getY(i); }
        }
        k += gp.count; g.dispose();
        kv += gp.count;
        if (++j % 32 === 0 || kv > 9000) { kv = 0; yield; }
      }
      const mg = new T.BufferGeometry();
      mg.setAttribute('position', new T.BufferAttribute(pos, 3)); mg.setAttribute('normal', new T.BufferAttribute(nor, 3));
      if (col) mg.setAttribute('color', new T.BufferAttribute(col, 3)); else mg.setAttribute('uv', new T.BufferAttribute(uv, 2));
      mg.computeBoundingSphere();
      const mesh = new T.Mesh(mg, b.plain ? (b.glow ? M.glow : M.std) : b.mat);
      mesh.userData.mzOwn = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      if (!low) { mesh.castShadow = !b.glow && !b.mat.transparent && !b.mat.userData?.noCast; mesh.receiveShadow = !b.glow; }
      if (b.mat.transparent) mesh.renderOrder = 2;
      for (const r of ranges) { let L = BRK.get(r.id); if (!L) BRK.set(r.id, L = []); L.push({ mesh, start: r.start, count: r.count, orig: null }); }
      if (ranges.length) mesh.geometry.attributes.position.setUsage?.(T.DynamicDrawUsage);
      grp.add(mesh); out.push(mesh);
      yield;
    }
    for (const x of drop) x.parent?.remove(x);
    return out;
  }
  const disposeOwn = grp => grp.traverse(x => { if (x.isMesh && x.userData.mzOwn) x.geometry.dispose(); });

  // ═══ Здание из деталей с постоянными номерами (боевая зона): чистая функция — проверяется в node ═══
  // spec: { id, x, z, w, d, h, wall, trim, roofC, floorC, floorType, doors: [{ side, at, w, h }], windows: [{ side, at, w, h }], destructible }
  // Номер детали: «<здание>:<вид>:<n>» — n по порядку постройки (одинаковый у всех игроков и после перезагрузки).
  // Виды: floor (плиты пола ≤ 4×4), wall (куски стены ≤ 2,4), window (стекло), lintel (над проёмом), sill (под окном),
  // pillar (угол), roof (плиты крыши), parapet (бортик крыши)
  function modular(spec){
    const out = [], cnt = {}, t = .3, H = spec.h || 3.8, hw = spec.w / 2, hd = spec.d / 2, x0 = spec.x, z0 = spec.z, D = spec.destructible !== false;
    const add = (kind, o) => { cnt[kind] = (cnt[kind] || 0) + 1; out.push({ id: `${spec.id}:${kind}:${cnt[kind]}`, kind, b: spec.id, destructible: D, ...o }); };
    const tiles = (w, d, f) => { const nx = Math.max(1, Math.ceil(w / 4 - 1e-6)), nz = Math.max(1, Math.ceil(d / 4 - 1e-6)); for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) f(-w / 2 + w / nx * (i + .5), -d / 2 + d / nz * (j + .5), w / nx, d / nz); };
    tiles(spec.w, spec.d, (lx, lz, tw, td) => add('floor', { x: x0 + lx, y: .06, z: z0 + lz, w: tw, h: .12, d: td, c: spec.floorC || '#a8a29e', floor: spec.floorType || 'concrete', cam: false }));
    for (const side of ['n', 's', 'e', 'w']) {
      const horiz = side === 'n' || side === 's', L = horiz ? spec.w : spec.d;
      const ops = [...(spec.doors || []).filter(o => o.side === side).map(o => ({ at: o.at || 0, w: o.w || 2.6, y0: 0, y1: o.h || 2.9, door: true })),
        ...(spec.windows || []).filter(o => o.side === side).map(o => ({ at: o.at || 0, w: o.w || 2, y0: 1.1, y1: 1.1 + (o.h || 1.4) }))].sort((a, b) => a.at - b.at);
      const put = (kind, a, b, y0, y1) => {
        if (b - a < .02 || y1 - y0 < .02) return;
        const n = kind === 'window' ? 1 : Math.max(1, Math.ceil((b - a) / 2.4 - 1e-6)), sl = (b - a) / n;
        for (let k = 0; k < n; k++) {
          const c = a + sl * (k + .5), wx = horiz ? x0 + c : x0 + (side === 'e' ? hw : -hw), wz = horiz ? z0 + (side === 's' ? hd : -hd) : z0 + c, th = kind === 'window' ? .1 : t;
          add(kind, { x: wx, y: (y0 + y1) / 2, z: wz, w: horiz ? sl : th, h: y1 - y0, d: horiz ? th : sl, c: kind === 'window' ? null : spec.wall || '#a8a29e', glass: kind === 'window', cam: kind !== 'window', side });
        }
      };
      let a = -L / 2;
      for (const p of ops) {
        const l = p.at - p.w / 2, r = p.at + p.w / 2;
        put('wall', a, l, 0, H); put('lintel', l, r, p.y1, H);
        if (!p.door) { put('sill', l, r, 0, p.y0); put('window', l, r, p.y0, p.y1); }
        a = r;
      }
      put('wall', a, L / 2, 0, H);
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add('pillar', { x: x0 + sx * hw, y: (H + .1) / 2, z: z0 + sz * hd, w: .45, h: H + .1, d: .45, c: spec.trim || '#57534e', cam: true });
    tiles(spec.w + .6, spec.d + .6, (lx, lz, tw, td) => add('roof', { x: x0 + lx, y: H + .12, z: z0 + lz, w: tw, h: .24, d: td, c: spec.roofC || '#57534e', cam: false }));
    const W2 = spec.w + .6, D2 = spec.d + .6;
    for (const [len, horiz, px, pz] of [[W2, true, 0, -D2 / 2], [W2, true, 0, D2 / 2], [D2, false, -W2 / 2, 0], [D2, false, W2 / 2, 0]]) {
      const n = Math.max(1, Math.ceil(len / 4 - 1e-6)), sl = len / n;
      for (let k = 0; k < n; k++) { const c = -len / 2 + sl * (k + .5); add('parapet', { x: x0 + px + (horiz ? c : 0), y: H + .45, z: z0 + pz + (horiz ? 0 : c), w: horiz ? sl : .3, h: .42, d: horiz ? .3 : sl, c: spec.trim || '#57534e', cam: false }); }
    }
    return out;
  }
  // Детали рисуются InstancedMesh: спрятать = матрица нулевого размера (крыша изнутри, будущая поломка)
  function setPieceVis(p, on){
    const it = p.inst; if (!it) return;
    if (on) it.mesh.setMatrixAt(it.i, p.m4); else it.mesh.setMatrixAt(it.i, it.zero);
    it.mesh.instanceMatrix.needsUpdate = true;
  }
  // «Группа» деталей для триггера комнаты (mir.js прячет крышу: roof.visible = false) — те же правила, что у Object3D.visible
  function pieceGroup(list){
    let vis = true;
    return { isPieceGroup: true, list, get visible(){ return vis; }, set visible(v){ v = !!v; if (v === vis) return; vis = v; for (const p of list) setPieceVis(p, v && !p.broken); } };
  }
  function flushPieces(R, K, grp){ const it = flushPiecesIt(R, K, grp); let r; do r = it.next(); while (!r.done); return r.value; }
  function* flushPiecesIt(R, K, grp){
    const T = R.T, L = K.pieceList; if (!L.length) return [];
    const CH = 96, low = R.q === 'low';
    let sm = SHARED_P.get(R);
    if (!sm) { sm = low ? new T.MeshLambertMaterial({ color: '#ffffff' }) : new T.MeshStandardMaterial({ color: '#ffffff', roughness: .85, metalness: 0, envMapIntensity: .6 }); R.own.push(sm); SHARED_P.set(R, sm); }
    const buckets = new Map();
    for (const p of L) {
      if (p.inst) continue;
      const key = (p.glass ? 'g' : 's') + '|' + Math.floor(p.x / CH) + ',' + Math.floor(p.z / CH);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(p);
    }
    const out = [], q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), v = new T.Vector3(), s = new T.Vector3(), col = new T.Color(), zero = new T.Matrix4().makeScale(0, 0, 0);
    for (const [key, list] of buckets) {
      const glass = key[0] === 'g', geo = new T.BoxGeometry(1, 1, 1);
      const mesh = new T.InstancedMesh(geo, glass ? K.M.glass : sm, list.length);
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      list.forEach((p, i) => {
        p.m4 = new T.Matrix4().compose(v.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw || 0), s.set(p.w, p.h, p.d));
        mesh.setMatrixAt(i, p.m4);
        if (!glass) mesh.setColorAt(i, col.set(p.c || '#a8a29e'));
        p.inst = { mesh, i, zero };
        const r = Math.hypot(p.w, p.h, p.d) / 2;
        mnx = Math.min(mnx, p.x - r); mny = Math.min(mny, p.y - r); mnz = Math.min(mnz, p.z - r); mxx = Math.max(mxx, p.x + r); mxy = Math.max(mxy, p.y + r); mxz = Math.max(mxz, p.z + r);
      });
      // своя сфера охвата (иначе отсечение по видимости считает только кубик в начале координат)
      geo.boundingSphere = new T.Sphere(new T.Vector3((mnx + mxx) / 2, (mny + mxy) / 2, (mnz + mxz) / 2), Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) / 2);
      geo.boundingBox = new T.Box3(new T.Vector3(mnx, mny, mnz), new T.Vector3(mxx, mxy, mxz));
      mesh.userData.mzOwn = true; mesh.userData.dyn = true;
      if (!low && !glass) { mesh.castShadow = true; mesh.receiveShadow = true; }
      if (glass) mesh.renderOrder = 2;
      grp.add(mesh); out.push(mesh);
      yield;
    }
    return out;
  }
  const SHARED_P = new WeakMap();
  const TOUGH = /bunker|^wb\d/;   // прочные здания: бункер, постройки военных баз (wb01…: командный пункт и всё, что там построят)
  const PIECES = new Map();   // все построенные детали с номерами: id → деталь (реестр для будущих разрушений)
  const MZ_ACCESS = [];   // правила дверей: f(door, rt) → true (пустить) | 'причина' (нет) | undefined (не моё) — для РП и будущих владельцев

  // ═══ Надписи: холст на зону (атлас) — все вывески одной сеткой; места мало — следующая страница (ещё одна сетка) ═══
  function atlas(R, size = 1024){
    const T = R.T, pages = [], A = {}, jobs = [], same = new Map();
    // страница — обычный (ускоренный) холст: рисует процесс видеокарты, в текстуру — копией в видеокарте. Замер 16.10 (телефон ×4):
    // OffscreenCanvas рисует «потом» — весь холст разом при загрузке в текстуру (60–160 мс на страницу), холст без ускорения —
    // переворот и копия на процессоре; у ускоренного дорого только первое рисование (~80 мс на страницу) — страниц 1–3 на зону
    const page = () => { const c = document.createElement('canvas'); c.width = c.height = size; const P = { c, g: c.getContext('2d'), x: 0, y: 0, rowH: 0, quads: [] }; pages.push(P); return P; };
    let cur = page();
    // место на холсте — сразу, рисунок — потом (A.drain: постройка зоны рисует по кусочку за кадр; A.mesh — что осталось)
    A.add = (text, o = {}) => {
      const w = Math.min(size, o.w || 512), h = Math.min(size, o.h || 96);
      const key = [text, w, h, o.bg, o.fg, o.border].join('|'), was = same.get(key);
      if (was) return was;   // та же надпись (табличка с двух сторон, повтор) — тот же кусок холста
      if (cur.x + w > size) { cur.x = 0; cur.y += cur.rowH + 2; cur.rowH = 0; }
      if (cur.y + h > size) cur = page();   // место кончилось — новая страница
      const x = cur.x, y = cur.y, r = { page: cur, u0: x / size, v0: 1 - (y + h) / size, u1: (x + w) / size, v1: 1 - y / size };
      jobs.push([cur, x, y, w, h, String(text), o]); same.set(key, r);
      cur.x += w + 2; cur.rowH = Math.max(cur.rowH, h);
      return r;
    };
    // ширина надписи — оценкой по буквам (measureText с эмодзи — до 1,5 мс на ПК, на телефоне ×4: рывки при подгрузке зоны);
    // если оценка ошиблась — fillText с maxWidth сам сожмёт строку по ширине
    const est = (text, fs) => { let n = 0; for (const ch of text) { const c = ch.codePointAt(0); if (c === 0xfe0f || c === 0x200d) continue; n += c > 0x2000 ? 1.25 : ch === ' ' ? .3 : /[A-ZА-ЯЁ0-9]/.test(ch) ? .78 : .64; } return n * fs; };
    const draw = ([P, x, y, w, h, text, o]) => {
      const g = P.g;
      g.fillStyle = o.bg || '#7c3aed'; g.fillRect(x, y, w, h);
      if (o.border !== false) { g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 4; g.strokeRect(x + 3, y + 3, w - 6, h - 6); }
      g.fillStyle = o.fg || '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = h * .56; const tw = est(text, fs);
      if (tw > w * .9) fs = Math.max(10, Math.floor(fs * w * .9 / tw));
      g.font = `900 ${fs}px Montserrat, Arial, sans-serif`;
      g.fillText(text, x + w / 2, y + h / 2 + 2, w * .94);
    };
    A.pending = () => jobs.length;
    A.drain = until => {
      const LS = root.__d37lbl;   // замер (world-perf lbl): сколько стоит каждая надпись
      while (jobs.length) { const t = LS ? performance.now() : 0, j = jobs.shift(); draw(j); if (LS) LS.push([+(performance.now() - t).toFixed(2), pages.indexOf(j[0]), j[5].slice(0, 14)]); if (until && performance.now() > until) break; }
      return !jobs.length;
    };
    // табличка в мире: центр (px, py, pz), размер ww × hh, поворот yaw (лицом к +z при yaw 0)
    A.quad = (r, px, py, pz, ww, hh, yaw = 0) => { if (r) r.page.quads.push({ r, px, py, pz, ww, hh, yaw }); };
    A.sign = (text, px, py, pz, ww, hh, yaw, o) => A.quad(A.add(text, o), px, py, pz, ww, hh, yaw);
    const meshOf = P => {
      const quads = P.quads;
      const pos = new Float32Array(quads.length * 18), uv = new Float32Array(quads.length * 12), nor = new Float32Array(quads.length * 18);
      quads.forEach((q, i) => {
        const c = Math.cos(q.yaw), s = Math.sin(q.yaw), hw = q.ww / 2, hh = q.hh / 2;
        const PT = (lx, ly) => [q.px + lx * c, q.py + ly, q.pz - lx * s];
        const v = [PT(-hw, -hh), PT(hw, -hh), PT(hw, hh), PT(-hw, -hh), PT(hw, hh), PT(-hw, hh)];
        const t = [[q.r.u0, q.r.v0], [q.r.u1, q.r.v0], [q.r.u1, q.r.v1], [q.r.u0, q.r.v0], [q.r.u1, q.r.v1], [q.r.u0, q.r.v1]];
        for (let k = 0; k < 6; k++) { pos.set(v[k], i * 18 + k * 3); uv.set(t[k], i * 12 + k * 2); nor.set([s, 0, c], i * 18 + k * 3); }
      });
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
      geo.computeBoundingSphere();
      const tex = new T.CanvasTexture(P.c); tex.encoding = T.sRGBEncoding; tex.anisotropy = 4;
      const mat = new T.MeshBasicMaterial({ map: tex, toneMapped: false });   // одна сторона: с изнанки — своя табличка
      R.own.push(tex, mat);
      const m = new T.Mesh(geo, mat); m.userData.mzOwn = true; m.userData.dyn = true;
      return m;
    };
    A.mesh = () => {
      A.drain();
      const L = pages.filter(P => P.quads.length).map(meshOf);
      if (!L.length) return null;
      if (L.length === 1) return L[0];
      const grp = new T.Group(); grp.userData.dyn = true; for (const m of L) grp.add(m); return grp;
    };
    A.pages = () => pages.length;
    return A;
  }

  // ═══ Фасады небоскрёбов: окна — картинкой (не сетками: 12 треугольников на ярус), ночью светятся (emissiveMap) ═══
  // Плитка — 4 этажа × 4 пролёта по 3,2 (FLOOR_H): этажи совпадают с миром (v = y / TILE), по ширине — от начала координат
  // склейки. Только стандартные материалы three (MeshStandard / Lambert), своих шейдеров нет. Свет окон — R.night (render.js).
  const TILE = FLOOR_H * 4;
  const FACADES = {
    glass: { bg: '#1e3246', a: '#a6dcf5', b: '#2c75a8', frame: '#14212f', cols: 4, wx: .96, wy: .86, top: .04, lit: .42, litC: ['#ffe2a6', '#d9eeff', '#fff4d6'], metal: .5, rough: .14, band: '#0f1c2a' },
    dark: { bg: '#0a1320', a: '#3d6790', b: '#132840', frame: '#060b14', cols: 4, wx: .96, wy: .86, top: .04, lit: .36, litC: ['#e8f3ff', '#ffe6b5'], metal: .55, rough: .12, band: '#05090f' },
    office: { bg: '#d9d3c7', a: '#7891ab', b: '#33475c', frame: '#f6f2ea', cols: 4, wx: .7, wy: .54, top: .17, lit: .5, litC: ['#ffe3a5', '#fff2cf'], rough: .82 },
    flat: { bg: '#ebe0cc', a: '#7c91aa', b: '#394c62', frame: '#ffffff', cols: 8, wx: .56, wy: .5, top: .2, lit: .55, litC: ['#ffc56e', '#ffdb9c', '#fff0c8', '#ffb38a'], balcony: '#b9ab92', rough: .9 },
    brick: { bg: 'brick', a: '#6a7f97', b: '#2c3a4b', frame: '#f4f1ea', cols: 6, wx: .52, wy: .54, top: .2, lit: .52, litC: ['#ffc56e', '#ffe0a8'], rough: .9 },
    shop: { bg: '#2d2d30', a: '#d4f0fc', b: '#86c3df', frame: '#1c1c1e', cols: 2, wx: .86, wy: .62, top: .26, lit: .95, litC: ['#fff5d8'], fascia: ['#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#0891b2'], rough: .7, ek: 1.3 },
    kids: { bg: '#fffbf2', a: '#b5e3f7', b: '#5fb3dc', frame: '#ffffff', cols: 4, wx: .46, wy: .5, top: .2, lit: .6, litC: ['#ffd27a'], shutters: ['#f472b6', '#60a5fa', '#34d399', '#fbbf24'], rough: .9 },
  };
  const hash3 = (i, j, s) => { let h = (2166136261 ^ Math.imul(i + 1, 374761393) ^ Math.imul(j + 7, 668265263) ^ Math.imul(s, 2246822519)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  function paintFacade(g, n, F, seed, em){
    const rows = 4, cell = n / rows, cols = F.cols, cw = n / cols;
    if (em) { g.fillStyle = '#000'; g.fillRect(0, 0, n, n); }
    else if (F.bg === 'brick') {
      g.fillStyle = '#d8cfc2'; g.fillRect(0, 0, n, n);
      const bh = n / 48, bw = n / 12;
      for (let r = 0; r * bh < n; r++) for (let i = -1; i < 13; i++) { const v = .82 + hash3(r, i, 5) * .3; g.fillStyle = `rgb(${158 * v | 0},${74 * v | 0},${48 * v | 0})`; g.fillRect(i * bw + (r % 2) * bw / 2 + 1, r * bh + 1, bw - 2, bh - 2); }
    } else { g.fillStyle = F.bg; g.fillRect(0, 0, n, n); }
    for (let r = 0; r < rows; r++) {
      const y0 = r * cell;
      if (F.band && !em) { g.fillStyle = F.band; g.fillRect(0, y0 + cell * .9, n, cell * .1); }
      for (let c = 0; c < cols; c++) {
        const x0 = c * cw, ww = cw * F.wx, wh = cell * F.wy, wx = x0 + (cw - ww) / 2, wy = y0 + cell * F.top;
        const lit = hash3(r, c, seed) < F.lit;
        if (F.fascia) {   // витрина: вывеска над окном (цвет — по пролёту), стекло, цоколь
          if (!em) { g.fillStyle = F.fascia[(c + r) % F.fascia.length]; g.fillRect(x0 + cw * .04, y0 + cell * .05, cw * .92, cell * .17); g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(x0 + cw * .2, y0 + cell * .11, cw * .6, cell * .05); }
          else { g.fillStyle = '#5a5040'; g.fillRect(x0 + cw * .2, y0 + cell * .11, cw * .6, cell * .05); }
        }
        if (em) {
          if (!lit) continue;
          const col = F.litC[Math.floor(hash3(c, r, seed + 3) * F.litC.length)], k = .55 + hash3(r + 9, c, seed) * .45;
          const gr = g.createLinearGradient(0, wy, 0, wy + wh); gr.addColorStop(0, col); gr.addColorStop(1, `rgba(0,0,0,${1 - k})`);
          g.globalAlpha = k; g.fillStyle = gr; g.fillRect(wx + 1, wy + 1, ww - 2, wh - 2); g.globalAlpha = 1;
          continue;
        }
        const gr = g.createLinearGradient(0, wy, 0, wy + wh), v = hash3(r, c, seed + 1) * .25;
        gr.addColorStop(0, F.a); gr.addColorStop(1, F.b);
        g.fillStyle = F.frame; g.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
        g.fillStyle = gr; g.fillRect(wx, wy, ww, wh);
        if (v > .12) { g.fillStyle = `rgba(255,255,255,${(v - .12) * .9})`; g.fillRect(wx + ww * .1, wy + wh * .08, ww * .25, wh * .84); }   // блик
        g.fillStyle = F.frame; g.fillRect(wx + ww / 2 - 1, wy, 2, wh);   // переплёт
        if (F.balcony && (r + c) % 3 === 0) { g.fillStyle = F.balcony; g.fillRect(wx - cw * .12, wy + wh, ww + cw * .24, cell * .16); }
        if (F.shutters) { g.fillStyle = F.shutters[(c + r * 2) % F.shutters.length]; g.fillRect(wx - ww * .32, wy, ww * .26, wh); g.fillRect(wx + ww * 1.06, wy, ww * .26, wh); }
      }
    }
  }
  const FAC = new WeakMap();   // R → { материалы, обновление света }
  function facadeMat(R, style, tint){
    const T = R.T, E = root.D37E;
    let F0 = FAC.get(R);
    if (!F0) {
      F0 = { mats: new Map(), list: [] };
      F0.light = () => { const k = Math.max(0, Math.min(1, (R.night || 0) * 1.25)); for (const m of F0.list) m.emissiveIntensity = k * (m.userData.ek || 1); };
      R.onLight?.push((L, o) => F0.light(o));
      FAC.set(R, F0);
    }
    const key = style + '|' + (tint || '');
    let m = F0.mats.get(key);
    if (m) return m;
    const F = FACADES[style] || FACADES.office, n = R.q === 'high' && !E?.isMobile?.() ? 512 : 256, seed = Object.keys(FACADES).indexOf(style) * 31 + 7;
    const map = R.canvasTex('mzf:' + style + n, n, g => paintFacade(g, n, F, seed, false));
    const emi = R.canvasTex('mzfe:' + style + n, n, g => paintFacade(g, n, F, seed, true));
    const o = { color: tint || '#ffffff', map, emissiveMap: emi, emissive: '#ffffff', emissiveIntensity: 0 };
    m = R.q === 'low' ? new T.MeshLambertMaterial(o) : new T.MeshStandardMaterial({ ...o, roughness: F.rough ?? .8, metalness: F.metal || 0, envMapIntensity: F.metal ? 1.15 : .7 });
    m.userData.tile = TILE; m.userData.ek = F.ek || 1; m.userData.facade = style;
    R.own.push(m); F0.mats.set(key, m); F0.list.push(m);
    F0.light({ night: R.night || 0 });
    return m;
  }

  // ═══ Набор для постройки содержимого зоны (K): детали в текущую группу, тела, здания, мебель, места, жители ═══
  function kit(rt, zs, grp){
    const { R, ph, X } = rt, T = R.T, E = root.D37E, low = R.q === 'low';
    // yo — высота «пола» для мебели на этажах небоскрёбов (ленивые интерьеры): детали — в группе на этой высоте, тела/места/предметы — + yo
    const K = { R, T, ph, X, E, rt, zs, Z: zs.Z, root: grp, cur: null, low, yo: 0, bodies: [], items: [], npcs: [], roofs: [], seats: [], anims: [], lazies: [], lifts: {}, pieceList: [], ints: [], portals: [] };
    const tex = (name, o) => R.tex(name, o);
    K.M = {
      asphalt: tex('asphalt', { tile: 4, tint: '#a9afba', flatColor: '#5b6270', rough: .95 }),
      walk: tex('tiles', { tint: '#e2dccf', tile: 1.4, flatColor: '#c9c3b5' }),
      plaza: tex('plaza', { tile: 2.6, flatColor: '#ece2cb' }),
      parquet: tex('parquet', { tile: 1.8, flatColor: '#c8956a', rough: .6 }),
      planks: tex('planks', { tint: '#e0b088', tile: 1.2, flatColor: '#a0673a', rough: .7 }),
      concrete: tex('sidewalk', { tint: '#d6d3cc', tile: 2.2, flatColor: '#b8b4aa' }),
      sand: R.texMat('mzsand', R.proc('sand'), { tile: 1.6, tint: '#d9c08f', flatColor: '#c8b07c', rough: .95 }),
      dirt: R.texMat('mzdirt', R.proc('dirt'), { tile: 2.2, tint: '#b08a62', flatColor: '#8a6a48', rough: .95 }),
      glass: (() => { const m = new T.MeshStandardMaterial({ color: '#bfe8ff', transparent: true, opacity: .32, roughness: .08, metalness: 0, depthWrite: false }); R.own.push(m); return R.fresnel ? R.fresnel(m, .5) : m; })(),
    };
    const P = p => R.part(K.cur || grp, p);
    K.part = P;
    // коробка: x, z — центр, y0 — низ; o.solid — тело, o.cam — держит камеру, o.m — материал, o.floor — звук шагов
    K.box = (x, y0, z, w, h, d, c, o = {}) => {
      const m = P({ s: 'box', x, y: y0 + h / 2, z, w, h, d, c, yaw: o.yaw, m: o.m, dyn: o.dyn, rough: o.rough, metal: o.metal });
      if (o.solid) K.bodies.push(ph.addBox({ x, y: y0 + h / 2 + K.yo, z, hx: w / 2, hy: h / 2, hz: d / 2, yaw: o.yaw || 0, tag: o.tag || 'zone', data: o.data ?? { cam: !!o.cam, floor: o.floor } }));
      return m;
    };
    K.cyl = (x, y0, z, r, h, c, o = {}) => {
      const m = P({ s: 'cyl', x, y: y0 + h / 2, z, r, r2: o.r2, h, c, seg: o.seg || 12, m: o.m, rx: o.rx, rz: o.rz, yaw: o.yaw });
      if (o.solid) K.bodies.push(ph.addCyl({ x, z, y: y0 + h / 2 + K.yo, r: o.pr || r, hy: h / 2, tag: o.tag || 'zone', data: o.data ?? { floor: o.floor } }));
      return m;
    };
    K.flat = (x, z, w, d, c, y = .03, o = {}) => P({ s: 'box', x, y: y + .005, z, w, h: .01, d, c, m: o.m, yaw: o.yaw });
    K.body = o => { const b = ph.addBox({ tag: 'zone', ...o, y: (o.y || 0) + K.yo }); K.bodies.push(b); return b; };
    K.wedge = o => { const b = ph.addWedge({ tag: 'zone', ...o, y: (o.y || 0) + K.yo }); K.bodies.push(b); return b; };
    K.group = (x = 0, y = 0, z = 0, yaw = 0, parent) => { const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = yaw; (parent || K.cur || grp).add(g); return g; };
    // готовые предметы движка (дерево, фонарь, скамейка…) — в текущую группу
    K.prefab = (name, o) => R.prefab(name, { ...o, parent: K.cur || grp }, ph);
    // ломаемое (js/engine/destruct.js): номер — по порядку постройки (у всех одинаковый), тела — свои, спрятать — в склейке
    let brkN = 0;
    const canBreak = zs.Z?.id && zs.Z.id !== 'kids';
    const brkPrefab = (name, o, spec) => {
      if (!canBreak) return K.prefab(name, o);
      const id = `z:${zs.Z.id}:${spec.kind[0]}${++brkN}`, bodies = [];
      const phW = { addCyl: c => { const b = ph.addCyl(c); bodies.push(b); return b; }, addBox: c => { const b = ph.addBox(c); bodies.push(b); return b; } };
      const g = R.prefab(name, { ...o, parent: K.cur || grp }, phW);
      if (g) g.userData.brk = id;
      K.brk.push({ id, zone: zs.Z.id, x: o.x, y: 0, z: o.z, bodies, obj: g, ...spec });
      return g;
    };
    K.brk = [];
    // дерево не растёт в стене здания (улицы и дома двигались — проверка по таблице зданий зоны)
    const solidB = ((zs.D || DEFS[zs.Z?.id])?.buildings || []).filter(b => b.h > 0 && b.type !== 'park' && b.type !== 'lot');
    K.tree = (x, z, k = 1, v = 0) => solidB.some(b => Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1) ? null
      : brkPrefab(v < 0 ? 'pine' : 'tree', { x, z, k, v: Math.max(0, v), yaw: (x * 7 + z * 3) % 6 }, { kind: v < 0 ? 'pine' : 'tree', h: (v < 0 ? 4.2 : 3.6) * k, r: .3 * k, c2: v < 0 ? '#2f7d4a' : '#4ea544' });
    // фонарь без ореола-спрайта (спрайт — отдельный вызов отрисовки на каждый; светится шар — свечение постобработки)
    K.lamp = (x, z) => {
      const ms = [P({ s: 'cyl', x, y: 1.5, z, r: .1, r2: .07, h: 3, c: '#2d2a3a', seg: 8 }), P({ s: 'cyl', x, y: .06, z, r: .22, h: .12, c: '#2d2a3a', seg: 10 }),
        P({ s: 'ball', x, y: 3.1, z, r: .26, c: '#fff3b0', m: 'glow', seg: 10 }), P({ s: 'cone', x, y: 3.38, z, r: .32, h: .22, c: '#2d2a3a', seg: 10 })];
      const body = ph.addCyl({ x, z, y: 1.5, r: .16, hy: 1.5, tag: 'lamp' }); K.bodies.push(body);
      if (canBreak) { const id = `z:${zs.Z.id}:l${++brkN}`; for (const m of ms) if (m) m.userData.brk = id; K.brk.push({ id, zone: zs.Z.id, kind: 'lamp', x, y: 0, z, h: 3.4, r: .16, c: '#2d2a3a', bodies: [body], obj: null }); }
    };
    K.label = atlas(R);
    // постройка — кусочками: K.due() — бюджет кадра кончился (stepBuild ставит t0/bud), тогда «if (K.due()) yield;»
    K.t0 = 0; K.bud = 1e9; K.due = () => performance.now() - K.t0 > K.bud;
    // взаимодействие (X) — запоминаем, чтобы зона могла выключать
    K.item = it => { if (K.yo) it = { ...it, y: (it.y || 0) + K.yo }; const x = X.add(it); K.items.push(x); return x; };
    // место: сесть / лечь (своё — без presence; другим — через zx: a + sl)
    K.seat = (x, y, z, yaw, o = {}) => { const sp = { x, y: y + K.yo, z, yaw, bed: !!o.bed, name: o.name || (o.bed ? 'Лечь спать' : 'Сесть') }; K.seats.push(sp); K.item({ x, y: y + .5, z, r: o.bed ? 1.1 : .5, prompt: () => rt.seatPrompt(sp), act: () => rt.sitDown(sp) }); return sp; };
    // житель: появляется, пока зона видна
    // o: { id, name, x, z, yaw (градусы), look, seed, act, radius, speed, say: [фразы] } → объект npc.js
    K.npc = o => {
      const n = { id: 'mz_' + o.id, name: o.name, cls: 'NPC', pos: [o.x, (o.y || 0) + K.yo, o.z], rot: [0, o.yaw || 0, 0], look: o.look || 'random', seed: o.seed || o.id, act: o.act || 'idle',
        speed: o.speed ?? 1, radius: o.radius ?? 0, damage: 0, text: (o.say || [])[0] || '', say: o.say || [], phone: o.phone ? 1 : 0, _mz: true, mz: o };
      K.npcs.push(n); return n;
    };
    // ── Здание: пол, стены с проёмами (двери, окна), крыша (своя сетка — прячется, когда внутри), зона «внутри», вывеска ──
    // spec: { id, name, x, z, w, d, h, wall, trim, floor, floorM, roofC, doors: [{ side, at, w }], windows: [{ side, at, w }], sign, signBg, interior }
    // Этаж выше первого: spec.y0 — высота пола, spec.into — группа (координаты — мировые, сдвиг группы учитывается),
    // spec.noFloor — без пола (свой, с проёмом), spec.open — без плиты крыши (над этажом — ещё этаж)
    K.building = spec => {
      const H = spec.h || 3.8, t = .3, x0 = spec.x, z0 = spec.z, hw = spec.w / 2, hd = spec.d / 2, Y = spec.y0 || 0, into = spec.into || null;
      const wallC = spec.wall || '#f4e3c3', trim = spec.trim || '#7c2d12';
      let ox = 0, oy = 0, oz = 0;
      if (into) { into.updateWorldMatrix(true, false); const e = into.matrixWorld.elements; ox = e[12]; oy = e[13]; oz = e[14]; }
      const PP = p => into ? R.part(into, { ...p, x: (p.x || 0) - ox, y: (p.y || 0) - oy, z: (p.z || 0) - oz }) : P(p);
      const BX = (x, y0, z, w, h, d, c, o = {}) => { PP({ s: 'box', x, y: y0 + h / 2, z, w, h, d, c, m: o.m }); if (o.solid) K.body({ x, y: y0 + h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, tag: 'zone', data: { cam: !!o.cam, floor: o.floor } }); };
      if (!spec.noFloor) BX(x0, Y, z0, spec.w, .12, spec.d, spec.floor || '#c79a6b', { solid: true, floor: spec.floorType || 'wood', m: spec.floorM || (spec.interior === false ? undefined : K.M.parquet) });
      for (const side of ['n', 's', 'e', 'w']) {
        const horiz = side === 'n' || side === 's', L = horiz ? spec.w : spec.d;
        const ops = [...(spec.doors || []).filter(d => d.side === side).map(d => ({ at: d.at || 0, w: d.w || 2.6, y0: 0, y1: d.h || 2.9, door: true })),
          ...(spec.windows || []).filter(w => w.side === side).map(w => ({ at: w.at || 0, w: w.w || 2, y0: w.y0 ?? 1.1, y1: (w.y0 ?? 1.1) + (w.h || 1.4) }))].sort((a, b) => a.at - b.at);
        const put = (a, b, y0, y1, glass) => {
          if (b - a < .02 || y1 - y0 < .02) return;
          const c = (a + b) / 2, len = b - a;
          const wx = horiz ? x0 + c : x0 + (side === 'e' ? hw : -hw), wz = horiz ? z0 + (side === 's' ? hd : -hd) : z0 + c;
          if (glass) { PP({ s: 'box', x: wx, y: Y + (y0 + y1) / 2, z: wz, w: horiz ? len : .06, h: y1 - y0, d: horiz ? .06 : len, m: K.M.glass }); K.body({ x: wx, y: Y + (y0 + y1) / 2, z: wz, hx: horiz ? len / 2 : t / 2, hy: (y1 - y0) / 2, hz: horiz ? t / 2 : len / 2, tag: 'glass', data: { cam: false } }); return; }
          BX(wx, Y + y0, wz, horiz ? len : t, y1 - y0, horiz ? t : len, wallC, { solid: true, cam: true });
        };
        let a = -L / 2;
        for (const p of ops) {
          const l = p.at - p.w / 2, r = p.at + p.w / 2;
          put(a, l, 0, H); put(l, r, p.y1, H);
          if (!p.door) { put(l, r, 0, p.y0); put(l, r, p.y0, p.y1, true); }
          else for (const sx of [l - .07, r + .07]) { const fx = horiz ? x0 + sx : x0 + (side === 'e' ? hw : -hw), fz = horiz ? z0 + (side === 's' ? hd : -hd) : z0 + sx; PP({ s: 'box', x: fx, y: Y + p.y1 / 2, z: fz, w: horiz ? .14 : t + .1, h: p.y1, d: horiz ? t + .1 : .14, c: trim }); }
          a = r;
        }
        put(a, L / 2, 0, H);
      }
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) PP({ s: 'box', x: x0 + sx * hw, y: Y + (H + .1) / 2, z: z0 + sz * hd, w: .45, h: H + .1, d: .45, c: trim });
      // крыша: своя группа (прячется изнутри) — плоская с бортиком; тело есть (залезть можно), камеру не держит
      const roof = new T.Group(); roof.position.set(into ? 0 : x0, 0, into ? 0 : z0); (into || grp).add(roof); roof.userData.dyn = true;
      const rx = into ? x0 - ox : 0, rz = into ? z0 - oz : 0;   // центр здания в координатах группы крыши
      const rc = spec.roofC || '#7a5236', rc2 = spec.roofC2 || trim;
      if (!spec.open) {
        R.part(roof, { s: 'box', x: rx, y: Y + H + .12 - oy, z: rz, w: spec.w + .6, h: .24, d: spec.d + .6, c: rc });
        for (const [w, d, x, z] of [[spec.w + .6, .3, 0, -(spec.d + .6) / 2], [spec.w + .6, .3, 0, (spec.d + .6) / 2], [.3, spec.d + .6, -(spec.w + .6) / 2, 0], [.3, spec.d + .6, (spec.w + .6) / 2, 0]]) {
          R.part(roof, { s: 'box', x: rx + x, z: rz + z, y: Y + H + .45 - oy, w, h: .42, d, c: rc2 });
          K.body({ x: x0 + x, z: z0 + z, y: Y + H + .45, hx: w / 2, hy: .21, hz: d / 2, tag: 'roof', data: { cam: false } });
        }
        K.body({ x: x0, z: z0, y: Y + H + .12, hx: (spec.w + .6) / 2, hy: .12, hz: (spec.d + .6) / 2, tag: 'roof', data: { cam: false } });
      }
      if (spec.interior !== false) {
        K.roofs.push(roof);
        var trig = K.body({ x: x0, z: z0, y: Y + H / 2, hx: hw - .3, hy: H / 2 + .3, hz: hd - .3, trigger: true, tag: 'room', data: { room: spec.id, roof } });
      }
      // вывеска над первой дверью (в атлас зоны)
      if (spec.sign) {
        const d = (spec.doors || [])[0], side = d?.side || 's', sw = Math.min(spec.w - 1, 7);
        const px = side === 'e' ? x0 + hw + .2 : side === 'w' ? x0 - hw - .2 : x0 + (d?.at || 0), pz = side === 's' ? z0 + hd + .2 : side === 'n' ? z0 - hd - .2 : z0 + (d?.at || 0);
        const yaw = side === 's' ? 0 : side === 'n' ? PI : side === 'e' ? PI / 2 : -PI / 2;
        K.label.sign(spec.sign, px, Y + Math.min(H - .45, (d?.h || 2.9) + .55), pz, sw, sw / 5.3, yaw, { bg: spec.signBg || trim });
      }
      return { x0, z0, hw, hd, H, roof, trig: trig || null };
    };
    // Пандус-«призма» (насыпь эстакады, лестница-скат): низ — у +z, верх — у −z (как клин physics.js), поворот yaw; тело — клин
    K.prism = (x, z, w, L, h, yaw, m, o = {}) => {
      const geo = R.K.geo(`mzprism${w}_${L}_${h}`, () => {
        const a = -w / 2, b = w / 2, f = L / 2, k = -L / 2, V = [];
        const quad = (p, q, r, s) => V.push(...p, ...q, ...r, ...p, ...r, ...s);
        quad([a, h, k], [a, 0, f], [b, 0, f], [b, h, k]);   // скат
        quad([b, h, k], [b, 0, k], [a, 0, k], [a, h, k]);   // задняя стенка
        V.push(a, 0, k, a, 0, f, a, h, k); V.push(b, 0, k, b, h, k, b, 0, f);   // бока
        const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(V, 3)); g.computeVertexNormals(); return g;
      });
      const mesh = new T.Mesh(geo, m || R.mat('#a8a29e')); mesh.position.set(x, o.y0 || 0, z); mesh.rotation.y = yaw; (K.cur || grp).add(mesh);
      if (o.solid !== false) K.wedge({ x, z, y: (o.y0 || 0) + h / 2, hx: w / 2, hy: h / 2, hz: L / 2, yaw, data: { floor: o.floor || 'concrete', cam: false } });
      return mesh;
    };
    // ── Мебель и уличное ──
    K.table = (x, z, w = 1.4, d = .9, c = '#8b5a2b', h = .78) => { K.box(x, h - .07, z, w, .07, d, c); for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P({ s: 'box', x: x + sx * (w / 2 - .08), y: (h - .07) / 2, z: z + sz * (d / 2 - .08), w: .07, h: h - .07, d: .07, c: '#5b3a1e' }); K.body({ x, z, y: h / 2, hx: w / 2, hy: h / 2, hz: d / 2, tag: 'table' }); };
    K.chair = (x, z, yaw, c = '#8b5a2b') => {
      const g = K.group(x, 0, z, yaw);
      R.part(g, { s: 'box', y: .5, w: .6, h: .09, d: .6, c }); R.part(g, { s: 'box', y: .88, z: -.27, w: .6, h: .66, d: .08, c });
      for (const [lx, lz] of [[-.25, -.25], [.25, -.25], [-.25, .25], [.25, .25]]) R.part(g, { s: 'box', x: lx, y: .23, z: lz, w: .07, h: .46, d: .07, c: '#5b3a1e' });
      K.body({ x, z, y: .45, hx: .3, hy: .45, hz: .3, yaw, tag: 'chair' });
      return K.seat(x, .55, z, yaw);
    };
    K.bed = (x, z, yaw, c = '#60a5fa') => {   // кровать: изголовье — к −z локально
      const g = K.group(x, 0, z, yaw);
      R.part(g, { s: 'box', y: .25, w: 1.5, h: .36, d: 2.3, c: '#8b5a2b' }); R.part(g, { s: 'box', y: .5, w: 1.42, h: .16, d: 2.2, c: '#f8fafc' });
      R.part(g, { s: 'box', y: .52, z: .35, w: 1.44, h: .2, d: 1.5, c }); R.part(g, { s: 'box', y: .62, z: -.8, w: .9, h: .14, d: .45, c: '#ffffff' });
      R.part(g, { s: 'box', y: .75, z: -1.15, w: 1.5, h: 1, d: .12, c: '#7c4a26' });
      K.body({ x, z, y: .3, hx: .75, hy: .3, hz: 1.15, yaw, tag: 'bed' });
      return K.seat(x, .62, z, yaw, { bed: true });
    };
    K.sofa = (x, z, yaw, c = '#7c3aed') => {
      const g = K.group(x, 0, z, yaw);
      R.part(g, { s: 'box', y: .3, w: 2.2, h: .5, d: .9, c }); R.part(g, { s: 'box', y: .78, z: -.35, w: 2.2, h: .6, d: .22, c });
      for (const s of [-1, 1]) R.part(g, { s: 'box', x: s * 1, y: .58, w: .22, h: .5, d: .9, c });
      K.body({ x, z, y: .4, hx: 1.1, hy: .4, hz: .45, yaw, tag: 'sofa' });
      for (const s of [-1, 1]) K.seat(x + Math.cos(yaw) * .5 * s, .56, z - Math.sin(yaw) * .5 * s, yaw, { name: 'Сесть на диван' });
    };
    K.bench = (x, z, yaw) => { brkPrefab('bench', { x, z, yaw, m: K.M.planks }, { kind: 'bench', w: 2.2, d: .62, h: 1, yaw, c: '#a0673a' }); for (const s of [-1, 1]) K.seat(x + Math.cos(yaw) * .55 * s, .62, z - Math.sin(yaw) * .55 * s, yaw, { name: 'Сесть на скамейку' }); };
    K.counter = (x, z, w, d, c = '#7c2d12', top = '#fed7aa', yaw = 0) => { K.box(x, 0, z, w, 1.05, d, c, { solid: true, yaw }); P({ s: 'box', x, y: 1.09, z, w: w + .1, h: .08, d: d + .1, c: top, yaw }); };
    K.shelf = (x, z, w, yaw = 0, items = ['#ef4444', '#facc15', '#22c55e', '#3b82f6']) => {
      const g = K.group(x, 0, z, yaw);
      R.part(g, { s: 'box', y: 1, w, h: 2, d: .45, c: '#a16207' });
      for (let r = 0; r < 3; r++) for (let i = 0; i < Math.floor(w / .35); i++) R.part(g, { s: 'box', x: -w / 2 + .25 + i * .35, y: .45 + r * .6, z: .25, w: .24, h: .3, d: .16, c: items[(i + r) % items.length] });
      K.body({ x, z, y: 1, hx: w / 2, hy: 1, hz: .25, yaw, tag: 'shelf' });
    };
    K.plant = (x, z) => { K.cyl(x, 0, z, .3, .5, '#b45309', { r2: .38, solid: true, pr: .35 }); P({ s: 'ico', x, y: 1, z, r: .55, c: '#3f9a4c', det: 1 }); };
    K.rug = (x, z, w, d, c) => P({ s: 'box', x, y: .13, z, w, h: .02, d, c });
    K.lampIn = (x, y, z) => { P({ s: 'cyl', x, y: y + .4, z, r: .02, h: .8, c: '#222' }); P({ s: 'cone', x, y, z, r: .35, h: .3, c: '#fbbf24', seg: 10 }); P({ s: 'ball', x, y: y - .1, z, r: .13, c: '#fff6c8', m: 'glow', seg: 8 }); };
    K.board = (x, y, z, w, h, yaw, text, o = {}) => { P({ s: 'box', x, y, z, w: w + .16, h: h + .16, d: .08, c: o.frame || '#3b2a1c', yaw }); K.label.sign(text, x + Math.sin(yaw) * .05, y, z + Math.cos(yaw) * .05, w, h, yaw, { bg: o.bg || '#14532d', w: 512, h: Math.round(512 * h / w) }); };
    // ── Улица: дорога с тротуарами и разметкой, зебра, фонари ──
    K.road = (x1, z1, x2, z2, w = 8, o = {}) => {
      const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz), cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
      const ry = o.y ?? .025;
      P({ s: 'box', x: cx, y: ry, z: cz, w, h: .02, d: L, yaw, m: o.m || K.M.asphalt });
      if (o.walk !== false) for (const s of [-1, 1]) {
        const ox = Math.cos(yaw) * (w / 2 + 1.3) * s, oz = -Math.sin(yaw) * (w / 2 + 1.3) * s;
        P({ s: 'box', x: cx + ox, y: .07, z: cz + oz, w: 2.6, h: .14, d: L, yaw, m: K.M.walk });
      }
      if (o.lines !== false) for (let k = 4; k < L - 4; k += 5) P({ s: 'box', x: x1 + dx * k / L, y: ry + .015, z: z1 + dz * k / L, w: .22, h: .01, d: 2, yaw, c: '#f1f5f9' });
    };
    K.zebra = (x, z, w, yaw = 0) => { for (let i = 0; i < 7; i++) { const o = -w / 2 + .6 + i * (w - 1.2) / 6; P({ s: 'box', x: x + Math.cos(yaw) * o, y: .045, z: z - Math.sin(yaw) * o, w: .5, h: .01, d: 3, yaw, c: '#f8fafc' }); } };

    // ── Ленивый интерьер: строится, когда игрок ближе r (мебель этажей, магазины ТЦ, номера отеля); дальше r + 60 — прячется.
    //    gen(K) — как обычная постройка (K.cur — своя группа на высоте y, тела и места — с поправкой K.yo); без надписей (атлас готов) ──
    // parent — группа этажа (прячется вместе с ним: мебель 2-го этажа не висит в воздухе, когда ты на 1-м)
    K.lazy = (x, z, r, gen, y = 0, parent = null) => K.lazies.push({ x, z, r, gen, y, parent, done: false, grp: null });
    // ── Небоскрёб без входа: витрины внизу, ярусы с фасадом (окна светятся ночью), крыша — цвет типа здания, верх ──
    // spec: { id, x, z, w, d, h, h1 (верх основного яруса), style, tint, base ('shop'), baseH, tiers: [{ w, d, h, dx, dz }], crown, roof, logo }
    K.tower = (spec, parent) => {
      const g = parent || K.cur || grp, m = facadeMat(R, spec.style || 'office', spec.tint), roofC = spec.roof || '#4b5563', ox = parent ? spec.x : 0, oz = parent ? spec.z : 0;
      const gx = x => x - (parent ? ox : 0), gz = z => z - (parent ? oz : 0);   // в группе здания — свои координаты
      let top = spec.y0 || 0;
      // входимая башня: фасад — 4 плоскости лицом наружу (изнутри их не видно), карнизы и уступы — рамкой (сверху внутрь не мешают)
      const hollow = !!(spec.door && INTF());
      const walls = (x, z, w, d, y0, y1, mat) => {
        if (!hollow) { R.part(g, { s: 'box', x: gx(x), y: (y0 + y1) / 2, z: gz(z), w, h: y1 - y0, d, m: mat }); return; }
        const h = y1 - y0, y = (y0 + y1) / 2;
        R.part(g, { s: 'plane', x: gx(x), y, z: gz(z + d / 2), w, d: h, m: mat });
        R.part(g, { s: 'plane', x: gx(x), y, z: gz(z - d / 2), w, d: h, yaw: PI, m: mat });
        R.part(g, { s: 'plane', x: gx(x + w / 2), y, z: gz(z), w: d, d: h, yaw: PI / 2, m: mat });
        R.part(g, { s: 'plane', x: gx(x - w / 2), y, z: gz(z), w: d, d: h, yaw: -PI / 2, m: mat });
      };
      const ring = (x, z, w, d, y, h, c, hole) => {   // рамка вокруг «дыры» (верхний ярус) или сплошная плита
        if (!hollow) { R.part(g, { s: 'box', x: gx(x), y, z: gz(z), w, h, d, c }); return; }
        const iw = hole ? hole.w : w - .6, id = hole ? hole.d : d - .6, sx = (w - iw) / 2, sz = (d - id) / 2;
        R.part(g, { s: 'box', x: gx(x), y, z: gz(z - d / 2 + sz / 2), w, h, d: sz, c }); R.part(g, { s: 'box', x: gx(x), y, z: gz(z + d / 2 - sz / 2), w, h, d: sz, c });
        R.part(g, { s: 'box', x: gx(x - w / 2 + sx / 2), y, z: gz(z), w: sx, h, d: id, c }); R.part(g, { s: 'box', x: gx(x + w / 2 - sx / 2), y, z: gz(z), w: sx, h, d: id, c });
      };
      if (spec.base && !spec.y0) {
        const bh = spec.baseH || FLOOR_H;
        walls(spec.x, spec.z, spec.w, spec.d, 0, bh, facadeMat(R, spec.base));
        ring(spec.x, spec.z, spec.w + .5, spec.d + .5, bh + .1, .2, spec.trim || '#3f3f46', { w: spec.w - .1, d: spec.d - .1 });
        top = bh;
      }
      const shafts = [{ w: spec.w, d: spec.d, h: spec.h1 || spec.h, dx: 0, dz: 0 }, ...(spec.tiers || [])], tb = [];
      let last = shafts[0], first = true;
      for (const [ti, t] of shafts.entries()) {
        const x = spec.x + (t.dx || 0), z = spec.z + (t.dz || 0), hh = t.h - top;
        if (hh <= .05) continue;
        walls(x, z, t.w, t.d, top, t.h, m);
        const up = shafts[ti + 1];   // уступ под следующим ярусом — рамкой; самый верх — сплошная крыша
        if (up) ring(x, z, t.w + .3, t.d + .3, t.h + .15, .3, roofC, { w: up.w - .02, d: up.d - .02 });
        else R.part(g, { s: 'box', x: gx(x), y: t.h + .15, z: gz(z), w: t.w + .3, h: .3, d: t.d + .3, c: roofC });
        const b0 = first ? (spec.y0 || 0) : top;
        if (!spec.door || !INTF()) tb.push(K.body({ x, z, y: (b0 + t.h + .3) / 2, hx: t.w / 2 + .15, hy: (t.h + .3 - b0) / 2, hz: t.d / 2 + .15, tag: 'tower', data: { cam: true, floor: 'concrete' } }));
        top = t.h + .3; last = { ...t, x, z }; first = false;
      }
      const lx = last.x ?? spec.x, lz = last.z ?? spec.z, lw = last.w, ld = last.d;
      // ── входимая башня (E.interior): оболочка — стены со входом и плиты; этажи строятся, когда игрок рядом / приехал лифтом ──
      const INT = INTF();
      if (spec.door && INT) {
        for (const sb of INT.shell(spec)) tb.push(K.body({ x: sb.x, z: sb.z, y: sb.y, hx: sb.hx, hy: sb.hy, hz: sb.hz, tag: 'tower', data: { cam: sb.cam, floor: 'concrete' } }));
        if (!spec.shellFrom) {   // вход на фасаде: рама, тёмный проём, козырёк (снаружи видно, где дверь)
          const D = spec.door, side = D.side || 's', at = D.at || 0, hw = spec.w / 2, hd = spec.d / 2, dw = D.w || 2.4;
          const [dx, dz, yaw] = side === 'n' ? [spec.x + at, spec.z - hd - .07, PI] : side === 's' ? [spec.x + at, spec.z + hd + .07, 0] : side === 'e' ? [spec.x + hw + .07, spec.z + at, PI / 2] : [spec.x - hw - .07, spec.z + at, -PI / 2];
          const fx = Math.sin(yaw), fz = Math.cos(yaw), ax = Math.cos(yaw), az = -Math.sin(yaw);
          // тёмный проём (снаружи видно «там вход»): общий InstancedMesh зоны; построен первый этаж — проём прячется, видно холл
          spec._portal = { x: dx, y: 1.32, z: dz, yaw, w: dw - .1, h: 2.64 }; K.portals.push(spec._portal);
          for (const sd of [-1, 1]) R.part(g, { s: 'box', x: gx(dx + ax * sd * (dw / 2 + .05)), y: 1.4, z: gz(dz + az * sd * (dw / 2 + .05)), w: .14, h: 2.8, d: .16, yaw, c: spec.trim || '#334155' });
          R.part(g, { s: 'box', x: gx(dx + fx * .7), y: 2.95, z: gz(dz + fz * .7), w: dw + 1.2, h: .14, d: 1.4, yaw, c: spec.trim || '#334155' });
          if (spec.sign) K.label.sign(spec.sign, dx + fx * .08, 3.55, dz + fz * .08, Math.min(spec.w - 1, 6), 1, yaw, { bg: spec.signBg || '#1e3a8a', w: 512, h: 86 });
        }
        K.ints.push(spec);
      }
      // на крыше: вентиляция, бак, будка лестницы (сверху город живее)
      if (spec.crown !== 'helipad' && lw > 8 && !(hollow && spec.roofKind !== 'none')) {   // у входимой башни крыша — своя (E.interior.roofMount: с телами)
        R.part(g, { s: 'box', x: gx(lx - lw * .25), y: top + .6, z: gz(lz + ld * .2), w: 2.4, h: 1.2, d: 1.6, c: '#9ca3af' });
        R.part(g, { s: 'cyl', x: gx(lx + lw * .22), y: top + 1.3, z: gz(lz - ld * .22), r: 1.1, h: 2.6, c: '#78716c', seg: 10 });
        R.part(g, { s: 'box', x: gx(lx + lw * .2), y: top + 1.2, z: gz(lz + ld * .25), w: 3, h: 2.4, d: 2.4, c: '#a8a29e' });
      }
      const red = R.glow('#ff3b3b');
      const crown = spec.crown || '';
      if (crown === 'antenna') {
        R.part(g, { s: 'cyl', x: gx(lx), y: top + 7, z: gz(lz), r: .28, r2: .18, h: 14, c: '#374151', seg: 8 });
        R.part(g, { s: 'cyl', x: gx(lx), y: top + 18, z: gz(lz), r: .1, h: 8, c: '#9ca3af', seg: 6 });
        R.part(g, { s: 'ball', x: gx(lx), y: top + 22.2, z: gz(lz), r: .35, m: red, seg: 8 });
      } else if (crown === 'spire') {
        R.part(g, { s: 'cone', x: gx(lx), y: top + 9, z: gz(lz), r: Math.min(lw, ld) * .2, h: 18, c: '#d1d5db', seg: 8 });
        R.part(g, { s: 'ball', x: gx(lx), y: top + 18.3, z: gz(lz), r: .38, m: red, seg: 8 });
      } else if (crown === 'helipad') {
        const r0 = Math.min(lw, ld) * .42;
        R.part(g, { s: 'cyl', x: gx(lx), y: top + .08, z: gz(lz), r: r0, h: .16, c: '#374151', seg: 24 });
        R.part(g, { s: 'ring', x: gx(lx), y: top + .18, z: gz(lz), r: r0 * .92, r2: r0 * .82, rx: -PI / 2, c: '#facc15' });
        for (const [w, d, x] of [[.7, r0 * .9, -r0 * .3], [.7, r0 * .9, r0 * .3], [r0 * .6, .7, 0]]) R.part(g, { s: 'box', x: gx(lx + x), y: top + .19, z: gz(lz), w, h: .02, d, c: '#f8fafc' });
        K.body({ x: lx, z: lz, y: top + .08, hx: r0 * .7, hy: .08, hz: r0 * .7, tag: 'roof', data: { cam: false } });
      } else if (crown === 'pyramid') {
        R.part(g, { s: 'cone', x: gx(lx), y: top + lw * .35, z: gz(lz), r: Math.min(lw, ld) * .72, h: lw * .7, c: roofC, seg: 4, yaw: PI / 4 });
      } else if (crown === 'glow') {   // светящийся венец (виден ночью издалека)
        const gm = R.glow(spec.glowC || '#a78bfa');
        for (const [w, d, x, z] of [[lw + .4, .3, 0, ld / 2 + .1], [lw + .4, .3, 0, -ld / 2 - .1], [.3, ld + .4, lw / 2 + .1, 0], [.3, ld + .4, -lw / 2 - .1, 0]]) R.part(g, { s: 'box', x: gx(lx + x), y: top - .8, z: gz(lz + z), w, h: .5, d, m: gm });
        R.part(g, { s: 'cyl', x: gx(lx), y: top + 9, z: gz(lz), r: .3, r2: .12, h: 18, c: '#e5e7eb', seg: 8 });
        R.part(g, { s: 'ball', x: gx(lx), y: top + 18.4, z: gz(lz), r: .4, m: red, seg: 8 });
      }
      // огни для самолётов на углах высоких башен
      if (spec.h > 50 && crown !== 'glow') for (const [sx, sz] of [[-1, -1], [1, 1]]) R.part(g, { s: 'ball', x: gx(lx + sx * (lw / 2 - .3)), y: top + .3, z: gz(lz + sz * (ld / 2 - .3)), r: .22, m: red, seg: 6 });
      if (spec.logo) for (const s of [1, -1]) K.label.sign(spec.logo, lx, top - 4.6, lz + s * (ld / 2 + .08), Math.min(lw - 2, 10), 4, s > 0 ? 0 : PI, { bg: spec.logoBg || '#0f172a', w: 384, h: 154, fg: spec.logoFg || '#fde047' });
      return { top, x: lx, z: lz, w: lw, d: ld, bodies: tb };
    };

    // ── Крыша с видом: ограждение по краю, будка лифта в углу; вернёт остановку лифта. g — группа (её начало — gx0, gz0) ──
    K.roofDeck = (g, gx0, gz0, t, name) => {
      const top = t.top;
      for (const [ww, dd, px, pz] of [[t.w, .3, 0, -t.d / 2], [t.w, .3, 0, t.d / 2], [.3, t.d, -t.w / 2, 0], [.3, t.d, t.w / 2, 0]]) {
        R.part(g, { s: 'box', x: t.x - gx0 + px, y: top + .55, z: t.z - gz0 + pz, w: ww, h: 1.1, d: dd, c: '#cbd5e1' });
        K.body({ x: t.x + px, z: t.z + pz, y: top + .55, hx: Math.max(ww, .3) / 2, hy: .55, hz: Math.max(dd, .3) / 2, tag: 'rail', data: { cam: false } });
      }
      const bx = t.x - t.w / 2 + 2.2, bz = t.z - t.d / 2 + 2.2;
      R.part(g, { s: 'box', x: bx - gx0, y: top + 1.3, z: bz - gz0, w: 3, h: 2.6, d: 3, c: '#e5e7eb' });
      R.part(g, { s: 'box', x: bx - gx0 + 1.52, y: top + 1.1, z: bz - gz0, w: .04, h: 2.2, d: 1.6, c: '#94a3b8' });
      K.body({ x: bx, z: bz, y: top + 1.3, hx: 1.5, hy: 1.3, hz: 1.5, tag: 'lift', data: { cam: false } });
      return { name, at: top, x: bx + 2.6, z: bz, yaw: PI / 2, roof: true };
    };
    // ── Лифт из списка остановок { name, at, x, z, yaw, ix, iz } (кнопка — у точки ix/iz или у самой остановки) ──
    K.addLift = (id, name, stops) => {
      K.lifts[id] = { name, stops };
      stops.forEach((s, k) => K.items.push(X.add({ x: s.ix ?? s.x, y: s.at + 1.2, z: s.iz ?? s.z, r: 1.5, prompt: () => `🛗 Лифт · ${s.name}`, act: () => rt.liftPanel(id, k) })));
      return K.lifts[id];
    };

    // ── Многоэтажный паркинг: этажи-плиты, пандусы (клинья: заехать и зайти), колонны, борта, разметка; лифт.
    // Каждый ярус прячет то, что выше (вложенные группы). spec: { id, x, z, w, d, levels (3), lh (высота яруса) } ──
    K.garage = spec => {
      const { id, x: cx, z: cz, w, d } = spec, n = spec.levels || 3, lh = spec.lh || 3.6, x0 = cx - w / 2, z0 = cz - d / 2, conc = K.M.concrete;
      const RL = Math.min(30, w - 16), strip = 6;   // длина пандуса, ширина полосы пандуса
      const lift = { name: spec.name || 'Паркинг', stops: [] };
      const lv = [];   // группа каждого яруса: ярус L — всё, что от его пола до пола следующего (колонны, будка лифта, пандус вверх)
      let parent = K.group(cx, 0, cz, 0, grp); parent.userData.dyn = true; K.roofs.push(parent);
      for (let L = 0; L < n; L++) { const g = L ? new T.Group() : parent; if (L) { g.userData.dyn = true; lv[L - 1].add(g); K.roofs.push(g); } lv.push(g); }
      const box = (g, a, b, c, e, y0, y1, o) => { R.part(g, { s: 'box', x: (a + b) / 2 - cx, y: (y0 + y1) / 2, z: (c + e) / 2 - cz, w: b - a, h: y1 - y0, d: e - c, ...o }); };
      for (let L = 0; L < n; L++) {
        const g = lv[L], y = L * lh;
        // плита яруса (на земле — асфальт улицы): пол там, где снизу не проходит пандус
        if (L > 0) {
          const fromS = (L - 1) % 2 === 0, rx0 = fromS ? x0 + 4 : x0 + w - 4 - RL, rx1 = rx0 + RL;
          const slabs = [[x0, x0 + w, z0 + strip, z0 + d - strip]];
          if (fromS) slabs.push([x0, x0 + w, z0, z0 + strip], [rx1, x0 + w, z0 + d - strip, z0 + d], [x0, rx0, z0 + d - strip, z0 + d]);
          else slabs.push([x0, x0 + w, z0 + d - strip, z0 + d], [x0, rx0, z0, z0 + strip], [rx1, x0 + w, z0, z0 + strip]);
          for (const [a, b, c, e] of slabs) if (b - a > .2 && e - c > .2) {
            box(g, a, b, c, e, y - .36, y, { m: conc });
            K.body({ x: (a + b) / 2, z: (c + e) / 2, y: y - .18, hx: (b - a) / 2, hy: .18, hz: (e - c) / 2, tag: 'deck', data: { cam: false, floor: 'concrete' } });
          }
          // борта по краю (кроме полосы, где снизу пандус)
          for (const zz of [z0 + .12, z0 + d - .12]) { box(g, x0, x0 + w, zz - .12, zz + .12, y, y + .9, { c: '#d6d3d1' }); K.body({ x: cx, z: zz, y: y + .45, hx: w / 2, hy: .45, hz: .12, tag: 'rail', data: { cam: false } }); }
          for (const xx of [x0 + .12, x0 + w - .12]) { box(g, xx - .12, xx + .12, z0, z0 + d, y, y + .9, { c: '#d6d3d1' }); K.body({ x: xx, z: cz, y: y + .45, hx: .12, hy: .45, hz: d / 2, tag: 'rail', data: { cam: false } }); }
          // колонны (стоят в ярусе ниже — видны, пока ты там)
          for (let px = x0 + 8; px < x0 + w - 4; px += 10) for (const pz of [z0 + strip + .4, z0 + d - strip - .4]) {
            box(lv[L - 1], px - .3, px + .3, pz - .3, pz + .3, y - lh, y - .36, { c: '#a8a29e' });
            K.body({ x: px, z: pz, y: y - lh / 2 - .18, hx: .3, hy: (lh - .36) / 2, hz: .3, tag: 'pillar', data: { cam: false } });
          }
        }
        // пандус на следующий ярус: с чётного — по южной полосе на восток, с нечётного — по северной на запад
        if (L < n - 1) {
          const south = L % 2 === 0, rz = south ? z0 + d - strip / 2 : z0 + strip / 2, rx0 = south ? x0 + 4 : x0 + w - 4 - RL, ang = Math.atan2(lh, RL);
          R.part(g, { s: 'box', x: rx0 + RL / 2 - cx, y: y + lh / 2 - .1, z: rz - cz, w: Math.hypot(RL, lh), h: .3, d: strip - .4, rz: south ? ang : -ang, m: conc });
          K.wedge({ x: rx0 + RL / 2, z: rz, y: y + lh / 2, hx: (strip - .4) / 2, hy: lh / 2, hz: RL / 2, yaw: south ? -PI / 2 : PI / 2, data: { floor: 'concrete', cam: false } });
          for (const s of [-1, 1]) R.part(g, { s: 'box', x: rx0 + RL / 2 - cx, y: y + lh / 2 + .35, z: rz - cz + s * (strip / 2 - .15), w: Math.hypot(RL, lh), h: .5, d: .2, rz: south ? ang : -ang, c: '#facc15' });
          // ярус — «комната»: что выше, прячется
          K.body({ x: cx, z: cz, y: y + lh / 2, hx: w / 2 - .3, hy: lh / 2 - .25, hz: d / 2 - .3, trigger: true, tag: 'room', data: { room: id + ':' + L, roof: lv[L + 1] } });
        }
        // разметка мест и будка лифта
        for (let px = x0 + 6; px < x0 + w - 4; px += 3.2) R.part(g, { s: 'box', x: px - cx, y: y + .025, z: 0, w: .12, h: .02, d: d - 2 * strip - 3, c: '#f8fafc' });
        box(g, x0 + .2, x0 + 1.6, cz - 2.3, cz - .9, y, y + 2.6, { c: '#e5e7eb' });
        K.body({ x: x0 + .9, z: cz - 1.6, y: y + 1.3, hx: .7, hy: 1.3, hz: .7, tag: 'lift', data: { cam: false } });
        lift.stops.push({ name: L === 0 ? 'Въезд' : L === n - 1 ? 'Крыша паркинга' : `Ярус ${L + 1}`, at: y + (L ? 0 : .02), x: x0 + 2.4, z: cz, yaw: -PI / 2 });
      }
      K.lifts[id] = lift;
      for (const [k, s] of lift.stops.entries()) K.items.push(X.add({ x: x0 + 2.2, y: s.at + 1.2, z: cz - 1.6, r: 1.4, prompt: () => `🛗 Лифт · ${s.name}`, act: () => rt.liftPanel(id, k) }));
      return lift;
    };

    // ── Детали с постоянными номерами (боевая зона): стены кусками, плиты, окна, колонны, крыша, укрытия — для будущих
    //    разрушений («как в Майне, или на куски»). Рисуются InstancedMesh (одна сетка на материал и кусок 96 м): спрятать
    //    деталь = матрица нулевого размера; у каждой своё тело (data.piece = номер). Реестр — rt.pieces ──
    K.piece = o => {
      const p = { ...o, y: o.y + K.yo, zone: zs.Z.id, destructible: o.destructible !== false, hp: o.hp || (o.kind === 'window' ? 10 : o.kind === 'bag' ? 30 : 60), broken: false };
      if (o.solid !== false) { p.body = ph.addBox({ x: p.x, y: p.y, z: p.z, hx: p.w / 2, hy: p.h / 2, hz: p.d / 2, yaw: p.yaw || 0, tag: 'piece', data: { piece: p.id, cam: !!o.cam, floor: o.floor } }); K.bodies.push(p.body); }
      K.pieceList.push(p);
      return p;
    };
    K.mbuilding = spec => {
      const list = modular(spec).map(K.piece), roofList = list.filter(p => p.kind === 'roof' || p.kind === 'parapet');
      const roof = pieceGroup(roofList);
      if (spec.interior !== false) K.body({ x: spec.x, z: spec.z, y: (spec.h || 3.8) / 2, hx: spec.w / 2 - .3, hy: (spec.h || 3.8) / 2 + .3, hz: spec.d / 2 - .3, trigger: true, tag: 'room', data: { room: spec.id, roof } });
      if (spec.sign) {
        const dd = (spec.doors || [])[0], side = dd?.side || 's', hw = spec.w / 2, hd = spec.d / 2, sw = Math.min(spec.w - 1, 7);
        const px = side === 'e' ? spec.x + hw + .2 : side === 'w' ? spec.x - hw - .2 : spec.x + (dd?.at || 0), pz = side === 's' ? spec.z + hd + .2 : side === 'n' ? spec.z - hd - .2 : spec.z + (dd?.at || 0);
        K.label.sign(spec.sign, px, Math.min((spec.h || 3.8) - .45, (dd?.h || 2.9) + .55), pz, sw, sw / 5.3, side === 's' ? 0 : side === 'n' ? PI : side === 'e' ? PI / 2 : -PI / 2, { bg: spec.signBg || spec.trim });
      }
      return { list, roof };
    };
    // кусок готов — склеить (группа куска — новый ребёнок корня)
    K.chunk = name => { if (K.cur) K.flush(); K.cur = new T.Group(); K.cur.name = name || ''; grp.add(K.cur); return K.cur; };
    // склейка — потом, всей зоной по клеткам (prepMerge в start): куски одной улицы и разных зданий в одной клетке — одна сетка
    K.flush = () => { K.cur = null; };
    const PK = root.__d37profK;   // замер (scripts/world-perf.cjs kprof): сколько стоят функции набора — с вложенными
    if (PK) for (const k of Object.keys(K)) if (typeof K[k] === 'function' && !['due', 'chunk', 'flush'].includes(k)) {
      const f = K[k]; K[k] = function(...a){ const t = performance.now(); try { return f.apply(this, a); } finally { PK[k] = (PK[k] || 0) + performance.now() - t; PK['#' + k] = (PK['#' + k] || 0) + 1; } };
    }
    if (PK && K.label) for (const k of ['add', 'sign', 'mesh']) { const f = K.label[k]; K.label[k] = function(...a){ const t = performance.now(); try { return f.apply(this, a); } finally { PK['label.' + k] = (PK['label.' + k] || 0) + performance.now() - t; } }; }
    return K;
  }

  // ═══ Постройка мира (крючок в buildWorld, до склейки мира): дороги, телепорты лобби, щит-карта, ворота зон ═══
  let BUILT = null;
  function build(ctx){
    const { R, ph, X, S, P, M } = ctx, T = R.T, E = root.D37E;
    const st = R.static;
    // дороги: асфальт, тротуары, разметка
    for (const r of ROADS) for (let i = 1; i < r.pts.length; i++) {
      const [x1, z1] = r.pts[i - 1], [x2, z2] = r.pts[i], dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz), cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
      P(null, { s: 'box', x: cx, y: .021, z: cz, w: r.w, h: .02, d: L + r.w * .5, yaw, m: M.asphalt });
      for (const s of [-1, 1]) { const ox = Math.cos(yaw) * (r.w / 2 + 1) * s, oz = -Math.sin(yaw) * (r.w / 2 + 1) * s; P(null, { s: 'box', x: cx + ox, y: .06, z: cz + oz, w: 2, h: .12, d: L, yaw, m: M.walk }); }
      for (let k = 4; k < L - 4; k += 5) P(null, { s: 'box', x: x1 + dx * k / L, y: .036, z: z1 + dz * k / L, w: .22, h: .01, d: 2, yaw, c: '#f1f5f9' });
      for (let k = 12; k < L - 6; k += 24) for (const s of [-1, 1]) R.prefab('lamp', { x: x1 + dx * k / L + Math.cos(yaw) * (r.w / 2 + 2.4) * s, z: z1 + dz * k / L - Math.sin(yaw) * (r.w / 2 + 2.4) * s }, ph);
    }
    // вода моря и канала (дыры в земле) — видна сразу, до подгрузки зон; дно — песок, края — каменные стенки
    const open = !!worldMap();   // с картой гавань открыта в океан: вода и дно — карты, стенка — только набережная
    for (const [r, c, key] of [[SEA, '#2f7fc1', 'mzsea'], [CANAL, '#3a8fd0', 'mzcanal']]) {
      const sea = r === SEA;
      if (!(open && sea)) {
        const wm = R.water(c, { key, fixedColor: true }); wm.side = T.DoubleSide;   // из-под воды видно поверхность
        const m = new T.Mesh(new T.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0), wm); m.rotation.x = -PI / 2; m.position.set((r.x0 + r.x1) / 2, r.wl, (r.z0 + r.z1) / 2);
        m.userData.dyn = true; R.scene.add(m); R.own.push(m.geometry);
        P(null, { s: 'box', x: (r.x0 + r.x1) / 2, y: r.floor - .1, z: (r.z0 + r.z1) / 2, w: r.x1 - r.x0, h: .2, d: r.z1 - r.z0, c: '#b8a77a' });
      }
      const hh = .02 - r.floor, yc = r.floor + hh / 2;
      for (const [x, z, w, d] of (open && sea ? [[r.x1 - .2, (r.z0 + r.z1) / 2, .4, r.z1 - r.z0]] : [[(r.x0 + r.x1) / 2, r.z0 + .2, r.x1 - r.x0, .4], [(r.x0 + r.x1) / 2, r.z1 - .2, r.x1 - r.x0, .4], [r.x0 + .2, (r.z0 + r.z1) / 2, .4, r.z1 - r.z0], [r.x1 - .2, (r.z0 + r.z1) / 2, .4, r.z1 - r.z0]])) {
        P(null, { s: 'box', x, y: yc, z, w, h: hh, d, c: '#8d8a83' });
        ph.addBox({ x, y: yc, z, hx: w / 2, hy: hh / 2, hz: d / 2, tag: 'wall', data: { cam: false, floor: 'concrete' } });
      }
    }
    // указатели на развилке и у дорог
    R.prefab('sign', { x: 6, z: 124, yaw: PI, text: '🏙️ Большой город →', c: '#1d4ed8' }, ph);
    R.prefab('sign', { x: -6, z: 124, yaw: PI, text: '← 🪖 Боевая зона 12+', c: '#b91c1c' }, ph);
    R.prefab('sign', { x: 22, z: -16, yaw: Math.atan2(-22, 16), text: '🧸 Солнечный городок', c: '#ca8a04' }, ph);
    // ── Телепорты на площади: светящееся кольцо + значок над ним (надпись — в атлас мира) ──
    const pl = PLACES0.reduce((m, p) => (m[p[0]] = p, m), {});
    const lbl = atlas(R, 1024), pads = [];
    const ringG = R.K.geo('mzpadRing', () => new T.RingGeometry(.78, 1.05, 32)), discG = R.K.geo('mzpadDisc', () => new T.CircleGeometry(.78, 32));
    for (const p of PADS) {
      const Z = ZONES[p.to], info = p.to === 'studio' ? STUDIO : Z ? { icon: Z.icon, name: Z.name } : { icon: pl[p.to][1], name: pl[p.to][2] };
      const col = Z ? Z.color : p.to === 'studio' ? '#f59e0b' : '#a78bfa';
      const ring = new T.Mesh(ringG, R.glow(col)); ring.rotation.x = -PI / 2; ring.position.set(p.x, .05, p.z); st.add(ring);
      const disc = new T.Mesh(discG, R.mat('#1e1b4b', { rough: .4 })); disc.rotation.x = -PI / 2; disc.position.set(p.x, .045, p.z); st.add(disc);
      const yaw = Math.atan2(-p.x, -p.z);   // надпись — лицом к фонтану
      const age = Z?.age ? ` ${Z.age}+` : '';
      lbl.sign(`${info.icon} ${Z?.short || info.name}${age}`, p.x, 2.35, p.z, 2.6, .5, yaw, { bg: 'rgba(15,12,40,.85)', w: 512, h: 98, fg: '#fff' });
      lbl.sign(`${info.icon} ${Z?.short || info.name}${age}`, p.x, 2.35, p.z, 2.6, .5, yaw + PI, { bg: 'rgba(15,12,40,.85)', w: 512, h: 98, fg: '#fff' });
      P(null, { s: 'cyl', x: p.x, y: 1.05, z: p.z, r: .035, h: 2.1, c: col, m: 'glow', seg: 6 });
      pads.push({ ...p, info, col, Z });
      X.add({ x: p.x, y: 1, z: p.z, r: 1.1, prompt: () => `🌀 Телепорт: ${info.icon} ${Z?.name || info.name}${age}`, act: () => S.zones?.padGo?.(p.to) });
    }
    // щит-карта у спавна: картинка карты мира; [E] — открыть большую
    {
      const c = document.createElement('canvas'); c.width = 512; c.height = 400;
      drawMap(c.getContext('2d'), 512, 400, null, {});
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; R.own.push(t);
      const mat = new T.MeshBasicMaterial({ map: t, toneMapped: false }); R.own.push(mat);
      const bx = 6.6, bz = 15.8;
      for (const s of [-1, 1]) P(null, { s: 'box', x: bx + s * 1.25, y: 1.1, z: bz, w: .14, h: 2.2, d: .14, c: '#3b2a1c' });
      P(null, { s: 'box', x: bx, y: 1.75, z: bz + .06, w: 2.65, h: 2.1, d: .08, c: '#3b2a1c' });
      const m = new T.Mesh(new T.PlaneGeometry(2.5, 1.95), mat); m.position.set(bx, 1.75, bz - .01); m.rotation.y = PI; m.userData.dyn = true; m.userData.own = true; R.scene.add(m);
      ph.addBox({ x: bx, z: bz, y: 1.1, hx: 1.35, hy: 1.1, hz: .12, tag: 'sign' });
      X.add({ x: bx, y: 1.4, z: bz - .7, r: 1, prompt: () => '🗺️ Карта мира и телепорты', act: () => S.zones?.openMap?.() });
    }
    // ── Ворота зон: арка с названием и меткой возраста, шлагбаум у боевой (видно издалека) ──
    for (const Z of ZLIST) {
      const g = Z.gate, alongX = Math.abs(g.x - Z.x0) < 1 || Math.abs(g.x - Z.x1) < 1;   // ворота на западной/восточной стене
      const yaw = alongX ? PI / 2 : 0, w = 9;
      for (const s of [-1, 1]) {
        const px = alongX ? g.x : g.x + s * w / 2, pz = alongX ? g.z + s * w / 2 : g.z;
        P(null, { s: 'box', x: px, y: 2.4, z: pz, w: .7, h: 4.8, d: .7, c: Z.color });
        ph.addBox({ x: px, z: pz, y: 2.4, hx: .35, hy: 2.4, hz: .35, tag: 'world' });
      }
      P(null, { s: 'box', x: g.x, y: 5, z: g.z, w: alongX ? .8 : w + .7, h: .7, d: alongX ? w + .7 : .8, c: Z.color });
      const t = `${Z.icon} ${Z.name}${Z.age ? '  ' + Z.age + '+' : ''}`;
      lbl.sign(t, g.x + (alongX ? .45 : 0), 5, g.z + (alongX ? 0 : .45), 7.5, .62, yaw, { bg: '#111827', w: 768, h: 64 });
      lbl.sign(t, g.x - (alongX ? .45 : 0), 5, g.z - (alongX ? 0 : .45), 7.5, .62, yaw + PI, { bg: '#111827', w: 768, h: 64 });
    }
    // ворота больших песочниц (если игра есть на сайте): столбы, перекладина, надпись; [E] — окно «Играть» (своей страницей)
    for (const gt of BIG_GATES) {
      if (typeof GAMES !== 'undefined' && !GAMES.some(x => x.id === gt.g)) continue;
      const c = Math.cos(gt.yaw), s = Math.sin(gt.yaw);
      for (const k of [-1, 1]) { P(null, { s: 'box', x: gt.x + c * k * 1.8, y: 1.7, z: gt.z - s * k * 1.8, w: .6, h: 3.4, d: .6, yaw: gt.yaw, c: gt.c }); ph.addBox({ x: gt.x + c * k * 1.8, z: gt.z - s * k * 1.8, y: 1.7, hx: .3, hy: 1.7, hz: .3, yaw: gt.yaw, tag: 'world' }); }
      P(null, { s: 'box', x: gt.x, y: 3.6, z: gt.z, w: 4.4, h: .6, d: .8, yaw: gt.yaw, c: gt.c });
      const fx = Math.sin(gt.yaw), fz = Math.cos(gt.yaw);
      lbl.sign(`${gt.e} ${gt.name}`, gt.x + fx * .42, 3.6, gt.z + fz * .42, 3.6, .9, gt.yaw, { bg: gt.c, w: 512, h: 128 });
      lbl.sign(`${gt.e} ${gt.name}`, gt.x - fx * .42, 3.6, gt.z - fz * .42, 3.6, .9, gt.yaw + PI, { bg: gt.c, w: 512, h: 128 });
      X.add({ x: gt.x + fx * .2, y: 1.2, z: gt.z + fz * .2, r: 1.6, prompt: () => `${gt.e} ${gt.name}: играть`, act: () => S.zones?.bigGame?.(gt) });
    }
    const lm = lbl.mesh(); if (lm) R.scene.add(lm);
    // деревья вдоль дорог и между зонами (новые места мира пустые) — не в зонах, не на дорогах, не к северо-западу (район растёт)
    {
      const rnd = E.rng(737), B = bounds(), pts = [];
      for (let k = 0; k < 4000 && pts.length < (R.q === 'low' ? 40 : 90); k++) {
        const x = B[0] + rnd() * (B[2] - B[0]), z = B[1] + rnd() * (B[3] - B[1]);
        if ((Math.abs(x) < 88 && z > -76 && z < 94) || (x < 0 && z < 0) || blocked(x, z) || roadDist(x, z) < 6 || pts.some(p => Math.hypot(p[0] - x, p[1] - z) < 7)) continue;
        if (roadDist(x, z) > 40 && rnd() < .6) continue;   // гуще у дорог
        pts.push([x, z]);
        if (rnd() < .3) R.prefab('pine', { x, z, k: .9 + rnd() * .5 }, ph); else R.prefab('tree', { x, z, v: Math.floor(rnd() * 4), k: .9 + rnd() * .5, yaw: rnd() * 6 }, ph);
      }
    }
    // ── Силуэты зон (видно издалека, пока содержимое не подгружено): склеенные коробки ──
    const proxies = {};
    for (const Z of ZLIST) {
      const D = DEFS[Z.id], g = new T.Group(); g.name = 'mz-proxy-' + Z.id; R.scene.add(g);
      if (D?.ground) for (const q of D.ground) R.part(g, { s: 'box', x: q[0], y: q[5] ?? .015, z: q[1], w: q[2], h: .02, d: q[3], c: q[4] });
      // здания: у небоскрёбов — тот же фасад (окна светятся ночью — силуэт города издалека живой), крыша — цвет типа
      for (const f of D?.footprints || []) if (f[5] !== 0) {
        const h = f[5] || 4;
        R.part(g, { s: 'box', x: f[0], y: h / 2, z: f[1], w: f[2], h, d: f[3], ...(f[6] ? { m: facadeMat(R, f[6]) } : { c: f[4] }) });
        if (f[7]) R.part(g, { s: 'box', x: f[0], y: h + .15, z: f[1], w: f[2] + .3, h: .3, d: f[3] + .3, c: f[7] });
      }
      // силуэт выше зданий: ярусы, шпили, телебашня — [x, z, w, d, цвет, верх, низ, фасад]
      for (const s of D?.skyline || []) R.part(g, { s: 'box', x: s[0], y: ((s[5] || 4) + (s[6] || 0)) / 2, z: s[1], w: s[2], h: (s[5] || 4) - (s[6] || 0), d: s[3], ...(s[7] ? { m: facadeMat(R, s[7]) } : { c: s[4] }) });
      merge(R, g, { chunk: 0 });
      proxies[Z.id] = g;
    }
    BUILT = { pads, proxies, R };
    return BUILT;
  }
  // Земля шире и с дырами (море, бункер) — крючок в постройке земли mir.js
  function groundHoles(T, shape){
    for (const r of worldMap() ? [BUNKER, CANAL] : [SEA, BUNKER, CANAL]) {
      const h = new T.Path();
      h.moveTo(r.x0, -r.z1); h.lineTo(r.x1, -r.z1); h.lineTo(r.x1, -r.z0); h.lineTo(r.x0, -r.z0); h.lineTo(r.x0, -r.z1);
      shape.holes.push(h);
    }
  }

  // ═══ Игра: подгрузка зон, ворота, телепорты, карта, роли, действия, сеть ═══
  // ═══ Прогрев шейдеров зоны (до показа) ═══
  // three r149 собирает программу шейдера синхронно: в первом кадре показа ждёт видеокарту (проверка ошибок, список uniform). На
  // D3D11 одна новая программа «стандартного» материала с тенями — до 300 мс (замер 16.10: InstancedMesh деталей боевой зоны —
  // 313 мс, это и был рывок «на въезде»). Поэтому, пока зона спрятана: compile() только её объектов (свет — тот, что видит кадр;
  // буфер — как у сцены: с постобработкой — не экран) без проверки ошибок и с пустым списком uniform у новой программы → видеокарта
  // собирает в своих потоках (KHR_parallel_shader_compile — Chrome/Edge, ANGLE) → готово (COMPLETION_STATUS_KHR, без ожидания) →
  // настоящий список uniform и проверка ошибок, как у three (страж графики видит diagnostics). Расширения нет — просто заранее.
  function warmer(R){
    const r = R?.r, gl = r?.getContext?.();
    if (!gl || typeof r.compile !== 'function' || !r.info?.programs || !r.properties) return null;
    let ext = null; try { ext = gl.getExtension('KHR_parallel_shader_compile'); } catch (e) {}
    const W = { ext: !!ext, wait: [], n: 0, log: [] }, DUMMY = { seq: [], map: {} };
    let rt1 = null;
    W.compile = list => {
      const sc = R.scene, progs = r.info.programs, fresh = [];
      if (!list.length || gl.isContextLost()) return fresh;
      const tl = performance.now();   // свет сцены (как его видит кадр) — обход всей сцены, не чаще раза в 0,2 с
      if (!W.lights || tl - W.lt > 200) { W.lights = []; W.lt = tl; sc.traverseVisible(o => { if (o.isLight) W.lights.push(o); }); }
      const lights = W.lights;
      const ch = sc.children, chk = r.debug.checkShaderErrors, rt0 = r.getRenderTarget();
      let on = true;
      progs.push = function(...a){   // новая программа: пока идёт compile — пустой список uniform (настоящий ждал бы видеокарту)
        for (const pg of a) { const gu = pg.getUniforms; pg.d37gu = gu; pg.getUniforms = function(){ return on ? DUMMY : gu.call(this); }; fresh.push(pg); }
        return Array.prototype.push.apply(this, a);
      };
      try {
        r.debug.checkShaderErrors = false;
        if (R.post && R.post.on) { if (!rt1) rt1 = new R.T.WebGLRenderTarget(1, 1); r.setRenderTarget(rt1); } else r.setRenderTarget(null);
        sc.children = lights.concat(list);
        r.compile(sc, R.camera);
      } catch (e) { console.error('прогрев шейдеров', e); }
      finally { sc.children = ch; on = false; delete progs.push; r.debug.checkShaderErrors = chk; r.setRenderTarget(rt0); }
      if (fresh.length) {   // у материалов с новой программой список uniform — заново при первом настоящем кадре
        const F = new Set(fresh);
        for (const o of list) for (const m of Array.isArray(o.material) ? o.material : [o.material]) { const mp = r.properties.get(m); if (F.has(mp.currentProgram)) { mp.lightsStateVersion = -1; m.needsUpdate = true; } }
        const t = performance.now(); for (const pg of fresh) W.wait.push({ pg, t });
        W.n += fresh.length;
        for (const pg of fresh) { W.log.push(pg.name + ' ' + pg.cacheKey.slice(0, 90)); if (W.log.length > 40) W.log.shift(); }
      }
      return fresh;
    };
    // всё ли собрано (без ожидания)
    let nextPoll = 0;
    W.poll = () => {
      const L = W.wait; if (!L.length) return true;
      if (gl.isContextLost()) { L.length = 0; return true; }   // после восстановления three соберёт всё заново сам
      const progs = r.info.programs, tn = performance.now();
      if (tn < nextPoll || tn - L[0].t < 250) return false;   // опрос — синхронный вызов в процесс видеокарты: не чаще 5 раз в секунду
      nextPoll = tn + 200;
      while (L.length) {
        const { pg, t } = L[0];
        let done = !progs.includes(pg) || tn - t > 4000;   // программу выбросили / слишком долго — дальше без ожидания
        if (!done) { try { done = ext ? gl.getProgramParameter(pg.program, ext.COMPLETION_STATUS_KHR) !== false : tn - t > 100; } catch (e) { done = true; } }
        if (!done) return false;
        L.shift(); ready(pg);
      }
      return true;
    };
    function ready(pg){
      if (pg.d37gu) { pg.getUniforms = pg.d37gu; delete pg.d37gu; }
      if (!r.debug.checkShaderErrors || gl.isContextLost()) return;
      try {   // проверка ошибок — как у three с checkShaderErrors (уже собрано — без ожидания; журнал — только при ошибке)
        if (gl.getProgramParameter(pg.program, gl.LINK_STATUS) === false) {
          const log = (gl.getProgramInfoLog(pg.program) || '').trim();
          pg.diagnostics = { runnable: false, programLog: log, vertexShader: { log: '', prefix: '' }, fragmentShader: { log: '', prefix: '' } };
          console.error('THREE.WebGLProgram: Shader Error (прогрев) ' + pg.name + '\n' + log);
        }
      } catch (e) {}
    }
    return W;
  }
  // от края зоны: строить (по кусочку за кадр) — ближе LOAD_D, показывать — ближе SHOW_D, прятать — дальше HIDE_D (дальше — силуэт)
  const LOAD_D = 125, SHOW_D = 85, HIDE_D = 115;
  function start(S, H){
    const E = root.D37E, R = S.R, T = R.T, ph = S.ph, X = S.X;
    const rt = { S, H, R, T, ph, X, E, zones: new Map(), area: null, zx: {}, zxSig: '', mods: [], t: 0, stopped: false, safe: null, modal: null, gateFor: null };
    CELLAR.on = false;   // плиты над подвалами баз — с постройкой боевой зоны (mir-war.js)
    const now = () => performance.now();
    const toast = (t, ok) => S.H?.toast(t, ok);
    rt.toast = toast;
    rt.sfx = (n, o) => { try { S.AU?.play(n, o); } catch (e) {} };
    // стили — свой файл (без правок premium.css)
    if (typeof document !== 'undefined' && !document.getElementById('mzCss')) {
      const l = document.createElement('link'); l.id = 'mzCss'; l.rel = 'stylesheet';
      l.href = 'css/mir-zones.css?v=' + (typeof GAMES_VER !== 'undefined' ? GAMES_VER : '1');
      document.head.appendChild(l);
    }
    const hud = document.createElement('div'); hud.className = 'mz-hud'; S.wrap.appendChild(hud);
    hud.innerHTML = '<div class="mz-banner" hidden></div><div class="mz-task" hidden></div><div class="mz-fade" hidden></div><div class="mz-acts" hidden></div><div class="mz-tags"></div>';
    const q = s => hud.querySelector(s);
    rt.hud = hud; rt.q = q;
    // кнопки в панели мира: 🗺️ карта, 🎬 действия (в городах)
    const bar = S.q('.wld-topbtns');
    const btn = (cls, html, title, f) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.title = title; b.innerHTML = html; b.addEventListener('click', e => { e.stopPropagation(); f(); }); bar?.insertBefore(b, bar.firstChild); return b; };
    rt.actBtn = btn('mz-actbtn', '🎬<span> Действия</span>', 'Действия: сесть, спать, есть, позвонить, /me (T)', () => toggleActs());
    rt.actBtn.hidden = true;
    rt.mapBtn = btn('mz-mapbtn', '🗺️<span> Карта</span>', 'Карта мира и телепорты (M)', () => openMap());
    // ── зоны: силуэт, содержимое (строится кусочками), жители ──
    for (const Z of ZLIST) rt.zones.set(Z.id, { Z, D: DEFS[Z.id] || null, proxy: BUILT?.proxies?.[Z.id] || null, grp: null, K: null, it: null, built: false, shown: false, npcOn: false, mod: null });
    // жители зон говорят своё (облачко над головой) — mir.js слушает только своих (FOLK)
    if (S.NPC?.cb) {
      const cb = S.NPC.cb, prev = cb.onSay;
      cb.onSay = (e, text) => {
        const o = e.o;
        if (!o._mz) return prev?.(e, text);
        rt.npcTag(o, text);
        if (Array.isArray(o.say) && o.say.length > 1) { o._si = ((o._si || 0) + 1) % o.say.length; o.text = o.say[o._si]; }
      };
    }
    // бюджет постройки за кадр (мс): компьютер — 3,5, телефон и «низкая» — 2; прогрев шейдеров — warmer() (внизу файла)
    const BUD = R.q === 'low' || E?.isMobile?.() ? 3 : 3.5;
    rt.warm = warmer(R);
    function beginBuild(zs){
      if (zs.it || zs.built || !zs.D?.build) return;
      const grp = new T.Group(); grp.name = 'mz-' + zs.Z.id; grp.visible = false;   // в сцену — только при показе (setShown)
      zs.grp = grp; zs.K = kit(rt, zs, grp);
      zs.it = zs.D.build(zs.K);
    }
    // постройка по кусочку → раскладка по клеткам → склейка клеток (тоже по кусочку) → доделка → прогрев шейдеров → можно
    // показывать. budget — мс за кадр (длинные куски постройки делятся сами: K.due()); в кадре строится одна зона (rt.frame)
    const busy = zs => !!(zs.it || zs.pm || zs.mq || zs.mi || zs.fin || (zs.built && !zs.ready));
    rt.busy = busy;
    const step = (it, what, zs) => { try { return it.next().done; } catch (e) { console.error(what, zs.Z.id, e); return true; } };
    function stepBuild(zs, budget){
      const t0 = now();
      if (zs.K) { zs.K.t0 = t0; zs.K.bud = budget; }
      do {
        const s0 = rt.prof ? now() : 0;
        let what;
        if (zs.K?.label?.pending()) { what = 'labels'; zs.K.label.drain(t0 + budget); }
        else if (zs.it) { what = 'step'; if (step(zs.it, 'зона', zs)) { zs.it = null; zs.K.flush(); zs.pm = prepIt(zs); } }
        else if (zs.pm) { what = 'prep'; if (step(zs.pm, 'клетки', zs)) zs.pm = null; }
        else if (zs.mi || zs.mq) {
          what = 'merge';
          if (!zs.mi) {
            const it = zs.mq.shift(); zs.mname = it.name || 'roof';
            if (it.roof) { try { merge(R, it.roof, { chunk: 0 }); R.shadowsOn?.(it.roof); } catch (e) { console.error('склейка', zs.Z.id, e); } }
            else zs.mi = mergeIt(R, it, { chunk: 0 });
          }
          if (zs.mi && step(zs.mi, 'склейка', zs)) zs.mi = null;
          if (!zs.mi && !zs.mq.length) { zs.mq = null; zs.fin = finishIt(zs); }
        }
        else if (zs.fin) { what = 'finish'; if (step(zs.fin, 'доделка', zs)) zs.fin = null; }
        else if (zs.built && !zs.ready) { what = 'warm'; warmStep(zs); if (rt.prof) what += zs.wst ? zs.wst.wait ? '-poll' : zs.wst.tex.length || zs.wst.did ? '-tex' : '-compile' : '-done'; if (zs.wst) zs.wst.did = 1; }
        else break;
        if (rt.prof && now() - s0 > .3) rt.prof.push([what, zs.Z.id, what === 'step' ? zs.K?.cur?.name || '' : what === 'merge' ? zs.mname : '', +(now() - s0).toFixed(1), rt.frameNo]);
        if (what === 'warm' && !zs.ready && zs.wst?.wait) break;   // ждём видеокарту — кадр не держим
      } while (now() - t0 < budget);
    }
    // все детали зоны (кроме прячущихся групп: крыши, этажи, ленивые интерьеры) — в группы клеток 96 × 96 с сохранением места
    // (по шагам; перенос — без remove/add по одной: у групп кусков тысячи детей, indexOf + splice на каждую — десятки мс)
    const CELL = 96;
    function* prepIt(zs){
      const grp = zs.grp, cells = new Map(), sph = new T.Sphere(), list = [], moved = new Set();
      grp.updateMatrixWorld(true);
      grp.traverse(x => {
        if (!x.isMesh || x.isInstancedMesh || x.userData.dyn || x.userData.mzOwn) return;
        for (let q = x.parent; q && q !== grp; q = q.parent) if (q.userData.dyn) return;
        list.push(x);
      });
      const fix = () => { for (const p of moved) p.children = p.children.filter(c => c.parent === p); moved.clear(); };
      let n = 0;
      for (const x of list) {
        if (!x.geometry.boundingSphere) x.geometry.computeBoundingSphere();
        sph.copy(x.geometry.boundingSphere).applyMatrix4(x.matrixWorld);
        const key = sph.radius > CELL * .75 ? 'big' : Math.floor(sph.center.x / CELL) + ',' + Math.floor(sph.center.z / CELL);
        let g = cells.get(key);
        if (!g) { g = new T.Group(); g.name = 'cell ' + key; g.userData.cell = true; cells.set(key, g); }
        x.matrixWorld.decompose(x.position, x.quaternion, x.scale);
        moved.add(x.parent); x.parent = g; g.children.push(x);
        if (++n % 400 === 0) { fix(); yield; }
      }
      fix();
      // опустевшие группы кусков — прочь (прячущиеся группы и надписи остаются)
      const keep = c => c.userData.dyn || c.userData.mzOwn || c.isMesh || c.children.some(keep);
      for (const c of [...grp.children]) if (!keep(c)) grp.remove(c);
      for (const g of cells.values()) grp.add(g);
      zs.mq = [...cells.values(), ...zs.K.roofs.map(r => ({ roof: r }))];
      if (!zs.mq.length) { zs.mq = null; zs.fin = finishIt(zs); }
    }
    function flushPortals(K, grp){
      const L = K.portals; if (!L.length) return;
      const geo = new T.PlaneGeometry(1, 1), mat = new T.MeshBasicMaterial({ color: '#0b1120' }), mesh = new T.InstancedMesh(geo, mat, L.length);
      const q4 = new T.Quaternion(), up = new T.Vector3(0, 1, 0), v = new T.Vector3(), sc = new T.Vector3(), zero = new T.Matrix4().makeScale(0, 0, 0);
      let mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity;
      L.forEach((p, i) => {
        p.m4 = new T.Matrix4().compose(v.set(p.x, p.y, p.z), q4.setFromAxisAngle(up, p.yaw), sc.set(p.w, p.h, 1));
        mesh.setMatrixAt(i, p.m4); p.inst = { mesh, i, zero };
        mnx = Math.min(mnx, p.x); mnz = Math.min(mnz, p.z); mxx = Math.max(mxx, p.x); mxz = Math.max(mxz, p.z);
      });
      geo.boundingSphere = new T.Sphere(new T.Vector3((mnx + mxx) / 2, 1.3, (mnz + mxz) / 2), Math.hypot(mxx - mnx, mxz - mnz) / 2 + 4);
      mesh.userData.mzOwn = true; mesh.userData.dyn = true;
      R.own.push(geo, mat);
      grp.add(mesh);
    }
    function* finishIt(zs){
      const K = zs.K;
      for (const Rs of residents(zs.Z.id)) K.npc({ id: Rs.id, name: '🙂 ' + Rs.name, x: Rs.hs[0], z: Rs.hs[1], yaw: 0, seed: Rs.seed, act: 'wander', radius: 3, speed: .8, say: Rs.says, sched: Rs });
      const lm = K.label.mesh(); if (lm) zs.grp.add(lm);
      yield;
      yield* flushPiecesIt(R, K, zs.grp);   // детали с номерами (боевая зона) — InstancedMesh
      flushPortals(K, zs.grp);   // тёмные проёмы входов
      for (const p of K.pieceList) PIECES.set(p.id, p);
      yield;
      const DS = rt.destruct;
      if (DS && zs.Z.id !== 'kids') {
        for (const b of K.brk || []) DS.add({ ...b, hide: on => { if (!brkHide(b.id, on) && b.obj) b.obj.visible = !on; } });
        let nb = 0;
        for (const p of K.pieceList) {
          // стены зданий из деталей (этап 2): стена, перемычка, подоконник, бортик крыши — выбиваются (дыра), пол, крыша и углы —
          // нет (здание стоит, ничего не рушится); бункер и базы — прочные (в 4 раза крепче, танк не пробьёт)
          const wallish = p.destructible && ['wall', 'lintel', 'sill', 'parapet'].includes(p.kind);
          const kind = p.kind === 'window' ? 'glass' : wallish ? 'wall' : ['bag', 'crate', 'barrel', 'fence', 'block'].includes(p.kind) ? p.kind : null;
          if (!kind) continue;
          const tough = (kind === 'wall' || kind === 'block') && TOUGH.test(p.b || '');
          DS.add({ id: 'p:' + p.id, zone: zs.Z.id, kind, x: p.x, y: kind === 'glass' ? p.y : p.y - p.h / 2, z: p.z, yaw: p.yaw || 0,
            w: kind === 'wall' || kind === 'block' ? p.w : Math.max(p.w, p.d), d: kind === 'wall' || kind === 'block' ? p.d : Math.min(p.w, p.d), h: p.h, c: p.c,
            hp: tough ? 20 : undefined, power: tough ? 3 : undefined,
            bodies: p.body ? [p.body] : [], hide: on => { p.broken = !!on; setPieceVis(p, !on); } });
          if (++nb % 300 === 0) yield;
        }
      }
      yield;
      zs.built = true; zs.builtAt = now();
      R.shadowDirty?.();
      try { zs.mod = zs.D.start?.(rt, K) || null; } catch (e) { console.error(e); }
      if (!rt.mods.includes(zs)) rt.mods.push(zs);
    }
    // ── Прогрев (после постройки, пока зона спрятана): новые программы шейдеров — в фоне видеокарты, картинки — заранее ──
    function warmStep(zs){
      const W = rt.warm;
      if (!W) { zs.ready = true; return; }
      if (!zs.wst) {   // по одному «представителю» на материал и вид объекта (обычный / InstancedMesh / цвета вершин …)
        const reps = new Map(), tex = new Set();
        zs.grp.traverse(x => {
          const m = x.material; if (!m) return;
          const a = x.geometry?.attributes || {}, v = (x.isInstancedMesh ? (x.instanceColor ? 'ic' : 'i') : '') + (a.color ? a.color.itemSize : 0) + (a.uv ? 'u' : '') + (a.tangent ? 't' : '') + (x.isPoints ? 'p' : x.isLine ? 'l' : x.isSprite ? 's' : '');
          for (const mm of Array.isArray(m) ? m : [m]) {
            if (!reps.has(mm.uuid + v)) reps.set(mm.uuid + v, x);
            for (const t of [mm.map, mm.emissiveMap, mm.normalMap, mm.roughnessMap, mm.metalnessMap, mm.alphaMap, mm.aoMap, mm.bumpMap]) if (t && !t.isRenderTargetTexture && !t.isCubeTexture && !t.isVideoTexture) tex.add(t);
          }
        });
        zs.wst = { t: now(), progs: W.compile([...reps.values()]).length, tex: [...tex], wait: false };
        return;
      }
      const st = zs.wst;
      if (st.tex.length) {   // картинки (вывески, фасады) — в видеокарту по одной за шаг, а не все в первом кадре показа
        // файл-картинка: сначала расшифровать в фоне (img.decode — не в главном потоке; иначе texImage2D расшифрует сам: на
        // телефоне до 80 мс на картинку), пока ждём — другие; остались только ждущие — кадр не держим
        const i = st.tex.findIndex(t => t.image?.d37dec !== 1 || now() - st.t > 3000);
        if (i < 0) { st.wait = true; return; }
        st.wait = false;
        const t = st.tex[i], im = t.image;
        if (im && im.nodeName === 'IMG' && !im.d37dec && typeof im.decode === 'function') { im.d37dec = 1; im.decode().then(() => { im.d37dec = 2; }, () => { im.d37dec = 2; }); return; }
        st.tex.splice(i, 1);
        try { if (t.version > 0 && im && R.r.properties.get(t).__version !== t.version) R.r.initTexture(t); } catch (e) {}
        return;
      }
      st.wait = true;
      if (W.poll() || now() - st.t > 4000) { zs.ready = true; zs.wst = null; }
    }
    // построить сразу (телепорт в зону, под «Загружаем…»): кусочками с ожиданием кадра, пока не готово (и прогрето)
    rt.buildNow = zs => new Promise(res => {
      beginBuild(zs);
      const tick = () => { if (rt.stopped) return res(false); stepBuild(zs, 24); if (!busy(zs)) res(true); else setTimeout(tick, zs.built ? 16 : 0); };
      tick();
    });
    function setShown(zs, on){
      zs.shown = on;
      if (zs.grp) {   // спрятанная — вне сцены (матрицы её тысяч деталей не пересчитываются каждый кадр)
        zs.grp.visible = on;
        if (on && !zs.grp.parent) R.scene.add(zs.grp); else if (!on && zs.grp.parent) zs.grp.parent.remove(zs.grp);
      }
      if (zs.proxy) zs.proxy.visible = !on;
      R.shadowDirty?.();
      zs.npcOn = on;   // жители — только пока видно и только рядом (npcTick)
      if (!on) npcTick();
      try { zs.mod?.shown?.(on); } catch (e) { console.error(e); }
    }
    // ── Жители зон — по расстоянию (как PopulationDirector в Backrooms: рядом — появляются, далеко — уходят), не больше NPC_CAP ──
    const NPC_NEAR = 62, NPC_FAR = 82, NPC_CAP = R.q === 'low' || E?.isMobile?.() ? 8 : 16;
    const RES_CAP = R.q === 'low' || E?.isMobile?.() ? 3 : 7;   // из них — жителей по расписанию (человечек — 7–18 вызовов отрисовки)
    const NPC_ADD = R.q === 'low' || E?.isMobile?.() ? 1 : 2;   // новых за проверку (4 раза в секунду): сборка человечка — несколько мс
    const hourNow = () => S.fixedTime ?? (E?.dayClock ? E.dayClock(Date.now(), 40, .2) : 14);
    rt.hourNow = hourNow;
    function npcTick(){
      if (!S.NPC) return;
      const p = S.P.ch, L = [], h = hourNow();
      for (const zs of rt.zones.values()) for (const o of zs.K?.npcs || []) {
        let home = false;
        if (o.mz?.sched) {   // житель: место по часам; рядом с игроком не прыгает — переходит, когда игрок далеко
          const at = residentAt(o.mz.sched, h), far = Math.hypot(o.pos[0] - p.x, o.pos[2] - p.z) > 45;
          home = at.phase === 'home';
          if ((!o._on || far) && (Math.abs(at.x - o.pos[0]) > 1 || Math.abs(at.z - o.pos[2]) > 1)) {
            if (o._on) { S.NPC.remove(o); o._on = false; }
            o.pos[0] = at.x; o.pos[2] = at.z; o.phase = at.phase;
          }
        }
        const d = Math.hypot(o.pos[0] - p.x, o.pos[2] - p.z) + Math.abs(o.pos[1] - p.y) * 2;   // другой этаж — «дальше»
        L.push([d, o, !home && !!zs.npcOn && (o._on ? d < NPC_FAR : d < NPC_NEAR)]);
      }
      L.sort((a, b) => a[0] - b[0]);
      let n = 0, nr = 0, add = NPC_ADD;
      for (const [, o, want] of L) {
        const res = !!o.mz?.sched, on = want && n < NPC_CAP && (!res || nr < RES_CAP);
        if (on) { n++; if (res) nr++; }
        if (on && !o._on) { if (add-- > 0) { const a0 = rt.prof ? now() : 0; S.NPC.add(o); o._on = true; if (rt.prof) rt.prof.push(['npc', o.id, '', +(now() - a0).toFixed(1), rt.frameNo]); } }
        else if (!on && o._on) { S.NPC.remove(o); o._on = false; }
      }
    }
    rt.zoneState = id => rt.zones.get(id);
    // ── Ленивые интерьеры: игрок рядом — построить (один за раз); далеко — спрятать ──
    function lazyTick(){
      const p = S.P.ch;
      for (const zs of rt.zones.values()) {
        if (!zs.built || !zs.K?.lazies.length) continue;
        for (const L of zs.K.lazies) {
          const dd = Math.hypot(L.x - p.x, L.z - p.z);
          if (!L.done && dd < L.r && zs.shown) { buildLazy(zs, L); return; }
          if (L.done && L.grp) { const want = dd < L.r + 60; if (L.grp.visible !== want) { L.grp.visible = want; R.shadowDirty?.(); } }
        }
      }
    }
    function buildLazy(zs, L){
      const K = zs.K, g = new T.Group();
      let px = 0, py = 0, pz = 0;
      if (L.parent) { L.parent.updateWorldMatrix(true, false); const e = L.parent.matrixWorld.elements; px = e[12]; py = e[13]; pz = e[14]; }
      g.position.set(-px, L.y - py, -pz); (L.parent || zs.grp).add(g);   // детали — в мировых координатах, как в обычной постройке
      const cur = K.cur, yo = K.yo, n0 = K.npcs.length;
      K.cur = g; K.yo = L.y;
      try { L.gen(K); } catch (e) { console.error('интерьер', e); }
      K.cur = cur; K.yo = yo;
      merge(R, g, { chunk: 0 }); R.shadowsOn?.(g);
      L.grp = g; L.done = true;
      void n0;   // жители интерьера появятся сами (npcTick)
      R.shadowDirty?.();
    }
    rt.lazyAll = () => { for (const zs of rt.zones.values()) for (const L of zs.K?.lazies || []) if (!L.done) buildLazy(zs, L); };   // для проверок
    // ═══ Интерьеры зданий (js/engine/interior.js): этаж строится, когда игрок у входа / внутри / приехал лифтом; далеко — сносится.
    //     Никогда не весь небоскрёб: живут только нужные этажи (не больше INT_CAP). Двери — правила доступа (rt.doorAccess) ═══
    const INT = root.D37E?.interior, mounted = new Map(), intSeats = [];
    rt.mountedCount = () => mounted.size;   // сколько этажей интерьеров построено (замер: только у входа)
    const INT_CAP = R.q === 'low' || E?.isMobile?.() ? 3 : 6;
    let glassM = null;
    const ictx = {
      R, ph, toast,
      merge: (R2, g) => merge(R2, g, { chunk: 0 }),
      get glass(){ if (!glassM) { for (const zs of rt.zones.values()) if (zs.K?.M?.glass) { glassM = zs.K.M.glass; break; } } return glassM; },
      item: it => X.add(it),
      unitem: h => { if (!h) return; if (h.npc) { if (S.NPC) S.NPC.remove(h.npc); h.tag?.remove(); return; } X.remove(h); },
      seat: sp => { const s2 = { ...sp, name: sp.name || (sp.bed ? 'Лечь' : 'Сесть') }; intSeats.push(s2); const it = X.add({ x: s2.x, y: s2.y + .5, z: s2.z, r: s2.bed ? 1.1 : .55, prompt: () => rt.seatPrompt(s2), act: () => rt.sitDown(s2) }); return { s: s2, it }; },
      unseat: h => { X.remove(h.it); const i = intSeats.indexOf(h.s); if (i >= 0) intSeats.splice(i, 1); },
      lift: (b, k) => rt.intLiftPanel(b, k),
      access: door => rt.doorAccess(door),
      sound: () => rt.sfx('click', { vol: .4 }),
      npc: o => {   // житель интерьера (администратор, продавец, бариста…) — пока этаж построен
        if (!S.NPC) return null;
        const NAMES = { admin: '💼 Администратор', porte: '🛎️ Портье', seller: '🛒 Продавец', barista: '☕ Бариста', mayor: '🎩 Мэр' };
        const n = { id: `int_${o.b.id}_${o.who}_${Math.round(o.y)}`, name: NAMES[o.who] || '🧑 Сотрудник', cls: 'NPC', pos: [o.x, o.y, o.z], rot: [0, o.yaw * 180 / PI, 0], look: 'random', seed: `${o.b.id}:${o.who}`, act: 'idle', speed: 1, radius: 0, damage: 0, text: '', say: [], phone: 0 };
        S.NPC.add(n);
        return { npc: n };
      },
    };
    rt.intSeats = intSeats;
    // правила дверей: запертое открывает тот, кому положено (РП). Будущие правила (владельцы, «градостроитель») — MirZones.accessRules
    rt.doorAccess = door => {
      for (const f of MZ_ACCESS) { try { const v = f(door, rt); if (v !== undefined) return v; } catch (e) { console.error(e); } }
      const role = rt.zx.r;
      if (door.kind === 'bars') return role === 'police' ? true : '🔒 Камеру открывает полицейский';
      if (door.kind === 'vault') return role === 'cashier' ? true : '🔒 Хранилище открывает кассир банка';
      return '🔒 Заперто';
    };
    const keyOf = (b, k) => b.id + ':' + k;
    function intMount(b, k){
      const key = keyOf(b, k);
      if (mounted.has(key)) return mounted.get(key);
      let h = null;
      try { h = k === 'roof' ? INT.roofMount(ictx, b) : INT.mount(ictx, b, k); } catch (e) { console.error('интерьер', b.id, k, e); }
      if (h) { h.__b = b; h.__k = k; mounted.set(key, h); R.shadowDirty?.(); if (k === 0 && b._portal) setPieceVis(b._portal, false); }
      return h;
    }
    function intTick(force){
      if (!INT) return;
      const p = S.P.ch, want = new Map();
      for (const zs of rt.zones.values()) {
        if (!zs.shown || !zs.K?.ints?.length) continue;
        for (const b of zs.K.ints) {
          const P0 = INT.plan(b), k = INT.where(b, p.x, p.y, p.z);
          if (k >= 0 && !(k === 0 && b.skip0)) want.set(keyOf(b, k), [b, k, 0]);
          const t = P0.tiers[P0.tiers.length - 1];
          if (Math.abs(p.x - b.x) < t.w / 2 && Math.abs(p.z - b.z) < t.d / 2 && p.y > t.top - .2 && p.y < t.top + 4) want.set(keyOf(b, 'roof'), [b, 'roof', 0]);
          if (!b.skip0 && !rt.inVeh?.()) {   // подошёл к входу по земле — первый этаж заранее (едет мимо на машине — нет)
            const dx = Math.max(Math.abs(p.x - b.x) - b.w / 2, 0), dz = Math.max(Math.abs(p.z - b.z) - b.d / 2, 0), d = Math.hypot(dx, dz);
            if (d < 16 && p.y < P0.base0 + .5 && !want.has(keyOf(b, 0))) want.set(keyOf(b, 0), [b, 0, d]);
          }
        }
      }
      if (rt.intHold) want.set(rt.intHold.key, [rt.intHold.b, rt.intHold.k, -1]);
      const L = [...want.entries()].sort((a, c) => a[1][2] - c[1][2]).slice(0, INT_CAP), keep = new Set(L.map(e => e[0]));
      for (const [key, h] of mounted) if (!keep.has(key)) { try { h.dispose(); } catch (e) { console.error(e); } mounted.delete(key); R.shadowDirty?.(); if (h.__k === 0 && h.__b?._portal) setPieceVis(h.__b._portal, true); }
      for (const [, [b, k]] of L) if (!mounted.has(keyOf(b, k))) { intMount(b, k); if (!force) break; }   // по одному этажу за раз
    }
    rt.intTick = intTick; rt.intMounted = mounted;
    // лифт: окно этажей (сеткой — у небоскрёба их десятки) и крыша
    rt.intLiftPanel = (b, from) => {
      const P0 = INT.plan(b);
      rt.intLiftB = b;
      const btn = (k, label) => `<button type="button"${k === from ? ' class="on" disabled' : ''} data-mz="ilift:${esc(b.id)}:${k}">${label}</button>`;
      const floors = []; for (let k = b.skip0 ? 0 : 0; k < P0.n; k++) floors.push(btn(k, k === 0 && b.skip0 ? '1 · дом' : String(k + 1)));
      H.panel(`<span class="wld-pe">🛗</span><b>Лифт · ${esc(b.name || b.id)}</b>`, `<div class="mz-ilift">${floors.join('')}${P0.roof ? btn('roof', '🏙️ Крыша') : ''}</div><p><small>Этаж строится, когда лифт приезжает: двери, мебель, соседи — у всех одинаковые.</small></p>`);
    };
    rt.intGo = async (id, k) => {
      let b = null; for (const zs of rt.zones.values()) for (const q of zs.K?.ints || []) if (q.id === id) b = q;
      if (!b || rt.tpBusy) return;
      H.closePops(); rt.tpBusy = true;
      const f = q('.mz-fade'); f.hidden = false; f.classList.remove('out'); f.textContent = k === 'roof' ? '🛗 Крыша' : `🛗 ${+k + 1} этаж`;
      rt.sfx('click', { rate: .8 });
      rt.intHold = { b, k: k === 'roof' ? 'roof' : +k, key: keyOf(b, k === 'roof' ? 'roof' : +k) };
      let land = null;
      if (k === 'roof') { const h = intMount(b, 'roof'); land = h?.landing; }
      else if (+k === 0 && b.skip0) land = b.home0 || null;
      else { const h = intMount(b, +k), fp = h?.fp; if (fp?.landing) land = { x: fp.landing.x, z: fp.landing.z, y: fp.y + (fp.k === 0 ? .08 : 0), yaw: fp.landing.wyaw }; }
      await new Promise(r => setTimeout(r, 600));
      rt.tpBusy = false;
      if (rt.stopped || !land) { f.classList.add('out'); setTimeout(() => { f.hidden = true; }, 380); return; }
      place(land.x, land.z, land.yaw ?? 0, land.y);
      setTimeout(() => { rt.intHold = null; }, 1500);
      rt.sfx('pickup', { vol: .4, rate: 1.6 });
      f.classList.add('out'); setTimeout(() => { if (f.classList.contains('out')) f.hidden = true; }, 380);
    };
    // ── Лифт 🛗: окно этажей → затемнение → на этаж ──
    const liftOf = id => { for (const zs of rt.zones.values()) if (zs.K?.lifts?.[id]) return zs.K.lifts[id]; return null; };
    rt.liftPanel = (id, from) => {
      const L = liftOf(id); if (!L) return;
      H.panel(`<span class="wld-pe">🛗</span><b>Лифт · ${esc(L.name)}</b>`, `<div class="mz-lift">${L.stops.map((s, k) => `<button type="button"${k === from ? ' class="on" disabled' : ''} data-mz="lift:${esc(id)}:${k}"><b>${k === from ? '● ' : ''}${esc(s.name)}</b><small>${s.at < .5 ? '1 этаж' : Math.round(s.at / FLOOR_H) + 1 + ' этаж'}</small></button>`).join('')}</div>`);
    };
    rt.liftGo = async (id, k) => {
      const L = liftOf(id), s = L?.stops[k]; if (!s || rt.tpBusy) return;
      H.closePops();
      rt.tpBusy = true;
      const f = q('.mz-fade'); f.hidden = false; f.classList.remove('out'); f.textContent = `🛗 ${s.name}`;
      rt.sfx('click', { rate: .8 });
      // интерьер этажа — сразу (лифт приехал — мебель на месте)
      for (const zs of rt.zones.values()) for (const Lz of zs.K?.lazies || []) if (!Lz.done && Math.hypot(Lz.x - s.x, Lz.z - s.z) < Lz.r && Math.abs(Lz.y - s.at) < 1) buildLazy(zs, Lz);
      await new Promise(r => setTimeout(r, 650));
      rt.tpBusy = false;
      if (rt.stopped) return;
      place(s.x, s.z, s.yaw ?? 0, s.at);
      rt.sfx('pickup', { vol: .4, rate: 1.6 });
      f.classList.add('out'); setTimeout(() => { if (f.classList.contains('out')) f.hidden = true; }, 380);
    };
    // ── Детали с номерами (боевая зона) — для будущих разрушений: найти, спрятать (сломать) и вернуть ──
    rt.pieces = {
      all: zone => [...PIECES.values()].filter(p => !zone || p.zone === zone),
      get: id => PIECES.get(id) || null,
      byBuilding: bid => [...PIECES.values()].filter(p => p.b === bid),
      // сломать: картинка — прочь, тело — прочь (только destructible); вернуть — назад
      breakPiece(id){ const p = PIECES.get(id); if (!p || p.broken || !p.destructible) return false; p.broken = true; setPieceVis(p, false); if (p.body) ph.remove(p.body); R.shadowDirty?.(); return true; },
      restore(id){ const p = PIECES.get(id); if (!p || !p.broken) return false; p.broken = false; setPieceVis(p, true); if (p.body) ph.update(p.body, {}); if (p.body && !ph.cols.has(p.body)) { const b = p.body; p.body = ph.addBox({ x: b.x, y: b.y, z: b.z, hx: b.hx, hy: b.hy, hz: b.hz, yaw: b.yaw, tag: 'piece', data: b.data }); } R.shadowDirty?.(); return true; },
    };
    // ── «Где я»: плашка при входе в зону и место ──
    let areaT = 0, areaPend = null;
    function banner(icon, name, sub, cls = ''){
      const b = q('.mz-banner');
      b.className = 'mz-banner ' + cls; b.hidden = false;
      b.innerHTML = `<b>${icon} ${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;
      b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
      clearTimeout(rt.bannerT); rt.bannerT = setTimeout(() => { b.hidden = true; }, 3600);
    }
    rt.banner = banner;
    function areaTick(dt){
      const ch = S.P.ch, a = areaAt(ch.x, ch.z), id = a?.id || '';
      if (id === (rt.area?.id || '')) { areaPend = null; return; }
      if (areaPend !== id) { areaPend = id; areaT = 0; return; }
      areaT += dt; if (areaT < .35) return;
      const prev = rt.area; rt.area = a; areaPend = null;
      if (a) {
        const Z = a.zone, sub = Z ? (Z.age ? `${Z.age}+ · ` : '') + Z.sub : '';
        banner(a.icon, a.name, sub, Z?.id === 'war' ? 'war' : Z ? 'zone' : '');
      }
      for (const zs of rt.mods) { try { zs.mod?.area?.(a, prev); } catch (e) { console.error(e); } }
      rt.actBtn.hidden = !(a?.zone && DEFS[a.zone.id]?.actions);
      if (rt.actsOpen) toggleActs(false);
      S.H?.prompt?.(null);
    }
    // ── Возрастные ворота: на границе и в телепортах ──
    rt.gate = Z => gateOf(Z);
    function showGate(Z, retry){
      const gt = gateOf(Z); if (gt.ok) { retry?.(); return true; }
      rt.gateFor = { Z, retry, at: now() };
      const why = Z.id === 'war' ? 'Мультяшное оружие и бои с другими игроками.' : 'Взрослые профессии: полиция и грабители, банк, бизнес, суд.';
      if (gt.why === 'unknown') {
        H.panel(`<span class="wld-pe">🎂</span><b>${esc(Z.name)} — ${Z.age}+</b>`, `<p>Сюда пускают с ${Z.age} лет. Укажи год рождения — его видишь только ты, ни игроки, ни модераторы его не узнают.</p><div class="wld-acts"><button type="button" class="ct-start" data-mz="age">🎂 Указать год</button><button type="button" data-act="close">Не сейчас</button></div>`);
      } else {
        H.panel(`<span class="wld-pe">${Z.icon}</span><b>${esc(Z.name)}</b>`, '<div class="mz-agebox"></div>');
        const box = S.q('.wld-panel .mz-agebox');
        if (box && root.D37Age?.cover) root.D37Age.cover(box, Z.age, { why, title: Z.name, compact: true, back: () => H.closePops(), onOpen: () => { H.closePops(); retry?.(); } });
      }
      return false;
    }
    rt.showGate = showGate;
    root.D37Age?.on?.(() => {   // указал год / «взрослый разрешил» — пробуем снова
      const g = rt.gateFor; if (!g || rt.stopped) return;
      if (gateOf(g.Z).ok && now() - g.at < 120e3) { rt.gateFor = null; H.closePops(); toast(`✅ Проходи: ${g.Z.icon} ${g.Z.name}`, true); g.retry?.(); }
      else if (now() - g.at < 120e3) showGate(g.Z, g.retry);
    });
    S.wrap.addEventListener('click', e => {
      const b = e.target.closest('[data-mz]'); if (!b || !S.wrap.contains(b)) return;
      const a = b.dataset.mz;
      if (a === 'age') root.D37Age?.ask?.({ edit: true });
      else if (a === 'map-close') closeMap();
      else if (a.startsWith('tp:')) mapTp(a.slice(3));
      else if (a.startsWith('lift:')) { const i = a.lastIndexOf(':'); rt.liftGo(a.slice(5, i), +a.slice(i + 1)); }
      else if (a.startsWith('ilift:')) { const i = a.lastIndexOf(':'); rt.intGo(a.slice(6, i), a.slice(i + 1)); }
      else if (a.startsWith('ov:')) { H.closePops?.(); rt.overview(a.slice(3) || null); }
      else if (a.startsWith('act:')) doAct(a.slice(4));
      else if (a === 'acts-x') toggleActs(false);
      else for (const zs of rt.mods) { try { if (zs.mod?.click?.(a, b)) break; } catch (er) { console.error(er); } }
    });
    function borderTick(){
      if (rt.inVeh?.()) return;   // в машине — правила транспорта (mir-veh.js: водитель разворачивается, пассажира высаживают)
      const P = S.P, ch = P.ch, Z = zoneAt(ch.x, ch.z);
      if (Z && Z.age && !gateOf(Z).ok) {
        const s = rt.safe;
        if (s) P.place(s.x, s.y, s.z, P.yaw + PI); else P.place(Z.gate.x + (Z.gate.x <= Z.x0 + 1 ? -6 : 6), null, Z.gate.z, P.yaw);
        S.forceSend = true;
        if (!rt.gateFor || now() - rt.gateFor.at > 6000) showGate(Z, null);
        return;
      }
      if (!Z?.age && P.mode === 'move' && ch.grounded) { const s = rt.safe || (rt.safe = {}); s.x = ch.x; s.y = ch.y; s.z = ch.z; }
    }
    // ── Телепорт: проверка возраста → затемнение → подгрузка зоны → на место ──
    function place(x, z, yaw, y){
      const P = S.P;
      rt.veh?.leave?.();   // телепорт и появление — сначала из машины
      if (P.mode === 'sit') P.standUp();
      rt.unsit();
      // опора — не выше пола первого этажа (иначе P.place поставит на крышу здания над точкой)
      P.place(x, y ?? ph.supportAt(x, z, P.ch.r * .5, 2).y, z, yaw);
      S.rig?.snap(P.ch.x, P.ch.y, P.ch.z); if (S.rig) S.rig.yaw = yaw - PI;
      R.cut?.(3); S.forceSend = true; H.savePos?.();
    }
    rt.place = place;
    rt.tp = async (x, z, yaw = 0, o = {}) => {
      const Z = zoneAt(x, z);
      if (Z && !gateOf(Z).ok) { showGate(Z, () => rt.tp(x, z, yaw, o)); return false; }
      if (rt.tpBusy) return false;
      rt.tpBusy = true;
      const f = q('.mz-fade'); f.hidden = false; f.classList.remove('out'); f.textContent = '';
      try {
        const zs = Z && rt.zones.get(Z.id);
        if (zs && !zs.built) { f.textContent = `${Z.icon} Загружаем: ${Z.name}…`; await rt.buildNow(zs); if (!zs.shown) setShown(zs, true); }
        await new Promise(r => setTimeout(r, 120));
        if (rt.stopped) return false;
        place(x, z, yaw);
        rt.sfx('pickup', { vol: .5 });
      } finally {
        rt.tpBusy = false;
        f.classList.add('out'); setTimeout(() => { if (f.classList.contains('out')) f.hidden = true; }, 380);
      }
      return true;
    };
    rt.padGo = to => {
      if (to === 'studio') { H.panel('<span class="wld-pe">🧱</span><b>Студия 3D</b>', '<p>Построй свой мир, как в Roblox Studio, и позови друзей. Студия откроется вместо мира — вернуться можно кнопкой «🌍 Мир».</p><div class="wld-acts"><button type="button" class="ct-start" data-act="go:#/games/studio3d">🧱 Открыть студию</button><button type="button" data-act="close">Остаться</button></div>'); return; }
      const p = places().find(x => x.id === to); if (!p) return;
      rt.tp(p.x, p.z, p.yaw);
    };
    // ── Карта мира (M или 🗺️): места, игроки, я; нажал место — телепорт ──
    function mapData(){
      const players = [...S.players.values()].filter(p => !p.leaving).map(p => ({ x: p.ch.x, z: p.ch.z, friend: !!(p.uid && S.friends.has(p.uid)), hot: !!p.zx?.wn }));
      const marks = []; for (const zs of rt.mods) { try { marks.push(...(zs.mod?.marks?.() || [])); } catch (e) {} }
      return { players, marks, me: { x: S.P.ch.x, z: S.P.ch.z, yaw: S.P.yaw } };
    }
    rt.mapData = mapData;
    function openMap(){
      if (rt.modal) return;
      H.closePops();
      let el = q('.mz-map');
      if (!el) {
        el = document.createElement('div'); el.className = 'mz-map'; hud.appendChild(el);
        el.addEventListener('click', e => { if (e.target === el) closeMap(); });
      }
      const pts = places(), grp = [['Лобби и старый мир', p => !p.zone], ...ZLIST.map(Z => [`${Z.icon} ${Z.name}${Z.age ? ' · ' + Z.age + '+' : ''}`, p => p.zone === Z.id])];
      el.innerHTML = `<div class="mz-map-box"><div class="mz-map-head"><b>🗺️ Карта мира</b><span>Нажми место на карте или в списке — телепорт</span><button type="button" class="mz-x" data-mz="map-close" aria-label="Закрыть">✕</button></div>
        <div class="mz-map-cv"><canvas></canvas></div>
        <div class="mz-map-pts">${grp.map(([t, f]) => { const L = pts.filter(f); return L.length ? `<div class="mz-map-sec">${esc(t)}</div><div class="mz-map-row">${L.map(p => `<button type="button" data-mz="tp:${esc(p.id)}">${p.icon} ${esc(p.name)}${p.age ? `<i class="mz-age a${p.age}">${p.age}+</i>` : ''}</button>`).join('')}</div>` : ''; }).join('')}</div></div>`;
      el.hidden = false;
      const cv = el.querySelector('canvas');
      const draw = () => {
        const b = cv.parentElement.getBoundingClientRect(), dpr = Math.min(2, root.devicePixelRatio || 1);
        const w = Math.max(200, Math.round(b.width)), h = Math.max(160, Math.round(b.height));
        if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
        const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        rt.mapView = drawMap(g, w, h, null, { points: pts, ...mapData() });
      };
      draw(); rt.mapT = setInterval(draw, 600);
      cv.onclick = e => {
        const b = cv.getBoundingClientRect(), [x, z] = rt.mapView.inv(e.clientX - b.left, e.clientY - b.top);
        let best = null, bd = 18 / Math.max(.2, rt.mapView.sc) + 6;
        for (const p of pts) { const d = Math.hypot(p.lx - x, p.lz - z); if (d < bd) { bd = d; best = p; } }
        if (best) mapTp(best.id);
      };
      rt.modal = 'map';
      S.I?.unlock?.();
      S.menu = { close: closeMap, redraw(){} };   // мир держит клавиши, пока открыто (как меню Esc)
      S.C?.reset_state();
    }
    function closeMap(){
      const el = q('.mz-map'); if (el) el.hidden = true;
      clearInterval(rt.mapT);
      if (rt.modal === 'map') { rt.modal = null; if (S.menu?.close === closeMap) S.menu = null; S.C?.reset_state(); }
    }
    function mapTp(id){
      const p = places().find(x => x.id === id); if (!p) return;
      closeMap();
      rt.tp(p.x, p.z, p.yaw);
    }
    rt.openMap = openMap; rt.closeMap = closeMap;
    // ── Действия (🎬): список своей зоны ──
    function toggleActs(on){
      const el = q('.mz-acts');
      on = on ?? el.hidden;
      rt.actsOpen = on;
      if (!on) { el.hidden = true; return; }
      const Z = rt.area?.zone, D = Z && DEFS[Z.id], list = typeof D?.actions === 'function' ? D.actions(rt) : D?.actions || [];
      el.innerHTML = `<div class="mz-acts-h"><b>🎬 Действия · ${esc(Z?.short || '')}</b><button type="button" class="mz-x" data-mz="acts-x" aria-label="Закрыть">✕</button></div><div class="mz-acts-g">${list.map(a => `<button type="button" data-mz="act:${a.id}" title="${esc(a.hint || '')}">${a.icon}<span>${esc(a.name)}</span></button>`).join('')}</div><small>Чат: «/me действие» — пишет, что делает твой персонаж</small>`;
      el.hidden = false;
    }
    rt.toggleActs = toggleActs;
    function doAct(id){
      toggleActs(false);
      if (id === 'wave') return H.emote?.('👋');
      if (id === 'dance') return H.emote?.('💃');
      if (id === 'clap') return H.emote?.('👏');
      if (id === 'call') return rt.phonePose('call', 7);
      if (id === 'photo') return rt.phonePose('photo', 3);
      if (id === 'sit') return rt.sitHere();
      if (id === 'sleep') return rt.sleepHere();
      if (id === 'me') { const i = S.q('.wld-say input'); if (i && !i.readOnly) { i.value = '/me '; i.focus(); } else toast('Войди, чтобы писать в чат'); return; }
      if (id.startsWith('eat:')) return rt.eat(id.slice(4));
      for (const zs of rt.mods) { try { if (zs.mod?.act?.(id)) return; } catch (e) { console.error(e); } }
    }
    rt.doAct = doAct;
    // ── Свои позы: телефон у уха (поза телефона мира), есть, сесть/лечь где угодно ──
    rt.phonePose = (mode, sec) => {
      if (S.phoneOn) return;
      S.phoneHand = mode; S.forceSend = true;
      clearTimeout(rt.phT); rt.phT = setTimeout(() => { if (S && S.phoneHand === mode && !S.phoneOn) { S.phoneHand = ''; S.forceSend = true; } }, sec * 1000);
      if (mode === 'call') toast('📞 Алло! (персонаж говорит по телефону)');
    };
    const FOOD = { icecream: '🍦', bun: '🥐', pizza: '🍕', burger: '🍔', apple: '🍎', cake: '🍰', juice: '🧃', soup: '🍲' };
    rt.FOOD = FOOD;
    rt.eat = (kind = 'icecream') => {
      if (S.P.mode !== 'move' && S.P.mode !== 'sit') return;
      rt.setZX({ a: 'eat', w: FOOD[kind] ? kind : 'icecream' });
      rt.sfx('pickup', { vol: .3, rate: 1.4 });
      clearTimeout(rt.eatT); rt.eatT = setTimeout(() => { if (rt.zx.a === 'eat') rt.setZX({ a: null, w: null }); }, 5200);
    };
    // сесть / лечь на место зоны (K.seat): P.sitOn + zx (другим — поза по sl)
    rt.seatPrompt = sp => (S.P.mode === 'sit' ? null : sp.name);
    rt.sitDown = sp => {
      const P = S.P;
      if (!P.sitOn({ x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw })) return;
      rt.mySeat = sp;
      const r2 = v => Math.round(v * 100) / 100;
      rt.setZX({ a: sp.bed ? 'sleep' : 'sit', sl: [r2(sp.x), r2(sp.y), r2(sp.z), r2(sp.yaw)] });
      rt.sfx('click');
      if (sp.bed) toast('😴 Спокойной ночи! Пробел или шаг — встать');
    };
    rt.unsit = () => { if (rt.zx.a === 'sit' || rt.zx.a === 'sleep') rt.setZX({ a: null, sl: null }); rt.mySeat = null; };
    S.P.on('stand', () => rt.unsit());
    rt.sitHere = () => {
      const P = S.P, ch = P.ch;
      let best = null, bd = 4;
      for (const sp of [...[...rt.zones.values()].flatMap(zs => zs.K?.seats || []), ...intSeats]) { const d = Math.hypot(sp.x - ch.x, sp.z - ch.z) + Math.abs(sp.y - ch.y) * 2; if (!sp.bed && d < bd) { bd = d; best = sp; } }
      if (best) return rt.sitDown(best);
      if (P.mode !== 'move' || !ch.grounded) return;
      rt.sitDown({ x: ch.x, y: ch.y + .32, z: ch.z, yaw: P.yaw, name: 'Сесть' });   // прямо на землю
    };
    rt.sleepHere = () => {
      const ch = S.P.ch;
      let best = null, bd = 5;
      for (const sp of [...[...rt.zones.values()].flatMap(zs => zs.K?.seats || []), ...intSeats]) { const d = Math.hypot(sp.x - ch.x, sp.z - ch.z) + Math.abs(sp.y - ch.y) * 2; if (sp.bed && d < bd) { bd = d; best = sp; } }
      if (best) rt.sitDown(best); else toast('🛏 Подойди к кровати — в домах и в больнице');
    };
    // ── zx: своё состояние для сети ──
    rt.setZX = patch => {
      for (const [k, v] of Object.entries(patch)) { if (v == null) delete rt.zx[k]; else rt.zx[k] = v; }
      const sig = JSON.stringify(rt.zx);
      if (sig !== rt.zxSig) { rt.zxSig = sig; S.forceSend = true; }
    };
    rt.stx = () => (rt.zxSig && rt.zxSig !== '{}' ? { sig: rt.zxSig + (rt.zxTick ? '|' + rt.zxTick : ''), data: rt.zx } : null);
    rt.onSt = (p, d) => {
      const z = cleanZX(d.zx);
      const was = p.zx;
      p.zx = z;
      if (JSON.stringify(was || null) !== JSON.stringify(z)) for (const zs of rt.mods) { try { zs.mod?.remote?.(p, z, was); } catch (e) { console.error(e); } }
    };
    rt.onHi = () => { if (rt.zxSig && rt.zxSig !== '{}') setTimeout(() => { if (!rt.stopped) S.forceSend = true; }, 400 + Math.random() * 1600); rt.veh?.onHi?.(); };
    rt.onMsg = (p, d) => {
      if (d.t === 'vh') { try { rt.veh?.onMsg?.(p, d); } catch (e) { console.error(e); } return; }   // транспорт (mir-veh.js)
      if (d.k === 'brk' && rt.destruct && typeof d.id === 'string' && d.id.length < 64) {   // у другого что-то сломалось — у меня тоже (обломки — свои)
        rt.destruct.breakId(d.id, (+d.s || 0) >>> 0, Math.max(-1, Math.min(1, +d.dx || 0)), Math.max(-1, Math.min(1, +d.dz || 0)), true);
        return;
      }
      for (const zs of rt.mods) { try { if (zs.mod?.onMsg?.(p, d)) return; } catch (e) { console.error(e); } }
    };
    rt.send = d => H.send?.({ t: 'z', ...d });
    rt.vehSend = d => H.send?.({ t: 'vh', ...d });
    // транспорт: крючки mir.js (за рулём — шаг машины вместо шага человечка; камера — за машиной; направление не шлём)
    rt.drive = (dt, C, rig) => {
      if (OV) { ovStep(dt, C); return true; }   // вид мэра: человечек стоит, WASD двигает камеру
      try { return !!rt.veh?.drive?.(dt, C, rig); } catch (e) { console.error(e); return false; }
    };
    rt.camTarget = () => (OV ? OV.pt : rt.veh?.camTarget?.() || null);
    // ═══ Вид мэра (задел «градостроителя»): город сверху — крыши по типу зданий (жильё зелёное, торговля и офисы синие,
    //     производство жёлтое, город — красный, мэрия — бордовая); WASD — двигаться, колесо — ближе/дальше, мышь — повернуть ═══
    let OV = null;
    function ovStep(dt, C){
      const rig = S.rig, Zn = ZONES[OV.zid], k = rig.dist * .9 * dt;
      const fx = -Math.sin(rig.yaw), fz = -Math.cos(rig.yaw), rx = Math.cos(rig.yaw), rz = -Math.sin(rig.yaw);
      OV.pt.x = Math.max(Zn.x0, Math.min(Zn.x1, OV.pt.x + (rx * C.move.x + fx * C.move.z) * k));
      OV.pt.z = Math.max(Zn.z0, Math.min(Zn.z1, OV.pt.z + (rz * C.move.x + fz * C.move.z) * k));
      if (C.down('interact')) rt.overview(null);
    }
    rt.overview = zid => {
      const rig = S.rig;
      if (OV || !zid || !ZONES[zid]) {
        if (!OV) return false;
        Object.assign(rig, OV.rig); if (OV.fog) R.setLighting?.(OV.fog);
        OV = null; q('.mz-ov')?.remove(); toast('👋 Обычный вид'); return false;
      }
      const Zn = ZONES[zid];
      H.closePops?.();
      // точка — высоко над крышами (луч камеры к ней не упирается в небоскрёбы)
      const L0 = R.lighting || {}, fog0 = L0.gfx?.fog ? { ...L0.gfx.fog } : null;
      OV = { zid, pt: { x: (Zn.x0 + Zn.x1) / 2, y: 150, z: (Zn.z0 + Zn.z1) / 2 }, rig: { dist: rig.dist, maxD: rig.maxD, minD: rig.minD, minP: rig.minP, pitch: rig.pitch }, fog: { fogEnd: L0.fogEnd ?? 260, ...(fog0 ? { gfx: { fog: fog0 } } : {}) } };
      Object.assign(rig, { maxD: 420, minD: 60, minP: .7, dist: Math.max(Zn.x1 - Zn.x0, Zn.z1 - Zn.z0) * .8, pitch: 1.2 });
      R.setLighting?.({ fogEnd: 1600, gfx: { fog: { density: 0, height: 0 } } });   // сверху — без тумана (частичное освещение — только туман)
      const b = document.createElement('button'); b.type = 'button'; b.className = 'mz-ov'; b.dataset.mz = 'ov:'; b.textContent = '✕ Выйти из вида мэра'; hud.appendChild(b);
      toast('🏛️ Вид мэра: крыши — по типу зданий. WASD — двигаться, колесо — ближе/дальше, E или Esc — выйти', true);
      return true;
    };
    rt.inOverview = () => !!OV;
    // ворота «Кубомира» и «Подземья»: большая игра на весь экран — своей страницей (MirPlay их не берёт), вернуться — «🌍 Мир»
    rt.bigGame = gt => {
      const gi = typeof GAMES !== 'undefined' ? GAMES.find(x => x.id === gt.g) : null;
      if (!gi) { toast(`${gt.e} ${gt.name} — скоро`); return; }
      H.panel(`<span class="wld-pe">${gt.e}</span><b>${esc(gt.name)}</b>${gi.age ? ` <i class="mz-age a${parseInt(gi.age, 10) || 0}">${esc(gi.age)}</i>` : ''}`,
        `<p>${esc(gt.what || gi.desc || '')}</p><p><small>Большая игра на весь экран — мир закроется. Вернуться — кнопкой «🌍 Мир».</small></p><div class="wld-acts"><button type="button" class="ct-start" data-act="go:#/games/${esc(gt.g)}">▶ Играть</button><button type="button" data-act="close">Остаться в мире</button></div>`);
    };
    rt.inVeh = () => !!rt.veh?.inVeh?.();
    // ── Подпись у ника: роль (значок) и семья ──
    rt.tag = p => {
      const z = p === S.me ? rt.zx : p.zx; if (!z) return '';
      const r = z.r && ROLES[z.r], f = z.f && FAMILY[z.f];
      return (f ? f[0] + ' ' : '') + (r ? r.icon + ' ' : '') + (z.wn ? '⭐'.repeat(z.wn) + ' ' : '') + (z.pr ? '🔒 ' : '');
    };
    // ── Чат: /me и строгий фильтр в детском городе (у всех, кто там) ──
    rt.chat = (p, t) => {
      const pos = p === S.me ? S.P.ch : p.ch, kidsZ = ZONES.kids;
      const strict = (pos && inRect(kidsZ, pos.x, pos.z, 4)) || inRect(kidsZ, S.P.ch.x, S.P.ch.z, 4);
      if (strict && root.D37Age?.kidText) t = root.D37Age.kidText(t);
      const m = /^\/me\s+(.{1,100})$/i.exec(t);
      if (m) return { me: true, text: m[1] };
      return t;
    };
    // ── Esc: закрыть своё ──
    rt.esc = () => {
      if (OV) { rt.overview(null); return true; }
      if (rt.modal === 'map') { closeMap(); return true; }
      if (rt.actsOpen) { toggleActs(false); return true; }
      for (const zs of rt.mods) { try { if (zs.mod?.esc?.()) return true; } catch (e) {} }
      return false;
    };
    rt.placeName = () => { const a = rt.area; return a ? `в «${a.name}»` : ''; };
    // ── Поза поверх человечка (после A.update): лежит, ест, несёт, шланг, оружие ──
    const sprites = new Map();   // эмодзи → материал
    const spriteMat = e => {
      let m = sprites.get(e);
      if (!m) { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.font = '52px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, 32, 36); const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; m = new T.SpriteMaterial({ map: t, transparent: true, depthWrite: false }); R.own.push(t, m); sprites.set(e, m); }
      return m;
    };
    rt.spriteMat = spriteMat;
    function held(a, e){   // эмодзи в правой руке (общий спрайт на человечка)
      const ch = a.ch, d = ch.mzHold || (ch.mzHold = new T.Sprite(spriteMat(e)));
      if (d.material !== spriteMat(e)) d.material = spriteMat(e);
      if (d.parent !== ch.handR) { ch.handR.add(d); d.position.set(.05, -.18, .14); d.scale.setScalar(.45); }
      d.visible = true;
    }
    const hide = a => { const d = a.ch?.mzHold; if (d) d.visible = false; };
    // ── Форма роли поверх человечка: шапка (на голову) и жилет (на туловище) — одна сетка каждая, общие на всех ──
    // Части шапки — в единицах головы (радиус 0,56): [фигура, x, y, z, размеры, цвет]
    const HATS = {
      chef: [['cyl', 0, .18, 0, { r: .3, r2: .33, h: .4 }, '#ffffff'], ['ball', 0, .44, 0, { r: .38, sy: .62 }, '#ffffff']],
      chefPink: [['cyl', 0, .14, 0, { r: .3, r2: .33, h: .3 }, '#fbcfe8'], ['ball', 0, .34, 0, { r: .34, sy: .6 }, '#f9a8d4']],
      fire: [['ball', 0, .02, 0, { r: .62, sy: .72 }, '#dc2626'], ['cyl', 0, -.04, .05, { r: .74, h: .05 }, '#b91c1c'], ['box', 0, .22, .58, { w: .26, h: .24, d: .06 }, '#facc15']],
      doc: [['cyl', 0, .08, 0, { r: .55, h: .2 }, '#ffffff'], ['box', 0, .1, .55, { w: .22, h: .07, d: .03 }, '#ef4444'], ['box', 0, .1, .55, { w: .07, h: .22, d: .03 }, '#ef4444']],
      vet: [['cyl', 0, .08, 0, { r: .55, h: .2 }, '#bbf7d0'], ['box', 0, .1, .55, { w: .2, h: .12, d: .03 }, '#15803d']],
      hard: [['ball', 0, .02, 0, { r: .62, sy: .64 }, '#facc15'], ['cyl', 0, -.04, 0, { r: .72, h: .05 }, '#eab308'], ['box', 0, .32, 0, { w: .12, h: .1, d: .9 }, '#ca8a04']],
      police: [['cyl', 0, .12, 0, { r: .6, r2: .52, h: .26 }, '#1e3a8a'], ['box', 0, .02, .52, { w: .62, h: .05, d: .3 }, '#111827'], ['ball', 0, .2, .56, { r: .07 }, '#facc15']],
      visor: [['cyl', 0, .02, 0, { r: .58, h: .1 }, '#166534'], ['box', 0, -.02, .55, { w: .6, h: .04, d: .32 }, '#166534']],
      cap: [['ball', 0, .02, 0, { r: .6, sy: .45 }, '#dc2626'], ['box', 0, -.04, .55, { w: .55, h: .04, d: .34 }, '#b91c1c']],
      taxi: [['ball', 0, .02, 0, { r: .6, sy: .45 }, '#facc15'], ['box', 0, -.04, .55, { w: .55, h: .04, d: .34 }, '#111827'], ['box', 0, .2, .5, { w: .3, h: .12, d: .04 }, '#111827']],
      robber: [['ball', 0, .04, 0, { r: .62, sy: .62 }, '#111827'], ['ball', 0, .36, 0, { r: .14 }, '#ef4444'], ['box', 0, -.28, .5, { w: .9, h: .16, d: .1 }, '#111827']],
      judge: [['ball', -.48, -.22, 0, { r: .26 }, '#f8fafc'], ['ball', .48, -.22, 0, { r: .26 }, '#f8fafc'], ['ball', 0, .1, -.1, { r: .52, sy: .7 }, '#f1f5f9']],
      army: [['ball', 0, .02, 0, { r: .64, sy: .7 }, '#4d7c0f'], ['cyl', 0, -.06, 0, { r: .72, h: .05 }, '#3f6212']],
      beret: [['ball', .12, .2, 0, { r: .56, sy: .32 }, '#7f1d1d']],
    };
    const dressGeo = new Map();
    function dressMesh(key, build){
      let g = dressGeo.get(key);
      if (!g) {
        const tmp = new T.Group(); build(tmp);
        const out = merge(R, tmp, { ao: false });
        g = out[0]?.geometry || null; dressGeo.set(key, g);
        for (let i = 1; i < out.length; i++) out[i].geometry.dispose();
      }
      if (!g) return null;
      const m = new T.Mesh(g, sharedMats(R).std); m.userData.mzDress = true; if (R.q !== 'low') m.castShadow = true;
      return m;
    }
    function dress(a, role){
      const ch = a.ch, id = role ? role.id : '';
      const D = ch.mzDress;
      if ((D?.id || '') === id) return;
      if (D) for (const m of D.meshes) m.parent?.remove(m);
      const meshes = [];
      if (role && ch.phD) {
        const d = ch.phD;
        const hat = role.hat && HATS[role.hat] && dressMesh('hat:' + role.hat, g => { for (const [s, x, y, z, o, c] of HATS[role.hat]) R.part(g, { s, x, y, z, c, seg: 14, ...o }); });
        if (hat) { hat.position.set(0, d.hy * .8, 0); ch.head.add(hat); meshes.push(hat); }
        if (role.vest) {
          const tw = Math.round(d.tw * 20) / 20, td = Math.round(d.td * 20) / 20, h = Math.round((d.y1 - d.y0) * .62 * 20) / 20;
          const vest = dressMesh(`vest:${tw}:${td}:${h}:${role.vest}:${role.stripe || 0}`, g => {
            R.part(g, { s: 'box', w: tw * 2.16, h, d: td * 2.2, c: role.vest });
            if (role.stripe === 1) R.part(g, { s: 'box', y: -h * .18, w: tw * 2.2, h: h * .14, d: td * 2.24, c: '#fde047' });
            if (role.stripe === 2) for (const k of [-.3, 0, .3]) R.part(g, { s: 'box', y: h * k, w: tw * 2.2, h: h * .1, d: td * 2.24, c: '#f8fafc' });
          });
          if (vest) { vest.position.set(0, d.y0 + (d.y1 - d.y0) * .44, 0); ch.torso.add(vest); meshes.push(vest); }
        }
      }
      ch.mzDress = { id, meshes };
    }
    rt.dress = dress;
    rt.preActors = (dt, t) => {
      // сидит/лежит на месте зоны — у чужих по sl (своему ставит player.js)
      for (const p of S.players.values()) {
        const z = p.zx, a = S.A.get(p.key); if (!a) continue;
        if (z?.sl && (z.a === 'sit' || z.a === 'sleep')) { a.sit = z.a === 'sit'; a.seatY = z.sl[1]; a.x = z.sl[0]; a.z = z.sl[2]; a.yaw = z.sl[3]; a.moving = false; if (z.a === 'sleep') { a.sit = false; a.y = z.sl[1]; } }
      }
      const me = S.A.get(S.key);
      if (me && rt.zx.a === 'sleep') { me.sit = false; me.moving = false; }
      for (const zs of rt.mods) { try { zs.mod?.preActors?.(dt, t); } catch (e) { console.error(e); } }
      try { rt.veh?.preActors?.(); } catch (e) { console.error(e); }   // седоки — в машинах
    };
    const SPIN = new T.Euler();
    rt.postActors = (dt, t) => {
      const cam = R.camera.position;
      for (const [key, a] of S.A.list) {
        if (!a.ch || !a.ch.root.visible) continue;
        const p = key === S.key ? S.me : S.players.get(key), z = p === S.me ? rt.zx : p?.zx;
        const ch = a.ch, root3 = ch.root;
        if (root3.rotation.order !== 'YXZ') root3.rotation.order = 'YXZ';
        if (z?.a === 'sleep' && z.sl) {   // лежит на спине вдоль кровати: голова — к изголовью (−z кровати)
          const [x, y, zz, yaw] = z.sl, L = (ch.top || 2.3) * .5;
          root3.rotation.x = -PI / 2; root3.rotation.y = yaw;
          root3.position.set(x + Math.sin(yaw) * L * .95, y + .18, zz + Math.cos(yaw) * L * .95);
          if (ch.faceSet?.userData?.eyes) ch.faceSet.userData.eyes.scale.y = .12;
        } else if (root3.rotation.x) root3.rotation.x = 0;
        dress(a, z?.r ? ROLES[z.r] : null);   // форма роли (у всех — по zx.r)
        if (Math.hypot(a.x - cam.x, a.z - cam.z) > 40) { hide(a); continue; }
        // руки: есть / нести / шланг / целиться / лечить
        if (z?.a === 'eat' && !a.phone) {
          held(a, FOOD[z.w] || '🍦');
          const k = (Math.sin(t * 5.2 + (a.x + a.z)) + 1) / 2;
          ch.armR.rotation.x = -1.6 - .5 * k; ch.armR.rotation.z = .18; ch.elbowR.rotation.x = -1.7 - .4 * k;
          ch.headP.rotation.x += .1 * k;
        } else if (z?.a === 'carry') {
          held(a, z.w && rt.CARRY?.[z.w] || '📦');
          ch.armR.rotation.set(-1.25, 0, .25); ch.armL.rotation.set(-1.25, 0, -.25); ch.elbowR.rotation.x = -.5; ch.elbowL.rotation.x = -.5;
        } else if (z?.a === 'hose' || z?.a === 'heal' || z?.a === 'fix' || z?.a === 'cook') {
          held(a, { hose: '🧯', heal: '💉', fix: '🔧', cook: '🍳' }[z.a]);
          const k = Math.sin(t * 9) * .08;
          ch.armR.rotation.set(-1.35 + k, 0, .1); ch.armL.rotation.set(-1.2, 0, -.3); ch.elbowR.rotation.x = -.35; ch.elbowL.rotation.x = -.6;
        } else if (z?.a === 'aim' && z.w) {
          held(a, rt.WEAPON_E?.[z.w] || '🔫');
          ch.armR.rotation.set(-1.5, 0, .05); ch.elbowR.rotation.x = -.15; ch.armL.rotation.set(-1.35, 0, -.35); ch.elbowL.rotation.x = -.7;
        } else hide(a);
        void SPIN;
      }
      for (const zs of rt.mods) { try { zs.mod?.postActors?.(dt, t); } catch (e) { console.error(e); } }
    };
    // ── Подписи жителей зон (как у жителей мира: ник и облачко) ──
    const tagBox = q('.mz-tags');
    rt.npcTag = (o, txt) => { o._tagTxt = txt; o._tagT = now(); };
    function drawNpcTags(){
      if (!S.NPC) return;
      const P = S.P.ch;
      for (const zs of rt.zones.values()) {
        for (const o of zs.K?.npcs || []) {
          if (!o._on) { if (o._tagEl) o._tagEl.style.display = 'none'; continue; }
          const e = S.NPC.list.get(o.id), h = e && S.NPC.head(e);
          let el = o._tagEl;
          if (!el) { el = o._tagEl = document.createElement('div'); el.className = 'wld-tag wld-npc'; el.innerHTML = '<div class="wld-tbub" hidden></div><b class="wld-tname"></b>'; el.lastChild.textContent = o.name || ''; tagBox.appendChild(el); }
          const far = !h || Math.hypot(h[0] - P.x, h[2] - P.z) > 24 || Math.abs(h[1] - P.y) > 10;   // этажом выше/ниже — без подписи
          const [sx, sy, vis] = h && !far ? R.project(h[0], h[1] + .15, h[2]) : [0, 0, false];
          if (!vis) { el.style.display = 'none'; continue; }
          el.style.display = '';
          el.style.transform = `translate(${Math.round(sx)}px,${Math.round(sy)}px) translate(-50%,-100%)`;
          const bub = el.firstChild, show = o._tagTxt && now() - o._tagT < 6000;
          if (show) { if (bub.textContent !== o._tagTxt) bub.textContent = o._tagTxt; bub.hidden = false; } else bub.hidden = true;
        }
      }
    }
    // ── Шаг и кадр ──
    let lazyT = 0;
    rt.update = dt => {
      if (rt.stopped) return;
      rt.t += dt;
      // камера внутри небоскрёба/дома с верхними этажами: тела выше (спрятанные) не держат камеру, пока ты внутри
      let camOff = null;
      for (const c of S.P.ch.inside) if (c.data?.camOff) { camOff = c.data.camOff; break; }
      if (camOff !== rt.camOff) { for (const b of rt.camOff || []) b.data.cam = true; for (const b of camOff || []) b.data.cam = false; rt.camOff = camOff; }
      const C = S.C;
      if (C && !rt.modal && C.down('map')) openMap();
      else if (C && rt.modal === 'map' && C.downRaw?.('map')) closeMap();
      if (C && !rt.modal && C.down('emote') && !rt.actBtn.hidden) toggleActs();
      borderTick();
      areaTick(dt);
      lazyT -= dt;
      if (lazyT <= 0) {   // подгрузка зон — 4 раза в секунду (по камере и игроку)
        lazyT = .25;
        const c = R.camera.position, p = S.P.ch;
        for (const zs of rt.zones.values()) {
          const d = Math.min(distRect(zs.Z, c.x, c.z), distRect(zs.Z, p.x, p.z));
          if (!zs.built && !zs.it && d < LOAD_D) beginBuild(zs);
          if (zs.built && (zs.ready || zs.shown)) { const want = d < (zs.shown ? HIDE_D : SHOW_D); if (want !== zs.shown) setShown(zs, want); }
        }
        lazyTick();   // интерьеры этажей, магазинов ТЦ, номеров — рядом с игроком
        npcTick();    // жители — только рядом
        intTick();    // этажи зданий (генератор интерьеров) — у входа, внутри, по лифту
      }
      for (const zs of rt.mods) { try { zs.mod?.update?.(dt); } catch (e) { console.error(e); } }
      try { rt.veh?.update?.(dt); } catch (e) { console.error(e); }   // транспорт: чужие машины, седоки, возврат на стоянку
    };
    // ═══ Разрушения (js/engine/destruct.js): детский городок и столица — никогда; Большой город — мелочь (столбы, скамейки,
    //     деревья); боевая зона и природа — всё. Деревья карты — «лениво» (кто рядом с ударом). По сети — «сломан id» с зерном ═══
    if (E?.destruct) {
      const ruleOf = b => { const z = b.zone !== undefined ? b.zone : zoneAt(b.x, b.z)?.id || null; return z === 'kids' ? 'none' : z === 'metro' ? 'small' : z === 'war' ? 'all' : z ? 'none' : inRect(clusterRect(), b.x, b.z, 4) ? 'none' : 'all'; };
      const treeId = (x, z) => 'wt:' + Math.round(x * 4) + ':' + Math.round(z * 4);
      const DS = rt.destruct = E.destruct(R, ph, { fx: () => S.FX, sfx: (n, o) => rt.sfx(n, o), rule: ruleOf, restore: 5,
        // деревья карты: те, что рядом, — в список (спрятать — у вида рельефа)
        provide: (x, z, r, D) => { const M = worldMap(); if (!M) return; M.trees(x - r, z - r, x + r, z + r, (tx, ty, tz, k, pine) => { const id = treeId(tx, tz); if (!D.list.has(id)) D.add({ id, temp: true, zone: null, kind: pine ? 'pine' : 'tree', x: tx, y: ty - .1, z: tz, h: (pine ? 8.4 : 7) * k, r: .3 * k, c2: pine ? '#2f6b3a' : '#4f9a45', bodies: [], hide: on => rt.wmv?.cutTree?.(id, on) }); }); },
        lookup: id => { const m = /^wt:(-?\d+):(-?\d+)$/.exec(id); if (!m) return null; const x = +m[1] / 4, z = +m[2] / 4; DS.hit(x, z, 0, 0); return DS.list.get(id) || null; },
        busy: b => Math.hypot(S.P.ch.x - b.x, S.P.ch.z - b.z) < 3,   // восстановится, когда рядом никто не стоит
      });
      DS.onBreak = (id, s, dx, dz) => rt.send({ k: 'brk', id, s, dx, dz });
    }
    // жители пугаются (удар, взрыв, что-то упало рядом): убегают от игрока 5 с, «😭» над головой
    rt.scare = (x, z, r) => {
      const N = S.NPC; if (!N?.list) return;
      for (const e of N.list.values()) {
        const o = e.o, ch = e.P?.ch; if (!ch || Math.hypot(ch.x - x, ch.z - z) > r) continue;
        if (!o._act0) o._act0 = o.act; o.act = 'flee'; o._fleeT = performance.now() + 5000;
        try { N.A?.emote?.(e.key, '😭', 2); } catch (er) {}
      }
    };
    // рельеф карты: чанки рядом с камерой (дальность — по туману), деревья, тела деревьев рядом с игроком
    try { const wm = worldMap(); if (wm) rt.wmv = wm.view(R, { far: () => R.camera.far * .98 }); } catch (e) { console.error(e); }
    rt.frame = (dt, t) => {
      if (rt.stopped) return;
      rt.frameNo = (rt.frameNo || 0) + 1;
      if (rt.wmv) { const c = R.camera.position, p = S.P.ch; try { rt.wmv.update(c.x, c.z, { ph: S.ph, px: p.x, pz: p.z }); } catch (e) { console.error(e); rt.wmv = null; } }
      if (rt.destruct) { try { rt.destruct.update(dt); } catch (e) { console.error(e); } }
      if (S.NPC?.list) { const tn = performance.now(); for (const e of S.NPC.list.values()) if (e.o._fleeT && tn > e.o._fleeT) { e.o.act = e.o._act0 || 'wander'; e.o._fleeT = 0; e.o._act0 = null; } }
      {
        const c = R.camera.position, p = S.P.ch;
        let job = null, jd = Infinity;
        for (const zs of rt.zones.values()) if (busy(zs)) { const d = Math.min(distRect(zs.Z, c.x, c.z), distRect(zs.Z, p.x, p.z)); if (d < jd) { jd = d; job = zs; } }
        if (job) {
          // игрок уже рядом, а зоны нет — достраиваем быстрее (телефон ×4: кадр ~30 мс, запас до «рывка» 50 мс — ~20 мс)
          stepBuild(job, BUD * (jd < 25 ? 6 : jd < SHOW_D ? 3 : 1));
          if (job.ready && !job.shown && distRect(job.Z, c.x, c.z) < SHOW_D) setShown(job, true);
        }
      }
      for (const zs of rt.mods) { try { zs.mod?.frame?.(dt, t); } catch (e) { console.error(e); } }
      try { rt.veh?.frame?.(dt, t); } catch (e) { console.error(e); }
      drawNpcTags();
    };
    rt.dispose = () => {
      CELLAR.on = false;
      try { rt.veh?.dispose?.(); } catch (e) { console.error(e); }
      try { rt.wmv?.dispose?.(S.ph); } catch (e) { console.error(e); } rt.wmv = null;
      try { rt.destruct?.dispose(); } catch (e) { console.error(e); } rt.destruct = null; BRK.clear();
      rt.stopped = true;
      clearTimeout(rt.bannerT); clearTimeout(rt.phT); clearTimeout(rt.eatT); clearInterval(rt.mapT);
      for (const zs of rt.zones.values()) {
        try { zs.mod?.stop?.(); } catch (e) { console.error(e); }
        if (S.NPC) for (const o of zs.K?.npcs || []) if (o._on) { S.NPC.remove(o); o._on = false; }
        if (zs.grp) { disposeOwn(zs.grp); zs.grp.parent?.remove(zs.grp); }
        for (const p of zs.K?.pieceList || []) PIECES.delete(p.id);
      }
      for (const h of mounted.values()) { try { h.dispose(); } catch (e) {} } mounted.clear();
      if (S.menu?.close === closeMap) S.menu = null;
      hud.remove(); rt.actBtn?.remove(); rt.mapBtn?.remove();
    };
    // начал прямо в зоне (вернулся после перезагрузки) — сначала построить её, потом поставить на сохранённую высоту
    {
      const ch = S.P.ch, Z = zoneAt(ch.x, ch.z);
      if (Z && gateOf(Z).ok) {
        const zs = rt.zones.get(Z.id);
        let y0 = ch.y; try { const s = JSON.parse(root.localStorage?.getItem('d37_mir_pos') || 'null'); if (s && typeof s.y === 'number') y0 = s.y; } catch (e) {}
        const f = q('.mz-fade'); f.hidden = false; f.classList.remove('out'); f.textContent = `${Z.icon} Загружаем: ${Z.name}…`;
        rt.buildNow(zs).then(() => {
          if (rt.stopped) return;
          if (!zs.shown) setShown(zs, true);
          S.P.place(ch.x, ph.supportAt(ch.x, ch.z, ch.r * .5, y0 + .3).y, ch.z, S.P.yaw);
          f.classList.add('out'); setTimeout(() => { if (f.classList.contains('out')) f.hidden = true; }, 380);
        });
      }
    }
    rt.ZONES = ZONES; rt.DEFS = DEFS; rt.ROLES = ROLES; rt.PAY = PAY;
    rt.places = places; rt.zoneAt = zoneAt; rt.inRect = inRect; rt.distRect = distRect;
    rt.esc_ = esc;
    // ── Монеты за работу (пачкой, сервер режет): задание → +PAY.task в «ожидании», выплата — когда набралось ──
    rt.payTask = async (why, n) => {
      const s = payState(), add = payAdd(s, n);
      paySave(s);
      if (!add) { if (!rt.payCapHint) { rt.payCapHint = true; toast('🪙 Монеты за работу на сегодня — всё. Работать можно и дальше — за 💵 и ⭐'); } return 0; }
      if (s.pend >= PAY.batch) await rt.payOut(why);
      return add;
    };
    rt.payOut = async why => {
      const s = payState(); if (!s.pend || !root.D37Coins) return;
      const amt = Math.min(PAY.cap, s.pend), ref = 'rp:' + Date.now().toString(36) + ':' + (s.n + 1);
      const r = await root.D37Coins.run('rp', amt, ref);
      const s2 = payState();
      if (r?.ok) { s2.pend = Math.max(0, s2.pend - amt); s2.got += amt; s2.n++; paySave(s2); toast(`🪙 +${r.got ?? amt} — зарплата${why ? ': ' + why : ''}`, true); }
      else if (r?.reason === 'game') { if (!rt.payHint) { rt.payHint = true; toast('🪙 Зарплата монетами заработает, когда сайт обновится'); } }
      else if (r?.reason === 'day_cap') { s2.pend = 0; paySave(s2); }
    };
    // транспорт мира: машины, лодки, вертолёты, самолёт из мест зон (js/games/mir-veh.js + js/engine/vehicle*.js)
    try { rt.veh = root.MirVeh?.start?.(rt) || null; } catch (e) { console.error(e); rt.veh = null; }
    return rt;
  }
  const FAMILY = { mom: ['👩', 'Мама'], dad: ['👨', 'Папа'], son: ['👦', 'Сын'], dau: ['👧', 'Дочка'], baby: ['👶', 'Малыш'], gma: ['👵', 'Бабушка'], gpa: ['👴', 'Дедушка'], pet: ['🐾', 'Питомец семьи'] };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  root.MirZones = {
    ADULT_AGE, WAR_AGE, ZONES, ZLIST, RESERVE, SEA, BUNKER, CANAL, EXPAND, AREAS, ROADS, PADS, PAD_R, PLACES0, FAMILY, PAY, DEFS, ROLES, ACTS,
    BTYPES, FLOOR_H, TILE, FACADES, PIECES, roofColor, lotsOf, buildings, building, modular, pieceGroup, facadeMat, accessRules: MZ_ACCESS,
    def, inRect, distRect, rectsOverlap, zoneAt, areaAt, roadDist, segDist, bounds, groundRect, blocked, hillOk, terrain, water, gateOf, cleanZX, residents, residentAt, BIG_GATES,
    MAP, mapBounds, mapLayout, worldMap, clusterRect, addHole, HOLES, BRK, brkHide, TOUGH, CELLAR, cellarOn: () => CELLAR.on,
    payState, payAdd, places, drawMap, fullView, merge, atlas, kit, build, groundHoles, start, district, esc,
    LOAD_D, SHOW_D, HIDE_D,
  };
  // Карта мира — и для телефона 📱 (phone-apps.js «Карта»)
  root.MirMap = { draw: drawMap, points: places, fullView, ZONES, ZLIST };
})();
