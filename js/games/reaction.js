// ═══════════════════════════════════════
//  ИГРА «РЕАКЦИЯ» — жми, когда станет зелёным. 5 попыток
// ═══════════════════════════════════════
// Очки = 1000 − средняя реакция в мс (чем больше, тем лучше). Нажал раньше — фальстарт, попытка заново.
(() => {
  const TRIES = 5;
  let root, api, R, timer = 0;

  function render(){
    root.innerHTML = `<div class="rx">
        <button class="rx-pad" id="rxPad"><span id="rxText">Нажми, чтобы начать</span><small id="rxSub">${TRIES} попыток · жми, как только экран станет зелёным</small></button>
        <div class="rx-tries" id="rxTries"></div>
        <div class="ct-stats">Лучший средний результат: <b>${api.local().best ? (1000 - api.local().best) + ' мс' : '—'}</b></div>
      </div>`;
    const pad = root.querySelector('#rxPad');
    pad.addEventListener('pointerdown', e => { e.preventDefault(); press(); });
    R = { state: 'idle', times: [], t0: 0 };
  }

  function setPad(state, text, sub){
    const pad = root.querySelector('#rxPad');
    pad.className = 'rx-pad ' + state;
    root.querySelector('#rxText').textContent = text;
    root.querySelector('#rxSub').textContent = sub || '';
  }

  function arm(){
    R.state = 'wait';
    setPad('wait', 'Жди зелёного…', `Попытка ${R.times.length + 1} из ${TRIES}`);
    clearTimeout(timer);
    timer = setTimeout(() => {
      R.state = 'go'; R.t0 = performance.now();
      setPad('go', 'ЖМИ!', '');
    }, 1200 + Math.random() * 2600);
  }

  function press(){
    if (!R) return;
    if (R.state === 'idle' || R.state === 'done') { R.times = []; drawTries(); return arm(); }
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
      api.sfx('ok');
      drawTries();
      if (R.times.length >= TRIES) return finish();
      R.state = 'shown';
      setPad('shown', `${ms} мс`, 'Нажми для следующей попытки');
      return;
    }
    if (R.state === 'shown') return arm();
  }

  function drawTries(){
    root.querySelector('#rxTries').innerHTML = R.times.map((t, i) => `<span>${i + 1}: <b>${t}</b> мс</span>`).join('');
  }

  function finish(){
    R.state = 'done';
    const avg = Math.round(R.times.reduce((a, b) => a + b, 0) / R.times.length);
    const score = Math.max(0, 1000 - avg);
    const verdict = avg < 200 ? '⚡ Молния!' : avg < 250 ? '🔥 Отличная реакция' : avg < 320 ? '🙂 Хорошо' : '🐢 Можно быстрее';
    setPad('done', `${avg} мс в среднем`, `${verdict} · нажми, чтобы сыграть ещё`);
    api.sfx(avg < 250 ? 'win' : 'ok');
    api.report('reaction', avg < 300, score, score);
  }

  window.GAME_IMPL.reaction = {
    mount(el, gameApi){ root = el; api = gameApi; render(); },
    unmount(){ clearTimeout(timer); R = null; root = null; },
  };
})();
