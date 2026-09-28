// ═══════════════════════════════════════
//  ИГРА «НАЙДИ ПАРУ» (мемори) — 10 пар карточек. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Открываешь по две карточки; совпали — остаются открытыми. Очки = 1000 − 25 за каждый
// лишний ход (сверх 10) − 2 за секунду, не меньше 50. Соревнование: общий seed —
// одинаковая раскладка у обоих, у кого больше очков.
(() => {
  const PAIRS = 10;
  const ICONS = ['🎮', '🎧', '🎤', '💰', '💎', '🔥', '👾', '🏆', '🎬', '⚡', '🍕', '🐱', '🚀', '🎁', '👑', '🍩'];
  let root, api, M = null, stopDuel = null;

  function shuffle(arr, rand){
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  const scoreOf = (moves, sec) => Math.max(50, 1000 - Math.max(0, moves - PAIRS) * 25 - sec * 2);

  // opt: { rand, duel, onScore(score), onEnd(score, moves, sec) }
  function render(el, opt){
    stop();
    const icons = shuffle(ICONS.slice(), opt.rand).slice(0, PAIRS);
    const deck = shuffle([...icons, ...icons], opt.rand);
    const best = api.local().best || 0;
    el.innerHTML = `<div class="mm">
        <div class="ct-top"><span class="ct-score">Ходов: <b class="mmMoves">0</b></span><span class="ct-score">Пар: <b class="mmPairs">0</b>/${PAIRS}</span>
          <span class="ct-timer mmTime">0:00</span></div>
        <div class="mm-grid">${deck.map((ic, i) => `<button class="mm-card" data-i="${i}" aria-label="Карточка ${i + 1}"><span class="mm-back">?</span><span class="mm-face">${ic}</span></button>`).join('')}</div>
        <div class="ct-status mmStatus">${opt.duel ? 'Одинаковая раскладка у обоих — кто быстрее и точнее' : 'Открой две карточки. Найди все пары за меньшее число ходов'}</div>
        ${opt.duel ? '' : `<div class="ct-stats">Рекорд: <b>${best || '—'}</b> очков</div>
        <div class="ct-actions"><button class="mmAgain">↻ Новая раскладка</button><button class="ct-duel-btn mmDuel">⚔️ Соревноваться с другом</button></div>`}
      </div>`;
    M = { el, opt, deck, open: [], found: 0, moves: 0, t0: 0, timer: 0, lock: false, done: false };
    el.querySelectorAll('.mm-card').forEach(b => b.onclick = () => flip(+b.dataset.i));
    el.querySelector('.mmAgain')?.addEventListener('click', () => render(el, opt));
    el.querySelector('.mmDuel')?.addEventListener('click', () => { location.hash = '#/games/memory/' + GameRoom.newCode(); });
  }

  const secs = () => M.t0 ? Math.floor((Date.now() - M.t0) / 1000) : 0;
  function clock(){
    const s = secs();
    const t = M.el.querySelector('.mmTime');
    if (t) t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function flip(i){
    if (!M || M.done || M.lock) return;
    const cards = M.el.querySelectorAll('.mm-card');
    const c = cards[i];
    if (c.classList.contains('up')) return;
    if (!M.t0) { M.t0 = Date.now(); M.timer = setInterval(clock, 500); }
    c.classList.add('up');
    api.sfx('move');
    M.open.push(i);
    if (M.open.length < 2) return;
    M.moves++;
    M.el.querySelector('.mmMoves').textContent = M.moves;
    const [a, b] = M.open;
    M.open = [];
    if (M.deck[a] === M.deck[b]) {
      cards[a].classList.add('got'); cards[b].classList.add('got');
      M.found++;
      M.el.querySelector('.mmPairs').textContent = M.found;
      api.sfx('ok');
      M.opt.onScore?.(M.found === PAIRS ? scoreOf(M.moves, secs()) : M.found * 50);
      if (M.found === PAIRS) finish();
    } else {
      M.lock = true;
      setTimeout(() => { if (!M) return; cards[a].classList.remove('up'); cards[b].classList.remove('up'); M.lock = false; }, 750);
    }
  }

  function finish(){
    M.done = true;
    clearInterval(M.timer); clock();
    const sec = secs(), score = scoreOf(M.moves, sec);
    api.sfx('win');
    M.el.querySelector('.mmStatus').innerHTML = `🎉 Все пары за <b>${M.moves}</b> ходов и <b>${sec}</b> с — <b>${score}</b> очков`;
    M.opt.onEnd?.(score, M.moves, sec);
  }

  function stop(){ if (M) clearInterval(M.timer); }

  window.GAME_IMPL.memory = {
    mount(el, gameApi){
      root = el; api = gameApi;
      if (GameRoom.validCode(gameApi.param)) {
        stopDuel = Versus.start(root, api, 'memory', gameApi.param, {
          run(stage, rand, hooks){
            const host = document.createElement('div');
            stage.appendChild(host);
            render(host, { rand, duel: true, onScore: hooks.progress, onEnd: score => hooks.done(score) });
          },
          stop(){ stop(); M = null; },
        });
      } else {
        // Победа — уложиться в 20 ходов
        render(root, { rand: Math.random, onEnd: (score, moves) => api.report('memory', moves <= 20, score, score) });
      }
    },
    unmount(){ stop(); M = null; stopDuel?.(); stopDuel = null; root = null; },
  };
})();
