// ═══════════════════════════════════════
//  «НАБЕГИ» ⚔️ — нападения на ВОЕННЫЕ БАЗЫ боевой зоны «Мира Денчика» (docs/RAIDS.md; 12+). Каталог и правила стройки —
//  js/games/mir-base.js (MirBase: WDEFS, WRules), бой — js/games/raid-sim.js (RaidSim: тот же код считает сервер,
//  api/_lib/raid-sim.js), сервер — raids.sql (raid_*), bases.sql (war_*: база, армия, состав) и /api/raid (api/_lib/routes/raid.js).
//  Открывается и на странице игры (#/games/raid[/log|camp|top|train|shop|replay/<id>|friendly/<база>|join/<код>]), и окном поверх
//  мира (MirPlay: казарма базы [E], меню базы). В набег армию базы ведут главарь и офицеры (или все — если главарь разрешил).
// ═══════════════════════════════════════
// Экраны: штаб (своя база в 2.5D, армия, «⚔️ В бой!»), казарма (тренировка по времени — war_act), бой (разведка → высадка
// у края → 3 минуты), итог (засчитывает сервер), журнал защиты базы (повтор, «⚔️ Месть»), поход, лиги и топ баз, улучшения
// (💎/🪙 — только время и красота), учебный, приглашение в базу (join/<код>).
// Честность: браузер только РИСУЕТ бой и пишет ввод {t, u, x, z}; итог считает сервер по тому же вводу. Ушёл после высадки —
// ввод уходит sendBeacon'ом, бой засчитан как есть. Ничего не сохранилось — набег сохранён в localStorage (d37_raid_cur) и
// продолжается после перезагрузки.
(() => {
  const root = window;
  const MB = () => root.MirBase, RS = () => root.RaidSim;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('ru');
  const PI = Math.PI;
  const LS_CUR = 'd37_raid_cur', LS_DEV = 'd37_dev', LS_SEEN = 'd37_raid_help';
  const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const authed = () => typeof currentUser !== 'undefined' && !!currentUser;
  const sb = () => (typeof sbClient !== 'undefined' ? sbClient : null);
  const fmtT = s => { s = Math.max(0, Math.ceil(s)); if (s < 60) return s + ' с'; const m = Math.floor(s / 60); if (m < 60) return m + ' мин' + (m < 10 && s % 60 ? ' ' + (s % 60) + ' с' : ''); const h = Math.floor(m / 60); return h + ' ч' + (m % 60 ? ' ' + (m % 60) + ' мин' : ''); };
  const clock = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);
  // ключ браузера — общий с приглашениями (js/core/ref.js, тот же d37_dev)
  function dev(){ const r = root.D37Ref?.device?.(); if (r) return r; let d = null; try { d = localStorage.getItem(LS_DEV); if (!d) { d = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem(LS_DEV, d); } } catch (e) {} return d; }
  // поделиться ссылкой на раздел набегов — с кодом приглашения (js/core/ref.js)
  async function share(path, text){
    const url = (root.D37Ref?.wrap || (u => u))(window.D37Route ? D37Route.abs('#/games/raid/' + path) : location.origin + '/#/games/raid/' + path);
    if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) { navigator.share({ title: 'Набеги', text, url }).catch(() => {}); return; }
    try { await navigator.clipboard.writeText(text + ' ' + url); toast('📣 Ссылка скопирована — отправь другу'); }
    catch (e) { prompt('Скопируй и отправь другу:', text + ' ' + url); }
  }

  // ═══ Звуки боя (свои, короткие; общая громкость и «без звука» — как у игр сайта) ═══
  let actx = null, sndT = 0, sndN = 0;
  function snd(kind){
    try {
      if (localStorage.getItem('d37_games_mute') === '1') return;
      const now = performance.now();
      if (now - sndT > 250) { sndT = now; sndN = 0; }
      if (++sndN > 3) return;
      const k = root.D37Settings?.sfxGain?.() ?? 1;
      if (k < .01) return;
      actx = actx || new (root.AudioContext || root.webkitAudioContext)();
      const c = actx, t = c.currentTime, g = c.createGain();
      g.connect(c.destination);
      if (kind === 'boom' || kind === 'down') {
        const len = kind === 'down' ? .5 : .32, b = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
        const s = c.createBufferSource(), f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = kind === 'down' ? 500 : 900;
        s.buffer = b; s.connect(f); f.connect(g); g.gain.setValueAtTime(.16 * k, t); s.start(t);
      } else {
        const o = c.createOscillator(), [f0, f1, d, v, type] = { shot: [900, 300, .06, .05, 'square'], arrow: [1400, 900, .05, .03, 'triangle'], hit: [300, 160, .05, .04, 'square'], deploy: [520, 760, .07, .05, 'sine'], star: [880, 1320, .3, .09, 'sine'], heal: [700, 1050, .12, .03, 'sine'] }[kind] || [600, 400, .05, .03, 'sine'];
        o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d);
        g.gain.setValueAtTime(v * k, t); g.gain.exponentialRampToValueAtTime(.0001, t + d + .02);
        o.connect(g); o.start(t); o.stop(t + d + .03);
      }
    } catch (e) {}
  }

  // ═══ Вид отрядов: 3D-человечки в 2D (D37Sprite iso8); облики армии — за 💎 (только вид) ═══
  const LOOKS = {
    fighter: { body: 'boy', top: 'tshirt', trim: 'red', bottom: 'pants', botc: 'graphite', hat: 'army', hatc: 'green', hair: 'short', tone: 't3', item: 'sword' },
    archer: { body: 'girl', top: 'hoodie', trim: 'green', bottom: 'jeans', botc: 'denim', hat: 'none', hair: 'ponytail', hairc: 'ginger', tone: 't2' },
    tank: { body: 'boy', top: 'tshirt', trim: 'orange', bottom: 'cargo', botc: 'khaki', hgt: '4', wid: '4', head: '1', hair: 'buzz', tone: 't5', pst: 'chunky', psal: 'chunky', psar: 'chunky', psll: 'chunky', pslr: 'chunky', glove: 'boxing', glovec: 'red' },
    breaker: { body: 'boy', top: 'jacket', trim: 'yellow', bottom: 'pants', botc: 'black', hat: 'helmet', hatc: 'yellow', hgt: '1', hair: 'spiky', tone: 't4', glasses: 'round' },
    flyer: { body: 'boy', top: 'jersey', trim: 'blue', bottom: 'shorts', botc: 'denim', hat: 'propeller', back: 'wings', hair: 'side', hairc: 'blond', tone: 't2' },
    healer: { body: 'girl', top: 'dress', trim: 'white', hat: 'halo', back: 'wings', tone: 'fairy', hair: 'long', hairc: 'platinum', cheek: 'hearts' },
  };
  const ARMY_SKIN = {
    knight: { psh: 'knight', pst: 'knight', psal: 'knight', psar: 'knight', psll: 'knight', pslr: 'knight', hat: 'none' },
    robot: { psh: 'robot', pst: 'robot', psal: 'robot', psar: 'robot', psll: 'robot', pslr: 'robot', tone: 'robot', eyes: 'robot', hat: 'none' },
  };
  const ITEM = { fighter: '🗡️', archer: '🏹', tank: '🔨', breaker: '🧨', flyer: '💣', healer: '💚' };
  const TEAM = { fighter: '#ef4444', archer: '#22c55e', tank: '#f97316', breaker: '#facc15', flyer: '#38bdf8', healer: '#f472b6', hero: '#a855f7' };
  const sprites = new Map();
  let spriteReq = null;
  function spriteFor(k, skin, heroLook){
    const SP = root.D37Sprite;
    if (!SP?.supported?.()) return null;
    const key = k + '|' + (skin || '') + (k === 'hero' ? '|me' : '');
    let h = sprites.get(key);
    if (!h) {
      const look = k === 'hero' ? heroLook : { ...LOOKS[k], ...(skin && k !== 'hero' ? ARMY_SKIN[skin] : {}) };
      h = SP.handle(look, { view: 'iso8', size: 48, noItem: true, anims: ['idle', 'run', 'use'], style: SP.styleFor('toon'), key: k === 'hero' ? SP.myKey() : 'raid-' + key, pin: k === 'hero' });
      sprites.set(key, h);
    }
    return h;
  }
  function loadSprites(){
    if (spriteReq) return spriteReq;
    spriteReq = (typeof gamesLoadScript === 'function' ? gamesLoadScript('js/core/char2d.js') : Promise.resolve()).catch(() => {});
    return spriteReq;
  }

  // ═══ Сервер ═══
  const NOSQL = e => e && (e.code === 'PGRST202' || /Could not find the function/i.test(e.message || ''));
  async function rpc(name, args){
    const c = sb(); if (!c) return { ok: false, reason: 'net' };
    try {
      const { data, error } = await c.rpc(name, args || {});
      if (error) return { ok: false, reason: NOSQL(error) ? 'nosql' : /permission denied/i.test(error.message || '') ? 'auth' : 'net', error };
      if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.now === 'number') S && (S.off = data.now - Date.now() / 1000);
      return data ?? { ok: false, reason: 'net' };
    } catch (e) { return { ok: false, reason: 'net' }; }
  }
  const sNow = () => Date.now() / 1000 + (S?.off || 0);
  async function post(body, beacon){
    const json = JSON.stringify(body);
    if (beacon && navigator.sendBeacon) { try { return navigator.sendBeacon('/api/raid', new Blob([json], { type: 'application/json' })); } catch (e) {} }
    try {
      const r = await fetch('/api/raid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: json.length < 60000 });
      if (r.status === 404) return { ok: false, reason: 'off' };
      return await r.json();
    } catch (e) { return { ok: false, reason: 'net' }; }
  }
  const WHY = {
    ...(MB()?.WHY || {}),
    auth: 'Войди на сайт — набеги идут на настоящие базы игроков', none: 'Вступи в военную базу или основай свою в Боевой зоне «Мира Денчика»', nosql: 'Набеги откроются, когда сайт обновится',
    army: 'Армия базы пуста — потренируйте отряды в казарме ⚔️', limit: 'На сегодня боёв хватит — приходи завтра', limit_search: 'На сегодня поисков хватит — приходи завтра',
    active: 'Набег уже идёт', bricks: 'Не хватает кирпичей 🧱 в казне', busy: 'На эту базу сейчас уже нападают — попробуй ещё раз', nobody: 'Сейчас некого грабить',
    locked: 'Сначала пройди предыдущий лагерь', shield: 'У них щит 🛡️ — месть позже', revenged: 'Месть уже была', id: 'Не найдено', late: 'Время разведки вышло',
    net: 'Нет связи — попробуй ещё раз', off: 'Сервер набегов не отвечает — бой сохранён, засчитаем позже', week: 'Щит базе можно купить раз в неделю', max: 'Щит и так долгий',
    owned: 'Уже есть', gems: 'Не хватает 💎', coins: 'Не хватает монет 🪙', closed: 'Магазин закрыт', noq: 'Очередь пуста', idle: 'Сейчас ничего не строится', item: 'Нет такого',
    wins: 'Нужно больше побед базы за неделю', done: 'Уже забрали', args: 'Не получилось', bad_input: 'Сервер не принял бой', expired: 'Бой не засчитан — слишком поздно', early: 'Засчитываем…',
    rank: 'В набеги армию базы водят главарь и офицеры (главарь может разрешить всем)', army_out: 'Армию базы сейчас ведёт другой из состава — подожди конца боя',
    age: 'Набеги и военные базы — с 12 лет (укажи возраст в ⚙️ Настройках → Сайт)', th: 'Нужен штаб выше уровнем', place: 'Сюда не встанет: место занято или край базы',
    full: 'Казна полна — постройте или улучшите склад 📦',
  };
  const why = r => WHY[r?.reason] || WHY.args;

  // ═══ Состояние ═══
  let S = null;
  function toast(t){ try { if (S?.api?.toast) S.api.toast(t); else if (typeof gameToast === 'function') gameToast(t); } catch (e) {} }
  const defs = () => S?.defs || MB()?.WSERVER;
  const R = () => defs().raid;

  // ═══ Вид 2.5D (изометрия 2:1): карта боя n×n клеток (открытая часть базы + полоса высадки 2 клетки) ═══
  function makeView(cv, o = {}){
    const V = { cv, ctx: cv.getContext('2d'), dpr: 1, W: 300, H: 300, zoom: 1, px: 0, py: 0, tw0: 24, n: o.n || 16, zmax: Math.max(3, (o.n || 16) / 7) };
    V.resize = () => {
      const r = cv.getBoundingClientRect();
      V.dpr = Math.min(2, root.devicePixelRatio || 1);
      V.W = Math.max(160, r.width || cv.clientWidth || 300); V.H = Math.max(140, r.height || cv.clientHeight || 300);
      cv.width = Math.round(V.W * V.dpr); cv.height = Math.round(V.H * V.dpr);
      V.tw0 = Math.min(V.W / ((o.full ? 1.0375 : .8) * V.n), (V.H - 10) / ((o.full ? .519 : .4) * V.n + 1.6));
      V.apply();
    };
    V.apply = () => {
      V.tw = V.tw0 * V.zoom; V.hw = V.tw / 2; V.hh = V.tw / 4; V.vh = V.tw * .52;
      const lim = (V.zoom - 1) * V.W * .6;
      V.px = Math.max(-lim, Math.min(lim, V.px)); V.py = Math.max(-lim, Math.min(lim, V.py));
      V.ox = V.W / 2 + V.px; V.oy = V.H / 2 - V.n * V.hh + V.vh * .55 + V.py;
    };
    V.p = (cx, cz, h = 0) => [V.ox + (cx - cz) * V.hw, V.oy + (cx + cz) * V.hh - h * V.vh];
    V.un = (sx, sy) => { const a = (sx - V.ox) / V.hw, b = (sy - V.oy) / V.hh; return [(a + b) / 2, (b - a) / 2]; };
    V.zoomAt = (k, sx, sy) => {
      const [mx, mz] = V.un(sx, sy);
      V.zoom = Math.max(1, Math.min(V.zmax, V.zoom * k)); V.apply();
      const [nx, ny] = V.p(mx, mz); V.px += sx - nx; V.py += sy - ny; V.apply();
    };
    V.resize();
    return V;
  }
  // ── Краски ──
  function hexRgb(h){ h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const shadeCache = new Map();
  function col(hex, k = 0, tint){
    const key = hex + k + (tint ? tint.k : '');
    let v = shadeCache.get(key);
    if (v) return v;
    let [r, g, b] = hexRgb(hex);
    if (tint) { r += (tint.mix[0] * 255 - r) * tint.k; g += (tint.mix[1] * 255 - g) * tint.k; b += (tint.mix[2] * 255 - b) * tint.k; }
    const f = k >= 0 ? c => c + (255 - c) * k : c => c * (1 + k);
    v = `rgb(${Math.round(f(r))},${Math.round(f(g))},${Math.round(f(b))})`;
    shadeCache.set(key, v);
    return v;
  }
  function poly(g, pts, fill, stroke){ g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); } }
  // коробка: видны верх, грань +x (справа) и грань +z (слева)
  function box(V, x0, z0, w, d, y0, h, c, tint){
    const g = V.ctx, x1 = x0 + w, z1 = z0 + d, P = V.p;
    poly(g, [P(x1, z0, y0), P(x1, z1, y0), P(x1, z1, y0 + h), P(x1, z0, y0 + h)], col(c, -.18, tint));
    poly(g, [P(x0, z1, y0), P(x1, z1, y0), P(x1, z1, y0 + h), P(x0, z1, y0 + h)], col(c, -.34, tint));
    poly(g, [P(x0, z0, y0 + h), P(x1, z0, y0 + h), P(x1, z1, y0 + h), P(x0, z1, y0 + h)], col(c, .08, tint));
  }
  function pyramid(V, x0, z0, w, d, y, h, c, tint){
    const g = V.ctx, P = V.p, a = P(x0 + w / 2, z0 + d / 2, y + h), x1 = x0 + w, z1 = z0 + d;
    poly(g, [P(x0, z0, y), P(x1, z0, y), a], col(c, .1, tint));
    poly(g, [P(x0, z0, y), P(x0, z1, y), a], col(c, -.05, tint));
    poly(g, [P(x1, z0, y), P(x1, z1, y), a], col(c, -.15, tint));
    poly(g, [P(x0, z1, y), P(x1, z1, y), a], col(c, -.3, tint));
  }
  // двускатная крыша вдоль x (конёк по x)
  function gable(V, x0, z0, w, d, y, h, c, tint){
    const g = V.ctx, P = V.p, x1 = x0 + w, z1 = z0 + d, zm = z0 + d / 2;
    poly(g, [P(x0, z0, y), P(x1, z0, y), P(x1, zm, y + h), P(x0, zm, y + h)], col(c, .1, tint));
    poly(g, [P(x1, z0, y), P(x1, z1, y), P(x1, zm, y + h)], col(c, -.12, tint));
    poly(g, [P(x0, z1, y), P(x1, z1, y), P(x1, zm, y + h), P(x0, zm, y + h)], col(c, -.28, tint));
  }
  function cyl(V, cx, cz, r, y0, h, c, tint){
    const g = V.ctx, [sx, sy] = V.p(cx, cz, y0), rx = r * Math.SQRT2 * V.hw, ry = r * Math.SQRT2 * V.hh, hh = h * V.vh;
    g.fillStyle = col(c, -.25, tint);
    g.beginPath(); g.ellipse(sx, sy, rx, ry, 0, 0, PI); g.lineTo(sx - rx, sy - hh); g.ellipse(sx, sy - hh, rx, ry, 0, PI, 0, true); g.closePath(); g.fill();
    g.fillStyle = col(c, .05, tint); g.beginPath(); g.ellipse(sx, sy - hh, rx, ry, 0, 0, 2 * PI); g.fill();
  }
  function emo(V, cx, cz, h, size, ch){ const [sx, sy] = V.p(cx, cz, h); const g = V.ctx; g.font = `${Math.round(size)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, sx, sy); }
  // ── Постройки (b: x0, z0, w, d — клетки карты; l — уровень; k — вид) ──
  const PALS = {
    thW: ['#f3e2c0', '#e5e7eb', '#fde2d2', '#dbeafe', '#fef3c7'], thR: ['#b45309', '#64748b', '#b91c1c', '#1d4ed8', '#ca8a04'],
    hoW: ['#ffe8a8', '#bde0fe', '#ffc8dd', '#caffbf', '#e0c3fc'], hoR: ['#b91c1c', '#1d4ed8', '#be185d', '#15803d', '#7e22ce'],
    st: ['#a0673a', '#94a3b8', '#b45309', '#2563eb', '#ca8a04'], baW: ['#e7c9a0', '#d6d3d1', '#fecaca', '#bfdbfe', '#fde68a'], baR: ['#b91c1c', '#9a3412', '#7f1d1d', '#1e3a8a', '#ca8a04'],
    toP: ['#8b5a2b', '#78716c', '#1e3a8a', '#334155', '#a16207'], toR: ['#b91c1c', '#7c3aed', '#ca8a04', '#0f766e', '#be123c'],
    caB: ['#a8a29e', '#94a3b8', '#78716c', '#475569', '#a16207'], moR: ['#9ca3af', '#a8a29e', '#78716c', '#57534e'],
    waP: ['#8b5a2b', '#a8a29e', '#9a3412', '#334155', '#ca8a04'], waS: ['#c9965f', '#9ca3af', '#c2553d', '#475569', '#fde68a'],
  };
  const TOWER_H = [2.1, 2.4, 2.7, 3, 3.3];
  function paintB(V, b, o = {}){
    const L = Math.max(1, Math.min(5, b.l || 1)), t = o.tint, x = b.x0, z = b.z0, w = b.w, d = b.d, cx = x + w / 2, cz = z + d / 2, i = L - 1;
    const sh = V.ctx;
    if (!b.alive && !b.trap) {   // развалины
      poly(sh, [V.p(x + .1, z + .1), V.p(x + w - .1, z + .1), V.p(x + w - .1, z + d - .1), V.p(x + .1, z + d - .1)], 'rgba(87,70,55,.75)');
      for (let k = 0; k < Math.min(6, w * d); k++) { const fx = x + .2 + ((k * 37 + b.n * 13) % 10) / 10 * (w - .4), fz = z + .2 + ((k * 53 + b.n * 7) % 10) / 10 * (d - .4); box(V, fx, fz, .22, .22, 0, .12 + (k % 3) * .06, k % 2 ? '#78716c' : '#a8a29e'); }
      return;
    }
    if (o.scaffold) { box(V, x + .15, z + .15, w - .3, d - .3, 0, .5, '#d4a373'); emo(V, cx, cz, .9, V.tw * .55, '🔨'); return; }
    switch (b.k) {
      case 'th': box(V, x + .05, z + .05, w - .1, d - .1, 0, .22, '#d6cfc0', t); box(V, x + .35, z + .35, w - .7, d - .7, .22, 1.15 + .1 * i, PALS.thW[i], t); pyramid(V, x + .2, z + .2, w - .4, d - .4, 1.37 + .1 * i, .95, PALS.thR[i], t);
        { const [fx, fy] = V.p(cx, cz, 2.32 + .1 * i), g = V.ctx; g.strokeStyle = '#374151'; g.lineWidth = Math.max(1, V.tw * .04); g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx, fy - V.vh * .6); g.stroke(); g.fillStyle = '#ef4444'; g.fillRect(fx, fy - V.vh * .6, V.tw * .22, V.tw * .14); } break;
      case 'house': box(V, x + .1, z + .1, w - .2, d - .2, 0, .12, '#d6a77a', t); box(V, x + .3, z + .3, w - .6, d - .6, .12, 1.1, PALS.hoW[i], t); gable(V, x + .15, z + .15, w - .3, d - .3, 1.22, .9, PALS.hoR[i], t);
        { const [p1, p2] = [V.p(cx - .35, z + d - .3, .12), V.p(cx + .35, z + d - .3, .95)]; V.ctx.fillStyle = '#5b3a22'; V.ctx.fillRect(p1[0], p2[1], p2[0] - p1[0], p1[1] - p2[1] + (p1[1] - V.p(cx + .35, z + d - .3, .12)[1])); } break;
      case 'mine': cyl(V, cx - .15, cz - .1, .75, 0, .45, '#8b8f99', t); cyl(V, cx + .4, cz - .4, .35, 0, .35, '#7c818b', t); box(V, cx - .25, cz + .25, .5, .35, 0, .45, '#1f2937'); box(V, cx + .3, cz + .45, .4, .3, 0, .22, '#6b7280'); for (let k = 0; k < Math.min(4, L + 1); k++) box(V, cx + .33 + (k % 2) * .16, cz + .5, .14, .2, .22 + Math.floor(k / 2) * .08, .08, '#c2553d'); if (L >= 5) emo(V, cx - .2, cz - .2, .8, V.tw * .35, '✨'); break;
      case 'store': box(V, x + .2, z + .2, w - .4, d - .55, 0, .85, PALS.st[i], t); box(V, x + .1, z + .1, w - .2, d - .35, .85, .1, '#7c2d12', t); box(V, x + w - .7, z + d - .55, .4, .4, 0, .4, '#c8956a'); box(V, x + .25, z + d - .5, .35, .35, 0, .14 * Math.min(5, L + 1), '#c2553d'); break;
      case 'shop': box(V, x + .2, z + .2, w - .4, d - .6, 0, .8, '#e7c9a0', t); gable(V, x + .1, z + .1, w - .2, d - .4, .8, .45, '#9a3412', t); box(V, x + w - .6, z + .3, .25, .25, .8, .6, '#c2553d', t); box(V, cx - .2, z + d - .45, .4, .25, 0, .3, '#44403c'); break;
      case 'barracks': box(V, x + .15, z + .1, w - .3, d - .5, 0, .8, PALS.baW[i], t); gable(V, x + .05, z, w - .1, d - .3, .8, .55, PALS.baR[i], t);
        { const [sx, sy] = V.p(cx, z + d - .4, .45), g = V.ctx, r = V.tw * .16; g.fillStyle = L >= 5 ? '#facc15' : '#e5e7eb'; g.beginPath(); g.arc(sx, sy, r, 0, 2 * PI); g.fill(); g.font = `${Math.round(r * 1.5)}px "Segoe UI Emoji",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('⚔️', sx, sy + 1); } break;
      case 'tower': {
        const H = TOWER_H[i];
        for (const [px, pz] of [[x + .3, z + .3], [x + w - .45, z + .3], [x + .3, z + d - .45], [x + w - .45, z + d - .45]]) box(V, px, pz, .15, .15, 0, H, PALS.toP[i], t);
        box(V, x + .15, z + .15, w - .3, d - .3, H, .14, '#6b4426', t);
        const ang = o.aim != null ? o.aim : 0;
        emo(V, cx, cz, H + .5, V.tw * .42, '🏹');
        pyramid(V, x + .1, z + .1, w - .2, d - .2, H + .9, .55, PALS.toR[i], t);
        void ang; break;
      }
      case 'cannon': {
        cyl(V, cx, cz, .85, 0, .3, PALS.caB[i], t); cyl(V, cx, cz, .62, .3, .1, '#6b4426', t);
        if (!o.noDyn) barrel(V, b, o.aim, o.fire);   // в картинке постройки ствола нет — он поворачивается каждый кадр
        break;
      }
      case 'mortar': cyl(V, cx, cz, .9, 0, .38, PALS.moR[Math.min(3, i)], t); cyl(V, cx, cz, .66, .38, .02, '#44403c'); cyl(V, cx, cz, .32, .38, .45, L >= 4 ? '#ca8a04' : '#1f2937', t); { const [sx, sy] = V.p(cx, cz, .83), g = V.ctx; g.fillStyle = '#0b0f19'; g.beginPath(); g.ellipse(sx, sy, .3 * Math.SQRT2 * V.hw, .3 * Math.SQRT2 * V.hh, 0, 0, 2 * PI); g.fill(); } break;
      case 'wall': {
        const P0 = PALS.waP[i], S0 = PALS.waS[i], h = .45 + .07 * i;
        box(V, x + .28, z + .28, .44, .44, 0, h + .08, P0, t);
        if (o.nx) box(V, x + .5, z + .36, .78, .28, 0, h, S0, t);
        if (o.nz) box(V, x + .36, z + .5, .28, .78, 0, h, S0, t);
        break;
      }
      case 'factory': box(V, x + .2, z + .2, w - .4, d - .4, 0, 1, ['#b45309', '#9a3412', '#7c2d12', '#57534e'][Math.min(3, i)], t); for (let k = 0; k < 3; k++) gable(V, x + .2, z + .2 + k * (d - .4) / 3, w - .4, (d - .4) / 3, 1, .35, '#6b7280', t); cyl(V, x + w - .6, z + .55, .22, 1, 1.3, '#78716c', t); break;
      case 'garage': box(V, x + .15, z + .15, w - .3, d - .3, 0, 1.15, ['#a8a29e', '#94a3b8', '#78716c'][Math.min(2, i)], t); box(V, x + .1, z + .1, w - .2, d - .2, 1.15, .1, '#3f4a22', t); box(V, cx - .7, z + d - .2, 1.4, .05, 0, .9, '#1f2937'); break;
      case 'helipad': box(V, x + .1, z + .1, w - .2, d - .2, 0, .08, '#4b5563', t); { const [sx, sy] = V.p(cx, cz, .09), g = V.ctx; g.strokeStyle = '#facc15'; g.lineWidth = Math.max(1.5, V.tw * .06); g.beginPath(); g.ellipse(sx, sy, 1.1 * Math.SQRT2 * V.hw, 1.1 * Math.SQRT2 * V.hh, 0, 0, 2 * PI); g.stroke(); } emo(V, cx, cz, .3, V.tw * .55, '🚁'); break;
      case 'hangar': box(V, x + .15, z + .15, w - .3, d - .3, 0, .9, L >= 2 ? '#64748b' : '#78716c', t); gable(V, x + .1, z + .1, w - .2, d - .2, .9, .8, L >= 2 ? '#475569' : '#57534e', t); emo(V, cx, cz, 2, V.tw * .5, '✈️'); break;
      case 'dock': box(V, x + .1, z + .1, w - .2, d - .2, 0, .2, '#a0673a', t); for (const [px, pz] of [[x + .2, z + .2], [x + w - .35, z + .2], [x + .2, z + d - .35], [x + w - .35, z + d - .35]]) box(V, px, pz, .15, .15, 0, .45, '#6b4426'); emo(V, cx, cz, .5, V.tw * .45, '⚓'); break;
      case 'bunker': box(V, x + .25, z + .25, w - .5, d - .5, 0, .45, '#a8a29e', t); box(V, x + .2, z + .2, w - .4, d - .4, .45, .06, '#78716c', t); emo(V, cx, cz, .75, V.tw * .45, '🕳️'); break;
      case 'bomb': if (o.showTraps || b.arm >= 0) emo(V, cx, cz, .15, V.tw * .45, '💣'); break;
      case 'airmine': if (o.showTraps) emo(V, cx, cz, .35, V.tw * .45, '🎇'); break;
      default: box(V, x + .2, z + .2, w - .4, d - .4, 0, .5, '#9ca3af', t);
    }
    if (o.busy) emo(V, cx, cz, 2, V.tw * .4, '🔨');
  }
  // ствол пушки (смотрит на цель) и вспышка выстрела
  function barrel(V, b, aim, fire){
    const L = Math.max(1, Math.min(5, b.l || 1)), cx = b.x0 + b.w / 2, cz = b.z0 + b.d / 2, a = aim != null ? aim : PI / 4, len = .95, g = V.ctx;
    const bx = V.ox + (cx - cz) * V.hw, by = V.oy + (cx + cz) * V.hh - .62 * V.vh, ax = cx + Math.cos(a) * len, az = cz + Math.sin(a) * len, ex = V.ox + (ax - az) * V.hw, ey = V.oy + (ax + az) * V.hh - .7 * V.vh;
    g.strokeStyle = L >= 5 ? '#ca8a04' : L >= 3 ? '#1f2937' : '#374151'; g.lineCap = 'round'; g.lineWidth = V.tw * .22; g.beginPath(); g.moveTo(bx, by); g.lineTo(ex, ey); g.stroke();
    g.fillStyle = '#111827'; g.beginPath(); g.arc(ex, ey, V.tw * .08, 0, 2 * PI); g.fill(); g.lineCap = 'butt';
    if (fire) { g.fillStyle = 'rgba(253,224,71,.9)'; g.beginPath(); g.arc(ex, ey, V.tw * .2, 0, 2 * PI); g.fill(); }
  }
  // Картинки построек: постройка одного вида, уровня, размера и состояния выглядит одинаково в любом месте карты (изометрия —
  // только сдвиг) — рисуется один раз в свой холст и дальше ставится картинкой (полная база: ~1500 многоугольников за кадр → ~214
  // картинок). Ключ — число; при смене масштаба, плотности пикселей или облика базы картинки рисуются заново
  const KIDX = new Map(), SB = { n: 0, k: '', l: 1, w: 1, d: 1, x0: 0, z0: 0, x1: 1, z1: 1, alive: true, trap: false, arm: -1 };
  function sprKey(b, po){
    let ki = KIDX.get(b.k); if (ki === undefined) { ki = KIDX.size + 1; KIDX.set(b.k, ki); }
    const dead = !b.alive && !b.trap, tv = b.k === 'bomb' ? (po.showTraps || b.arm >= 0 ? 1 : 0) : b.k === 'airmine' ? (po.showTraps ? 1 : 0) : 0;
    return (((((((ki * 8 + Math.min(7, b.l | 0)) * 8 + Math.min(7, b.w)) * 8 + Math.min(7, b.d)) * 2 + (dead ? 1 : 0)) * 4 + (po.nx ? 1 : 0) + (po.nz ? 2 : 0)) * 4 + (po.scaffold ? 1 : 0) + (po.busy ? 2 : 0)) * 2 + tv) * 16 + (dead ? b.n % 10 : 0);
  }
  function makeSpr(V, b, po){
    const w = b.w, d = b.d, hw = V.hw, hh = V.hh, vh = V.vh, pad = Math.ceil(V.tw * .7) + 2, Hm = 5;   // выше вышки с крышей и значком
    const minX = -d * hw - pad, minY = -Hm * vh - pad, cw = Math.ceil((w + d) * hw + 2 * pad), ch = Math.ceil(Hm * vh + (w + d) * hh + 2 * pad), dpr = V.dpr;
    const cv = V.cv.ownerDocument.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(cw * dpr)); cv.height = Math.max(1, Math.ceil(ch * dpr));
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const VS = { ctx, tw: V.tw, hw, hh, vh, dpr, W: cw, H: ch, ox: -minX, oy: -minY };
    VS.p = (cx, cz, h = 0) => [VS.ox + (cx - cz) * hw, VS.oy + (cx + cz) * hh - h * vh];
    SB.n = b.n; SB.k = b.k; SB.l = b.l; SB.w = w; SB.d = d; SB.x1 = w; SB.z1 = d; SB.alive = b.alive; SB.trap = b.trap; SB.arm = b.arm;
    paintB(VS, SB, { tint: po.tint, nx: po.nx, nz: po.nz, showTraps: po.showTraps, busy: po.busy, scaffold: po.scaffold, noDyn: true });
    return { cv, dx: minX, dy: minY, w: cw, h: ch };
  }
  function drawB(V, b, po){
    const key = sprKey(b, po);
    let sp = V.spr.get(key);
    if (!sp) { sp = makeSpr(V, b, po); V.spr.set(key, sp); }
    const x = Math.round((V.ox + (b.x0 - b.z0) * V.hw + sp.dx) * V.dpr) / V.dpr, y = Math.round((V.oy + (b.x0 + b.z0) * V.hh + sp.dy) * V.dpr) / V.dpr;
    if (x > V.W || y > V.H || x + sp.w < 0 || y + sp.h < 0) return;   // за краем экрана (приближение)
    V.ctx.drawImage(sp.cv, x, y, sp.w, sp.h);
    if (b.k === 'cannon' && b.alive && !po.scaffold) barrel(V, b, po.aim, po.fire);
  }
  function hpBar(V, cx, cz, h, k, w, c){
    const [sx, sy] = V.p(cx, cz, h), g = V.ctx, W2 = Math.max(14, w), H2 = Math.max(3, V.tw * .09);
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(sx - W2 / 2 - 1, sy - 1, W2 + 2, H2 + 2);
    g.fillStyle = c || (k > .5 ? '#4ade80' : k > .25 ? '#facc15' : '#ef4444'); g.fillRect(sx - W2 / 2, sy, W2 * Math.max(0, k), H2);
  }
  // Земля: трава, участок, полоса высадки (зелёная, когда можно высаживать)
  function ground(V, o = {}){
    const g = V.ctx, P = V.p, N = V.n, E = N - 2;
    g.fillStyle = o.night ? '#0b1020' : '#1b2a1f'; g.fillRect(0, 0, V.W, V.H);
    poly(g, [P(0, 0), P(N, 0), P(N, N), P(0, N)], '#4f8a3f');
    poly(g, [P(2, 2), P(E, 2), P(E, E), P(2, E)], o.skinGround || '#a39d6e');
    for (const [a, b, c, d] of V.block || []) poly(g, [P(a, b), P(c, b), P(c, d), P(a, d)], 'rgba(120,113,108,.85)');   // КП зоны и проезд к воротам
    if (o.ring) {
      g.fillStyle = 'rgba(134,239,172,.28)';
      for (const [a, b, c, d] of [[0, 0, N, 2], [0, E, N, N], [0, 2, 2, E], [E, 2, N, E]]) poly(g, [P(a, b), P(c, b), P(c, d), P(a, d)], g.fillStyle);
    }
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
    for (let k = 2; k <= E; k++) { let [a1, b1] = P(k, 2), [a2, b2] = P(k, E); g.beginPath(); g.moveTo(a1, b1); g.lineTo(a2, b2); g.stroke(); [a1, b1] = P(2, k); [a2, b2] = P(E, k); g.beginPath(); g.moveTo(a1, b1); g.lineTo(a2, b2); g.stroke(); }
    if (o.ring) { g.strokeStyle = 'rgba(187,247,208,.85)'; g.lineWidth = 2; g.setLineDash([6, 5]); const p = [P(2, 2), P(E, 2), P(E, E), P(2, E)]; g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath(); g.stroke(); g.setLineDash([]); }
  }
  // Сетка боя по layout (кольцо штаба) и занятые клетки участка — в клетках карты
  function gridOf(layout){
    const RSim = RS(), dd = defs(), G = RSim?.grid ? RSim.grid(dd, layout || []) : { n: 16, S: 12, o: 0, MAP: 16 };
    const sh = 2 - G.o, block = (dd.block || []).map(([x, z, w, d]) => [x + sh, z + sh, x + sh + w, z + sh + d]).filter(([a, b, c, d]) => c > 2 && d > 2 && a < 2 + G.S && b < 2 + G.S)
      .map(([a, b, c, d]) => [Math.max(2, a), Math.max(2, b), Math.min(2 + G.S, c), Math.min(2 + G.S, d)]);
    return { ...G, sh, block };
  }
  // База без боя (штаб): постройки из layout (клетки участка → карта боя: открытая часть по штабу со сдвигом 2)
  function layoutBs(layout){
    const D = defs().k, out = [], G = gridOf(layout);
    for (const it of layout || []) {
      const d = D[it.k]; if (!d || d.g === 'deco') continue;
      const [w, dd] = it.r & 1 ? [d.d, d.w] : [d.w, d.d], x0 = it.x + G.sh, z0 = it.z + G.sh;
      out.push({ n: out.length, id: it.i, k: it.k, x0, z0, w, d: dd, x1: x0 + w, z1: z0 + dd, l: it.l, alive: true, wall: it.k === 'wall', trap: !!d.trap, building: it.l < 1, upg: it.ue != null && it.l >= 1, hp: 1, mhp: 1, arm: -1 });
    }
    return out;
  }
  const PO = { tint: null, nx: false, nz: false, showTraps: false, aim: null, fire: false, busy: false, scaffold: false };   // общие настройки постройки (без мусора за кадр)
  function drawScene(V, bs, us, o = {}){
    // целые стены: набор клеток — только когда их число поменялось (раньше — 160 строк и Set каждый кадр)
    let nW = 0; for (let i = 0; i < bs.length; i++) if (bs[i].wall && bs[i].alive) nW++;
    if (!V.walls || V.wallN !== nW || V.wallBs !== bs) { V.walls = new Set(); for (const b of bs) if (b.wall && b.alive) V.walls.add(b.x0 * 1000 + b.z0); V.wallN = nW; V.wallBs = bs; }
    const walls = V.walls;
    // фон — земля и целые стены — одной картинкой: у большой базы стен до 160, это ~1500 многоугольников в кадр.
    // Перерисовка — когда вид сдвинули / приблизили или упала стена (стены низкие: отряды за ними — поверх, это не мешает)
    const doc = V.cv?.ownerDocument, bgOn = !!doc && V.cv.width > 0;
    if (bgOn) {
      const key = `${V.cv.width}x${V.cv.height}|${V.tw}|${V.ox}|${V.oy}|${walls.size}|${o.ring ? 1 : 0}|${o.tint ? o.tint.k : 0}|${o.night ? 1 : 0}`;
      if (!V.bg || V.bgKey !== key) {
        if (!V.bg) V.bg = doc.createElement('canvas');
        if (V.bg.width !== V.cv.width || V.bg.height !== V.cv.height) { V.bg.width = V.cv.width; V.bg.height = V.cv.height; }
        const main = V.ctx, bctx = V.bg.getContext('2d');
        V.ctx = bctx; bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.clearRect(0, 0, V.bg.width, V.bg.height); bctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
        try {
          ground(V, o);
          const wl = bs.filter(b => b.wall && b.alive).sort((a, c) => (a.x0 + a.z0) - (c.x0 + c.z0));
          for (const b of wl) paintB(V, b, { tint: o.tint, nx: walls.has((b.x0 + 1) * 1000 + b.z0), nz: walls.has(b.x0 * 1000 + b.z0 + 1) });
        } finally { V.ctx = main; }
        V.bgKey = key;
      }
      V.ctx.drawImage(V.bg, 0, 0, V.W, V.H);
      // картинки построек — заново, если поменялись масштаб, плотность пикселей или облик
      if (!V.spr || V.sprTw !== V.tw || V.sprDpr !== V.dpr || V.sprTint !== (o.tint || null)) { V.spr = new Map(); V.sprTw = V.tw; V.sprDpr = V.dpr; V.sprTint = o.tint || null; }
    } else ground(V, o);
    // порядок рисования (дальнее — раньше): записи списка переиспользуются
    const list = V.list || (V.list = []);
    let n = 0;
    const put = (key, b, u) => { let e = list[n]; if (!e) e = list[n] = { key: 0, b: null, u: null }; e.key = key; e.b = b; e.u = u; n++; };
    for (const b of bs) if (!(bgOn && b.wall && b.alive)) put(b.x0 + b.w / 2 + b.z0 + b.d / 2 + (b.alive || b.trap ? 0 : -50), b, null);
    if (us) for (const u of us) put(u.cx + u.cz + .05 + (u.air ? 30 : 0), null, u);
    list.length = n;
    list.sort(byKey);
    if (bgOn && o.bars) for (const b of bs) if (b.wall && b.alive && b.mhp && b.hp < b.mhp) hpBar(V, b.x0 + b.w / 2, b.z0 + b.d / 2, .9, b.hp / b.mhp, V.tw * Math.min(1.4, b.w * .6));
    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (e.b) {
        const b = e.b;
        if (b.trap && !b.alive && !o.showTraps) continue;
        PO.tint = o.tint || null; PO.nx = b.wall && walls.has((b.x0 + 1) * 1000 + b.z0); PO.nz = b.wall && walls.has(b.x0 * 1000 + b.z0 + 1); PO.showTraps = !!o.showTraps;
        PO.aim = o.aims ? o.aims.get(b.n) : null; PO.fire = !!(o.fires && o.fires.get(b.n)); PO.busy = !!(b.upg && o.hub); PO.scaffold = !!b.building;
        if (bgOn) drawB(V, b, PO); else paintB(V, b, PO);
        if (o.bars && b.alive && b.mhp && b.hp < b.mhp && !b.trap) hpBar(V, b.x0 + b.w / 2, b.z0 + b.d / 2, b.wall ? .9 : 1.6, b.hp / b.mhp, V.tw * Math.min(1.4, b.w * .6));
      } else if (o.drawUnit) o.drawUnit(e.u);
    }
  }
  const byKey = (a, c) => a.key - c.key;

  // ═══ Бой: живой (с вводом игрока), повтор, тренировка ═══
  function newBattle(kind, data){
    const RSim = RS(), dd = data.defs || defs();
    const layout = data.layout || RSim.bot(data.lvl, dd, data.variant | 0);
    const cfg = { defs: dd, layout, army: data.army || {}, hero: data.hero | 0, seed: data.seed | 0 };
    const B = RSim.create(cfg);
    const offer = data.offer || null, shares = {};
    if (offer) for (const part of ['st', 'mn']) for (const [id, v] of Object.entries(offer[part] || {})) shares[id] = (shares[id] || 0) + v;
    return {
      kind, data, cfg, B, ins: data.inputs ? [] : [], replayIns: data.inputs || null, phase: kind === 'replay' ? 'fight' : 'scout', t0: 0, scoutEnd: 0, sel: null,
      shares, fx: [], aims: new Map(), fires: new Map(), last: 0, tip: '', goOk: kind !== 'raid', submitted: false, result: null, server: null, speed: 1, paused: false,
      skinB: MB()?.SKINS?.[data.def?.skin || data.defSkin || ''] || null, skinA: data.attSkin || S?.st?.army_skin || '', heroLook: data.heroLook || root.D37Char?.look?.() || {},
      tut: kind === 'tut' || (kind === 'raid' && data.mode === 'tut') ? 1 : 0,
    };
  }
  function lootNow(bt){ let s = 0; for (const b of bt.B.bs) if (!b.alive && b.cnt && bt.shares[b.id]) s += bt.shares[b.id]; return s; }

  // ═══ Экран ═══
  const CSS = `
.rd{position:relative;font-family:Montserrat,system-ui,sans-serif;color:var(--text,#f0f0f8);max-width:1100px;margin:0 auto}
.rd *{box-sizing:border-box}
.rd button{font-family:inherit}
.rd-head{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.6rem}
.rd-head h2{margin:0;font-family:var(--font-display,Oswald,sans-serif);letter-spacing:1px;font-size:1.25rem;flex:1;min-width:140px}
.rd-chip{display:inline-flex;align-items:center;gap:.3rem;padding:.3rem .6rem;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);font-size:.78rem;font-weight:700;white-space:nowrap}
.rd-chip.sh{border-color:rgba(56,189,248,.5);background:rgba(56,189,248,.12)}
.rd-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:.8rem}
.rd-card{background:var(--card,#111119);border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:.8rem}
.rd-card h3{margin:0 0 .5rem;font-size:.95rem}
.rd-base{position:relative;height:300px;border-radius:12px;overflow:hidden;background:#1b2a1f}
.rd-base canvas,.rd-field canvas{display:block;width:100%;height:100%;touch-action:none}
.rd-sub{font-size:.76rem;color:var(--muted,#8d8daa);margin-top:.4rem;line-height:1.45}
.rd-army{display:flex;flex-wrap:wrap;gap:.35rem;margin:.3rem 0}
.rd-army span{display:inline-flex;align-items:center;gap:.2rem;padding:.25rem .45rem;border-radius:10px;background:rgba(255,255,255,.06);font-weight:800;font-size:.8rem}
.rd-cap{height:8px;border-radius:6px;background:rgba(255,255,255,.08);overflow:hidden;margin:.35rem 0}
.rd-cap i{display:block;height:100%;background:linear-gradient(90deg,#22c55e,#4ade80)}
.rd-go{width:100%;min-height:56px;border:0;border-radius:14px;background:linear-gradient(135deg,#ef4444,#f97316);color:#fff;font-weight:900;font-size:1.15rem;letter-spacing:.5px;cursor:pointer;box-shadow:0 10px 30px -12px rgba(239,68,68,.8)}
.rd-go:disabled{filter:grayscale(.7);opacity:.6;cursor:default}
.rd-btns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.45rem;margin-top:.55rem}
.rd-b{min-height:44px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:var(--text,#f0f0f8);border-radius:12px;padding:.45rem .5rem;font-weight:800;font-size:.8rem;cursor:pointer;position:relative}
.rd-b:hover{border-color:var(--accent,#ff2d55)}
.rd-b.on{border-color:#4ade80;background:rgba(74,222,128,.12)}
.rd-b.pri{background:linear-gradient(135deg,#22c55e,#16a34a);border:0;color:#fff}
.rd-b:disabled{opacity:.45;cursor:default}
.rd-dot{position:absolute;top:4px;right:6px;width:9px;height:9px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 2px var(--card,#111119)}
.rd-day{display:flex;flex-wrap:wrap;gap:.35rem .8rem;font-size:.74rem;color:var(--muted,#8d8daa);margin-top:.6rem}
.rd-note{padding:.6rem .7rem;border-radius:12px;background:rgba(250,204,21,.1);border:1px solid rgba(250,204,21,.3);font-size:.8rem;margin:.5rem 0}
.rd-back{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:inherit;border-radius:10px;padding:.4rem .7rem;font-weight:800;cursor:pointer;min-height:40px}
.rd-list{display:grid;gap:.45rem}
.rd-row{display:flex;align-items:center;gap:.6rem;padding:.55rem .65rem;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07)}
.rd-row .t{flex:1;min-width:0;font-size:.82rem;line-height:1.35}
.rd-row .t small{display:block;color:var(--muted,#8d8daa);font-size:.72rem}
.rd-row .e{font-size:1.5rem;flex:none;width:2.1rem;text-align:center}
.rd-row .acts{display:flex;gap:.3rem;flex-wrap:wrap;justify-content:flex-end}
.rd-row .acts .rd-b{min-height:38px;padding:.35rem .55rem}
.rd-units{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:.5rem}
.rd-unit{padding:.6rem;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);display:grid;gap:.25rem}
.rd-unit.lock{opacity:.5}
.rd-unit b{font-size:.9rem}
.rd-unit .s{font-size:.7rem;color:var(--muted,#8d8daa);line-height:1.35}
.rd-unit .r{display:flex;gap:.3rem}
.rd-unit .r .rd-b{flex:1;min-height:40px}
.rd-q{display:flex;flex-wrap:wrap;gap:.3rem;margin:.4rem 0}
.rd-q span{padding:.2rem .45rem;border-radius:8px;background:rgba(255,255,255,.06);font-size:.78rem}
.rd-stars{color:#facc15;letter-spacing:1px}
.rd-field{position:relative;height:min(78vh,720px);min-height:min(420px,calc(100vh - 40px));border-radius:14px;overflow:hidden;background:#1b2a1f;user-select:none;-webkit-user-select:none}
.rd-top{position:absolute;left:0;right:0;top:0;display:flex;align-items:flex-start;gap:.4rem;padding:.45rem .5rem;pointer-events:none}
.rd-top>*{pointer-events:auto}
.rd-pill{background:rgba(10,10,20,.72);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:.35rem .55rem;font-size:.76rem;font-weight:800;line-height:1.3;backdrop-filter:blur(4px)}
.rd-pill.big{font-size:1.05rem;text-align:center;min-width:76px}
.rd-pill .rd-stars{font-size:1.1rem}
.rd-sp{flex:1}
.rd-barB{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:flex-end;gap:.35rem;padding:.45rem;padding-right:min(42%,340px);background:linear-gradient(0deg,rgba(6,6,14,.85),rgba(6,6,14,0));overflow-x:auto;scrollbar-width:none}
.rd-barB::-webkit-scrollbar{display:none}
.rd-u{flex:none;position:relative;width:58px;height:62px;border-radius:12px;border:2px solid rgba(255,255,255,.18);background:rgba(20,20,34,.85);color:#fff;font-size:1.55rem;display:grid;place-items:center;cursor:pointer;padding:0}
.rd-u i{position:absolute;right:3px;bottom:2px;font-style:normal;font-size:.72rem;font-weight:900;background:rgba(0,0,0,.6);border-radius:6px;padding:0 .25rem}
.rd-u.on{border-color:#4ade80;box-shadow:0 0 0 3px rgba(74,222,128,.35)}
.rd-u:disabled{opacity:.35}
.rd-u.ab{background:linear-gradient(135deg,#7c3aed,#db2777)}
.rd-act{position:absolute;right:.45rem;bottom:.45rem;display:flex;gap:.35rem;z-index:2}
.rd-act .rd-b{min-height:48px;background:rgba(20,20,34,.85)}
.rd-tip{position:absolute;left:50%;top:58px;transform:translateX(-50%);max-width:min(92%,520px);background:rgba(17,24,39,.92);border:1px solid rgba(250,204,21,.5);color:#fef3c7;border-radius:12px;padding:.5rem .75rem;font-size:.82rem;font-weight:700;text-align:center;pointer-events:none}
.rd-tip[hidden]{display:none}
.rd-res{position:absolute;inset:0;z-index:3;display:grid;place-items:center;background:rgba(5,5,12,.6);padding:1rem}
.rd-res .box{width:min(420px,100%);background:var(--card,#111119);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:1rem;text-align:center;box-shadow:0 30px 80px -20px rgba(0,0,0,.8)}
.rd-res .big{font-size:2.4rem;color:#facc15;letter-spacing:4px}
.rd-res .ln{font-size:.9rem;margin:.35rem 0}
.rd-res .srv{font-size:.74rem;color:var(--muted,#8d8daa);margin:.4rem 0}
.rd-league{display:flex;gap:.35rem;flex-wrap:wrap}
.rd-league span{flex:1;min-width:84px;text-align:center;padding:.4rem;border-radius:10px;background:rgba(255,255,255,.04);font-size:.74rem;border:1px solid rgba(255,255,255,.07)}
.rd-league span.on{border-color:#facc15;background:rgba(250,204,21,.12)}
.rd-help p,.rd-help li{font-size:.84rem;line-height:1.5}
@media (max-width:760px){.rd-grid{grid-template-columns:1fr}.rd-base{height:250px}}
@media (max-width:640px){.rd-field{height:calc(62vw + 230px);min-height:380px;max-height:calc(100vh - 70px)}.rd-barB{padding-right:.45rem}.rd-act{bottom:82px}.rd-act .rd-b{min-height:40px;padding:.3rem .55rem;font-size:.74rem}.rd-field.rp .rd-act{bottom:.45rem}}
@media (max-width:420px){.rd-btns{grid-template-columns:repeat(2,minmax(0,1fr))}.rd-u{width:52px;height:56px;font-size:1.35rem}.rd-head h2{font-size:1.08rem}}
`;
  function css(){ if (document.getElementById('rdCss')) return; const s = document.createElement('style'); s.id = 'rdCss'; s.textContent = CSS; document.head.appendChild(s); }

  // ═══ Загрузка данных ═══
  async function loadAll(){
    const st = S;
    st.loading = true;
    if (!authed() || !sb()) { st.base = null; st.st = null; st.mode = 'guest'; st.loading = false; return; }
    const [b, r] = await Promise.all([rpc('war_state'), rpc('raid_state', { p_dev: dev() })]);
    if (S !== st) return;
    st.base = b?.ok ? b : null;
    st.mode = !b?.ok ? (b?.reason === 'none' ? (b.age === false ? 'age' : 'nobase') : b?.reason === 'nosql' ? 'nosql' : b?.reason === 'auth' ? 'guest' : 'net')
      : r?.reason === 'nosql' ? 'noraids' : r?.ok ? 'ok' : r?.reason === 'none' ? 'nobase' : 'net';
    st.st = r?.ok ? r : null;
    if (b?.ok) st.off = (b.now || r?.now || Date.now() / 1000) - Date.now() / 1000;
    st.loading = false;
  }
  const army = () => S?.base?.army || {};
  const armyN = a => Object.values(a || {}).reduce((s, n) => s + n, 0);
  const barracksLv = () => (S?.base ? MB().WRules.barracksLv(S.base) : 0);
  const canEdit = () => S?.base?.rank === 'leader' || S?.base?.rank === 'officer';   // строить и тренировать — главарь и офицеры
  const baseTitle = b => (b ? MB().baseName(b.name_k, b.name_n) : '');

  // ═══ Монтирование ═══
  function mount(el, api){
    css();
    S = { el, api, param: api?.param || null, screen: 'hub', off: 0, timers: [], views: [], st: null, base: null, mode: 'load', loading: true };
    el.innerHTML = '<div class="rd"><div class="gm-loading"><div class="spinner"></div>Загружаем набеги…</div></div>';
    S.root = el;   // каждый экран сам начинается с <div class="rd">
    S.onAuth = () => { if (S && S.screen !== 'battle') { if (S.screen === 'join') start(); else refresh(); } };
    root.addEventListener('d37:auth', S.onAuth);
    S.onHide = () => { if (document.visibilityState === 'hidden') flushBeacon(); };
    document.addEventListener('visibilitychange', S.onHide);
    root.addEventListener('pagehide', flushBeacon);
    S.tick = setInterval(() => { if (S && S.screen === 'hub') paintTimers(); if (S && S.screen === 'train') renderTrain(true); }, 1000);
    loadSprites();
    start();
  }
  async function start(){
    const st = S;
    await loadAll();
    if (S !== st) return;
    if (await resume()) return;
    const p = String(st.param || '');
    if (p === 'log') return showLog();
    if (p === 'camp') return showCamp();
    if (p === 'top') return showTop();
    if (p === 'train') return showTrain();
    if (p === 'shop') return showShop();
    if (p.startsWith('replay/')) return openReplay(p.slice(7));
    if (p.startsWith('friendly/')) return friendly(+p.slice(9));
    if (p.startsWith('join/')) return showJoin(p.slice(5));
    if (!lsGet(LS_SEEN)) { lsSet(LS_SEEN, 1); return showHelp(true); }
    showHub();
  }
  async function refresh(){ await loadAll(); if (S && S.screen === 'hub') showHub(); else if (S?.screen === 'train') renderTrain(); }
  function unmount(){
    if (!S) return;
    const st = S;
    if (st.bt && st.bt.kind === 'raid' && st.bt.phase === 'fight' && !st.bt.submitted) { surrender(st.bt, true); }
    clearInterval(st.tick); cancelAnimationFrame(st.raf); st.timers.forEach(clearTimeout);
    root.removeEventListener('d37:auth', st.onAuth);
    document.removeEventListener('visibilitychange', st.onHide);
    root.removeEventListener('pagehide', flushBeacon);
    st.ro?.disconnect?.();
    S = null;
    try { root.dispatchEvent(new CustomEvent('d37:base')); } catch (e) {}   // мир перечитает свою базу (армия, добыча)
  }
  const $ = s => S?.root?.querySelector(s);
  function setHTML(html){ cancelAnimationFrame(S.raf); S.ro?.disconnect?.(); S.ro = null; S.views = []; S.prevBt?.off?.(); S.prevBt = S.bt; S.root.innerHTML = html; }

  // ═══ Штаб ═══
  function showHub(){
    if (!S) return;
    S.screen = 'hub'; S.bt = null;
    const st = S.st, b = S.base, mode = S.mode, MBx = MB();
    const L = st ? MBx.LEAGUES[st.league] : MBx.LEAGUES[0];
    const sh = st && st.shield > sNow() ? st.shield - sNow() : 0;
    const ok = mode === 'ok', a = army(), n = armyN(a), cap = b ? MBx.WRules.armyCap(b) : 0, used = b ? MBx.WRules.armySpace(b) : 0;
    const can = ok && !!st?.can && !st?.busy, R0 = b ? MBx.RANKS[b.rank] : null;
    const head = `<div class="rd-head"><h2>⚔️ Набеги</h2>${b ? `<span class="rd-chip" style="border-color:${MBx.COLORS[b.color] || '#ef4444'}">🏯 ${esc(baseTitle(b))}${R0 ? ' · ' + R0.e : ''}</span>` : ''}${st ? `<span class="rd-chip">${L[1]} ${L[0]} · 🏆 ${num(st.trophies)}</span>` : ''}${sh ? `<span class="rd-chip sh" title="Пока щит — на базу не нападут">🛡️ <span data-cd="${st.shield}">${fmtT(sh)}</span></span>` : ''}${b ? `<span class="rd-chip" title="Казна базы">🧱 ${num(b.bricks)}</span>` : ''}</div>`;
    let left, right;
    if (mode === 'guest' || mode === 'nobase' || mode === 'age' || mode === 'net' || mode === 'nosql') {
      const t = mode === 'guest' ? '<b>Войди на сайт</b> — вступай в военную базу Боевой зоны или основывай свою, защищайте её вместе и ходите в набеги на другие базы: кубки, лиги, добыча в казну. А пока — учебный набег: армия выдаётся бесплатно.'
        : mode === 'nobase' ? 'Набеги идут между <b>военными базами</b> Боевой зоны «Мира Денчика» (12+). Основай свою базу у таблички свободного участка — или вступи в базу друга по ссылке-приглашению. Потом казарма, пушки и вышки — и в бой!'
        : mode === 'age' ? esc(WHY.age)
        : mode === 'nosql' ? 'Военные базы и набеги откроются, когда сайт обновится. Пока можно сыграть учебный набег.' : 'Нет связи с сервером. Можно сыграть учебный набег.';
      left = `<div class="rd-card"><h3>Как это устроено</h3><p class="rd-sub" style="font-size:.85rem">${t}</p>
        <div class="rd-btns" style="grid-template-columns:1fr 1fr">${mode === 'guest' ? '<button type="button" class="rd-b pri" data-a="login">🔑 Войти</button>' : mode === 'nobase' ? '<button type="button" class="rd-b pri" data-a="claim">🏯 К военным базам</button>' : ''}<button type="button" class="rd-b" data-a="tut">🎓 Учебный набег</button><button type="button" class="rd-b" data-a="help">❓ Как играть</button>${root.MirPlay?.isOpen?.() ? '' : '<button type="button" class="rd-b" data-a="world">🌍 В мир</button>'}</div></div>`;
      right = '';
    } else {
      const q = b?.queue || [], qEnd = q.length ? q[q.length - 1].ue : 0;
      left = `<div class="rd-card"><div class="rd-base"><canvas class="rdHubCv"></canvas></div>
        <div class="rd-sub">🏯 Штаб ${MBx.WRules.th(b)} ур. · 👥 ${(b.members || []).length}${b.skin && MBx.SKINS[b.skin] ? ` · ${MBx.SKINS[b.skin].e} ${MBx.SKINS[b.skin].n}` : ''} · нажми постройку — что она умеет</div>
        <div class="rd-btns" style="grid-template-columns:1fr 1fr">${canEdit() ? '<button type="button" class="rd-b" data-a="build">🔨 Строить оборону</button>' : '<button type="button" class="rd-b" data-a="world">🌍 К базе</button>'}<button type="button" class="rd-b" data-a="log">🛡️ Защита${st?.log?.some(x => x.t > (lsGet('d37_raid_logseen') || 0)) ? '<span class="rd-dot"></span>' : ''}</button>
          <button type="button" class="rd-b" data-a="invite" style="grid-column:1/-1" title="Дружеский бой: без добычи и кубков">🤝 Позвать друга штурмовать нашу базу</button></div></div>`;
      const bl = barracksLv();
      right = `<div class="rd-card"><h3>🪖 Армия базы ${used}/${cap || '—'}</h3>
        ${bl ? `<div class="rd-cap"><i style="width:${cap ? Math.round(used * 100 / cap) : 0}%"></i></div><div class="rd-army">${Object.entries(a).filter(([, v]) => v > 0).map(([u, v]) => `<span>${MBx.UNITS[u]?.e || '?'} ×${v}</span>`).join('') || '<span>пусто</span>'}<span>🦸 герой ${MBx.WRules.th(b)} ур.</span></div>
          ${q.length ? `<div class="rd-sub">⏳ Тренируется ${q.length} — готово через <span data-cd="${qEnd}">${fmtT(qEnd - sNow())}</span></div>` : ''}`
          : canEdit() ? `<div class="rd-note">Нет казармы. Построй её — она тренирует армию базы.</div><button type="button" class="rd-b pri" data-a="mkbarracks" style="width:100%">⚔️ Построить казарму (🧱 ${num(MBx.WDEFS.barracks.cost[0])})</button>` : '<div class="rd-note">В базе ещё нет казармы — её строят главарь и офицеры.</div>'}
        <div class="rd-btns" style="grid-template-columns:1fr"><button type="button" class="rd-b" data-a="train">⚔️ Казарма: тренировать</button></div>
        <div style="margin-top:.7rem"><button type="button" class="rd-go" data-a="find" ${can ? '' : 'disabled'}>⚔️ В БОЙ!</button></div>
        ${!ok ? `<div class="rd-note">${mode === 'noraids' ? '📝 Бои с базами откроются, когда сайт обновится. Пока — учебный и дружеский бой.' : 'Нет связи с сервером набегов.'}</div>`
          : st?.busy ? `<div class="rd-note">⚔️ Армию базы сейчас ведёт ${esc(st.busy.nick)} — бой идёт.</div>` : !st?.can ? `<div class="rd-note">${esc(WHY.rank)}</div>` : ''}
        <div class="rd-btns"><button type="button" class="rd-b" data-a="camp">🏴‍☠️ Поход${st ? ` ${Object.values(st.camp || {}).reduce((s, v) => s + v, 0)}★` : ''}</button><button type="button" class="rd-b" data-a="top">🏆 Лиги</button><button type="button" class="rd-b" data-a="shop">💎 Улучшения</button>
          <button type="button" class="rd-b" data-a="tut">🎓 Учебный</button><button type="button" class="rd-b" data-a="help">❓ Как играть</button>${st?.week?.chest ? '<button type="button" class="rd-b pri" data-a="chest">🎁 Сундук недели</button>' : `<button type="button" class="rd-b" data-a="attacks">📜 Мои набеги</button>`}</div>
        ${st ? `<div class="rd-day"><span>Боёв сегодня: ${st.day.battles}/${R().day.battles}</span><span>Добыча: 🧱 ${num(st.day.loot)}/${num(st.day.lootCap)}</span><span>Неделя: ★ ${st.week.stars} · побед ${st.week.wins}/${R().chestWins}</span>${st.newbie > sNow() ? `<span>🐣 Новичок: защита ещё ${fmtT(st.newbie - sNow())}</span>` : ''}</div>` : ''}</div>`;
    }
    setHTML(`<div class="rd">${head}<div class="rd-grid">${left}${right}</div></div>`);
    S.root.firstChild.addEventListener('click', onHubClick);
    if (b && mode !== 'guest') hubBase();
    retryPending();
  }
  function paintTimers(){
    S?.root?.querySelectorAll('[data-cd]').forEach(e => { const left = +e.dataset.cd - sNow(); e.textContent = left > 0 ? fmtT(left) : 'готово'; if (left <= 0 && !e.dataset.done) { e.dataset.done = 1; S.timers.push(setTimeout(() => refresh(), 800)); } });
  }
  // своя база в 2.5D (ловушки видны — свои), нажал постройку — подсказка
  function hubBase(){
    const cv = $('.rdHubCv'); if (!cv) return;
    const G = gridOf(S.base.layout), V = makeView(cv, { full: true, n: G.MAP });
    V.block = G.block;
    const bs = layoutBs(S.base.layout), tint = MB().SKINS[S.base.skin] || null;
    const draw = () => { if (!S || S.screen !== 'hub') return; V.ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0); drawScene(V, bs, [], { tint, showTraps: true, hub: true }); };
    S.ro = new ResizeObserver(() => { V.resize(); draw(); }); S.ro.observe(cv);
    draw();
    cv.onclick = e => {
      const r = cv.getBoundingClientRect(), [cx, cz] = V.un(e.clientX - r.left, e.clientY - r.top);
      const b = bs.find(x => cx >= x.x0 && cx < x.x1 && cz >= x.z0 && cz < x.z1); if (!b) return;
      const D = MB().WDEFS[b.k], L = Math.max(1, b.l);
      const parts = [`${D.e} ${D.n}${D.lv > 1 ? ` · ${b.l} ур.` : ''}`];
      if (D.hp) parts.push(`❤️ ${num(D.hp[L - 1])}`);
      if (D.atk) parts.push(`⚔️ ${D.atk.dmg[L - 1]} за выстрел, дальность ${String(D.atk.rng).replace('.', ',')}`);
      if (D.trap) parts.push(`💥 ${D.trap.dmg[L - 1]} — ловушка, чужим не видна`);
      if (b.building) parts.push('строится');
      toast(parts.join(' · '));
    };
  }
  async function onHubClick(e){
    const btn = e.target.closest('[data-a]'); if (!btn || !S) return;
    const a = btn.dataset.a;
    if (a === 'login') { if (typeof openGlobalAuth === 'function') openGlobalAuth(); }
    else if (a === 'help') showHelp();
    else if (a === 'tut') startTut();
    else if (a === 'world') goWar();
    else if (a === 'claim') goWar();
    else if (a === 'mkbarracks') mkBarracks(btn);
    else if (a === 'train') showTrain();
    else if (a === 'find') findBattle(btn);
    else if (a === 'log') showLog();
    else if (a === 'attacks') showLog('out');
    else if (a === 'camp') showCamp();
    else if (a === 'top') showTop();
    else if (a === 'shop') showShop();
    else if (a === 'chest') { btn.disabled = true; const r = await rpc('raid_chest'); toast(r?.ok ? `🎁 Сундук недели: +${num(r.got)} 🧱` : why(r)); await refresh(); }
    else if (a === 'build') goBuild();
    else if (a === 'invite' && S.base) share('friendly/' + S.base.id, `Возьмёшь нашу военную базу «${baseTitle(S.base)}»? 🏯 Штаб ${MB().WRules.th(S.base)} ур. — дружеский бой в «Набегах» на сайте Денчика37, без потерь.`);
  }
  // строить — в мире: своя база, режим стройки (вкладка «Оборона»)
  function goBuild(){
    try { sessionStorage.setItem('d37_mb_go', 'build'); } catch (e) {}
    if (S?.api?.inWorld && S.api.exit) { S.api.exit(); setTimeout(() => root.dispatchEvent(new CustomEvent('d37:mb', { detail: 'build' })), 80); }
    else location.hash = '#/games/world';
  }
  // к военным базам Боевой зоны (своя база — к ней; нет — к свободному участку и меню «основать»)
  function goWar(){
    try { sessionStorage.setItem('d37_mb_go', 'wb'); } catch (e) {}
    if (S?.api?.inWorld && S.api.exit) { S.api.exit(); setTimeout(() => root.dispatchEvent(new CustomEvent('d37:mb', { detail: 'wb' })), 80); }
    else location.hash = '#/games/world';
  }
  // казарма — сама находит место рядом со штабом (в открытой части базы)
  async function mkBarracks(btn){
    const b = S.base, RU = MB().WRules, D = MB().WDEFS.barracks;
    if (b.bricks < D.cost[0]) { toast(WHY.bricks); return; }
    const th = b.layout.find(it => it.k === 'th'), tx = th ? th.x + 1 : 15, tz = th ? th.z + 1 : 15, spots = [], [lo, hi] = RU.boxOf(b);
    for (let z = lo; z <= hi - D.d; z++) for (let x = lo; x <= hi - D.w; x++) if (RU.fits(b.layout, x, z, D.w, D.d, 0)) spots.push([Math.abs(x - tx) + Math.abs(z - tz), x, z]);
    if (!spots.length) { toast('Нет места 2×2 — освободите на базе (в мире)'); return; }
    spots.sort((p, q) => p[0] - q[0]);
    btn.disabled = true;
    const r = await rpc('war_act', { p_act: 'place', p_a: { k: 'barracks', x: spots[0][1], z: spots[0][2], r: 0 } });
    toast(r?.ok ? `⚔️ Казарма строится — ${fmtT(D.time[0])}` : why(r));
    try { root.dispatchEvent(new CustomEvent('d37:base')); } catch (e) {}
    await refresh();
  }

  // ═══ Казарма ═══
  function showTrain(){ if (!S) return; S.screen = 'train'; renderTrain(); }
  function renderTrain(quiet){
    if (!S || S.screen !== 'train') return;
    const b = S.base, MBx = MB(), U = MBx.UNITS, ok = S.mode === 'ok' || S.mode === 'noraids';
    if (quiet) { paintTimers(); return; }
    if (!b || !ok) { setHTML(`<div class="rd"><div class="rd-head"><button type="button" class="rd-back" data-a="hub">← Штаб</button><h2>⚔️ Казарма</h2></div><div class="rd-note">${S.mode === 'guest' ? 'Войди на сайт — армия тренируется на сервере.' : S.mode === 'nosql' ? 'Казарма откроется, когда сайт обновится.' : 'Сначала вступи в военную базу (или основай свою) и постройте казарму.'}</div></div>`); S.root.firstChild.onclick = e => { if (e.target.closest('[data-a="hub"]')) showHub(); }; return; }
    const bl = MBx.WRules.barracksLv(b), cap = MBx.WRules.armyCap(b), used = MBx.WRules.armySpace(b), q = b.queue || [], edit = canEdit();
    const qEnd = q.length ? q[q.length - 1].ue : 0, coinCost = q.length ? Math.max(1, Math.ceil((qEnd - sNow()) / 120)) : 0, gemCost = q.length ? Math.max(1, Math.ceil((qEnd - sNow()) / R().shop.fin)) : 0;
    const qGroups = []; for (const it of q) { const g = qGroups[qGroups.length - 1]; if (g && g.u === it.u) g.n++; else qGroups.push({ u: it.u, n: 1 }); }
    const cards = Object.entries(U).map(([k, u]) => {
      const lock = u.lv > bl, have = b.army?.[k] || 0;
      const stat = u.tgt === 'heal' ? `лечит ${u.heal}/с вокруг` : `урон ${u.wdmg ? u.wdmg + ' стенам' : u.dmg}${u.cd !== 1 && !u.wdmg ? ` за ${String(u.cd).replace('.', ',')} с` : ''}${u.rng >= 2 ? ` · дальность ${u.rng}` : ''}`;
      return `<div class="rd-unit${lock ? ' lock' : ''}"><b>${u.e} ${esc(u.n)}${have ? ` <span class="rd-chip">×${have}</span>` : ''}</b><div class="s">${esc(u.info || '')}<br>❤️ ${u.hp} · ${stat}${u.air ? ' · летает' : ''}<br>место ${u.sp} · 🧱 ${u.cost} · ⏱ ${fmtT(MBx.WRules.trainT(b, u))}</div>
        ${lock ? `<div class="s">🔒 казарма ${u.lv} ур.</div>` : !edit ? '' : `<div class="r"><button type="button" class="rd-b" data-t="${k}:1">+1</button><button type="button" class="rd-b" data-t="${k}:5">+5</button>${qGroups.some(g => g.u === k) ? `<button type="button" class="rd-b" data-un="${k}" title="Убрать из очереди (кирпичи назад)">−</button>` : ''}</div>`}</div>`;
    }).join('');
    setHTML(`<div class="rd"><div class="rd-head"><button type="button" class="rd-back" data-a="hub">← Штаб</button><h2>⚔️ Казарма базы ${bl ? bl + ' ур.' : ''}</h2><span class="rd-chip" title="Казна базы">🧱 ${num(b.bricks)}</span><span class="rd-chip">🪖 ${used}/${cap}</span>${MBx.WRules.barracksN(b) >= 2 ? '<span class="rd-chip" title="Две готовые казармы — отряды учатся вдвое быстрее">⚡ две казармы</span>' : ''}</div>
      ${!bl ? `<div class="rd-note">Нет готовой казармы. ${b.layout.some(it => it.k === 'barracks') ? 'Она ещё строится.' : 'Её строят главарь и офицеры (в штабе или в мире).'}</div>` : !edit ? '<div class="rd-note">Тренируют армию главарь и офицеры. Ускорить очередь может любой из базы.</div>' : ''}
      <div class="rd-cap"><i style="width:${cap ? Math.round(used * 100 / cap) : 0}%"></i></div>
      ${q.length ? `<div class="rd-card" style="margin-bottom:.6rem"><b>⏳ Очередь</b> — всё готово через <span data-cd="${qEnd}">${fmtT(qEnd - sNow())}</span><div class="rd-q">${qGroups.map(g => `<span>${U[g.u].e} ×${g.n}</span>`).join('')}</div>
        <div class="rd-btns" style="grid-template-columns:1fr 1fr"><button type="button" class="rd-b" data-a="tfin">⚡ Сразу за ${coinCost} 🪙</button>${root.D37Gems?.isOn?.() ? `<button type="button" class="rd-b" data-a="tfing">💎 Сразу за ${gemCost}</button>` : ''}</div></div>` : ''}
      <div class="rd-units">${cards}</div>
      <div class="rd-sub">Отряды тренируются по очереди, даже когда никого нет. Казарма выше — больше места и новые отряды; вторая казарма (со штаба 3) — учатся вдвое быстрее. Высаженные в бою тратятся, остальные вернутся.</div></div>`);
    S.root.firstChild.addEventListener('click', onTrainClick);
  }
  async function onTrainClick(e){
    const el = e.target.closest('[data-t],[data-un],[data-a]'); if (!el || !S) return;
    if (el.dataset.a === 'hub') return showHub();
    let act, args;
    if (el.dataset.t) { const [u, n] = el.dataset.t.split(':'); act = 'train'; args = { u, n: +n }; }
    else if (el.dataset.un) { act = 'untrain'; args = { u: el.dataset.un }; }
    else if (el.dataset.a === 'tfin') { act = 'tfinish'; args = {}; }
    else if (el.dataset.a === 'tfing') { if (!(await ask({ icon: '💎', title: 'Дотренировать сразу?', text: 'Кристаллы тратятся только на время — армия будет такой же.', yes: '💎 Да' }))) return; const r = await rpc('raid_buy', { p_item: 'tfin' }); toast(r?.ok ? `⚡ Армия готова (−${r.gems} 💎)` : why(r)); root.D37Gems?.sync?.(); await refresh(); return; }
    if (!act) return;
    // сразу проверяем по тем же правилам (Rules.act), сервер подтверждает
    if (act !== 'tfinish' && !canEdit()) { toast(WHY.rank); return; }
    const pre = MB().WRules.act(MB().WRules.clone(S.base), act, args, Math.floor(sNow()), act === 'tfinish' ? { coins: root.D37Coins?.coins?.() ?? 0 } : undefined);
    if (!pre.ok) { toast(WHY[pre.reason] || why(pre)); try { gameSfx('bad'); } catch (er) {} return; }
    el.disabled = true;
    const r = await rpc('war_act', { p_act: act, p_a: args });
    if (r?.ok) { S.base = r; if (act === 'tfinish') root.D37Coins?.sync?.(); try { gameSfx('ok'); } catch (er) {} }
    else toast(why(r));
    renderTrain();
  }
  function ask(o){ return root.GameKit?.ask ? root.GameKit.ask(o) : Promise.resolve(confirm(o.title + '\n' + (o.text || ''))); }

  // ═══ Бой ═══
  async function findBattle(btn, mode = 'find', ref = null){
    if (S.mode !== 'ok') { toast(S.mode === 'nobase' ? WHY.none : S.mode === 'age' ? WHY.age : WHY.nosql); return; }
    if (mode !== 'tut' && !S.st?.can) { toast(WHY.rank); return; }
    if (mode !== 'tut' && S.st?.busy) { toast(WHY.army_out); return; }
    if (!armyN(army()) && mode !== 'tut') { toast(WHY.army); showTrain(); return; }
    btn && (btn.disabled = true);
    const r = await rpc('raid_start', { p_mode: mode, p_ref: ref, p_dev: dev() });
    btn && (btn.disabled = false);
    if (!S) return;
    if (r?.ok) return enterBattle('raid', r);
    if (r?.reason === 'nobody') {
      if (await ask({ icon: '🏴‍☠️', title: 'Соперников сейчас нет', text: 'Все в щитах или уже под набегом. Нападём на разбойников? Добыча — 3 раза в день, без кубков.', yes: '🏴‍☠️ На разбойников', no: 'Потом' })) return findBattle(null, 'bot');
      return;
    }
    if (r?.reason === 'active') { await rpc('raid_cancel', { p_id: r.id }); toast('Прошлый набег отменён — нажми ещё раз'); return refresh(); }
    toast(why(r));
  }
  function startTut(){
    const RSim = RS(), dd = defs();
    if (S.mode === 'ok' && !S.st?.tut) return findBattle(null, 'tut');
    enterBattle('tut', { lvl: 0, variant: 0, army: { ...dd.raid.tutArmy }, hero: Math.max(1, S.base ? MB().WRules.th(S.base) : 1), seed: 7 + (Date.now() % 1000), defs: dd, local: true, def: { nick: 'Учебный лагерь' } });
    void RSim;
  }
  // дружеский бой по базе id (из мира — снимок в sessionStorage; по ссылке — war_sector, без ловушек): без добычи и кубков, армия не тратится
  async function friendly(id){
    let info = null;
    try { const f = JSON.parse(sessionStorage.getItem('d37_raid_friendly') || 'null'); if (f && f.base === id) info = f; } catch (e) {}
    if (!info && id > 0) { const r = await rpc('war_sector', { p_sector: Math.floor((id - 1) / 12) }); const p = r?.bases?.find(x => x.id === id); if (p) info = { base: id, name: MB().baseName(p.name_k, p.name_n), layout: p.layout, skin: p.skin }; }
    if (!S) return;
    if (!info) { toast('База не найдена'); return showHub(); }
    const a = armyN(army()) ? { ...army() } : { ...defs().raid.tutArmy };
    const lay = MB().WRules.sanitize({ layout: info.layout, plot: id })?.layout || [];
    enterBattle('friendly', { layout: lay.filter(it => !defs().k[it.k]?.trap), army: a, hero: S.base ? MB().WRules.th(S.base) : 1, seed: id * 31 + 7, defs: defs(), local: true, def: { nick: info.name || info.nick || 'База', skin: info.skin, base: id } });
  }
  // приглашение в базу по ссылке (/play/raid/join/<код>): что за база — и «Вступить» (war_join)
  async function showJoin(code){
    if (!S) return;
    S.screen = 'join';
    const info = await rpc('war_invite_info', { p_code: code });
    if (!S) return;
    const MBx = MB();
    if (!info?.ok) return page('🏯 Приглашение', `<div class="rd-note">${info?.reason === 'nosql' ? esc(WHY.nosql) : 'Приглашение не найдено или устарело — попроси у главаря новую ссылку.'}</div>`);
    const name = MBx.baseName(info.name_k, info.name_n), color = MBx.COLORS[info.color] || '#ef4444', lg = MBx.LEAGUES[MBx.league(info.tr)];
    page('🏯 Приглашение в базу', `<div class="rd-card"><h3 style="color:${color}">🏯 ${esc(name)}</h3><p class="rd-sub" style="font-size:.86rem">👑 Главарь: ${esc(info.nick)} · 👥 ${info.n} · штаб ${info.th} ур. · ${lg[1]} 🏆 ${num(info.tr)}</p>
      <p class="rd-sub">Вступишь бойцом: собирай кирпичи в казну, дари их со своего участка района, бери технику базы, защищай базу — и (если главарь разрешит) води армию в набеги. Военные базы — с 12 лет, бои мультяшные, без крови.</p>
      ${!authed() ? '<div class="rd-btns" style="grid-template-columns:1fr"><button type="button" class="rd-b pri" data-a="login">🔑 Войти и вступить</button></div>'
        : S.base ? `<div class="rd-note">Ты уже в базе «${esc(baseTitle(S.base))}». Чтобы перейти, сначала выйди из неё (меню базы в мире).</div>`
        : S.mode === 'age' ? `<div class="rd-note">${esc(WHY.age)}</div>`
        : `<div class="rd-btns" style="grid-template-columns:1fr"><button type="button" class="rd-b pri" data-join="${esc(code)}">🏯 Вступить в базу</button></div>`}</div>`);
  }
  async function openReplay(id){
    const r = await rpc('raid_replay', { p_id: id });
    if (!S) return;
    if (!r?.ok) { toast('Повтор не найден'); return showHub(); }
    if (!r.same) toast('Цифры игры с тех пор поменялись — повтор может немного отличаться');
    enterBattle('replay', { id: r.id || id, layout: r.layout, lvl: r.lvl, variant: r.variant, army: r.army, hero: r.hero, seed: r.seed, defs: r.defs, inputs: r.inputs, def: r.def, att: r.att, result: r.result, attSkin: r.att.skin, defSkin: r.def.skin, heroLook: {} });
  }
  // продолжить набег после перезагрузки (d37_raid_cur)
  async function resume(){
    const cur = lsGet(LS_CUR);
    if (!cur || !S || S.mode !== 'ok') return false;
    const act = S.st?.active;
    if (!act || act.id !== cur.id) { lsSet(LS_CUR, null); if (cur.pend) retryPending(cur); return false; }
    const data = { ...cur.data, token: act.token };
    enterBattle('raid', data, cur);
    return true;
  }

  function enterBattle(kind, data, cur){
    if (!S) return;
    S.screen = 'battle';
    const bt = S.bt = newBattle(kind, data);
    const MBx = MB(), U = MBx.UNITS;
    if (kind === 'raid') {
      bt.scoutEnd = (data.started_at || sNow()) + (data.scout || R().scout);
      lsSet(LS_CUR, cur ? { ...cur, token: data.token } : { id: data.id, token: data.token, data: { ...data, defs: undefined }, ins: [] });
      if (cur?.t0) {   // перезагрузка посреди боя: прогнать тот же ввод до «сейчас» и играть дальше
        bt.phase = 'fight'; bt.goOk = true; bt.t0 = cur.t0;
        const target = Math.min(bt.B.MAXT, Math.floor((Date.now() - cur.t0) / 50)), ins = cur.ins || [];
        let i = 0;
        while (bt.B.tick < target && !bt.B.over) { while (i < ins.length && ins[i].t === bt.B.tick) { applyIn(bt, ins[i]); i++; } if (!bt.B.over) bt.B.step(); bt.B.ev.length = 0; }
        while (i < ins.length && ins[i].t <= bt.B.tick && !bt.B.over) { applyIn(bt, ins[i]); i++; }
        bt.ins = ins.slice(0, i);
      }
    }
    if (kind === 'replay') { bt.phase = 'fight'; bt.t0 = performance.now(); }
    const def = data.def || {}, L = def.tr != null ? MBx.LEAGUES[MBx.league(def.tr)] : null, bn = o => (o && o.k != null ? MBx.baseName(o.k, o.n) : o?.name_k != null ? MBx.baseName(o.name_k, o.name_n) : '');
    const title = kind === 'replay' ? `🎬 ${esc(data.att?.nick || '')}${bn(data.att?.base) ? ' (' + esc(bn(data.att.base)) + ')' : ''} → ${esc(bn(def.base) || def.nick || '')}` : kind === 'tut' ? '🎓 Учебный набег' : kind === 'friendly' ? `🤝 Дружеский бой: ${esc(def.nick || '')}` : data.mode === 'camp' ? `🏴‍☠️ Лагерь ${data.lvl}` : data.mode === 'bot' ? '🏴‍☠️ Разбойники' : `🆚 🏯 ${esc(bn(def) || def.nick || 'База')}${L ? ` ${L[1]} ${num(def.tr)}` : ''} · штаб ${def.th || ''}`;
    const types = Object.keys(bt.B.left).filter(u => U[u]);
    setHTML(`<div class="rd"><div class="rd-field${kind === 'replay' ? ' rp' : ''}"><canvas class="rdCv"></canvas>
      <div class="rd-top"><div class="rd-pill">${title}<div class="rdLoot" style="font-weight:700;opacity:.9"></div></div><div class="rd-sp"></div><div class="rd-pill big"><div class="rdTimer">—</div><div class="rd-stars rdStars">☆☆☆</div><div class="rdPct" style="font-size:.7rem">0 %</div></div></div>
      <div class="rd-tip rdTip" hidden></div>
      <div class="rd-barB">${kind === 'replay' ? '' : types.map(u => `<button type="button" class="rd-u" data-u="${u}" title="${esc(U[u].n)}">${U[u].e}<i>${bt.B.left[u]}</i></button>`).join('') + (bt.B.hero ? '<button type="button" class="rd-u" data-u="hero" title="Герой — твой персонаж">🦸<i>1</i></button><button type="button" class="rd-u ab" data-ab="1" title="«Удар» героя" disabled>💥</button>' : '')}</div>
      <div class="rd-act">${kind === 'replay' ? `<button type="button" class="rd-b" data-a="pause">⏸</button><button type="button" class="rd-b" data-a="speed">×1</button><button type="button" class="rd-b" data-a="restart">⏮</button>${data.id ? '<button type="button" class="rd-b" data-a="share" title="Поделиться повтором">🔗</button>' : ''}<button type="button" class="rd-b" data-a="hub">🏠</button>`
          : `<button type="button" class="rd-b rdNext" data-a="next"${kind === 'raid' && data.mode === 'find' ? '' : ' hidden'}>⏭ Следующий 🧱${num(R().next[(data.hero || 1) - 1])}</button><button type="button" class="rd-b rdHome" data-a="home">🏠 Домой</button><button type="button" class="rd-b rdEnd" data-a="end" hidden>🏳️ Закончить</button>`}</div></div></div>`);
    const cv = $('.rdCv'), V = makeView(cv, { full: true, n: bt.B.MAP });
    V.block = gridOf(bt.cfg.layout).block;
    S.views = [V]; bt.V = V;
    S.ro = new ResizeObserver(() => V.resize()); S.ro.observe(cv);
    bindField(bt, cv);
    S.root.firstChild.addEventListener('click', e => onBattleClick(e, bt));
    if (types.length) select(bt, types[0]);
    if (kind === 'tut') tip(bt, '🎓 Это лагерь разбойников. Выбери отряд внизу и нажми на <b>зелёную полосу</b> у края — там высадка.');
    else if (kind === 'raid' && bt.phase === 'scout') tip(bt, '👀 Разведка: посмотри базу (колесо или два пальца — ближе). Нажми на зелёную полосу — высадка начнёт бой (3 минуты).');
    else if (kind === 'friendly') tip(bt, '🤝 Тренировка: без добычи и кубков, армия не тратится.');
    loadSprites().then(() => { for (const u of [...types, 'hero']) spriteFor(u, u === 'hero' ? '' : bt.skinA, bt.heroLook); });
    S.timers.push(setTimeout(fitField, 450));   // после прокрутки openGame
    bt.last = performance.now();
    const loop = () => { if (!S || S.bt !== bt) return; S.raf = requestAnimationFrame(loop); frame(bt); };
    S.raf = requestAnimationFrame(loop);
  }
  // поле боя целиком на экране: низ с отрядами виден, верх — не под шапкой сайта
  function fitField(){
    const f = $('.rd-field'); if (!f || document.fullscreenElement) return;
    const r = f.getBoundingClientRect(), head = 64, vh = root.innerHeight || 0;
    let dy = r.bottom > vh ? r.bottom - vh + 6 : 0;
    if (r.top - dy < head) dy = r.top - head;
    if (Math.abs(dy) > 2) root.scrollBy({ top: dy, behavior: 'smooth' });
  }
  function tip(bt, html, ms = 0){ const t = $('.rdTip'); if (!t) return; t.innerHTML = html; t.hidden = !html; clearTimeout(bt.tipT); if (ms) bt.tipT = setTimeout(() => { if (t) t.hidden = true; }, ms); }
  function select(bt, u){ bt.sel = u; S.root.querySelectorAll('.rd-u[data-u]').forEach(b => b.classList.toggle('on', b.dataset.u === u)); }
  function updBar(bt){
    S.root.querySelectorAll('.rd-u[data-u]').forEach(b => { const u = b.dataset.u, n = u === 'hero' ? (bt.B.heroUsed ? 0 : 1) : bt.B.left[u] || 0; b.querySelector('i').textContent = n; b.disabled = !n || bt.B.over; });
    const ab = $('.rd-u.ab'); if (ab) { const h = bt.B.us[bt.B.heroIdx]; ab.disabled = !h || !h.alive || bt.B.abUsed || bt.B.over; }
    if (bt.sel && (bt.sel === 'hero' ? bt.B.heroUsed : !(bt.B.left[bt.sel] > 0))) { const n = Object.keys(bt.B.left).find(u => bt.B.left[u] > 0) || (!bt.B.heroUsed && bt.B.hero ? 'hero' : null); select(bt, n); }
  }
  function applyIn(bt, e){ const B = bt.B; return e.u != null ? B.deploy(e.u, e.x, e.z) : e.a ? B.ability() : B.surrender(); }
  // ввод игрока на текущем шаге (до шага) — так же сервер применяет его при пересчёте
  function input(bt, e){
    if (bt.kind === 'replay' || bt.B.over) return false;
    if (bt.phase === 'scout') { if (e.u == null) return false; goFight(bt); }
    const rec = { t: bt.B.tick, ...e }, why2 = applyIn(bt, rec);
    if (why2) return why2;
    bt.ins.push(rec);
    if (bt.kind === 'raid') { const c = lsGet(LS_CUR); if (c && c.id === bt.data.id) { c.ins = bt.ins; c.t0 = bt.t0; lsSet(LS_CUR, c); } }
    if (e.u != null) snd('deploy');
    updBar(bt);
    return null;
  }
  // бой пошёл: шаг 0 — сейчас; сервер — raid_go (снимает свой щит, дальше уход = поражение)
  function goFight(bt){
    if (bt.phase !== 'scout') return;
    bt.phase = 'fight'; bt.t0 = Date.now();
    const n = $('.rdNext'), h = $('.rdHome'), e = $('.rdEnd');
    if (n) n.hidden = true; if (h) h.hidden = true; if (e) e.hidden = false;
    tip(bt, bt.tut ? '👍 Высаживай ещё — можно вести пальцем по полосе. Выпусти и героя 🦸 — это твой персонаж!' : '', bt.tut ? 0 : 1);
    if (bt.kind === 'raid') {
      const c = lsGet(LS_CUR); if (c) { c.t0 = bt.t0; lsSet(LS_CUR, c); }
      const go = async (k = 0) => { const r = await rpc('raid_go', { p_id: bt.data.id }); if (!S || S.bt !== bt) return; if (r?.ok) bt.goOk = true; else if (r?.reason === 'late' || r?.reason === 'expired' || r?.reason === 'canceled') { toast(WHY.late); lsSet(LS_CUR, null); showHub(); } else if (k < 4) S.timers.push(setTimeout(() => go(k + 1), 1500 * (k + 1))); };
      go();
    }
  }
  function surrender(bt, beacon){ if (bt.B.over) return; if (bt.phase === 'scout') return; input(bt, { s: 1 }); if (beacon) flushBeacon(); }
  async function onBattleClick(e, bt){
    const b = e.target.closest('[data-u],[data-ab],[data-a]'); if (!b || !S) return;
    if (b.dataset.u) return select(bt, b.dataset.u);
    if (b.dataset.ab) { const r = input(bt, { a: 1 }); if (r) toast('Герой должен быть на поле'); else { snd('boom'); bt.shake = performance.now(); } return; }
    const a = b.dataset.a;
    if (a === 'home') {
      if (bt.kind === 'raid' && bt.phase === 'scout') { await rpc('raid_cancel', { p_id: bt.data.id }); lsSet(LS_CUR, null); await refresh(); return showHub(); }
      return leave(bt);
    }
    if (a === 'next') { b.disabled = true; lsSet(LS_CUR, null); const r = await rpc('raid_start', { p_mode: 'next', p_dev: dev() }); if (!S) return; if (r?.ok) return enterBattle('raid', r); toast(why(r)); if (r?.reason === 'nobody') { await refresh(); return showHub(); } b.disabled = false; return; }
    if (a === 'end') { if (!(await ask({ icon: '🏳️', title: 'Закончить бой?', text: 'Засчитают то, что уже разрушено. Невысаженные отряды вернутся в казарму.', yes: '🏳️ Закончить', no: 'Продолжить' }))) return; return surrender(bt); }
    if (a === 'hub') return leave(bt);
    if (a === 'pause') { bt.paused = !bt.paused; b.textContent = bt.paused ? '▶' : '⏸'; return; }
    if (a === 'speed') { bt.speed = bt.speed >= 4 ? 1 : bt.speed * 2; b.textContent = '×' + bt.speed; return; }
    if (a === 'restart') return enterBattle('replay', bt.data);
    if (a === 'again') { if (bt.kind === 'tut') return startTut(); if (bt.kind === 'friendly') return friendly(bt.data.def?.base || 0); return findBattle(null, bt.data.mode === 'camp' ? 'camp' : bt.data.mode === 'bot' ? 'bot' : 'find', bt.data.mode === 'camp' ? String(bt.data.lvl) : null); }
    if (a === 'replay') return enterBattle('replay', { ...bt.data, id: bt.kind === 'raid' && bt.server?.ok && !bt.server.canceled ? bt.data.id : undefined, inputs: bt.ins.slice(), att: { nick: (typeof currentProfile !== 'undefined' && currentProfile?.nick) || 'Я' }, attSkin: bt.skinA });
    if (a === 'share' && bt.data.id) {
      const r = bt.server?.ok && bt.server.stars != null ? bt.server : bt.result || bt.data.result || {}, d = bt.data.def || {}, who = d.name_k != null ? MB().baseName(d.name_k, d.name_n) : d.base?.k != null ? MB().baseName(d.base.k, d.base.n) : d.nick;
      return share('replay/' + bt.data.id, bt.kind === 'replay' ? `Смотри повтор набега в «Набегах»: ${bt.data.att?.nick || 'Игрок'} → ${who || 'база'} ⚔️` : `Смотри, как мы ${r.stars ? 'взяли' : 'штурмовали'} ${who ? 'базу «' + who + '»' : 'лагерь разбойников'}: ${stars(r.stars || 0)} ${r.pct || 0} % ⚔️`);
    }
  }
  async function leave(bt){
    if (bt.kind === 'raid' && bt.phase === 'fight' && !bt.B.over) {
      if (!(await ask({ icon: '🏃', title: 'Уйти из боя?', text: 'Бой засчитают как есть: что разрушено — твоё, высаженные отряды потрачены.', yes: 'Уйти', no: 'Остаться', danger: true }))) return;
      surrender(bt);
      return;
    }
    await refresh();
    showHub();
  }
  // Нажатия по полю: высадка (и «кистью» — ведёшь пальцем), прокрутка и масштаб (двумя пальцами, колесом)
  function bindField(bt, cv){
    const V = bt.V, ptrs = new Map();
    let paint = null, pan = null, pinch = null;
    const at = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (V.W / (r.width || 1)), (e.clientY - r.top) * (V.H / (r.height || 1))]; };
    const toMap = (sx, sy) => { const [cx, cz] = V.un(sx, sy); return [Math.round(cx * 256), Math.round(cz * 256)]; };
    const tryDeploy = (sx, sy) => {
      if (!bt.sel || bt.kind === 'replay') return false;
      const [x, z] = toMap(sx, sy);
      if (x < 0 || z < 0 || x >= bt.B.W || z >= bt.B.W) return false;
      if (!bt.B.inRing(x, z)) { bt.flash = { x, z, t: performance.now() }; tip(bt, '🚫 Сюда нельзя — высаживай на <b>зелёной полосе</b> за краем базы', 2200); return false; }
      const r = input(bt, bt.sel === 'hero' ? { u: 'hero', x, z } : { u: bt.sel, x, z });
      if (r && r !== 'unit') return false;
      return !r;
    };
    cv.addEventListener('pointerdown', e => {
      e.preventDefault(); cv.setPointerCapture?.(e.pointerId);
      const p = at(e); ptrs.set(e.pointerId, p);
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: V.zoom }; paint = null; pan = null; return; }
      if (e.button === 2 || e.button === 1) { pan = { x: p[0], y: p[1], px: V.px, py: V.py }; return; }
      const [mx, mz] = toMap(p[0], p[1]);
      const MW = bt.B.W, IN = (bt.B.MAP - 2) * 256;
      if (bt.kind !== 'replay' && !bt.B.over && bt.B.inRing(Math.max(0, mx), Math.max(0, mz)) && mx >= 0 && mz >= 0 && mx < MW && mz < MW) { if (tryDeploy(p[0], p[1])) paint = { x: p[0], y: p[1], t: performance.now() }; }
      else { if (bt.kind !== 'replay' && !bt.B.over && mx >= 512 && mz >= 512 && mx < IN && mz < IN) tryDeploy(p[0], p[1]); pan = { x: p[0], y: p[1], px: V.px, py: V.py }; }
    });
    cv.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      const p = at(e); ptrs.set(e.pointerId, p);
      if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); V.zoomAt((pinch.z * d / pinch.d) / V.zoom, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); return; }
      if (pan) { V.px = pan.px + p[0] - pan.x; V.py = pan.py + p[1] - pan.y; V.apply(); return; }
      if (paint && performance.now() - paint.t > 110 && Math.hypot(p[0] - paint.x, p[1] - paint.y) > V.tw * .35) { if (tryDeploy(p[0], p[1])) { paint.x = p[0]; paint.y = p[1]; paint.t = performance.now(); } }
    });
    const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) { paint = null; pan = null; } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('wheel', e => { e.preventDefault(); const p = at(e); V.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, p[0], p[1]); }, { passive: false });
    // клавиши: 1…7 — отряд, Пробел — «Удар» героя
    bt.onKey = e => {
      if (!S || S.bt !== bt || e.target.closest?.('input,textarea')) return;
      const keys = [...S.root.querySelectorAll('.rd-u[data-u]')];
      if (/^[1-9]$/.test(e.key) && keys[+e.key - 1]) { select(bt, keys[+e.key - 1].dataset.u); e.preventDefault(); }
      else if (e.key === ' ' && !$('.rd-u.ab')?.disabled) { $('.rd-u.ab')?.click(); e.preventDefault(); }
    };
    root.addEventListener('keydown', bt.onKey);
    bt.off = () => root.removeEventListener('keydown', bt.onKey);
  }
  // геймпад: стик — прицел по полосе, A — высадить, LB/RB — отряд, X — «Удар»
  function pad(bt){
    const gp = navigator.getGamepads?.()?.find(g => g && g.connected);
    if (!gp || bt.kind === 'replay') return;
    const MW = bt.B.W, ax = gp.axes[0] || 0, az = gp.axes[1] || 0, P = bt.pad = bt.pad || { x: MW >> 1, z: 200, prev: [] };
    if (Math.abs(ax) > .2 || Math.abs(az) > .2) { P.x = Math.max(0, Math.min(MW - 1, P.x + (ax + az) * 40)); P.z = Math.max(0, Math.min(MW - 1, P.z + (az - ax) * 40)); P.show = performance.now(); }
    const pr = i => gp.buttons[i]?.pressed && !P.prev[i];
    const types = [...S.root.querySelectorAll('.rd-u[data-u]')].map(b => b.dataset.u);
    if (pr(0) && bt.sel) { const r = input(bt, bt.sel === 'hero' ? { u: 'hero', x: Math.round(P.x), z: Math.round(P.z) } : { u: bt.sel, x: Math.round(P.x), z: Math.round(P.z) }); if (r === 'zone') tip(bt, '🚫 Только на зелёной полосе', 1500); }
    if ((pr(4) || pr(5)) && types.length) { const i = Math.max(0, types.indexOf(bt.sel)); select(bt, types[(i + (pr(5) ? 1 : types.length - 1)) % types.length]); }
    if (pr(2)) $('.rd-u.ab')?.click();
    P.prev = gp.buttons.map(b => b.pressed);
  }

  // ── Кадр: шаги боя по часам (20 в секунду), картинка — с плавностью между шагами ──
  function frame(bt){
    const B = bt.B, V = bt.V, now = performance.now();
    pad(bt);
    if (bt.kind === 'replay') {
      if (!bt.paused && !B.over) {
        bt.acc = (bt.acc || 0) + Math.min(250, now - bt.last) * bt.speed / 50;
        let n = 0;
        while (bt.acc >= 1 && !B.over && n++ < 80) { const ins = bt.replayIns; bt.ri = bt.ri || 0; while (bt.ri < ins.length && ins[bt.ri].t === B.tick) applyIn(bt, ins[bt.ri++]); if (!B.over) { B.step(); events(bt); } bt.acc -= 1; }
        if (B.over && !bt.result) { bt.result = B.result(); showResult(bt); }
      }
    } else if (bt.phase === 'scout') {
      if (bt.kind === 'raid') {
        const left = bt.scoutEnd - sNow();
        if (left <= 0) goFight(bt);
      }
    } else if (!B.over) {
      const target = Math.min(B.MAXT, Math.floor((Date.now() - bt.t0) / 50));
      let n = 0;
      while (B.tick < target && !B.over && n++ < 60) { B.step(); events(bt); }
      if (B.over) endBattle(bt);
    }
    bt.last = now;
    // подсказки учебного
    if (bt.tut && bt.phase === 'fight') {
      const h = B.us[B.heroIdx];
      if (bt.tut === 1 && bt.ins.length >= 4) { bt.tut = 2; tip(bt, B.heroUsed ? '' : '🦸 Выпусти героя — кнопка с героем внизу. Это твой персонаж!', 0); }
      if (bt.tut <= 2 && h && h.alive) { bt.tut = 3; tip(bt, '💥 Нажми «Удар», когда герой рядом с постройками — он ударит по всем вокруг', 0); }
      if (bt.tut === 3 && B.abUsed) { bt.tut = 4; tip(bt, '⭐ Звёзды: за 50 % построек, за штаб и за всё. Разрушь штаб!', 6000); }
    }
    draw(bt, Math.max(0, Math.min(1, bt.kind === 'replay' ? (bt.acc || 0) : (Date.now() - bt.t0) / 50 - B.tick)));
    hud(bt);
  }
  // события шага → эффекты, звук
  function events(bt){
    const B = bt.B, now = performance.now();
    for (const e of B.ev) {
      if (e.e === 'shot') { const b = B.bs[e.b], u = B.us[e.u]; bt.fx.push({ k: b.k === 'tower' ? 'arrow' : 'ball', from: [b.x0 + b.w / 2, b.z0 + b.d / 2, b.k === 'tower' ? 3 : .7], to: [u.x / 256, u.z / 256, u.air ? 1.1 : .4], t: now, d: 200 }); bt.aims.set(b.n, Math.atan2(u.z / 256 - (b.z0 + b.d / 2), u.x / 256 - (b.x0 + b.w / 2))); if (b.k === 'cannon') bt.fires.set(b.n, true), setTimeout(() => bt.fires.delete(b.n), 90); snd(b.k === 'tower' ? 'arrow' : 'shot'); }
      else if (e.e === 'shell') { const b = B.bs[e.b]; bt.fx.push({ k: 'shell', from: [b.x0 + b.w / 2, b.z0 + b.d / 2, .8], to: [e.x / 256, e.z / 256, 0], t: now, d: e.t * 50 }); snd('shot'); }
      else if (e.e === 'blast' || e.e === 'trap' || e.e === 'boom' || e.e === 'bomb') { bt.fx.push({ k: 'blast', at: [e.x / 256, e.z / 256], r: (e.r || 128) / 256, t: now, d: 450 }); snd('boom'); if (e.e === 'trap') { const b = B.bs[e.b]; b.shown = true; } }
      else if (e.e === 'arm') { B.bs[e.b].arm = 1; }
      else if (e.e === 'hit') { const o = B.us[e.u], b = B.bs[e.b]; if (o.k === 'archer') bt.fx.push({ k: 'arrow', from: [o.x / 256, o.z / 256, .6], to: [b.x0 + b.w / 2, b.z0 + b.d / 2, .6], t: now, d: 220 }); else bt.fx.push({ k: 'spark', at: [o.x / 256 + (b.x0 + b.w / 2 - o.x / 256) * .4, o.z / 256 + (b.z0 + b.d / 2 - o.z / 256) * .4], t: now, d: 160 }); if (Math.random() < .3) snd('hit'); }
      else if (e.e === 'heal') { const o = B.us[e.u]; bt.fx.push({ k: 'heal', at: [o.x / 256, o.z / 256], r: 2, t: now, d: 500 }); snd('heal'); }
      else if (e.e === 'ab') { bt.fx.push({ k: 'wave', at: [e.x / 256, e.z / 256], r: e.r / 256, t: now, d: 600 }); }
      else if (e.e === 'down') { const b = B.bs[e.b]; bt.fx.push({ k: 'dust', at: [b.x0 + b.w / 2, b.z0 + b.d / 2], r: Math.max(b.w, b.d) * .6, t: now, d: 700 }); snd('down'); if (b.n === B.th) { snd('star'); bt.starFlash = now; } }
      else if (e.e === 'die') { const o = B.us[e.u]; bt.fx.push({ k: 'puff', at: [o.x / 256, o.z / 256, o.air ? 1.1 : .3], t: now, d: 500 }); }
    }
    B.ev.length = 0;
  }
  function draw(bt, a){
    const B = bt.B, V = bt.V, g = V.ctx, now = performance.now();
    g.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    if (bt.shake && now - bt.shake < 300) { const k = (1 - (now - bt.shake) / 300) * 5; g.translate((Math.random() - .5) * k, (Math.random() - .5) * k); }
    const us = bt.usPool || (bt.usPool = []);   // записи отрядов переиспользуются (без мусора за кадр)
    let un = 0;
    for (const o of B.us) if (o.alive) { let u = us[un]; if (!u) u = us[un] = { o: null, cx: 0, cz: 0, air: false }; u.o = o; u.cx = (o.px + (o.x - o.px) * a) / 256; u.cz = (o.pz + (o.z - o.pz) * a) / 256; u.air = o.air; un++; }
    us.length = un;
    drawScene(V, B.bs, us, { tint: bt.skinB, ring: bt.kind !== 'replay' && !B.over && (bt.phase === 'scout' || Object.values(B.left).some(n => n > 0) || (B.hero && !B.heroUsed)), bars: true, aims: bt.aims, fires: bt.fires, showTraps: bt.kind === 'replay' && false,
      drawUnit: u => drawUnit(bt, u, now) });
    // ловушки, что сработали, — воронки
    for (const b of B.bs) if (b.trap && !b.alive) { const [sx, sy] = V.p(b.x0 + .5, b.z0 + .5); g.fillStyle = 'rgba(30,20,10,.55)'; g.beginPath(); g.ellipse(sx, sy, V.hw * .5, V.hh * .5, 0, 0, 2 * PI); g.fill(); }
    // эффекты
    { const F = bt.fx; let w = 0; for (let i = 0; i < F.length; i++) if (now - F[i].t < F[i].d) F[w++] = F[i]; F.length = w; }   // отжившие — прочь, на месте
    for (const f of bt.fx) {
      const k = (now - f.t) / f.d;
      if (f.k === 'arrow' || f.k === 'ball' || f.k === 'shell') {
        const x = f.from[0] + (f.to[0] - f.from[0]) * k, z = f.from[1] + (f.to[1] - f.from[1]) * k, h = f.from[2] + (f.to[2] - f.from[2]) * k + (f.k === 'shell' ? Math.sin(k * PI) * 3 : 0), [sx, sy] = V.p(x, z, h);
        if (f.k === 'arrow') { const [px, py] = V.p(f.from[0] + (f.to[0] - f.from[0]) * Math.max(0, k - .15), f.from[1] + (f.to[1] - f.from[1]) * Math.max(0, k - .15), f.from[2] + (f.to[2] - f.from[2]) * Math.max(0, k - .15)); g.strokeStyle = '#fde68a'; g.lineWidth = 2; g.beginPath(); g.moveTo(px, py); g.lineTo(sx, sy); g.stroke(); }
        else { g.fillStyle = f.k === 'shell' ? '#1f2937' : '#111827'; g.beginPath(); g.arc(sx, sy, V.tw * (f.k === 'shell' ? .14 : .1), 0, 2 * PI); g.fill(); }
      } else if (f.k === 'blast' || f.k === 'wave' || f.k === 'dust' || f.k === 'heal') {
        const [sx, sy] = V.p(f.at[0], f.at[1]), rx = f.r * Math.SQRT2 * V.hw * (f.k === 'blast' ? .4 + .6 * k : k), ry = rx / 2;
        g.globalAlpha = 1 - k;
        g.fillStyle = f.k === 'blast' ? '#f97316' : f.k === 'heal' ? '#4ade80' : f.k === 'dust' ? '#a8a29e' : '#c084fc';
        if (f.k === 'wave' || f.k === 'heal') { g.strokeStyle = g.fillStyle; g.lineWidth = 4; g.beginPath(); g.ellipse(sx, sy, rx, ry, 0, 0, 2 * PI); g.stroke(); }
        else { g.beginPath(); g.ellipse(sx, sy - (f.k === 'dust' ? k * V.vh : 0), rx, ry * (f.k === 'dust' ? 1.6 : 1), 0, 0, 2 * PI); g.fill(); if (f.k === 'blast') { g.fillStyle = '#fde047'; g.beginPath(); g.ellipse(sx, sy, rx * .55, ry * .55, 0, 0, 2 * PI); g.fill(); } }
        g.globalAlpha = 1;
      } else if (f.k === 'spark' || f.k === 'puff') {
        const [sx, sy] = V.p(f.at[0], f.at[1], (f.at[2] || .4) + k * .4);
        g.globalAlpha = 1 - k; g.fillStyle = f.k === 'spark' ? '#fde68a' : '#e5e7eb';
        g.beginPath(); g.arc(sx, sy, V.tw * (f.k === 'spark' ? .1 : .18 + k * .2), 0, 2 * PI); g.fill(); g.globalAlpha = 1;
      }
    }
    // нельзя сюда — красная метка
    if (bt.flash && now - bt.flash.t < 500) { const [sx, sy] = V.p(bt.flash.x / 256, bt.flash.z / 256); g.strokeStyle = `rgba(239,68,68,${1 - (now - bt.flash.t) / 500})`; g.lineWidth = 3; g.beginPath(); g.ellipse(sx, sy, V.hw * .6, V.hh * .6, 0, 0, 2 * PI); g.stroke(); }
    if (bt.pad && now - (bt.pad.show || 0) < 4000) { const [sx, sy] = V.p(bt.pad.x / 256, bt.pad.z / 256); g.strokeStyle = '#fde047'; g.lineWidth = 2; g.beginPath(); g.ellipse(sx, sy, V.hw * .5, V.hh * .5, 0, 0, 2 * PI); g.stroke(); }
    if (bt.starFlash && now - bt.starFlash < 1200) { g.globalAlpha = 1 - (now - bt.starFlash) / 1200; g.font = `900 ${Math.round(V.tw * 1.4)}px Montserrat,sans-serif`; g.textAlign = 'center'; g.fillStyle = '#facc15'; g.fillText('★', V.W / 2, V.H * .4); g.globalAlpha = 1; }
  }
  function drawUnit(bt, u, now){
    const V = bt.V, g = V.ctx, o = u.o, h = u.air ? 1.1 : 0, [sx, sy] = V.p(u.cx, u.cz, h), [gx, gy] = V.p(u.cx, u.cz, 0);
    g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(gx, gy, V.hw * .32, V.hh * .32, 0, 0, 2 * PI); g.fill();
    const HH = V.tw * (o.k === 'tank' ? .95 : o.k === 'hero' ? .9 : .78), moving = o.x !== o.px || o.z !== o.pz;
    const dir = root.D37Sprite ? root.D37Sprite.dir8(o.fx - o.fz, (o.fx + o.fz) / 2, 0) : 0;
    const anim = bt.B.tick - o.act < 6 ? 'use' : moving ? 'run' : 'idle';
    const SH = bt.sprH || (bt.sprH = {}), H = SH[o.k] || (SH[o.k] = spriteFor(o.k, o.k === 'hero' ? '' : bt.skinA, bt.heroLook));
    const drew = H && H.draw(g, anim, now / 1000 + o.n * .37, sx, sy, { dir, h: HH, item: ITEM[o.k] || (o.k === 'hero' ? '⚔️' : '') });
    if (!drew) { g.fillStyle = TEAM[o.k] || '#fff'; g.beginPath(); g.arc(sx, sy - HH * .45, HH * .3, 0, 2 * PI); g.fill(); g.font = `${Math.round(HH * .45)}px "Segoe UI Emoji",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(MB().UNITS[o.k]?.e || '🦸', sx, sy - HH * .45); }
    if (o.hp < o.mhp) hpBar(V, u.cx, u.cz, h + 1.05, o.hp / o.mhp, V.tw * .5, o.k === 'hero' ? '#c084fc' : null);
    if (o.k === 'hero') { g.fillStyle = '#e9d5ff'; g.font = `800 ${Math.max(9, Math.round(V.tw * .3))}px Montserrat,sans-serif`; g.textAlign = 'center'; g.fillText('🦸', sx, sy - HH * 1.1); }
  }
  function hud(bt){
    const B = bt.B, r = B.result(), now = sNow();
    const t = $('.rdTimer'), s = $('.rdStars'), p = $('.rdPct'), l = $('.rdLoot');
    if (t) t.textContent = bt.phase === 'scout' && bt.kind === 'raid' ? '👀 ' + clock(bt.scoutEnd - now) : bt.phase === 'scout' ? '3:00' : clock((B.MAXT - B.tick) / 20);
    if (s && s.textContent !== stars(r.stars)) s.textContent = stars(r.stars);
    if (p) p.textContent = r.pct + ' %';
    if (l) {
      const off = bt.data.offer, tr = bt.data.tr, pv = bt.data.pve;
      const txt = off ? `🧱 ${num(lootNow(bt))} из ${num(off.total)}${tr ? ` · 🏆 +${tr.win} / −${tr.lose}` : ''}` : pv ? `🧱 до ${num(pv.loot)}` : bt.kind === 'friendly' || bt.kind === 'tut' && !pv ? 'без добычи и кубков' : '';
      if (l.textContent !== txt) l.textContent = txt;
    }
    if (!bt.barT || performance.now() - bt.barT > 300) { bt.barT = performance.now(); updBar(bt); }
  }

  // ── Конец боя: итог считает сервер ──
  async function endBattle(bt){
    if (bt.ended) return;
    bt.ended = true;
    bt.off?.();
    bt.result = bt.B.result();
    try { gameSfx(bt.result.stars > 0 ? 'win' : 'bad'); } catch (e) {}
    showResult(bt);
    if (bt.kind !== 'raid') return;
    const body = { id: bt.data.id, token: bt.data.token, inputs: bt.ins };
    const c = lsGet(LS_CUR); if (c) { c.pend = body; lsSet(LS_CUR, c); }
    await submit(bt, body);
  }
  async function submit(bt, body, k = 0){
    if (!bt.goOk && k < 6) { await new Promise(r => setTimeout(r, 1200)); if (!S || S.bt !== bt) return; }
    const r = await post(body);
    if (!S || S.bt !== bt) return;
    if (r?.reason === 'early' && k < 8) { setSrv(bt, `⏳ Засчитываем… ${r.wait || 1} с`); S.timers.push(setTimeout(() => submit(bt, body, k + 1), (r.wait || 1) * 1000 + 300)); return; }
    if ((r?.reason === 'net' || r?.reason === 'db') && k < 3) { setSrv(bt, '⏳ Нет связи — пробуем ещё…'); S.timers.push(setTimeout(() => submit(bt, body, k + 1), 2000 * (k + 1))); return; }
    if (r?.reason === 'nogo' && k < 4) { await rpc('raid_go', { p_id: body.id }); return submit(bt, body, k + 1); }
    bt.server = r;
    if (r?.ok || ['expired', 'canceled', 'token', 'bad_input'].includes(r?.reason)) lsSet(LS_CUR, null);
    showResult(bt);
    root.D37Coins?.sync?.();
    try { root.dispatchEvent(new CustomEvent('d37:base')); } catch (e) {}
  }
  function flushBeacon(){
    const bt = S?.bt;
    if (!bt || bt.kind !== 'raid' || bt.submitted || bt.phase !== 'fight') return;
    if (!bt.B.over) input(bt, { s: 1 });
    bt.submitted = true;
    post({ id: bt.data.id, token: bt.data.token, inputs: bt.ins }, true);
  }
  async function retryPending(cur){
    const c = cur || lsGet(LS_CUR);
    if (!c?.pend || S?.mode !== 'ok') return;
    const r = await post(c.pend);
    if (r?.ok || ['expired', 'canceled', 'token', 'bad_input'].includes(r?.reason)) { lsSet(LS_CUR, null); if (r?.ok && !r.again) toast(`⚔️ Прошлый набег засчитан: ${stars(r.stars)} · 🧱 +${num(r.added || 0)}`); }
  }
  function setSrv(bt, txt){ const e = S?.root?.querySelector('.rdSrv'); if (e) e.textContent = txt; }
  function showResult(bt){
    if (!S || S.bt !== bt) return;
    let box = $('.rd-res');
    if (!box) { box = document.createElement('div'); box.className = 'rd-res'; $('.rd-field')?.appendChild(box); }
    const r = bt.server?.ok && bt.server.stars != null ? bt.server : bt.result, srv = bt.server;
    const pv = bt.data.pve, off = bt.data.offer;
    let lines = '';
    if (bt.kind === 'raid') {
      if (srv?.ok && srv.canceled) lines = '<div class="ln">Никого не высадил — набег не состоялся</div>';
      else if (srv?.ok) lines = `<div class="ln">🧱 +${num(srv.added)} в казну${srv.bonus ? ` <small>(в т. ч. бонус лиги ${num(srv.bonus)})</small>` : ''}${srv.added < (srv.loot || 0) + (srv.bonus || 0) ? ' <small>— казна полна</small>' : ''}</div>${srv.tr ? `<div class="ln">🏆 ${srv.tr > 0 ? '+' : ''}${srv.tr}</div>` : ''}${srv.zero ? '<div class="ln"><small>С этой базы недавно уже брали (или там «похожий» аккаунт) — без добычи и кубков</small></div>' : ''}${srv.gone ? '<div class="ln"><small>Базу распустили во время боя — добычу класть некуда</small></div>' : ''}`;
      else lines = off ? `<div class="ln">🧱 ~${num(lootNow(bt))}</div>` : pv ? `<div class="ln">🧱 до ${num(pv.loot)}</div>` : '';
    } else if (bt.kind === 'friendly') lines = '<div class="ln">Дружеский бой — без добычи и кубков</div>';
    else if (bt.kind === 'tut') lines = '<div class="ln">Учебный набег пройден! Теперь — в бой по-настоящему.</div>';
    const st = bt.kind !== 'raid' ? '' : srv?.ok ? '✓ Засчитано сервером' : srv ? '⚠️ ' + why(srv) : '⏳ Засчитываем…';
    const canShare = bt.data.id && (bt.kind === 'replay' || (bt.kind === 'raid' && srv?.ok && !srv.canceled));   // повтор есть у засчитанного набега
    box.innerHTML = `<div class="box"><div class="big">${stars(r.stars)}</div><div class="ln">Разрушено ${r.pct} %${r.th ? ' · штаб пал' : ''}</div>${lines}<div class="srv rdSrv">${st}</div>
      <div class="rd-btns" style="grid-template-columns:repeat(${bt.kind === 'replay' ? 2 : 3},minmax(0,1fr))">${bt.kind !== 'replay' ? '<button type="button" class="rd-b" data-a="replay">🎬 Повтор</button>' : '<button type="button" class="rd-b" data-a="restart">⏮ Ещё раз</button>'}<button type="button" class="rd-b" data-a="hub">🏠 Штаб</button>${bt.kind !== 'replay' ? `<button type="button" class="rd-b pri" data-a="again">${bt.kind === 'tut' ? '🎓 Ещё' : '⚔️ Ещё'}</button>` : ''}</div>
      ${canShare ? '<div class="rd-btns" style="grid-template-columns:1fr"><button type="button" class="rd-b" data-a="share">🔗 Поделиться повтором</button></div>' : ''}</div>`;
    if (bt.kind === 'raid' && srv?.ok) S.st = null;
  }

  // ═══ Журнал, поход, лиги, улучшения, помощь ═══
  function page(title, body, back = 'hub'){
    setHTML(`<div class="rd"><div class="rd-head"><button type="button" class="rd-back" data-a="${back}">← Штаб</button><h2>${title}</h2></div>${body}</div>`);
    S.root.firstChild.addEventListener('click', onPageClick);
  }
  const ago = t => fmtT(sNow() - t) + ' назад';
  function showLog(tab = 'in'){
    if (!S) return;
    S.screen = 'log';
    if (!S.st) return page('🛡️ Защита', `<div class="rd-note">${S.mode === 'guest' ? 'Войди на сайт — тут будет журнал набегов на твою базу.' : S.mode === 'nobase' ? esc(WHY.none) : 'Журнал откроется, когда сайт обновится.'}</div>`);
    lsSet('d37_raid_logseen', Math.floor(sNow()));
    const list = tab === 'in' ? S.st.log : S.st.attacks;
    const bn = o => (o && o.k != null ? MB().baseName(o.k, o.n) : '');
    const rows = list.length ? list.map(x => `<div class="rd-row"><span class="e">${tab === 'in' ? (x.stars ? '⚔️' : '🛡️') : x.mode === 'camp' || x.mode === 'bot' || x.mode === 'tut' ? '🏴‍☠️' : '⚔️'}</span><div class="t"><b>${tab === 'in' ? esc(x.nick) + (bn(x.base) ? ' («' + esc(bn(x.base)) + '»)' : '') + ' напал(а)' : bn(x.base) ? 'На «' + esc(bn(x.base)) + '» · ' + esc(x.who || '') : x.mode === 'camp' ? 'Лагерь ' + x.lvl + ' · ' + esc(x.who || '') : x.mode === 'tut' ? 'Учебный · ' + esc(x.who || '') : 'Разбойники · ' + esc(x.who || '')}</b> · <span class="rd-stars">${stars(x.stars)}</span> ${x.pct} %
        <small>${ago(x.t)}${x.status === 'expired' ? ' · ушёл из боя' : ''} · 🧱 ${tab === 'in' ? '−' : '+'}${num(x.loot)}${x.tr ? ` · 🏆 ${x.tr > 0 ? '+' : ''}${x.tr}` : ''}</small></div>
        <div class="acts">${x.status === 'done' ? `<button type="button" class="rd-b" data-rp="${esc(x.id)}">🎬 Повтор</button>` : ''}${tab === 'in' && x.revenge ? `<button type="button" class="rd-b pri" data-rv="${esc(x.id)}">⚔️ Месть</button>` : ''}</div></div>`).join('')
      : `<div class="rd-note">${tab === 'in' ? 'На базу ещё не нападали. Стройте пушки и вышки — и смотрите здесь повторы набегов.' : 'База ещё не ходила в набеги.'}</div>`;
    page(tab === 'in' ? '🛡️ Защита базы' : '📜 Набеги базы', `<div class="rd-btns" style="grid-template-columns:1fr 1fr;margin-bottom:.6rem"><button type="button" class="rd-b${tab === 'in' ? ' on' : ''}" data-a="log">🛡️ На нас</button><button type="button" class="rd-b${tab === 'out' ? ' on' : ''}" data-a="attacks">📜 Наши</button></div>
      <div class="rd-sub" style="margin-bottom:.5rem">🏆 Защит: ${S.st.stats.def_won} отбито · ${S.st.stats.def_lost} проиграно${S.st.shield > sNow() ? ` · 🛡️ щит ещё ${fmtT(S.st.shield - sNow())}` : ''}</div><div class="rd-list">${rows}</div>`);
  }
  function showCamp(){
    if (!S) return;
    S.screen = 'camp';
    const Rr = R(), camp = S.st?.camp || {};
    const rows = Rr.camp.map((loot, i) => {
      const lv = i + 1, best = camp[lv] || 0, open = lv === 1 || (camp[lv - 1] || 0) >= 1, left = Math.floor(loot * 3 / 3) - Math.floor(loot * best / 3);
      const name = ['Хижина на опушке', 'Лагерь у ручья', 'Мельница', 'Старый мост', 'Каменный двор', 'Форт у оврага', 'Застава', 'Башни у реки', 'Крепость на холме', 'Тайный склад', 'Замок разбойников', 'Цитадель атамана'][i] || 'Лагерь ' + lv;
      return `<div class="rd-row"><span class="e">${open ? '🏴‍☠️' : '🔒'}</span><div class="t"><b>${lv}. ${name}</b> · 🏯 ${Rr.campTh[i]} · <span class="rd-stars">${stars(best)}</span><small>${left > 0 ? `осталось добычи: 🧱 ${num(left)}` : 'добыча собрана — можно для тренировки'}</small></div><div class="acts"><button type="button" class="rd-b${open ? ' pri' : ''}" data-camp="${lv}"${open && S.mode === 'ok' ? '' : ' disabled'}>⚔️</button></div></div>`;
    }).join('');
    page('🏴‍☠️ Поход базы', `<div class="rd-sub" style="margin-bottom:.5rem">Лагеря разбойников: добыча в казну — один раз за каждую новую звезду базы. Нужна армия базы; следующий лагерь откроется после звезды в предыдущем.${S.mode !== 'ok' ? '<br>📝 Откроется, когда ты в базе и сайт обновится.' : ''}</div><div class="rd-list">${rows}</div>`);
  }
  async function showTop(){
    if (!S) return;
    S.screen = 'top';
    const MBx = MB(), Rr = R(), st = S.st;
    const me = st ? MBx.league(st.trophies) : 0;
    const ladder = MBx.LEAGUES.map(([n, e], i) => `<span class="${i === me && st ? 'on' : ''}">${e} ${n}<br><b>${num(Rr.league[i])}+</b><br><small>бонус ${Rr.bonus[i]} 🧱</small></span>`).join('');
    page('🏆 Лиги и топ баз', `<div class="rd-card"><h3>Лиги по кубкам базы</h3><div class="rd-league">${ladder}</div><div class="rd-sub">Победа даёт базе кубки и бонус лиги, поражение — отнимает. «Сундук недели» — за ${Rr.chestWins} победы базы над другими базами за неделю.</div></div>
      <div class="rd-grid" style="margin-top:.7rem"><div class="rd-card"><h3>⭐ Топ недели</h3><div class="rd-list rdTopW"><div class="gm-loading"><div class="spinner"></div></div></div></div><div class="rd-card"><h3>🏆 Все времена</h3><div class="rd-list rdTopA"><div class="gm-loading"><div class="spinner"></div></div></div></div></div>`);
    const [w, a] = await Promise.all([rpc('raid_top', { p_kind: 'week' }), rpc('raid_top', { p_kind: 'all' })]);
    if (!S || S.screen !== 'top') return;
    const fill = (sel, list, f) => { const el = $(sel); if (el) el.innerHTML = Array.isArray(list) && list.length ? list.map((x, i) => `<div class="rd-row"><span class="e">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span><div class="t"><b style="color:${MBx.COLORS[x.color] || 'inherit'}">🏯 ${esc(MBx.baseName(x.name_k, x.name_n))}</b><small>👑 ${esc(x.nick)} · ${MBx.LEAGUES[x.league]?.[1] || ''} ${f(x)}</small></div></div>`).join('') : '<div class="rd-sub">Пока пусто — будьте первыми!</div>'; };
    fill('.rdTopW', w, x => `★ ${x.stars} · побед ${x.wins} · 🏆 ${num(x.tr)}`);
    fill('.rdTopA', a, x => `🏆 ${num(x.tr)}`);
  }
  function showShop(){
    if (!S) return;
    S.screen = 'shop';
    const Sh = R().shop, MBx = MB(), st = S.st, owned = new Set([...(st?.skins || []), ...(st?.base_skins || [])]), gemsOn = !!root.D37Gems?.isOn?.(), lead = st?.rank === 'leader' || st?.rank === 'officer';
    const nextSh = st ? st.shield_buy + Sh.shWeek * 86400 : 0;
    const item = (id, e, n, txt, g, c, extra = '') => `<div class="rd-row"><span class="e">${e}</span><div class="t"><b>${n}</b><small>${txt}</small></div><div class="acts">${extra}${g ? `<button type="button" class="rd-b" data-buy="${id}"${owned.has(id) || !st || !gemsOn ? ' disabled' : ''}>${owned.has(id) ? '✓ есть' : `💎 ${g}`}</button>` : ''}${c ? `<button type="button" class="rd-b" data-buy="${id}"${owned.has(id) || !st ? ' disabled' : ''}>${owned.has(id) ? '✓ есть' : `🪙 ${num(c)}`}</button>` : ''}</div></div>`;
    const skins = Object.entries(Sh.skin).map(([k, p]) => item('skin:' + k, MBx.SKINS[k].e, `Облик базы «${MBx.SKINS[k].n}»`, 'Цвет всех построек базы — в мире и в бою. Покупка — в подарок базе; надевают главарь и офицеры. Только красота, сила не меняется.', p.g, p.c, owned.has('skin:' + k) && lead ? `<button type="button" class="rd-b${st?.skin === k ? ' on' : ''}" data-skin="skin:${st?.skin === k ? '' : k}">${st?.skin === k ? 'надет' : 'надеть'}</button>` : '')).join('');
    const army2 = Object.entries(Sh.army).map(([k, p]) => item('army:' + k, k === 'knight' ? '🛡️' : '🤖', `Облик армии «${k === 'knight' ? 'Рыцари' : 'Роботы'}»`, 'Отряды в доспехах — видно в бою и в повторах у защитника.', p.g, p.c, owned.has('army:' + k) ? `<button type="button" class="rd-b${st?.army_skin === k ? ' on' : ''}" data-skin="army:${st?.army_skin === k ? '' : k}">${st?.army_skin === k ? 'надет' : 'надеть'}</button>` : '')).join('');
    page('💎 Улучшения', `${!st ? '<div class="rd-note">Откроется после входа и обновления сайта.</div>' : ''}
      <div class="rd-sub" style="margin-bottom:.5rem">Честно: кристаллы экономят время и дают красоту. Кубки, звёзды, кирпичи и силу армии не продаём — вторая казарма строится со штаба 3 (кирпичами). ${gemsOn ? `💎 ${num(root.D37Gems.balance())} · <a href="#/shop">купить кристаллы</a>` : ''}</div>
      <div class="rd-list">
        ${item('sh1', '🛡️', `Щит базы на ${Sh.sh1.h} ч`, `Отдых от набегов для всей базы. Не чаще раза в ${Sh.shWeek} дней${nextSh > sNow() ? ` (следующий — через ${fmtT(nextSh - sNow())})` : ''}.`, Sh.sh1.g, 0)}
        ${item('sh2', '🛡️', `Щит базы на ${Sh.sh2.h} ч`, `Не дольше ${Sh.shMax} ч всего.`, Sh.sh2.g, 0)}
        ${skins}${army2}
      </div><div class="rd-sub">Дотренировать армию сразу — в казарме (🪙 или 💎). Достроить сразу — в мире, у постройки (🪙).</div>`);
  }
  function showHelp(first){
    if (!S) return;
    S.screen = 'help';
    const Rr = R();
    page('❓ Как играть', `<div class="rd-card rd-help"><ol>
      <li><b>Военная база</b> — в Боевой зоне «Мира Денчика» (12+): основай свою у таблички свободного участка или вступи в базу друга по ссылке. Главарь и офицеры строят, бойцы помогают кирпичами.</li>
      <li><b>Стройте оборону</b>: 🗼 вышки с лучниками, 💥 пушки, 🎯 мортиры, ловушки 💣 и 🎇, стены — они держат удар.</li>
      <li><b>Казарма</b> ⚔️ тренирует армию базы — даже когда никого нет. Выше уровень — больше места и новые отряды; вторая казарма (штаб 3) — вдвое быстрее.</li>
      <li><b>⚔️ В бой!</b> — сервер подберёт базу по штабу и кубкам. 30 секунд разведки, потом 3 минуты боя. Армию ведут главарь и офицеры (главарь может разрешить всем).</li>
      <li><b>Высаживай</b> отряды на зелёной полосе у края — нажатием или ведя пальцем. Герой 🦸 — твой персонаж, у него «💥 Удар».</li>
      <li><b>Звёзды</b>: ★ за 50 % построек, ★ за штаб, ★ за всё. Победа — кирпичи 🧱 в казну и кубки 🏆 базе, поражение — минус кубки.</li>
      <li><b>Защита</b>: после сильного набега — щит базе (${Rr.shield.s2}–${Rr.shield.s3} ч). Смотрите повтор и мстите!</li>
      <li>Нападаете на базу — свой щит снимается. Первые ${Rr.shield.newbie} дня на новые базы не нападают.</li></ol>
      <p class="rd-sub">Монеты из кошелька в набегах не отнимают никогда — только кирпичи казны базы, и то не все: часть защищают штаб и склады.</p>
      <div class="rd-btns" style="grid-template-columns:1fr 1fr"><button type="button" class="rd-b pri" data-a="tut">🎓 Учебный набег</button><button type="button" class="rd-b" data-a="hub">${first ? 'Понятно!' : '← Штаб'}</button></div></div>`);
  }
  async function onPageClick(e){
    const el = e.target.closest('[data-a],[data-rp],[data-rv],[data-camp],[data-buy],[data-skin],[data-join]'); if (!el || !S) return;
    if (el.dataset.rp) return openReplay(el.dataset.rp);
    if (el.dataset.rv) return findBattle(el, 'revenge', el.dataset.rv);
    if (el.dataset.camp) return findBattle(el, 'camp', el.dataset.camp);
    if (el.dataset.join) { el.disabled = true; const r = await rpc('war_join', { p_code: el.dataset.join }); toast(r?.ok ? `🏯 Ты в базе «${baseTitle(r)}» — добро пожаловать!` : why(r)); try { root.dispatchEvent(new CustomEvent('d37:base')); } catch (er) {} if (!r?.ok) { el.disabled = false; return; } S.param = null; await refresh(); return showHub(); }
    if (el.dataset.skin != null) { const [kind, id] = el.dataset.skin.split(':'); el.disabled = true; const r = await rpc('raid_skin', { p_kind: kind, p_id: id || '' }); toast(r?.ok ? '✓ Готово' : why(r)); await loadAll(); try { root.dispatchEvent(new CustomEvent('d37:base')); } catch (er) {} return showShop(); }
    if (el.dataset.buy) {
      const id = el.dataset.buy, g = /^(sh1|sh2|skin|army)/.test(id) && !(R().shop.skin[id.split(':')[1]]?.c);
      if (!(await ask({ icon: g ? '💎' : '🪙', title: 'Купить?', text: el.closest('.rd-row').querySelector('b').textContent + ' — ' + el.textContent.trim(), yes: 'Купить' }))) return;
      el.disabled = true;
      const r = await rpc('raid_buy', { p_item: id });
      toast(r?.ok ? '✓ Куплено' : why(r));
      root.D37Gems?.sync?.(); root.D37Coins?.sync?.();
      await loadAll();
      try { root.dispatchEvent(new CustomEvent('d37:base')); } catch (er) {}
      return showShop();
    }
    const a = el.dataset.a;
    if (a === 'hub') { await refresh(); return showHub(); }
    if (a === 'log') return showLog('in');
    if (a === 'attacks') return showLog('out');
    if (a === 'tut') return startTut();
    if (a === 'login') { if (typeof openGlobalAuth === 'function') openGlobalAuth(); }
  }

  root.GAME_IMPL = root.GAME_IMPL || {};
  root.GAME_IMPL.raid = { mount, unmount, _test: { state: () => S, makeView, layoutBs, gridOf, newBattle, lootNow, LOOKS, input, endBattle, showHub, showJoin, WHY, drawScene, draw, events, applyIn } };
})();
