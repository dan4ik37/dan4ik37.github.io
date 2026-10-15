// ═══════════════════════════════════════
//  ИГРА «2048» — стрелки / WASD / свайпы. Одиночная или «⚔️ Соревнование» по ссылке
// ═══════════════════════════════════════
// Соревнование (js/games/versus.js): у обоих одинаковые новые плитки (общий seed),
// 3 минуты — у кого больше очков. Партия кончается раньше, если ходов нет.
(() => {
  const N = 4, DUEL_SEC = 180;
  let root, api, keyHandler, board = null, stopDuel = null;

  // «↩ Отменить» — последний ход назад (одна ступень): 2 раза за игру, VIP и персоналу — 5 (как подсказка в «5 букв»).
  // Больше нельзя: у «2048» таблица рекордов. В соревновании отмены нет (плитки у соперников разошлись бы).
  const UNDO_FREE = 2, UNDO_VIP = 5;
  // Одна доска: el — куда рисовать, opt: { rand, timeLimit, onScore(score), onEnd(score, won2048) }
  function createBoard(el, opt){
    const rand = opt.rand || Math.random;
    let grid, score = 0, won = false, over = false, touch = null, timer = 0, left = opt.timeLimit || 0, prev = null, undos = 0;
    const undoMax = () => (window.GameKit?.vipPerk?.() ? UNDO_VIP : UNDO_FREE);
    el.innerHTML = `<div class="g2">
        <div class="ct-top"><span class="ct-score">Счёт: <b class="g2Score">0</b></span>
          ${opt.timeLimit ? '<span class="ct-timer g2Timer"></span>' : '<span class="ct-score">Рекорд: <b class="g2Best">0</b></span><button class="g2-new g2-undo" title="Отменить последний ход">↩ <b class="g2UndoN"></b></button><button class="g2-new g2-reset">↻ Заново</button>'}</div>
        <div class="g2-wrap"><div class="g2-board"></div>
          <div class="g2-over" hidden><div><span class="g2-over-t">Ходов нет!</span><br>Счёт: <b>0</b></div>${opt.timeLimit ? '' : '<button class="ct-start g2-again">↻ Ещё раз</button>'}</div></div>
        <div class="ct-note">Стрелки / WASD на клавиатуре, свайпы на телефоне. Соединяй одинаковые плитки.</div>
      </div>`;
    const q = s => el.querySelector(s);

    const empty = () => { const out = []; for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!grid[r][c]) out.push([r, c]); return out; };
    function spawn(){
      const e = empty();
      if (!e.length) return null;
      const [r, c] = e[Math.floor(rand() * e.length)];
      grid[r][c] = rand() < .9 ? 2 : 4;
      return [r, c];
    }
    // Сдвиг одной строки влево: [2,2,4,0] → [4,4,0,0]
    function slide(row){
      const vals = row.filter(Boolean);
      let gained = 0;
      for (let i = 0; i < vals.length - 1; i++) {
        if (vals[i] === vals[i + 1]) { vals[i] *= 2; gained += vals[i]; vals.splice(i + 1, 1); }
      }
      while (vals.length < N) vals.push(0);
      return { row: vals, gained };
    }
    function canMove(){
      if (empty().length) return true;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        if (c < N - 1 && grid[r][c] === grid[r][c + 1]) return true;
        if (r < N - 1 && grid[r][c] === grid[r + 1][c]) return true;
      }
      return false;
    }
    function draw(fresh){
      q('.g2Score').textContent = score;
      const best = q('.g2Best'); if (best) best.textContent = Math.max(api.local().best || 0, score);
      const ub = q('.g2-undo');
      if (ub) { const n = Math.max(0, undoMax() - undos); ub.disabled = !prev || over || !n; q('.g2UndoN').textContent = n; ub.title = n ? `Отменить последний ход (осталось ${n})` : 'Отмены на эту игру кончились'; }
      q('.g2-board').innerHTML = grid.map((row, r) => row.map((v, c) =>
        `<div class="g2-cell${v ? ' v' + Math.min(v, 4096) : ''}${fresh && fresh[0] === r && fresh[1] === c ? ' fresh' : ''}">${v || ''}</div>`).join('')).join('');
    }
    function end(title){
      if (over) return;
      over = true;
      clearInterval(timer);
      api.sfx(title ? 'ok' : 'bad');
      const box = q('.g2-over');
      box.hidden = false;
      q('.g2-over-t').textContent = title || 'Ходов нет!';
      box.querySelector('b').textContent = score;
      opt.onEnd?.(score, won);
    }
    function move(dir){
      if (over) return;
      const before = { grid: grid.map(row => row.slice()), score, won };   // для «↩ Отменить»
      let moved = false, gained = 0;
      const get = (i, j) => dir === 'left' ? [i, j] : dir === 'right' ? [i, N - 1 - j] : dir === 'up' ? [j, i] : [N - 1 - j, i];
      for (let i = 0; i < N; i++) {
        const line = [];
        for (let j = 0; j < N; j++) { const [r, c] = get(i, j); line.push(grid[r][c]); }
        const res = slide(line);
        gained += res.gained;
        for (let j = 0; j < N; j++) {
          const [r, c] = get(i, j);
          if (grid[r][c] !== res.row[j]) moved = true;
          grid[r][c] = res.row[j];
        }
      }
      if (!moved) return;
      if (!opt.timeLimit) prev = before;
      score += gained;
      const fresh = spawn();
      api.sfx(gained ? 'ok' : 'move');
      draw(fresh);
      opt.onScore?.(score);
      if (Math.max(...grid.flat()) >= 2048 && !won) { won = true; opt.on2048?.(score); }
      if (!canMove()) end();
    }
    // Отменить последний ход (новая плитка тоже уходит; 2048 уже засчитано — так и остаётся)
    function undo(){
      if (!prev || over || undos >= undoMax()) return;
      grid = prev.grid; score = prev.score; won = won || prev.won; prev = null; undos++;
      api.sfx('tick');
      draw();
      opt.onScore?.(score);
    }
    function reset(){
      grid = Array.from({ length: N }, () => Array(N).fill(0));
      score = 0; won = false; over = false; prev = null; undos = 0;
      spawn(); spawn();
      q('.g2-over').hidden = true;
      draw();
      if (opt.timeLimit) {
        left = opt.timeLimit;
        const t = q('.g2Timer');
        const tick = () => { t.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; t.classList.toggle('low', left <= 15); };
        tick();
        clearInterval(timer);
        timer = setInterval(() => { left--; tick(); if (left <= 0) end('Время вышло!'); }, 1000);
      }
    }
    // «↻ Заново» посреди игры — спросить: счёт этой игры пропадёт
    q('.g2-reset')?.addEventListener('click', async () => {
      if (!over && score > 0 && window.GameKit && !await GameKit.ask({ icon: '🧩', title: 'Начать заново?', text: `Эта игра (${score} очков) не закончена — счёт пропадёт.`, yes: '↻ Заново', no: 'Играть дальше' })) return;
      reset();
    });
    q('.g2-undo')?.addEventListener('click', undo);
    q('.g2-again')?.addEventListener('click', reset);
    const wrap = q('.g2-wrap');
    wrap.addEventListener('touchstart', e => { const t = e.touches[0]; touch = [t.clientX, t.clientY]; }, { passive: true });
    wrap.addEventListener('touchmove', e => { if (touch) e.preventDefault(); }, { passive: false });
    wrap.addEventListener('touchend', e => {
      if (!touch) return;
      const t = e.changedTouches[0], dx = t.clientX - touch[0], dy = t.clientY - touch[1];
      touch = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    });
    reset();
    return { move, undo, stop(){ over = true; clearInterval(timer); }, state: () => ({ grid, score, won, over, undos, prev: !!prev }) };
  }

  function solo(){
    board?.stop();
    root.innerHTML = `<div class="g2-solo"></div><div class="ct-actions"><button class="ct-duel-btn" id="g2Duel">⚔️ Соревноваться с другом</button></div>`;
    root.querySelector('#g2Duel').onclick = () => { location.hash = '#/games/2048/' + GameRoom.newCode(); };
    board = createBoard(root.querySelector('.g2-solo'), {
      on2048: score => { api.toast('🧩 2048! Можно играть дальше за рекордом'); api.report('2048', true, score, score); },
      // Победа уже засчитана при 2048 — здесь фиксируем итоговый счёт как рекорд
      onEnd: (score, won) => { if (!won) api.report('2048', false, score, score); },
    });
  }

  window.GAME_IMPL['2048'] = {
    mount(el, gameApi){
      root = el; api = gameApi;
      const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down', ф: 'left', в: 'right', ц: 'up', ы: 'down' };
      keyHandler = e => {
        if (e.target?.closest?.('input,textarea,select,[contenteditable]') || window.GameKit?.isOpen?.()) return;
        if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.key === 'z' || e.key === 'я')) { e.preventDefault(); board?.undo?.(); return; }
        const dir = map[e.key] || map[e.key?.toLowerCase()];
        if (!dir || !board) return;
        e.preventDefault();
        board.move(dir);
      };
      window.addEventListener('keydown', keyHandler);
      if (GameRoom.validCode(gameApi.param)) {
        stopDuel = Versus.start(root, api, '2048', gameApi.param, {
          run(stage, rand, hooks){
            board?.stop();
            stage.insertAdjacentHTML('afterbegin', `<div class="ct-note" style="text-align:center">⏱ ${DUEL_SEC / 60} минуты · одинаковые плитки у обоих · у кого больше очков</div>`);
            const host = document.createElement('div');
            stage.appendChild(host);
            board = createBoard(host, { rand, timeLimit: DUEL_SEC, onScore: hooks.progress, onEnd: score => hooks.done(score) });
          },
          stop(){ board?.stop(); board = null; },
        });
      } else solo();
    },
    unmount(){ window.removeEventListener('keydown', keyHandler); board?.stop(); board = null; stopDuel?.(); stopDuel = null; root = null; },
    _dbg: () => board?.state(),   // проверка в браузере
  };
})();
