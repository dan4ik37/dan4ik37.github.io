// ═══════════════════════════════════════
//  «МИР ДЕНЧИКА»: РАЙОН УЧАСТКОВ (мирный: дом, мебель, гости — как в Аватарии) и ВОЕННЫЕ БАЗЫ боевой зоны (12+: главарь,
//  состав со званиями, оборона, казарма, техника, бункер, набеги — как в Clash of Clans и Military Tycoon). mir.js подключает
//  этот файл маленькими «крючками» (помечены «район участков»): зона на карте, шаг, кадр, сеть, выход.
// ═══════════════════════════════════════
// РАЙОН: участок — 12×12 клеток по 1,6 ед., на «улице» 6 участков (северо-запад от площади, за кафе); улиц сколько нужно
// (номер участка 1…600, улица = (номер − 1) / 6). Вошедший занимает ОДИН участок (bases.sql: base_claim) и строит:
// ратуша (её уровень — потолок для остальных), дом (заходишь внутрь, ставишь мебель; доступ: все / друзья / никто),
// шахты (кирпичи 🧱 копятся сами, даже без тебя — заходи собирать), склады (вместимость), мастерская (второй
// строитель), смотровая вышка (лестница наверх), заборы (соседние соединяются) и украшения. Улучшение — кирпичи + реальное
// время (20 с … 8 ч), строителей 1–2; ускорить — монетами 🪙 сайта. Подарок дня в ратуше, 👍 соседям (+10 🧱 хозяину).
// Набегов на район НЕТ (владелец 15.10, п. 31): оборона, казарма и армия переехали в военные базы; старая оборона района
// возвращается кирпичами (bases.sql, перенос). ВОЕННАЯ БАЗА: участок wb01…wb12 боевой зоны (js/games/mir-war.js PLOTS; сектор —
// 12 участков, сектор = (номер − 1) / 12, номер 1…1200) — 32×32 клетки, открытая часть растёт со штабом 16 → 32 (WAR.ring).
// Основал — главарь; состав — офицеры и бойцы (вступают по ссылке-приглашению), имя — из готовых (NAMES) + номер, без своего
// текста. Казна — кирпичи базы (карьеры, завод, добыча, пожертвования из района), строят и тренируют главарь и офицеры.
// Считает СЕРВЕР по отметкам времени (base_act / war_act); клиент — те же правила (Rules / WRules: мгновенный отклик и режим без
// сервера). Цифры — DEFS/FURN и WDEFS/UNITS/HERO/RAID/VEH ниже = base_defs() и war_defs() в bases.sql (собирает
// node scripts/gen-base-defs.cjs; тесты сверяют). Без входа или пока bases.sql не выполнен — «пробный участок» района в этом
// браузере (localStorage d37_base); после входа он переносится в аккаунт (base_claim с p_import: уровни до 2, кирпичи до 500).
// Чужие участки — base_street / war_sector (раз в 90 с рядом и по сигналу 'base' в канале мира), дом — base_room (сервер
// пускает по настройке доступа). Постройки участка склеиваются в 2–4 сетки (цвет — в вершинах), дальние участки прячутся.
// Проверка: node scripts/base-test.cjs (правила, геометрия района и баз).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const PI = Math.PI;

  // ═══ Каталог района (то, что знает сервер, — base_defs() в bases.sql; n/e/info — только для экрана) ═══
  // w×d — клетки; lv — уровней; cost[L−1] — 🧱 за уровень L (L = 1 — поставить); time[L−1] — секунд; max[ратуша−1] — штук;
  // rate — 🧱 в час, hold — сколько вмещает сама шахта (8 ч), keep — вместимость склада; g: 'deco' — общий лимит украшений;
  // th — с какого уровня ратуши; coins — цена в монетах 🪙 (вместо кирпичей); fixed — не ставится и не убирается.
  const DEFS = {
    th: { n: 'Ратуша', e: '🏛️', w: 3, d: 3, lv: 5, fixed: 1, cost: [0, 500, 2000, 6000, 15000], time: [0, 300, 1800, 7200, 28800], max: [1, 1, 1, 1, 1], keep: [1000, 1500, 2500, 4000, 6000],
      info: 'Сердце участка: её уровень открывает новые постройки и уровни. Здесь же — подарок дня.' },
    house: { n: 'Дом', e: '🏠', w: 5, d: 5, lv: 5, fixed: 1, cost: [0, 300, 1200, 4000, 10000], time: [0, 120, 1200, 5400, 21600], max: [1, 1, 1, 1, 1], furn: [8, 14, 20, 28, 36],
      info: 'Заходи внутрь и расставляй мебель. Чем выше уровень, тем больше мебели.' },
    mine: { n: 'Шахта', e: '⛏️', w: 2, d: 2, lv: 5, cost: [100, 250, 800, 2500, 7000], time: [20, 120, 1200, 5400, 18000], max: [1, 2, 3, 3, 4], rate: [150, 250, 400, 600, 900], hold: [1200, 2000, 3200, 4800, 7200],
      info: 'Добывает кирпичи, даже когда тебя нет. Вмещает 8 часов добычи — заходи собирать!' },
    store: { n: 'Склад', e: '📦', w: 2, d: 2, lv: 5, cost: [150, 400, 1200, 3500, 9000], time: [20, 180, 1500, 5400, 18000], max: [1, 1, 2, 2, 3], keep: [1000, 2500, 5000, 8000, 12000],
      info: 'Больше места для кирпичей: дорогие улучшения без склада не накопить.' },
    shop: { n: 'Мастерская', e: '🛠️', w: 2, d: 2, lv: 1, cost: [1000], time: [600], max: [0, 1, 1, 1, 1], info: 'Второй строитель: две стройки сразу.' },
    tower: { n: 'Смотровая вышка', e: '🗼', w: 2, d: 2, lv: 3, cost: [600, 2000, 6000], time: [300, 3600, 14400], max: [0, 0, 1, 1, 2], info: 'Залезь по лестнице и смотри на район сверху. Уровень — выше.' },
    wall: { n: 'Забор', e: '🧱', w: 1, d: 1, lv: 5, cost: [10, 30, 80, 200, 500], time: [0, 0, 0, 0, 0], max: [20, 30, 40, 50, 60], info: 'Соседние куски соединяются сами. Улучшается сразу, без строителя.' },
    tree: { n: 'Дерево', e: '🌳', w: 1, d: 1, lv: 1, cost: [30], time: [0], g: 'deco' },
    pine: { n: 'Ёлка', e: '🌲', w: 1, d: 1, lv: 1, cost: [30], time: [0], g: 'deco' },
    bush: { n: 'Куст', e: '🌿', w: 1, d: 1, lv: 1, cost: [15], time: [0], g: 'deco' },
    flowers: { n: 'Клумба', e: '🌷', w: 1, d: 1, lv: 1, cost: [15], time: [0], g: 'deco' },
    rock: { n: 'Камень', e: '⛰️', w: 1, d: 1, lv: 1, cost: [10], time: [0], g: 'deco' },
    lamp: { n: 'Фонарь', e: '💡', w: 1, d: 1, lv: 1, cost: [40], time: [0], g: 'deco' },
    flag: { n: 'Флаг', e: '🚩', w: 1, d: 1, lv: 1, cost: [50], time: [0], g: 'deco' },
    bench: { n: 'Скамейка', e: '🪑', w: 2, d: 1, lv: 1, cost: [60], time: [0], g: 'deco', info: 'На неё можно сесть.' },
    fountain: { n: 'Фонтан', e: '⛲', w: 2, d: 2, lv: 1, cost: [300], time: [0], g: 'deco', th: 2 },
    statue: { n: 'Статуя Денчика', e: '🗿', w: 1, d: 1, lv: 1, cost: [0], time: [0], g: 'deco', th: 3, coins: 200, info: 'Золотая статуя — видно издалека.' },
  };
  // Мебель дома: клетки 0,8 ед. (комната 9×9); floor — ковёр (лежит под мебелью)
  const FURN = {
    bed: { n: 'Кровать', e: '🛏️', w: 2, d: 3, cost: 80, coins: 0 },
    sofa: { n: 'Диван', e: '🛋️', w: 3, d: 1, cost: 100, coins: 0, info: 'Можно сесть вдвоём.' },
    chair: { n: 'Стул', e: '🪑', w: 1, d: 1, cost: 20, coins: 0 },
    table: { n: 'Стол', e: '🍽️', w: 2, d: 2, cost: 50, coins: 0 },
    rug: { n: 'Ковёр', e: '🟪', w: 3, d: 3, cost: 40, coins: 0, floor: 1, info: 'Лежит на полу — мебель можно ставить сверху.' },
    lamp: { n: 'Торшер', e: '💡', w: 1, d: 1, cost: 30, coins: 0 },
    plant: { n: 'Цветок в горшке', e: '🌱', w: 1, d: 1, cost: 20, coins: 0 },
    shelf: { n: 'Книжная полка', e: '📚', w: 2, d: 1, cost: 60, coins: 0 },
    wardrobe: { n: 'Шкаф с зеркалом', e: '🪞', w: 2, d: 1, cost: 80, coins: 0, info: 'Подойди — и смени образ персонажа.' },
    tv: { n: 'Телевизор', e: '📺', w: 2, d: 1, cost: 0, coins: 60, info: 'Показывает, в эфире ли Денчик, и ведёт к роликам.' },
    fire: { n: 'Камин', e: '🔥', w: 2, d: 1, cost: 0, coins: 80 },
    aqua: { n: 'Аквариум', e: '🐠', w: 2, d: 1, cost: 0, coins: 100 },
    chess: { n: 'Шахматный столик', e: '♟️', w: 2, d: 3, cost: 0, coins: 120, info: 'Позови друга в гости: сядете — начнётся партия.' },
    arcade: { n: 'Игровой автомат', e: '🕹️', w: 1, d: 1, cost: 0, coins: 150, info: 'Все игры сайта — не выходя из дома.' },
  };

  // ═══ Каталог военной базы (war_defs() в bases.sql). Ключ 'th' — штаб (так его знает бой: ★ за штаб, уровень героя) ═══
  // Набеги (docs/RAIDS.md, бой — api/_lib/raid-sim.js): hp — прочность по уровням; atk — оборона: dmg — урон за выстрел по уровням,
  // cd — перезарядка (с), rng / min — дальность (клеток), sp — площадь, fly — полёт снаряда (с), gnd / air — по кому бьёт;
  // trap — ловушка: trig — срабатывает за (клеток), delay — взрыв через (с); army — место в казарме по уровню; crew — сколько людей
  // в составе (штаб); slots — сколько техники держит (гараж, площадка, ангар, причал). Украшения в бою не участвуют.
  const WDEFS = {
    th: { n: 'Штаб', e: '🏯', w: 3, d: 3, lv: 5, fixed: 1, cost: [0, 500, 2000, 6000, 15000], time: [0, 300, 1800, 7200, 28800], max: [1, 1, 1, 1, 1], keep: [1000, 1500, 2500, 4000, 6000],
      hp: [1700, 2000, 2350, 2650, 3050], crew: [6, 9, 12, 16, 20], info: 'Сердце базы: его уровень открывает постройки, уровни, место на участке (16 → 32 клеток) и состав. Здесь же — подарок дня.' },
    mine: { n: 'Карьер', e: '⛏️', w: 2, d: 2, lv: 5, cost: [100, 250, 800, 2500, 7000], time: [20, 120, 1200, 5400, 18000], max: [2, 3, 4, 5, 6], rate: [150, 250, 400, 600, 900], hold: [1200, 2000, 3200, 4800, 7200],
      hp: [420, 480, 550, 610, 680], info: 'Добывает кирпичи в казну, даже когда никого нет. Вмещает 8 часов — собирайте, пока не ограбили.' },
    factory: { n: 'Кирпичный завод', e: '🏭', w: 3, d: 3, lv: 4, th: 2, cost: [1500, 4000, 9000, 18000], time: [600, 3600, 14400, 28800], max: [0, 1, 1, 2, 2], rate: [500, 750, 1050, 1400], hold: [4000, 6000, 8400, 11200],
      hp: [900, 1050, 1200, 1400], info: 'Большое производство: печёт кирпичи втрое быстрее карьера. Вмещает 8 часов — собирайте вовремя.' },
    store: { n: 'Склад', e: '📦', w: 2, d: 2, lv: 5, cost: [150, 400, 1200, 3500, 9000], time: [20, 180, 1500, 5400, 18000], max: [1, 2, 3, 4, 5], keep: [1000, 2500, 5000, 8000, 12000],
      hp: [550, 620, 700, 790, 880], info: 'Больше места в казне: дорогие улучшения без склада не накопить. Часть кирпичей склад прячет от набегов.' },
    shop: { n: 'Мастерская', e: '🛠️', w: 2, d: 2, lv: 1, cost: [1000], time: [600], max: [0, 1, 1, 2, 2], hp: [650], info: 'Ещё один строитель: каждая мастерская — плюс стройка сразу.' },
    barracks: { n: 'Казарма', e: '⚔️', w: 2, d: 2, lv: 5, cost: [200, 600, 1800, 4500, 10000], time: [60, 600, 3600, 10800, 21600], max: [1, 1, 2, 2, 2], army: [20, 38, 70, 92, 120],
      hp: [550, 620, 700, 790, 880], info: 'Тренирует армию базы. Выше уровень — больше места и новые отряды. Вторая казарма (со штаба 3) — отряды учатся вдвое быстрее.' },
    tower: { n: 'Вышка', e: '🗼', w: 2, d: 2, lv: 5, cost: [400, 1200, 3000, 7000, 14000], time: [120, 1200, 5400, 14400, 28800], max: [1, 2, 3, 4, 5],
      hp: [520, 580, 650, 730, 800], atk: { dmg: [26, 31, 35, 42, 48], cd: .6, rng: 5.5, min: 0, sp: 0, fly: 0, gnd: 1, air: 1 },
      info: 'Лучники на вышке стреляют по наземным и летающим. Можно залезть по лестнице и смотреть на базу сверху.' },
    cannon: { n: 'Пушка', e: '💥', w: 2, d: 2, lv: 5, cost: [250, 700, 2000, 5000, 11000], time: [60, 600, 3600, 10800, 21600], max: [2, 3, 4, 5, 6],
      hp: [570, 650, 730, 810, 900], atk: { dmg: [44, 53, 62, 70, 79], cd: 1, rng: 4.5, min: 0, sp: 0, fly: 0, gnd: 1, air: 0 }, info: 'Бьёт наземные отряды — быстро и метко.' },
    mortar: { n: 'Мортира', e: '🎯', w: 2, d: 2, lv: 4, th: 2, cost: [800, 2500, 6000, 12000], time: [600, 3600, 10800, 28800], max: [0, 1, 2, 2, 3],
      hp: [680, 770, 860, 960], atk: { dmg: [46, 55, 64, 74], cd: 4, rng: 7, min: 2, sp: 1.2, fly: 1, gnd: 1, air: 0 }, info: 'Стреляет навесом по толпе. Вплотную не достаёт.' },
    bomb: { n: 'Бомба', e: '💣', w: 1, d: 1, lv: 3, cost: [100, 400, 1200], time: [0, 0, 0], max: [3, 5, 7, 9, 12],
      trap: { dmg: [100, 125, 155], trig: .6, sp: 1.5, delay: .5, gnd: 1, air: 0 }, info: 'Ловушка: взрывается под наземными отрядами. Чужим не видна.' },
    airmine: { n: 'Воздушная мина', e: '🎇', w: 1, d: 1, lv: 3, th: 3, cost: [300, 900, 2500], time: [0, 0, 0], max: [0, 0, 2, 3, 4],
      trap: { dmg: [250, 320, 390], trig: 1.5, sp: 0, delay: 0, gnd: 0, air: 1 }, info: 'Ловушка для летающих. Чужим не видна.' },
    wall: { n: 'Стена', e: '🧱', w: 1, d: 1, lv: 5, cost: [10, 30, 80, 200, 500], time: [0, 0, 0, 0, 0], max: [40, 70, 100, 130, 160], hp: [260, 550, 990, 1380, 1860],
      info: 'Соседние куски соединяются сами. Улучшается сразу, без строителя. В набеге держит удар.' },
    garage: { n: 'Гараж', e: '🚙', w: 3, d: 3, lv: 3, cost: [300, 1500, 5000], time: [60, 1200, 7200], max: [1, 1, 1, 2, 2], slots: [1, 2, 3],
      hp: [700, 850, 1000], info: 'Наземная техника базы: джип, с 3 уровня — танк. Подойди — и выезжай.' },
    helipad: { n: 'Вертолётная площадка', e: '🚁', w: 3, d: 3, lv: 2, th: 2, cost: [2000, 6000], time: [600, 7200], max: [0, 1, 1, 1, 1], slots: [1, 2],
      hp: [500, 650], info: 'Вертолёты базы взлетают прямо отсюда.' },
    hangar: { n: 'Ангар', e: '✈️', w: 4, d: 4, lv: 2, th: 3, cost: [5000, 12000], time: [3600, 14400], max: [0, 0, 1, 1, 1], slots: [1, 2],
      hp: [1200, 1500], info: 'Самолёты базы: ждут на своей стоянке аэродрома (на юге зоны).' },
    dock: { n: 'Причал', e: '⚓', w: 3, d: 3, lv: 2, th: 2, cost: [1500, 5000], time: [600, 7200], max: [0, 1, 1, 1, 1], slots: [1, 2],
      hp: [500, 650], info: 'Катера базы: у своего берега или на своём месте у причала порта.' },
    bunker: { n: 'Бункер', e: '🕳️', w: 2, d: 2, lv: 1, cost: [500], time: [300], max: [1, 1, 1, 1, 1], hp: [900], info: 'Люк в подвал базы: спустись — там штабной зал, карта и койки.' },
    flag: { n: 'Флаг базы', e: '🚩', w: 1, d: 1, lv: 1, cost: [50], time: [0], g: 'deco', info: 'Флаг цвета базы.' },
    lamp: { n: 'Прожектор', e: '💡', w: 1, d: 1, lv: 1, cost: [40], time: [0], g: 'deco' },
    rock: { n: 'Камень', e: '⛰️', w: 1, d: 1, lv: 1, cost: [10], time: [0], g: 'deco' },
    pine: { n: 'Ёлка', e: '🌲', w: 1, d: 1, lv: 1, cost: [30], time: [0], g: 'deco' },
    bush: { n: 'Куст', e: '🌿', w: 1, d: 1, lv: 1, cost: [15], time: [0], g: 'deco' },
    bags: { n: 'Мешки с песком', e: '🟫', w: 2, d: 1, lv: 1, cost: [40], time: [0], g: 'deco' },
    crates: { n: 'Ящики', e: '🗃️', w: 1, d: 1, lv: 1, cost: [30], time: [0], g: 'deco' },
  };
  // ═══ Набеги (docs/RAIDS.md): отряды казармы, герой (свой персонаж), правила набегов. Сервер — war_defs() (u, hero, raid) ═══
  // Отряд: sp — место в казарме, cost — 🧱, time — секунд тренировки, lv — с какого уровня казармы; бой: hp, dmg — урон за удар,
  // cd — перезарядка (с), rng — дальность (клеток), spd — клеток в секунду, tgt — цель (any — любая постройка, def — оборона,
  // wall — стены, heal — лечит своих), air — летает; splash — площадь удара; wdmg / boom — подрывник: урон стенам и радиус взрыва;
  // heal / hr — лечение в секунду и радиус
  const UNITS = {
    fighter: { n: 'Боец', e: '🗡️', sp: 1, cost: 5, time: 15, lv: 1, hp: 90, dmg: 10, cd: 1, rng: .6, spd: 1.6, tgt: 'any', info: 'Дешёвый и быстрый — берёт числом.' },
    archer: { n: 'Лучник', e: '🏹', sp: 1, cost: 8, time: 18, lv: 1, hp: 40, dmg: 9, cd: 1, rng: 3, spd: 1.6, tgt: 'any', info: 'Стреляет издалека — даже из-за стены.' },
    tank: { n: 'Силач', e: '💪', sp: 4, cost: 30, time: 60, lv: 2, hp: 650, dmg: 18, cd: 2, rng: .6, spd: 1, tgt: 'def', info: 'Идёт прямо к обороне и принимает удары на себя.' },
    breaker: { n: 'Подрывник', e: '🧨', sp: 2, cost: 20, time: 40, lv: 3, hp: 30, dmg: 40, wdmg: 300, boom: 1, cd: 1, rng: .5, spd: 2.4, tgt: 'wall', info: 'Бежит к ближайшей стене и взрывает её — и себя.' },
    flyer: { n: 'Летун', e: '🎈', sp: 3, cost: 40, time: 75, lv: 4, hp: 180, dmg: 60, cd: 2, rng: .4, spd: 1.2, splash: .6, tgt: 'def', air: 1, info: 'Летит над стенами прямо к обороне и сбрасывает бомбы.' },
    healer: { n: 'Лекарь', e: '💚', sp: 5, cost: 60, time: 120, lv: 5, hp: 300, heal: 30, hr: 2, cd: 1, rng: 1, spd: 1.4, tgt: 'heal', air: 1, info: 'Летает над своими и лечит наземных вокруг.' },
  };
  // Герой — твой персонаж из гардероба: один на бой, сила — по уровню штаба твоей базы; ab — «💥 Удар» (урон постройкам в радиусе abr)
  const HERO = { n: 'Герой', e: '🦸', hp: [420, 550, 680, 810, 940], dmg: [30, 40, 50, 60, 70], cd: 1, rng: .7, spd: 1.8, tgt: 'any', ab: [200, 280, 360, 440, 520], abr: 2 };
  // Правила набегов (raids.sql берёт их из war_defs()->'raid'). Время — секунды, кроме помеченного
  const RAID = {
    tps: 20, max: 180, scout: 30, go: 45, cancel: 60, grace: 240,   // шагов в секунду; бой; разведка; начать не позже; отмена; сдать итог после боя
    // добыча: % склада (минус step за уровень штаба нападающих выше, не меньше min), % производства, доля штаба (%), защищено штабом и
    // складом, не больше за набег (cap — склад и производство вместе, штаб защитников), за день взять (day — штаб нападающих) и потерять
    // (lose — штаб защитников), с одной базы — раз в pair часов
    loot: { pct: 20, step: 6, min: 5, mine: 35, th: 40, prot: [400, 600, 900, 1300, 1800], sprot: [150, 300, 500, 800, 1200],
      cap: [800, 1600, 3000, 5000, 8000], day: [3000, 6000, 10000, 16000, 24000], lose: [1600, 3200, 6000, 10000, 16000], pair: 20 },
    tr: { win: 20, wdiv: 10, wmin: 6, wmax: 36, lose: 14, ldiv: 12, lmin: 4, lmax: 28 },   // кубки: победа × звёзды/3, поражение
    shield: { s2: 8, s3: 12, guard: 30, newbie: 3 },   // часы после 2★ / 3★; минуты стражи; дни новой базы
    day: { battles: 20, search: 100, bots: 3 },       // в день: боёв и поисков (у человека), набегов на разбойников с добычей (у базы)
    next: [10, 25, 50, 80, 120],                      // «Следующий» по штабу, 🧱
    league: [0, 100, 400, 800, 1300, 1900, 2600], bonus: [0, 20, 40, 70, 110, 160, 220], chest: [100, 200, 400, 700, 1000, 1500, 2000], chestWins: 3,
    bot: [120, 250, 450, 700, 1000],                  // разбойники под штаб: 🧱 за 3★
    camp: [150, 200, 300, 400, 500, 650, 800, 1000, 1200, 1500, 1800, 2200], campTh: [1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5],   // поход: 🧱 за 3★, штаб лагеря
    tut: 300, tutArmy: { fighter: 12, archer: 8 },
    // за 💎 (g) и монеты (c) — только время и красота (красная линия: сила за деньги — никогда): щит на h часов (не чаще раза в shWeek
    // дней на базу, всего ≤ shMax ч), 1 💎 за fin секунд стройки/тренировки, облики. Вторая казарма — постройка со штаба 3 (не покупка)
    shop: { sh1: { g: 30, h: 24 }, sh2: { g: 50, h: 48 }, shWeek: 7, shMax: 72, fin: 1200,
      skin: { winter: { g: 100 }, gold: { g: 100 }, neon: { g: 100 }, autumn: { c: 800 } }, army: { knight: { g: 80 }, robot: { g: 80 } } },
  };
  const LEAGUES = [['Новичок', '🪵'], ['Бронза', '🥉'], ['Серебро', '🥈'], ['Золото', '🥇'], ['Кристалл', '💠'], ['Мастер', '🏅'], ['Чемпион', '👑']];
  const league = tr => { let i = 0; while (i + 1 < RAID.league.length && (tr | 0) >= RAID.league[i + 1]) i++; return i; };
  // Облики базы: цвет построек смешивается с mix на долю k (и в 3D-мире, и в бою); видно всем
  const SKINS = {
    winter: { n: 'Зимний', e: '❄️', mix: [.92, .97, 1], k: .38 },
    gold: { n: 'Золотой', e: '✨', mix: [1, .78, .26], k: .42 },
    neon: { n: 'Неон', e: '💜', mix: [.62, .3, 1], k: .4 },
    autumn: { n: 'Осенний', e: '🍂', mix: [.9, .48, .16], k: .34 },
  };
  // Техника базы (js/engine/vehicle*.js — те же машины, что в зоне): b — где стоит, lv — с какого уровня той постройки, cost — 🧱 из казны.
  // Купленная техника — базы; выезжает любой из состава (одна машина на человека за раз)
  const VEH = {
    jeep: { b: 'garage', lv: 1, cost: 400 },
    tank: { b: 'garage', lv: 3, cost: 6000 },
    heli: { b: 'helipad', lv: 1, cost: 3000 },
    plane: { b: 'hangar', lv: 1, cost: 8000 },
    motorboat: { b: 'dock', lv: 1, cost: 600 },
    patrol: { b: 'dock', lv: 2, cost: 3500 },
  };
  // Имя базы — готовое + номер 1…99 (детская аудитория: своего текста нет); цвет — из палитры (флаг, карта, табличка)
  const NAMES = ['Стальные волки', 'Небесные ястребы', 'Морские котики', 'Громовые медведи', 'Ночные совы', 'Огненные лисы', 'Железные барсы', 'Ледяные драконы',
    'Песчаные скорпионы', 'Лесные рыси', 'Горные орлы', 'Бравые еноты', 'Шустрые белки', 'Смелые пингвины', 'Рыжие тигры', 'Синие киты'];
  const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];
  const RANKS = { leader: { n: 'Главарь', e: '👑' }, officer: { n: 'Офицер', e: '⭐' }, soldier: { n: 'Боец', e: '🪖' } };
  const baseName = (k, n) => `${NAMES[k] || NAMES[0]} ${Math.max(1, n | 0)}`;

  const N = 12, IN = 9, PER = 6, PLOTS = 600, START = 600, DECO_MAX = [6, 10, 15, 20, 25], DOOR = [3, 6, 7, 9];   // DOOR: x0, x1, z0, z1 — проход от двери (клетки комнаты)
  // Военная база: n — клеток участка, ring — открытая часть по уровню штаба (квадрат в середине), per — участков в секторе, plots —
  // номеров всего, start — кирпичей в казне на старт, deco — лимит украшений по штабу, give — сколько кирпичей человек может отдать
  // из своего участка района в казну за день, block — занятые клетки [x, z, w, d] (командный пункт зоны у въезда и проезд к воротам;
  // клетки — в системе участка: ворота — снизу, +z; проверяет base-test по MirWar.PLOTS)
  const WAR = { n: 32, ring: [16, 20, 24, 28, 32], per: 12, plots: 1200, start: 1000, deco: [10, 16, 24, 32, 40], give: 1000, block: [[6, 26, 5, 5], [14, 28, 4, 4]] };
  const pickKeys = (o, keys) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.fromEntries(keys.filter(f => v[f] != null).map(f => [f, v[f]]))]));
  const SERVER = { n: N, in: IN, per: PER, plots: PLOTS, start: START, deco: DECO_MAX, door: DOOR,
    k: pickKeys(DEFS, ['w', 'd', 'lv', 'fixed', 'cost', 'time', 'max', 'keep', 'furn', 'rate', 'hold', 'g', 'th', 'coins']),
    f: pickKeys(FURN, ['w', 'd', 'cost', 'coins', 'floor']) };
  const WSERVER = { n: WAR.n, ring: WAR.ring, per: WAR.per, plots: WAR.plots, start: WAR.start, deco: WAR.deco, give: WAR.give, block: WAR.block, names: NAMES.length, colors: COLORS.length,
    k: pickKeys(WDEFS, ['w', 'd', 'lv', 'fixed', 'cost', 'time', 'max', 'keep', 'rate', 'hold', 'g', 'th', 'coins', 'hp', 'atk', 'trap', 'army', 'crew', 'slots']),
    u: pickKeys(UNITS, ['sp', 'cost', 'time', 'lv', 'hp', 'dmg', 'cd', 'rng', 'spd', 'tgt', 'air', 'splash', 'wdmg', 'boom', 'heal', 'hr']),
    hero: Object.fromEntries(Object.entries(HERO).filter(([k]) => k !== 'n' && k !== 'e')), raid: RAID, veh: VEH };

  // ═══ Правила (без Three.js и DOM; один в один с base_act / war_act в bases.sql). Один код на оба каталога: район (war = false)
  //     и военная база (war = true: открытая часть по штабу, занятые клетки, производство — всё с rate, казарма и армия, техника) ═══
  function makeRules(C){
    const { D, war } = C, NN = C.n;
    const fp = (k, r) => { const d = D[k]; return !d ? [1, 1] : r & 1 ? [d.d, d.w] : [d.w, d.d]; };
    const ffp = (k, r) => { const d = FURN[k]; return !d ? [1, 1] : r & 1 ? [d.d, d.w] : [d.w, d.d]; };
    const th = s => { const t = s.layout.find(it => it.k === 'th'); return t ? Math.max(1, t.l) : 1; };
    const houseLv = s => { const h = s.layout.find(it => it.k === 'house'); return h ? Math.max(1, h.l) : 1; };
    const cap = s => s.layout.reduce((c, it) => c + (it.k === 'store' && it.l >= 1 ? D.store.keep[it.l - 1] : 0), D.th.keep[th(s) - 1]);
    // строители: район — 1 + мастерская (одна); база — 1 + каждая готовая мастерская
    const builders = s => 1 + (war ? s.layout.filter(it => it.k === 'shop' && it.l >= 1).length : (s.layout.some(it => it.k === 'shop' && it.l >= 1) ? 1 : 0));
    // открытая часть участка: [o, o + S) по x и z (район — весь участок)
    const ringOf = t => (war ? C.ring[Math.max(1, Math.min(C.ring.length, t | 0)) - 1] : NN);
    const boxOf = (s, t) => { const S = ringOf(t == null ? th(s) : t), o = (NN - S) >> 1; return [o, o + S]; };
    const isProd = k => !!D[k]?.rate;   // производство: шахта (район); карьер и завод (база)
    const busy = (s, now) => s.layout.filter(it => it.ue != null && (now == null || it.ue > now)).length;
    const day = now => new Date((now + 10800) * 1000).toISOString().slice(0, 10);   // день по Москве
    const isDeco = k => D[k]?.g === 'deco';
    const limit = (k, t) => isDeco(k) ? C.deco[t - 1] : D[k].max[t - 1];
    const count = (L, k) => L.filter(it => (k === 'deco' ? isDeco(it.k) : it.k === k)).length;
    // Достроилось — новый уровень (производство копит с момента окончания); дотренировались — в армию
    function norm(s, now){
      for (const it of s.layout) if (it.ue != null && it.ue <= now) { it.l = it.ul; if (isProd(it.k)) it.t0 = it.ue; delete it.ul; delete it.ue; }
      if (war) qnorm(s, now);
      return s;
    }
    // ── Армия (только база): army — в казарме {отряд: штук}, out — ушли в набег (вернутся, кто не высажен), queue — очередь [{u, ue, t}]:
    //    одна цепочка, ue растут — готовые сначала. Две готовые казармы — учат вдвое быстрее
    function qnorm(s, now){
      if (!s.army) s.army = {}; if (!s.out) s.out = {}; if (!Array.isArray(s.queue)) s.queue = [];
      let k = 0;
      while (k < s.queue.length && s.queue[k].ue <= now) { const u = s.queue[k].u; s.army[u] = (s.army[u] || 0) + 1; k++; }
      if (k) s.queue.splice(0, k);
    }
    const barracksLv = s => s.layout.reduce((m, it) => (it.k === 'barracks' && it.l >= 1 ? Math.max(m, it.l) : m), 0);
    const barracksN = s => s.layout.filter(it => it.k === 'barracks' && it.l >= 1).length;
    const armyCap = s => { const b = barracksLv(s); return b && D.barracks ? D.barracks.army[b - 1] : 0; };
    const spaceOf = o => Object.entries(o || {}).reduce((a, [u, n]) => a + (UNITS[u] ? UNITS[u].sp * n : 0), 0);
    const armySpace = s => spaceOf(s.army) + spaceOf(s.out) + (s.queue || []).reduce((a, q) => a + (UNITS[q.u]?.sp || 0), 0);
    const trainT = (s, U) => (barracksN(s) >= 2 ? Math.ceil(U.time / 2) : U.time);
    // ── Техника (только база): сколько мест у постройки вида b (готовые, по уровню) и сколько занято
    const slotsOf = (s, b) => s.layout.reduce((a, it) => a + (it.k === b && it.l >= 1 && D[b]?.slots ? D[b].slots[Math.min(it.l, D[b].slots.length) - 1] : 0), 0);
    const bestLv = (s, b) => s.layout.reduce((m, it) => (it.k === b && it.l >= 1 ? Math.max(m, it.l) : m), 0);
    const vehIn = (s, b) => Object.entries(s.veh || {}).reduce((a, [v, n]) => a + (VEH[v]?.b === b ? n : 0), 0);
    // Сколько кирпичей в производстве сейчас (на стройке и при улучшении — не копит)
    function prod(it, now){
      if (!isProd(it.k) || !(it.l >= 1) || it.ue != null) return 0;
      const P = D[it.k];
      return Math.min(P.hold[it.l - 1], Math.floor(P.rate[it.l - 1] * Math.max(0, now - (it.t0 ?? now)) / 3600));
    }
    // Помещается ли прямоугольник (клетки) в открытую часть, не задевая других (skip — сама передвигаемая) и занятых клеток
    function fits(L, x, z, w, d, skip = 0, box){
      const [lo, hi] = box || (war ? boxOf({ layout: L }) : [0, NN]);
      if (x < lo || z < lo || x + w > hi || z + d > hi) return false;
      if (war) for (const [bx, bz, bw, bd] of C.block) if (x < bx + bw && bx < x + w && z < bz + bd && bz < z + d) return false;
      for (const it of L) {
        if (it.i === skip) continue;
        const [iw, id] = fp(it.k, it.r);
        if (x < it.x + iw && it.x < x + w && z < it.z + id && it.z < z + d) return false;
      }
      return true;
    }
    // Мебель: в комнате, не на проходе от двери (кроме ковра), ковры — только с коврами, остальное — с остальным
    function ffits(room, k, x, z, w, d, skip = 0){
      if (x < 0 || z < 0 || x + w > IN || z + d > IN) return false;
      const fl = !!FURN[k]?.floor;
      if (!fl && x < DOOR[1] && DOOR[0] < x + w && z < DOOR[3] && DOOR[2] < z + d) return false;
      for (const it of room) {
        if (it.i === skip || !!FURN[it.k]?.floor !== fl) continue;
        const [iw, id] = ffp(it.k, it.r);
        if (x < it.x + iw && it.x < x + w && z < it.z + id && it.z < z + d) return false;
      }
      return true;
    }
    // Собрать из производства (id — одно, null — всё) на склад, сколько влезет; остаток остаётся там
    function collect(s, id, now){
      let space = Math.max(0, cap(s) - s.bricks), got = 0;
      for (const it of s.layout) {
        if (!isProd(it.k) || (id != null && it.i !== id)) continue;
        const amt = prod(it, now);
        if (amt <= 0) continue;
        const take = Math.min(amt, space), rate = D[it.k].rate[it.l - 1], rem = amt - take;
        space -= take; got += take;
        it.t0 = now - Math.floor((rem * 3600 + rate - 1) / rate);
      }
      s.bricks += got;
      return got;
    }
    const prodSum = (s, id, now) => s.layout.reduce((a, it) => a + (isProd(it.k) && (id == null || it.i === id) ? prod(it, now) : 0), 0);
    const speedCost = (it, now) => Math.max(1, Math.ceil(Math.max(0, it.ue - now) / 120));
    // Новый участок района / новая база (штаб в середине открытой части, карьер рядом)
    const fresh = war
      ? (plot, now) => ({ plot, bricks: C.start, seq: 2, own: {}, gift: '', army: {}, out: {}, queue: [], veh: {},
          layout: [{ i: 1, k: 'th', x: 14, z: 14, r: 0, l: 1 }, { i: 2, k: 'mine', x: 10, z: 15, r: 0, l: 1, t0: now }] })
      : (plot, now) => ({ plot, bricks: START, seq: 5, access: 'all', likes: 0, gift: '', own: { 'f:bed': 1, 'f:rug': 1 },
          layout: [{ i: 1, k: 'th', x: 5, z: 2, r: 0, l: 1 }, { i: 2, k: 'house', x: 0, z: 6, r: 0, l: 1 }, { i: 3, k: 'mine', x: 9, z: 7, r: 0, l: 1, t0: now }],
          room: [{ i: 4, k: 'bed', x: 0, z: 0, r: 0 }, { i: 5, k: 'rug', x: 3, z: 3, r: 0 }] });
    // Ход: мутирует s; { ok, got? , coins? } или { ok: false, reason } (тогда s не тронут, кроме norm).
    // wallet — монеты (как coin_wallet на сервере); без него всё за монеты — 'coins'. donor — участок района жертвующего (give)
    function act(s, a, g, now, wallet, donor){
      g = g || {};
      norm(s, now);
      const fail = reason => ({ ok: false, reason });
      const int = (v, mx) => (Number.isInteger(v) && v >= 0 && v <= mx ? v : null);
      const str = v => (v == null ? null : String(v));
      const t = th(s);
      const payCoins = n => { if (!wallet || wallet.coins < n) return false; return true; };
      switch (a) {
        case 'place': {
          const k = str(g.k), x = int(g.x, NN - 1), z = int(g.z, NN - 1), r = int(g.r, 3);
          if (k == null || x == null || z == null || r == null) return fail('args');
          const D0 = D[k];
          if (!D0 || D0.fixed) return fail('kind');
          if ((D0.th || 1) > t) return fail('th');
          const lim = limit(k, t);
          if (lim <= 0) return fail('th');
          if (count(s.layout, D0.g === 'deco' ? 'deco' : k) >= lim) return fail('max');
          const [w, d] = fp(k, r);
          if (!fits(s.layout, x, z, w, d)) return fail('place');
          const tm = D0.time[0], coins = D0.coins || 0, cost = D0.cost[0];
          const inv = D0.g === 'deco' && (s.own[k] || 0) > count(s.layout, k);
          if (!inv) { if (coins > 0) { if (!payCoins(coins)) return fail('coins'); } else if (s.bricks < cost) return fail('bricks'); }
          if (tm > 0 && busy(s) >= builders(s)) return fail('builder');
          let spent = 0;
          if (!inv) {
            if (coins > 0) { wallet.coins -= coins; spent = coins; } else s.bricks -= cost;
            if (D0.g === 'deco') s.own[k] = (s.own[k] || 0) + 1;
          }
          const it = { i: ++s.seq, k, x, z, r, l: tm > 0 ? 0 : 1 };
          if (tm > 0) { it.ul = 1; it.ue = now + tm; } else if (isProd(k)) it.t0 = now;
          s.layout.push(it);
          return { ok: true, id: it.i, coins: spent };
        }
        case 'move': {
          const id = int(g.id, 1e6), x = int(g.x, NN - 1), z = int(g.z, NN - 1), r = int(g.r, 3);
          if (id == null || x == null || z == null || r == null) return fail('args');
          const it = s.layout.find(e => e.i === id);
          if (!it) return fail('id');
          const [w, d] = fp(it.k, r);
          if (!fits(s.layout, x, z, w, d, id)) return fail('place');
          it.x = x; it.z = z; it.r = r;
          return { ok: true };
        }
        case 'remove': {
          const id = int(g.id, 1e6);
          if (id == null) return fail('args');
          const i = s.layout.findIndex(e => e.i === id);
          if (i < 0) return fail('id');
          if (!isDeco(s.layout[i].k)) return fail('fixed');
          s.layout.splice(i, 1);
          return { ok: true };
        }
        case 'upgrade': {
          const id = int(g.id, 1e6);
          if (id == null) return fail('args');
          const it = s.layout.find(e => e.i === id);
          if (!it) return fail('id');
          const D0 = D[it.k];
          if (it.ue != null) return fail('busy');
          const nl = it.l + 1;
          if (nl > D0.lv) return fail('maxlv');
          if (it.k !== 'th' && nl > t) return fail('lvcap');
          const cost = D0.cost[nl - 1], tm = D0.time[nl - 1];
          if (s.bricks < cost) return fail('bricks');
          if (tm > 0 && busy(s) >= builders(s)) return fail('builder');
          if (isProd(it.k) && tm > 0) collect(s, it.i, now);
          s.bricks -= cost;
          if (tm > 0) { it.ul = nl; it.ue = now + tm; } else it.l = nl;
          return { ok: true };
        }
        case 'collect': {
          const id = g.id == null ? null : int(g.id, 1e6);
          if (g.id != null && id == null) return fail('args');
          if (prodSum(s, id, now) <= 0) return fail('empty');
          if (cap(s) - s.bricks <= 0) return fail('full');
          return { ok: true, got: collect(s, id, now) };
        }
        case 'finish': {
          const id = int(g.id, 1e6);
          if (id == null) return fail('args');
          const it = s.layout.find(e => e.i === id);
          if (!it) return fail('id');
          if (it.ue == null) return fail('idle');
          const n = speedCost(it, now);
          if (!payCoins(n)) return fail('coins');
          wallet.coins -= n;
          it.l = it.ul; delete it.ul; delete it.ue;
          if (isProd(it.k)) it.t0 = now;
          return { ok: true, coins: n };
        }
        case 'gift': {
          if (s.gift === day(now)) return fail('done');
          const add = Math.min(50 + 50 * t, Math.max(0, cap(s) - s.bricks));
          if (add <= 0) return fail('full');
          s.bricks += add; s.gift = day(now);
          return { ok: true, got: add };
        }
        case 'access': {
          if (war) return fail('args');
          if (!['all', 'friends', 'nobody'].includes(g.a)) return fail('args');
          s.access = g.a;
          return { ok: true };
        }
        case 'fplace': {
          if (war) return fail('args');
          const k = str(g.k), x = int(g.x, IN - 1), z = int(g.z, IN - 1), r = int(g.r, 3);
          if (k == null || x == null || z == null || r == null) return fail('args');
          const F = FURN[k];
          if (!F) return fail('kind');
          if (s.room.length >= D.house.furn[houseLv(s) - 1]) return fail('house');
          const [w, d] = ffp(k, r);
          if (!ffits(s.room, k, x, z, w, d)) return fail('place');
          const key = 'f:' + k, inv = (s.own[key] || 0) > s.room.filter(e => e.k === k).length;
          let spent = 0;
          if (!inv) {
            if (F.coins > 0) { if (!payCoins(F.coins)) return fail('coins'); } else if (s.bricks < F.cost) return fail('bricks');
            if (F.coins > 0) { wallet.coins -= F.coins; spent = F.coins; } else s.bricks -= F.cost;
            s.own[key] = (s.own[key] || 0) + 1;
          }
          const it = { i: ++s.seq, k, x, z, r };
          s.room.push(it);
          return { ok: true, id: it.i, coins: spent };
        }
        case 'fmove': {
          if (war) return fail('args');
          const id = int(g.id, 1e6), x = int(g.x, IN - 1), z = int(g.z, IN - 1), r = int(g.r, 3);
          if (id == null || x == null || z == null || r == null) return fail('args');
          const it = s.room.find(e => e.i === id);
          if (!it) return fail('id');
          const [w, d] = ffp(it.k, r);
          if (!ffits(s.room, it.k, x, z, w, d, id)) return fail('place');
          it.x = x; it.z = z; it.r = r;
          return { ok: true };
        }
        case 'fremove': {
          if (war) return fail('args');
          const id = int(g.id, 1e6);
          if (id == null) return fail('args');
          const i = s.room.findIndex(e => e.i === id);
          if (i < 0) return fail('id');
          s.room.splice(i, 1);
          return { ok: true };
        }
      }
      if (!war) return fail('args');
      switch (a) {
        // ── Казарма: тренировать n отрядов (🧱 из казны сразу, готовы по очереди), убрать последнего такого из очереди (🧱 назад),
        //    дотренировать всех сразу за монеты, распустить из армии ──
        case 'train': {
          const u = str(g.u), n = g.n == null ? 1 : int(g.n, 30);
          if (u == null || n == null || n < 1) return fail('args');
          const U = UNITS[u];
          if (!U) return fail('kind');
          const bl = barracksLv(s);
          if (!bl) return fail('barracks');
          if (U.lv > bl) return fail('ulock');
          if (armySpace(s) + n * U.sp > armyCap(s)) return fail('space');
          if (s.bricks < n * U.cost) return fail('bricks');
          s.bricks -= n * U.cost;
          const t1 = trainT(s, U);
          let last = s.queue.length ? s.queue[s.queue.length - 1].ue : now;
          for (let i = 0; i < n; i++) { last = Math.max(last, now) + t1; s.queue.push({ u, ue: last, t: t1 }); }
          return { ok: true };
        }
        case 'untrain': {
          const u = g.u == null ? null : str(g.u);
          if (u != null && !UNITS[u]) return fail('args');
          let j = -1;
          for (let i = s.queue.length - 1; i >= 0; i--) if (u == null || s.queue[i].u === u) { j = i; break; }
          if (j < 0) return fail('noq');
          const q = s.queue.splice(j, 1)[0];
          s.bricks = Math.max(s.bricks, Math.min(cap(s), s.bricks + UNITS[q.u].cost));
          let prev = j > 0 ? s.queue[j - 1].ue : now;   // следующие — раньше
          for (let i = j; i < s.queue.length; i++) { prev = Math.max(prev, now) + s.queue[i].t; s.queue[i].ue = prev; }
          return { ok: true };
        }
        case 'tfinish': {
          if (!s.queue.length) return fail('noq');
          const n = speedCost(s.queue[s.queue.length - 1], now);
          if (!payCoins(n)) return fail('coins');
          wallet.coins -= n;
          for (const q of s.queue) s.army[q.u] = (s.army[q.u] || 0) + 1;
          s.queue = [];
          return { ok: true, coins: n };
        }
        case 'unarm': {
          const u = str(g.u), n = g.n == null ? 1 : int(g.n, 100);
          if (u == null || !UNITS[u] || n == null || n < 1) return fail('args');
          if ((s.army[u] || 0) < n) return fail('noarmy');
          s.army[u] -= n;
          if (!s.army[u]) delete s.army[u];
          return { ok: true };
        }
        // ── Техника: купить в свою постройку (🧱 из казны) / списать (место освобождается, кирпичи не возвращаются) ──
        case 'vbuy': {
          const v = str(g.v), V = VEH[v];
          if (!V) return fail('args');
          if (bestLv(s, V.b) < V.lv) return fail('vlock');
          if (vehIn(s, V.b) >= slotsOf(s, V.b)) return fail('vfull');
          if (s.bricks < V.cost) return fail('bricks');
          s.bricks -= V.cost;
          if (!s.veh) s.veh = {};
          s.veh[v] = (s.veh[v] || 0) + 1;
          return { ok: true };
        }
        case 'vsell': {
          const v = str(g.v);
          if (!VEH[v]) return fail('args');
          if (!(s.veh?.[v] > 0)) return fail('noveh');
          s.veh[v]--; if (!s.veh[v]) delete s.veh[v];
          return { ok: true };
        }
        // ── Пожертвовать кирпичи из своего участка района в казну: n, не больше места в казне и дневного лимита (donor: { bricks, left }) ──
        case 'give': {
          const n = int(g.n, 1e6);
          if (n == null || n < 1) return fail('args');
          if (!donor) return fail('nodonor');
          if (n > (donor.left ?? C.give)) return fail('givemax');
          if (donor.bricks < n) return fail('bricks');
          if (cap(s) - s.bricks < n) return fail('full');
          donor.bricks -= n; donor.left = (donor.left ?? C.give) - n;
          s.bricks += n;
          return { ok: true, got: n };
        }
      }
      return fail('args');
    }
    // Можно ли поставить (для «призрака» и карточек каталога) — те же проверки без изменения
    function canPlace(s, k, x, z, r, now, wallet){
      const c = clone(s);
      return act(c, 'place', { k, x, z, r }, now, wallet ? { coins: wallet.coins } : undefined);
    }
    // Состояние из localStorage / сервера → проверенное (мусор отбрасывается)
    function sanitize(o){
      if (!o || typeof o !== 'object' || !Array.isArray(o.layout)) return null;
      const L = o.layout.filter(it => it && D[it.k] && Number.isInteger(it.i) && Number.isInteger(it.x) && Number.isInteger(it.z) && Number.isInteger(it.l)).map(it => {
        const e = { i: it.i, k: it.k, x: it.x, z: it.z, r: (it.r | 0) & 3, l: Math.max(0, Math.min(D[it.k].lv, it.l)) };
        if (Number.isFinite(it.ue) && Number.isInteger(it.ul)) { e.ul = it.ul; e.ue = it.ue; }
        if (Number.isFinite(it.t0)) e.t0 = it.t0;
        return e;
      });
      if (!L.some(it => it.k === 'th') || (!war && !L.some(it => it.k === 'house'))) return null;
      const own = {};
      if (o.own && typeof o.own === 'object') for (const [k, v] of Object.entries(o.own)) if ((D[k] || (!war && FURN[k.slice(2)])) && Number.isInteger(v) && v > 0) own[k] = v;
      if (war) {
        let qe = 0;
        const queue = (Array.isArray(o.queue) ? o.queue : []).filter(q => q && UNITS[q.u] && Number.isFinite(q.ue) && Number.isInteger(q.t) && q.t > 0 && q.ue >= qe && (qe = q.ue, true)).slice(0, 200).map(q => ({ u: q.u, ue: q.ue, t: q.t }));
        const veh = {}; if (o.veh && typeof o.veh === 'object') for (const [v, n] of Object.entries(o.veh)) if (VEH[v] && Number.isInteger(n) && n > 0) veh[v] = Math.min(n, 9);
        const seq = Math.max(Number.isInteger(o.seq) ? o.seq : 0, ...L.map(it => it.i), 0);
        return { plot: Number.isInteger(o.plot) ? o.plot : 0, bricks: Math.max(0, o.bricks | 0), seq, gift: typeof o.gift === 'string' ? o.gift : '', own, layout: L, rev: o.rev | 0,
          army: sanitizeArmy(o.army), out: sanitizeArmy(o.out), queue, veh };
      }
      const room = sanitizeRoom(o.room);
      const seq = Math.max(Number.isInteger(o.seq) ? o.seq : 0, ...L.map(it => it.i), ...room.map(it => it.i), 0);
      return { plot: Number.isInteger(o.plot) ? o.plot : 0, bricks: Math.max(0, o.bricks | 0), seq, access: ['all', 'friends', 'nobody'].includes(o.access) ? o.access : 'all',
        likes: o.likes | 0, gift: typeof o.gift === 'string' ? o.gift : '', own, layout: L, room, rev: o.rev | 0 };
    }
    const sanitizeArmy = a => { const o = {}; if (a && typeof a === 'object') for (const [u, n] of Object.entries(a)) if (UNITS[u] && Number.isInteger(n) && n > 0) o[u] = Math.min(n, 999); return o; };
    const sanitizeRoom = items => (Array.isArray(items) ? items : []).filter(it => it && FURN[it.k] && Number.isInteger(it.i) && Number.isInteger(it.x) && Number.isInteger(it.z)).map(it => ({ i: it.i, k: it.k, x: it.x, z: it.z, r: (it.r | 0) & 3 }));
    const clone = s => JSON.parse(JSON.stringify(s));
    return { war, D, n: NN, fp, ffp, th, houseLv, cap, builders, ringOf, boxOf, isProd, busy, day, isDeco, limit, count, norm, qnorm, prod, prodSum, fits, ffits, collect, speedCost, fresh, act, canPlace,
      sanitize, sanitizeArmy, sanitizeRoom, clone, barracksLv, barracksN, armyCap, armySpace, spaceOf, trainT, slotsOf, bestLv, vehIn };
  }
  const Rules = makeRules({ D: DEFS, war: false, n: N, deco: DECO_MAX });
  const WRules = makeRules({ D: WDEFS, war: true, n: WAR.n, ring: WAR.ring, block: WAR.block, deco: WAR.deco, start: WAR.start, give: WAR.give });

  // ═══ Район на карте мира (единицы движка): северо-запад от площади, за кафе ═══
  const CELL = 1.6, LOT = CELL * N, HALF = LOT / 2, ICELL = .8, IHALF = IN * ICELL / 2;
  // Участки: центр и поворот (перед участка — к улице). 0–2 — южный ряд (от входа на запад), 3–5 — северный
  const LOTS = [
    { x: -24.6, z: -28.4, yaw: PI }, { x: -46.8, z: -28.4, yaw: PI }, { x: -69, z: -28.4, yaw: PI },
    { x: -24.6, z: -53.6, yaw: 0 }, { x: -46.8, z: -53.6, yaw: 0 }, { x: -69, z: -53.6, yaw: 0 },
  ];
  const LANE = { x0: -80, x1: -11, z: -41, w: 6 };
  const ZONE = { x0: -81, x1: -10, z0: -66, z1: -12 };   // деревья и трава сюда не растут
  const zone = (x, z) => x > ZONE.x0 && x < ZONE.x1 && z > ZONE.z0 && z < ZONE.z1;
  const inDistrict = (x, z) => x > -80 && x < -14.5 && z > -64 && z < -18;
  const streetOf = plot => Math.floor((plot - 1) / PER);
  const lotOf = plot => (plot - 1) % PER;
  // система участка ↔ мир; система постройки (поворот r по 90°) → участок
  const lotToWorld = (lot, lx, lz) => { const c = Math.cos(lot.yaw), s = Math.sin(lot.yaw); return [lot.x + lx * c + lz * s, lot.z - lx * s + lz * c]; };
  const worldToLot = (lot, wx, wz) => { const c = Math.cos(lot.yaw), s = Math.sin(lot.yaw), dx = wx - lot.x, dz = wz - lot.z; return [dx * c - dz * s, dx * s + dz * c]; };
  const rotXZ = (r, bx, bz) => { const a = r * PI / 2, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a)); return [bx * c + bz * s, -bx * s + bz * c]; };
  const itemCenter = it => { const [w, d] = Rules.fp(it.k, it.r); return [-HALF + (it.x + w / 2) * CELL, -HALF + (it.z + d / 2) * CELL]; };
  const furnCenter = it => { const [w, d] = Rules.ffp(it.k, it.r); return [-IHALF + (it.x + w / 2) * ICELL, -IHALF + (it.z + d / 2) * ICELL]; };
  // Клетка под точкой участка: верхний левый угол постройки w×d, если точка — её середина
  const cellAt = (lx, lz, w = 1, d = 1) => [Math.round((lx + HALF) / CELL - w / 2), Math.round((lz + HALF) / CELL - d / 2)];
  const icellAt = (hx, hz, w = 1, d = 1) => [Math.round((hx + IHALF) / ICELL - w / 2), Math.round((hz + IHALF) / ICELL - d / 2)];
  const Geo = { CELL, LOT, HALF, ICELL, IHALF, LOTS, LANE, ZONE, zone, inDistrict, streetOf, lotOf, lotToWorld, worldToLot, rotXZ, itemCenter, furnCenter, cellAt, icellAt };

  const WHY = {
    auth: 'Войди, чтобы строить на своём участке', none: 'Сначала займи участок', kind: 'Это здесь не построить', th: 'Нужна ратуша выше уровнем',
    max: 'Больше нельзя — улучши ратушу', place: 'Сюда не встанет: место занято или край', bricks: 'Не хватает кирпичей 🧱', builder: 'Все строители заняты 👷',
    busy: 'Уже строится', maxlv: 'Это самый высокий уровень', lvcap: 'Сначала улучши ратушу', id: 'Постройка не найдена', fixed: 'Это нельзя убрать — только переместить',
    coins: 'Не хватает монет 🪙', access: 'Хозяин закрыл дом', too_fast: 'Не так быстро 🙂', done: 'Сегодня уже забрал — приходи завтра', self: 'Это твой участок 🙂',
    plot: 'Такого участка нет', has: 'У тебя уже есть участок', taken: 'Этот участок уже заняли', house: 'Дом полон — улучши его, чтобы поставить больше',
    empty: 'Пока нечего собирать', full: 'Склад полон — построй или улучши склад 📦', idle: 'Сейчас здесь ничего не строится', args: 'Не получилось',
    net: 'Нет связи с сервером — попробуй ещё раз', layout: 'Не получилось перенести участок', local: 'За монеты — после входа на сайт', max_likes: 'На сегодня хватит лайков 🙂',
    barracks: 'Сначала построй казарму ⚔️', ulock: 'Этот отряд — с казармы выше уровнем', space: 'В казарме нет места', noq: 'Очередь пуста', noarmy: 'Столько отрядов нет',
    soon: 'Откроется, когда сайт обновится',
    // военные базы
    age: 'Военные базы — с 12 лет (укажи возраст в ⚙️ Настройках → Сайт)', rank: 'Это могут только главарь и офицеры', leader: 'Это может только главарь', member: 'Ты не в этой базе',
    crew: 'В базе нет мест — улучшите штаб', code: 'Приглашение устарело — попроси новую ссылку', in_base: 'Ты уже в другой базе — сначала выйди из неё', name: 'Такое имя уже занято — выбери другое',
    vlock: 'Нужна постройка выше уровнем', vfull: 'Нет места — улучши или построй ещё', noveh: 'Такой техники нет', givemax: 'На сегодня пожертвований хватит', nodonor: 'Нужен свой участок в районе',
    self_kick: 'Себя исключить нельзя — выйди из базы', last: 'Сначала передай главаря другому', busy_raid: 'Сейчас идёт набег — попробуй через пару минут',
  };
  const fmtT = sec => {
    sec = Math.max(0, Math.ceil(sec));
    if (sec < 60) return sec + ' с';
    const m = Math.floor(sec / 60);
    if (m < 60) return m + ' мин' + (m < 10 && sec % 60 ? ' ' + (sec % 60) + ' с' : '');
    const h = Math.floor(m / 60), mm = m % 60;
    return h + ' ч' + (mm ? ' ' + mm + ' мин' : '');
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('ru');

  // ═══ Статичная часть района: улица, земля участков, фонари, арка, щиты (в buildWorld — до склейки мира) ═══
  function build(ctx){
    const { R, ph, X, S, P, M } = ctx, T = R.T;
    const dyn = [];
    // дорожка от площади, улица района, бордюры
    ctx.path(-11.5, -13.5, -12.5, -38, 3);
    P(null, { s: 'box', x: (LANE.x0 + LANE.x1) / 2, y: .02, z: LANE.z, w: LANE.x1 - LANE.x0, h: .02, d: LANE.w, m: M.walk });
    for (const s of [-1, 1]) P(null, { s: 'box', x: (LANE.x0 + LANE.x1) / 2, y: .05, z: LANE.z + s * (LANE.w / 2 + .1), w: LANE.x1 - LANE.x0, h: .1, d: .2, c: '#b9b2a4' });
    // участки: земля чуть светлее травы, низкий бордюр с проходом спереди
    for (const lot of LOTS) {
      const g = R.group(null, lot.x, 0, lot.z, lot.yaw);
      R.part(g, { s: 'box', y: .03, w: LOT, h: .04, d: LOT, c: '#93cf7c' });
      const curb = (x, z, w, d) => R.part(g, { s: 'box', x, y: .09, z, w, h: .14, d, c: '#d6cfc0' });
      curb(0, -HALF - .1, LOT + .4, .2); curb(-HALF - .1, 0, .2, LOT); curb(HALF + .1, 0, .2, LOT);
      curb(-HALF / 2 - 1.1, HALF + .1, HALF - 2.2 + .2, .2); curb(HALF / 2 + 1.1, HALF + .1, HALF - 2.2 + .2, .2);
    }
    // фонари и скамейки вдоль улицы
    for (let x = -17.5; x > LANE.x0 + 1; x -= 11) { R.prefab('lamp', { x, z: LANE.z + 2.75 }, ph); R.prefab('lamp', { x: x - 5.5, z: LANE.z - 2.75 }, ph); }
    for (const x of [-35.7, -57.9]) for (const [z, yaw] of [[LANE.z + 2.2, PI], [LANE.z - 2.2, 0]]) {
      R.prefab('bench', { x, z, yaw, m: M.planks }, ph);
      for (const sd of [-1, 1]) ctx.seatSpot({ id: `bd${Math.round(x * 10)}_${Math.round(z * 10)}_${sd}`, x: x + Math.cos(yaw) * .55 * sd, z: z - Math.sin(yaw) * .55 * sd, y: .62, yaw, bench: 'Скамейка' });
    }
    // арка над дорожкой у площади
    const ax = -11.65, az = -17.2;
    for (const s of [-1, 1]) ctx.box(ax + s * 2.1, 0, az, .5, 3.6, .5, '#7c2d12', { solid: true });
    ctx.box(ax, 3.6, az, 4.9, .45, .6, '#9a3412');
    ctx.plaque(ax, 3.82, az + .31, 4.4, .55, ctx.label('🏘️ Район участков', '#15803d', '#fff', 640, 80), 0);
    ctx.plaque(ax, 3.82, az - .31, 4.4, .55, ctx.label('🏘️ Район участков', '#15803d', '#fff', 640, 80), PI);
    // щит улицы (номер улицы — канвасом, меняется) и подсказка «как получить участок»
    const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; return { c, t, mat: new T.MeshBasicMaterial({ map: t, toneMapped: false }) }; };
    const bx = -13, bz = -46.6;
    for (const s of [-1, 1]) ctx.box(bx + s * 1.5, 0, bz, .2, 2.6, .2, '#6b4426', { solid: true });
    ctx.box(bx, 1.35, bz - .07, 3.4, 1.5, .1, '#3b2a1c');
    const board = mkCanvas(512, 224);
    const bm = ctx.plaque(bx, 2.1, bz, 3.2, 1.4, board.mat, 0); bm.userData.dyn = true;
    dyn.push(board);
    X.add({ x: bx, y: 1.4, z: bz + .6, r: 1.3, prompt: () => S.base ? S.base.boardPrompt() : 'Район участков', act: () => S.base?.streetPanel() });
    // таблички участков (номер, хозяин) — канвасом
    const signs = LOTS.map((lot, j) => {
      const [sx, sz] = lotToWorld(lot, -HALF + .9, HALF + .45), yaw = lot.yaw;
      const g = R.group(null, sx, 0, sz, yaw);
      R.part(g, { s: 'box', y: .9, w: .14, h: 1.8, d: .14, c: '#6b4426' });
      R.part(g, { s: 'box', y: 1.75, w: 1.95, h: .9, d: .08, c: '#3b2a1c' });
      const cv = mkCanvas(512, 224);
      const pl = new T.Mesh(R.K.geo('mbsign', () => new T.PlaneGeometry(1.85, .8)), cv.mat);
      pl.position.set(0, 1.75, .05); pl.userData.dyn = true;   // меняется — не склеивать
      g.add(pl);
      ph.addBox({ x: sx, z: sz, y: .9, hx: .1, hy: .9, hz: .1, tag: 'sign' });
      dyn.push(cv);
      X.add({ x: sx + Math.sin(yaw) * .5, y: 1.4, z: sz + Math.cos(yaw) * .5, r: .9, prompt: () => S.base ? S.base.signPrompt(j) : `Участок`, act: () => S.base?.signAct(j) });
      return { cv, x: sx, z: sz };
    });
    // указатель на площади (лицом к фонтану)
    R.prefab('sign', { x: -14.8, z: -12.6, yaw: Math.atan2(14.8, 12.6), text: 'Район участков', c: '#15803d' }, ph);
    return { board, signs, dyn, seatSpot: ctx.seatSpot };
  }
  function drawBoard(cv, street, streets, free){
    const g = cv.c.getContext('2d'), w = cv.c.width, h = cv.c.height;
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#166534'); gr.addColorStop(1, '#14532d');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 46px Montserrat, Arial, sans-serif'; g.fillText('🏘️ Район участков', w / 2, 62);
    g.fillStyle = '#fde68a'; g.font = '800 38px Montserrat, Arial, sans-serif'; g.fillText(`Улица ${street + 1}${streets > 1 ? ' из ' + streets : ''}`, w / 2, 122);
    g.fillStyle = '#bbf7d0'; g.font = '700 28px Montserrat, Arial, sans-serif'; g.fillText(free > 0 ? `Свободных участков: ${free}` : 'Все участки заняты — есть другие улицы', w / 2, 178);
    cv.t.needsUpdate = true;
  }
  function drawSign(cv, plot, info){
    const g = cv.c.getContext('2d'), w = cv.c.width, h = cv.c.height;
    g.fillStyle = !info ? '#15803d' : info.mine ? '#a16207' : '#5b21b6'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 54px Montserrat, Arial, sans-serif'; g.fillText('Участок № ' + plot, w / 2, 60);
    let sub = !info ? 'Свободен — займи!' : info.mine ? (info.local ? 'Пробный участок' : 'Мой участок') : info.nick || 'Игрок', fs = 44;
    g.font = `800 ${fs}px Montserrat, Arial, sans-serif`;
    while (g.measureText(sub).width > w * .88 && fs > 18) { fs -= 3; g.font = `800 ${fs}px Montserrat, Arial, sans-serif`; }
    g.fillStyle = !info ? '#bbf7d0' : '#fde68a'; g.fillText(sub, w / 2, 126);
    if (info) { g.fillStyle = '#e9d5ff'; g.font = '700 30px Montserrat, Arial, sans-serif'; g.fillText(`🏛️ ${info.th} ур.   👍 ${info.likes || 0}${info.tr > 0 ? `   ${LEAGUES[league(info.tr)][1]} ${info.tr}` : ''}${info.sh ? '   🛡️' : ''}`, w / 2, 182); }
    cv.t.needsUpdate = true;
  }

  // ═══ Постройки: рисуются деталями движка (R.part) в системе постройки (центр, перед — +z), тела — списком ═══
  const WOOD = '#a0673a', WOOD_D = '#6b4426', STONE = '#d6cfc0', STONE_D = '#9ca3af', DARK = '#1f2937', GOLD = '#facc15', BRICK = '#c2553d';
  const PAL = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];
  const TOWER_H = [3.4, 4.2, 5, 5.8, 6.6];
  const TRAPS = new Set(['bomb', 'airmine']);   // ловушки: видны только хозяину участка
  // строительные леса вокруг (стройка и улучшение)
  function scaffold(P, g, w, h, full){
    const hw = w / 2 - .1;
    for (const [x, z] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) P(g, { s: 'box', x, y: h / 2, z, w: .1, h, d: .1, c: '#d4a373' });
    for (const y of [h * .5, h - .05]) for (const [x, z, ww, dd] of [[0, -hw, w - .2, .08], [0, hw, w - .2, .08], [-hw, 0, .08, w - .2], [hw, 0, .08, w - .2]]) P(g, { s: 'box', x, y, z, w: ww, h: .08, d: dd, c: '#c08552' });
    if (full) {
      P(g, { s: 'box', y: .05, w: w - .3, h: .1, d: w - .3, c: '#8d6e4c' });
      P(g, { s: 'box', y: h * .3, w: w * .55, h: h * .55, d: w * .55, c: '#e7d3b0' });
      P(g, { s: 'box', y: h * .62, w: w * .58, h: .08, d: w * .58, c: '#f59e0b' });
    }
  }
  const DRAW = {
    th(P, g, it, bd){
      const L = Math.max(1, it.l), H = 2.6 + .35 * L, FZ = 1.6;   // FZ — передняя стена
      const wall = ['#f3e2c0', '#e5e7eb', '#fde2d2', '#dbeafe', '#fef3c7'][L - 1], roof = ['#b45309', '#64748b', '#b91c1c', '#1d4ed8', '#ca8a04'][L - 1];
      const top = .35 + H, apex = top + .14 + 2.1;
      P(g, { s: 'box', y: .175, w: 4.7, h: .35, d: 4.7, c: STONE });
      P(g, { s: 'box', y: .35 + H / 2, z: -.1, w: 4.1, h: H, d: 3.4, c: wall });
      for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * 2.05, y: .35 + H / 2, z: FZ - .02, w: .3, h: H + .05, d: .3, c: STONE_D });   // углы
      P(g, { s: 'box', y: top + .07, z: -.1, w: 4.45, h: .14, d: 3.75, c: WOOD_D });
      P(g, { s: 'cone', y: top + .14 + 1.05, z: -.1, r: 3.15, h: 2.1, seg: 4, yaw: PI / 4, c: roof, flat: true });
      P(g, { s: 'box', y: .35 + .85, z: FZ + .01, w: 1.1, h: 1.7, d: .08, c: WOOD_D });
      P(g, { s: 'box', y: .35 + 1.78, z: FZ + .02, w: 1.45, h: .16, d: .1, c: STONE_D });
      for (const sx of [-1, 1]) { P(g, { s: 'box', x: sx * 1.3, y: .35 + H * .58, z: FZ + .01, w: .6, h: .7, d: .06, c: '#ffe9a8', m: 'glow' }); P(g, { s: 'box', x: sx * 2.06, y: .35 + H * .58, z: -.3, w: .06, h: .7, d: .8, c: '#ffe9a8', m: 'glow' }); }
      P(g, { s: 'box', y: .1, z: 2.12, w: 1.7, h: .2, d: .5, c: STONE });
      // флаг: на ратуше всегда, со 2 уровня — выше и с башенкой
      const fh = L >= 2 ? 1.5 : 1;
      if (L >= 2) P(g, { s: 'box', y: apex - .25, w: .5, h: .5, d: .5, c: wall });
      P(g, { s: 'cyl', y: apex + fh / 2, r: .05, h: fh, c: '#374151' }); P(g, { s: 'box', x: .34, y: apex + fh - .25, w: .66, h: .4, d: .04, c: '#ef4444' });
      if (L >= 3) {
        for (const sx of [-1, 1]) { P(g, { s: 'cyl', x: sx * 1.25, y: .35 + H / 2, z: 2.05, r: .14, h: H, c: '#f8fafc' }); bd.push({ t: 'cyl', x: sx * 1.25, z: 2.05, y0: .35, r: .17, h: H }); }
        P(g, { s: 'box', y: top - .09, z: 1.9, w: 3.2, h: .18, d: .7, c: wall });
      }
      if (L >= 4) { P(g, { s: 'cyl', y: .35 + H * .88, z: FZ + .02, r: .34, h: .05, rx: PI / 2, c: '#fff7ed' }); P(g, { s: 'box', y: .35 + H * .88, z: FZ + .06, w: .04, h: .26, d: .02, c: DARK }); }
      if (L >= 5) P(g, { s: 'ball', y: apex + fh + .15, r: .24, c: GOLD, m: 'glow' });
      bd.push({ t: 'box', y0: 0, h: .35, w: 4.7, d: 4.7, floor: 'stone' }, { t: 'box', z: -.1, y0: .35, h: H, w: 4.1, d: 3.4, cam: true });
      return apex + fh;
    },
    house(P, g, it, bd, x){
      const L = Math.max(1, it.l), S = 5 * CELL - .2, hw = S / 2, H = 3, t = .3, DG = 1.8, DH = 2.5;
      const wallC = ['#ffe8a8', '#bde0fe', '#ffc8dd', '#caffbf', '#e0c3fc'][L - 1], roofC = ['#b91c1c', '#1d4ed8', '#be185d', '#15803d', '#7e22ce'][L - 1], trim = L >= 5 ? GOLD : '#7c2d12';
      P(g, { s: 'box', y: .06, w: S, h: .12, d: S, c: '#d6a77a' });
      bd.push({ t: 'box', y0: 0, h: .12, w: S, d: S, floor: 'wood' });
      const wall = (bx, bz, w, d, y0 = 0, h = H) => { P(g, { s: 'box', x: bx, y: y0 + h / 2, z: bz, w, h, d, c: wallC }); bd.push({ t: 'box', x: bx, z: bz, y0, w, h, d, cam: true }); };
      wall(0, -hw + t / 2, S, t);
      wall(-hw + t / 2, 0, t, S - 2 * t); wall(hw - t / 2, 0, t, S - 2 * t);
      const sw = (S - DG) / 2;
      wall(-(DG / 2 + sw / 2), hw - t / 2, sw, t); wall(DG / 2 + sw / 2, hw - t / 2, sw, t);
      wall(0, hw - t / 2, DG, t, DH, H - DH);
      for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * (DG / 2 + .06), y: DH / 2, z: hw - t / 2, w: .12, h: DH, d: t + .1, c: trim });
      P(g, { s: 'box', y: DH + .06, z: hw - t / 2, w: DG + .24, h: .12, d: t + .1, c: trim });
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P(g, { s: 'box', x: sx * (hw - .15), y: H / 2 + .02, z: sz * (hw - .15), w: .42, h: H + .04, d: .42, c: trim });
      // окна (снаружи и изнутри): по бокам и сзади
      const win = (wx, wz, side) => { for (const k of [1, -1]) { const o = (t / 2 + .02) * k; P(g, side ? { s: 'box', x: wx + o, y: 1.6, z: wz, w: .03, h: 1, d: 1.3, c: '#9bd2f2' } : { s: 'box', x: wx, y: 1.6, z: wz + o, w: 1.3, h: 1, d: .03, c: '#9bd2f2' }); } };
      win(-hw + t / 2, 0, true); win(hw - t / 2, 0, true); win(0, -hw + t / 2, false);
      for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * (hw + .06), y: 1.08, z: 0, w: .14, h: .08, d: 1.5, c: trim });
      // крыльцо и фонарь у двери
      P(g, { s: 'box', y: .05, z: hw + .45, w: DG + .8, h: .1, d: .8, c: STONE });
      if (L >= 3) P(g, { s: 'ball', x: DG / 2 + .35, y: 2.2, z: hw + .12, r: .12, c: '#fff3b0', m: 'glow' });
      if (L >= 4) for (const sx of [-1, 1]) { P(g, { s: 'box', x: sx * (hw + .2), y: .95, z: 0, w: .3, h: .2, d: 1.3, c: WOOD }); for (let i = 0; i < 4; i++) P(g, { s: 'ball', x: sx * (hw + .2), y: 1.12, z: -.45 + i * .3, r: .09, c: PAL[(i + L) % PAL.length], seg: 6 }); }
      // крыша — отдельно (прячется, когда ты внутри)
      const roof = new x.T.Group(); roof.userData.dyn = true; g.add(roof);
      const base = S + .8, len = S + .7, r = base / 1.732, rise = 1.7, sz = rise / (1.5 * r);
      const m = P(roof, { s: 'cyl', r, h: len, seg: 3, rx: -PI / 2, c: roofC, flat: true });
      m.scale.set(1, 1, sz); m.position.y = H + .5 * r * sz;
      P(roof, { s: 'box', y: H + .06, w: S + .3, h: .12, d: S + .3, c: trim });
      // скаты — настоящие (камеру не держат): иначе руки цеплялись за верх стены под нарисованной крышей
      for (const sd of [-1, 1]) bd.push({ t: 'wedge', x: sd * base / 4, z: 0, y0: H, w: len, h: rise, d: base / 2, yaw: sd * PI / 2 });
      if (L >= 2) P(roof, { s: 'box', x: 1.5, y: H + 1.4, z: -1.2, w: .5, h: 1.5, d: .5, c: BRICK });
      x.roof = roof;
      x.room = { hw: hw - t, h: H };
      x.door = { x: 0, z: hw - t / 2, w: DG, h: DH, d: t + .2 };
      return H + rise + .5;
    },
    mine(P, g, it, bd){
      const L = Math.max(1, it.l);
      P(g, { s: 'ico', x: -.2, y: .35, z: -.3, r: 1.25, sy: .72, c: '#8b8f99', det: 1 });
      P(g, { s: 'ico', x: .75, y: .3, z: -.75, r: .62, sy: .8, c: '#7c818b', det: 0 });
      P(g, { s: 'box', y: .55, z: .55, w: .9, h: 1.1, d: .5, c: DARK });
      for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * .52, y: .65, z: .82, w: .14, h: 1.3, d: .14, c: WOOD });
      P(g, { s: 'box', y: 1.33, z: .82, w: 1.25, h: .16, d: .18, c: WOOD });
      P(g, { s: 'box', x: .85, y: .4, z: 1.05, w: .62, h: .3, d: .45, c: '#6b7280' });
      for (const [wx, wz] of [[.62, .87], [1.08, .87], [.62, 1.23], [1.08, 1.23]]) P(g, { s: 'cyl', x: wx, y: .12, z: wz, r: .1, h: .06, rz: PI / 2, c: DARK });
      for (let i = 0; i < 3; i++) P(g, { s: 'box', x: .72 + i * .13, y: .6, z: 1.05, w: .12, h: .08, d: .22, c: BRICK });
      if (L >= 2) for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * .22, y: .03, z: 1.15, w: .06, h: .06, d: .9, c: '#57534e' });
      if (L >= 3) P(g, { s: 'ball', x: -.62, y: 1.2, z: .9, r: .1, c: '#fff3b0', m: 'glow' });
      if (L >= 4) P(g, { s: 'box', x: -1.05, y: .6, z: .9, w: .5, h: 1.2, d: .5, c: WOOD_D });
      if (L >= 5) for (let i = 0; i < 3; i++) P(g, { s: 'ico', x: -.6 + i * .45, y: .95 - i * .1, z: -.1 - i * .2, r: .13, c: GOLD, m: 'glow', det: 0 });
      bd.push({ t: 'cyl', x: -.2, z: -.3, y0: 0, r: 1.1, h: 1.1 }, { t: 'box', x: .85, z: 1.05, y0: 0, w: .66, h: .55, d: .5 });
      return 2;
    },
    store(P, g, it, bd){
      const L = Math.max(1, it.l), wc = [WOOD, '#94a3b8', '#b45309', '#2563eb', '#ca8a04'][L - 1];
      P(g, { s: 'box', y: .85, z: -.25, w: 2.6, h: 1.7, d: 2.1, c: wc });
      P(g, { s: 'box', y: 1.8, z: -.25, w: 2.9, h: .16, d: 2.5, rx: .1, c: '#7c2d12' });
      P(g, { s: 'box', y: .65, z: .82, w: 1.3, h: 1.3, d: .06, c: '#4b2e1a' });
      P(g, { s: 'box', y: .65, z: .86, w: .06, h: 1.3, d: .04, c: '#c8956a' });
      P(g, { s: 'box', x: 1.1, y: .25, z: 1.05, w: .5, h: .5, d: .5, c: '#c8956a' }); P(g, { s: 'box', x: 1.1, y: .7, z: 1.05, w: .4, h: .4, d: .4, c: '#b07d4f' });
      for (let i = 0; i < Math.min(5, L + 1); i++) P(g, { s: 'box', x: -1.05, y: .1 + i * .17, z: 1.05, w: .45, h: .15, d: .45, c: i % 2 ? BRICK : '#a3412c' });
      bd.push({ t: 'box', y0: 0, z: -.25, w: 2.6, h: 1.7, d: 2.1 }, { t: 'box', x: 1.1, z: 1.05, y0: 0, w: .5, h: .9, d: .5 });
      return 2.6;
    },
    shop(P, g, it, bd){
      P(g, { s: 'box', y: .8, z: -.5, w: 2.3, h: 1.6, d: 1.8, c: '#e7c9a0' });
      P(g, { s: 'box', y: 1.75, z: -.45, w: 2.6, h: .16, d: 2.2, rx: -.15, c: '#9a3412' });
      P(g, { s: 'box', x: .9, y: 1.95, z: -1, w: .35, h: .9, d: .35, c: BRICK });
      P(g, { s: 'box', y: .6, z: .42, w: .8, h: 1.2, d: .05, c: WOOD_D });
      P(g, { s: 'box', x: .7, y: .25, z: .95, w: .35, h: .5, d: .3, c: '#44403c' }); P(g, { s: 'box', x: .7, y: .55, z: .95, w: .7, h: .14, d: .26, c: '#57534e' });
      P(g, { s: 'cyl', x: -.85, y: .35, z: .95, r: .28, h: .7, c: WOOD });
      P(g, { s: 'box', x: -.2, y: 1.45, z: .44, w: .7, h: .1, d: .06, c: '#d6d3d1' }); P(g, { s: 'box', x: -.2, y: 1.2, z: .44, w: .1, h: .5, d: .06, c: WOOD_D });
      bd.push({ t: 'box', y0: 0, z: -.5, w: 2.3, h: 1.6, d: 1.8 }, { t: 'cyl', x: -.85, z: .95, y0: 0, r: .3, h: .7 });
      return 2.6;
    },
    tower(P, g, it, bd, x){
      const L = Math.max(1, it.l), Ht = TOWER_H[L - 1], top = Ht + 1.9, pc = ['#8b5a2b', '#78716c', '#1e3a8a', '#334155', '#a16207'][L - 1];
      for (const [px, pz] of [[-1.25, -1.25], [1.25, -1.25], [-1.25, 1.25], [1.25, 1.25]]) { P(g, { s: 'cyl', x: px, y: top / 2, z: pz, r: .12, h: top, c: pc }); bd.push({ t: 'cyl', x: px, z: pz, y0: 0, r: .15, h: top }); }
      P(g, { s: 'box', y: Ht, w: 3, h: .2, d: 3, c: WOOD_D });
      bd.push({ t: 'box', y0: Ht - .1, h: .2, w: 3, d: 3, floor: 'wood' });
      for (const [rx, rz, w, d] of [[0, -1.42, 2.9, .08], [-1.42, 0, .08, 2.9], [1.42, 0, .08, 2.9], [-.95, 1.42, 1, .08], [.95, 1.42, 1, .08]]) { P(g, { s: 'box', x: rx, y: Ht + .55, z: rz, w, h: .08, d, c: WOOD }); bd.push({ t: 'box', x: rx, z: rz, y0: Ht + .1, w: Math.max(w, .12), h: .8, d: Math.max(d, .12) }); }
      // лучники на площадке — только у вышки военной базы (она стреляет в набегах); в районе вышка смотровая
      if (x.war) for (const ax of (L >= 3 ? [-.7, .7] : [.6])) { P(g, { s: 'cyl', x: ax, y: Ht + .45, z: -.7, r: .17, h: .7, c: '#15803d' }); P(g, { s: 'ball', x: ax, y: Ht + .95, z: -.7, r: .17, c: '#f7cba5' }); P(g, { s: 'cone', x: ax, y: Ht + 1.12, z: -.7, r: .2, h: .2, seg: 8, c: '#166534' }); P(g, { s: 'box', x: ax + .22, y: Ht + .6, z: -.62, w: .04, h: .7, d: .04, rz: .2, c: WOOD_D }); }
      P(g, { s: 'cone', y: top + .55, r: 2.25, h: 1.1, seg: 4, yaw: PI / 4, c: ['#b91c1c', '#7c3aed', '#ca8a04', '#0f766e', '#be123c'][L - 1], flat: true });
      P(g, { s: 'cyl', y: top + 1.5, r: .04, h: .9, c: '#374151' }); P(g, { s: 'box', x: .26, y: top + 1.75, w: .5, h: .3, d: .04, c: PAL[it.i % PAL.length] });
      // лестница спереди
      for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * .36, y: Ht / 2, z: 1.45, w: .07, h: Ht, d: .07, c: WOOD });
      for (let y = .3; y < Ht; y += .38) P(g, { s: 'box', y, z: 1.45, w: .72, h: .05, d: .06, c: WOOD });
      x.ladder = { x: 0, z: 1.45, top: Ht + .1, ex: 0, ez: .75 };
      return top + 2;
    },
    // ── Оборона для набегов: пушка (ствол смотрит вперёд), мортира, ловушки (только хозяину), казарма ──
    cannon(P, g, it, bd){
      const L = Math.max(1, it.l), base = ['#a8a29e', '#94a3b8', '#78716c', '#475569', '#a16207'][L - 1], metal = L >= 5 ? GOLD : L >= 3 ? '#1f2937' : '#374151';
      P(g, { s: 'cyl', y: .25, r: 1.3, h: .5, seg: 10, c: base });
      P(g, { s: 'cyl', y: .56, r: 1.08, h: .12, seg: 10, c: WOOD_D });
      P(g, { s: 'box', y: .9, z: -.15, w: .78, h: .55, d: 1, c: WOOD });
      for (const sx of [-1, 1]) { P(g, { s: 'cyl', x: sx * .5, y: .82, z: -.25, r: .36, h: .12, rz: PI / 2, c: WOOD_D }); P(g, { s: 'cyl', x: sx * .5, y: .82, z: -.25, r: .1, h: .14, rz: PI / 2, c: metal }); }
      P(g, { s: 'cyl', y: 1.22, z: .35, r: .25, r2: .31, h: 1.5, rx: PI / 2 - .22, c: metal });
      P(g, { s: 'cyl', y: 1.38, z: 1.08, r: .3, h: .1, rx: PI / 2 - .22, c: DARK });
      P(g, { s: 'ball', y: 1.12, z: -.62, r: .2, c: metal });
      if (L >= 2) for (let i = 0; i < 3; i++) P(g, { s: 'ball', x: .85 - i * .26, y: .74, z: -.85, r: .12, c: DARK });
      if (L >= 4) for (let k = 0; k < 6; k++) { const a = k * PI / 3; P(g, { s: 'box', x: Math.cos(a) * 1.2, y: .6, z: Math.sin(a) * 1.2, w: .3, h: .22, d: .3, c: STONE_D }); }
      bd.push({ t: 'cyl', y0: 0, r: 1.3, h: .62 }, { t: 'box', y0: .62, w: .9, h: .6, d: 1.6 });
      return 2.1;
    },
    mortar(P, g, it, bd){
      const L = Math.max(1, it.l), ring = ['#9ca3af', '#a8a29e', '#78716c', '#57534e'][L - 1];
      P(g, { s: 'cyl', y: .32, r: 1.38, h: .64, seg: 12, c: ring });
      P(g, { s: 'cyl', y: .66, r: 1.12, h: .05, seg: 12, c: '#57534e' });
      P(g, { s: 'cyl', y: .78, r: .7, h: .22, seg: 12, c: '#44403c' });
      P(g, { s: 'cyl', y: 1.25, z: .12, r: .44, r2: .56, h: 1, rx: .32, c: L >= 4 ? GOLD : DARK });
      P(g, { s: 'cyl', y: 1.72, z: .28, r: .47, h: .08, rx: .32, c: '#111827' });
      for (let i = 0; i < 3; i++) P(g, { s: 'ball', x: -.75 + i * .26, y: .82, z: .78, r: .13, c: DARK });
      if (L >= 3) for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * .95, y: .9, z: -.5, w: .14, h: .5, d: .14, c: WOOD_D });
      bd.push({ t: 'cyl', y0: 0, r: 1.38, h: .7 }, { t: 'cyl', y0: .7, r: .6, h: .9 });
      return 2.2;
    },
    bomb(P, g, it){
      P(g, { s: 'cyl', y: .01, r: .55, h: .02, c: '#78716c' });
      P(g, { s: 'ball', y: .16, r: .24 + .03 * (Math.max(1, it.l) - 1), c: '#111827' });
      P(g, { s: 'cyl', y: .44, r: .04, h: .2, c: '#a16207' }); P(g, { s: 'ball', y: .55, r: .05, c: '#f97316', m: 'glow' });
      return .9;
    },
    airmine(P, g, it){
      P(g, { s: 'cyl', y: .35, r: .045, h: .7, c: '#6b7280' });
      P(g, { s: 'ball', y: .82, r: .2 + .03 * (Math.max(1, it.l) - 1), c: '#dc2626' });
      for (let k = 0; k < 4; k++) { const a = k * PI / 2; P(g, { s: 'cone', x: Math.cos(a) * .22, y: .82, z: Math.sin(a) * .22, r: .05, h: .14, seg: 5, rz: -Math.cos(a) * PI / 2, rx: Math.sin(a) * PI / 2, c: '#fde68a' }); }
      return 1.2;
    },
    barracks(P, g, it, bd){
      const L = Math.max(1, it.l), wallC = ['#e7c9a0', '#d6d3d1', '#fecaca', '#bfdbfe', '#fde68a'][L - 1], roofC = ['#b91c1c', '#9a3412', '#7f1d1d', '#1e3a8a', '#ca8a04'][L - 1];
      const W = 2.7, D = 2.1, H = 1.55;
      P(g, { s: 'box', y: .06, w: 3.1, h: .12, d: 3.1, c: STONE });
      P(g, { s: 'box', y: H / 2 + .12, z: -.3, w: W, h: H, d: D, c: wallC });
      const r = (W + .4) / 1.732, rise = 1, sz = rise / (1.5 * r);
      const m = P(g, { s: 'cyl', r, h: D + .35, seg: 3, rx: -PI / 2, c: roofC, flat: true });
      m.scale.set(1, 1, sz); m.position.set(0, H + .12 + .5 * r * sz, -.3);
      P(g, { s: 'box', y: .75, z: .76, w: .8, h: 1.25, d: .06, c: WOOD_D });
      P(g, { s: 'cyl', x: 0, y: 1.25, z: .79, r: .32, h: .05, rx: PI / 2, c: L >= 5 ? GOLD : '#e5e7eb' });
      P(g, { s: 'box', y: 1.25, z: .83, w: .5, h: .07, d: .03, rz: .78, c: '#6b7280' }); P(g, { s: 'box', y: 1.25, z: .83, w: .5, h: .07, d: .03, rz: -.78, c: '#6b7280' });
      // флаг и чучело для тренировки
      P(g, { s: 'cyl', x: 1.2, y: 1.6, z: -1.2, r: .04, h: 3.2, c: '#374151' }); P(g, { s: 'box', x: 1.52, y: 2.95, z: -1.2, w: .62, h: .38, d: .04, c: roofC });
      P(g, { s: 'cyl', x: -1.05, y: .55, z: 1.05, r: .05, h: 1.1, c: WOOD_D }); P(g, { s: 'cyl', x: -1.05, y: .82, z: 1.05, r: .2, h: .45, c: '#d6b88a' });
      P(g, { s: 'ball', x: -1.05, y: 1.18, z: 1.05, r: .16, c: '#e7c9a0' }); P(g, { s: 'box', x: -1.05, y: .9, z: 1.05, w: .7, h: .06, d: .06, c: WOOD_D });
      if (L >= 3) for (const sx of [-1, 1]) P(g, { s: 'cone', x: sx * 1.2, y: .45, z: .95, r: .16, h: .6, seg: 6, c: '#f59e0b', m: 'glow' });
      bd.push({ t: 'box', y0: 0, z: -.3, w: W, h: H + .2, d: D, cam: true }, { t: 'cyl', x: -1.05, z: 1.05, y0: 0, r: .22, h: 1.2 });
      return H + 1.4;
    },
    tree(P, g, it, bd, x){ x.R.prefab('tree', { parent: g, x: 0, z: 0, k: .75, v: it.i % 4, yaw: it.i }); bd.push({ t: 'cyl', y0: 0, r: .28, h: 2 }); return 3; },
    pine(P, g, it, bd, x){ x.R.prefab('pine', { parent: g, x: 0, z: 0, k: .7 }); bd.push({ t: 'cyl', y0: 0, r: .25, h: 2 }); return 3; },
    bush(P, g, it, bd, x){ x.R.prefab('bush', { parent: g, x: 0, z: 0, k: .9, c: ['#3f9a4c', '#4ea544', '#2f7d4a'][it.i % 3] }); return 1.2; },
    flowers(P, g, it, bd, x){ P(g, { s: 'box', y: .06, w: 1.3, h: .12, d: 1.3, c: '#7a5a3c' }); x.R.prefab('flowers', { parent: g, x: 0, z: 0, n: 9, seed: it.i, c: PAL[it.i % PAL.length] }); return 1; },
    rock(P, g, it, bd, x){ x.R.prefab('rock', { parent: g, x: 0, z: 0, k: .75, yaw: it.i }); bd.push({ t: 'cyl', y0: 0, r: .5, h: .55 }); return 1.2; },
    lamp(P, g, it, bd, x){ x.R.prefab('lamp', { parent: g, x: 0, z: 0 }); bd.push({ t: 'cyl', y0: 0, r: .16, h: 3 }); return 3.6; },
    flag(P, g, it, bd){
      P(g, { s: 'cyl', y: .1, r: .3, h: .2, c: STONE_D }); P(g, { s: 'cyl', y: 1.7, r: .05, h: 3.2, c: '#e5e7eb' });
      P(g, { s: 'box', x: .45, y: 2.9, w: .9, h: .56, d: .05, c: PAL[it.i % PAL.length] }); P(g, { s: 'ball', y: 3.35, r: .09, c: GOLD });
      bd.push({ t: 'cyl', y0: 0, r: .12, h: 3.2 });
      return 3.8;
    },
    bench(P, g, it, bd, x){ x.R.prefab('bench', { parent: g, x: 0, z: 0, yaw: 0, c: WOOD }); bd.push({ t: 'box', y0: 0, w: 2.2, h: 1, d: .66 }); x.seats = [[-.55, 0, .62], [.55, 0, .62]]; return 1.6; },
    fountain(P, g, it, bd, x){
      P(g, { s: 'cyl', y: .25, r: 1.45, h: .5, seg: 24, c: STONE }); P(g, { s: 'cyl', y: .27, r: 1.25, h: .48, seg: 24, m: x.R.water('#5ec8f2') });
      P(g, { s: 'cyl', y: .85, r: .18, h: 1.1, c: '#cfc6b4' }); P(g, { s: 'cyl', y: 1.42, r: .55, h: .14, seg: 16, c: STONE });
      P(g, { s: 'ball', y: 1.72, r: .22, c: '#bdeeff', m: 'glow', seg: 10 });
      bd.push({ t: 'cyl', y0: 0, r: 1.45, h: .5 }, { t: 'cyl', y0: 0, r: .3, h: 1.5 });
      return 2.3;
    },
    statue(P, g, it, bd, x){
      const gold = x.R.mat(GOLD, { metal: .85, rough: .28 });
      P(g, { s: 'box', y: .35, w: 1.1, h: .7, d: 1.1, c: '#e5e7eb' });
      for (const sx of [-1, 1]) P(g, { s: 'cyl', x: sx * .13, y: 1.05, r: .08, h: .7, m: gold });
      P(g, { s: 'cyl', y: 1.62, r: .22, r2: .18, h: .6, m: gold }); P(g, { s: 'ball', y: 2.12, r: .2, m: gold });
      P(g, { s: 'box', x: -.3, y: 1.62, w: .12, h: .5, d: .12, rz: -.3, m: gold }); P(g, { s: 'box', x: .32, y: 2.05, w: .12, h: .55, d: .12, rz: .5, m: gold });
      P(g, { s: 'cone', y: 2.43, r: .2, h: .3, seg: 8, c: '#ef4444' });
      bd.push({ t: 'box', y0: 0, w: 1.1, h: 2.3, d: 1.1 });
      return 2.9;
    },
  };
  // ═══ Постройки военной базы (свои; остальные — из DRAW: карьер, склад, мастерская, казарма, оборона, ловушки, камни, ёлки) ═══
  const MIL = '#4d5b2a', MIL_D = '#3f4a22', CONC = '#a8a29e', CONC_D = '#78716c';
  const WDRAW = {
    th(P, g, it, bd, x){
      const L = Math.max(1, it.l), H = 2.3 + .35 * L, W = 4.2, D = 3.5, zc = -.2, FZ = zc + D / 2;
      const wall = ['#b5ad9a', '#a8a29e', '#9ca3af', '#8b8f99', '#6b7280'][L - 1], col = x.color || '#ef4444';
      P(g, { s: 'box', y: .15, w: 4.7, h: .3, d: 4.7, c: CONC_D });
      P(g, { s: 'box', y: .3 + H / 2, z: zc, w: W, h: H, d: D, c: wall });
      P(g, { s: 'box', y: .3 + H + .1, z: zc, w: W + .3, h: .2, d: D + .3, c: MIL_D });
      for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * (W / 2 - .05), y: .3 + H / 2, z: FZ + .05, w: .35, h: H + .02, d: .3, c: MIL });   // углы
      P(g, { s: 'box', y: 1.25, z: FZ + .03, w: 1.2, h: 1.9, d: .1, c: '#374151' });                                                     // дверь
      P(g, { s: 'box', y: 2.25, z: FZ + .06, w: 1.5, h: .14, d: .14, c: col });                                                          // козырёк цвета базы
      for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * 1.35, y: .3 + H * .62, z: FZ + .02, w: .8, h: .32, d: .06, c: '#fde68a', m: 'glow' });   // бойницы
      // антенна и радар (с 3-го), спутниковая тарелка (с 4-го), прожектор (5-й)
      const top = .3 + H + .2;
      P(g, { s: 'cyl', x: 1.5, y: top + .9, z: zc - 1.1, r: .05, h: 1.8, c: '#374151' });
      if (L >= 3) { P(g, { s: 'cyl', x: -1.2, y: top + .35, z: zc - .9, r: .12, h: .7, c: '#4b5563' }); P(g, { s: 'cyl', x: -1.2, y: top + .8, z: zc - .9, r: .55, h: .08, rx: .5, c: '#e5e7eb' }); }
      if (L >= 4) P(g, { s: 'ball', x: .5, y: top + .3, z: zc + .7, r: .4, sy: .5, c: '#d1d5db' });
      if (L >= 5) P(g, { s: 'ball', x: 1.5, y: top + 1.85, z: zc - 1.1, r: .12, c: '#fef08a', m: 'glow' });
      // флаг базы
      P(g, { s: 'cyl', x: -1.9, y: top + 1.2, z: FZ - .2, r: .05, h: 2.4, c: '#e5e7eb' }); P(g, { s: 'box', x: -1.5, y: top + 2.15, z: FZ - .2, w: .8, h: .5, d: .04, c: col });
      bd.push({ t: 'box', y0: 0, h: .3, w: 4.7, d: 4.7, floor: 'concrete' }, { t: 'box', z: zc, y0: .3, h: H + .3, w: W + .3, d: D + .3, cam: true });
      return top + 2.4;
    },
    factory(P, g, it, bd){
      const L = Math.max(1, it.l), wc = ['#b45309', '#9a3412', '#7c2d12', '#57534e'][L - 1];
      P(g, { s: 'box', y: 1.1, z: -.3, w: 4.2, h: 2.2, d: 3.4, c: wc });
      for (let i = 0; i < 3; i++) P(g, { s: 'box', x: -1.4 + i * 1.4, y: 2.5, z: -.3, w: 1.3, h: .55, d: 3.4, rz: .35, c: '#6b7280' });   // пилообразная крыша
      P(g, { s: 'cyl', x: 1.5, y: 2.6, z: -1.4, r: .32, r2: .4, h: 3, c: '#78716c' }); P(g, { s: 'cyl', x: 1.5, y: 4.15, z: -1.4, r: .36, h: .12, c: '#ef4444' });   // труба
      P(g, { s: 'box', y: .9, z: 1.45, w: 1.6, h: 1.8, d: .08, c: '#374151' });
      P(g, { s: 'box', x: -1.3, y: .3, z: 1.9, w: 1.4, h: .25, d: .7, c: '#1f2937' });                                                   // лента
      for (let i = 0; i < Math.min(5, L + 1); i++) P(g, { s: 'box', x: -1.8 + i * .28, y: .5, z: 1.9, w: .22, h: .14, d: .3, c: BRICK });
      if (L >= 3) P(g, { s: 'ball', x: 1.5, y: 4.4, z: -1.4, r: .12, c: '#fca5a5', m: 'glow' });
      bd.push({ t: 'box', y0: 0, z: -.3, w: 4.2, h: 2.6, d: 3.4, cam: true }, { t: 'cyl', x: 1.5, z: -1.4, y0: 0, r: .42, h: 4.2 });
      return 4.6;
    },
    garage(P, g, it, bd){
      const L = Math.max(1, it.l), wc = ['#a8a29e', '#94a3b8', '#78716c'][L - 1];
      P(g, { s: 'box', y: .06, w: 4.6, h: .12, d: 4.6, c: CONC_D });
      P(g, { s: 'box', x: -2.15, y: 1.55, w: .3, h: 3, d: 4.4, c: wc }); P(g, { s: 'box', x: 2.15, y: 1.55, w: .3, h: 3, d: 4.4, c: wc });
      P(g, { s: 'box', y: 1.55, z: -2.05, w: 4.6, h: 3, d: .3, c: wc });
      P(g, { s: 'box', y: 3.15, w: 4.8, h: .25, d: 4.6, c: MIL_D });
      P(g, { s: 'box', y: 2.7, z: 2.1, w: 4, h: .55, d: .12, c: '#facc15' });   // полосатый край ворот (поднятые ворота)
      for (let i = 0; i < 5; i++) P(g, { s: 'box', x: -1.6 + i * .8, y: 2.7, z: 2.17, w: .32, h: .52, d: .04, c: '#111827' });
      if (L >= 2) P(g, { s: 'box', x: 1.4, y: 1.2, z: -1.7, w: 1, h: 1.1, d: .5, c: '#374151' });   // верстак
      bd.push({ t: 'box', x: -2.15, y0: 0, w: .3, h: 3.2, d: 4.4, cam: true }, { t: 'box', x: 2.15, y0: 0, w: .3, h: 3.2, d: 4.4, cam: true }, { t: 'box', z: -2.05, y0: 0, w: 4.6, h: 3.2, d: .3, cam: true },
        { t: 'box', y0: 3.05, h: .3, w: 4.8, d: 4.6 });
      return 3.6;
    },
    helipad(P, g, it){
      const L = Math.max(1, it.l);
      P(g, { s: 'box', y: .08, w: 4.6, h: .16, d: 4.6, c: '#4b5563' });
      P(g, { s: 'cyl', y: .17, r: 2, h: .03, seg: 28, c: '#facc15' }); P(g, { s: 'cyl', y: .18, r: 1.82, h: .03, seg: 28, c: '#4b5563' });
      P(g, { s: 'box', x: -.6, y: .2, w: .25, h: .03, d: 1.6, c: '#f8fafc' }); P(g, { s: 'box', x: .6, y: .2, w: .25, h: .03, d: 1.6, c: '#f8fafc' }); P(g, { s: 'box', y: .2, w: 1.2, h: .03, d: .25, c: '#f8fafc' });   // «H»
      for (const [lx, lz] of [[-2.1, -2.1], [2.1, -2.1], [-2.1, 2.1], [2.1, 2.1]]) P(g, { s: 'ball', x: lx, y: .3, z: lz, r: .1, c: L >= 2 ? '#86efac' : '#fca5a5', m: 'glow' });
      P(g, { s: 'cyl', x: 2.1, y: 1, z: -2.1, r: .04, h: 1.8, c: '#9ca3af' }); P(g, { s: 'cone', x: 2.1, y: 1.8, z: -2.1, r: .18, h: .5, rz: PI / 2, c: '#f97316' });   // «колдун»
      return 1.2;
    },
    hangar(P, g, it, bd){
      const L = Math.max(1, it.l), c = L >= 2 ? '#64748b' : '#78716c';
      P(g, { s: 'box', y: .06, w: 6.3, h: .12, d: 6.3, c: CONC_D });
      P(g, { s: 'cyl', y: 0, r: 3.05, h: 6, rx: PI / 2, seg: 18, c });   // арка (низ — под землёй)
      P(g, { s: 'box', y: 1.3, z: 3.02, w: 5.2, h: 2.6, d: .06, c: '#1f2937' });
      for (let i = 0; i < 4; i++) P(g, { s: 'box', x: -1.95 + i * 1.3, y: 1.3, z: 3.06, w: .06, h: 2.6, d: .04, c: '#9ca3af' });
      P(g, { s: 'box', y: 2.95, z: 3.05, w: 1.6, h: .35, d: .06, c: '#facc15' });
      bd.push({ t: 'box', y0: 0, w: 6.1, h: 2.9, d: 6, cam: true });
      return 3.4;
    },
    dock(P, g, it){
      const L = Math.max(1, it.l);
      P(g, { s: 'box', y: .25, w: 4.6, h: .14, d: 4.6, c: WOOD });
      for (let i = 0; i < 6; i++) P(g, { s: 'box', y: .33, z: -2 + i * .8, w: 4.6, h: .02, d: .05, c: WOOD_D });
      for (const [lx, lz] of [[-2.1, -2.1], [2.1, -2.1], [-2.1, 2.1], [2.1, 2.1]]) P(g, { s: 'cyl', x: lx, y: .2, z: lz, r: .14, h: .6, c: WOOD_D });
      for (const lx of [-1.4, 1.4]) P(g, { s: 'cyl', x: lx, y: .5, z: 2, r: .12, h: .35, c: '#1f2937' });   // кнехты
      P(g, { s: 'ball', x: 1.9, y: .55, z: -1.9, r: .3, c: '#f97316' });   // спасательный круг
      if (L >= 2) { P(g, { s: 'box', x: -1.6, y: 1.4, z: -1.6, w: .25, h: 2.6, d: .25, c: '#facc15' }); P(g, { s: 'box', x: -1, y: 2.6, z: -1.6, w: 1.6, h: .2, d: .2, c: '#facc15' }); }   // кран
      return 1.4;
    },
    bunker(P, g, it, bd){
      P(g, { s: 'box', y: .35, w: 3, h: .7, d: 3, c: CONC });
      P(g, { s: 'box', y: .72, w: 3.2, h: .08, d: 3.2, c: CONC_D });
      P(g, { s: 'box', y: .5, z: 1.3, w: 1.2, h: .9, d: .5, rx: -.5, c: '#4b5563' });   // наклонная дверца-люк
      P(g, { s: 'box', y: .9, z: 1.28, w: .9, h: .18, d: .05, c: '#facc15' });
      for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * 1.1, y: 1.05, z: -1.1, w: .25, h: .6, d: .25, c: '#6b7280' });   // вентиляция
      bd.push({ t: 'box', y0: 0, w: 3, h: .8, d: 3, floor: 'concrete' });
      return 1.4;
    },
    flag(P, g, it, bd, x){
      P(g, { s: 'cyl', y: .1, r: .3, h: .2, c: CONC_D }); P(g, { s: 'cyl', y: 1.7, r: .05, h: 3.2, c: '#e5e7eb' });
      P(g, { s: 'box', x: .45, y: 2.9, w: .9, h: .56, d: .05, c: x.color || PAL[it.i % PAL.length] }); P(g, { s: 'ball', y: 3.35, r: .09, c: GOLD });
      bd.push({ t: 'cyl', y0: 0, r: .12, h: 3.2 });
      return 3.8;
    },
    lamp(P, g, it, bd){
      P(g, { s: 'cyl', y: 1.4, r: .07, h: 2.8, c: '#374151' }); P(g, { s: 'box', y: 2.85, z: .1, w: .55, h: .4, d: .5, rx: .35, c: '#1f2937' });
      P(g, { s: 'cyl', y: 2.82, z: .37, r: .2, h: .04, rx: PI / 2 + .35, c: '#fef9c3', m: 'glow' });
      bd.push({ t: 'cyl', y0: 0, r: .14, h: 3 });
      return 3.4;
    },
    bags(P, g, it, bd){
      for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) P(g, { s: 'box', x: -1 + i + (r ? .5 : 0) - .25, y: .22 + r * .38, w: .95, h: .38, d: .7, c: '#b7a37a' });
      bd.push({ t: 'box', y0: 0, w: 3, h: .8, d: .75 });
      return 1;
    },
    crates(P, g, it, bd){
      P(g, { s: 'box', x: -.2, y: .35, z: -.1, w: .7, h: .7, d: .7, c: '#a16207' }); P(g, { s: 'box', x: .25, y: .3, z: .25, w: .55, h: .6, d: .55, c: '#854d0e' });
      P(g, { s: 'box', x: -.1, y: .95, z: -.05, w: .5, h: .5, d: .5, c: '#ca8a04' });
      bd.push({ t: 'box', y0: 0, w: 1.2, h: 1.2, d: 1.2 });
      return 1.4;
    },
  };
  // Забор: столбик в клетке + перемычки к соседям (справа и спереди — каждая один раз)
  const WALL_ST = [
    { post: [.22, 1.05, '#8b5a2b'], rail: '#c9965f', rails: [.35, .78], th: .07 },
    { post: [.52, 1.15, '#a8a29e'], seg: [.38, .95, '#9ca3af'] },
    { post: [.52, 1.25, '#9a3412'], seg: [.4, 1.05, BRICK], cap: '#e5e7eb' },
    { post: [.3, 1.35, '#334155'], bars: '#475569' },
    { post: [.5, 1.45, '#ca8a04'], seg: [.36, 1.1, '#fde68a'], tip: GOLD },
  ];
  // Стены военной базы: мешки → бетон → бетон с колючкой → сталь → укреплённая с золотом
  const WALL_WST = [
    { post: [.5, .95, '#a08a5c'], seg: [.5, .8, '#b7a37a'] },
    { post: [.55, 1.2, '#9ca3af'], seg: [.42, 1.05, '#a8a29e'], cap: '#6b7280' },
    { post: [.6, 1.35, '#78716c'], seg: [.45, 1.2, '#8b8f99'], cap: '#4b5563', bars2: '#374151' },
    { post: [.42, 1.45, '#334155'], seg: [.34, 1.3, '#475569'], cap: '#1f2937' },
    { post: [.6, 1.6, '#57534e'], seg: [.48, 1.42, '#6b7280'], cap: '#ca8a04', tip: GOLD },
  ];
  function drawWall(P, g, it, bd, nb, ST = WALL_ST){
    const st = ST[Math.max(1, it.l) - 1], [pw, ph, pc] = st.post;
    P(g, { s: 'box', y: ph / 2, w: pw, h: ph, d: pw, c: pc });
    if (st.cap) P(g, { s: 'box', y: ph + .05, w: pw + .1, h: .1, d: pw + .1, c: st.cap });
    if (st.tip) P(g, { s: 'ico', y: ph + .14, r: .14, c: st.tip, m: 'glow', det: 0 });
    bd.push({ t: 'box', y0: 0, w: Math.max(.5, pw), h: ph, d: Math.max(.5, pw) });
    for (const [dx, dz] of nb) {   // к соседу (в системе участка — без поворота)
      const mx = dx * CELL / 2, mz = dz * CELL / 2, along = dx ? 'x' : 'z';
      if (st.rails) for (const y of st.rails) P(g, { s: 'box', x: mx, y, z: mz, w: along === 'x' ? CELL : st.th, h: .08, d: along === 'z' ? CELL : st.th, c: st.rail });
      if (st.seg) P(g, { s: 'box', x: mx, y: st.seg[1] / 2, z: mz, w: along === 'x' ? CELL : st.seg[0], h: st.seg[1], d: along === 'z' ? CELL : st.seg[0], c: st.seg[2] });
      if (st.bars) for (let k = -2; k <= 2; k++) P(g, { s: 'box', x: mx + (along === 'x' ? k * .3 : 0), y: .65, z: mz + (along === 'z' ? k * .3 : 0), w: .06, h: 1.3, d: .06, c: st.bars });
      if (st.bars) P(g, { s: 'box', x: mx, y: 1.22, z: mz, w: along === 'x' ? CELL : .08, h: .08, d: along === 'z' ? CELL : .08, c: st.bars });
      if (st.bars2) P(g, { s: 'box', x: mx, y: st.seg[1] + .12, z: mz, w: along === 'x' ? CELL : .05, h: .05, d: along === 'z' ? CELL : .05, c: st.bars2 });   // колючка
      bd.push({ t: 'box', x: mx, z: mz, y0: 0, w: along === 'x' ? CELL : .4, h: Math.max(.9, (st.seg?.[1]) || 1), d: along === 'z' ? CELL : .4 });
    }
    return ph + .4;
  }
  // Мебель (клетка 0,8): система предмета — центр, перед (куда садятся/смотрят) — +z
  const FDRAW = {
    bed(P, g, it, bd){ P(g, { s: 'box', y: .2, w: 1.5, h: .3, d: 2.3, c: WOOD_D }); P(g, { s: 'box', y: .42, w: 1.4, h: .16, d: 2.15, c: '#f8fafc' }); P(g, { s: 'box', y: .52, z: .35, w: 1.42, h: .1, d: 1.4, c: PAL[it.i % PAL.length] }); P(g, { s: 'box', y: .56, z: -.82, w: 1.1, h: .14, d: .38, c: '#fff' }); P(g, { s: 'box', y: .6, z: -1.12, w: 1.5, h: 1, d: .1, c: WOOD_D }); bd.push({ t: 'box', y0: 0, w: 1.5, h: .55, d: 2.3 }); },
    sofa(P, g, it, bd, x){ const c = PAL[(it.i + 1) % PAL.length]; P(g, { s: 'box', y: .25, z: .05, w: 2.3, h: .4, d: .7, c }); P(g, { s: 'box', y: .62, z: -.28, w: 2.3, h: .5, d: .16, c }); for (const s of [-1, 1]) P(g, { s: 'box', x: s * 1.08, y: .45, z: .02, w: .16, h: .4, d: .72, c }); bd.push({ t: 'box', y0: 0, w: 2.3, h: .45, d: .7 }); x.seats = [[-.5, .08, .5], [.5, .08, .5]]; },
    chair(P, g, it, bd, x){ P(g, { s: 'box', y: .45, w: .55, h: .08, d: .55, c: WOOD }); P(g, { s: 'box', y: .8, z: -.24, w: .55, h: .6, d: .07, c: WOOD }); for (const [lx, lz] of [[-.22, -.22], [.22, -.22], [-.22, .22], [.22, .22]]) P(g, { s: 'box', x: lx, y: .21, z: lz, w: .06, h: .42, d: .06, c: WOOD_D }); bd.push({ t: 'box', y0: 0, w: .5, h: .9, d: .5 }); x.seats = [[0, 0, .5]]; },
    table(P, g, it, bd){ P(g, { s: 'box', y: .74, w: 1.4, h: .07, d: 1.4, c: WOOD }); for (const [lx, lz] of [[-.6, -.6], [.6, -.6], [-.6, .6], [.6, .6]]) P(g, { s: 'box', x: lx, y: .36, z: lz, w: .08, h: .72, d: .08, c: WOOD_D }); P(g, { s: 'cyl', y: .82, r: .14, h: .1, c: '#fde68a' }); bd.push({ t: 'box', y0: 0, w: 1.4, h: .78, d: 1.4 }); },
    rug(P, g, it){ P(g, { s: 'box', y: .01, w: 2.3, h: .02, d: 2.3, c: PAL[(it.i + 3) % PAL.length] }); P(g, { s: 'box', y: .015, w: 1.7, h: .02, d: 1.7, c: '#fef3c7' }); P(g, { s: 'box', y: .02, w: 1.2, h: .02, d: 1.2, c: PAL[(it.i + 5) % PAL.length] }); },
    lamp(P, g, it, bd){ P(g, { s: 'cyl', y: .04, r: .18, h: .08, c: DARK }); P(g, { s: 'cyl', y: .8, r: .03, h: 1.5, c: DARK }); P(g, { s: 'cone', y: 1.62, r: .26, h: .32, seg: 12, c: '#fde68a' }); P(g, { s: 'ball', y: 1.5, r: .1, c: '#fff6c8', m: 'glow', seg: 8 }); bd.push({ t: 'cyl', y0: 0, r: .14, h: 1.6 }); },
    plant(P, g, it, bd){ P(g, { s: 'cyl', y: .22, r: .2, r2: .26, h: .44, c: '#b45309' }); P(g, { s: 'ico', y: .72, r: .34, c: '#3f9a4c', det: 1 }); bd.push({ t: 'cyl', y0: 0, r: .25, h: .9 }); },
    shelf(P, g, it, bd){ P(g, { s: 'box', y: .9, z: -.08, w: 1.5, h: 1.8, d: .4, c: WOOD_D }); for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) P(g, { s: 'box', x: -.6 + i * .24, y: .35 + row * .55, z: .02, w: .16, h: .38 - (i % 3) * .05, d: .26, c: PAL[(i + row * 2 + it.i) % PAL.length] }); bd.push({ t: 'box', y0: 0, z: -.08, w: 1.5, h: 1.8, d: .4 }); },
    wardrobe(P, g, it, bd){ P(g, { s: 'box', y: 1.05, z: -.05, w: 1.5, h: 2.1, d: .55, c: '#f5e6d3' }); P(g, { s: 'box', y: 1.1, z: .24, w: .62, h: 1.6, d: .02, c: '#dbeafe', m: 'glow' }); for (const s of [-1, 1]) P(g, { s: 'box', x: s * .5, y: 1.1, z: .24, w: .05, h: .25, d: .05, c: GOLD }); bd.push({ t: 'box', y0: 0, z: -.05, w: 1.5, h: 2.1, d: .55 }); },
    tv(P, g, it, bd, x){ P(g, { s: 'box', y: .3, z: -.05, w: 1.5, h: .6, d: .5, c: DARK }); P(g, { s: 'box', y: 1.15, z: -.15, w: 1.45, h: .85, d: .08, c: '#111827' }); const m = new x.T.Mesh(x.R.K.geo('mbtv', () => new x.T.PlaneGeometry(1.33, .75)), x.tvMat()); m.position.set(0, 1.15, -.1); m.userData.dyn = true; g.add(m); bd.push({ t: 'box', y0: 0, z: -.05, w: 1.5, h: 1.6, d: .5 }); },
    fire(P, g, it, bd){ P(g, { s: 'box', y: .6, z: -.1, w: 1.5, h: 1.2, d: .5, c: '#a8a29e' }); P(g, { s: 'box', y: 1.25, z: -.05, w: 1.7, h: .1, d: .62, c: WOOD_D }); P(g, { s: 'box', y: .42, z: .1, w: .8, h: .6, d: .2, c: '#1c1917' }); for (const [fx, fh] of [[-.15, .32], [.05, .42], [.2, .28]]) P(g, { s: 'cone', x: fx, y: .3 + fh / 2, z: .1, r: .1, h: fh, seg: 6, c: '#fb923c', m: 'glow' }); bd.push({ t: 'box', y0: 0, z: -.1, w: 1.5, h: 1.25, d: .5 }); },
    aqua(P, g, it, bd, x){ P(g, { s: 'box', y: .35, w: 1.5, h: .7, d: .6, c: WOOD_D }); P(g, { s: 'box', y: 1.05, w: 1.4, h: .7, d: .5, m: x.glass() }); for (let i = 0; i < 4; i++) P(g, { s: 'box', x: -.45 + i * .3, y: .9 + (i % 2) * .2, z: (i % 2) * .1 - .05, w: .14, h: .08, d: .04, c: ['#fb923c', '#facc15', '#f472b6', '#38bdf8'][i], m: 'glow' }); P(g, { s: 'box', y: .74, w: 1.38, h: .06, d: .48, c: '#fde68a' }); bd.push({ t: 'box', y0: 0, w: 1.5, h: 1.4, d: .6 }); },
    chess(P, g, it, bd, x){
      P(g, { s: 'cyl', y: .36, r: .07, h: .72, c: WOOD_D }); P(g, { s: 'box', y: .74, w: .9, h: .06, d: .9, c: WOOD_D });
      const top = new x.T.Mesh(x.R.K.geo('mbchess', () => new x.T.PlaneGeometry(.78, .78)), x.boardMat()); top.rotation.x = -PI / 2; top.position.y = .775; top.userData.dyn = true; g.add(top);
      for (const s of [-1, 1]) { const cz = s * .95, gg = x.R.group(g, 0, 0, cz, s > 0 ? PI : 0); FDRAW.chair(P, gg, it, [], {}); }
      bd.push({ t: 'cyl', y0: 0, r: .5, h: .8 }, { t: 'box', z: -.95, y0: 0, w: .5, h: .9, d: .5 }, { t: 'box', z: .95, y0: 0, w: .5, h: .9, d: .5 });
      x.seats = [[0, -.95, .5, 0], [0, .95, .5, PI]];
      x.table = 'chess';
    },
    arcade(P, g, it, bd, x){ P(g, { s: 'box', y: .9, z: -.05, w: .7, h: 1.8, d: .6, c: '#7c3aed' }); P(g, { s: 'box', y: 1.25, z: .26, w: .55, h: .45, d: .02, c: '#22d3ee', m: 'glow' }); P(g, { s: 'box', y: .85, z: .32, w: .6, h: .08, d: .3, c: DARK }); P(g, { s: 'cyl', x: -.12, y: .95, z: .35, r: .03, h: .14, c: '#ef4444' }); P(g, { s: 'ball', x: .14, y: .91, z: .36, r: .04, c: '#facc15' }); P(g, { s: 'box', y: 1.72, z: .2, w: .7, h: .16, d: .2, c: '#facc15', m: 'glow' }); bd.push({ t: 'box', y0: 0, z: -.05, w: .7, h: 1.8, d: .6 }); },
  };

  // ═══ Общее для района и военных баз (браузер): материалы и склейка, геометрия участка ═══
  // Геометрия участка: N клеток по cell (район — 12, база — 32); центр постройки и клетка под точкой — в системе участка
  function geo(Rr, n, cell){
    const half = n * cell / 2;
    return { Rr, N: n, CELL: cell, HALF: half,
      itemCenter: it => { const [w, d] = Rr.fp(it.k, it.r); return [-half + (it.x + w / 2) * cell, -half + (it.z + d / 2) * cell]; },
      cellAt: (lx, lz, w = 1, d = 1) => [Math.round((lx + half) / cell - w / 2), Math.round((lz + half) / cell - d / 2)] };
  }
  const GD = geo(Rules, N, CELL), GW = geo(WRules, WAR.n, CELL);
  // Материалы склейки (цвет — в вершинах) и сама склейка: все детали группы → по одной сетке на «цветной», «светящийся» и особые
  function makeMats(R){
    const T = R.T, low = R.q === 'low';
    const M = {
      T, low,
      std: low ? new T.MeshLambertMaterial({ vertexColors: true }) : new T.MeshStandardMaterial({ vertexColors: true, roughness: .82, metalness: 0, envMapIntensity: .65 }),
      glow: new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      ghostOk: new T.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: .45, depthWrite: false }),
      ghostBad: new T.MeshBasicMaterial({ color: '#f87171', transparent: true, opacity: .45, depthWrite: false }),
      sel: new T.MeshBasicMaterial({ color: '#fde047', transparent: true, opacity: .35, depthWrite: false }),
      glassM: null, boardM: null,
    };
    M.glass = () => M.glassM || (M.glassM = new T.MeshStandardMaterial({ color: '#7dd3fc', transparent: true, opacity: .35, roughness: .1, depthWrite: false }));
    M.boardMat = () => M.boardM || (M.boardM = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) % 2 ? '#7c4a26' : '#f2dcb3'; g.fillRect(i * 16, j * 16, 16, 16); } const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return new T.MeshBasicMaterial({ map: t, toneMapped: false }); })());
    // Склейка пишет вершины сразу в итоговые массивы (без копий каждой детали): положение — float32, нормаль — int8, цвет — uint16
    // (21 байт на вершину вместо 36). mergeGen — по кусочку: over() → true — пора отдать кадр (yield). После склейки пустые группы
    // убираются из сцены (иначе их обходят каждый кадр: матрицы и отсечение — это и было «+3 мс» у 12 баз на телефоне)
    const m4 = new T.Matrix4(), inv = new T.Matrix4(), nm3 = new T.Matrix3(), TP = new Float64Array(9), TN = new Float64Array(9), TI = [0, 0, 0], BB = new Float64Array(6);
    const LM = new T.Matrix4(), MW = new T.Matrix4(), V3 = new T.Vector3(), S3 = new T.Vector3(), Q4 = new T.Quaternion(), EU = new T.Euler();
    // Запись детали без THREE.Mesh (вид военной базы — тысячи деталей: меньше мусора и пауз сборщика): геометрия и материал — те же,
    // что дал бы R.part (кэш по описанию детали), место — в списке группы (userData.rec). Возврат — общая ручка «последней детали»:
    // position/scale/rotation.set сразу после вызова (крыша казармы), как у сетки
    const specs = new Map(), scratch = new T.Group();
    const plainOf = mat => !mat.map && !mat.transparent && !(mat.metalness > .01) && !(mat.emissive && mat.emissive.r + mat.emissive.g + mat.emissive.b > 0);
    function specOf(o){
      const mm = o.m, key = `${o.s || 'box'}|${o.w}|${o.h}|${o.d}|${o.r}|${o.r2}|${o.seg}|${o.det}|${o.t}|${o.arc}|${o.c}|${mm && typeof mm === 'object' ? mm.uuid : mm}|${o.flat ? 1 : 0}|${o.rough}|${o.metal}|${o.emissive}|${o.wave}`;
      let s = specs.get(key);
      if (!s) {
        const mesh = R.part(scratch, o); scratch.remove(mesh);
        const mat = mesh.material, g = mesh.geometry, plain = !Array.isArray(mat) && plainOf(mat);
        s = { geo: g, mat, n: g.index ? g.index.count : g.attributes.position.count, plain, key: plain ? (mat.isMeshBasicMaterial ? 'glow' : 'std') : mat };
        specs.set(key, s);
      }
      return s;
    }
    const HND = { r: null, userData: {}, position: { set(x, y, z){ const r = HND.r; r.x = x; r.y = y; r.z = z; } }, scale: { set(x, y, z){ const r = HND.r; r.sx = x; r.sy = y; r.sz = z; } }, rotation: { set(x, y, z){ const r = HND.r; r.rx = x; r.ry = y; r.rz = z; } } };
    M.rec = (g, o) => {
      if (o.dyn) return R.part(g, o);
      const r = { s: specOf(o), g: null, x: o.x || 0, y: o.y || 0, z: o.z || 0, rx: o.rx || 0, ry: o.yaw || 0, rz: o.rz || 0, sx: o.sx || 1, sy: o.sy || 1, sz: o.sz || 1 };
      (g.userData.rec || (g.userData.rec = [])).push(r);
      HND.r = r;
      return HND;
    };
    // Одна деталь → в итоговые массивы с места k (по треугольникам); нижние грани на земле (смотрят вниз, y ≈ 0) не пишутся — их не
    // видно никогда (≈ 15 % треугольников у построек на земле). Деталь — сетка или запись (M.rec). Возвращает новое k
    function writePart(o, pos, nor, col, uv, k, tk, tm){
      let g, mat, mw;
      if (o.isMesh) { g = o.geometry; mat = o.material; mw = o.matrixWorld; }
      else { g = o.s.geo; mat = o.s.mat; LM.compose(V3.set(o.x, o.y, o.z), Q4.setFromEuler(EU.set(o.rx, o.ry, o.rz)), S3.set(o.sx, o.sy, o.sz)); mw = MW.multiplyMatrices(o.g.matrixWorld, LM); }
      m4.multiplyMatrices(inv, mw); nm3.getNormalMatrix(m4);
      const e = m4.elements, q = nm3.elements, idx = g.index ? g.index.array : null, P = g.attributes.position.array;
      const Na = g.attributes.normal ? g.attributes.normal.array : null, U = g.attributes.uv ? g.attributes.uv.array : null, flat = !!mat.flatShading || !Na;
      const n = idx ? idx.length : P.length / 3, c = mat.color;
      const cr = col ? c.r + (tk ? (tm[0] - c.r) * tk : 0) : 0, cg = col ? c.g + (tk ? (tm[1] - c.g) * tk : 0) : 0, cb = col ? c.b + (tk ? (tm[2] - c.b) * tk : 0) : 0;
      for (let t = 0; t + 2 < n; t += 3) {
        for (let s = 0; s < 3; s++) {
          const vi = TI[s] = idx ? idx[t + s] : t + s, px = P[vi * 3], py = P[vi * 3 + 1], pz = P[vi * 3 + 2], j = s * 3;
          TP[j] = e[0] * px + e[4] * py + e[8] * pz + e[12]; TP[j + 1] = e[1] * px + e[5] * py + e[9] * pz + e[13]; TP[j + 2] = e[2] * px + e[6] * py + e[10] * pz + e[14];
          if (!flat) {
            const ax = Na[vi * 3], ay = Na[vi * 3 + 1], az = Na[vi * 3 + 2];
            let nx = q[0] * ax + q[3] * ay + q[6] * az, ny = q[1] * ax + q[4] * ay + q[7] * az, nz = q[2] * ax + q[5] * ay + q[8] * az;
            const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; TN[j] = nx / l; TN[j + 1] = ny / l; TN[j + 2] = nz / l;
          }
        }
        if (flat) {   // грань (как computeVertexNormals у несвязной сетки): (C − B) × (A − B)
          const ux = TP[6] - TP[3], uy = TP[7] - TP[4], uz = TP[8] - TP[5], wx = TP[0] - TP[3], wy = TP[1] - TP[4], wz = TP[2] - TP[5];
          let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
          const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
          TN[0] = TN[3] = TN[6] = nx; TN[1] = TN[4] = TN[7] = ny; TN[2] = TN[5] = TN[8] = nz;
        }
        if (TN[1] < -.95 && TN[4] < -.95 && TN[7] < -.95 && Math.abs(TP[1]) < .06 && Math.abs(TP[4]) < .06 && Math.abs(TP[7]) < .06) continue;
        for (let s = 0; s < 3; s++, k++) {
          const j = k * 3, i = s * 3, ny = TN[i + 1], y = TP[i + 1], x = TP[i], z = TP[i + 2];
          pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
          if (x < BB[0]) BB[0] = x; if (x > BB[3]) BB[3] = x; if (y < BB[1]) BB[1] = y; if (y > BB[4]) BB[4] = y; if (z < BB[2]) BB[2] = z; if (z > BB[5]) BB[5] = z;
          nor[j] = Math.round(TN[i] * 127); nor[j + 1] = Math.round(ny * 127); nor[j + 2] = Math.round(TN[i + 2] * 127);
          if (U && uv) { uv[k * 2] = U[TI[s] * 2]; uv[k * 2 + 1] = U[TI[s] * 2 + 1]; }
          if (col) {
            const a = Math.abs(ny) < .6 ? .62 + .38 * Math.min(1, Math.max(0, y / 1.4)) : 1;
            col[j] = Math.round(Math.min(1, Math.max(0, cr * a)) * 65535); col[j + 1] = Math.round(Math.min(1, Math.max(0, cg * a)) * 65535); col[j + 2] = Math.round(Math.min(1, Math.max(0, cb * a)) * 65535);
          }
        }
      }
      return k;
    }
    M.mergeGen = function* (root, src, tint, over){
      // матрицы — своим обходом (с паузами), подвижное (userData.dyn) не трогаем
      root.updateWorldMatrix(true, false);
      if (src !== root) { src.updateMatrix(); src.matrixWorld.multiplyMatrices(src.parent.matrixWorld, src.matrix); }
      const tk = tint ? tint.k : 0, tm = tint ? tint.mix : null;
      inv.copy(root.matrixWorld).invert();
      const buckets = new Map(), drop = [], stack = [src];
      let hasDyn = false, cnt = 0;
      const bucket = (key, mat, plain) => { let b = buckets.get(key); if (!b) buckets.set(key, b = { key, mat, plain, list: [], n: 0 }); return b; };
      while (stack.length) {
        const node = stack.pop(), ch = node.children, rec = node.userData.rec;
        if (rec) for (let i = 0; i < rec.length; i++) { const r = rec[i], s = r.s; if (Array.isArray(s.mat)) continue; r.g = node; const b = bucket(s.key, s.mat, s.plain); b.list.push(r); b.n += s.n; }
        for (let i = 0; i < ch.length; i++) {
          const o = ch[i];
          if (o.userData.dyn) { hasDyn = true; continue; }
          o.updateMatrix(); o.matrixWorld.multiplyMatrices(node.matrixWorld, o.matrix);
          if (o.children.length || o.userData.rec) stack.push(o);
          if (!o.isMesh || !o.geometry?.attributes?.position) continue;
          const mat = o.material;
          if (Array.isArray(mat)) continue;
          const plain = plainOf(mat), b = bucket(plain ? (mat.isMeshBasicMaterial ? 'glow' : 'std') : mat, mat, plain);
          b.list.push(o); b.n += o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
          drop.push(o);
        }
        if (over && (++cnt & 31) === 0 && over()) yield;
      }
      const out = [];
      for (const b of buckets.values()) {
        const pos = new Float32Array(b.n * 3), nor = new Int8Array(b.n * 3), col = b.plain ? new Uint16Array(b.n * 3) : null, uv = b.plain ? null : new Float32Array(b.n * 2);
        let k = 0;
        BB[0] = BB[1] = BB[2] = Infinity; BB[3] = BB[4] = BB[5] = -Infinity;
        for (let i = 0; i < b.list.length; i++) { k = writePart(b.list[i], pos, nor, col, uv, k, tk, tm); if (over && (i & 7) === 7 && over()) yield; }
        if (!k) continue;
        const cut = (a, w) => (k < b.n ? a.slice(0, k * w) : a);   // нижние грани не записаны — хвост массивов отрезать
        const mg = new T.BufferGeometry();
        mg.setAttribute('position', new T.BufferAttribute(cut(pos, 3), 3)); mg.setAttribute('normal', new T.BufferAttribute(cut(nor, 3), 3, true));
        if (col) mg.setAttribute('color', new T.BufferAttribute(cut(col, 3), 3, true)); else mg.setAttribute('uv', new T.BufferAttribute(cut(uv, 2), 2));
        // сфера отсечения — по рамке, набранной при записи (computeBoundingSphere прошёл бы все вершины ещё дважды — долгий кадр)
        const bc = new T.Vector3((BB[0] + BB[3]) / 2, (BB[1] + BB[4]) / 2, (BB[2] + BB[5]) / 2);
        mg.boundingSphere = new T.Sphere(bc, Math.hypot(BB[3] - BB[0], BB[4] - BB[1], BB[5] - BB[2]) / 2);
        const mesh = new T.Mesh(mg, b.plain ? (b.key === 'glow' ? M.glow : M.std) : b.mat);
        mesh.userData.mbOwn = true;
        if (!low) { mesh.castShadow = b.key !== 'glow' && !b.mat?.userData?.noCast && !b.mat?.transparent; mesh.receiveShadow = b.key !== 'glow'; }
        root.add(mesh); out.push(mesh);
      }
      if (!hasDyn && src !== root) src.parent?.remove(src);   // подвижного нет — исходные детали уходят разом (без удаления по одной)
      else { drop.forEach(o => o.parent?.remove(o)); pruneEmpty(src); if (src !== root && !src.children.length) src.parent?.remove(src); }
      return out;
    };
    M.merge = (root, src, tint) => { const it = M.mergeGen(root, src, tint, null); let r = it.next(); while (!r.done) r = it.next(); return r.value; };
    M.dispose = () => { for (const m of [M.std, M.glow, M.ghostOk, M.ghostBad, M.sel, M.glassM, M.boardM]) { m?.map?.dispose(); m?.dispose(); } };
    return M;
  }
  const disposeTree = g => { g.traverse(o => { if (o.isMesh && o.userData.mbOwn) o.geometry.dispose(); }); g.parent?.remove(g); };
  // Пустые группы после склейки — из сцены (подвижное, userData.dyn, остаётся как было)
  function pruneEmpty(o){
    const ch = o.children;
    for (let i = ch.length - 1; i >= 0; i--) {
      const c = ch[i];
      if (c.userData.dyn) continue;
      if (c.children.length) pruneEmpty(c);
      if (!c.children.length && !c.isMesh && !c.isLight && !c.isPoints && !c.isLine && !c.isSprite) o.remove(c);
    }
  }
  // Тело из описания постройки: b — в системе постройки (центр cx, cz, поворот r), всё → мир по рамке участка lot
  function addBodyTo(ph, list, lot, cx, cz, r, b){
    const [lx, lz] = rotXZ(r, b.x || 0, b.z || 0), [wx, wz] = lotToWorld(lot, cx + lx, cz + lz);
    const data = { cam: !!b.cam, floor: b.floor };
    const yaw = lot.yaw + r * PI / 2 + (b.yaw || 0);
    const c = b.t === 'cyl' ? ph.addCyl({ x: wx, z: wz, y: b.y0 + b.h / 2, r: b.r, hy: b.h / 2, tag: 'mb', data })
      : b.t === 'wedge' ? ph.addWedge({ x: wx, z: wz, y: b.y0 + b.h / 2, hx: b.w / 2, hy: b.h / 2, hz: b.d / 2, yaw, tag: 'mb', data })   // скат крыши: низ — у локальной +z
      : ph.addBox({ x: wx, z: wz, y: b.y0 + b.h / 2, hx: b.w / 2, hy: b.h / 2, hz: b.d / 2, yaw, tag: 'mb', data });
    list.push(c);
    return c;
  }

  // ═══ Стройка — общая для района и базы: призрак, сетка, рамка выбора, каталог, карточка постройки ═══
  // B — менеджер (B.bm — стройка, B.cam — точка обзора, B.me — своё состояние); C — что отличается:
  //   { attr: 'mb' | 'wb', G (геометрия), D (каталог), tabs (вкладки [ключ, [виды]]), q (поиск в своём HUD), view() — вид своего участка
  //   ({ lot, house? }), room — комната дома (только район), act(a, g, o), wallet(), local(), sfx, toast, why(r), lock(k)?, info(it, lines, acts)? }
  function makeBuilder(S, B, C){
    const R = S.R, T = R.T, M = B.M, G = C.G, Rr = G.Rr, D = C.D;
    const RM = C.room;   // { IN, ICELL, IHALF, DOOR, FURN, FDRAW, furnCenter, icellAt, inHouse() }
    const P = (g, o) => R.part(g, o);
    const xctx = () => ({ T, R, war: !!C.war, color: C.color?.(), glass: M.glass, tvMat: C.tvMat || (() => M.glow), boardMat: M.boardMat });
    function onMyLot(){
      const v = C.view(); if (!v || !S.P) return false;
      const [lx, lz] = worldToLot(v.lot, S.P.ch.x, S.P.ch.z);
      return Math.abs(lx) < G.HALF + 2.5 && Math.abs(lz) < G.HALF + 2.5;
    }
    const inHouse = () => !!(RM && RM.inHouse());
    function enter(){
      if (!B.me) return false;
      const v = C.view();
      if (!v) { C.toast(C.far || 'Подойди к своему участку'); return false; }
      const room = inHouse() && !!v.house;
      if (!room && !onMyLot()) { C.toast(C.far || 'Подойди к своему участку'); return false; }
      if (S.mySeat) S.P.standUp();
      const rig = S.rig;
      if (rig.mode === 'first') { rig.toggle(); S.H.crosshair(false); }
      B.bm = { room, tab: room ? 'f' : C.tabs[0][0], tool: null, sel: null, save: { pitch: rig.pitch, dist: rig.dist, maxD: rig.maxD, minP: rig.minP } };
      let cx, cz;
      if (room) { const h = v.house; [cx, cz] = lotToWorld(v.lot, h.cx, h.cz); rig.maxD = 15; rig.dist = 11; rig.pitch = 1.08; h.roof.visible = false; }
      else { [cx, cz] = lotToWorld(v.lot, 0, 1); rig.maxD = C.camMax || 40; rig.dist = C.camDist || 25; rig.pitch = .98; }
      rig.minP = .5;
      B.cam = { x: cx, y: room ? .6 : 2, z: cz };
      S.P.enabled = false;
      grid(true);
      C.renderHud(); renderCat(); renderSel();
      C.sfx('click');
      return true;
    }
    function exit(){
      if (!B.bm) return;
      const rig = S.rig, s = B.bm.save;
      rig.pitch = s.pitch; rig.dist = s.dist; rig.maxD = S.inside ? 9 : s.maxD; rig.minP = S.inside ? .55 : s.minP;
      if (B.bm.room && !S.inside) { const v = C.view(); if (v?.house) v.house.roof.visible = true; }
      B.bm = null; B.cam = null; S.P.enabled = true;
      ghostOff(); grid(false); selBox(null);
      C.renderHud();
    }
    const listOf = room => (room ? B.me.room : B.me.layout);
    const fpOf = (room, k, r) => (room ? Rules.ffp(k, r) : Rr.fp(k, r));
    const sizeN = room => (room ? RM.IN : G.N);
    function pickTool(k){
      const bm = B.bm; if (!bm) return;
      const D0 = bm.room ? RM.FURN[k] : D[k]; if (!D0) return;
      bm.sel = null;
      const box = bm.room ? [0, RM.IN] : Rr.boxOf(B.me), mid = (box[0] + box[1]) >> 1;
      const p = bm.lastCell || [mid, mid];
      bm.tool = { k, r: 0, x: p[0], z: p[1], move: 0 };
      fitTool();
      renderSel(); updGhost();
    }
    function startMove(){
      const bm = B.bm, it = listOf(bm?.room)?.find(e => e.i === bm.sel); if (!it) return;
      bm.tool = { k: it.k, r: it.r, x: it.x, z: it.z, move: it.i };
      renderSel(); updGhost();
    }
    function rotate(){
      const bm = B.bm; if (!bm) return;
      if (bm.tool) { bm.tool.r = (bm.tool.r + 1) & 3; fitTool(); updGhost(); C.sfx('click'); return; }
      const it = listOf(bm.room).find(e => e.i === bm.sel); if (!it) return;
      const [w, d] = fpOf(bm.room, it.k, (it.r + 1) & 3);
      // поворот на месте; не помещается — сдвигаем внутрь
      const [lo, hi] = bm.room ? [0, RM.IN] : Rr.boxOf(B.me), x = Math.max(lo, Math.min(hi - w, it.x)), z = Math.max(lo, Math.min(hi - d, it.z));
      C.act(bm.room ? 'fmove' : 'move', { id: it.i, x, z, r: (it.r + 1) & 3 });
    }
    function remove(){
      const bm = B.bm; if (!bm?.sel) return;
      if (bm.room) { C.act('fremove', { id: bm.sel }); bm.sel = null; renderSel(); return; }
      const it = B.me.layout.find(e => e.i === bm.sel); if (!it) return;
      if (!Rr.isDeco(it.k)) { C.toast(WHY.fixed, false); return; }
      C.act('remove', { id: bm.sel }); bm.sel = null; renderSel();
    }
    function fitTool(){
      const bm = B.bm, t = bm?.tool; if (!t) return;
      const [w, d] = fpOf(bm.room, t.k, t.r), [lo, hi] = bm.room ? [0, RM.IN] : Rr.boxOf(B.me);
      t.x = Math.max(lo, Math.min(hi - w, t.x)); t.z = Math.max(lo, Math.min(hi - d, t.z));
    }
    function toolCheck(){
      const bm = B.bm, t = bm.tool, now = C.now();
      if (t.move) return Rr.act(Rr.clone(B.me), bm.room ? 'fmove' : 'move', { id: t.move, x: t.x, z: t.z, r: t.r }, now);
      if (bm.room) return Rr.act(Rr.clone(B.me), 'fplace', { k: t.k, x: t.x, z: t.z, r: t.r }, now, C.local() ? undefined : C.wallet());
      return Rr.canPlace(B.me, t.k, t.x, t.z, t.r, now, C.local() ? undefined : C.wallet());
    }
    async function confirmTool(){
      const bm = B.bm, t = bm?.tool; if (!t) return;
      const room = bm.room;
      if (t.move) { const r = await C.act(room ? 'fmove' : 'move', { id: t.move, x: t.x, z: t.z, r: t.r }); if (r?.ok !== false && B.bm === bm) { bm.tool = null; ghostOff(); bm.sel = t.move; renderSel(); } return; }
      const D0 = room ? RM.FURN[t.k] : D[t.k];
      const coin = room ? D0.coins > 0 && !(B.me.own['f:' + t.k] > B.me.room.filter(e => e.k === t.k).length) : D0.coins > 0 && !(B.me.own[t.k] > Rr.count(B.me.layout, t.k));
      if (coin && C.local()) { C.toast(WHY.local, false); return; }
      if (coin && !confirm(`Купить «${D0.n}» за ${D0.coins} 🪙?`)) return;
      const r = await C.act(room ? 'fplace' : 'place', { k: t.k, x: t.x, z: t.z, r: t.r }, { k: t.k });
      if (r?.ok === false || B.bm !== bm) return;
      // заборы и украшения — ставим дальше тем же; постройки — по одной
      const again = !room && (t.k === 'wall' || Rr.isDeco(t.k)) && !D0.coins;
      if (!again) { bm.tool = null; ghostOff(); }
      else updGhost();
      renderSel();
    }
    function cancel(){ const bm = B.bm; if (bm?.tool) { bm.tool = null; ghostOff(); renderSel(); } else if (bm?.sel) { bm.sel = null; renderSel(); } }

    // ── Призрак, сетка, рамка выбора ──
    let ghost = null, ghostSig = '', gridW = null, selM = null;
    function ghostOff(){ if (ghost) { ghost.parent?.remove(ghost); ghost = null; ghostSig = ''; } }
    function frameOf(room){
      const v = C.view(); if (!v) return null;
      if (!room) return { lot: v.lot, base: (lx, lz) => [lx, lz], v };
      const h = v.house; if (!h) return null;
      return { lot: v.lot, base: (hx, hz) => { const [a, b] = rotXZ(h.r, hx, hz); return [h.cx + a, h.cz + b]; }, v, h };
    }
    function updGhost(){
      const bm = B.bm, t = bm?.tool, F = frameOf(bm?.room); if (!t || !F) { ghostOff(); return; }
      const res = toolCheck(), ok = res.ok;
      const sig = t.k + '|' + t.r + '|' + ok;
      if (sig !== ghostSig) {
        ghostOff(); ghostSig = sig;
        ghost = new T.Group(); ghost.renderOrder = 5;
        const inner = R.group(ghost, 0, bm.room ? .12 : 0, 0, t.r * PI / 2), x = xctx();
        const it = { i: 0, k: t.k, x: 0, z: 0, r: t.r, l: 1 };
        if (bm.room) RM.FDRAW[t.k]?.(P, inner, it, [], x);
        else if (t.k === 'wall') drawWall(P, inner, it, [], [], C.wallST);
        else (C.draw?.[t.k] || DRAW[t.k])?.(P, inner, it, [], x);
        const [w, d] = fpOf(bm.room, t.k, t.r), cs = bm.room ? RM.ICELL : G.CELL;
        R.part(ghost, { s: 'box', y: bm.room ? .14 : .06, w: w * cs - .06, h: .04, d: d * cs - .06, m: ok ? M.ghostOk : M.ghostBad });
        ghost.traverse(o => { if (o.isMesh) { o.material = ok ? M.ghostOk : M.ghostBad; o.castShadow = false; o.renderOrder = 5; } if (o.isSprite) o.visible = false; });
        ghost.rotation.y = F.lot.yaw;
        R.scene.add(ghost);
      }
      const [cx, cz] = bm.room ? RM.furnCenter(t) : G.itemCenter(t), [lx, lz] = F.base(cx, cz), [wx, wz] = lotToWorld(F.lot, lx, lz);
      ghost.position.set(wx, 0, wz);
      ghost.rotation.y = F.lot.yaw + (bm.room ? F.h.r * PI / 2 : 0);
      bm.why = ok ? '' : C.why(res);
      const gb = C.q('.mb-ghost .mb-why'); if (gb && gb.textContent !== bm.why) gb.textContent = bm.why;
    }
    function grid(on){
      if (gridW) { R.scene.remove(gridW); gridW.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } }); gridW = null; }
      if (!on || !B.bm) return;
      const room = B.bm.room, F = frameOf(room); if (!F) return;
      const n = sizeN(room), cs = room ? RM.ICELL : G.CELL, px = n > 16 ? 16 : 32, c = document.createElement('canvas'); c.width = c.height = n * px;
      const g = c.getContext('2d');
      // база: за открытой частью и на занятых клетках — темнее (сюда не строят)
      if (!room && C.war) {
        const [lo, hi] = Rr.boxOf(B.me);
        g.fillStyle = 'rgba(0,0,0,.42)'; g.fillRect(0, 0, n * px, n * px); g.clearRect(lo * px, lo * px, (hi - lo) * px, (hi - lo) * px);
        g.fillStyle = 'rgba(239,68,68,.3)'; for (const [bx, bz, bw, bd] of WAR.block) g.fillRect(bx * px, bz * px, bw * px, bd * px);
      }
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2;
      for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * px, 0); g.lineTo(i * px, n * px); g.stroke(); g.beginPath(); g.moveTo(0, i * px); g.lineTo(n * px, i * px); g.stroke(); }
      if (room) { g.fillStyle = 'rgba(239,68,68,.28)'; g.fillRect(RM.DOOR[0] * px, RM.DOOR[2] * px, (RM.DOOR[1] - RM.DOOR[0]) * px, (RM.DOOR[3] - RM.DOOR[2]) * px); }
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding;
      const mesh = new T.Mesh(new T.PlaneGeometry(n * cs, n * cs), new T.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
      mesh.rotation.x = -PI / 2; mesh.renderOrder = 4;
      const [lx, lz] = F.base(0, 0), [wx, wz] = lotToWorld(F.lot, lx, lz);
      gridW = new T.Group();
      gridW.position.set(wx, room ? .135 : .07, wz); gridW.rotation.y = F.lot.yaw + (room ? F.h.r * PI / 2 : 0); gridW.add(mesh);
      R.scene.add(gridW);
    }
    function selBox(it){
      if (selM) { R.scene.remove(selM); selM = null; }
      const bm = B.bm, F = bm && frameOf(bm.room); if (!it || !F) return;
      const [w, d] = fpOf(bm.room, it.k, it.r), cs = bm.room ? RM.ICELL : G.CELL, [cx, cz] = bm.room ? RM.furnCenter(it) : G.itemCenter(it);
      const [lx, lz] = F.base(cx, cz), [wx, wz] = lotToWorld(F.lot, lx, lz);
      selM = new T.Mesh(R.K.geo(`mbsel${w}_${d}_${cs}`, () => new T.BoxGeometry(w * cs + .1, .08, d * cs + .1)), M.sel);
      selM.position.set(wx, bm.room ? .17 : .08, wz); selM.rotation.y = F.lot.yaw + (bm.room ? F.h.r * PI / 2 : 0); selM.renderOrder = 5;
      R.scene.add(selM);
    }
    // Точка экрана → клетка (участка или комнаты)
    function pickCell(cx, cy){
      const bm = B.bm, F = frameOf(bm?.room); if (!F) return null;
      const r = R.screenRay(cx, cy), y0 = bm.room ? .12 : 0;
      if (r.dy > -1e-4) return null;
      const t = (y0 - r.oy) / r.dy, wx = r.ox + r.dx * t, wz = r.oz + r.dz * t;
      let [lx, lz] = worldToLot(F.lot, wx, wz);
      if (bm.room) { const h = F.h; [lx, lz] = rotXZ((4 - h.r) & 3, lx - h.cx, lz - h.cz); }
      return { lx, lz };
    }
    function itemAt(p){
      const bm = B.bm, room = bm.room, list = listOf(room), cs = room ? RM.ICELL : G.CELL, half = room ? RM.IHALF : G.HALF;
      const gx = Math.floor((p.lx + half) / cs), gz = Math.floor((p.lz + half) / cs);
      let hit = null;
      for (const it of list) {
        const [w, d] = fpOf(room, it.k, it.r);
        if (gx >= it.x && gx < it.x + w && gz >= it.z && gz < it.z + d && (!hit || (room && RM.FURN[hit.k]?.floor))) hit = it;
      }
      return hit;
    }
    const cellOf = (room, p, w, d) => (room ? RM.icellAt(p.lx, p.lz, w, d) : G.cellAt(p.lx, p.lz, w, d));
    function tapAt(tp){
      const bm = B.bm, p = pickCell(tp.x, tp.y); if (!p) return;
      const t = bm.tool;
      if (t) {
        const [w, d] = fpOf(bm.room, t.k, t.r), [x, z] = cellOf(bm.room, p, w, d), [lo, hi] = bm.room ? [0, RM.IN] : Rr.boxOf(B.me);
        const nx = Math.max(lo, Math.min(hi - w, x)), nz = Math.max(lo, Math.min(hi - d, z));
        const same = nx === t.x && nz === t.z;
        t.x = nx; t.z = nz; bm.lastCell = [nx, nz];
        updGhost();
        if (!S.I.touch || same) confirmTool();
        return;
      }
      const it = itemAt(p);
      bm.sel = it ? it.i : null;
      renderSel();
    }

    // ── Каталог и карточка выбранного ──
    function renderCat(){
      const bm = B.bm, me = B.me; if (!bm || !me) return;
      const tabs = bm.room ? [['f', ['🛋️ Мебель', Object.keys(RM.FURN)]]] : C.tabs;
      const cur = tabs.find(([k]) => k === bm.tab) || tabs[0];
      const t = Rr.th(me);
      C.q('.mb-tabs').innerHTML = tabs.map(([k, [n]]) => `<button type="button" data-${C.attr}="tab:${k}"${cur[0] === k ? ' class="on"' : ''}>${n}</button>`).join('') + (bm.room ? `<span class="mb-lim">${me.room.length}/${DEFS.house.furn[Rules.houseLv(me) - 1]} предметов</span>` : `<span class="mb-lim">${C.war ? '🚩' : '🌳'} ${Rr.count(me.layout, 'deco')}/${(C.war ? WAR.deco : DECO_MAX)[t - 1]}</span>`);
      C.q('.mb-cards').innerHTML = cur[1][1].map(k => {
        const D0 = bm.room ? RM.FURN[k] : D[k];
        if (!D0) return '';
        let lock = '', cnt = '', price;
        if (bm.room) {
          const inv = (me.own['f:' + k] || 0) - me.room.filter(e => e.k === k).length;
          price = inv > 0 ? `в запасе: ${inv}` : D0.coins ? `${D0.coins} 🪙` : `${D0.cost} 🧱`;
          if (D0.coins && C.local() && inv <= 0) lock = 'после входа';
        } else {
          const lim = Rr.limit(k, t), n = Rr.count(me.layout, Rr.isDeco(k) ? 'deco' : k), inv = Rr.isDeco(k) ? (me.own[k] || 0) - Rr.count(me.layout, k) : 0;
          price = inv > 0 ? `в запасе: ${inv}` : D0.coins ? `${D0.coins} 🪙` : `${num(D0.cost[0])} 🧱`;
          if ((D0.th || 1) > t || lim <= 0) lock = `${C.war ? 'штаб' : 'ратуша'} ${Math.max(D0.th || 1, (D0.max || []).findIndex(m => m > 0) + 1)}`;
          else if (n >= lim) lock = 'макс.';
          if (!Rr.isDeco(k)) cnt = `${Rr.count(me.layout, k)}/${lim}`;
          if (D0.coins && C.local() && inv <= 0 && !lock) lock = 'после входа';
          if (!lock && C.lock) lock = C.lock(k) || '';
        }
        const poor = !lock && !price.startsWith('в запасе') && (D0.coins ? false : (bm.room ? D0.cost : D0.cost[0]) > me.bricks);
        return `<button type="button" class="mb-card${bm.tool?.k === k && !bm.tool.move ? ' on' : ''}${poor ? ' poor' : ''}" data-${C.attr}="pick:${k}"${lock ? ' disabled' : ''} title="${esc(D0.info || D0.n)}"><span class="mb-ce">${D0.e}</span><b>${esc(D0.n)}</b><span class="mb-cc">${lock ? '🔒 ' + lock : price}</span>${cnt ? `<span class="mb-cn">${cnt}</span>` : ''}</button>`;
      }).join('');
    }
    function renderSel(){
      const bm = B.bm, box = C.q('.mb-sel'), gb = C.q('.mb-ghost');
      gb.hidden = !bm?.tool;
      // полоски над каталогом: высота каталога зависит от экрана
      const catH = C.q('.mb-cat').offsetHeight || 140;
      gb.style.bottom = (catH + 16) + 'px';
      if (S.wrap.clientWidth <= 640) { box.style.bottom = (catH + 16) + 'px'; box.style.top = 'auto'; } else { box.style.bottom = ''; box.style.top = ''; }
      if (bm?.tool) { const D0 = bm.room ? RM.FURN[bm.tool.k] : D[bm.tool.k]; gb.querySelector(`[data-${C.attr}="ok"]`).textContent = bm.tool.move ? '✓ Сюда' : `✓ Поставить ${D0?.e || ''}`; }
      if (!bm || bm.tool || !bm.sel) { box.hidden = true; selBox(null); return; }
      const it = listOf(bm.room).find(e => e.i === bm.sel);
      if (!it) { bm.sel = null; box.hidden = true; selBox(null); return; }
      selBox(it);
      const now = C.now(), acts = [], A = C.attr;
      let head, body = '';
      if (bm.room) {
        const F = RM.FURN[it.k];
        head = `${F.e} ${esc(F.n)}`; body = F.info ? `<p>${esc(F.info)}</p>` : '';
        acts.push(`<button type="button" data-${A}="rot">⟳ Повернуть</button>`, `<button type="button" data-${A}="mv">✥ Переместить</button>`, `<button type="button" data-${A}="del">📦 Убрать в запас</button>`);
      } else {
        const D0 = D[it.k], t = Rr.th(B.me);
        head = `${D0.e} ${esc(D0.n)}${D0.lv > 1 ? ` · ${it.l || 0} ур.` : ''}`;
        const lines = [];
        if (D0.info) lines.push(esc(D0.info));
        if (Rr.isProd(it.k) && it.l >= 1) lines.push(`Добыча: ${D0.rate[it.l - 1]} 🧱/час · копится ${Rr.prod(it, now)}/${D0.hold[it.l - 1]}`);
        if ((it.k === 'store' || it.k === 'th') && it.l >= 1) lines.push(`Вмещает: ${num(D0.keep[it.l - 1])} 🧱`);
        if (it.k === 'house' && it.l >= 1) lines.push(`Мебели: до ${D0.furn[it.l - 1]} предметов`);
        if (D0.atk && it.l >= 1) lines.push(`⚔️ Урон ${D0.atk.dmg[it.l - 1]} за выстрел · дальность ${String(D0.atk.rng).replace('.', ',')} кл. · ${D0.atk.air ? (D0.atk.gnd ? 'земля и воздух' : 'воздух') : 'земля'}`);
        if (D0.trap && it.l >= 1) lines.push(`💥 Урон ${D0.trap.dmg[it.l - 1]} · ${D0.trap.air ? 'по летающим' : 'по наземным'} · чужим не видна`);
        if (D0.army && it.l >= 1) lines.push(`🪖 Армия: до ${D0.army[it.l - 1]} мест · отряды — в «⚔️ Набеги»`);
        if (D0.crew && it.l >= 1) lines.push(`👥 Состав: до ${D0.crew[it.l - 1]} человек`);
        if (D0.slots && it.l >= 1) lines.push(`🚗 Техники: ${D0.slots[Math.min(it.l, D0.slots.length) - 1]} мест`);
        if (D0.hp && it.l >= 1 && it.k !== 'wall') lines.push(`❤️ Прочность ${num(D0.hp[it.l - 1])}`);
        if (it.k === 'wall' && it.l >= 1 && D0.hp) lines.push(`❤️ Держит удар: ${num(D0.hp[it.l - 1])}`);
        if (it.ue) {
          lines.push(`⏳ ${it.l === 0 ? 'Строится' : 'Улучшается до ' + it.ul + ' ур.'} — осталось ${fmtT(it.ue - now)}`);
          if (!C.local()) acts.push(`<button type="button" class="ct-start" data-${A}="fin">⚡ Достроить за ${Rr.speedCost(it, now)} 🪙</button>`);
        } else if (D0.lv > it.l) {
          const nl = it.l + 1, cost = D0.cost[nl - 1], tm = D0.time[nl - 1];
          const cap = it.k !== 'th' && nl > t ? `нужен${C.war ? ' штаб' : 'а ратуша'} ${nl}` : cost > Rr.cap(B.me) ? 'построй склад побольше' : '';
          acts.push(`<button type="button" class="ct-start" data-${A}="upg"${cap ? ' disabled' : ''}>⬆ До ${nl} ур.: ${num(cost)} 🧱${tm ? ' · ' + fmtT(tm) : ''}${cap ? ' (' + cap + ')' : ''}</button>`);
        } else if (D0.lv > 1) lines.push('Самый высокий уровень ⭐');
        if (Rr.isProd(it.k) && Rr.prod(it, now) > 0) acts.push(`<button type="button" data-${A}="col">⛏️ Собрать ${Rr.prod(it, now)}</button>`);
        C.info?.(it, lines, acts);
        body = `<p>${lines.join('<br>')}</p>`;
        if (it.k !== 'wall') acts.push(`<button type="button" data-${A}="rot">⟳ Повернуть</button>`);
        acts.push(`<button type="button" data-${A}="mv">✥ Переместить</button>`);
        if (Rr.isDeco(it.k)) acts.push(`<button type="button" data-${A}="del">📦 Убрать в запас</button>`);
      }
      box.innerHTML = `<div class="mb-sh"><b>${head}</b><button type="button" class="wld-x" data-${A}="cancel" aria-label="Закрыть">✕</button></div>${body}<div class="wld-acts">${acts.join('')}</div>`;
      box.hidden = false;
      box.dataset.t = String(now);
    }
    // Шаг (WASD двигают точку обзора по участку) и кадр (призрак за мышью, нажатия)
    function update(dt){
      const bm = B.bm, C2 = S.C; if (!bm) return;
      S.P.busyUntil = S.P.now + .5;   // подсказки «[E]» молчат
      if (C2.down('rotate')) rotate();
      if (C2.down('pause')) { if (bm.tool) { bm.tool = null; ghostOff(); renderSel(); } else if (bm.sel) { bm.sel = null; renderSel(); } else exit(); }
      const m = C2.move, rig = S.rig, sp = (bm.room ? 6 : C.camSpeed || 13) * dt, fx = -Math.sin(rig.yaw), fz = -Math.cos(rig.yaw), rx = Math.cos(rig.yaw), rz = -Math.sin(rig.yaw);
      if (B.cam && (m.x || m.z)) {
        const v = C.view(); B.cam.x += (rx * m.x + fx * m.z) * sp; B.cam.z += (rz * m.x + fz * m.z) * sp;
        if (v) { let [lx, lz] = worldToLot(v.lot, B.cam.x, B.cam.z); const lim = bm.room ? 3 : G.HALF + 3, ox = bm.room ? v.house.cx : 0, oz = bm.room ? v.house.cz : 0; lx = Math.max(ox - lim, Math.min(ox + lim, lx)); lz = Math.max(oz - lim, Math.min(oz + lim, lz)); [B.cam.x, B.cam.z] = lotToWorld(v.lot, lx, lz); }
      }
    }
    function frame(t){
      const bm = B.bm; if (!bm) return;
      // призрак за мышью (на телефоне — по нажатию)
      if (bm.tool && B.ptr && !S.I.touch && B.ptr.t > (B.ptr.used || 0)) {
        B.ptr.used = B.ptr.t;
        const p = pickCell(B.ptr.x, B.ptr.y), tl = bm.tool;
        if (p) { const [w, d] = fpOf(bm.room, tl.k, tl.r), [x, z] = cellOf(bm.room, p, w, d), [lo, hi] = bm.room ? [0, RM.IN] : Rr.boxOf(B.me); tl.x = Math.max(lo, Math.min(hi - w, x)); tl.z = Math.max(lo, Math.min(hi - d, z)); bm.lastCell = [tl.x, tl.z]; }
      }
      if (bm.tool) updGhost();
      for (const tp of S.I.taps) tapAt(tp);
      S.I.taps.length = 0;
      if (t - (B.selT || 0) > 1) { B.selT = t; if (bm.sel) renderSel(); C.renderHud(); }
    }
    // Нажатия по нашим кнопкам стройки (data-mb / data-wb): true — обработано
    function click(a){
      if (a.startsWith('tab:')) { if (B.bm) { B.bm.tab = a.slice(4); renderCat(); } return true; }
      if (!B.bm) return false;
      if (a.startsWith('pick:')) pickTool(a.slice(5));
      else if (a === 'rot') rotate();
      else if (a === 'ok') confirmTool();
      else if (a === 'cancel') cancel();
      else if (a === 'upg') C.act('upgrade', { id: B.bm.sel });
      else if (a === 'fin') C.finish?.(B.bm.sel);
      else if (a === 'mv') startMove();
      else if (a === 'del') remove();
      else if (a === 'col') C.act('collect', { id: B.bm.sel });
      else return false;
      return true;
    }
    const dispose = () => { exit(); ghostOff(); grid(false); selBox(null); };
    return { enter, exit, onMyLot, inHouse, renderCat, renderSel, update, frame, click, ghostOff, grid, dispose, _: { pickCell, tapAt, toolCheck } };
  }
  // Общий HUD стройки (одни и те же классы .mb-*; атрибут кнопок — data-mb / data-wb)
  function hudHtml(A){
    return `<div class="mb-tags"></div>
      <button type="button" class="mb-fab" data-${A}="build" hidden>🔨<span> Строить</span></button>
      <div class="mb-top" hidden><span class="mb-res mbBr"></span><span class="mb-res mbBl"></span><span class="mb-res mbCo"></span><button type="button" class="mb-gift" data-${A}="gift" hidden>🎁</button><button type="button" class="mb-done" data-${A}="exit">✓ Готово</button></div>
      <div class="mb-sel" hidden></div>
      <div class="mb-ghost" hidden><span class="mb-why"></span><button type="button" data-${A}="rot" title="Повернуть (R)">⟳</button><button type="button" class="ct-start" data-${A}="ok">✓ Поставить</button><button type="button" data-${A}="cancel" title="Отмена (Esc)">✕</button></div>
      <div class="mb-cat" hidden><div class="mb-tabs"></div><div class="mb-cards"></div></div>
      <div class="mb-note" hidden></div>`;
  }
  // Подписи над постройками: «🧱 N» над своим производством (кнопка «собрать») и полоски стройки (свой участок и соседи рядом)
  function makeTags(R, wrap, G, attr){
    const tagEls = new Map(), list = [];
    function draw(views, mine0, now, onlyMine){
      const cam = R.camera.position;
      list.length = 0;
      for (const v of views) {
        if (!v?.info || !v.root?.visible) continue;
        const mine = v.info.mine, L = mine && mine0 ? mine0.layout : v.info.layout;
        if (onlyMine && !mine) continue;
        if (!mine && Math.hypot(cam.x - v.lot.x, cam.z - v.lot.z) > 40 + G.HALF) continue;
        for (const it of L) {
          const busy = it.ue != null && it.ue > now, amt = mine ? G.Rr.prod(it, now) : 0;
          if (!busy && amt < 1) continue;
          list.push({ v, it, busy, amt, mine });
        }
      }
      const seen = new Set();
      for (const e of list.slice(0, 24)) {
        const key = e.v.info.plot + ':' + e.it.i;
        let el = tagEls.get(key);
        if (!el) { el = document.createElement(e.mine && !e.busy ? 'button' : 'div'); el.className = e.mine && !e.busy ? 'mb-bub' : 'mb-tag'; if (el.tagName === 'BUTTON') { el.type = 'button'; el.addEventListener('pointerdown', ev => ev.stopPropagation()); } wrap.appendChild(el); tagEls.set(key, el); }
        if ((el.tagName === 'BUTTON') !== (e.mine && !e.busy)) { el.remove(); tagEls.delete(key); continue; }
        seen.add(key);
        const [cx, cz] = G.itemCenter(e.it), [wx, wz] = lotToWorld(e.v.lot, cx, cz), h = (e.v.hts.get(e.it.i) || 2.4) + .3;
        const [sx, sy, vis] = R.project(wx, h, wz);
        if (!vis || Math.hypot(cam.x - wx, cam.z - wz) > 55) { el.style.display = 'none'; continue; }
        el.style.display = '';
        el.style.transform = `translate(${Math.round(sx)}px,${Math.round(sy)}px) translate(-50%,-100%)`;
        if (e.busy) {
          const D0 = G.Rr.D[e.it.k], tot = D0.time[(e.it.ul || 1) - 1] || 1, k = Math.max(0, Math.min(1, 1 - (e.it.ue - now) / tot));
          const html = `<b>${D0.e} ${fmtT(e.it.ue - now)}</b><i><u style="width:${Math.round(k * 100)}%"></u></i>`;
          if (el.innerHTML !== html) el.innerHTML = html;
        } else {
          const txt = `🧱 ${e.amt}`;
          if (el.textContent !== txt) { el.textContent = txt; el.dataset[attr] = 'bub:' + e.it.i; }
        }
      }
      for (const [k, el] of tagEls) if (!seen.has(k)) { el.remove(); tagEls.delete(k); }
    }
    return { draw, clear(){ for (const el of tagEls.values()) el.remove(); tagEls.clear(); } };
  }

  // ═══ Менеджер района участков в мире (браузер). В конце — военные базы (startWar), если в мире есть боевая зона ═══
  function start(S, HK){
    const dist = S.world?.district, E = root.D37E, R = S.R;
    if (!R || !E) return null;
    const war = (() => { try { return startWar(S, HK); } catch (e) { console.error(e); return null; } })();
    if (!dist) return war ? wrapOnly(war, S) : null;
    const T = R.T, ph = S.ph, X = S.X;
    const B = { street: 0, cam: null, me: null, data: new Map(), maxPlot: 0, views: [], sql: null, off: 0, bm: null, pend: 0, dirty: false, last: null, stopped: false, war };
    B.M = makeMats(R);
    const M = B.M;
    const authed = () => typeof currentUser !== 'undefined' && !!currentUser;
    const myUid = () => (authed() ? currentUser.id : null);
    const nowS = () => Math.floor(Date.now() / 1000 + B.off);
    const toast = (t, ok) => S.H?.toast(t, ok);
    const sfx = n => { try { S.AU?.play(n); } catch (e) {} };
    // телевизор в доме: в эфире ли Денчик
    let tvC = null;
    const tvMat = () => { if (!tvC) { const c = document.createElement('canvas'); c.width = 256; c.height = 144; const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; tvC = { c, t, mat: new T.MeshBasicMaterial({ map: t, toneMapped: false }), live: null }; drawTv(); } return tvC.mat; };
    function drawTv(){
      if (!tvC) return;
      const live = !!S.live; if (tvC.live === live) return; tvC.live = live;
      const g = tvC.c.getContext('2d'), gr = g.createLinearGradient(0, 0, 256, 144);
      gr.addColorStop(0, live ? '#7f1d1d' : '#312e81'); gr.addColorStop(1, '#0f172a'); g.fillStyle = gr; g.fillRect(0, 0, 256, 144);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.font = '900 30px Montserrat, Arial';
      g.fillText(live ? '🔴 В ЭФИРЕ' : 'DAN4IK37', 128, 58);
      g.fillStyle = '#fde68a'; g.font = '700 16px Montserrat, Arial'; g.fillText(live ? 'Денчик стримит — смотри!' : 'Ролики Денчика — нажми', 128, 104);
      tvC.t.needsUpdate = true;
    }
    const xctx = () => ({ T, R, glass: M.glass, tvMat, boardMat: M.boardMat });

    // ── Вид участка: постройки, тела, подсказки, места, крыша и комната дома ──
    const lotInfo = j => {
      const plot = B.street * PER + j + 1;
      if (B.me && B.me.plot === plot && !(B.me.local && B.data.has(plot))) return { mine: true, local: !!B.me.local, uid: myUid(), nick: 'Я', layout: B.me.layout, access: B.me.access, rev: B.me.rev || 0, likes: B.me.likes || 0, plot };
      const d = B.data.get(plot);
      return d ? { mine: d.uid === myUid(), uid: d.uid, nick: d.nick, layout: d.layout, access: d.access, rev: d.rev, likes: d.likes, plot } : null;
    };
    function clearView(v){
      if (!v) return;
      for (const b of v.bodies) ph.remove(b);
      for (const it of v.items) X.remove(it);
      for (const id of v.seats) { const sp = S.world.seats.get(id); if (sp?.item) X.remove(sp.item); S.world.seats.delete(id); if (S.mySeat?.id === id) S.P.standUp(); }
      clearRoom(v);
      if (v.root) disposeTree(v.root);
      v.bodies = []; v.items = []; v.seats = []; v.root = null; v.house = null;
    }
    function clearRoom(v){
      const r = v?.roomV; if (!r) return;
      for (const b of r.bodies) ph.remove(b);
      for (const it of r.items) X.remove(it);
      for (const id of r.seats) { const sp = S.world.seats.get(id); if (sp?.item) X.remove(sp.item); S.world.seats.delete(id); if (S.mySeat?.id === id) S.P.standUp(); }
      if (r.root) disposeTree(r.root);
      v.roomV = null;
    }
    const addBody = (v, lot, cx, cz, r, b, list) => addBodyTo(ph, list || v.bodies, lot, cx, cz, r, b);
    const P = (g, o) => R.part(g, o);
    // подпись для «перестроить ли»: только то, что видно (не время шахт)
    const sigOf = i => !i ? 'free' : [i.plot, i.uid || '', i.access, ...i.layout.map(it => `${it.i}${it.k}${it.x},${it.z},${it.r},${it.l}${it.ul ? '^' + it.ul : ''}`)].join(';');
    function buildView(j){
      const old = B.views[j], info = lotInfo(j), sig = sigOf(info);
      drawSign(dist.signs[j].cv, B.street * PER + j + 1, info && { mine: info.mine, local: info.local, nick: info.nick, th: info.layout.find(it => it.k === 'th')?.l || 1, likes: info.likes });
      if (old && old.sig === sig) { old.info = info; return old; }
      clearView(old);
      const lot = LOTS[j];
      const same = !!(old && info && old.info?.uid === info.uid), sameAcc = same && old.info.access === info.access;
      const v = { j, lot, sig, info, bodies: [], items: [], seats: [], root: null, house: null, roomV: null, roomKey: '', hts: new Map(),
        roomCache: same ? old.roomCache : null, roomAt: sameAcc ? old.roomAt : 0, roomDenied: sameAcc && !!old.roomDenied };
      B.views[j] = v;
      if (!info) return v;
      const g = R.group(R.scene, lot.x, 0, lot.z, lot.yaw), src = new T.Group();
      g.add(src);
      v.root = g;
      const walls = new Set(info.layout.filter(it => it.k === 'wall').map(it => it.x + ',' + it.z));
      for (const it of info.layout) {
        if (!DEFS[it.k]) continue;
        const r = it.k === 'wall' ? 0 : it.r, [cx, cz] = itemCenter(it), bg = R.group(src, cx, 0, cz, r * PI / 2), bd = [];
        const x = xctx();
        const [fw, fd] = Rules.fp(it.k, 0);
        let h = 2;
        if (it.l === 0) { scaffold(P, bg, fw * CELL, 1.8, true); bd.push({ t: 'box', y0: 0, w: fw * CELL * .55, h: 1.2, d: fd * CELL * .55 }); }
        else if (it.k === 'wall') h = drawWall(P, bg, it, bd, [[1, 0], [0, 1]].filter(([dx, dz]) => walls.has((it.x + dx) + ',' + (it.z + dz))));
        else h = DRAW[it.k]?.(P, bg, it, bd, x) || 2;
        if (it.ul && it.l > 0) scaffold(P, bg, fw * CELL + .2, Math.min(h, 4), false);
        for (const b of bd) addBody(v, lot, cx, cz, r, b);
        v.hts.set(it.i, h);
        // дом: крыша прячется, когда ты внутри (зона «комната» — как у домиков мира), дверь — по доступу
        if (it.k === 'house' && it.l > 0 && x.roof) {
          v.house = { it, cx, cz, r, roof: x.roof, door: x.door, hw: x.room.hw };
          const [wx, wz] = lotToWorld(lot, cx, cz);
          v.bodies.push(ph.addBox({ x: wx, z: wz, y: 1.2, hx: x.room.hw - .1, hy: 1.5, hz: x.room.hw - .1, yaw: lot.yaw + r * PI / 2, trigger: true, tag: 'room', data: { room: 'mb' + info.plot, roof: x.roof } }));   // до 2,7 — ниже крыши (стены 3): на крыше ты снаружи
        }
        if (x.ladder && it.l > 0) {
          const L = x.ladder, [lx, lz] = rotXZ(r, L.x, L.z), [wx, wz] = lotToWorld(lot, cx + lx, cz + lz), [ex, ez] = rotXZ(r, L.ex, L.ez), [wex, wez] = lotToWorld(lot, cx + ex, cz + ez);
          const ld = E.ladder?.(ph, { x: wx, z: wz, yaw: lot.yaw + r * PI / 2, top: L.top, w: .9, bottom: 0, exit: { x: wex, y: L.top, z: wez } });
          if (ld) v.bodies.push(ld.zone);
        }
        if (x.seats && it.l > 0) x.seats.forEach(([sx, sz, sy], n) => {
          const [lx, lz] = rotXZ(r, sx, sz), [wx, wz] = lotToWorld(lot, cx + lx, cz + lz), id = `mb${info.plot}_${it.i}_${n}`;
          dist.seatSpot({ id, x: wx, z: wz, y: sy, yaw: lot.yaw + r * PI / 2, bench: 'Скамейка' });
          v.seats.push(id);
        });
        addItemPrompts(v, it, lot, cx, cz);
      }
      M.merge(g, src, null);                        // всё, кроме крыши дома, — в 2–4 сетки
      if (v.house) {
        M.merge(v.house.roof, v.house.roof, null);  // крыша — своя сетка (прячется целиком)
        syncDoor(v);
        if (info.mine && B.me) buildRoom(v, B.me.room, B.me.rev || 0);
        else if (v.roomCache) buildRoom(v, v.roomCache.items, v.roomCache.rev);
      }
      g.updateMatrixWorld(true);
      return v;
    }
    // Дверь: закрыто для меня — невидимая преграда в проёме
    function canEnter(v){
      const i = v.info; if (!i) return false;
      if (i.mine) return true;
      if (v.roomDenied) return false;
      return i.access === 'all' || (i.access === 'friends' && !!i.uid && S.friends?.has(i.uid));
    }
    function syncDoor(v){
      const h = v.house; if (!h) return;
      const open = canEnter(v);
      if (open && h.block) { ph.remove(h.block); v.bodies.splice(v.bodies.indexOf(h.block), 1); h.block = null; }
      if (!open && !h.block) h.block = addBody(v, v.lot, h.cx, h.cz, h.r, { t: 'box', x: h.door.x, z: h.door.z, y0: 0, w: h.door.w, h: h.door.h, d: h.door.d });
      if (!h.doorItem) {
        const [lx, lz] = rotXZ(h.r, 0, h.door.z + .6), [wx, wz] = lotToWorld(v.lot, h.cx + lx, h.cz + lz);
        h.doorItem = X.add({ x: wx, y: 1.3, z: wz, r: .9, prompt: () => (canEnter(v) ? null : `🔒 Дом закрыт${v.info?.access === 'friends' ? ': только для друзей хозяина' : ''}`), act: () => toast(v.info?.access === 'friends' ? '🔒 Сюда пускают только друзей хозяина' : '🔒 Хозяин никого не пускает в дом', false) });
        v.items.push(h.doorItem);
      }
    }
    // Подсказки «[E]» у своих построек: собрать кирпичи, меню ратуши
    function addItemPrompts(v, it, lot, cx, cz){
      if (!v.info.mine || it.l === 0) return;
      const at = (bx, bz) => { const [lx, lz] = rotXZ(it.r, bx, bz); return lotToWorld(lot, cx + lx, cz + lz); };
      if (it.k === 'mine') {
        const [wx, wz] = at(0, 1.6);
        v.items.push(X.add({ x: wx, y: 1, z: wz, r: 1.2, prompt: () => { const m = B.me?.layout.find(e => e.i === it.i), n = m ? Rules.prod(m, nowS()) : 0; return n >= 1 ? `Собрать 🧱 ${n}` : null; }, act: () => doAct('collect', { id: it.i }) }));
      } else if (it.k === 'th') {
        const [wx, wz] = at(0, 2.5);
        v.items.push(X.add({ x: wx, y: 1, z: wz, r: 1.3, prompt: () => giftReady() ? `🎁 Подарок дня: +${giftSize()} 🧱` : '🏛️ Ратуша: меню участка', act: () => (giftReady() ? doAct('gift') : openMenu()) }));
      }
    }
    // ── Комната дома: мебель (склейка отдельно — меняется чаще участка) ──
    function buildRoom(v, items, rev){
      const h = v.house; if (!h) return;
      const key = JSON.stringify(items || []);
      if (v.roomV && v.roomKey === key) return;
      clearRoom(v);
      v.roomKey = key;
      const lot = v.lot, g = R.group(v.root, h.cx, .12, h.cz, h.r * PI / 2), src = new T.Group(); g.add(src);
      const rv = v.roomV = { root: g, bodies: [], items: [], seats: [] };
      for (const it of items || []) {
        const F = FURN[it.k]; if (!F) continue;
        const [fx, fz] = furnCenter(it), fg = R.group(src, fx, 0, fz, it.r * PI / 2), bd = [], x = xctx();
        FDRAW[it.k]?.(P, fg, it, bd, x);
        // предмет → дом → участок → мир
        const toLot = (bx, bz) => { const [ax, az] = rotXZ(it.r, bx, bz), [hx, hz] = rotXZ(h.r, fx + ax, fz + az); return [h.cx + hx, h.cz + hz]; };
        const yaw = lot.yaw + (h.r + it.r) * PI / 2;
        for (const b of bd) {
          const [lx, lz] = toLot(b.x || 0, b.z || 0), [wx, wz] = lotToWorld(lot, lx, lz);
          rv.bodies.push(b.t === 'cyl' ? ph.addCyl({ x: wx, z: wz, y: .12 + b.y0 + b.h / 2, r: b.r, hy: b.h / 2, tag: 'mb' }) : ph.addBox({ x: wx, z: wz, y: .12 + b.y0 + b.h / 2, hx: b.w / 2, hy: b.h / 2, hz: b.d / 2, yaw, tag: 'mb' }));
        }
        const pt = (bx, bz) => lotToWorld(lot, ...toLot(bx, bz));
        if (x.seats) x.seats.forEach(([sx, sz, sy, sa], n) => {
          const [wx, wz] = pt(sx, sz), id = `mbf${v.info.plot}_${it.i}_${n}`, sp = { id, x: wx, z: wz, y: .12 + sy, yaw: yaw + (sa || 0), bench: F.n };
          if (x.table) sp.tb = { id: `mbt${v.info.plot}_${it.i}`, game: x.table, n: 2, kind: x.table }, sp.s = n;
          dist.seatSpot(sp);
          rv.seats.push(id);
        });
        if (it.k === 'wardrobe') { const [wx, wz] = pt(0, .7); rv.items.push(X.add({ x: wx, y: 1.2, z: wz, r: .8, prompt: () => '🪞 Зеркало: сменить образ', act: () => S.openEditor?.() })); }
        if (it.k === 'tv') { const [wx, wz] = pt(0, .7); rv.items.push(X.add({ x: wx, y: 1.2, z: wz, r: .8, prompt: () => (S.live ? '📺 Денчик в эфире — смотреть' : '📺 Смотреть ролики Денчика'), act: () => S.openStage?.() })); }
        if (it.k === 'arcade') { const [wx, wz] = pt(0, .7); rv.items.push(X.add({ x: wx, y: 1.2, z: wz, r: .7, prompt: () => '🕹️ Игровой автомат: играть', act: () => arcadePanel() })); }
      }
      M.merge(g, src);
      g.updateMatrixWorld(true);
    }

    // ── Данные: улица, свой участок, комнаты ──
    async function rpc(name, args){
      if (typeof sbClient === 'undefined' || !sbClient) return { ok: false, reason: 'net' };
      try {
        const { data, error } = await sbClient.rpc(name, args || {});
        if (error) { if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || '')) { B.sql = false; return { ok: false, reason: 'nosql' }; } return { ok: false, reason: 'net', error }; }
        if (data && typeof data.now === 'number') B.off = data.now - Date.now() / 1000;
        return data || { ok: false, reason: 'net' };
      } catch (e) { return { ok: false, reason: 'net' }; }
    }
    const LS = 'd37_base';
    function readLocal(){ try { const o = Rules.sanitize(JSON.parse(localStorage.getItem(LS) || 'null')); return o && o.plot >= 1 && o.plot <= PLOTS ? o : null; } catch (e) { return null; } }
    function saveLocal(){ if (!B.me?.local) return; try { localStorage.setItem(LS, JSON.stringify({ ...B.me, local: undefined })); } catch (e) {} }
    function fromServer(d){
      const s = Rules.sanitize(d); if (!s) return null;
      s.gift = d.gift ? '' : Rules.day(nowS());   // сервер говорит «можно ли» — храним как день последнего подарка
      s.coins = d.coins; s.rev = d.rev | 0;
      return s;
    }
    async function init(){
      const st = B;
      const loc = readLocal();
      B.trial = null;
      if (authed()) {
        const r = await rpc('base_state');
        if (st.stopped) return;
        if (r.reason === 'nosql') { B.sql = false; B.me = loc ? { ...loc, local: true } : null; }
        else if (r.ok) { B.sql = true; B.me = fromServer(r); }
        else if (r.reason === 'none') { B.sql = true; B.me = null; B.trial = loc; }
        else { B.me = loc ? { ...loc, local: true } : null; }   // нет связи — пробный
      } else {
        B.me = loc ? { ...loc, local: true } : null;
      }
      if (B.me) B.street = streetOf(B.me.plot);
      else if (B.trial) B.street = streetOf(B.trial.plot);
      await loadStreet(true);
      if (B.sql === false && authed()) note('📝 Участок пока хранится в этом браузере — сохранится в аккаунте, когда сайт обновится.');
      renderHud();
      HK.retrack?.();
    }
    async function loadStreet(first){
      const st = B, street = B.street;
      const r = await rpc('base_street', { p_street: street });
      if (st.stopped || street !== B.street) return;
      if (r.ok) {
        if (B.sql == null) B.sql = true;
        B.data.clear();
        for (const p of r.plots || []) { if (p && Number.isInteger(p.p)) { const s = Rules.sanitize({ layout: p.layout, room: [], plot: p.p }); B.data.set(p.p, { uid: p.uid, nick: p.nick, layout: s ? s.layout : [], access: p.access, rev: p.rev | 0, likes: p.likes | 0 }); } }
        B.maxPlot = r.max | 0;
        B.lastLoad = Date.now();
      } else if (r.reason === 'nosql') B.data.clear();
      rebuildAll();
    }
    function rebuildAll(){
      for (let j = 0; j < PER; j++) buildView(j);
      const free = LOTS.filter((_, j) => !lotInfo(j)).length;
      drawBoard(dist.board, B.street, Math.max(1, Math.ceil(B.maxPlot / PER), B.me ? streetOf(B.me.plot) + 1 : 1, B.street + 1), free);
    }
    async function loadRoom(v){
      const i = v.info; if (!i || i.mine || !i.uid || !v.house) return;
      v.roomAt = Date.now();
      const r = await rpc('base_room', { p_owner: i.uid });
      if (B.views[v.j] !== v || B.stopped) return;
      if (r.ok) { v.roomDenied = false; v.roomCache = { uid: i.uid, items: Rules.sanitizeRoom(r.items), rev: i.rev }; buildRoom(v, v.roomCache.items, i.rev); }
      else if (r.reason === 'access') { v.roomDenied = true; clearRoom(v); }
      syncDoor(v);
    }

    // ── Ходы: свой участок (сервер или браузер) ──
    let chain = Promise.resolve();
    const reasonText = r => WHY[r] || WHY.args;
    const wallet = () => ({ coins: window.D37Coins?.coins?.() ?? B.me?.coins ?? 0 });
    async function doAct(a, args = {}, o = {}){
      if (!B.me) { toast(WHY.none, false); return { ok: false }; }
      S.idleAt = Date.now();
      const now = nowS();
      if (B.me.local) {
        const r = Rules.act(B.me, a, args, now);
        if (!r.ok) { toast(r.reason === 'coins' ? WHY.local : reasonText(r.reason), false); sfx('buzz'); return r; }
        B.me.rev = (B.me.rev || 0) + 1;
        saveLocal(); afterChange(a, r, o);
        return r;
      }
      // сервер: сразу показываем по тем же правилам, сервер подтверждает (за монеты — ждём сервер)
      const coinAct = a === 'finish' || (a === 'place' && DEFS[args.k]?.coins) || (a === 'fplace' && FURN[args.k]?.coins > 0 && !(B.me.own['f:' + args.k] > B.me.room.filter(e => e.k === args.k).length));
      let pre = null;
      if (!coinAct) {
        pre = Rules.act(B.me, a, args, now);
        if (!pre.ok) { toast(reasonText(pre.reason), false); sfx('buzz'); return pre; }
        afterChange(a, pre, o);
      }
      B.pend++;
      const res = await (chain = chain.then(() => rpc('base_act', { p_act: a, p_a: args })));
      B.pend--;
      if (B.stopped) return res;
      if (res?.ok) {
        B.last = res;
        if (coinAct) { window.D37Coins?.sync?.(); }
        if (!B.pend) { if (B.dirty) { B.dirty = false; await refreshOwn(); } else { B.me = fromServer(res); afterChange(a, res, { quiet: true }); } }
        signal();
        if (coinAct) afterChange(a, res, o);
      } else {
        toast(res?.reason === 'nosql' ? '📝 Сайт обновляется — попробуй позже' : reasonText(res?.reason), false);
        if (B.pend) B.dirty = true; else await refreshOwn();
      }
      return res;
    }
    async function refreshOwn(){
      const r = await rpc('base_state');
      if (r.ok) { B.me = fromServer(r); afterChange('sync', r, { quiet: true }); }
    }
    function afterChange(a, r, o = {}){
      const j = B.me ? lotOf(B.me.plot) : -1;
      if (B.me && streetOf(B.me.plot) === B.street && j >= 0) { buildView(j); const v = B.views[j]; if (v?.house) buildRoom(v, B.me.room, B.me.rev || 0); }
      if (!o.quiet) {
        if (a === 'collect' && r.got) { toast(`🧱 +${r.got}`, true); sfx('coin'); }
        else if (a === 'gift' && r.got) { toast(`🎁 Подарок дня: +${r.got} 🧱`, true); sfx('coin'); }
        else if (a === 'place' || a === 'fplace') sfx(DEFS[o.k]?.lv > 1 || a === 'fplace' ? 'build_wood' : 'pickup');
        else if (a === 'upgrade') { sfx('build_wood'); toast('🔨 Строитель взялся за работу', true); }
        else if (a === 'finish') { sfx('coin'); toast('⚡ Готово!', true); }
        else if (a === 'move' || a === 'fmove') sfx('click');
        else if (a === 'remove' || a === 'fremove') sfx('pickup');
      }
      renderHud(); if (B.bm) { BM.renderCat(); BM.renderSel(); }
      if (B.menuOpen) openMenu(true);
    }
    let sigT = 0;
    function signal(){ clearTimeout(sigT); sigT = setTimeout(() => { if (B.me && !B.me.local) HK.send?.({ t: 'base', p: B.me.plot, r: B.me.rev || 0 }); }, 1500); }
    const giftReady = () => !!B.me && B.me.gift !== Rules.day(nowS());
    const giftSize = () => (B.me ? Math.min(50 + 50 * Rules.th(B.me), Math.max(0, Rules.cap(B.me) - B.me.bricks)) : 0);

    // ── Занять участок / пробный участок ──
    async function claim(plot){
      if (!authed()) { toast('Войди, чтобы занять участок навсегда', false); return; }
      const trial = B.trial || (B.me?.local ? B.me : null);
      const r = await rpc('base_claim', { p_plot: plot, p_import: trial ? { layout: trial.layout, room: trial.room, bricks: trial.bricks } : null });
      if (r.ok) {
        B.me = fromServer(r); B.trial = null;
        try { localStorage.removeItem(LS); } catch (e) {}
        toast(`🏘️ Участок №${plot} — твой!${trial ? ' Пробная стройка перенесена.' : ''}`, true); sfx('coin');
        B.street = streetOf(plot);
        await loadStreet(); renderHud(); HK.retrack?.(); signal();
        S.H?.toast && setTimeout(() => toast('🔨 Нажми «Строить» — и ставь шахты, заборы, украшения'), 2600);
      } else toast(r.reason === 'nosql' ? '📝 Сайт обновляется — пока можно строить пробный участок' : reasonText(r.reason), false);
    }
    function trialHere(plot){
      const now = nowS();
      if (B.me?.local) { B.me.plot = plot; toast(`🏘️ Пробный участок перенесён на №${plot}`, true); }
      else { B.me = { ...Rules.fresh(plot, now), local: true, rev: 1 }; toast('🏘️ Пробный участок! Строй — он хранится в этом браузере', true); }
      saveLocal(); B.street = streetOf(plot); rebuildAll(); renderHud(); HK.retrack?.();
    }

    // ── Подсказки и действия табличек ──
    B.signPrompt = j => {
      const plot = B.street * PER + j + 1, i = lotInfo(j);
      if (!i) {
        if (B.me && !B.me.local) return `Участок №${plot} — свободен`;
        if (authed() && B.sql !== false) return `Занять участок №${plot}`;
        return B.me?.local ? `Перенести пробный участок сюда (№${plot})` : `Строить здесь (пробный участок №${plot})`;
      }
      if (i.mine) return `Мой участок №${plot}: меню`;
      return `Участок ${i.nick}: 👍 и профиль`;
    };
    B.signAct = j => {
      const plot = B.street * PER + j + 1, i = lotInfo(j);
      if (!i) {
        if (B.me && !B.me.local) { toast(`У тебя уже есть участок №${B.me.plot}`); return; }
        if (authed() && B.sql !== false) { HK.panel?.(`<span class="wld-pe">🏘️</span><b>Участок №${plot}</b>`, `<p>Занять этот участок? Он будет твоим навсегда: ратуша, дом и шахта уже стоят, 🧱 ${START} на старт.${B.trial || B.me?.local ? ' Пробная стройка перенесётся (уровни — до 2).' : ''}</p><div class="wld-acts"><button type="button" class="ct-start" data-mb="claim:${plot}">🏘️ Занять</button></div>`); return; }
        trialHere(plot);
        return;
      }
      if (i.mine) { openMenu(); return; }
      ownerPanel(j);
    };
    B.boardPrompt = () => `Улица ${B.street + 1} — сменить улицу`;
    B.streetPanel = () => {
      const n = Math.max(1, Math.ceil(B.maxPlot / PER) + 1, B.street + 1, B.me ? streetOf(B.me.plot) + 1 : 1);
      const btn = s => `<button type="button" data-mb="street:${s}"${s === B.street ? ' class="ct-start"' : ''}>Улица ${s + 1}${B.me && streetOf(B.me.plot) === s ? ' 🏠' : ''}</button>`;
      HK.panel?.('<span class="wld-pe">🏘️</span><b>Район участков</b>', `<p>На каждой улице 6 участков. Кто на другой улице, тот виден здесь только вне участков.</p><div class="wld-acts mb-streets">${Array.from({ length: Math.min(n, 100) }, (_, s) => btn(s)).join('')}</div>`);
    };
    function ownerPanel(j){
      const i = lotInfo(j); if (!i) return;
      const acc = { all: '🔓 Дом открыт для всех', friends: '💚 В дом пускают только друзей', nobody: '🔒 Дом закрыт' }[i.access] || '';
      HK.panel?.(`<span class="wld-pe">🏡</span><b>${esc(i.nick)}</b>`, `<p>Участок №${i.plot} · 🏛️ ратуша ${i.layout.find(e => e.k === 'th')?.l || 1} ур. · 👍 ${i.likes || 0}<br>${acc}</p><div class="wld-acts"><button type="button" class="ct-start" data-mb="like:${i.uid}">👍 Нравится</button><button type="button" data-mb="profile:${i.uid}">👤 Профиль</button></div>`);
    }
    function arcadePanel(){
      const list = (typeof GAMES !== 'undefined' ? GAMES : []).filter(g => !['world', 'studio', 'studio3d', 'wardrobe'].includes(g.id) && !g.href).slice(0, 18);
      HK.panel?.('<span class="wld-pe">🕹️</span><b>Игровой автомат</b>', `<div class="wld-chips">${list.map(g => `<button type="button" data-mb="go:#/games/${esc(g.id)}">${g.icon} ${esc(g.title)}</button>`).join('')}</div>`);
    }

    // ── Меню участка (кнопка 🏘️) ──
    function openMenu(refresh){
      const pn = S.q('.wld-panel');
      if (refresh && (!pn || pn.hidden || !pn.querySelector('.mb-menu'))) { B.menuOpen = false; return; }
      B.menuOpen = true;
      const me = B.me, now = nowS();
      let body;
      if (!me) {
        body = authed() && B.sql !== false
          ? `<p>У тебя пока нет участка. Займи свободный в <b>Районе участков</b> — за кафе, на северо-западе: подойди к табличке участка и нажми «Занять».</p><div class="wld-acts"><button type="button" class="ct-start" data-mb="district">🏘️ В район участков</button></div>`
          : `<p>Свой участок — дом с мебелью, шахты кирпичей, заборы и украшения; зови друзей в гости. ${authed() ? 'Сайт скоро обновится — пока участок хранится в этом браузере.' : '<b>Войди</b> — и участок будет твоим навсегда, его увидят все. Без входа можно построить пробный.'}</p><div class="wld-acts">${authed() ? '' : '<button type="button" class="ct-start" data-mb="login">🔑 Войти</button>'}<button type="button" data-mb="district">🏘️ В район участков</button></div>`;
      } else {
        Rules.norm(me, now);
        const t = Rules.th(me), cap = Rules.cap(me), busy = Rules.busy(me, now), bl = Rules.builders(me), p = Rules.prodSum(me, null, now);
        const acc = me.access;
        body = `<p>Участок №${me.plot} (улица ${streetOf(me.plot) + 1})${me.local ? ' · <b>пробный</b>' : ''}<br>🏛️ Ратуша ${t} ур. · 🧱 ${num(me.bricks)} / ${num(cap)} · 👷 ${busy}/${bl}${me.local ? '' : ' · 👍 ' + (me.likes || 0)}${p > 0 ? `<br>⛏️ В шахтах: 🧱 ${num(p)}` : ''}</p>
          <div class="wld-acts"><button type="button" class="ct-start" data-mb="home">🏠 К участку</button><button type="button" data-mb="build">🔨 Строить</button>${p > 0 ? `<button type="button" data-mb="collect">⛏️ Собрать 🧱 ${num(p)}</button>` : ''}${giftReady() ? `<button type="button" data-mb="gift">🎁 Подарок дня</button>` : ''}</div>
          <div class="wld-sublbl">Кого пускать в дом</div><div class="wld-chips">${[['all', '🔓 Всех'], ['friends', '💚 Друзей'], ['nobody', '🔒 Никого']].map(([a, l]) => `<button type="button" data-mb="access:${a}"${acc === a ? ' class="ct-start"' : ''}>${l}</button>`).join('')}</div>
          <p class="mb-small">⚔️ Набеги и оборона — в военных базах Боевой зоны (12+): <button type="button" class="wld-link" data-mb="war">🏯 Военные базы</button></p>
          ${me.local ? `<p class="mb-small">${authed() ? '📝 Хранится в этом браузере — сохранится в аккаунте, когда сайт обновится.' : '📝 Пробный участок хранится только в этом браузере. <b>Войди</b> — займи участок, и стройка перенесётся.'}</p>${authed() ? '' : '<div class="wld-acts"><button type="button" class="ct-start" data-mb="login">🔑 Войти</button></div>'}` : ''}`;
      }
      HK.panel?.('<span class="wld-pe">🏘️</span><b>Мой участок</b>', `<div class="mb-menu">${body}</div>`);
    }
    function teleport(x, z, yaw){
      const P0 = S.P; if (!P0) return;
      if (S.mySeat) P0.standUp();
      P0.place(x, null, z, yaw);
      S.rig?.snap(P0.ch.x, P0.ch.y, P0.ch.z);
      if (S.rig) S.rig.yaw = yaw - PI;
      HK.closePops?.();
      S.forceSend = true;
    }
    function goHome(){
      if (!B.me) return;
      if (streetOf(B.me.plot) !== B.street) { B.street = streetOf(B.me.plot); loadStreet(); HK.retrack?.(); }
      const lot = LOTS[lotOf(B.me.plot)], [x, z] = lotToWorld(lot, 2, HALF + 1.6);
      teleport(x, z, lot.yaw + PI);
    }

    // ── Клики по нашим кнопкам (data-mb) ──
    const onClick = e => {
      const b = e.target.closest('[data-mb]'); if (!b || !S.el.contains(b)) return;
      const a = b.dataset.mb;
      S.idleAt = Date.now();
      if (a === 'menu') { if (S.q('.wld-panel .mb-menu') && !S.q('.wld-panel').hidden) { HK.closePops?.(); B.menuOpen = false; } else openMenu(); }
      else if (a === 'login') { if (typeof openGlobalAuth === 'function') openGlobalAuth(); }
      else if (a === 'district') teleport(-12.5, -36, PI);
      else if (a === 'war') { HK.closePops?.(); B.war ? B.war.openMenu() : HK.go?.('#/games/raid'); }
      else if (a === 'home') goHome();
      else if (a === 'build') { if (!BM.onMyLot() && !BM.inHouse()) goHome(); setTimeout(() => BM.enter(), 60); }
      else if (a === 'gift') doAct('gift');
      else if (a === 'collect') doAct('collect', {});
      else if (a.startsWith('access:')) doAct('access', { a: a.slice(7) });
      else if (a.startsWith('claim:')) { HK.closePops?.(); claim(+a.slice(6)); }
      else if (a.startsWith('street:')) { const s = +a.slice(7); if (s !== B.street && s >= 0 && s < PLOTS / PER) { if (B.bm) BM.exit(); B.street = s; B.data.clear(); rebuildAll(); loadStreet(); HK.retrack?.(); } HK.closePops?.(); }
      else if (a.startsWith('like:')) like(a.slice(5));
      else if (a.startsWith('profile:')) HK.go?.('#/profile/' + a.slice(8));
      else if (a.startsWith('go:')) HK.go?.(a.slice(3));
      else if (a === 'exit') BM.exit();
      else if (a.startsWith('bub:')) doAct('collect', { id: +a.slice(4) });
      else BM.click(a);
    };
    async function like(uid){
      if (!authed()) { toast('Войди, чтобы ставить 👍', false); return; }
      if (B.sql === false) { toast('📝 Сайт обновляется — попробуй позже', false); return; }
      const r = await rpc('base_act', { p_act: 'like', p_a: { uid } });
      if (r.ok) { toast('👍 Хозяину +10 🧱 — спасибо!', true); sfx('coin'); const d = [...B.data.values()].find(e => e.uid === uid); if (d) { d.likes = r.likes ?? d.likes + 1; rebuildAll(); } HK.send?.({ t: 'base', p: r.plot || 0, r: r.rev || 0 }); }
      else toast(r.reason === 'max' ? WHY.max_likes : reasonText(r.reason), false);
      HK.closePops?.();
    }
    async function finish(id){
      const it = B.me?.layout.find(e => e.i === id); if (!it?.ue) return;
      if (B.me.local) { toast(WHY.local, false); return; }
      const n = Rules.speedCost(it, nowS());
      if (!confirm(`Достроить сразу за ${n} 🪙?`)) return;
      doAct('finish', { id });
    }

    // ── Экран: кнопка в шапке, «Строить», ресурсы, каталог, выбранное, пузырьки над шахтами, заметки ──
    const hud = document.createElement('div'); hud.className = 'mb-hud';
    hud.innerHTML = hudHtml('mb');
    S.wrap.appendChild(hud);
    const q = s => hud.querySelector(s);
    for (const el of [q('.mb-top'), q('.mb-sel'), q('.mb-ghost'), q('.mb-cat'), q('.mb-fab')]) {
      el.addEventListener('pointerdown', e => e.stopPropagation());
      el.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    }
    const topBtn = document.createElement('button');
    topBtn.type = 'button'; topBtn.dataset.mb = 'menu'; topBtn.title = 'Мой участок'; topBtn.innerHTML = '🏘️<span> Участок</span>';
    S.q('.wld-topbtns')?.prepend(topBtn);
    S.el.addEventListener('click', onClick);
    let noteT = 0;
    function note(t){ const n = q('.mb-note'); n.textContent = t; n.hidden = false; clearTimeout(noteT); noteT = setTimeout(() => { n.hidden = true; }, 9000); }
    function renderHud(){
      const bm = B.bm, me = B.me, now = nowS();
      q('.mb-top').hidden = !bm; q('.mb-cat').hidden = !bm;
      S.wrap.classList.toggle('mb-building', !!bm || !!B.war?.bm);
      if (!bm) { q('.mb-sel').hidden = true; q('.mb-ghost').hidden = true; }
      if (me && bm) {
        q('.mbBr').innerHTML = `🧱 <b>${num(me.bricks)}</b>/${num(Rules.cap(me))}`;
        q('.mbBl').innerHTML = `👷 <b>${Rules.busy(me, now)}/${Rules.builders(me)}</b>`;
        q('.mbCo').innerHTML = me.local ? '' : `🪙 <b>${num(window.D37Coins?.coins?.() ?? me.coins ?? 0)}</b>`;
        q('.mbCo').hidden = !!me.local;
        q('.mb-gift').hidden = !giftReady() || bm.room;
      }
    }
    const TABS = [['b', ['🏛️ Постройки', ['mine', 'store', 'shop', 'tower']]], ['w', ['🧱 Заборы', ['wall']]], ['d', ['🌳 Украшения', ['tree', 'pine', 'bush', 'flowers', 'rock', 'lamp', 'flag', 'bench', 'fountain', 'statue']]]];
    const BM = makeBuilder(S, B, {
      attr: 'mb', G: GD, D: DEFS, tabs: TABS, q, war: false,
      room: { IN, ICELL, IHALF, DOOR, FURN, FDRAW, furnCenter, icellAt, inHouse: () => !!(B.me && S.inside && S.inside.room === 'mb' + B.me.plot) },
      view: () => (B.me && streetOf(B.me.plot) === B.street ? B.views[lotOf(B.me.plot)] : null),
      act: doAct, wallet, local: () => !!B.me?.local, now: nowS, tvMat,
      sfx, toast, why: r => reasonText(r.reason), renderHud, finish,
    });
    const tags = makeTags(R, q('.mb-tags'), GD, 'mb');

    // ── Шаг и кадр (из mir.js) ──
    let tick = 0, presT = 0, roomT = 0;
    B.update = dt => {
      const C = S.C;
      tick += dt; presT += dt; roomT += dt;
      // B — стройка: своя база в зоне — её; иначе участок района
      if (C.down('build') && !S.editing) { if (B.war?.bm) B.war.buildKey(); else if (B.bm) BM.exit(); else if (B.war && (B.war.wantsBuild() || B.war.here())) B.war.buildKey(); else if (!B.me) openMenu(); else BM.enter(); }
      BM.update(dt);
      if (presT > .5) { presT = 0; hideOthers(); }
      if (roomT > 1) { roomT = 0; nearRooms(); }
      if (tick > 90 && (B.near || B.bm)) { tick = 0; loadStreet(); }
      // ушёл с участка — выйти из стройки
      if (B.bm && !B.bm.room && !B.me) BM.exit();
      B.war?.update(dt);
    };
    B.frame = (dt, t) => {
      R.camera.updateMatrixWorld();   // камеру уже подвинули в этом кадре — подписи и луч по свежей
      const cam = R.camera.position;
      // дальние участки — прячем
      for (const v of B.views) if (v?.root) { const d = Math.hypot(cam.x - v.lot.x, cam.z - v.lot.z); v.root.visible = d < 125; }
      B.near = Math.hypot(S.P.ch.x + 45, S.P.ch.z + 41) < 75;
      if (S.hud2 && topBtn.hidden === B.near) topBtn.hidden = !B.near;   // HUD 2.0 (T-123): 🏘️ — только у района участков (и всегда в ☰)
      // кнопка «Строить» — на своём участке
      const fab = q('.mb-fab'), canB = !!B.me && !B.bm && !B.war?.bm && (BM.onMyLot() || BM.inHouse());
      if (fab.hidden === canB) fab.hidden = !canB;
      if (canB) { const inH = BM.inHouse(); const lbl = inH ? '🛋️<span> Обставить</span>' : '🔨<span> Строить</span>'; if (fab.dataset.l !== lbl) { fab.dataset.l = lbl; fab.innerHTML = lbl; } }
      BM.frame(t);
      if (t - (B.tvT || 0) > 3) { B.tvT = t; drawTv(); }
      if (B.near || B.bm) tags.draw(B.views, B.me, nowS()); else tags.clear();
      B.war?.frame(dt, t);
    };
    // Чужие на другой улице (и на участках) — не видны
    function hideOthers(){
      const st = S.ch?.presenceState?.() || {};
      for (const p of S.players.values()) {
        const metas = st[p.key]; let bs = null;
        if (Array.isArray(metas) && metas.length) { const m = metas.reduce((a, b) => ((b.at || 0) >= (a.at || 0) ? b : a), metas[0]); if (Number.isInteger(m.bs)) bs = m.bs; }
        p.mbHide = bs != null && bs !== B.street && inDistrict(p.ch.x, p.ch.z);
        const a = S.A?.get(p.key); if (a) a.hidden = !!p.mbHide || !!p.wbHide;
      }
    }
    // Рядом с чужим домом — подгрузить мебель (если пускают)
    function nearRooms(){
      const pc = S.P.ch;
      for (const v of B.views) {
        if (!v?.house || !v.info || v.info.mine) continue;
        const [hx, hz] = lotToWorld(v.lot, v.house.cx, v.house.cz);
        if (Math.hypot(pc.x - hx, pc.z - hz) > 16) continue;
        if (v.roomCache?.rev === v.info.rev && v.roomCache.uid === v.info.uid) { if (!v.roomV) buildRoom(v, v.roomCache.items, v.info.rev); continue; }
        if (Date.now() - (v.roomAt || 0) < 15000 || B.sql === false) continue;
        loadRoom(v);
      }
      // друзья подгрузились — двери могли открыться
      for (const v of B.views) if (v?.house) syncDoor(v);
    }
    // Сеть: кто-то перестроил участок на нашей улице — перечитать (военная база — поле w: её менеджеру)
    let reloadT = 0;
    B.onMsg = (p, d) => {
      if (d && Number.isInteger(d.w)) { B.war?.onMsg(p, d); return; }
      if (!Number.isInteger(d.p) || streetOf(d.p) !== B.street || (B.me && d.p === B.me.plot && !B.me.local)) return;
      const cur = B.data.get(d.p);
      if (cur && cur.rev >= (d.r | 0)) return;
      clearTimeout(reloadT); reloadT = setTimeout(() => loadStreet(), 900);
    };
    const onPtr = e => { if (e.pointerType === 'mouse') B.ptr = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    S.wrap.addEventListener('pointermove', onPtr);
    const onAuth = () => { if (!B.stopped) { if (B.bm) BM.exit(); init(); } };
    window.addEventListener('d37:auth', onAuth);
    // кирпичи участка ушли в казну военной базы (war_act give) — перечитать свой участок
    const onBase = () => { if (B.stopped || !B.me) return; if (B.me.local) { const l = readLocal(); if (l) { B.me = { ...l, local: true }; afterChange('sync', {}, { quiet: true }); } } else refreshOwn(); };
    window.addEventListener('d37:base', onBase);
    B.dispose = () => {
      B.stopped = true;
      BM.dispose();
      for (const v of B.views) clearView(v);
      S.el.removeEventListener('click', onClick);
      S.wrap.removeEventListener('pointermove', onPtr);
      window.removeEventListener('d37:auth', onAuth);
      window.removeEventListener('d37:base', onBase);
      clearTimeout(sigT); clearTimeout(reloadT); clearTimeout(noteT);
      tags.clear(); hud.remove(); topBtn.remove();
      M.dispose();
      if (tvC) { tvC.t.dispose(); tvC.mat.dispose(); }
      for (const d of dist.dyn) { d.t.dispose(); d.mat.dispose(); }
      B.war?.dispose();
    };
    B._test = { rebuildAll, lotInfo, merge: M.merge, init, claim, BM };   // для проверки во встроенном браузере
    rebuildAll();   // таблички «свободен» — сразу, данные подтянутся
    init();
    return B;
  }
  // Мир без района (нет MirBase.build в мире) — только военные базы
  // bm / cam — геттеры общего прототипа (WRAP_PROTO), не свои у объекта (T-085: свой геттер V8 держит в общей «форме» объекта —
  // через него после закрытия жил весь прошлый мир; так держал B.activeBm — он и W.ws не использовались и убраны)
  const WRAP_PROTO = { get bm(){ return this.war.bm; }, get cam(){ return this.war.cam; } };
  function wrapOnly(war, S){
    return Object.assign(Object.create(WRAP_PROTO), { street: 0, war, frame: (dt, t) => war.frame(dt, t),
      update: dt => { if (S.C.down('build') && !S.editing && (war.bm || war.wantsBuild() || war.here())) war.buildKey(); war.update(dt); },
      onMsg: (p, d) => { if (Number.isInteger(d?.w)) war.onMsg(p, d); }, dispose: () => war.dispose() });
  }

  // ═══ ВОЕННЫЕ БАЗЫ боевой зоны (браузер): 12 участков сектора (MirWar.PLOTS), главарь и состав, стройка (главарь и офицеры),
  //     техника из гаража / площадки / ангара / причала, бункер под базой, табличка участка → основать / о базе ═══
  // Сервер — war_* в bases.sql (war_state, war_sector, war_claim, war_act, war_member, war_set, war_leave, war_join). Сектор: 12 баз;
  // номер базы 1…1200 = сектор · 12 + участок. Кто смотрит другой сектор — на участках не виден (поле ws в presence).
  const WAR_YAW = { s: 0, n: PI, e: PI / 2, w: -PI / 2 };   // система участка: +z — к воротам
  const sectorOf = id => Math.floor((id - 1) / WAR.per), slotOf = id => (id - 1) % WAR.per;
  // Полная база штаба th — для замеров и проверок (все постройки по максимуму, заборы кольцами); детерминированно
  function fillLayout(th, seed = 1){
    const s = WRules.fresh(1, 0), now = 0, t = Math.max(1, Math.min(5, th));
    s.layout[0].l = t; s.bricks = 1e9; s.seq = 2;
    let r = seed >>> 0; const rnd = () => (r = (Math.imul(r ^ (r >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296;
    const [lo, hi] = WRules.boxOf(s);
    const tryPut = (k, l) => { const D = WDEFS[k]; for (let a = 0; a < 400; a++) { const x = lo + Math.floor(rnd() * (hi - lo - D.w + 1)), z = lo + Math.floor(rnd() * (hi - lo - D.d + 1)); if (WRules.fits(s.layout, x, z, D.w, D.d)) { s.layout.push({ i: ++s.seq, k, x, z, r: 0, l: Math.min(D.lv, l) }); return true; } } return false; };
    for (const k of ['barracks', 'factory', 'garage', 'helipad', 'hangar', 'dock', 'bunker', 'tower', 'cannon', 'mortar', 'mine', 'store', 'shop', 'bomb', 'airmine']) {
      const D = WDEFS[k], n = (D.th || 1) > t ? 0 : D.max[t - 1] - WRules.count(s.layout, k);
      for (let i = 0; i < n; i++) tryPut(k, t);
    }
    // стены: квадрат вокруг середины, сколько разрешено
    let walls = WDEFS.wall.max[t - 1];
    for (let d = 5; d < (hi - lo) / 2 && walls > 0; d += 5) {
      const c = (lo + hi) >> 1;
      for (let i = -d; i <= d && walls > 0; i++) for (const [x, z] of [[c + i, c - d], [c + i, c + d], [c - d, c + i], [c + d, c + i]]) { if (walls > 0 && WRules.fits(s.layout, x, z, 1, 1)) { s.layout.push({ i: ++s.seq, k: 'wall', x, z, r: 0, l: Math.min(5, t) }); walls--; } }
    }
    void now;
    return s.layout;
  }
  // Тела стен базы: прямые отрезки одного уровня (вдоль x и вдоль z) — одна коробка на отрезок (была — столбик и перемычка на клетку);
  // одиночный столбик — как был. Итог — в системе участка: { cx, cz, w, d, h } (низ — на земле)
  function wallRunsLocal(layout){
    const at = new Map(), runOf = new Set(), out = [];
    for (const it of layout) if (it.k === 'wall' && it.l > 0) at.set(it.x + ',' + it.z, it);
    const put = (x0, z0, x1, z1, it) => {
      const st = WALL_WST[Math.max(1, it.l) - 1], pw = Math.max(.5, st.post[0]), h = Math.max(st.post[1], .9, st.seg?.[1] || 0);
      const [ax, az] = GW.itemCenter({ k: 'wall', x: x0, z: z0, r: 0 }), [bx, bz] = GW.itemCenter({ k: 'wall', x: x1, z: z1, r: 0 });
      out.push({ cx: (ax + bx) / 2, cz: (az + bz) / 2, w: Math.abs(bx - ax) + pw, d: Math.abs(bz - az) + pw, h });
    };
    for (const [dx, dz] of [[1, 0], [0, 1]]) for (const it of at.values()) {
      const prev = at.get((it.x - dx) + ',' + (it.z - dz));
      if (prev && prev.l === it.l) continue;   // не начало отрезка
      let end = it, n = 1;
      for (let nx = at.get((it.x + dx) + ',' + (it.z + dz)); nx && nx.l === it.l; nx = at.get((nx.x + dx) + ',' + (nx.z + dz))) { end = nx; n++; }
      if (n < 2) continue;
      put(it.x, it.z, end.x, end.z, it);
      for (let c = it, k = 0; k < n; k++, c = at.get((c.x + dx) + ',' + (c.z + dz))) runOf.add(c);
    }
    for (const it of at.values()) if (!runOf.has(it)) put(it.x, it.z, it.x, it.z, it);
    return out;
  }
  // Деталь для вида базы: дальний — без мелочи (< 0,35 м, тонкое < 0,12 при длине < 1 м), круглое — меньше граней (и вблизи: 6–16
  // вместо 14); null — не рисовать
  function detailOf(o, far){
    const s = o.s || 'box';
    if (far) {
      const rr = 2 * Math.max(o.r || 0, o.r2 || 0), a = s === 'box' ? o.w || 0 : rr, b = s === 'box' ? o.h || 0 : s === 'ball' || s === 'ico' ? rr : o.h || 0, c = s === 'box' ? o.d || 0 : rr;
      const mx = Math.max(a, b, c), mn = Math.min(a, b, c);
      if (mx < .35 || (mn < .12 && mx < 1)) return null;
    }
    if (s === 'ball') { const cap = far ? 6 : o.r < .16 ? 6 : o.r < .35 ? 8 : 10; return !o.seg || o.seg > cap ? { ...o, seg: cap } : o; }
    if (s === 'cyl' || s === 'cone') {
      const r = Math.max(o.r || 0, o.r2 || 0), cap = far ? (r < .6 ? 6 : 10) : r < .2 ? 6 : r < .6 ? 8 : r < 1.6 ? 12 : 16;
      return (o.seg || (s === 'cone' ? 12 : 14)) > cap ? { ...o, seg: cap } : o;
    }
    if (s === 'ico') return (o.det ?? 1) > 0 && (far || o.r < .6) ? { ...o, det: 0 } : o;
    return o;
  }
  function startWar(S, HK){
    const MW = root.MirWar, R = S.R, E = root.D37E;
    if (!MW?.PLOTS?.length || !R || !E) return null;
    const T = R.T, ph = S.ph, X = S.X, MZ = root.MirZones;
    const PLS = MW.PLOTS, PERW = Math.min(WAR.per, PLS.length);
    const LOTW = PLS.map(P => ({ x: P.cx, z: P.cz, yaw: WAR_YAW[P.gate?.side] ?? 0, P }));
    const W = { sector: 0, cam: null, me: null, data: new Map(), maxId: 0, views: [], sql: null, off: 0, bm: null, pend: 0, dirty: false, stopped: false, near: false, loadT: 0, queue: new Set(), sectors: 1, urgent: -1 };
    W.M = makeMats(R);
    const M = W.M, P = (g, o) => R.part(g, o);
    const authed = () => typeof currentUser !== 'undefined' && !!currentUser;
    const myUid = () => (authed() ? currentUser.id : null);
    const nowS = () => Math.floor(Date.now() / 1000 + W.off);
    const toast = (t, ok) => S.H?.toast(t, ok);
    const sfx = n => { try { S.AU?.play(n); } catch (e) {} };
    // у базы — штаб и казна (общие тексты WHY говорят про ратушу и склад участка)
    const WW = { ...WHY, th: 'Нужен штаб выше уровнем', max: 'Больше нельзя — улучшите штаб', lvcap: 'Сначала улучшите штаб', none: 'Сначала вступи в базу или основай свою',
      full: 'Казна полна — постройте или улучшите склад 📦', place: 'Сюда не встанет: место занято, край базы или проезд к воротам', taken: 'Этот участок уже занят',
      done: 'Сегодня уже забрали — приходите завтра', self: 'Это ваша база 🙂' };
    const why = r => WW[r?.reason || r] || WHY.args;
    const ageOk = () => { const A = root.D37Age; return !A || (A.known?.() !== false && (A.canOpen ? A.canOpen(12) : true)); };
    const canEdit = () => !!W.me && (W.me.rank === 'leader' || W.me.rank === 'officer');
    const isLeader = () => W.me?.rank === 'leader';
    const zoneRect = MZ?.ZONES?.war;
    const inZone = (x, z, m = 0) => !!zoneRect && x >= zoneRect.x0 - m && x <= zoneRect.x1 + m && z >= zoneRect.z0 - m && z <= zoneRect.z1 + m;

    // ── Данные ──
    async function rpc(name, args){
      if (typeof sbClient === 'undefined' || !sbClient) return { ok: false, reason: 'net' };
      try {
        const { data, error } = await sbClient.rpc(name, args || {});
        if (error) { if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || '')) { W.sql = false; return { ok: false, reason: 'nosql' }; } return { ok: false, reason: 'net', error }; }
        if (data && typeof data.now === 'number') W.off = data.now - Date.now() / 1000;
        return data || { ok: false, reason: 'net' };
      } catch (e) { return { ok: false, reason: 'net' }; }
    }
    function fromServer(d){
      const s = WRules.sanitize({ ...d, plot: d.id });
      if (!s) return null;
      s.gift = d.gift ? '' : WRules.day(nowS());
      Object.assign(s, { id: d.id | 0, name_k: d.name_k | 0, name_n: d.name_n | 0, color: COLORS[d.color | 0] ? d.color | 0 : 0, rank: RANKS[d.rank] ? d.rank : 'soldier',
        members: Array.isArray(d.members) ? d.members.slice(0, 40) : [], invite: typeof d.invite === 'string' ? d.invite : '', raid_rank: d.raid_rank === 'soldier' ? 'soldier' : 'officer',
        trophies: d.trophies | 0, shield: d.shield | 0, skin: SKINS[d.skin] ? d.skin : '', give_left: d.give_left ?? WAR.give, district: d.district ?? null, coins: d.coins, rev: d.rev | 0 });
      return s;
    }
    const infoOf = d => { const s = WRules.sanitize({ layout: d.layout, plot: d.id }); return { id: d.id, name: baseName(d.name_k, d.name_n), color: COLORS[d.color | 0] || COLORS[0], uid: d.uid, nick: d.nick || 'Игрок', layout: s ? s.layout : [], rev: d.rev | 0, tr: d.tr | 0, sh: d.sh | 0, skin: SKINS[d.skin] ? d.skin : '', n: d.n | 0 }; };
    async function init(){
      const st = W;
      if (authed()) {
        const r = await rpc('war_state');
        if (st.stopped) return;
        if (r.ok) { W.sql = true; W.me = fromServer(r); if (W.me) W.sector = sectorOf(W.me.id); }
        else { W.me = null; if (r.reason !== 'nosql' && r.reason !== 'net') W.sql = true; W.why = r.reason; }
      } else W.me = null;
      HK.retrack?.();
      if (W.near) await loadSector();
      renderHud();
    }
    async function loadSector(){
      const st = W, sector = W.sector;
      W.loadT = Date.now();
      const r = await rpc('war_sector', { p_sector: sector });
      if (st.stopped || sector !== W.sector) return;
      if (r.ok) {
        if (W.sql == null) W.sql = true;
        W.data.clear();
        for (const d of r.bases || []) if (d && Number.isInteger(d.id)) W.data.set(d.id, infoOf(d));
        W.maxId = r.max | 0;
        W.sectors = Math.max(1, Math.ceil((W.maxId + 1) / WAR.per) + 1);
      } else if (r.reason === 'nosql') W.data.clear();
      rebuildAll();
    }
    async function refreshOwn(){
      const r = await rpc('war_state');
      if (r.ok) { W.me = fromServer(r); afterChange('sync', r, { quiet: true }); }
      else if (r.reason === 'none') { W.me = null; rebuildAll(); renderHud(); }
    }

    // ── Виды баз ──
    const lotInfo = j => {
      const id = W.sector * WAR.per + j + 1;
      if (W.me && W.me.id === id) return { mine: true, id, plot: id, name: baseName(W.me.name_k, W.me.name_n), color: COLORS[W.me.color] || COLORS[0], uid: null, nick: '', layout: W.me.layout, rev: W.me.rev, tr: W.me.trophies, sh: W.me.shield, skin: W.me.skin };
      const d = W.data.get(id);
      return d ? { mine: false, plot: id, ...d } : null;
    };
    const sigOf = i => !i ? 'free' : [i.id, i.mine ? 1 : 0, i.color, i.skin || '', ...i.layout.map(it => `${it.i}${it.k}${it.x},${it.z},${it.r},${it.l}${it.ul ? '^' + it.ul : ''}`)].join(';');
    // Вид базы строится по кусочку (бюджет кадра, как у зон: телефон 3 мс, ПК 3,5; база рядом и своя при стройке — больше), старый
    // вид виден до замены. Подробный вид — у баз ближе LODR.near м до участка (дальше LODR.far — простой: без мелочи, меньше граней);
    // тела физики — только у баз ближе PHYS_IN (дальше PHYS_OUT — убраны), стены — одним телом на прямой отрезок
    const LODR = { near: 55, far: 75 }, PHYS_IN = 35, PHYS_OUT = 50;
    const plotDist = (j, x, z) => { const Q = LOTW[j].P; return Math.hypot(Math.max(Q.x0 - x, 0, x - Q.x1), Math.max(Q.z0 - z, 0, z - Q.z1)); };
    function bodiesOn(v){
      if (v.phys) return;
      v.phys = true;
      for (const d of v.bdesc) {
        if (d.ladder) { const ld = E.ladder?.(ph, d.ladder); if (ld) v.bodies.push(ld.zone); }
        else v.bodies.push(d.t === 'cyl' ? ph.addCyl(d) : d.t === 'wedge' ? ph.addWedge(d) : ph.addBox(d));
      }
    }
    function bodiesOff(v){ for (const b of v.bodies) ph.remove(b); v.bodies.length = 0; v.phys = false; }
    function clearView(v){
      if (!v) return;
      bodiesOff(v);
      for (const it of v.items) X.remove(it);
      if (v.root) disposeTree(v.root);
      v.items = []; v.root = null;
    }
    // Тело постройки → описание в мире (как addBodyTo): создаётся, только пока база рядом
    function bodyDesc(lot, cx, cz, r, b){
      const [lx, lz] = rotXZ(r, b.x || 0, b.z || 0), [wx, wz] = lotToWorld(lot, cx + lx, cz + lz), data = { cam: !!b.cam, floor: b.floor };
      return b.t === 'cyl' ? { t: 'cyl', x: wx, z: wz, y: b.y0 + b.h / 2, r: b.r, hy: b.h / 2, tag: 'mb', data }
        : { t: b.t === 'wedge' ? 'wedge' : 'box', x: wx, z: wz, y: b.y0 + b.h / 2, hx: b.w / 2, hy: b.h / 2, hz: b.d / 2, yaw: lot.yaw + r * PI / 2 + (b.yaw || 0), tag: 'mb', data };
    }
    const wallRuns = (layout, lot, out) => { for (const b of wallRunsLocal(layout)) out.push(bodyDesc(lot, b.cx, b.cz, 0, { t: 'box', y0: 0, w: b.w, h: b.h, d: b.d })); };
    const NOPART = { position: { set(){} }, rotation: { set(){} }, scale: { set(){} }, userData: {} };
    const PART = [(g, o) => { const q = detailOf(o, false); return q ? M.rec(g, q) : NOPART; }, (g, o) => { const q = detailOf(o, true); return q ? M.rec(g, q) : NOPART; }];
    // Вид базы j уровня lod (0 — подробный, 1 — дальний): генератор, отдаёт кадр, когда over(); итог — новый вид (в сцене ещё нет)
    function* viewGen(j, lod, over, job){
      const info = lotInfo(j), lot = LOTW[j];
      const v = { j, lot, sig: sigOf(info), info, lod, bodies: [], bdesc: [], phys: false, items: [], root: null, hts: new Map(), spots: [] };
      if (!info) return v;
      const g = job.g = new T.Group(), src = new T.Group(), P = PART[lod ? 1 : 0];
      g.position.set(lot.x, 0, lot.z); g.rotation.y = lot.yaw; g.add(src);
      // открытая часть участка — светлее (растёт со штабом), занятые клетки у въезда — бетон
      const [lo, hi] = WRules.boxOf(info), w0 = (hi - lo) * CELL;
      P(src, { s: 'box', y: .04, w: w0, h: .03, d: w0, c: '#b3a77f' });
      const walls = new Set(info.layout.filter(it => it.k === 'wall').map(it => it.x + ',' + it.z));
      const x = { T, R, war: true, color: info.color, glass: M.glass, tvMat: () => M.glow, boardMat: M.boardMat };
      for (const it of info.layout) {
        if (!WDEFS[it.k]) continue;
        if (TRAPS.has(it.k) && !info.mine) continue;   // ловушки видны только своим
        const r = it.k === 'wall' ? 0 : it.r, [cx, cz] = GW.itemCenter(it), bg = R.group(src, cx, 0, cz, r * PI / 2), bd = [];
        const [fw, fd] = WRules.fp(it.k, 0);
        let h = 2;
        x.ladder = null;
        if (it.l === 0) { scaffold(P, bg, fw * CELL, 1.8, true); bd.push({ t: 'box', y0: 0, w: fw * CELL * .55, h: 1.2, d: fd * CELL * .55 }); }
        else if (it.k === 'wall') h = drawWall(P, bg, it, bd, [[1, 0], [0, 1]].filter(([dx, dz]) => walls.has((it.x + dx) + ',' + (it.z + dz))), WALL_WST);
        else h = (WDRAW[it.k] || DRAW[it.k])?.(P, bg, it, bd, x) || 2;
        if (it.ul && it.l > 0) scaffold(P, bg, fw * CELL + .2, Math.min(h, 4), false);
        if (!(it.k === 'wall' && it.l > 0)) for (const b of bd) v.bdesc.push(bodyDesc(lot, cx, cz, r, b));   // готовые стены — отрезками ниже
        v.hts.set(it.i, h);
        if (x.ladder && it.l > 0) {
          const L = x.ladder, [lx, lz] = rotXZ(r, L.x, L.z), [wx, wz] = lotToWorld(lot, cx + lx, cz + lz), [ex, ez] = rotXZ(r, L.ex, L.ez), [wex, wez] = lotToWorld(lot, cx + ex, cz + ez);
          v.bdesc.push({ ladder: { x: wx, z: wz, yaw: lot.yaw + r * PI / 2, top: L.top, w: .9, bottom: 0, exit: { x: wex, y: L.top, z: wez } } });
        }
        v.spots.push([it, cx, cz]);
        if (over()) yield;
      }
      wallRuns(info.layout, lot, v.bdesc);
      const ms = yield* M.mergeGen(g, src, SKINS[info.skin] || null, over);
      if (lod) for (const m of ms) m.castShadow = false;   // дальняя база — за коробкой теней
      // вид неподвижен: матрицы — один раз, каждый кадр сцена его не обходит
      g.updateMatrixWorld(true);
      g.traverse(o => { o.matrixAutoUpdate = false; });
      g.matrixWorldAutoUpdate = false;
      v.root = g; job.g = null;
      return v;
    }
    // Готовый вид — на место старого: старый (сетки, тела, подсказки) убран, новый — в сцене, тела — если база рядом
    function swapView(j, v){
      const old = W.views[j];
      if ((old?.root && old.lod === 0) || (v.root && v.lod === 0)) R.shadowDirty?.();   // тени — только у подробных (дальние их не отбрасывают)
      clearView(old);
      W.views[j] = v;
      if (v.root) R.scene.add(v.root);
      for (const [it, cx, cz] of v.spots) addItemPrompts(v, it, v.lot, cx, cz);
      v.spots = null;
      const pc = S.P.ch;
      if (v.root && plotDist(j, pc.x, pc.z) < PHYS_IN) bodiesOn(v);
    }
    // Подсказки «[E]»: своим — штаб, производство, казарма, техника, бункер; чужим — штаб (о базе, дружеский бой)
    function addItemPrompts(v, it, lot, cx, cz){
      if (it.l === 0) return;
      const at = (bx, bz) => { const [lx, lz] = rotXZ(it.r, bx, bz); return lotToWorld(lot, cx + lx, cz + lz); };
      const add = (bx, bz, r, prompt, act) => { const [wx, wz] = at(bx, bz); v.items.push(X.add({ x: wx, y: 1, z: wz, r, prompt, act })); };
      const mine = v.info.mine, D0 = WDEFS[it.k];
      if (it.k === 'th') add(0, 2.6, 1.4, () => (mine ? (giftReady() ? `🎁 Подарок дня в казну: +${giftSize()} 🧱` : '🏯 Штаб: меню базы') : `🏯 ${v.info.name}: о базе`), () => (mine ? (giftReady() ? doAct('gift') : openMenu()) : infoPanel(v.info.id)));
      if (!mine) return;
      if (WRules.isProd(it.k)) add(0, D0.d * CELL / 2 + .3, 1.3, () => { const m = W.me?.layout.find(e => e.i === it.i), n = m ? WRules.prod(m, nowS()) : 0; return n >= 1 ? `Собрать 🧱 ${n} в казну` : null; }, () => doAct('collect', { id: it.i }));
      else if (it.k === 'barracks') add(0, 1.7, 1.2, () => { const q = W.me?.queue?.length || 0; return q ? `⚔️ Казарма: тренируется ${q}` : '⚔️ Казарма: армия и набеги'; }, () => HK.go?.('#/games/raid'));
      else if (D0.slots) add(0, D0.d * CELL / 2 + .4, 1.6, () => `${D0.e} ${D0.n}: техника`, () => vehPanel(it.k, v, it));
      else if (it.k === 'bunker') add(0, 1.9, 1.3, () => '🕳️ Спуститься в бункер', () => enterBunker(v, it));
    }
    // Все 12 участков сектора — в очередь (строятся по кусочку, ближние — первыми; своя база после хода — сразу за текущей)
    function rebuildAll(){ for (let j = 0; j < PERW; j++) W.queue.add(j); }
    let job = null, deadline = 0;
    const over = () => performance.now() > deadline;
    const wantLod = (j, d) => (d < LODR.near ? 0 : d > LODR.far ? 1 : W.views[j]?.lod ?? 1);
    function stopJob(){ if (!job) return; try { job.gen.return(); } catch (e) {} if (job.g) disposeTree(job.g); job = null; }
    function pickNext(){
      const pc = S.P.ch; let best = -1, bd = Infinity;
      if (W.urgent >= 0 && W.queue.has(W.urgent)) best = W.urgent;
      else for (const j of W.queue) { const d = plotDist(j, pc.x, pc.z); if (d < bd) { bd = d; best = j; } }
      if (best < 0 || (best !== W.urgent && bd > 280)) return -1;
      return best;
    }
    // Постройка видов в пределах бюджета кадра ms (тот же вид — без постройки)
    function buildNext(ms = W.budget || (E.isMobile?.() ? 3 : 3.5)){
      const t0 = performance.now();
      for (;;) {
        if (!job) {
          const j = pickNext(); if (j < 0) return;
          W.queue.delete(j);
          const pc = S.P.ch, d = plotDist(j, pc.x, pc.z), lod = wantLod(j, d), cur = W.views[j], info = lotInfo(j);
          if (cur && cur.sig === sigOf(info) && (!info || cur.lod === lod)) { cur.info = info; if (W.urgent === j) W.urgent = -1; continue; }
          // своя база после хода — бюджет ×3, база под ногами — ×2: новое появляется через пару кадров
          job = { j, g: null, urgent: W.urgent === j, k: W.urgent === j ? 3 : d < 12 ? 2 : 1 };
          if (job.urgent) W.urgent = -1;
          job.gen = viewGen(j, lod, over, job);
        }
        deadline = t0 + ms * job.k;
        if (over()) return;
        const r = job.gen.next();
        if (!r.done) return;
        const j = job.j; job = null;
        swapView(j, r.value);
        if (performance.now() > t0 + ms) return;
      }
    }
    // Своя база поменялась: перестроить первой (идущую постройку своей базы — заново)
    function rebuildOwn(){
      if (!W.me || sectorOf(W.me.id) !== W.sector) return;
      const j = slotOf(W.me.id);
      if (job?.j === j) stopJob();
      W.queue.add(j); W.urgent = j;
    }
    // Раз в 0,25 с: тела физики у ближних баз, подробный / дальний вид по расстоянию
    let lodT = 0;
    function lodTick(dt){
      lodT += dt; if (lodT < .25) return;
      lodT = 0;
      const pc = S.P.ch;
      for (let j = 0; j < W.views.length; j++) {
        const v = W.views[j]; if (!v?.root) continue;
        const d = plotDist(j, pc.x, pc.z);
        if (!v.phys && d < PHYS_IN) bodiesOn(v); else if (v.phys && d > PHYS_OUT && !(cellar && cellar.j === j)) bodiesOff(v);
        if (wantLod(j, d) !== v.lod && !(job && job.j === j)) W.queue.add(j);
      }
    }

    // ── Ходы ──
    let chain = Promise.resolve();
    const wallet = () => ({ coins: root.D37Coins?.coins?.() ?? W.me?.coins ?? 0 });
    const donor = () => (W.me?.district != null ? { bricks: W.me.district | 0, left: W.me.give_left | 0 } : null);
    async function doAct(a, args = {}, o = {}){
      if (!W.me) { toast(WHY.member, false); return { ok: false }; }
      S.idleAt = Date.now();
      const now = nowS(), coinAct = a === 'finish' || a === 'tfinish' || (a === 'place' && WDEFS[args.k]?.coins);
      const free = ['collect', 'gift', 'finish', 'tfinish', 'give'];
      if (!free.includes(a) && !canEdit()) { toast(WHY.rank, false); sfx('buzz'); return { ok: false, reason: 'rank' }; }
      if (!coinAct) {
        const pre = WRules.act(W.me, a, args, now, undefined, a === 'give' ? donor() : undefined);
        if (!pre.ok) { toast(why(pre), false); sfx('buzz'); return pre; }
        afterChange(a, pre, o);
      }
      W.pend++;
      const res = await (chain = chain.then(() => rpc('war_act', { p_act: a, p_a: args })));
      W.pend--;
      if (W.stopped) return res;
      if (res?.ok) {
        if (coinAct) root.D37Coins?.sync?.();
        if (!W.pend) { if (W.dirty) { W.dirty = false; await refreshOwn(); } else { W.me = fromServer(res); afterChange(a, res, { quiet: true }); } }
        signal();
        if (coinAct) afterChange(a, res, o);
        if (a === 'give') try { root.dispatchEvent(new CustomEvent('d37:base')); } catch (e) {}   // участок района: кирпичи ушли в казну
      } else {
        toast(res?.reason === 'nosql' ? '📝 Сайт обновляется — попробуй позже' : why(res), false);
        if (W.pend) W.dirty = true; else await refreshOwn();
      }
      return res;
    }
    function afterChange(a, r, o = {}){
      rebuildOwn();
      if (!o.quiet) {
        if (a === 'collect' && r.got) { toast(`🧱 +${r.got} в казну`, true); sfx('coin'); }
        else if (a === 'gift' && r.got) { toast(`🎁 Подарок дня: +${r.got} 🧱 в казну`, true); sfx('coin'); }
        else if (a === 'give' && r.got) { toast(`📦 +${r.got} 🧱 в казну базы — спасибо!`, true); sfx('coin'); }
        else if (a === 'place') sfx(WDEFS[o.k]?.lv > 1 ? 'build_wood' : 'pickup');
        else if (a === 'upgrade') { sfx('build_wood'); toast('🔨 Строитель взялся за работу', true); }
        else if (a === 'finish') { sfx('coin'); toast('⚡ Готово!', true); }
        else if (a === 'move') sfx('click');
        else if (a === 'remove') sfx('pickup');
        else if (a === 'vbuy') { sfx('coin'); toast('🛒 Техника куплена — стоит у базы', true); }
      }
      renderHud(); if (W.bm) { BM.renderCat(); BM.renderSel(); }
      if (W.menuOpen) openMenu(true);
    }
    let sigT = 0;
    function signal(){ clearTimeout(sigT); sigT = setTimeout(() => { if (W.me) HK.send?.({ t: 'base', w: W.me.id, r: W.me.rev || 0 }); }, 1500); }
    const giftReady = () => !!W.me && W.me.gift !== WRules.day(nowS());
    const giftSize = () => (W.me ? Math.min(50 + 50 * WRules.th(W.me), Math.max(0, WRules.cap(W.me) - W.me.bricks)) : 0);
    async function finish(id){
      const it = W.me?.layout.find(e => e.i === id); if (!it?.ue) return;
      const n = WRules.speedCost(it, nowS());
      if (!confirm(`Достроить сразу за ${n} 🪙?`)) return;
      doAct('finish', { id });
    }

    // ── Основать базу, вступить, состав, настройки ──
    async function claim(plot, k, c){
      if (!authed()) { toast('Войди, чтобы основать базу', false); return; }
      if (!ageOk()) { toast(WHY.age, false); return; }
      const r = await rpc('war_claim', { p_plot: plot, p_name: k, p_num: null, p_color: c });
      if (r.ok) {
        W.me = fromServer(r); W.sector = sectorOf(plot);
        toast(`🏯 База «${baseName(W.me.name_k, W.me.name_n)}» — твоя! Ты главарь`, true); sfx('coin');
        HK.retrack?.(); await loadSector(); renderHud(); signal();
        setTimeout(() => toast('🔨 Нажми «Строить» — ставь казарму, пушки и стены; зови друзей ссылкой в меню базы'), 2600);
      } else toast(r.reason === 'nosql' ? '📝 Военные базы откроются, когда сайт обновится' : why(r), false);
    }
    function claimPanel(plot){
      if (!authed()) { HK.panel?.('<span class="wld-pe">🏯</span><b>Военная база</b>', `<p>Войди на сайт — и основывай свою базу: стань главарём, зови друзей, строй оборону и ходи в набеги.</p><div class="wld-acts"><button type="button" class="ct-start" data-wb="login">🔑 Войти</button></div>`); return; }
      if (!ageOk()) { toast(WHY.age, false); return; }
      if (W.me) { toast(`Ты уже в базе «${baseName(W.me.name_k, W.me.name_n)}»`); return; }
      const P0 = PLS[slotOf(plot)];
      W.pick = { plot, k: Math.floor(Math.random() * NAMES.length), c: Math.floor(Math.random() * COLORS.length) };
      const draw = () => HK.panel?.(`<span class="wld-pe">🏯</span><b>Основать базу · ${esc(P0.code)}</b>`, `<p>Участок ${esc(P0.code)} (сектор ${sectorOf(plot) + 1}) — 32 × 32 клетки${P0.coast ? ', свой берег' : ''}. Ты станешь главарём: штаб и карьер уже стоят, 🧱 ${num(WAR.start)} в казне. Друзей зови ссылкой.</p>
        <div class="wld-sublbl">Имя базы</div><div class="wld-chips wb-names">${NAMES.map((n, i) => `<button type="button" data-wb="pk:${i}"${i === W.pick.k ? ' class="ct-start"' : ''}>${esc(n)}</button>`).join('')}</div>
        <div class="wld-sublbl">Цвет флага</div><div class="wld-chips">${COLORS.map((c, i) => `<button type="button" data-wb="pc:${i}" style="background:${c};width:34px;min-width:34px;${i === W.pick.c ? 'outline:3px solid #fff' : ''}" aria-label="цвет ${i + 1}"></button>`).join('')}</div>
        <p class="mb-small">Номер к имени сервер даст сам («${esc(NAMES[W.pick.k])} 1», «… 2»). Набеги — 12+, мультяшно, без крови.</p>
        <div class="wld-acts"><button type="button" class="ct-start" data-wb="claimgo">🏯 Основать</button></div>`);
      W.pickDraw = draw; draw();
    }
    async function memberAct(act, uid){
      const r = await rpc('war_member', { p_act: act, p_uid: uid });
      if (r.ok) { W.me = fromServer(r); afterChange('sync', r, { quiet: true }); toast({ kick: '✖ Исключён из базы', promote: '⭐ Теперь офицер', demote: '🪖 Теперь боец', lead: '👑 Главарь передан' }[act] || '✓ Готово', true); membersPanel(); }
      else toast(why(r), false);
    }
    function membersPanel(){
      const me = W.me; if (!me) return;
      const t = WRules.th(me), cap = WDEFS.th.crew[t - 1];
      const row = m => {
        const self = m.uid === myUid(), R0 = RANKS[m.rank] || RANKS.soldier, acts = [];
        if (!self && isLeader()) {
          if (m.rank === 'soldier') acts.push(`<button type="button" data-wb="mem:promote:${m.uid}" title="Сделать офицером">⭐</button>`);
          if (m.rank === 'officer') acts.push(`<button type="button" data-wb="mem:demote:${m.uid}" title="Сделать бойцом">🪖</button>`);
          acts.push(`<button type="button" data-wb="mem:lead:${m.uid}" title="Передать главаря">👑</button>`);
        }
        if (!self && (isLeader() || (me.rank === 'officer' && m.rank === 'soldier'))) acts.push(`<button type="button" data-wb="mem:kick:${m.uid}" title="Исключить">✖</button>`);
        return `<div class="wb-mem"><span>${R0.e}</span><b>${esc(m.nick || 'Игрок')}${self ? ' (ты)' : ''}</b><small>${R0.n}${m.given ? ` · 📦 ${num(m.given)}` : ''}</small><span class="wb-ma">${acts.join('')}</span></div>`;
      };
      HK.panel?.(`<span class="wld-pe">👥</span><b>Состав · ${me.members.length}/${cap}</b>`, `<div class="wb-mems">${me.members.map(row).join('')}</div>
        <p class="mb-small">Звания: 👑 главарь — всё; ⭐ офицеры — строят, тренируют, исключают бойцов; 🪖 бойцы — собирают кирпичи, дарят их в казну, берут технику${me.raid_rank === 'soldier' ? ' и ходят в набеги' : ''}.</p>
        <div class="wld-acts"><button type="button" class="ct-start" data-wb="invite">🔗 Позвать в базу</button><button type="button" data-wb="menu">← База</button></div>`);
    }
    async function invite(){
      const me = W.me; if (!me) return;
      if (!canEdit()) { toast('Позвать могут главарь и офицеры — попроси у них ссылку'); return; }
      if (!me.invite) { const r = await rpc('war_set', { p_a: { code: true } }); if (r.ok) W.me = fromServer(r); }
      if (!W.me?.invite) { toast(WHY.net, false); return; }
      const url = (root.D37Ref?.wrap || (u => u))(root.D37Route ? root.D37Route.abs('#/games/raid/join/' + W.me.invite) : location.origin + '/#/games/raid/join/' + W.me.invite);
      const text = `Вступай в мою военную базу «${baseName(me.name_k, me.name_n)}» в «Мире Денчика» ⚔️ —`;
      try { if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) { await navigator.share({ title: 'Военная база', text, url }); return; } await navigator.clipboard.writeText(text + ' ' + url); toast('🔗 Ссылка скопирована — отправь друзьям', true); }
      catch (e) { prompt('Скопируй и отправь друзьям:', text + ' ' + url); }
    }
    function settingsPanel(){
      const me = W.me; if (!me || !isLeader()) return;
      HK.panel?.('<span class="wld-pe">⚙️</span><b>Настройки базы</b>', `<div class="wld-sublbl">Имя (номер сервер даст сам)</div><div class="wld-chips wb-names">${NAMES.map((n, i) => `<button type="button" data-wb="sn:${i}"${i === me.name_k ? ' class="ct-start"' : ''}>${esc(n)}</button>`).join('')}</div>
        <div class="wld-sublbl">Цвет флага</div><div class="wld-chips">${COLORS.map((c, i) => `<button type="button" data-wb="sc:${i}" style="background:${c};width:34px;min-width:34px;${i === me.color ? 'outline:3px solid #fff' : ''}" aria-label="цвет ${i + 1}"></button>`).join('')}</div>
        <div class="wld-sublbl">Кто ходит в набеги армией базы</div><div class="wld-chips"><button type="button" data-wb="sr:officer"${me.raid_rank === 'officer' ? ' class="ct-start"' : ''}>👑⭐ Главарь и офицеры</button><button type="button" data-wb="sr:soldier"${me.raid_rank === 'soldier' ? ' class="ct-start"' : ''}>👥 Все</button></div>
        <div class="wld-acts"><button type="button" data-wb="newcode">🔄 Новая ссылка-приглашение (старая перестанет работать)</button><button type="button" data-wb="menu">← База</button></div>`);
    }
    async function setBase(a){
      const r = await rpc('war_set', { p_a: a });
      if (r.ok) { W.me = fromServer(r); afterChange('sync', r, { quiet: true }); signal(); settingsPanel(); toast('✓ Готово', true); }
      else toast(why(r), false);
    }
    async function leave(){
      const me = W.me; if (!me) return;
      const alone = me.members.length <= 1;
      if (isLeader() && !alone) { toast(WHY.last, false); membersPanel(); return; }
      if (!confirm(alone ? `Распустить базу «${baseName(me.name_k, me.name_n)}»? Участок освободится, постройки и казна пропадут.` : 'Выйти из базы?')) return;
      const r = await rpc('war_leave');
      if (r.ok) { W.me = null; toast(alone ? '🏳️ База распущена' : '🚪 Ты вышел из базы', true); HK.closePops?.(); HK.retrack?.(); await loadSector(); renderHud(); }
      else toast(why(r), false);
    }
    function givePanel(){
      const me = W.me; if (!me) return;
      const left = Math.max(0, me.give_left | 0), mine = me.district;
      if (mine == null) { toast(WHY.nodonor, false); return; }
      const opts = [100, 500, 1000].filter(n => n <= Math.min(left, mine));
      HK.panel?.('<span class="wld-pe">📦</span><b>Кирпичи в казну</b>', `<p>Отдай кирпичи со своего участка района в казну базы. У тебя в районе: 🧱 ${num(mine)} · сегодня можно ещё ${num(left)}.</p>
        <div class="wld-acts">${opts.map(n => `<button type="button" data-wb="give:${n}">📦 ${num(n)}</button>`).join('') || '<span class="mb-small">Сегодня уже хватит — или в районе мало кирпичей</span>'}</div>`);
    }
    function infoPanel(id){
      const i = W.data.get(id) || (W.me?.id === id ? lotInfo(slotOf(id)) : null); if (!i) return;
      const lg = LEAGUES[league(i.tr)], sh = i.sh > nowS() ? ` · 🛡️ щит ещё ${fmtT(i.sh - nowS())}` : '';
      HK.panel?.(`<span class="wld-pe" style="color:${i.color}">🏯</span><b>${esc(i.name)}</b>`, `<p>${esc(PLS[slotOf(id)]?.code || '')} · сектор ${sectorOf(id) + 1} · 🏯 штаб ${i.layout.find(e => e.k === 'th')?.l || 1} ур.<br>👑 ${esc(i.nick)} · 👥 ${i.n || 1}<br>${lg[1]} ${lg[0]} · 🏆 ${num(i.tr)}${sh}</p>
        <div class="wld-acts"><button type="button" class="ct-start" data-wb="friendly:${id}" title="Тренировочный бой по этой базе — без добычи и кубков">🤝 Дружеский бой</button>${i.uid ? `<button type="button" data-wb="profile:${i.uid}">👤 Главарь</button>` : ''}</div>
        <p class="mb-small">Вступают по ссылке-приглашению — попроси её у главаря или офицера.</p>`);
    }
    // ── Меню базы (кнопка 🏯) ──
    function openMenu(refresh){
      const pn = S.q('.wld-panel');
      if (refresh && (!pn || pn.hidden || !pn.querySelector('.wb-menu'))) { W.menuOpen = false; return; }
      W.menuOpen = true;
      const me = W.me, now = nowS();
      let body;
      if (!me) {
        const free = PLS.slice(0, PERW).findIndex((_, j) => !lotInfo(j));
        body = `<p>Военные базы — в Боевой зоне (12+, на западе карты). Основай свою и стань главарём: штаб, казарма, пушки, вышки, стены, гараж и вертолётная площадка, бункер. Зови друзей ссылкой — они станут офицерами и бойцами. Армия базы ходит в набеги на другие базы (как в Clash of Clans).</p>
          ${W.sql === false ? '<p class="mb-small">📝 Военные базы откроются, когда сайт обновится.</p>' : ''}${!authed() ? '<p class="mb-small"><b>Войди</b> — базы только для вошедших.</p>' : !ageOk() ? `<p class="mb-small">${WHY.age}</p>` : ''}
          <div class="wld-acts">${!authed() ? '<button type="button" class="ct-start" data-wb="login">🔑 Войти</button>' : ''}<button type="button"${authed() ? ' class="ct-start"' : ''} data-wb="gofree">🏯 ${free >= 0 ? 'К свободному участку' : 'К участкам баз'}</button><button type="button" data-wb="sector">🗺️ Сектор ${W.sector + 1}</button><button type="button" data-wb="raid">⚔️ Набеги</button></div>`;
      } else {
        WRules.norm(me, now);
        const t = WRules.th(me), cap = WRules.cap(me), busy = WRules.busy(me, now), bl = WRules.builders(me), p = WRules.prodSum(me, null, now), R0 = RANKS[me.rank], lg = LEAGUES[league(me.trophies)];
        body = `<p><b style="color:${COLORS[me.color]}">🏯 ${esc(baseName(me.name_k, me.name_n))}</b> · ${esc(PLS[slotOf(me.id)]?.code || '')} · сектор ${sectorOf(me.id) + 1}<br>${R0.e} Ты — ${R0.n.toLowerCase()} · 👥 ${me.members.length}/${WDEFS.th.crew[t - 1]} · ${lg[1]} 🏆 ${num(me.trophies)}${me.shield > now ? ` · 🛡️ ${fmtT(me.shield - now)}` : ''}<br>🏯 Штаб ${t} ур. · 🧱 казна ${num(me.bricks)} / ${num(cap)} · 👷 ${busy}/${bl}${p > 0 ? `<br>⛏️ Копится: 🧱 ${num(p)}` : ''}</p>
          <div class="wld-acts"><button type="button" class="ct-start" data-wb="home">🏯 К базе</button>${canEdit() ? '<button type="button" data-wb="build">🔨 Строить</button>' : ''}${p > 0 ? `<button type="button" data-wb="collect">⛏️ Собрать 🧱 ${num(p)}</button>` : ''}${giftReady() ? '<button type="button" data-wb="gift">🎁 Подарок дня</button>' : ''}<button type="button" data-wb="give">📦 Кирпичи в казну</button></div>
          <div class="wld-acts"><button type="button" data-wb="raid">⚔️ Набеги и армия</button><button type="button" data-wb="mems">👥 Состав</button>${canEdit() ? '<button type="button" data-wb="invite">🔗 Позвать</button>' : ''}<button type="button" data-wb="veh">🚗 Техника</button>${isLeader() ? '<button type="button" data-wb="set">⚙️ Настройки</button>' : ''}<button type="button" data-wb="leave">🚪 ${isLeader() && me.members.length <= 1 ? 'Распустить' : 'Выйти'}</button></div>`;
      }
      HK.panel?.('<span class="wld-pe">🏯</span><b>Военная база</b>', `<div class="wb-menu">${body}</div>`);
    }
    function sectorPanel(){
      const n = Math.min(100, Math.max(W.sectors, W.sector + 1, W.me ? sectorOf(W.me.id) + 1 : 1));
      HK.panel?.('<span class="wld-pe">🗺️</span><b>Секторы военных баз</b>', `<p>В каждом секторе — 12 участков баз. Кто смотрит другой сектор, тот виден на участках только тебе вне участков.</p><div class="wld-acts mb-streets">${Array.from({ length: n }, (_, s) => `<button type="button" data-wb="sec:${s}"${s === W.sector ? ' class="ct-start"' : ''}>Сектор ${s + 1}${W.me && sectorOf(W.me.id) === s ? ' 🏯' : ''}</button>`).join('')}</div>`);
    }
    function setSector(s){
      if (s === W.sector || s < 0 || s >= WAR.plots / WAR.per) return;
      if (W.bm) BM.exit();
      W.sector = s; W.data.clear(); stopJob(); rebuildAll(); loadSector(); HK.retrack?.();
    }
    function teleport(x, z, yaw){
      const P0 = S.P; if (!P0) return;
      if (S.mySeat) P0.standUp();
      if (S.zones?.veh?.inVeh?.()) { toast('Сначала выйди из машины'); return false; }
      P0.place(x, null, z, yaw);
      S.rig?.snap(P0.ch.x, P0.ch.y, P0.ch.z);
      if (S.rig) S.rig.yaw = yaw - PI;
      HK.closePops?.();
      S.forceSend = true;
      return true;
    }
    function goPlot(j){
      const P0 = PLS[j], sp = P0.spawn || { x: P0.cx, z: P0.cz, yaw: 0 };
      if (zoneRect && !MZ.gateOf?.(zoneRect)?.ok) { toast(WHY.age, false); return; }
      teleport(sp.x, sp.z, sp.yaw ?? 0);
    }
    function goHome(){ if (!W.me) return; if (sectorOf(W.me.id) !== W.sector) setSector(sectorOf(W.me.id)); goPlot(slotOf(W.me.id)); }

    // ── Техника базы: выехать (машина — временная, у всех видна по сети 'vh'), купить, списать ──
    function vehSpot(k, v, it){
      const P0 = PLS[v.j];
      if (k === 'hangar') return P0.airSlot ? { x: P0.airSlot.x, z: P0.airSlot.z, yaw: P0.airSlot.yaw || 0 } : null;
      if (k === 'dock') return P0.dock ? { x: P0.dock.x, z: P0.dock.z, yaw: P0.dock.yaw || 0 } : null;
      const [cx, cz] = GW.itemCenter(it), D0 = WDEFS[k], out = k === 'helipad' ? 0 : D0.d * CELL / 2 + 3.2;
      const [lx, lz] = rotXZ(it.r, 0, out), [wx, wz] = lotToWorld(v.lot, cx + lx, cz + lz);
      return { x: wx, z: wz, yaw: v.lot.yaw + it.r * PI / 2 };
    }
    function vehPanel(k, v, it){
      const me = W.me; if (!me) return;
      const D0 = WDEFS[k], list = Object.entries(VEH).filter(([, V]) => V.b === k), used = WRules.vehIn(me, k), slots = WRules.slotsOf(me, k), lv = WRules.bestLv(me, k);
      const VD = id => E.vehicle?.get?.(id) || { name: id, icon: '🚗' };
      const owned = list.filter(([id]) => (me.veh?.[id] || 0) > 0).map(([id]) => `<button type="button" class="ct-start" data-wb="drive:${id}:${v ? v.j : -1}:${it ? it.i : 0}">${VD(id).icon} ${esc(VD(id).name)} ×${me.veh[id]} — выехать</button>`).join('');
      const shop = canEdit() ? list.map(([id, V]) => `<button type="button" data-wb="vbuy:${id}"${V.lv > lv || used >= slots ? ' disabled' : ''}>🛒 ${VD(id).icon} ${esc(VD(id).name)} · 🧱 ${num(V.cost)}${V.lv > lv ? ` (${D0.n.toLowerCase()} ${V.lv} ур.)` : ''}</button>`).join('') : '';
      const sell = canEdit() ? list.filter(([id]) => (me.veh?.[id] || 0) > 0).map(([id]) => `<button type="button" data-wb="vsell:${id}" title="Освободить место (кирпичи не вернутся)">✖ ${VD(id).icon}</button>`).join('') : '';
      HK.panel?.(`<span class="wld-pe">${D0.e}</span><b>${esc(D0.n)} · ${used}/${slots}</b>`, `${owned ? `<div class="wld-acts">${owned}</div>` : '<p>Пока пусто.</p>'}${shop ? `<div class="wld-sublbl">Купить из казны (🧱 ${num(me.bricks)})</div><div class="wld-acts">${shop}</div>${sell ? `<div class="wld-acts">${sell}</div>` : ''}` : '<p class="mb-small">Покупают главарь и офицеры. Выезжать может каждый из базы — одна машина на человека.</p>'}
        <p class="mb-small">${k === 'hangar' ? 'Самолёт ждёт на стоянке базы на аэродроме (юг зоны).' : k === 'dock' ? (PLS[v?.j ?? 0]?.dock?.own ? 'Катер — у своего берега базы.' : 'Катер — на месте базы у причала в порту (юго-запад).') : 'Техника ездит только в Боевой зоне.'}</p>`);
    }
    function drive(id, j, iid){
      const me = W.me, VS = S.zones?.veh; if (!me || !VS?.testDrive) { toast('Техника пока недоступна'); return; }
      if (!(me.veh?.[id] > 0)) { toast(WHY.noveh, false); return; }
      const v = W.views[j], it = me.layout.find(e => e.i === iid) || me.layout.find(e => e.k === VEH[id]?.b && e.l >= 1);
      if (!v || !it) { toast('Подойди к своей базе'); return; }
      const at = vehSpot(VEH[id].b, v, it); if (!at) return;
      HK.closePops?.();
      const car = VS.testDrive(id, { ...at, zone: 'war' }, { ttl: 30 * 60e3, area: 'war', msg: `${E.vehicle?.get?.(id)?.icon || '🚗'} Техника базы: ${E.vehicle?.get?.(id)?.name || id} — до 30 минут`, end: '🚗 Техника вернулась на базу' });
      if (!car) toast('Сначала выйди из машины');
    }

    // ── Бункер: подвал под участком (дыра в рельефе и плита сверху — mir-war.js, cellar); зал строится, когда спускаешься ──
    let cellar = null;
    function enterBunker(v, it){
      const P0 = PLS[v.j], C0 = P0.cellar;
      if (!C0 || !MZ?.cellarOn?.()) { toast('Бункер откроется, когда зона построится — подойди ближе'); return; }
      if (cellar && cellar.j !== v.j) leaveBunker(true);
      if (!cellar) cellar = buildCellar(v.j, C0, v.info.color);
      const [cx, cz] = GW.itemCenter(it), [hx, hz] = lotToWorld(v.lot, cx, cz);
      cellar.back = { x: hx + Math.sin(v.lot.yaw + it.r * PI / 2) * 2.2, z: hz + Math.cos(v.lot.yaw + it.r * PI / 2) * 2.2, yaw: v.lot.yaw + it.r * PI / 2 };
      S.P.place(cellar.spawn.x, C0.floor + .05, cellar.spawn.z, cellar.spawn.yaw);
      S.rig?.snap(S.P.ch.x, S.P.ch.y, S.P.ch.z);
      // камера от 3-го лица не опускается ниже земли (camera.js) — в подвале смотрим глазами персонажа, на выходе вид возвращается
      if (S.rig && S.rig.mode !== 'first' && !cellar.view) { cellar.view = S.rig.mode; const m = S.rig.toggle(); S.H?.crosshair?.(m === 'first'); }
      if (S.rig) { S.rig.yaw = cellar.spawn.yaw + PI; S.rig.fp = 0; }   // лицом к штабному столу
      S.forceSend = true; sfx('door_metal_open');
      toast('🕳️ Штабной зал базы. Лестница наверх — у стены', true);
    }
    function leaveBunker(quiet){
      const c = cellar; if (!c) return;
      if (c.view && S.rig?.mode === 'first') { const m = S.rig.toggle(); S.H?.crosshair?.(m === 'first'); if (m !== 'first') S.I?.unlock?.(); }
      if (!quiet && c.back) { S.P.place(c.back.x, null, c.back.z, c.back.yaw); S.rig?.snap(S.P.ch.x, S.P.ch.y, S.P.ch.z); S.forceSend = true; sfx('door_metal_close'); }
      for (const b of c.bodies) ph.remove(b);
      for (const i of c.items) X.remove(i);
      for (const l of c.lamps || []) { try { R.lights.remove(l); } catch (e) {} }
      disposeTree(c.root);
      cellar = null;
    }
    function buildCellar(j, C0, color){
      const g = R.group(R.scene, 0, 0, 0, 0), src = new T.Group(); g.add(src);
      const bodies = [], items = [], y0 = C0.floor, H = 3.3, top = y0 + H, cx = (C0.x0 + C0.x1) / 2, cz = (C0.z0 + C0.z1) / 2, w = C0.x1 - C0.x0, d = C0.z1 - C0.z0, t = .3;
      const box = (x, y, z, bw, bh, bd, c, o = {}) => { P(src, { s: 'box', x, y, z, w: bw, h: bh, d: bd, c, ...o }); if (o.solid !== false) bodies.push(ph.addBox({ x, y, z, hx: bw / 2, hy: bh / 2, hz: bd / 2, tag: 'mb', data: { cam: !!o.cam, floor: o.floor } })); };
      box(cx, y0 + .02, cz, w, .04, d, '#8b8478', { solid: false });                        // пол (опора — рельеф подвала)
      box(cx, top + .1, cz, w + .6, .2, d + .6, '#a8a29e', { cam: true });                  // потолок
      box(cx, y0 + H / 2, C0.z0 - t / 2, w + .6, H, t, '#c4bdb0', { cam: true }); box(cx, y0 + H / 2, C0.z1 + t / 2, w + .6, H, t, '#c4bdb0', { cam: true });
      box(C0.x0 - t / 2, y0 + H / 2, cz, t, H, d, '#c4bdb0', { cam: true }); box(C0.x1 + t / 2, y0 + H / 2, cz, t, H, d, '#c4bdb0', { cam: true });
      // штабной стол с картой, койки, ящики, флаг базы, лампы
      box(cx, y0 + .45, cz, 3.2, .9, 2, '#4d5b2a'); P(src, { s: 'box', x: cx, y: y0 + .92, z: cz, w: 3, h: .03, d: 1.8, c: '#86efac' });
      for (let i = 0; i < 3; i++) { const bx = C0.x0 + 1.2 + i * 2.2; box(bx, y0 + .35, C0.z1 - 1.1, 1.9, .5, .9, '#57534e'); P(src, { s: 'box', x: bx, y: y0 + .64, z: C0.z1 - 1.1, w: 1.8, h: .12, d: .8, c: '#a3a3a3' }); }
      box(C0.x1 - 1, y0 + .4, C0.z0 + 1, .8, .8, .8, '#a16207'); box(C0.x1 - 1.9, y0 + .3, C0.z0 + .9, .6, .6, .6, '#854d0e');
      P(src, { s: 'box', x: C0.x1 - .2, y: y0 + 2.1, z: cz, w: .04, h: .8, d: 1.3, c: color || '#ef4444' });
      const lamps = [];
      for (const lx of [cx - w / 4, cx + w / 4]) {
        P(src, { s: 'ball', x: lx, y: top - .15, z: cz, r: .18, c: '#fef9c3', m: 'glow' });
        if (R.lights?.add) lamps.push(R.lights.add({ position: new T.Vector3(lx, top - .4, cz), color: new T.Color('#fff1c1'), intensity: 2.2, distance: 12, decay: 1.6 }));   // настоящий свет в зале (на low — только ореол)
      }
      // лестница наверх (выход) — у западной стены
      const lx = C0.x0 + .45;
      for (const s2 of [-1, 1]) P(src, { s: 'box', x: lx, y: y0 + H / 2, z: cz + s2 * .4, w: .08, h: H, d: .08, c: '#9ca3af' });
      for (let y = .3; y < H; y += .4) P(src, { s: 'box', x: lx, y: y0 + y, z: cz, w: .06, h: .05, d: .8, c: '#9ca3af' });
      items.push(X.add({ x: lx + .8, y: y0 + 1, z: cz, r: 1.4, prompt: () => '⬆ Наверх', act: () => leaveBunker() }));
      items.push(X.add({ x: cx, y: y0 + 1, z: cz + 1.4, r: 1.6, prompt: () => '🗺️ Карта: меню базы', act: () => openMenu() }));
      M.merge(g, src, null);
      g.traverse(o => { if (o.isMesh) o.castShadow = false; });   // сверху — плита участка: тени солнца в зал не пускаем
      // «внутри»: камера ближе и ниже (как в домах), крыши нет — пустышка
      bodies.push(ph.addBox({ x: cx, y: y0 + H / 2, z: cz, hx: w / 2, hy: H / 2, hz: d / 2, trigger: true, tag: 'room', data: { room: 'wbc' + j, roof: new T.Group(), minP: .1, pitch: .3 } }));
      return { j, root: g, bodies, items, lamps, spawn: { x: cx - w / 4, z: cz, yaw: PI / 2 }, back: null };
    }

    // ── Клики (data-wb) ──
    const onClick = e => {
      const b = e.target.closest('[data-wb]'); if (!b || !S.el.contains(b)) return;
      const a = b.dataset.wb;
      S.idleAt = Date.now();
      if (a === 'menu') { if (S.q('.wld-panel .wb-menu') && !S.q('.wld-panel').hidden) { HK.closePops?.(); W.menuOpen = false; } else openMenu(); }
      else if (a === 'login') { if (typeof openGlobalAuth === 'function') openGlobalAuth(); }
      else if (a === 'home') goHome();
      else if (a === 'gofree') { const j = PLS.slice(0, PERW).findIndex((_, k) => !lotInfo(k)); goPlot(j >= 0 ? j : 0); }
      else if (a === 'sector') sectorPanel();
      else if (a.startsWith('sec:')) { setSector(+a.slice(4)); HK.closePops?.(); }
      else if (a === 'raid') { HK.closePops?.(); if (W.bm) BM.exit(); HK.go?.('#/games/raid'); }
      else if (a === 'build') { if (!BM.onMyLot()) goHome(); setTimeout(() => enterBuild(), 80); }
      else if (a === 'gift') doAct('gift');
      else if (a === 'collect') doAct('collect', {});
      else if (a === 'give') givePanel();
      else if (a.startsWith('give:')) { HK.closePops?.(); doAct('give', { n: +a.slice(5) }); }
      else if (a === 'mems') membersPanel();
      else if (a.startsWith('mem:')) { const [, act, uid] = a.split(':'); if (act === 'kick' && !confirm('Исключить из базы?')) return; if (act === 'lead' && !confirm('Передать главаря? Ты станешь офицером.')) return; memberAct(act, uid); }
      else if (a === 'invite') invite();
      else if (a === 'set') settingsPanel();
      else if (a.startsWith('sn:')) setBase({ name: +a.slice(3) });
      else if (a.startsWith('sc:')) setBase({ color: +a.slice(3) });
      else if (a.startsWith('sr:')) setBase({ raid: a.slice(3) });
      else if (a === 'newcode') { if (confirm('Сделать новую ссылку? Старая перестанет работать.')) setBase({ code: true }); }
      else if (a === 'leave') leave();
      else if (a === 'veh') { const it = W.me?.layout.find(e => WDEFS[e.k]?.slots && e.l >= 1); if (it) vehPanel(it.k, W.views[slotOf(W.me.id)], it); else toast('Построй гараж 🚙 — и покупай технику'); }
      else if (a.startsWith('drive:')) { const [, id, j, iid] = a.split(':'); drive(id, +j, +iid); }
      else if (a.startsWith('vbuy:')) { HK.closePops?.(); doAct('vbuy', { v: a.slice(5) }); }
      else if (a.startsWith('vsell:')) { if (confirm('Списать технику? Место освободится, кирпичи не вернутся.')) { HK.closePops?.(); doAct('vsell', { v: a.slice(6) }); } }
      else if (a.startsWith('claim:')) claimPanel(+a.slice(6));
      else if (a.startsWith('pk:')) { if (W.pick) { W.pick.k = +a.slice(3); W.pickDraw?.(); } }
      else if (a.startsWith('pc:')) { if (W.pick) { W.pick.c = +a.slice(3); W.pickDraw?.(); } }
      else if (a === 'claimgo') { if (W.pick) { HK.closePops?.(); claim(W.pick.plot, W.pick.k, W.pick.c); } }
      else if (a.startsWith('friendly:')) {
        const id = +a.slice(9), i = W.data.get(id);
        if (i) { try { sessionStorage.setItem('d37_raid_friendly', JSON.stringify({ base: id, name: i.name, layout: i.layout, skin: i.skin, t: Date.now() })); } catch (er) {} HK.closePops?.(); HK.go?.('#/games/raid/friendly/' + id); }
      }
      else if (a.startsWith('profile:')) HK.go?.('#/profile/' + a.slice(8));
      else if (a === 'exit') BM.exit();
      else if (a.startsWith('bub:')) doAct('collect', { id: +a.slice(4) });
      else BM.click(a);
    };

    // ── Экран: кнопка 🏯 в шапке, «Строить», ресурсы, каталог, пузырьки, имена баз ──
    const hud = document.createElement('div'); hud.className = 'mb-hud wb-hud';
    hud.innerHTML = hudHtml('wb') + '<div class="wb-names-tags"></div>';
    S.wrap.appendChild(hud);
    const q = s => hud.querySelector(s);
    for (const el of [q('.mb-top'), q('.mb-sel'), q('.mb-ghost'), q('.mb-cat'), q('.mb-fab')]) {
      el.addEventListener('pointerdown', e => e.stopPropagation());
      el.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    }
    if (!document.getElementById('wbCss')) {
      const st = document.createElement('style'); st.id = 'wbCss';
      st.textContent = `.wb-mems{display:grid;gap:.3rem;max-height:46vh;overflow:auto}.wb-mem{display:flex;align-items:center;gap:.45rem;padding:.3rem .45rem;border-radius:9px;background:rgba(255,255,255,.05)}
.wb-mem b{font-size:.8rem}.wb-mem small{color:var(--muted,#9ca3af);font-size:.68rem}.wb-ma{margin-left:auto;display:flex;gap:.25rem}.wb-ma button{border:1px solid var(--border,#444);background:rgba(255,255,255,.07);color:#fff;border-radius:8px;min-width:34px;min-height:34px;cursor:pointer}
.wb-names{max-height:30vh;overflow:auto}.wb-hud .wb-names-tags{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.wb-tag{position:absolute;left:0;top:0;will-change:transform;white-space:nowrap;padding:3px 9px;border-radius:9px;background:rgba(12,10,24,.78);color:#fff;font:800 11px Montserrat,sans-serif;border-left:4px solid var(--c,#ef4444)}`;
      document.head.appendChild(st);
    }
    const topBtn = document.createElement('button');
    topBtn.type = 'button'; topBtn.dataset.wb = 'menu'; topBtn.title = 'Военная база'; topBtn.innerHTML = '🏯<span> База</span>'; topBtn.hidden = true;
    S.q('.wld-topbtns')?.prepend(topBtn);
    S.el.addEventListener('click', onClick);
    function renderHud(){
      const bm = W.bm, me = W.me, now = nowS();
      q('.mb-top').hidden = !bm; q('.mb-cat').hidden = !bm;
      S.wrap.classList.toggle('mb-building', !!bm);
      if (!bm) { q('.mb-sel').hidden = true; q('.mb-ghost').hidden = true; }
      if (me && bm) {
        q('.mbBr').innerHTML = `🧱 <b>${num(me.bricks)}</b>/${num(WRules.cap(me))}`;
        q('.mbBl').innerHTML = `👷 <b>${WRules.busy(me, now)}/${WRules.builders(me)}</b>`;
        q('.mbCo').innerHTML = `🪙 <b>${num(root.D37Coins?.coins?.() ?? me.coins ?? 0)}</b>`;
        q('.mb-gift').hidden = !giftReady();
      }
    }
    const WTABS = [['b', ['🏯 Постройки', ['barracks', 'mine', 'factory', 'store', 'shop', 'bunker']]], ['o', ['🛡️ Оборона', ['tower', 'cannon', 'mortar', 'bomb', 'airmine']]], ['v', ['🚗 Техника', ['garage', 'helipad', 'hangar', 'dock']]],
      ['w', ['🧱 Стены', ['wall']]], ['d', ['🚩 Украшения', ['flag', 'lamp', 'bags', 'crates', 'rock', 'pine', 'bush']]]];
    const BM = makeBuilder(S, W, {
      attr: 'wb', G: GW, D: WDEFS, tabs: WTABS, q, war: true, wallST: WALL_WST, draw: WDRAW, color: () => (W.me ? COLORS[W.me.color] : null), far: 'Подойди к своей базе в Боевой зоне',
      camMax: 70, camDist: 46, camSpeed: 22,
      view: () => (W.me && sectorOf(W.me.id) === W.sector ? W.views[slotOf(W.me.id)] : null),
      act: doAct, wallet, local: () => false, now: nowS, sfx, toast, why, renderHud, finish,
      info: (it, lines, acts) => {
        if (it.k === 'barracks' && it.l >= 1) acts.push('<button type="button" data-wb="raid">⚔️ Армия и набеги</button>');
        if (WDEFS[it.k].slots && it.l >= 1) acts.push(`<button type="button" data-wb="veh">🚗 Техника</button>`);
      },
    });
    function enterBuild(){
      if (!W.me) { openMenu(); return false; }
      if (!canEdit()) { toast(WHY.rank, false); return false; }
      return BM.enter();
    }
    W.enterBuild = enterBuild;
    W.wantsBuild = () => !!W.me && BM.onMyLot();
    W.here = () => inZone(S.P.ch.x, S.P.ch.z, 10);   // в боевой зоне клавиша B — стройка базы (или меню базы)
    W.buildKey = () => { if (W.bm) BM.exit(); else enterBuild(); };   // клавиша B (её слушает менеджер района — один раз за кадр)
    W.openMenu = openMenu;
    const tags = makeTags(R, q('.mb-tags'), GW, 'wb');
    // имена баз над штабами (рядом)
    const nameEls = new Map();
    // (место и текст надписи считаются один раз на вид — v.nm; за кадр — только проекция и сдвиг, без мусора)
    let namesWrap = null;
    function drawNames(){
      const cam = R.camera.position;
      namesWrap = namesWrap || q('.wb-names-tags');
      for (const [k, el] of nameEls) el._seen = false;
      for (const v of W.views) {
        if (!v?.info || !v.root?.visible) continue;
        let nm = v.nm;
        if (nm === undefined) {
          const th = v.info.layout.find(e => e.k === 'th');
          if (th) { const [cx, cz] = GW.itemCenter(th), [wx, wz] = lotToWorld(v.lot, cx, cz); nm = { x: wx, z: wz, y: (v.hts.get(th.i) || 6) + 1.2, txt: `🏯 ${v.info.name}${v.info.mine ? ' · моя' : ''}`, sx: -1, sy: -1 }; }
          v.nm = nm = nm || null;
        }
        if (!nm || Math.hypot(cam.x - nm.x, cam.z - nm.z) > 90) continue;
        const pr = R.project(nm.x, nm.y, nm.z); if (!pr[2]) continue;
        let el = nameEls.get(v.j);
        if (!el) { el = document.createElement('div'); el.className = 'wb-tag'; namesWrap.appendChild(el); nameEls.set(v.j, el); }
        if (el._txt !== nm.txt) { el._txt = el.textContent = nm.txt; el.style.setProperty('--c', v.info.color); }
        const sx = Math.round(pr[0]), sy = Math.round(pr[1]);
        if (sx !== el._sx || sy !== el._sy) { el._sx = sx; el._sy = sy; el.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-100%)`; }
        el._seen = true;
      }
      for (const [k, el] of nameEls) if (!el._seen) { el.remove(); nameEls.delete(k); }
    }
    // Табличка участка (mir-war.js): подсказка и действие
    W.signPrompt = P0 => {
      const j = PLS.indexOf(P0); if (j < 0) return null;
      const i = lotInfo(j), id = W.sector * WAR.per + j + 1;
      if (!i) return W.me ? `🏯 ${P0.code} · сектор ${W.sector + 1}: свободен` : `🏯 Основать базу здесь (${P0.code}, сектор ${W.sector + 1})`;
      return i.mine ? `🏯 Моя база «${i.name}»: меню` : `🏯 ${i.name}: о базе`;
      void id;
    };
    W.signAct = P0 => {
      const j = PLS.indexOf(P0); if (j < 0) return false;
      const i = lotInfo(j), id = W.sector * WAR.per + j + 1;
      if (!i) { if (W.me) { toast(`Ты уже в базе «${baseName(W.me.name_k, W.me.name_n)}»`); return true; } claimPanel(id); return true; }
      if (i.mine) openMenu(); else infoPanel(id);
      return true;
    };

    // ── Шаг и кадр ──
    let tick = 0, presT = 0;
    W.update = dt => {
      tick += dt; presT += dt;
      const pc = S.P.ch, near = inZone(pc.x, pc.z, 120);
      if (near !== W.near) { W.near = near; if (near) { if (Date.now() - W.loadT > 20000) loadSector(); rebuildAll(); } }
      BM.update(dt);
      if (presT > .5) { presT = 0; hideOthers(); }
      if (W.near) { lodTick(dt); buildNext(); }
      if (tick > 90 && (W.near || W.bm)) { tick = 0; loadSector(); }
      if (W.bm && !W.me) BM.exit();
      // ушёл далеко — виды баз убраны (память, тела)
      if (!near && (job || W.views.some(v => v?.root)) && !inZone(pc.x, pc.z, 260)) { stopJob(); for (const v of W.views) clearView(v); W.views = []; }
      if (cellar && pc.y > -1.5) leaveBunker(true);   // вышел из подвала не по лестнице (телепорт, карта)
    };
    W.frame = (dt, t) => {
      const cam = R.camera.position;
      for (const v of W.views) if (v?.root) { const d = Math.hypot(cam.x - v.lot.x, cam.z - v.lot.z); v.root.visible = d < 230; }
      const inz = inZone(S.P.ch.x, S.P.ch.z, 40);
      if (topBtn.hidden === (inz || !!W.me)) topBtn.hidden = !(inz || !!W.me);
      const fab = W.fab || (W.fab = q('.mb-fab')), canB = canEdit() && !W.bm && BM.onMyLot();
      if (fab.hidden === canB) fab.hidden = !canB;
      BM.frame(t);
      if ((W.near || W.bm) && !cellar) { tags.draw(W.views, W.me, nowS(), true); drawNames(); } else { tags.clear(); for (const el of nameEls.values()) el.remove(); nameEls.clear(); }   // в подвале надписи баз сверху не видны
    };
    // Чужие из другого сектора — на участках баз не видны (и в бою зоны не цели — mir-war.js смотрит p.wbHide)
    function hideOthers(){
      const st = S.ch?.presenceState?.() || {};
      for (const p of S.players.values()) {
        const metas = st[p.key]; let ws = null;
        if (Array.isArray(metas) && metas.length) { const m = metas.reduce((a, b) => ((b.at || 0) >= (a.at || 0) ? b : a), metas[0]); if (Number.isInteger(m.ws)) ws = m.ws; }
        p.wbHide = ws != null && ws !== W.sector && !!MW.inPlot?.(p.ch.x, p.ch.z);
        const a = S.A?.get(p.key); if (a) a.hidden = !!p.mbHide || !!p.wbHide;
      }
    }
    let reloadT = 0;
    W.onMsg = (p, d) => {
      if (!Number.isInteger(d.w) || sectorOf(d.w) !== W.sector) return;
      if (W.me && d.w === W.me.id) { clearTimeout(reloadT); reloadT = setTimeout(() => refreshOwn(), 900); return; }
      const cur = W.data.get(d.w);
      if (cur && cur.rev >= (d.r | 0)) return;
      clearTimeout(reloadT); reloadT = setTimeout(() => loadSector(), 900);
    };
    const onPtr = e => { if (e.pointerType === 'mouse') W.ptr = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    S.wrap.addEventListener('pointermove', onPtr);
    const onAuth = () => { if (!W.stopped) { if (W.bm) BM.exit(); init(); } };
    root.addEventListener('d37:auth', onAuth);
    // набеги (raid.js) поменяли базу (армия, добыча, казарма) — перечитать; «🔨 Строить оборону» — к базе и в стройку
    const onBase = () => { if (!W.stopped && W.me) refreshOwn(); };
    root.addEventListener('d37:base', onBase);
    const goBuild = () => { if (W.stopped || !W.me) return; goHome(); setTimeout(() => { if (!W.stopped && !W.bm && enterBuild() && W.bm) { W.bm.tab = 'o'; BM.renderCat(); } }, 500); };
    // «🏯 К военным базам» из «Набегов»: своя база — к ней; нет — к свободному участку; и меню базы
    const goWb = () => { if (W.stopped) return; if (W.me) goHome(); else { const j = PLS.slice(0, PERW).findIndex((_, k) => !lotInfo(k)); goPlot(j >= 0 ? j : 0); } setTimeout(() => { if (!W.stopped) openMenu(); }, 400); };
    const onMb = e => { if (e?.detail === 'build') goBuild(); else if (e?.detail === 'wb') goWb(); };
    root.addEventListener('d37:mb', onMb);
    let mbGo = null; try { mbGo = sessionStorage.getItem('d37_mb_go'); sessionStorage.removeItem('d37_mb_go'); } catch (e) {}
    W.dispose = () => {
      W.stopped = true;
      BM.dispose();
      leaveBunker(true);
      stopJob();
      for (const v of W.views) clearView(v);
      S.el.removeEventListener('click', onClick);
      S.wrap.removeEventListener('pointermove', onPtr);
      root.removeEventListener('d37:auth', onAuth);
      root.removeEventListener('d37:base', onBase);
      root.removeEventListener('d37:mb', onMb);
      clearTimeout(sigT); clearTimeout(reloadT);
      tags.clear(); hud.remove(); topBtn.remove();
      M.dispose();
    };
    W._test = {
      views: () => W.views.filter(v => v?.root).length, lotInfo, BM, enterBunker, leaveBunker, cellar: () => cellar, setSector, PLS, LOTW,
      // замер: все участки сектора — базы штаба th (по максимуму), строятся сразу
      fill: async (th = 5) => { W.data.clear(); for (let j = 0; j < PERW; j++) { const id = W.sector * WAR.per + j + 1; W.data.set(id, infoOf({ id, name_k: j % NAMES.length, name_n: 1, color: j % COLORS.length, uid: null, nick: 'Тест', layout: fillLayout(th, j + 1), rev: 1, tr: 0, sh: 0, skin: '', n: 1 })); }
        W.near = true; rebuildAll(); for (let k = 0; k < 4000 && (W.queue.size || job); k++) { buildNext(50); await new Promise(r => setTimeout(r, 0)); } return W.views.filter(v => v?.root).length; },
      me: m => { W.me = m ? fromServer(m) : null; rebuildAll(); renderHud(); },
      job: () => (job ? { j: job.j, urgent: job.urgent } : null), lodRange: (a, b) => { LODR.near = a; LODR.far = b; rebuildAll(); }, budget: ms => { W.budget = ms; }, lod: () => W.views.map(v => (v?.root ? v.lod : null)), phys: () => W.views.map(v => (v?.root ? (v.phys ? v.bodies.length : 0) : null)),
    };
    init().then(() => { if (mbGo === 'build') goBuild(); else if (mbGo === 'wb') goWb(); });
    return W;
  }

  root.MirBase = { DEFS, FURN, WDEFS, UNITS, HERO, RAID, LEAGUES, league, SKINS, VEH, NAMES, COLORS, RANKS, WAR, baseName, SERVER, WSERVER, Rules, WRules, makeRules, Geo, GW, WHY, zone, build, start, startWar, fillLayout, fmtT,
    _draw: { DRAW, WDRAW, FDRAW, WALL_ST, WALL_WST, drawWall, wallRunsLocal, detailOf } };
})();
