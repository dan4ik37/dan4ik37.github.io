// ═══════════════════════════════════════
//  ИГРА «УГАДАЙ ВИДЕО» — ролики канала (allVids из youtube.js)
// ═══════════════════════════════════════
// 10 раундов: превью показывается сильно увеличенным кусочком и за 12 секунд
// отъезжает до целого кадра. 4 варианта названия. Очки: быстрее — больше.
(() => {
  const ROUNDS = 10, ROUND_MS = 12000;
  let root, api, G, timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; if (G) cancelAnimationFrame(G.raf); };
  const shorten = t => { t = String(t || '').replace(/\s*#\S+/g, '').trim(); return t.length > 80 ? t.slice(0, 77) + '…' : t; };
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  async function videos(){
    if (typeof ensureYT === 'function') { try { await ensureYT(); } catch (e) {} }
    const list = (typeof allVids !== 'undefined' ? allVids : []).filter(v => v && v.id && v.title);
    const seen = new Set();
    return list.filter(v => { const k = shorten(v.title).toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  }

  async function renderIntro(){
    const st = api.local();
    root.innerHTML = `<div class="gv-intro">
        <div class="gv-big">🎬</div>
        <p>Покажем кусочек превью ролика dan4ik37 — угадай, что это за видео. Картинка постепенно отдаляется: чем раньше ответишь, тем больше очков.</p>
        <button class="ct-start" id="gvStart">▶ Начать (${ROUNDS} раундов)</button>
        <div class="ct-stats">Лучший результат: <b>${st.best || 0}/${ROUNDS}</b> · Игр: <b>${st.plays || 0}</b></div>
      </div>`;
    root.querySelector('#gvStart').onclick = start;
  }

  async function start(){
    root.innerHTML = '<div class="gm-loading"><div class="spinner"></div>Загружаем ролики…</div>';
    const vids = await videos();
    if (!root) return;
    if (vids.length < 6) {
      root.innerHTML = `<div class="empty-state"><span class="empty-state-icon">📼</span><div class="empty-state-title">Мало роликов</div><div class="empty-state-text">Не удалось загрузить список видео канала. Попробуй позже.</div></div>`;
      return;
    }
    G = { vids, order: shuffle(vids.slice()).slice(0, ROUNDS), round: 0, correct: 0, points: 0, raf: 0, answered: false };
    root.innerHTML = `<div class="gv-game">
        <div class="ct-top"><span class="ct-badge" id="gvRound"></span><span class="ct-score">Очки: <b id="gvPoints">0</b></span><span class="ct-score">Верно: <b id="gvCorrect">0</b></span></div>
        <div class="gv-frame"><img id="gvImg" alt="Превью" draggable="false"><div class="gv-bar"><i id="gvBar"></i></div></div>
        <div class="gv-opts" id="gvOpts"></div>
        <div class="ct-status" id="gvStatus"></div>
      </div>`;
    nextRound();
  }

  function nextRound(){
    if (!root) return;
    if (G.round >= G.order.length) return finish();
    G.answered = false;
    const v = G.order[G.round];
    const wrong = shuffle(G.vids.filter(x => x.id !== v.id)).slice(0, 3);
    const opts = shuffle([v, ...wrong]);
    root.querySelector('#gvRound').textContent = `Раунд ${G.round + 1}/${G.order.length}`;
    root.querySelector('#gvStatus').textContent = '';
    root.querySelector('#gvStatus').className = 'ct-status';
    const img = root.querySelector('#gvImg');
    // Случайная точка «кусочка» и сильный зум, который плавно уходит
    const ox = 20 + Math.random() * 60, oy = 20 + Math.random() * 60;
    img.style.transformOrigin = `${ox}% ${oy}%`;
    img.style.transform = 'scale(4.5)';
    img.style.filter = 'blur(2px)';
    img.src = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
    root.querySelector('#gvOpts').innerHTML = opts.map((o, i) => `<button class="gv-opt" data-id="${o.id}">${i + 1}. ${esc(shorten(o.title))}</button>`).join('');
    root.querySelectorAll('.gv-opt').forEach(b => b.onclick = () => answer(b.dataset.id, v));
    const t0 = performance.now();
    G.t0 = t0;
    const bar = root.querySelector('#gvBar');
    const step = now => {
      if (!root || G.answered) return;
      const p = Math.min(1, (now - t0) / ROUND_MS);
      img.style.transform = `scale(${(4.5 - 3.5 * p).toFixed(3)})`;
      img.style.filter = `blur(${(2 * (1 - p)).toFixed(2)}px)`;
      bar.style.width = ((1 - p) * 100).toFixed(1) + '%';
      if (p >= 1) return answer(null, v);
      G.raf = requestAnimationFrame(step);
    };
    G.raf = requestAnimationFrame(step);
  }

  function answer(id, v){
    if (G.answered) return;
    G.answered = true;
    cancelAnimationFrame(G.raf);
    const img = root.querySelector('#gvImg');
    img.style.transform = 'scale(1)'; img.style.filter = 'none';
    const elapsed = performance.now() - G.t0;
    const ok = id === v.id;
    const pts = ok ? Math.max(10, Math.round(100 * (1 - elapsed / ROUND_MS))) : 0;
    if (ok) { G.correct++; G.points += pts; }
    api.sfx(ok ? 'ok' : 'bad');
    root.querySelectorAll('.gv-opt').forEach(b => {
      b.disabled = true;
      if (b.dataset.id === v.id) b.classList.add('right');
      else if (b.dataset.id === id) b.classList.add('wrong');
    });
    root.querySelector('#gvPoints').textContent = G.points;
    root.querySelector('#gvCorrect').textContent = G.correct;
    const st = root.querySelector('#gvStatus');
    st.innerHTML = ok ? `✅ Верно! +${pts}` : id ? '❌ Мимо' : '⏱ Время вышло';
    st.className = 'ct-status ' + (ok ? 'win' : 'err');
    G.round++;
    later(nextRound, 1600);
  }

  async function finish(){
    const win = G.correct >= 7;
    api.sfx(win ? 'win' : 'ok');
    const verdict = G.correct === ROUNDS ? '🏆 Идеально! Ты настоящий фанат канала!' : win ? '🎉 Отлично, ты явно смотришь канал!' : G.correct >= 4 ? '🙂 Неплохо! Пересмотри пару роликов 😉' : '😅 Похоже, пора посмотреть канал!';
    root.innerHTML = `<div class="gv-intro">
        <div class="gv-big">${G.correct}/${ROUNDS}</div>
        <p>${verdict}<br>Очков: <b>${G.points}</b></p>
        <div class="ct-actions"><button class="ct-start" id="gvAgain">↻ Ещё раз</button><a class="gv-link" href="#/home">▶ Смотреть видео</a></div>
      </div>`;
    root.querySelector('#gvAgain').onclick = start;
    await api.report('guess', win, G.correct, G.correct);
  }

  window.GAME_IMPL.guess = {
    mount(el, gameApi){ root = el; api = gameApi; renderIntro(); },
    unmount(){ clearTimers(); if (G) G.answered = true; root = null; },
  };
})();
