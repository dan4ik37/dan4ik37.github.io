// ═══════════════════════════════════════
//  МОЙ ПЕРСОНАЖ 🎭 — свой герой для игр сайта: цвет, глаза, рот, шапка, предмет, питомец, след
// ═══════════════════════════════════════
// Рисуется кодом на canvas (без картинок): D37Char.draw(ctx, look, x, y, size) — ноги в точке (x, y),
// size — рост. Для игр быстрее D37Char.sprite(look, px) — готовый canvas, рисовать drawImage.
// Части покупаются за монеты (js/core/coins.js, предмет 'skin:<слот>:<id>'); цена 0 — доступна всем;
// vip — бесплатно для VIP/персонала или за монеты; 💎 — только за кристаллы в магазине #/shop; уровень (7-е поле) —
// бесплатно, но только с этого уровня (награды лестницы уровней, economy.sql; сервер сверяет в char_save); друзья (8-е поле) — награда
// за приглашения (referrals2.sql кладёт вещь в coin_wallet.items; не продаётся, цены в базе нет — char_save надевает выданное). Части тела (формы ps*)
// из пакетов PACKS покупаются пакетом ('skin:pack:<id>') — buyItem() говорит, что купить. Цены — coin_price() в
// coins.sql: после правки PARTS/PACKS — node scripts/gen-skin-sql.mjs и node scripts/char-test.cjs.
// Надетое (look) — в базе (char_save / char_looks в coins.sql) или в браузере (d37_char), пока не вошёл.
// Старые образы: upgrade(look) — новые слоты «как было» (PART_DEFAULT), внешность не меняется.
// Где виден: «Орда» (герой), гардероб #/games/wardrobe (3D — js/games/charedit.js, 2D — wardrobe.js), мир, профиль.
(() => {
  const EF = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  const TAU = Math.PI * 2;
  // [id, название, цена, значение (цвет / эмодзи), vip, 💎, уровень, друзья]
  // Палитра (pal: 1): кроме готовых цветов — любой свой, id «x» + 6 hex-цифр (xff8800), бесплатно. Обычные цвета бесплатны,
  // за монеты — особые материалы (радуга, космос, золото, светящиеся глаза, неоновые и переливающиеся волосы).
  // 💎 (6-е поле) — цена в кристаллах: вещь только из магазина #/shop (js/core/premium.js, premium_spend кладёт её в
  // coin_wallet.items), за монеты не продаётся (D37Coins.buy откажет, coin_price в базе — null).
  // Уровень (7-е поле) — награда лестницы уровней (LEVEL_REWARDS в xp.js, level_ladder в economy.sql): цена 0, не продаётся,
  // носить — с этого уровня (coin_level_item в coins.sql, тоже из этого списка — scripts/gen-skin-sql.mjs). Только эмодзи-вещи
  // (в руке, питомец, след): их рисуют и 2D, и 3D без новых моделей.
  // Друзья (8-е поле) — «👥 Пригласи друзей» (js/core/ref.js LADDER, ref_ladder в referrals2.sql): подарок новичку по ссылке и ступени
  // пригласившего. Тоже только эмодзи-вещи; не продаются, носить — если выдали (owns → D37Coins.owns).
  const CUSTOM = /^x[0-9a-f]{6}$/;
  const BASE = [
    ['white', 'Белый', '#f4f5f7'], ['silver', 'Светло-серый', '#c9ced8'], ['gray', 'Серый', '#7d8696'], ['black', 'Чёрный', '#25252d'],
    ['red', 'Красный', '#e23b4e'], ['orange', 'Оранжевый', '#ff8c2e'], ['yellow', 'Жёлтый', '#facc15'], ['lime', 'Салатовый', '#9be15d'],
    ['green', 'Зелёный', '#22a35a'], ['teal', 'Бирюзовый', '#22c7b8'], ['sky', 'Голубой', '#5ab8ff'], ['blue', 'Синий', '#3b6fe0'],
    ['purple', 'Фиолетовый', '#8b5cf6'], ['pink', 'Розовый', '#ff6fb5'], ['brown', 'Коричневый', '#7a4f2c'], ['beige', 'Бежевый', '#d9c4a0'],
  ].map(([id, n, c]) => [id, n, 0, c]);
  // ── Части тела, как в Роблоксе: у головы, туловища, каждой руки и ноги — своя форма и свой цвет ──
  // Пакет — набор форм туловища, рук и ног (у робота и рыцаря — и головы): купил пакет ('skin:pack:<id>') — носишь любые его
  // части вперемешку (рука робота + обычная рука). [название, цена, vip, 💎]
  const PACKS = {
    base: ['Обычный', 0], block: ['Классика', 0], slim: ['Стройный', 0], chunky: ['Силач', 250], robot: ['Робот', 700], knight: ['Рыцарь', 900],
  };
  const packList = () => Object.entries(PACKS).map(([id, p]) => [id, p[0], p[1], '', p[2] || 0, p[3] || 0]);
  // Цвет части: «как задумано» — кожа (tone) у живой части, свой металл у брони; кожа, яркие цвета Роблокса — бесплатно
  const PCOL = [['auto', 'Как задумано', 0],
    ['t1', 'Фарфор', 0, '#fff0e4'], ['t2', 'Светлая', 0, '#ffe0c7'], ['t3', 'Персик', 0, '#f7cba5'], ['t4', 'Бежевая', 0, '#e9b48a'],
    ['t5', 'Загар', 0, '#d39a69'], ['t6', 'Смуглая', 0, '#ad744c'], ['t7', 'Тёмная', 0, '#82573a'], ['t8', 'Шоколад', 0, '#5c3b27'],
    ['zombie', 'Зомби', 0, '#a4d17f'], ['alien', 'Пришелец', 0, '#93d5ff'], ['fairy', 'Фея', 0, '#dcc2ff'], ['robot', 'Металл', 0, '#b9c3cd'],
    ['yellow', 'Жёлтый', 0, '#f5cd30'], ['blue', 'Синий', 0, '#0d69ac'], ['green', 'Зелёный', 0, '#4b974b'], ['red', 'Красный', 0, '#c4281c'],
    ['white', 'Белый', 0, '#f2f3f3'], ['black', 'Чёрный', 0, '#27272f'], ['orange', 'Оранжевый', 0, '#da8541'], ['purple', 'Фиолетовый', 0, '#6b327c'],
    ['pink', 'Розовый', 0, '#ff66cc'], ['teal', 'Бирюзовый', 0, '#12eed4'],
  ];
  const PARTS = {
    color: { name: 'Цвет', icon: '🎨', pal: 1, list: [
      ['blue', 'Синий', 0, '#4f8df7'], ['red', 'Красный', 0, '#ff4d6d'], ['green', 'Зелёный', 0, '#34c759'],
      ['yellow', 'Жёлтый', 0, '#ffcc33'], ['orange', 'Оранжевый', 0, '#ff8c2e'], ['purple', 'Фиолетовый', 0, '#9b6dff'],
      ['pink', 'Розовый', 0, '#ff6fb5'], ['teal', 'Бирюзовый', 0, '#22c7b8'], ['white', 'Белый', 0, '#eef0f4'],
      ['black', 'Чёрный', 0, '#3a3a46'], ['galaxy', 'Космос', 350, '#2b2366'], ['gold', 'Золото', 800, '#f5b81c'],
      ['rainbow', 'Радуга', 3000, '#ff4d6d', 1],
    ] },
    eyes: { name: 'Глаза', icon: '👀', list: [
      ['normal', 'Обычные', 0], ['happy', 'Довольные', 0], ['angry', 'Злые', 50], ['sleepy', 'Сонные', 50],
      ['dizzy', 'Ошалевшие', 80], ['heart', 'Влюблённые', 100], ['star', 'Звёзды', 100], ['cool', 'Очки', 120],
      ['cyclops', 'Циклоп', 150], ['robot', 'Визор', 200],
    ] },
    mouth: { name: 'Рот', icon: '👄', list: [
      ['smile', 'Улыбка', 0], ['cat', 'Котик', 0], ['grin', 'Хохот', 40], ['o', 'Удивление', 40],
      ['tongue', 'Язык', 60], ['fangs', 'Клыки', 80], ['mustache', 'Усы', 120],
    ] },
    hat: { name: 'Шапка', icon: '🎩', list: [
      ['none', 'Без шапки', 0], ['bow', 'Бантик', 100, '🎀'], ['cap', 'Кепка', 100, '🧢'], ['party', 'Колпак', 120],
      ['grad', 'Выпускник', 150, '🎓'], ['helmet', 'Каска', 150, '⛑️'], ['army', 'Шлем', 150, '🪖'], ['top', 'Цилиндр', 200, '🎩'],
      ['ears', 'Ушки', 200], ['horns', 'Рожки', 250], ['propeller', 'Пропеллер', 250], ['halo', 'Нимб', 300],
      ['crown', 'Корона', 800, '👑'], ['headphones', 'Наушники стримера', 3000, '', 1],
      ['gemcrown', 'Кристальная корона', 0, '', 0, 150],
    ] },
    item: { name: 'В руке', icon: '✋', list: [
      ['none', 'Ничего', 0], ['rose', 'Роза', 80, '🌹'], ['pizza', 'Пицца', 80, '🍕'], ['balloon', 'Шарик', 100, '🎈'],
      ['mic', 'Микрофон', 100, '🎤'], ['gamepad', 'Геймпад', 120, '🎮'], ['flashlight', 'Фонарик', 120, '🔦'],
      ['sword', 'Меч', 150, '🗡️'], ['trophy', 'Кубок', 300, '🏆'],
      ['medal', 'Медаль', 0, '🏅', 0, 0, 35], ['orb', 'Хрустальный шар', 0, '🔮', 0, 0, 65],
      ['megaphone', 'Мегафон', 0, '📣', 0, 0, 0, 1],
    ] },
    pet: { name: 'Питомец', icon: '🐾', list: [
      ['none', 'Без питомца', 0], ['dog', 'Пёсик', 300, '🐶'], ['cat', 'Котик', 300, '🐱'], ['frog', 'Лягушка', 300, '🐸'],
      ['fox', 'Лис', 400, '🦊'], ['ghost', 'Призрак', 400, '👻'], ['robot', 'Робот', 500, '🤖'], ['unicorn', 'Единорог', 700, '🦄'],
      ['dragon', 'Дракончик', 900, '🐲'],
      ['owl', 'Совёнок', 0, '🦉', 0, 0, 20], ['wolf', 'Волчонок', 0, '🐺', 0, 0, 55], ['eagle', 'Орёл', 0, '🦅', 0, 0, 80],
      ['parrot', 'Попугай', 0, '🦜', 0, 0, 0, 1],
    ] },
    trail: { name: 'След', icon: '✨', list: [
      ['none', 'Без следа', 0], ['dust', 'Пыль', 100, '💨'], ['sparks', 'Искры', 250, '✨'], ['hearts', 'Сердечки', 250, '💕'],
      ['notes', 'Ноты', 300, '🎵'], ['stars', 'Звёзды', 300, '⭐'], ['fire', 'Огонь', 350, '🔥'], ['rainbow', 'Радуга', 3000, '🌈', 1],
      ['gems', 'След из кристаллов', 0, '💎', 0, 100],
      ['leaves', 'Листопад', 0, '🍂', 0, 0, 10], ['snow', 'Снежинки', 0, '❄️', 0, 0, 45], ['comet', 'Кометы', 0, '☄️', 0, 0, 70],
      ['galaxy', 'Галактика', 0, '🌌', 0, 0, 90],
      ['confetti', 'Конфетти', 0, '🎊', 0, 0, 0, 1], ['fireworks', 'Салют', 0, '🎆', 0, 0, 0, 1],
    ] },
    // ── 3D-человечек («Мир Денчика», гардероб): тело, лицо, волосы, одежда, аксессуары и их цвета. В 2D-играх не рисуются
    //    (body: 1). Не выбрано (нет в look) — мир берёт по «отпечатку» игрока, чтобы толпа была разной (world3d.js → resolve)
    body: { name: 'Фигура', icon: '🧍', body: 1, list: [['boy', 'Мальчик', 0], ['girl', 'Девочка', 0]] },
    tone: { name: 'Кожа', icon: '🖐️', body: 1, pal: 1, list: [
      ['t1', 'Фарфор', 0, '#fff0e4'], ['t2', 'Светлая', 0, '#ffe0c7'], ['t3', 'Персик', 0, '#f7cba5'], ['t4', 'Бежевая', 0, '#e9b48a'],
      ['t5', 'Загар', 0, '#d39a69'], ['t6', 'Смуглая', 0, '#ad744c'], ['t7', 'Тёмная', 0, '#82573a'], ['t8', 'Шоколад', 0, '#5c3b27'],
      ['zombie', 'Зомби', 0, '#a4d17f'], ['alien', 'Пришелец', 0, '#93d5ff'], ['fairy', 'Фея', 0, '#dcc2ff'], ['robot', 'Робот', 0, '#b9c3cd'],
      ['goldskin', 'Золотая статуя', 1000, '#f2b91e'],
    ] },
    hgt: { name: 'Рост', icon: '📏', body: 1, list: [['0', 'Малыш', 0], ['1', 'Пониже', 0], ['2', 'Средний', 0], ['3', 'Повыше', 0], ['4', 'Высокий', 0]] },
    wid: { name: 'Телосложение', icon: '💪', body: 1, list: [['0', 'Тонкий', 0], ['1', 'Стройный', 0], ['2', 'Обычный', 0], ['3', 'Крепкий', 0], ['4', 'Пухлый', 0]] },
    head: { name: 'Голова', icon: '🙂', body: 1, list: [['0', 'Маленькая', 0], ['1', 'Поменьше', 0], ['2', 'Обычная', 0], ['3', 'Побольше', 0], ['4', 'Огромная', 0]] },
    eyec: { name: 'Цвет глаз', icon: '👁️', body: 1, pal: 1, list: [
      ['brown', 'Карие', 0, '#7a4a25'], ['dark', 'Тёмные', 0, '#3a2c26'], ['blue', 'Голубые', 0, '#3d8bfd'], ['green', 'Зелёные', 0, '#2fae62'],
      ['gray', 'Серые', 0, '#7d8a9a'], ['amber', 'Янтарные', 0, '#d98c1f'], ['violet', 'Фиолетовые', 0, '#8b5cf6'], ['pink', 'Розовые', 0, '#ec5fa8'],
      ['red', 'Красные', 0, '#e11d48'], ['gold', 'Золотые', 0, '#f5c518'], ['glow', 'Светящиеся', 300, '#5ef2ff'], ['fire', 'Огненные', 300, '#ff7a1a'],
    ] },
    brows: { name: 'Брови', icon: '〰️', body: 1, list: [['soft', 'Мягкие', 0], ['thin', 'Тонкие', 0], ['thick', 'Густые', 0], ['angry', 'Хмурые', 0], ['none', 'Без бровей', 0]] },
    lash: { name: 'Ресницы', icon: '😉', body: 1, list: [['no', 'Без ресниц', 0], ['yes', 'Ресницы', 0], ['long', 'Длинные', 40]] },
    cheek: { name: 'Щёчки', icon: '😊', body: 1, list: [
      ['blush', 'Румянец', 0], ['none', 'Без румянца', 0], ['freckles', 'Веснушки', 0], ['both', 'Румянец и веснушки', 0],
      ['stars', 'Звёздочки', 80], ['hearts', 'Сердечки', 80],
    ] },
    hair: { name: 'Причёска', icon: '💇', body: 1, list: [
      ['short', 'Короткая', 0], ['side', 'Набок', 0], ['spiky', 'Ёжик', 0], ['curly', 'Кудряшки', 0], ['buzz', 'Под машинку', 0],
      ['bob', 'Каре', 0], ['ponytail', 'Хвостик', 0], ['long', 'Длинные', 0], ['buns', 'Пучки', 0], ['bald', 'Лысый', 0],
      ['twintails', 'Два хвостика', 100], ['braid', 'Коса', 100], ['mohawk', 'Ирокез', 150], ['afro', 'Афро', 150],
      ['wavy', 'Локоны', 200], ['anime', 'Аниме', 250],
    ] },
    hairc: { name: 'Цвет волос', icon: '🎨', body: 1, pal: 1, list: [
      ['black', 'Чёрные', 0, '#24212b'], ['dark', 'Тёмные', 0, '#3e2819'], ['brown', 'Каштан', 0, '#71431f'], ['caramel', 'Карамель', 0, '#a8692f'],
      ['blond', 'Блонд', 0, '#ecc66f'], ['ginger', 'Рыжие', 0, '#cc5a2a'], ['platinum', 'Платина', 0, '#f3ecdc'], ['pink', 'Розовые', 0, '#f6a3c8'],
      ['blue', 'Синие', 0, '#5aa6ff'], ['mint', 'Мятные', 0, '#7fe0c4'], ['purple', 'Сиреневые', 0, '#b49cf0'], ['red', 'Алые', 0, '#e0313f'],
      ['white', 'Белые', 0, '#f6f6f8'], ['neon', 'Неоновые', 600, '#ff4fd8'], ['rainbow', 'Переливаются', 2000, '#ff4d6d', 1],
    ] },
    top: { name: 'Верх', icon: '👕', body: 1, list: [
      ['hoodie', 'Худи', 0], ['tshirt', 'Футболка', 0], ['sweater', 'Свитер', 0], ['dress', 'Платье', 0], ['jacket', 'Куртка', 100],
      ['jersey', 'Форма «37»', 300], ['suit', 'Костюм', 400],
    ] },
    trim: { name: 'Отделка', icon: '🎨', body: 1, pal: 1, list: [['auto', 'Как задумано', 0], ...BASE] },
    bottom: { name: 'Низ', icon: '👖', body: 1, list: [['pants', 'Брюки', 0], ['jeans', 'Джинсы', 0], ['shorts', 'Шорты', 0], ['skirt', 'Юбка', 0], ['cargo', 'Карго', 80]] },
    botc: { name: 'Цвет низа', icon: '🎨', body: 1, pal: 1, list: [
      ['graphite', 'Графит', 0, '#3b4252'], ['denim', 'Деним', 0, '#3e5f95'], ['black', 'Чёрный', 0, '#25252d'], ['khaki', 'Хаки', 0, '#7f7a4c'],
      ['beige', 'Бежевый', 0, '#d9c4a0'], ['white', 'Белый', 0, '#eceef2'], ['red', 'Красный', 0, '#d43a4b'], ['pink', 'Розовый', 0, '#f28dbb'],
      ['purple', 'Фиолетовый', 0, '#7c5cd6'], ['green', 'Зелёный', 0, '#2f9e57'],
    ] },
    shoes: { name: 'Обувь', icon: '👟', body: 1, list: [['sneakers', 'Кроссовки', 0], ['kedy', 'Кеды', 0], ['boots', 'Ботинки', 60], ['bunny', 'Тапки-зайки', 200]] },
    shoec: { name: 'Цвет обуви', icon: '🎨', body: 1, pal: 1, list: [
      ['white', 'Белые', 0, '#f4f4f6'], ['black', 'Чёрные', 0, '#2a2a32'], ['red', 'Красные', 0, '#e23b4e'], ['blue', 'Синие', 0, '#3b82f6'],
      ['brown', 'Коричневые', 0, '#7a4f2c'], ['yellow', 'Жёлтые', 0, '#facc15'], ['pink', 'Розовые', 0, '#f9a8d4'], ['green', 'Зелёные', 0, '#22c55e'],
    ] },
    hatc: { name: 'Цвет шапки', icon: '🎨', body: 1, pal: 1, list: [['auto', 'Как задумано', 0], ...BASE] },
    glasses: { name: 'Очки', icon: '👓', body: 1, list: [
      ['none', 'Без очков', 0], ['round', 'Круглые', 60], ['square', 'Квадратные', 60], ['heart', 'Сердечки', 120], ['star', 'Звёзды', 150],
      ['monocle', 'Монокль', 200],
    ] },
    glassc: { name: 'Цвет очков', icon: '🎨', body: 1, pal: 1, list: [['auto', 'Как задумано', 0], ...BASE] },
    neck: { name: 'На шее', icon: '🧣', body: 1, list: [['none', 'Ничего', 0], ['bowtie', 'Бабочка', 60], ['tie', 'Галстук', 60], ['scarf', 'Шарф', 80], ['chain', 'Цепь', 250]] },
    neckc: { name: 'Цвет на шее', icon: '🎨', body: 1, pal: 1, list: [['auto', 'Как задумано', 0], ...BASE] },
    back: { name: 'На спине', icon: '🎒', body: 1, list: [
      ['none', 'Ничего', 0], ['backpack', 'Рюкзак', 100], ['tail', 'Хвостик', 150], ['guitar', 'Гитара', 250], ['cape', 'Плащ', 300],
      ['wings', 'Крылья ангела', 600], ['batwings', 'Крылья мыши', 600], ['dragon', 'Крылья дракона', 3000, '', 1],
      ['gemwings', 'Кристальные крылья', 0, '', 0, 300],
    ] },
    backc: { name: 'Цвет на спине', icon: '🎨', body: 1, pal: 1, list: [['auto', 'Как задумано', 0], ...BASE] },
    // ── Части тела (ps* — форма, pc* — цвет): голова, туловище, левая/правая рука, левая/правая нога. pack: 1 — формы из пакетов
    psh: { name: 'Форма головы', icon: '🗿', body: 1, pack: 1, list: [
      ['round', 'Круглая', 0], ['egg', 'Овальная', 0], ['wide', 'Широкая', 0], ['block', 'Классика', 0], ['cube', 'Кубик', 80],
      ['robot', 'Робот', PACKS.robot[1]], ['knight', 'Рыцарь', PACKS.knight[1]],
    ] },
    pst: { name: 'Туловище', icon: '👕', body: 1, pack: 1, list: packList() },
    psal: { name: 'Левая рука', icon: '💪', body: 1, pack: 1, list: packList() },
    psar: { name: 'Правая рука', icon: '💪', body: 1, pack: 1, list: packList() },
    psll: { name: 'Левая нога', icon: '🦵', body: 1, pack: 1, list: packList() },
    pslr: { name: 'Правая нога', icon: '🦵', body: 1, pack: 1, list: packList() },
    pch: { name: 'Цвет головы', icon: '🎨', body: 1, pal: 1, list: PCOL },
    pct: { name: 'Цвет туловища', icon: '🎨', body: 1, pal: 1, list: PCOL },
    pcal: { name: 'Цвет левой руки', icon: '🎨', body: 1, pal: 1, list: PCOL },
    pcar: { name: 'Цвет правой руки', icon: '🎨', body: 1, pal: 1, list: PCOL },
    pcll: { name: 'Цвет левой ноги', icon: '🎨', body: 1, pal: 1, list: PCOL },
    pclr: { name: 'Цвет правой ноги', icon: '🎨', body: 1, pal: 1, list: PCOL },
    // стиль лица: как рисуются обычные глаза и рот (особые глаза — сердечки, звёзды, визор… — во всех стилях свои)
    face: { name: 'Стиль лица', icon: '😶', body: 1, list: [['anime', 'Аниме', 0], ['classic', 'Классика', 0], ['toon', 'Мультик', 0], ['dots', 'Точки', 0], ['kawaii', 'Кавай', 150]] },
    glove: { name: 'На руках', icon: '🧤', body: 1, list: [
      ['none', 'Ничего', 0], ['wrist', 'Напульсники', 40], ['mitts', 'Варежки', 60], ['gloves', 'Перчатки', 80], ['watch', 'Часы', 120], ['boxing', 'Боксёрские', 200],
    ] },
    glovec: { name: 'Цвет на руках', icon: '🎨', body: 1, pal: 1, list: [['auto', 'Как задумано', 0], ...BASE] },
  };
  const SLOTS = Object.keys(PARTS);
  const BODY_SLOTS = SLOTS.filter(s => PARTS[s].body), SLOTS2D = SLOTS.filter(s => !PARTS[s].body);
  const DEFAULT = { color: 'blue', eyes: 'normal', mouth: 'smile', hat: 'none', item: 'none', pet: 'none', trail: 'none' };
  // Части тела, стиль лица, перчатки: нет в образе — «как было до них» (не по отпечатку игрока, иначе старые образы поменялись бы)
  const PART_DEFAULT = { psh: 'round', pst: 'base', psal: 'base', psar: 'base', psll: 'base', pslr: 'base', pch: 'auto', pct: 'auto', pcal: 'auto', pcar: 'auto', pcll: 'auto', pclr: 'auto', face: 'anime', glove: 'none', glovec: 'auto' };
  // Части тела по-человечески: ключ → [слот формы, слот цвета, название]
  const BODY_PARTS = { head: ['psh', 'pch', 'Голова'], torso: ['pst', 'pct', 'Туловище'], armL: ['psal', 'pcal', 'Левая рука'], armR: ['psar', 'pcar', 'Правая рука'], legL: ['psll', 'pcll', 'Левая нога'], legR: ['pslr', 'pclr', 'Правая нога'] };
  const LS = 'd37_char';

  const custom = (slot, id) => !!PARTS[slot]?.pal && CUSTOM.test(id || '');
  // gems — цена в 💎 (вещь только из магазина); у таких price = gems, чтобы нигде не сойти за бесплатную; lvl — с какого уровня
  const part = (slot, id) => {
    if (custom(slot, id)) return { id, name: 'Свой цвет', price: 0, v: '#' + id.slice(1), vip: false, custom: true, gems: 0, premium: false, lvl: 0, ref: 0 };
    const p = PARTS[slot]?.list.find(x => x[0] === id) || PARTS[slot]?.list[0];
    return p && { id: p[0], name: p[1], price: p[5] || p[2], v: p[3] || '', vip: !!p[4], gems: p[5] || 0, premium: !!p[5], lvl: p[6] || 0, ref: p[7] || 0 };
  };
  // Уровень игрока — из кошелька (coins_state / user_level); гость — 0: вещи «за уровень» только у вошедших
  const myLevel = () => { try { return +(window.D37Coins?.level?.() || 0); } catch (e) { return 0; } };
  // Часть из пакета (форма туловища/рук/ног, голова робота…) → сам пакет: { id, name, price, vip, gems } или null
  function packOf(slot, id){
    const pk = PARTS[slot]?.pack && Object.prototype.hasOwnProperty.call(PACKS, id) ? PACKS[id] : null;
    return pk ? { id, name: pk[0], price: pk[3] || pk[1], vip: !!pk[2], gems: pk[3] || 0, premium: !!pk[3] } : null;
  }
  // Что купить, чтобы надеть часть: сама часть ('skin:<слот>:<id>') или её пакет ('skin:pack:<id>'); gems > 0 — только за 💎
  function buyItem(slot, id){
    const pk = packOf(slot, id);
    if (pk) return { item: 'skin:pack:' + id, name: `Пакет «${pk.name}»`, price: pk.price, vip: pk.vip, gems: pk.gems, premium: pk.premium, pack: id };
    const p = part(slot, id);
    return p && { item: `skin:${slot}:${p.id}`, name: p.name, price: p.price, vip: p.vip, gems: p.gems, premium: p.premium, lvl: p.lvl, ref: p.ref };
  }
  // Цена вещи: монеты, а у вещей только за 💎 — цена в кристаллах (магазин так узнаёт, что вещь есть в гардеробе;
  // за монеты её не продают — см. gemsOf)
  function price(item){
    const m = /^skin:(\w+):(\w+)$/.exec(item || '');
    if (!m) return null;
    if (m[1] === 'pack') return Object.prototype.hasOwnProperty.call(PACKS, m[2]) ? PACKS[m[2]][3] || PACKS[m[2]][1] : null;
    if (!PARTS[m[1]]) return null;
    if (custom(m[1], m[2])) return 0;
    const p = PARTS[m[1]].list.find(x => x[0] === m[2]);
    return p && !p[7] ? p[5] || p[2] : null;   // за приглашения (8-е поле) — не продаётся
  }
  // Сколько 💎 стоит вещь, которую продают только за кристаллы (0 — обычная, за монеты)
  function gemsOf(item){
    const m = /^skin:(\w+):(\w+)$/.exec(item || '');
    if (!m) return 0;
    if (m[1] === 'pack') return Object.prototype.hasOwnProperty.call(PACKS, m[2]) ? PACKS[m[2]][3] || 0 : 0;
    const p = PARTS[m[1]]?.list.find(x => x[0] === m[2]);
    return p ? p[5] || 0 : 0;
  }
  // Награда за приглашения друзей (8-е поле, referrals2.sql): 1 — да, 0 — обычная
  function refOf(item){
    const m = /^skin:(\w+):(\w+)$/.exec(item || '');
    const p = m && PARTS[m[1]]?.list.find(x => x[0] === m[2]);
    return p ? p[7] || 0 : 0;
  }
  // С какого уровня вещь (0 — обычная): награда лестницы уровней, не продаётся
  function levelOf(item){
    const m = /^skin:(\w+):(\w+)$/.exec(item || '');
    const p = m && PARTS[m[1]]?.list.find(x => x[0] === m[2]);
    return p ? p[6] || 0 : 0;
  }
  function norm(look){
    const L = { ...DEFAULT };
    if (look && typeof look === 'object') for (const s of SLOTS) if (PARTS[s].list.some(x => x[0] === look[s]) || custom(s, look[s])) L[s] = look[s];
    return L;
  }
  // Миграция образа из версии до частей тела: всё выбранное остаётся как есть, мусор отбрасывается (norm), а новые слоты
  // (формы частей, их цвета, стиль лица, перчатки) получают значения «как было» — человечек выглядит точно так же
  function upgrade(look){
    const L = norm(look);
    for (const s in PART_DEFAULT) if (L[s] === undefined) L[s] = PART_DEFAULT[s];
    return L;
  }

  // Ближайший готовый бесплатный цвет к своему (для старого char_save, который своих цветов не знает)
  function nearest(slot, id){
    if (!custom(slot, id)) return id;
    const hx = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
    const [r, g, b] = hx('#' + id.slice(1));
    let best = PARTS[slot].list[0][0], bd = Infinity;
    for (const [pid, , pr, v, vip] of PARTS[slot].list) {
      if (pr || vip || !v || v[0] !== '#') continue;
      const [r2, g2, b2] = hx(v), d = (r - r2) * (r - r2) + (g - g2) * (g - g2) + (b - b2) * (b - b2);
      if (d < bd) { bd = d; best = pid; }
    }
    return best;
  }

  // ── Владение: бесплатное, купленное (сама часть или её пакет), VIP-часть у VIP/персонала, «за уровень» — с уровня ──
  function owns(slot, id){
    const p = part(slot, id);
    if (!p || p.id !== id) return false;
    if (p.lvl) return myLevel() >= p.lvl;
    if (p.ref) return !!window.D37Coins?.owns?.(`skin:${slot}:${id}`);   // за приглашения — только выданное
    if (!p.price) return true;
    const C = window.D37Coins, b = buyItem(slot, id);
    return !!C && (C.owns(b.item) || (b.vip && C.perks()));
  }

  // ── Надетое ──
  let mine = null;
  const listeners = new Set();
  function readLocal(){ try { return norm(JSON.parse(localStorage.getItem(LS))); } catch (e) { return { ...DEFAULT }; } }
  function current(){
    if (!mine) mine = readLocal();
    return mine;
  }
  // Снять то, чем больше не владеешь (кончился VIP, вышел из аккаунта) — вместо этого бесплатное
  function wearable(look){
    const L = norm(look);
    for (const s of SLOTS) if (!owns(s, L[s])) { if (DEFAULT[s] === undefined) delete L[s]; else L[s] = DEFAULT[s]; }
    return L;
  }
  async function set(look){
    mine = wearable(look);
    try { localStorage.setItem(LS, JSON.stringify(mine)); } catch (e) {}
    listeners.forEach(fn => { try { fn(mine); } catch (e) {} });
    const r = await window.D37Coins?.saveLook?.(mine);
    return r || { ok: true };
  }
  // Кошелёк узнал надетое из базы (coins_state) — берём его; если в базе пусто, а в браузере есть — сохраним туда
  function fromServer(look){
    if (look && Object.keys(look).length) {
      const loc = current(), srv = norm(look);
      // Части 3D-человечка и свои цвета: старый char_save (до обновления coins.sql) их не хранит — берём из браузера
      const keep = !BODY_SLOTS.some(s => s in look) && BODY_SLOTS.some(s => loc[s] !== undefined);
      if (keep) { for (const s of SLOTS) if (loc[s] !== undefined && (PARTS[s].body || custom(s, loc[s]))) srv[s] = loc[s]; }
      // Новые части (формы и цвета частей тела, стиль лица, перчатки): пока coins.sql не запущен ещё раз, сервер их молча
      // выбрасывает — то, чего нет в базе, оставляем из браузера (иначе после входа рука робота пропадала бы)
      else { for (const s of BODY_SLOTS) if (!(s in look) && loc[s] !== undefined && srv[s] === undefined) srv[s] = loc[s]; }
      // Вещи только за 💎 (корона, крылья, след из кристаллов) и «за уровень»: старый char_save их не принимает — своё
      // остаётся надетым из браузера (сервер про эту часть молчит; если там явно другое — верим серверу)
      for (const s of SLOTS) if (!(s in look) && loc[s] !== undefined && (gemsOf(`skin:${s}:${loc[s]}`) || levelOf(`skin:${s}:${loc[s]}`) || refOf(`skin:${s}:${loc[s]}`)) && owns(s, loc[s])) srv[s] = loc[s];
      mine = srv;
      if (keep) window.D37Coins?.saveLook?.(mine);
      try { localStorage.setItem(LS, JSON.stringify(mine)); } catch (e) {}
      listeners.forEach(fn => { try { fn(mine); } catch (e) {} });
    } else if (JSON.stringify(current()) !== JSON.stringify(DEFAULT)) window.D37Coins?.saveLook?.(current());
  }

  // ── Рисование ──
  function shade(hex, amt){
    const n = parseInt(hex.slice(1), 16), t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v + (t - v) * p));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  function bodyFill(ctx, col, S, t){
    const cy = -.47 * S;
    if (col.id === 'rainbow') {
      const g = ctx.createLinearGradient(-.4 * S, cy - .4 * S, .4 * S, cy + .4 * S);
      for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${Math.round(i * 60 + t * 90) % 360},90%,62%)`);
      return g;
    }
    if (col.id === 'gold') {
      const g = ctx.createLinearGradient(-.2 * S, cy - .42 * S, .2 * S, cy + .42 * S);
      g.addColorStop(0, '#fff6cc'); g.addColorStop(.3, '#ffd34d'); g.addColorStop(.7, '#e09b12'); g.addColorStop(1, '#8a5207');
      return g;
    }
    if (col.id === 'galaxy') {
      const g = ctx.createRadialGradient(-.1 * S, cy - .15 * S, .02 * S, 0, cy, .5 * S);
      g.addColorStop(0, '#8b5cf6'); g.addColorStop(.45, '#3b2a8f'); g.addColorStop(1, '#0d0a2b');
      return g;
    }
    const g = ctx.createRadialGradient(-.12 * S, cy - .2 * S, .04 * S, 0, cy, .56 * S);
    g.addColorStop(0, shade(col.v, .38)); g.addColorStop(.55, col.v); g.addColorStop(1, shade(col.v, -.32));
    return g;
  }
  function emoji(ctx, e, x, y, size, rot){
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.font = `${Math.round(size)}px ${EF}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';   // цветной эмодзи берёт прозрачность от fillStyle (после тени было бы .25)
    ctx.fillText(e, 0, 0);
    ctx.restore();
  }
  function star(ctx, x, y, r){
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  function heart(ctx, x, y, s){
    ctx.beginPath();
    ctx.moveTo(x, y + s * .35);
    ctx.bezierCurveTo(x - s * .9, y - s * .3, x - s * .35, y - s * .95, x, y - s * .35);
    ctx.bezierCurveTo(x + s * .35, y - s * .95, x + s * .9, y - s * .3, x, y + s * .35);
    ctx.fill();
  }

  function drawEyes(ctx, kind, S, t){
    const ey = -.6 * S, ex = .13 * S, dark = '#1b1626';
    const blink = kind !== 'cool' && kind !== 'robot' && t % 4 > 3.86;
    ctx.lineCap = 'round';
    const white = (x, y, rx, ry) => { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill(); };
    const pupil = (x, y, r) => {
      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x - r * .35, y - r * .4, r * .35, 0, TAU); ctx.fill();
    };
    if (blink && kind !== 'happy') {
      ctx.strokeStyle = dark; ctx.lineWidth = .028 * S;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * ex - .06 * S, ey); ctx.lineTo(s * ex + .06 * S, ey); ctx.stroke(); }
      return;
    }
    switch (kind) {
      case 'happy':
        ctx.strokeStyle = dark; ctx.lineWidth = .032 * S;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * ex, ey + .03 * S, .058 * S, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
        break;
      case 'sleepy':
        for (const s of [-1, 1]) {
          white(s * ex, ey + .02 * S, .075 * S, .05 * S); pupil(s * ex + .012 * S, ey + .03 * S, .034 * S);
          ctx.strokeStyle = dark; ctx.lineWidth = .026 * S; ctx.beginPath(); ctx.moveTo(s * ex - .085 * S, ey - .01 * S); ctx.lineTo(s * ex + .085 * S, ey - .01 * S); ctx.stroke();
        }
        break;
      case 'cool':
        ctx.fillStyle = '#111'; ctx.strokeStyle = '#111'; ctx.lineWidth = .025 * S;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(s * ex - .09 * S, ey - .055 * S, .18 * S, .11 * S, .04 * S) : ctx.rect(s * ex - .09 * S, ey - .055 * S, .18 * S, .11 * S); ctx.fill(); }
        ctx.beginPath(); ctx.moveTo(-ex + .09 * S, ey - .02 * S); ctx.lineTo(ex - .09 * S, ey - .02 * S); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = .016 * S;
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * ex - .05 * S, ey - .03 * S); ctx.lineTo(s * ex - .02 * S, ey + .02 * S); ctx.stroke(); }
        break;
      case 'heart':
        ctx.fillStyle = '#ff2d55';
        for (const s of [-1, 1]) heart(ctx, s * ex, ey + .01 * S, .11 * S * (1 + Math.sin(t * 6) * .06));
        break;
      case 'star':
        ctx.fillStyle = '#ffd166';
        for (const s of [-1, 1]) star(ctx, s * ex, ey, .085 * S);
        break;
      case 'cyclops':
        white(0, ey, .13 * S, .14 * S); pupil(.015 * S, ey + .01 * S, .065 * S);
        break;
      case 'robot': {
        const g = ctx.createLinearGradient(0, ey - .07 * S, 0, ey + .07 * S);
        g.addColorStop(0, '#67e8f9'); g.addColorStop(1, '#0284c7');
        ctx.fillStyle = '#0b1220'; ctx.beginPath(); ctx.ellipse(0, ey, .27 * S, .085 * S, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, ey, .24 * S, .065 * S, 0, 0, TAU); ctx.fill();
        const sx = Math.sin(t * 2.4) * .14 * S;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, ey, .028 * S, 0, TAU); ctx.fill();
        break;
      }
      case 'dizzy':
        ctx.strokeStyle = dark; ctx.lineWidth = .02 * S;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          for (let i = 0; i <= 26; i++) { const a = i * .5 + t * 4 * s, r = i / 26 * .075 * S; ctx.lineTo(s * ex + Math.cos(a) * r, ey + Math.sin(a) * r); }
          ctx.stroke();
        }
        break;
      default:   // normal, angry
        for (const s of [-1, 1]) { white(s * ex, ey, .08 * S, .1 * S); pupil(s * ex + .016 * S, ey + .012 * S, .043 * S); }
        if (kind === 'angry') {
          ctx.strokeStyle = dark; ctx.lineWidth = .03 * S;
          for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * (ex + .08 * S), ey - .14 * S); ctx.lineTo(s * (ex - .06 * S), ey - .085 * S); ctx.stroke(); }
        }
    }
  }

  function drawMouth(ctx, kind, S){
    const my = -.43 * S, dark = '#1b1626';
    ctx.strokeStyle = dark; ctx.fillStyle = dark; ctx.lineWidth = .028 * S; ctx.lineCap = 'round';
    switch (kind) {
      case 'cat':
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * .035 * S, my - .01 * S, .035 * S, .1 * Math.PI, .9 * Math.PI); ctx.stroke(); }
        break;
      case 'grin':
        ctx.beginPath(); ctx.moveTo(-.1 * S, my - .03 * S); ctx.quadraticCurveTo(0, my + .13 * S, .1 * S, my - .03 * S); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillRect(-.07 * S, my - .028 * S, .14 * S, .025 * S);
        ctx.fillStyle = '#ff6b8a'; ctx.beginPath(); ctx.ellipse(0, my + .045 * S, .04 * S, .02 * S, 0, 0, TAU); ctx.fill();
        break;
      case 'o':
        ctx.beginPath(); ctx.ellipse(0, my + .01 * S, .034 * S, .045 * S, 0, 0, TAU); ctx.fill();
        break;
      case 'tongue':
        ctx.beginPath(); ctx.arc(0, my - .03 * S, .075 * S, .15 * Math.PI, .85 * Math.PI); ctx.stroke();
        ctx.fillStyle = '#ff6b8a'; ctx.beginPath(); ctx.ellipse(.025 * S, my + .05 * S, .035 * S, .045 * S, 0, 0, TAU); ctx.fill();
        break;
      case 'fangs':
        ctx.beginPath(); ctx.arc(0, my - .04 * S, .085 * S, .15 * Math.PI, .85 * Math.PI); ctx.stroke();
        ctx.fillStyle = '#fff';
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * .045 * S, my + .028 * S); ctx.lineTo(s * .02 * S, my + .03 * S); ctx.lineTo(s * .035 * S, my + .075 * S); ctx.closePath(); ctx.fill(); }
        break;
      case 'mustache':
        ctx.beginPath(); ctx.arc(0, my + .005 * S, .04 * S, .2 * Math.PI, .8 * Math.PI); ctx.stroke();
        ctx.fillStyle = '#3b2412';
        for (const s of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(0, my - .035 * S);
          ctx.quadraticCurveTo(s * .07 * S, my - .075 * S, s * .13 * S, my - .025 * S);
          ctx.quadraticCurveTo(s * .07 * S, my - .03 * S, 0, my - .01 * S); ctx.fill();
        }
        break;
      default:   // smile
        ctx.beginPath(); ctx.arc(0, my - .03 * S, .07 * S, .18 * Math.PI, .82 * Math.PI); ctx.stroke();
    }
  }

  function drawHat(ctx, h, S, t, col){
    const top = -.89 * S;
    switch (h.id) {
      case 'none': return;
      case 'party': {
        ctx.save(); ctx.translate(.06 * S, top + .02 * S); ctx.rotate(.18);
        ctx.fillStyle = '#ff4fa3'; ctx.beginPath(); ctx.moveTo(-.13 * S, 0); ctx.lineTo(.13 * S, 0); ctx.lineTo(0, -.32 * S); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#ffe066'; ctx.lineWidth = .03 * S;
        for (const y of [-.08, -.17]) { ctx.beginPath(); ctx.moveTo(-.13 * S * (1 + y * 3.1), y * S); ctx.lineTo(.13 * S * (1 + y * 3.1), y * S); ctx.stroke(); }
        ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(0, -.33 * S, .045 * S, 0, TAU); ctx.fill();
        ctx.restore();
        return;
      }
      case 'ears':
        for (const s of [-1, 1]) {
          ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(s * .3 * S, top + .17 * S); ctx.lineTo(s * .27 * S, top - .1 * S); ctx.lineTo(s * .08 * S, top + .06 * S); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#ff9ec7'; ctx.beginPath(); ctx.moveTo(s * .25 * S, top + .1 * S); ctx.lineTo(s * .245 * S, top - .03 * S); ctx.lineTo(s * .14 * S, top + .06 * S); ctx.closePath(); ctx.fill();
        }
        return;
      case 'horns':
        ctx.fillStyle = '#e11d48';
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * .1 * S, top + .1 * S); ctx.quadraticCurveTo(s * .3 * S, top - .02 * S, s * .26 * S, top - .17 * S); ctx.quadraticCurveTo(s * .22 * S, top + .02 * S, s * .2 * S, top + .14 * S); ctx.closePath(); ctx.fill(); }
        return;
      case 'halo':
        ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = .04 * S; ctx.shadowColor = '#ffd34d'; ctx.shadowBlur = .08 * S;
        ctx.beginPath(); ctx.ellipse(0, top - .1 * S + Math.sin(t * 3) * .015 * S, .19 * S, .055 * S, 0, 0, TAU); ctx.stroke();
        ctx.shadowBlur = 0;
        return;
      case 'propeller': {
        ctx.fillStyle = '#ffcc33'; ctx.beginPath(); ctx.ellipse(0, top + .09 * S, .25 * S, .13 * S, 0, Math.PI, TAU); ctx.fill();
        ctx.fillStyle = '#4f8df7'; ctx.beginPath(); ctx.ellipse(0, top + .09 * S, .25 * S, .13 * S, 0, Math.PI, Math.PI * 1.5); ctx.lineTo(0, top + .09 * S); ctx.fill();
        ctx.strokeStyle = '#555'; ctx.lineWidth = .025 * S; ctx.beginPath(); ctx.moveTo(0, top - .04 * S); ctx.lineTo(0, top - .13 * S); ctx.stroke();
        const a = Math.cos(t * 14);
        ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.ellipse(0, top - .14 * S, .24 * S * Math.abs(a) + .015 * S, .04 * S, 0, 0, TAU); ctx.fill();
        return;
      }
      case 'gemcrown': {   // кристальная корона: зубцы-кристаллы, переливается
        const y0 = top + .08 * S, g = ctx.createLinearGradient(0, y0 - .3 * S, 0, y0);
        g.addColorStop(0, '#e0fbff'); g.addColorStop(.45, '#8ee8ff'); g.addColorStop(1, '#a78bfa');
        ctx.fillStyle = g; ctx.strokeStyle = 'rgba(70,40,140,.7)'; ctx.lineWidth = .02 * S;
        ctx.beginPath(); ctx.moveTo(-.25 * S, y0);
        [[-.25, -.18], [-.15, -.08], [-.08, -.3], [0, -.12], [.08, -.3], [.15, -.08], [.25, -.18], [.25, 0]].forEach(([x, y]) => ctx.lineTo(x * S, y0 + y * S));
        ctx.closePath(); ctx.fill(); ctx.stroke();
        const gem = (x, y, r, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x * S, y0 + (y - r) * S); ctx.lineTo((x + r * .8) * S, y0 + y * S); ctx.lineTo(x * S, y0 + (y + r) * S); ctx.lineTo((x - r * .8) * S, y0 + y * S); ctx.closePath(); ctx.fill(); };
        gem(0, -.06, .045, '#ff7ce6'); gem(-.16, -.05, .03, '#7cf2ff'); gem(.16, -.05, .03, '#7cf2ff');
        ctx.fillStyle = 'rgba(255,255,255,.9)'; star(ctx, .1 * S, y0 - .24 * S, .025 * S * (1 + Math.sin(t * 5) * .4));
        return;
      }
      case 'headphones':
        ctx.strokeStyle = '#2b2b33'; ctx.lineWidth = .055 * S;
        ctx.beginPath(); ctx.arc(0, -.6 * S, .35 * S, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
        for (const s of [-1, 1]) {
          ctx.fillStyle = '#ff2d55'; ctx.beginPath(); ctx.ellipse(s * .345 * S, -.6 * S, .07 * S, .11 * S, 0, 0, TAU); ctx.fill();
          ctx.fillStyle = '#2b2b33'; ctx.beginPath(); ctx.ellipse(s * .345 * S, -.6 * S, .035 * S, .07 * S, 0, 0, TAU); ctx.fill();
        }
        ctx.strokeStyle = '#2b2b33'; ctx.lineWidth = .025 * S;
        ctx.beginPath(); ctx.moveTo(-.34 * S, -.52 * S); ctx.quadraticCurveTo(-.3 * S, -.38 * S, -.12 * S, -.4 * S); ctx.stroke();
        ctx.fillStyle = '#2b2b33'; ctx.beginPath(); ctx.arc(-.11 * S, -.4 * S, .03 * S, 0, TAU); ctx.fill();
        return;
      default: {   // шапка-эмодзи: [размер, x, y, наклон] в долях роста
        const pos = { bow: [.4, .17, -.83, .3], cap: [.64, 0, -.86, 0], grad: [.66, 0, -.9, 0], helmet: [.62, 0, -.86, 0], army: [.66, 0, -.85, 0], top: [.62, 0, -.97, 0], crown: [.54, 0, -.93, 0] }[h.id] || [.6, 0, -.88, 0];
        emoji(ctx, h.v, pos[1] * S, pos[2] * S, pos[0] * S, pos[3]);
      }
    }
  }

  // look, S — рост; o: { t — время (анимации), dir — 1 / −1 (смотрит влево), item — эмодзи в руке вместо своего,
  //   noPet, squash (−0,1…0,1 — сплющить при ходьбе) }
  function draw(ctx, look, x, y, S, o = {}){
    const L = norm(look), t = o.t || 0, dir = o.dir < 0 ? -1 : 1;
    const col = part('color', L.color);
    ctx.save();
    ctx.translate(x, y);
    if (!o.noPet && L.pet !== 'none') emoji(ctx, part('pet', L.pet).v, -dir * .6 * S, -.2 * S + Math.sin(t * 5) * .035 * S, .32 * S, 0);
    ctx.scale(dir, 1);
    if (o.squash) ctx.scale(1 + o.squash, 1 - o.squash);
    // ножки и тень
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, -.01 * S, .3 * S, .05 * S, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = col.id === 'galaxy' ? '#1e1b4b' : shade(col.v === '' ? '#888888' : col.v, -.45);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * .15 * S, -.06 * S, .11 * S, .065 * S, 0, 0, TAU); ctx.fill(); }
    // тело
    ctx.fillStyle = bodyFill(ctx, col, S, t);
    ctx.strokeStyle = 'rgba(15,10,25,.55)'; ctx.lineWidth = .032 * S;
    ctx.beginPath(); ctx.ellipse(0, -.47 * S, .36 * S, .42 * S, 0, 0, TAU); ctx.fill(); ctx.stroke();
    if (col.id === 'galaxy') {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 11; i++) { const a = i * 2.39996, r = (.08 + (i * 37 % 23) / 23 * .27) * S; ctx.globalAlpha = .45 + (i % 3) * .2; ctx.beginPath(); ctx.arc(Math.cos(a) * r * .9, -.47 * S + Math.sin(a) * r, (.008 + (i % 3) * .005) * S, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    // блик и пузико
    ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.beginPath(); ctx.ellipse(-.15 * S, -.69 * S, .07 * S, .11 * S, -.5, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.ellipse(.02 * S, -.27 * S, .2 * S, .14 * S, 0, 0, TAU); ctx.fill();
    if (col.id === 'gold') { ctx.fillStyle = 'rgba(255,255,255,.5)'; star(ctx, .2 * S, -.72 * S, .04 * S * (1 + Math.sin(t * 4) * .3)); }
    drawEyes(ctx, L.eyes, S, t);
    drawMouth(ctx, L.mouth, S);
    drawHat(ctx, part('hat', L.hat), S, t, col.v || '#888888');
    // предмет в руке
    const it = o.item !== undefined ? o.item : L.item !== 'none' ? part('item', L.item).v : '';
    if (it) {
      ctx.fillStyle = col.id === 'galaxy' ? '#3b2a8f' : shade(col.v, -.15);
      ctx.beginPath(); ctx.arc(.34 * S, -.34 * S, .065 * S, 0, TAU); ctx.fill();
      emoji(ctx, it, .43 * S, -.42 * S, .34 * S, -.3);
    }
    ctx.restore();
  }

  // ── Готовые картинки для игр (кэш) ──
  // Анимированные части (радуга, пропеллер, глаза-визор) — 8 кадров по времени
  const cache = new Map();
  function animated(L){ return L.color === 'rainbow' || L.hat === 'propeller' || L.hat === 'halo' || L.hat === 'gemcrown' || ['robot', 'dizzy', 'heart'].includes(L.eyes) || L.color === 'gold'; }
  // → { c: canvas, ax, ay } — точка (ax, ay) в пикселях canvas: ноги персонажа
  function sprite(look, px, o = {}){
    const L = norm(look);
    const frame = animated(L) ? Math.floor((o.t || 0) * 8) % 16 : 0;
    const key = JSON.stringify(L) + '|' + Math.round(px) + '|' + (o.dir < 0 ? -1 : 1) + '|' + (o.item ?? '') + '|' + (o.noPet ? 1 : 0) + '|' + frame;
    let s = cache.get(key);
    if (s) return s;
    if (cache.size > 160) cache.clear();
    const S = Math.max(8, Math.round(px)), c = document.createElement('canvas');
    c.width = Math.ceil(S * 1.5); c.height = Math.ceil(S * 1.32);
    const ax = Math.round(c.width / 2), ay = Math.round(S * 1.24);
    draw(c.getContext('2d'), L, ax, ay, S, { t: frame / 8, dir: o.dir, item: o.item, noPet: o.noPet });
    s = { c, ax, ay };
    cache.set(key, s);
    return s;
  }
  // Картинка для <img>
  function img(look, px){ try { return sprite(look, px, { noPet: false }).c.toDataURL('image/png'); } catch (e) { return ''; } }

  // ── Шагающий персонаж (мир): ножки и ручки, 4 стороны, анимация шага ──
  // face: 0 — лицом к нам, 1 — вправо, 2 — спиной, 3 — влево; moving — идёт; phase — сдвиг шага (чтобы все шли не в ногу)
  function drawWalker(ctx, look, x, y, S, o = {}){
    const L = norm(look), t = o.t || 0, face = ((o.face || 0) % 4 + 4) % 4, side = face === 1 || face === 3, sgn = face === 3 ? -1 : 1;
    const col = part('color', L.color), dark = col.id === 'galaxy' ? '#1e1b4b' : shade(col.v === '' ? '#888888' : col.v, -.45);
    const limb = col.id === 'galaxy' ? '#3b2a8f' : col.id === 'rainbow' ? '#a855f7' : col.id === 'gold' ? '#e09b12' : shade(col.v, -.12);
    const wt = o.wt !== undefined ? o.wt : t;   // время шага/дыхания (t — время анимации образа: радуга, пропеллер…)
    const ph = (o.phase || 0) + wt * 11, mv = o.moving ? 1 : 0, s1 = Math.sin(ph);
    const bob = mv ? Math.abs(Math.cos(ph)) * .045 * S : Math.sin(wt * 2.5) * .008 * S;
    const tilt = mv && !side ? s1 * .07 : mv ? .06 * sgn : 0;
    const pet = !o.noPet && L.pet !== 'none' ? part('pet', L.pet).v : '';
    const petAt = face === 0 ? [-.62, -.22] : face === 2 ? [.6, -.12] : [-.7 * sgn, -.2];
    const petBob = Math.abs(Math.sin(ph * .9 + 1)) * .06 * S * (mv || .3);
    ctx.save();
    ctx.translate(x, y);
    // тень
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, -.01 * S, .32 * S, .06 * S, 0, 0, TAU); ctx.fill();
    if (pet && face !== 2) emoji(ctx, pet, petAt[0] * S, petAt[1] * S - petBob, .3 * S, 0);
    // ножки
    ctx.fillStyle = dark;
    if (side) {
      for (const k of [-1, 1]) {
        const sw = mv ? s1 * k * .13 * S : k * .05 * S, lift = mv ? Math.max(0, Math.cos(ph) * k) * .06 * S : 0;
        ctx.globalAlpha = k < 0 ? .75 : 1;
        ctx.beginPath(); ctx.ellipse(sw * sgn, -.055 * S - lift, .12 * S, .065 * S, 0, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else {
      for (const k of [-1, 1]) {
        const lift = mv ? Math.max(0, s1 * k) * .075 * S : 0;
        ctx.beginPath(); ctx.ellipse(k * .14 * S, -.055 * S - lift, .1 * S, .066 * S, 0, 0, TAU); ctx.fill();
      }
    }
    ctx.translate(0, -bob);
    ctx.rotate(tilt);
    const hand = (hx, hy) => { ctx.fillStyle = limb; ctx.strokeStyle = 'rgba(15,10,25,.45)'; ctx.lineWidth = .025 * S; ctx.beginPath(); ctx.ellipse(hx, hy, .075 * S, .085 * S, 0, 0, TAU); ctx.fill(); ctx.stroke(); };
    // дальняя рука (сбоку — за телом)
    const armSw = mv ? s1 * .11 * S : Math.sin(wt * 2.5) * .01 * S;
    if (side) hand(-armSw * sgn - .02 * S * sgn, -.36 * S);
    // тело
    ctx.save();
    if (side) ctx.scale(.86, 1);
    ctx.fillStyle = bodyFill(ctx, col, S, t);
    ctx.strokeStyle = 'rgba(15,10,25,.55)'; ctx.lineWidth = .032 * S;
    ctx.beginPath(); ctx.ellipse(0, -.47 * S, .36 * S, .42 * S, 0, 0, TAU); ctx.fill(); ctx.stroke();
    if (col.id === 'galaxy') {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 9; i++) { const a = i * 2.39996, r = (.08 + (i * 37 % 23) / 23 * .25) * S; ctx.globalAlpha = .45 + (i % 3) * .2; ctx.beginPath(); ctx.arc(Math.cos(a) * r * .9, -.47 * S + Math.sin(a) * r, (.008 + (i % 3) * .005) * S, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.beginPath(); ctx.ellipse((face === 2 ? .15 : -.15) * S, -.69 * S, .07 * S, .11 * S, face === 2 ? .5 : -.5, 0, TAU); ctx.fill();
    if (face !== 2) { ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.ellipse(.02 * S, -.27 * S, .2 * S, .14 * S, 0, 0, TAU); ctx.fill(); }
    ctx.restore();
    // лицо: спереди как обычно, сбоку — сдвинуто и сжато (профиль), сзади — нет
    if (face === 0) { drawEyes(ctx, L.eyes, S, t); drawMouth(ctx, L.mouth, S); }
    else if (side) { ctx.save(); ctx.translate(.17 * S * sgn, 0); ctx.scale(.6, 1); drawEyes(ctx, L.eyes, S, t); drawMouth(ctx, L.mouth, S); ctx.restore(); }
    // шапка
    ctx.save();
    if (side) { ctx.translate(.03 * S * sgn, 0); if (sgn < 0) ctx.scale(-1, 1); }
    drawHat(ctx, part('hat', L.hat), S, t, col.v || '#888888');
    ctx.restore();
    // руки (спереди/сзади — по бокам, сбоку — ближняя) и предмет в руке
    const it = o.item !== undefined ? o.item : L.item !== 'none' ? part('item', L.item).v : '';
    if (side) {
      hand(armSw * sgn + .04 * S * sgn, -.34 * S);
      if (it) emoji(ctx, it, armSw * sgn + .13 * S * sgn, -.42 * S, .32 * S, -.3 * sgn);
    } else {
      for (const k of [-1, 1]) hand(k * .37 * S, -.36 * S + (mv ? s1 * k * .05 * S : 0));
      if (it && face === 0) emoji(ctx, it, .45 * S, -.44 * S + (mv ? s1 * .05 * S : 0), .32 * S, -.3);
    }
    ctx.rotate(-tilt);
    ctx.translate(0, bob);
    if (pet && face === 2) emoji(ctx, pet, petAt[0] * S, petAt[1] * S - petBob, .3 * S, 0);
    ctx.restore();
  }
  // Кэш кадров шагающего персонажа: шаг — 10 кадров на цикл, на месте — 4 кадра «дыхания»
  const wcache = new Map();
  function walker(look, px, o = {}){
    const L = norm(look), face = ((o.face || 0) % 4 + 4) % 4, t = o.t || 0;
    const frame = o.moving ? Math.floor((((o.phase || 0) + t * 11) % TAU + TAU) % TAU / TAU * 10) : 10 + Math.floor((t * 2.5 / TAU % 1) * 4);
    const anim = animated(L) ? Math.floor(t * 8) % 8 : 0;
    const key = JSON.stringify(L) + '|' + Math.round(px) + '|' + face + '|' + frame + '|' + anim + '|' + (o.noPet ? 1 : 0);
    let s = wcache.get(key);
    if (s) return s;
    if (wcache.size > 400) wcache.clear();
    const S = Math.max(8, Math.round(px)), c = document.createElement('canvas');
    c.width = Math.ceil(S * 1.8); c.height = Math.ceil(S * 1.45);
    const ax = Math.round(c.width / 2), ay = Math.round(S * 1.32);
    const ft = o.moving ? (frame / 10) * TAU / 11 : (frame - 10) / 4 * TAU / 2.5;
    drawWalker(c.getContext('2d'), L, ax, ay, S, { face, moving: !!o.moving, t: anim / 8, wt: ft, phase: 0, noPet: o.noPet });
    s = { c, ax, ay };
    wcache.set(key, s);
    return s;
  }

  // Эмодзи следа (частицы за персонажем при беге) или '' — радуга рисуется полосой ('rainbow')
  function trail(look){ const L = norm(look); return L.trail === 'none' ? '' : L.trail === 'rainbow' ? 'rainbow' : part('trail', L.trail).v; }
  function petEmoji(look){ const L = norm(look); return L.pet === 'none' ? '' : part('pet', L.pet).v; }

  // Чужие персонажи (рекорды, профиль, кооп) — из базы, с кэшем на визит
  const others = new Map();
  async function looksOf(ids, fresh){
    const need = [...new Set(ids)].filter(id => id && (fresh || !others.has(id))).slice(0, 100);
    if (need.length && typeof sbClient !== 'undefined' && sbClient) {
      try {
        const { data, error } = await sbClient.rpc('char_looks', { p_ids: need });
        if (!error) { need.forEach(id => others.set(id, null)); (data || []).forEach(r => others.set(r.user_id, norm(r.look))); }
      } catch (e) {}
    }
    const out = {};
    ids.forEach(id => { if (others.get(id)) out[id] = others.get(id); });
    return out;
  }

  window.D37Char = {
    PARTS, SLOTS, BODY_SLOTS, SLOTS2D, DEFAULT, CUSTOM, PACKS, PART_DEFAULT, BODY_PARTS, part, price, gemsOf, levelOf, refOf, norm, upgrade, owns, wearable, custom, nearest, packOf, buyItem,
    look: () => wearable(current()), set, fromServer,
    draw, sprite, img, trail, petEmoji, looksOf, drawWalker, walker,
    on(fn){ listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
