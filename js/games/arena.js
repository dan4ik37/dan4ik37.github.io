// ═══════════════════════════════════════
//  ИГРА «АРЕНА» — перестрелка 1 на 1 в реальном времени: против бота или онлайн с другом
// ═══════════════════════════════════════
// Бегаешь своим персонажем (js/core/avatar.js) с бластером. Телефон: левый палец — бег (джойстик где угодно
// на левой половине), правый — прицел: потянул и отпустил — выстрел, коротко тапнул — выстрел в ближайшего.
// ПК: WASD/стрелки + мышь, клик — выстрел, пробел/ПКМ — супер. 3 патрона (перезарядка), попадания копят
// «супер» — веер из 5 зарядов. В кустах тебя не видно (пока не выстрелишь или не подойдут вплотную).
// Аптечки ❤️ на карте. До 5 побед (или у кого больше за 2,5 минуты; поровну — ничья); убили — возрождение через 2 с.
// Онлайн (js/games/netplay.js: WebRTC напрямую, иначе через Supabase): хозяин считает пули и урон; свой
// бег каждый считает сам и шлёт позицию; хозяин не присылает тебе соперника, сидящего в кустах.
// Ключи сервера: arena_easy / arena_normal / arena_hard (против бота), arena_online.
(() => {
  const DT = 1 / 60, W = 1000, H = 640, PR = 18, SPEED = 230, BULLET = { spd: 760, range: 540, dmg: 22, r: 6 }, WIN = 5, LIMIT = 150;
  const WALLS = [[470, 260, 60, 120], [180, 110, 150, 30], [670, 500, 150, 30], [180, 470, 30, 110], [790, 60, 30, 110], [330, 300, 30, 40], [640, 300, 30, 40]];
  const BUSHES = [[95, 250, 95, 90], [810, 300, 95, 90], [420, 40, 160, 55], [420, 545, 160, 55]];
  const SPAWNS = [[70, 320], [930, 320]];
  const HEALS = [[500, 150], [500, 490]];
  const LEVELS = { easy: { label: 'Лёгкий', aim: .28, react: .55, rate: 1.1 }, normal: { label: 'Средний', aim: .12, react: .3, rate: .75 }, hard: { label: 'Сложный', aim: .04, react: .15, rate: .5 } };

  // ═══ МИР ═══
  function newWorld(){
    return { t: 0, p: SPAWNS.map((s, i) => newPlayer(i, s)), b: [], heals: HEALS.map(([x, y]) => ({ x, y, cd: 0 })), score: [0, 0], over: false, winner: -1, fx: [], bid: 0 };
  }
  function newPlayer(i, [x, y]){ return { i, x, y, hp: 100, ammo: 3, reload: 0, sup: 0, dead: 0, inv: 1.5, reveal: 0, aim: i ? Math.PI : 0, mx: 0, my: 0, hurt: 0 }; }
  const inRect = (x, y, [rx, ry, rw, rh], m = 0) => x > rx - m && x < rx + rw + m && y > ry - m && y < ry + rh + m;
  const inBush = p => BUSHES.some(b => inRect(p.x, p.y, b));
  // Движение с упором в стены и края
  function moveP(p, dx, dy, dt){
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    p.x += dx * SPEED * dt; p.y += dy * SPEED * dt;
    p.x = Math.max(PR, Math.min(W - PR, p.x)); p.y = Math.max(PR, Math.min(H - PR, p.y));
    for (const [rx, ry, rw, rh] of WALLS) {
      const cx = Math.max(rx, Math.min(p.x, rx + rw)), cy = Math.max(ry, Math.min(p.y, ry + rh));
      const ex = p.x - cx, ey = p.y - cy, d2 = ex * ex + ey * ey;
      if (d2 >= PR * PR) continue;
      if (d2 > 0) { const d = Math.sqrt(d2); p.x = cx + ex / d * PR; p.y = cy + ey / d * PR; }
      else { const left = p.x - rx, right = rx + rw - p.x, top = p.y - ry, bot = ry + rh - p.y, m = Math.min(left, right, top, bot); if (m === left) p.x = rx - PR; else if (m === right) p.x = rx + rw + PR; else if (m === top) p.y = ry - PR; else p.y = ry + rh + PR; }
    }
  }
  function shoot(Wd, p, a, sup){
    if (p.dead > 0) return false;
    if (sup) {
      if (p.sup < 1) return false;
      p.sup = 0;
      for (let k = -2; k <= 2; k++) Wd.b.push({ id: ++Wd.bid, o: p.i, x: p.x + Math.cos(a) * PR, y: p.y + Math.sin(a) * PR, vx: Math.cos(a + k * .13) * BULLET.spd * 1.05, vy: Math.sin(a + k * .13) * BULLET.spd * 1.05, left: BULLET.range * .9, dmg: 30, sup: true });
    } else {
      if (p.ammo < 1) return false;
      p.ammo--; if (p.reload <= 0) p.reload = .9;
      Wd.b.push({ id: ++Wd.bid, o: p.i, x: p.x + Math.cos(a) * PR, y: p.y + Math.sin(a) * PR, vx: Math.cos(a) * BULLET.spd, vy: Math.sin(a) * BULLET.spd, left: BULLET.range, dmg: BULLET.dmg, sup: false });
    }
    p.aim = a; p.reveal = 1;
    Wd.fx.push({ k: 'flash', x: p.x + Math.cos(a) * (PR + 6), y: p.y + Math.sin(a) * (PR + 6), t: .08 });
    return true;
  }
  // Шаг мира (у хозяина / в одиночной игре). onHit(victim, dmg, killer)
  function step(Wd, onEvent){
    Wd.t += DT;
    for (const p of Wd.p) {
      if (p.dead > 0) { p.dead -= DT; if (p.dead <= 0) { const s = SPAWNS[p.i]; Object.assign(p, newPlayer(p.i, s)); onEvent?.('spawn', p); } continue; }
      if (p.inv > 0) p.inv -= DT;
      if (p.reveal > 0) p.reveal -= DT;
      if (p.hurt > 0) p.hurt -= DT;
      if (p.ammo < 3) { p.reload -= DT; if (p.reload <= 0) { p.ammo++; p.reload = p.ammo < 3 ? .9 : 0; } }
    }
    for (const b of Wd.b) {
      const s = Math.hypot(b.vx, b.vy) * DT;
      b.x += b.vx * DT; b.y += b.vy * DT; b.left -= s;
      if (b.left <= 0 || b.x < 0 || b.x > W || b.y < 0 || b.y > H || WALLS.some(w => inRect(b.x, b.y, w))) { b.dead = true; Wd.fx.push({ k: 'spark', x: b.x, y: b.y, t: .15 }); continue; }
      const v = Wd.p[1 - b.o];
      if (v.dead > 0 || v.inv > 0) continue;
      const dx = v.x - b.x, dy = v.y - b.y;
      if (dx * dx + dy * dy < (PR + BULLET.r) * (PR + BULLET.r)) {
        b.dead = true;
        v.hp -= b.dmg; v.hurt = .15; v.reveal = .6;
        const sh = Wd.p[b.o];
        if (!b.sup) sh.sup = Math.min(1, sh.sup + .26);
        Wd.fx.push({ k: 'hit', x: v.x, y: v.y - PR, t: .5, n: b.dmg });
        onEvent?.('hit', v, b.dmg);
        if (v.hp <= 0) {
          v.hp = 0; v.dead = 2; Wd.score[b.o]++;
          Wd.fx.push({ k: 'boom', x: v.x, y: v.y, t: .5 });
          onEvent?.('kill', v, b.o);
          if (Wd.score[b.o] >= WIN) { Wd.over = true; Wd.winner = b.o; }
        }
      }
    }
    Wd.b = Wd.b.filter(b => !b.dead);
    for (const h of Wd.heals) {
      if (h.cd > 0) { h.cd -= DT; continue; }
      for (const p of Wd.p) if (p.dead <= 0 && p.hp < 100 && (p.x - h.x) ** 2 + (p.y - h.y) ** 2 < (PR + 16) ** 2) { p.hp = Math.min(100, p.hp + 40); h.cd = 14; Wd.fx.push({ k: 'heal', x: p.x, y: p.y - PR, t: .6 }); onEvent?.('heal', p); break; }
    }
    for (const f of Wd.fx) f.t -= DT;
    Wd.fx = Wd.fx.filter(f => f.t > 0);
    if (!Wd.over && Wd.t >= LIMIT) { Wd.over = true; Wd.winner = Wd.score[0] > Wd.score[1] ? 0 : Wd.score[1] > Wd.score[0] ? 1 : -1; }
  }
  // Есть ли прямая видимость (для бота)
  function clear(x0, y0, x1, y1){
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 12);
    for (let i = 1; i < n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; if (WALLS.some(w => inRect(x, y, w, 4))) return false; }
    return true;
  }
  // Бот: держит дистанцию, стрейфит, лечится, целится с упреждением и ошибкой по уровню
  function botThink(Wd, me, L, B){
    const p = Wd.p[me], o = Wd.p[1 - me];
    if (p.dead > 0) return;
    const visible = o.dead <= 0 && (!inBush(o) || o.reveal > 0 || Math.hypot(o.x - p.x, o.y - p.y) < 120);
    B.t = (B.t || 0) - DT;
    let tx = o.x, ty = o.y;
    if (p.hp < 45) { const h = Wd.heals.filter(h => h.cd <= 0).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]; if (h) { tx = h.x; ty = h.y; } }
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
    B.strafe = B.strafe || 1;
    if (Math.random() < .01) B.strafe *= -1;
    let mx = dx / d, my = dy / d;
    if (visible && p.hp >= 45) { const want = d > 360 ? 1 : d < 230 ? -1 : 0; mx = dx / d * want - dy / d * .8 * B.strafe; my = dy / d * want + dx / d * .8 * B.strafe; }
    if (!visible && p.hp >= 45) { mx = dx / d; my = dy / d; }
    // застрял у стены — объезжаем поперёк
    B.chk = (B.chk || 0) + DT;
    if (B.chk > .8) { if (Math.hypot(p.x - (B.lx ?? p.x + 99), p.y - (B.ly ?? 0)) < 12) { B.detour = .9; B.dside = Math.random() < .5 ? 1 : -1; } B.chk = 0; B.lx = p.x; B.ly = p.y; }
    if (B.detour > 0) { B.detour -= DT; const l = Math.hypot(mx, my) || 1; [mx, my] = [-my / l * B.dside, mx / l * B.dside]; }
    p.mx = mx; p.my = my;
    moveP(p, mx, my, DT);
    if (!visible || B.t > 0) return;
    if (!clear(p.x, p.y, o.x, o.y)) return;
    const dist = Math.hypot(o.x - p.x, o.y - p.y), tt = dist / BULLET.spd;
    const lx = o.x + o.mx * SPEED * tt, ly = o.y + o.my * SPEED * tt;
    const a = Math.atan2(ly - p.y, lx - p.x) + (Math.random() - .5) * 2 * L.aim;
    if (p.sup >= 1 && dist < 360) { shoot(Wd, p, a, true); B.t = L.react; return; }
    if (dist < BULLET.range * .95 && p.ammo > 0) { shoot(Wd, p, a, false); B.t = L.rate * (.7 + Math.random() * .6); }
  }

  // ═══ ЭКРАН ═══
  let root, api, cv, ctx, Wd = null, mode = 'menu', lv = 'normal', raf = 0, last = 0, acc = 0, dpr = 1, k = 1, ox = 0, oy = 0, rot = false;
  let me = 0, vs = 'bot', B = {}, room = null, np = null, host = true, gin = null, sentAt = 0, snapA = null, snapB = null, look = null, oppLook = null, names = ['Ты', 'Бот'], shake = 0;
  const keys = {}, sticks = { move: null, aim: null };
  const listeners = [];
  function on(t, ev, fn, o){ t.addEventListener(ev, fn, o); listeners.push([t, ev, fn, o]); }
  const CH = () => window.D37Char;

  function menu(){
    mode = 'menu'; Wd = null;
    root.innerHTML = `<div class="dk-menu">
        <div class="pl-logo">🔫</div><div class="un-title">Арена</div>
        <div class="un-sub">Перестрелка 1 на 1: бегай, прячься в кустах, копи «супер» и победи первым до ${WIN}. Играешь своим персонажем из гардероба.</div>
        <div class="pl-levels">${Object.entries(LEVELS).map(([kk, L]) => `<button type="button" class="un-n wide${kk === lv ? ' sel' : ''}" data-act="lv:${kk}">${L.label}</button>`).join('')}</div>
        <div class="ct-actions"><button type="button" class="ct-start" data-act="bot">🤖 Против бота</button><button type="button" class="ct-duel-btn" data-act="online">🌐 Онлайн с другом</button></div>
        <details class="un-rules"><summary>Управление</summary>
          <p>Телефон: левый палец на левой половине — бег; правый палец — прицел: потяни и отпусти — выстрел, короткий тап — выстрел в ближайшего. Кнопка «⚡» — супер (когда заряжен).</p>
          <p>Компьютер: WASD или стрелки — бег, мышь — прицел, клик — выстрел, пробел или правая кнопка — супер.</p>
          <p>3 заряда, перезарядка сама. Попадания заряжают супер — веер из 5 зарядов. В кустах тебя не видно, пока не выстрелишь. ❤️ — аптечка.</p>
        </details>
      </div>`;
  }
  function build(){
    root.innerHTML = `<div class="ar">
        <div class="ar-top"><span id="arS0"></span><b class="ar-vs" id="arT">⚔️ до ${WIN}</b><span id="arS1"></span></div>
        <div class="ar-wrap"><canvas class="ar-cv"></canvas><button type="button" class="ar-sup" aria-label="Супер">⚡</button><div class="ar-ov" hidden></div></div>
        <div class="ct-note" style="text-align:center">Левый палец — бег, правый — прицел и выстрел. ПК: WASD + мышь, пробел — супер.</div>
      </div>`;
    cv = root.querySelector('.ar-cv'); ctx = cv.getContext('2d');
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('contextmenu', e => e.preventDefault());
    root.querySelector('.ar-sup').addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); doShoot(Wd?.p[me].aim ?? 0, true); });
    look = CH()?.look() || null;
    resize();
  }
  function resize(){
    if (!cv) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.parentElement.clientWidth || 360, maxH = Math.max(320, window.innerHeight - 200);
    rot = w < 560 && maxH > w * 1.15;
    const tw = rot ? H : W, th = rot ? W : H, s = Math.min(w / tw, maxH / th);
    const cw = Math.round(tw * s), chh = Math.round(th * s);
    cv.style.width = cw + 'px'; cv.style.height = chh + 'px';
    cv.width = Math.round(cw * dpr); cv.height = Math.round(chh * dpr);
    k = s * dpr;
  }
  const toS = (x, y) => rot ? [(H - y) * k, x * k] : [x * k, y * k];
  const fromS = (sx, sy) => rot ? [sy / k, H - sx / k] : [sx / k, sy / k];

  // ── Управление ──
  function local(e){ const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; }
  function onDown(e){
    if (!Wd || mode !== 'play') return;
    const [sx, sy] = local(e);
    if (e.pointerType === 'mouse') {
      if (e.button === 2) { doShoot(aimFromMouse(sx, sy), true); return; }
      doShoot(aimFromMouse(sx, sy), false); return;
    }
    const left = rot ? sy > cv.height / 2 : sx < cv.width / 2;
    const st = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now() };
    if (left && !sticks.move) sticks.move = st;
    else if (!sticks.aim) sticks.aim = st;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  }
  function onMove(e){
    if (!Wd) return;
    if (e.pointerType === 'mouse' && cv) { const [sx, sy] = local(e); Wd.p[me].aim = aimFromMouse(sx, sy); return; }
    for (const s of [sticks.move, sticks.aim]) if (s && s.id === e.pointerId) { s.x = e.clientX; s.y = e.clientY; }
    if (sticks.aim && sticks.aim.id === e.pointerId) { const v = stickVec(sticks.aim); if (v.m > .2) Wd.p[me].aim = v.a; }
  }
  function onUp(e){
    if (sticks.move && sticks.move.id === e.pointerId) sticks.move = null;
    if (sticks.aim && sticks.aim.id === e.pointerId) {
      const s = sticks.aim, v = stickVec(s);
      sticks.aim = null;
      if (v.m > .25) doShoot(v.a, false);
      else if (performance.now() - s.t < 300) doShoot(autoAim(), false);   // короткий тап — в ближайшего
    }
  }
  function stickVec(s){
    let dx = s.x - s.x0, dy = s.y - s.y0;
    if (rot) [dx, dy] = [dy, -dx];
    const d = Math.hypot(dx, dy);
    return { a: Math.atan2(dy, dx), m: Math.min(1, d / 50), dx: d ? dx / d * Math.min(1, d / 50) : 0, dy: d ? dy / d * Math.min(1, d / 50) : 0 };
  }
  function aimFromMouse(sx, sy){ const p = Wd.p[me], [wx, wy] = fromS(sx, sy); return Math.atan2(wy - p.y, wx - p.x); }
  function autoAim(){ const p = Wd.p[me], o = Wd.p[1 - me]; return Math.atan2(o.y - p.y, o.x - p.x); }
  const KEYS = { arrowup: [0, -1], w: [0, -1], 'ц': [0, -1], arrowdown: [0, 1], s: [0, 1], 'ы': [0, 1], arrowleft: [-1, 0], a: [-1, 0], 'ф': [-1, 0], arrowright: [1, 0], d: [1, 0], 'в': [1, 0] };
  function onKey(e){
    if (!Wd || mode !== 'play' || e.target?.closest?.('input,textarea')) return;
    const kk = (e.key || '').toLowerCase();
    if (kk === ' ' && e.type === 'keydown') { doShoot(Wd.p[me].aim, true); e.preventDefault(); return; }
    if (!KEYS[kk]) return;
    keys[kk] = e.type === 'keydown';
    e.preventDefault();
  }
  function inputVec(){
    let x = 0, y = 0;
    for (const kk in keys) if (keys[kk]) { x += KEYS[kk][0]; y += KEYS[kk][1]; }
    if (sticks.move) { const v = stickVec(sticks.move); x += v.dx; y += v.dy; }
    const l = Math.hypot(x, y);
    return l > 1 ? [x / l, y / l] : [x, y];
  }
  function doShoot(a, sup){
    if (!Wd || Wd.over) return;
    if (vs === 'online' && !host) {
      const p = Wd.p[me];
      if (p.dead > 0 || (sup ? p.sup < 1 : p.ammo < 1)) return;
      np.send({ type: 'shot', a, sup, x: Math.round(p.x), y: Math.round(p.y) });
      if (!sup) p.ammo--; else p.sup = 0;
      Wd.fx.push({ k: 'flash', x: p.x + Math.cos(a) * (PR + 6), y: p.y + Math.sin(a) * (PR + 6), t: .08 });
      api.sfx('tick');
      return;
    }
    if (shoot(Wd, Wd.p[me], a, sup)) api.sfx(sup ? 'win' : 'tick');
  }

  // ── Цикл ──
  function start(kind, isHost){
    vs = kind; host = isHost !== false; me = host ? 0 : 1;
    Wd = newWorld(); B = {}; acc = 0; shake = 0;
    mode = 'play';
    build(); hud();
    cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(frame);
  }
  function onEvent(kind, p, x){
    if (kind === 'hit' && p.i === me) { shake = .25; api.sfx('bad'); }
    if (kind === 'kill') { hud(); api.sfx(x === me ? 'win' : 'bad'); }
  }
  function frame(now){
    raf = requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (dt > .1) dt = .1;
    if (!Wd) return;
    if (mode === 'play' && !Wd.over) {
      if (vs === 'online' && !host) guestFrame(dt);
      else {
        acc += dt;
        while (acc >= DT) {
          const [ix, iy] = inputVec(), p = Wd.p[me];
          p.mx = ix; p.my = iy;
          if (p.dead <= 0) moveP(p, ix, iy, DT);
          if (vs === 'bot') botThink(Wd, 1, LEVELS[lv], B);
          else if (gin) { const o = Wd.p[1]; if (o.dead <= 0) { o.mx = (gin.x - o.x) / (SPEED * DT * 3) || 0; o.my = (gin.y - o.y) / (SPEED * DT * 3) || 0; o.x = gin.x; o.y = gin.y; o.aim = gin.a; } }
          step(Wd, onEvent);
          acc -= DT;
        }
        if (vs === 'online') hostSend(now);
      }
      if (Wd.over) finish();
    }
    if (shake > 0) shake -= dt;
    draw();
  }

  // ── Онлайн: хозяин считает, гость шлёт позицию и выстрелы ──
  function hostSend(now){
    if (now - sentAt < 1000 / np.hz()) return;
    sentAt = now;
    const g = Wd.p[1], h = Wd.p[0];
    const hidden = inBush(h) && h.reveal <= 0 && Math.hypot(h.x - g.x, h.y - g.y) > 120 && h.dead <= 0;
    np.send({ type: 's', t: Math.round(Wd.t * 100),
      p: Wd.p.map((p, i) => i === 0 && hidden ? null : [Math.round(p.x), Math.round(p.y), Math.round(p.hp), p.ammo, Math.round(p.sup * 100), p.dead > 0 ? 1 : 0, p.inv > 0 ? 1 : 0, Math.round(p.aim * 100), p.hurt > 0 ? 1 : 0]),
      b: Wd.b.map(b => [Math.round(b.x), Math.round(b.y), Math.round(b.vx), Math.round(b.vy), b.o, b.sup ? 1 : 0]),
      sc: Wd.score, h: Wd.heals.map(x => x.cd > 0 ? 1 : 0), fx: Wd.fx.filter(f => f.t > .45 && f.k === 'hit').map(f => [Math.round(f.x), Math.round(f.y), f.n]), o: Wd.over ? Wd.winner : -1 }, true);
  }
  function guestFrame(dt){
    const p = Wd.p[me], [ix, iy] = inputVec();
    p.mx = ix; p.my = iy;
    if (p.dead <= 0) moveP(p, ix, iy, dt);
    const now = performance.now();
    if (now - sentAt >= 1000 / np.hz()) { sentAt = now; np.send({ type: 'in', x: Math.round(p.x), y: Math.round(p.y), a: Math.round(p.aim * 100) / 100 }, true); }
    // соперник и пули — из снимков
    const S = snapB;
    if (!S) return;
    const A = snapA, span = A ? Math.max(30, S.at - A.at) : 60, al = Math.min(1, (now - S.at) / span), ext = Math.min(.25, (now - S.at) / 1000);
    const o = Wd.p[1 - me], so = S.p[1 - me], ao = A?.p[1 - me];
    o.hidden = !so;
    if (so) { o.x = ao ? ao[0] + (so[0] - ao[0]) * al : so[0]; o.y = ao ? ao[1] + (so[1] - ao[1]) * al : so[1]; o.hp = so[2]; o.dead = so[5] ? 1 : 0; o.inv = so[6] ? 1 : 0; o.aim = so[7] / 100; o.hurt = so[8] ? .1 : 0; }
    const sm = S.p[me];
    if (sm) {
      if (sm[5] && p.dead <= 0) { p.dead = 1; shake = .3; api.sfx('bad'); }
      if (!sm[5] && p.dead > 0) { p.dead = 0; p.x = sm[0]; p.y = sm[1]; }
      if (sm[2] < p.hp) { shake = .2; }
      p.hp = sm[2]; p.ammo = sm[3]; p.sup = sm[4] / 100; p.inv = sm[6] ? 1 : 0; p.hurt = sm[8] ? .1 : 0;
      if (Math.hypot(sm[0] - p.x, sm[1] - p.y) > 200) { p.x = sm[0]; p.y = sm[1]; }
    }
    Wd.b = S.b.map(b => ({ x: b[0] + b[2] * ext, y: b[1] + b[3] * ext, vx: b[2], vy: b[3], o: b[4], sup: !!b[5] }));
    Wd.score = S.sc;
    S.h.forEach((c, i) => { Wd.heals[i].cd = c ? 1 : 0; });
    for (const f of Wd.fx) f.t -= dt;
    Wd.fx = Wd.fx.filter(f => f.t > 0);
    if (S.o >= 0) { Wd.over = true; Wd.winner = S.o; }
  }
  function netMsg(m){
    if (!m || !Wd) return;
    if (host) {
      if (m.type === 'in') gin = { x: +m.x || 0, y: +m.y || 0, a: +m.a || 0 };
      else if (m.type === 'shot') { const g = Wd.p[1]; if (Math.hypot((+m.x || 0) - g.x, (+m.y || 0) - g.y) < 120) { g.x = +m.x; g.y = +m.y; } shoot(Wd, g, +m.a || 0, !!m.sup); }
      return;
    }
    if (m.type === 's') {
      snapA = snapB; snapB = { ...m, at: performance.now() };
      Wd.t = m.t / 100;
      for (const f of m.fx || []) if (!Wd.fx.some(x => x.k === 'hit' && x.x === f[0] && x.y === f[1])) Wd.fx.push({ k: 'hit', x: f[0], y: f[1], t: .5, n: f[2] });
      hud();
    }
  }
  function joinOnline(code){
    root.innerHTML = '';
    GameRoom.lobby(root, 'arena', code);
    room = GameRoom.join('arena', code, {
      onError: () => { root.innerHTML = GameRoom.errorHtml; },
      onFull: () => { root.innerHTML = GameRoom.fullHtml('arena'); },
      onPeer: (opp, r) => {
        if (!opp) { if (mode === 'play') api.toast('Соперник вышел'); else GameRoom.lobbyText(root, 'Ты в комнате. <b>Ждём соперника…</b>'); return; }
        names = r.isHost ? ['Ты', opp.nick] : [opp.nick, 'Ты'];
        if (r.isHost) { np.offer(); r.send({ type: 'go', nick: r.nick, look: CH()?.look() || null }); start('online', true); }
        else GameRoom.lobbyText(root, `<b>${esc(opp.nick)}</b> на месте — начинаем…`);
      },
      onMessage: m => {
        if (np.handle(m)) return;
        if (m.type === 'go' && !room.isHost) { oppLook = m.look || null; names = [m.nick || 'Соперник', 'Ты']; room.send({ type: 'hi', look: CH()?.look() || null }); start('online', false); }
        else if (m.type === 'hi' && room.isHost) oppLook = m.look || null;
        else if (m.type === 'again' && !room.isHost) start('online', false);
        else netMsg(m);
      },
    });
    if (!room) { root.innerHTML = GameRoom.errorHtml; return; }
    np = NetPlay.start(room, { onMessage: netMsg });
  }

  // ── Рисование ──
  function rectS([x, y, w, h]){ const [a, b] = toS(x, y), [c, d] = toS(x + w, y + h); return [Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b)]; }
  function draw(){
    if (!ctx || !cv || !Wd) return;
    const Wc = cv.width, Hc = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (shake > 0) ctx.translate((Math.random() - .5) * 12 * dpr * shake * 3, (Math.random() - .5) * 12 * dpr * shake * 3);
    ctx.fillStyle = '#c9a66b'; ctx.fillRect(0, 0, Wc, Hc);
    ctx.fillStyle = 'rgba(0,0,0,.05)';
    for (let x = 0; x < W; x += 50) for (let y = 0; y < H; y += 50) if (((x + y) / 50) % 2) { const [a, b, c, d] = rectS([x, y, 50, 50]); ctx.fillRect(a, b, c, d); }
    for (const h of Wd.heals) if (h.cd <= 0) { const [sx, sy] = toS(h.x, h.y); ctx.font = `${Math.round(26 * k)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('❤️', sx, sy); }
    // игроки (под кустами)
    for (const p of Wd.p) {
      if (p.dead > 0 || p.hidden) continue;
      const mine = p.i === me;
      const hiddenToMe = !mine && vs === 'bot' && inBush(p) && p.reveal <= 0 && Math.hypot(p.x - Wd.p[me].x, p.y - Wd.p[me].y) > 120;
      if (hiddenToMe) continue;
      const [sx, sy] = toS(p.x, p.y);
      ctx.globalAlpha = p.inv > 0 && Math.floor(Wd.t * 12) % 2 ? .5 : (mine && inBush(p) ? .6 : 1);
      ctx.strokeStyle = mine ? 'rgba(74,222,128,.8)' : 'rgba(255,77,109,.8)'; ctx.lineWidth = 3 * dpr;
      ctx.beginPath(); ctx.ellipse(sx, sy + PR * .7 * k, PR * k, PR * .4 * k, 0, 0, Math.PI * 2); ctx.stroke();
      const L = mine ? look : oppLook;
      const dirX = Math.cos(p.aim) < 0 ? -1 : 1;
      if (CH() && (L || !mine)) { const sp = CH().sprite(L || { color: 'red', eyes: 'angry' }, PR * 2.4 * k, { dir: rot ? (Math.sin(p.aim) > 0 ? -1 : 1) : dirX, item: '🔫', noPet: true, t: Wd.t }); ctx.drawImage(sp.c, sx - sp.ax, sy + PR * .8 * k - sp.ay); }
      else { ctx.fillStyle = mine ? '#4ade80' : '#ff4d6d'; ctx.beginPath(); ctx.arc(sx, sy, PR * k, 0, Math.PI * 2); ctx.fill(); }
      if (p.hurt > 0) { ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.arc(sx, sy, PR * k * 1.1, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      // здоровье и заряды
      const bw = 44 * k, by = sy - PR * 2.1 * k;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(sx - bw / 2 - 1, by - 1, bw + 2, 7 * k + 2);
      ctx.fillStyle = mine ? '#4ade80' : '#ff4d6d'; ctx.fillRect(sx - bw / 2, by, bw * p.hp / 100, 7 * k);
      if (mine) for (let a = 0; a < 3; a++) { ctx.fillStyle = a < p.ammo ? '#ffd166' : 'rgba(255,255,255,.2)'; ctx.fillRect(sx - bw / 2 + a * (bw / 3) + 1, by + 9 * k, bw / 3 - 2, 4 * k); }
      // прицел своего
      if (mine && (sticks.aim || !('ontouchstart' in window))) {
        const [ex, ey] = toS(p.x + Math.cos(p.aim) * 260, p.y + Math.sin(p.aim) * 260);
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2 * dpr; ctx.setLineDash([6 * dpr, 6 * dpr]);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    for (const b of BUSHES) { const [a, bb, c, d] = rectS(b); ctx.fillStyle = 'rgba(34,139,34,.88)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(a, bb, c, d, 14 * k) : ctx.rect(a, bb, c, d); ctx.fill(); ctx.fillStyle = 'rgba(20,90,20,.6)'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(a + (i + .5) * c / 6, bb + d * (i % 2 ? .35 : .65), Math.min(c, d) * .18, 0, Math.PI * 2); ctx.fill(); } }
    for (const w of WALLS) { const [a, bb, c, d] = rectS(w); ctx.fillStyle = '#6b4f2e'; ctx.fillRect(a, bb, c, d); ctx.strokeStyle = '#4a361f'; ctx.lineWidth = 3 * dpr; ctx.strokeRect(a, bb, c, d); }
    for (const b of Wd.b) { const [sx, sy] = toS(b.x, b.y); ctx.fillStyle = b.o === me ? (b.sup ? '#facc15' : '#7dd3fc') : (b.sup ? '#f97316' : '#ff4d6d'); ctx.beginPath(); ctx.arc(sx, sy, BULLET.r * k * (b.sup ? 1.3 : 1), 0, Math.PI * 2); ctx.fill(); }
    for (const f of Wd.fx) {
      const [sx, sy] = toS(f.x, f.y);
      if (f.k === 'flash') { ctx.fillStyle = 'rgba(255,240,180,.9)'; ctx.beginPath(); ctx.arc(sx, sy, 8 * k, 0, Math.PI * 2); ctx.fill(); }
      else if (f.k === 'spark') { ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(sx, sy, 4 * k, 0, Math.PI * 2); ctx.fill(); }
      else if (f.k === 'hit') { ctx.globalAlpha = Math.min(1, f.t * 2); ctx.fillStyle = '#fff'; ctx.font = `900 ${Math.round(16 * k)}px Montserrat,sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = 3 * dpr; ctx.strokeStyle = '#000'; ctx.strokeText('-' + f.n, sx, sy - (.5 - f.t) * 40 * k); ctx.fillText('-' + f.n, sx, sy - (.5 - f.t) * 40 * k); ctx.globalAlpha = 1; }
      else if (f.k === 'boom') { ctx.fillStyle = `rgba(255,120,40,${f.t})`; ctx.beginPath(); ctx.arc(sx, sy, (1 - f.t) * 60 * k + 10 * k, 0, Math.PI * 2); ctx.fill(); }
      else if (f.k === 'heal') { ctx.globalAlpha = f.t; ctx.fillStyle = '#4ade80'; ctx.font = `900 ${Math.round(15 * k)}px Montserrat,sans-serif`; ctx.textAlign = 'center'; ctx.fillText('+40', sx, sy - (.6 - f.t) * 40 * k); ctx.globalAlpha = 1; }
    }
    // джойстики
    for (const s of [sticks.move, sticks.aim]) {
      if (!s) continue;
      const r = cv.getBoundingClientRect(), bx = (s.x0 - r.left) * dpr, by = (s.y0 - r.top) * dpr;
      let dx = (s.x - s.x0) * dpr, dy = (s.y - s.y0) * dpr; const d = Math.hypot(dx, dy), m = 50 * dpr;
      if (d > m) { dx = dx / d * m; dy = dy / d * m; }
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.arc(bx, by, m, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = s === sticks.aim ? 'rgba(255,209,102,.6)' : 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.arc(bx + dx, by + dy, 22 * dpr, 0, Math.PI * 2); ctx.fill();
    }
    const tEl = root.querySelector('#arT');
    if (tEl) { const left = Math.max(0, Math.ceil(LIMIT - Wd.t)), txt = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; if (tEl.textContent !== txt) tEl.textContent = txt; }
    const sup = root.querySelector('.ar-sup');
    if (sup) { const ready = Wd.p[me].sup >= 1 && Wd.p[me].dead <= 0; sup.classList.toggle('ready', ready); sup.style.setProperty('--sp', Math.round(Wd.p[me].sup * 100) + '%'); }
  }
  function hud(){
    if (!Wd || !root) return;
    const s0 = root.querySelector('#arS0'), s1 = root.querySelector('#arS1');
    if (s0) s0.innerHTML = `<b class="ar-g">${esc(names[0])}</b> ${'●'.repeat(Wd.score[0])}${'○'.repeat(WIN - Wd.score[0])}`;
    if (s1) s1.innerHTML = `${'●'.repeat(Wd.score[1])}${'○'.repeat(WIN - Wd.score[1])} <b class="ar-r">${esc(names[1])}</b>`;
  }
  function finish(){
    if (mode !== 'play') return;
    mode = 'over';
    hud();
    const win = Wd.winner === me, draw = Wd.winner < 0;
    api.sfx(win ? 'win' : draw ? 'ok' : 'bad');
    const ov = root.querySelector('.ar-ov');
    ov.hidden = false;
    ov.innerHTML = `<div class="hd-title">${win ? '🏆 Победа!' : draw ? '🤝 Ничья' : '😔 Поражение'}</div><div class="hd-sub">${Wd.score[0]} : ${Wd.score[1]}</div>
      <div class="ct-actions">${vs === 'online' ? (host ? '<button type="button" class="ct-start" data-act="again">↻ Реванш</button>' : '<span class="hd-hint">Ждём реванша от соперника…</span>') : '<button type="button" class="ct-start" data-act="again">↻ Ещё раз</button>'}<button type="button" class="hd-mini" data-act="leave">${vs === 'online' ? '🚪 Выйти' : '🏠 Меню'}</button></div>`;
    if (vs === 'bot') api.report('arena_' + lv, win, win ? 1 : 0, (api.local().wins || 0) + (win ? 1 : 0));
    else api.report('arena_online', win, win ? 1 : 0, (api.local().wins || 0) + (win ? 1 : 0));
  }
  function onClick(e){
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a.startsWith('lv:')) { lv = a.slice(3); menu(); }
    else if (a === 'bot') { names = ['Ты', '🤖 Бот (' + LEVELS[lv].label.toLowerCase() + ')']; oppLook = { color: 'red', eyes: 'angry', mouth: 'fangs', hat: 'horns' }; start('bot', true); }
    else if (a === 'online') location.hash = '#/games/arena/' + GameRoom.newCode();
    else if (a === 'again') { if (vs === 'online') { if (host) { room.send({ type: 'again' }); start('online', true); } } else start('bot', true); }
    else if (a === 'leave') { if (vs === 'online') location.hash = '#/games/arena'; else menu(); }
  }

  window.GAME_IMPL.arena = {
    mount(el, gameApi){
      root = el; api = gameApi;
      root.addEventListener('click', onClick);
      on(window, 'keydown', onKey); on(window, 'keyup', onKey); on(window, 'resize', () => { resize(); });
      on(window, 'pointermove', onMove); on(window, 'pointerup', onUp); on(window, 'pointercancel', onUp);
      if (GameRoom.validCode(gameApi.param)) joinOnline(gameApi.param); else menu();
    },
    unmount(){
      cancelAnimationFrame(raf); raf = 0;
      root?.removeEventListener('click', onClick);
      for (const [t, ev, fn, o] of listeners.splice(0)) t.removeEventListener(ev, fn, o);
      np?.close(); np = null; room?.leave(); room = null;
      Wd = null; mode = 'menu'; sticks.move = sticks.aim = null;
      for (const kk in keys) keys[kk] = false;
      root = null; cv = null; ctx = null;
    },
    _test: { newWorld, step, botThink, shoot, moveP, LEVELS, WALLS },
  };
})();
