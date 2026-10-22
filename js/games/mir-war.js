// ═══════════════════════════════════════
//  «МИР ДЕНЧИКА»: БОЕВАЯ ЗОНА (12+) — как Military Tycoon, но мультяшно: участки военных баз игроков кольцом, нейтральный центр
//  с бункером и точками захвата, порт с кораблями, аэродром, лагерь у КПП (штаб, наёмники за 🪙, полигон с роботами)
// ═══════════════════════════════════════
// Владелец 15.10.2026: «как в милитори тайкон, чтобы были корабли, вертолёты, самолёты, бункер, база, наёмники и другое; в ту
// зону 12+ будет вход». Вход — только 12+ (MirZones: на границе и в телепортах, D37Age). Оружие — только внутри зоны: пенный
// бластер, пейнтбол, водяная бомба, поролоновый меч, щит-пузырь. «Выбит» вместо «убит», брызги краски и пена — без крови.
// Потом (владелец выбрал): зона — дом ВОЕННЫХ БАЗ. Кто хочет — основывает базу и становится главарём, участники — со званиями;
// ангары, гаражи, доки, вертолётные площадки, казарма, подвалы и бункеры, оборона, своё дерево технологий; набеги и оборона
// (как Clash of Clans) переезжают сюда из района участков. Систему баз делает агент набегов — здесь только разметка: PLOTS
// (12 участков 32 × 32 клетки с постоянными номерами, въездами, местами техники и подвалов) и нейтральные места между ними.
// Бой без сервера (хозяина в мире нет): попадание считает стрелок у себя, отправляет заявку; урон принимает ТОЛЬКО сам
// пострадавший — проверив оружие, урон, дальность от того места, где он видит стрелка, частоту выстрелов, команду, зону и
// защиту (claimOk). Выбит — сам говорит всем «меня выбил N» ('d'), счёт ведут все; раз в 2 с «судья» (тот, кто раньше всех
// в мире из находящихся в зоне) рассылает счёт, таймер раунда и точки захвата — новички и опоздавшие сверяются с ним.
// Сеть боя — свой канал Supabase `mirz-<сервер>` (только broadcast, без presence; подписан ключом мира): в нём только те, кто
// в зоне; выстрелы и заявки — пачкой не чаще 4 раз в секунду. Своё состояние (команда, жизни, оружие, наёмники, щит) — zx в 'st'.
// Награды — только через сервер с лимитами: game_result('mirwar', победа, выбитые) и D37Coins.run('mirwar', ≤ 20) за раунд,
// наёмник — D37Coins.revive('mirwar') (30 🪙, как «возродиться»). Ключ 'mirwar' — games-more.sql и coins.sql («запусти ещё раз»).
// Транспорт (лодки, вертолёты, самолёты, джипы) — js/engine/vehicle.js; места появления — VEH и у каждого участка (PLOTS).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const MZ = root.MirZones; if (!MZ) return;
  const PI = Math.PI, esc = MZ.esc;
  const WZ = MZ.ZONES.war, SEA = MZ.SEA, BK = MZ.BUNKER;

  // ═══ Оружие (мультяшное) ═══
  const WEAPONS = {
    foam: { icon: '🔫', name: 'Пенный бластер', dmg: 10, cd: .3, range: 45, speed: 70, grav: 0, size: .13, color: '#38bdf8', fx: 'sparkles' },
    paint: { icon: '🎯', name: 'Пейнтбол', dmg: 18, cd: .7, range: 40, speed: 55, grav: 4, size: .17, color: '#f472b6', fx: 'confetti' },
    water: { icon: '💧', name: 'Водяная бомба', dmg: 34, cd: 2.6, range: 26, speed: 19, grav: 17, size: .32, color: '#60a5fa', splash: 3.6, fx: 'bubbles' },
    sword: { icon: '🗡️', name: 'Поролоновый меч', dmg: 24, cd: .55, range: 3.6, melee: true },
    shield: { icon: '🫧', name: 'Щит-пузырь', cd: 14, dur: 3, dmg: 0 },
    merc: { icon: '🪖', dmg: 6, cd: 1.1, range: 32, speed: 50, grav: 0, size: .11, color: '#a3e635', fx: 'sparkles' },
    robot: { icon: '🤖', dmg: 4, cd: 2.2, range: 24, speed: 22, grav: 0, size: .15, color: '#fbbf24', fx: 'sparkles' },
  };
  const SLOTS = ['foam', 'paint', 'water', 'sword', 'shield'];
  const HP = 100, RESPAWN = 5, PROTECT = 3, ROUND = 300, CAP_R = 6.5, CAP_T = 6, CAP_WIN = 300;
  const MERC = { price: 30, max: 2, hp: 60 };
  const MODES = { ffa: ['⚔️', 'Каждый сам за себя'], team: ['🟥🟦', 'Команды'], cap: ['🚩', 'Захват точек'] };

  // ═══ Участки военных баз: 12 штук по 32 × 32 клетки (клетка 1,6 → 51,2 м) кольцом 4 × 4 вокруг нейтрального центра ═══
  // Столбцы 0…3 — с запада (берег) на восток (лагерь), ряды 0…3 — с севера на юг; между участками — дороги по 10 м.
  // Номер участка wb01…wb12 — НАВСЕГДА (на него сошлётся база в базе данных). У каждого: въезд (к дороге в сторону центра),
  // место игрока, гаража, вертолётной площадки, ангара, доков (у 4 береговых — свой берег, у остальных — причал в порту),
  // стоянка самолётов на перроне аэродрома (полоса — общая), подвал под участком (under: там пусто — место для js/engine/interior.js).
  const CELL = 1.6, CELLS = 32, PS = CELL * CELLS, GAP = 10;
  const RING_X1 = -130, RING_Z0 = 112;   // восточный и северный края кольца
  const r2 = v => Math.round(v * 100) / 100;
  const colX = c => r2(RING_X1 - (4 - c) * PS - (3 - c) * GAP);   // западный край столбца c
  const rowZ = r => r2(RING_Z0 + r * (PS + GAP));                // северный край ряда r
  const gapX = c => r2(colX(c) + PS + GAP / 2), gapZ = r => r2(rowZ(r) + PS + GAP / 2);   // середины дорог между участками
  const SOUTH_Z = r2(rowZ(3) + PS + GAP);   // за южной дорогой — порт и аэродром
  // нейтральные места
  const CENTER = { x0: colX(1), x1: r2(colX(2) + PS), z0: rowZ(1), z1: r2(rowZ(2) + PS) };   // центр кольца: бункер, точки A и B
  const CAMP = { x0: RING_X1, x1: WZ.x1, z0: WZ.z0, z1: WZ.z1 };                              // лагерь у КПП: штаб, наёмники, полигон
  const PORT = { x0: SEA.x1, x1: r2(colX(1) - 2.4), z0: r2(SOUTH_Z + 1.2), z1: SEA.z1 };      // порт (берег — запад)
  const AIR = { runway: { x0: -296, x1: -136, z0: 424, z1: 440 }, apron: { x0: -296, x1: -136, z0: r2(SOUTH_Z + 3.2), z1: 424 }, slots: [] };
  for (let i = 0; i < 12; i++) AIR.slots.push({ x: r2(-289 + i * 13.2), z: 408, yaw: 0 });   // стоянка каждой базы (нос — к полосе)
  const PIERS = [384, 428];   // причалы порта (z), от берега в море на 30 м
  const BERTHS = [];          // места у причалов для баз без своего берега
  for (const pz of PIERS) for (const s of [-1, 1]) for (const bx of [-374, -388]) BERTHS.push({ x: bx, z: r2(pz + s * 6.2), yaw: PI / 2 });
  const RING = [[3, 0], [2, 0], [1, 0], [0, 0], [0, 1], [0, 2], [0, 3], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1]];   // №1 — у КПП, дальше по кругу
  let berthN = 0;
  const PLOTS = RING.map(([c, r], i) => {
    const n = i + 1, id = 'wb' + String(n).padStart(2, '0');
    const x0 = colX(c), z0 = rowZ(r), x1 = r2(x0 + PS), z1 = r2(z0 + PS), cx = r2((x0 + x1) / 2), cz = r2((z0 + z1) / 2);
    const side = r === 0 ? 's' : r === 3 ? 'n' : c === 0 ? 'e' : 'w';   // въезд — к дороге в сторону центра
    const [ix, iz] = { s: [0, -1], n: [0, 1], e: [-1, 0], w: [1, 0] }[side], lx = -iz, lz = ix;   // внутрь и «вправо, если смотреть внутрь»
    const gx = side === 'e' ? x1 : side === 'w' ? x0 : cx, gz = side === 's' ? z1 : side === 'n' ? z0 : cz;
    const gyaw = r2(Math.atan2(-ix, -iz)), inYaw = r2(Math.atan2(ix, iz));   // лицом наружу / внутрь
    const at = (f, l) => ({ x: r2(gx + ix * f + lx * l), z: r2(gz + iz * f + lz * l) });
    const coast = c === 0;
    return {
      id, n, name: `База ${n}`, code: 'ABCD'[c] + (r + 1), col: c, row: r, x0, z0, x1, z1, cx, cz, cell: CELL, cells: CELLS, coast,
      gate: { x: gx, z: gz, yaw: gyaw, w: 10, side },
      cp: { ...at(5.5, -12), w: iz ? 5 : 6, d: iz ? 6 : 5, door: lx > 0 ? 'e' : lx < 0 ? 'w' : lz > 0 ? 's' : 'n', win: side },   // командный пункт у въезда
      spawn: { ...at(6, 0), yaw: inYaw },     // где появляется игрок базы
      garage: { ...at(14, 14), yaw: inYaw },  // наземная техника
      heli: { ...at(38, -14), yaw: inYaw },   // вертолётная площадка
      hangar: { ...at(38, 14), yaw: inYaw },  // ангар (вертолёты, дроны; самолёты — на свою стоянку аэродрома)
      dock: coast ? { x: r2(x0 - 14), z: cz, yaw: -PI / 2, own: true } : { ...BERTHS[berthN++], own: false },
      airSlot: AIR.slots[i],
      under: { x0: r2(x0 + 6), x1: r2(x1 - 6), z0: r2(z0 + 6), z1: r2(z1 - 6), top: -.4, floor: -7.2 },   // место под подвалы
      cellar: { x0: r2(cx - 7), x1: r2(cx + 7), z0: r2(cz - 7), z1: r2(cz + 7), top: -.3, floor: -6 },     // штабной зал под базой (люк — постройка «Бункер»)
    };
  });
  // подвалы — в рельеф зоны (пол ниже земли — когда над ними лежит плита: MZ.CELLAR.on ставит постройка участков)
  if (MZ.CELLAR) { MZ.CELLAR.list.length = 0; for (const P of PLOTS) MZ.CELLAR.list.push(P.cellar); }
  const inPlot = (x, z, m = 0) => PLOTS.some(P => x >= P.x0 - m && x <= P.x1 + m && z >= P.z0 - m && z <= P.z1 + m);

  const ROBOT = { hp: 40, max: 3, area: { x0: -118, x1: -88, z0: 236, z1: 280 } };
  // места: появления, точки захвата, транспорт — только на нейтральной земле (участки баз — их хозяевам)
  const SPAWNS = {
    ffa: [[-90, 134], [-247, 196], [-282, 236], [-214, 266], [-200, 372], [-330, 372], [-100, 228]],
    red: [[-84, 128], [-96, 138], [-84, 140]],
    blue: [[-240, 368], [-270, 368], [-210, 368]],
  };
  const POINTS = [{ id: 'A', x: -213, z: 196, name: 'Холм' }, { id: 'B', x: -282, z: 263, name: 'Руины' }, { id: 'C', x: -335, z: 440, name: 'Причал' }];
  const VEH = { boat: [[-392, 400, -PI / 2], [-392, 412, -PI / 2], [-412, 446, PI]], heli: [[-100, 304, 0], [-100, 330, 0]], plane: [[-148, 432, -PI / 2]], jeep: [[-80, 300, PI], [-80, 314, PI]], tank: [[-80, 330, PI]] };   // лодки — носом в море (не в набережную)
  const CC = { x: (CENTER.x0 + CENTER.x1) / 2, z: (CENTER.z0 + CENTER.z1) / 2 };   // центр боя (после появления смотришь туда)

  // ═══ Правила (без браузера — проверяются в node) ═══
  // Заявка на попадание глазами пострадавшего: null — принять, иначе — почему нет
  // c: { w, dmg, ax, az }, me: { x, z, zone, team, prot, shield, now }, att: { x, z, zone, team, merc }, hist: [время заявок этого стрелка этим оружием]
  function claimOk(c, me, att, hist = []){
    const W = WEAPONS[c?.w];
    if (!W || !(W.dmg > 0)) return 'weapon';
    if (!me.zone || !att.zone) return 'zone';
    if (me.now < (me.prot || 0) || me.now < (me.shield || 0)) return 'protected';
    if (me.team && att.team && me.team === att.team) return 'team';
    if (!(c.dmg > 0) || c.dmg > W.dmg + 1e-6) return 'dmg';
    if (!Number.isFinite(c.ax) || !Number.isFinite(c.az) || Math.hypot(c.ax - att.x, c.az - att.z) > 9) return 'origin';
    if (Math.hypot(c.ax - me.x, c.az - me.z) > W.range + 5) return 'range';
    if (c.w === 'merc' && !(att.merc > 0)) return 'merc';
    const n = hist.filter(t => me.now - t < 1000).length, lim = Math.ceil(1 / W.cd) + 1 + (c.w === 'merc' ? att.merc : 0);
    if (n >= lim) return 'rate';
    return null;
  }
  // Урон водяной бомбы по расстоянию до центра
  const splashDmg = (W, d) => (d >= W.splash ? 0 : Math.round(W.dmg * (1 - .6 * d / W.splash)));
  // Захват точек: ps — [{ id, own (0/1/2), prog (−1…1: к красным −, к синим +) }], near — { id: [красных, синих] }
  function capStep(ps, near, dt){
    for (const p of ps) {
      const [r, b] = near[p.id] || [0, 0];
      if (r && b) continue;   // спорят — стоит
      const dir = r ? -1 : b ? 1 : 0;
      if (!dir) continue;
      p.prog = Math.max(-1, Math.min(1, p.prog + dir * dt * Math.min(3, r + b) / CAP_T));
      if (p.prog <= -1) p.own = 1; else if (p.prog >= 1) p.own = 2;
    }
    return ps;
  }
  // Награда за раунд (сервер всё равно режет: coin_run_cap('mirwar') = 20, 600 в день; XP — game_win_xp('mirwar'), 3 победы в день)
  function reward(mode, kills, win){ return { coins: Math.min(20, Math.max(0, kills) * 2 + (win ? 6 : 0)), win: !!win, score: Math.max(0, Math.min(200, kills | 0)) }; }
  // Команда для новичка: где меньше
  const teamFor = counts => (counts[1] <= counts[2] ? 1 : 2);

  // ═══ Роли (форма у всех — zx.r): боец, красные, синие ═══
  const ROLES_W = {
    ffa: { icon: '🪖', name: 'Боец', hat: 'army', vest: '#4d7c0f' },
    red: { icon: '🟥', name: 'Красные', hat: 'army', vest: '#dc2626', stripe: 1 },
    blue: { icon: '🟦', name: 'Синие', hat: 'army', vest: '#2563eb', stripe: 1 },
  };
  // Таблица зданий (MirZones: стабильные id, тип 'military'; помещений нет). Всё наземное здесь — из деталей с номерами (K.mbuilding,
  // K.piece): стены кусками, плиты, окна, колонны, крыши, укрытия — для будущих разрушений («как в Майне, или на куски»).
  // destructible: true — можно ломать (боевая зона); бункер — неразрушаемый (destructible: false), город и детский городок — без деталей.
  const W_BLD = [
    { id: 'w_hq', type: 'military', sub: 'hq', name: 'Штаб лагеря', x: -100, z: 152, w: 22, d: 16, h: 5, wall: '#a8a29e' },
    { id: 'w_barracks', type: 'military', sub: 'barracks', name: 'Казарма', x: -100, z: 176, w: 16, d: 10, h: 3.6, wall: '#4d7c0f' },
    { id: 'w_armory', type: 'military', sub: 'armory', name: 'Оружейная', x: -100, z: 196, w: 12, d: 10, h: 3.6, wall: '#57534e' },
    { id: 'w_hangar1', type: 'military', sub: 'hangar', name: 'Ангар 1', x: -262, z: 380, w: 20, d: 16, h: 7, wall: '#9ca3af' },
    { id: 'w_hangar2', type: 'military', sub: 'hangar', name: 'Ангар 2', x: -226, z: 380, w: 20, d: 16, h: 7, wall: '#9ca3af' },
    { id: 'w_control', type: 'military', sub: 'control', name: 'Диспетчерская вышка', x: -150, z: 376, w: 8, d: 8, h: 13.4, wall: '#e5e7eb' },
    { id: 'w_point_a', type: 'military', sub: 'point', name: 'Точка A · Холм', x: -213, z: 196, w: 14, d: 14, h: 2, wall: '#a8a29e' },
    { id: 'w_point_b', type: 'military', sub: 'point', name: 'Точка B · Руины', x: -282, z: 263, w: 20, d: 18, h: 3, wall: '#78716c' },
    { id: 'w_point_c', type: 'military', sub: 'point', name: 'Точка C · Причал', x: -335, z: 440, w: 14, d: 14, h: 1.5, wall: '#a8a29e' },
    // командный пункт каждого участка (пока единственная постройка на участке)
    ...PLOTS.map(P => ({ id: P.id + '_cp', type: 'military', sub: 'cp', name: `КП · ${P.name}`, x: P.cp.x, z: P.cp.z, w: P.cp.w, d: P.cp.d, h: 3.2, wall: '#a8a29e', plot: P.id })),
  ];
  // земля без зданий: бункер (под землёй), перрон и полоса, порт, причалы
  const W_GROUND = [
    [r2((BK.x0 + BK.x1) / 2), r2((BK.z0 + BK.z1) / 2), r2(BK.x1 - BK.x0), r2(BK.z1 - BK.z0), '#78716c', 0],
    [-216, 392, 160, 64, '#9ca3af', 0], [-216, 432, 160, 16, '#4b5563', 0],
    [r2((PORT.x0 + PORT.x1) / 2), r2((PORT.z0 + PORT.z1) / 2), r2(PORT.x1 - PORT.x0), r2(PORT.z1 - PORT.z0), '#a8a29e', 0],
    ...PIERS.map(pz => [r2(SEA.x1 - 15), pz, 30, 6, '#78350f', 0]),
  ];
  const W_PLACES = [
    { id: 'w_base', icon: '🏯', name: 'Лагерь у КПП: штаб и наёмники', x: -92, z: 134, lx: -100, lz: 152, sub: 1 },
    { id: 'w_plots', icon: '🏰', name: 'Участки военных баз', x: gapX(1), z: gapZ(0), lx: gapX(1), lz: rowZ(0) + 20, sub: 1 },
    { id: 'w_bunker', icon: '🕳️', name: 'Бункер', x: r2(BK.x1 + 8), z: r2((BK.z0 + BK.z1) / 2), lx: r2((BK.x0 + BK.x1) / 2), lz: r2((BK.z0 + BK.z1) / 2), sub: 1 },
    { id: 'w_port', icon: '⚓', name: 'Порт и корабли', x: -326, z: 372, lx: -364, lz: 406, sub: 1 },
    { id: 'w_air', icon: '✈️', name: 'Аэродром', x: -200, z: 366, lx: -216, lz: 432, sub: 1 },
    { id: 'w_heli', icon: '🚁', name: 'Вертолётные площадки', x: -88, z: 318, lx: -100, lz: 318, sub: 1 },
    { id: 'w_range', icon: '🤖', name: 'Полигон с роботами', x: -103, z: 230, lx: -103, lz: 258, sub: 1 },
  ];
  // дороги зоны: въезд, лагерь, сетка между участками (через нейтральный центр не идёт), к порту и аэродрому
  const SZ = r2(SOUTH_Z - GAP / 2), NZ = 106, EX = -124;
  const W_ROADS = [
    { w: 7, pts: [[WZ.x1, 130], [EX, 130]] }, { w: 7, pts: [[EX, NZ], [EX, 452]] },
    { w: 7, pts: [[SEA.x1, NZ], [EX, NZ]] }, { w: 7, pts: [[SEA.x1, gapZ(0)], [EX, gapZ(0)]] }, { w: 7, pts: [[SEA.x1, gapZ(2)], [EX, gapZ(2)]] }, { w: 7, pts: [[SEA.x1, SZ], [EX, SZ]] },
    { w: 7, pts: [[SEA.x1, gapZ(1)], [gapX(0), gapZ(1)]] }, { w: 7, pts: [[gapX(2), gapZ(1)], [EX, gapZ(1)]] },
    { w: 7, pts: [[gapX(0), NZ], [gapX(0), SZ]] }, { w: 7, pts: [[gapX(2), NZ], [gapX(2), SZ]] },
    { w: 7, pts: [[gapX(1), NZ], [gapX(1), gapZ(0)]] }, { w: 7, pts: [[gapX(1), gapZ(2)], [gapX(1), SZ]] },
  ];
  MZ.def('war', {
    roles: ROLES_W, buildings: W_BLD, extraFoot: W_GROUND, places: W_PLACES, plots: PLOTS,
    // техника зоны (js/engine/vehicle.js): ездит, плавает и летает; только внутри боевой зоны (area)
    vehicles: [
      { id: 'w_jeep1', def: 'jeep', x: VEH.jeep[0][0], z: VEH.jeep[0][1], yaw: VEH.jeep[0][2], area: 'war' }, { id: 'w_jeep2', def: 'jeep', x: VEH.jeep[1][0], z: VEH.jeep[1][1], yaw: VEH.jeep[1][2], area: 'war' },
      { id: 'w_heli1', def: 'heli', x: VEH.heli[0][0], z: VEH.heli[0][1], yaw: VEH.heli[0][2], area: 'war' }, { id: 'w_heli2', def: 'heli', x: VEH.heli[1][0], z: VEH.heli[1][1], yaw: VEH.heli[1][2], area: 'war' },
      { id: 'w_plane1', def: 'plane', x: VEH.plane[0][0], z: VEH.plane[0][1], yaw: VEH.plane[0][2], area: 'war' },
      { id: 'w_boat1', def: 'motorboat', x: VEH.boat[0][0], z: VEH.boat[0][1], yaw: VEH.boat[0][2], area: 'war' }, { id: 'w_boat2', def: 'motorboat', x: VEH.boat[1][0], z: VEH.boat[1][1], yaw: VEH.boat[1][2], area: 'war' },
      { id: 'w_patrol1', def: 'patrol', x: VEH.boat[2][0], z: VEH.boat[2][1], yaw: VEH.boat[2][2], area: 'war' },
      { id: 'w_tank1', def: 'tank', x: VEH.tank[0][0], z: VEH.tank[0][1], yaw: VEH.tank[0][2], area: 'war' },
    ],
    streets: W_ROADS,
    ground: [[r2((SEA.x1 + WZ.x1) / 2), (WZ.z0 + WZ.z1) / 2, r2(WZ.x1 - SEA.x1), WZ.z1 - WZ.z0, '#a89a72'], [-216, 392, 160, 64, '#9ca3af', .02], [-216, 432, 160, 16, '#4b5563', .025],
      ...W_ROADS.map(({ w, pts: [[ax, az], [bx, bz]] }) => [r2((ax + bx) / 2), r2((az + bz) / 2), ax === bx ? w : r2(Math.abs(bx - ax)), az === bz ? w : r2(Math.abs(bz - az)), '#5b6270', .03])],
    *build(K){ yield* buildWar(K); },
    start: (rt, K) => warMod(rt, K),
  });

  // ═══ ПОСТРОЙКА ═══
  const WB = id => W_BLD.find(b => b.id === id);
  function* buildWar(K){
    // постройка — кусочками: после каждого оператора — yield (бюджет кадра считает stepBuild в mir-zones.js; одна зона за раз)
    const { R } = K, M = K.M, rnd = (K.E.rng || (s => Math.random))(4242); yield;
    K.nBags = 0; yield; K.nCrate = 0; yield; K.nBlock = 0; yield;   // номера укрытий — по порядку постройки (одинаковые у всех)
    K.spots = {}; yield;
    const spot = (id, x, y, z) => (K.spots[id] = { x, y, z }); yield;
    K.M.mil = R.tex('sidewalk', { tint: '#c7c1a8', tile: 3, flatColor: '#a8a07c' }); yield;
    // ограда: столбики через 4 м, три жерди, тело (камеру не держит)
    const fence = (x1, z1, x2, z2, c = '#57534e') => { const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz), n = Math.ceil(L / 4);
      if (L < .3) return;
      for (let i = 0; i <= n; i++) K.part({ s: 'box', x: x1 + dx * i / n, y: 1.1, z: z1 + dz * i / n, w: .18, h: 2.2, d: .18, c });
      for (const y of [.7, 1.5, 2.1]) K.part({ s: 'box', x: (x1 + x2) / 2, y, z: (z1 + z2) / 2, w: .06, h: .06, d: L, yaw, c: '#a8a29e' });
      K.body({ x: (x1 + x2) / 2, z: (z1 + z2) / 2, y: 1.2, hx: .1, hy: 1.2, hz: L / 2, yaw, tag: 'fence', data: { cam: false } }); }; yield;
    // ── земля зоны (песок вокруг дыры бункера), дороги, ограда с воротами ──
    K.chunk('ground'); yield;
    const sand = (x0, x1, z0, z1) => K.part({ s: 'box', x: (x0 + x1) / 2, y: .012, z: (z0 + z1) / 2, w: x1 - x0, h: .02, d: z1 - z0, m: M.sand }); yield;
    sand(SEA.x1, WZ.x1, WZ.z0, BK.z0); yield; sand(SEA.x1, WZ.x1, BK.z1, WZ.z1); yield; sand(SEA.x1, BK.x0, BK.z0, BK.z1); yield; sand(BK.x1, WZ.x1, BK.z0, BK.z1); yield;
    // дороги: с севера на юг — чуть ниже, с запада на восток — чуть выше (перекрёстки не мерцают)
    for (const r of W_ROADS) { const [[ax, az], [bx, bz]] = r.pts, ns = ax === bx; yield; K.road(ax, az, bx, bz, r.w, { walk: false, y: ns ? .03 : .045 }); yield; }
    for (let z = 115; z < 450; z += 30) K.lamp(EX - 4.6, z); yield;
    // ограда всей зоны: север, юг, запад (за морем) и восток с проёмом ворот
    fence(WZ.x0 + .5, WZ.z0 + .5, WZ.x1 - .5, WZ.z0 + .5); yield; fence(WZ.x0 + .5, WZ.z1 - .5, WZ.x1 - .5, WZ.z1 - .5); yield;
    fence(WZ.x0 + .5, WZ.z0 + .5, WZ.x0 + .5, WZ.z1 - .5); yield;
    fence(WZ.x1 - .5, WZ.z0 + .5, WZ.x1 - .5, 125); yield; fence(WZ.x1 - .5, 135, WZ.x1 - .5, WZ.z1 - .5); yield;
    yield;
    // ── КПП: будка, шлагбаум, предупреждение, щит режима, телепорт в лобби ──
    K.chunk('gate'); yield;
    K.mbuilding({ id: 'w_gate', x: -78, z: 122, w: 3, d: 3, h: 3, wall: '#e7e5e4', trim: '#b91c1c', roofC: '#b91c1c', floorC: '#a8a29e', windows: [{ side: 's', at: 0, w: 2, h: .9 }], interior: false }); yield;
    for (let i = 0; i < 6; i++) K.part({ s: 'box', x: -76, y: 1.1, z: 125.4 + i * .8, w: .12, h: .16, d: .8, c: i % 2 ? '#f8fafc' : '#dc2626' }); yield;
    K.board(-86, 2.4, 124.2, 5, 2.2, 0, '⚠️ Боевая зона 12+: здесь можно сражаться', { bg: '#7f1d1d' }); yield;
    K.box(-86, 0, 124, .2, 1.3, .2, '#57534e', { solid: true }); yield;
    K.board(-94, 2.2, 124.2, 3.4, 1.6, 0, '⚔️ Режим боя', { bg: '#1e3a8a' }); yield;
    K.box(-94, 0, 124, .16, 1.4, .16, '#57534e', { solid: true }); yield;
    K.item({ x: -94, y: 1.6, z: 125.2, r: 1.2, prompt: () => '⚔️ Режим боя, команды и счёт', act: () => K.rt.war?.board() }); yield;
    K.item({ x: -86, y: 1.6, z: 125.2, r: 1.2, prompt: () => '⚠️ Правила боевой зоны', act: () => K.rt.war?.rules() }); yield;
    yield;
    // ── Лагерь у КПП (нейтральный): штаб, казарма, оружейная, вышки, флаг, палатка наёмников ──
    K.chunk('base'); yield;
    const hq = WB('w_hq'), ba = WB('w_barracks'), ar = WB('w_armory'); yield;
    K.part({ s: 'box', x: -100, y: .02, z: 174, w: 40, h: .02, d: 70, m: K.M.mil }); yield;   // плац
    K.mbuilding({ id: 'w_hq', x: hq.x, z: hq.z, w: hq.w, d: hq.d, h: hq.h, wall: hq.wall, trim: '#3f6212', roofC: hq.roof, floorC: '#a8a29e', floorType: 'concrete',
      doors: [{ side: 'n', at: 0, w: 3 }], windows: [{ side: 'n', at: -7, w: 2.4 }, { side: 'n', at: 7, w: 2.4 }, { side: 'w', at: 0, w: 2.4 }], sign: '🪖 Штаб', signBg: '#3f6212' }); yield;
    K.table(hq.x, hq.z + 2, 5, 3, '#365314', .9); yield; K.part({ s: 'box', x: hq.x, y: .92, z: hq.z + 2, w: 4.6, h: .02, d: 2.6, c: '#84cc16' }); yield;
    for (const [i, [dx, dz]] of [[2, 1.4], [-2, 2.6], [.6, 3]].entries()) K.part({ s: 'cone', x: hq.x + dx, y: 1.05, z: hq.z + dz, r: .12, h: .25, c: ['#dc2626', '#2563eb', '#facc15'][i] }); yield;
    for (let i = 0; i < 3; i++) { K.box(hq.x + 10.4, .12, hq.z - 3 + i * 3, .4, 2.2, 2.4, '#1f2937', { solid: true }); yield; K.part({ s: 'box', x: hq.x + 10.18, y: 1.5, z: hq.z - 3 + i * 3, w: .02, h: 1.4, d: 2.1, c: '#22c55e', m: 'glow' }); yield; }
    K.npc({ id: 'w_general', name: '🎖️ Генерал', x: hq.x, z: hq.z + 5.5, yaw: 180, seed: 'general', say: ['Боец! Захвати точки A, B и C 🚩', 'Вокруг — участки военных баз: скоро сможешь основать свою!', 'Наёмники — в палатке у КПП, 30 🪙'] }); yield;
    spot('w_map', hq.x, 1.2, hq.z - .4); yield;
    // казарма
    K.mbuilding({ id: 'w_barracks', x: ba.x, z: ba.z, w: ba.w, d: ba.d, h: ba.h, wall: ba.wall, trim: '#365314', roofC: ba.roof, floorC: '#78716c', floorType: 'concrete',
      doors: [{ side: 'w', at: 0, w: 2.4 }], windows: [{ side: 'n', at: -4, w: 2 }, { side: 'n', at: 4, w: 2 }] }); yield;
    for (let i = 0; i < 4; i++) K.bed(ba.x - 5 + i * 3.4, ba.z + 3, PI, '#4d7c0f'); yield;
    // оружейная
    K.mbuilding({ id: 'w_armory', x: ar.x, z: ar.z, w: ar.w, d: ar.d, h: ar.h, wall: ar.wall, trim: '#292524', roofC: ar.roof, floorC: '#78716c', floorType: 'concrete',
      doors: [{ side: 'w', at: 0, w: 2.4 }], sign: '🔫 Оружейная', signBg: '#292524' }); yield;
    for (let i = 0; i < 4; i++) { K.box(ar.x + 5.4, .12, ar.z - 3.5 + i * 2.3, .5, 2, 1.8, '#44403c', { solid: true }); yield; for (let k = 0; k < 3; k++) K.part({ s: 'box', x: ar.x + 5.1, y: .9 + k * .5, z: ar.z - 3.5 + i * 2.3, w: .1, h: .14, d: 1.4, c: ['#38bdf8', '#f472b6', '#60a5fa'][k] }); yield; }
    K.item({ x: ar.x + 2.5, y: 1.2, z: ar.z, r: 1.6, prompt: () => '🔫 Оружейная: аптечка и полный заряд', act: () => K.rt.war?.armory() }); yield;
    K.npc({ id: 'w_armorer', name: '🔧 Оружейник', x: ar.x + 2, z: ar.z + 3, yaw: 270, seed: 'oruzh1', say: ['Пена, краска, вода — выбирай! 🔫', 'Клавиши 1–5 — оружие, F — стрелять'] }); yield;
    // вышки (с лестницей наверх)
    for (const [i, [x, z]] of [[-80, 146], [-80, 222], [-117, 222]].entries()) {
      const id = 'w_watch' + (i + 1), pc = (kind, n, o) => K.piece({ id: `${id}:${kind}:${n}`, kind, b: id, ...o }); yield;
      [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]].forEach(([sx, sz], k) => pc('pillar', k + 1, { x: x + sx, y: 3, z: z + sz, w: .25, h: 6, d: .25, c: '#78350f', solid: false })); yield;
      pc('floor', 1, { x, y: 6.125, z, w: 3.2, h: .25, d: 3.2, c: '#92400e', floor: 'wood' }); yield;
      [[3.2, .12, 0, -1.6], [3.2, .12, 0, 1.6], [.12, 3.2, -1.6, 0]].forEach(([w, d, ox, oz], k) => pc('wall', k + 1, { x: x + ox, y: 6.7, z: z + oz, w, h: .9, d, c: '#78350f' })); yield;
      pc('roof', 1, { x, y: 7.7, z, w: 3.6, h: .2, d: 3.6, c: '#365314', solid: false }); yield;
      if (K.E.ladder) { K.part({ s: 'box', x: x + 1.75, y: 3.1, z, w: .08, h: 6.2, d: .7, c: '#a16207' }); yield; K.E.ladder(K.ph, { x: x + 2, z, yaw: -PI / 2, top: 6.25, w: .8 }); yield; }
    }
    // флаг
    K.cyl(-116, 0, 140, .1, 9, '#d6d3d1', { solid: true }); yield; K.part({ s: 'box', x: -117.4, y: 8.2, z: 140, w: 2.6, h: 1.5, d: .05, c: '#dc2626' }); yield;
    // палатка наёмников (к дороге въезда)
    K.part({ s: 'cone', x: -108, y: 1.6, z: 116, r: 3.4, h: 3.2, seg: 4, yaw: PI / 4, c: '#4d7c0f', flat: true }); yield;
    K.body({ x: -108, z: 116, y: 1, hx: 2.2, hy: 1, hz: 2.2, data: { cam: false } }); yield;
    K.label.sign('🪖 Наёмники', -108, 3.4, 118.6, 3.4, .55, 0, { bg: '#365314', w: 512, h: 84 }); yield;
    K.item({ x: -108, y: 1.4, z: 119.6, r: 1.6, prompt: () => `🪖 Нанять наёмника (${MERC.price} 🪙, до ${MERC.max})`, act: () => K.rt.war?.hire() }); yield;
    K.npc({ id: 'w_recruiter', name: '🪖 Вербовщик', x: -104.2, z: 120.2, yaw: 0, seed: 'verbov', say: [`Наёмник — ${MERC.price} 🪙. Пойдёт за тобой и прикроет!`, 'Наёмники служат, пока ты в боевой зоне'] }); yield;
    // мешки с песком у штаба
    for (const [x, z, yaw] of [[-86, 166, PI / 2], [-86, 188, PI / 2], [-114, 166, PI / 2], [-114, 206, 0], [-86, 206, 0]]) sandbags(K, x, z, yaw); yield;
    yield;
    // ── Бункер (под землёй, нейтральный центр): плита-крыша (прячется изнутри), стены, лестница вниз, комнаты, свет ──
    K.chunk('bunker'); yield;
    {
      const x0 = BK.x0, x1 = BK.x1, z0 = BK.z0, z1 = BK.z1, F = BK.floor, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, W = x1 - x0, D = z1 - z0; yield;
      const stair = { x0: x1 - 10, x1: x1, z0: cz - 2.2, z1: cz + 2.2 }; yield;   // лестница вдоль восточной стены, вниз — на запад
      K.part({ s: 'box', x: cx, y: F + .01, z: cz, w: W, h: .02, d: D, m: M.concrete }); yield;
      // стены по краю (от пола до земли)
      const bp = (kind, n, o) => K.piece({ id: `w_bunker:${kind}:${n}`, kind, b: 'w_bunker', destructible: false, ...o }); yield;
      [[cx, z0 + .2, W, .4], [cx, z1 - .2, W, .4], [x0 + .2, cz, .4, D], [x1 - .2, cz, .4, D]].forEach(([x, z, w, d], k) => bp('wall', k + 1, { x, y: F / 2, z, w, h: -F, d, c: '#78716c', cam: true })); yield;
      // плита-крыша: всё, кроме проёма над лестницей (детали; изнутри прячутся — группа деталей)
      const roofP = []; yield;
      const slab = (ax0, ax1, az0, az1) => { if (ax1 - ax0 < .05 || az1 - az0 < .05) return; roofP.push(bp('roof', roofP.length + 1, { x: (ax0 + ax1) / 2, y: BK.roof / 2, z: (az0 + az1) / 2, w: ax1 - ax0, h: -BK.roof, d: az1 - az0, c: '#b5ad8f' })); }; yield;
      slab(x0, stair.x0, z0, z1); yield; slab(stair.x0, x1, z0, stair.z0); yield; slab(stair.x0, x1, stair.z1, z1); yield;
      const roof = MZ.pieceGroup(roofP); yield;
      K.body({ x: cx, z: cz, y: F / 2, hx: W / 2 - .4, hy: -F / 2 + .2, hz: D / 2 - .4, trigger: true, tag: 'room', data: { room: 'w_bunker', roof } }); yield;
      // лестница: 12 ступеней от земли вниз на запад, по бокам — стенки
      const n = 12, step = -F / n, len = stair.x1 - stair.x0; yield;
      for (let i = 0; i < n; i++) { const h = (n - i) * step; yield; K.box(stair.x1 - (i + .5) * len / n, F, (stair.z0 + stair.z1) / 2, len / n + .02, h, stair.z1 - stair.z0, '#a8a29e', { solid: true, floor: 'concrete' }); yield; }
      for (const z of [stair.z0 - .15, stair.z1 + .15]) K.box((stair.x0 + stair.x1) / 2, F, z, len, -F, .3, '#78716c', { solid: true, cam: true }); yield;
      // входной домик над лестницей
      K.box(x1 + .9, 0, cz - 2.5, 2, 2.8, .3, '#57534e', { solid: true, cam: true }); yield; K.box(x1 + .9, 0, cz + 2.5, 2, 2.8, .3, '#57534e', { solid: true, cam: true }); yield;
      K.part({ s: 'box', x: x1 - 1, y: 2.95, z: cz, w: 4.2, h: .3, d: 5.4, c: '#3f6212' }); yield;
      K.label.sign('🕳️ Бункер', x1 + 1.95, 2.3, cz, 3, .6, PI / 2, { bg: '#292524', w: 512, h: 100 }); yield;
      // комнаты: командная (запад), оружейная (север), спальни (юг), лампы
      K.box(x0 + 7, F, cz, .3, 3.6, D - 6, '#a8a29e', { solid: true, cam: true }); yield;
      K.table(x0 + 3.5, cz, 3, 2, '#365314', .9); yield; K.part({ s: 'box', x: x0 + 3.5, y: F + .93, z: cz, w: 2.8, h: .02, d: 1.8, c: '#65a30d' }); yield;
      for (let i = 0; i < 3; i++) { K.box(x0 + .55, F, cz - 4 + i * 4, .3, 2, 2.4, '#111827', { solid: true }); yield; K.part({ s: 'box', x: x0 + .72, y: F + 1.3, z: cz - 4 + i * 4, w: .02, h: 1.2, d: 2, c: '#4ade80', m: 'glow' }); yield; }
      for (let i = 0; i < 4; i++) K.part({ s: 'ball', x: x0 + 4 + i * 6, y: -.8, z: cz, r: .22, c: '#fef9c3', m: 'glow', seg: 8 }); yield;
      for (let i = 0; i < 3; i++) { K.box(x0 + 11 + i * 3, F, z1 - 1.6, 1.4, 1, 2.4, '#78716c', { solid: true }); yield; K.part({ s: 'box', x: x0 + 11 + i * 3, y: F + 1.6, z: z1 - 1.6, w: 1.4, h: .1, d: 2.4, c: '#57534e' }); yield; K.seat(x0 + 11 + i * 3, F + 1.1, z1 - 1.6, PI, { bed: true }); yield; }
      for (let i = 0; i < 4; i++) K.box(x0 + 10 + i * 2.2, F, z0 + .9, 1.4, 1, 1.2, ['#3f6212', '#57534e', '#78350f', '#3f6212'][i], { solid: true }); yield;
      spot('w_bunker_med', x0 + 12, F + 1.2, z0 + 2.4); yield;
      K.item({ x: x0 + 12, y: F + 1.2, z: z0 + 2.4, r: 1.5, prompt: () => '🩹 Аптечки и заряд (бункер)', act: () => K.rt.war?.armory() }); yield;
      K.npc({ id: 'w_bunkerguard', name: '🎖️ Связист', x: x0 + 3.5, y: F, z: cz - 2.4, yaw: 0, seed: 'svyaz1', say: ['Бункер — самое безопасное место 🕳️', 'Связь со штабом есть!'] }); yield;
    }
    yield;
    // ── Порт (юго-запад, нейтральный): площадка, причалы, контейнеры, кран, корабли; места у причалов — для баз без берега ──
    K.chunk('port'); yield;
    {
      const PCX = (PORT.x0 + PORT.x1) / 2, PCZ = (PORT.z0 + PORT.z1) / 2; yield;
      K.part({ s: 'box', x: PCX, y: .03, z: PCZ, w: PORT.x1 - PORT.x0, h: .02, d: PORT.z1 - PORT.z0, m: M.concrete }); yield;
      for (const pz of PIERS) {
        K.box(SEA.x1 - 15, 0, pz, 30, .3, 6, '#78350f', { solid: true, floor: 'wood', m: M.planks }); yield;
        for (let i = 0; i < 6; i++) for (const s of [-1, 1]) K.cyl(SEA.x1 - 2 - i * 5, -7, pz + s * 2.6, .25, 7.2, '#57534e', { solid: true }); yield;
      }
      for (let i = 0; i < 10; i++) { const c = ['#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed'][i % 5]; yield; K.piece({ id: `w_port:container:${i + 1}`, kind: 'container', b: 'w_port', x: PORT.x1 - 14 - (i % 2) * 3, y: (i > 5 ? 2.6 : 0) + 1.3, z: PORT.z0 + 8 + (i % 6) * 7, w: 2.6, h: 2.6, d: 6, c, hp: 200, cam: true }); yield; }
      K.cyl(-346, 0, 410, .5, 16, '#facc15', { solid: true }); yield; K.part({ s: 'box', x: -356, y: 16, z: 410, w: 22, h: .6, d: .6, c: '#facc15' }); yield; K.part({ s: 'cyl', x: -364, y: 13, z: 410, r: .03, h: 6, c: '#374151' }); yield;
      warship(K, -440, 406, 0); yield;
      K.npc({ id: 'w_harbor', name: '⚓ Капитан порта', x: -350, z: 372, yaw: 270, seed: 'kapitan', say: ['Корабли и катера — у причалов ⚓', 'У баз без своего берега — места у этих причалов', 'В море можно плавать — у причалов есть лестницы'] }); yield;
      if (K.E.ladder) for (const z of [370, 400, 446]) { K.part({ s: 'box', x: SEA.x1 - .3, y: -3.2, z, w: .1, h: 6.4, d: .8, c: '#e5e7eb' }); yield; K.E.ladder(K.ph, { x: SEA.x1 - 1, z, yaw: PI / 2, top: .02, w: .9 }); yield; }
    }
    yield;
    // ── Аэродром (юг, нейтральный): перрон со стоянками баз, полоса с запада на восток (небо над ней свободно), ангары, вышка ──
    K.chunk('air'); yield;
    {
      const RW = AIR.runway, AP = AIR.apron, RZ = (RW.z0 + RW.z1) / 2; yield;
      K.part({ s: 'box', x: (AP.x0 + AP.x1) / 2, y: .03, z: (AP.z0 + AP.z1) / 2, w: AP.x1 - AP.x0, h: .02, d: AP.z1 - AP.z0, m: M.concrete }); yield;
      K.part({ s: 'box', x: (RW.x0 + RW.x1) / 2, y: .03, z: RZ, w: RW.x1 - RW.x0, h: .02, d: RW.z1 - RW.z0, m: M.asphalt }); yield;
      for (let x = RW.x0 + 6; x < RW.x1 - 4; x += 9) K.part({ s: 'box', x, y: .045, z: RZ, w: 4.5, h: .01, d: .5, c: '#f8fafc' }); yield;
      for (const s of [-1, 1]) for (let x = RW.x0 + 2; x < RW.x1; x += 6) K.part({ s: 'ball', x, y: .12, z: RZ + s * 8.2, r: .12, c: s < 0 ? '#facc15' : '#4ade80', m: 'glow', seg: 6 }); yield;
      // стоянки баз — жёлтая «П» (открыта к полосе)
      for (const sl of AIR.slots) { K.part({ s: 'box', x: sl.x, y: .045, z: sl.z - 5.5, w: 11, h: .01, d: .25, c: '#facc15' }); yield; for (const s of [-1, 1]) K.part({ s: 'box', x: sl.x + s * 5.5, y: .045, z: sl.z, w: .25, h: .01, d: 11, c: '#facc15' }); yield; }
      for (const id of ['w_hangar1', 'w_hangar2']) {
        const b = WB(id); yield;
        K.mbuilding({ id, x: b.x, z: b.z, w: b.w, d: b.d, h: b.h, wall: b.wall, trim: '#4b5563', roofC: b.roof, floorC: '#6b7280', floorType: 'concrete',
          doors: [{ side: 's', at: 0, w: 12, h: 6 }], sign: id === 'w_hangar2' ? '✈️ Ангар 2' : '✈️ Ангар 1', signBg: '#374151' }); yield;
      }
      planeModel(K, WB('w_hangar1').x, WB('w_hangar1').z + 1, 0); yield;
      const ct = WB('w_control'), pc = (kind, n, o) => K.piece({ id: `w_control:${kind}:${n}`, kind, b: 'w_control', ...o }); yield;
      [[0, -2.85, 6, .3], [0, 2.85, 6, .3], [-2.85, 0, .3, 5.4], [2.85, 0, .3, 5.4]].forEach(([dx, dz, w, d], k) => pc('wall', k + 1, { x: ct.x + dx, y: 5, z: ct.z + dz, w, h: 10, d, c: '#e5e7eb', cam: true })); yield;
      pc('floor', 1, { x: ct.x, y: 10.1, z: ct.z, w: 8, h: .2, d: 8, c: '#9ca3af' }); yield;
      [[0, -3.95, 8, .1], [0, 3.95, 8, .1], [-3.95, 0, .1, 8], [3.95, 0, .1, 8]].forEach(([dx, dz, w, d], k) => pc('window', k + 1, { x: ct.x + dx, y: 11.6, z: ct.z + dz, w, h: 2.8, d, glass: true })); yield;
      pc('roof', 1, { x: ct.x, y: 13.2, z: ct.z, w: 8.6, h: .4, d: 8.6, c: ct.roof }); yield;
      K.label.sign('🛫 Аэродром', ct.x, 6, ct.z + 3.1, 5, .8, 0, { bg: '#1e3a8a', w: 640, h: 100 }); yield;
      K.npc({ id: 'w_pilot', name: '🧑‍✈️ Пилот', x: -244, z: 396, yaw: 90, seed: 'pilot7', say: ['Полоса — общая, у каждой базы своя стоянка ✈️', 'Взлетай на запад — над морем простор'] }); yield;
    }
    // вертолётные площадки лагеря
    for (const [x, z] of VEH.heli) {
      K.cyl(x, 0, z, 6, .12, '#374151', { solid: true, seg: 24 }); yield; K.part({ s: 'ring', x, y: .14, z, r: 5.4, r2: 5, rx: -PI / 2, c: '#facc15' }); yield;
      K.label.sign('H', x, .15, z, 4, 4, 0, { bg: '#374151', w: 128, h: 128, border: false }); yield;
    }
    yield;
    // ── Точки захвата, руины, полигон, укрытия (только в нейтральном центре и в порту) ──
    K.chunk('points'); yield;
    for (const P of POINTS) {
      const h = P.id === 'A' ? 2 : P.id === 'B' ? .3 : 1.5; yield;
      if (h > .5) { K.box(P.x, 0, P.z, 14, h, 14, '#a8a29e', { solid: true, floor: 'concrete' }); yield; K.wedge({ x: P.x + 10, z: P.z, y: h / 2, hx: 3, hy: h / 2, hz: 3, yaw: PI / 2 }); yield; K.part({ s: 'box', x: P.x + 10, y: h / 2, z: P.z, w: 6, h: .05, d: 6, rz: Math.atan2(h, 6), c: '#a8a29e' }); yield; }
      K.cyl(P.x, h, P.z, .1, 7, '#e5e7eb', { solid: true }); yield;
      K.part({ s: 'ring', x: P.x, y: h + .05, z: P.z, r: CAP_R, r2: CAP_R - .35, rx: -PI / 2, c: '#f8fafc', m: 'glow' }); yield;
      K.label.sign(`🚩 ${P.id} · ${P.name}`, P.x, h + 7.6, P.z, 3.6, .7, 0, { bg: '#111827', w: 512, h: 100 }); yield;
      K.label.sign(`🚩 ${P.id} · ${P.name}`, P.x, h + 7.6, P.z, 3.6, .7, PI, { bg: '#111827', w: 512, h: 100 }); yield;
      P.h = h; yield;
    }
    // руины у точки B
    { const B = POINTS[1]; yield; [[-8, -6, 6, .5, 3], [-6, 7, .5, 5, 2.4], [7, -7, .5, 4, 3.4], [6, 6, 5, .5, 2], [0, -9, 3, .5, 1.6]].forEach(([dx, dz, w, d, hh], k) => K.piece({ id: `w_point_b:wall:${k + 1}`, kind: 'wall', b: 'w_point_b', x: B.x + dx, y: hh / 2, z: B.z + dz, w, h: hh, d, c: '#78716c', cam: true })); yield; }
    // полигон: мишени, щит
    {
      const A = ROBOT.area, ax = (A.x0 + A.x1) / 2; yield;
      K.part({ s: 'box', x: ax, y: .02, z: (A.z0 + A.z1) / 2, w: A.x1 - A.x0, h: .02, d: A.z1 - A.z0, m: M.dirt }); yield;
      for (let i = 0; i < 6; i++) { const x = A.x0 + 4 + i * 4.4; yield; K.cyl(x, 0, A.z1 - 2, .08, 1.2, '#78350f'); yield; K.part({ s: 'cyl', x, y: 1.6, z: A.z1 - 2, r: .7, h: .1, rx: PI / 2, c: '#f8fafc' }); yield; K.part({ s: 'cyl', x, y: 1.6, z: A.z1 - 2.06, r: .45, h: .1, rx: PI / 2, c: '#dc2626' }); yield; }
      K.board(ax, 2.2, A.z0 - .4, 4, 1.6, PI, '🤖 Полигон: роботы-мишени', { bg: '#78350f' }); yield;
      K.box(ax, 0, A.z0 - .6, .2, 1.4, .2, '#57534e', { solid: true }); yield;
    }
    // укрытия: мешки, ящики, бетонные блоки — в центре кольца (поле боя между базами)
    for (let k = 0; k < 60; k++) {
      const x = CENTER.x0 + 4 + rnd() * (CENTER.x1 - CENTER.x0 - 8), z = CENTER.z0 + 4 + rnd() * (CENTER.z1 - CENTER.z0 - 8); yield;
      if (MZ.inRect(BK, x, z, 7) || POINTS.some(P => Math.hypot(P.x - x, P.z - z) < 11) || SPAWNS.ffa.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 4)) continue; yield;
      const t = rnd(); yield;
      if (t < .4) sandbags(K, x, z, rnd() * PI);
      else if (t < .75) K.piece({ id: `w_cover:crate:${++K.nCrate}`, kind: 'crate', b: 'w_cover', x, y: .8, z, w: 1.6, h: 1.6, d: 1.6, c: '#a16207', hp: 40 });
      else K.piece({ id: `w_cover:block:${++K.nBlock}`, kind: 'block', b: 'w_cover', x, y: .6, z, w: 3.2, h: 1.2, d: .9, yaw: rnd() * PI, c: '#9ca3af', hp: 150 }); yield;
    }
    for (let k = 0; k < 16; k++) { const x = CENTER.x0 + 3 + rnd() * (CENTER.x1 - CENTER.x0 - 6), z = CENTER.z0 + 3 + rnd() * (CENTER.z1 - CENTER.z0 - 6); yield; if (!MZ.inRect(BK, x, z, 9) && !POINTS.some(P => Math.hypot(P.x - x, P.z - z) < 12)) K.tree(x, z, 1, -1); yield; }
    yield;
    // ── Участки военных баз: земля, ограда с въездом (у береговых — без ограды со стороны моря), щит, командный пункт ──
    K.chunk('plots'); yield;
    for (const P of PLOTS) {
      K.flat(P.cx, P.cz, P.x1 - P.x0, P.z1 - P.z0, '#9c8f69', .025); yield;
      const G = P.gate, half = G.w / 2; yield;
      const sides = { n: [P.x0, P.z0, P.x1, P.z0], s: [P.x0, P.z1, P.x1, P.z1], w: [P.x0, P.z0, P.x0, P.z1], e: [P.x1, P.z0, P.x1, P.z1] }; yield;
      for (const [sd, [ax, az, bx, bz]] of Object.entries(sides)) {
        if (P.coast && sd === 'w') continue; yield;   // берег — под доки
        if (sd !== G.side) { fence(ax, az, bx, bz, '#4d5b2a'); yield; continue; yield; }
        const alongX = az === bz, c0 = alongX ? G.x : G.z; yield;
        if (alongX) { fence(ax, az, c0 - half, bz, '#4d5b2a'); yield; fence(c0 + half, az, bx, bz, '#4d5b2a'); yield; }
        else { fence(ax, az, bx, c0 - half, '#4d5b2a'); yield; fence(ax, c0 + half, bx, bz, '#4d5b2a'); yield; }
        // столбы въезда
        for (const s of [-1, 1]) K.box(alongX ? c0 + s * half : ax, 0, alongX ? az : c0 + s * half, .5, 2.8, .5, '#3f4a22', { solid: true }); yield;
      }
      // щит у въезда (снаружи, лицом к дороге)
      const ox = Math.sin(G.yaw), oz = Math.cos(G.yaw); yield;   // наружу
      const lx = oz, lz = -ox; yield;                              // вдоль ограды — в сторону, противоположную КП
      const bx = r2(G.x + lx * 7.6 + ox * .6), bz = r2(G.z + lz * 7.6 + oz * .6); yield;
      K.board(bx, 2.15, bz, 4.2, 1.2, G.yaw, `🏯 ${P.name} · ${P.code}`, { bg: '#3f6212' }); yield;
      K.box(bx - ox * .1, 0, bz - oz * .1, .16, 1.5, .16, '#57534e', { solid: true }); yield;
      K.item({ x: bx + ox * .9, y: 1.4, z: bz + oz * .9, r: 1.6, prompt: () => K.rt.S?.base?.war?.signPrompt?.(P) || `🏯 ${P.name}: участок свободен`, act: () => K.rt.S?.base?.war?.signAct?.(P) || K.rt.war?.plotInfo(P) }); yield;
      // плита над подвалом базы: по ней ходят (под ней — штабной зал)
      K.body({ x: (P.cellar.x0 + P.cellar.x1) / 2, z: (P.cellar.z0 + P.cellar.z1) / 2, y: -.15, hx: (P.cellar.x1 - P.cellar.x0) / 2 + .3, hy: .15, hz: (P.cellar.z1 - P.cellar.z0) / 2 + .3, tag: 'slab', data: { floor: 'concrete' } }); yield;
      // командный пункт (из деталей с номерами — как всё в зоне)
      K.mbuilding({ id: P.id + '_cp', x: P.cp.x, z: P.cp.z, w: P.cp.w, d: P.cp.d, h: 3.2, wall: '#a8a29e', trim: '#3f6212', roofC: WB(P.id + '_cp').roof, floorC: '#a8a29e', floorType: 'concrete',
        doors: [{ side: P.cp.door, at: 0, w: 1.6 }], windows: [{ side: P.cp.win, at: 0, w: 1.6, h: 1 }], sign: '🏯 КП', signBg: '#3f6212' }); yield;
    }
    if (MZ.CELLAR) MZ.CELLAR.on = true;   // плиты легли — подвалы открыты
    yield;
    K.flush(); yield;
    K.done = true; yield;
  }
  // мешки с песком: каждый мешок — деталь с номером (укрытие можно будет разбить по мешку)
  function sandbags(K, x, z, yaw){
    const n = ++K.nBags, c = Math.cos(yaw), s = Math.sin(yaw);
    for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) {
      const lx = -1.5 + i + (r ? .5 : 0);
      K.piece({ id: `w_cover:bags${n}:${r * 4 + i + 1}`, kind: 'bag', b: 'w_cover', x: x + c * lx, y: .22 + r * .4, z: z - s * lx, w: .95, h: .4, d: .7, yaw, c: '#b7a37a', hp: 30 });
    }
  }
  // модели транспорта (пока стоят; ездить — vehicle.js)
  function boatModel(K, x, z, yaw){
    const g = K.group(x, 0, z, yaw), P = p => K.R.part(g, p);
    P({ s: 'box', y: -.1, w: 2.6, h: .9, d: 6, c: '#f8fafc' }); P({ s: 'box', y: .45, z: -.6, w: 1.8, h: .8, d: 2, c: '#1e3a8a' }); P({ s: 'cone', y: -.1, z: 3.4, r: 1.3, h: 1.4, rx: PI / 2, seg: 4, c: '#f8fafc' });
  }
  function warship(K, x, z, yaw){
    const g = K.group(x, 0, z, yaw), P = p => K.R.part(g, p);
    P({ s: 'box', y: .4, w: 8, h: 3, d: 40, c: '#64748b' }); P({ s: 'box', y: 2.6, z: -4, w: 6, h: 3, d: 10, c: '#94a3b8' }); P({ s: 'box', y: 5.2, z: -5, w: 3, h: 2.4, d: 4, c: '#cbd5e1' });
    P({ s: 'cyl', y: 2.6, z: 12, r: 1.4, h: .8, c: '#475569' }); P({ s: 'cyl', y: 3, z: 14.4, r: .25, h: 4, rx: PI / 2, c: '#334155' }); P({ s: 'cyl', y: 8, z: -5, r: .1, h: 6, c: '#e5e7eb' });
    K.body({ x, z, y: 1.5, hx: 4, hy: 3, hz: 20, yaw, tag: 'ship' });
  }
  function heliModel(K, x, z, yaw){
    const g = K.group(x, .12, z, yaw), P = p => K.R.part(g, p);
    P({ s: 'ball', y: 1.4, r: 1.5, sz: 1.5, c: '#3f6212', seg: 12 }); P({ s: 'box', y: 1.6, z: -3.4, w: .4, h: .4, d: 4.4, c: '#3f6212' }); P({ s: 'box', y: 2.1, z: -5.4, w: .1, h: 1.4, d: .8, c: '#3f6212' });
    P({ s: 'box', y: 3, w: .25, h: .08, d: 9, c: '#111827' }); P({ s: 'box', y: 3, w: 9, h: .08, d: .25, c: '#111827' }); P({ s: 'box', y: 1.6, z: 1.1, w: 1.6, h: .7, d: .6, c: '#bae6fd' });
    for (const s of [-1, 1]) P({ s: 'box', x: s * 1, y: .1, w: .12, h: .12, d: 3, c: '#111827' });
    K.body({ x, z, y: 1.6, hx: 1.6, hy: 1.6, hz: 2.4, yaw, tag: 'heli' });
  }
  function planeModel(K, x, z, yaw){
    const g = K.group(x, 0, z, yaw), P = p => K.R.part(g, p);
    P({ s: 'cyl', y: 1.5, r: .9, r2: .7, h: 9, rx: PI / 2, c: '#e5e7eb' }); P({ s: 'cone', y: 1.5, z: 5.2, r: .9, h: 1.6, rx: PI / 2, c: '#dc2626' });
    P({ s: 'box', y: 1.5, z: .4, w: 11, h: .18, d: 2, c: '#cbd5e1' }); P({ s: 'box', y: 2.5, z: -4, w: .16, h: 2, d: 1.4, c: '#dc2626' }); P({ s: 'box', y: 1.7, z: -4.2, w: 4, h: .14, d: 1, c: '#cbd5e1' });
    for (const [sx, sz] of [[-1.4, .6], [1.4, .6], [0, 3.6]]) P({ s: 'cyl', x: sx, y: .35, z: sz, r: .35, h: .25, rz: PI / 2, c: '#111827', seg: 10 });
    K.body({ x, z, y: 1.5, hx: 5.5, hy: 1.5, hz: 5, yaw, tag: 'plane' });
  }

  // ═══ ИГРА В ЗОНЕ ═══
  function warMod(rt, K){
    const S = rt.S, R = rt.R, T = rt.T, ph = rt.ph, X = rt.X, H = rt.H, toast = rt.toast, E = rt.E;
    rt.WEAPON_E = { foam: '🔫', paint: '🎯', water: '💧', sword: '🗡️', shield: '🫧' };
    const nowMs = () => Date.now();
    const W = { inZone: false, hp: HP, down: 0, prot: 0, shield: 0, slot: 0, cd: {}, kills: 0, deaths: 0, robotKills: 0, team: 0, prevRole: null, ch: null, chOn: false, chAt: 0, out: { f: [], h: [] }, sendAt: 0,
      hist: new Map(), score: {}, teams: { 1: 0, 2: 0 }, mode: 'ffa', votes: {}, round: { id: 0, end: 0 }, pts: POINTS.map(p => ({ id: p.id, own: 0, prog: 0 })), ref: false, rsAt: 0, regenAt: 0, lastHit: 0 };
    rt.war = { board, rules, armory, hire, plotInfo, W, touch: on => touchButtons(on) };
    // ── HUD боя ──
    const hud = document.createElement('div'); hud.className = 'mz-war'; hud.hidden = true; rt.hud.appendChild(hud);
    hud.innerHTML = `<div class="mz-hitfx"></div><div class="mz-cross"></div><div class="mz-hp"><i></i><b></b></div><div class="mz-wpn">${SLOTS.map((w, i) => `<button type="button" data-mz="w:slot:${i}" title="${esc(WEAPONS[w].name)} (${i + 1})">${WEAPONS[w].icon}<small>${i + 1}</small></button>`).join('')}</div><div class="mz-score"></div><div class="mz-feed"></div><div class="mz-down" hidden></div>`;
    const hq = s => hud.querySelector(s);
    function drawHud(){
      hq('.mz-hp i').style.width = Math.max(0, W.hp) + '%'; hq('.mz-hp b').textContent = `❤️ ${Math.max(0, Math.ceil(W.hp))}`;
      hud.querySelectorAll('.mz-wpn button').forEach((b, i) => b.classList.toggle('on', i === W.slot));
    }
    function drawScore(){
      const M0 = MODES[W.mode], left = Math.max(0, Math.ceil((W.round.end - nowMs()) / 1000));
      const tm = left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '—';
      let body = '';
      if (W.mode === 'ffa') {
        const L = Object.entries(W.score).sort((a, b) => b[1] - a[1]).slice(0, 5);
        body = `<ol>${L.map(([k, n]) => `<li>${esc(nickOf(k))} — ${n}</li>`).join('') || '<li>пока никого</li>'}</ol>`;
      } else if (W.mode === 'team') body = `<span class="r">🟥 ${W.teams[1]}</span> : <span class="bl">${W.teams[2]} 🟦</span>`;
      else body = `<span class="r">🟥 ${W.teams[1]}</span> : <span class="bl">${W.teams[2]} 🟦</span> / ${CAP_WIN}<br>${W.pts.map(p => `🚩${p.id}${p.own === 1 ? '🟥' : p.own === 2 ? '🟦' : '⬜'}`).join(' ')}`;
      hq('.mz-score').innerHTML = `<b>${M0[0]} ${esc(M0[1])} · ${tm}</b>${body}<div>Ты: ${W.kills} выбил · ${W.deaths} выбыл${W.robotKills ? ` · 🤖 ${W.robotKills}` : ''}</div>`;
    }
    const nickOf = k => (k === S.key ? S.me.nick : S.players.get(k)?.nick || 'игрок');
    function feed(text){ const d = document.createElement('div'); d.textContent = text; const f = hq('.mz-feed'); f.prepend(d); while (f.children.length > 5) f.lastChild.remove(); setTimeout(() => d.remove(), 5200); }
    // ── кнопки телефона: удар и смена оружия (в зоне), иначе — как было ──
    const BASE_BTNS = [{ action: 'crouch', icon: '⬇', label: 'присесть' }, { action: 'interact', icon: '✋', label: 'действие' }, { action: 'jump', icon: '⤒', label: 'прыжок', big: true }];
    function touchButtons(on){
      if (!S.I?.touch || !S.H) return;
      S.H.buttons(on ? [{ action: 'crouch', icon: '⬇', label: 'присесть' }, { action: 'interact', icon: '✋', label: 'действие' }, { id: 'wnext', icon: '🔄', label: 'оружие', toggle: () => { setSlot((W.slot + 1) % SLOTS.length); return false; } }, { action: 'attack', icon: '👊', label: 'огонь', big: true }, { action: 'jump', icon: '⤒', label: 'прыжок', big: true }] : BASE_BTNS);
    }
    // Панель оружия — не под кнопками телефона: кнопки по ширине заходят под неё (телефон стоя, планшет) — панель и жизни над
    // кнопками (высота кнопок — меряем: размер кнопок в ⚙️, левша, их число). Раньше на телефоне её ячейки закрывали кнопки и очки
    function layoutHud(){
      if (hud.hidden) return;
      const eb = S.wrap.querySelector('.e-btns'), wp = hq('.mz-wpn');
      let up = false, mzb = 0;
      if (eb && wp) {
        const W0 = S.wrap.getBoundingClientRect(), half = wp.offsetWidth / 2 + 6, cx = W0.left + W0.width / 2;
        let top = Infinity, l = Infinity, r = -Infinity;
        for (const b of eb.children) { if (b.hidden) continue; const q = b.getBoundingClientRect(); if (!q.width) continue; top = Math.min(top, q.top); l = Math.min(l, q.left); r = Math.max(r, q.right); }
        up = top < Infinity && l < cx + half && r > cx - half;
        mzb = up ? Math.round(W0.bottom - top + 10) : 0;
      }
      if (hud.classList.contains('mz-up') !== up) hud.classList.toggle('mz-up', up);
      if (up && hud._mzb !== mzb) { hud._mzb = mzb; hud.style.setProperty('--mzb', mzb + 'px'); }
    }
    const onResize = () => { if (W.inZone) requestAnimationFrame(layoutHud); };
    // ── вход и выход из зоны ──
    function enter(){
      W.inZone = true;
      W.prevRole = rt.zx.r && !ROLES_W[rt.zx.r] ? rt.zx.r : W.prevRole;
      if (rt.zx.r && rt.ROLES[rt.zx.r] && !ROLES_W[rt.zx.r]) rt.setZX({ r: null });
      joinChannel();
      setTimeout(() => { if (W.inZone) applyTeam(); }, 700);
      W.hp = HP; W.prot = nowMs() + PROTECT * 1000;
      rt.setZX({ h: 10, w: SLOTS[W.slot] });
      hud.hidden = false; drawHud(); drawScore();
      touchButtons(true);
      requestAnimationFrame(layoutHud); root.addEventListener('resize', onResize);
      S.H?.crosshair?.(false);
      toast('⚔️ Ты в Боевой зоне: здесь можно сражаться. F (или 👊) — огонь, 1–5 — оружие, за воротами бой закончится', true);
    }
    function leave(){
      W.inZone = false;
      hud.hidden = true;
      touchButtons(false);
      root.removeEventListener('resize', onResize);
      for (const m of [...W.mercs]) dropMerc(m);
      rt.setZX({ r: W.prevRole && rt.ROLES[W.prevRole] ? W.prevRole : null, t: null, h: null, w: null, m: null, a: null });
      W.prevRole = null;
      clearTimeout(W.leaveT); W.leaveT = setTimeout(() => { if (!W.inZone) leaveChannel(); }, 12000);
      toast('🕊️ Ты вышел из Боевой зоны — оружие убрано');
    }
    function applyTeam(){
      if (W.mode === 'ffa') { W.team = 0; rt.setZX({ r: 'ffa', t: null }); return; }
      const cnt = { 1: 0, 2: 0 };
      for (const p of S.players.values()) if (!p.leaving && p.zx?.t && MZ.inRect(WZ, p.ch.x, p.ch.z)) cnt[p.zx.t]++;
      W.team = W.team && W.team !== 0 ? W.team : teamFor(cnt);
      rt.setZX({ r: W.team === 1 ? 'red' : 'blue', t: W.team });
    }
    // ── канал боя: только broadcast, подписи ключом мира ──
    function joinChannel(){
      clearTimeout(W.leaveT);
      if (W.ch || typeof sbClient === 'undefined' || !sbClient || !S.keys) return;
      if (nowMs() - W.chAt < 8000) { setTimeout(() => { if (W.inZone && !W.ch) joinChannel(); }, 8000); return; }
      W.chAt = nowMs();
      const name = 'mirz-' + (S.shard || 1);
      const old = sbClient.getChannels?.().find(c => c.topic === 'realtime:' + name);
      if (old) { try { sbClient.removeChannel(old); } catch (e) {} }
      const ch = sbClient.channel(name, { config: { broadcast: { self: false } } });
      ch.on('broadcast', { event: 'c' }, ({ payload }) => { if (W.ch === ch) onCombat(payload); });
      ch.subscribe(s => { if (W.ch === ch && s === 'SUBSCRIBED') W.chOn = true; });
      W.ch = ch;
    }
    function leaveChannel(){ const ch = W.ch; W.ch = null; W.chOn = false; if (ch) { try { sbClient.removeChannel(ch); } catch (e) {} } }
    let lastTs = 0;
    async function csend(d){
      if (!W.ch || !W.chOn || !S.keys) return;
      d.ts = Math.max(nowMs(), lastTs + 1); lastTs = d.ts;
      const m = JSON.stringify(d);
      try { W.ch.send({ type: 'broadcast', event: 'c', payload: { k: S.key, m, s: await H.sign(S.keys.kp.privateKey, m) } }); } catch (e) {}
    }
    const rate = new Map();
    async function onCombat(pl){
      if (!pl || typeof pl.k !== 'string' || typeof pl.m !== 'string' || typeof pl.s !== 'string' || pl.m.length > 4000) return;
      const p = S.players.get(pl.k); if (!p || !p.pub) return;
      const t = nowMs(), rr = (rate.get(pl.k) || []).filter(x => t - x < 1000);
      if (rr.length >= 8) return; rr.push(t); rate.set(pl.k, rr);
      if (!await H.verify(p.pub, pl.s, pl.m)) return;
      let d; try { d = JSON.parse(pl.m); } catch (e) { return; }
      if (!d || !(d.ts > (p.wTs || 0))) return;
      p.wTs = d.ts;
      if (d.t === 'c') {
        if (Array.isArray(d.f)) for (const f of d.f.slice(0, 6)) remoteShot(p, f);
        if (Array.isArray(d.h)) for (const h of d.h.slice(0, 8)) if (h && h[0] === S.key) gotClaim(p, h);
      } else if (d.t === 'd') onDown(p, d);
      else if (d.t === 'rs') onRefState(p, d);
      else if (d.t === 'mv' && typeof d.mode === 'string' && MODES[d.mode]) { W.votes[p.key] = d.mode; }
    }
    // ── стрельба ──
    const v3 = new T.Vector3(), aim = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 };
    function aimRay(){
      const cam = R.camera; cam.getWorldDirection(v3);
      const P = S.P, ox = P.ch.x, oy = P.ch.y + 1.45, oz = P.ch.z;
      // куда смотрит камера (по горизонтали), наклон — мягкий: от 3-го лица камера смотрит сверху, стрелять в землю у ног — не то
      const hl = Math.hypot(v3.x, v3.z) || 1, pitch = Math.max(-.12, Math.min(.35, v3.y + (S.rig?.mode === 'first' ? 0 : .32)));
      let tx = ox + v3.x / hl * 60, ty = oy + pitch * 60, tz = oz + v3.z / hl * 60;
      // помощь прицеливания (мультяшная игра, дети): ближайшая цель в конусе ~16° по горизонтали
      const best = assist(ox, oz, v3.x / hl, v3.z / hl);
      if (best) { tx = best.x; ty = best.y + 1.2; tz = best.z; }
      const dx = tx - ox, dy = ty - oy, dz = tz - oz, l = Math.hypot(dx, dy, dz) || 1;
      aim.x = ox; aim.y = oy; aim.z = oz; aim.dx = dx / l; aim.dy = dy / l; aim.dz = dz / l;
      return aim;
    }
    function assist(ox, oz, fx, fz){
      let best = null, bs = -1;
      for (const t of targets()) {
        const dx = t.x - ox, dz = t.z - oz, l = Math.hypot(dx, dz); if (l > 46 || l < .3) continue;
        const c = (dx * fx + dz * fz) / l; if (c < .96) continue;
        const sc = c * 2 - l / 46;   // ближе к центру и ближе к себе
        if (sc > bs) { bs = sc; best = t; }
      }
      return best;
    }
    // цели: чужие игроки (враги), свои роботы
    function targets(){
      const L = [];
      for (const p of S.players.values()) if (!p.leaving && !p.wbHide && p.zx?.h > 0 && MZ.inRect(WZ, p.ch.x, p.ch.z) && !(W.team && p.zx.t === W.team)) L.push({ kind: 'p', p, x: p.ch.x, y: p.ch.y, z: p.ch.z });
      for (const r of W.robots) if (r.hp > 0) { const a = rob.A.get(r.key); if (a) L.push({ kind: 'r', r, x: a.x, y: a.y, z: a.z }); }
      return L;
    }
    function setSlot(i){ W.slot = i; rt.setZX({ w: SLOTS[i] }); drawHud(); rt.sfx('click', { vol: .4 }); }
    function fire(){
      const w = SLOTS[W.slot], WP = WEAPONS[w], t = nowMs();
      if (W.down || (W.cd[w] || 0) > t) return;
      W.cd[w] = t + WP.cd * 1000;
      if (w === 'shield') { W.shield = t + WP.dur * 1000; rt.setZX({ sh: 1 }); setTimeout(() => rt.setZX({ sh: null }), WP.dur * 1000); toast('🫧 Щит-пузырь: 3 с без урона'); rt.sfx('pickup', { rate: .6 }); return; }
      const a = aimRay();
      S.P.yaw = Math.atan2(a.dx, a.dz);
      rt.setZX({ a: 'aim' }); clearTimeout(W.aimT); W.aimT = setTimeout(() => { if (rt.zx.a === 'aim') rt.setZX({ a: null }); }, 1400);
      if (WP.melee) { swing(a); return; }
      const sx = a.x + a.dx * .6, sy = a.y, sz = a.z + a.dz * .6;
      shoot({ w, x: sx, y: sy, z: sz, dx: a.dx, dy: a.dy, dz: a.dz, own: true, by: S.key });
      W.out.f.push([w, r1(sx), r1(sy), r1(sz), r3(a.dx), r3(a.dy), r3(a.dz)]);
      rt.sfx(w === 'water' ? 'scuff' : 'pickup', { x: sx, y: sy, z: sz, vol: .45, rate: w === 'foam' ? 1.6 : 1.1 });
      S.rig?.kick?.(.25);
    }
    const r1 = v => Math.round(v * 10) / 10, r3 = v => Math.round(v * 1000) / 1000;
    function swing(a){
      rt.sfx('roll', { vol: .5, rate: 1.4 });
      const P = S.P.ch, WP = WEAPONS.sword;
      for (const t of targets()) {
        const dx = t.x - P.x, dz = t.z - P.z, d = Math.hypot(dx, dz);
        if (d > WP.range || Math.abs(t.y - P.y) > 2) continue;
        if ((dx * a.dx + dz * a.dz) / (d || 1) < .45) continue;
        hitTarget(t, 'sword', WP.dmg, P.x, P.z);
      }
    }
    // ── снаряды: один InstancedMesh на всех (один вызов отрисовки) ──
    const MAXP = 96, shots = [];
    const pGeo = new T.SphereGeometry(1, 8, 6), pMat = new T.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const pMesh = new T.InstancedMesh(pGeo, pMat, MAXP); pMesh.count = 0; pMesh.frustumCulled = false; R.scene.add(pMesh); R.own.push(pGeo, pMat);
    const mx = new T.Matrix4(), col = new T.Color();
    function shoot(o){
      if (shots.length >= MAXP) shots.shift();
      const WP = WEAPONS[o.w];
      shots.push({ ...o, vx: o.dx * WP.speed, vy: o.dy * WP.speed + (WP.grav ? WP.grav * .18 : 0), vz: o.dz * WP.speed, life: WP.range / WP.speed + .6, dist: 0 });
    }
    function remoteShot(p, f){
      if (!Array.isArray(f) || f.length !== 7 || !WEAPONS[f[0]] || !f.slice(1).every(Number.isFinite)) return;
      if (Math.hypot(f[1] - p.ch.x, f[3] - p.ch.z) > 10) return;
      shoot({ w: f[0], x: f[1], y: f[2], z: f[3], dx: f[4], dy: f[5], dz: f[6], own: false, by: p.key });
      rt.sfx('pickup', { x: f[1], y: f[2], z: f[3], vol: .3, rate: 1.5 });
    }
    function stepShots(dt){
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i], WP = WEAPONS[s.w];
        s.vy -= (WP.grav || 0) * dt;
        const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt, nz = s.z + s.vz * dt, seg = Math.hypot(nx - s.x, ny - s.y, nz - s.z);
        let end = false, hx = nx, hy = ny, hz = nz;
        // стены и земля
        if (seg > 1e-4) { const h = ph.raycast(s.x, s.y, s.z, (nx - s.x) / seg, (ny - s.y) / seg, (nz - s.z) / seg, seg); if (h) { end = true; hx = h.x; hy = h.y; hz = h.z; } }
        // цели: своими снарядами — попадание (заявка); чужими — только брызги
        if (!end) for (const t of s.own || s.robot || s.merc ? hitList(s) : []) {
          if (segCapsule(s.x, s.y, s.z, nx, ny, nz, t.x, t.y, t.z, .55, 2.3)) { end = true; hx = t.x; hy = t.y + 1.2; hz = t.z; if (!WP.splash) onShotHit(s, t); break; }
        }
        if (!end && !s.own && !s.robot) for (const t of meTarget()) if (segCapsule(s.x, s.y, s.z, nx, ny, nz, t.x, t.y, t.z, .55, 2.3)) { end = true; hx = t.x; hy = t.y + 1.2; hz = t.z; break; }
        s.dist += seg; s.life -= dt;
        if (!MZ.inRect(WZ, nx, nz, 2)) end = true;   // снаряды не вылетают из зоны
        s.x = nx; s.y = ny; s.z = nz;
        if (end || s.life <= 0) {
          if (end && s.own) rt.destruct?.hit(hx, hz, WP.splash ? 2.4 : .9, WP.splash ? 3 : WP.dmg >= 20 ? 2 : 1, { y: hy, by: 'shot', dx: s.vx, dz: s.vz });
          if (WP.splash && (s.own || s.robot)) splash(s, hx, hz);
          puff(WP.fx || 'sparkles', hx, hy, hz, WP.color);
          shots.splice(i, 1);
        }
      }
    }
    const meTarget = () => (W.inZone && W.hp > 0 ? [{ kind: 'me', x: S.P.ch.x, y: S.P.ch.y, z: S.P.ch.z }] : []);
    function hitList(s){
      if (s.robot) return [...meTarget(), ...W.mercs.map(m => ({ kind: 'm', m, ...mercPos(m) }))];
      return targets();
    }
    // отрезок против вертикальной капсулы (цилиндра) человечка
    function segCapsule(x1, y1, z1, x2, y2, z2, cx, cy, cz, r, h){
      const dx = x2 - x1, dz = z2 - z1, fx = x1 - cx, fz = z1 - cz, a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - r * r;
      let t = 0;
      if (a < 1e-9) { if (c > 0) return false; } else { const D = b * b - 4 * a * c; if (D < 0) return false; t = Math.max(0, (-b - Math.sqrt(D)) / (2 * a)); if (t > 1) return false; }
      const y = y1 + (y2 - y1) * t; return y >= cy - .1 && y <= cy + h;
    }
    function onShotHit(s, t){
      const WP = WEAPONS[s.w];
      if (s.robot) { if (t.kind === 'me') takeDamage(WP.dmg, null, 'robot'); else if (t.kind === 'm') mercHurt(t.m, WP.dmg); return; }
      hitTarget(t, s.w, WP.dmg, s.mx ?? S.P.ch.x, s.mz ?? S.P.ch.z, s.merc);
    }
    function splash(s, hx, hz){
      const WP = WEAPONS[s.w];
      if (s.robot) { const d = Math.hypot(S.P.ch.x - hx, S.P.ch.z - hz); const n = splashDmg(WP, d); if (n > 0) takeDamage(n, null, 'robot'); return; }
      for (const t of targets()) { const n = splashDmg(WP, Math.hypot(t.x - hx, t.z - hz)); if (n > 0) hitTarget(t, s.w, n, S.P.ch.x, S.P.ch.z); }
    }
    // попал в цель: робот — у себя; игрок — заявка ему (урон решает он)
    function hitTarget(t, w, dmg, ax, az, merc){
      hq('.mz-cross').classList.add('hit'); setTimeout(() => hq('.mz-cross')?.classList.remove('hit'), 160);
      if (t.kind === 'r') { robotHurt(t.r, dmg); return; }
      if (t.kind === 'p') W.out.h.push([t.p.key, merc ? 'merc' : w, Math.round(dmg), r1(ax), r1(az)]);
    }
    // ── мне прилетело: проверяю сам ──
    function gotClaim(p, h){
      const [, w, dmg, ax, az] = h, t = nowMs(), key = p.key + '|' + w, hist = W.hist.get(key) || [];
      const why = claimOk({ w, dmg, ax, az },
        { x: S.P.ch.x, z: S.P.ch.z, zone: W.inZone && W.hp > 0, team: W.team, prot: W.prot, shield: W.shield, now: t },
        { x: p.ch.x, z: p.ch.z, zone: MZ.inRect(WZ, p.ch.x, p.ch.z, 4), team: p.zx?.t || 0, merc: p.zx?.m || 0 }, hist);
      hist.push(t); W.hist.set(key, hist.filter(x => t - x < 2000));
      if (why) return;
      takeDamage(dmg, p, w);
    }
    function takeDamage(n, p, w){
      if (W.down || !W.inZone) return;
      const t = nowMs();
      if (t < W.prot || t < W.shield) return;
      W.hp -= n; W.lastHit = t;
      const fx = hq('.mz-hitfx'); fx.classList.add('on'); setTimeout(() => fx.classList.remove('on'), 120);
      rt.sfx('hit', { vol: .5 });
      S.rig?.shake?.(1.2, .18);
      if (W.hp <= 0) return knockOut(p, w);
      const hb = Math.max(1, Math.ceil(W.hp / 10)); if (rt.zx.h !== hb) rt.setZX({ h: hb });
      drawHud();
    }
    function knockOut(p, w){
      W.hp = 0; W.down = nowMs() + RESPAWN * 1000; W.deaths++;
      rt.setZX({ h: 0 });
      if (p) { csend({ t: 'd', by: p.key, w }); feed(`${p.nick} ${WEAPONS[w]?.icon || '💥'} ${S.me.nick}`); }
      else feed(`🤖 выбил ${S.me.nick}`);
      const d = hq('.mz-down'); d.hidden = false; d.textContent = `💦 Тебя выбили${p ? ': ' + p.nick : ''}! Снова в бою через ${RESPAWN} с`;
      drawHud(); drawScore();
    }
    function respawn(){
      W.down = 0; W.hp = HP; W.prot = nowMs() + PROTECT * 1000;
      hq('.mz-down').hidden = true;
      const L = W.team === 1 ? SPAWNS.red : W.team === 2 ? SPAWNS.blue : SPAWNS.ffa, s = L[Math.floor(Math.random() * L.length)];
      rt.place(s[0], s[1], Math.atan2(CC.x - s[0], CC.z - s[1]));
      rt.setZX({ h: 10 }); drawHud();
    }
    function onDown(p, d){
      if (typeof d.by !== 'string') return;
      if (d.by === S.key) { W.kills++; W.score[S.key] = (W.score[S.key] || 0) + 1; if (W.team) W.teams[W.team]++; toast(`💥 Ты выбил: ${p.nick}`, true); rt.sfx('coin'); }
      else { W.score[d.by] = (W.score[d.by] || 0) + 1; const k = S.players.get(d.by); if (k?.zx?.t) W.teams[k.zx.t]++; }
      feed(`${nickOf(d.by)} ${WEAPONS[d.w]?.icon || '💥'} ${p.nick}`);
      drawScore();
    }
    // ── судья раунда: самый ранний в мире из тех, кто в зоне (у себя таймер, счёт, точки — и всем раз в 2 с) ──
    function referee(){
      let best = W.inZone ? { k: S.key, at: S.joinedAt } : null;
      for (const p of S.players.values()) if (!p.leaving && MZ.inRect(WZ, p.ch.x, p.ch.z) && (!best || (p.at || 0) < best.at)) best = { k: p.key, at: p.at || 0 };
      return best?.k === S.key;
    }
    function onRefState(p, d){
      if (!MODES[d.mode] || !Number.isFinite(d.end)) return;
      if (W.ref && (p.at || 0) > S.joinedAt) return;   // я старше — я и судья
      const modeChanged = d.mode !== W.mode;
      W.mode = d.mode; W.round = { id: d.rid | 0, end: d.end };
      if (d.sc && typeof d.sc === 'object') for (const [k, n] of Object.entries(d.sc)) if (Number.isInteger(n) && n >= 0 && n < 1000) W.score[k] = Math.max(W.score[k] || 0, n);
      if (d.tm && Number.isInteger(d.tm[0]) && Number.isInteger(d.tm[1])) { W.teams[1] = Math.max(W.teams[1], d.tm[0]); W.teams[2] = Math.max(W.teams[2], d.tm[1]); }
      if (Array.isArray(d.pt)) d.pt.slice(0, 3).forEach((q, i) => { if (Array.isArray(q) && W.pts[i]) { W.pts[i].own = q[0] | 0; W.pts[i].prog = Math.max(-1, Math.min(1, +q[1] || 0)); } });
      if (modeChanged && W.inZone) applyTeam();
      drawScore();
    }
    function refTick(dt){
      W.ref = referee();
      if (!W.ref) return;
      const t = nowMs();
      if (!W.round.end || t >= W.round.end) newRound();
      if (W.mode === 'cap') {
        const near = {};
        const all = [{ x: S.P.ch.x, z: S.P.ch.z, t: W.team, alive: W.hp > 0 }, ...[...S.players.values()].filter(p => !p.leaving).map(p => ({ x: p.ch.x, z: p.ch.z, t: p.zx?.t, alive: (p.zx?.h || 0) > 0 }))];
        for (const P of POINTS) { const n = [0, 0]; for (const a of all) if (a.alive && a.t && Math.hypot(a.x - P.x, a.z - P.z) < CAP_R) n[a.t - 1]++; near[P.id] = n; }
        capStep(W.pts, near, dt);
        for (const p of W.pts) if (p.own) W.teams[p.own] += dt;
        if (W.teams[1] >= CAP_WIN || W.teams[2] >= CAP_WIN) W.round.end = t;
      }
      if (t - W.rsAt > 2000) {
        W.rsAt = t;
        const sc = {}; for (const [k, n] of Object.entries(W.score)) if (n > 0) sc[k] = n;
        csend({ t: 'rs', mode: W.mode, rid: W.round.id, end: W.round.end, sc, tm: [Math.floor(W.teams[1]), Math.floor(W.teams[2])], pt: W.pts.map(p => [p.own, Math.round(p.prog * 100) / 100]) });
      }
    }
    function newRound(){
      // голоса за режим: больше всего голосов (свой голос тоже)
      const cnt = {}; for (const v of Object.values(W.votes)) cnt[v] = (cnt[v] || 0) + 1;
      const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
      if (best) W.mode = best[0];
      W.votes = {};
      W.round = { id: W.round.id + 1, end: nowMs() + ROUND * 1000 };
      W.score = {}; W.teams = { 1: 0, 2: 0 }; W.pts = POINTS.map(p => ({ id: p.id, own: 0, prog: 0 }));
      W.rsAt = 0;
    }
    // результат раунда — на сервер (game_result: потолок очков, XP — 3 победы в день на «игру», лимиты дня)
    async function report(key, win, score){
      if (typeof currentUser === 'undefined' || !currentUser || typeof sbClient === 'undefined' || !sbClient) { if (!W.loginHint) { W.loginHint = true; toast('🔑 Войди — и за победы будут XP, а монеты сохранятся в аккаунте'); } return; }
      const { data } = await sbClient.rpc('game_result', { p_game: key, p_win: !!win, p_score: Math.round(score) || 0 });
      if (data?.ok && data.xp > 0) toast(`⭐ +${data.xp} XP за бой`, true);
    }
    // конец раунда (у всех — по таймеру судьи): награда за свой результат
    let lastRound = 0;
    async function roundEnd(){
      if (!W.inZone || lastRound === W.round.id) return;
      lastRound = W.round.id;
      const top = Object.entries(W.score).sort((a, b) => b[1] - a[1])[0];
      const win = W.mode === 'ffa' ? !!top && top[0] === S.key && top[1] > 0 : W.team && W.teams[W.team] > W.teams[3 - W.team];
      const rw = reward(W.mode, W.kills, win);
      toast(`🏁 Раунд окончен! ${win ? '🏆 Победа! ' : ''}Выбил: ${W.kills}`, true);
      W.kills = 0; W.deaths = 0;
      if (rw.score > 0 || rw.win) {
        try { await report('mirwar', rw.win, rw.score); } catch (e) {}
        if (rw.coins > 0 && root.D37Coins) { const r = await root.D37Coins.run('mirwar', rw.coins, 'mw:' + Date.now().toString(36)); if (r?.ok) toast(`🪙 +${r.got ?? rw.coins} за бой`, true); else if (r?.reason === 'game') toast('🪙 Награды за бой заработают, когда сайт обновится'); }
      }
    }
    // ── роботы полигона (у каждого свои, без сети): идут к игроку, стреляют пеной ──
    const rob = E.npcs ? E.npcs(R, ph) : null;
    W.robots = [];
    let robN = 0;
    if (rob) rob.start({});
    function robotTick(dt){
      if (!rob) return;
      const A0 = ROBOT.area, me = S.P.ch, near = MZ.inRect(A0, me.x, me.z, 22) && W.inZone;
      if (near && W.robots.length < ROBOT.max && Math.random() < dt * .7) {
        const o = { id: 'rb' + (++robN), pos: [A0.x0 + 3 + Math.random() * (A0.x1 - A0.x0 - 6), 0, A0.z1 - 4], rot: [0, 180, 0], look: 'robot', seed: 'rb' + robN, act: 'follow', speed: .55, radius: 0, damage: 0, text: '' };
        rob.add(o); W.robots.push({ o, key: 'npc:' + o.seed, hp: ROBOT.hp, cd: 1 + Math.random() });
      }
      if (!near && W.robots.length) { for (const r of W.robots) rob.remove(r.o); W.robots = []; }
      rob.step(dt, near ? [me] : []);
      for (const r of W.robots) {
        const a = rob.A.get(r.key); if (!a || r.hp <= 0) continue;
        r.cd -= dt;
        const d = Math.hypot(me.x - a.x, me.z - a.z);
        if (r.cd <= 0 && d < WEAPONS.robot.range && W.hp > 0) {
          r.cd = WEAPONS.robot.cd * (.8 + Math.random() * .6);
          const dx = me.x - a.x, dy = me.y + 1.2 - (a.y + 1.4), dz = me.z - a.z, l = Math.hypot(dx, dy, dz) || 1;
          shoot({ w: 'robot', x: a.x + dx / l * .7, y: a.y + 1.4, z: a.z + dz / l * .7, dx: dx / l, dy: dy / l, dz: dz / l, robot: true });
        }
      }
    }
    function robotHurt(r, n){
      r.hp -= n;
      if (r.hp > 0) return;
      const a = rob.A.get(r.key); if (a) puff('confetti', a.x, a.y + 1.2, a.z);
      rob.remove(r.o); W.robots = W.robots.filter(x => x !== r);
      W.robotKills++;
      feed(`🤖 робот выбит (${W.robotKills})`);
      if (W.robotKills % 8 === 0 && root.D37Coins) root.D37Coins.run('mirwar', 5, 'mwbot:' + Date.now().toString(36)).then(r2 => { if (r2?.ok) toast(`🪙 +${r2.got ?? 5} — полигон пройден`, true); });
      drawScore();
    }
    // ── наёмники: за 🪙 (revive 'mirwar' — 30 🪙), до 2, идут за тобой и стреляют по роботам и врагам ──
    const mercN = E.npcs ? E.npcs(R, ph) : null;
    W.mercs = [];
    let mercSeq = 0;
    if (mercN) mercN.start({});
    async function hire(){
      if (!W.inZone) { toast('Наёмники служат только в Боевой зоне'); return; }
      if (W.mercs.length >= MERC.max) { toast(`У тебя уже ${MERC.max} наёмника — больше нельзя`); return; }
      if (!root.D37Coins) return;
      if (root.D37Coins.coins() < MERC.price) { toast(`Нужно ${MERC.price} 🪙 — заработай в играх или на работе в городе`, false); return; }
      const r = await root.D37Coins.revive('mirwar');
      if (!r?.ok) { toast(r?.reason === 'game' ? 'Наёмники заработают, когда сайт обновится' : r?.reason === 'coins' ? `Нужно ${MERC.price} 🪙` : 'Не получилось — попробуй ещё раз', false); return; }
      spawnMerc();
      toast(`🪖 Наёмник с тобой (−${MERC.price} 🪙). Он прикроет, пока ты в зоне`, true);
    }
    function spawnMerc(){
      if (!mercN) return;
      const me = S.P.ch, i = ++mercSeq, o = { id: 'mc' + i, pos: [me.x + 2, 0, me.z + 2], rot: [0, 0, 0], look: 'random', seed: 'merc' + (i % 7), act: 'follow', speed: 1.1, radius: 0, damage: 0, text: '' };
      mercN.add(o);
      W.mercs.push({ o, key: 'npc:' + o.seed, hp: MERC.hp, cd: 1 });
      rt.setZX({ m: W.mercs.length });
    }
    function dropMerc(m){ mercN?.remove(m.o); W.mercs = W.mercs.filter(x => x !== m); rt.setZX({ m: W.mercs.length || null }); }
    function mercHurt(m, n){ m.hp -= n; if (m.hp <= 0) { const p = mercPos(m); puff('confetti', p.x, p.y + 1.2, p.z); dropMerc(m); feed('🪖 наёмник выбыл'); } }
    const mercPos = m => { const a = mercN?.A.get(m.key); return a ? { x: a.x, y: a.y, z: a.z } : { x: 0, y: -99, z: 0 }; };
    function mercTick(dt){
      if (!mercN || !W.mercs.length) return;
      // отстал (телепорт, долго бежал) — догоняет сразу
      for (const m of W.mercs) { const e = mercN.list.get(m.o.id); if (e?.P && Math.hypot(e.P.ch.x - S.P.ch.x, e.P.ch.z - S.P.ch.z) > 26) e.P.place(S.P.ch.x + 2 - Math.random() * 4, S.P.ch.y, S.P.ch.z + 2 - Math.random() * 4); }
      mercN.step(dt, [S.P.ch]);
      for (const m of W.mercs) {
        const p = mercPos(m); m.cd -= dt;
        if (m.cd > 0) continue;
        let best = null, bd = WEAPONS.merc.range;
        for (const t of targets()) { const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < bd) { bd = d; best = t; } }
        if (!best) { m.cd = .4; continue; }
        m.cd = WEAPONS.merc.cd * (.9 + Math.random() * .3);
        const dx = best.x - p.x, dy = best.y + 1.2 - (p.y + 1.4), dz = best.z - p.z, l = Math.hypot(dx, dy, dz) || 1;
        shoot({ w: 'merc', x: p.x + dx / l * .7, y: p.y + 1.4, z: p.z + dz / l * .7, dx: dx / l, dy: dy / l, dz: dz / l, own: true, merc: true, mx: S.P.ch.x, mz: S.P.ch.z });
        W.out.f.push(['merc', r1(p.x), r1(p.y + 1.4), r1(p.z), r3(dx / l), r3(dy / l), r3(dz / l)]);
      }
    }
    // чужие наёмники: у владельца zx.m — рядом идут его бойцы (картинка, без урона — урон шлёт владелец)
    const remM = E.npcs ? E.npcs(R, ph) : null, remMap = new Map();
    if (remM) remM.start({});
    function remoteMercs(dt){
      if (!remM) return;
      for (const p of S.players.values()) {
        const want = W.inZone && !p.leaving && MZ.inRect(WZ, p.ch.x, p.ch.z) ? Math.min(MERC.max, p.zx?.m || 0) : 0;
        let L = remMap.get(p.key) || [];
        while (L.length < want) { const o = { id: 'rm' + p.key + L.length, pos: [p.ch.x + 1.5, 0, p.ch.z + 1.5], rot: [0, 0, 0], look: 'random', seed: 'merc' + ((p.key.length + L.length) % 7), act: 'follow', speed: 1.1, radius: 0, damage: 0, text: '', owner: p.key }; remM.add(o); L.push(o); }
        while (L.length > want) remM.remove(L.pop());
        if (L.length) remMap.set(p.key, L); else remMap.delete(p.key);
      }
      for (const [k, L] of remMap) if (!S.players.has(k)) { for (const o of L) remM.remove(o); remMap.delete(k); }
      // каждый идёт за своим владельцем
      for (const [k, L] of remMap) { const p = S.players.get(k); if (!p) continue; for (const o of L) { const e = remM.list.get(o.id); if (e?.P) { const ch = e.P.ch, d = Math.hypot(p.ch.x - ch.x, p.ch.z - ch.z); if (d > 40) e.P.place(p.ch.x + 1.5, null, p.ch.z + 1.5); } } }
      remM.step(dt, [...[...remMap.keys()].map(k => S.players.get(k)?.ch).filter(Boolean)]);
    }
    // ── брызги (общие эмиттеры: место меняется перед вспышкой) ──
    const puffs = {};
    function puff(kind, x, y, z, color){
      const FX = S.FX; if (!FX) return;
      let e = puffs[kind + (color || '')];
      if (!e) e = puffs[kind + (color || '')] = FX.emitter({ kind, at: [0, -99, 0], rate: 0, color, color2: color, size: .7 });
      e.set({ at: [x, y, z] }); e.burst(kind === 'confetti' ? 18 : 12);
    }
    // ── окна: режим, правила, оружейная ──
    function board(){
      const M0 = MODES[W.mode];
      H.panel('<span class="wld-pe">⚔️</span><b>Режим боя</b>', `<p>Сейчас: <b>${M0[0]} ${esc(M0[1])}</b>. Голосуй — режим сменится в начале следующего раунда (раунд — 5 минут).</p><div class="wld-acts">${Object.entries(MODES).map(([id, m]) => `<button type="button"${W.votes[S.key] === id ? ' class="ct-start"' : ''} data-mz="w:vote:${id}">${m[0]} ${esc(m[1])}</button>`).join('')}</div>${W.mode !== 'ffa' ? `<p>Твоя команда: ${W.team === 1 ? '🟥 Красные' : W.team === 2 ? '🟦 Синие' : '—'}</p><div class="wld-acts"><button type="button" data-mz="w:team:1">🟥 За красных</button><button type="button" data-mz="w:team:2">🟦 За синих</button></div>` : ''}<p><small>Награда за раунд: до 20 🪙 и XP за победу (лимиты сайта). Выбитых — без крови: только пена и краска.</small></p>`);
    }
    function rules(){
      H.panel('<span class="wld-pe">⚠️</span><b>Боевая зона · 12+</b>', `<p>Здесь можно сражаться мультяшным оружием — только внутри ограды. Вышел за ворота — бой закончился, оружие убрано.</p>
        <p>🔫 1 — пенный бластер, 🎯 2 — пейнтбол, 💧 3 — водяная бомба, 🗡️ 4 — поролоновый меч, 🫧 5 — щит-пузырь. F, правый курок или 👊 — огонь.</p>
        <p>Выбили — через 5 с снова в бою (3 с защиты). Режимы: каждый сам за себя, команды, захват точек 🚩 A·B·C.</p>
        <p>Наёмники — в палатке у КПП (30 🪙, до 2). Вокруг центра — 12 участков военных баз 🏯: у таблички свободного участка основай свою базу и стань главарём (кнопка 🏯 — меню базы). Бункер — под землёй в центре (лестница с востока), порт — на юго-западе, аэродром — на юге, вертолёты — в лагере у КПП.</p>`);
    }
    // участок военной базы: что будет (систему баз делает агент набегов — здесь только разметка)
    function plotInfo(P){
      H.panel(`<span class="wld-pe">🏯</span><b>${esc(P.name)} · участок ${esc(P.code)}</b>`, `<p>Участок военной базы: ${P.cells} × ${P.cells} клетки по ${String(P.cell).replace('.', ',')} м${P.coast ? ', свой берег — под доки и корабли' : ', причал в порту'}, стоянка на аэродроме, место под подвал и бункер.</p>
        <p>Основай базу и стань главарём: зови друзей ссылкой (офицеры и бойцы), строй казарму, оборону, гараж, вертолётную площадку, ангар, причал, бункер. Набеги — на другие базы (⚔️ «Набеги»).</p>
        <p><small>Военные базы откроются, когда сайт обновится.</small></p>`);
    }
    function armory(){ if (!W.inZone) return; W.hp = HP; rt.setZX({ h: 10 }); drawHud(); toast('🩹 Аптечка: ❤️ 100. Заряд полный!', true); rt.sfx('pickup'); }
    function click(a){
      if (!a.startsWith('w:')) return false;
      const [, cmd, v] = a.split(':');
      if (cmd === 'slot') { setSlot(+v || 0); return true; }
      if (cmd === 'vote') { W.votes[S.key] = v; csend({ t: 'mv', mode: v }); toast(`🗳️ Голос за «${MODES[v][1]}» — со следующего раунда`); board(); return true; }
      if (cmd === 'team') { W.team = +v === 2 ? 2 : 1; rt.setZX({ r: W.team === 1 ? 'red' : 'blue', t: W.team }); H.closePops(); toast(W.team === 1 ? '🟥 Ты за красных' : '🟦 Ты за синих', true); return true; }
      return false;
    }
    // ── полоски жизней над бойцами (кроме меня) ──
    const bars = new Map();
    function drawBars(){
      for (const p of S.players.values()) {
        let el = bars.get(p.key);
        const show = W.inZone && !p.leaving && p.zx?.h != null && MZ.inRect(WZ, p.ch.x, p.ch.z) && Math.hypot(p.ch.x - S.P.ch.x, p.ch.z - S.P.ch.z) < 34;
        if (!show) { if (el) el.style.display = 'none'; continue; }
        if (!el) { el = document.createElement('div'); el.className = 'mb-tag'; el.innerHTML = '<i><u></u></i>'; rt.q('.mz-tags').appendChild(el); bars.set(p.key, el); }
        const [sx, sy, vis] = R.project(p.ch.x, p.ch.y + 2.9, p.ch.z);
        if (!vis) { el.style.display = 'none'; continue; }
        el.style.display = ''; el.style.transform = `translate(${Math.round(sx)}px,${Math.round(sy)}px) translate(-50%,-100%)`;
        el.firstChild.firstChild.style.width = (p.zx.h * 10) + '%';
        el.style.borderColor = p.zx.t === 1 ? '#ef4444' : p.zx.t === 2 ? '#3b82f6' : 'transparent';
      }
      for (const [k, el] of bars) if (!S.players.has(k)) { el.remove(); bars.delete(k); }
    }
    // ── щиты-пузыри (свой и чужие: zx.sh) ──
    const bubbleM = new T.MeshStandardMaterial({ color: '#a5f3fc', transparent: true, opacity: .28, roughness: .1, depthWrite: false }); R.own.push(bubbleM);
    const bubG = new T.SphereGeometry(1.5, 16, 12); R.own.push(bubG);
    const bubbles = new Map();
    function drawBubbles(){
      const L = [[S.key, rt.zx.sh, S.P.ch], ...[...S.players.values()].map(p => [p.key, p.zx?.sh, p.ch])];
      for (const [k, on, ch] of L) {
        let m = bubbles.get(k);
        if (!on) { if (m) { R.scene.remove(m); bubbles.delete(k); } continue; }
        if (!m) { m = new T.Mesh(bubG, bubbleM); m.renderOrder = 3; R.scene.add(m); bubbles.set(k, m); }
        m.position.set(ch.x, ch.y + 1.2, ch.z);
      }
    }
    // ── шаг ──
    let netT = 0, scoreT = 0, layT = 0, crossEl = null;
    const mod = {
      update(dt){
        const ch = S.P.ch, inside = MZ.inRect(WZ, ch.x, ch.z, -1) && MZ.gateOf(WZ).ok;
        if (inside !== W.inZone) { if (inside) enter(); else leave(); }
        if (W.inZone) {
          const C = S.C;
          for (let i = 0; i < SLOTS.length; i++) if (C?.down('slot' + (i + 1))) setSlot(i);
          if (C && (C.held('attack') || (S.I?.locked && C.heldRaw?.('attack'))) && !S.menu && !S.phoneOn && !rt.veh?.driving?.()) fire();   // за рулём не стреляют (пассажир — может)
          if (W.down && nowMs() >= W.down) respawn();
          if (!W.down && W.hp < HP && nowMs() - W.lastHit > 6000) { W.hp = Math.min(HP, W.hp + dt * 4); const hb = Math.ceil(W.hp / 10); if (hb !== rt.zx.h) rt.setZX({ h: hb }); drawHud(); }
          robotTick(dt); mercTick(dt);
          refTick(dt);
          if (W.round.end && nowMs() >= W.round.end) roundEnd();
          // пачка боя: не чаще 4 раз в секунду
          netT -= dt;
          if (netT <= 0 && (W.out.f.length || W.out.h.length)) { netT = .25; csend({ t: 'c', f: W.out.f.splice(0, 6), h: W.out.h.splice(0, 8) }); W.out.f.length = 0; }
          scoreT -= dt; if (scoreT <= 0) { scoreT = 1; drawScore(); }
          layT -= dt; if (layT <= 0) { layT = 2; layoutHud(); }   // кнопки телефона могли поменяться (размер в ⚙️, полный экран)
        } else if (W.robots.length) robotTick(dt);
        remoteMercs(dt);
        stepShots(dt);
      },
      frame(dt, t){
        const cam = R.camera.position;
        rob?.frame(dt, t, cam); mercN?.frame(dt, t, cam); remM?.frame(dt, t, cam);
        if (mercN?.A) for (const a of mercN.A.list.values()) rt.dress(a, ROLES_W.ffa);
        if (remM?.A) for (const a of remM.A.list.values()) rt.dress(a, ROLES_W.ffa);
        let n = 0;
        for (const s of shots) { const WP = WEAPONS[s.w]; mx.makeScale(WP.size, WP.size, WP.size); mx.setPosition(s.x, s.y, s.z); pMesh.setMatrixAt(n, mx); col.set(WP.color); pMesh.setColorAt(n, col); n++; }
        pMesh.count = n; pMesh.instanceMatrix.needsUpdate = true; if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;
        drawBars(); drawBubbles();
        const cx0 = crossEl || (crossEl = hq('.mz-cross')), hide = !W.inZone || !!W.down; if (cx0.hidden !== hide) cx0.hidden = hide;
      },
      remote(p, z, was){ if (was?.h > 0 && z?.h === 0 && W.inZone) puff('confetti', p.ch.x, p.ch.y + 1.2, p.ch.z); },
      area(){},
      click, onMsg: () => false,
      marks(){ return W.inZone ? POINTS.map((P, i) => ({ icon: W.pts[i].own === 1 ? '🟥' : W.pts[i].own === 2 ? '🟦' : '🚩', x: P.x, z: P.z })) : []; },
      esc(){ return false; },
      shown(){},
      stop(){
        leaveChannel(); clearTimeout(W.leaveT);
        rob?.stop(); rob?.dispose(); mercN?.stop(); mercN?.dispose(); remM?.stop(); remM?.dispose();
        R.scene.remove(pMesh); for (const e of Object.values(puffs)) e.dispose();
        for (const m of bubbles.values()) R.scene.remove(m);
        hud.remove(); for (const el of bars.values()) el.remove();
        root.removeEventListener('resize', onResize);
        if (W.inZone) touchButtons(false);
      },
      _: { W, claimOk, fire, setSlot, takeDamage, hire, spawnMerc, newRound },
    };
    return mod;
  }

  root.MirWar = { WEAPONS, SLOTS, MODES, POINTS, SPAWNS, VEH, MERC, ROBOT, HP, RESPAWN, PROTECT, ROUND, CAP_R, CAP_T, CAP_WIN, claimOk, splashDmg, capStep, reward, teamFor, ROLES_W,
    PLOTS, CELL, CELLS, CENTER, CAMP, PORT, AIR, BERTHS, PIERS, W_ROADS, inPlot };
})();
