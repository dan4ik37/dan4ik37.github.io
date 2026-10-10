// ═══════════════════════════════════════
//  «МИР ДЕНЧИКА» (#/games/world) — общий мир: игроки ходят своими персонажами, общаются, дружат, заходят в порталы-игры
// ═══════════════════════════════════════
// Сеть — Supabase Realtime: канал world-<N> («сервер», до MAX_ROOM человек), presence — кто в мире (ключ, открытый ключ
// подписи, пропуск, где появился), broadcast 'w' — события. Шаги НЕ шлём: только «иду из A в B» (mv) — лимит Supabase
// 2 млн сообщений в месяц, а каждое сообщение считается по числу получателей. Новичку позиции всех шлёт одним сообщением
// старожил комнаты (snap). События: mv, hi, snap, say (чат), emo, inv (зову в игру), mute (модератор).
// Каждое сообщение подписано ключом игрока (ECDSA P-256); у вошедших ключ привязан к аккаунту пропуском (world.sql:
// world_pass/world_check) — ник, роль, VIP, уровень берутся из базы, выдать себя за другого нельзя. Без пропуска (гость,
// или world.sql не применён) — игрок «не проверен»: ник со знаком «?», без значков. Писать в чат — только вошедшим.
// Мат и ссылки закрываются у ПОЛУЧАТЕЛЯ (clean). Карта рисуется кодом (buildMap, зерно 37), путь — A* по сетке 20 px.
// Движок без DOM — GAME_IMPL.world._test (проверять в node).
(() => {
  const W = 2400, H = 1600, CELL = 20, GW = W / CELL, GH = H / CELL, CX = 1200, CY = 800, PLAZA = 300;
  const SPEED = 230, MAX_ROOM = 20, SHARDS = 6, IDLE_MS = 15 * 60e3, HIDDEN_MS = 10 * 60e3;
  const EMOS = ['👋', '😂', '❤️', '🔥', '🎉', '😎', '😭', '👍', '💃'];
  const PORTALS = [
    { id: 'games', e: '🎮', name: 'Все игры', color: '#ff2d55', a: -90 },
    { id: 'horde', e: '🧟', name: 'Орда', color: '#a855f7', a: -45 },
    { id: 'arena', e: '🔫', name: 'Арена', color: '#f97316', a: 0 },
    { id: 'td', e: '🏰', name: 'Башни', color: '#eab308', a: 45 },
    { id: 'cards', e: '🃏', name: 'Карты и настолки', color: '#22c55e', a: 90 },
    { id: 'puzzles', e: '🧩', name: 'Головоломки', color: '#38bdf8', a: 135 },
    { id: 'wardrobe', e: '🎭', name: 'Гардероб', color: '#ff6fb5', a: 180 },
    { id: 'stage', e: '📺', name: 'Сцена Денчика', color: '#9147ff', a: -135 },
  ].map(p => ({ ...p, x: Math.round(CX + 900 * Math.cos(p.a * Math.PI / 180)), y: Math.round(CY + 560 * Math.sin(p.a * Math.PI / 180)) }));
  const MODES = {
    horde: ['horde'], arena: ['arena'], td: ['td'],
    cards: ['uno', 'durak', 'chess', 'nardy', 'ludo', 'pool', 'checkers', 'sea', 'ttt'],
    puzzles: ['blocks', 'sudoku', 'mahjong', 'kosynka', 'freecell', 'pauk', 'miner', '2048', 'words', 'snake'],
  };
  const NO_ROOM = new Set(['pauk', 'wardrobe', 'clicker', 'quiz', 'wheel', 'random', 'typing', 'cps', 'fonts', 'world']);
  const COOP = new Set(['horde', 'td']);
  const QUICK = ['chess', 'uno', 'durak', 'arena', 'horde', 'td', 'sea', 'checkers', 'blocks', 'sudoku'];
  const STAGE = { x: 564 - 150, y: 404 - 245, w: 300, h: 150 };   // экран сцены над порталом «Сцена»

  function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  function segDist(px, py, x1, y1, x2, y2){
    const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)) : 0;
    return dist(px, py, x1 + t * dx, y1 + t * dy);
  }

  // ── Карта: дороги, деревья, цветы, фонари, скамейки (одинаковая у всех — зерно 37) ──
  function buildMap(){
    const R = rng(37);
    const roads = PORTALS.map(p => {
      const a = Math.atan2(p.y - CY, p.x - CX);
      return { x1: CX + Math.cos(a) * (PLAZA - 10), y1: CY + Math.sin(a) * (PLAZA - 10), x2: p.x, y2: p.y };
    });
    const nearRoad = (x, y, m) => roads.some(r => segDist(x, y, r.x1, r.y1, r.x2, r.y2) < m);
    const inStage = (x, y, m) => x > STAGE.x - m && x < STAGE.x + STAGE.w + m && y > STAGE.y - m && y < STAGE.y + STAGE.h + m;
    const trees = [];
    const tryTree = (x, y, r) => {
      if (x < 30 || y < 50 || x > W - 30 || y > H - 20) return false;
      if (dist(x, y, CX, CY) < PLAZA + 70 || nearRoad(x, y, 75) || inStage(x, y, 60)) return false;
      if (PORTALS.some(p => dist(x, y, p.x, p.y) < 150)) return false;
      if (trees.some(t => dist(x, y, t.x, t.y) < 64)) return false;
      trees.push({ x: Math.round(x), y: Math.round(y), r, v: Math.floor(R() * 3) });
      return true;
    };
    // рамка из деревьев по краю и рощи внутри
    for (let x = 40; x < W; x += 70) { tryTree(x + R() * 20, 60 + R() * 20, 26); tryTree(x + R() * 20, H - 40 - R() * 20, 26); }
    for (let y = 120; y < H - 60; y += 70) { tryTree(40 + R() * 20, y + R() * 20, 26); tryTree(W - 40 - R() * 20, y + R() * 20, 26); }
    for (let k = 0; k < 900 && trees.length < 230; k++) tryTree(R() * W, R() * H, 22 + R() * 8);
    const flowers = [];
    for (let k = 0; k < 400 && flowers.length < 70; k++) {
      const x = R() * W, y = R() * H;
      if (dist(x, y, CX, CY) < PLAZA + 30 || nearRoad(x, y, 60) || trees.some(t => dist(x, y, t.x, t.y) < 40) || PORTALS.some(p => dist(x, y, p.x, p.y) < 110)) continue;
      flowers.push({ x, y, c: ['#f472b6', '#facc15', '#f8fafc', '#a78bfa', '#fb7185'][Math.floor(R() * 5)], n: 5 + Math.floor(R() * 6) });
    }
    const lamps = [];
    roads.forEach(r => {
      const len = dist(r.x1, r.y1, r.x2, r.y2), nx = -(r.y2 - r.y1) / len, ny = (r.x2 - r.x1) / len;
      for (let s = 110; s < len - 100; s += 230) {
        const t = s / len;
        lamps.push({ x: r.x1 + (r.x2 - r.x1) * t + nx * 62, y: r.y1 + (r.y2 - r.y1) * t + ny * 62 });
      }
    });
    const benches = [];
    for (let k = 0; k < 8; k++) {
      const a = (-90 + 22.5 + k * 45) * Math.PI / 180;
      benches.push({ x: CX + Math.cos(a) * (PLAZA - 40), y: CY + Math.sin(a) * (PLAZA - 40), a });
    }
    // Сетка проходимости: края, фонтан, деревья, экран сцены
    const block = new Uint8Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2;
      let b = gx < 1 || gy < 2 || gx >= GW - 1 || gy >= GH - 1 || dist(x, y, CX, CY) < 104 || inStage(x, y, 4);
      if (!b) for (const t of trees) if (Math.abs(t.x - x) < 40 && Math.abs(t.y - y) < 40 && dist(x, y, t.x, t.y + 6) < t.r * .85 + 6) { b = true; break; }
      block[gy * GW + gx] = b ? 1 : 0;
    }
    return { roads, trees, flowers, lamps, benches, block };
  }

  // ── Путь: A* по сетке (8 направлений, без срезания углов) + спрямление по прямой видимости ──
  function cellOf(x, y){ return [Math.max(0, Math.min(GW - 1, Math.floor(x / CELL))), Math.max(0, Math.min(GH - 1, Math.floor(y / CELL)))]; }
  function nearestFree(M, gx, gy){
    if (!M.block[gy * GW + gx]) return [gx, gy];
    for (let r = 1; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = gx + dx, y = gy + dy;
      if (x >= 0 && y >= 0 && x < GW && y < GH && !M.block[y * GW + x]) return [x, y];
    }
    return [gx, gy];
  }
  function lineFree(M, x1, y1, x2, y2){
    const d = dist(x1, y1, x2, y2), n = Math.ceil(d / (CELL / 2));
    for (let i = 1; i < n; i++) {
      const [gx, gy] = cellOf(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n);
      if (M.block[gy * GW + gx]) return false;
    }
    return true;
  }
  function findPath(M, sx, sy, tx, ty){
    if (lineFree(M, sx, sy, tx, ty)) { const [gx, gy] = cellOf(tx, ty); if (!M.block[gy * GW + gx]) return [[tx, ty]]; }
    const [s0, s1] = nearestFree(M, ...cellOf(sx, sy)), [g0, g1] = nearestFree(M, ...cellOf(tx, ty));
    const start = s1 * GW + s0, goal = g1 * GW + g0;
    const gs = new Float32Array(GW * GH).fill(Infinity), from = new Int32Array(GW * GH).fill(-1), closed = new Uint8Array(GW * GH);
    const heap = [];   // [f, idx] — двоичная куча
    const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const h = i => { const dx = Math.abs(i % GW - g0), dy = Math.abs(Math.floor(i / GW) - g1); return Math.max(dx, dy) + .414 * Math.min(dx, dy); };
    gs[start] = 0; push(h(start), start);
    let found = false;
    while (heap.length) {
      const [, i] = pop();
      if (closed[i]) continue;
      closed[i] = 1;
      if (i === goal) { found = true; break; }
      const x = i % GW, y = Math.floor(i / GW);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const j = ny * GW + nx;
        if (M.block[j] || closed[j]) continue;
        if (dx && dy && (M.block[y * GW + nx] || M.block[ny * GW + x])) continue;
        const g = gs[i] + (dx && dy ? 1.414 : 1);
        if (g < gs[j]) { gs[j] = g; from[j] = i; push(g + h(j), j); }
      }
    }
    if (!found) return [];
    const cells = [];
    for (let i = goal; i !== -1 && i !== start; i = from[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map(i => [(i % GW) * CELL + CELL / 2, Math.floor(i / GW) * CELL + CELL / 2]);
    if (!M.block[(cellOf(tx, ty)[1]) * GW + cellOf(tx, ty)[0]]) pts[pts.length - 1] = [tx, ty];
    // спрямление: из текущей точки — к самой дальней видимой
    const out = [];
    let cx = sx, cy = sy, k = 0;
    while (k < pts.length) {
      let far = k;
      for (let j = pts.length - 1; j > k; j--) if (lineFree(M, cx, cy, pts[j][0], pts[j][1])) { far = j; break; }
      out.push(pts[far]); [cx, cy] = pts[far]; k = far + 1;
    }
    return out;
  }

  // ── Чат: мат и ссылки закрываются; похожие латинские буквы приводим к русским ──
  const LAT = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', '3': 'з', '0': 'о', '@': 'а' };
  // Без «просмотра назад» ((?<!…)) — его не понимает Safari до 16.4, и весь файл не загрузился бы
  const BAD = [
    /ху[йеёяюи]/u, /п[иеё]зд/u, /(?:^|[^\p{L}])бля(?!х)/u, /(?:^|[^\p{L}])(?:за|на|вы|у|от|по|до|про|раз|рас|съ|подъ|из|изъ|при|пере|недо)?[её]б(?:а|ал|ан|ат|ут|ну|ло|ли|л|ы|ош|уч|ен|ис|ыв|ыр|ет|ёт)/u,
    /(?:^|[^\p{L}])[её]б(?!\p{L})/u, /(?:^|[^\p{L}])сук(?:а+|и|е|у|ой|ин|ам)(?!\p{L})/u, /муда[кч]|мудил/u, /пид[ао]р|педик/u, /г[ао]нд[ао]н/u, /шлюх/u, /залуп/u, /дроч/u,
  ];
  function clean(text){
    let s = String(text || '').replace(/[\u0000-\u001f\u200b-\u200f\u2028-\u202e]/g, '').trim().slice(0, 120);
    s = s.replace(/(?:https?:\/\/|www\.|t\.me\/|discord\.gg\/?)\S*/giu, '[ссылка]');
    // по кодовым единицам UTF-16: индексы совпадений = индексы символов (эмодзи не сбивают)
    const chars = s.split(''), low = chars.map(c => { const l = c.toLowerCase(); return l.length === 1 ? (LAT[l] || l) : c; }).join('');
    const mask = Array(low.length).fill(false);
    for (const re of BAD) {
      const g = new RegExp(re.source, 'gu');
      let m;
      while ((m = g.exec(low))) { for (let i = m.index; i < m.index + m[0].length; i++) mask[i] = true; if (!m[0].length) g.lastIndex++; }
    }
    // Слово, где нашлось плохое, закрываем целиком
    let out = '', i = 0;
    while (i < chars.length) {
      if (/\s/u.test(chars[i])) { out += chars[i++]; continue; }
      let j = i, bad = false;
      while (j < chars.length && !/\s/u.test(chars[j])) { if (mask[j]) bad = true; j++; }
      out += bad ? '*'.repeat(Math.min(6, j - i)) : chars.slice(i, j).join('');
      i = j;
    }
    return out;
  }

  // ── Подпись сообщений (WebCrypto ECDSA P-256) ──
  const enc = s => new TextEncoder().encode(s);
  const b64 = buf => { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function makeKeys(){
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    return { kp, pub: b64(await crypto.subtle.exportKey('raw', kp.publicKey)) };
  }
  const importPub = pub => crypto.subtle.importKey('raw', unb64(pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const sign = async (priv, str) => b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, enc(str)));
  const verify = (pub, sig, str) => crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64(sig), enc(str)).catch(() => false);

  // Гостям и непроверенным — только бесплатные части (платные/VIP можно «надеть» подделкой — не показываем)
  function freeLook(look){
    const C = window.D37Char;
    if (!C) return look || {};
    const L = C.norm(look);
    for (const s of C.SLOTS) { const p = C.part(s, L[s]); if (!p || p.price > 0 || p.vip) L[s] = C.DEFAULT[s]; }
    return L;
  }

  // ═══ Экран ═══
  let root, api, S = null;
  const MAPDATA = { m: null, canvas: null };
  const num = n => Number(n || 0).toLocaleString('ru');
  const now = () => performance.now();
  const gameInfo = id => (typeof GAMES !== 'undefined' ? GAMES.find(g => g.id === id) : null) || { id, icon: '🎮', title: id };
  const ROLE = { admin: ['👑', '#ff4d6d', 'Админ'], moderator: ['🛡️', '#4ade80', 'Модератор'], helper: ['🤝', '#38bdf8', 'Помощник'] };
  const VIPC = { gold: '#facc15', silver: '#e2e8f0', bronze: '#f59e0b' };

  function mapCanvas(){
    if (MAPDATA.canvas) return MAPDATA;
    const M = MAPDATA.m || (MAPDATA.m = buildMap());
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), R = rng(7);
    g.fillStyle = '#2f6d3c'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 700; k++) { g.fillStyle = R() < .5 ? 'rgba(20,70,35,.25)' : 'rgba(120,190,90,.12)'; g.beginPath(); g.ellipse(R() * W, R() * H, 20 + R() * 70, 12 + R() * 40, R() * 3, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(160,220,120,.18)'; g.lineWidth = 2;
    for (let k = 0; k < 2200; k++) { const x = R() * W, y = R() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - .5) * 6, y - 6 - R() * 6); g.stroke(); }
    // дороги
    g.lineCap = 'round';
    for (const [w, col] of [[104, '#8f7e5d'], [92, '#c6b38c']]) { g.strokeStyle = col; g.lineWidth = w; M.roads.forEach(r => { g.beginPath(); g.moveTo(r.x1, r.y1); g.lineTo(r.x2, r.y2); g.stroke(); }); }
    g.fillStyle = 'rgba(120,100,70,.25)';
    M.roads.forEach(r => { const len = dist(r.x1, r.y1, r.x2, r.y2); for (let s = 0; s < len; s += 26) { const t = s / len; g.beginPath(); g.ellipse(r.x1 + (r.x2 - r.x1) * t + (R() - .5) * 60, r.y1 + (r.y2 - r.y1) * t + (R() - .5) * 60, 9, 6, R() * 3, 0, 7); g.fill(); } });
    // площадь
    g.fillStyle = '#9b8a66'; g.beginPath(); g.arc(CX, CY, PLAZA + 12, 0, 7); g.fill();
    g.fillStyle = '#d8caa6'; g.beginPath(); g.arc(CX, CY, PLAZA, 0, 7); g.fill();
    g.strokeStyle = 'rgba(140,120,85,.45)'; g.lineWidth = 3;
    for (let r = 140; r < PLAZA; r += 52) { g.beginPath(); g.arc(CX, CY, r, 0, 7); g.stroke(); }
    for (let k = 0; k < 24; k++) { const a = k * Math.PI / 12; g.beginPath(); g.moveTo(CX + Math.cos(a) * 120, CY + Math.sin(a) * 120); g.lineTo(CX + Math.cos(a) * PLAZA, CY + Math.sin(a) * PLAZA); g.stroke(); }
    // надпись на площади
    g.font = '900 34px Oswald, Montserrat, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(120,95,60,.55)';
    g.fillText('МИР ДЕНЧИКА', CX, CY + 205);
    // фонтан (чаша; вода рисуется живой)
    g.fillStyle = '#7d8590'; g.beginPath(); g.arc(CX, CY, 104, 0, 7); g.fill();
    g.fillStyle = '#a3abb6'; g.beginPath(); g.arc(CX, CY, 96, 0, 7); g.fill();
    // цветы
    M.flowers.forEach(f => { const r = rng(Math.round(f.x * 7 + f.y)); for (let i = 0; i < f.n; i++) { g.fillStyle = f.c; g.beginPath(); g.arc(f.x + (r() - .5) * 34, f.y + (r() - .5) * 22, 3.2, 0, 7); g.fill(); } g.fillStyle = 'rgba(30,90,40,.5)'; g.beginPath(); g.ellipse(f.x, f.y + 4, 20, 9, 0, 0, 7); g.fill(); });
    // площадки порталов и таблички
    PORTALS.forEach(p => {
      const gr = g.createRadialGradient(p.x, p.y, 10, p.x, p.y, 86);
      gr.addColorStop(0, p.color + 'cc'); gr.addColorStop(.7, p.color + '55'); gr.addColorStop(1, p.color + '00');
      g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, 88, 0, 7); g.fill();
      g.strokeStyle = '#ffffffaa'; g.lineWidth = 4; g.beginPath(); g.arc(p.x, p.y, 66, 0, 7); g.stroke();
      g.font = '800 22px Montserrat, sans-serif';
      const tw = g.measureText(p.name).width + 28;
      g.fillStyle = 'rgba(20,16,32,.82)'; roundRect(g, p.x - tw / 2, p.y + 74, tw, 34, 10); g.fill();
      g.fillStyle = '#fff'; g.fillText(p.name, p.x, p.y + 92);
    });
    MAPDATA.canvas = c;
    // спрайты деревьев (3 вида) и фонаря
    MAPDATA.tree = [0, 1, 2].map(v => { const t = document.createElement('canvas'); t.width = 120; t.height = 140; const q = t.getContext('2d'), cols = [['#1f5e2e', '#2f7d3d', '#3f9a4b'], ['#24603a', '#357f46', '#4ea55a'], ['#2b5a26', '#3d7a33', '#5a9a3e']][v];
      q.fillStyle = 'rgba(0,0,0,.28)'; q.beginPath(); q.ellipse(60, 128, 34, 10, 0, 0, 7); q.fill();
      q.fillStyle = '#6b4a2b'; q.fillRect(53, 86, 14, 42);
      [[60, 70, 40, cols[0]], [44, 58, 30, cols[1]], [76, 56, 30, cols[1]], [60, 42, 32, cols[2]]].forEach(([x, y, r, col]) => { q.fillStyle = col; q.beginPath(); q.arc(x, y, r, 0, 7); q.fill(); });
      q.fillStyle = 'rgba(255,255,255,.12)'; q.beginPath(); q.arc(50, 34, 12, 0, 7); q.fill();
      return t; });
    const lp = document.createElement('canvas'); lp.width = 40; lp.height = 110; const lq = lp.getContext('2d');
    lq.fillStyle = 'rgba(0,0,0,.25)'; lq.beginPath(); lq.ellipse(20, 104, 12, 4, 0, 0, 7); lq.fill();
    lq.fillStyle = '#2d2a3a'; lq.fillRect(17, 24, 6, 80); lq.fillRect(11, 98, 18, 6);
    lq.fillStyle = '#fde68a'; lq.beginPath(); lq.arc(20, 18, 10, 0, 7); lq.fill(); lq.strokeStyle = '#2d2a3a'; lq.lineWidth = 3; lq.stroke();
    MAPDATA.lamp = lp;
    return MAPDATA;
  }
  function roundRect(g, x, y, w, h, r){ g.beginPath(); if (g.roundRect) { g.roundRect(x, y, w, h, r); return; } g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  function mount(el){
    const D = mapCanvas(), M = D.m;
    el.innerHTML = `<div class="wld">
        <div class="wld-top"><b>🌍 Мир Денчика</b><span class="wldShard"></span><span class="wldOnline">подключаемся…</span>
          <span class="wld-topbtns"><button type="button" data-act="mode" class="wldMode" title="Объёмный или плоский мир">🧊<span> 3D</span></button><button type="button" data-act="look" title="Мой персонаж">🎭<span> Персонаж</span></button><button type="button" data-act="help" title="Как играть">❓</button></span></div>
        <div class="wld-wrap">
          <canvas class="wld-cv" aria-label="Мир Денчика: нажми, куда идти"></canvas>
          <div class="wld-log" aria-live="polite"></div>
          <div class="wld-pop wld-card" hidden></div>
          <div class="wld-pop wld-panel" hidden></div>
          <div class="wld-inv" hidden></div>
          <div class="wld-status" hidden></div>
          <div class="wld-hint">Нажми, куда идти. Подойди к порталу — выбери игру. Нажми на игрока — дружба и приглашения.</div>
        </div>
        <div class="wld-bar">
          <div class="wld-emos">${EMOS.map(e => `<button type="button" data-emo="${e}">${e}</button>`).join('')}</div>
          <form class="wld-say"><input type="text" maxlength="120" autocomplete="off" placeholder="Написать всем…"><button type="submit" aria-label="Отправить">➤</button></form>
        </div>
      </div>`;
    const q = s => el.querySelector(s);
    const cv = q('.wld-cv'), ctx = cv.getContext('2d'), wrap = q('.wld-wrap');
    S = {
      el, q, cv, ctx, wrap, M, D, players: new Map(), me: null, ch: null, shard: 1, key: '', keys: null, pass: null, verified: false, myRole: null,
      dpr: 1, z: 1, cw: 0, ch_: 0, camX: 0, camY: 0, raf: 0, last: 0, lastSent: 0, sendQ: null, lastTs: 0, hostSnapAt: 0,
      log: [], muted: new Set(), friends: new Set(), checkCache: new Map(), stopped: false, idleAt: Date.now(), hiddenAt: 0,
      portalIn: null, keysDown: new Set(), kbAt: 0, target: null, live: null, joinedAt: Date.now(), pending: [],
    };
    const isGuest = typeof currentUser === 'undefined' || !currentUser;
    const myLook = window.D37Char ? window.D37Char.look() : {};
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('d37_world_pos') || 'null'); } catch (e) {}
    let sx, sy;
    if (saved && saved.x > 60 && saved.y > 60 && saved.x < W - 60 && saved.y < H - 60 && !M.block[cellOf(saved.x, saved.y)[1] * GW + cellOf(saved.x, saved.y)[0]]) { sx = saved.x; sy = saved.y; }
    else { const a = Math.random() * Math.PI * 2, r = 150 + Math.random() * 100; sx = CX + Math.cos(a) * r; sy = CY + Math.sin(a) * r; }
    S.key = isGuest ? 'g:' + (window.GameRoom?.guestId?.() || Math.random().toString(36).slice(2)) : 'u:' + currentUser.id;
    S.me = mkPlayer({ key: S.key, uid: isGuest ? null : currentUser.id, nick: isGuest ? (window.GameRoom?.nick?.() || 'Гость') : (currentProfile?.nick || 'Игрок'), look: myLook, x: sx, y: sy });
    S.me.isMe = true;
    S.me.v = null;
    if (!isGuest) q('.wld-say input').placeholder = 'Написать всем…';
    else { q('.wld-say input').placeholder = 'Войди, чтобы писать в чат'; q('.wld-say input').readOnly = true; }

    function resize(){
      const r = wrap.getBoundingClientRect();
      S.cw = Math.max(200, Math.round(r.width)); S.ch_ = Math.max(200, Math.round(r.height));
      S.dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(S.cw * S.dpr); cv.height = Math.round(S.ch_ * S.dpr);
      S.z = Math.max(.55, Math.min(1.15, Math.min(S.cw / 820, S.ch_ / 600)));
    }
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    ro?.observe(wrap);
    window.addEventListener('resize', resize);
    resize();

    // ── Ввод ──
    const toWorld = (cx, cy) => { const b = cv.getBoundingClientRect(); return [S.camX + (cx - b.left) / S.z, S.camY + (cy - b.top) / S.z]; };
    // 3D: игрок под пальцем — по экранной точке груди (ближе 40 px)
    const pick3d = (cx, cy) => {
      const b = wrap.getBoundingClientRect();
      let hit = null, best = 40;
      for (const p of [S.me, ...S.players.values()]) {
        if (p.leaving) continue;
        const [sx, sy, vis] = S.g3.project(p.x, p.y, 1.1), d = Math.hypot(cx - b.left - sx, cy - b.top - sy);
        if (vis && d < best) { best = d; hit = p; }
      }
      return hit;
    };
    const touches = new Map();
    wrap.addEventListener('pointerdown', e => {
      if (e.target.closest('.wld-pop, .wld-inv, .wld-status, button, a, input')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      activity();
      if (e.pointerType === 'touch') { touches.set(e.pointerId, [e.clientX, e.clientY]); if (touches.size > 1) { S.pinch = null; return; } }
      if (S.g3) {
        const hit = pick3d(e.clientX, e.clientY);
        if (hit) { openCard(hit); return; }
        const pt = S.g3.pickGround(e.clientX, e.clientY);
        if (!pt) return;
        const portal = PORTALS.find(p => dist(pt[0], pt[1], p.x, p.y) < 90);
        walkTo(portal ? portal.x : pt[0], portal ? portal.y : pt[1]);
        closePops();
        return;
      }
      const [wx, wy] = toWorld(e.clientX, e.clientY);
      // игрок под пальцем?
      let hit = null, best = 1e9;
      for (const p of S.players.values()) {
        if (p.leaving) continue;
        if (Math.abs(wx - p.x) < 26 && wy < p.y + 8 && wy > p.y - 74) { const d = Math.abs(wy - (p.y - 34)) + Math.abs(wx - p.x); if (d < best) { best = d; hit = p; } }
      }
      if (hit) { openCard(hit); return; }
      if (Math.abs(wx - S.me.x) < 22 && wy < S.me.y + 8 && wy > S.me.y - 70) { openCard(S.me); return; }
      const portal = PORTALS.find(p => dist(wx, wy, p.x, p.y) < 70);
      walkTo(portal ? portal.x : wx, portal ? portal.y : wy);
      closePops();
    });
    // приближение: колесо мыши и два пальца
    wrap.addEventListener('wheel', e => { if (!S.g3 || e.target.closest('.wld-pop')) return; e.preventDefault(); S.g3.setZoom(S.g3.zoom * (e.deltaY > 0 ? 1.1 : .9)); }, { passive: false });
    wrap.addEventListener('pointermove', e => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size !== 2 || !S.g3) return;
      const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (S.pinch) S.g3.setZoom(S.g3.zoom * S.pinch / d);
      S.pinch = d;
    });
    const untouch = e => { touches.delete(e.pointerId); if (touches.size < 2) S.pinch = null; };
    wrap.addEventListener('pointerup', untouch);
    wrap.addEventListener('pointercancel', untouch);
    function onKey(e, down){
      if (S.stopped || S.editing || e.target?.closest?.('input,textarea,[contenteditable]')) return;
      const k = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r' }[e.code];
      if (!k) { if (down && e.key === 'Enter') { const i = q('.wld-say input'); if (!i.readOnly) i.focus(); } return; }
      e.preventDefault();
      activity();
      if (down) S.keysDown.add(k); else S.keysDown.delete(k);
      if (!down && !S.keysDown.size) { S.me.path = []; sendMove(S.me.x, S.me.y); }
    }
    const kd = e => onKey(e, true), ku = e => onKey(e, false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    el.querySelector('.wld-emos').addEventListener('click', e => { const b = e.target.closest('[data-emo]'); if (b) { activity(); emote(b.dataset.emo); } });
    q('.wld-say').addEventListener('submit', e => {
      e.preventDefault();
      const i = q('.wld-say input');
      if (i.readOnly) { if (typeof openGlobalAuth === 'function') openGlobalAuth(); return; }
      const t = i.value.trim();
      if (!t) return;
      if (Date.now() - (S.lastSay || 0) < 1500) { toast('Не так быстро 🙂'); return; }
      S.lastSay = Date.now();
      i.value = '';
      activity();
      say(S.me, t);
      send({ t: 'say', text: t.slice(0, 120) });
    });
    q('.wld-say input').addEventListener('focus', () => { if (q('.wld-say input').readOnly && typeof openGlobalAuth === 'function') openGlobalAuth(); });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || !el.contains(b)) return;
      onAct(b.dataset.act, b);
    });
    const onVis = () => { if (document.hidden) S.hiddenAt = Date.now(); else { S.hiddenAt = 0; S.last = now(); } };
    document.addEventListener('visibilitychange', onVis);

    S.cleanup = () => {
      ro?.disconnect(); window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
      document.removeEventListener('visibilitychange', onVis);
    };
    S.last = now();
    S.raf = requestAnimationFrame(frame);
    join();
    loadFriends();
    checkLive();
    // Объёмный мир (Three.js), если браузер умеет WebGL и игрок не выбрал 2D; пока грузится — 2D
    let force2d = false;
    try { force2d = localStorage.getItem('d37_world_2d') === '1'; } catch (e) {}
    q('.wldMode').innerHTML = force2d ? '🗺️<span> 2D</span>' : '🧊<span> 3D</span>';
    const st0 = S;
    if (!force2d && window.World3D?.supported()) window.World3D.load().then(ok => { if (ok && S === st0 && !S.stopped && !S.g3) enable3D(); });
    clearInterval(S.tick);
    S.tick = setInterval(housekeeping, 1000);
  }

  function mkPlayer(o){
    return { key: o.key, uid: o.uid || null, nick: o.nick || 'Игрок', look: o.look || {}, x: o.x, y: o.y, path: [], dir: 1, face: 0, moving: false, bubble: null, emo: null, v: undefined, pub: null, lastTs: 0, at: o.at || 0, born: now(), leaving: 0, rate: [], phase: Math.random() * 6 };
  }
  const toast = t => api?.toast?.(t);
  const activity = () => { S.idleAt = Date.now(); };

  // ── Сеть ──
  async function join(shard = 1){
    if (typeof sbClient === 'undefined' || !sbClient) { status('Нет связи с сервером — обнови страницу'); return; }
    const st = S;
    try { st.keys = st.keys || await makeKeys(); } catch (e) { status('Браузер не поддерживает защищённые сообщения — обнови его'); return; }
    if (st.me.uid && !st.pass) {
      try { const { data, error } = await sbClient.rpc('world_pass', { p_pub: st.keys.pub }); if (!error && data) st.pass = data; } catch (e) {}
    }
    if (S !== st || st.stopped) return;
    S.shard = shard;
    S.q('.wldShard').textContent = `сервер ${shard}`;
    const ch = sbClient.channel('world-' + shard, { config: { broadcast: { self: false }, presence: { key: S.key } } });
    S.ch = ch;
    S.firstSync = false;
    ch.on('presence', { event: 'sync' }, () => { if (S.ch === ch) onSync(); });
    ch.on('broadcast', { event: 'w' }, ({ payload }) => { if (S.ch === ch) onMsg(payload); });
    ch.subscribe(async st => {
      if (S.ch !== ch || S.stopped) return;
      if (st === 'SUBSCRIBED') {
        status('');
        await ch.track(presenceMeta());
      } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') status('Связь с миром потерялась — переподключаемся…');
    });
  }
  const presenceMeta = () => ({ id: S.key, uid: S.me.uid, nick: S.me.nick, look: S.me.look, pub: S.keys.pub, pass: S.pass, x: Math.round(S.me.x), y: Math.round(S.me.y), at: S.joinedAt });
  function leaveChannel(){
    const ch = S?.ch;
    if (!ch) return;
    S.ch = null;
    try { ch.untrack(); } catch (e) {}
    try { sbClient.removeChannel(ch); } catch (e) {}
  }
  function onSync(){
    const st = S.ch.presenceState(), seen = new Map();
    for (const [key, metas] of Object.entries(st)) {
      const m = metas.reduce((a, b) => ((b.at || 0) >= (a.at || 0) ? b : a), metas[0]);
      if (m && m.id === key) seen.set(key, m);
    }
    // Комната переполнена — я среди поздних → следующий сервер
    if (!S.firstSync) {
      S.firstSync = true;
      const order = [...seen.values()].sort((a, b) => (a.at || 0) - (b.at || 0)).map(m => m.id);
      if (order.indexOf(S.key) >= MAX_ROOM && S.shard < SHARDS) { leaveChannel(); join(S.shard + 1); return; }
      setTimeout(() => send({ t: 'hi' }), 500);
    }
    for (const [key, m] of seen) {
      if (key === S.key) continue;
      let p = S.players.get(key);
      if (!p || p.leaving) {
        p = mkPlayer({ key, uid: typeof m.uid === 'string' ? m.uid : null, nick: String(m.nick || 'Гость').slice(0, 24), look: freeLook(m.look), x: Math.max(30, Math.min(W - 30, +m.x || CX)), y: Math.max(60, Math.min(H - 30, +m.y || CY + 200)), at: +m.at || 0 });
        p.lookRaw = JSON.stringify(m.look || {});
        S.players.set(key, p);
        if (typeof m.pub === 'string' && m.pub.length < 200) { p.pubRaw = m.pub; importPub(m.pub).then(k => { p.pub = k; flushPending(); }).catch(() => {}); }
        identify(p, m);
      } else {
        // переоделся — новый образ (у проверенного платное берём из базы)
        const lk = JSON.stringify(m.look || {});
        if (p.lookRaw !== lk) { p.lookRaw = lk; p.look = freeLook(m.look); p._sig = null; if (p.v) serverLook(p, m, true); }
      }
    }
    for (const [key, p] of S.players) if (!seen.has(key) && !p.leaving) p.leaving = now();
    const n = 1 + [...S.players.values()].filter(p => !p.leaving).length;
    S.q('.wldOnline').textContent = `👥 ${n} ${n % 10 === 1 && n % 100 !== 11 ? 'игрок' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'игрока' : 'игроков'}`;
  }
  // Кто это на самом деле: пропуск → ник/роль/VIP/уровень из базы; иначе «не проверен»
  async function identify(p, m){
    if (!p.uid || typeof m.pass !== 'string' || !p.pubRaw) { p.v = null; return; }
    const ck = m.pass + '|' + p.pubRaw;
    let v = S.checkCache.get(ck);
    const st = S;
    if (v === undefined) {
      try { const { data, error } = await sbClient.rpc('world_check', { p_pass: m.pass, p_pub: p.pubRaw }); v = error ? null : data || null; } catch (e) { v = null; }
      if (S !== st) return;
      st.checkCache.set(ck, v);
    }
    if (!v || v.uid !== p.uid) { p.v = null; return; }
    p.v = v; p.nick = v.nick || p.nick;
    if (v.banned) st.muted.add(p.key);
    await serverLook(p, m, false);
  }
  // Образ проверенного игрока: платное — из базы (char_looks), бесплатные части человечка и свои цвета — из присутствия
  async function serverLook(p, m, fresh){
    try {
      const looks = await window.D37Char?.looksOf?.([p.uid], fresh);
      if (looks && looks[p.uid] && S && S.players.get(p.key) === p) { p.look = Object.assign(freeLook(m.look), looks[p.uid]); p._sig = null; }
    } catch (e) {}
  }
  async function loadFriends(){
    const st = S;
    if (!st.me.uid || typeof sbClient === 'undefined' || !sbClient) return;
    try {
      const { data } = await sbClient.from('friendships').select('requester_id,addressee_id,status').or(`requester_id.eq.${st.me.uid},addressee_id.eq.${st.me.uid}`);
      (data || []).forEach(r => { if (r.status === 'accepted') st.friends.add(r.requester_id === st.me.uid ? r.addressee_id : r.requester_id); });
    } catch (e) {}
    // своя роль — для кнопок модератора (у получателей она проверяется заново по пропуску)
    for (let k = 0; k < 20 && !st.pass && !st.stopped; k++) await new Promise(r => setTimeout(r, 500));
    if (st.pass && S === st) { try { const { data } = await sbClient.rpc('world_check', { p_pass: st.pass, p_pub: st.keys.pub }); if (data && S === st) { st.me.v = data; st.myRole = data.role; } } catch (e) {} }
  }

  async function send(d){
    if (!S?.ch || !S.keys) return;
    d.ts = Math.max(Date.now(), S.lastTs + 1);
    S.lastTs = d.ts;
    const m = JSON.stringify(d);
    try { S.ch.send({ type: 'broadcast', event: 'w', payload: { k: S.key, m, s: await sign(S.keys.kp.privateKey, m) } }); } catch (e) {}
  }
  function flushPending(){
    const keep = [];
    for (const it of S.pending) { if (now() - it.at > 4000) continue; const p = S.players.get(it.pl.k); if (p && p.pub) onMsg(it.pl); else keep.push(it); }
    S.pending = keep;
  }
  async function onMsg(pl){
    if (!S || !pl || typeof pl.k !== 'string' || typeof pl.m !== 'string' || typeof pl.s !== 'string' || pl.m.length > 3000) return;
    const p = S.players.get(pl.k);
    if (!p || !p.pub) { if (S.pending.length < 40) S.pending.push({ pl, at: now() }); return; }
    if (!await verify(p.pub, pl.s, pl.m) || !S) return;
    let d;
    try { d = JSON.parse(pl.m); } catch (e) { return; }
    if (!d || typeof d.t !== 'string' || !(d.ts > p.lastTs)) return;
    p.lastTs = d.ts;
    // защита от флуда: не больше 8 событий за 2 с
    const t = now();
    p.rate = p.rate.filter(x => t - x < 2000);
    if (p.rate.length >= 8) return;
    p.rate.push(t);
    const num_ = v => (typeof v === 'number' && isFinite(v) ? v : null);
    if (d.t === 'mv') {
      const fx = num_(d.fx), fy = num_(d.fy), x = num_(d.x), y = num_(d.y);
      if (fx === null || fy === null || x === null || y === null) return;
      if (dist(p.x, p.y, fx, fy) > 60) { p.x = clampX(fx); p.y = clampY(fy); }
      p.path = findPath(S.M, p.x, p.y, clampX(x), clampY(y));
    } else if (d.t === 'hi') {
      // старожил (кто раньше всех в комнате) шлёт новичку одним сообщением, где все стоят
      const elders = [S.me, ...[...S.players.values()].filter(x => !x.leaving && x.key !== p.key)].sort((a, b) => (a.at || S.joinedAt) - (b.at || S.joinedAt));
      if (elders[0] === S.me && now() - S.hostSnapAt > 1500) {
        S.hostSnapAt = now();
        const list = [S.me, ...S.players.values()].filter(x => !x.leaving && x.key !== p.key).slice(0, 40)
          .map(x => { const tg = x.path.length ? x.path[x.path.length - 1] : [x.x, x.y]; return [x.key, Math.round(x.x), Math.round(x.y), Math.round(tg[0]), Math.round(tg[1])]; });
        setTimeout(() => send({ t: 'snap', list }), 200);
      }
    } else if (d.t === 'snap') {
      if (!Array.isArray(d.list)) return;
      for (const it of d.list.slice(0, 40)) {
        if (!Array.isArray(it) || it[0] === S.key) continue;
        const o = S.players.get(it[0]);
        if (!o || [1, 2, 3, 4].some(i => typeof it[i] !== 'number')) continue;
        if (o.key === p.key || Date.now() - S.joinedAt < 8000) { o.x = clampX(it[1]); o.y = clampY(it[2]); o.path = findPath(S.M, o.x, o.y, clampX(it[3]), clampY(it[4])); }
      }
    } else if (d.t === 'say') {
      if (!p.uid || S.muted.has(p.key) || typeof d.text !== 'string') return;
      say(p, d.text);
    } else if (d.t === 'emo') {
      if (EMOS.includes(d.e) && !S.muted.has(p.key)) p.emo = { e: d.e, t: now() };
    } else if (d.t === 'inv') {
      if (d.to !== S.key || S.muted.has(p.key) || typeof d.g !== 'string' || typeof d.code !== 'string') return;
      if (!/^[a-z0-9]{4,12}$/.test(d.code) || !(typeof GAMES !== 'undefined' && GAMES.some(g => g.id === d.g)) || NO_ROOM.has(d.g)) return;
      showInvite(p, d.g, d.code, !!d.coop);
    } else if (d.t === 'mute') {
      if (!p.v || !['admin', 'moderator'].includes(p.v.role) || typeof d.to !== 'string') return;
      S.muted.add(d.to);
      const who = S.players.get(d.to);
      if (who) { who.bubble = null; addLog(null, `🔇 ${p.v.nick} заглушил(а) игрока ${who.nick}`); }
      if (d.to === S.key) addLog(null, '🔇 Модератор заглушил тебя: другие не видят твоих сообщений');
    }
  }
  const clampX = x => Math.max(30, Math.min(W - 30, x)), clampY = y => Math.max(60, Math.min(H - 30, y));
  function sendMove(x, y){
    const d = { t: 'mv', fx: Math.round(S.me.x), fy: Math.round(S.me.y), x: Math.round(x), y: Math.round(y) };
    // не чаще раза в 0,4 с: последнее нажатие досылаем
    const wait = 400 - (Date.now() - S.lastSent);
    clearTimeout(S.sendQ);
    if (wait <= 0) { S.lastSent = Date.now(); send(d); }
    else S.sendQ = setTimeout(() => { S.lastSent = Date.now(); send({ ...d, fx: Math.round(S.me.x), fy: Math.round(S.me.y) }); }, wait);
  }
  function walkTo(x, y){
    x = clampX(x); y = clampY(y);
    S.me.path = findPath(S.M, S.me.x, S.me.y, x, y);
    if (!S.me.path.length) return;
    S.target = { x: S.me.path[S.me.path.length - 1][0], y: S.me.path[S.me.path.length - 1][1], t: now() };
    sendMove(S.target.x, S.target.y);
  }
  function say(p, text){
    const t = clean(text);
    if (!t) return;
    p.bubble = { text: t, t: now() };
    addLog(p, t);
  }
  function emote(e){
    if (Date.now() - (S.lastEmo || 0) < 900) return;
    S.lastEmo = Date.now();
    S.me.emo = { e, t: now() };
    send({ t: 'emo', e });
  }
  function addLog(p, text){
    S.log.push({ who: p ? p.nick : '', me: p === S.me, sys: !p, text });
    if (S.log.length > 40) S.log.shift();
    const box = S.q('.wld-log');
    box.innerHTML = S.log.slice(-6).map(l => l.sys ? `<div class="sys">${esc(l.text)}</div>` : `<div${l.me ? ' class="me"' : ''}><b>${esc(l.who)}:</b> ${esc(l.text)}</div>`).join('');
  }
  function status(t){ const s = S?.q('.wld-status'); if (!s) return; s.hidden = !t; s.textContent = t; }

  // ── Окна: игрок, портал, приглашение ──
  function closePops(){ S.q('.wld-card').hidden = true; S.q('.wld-panel').hidden = true; }
  function badges(p){
    const v = p.v, out = [];
    if (v?.role && ROLE[v.role]) out.push(`<span class="wld-b" style="color:${ROLE[v.role][1]}">${ROLE[v.role][0]} ${ROLE[v.role][2]}</span>`);
    if (v?.vip) out.push(`<span class="wld-b" style="color:${VIPC[v.vip] || '#facc15'}">✨ VIP ${esc(v.vip)}</span>`);
    if (v?.level) out.push(`<span class="wld-b">⭐ ${v.level} ур.</span>`);
    if (!p.uid) out.push('<span class="wld-b dim">гость</span>');
    else if (!v) out.push('<span class="wld-b dim">не проверен</span>');
    if (p.uid && S.friends.has(p.uid)) out.push('<span class="wld-b" style="color:#4ade80">💚 друг</span>');
    return out.join('');
  }
  async function openCard(p){
    const box = S.q('.wld-card');
    S.q('.wld-panel').hidden = true;
    S.cardFor = p.key;
    const img = window.D37Char ? window.D37Char.img(p.look, 64) : '';
    const head = `<div class="wld-ch"><img src="${img}" alt=""><div><b>${esc(p.nick)}</b><div class="wld-bs">${badges(p)}</div></div><button type="button" class="wld-x" data-act="close" aria-label="Закрыть">✕</button></div>`;
    if (p === S.me) {
      box.innerHTML = head + `<div class="wld-acts"><button type="button" data-act="look">🎭 Сменить персонажа</button>${S.me.uid ? `<button type="button" data-act="profile:${S.me.uid}">👤 Мой профиль</button>` : '<button type="button" data-act="login">🔑 Войти</button>'}</div>`;
      box.hidden = false;
      return;
    }
    const acts = [];
    if (p.uid) acts.push(`<button type="button" data-act="profile:${p.uid}">👤 Профиль</button>`);
    if (p.uid && S.me.uid) acts.push('<button type="button" data-act="friend" class="wldFriend">…</button>');
    else if (p.uid) acts.push('<button type="button" data-act="login">➕ Войди, чтобы дружить</button>');
    acts.push('<button type="button" data-act="invite">🎮 Позвать в игру</button>');
    acts.push(`<button type="button" data-act="mutelocal">${S.muted.has(p.key) ? '🔊 Показывать сообщения' : '🔇 Скрыть сообщения'}</button>`);
    if (['admin', 'moderator'].includes(S.myRole)) acts.push('<button type="button" data-act="mute" class="warn">🚫 Заглушить для всех</button>');
    box.innerHTML = head + `<div class="wld-acts">${acts.join('')}</div><div class="wld-sub" hidden></div>`;
    box.hidden = false;
    if (p.uid && S.me.uid && typeof getFriendshipStatus === 'function') {
      const st = await getFriendshipStatus(p.uid);
      const b = box.querySelector('.wldFriend');
      if (!b || S.cardFor !== p.key) return;
      const T = { none: ['➕ В друзья', 'friend-add'], pending_sent: ['⏳ Заявка отправлена', 'noop'], pending_received: ['✅ Принять в друзья', 'friend-accept'], friends: ['✉ Написать', 'friend-dm'], self: ['', 'noop'] }[st] || ['➕ В друзья', 'friend-add'];
      b.textContent = T[0]; b.dataset.act = T[1];
      if (st === 'friends') S.friends.add(p.uid);
    }
  }
  function openPortal(pt){
    const box = S.q('.wld-panel');
    S.q('.wld-card').hidden = true;
    let body = '';
    if (pt.id === 'games') body = `<p>Все игры сайта: с ботами, на скорость и с друзьями онлайн.</p><div class="wld-acts"><button type="button" class="ct-start" data-act="go:#/games">🎮 Открыть все игры</button></div>`;
    else if (pt.id === 'wardrobe') body = `<p>Собери своего персонажа — так тебя видят все в мире и в играх.</p><div class="wld-acts"><button type="button" class="ct-start" data-act="look">🎭 Открыть гардероб</button></div>`;
    else if (pt.id === 'stage') {
      const live = S.live;
      body = live ? `<p><b class="wld-live">🔴 Денчик сейчас в эфире!</b> Заходи на стрим.</p><div class="wld-acts"><a class="ct-start" href="https://www.twitch.tv/dan4ik37" target="_blank" rel="noopener">▶ Смотреть стрим</a><button type="button" data-act="go:#/chat">💬 Чат сайта</button></div>`
        : `<p>Сейчас стрима нет. Смотри ролики Денчика — их почти 6000.</p><div class="wld-acts"><a class="ct-start" href="/videos">🎬 Все видео</a><a href="https://www.twitch.tv/dan4ik37" target="_blank" rel="noopener">📺 Канал на Twitch</a></div>`;
    } else {
      const list = (MODES[pt.id] || []).map(gameInfo);
      body = `<div class="wld-modes">${list.map(g => `<div class="wld-mode"><span class="wld-mi">${g.icon}</span><span class="wld-mt"><b>${esc(g.title)}</b>${g.desc ? `<small>${esc(g.desc)}</small>` : ''}</span>
          <span class="wld-mb"><button type="button" class="ct-start" data-act="go:#/games/${g.id}">▶ Играть</button>${NO_ROOM.has(g.id) ? '' : `<button type="button" data-act="room:${g.id}">👥 С другом</button>`}${COOP.has(g.id) ? `<button type="button" data-act="coop:${g.id}">🤝 Вместе</button>` : ''}</span></div>`).join('')}</div>`;
    }
    box.innerHTML = `<div class="wld-ph"><span class="wld-pe">${pt.e}</span><b>${esc(pt.name)}</b><button type="button" class="wld-x" data-act="close" aria-label="Закрыть">✕</button></div>${body}`;
    box.hidden = false;
  }
  function inviteMenu(p){
    const sub = S.q('.wld-card .wld-sub');
    if (!sub) return;
    sub.hidden = false;
    sub.innerHTML = `<div class="wld-sublbl">Во что позвать ${esc(p.nick)}?</div><div class="wld-chips">${QUICK.map(gameInfo).map(g => `<button type="button" data-act="inv:${g.id}">${g.icon} ${esc(g.title)}${COOP.has(g.id) ? ' (вместе)' : ''}</button>`).join('')}</div>`;
  }
  function roomUrl(g, code, coop){ return `#/games/${g}/${coop ? 'coop/' : ''}${code}`; }
  function showInvite(p, g, code, coop){
    const box = S.q('.wld-inv'), gi = gameInfo(g);
    box.innerHTML = `<div>${gi.icon} <b>${esc(p.nick)}</b> зовёт тебя в «${esc(gi.title)}»${coop ? ' (вместе)' : ''}</div><div class="wld-acts"><button type="button" class="ct-start" data-act="accept">▶ Играть</button><button type="button" data-act="decline">Нет</button></div>`;
    box.dataset.url = roomUrl(g, code, coop);
    box.hidden = false;
    api?.sfx?.('ok');
    clearTimeout(S.invT);
    S.invT = setTimeout(() => { box.hidden = true; }, 40000);
  }

  function onAct(a, b){
    activity();
    const p = S.players.get(S.cardFor);
    if (a === 'close') closePops();
    else if (a === 'look') openEditor();
    else if (a === 'login') { if (typeof openGlobalAuth === 'function') openGlobalAuth(); }
    else if (a === 'help') { addLog(null, '👋 Нажимай на землю — персонаж идёт туда (или WASD/стрелки). Порталы ведут в игры. Нажми на игрока: профиль, дружба, позвать в игру. Писать в чат могут вошедшие.'); }
    else if (a.startsWith('profile:')) location.hash = '#/profile/' + a.slice(8);
    else if (a.startsWith('go:')) location.hash = a.slice(3);
    else if (a.startsWith('room:')) location.hash = roomUrl(a.slice(5), newCode(), false);
    else if (a.startsWith('coop:')) location.hash = roomUrl(a.slice(5), newCode(), true);
    else if (a === 'friend-add' && p && typeof sendFriendRequest === 'function') { sendFriendRequest(p.uid); b.textContent = '⏳ Заявка отправлена'; b.dataset.act = 'noop'; }
    else if (a === 'friend-accept' && p && typeof acceptFriendRequest === 'function') { acceptFriendRequest(p.uid); b.textContent = '✉ Написать'; b.dataset.act = 'friend-dm'; S.friends.add(p.uid); }
    else if (a === 'friend-dm' && p) { if (typeof openDmWith === 'function') openDmWith(p.uid, p.nick); }
    else if (a === 'invite' && p) inviteMenu(p);
    else if (a.startsWith('inv:') && p) {
      const g = a.slice(4), coop = COOP.has(g), code = newCode();
      send({ t: 'inv', to: p.key, g, code, coop });
      addLog(null, `📨 Позвал(а) ${p.nick} в «${gameInfo(g).title}» — ждём в комнате`);
      setTimeout(() => { location.hash = roomUrl(g, code, coop); }, 400);
    }
    else if (a === 'mutelocal' && p) { if (S.muted.has(p.key)) S.muted.delete(p.key); else { S.muted.add(p.key); p.bubble = null; } openCard(p); }
    else if (a === 'mute' && p) { if (confirm(`Заглушить ${p.nick} для всех в этом мире до конца визита?`)) { send({ t: 'mute', to: p.key }); S.muted.add(p.key); p.bubble = null; closePops(); } }
    else if (a === 'accept') { const box = S.q('.wld-inv'); box.hidden = true; if (box.dataset.url) location.hash = box.dataset.url; }
    else if (a === 'decline') S.q('.wld-inv').hidden = true;
    else if (a === 'mode') {
      let f = false;
      try { f = localStorage.getItem('d37_world_2d') === '1'; localStorage.setItem('d37_world_2d', f ? '0' : '1'); } catch (e) {}
      const el = root, ga = api;
      unmount(); mount(el);
      api = ga;
      toast(f ? '🧊 Включаем объёмный мир…' : '🗺️ Плоский мир — легче для слабых телефонов');
    }
    else if (a === 'rejoin') { S.q('.wld-status').hidden = true; S.stopped = false; S.idleAt = Date.now(); join(1); S.last = now(); S.raf = requestAnimationFrame(frame); }
  }
  const newCode = () => window.GameRoom?.newCode?.() || Math.random().toString(36).slice(2, 8);

  async function checkLive(){
    const st = S;
    try { const s = JSON.parse(sessionStorage.getItem('d37_live') || 'null'); if (s && Date.now() - s.t < 120e3) { st.live = s.live; return; } } catch (e) {}
    try {
      const t = await fetch('https://decapi.me/twitch/uptime/dan4ik37', { cache: 'no-store' }).then(r => r.ok ? r.text() : '');
      st.live = !!t && !/offline|error|not found|could not|invalid/i.test(t);
      try { sessionStorage.setItem('d37_live', JSON.stringify({ t: Date.now(), live: st.live })); } catch (e) {}
    } catch (e) { st.live = false; }
  }

  // Раз в секунду: простой, скрытая вкладка, ушедшие игроки
  function housekeeping(){
    if (!S || S.stopped) return;
    if (Date.now() - S.idleAt > IDLE_MS || (S.hiddenAt && Date.now() - S.hiddenAt > HIDDEN_MS)) {
      S.stopped = true;
      leaveChannel();
      cancelAnimationFrame(S.raf);
      S.players.clear();
      const s = S.q('.wld-status');
      s.hidden = false;
      s.innerHTML = `😴 Ты долго стоял на месте — мы вывели тебя из мира, чтобы не держать место.<br><button type="button" class="ct-start" data-act="rejoin">🌍 Вернуться в мир</button>`;
      return;
    }
    for (const [key, p] of S.players) if (p.leaving && now() - p.leaving > 600) S.players.delete(key);
    if (S.pending.length) flushPending();
  }

  // ── Кадр: движение и рисование ──
  function step(p, dt){
    if (!p.path.length) { p.moving = false; return; }
    let left = SPEED * dt;
    while (left > 0 && p.path.length) {
      const [tx, ty] = p.path[0], d = dist(p.x, p.y, tx, ty);
      if (d <= left) { p.x = tx; p.y = ty; p.path.shift(); left -= d; }
      else { p.dir = tx < p.x ? -1 : tx > p.x ? 1 : p.dir; p.face = faceOf(tx - p.x, ty - p.y, p.face); p.x += (tx - p.x) / d * left; p.y += (ty - p.y) / d * left; left = 0; }
    }
    p.moving = p.path.length > 0;
  }
  // Куда смотрит: 0 — к нам (вниз), 1 — вправо, 2 — от нас (вверх), 3 — влево
  const faceOf = (dx, dy, cur) => Math.abs(dx) < .01 && Math.abs(dy) < .01 ? cur : Math.abs(dx) > Math.abs(dy) * 1.15 ? (dx > 0 ? 1 : 3) : (dy > 0 ? 0 : 2);
  function stepKeys(dt){
    if (!S.keysDown.size) return;
    let dx = 0, dy = 0;
    if (S.keysDown.has('l')) dx--; if (S.keysDown.has('r')) dx++; if (S.keysDown.has('u')) dy--; if (S.keysDown.has('d')) dy++;
    if (!dx && !dy) return;
    const l = Math.hypot(dx, dy), vx = dx / l * SPEED * dt, vy = dy / l * SPEED * dt;
    const free = (x, y) => { const [gx, gy] = cellOf(x, y); return !S.M.block[gy * GW + gx]; };
    const me = S.me;
    me.path = [];
    if (free(me.x + vx, me.y)) me.x = clampX(me.x + vx);
    if (free(me.x, me.y + vy)) me.y = clampY(me.y + vy);
    if (dx) me.dir = dx < 0 ? -1 : 1;
    me.face = faceOf(dx, dy, me.face);
    me.moving = true;
    if (Date.now() - S.kbAt > 500) { S.kbAt = Date.now(); sendMove(me.x + dx / l * 140, me.y + dy / l * 140); }
  }
  function frame(t){
    if (!S || S.stopped) return;
    S.raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(.05, (t - S.last) / 1000);
    S.last = t;
    if (S.keysDown.size) stepKeys(dt); else step(S.me, dt);
    for (const p of S.players.values()) step(p, dt);
    // портал под ногами
    const pt = PORTALS.find(p => dist(S.me.x, S.me.y, p.x, p.y) < 60);
    if (pt && S.portalIn !== pt.id) { S.portalIn = pt.id; S.me.path = []; S.keysDown.clear(); openPortal(pt); api?.sfx?.('ok'); }
    else if (!pt) S.portalIn = null;
    if (t - (S.posSaved || 0) > 3000) { S.posSaved = t; try { localStorage.setItem('d37_world_pos', JSON.stringify({ x: Math.round(S.me.x), y: Math.round(S.me.y) })); } catch (e) {} }
    if (S.g3) draw3d(t / 1000, dt); else if (!S.editing) draw(t / 1000);
  }
  // ── Свой персонаж прямо в мире: окно редактора (js/games/charedit.js) поверх мира, мир на паузе ──
  async function openEditor(){
    if (!window.D37Editor || !window.World3D?.supported()) { location.hash = '#/games/wardrobe'; return; }
    if (S.editing) return;
    const st0 = S, box = document.createElement('div');
    box.className = 'wld-edit';
    document.body.appendChild(box);   // поверх всего сайта (шапка, нижнее меню)
    document.documentElement.classList.add('wld-editing');
    S.editing = box;
    S.keysDown.clear(); S.me.path = [];
    S.g3?.setPaused(true);
    closePops();
    const ok = await window.D37Editor.mount(box, { api, key: S.key, onClose: closeEditor });
    if (!ok && S === st0) { closeEditor(); location.hash = '#/games/wardrobe'; }
  }
  function closeEditor(){
    if (!S?.editing) return;
    window.D37Editor?.unmount();
    S.editing.remove(); S.editing = null;
    document.documentElement.classList.remove('wld-editing');
    S.g3?.setPaused(false);
    const L = window.D37Char ? window.D37Char.look() : {};
    if (JSON.stringify(L) !== JSON.stringify(S.me.look)) {
      S.me.look = L; S.me._sig = null;
      if (S.ch && S.keys) S.ch.track(presenceMeta()).catch(() => {});
      toast('🎭 Новый образ — его видят все в мире');
    }
  }
  // ── Объёмный мир: World3D (js/games/world3d.js) + подписи и пузыри — HTML поверх ──
  function enable3D(){
    try { S.g3 = window.World3D.create(S.wrap, { M: S.M, PORTALS, ground: S.D.canvas, STAGE, CX, CY, W, H }); }
    catch (e) { S.g3 = null; return; }
    S.cv.style.visibility = 'hidden';
    S.tags = document.createElement('div');
    S.tags.className = 'wld-tags';
    S.wrap.appendChild(S.tags);
    S.wrap.classList.add('is3d');
    const ro3 = window.ResizeObserver ? new ResizeObserver(() => S?.g3?.resize()) : null;
    ro3?.observe(S.wrap);
    const prev = S.cleanup;
    S.cleanup = () => { prev?.(); ro3?.disconnect(); };
  }
  function draw3d(time, dt){
    const g = S.g3;
    for (const p of [S.me, ...S.players.values()]) {
      const sig = p._sig || (p._sig = JSON.stringify(p.look || {}));
      if (sig !== p._sigDone) { g.setPlayer(p.key, p.look); p._sigDone = sig; }
      g.updatePlayer(p.key, p.x, p.y, p.moving, dt, time, p.leaving ? Math.max(0, 1 - (now() - p.leaving) / 600) : 1);
      if (p.emo && p.emo.t !== p._emo3) { p._emo3 = p.emo.t; g.emote(p.key, p.emo.e, time); }
    }
    for (const k of g.keys()) if (k !== S.key && !S.players.has(k)) g.removePlayer(k);
    g.setLive(!!S.live);
    g.render(time, dt, S.me.x, S.me.y);
    drawTags();
  }
  function drawTags(){
    const all = [S.me, ...S.players.values()], seen = new Set();
    for (const p of all) {
      let el = p._tag;
      if (!el) {
        el = p._tag = document.createElement('div');
        el.className = 'wld-tag';
        el.innerHTML = '<div class="wld-tbub" hidden></div><div class="wld-temo" hidden></div><b class="wld-tname"></b>';
        S.tags.appendChild(el);
      }
      seen.add(el);
      const [sx, sy, vis] = S.g3.project(p.x, p.y, S.g3.tagY(p.key));
      if (!vis || (p.leaving && now() - p.leaving > 500)) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${Math.round(sx)}px,${Math.round(sy)}px) translate(-50%,-100%)`;
      // имя: роль, VIP, друг, уровень
      let col = '#ffffff', pre = '';
      if (p === S.me) col = '#93c5fd'; else if (!p.uid) col = '#cbd5e1';
      if (p.v?.vip) col = VIPC[p.v.vip] || col;
      if (p.v?.role && ROLE[p.v.role]) { col = ROLE[p.v.role][1]; pre = ROLE[p.v.role][0] + ' '; }
      if (p.uid && S.friends.has(p.uid)) pre = '💚 ' + pre;
      const name = pre + (p.v?.level ? `⭐${p.v.level} ` : '') + p.nick + (p.uid && !p.v && p !== S.me ? ' ?' : '');
      const nm = el.lastChild;
      if (nm.textContent !== name) nm.textContent = name;
      if (nm.style.color !== col) nm.style.color = col;
      const bub = el.firstChild, showB = p.bubble && now() - p.bubble.t < 7000 && !S.muted.has(p.key);
      if (showB) { if (bub.textContent !== p.bubble.text) bub.textContent = p.bubble.text; bub.hidden = false; } else { bub.hidden = true; if (p.bubble && now() - p.bubble.t >= 7000) p.bubble = null; }
      const em = el.children[1], k = p.emo ? (now() - p.emo.t) / 2200 : 1;
      if (k < 1) { if (em.textContent !== p.emo.e) em.textContent = p.emo.e; em.hidden = false; em.style.opacity = Math.min(1, (1 - k) * 2); em.style.transform = `translateY(${-k * 30}px)`; }
      else { em.hidden = true; if (p.emo) p.emo = null; }
    }
    for (const el of [...S.tags.children]) if (!seen.has(el)) el.remove();
  }
  function draw(time){
    const { ctx, z, dpr, cw, ch_ } = S, D = S.D, M = S.M;
    const vw = cw / z, vh = ch_ / z;
    S.camX = Math.max(0, Math.min(W - vw, S.me.x - vw / 2));
    S.camY = Math.max(0, Math.min(H - vh, S.me.y - vh / 2 - 30));
    if (vw > W) S.camX = (W - vw) / 2;
    if (vh > H) S.camY = (H - vh) / 2;
    const cx = S.camX, cy = S.camY;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1d4428'; ctx.fillRect(0, 0, cw, ch_);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, -cx * dpr * z, -cy * dpr * z);
    const sx = Math.max(0, cx), sy = Math.max(0, cy), sw = Math.min(W - sx, vw), sh = Math.min(H - sy, vh);
    if (sw > 0 && sh > 0) ctx.drawImage(D.canvas, sx, sy, sw, sh, sx, sy, sw, sh);
    const vis = (x, y, m = 120) => x > cx - m && x < cx + vw + m && y > cy - m && y < cy + vh + m;
    // вода фонтана
    if (vis(CX, CY, 140)) {
      const gr = ctx.createRadialGradient(CX, CY, 10, CX, CY, 90);
      gr.addColorStop(0, '#7dd3fc'); gr.addColorStop(1, '#0369a1');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(CX, CY, 88, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) { const r = ((time * 26 + k * 28) % 84); ctx.globalAlpha = 1 - r / 84; ctx.beginPath(); ctx.arc(CX, CY, r + 4, 0, 7); ctx.stroke(); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#cbd5e1'; ctx.beginPath(); ctx.arc(CX, CY, 16, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(186,230,253,.9)';
      for (let k = 0; k < 6; k++) { const a = time * 2 + k; ctx.beginPath(); ctx.arc(CX + Math.cos(a) * 10, CY - 22 - Math.abs(Math.sin(time * 3 + k)) * 18, 3, 0, 7); ctx.fill(); }
    }
    // порталы: кольцо и парящий значок
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of PORTALS) {
      if (!vis(p.x, p.y, 160)) continue;
      const pulse = (Math.sin(time * 3 + p.a) + 1) / 2;
      ctx.strokeStyle = p.color; ctx.lineWidth = 6; ctx.globalAlpha = .35 + pulse * .5;
      ctx.beginPath(); ctx.arc(p.x, p.y, 70 + pulse * 10, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = '58px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
      ctx.fillText(p.e, p.x, p.y - 8 - Math.sin(time * 2 + p.a) * 6);
    }
    // экран сцены
    if (vis(STAGE.x + STAGE.w / 2, STAGE.y + STAGE.h / 2, 200)) {
      ctx.fillStyle = '#111827'; roundRect(ctx, STAGE.x - 8, STAGE.y - 8, STAGE.w + 16, STAGE.h + 16, 12); ctx.fill();
      const g2 = ctx.createLinearGradient(STAGE.x, STAGE.y, STAGE.x + STAGE.w, STAGE.y + STAGE.h);
      g2.addColorStop(0, S.live ? '#7c3aed' : '#1e1b4b'); g2.addColorStop(1, S.live ? '#db2777' : '#312e81');
      ctx.fillStyle = g2; ctx.fillRect(STAGE.x, STAGE.y, STAGE.w, STAGE.h);
      ctx.fillStyle = '#fff'; ctx.font = '900 30px Oswald, Montserrat, sans-serif';
      ctx.fillText(S.live ? '🔴 В ЭФИРЕ' : 'DAN4IK37', STAGE.x + STAGE.w / 2, STAGE.y + STAGE.h / 2 - 14);
      ctx.font = '700 16px Montserrat, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fillText(S.live ? 'Денчик стримит — заходи!' : 'Стрим скоро · смотри видео', STAGE.x + STAGE.w / 2, STAGE.y + STAGE.h / 2 + 22);
      ctx.fillStyle = '#374151'; ctx.fillRect(STAGE.x + STAGE.w / 2 - 6, STAGE.y + STAGE.h + 8, 12, 46);
    }
    // цель
    if (S.target && S.me.path.length) {
      const k = ((time * 1.6) % 1);
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 3; ctx.globalAlpha = 1 - k;
      ctx.beginPath(); ctx.ellipse(S.target.x, S.target.y, 8 + k * 16, 4 + k * 8, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // всё, что стоит, — по высоте (кто ниже на экране — тот впереди)
    const items = [];
    for (const t of M.trees) if (vis(t.x, t.y)) items.push({ y: t.y, f: () => ctx.drawImage(D.tree[t.v], t.x - 60 * t.r / 28, t.y - 126 * t.r / 28, 120 * t.r / 28, 140 * t.r / 28) });
    for (const l of M.lamps) if (vis(l.x, l.y)) items.push({ y: l.y, f: () => { ctx.drawImage(D.lamp, l.x - 20, l.y - 104); } });
    for (const b of M.benches) if (vis(b.x, b.y)) items.push({ y: b.y, f: () => drawBench(ctx, b) });
    const all = [S.me, ...S.players.values()];
    for (const p of all) if (vis(p.x, p.y)) items.push({ y: p.y, f: () => drawPlayer(ctx, p, time) });
    items.sort((a, b) => a.y - b.y).forEach(it => it.f());
    // подписи и пузыри — поверх всего
    for (const p of all) if (vis(p.x, p.y)) drawTag(ctx, p, time);
  }
  function drawBench(ctx, b){
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a + Math.PI / 2);
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(-30, -4, 60, 14);
    ctx.fillStyle = '#8b5a2b'; ctx.fillRect(-30, -10, 60, 8); ctx.fillRect(-30, -1, 60, 6);
    ctx.fillStyle = '#4b3621'; ctx.fillRect(-26, 4, 5, 8); ctx.fillRect(21, 4, 5, 8);
    ctx.restore();
  }
  function drawPlayer(ctx, p, time){
    if (!window.D37Char) return;
    const fade = p.leaving ? Math.max(0, 1 - (now() - p.leaving) / 600) : Math.min(1, (now() - p.born) / 400);
    const bob = p.moving ? -Math.abs(Math.sin(time * 12 + p.phase)) * 4 : 0;
    // шагающий персонаж (avatar.js: walker — 4 стороны и анимация шага); старый кэш скрипта — обычный спрайт
    const C = window.D37Char, s = C.walker ? C.walker(p.look, 54, { face: p.face, moving: p.moving, t: time + p.phase }) : C.sprite(p.look, 54, { t: time, dir: p.dir });
    ctx.globalAlpha = fade;
    ctx.drawImage(s.c, p.x - s.ax, p.y - s.ay + (C.walker ? 0 : bob));
    ctx.globalAlpha = 1;
  }
  function drawTag(ctx, p, time){
    const z = S.z, fs = Math.round(13 / Math.min(1, z)), y0 = p.y - 74;
    let col = '#ffffff', pre = '';
    if (p === S.me) col = '#93c5fd';
    else if (!p.uid) col = '#cbd5e1';
    if (p.v?.vip) col = VIPC[p.v.vip] || col;
    if (p.v?.role && ROLE[p.v.role]) { col = ROLE[p.v.role][1]; pre = ROLE[p.v.role][0] + ' '; }
    if (p.uid && S.friends.has(p.uid)) pre = '💚 ' + pre;
    const lvl = p.v?.level ? `⭐${p.v.level} ` : '';
    const name = pre + lvl + p.nick + (p.uid && !p.v && p !== S.me ? ' ?' : '');
    ctx.font = `800 ${fs}px Montserrat, sans-serif`;
    ctx.lineWidth = Math.max(3, fs / 4); ctx.strokeStyle = 'rgba(10,8,24,.85)'; ctx.lineJoin = 'round';
    ctx.strokeText(name, p.x, y0); ctx.fillStyle = col; ctx.fillText(name, p.x, y0);
    // пузырь с сообщением
    if (p.bubble && now() - p.bubble.t < 7000 && !S.muted.has(p.key)) {
      const a = Math.min(1, (7000 - (now() - p.bubble.t)) / 600);
      const lines = wrapText(ctx, p.bubble.text, 200 / Math.min(1, z), `600 ${fs}px Montserrat, sans-serif`).slice(0, 3);
      ctx.font = `600 ${fs}px Montserrat, sans-serif`;
      const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 18, h = lines.length * (fs + 4) + 12, bx = p.x - w / 2, by = y0 - 12 - h;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(255,255,255,.96)'; roundRect(ctx, bx, by, w, h, 10); ctx.fill();
      ctx.beginPath(); ctx.moveTo(p.x - 6, by + h); ctx.lineTo(p.x + 6, by + h); ctx.lineTo(p.x, by + h + 7); ctx.fill();
      ctx.fillStyle = '#111827';
      lines.forEach((l, i) => ctx.fillText(l, p.x, by + 6 + (fs + 4) * i + fs / 2 + 2));
      ctx.globalAlpha = 1;
    } else if (p.bubble && now() - p.bubble.t >= 7000) p.bubble = null;
    // эмоция
    if (p.emo) {
      const k = (now() - p.emo.t) / 2200;
      if (k >= 1) p.emo = null;
      else { ctx.globalAlpha = Math.min(1, (1 - k) * 2); ctx.font = `${Math.round(34 / Math.min(1, z))}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`; ctx.fillText(p.emo.e, p.x, y0 - 30 - k * 40); ctx.globalAlpha = 1; }
    }
  }
  function wrapText(ctx, text, maxW, font){
    ctx.font = font;
    const words = text.split(/\s+/), lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function unmount(){
    if (!S) return;
    S.stopped = true;
    cancelAnimationFrame(S.raf);
    clearInterval(S.tick); clearTimeout(S.sendQ); clearTimeout(S.invT);
    try { localStorage.setItem('d37_world_pos', JSON.stringify({ x: Math.round(S.me.x), y: Math.round(S.me.y) })); } catch (e) {}
    if (S.editing) { window.D37Editor?.unmount(); S.editing.remove(); S.editing = null; document.documentElement.classList.remove('wld-editing'); }
    leaveChannel();
    S.cleanup?.();
    try { S.g3?.dispose(); } catch (e) {}
    S = null;
  }

  window.GAME_IMPL.world = {
    mount(el, gameApi){ root = el; api = gameApi; mount(el); },
    unmount(){ unmount(); root = null; },
    get state(){ return S; },
    _test: { buildMap, findPath, lineFree, cellOf, clean, freeLook, PORTALS, W, H, CELL, GW, GH, CX, CY, makeKeys, sign, verify, importPub },
  };
})();
