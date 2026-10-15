// ═══════════════════════════════════════
//  ИГРА «ЛУДО» — фишки и кубик (как Ludo King): с ботами или онлайн с друзьями (2–4 игрока)
// ═══════════════════════════════════════
// У каждого 4 фишки в домике. Выйти на старт можно, только выбросив 6. Шестёрка, сбитая фишка или фишка,
// дошедшая до финиша, — бросок ещё раз (три шестёрки подряд — ход сгорает). Встал на клетку с чужой фишкой
// (кроме безопасных ★ и стартовых) — она возвращается в домик. До финиша — точно по кубику.
// Кто первым привёл все 4 фишки, тот и победил.
// Онлайн — стол на 2–4 (js/games/table.js): кубик бросает хозяин стола (подкрутить нельзя), все сообщения —
// личные зашифрованные. Ключи сервера: ludo (с ботами), ludo_online.
(() => {
  const COLORS = [{ k: 'r', name: 'Красные', c: '#ef4444' }, { k: 'g', name: 'Зелёные', c: '#22c55e' }, { k: 'y', name: 'Жёлтые', c: '#eab308' }, { k: 'b', name: 'Синие', c: '#3b82f6' }];
  const BOTS = ['Бот Лёва', 'Бот Ася', 'Бот Тимур'];
  const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  // Общая дорожка (52 клетки поля 15×15), от старта красных по часовой
  const TRACK = (() => {
    const t = [], seg = (x0, y0, x1, y1) => { const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0), n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) t.push([x0 + sx * i, y0 + sy * i]); };
    seg(1, 6, 5, 6); seg(6, 5, 6, 0); seg(7, 0, 8, 0); seg(8, 1, 8, 5); seg(9, 6, 14, 6); seg(14, 7, 14, 8);
    seg(13, 8, 9, 8); seg(8, 9, 8, 14); seg(7, 14, 6, 14); seg(6, 13, 6, 9); seg(5, 8, 0, 8); seg(0, 7, 0, 6);
    return t;
  })();
  const START = [0, 13, 26, 39];
  const SAFE = new Set([0, 13, 26, 39, 8, 21, 34, 47]);
  // Финишные дорожки (5 клеток) и финиш — для каждого цвета
  const HOME = [
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  ];
  const BASE = [[1.5, 1.5], [10.5, 1.5], [10.5, 10.5], [1.5, 10.5]];   // левый верхний угол домика (2×2 фишки)
  const FIN = 56;   // 0…50 — дорожка, 51…55 — своя финишная, 56 — финиш

  // ═══ ПРАВИЛА ═══
  // players: [{ id, nick, bot, color: 0..3 }]
  function newGame(players, rand){
    return { players, tok: players.map(() => [-1, -1, -1, -1]), turn: 0, roll: 0, sixes: 0, phase: 'roll', winner: -1, log: `Первым бросает ${players[0].nick}`, v: 0, rand, last: null };
  }
  const absPos = (G, p, pos) => (START[G.players[p].color] + pos) % 52;
  function movable(G, p, roll){
    const out = [];
    G.tok[p].forEach((pos, i) => {
      if (pos === FIN) return;
      if (pos < 0) { if (roll === 6) out.push(i); return; }
      if (pos + roll <= FIN) out.push(i);
    });
    return out;
  }
  // Бросок кубика (кубик бросает только хозяин стола / сам игрок в одиночной игре)
  function doRoll(G, p, value){
    if (G.winner >= 0 || G.turn !== p || G.phase !== 'roll') return 'Сейчас нельзя бросать';
    const r = value || 1 + Math.floor(G.rand() * 6);
    G.roll = r; G.last = null;
    const nick = G.players[p].nick;
    if (r === 6 && ++G.sixes === 3) { G.log = `${nick}: третья шестёрка подряд — ход сгорает`; nextTurn(G); G.v++; return null; }
    if (r !== 6) G.sixes = 0;
    const can = movable(G, p, r);
    if (!can.length) { G.log = `${nick} выбросил ${r} — ходить нечем`; if (r === 6) G.phase = 'roll'; else nextTurn(G); G.v++; return null; }
    G.phase = 'move';
    G.log = `${nick} выбросил ${r}`;
    G.v++;
    return null;
  }
  function doMove(G, p, i){
    if (G.winner >= 0 || G.turn !== p || G.phase !== 'move') return 'Сейчас нельзя ходить';
    if (!movable(G, p, G.roll).includes(i)) return 'Эта фишка не может так сходить';
    const nick = G.players[p].nick, from = G.tok[p][i];
    let to = from < 0 ? 0 : from + G.roll, bonus = false, msg = '';
    G.tok[p][i] = to;
    if (to <= 50) {
      const a = absPos(G, p, to);
      if (!SAFE.has(a)) G.players.forEach((_, q) => {
        if (q === p) return;
        G.tok[q].forEach((pos, j) => { if (pos >= 0 && pos <= 50 && absPos(G, q, pos) === a) { G.tok[q][j] = -1; bonus = true; msg = ` и сбивает фишку ${G.players[q].nick}!`; } });
      });
    }
    if (to === FIN) { bonus = true; msg = ' — фишка на финише!'; }
    G.last = { p, i, from, to };
    if (G.tok[p].every(x => x === FIN)) { G.winner = p; G.phase = 'over'; G.log = `${nick} привёл все фишки — победа!`; G.v++; return null; }
    G.log = `${nick}: ${from < 0 ? 'выводит фишку' : `ходит на ${G.roll}`}${msg}`;
    if (G.roll === 6 || bonus) { G.phase = 'roll'; if (bonus && G.roll !== 6) G.sixes = 0; G.log += ' Ещё бросок.'; }
    else nextTurn(G);
    G.v++;
    return null;
  }
  function nextTurn(G){ G.turn = (G.turn + 1) % G.players.length; G.phase = 'roll'; G.sixes = 0; }
  // Бот: выбрать фишку. Сбить > финиш > выйти на 6 > уйти от опасности > в финишную > самая продвинутая
  function botPick(G, p){
    const can = movable(G, p, G.roll);
    if (!can.length) return -1;
    let best = can[0], bs = -1e9;
    for (const i of can) {
      const from = G.tok[p][i], to = from < 0 ? 0 : from + G.roll;
      let s = to / 10;
      if (to === FIN) s += 60;
      if (from < 0) s += 40;
      if (to > 50 && from <= 50) s += 30;
      if (to <= 50) {
        const a = absPos(G, p, to);
        if (!SAFE.has(a) && G.players.some((_, q) => q !== p && G.tok[q].some(pos => pos >= 0 && pos <= 50 && absPos(G, q, pos) === a))) s += 80;
        if (SAFE.has(a)) s += 12;
        if (danger(G, p, to)) s -= 25;
      }
      if (from >= 0 && from <= 50 && danger(G, p, from)) s += 20;
      if (s > bs) { bs = s; best = i; }
    }
    return best;
  }
  // Можно ли сбить фишку на позиции pos (чужая фишка в 1–6 клетках позади)
  function danger(G, p, pos){
    const a = absPos(G, p, pos);
    if (SAFE.has(a)) return false;
    return G.players.some((_, q) => q !== p && G.tok[q].some(x => x >= 0 && x <= 50 && ((a - absPos(G, q, x) + 52) % 52) >= 1 && ((a - absPos(G, q, x) + 52) % 52) <= 6));
  }
  const pub = G => ({ players: G.players.map(pl => ({ id: pl.id, nick: pl.nick, bot: !!pl.bot, color: pl.color, look: pl.look || null })), tok: G.tok.map(t => t.slice()), turn: G.turn, roll: G.roll, phase: G.phase, winner: G.winner, log: G.log, last: G.last, v: G.v });
  // Выбор фишки (чистая функция): фишки на одной клетке — один и тот же ход. Нажал фишку — выбрана; ещё раз (или другую
  // с той же клетки) — ход; другую — выбор сменился. Вернёт { sel, move } (move — номер фишки для хода или -1)
  function tokPick(sel, i, tok){
    if (sel >= 0 && tok[sel] === tok[i]) return { sel: -1, move: sel };
    return { sel: i, move: -1 };
  }
  // Сколько разных ходов (фишки на одной клетке — один ход)
  const choices = (G, p, roll) => new Set(movable(G, p, roll).map(i => G.tok[p][i])).size;

  // ═══ ЭКРАН ═══
  const TURN_MS = 20000;   // онлайн: столько думает человек, потом ход за него
  let root, api, G = null, P = null, meIdx = 0, mode = 'menu', room = null, timers = [], botT = 0, tickT = 0, nBots = 3, bots = 0, code = '', cv, ctx, rolling = 0, animTok = null;
  let pickTok = -1, turnUntil = 0, lastV = -1;
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const online = () => !!room;
  const isHost = () => !room || room.isHost;
  const hostId = () => room?.seats[0]?.id;
  const colorsFor = n => n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3];

  function menu(){
    mode = 'menu'; G = null; P = null;
    const st = api.local();
    root.innerHTML = `<div class="dk-menu">
        <div class="pl-logo">🎲</div><div class="un-title">Лудо</div>
        <div class="un-sub">Брось кубик, выведи фишки на шестёрку и приведи все четыре домой первым. Сбивай фишки соперников — они вернутся в домик!</div>
        <div class="un-bots">Ботов: ${[1, 2, 3].map(k => `<button type="button" class="un-n${k === nBots ? ' sel' : ''}" data-act="nb:${k}">${k}</button>`).join('')}</div>
        <div class="ct-actions"><button type="button" class="ct-start" data-act="solo">▶ Играть с ботами</button><button type="button" class="ct-duel-btn" data-act="online">👥 С друзьями онлайн</button></div>
        ${st.plays ? `<div class="un-sub">Партий: <b>${st.plays}</b> · побед: <b>${st.wins || 0}</b></div>` : ''}
        <details class="un-rules"><summary>Правила</summary>
          <p>Выйти из домика на старт можно, только выбросив 6.</p>
          <p>Выпала 6, сбил фишку или довёл фишку до финиша — бросаешь ещё раз. Три шестёрки подряд — ход сгорает.</p>
          <p>Встал на клетку с чужой фишкой — она возвращается в домик. На ★ и стартовых клетках сбивать нельзя.</p>
          <p>До финиша нужно выбросить точное число. Кто первым привёл все 4 фишки — победил.</p>
        </details>
      </div>`;
  }
  function startSolo(){
    const n = 1 + nBots, cols = colorsFor(n);
    const players = [{ id: 'me', nick: GameRoom.nick(), color: cols[0], look: window.D37Char?.look() || null }];
    for (let i = 0; i < nBots; i++) players.push({ id: 'bot' + i, nick: BOTS[i], bot: true, color: cols[i + 1] });
    G = newGame(players, Math.random);
    meIdx = 0; mode = 'play';
    build(); sync();
  }
  function build(){
    root.innerHTML = `<div class="ld">
        <div class="ld-players"></div>
        <div class="ld-wrap"><canvas class="ld-cv"></canvas></div>
        <div class="un-log" aria-live="polite"></div>
        <div class="ld-ctl"><button type="button" class="ld-die" data-act="roll" aria-label="Бросить кубик">🎲</button><div class="un-status"></div></div>
        <div class="un-acts"></div>
        <div class="gk-hint"></div>
      </div>`;
    cv = root.querySelector('.ld-cv'); ctx = cv.getContext('2d');
    pickTok = -1;
    cv.addEventListener('pointerdown', onTap);
    resize();
  }
  function resize(){
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.min(cv.parentElement.clientWidth || 340, 560, Math.max(300, window.innerHeight - 260));
    cv.style.width = w + 'px'; cv.style.height = w + 'px';
    cv.width = cv.height = Math.round(w * dpr);
    draw();
  }
  function sync(){
    if (!G) return;
    P = pub(G);
    if (room) G.players.forEach(pl => { if (!pl.bot && pl.id !== room.myId) room.sendTo(pl.id, { type: 'up', pub: P }); });
    schedule();   // раньше рисования: отсчёт хода онлайн (turnUntil) уже свежий
    render();
  }
  function schedule(){
    clearTimeout(botT); clearTimeout(tickT);
    if (!G || G.winner >= 0 || !isHost()) return;
    const p = G.turn, pl = G.players[p], v = G.v;
    if (pl.bot) {
      botT = later(() => {
        if (!G || G.v !== v) return;
        if (G.phase === 'roll') doRoll(G, p);
        else { const i = botPick(G, p); if (i >= 0) doMove(G, p, i); }
        sync();
      }, G.phase === 'roll' ? 750 : 650);
      return;
    }
    // у человека одна возможная фишка — ходим сами через мгновение
    if (G.phase === 'move') {
      const can = movable(G, p, G.roll);
      if (new Set(can.map(i => G.tok[p][i])).size === 1) { botT = later(() => { if (G && G.v === v) { doMove(G, p, can[0]); sync(); } }, 450); return; }
    }
    if (room) {
      turnUntil = Date.now() + TURN_MS;
      tickT = later(() => {
        if (!G || G.v !== v) return;
        if (G.phase === 'roll') doRoll(G, p); else { const i = botPick(G, p); if (i >= 0) doMove(G, p, i); }
        sync();
      }, TURN_MS);
    }
  }
  function doAct(a){
    if (!P || P.winner >= 0) return;
    pickTok = -1;
    if (isHost()) {
      const err = a.a === 'roll' ? doRoll(G, meIdx) : doMove(G, meIdx, a.i);
      if (err) { api.toast(err); return; }
      api.sfx(a.a === 'roll' ? 'tick' : 'move');
      sync();
    } else room.sendTo(hostId(), { type: 'act', act: a });
  }

  // ── Поле ──
  function cellXY(p, pos, i){
    const col = P.players[p].color;
    if (pos < 0) { const [bx, by] = BASE[col]; return [bx + (i % 2) * 2 + .5, by + Math.floor(i / 2) * 2 + .5]; }
    if (pos <= 50) { const [x, y] = TRACK[(START[col] + pos) % 52]; return [x + .5, y + .5]; }
    const [x, y] = HOME[col][pos - 51]; return [x + .5, y + .5];
  }
  function draw(){
    if (!ctx || !cv) return;
    const S = cv.width, k = S / 15;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#f5f1e8'; ctx.fillRect(0, 0, S, S);
    // домики
    COLORS.forEach((c, i) => {
      const [bx, by] = [[0, 0], [9, 0], [9, 9], [0, 9]][i];
      ctx.fillStyle = c.c; ctx.fillRect(bx * k, by * k, 6 * k, 6 * k);
      ctx.fillStyle = '#fff'; ctx.fillRect((bx + 1) * k, (by + 1) * k, 4 * k, 4 * k);
      for (let j = 0; j < 4; j++) { const [x, y] = [BASE[i][0] + (j % 2) * 2 + .5, BASE[i][1] + Math.floor(j / 2) * 2 + .5]; ctx.fillStyle = c.c + '55'; ctx.beginPath(); ctx.arc(x * k, y * k, k * .55, 0, Math.PI * 2); ctx.fill(); }
    });
    // дорожка
    ctx.strokeStyle = '#bdb6a6'; ctx.lineWidth = Math.max(1, k * .04);
    TRACK.forEach(([x, y], i) => {
      const st = START.indexOf(i);
      ctx.fillStyle = st >= 0 ? COLORS[st].c : '#fff';
      ctx.fillRect(x * k, y * k, k, k); ctx.strokeRect(x * k, y * k, k, k);
      if (SAFE.has(i) && st < 0) { ctx.fillStyle = '#9ca3af'; ctx.font = `${Math.round(k * .6)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('★', (x + .5) * k, (y + .55) * k); }
    });
    HOME.forEach((h, i) => h.slice(0, 5).forEach(([x, y]) => { ctx.fillStyle = COLORS[i].c; ctx.fillRect(x * k, y * k, k, k); ctx.strokeRect(x * k, y * k, k, k); }));
    // центр — треугольники
    const c = 7.5 * k;
    [[6, 6, 6, 9], [6, 6, 9, 6], [9, 6, 9, 9], [6, 9, 9, 9]].forEach(([x0, y0, x1, y1], i) => {
      const col = [0, 1, 2, 3][i];
      ctx.fillStyle = COLORS[col].c; ctx.beginPath(); ctx.moveTo(x0 * k, y0 * k); ctx.lineTo(x1 * k, y1 * k); ctx.lineTo(c, c); ctx.closePath(); ctx.fill();
    });
    if (!P) return;
    // фишки (на одной клетке — чуть со сдвигом)
    const spots = new Map();
    P.tok.forEach((t, p) => t.forEach((pos, i) => { if (pos === FIN) return; const xy = cellXY(p, pos, i), key = pos < 0 ? `b${p}${i}` : xy.join(','); if (!spots.has(key)) spots.set(key, []); spots.get(key).push({ p, i, xy }); }));
    const can = P.turn === meIdx && P.phase === 'move' && P.winner < 0 ? movable({ players: P.players, tok: P.tok }, meIdx, P.roll) : [];
    const pulse = (performance.now() / 300) % 2 < 1;
    for (const list of spots.values()) list.forEach((s, j) => {
      const off = list.length > 1 ? (j - (list.length - 1) / 2) * k * .22 : 0;
      const X = s.xy[0] * k + off, Y = s.xy[1] * k + off * .4, col = COLORS[P.players[s.p].color].c;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(X, Y + k * .28, k * .3, k * .1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.strokeStyle = '#fff'; ctx.lineWidth = k * .08;
      ctx.beginPath(); ctx.arc(X, Y, k * .34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(X - k * .1, Y - k * .1, k * .1, 0, Math.PI * 2); ctx.fill();
      const picked = s.p === meIdx && pickTok >= 0 && P.tok[meIdx][pickTok] === P.tok[meIdx][s.i] && (P.tok[meIdx][s.i] >= 0 || s.i === pickTok);
      if (picked) { ctx.strokeStyle = '#16a34a'; ctx.lineWidth = k * .16; ctx.beginPath(); ctx.arc(X, Y, k * .5, 0, Math.PI * 2); ctx.stroke(); }
      else if (s.p === meIdx && can.includes(s.i)) { ctx.strokeStyle = pulse ? '#111' : '#fff'; ctx.lineWidth = k * .1; ctx.beginPath(); ctx.arc(X, Y, k * .46, 0, Math.PI * 2); ctx.stroke(); }
    });
    // выбранная фишка: куда встанет (призрак), чужую там собьёт — красный крест
    if (pickTok >= 0 && can.includes(pickTok)) {
      const from = P.tok[meIdx][pickTok], to = from < 0 ? 0 : from + P.roll;
      const [tx, ty] = cellXY(meIdx, to, pickTok), X = tx * k, Y = ty * k;
      ctx.save(); ctx.globalAlpha = .55; ctx.fillStyle = COLORS[P.players[meIdx].color].c;
      ctx.beginPath(); ctx.arc(X, Y, k * .34, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.setLineDash([k * .14, k * .1]); ctx.strokeStyle = '#16a34a'; ctx.lineWidth = k * .1;
      ctx.beginPath(); ctx.arc(X, Y, k * .48, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      const a = to <= 50 ? (START[P.players[meIdx].color] + to) % 52 : -1;
      if (a >= 0 && !SAFE.has(a) && P.tok.some((t, q) => q !== meIdx && t.some(pos => pos >= 0 && pos <= 50 && (START[P.players[q].color] + pos) % 52 === a))) {
        ctx.strokeStyle = '#dc2626'; ctx.lineWidth = k * .12; ctx.beginPath();
        ctx.moveTo(X - k * .25, Y - k * .25); ctx.lineTo(X + k * .25, Y + k * .25); ctx.moveTo(X + k * .25, Y - k * .25); ctx.lineTo(X - k * .25, Y + k * .25); ctx.stroke();
      }
    }
    // финишировавшие — счётчик в центре
    P.tok.forEach((t, p) => { const n = t.filter(x => x === FIN).length; if (!n) return; const [hx, hy] = HOME[P.players[p].color][5]; ctx.fillStyle = '#111'; ctx.font = `800 ${Math.round(k * .45)}px Montserrat,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(n, (hx + .5) * k, (hy + .5) * k); });
  }
  let pulseT = 0;
  function render(){
    if (!P || !cv) return;
    const me = meIdx, myTurn = P.turn === me && P.winner < 0;
    root.querySelector('.ld-players').innerHTML = P.players.map((pl, i) => `<div class="ld-pl${P.turn === i && P.winner < 0 ? ' turn' : ''}" style="--pc:${COLORS[pl.color].c}">
        <span class="ld-dot"></span><b>${esc(pl.nick)}${i === me ? ' (ты)' : ''}</b><small>${P.tok[i].filter(x => x === FIN).length}/4 дома</small></div>`).join('');
    root.querySelector('.un-log').textContent = P.log;
    const die = root.querySelector('.ld-die');
    die.textContent = P.roll ? DICE[P.roll - 1] : '🎲';
    die.disabled = !(myTurn && P.phase === 'roll');
    die.classList.toggle('go', myTurn && P.phase === 'roll');
    const moving = myTurn && P.phase === 'move';
    const can = moving ? movable({ players: P.players, tok: P.tok }, me, P.roll) : [];
    if (pickTok >= 0 && !can.includes(pickTok)) pickTok = -1;   // стол сменился — выбор снят
    const many = new Set(can.map(i => P.tok[me][i])).size > 1;
    const txt = P.winner >= 0 ? (P.winner === me ? '🏆 <b>Победа!</b>' : `😔 Победил ${esc(P.players[P.winner].nick)}`)
      : myTurn ? (P.phase === 'roll' ? '🟢 Брось кубик' : many ? '🟢 Выбери фишку' : '🟢 Ходит твоя фишка') : `⏳ Ходит ${esc(P.players[P.turn].nick)}…`;
    root.querySelector('.un-status').innerHTML = (P.winner >= 0 || !window.GameKit ? txt : GameKit.turn(myTurn, txt)) + (room && myTurn ? `<span class="gk-cd" data-gk-cd="${turnUntil}"></span>` : '');
    if (P.winner < 0) root.querySelector('.un-acts').innerHTML = pickTok >= 0 ? '<button type="button" class="un-btn gk-go" data-act="commit">▶ Ходить</button><button type="button" class="un-btn" data-act="cancel">✕ Отмена</button>' : '';
    const hint = root.querySelector('.gk-hint');
    if (hint) hint.innerHTML = P.winner >= 0 || !moving || !many ? '' : pickTok >= 0 ? `Призрак показывает, куда встанет. Нажми фишку ещё раз или «Ходить»; передумал — другую фишку${room ? ' · после хода отменить нельзя' : ''}` : 'Нажми фишку (подсвечены) — покажу, куда она встанет';
    draw();
    clearInterval(pulseT);
    if (moving) pulseT = setInterval(draw, 300);
    window.GameKit?.cd();
    if (P.winner >= 0 && mode === 'play') over();
  }
  // Нажал свою фишку: выбрать / сходить (если она уже выбрана)
  function pickTokEv(i){
    const r = tokPick(pickTok, i, P.tok[meIdx]);
    if (r.move >= 0) { doAct({ a: 'move', i: r.move }); return; }
    pickTok = r.sel; api.sfx('tick'); render();
  }
  function over(){
    mode = 'over';
    clearInterval(pulseT);
    const win = P.winner === meIdx;
    api.sfx(win ? 'win' : 'bad');
    root.querySelector('.un-acts').innerHTML = (isHost() ? '<button type="button" class="ct-start" data-act="again">↻ Ещё партия</button>' : '<span class="un-sub">Ждём, пока хозяин начнёт новую…</span>')
      + `<button type="button" class="un-btn" data-act="leave">${online() ? '🚪 Выйти' : '🏠 Меню'}</button>`;
    api.report(online() ? 'ludo_online' : 'ludo', win, win ? 1 : 0, (api.local().wins || 0) + (win ? 1 : 0));
  }
  function onTap(e){
    if (!P || P.turn !== meIdx || P.phase !== 'move' || P.winner >= 0) return;
    const r = cv.getBoundingClientRect(), k = r.width / 15, x = (e.clientX - r.left) / k, y = (e.clientY - r.top) / k;
    const can = movable({ players: P.players, tok: P.tok }, meIdx, P.roll);
    let best = -1, bd = 1.1;
    for (const i of can) { const [cx, cy] = cellXY(meIdx, P.tok[meIdx][i], i), d = Math.hypot(cx - x, cy - y); if (d < bd) { bd = d; best = i; } }
    if (best >= 0) pickTokEv(best);
    else if (pickTok >= 0) { pickTok = -1; render(); }   // нажал мимо фишек — выбор снят
  }
  function onClick(e){
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a.startsWith('nb:')) { nBots = +a.slice(3); menu(); return; }
    if (a === 'solo') { startSolo(); return; }
    if (a === 'online') { location.hash = '#/games/ludo/' + GameRoom.newCode(); return; }
    if (a === 'roll') { doAct({ a: 'roll' }); return; }
    if (a === 'commit') { if (pickTok >= 0) doAct({ a: 'move', i: pickTok }); return; }
    if (a === 'cancel') { pickTok = -1; render(); return; }
    if (a === 'again') { if (online()) hostStart(); else startSolo(); return; }
    if (a === 'leave') { if (online()) location.hash = '#/games/ludo'; else menu(); return; }
    if (a === 'copy') { const inp = root.querySelector('.ct-link input'); navigator.clipboard?.writeText(inp.value).then(() => { b.textContent = '✅ Скопировано'; }, () => inp.select()); return; }
    if (a === 'bot') { bots++; lobby(); return; }
    if (a.startsWith('unbot:')) { bots = Math.max(0, bots - 1); lobby(); return; }
    if (a === 'go') { hostStart(); return; }
  }

  // ═══ ОНЛАЙН ═══
  function seatList(){
    const list = (room?.seats || []).map(s => ({ id: s.id, nick: s.nick, me: s.me, look: s.look })).slice(0, 4);
    for (let i = 0; i < bots && list.length < 4; i++) list.push({ id: 'bot' + i, nick: BOTS[i], bot: true });
    return list;
  }
  function lobby(){
    if (!room || mode === 'play' || mode === 'over') return;
    mode = 'lobby';
    const seats = seatList();
    root.innerHTML = TableRoom.lobbyHtml(location.origin + location.pathname + '#/games/ludo/' + code, seats, 4, { title: '🎲 Лудо — стол', host: room.isHost, canStart: seats.length >= 2 });
  }
  function hostStart(){
    if (!room?.isHost) return;
    const seats = seatList(), cols = colorsFor(seats.length);
    const players = seats.map((s, i) => ({ id: s.id, nick: s.nick, bot: !!s.bot, color: cols[i], look: s.look || null }));
    if (players.length < 2) { api.toast('Нужно хотя бы двое: позови друга или добавь бота'); return; }
    G = newGame(players, Math.random);
    meIdx = players.findIndex(p => p.id === room.myId);
    mode = 'play';
    build(); sync();
  }
  function joinTable(c){
    code = c;
    root.innerHTML = '<div class="gm-loading"><div class="spinner"></div>Подключаемся к столу…</div>';
    room = TableRoom.join('ludo', c, {
      max: 4,
      onError: () => { root.innerHTML = GameRoom.errorHtml; },
      onFull: () => { root.innerHTML = GameRoom.fullHtml('ludo'); },
      onSeats: seats => {
        if (mode === 'play' || mode === 'over') {
          if (room.isHost && G) { G.players.forEach(pl => { if (!pl.bot && pl.id !== room.myId && !seats.some(s => s.id === pl.id)) { pl.bot = true; G.log = `${pl.nick} вышел — за него играет бот`; pl.nick += ' (бот)'; G.v++; } }); sync(); }
          else if (!room.isHost && P && !seats.some(s => s.id === P.players[0]?.id)) { api.toast('Хозяин стола вышел'); mode = 'lobby'; P = null; lobby(); }
          return;
        }
        lobby();
      },
      onPrivate: (m, from) => {
        if (room.isHost) {
          if (m.type !== 'act' || !G) return;
          const p = G.players.findIndex(pl => pl.id === from && !pl.bot);
          if (p < 0) return;
          const a = m.act || {};
          const err = a.a === 'roll' ? doRoll(G, p) : doMove(G, p, a.i | 0);
          if (err) { room.sendTo(from, { type: 'err', text: err }); return; }
          sync();
          return;
        }
        if (from !== hostId()) return;
        if (m.type === 'up') {
          const first = !P || mode !== 'play';
          P = m.pub;
          meIdx = P.players.findIndex(o => o.id === room.myId);
          if (meIdx < 0) return;
          if (first && P.winner < 0) { mode = 'play'; pickTok = -1; build(); }
          if (P.v !== lastV) { lastV = P.v; turnUntil = Date.now() + TURN_MS - 600; }   // хозяин заводит отсчёт на каждое изменение
          render();
          if (P.turn === meIdx) api.sfx('tick');
        } else if (m.type === 'err') api.toast(m.text);
      },
    });
    if (!room) root.innerHTML = GameRoom.errorHtml;
  }

  // Esc — снять выбор фишки (раньше выхода из полного экрана: он смотрит defaultPrevented)
  function onKey(e){
    if (e.key !== 'Escape' || pickTok < 0 || window.GameKit?.isOpen?.()) return;
    e.preventDefault(); pickTok = -1; render();
  }

  window.GAME_IMPL.ludo = {
    mount(el, gameApi){
      root = el; api = gameApi; pickTok = -1; lastV = -1;
      root.addEventListener('click', onClick);
      window.addEventListener('resize', resize);
      window.addEventListener('keydown', onKey, true);
      if (GameRoom.validCode(gameApi.param)) joinTable(gameApi.param); else menu();
    },
    unmount(){
      timers.forEach(clearTimeout); timers = [];
      clearTimeout(botT); clearTimeout(tickT); clearInterval(pulseT);
      root?.removeEventListener('click', onClick);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKey, true);
      room?.leave(); room = null;
      G = null; P = null; bots = 0; mode = 'menu'; pickTok = -1;
      root = null; cv = null; ctx = null;
    },
    _test: { newGame, doRoll, doMove, movable, botPick, TRACK, START, HOME, FIN, tokPick, choices },
    _dbg: () => ({ P, meIdx, pickTok, xy: (p, pos, i) => cellXY(p, pos, i) }),   // проверка в браузере: где фишка (клетки поля)
  };
})();
