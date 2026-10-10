// ═══════════════════════════════════════
//  ИГРА «БИЛЬЯРД» — американский пул «восьмёрка»: против бота, вдвоём на одном телефоне или онлайн по ссылке
// ═══════════════════════════════════════
// Целься пальцем/мышью (линия показывает, куда пойдёт биток и прицельный шар), силу набирай, оттягивая
// полоску справа вниз, — отпустил, удар. Шары 1–7 — сплошные, 9–15 — полосатые, 8 — чёрный.
// Первый законно забитый шар после разбоя определяет твою группу. Забил свой — бьёшь ещё. Фол (биток в лузе,
// не попал ни в один шар или первым задел чужой) — соперник ставит биток куда хочет. Чёрный 8 — последним:
// забил раньше времени или вместе с фолом — проигрыш.
// Физика детерминированная (шаг 1/240 с, только + − × ÷ sqrt): по сети передаётся лишь удар (направление
// и сила), оба браузера сами считают одинаковый результат — подделать исход удара нельзя.
// Ключи сервера: pool_easy / pool_normal / pool_hard (против бота), pool_online (games-more.sql).
(() => {
  const W = 1000, H = 500, R = 12.5, D2 = (2 * R) * (2 * R);
  const STEP = 1 / 240, FRICTION = 200, REST_BALL = .96, REST_RAIL = .78, MAXV = 1950, STOP = 3;
  // лузы: x, y, радиус захвата
  const POCKETS = [[-3, -3, 30], [W / 2, -12, 24], [W + 3, -3, 30], [-3, H + 3, 30], [W / 2, H + 12, 24], [W + 3, H + 3, 30]];
  const KITCHEN = W * .25, FOOT = [W * .73, H / 2];
  const LEVELS = { easy: { label: 'Лёгкий', noise: .055, pow: .12 }, normal: { label: 'Средний', noise: .022, pow: .06 }, hard: { label: 'Сложный', noise: .006, pow: .03 } };
  const COL = ['#f8f8f2', '#f2c40f', '#2d5bd8', '#e0322f', '#7b3fb6', '#f47b20', '#1f8f4a', '#8b1d2c', '#111', '#f2c40f', '#2d5bd8', '#e0322f', '#7b3fb6', '#f47b20', '#1f8f4a', '#8b1d2c'];
  const isSolid = n => n >= 1 && n <= 7, isStripe = n => n >= 9 && n <= 15;
  const ofGroup = (n, g) => g === 'solid' ? isSolid(n) : g === 'stripe' ? isStripe(n) : false;
  const GNAME = { solid: 'сплошные', stripe: 'полосатые' };

  function mulberry(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ═══ ФИЗИКА ═══
  function rack(seed){
    const rand = mulberry(seed);
    const balls = [{ n: 0, x: W * .22, y: H / 2, vx: 0, vy: 0, in: true }];
    // треугольник: 8 — в центре, по углам основания — сплошной и полосатый
    const rest = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    const s = rest.findIndex(isSolid), solid = rest.splice(s, 1)[0], t = rest.findIndex(isStripe), stripe = rest.splice(t, 1)[0];
    const dx = R * 2 * .866 + .2, spots = [];
    for (let row = 0; row < 5; row++) for (let k = 0; k <= row; k++) spots.push([FOOT[0] + row * dx, FOOT[1] + (k - row / 2) * (2 * R + .2)]);
    const order = [];
    let ri = 0;
    for (let i = 0; i < 15; i++) {
      if (i === 4) order.push(8);
      else if (i === 10) order.push(rand() < .5 ? solid : stripe);
      else if (i === 14) order.push(order[10] === solid ? stripe : solid);
      else order.push(rest[ri++]);
    }
    order.forEach((n, i) => balls.push({ n, x: spots[i][0], y: spots[i][1], vx: 0, vy: 0, in: true }));
    balls.sort((a, b) => a.n - b.n);
    return balls;
  }
  const nearMouth = (x, y) => (x < 36 || x > W - 36) && (y < 36 || y > H - 36) || (Math.abs(x - W / 2) < 26 && (y < 30 || y > H - 30));
  // Один шаг: движение, лузы, борта, столкновения, трение. ev: { first, pocketed: [], rails }
  function step(B, ev){
    let moving = false;
    for (const b of B) { if (!b.in) continue; b.x += b.vx * STEP; b.y += b.vy * STEP; }
    for (const b of B) {
      if (!b.in) continue;
      for (const [px, py, pr] of POCKETS) {
        const dx = b.x - px, dy = b.y - py;
        if (dx * dx + dy * dy < pr * pr) { b.in = false; b.vx = b.vy = 0; ev.pocketed.push(b.n); break; }
      }
      if (!b.in) continue;
      if (!nearMouth(b.x, b.y)) {
        if (b.x < R) { b.x = R + (R - b.x); b.vx = -b.vx * REST_RAIL; b.vy *= .97; ev.rails++; }
        else if (b.x > W - R) { b.x = (W - R) - (b.x - (W - R)); b.vx = -b.vx * REST_RAIL; b.vy *= .97; ev.rails++; }
        if (b.y < R) { b.y = R + (R - b.y); b.vy = -b.vy * REST_RAIL; b.vx *= .97; ev.rails++; }
        else if (b.y > H - R) { b.y = (H - R) - (b.y - (H - R)); b.vy = -b.vy * REST_RAIL; b.vx *= .97; ev.rails++; }
      } else if (b.x < 0 || b.x > W || b.y < 0 || b.y > H) { b.in = false; b.vx = b.vy = 0; ev.pocketed.push(b.n); }   // в створе лузы центр за краем — упал
    }
    for (let i = 0; i < B.length; i++) {
      const a = B[i];
      if (!a.in) continue;
      for (let j = i + 1; j < B.length; j++) {
        const b = B[j];
        if (!b.in) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 >= D2 || d2 === 0) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = (2 * R - d) / 2;
        a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
        const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (vn > 0) {
          const imp = vn * (1 + REST_BALL) / 2;
          a.vx -= imp * nx; a.vy -= imp * ny; b.vx += imp * nx; b.vy += imp * ny;
          if (ev.first < 0 && (a.n === 0 || b.n === 0)) ev.first = a.n === 0 ? b.n : a.n;
          ev.hits++;
        }
      }
    }
    for (const b of B) {
      if (!b.in) continue;
      const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (sp < STOP) { b.vx = b.vy = 0; continue; }
      const k = Math.max(0, sp - FRICTION * STEP) / sp;
      b.vx *= k; b.vy *= k;
      moving = true;
    }
    return moving;
  }
  // Удар: dx, dy — направление (округлённое, у обоих одинаковое), p — сила 0…1
  function strike(B, shot){
    const cue = B[0], l = Math.sqrt(shot.dx * shot.dx + shot.dy * shot.dy) || 1, v = Math.max(.03, Math.min(1, shot.p)) * MAXV;
    cue.vx = shot.dx / l * v; cue.vy = shot.dy / l * v;
  }
  // Просчитать удар целиком (для правил и бота)
  function simulate(B, shot){
    const ev = { first: -1, pocketed: [], rails: 0, hits: 0, steps: 0 };
    strike(B, shot);
    while (step(B, ev) && ev.steps < 240 * 25) ev.steps++;
    return ev;
  }
  const cloneB = B => B.map(b => ({ ...b }));
  const roundShot = s => ({ dx: Math.round(s.dx * 1e6) / 1e6, dy: Math.round(s.dy * 1e6) / 1e6, p: Math.round(s.p * 1000) / 1000 });
  function hashB(B){ let h = 0; for (const b of B) h = (h * 31 + (b.in ? Math.round(b.x * 10) * 7 + Math.round(b.y * 10) : -1)) | 0; return h; }

  // ═══ ПРАВИЛА ═══
  function newState(seed){ return { balls: rack(seed), turn: 0, groups: [null, null], breakShot: true, inHand: true, kitchen: true, over: false, winner: -1, msg: 'Разбой: поставь биток в левой четверти и бей', shots: 0 }; }
  const cleared = (S, p) => !!S.groups[p] && S.balls.every(b => !b.in || !ofGroup(b.n, S.groups[p]));
  // Применить удар игрока S.turn (биток уже на месте). Вернёт ev
  function play(S, shot){
    const me = S.turn, op = 1 - me, my = S.groups[me], wasCleared = cleared(S, me);
    const ev = simulate(S.balls, shot);
    S.shots++;
    const cueIn = ev.pocketed.includes(0), eightIn = ev.pocketed.includes(8);
    const objIn = ev.pocketed.filter(n => n !== 0 && n !== 8);
    let foul = '';
    if (cueIn) foul = 'биток в лузе';
    else if (ev.first < 0) foul = 'биток не задел ни одного шара';
    else if (my && !ofGroup(ev.first, my) && !(ev.first === 8 && wasCleared)) foul = `первым задет чужой шар (${ev.first})`;
    else if (!my && ev.first === 8 && !S.breakShot) foul = 'первым задет чёрный 8';
    let msg = '';
    if (eightIn) {
      if (S.breakShot) { respot(S, 8); msg = 'Чёрный 8 на разбое — возвращается на стол. '; }
      else if (wasCleared && !foul) { S.over = true; S.winner = me; S.msg = 'Чёрный 8 в лузе — победа!'; return ev; }
      else { S.over = true; S.winner = op; S.msg = foul ? `Чёрный 8 забит с фолом (${foul}) — поражение` : 'Чёрный 8 забит раньше времени — поражение'; return ev; }
    }
    // группы: на открытом столе (не разбой) — по первому забитому
    if (!my && !S.breakShot && !foul && objIn.length) {
      const g = isSolid(objIn[0]) ? 'solid' : 'stripe';
      S.groups[me] = g; S.groups[op] = g === 'solid' ? 'stripe' : 'solid';
      msg += `Твои — ${GNAME[g]}. `;
    }
    const mine = S.groups[me];
    const keep = !foul && (S.breakShot ? objIn.length > 0 : mine ? objIn.some(n => ofGroup(n, mine)) : objIn.length > 0);
    if (cueIn) { const c = S.balls[0]; c.in = true; c.vx = c.vy = 0; c.x = W * .22; c.y = H / 2; }
    S.breakShot = false; S.kitchen = false;
    if (foul) { S.turn = op; S.inHand = true; S.msg = msg + `Фол: ${foul}. Соперник ставит биток куда хочет.`; }
    else if (keep) { S.inHand = false; S.msg = msg + (objIn.length > 1 ? `Забито ${objIn.length}! Бей ещё.` : 'Забил! Бей ещё.'); }
    else { S.turn = op; S.inHand = false; S.msg = msg + (objIn.length ? 'Забит чужой шар — ход переходит.' : 'Мимо — ход переходит.'); }
    return ev;
  }
  function respot(S, n){
    const b = S.balls[n];
    b.in = true; b.vx = b.vy = 0;
    let x = FOOT[0], y = FOOT[1];
    while (S.balls.some(o => o !== b && o.in && (o.x - x) * (o.x - x) + (o.y - y) * (o.y - y) < D2)) x += 2 * R + 1;
    b.x = x; b.y = y;
  }
  // Можно ли поставить биток сюда (при «шаре в руке»)
  function canPlace(S, x, y){
    if (x < R || x > W - R || y < R || y > H - R) return false;
    if (S.kitchen && x > KITCHEN) return false;
    return S.balls.every(b => b.n === 0 || !b.in || (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) >= D2 * 1.05);
  }

  // ═══ БОТ: перебор ударов в прицельные шары по лузам + просчёт физикой ═══
  function botShot(S, lv, rand){
    const L = LEVELS[lv] || LEVELS.normal, me = S.turn, my = S.groups[me];
    const targets = S.balls.filter(b => b.in && b.n !== 0 && (my ? (cleared(S, me) ? b.n === 8 : ofGroup(b.n, my)) : b.n !== 8));
    const cue = S.balls[0];
    // шар в руке: ставим биток напротив удобного шара
    if (S.inHand) placeCue(S, targets);
    const cands = [];
    for (const t of targets) for (const [px, py] of POCKETS) {
      const tx = px - t.x, ty = py - t.y, tl = Math.sqrt(tx * tx + ty * ty) || 1;
      const gx = t.x - tx / tl * 2 * R, gy = t.y - ty / tl * 2 * R;   // «призрачный шар»
      const ax = gx - cue.x, ay = gy - cue.y, al = Math.sqrt(ax * ax + ay * ay) || 1;
      const cut = (ax / al) * (tx / tl) + (ay / al) * (ty / tl);    // косинус угла резки
      if (cut < .25) continue;
      for (const p of [.38, .55, .8]) cands.push({ dx: ax / al, dy: ay / al, p: Math.min(1, p * (.7 + (al + tl) / 1400)), cut });
    }
    if (S.breakShot) cands.push({ dx: FOOT[0] - cue.x, dy: FOOT[1] - cue.y + (rand() - .5) * 8, p: 1, cut: 1 });
    if (!cands.length && targets.length) { const t = targets[0]; cands.push({ dx: t.x - cue.x, dy: t.y - cue.y, p: .45, cut: 0 }); }
    cands.sort((a, b) => b.cut - a.cut);
    let best = null, bestScore = -1e9;
    for (const c of cands.slice(0, 36)) {
      const T = { ...S, balls: cloneB(S.balls), groups: S.groups.slice() };
      play(T, roundShot(c));
      let sc = T.over ? (T.winner === me ? 5000 : -5000) : T.turn === me ? 300 : 0;
      if (!T.over && T.turn !== me && T.inHand) sc -= 400;
      sc += c.cut * 40;
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    if (!best) best = { dx: 1, dy: 0, p: .5 };
    // промахи бота по уровню: шум в направлении и силе
    const a = Math.atan2(best.dy, best.dx) + (rand() - .5) * 2 * L.noise;
    return roundShot({ dx: Math.cos(a), dy: Math.sin(a), p: Math.max(.08, best.p * (1 + (rand() - .5) * 2 * L.pow)) });
  }
  function placeCue(S, targets){
    const cue = S.balls[0];
    let bestPos = null, best = -1;
    for (const t of targets.slice(0, 7)) for (const [px, py] of POCKETS) {
      const tx = px - t.x, ty = py - t.y, tl = Math.sqrt(tx * tx + ty * ty) || 1;
      for (const back of [70, 120, 180]) {
        const x = t.x - tx / tl * (2 * R + back), y = t.y - ty / tl * (2 * R + back);
        if (!canPlace(S, x, y)) continue;
        const sc = 1000 - tl - back;
        if (sc > best) { best = sc; bestPos = [x, y]; }
      }
    }
    if (!bestPos) for (let x = R + 5; x < (S.kitchen ? KITCHEN : W - R); x += 25) { if (canPlace(S, x, H / 2)) { bestPos = [x, H / 2]; break; } }
    if (bestPos) { cue.x = bestPos[0]; cue.y = bestPos[1]; }
  }

  // ═══ ЭКРАН ═══
  let root, api, cv, ctx, S = null, mode = 'menu', vs = null, lv = 'normal', raf = 0, anim = null, aim = { dx: 1, dy: 0 }, power = 0, pulling = false, dragCue = false;
  let dpr = 1, scale = 1, rot = false, ox = 0, oy = 0, cw = 0, ch = 0, names = ['Ты', 'Бот'], room = null, myIdx = 0, timers = [], busy = false;
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const myTurn = () => S && !S.over && !busy && (vs === 'duo' || S.turn === myIdx);

  function menu(){
    mode = 'menu'; S = null; vs = null;
    root.innerHTML = `<div class="pl-menu">
        <div class="pl-logo">🎱</div><div class="un-title">Бильярд</div>
        <div class="un-sub">Американский пул «восьмёрка»: забей все свои шары — сплошные или полосатые — и чёрный 8 последним.</div>
        <div class="pl-levels">${Object.entries(LEVELS).map(([k, L]) => `<button type="button" class="un-n wide${k === lv ? ' sel' : ''}" data-act="lv:${k}">${L.label}</button>`).join('')}</div>
        <div class="ct-actions"><button type="button" class="ct-start" data-act="bot">🤖 Против бота</button><button type="button" class="ct-duel-btn" data-act="duo">👥 Вдвоём на экране</button><button type="button" class="ct-duel-btn" data-act="online">🌐 Онлайн с другом</button></div>
        <details class="un-rules"><summary>Как играть</summary>
          <p>Веди пальцем (мышью) по столу — выбираешь направление. Линия показывает, куда покатится биток и прицельный шар.</p>
          <p>Сила — потяни полоску справа вниз и отпусти. Чем ниже — тем сильнее.</p>
          <p>Первый забитый шар после разбоя определяет твою группу. Забил свой — бьёшь ещё. Фол — соперник ставит биток куда хочет.</p>
          <p>Чёрный 8 — последним. Забил его раньше времени или с фолом — проигрыш.</p>
        </details>
      </div>`;
  }
  function build(){
    root.innerHTML = `<div class="pl">
        <div class="pl-top"><div class="pl-pl" id="plP0"></div><div class="pl-vs">🎱</div><div class="pl-pl right" id="plP1"></div></div>
        <div class="pl-wrap"><canvas class="pl-cv"></canvas><div class="pl-power" aria-label="Сила удара: тяни вниз и отпусти"><div class="pl-power-in"></div><span>⬇ сила</span></div></div>
        <div class="un-status pl-msg" aria-live="polite"></div>
        <div class="un-acts pl-acts"></div>
      </div>`;
    cv = root.querySelector('.pl-cv'); ctx = cv.getContext('2d');
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    const pw = root.querySelector('.pl-power');
    pw.addEventListener('pointerdown', e => { if (!myTurn() || S.inHandPlacing) return; pulling = true; pw.setPointerCapture(e.pointerId); setPower(e); e.preventDefault(); });
    pw.addEventListener('pointermove', e => { if (pulling) setPower(e); });
    pw.addEventListener('pointerup', () => { if (!pulling) return; pulling = false; if (power > .03) shoot(); else setPowerUi(0); });
    pw.addEventListener('pointercancel', () => { pulling = false; setPowerUi(0); });
    resize();
  }
  function setPower(e){ const r = root.querySelector('.pl-power').getBoundingClientRect(); setPowerUi(Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))); }
  function setPowerUi(p){ power = p; const el = root.querySelector('.pl-power-in'); if (el) el.style.height = Math.round(p * 100) + '%'; draw(); }
  function resize(){
    if (!cv) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const box = cv.parentElement, w = Math.max(240, box.clientWidth - 46), maxH = Math.max(320, window.innerHeight - 260);
    rot = w < 520 && maxH > w * 1.1;   // телефон — стол вертикально
    const tw = (rot ? H : W) + 60, th = (rot ? W : H) + 60;
    scale = Math.min(w / tw, maxH / th);
    cw = Math.round(tw * scale); ch = Math.round(th * scale);
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    draw();
  }
  // стол → экран и обратно
  function toScreen(x, y){ const k = scale * dpr, m = 30 * k; return rot ? [m + (H - y) * k, m + x * k] : [m + x * k, m + y * k]; }
  function toTable(e){ const r = cv.getBoundingClientRect(), sx = (e.clientX - r.left) / scale - 30, sy = (e.clientY - r.top) / scale - 30; return rot ? [sy, H - sx] : [sx, sy]; }

  function onDown(e){
    if (!myTurn()) return;
    const [x, y] = toTable(e), c = S.balls[0];
    if (S.inHand && (x - c.x) ** 2 + (y - c.y) ** 2 < (R * 3) ** 2) { dragCue = true; cv.setPointerCapture(e.pointerId); return; }
    setAim(x, y);
    cv.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onMove(e){
    if (!myTurn()) return;
    const [x, y] = toTable(e);
    if (dragCue) { if (canPlace(S, x, y)) { S.balls[0].x = x; S.balls[0].y = y; } draw(); return; }
    if (e.buttons || e.pointerType !== 'mouse') setAim(x, y); else if (e.pointerType === 'mouse') setAim(x, y);
  }
  function onUp(){ if (dragCue) { dragCue = false; if (vs === 'online') room.send({ type: 'place', x: S.balls[0].x, y: S.balls[0].y }); } }
  function setAim(x, y){ const c = S.balls[0], dx = x - c.x, dy = y - c.y, l = Math.sqrt(dx * dx + dy * dy); if (l > 2) { aim = { dx: dx / l, dy: dy / l }; draw(); } }

  function shoot(){
    if (!myTurn()) return;
    const shot = roundShot({ dx: aim.dx, dy: aim.dy, p: power });
    setPowerUi(0);
    if (vs === 'online') room.send({ type: 'shot', shot, cue: { x: S.balls[0].x, y: S.balls[0].y }, n: S.shots });
    run(shot);
  }
  // Удар: проиграть анимацию по шагам физики, затем правила (на копии — тот же результат)
  function run(shot){
    busy = true;
    api.sfx('move');
    const T = { ...S, balls: cloneB(S.balls), groups: S.groups.slice() };
    const before = S.balls.filter(b => b.in).length;
    play(T, shot);   // итог по правилам
    const B = cloneB(S.balls), ev = { first: -1, pocketed: [], rails: 0, hits: 0 };
    strike(B, shot);
    let steps = 0;
    anim = { B };
    const tick = () => {
      if (!anim) return;
      let moving = true;
      for (let i = 0; i < 6 && moving; i++) { moving = step(B, ev); steps++; }
      draw();
      if (moving && steps < 240 * 25) { raf = requestAnimationFrame(tick); return; }
      anim = null;
      Object.assign(S, T);
      busy = false;
      const potted = before - S.balls.filter(b => b.in).length;
      if (potted > 0) api.sfx('ok');
      after();
    };
    raf = requestAnimationFrame(tick);
  }
  function after(){
    hud();
    if (S.over) return over();
    if (vs === 'bot' && S.turn === 1) later(botTurn, 700);
    if (vs === 'online' && S.turn === myIdx) api.sfx('tick');
  }
  function botTurn(){
    if (!S || S.over || S.turn !== 1) return;
    const shot = botShot(S, lv, Math.random);
    hud();
    later(() => run(shot), 650);
  }
  function over(){
    const win = vs === 'duo' ? null : S.winner === myIdx;
    const msg = root.querySelector('.pl-msg');
    msg.innerHTML = `${S.msg}<br><b>${vs === 'duo' ? `🏆 Победил ${esc(names[S.winner])}` : win ? '🏆 Победа!' : `😔 Победил ${esc(names[S.winner])}`}</b>`;
    api.sfx(win === false ? 'bad' : 'win');
    root.querySelector('.pl-acts').innerHTML = `${vs === 'online' ? (room?.isHost ? '<button type="button" class="ct-start" data-act="rematch">↻ Реванш</button>' : '<span class="un-sub">Ждём реванша от соперника…</span>') : '<button type="button" class="ct-start" data-act="again">↻ Ещё партия</button>'}<button type="button" class="un-btn" data-act="leave">${vs === 'online' ? '🚪 Выйти' : '🏠 Меню'}</button>`;
    if (vs === 'bot') api.report('pool_' + lv, win, win ? 1 : 0, (api.local().wins || 0) + (win ? 1 : 0));
    else if (vs === 'online') api.report('pool_online', win, win ? 1 : 0, (api.local().wins || 0) + (win ? 1 : 0));
  }
  function hud(){
    if (!S) return;
    for (const p of [0, 1]) {
      const el = root.querySelector('#plP' + p);
      if (!el) continue;
      const g = S.groups[p], left = g ? S.balls.filter(b => b.in && ofGroup(b.n, g)).map(b => b.n) : [];
      el.className = 'pl-pl' + (p ? ' right' : '') + (S.turn === p && !S.over ? ' turn' : '');
      el.innerHTML = `<b>${esc(names[p])}</b><span class="pl-g">${g ? `${GNAME[g]}: ${left.length ? left.map(n => `<i style="--bc:${COL[n]}" class="${isStripe(n) ? 'st' : ''}">${n}</i>`).join('') : '<i style="--bc:#111">8</i>'}` : 'группа не выбрана'}</span>`;
    }
    const msg = root.querySelector('.pl-msg');
    if (msg && !S.over) msg.innerHTML = `${esc(S.msg)}${S.inHand && myTurn() ? '<br>✋ <b>Шар в руке:</b> перетащи белый биток' + (S.kitchen ? ' (в левой четверти стола)' : '') : ''}<br>${myTurn() ? '🟢 Твой удар: целься и тяни полоску силы' : `⏳ Бьёт ${esc(names[S.turn])}…`}`;
    root.querySelector('.pl-acts').innerHTML = '';
    draw();
  }

  // ── Рисование ──
  function ballAt(b, x, y, k){
    const rr = R * k, [X, Y] = toScreen(x, y);
    ctx.save();
    ctx.beginPath(); ctx.arc(X, Y, rr, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = isStripe(b.n) ? '#f8f8f2' : COL[b.n]; ctx.fill();
    if (isStripe(b.n)) { ctx.save(); ctx.clip(); ctx.fillStyle = COL[b.n]; ctx.fillRect(X - rr, Y - rr * .55, rr * 2, rr * 1.1); ctx.restore(); }
    if (b.n) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X, Y, rr * .48, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#111'; ctx.font = `800 ${Math.round(rr * .72)}px Montserrat,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.n, X, Y + rr * .04); }
    const g = ctx.createRadialGradient(X - rr * .35, Y - rr * .4, rr * .1, X, Y, rr);
    g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(.35, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.35)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, rr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function draw(){
    if (!ctx || !cv) return;
    const k = scale * dpr, Wc = cv.width, Hc = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#5b3417'; ctx.fillRect(0, 0, Wc, Hc);
    ctx.fillStyle = '#7a4a24'; ctx.fillRect(8 * dpr, 8 * dpr, Wc - 16 * dpr, Hc - 16 * dpr);
    const [x0, y0] = toScreen(0, 0), [x1, y1] = toScreen(W, H);
    const fx = Math.min(x0, x1), fy = Math.min(y0, y1), fw = Math.abs(x1 - x0), fh = Math.abs(y1 - y0);
    const felt = ctx.createRadialGradient(fx + fw / 2, fy + fh / 2, 10, fx + fw / 2, fy + fh / 2, Math.max(fw, fh) * .7);
    felt.addColorStop(0, '#1f9a5a'); felt.addColorStop(1, '#0f6b3c');
    ctx.fillStyle = felt; ctx.fillRect(fx, fy, fw, fh);
    // линия «дома» и точка
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1.5 * dpr;
    const [ka, kb] = [toScreen(KITCHEN, 0), toScreen(KITCHEN, H)];
    ctx.beginPath(); ctx.moveTo(ka[0], ka[1]); ctx.lineTo(kb[0], kb[1]); ctx.stroke();
    const [fsx, fsy] = toScreen(FOOT[0], FOOT[1]); ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.arc(fsx, fsy, 2.5 * dpr, 0, Math.PI * 2); ctx.fill();
    for (const [px, py, pr] of POCKETS) { const [X, Y] = toScreen(px, py); ctx.fillStyle = '#0b0b0b'; ctx.beginPath(); ctx.arc(X, Y, (pr - 4) * k, 0, Math.PI * 2); ctx.fill(); }
    if (!S) return;
    const B = anim ? anim.B : S.balls;
    // прицел
    if (!anim && myTurn() && !S.over) {
      const c = B[0], hit = rayHit(B, c.x, c.y, aim.dx, aim.dy);
      const [cx, cy] = toScreen(c.x, c.y), [hx, hy] = toScreen(hit.x, hit.y);
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2 * dpr; ctx.setLineDash([6 * dpr, 6 * dpr]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(hx, hy); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(hx, hy, R * k, 0, Math.PI * 2); ctx.stroke();
      if (hit.ball) { const t = hit.ball, nx = t.x - hit.x, ny = t.y - hit.y, nl = Math.sqrt(nx * nx + ny * ny) || 1, [tx, ty] = toScreen(t.x, t.y), [ex, ey] = toScreen(t.x + nx / nl * 90, t.y + ny / nl * 90); ctx.strokeStyle = 'rgba(255,209,102,.9)'; ctx.lineWidth = 2.5 * dpr; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(ex, ey); ctx.stroke(); }
      // кий
      const back = 30 + power * 120, [qa, qb] = toScreen(c.x - aim.dx * (R + 8 + back), c.y - aim.dy * (R + 8 + back)), [qc, qd] = toScreen(c.x - aim.dx * (R + 300 + back), c.y - aim.dy * (R + 300 + back));
      ctx.strokeStyle = '#e8c48a'; ctx.lineWidth = 7 * dpr * scale; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(qa, qb); ctx.lineTo(qc, qd); ctx.stroke();
      ctx.strokeStyle = '#3b2412'; ctx.lineWidth = 9 * dpr * scale; ctx.beginPath(); const [qe, qf] = toScreen(c.x - aim.dx * (R + 230 + back), c.y - aim.dy * (R + 230 + back)); ctx.moveTo(qe, qf); ctx.lineTo(qc, qd); ctx.stroke(); ctx.lineCap = 'butt';
    }
    for (const b of B) if (b.in) ballAt(b, b.x, b.y, k);
    if (S.inHand && myTurn() && !anim) { const [X, Y] = toScreen(B[0].x, B[0].y); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.arc(X, Y, R * k + 5 * dpr, 0, Math.PI * 2); ctx.stroke(); }
  }
  // Куда придёт биток по прямой: первый шар (или борт)
  function rayHit(B, x, y, dx, dy){
    let best = 1e9, ball = null;
    for (const b of B) {
      if (!b.in || b.n === 0) continue;
      const fx = b.x - x, fy = b.y - y, t = fx * dx + fy * dy;
      if (t <= 0) continue;
      const d2 = fx * fx + fy * fy - t * t;
      if (d2 > D2) continue;
      const tt = t - Math.sqrt(D2 - d2);
      if (tt < best) { best = tt; ball = b; }
    }
    let wall = 1e9;
    if (dx > 0) wall = Math.min(wall, (W - R - x) / dx); else if (dx < 0) wall = Math.min(wall, (R - x) / dx);
    if (dy > 0) wall = Math.min(wall, (H - R - y) / dy); else if (dy < 0) wall = Math.min(wall, (R - y) / dy);
    const t = Math.min(best, wall);
    return { x: x + dx * t, y: y + dy * t, ball: best <= wall ? ball : null };
  }

  function start(kind, seed){
    vs = kind; mode = 'play'; busy = false; anim = null;
    S = newState(seed ?? Math.floor(Math.random() * 2 ** 31));
    names = kind === 'bot' ? ['Ты', '🤖 Бот (' + LEVELS[lv].label.toLowerCase() + ')'] : kind === 'duo' ? ['Игрок 1', 'Игрок 2'] : names;
    aim = { dx: 1, dy: 0 }; power = 0;
    build(); hud();
  }

  // ═══ ОНЛАЙН (комната на двоих, room.js): хозяин — первый удар; передаём только удары ═══
  function joinOnline(code){
    root.innerHTML = '';
    GameRoom.lobby(root, 'pool', code);
    room = GameRoom.join('pool', code, {
      onError: () => { root.innerHTML = GameRoom.errorHtml; },
      onFull: () => { root.innerHTML = GameRoom.fullHtml('pool'); },
      onPeer: (opp, r) => {
        if (!opp) { if (mode === 'play') { api.toast('Соперник вышел'); } else GameRoom.lobbyText(root, 'Ты в комнате. <b>Ждём соперника…</b>'); return; }
        if (r.isHost) { const seed = Math.floor(Math.random() * 2 ** 31); r.send({ type: 'start', seed, hostNick: r.nick }); begin(seed, true, opp.nick); }
        else GameRoom.lobbyText(root, `<b>${esc(opp.nick)}</b> на месте — начинаем…`);
      },
      onMessage: m => {
        if (m.type === 'start' && !room.isHost) begin(m.seed, false, m.hostNick || 'Соперник');
        else if (m.type === 'place' && S && S.turn !== myIdx && S.inHand && !busy) { if (canPlace(S, m.x, m.y)) { S.balls[0].x = m.x; S.balls[0].y = m.y; draw(); } }
        else if (m.type === 'shot' && S && S.turn !== myIdx && !busy && m.n === S.shots) {
          if (m.cue && S.inHand && canPlace(S, m.cue.x, m.cue.y)) { S.balls[0].x = m.cue.x; S.balls[0].y = m.cue.y; }
          run(roundShot(m.shot));
        } else if (m.type === 'rematch' && !room.isHost) begin(m.seed, false, names[0]);
      },
    });
    if (!room) root.innerHTML = GameRoom.errorHtml;
  }
  function begin(seed, host, oppNick){
    myIdx = host ? 0 : 1;
    names = host ? ['Ты', oppNick] : [oppNick, 'Ты'];
    vs = 'online'; start('online', seed);
    names = host ? ['Ты', oppNick] : [oppNick, 'Ты'];
    hud();
  }

  function onClick(e){
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a.startsWith('lv:')) { lv = a.slice(3); menu(); }
    else if (a === 'bot') { myIdx = 0; start('bot'); }
    else if (a === 'duo') { myIdx = 0; start('duo'); }
    else if (a === 'online') location.hash = '#/games/pool/' + GameRoom.newCode();
    else if (a === 'again') { myIdx = 0; start(vs); }
    else if (a === 'rematch') { if (room?.isHost) { const seed = Math.floor(Math.random() * 2 ** 31); room.send({ type: 'rematch', seed }); begin(seed, true, names[1]); } }
    else if (a === 'leave') { if (vs === 'online') location.hash = '#/games/pool'; else menu(); }
  }

  window.GAME_IMPL.pool = {
    mount(el, gameApi){
      root = el; api = gameApi;
      root.addEventListener('click', onClick);
      window.addEventListener('resize', resize);
      if (GameRoom.validCode(gameApi.param)) joinOnline(gameApi.param); else menu();
    },
    unmount(){
      timers.forEach(clearTimeout); timers = [];
      cancelAnimationFrame(raf); anim = null;
      root?.removeEventListener('click', onClick);
      window.removeEventListener('resize', resize);
      room?.leave(); room = null;
      S = null; root = null; cv = null; ctx = null;
    },
    _test: { rack, simulate, play, newState, botShot, canPlace, cloneB, roundShot, hashB, POCKETS, W, H, R },
  };
})();
