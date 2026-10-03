// ═══════════════════════════════════════
//  ИГРА «5 БУКВ» (русский вордл) — слово дня, свободная игра, «⚔️ Соревнование»
// ═══════════════════════════════════════
// 6 попыток угадать слово из 5 букв. 🟩 буква на месте, 🟨 есть в слове, ⬜ нет. Ё = Е.
// Слово дня одно на всех, меняется в полночь по МСК (номер дня — от 03.10.2026). Прогресс дня и
// статистика — в localStorage; «Поделиться» — квадратики без самого слова (механика Wordle).
// Словари — js/games/words-data.js (собирает scripts/make-words.py).
// Клавиатура: русские буквы, а при английской раскладке — по физическим клавишам (e.code).
(() => {
  const ROWS = 6, LEN = 5;
  const START = Date.UTC(2026, 9, 3);   // день №1 — 03.10.2026
  const KB = ['йцукенгшщзхъ', 'фывапролджэ', '⏎ячсмитьбю⌫'];
  const CODE = { KeyQ: 'й', KeyW: 'ц', KeyE: 'у', KeyR: 'к', KeyT: 'е', KeyY: 'н', KeyU: 'г', KeyI: 'ш', KeyO: 'щ', KeyP: 'з',
    BracketLeft: 'х', BracketRight: 'ъ', KeyA: 'ф', KeyS: 'ы', KeyD: 'в', KeyF: 'а', KeyG: 'п', KeyH: 'р', KeyJ: 'о', KeyK: 'л',
    KeyL: 'д', Semicolon: 'ж', Quote: 'э', KeyZ: 'я', KeyX: 'ч', KeyC: 'с', KeyV: 'м', KeyB: 'и', KeyN: 'т', KeyM: 'ь',
    Comma: 'б', Period: 'ю', Backquote: 'е' };
  const RANK = { n: 1, y: 2, g: 3 };
  let root, api, W = null, stopDuel = null, allowedSet = null, timer = 0;

  function dict(){
    if (!allowedSet) {
      allowedSet = new Set();
      const s = window.WORDS5.allowed;
      for (let i = 0; i < s.length; i += LEN) allowedSet.add(s.slice(i, i + LEN));
    }
    return allowedSet;
  }
  const dayNo = () => Math.floor((Date.now() + 3 * 3600e3) / 864e5) - Math.floor(START / 864e5) + 1;
  const dailyWord = n => { const a = window.WORDS5.answers; return a[((n - 1) % a.length + a.length) % a.length]; };
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  // 'g' — на месте, 'y' — есть в слове, 'n' — нет. Повторы букв считаются честно (как в Wordle).
  function evaluate(guess, answer){
    const res = Array(LEN).fill('n'), left = {};
    for (let i = 0; i < LEN; i++) { if (guess[i] === answer[i]) res[i] = 'g'; else left[answer[i]] = (left[answer[i]] || 0) + 1; }
    for (let i = 0; i < LEN; i++) if (res[i] !== 'g' && left[guess[i]]) { res[i] = 'y'; left[guess[i]]--; }
    return res;
  }

  // ── Экран игры. opt: { mode: 'daily'|'free'|'duel', word, saved, onEnd(win, tries, sec) } ──
  function render(el, opt){
    W = { el, opt, word: opt.word, rows: [], cur: '', over: false, t0: Date.now(), keys: {} };
    const n = dayNo();
    el.innerHTML = `<div class="wd">
        ${opt.mode === 'duel' ? '' : `<div class="wd-modes">
          <button data-m="daily" class="${opt.mode === 'daily' ? 'on' : ''}">📅 Слово дня #${n}</button>
          <button data-m="free" class="${opt.mode === 'free' ? 'on' : ''}">♾️ Свободная игра</button></div>`}
        <div class="wd-grid">${Array.from({ length: ROWS }, () => `<div class="wd-row">${'<span class="wd-tile"></span>'.repeat(LEN)}</div>`).join('')}</div>
        <div class="ct-status wd-status">${opt.mode === 'duel' ? 'Одно слово на двоих: меньше попыток и быстрее — больше очков' : 'Угадай слово из 5 букв за 6 попыток'}</div>
        ${opt.mode === 'duel' ? '' : '<div class="wd-hintbar"><button type="button" class="wd-hint">💡 Подсказка</button><span class="wd-hinttext"></span></div>'}
        <div class="wd-kb">${KB.map(r => `<div>${[...r].map(k => `<button type="button" data-k="${k}"${k === '⏎' || k === '⌫' ? ' class="wide"' : ''} aria-label="${k === '⏎' ? 'Ввод' : k === '⌫' ? 'Стереть' : k}">${k === '⏎' ? 'ВВОД' : k}</button>`).join('')}</div>`).join('')}</div>
        <div class="wd-end" hidden></div>
      </div>`;
    el.querySelectorAll('.wd-modes button').forEach(b => b.onclick = () => start(b.dataset.m));
    el.querySelector('.wd-hint')?.addEventListener('click', hint);
    if (opt.saved?.hint) showHint(opt.saved.hint);
    el.querySelectorAll('.wd-kb button').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); press(b.dataset.k); }));
    // Восстановить сохранённые ходы (слово дня после перезагрузки)
    for (const g of opt.saved?.rows || []) { W.cur = g; commit(true); }
    if (opt.saved?.done) showEnd(opt.saved.win, true);
  }

  function rowEl(i){ return W.el.querySelectorAll('.wd-row')[i]; }
  function paintCur(){
    const tiles = rowEl(W.rows.length)?.children;
    if (!tiles) return;
    for (let i = 0; i < LEN; i++) { tiles[i].textContent = W.cur[i] || ''; tiles[i].classList.toggle('typed', !!W.cur[i]); }
  }
  function status(text, cls){ const s = W.el.querySelector('.wd-status'); s.textContent = text; s.className = 'ct-status wd-status' + (cls ? ' ' + cls : ''); }
  function shake(){ const r = rowEl(W.rows.length); r.classList.remove('shake'); void r.offsetWidth; r.classList.add('shake'); api.sfx('bad'); }

  function press(k){
    if (!W || W.over) return;
    if (k === '⏎') return enter();
    if (k === '⌫') { W.cur = W.cur.slice(0, -1); paintCur(); return; }
    if (W.cur.length >= LEN || !/^[а-яё]$/.test(k)) return;
    W.cur += k === 'ё' ? 'е' : k;
    paintCur();
  }

  function enter(){
    if (W.cur.length < LEN) { status('Нужно слово из 5 букв', 'err'); return shake(); }
    if (!dict().has(W.cur)) { status(`Слова «${W.cur.toUpperCase()}» нет в словаре`, 'err'); return shake(); }
    commit(false);
  }

  function commit(restoring){
    const guess = W.cur, res = evaluate(guess, W.word), i = W.rows.length;
    W.rows.push(guess); W.cur = '';
    const tiles = rowEl(i).children;
    for (let j = 0; j < LEN; j++) {
      tiles[j].textContent = guess[j];
      tiles[j].style.setProperty('--d', restoring ? '0ms' : j * 140 + 'ms');
      tiles[j].classList.add('rev', res[j]);
    }
    for (let j = 0; j < LEN; j++) {
      const b = W.el.querySelector(`.wd-kb [data-k="${guess[j]}"]`);
      if (b && (RANK[res[j]] > (RANK[W.keys[guess[j]]] || 0))) { W.keys[guess[j]] = res[j]; b.className = res[j]; }
    }
    if (restoring) return;
    const win = guess === W.word;
    if (W.opt.mode === 'daily') { save('d37_words_day', { n: dayNo(), word: W.word, rows: W.rows, done: win || W.rows.length >= ROWS, win, hint: W.hint || null }); window.gamesDailyDot?.(); }
    if (win || W.rows.length >= ROWS) {
      W.over = true;
      setTimeout(() => showEnd(win, false), 140 * LEN + 250);
    } else {
      api.sfx('move');
      status(`Попытка ${W.rows.length + 1} из ${ROWS}`);
    }
  }

  // ── Подсказка для VIP (и персонала): одна буква на слово. Остальным — как получить VIP ──
  // VIP даётся за донат или за 30-й уровень (progression.sql) — повод поддержать стрим, игра при этом бесплатна.
  function hasHintPerk(){
    try { return typeof currentProfile !== 'undefined' && !!currentProfile && typeof hasPerks === 'function' && hasPerks(currentProfile.role, currentProfile); }
    catch (e) { return false; }
  }
  function showHint(h){
    W.hint = h;
    const t = W.el.querySelector('.wd-hinttext');
    if (t) t.innerHTML = `Буква №${h.i + 1} — <b>«${h.ch.toUpperCase()}»</b>`;
    const b = W.el.querySelector('.wd-hint'); if (b) b.disabled = true;
  }
  function hint(){
    if (!W || W.over) return;
    const t = W.el.querySelector('.wd-hinttext');
    if (!hasHintPerk()) {
      t.innerHTML = 'Подсказки — для VIP: VIP даётся за <a href="#/donate">донат</a> или за 30-й уровень на сайте';
      if (typeof window.va === 'function') window.va('event', { name: 'words_hint_locked' });
      return;
    }
    if (W.hint) return;
    const green = new Set();
    for (const g of W.rows) evaluate(g, W.word).forEach((r, i) => { if (r === 'g') green.add(i); });
    const free = [...Array(LEN).keys()].filter(i => !green.has(i));
    if (!free.length) return;
    const i = free[Math.floor(Math.random() * free.length)];
    showHint({ i, ch: W.word[i] });
    // Сохраняем сразу, даже до первого хода — иначе после перезагрузки можно взять вторую букву
    if (W.opt.mode === 'daily') { const s = load('d37_words_day', null); const base = s && s.n === dayNo() && s.word === W.word ? s : { n: dayNo(), word: W.word, rows: W.rows, done: false, win: false }; save('d37_words_day', { ...base, hint: W.hint }); }
  }

  function grid(){ return W.rows.map(g => evaluate(g, W.word).map(r => r === 'g' ? '🟩' : r === 'y' ? '🟨' : '⬜').join('')).join('\n'); }

  function showEnd(win, restored){
    W.over = true;
    const tries = W.rows.length, sec = Math.round((Date.now() - W.t0) / 1000);
    status(win ? ['Гениально!', 'Потрясающе!', 'Отлично!', 'Хорошо!', 'Неплохо!', 'Фух, успел!'][tries - 1] : `Не угадал. Это было слово «${W.word.toUpperCase()}»`, win ? 'win' : 'err');
    if (!restored) api.sfx(win ? 'win' : 'bad');
    if (W.opt.mode === 'duel') { if (!restored) W.opt.onEnd(win, tries, sec); return; }
    if (!restored) {
      if (W.opt.mode === 'daily') addStats(win, tries);
      W.opt.onEnd(win, tries, sec);
    }
    const end = W.el.querySelector('.wd-end');
    end.hidden = false;
    const daily = W.opt.mode === 'daily';
    const st = load('d37_words_stats', null);
    end.innerHTML = `
      ${win ? `<div class="wd-word">Слово: <b>${W.word.toUpperCase()}</b></div>` : ''}
      ${daily && st ? `<div class="wd-stats"><span><b>${st.played}</b>сыграно</span><span><b>${Math.round(100 * st.wins / Math.max(1, st.played))}%</b>побед</span><span><b>${st.streak}</b>серия</span><span><b>${st.best}</b>лучшая серия</span></div>
        <div class="wd-dist">${st.dist.map((c, i) => `<div><span>${i + 1}</span><i style="--w:${Math.max(8, 100 * c / Math.max(1, ...st.dist))}%"${win && tries === i + 1 ? ' class="me"' : ''}>${c}</i></div>`).join('')}</div>` : ''}
      <div class="ct-actions">
        <button class="ct-start wdShare">📤 Поделиться результатом</button>
        <button class="wdFree">♾️ ${daily ? 'Играть ещё' : 'Новое слово'}</button>
        <button class="ct-duel-btn wdDuel">⚔️ С другом</button>
      </div>
      ${daily ? '<div class="ct-note wd-next">Новое слово дня через <b class="wdLeft"></b></div>' : ''}`;
    end.querySelector('.wdShare').onclick = e => share(e.target, win);
    end.querySelector('.wdFree').onclick = () => start('free');
    end.querySelector('.wdDuel').onclick = () => { location.hash = '#/games/words/' + GameRoom.newCode(); };
    if (daily) tickLeft();
  }

  function tickLeft(){
    clearTimeout(timer);
    const el = W?.el.querySelector('.wdLeft');
    if (!el) return;
    const left = 864e5 - (Date.now() + 3 * 3600e3) % 864e5;
    const h = Math.floor(left / 3600e3), m = Math.floor(left % 3600e3 / 60e3);
    el.textContent = `${h} ч ${String(m).padStart(2, '0')} мин`;
    timer = setTimeout(tickLeft, 30e3);
  }

  function addStats(win, tries){
    const st = load('d37_words_stats', { played: 0, wins: 0, streak: 0, best: 0, last: 0, dist: [0, 0, 0, 0, 0, 0] });
    const n = dayNo();
    if (st.last === n) return;   // день уже засчитан
    st.played++;
    if (win) { st.wins++; st.dist[tries - 1]++; st.streak = st.last === n - 1 ? st.streak + 1 : 1; st.best = Math.max(st.best, st.streak); }
    else st.streak = 0;
    st.last = n;
    save('d37_words_stats', st);
  }

  async function share(btn, win){
    const daily = W.opt.mode === 'daily';
    const text = `5 букв${daily ? ' #' + dayNo() : ''} ${win ? W.rows.length : 'X'}/6${W.hint ? ' 💡' : ''}\n${grid()}`;
    const url = location.origin + '/games/words';
    if (typeof window.va === 'function') window.va('event', { name: 'words_share' });
    if (navigator.share) { navigator.share({ text: text + '\n', url }).catch(() => {}); return; }
    try { await navigator.clipboard.writeText(text + '\n' + url); btn.textContent = '✅ Скопировано — отправь другу'; }
    catch (e) { prompt('Скопируй и отправь:', text + '\n' + url); }
  }

  // ── Режимы ──
  function start(mode){
    if (mode === 'daily') {
      const n = dayNo(), word = dailyWord(n);
      const s = load('d37_words_day', null);
      const saved = s && s.n === n && s.word === word ? s : null;
      render(root, { mode, word, saved, onEnd: (win, tries) => api.report('words', win, win ? 7 - tries : 0, win ? 7 - tries : 0) });
    } else {
      const a = window.WORDS5.answers;
      let word;
      do word = a[Math.floor(Math.random() * a.length)]; while (a.length > 1 && word === W?.word);
      render(root, { mode: 'free', word, onEnd: (win, tries) => api.report('words_free', win, win ? 7 - tries : 0, 0) });
    }
  }

  function onKey(e){
    if (!W || !root?.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input,textarea,[contenteditable]')) return;
    let k = null;
    if (e.key === 'Enter') k = '⏎';
    else if (e.key === 'Backspace') k = '⌫';
    else if (/^[а-яё]$/i.test(e.key)) k = e.key.toLowerCase();
    else if (CODE[e.code]) k = CODE[e.code];
    if (!k) return;
    e.preventDefault();
    press(k);
  }

  window.GAME_IMPL.words = {
    mount(el, gameApi){
      root = el; api = gameApi;
      document.addEventListener('keydown', onKey);
      if (GameRoom.validCode(gameApi.param)) {
        stopDuel = Versus.start(root, api, 'words', gameApi.param, {
          run(stage, rng, hooks){
            const host = document.createElement('div');
            stage.appendChild(host);
            const a = window.WORDS5.answers;
            render(host, { mode: 'duel', word: a[Math.floor(rng() * a.length)],
              // Очки: (7 − попыток) × 100 + до 99 за скорость; не угадал — 0
              onEnd: (win, tries, sec) => hooks.done(win ? (7 - tries) * 100 + Math.max(0, 99 - Math.floor(sec / 3)) : 0) });
          },
          stop(){ W = null; },
        });
      } else start('daily');
    },
    unmount(){ clearTimeout(timer); W = null; stopDuel?.(); stopDuel = null; document.removeEventListener('keydown', onKey); root = null; },
    _test: { evaluate, dailyWord, dayNo },
  };
})();
