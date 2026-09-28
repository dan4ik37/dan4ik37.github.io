// ═══════════════════════════════════════
//  ИГРА «2048» — стрелки / WASD / свайпы
// ═══════════════════════════════════════
(() => {
  const N = 4;
  let root, api, grid, score, won, over, keyHandler, touch;

  const empty = () => { const out = []; for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!grid[r][c]) out.push([r, c]); return out; };
  function spawn(){
    const e = empty();
    if (!e.length) return;
    const [r, c] = e[Math.floor(Math.random() * e.length)];
    grid[r][c] = Math.random() < .9 ? 2 : 4;
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

  function move(dir){
    if (over) return;
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
    score += gained;
    const fresh = spawn();
    api.sfx(gained ? 'ok' : 'move');
    draw(fresh);
    const max = Math.max(...grid.flat());
    if (max >= 2048 && !won) {
      won = true;
      api.toast('🧩 2048! Можно играть дальше за рекордом');
      api.report('2048', true, score, score);
    }
    if (!canMove()) gameOver();
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
    const best = Math.max(api.local().best || 0, score);
    root.querySelector('#g2Score').textContent = score;
    root.querySelector('#g2Best').textContent = best;
    root.querySelector('#g2Board').innerHTML = grid.map((row, r) => row.map((v, c) =>
      `<div class="g2-cell${v ? ' v' + Math.min(v, 4096) : ''}${fresh && fresh[0] === r && fresh[1] === c ? ' fresh' : ''}">${v || ''}</div>`).join('')).join('');
  }

  function gameOver(){
    over = true;
    api.sfx('bad');
    const box = root.querySelector('#g2Over');
    box.hidden = false;
    box.querySelector('b').textContent = score;
    // Победа уже засчитана при 2048 — здесь фиксируем итоговый счёт как рекорд
    api.report('2048', false, score, score);
  }

  function newGame(){
    grid = Array.from({ length: N }, () => Array(N).fill(0));
    score = 0; won = false; over = false;
    spawn(); spawn();
    root.querySelector('#g2Over').hidden = true;
    draw();
  }

  window.GAME_IMPL['2048'] = {
    mount(el, gameApi){
      root = el; api = gameApi;
      root.innerHTML = `<div class="g2">
          <div class="ct-top"><span class="ct-score">Счёт: <b id="g2Score">0</b></span><span class="ct-score">Рекорд: <b id="g2Best">0</b></span><button class="g2-new" id="g2New">↻ Заново</button></div>
          <div class="g2-wrap"><div class="g2-board" id="g2Board"></div>
            <div class="g2-over" id="g2Over" hidden><div>Ходов нет!<br>Счёт: <b>0</b></div><button class="ct-start" id="g2Again">↻ Ещё раз</button></div></div>
          <div class="ct-note">Стрелки / WASD на клавиатуре, свайпы на телефоне. Соединяй одинаковые плитки.</div>
        </div>`;
      root.querySelector('#g2New').onclick = newGame;
      root.querySelector('#g2Again').onclick = newGame;
      const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down', ф: 'left', в: 'right', ц: 'up', ы: 'down' };
      keyHandler = e => {
        if (e.target?.closest?.('input,textarea,select,[contenteditable]')) return;
        const dir = map[e.key] || map[e.key?.toLowerCase()];
        if (!dir) return;
        e.preventDefault();
        move(dir);
      };
      window.addEventListener('keydown', keyHandler);
      const board = root.querySelector('.g2-wrap');
      board.addEventListener('touchstart', e => { const t = e.touches[0]; touch = [t.clientX, t.clientY]; }, { passive: true });
      board.addEventListener('touchmove', e => { if (touch) e.preventDefault(); }, { passive: false });
      board.addEventListener('touchend', e => {
        if (!touch) return;
        const t = e.changedTouches[0], dx = t.clientX - touch[0], dy = t.clientY - touch[1];
        touch = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
        move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      });
      newGame();
    },
    unmount(){ window.removeEventListener('keydown', keyHandler); root = null; },
  };
})();
