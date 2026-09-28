// ═══════════════════════════════════════
//  ИГРА «КРЕСТИКИ-НОЛИКИ» — против бота (3 уровня), вдвоём на экране или онлайн по ссылке
// ═══════════════════════════════════════
// «Непобедимый» — полный перебор (minimax): выиграть нельзя, ничья = успех.
// Онлайн — js/games/room.js: #/games/ttt/<код>. Кто ходит первым, тот ❌.
(() => {
  const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  const LEVELS = { easy: 'Лёгкий', normal: 'Средний', hard: 'Непобедимый', duo: 'Вдвоём' };
  let root, api, T, R = null, timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); };

  const winner = b => {
    for (const [a, c, d] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return { who: b[a], line: [a, c, d] };
    return b.every(Boolean) ? { who: 'draw' } : null;
  };

  function minimax(b, player, depth){
    const w = winner(b);
    if (w) return { score: w.who === 'O' ? 10 - depth : w.who === 'X' ? depth - 10 : 0 };
    let best = { score: player === 'O' ? -Infinity : Infinity, idx: -1 };
    for (let i = 0; i < 9; i++) {
      if (b[i]) continue;
      b[i] = player;
      const r = minimax(b, player === 'O' ? 'X' : 'O', depth + 1);
      b[i] = null;
      if (player === 'O' ? r.score > best.score : r.score < best.score) best = { score: r.score, idx: i };
    }
    return best;
  }

  function botPick(){
    const free = T.board.map((v, i) => v ? -1 : i).filter(i => i >= 0);
    const rnd = () => free[Math.floor(Math.random() * free.length)];
    if (T.level === 'easy') return rnd();
    if (T.level === 'normal' && Math.random() < .35) return rnd();
    return minimax(T.board.slice(), 'O', 0).idx;
  }

  function renderSetup(){
    let lvl = 'normal';
    try { lvl = localStorage.getItem('d37_ttt_level') || 'normal'; } catch (e) {}
    const st = api.local();
    root.innerHTML = `<div class="ct-setup">
        <div class="ct-row"><span>Соперник</span><div class="ct-opts">${Object.entries(LEVELS).map(([k, l]) => `<button class="ct-opt${k === lvl ? ' active' : ''}" data-l="${k}">${l}</button>`).join('')}</div></div>
        <button class="ct-start" id="tStart">▶ Играть</button>
        <button class="ct-duel-btn" id="tOnline">👥 Играть с другом онлайн</button>
        <div class="ct-stats">Побед над ботом: <b>${st.wins || 0}</b> · Игр: <b>${st.plays || 0}</b></div>
      </div>`;
    root.querySelectorAll('.ct-opt').forEach(b => b.onclick = () => {
      lvl = b.dataset.l;
      try { localStorage.setItem('d37_ttt_level', lvl); } catch (e) {}
      root.querySelectorAll('.ct-opt').forEach(x => x.classList.toggle('active', x === b));
    });
    root.querySelector('#tStart').onclick = () => start(lvl);
    root.querySelector('#tOnline').onclick = () => { location.hash = '#/games/ttt/' + GameRoom.newCode(); };
  }

  // online: { mark: 'X'|'O' } — какой знак мой
  function start(level, online){
    T = { level, board: Array(9).fill(null), turn: 'X', over: false, first: T?.first === 'X' ? 'O' : 'X', online: online || null, n: 0 };
    if (level !== 'duo' && level !== 'online') T.turn = T.first === 'X' ? 'X' : 'O';   // с ботом первый ход по очереди
    const badge = online ? `👥 против ${esc(R?.opp?.nick || 'соперника')} · ты ${online.mark === 'X' ? '❌' : '⭕'}` : LEVELS[level];
    root.innerHTML = `<div class="tt">
        <div class="ct-top"><span class="ct-badge">${badge}</span><span class="ct-status" id="tStatus"></span></div>
        <div class="tt-board" id="tBoard">${Array.from({ length: 9 }, (_, i) => `<button class="tt-cell" data-i="${i}" aria-label="Клетка ${i + 1}"></button>`).join('')}</div>
        <div class="ct-actions" id="tActions">${online ? '' : '<button id="tAgain">↻ Заново</button><button id="tSetup">⚙ Соперник</button>'}</div>
      </div>`;
    root.querySelectorAll('.tt-cell').forEach(c => c.onclick = () => humanMove(+c.dataset.i));
    if (!online) {
      root.querySelector('#tAgain').onclick = () => start(level);
      root.querySelector('#tSetup').onclick = renderSetup;
    }
    status();
    if (!online && level !== 'duo' && T.turn === 'O') later(botMove, 450);
  }

  function status(text){
    const el = root.querySelector('#tStatus');
    if (text) { el.innerHTML = text; return; }
    if (T.online) el.textContent = T.turn === T.online.mark ? `Твой ход ${T.online.mark === 'X' ? '❌' : '⭕'}` : `Ход ${R?.opp?.nick || 'соперника'}…`;
    else el.textContent = T.level === 'duo' ? `Ходит ${T.turn === 'X' ? '❌' : '⭕'}` : T.turn === 'X' ? 'Твой ход ❌' : '🤖 думает…';
  }

  function place(i, who){
    T.board[i] = who;
    T.n++;
    const cell = root.querySelectorAll('.tt-cell')[i];
    cell.textContent = who === 'X' ? '❌' : '⭕';
    cell.disabled = true;
    api.sfx('move');
    const w = winner(T.board);
    if (w) return end(w);
    T.turn = who === 'X' ? 'O' : 'X';
    status();
  }

  function humanMove(i){
    if (T.over || T.board[i]) return;
    if (T.online) {
      if (T.turn !== T.online.mark) return;
      place(i, T.online.mark);
      R?.send({ type: 'move', i, n: T.n });
      return;
    }
    if (T.level !== 'duo' && T.turn !== 'X') return;
    place(i, T.turn);
    if (!T.over && T.level !== 'duo') later(botMove, 350 + Math.random() * 350);
  }
  function botMove(){ if (T && !T.over && root) place(botPick(), 'O'); }

  function end(w, note){
    T.over = true;
    root.querySelectorAll('.tt-cell').forEach(c => { c.disabled = true; });
    if (w.line) w.line.forEach(i => root.querySelectorAll('.tt-cell')[i].classList.add('win'));
    if (T.online) {
      const mine = w.who === T.online.mark, draw = w.who === 'draw';
      status(note || (draw ? '🤝 Ничья' : mine ? '🎉 Ты победил!' : `😔 Победил ${esc(R?.opp?.nick || 'соперник')}`));
      api.sfx(mine ? 'win' : draw ? 'ok' : 'bad');
      const acts = root.querySelector('#tActions');
      acts.innerHTML = '<button class="ct-start" id="tRematch">↻ Реванш</button><button id="tLeave">🚪 Выйти</button>';
      acts.querySelector('#tRematch').onclick = rematch;
      acts.querySelector('#tLeave').onclick = () => { location.hash = '#/games/ttt'; };
      // Короткую «победу» (соперник вышел на 1–2 ходу) не засчитываем — защита от накрутки
      if (T.n >= 5 || w.line) api.report('ttt_online', mine, mine ? 2 : draw ? 1 : 0, 0);
      return;
    }
    if (T.level === 'duo') { status(w.who === 'draw' ? '🤝 Ничья' : `🎉 Победил ${w.who === 'X' ? '❌' : '⭕'}`); api.sfx('win'); return; }
    const res = w.who === 'X' ? 2 : w.who === 'draw' ? 1 : 0;
    status(res === 2 ? '🎉 Ты победил!' : res === 1 ? (T.level === 'hard' ? '🤝 Ничья с непобедимым — это успех!' : '🤝 Ничья') : '🤖 Бот победил');
    api.sfx(res ? 'win' : 'bad');
    // У «Непобедимого» ничья считается победой
    const win = res === 2 || (T.level === 'hard' && res === 1);
    api.report('ttt_' + T.level, win, res, T.level === 'hard' ? res : 0);
  }

  // ═══ Онлайн ═══
  const O = { round: 0, rematch: { me: false, opp: false }, started: false };
  function online(code){
    GameRoom.lobby(root, 'ttt', code);
    O.round = 0; O.started = false;
    R = GameRoom.join('ttt', code, {
      onError: () => { if (root) root.innerHTML = GameRoom.errorHtml; },
      onFull: () => { if (root) root.innerHTML = GameRoom.fullHtml('ttt'); },
      onPeer: (opp, room) => {
        if (!root) return;
        if (!opp) {
          if (T?.online && !T.over) end({ who: T.online.mark }, `🎉 ${esc(R?.lastOpp || 'Соперник')} вышел — победа`);
          else if (!O.started) GameRoom.lobbyText(root, 'Ты в комнате. <b>Ждём друга…</b>');
          return;
        }
        // Другой человек или соперник обновил страницу — хозяин начинает новую партию
        const newcomer = R.lastOppId && R.lastOppId !== opp.id;
        R.lastOpp = opp.nick; R.lastOppId = opp.id;
        if (!O.started || newcomer) {
          if (room.isHost) hostStart();
          else if (!O.started) GameRoom.lobbyText(root, `<b>${esc(opp.nick)}</b> на месте — начинаем…`);
        }
      },
      onMessage: m => {
        if (m.type === 'start' && R && !R.isHost) return begin(m);
        if (!T?.online) return;
        if (m.type === 'move') {
          const oppMark = T.online.mark === 'X' ? 'O' : 'X';
          if (T.over || T.turn !== oppMark || m.n !== T.n + 1 || T.board[m.i] || !(m.i >= 0 && m.i < 9)) return;
          place(m.i, oppMark);
        } else if (m.type === 'rematch') {
          O.rematch.opp = true;
          if (R.isHost && O.rematch.me) hostStart();
          else if (T.over) status(`${esc(R.opp?.nick || 'Соперник')} хочет реванш — жми «↻ Реванш»!`);
        }
      },
    });
    if (!R) root.innerHTML = GameRoom.errorHtml;
  }
  function hostStart(){
    O.round++;
    const first = O.round % 2 === 1 ? R.opp.id : R.myId;   // первую партию начинает гость
    const msg = { type: 'start', first, round: O.round };
    R.send(msg);
    begin(msg);
  }
  function begin(m){
    O.started = true; O.round = m.round; O.rematch = { me: false, opp: false };
    start('online', { mark: m.first === R.myId ? 'X' : 'O' });
  }
  function rematch(){
    O.rematch.me = true;
    R?.send({ type: 'rematch' });
    if (R?.isHost && O.rematch.opp) hostStart();
    else status(`Ждём ${esc(R?.opp?.nick || 'соперника')}…`);
  }

  window.GAME_IMPL.ttt = {
    mount(el, gameApi){
      root = el; api = gameApi; T = null;
      if (GameRoom.validCode(gameApi.param)) online(gameApi.param); else renderSetup();
    },
    unmount(){ timers.forEach(clearTimeout); timers = []; if (T) T.over = true; R?.leave(); R = null; root = null; },
  };
})();
