// ═══════════════════════════════════════
//  «МИР ДЕНЧИКА»: ЗОНЫ — лобби с телепортами, дороги, карта мира (M и телефон 📱), подгрузка зон рядом с игроком,
//  возрастные ворота (12+ / 18+), общее для городов и боевой зоны: здания, склейка, роли, действия, награды
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
  // ── Возраст зон. Большой город — 18+; владелец может поставить 16 (одна цифра) ──
  const ADULT_AGE = 18;
  const WAR_AGE = 12;

  // ═══ Зоны (прямоугольники) ═══
  const ZONES = {
    kids: { id: 'kids', name: 'Солнечный городок', short: 'Детский город', icon: '🧸', age: 0, x0: 110, x1: 250, z0: -80, z1: 40, color: '#facc15',
      entry: { x: 118, z: -24, yaw: PI / 2 }, gate: { x: 110, z: -24 }, sub: 'Детский город: работы, школа, питомцы, игровая площадка' },
    metro: { id: 'metro', name: 'Большой город', short: 'Город', icon: '🏙️', age: ADULT_AGE, x0: 90, x1: 270, z0: 100, z1: 260, color: '#60a5fa',
      entry: { x: 98, z: 130, yaw: PI / 2 }, gate: { x: 90, z: 130 }, sub: 'Город для взрослых: работы с зарплатой, полиция и грабители, банк, бизнес' },
    war: { id: 'war', name: 'Боевая зона', short: 'Боевая зона', icon: '🪖', age: WAR_AGE, x0: -340, x1: -70, z0: 100, z1: 400, color: '#ef4444',
      entry: { x: -84, z: 130, yaw: -PI / 2 }, gate: { x: -70, z: 130 }, sub: 'Мультяшный бой: база, бункер, порт, аэродром, наёмники' },
  };
  const ZLIST = [ZONES.kids, ZONES.metro, ZONES.war];
  // Под рост района участков (агент набегов: участки 32×32 кольцами, 4 на улицу) — здесь ничего своего не строим; край мира — шире
  const RESERVE = { x0: -133, x1: -12, z0: -137, z1: -12 };
  // Море и бункер боевой зоны: дыры в земле, дно (ph.terrain) и вода (ph.waterLevel) — нужны миру сразу, до подгрузки зоны
  const SEA = { x0: -420, x1: -262, z0: 112, z1: 396, wl: -.55, floor: -7 };
  const BUNKER = { x0: -186, x1: -160, z0: 176, z1: 198, floor: -5.4, roof: -.35 };
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
    ['gates', '🧟', 'Ворота «Орда», «Арена», «Башни»', 43, 32, 47, 32],
    ['district', '🏘️', 'Район участков', -10.4, -13.6, -11.8, -24],   // у арки со стороны площади (за аркой — район, он растёт)
    ['kids', '🧸', 'Солнечный городок', ZONES.kids.entry.x, ZONES.kids.entry.z, 140, -24, 'kids'],
    ['metro', '🏙️', 'Большой город', ZONES.metro.entry.x, ZONES.metro.entry.z, 130, 130, 'metro'],
    ['war', '🪖', 'Боевая зона', ZONES.war.entry.x, ZONES.war.entry.z, -110, 130, 'war'],
  ];
  const STUDIO = { id: 'studio', icon: '🧱', name: 'Студия 3D — свой мир' };

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
  const groundRect = () => { const [x0, z0, x1, z1] = bounds(); return [x0 - 220, z0 - 220, x1 + 220, z1 + 220]; };
  // Деревья и трава мира — не на дорогах, телепортах и в зонах
  const blocked = (x, z) => ZLIST.some(Z => inRect(Z, x, z, 6)) || inRect(RESERVE, x, z) || roadDist(x, z) < 4 || PADS.some(p => Math.hypot(p.x - x, p.z - z) < 2.2);
  // Холм на горизонте: только целиком за краем мира (иначе — насквозь проходимая гора посреди зоны)
  const hillOk = (x, z, r) => { const [x0, z0, x1, z1] = bounds(); return x + r < x0 || x - r > x1 || z + r < z0 || z - r > z1; };
  // Рельеф зон: море (дно SEA.floor, у берега отвесная набережная) и бункер (пол ниже земли)
  const terrain = (x, z) => inRect(SEA, x, z) ? SEA.floor : inRect(BUNKER, x, z) ? BUNKER.floor : 0;
  const water = (x, z) => inRect(SEA, x, z) ? SEA.wl : -Infinity;
  // Возрастные ворота: { ok } | { ok: false, why: 'unknown' | 'young' }
  function gateOf(Z, A = root.D37Age){
    if (!Z || !Z.age || !A) return { ok: true };
    if (!A.known()) return { ok: false, why: 'unknown' };
    return A.canOpen(Z.age) ? { ok: true } : { ok: false, why: 'young' };
  }

  // ═══ Роли и действия (их дают файлы зон): ROLES[id] = { icon, name, zone, hat, vest, color, pay } ═══
  const DEFS = {}, ROLES = {};
  const def = (id, d) => { DEFS[id] = d; for (const [k, r] of Object.entries(d.roles || {})) ROLES[k] = { ...r, id: k, zone: id }; return d; };

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
    // зоны
    for (const Z of ZLIST) { rr(Z, Z.id === 'war' ? '#8a7f5a' : Z.id === 'kids' ? '#7fc96a' : '#8b95a6', .9); g.strokeStyle = Z.color; g.lineWidth = Math.max(1.5, sc * 1.2); g.strokeRect(sx(Z.x0), sz(Z.z0), (Z.x1 - Z.x0) * sc, (Z.z1 - Z.z0) * sc); }
    rr(SEA, '#2f7fc1');
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
    for (const d of Object.values(DEFS)) for (const f of d.footprints || []) foot(f[0], f[1], f[2], f[3], f[4]);
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
  function merge(R, grp, o = {}){
    const T = R.T, M = sharedMats(R), low = R.q === 'low', CH = o.chunk || 0;
    grp.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(grp.matrixWorld).invert(), m4 = new T.Matrix4(), sph = new T.Sphere();
    const buckets = new Map(), drop = [];
    grp.traverse(x => {
      if (!x.isMesh || x.isInstancedMesh || x.userData.dyn || x.userData.mzOwn) return;
      for (let p = x.parent; p && p !== grp; p = p.parent) if (p.userData.dyn) return;
      const mat = x.material; if (Array.isArray(mat)) return;
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
      b.list.push({ g, c: mat.color }); b.n += g.attributes.position.count;
      drop.push(x);
    });
    const out = [];
    for (const b of buckets.values()) {
      const pos = new Float32Array(b.n * 3), nor = new Float32Array(b.n * 3), col = b.plain ? new Float32Array(b.n * 3) : null, uv = b.plain ? null : new Float32Array(b.n * 2);
      const tile = !b.plain && b.mat.userData?.tile;
      let k = 0;
      for (const { g, c } of b.list) {
        const gp = g.attributes.position, gn = g.attributes.normal, gu = g.attributes.uv;
        pos.set(gp.array, k * 3); if (gn) nor.set(gn.array, k * 3);
        for (let i = 0; i < gp.count; i++) {
          if (col) {
            const ny = gn ? gn.getY(i) : 1, a = b.glow || Math.abs(ny) >= .6 || low || o.ao === false ? 1 : .62 + .38 * Math.min(1, Math.max(0, gp.getY(i) / 1.4));
            col[(k + i) * 3] = c.r * a; col[(k + i) * 3 + 1] = c.g * a; col[(k + i) * 3 + 2] = c.b * a;
          } else if (tile && gn) boxUV(gp.getX(i), gp.getY(i), gp.getZ(i), gn.getX(i), gn.getY(i), gn.getZ(i), tile, uv, k + i);
          else if (gu) { uv[(k + i) * 2] = gu.getX(i); uv[(k + i) * 2 + 1] = gu.getY(i); }
        }
        k += gp.count; g.dispose();
      }
      const mg = new T.BufferGeometry();
      mg.setAttribute('position', new T.BufferAttribute(pos, 3)); mg.setAttribute('normal', new T.BufferAttribute(nor, 3));
      if (col) mg.setAttribute('color', new T.BufferAttribute(col, 3)); else mg.setAttribute('uv', new T.BufferAttribute(uv, 2));
      mg.computeBoundingSphere();
      const mesh = new T.Mesh(mg, b.plain ? (b.glow ? M.glow : M.std) : b.mat);
      mesh.userData.mzOwn = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      if (!low) { mesh.castShadow = !b.glow && !b.mat.transparent && !b.mat.userData?.noCast; mesh.receiveShadow = !b.glow; }
      if (b.mat.transparent) mesh.renderOrder = 2;
      grp.add(mesh); out.push(mesh);
    }
    for (const x of drop) x.parent?.remove(x);
    return out;
  }
  const disposeOwn = grp => grp.traverse(x => { if (x.isMesh && x.userData.mzOwn) x.geometry.dispose(); });

  // ═══ Надписи: один холст на зону (атлас) — все вывески одной сеткой ═══
  function atlas(R, size = 1024){
    const T = R.T, c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); let x = 0, y = 0, rowH = 0;
    const quads = [], A = {};
    A.add = (text, o = {}) => {
      const w = o.w || 512, h = o.h || 96;
      if (x + w > size) { x = 0; y += rowH + 2; rowH = 0; }
      if (y + h > size) return null;   // место кончилось — без надписи
      g.fillStyle = o.bg || '#7c3aed'; g.fillRect(x, y, w, h);
      if (o.border !== false) { g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 4; g.strokeRect(x + 3, y + 3, w - 6, h - 6); }
      g.fillStyle = o.fg || '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = h * .56; g.font = `900 ${fs}px Montserrat, Arial, sans-serif`;
      while (g.measureText(text).width > w * .9 && fs > 10) { fs -= 2; g.font = `900 ${fs}px Montserrat, Arial, sans-serif`; }
      g.fillText(text, x + w / 2, y + h / 2 + 2);
      const r = { u0: x / size, v0: 1 - (y + h) / size, u1: (x + w) / size, v1: 1 - y / size };
      x += w + 2; rowH = Math.max(rowH, h);
      return r;
    };
    // табличка в мире: центр (px, py, pz), размер ww × hh, поворот yaw (лицом к +z при yaw 0)
    A.quad = (r, px, py, pz, ww, hh, yaw = 0) => { if (r) quads.push({ r, px, py, pz, ww, hh, yaw }); };
    A.sign = (text, px, py, pz, ww, hh, yaw, o) => A.quad(A.add(text, o), px, py, pz, ww, hh, yaw);
    A.mesh = () => {
      if (!quads.length) return null;
      const pos = new Float32Array(quads.length * 18), uv = new Float32Array(quads.length * 12), nor = new Float32Array(quads.length * 18);
      quads.forEach((q, i) => {
        const c = Math.cos(q.yaw), s = Math.sin(q.yaw), hw = q.ww / 2, hh = q.hh / 2;
        const P = (lx, ly) => [q.px + lx * c, q.py + ly, q.pz - lx * s];
        const v = [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, -hh), P(hw, hh), P(-hw, hh)];
        const t = [[q.r.u0, q.r.v0], [q.r.u1, q.r.v0], [q.r.u1, q.r.v1], [q.r.u0, q.r.v0], [q.r.u1, q.r.v1], [q.r.u0, q.r.v1]];
        for (let k = 0; k < 6; k++) { pos.set(v[k], i * 18 + k * 3); uv.set(t[k], i * 12 + k * 2); nor.set([s, 0, c], i * 18 + k * 3); }
      });
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
      geo.computeBoundingSphere();
      const tex = new T.CanvasTexture(c); tex.encoding = T.sRGBEncoding; tex.anisotropy = 4;
      const mat = new T.MeshBasicMaterial({ map: tex, toneMapped: false });   // одна сторона: с изнанки — своя табличка
      R.own.push(tex, mat);
      const m = new T.Mesh(geo, mat); m.userData.mzOwn = true; m.userData.dyn = true;
      return m;
    };
    return A;
  }

  // ═══ Набор для постройки содержимого зоны (K): детали в текущую группу, тела, здания, мебель, места, жители ═══
  function kit(rt, zs, grp){
    const { R, ph, X } = rt, T = R.T, E = root.D37E, low = R.q === 'low';
    const K = { R, T, ph, X, E, rt, zs, Z: zs.Z, root: grp, cur: null, low, bodies: [], items: [], npcs: [], roofs: [], seats: [], anims: [] };
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
      if (o.solid) K.bodies.push(ph.addBox({ x, y: y0 + h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, yaw: o.yaw || 0, tag: o.tag || 'zone', data: o.data ?? { cam: !!o.cam, floor: o.floor } }));
      return m;
    };
    K.cyl = (x, y0, z, r, h, c, o = {}) => {
      const m = P({ s: 'cyl', x, y: y0 + h / 2, z, r, r2: o.r2, h, c, seg: o.seg || 12, m: o.m, rx: o.rx, rz: o.rz, yaw: o.yaw });
      if (o.solid) K.bodies.push(ph.addCyl({ x, z, y: y0 + h / 2, r: o.pr || r, hy: h / 2, tag: o.tag || 'zone', data: o.data ?? { floor: o.floor } }));
      return m;
    };
    K.flat = (x, z, w, d, c, y = .03, o = {}) => P({ s: 'box', x, y: y + .005, z, w, h: .01, d, c, m: o.m, yaw: o.yaw });
    K.body = o => { const b = ph.addBox({ tag: 'zone', ...o }); K.bodies.push(b); return b; };
    K.wedge = o => { const b = ph.addWedge({ tag: 'zone', ...o }); K.bodies.push(b); return b; };
    K.group = (x = 0, y = 0, z = 0, yaw = 0, parent) => { const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = yaw; (parent || K.cur || grp).add(g); return g; };
    // готовые предметы движка (дерево, фонарь, скамейка…) — в текущую группу
    K.prefab = (name, o) => R.prefab(name, { ...o, parent: K.cur || grp }, ph);
    K.tree = (x, z, k = 1, v = 0) => K.prefab(v < 0 ? 'pine' : 'tree', { x, z, k, v: Math.max(0, v), yaw: (x * 7 + z * 3) % 6 });
    // фонарь без ореола-спрайта (спрайт — отдельный вызов отрисовки на каждый; светится шар — свечение постобработки)
    K.lamp = (x, z) => {
      P({ s: 'cyl', x, y: 1.5, z, r: .1, r2: .07, h: 3, c: '#2d2a3a', seg: 8 }); P({ s: 'cyl', x, y: .06, z, r: .22, h: .12, c: '#2d2a3a', seg: 10 });
      P({ s: 'ball', x, y: 3.1, z, r: .26, c: '#fff3b0', m: 'glow', seg: 10 }); P({ s: 'cone', x, y: 3.38, z, r: .32, h: .22, c: '#2d2a3a', seg: 10 });
      K.bodies.push(ph.addCyl({ x, z, y: 1.5, r: .16, hy: 1.5, tag: 'lamp' }));
    };
    K.label = atlas(R);
    // взаимодействие (X) — запоминаем, чтобы зона могла выключать
    K.item = it => { const x = X.add(it); K.items.push(x); return x; };
    // место: сесть / лечь (своё — без presence; другим — через zx: a + sl)
    K.seat = (x, y, z, yaw, o = {}) => { const sp = { x, y, z, yaw, bed: !!o.bed, name: o.name || (o.bed ? 'Лечь спать' : 'Сесть') }; K.seats.push(sp); K.item({ x, y: y + .5, z, r: o.bed ? 1.1 : .5, prompt: () => rt.seatPrompt(sp), act: () => rt.sitDown(sp) }); return sp; };
    // житель: появляется, пока зона видна
    // o: { id, name, x, z, yaw (градусы), look, seed, act, radius, speed, say: [фразы] } → объект npc.js
    K.npc = o => {
      const n = { id: 'mz_' + o.id, name: o.name, cls: 'NPC', pos: [o.x, o.y || 0, o.z], rot: [0, o.yaw || 0, 0], look: o.look || 'random', seed: o.seed || o.id, act: o.act || 'idle',
        speed: o.speed ?? 1, radius: o.radius ?? 0, damage: 0, text: (o.say || [])[0] || '', say: o.say || [], phone: o.phone ? 1 : 0, _mz: true, mz: o };
      K.npcs.push(n); return n;
    };
    // ── Здание: пол, стены с проёмами (двери, окна), крыша (своя сетка — прячется, когда внутри), зона «внутри», вывеска ──
    // spec: { id, name, x, z, w, d, h, wall, trim, floor, floorM, roofC, doors: [{ side, at, w }], windows: [{ side, at, w }], sign, signBg, interior }
    K.building = spec => {
      const H = spec.h || 3.8, t = .3, x0 = spec.x, z0 = spec.z, hw = spec.w / 2, hd = spec.d / 2;
      const wallC = spec.wall || '#f4e3c3', trim = spec.trim || '#7c2d12';
      K.box(x0, 0, z0, spec.w, .12, spec.d, spec.floor || '#c79a6b', { solid: true, floor: spec.floorType || 'wood', m: spec.floorM || (spec.interior === false ? undefined : K.M.parquet) });
      for (const side of ['n', 's', 'e', 'w']) {
        const horiz = side === 'n' || side === 's', L = horiz ? spec.w : spec.d;
        const ops = [...(spec.doors || []).filter(d => d.side === side).map(d => ({ at: d.at || 0, w: d.w || 2.6, y0: 0, y1: d.h || 2.9, door: true })),
          ...(spec.windows || []).filter(w => w.side === side).map(w => ({ at: w.at || 0, w: w.w || 2, y0: 1.1, y1: 1.1 + (w.h || 1.4) }))].sort((a, b) => a.at - b.at);
        const put = (a, b, y0, y1, glass) => {
          if (b - a < .02 || y1 - y0 < .02) return;
          const c = (a + b) / 2, len = b - a;
          const wx = horiz ? x0 + c : x0 + (side === 'e' ? hw : -hw), wz = horiz ? z0 + (side === 's' ? hd : -hd) : z0 + c;
          if (glass) { P({ s: 'box', x: wx, y: (y0 + y1) / 2, z: wz, w: horiz ? len : .06, h: y1 - y0, d: horiz ? .06 : len, m: K.M.glass }); K.body({ x: wx, y: (y0 + y1) / 2, z: wz, hx: horiz ? len / 2 : t / 2, hy: (y1 - y0) / 2, hz: horiz ? t / 2 : len / 2, tag: 'glass', data: { cam: false } }); return; }
          K.box(wx, y0, wz, horiz ? len : t, y1 - y0, horiz ? t : len, wallC, { solid: true, cam: true });
        };
        let a = -L / 2;
        for (const p of ops) {
          const l = p.at - p.w / 2, r = p.at + p.w / 2;
          put(a, l, 0, H); put(l, r, p.y1, H);
          if (!p.door) { put(l, r, 0, p.y0); put(l, r, p.y0, p.y1, true); }
          else for (const sx of [l - .07, r + .07]) { const fx = horiz ? x0 + sx : x0 + (side === 'e' ? hw : -hw), fz = horiz ? z0 + (side === 's' ? hd : -hd) : z0 + sx; P({ s: 'box', x: fx, y: p.y1 / 2, z: fz, w: horiz ? .14 : t + .1, h: p.y1, d: horiz ? t + .1 : .14, c: trim }); }
          a = r;
        }
        put(a, L / 2, 0, H);
      }
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P({ s: 'box', x: x0 + sx * hw, y: (H + .1) / 2, z: z0 + sz * hd, w: .45, h: H + .1, d: .45, c: trim });
      // крыша: своя группа (прячется изнутри) — плоская с бортиком; тело есть (залезть можно), камеру не держит
      const roof = K.group(x0, 0, z0, 0, grp); roof.userData.dyn = true;
      const rc = spec.roofC || '#7a5236', rc2 = spec.roofC2 || trim;
      R.part(roof, { s: 'box', y: H + .12, w: spec.w + .6, h: .24, d: spec.d + .6, c: rc });
      for (const [w, d, x, z] of [[spec.w + .6, .3, 0, -(spec.d + .6) / 2], [spec.w + .6, .3, 0, (spec.d + .6) / 2], [.3, spec.d + .6, -(spec.w + .6) / 2, 0], [.3, spec.d + .6, (spec.w + .6) / 2, 0]]) {
        R.part(roof, { s: 'box', x, z, y: H + .45, w, h: .42, d, c: rc2 });
        K.body({ x: x0 + x, z: z0 + z, y: H + .45, hx: w / 2, hy: .21, hz: d / 2, tag: 'roof', data: { cam: false } });
      }
      K.body({ x: x0, z: z0, y: H + .12, hx: (spec.w + .6) / 2, hy: .12, hz: (spec.d + .6) / 2, tag: 'roof', data: { cam: false } });
      if (spec.interior !== false) {
        K.roofs.push(roof);
        K.body({ x: x0, z: z0, y: H / 2, hx: hw - .3, hy: H / 2 + .3, hz: hd - .3, trigger: true, tag: 'room', data: { room: spec.id, roof } });
      }
      // вывеска над первой дверью (в атлас зоны)
      if (spec.sign) {
        const d = (spec.doors || [])[0], side = d?.side || 's', sw = Math.min(spec.w - 1, 7);
        const px = side === 'e' ? x0 + hw + .2 : side === 'w' ? x0 - hw - .2 : x0 + (d?.at || 0), pz = side === 's' ? z0 + hd + .2 : side === 'n' ? z0 - hd - .2 : z0 + (d?.at || 0);
        const yaw = side === 's' ? 0 : side === 'n' ? PI : side === 'e' ? PI / 2 : -PI / 2;
        K.label.sign(spec.sign, px, Math.min(H - .45, (d?.h || 2.9) + .55), pz, sw, sw / 5.3, yaw, { bg: spec.signBg || trim });
      }
      return { x0, z0, hw, hd, H, roof };
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
    K.bench = (x, z, yaw) => { K.prefab('bench', { x, z, yaw, m: K.M.planks }); for (const s of [-1, 1]) K.seat(x + Math.cos(yaw) * .55 * s, .62, z - Math.sin(yaw) * .55 * s, yaw, { name: 'Сесть на скамейку' }); };
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
      P({ s: 'box', x: cx, y: .025, z: cz, w, h: .02, d: L, yaw, m: K.M.asphalt });
      if (o.walk !== false) for (const s of [-1, 1]) {
        const ox = Math.cos(yaw) * (w / 2 + 1.3) * s, oz = -Math.sin(yaw) * (w / 2 + 1.3) * s;
        P({ s: 'box', x: cx + ox, y: .07, z: cz + oz, w: 2.6, h: .14, d: L, yaw, m: K.M.walk });
      }
      if (o.lines !== false) for (let k = 4; k < L - 4; k += 5) P({ s: 'box', x: x1 + dx * k / L, y: .04, z: z1 + dz * k / L, w: .22, h: .01, d: 2, yaw, c: '#f1f5f9' });
    };
    K.zebra = (x, z, w, yaw = 0) => { for (let i = 0; i < 7; i++) { const o = -w / 2 + .6 + i * (w - 1.2) / 6; P({ s: 'box', x: x + Math.cos(yaw) * o, y: .045, z: z - Math.sin(yaw) * o, w: .5, h: .01, d: 3, yaw, c: '#f8fafc' }); } };
    // кусок готов — склеить (группа куска — новый ребёнок корня)
    K.chunk = name => { if (K.cur) K.flush(); K.cur = new T.Group(); K.cur.name = name || ''; grp.add(K.cur); return K.cur; };
    K.flush = () => { if (!K.cur) return; merge(R, K.cur, { chunk: 64 }); K.cur = null; };
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
      for (const f of D?.footprints || []) if (f[5] !== 0) R.part(g, { s: 'box', x: f[0], y: (f[5] || 4) / 2, z: f[1], w: f[2], h: f[5] || 4, d: f[3], c: f[4] });
      merge(R, g, { chunk: 0 });
      proxies[Z.id] = g;
    }
    BUILT = { pads, proxies, R };
    return BUILT;
  }
  // Земля шире и с дырами (море, бункер) — крючок в постройке земли mir.js
  function groundHoles(T, shape){
    for (const r of [SEA, BUNKER]) {
      const h = new T.Path();
      h.moveTo(r.x0, -r.z1); h.lineTo(r.x1, -r.z1); h.lineTo(r.x1, -r.z0); h.lineTo(r.x0, -r.z0); h.lineTo(r.x0, -r.z1);
      shape.holes.push(h);
    }
  }

  // ═══ Игра: подгрузка зон, ворота, телепорты, карта, роли, действия, сеть ═══
  // от края зоны: строить (по кусочку за кадр) — ближе LOAD_D, показывать — ближе SHOW_D, прятать — дальше HIDE_D (дальше — силуэт)
  const LOAD_D = 105, SHOW_D = 85, HIDE_D = 115;
  function start(S, H){
    const E = root.D37E, R = S.R, T = R.T, ph = S.ph, X = S.X;
    const rt = { S, H, R, T, ph, X, E, zones: new Map(), area: null, zx: {}, zxSig: '', mods: [], t: 0, stopped: false, safe: null, modal: null, gateFor: null };
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
    function beginBuild(zs){
      if (zs.it || zs.built || !zs.D?.build) return;
      const grp = new T.Group(); grp.name = 'mz-' + zs.Z.id; grp.visible = false; R.scene.add(grp);
      zs.grp = grp; zs.K = kit(rt, zs, grp);
      zs.it = zs.D.build(zs.K);
    }
    function stepBuild(zs, budget){
      const t0 = now();
      while (zs.it && now() - t0 < budget) {
        let r;
        try { r = zs.it.next(); } catch (e) { console.error('зона', zs.Z.id, e); r = { done: true }; }
        if (r.done) finishBuild(zs);
      }
    }
    function finishBuild(zs){
      const K = zs.K;
      zs.it = null;
      K.flush();
      merge(R, zs.grp, { chunk: 64 });   // что строилось не в кусках — тоже склеить
      for (const roof of K.roofs) { merge(R, roof, { chunk: 0 }); R.shadowsOn?.(roof); }
      const lm = K.label.mesh(); if (lm) zs.grp.add(lm);
      zs.built = true;
      R.shadowDirty?.();
      try { zs.mod = zs.D.start?.(rt, K) || null; } catch (e) { console.error(e); }
      if (!rt.mods.includes(zs)) rt.mods.push(zs);
    }
    // построить сразу (телепорт в зону): кусочками с ожиданием кадра, пока не готово
    rt.buildNow = zs => new Promise(res => {
      beginBuild(zs);
      const tick = () => { if (rt.stopped) return res(false); stepBuild(zs, 24); if (zs.built || !zs.it) res(true); else setTimeout(tick, 0); };
      tick();
    });
    function setShown(zs, on){
      zs.shown = on;
      if (zs.grp) zs.grp.visible = on;
      if (zs.proxy) zs.proxy.visible = !on;
      R.shadowDirty?.();
      // жители — только пока видно
      if (on && !zs.npcOn && S.NPC) { for (const o of zs.K.npcs) S.NPC.add(o); zs.npcOn = true; }
      else if (!on && zs.npcOn && S.NPC) { for (const o of zs.K.npcs) S.NPC.remove(o); zs.npcOn = false; }
      try { zs.mod?.shown?.(on); } catch (e) { console.error(e); }
    }
    rt.zoneState = id => rt.zones.get(id);
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
      else if (a.startsWith('act:')) doAct(a.slice(4));
      else if (a === 'acts-x') toggleActs(false);
      else for (const zs of rt.mods) { try { if (zs.mod?.click?.(a, b)) break; } catch (er) { console.error(er); } }
    });
    function borderTick(){
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
      for (const zs of rt.zones.values()) for (const sp of zs.K?.seats || []) { const d = Math.hypot(sp.x - ch.x, sp.z - ch.z); if (!sp.bed && d < bd) { bd = d; best = sp; } }
      if (best) return rt.sitDown(best);
      if (P.mode !== 'move' || !ch.grounded) return;
      rt.sitDown({ x: ch.x, y: ch.y + .32, z: ch.z, yaw: P.yaw, name: 'Сесть' });   // прямо на землю
    };
    rt.sleepHere = () => {
      const ch = S.P.ch;
      let best = null, bd = 5;
      for (const zs of rt.zones.values()) for (const sp of zs.K?.seats || []) { const d = Math.hypot(sp.x - ch.x, sp.z - ch.z); if (sp.bed && d < bd) { bd = d; best = sp; } }
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
    rt.onHi = () => { if (rt.zxSig && rt.zxSig !== '{}') setTimeout(() => { if (!rt.stopped) S.forceSend = true; }, 400 + Math.random() * 1600); };
    rt.onMsg = (p, d) => { for (const zs of rt.mods) { try { if (zs.mod?.onMsg?.(p, d)) return; } catch (e) { console.error(e); } } };
    rt.send = d => H.send?.({ t: 'z', ...d });
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
        if (!zs.npcOn) { for (const o of zs.K?.npcs || []) if (o._tagEl) o._tagEl.style.display = 'none'; continue; }
        for (const o of zs.K.npcs) {
          const e = S.NPC.list.get(o.id), h = e && S.NPC.head(e);
          let el = o._tagEl;
          if (!el) { el = o._tagEl = document.createElement('div'); el.className = 'wld-tag wld-npc'; el.innerHTML = '<div class="wld-tbub" hidden></div><b class="wld-tname"></b>'; el.lastChild.textContent = o.name || ''; tagBox.appendChild(el); }
          const far = !h || Math.hypot(h[0] - P.x, h[2] - P.z) > 24;
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
          if (zs.built) { const want = d < (zs.shown ? HIDE_D : SHOW_D); if (want !== zs.shown) setShown(zs, want); }
        }
      }
      for (const zs of rt.mods) { try { zs.mod?.update?.(dt); } catch (e) { console.error(e); } }
    };
    rt.frame = (dt, t) => {
      if (rt.stopped) return;
      for (const zs of rt.zones.values()) if (zs.it) { stepBuild(zs, R.q === 'high' ? 4 : 3); if (zs.built && !zs.shown) { const c = R.camera.position; if (distRect(zs.Z, c.x, c.z) < SHOW_D) setShown(zs, true); } }
      for (const zs of rt.mods) { try { zs.mod?.frame?.(dt, t); } catch (e) { console.error(e); } }
      drawNpcTags();
    };
    rt.dispose = () => {
      rt.stopped = true;
      clearTimeout(rt.bannerT); clearTimeout(rt.phT); clearTimeout(rt.eatT); clearInterval(rt.mapT);
      for (const zs of rt.zones.values()) {
        try { zs.mod?.stop?.(); } catch (e) { console.error(e); }
        if (zs.npcOn && S.NPC) for (const o of zs.K.npcs) S.NPC.remove(o);
        if (zs.grp) { disposeOwn(zs.grp); zs.grp.parent?.remove(zs.grp); }
      }
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
    return rt;
  }
  const FAMILY = { mom: ['👩', 'Мама'], dad: ['👨', 'Папа'], son: ['👦', 'Сын'], dau: ['👧', 'Дочка'], baby: ['👶', 'Малыш'], gma: ['👵', 'Бабушка'], gpa: ['👴', 'Дедушка'], pet: ['🐾', 'Питомец семьи'] };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  root.MirZones = {
    ADULT_AGE, WAR_AGE, ZONES, ZLIST, RESERVE, SEA, BUNKER, AREAS, ROADS, PADS, PAD_R, PLACES0, FAMILY, PAY, DEFS, ROLES, ACTS,
    def, inRect, distRect, rectsOverlap, zoneAt, areaAt, roadDist, segDist, bounds, groundRect, blocked, hillOk, terrain, water, gateOf, cleanZX,
    payState, payAdd, places, drawMap, fullView, merge, atlas, kit, build, groundHoles, start, district, esc,
    LOAD_D, SHOW_D, HIDE_D,
  };
  // Карта мира — и для телефона 📱 (phone-apps.js «Карта»)
  root.MirMap = { draw: drawMap, points: places, fullView, ZONES, ZLIST };
})();
