// ═══════════════════════════════════════
//  ИГРА «ГОРОДА» — против бота или онлайн с другом. Словарь: js/games/cities-data.js
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
        <button class="ct-start" id="ctStart">▶ Играть с ботом</button>
        <button class="ct-duel-btn" id="ctDuel">👥 Играть с другом онлайн</button>
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
    root.querySelector('#ctDuel').onclick = duelCreate;
  }

  // ── Партия ──
  function start(cfg, duel){
    clearTimers();
    const pool = cfg.scope === 'ru' ? db().filter(c => c.country === 'Россия') : db();
    const byKey = new Map(pool.map(c => [c.key, c]));
    const startCount = {};
    pool.forEach(c => { startCount[c.first] = (startCount[c.first] || 0) + 1; });
    S = { cfg, pool, byKey, startCount, used: new Set(), chain: [], letter: null, hints: 3, turn: 0, over: false, left: 0, tick: 0, duel: duel || null };

    root.innerHTML = `
      <div class="ct-game">
        <div class="ct-top">
          <span class="ct-badge">${duel ? '👥 против ' + esc(duel.oppNick) : DIFF[cfg.diff].label} · ${cfg.scope === 'ru' ? 'Россия' : 'Мир'}</span>
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

    if (duel) {
      // Онлайн: первым ходит тот, кого выбрал хозяин комнаты (по очереди от партии к партии)
      if (duel.first === duel.myId) yourTurn();
      else { $('ctInput').disabled = true; setStatus(`Ждём первый город от ${esc(duel.oppNick)}…`); }
      return;
    }
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
    el.innerHTML = `<span class="ct-name">${by === 'bot' ? '🤖 ' : by === 'opp' ? '👤 ' : ''}${nameHtml}</span>
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
    const L = S.letter ? S.letter.toUpperCase() : null;
    setStatus(L ? `Твой ход: город на «<b>${L}</b>» · осталось городов на эту букву: ${remaining(S.letter)}` : 'Твой ход первый: назови <b>любой</b> город');
    const inp = $('ctInput');
    inp.disabled = false; inp.value = ''; inp.placeholder = L ? `Город на «${L}»…` : 'Любой город…';
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
    if (L && city.first !== L) { api.sfx('bad'); return setStatus(`Нужен город на «<b>${L.toUpperCase()}</b>», а «${esc(city.name)}» — на «${city.first.toUpperCase()}».`, 'err'); }
    if (S.used.has(city.key)) { api.sfx('bad'); return setStatus(`«${esc(city.name)}» уже был в этой игре.`, 'err'); }
    clearInterval(S.tick);
    api.sfx('ok');
    addToChain(city, 'me');
    $('ctInput').value = '';
    $('ctInput').disabled = true;
    S.turn++;
    if (S.duel) {
      duelSend({ type: 'move', city: city.name, n: S.chain.length });
      setStatus(`Ход ${esc(S.duel.oppNick)}…`);
      return;
    }
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

  async function finish(win, reason, remote){
    if (S.over) return;
    S.over = true;
    clearTimers();
    // Проиграл сам (сдался, время, нет городов) — сообщаем сопернику
    if (S.duel && !win && !remote) duelSend({ type: 'lose', reason: String(reason)
      .replace('Ты сдался', 'сдался')
      .replace('Время вышло ⏱', 'не успел — время вышло ⏱')
      .replace(/^На «(.)» городов больше нет.*$/, 'не нашёл города на «$1»') });
    const mine = S.chain.filter(c => c.by === 'me').length;
    api.sfx(win ? 'win' : 'bad');
    $('ctInput').disabled = true;
    if (S.duel) {
      root.querySelector('.ct-actions').innerHTML = `<button class="ct-start" id="ctAgain">↻ Реванш</button><button id="ctSetup">🚪 Выйти</button>`;
      root.querySelector('#ctAgain').onclick = duelRematch;
      root.querySelector('#ctSetup').onclick = () => { location.hash = '#/games/cities'; };
    } else {
      root.querySelector('.ct-actions').innerHTML = `<button class="ct-start" id="ctAgain">↻ Ещё раз</button><button id="ctSetup">⚙ Настройки</button>`;
      root.querySelector('#ctAgain').onclick = () => start(S.cfg);
      root.querySelector('#ctSetup').onclick = renderSetup;
    }
    const why = /[.!?⏱]$/.test(reason) ? reason : reason + '.';
    setStatus(`${win ? '🎉 <b>Победа!</b>' : '😔 <b>Поражение.</b>'} ${esc(why)} Твоих городов: <b>${mine}</b>, всего в цепочке: ${S.chain.length}.`, win ? 'win' : 'err');
    if (S.duel && mine < 3) {
      if (win) setStatus($('ctStatus').innerHTML + ' <span class="ct-note">Партия слишком короткая — без XP.</span>', 'win');
      return;
    }
    await api.report(S.duel ? 'cities_duel' : DIFF[S.cfg.diff].key, win, mine, mine);
  }

  // ═══ Онлайн с другом: комната в Supabase Realtime (broadcast + presence, без таблиц) ═══
  // Ссылка #/games/cities/<код>. Хозяин — тот, кто в комнате раньше; он выбирает настройки
  // и шлёт «start». Ходы проверяет каждая сторона сама по тому же словарю.
  let D = null;
  function duelNick(){
    if (typeof currentProfile !== 'undefined' && currentProfile?.nick) return currentProfile.nick;
    let n = '';
    try { n = sessionStorage.getItem('d37_duel_guest') || ''; } catch (e) {}
    if (!n) { n = 'Гость ' + Math.floor(100 + Math.random() * 900); try { sessionStorage.setItem('d37_duel_guest', n); } catch (e) {} }
    return n;
  }

  function duelCreate(){
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += abc[Math.floor(Math.random() * abc.length)];
    location.hash = '#/games/cities/' + code;
  }

  function duelJoin(code){
    if (typeof sbClient === 'undefined' || !sbClient) {
      root.innerHTML = '<div class="empty-state"><span class="empty-state-icon">📡</span><div class="empty-state-title">Нет связи с сервером</div><div class="empty-state-text">Онлайн-игра недоступна — обнови страницу.</div></div>';
      return;
    }
    duelLeave();
    const myId = (typeof currentUser !== 'undefined' && currentUser?.id) || 'g-' + Math.random().toString(36).slice(2, 10);
    D = { code, myId, joinedAt: Date.now(), host: false, oppId: null, oppNick: 'соперник', round: 0, started: false, rematch: { me: false, opp: false } };
    const link = location.origin + location.pathname + '#/games/cities/' + code;
    root.innerHTML = `<div class="ct-lobby">
        <div class="gv-big">👥</div>
        <p id="ctLobbyText">Подключаемся к комнате…</p>
        <div class="ct-link"><input readonly value="${esc(link)}" id="ctLink"><button id="ctCopy">📋 Копировать</button></div>
        <div class="ct-note">Отправь ссылку другу — игра начнётся, как только он её откроет.</div>
        <div id="ctLobbyCfg"></div>
      </div>`;
    root.querySelector('#ctCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(link); root.querySelector('#ctCopy').textContent = '✅ Скопировано'; }
      catch (e) { root.querySelector('#ctLink').select(); }
    };
    const ch = sbClient.channel('cities-duel-' + code, { config: { broadcast: { self: false }, presence: { key: myId } } });
    D.ch = ch;
    ch.on('broadcast', { event: 'm' }, ({ payload }) => duelOnMessage(payload));
    ch.on('presence', { event: 'sync' }, duelOnPresence);
    ch.subscribe(async status => {
      if (status === 'SUBSCRIBED') await ch.track({ nick: duelNick(), t: D.joinedAt });
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        const el = root?.querySelector('#ctLobbyText');
        if (el) el.textContent = '⚠ Не удалось подключиться к комнате. Попробуй обновить страницу.';
      }
    });
  }

  function duelOnPresence(){
    if (!D || !root) return;
    const st = D.ch.presenceState();
    const players = Object.entries(st).map(([id, metas]) => ({ id, ...(metas[0] || {}) })).sort((a, b) => (a.t || 0) - (b.t || 0));
    const me = players.findIndex(p => p.id === D.myId);
    if (me === -1) return;
    if (me > 1) {
      root.innerHTML = '<div class="empty-state"><span class="empty-state-icon">🚪</span><div class="empty-state-title">Комната занята</div><div class="empty-state-text">В этой комнате уже играют двое. <a href="#/games/cities">Создай свою</a>.</div></div>';
      duelLeave();
      return;
    }
    D.host = me === 0;
    const opp = players[me === 0 ? 1 : 0];
    if (!opp) {
      // Соперник ушёл посреди партии — победа
      if (D.started && S && !S.over && S.duel) { finish(true, `${D.oppNick} вышел из игры`, true); }
      D.oppId = null;
      if (!D.started || (S && S.over)) duelLobbyWaiting();
      return;
    }
    D.oppId = opp.id; D.oppNick = opp.nick || 'соперник';
    if (!D.started) {
      if (D.host) duelHostStart();
      else { const el = root.querySelector('#ctLobbyText'); if (el) el.innerHTML = `Соперник <b>${esc(D.oppNick)}</b> на месте — ждём, пока он запустит игру…`; }
    }
  }

  function duelLobbyWaiting(){
    const el = root?.querySelector('#ctLobbyText');
    if (el) el.innerHTML = 'Ты в комнате. <b>Ждём друга…</b>';
    const cfgBox = root?.querySelector('#ctLobbyCfg');
    if (cfgBox && !cfgBox.childElementCount) {
      const cfg = settings();
      cfgBox.innerHTML = `<div class="ct-note">Настройки берутся из твоих: ${cfg.scope === 'ru' ? 'города России' : 'города мира'}, ${cfg.timer ? cfg.timer + ' с на ход' : 'без таймера'}.</div>`;
    }
  }

  function duelHostStart(){
    const cfg = settings();
    D.round++;
    // Первый ход — по очереди: первую партию гость, дальше чередуем
    const first = D.round % 2 === 1 ? D.oppId : D.myId;
    const msg = { type: 'start', cfg: { scope: cfg.scope, timer: cfg.timer, diff: 'normal' }, first, round: D.round, hostNick: duelNick() };
    duelSend(msg);
    duelBegin(msg);
  }

  function duelBegin(msg){
    D.started = true;
    D.round = msg.round;
    D.rematch = { me: false, opp: false };
    if (msg.hostNick && !D.host) D.oppNick = msg.hostNick;
    start(msg.cfg, { myId: D.myId, first: msg.first, oppNick: D.oppNick });
  }

  function duelSend(payload){
    if (D?.ch) D.ch.send({ type: 'broadcast', event: 'm', payload: { ...payload, from: D.myId } }).catch(() => {});
  }

  function duelOnMessage(m){
    if (!D || !root || m.from === D.myId) return;
    if (m.type === 'start' && !D.host) return duelBegin(m);
    if (!S || !S.duel) return;
    if (m.type === 'move') {
      if (S.over || m.n !== S.chain.length + 1) return;
      const city = S.byKey.get(norm(m.city));
      if (!city || S.used.has(city.key) || (S.letter && city.first !== S.letter)) return;   // рассинхрон — игнорируем
      addToChain(city, 'opp');
      api.sfx('move');
      if (!remaining(S.letter)) return finish(false, `На «${S.letter.toUpperCase()}» городов больше нет`);
      yourTurn();
    } else if (m.type === 'lose') {
      finish(true, `${D.oppNick} ${m.reason || 'сдался'}`, true);
    } else if (m.type === 'rematch') {
      D.rematch.opp = true;
      if (D.host && D.rematch.me) duelHostStart();
      else if (S.over) setStatus(`${esc(D.oppNick)} хочет реванш — жми «↻ Реванш»!`, 'hint');
    }
  }

  function duelRematch(){
    if (!D) return;
    D.rematch.me = true;
    duelSend({ type: 'rematch' });
    if (D.host && D.rematch.opp) duelHostStart();
    else setStatus(`Ждём ${esc(D.oppNick)}…`);
  }

  function duelLeave(){
    if (D?.ch) { try { D.ch.untrack(); sbClient.removeChannel(D.ch); } catch (e) {} }
    D = null;
  }

  window.GAME_IMPL.cities = {
    mount(el, gameApi){
      root = el; api = gameApi; root.classList.add('ct-root');
      if (gameApi.param && /^[a-z0-9]{4,12}$/.test(gameApi.param)) duelJoin(gameApi.param);
      else renderSetup();
    },
    unmount(){ clearTimers(); if (S) S.over = true; duelLeave(); root = null; },
  };
})();
