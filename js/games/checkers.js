// ═══════════════════════════════════════
//  ИГРА «ШАШКИ» (русские) — против бота, вдвоём на экране или онлайн по ссылке
// ═══════════════════════════════════════
// Правила: ходят по тёмным клеткам; простая — на одну вперёд, бьёт вперёд и назад;
// бить обязательно, бьют до конца серии; дошла до края (даже посреди боя) — дамка
// и продолжает бой как дамка; дамка ходит и бьёт на любое расстояние. Сбитые снимаются
// после хода («турецкий удар»: одну шашку дважды не бьют). Нет ходов — проигрыш.
// Доска: board[r][c], r=0 — верх (чёрные), белые снизу и ходят первыми.
// Фигуры: 'w','b' — простые, 'W','B' — дамки.
(() => {
  const LEVELS = { easy: { label: 'Лёгкий', depth: 1 }, normal: { label: 'Средний', depth: 3 }, hard: { label: 'Сложный', depth: 5 }, duo: { label: 'Вдвоём' } };
  const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  let root, api, G, R = null, timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); };

  const colorOf = p => p ? p.toLowerCase() : null;
  const isKing = p => p === 'W' || p === 'B';
  const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const other = col => col === 'w' ? 'b' : 'w';

  function initial(){
    const b = Array.from({ length: 8 }, () => Array(8).fill(null));
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) { if (r < 3) b[r][c] = 'b'; else if (r > 4) b[r][c] = 'w'; }
    }
    return b;
  }

  // ── Генерация ходов ──
  // Ход: { from:[r,c], to:[r,c], path:[[r,c]...], caps:[[r,c]...], king:boolean }
  function captures(b, r, c, piece, taken, path, out){
    const col = colorOf(piece), king = isKing(piece);
    let found = false;
    for (const [dr, dc] of DIRS) {
      if (king) {
        let rr = r + dr, cc = c + dc;
        while (inside(rr, cc) && !b[rr][cc]) { rr += dr; cc += dc; }
        if (!inside(rr, cc) || colorOf(b[rr][cc]) !== other(col) || taken.some(([a, d]) => a === rr && d === cc)) continue;
        const er = rr, ec = cc;
        const lands = [];
        rr += dr; cc += dc;
        while (inside(rr, cc) && !b[rr][cc]) { lands.push([rr, cc]); rr += dr; cc += dc; }
        if (!lands.length) continue;
        // Если с какой-то клетки приземления бой продолжается — обязаны выбрать такую
        const cont = lands.filter(([lr, lc]) => canCapture(b, lr, lc, piece, [...taken, [er, ec]], [r, c]));
        for (const [lr, lc] of (cont.length ? cont : lands)) {
          found = true;
          const t2 = [...taken, [er, ec]], p2 = [...path, [lr, lc]];
          if (!withMoved(b, [r, c], [lr, lc], piece, () => captures(b, lr, lc, piece, t2, p2, out))) out.push({ path: p2, caps: t2, king: true });
        }
      } else {
        const er = r + dr, ec = c + dc, lr = r + 2 * dr, lc = c + 2 * dc;
        if (!inside(lr, lc) || b[lr][lc] || colorOf(b[er][ec]) !== other(col) || taken.some(([a, d]) => a === er && d === ec)) continue;
        found = true;
        const promote = (col === 'w' && lr === 0) || (col === 'b' && lr === 7);
        const np = promote ? piece.toUpperCase() : piece;
        const t2 = [...taken, [er, ec]], p2 = [...path, [lr, lc]];
        if (!withMoved(b, [r, c], [lr, lc], np, () => captures(b, lr, lc, np, t2, p2, out))) out.push({ path: p2, caps: t2, king: isKing(np) });
      }
    }
    return found;
  }
  // Временно переставить шашку, выполнить fn, вернуть как было (сбитые остаются на доске до конца хода)
  function withMoved(b, [fr, fc], [tr, tc], piece, fn){
    const was = b[fr][fc];
    b[fr][fc] = null; b[tr][tc] = piece;
    const res = fn();
    b[tr][tc] = null; b[fr][fc] = was;
    return res;
  }
  function canCapture(b, r, c, piece, taken, from){
    const out = [];
    let res = false;
    withMoved(b, from, [r, c], piece, () => { res = captures(b, r, c, piece, taken, [[r, c]], out); });
    return res;
  }

  function legalMoves(b, col){
    const caps = [], quiet = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = b[r][c];
      if (colorOf(p) !== col) continue;
      const seqs = [];
      captures(b, r, c, p, [], [[r, c]], seqs);
      seqs.forEach(s => caps.push({ from: [r, c], to: s.path[s.path.length - 1], path: s.path, caps: s.caps, king: s.king || isKing(p) }));
      if (caps.length) continue;
      if (isKing(p)) {
        for (const [dr, dc] of DIRS) {
          let rr = r + dr, cc = c + dc;
          while (inside(rr, cc) && !b[rr][cc]) { quiet.push({ from: [r, c], to: [rr, cc], path: [[r, c], [rr, cc]], caps: [], king: true }); rr += dr; cc += dc; }
        }
      } else {
        const fwd = col === 'w' ? -1 : 1;
        for (const dc of [-1, 1]) {
          const rr = r + fwd, cc = c + dc;
          if (inside(rr, cc) && !b[rr][cc]) quiet.push({ from: [r, c], to: [rr, cc], path: [[r, c], [rr, cc]], caps: [], king: (col === 'w' && rr === 0) || (col === 'b' && rr === 7) });
        }
      }
    }
    return caps.length ? caps : quiet;   // бить обязательно
  }

  function apply(b, m){
    const nb = b.map(row => row.slice());
    const [fr, fc] = m.from, [tr, tc] = m.to;
    const p = nb[fr][fc];
    nb[fr][fc] = null;
    m.caps.forEach(([r, c]) => { nb[r][c] = null; });
    nb[tr][tc] = m.king ? p.toUpperCase() : p;
    return nb;
  }

  // ── Бот: minimax с альфа-бета отсечением ──
  function evaluate(b, col){
    let s = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = b[r][c];
      if (!p) continue;
      const mine = colorOf(p) === col ? 1 : -1;
      let v = isKing(p) ? 3.2 : 1;
      if (!isKing(p)) v += (colorOf(p) === 'w' ? 7 - r : r) * 0.05;   // продвижение
      if (c > 1 && c < 6 && r > 1 && r < 6) v += 0.08;                   // центр
      s += mine * v;
    }
    return s;
  }
  function search(b, col, me, depth, alpha, beta){
    const moves = legalMoves(b, col);
    if (!moves.length) return col === me ? -100 - depth : 100 + depth;
    if (depth === 0) return evaluate(b, me);
    if (col === me) {
      let v = -Infinity;
      for (const m of moves) { v = Math.max(v, search(apply(b, m), other(col), me, depth - 1, alpha, beta)); alpha = Math.max(alpha, v); if (alpha >= beta) break; }
      return v;
    }
    let v = Infinity;
    for (const m of moves) { v = Math.min(v, search(apply(b, m), other(col), me, depth - 1, alpha, beta)); beta = Math.min(beta, v); if (alpha >= beta) break; }
    return v;
  }
  function botChoose(){
    const moves = legalMoves(G.board, G.bot);
    if (!moves.length) return null;
    const depth = LEVELS[G.level].depth;
    if (G.level === 'easy' && Math.random() < .45) return moves[Math.floor(Math.random() * moves.length)];
    let best = -Infinity, pick = [];
    for (const m of moves) {
      const v = search(apply(G.board, m), other(G.bot), G.bot, depth - 1, -Infinity, Infinity) + Math.random() * 0.02;
      if (v > best + 1e-9) { best = v; pick = [m]; } else if (Math.abs(v - best) < 1e-9) pick.push(m);
    }
    return pick[Math.floor(Math.random() * pick.length)];
  }

  // ── Экран выбора ──
  function renderSetup(){
    let lvl = 'normal';
    try { lvl = localStorage.getItem('d37_checkers_level') || 'normal'; } catch (e) {}
    const st = api.local();
    root.innerHTML = `<div class="ct-setup">
        <div class="ct-row"><span>Соперник</span><div class="ct-opts">${Object.entries(LEVELS).map(([k, l]) => `<button class="ct-opt${k === lvl ? ' active' : ''}" data-l="${k}">${l.label}</button>`).join('')}</div></div>
        <button class="ct-start" id="kStart">▶ Играть</button>
        <button class="ct-duel-btn" id="kOnline">👥 Играть с другом онлайн</button>
        <div class="ct-stats">Побед: <b>${st.wins || 0}</b> · Игр: <b>${st.plays || 0}</b></div>
        <details class="ct-rules"><summary>Правила (русские шашки)</summary>
          <p>Ходят по тёмным клеткам, белые первыми. Простая шашка ходит на одну клетку вперёд, а бьёт и вперёд, и назад.
          Бить обязательно, и бьют до конца — можно несколько шашек за ход. Дошла до последнего ряда — становится дамкой
          (даже посреди боя) и дальше бьёт как дамка. Дамка ходит и бьёт на любое расстояние по диагонали.
          Проигрывает тот, у кого не осталось шашек или ходов.</p>
        </details>
      </div>`;
    root.querySelectorAll('.ct-opt').forEach(b => b.onclick = () => {
      lvl = b.dataset.l;
      try { localStorage.setItem('d37_checkers_level', lvl); } catch (e) {}
      root.querySelectorAll('.ct-opt').forEach(x => x.classList.toggle('active', x === b));
    });
    root.querySelector('#kStart').onclick = () => start(lvl);
    root.querySelector('#kOnline').onclick = () => { location.hash = '#/games/checkers/' + GameRoom.newCode(); };
  }

  // me — мой цвет ('w'/'b'); у бота — противоположный; вдвоём — оба
  // Отмена: с ботом — твой ход и ответ бота, одна за партию бесплатно (на случай промаха), дальше — партия тренировочная
  // (победа без XP и рекорда: иначе отменами обыгрывают «Сложного»); вдвоём — сколько угодно; онлайн — нельзя, ход
  // подтверждается «✅ Сходить». «↻ Заново», «⚙ Соперник» посреди партии и «🏳 Сдаться» спрашивают «Точно?».
  function start(level, onlineMe){
    timers.forEach(clearTimeout); timers = [];
    const prevMe = G?.me;
    const me = onlineMe || (level === 'duo' ? 'w' : (prevMe === 'w' ? 'b' : 'w'));   // с ботом цвет по очереди
    G = { level, board: initial(), turn: 'w', me, bot: level === 'duo' || onlineMe ? null : other(me), sel: null, moves: [], over: false, quiet: 0, n: 0, last: null, online: !!onlineMe,
      hist: [], takebacks: 0, practice: false, pend: null };
    const badge = G.online ? `👥 против ${esc(R?.opp?.nick || 'соперника')}` : LEVELS[level].label;
    root.innerHTML = `<div class="ck">
        <div class="ct-top"><span class="ct-badge">${badge}</span><span class="ct-score">Ты: <b>${level === 'duo' ? '⚪/⚫' : me === 'w' ? '⚪ белые' : '⚫ чёрные'}</b></span><span class="ct-status" id="kStatus"></span></div>
        <div class="ck-board" id="kBoard"></div>
        <div class="ct-actions" id="kActions"></div>
      </div>`;
    root.querySelector('#kActions').onclick = onAction;
    turnStart();
  }
  // Кнопки под доской — по состоянию партии
  function actions(){
    const el = root?.querySelector('#kActions');
    if (!el || G.over) return;
    if (G.pend) { el.innerHTML = '<button class="gk-go" data-k="commit">✅ Сходить</button><button data-k="uncommit">↩ Отмена</button>'; return; }
    if (G.online) { el.innerHTML = '<button data-k="giveup">🏳 Сдаться</button>'; return; }
    const can = G.level === 'duo' ? G.hist.length > 0 : G.hist.some(h => h.turn === G.me);
    el.innerHTML = `<button data-k="undo"${can ? '' : ' disabled'}>${G.level !== 'duo' && G.takebacks >= 1 && !G.practice ? '↩ Отменить ещё' : '↩ Отменить ход'}</button><button data-k="again">↻ Заново</button><button data-k="setup">⚙ Соперник</button>`;
  }
  async function onAction(e){
    const b = e.target.closest('[data-k]');
    if (!b || b.disabled || !G) return;
    const k = b.dataset.k, g0 = G;
    if (k === 'commit') { if (G.pend) commitMove(G.pend); return; }
    if (k === 'uncommit') { G.pend = null; actions(); draw(); return; }
    if (k === 'undo') { undo(); return; }
    // посреди партии — не потерять её от случайного нажатия
    const busy = !G.over && G.n >= 2;
    if (k === 'giveup') {
      if (window.GameKit && !await GameKit.ask({ icon: '🏳', title: 'Сдаться?', text: 'Партия закончится поражением.', yes: '🏳 Сдаться', no: 'Играть дальше', danger: true })) return;
      if (G === g0 && !G.over) finish(false, 'Ты сдался', true);
      return;
    }
    if ((k === 'again' || k === 'setup') && busy && window.GameKit && !await GameKit.ask({ icon: '↻', title: k === 'again' ? 'Начать заново?' : 'Сменить соперника?', text: 'Эта партия не доиграна и пропадёт.', yes: k === 'again' ? '↻ Заново' : '⚙ Сменить', no: 'Играть дальше' })) return;
    if (G !== g0) return;
    if (k === 'again') start(G.level); else if (k === 'setup') { timers.forEach(clearTimeout); timers = []; G.over = true; renderSetup(); }
  }
  // «↩ Отменить ход»: с ботом — до твоего последнего хода (и его ответа), вдвоём — один ход
  async function undo(){
    if (!G || G.over || G.online || !G.hist.length) return;
    if (G.level !== 'duo') {
      if (!G.hist.some(h => h.turn === G.me)) return;
      if (G.takebacks >= 1 && !G.practice) {
        const g0 = G, n0 = G.n;
        if (window.GameKit && !await GameKit.ask({ icon: '🎓', title: 'Отменить ещё ход?', text: 'Одна отмена за партию — на случай промаха — уже была. Отменишь ещё — партия станет тренировочной: победа не даст XP и не попадёт в рекорды.', yes: '↩ Отменить', no: 'Играть дальше' })) return;
        if (G !== g0 || G.over || G.n !== n0) return;
        G.practice = true;
      }
      G.takebacks++;
    }
    timers.forEach(clearTimeout); timers = [];   // бот ещё думал — пусть не ходит
    let h = G.hist.pop();
    if (G.level !== 'duo') while (h.turn !== G.me && G.hist.length) h = G.hist.pop();
    G.board = h.board; G.turn = h.turn; G.quiet = h.quiet; G.n = h.n; G.last = h.last; G.pend = null;
    api.sfx('tick');
    turnStart();
  }

  const flipped = () => G.me === 'b';
  function draw(){
    const board = root.querySelector('#kBoard');
    const pend = G.pend;
    const B = pend ? apply(G.board, pend) : G.board;   // онлайн: ход ждёт «Сходить» — уже на доске
    const targets = new Set(G.sel && !pend ? G.moves.filter(m => m.from[0] === G.sel[0] && m.from[1] === G.sel[1]).map(m => m.to.join(',')) : []);
    const movable = new Set(G.moves.map(m => m.from.join(',')));
    const myTurn = isMyTurn() && !pend;
    const path = pend ? pend.path : G.last;
    let html = '';
    for (let vr = 0; vr < 8; vr++) for (let vc = 0; vc < 8; vc++) {
      const r = flipped() ? 7 - vr : vr, c = flipped() ? 7 - vc : vc;
      const dark = (r + c) % 2 === 1, p = B[r][c], k = r + ',' + c;
      const cls = ['ck-cell', dark ? 'd' : 'l'];
      if (G.sel && !pend && G.sel[0] === r && G.sel[1] === c) cls.push('sel');
      if (targets.has(k)) cls.push('tgt');
      if (myTurn && movable.has(k)) cls.push('can');
      if (path && path.some(([a, b]) => a === r && b === c)) cls.push(pend ? 'pend' : 'last');
      html += `<div class="${cls.join(' ')}" data-r="${r}" data-c="${c}">${p ? `<span class="ck-p ${colorOf(p)}${isKing(p) ? ' k' : ''}"></span>` : ''}</div>`;
    }
    board.innerHTML = html;
  }
  function isMyTurn(){ return !G.over && (G.level === 'duo' || G.turn === G.me); }

  function status(t, mine){
    const el = root.querySelector('#kStatus');
    el.innerHTML = mine != null && window.GameKit ? GameKit.turn(mine, t) + (G.practice ? '<span class="gk-prac" title="Были отмены ходов — победа без XP и рекорда">🎓 тренировка</span>' : '') : t;
  }

  function turnStart(){
    G.moves = legalMoves(G.board, G.turn);
    G.sel = null;
    if (!G.moves.length) {
      const loserMe = G.level === 'duo' ? null : G.turn === G.me;
      draw();
      if (G.level === 'duo') return finish(null, `Ходов нет — победили ${G.turn === 'w' ? '⚫ чёрные' : '⚪ белые'}`);
      return finish(!loserMe, loserMe ? 'У тебя не осталось ходов' : (G.online ? `У ${esc(R?.opp?.nick || 'соперника')} не осталось ходов` : 'У бота не осталось ходов'));
    }
    if (G.quiet >= 40) { draw(); return finish(null, 'Ничья: 40 ходов без взятий'); }
    const mustCap = G.moves[0].caps.length > 0;
    if (G.level === 'duo') status(`Ходят ${G.turn === 'w' ? '⚪ белые' : '⚫ чёрные'}${mustCap ? ' · бить обязательно!' : ''}`, true);
    else if (G.turn === G.me) status(`🟢 Твой ход${mustCap ? ' · бить обязательно!' : ''}`, true);
    else status(G.online ? `⏳ Ход ${esc(R?.opp?.nick || 'соперника')}…` : '🤖 думает…', false);
    draw();
    actions();
    root.querySelector('#kBoard').onclick = onClick;
    if (G.bot && G.turn === G.bot) later(() => {
      if (!G || G.over || !root) return;
      const m = botChoose();
      if (m) doMove(m);
    }, 350 + Math.random() * 300);
  }

  function onClick(e){
    const cell = e.target.closest('.ck-cell');
    if (!cell || !isMyTurn()) return;
    const r = +cell.dataset.r, c = +cell.dataset.c;
    // онлайн-ход ждёт подтверждения: та же клетка — сходить, другая — передумал
    if (G.pend) { const t = G.pend.to; if (t[0] === r && t[1] === c) commitMove(G.pend); else { G.pend = null; actions(); draw(); } return; }
    if (G.sel) {
      const opts = G.moves.filter(m => m.from[0] === G.sel[0] && m.from[1] === G.sel[1] && m.to[0] === r && m.to[1] === c);
      if (opts.length) {
        // Несколько путей в одну клетку — берём тот, где сбито больше
        const m = opts.sort((a, b) => b.caps.length - a.caps.length)[0];
        if (G.online) { G.pend = m; api.sfx('tick'); actions(); draw(); return; }
        doMove(m);
        return;
      }
    }
    if (G.moves.some(m => m.from[0] === r && m.from[1] === c)) {
      // та же шашка ещё раз — выбор снят
      if (G.sel && G.sel[0] === r && G.sel[1] === c) G.sel = null; else { G.sel = [r, c]; api.sfx('tick'); }
      draw();
    }
    else if (G.board[r][c] && colorOf(G.board[r][c]) === G.turn && G.moves[0]?.caps.length) status('Бить обязательно — выбери шашку, которая может бить');
    else if (G.sel) { G.sel = null; draw(); }   // нажал мимо — выбор снят
  }
  function commitMove(m){
    G.pend = null;
    doMove(m);
    if (G.online) R?.send({ type: 'move', from: m.from, to: m.to, caps: m.caps.length, n: G.n });
  }

  function doMove(m){
    if (!G.online) G.hist.push({ board: G.board.map(row => row.slice()), turn: G.turn, quiet: G.quiet, n: G.n, last: G.last });   // для «Отменить ход»
    G.board = apply(G.board, m);
    G.n++;
    G.quiet = m.caps.length ? 0 : G.quiet + 1;
    G.last = m.path;
    api.sfx(m.caps.length ? 'ok' : 'move');
    G.turn = other(G.turn);
    turnStart();
  }

  function finish(win, reason, byMe){
    if (G.over) return;
    G.over = true;
    timers.forEach(clearTimeout); timers = [];
    draw();
    const left = G.board.flat().filter(p => colorOf(p) === G.me).length;
    G.pend = null;
    status((win === null ? `🤝 ${reason}` : win ? `🎉 Победа! ${reason}` : `😔 Поражение. ${reason}`) + (G.practice ? ' <span class="gk-prac" title="Были отмены ходов — без XP и рекорда">🎓 тренировка</span>' : ''));
    api.sfx(win ? 'win' : win === null ? 'ok' : 'bad');
    if (G.online) {
      if (byMe && !win) R?.send({ type: 'lose' });
      const acts = root.querySelector('#kActions');
      acts.innerHTML = '<button class="ct-start" id="kRematch">↻ Реванш</button><button id="kLeave">🚪 Выйти</button>';
      acts.querySelector('#kRematch').onclick = rematch;
      acts.querySelector('#kLeave').onclick = () => { location.hash = '#/games/checkers'; };
      if (G.n >= 10 && win !== null) api.report('checkers_online', win, left, 0);   // короткие партии — без XP
      return;
    }
    // тренировочная (были лишние отмены) — партия сыграна, но победа не в зачёт: ни XP, ни рекорда
    const counted = win && !G.practice;
    if (G.level !== 'duo' && win !== null) api.report('checkers_' + G.level, counted, counted ? left : 0, counted ? left : 0);
    const acts = root.querySelector('#kActions');
    if (acts) acts.innerHTML = `<button class="ct-start" data-k="again">↻ Ещё партия</button><button data-k="setup">⚙ Соперник</button>`;
  }

  // ═══ Онлайн ═══
  const O = { round: 0, rematch: { me: false, opp: false }, started: false };
  function online(code){
    GameRoom.lobby(root, 'checkers', code);
    O.round = 0; O.started = false;
    R = GameRoom.join('checkers', code, {
      onError: () => { if (root) root.innerHTML = GameRoom.errorHtml; },
      onFull: () => { if (root) root.innerHTML = GameRoom.fullHtml('checkers'); },
      onPeer: (opp, room) => {
        if (!root) return;
        if (!opp) {
          if (G?.online && !G.over) finish(true, `${esc(R?.lastOpp || 'Соперник')} вышел из игры`);
          else if (!O.started) GameRoom.lobbyText(root, 'Ты в комнате. <b>Ждём друга…</b>');
          return;
        }
        // Другой человек или соперник обновил страницу — хозяин начинает новую партию
        const newcomer = R.lastOppId && R.lastOppId !== opp.id;
        R.lastOpp = opp.nick; R.lastOppId = opp.id;
        if (!O.started || newcomer) { if (room.isHost) hostStart(); else if (!O.started) GameRoom.lobbyText(root, `<b>${esc(opp.nick)}</b> на месте — начинаем…`); }
      },
      onMessage: m => {
        if (m.type === 'start' && R && !R.isHost) return begin(m);
        if (!G?.online) return;
        if (m.type === 'move') {
          if (G.over || G.turn === G.me || m.n !== G.n + 1) return;
          const opts = G.moves.filter(x => x.from[0] === m.from[0] && x.from[1] === m.from[1] && x.to[0] === m.to[0] && x.to[1] === m.to[1]);
          if (!opts.length) return;   // рассинхрон — ход не по правилам, игнорируем
          doMove(opts.sort((a, b) => Math.abs(b.caps.length - m.caps) < Math.abs(a.caps.length - m.caps) ? 1 : -1)[0]);
        } else if (m.type === 'lose') {
          finish(true, `${esc(R.opp?.nick || 'Соперник')} сдался`);
        } else if (m.type === 'rematch') {
          O.rematch.opp = true;
          if (R.isHost && O.rematch.me) hostStart();
          else if (G.over) status(`${esc(R.opp?.nick || 'Соперник')} хочет реванш — жми «↻ Реванш»!`);
        }
      },
    });
    if (!R) root.innerHTML = GameRoom.errorHtml;
  }
  function hostStart(){
    O.round++;
    const white = O.round % 2 === 1 ? R.opp.id : R.myId;   // первую партию белыми играет гость
    const msg = { type: 'start', white, round: O.round };
    R.send(msg);
    begin(msg);
  }
  function begin(m){
    O.started = true; O.round = m.round; O.rematch = { me: false, opp: false };
    start('online', m.white === R.myId ? 'w' : 'b');
  }
  function rematch(){
    O.rematch.me = true;
    R?.send({ type: 'rematch' });
    if (R?.isHost && O.rematch.opp) hostStart();
    else status(`Ждём ${esc(R?.opp?.nick || 'соперника')}…`);
  }

  window.GAME_IMPL.checkers = {
    mount(el, gameApi){
      root = el; api = gameApi; G = null;
      if (GameRoom.validCode(gameApi.param)) online(gameApi.param); else renderSetup();
    },
    unmount(){ timers.forEach(clearTimeout); timers = []; if (G) G.over = true; R?.leave(); R = null; root = null; },
    _test: { initial, legalMoves, apply, search, evaluate },   // для проверки правил
    _dbg: () => G,   // проверка в браузере: состояние партии
  };
})();
