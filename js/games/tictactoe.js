// ═══════════════════════════════════════
//  ИГРА «КРЕСТИКИ-НОЛИКИ» — против бота (3 уровня) или вдвоём
// ═══════════════════════════════════════
// «Непобедимый» — полный перебор (minimax): выиграть нельзя, ничья = успех.
(() => {
  const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  const LEVELS = { easy: 'Лёгкий', normal: 'Средний', hard: 'Непобедимый', duo: 'Вдвоём' };
  let root, api, T, timers = [];
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
        <div class="ct-stats">Побед над ботом: <b>${st.wins || 0}</b> · Игр: <b>${st.plays || 0}</b></div>
      </div>`;
    root.querySelectorAll('.ct-opt').forEach(b => b.onclick = () => {
      lvl = b.dataset.l;
      try { localStorage.setItem('d37_ttt_level', lvl); } catch (e) {}
      root.querySelectorAll('.ct-opt').forEach(x => x.classList.toggle('active', x === b));
    });
    root.querySelector('#tStart').onclick = () => start(lvl);
  }

  function start(level){
    T = { level, board: Array(9).fill(null), turn: 'X', over: false, first: T?.first === 'X' ? 'O' : 'X' };
    // Против бота первым ходят по очереди: одну партию ты, следующую бот
    if (level !== 'duo') T.turn = T.first === 'X' ? 'X' : 'O';
    else T.turn = 'X';
    root.innerHTML = `<div class="tt">
        <div class="ct-top"><span class="ct-badge">${LEVELS[level]}</span><span class="ct-status" id="tStatus"></span></div>
        <div class="tt-board" id="tBoard">${Array.from({ length: 9 }, (_, i) => `<button class="tt-cell" data-i="${i}" aria-label="Клетка ${i + 1}"></button>`).join('')}</div>
        <div class="ct-actions"><button id="tAgain">↻ Заново</button><button id="tSetup">⚙ Соперник</button></div>
      </div>`;
    root.querySelectorAll('.tt-cell').forEach(c => c.onclick = () => humanMove(+c.dataset.i));
    root.querySelector('#tAgain').onclick = () => start(level);
    root.querySelector('#tSetup').onclick = renderSetup;
    status();
    if (level !== 'duo' && T.turn === 'O') later(botMove, 450);
  }

  function status(text){
    const el = root.querySelector('#tStatus');
    if (text) { el.innerHTML = text; return; }
    el.textContent = T.level === 'duo' ? `Ходит ${T.turn === 'X' ? '❌' : '⭕'}` : T.turn === 'X' ? 'Твой ход ❌' : '🤖 думает…';
  }

  function place(i, who){
    T.board[i] = who;
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
    if (T.level !== 'duo' && T.turn !== 'X') return;
    place(i, T.turn);
    if (!T.over && T.level !== 'duo') later(botMove, 350 + Math.random() * 350);
  }
  function botMove(){ if (T && !T.over && root) place(botPick(), 'O'); }

  function end(w){
    T.over = true;
    root.querySelectorAll('.tt-cell').forEach(c => { c.disabled = true; });
    if (w.line) w.line.forEach(i => root.querySelectorAll('.tt-cell')[i].classList.add('win'));
    if (T.level === 'duo') { status(w.who === 'draw' ? '🤝 Ничья' : `🎉 Победил ${w.who === 'X' ? '❌' : '⭕'}`); api.sfx('win'); return; }
    const res = w.who === 'X' ? 2 : w.who === 'draw' ? 1 : 0;
    status(res === 2 ? '🎉 Ты победил!' : res === 1 ? (T.level === 'hard' ? '🤝 Ничья с непобедимым — это успех!' : '🤝 Ничья') : '🤖 Бот победил');
    api.sfx(res ? 'win' : 'bad');
    // У «Непобедимого» ничья считается победой
    const win = res === 2 || (T.level === 'hard' && res === 1);
    api.report('ttt_' + T.level, win, res, T.level === 'hard' ? res : 0);
  }

  window.GAME_IMPL.ttt = {
    mount(el, gameApi){ root = el; api = gameApi; T = null; renderSetup(); },
    unmount(){ timers.forEach(clearTimeout); timers = []; if (T) T.over = true; root = null; },
  };
})();
