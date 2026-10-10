// ═══════════════════════════════════════
//  ИГРА «ОРДА» — продержись 10 минут против орды монстров (в духе Vampire Survivors). Canvas, телефон и ПК
// ═══════════════════════════════════════
// Ходишь своим персонажем (js/core/avatar.js: стрелки / WASD или палец — зажми в любом месте поля и веди),
// оружие бьёт само. С монстров падают кристаллы опыта → новый уровень → 1 из 3 улучшений (VIP — из 4):
// новое оружие, его уровень или пассивка. Оружие 5-го уровня + «своя» пассивка → эволюция ⭐.
// На 5:00 и 9:00 — боссы, сундуки с демонов, 10:00 — победа. Монеты 🪙 из забега идут в кошелёк сайта
// (js/core/coins.js): на них герои, постоянные улучшения и части персонажа. Возрождение — раз за забег,
// за рекламу (D37Ads.showReward, если есть блок «Rewarded») или за 30 монет.
// «⚔️ Соревнование» (versus.js): одинаковый seed — те же волны у обоих; без улучшений из магазина и без
// возрождения; больше очков — победа. Очки = секунды × 10 + убийства + уровень × 20 (+3000 за победу).
// Симуляция — шаг 1/60 с (step), рисование отдельно (draw). Проверять в node: GAME_IMPL.horde._test.
// Ключи сервера: horde / horde_duel (games-more.sql). Победа для XP — продержаться 5:00.
(() => {
  const DT = 1 / 60, RUN_TIME = 600, WIN_TIME = 300, VIEW = 560, CELL = 64, TAU = Math.PI * 2;
  const EF = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

  function mulberry(seed){
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const mmss = s => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const num = n => Math.round(n).toLocaleString('ru');

  // ── Герои: стартовое оружие и бонус. Внешность — твой персонаж, в руке — оружие героя ──
  const HEROES = [
    { id: 'mage',     e: '🧙', name: 'Маг',    weapon: 'wand',      hand: '🪄', text: 'Волшебная палочка сама бьёт ближайших монстров.', bonus: {} },
    { id: 'ninja',    e: '🥷', name: 'Ниндзя', weapon: 'knife',     hand: '🔪', text: 'Метает ножи туда, куда бежит. Быстрее всех: +15% скорости.', bonus: { speed: .15 } },
    { id: 'knight',   e: '🤺', name: 'Рыцарь', weapon: 'sword',     hand: '🗡️', text: 'Рубит мечом по сторонам. +1 броня и +20 здоровья.', bonus: { armor: 1, hp: 20 } },
    { id: 'vampire',  e: '🧛', name: 'Вампир', weapon: 'aura',      hand: '🧄', text: 'Аура жжёт всех вокруг. Сам лечится: +0,5 здоровья в секунду.', bonus: { regen: .5 } },
    { id: 'robot',    e: '🤖', name: 'Робот',  weapon: 'lightning', hand: '⚡', text: 'Бьёт молниями по всему экрану. +10% к размеру атак.', bonus: { area: .1 } },
    { id: 'streamer', e: '🎙️', name: 'Денчик', weapon: 'shout',     hand: '🎤', text: 'Стример dan4ik37: «Крик в микрофон» отбрасывает всю орду. +20% монет. Для VIP — бесплатно.', bonus: { greed: .2 }, vip: true },
  ];

  // ── Пассивки (улучшения на забег) ──
  const PASSIVES = {
    might:  { e: '💪', name: 'Сила',        max: 5, text: '+10% урона' },
    hp:     { e: '❤️', name: 'Здоровье',     max: 5, text: '+20% здоровья' },
    armor:  { e: '🛡️', name: 'Броня',        max: 5, text: '−1 урон от каждого удара' },
    speed:  { e: '👟', name: 'Скорость',     max: 5, text: '+10% скорости' },
    magnet: { e: '🧲', name: 'Магнит',       max: 5, text: '+30% радиус сбора' },
    cd:     { e: '⏱️', name: 'Перезарядка',  max: 5, text: 'Оружие бьёт на 8% чаще' },
    area:   { e: '📏', name: 'Размах',       max: 5, text: '+10% размер атак' },
    regen:  { e: '💚', name: 'Регенерация',  max: 5, text: '+0,3 здоровья в секунду' },
    luck:   { e: '🍀', name: 'Удача',        max: 5, text: '+20% шанс монет и находок' },
    amount: { e: '🎯', name: 'Двойник',      max: 2, text: '+1 снаряд у всего оружия' },
    greed:  { e: '💰', name: 'Жадность',     max: 5, text: '+20% монет' },
  };

  // ── Оружие: st(уровень, эволюция) → числа. ups — что даёт уровень 2…5. evo — пассивка для эволюции ──
  const b = v => v ? 1 : 0;
  const WEAPONS = {
    wand: { e: '✨', name: 'Волшебная палочка', text: 'Заряды летят в ближайших монстров.', evo: 'cd', evoE: '🌟', evoName: 'Звёздный жезл',
      ups: ['+1 заряд', 'Урон +5, бьёт чаще', '+1 заряд', 'Пробивает ещё 1 монстра, урон +5'],
      st: (L, x) => ({ dmg: 11 + 5 * b(L > 2) + 5 * b(L > 4) + 5 * b(x), cd: x ? .3 : L > 2 ? .8 : 1, n: 1 + b(L > 1) + b(L > 3), pierce: 1 + b(L > 4) + 2 * b(x) }) },
    knife: { e: '🔪', name: 'Ножи', text: 'Летят туда, куда бежит герой.', evo: 'speed', evoE: '🗡️', evoName: 'Тысяча клинков',
      ups: ['+1 нож', '+1 нож, урон +3', 'Пробивает ещё 1 монстра', '+1 нож, урон +3'],
      st: (L, x) => ({ dmg: 7 + 3 * b(L > 2) + 3 * b(L > 4), cd: x ? .14 : .55, n: 1 + b(L > 1) + b(L > 2) + b(L > 4), pierce: 1 + b(L > 3) + 2 * b(x) }) },
    sword: { e: '🗡️', name: 'Меч', text: 'Рубит всех сбоку от героя.', evo: 'hp', evoE: '🩸', evoName: 'Кровавый меч',
      ups: ['Рубит и назад', 'Урон +6', 'Размах +25%', 'Урон +8'],
      st: (L, x) => ({ dmg: (14 + 6 * b(L > 2) + 8 * b(L > 4)) * (x ? 1.6 : 1), cd: 1.25, back: L > 1, size: 1 + .25 * b(L > 3) + .25 * b(x), leech: x }) },
    aura: { e: '🧄', name: 'Чесночная аура', text: 'Жжёт всех, кто подошёл близко, и отталкивает.', evo: 'regen', evoE: '👻', evoName: 'Душеед',
      ups: ['Радиус +15%', 'Урон +3', 'Радиус +15%, бьёт чаще', 'Урон +4'],
      st: (L, x) => ({ dmg: 8 + 3 * b(L > 2) + 4 * b(L > 4) + 6 * b(x), cd: L > 3 ? .4 : .5, rad: 74 * (1 + .15 * b(L > 1) + .15 * b(L > 3) + .4 * b(x)), heal: x }) },
    orbit: { e: '📖', name: 'Книги', text: 'Кружат вокруг героя и бьют всех, кого заденут.', evo: 'area', evoE: '📚', evoName: 'Вечные книги',
      ups: ['+1 книга', 'Урон +5, кружат быстрее', '+1 книга, дольше', 'Урон +5, шире круг'],
      st: (L, x) => ({ dmg: 10 + 5 * b(L > 2) + 5 * b(L > 4) + 5 * b(x), n: 2 + b(L > 1) + b(L > 3) + b(x), spd: L > 2 ? 4 : 3, dur: x ? 1e9 : 3 + b(L > 3), cd: 3, rad: 78 * (L > 4 ? 1.2 : 1) }) },
    lightning: { e: '⚡', name: 'Молния', text: 'Бьёт случайных монстров на экране.', evo: 'amount', evoE: '🌩️', evoName: 'Гроза',
      ups: ['+1 разряд', 'Урон +10', '+1 разряд, шире', '+1 разряд, урон +10'],
      st: (L, x) => ({ dmg: 18 + 10 * b(L > 2) + 10 * b(L > 4), cd: x ? 1.1 : 2.2, n: 1 + b(L > 1) + b(L > 3) + b(L > 4), rad: 32 * (L > 3 ? 1.4 : 1) * (x ? 2 : 1) }) },
    fireball: { e: '🔥', name: 'Огненный шар', text: 'Летит в монстра и взрывается.', evo: 'might', evoE: '☄️', evoName: 'Метеор',
      ups: ['Урон +10', '+1 шар', 'Взрыв +25%', '+1 шар, урон +10'],
      st: (L, x) => ({ dmg: (20 + 10 * b(L > 1) + 10 * b(L > 4)) * (x ? 1.5 : 1), cd: 2, n: 1 + b(L > 2) + b(L > 4), rad: 55 * (L > 3 ? 1.25 : 1) * (x ? 1.6 : 1) }) },
    axe: { e: '🪓', name: 'Топор', text: 'Подлетает вверх и падает, пробивая монстров.', evo: 'armor', evoE: '🌪️', evoName: 'Смерч топоров',
      ups: ['+1 топор', 'Урон +10', 'Пробивает ещё 2', '+1 топор, урон +10'],
      st: (L, x) => ({ dmg: 20 + 10 * b(L > 2) + 10 * b(L > 4), cd: 1.5, n: 1 + b(L > 1) + b(L > 4) + 2 * b(x), pierce: x ? 999 : 3 + 2 * b(L > 3) }) },
    boomerang: { e: '🪃', name: 'Бумеранг', text: 'Летит к монстру и возвращается, пробивая всех.', evo: 'magnet', evoE: '💫', evoName: 'Вечный бумеранг',
      ups: ['Урон +5', '+1 бумеранг', 'Больше и быстрее', '+1 бумеранг, урон +5'],
      st: (L, x) => ({ dmg: (12 + 5 * b(L > 1) + 5 * b(L > 4)) * (x ? 1.5 : 1), cd: x ? 1 : 1.8, n: 1 + b(L > 2) + b(L > 4), size: L > 3 ? 1.3 : 1, spd: L > 3 ? 620 : 520 }) },
    water: { e: '💧', name: 'Святая вода', text: 'Лужи жгут и замедляют монстров.', evo: 'luck', evoE: '🌊', evoName: 'Святой потоп',
      ups: ['+1 лужа', 'Урон +3, дольше', '+1 лужа, шире', 'Урон +4'],
      st: (L, x) => ({ dmg: 6 + 3 * b(L > 2) + 4 * b(L > 4), cd: 3, n: 1 + b(L > 1) + b(L > 3) + 2 * b(x), dur: 2.2 + .6 * b(L > 2) + b(x), rad: 46 * (L > 3 ? 1.2 : 1) * (x ? 1.3 : 1) }) },
    shout: { e: '📢', name: 'Крик в микрофон', text: 'Звуковая волна бьёт всех вокруг и отбрасывает орду.', evo: 'greed', evoE: '🎤', evoName: 'Стрим на миллион', hero: 'streamer',
      ups: ['Урон +5', 'Волна шире', 'Кричит чаще', 'Урон +10, двойная волна'],
      st: (L, x) => ({ dmg: (15 + 5 * b(L > 1) + 10 * b(L > 4)) * (x ? 1.5 : 1), cd: (L > 3 ? 2 : 2.5) * (x ? .7 : 1), rad: 170 * (L > 2 ? 1.2 : 1) * (x ? 1.3 : 1), waves: L > 4 ? 2 : 1 }) },
  };

  // ── Монстры ──
  const EN = {
    bat:     { e: '🦇', hp: 5,     spd: 90,  dmg: 5,  r: 11, xp: 1,   sz: 26 },
    zombie:  { e: '🧟', hp: 10,    spd: 46,  dmg: 8,  r: 14, xp: 1,   sz: 32 },
    skel:    { e: '💀', hp: 16,    spd: 60,  dmg: 10, r: 13, xp: 2,   sz: 28 },
    ghost:   { e: '👻', hp: 14,    spd: 78,  dmg: 9,  r: 13, xp: 2,   sz: 30, ghost: true },
    spider:  { e: '🕷️', hp: 26,    spd: 90,  dmg: 10, r: 12, xp: 2,   sz: 28 },
    wolf:    { e: '🐺', hp: 40,    spd: 98,  dmg: 12, r: 14, xp: 3,   sz: 32 },
    clown:   { e: '🤡', hp: 60,    spd: 64,  dmg: 14, r: 15, xp: 4,   sz: 34 },
    eye:     { e: '👁️', hp: 45,    spd: 55,  dmg: 8,  r: 13, xp: 4,   sz: 30, ranged: true },
    ogre:    { e: '👹', hp: 120,   spd: 42,  dmg: 20, r: 19, xp: 6,   sz: 42 },
    pumpkin: { e: '🎃', hp: 90,    spd: 56,  dmg: 16, r: 16, xp: 5,   sz: 36 },
    alien:   { e: '👾', hp: 75,    spd: 84,  dmg: 14, r: 14, xp: 4,   sz: 32 },
    rex:     { e: '🦖', hp: 220,   spd: 50,  dmg: 24, r: 21, xp: 8,   sz: 46 },
    demon:   { e: '👺', hp: 900,   spd: 62,  dmg: 25, r: 21, xp: 40,  sz: 50 },
    dragon:  { e: '🐉', hp: 6000,  spd: 50,  dmg: 32, r: 32, xp: 150, sz: 84, boss: true, name: 'Дракон' },
    reaper:  { e: '☠️', hp: 14000, spd: 56,  dmg: 45, r: 30, xp: 300, sz: 86, boss: true, name: 'Жнец' },
  };
  // Волны: с какой секунды, кто (вес), раз в сколько секунд, по сколько, сколько всего одновременно
  const WAVES = [
    { t: 0,   ty: { zombie: 3, bat: 2 },                    every: 1,    n: 3, max: 30 },
    { t: 40,  ty: { zombie: 3, bat: 3 },                    every: .9,   n: 3, max: 40 },
    { t: 90,  ty: { zombie: 2, skel: 3, bat: 2 },           every: .8,   n: 3, max: 55 },
    { t: 150, ty: { skel: 3, ghost: 3, bat: 1 },            every: .75,  n: 4, max: 70 },
    { t: 210, ty: { ghost: 2, spider: 3, clown: 1 },        every: .7,   n: 4, max: 85 },
    { t: 270, ty: { spider: 2, clown: 2, eye: 1, wolf: 1 }, every: .65,  n: 4, max: 100 },
    { t: 330, ty: { clown: 2, ogre: 1, eye: 1, wolf: 2 },   every: .6,   n: 5, max: 120 },
    { t: 390, ty: { pumpkin: 2, alien: 2, eye: 1 },         every: .55,  n: 5, max: 140 },
    { t: 450, ty: { alien: 2, ogre: 2, wolf: 2 },           every: .5,   n: 6, max: 160 },
    { t: 510, ty: { rex: 2, pumpkin: 2, alien: 2 },         every: .45,  n: 6, max: 185 },
    { t: 560, ty: { rex: 2, ogre: 2, wolf: 2, eye: 1 },     every: .4,   n: 7, max: 210 },
  ];
  const EVENTS = [
    { t: 60,  k: 'swarm', ty: 'bat', n: 22 },
    { t: 120, k: 'elite', ty: 'demon', n: 1 },
    { t: 180, k: 'ring',  ty: 'zombie', n: 26 },
    { t: 240, k: 'elite', ty: 'demon', n: 1 },
    { t: 300, k: 'boss',  ty: 'dragon' },
    { t: 360, k: 'swarm', ty: 'bat', n: 36 },
    { t: 420, k: 'elite', ty: 'demon', n: 2 },
    { t: 480, k: 'ring',  ty: 'skel', n: 34 },
    { t: 540, k: 'boss',  ty: 'reaper' },
    { t: 575, k: 'swarm', ty: 'bat', n: 50 },
  ];
  const HPK = 300;   // рост здоровья монстров: ×(1 + t / HPK)
  const xpNeed = L => Math.round(5 + 8 * (L - 1) + (L > 20 ? 10 * (L - 20) : 0) + (L > 40 ? 14 * (L - 40) : 0));
  const score = G => Math.floor(G.t) * 10 + G.kills + G.level * 20 + (G.won ? 3000 : 0);

  // ═══ СИМУЛЯЦИЯ ═══
  // o: { seed, hero, up: {might, hp, armor, speed, magnet, greed}, duel, low }
  function newGame(o){
    const seed = (o.seed >>> 0) || 1;
    const G = {
      t: 0, tick: 0, rs: mulberry(seed ^ 0x9e3779b9), rl: mulberry(seed ^ 0x85ebca6b), rd: mulberry(seed ^ 0xc2b2ae35), rc: mulberry(seed ^ 0x27d4eb2f),
      en: [], pr: [], eb: [], gems: [], items: [], zones: [], waves: [], later: [], fx: [], nums: [],
      grid: new Map(), gridUsed: [], eid: 0, pid: 0, gemI: 0, kills: 0, coins: 0, level: 1, xp: 0, next: xpNeed(1), pend: 0,
      boss: null, banner: null, vacuum: 0, shake: 0, evI: 0, spawnT: .5, over: false, won: false, luck: 1,
      viewW: VIEW, viewH: VIEW * 1.4, spawnR: 0, maxEnemies: o.low ? 170 : 260,
      players: [], me: 0, revived: false, duel: !!o.duel, numsOn: !o.low,
    };
    setView(G, G.viewW, G.viewH);
    G.players.push(newPlayer(0, o.hero, o.up));
    return G;
  }
  function setView(G, w, h){ G.viewW = w; G.viewH = h; G.spawnR = Math.hypot(w / 2, h / 2) + 50; }
  function newPlayer(idx, hero, up){
    const h = HEROES.find(x => x.id === hero) || HEROES[0];
    const p = { idx, hero: h.id, hand: h.hand, x: 0, y: 0, r: 13, in: { x: 0, y: 0 }, fx: 1, fy: 0, hx: 1, inv: 0, dead: false, kills: 0, weapons: [], pass: {}, up: up || {}, hp: 0, maxHp: 0, moving: false };
    p.weapons.push(newWeapon(p, h.weapon));
    calcStats(p);
    p.hp = p.maxHp;
    return p;
  }
  function newWeapon(p, id){ return { id, lvl: 1, evo: false, t: .3, on: 0, ang: 0, key: p.idx + id, s: WEAPONS[id].st(1, false) }; }
  function calcStats(p){
    const pv = id => p.pass[id] || 0, up = p.up || {}, hb = (HEROES.find(h => h.id === p.hero) || HEROES[0]).bonus;
    p.might = 1 + .1 * pv('might') + .05 * (up.might || 0);
    p.maxHp = Math.round((100 + (hb.hp || 0) + 10 * (up.hp || 0)) * (1 + .2 * pv('hp')));
    p.armor = pv('armor') + (up.armor || 0) + (hb.armor || 0);
    p.speed = 125 * (1 + .1 * pv('speed') + .04 * (up.speed || 0) + (hb.speed || 0));
    p.magnet = 85 * (1 + .3 * pv('magnet') + .15 * (up.magnet || 0));
    p.cdMul = Math.pow(.92, pv('cd'));
    p.area = 1 + .1 * pv('area') + (hb.area || 0);
    p.regen = .3 * pv('regen') + (hb.regen || 0);
    p.luck = 1 + .2 * pv('luck');
    p.amount = pv('amount');
    p.greed = 1 + .2 * pv('greed') + .1 * (up.greed || 0) + (hb.greed || 0);
    for (const w of p.weapons) w.s = WEAPONS[w.id].st(w.lvl, w.evo);
  }

  function step(G){
    G.t += DT; G.tick++;
    for (const p of G.players) updPlayer(G, p);
    director(G);
    updEnemies(G);
    gridBuild(G);
    for (const p of G.players) if (!p.dead) updWeapons(G, p);
    updProjectiles(G);
    updZones(G); updWaves(G); updLater(G);
    updEnemyBullets(G);
    updPickups(G);
    updFx(G);
    cleanup(G);
    if (G.banner && (G.banner.t -= DT) <= 0) G.banner = null;
    if (G.shake > 0) G.shake -= DT;
    if (G.t >= RUN_TIME && !G.over) { G.won = true; G.over = true; }
  }

  function updPlayer(G, p){
    if (p.dead) return;
    let mx = p.in.x, my = p.in.y;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    p.moving = m > .08;
    p.x += mx * p.speed * DT; p.y += my * p.speed * DT;
    if (p.moving) { p.fx = mx / Math.min(1, m); p.fy = my / Math.min(1, m); const l = Math.hypot(p.fx, p.fy) || 1; p.fx /= l; p.fy /= l; if (Math.abs(mx) > .08) p.hx = mx > 0 ? 1 : -1; }
    if (p.inv > 0) p.inv -= DT;
    if (p.regen && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.regen * DT);
  }

  // ── Кто и когда появляется ──
  function director(G){
    while (G.evI < EVENTS.length && G.t >= EVENTS[G.evI].t) event(G, EVENTS[G.evI++]);
    let w = WAVES[0];
    for (const x of WAVES) if (G.t >= x.t) w = x;
    if ((G.spawnT -= DT) > 0) return;
    G.spawnT = w.every;
    const n = Math.min(w.n, w.max - G.en.length);
    for (let i = 0; i < n; i++) { const s = spawnAround(G); spawnEnemy(G, pickW(G.rs, w.ty), s.x, s.y); }
  }
  function pickW(r, ty){
    let sum = 0;
    for (const k in ty) sum += ty[k];
    let x = r() * sum;
    for (const k in ty) if ((x -= ty[k]) < 0) return k;
    return Object.keys(ty)[0];
  }
  function anchor(G){ const alive = G.players.filter(p => !p.dead); return alive.length ? alive[Math.floor(G.rs() * alive.length)] : G.players[0]; }
  function spawnAround(G){ const p = anchor(G), a = G.rs() * TAU; return { x: p.x + Math.cos(a) * G.spawnR, y: p.y + Math.sin(a) * G.spawnR }; }
  function event(G, ev){
    const p = anchor(G);
    if (ev.k === 'swarm') {
      const a = G.rs() * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const cx = p.x - ca * G.spawnR, cy = p.y - sa * G.spawnR;
      for (let i = 0; i < ev.n; i++) {
        const off = (G.rs() - .5) * 280, back = G.rs() * 140;
        spawnEnemy(G, ev.ty, cx - sa * off - ca * back, cy + ca * off - sa * back, { swarm: true, vx: ca * 175, vy: sa * 175, life: 10 }, true);
      }
      G.banner = { text: '🦇 Летит стая!', t: 2 };
    } else if (ev.k === 'ring') {
      const R = G.spawnR * .85;
      for (let i = 0; i < ev.n; i++) spawnEnemy(G, ev.ty, p.x + Math.cos(i / ev.n * TAU) * R, p.y + Math.sin(i / ev.n * TAU) * R, null, true);
      G.banner = { text: '⭕ Тебя окружают!', t: 2 };
    } else if (ev.k === 'elite') {
      for (let i = 0; i < ev.n; i++) { const s = spawnAround(G); spawnEnemy(G, ev.ty, s.x, s.y, { elite: true }, true); }
      G.banner = { text: '👺 Демон! С него — сундук', t: 2.5 };
    } else if (ev.k === 'boss') {
      const s = spawnAround(G);
      spawnEnemy(G, ev.ty, s.x, s.y, null, true);
      G.banner = { text: `${EN[ev.ty].e} Босс: ${EN[ev.ty].name}!`, t: 3 };
    }
  }
  function spawnEnemy(G, type, x, y, extra, force){
    if (!force && G.en.length >= G.maxEnemies) return null;
    const d = EN[type], t = G.t;
    const hp = d.hp * (d.boss ? 1 + t / 600 : 1 + t / HPK);
    const e = { id: ++G.eid, ty: type, d, x, y, hp, max: hp, r: d.r, spd: d.spd * (1 + Math.min(.15, t / 4000)), dmg: d.dmg * (1 + t / 600),
      kx: 0, ky: 0, flash: 0, cd: null, shoot: 1.5 + G.rs() * 2, dead: false, elite: false, swarm: false, vx: 0, vy: 0, life: 0, slow: 0, face: 1, n: 0 };
    if (extra) Object.assign(e, extra);
    G.en.push(e);
    if (d.boss) G.boss = e;
    return e;
  }

  // ── Монстры ──
  function updEnemies(G){
    separate(G);
    for (const e of G.en) {
      if (e.dead) continue;
      if (e.flash > 0) e.flash -= DT;
      if (e.swarm) {
        e.x += e.vx * DT; e.y += e.vy * DT;
        if ((e.life -= DT) <= 0) e.dead = true;
        touch(G, e);
        continue;
      }
      let tp = null, best = 1e18;
      for (const p of G.players) { if (p.dead) continue; const dx = p.x - e.x, dy = p.y - e.y, d2 = dx * dx + dy * dy; if (d2 < best) { best = d2; tp = p; } }
      if (!tp) continue;
      const d = Math.sqrt(best) || 1, ux = (tp.x - e.x) / d, uy = (tp.y - e.y) / d;
      if (d > G.spawnR * 1.6 && !e.d.boss) { relocate(G, e, tp); continue; }
      let sp = e.spd;
      if (e.slow > 0) { e.slow -= DT; sp *= .55; }
      let mx = ux, my = uy;
      if (e.d.ranged) {
        if (d < 230) { mx = -ux * .6; my = -uy * .6; } else if (d < 300) { mx = -uy * .5; my = ux * .5; }
        if ((e.shoot -= DT) <= 0 && d < 460) { e.shoot = 2.8; enemyBullet(G, e.x, e.y, ux * 190, uy * 190, e.dmg, false); }
      } else if (e.d.boss) bossAct(G, e, ux, uy);
      e.x += (mx * sp + e.kx) * DT; e.y += (my * sp + e.ky) * DT;
      e.kx *= .86; e.ky *= .86;
      e.face = ux < 0 ? -1 : 1;
      touch(G, e);
    }
  }
  function touch(G, e){
    for (const p of G.players) {
      if (p.dead || p.inv > 0) continue;
      const dx = p.x - e.x, dy = p.y - e.y, rr = p.r + e.r - 4;
      if (dx * dx + dy * dy < rr * rr) hitPlayer(G, p, e.dmg, e.d.e);
    }
  }
  function relocate(G, e, p){
    const a = Math.atan2(p.fy, p.fx) + (G.rs() - .5) * 1.6;
    e.x = p.x + Math.cos(a) * G.spawnR; e.y = p.y + Math.sin(a) * G.spawnR;
  }
  function bossAct(G, e, ux, uy){
    if ((e.shoot -= DT) > 0) return;
    if (e.ty === 'dragon') {
      e.shoot = 3.2;
      const a0 = G.rc() * TAU;
      for (let i = 0; i < 12; i++) { const a = a0 + i / 12 * TAU; enemyBullet(G, e.x, e.y, Math.cos(a) * 170, Math.sin(a) * 170, e.dmg * .6, true); }
    } else {
      e.shoot = 2.4;
      const a0 = Math.atan2(uy, ux);
      for (let i = -2; i <= 2; i++) enemyBullet(G, e.x, e.y, Math.cos(a0 + i * .22) * 240, Math.sin(a0 + i * .22) * 240, e.dmg * .5, true);
      if (++e.n % 3 === 0) for (let i = 0; i < 6; i++) spawnEnemy(G, 'bat', e.x + Math.cos(i) * 60, e.y + Math.sin(i) * 60, null, true);
    }
  }
  function enemyBullet(G, x, y, vx, vy, dmg, big){ if (G.eb.length < 160) G.eb.push({ x, y, vx, vy, dmg, r: big ? 8 : 6, life: 4.5, dead: false, big }); }
  // Монстры не слипаются: расталкиваем внутри клетки сетки
  function separate(G){
    for (const a of G.gridUsed) {
      for (let i = 0; i < a.length; i++) {
        const e = a[i];
        if (e.dead || e.d.ghost || e.swarm) continue;
        for (let j = i + 1; j < a.length; j++) {
          const o = a[j];
          if (o.dead || o.d.ghost || o.swarm) continue;
          let dx = o.x - e.x, dy = o.y - e.y;
          const rr = e.r + o.r, d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr) continue;
          if (d2 < .01) { dx = (e.id & 1) ? .1 : -.1; dy = .1; }
          const d = Math.sqrt(dx * dx + dy * dy), push = (rr - d) / d * .25;
          if (!e.d.boss && !e.elite) { e.x -= dx * push; e.y -= dy * push; }
          if (!o.d.boss && !o.elite) { o.x += dx * push; o.y += dy * push; }
        }
      }
    }
  }
  function hitPlayer(G, p, dmg, src){
    if (p.inv > 0 || p.dead) return;
    const d = Math.max(1, Math.round(dmg - p.armor));
    p.hp -= d; p.inv = .5;
    if (p.idx === G.me) { G.shake = .18; G.sfxHurt = true; }
    if (p.hp <= 0) { p.hp = 0; p.dead = true; p.killer = src || ''; }
  }

  // ── Сетка для быстрых «кто рядом» ──
  const gkey = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);
  function gridBuild(G){
    for (const a of G.gridUsed) a.length = 0;
    G.gridUsed.length = 0;
    for (const e of G.en) {
      if (e.dead) continue;
      const k = gkey(Math.floor(e.x / CELL), Math.floor(e.y / CELL));
      let a = G.grid.get(k);
      if (!a) { a = []; G.grid.set(k, a); }
      if (!a.length) G.gridUsed.push(a);
      a.push(e);
    }
    if (G.tick % 900 === 0) for (const [k, a] of G.grid) if (!a.length) G.grid.delete(k);
  }
  function near(G, x, y, r, fn){
    const m = r + 40;
    const x0 = Math.floor((x - m) / CELL), x1 = Math.floor((x + m) / CELL), y0 = Math.floor((y - m) / CELL), y1 = Math.floor((y + m) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const a = G.grid.get(gkey(cx, cy));
      if (!a) continue;
      for (let i = 0; i < a.length; i++) {
        const e = a[i];
        if (e.dead) continue;
        const dx = e.x - x, dy = e.y - y, rr = r + e.r;
        if (dx * dx + dy * dy < rr * rr) fn(e);
      }
    }
  }
  function nearest(G, x, y, n, maxR){
    const out = [], ds = [];
    const m2 = maxR * maxR;
    for (const e of G.en) {
      if (e.dead || e.swarm) continue;
      const dx = e.x - x, dy = e.y - y, d2 = dx * dx + dy * dy;
      if (d2 > m2) continue;
      if (out.length < n || d2 < ds[out.length - 1]) {
        let i = Math.min(out.length, n - 1);
        if (out.length < n) { out.push(e); ds.push(d2); }
        while (i > 0 && ds[i - 1] > d2) { out[i] = out[i - 1]; ds[i] = ds[i - 1]; i--; }
        out[i] = e; ds[i] = d2;
      }
    }
    return out;
  }
  function inView(G, p){ const hw = G.viewW / 2, hh = G.viewH / 2; return G.en.filter(e => !e.dead && Math.abs(e.x - p.x) < hw && Math.abs(e.y - p.y) < hh); }
  function inRange(G, p, R){ const r2 = R * R; return G.en.filter(e => !e.dead && !e.swarm && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 < r2); }

  // ── Оружие ──
  function updWeapons(G, p){
    for (const w of p.weapons) {
      if (w.id === 'orbit') { orbit(G, p, w, w.s); continue; }
      if ((w.t -= DT) > 0) continue;
      FIRE[w.id](G, p, w, w.s);
    }
  }
  function shot(G, p, x, y, vx, vy, o){
    if (G.pr.length > 420) return;
    G.pr.push(Object.assign({ x, y, vx, vy, rot: Math.atan2(vy, vx), p, hits: [], dead: false, key: 'p' + (++G.pid), grav: 0, ax: 0, ay: 0, spin: 0, hitcd: 0, boom: 0 }, o));
  }
  function aimShot(G, p, tx, ty, extra, spd, o){ const a = Math.atan2(ty - p.y, tx - p.x) + extra; shot(G, p, p.x, p.y, Math.cos(a) * spd, Math.sin(a) * spd, o); }
  const FIRE = {
    wand(G, p, w, s){
      const n = s.n + p.amount, ts = nearest(G, p.x, p.y, n, 520);
      if (!ts.length) { w.t = .2; return; }
      w.t = s.cd * p.cdMul;
      for (let i = 0; i < n; i++) { const e = ts[i % ts.length]; aimShot(G, p, e.x, e.y, i >= ts.length ? (i - ts.length + 1) * .18 : 0, 460, { k: 'bolt', dmg: s.dmg, pierce: s.pierce, r: 7, life: 1.3, evo: w.evo }); }
    },
    knife(G, p, w, s){
      w.t = s.cd * p.cdMul;
      const n = s.n + p.amount, e = nearest(G, p.x, p.y, 1, 420)[0];
      let fx = p.fx, fy = p.fy;
      if (e) { const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1; fx = dx / d; fy = dy / d; }
      for (let i = 0; i < n; i++) { const off = (i - (n - 1) / 2) * 11; shot(G, p, p.x - fy * off, p.y + fx * off, fx * 640, fy * 640, { k: 'knife', dmg: s.dmg, pierce: s.pierce, r: 7, life: .8 }); }
    },
    sword(G, p, w, s){
      w.t = s.cd * p.cdMul;
      const e = nearest(G, p.x, p.y, 1, 260)[0], dir = e ? (e.x < p.x ? -1 : 1) : p.hx;
      slash(G, p, s, dir);
      if (s.back) G.later.push({ t: .14, fn: () => slash(G, p, s, -dir), dead: false });
    },
    aura(G, p, w, s){
      w.t = s.cd * p.cdMul;
      near(G, p.x, p.y, s.rad * p.area, e => {
        const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
        hurt(G, e, s.dmg, p, dx / d * 70, dy / d * 70);
        if (s.heal && e.dead) heal(p, .5);
      });
    },
    lightning(G, p, w, s){
      const pool = inView(G, p);
      if (!pool.length) { w.t = .25; return; }
      w.t = s.cd * p.cdMul;
      const n = s.n + p.amount, R = s.rad * p.area;
      for (let i = 0; i < n && pool.length; i++) {
        const e = pool.splice(Math.floor(G.rc() * pool.length), 1)[0], x = e.x, y = e.y;
        near(G, x, y, R, o => hurt(G, o, s.dmg, p, 0, 0));
        fx(G, 'zap', x, y, .25, { R });
      }
    },
    fireball(G, p, w, s){
      const ts = inRange(G, p, 460);
      if (!ts.length) { w.t = .25; return; }
      w.t = s.cd * p.cdMul;
      const n = s.n + p.amount;
      for (let i = 0; i < n; i++) { const e = ts[Math.floor(G.rc() * ts.length)]; aimShot(G, p, e.x, e.y, 0, 280, { k: 'fire', dmg: s.dmg, pierce: 1, r: 10, life: 2.2, boom: s.rad * p.area, evo: w.evo }); }
    },
    axe(G, p, w, s){
      w.t = s.cd * p.cdMul;
      const n = s.n + p.amount;
      for (let i = 0; i < n; i++) shot(G, p, p.x, p.y, (G.rc() - .5) * 280 + p.hx * 70, -560 - G.rc() * 140, { k: 'axe', dmg: s.dmg, pierce: s.pierce, r: 13 * p.area, life: 2.2, grav: 980, spin: 11 * (G.rc() < .5 ? -1 : 1) });
    },
    boomerang(G, p, w, s){
      w.t = s.cd * p.cdMul;
      const e = nearest(G, p.x, p.y, 1, 520)[0];
      const a = e ? Math.atan2(e.y - p.y, e.x - p.x) : Math.atan2(p.fy, p.fx), n = s.n + p.amount;
      for (let i = 0; i < n; i++) {
        const bb = a + (i - (n - 1) / 2) * .4, vx = Math.cos(bb) * s.spd, vy = Math.sin(bb) * s.spd;
        shot(G, p, p.x, p.y, vx, vy, { k: 'boom', dmg: s.dmg, pierce: 1e9, hitcd: .3, r: 13 * s.size * p.area, life: 2.4, ax: -vx * 1.15, ay: -vy * 1.15, spin: 14 });
      }
    },
    water(G, p, w, s){
      w.t = s.cd * p.cdMul;
      const ts = inRange(G, p, 330), n = s.n + p.amount;
      for (let i = 0; i < n; i++) {
        let x, y;
        if (ts.length) { const e = ts[Math.floor(G.rc() * ts.length)]; x = e.x; y = e.y; }
        else { const a = G.rc() * TAU; x = p.x + Math.cos(a) * 120; y = p.y + Math.sin(a) * 120; }
        G.zones.push({ x, y, r: s.rad * p.area, t: s.dur, T: s.dur, dmg: s.dmg, tick: 0, p, dead: false, evo: w.evo });
      }
    },
    shout(G, p, w, s){
      w.t = s.cd * p.cdMul;
      const R = s.rad * p.area, mk = () => G.waves.push({ x: p.x, y: p.y, r: 0, R, dmg: s.dmg, p, hit: new Set(), dead: false });
      mk();
      if (s.waves > 1) G.later.push({ t: .3, fn: mk, dead: false });
    },
  };
  function orbit(G, p, w, s){
    if (w.on > 0) {
      w.on -= DT; w.ang += s.spd * DT;
      const n = s.n + p.amount, R = s.rad * p.area, br = 13 * p.area;
      for (let i = 0; i < n; i++) {
        const a = w.ang + i / n * TAU, bx = p.x + Math.cos(a) * R, by = p.y + Math.sin(a) * R;
        near(G, bx, by, br, e => {
          const c = e.cd || (e.cd = {});
          if ((c[w.key] || 0) > G.t) return;
          c[w.key] = G.t + .45;
          hurt(G, e, s.dmg, p, Math.cos(a) * 90, Math.sin(a) * 90);
        });
      }
      if (w.on <= 0) w.t = s.cd * p.cdMul;
    } else if ((w.t -= DT) <= 0) w.on = s.dur;
  }
  function slash(G, p, s, dir){
    if (p.dead) return;
    const W = 150 * s.size * p.area, H = 48 * s.size * p.area, cx = p.x + dir * (W / 2 + 6), cy = p.y - 4;
    let healed = 0;
    near(G, cx, cy, W / 2 + 10, e => {
      if (Math.abs(e.x - cx) > W / 2 + e.r || Math.abs(e.y - cy) > H / 2 + e.r) return;
      hurt(G, e, s.dmg, p, dir * 120, 0);
      if (s.leech && healed < 8) { heal(p, 1); healed++; }
    });
    fx(G, 'slash', cx, cy, .2, { w: W, h: H, dir, red: s.leech });
  }
  function explode(G, x, y, R, dmg, p){
    near(G, x, y, R, e => { const dx = e.x - x, dy = e.y - y, d = Math.hypot(dx, dy) || 1; hurt(G, e, dmg, p, dx / d * 100, dy / d * 100); });
    fx(G, 'boom', x, y, .35, { R });
  }
  function hurt(G, e, dmg, p, kx, ky){
    if (e.dead) return;
    const d = dmg * p.might;
    e.hp -= d; e.flash = .08;
    const kb = e.d.boss ? .1 : e.elite ? .3 : 1;
    e.kx += kx * kb; e.ky += ky * kb;
    if (G.numsOn && G.nums.length < 50 && p.idx === G.me) G.nums.push({ x: e.x, y: e.y - e.r, v: d, t: .5 });
    if (e.hp <= 0) kill(G, e, p);
  }
  function heal(p, v){ if (!p.dead) p.hp = Math.min(p.maxHp, p.hp + v); }

  // ── Смерть монстра, добыча ──
  function kill(G, e, p){
    e.dead = true; G.kills++;
    if (p) p.kills++;
    gem(G, e.x, e.y, e.d.xp);
    if (e.d.boss) {
      G.boss = null;
      item(G, 'chest', e.x, e.y);
      for (let i = 0; i < 6; i++) item(G, 'coin', e.x + (G.rd() - .5) * 90, e.y + (G.rd() - .5) * 90, 5);
      G.banner = { text: `🏆 ${e.d.name} побеждён!`, t: 2.5 };
    } else if (e.elite) {
      item(G, 'chest', e.x, e.y);
      item(G, 'coin', e.x + 22, e.y, 10);
    } else {
      const L = G.luck, r = G.rd();
      if (r < .03 * L) item(G, 'coin', e.x, e.y, 1);
      else if (r < .034 * L) item(G, 'heal', e.x, e.y);
      else if (r < .0365 * L) item(G, 'magnet', e.x, e.y);
      else if (r < .0373 * L) item(G, 'bomb', e.x, e.y);
    }
    if (G.fx.length < 120) fx(G, 'puff', e.x, e.y, .3, { r: e.r });
  }
  function gem(G, x, y, v){
    if (G.gems.length >= 420) { G.gems[G.gemI++ % G.gems.length].v += v; return; }
    G.gems.push({ x, y, v, pull: false, sp: 0, dead: false });
  }
  function item(G, k, x, y, v){ if (G.items.length > 80) G.items.shift(); G.items.push({ k, x, y, v: v || 1, pull: false, sp: 0, dead: false }); }
  function closest(G, x, y){
    let best = null, bd = 1e18;
    for (const p of G.players) { if (p.dead) continue; const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function pull(o, p, dx, dy, d){
    o.sp = Math.min(1100, o.sp + 1600 * DT);
    const m = Math.min(d, (o.sp + 120) * DT);
    o.x += dx / d * m; o.y += dy / d * m;
  }
  function updPickups(G){
    if (G.vacuum > 0) G.vacuum -= DT;
    for (const g of G.gems) {
      const p = closest(G, g.x, g.y);
      if (!p) break;
      const dx = p.x - g.x, dy = p.y - g.y, d2 = dx * dx + dy * dy;
      if (!g.pull && (d2 < p.magnet * p.magnet || G.vacuum > 0)) g.pull = true;
      if (!g.pull) {
        if (d2 < 90000) { const d = Math.sqrt(d2) || 1; g.x += dx / d * 45 * DT; g.y += dy / d * 45 * DT; }   // в 300 ед. — подползают
        continue;
      }
      const d = Math.sqrt(d2) || 1;
      if (d < p.r + 6) { g.dead = true; addXp(G, g.v); continue; }
      pull(g, p, dx, dy, d);
    }
    for (const c of G.items) {
      const p = closest(G, c.x, c.y);
      if (!p) break;
      const dx = p.x - c.x, dy = p.y - c.y, d2 = dx * dx + dy * dy;
      if (c.k === 'coin' && !c.pull && d2 < p.magnet * p.magnet) c.pull = true;
      const d = Math.sqrt(d2) || 1;
      if (d < p.r + 16) { c.dead = true; take(G, p, c); continue; }
      if (c.pull) pull(c, p, dx, dy, d);
    }
  }
  function take(G, p, c){
    if (c.k === 'coin') { G.coins += c.v; G.sfxCoin = true; fx(G, 'text', c.x, c.y, .7, { text: `+${c.v} 🪙`, color: '#ffd166' }); }
    else if (c.k === 'heal') { heal(p, 30); fx(G, 'text', p.x, p.y - 30, .8, { text: '+30 ❤️', color: '#4ade80' }); }
    else if (c.k === 'magnet') { G.vacuum = 1.5; G.banner = { text: '🧲 Весь опыт — к тебе!', t: 1.4 }; }
    else if (c.k === 'bomb') {
      const hw = G.viewW / 2, hh = G.viewH / 2;
      for (const e of G.en) if (!e.dead && Math.abs(e.x - p.x) < hw && Math.abs(e.y - p.y) < hh) hurt(G, e, e.d.boss ? 400 / p.might : 99999, p, 0, 0);
      fx(G, 'flash', p.x, p.y, .4, {});
      G.shake = .3;
    } else if (c.k === 'chest') chest(G, p);
  }
  // Сундук: эволюция, если есть что эволюционировать, иначе случайное улучшение; плюс монеты
  function chest(G, p){
    G.coins += 10;
    const evo = p.weapons.find(w => !w.evo && w.lvl >= 5 && (p.pass[WEAPONS[w.id].evo] || 0) > 0);
    let text;
    if (evo) { apply(G, p, { k: 'evo', id: evo.id }); text = `⭐ ${WEAPONS[evo.id].evoE} ${WEAPONS[evo.id].evoName}!`; }
    else {
      const opts = lvOptions(G, p, 1).filter(o => o.k === 'w' || o.k === 'p');
      if (opts.length) { const f = optInfo(p, opts[0]); apply(G, p, opts[0]); text = `${f.e} ${f.name} ${f.tag}`; }
      else { heal(p, 50); text = '🍗 +50 здоровья'; }
    }
    G.banner = { text: `📦 Сундук: ${text} · +10 🪙`, t: 2.6 };
    G.sfxChest = true;
  }
  function addXp(G, v){
    G.xp += v;
    while (G.xp >= G.next) { G.xp -= G.next; G.level++; G.next = xpNeed(G.level); G.pend++; }
  }

  function updProjectiles(G){
    for (const s of G.pr) {
      if (s.dead) continue;
      if ((s.life -= DT) <= 0) { s.dead = true; continue; }
      if (s.grav) s.vy += s.grav * DT;
      if (s.ax) { s.vx += s.ax * DT; s.vy += s.ay * DT; }
      s.x += s.vx * DT; s.y += s.vy * DT;
      if (s.spin) s.rot += s.spin * DT;
      near(G, s.x, s.y, s.r, e => {
        if (s.dead) return;
        if (s.hitcd) { const c = e.cd || (e.cd = {}); if ((c[s.key] || 0) > G.t) return; c[s.key] = G.t + s.hitcd; }
        else { if (s.hits.indexOf(e.id) >= 0) return; s.hits.push(e.id); }
        if (s.boom) { explode(G, s.x, s.y, s.boom, s.dmg, s.p); s.dead = true; return; }
        const v = Math.hypot(s.vx, s.vy) || 1;
        hurt(G, e, s.dmg, s.p, s.vx / v * 60, s.vy / v * 60);
        if (--s.pierce <= 0) s.dead = true;
      });
    }
  }
  function updZones(G){
    for (const z of G.zones) {
      if ((z.t -= DT) <= 0) { z.dead = true; continue; }
      if ((z.tick -= DT) <= 0) { z.tick = .3; near(G, z.x, z.y, z.r, e => { e.slow = .35; hurt(G, e, z.dmg, z.p, 0, 0); }); }
    }
  }
  function updWaves(G){
    for (const w of G.waves) {
      w.r += w.R / .45 * DT;
      near(G, w.x, w.y, w.r, e => {
        if (w.hit.has(e.id)) return;
        w.hit.add(e.id);
        const dx = e.x - w.x, dy = e.y - w.y, d = Math.hypot(dx, dy) || 1;
        hurt(G, e, w.dmg, w.p, dx / d * 320, dy / d * 320);
      });
      if (w.r >= w.R) w.dead = true;
    }
  }
  function updLater(G){ for (const l of G.later) if (!l.dead && (l.t -= DT) <= 0) { l.dead = true; l.fn(); } }
  function updEnemyBullets(G){
    for (const s of G.eb) {
      s.x += s.vx * DT; s.y += s.vy * DT;
      if ((s.life -= DT) <= 0) { s.dead = true; continue; }
      for (const p of G.players) {
        if (p.dead) continue;
        const dx = p.x - s.x, dy = p.y - s.y, rr = p.r + s.r;
        if (dx * dx + dy * dy < rr * rr) { hitPlayer(G, p, s.dmg, s.big ? '🔥' : '👁️'); s.dead = true; break; }
      }
    }
  }
  function fx(G, k, x, y, T, o){ if (G.fx.length < 150) G.fx.push(Object.assign({ k, x, y, t: T, T, dead: false }, o)); }
  function updFx(G){
    for (const f of G.fx) if ((f.t -= DT) <= 0) f.dead = true;
    for (const n of G.nums) if ((n.t -= DT) <= 0) n.dead = true;
  }
  function compact(a){ let j = 0; for (let i = 0; i < a.length; i++) { const o = a[i]; if (!o.dead) a[j++] = o; } a.length = j; }
  function cleanup(G){ for (const a of [G.en, G.pr, G.eb, G.gems, G.items, G.zones, G.waves, G.later, G.fx, G.nums]) compact(a); }

  // ── Повышение уровня: варианты и их применение ──
  function lvOptions(G, p, k){
    const opts = [];
    for (const w of p.weapons) if (!w.evo && w.lvl >= 5 && (p.pass[WEAPONS[w.id].evo] || 0) > 0) opts.push({ k: 'evo', id: w.id });
    const pool = [];
    for (const w of p.weapons) if (!w.evo && w.lvl < 5) pool.push({ k: 'w', id: w.id, wt: 1.3 });
    if (p.weapons.length < 6) for (const id in WEAPONS) if (!p.weapons.some(w => w.id === id) && (!WEAPONS[id].hero || WEAPONS[id].hero === p.hero)) pool.push({ k: 'w', id, wt: 1 });
    for (const id in p.pass) if (p.pass[id] < PASSIVES[id].max) pool.push({ k: 'p', id, wt: 1 });
    if (Object.keys(p.pass).length < 6) for (const id in PASSIVES) if (!(id in p.pass)) pool.push({ k: 'p', id, wt: .8 });
    while (opts.length < k && pool.length) {
      let sum = 0;
      for (const o of pool) sum += o.wt;
      let x = G.rl() * sum, i = 0;
      for (; i < pool.length - 1; i++) if ((x -= pool[i].wt) < 0) break;
      opts.push(pool.splice(i, 1)[0]);
    }
    if (!opts.length) opts.push({ k: 'heal' }, { k: 'coins' });
    return opts.slice(0, Math.max(k, 1));
  }
  function apply(G, p, o){
    const before = p.maxHp;
    if (o.k === 'w') { const w = p.weapons.find(x => x.id === o.id); if (w) w.lvl = Math.min(5, w.lvl + 1); else p.weapons.push(newWeapon(p, o.id)); }
    else if (o.k === 'evo') { const w = p.weapons.find(x => x.id === o.id); if (w) w.evo = true; }
    else if (o.k === 'p') p.pass[o.id] = Math.min(PASSIVES[o.id].max, (p.pass[o.id] || 0) + 1);
    else if (o.k === 'heal') heal(p, 40);
    else if (o.k === 'coins') G.coins += 10;
    calcStats(p);
    if (p.maxHp > before) p.hp += p.maxHp - before;
    G.luck = Math.max(...G.players.map(x => x.luck));
  }
  function optInfo(p, o){
    if (o.k === 'evo') { const W = WEAPONS[o.id]; return { e: W.evoE, name: W.evoName, tag: '⭐ эволюция', text: `«${W.name}» становится намного сильнее`, evo: true }; }
    if (o.k === 'w') {
      const W = WEAPONS[o.id], w = p.weapons.find(x => x.id === o.id);
      if (!w) return { e: W.e, name: W.name, tag: 'новое', text: W.text };
      const P = PASSIVES[W.evo];
      return { e: W.e, name: W.name, tag: `ур. ${w.lvl + 1}`, text: W.ups[w.lvl - 1] + (w.lvl + 1 === 5 ? ` · с ${P.e} «${P.name}» → ⭐ ${W.evoName}` : '') };
    }
    if (o.k === 'p') {
      const P = PASSIVES[o.id], l = p.pass[o.id] || 0;
      const pair = p.weapons.find(w => WEAPONS[w.id].evo === o.id && !w.evo);
      return { e: P.e, name: P.name, tag: l ? `ур. ${l + 1}` : 'новое', text: P.text + (pair ? ` · нужна для ⭐ ${WEAPONS[pair.id].evoName}` : '') };
    }
    if (o.k === 'heal') return { e: '🍗', name: 'Курочка', tag: '', text: '+40 здоровья' };
    return { e: '🪙', name: 'Монеты', tag: '', text: '+10 монет' };
  }

  // ═══ ЭКРАН, УПРАВЛЕНИЕ, МЕНЮ ═══
  let root, api, wrap, cv, ctx, ov, hud, G = null, raf = 0, last = 0, acc = 0, mode = 'menu', hooks = null, stopDuel = null;
  let dpr = 1, k = 1, scale = 1, cssW = 0, cssH = 0, full = false, ox = 0, oy = 0, ovLock = 0, choosing = null, runId = '', lastProg = 0, sfxAt = 0, duelSeed = 0;
  let look = null, petX = 0, petY = 0, trail = [], trailAt = 0;
  const input = { keys: {}, jx: 0, jy: 0, on: false, id: null, ox: 0, oy: 0, px: 0, py: 0 };
  const listeners = [];
  const sprites = new Map();
  const ITEM_E = { coin: '🪙', heal: '🍗', magnet: '🧲', bomb: '💣', chest: '📦' };
  const PROJ_E = { knife: '🔪', fire: '🔥', axe: '🪓', boom: '🪃' };
  const DECO = ['🌿', '🪨', '🍄', '🪦', '🌾', '🦴', '🌵', '🕸️'];
  const UPS = [['might', '💪', 'Сила', '+5% урона', 5], ['hp', '❤️', 'Здоровье', '+10 здоровья', 5], ['armor', '🛡️', 'Броня', '+1 броня', 3],
    ['speed', '👟', 'Скорость', '+4% скорости', 5], ['magnet', '🧲', 'Магнит', '+15% радиус сбора', 5], ['greed', '💰', 'Жадность', '+10% монет', 5]];

  const C = () => window.D37Coins, CH = () => window.D37Char;
  const signedIn = () => typeof currentUser !== 'undefined' && !!currentUser;
  const heroOwned = id => id === 'mage' || C().owns('hero:' + id) || (id === 'streamer' && C().perks());
  function selHero(){ let h = 'mage'; try { h = localStorage.getItem('d37_horde_hero') || 'mage'; } catch (e) {} return HEROES.some(x => x.id === h) && heroOwned(h) ? h : 'mage'; }
  function saveHero(id){ try { localStorage.setItem('d37_horde_hero', id); } catch (e) {} }
  function toast(t){ api?.toast?.(t); }

  function spr(e, px, white){
    px = Math.max(6, Math.round(px));
    const key = e + '|' + px + (white ? 'w' : '');
    let c = sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    const s = Math.ceil(px * 1.3);
    c.width = c.height = s;
    const x = c.getContext('2d');
    x.font = `${px}px ${EF}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(e, s / 2, s / 2 + px * .05);
    if (white) { x.globalCompositeOperation = 'source-atop'; x.fillStyle = '#fff'; x.fillRect(0, 0, s, s); }
    sprites.set(key, c);
    return c;
  }
  function drawSpr(e, size, x, y, white){
    const c = spr(e, size * k, white);
    ctx.drawImage(c, ox + x * k - c.width / 2, oy + y * k - c.height / 2);
  }

  function build(el){
    el.innerHTML = `<div class="hd">
        <div class="hd-wrap">
          <canvas class="hd-cv"></canvas>
          <div class="hd-hud" hidden><button type="button" class="hd-btn" data-act="pause" aria-label="Пауза">⏸</button><button type="button" class="hd-btn" data-act="full" aria-label="Во весь экран">⛶</button></div>
          <div class="hd-ov"></div>
        </div>
        <div class="ct-note hd-note">Ходи стрелками / WASD или пальцем: зажми в любом месте поля и веди. Оружие бьёт само, ты выбираешь улучшения.</div>
      </div>`;
    wrap = el.querySelector('.hd-wrap'); cv = el.querySelector('.hd-cv'); ctx = cv.getContext('2d'); ov = el.querySelector('.hd-ov'); hud = el.querySelector('.hd-hud');
    hud.addEventListener('click', e => { const a = e.target.closest('[data-act]')?.dataset.act; if (a === 'pause') pause(); else if (a === 'full') toggleFull(); });
    ov.addEventListener('click', onOv);
    cv.addEventListener('pointerdown', onDown);
    look = CH()?.look() || null;
    resize();
  }
  function showOv(html){ ov.innerHTML = html; ov.hidden = false; ov.scrollTop = 0; ovLock = Date.now() + 350; input.on = false; input.jx = input.jy = 0; }
  function hideOv(){ ov.hidden = true; ov.innerHTML = ''; }

  function resize(){
    if (!cv) return;
    dpr = Math.min(document.body.classList.contains('low') ? 1 : 2, window.devicePixelRatio || 1);
    const w = full ? window.innerWidth : (wrap.parentElement.clientWidth || 360);
    const phone = w < 640;
    let h = full ? window.innerHeight : phone ? Math.min(window.innerHeight - 140, Math.round(w * 1.7)) : Math.min(Math.max(440, window.innerHeight - 230), Math.round(w * .66));
    h = Math.max(340, h);
    cssW = w; cssH = h;
    cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    scale = Math.min(w, h) / VIEW; k = scale * dpr;
    sprites.clear();
    if (G) setView(G, w / scale, h / scale);
    draw();
  }
  function toggleFull(){
    full = !full;
    wrap.classList.toggle('hd-full', full);
    document.documentElement.classList.toggle('hd-lock', full);
    if (full && wrap.requestFullscreen && !document.fullscreenElement) wrap.requestFullscreen().catch(() => {});
    if (!full && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setTimeout(resize, 60);
  }
  function onFs(){ if (!document.fullscreenElement && full) { full = false; wrap?.classList.remove('hd-full'); document.documentElement.classList.remove('hd-lock'); setTimeout(resize, 60); } }

  // ── Управление ──
  const KEYMAP = { arrowup: 'u', w: 'u', 'ц': 'u', arrowdown: 'd', s: 'd', 'ы': 'd', arrowleft: 'l', a: 'l', 'ф': 'l', arrowright: 'r', d: 'r', 'в': 'r' };
  function onKey(e){
    if (!cv || e.target?.closest?.('input,textarea')) return;
    const key = (e.key || '').toLowerCase(), down = e.type === 'keydown';
    if (down && mode === 'choose' && /^[1-4]$/.test(key)) { e.preventDefault(); pick(+key - 1); return; }
    if (down && (key === 'escape' || key === 'p' || key === 'з')) { if (mode === 'run') pause(); else if (mode === 'pause') resume(); return; }
    const d = KEYMAP[key];
    if (!d) return;
    input.keys[d] = down;
    if (mode === 'run') e.preventDefault();
  }
  function onDown(e){
    if (mode !== 'run') return;
    input.on = true; input.id = e.pointerId; input.ox = input.px = e.clientX; input.oy = input.py = e.clientY; input.jx = input.jy = 0;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  }
  function onMove(e){
    if (!input.on || e.pointerId !== input.id) return;
    input.px = e.clientX; input.py = e.clientY;
    let dx = e.clientX - input.ox, dy = e.clientY - input.oy;
    const d = Math.hypot(dx, dy), R = 46;
    if (d > R) { input.ox += dx / d * (d - R); input.oy += dy / d * (d - R); dx = e.clientX - input.ox; dy = e.clientY - input.oy; }   // центр тянется за пальцем
    const m = Math.hypot(dx, dy);
    input.jx = m < 6 ? 0 : dx / R; input.jy = m < 6 ? 0 : dy / R;
  }
  function onUp(e){ if (e.pointerId !== input.id) return; input.on = false; input.id = null; input.jx = input.jy = 0; }
  function onVis(){ if (document.hidden && mode === 'run') pause(); }
  function applyInput(){
    const p = G.players[G.me];
    let x = (input.keys.r ? 1 : 0) - (input.keys.l ? 1 : 0), y = (input.keys.d ? 1 : 0) - (input.keys.u ? 1 : 0);
    if (input.on) { x += input.jx; y += input.jy; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    p.in.x = x; p.in.y = y;
  }

  // ── Цикл ──
  function startLoop(){ if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function frame(now){
    raf = 0;
    if (!G || !cv) return;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > .1) dt = .1;
    if (mode === 'run') {
      acc += dt;
      let n = 0;
      while (acc >= DT && n < 6) {
        applyInput();
        step(G);
        acc -= DT; n++;
        if (afterStep()) break;
      }
      if (n >= 6) acc = 0;
    }
    draw();
    if (mode === 'run') raf = requestAnimationFrame(frame);
  }
  function afterStep(){
    const p = G.players[G.me];
    const t = performance.now();
    if (G.sfxHurt) { G.sfxHurt = false; if (t - sfxAt > 350) { sfxAt = t; api.sfx('bad'); } }
    if (G.sfxChest) { G.sfxChest = false; api.sfx('win'); }
    if (G.sfxCoin) { G.sfxCoin = false; api.sfx('tick'); }
    if (hooks && G.t - lastProg >= 1) { lastProg = G.t; hooks.progress(score(G)); }
    if (G.over) { finish(); return true; }
    if (p.dead) { death(); return true; }
    if (G.pend > 0) { levelUp(); return true; }
    return false;
  }

  // ── Рисование ──
  function hash(x, y){ let h = Math.imul(x, 374761393) + Math.imul(y, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; }
  function draw(){
    if (!ctx || !cv) return;
    const W = cv.width, H = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#16111f'; ctx.fillRect(0, 0, W, H);
    if (!G) { drawIdle(W, H); return; }
    const me = G.players[G.me];
    const sh = G.shake > 0 && mode === 'run' ? G.shake * 30 * dpr : 0;
    ox = W / 2 - me.x * k + (sh ? (Math.random() - .5) * sh : 0);
    oy = H / 2 - me.y * k + (sh ? (Math.random() - .5) * sh : 0);
    const hw = W / k / 2 + 60, hh = H / k / 2 + 60;
    const inV = (x, y) => Math.abs(x - me.x) < hw && Math.abs(y - me.y) < hh;
    // земля: сетка и декор
    ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 1;
    ctx.beginPath();
    const g = 80;
    for (let x = Math.floor((me.x - hw) / g) * g; x < me.x + hw; x += g) { const X = Math.round(ox + x * k) + .5; ctx.moveTo(X, 0); ctx.lineTo(X, H); }
    for (let y = Math.floor((me.y - hh) / g) * g; y < me.y + hh; y += g) { const Y = Math.round(oy + y * k) + .5; ctx.moveTo(0, Y); ctx.lineTo(W, Y); }
    ctx.stroke();
    const D = 230;
    ctx.globalAlpha = .3;
    for (let ix = Math.floor((me.x - hw) / D); ix <= Math.floor((me.x + hw) / D); ix++) for (let iy = Math.floor((me.y - hh) / D); iy <= Math.floor((me.y + hh) / D); iy++) {
      const h = hash(ix, iy);
      if (h % 3) continue;
      drawSpr(DECO[(h >>> 3) % DECO.length], 24, ix * D + (h >>> 8) % 170, iy * D + (h >>> 16) % 170);
    }
    ctx.globalAlpha = 1;
    // лужи святой воды
    for (const z of G.zones) {
      ctx.fillStyle = z.evo ? `rgba(129,140,248,${Math.min(1, z.t / .3) * .42})` : `rgba(56,189,248,${Math.min(1, z.t / .3) * .38})`;
      ctx.beginPath(); ctx.arc(ox + z.x * k, oy + z.y * k, z.r * k, 0, TAU); ctx.fill();
    }
    // кристаллы опыта
    for (const gm of G.gems) {
      if (!inV(gm.x, gm.y)) continue;
      const s = (gm.v >= 20 ? 7 : gm.v >= 5 ? 6 : 4.5) * k, X = ox + gm.x * k, Y = oy + gm.y * k;
      ctx.fillStyle = gm.v >= 20 ? '#ff4d6d' : gm.v >= 5 ? '#4ade80' : '#60a5fa';
      ctx.beginPath(); ctx.moveTo(X, Y - s); ctx.lineTo(X + s * .7, Y); ctx.lineTo(X, Y + s); ctx.lineTo(X - s * .7, Y); ctx.closePath(); ctx.fill();
    }
    for (const it of G.items) if (inV(it.x, it.y)) drawSpr(ITEM_E[it.k], it.k === 'chest' ? 30 : 22, it.x, it.y + Math.sin(G.t * 4 + it.x) * 2);
    // аура
    for (const p of G.players) {
      const a = !p.dead && p.weapons.find(w => w.id === 'aura');
      if (!a) continue;
      const R = a.s.rad * p.area * k, X = ox + p.x * k, Y = oy + p.y * k;
      const gr = ctx.createRadialGradient(X, Y, R * .2, X, Y, R);
      gr.addColorStop(0, a.evo ? 'rgba(167,139,250,.05)' : 'rgba(255,240,200,.04)'); gr.addColorStop(1, a.evo ? 'rgba(167,139,250,.28)' : 'rgba(255,240,200,.2)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(X, Y, R, 0, TAU); ctx.fill();
    }
    // след персонажа
    for (const tp of trail) {
      ctx.globalAlpha = Math.max(0, tp.t);
      if (tp.e === 'rainbow') { ctx.fillStyle = tp.c; ctx.beginPath(); ctx.arc(ox + tp.x * k, oy + tp.y * k, 6 * k * tp.t, 0, TAU); ctx.fill(); }
      else drawSpr(tp.e, 14, tp.x, tp.y - (1 - tp.t) * 14);
    }
    ctx.globalAlpha = 1;
    // монстры
    for (const e of G.en) {
      if (!inV(e.x, e.y)) continue;
      const bob = Math.sin(G.t * 10 + e.id) * 1.5;
      if (e.elite || e.d.boss) { ctx.fillStyle = e.d.boss ? 'rgba(255,45,85,.22)' : 'rgba(255,159,67,.25)'; ctx.beginPath(); ctx.arc(ox + e.x * k, oy + (e.y + e.r * .6) * k, e.r * 1.3 * k, 0, TAU); ctx.fill(); }
      drawSpr(e.d.e, e.d.sz, e.x, e.y + bob);
      if (e.flash > 0) { ctx.globalAlpha = .7; drawSpr(e.d.e, e.d.sz, e.x, e.y + bob, true); ctx.globalAlpha = 1; }
    }
    // игрок
    for (const p of G.players) drawPlayer(p);
    // снаряды
    for (const s of G.pr) {
      if (!inV(s.x, s.y)) continue;
      const X = ox + s.x * k, Y = oy + s.y * k;
      if (s.k === 'bolt') {
        ctx.fillStyle = s.evo ? '#ffe066' : '#c4b5fd';
        ctx.globalAlpha = .35; ctx.beginPath(); ctx.arc(X - s.vx * .02 * k, Y - s.vy * .02 * k, 5 * k, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(X, Y, 5 * k, 0, TAU); ctx.fill();
      } else {
        const c = spr(PROJ_E[s.k], (s.k === 'fire' ? (s.evo ? 34 : 26) : s.k === 'knife' ? 20 : 24 * (s.r / 13)) * k);
        ctx.save(); ctx.translate(X, Y); ctx.rotate(s.k === 'knife' ? s.rot - Math.PI * .75 : s.k === 'fire' ? 0 : s.rot);
        ctx.drawImage(c, -c.width / 2, -c.height / 2); ctx.restore();
      }
    }
    for (const s of G.eb) {
      if (!inV(s.x, s.y)) continue;
      ctx.fillStyle = s.big ? '#ff9f43' : '#ff4d6d';
      ctx.beginPath(); ctx.arc(ox + s.x * k, oy + s.y * k, s.r * k, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
    }
    for (const w of G.waves) {
      ctx.strokeStyle = `rgba(255,209,102,${Math.max(0, 1 - w.r / w.R) * .9})`; ctx.lineWidth = 7 * k;
      ctx.beginPath(); ctx.arc(ox + w.x * k, oy + w.y * k, w.r * k, 0, TAU); ctx.stroke();
    }
    for (const f of G.fx) drawFx(f);
    if (G.numsOn) {
      ctx.font = `800 ${Math.round(11 * dpr)}px Montserrat,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      for (const n of G.nums) { ctx.globalAlpha = Math.min(1, n.t / .25); ctx.fillText(Math.round(n.v), ox + n.x * k, oy + (n.y - (.5 - n.t) * 40) * k); }
      ctx.globalAlpha = 1;
    }
    drawHud(W, H, me);
    if (input.on && mode === 'run') {
      const r = cv.getBoundingClientRect();
      const bx = (input.ox - r.left) * dpr, by = (input.oy - r.top) * dpr;
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(bx, by, 46 * dpr, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.beginPath(); ctx.arc(bx + input.jx * 46 * dpr, by + input.jy * 46 * dpr, 20 * dpr, 0, TAU); ctx.fill();
    }
  }
  function drawPlayer(p){
    if (p.dead) { drawSpr('🪦', 30, p.x, p.y); return; }
    const X = ox + p.x * k, Y = oy + p.y * k;
    // питомец бежит следом
    const pet = look ? CH()?.petEmoji(look) : '';
    if (pet && p.idx === G.me) {
      const tx = p.x - p.hx * 34, ty = p.y + 6 + Math.sin(G.t * 7) * 3;
      petX += (tx - petX) * .08; petY += (ty - petY) * .12;
      drawSpr(pet, 22, petX, petY);
    }
    if (p.inv > 0 && Math.floor(G.t * 16) % 2) ctx.globalAlpha = .45;
    if (CH() && look) {
      const S = 40 * k, sq = p.moving ? Math.sin(G.t * 18) * .04 : Math.sin(G.t * 3) * .015;
      const sp = CH().sprite(look, S, { dir: p.hx, item: p.hand, noPet: true, t: G.t });
      const w = sp.c.width * (1 + sq), h = sp.c.height * (1 - sq);
      ctx.drawImage(sp.c, X - sp.ax * (1 + sq), Y + S * .5 - sp.ay * (1 - sq), w, h);
    } else drawSpr('🧙', 34, p.x, p.y);
    ctx.globalAlpha = 1;
    const bw = 34 * k, bh = 4 * k, bx = X - bw / 2, by = Y + 22 * k;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = p.hp / p.maxHp > .35 ? '#4ade80' : '#ff4d6d'; ctx.fillRect(bx, by, bw * Math.max(0, p.hp / p.maxHp), bh);
    const ob = p.weapons.find(w => w.id === 'orbit');
    if (ob && ob.on > 0) {
      const n = ob.s.n + p.amount, R = ob.s.rad * p.area;
      for (let i = 0; i < n; i++) { const a = ob.ang + i / n * TAU; drawSpr(ob.evo ? '📚' : '📖', 22 * p.area, p.x + Math.cos(a) * R, p.y + Math.sin(a) * R); }
    }
  }
  function drawFx(f){
    const X = ox + f.x * k, Y = oy + f.y * k, a = Math.max(0, f.t / f.T);
    if (f.k === 'puff') { ctx.fillStyle = `rgba(200,190,220,${a * .35})`; ctx.beginPath(); ctx.arc(X, Y, f.r * (1.8 - a * .8) * k, 0, TAU); ctx.fill(); }
    else if (f.k === 'slash') {
      ctx.save(); ctx.translate(X, Y); ctx.scale(f.dir, 1);
      ctx.fillStyle = f.red ? `rgba(255,77,109,${a * .7})` : `rgba(255,255,255,${a * .65})`;
      ctx.beginPath(); ctx.ellipse(0, 0, f.w / 2 * k, f.h / 2 * k, 0, -Math.PI / 2, Math.PI / 2); ctx.ellipse(-f.w * .12 * k, 0, f.w * .38 * k, f.h * .3 * k, 0, Math.PI / 2, -Math.PI / 2, true); ctx.fill();
      ctx.restore();
    } else if (f.k === 'zap') {
      if (!f.pts) { f.pts = []; for (let i = 0; i <= 6; i++) f.pts.push((Math.random() - .5) * 26); }
      ctx.strokeStyle = `rgba(253,224,71,${a})`; ctx.lineWidth = 3 * dpr; ctx.beginPath();
      for (let i = 0; i <= 6; i++) { const yy = Y - (6 - i) / 6 * 260 * k; i ? ctx.lineTo(X + f.pts[i] * k, yy) : ctx.moveTo(X + f.pts[i] * k, yy); }
      ctx.stroke();
      ctx.fillStyle = `rgba(253,224,71,${a * .3})`; ctx.beginPath(); ctx.arc(X, Y, f.R * k, 0, TAU); ctx.fill();
    } else if (f.k === 'boom') {
      const gr = ctx.createRadialGradient(X, Y, 0, X, Y, f.R * k);
      gr.addColorStop(0, `rgba(255,220,120,${a * .8})`); gr.addColorStop(1, `rgba(255,90,40,${a * .1})`);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(X, Y, f.R * (1.1 - a * .3) * k, 0, TAU); ctx.fill();
    } else if (f.k === 'text') {
      ctx.globalAlpha = a; ctx.fillStyle = f.color; ctx.font = `800 ${Math.round(13 * dpr)}px Montserrat,sans-serif,${EF}`; ctx.textAlign = 'center';
      ctx.fillText(f.text, X, Y - (1 - a) * 26 * k); ctx.globalAlpha = 1;
    } else if (f.k === 'flash') { ctx.fillStyle = `rgba(255,255,255,${a * .5})`; ctx.fillRect(0, 0, cv.width, cv.height); }
  }
  function drawHud(W, H, me){
    const s = dpr;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, 10 * s);
    ctx.fillStyle = '#60a5fa'; ctx.fillRect(0, 0, W * Math.min(1, G.xp / G.next), 10 * s);
    ctx.textBaseline = 'top'; ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.round(11 * s)}px Montserrat,sans-serif`; ctx.textAlign = 'left';
    ctx.fillText(`УР. ${G.level}`, 8 * s, 15 * s);
    ctx.font = `800 ${Math.round(12 * s)}px Montserrat,sans-serif,${EF}`;
    ctx.fillText(`💀 ${num(G.kills)}   🪙 ${G.coins}`, 8 * s, 31 * s);
    ctx.textAlign = 'center'; ctx.font = `900 ${Math.round(20 * s)}px Montserrat,sans-serif`;
    ctx.fillStyle = G.t >= RUN_TIME - 30 ? '#ffd166' : '#fff';
    ctx.fillText(mmss(G.t), W / 2, 15 * s);
    // оружие и пассивки — значками
    let x = 8 * s;
    const y = 50 * s, sz = 16;
    for (const w of me.weapons) { const c = spr(w.evo ? WEAPONS[w.id].evoE : WEAPONS[w.id].e, sz * s); ctx.drawImage(c, x, y); x += c.width + 2 * s; }
    x += 6 * s;
    for (const id in me.pass) { const c = spr(PASSIVES[id].e, 12 * s); ctx.globalAlpha = .85; ctx.drawImage(c, x, y + 3 * s); ctx.globalAlpha = 1; x += c.width + 1 * s; }
    if (G.boss && !G.boss.dead) {
      const bw = Math.min(W * .6, 360 * s), bx = (W - bw) / 2, by = 42 * s;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(bx - 2, by - 2, bw + 4, 12 * s + 4);
      ctx.fillStyle = '#ff2d55'; ctx.fillRect(bx, by, bw * Math.max(0, G.boss.hp / G.boss.max), 12 * s);
      ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(10 * s)}px Montserrat,sans-serif,${EF}`; ctx.textAlign = 'center';
      ctx.fillText(`${G.boss.d.e} ${G.boss.d.name}`, W / 2, by + 1 * s);
    }
    if (G.banner) {
      ctx.globalAlpha = Math.min(1, G.banner.t / .4);
      ctx.font = `900 ${Math.round(17 * s)}px Montserrat,sans-serif,${EF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4 * s; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(G.banner.text, W / 2, H * .3);
      ctx.fillStyle = '#ffd166'; ctx.fillText(G.banner.text, W / 2, H * .3);
      ctx.globalAlpha = 1;
    }
  }
  function drawIdle(W, H){
    ctx.globalAlpha = .18;
    ctx.font = `${Math.round(38 * dpr)}px ${EF}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const list = ['🧟', '🦇', '💀', '👻', '🕷️', '🤡', '👹', '🎃'];
    for (let i = 0; i < 18; i++) ctx.fillText(list[i % list.length], (hash(i, 3) % 1000) / 1000 * W, (hash(i, 7) % 1000) / 1000 * H);
    ctx.globalAlpha = 1;
  }
  function trailTick(){
    if (!G || !look) return;
    const p = G.players[G.me];
    for (const t of trail) t.t -= .03;
    trail = trail.filter(t => t.t > 0);
    const e = CH()?.trail(look);
    if (!e || !p.moving || p.dead) return;
    const now = performance.now();
    if (now - trailAt < 75) return;
    trailAt = now;
    trail.push({ x: p.x - p.fx * 14 + (Math.random() - .5) * 8, y: p.y + 10 + (Math.random() - .5) * 8, t: 1, e, c: `hsl(${(G.t * 220) % 360},90%,60%)` });
  }

  // ── Экраны ──
  function heroCard(h, act){
    const own = heroOwned(h.id), sel = selHero() === h.id, W = WEAPONS[h.weapon];
    return `<button type="button" class="hd-hero${sel ? ' sel' : ''}${own ? '' : ' locked'}" data-act="${act}:${h.id}">
      <span class="ic">${h.e}</span><b>${h.name}</b><small>${W.e} ${W.name}</small>
      ${own ? (sel ? '<span class="hd-tag">выбран</span>' : '') : `<span class="hd-price">${h.vip ? 'VIP или ' : ''}🪙 ${num(C().price('hero:' + h.id))}</span>`}
    </button>`;
  }
  function charPreview(){ return CH() ? `<a class="hd-me" href="#/games/wardrobe" title="Изменить персонажа"><img alt="Мой персонаж" src="${CH().img(CH().look(), 96)}"><span>🎭 Гардероб</span></a>` : ''; }
  function menu(){
    mode = 'menu'; G = null; hooks = null; hud.hidden = true;
    look = CH()?.look() || null;
    const best = api.local().best || 0;
    showOv(`<div class="hd-head">${charPreview()}<div><div class="hd-title">🧟 Орда</div>
        <div class="hd-sub">Продержись 10 минут против орды монстров. Оружие бьёт само — ты выбираешь улучшения.</div></div></div>
      <div class="hd-label">Герой</div>
      <div class="hd-heroes">${HEROES.map(h => heroCard(h, 'hero')).join('')}</div>
      <div class="ct-actions"><button type="button" class="ct-start" data-act="play">▶ Играть</button><button type="button" class="ct-duel-btn" data-act="duel">⚔️ С другом</button></div>
      <div class="hd-wallet">🪙 <b class="js-coins">${num(C().coins())}</b> монет
        ${C().canDaily() ? '<button type="button" class="hd-mini gold" data-act="daily">🎁 Бонус дня</button>' : ''}
        <button type="button" class="hd-mini" data-act="shop">🛒 Улучшения</button></div>
      ${best ? `<div class="hd-best">Рекорд: <b>${num(best)}</b> очков</div>` : ''}
      ${signedIn() ? '' : '<div class="hd-hint">Войди в аккаунт — за победы будут XP, а монеты и покупки сохранятся на всех устройствах.</div>'}`);
    draw();
  }
  function heroInfo(id){
    const h = HEROES.find(x => x.id === id), price = C().price('hero:' + id), have = C().coins(), W = WEAPONS[h.weapon];
    showOv(`<div class="hd-big">${h.e}</div><div class="hd-title">${h.name}</div><div class="hd-sub">${h.text}</div>
      <div class="hd-sub">Стартовое оружие: ${W.e} <b>${W.name}</b> — ${W.text}</div>
      ${h.vip ? '<div class="hd-hint">👑 С VIP этот герой бесплатный. <a href="/vip" target="_blank" rel="noopener">Как получить VIP</a></div>' : ''}
      <div class="ct-actions"><button type="button" class="ct-start" data-act="buy:hero:${id}"${have < price ? ' disabled' : ''}>Купить за 🪙 ${num(price)}</button><button type="button" data-act="menu">← Назад</button></div>
      ${have < price ? `<div class="hd-hint">У тебя ${num(have)} 🪙. Монеты — за забеги, победы в любых играх сайта, бонус дня и задание дня.</div>` : ''}`);
  }
  function shop(){
    showOv(`<div class="hd-title">🛒 Улучшения</div><div class="hd-sub">Навсегда, для всех героев. В соревновании не действуют.</div>
      <div class="hd-wallet">🪙 <b class="js-coins">${num(C().coins())}</b> монет</div>
      <div class="hd-shop">${UPS.map(([id, e, name, text, max]) => {
        const l = C().upLevel(id), pr = l < max ? C().price(`up:${id}:${l + 1}`) : 0;
        return `<div class="hd-up"><span class="ic">${e}</span><div class="hd-up-b"><b>${name}</b><small>${text} за уровень</small><span class="hd-pips">${'●'.repeat(l)}${'○'.repeat(max - l)}</span></div>
          ${l < max ? `<button type="button" class="hd-buy" data-act="buy:up:${id}:${l + 1}"${C().coins() < pr ? ' disabled' : ''}>🪙 ${num(pr)}</button>` : '<span class="hd-max">MAX</span>'}</div>`;
      }).join('')}</div>
      <button type="button" class="hd-mini" data-act="menu">← Назад</button>`);
  }
  async function buyItem(item, btn){
    btn.disabled = true;
    const r = await C().buy(item);
    if (r?.ok) { api.sfx('win'); toast('✅ Куплено!'); if (item.startsWith('hero:')) saveHero(item.slice(5)); }
    else toast(r?.reason === 'coins' ? 'Не хватает монет' : 'Не получилось — попробуй ещё раз');
    if (item.startsWith('up:')) shop(); else menu();
  }

  function play(o){
    const hero = selHero();
    const up = o.duel ? {} : Object.fromEntries(UPS.map(([id]) => [id, C().upLevel(id)]));
    look = CH()?.look() || null;
    G = newGame({ seed: o.seed ?? Math.floor(Math.random() * 2 ** 31), hero, up, duel: !!o.duel, low: document.body.classList.contains('low') });
    G.k4 = !o.duel && C().perks();
    setView(G, cssW / scale, cssH / scale);
    petX = G.players[0].x - 30; petY = G.players[0].y;
    trail = [];
    runId = 'h' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    hideOv(); hud.hidden = false;
    mode = 'run'; acc = 0; lastProg = 0;
    startLoop();
  }
  function levelUp(){
    mode = 'choose';
    const p = G.players[G.me];
    choosing = lvOptions(G, p, G.k4 ? 4 : 3);
    api.sfx('ok');
    showOv(`<div class="hd-title">⭐ Уровень ${G.level - G.pend + 1}!</div><div class="hd-sub">Выбери улучшение</div>
      <div class="hd-lv">${choosing.map((o, i) => { const f = optInfo(p, o); return `<button type="button" class="hd-card${f.evo ? ' evo' : ''}" data-act="pick:${i}"><span class="ic">${f.e}</span><span class="hd-card-b"><b>${f.name}${f.tag ? ` <span class="tag">${f.tag}</span>` : ''}</b><small>${f.text}</small></span><kbd>${i + 1}</kbd></button>`; }).join('')}</div>
      ${G.k4 ? '<div class="hd-hint">👑 VIP: 4 варианта на выбор</div>' : ''}`);
  }
  function pick(i){
    if (mode !== 'choose' || !choosing?.[i] || Date.now() < ovLock) return;
    apply(G, G.players[G.me], choosing[i]);
    choosing = null; G.pend--;
    if (G.pend > 0) { levelUp(); return; }
    resume();
  }
  function pause(){
    if (mode !== 'run') return;
    mode = 'pause';
    const p = G.players[G.me];
    showOv(`<div class="hd-title">⏸ Пауза</div><div class="hd-sub">${mmss(G.t)} · ${num(G.kills)} монстров · ур. ${G.level}</div>
      <div class="hd-build">${buildHtml(p)}</div>
      <div class="ct-actions"><button type="button" class="ct-start" data-act="resume">▶ Продолжить</button><button type="button" data-act="quit">🏳️ Сдаться</button></div>`);
  }
  function resume(){ if (!G) return; hideOv(); mode = 'run'; startLoop(); }
  function buildHtml(p){
    return p.weapons.map(w => `<span title="${w.evo ? WEAPONS[w.id].evoName : WEAPONS[w.id].name}">${w.evo ? WEAPONS[w.id].evoE : WEAPONS[w.id].e}<i>${w.evo ? '⭐' : w.lvl}</i></span>`).join('')
      + Object.entries(p.pass).map(([id, l]) => `<span title="${PASSIVES[id].name}">${PASSIVES[id].e}<i>${l}</i></span>`).join('');
  }
  function death(){
    mode = 'dead';
    if (G.duel || G.revived) { finish(); return; }
    const adOk = !!window.D37Ads?.rewardReady?.(), price = C().RULES.revive, coinOk = C().coins() >= price;
    showOv(`<div class="hd-title">💀 Орда тебя достала</div><div class="hd-sub">${mmss(G.t)} · ${num(G.kills)} монстров. Возродиться? Можно один раз за забег.</div>
      <div class="hd-col">
        ${adOk ? '<button type="button" class="ct-start" data-act="revive-ad">📺 Посмотреть рекламу и возродиться</button>' : ''}
        <button type="button" class="${adOk ? 'hd-alt' : 'ct-start'}" data-act="revive-coins"${coinOk ? '' : ' disabled'}>🪙 Возродиться за ${price} монет</button>
        <button type="button" class="hd-alt" data-act="end">🏳️ Закончить забег</button>
      </div>
      ${coinOk ? '' : `<div class="hd-hint">У тебя ${num(C().coins())} 🪙 — монеты дают за забеги, победы в любых играх и бонус дня.</div>`}`);
  }
  async function revive(how){
    if (mode !== 'dead' || !G) return;
    ov.querySelectorAll('button').forEach(x => { x.disabled = true; });
    if (how === 'ad') {
      const ok = await window.D37Ads.showReward('horde_revive');
      if (!ok) { toast('Реклама не досмотрена — возрождения нет'); death(); return; }
    } else {
      const r = await C().revive('horde');
      if (!r?.ok) { toast(r?.reason === 'coins' ? 'Не хватает монет' : 'Не получилось — попробуй ещё раз'); death(); return; }
    }
    const p = G.players[G.me];
    G.revived = true; p.dead = false; p.hp = Math.round(p.maxHp * .6); p.inv = 2.5;
    for (const e of G.en) {
      if (e.d.boss) continue;
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
      if (d < 240) { e.x = p.x + dx / d * 280; e.y = p.y + dy / d * 280; }
    }
    G.eb.length = 0;
    G.banner = { text: '✨ Снова в бою!', t: 1.6 };
    api.sfx('win');
    resume();
  }
  async function finish(){
    if (mode === 'end' || !G) return;
    mode = 'end'; hud.hidden = true;
    const p = G.players[G.me], sc = score(G);
    const coins = Math.round(G.coins * p.greed) + Math.floor(G.t / 60) * 6 + (G.won ? 50 : 0);
    if (hooks) { hooks.progress(sc); hooks.done(sc); }
    else api.report('horde', G.t >= WIN_TIME, sc, sc);
    const best = Math.max(api.local().best || 0, sc);
    api.sfx(G.won ? 'win' : 'bad');
    showOv(`<div class="hd-title">${G.won ? '🏆 Ты выжил!' : '💀 Орда победила'}</div>
      <div class="hd-stats"><span>⏱ <b>${mmss(G.t)}</b></span><span>💀 <b>${num(G.kills)}</b></span><span>⭐ ур. <b>${G.level}</b></span></div>
      <div class="hd-score">${num(sc)} очков${!hooks && sc >= best && sc > 0 ? ' · 🏆 рекорд!' : ''}</div>
      <div class="hd-coins" id="hdCoins">${coins ? `🪙 +${num(coins)} монет…` : 'Монет в этот раз нет'}</div>
      <div class="hd-build">${buildHtml(p)}</div>
      ${hooks ? '' : `<div class="ct-actions"><button type="button" class="ct-start" data-act="again">↻ Ещё раз</button><button type="button" class="ct-duel-btn" data-act="duel">⚔️ С другом</button><button type="button" data-act="share">📤 Поделиться</button></div>
      <button type="button" class="hd-mini" data-act="menu">🏠 Герои и улучшения</button>`}`);
    if (!coins) return;
    const r = await C().run('horde', coins, runId);
    const box = ov.querySelector('#hdCoins');
    if (!box || mode !== 'end') return;
    if (!r?.ok) { box.textContent = r?.reason === 'day_cap' ? '🪙 Лимит монет за забеги на сегодня исчерпан' : r?.reason === 'too_fast' ? '🪙 Забег слишком короткий для монет' : '🪙 Монеты не начислились — проверь интернет'; return; }
    box.innerHTML = `🪙 <b>+${num(r.got)}</b> монет${r.base && r.got > r.base ? ' <span class="hd-vip">VIP ×2</span>' : ''}`;
    if (window.D37Ads?.rewardReady?.() && C().canDouble() && !hooks) box.insertAdjacentHTML('afterend', `<button type="button" class="hd-x2" data-act="x2">📺 Смотреть рекламу → ещё +${num(r.base || r.got)} 🪙</button>`);
  }
  async function again(btn){
    btn.disabled = true;
    try { await window.D37Ads?.interstitial?.('horde'); } catch (e) {}
    play({});
  }
  async function doubleCoins(btn){
    btn.disabled = true;
    const ok = await window.D37Ads.showReward('horde_x2');
    if (!ok) { toast('Реклама не досмотрена — бонуса нет'); btn.disabled = false; return; }
    const r = await C().double(runId);
    if (r?.ok) { api.sfx('win'); toast(`📺 +${num(r.got)} 🪙 — спасибо!`); btn.remove(); }
    else { toast('Не получилось — попробуй ещё раз'); btn.disabled = false; }
  }
  async function share(btn){
    const text = `Я продержался ${mmss(G?.t || 0)} в «Орде» и победил ${num(G?.kills || 0)} монстров! Побьёшь?`, url = location.origin + '/games/horde';
    if (navigator.share) { navigator.share({ title: 'Орда', text, url }).catch(() => {}); return; }
    try { await navigator.clipboard.writeText(text + ' ' + url); btn.textContent = '✅ Скопировано'; } catch (e) { prompt('Скопируй и отправь другу:', text + ' ' + url); }
  }
  async function daily(btn){
    btn.disabled = true;
    const r = await C().daily();
    if (r?.ok) { api.sfx('win'); toast(`🎁 Бонус дня: +${r.got} 🪙`); }
    menu();
  }

  function onOv(e){
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled || Date.now() < ovLock) return;
    const a = btn.dataset.act;
    if (a === 'play') play({});
    else if (a === 'duel') location.hash = '#/games/horde/' + GameRoom.newCode();
    else if (a === 'duel-go') play({ seed: duelSeed, duel: true });
    else if (a === 'shop') shop();
    else if (a === 'menu') menu();
    else if (a === 'daily') daily(btn);
    else if (a.startsWith('hero:')) { const id = a.slice(5); if (heroOwned(id)) { saveHero(id); menu(); } else heroInfo(id); }
    else if (a.startsWith('buy:')) buyItem(a.slice(4), btn);
    else if (a.startsWith('pick:')) pick(+a.slice(5));
    else if (a === 'resume') resume();
    else if (a === 'quit') { G.players[G.me].dead = true; finish(); }
    else if (a === 'revive-ad') revive('ad');
    else if (a === 'revive-coins') revive('coins');
    else if (a === 'end') finish();
    else if (a === 'again') again(btn);
    else if (a === 'share') share(btn);
    else if (a === 'x2') doubleCoins(btn);
  }

  function on(t, ev, fn, o){ t.addEventListener(ev, fn, o); listeners.push([t, ev, fn, o]); }
  function stopRun(){ cancelAnimationFrame(raf); raf = 0; G = null; mode = 'menu'; }

  window.GAME_IMPL.horde = {
    mount(el, gameApi){
      root = el; api = gameApi;
      on(window, 'keydown', onKey); on(window, 'keyup', onKey); on(window, 'resize', resize);
      on(document, 'visibilitychange', onVis); on(window, 'pointermove', onMove); on(window, 'pointerup', onUp); on(window, 'pointercancel', onUp);
      on(document, 'fullscreenchange', onFs);
      const tick = setInterval(trailTick, 30);
      listeners.push([{ removeEventListener: () => clearInterval(tick) }, '', null]);
      if (GameRoom.validCode(gameApi.param)) {
        stopDuel = Versus.start(root, api, 'horde', gameApi.param, {
          run(stage, rand, h){
            stopRun(); hooks = h;
            build(stage);
            duelSeed = Math.floor(rand() * 2 ** 31);
            const hero = HEROES.find(x => x.id === selHero());
            showOv(`<div class="hd-title">⚔️ Соревнование</div>
              <div class="hd-sub">У обоих одинаковая орда. Улучшения из магазина и возрождение не действуют — кто наберёт больше очков, тот и победил.</div>
              <div class="hd-sub">Твой герой: <b>${hero.e} ${hero.name}</b> (сменить — в меню игры)</div>
              <button type="button" class="ct-start" data-act="duel-go">▶ Старт</button>`);
            hooks = h;
          },
          stop(){ stopRun(); },
        });
      } else {
        build(root);
        menu();
      }
      C().sync().then(() => { if (mode === 'menu' && !hooks && ov && !ov.hidden && ov.querySelector('.hd-heroes')) menu(); });
    },
    unmount(){
      stopRun();
      if (full) { full = false; document.documentElement.classList.remove('hd-lock'); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
      for (const [t, ev, fn, o] of listeners.splice(0)) t.removeEventListener(ev, fn, o);
      stopDuel?.(); stopDuel = null; hooks = null;
      input.keys = {}; input.on = false;
      root = null; cv = null; ctx = null; ov = null; hud = null; wrap = null;
    },
    _test: { newGame, step, lvOptions, apply, optInfo, score, setView, xpNeed, WEAPONS, PASSIVES, HEROES, EN, WAVES, EVENTS },
  };
})();
