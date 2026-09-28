// ═══════════════════════════════════════
//  ИГРА «УГАДАЙ ВИДЕО» — ролики канала (allVids из youtube.js)
// ═══════════════════════════════════════
// 10 раундов: превью показывается сильно увеличенным кусочком и за 12 секунд
// отъезжает до целого кадра. 4 варианта названия. Очки: быстрее — больше.
// «⚔️ Соревнование» (js/games/versus.js): у обоих те же ролики, варианты и кусочки
// превью (общий seed), побеждает тот, у кого больше очков.
(() => {
  const ROUNDS = 10, ROUND_MS = 12000;
  let root, api, G, timers = [], stopDuel = null;
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; if (G) { cancelAnimationFrame(G.raf); G.answered = true; } };
  const shorten = t => { t = String(t || '').replace(/\s*#\S+/g, '').trim(); return t.length > 80 ? t.slice(0, 77) + '…' : t; };
  const shuffle = (a, rand) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  async function videos(){
    if (typeof ensureYT === 'function') { try { await ensureYT(); } catch (e) {} }
    const list = (typeof allVids !== 'undefined' ? allVids : []).filter(v => v && v.id && v.title);
    const seen = new Set();
    // Сортировка по id — чтобы у двух игроков с одним seed порядок совпал, как бы ни пришёл список
    return list.filter(v => { const k = shorten(v.title).toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a.id < b.id ? -1 : 1);
  }

  function renderIntro(){
    const st = api.local();
    root.innerHTML = `<div class="gv-intro">
        <div class="gv-big">🎬</div>
        <p>Покажем кусочек превью ролика dan4ik37 — угадай, что это за видео. Картинка постепенно отдаляется: чем раньше ответишь, тем больше очков.</p>
        <button class="ct-start" id="gvStart">▶ Начать (${ROUNDS} раундов)</button>
        <button class="ct-duel-btn" id="gvDuel">⚔️ Соревноваться с другом</button>
        <div class="ct-stats">Лучший результат: <b>${st.best || 0}/${ROUNDS}</b> · Игр: <b>${st.plays || 0}</b></div>
      </div>`;
    root.querySelector('#gvStart').onclick = () => play(root, { rand: Math.random, onEnd: soloFinish });
    root.querySelector('#gvDuel').onclick = () => { location.hash = '#/games/guess/' + GameRoom.newCode(); };
  }

  // Одна партия в el. opt: { rand, onScore(points), onEnd(correct, points) }
  async function play(el, opt){
    clearTimers();
    el.innerHTML = '<div class="gm-loading"><div class="spinner"></div>Загружаем ролики…</div>';
    const vids = await videos();
    if (!root) return;
    if (vids.length < 6) {
      el.innerHTML = `<div class="empty-state"><span class="empty-state-icon">📼</span><div class="empty-state-title">Мало роликов</div><div class="empty-state-text">Не удалось загрузить список видео канала. Попробуй позже.</div></div>`;
      return;
    }
    const rand = opt.rand;
    G = { el, opt, rand, vids, order: shuffle(vids.slice(), rand).slice(0, ROUNDS), round: 0, correct: 0, points: 0, raf: 0, answered: false };
    el.innerHTML = `<div class="gv-game">
        <div class="ct-top"><span class="ct-badge gvRound"></span><span class="ct-score">Очки: <b class="gvPoints">0</b></span><span class="ct-score">Верно: <b class="gvCorrect">0</b></span></div>
        <div class="gv-frame"><img class="gvImg" alt="Превью" draggable="false"><div class="gv-bar"><i class="gvBar"></i></div></div>
        <div class="gv-opts"></div>
        <div class="ct-status gvStatus"></div>
      </div>`;
    nextRound();
  }

  const q = s => G.el.querySelector(s);

  function nextRound(){
    if (!root || !G) return;
    if (G.round >= G.order.length) return G.opt.onEnd(G.correct, G.points);
    G.answered = false;
    const v = G.order[G.round];
    const wrong = shuffle(G.vids.filter(x => x.id !== v.id), G.rand).slice(0, 3);
    const opts = shuffle([v, ...wrong], G.rand);
    q('.gvRound').textContent = `Раунд ${G.round + 1}/${G.order.length}`;
    q('.gvStatus').textContent = '';
    q('.gvStatus').className = 'ct-status gvStatus';
    const img = q('.gvImg');
    // Случайная точка «кусочка» и сильный зум, который плавно уходит
    const ox = 20 + G.rand() * 60, oy = 20 + G.rand() * 60;
    img.style.transformOrigin = `${ox}% ${oy}%`;
    img.style.transform = 'scale(4.5)';
    img.style.filter = 'blur(2px)';
    img.src = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
    q('.gv-opts').innerHTML = opts.map((o, i) => `<button class="gv-opt" data-id="${o.id}">${i + 1}. ${esc(shorten(o.title))}</button>`).join('');
    G.el.querySelectorAll('.gv-opt').forEach(b => b.onclick = () => answer(b.dataset.id, v));
    const t0 = performance.now();
    G.t0 = t0;
    const bar = q('.gvBar');
    const step = now => {
      if (!root || !G || G.answered) return;
      const p = Math.min(1, (now - t0) / ROUND_MS);
      img.style.transform = `scale(${(4.5 - 3.5 * p).toFixed(3)})`;
      img.style.filter = `blur(${(2 * (1 - p)).toFixed(2)}px)`;
      bar.style.width = ((1 - p) * 100).toFixed(1) + '%';
      if (p >= 1) return answer(null, v);
      G.raf = requestAnimationFrame(step);
    };
    G.raf = requestAnimationFrame(step);
    // Страховка: если rAF стоит (вкладка в фоне) — раунд всё равно закончится
    later(() => { if (G && !G.answered && G.order[G.round] === v) answer(null, v); }, ROUND_MS + 500);
  }

  function answer(id, v){
    if (!G || G.answered) return;
    G.answered = true;
    cancelAnimationFrame(G.raf);
    const img = q('.gvImg');
    img.style.transform = 'scale(1)'; img.style.filter = 'none';
    const elapsed = performance.now() - G.t0;
    const ok = id === v.id;
    const pts = ok ? Math.max(10, Math.round(100 * (1 - elapsed / ROUND_MS))) : 0;
    if (ok) { G.correct++; G.points += pts; }
    api.sfx(ok ? 'ok' : 'bad');
    G.el.querySelectorAll('.gv-opt').forEach(b => {
      b.disabled = true;
      if (b.dataset.id === v.id) b.classList.add('right');
      else if (b.dataset.id === id) b.classList.add('wrong');
    });
    q('.gvPoints').textContent = G.points;
    q('.gvCorrect').textContent = G.correct;
    const st = q('.gvStatus');
    st.innerHTML = ok ? `✅ Верно! +${pts}` : id ? '❌ Мимо' : '⏱ Время вышло';
    st.className = 'ct-status gvStatus ' + (ok ? 'win' : 'err');
    G.opt.onScore?.(G.points);
    G.round++;
    later(nextRound, 1600);
  }

  async function soloFinish(correct, points){
    const win = correct >= 7;
    api.sfx(win ? 'win' : 'ok');
    const verdict = correct === ROUNDS ? '🏆 Идеально! Ты настоящий фанат канала!' : win ? '🎉 Отлично, ты явно смотришь канал!' : correct >= 4 ? '🙂 Неплохо! Пересмотри пару роликов 😉' : '😅 Похоже, пора посмотреть канал!';
    root.innerHTML = `<div class="gv-intro">
        <div class="gv-big">${correct}/${ROUNDS}</div>
        <p>${verdict}<br>Очков: <b>${points}</b></p>
        <div class="ct-actions"><button class="ct-start" id="gvAgain">↻ Ещё раз</button><button id="gvDuel2">⚔️ С другом</button><a class="gv-link" href="#/home">▶ Смотреть видео</a></div>
      </div>`;
    root.querySelector('#gvAgain').onclick = () => play(root, { rand: Math.random, onEnd: soloFinish });
    root.querySelector('#gvDuel2').onclick = () => { location.hash = '#/games/guess/' + GameRoom.newCode(); };
    await api.report('guess', win, correct, correct);
  }

  window.GAME_IMPL.guess = {
    mount(el, gameApi){
      root = el; api = gameApi;
      if (GameRoom.validCode(gameApi.param)) {
        stopDuel = Versus.start(root, api, 'guess', gameApi.param, {
          run(stage, rand, hooks){
            const host = document.createElement('div');
            stage.appendChild(host);
            play(host, { rand, onScore: hooks.progress, onEnd: (correct, points) => {
              host.innerHTML = `<div class="gv-intro"><div class="gv-big">${correct}/${ROUNDS}</div><p>Очков: <b>${points}</b></p></div>`;
              hooks.done(points);
            } });
          },
          stop: clearTimers,
        });
      } else renderIntro();
    },
    unmount(){ clearTimers(); G = null; stopDuel?.(); stopDuel = null; root = null; },
  };
})();
