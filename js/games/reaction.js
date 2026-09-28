// ═══════════════════════════════════════
//  ИГРА «РЕАКЦИЯ» — жми, когда станет зелёным. 5 попыток. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Очки = 1000 − средняя реакция в мс (чем больше, тем лучше). Нажал раньше — фальстарт,
// попытка заново. В соревновании у обоих одинаковые задержки перед «ЖМИ!» (общий seed).
(() => {
  const TRIES = 5;
  let root, api, R, timer = 0, stopDuel = null;

  // Игра в el. opt: { rand, duel, onScore(score), onEnd(score) }
  function render(el, opt){
    clearTimeout(timer);
    el.innerHTML = `<div class="rx">
        <button class="rx-pad"><span class="rxText">Нажми, чтобы начать</span><small class="rxSub">${TRIES} попыток · жми, как только экран станет зелёным</small></button>
        <div class="rx-tries"></div>
        ${opt.duel ? '' : `<div class="ct-stats">Лучший средний результат: <b>${api.local().best ? (1000 - api.local().best) + ' мс' : '—'}</b></div>
        <div class="ct-actions"><button class="ct-duel-btn rxDuel">⚔️ Соревноваться с другом</button></div>`}
      </div>`;
    R = { el, opt, state: 'idle', times: [], t0: 0 };
    el.querySelector('.rx-pad').addEventListener('pointerdown', e => { e.preventDefault(); press(); });
    el.querySelector('.rxDuel')?.addEventListener('click', () => { location.hash = '#/games/reaction/' + GameRoom.newCode(); });
  }

  function setPad(state, text, sub){
    const pad = R.el.querySelector('.rx-pad');
    pad.className = 'rx-pad ' + state;
    R.el.querySelector('.rxText').textContent = text;
    R.el.querySelector('.rxSub').textContent = sub || '';
  }

  function arm(){
    R.state = 'wait';
    setPad('wait', 'Жди зелёного…', `Попытка ${R.times.length + 1} из ${TRIES}`);
    clearTimeout(timer);
    // Задержка берётся из генератора один раз на попытку — фальстарт её не меняет,
    // иначе у соперников разошлись бы последовательности
    if (R.nextDelay == null) R.nextDelay = 1200 + R.opt.rand() * 2600;
    timer = setTimeout(() => {
      R.state = 'go'; R.t0 = performance.now();
      setPad('go', 'ЖМИ!', '');
    }, R.nextDelay);
  }

  function press(){
    if (!R) return;
    if (R.state === 'done') {
      if (R.opt.duel) return;
      R.times = []; drawTries(); return arm();
    }
    if (R.state === 'idle') { R.times = []; drawTries(); return arm(); }
    if (R.state === 'wait') {
      clearTimeout(timer);
      api.sfx('bad');
      R.state = 'early';
      setPad('early', 'Фальстарт! 😬', 'Нажми, чтобы повторить попытку');
      return;
    }
    if (R.state === 'early') return arm();
    if (R.state === 'go') {
      const ms = Math.round(performance.now() - R.t0);
      R.times.push(ms);
      R.nextDelay = null;
      api.sfx('ok');
      drawTries();
      const avg = Math.round(R.times.reduce((a, b) => a + b, 0) / R.times.length);
      R.opt.onScore?.(Math.max(0, 1000 - avg));
      if (R.times.length >= TRIES) return finish();
      R.state = 'shown';
      setPad('shown', `${ms} мс`, 'Нажми для следующей попытки');
      return;
    }
    if (R.state === 'shown') return arm();
  }

  function drawTries(){
    R.el.querySelector('.rx-tries').innerHTML = R.times.map((t, i) => `<span>${i + 1}: <b>${t}</b> мс</span>`).join('');
  }

  function finish(){
    R.state = 'done';
    const avg = Math.round(R.times.reduce((a, b) => a + b, 0) / R.times.length);
    const score = Math.max(0, 1000 - avg);
    const verdict = avg < 200 ? '⚡ Молния!' : avg < 250 ? '🔥 Отличная реакция' : avg < 320 ? '🙂 Хорошо' : '🐢 Можно быстрее';
    setPad('done', `${avg} мс в среднем`, R.opt.duel ? verdict : `${verdict} · нажми, чтобы сыграть ещё`);
    api.sfx(avg < 250 ? 'win' : 'ok');
    R.opt.onEnd(score, avg);
  }

  window.GAME_IMPL.reaction = {
    mount(el, gameApi){
      root = el; api = gameApi;
      if (GameRoom.validCode(gameApi.param)) {
        stopDuel = Versus.start(root, api, 'reaction', gameApi.param, {
          run(stage, rand, hooks){
            const host = document.createElement('div');
            stage.appendChild(host);
            render(host, { rand, duel: true, onScore: hooks.progress, onEnd: score => hooks.done(score) });
          },
          stop(){ clearTimeout(timer); R = null; },
        });
      } else {
        render(root, { rand: Math.random, onEnd: (score, avg) => api.report('reaction', avg < 300, score, score) });
      }
    },
    unmount(){ clearTimeout(timer); R = null; stopDuel?.(); stopDuel = null; root = null; },
  };
})();
