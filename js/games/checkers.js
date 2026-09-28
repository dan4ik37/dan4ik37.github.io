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
  function start(level, onlineMe){
    timers.forEach(clearTimeout); timers = [];
    const prevMe = G?.me;
    const me = onlineMe || (level === 'duo' ? 'w' : (prevMe === 'w' ? 'b' : 'w'));   // с ботом цвет по очереди
    G = { level, board: initial(), turn: 'w', me, bot: level === 'duo' || onlineMe ? null : other(me), sel: null, moves: [], over: false, quiet: 0, n: 0, last: null, online: !!onlineMe };
    const badge = G.online ? `👥 против ${esc(R?.opp?.nick || 'соперника')}` : LEVELS[level].label;
    root.innerHTML = `<div class="ck">
        <div class="ct-top"><span class="ct-badge">${badge}</span><span class="ct-score">Ты: <b>${level === 'duo' ? '⚪/⚫' : me === 'w' ? '⚪ белые' : '⚫ чёрные'}</b></span><span class="ct-status" id="kStatus"></span></div>
        <div class="ck-board" id="kBoard"></div>
        <div class="ct-actions" id="kActions">${G.online ? '<button id="kGiveUp">🏳 Сдаться</button>' : '<button id="kAgain">↻ Заново</button><button id="kSetup">⚙ Соперник</button>'}</div>
      </div>`;
    if (G.online) root.querySelector('#kGiveUp').onclick = () => finish(false, 'Ты сдался', true);
    else { root.querySelector('#kAgain').onclick = () => start(level); root.querySelector('#kSetup').onclick = renderSetup; }
    turnStart();
  }

  const flipped = () => G.me === 'b';
  function draw(){
    const board = root.querySelector('#kBoard');
    const targets = new Set(G.sel ? G.moves.filter(m => m.from[0] === G.sel[0] && m.from[1] === G.sel[1]).map(m => m.to.join(',')) : []);
    const movable = new Set(G.moves.map(m => m.from.join(',')));
    const myTurn = isMyTurn();
    let html = '';
    for (let vr = 0; vr < 8; vr++) for (let vc = 0; vc < 8; vc++) {
      const r = flipped() ? 7 - vr : vr, c = flipped() ? 7 - vc : vc;
      const dark = (r + c) % 2 === 1, p = G.board[r][c], k = r + ',' + c;
      const cls = ['ck-cell', dark ? 'd' : 'l'];
      if (G.sel && G.sel[0] === r && G.sel[1] === c) cls.push('sel');
      if (targets.has(k)) cls.push('tgt');
      if (myTurn && movable.has(k)) cls.push('can');
      if (G.last && G.last.some(([a, b]) => a === r && b === c)) cls.push('last');
      html += `<div class="${cls.join(' ')}" data-r="${r}" data-c="${c}">${p ? `<span class="ck-p ${colorOf(p)}${isKing(p) ? ' k' : ''}"></span>` : ''}</div>`;
    }
    board.innerHTML = html;
  }
  function isMyTurn(){ return !G.over && (G.level === 'duo' || G.turn === G.me); }

  function status(t){ root.querySelector('#kStatus').innerHTML = t; }

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
    if (G.level === 'duo') status(`Ходят ${G.turn === 'w' ? '⚪ белые' : '⚫ чёрные'}${mustCap ? ' · бить обязательно!' : ''}`);
    else if (G.turn === G.me) status(`Твой ход${mustCap ? ' · бить обязательно!' : ''}`);
    else status(G.online ? `Ход ${esc(R?.opp?.nick || 'соперника')}…` : '🤖 думает…');
    draw();
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
    if (G.sel) {
      const opts = G.moves.filter(m => m.from[0] === G.sel[0] && m.from[1] === G.sel[1] && m.to[0] === r && m.to[1] === c);
      if (opts.length) {
        // Несколько путей в одну клетку — берём тот, где сбито больше
        const m = opts.sort((a, b) => b.caps.length - a.caps.length)[0];
        doMove(m);
        if (G.online) R?.send({ type: 'move', from: m.from, to: m.to, caps: m.caps.length, n: G.n });
        return;
      }
    }
    if (G.moves.some(m => m.from[0] === r && m.from[1] === c)) { G.sel = [r, c]; api.sfx('tick'); draw(); }
    else if (G.board[r][c] && colorOf(G.board[r][c]) === G.turn && G.moves[0]?.caps.length) status('Бить обязательно — выбери шашку, которая может бить');
  }

  function doMove(m){
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
    status(win === null ? `🤝 ${reason}` : win ? `🎉 Победа! ${reason}` : `😔 Поражение. ${reason}`);
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
    if (G.level !== 'duo' && win !== null) api.report('checkers_' + G.level, win, left, win ? left : 0);
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
    _test: { initial, legalMoves, apply },   // для проверки правил
  };
})();
