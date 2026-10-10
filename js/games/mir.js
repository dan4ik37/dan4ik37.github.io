// ═══════════════════════════════════════
//  «МИР ДЕНЧИКА» 3D (#/games/world) — общий мир на движке D37E: площадь с фонтаном, кафе со столиками (сел за стол —
//  партия началась), игровой клуб с автоматами и бильярдом, сцена со статусом стрима, гардероб, улица с домиками (можно
//  зайти внутрь), парк с прудом и воротами в «Орду», «Арену», «Башни». Ходишь, бегаешь, прыгаешь, лазаешь — как в Роблоксе.
// ═══════════════════════════════════════
// Сеть — Supabase Realtime, канал mir-<N> (до MAX_ROOM человек): presence — кто в мире (ключ подписи, пропуск, образ, где
// стоит, на каком месте сидит), broadcast 'w' — подписанные события (как в world.js): st — движение (только когда
// меняется направление/скорость/режим, раз в 2,5 с для сверки и при остановке — между сообщениями чужого персонажа ведёт
// та же физика: стены его держат), hi/snap — новичку всех сразу, say, emo, inv (позвать в игру или за столик), go (начать
// партию за столом), mute. Лимит Supabase — 2 млн сообщений в месяц по числу получателей, поэтому шагов не шлём.
// Столы: место — в presence (seat: id, код комнаты, время); код стола = код того, кто сел первым. Все места заняты (или
// «Начать» за карточным столом) — отсчёт и все уходят в #/games/<игра>/<код>: это обычная онлайн-игра сайта. Вернулся —
// стоишь у того же стола. Нет WebGL или выбран плоский мир — старый мир (world.js, GAME_IMPL.world до этого файла).
(() => {
  const OLD = window.GAME_IMPL?.world;
  const MAX_ROOM = 20, SHARDS = 6, IDLE_MS = 15 * 60e3, HIDDEN_MS = 10 * 60e3, CHAN = 'mir-';
  const EMOS = ['👋', '😂', '❤️', '🔥', '🎉', '😎', '😭', '👍', '💃'];
  const NO_ROOM = new Set(['pauk', 'wardrobe', 'clicker', 'quiz', 'wheel', 'random', 'typing', 'cps', 'fonts', 'world', 'studio']);
  const COOP = new Set(['horde', 'td']);
  const QUICK = ['chess', 'durak', 'uno', 'checkers', 'pool', 'nardy', 'arena', 'horde', 'td', 'sea'];
  const ROLE = { admin: ['👑', '#ff4d6d', 'Админ'], moderator: ['🛡️', '#4ade80', 'Модератор'], helper: ['🤝', '#38bdf8', 'Помощник'] };
  const VIPC = { gold: '#facc15', silver: '#e2e8f0', bronze: '#f59e0b' };
  const PI = Math.PI;
  const now = () => performance.now();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const gameInfo = id => (typeof GAMES !== 'undefined' && GAMES.find(g => g.id === id)) || { id, icon: '🎮', title: id, desc: '' };
  const newCode = () => window.GameRoom?.newCode?.() || Math.random().toString(36).slice(2, 8);

  // ═══ Карта (единицы движка ≈ метры × 1,17; человечек ≈ 2,3) ═══
  // Площадь в (0, 0); кафе на севере (−z), клуб на востоке, сцена на западе, улица с домиками на юг, парк на юго-востоке
  const TABLES = [
    { id: 'chess1', game: 'chess', x: -6.5, z: -39, n: 2, kind: 'chess' },
    { id: 'chess2', game: 'chess', x: -6.5, z: -33, n: 2, kind: 'chess' },
    { id: 'check1', game: 'checkers', x: -1, z: -39, n: 2, kind: 'checkers' },
    { id: 'nardy1', game: 'nardy', x: -1, z: -33, n: 2, kind: 'nardy' },
    { id: 'durak1', game: 'durak', x: 5.5, z: -39, n: 4, kind: 'cards' },
    { id: 'uno1', game: 'uno', x: 5.5, z: -33, n: 4, kind: 'uno' },
    { id: 'pool1', game: 'pool', x: 37, z: -2, n: 2, kind: 'pool' },
    { id: 'sea1', game: 'sea', x: 42, z: -8, n: 2, kind: 'sea' },
    { id: 'ttt1', game: 'ttt', x: 42, z: 4, n: 2, kind: 'ttt' },
    { id: 'ludo1', game: 'ludo', x: 12, z: 6, n: 4, kind: 'ludo' },   // на площади под зонтиком
  ];
  const ARCADE = [
    { g: '2048', x: 31, z: -10.6, yaw: 0 }, { g: 'snake', x: 33.5, z: -10.6, yaw: 0 }, { g: 'blocks', x: 36, z: -10.6, yaw: 0 }, { g: 'guess', x: 38.5, z: -10.6, yaw: 0 },
    { g: 'sudoku', x: 31, z: 6.6, yaw: PI }, { g: 'miner', x: 33.5, z: 6.6, yaw: PI }, { g: 'mahjong', x: 36, z: 6.6, yaw: PI }, { g: 'words', x: 38.5, z: 6.6, yaw: PI },
  ];
  const GATES = [
    { g: 'horde', x: 47, z: 24, yaw: -PI / 2, name: 'Орда', e: '🧟', c: '#7c3aed' },
    { g: 'arena', x: 47, z: 40, yaw: -PI / 2, name: 'Арена', e: '🔫', c: '#f97316' },
    { g: 'td', x: 30, z: 52, yaw: PI, name: 'Башни', e: '🏰', c: '#eab308' },
  ];
  const SPAWN = { x: 0, z: 11, yaw: PI };

  function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ── Чат: мат и ссылки закрываются у получателя (тот же фильтр, что в world.js) ──
  const LAT = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', '3': 'з', '0': 'о', '@': 'а' };
  const BAD = [
    /ху[йеёяюи]/u, /п[иеё]зд/u, /(?:^|[^\p{L}])бля(?!х)/u, /(?:^|[^\p{L}])(?:за|на|вы|у|от|по|до|про|раз|рас|съ|подъ|из|изъ|при|пере|недо)?[её]б(?:а|ал|ан|ат|ут|ну|ло|ли|л|ы|ош|уч|ен|ис|ыв|ыр|ет|ёт)/u,
    /(?:^|[^\p{L}])[её]б(?!\p{L})/u, /(?:^|[^\p{L}])сук(?:а+|и|е|у|ой|ин|ам)(?!\p{L})/u, /муда[кч]|мудил/u, /пид[ао]р|педик/u, /г[ао]нд[ао]н/u, /шлюх/u, /залуп/u, /дроч/u,
  ];
  function clean(text){
    const W = OLD?._test?.clean;
    if (W) return W(text);
    let s = String(text || '').replace(/[\u0000-\u001f\u200b-\u200f\u2028-\u202e]/g, '').trim().slice(0, 120);
    s = s.replace(/(?:https?:\/\/|www\.|t\.me\/|discord\.gg\/?)\S*/giu, '[ссылка]');
    const chars = s.split(''), low = chars.map(c => { const l = c.toLowerCase(); return l.length === 1 ? (LAT[l] || l) : c; }).join('');
    const mask = Array(low.length).fill(false);
    for (const re of BAD) { const g = new RegExp(re.source, 'gu'); let m; while ((m = g.exec(low))) { for (let i = m.index; i < m.index + m[0].length; i++) mask[i] = true; if (!m[0].length) g.lastIndex++; } }
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
  // ── Подпись сообщений (ECDSA P-256), как в world.js ──
  const enc = s => new TextEncoder().encode(s);
  const b64 = buf => { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function makeKeys(){ const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']); return { kp, pub: b64(await crypto.subtle.exportKey('raw', kp.publicKey)) }; }
  const importPub = pub => crypto.subtle.importKey('raw', unb64(pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const sign = async (priv, str) => b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, enc(str)));
  const verify = (pub, sig, str) => crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64(sig), enc(str)).catch(() => false);
  function freeLook(look){
    const C = window.D37Char;
    if (!C) return look || {};
    const L = C.norm(look);
    for (const s of C.SLOTS) { const p = C.part(s, L[s]); if (!p || p.price > 0 || p.vip) L[s] = C.DEFAULT[s]; }
    for (const s of C.BODY_SLOTS || []) if (look && typeof look[s] === 'string' && C.CUSTOM?.test(look[s])) L[s] = look[s];   // свои цвета — бесплатные
    return L;
  }

  // ═══ Постройка мира: меши в R.static (потом склеиваются), тела — в физике, «что можно сделать» — в interact ═══
  function buildWorld(R, ph, X, S){
    const E = window.D37E, T = R.T, K = R.K, U = E.UNIT, low = R.q === 'low';
    const st = R.static, P = (g, o) => R.part(g || st, o);
    // ── Материалы: текстуры из Unity-проекта (CC0, img/tex) и кодом (трава, черепица); на «низком» — просто цвета ──
    const grassMap = R.canvasTex('grass', 256, (g, n, rnd) => {
      g.fillStyle = '#56a845'; g.fillRect(0, 0, n, n);
      for (let i = 0; i < 70; i++) { const x = rnd() * n, y = rnd() * n, r = 10 + rnd() * 40, l = rnd() < .5; const gr = g.createRadialGradient(x, y, 1, x, y, r); gr.addColorStop(0, l ? 'rgba(150,215,95,.42)' : 'rgba(38,105,40,.42)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) { g.save(); g.translate(dx, dy); g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.restore(); } }
      for (let i = 0; i < 1600; i++) { const x = rnd() * n, y = rnd() * n, h = 3 + rnd() * 5; g.strokeStyle = rnd() < .5 ? 'rgba(45,110,40,.55)' : 'rgba(170,225,120,.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - .5) * 2, y - h); g.stroke(); }
      for (let i = 0; i < 26; i++) { g.fillStyle = ['#fde68a', '#fff', '#f9a8d4'][i % 3]; g.fillRect(rnd() * n, rnd() * n, 2, 2); }
    });
    const grassN = R.normalFrom('grassN', 128, n => { const H = new Float32Array(n * n), rnd = rng(5); for (let i = 0; i < n * n; i++) H[i] = rnd() * .35; return H; }, 1.2);
    const shingles = (key, vert) => R.canvasTex(key, 128, (g, n) => {
      g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, n, n);
      for (let row = 0; row < 8; row++) for (let i = -1; i < 9; i++) {
        const x = i * 16 + (row % 2) * 8, y = row * 16;
        const gr = g.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, '#f5f5f5'); gr.addColorStop(1, '#a8a8a8');
        g.fillStyle = gr;
        g.beginPath(); if (vert) { g.moveTo(y, x); g.lineTo(y + 16, x); g.quadraticCurveTo(y + 18, x + 8, y + 16, x + 16); g.lineTo(y, x + 16); }
        else { g.moveTo(x, y); g.lineTo(x, y + 16); g.quadraticCurveTo(x + 8, y + 18, x + 16, y + 16); g.lineTo(x + 16, y); }
        g.fill(); g.strokeStyle = 'rgba(0,0,0,.25)'; g.stroke();
      }
    });
    const M = {
      grass: R.texMat('grass', grassMap, { tile: 2.4, normalMap: grassN, ns: .6, flatColor: '#6cbf58', rough: .95 }),
      plaza: R.tex('plaza', { tile: 2.6, flatColor: '#ece2cb' }), border: R.tex('sidewalk', { tint: '#d3c8b0', tile: 2, flatColor: '#cdbf9f' }),
      path: R.tex('sidewalk', { tint: '#f3e8d0', tile: 2.2, flatColor: '#e3d4b2' }), asphalt: R.tex('asphalt', { tile: 4, tint: '#a9afba', flatColor: '#5b6270', rough: .95 }),
      walk: R.tex('tiles', { tint: '#e2dccf', tile: 1.4, flatColor: '#c9c3b5' }), parquet: R.tex('parquet', { tile: 1.8, flatColor: '#c8956a', rough: .6 }),
      planks: R.tex('planks', { tint: '#e0b088', tile: 1.2, flatColor: '#a0673a', rough: .7 }), dark: R.tex('planks', { tint: '#8e6544', tile: 1.2, flatColor: '#6b4426', rough: .7 }),
      stone: R.tex('sidewalk', { tint: '#ece6da', tile: 1.5, flatColor: '#d6cfc0' }), carpet: R.tex('carpet', { tint: '#8f7cf0', tile: 2, flatColor: '#3b2f8a' }),
      water: R.water('#3aa6dc'),
    };
    const wallMat = c => R.tex('plaster', { tint: c, tile: 2.6, flatColor: c, rough: .92, ns: .7 });
    const roofMat = (c, vert) => R.texMat('roof' + c + (vert ? 'v' : ''), shingles('sh' + (vert ? 'v' : 'h'), vert), { tint: c, tile: 1.6, flatColor: c, rough: .7 });
    const rooms = [], screens = {}, seats = new Map();
    // коробка в мире (+ тело): x, z — центр, y0 — низ
    const box = (x, y0, z, w, h, d, c, o = {}) => {
      const m = P(o.g, { s: 'box', x, y: y0 + h / 2, z, w, h, d, c, yaw: o.yaw, m: o.m, dyn: o.dyn });
      if (o.solid) ph.addBox({ x, y: y0 + h / 2, z, hx: w / 2, hy: h / 2, hz: d / 2, yaw: o.yaw || 0, tag: o.tag || 'world', data: o.data ?? { cam: !!o.cam, floor: o.floor } });
      return m;
    };
    const cyl = (x, y0, z, r, h, c, o = {}) => {
      const m = P(o.g, { s: 'cyl', x, y: y0 + h / 2, z, r, r2: o.r2, h, c, seg: o.seg || 16, m: o.m });
      if (o.solid) ph.addCyl({ x, z, y: y0 + h / 2, r: o.pr || r, hy: h / 2, tag: o.tag || 'world', data: o.data ?? { floor: o.floor } });
      return m;
    };
    const flat = (x, z, w, d, c, y = .02, o = {}) => P(o.g, { s: 'plane', x, y, z, w, d, rx: -PI / 2, c, m: o.m, yaw: o.yaw });
    const disc = (x, z, r, c, y = .02, m) => P(null, { s: 'disc', x, y, z, r, rx: -PI / 2, c, m });
    const texMat = (key, w, h, draw) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4;
      return new T.MeshBasicMaterial({ map: t, toneMapped: false });
    };
    const label = (text, bg = '#7c3aed', fg = '#fff', w = 512, h = 128) => texMat('lbl' + text, w, h, (g) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      let size = h * .55; g.font = `900 ${size}px Montserrat, Arial, sans-serif`;
      while (g.measureText(text).width > w * .92 && size > 14) { size -= 3; g.font = `900 ${size}px Montserrat, Arial, sans-serif`; }
      g.fillText(text, w / 2, h / 2 + 2);
    });
    const plaque = (x, y, z, w, h, mat, yaw = 0, parent) => { const m = new T.Mesh(K.geo(`pl${w}_${h}`, () => new T.PlaneGeometry(w, h)), mat); m.position.set(x, y, z); m.rotation.y = yaw; (parent || st).add(m); if (parent) m.userData.dyn = true; return m; };

    // ── Земля, площадь, дорожки ──
    flat(0, 0, 320, 320, '#86cf72', 0, { m: M.grass });
    disc(0, 0, 18.4, '#cdbf9f', .015, M.border); disc(0, 0, 17.6, '#ece2cb', .02, M.plaza);
    const path = (x1, z1, x2, z2, w, m = M.path) => { const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz); P(null, { s: 'box', x: (x1 + x2) / 2, y: .018, z: (z1 + z2) / 2, w, h: .02, d: L, yaw: Math.atan2(dx, dz), m }); };
    path(0, -17, 0, -29, 4.2);              // к кафе
    path(17, -1, 28, -1, 4.2);              // к клубу
    path(-17, -1, -27, -1, 4.2);            // к сцене
    path(-12, 12, -19, 19, 3);              // к гардеробу
    path(13, 12, 28, 28, 3.4);              // в парк
    // улица на юг: асфальт и тротуары
    P(null, { s: 'box', x: 0, y: .02, z: 46, w: 7, h: .02, d: 58, m: M.asphalt });
    for (const s of [-1, 1]) { box(s * 4.6, 0, 46, 2.2, .14, 58, '#c9c3b5', { m: M.walk }); box(s * 3.55, 0, 46, .12, .16, 58, '#b9b2a4'); }
    for (let z = 20; z < 75; z += 4) P(null, { s: 'box', x: 0, y: .035, z, w: .25, h: .01, d: 1.8, c: '#f1f5f9' });

    // ── Фонтан ──
    cyl(0, 0, 0, 3.3, .7, '#d6cfc0', { solid: true, seg: 32, m: M.stone });
    cyl(0, .02, 0, 2.95, .64, '#5ec8f2', { seg: 32, m: M.water });
    cyl(0, .6, 0, .38, 1.5, '#cfc6b4', { seg: 14, m: M.stone });
    cyl(0, 2.05, 0, 1.15, .22, '#d6cfc0', { seg: 24, m: M.stone });
    P(null, { s: 'ball', x: 0, y: 2.5, z: 0, r: .42, c: '#bdeeff', m: 'glow', seg: 14 });
    for (let i = 0; i < 6; i++) { const a = i / 6 * PI * 2; P(null, { s: 'ball', x: Math.cos(a) * 1.4, y: 1.25, z: Math.sin(a) * 1.4, r: .18, c: '#bdeeff', m: 'glow', seg: 8 }); }

    // ── Скамейки вокруг фонтана (сесть) ──
    const bench = (x, z, yaw, name = 'Скамейка') => {
      R.prefab('bench', { x, z, yaw, m: M.planks }, ph);
      for (const s of [-1, 1]) {
        const sx = x + Math.cos(yaw) * .55 * s, sz = z - Math.sin(yaw) * .55 * s;
        seatSpot({ id: `b${Math.round(x * 10)}_${Math.round(z * 10)}_${s}`, x: sx, z: sz, y: .62, yaw, bench: name });
      }
    };
    for (let i = 0; i < 6; i++) { const a = (i + .5) / 6 * PI * 2, x = Math.cos(a) * 9, z = Math.sin(a) * 9; if (Math.abs(x) < 3 && z > 0) continue; bench(x, z, Math.atan2(-x, -z)); }
    for (let i = 0; i < 8; i++) { const a = i / 8 * PI * 2 + PI / 8; R.prefab('lamp', { x: Math.cos(a) * 16, z: Math.sin(a) * 16 }, ph); }
    R.prefab('sign', { x: -3.6, z: 13.5, yaw: 0, text: 'Мир Денчика', c: '#7c3aed' }, ph);
    infoSpot(-3.6, 13.5, '🌍 Мир Денчика', 'Добро пожаловать! Кафе — на севере, игровой клуб — на востоке, сцена — на западе, улица с домиками — на юге, парк — на юго-востоке. Сядь за столик, чтобы сыграть с тем, кто сядет напротив.');

    // ── Здания: пол, стены с проёмами (двери, окна), крыша, зона «внутри» (крыша прячется, камера ближе) ──
    function building(o){
      const H = o.h || 3.6, t = .35, x0 = o.x, z0 = o.z, hw = o.w / 2, hd = o.d / 2, floors = o.floors || 1;
      const wallM = o.wall || '#f4e3c3', trimM = o.trim || '#8b5a2b', wm = wallMat(wallM), fm = o.floorM || M.parquet;
      box(x0, 0, z0, o.w, .12, o.d, o.floor || '#c79a6b', { solid: true, floor: o.floorType || 'wood', m: fm });
      const walls = side => {
        const horiz = side === 'n' || side === 's', L = horiz ? o.w : o.d;
        const ops = [...(o.doors || []).filter(d => d.side === side).map(d => ({ at: d.at || 0, w: d.w || 2.4, y0: 0, y1: d.h || 2.8, door: true })),
          ...(o.windows || []).filter(w => w.side === side).map(w => ({ at: w.at || 0, w: w.w || 1.7, y0: w.y || 1.1, y1: (w.y || 1.1) + (w.h || 1.3) }))].sort((a, b) => a.at - b.at);
        const put = (a, b, y0, y1, glass) => {   // кусок стены по оси стены от a до b, по высоте y0…y1
          if (b - a < .02 || y1 - y0 < .02) return;
          const c = (a + b) / 2, len = b - a;
          const wx = horiz ? x0 + c : x0 + (side === 'e' ? hw : -hw), wz = horiz ? z0 + (side === 's' ? hd : -hd) : z0 + c;
          const w = horiz ? len : t, d = horiz ? t : len;
          if (glass) { P(null, { s: 'box', x: wx, y: (y0 + y1) / 2, z: wz, w: horiz ? len : .06, h: y1 - y0, d: horiz ? .06 : len, c: '#bfe8ff', m: glassM }); ph.addBox({ x: wx, y: (y0 + y1) / 2, z: wz, hx: w / 2, hy: (y1 - y0) / 2, hz: d / 2, tag: 'glass', data: { cam: false } }); return; }
          box(wx, y0, wz, w, y1 - y0, d, wallM, { solid: true, cam: true, m: wm });
        };
        let a = -L / 2;
        for (let f = 0; f < floors; f++) {
          const yb = f * H, list = f === 0 ? ops : (o.windows2 || []).filter(w => w.side === side).map(w => ({ at: w.at || 0, w: w.w || 1.7, y0: w.y || 1.1, y1: (w.y || 1.1) + (w.h || 1.3) }));
          a = -L / 2;
          for (const p of list) {
            const l = p.at - p.w / 2, r = p.at + p.w / 2;
            put(a, l, yb, yb + H);
            put(l, r, yb + p.y1, yb + H);
            if (p.y0 > 0) { put(l, r, yb, yb + p.y0); put(l, r, yb + p.y0, yb + p.y1, true); }
            else if (p.door) {   // рама двери
              const tw = .14;
              for (const sx of [l - tw / 2, r + tw / 2]) { const fx = horiz ? x0 + sx : x0 + (side === 'e' ? hw : -hw), fz = horiz ? z0 + (side === 's' ? hd : -hd) : z0 + sx; P(null, { s: 'box', x: fx, y: yb + p.y1 / 2, z: fz, w: horiz ? tw : t + .1, h: p.y1, d: horiz ? t + .1 : tw, c: trimM }); }
            }
            a = r;
          }
          put(a, L / 2, yb, yb + H);
        }
      };
      ['n', 's', 'e', 'w'].forEach(walls);
      // углы и пояс
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(x0 + sx * hw, 0, z0 + sz * hd, .5, H * floors + .1, .5, trimM);
      // этажи выше первого: перекрытие с проёмом для лестницы
      for (let f = 1; f < floors; f++) {
        const sw = o.stair;   // { x, w } — проём над лестницей вдоль восточной стены
        const yb = f * H;
        if (sw) {
          box(x0 - (hw - (o.w - sw.w) / 2) + 0, yb - .15, z0, o.w - sw.w, .15, o.d, o.floor || '#c79a6b', { solid: true, floor: 'wood', m: fm });
          box(x0 + hw - sw.w / 2, yb - .15, z0 - hd + sw.d / 2 + (o.d - sw.d) / 2 + sw.d / 2, sw.w, .15, o.d - sw.d, o.floor || '#c79a6b', { solid: true, floor: 'wood', m: fm });
        } else box(x0, yb - .15, z0, o.w, .15, o.d, o.floor || '#c79a6b', { solid: true, floor: 'wood', m: fm });
      }
      if (o.stair) {   // лестница: ступени-столбики до пола (физика ведёт по ступенькам)
        const n = 12, s = o.stair, sx = x0 + hw - s.w / 2 - .2, len = s.d, z1 = z0 - hd + .4;
        for (let i = 0; i < n; i++) { const h = (i + 1) * H / n, zz = z1 + (i + .5) * len / n; box(sx, 0, zz, s.w - .2, h, len / n, '#b58658', { solid: true, floor: 'wood', m: M.planks }); }
      }
      // крыша (группа — прячется, когда ты внутри)
      const roof = R.group(R.scene, x0, 0, z0);
      roof.userData.dyn = true;
      const HT = H * floors;
      if (o.roof === 'flat') {
        const rm = R.tex('sidewalk', { tint: o.roofC || '#7a5236', tile: 2.5, flatColor: o.roofC || '#7a5236' }), pm = wallMat(o.roofC2 || '#e8d2a8');
        R.part(roof, { s: 'box', y: HT + .12, w: o.w + .7, h: .25, d: o.d + .7, m: rm });
        for (const [w, d, x, z] of [[o.w + .7, .3, 0, -(o.d + .7) / 2], [o.w + .7, .3, 0, (o.d + .7) / 2], [.3, o.d + .7, -(o.w + .7) / 2, 0], [.3, o.d + .7, (o.w + .7) / 2, 0]]) R.part(roof, { s: 'box', x, z, y: HT + .5, w, h: .5, d, m: pm });
      } else {   // двускатная: треугольная призма (цилиндр с 3 гранями)
        const g = R.group(roof, 0, 0, 0, o.ridge === 'z' ? 0 : PI / 2);
        const base = (o.ridge === 'z' ? o.w : o.d) + 1, len = (o.ridge === 'z' ? o.d : o.w) + .9, r = base / 1.732, rise = o.rise || 2.2, sz = rise / (1.5 * r);
        const m = R.part(g, { s: 'cyl', r, h: len, seg: 3, rx: -PI / 2, m: roofMat(o.roofC || '#c2410c', o.ridge === 'z') });
        m.scale.set(1, 1, sz); m.position.y = HT + .5 * r * sz;
        R.part(roof, { s: 'box', y: HT + .06, w: o.w + .3, h: .12, d: o.d + .3, c: trimM });
      }
      // UV «по миру» у крыши (она не склеивается — прячется, когда ты внутри) и тени
      roof.updateWorldMatrix(true, true);
      roof.traverse(c => { if (c.isMesh && c.material.userData?.tile) R.worldUV(c, c.material.userData.tile); });
      R.shadowsOn(roof);
      // зона «внутри»
      const zone = ph.addBox({ x: x0, z: z0, y: HT / 2, hx: hw - .3, hy: HT / 2 + .3, hz: hd - .3, trigger: true, tag: 'room', data: { room: o.id, roof } });
      rooms.push({ id: o.id, roof, zone, name: o.name });
      // вывеска над дверью
      if (o.sign) {
        const d = (o.doors || [])[0], side = d?.side || 's', mat = label(o.sign, o.signBg || '#7c3aed');
        const sw = Math.min(o.w - 1, 6.5);
        const px = side === 'e' ? x0 + hw + .22 : side === 'w' ? x0 - hw - .22 : x0 + (d?.at || 0), pz = side === 's' ? z0 + hd + .22 : side === 'n' ? z0 - hd - .22 : z0 + (d?.at || 0);
        const yaw = side === 's' ? 0 : side === 'n' ? PI : side === 'e' ? PI / 2 : -PI / 2;
        plaque(px - x0, Math.min(H * floors - .55, (d?.h || 2.8) + .55), pz - z0, sw, sw / 4, mat, yaw, roof);
      }
      return { x0, z0, hw, hd, H, roof };
    }
    const glassM = new T.MeshBasicMaterial({ color: '#cfeeff', transparent: true, opacity: .32, depthWrite: false });

    // ── Мебель ──
    const chair = (x, z, yaw, c = '#8b5a2b') => {
      const g = R.group(null, x, 0, z, yaw);
      R.part(g, { s: 'box', y: .5, w: .62, h: .1, d: .62, c });
      R.part(g, { s: 'box', y: .9, z: -.28, w: .62, h: .7, d: .08, c });
      for (const [lx, lz] of [[-.26, -.26], [.26, -.26], [-.26, .26], [.26, .26]]) R.part(g, { s: 'box', x: lx, y: .23, z: lz, w: .07, h: .46, d: .07, c: '#5b3a1e' });
      ph.addBox({ x, z, y: .45, hx: .3, hy: .45, hz: .3, yaw, tag: 'chair' });   // выше ступеньки — не залезть, как на ступень
    };
    const sofa = (x, z, yaw, c = '#7c3aed') => {
      const g = R.group(null, x, 0, z, yaw);
      R.part(g, { s: 'box', y: .3, w: 2.4, h: .5, d: .95, c });
      R.part(g, { s: 'box', y: .8, z: -.38, w: 2.4, h: .6, d: .25, c });
      for (const s of [-1, 1]) R.part(g, { s: 'box', x: s * 1.1, y: .6, w: .25, h: .5, d: .95, c });
      ph.addBox({ x, z, y: .4, hx: 1.2, hy: .4, hz: .5, yaw, tag: 'sofa' });
      for (const s of [-1, 1]) seatSpot({ id: `s${Math.round(x * 10)}_${Math.round(z * 10)}_${s}`, x: x + Math.cos(yaw) * .55 * s, z: z - Math.sin(yaw) * .55 * s, y: .56, yaw, bench: 'Диван' });
    };
    const plant = (x, z) => { cyl(x, 0, z, .3, .5, '#b45309', { r2: .38, solid: true, pr: .35 }); P(null, { s: 'ico', x, y: 1, z, r: .55, c: '#3f9a4c', det: 1 }); };
    const rug = (x, z, w, d, c) => P(null, { s: 'box', x, y: .13, z, w, h: .02, d, c });
    const lampHang = (x, y, z) => { P(null, { s: 'cyl', x, y: y + .4, z, r: .02, h: .8, c: '#222' }); P(null, { s: 'cone', x, y, z, r: .35, h: .3, c: '#fbbf24', seg: 12 }); P(null, { s: 'ball', x, y: y - .1, z, r: .14, c: '#fff6c8', m: 'glow', seg: 8 }); };

    // ── Игровые столы: место = сесть; все сели — партия ──
    const boardMat = {};
    const boardTex = kind => boardMat[kind] || (boardMat[kind] = texMat(kind, 256, 256, (g, w, h) => {
      if (kind === 'chess' || kind === 'checkers') {
        g.fillStyle = '#5b3a1e'; g.fillRect(0, 0, w, h);
        const s = (w - 24) / 8;
        for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) % 2 ? (kind === 'chess' ? '#7c4a26' : '#2b2b2b') : '#f2dcb3'; g.fillRect(12 + i * s, 12 + j * s, s, s); }
        g.font = `${s * .8}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        if (kind === 'checkers') for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { if ((i + j) % 2 === 0 || (j > 2 && j < 5)) continue; g.fillStyle = j < 3 ? '#f8fafc' : '#dc2626'; g.beginPath(); g.arc(12 + (i + .5) * s, 12 + (j + .5) * s, s * .36, 0, 7); g.fill(); }
      } else if (kind === 'nardy') {
        g.fillStyle = '#7c2d12'; g.fillRect(0, 0, w, h); g.fillStyle = '#fde68a'; g.fillRect(10, 10, w - 20, h - 20);
        for (let i = 0; i < 12; i++) { const x = 14 + (i < 6 ? i : i + 1) * (w - 28) / 13; for (const top of [0, 1]) { g.fillStyle = (i + top) % 2 ? '#991b1b' : '#1f2937'; g.beginPath(); const y0 = top ? 12 : h - 12, y1 = top ? h * .42 : h * .58; g.moveTo(x, y0); g.lineTo(x + (w - 28) / 13, y0); g.lineTo(x + (w - 28) / 26, y1); g.fill(); } }
      } else if (kind === 'ludo') {
        const s = w / 3; [['#ef4444', 0, 0], ['#22c55e', 2, 0], ['#3b82f6', 0, 2], ['#facc15', 2, 2]].forEach(([c, i, j]) => { g.fillStyle = c; g.fillRect(i * s, j * s, s, s); });
        g.fillStyle = '#fff'; g.fillRect(s, 0, s, w); g.fillRect(0, s, w, s);
      } else {   // карты: сукно
        g.fillStyle = kind === 'uno' ? '#b91c1c' : kind === 'sea' ? '#1e40af' : kind === 'ttt' ? '#334155' : '#166534'; g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 6; g.strokeRect(14, 14, w - 28, h - 28);
        g.font = '120px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText({ cards: '🂡', uno: '🃏', sea: '🚢', ttt: '❌' }[kind] || '🎲', w / 2, h / 2);
      }
    }));
    function gameTable(t){
      const gi = gameInfo(t.game), isPool = t.kind === 'pool';
      if (isPool) {   // бильярдный стол: стоят у торцов
        box(t.x, 0, t.z, 4.6, .82, 2.6, '#6b3f1f', { solid: true });
        box(t.x, .82, t.z, 4.2, .04, 2.2, '#1f9a5a');
        for (const [dx, dz] of [[-2.1, -1.1], [0, -1.1], [2.1, -1.1], [-2.1, 1.1], [0, 1.1], [2.1, 1.1]]) P(null, { s: 'cyl', x: t.x + dx, y: .85, z: t.z + dz, r: .12, h: .02, c: '#111' });
        const balls = ['#facc15', '#2563eb', '#dc2626', '#7c3aed', '#f97316', '#16a34a', '#111', '#fff'];
        balls.forEach((c, i) => P(null, { s: 'ball', x: t.x + .6 + (i % 4) * .12, y: .9, z: t.z - .18 + Math.floor(i / 4) * .14 + (i % 2) * .05, r: .06, c, seg: 8 }));
        seatSpot({ id: t.id + ':0', tb: t, s: 0, x: t.x - 2.9, z: t.z, y: 0, yaw: PI / 2, stand: true });
        seatSpot({ id: t.id + ':1', tb: t, s: 1, x: t.x + 2.9, z: t.z, y: 0, yaw: -PI / 2, stand: true });
        return;
      }
      const round = t.n === 4, r = round ? .85 : .7;
      cyl(t.x, 0, t.z, .09, .76, '#3b2a1c');
      cyl(t.x, 0, t.z, .45, .05, '#3b2a1c');
      if (round) cyl(t.x, .76, t.z, r, .07, '#8b5a2b', { seg: 28, m: M.dark }); else P(null, { s: 'box', x: t.x, y: .795, z: t.z, w: 1.5, h: .07, d: 1.3, m: M.dark });
      ph.addCyl({ x: t.x, z: t.z, y: .42, r: round ? r : .78, hy: .42, tag: 'table' });
      const top = new T.Mesh(K.geo(round ? 'tbdisc' : 'tbplane', () => round ? new T.CircleGeometry(r * .9, 28) : new T.PlaneGeometry(1.2, 1.2)), boardTex(t.kind));
      top.rotation.x = -PI / 2; top.position.set(t.x, .835, t.z); st.add(top);
      // флажок над столом: что за игра (видно издалека)
      const tag = new T.Sprite(new T.SpriteMaterial({ map: emojiTex(gi.icon), transparent: true, depthWrite: false }));
      tag.position.set(t.x, 2.5, t.z); tag.scale.setScalar(.7); R.scene.add(tag); t.tag = tag;
      const ang = t.n === 2 ? [PI / 2, -PI / 2] : [PI / 2, 0, -PI / 2, PI];
      ang.forEach((a, i) => {
        const d = round ? 1.35 : 1.25, sx = t.x - Math.sin(a) * d, sz = t.z - Math.cos(a) * d;
        chair(sx, sz, a, t.n === 4 ? '#9a6a3a' : '#8b5a2b');
        seatSpot({ id: t.id + ':' + i, tb: t, s: i, x: sx, z: sz, y: .55, yaw: a });
      });
    }
    const emojiTex = e => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.font = '96px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, 64, 70); const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t; };

    // Место, куда сесть (стол, скамейка, диван)
    function seatSpot(sp){
      seats.set(sp.id, sp);
      sp.item = X.add({
        x: sp.x, y: sp.y + .5, z: sp.z, r: .45,
        prompt: () => {
          if (S.mySeat?.id === sp.id) return null;
          const who = S.occ?.get(sp.id);
          if (who && who !== S.me) return 'Занято: ' + who.nick;
          if (sp.tb) { const gi = gameInfo(sp.tb.game); return `${sp.stand ? 'Встать к столу' : 'Сесть'}: ${gi.icon} ${gi.title}`; }
          return 'Сесть';
        },
        act: () => S.sitAt?.(sp),
      });
    }
    function infoSpot(x, z, title, text){ X.add({ x, y: 1.5, z, r: .8, prompt: () => 'Прочитать', act: () => S.showInfo?.(title, text) }); }

    // ── Кафе «У Денчика» ──
    const cafe = building({ id: 'cafe', name: 'Кафе «У Денчика»', x: 0, z: -36, w: 22, d: 14, h: 3.8, wall: '#ffd9a8', trim: '#9a3412', floor: '#c8956a', roof: 'flat', roofC: '#9a3412', roofC2: '#fed7aa',
      doors: [{ side: 's', at: 0, w: 2.6, h: 2.9 }], windows: [{ side: 's', at: -6.5, w: 3 }, { side: 's', at: 6.5, w: 3 }, { side: 'e', at: 0, w: 2.4 }, { side: 'w', at: 0, w: 2.4 }],
      sign: 'Кафе «У Денчика»', signBg: '#9a3412' });
    // маркиза над входом
    for (let i = 0; i < 7; i++) R.part(cafe.roof, { s: 'box', x: -2.1 + i * .7, y: 3.3, z: -28.4 + 36, w: .7, h: .08, d: 1.4, rx: .35, c: i % 2 ? '#fff7ed' : '#ea580c', dyn: true });
    box(0, .12, -42.2, 12, 1.15, 1, '#7c2d12', { solid: true });   // стойка
    P(null, { s: 'box', x: 0, y: 1.3, z: -42.2, w: 12.2, h: .08, d: 1.2, c: '#fed7aa' });
    for (let i = 0; i < 5; i++) { const x = -4.8 + i * 2.4; cyl(x, 0, -40.9, .28, .72, '#9a3412', { solid: true, pr: .3 }); P(null, { s: 'cyl', x, y: .75, z: -40.9, r: .3, h: .06, c: '#fdba74' }); }
    P(null, { s: 'box', x: 0, y: 2.6, z: -42.85, w: 5, h: 1.6, d: .1, c: '#1f2937' });
    plaque(0, 2.6, -42.78, 4.6, 1.3, texMat('menu', 512, 144, g => { g.fillStyle = '#111827'; g.fillRect(0, 0, 512, 144); g.fillStyle = '#fde68a'; g.font = '800 36px Montserrat, Arial'; g.textAlign = 'center'; g.fillText('☕ Какао · 🍩 Пончик · 🍕 Пицца', 256, 58); g.fillStyle = '#86efac'; g.font = '700 26px Montserrat, Arial'; g.fillText('Садись за столик — сыграем!', 256, 108); }));
    for (const t of TABLES.filter(t => ['chess1', 'chess2', 'check1', 'nardy1', 'durak1', 'uno1'].includes(t.id))) gameTable(t);
    plant(-10.2, -42); plant(10.2, -42); plant(-10.2, -30.2); plant(10.2, -30.2);
    sofa(-8.5, -30.5, PI, '#c2410c');
    for (const [x, z] of [[-6.5, -36], [-1, -36], [5.5, -36]]) lampHang(x, 3.2, z);
    infoSpot(9.5, -43, '☕ Кафе', 'Садись за столик: шахматы, шашки, нарды — на двоих; «Дурак» и «Одна!» — до 4 человек. Сел второй игрок — партия начинается сама. Один? Можно «С ботом» или позвать друга.');

    // ── Игровой клуб: автоматы, бильярд, морской бой, крестики-нолики ──
    building({ id: 'club', name: 'Игровой клуб', x: 36, z: -2, w: 16, d: 20, h: 3.8, wall: '#312e81', trim: '#a78bfa', floor: '#1e1b4b', floorType: 'tile', roof: 'flat', roofC: '#1e1b4b', roofC2: '#7c3aed', floorM: M.carpet,
      doors: [{ side: 'w', at: 0, w: 2.6, h: 2.9 }], windows: [{ side: 'w', at: -6, w: 2.4 }, { side: 'w', at: 6, w: 2.4 }],
      sign: 'Игровой клуб', signBg: '#5b21b6' });
    for (const a of ARCADE) {
      const gi = gameInfo(a.g); if (!gameInfo(a.g).title || (typeof GAMES !== 'undefined' && !GAMES.some(g => g.id === a.g))) continue;
      const fz = Math.cos(a.yaw), col = gi.color || '#7c3aed';
      box(a.x, 0, a.z, 1.15, 2.1, .9, col, { solid: true, yaw: a.yaw });
      box(a.x, 1.1, a.z + fz * .32, 1.15, .1, .5, '#111827', { yaw: a.yaw });
      const scr = plaque(a.x, 1.55, a.z + fz * .46, .85, .62, texMat('arc' + a.g, 256, 192, g => {
        const gr = g.createLinearGradient(0, 0, 0, 192); gr.addColorStop(0, '#0f172a'); gr.addColorStop(1, '#312e81'); g.fillStyle = gr; g.fillRect(0, 0, 256, 192);
        g.font = '84px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(gi.icon, 128, 82);
        g.fillStyle = '#fde68a'; g.font = '800 26px Montserrat, Arial'; g.fillText(gi.title.slice(0, 16), 128, 160);
      }), a.yaw);
      scr.userData.dyn = true;
      plaque(a.x, 2.25, a.z + fz * .46, 1.1, .3, label(gi.title, col), a.yaw);
      X.add({ x: a.x + Math.sin(a.yaw) * .9, y: 1.2, z: a.z + Math.cos(a.yaw) * .9, r: .6, prompt: () => `Играть: ${gi.icon} ${gi.title}`, act: () => S.go?.(`#/games/${a.g}`) });
    }
    for (const t of TABLES.filter(t => ['pool1', 'sea1', 'ttt1'].includes(t.id))) gameTable(t);
    for (let x = 30; x <= 42; x += 6) lampHang(x, 3.2, -2);
    rug(37, -2, 7.5, 5, '#4c1d95');

    // ── Сцена Денчика: помост, большой экран (эфир или ролики), зрительские скамейки ──
    box(-38, 0, -1, 7, .8, 13, '#3b2a5a', { solid: true, floor: 'wood', m: R.tex('planks', { tint: '#6b5a8c', tile: 1.2, flatColor: '#3b2a5a', rough: .65 }) });
    box(-41.3, .8, -1, .4, 6.5, 13, '#1f1636', { solid: true, cam: true });
    const scrMat = texMat('stage', 512, 288, () => {});
    const scr = plaque(-41.05, 4, -1, 11, 6.2, scrMat, PI / 2); scr.userData.dyn = true;
    screens.stage = { mat: scrMat };
    for (const z of [-7.2, 5.2]) { box(-37, .8, z, 1.1, 2.2, 1.1, '#111827', { solid: true }); P(null, { s: 'cyl', x: -36.45, y: 2, z, r: .35, h: .05, rx: 0, rz: PI / 2, c: '#374151' }); }
    for (let row = 0; row < 3; row++) for (const z of [-5, -1, 3]) bench(-28 + row * 2.6, z, -PI / 2, 'Зрительская скамейка');
    X.add({ x: -34.4, y: 1.2, z: -1, r: 2.6, prompt: () => S.live ? '🔴 Денчик в эфире — смотреть' : '📺 Сцена: ролики Денчика', act: () => S.openStage?.() });

    // ── Гардероб ──
    building({ id: 'wardrobe', name: 'Гардероб', x: -22, z: 24, w: 9, d: 8, h: 3.4, wall: '#ffc2dd', trim: '#db2777', floor: '#fbcfe8', roof: 'gable', roofC: '#db2777',
      doors: [{ side: 'n', at: 0, w: 2.2, h: 2.7 }], windows: [{ side: 'e', at: 0, w: 2 }, { side: 'w', at: 0, w: 2 }], sign: 'Гардероб', signBg: '#db2777' });
    box(-22, .12, 27.6, 2.4, 2.4, .12, '#e5e7eb', { solid: true });
    plaque(-22, 1.4, 27.5, 2.1, 2.1, new T.MeshBasicMaterial({ color: '#dbeafe' }), PI).userData.dyn = true;
    for (const x of [-25, -19]) { box(x, .12, 24, .1, 1.7, 3, '#9ca3af'); for (let i = 0; i < 5; i++) P(null, { s: 'box', x: x + .1, y: 1.15, z: 22.9 + i * .55, w: .5, h: .9, d: .1, c: ['#ef4444', '#3b82f6', '#22c55e', '#facc15', '#a855f7'][i] }); }
    X.add({ x: -22, y: 1.2, z: 26.6, r: 1.2, prompt: () => 'Зеркало: 🎭 сменить персонажа', act: () => S.openEditor?.() });

    // ── Улица с домиками (заходи внутрь) ──
    const houses = [
      { id: 'h1', name: 'Домик', x: -12, z: 30, w: 9, d: 9, wall: '#ffe08a', roofC: '#b91c1c', side: 'e' },
      { id: 'h2', name: 'Домик', x: 12, z: 30, w: 9, d: 9, wall: '#a9d2ff', roofC: '#1d4ed8', side: 'w' },
      { id: 'h3', name: 'Двухэтажный дом', x: -12.5, z: 52, w: 10, d: 11, wall: '#a7efc0', roofC: '#15803d', side: 'e', floors: 2 },
      { id: 'h4', name: 'Домик', x: 12, z: 52, w: 9, d: 9, wall: '#f3c4ff', roofC: '#7e22ce', side: 'w' },
    ];
    for (const h of houses) {
      building({ id: h.id, name: h.name, x: h.x, z: h.z, w: h.w, d: h.d, h: 3.3, floors: h.floors || 1, wall: h.wall, trim: '#7c2d12', floor: '#d6a77a', roof: 'gable', ridge: 'z', roofC: h.roofC,
        doors: [{ side: h.side, at: 0, w: 2, h: 2.6 }], windows: [{ side: h.side, at: -3, w: 1.4 }, { side: h.side, at: 3, w: 1.4 }, { side: 'n', at: 0, w: 2 }, { side: 's', at: 0, w: 2 }],
        windows2: h.floors ? [{ side: h.side, at: -2.5, w: 1.4 }, { side: h.side, at: 2.5, w: 1.4 }, { side: 'n', at: 0, w: 2 }] : null,
        stair: h.floors ? { w: 2.2, d: 6.6 } : null });
      const inX = h.side === 'e' ? -1 : 1;   // вглубь дома
      sofa(h.x + inX * 2.6, h.z - 2.4, inX > 0 ? -PI / 2 : PI / 2, ['#ef4444', '#0ea5e9', '#22c55e', '#a855f7'][houses.indexOf(h)]);
      box(h.x + inX * .2, .12, h.z + 1.6, 1.4, .7, .9, '#a16207', { solid: true });
      rug(h.x + inX * 1.2, h.z - .4, 3.6, 3, '#fde68a');
      box(h.x + inX * (h.w / 2 - .6), .12, h.z + 2.5, .5, 1.3, 2.2, '#374151', { solid: true });   // тумба с ТВ
      plaque(h.x + inX * (h.w / 2 - .87), 1.85, h.z + 2.5, .01 + 1.9, 1.1, new T.MeshBasicMaterial({ color: '#0ea5e9' }), inX > 0 ? -PI / 2 : PI / 2).userData.dyn = true;
      plant(h.x - inX * 3.2, h.z + 3.4);
      // кровать
      box(h.x + inX * 2.4, .12, h.z + 3, 2, .5, 1.4, '#e5e7eb', { solid: true }); P(null, { s: 'box', x: h.x + inX * 3.25, y: .85, z: h.z + 3, w: .3, h: .5, d: 1.4, c: '#7c2d12' });
      if (h.floors === 2) { sofa(h.x + inX * 2.5, h.z - 2, inX > 0 ? -PI / 2 : PI / 2, '#f59e0b'); }
    }
    // заборчики и почтовые ящики у домов
    for (const h of houses) { const fx = h.side === 'e' ? h.x + h.w / 2 + 1.1 : h.x - h.w / 2 - 1.1; for (const s of [-1, 1]) R.prefab('fence', { x1: fx, z1: h.z + s * 1.6, x2: fx, z2: h.z + s * (h.d / 2 + .4) }, ph); }

    // ── Парк: пруд, деревья, скамейки, ворота в игры ──
    disc(32, 34, 7.4, '#8fd17f', .021, M.border); disc(32, 34, 6.6, '#38bdf8', .03, M.water);
    for (let i = 0; i < 26; i++) { const a = i / 26 * PI * 2; P(null, { s: 'ico', x: 32 + Math.cos(a) * 6.9, y: .12, z: 34 + Math.sin(a) * 6.9, r: .38, c: '#94a3b8', det: 0, sy: .5 }); }
    for (const [x, z] of [[23, 31], [41, 31], [32, 24.5]]) bench(x, z, Math.atan2(32 - x, 34 - z), 'Скамейка у пруда');
    for (const gt of GATES) {
      if (typeof GAMES !== 'undefined' && !GAMES.some(g => g.id === gt.g)) continue;
      const g = R.group(null, gt.x, 0, gt.z, gt.yaw);
      for (const s of [-1, 1]) { R.part(g, { s: 'box', x: s * 1.8, y: 1.7, w: .6, h: 3.4, d: .6, c: gt.c }); ph.addBox({ x: gt.x + Math.cos(gt.yaw) * s * 1.8, z: gt.z - Math.sin(gt.yaw) * s * 1.8, y: 1.7, hx: .3, hy: 1.7, hz: .3, yaw: gt.yaw }); }
      R.part(g, { s: 'box', y: 3.6, w: 4.4, h: .6, d: .8, c: gt.c });
      const pl = new T.Mesh(K.geo('gate', () => new T.PlaneGeometry(3.6, .9)), label(`${gt.e} ${gt.name}`, gt.c)); pl.position.set(0, 3.6, .42); g.add(pl);
      const fx = Math.sin(gt.yaw), fz = Math.cos(gt.yaw);
      X.add({ x: gt.x + fx * .2, y: 1.2, z: gt.z + fz * .2, r: 1.6, prompt: () => `${gt.e} ${gt.name}: играть`, act: () => S.openGate?.(gt) });
    }
    // ── Деревья, кусты, цветы ──
    const R0 = rng(37), trees = [];
    const segD = (px, pz, x1, z1, x2, z2) => { const dx = x2 - x1, dz = z2 - z1, l = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / l)); return Math.hypot(px - x1 - t * dx, pz - z1 - t * dz); };
    const free = (x, z, m) => {
      if (Math.hypot(x, z) < 22) return false;
      if (Math.abs(x) < 13 && z > 15 && z < 80) return false;   // улица
      if (x > -13 && x < 13 && z < -26 && z > -46) return false;   // кафе
      if (x > 26 && x < 47 && z > -15 && z < 11) return false;   // клуб
      if (x > -46 && x < -21 && z > -10 && z < 8) return false;   // сцена
      if (x > -29 && x < -15 && z > 17 && z < 31) return false;   // гардероб
      if (Math.hypot(x - 32, z - 34) < 9.5) return false;   // пруд
      if (GATES.some(g => Math.hypot(x - g.x, z - g.z) < 5)) return false;
      if (Math.abs(z + 1) < 3 && Math.abs(x) < 30) return false;   // дорожки
      if (Math.abs(x) < 3 && z < -15 && z > -30) return false;
      if (segD(x, z, 13, 12, 28, 28) < 3.5 || segD(x, z, -12, 12, -19, 19) < 3) return false;   // дорожки в парк и к гардеробу
      return !trees.some(t => Math.hypot(t.x - x, t.z - z) < m);
    };
    const NT = low ? 60 : 120;
    for (let k = 0; k < 2000 && trees.length < NT; k++) {
      const a = R0() * PI * 2, r = 26 + R0() * 60, x = Math.cos(a) * r, z = Math.sin(a) * r + 6;
      if (Math.abs(x) > 78 || z < -66 || z > 86 || !free(x, z, 4.2)) continue;
      trees.push({ x, z });
      if (R0() < .3) R.prefab('pine', { x, z, k: .9 + R0() * .5 }, ph); else R.prefab('tree', { x, z, v: Math.floor(R0() * 4), k: .9 + R0() * .5, yaw: R0() * 6 }, ph);
    }
    for (let k = 0; k < (low ? 30 : 70); k++) { const x = (R0() - .5) * 150, z = (R0() - .5) * 150 + 6; if (free(x, z, 2)) R.prefab(R0() < .5 ? 'bush' : 'flowers', { x, z, seed: k, c: ['#f472b6', '#facc15', '#a78bfa', '#fb7185'][k % 4] }); }
    // где какой пол (для шагов): плитка площади, асфальт улицы, вода пруда
    const floorAt = (x, z) => Math.hypot(x, z) < 17.6 ? 'tile' : Math.abs(x) < 3.6 && z > 17 && z < 75 ? 'concrete' : Math.hypot(x - 32, z - 34) < 6.6 ? 'water' : 'grass';
    // ── Кустики травы: тысячи травинок одним вызовом отрисовки (только среднее и высокое качество) ──
    if (!low) {
      const tuftMap = R.canvasTex('tuft', 128, (g, n, rnd) => {
        g.clearRect(0, 0, n, n);
        for (let i = 0; i < 26; i++) {
          const x = 14 + rnd() * 100, h = 50 + rnd() * 70, bend = (rnd() - .5) * 30, w = 4 + rnd() * 5;
          const gr = g.createLinearGradient(0, n, 0, n - h); gr.addColorStop(0, '#4c9a3c'); gr.addColorStop(1, rnd() < .5 ? '#b4e886' : '#8fd86a');
          g.fillStyle = gr; g.beginPath(); g.moveTo(x - w / 2, n); g.quadraticCurveTo(x + bend * .4, n - h * .55, x + bend, n - h); g.quadraticCurveTo(x + bend * .4 + 1, n - h * .5, x + w / 2, n); g.fill();
        }
      }, { seed: 4 });
      const tm = new T.MeshStandardMaterial({ map: tuftMap, alphaTest: .45, side: T.DoubleSide, roughness: .9, envMapIntensity: .5 });
      const tg = new T.BufferGeometry(), pos = [], uv = [], nor = [];
      for (let i = 0; i < 3; i++) {   // три скрещенные плоскости
        const a = i / 3 * PI, cx = Math.cos(a) * .32, cz = Math.sin(a) * .32, h = .5;
        const v = [[-cx, 0, -cz, 0, 0], [cx, 0, cz, 1, 0], [cx, h, cz, 1, 1], [-cx, 0, -cz, 0, 0], [cx, h, cz, 1, 1], [-cx, h, -cz, 0, 1]];
        for (const [x, y, z, u, w] of v) { pos.push(x, y, z); uv.push(u, w); nor.push(0, 1, 0); }   // нормаль вверх — светятся как земля
      }
      tg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); tg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); tg.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
      const N = R.q === 'high' ? 4200 : 1600, inst = new T.InstancedMesh(tg, tm, N), m4 = new T.Matrix4(), q4 = new T.Quaternion(), e4 = new T.Euler(), s4 = new T.Vector3(), p4 = new T.Vector3(), col = new T.Color();
      let k = 0;
      for (let tries = 0; tries < N * 6 && k < N; tries++) {
        const a = R0() * PI * 2, rr = 19 + Math.sqrt(R0()) * 62, x = Math.cos(a) * rr, z = Math.sin(a) * rr + 8;
        if (!free(x, z, 0) || floorAt(x, z) !== 'grass' || Math.abs(x) > 80) continue;
        const sc = .7 + R0() * .8;
        e4.set(0, R0() * PI, 0); q4.setFromEuler(e4); s4.set(sc, sc * (.8 + R0() * .5), sc); p4.set(x, 0, z);
        m4.compose(p4, q4, s4); inst.setMatrixAt(k, m4);
        col.setHSL(.25 + R0() * .06, .45 + R0() * .2, .8 + R0() * .15); inst.setColorAt(k, col);
        k++;
      }
      inst.count = k; inst.receiveShadow = true; inst.userData.dyn = true;
      R.scene.add(inst);
    }
    for (let k = 0; k < 10; k++) { const x = (R0() - .5) * 140, z = (R0() - .5) * 140 + 6; if (free(x, z, 3)) R.prefab('rock', { x, z, k: .7 + R0() * .6, yaw: R0() * 6 }, ph); }
    // облака и холмы на горизонте (в дымке)
    R.clouds(low ? 8 : 16, 9);
    for (let i = 0; i < 14; i++) { const a = i / 14 * PI * 2 + R0() * .3, d = 190 + R0() * 60, k = 28 + R0() * 30; P(null, { s: 'ico', x: Math.cos(a) * d, y: -k * .35, z: Math.sin(a) * d + 6, r: k, det: 1, sy: .55, c: ['#6fae62', '#7bbb6a', '#5f9d58'][i % 3] }); }
    // край мира: невидимые стены
    for (const [x, z, hx, hz] of [[0, -72, 90, 1], [0, 92, 90, 1], [-84, 10, 1, 90], [84, 10, 1, 90]]) ph.addBox({ x, z, y: 5, hx, hz, hy: 5, tag: 'edge' });

    return { rooms, seats, screens, floorAt };
  }

  // ═══ Экран ═══
  let root = null, api = null, S = null;

  function mount(el, gapi){
    api = gapi; root = el;
    const E = window.D37E;
    el.innerHTML = `<div class="wld mir">
        <div class="wld-top"><b>🌍 Мир Денчика</b><span class="wldShard"></span><span class="wldOnline">подключаемся…</span>
          <span class="wld-topbtns"><button type="button" data-act="look" title="Мой персонаж">🎭<span> Персонаж</span></button><button type="button" data-act="view" title="Вид от 1-го / 3-го лица (V)">👁<span> Вид</span></button><button type="button" data-act="gfx" title="Качество графики: тени, текстуры">🖥<span class="mirGfx"> Графика</span></button><button type="button" data-act="mode" title="Плоский мир — для слабых телефонов">🗺️<span> 2D</span></button><button type="button" data-act="help" title="Как играть">❓</button></span></div>
        <div class="wld-wrap is3d">
          <div class="wld-tags"></div>
          <div class="wld-log" aria-live="polite"></div>
          <div class="wld-pop wld-card" hidden></div>
          <div class="wld-pop wld-panel" hidden></div>
          <div class="wld-inv" hidden></div>
          <div class="wld-status">🌍 Загружаем мир…</div>
          <div class="wld-hint">${E?.isTouch?.() ? 'Джойстик слева — идти, справа — повернуть камеру. Подойди к столику и нажми ✋ — сядешь и сыграешь.' : 'WASD — идти, Shift — бег, Пробел — прыжок, E — сесть/играть, мышь — камера. Сядь за столик — партия начнётся, когда сядет второй.'}</div>
        </div>
        <div class="wld-bar">
          <div class="wld-emos">${EMOS.map(e => `<button type="button" data-emo="${e}">${e}</button>`).join('')}</div>
          <form class="wld-say"><input type="text" maxlength="120" autocomplete="off" placeholder="Написать всем…"><button type="submit" aria-label="Отправить">➤</button></form>
        </div>
      </div>`;
    const q = s => el.querySelector(s);
    const isGuest = typeof currentUser === 'undefined' || !currentUser;
    S = {
      el, q, wrap: q('.wld-wrap'), players: new Map(), me: null, ch: null, shard: 1, key: '', keys: null, pass: null, myRole: null,
      log: [], muted: new Set(), friends: new Set(), checkCache: new Map(), stopped: false, idleAt: Date.now(), hiddenAt: 0, pending: [],
      lastTs: 0, hostSnapAt: 0, joinedAt: Date.now(), live: null, occ: new Map(), mySeat: null, lastSend: { key: '', t: 0 }, sendT: 0, jumpVy: 0,
    };
    S.key = isGuest ? 'g:' + (window.GameRoom?.guestId?.() || Math.random().toString(36).slice(2)) : 'u:' + currentUser.id;
    S.me = { key: S.key, uid: isGuest ? null : currentUser.id, nick: isGuest ? (window.GameRoom?.nick?.() || 'Гость') : (currentProfile?.nick || 'Игрок'), look: window.D37Char ? window.D37Char.look() : {}, isMe: true, v: null };
    if (isGuest) { q('.wld-say input').placeholder = 'Войди, чтобы писать в чат'; q('.wld-say input').readOnly = true; }
    wireUi();
    const st0 = S;
    E.load().then(ok => {
      if (S !== st0 || S.stopped) return;
      if (!ok) { status('Не удалось загрузить 3D — включаем плоский мир'); setTimeout(() => switch2d(true), 800); return; }
      try { start3d(); } catch (e) { console.error(e); status('Ошибка 3D: ' + (e.message || e) + ' — включаем плоский мир'); setTimeout(() => switch2d(true), 1500); return; }
      status('');
      join();
      loadFriends();
      checkLive();
    });
    S.tick = setInterval(housekeeping, 1000);
  }

  // ── Движок: сцена, физика, игрок, камера, управление ──
  function start3d(){
    const E = window.D37E, wrap = S.wrap;
    const R = S.R = E.renderer(wrap);
    R.r.domElement.classList.add('wld-gl');
    R.setSky('#5aa7ff', '#cfeaff', '#eaf6ff', 90, 230);
    const ph = S.ph = new E.Phys({ ground: 0 });
    const C = S.C = E.controls({ onKey: () => activity() });
    const I = S.I = E.input(wrap, { controls: C, ignore: '.wld-pop, .wld-inv, .wld-status, button, a, input, .e-btn, .mir-tb' });
    const X = S.X = E.interact(ph, { who: S.key });
    S.world = buildWorld(R, ph, X, S);
    S.calls = R.bakeStatic();
    // свой персонаж
    let pos = null;
    try { pos = JSON.parse(localStorage.getItem('d37_mir_pos') || 'null'); } catch (e) {}
    const sp = pos && Math.abs(pos.x) < 80 && pos.z > -68 && pos.z < 88 ? pos : { x: SPAWN.x + (Math.random() - .5) * 6, z: SPAWN.z + Math.random() * 3, yaw: SPAWN.yaw };
    const P = S.P = E.player(ph, { x: sp.x, z: sp.z, yaw: sp.yaw ?? SPAWN.yaw });
    P.place(sp.x, typeof sp.y === 'number' ? S.ph.supportAt(sp.x, sp.z, P.ch.r * .5, sp.y + .3).y : S.ph.supportAt(sp.x, sp.z, P.ch.r * .5, 1).y, sp.z, sp.yaw ?? SPAWN.yaw);
    P.floorAt = S.world.floorAt;
    const A = S.A = E.actors(R);
    A.add(S.key, S.me.look, { x: P.ch.x, y: P.ch.y, z: P.ch.z, yaw: P.yaw });
    const rig = S.rig = E.cameraRig(R.camera, { yaw: (sp.yaw ?? SPAWN.yaw) - PI, pitch: .42, dist: 9.5, minD: 2.6, maxD: 22 });
    rig.snap(P.ch.x, P.ch.y, P.ch.z);
    S.unfollow = rig.follow(P);
    const H = S.H = E.ui(wrap, C);
    if (I.touch) H.buttons([{ action: 'crouch', icon: '⬇', label: 'присесть' }, { action: 'interact', icon: '✋', label: 'действие' }, { action: 'jump', icon: '⤒', label: 'прыжок', big: true }]);
    // звуки
    const AU = S.AU = E.audio();
    P.on('step', e => AU.step(e.floor, e.run, e.x, e.y, e.z));
    P.on('jump', e => { AU.play('jump', e); S.jumpVy = P.ch.vy; S.forceSend = true; });
    P.on('land', e => AU.play(e.floor === 'water' ? 'step_water1' : 'land', { ...e, vol: .35 + e.k * .65 }));
    P.on('roll', e => { AU.play('roll', e); S.forceSend = true; });
    P.on('parkour', e => { AU.play(e.move === 'vault' ? 'scuff' : e.move === 'letgo' ? 'land' : 'grip', e); S.forceSend = true; });
    P.on('blocked', e => H.toast(e.text, false));
    P.on('stand', () => { if (S.mySeat) leaveSeat(); });
    // камера в домах ближе, крыша прячется
    S.inside = null;
    S.loop = E.loop(update, frame);
    const ro = window.ResizeObserver ? new ResizeObserver(() => R.resize()) : null;
    ro?.observe(wrap);
    R.resize();
    S.cleanup3d = () => { ro?.disconnect(); };
    // экран сцены
    drawStageScreen();
    S.sitAt = sitAt; S.go = go; S.openEditor = openEditor; S.openStage = openStage; S.openGate = openGate; S.showInfo = showInfo;
  }

  // ── Шаг логики (1/60 с) ──
  function update(dt){
    if (!S || S.stopped || S.editing) return;
    const { C, P, X, rig, ph } = S;
    C.step(dt);
    if (C.down('chat')) { const i = S.q('.wld-say input'); if (!i.readOnly) setTimeout(() => i.focus(), 0); else if (typeof openGlobalAuth === 'function') openGlobalAuth(); }
    if (C.down('view')) toggleView();
    if (C.down('pause')) closePops();
    if (C.any()) activity();
    P.first = rig.mode === 'first';
    P.update(dt, C, rig);
    X.update(dt, P, C, rig.fwd(), P.first);
    // чужие: та же физика по их направлению
    for (const p of S.players.values()) stepRemote(p, dt);
    // в доме: крыша прячется, камера ближе
    let inside = null;
    for (const c of P.ch.inside) if (c.data?.room) { inside = c.data; break; }
    if (inside !== S.inside) {
      if (S.inside) S.inside.roof.visible = true;
      if (inside) inside.roof.visible = false;
      S.inside = inside;
      rig.maxD = inside ? 9 : 22; rig.minP = inside ? .55 : .08;
      if (inside) { rig.dist = Math.min(rig.dist, 8); rig.pitch = Math.max(rig.pitch, .75); }
    }
    netTick(dt);
    tableTick(dt);
  }

  // ── Кадр: человечки, камера, подписи, подсказки ──
  function frame(dt){
    if (!S || S.stopped || S.editing) return;
    const { R, A, P, rig, I, C, H, AU } = S, t = now() / 1000;
    // свой
    const me = A.get(S.key), pose = P.pose();
    if (me) { A.pose(S.key, pose); me.hidden = rig.mode === 'first'; }
    if (S.me._lookDirty) { A.setLook(me, S.me.look); S.me._lookDirty = false; }
    for (const p of S.players.values()) {
      let a = A.get(p.key);
      if (!a) a = A.add(p.key, p.look, { x: p.ch.x, y: p.ch.y, z: p.ch.z, yaw: p.yaw });
      if (p._lookDirty) { A.setLook(a, p.look); p._lookDirty = false; }
      Object.assign(a, p.pose, { fade: p.leaving ? Math.max(0, 1 - (now() - p.leaving) / 600) : 1 });
      if (p.emo && p.emo.t !== p._emoA) { p._emoA = p.emo.t; A.emote(p.key, p.emo.e, t); }
    }
    if (S.me.emo && S.me.emo.t !== S.me._emoA) { S.me._emoA = S.me.emo.t; A.emote(S.key, S.me.emo.e, t); }
    for (const k of [...A.list.keys()]) if (k !== S.key && !S.players.has(k)) A.remove(k);
    const look = { dx: I.look.dx + C.look.dx, dy: I.look.dy + C.look.dy, zoom: I.zoom };
    rig.update(dt, P, look, S.ph, C);
    I.wantLock = rig.mode === 'first' && !I.touch;
    A.update(dt, t, R.camera.position);
    AU.listener(R.camera.position.x, R.camera.position.y, R.camera.position.z, rig.yaw);
    // нажали на игрока — его карточка
    for (const tp of I.taps) { const hit = pickPlayer(tp.x, tp.y); if (hit) openCard(hit); }
    I.frameEnd(); C.frameEnd();
    R.update(dt); R.follow(P.ch.x, P.ch.z, P.ch.y);   // облака/вода; тени — за игроком
    R.render();
    drawTags();
    // на телефоне вместо «[E]» — значок кнопки ✋
    H.prompt(I.touch ? (P.mode === 'sit' ? '✋ Встать' : S.X.raw && S.X.cur ? '✋ ' + S.X.raw : null) : S.X.text, S.X.progress);
    H.stamina(P.stamina / P.maxStamina, P.exhausted);
    if (t - (S.posSaved || 0) > 3) { S.posSaved = t; savePos(); }
  }
  function savePos(x, z, yaw){
    if (!S?.P) return;
    const ch = S.P.ch;
    const y = x == null ? ch.y : S.ph.supportAt(x, z, ch.r * .5, ch.y + 1).y;
    try { localStorage.setItem('d37_mir_pos', JSON.stringify({ x: Math.round((x ?? ch.x) * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round((z ?? ch.z) * 100) / 100, yaw: Math.round((yaw ?? S.P.yaw) * 100) / 100 })); } catch (e) {}
  }
  function pickPlayer(cx, cy){
    const b = S.wrap.getBoundingClientRect();
    let hit = null, best = 44;
    for (const p of [S.me, ...S.players.values()]) {
      if (p.leaving) continue;
      const pos = p === S.me ? S.P.ch : p.ch;
      const [sx, sy, vis] = S.R.project(pos.x, pos.y + 1.2, pos.z), d = Math.hypot(cx - b.left - sx, cy - b.top - sy);
      if (vis && d < best) { best = d; hit = p; }
    }
    return hit;
  }
  function toggleView(){ const m = S.rig.toggle(); S.H.crosshair(m === 'first'); if (m !== 'first') S.I.unlock(); toast(m === 'first' ? '👁 Вид от 1-го лица (V — обратно)' : '🎥 Вид от 3-го лица'); }

  // ═══ Чужие игроки: та же физика по направлению из сообщений ═══
  const MODES = ['move', 'sit', 'hang', 'ladder', 'roll', 'pk'];
  function mkRemote(key, m){
    const E = window.D37E;
    const p = { key, uid: typeof m.uid === 'string' ? m.uid : null, nick: String(m.nick || 'Гость').slice(0, 24), look: freeLook(m.look), at: +m.at || 0,
      ch: S.ph.character({ x: +m.x || 0, y: 0, z: +m.z || 0 }), yaw: 0, wish: { x: 0, z: 0 }, spd: 0, mode: 'move', err: { x: 0, y: 0, z: 0 },
      pose: { moving: false, speed: 0, air: false, crouch: 0, sit: false, seatY: null, roll: -1, hang: false, ladder: false, pk: '', pkK: 0, x: +m.x || 0, y: 0, z: +m.z || 0, yaw: 0 },
      bubble: null, emo: null, v: undefined, pub: null, lastTs: 0, leaving: 0, rate: [], seat: null, modeT: 0 };
    p.ch.g = 20 * E.UNIT; p.ch.accG = 60; p.ch.accA = 30;
    p.ch.y = S.ph.supportAt(p.ch.x, p.ch.z, p.ch.r, 50).y;
    return p;
  }
  function stepRemote(p, dt){
    const E = window.D37E, ch = p.ch, ps = p.pose;
    p.modeT += dt;
    if (p.seat && S.world.seats.get(p.seat.id)) {   // сидит (место — из presence)
      const sp = S.world.seats.get(p.seat.id);
      ch.x = sp.x; ch.z = sp.z; ch.y = 0; p.yaw = sp.yaw;
      Object.assign(ps, { x: sp.x, y: 0, z: sp.z, yaw: sp.yaw, moving: false, speed: 0, air: false, sit: !sp.stand, seatY: sp.stand ? null : sp.y, roll: -1, hang: false, ladder: false, pk: '' });
      return;
    }
    if (p.mode === 'move') {
      S.ph.move(ch, dt, p.wish, p.spd, false);
      // сверка с последним сообщением — мягко
      const k = Math.min(1, dt * 6);
      ch.x += p.err.x * k; ch.y += p.err.y * k; ch.z += p.err.z * k;
      p.err.x *= 1 - k; p.err.y *= 1 - k; p.err.z *= 1 - k;
      const v = Math.hypot(ch.vx, ch.vz);
      if (v > .4) p.yaw = E.dampAngle(p.yaw, Math.atan2(ch.vx, ch.vz), 12, dt);
      Object.assign(ps, { x: ch.x, y: ch.y, z: ch.z, yaw: p.yaw, moving: v > .35, speed: v, air: !ch.grounded && ch.airT > .12, crouch: p.spd > 0 && p.spd < 3 ? 1 : 0, sit: false, roll: -1, hang: false, ladder: false, pk: '' });
    } else {
      // особые режимы: стоит, где сказали, поза — из режима
      ch.x += p.err.x; ch.y += p.err.y; ch.z += p.err.z; p.err.x = p.err.y = p.err.z = 0;
      Object.assign(ps, { x: ch.x, y: ch.y, z: ch.z, yaw: p.yaw, moving: false, speed: 0, air: false, crouch: 0, sit: false,
        roll: p.mode === 'roll' ? Math.min(1, p.modeT / .8) : -1, hang: p.mode === 'hang', ladder: p.mode === 'ladder', climbPh: p.modeT * 6, pk: p.mode === 'pk' ? 'mantle' : '', pkK: Math.min(1, p.modeT / .6) });
      if (p.mode === 'roll' && p.modeT > .8) p.mode = 'move';
    }
  }

  // ═══ Сеть ═══
  async function join(shard = 1){
    if (typeof sbClient === 'undefined' || !sbClient) { status('Нет связи с сервером — обнови страницу'); return; }
    const st = S;
    try { st.keys = st.keys || await makeKeys(); } catch (e) { status('Браузер не поддерживает защищённые сообщения — обнови его'); return; }
    if (st.me.uid && !st.pass) { try { const { data, error } = await sbClient.rpc('world_pass', { p_pub: st.keys.pub }); if (!error && data) st.pass = data; } catch (e) {} }
    if (S !== st || st.stopped) return;
    S.shard = shard;
    S.q('.wldShard').textContent = `сервер ${shard}`;
    const ch = sbClient.channel(CHAN + shard, { config: { broadcast: { self: false }, presence: { key: S.key } } });
    S.ch = ch; S.firstSync = false;
    ch.on('presence', { event: 'sync' }, () => { if (S?.ch === ch) onSync(); });
    ch.on('broadcast', { event: 'w' }, ({ payload }) => { if (S?.ch === ch) onMsg(payload); });
    ch.subscribe(async s => {
      if (S?.ch !== ch || S.stopped) return;
      if (s === 'SUBSCRIBED') { status(''); await ch.track(presenceMeta()); }
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') status('Связь с миром потерялась — переподключаемся…');
    });
  }
  const presenceMeta = () => ({ id: S.key, uid: S.me.uid, nick: S.me.nick, look: S.me.look, pub: S.keys.pub, pass: S.pass, x: Math.round(S.P.ch.x * 10) / 10, z: Math.round(S.P.ch.z * 10) / 10, at: S.joinedAt, seat: S.mySeat ? { id: S.mySeat.id, c: S.mySeat.c, t: S.mySeat.t } : null });
  const retrack = () => { if (S?.ch && S.keys) S.ch.track(presenceMeta()).catch(() => {}); };
  function leaveChannel(){ const ch = S?.ch; if (!ch) return; S.ch = null; try { ch.untrack(); } catch (e) {} try { sbClient.removeChannel(ch); } catch (e) {} }
  function onSync(){
    const st = S.ch.presenceState(), seen = new Map();
    for (const [key, metas] of Object.entries(st)) { const m = metas.reduce((a, b) => ((b.at || 0) >= (a.at || 0) ? b : a), metas[0]); if (m && m.id === key) seen.set(key, m); }
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
        if (p) S.A?.remove(key);
        p = mkRemote(key, m);
        p.lookRaw = JSON.stringify(m.look || {});
        S.players.set(key, p);
        if (typeof m.pub === 'string' && m.pub.length < 200) { p.pubRaw = m.pub; importPub(m.pub).then(k => { p.pub = k; flushPending(); }).catch(() => {}); }
        identify(p, m);
      } else {
        const lk = JSON.stringify(m.look || {});
        if (p.lookRaw !== lk) { p.lookRaw = lk; p.look = freeLook(m.look); p._lookDirty = true; if (p.v) serverLook(p, m, true); }
      }
      // место за столом/на скамейке
      const s = m.seat && typeof m.seat.id === 'string' && S.world.seats.has(m.seat.id) ? { id: m.seat.id, c: /^[a-z0-9]{4,12}$/.test(m.seat.c || '') ? m.seat.c : null, t: +m.seat.t || 0 } : null;
      p.seat = s;
    }
    for (const [key, p] of S.players) if (!seen.has(key) && !p.leaving) p.leaving = now();
    recomputeSeats();
    const n = 1 + [...S.players.values()].filter(p => !p.leaving).length;
    S.q('.wldOnline').textContent = `👥 ${n} ${n % 10 === 1 && n % 100 !== 11 ? 'игрок' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'игрока' : 'игроков'}`;
  }
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
  async function serverLook(p, m, fresh){
    try {
      const looks = await window.D37Char?.looksOf?.([p.uid], fresh);
      if (looks && looks[p.uid] && S && S.players.get(p.key) === p) { p.look = Object.assign(freeLook(m.look), looks[p.uid]); p._lookDirty = true; }
    } catch (e) {}
  }
  async function loadFriends(){
    const st = S;
    if (!st.me.uid || typeof sbClient === 'undefined' || !sbClient) return;
    try {
      const { data } = await sbClient.from('friendships').select('requester_id,addressee_id,status').or(`requester_id.eq.${st.me.uid},addressee_id.eq.${st.me.uid}`);
      (data || []).forEach(r => { if (r.status === 'accepted') st.friends.add(r.requester_id === st.me.uid ? r.addressee_id : r.requester_id); });
    } catch (e) {}
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
  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
  const clampPos = (x, z) => [Math.max(-82, Math.min(82, x)), Math.max(-70, Math.min(90, z))];
  async function onMsg(pl){
    if (!S || !pl || typeof pl.k !== 'string' || typeof pl.m !== 'string' || typeof pl.s !== 'string' || pl.m.length > 3000) return;
    const p = S.players.get(pl.k);
    if (!p || !p.pub) { if (S.pending.length < 40) S.pending.push({ pl, at: now() }); return; }
    if (!await verify(p.pub, pl.s, pl.m) || !S) return;
    let d;
    try { d = JSON.parse(pl.m); } catch (e) { return; }
    if (!d || typeof d.t !== 'string' || !(d.ts > p.lastTs)) return;
    p.lastTs = d.ts;
    const t = now();
    p.rate = p.rate.filter(x => t - x < 2000);
    if (p.rate.length >= 16) return;   // защита от флуда: не больше 16 событий за 2 с
    p.rate.push(t);
    if (d.t === 'st') applySt(p, d);
    else if (d.t === 'hi') {
      const elders = [S.me, ...[...S.players.values()].filter(x => !x.leaving && x.key !== p.key)].sort((a, b) => (a.at || S.joinedAt) - (b.at || S.joinedAt));
      if (elders[0] === S.me && now() - S.hostSnapAt > 1500) {
        S.hostSnapAt = now();
        const me = S.P.ch, list = [[S.key, r2(me.x), r2(me.y), r2(me.z), r2(S.P.yaw)], ...[...S.players.values()].filter(x => !x.leaving && x.key !== p.key).slice(0, 40).map(x => [x.key, r2(x.ch.x), r2(x.ch.y), r2(x.ch.z), r2(x.yaw)])];
        setTimeout(() => send({ t: 'snap', list }), 200);
      }
    } else if (d.t === 'snap') {
      if (!Array.isArray(d.list)) return;
      for (const it of d.list.slice(0, 40)) {
        if (!Array.isArray(it) || it[0] === S.key) continue;
        const o = S.players.get(it[0]);
        if (!o || [1, 2, 3].some(i => typeof it[i] !== 'number')) continue;
        if (o.key === p.key || Date.now() - S.joinedAt < 8000) { const [x, z] = clampPos(it[1], it[3]); o.ch.x = x; o.ch.y = Math.max(0, Math.min(20, it[2])); o.ch.z = z; o.yaw = +it[4] || 0; }
      }
    } else if (d.t === 'say') {
      if (!p.uid || S.muted.has(p.key) || typeof d.text !== 'string') return;
      say(p, d.text);
    } else if (d.t === 'emo') {
      if (EMOS.includes(d.e) && !S.muted.has(p.key)) p.emo = { e: d.e, t: now() };
    } else if (d.t === 'inv') {
      if (d.to !== S.key || S.muted.has(p.key) || typeof d.g !== 'string' || typeof d.code !== 'string') return;
      if (!/^[a-z0-9]{4,12}$/.test(d.code) || !(typeof GAMES !== 'undefined' && GAMES.some(g => g.id === d.g)) || NO_ROOM.has(d.g)) return;
      showInvite(p, d.g, d.code, !!d.coop, typeof d.tb === 'string' ? d.tb : null);
    } else if (d.t === 'go') {
      // «Начать» за карточным столом: все, кто сидит за этим столом с тем же кодом, — в игру
      if (!S.mySeat || typeof d.tb !== 'string' || S.mySeat.tb?.id !== d.tb || d.c !== S.mySeat.c) return;
      if (p.seat && S.world.seats.get(p.seat.id)?.tb?.id === d.tb) startGame(S.mySeat.tb, S.mySeat.c);
    } else if (d.t === 'mute') {
      if (!p.v || !['admin', 'moderator'].includes(p.v.role) || typeof d.to !== 'string') return;
      S.muted.add(d.to);
      const who = S.players.get(d.to);
      if (who) { who.bubble = null; addLog(null, `🔇 ${p.v.nick} заглушил(а) игрока ${who.nick}`); }
      if (d.to === S.key) addLog(null, '🔇 Модератор заглушил тебя: другие не видят твоих сообщений');
    }
  }
  const r2 = v => Math.round(v * 100) / 100;
  // Движение чужого: позиция, направление (16 сторон), скорость, режим
  function applySt(p, d){
    const x = num(d.x), y = num(d.y), z = num(d.z);
    if (x === null || y === null || z === null) return;
    const [cx, cz] = clampPos(x, z), cy = Math.max(-1, Math.min(30, y)), U = window.D37E.UNIT;
    const ex = cx - p.ch.x, ey = cy - p.ch.y, ez = cz - p.ch.z;
    if (Math.hypot(ex, ey, ez) > 1.8) { p.ch.x = cx; p.ch.y = cy; p.ch.z = cz; p.err = { x: 0, y: 0, z: 0 }; }
    else p.err = { x: ex, y: ey, z: ez };
    const a = num(d.a), s = num(d.s), k = Math.max(0, Math.min(1, num(d.k) ?? 1));
    const ang = a !== null && a >= 0 ? a / 16 * PI * 2 : null;
    p.wish = ang === null ? { x: 0, z: 0 } : { x: Math.sin(ang) * k, z: Math.cos(ang) * k };
    p.spd = [0, 2, 4, 7][Math.max(0, Math.min(3, s || 0))] * U;
    const mode = MODES[num(d.m) || 0] || 'move';
    if (mode !== p.mode) p.modeT = 0;
    p.mode = mode;
    if (num(d.yw) !== null) p.yaw = d.yw;
    if (num(d.vy) !== null && d.vy > 0) { p.ch.vy = Math.min(20, d.vy); p.ch.grounded = false; p.ch.airT = 0; }
  }
  // Своё движение: шлём, только когда меняется направление/скорость/режим (и сверку раз в 2,5 с)
  function netTick(dt){
    if (!S.ch || !S.keys) return;
    const P = S.P, C = S.C, rig = S.rig, U = window.D37E.UNIT;
    S.sendT += dt;
    let a = -1, s = 0, k = 0;
    if (P.mode === 'move') {
      const m = C.move, fx = -Math.sin(rig.yaw), fz = -Math.cos(rig.yaw), rx = Math.cos(rig.yaw), rz = -Math.sin(rig.yaw);
      const wx = rx * m.x + fx * m.z, wz = rz * m.x + fz * m.z, wl = Math.hypot(wx, wz);
      if (wl > .2 && P.enabled) { a = Math.round(Math.atan2(wx, wz) / (PI * 2) * 16) & 15; s = P.crouch ? 1 : P.running ? 3 : 2; k = Math.round(Math.min(1, wl) * 4) / 4; }
    }
    const mode = MODES.indexOf(P.mode === 'pk' ? 'pk' : P.mode);
    const key = `${mode}|${a}|${s}|${k}`, moving = a >= 0 || !P.ch.grounded;
    const due = key !== S.lastSend.key || S.forceSend || (moving && S.sendT - S.lastSend.t > 2.5);
    if (!due || S.sendT - S.lastSend.t < .15) return;
    const ch = P.ch, d = { t: 'st', x: r2(ch.x), y: r2(ch.y), z: r2(ch.z), a, s, k, m: Math.max(0, mode), yw: r2(P.yaw) };
    if (S.jumpVy) { d.vy = r2(S.jumpVy); S.jumpVy = 0; }
    S.lastSend = { key, t: S.sendT }; S.forceSend = false;
    send(d);
  }

  // ═══ Столы: сесть, ждать соперника, начать партию ═══
  function recomputeSeats(){
    const occ = new Map(), byTable = new Map();
    const all = [...S.players.values()].filter(p => !p.leaving && p.seat).map(p => ({ p, ...p.seat }));
    if (S.mySeat) all.push({ p: S.me, id: S.mySeat.id, c: S.mySeat.c, t: S.mySeat.t });
    all.sort((a, b) => a.t - b.t || (a.p.key < b.p.key ? -1 : 1));
    for (const it of all) {
      if (occ.has(it.id)) {   // место уже занято раньше — меня сдвинули
        if (it.p === S.me) { S.P.standUp(); toast('Это место успели занять'); }
        continue;
      }
      occ.set(it.id, it.p);
      const sp = S.world.seats.get(it.id);
      if (sp?.tb) { if (!byTable.has(sp.tb.id)) byTable.set(sp.tb.id, []); byTable.get(sp.tb.id).push(it); }
    }
    S.occ = occ; S.byTable = byTable;
    // код стола — у того, кто сел первым
    if (S.mySeat?.tb) {
      const list = byTable.get(S.mySeat.tb.id) || [], host = list.find(it => it.c);
      if (host && host.c !== S.mySeat.c && host.p !== S.me) { S.mySeat.c = host.c; retrack(); }
    }
    renderTablePanel();
  }
  function sitAt(sp){
    const P = S.P;
    const who = S.occ.get(sp.id);
    if (who && who !== S.me) { toast('Занято: ' + who.nick); return; }
    if (!P.sitOn({ x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, stand: sp.stand })) return;
    S.AU.play('click');
    if (!sp.tb) { S.mySeat = { id: sp.id, t: Date.now(), c: null }; retrack(); recomputeSeats(); return; }
    const list = S.byTable?.get(sp.tb.id) || [], host = list.find(it => it.c && it.p !== S.me);
    S.mySeat = { id: sp.id, tb: sp.tb, s: sp.s, t: Date.now(), c: host ? host.c : newCode() };
    S.countdown = 0;
    retrack(); recomputeSeats();
  }
  function leaveSeat(){
    if (!S.mySeat) return;
    S.mySeat = null; S.countdown = 0;
    retrack(); recomputeSeats();
  }
  // Каждый шаг: если стол полон — отсчёт и в игру
  function tableTick(dt){
    const my = S.mySeat;
    if (!my?.tb) { S.countdown = 0; return; }
    const list = S.byTable?.get(my.tb.id) || [], full = list.length >= my.tb.n;
    if (full) {
      if (!S.countdown) { S.countdown = 3.2; S.AU.play('coin'); }
      const prev = Math.ceil(S.countdown);
      S.countdown -= dt;
      if (Math.ceil(S.countdown) !== prev) renderTablePanel();
      if (S.countdown <= 0) { S.countdown = 0; startGame(my.tb, my.c); }
    } else if (S.countdown) { S.countdown = 0; renderTablePanel(); }
  }
  // В игру: сначала «начали» всем за столом (кто досчитал первым — уводит остальных: иначе его уход отменит их отсчёт)
  async function startGame(tb, code){
    if (!S || S.leavingTo) return;
    const st = S, sp = S.world.seats.get(S.mySeat?.id);
    // вернуться — к этому же столу (стоя рядом)
    if (sp) savePos(sp.x + Math.sin(sp.yaw) * -1.3, sp.z + Math.cos(sp.yaw) * -1.3, sp.yaw);
    st.leavingTo = `#/games/${tb.game}/${code}`;
    const n = (st.byTable?.get(tb.id) || []).length || 2;
    try { sessionStorage.setItem('d37_autostart', JSON.stringify({ g: tb.game, c: code, n, t: Date.now() })); } catch (e) {}
    try { await Promise.race([send({ t: 'go', tb: tb.id, c: code }), new Promise(r => setTimeout(r, 600))]); } catch (e) {}
    location.hash = st.leavingTo;
  }
  function renderTablePanel(){
    let box = S.q('.mir-tb');
    const my = S.mySeat;
    if (!my?.tb) { if (box) box.hidden = true; return; }
    if (!box) { box = document.createElement('div'); box.className = 'wld-inv mir-tb'; S.wrap.appendChild(box); box.addEventListener('click', e => { const b = e.target.closest('[data-tb]'); if (b) tableAct(b.dataset.tb); }); }
    const tb = my.tb, gi = gameInfo(tb.game), list = S.byTable?.get(tb.id) || [], n = list.length, others = list.filter(it => it.p !== S.me).map(it => esc(it.p.nick));
    let msg;
    if (S.countdown > 0) msg = `<b>${gi.icon} ${esc(gi.title)}</b>: все на месте — начинаем через <b>${Math.ceil(S.countdown)}</b>…`;
    else if (n < 2) msg = `<b>${gi.icon} ${esc(gi.title)}</b> · ${n}/${tb.n}. Ждём соперника — или позови друга.`;
    else msg = `<b>${gi.icon} ${esc(gi.title)}</b> · ${n}/${tb.n}: ${others.join(', ')}`;
    const btns = [];
    if (!S.countdown && n >= 2 && tb.n > 2) btns.push('<button type="button" class="ct-start" data-tb="go">▶ Начать</button>');
    if (!S.countdown && n < 2) btns.push(`<button type="button" class="ct-start" data-tb="bot">🤖 ${tb.n > 2 ? 'С ботами' : 'С ботом'}</button>`);
    if (!S.countdown && n < tb.n) btns.push('<button type="button" data-tb="invite">📨 Позвать</button>', '<button type="button" data-tb="link">🔗 Ссылка</button>');
    btns.push('<button type="button" data-tb="up">Встать</button>');
    box.innerHTML = `<div>${msg}</div><div class="wld-acts">${btns.join('')}</div><div class="wld-sub" hidden></div>`;
    box.hidden = false;
  }
  function tableAct(a){
    const my = S.mySeat; if (!my?.tb) return;
    const tb = my.tb;
    activity();
    if (a === 'up') S.P.standUp();
    else if (a === 'bot') { const sp = S.world.seats.get(my.id); if (sp) savePos(sp.x + Math.sin(sp.yaw) * -1.3, sp.z + Math.cos(sp.yaw) * -1.3, sp.yaw); S.leavingTo = `#/games/${tb.game}`; location.hash = S.leavingTo; }
    else if (a === 'go') startGame(tb, my.c);
    else if (a === 'link') {
      const url = `${location.origin}/#/games/${tb.game}/${my.c}`;
      navigator.clipboard?.writeText(url).then(() => toast('🔗 Ссылка скопирована — отправь другу'), () => prompt('Ссылка на эту партию:', url));
    } else if (a === 'invite') {
      const sub = S.q('.mir-tb .wld-sub'), free = [...S.players.values()].filter(p => !p.leaving && !p.seat);
      sub.hidden = false;
      sub.innerHTML = free.length ? `<div class="wld-sublbl">Кого позвать за стол?</div><div class="wld-chips">${free.slice(0, 12).map(p => `<button type="button" data-tb="inv:${esc(p.key)}">${S.friends.has(p.uid) ? '💚 ' : ''}${esc(p.nick)}</button>`).join('')}</div>`
        : '<div class="wld-sublbl">В мире сейчас никого свободного. Скопируй ссылку и отправь другу — он сразу попадёт за твой стол.</div>';
    } else if (a.startsWith('inv:')) {
      const p = S.players.get(a.slice(4)); if (!p) return;
      send({ t: 'inv', to: p.key, g: tb.game, code: my.c, tb: tb.id });
      toast(`📨 Позвал(а) ${p.nick} за стол`);
    }
  }

  // ═══ Окна ═══
  function wireUi(){
    const el = S.el, q = S.q;
    el.querySelector('.wld-emos').addEventListener('click', e => { const b = e.target.closest('[data-emo]'); if (b) { activity(); emote(b.dataset.emo); } });
    q('.wld-say').addEventListener('submit', e => {
      e.preventDefault();
      const i = q('.wld-say input');
      if (i.readOnly) { if (typeof openGlobalAuth === 'function') openGlobalAuth(); return; }
      const t = i.value.trim();
      if (!t) return;
      if (Date.now() - (S.lastSay || 0) < 1500) { toast('Не так быстро 🙂'); return; }
      S.lastSay = Date.now(); i.value = ''; i.blur(); activity();
      say(S.me, t); send({ t: 'say', text: t.slice(0, 120) });
    });
    q('.wld-say input').addEventListener('focus', () => { if (q('.wld-say input').readOnly && typeof openGlobalAuth === 'function') openGlobalAuth(); });
    q('.wld-say input').addEventListener('keydown', e => { if (e.key === 'Escape') e.target.blur(); });
    el.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && el.contains(b)) onAct(b.dataset.act, b); });
    const onVis = () => { if (document.hidden) S.hiddenAt = Date.now(); else S.hiddenAt = 0; };
    document.addEventListener('visibilitychange', onVis);
    S.cleanupUi = () => document.removeEventListener('visibilitychange', onVis);
  }
  const toast = t => { if (S?.H) S.H.toast(t); else api?.toast?.(t); };
  const activity = () => { if (S) S.idleAt = Date.now(); };
  function status(t){ const s = S?.q('.wld-status'); if (!s) return; s.hidden = !t; s.textContent = t; }
  function say(p, text){ const t = clean(text); if (!t) return; p.bubble = { text: t, t: now() }; addLog(p, t); }
  function emote(e){ if (Date.now() - (S.lastEmo || 0) < 900) return; S.lastEmo = Date.now(); S.me.emo = { e, t: now() }; send({ t: 'emo', e }); }
  function addLog(p, text){
    S.log.push({ who: p ? p.nick : '', me: p === S.me, sys: !p, text });
    if (S.log.length > 40) S.log.shift();
    S.q('.wld-log').innerHTML = S.log.slice(-6).map(l => l.sys ? `<div class="sys">${esc(l.text)}</div>` : `<div${l.me ? ' class="me"' : ''}><b>${esc(l.who)}:</b> ${esc(l.text)}</div>`).join('');
  }
  function closePops(){ S.q('.wld-card').hidden = true; S.q('.wld-panel').hidden = true; }
  function badges(p){
    const v = p.v, out = [];
    if (v?.role && ROLE[v.role]) out.push(`<span class="wld-b" style="color:${ROLE[v.role][1]}">${ROLE[v.role][0]} ${ROLE[v.role][2]}</span>`);
    if (v?.vip) out.push(`<span class="wld-b" style="color:${VIPC[v.vip] || '#facc15'}">✨ VIP ${esc(v.vip)}</span>`);
    if (v?.level) out.push(`<span class="wld-b">⭐ ${v.level} ур.</span>`);
    if (!p.uid) out.push('<span class="wld-b dim">гость</span>');
    else if (!v && p !== S.me) out.push('<span class="wld-b dim">не проверен</span>');
    if (p.uid && S.friends.has(p.uid)) out.push('<span class="wld-b" style="color:#4ade80">💚 друг</span>');
    return out.join('');
  }
  async function openCard(p){
    const box = S.q('.wld-card');
    S.q('.wld-panel').hidden = true;
    S.cardFor = p.key;
    const img = window.D37Char ? window.D37Char.img(p.look, 64) : '';
    const head = `<div class="wld-ch"><img src="${img}" alt=""><div><b>${esc(p.nick)}</b><div class="wld-bs">${badges(p)}</div></div><button type="button" class="wld-x" data-act="close" aria-label="Закрыть">✕</button></div>`;
    if (p === S.me) { box.innerHTML = head + `<div class="wld-acts"><button type="button" data-act="look">🎭 Сменить персонажа</button>${S.me.uid ? `<button type="button" data-act="profile:${S.me.uid}">👤 Мой профиль</button>` : '<button type="button" data-act="login">🔑 Войти</button>'}</div>`; box.hidden = false; return; }
    const acts = [];
    if (p.uid) acts.push(`<button type="button" data-act="profile:${p.uid}">👤 Профиль</button>`);
    if (p.uid && S.me.uid) acts.push('<button type="button" data-act="friend" class="wldFriend">…</button>');
    else if (p.uid) acts.push('<button type="button" data-act="login">➕ Войди, чтобы дружить</button>');
    acts.push('<button type="button" data-act="invite">🎮 Позвать в игру</button>');
    if (S.mySeat?.tb) acts.push('<button type="button" data-act="invtable">🪑 Позвать за мой стол</button>');
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
  function panel(head, body){
    const box = S.q('.wld-panel');
    S.q('.wld-card').hidden = true;
    box.innerHTML = `<div class="wld-ph">${head}<button type="button" class="wld-x" data-act="close" aria-label="Закрыть">✕</button></div>${body}`;
    box.hidden = false;
  }
  function showInfo(title, text){ panel(`<b>${esc(title)}</b>`, `<p>${esc(text)}</p>`); }
  function openStage(){
    const live = S.live;
    panel('<span class="wld-pe">📺</span><b>Сцена Денчика</b>', live
      ? `<p><b class="wld-live">🔴 Денчик сейчас в эфире!</b> Заходи на стрим.</p><div class="wld-acts"><a class="ct-start" href="https://www.twitch.tv/dan4ik37" target="_blank" rel="noopener">▶ Смотреть стрим</a><button type="button" data-act="go:#/chat">💬 Чат сайта</button></div>`
      : `<p>Сейчас стрима нет. Смотри ролики Денчика — их почти 6000.</p><div class="wld-acts"><a class="ct-start" href="/videos">🎬 Все видео</a><a href="https://www.twitch.tv/dan4ik37" target="_blank" rel="noopener">📺 Канал на Twitch</a></div>`);
  }
  function openGate(gt){
    const gi = gameInfo(gt.g);
    panel(`<span class="wld-pe">${gt.e}</span><b>${esc(gt.name)}</b>`, `<p>${esc(gi.desc || '')}</p><div class="wld-acts"><button type="button" class="ct-start" data-act="go:#/games/${gt.g}">▶ Играть</button>${NO_ROOM.has(gt.g) ? '' : `<button type="button" data-act="room:${gt.g}">👥 С другом</button>`}${COOP.has(gt.g) ? `<button type="button" data-act="coop:${gt.g}">🤝 Вместе</button>` : ''}</div>`);
  }
  function go(hash){ savePos(); S.leavingTo = hash; location.hash = hash; }
  function inviteMenu(p){
    const sub = S.q('.wld-card .wld-sub'); if (!sub) return;
    sub.hidden = false;
    sub.innerHTML = `<div class="wld-sublbl">Во что позвать ${esc(p.nick)}?</div><div class="wld-chips">${QUICK.map(gameInfo).map(g => `<button type="button" data-act="inv:${g.id}">${g.icon} ${esc(g.title)}${COOP.has(g.id) ? ' (вместе)' : ''}</button>`).join('')}</div>`;
  }
  const roomUrl = (g, code, coop) => `#/games/${g}/${coop ? 'coop/' : ''}${code}`;
  function showInvite(p, g, code, coop, tbId){
    const box = S.q('.wld-inv:not(.mir-tb)'), gi = gameInfo(g), tb = tbId && TABLES.find(t => t.id === tbId);
    box.innerHTML = `<div>${gi.icon} <b>${esc(p.nick)}</b> зовёт тебя ${tb ? 'за стол' : 'в игру'} «${esc(gi.title)}»${coop ? ' (вместе)' : ''}</div><div class="wld-acts"><button type="button" class="ct-start" data-act="accept">${tb ? '🪑 Иду' : '▶ Играть'}</button><button type="button" data-act="decline">Нет</button></div>`;
    box.dataset.url = roomUrl(g, code, coop); box.dataset.tb = tb ? tb.id : ''; box.dataset.code = code;
    box.hidden = false;
    S.AU?.play('coin');
    clearTimeout(S.invT);
    S.invT = setTimeout(() => { box.hidden = true; }, 40000);
  }
  // Принял приглашение за стол: свободное место этого стола — сесть; мест нет — сразу в комнату
  function acceptInvite(box){
    box.hidden = true;
    const tb = box.dataset.tb && TABLES.find(t => t.id === box.dataset.tb);
    if (tb) {
      const seat = [...S.world.seats.values()].find(sp => sp.tb === tb && !S.occ.get(sp.id));
      if (seat) {
        if (S.mySeat) S.P.standUp();
        S.P.place(seat.x - Math.sin(seat.yaw) * 1.2, null, seat.z - Math.cos(seat.yaw) * 1.2, seat.yaw);
        sitAt(seat);
        if (S.mySeat) { S.mySeat.c = box.dataset.code; retrack(); }
        return;
      }
    }
    if (box.dataset.url) go(box.dataset.url);
  }
  function onAct(a, b){
    activity();
    const p = S.players.get(S.cardFor);
    if (a === 'close') closePops();
    else if (a === 'look') openEditor();
    else if (a === 'view') { if (S.rig) toggleView(); }
    else if (a === 'login') { if (typeof openGlobalAuth === 'function') openGlobalAuth(); }
    else if (a === 'help') showInfo('❓ Как играть', S.I?.touch
      ? 'Левый палец — джойстик (до упора — бег). Правым пальцем крути камеру, двумя — приближай. ⤒ — прыжок (у стены — залезть на уступ), ⬇ — присесть, ✋ — сесть или играть. Сядь за столик в кафе: когда сядет второй игрок — партия начнётся.'
      : 'WASD — идти, Shift — бег, Пробел — прыжок (у стены — залезть на уступ, перелезть стол), C — присесть, Q — кувырок, E — сесть или играть, V — вид от 1-го лица, мышь — камера, колесо — приближение, Enter — чат. Сядь за столик в кафе: когда сядет второй игрок — партия начнётся. Клавиши можно поменять в настройках позже.');
    else if (a.startsWith('profile:')) go('#/profile/' + a.slice(8));
    else if (a.startsWith('go:')) go(a.slice(3));
    else if (a.startsWith('room:')) go(roomUrl(a.slice(5), newCode(), false));
    else if (a.startsWith('coop:')) go(roomUrl(a.slice(5), newCode(), true));
    else if (a === 'friend-add' && p && typeof sendFriendRequest === 'function') { sendFriendRequest(p.uid); b.textContent = '⏳ Заявка отправлена'; b.dataset.act = 'noop'; }
    else if (a === 'friend-accept' && p && typeof acceptFriendRequest === 'function') { acceptFriendRequest(p.uid); b.textContent = '✉ Написать'; b.dataset.act = 'friend-dm'; S.friends.add(p.uid); }
    else if (a === 'friend-dm' && p) { if (typeof openDmWith === 'function') openDmWith(p.uid, p.nick); }
    else if (a === 'invite' && p) inviteMenu(p);
    else if (a === 'invtable' && p && S.mySeat?.tb) { send({ t: 'inv', to: p.key, g: S.mySeat.tb.game, code: S.mySeat.c, tb: S.mySeat.tb.id }); toast(`📨 Позвал(а) ${p.nick} за стол`); closePops(); }
    else if (a.startsWith('inv:') && p) {
      const g = a.slice(4), coop = COOP.has(g), code = newCode();
      send({ t: 'inv', to: p.key, g, code, coop });
      addLog(null, `📨 Позвал(а) ${p.nick} в «${gameInfo(g).title}» — ждём в комнате`);
      setTimeout(() => go(roomUrl(g, code, coop)), 400);
    }
    else if (a === 'mutelocal' && p) { if (S.muted.has(p.key)) S.muted.delete(p.key); else { S.muted.add(p.key); p.bubble = null; } openCard(p); }
    else if (a === 'mute' && p) { if (confirm(`Заглушить ${p.nick} для всех в этом мире до конца визита?`)) { send({ t: 'mute', to: p.key }); S.muted.add(p.key); p.bubble = null; closePops(); } }
    else if (a === 'accept') acceptInvite(S.q('.wld-inv:not(.mir-tb)'));
    else if (a === 'decline') S.q('.wld-inv:not(.mir-tb)').hidden = true;
    else if (a === 'mode') switch2d(true);
    else if (a === 'gfx') {   // качество: низкое → среднее → высокое (сохраняется), мир пересобирается
      const L = ['low', 'mid', 'high'], cur = S.R?.q || window.D37E.gfxQuality(), next = L[(L.indexOf(cur) + 1) % 3];
      try { localStorage.setItem('d37_gfx', next); } catch (e) {}
      const el = root, ga = api;
      unmount(); IMPL.mount(el, ga); current = IMPL;
      ga?.toast?.({ low: '🖥 Графика: низкая — быстро, без теней', mid: '🖥 Графика: средняя — тени', high: '🖥 Графика: высокая — мягкие тени и рельеф текстур' }[next]);
    }
    else if (a === 'rejoin') { S.q('.wld-status').hidden = true; S.stopped = false; S.idleAt = Date.now(); S.loop?.pause(false); join(1); }
  }
  function switch2d(on){
    try { localStorage.setItem('d37_world_2d', on ? '1' : '0'); } catch (e) {}
    const el = root, ga = api;
    unmount();
    (on ? OLD : IMPL).mount(el, ga);
    current = on ? OLD : IMPL;
    if (on) ga?.toast?.('🗺️ Плоский мир. Вернуть 3D — кнопка 🧊 вверху');
  }

  async function checkLive(){
    const st = S;
    try { const s = JSON.parse(sessionStorage.getItem('d37_live') || 'null'); if (s && Date.now() - s.t < 120e3) { st.live = s.live; drawStageScreen(); return; } } catch (e) {}
    try {
      const t = await fetch('https://decapi.me/twitch/uptime/dan4ik37', { cache: 'no-store' }).then(r => r.ok ? r.text() : '');
      st.live = !!t && !/offline|error|not found|could not|invalid/i.test(t);
      try { sessionStorage.setItem('d37_live', JSON.stringify({ t: Date.now(), live: st.live })); } catch (e) {}
    } catch (e) { st.live = false; }
    if (S === st) drawStageScreen();
  }
  function drawStageScreen(){
    const sc = S?.world?.screens?.stage; if (!sc) return;
    const map = sc.mat.map, c = map.image, g = c.getContext('2d'), w = c.width, h = c.height;
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, S.live ? '#7f1d1d' : '#312e81'); gr.addColorStop(1, '#0f172a');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff'; g.font = '900 54px Montserrat, Arial';
    g.fillText(S.live ? '🔴 В ЭФИРЕ' : 'DAN4IK37', w / 2, h * .38);
    const sub = S.live ? 'Денчик стримит — подойди к сцене' : 'Почти 6000 роликов — подойди к сцене';
    let fs_ = 26; g.font = `700 ${fs_}px Montserrat, Arial`;
    while (g.measureText(sub).width > w * .9 && fs_ > 12) { fs_ -= 2; g.font = `700 ${fs_}px Montserrat, Arial`; }
    g.fillStyle = '#fde68a'; g.fillText(sub, w / 2, h * .66);
    map.needsUpdate = true;
  }

  function housekeeping(){
    if (!S || S.stopped) return;
    if (Date.now() - S.idleAt > IDLE_MS || (S.hiddenAt && Date.now() - S.hiddenAt > HIDDEN_MS)) {
      S.stopped = true;
      leaveChannel();
      S.loop?.pause(true);
      for (const k of S.players.keys()) S.A?.remove(k);
      S.players.clear();
      const s = S.q('.wld-status');
      s.hidden = false;
      s.innerHTML = `😴 Ты долго стоял на месте — мы вывели тебя из мира, чтобы не держать место.<br><button type="button" class="ct-start" data-act="rejoin">🌍 Вернуться в мир</button>`;
      return;
    }
    for (const [key, p] of S.players) if (p.leaving && now() - p.leaving > 600) { S.players.delete(key); S.A?.remove(key); }
    if (S.pending.length) flushPending();
    if (S.ch && !S.stopped && Date.now() % 60000 < 1000) checkLive();
  }

  // ── Подписи над головами и пузыри (HTML поверх, как в world.js) ──
  function drawTags(){
    const tags = S.q('.wld-tags'), all = [S.me, ...S.players.values()], seen = new Set();
    for (const p of all) {
      let el = p._tag;
      if (!el) {
        el = p._tag = document.createElement('div');
        el.className = 'wld-tag';
        el.innerHTML = '<div class="wld-tbub" hidden></div><div class="wld-temo" hidden></div><b class="wld-tname"></b>';
        tags.appendChild(el);
      }
      seen.add(el);
      const a = S.A.get(p.key);
      if (!a || (p === S.me && S.rig.mode === 'first')) { el.style.display = 'none'; continue; }
      const top = a.sit ? (a.seatY ?? 0) - (a.ch.hipY || .52) + a.ch.top : a.y + a.ch.top * (1 - .3 * (a.crouch || 0));
      const [sx, sy, vis] = S.R.project(a.x, top + .45, a.z);
      if (!vis || (p.leaving && now() - p.leaving > 500)) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${Math.round(sx)}px,${Math.round(sy)}px) translate(-50%,-100%)`;
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
    for (const el of [...tags.children]) if (!seen.has(el)) el.remove();
  }

  // ── Свой персонаж в мире: редактор поверх (js/games/charedit.js) ──
  async function openEditor(){
    if (!window.D37Editor) { go('#/games/wardrobe'); return; }
    if (S.editing) return;
    const st0 = S, box = document.createElement('div');
    box.className = 'wld-edit';
    document.body.appendChild(box);
    document.documentElement.classList.add('wld-editing');
    S.editing = box;
    S.loop?.pause(true); S.C?.reset_state();
    closePops();
    const ok = await window.D37Editor.mount(box, { api, key: S.key, onClose: closeEditor });
    if (!ok && S === st0) { closeEditor(); go('#/games/wardrobe'); }
  }
  function closeEditor(){
    if (!S?.editing) return;
    window.D37Editor?.unmount();
    S.editing.remove(); S.editing = null;
    document.documentElement.classList.remove('wld-editing');
    S.loop?.pause(false);
    const L = window.D37Char ? window.D37Char.look() : {};
    if (JSON.stringify(L) !== JSON.stringify(S.me.look)) { S.me.look = L; S.me._lookDirty = true; retrack(); toast('🎭 Новый образ — его видят все в мире'); }
  }

  function unmount(){
    if (!S) return;
    const s = S;
    s.stopped = true;
    clearInterval(s.tick); clearTimeout(s.invT);
    if (s.mySeat) { s.mySeat = null; }
    leaveChannel();
    try { s.loop?.stop(); } catch (e) {}
    try { s.unfollow?.(); } catch (e) {}
    if (s.editing) { window.D37Editor?.unmount(); s.editing.remove(); document.documentElement.classList.remove('wld-editing'); }
    try { s.cleanup3d?.(); s.cleanupUi?.(); } catch (e) {}
    try { s.I?.dispose(); s.C?.dispose(); s.H?.dispose(); s.A?.dispose(); s.R?.dispose(); } catch (e) {}
    if (!s.leavingTo) savePos();
    S = null;
  }

  const supported = () => !!window.World3D?.supported?.() && !!window.D37E?.renderer;
  const IMPL = { mount, unmount };
  let current = null;
  window.GAME_IMPL = window.GAME_IMPL || {};
  window.GAME_IMPL.world = {
    mount(el, gapi){
      let f2d = false;
      try { f2d = localStorage.getItem('d37_world_2d') === '1'; } catch (e) {}
      current = (!f2d && supported()) || !OLD ? IMPL : OLD;
      current.mount(el, gapi);
      // из плоского мира — кнопка «3D» ведёт сюда
      if (current === OLD) setTimeout(() => {
        const b = el.querySelector('.wldMode');
        if (b && supported()) b.addEventListener('click', e => { e.stopImmediatePropagation(); try { localStorage.setItem('d37_world_2d', '0'); } catch (er) {} OLD.unmount(); current = IMPL; IMPL.mount(el, gapi); }, true);
      }, 0);
    },
    unmount(){ current?.unmount(); current = null; },
    _test: { TABLES, ARCADE, GATES, clean, old: OLD?._test, state: () => S },
  };
})();
