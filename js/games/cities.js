// ═══════════════════════════════════════
//  ИГРА «ГОРОДА» — против бота. Словарь: js/games/cities-data.js
// ═══════════════════════════════════════
// Правила: город на последнюю букву предыдущего; Ь, Ъ, Ы, Й (и буквы, на которые
// в словаре нет городов) пропускаются — берётся предыдущая. Повторять нельзя.
// Проигрывает тот, кто не назвал город (или вышло время).
(() => {
  const DIFF = {
    easy:   { label: 'Лёгкий',  key: 'cities_easy',   note: 'бот знает в основном крупные города и иногда сдаётся' },
    normal: { label: 'Средний', key: 'cities_normal', note: 'бот знает всё, но может растеряться в длинной партии' },
    hard:   { label: 'Сложный', key: 'cities_hard',   note: 'не сдаётся и подбирает города на неудобные буквы' },
  };
  // Й тоже пропускаем: на неё в России один город, в мире — единицы (обычное дворовое правило)
  const SKIP = new Set(['ь', 'ъ', 'ы', 'й']);
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[\s\-‐–—’'.]/g, '');

  let DB = null;   // [{ name, country, pop, lat, lon, key, first }]
  function db(){
    if (DB) return DB;
    DB = window.CITIES_RAW.split('\n').map(line => {
      const [name, country, pop, lat, lon] = line.split('|');
      const key = norm(name);
      return { name, country, pop: +pop || 0, lat: lat ? +lat : null, lon: lon ? +lon : null, key, first: key[0] };
    });
    return DB;
  }

  let root, api, S, timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; clearInterval(S?.tick); };

  function settings(){
    let st = {};
    try { st = JSON.parse(localStorage.getItem('d37_cities_cfg') || '{}'); } catch (e) {}
    return { diff: DIFF[st.diff] ? st.diff : 'normal', scope: st.scope === 'world' ? 'world' : 'ru', timer: [0, 30, 60].includes(st.timer) ? st.timer : 60 };
  }
  function saveSettings(cfg){ try { localStorage.setItem('d37_cities_cfg', JSON.stringify(cfg)); } catch (e) {} }

  // ── Экран настроек ──
  function renderSetup(){
    const cfg = settings();
    const st = api.local();
    const opt = (name, val, label, cur) => `<button class="ct-opt${val === cur ? ' active' : ''}" data-name="${name}" data-val="${val}">${label}</button>`;
    root.innerHTML = `
      <div class="ct-setup">
        <div class="ct-row"><span>Сложность</span><div class="ct-opts">${Object.entries(DIFF).map(([k, d]) => opt('diff', k, d.label, cfg.diff)).join('')}</div></div>
        <div class="ct-note" id="ctDiffNote">${DIFF[cfg.diff].note}</div>
        <div class="ct-row"><span>Города</span><div class="ct-opts">${opt('scope', 'ru', '🇷🇺 России', cfg.scope)}${opt('scope', 'world', '🌍 Всего мира', cfg.scope)}</div></div>
        <div class="ct-row"><span>Время на ход</span><div class="ct-opts">${opt('timer', 30, '30 с', cfg.timer)}${opt('timer', 60, '60 с', cfg.timer)}${opt('timer', 0, 'без таймера', cfg.timer)}</div></div>
        <button class="ct-start" id="ctStart">▶ Начать игру</button>
        <div class="ct-stats">Побед: <b>${st.wins || 0}</b> · Игр: <b>${st.plays || 0}</b> · Лучшая цепочка: <b>${st.best || 0}</b></div>
        <details class="ct-rules"><summary>Правила</summary>
          <p>Называй город на последнюю букву предыдущего. Если город кончается на Ь, Ъ, Ы или Й — бери предыдущую букву.
          Города не повторяются. Кто не смог назвать город или не успел — проиграл.
          Есть 3 подсказки за игру. «Ё» и «Е» — одно и то же, дефисы и пробелы можно не писать.</p>
          <p>В словаре ${db().length.toLocaleString('ru')} ${plural(db().length, 'город', 'города', 'городов')}: все города России и крупные города мира.</p>
        </details>
      </div>`;
    root.querySelectorAll('.ct-opt').forEach(b => b.onclick = () => {
      const c = settings();
      c[b.dataset.name] = b.dataset.name === 'timer' ? +b.dataset.val : b.dataset.val;
      saveSettings(c);
      root.querySelectorAll(`.ct-opt[data-name="${b.dataset.name}"]`).forEach(x => x.classList.toggle('active', x === b));
      if (b.dataset.name === 'diff') root.querySelector('#ctDiffNote').textContent = DIFF[c.diff].note;
    });
    root.querySelector('#ctStart').onclick = () => start(settings());
  }

  // ── Партия ──
  function start(cfg){
    clearTimers();
    const pool = cfg.scope === 'ru' ? db().filter(c => c.country === 'Россия') : db();
    const byKey = new Map(pool.map(c => [c.key, c]));
    const startCount = {};
    pool.forEach(c => { startCount[c.first] = (startCount[c.first] || 0) + 1; });
    S = { cfg, pool, byKey, startCount, used: new Set(), chain: [], letter: null, hints: 3, turn: 0, over: false, left: 0, tick: 0 };

    root.innerHTML = `
      <div class="ct-game">
        <div class="ct-top">
          <span class="ct-badge">${DIFF[cfg.diff].label} · ${cfg.scope === 'ru' ? 'Россия' : 'Мир'}</span>
          <span class="ct-score">Твоих городов: <b id="ctMine">0</b></span>
          <span class="ct-timer" id="ctTimer" ${cfg.timer ? '' : 'hidden'}></span>
        </div>
        <div class="ct-chain" id="ctChain"></div>
        <div class="ct-status" id="ctStatus"></div>
        <form class="ct-input" id="ctForm" autocomplete="off">
          <input id="ctInput" maxlength="40" placeholder="Твой город…" enterkeyhint="send" autocapitalize="words">
          <button type="submit">➤</button>
        </form>
        <div class="ct-actions">
          <button id="ctHint">💡 Подсказка (<span id="ctHints">3</span>)</button>
          <button id="ctGiveUp">🏳 Сдаться</button>
        </div>
      </div>`;
    root.querySelector('#ctForm').onsubmit = e => { e.preventDefault(); playerMove(); };
    root.querySelector('#ctHint').onclick = hint;
    root.querySelector('#ctGiveUp').onclick = () => finish(false, 'Ты сдался');

    // Первым ходит бот — называет крупный город, чтобы было с чего начать
    botMove(true);
  }

  const $ = id => root.querySelector('#' + id);

  // Буква, на которую нужно назвать следующий город
  function nextLetter(name){
    const k = norm(name);
    for (let i = k.length - 1; i >= 0; i--) {
      const ch = k[i];
      if (!SKIP.has(ch) && S.startCount[ch]) return ch;
    }
    return k[0];
  }
  const remaining = letter => S.pool.reduce((n, c) => n + (c.first === letter && !S.used.has(c.key) ? 1 : 0), 0);

  function distanceKm(a, b){
    if (a?.lat == null || b?.lat == null) return null;
    const R = 6371, toRad = x => x * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }

  function addToChain(city, by){
    const prev = S.chain[S.chain.length - 1];
    S.used.add(city.key);
    S.chain.push({ city, by });
    const d = prev && distanceKm(prev.city, city);
    const L = nextLetter(city.name);
    const nameHtml = esc(city.name).replace(new RegExp('(' + L + ')(?!.*' + L + ')', 'i'), '<u>$1</u>');
    const el = document.createElement('div');
    el.className = 'ct-city ' + (by === 'me' ? 'me' : 'bot');
    el.innerHTML = `<span class="ct-name">${by === 'bot' ? '🤖 ' : ''}${nameHtml}</span>
      <span class="ct-meta">${esc(city.country || '')}${d != null ? ` · 📏 ${d.toLocaleString('ru')} км` : ''}${city.pop > 1e6 ? ' · миллионник' : ''}</span>`;
    $('ctChain').appendChild(el);
    $('ctChain').scrollTop = $('ctChain').scrollHeight;
    S.letter = L;
    if (by === 'me') $('ctMine').textContent = S.chain.filter(c => c.by === 'me').length;
  }

  function setStatus(html, kind){
    const st = $('ctStatus');
    st.innerHTML = html;
    st.className = 'ct-status' + (kind ? ' ' + kind : '');
  }

  function yourTurn(){
    const L = S.letter.toUpperCase();
    setStatus(`Твой ход: город на «<b>${L}</b>» · осталось городов на эту букву: ${remaining(S.letter)}`);
    const inp = $('ctInput');
    inp.disabled = false; inp.value = ''; inp.placeholder = `Город на «${L}»…`;
    if (!matchMedia('(pointer:coarse)').matches) inp.focus();
    startTimer();
  }

  function startTimer(){
    clearInterval(S.tick);
    if (!S.cfg.timer) return;
    S.left = S.cfg.timer;
    const el = $('ctTimer');
    const draw = () => { el.textContent = `⏱ ${S.left}`; el.classList.toggle('low', S.left <= 10); };
    draw();
    S.tick = setInterval(() => {
      S.left--; draw();
      if (S.left <= 5 && S.left > 0) api.sfx('tick');
      if (S.left <= 0) { clearInterval(S.tick); finish(false, 'Время вышло ⏱'); }
    }, 1000);
  }

  function playerMove(){
    if (S.over) return;
    const raw = $('ctInput').value.trim();
    if (!raw) return;
    const key = norm(raw);
    const city = S.byKey.get(key);
    const L = S.letter;
    if (!city) {
      api.sfx('bad');
      const other = S.cfg.scope === 'ru' && db().find(c => c.key === key);
      return setStatus(other ? `«${esc(raw)}» — это не Россия. Сейчас играем только городами России.` :
        `Не знаю города «${esc(raw)}» 🤔 Проверь написание (в словаре ${S.pool.length.toLocaleString('ru')} ${plural(S.pool.length, 'город', 'города', 'городов')}).`, 'err');
    }
    if (city.first !== L) { api.sfx('bad'); return setStatus(`Нужен город на «<b>${L.toUpperCase()}</b>», а «${esc(city.name)}» — на «${city.first.toUpperCase()}».`, 'err'); }
    if (S.used.has(city.key)) { api.sfx('bad'); return setStatus(`«${esc(city.name)}» уже был в этой игре.`, 'err'); }
    clearInterval(S.tick);
    api.sfx('ok');
    addToChain(city, 'me');
    $('ctInput').value = '';
    $('ctInput').disabled = true;
    S.turn++;
    botMove(false);
  }

  function botMove(first){
    const L = first ? null : S.letter;
    setStatus('🤖 Бот думает…');
    const cands = S.pool.filter(c => !S.used.has(c.key) && (L ? c.first === L : c.pop >= 500000 || (S.cfg.scope === 'world' && c.country && !c.pop && Math.random() < .02)));
    later(() => {
      if (S.over) return;
      const d = S.cfg.diff;
      // Лёгкий бот «знает» только крупные города; оба нехардкорных иногда сдаются в длинной партии
      let list = d === 'easy' ? cands.filter(c => c.pop >= 50000 || (c.country !== 'Россия' && Math.random() < .5)) : cands;
      const giveUp = first ? 0 : d === 'easy' ? (S.turn >= 5 ? .16 : 0) : d === 'normal' ? (S.turn >= 12 ? .06 : 0) : 0;
      if (!list.length || Math.random() < giveUp) return finish(true, '🤖 Бот не смог вспомнить город!');
      let pick;
      if (d === 'hard') {
        // Ловушка: город, после которого у игрока меньше всего вариантов
        let best = Infinity;
        const sample = list.length > 120 ? list.sort(() => Math.random() - .5).slice(0, 120) : list;
        for (const c of sample) {
          const n = remaining(nextLetter(c.name)) - (nextLetter(c.name) === c.first ? 1 : 0);
          if (n < best || (n === best && Math.random() < .5)) { best = n; pick = c; }
        }
      } else {
        pick = list[Math.floor(Math.random() * list.length)];
      }
      addToChain(pick, 'bot');
      api.sfx('move');
      if (!remaining(S.letter)) return finish(false, `На «${S.letter.toUpperCase()}» городов больше нет — бот загнал тебя в угол!`);
      yourTurn();
    }, first ? 400 : 500 + Math.random() * 700);
  }

  function hint(){
    if (S.over || !S.letter || $('ctInput').disabled) return;
    if (S.hints <= 0) return setStatus('Подсказки кончились 🙃', 'err');
    const cands = S.pool.filter(c => c.first === S.letter && !S.used.has(c.key)).sort((a, b) => b.pop - a.pop).slice(0, 40);
    if (!cands.length) return;
    const c = cands[Math.floor(Math.random() * cands.length)];
    S.hints--;
    $('ctHints').textContent = S.hints;
    const shown = c.name.slice(0, Math.min(3, Math.max(2, c.name.length - 2)));
    setStatus(`💡 Попробуй: «<b>${esc(shown)}…</b>» (${c.name.length} букв${c.country ? ', ' + esc(c.country) : ''})`, 'hint');
  }

  async function finish(win, reason){
    if (S.over) return;
    S.over = true;
    clearTimers();
    const mine = S.chain.filter(c => c.by === 'me').length;
    api.sfx(win ? 'win' : 'bad');
    $('ctInput').disabled = true;
    root.querySelector('.ct-actions').innerHTML = `<button class="ct-start" id="ctAgain">↻ Ещё раз</button><button id="ctSetup">⚙ Настройки</button>`;
    root.querySelector('#ctAgain').onclick = () => start(S.cfg);
    root.querySelector('#ctSetup').onclick = renderSetup;
    const why = /[.!?⏱]$/.test(reason) ? reason : reason + '.';
    setStatus(`${win ? '🎉 <b>Победа!</b>' : '😔 <b>Поражение.</b>'} ${esc(why)} Твоих городов: <b>${mine}</b>, всего в цепочке: ${S.chain.length}.`, win ? 'win' : 'err');
    await api.report(DIFF[S.cfg.diff].key, win, mine, mine);
  }

  window.GAME_IMPL.cities = {
    mount(el, gameApi){ root = el; api = gameApi; root.classList.add('ct-root'); renderSetup(); },
    unmount(){ clearTimers(); if (S) S.over = true; root = null; },
  };
})();
