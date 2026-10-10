// ═══════════════════════════════════════
//  ИГРА «БАШНИ» — защита замка (Tower Defense). Одиночная, «⚔️ Битва» и «🤝 Вместе»
// ═══════════════════════════════════════
// Монстры идут по дороге к замку, ты ставишь башни на клетки рядом (тап по клетке → выбор башни,
// тап по башне → улучшить / продать). 20 волн, на 10-й и 20-й — боссы. Дошёл монстр до замка — минус жизнь.
// Броню 🐢 и 🐉 пробивают только ⚡ Молния и 🎯 Снайпер. Монеты 🪙 за волны → кошелёк сайта (js/core/coins.js).
// Реклама за награду (если есть блок): раз за игру «+100 золота» и «Продолжить: +10 жизней».
// «⚔️ Битва» (versus.js): у каждого своя карта и одинаковые волны; за золото отправляешь монстров сопернику.
// «🤝 Вместе» (#/games/td/coop/<код>): одна карта на двоих, у каждого своё золото. Мир считают ОБА одинаково
// (детерминированная симуляция, шаг 1/30 с): по сети идут только команды «построить/улучшить/продать» с
// номером шага, когда их выполнить (через 10 шагов), и отметки «я на шаге N». Раз в 3 с — сверка
// контрольных сумм; разошлись — хозяин присылает весь мир целиком.
// Ключи сервера: td / td_duel / td_coop (games-more.sql). Победа для XP — пройти все 20 волн.
(() => {
  const TICK = 1 / 30, COLS = 9, ROWS = 13, LAST = 20, LAG = 10, TAU = Math.PI * 2;
  const EF = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

  // ── Карты: точки дороги (клетки), последняя — замок ──
  const MAPS = [
    { id: 'meadow', name: 'Поляна', e: '🌳', pts: [[1, -1], [1, 2], [7, 2], [7, 5], [1, 5], [1, 8], [7, 8], [7, 11], [4, 11], [4, 12]] },
    { id: 'zigzag', name: 'Зигзаг', e: '⚡', pts: [[4, -1], [4, 1], [1, 1], [1, 4], [7, 4], [7, 7], [1, 7], [1, 10], [7, 10], [7, 12]] },
    { id: 'spiral', name: 'Спираль', e: '🌀', pts: [[0, -1], [0, 10], [8, 10], [8, 2], [3, 2], [3, 7], [6, 7], [6, 5]] },
  ];
  const PATHS = {};
  function path(id){
    if (PATHS[id]) return PATHS[id];
    const m = MAPS.find(x => x.id === id) || MAPS[0];
    const pts = m.pts.map(([x, y]) => [x + .5, y + .5]), segs = [], cells = new Set();
    let L = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], len = Math.abs(x1 - x0) + Math.abs(y1 - y0);
      segs.push({ x0, y0, x1, y1, len, cum: L });
      L += len;
      const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
      for (let k = 0; k <= len; k++) cells.add(`${Math.floor(x0 + sx * k)},${Math.floor(y0 + sy * k)}`);
    }
    return (PATHS[id] = { pts, segs, L, cells, castle: m.pts[m.pts.length - 1] });
  }
  function posAt(P, s){
    for (const g of P.segs) if (s <= g.cum + g.len) { const k = (s - g.cum) / g.len; return [g.x0 + (g.x1 - g.x0) * k, g.y0 + (g.y1 - g.y0) * k]; }
    const g = P.segs[P.segs.length - 1];
    return [g.x1, g.y1];
  }

  // ── Башни: цена, улучшения [ур.2, ур.3], по уровням: урон, перезарядка, радиус (клетки) ──
  const TOWERS = {
    arrow:  { e: '🏹', name: 'Лучник',  cost: 50,  up: [40, 80],   dmg: [6, 10, 16],  rate: [.55, .48, .4], range: [2.6, 2.8, 3],   text: 'Быстро стреляет по одному. Дёшево.', c: '#22c55e' },
    cannon: { e: '💣', name: 'Пушка',   cost: 100, up: [80, 150],  dmg: [18, 30, 50], rate: [1.5, 1.4, 1.25], range: [2.3, 2.4, 2.6], splash: [.9, 1.05, 1.25], text: 'Бьёт по площади — против толпы.', c: '#f97316' },
    frost:  { e: '❄️', name: 'Мороз',   cost: 80,  up: [60, 120],  dmg: [2, 4, 7],    rate: [.8, .7, .6],  range: [2, 2.2, 2.4],   slow: [.4, .5, .6], text: 'Замедляет всех вокруг.', c: '#38bdf8' },
    tesla:  { e: '⚡', name: 'Молния',  cost: 150, up: [110, 200], dmg: [14, 22, 34], rate: [1.1, 1, .85], range: [2.4, 2.6, 2.8], chain: [3, 4, 6], text: 'Цепь по нескольким. Пробивает броню.', c: '#facc15' },
    sniper: { e: '🎯', name: 'Снайпер', cost: 120, up: [100, 180], dmg: [40, 70, 120], rate: [2, 1.8, 1.5], range: [4.5, 5, 5.5],  text: 'Далеко и больно. Пробивает броню.', c: '#a78bfa' },
  };
  const TKEYS = Object.keys(TOWERS);
  // ── Монстры: здоровье, скорость (клеток/с), золото, броня, сколько жизней снимает ──
  const FOES = {
    rat:    { e: '🐀', hp: 18,   spd: 2.2,  gold: 3 },
    zombie: { e: '🧟', hp: 40,   spd: 1.4,  gold: 5 },
    bat:    { e: '🦇', hp: 26,   spd: 2.6,  gold: 4 },
    turtle: { e: '🐢', hp: 90,   spd: 1,    gold: 8,  armor: 4 },
    ghost:  { e: '👻', hp: 60,   spd: 1.8,  gold: 7 },
    ogre:   { e: '👹', hp: 230,  spd: 1.05, gold: 15, lives: 2 },
    boss:   { e: '🐲', hp: 700,  spd: .85,  gold: 100, armor: 3, lives: 5 },
    king:   { e: '🐉', hp: 1400, spd: .75,  gold: 200, armor: 5, lives: 10 },
  };
  const FKEYS = Object.keys(FOES);
  // «Битва»: что можно отправить сопернику
  const SENDS = [{ ty: 'rat', n: 6, cost: 40 }, { ty: 'ghost', n: 3, cost: 70 }, { ty: 'turtle', n: 2, cost: 90 }, { ty: 'ogre', n: 1, cost: 130 }];

  function waveList(n){
    if (n === LAST) return [{ ty: 'king', n: 1, gap: 1 }, { ty: 'ogre', n: 3, gap: 3 }, { ty: 'bat', n: 14, gap: .45 }];
    if (n === 10) return [{ ty: 'boss', n: 1, gap: 1 }, { ty: 'zombie', n: 10, gap: .7 }];
    if (n % 5 === 0) return [{ ty: 'ogre', n: Math.floor(n / 5) + 1, gap: 2.4 }, { ty: 'rat', n: 6 + n, gap: .45 }];
    const pool = n < 3 ? ['rat', 'zombie'] : n < 6 ? ['zombie', 'rat', 'bat'] : n < 10 ? ['zombie', 'bat', 'turtle'] : n < 15 ? ['bat', 'turtle', 'ghost', 'ogre'] : ['turtle', 'ghost', 'ogre', 'bat'];
    const a = pool[n % pool.length], c = pool[(n + 1) % pool.length];
    return [{ ty: a, n: 6 + Math.floor(n * 1.3), gap: a === 'rat' || a === 'bat' ? .55 : .9 }, { ty: c, n: 3 + Math.floor(n * .7), gap: 1 }];
  }
  const waveHp = n => 1 + (n - 1) * .16 + (n > 10 ? (n - 10) * .1 : 0);
  const score = S => S.wave * 100 + S.lives * 5 + S.kills + (S.won ? 1000 : 0);

  // ═══ СИМУЛЯЦИЯ (детерминированная: только сложение/умножение/sqrt, без Math.random) ═══
  // o: { map, players: 1 | 2, hpMul }
  function newSim(o){
    const n = o.players === 2 ? 2 : 1;
    return { map: path(o.map).segs ? o.map : 'meadow', tick: 0, lives: 20, gold: n === 2 ? [150, 150] : [200], wave: 0, waveT: 10, live: false,
      q: [], en: [], tw: [], pr: [], fx: [], eid: 0, tid: 0, kills: 0, leak: 0, over: false, won: false, speed: 1, hpMul: o.hpMul || 1, n };
  }
  function startWave(S){
    S.wave++; S.live = true; S.waveT = 0;
    let at = S.tick + 6;
    for (const g of waveList(S.wave)) {
      for (let i = 0; i < g.n; i++) S.q.push({ ty: g.ty, at: Math.round(at + i * g.gap / TICK), hp: waveHp(S.wave) * S.hpMul });
      at += Math.round(g.n * g.gap / TICK) + 15;
    }
  }
  // Монстры от соперника («Битва») — сразу у входа, по одному в 0,4 с
  function addSend(S, ty, n){
    if (!FOES[ty]) return;
    const base = Math.max(S.tick, ...S.q.filter(q => q.sent).map(q => q.at)) + 6;
    for (let i = 0; i < Math.min(n, 12); i++) S.q.push({ ty, at: base + i * 12, hp: waveHp(Math.max(1, S.wave)) * S.hpMul, sent: true });
  }
  function spawn(S, q){ const F = FOES[q.ty]; S.en.push({ id: ++S.eid, ty: q.ty, s: 0, ps: 0, hp: F.hp * q.hp, max: F.hp * q.hp, slowT: 0, slowK: 1, dead: false, sent: !!q.sent }); }
  function award(S, gold){
    if (S.n === 2) { const g = Math.ceil(gold * .6); S.gold[0] += g; S.gold[1] += g; } else S.gold[0] += gold;
  }
  function hurt(S, e, d, pierce){
    if (e.dead) return;
    const real = pierce ? d : Math.max(1, d - (FOES[e.ty].armor || 0));
    e.hp -= real;
    if (e.hp <= 0) { e.dead = true; S.kills++; award(S, FOES[e.ty].gold); S.fx.push({ k: 'pop', s: e.s, t: .35, T: .35, g: FOES[e.ty].gold }); }
  }
  function tick(S){
    S.tick++;
    const P = path(S.map);
    if (!S.over && S.waveT > 0 && S.wave < LAST) { S.waveT -= TICK; if (S.waveT <= 0) startWave(S); }
    // появление
    let j = 0;
    for (const q of S.q) { if (q.at <= S.tick) spawn(S, q); else S.q[j++] = q; }
    S.q.length = j;
    // монстры
    for (const e of S.en) {
      if (e.dead) continue;
      e.ps = e.s;
      if (e.slowT > 0) { e.slowT -= TICK; if (e.slowT <= 0) e.slowK = 1; }
      e.s += FOES[e.ty].spd * e.slowK * TICK;
      if (e.s >= P.L) { e.dead = true; S.lives -= FOES[e.ty].lives || 1; S.leak++; S.fx.push({ k: 'leak', t: .5, T: .5 }); }
    }
    // башни
    for (const t of S.tw) { t.cd -= TICK; if (t.cd <= 0) fire(S, P, t); }
    // снаряды
    for (const b of S.pr) {
      if (b.dead) continue;
      const tg = S.en.find(e => e.id === b.tid && !e.dead);
      if (tg) { const [x, y] = posAt(P, tg.s); b.tx = x; b.ty = y; }
      const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.sqrt(dx * dx + dy * dy), st = b.spd * TICK;
      if (d <= st) {
        b.dead = true;
        if (b.splash) {
          for (const e of S.en) { if (e.dead) continue; const [x, y] = posAt(P, e.s), dx2 = x - b.tx, dy2 = y - b.ty; if (dx2 * dx2 + dy2 * dy2 <= b.splash * b.splash) hurt(S, e, b.dmg, false); }
          S.fx.push({ k: 'boom', x: b.tx, y: b.ty, r: b.splash, t: .3, T: .3 });
        } else if (tg) hurt(S, tg, b.dmg, false);
      } else { b.x += dx / d * st; b.y += dy / d * st; }
    }
    S.en = S.en.filter(e => !e.dead);
    S.pr = S.pr.filter(b => !b.dead);
    for (const f of S.fx) f.t -= TICK;
    S.fx = S.fx.filter(f => f.t > 0);
    if (S.live && !S.q.length && !S.en.length) {
      S.live = false;
      award(S, 20 + S.wave * 2);
      if (S.lives > 0 && S.wave >= LAST) { S.won = true; S.over = true; } else S.waveT = 5;
    }
    if (S.lives <= 0 && !S.won) { S.lives = 0; S.over = true; }
  }
  function fire(S, P, t){
    const T = TOWERS[t.ty], lv = t.lvl - 1, R = T.range[lv], R2 = R * R, tx = t.x + .5, ty = t.y + .5;
    const inR = e => { const [x, y] = posAt(P, e.s), dx = x - tx, dy = y - ty; return dx * dx + dy * dy <= R2; };
    if (t.ty === 'frost') {
      let hit = false;
      for (const e of S.en) if (!e.dead && inR(e)) { e.slowT = 1.2; e.slowK = Math.min(e.slowK, 1 - T.slow[lv]); hurt(S, e, T.dmg[lv], false); hit = true; }
      if (hit) { t.cd = T.rate[lv]; S.fx.push({ k: 'frost', x: tx, y: ty, r: R, t: .3, T: .3 }); } else t.cd = .1;
      return;
    }
    let tg = null;
    for (const e of S.en) if (!e.dead && inR(e) && (!tg || e.s > tg.s)) tg = e;
    if (!tg) { t.cd = .1; return; }
    t.cd = T.rate[lv];
    const [ex, ey] = posAt(P, tg.s);
    t.aim = Math.atan2(ey - ty, ex - tx);
    if (t.ty === 'arrow') S.pr.push({ k: 'arrow', x: tx, y: ty, tx: ex, ty: ey, tid: tg.id, spd: 10, dmg: T.dmg[lv], splash: 0, dead: false });
    else if (t.ty === 'cannon') S.pr.push({ k: 'ball', x: tx, y: ty, tx: ex, ty: ey, tid: tg.id, spd: 6, dmg: T.dmg[lv], splash: T.splash[lv], dead: false });
    else if (t.ty === 'sniper') { hurt(S, tg, T.dmg[lv], true); S.fx.push({ k: 'line', x: tx, y: ty, x2: ex, y2: ey, c: '#c4b5fd', t: .18, T: .18 }); }
    else if (t.ty === 'tesla') {
      const hit = [tg];
      let cur = tg, d = T.dmg[lv];
      const pts = [tx, ty, ex, ey];
      hurt(S, tg, d, true);
      for (let i = 1; i < T.chain[lv]; i++) {
        const [cx, cy] = posAt(P, cur.s);
        let nx = null, bd = 2.6;
        for (const e of S.en) { if (e.dead || hit.includes(e)) continue; const [x, y] = posAt(P, e.s), dx = x - cx, dy = y - cy, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; nx = e; } }
        if (!nx) break;
        hit.push(nx); d *= .85; hurt(S, nx, d, true);
        const [x, y] = posAt(P, nx.s); pts.push(x, y);
        cur = nx;
      }
      S.fx.push({ k: 'zap', pts, t: .22, T: .22 });
    }
  }
  // ── Команды (и в одиночной, и во «Вместе» — одинаково) ──
  function canBuild(S, x, y){ return x >= 0 && x < COLS && y >= 0 && y < ROWS && !path(S.map).cells.has(`${x},${y}`) && !S.tw.some(t => t.x === x && t.y === y); }
  function command(S, c){
    const p = c.p || 0;
    if (c.c === 'build') {
      const T = TOWERS[c.ty];
      if (!T || !canBuild(S, c.x, c.y) || S.gold[p] < T.cost) return false;
      S.gold[p] -= T.cost;
      S.tw.push({ id: ++S.tid, x: c.x, y: c.y, ty: c.ty, lvl: 1, cd: 0, spent: T.cost, p, aim: -Math.PI / 2 });
      return true;
    }
    const t = S.tw.find(x => x.id === c.id);
    if (c.c === 'up') {
      if (!t || t.p !== p || t.lvl >= 3) return false;
      const cost = TOWERS[t.ty].up[t.lvl - 1];
      if (S.gold[p] < cost) return false;
      S.gold[p] -= cost; t.spent += cost; t.lvl++;
      return true;
    }
    if (c.c === 'sell') {
      if (!t || t.p !== p) return false;
      S.gold[p] += Math.floor(t.spent * .6);
      S.tw = S.tw.filter(x => x !== t);
      return true;
    }
    if (c.c === 'next') {
      if (S.over || S.wave >= LAST || S.waveT <= 0) return false;
      award(S, Math.ceil(S.waveT * 3));
      startWave(S);
      return true;
    }
    if (c.c === 'speed') { S.speed = [1, 2, 3].includes(c.v) ? c.v : 1; return true; }
    if (c.c === 'gold') { S.gold[p] += c.v; return true; }      // награда за рекламу
    if (c.c === 'lives') { S.lives += c.v; S.over = false; return true; }   // «продолжить»
    return false;
  }
  // Контрольная сумма для сверки во «Вместе»
  function hash(S){
    let h = S.tick * 31 + S.lives * 1009 + S.kills * 7 + S.gold.reduce((a, b) => a + b, 0) * 13 + S.tw.length * 101 + S.wave * 997;
    for (const e of S.en) h = (h * 33 + Math.round(e.s * 100) + Math.round(e.hp)) | 0;
    return h | 0;
  }

  // ═══ ЭКРАН ═══
  let root, api, wrap, cv, ctx, bar, panel, ov, S = null, raf = 0, last = 0, acc = 0, mode = 'menu', hooks = null, stopDuel = null;
  let dpr = 1, cell = 40, bx = 0, by = 0, sel = null, hover = null, mapId = 'meadow', runId = '', adGold = false, adCont = false, contUsed = false, look = null;
  let MP = null;   // «Вместе»: { room, np, host, me, peer, pend: [], seq, remoteT, hashes, ... }
  const C = () => window.D37Coins, CH = () => window.D37Char;
  const num = n => Math.round(n).toLocaleString('ru');
  const sprites = new Map();
  function spr(e, px){
    px = Math.max(6, Math.round(px));
    const key = e + '|' + px;
    let c = sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    const s = Math.ceil(px * 1.3);
    c.width = c.height = s;
    const x = c.getContext('2d');
    x.font = `${px}px ${EF}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(e, s / 2, s / 2 + px * .05);
    sprites.set(key, c);
    return c;
  }
  const me = () => MP ? MP.me : 0;

  function build(el){
    el.innerHTML = `<div class="td">
        <div class="td-bar"></div>
        <div class="td-wrap"><canvas class="td-cv"></canvas><div class="td-ov" hidden></div></div>
        <div class="td-panel"></div>
      </div>`;
    wrap = el.querySelector('.td-wrap'); cv = el.querySelector('.td-cv'); ctx = cv.getContext('2d');
    bar = el.querySelector('.td-bar'); panel = el.querySelector('.td-panel'); ov = el.querySelector('.td-ov');
    cv.addEventListener('pointerdown', onTap);
    cv.addEventListener('pointermove', e => { const c = cellAt(e); hover = c; });
    cv.addEventListener('pointerleave', () => { hover = null; });
    el.querySelector('.td').addEventListener('click', onClick);
    look = CH()?.look() || null;
    resize();
  }
  function resize(){
    if (!cv) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = wrap.clientWidth || 360;
    const maxH = Math.max(380, window.innerHeight - 230);
    cell = Math.floor(Math.min(w / COLS, maxH / ROWS));
    const W = cell * COLS, H = cell * ROWS;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    sprites.clear();
    draw();
  }
  function cellAt(e){
    const r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / cell), y = Math.floor((e.clientY - r.top) / cell);
    return x >= 0 && x < COLS && y >= 0 && y < ROWS ? { x, y } : null;
  }
  function showOv(html){ ov.innerHTML = html; ov.hidden = false; }
  function hideOv(){ ov.hidden = true; ov.innerHTML = ''; }

  // ── Ввод: тап по клетке / башне ──
  function onTap(e){
    if (!S || mode !== 'run') return;
    const c = cellAt(e);
    if (!c) return;
    const t = S.tw.find(x => x.x === c.x && x.y === c.y);
    if (t) sel = { tw: t.id };
    else if (canBuild(S, c.x, c.y)) sel = { x: c.x, y: c.y };
    else sel = null;
    renderPanel();
    e.preventDefault();
  }
  function issue(c){
    c.p = me();
    if (MP) { const at = S.tick + LAG; MP.seq++; const m = { type: 'cmd', at, c, s: MP.seq, p: me() }; MP.np.send(m); MP.pend.push(m); return true; }
    const ok = command(S, c);
    return ok;
  }
  function onClick(e){
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a.startsWith('build:')) { if (sel && 'x' in sel) { if (issue({ c: 'build', x: sel.x, y: sel.y, ty: a.slice(6) })) api.sfx('move'); sel = null; renderPanel(); } return; }
    if (a === 'up') { if (sel?.tw && issue({ c: 'up', id: sel.tw })) api.sfx('ok'); renderPanel(); return; }
    if (a === 'sell') { if (sel?.tw && issue({ c: 'sell', id: sel.tw })) api.sfx('tick'); sel = null; renderPanel(); return; }
    if (a === 'close') { sel = null; renderPanel(); return; }
    if (a === 'next') { issue({ c: 'next' }); return; }
    if (a === 'speed') { if (!MP || MP.host) issue({ c: 'speed', v: S.speed === 3 ? 1 : S.speed + 1 }); return; }
    if (a.startsWith('send:')) { sendFoes(+a.slice(5)); return; }
    if (a === 'adgold') { adBonus(b); return; }
    if (a.startsWith('map:')) { mapId = a.slice(4); try { localStorage.setItem('d37_td_map', mapId); } catch (err) {} menu(); return; }
    if (a === 'play') { play({ map: mapId }); return; }
    if (a === 'duel') { location.hash = '#/games/td/' + GameRoom.newCode(); return; }
    if (a === 'coop') { location.hash = '#/games/td/coop/' + GameRoom.newCode(); return; }
    if (a === 'again') { againSolo(b); return; }
    if (a === 'menu') { menu(); return; }
    if (a === 'cont-ad') { cont('ad'); return; }
    if (a === 'cont-coins') { cont('coins'); return; }
    if (a === 'end') { finish(true); return; }
    if (a === 'share') { share(b); return; }
    if (a === 'duel-go') { play({ map: MP_DUEL.map, duel: true }); return; }
    if (a === 'co-go') { coopGo(); return; }
    if (a === 'co-copy') { const inp = ov.querySelector('input'); navigator.clipboard?.writeText(inp.value).then(() => { b.textContent = '✅ Скопировано'; }, () => inp.select()); return; }
  }

  // ── Верхняя полоса и нижняя панель ──
  function renderBar(){
    if (!S) { bar.innerHTML = ''; return; }
    const g = S.gold[me()];
    const nextBtn = !S.over && S.wave < LAST && S.waveT > 0 ? `<button type="button" class="td-b go" data-act="next">▶ Волна ${S.wave + 1}${S.wave ? ` · +${Math.ceil(S.waveT * 3)}💰` : ''}</button>` : '';
    bar.innerHTML = `<span class="td-st">❤️ <b>${S.lives}</b></span><span class="td-st gold">💰 <b>${num(g)}</b></span>${MP ? `<span class="td-st mate">🤝 ${num(S.gold[1 - me()])}</span>` : ''}<span class="td-st">🌊 <b>${S.wave}</b>/${LAST}</span>
      <span class="td-sp"></span>${nextBtn}<button type="button" class="td-b" data-act="speed"${MP && !MP.host ? ' disabled' : ''}>⏩ ×${S.speed}</button>`;
  }
  function renderPanel(){
    if (!S || mode !== 'run') { panel.innerHTML = ''; return; }
    const g = S.gold[me()];
    let html = '';
    if (sel && 'x' in sel) {
      html = `<div class="td-pt">Новая башня:</div><div class="td-builds">${TKEYS.map(k => { const T = TOWERS[k]; return `<button type="button" class="td-bt" data-act="build:${k}"${g < T.cost ? ' disabled' : ''}><span class="ic">${T.e}</span><b>${T.name}</b><i>💰 ${T.cost}</i><small>${T.text}</small></button>`; }).join('')}</div>
        <button type="button" class="td-x" data-act="close">✕</button>`;
    } else if (sel?.tw) {
      const t = S.tw.find(x => x.id === sel.tw);
      if (!t) { sel = null; return renderPanel(); }
      const T = TOWERS[t.ty], lv = t.lvl - 1, mine = t.p === me();
      const upCost = t.lvl < 3 ? T.up[t.lvl - 1] : 0;
      html = `<div class="td-ti"><span class="ic">${T.e}</span><div><b>${T.name} · ур. ${t.lvl}</b><small>Урон ${T.dmg[lv]}${T.splash ? ' по площади' : ''}${T.chain ? ` · цепь ×${T.chain[lv]}` : ''}${T.slow ? ` · замедление ${Math.round(T.slow[lv] * 100)}%` : ''} · радиус ${T.range[lv]}</small>${mine ? '' : '<small>Башня напарника</small>'}</div></div>
        ${mine ? `<div class="td-acts">${t.lvl < 3 ? `<button type="button" class="td-b go" data-act="up"${g < upCost ? ' disabled' : ''}>⬆ Улучшить · 💰 ${upCost}</button>` : '<span class="td-max">Максимум</span>'}<button type="button" class="td-b" data-act="sell">Продать · +${Math.floor(t.spent * .6)}💰</button></div>` : ''}
        <button type="button" class="td-x" data-act="close">✕</button>`;
    } else if (hooks) {
      html = `<div class="td-pt">⚔️ Отправить монстров сопернику:</div><div class="td-sends">${SENDS.map((s, i) => `<button type="button" class="td-b" data-act="send:${i}"${g < s.cost ? ' disabled' : ''}>${FOES[s.ty].e}×${s.n} · 💰 ${s.cost}</button>`).join('')}</div>`;
    } else {
      const ad = !MP && !adGold && S.wave >= 2 && !!window.D37Ads?.rewardReady?.();
      html = `<div class="td-hint">Нажми на свободную клетку — поставишь башню. На башню — улучшить или продать.${MP ? ' Цветное кольцо — чья башня.' : ''}</div>${ad ? '<button type="button" class="td-b gold" data-act="adgold">📺 Реклама → +100 💰</button>' : ''}`;
    }
    panel.innerHTML = html;
  }

  // ── Цикл ──
  function startLoop(){ if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  let barAt = 0, tipArmor = false;
  function frame(now){
    raf = 0;
    if (!S || !cv) return;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > .1) dt = .1;
    if (mode === 'run') {
      acc += dt * S.speed;
      let n = 0;
      while (acc >= TICK && n < 12) {
        if (MP && !coopCanTick()) { acc = Math.min(acc, TICK); break; }
        if (MP) coopBeforeTick();
        tick(S);
        acc -= TICK; n++;
        if (MP) coopAfterTick();
        if (S.over) break;
      }
      if (n >= 12) acc = 0;
      if (now - barAt > 200) {
        barAt = now; renderBar(); if (sel || hooks) renderPanelLight(); if (hooks) hooks.progress(score(S));
        if (!tipArmor && S.en.some(e => FOES[e.ty].armor)) { tipArmor = true; api.toast('🛡️ У них броня! Её пробивают ⚡ Молния и 🎯 Снайпер'); }
      }
      if (S.over) { onOver(); }
    }
    draw(now);
    if (mode === 'run') raf = requestAnimationFrame(frame);
  }
  // Кнопки панели: только доступность по золоту (чтобы не мигала разметка)
  function renderPanelLight(){
    const g = S.gold[me()];
    panel.querySelectorAll('[data-act^="build:"]').forEach(b => { b.disabled = g < TOWERS[b.dataset.act.slice(6)].cost; });
    panel.querySelectorAll('[data-act^="send:"]').forEach(b => { b.disabled = g < SENDS[+b.dataset.act.slice(5)].cost; });
    const up = panel.querySelector('[data-act="up"]');
    if (up && sel?.tw) { const t = S.tw.find(x => x.id === sel.tw); if (t && t.lvl < 3) up.disabled = g < TOWERS[t.ty].up[t.lvl - 1]; }
  }

  // ── Рисование ──
  function draw(now){
    if (!ctx || !cv) return;
    const k = cell * dpr, W = cv.width, H = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1d2a1a'; ctx.fillRect(0, 0, W, H);
    const P = path(S ? S.map : mapId);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const road = P.cells.has(`${x},${y}`);
      ctx.fillStyle = road ? ((x + y) % 2 ? '#6b5636' : '#735c3a') : ((x + y) % 2 ? '#24361f' : '#273b22');
      ctx.fillRect(x * k, y * k, k, k);
    }
    // дорога — линия посередине
    ctx.strokeStyle = 'rgba(255,230,180,.12)'; ctx.lineWidth = k * .5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); P.pts.forEach(([x, y], i) => i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, Math.max(0, y) * k)); ctx.stroke();
    // замок и мой персонаж у ворот
    const [cxC, cyC] = P.castle;
    ctx.drawImage(spr('🏰', k * .95), (cxC + .5) * k - spr('🏰', k * .95).width / 2, (cyC + .5) * k - spr('🏰', k * .95).height / 2);
    if (CH() && look) { const sp = CH().sprite(look, k * .7, { noPet: true, t: (now || 0) / 1000 }); const sx = cxC + (cxC > 4 ? -.6 : 1.6), sy = cyC + .95; ctx.drawImage(sp.c, sx * k - sp.ax, sy * k - sp.ay); }
    if (!S) return;
    // подсветка клетки
    const hl = sel && 'x' in sel ? sel : hover && mode === 'run' && canBuild(S, hover.x, hover.y) ? hover : null;
    if (hl) { ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(hl.x * k, hl.y * k, k, k); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2 * dpr; ctx.strokeRect(hl.x * k + 1, hl.y * k + 1, k - 2, k - 2); }
    // башни
    for (const t of S.tw) {
      const T = TOWERS[t.ty], X = (t.x + .5) * k, Y = (t.y + .5) * k;
      if (sel?.tw === t.id) { ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(X, Y, T.range[t.lvl - 1] * k, 0, TAU); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(X, Y + k * .06, k * .42, 0, TAU); ctx.fill();
      ctx.fillStyle = T.c; ctx.globalAlpha = .9; ctx.beginPath(); ctx.arc(X, Y, k * .4, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      if (MP) { ctx.strokeStyle = t.p === 0 ? '#ff4d6d' : '#38bdf8'; ctx.lineWidth = 3 * dpr; ctx.beginPath(); ctx.arc(X, Y, k * .42, 0, TAU); ctx.stroke(); }
      const s = spr(T.e, k * .52);
      ctx.drawImage(s, X - s.width / 2, Y - s.height / 2);
      for (let i = 0; i < t.lvl; i++) { ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(X - k * .22 + i * k * .22, Y + k * .36, k * .06, 0, TAU); ctx.fill(); }
    }
    // монстры (между шагами — плавно)
    const a = Math.min(1, acc / TICK);
    for (const e of S.en) {
      const F = FOES[e.ty], s = e.ps + (e.s - e.ps) * a, [x, y] = posAt(P, s), X = x * k, Y = y * k;
      const sz = e.ty === 'king' ? 1.05 : e.ty === 'boss' ? .9 : e.ty === 'ogre' ? .7 : .55;
      if (e.sent) { ctx.fillStyle = 'rgba(255,45,85,.35)'; ctx.beginPath(); ctx.arc(X, Y, k * sz * .55, 0, TAU); ctx.fill(); }
      const sp = spr(F.e, k * sz);
      ctx.drawImage(sp, X - sp.width / 2, Y - sp.height / 2 - k * .05);
      if (e.slowK < 1) { ctx.fillStyle = 'rgba(56,189,248,.3)'; ctx.beginPath(); ctx.arc(X, Y, k * sz * .5, 0, TAU); ctx.fill(); }
      if (e.hp < e.max) { const bw = k * .6; ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(X - bw / 2, Y - k * sz * .62, bw, k * .08); ctx.fillStyle = e.hp / e.max > .4 ? '#4ade80' : '#ff4d6d'; ctx.fillRect(X - bw / 2, Y - k * sz * .62, bw * Math.max(0, e.hp / e.max), k * .08); }
    }
    for (const b of S.pr) { ctx.fillStyle = b.k === 'ball' ? '#1f1f1f' : '#fde68a'; ctx.beginPath(); ctx.arc(b.x * k, b.y * k, (b.k === 'ball' ? .12 : .07) * k, 0, TAU); ctx.fill(); if (b.k === 'ball') { ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5 * dpr; ctx.stroke(); } }
    for (const f of S.fx) {
      const al = Math.max(0, f.t / f.T);
      if (f.k === 'boom') { ctx.fillStyle = `rgba(255,140,40,${al * .45})`; ctx.beginPath(); ctx.arc(f.x * k, f.y * k, f.r * k * (1.2 - al * .4), 0, TAU); ctx.fill(); }
      else if (f.k === 'frost') { ctx.strokeStyle = `rgba(125,211,252,${al * .8})`; ctx.lineWidth = 3 * dpr; ctx.beginPath(); ctx.arc(f.x * k, f.y * k, f.r * k * (1 - al * .5), 0, TAU); ctx.stroke(); }
      else if (f.k === 'line') { ctx.strokeStyle = f.c; ctx.globalAlpha = al; ctx.lineWidth = 2.5 * dpr; ctx.beginPath(); ctx.moveTo(f.x * k, f.y * k); ctx.lineTo(f.x2 * k, f.y2 * k); ctx.stroke(); ctx.globalAlpha = 1; }
      else if (f.k === 'zap') { ctx.strokeStyle = `rgba(250,204,21,${al})`; ctx.lineWidth = 2.5 * dpr; ctx.beginPath(); for (let i = 0; i < f.pts.length; i += 2) i ? ctx.lineTo(f.pts[i] * k, f.pts[i + 1] * k) : ctx.moveTo(f.pts[i] * k, f.pts[i + 1] * k); ctx.stroke(); }
      else if (f.k === 'pop') { const [x, y] = posAt(P, f.s); ctx.globalAlpha = al; ctx.fillStyle = '#ffd166'; ctx.font = `800 ${Math.round(k * .3)}px Montserrat,sans-serif`; ctx.textAlign = 'center'; ctx.fillText(`+${S.n === 2 ? Math.ceil(f.g * .6) : f.g}`, x * k, (y - (1 - al) * .6) * k); ctx.globalAlpha = 1; }
      else if (f.k === 'leak') { ctx.fillStyle = `rgba(255,45,85,${al * .25})`; ctx.fillRect(0, 0, W, H); }
    }
    if (S.waveT > 0 && !S.over && S.wave < LAST) {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(W / 2 - k * 2.2, k * .2, k * 4.4, k * .6);
      ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(k * .32)}px Montserrat,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`Волна ${S.wave + 1} через ${Math.ceil(S.waveT)} с`, W / 2, k * .5);
    }
    if (MP && MP.stall > 1.2) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, H / 2 - k * .4, W, k * .8); ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(k * .3)}px Montserrat,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⏳ Ждём напарника…', W / 2, H / 2); }
  }

  // ── Меню, игра, конец ──
  function menu(){
    mode = 'menu'; S = null; hooks = null; sel = null;
    try { mapId = localStorage.getItem('d37_td_map') || 'meadow'; } catch (e) {}
    if (!MAPS.some(m => m.id === mapId)) mapId = 'meadow';
    look = CH()?.look() || null;
    renderBar(); renderPanel();
    const best = api.local().best || 0;
    showOv(`<div class="td-title">🏰 Башни</div>
      <div class="td-sub">Строй башни у дороги и не пускай монстров к замку. 20 волн, боссы на 10-й и 20-й.</div>
      <div class="td-maps">${MAPS.map(m => `<button type="button" class="td-map${m.id === mapId ? ' sel' : ''}" data-act="map:${m.id}"><span>${m.e}</span>${m.name}</button>`).join('')}</div>
      <div class="ct-actions"><button type="button" class="ct-start" data-act="play">▶ Играть</button><button type="button" class="ct-duel-btn" data-act="coop">🤝 Вместе</button><button type="button" class="ct-duel-btn" data-act="duel">⚔️ Битва</button></div>
      ${best ? `<div class="td-sub">Рекорд: <b>${num(best)}</b> очков</div>` : ''}
      <div class="td-hint">⚔️ Битва — у каждого своя карта, монстров можно отправлять сопернику. 🤝 Вместе — одна карта на двоих.</div>`);
    draw();
  }
  function play(o){
    S = newSim({ map: o.map, players: 1 });
    sel = null; adGold = false; contUsed = false;
    runId = 't' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    hideOv(); mode = 'run'; acc = 0;
    renderBar(); renderPanel();
    startLoop();
  }
  function onOver(){
    if (mode !== 'run') return;
    mode = 'over';
    if (!S.won && !hooks && !MP && !contUsed) { offerContinue(); return; }
    finish(false);
  }
  function offerContinue(){
    const adOk = !!window.D37Ads?.rewardReady?.(), price = C().RULES.revive, coinOk = C().coins() >= price;
    renderPanel();
    showOv(`<div class="td-title">💥 Замок пал</div><div class="td-sub">Волна ${S.wave} из ${LAST}. Продолжить с +10 жизнями? Можно один раз за игру.</div>
      <div class="td-col">${adOk ? '<button type="button" class="ct-start" data-act="cont-ad">📺 Посмотреть рекламу и продолжить</button>' : ''}
        <button type="button" class="${adOk ? 'td-alt' : 'ct-start'}" data-act="cont-coins"${coinOk ? '' : ' disabled'}>🪙 Продолжить за ${price} монет</button>
        <button type="button" class="td-alt" data-act="end">🏳️ Закончить</button></div>`);
  }
  async function cont(how){
    if (how === 'ad') { if (!await window.D37Ads.showReward('td_continue')) { api.toast('Реклама не досмотрена'); return; } }
    else { const r = await C().revive('td'); if (!r?.ok) { api.toast(r?.reason === 'coins' ? 'Не хватает монет' : 'Не получилось — попробуй ещё раз'); return; } }
    contUsed = true;
    command(S, { c: 'lives', v: 10 });
    hideOv(); mode = 'run'; api.sfx('win'); startLoop();
  }
  async function adBonus(btn){
    btn.disabled = true;
    if (!await window.D37Ads.showReward('td_gold')) { api.toast('Реклама не досмотрена'); btn.disabled = false; return; }
    adGold = true; command(S, { c: 'gold', v: 100, p: 0 }); api.sfx('win'); api.toast('📺 +100 💰'); renderPanel();
  }
  async function finish(fromButton){
    if (!S) return;
    mode = 'end'; sel = null;
    renderPanel(); renderBar();
    const sc = score(S), won = S.won;
    const coins = S.wave * 4 + (won ? 50 : 0);
    api.sfx(won ? 'win' : 'bad');
    if (hooks) { hooks.progress(sc); hooks.done(sc); }
    else if (MP) api.report('td_coop', won, sc, 0);
    else api.report('td', won, sc, sc);
    const best = Math.max(api.local().best || 0, sc);
    showOv(`<div class="td-title">${won ? '🏆 Замок выстоял!' : '💥 Замок пал'}</div>
      <div class="td-stats"><span>🌊 <b>${S.wave}</b>/${LAST}</span><span>💀 <b>${num(S.kills)}</b></span><span>❤️ <b>${S.lives}</b></span></div>
      <div class="td-score">${num(sc)} очков${!hooks && !MP && sc >= best && sc > 0 ? ' · 🏆 рекорд!' : ''}</div>
      <div class="td-coins" id="tdCoins">${coins ? `🪙 +${num(coins)} монет…` : ''}</div>
      ${hooks ? '' : MP ? `<div class="ct-actions">${MP.host ? '<button type="button" class="ct-start" data-act="co-go">↻ Ещё раз вместе</button>' : '<span class="td-hint">Ждём, пока напарник начнёт снова…</span>'}<a class="ct-duel-btn" href="#/games/td">🚪 Выйти</a></div>`
        : '<div class="ct-actions"><button type="button" class="ct-start" data-act="again">↻ Ещё раз</button><button type="button" class="ct-duel-btn" data-act="duel">⚔️ Битва</button><button type="button" data-act="share">📤 Поделиться</button></div><button type="button" class="td-mini" data-act="menu">🗺 Карты</button>'}`);
    if (!coins) return;
    const r = await C().run('td', coins, runId);
    const box = ov.querySelector('#tdCoins');
    if (box) box.innerHTML = r?.ok ? `🪙 <b>+${num(r.got)}</b> монет${r.base && r.got > r.base ? ' <span class="td-vip">VIP ×2</span>' : ''}` : r?.reason === 'too_fast' ? '🪙 Игра слишком короткая для монет' : '🪙 Монеты не начислились';
  }
  async function againSolo(btn){
    btn.disabled = true;
    try { await window.D37Ads?.interstitial?.('td'); } catch (e) {}
    play({ map: S?.map || mapId });
  }
  async function share(btn){
    const text = `Я прошёл ${S?.wave || 0} волн в «Башнях» на сайте dan4ik37 и не сдал замок! Побьёшь?`, url = location.origin + '/games/td';
    if (navigator.share) { navigator.share({ title: 'Башни', text, url }).catch(() => {}); return; }
    try { await navigator.clipboard.writeText(text + ' ' + url); btn.textContent = '✅ Скопировано'; } catch (e) { prompt('Скопируй и отправь другу:', text + ' ' + url); }
  }

  // ═══ «⚔️ БИТВА»: свои карты, одинаковые волны, отправка монстров ═══
  let MP_DUEL = { map: 'meadow' };
  function sendFoes(i){
    const s = SENDS[i];
    if (!s || !S || !hooks || S.gold[0] < s.cost || S.over) return;
    S.gold[0] -= s.cost;
    hooks.send({ ty: s.ty, n: s.n });
    api.sfx('move');
    api.toast(`⚔️ Отправлено: ${FOES[s.ty].e}×${s.n}`);
    renderBar(); renderPanelLight();
  }

  // ═══ «🤝 ВМЕСТЕ»: одна карта, детерминированная симуляция у обоих ═══
  function coopLink(){ return location.origin + location.pathname + '#/games/td/coop/' + MP.code; }
  function coopLobby(){
    if (!MP || MP.state !== 'lobby') return;
    const net = MP.np?.mode();
    let status, btn = '';
    if (!MP.room?.synced) status = 'Подключаемся к комнате…';
    else if (!MP.peerId) status = '<b>Ждём напарника.</b> Отправь ему ссылку — игра начнётся, как только он её откроет.';
    else if (MP.host) { status = `Напарник: <b>${esc(MP.peerNick)}</b>`; btn = `<div class="td-maps">${MAPS.map(m => `<button type="button" class="td-map${m.id === mapId ? ' sel' : ''}" data-act="map:${m.id}"><span>${m.e}</span>${m.name}</button>`).join('')}</div><button type="button" class="ct-start" data-act="co-go">▶ Начать вместе</button>`; }
    else status = `Ждём, пока <b>${esc(MP.peerNick)}</b> выберет карту и начнёт…`;
    showOv(`<div class="td-title">🤝 Башни вдвоём</div>
      <div class="td-sub">Одна карта на двоих, у каждого своё золото. Стройте вместе и не пустите монстров к замку.</div>
      <div class="ct-link td-link"><input readonly value="${esc(coopLink())}"><button type="button" data-act="co-copy">📋 Копировать</button></div>
      <div class="td-sub">${status}</div>${MP.peerId ? `<div class="td-hint">${net === 'p2p' ? '⚡ Связь напрямую' : net === 'relay' ? '🐢 Связь через сервер' : '🔌 Соединяемся…'}</div>` : ''}${btn}`);
  }
  function coopMount(code){
    build(root);
    MP = { code, state: 'lobby', host: false, me: 0, peerId: null, peerNick: '', pend: [], seq: 0, remoteT: -1, hashes: new Map(), stall: 0, hbAt: 0, room: null, np: null };
    try { mapId = localStorage.getItem('d37_td_map') || 'meadow'; } catch (e) {}
    coopLobby();
    MP.room = GameRoom.join('td-coop', code, {
      onError: () => { if (MP) showOv(GameRoom.errorHtml); },
      onFull: () => { if (MP) showOv(GameRoom.fullHtml('td')); },
      onPeer: (opp, room) => {
        if (!MP) return;
        MP.host = room.isHost;
        if (!opp) {
          const was = MP.peerId;
          MP.peerId = null;
          if (was && MP.state === 'run') { MP.gone = true; api.toast('🚪 Напарник вышел — играешь один'); }
          else if (MP.state !== 'run') { MP.state = 'lobby'; coopLobby(); }
          return;
        }
        const newcomer = MP.peerId && MP.peerId !== opp.id;
        MP.peerId = opp.id; MP.peerNick = opp.nick;
        if (newcomer || MP.state === 'run') { S = null; mode = 'menu'; MP.state = 'lobby'; }
        if (room.isHost) MP.np.offer();
        coopLobby();
      },
      onMessage: m => { if (MP && !MP.np.handle(m)) coopMsg(m); },
    });
    if (!MP.room) { showOv(GameRoom.errorHtml); return; }
    MP.np = NetPlay.start(MP.room, { onMessage: coopMsg, onMode: () => coopLobby() });
  }
  function coopGo(){
    if (!MP?.host || !MP.peerId) return;
    const m = { type: 'tstart', map: mapId, g: Date.now() % 1e6 };
    MP.np.send(m);
    coopBegin(m);
  }
  function coopBegin(m){
    MP.state = 'run'; MP.me = MP.host ? 0 : 1; MP.pend = []; MP.seq = 0; MP.remoteT = 0; MP.hashes = new Map(); MP.stall = 0; MP.gone = false;
    S = newSim({ map: m.map, players: 2, hpMul: 1.5 });
    sel = null;
    runId = 't' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    hideOv(); mode = 'run'; acc = 0;
    renderBar(); renderPanel();
    startLoop();
  }
  // Можно делать шаг, только если напарник пообещал, что его команд раньше этого шага уже не будет
  function coopCanTick(){
    if (MP.gone || !MP.peerId) return true;
    const ok = S.tick + 1 < MP.remoteT + LAG;
    if (!ok) MP.stall += TICK; else MP.stall = 0;
    return ok;
  }
  function coopBeforeTick(){
    const t = S.tick + 1;
    const now = MP.pend.filter(m => m.at === t).sort((a, b) => a.p - b.p || a.s - b.s);
    for (const m of now) command(S, { ...m.c, p: m.p });
    if (now.length) { MP.pend = MP.pend.filter(m => m.at !== t); renderBar(); renderPanel(); }
  }
  function coopAfterTick(){
    const every = MP.np.mode() === 'p2p' ? 2 : 6;
    if (S.tick % every === 0) MP.np.send({ type: 'tk', t: S.tick });
    if (S.tick % 90 === 0) {
      const h = hash(S);
      MP.hashes.set(S.tick, h);
      if (MP.hashes.size > 20) MP.hashes.delete(MP.hashes.keys().next().value);
      MP.np.send({ type: 'ck', t: S.tick, h });
    }
  }
  function coopMsg(m){
    if (!MP || !m || typeof m.type !== 'string') return;
    if (m.type === 'tstart' && !MP.host) { coopBegin(m); return; }
    if (MP.state !== 'run' || !S) return;
    if (m.type === 'cmd') { if (m.at > S.tick) MP.pend.push(m); else if (MP.host) coopResync(); return; }
    if (m.type === 'tk') { MP.remoteT = Math.max(MP.remoteT, m.t); return; }
    if (m.type === 'ck') { const mine = MP.hashes.get(m.t); if (mine !== undefined && mine !== m.h && MP.host) coopResync(); return; }
    if (m.type === 'sync' && !MP.host) {
      MP.resyncs = (MP.resyncs || 0) + 1;
      S = m.S;
      MP.pend = MP.pend.filter(x => x.at > S.tick);
      MP.remoteT = Math.max(MP.remoteT, S.tick);
      renderBar(); renderPanel();
    }
  }
  function coopResync(){ MP.resyncs = (MP.resyncs || 0) + 1; MP.np.send({ type: 'sync', S }); }

  function on(t, ev, fn){ t.addEventListener(ev, fn); listeners.push([t, ev, fn]); }
  const listeners = [];
  function stopRun(){ cancelAnimationFrame(raf); raf = 0; S = null; mode = 'menu'; }

  window.GAME_IMPL.td = {
    mount(el, gameApi){
      root = el; api = gameApi;
      on(window, 'resize', resize);
      const coop = /^coop\/([a-z0-9]{4,12})$/.exec(gameApi.param || '');
      if (coop) coopMount(coop[1]);
      else if (GameRoom.validCode(gameApi.param)) {
        stopDuel = Versus.start(root, api, 'td', gameApi.param, {
          run(stage, rand, h){
            stopRun();
            hooks = h;
            MP_DUEL = { map: MAPS[Math.floor(rand() * MAPS.length)].id };
            build(stage);
            showOv(`<div class="td-title">⚔️ Битва башен</div><div class="td-sub">Карта «${MAPS.find(m => m.id === MP_DUEL.map).name}». У каждого своя, волны одинаковые. Копи золото и отправляй монстров сопернику — у кого замок простоит дольше, тот и победил.</div><button type="button" class="ct-start" data-act="duel-go">▶ Старт</button>`);
            hooks = h;
          },
          onMsg(d){ if (S && !S.over && d && FOES[d.ty]) { addSend(S, d.ty, +d.n || 1); api.toast(`⚠️ ${hooks?.oppNick?.() || 'Соперник'} прислал ${FOES[d.ty].e}×${d.n}!`); api.sfx('bad'); } },
          stop(){ stopRun(); },
        });
      } else { build(root); menu(); }
    },
    unmount(){
      stopRun();
      for (const [t, ev, fn] of listeners.splice(0)) t.removeEventListener(ev, fn);
      if (MP) { MP.np?.close(); MP.room?.leave(); MP = null; }
      stopDuel?.(); stopDuel = null; hooks = null;
      root = null; cv = null; ctx = null; ov = null; bar = null; panel = null;
    },
    _test: { newSim, tick, command, path, posAt, waveList, hash, score, canBuild, TOWERS, FOES, MAPS, LAST },
    _dbg: () => ({ tick: S?.tick, hash: S ? hash(S) : 0, resyncs: MP?.resyncs || 0, gold: S?.gold, towers: S?.tw.length, mode: MP?.np?.mode() }),
  };
})();
