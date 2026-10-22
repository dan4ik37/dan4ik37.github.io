// ═══════════════════════════════════════
//  «ВСЕЛЕННАЯ ДЕНЧИКА»: ПУТЬ ОТ МИКРОБА — window.D37Evo (шаг 1: «Клетка», T-056, docs/plans/universe-path.md §1.2)
// ═══════════════════════════════════════
// Один файл без DOM при загрузке (грузится и в node — тесты, генератор evo_defs, симуляция evo-sim):
//   • каталог — ВСЕ числа стадии клетки в одном месте: части клетки (цена в ДНК, места на мембране, с какой стадии, свойства в игре),
//     микро-биомы (Лужа, Риф, Глубина), виды микро-жизни (энциклопедия «Микромир» и боты), вехи стадий, лимиты, формы колонии,
//     задания дня, цели жизни, планы тела «На сушу», имена рода, родина рода. SERVER → evo_defs0() в evo.sql
//     (собирает node scripts/gen-evo-defs.cjs; руками JSON в evo.sql не править). Числа — предложение (P); админ меняет без кода
//     (evo_admin('cfg'), ключи из белого списка cfgk).
//   • Rules — те же правила, что evo_act на сервере (start / life / buy / design / name / land / import): клиент показывает сразу,
//     сервер решает; тест PGlite гоняет одни и те же случайные ходы через оба (scripts/evo-sql-test.mjs).
//   • light — свет у родины рода: местный час (фаза A — часы «Мира Денчика», как E.dayClock(мс, 40, .2)), время года (climate.js).
//   • worldCfg(биом) — настройки мира «Клеточек» для пути (kletochki.js newWorld(seed, cfg)): свойства частей, биом, свет.
//   • api — сервер (evo.sql) или «пробный род» в браузере (гость; evo.sql ещё не выполнен; нет связи). Пробный род переносится в
//     аккаунт один раз, не дальше стадии «Колония» (сервер сам режет).
// Ценное (стадия, ДНК, «На сушу») решает сервер: ДНК за жизнь — не больше rate в минуту по его часам (билет start → life), за день —
// не больше caps.day, вехи — по его счёту минут. Обман вредит только себе: ДНК и стадия — свои, без 🪙/💎/XP (их дают только
// старые ключи «Клеточек»). Ничего платного: части — за ДНК, мутаций за деньги нет.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37Evo) return;

  const V = 1;   // фаза сервера: evo_defs ->> 'v'
  const SLOTS = 6;   // мест на мембране

  // ═══ Части клетки: цена (ДНК), мест на мембране, с какой стадии (1 — Клетка, 2 — Органоиды, 3 — Колония), сколько можно иметь,
  //     L — буква в коде облика (сеть), sim — свойства в игре (bodyStats в kletochki.js: speed/view/eat/turn/sugar/prot — множители,
  //     dark/glow/leaf/adh — складываются, spikes/def/toxin — есть или нет). Ни одна часть не лучше всех: у каждой своя цена ═══
  const CELL = {
    flagellum: { n: 'Жгутик', e: '〰️', L: 'f', cost: 25, slots: 1, at: 1, max: 2, d: 'Плывёшь быстрее', sim: { speed: 1.1 } },
    cilia: { n: 'Реснички', e: '🪶', L: 'c', cost: 20, slots: 1, at: 1, max: 1, d: 'Резче поворачиваешь и чуть быстрее', sim: { turn: 1.6, speed: 1.02 } },
    eye: { n: 'Глазок', e: '👁️', L: 'e', cost: 25, slots: 1, at: 1, max: 2, d: 'Видишь дальше, в темноте — лучше', sim: { view: 1.12, dark: .3 } },
    leaf: { n: 'Хлоропласт', e: '🌿', L: 'l', cost: 30, slots: 1, at: 1, max: 3, d: 'Сахар прямо из света, но плывёшь медленнее', sim: { leaf: 1, speed: .95 } },
    jaw: { n: 'Хищный рот', e: '🦷', L: 'j', cost: 40, slots: 1, at: 2, max: 1, d: 'Ешь клетки почти своего размера, белка больше, сахара меньше', sim: { eat: .92, prot: 1.5, sugar: .6 } },
    spikes: { n: 'Шипы', e: '📌', L: 's', cost: 35, slots: 1, at: 2, max: 1, d: 'Колючки тебя не рвут; чуть медленнее', sim: { spikes: 1, speed: .94 } },
    photo: { n: 'Фотофор', e: '✨', L: 'p', cost: 45, slots: 1, at: 2, max: 2, d: 'Светишься: в темноте видно дальше, еда тянется к свету', sim: { glow: 1, dark: .45 } },
    adhesion: { n: 'Липкость', e: '🧲', L: 'h', cost: 60, slots: 1, at: 2, max: 3, d: 'После деления клетки держатся вместе: колония +2', sim: { adh: 1 } },
    armour: { n: 'Панцирь', e: '🛡️', L: 'a', cost: 50, slots: 2, at: 3, max: 1, d: 'Худеешь вдвое медленнее, съесть труднее; медленнее', sim: { def: 1, guard: .1, speed: .9 } },
    toxin: { n: 'Ядовитое облачко', e: '☁️', L: 't', cost: 55, slots: 1, at: 3, max: 1, d: 'Кто рядом — плывёт медленнее', sim: { toxin: 1, speed: .97 } },
    pigment: { n: 'Пигмент', e: '🎨', L: '', cost: 15, slots: 0, at: 1, max: 1, d: 'Два особых узора рода — «Перламутр» и «Неон» (только вид)', sim: {} },
  };
  const PART_IDS = Object.keys(CELL);
  const BY_L = {};
  for (const id of PART_IDS) if (CELL[id].L) BY_L[CELL[id].L] = id;

  // ═══ Формы колонии: роль клеток колонии (кроме «сердца») — m гребцы (быстрее), g стражи (съесть труднее), e едоки (едят легче) ═══
  // pos — места клеток 1…6 относительно сердца (x — вперёд по ходу, y — вбок), в долях «шага» (сумма радиусов + зазор)
  const FORMS = {
    chain: { n: 'Цепочка', e: '🚣', L: 'c', role: 'm', d: 'Гребцы сзади — колония плывёт быстрее', pos: [[-1, 0], [-2, 0], [-3, 0], [-4, 0], [-5, 0], [-6, 0]] },
    ring: { n: 'Кольцо', e: '🛡️', L: 'r', role: 'g', d: 'Стражи вокруг — клетки колонии труднее съесть', pos: [[1, 0], [-.5, .87], [-.5, -.87], [.5, .87], [.5, -.87], [-1, 0]] },
    wedge: { n: 'Клин', e: '🍴', L: 'w', role: 'e', d: 'Едоки впереди — добычу съесть легче, белка больше', pos: [[.8, .6], [.8, -.6], [1.6, 1.2], [1.6, -1.2], [2.4, 1.8], [2.4, -1.8]] },
  };
  const FORM_IDS = Object.keys(FORMS);
  // сила ролей (на клетку роли): гребец — скорость колонии +4 %, страж — нужна масса больше на 6 %, едок — ест на 3 % легче, белок +10 %
  const ROLES = { m: { speed: .04 }, g: { guard: .06 }, e: { eat: .03, prot: .1 } };

  // ═══ Микро-биомы (арены пути): с какой стадии, свет [днём, ночью], еды (сахар за точку и как быстро растёт), доля минералов,
  //     кто живёт (виды MICRO — боты), гиганты, злость ботов ═══
  const BIOMES = {
    pool: { n: 'Лужа', e: '💧', at: 1, light: [1, .5], food: 1, min: 0, bots: ['drop', 'drop', 'green'], aggr: .35, giants: 0, d: 'Светло и спокойно: слабые клетки и много сахара. Учись тут.' },
    reef: { n: 'Риф', e: '🪸', at: 2, light: [.92, .38], food: 1.35, min: 0, bots: ['teeth', 'hedge', 'green', 'drop'], aggr: 1.1, giants: 0, d: 'Еды больше, но тут хищники с зубами.' },
    deep: { n: 'Глубина', e: '🌑', at: 3, light: [.18, .12], food: .85, min: .04, bots: ['firefly', 'teeth', 'drop'], aggr: .9, giants: 2, d: 'Темно: нужны глазки и фотофоры. Минералы 🪨 и гиганты.' },
  };
  const BIOME_IDS = Object.keys(BIOMES);

  // ═══ «Микромир»: виды микро-жизни (энциклопедия; боты пути). b — где живёт ('any' — везде), parts — части бота ═══
  const MICRO = {
    drop: { n: 'Капелька', e: '💧', b: 'pool', parts: [], d: 'Самая простая клетка: ест сахар и никого не трогает.' },
    green: { n: 'Зелёнка', e: '🌿', b: 'pool', parts: ['leaf', 'leaf'], d: 'Живёт светом: днём сытая и неторопливая.' },
    teeth: { n: 'Зубастик', e: '🦷', b: 'reef', parts: ['jaw', 'flagellum'], d: 'Хищник рифа: быстрый, с зубами. Держись подальше, пока мал.' },
    hedge: { n: 'Ёжик', e: '📌', b: 'reef', parts: ['spikes', 'armour', '='], d: 'Колючий и в панцире — его трудно съесть.' },
    firefly: { n: 'Светлячок', e: '✨', b: 'deep', parts: ['photo', 'eye'], d: 'Светится в темноте и приманивает еду.' },
    giant: { n: 'Гигант', e: '🐋', b: 'deep', parts: ['eye'], giant: 1, d: 'Огромная медленная клетка глубины. Не попадайся!' },
    spike: { n: 'Колючка', e: '🌵', b: 'any', d: 'Рвёт больших на кусочки, а маленьким — укрытие.' },
    mineral: { n: 'Минерал', e: '🪨', b: 'deep', d: 'Редкий кристалл глубины: +2 ДНК.' },
  };
  const MICRO_IDS = Object.keys(MICRO);   // порядок = бит в маске «видел» (сеть, сервер) — только дописывать в конец

  // ═══ Стадии и вехи (сервер считает сам): earned — ДНК получено всего, colony — колония из стольких клеток хоть раз, min — минут
  //     пути по часам сервера, biomes — где побывал. 5 — «На суше» (выбран план тела) ═══
  const STAGES = [null,
    { id: 'c1', n: 'Клетка', e: '🦠', d: 'Первая клетка рода — в капле воды у берега' },
    { id: 'c2', n: 'Органоиды', e: '🧬', d: 'У клетки свои части — открылся Риф' },
    { id: 'c3', n: 'Колония', e: '🫧', d: 'Клетки держатся вместе и делят работу — открылась Глубина' },
    { id: 'c4', n: 'Готов к суше', e: '🌊', d: 'Род готов выйти на сушу' },
    { id: 'land', n: 'На суше', e: '🌱', d: 'Род вышел на сушу — дальше «Существо»' },
  ];
  const MILES = { 2: { parts: 1 }, 3: { earned: 250, colony: 3, min: 20 }, 4: { earned: 550, colony: 5, min: 45, biomes: ['reef', 'deep'] } };

  // ═══ Лимиты: day — ДНК в день (МСК), rest — первые столько сырой ДНК в день ×2 («отдохнувший»), actMin — ходов в минуту,
  //     life — секунд жизни в счёт, minLife — короче не идёт в минуты пути, rate — сырой ДНК в минуту жизни (+ slack на жизнь),
  //     goal — ДНК за цель жизни, task — за задание дня (сверх лимита дня), imp — перенос пробного рода (не дальше «Колонии») ═══
  const CAPS = { day: 300, rest: 60, actMin: 30, life: 330, minLife: 5, rate: 40, slack: 15, goal: 8, task: 25, mass: 50000, kills: 60,
    imp: { earned: 400, dna: 300, play: 1500, col: 3 } };

  // ═══ Задание дня (одно на всех, по номеру дня МСК; сверх лимита дня) и цели жизни (свои у каждой жизни) ═══
  // k: pel — съесть точек, life — прожить секунд, mass — масса, kills — съесть клеток, col — колония, min — минералов
  const TASKS = [
    { k: 'pel', v: 60, n: 'Съешь 60 точек сахара за одну жизнь' },
    { k: 'life', v: 150, n: 'Проживи 2,5 минуты, не попавшись' },
    { k: 'mass', v: 150, n: 'Вырасти до массы 150' },
    { k: 'kills', v: 2, n: 'Съешь 2 клетки за одну жизнь' },
    { k: 'pel', v: 100, n: 'Съешь 100 точек сахара за одну жизнь' },
    { k: 'mass', v: 250, n: 'Вырасти до массы 250' },
  ];
  const GOALS = [
    { k: 'pel', v: 30, n: 'Съешь 30 точек' }, { k: 'life', v: 90, n: 'Продержись 1,5 минуты' }, { k: 'mass', v: 80, n: 'Вырасти до 80' },
    { k: 'kills', v: 1, n: 'Съешь одну клетку' }, { k: 'col', v: 3, n: 'Собери колонию из 3', need: 'adh' }, { k: 'min', v: 2, n: 'Найди 2 минерала', b: 'deep' },
  ];

  // ═══ «На сушу»: план тела и питание — с чего начнёт существо (шаблон для стадии «Существо», T-057/T-059) ═══
  const PLANS = {
    crawler: { n: 'Ползун', e: '🦎', d: 'Ноги с первых шагов: быстро бегает по берегу', body: { legs: 2, fins: 0, tail: 1, shell: 0 } },
    swimmer: { n: 'Пловец', e: '🐟', d: 'Плавники и хвост: в воде — быстрее всех', body: { legs: 0, fins: 2, tail: 1, shell: 0 } },
    shell: { n: 'Панцирник', e: '🐢', d: 'Крепкий панцирь: медленно, зато надёжно', body: { legs: 2, fins: 0, tail: 0, shell: 1 } },
  };
  const DIETS = { plant: { n: 'Растения', e: '🌿' }, meat: { n: 'Мясо', e: '🍖' }, both: { n: 'Всё подряд', e: '🍽️' } };

  // ═══ Имя рода — из готовых слов (без ввода текста: детям и всем — без модерации) ═══
  const NAME_A = ['Мерцающие', 'Быстрые', 'Зелёные', 'Тихие', 'Смелые', 'Хитрые', 'Светлые', 'Морские', 'Рифовые', 'Глубинные', 'Колючие', 'Липкие',
    'Солнечные', 'Лунные', 'Звёздные', 'Пушистые', 'Весёлые', 'Древние', 'Юркие', 'Дружные', 'Пёстрые', 'Ловкие', 'Сонные', 'Голодные'];
  const NAME_B = ['Капли', 'Искры', 'Пузыри', 'Звёзды', 'Ракушки', 'Брызги', 'Крупинки', 'Волны', 'Огоньки', 'Кляксы', 'Бусинки', 'Росинки',
    'Жгутики', 'Пятнышки', 'Колечки', 'Зёрнышки', 'Ягодки', 'Облачка', 'Шарики', 'Медузки', 'Камешки', 'Ниточки', 'Листики', 'Снежинки'];

  // ═══ Родина рода — место у воды на карте «Мира Денчика» (фаза A; позже — регион планеты, docs/plans/universe-path.md §2.1).
  //     Отсюда свет и время года; здесь же род выйдет на сушу (стадия «Существо») ═══
  const HOMES = [
    { id: 'pond', n: 'Пруд в парке', region: 'mir', x: 38, z: 34 },
    { id: 'zerk', n: 'Озеро Зеркальное', region: 'mir', x: -890, z: -750 },
    { id: 'tihoe', n: 'Озеро Тихое', region: 'mir', x: 1115, z: 700 },
    { id: 'gornoe', n: 'Горное озеро', region: 'mir', x: -1550, z: -2150 },
    { id: 'bystraya', n: 'Река Быстрая', region: 'mir', x: -900, z: -1100 },
    { id: 'svetlaya', n: 'Река Светлая', region: 'mir', x: 820, z: 1400 },
    { id: 'sea', n: 'Морской берег', region: 'mir', x: -1200, z: 70 },
  ];

  // ═══ Числа игры пути (kletochki.js читает их из worldCfg) ═══
  // sugar — ДНК за точку (× еда биома × sugar частей); leaf — ДНК в минуту за хлоропласт при полном свете; prot — ДНК за съеденную
  // клетку (масса × prot, не больше protMax; × prot частей и едоков); minM — масса минерала; lure — фотофор в темноте: радиус поедания
  // точек +lure за фотофор; tox — облачко (радиус, во сколько медленнее); col — колония (k — доля массы колонии, что защищает клетку;
  // spring — пружина к месту в форме; gap — зазор; share — обмен массой к средней раз в 0,5 с); giant — гиганты глубины
  const SIMK = { sugar: .1, leaf: 1.1, prot: .05, protMax: 5, minM: 3, lure: 30, tox: { r: 70, k: .75 }, col: { k: .35, spring: 6, gap: 10, share: .03 },
    giant: { m: 1800, floor: 1500, speed: .45 }, dark: .25, seeR: 1 };

  // Что увидит сервер (evo_defs0): только то, что он проверяет
  const SERVER = {
    v: V, slots: SLOTS, parts: PART_IDS, biomeIds: BIOME_IDS,   // порядок — массивами (у jsonb ключи объекта идут не по порядку)
    cell: Object.fromEntries(PART_IDS.map(id => [id, { cost: CELL[id].cost, slots: CELL[id].slots, at: CELL[id].at, max: CELL[id].max }])),
    biomes: Object.fromEntries(BIOME_IDS.map(id => [id, { at: BIOMES[id].at, min: BIOMES[id].min > 0 ? 1 : 0 }])),
    micro: MICRO_IDS.map(id => [id, MICRO[id].b]),
    forms: FORM_IDS, plans: Object.keys(PLANS), diets: Object.keys(DIETS),
    miles: MILES, caps: CAPS, tasks: TASKS.map(t => [t.k, t.v]), names: [NAME_A.length, NAME_B.length], patterns: 10,
    homes: HOMES.map(h => ({ id: h.id, region: h.region, x: h.x, z: h.z })),
    awake: 1,   // временный обход (план §0): пока нет стадии «Существо», «На сушу» сразу даёт «Пробуждение» (флаг сервера)
    cfgk: [['caps.day', 0, 5000], ['caps.rest', 0, 1000], ['caps.actMin', 5, 300], ['caps.rate', 1, 1000], ['caps.slack', 0, 500], ['caps.task', 0, 500],
      ['caps.goal', 0, 100], ['cell.*.cost', 0, 5000], ['miles.3.earned', 0, 100000], ['miles.3.min', 0, 600], ['miles.4.earned', 0, 100000], ['miles.4.min', 0, 600],
      ['awake', 0, 1]],
  };

  // ═══ Свет у родины рода ═══
  // Фаза A: часы «Мира Денчика» одни на всю карту — сутки 40 мин, ночь — пятая часть (то же, что E.dayClock(мс, 40, .2) в gfx.js, mir.js)
  const mirHour = ms => { const p = ((ms / 60000 / 40) % 1 + 1) % 1, d = .8; return p < d ? 6 + p / d * 12 : (18 + (p - d) / (1 - d) * 12) % 24; };
  // Время года: фаза φ (0 весна, 1 лето, 2 осень, 3 зима) — climate.js (календарь владельца); без него — та же формула, что в planet.js
  function seasonPhase(ms){
    const C = root.D37E?.climate;
    if (C?.phaseCal) { try { return C.phaseCal(ms); } catch (e) {} }
    const t = ms + 180 * 60000, dt = new Date(t), y = dt.getUTCFullYear(), mo = dt.getUTCMonth();
    if (mo === 11) return 3 + (t - Date.UTC(y, 11, 1)) / (Date.UTC(y + 1, 2, 1) - Date.UTC(y, 11, 1));
    if (mo <= 1) return 3 + (t - Date.UTC(y - 1, 11, 1)) / (Date.UTC(y, 2, 1) - Date.UTC(y - 1, 11, 1));
    return (7 * (t - Date.UTC(y, 2, 1)) / (Date.UTC(y, 11, 1) - Date.UTC(y, 2, 1))) % 4;
  }
  const SEASON_K = [1, 1.08, .94, .82];   // сила солнца: весна, лето, осень, зима (зимой у берега темнее)
  const SEASON_N = ['Весна', 'Лето', 'Осень', 'Зима'], SEASON_E = ['🌸', '☀️', '🍂', '❄️'];
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // день: 0 ночью, 1 днём, плавно на заре (5…7) и в сумерках (17…19)
  const daylight = h => smooth(5, 7, h) * (1 - smooth(17, 19, h));
  function lightAt(b, ms){
    const B = BIOMES[b] || BIOMES.pool, ph = seasonPhase(ms), i = Math.floor(((ph % 4) + 4) % 4), k = SEASON_K[i] + (SEASON_K[(i + 1) % 4] - SEASON_K[i]) * (ph - Math.floor(ph));
    const v = B.light[1] + (B.light[0] - B.light[1]) * daylight(mirHour(ms)) * Math.min(1, k) + (k > 1 ? (k - 1) * .5 * daylight(mirHour(ms)) : 0);
    return Math.max(0, Math.min(1, v));
  }
  const light = { mirHour, seasonPhase, daylight, lightAt, SEASON_N, SEASON_E,
    season: ms => { const ph = seasonPhase(ms); return Math.floor(((ph % 4) + 4) % 4); },
    isNight: ms => daylight(mirHour(ms)) < .5 };

  // ═══ Облик рода: 6 мест мембраны (id части, '' — пусто, '=' — продолжение части на 2 места), форма колонии, раскраска ═══
  const emptyDesign = () => ({ s: ['', '', '', '', '', ''], f: 'chain', k: { p: 5, a: '#4ade80', b: '#166534' } });
  const okColor = s => (typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null);
  const hasOwn = (o, k) => typeof k === 'string' && !!o && Object.prototype.hasOwnProperty.call(o, k);   // только свои ключи каталога (не «constructor»)
  function skinOk(k, pig){
    if (!k || typeof k !== 'object' || typeof k.p !== 'number') return null;
    const p = k.p | 0, a = okColor(k.a), b = okColor(k.b);
    if (!a || !b || p < 0 || p > (pig ? 9 : 7) || p !== k.p) return null;
    return { p, a, b };
  }
  // Проверка облика: '' — ок, иначе причина. owned — купленные части {id: штук}
  function designWhy(d, owned){
    if (!d || typeof d !== 'object' || !Array.isArray(d.s) || d.s.length !== SLOTS) return 'args';
    if (!hasOwn(FORMS, d.f)) return 'args';
    const cov = [0, 0, 0, 0, 0, 0], cnt = {};
    for (let i = 0; i < SLOTS; i++) {
      const id = d.s[i];
      if (id === '' || id === '=') continue;
      const P = hasOwn(CELL, id) ? CELL[id] : null;
      if (!P || P.slots < 1) return 'args';
      for (let j = 1; j < P.slots; j++) { const q = (i + j) % SLOTS; if (d.s[q] !== '=' || cov[q]) return 'args'; cov[q] = 1; }
      cnt[id] = (cnt[id] | 0) + 1;
    }
    for (let i = 0; i < SLOTS; i++) if (d.s[i] === '=' && !cov[i]) return 'args';
    for (const id in cnt) if (cnt[id] > (owned?.[id] | 0) || cnt[id] > CELL[id].max) return 'owned';
    if (!skinOk(d.k, (owned?.pigment | 0) > 0)) return 'args';
    return '';
  }
  // Части на мембране (для свойств): ['jaw', 'eye', …]
  const placed = d => (d && Array.isArray(d.s) ? d.s.filter(id => id && id !== '=' && CELL[id]) : []);
  // Колония: 1 + 2 за каждую «Липкость» на мембране, не больше 7
  const capacity = d => Math.min(7, 1 + 2 * placed(d).filter(id => id === 'adhesion').length);
  // Код облика для сети (гость → хозяин): 6 букв мест ('.' пусто, '=' продолжение) + буква формы; раскраска идёт отдельно
  function designCode(d){
    if (!d || !Array.isArray(d.s)) return '.......';
    let s = '';
    for (let i = 0; i < SLOTS; i++) { const id = d.s[i]; s += id === '=' ? '=' : (id && CELL[id]?.L) || '.'; }
    return s + (FORMS[d.f]?.L || 'c');
  }
  // Обратно (хозяин проверяет: ровно 7 знаков, части существуют, места сходятся; владение не проверить — только лимит мест)
  function parseCode(c){
    if (typeof c !== 'string' || c.length !== SLOTS + 1) return null;
    const d = { s: [], f: FORM_IDS.find(f => FORMS[f].L === c[SLOTS]) || '', k: { p: 0, a: '#ffffff', b: '#ffffff' } };
    if (!d.f) return null;
    const own = {};
    for (let i = 0; i < SLOTS; i++) { const ch = c[i]; if (ch === '.') d.s.push(''); else if (ch === '=') d.s.push('='); else { const id = BY_L[ch]; if (!id) return null; d.s.push(id); own[id] = (own[id] | 0) + 1; } }
    return designWhy(d, own) === '' ? d : null;
  }

  // ═══ Настройки мира «Клеточек» для пути (kletochki.js: newWorld(seed, cfg)) ═══
  const SIM_PARTS = Object.fromEntries(PART_IDS.map(id => [id, CELL[id].sim]));
  const FORMS_SIM = Object.fromEntries(FORM_IDS.map(id => [id, { role: FORMS[id].role, pos: FORMS[id].pos }]));
  function worldCfg(b, t0){
    const B = BIOMES[b] || BIOMES.pool;
    b = BIOMES[b] ? b : 'pool';
    return { b, light: B.light, food: B.food, min: B.min, aggr: B.aggr, giants: B.giants,
      kits: B.bots.map(id => ({ id, k: MICRO_IDS.indexOf(id), name: MICRO[id].n, parts: MICRO[id].parts })),
      giantKit: { id: 'giant', k: MICRO_IDS.indexOf('giant'), name: MICRO.giant.n, parts: MICRO.giant.parts },
      cell: SIM_PARTS, forms: FORMS_SIM, roles: ROLES, k: SIMK, micro: MICRO_IDS, codeOf: parseCode,
      t0: t0 == null ? Date.now() : t0, lightAt: ms => lightAt(b, ms) };
  }

  // ═══ ПРАВИЛА (= evo_act в evo.sql) ═══
  // Состояние рода — те же поля, что evo_st_() на сервере. now — секунды (часы сервера); day — дата по Москве 'ГГГГ-ММ-ДД'
  const DAY0 = Date.UTC(2026, 0, 1) / 86400000;   // день №0 заданий дня — 01.01.2026 (МСК)
  const dayOf = now => new Date((Math.floor(now) + 10800) * 1000).toISOString().slice(0, 10);
  const dayNo = now => Math.floor((Math.floor(now) + 10800) / 86400) - DAY0;
  const taskOf = now => { const n = dayNo(now), L = TASKS.length; return ((n % L) + L) % L; };
  // Родина — по ключу игрока (сервер — по id аккаунта, своим хешем): номер в HOMES
  const homeOf = key => { let h = 2166136261; for (const ch of String(key || '')) h = Math.imul(h ^ ch.codePointAt(0), 16777619); return HOMES[(h >>> 0) % HOMES.length]; };
  function fresh(key){
    const H = homeOf(key);
    return { stage: 1, dna: 0, earned: 0, day: null, today: 0, raw: 0, owned: {}, design: emptyDesign(), name: { a: 0, b: 0 },
      home: { id: H.id, region: H.region, x: H.x, z: H.z }, plan: null, diet: null, land: null, play: 0, biomes: [], col: 1, finds: [],
      rec: { mass: 0, life: 0, kills: 0, lives: 0 }, tday: null, tk: null, tt: 0, tb: null, tc: 1, act_t: 0, act_n: 0, imported: false, awake: 0, cut: 0, rev: 0 };
  }
  const int = (v, lo = 0, hi = 2e9) => (typeof v === 'number' && Number.isFinite(v) && v === Math.trunc(v) && v >= lo && v <= hi ? v : null);
  function sanitize(st, key){
    const f = fresh(key);
    if (!st || typeof st !== 'object') return f;
    const o = { ...f };
    for (const k of ['stage', 'dna', 'earned', 'today', 'raw', 'play', 'col', 'tt', 'tc', 'act_t', 'act_n', 'awake', 'cut', 'rev']) { const v = int(st[k]); if (v != null) o[k] = v; }
    o.stage = Math.max(1, Math.min(5, o.stage)); o.col = Math.max(1, Math.min(7, o.col)); o.tc = Math.max(1, Math.min(7, o.tc));
    for (const k of ['day', 'tday']) o[k] = typeof st[k] === 'string' && /^\d{4}-\d\d-\d\d$/.test(st[k]) ? st[k] : null;
    o.tk = typeof st.tk === 'string' && /^[0-9a-z]{8}$/.test(st.tk) ? st.tk : null;
    o.tb = BIOMES[st.tb] ? st.tb : null;
    o.owned = {};
    if (st.owned && typeof st.owned === 'object') for (const id of PART_IDS) { const n = int(st.owned[id], 0, CELL[id].max); if (n) o.owned[id] = n; }
    o.design = st.design && designWhy(st.design, o.owned) === '' ? { s: st.design.s.slice(), f: st.design.f, k: skinOk(st.design.k, (o.owned.pigment | 0) > 0) } : emptyDesign();
    o.name = st.name && int(st.name.a, 0, NAME_A.length - 1) != null && int(st.name.b, 0, NAME_B.length - 1) != null ? { a: st.name.a, b: st.name.b } : f.name;
    if (st.home && HOMES.some(h => h.id === st.home.id)) { const H = HOMES.find(h => h.id === st.home.id); o.home = { id: H.id, region: H.region, x: H.x, z: H.z }; }
    o.plan = PLANS[st.plan] ? st.plan : null; o.diet = DIETS[st.diet] ? st.diet : null;
    o.land = st.land && typeof st.land === 'object' && PLANS[st.land.plan] ? st.land : null;
    o.biomes = BIOME_IDS.filter(b => Array.isArray(st.biomes) && st.biomes.includes(b));
    o.finds = MICRO_IDS.filter(m => Array.isArray(st.finds) && st.finds.includes(m));
    const r = st.rec || {};
    o.rec = { mass: int(r.mass, 0, CAPS.mass) || 0, life: int(r.life, 0, 1e6) || 0, kills: int(r.kills, 0, 1e4) || 0, lives: int(r.lives, 0, 1e9) || 0 };
    o.imported = !!st.imported;
    return o;
  }
  const clone = st => JSON.parse(JSON.stringify(st));
  // Сколько разных частей с местом на мембране куплено (веха «Органоиды»)
  const partsOwned = st => PART_IDS.filter(id => CELL[id].slots > 0 && (st.owned?.[id] | 0) > 0).length;
  // Стадия по вехам (не опускается; 5 — «На суше» ставит только land)
  function stageOf(D, st){
    if (st.stage >= 5) return 5;
    const M = D.miles;
    let s = 1;
    if (partsOwned(st) >= M[2].parts) s = 2;
    if (s === 2 && st.earned >= M[3].earned && st.col >= M[3].colony && st.play >= M[3].min * 60) s = 3;
    if (s === 3 && st.earned >= M[4].earned && st.col >= M[4].colony && st.play >= M[4].min * 60 && M[4].biomes.every(b => st.biomes.includes(b))) s = 4;
    return Math.max(st.stage, s);
  }
  const unlocked = (D, st, b) => !!D.biomes[b] && st.stage >= D.biomes[b].at;
  // Выполнено ли задание дня этой жизнью
  function taskDone(t, g, dur, col){
    const v = t[1];
    switch (t[0]) {
      case 'pel': return g.pel >= v;
      case 'life': return Math.min(g.life, dur) >= v;
      case 'mass': return g.mass >= v;
      case 'kills': return g.kills >= v;
      case 'col': return col >= v;
      case 'min': return g.m >= v;
    }
    return false;
  }
  // «Отдохнувший»: сколько ещё сырой ДНК сегодня пойдёт ×2
  const restLeft = (D, st, now) => Math.max(0, D.caps.rest - (st.day === dayOf(now) ? st.raw : 0));
  const todayOf = (st, now) => (st.day === dayOf(now) ? st.today : 0);
  // Жизнь → ДНК (те же целые, что на сервере)
  function credit(D, st, g, dur){
    const C = D.caps;
    const m = D.biomes[st.tb]?.min ? g.m : 0, gl = Math.min(1, g.g);
    const raw0 = g.s + g.p + 2 * m + C.goal * gl;
    const raw = Math.min(raw0, Math.floor(dur * C.rate / 60) + C.slack);
    const bonus = Math.min(raw, Math.max(0, C.rest - st.raw));
    const gain = Math.min(raw + bonus, Math.max(0, C.day - st.today));
    return { raw0, raw, bonus, gain, cut: raw0 - raw, m };
  }
  const LIFE_KEYS = ['s', 'p', 'm', 'g', 'col', 'kills', 'mass', 'life', 'pel'];
  const fail = (st, reason, x) => ({ ok: false, reason, st, ...(x || {}) });
  // Ход: a — start {b} · life {n, s, p, m, g, col, kills, mass, life, pel, seen} · buy {part} · design {d} · name {a, b} · land {plan, diet} ·
  // import {st}. Ответ { ok, st, got } или { ok: false, reason, st }. nonce() — номер билета (тест подставляет свой)
  function act(D, st0, a, g, now, nonce){
    let st = clone(st0);
    g = g && typeof g === 'object' ? g : {};
    now = Math.floor(now);
    if (now - st.act_t >= 60) { st.act_t = now; st.act_n = 0; }
    if (st.act_n >= D.caps.actMin) return fail(st, 'too_fast');
    st.act_n++;
    const today = dayOf(now);
    if (st.day !== today) { st.day = today; st.today = 0; st.raw = 0; }
    if (a === 'start') {
      const b = g.b;
      if (!hasOwn(D.biomes, b)) return fail(st, 'args');
      if (!unlocked(D, st, b)) return fail(st, 'locked');
      st.tk = nonce ? nonce() : Math.random().toString(36).slice(2, 10).padEnd(8, '0'); st.tt = now; st.tb = b; st.tc = capacity(st.design);
      st.rev++;
      return { ok: true, st, got: { n: st.tk } };
    }
    if (a === 'life') {
      if (!st.tk || g.n !== st.tk) return fail(st, 'nonce');
      const v = {};
      for (const k of LIFE_KEYS) { const x = int(g[k] ?? 0, 0, 1e6); if (x == null) return fail(st, 'args'); v[k] = x; }
      const dur = Math.max(0, Math.min(now - st.tt, D.caps.life));
      const c = credit(D, st, v, dur);
      st.raw += c.raw; st.today += c.gain; st.dna += c.gain; st.earned += c.gain; st.cut += c.cut;
      if (dur >= D.caps.minLife) { st.play += dur; if (!st.biomes.includes(st.tb)) st.biomes = D.biomeIds.filter(b => b === st.tb || st.biomes.includes(b)); }
      const col = Math.min(v.col, 7, Math.max(st.tc, capacity(st.design)));
      if (col > st.col) st.col = col;
      if (Array.isArray(g.seen)) {
        const add = D.micro.filter(([id, where]) => g.seen.includes(id) && (where === 'any' || where === st.tb)).map(x => x[0]);
        if (add.some(id => !st.finds.includes(id))) st.finds = D.micro.map(x => x[0]).filter(id => st.finds.includes(id) || add.includes(id));
      }
      st.rec.mass = Math.max(st.rec.mass, Math.min(v.mass, D.caps.mass));
      st.rec.life = Math.max(st.rec.life, Math.min(v.life, dur));
      st.rec.kills = Math.max(st.rec.kills, Math.min(v.kills, D.caps.kills));
      st.rec.lives++;
      let task = 0;
      const ti = taskOf(now);
      if (st.tday !== today && D.tasks[ti] && taskDone(D.tasks[ti], { ...v, m: c.m }, dur, col)) { task = D.caps.task; st.dna += task; st.earned += task; st.tday = today; }
      const s0 = st.stage;
      st.stage = stageOf(D, st);
      st.tk = null; st.rev++;
      return { ok: true, st, got: { raw: c.raw, bonus: c.bonus, gain: c.gain, cut: c.cut, task, dur, up: st.stage > s0 ? st.stage : 0 } };
    }
    if (a === 'buy') {
      const id = g.part, P = hasOwn(D.cell, id) ? D.cell[id] : null;
      if (!P) return fail(st, 'args');
      if (st.stage < P.at) return fail(st, 'stage');
      if ((st.owned[id] | 0) >= P.max) return fail(st, 'max');
      if (st.dna < P.cost) return fail(st, 'dna', { need: P.cost });
      st.dna -= P.cost; st.owned[id] = (st.owned[id] | 0) + 1;
      const s0 = st.stage;
      st.stage = stageOf(D, st); st.rev++;
      return { ok: true, st, got: { part: id, cost: P.cost, up: st.stage > s0 ? st.stage : 0 } };
    }
    if (a === 'design') {
      const d = g.d;
      const why = designWhy(d, st.owned);
      if (why) return fail(st, why);
      st.design = { s: d.s.slice(), f: d.f, k: skinOk(d.k, (st.owned.pigment | 0) > 0) }; st.rev++;
      return { ok: true, st, got: {} };
    }
    if (a === 'name') {
      const x = int(g.a, 0, D.names[0] - 1), y = int(g.b, 0, D.names[1] - 1);
      if (x == null || y == null) return fail(st, 'args');
      st.name = { a: x, b: y }; st.rev++;
      return { ok: true, st, got: {} };
    }
    if (a === 'land') {
      if (st.stage !== 4) return fail(st, 'stage');
      if (!D.plans.includes(g.plan) || !D.diets.includes(g.diet)) return fail(st, 'args');
      st.stage = 5; st.plan = g.plan; st.diet = g.diet;
      st.land = { plan: g.plan, diet: g.diet, design: clone(st.design), owned: clone(st.owned), at: now };
      if (D.awake) st.awake = now;
      st.rev++;
      return { ok: true, st, got: { awake: !!D.awake } };
    }
    if (a === 'import') {
      if (st.imported) return fail(st, 'done');
      if (st.earned > 0 || st.play > 0) return fail(st, 'has');
      const t = sanitize(g.st);
      const I = D.caps.imp;
      const earned = Math.min(t.earned, I.earned), dna = Math.min(t.dna, I.dna, earned);
      // купленное — не дороже потраченного (earned − остаток); лишнее (с конца каталога) не переносится
      const own = {};
      let spent = 0;
      for (const id of D.parts) { const n = Math.min(t.owned[id] | 0, D.cell[id].max); if (n > 0 && D.cell[id].at <= 3) { own[id] = n; spent += n * D.cell[id].cost; } }
      const ids = D.parts.slice().reverse();
      for (const id of ids) while ((own[id] | 0) > 0 && spent > earned - dna) { own[id]--; spent -= D.cell[id].cost; if (!own[id]) delete own[id]; }
      st.earned = earned; st.dna = dna; st.owned = own;
      st.play = Math.min(t.play, I.play); st.col = Math.max(1, Math.min(t.col, I.col));
      st.finds = t.finds.slice(); st.rec = { ...t.rec };
      st.name = { ...t.name };
      st.design = designWhy(t.design, own) === '' ? clone(t.design) : { ...emptyDesign(), f: t.design.f, k: skinOk(t.design.k, (own.pigment | 0) > 0) || emptyDesign().k };
      st.biomes = [];
      st.stage = Math.min(3, stageOf(D, { ...st, stage: 1 }));
      st.biomes = D.biomeIds.filter(b => t.biomes.includes(b) && D.biomes[b].at <= st.stage);   // побывал — только где уже можно
      st.imported = true; st.rev++;
      return { ok: true, st, got: { earned, dna } };
    }
    return fail(st, 'args');
  }
  const Rules = { fresh, sanitize, act, stageOf, unlocked, credit, taskOf, taskDone, dayOf, dayNo, restLeft, todayOf, partsOwned, homeOf };

  // Каталог с настройками админа (то же — evo_defs() на сервере): ключи из cfgk, только числа
  function cfgOk(base, key, val){
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_.]{1,60}$/.test(key)) return false;
    const k = key.split('.');
    let x = base;
    for (const p of k) x = x == null ? undefined : x[p];
    if (typeof x !== 'number') return false;
    if (val == null) return true;
    if (typeof val !== 'number' || val !== Math.trunc(val)) return false;
    for (const [pat, lo, hi] of base.cfgk) {
      const pp = pat.split('.');
      if (pp.length !== k.length || pp.some((p, i) => p !== '*' && p !== k[i])) continue;
      return val >= lo && val <= hi;
    }
    return false;
  }
  function merge(base, data, cv){
    const d = JSON.parse(JSON.stringify(base));
    for (const key of Object.keys(data || {})) {
      if (!cfgOk(base, key, data[key]) || data[key] == null) continue;
      const k = key.split('.'); let x = d;
      for (let i = 0; i < k.length - 1; i++) x = x[k[i]];
      x[k[k.length - 1]] = data[key];
    }
    d.cv = cv | 0;
    return d;
  }

  // Шаблон существа «На сушу» (для стадии «Существо», T-057/T-059): план тела + части клетки → с чего начнёт тело
  function landTemplate(st){
    const L = st?.land; if (!L || !PLANS[L.plan]) return null;
    const own = L.owned || {}, on = placed(L.design), has = id => on.includes(id) || (own[id] | 0) > 0;
    const P = PLANS[L.plan];
    return { v: 1, plan: L.plan, diet: L.diet, size: 'small', home: st.home,
      body: { ...P.body, eyes: Math.min(4, 2 + on.filter(i => i === 'eye').length), mouth: has('jaw') ? 'jaw' : L.diet === 'plant' ? 'beak' : 'mouth',
        horns: has('spikes') ? 1 : 0, glow: on.filter(i => i === 'photo').length, armour: has('armour') ? 1 : 0, toxin: has('toxin') ? 1 : 0,
        swim: L.plan === 'swimmer' ? 2 : has('flagellum') || has('cilia') ? 1 : 0, photosynth: on.filter(i => i === 'leaf').length },
      look: { ...(L.design?.k || { p: 5, a: '#4ade80', b: '#166534' }) },
      // наследие для персонажа после «Пробуждения» (рожки, свечение, узор) — подсказки, решает T-059
      heritage: [has('spikes') && 'horns', on.includes('photo') && 'glow', has('armour') && 'scales', (L.design?.k?.p | 0) >= 8 && 'pattern'].filter(Boolean) };
  }

  // ═══ Подписи и подсказки для окон ═══
  const WHY = {
    too_fast: 'Слишком часто — подожди немного', args: 'Что-то не так — обнови страницу', nonce: 'Жизнь уже засчитана', locked: 'Этот биом ещё закрыт для твоего рода',
    stage: 'Род ещё не дорос до этого', max: 'Больше нельзя', dna: 'Не хватает ДНК 🧬', owned: 'Эта часть не куплена', done: 'Пробный род уже переносили',
    has: 'У рода в аккаунте уже есть прогресс', nosql: 'Сохранение рода на сервере появится, когда сайт обновится', net: 'Нет связи — попробуй ещё раз', auth: 'Войди, чтобы сохранить род',
    banned: 'Аккаунт заблокирован', rights: 'Нет прав',
  };
  const why = r => WHY[r?.reason] || WHY.args;
  const lineageName = st => `${NAME_A[st?.name?.a | 0] || NAME_A[0]} ${NAME_B[st?.name?.b | 0] || NAME_B[0]}`;
  // Что нужно до следующей стадии: [{ t: текст, ok, v, need }]
  function nextNeeds(D, st){
    const M = D.miles, s = st.stage, out = [];
    if (s === 1) out.push({ t: 'Купи первую часть клетки в «🧬 Эволюции»', ok: partsOwned(st) >= M[2].parts, v: partsOwned(st), need: M[2].parts });
    else if (s === 2 || s === 3) {
      const m = M[s + 1];
      out.push({ t: `Получи ${m.earned} ДНК всего`, ok: st.earned >= m.earned, v: st.earned, need: m.earned });
      out.push({ t: `Собери колонию из ${m.colony} клеток (нужна «🧲 Липкость»)`, ok: st.col >= m.colony, v: st.col, need: m.colony });
      out.push({ t: `Проплавай ${m.min} минут`, ok: st.play >= m.min * 60, v: Math.floor(st.play / 60), need: m.min });
      if (m.biomes) for (const b of m.biomes) out.push({ t: `Побывай: ${BIOMES[b].e} ${BIOMES[b].n}`, ok: st.biomes.includes(b), v: st.biomes.includes(b) ? 1 : 0, need: 1 });
    }
    return out;
  }

  // ═══ Связь: сервер (evo.sql) или «пробный род» в браузере ═══
  const api = (() => {
    const A = { mode: 'trial', why: 'guest', sv: 0, D: merge(SERVER, {}, 0), st: null, off: 0, sql: null, loading: null, offer: null, banned: false };
    const L = new Map();
    A.on = (ev, f) => { if (!L.has(ev)) L.set(ev, new Set()); L.get(ev).add(f); return () => L.get(ev)?.delete(f); };
    const emit = (ev, x) => { for (const f of [...(L.get(ev) || [])]) { try { f(x); } catch (e) { console.error(e); } } };
    const user = () => { try { return typeof currentUser !== 'undefined' && currentUser ? currentUser : null; } catch (e) { return null; } };
    const sb = () => { try { return (typeof sbClient !== 'undefined' && sbClient) || null; } catch (e) { return null; } };
    const lsGet = k => { try { return JSON.parse(root.localStorage?.getItem(k) || 'null'); } catch (e) { return null; } };
    const lsSet = (k, v) => { try { root.localStorage?.setItem(k, JSON.stringify(v)); } catch (e) {} };
    const myKey = () => user()?.id || (() => { try { return root.GameRoom?.guestId?.() || 'guest'; } catch (e) { return 'guest'; } })();
    A.clock = () => Date.now() / 1000 + (A.mode === 'server' ? A.off : 0);
    async function rpc(name, args){
      const c = sb(); if (!c) return { ok: false, reason: 'net' };
      try {
        const { data, error } = await c.rpc(name, args || {});
        if (error) { if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || '')) { A.sql = false; return { ok: false, reason: 'nosql' }; } return { ok: false, reason: error.code === '42501' ? 'rights' : 'net', error }; }
        if (data && typeof data.now === 'number') A.off = data.now - Date.now() / 1000;
        return data ?? { ok: false, reason: 'net' };
      } catch (e) { return { ok: false, reason: 'net' }; }
    }
    A.rpc = rpc;
    const cached = lsGet('d37_evo_defs');
    if (cached && cached.d && cached.d.v === V && cached.d.cell) A.D = cached.d;
    async function defsFor(v, cv){
      if (A.D && A.D.v === v && (A.D.cv | 0) === (cv | 0)) return;
      const d = await rpc('evo_defs');
      if (d && d.cell && d.miles) { A.D = d; lsSet('d37_evo_defs', { d }); }
    }
    // пробный род: тот же Rules.act над состоянием в браузере (d37_evo_trial)
    const TKEY = 'd37_evo_trial';
    const trialLoad = () => sanitize(lsGet(TKEY), myKey());
    const trialSave = st => lsSet(TKEY, st);
    A.trial = () => trialLoad();
    A.init = force => {
      if (A.loading && !force) return A.loading;
      A.loading = (async () => {
        A.offer = null;
        if (!user()) { A.mode = 'trial'; A.why = 'guest'; A.st = trialLoad(); emit('state', A); return A; }
        const r = await rpc('evo_state', {});
        if (r.reason === 'nosql') { A.mode = 'trial'; A.why = 'nosql'; A.st = trialLoad(); }
        else if (r.ok) {
          A.mode = 'server'; A.why = ''; A.sv = r.v | 0; A.banned = !!r.banned; await defsFor(r.v, r.cv); A.st = sanitize(r.st, myKey());
          // пробный род с прогрессом, а в аккаунте пусто — предложить перенести (один раз)
          const t = trialLoad();
          if (!A.st.imported && A.st.earned === 0 && A.st.play === 0 && (t.earned > 0 || t.play > 0)) A.offer = t;
        } else { A.mode = 'trial'; A.why = 'net'; A.st = trialLoad(); }
        emit('state', A);
        return A;
      })();
      return A.loading;
    };
    // ход (по очереди: ответы в порядке ходов)
    let chain = Promise.resolve();
    A.act = (a, g = {}) => (chain = chain.then(() => actNow(a, g), () => actNow(a, g)));
    async function actNow(a, g){
      if (!A.st) await A.init();
      if (A.mode !== 'server') {
        const r = act(A.D, A.st, a, g, A.clock());
        A.st = r.st; trialSave(A.st);
        emit('state', A);
        return r;
      }
      const dev = root.D37Ref?.device?.() || null;
      const r = await rpc('evo_act', { p_act: a, p_a: g, p_dev: dev });
      if (r.reason === 'nosql') { await A.init(true); return r; }
      if (r.st) { A.st = sanitize(r.st, myKey()); emit('state', A); }
      return r;
    }
    A.importTrial = async () => {
      if (A.mode !== 'server' || !A.offer) return { ok: false, reason: 'args' };
      const r = await A.act('import', { st: A.offer });
      if (r.ok || r.reason === 'done' || r.reason === 'has') A.offer = null;
      emit('state', A);
      return r;
    };
    A.skipImport = () => { A.offer = null; emit('state', A); };
    A.trialReset = () => { trialSave(fresh(myKey())); if (A.mode !== 'server') { A.st = trialLoad(); emit('state', A); } };
    if (typeof root.addEventListener === 'function') root.addEventListener('d37:auth', () => { if (A.loading) A.init(true); });
    return A;
  })();

  root.D37Evo = { V, SLOTS, CELL, PART_IDS, FORMS, FORM_IDS, ROLES, BIOMES, BIOME_IDS, MICRO, MICRO_IDS, STAGES, MILES, CAPS, TASKS, GOALS, PLANS, DIETS,
    NAME_A, NAME_B, HOMES, SIMK, SERVER, light, worldCfg, emptyDesign, skinOk, designWhy, placed, capacity, designCode, parseCode,
    Rules, merge, cfgOk, landTemplate, WHY, why, lineageName, nextNeeds, api };
})();
