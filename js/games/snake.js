// ═══════════════════════════════════════
//  ИГРА «ЗМЕЙКА» — стрелки / WASD / свайпы / кнопки. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Поле 17×17, стены и собственный хвост — конец игры. Каждое яблоко +1 и чуть быстрее.
// Цикл — на setTimeout (не rAF): так игра не «замирает» в фоновой вкладке с таймером соперника.
// Соревнование: общий seed — яблоки выбираются из одного генератора; кто съел больше.
(() => {
  const N = 17, WIN = 25;
  let root, api, S = null, stopDuel = null;

  // Одна партия в el. opt: { rand, duel, onScore(score), onEnd(score) }
  function render(el, opt){
    stop();
    const best = api.local().best || 0;
    el.innerHTML = `<div class="sn">
        <div class="ct-top"><span class="ct-score">Яблок: <b class="snScore">0</b></span>${opt.duel ? '' : `<span class="ct-score">Рекорд: <b>${best}</b></span>`}</div>
        <div class="sn-wrap"><canvas class="sn-canvas" width="510" height="510"></canvas>
          <div class="sn-over"><b class="snMsg">🐍 Змейка</b><span class="snSub">Стрелки, WASD или свайп — чтобы начать</span><button class="ct-start snGo">▶ Старт</button></div>
        </div>
        <div class="sn-pad">
          <button data-d="up" aria-label="Вверх">▲</button>
          <button data-d="left" aria-label="Влево">◀</button><button data-d="down" aria-label="Вниз">▼</button><button data-d="right" aria-label="Вправо">▶</button>
        </div>
        ${opt.duel ? '' : '<div class="ct-actions"><button class="ct-duel-btn snDuel">⚔️ Соревноваться с другом</button></div>'}
      </div>`;
    S = { el, opt, cv: el.querySelector('.sn-canvas'), running: false, over: false, timer: 0 };
    reset();
    draw();
    el.querySelector('.snGo').onclick = () => begin();
    el.querySelectorAll('.sn-pad button').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); turn(b.dataset.d); }));
    el.querySelector('.snDuel')?.addEventListener('click', () => { location.hash = '#/games/snake/' + GameRoom.newCode(); });
    const wrap = el.querySelector('.sn-wrap');
    wrap.addEventListener('touchstart', e => { S.touch = [e.touches[0].clientX, e.touches[0].clientY]; }, { passive: true });
    wrap.addEventListener('touchmove', e => { if (S.running) e.preventDefault(); }, { passive: false });
    wrap.addEventListener('touchend', e => {
      if (!S.touch) return;
      const dx = e.changedTouches[0].clientX - S.touch[0], dy = e.changedTouches[0].clientY - S.touch[1];
      S.touch = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
      turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    });
  }

  function reset(){
    const m = Math.floor(N / 2);
    S.snake = [[m, m - 1], [m, m - 2], [m, m - 3]];
    S.dir = 'right'; S.queue = [];
    S.score = 0; S.over = false; S.running = false;
    S.food = spawn();
  }

  function spawn(){
    // Кандидат из генератора; если занят — следующая свободная клетка по кругу
    let i = Math.floor(S.opt.rand() * N * N);
    for (let k = 0; k < N * N; k++, i = (i + 1) % (N * N)) {
      const r = Math.floor(i / N), c = i % N;
      if (!S.snake.some(([y, x]) => y === r && x === c)) return [r, c];
    }
    return null;
  }

  const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
  function turn(d){
    if (!S || (S.over && S.opt.duel)) return;
    if (!S.running) { begin(d); return; }
    const last = S.queue.length ? S.queue[S.queue.length - 1] : S.dir;
    if (d !== last && d !== OPP[last] && S.queue.length < 3) S.queue.push(d);
  }

  function begin(d){
    if (!S || S.running) return;
    if (S.over) { if (Date.now() - S.diedAt < 700) return; reset(); }   // пауза, чтобы увидеть счёт
    if (d && d !== OPP[S.dir]) S.dir = d;
    S.running = true;
    S.el.querySelector('.sn-over').hidden = true;
    tick();
  }

  function speed(){ return Math.max(65, 150 - S.score * 3); }

  function tick(){
    if (!S || !S.running) return;
    if (S.queue.length) S.dir = S.queue.shift();
    const [dy, dx] = DIRS[S.dir];
    const head = [S.snake[0][0] + dy, S.snake[0][1] + dx];
    const eat = S.food && head[0] === S.food[0] && head[1] === S.food[1];
    const body = eat ? S.snake : S.snake.slice(0, -1);   // хвост уедет — в него можно въехать
    if (head[0] < 0 || head[0] >= N || head[1] < 0 || head[1] >= N || body.some(([y, x]) => y === head[0] && x === head[1])) return die();
    S.snake.unshift(head);
    if (eat) {
      S.score++;
      S.el.querySelector('.snScore').textContent = S.score;
      api.sfx('ok');
      S.opt.onScore?.(S.score);
      S.food = spawn();
      if (!S.food) { draw(); return die(true); }
    } else S.snake.pop();
    draw();
    S.timer = setTimeout(tick, speed());
  }

  function die(full){
    S.running = false; S.over = true; S.diedAt = Date.now();
    clearTimeout(S.timer);
    draw(true);
    api.sfx(full ? 'win' : 'bad');
    const box = S.el.querySelector('.sn-over');
    box.hidden = false;
    S.el.querySelector('.snMsg').textContent = full ? '🏆 Всё поле!' : `💥 ${S.score} ${plural(S.score)}`;
    S.el.querySelector('.snSub').textContent = S.opt.duel ? 'Ждём итог соревнования' : S.score >= WIN ? 'Отличный результат!' : `Съешь ${WIN}+, чтобы засчиталась победа`;
    const go = S.el.querySelector('.snGo');
    go.hidden = !!S.opt.duel;
    go.textContent = '↻ Ещё раз';
    S.opt.onEnd?.(S.score);
  }
  const plural = n => n % 10 === 1 && n % 100 !== 11 ? 'яблоко' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'яблока' : 'яблок';

  function draw(dead){
    const cv = S.cv, ctx = cv.getContext('2d');
    const size = cv.width, k = size / N;
    ctx.fillStyle = '#0d0d16'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(255,255,255,.025)';
    for (let r = 0; r < N; r++) for (let c = (r % 2); c < N; c += 2) ctx.fillRect(c * k, r * k, k, k);
    if (S.food) { ctx.font = `${Math.floor(k * .9)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🍎', S.food[1] * k + k / 2, S.food[0] * k + k / 2 + 1); }
    S.snake.forEach(([r, c], i) => {
      const t = i / Math.max(1, S.snake.length - 1);
      ctx.fillStyle = dead ? '#7c2d12' : i === 0 ? '#22c55e' : `hsl(${145 - t * 40}, 70%, ${45 - t * 15}%)`;
      const p = i === 0 ? 1 : 2;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(c * k + p, r * k + p, k - p * 2, k - p * 2, k * .3) : ctx.rect(c * k + p, r * k + p, k - p * 2, k - p * 2); ctx.fill();
    });
    // Глаза
    const [hr, hc] = S.snake[0], [dy, dx] = DIRS[S.dir];
    ctx.fillStyle = '#0d0d16';
    const cx = hc * k + k / 2 + dx * k * .18, cy = hr * k + k / 2 + dy * k * .18;
    [[-1, 1], [1, -1]].forEach(([a, b]) => { ctx.beginPath(); ctx.arc(cx + (dy ? a : 0) * k * .18, cy + (dx ? b : 0) * k * .18, k * .09, 0, Math.PI * 2); ctx.fill(); });
  }

  function onKey(e){
    if (!S || !root?.isConnected) return;
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
    const d = map[e.code];
    if (!d) return;
    if (e.target.closest?.('input,textarea,[contenteditable]')) return;
    e.preventDefault();
    turn(d);
  }

  function stop(){ if (S) { clearTimeout(S.timer); S.running = false; } }

  window.GAME_IMPL.snake = {
    mount(el, gameApi){
      root = el; api = gameApi;
      document.addEventListener('keydown', onKey);
      if (GameRoom.validCode(gameApi.param)) {
        stopDuel = Versus.start(root, api, 'snake', gameApi.param, {
          run(stage, rand, hooks){
            const host = document.createElement('div');
            stage.appendChild(host);
            render(host, { rand, duel: true, onScore: hooks.progress, onEnd: score => hooks.done(score) });
          },
          stop(){ stop(); S = null; },
        });
      } else {
        render(root, { rand: Math.random, onEnd: score => api.report('snake', score >= WIN, score, score) });
      }
    },
    unmount(){ stop(); S = null; stopDuel?.(); stopDuel = null; document.removeEventListener('keydown', onKey); root = null; },
  };
})();
