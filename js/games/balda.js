// ═══════════════════════════════════════
//  «БАЛДА» — поле 5×5: добавь букву и составь слово по соседним клеткам. С ботом (3 уровня), вдвоём на экране, онлайн на двоих
// ═══════════════════════════════════════
// Правила: в середине — слово из 5 букв. Ход — поставить одну букву в пустую клетку рядом с буквами (по стороне) и составить
// слово, проводя по соседним клеткам (вверх, вниз, вбок, без диагоналей; клетка — один раз); слово обязано проходить через
// новую букву. Только существительные в начальной форме (ё = е), слово — один раз за партию. Очко — за каждую букву слова.
// Нет слова — «Пропустить ход»; поле заполнилось или 4 пропуска подряд — конец, у кого больше очков — победил.
// Ход: клетка → буква → слово по клеткам (нажатиями или ведя пальцем) → «✓ Готово»; «⌫» — убрать букву слова, «✕» — отменить
// ход целиком. С ботом — «↶ Отменить ход» (свой и ответ бота) и 3 подсказки. Словари — js/games/nouns-data.js (все слова),
// js/games/nouns-common.js (понятные всем; бот на лёгком/среднем ходит ими; стартовые слова), собирает scripts/make-words.py.
// Онлайн — js/games/room.js (#/games/balda/<код>): хозяин шлёт стартовое слово; ходы проверяет каждая сторона; 2 мин на ход
// (не успел — пропуск). Ключи: balda_easy / balda_normal / balda_hard / balda_online. Движок — GAME_IMPL.balda._test.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const N = 5, CELLS = N * N, ABC = 'абвгдежзийклмнопрстуфхцчшщъыьэюя';
  const KB = ['йцукенгшщзх', 'фывапролджэ', 'ячсмитьбюъ'];
  const CODE = { KeyQ: 'й', KeyW: 'ц', KeyE: 'у', KeyR: 'к', KeyT: 'е', KeyY: 'н', KeyU: 'г', KeyI: 'ш', KeyO: 'щ', KeyP: 'з', BracketLeft: 'х', BracketRight: 'ъ',
    KeyA: 'ф', KeyS: 'ы', KeyD: 'в', KeyF: 'а', KeyG: 'п', KeyH: 'р', KeyJ: 'о', KeyK: 'л', KeyL: 'д', Semicolon: 'ж', Quote: 'э', KeyZ: 'я', KeyX: 'ч',
    KeyC: 'с', KeyV: 'м', KeyB: 'и', KeyN: 'т', KeyM: 'ь', Comma: 'б', Period: 'ю', Backquote: 'е' };
  const MOVE_SEC = 120, MAX_PASSES = 4, HINTS = 3;
  const LEVELS = { easy: { name: 'Лёгкий', max: 5 }, normal: { name: 'Средний', max: 9 }, hard: { name: 'Сложный', max: 15 } };
  const NB = Array.from({ length: CELLS }, (_, i) => { const r = Math.floor(i / N), c = i % N, o = []; if (r > 0) o.push(i - N); if (r < N - 1) o.push(i + N); if (c > 0) o.push(i - 1); if (c < N - 1) o.push(i + 1); return o; });
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е');

  // ═══ Словари: отсортированный массив + Set; префиксы — двоичным поиском ═══
  function unfront(s){
    const out = [];
    let prev = '', i = 0;
    while (i < s.length) {
      const k = s.charCodeAt(i++) - 48;
      let j = i;
      while (j < s.length && (s.charCodeAt(j) < 48 || s.charCodeAt(j) > 57)) j++;
      const w = prev.slice(0, k) + s.slice(i, j);
      out.push(w); prev = w; i = j;
    }
    return out;
  }
  function makeDict(sorted){
    const set = new Set(sorted);
    const hasPrefix = p => {
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < p) lo = m + 1; else hi = m; }
      return lo < sorted.length && sorted[lo].startsWith(p);
    };
    return { words: sorted, has: w => set.has(w), hasPrefix, size: sorted.length };
  }
  let DICT = null;
  // all — проверка слов игрока; common — понятные всем (ими ходит бот: заумные слова из словаря детям «нечестны»)
  function dicts(){
    if (DICT) return DICT;
    const all = unfront(root.NOUNS?.all || ''), skip = new Set((root.NOUNS?.skip || '').split(' ').filter(Boolean));
    const common = String(root.NOUNS_COMMON || '').split(' ').filter(w => w && !skip.has(w)).sort();
    const allSet = new Set(all);
    for (const w of common) if (!allSet.has(w)) { all.push(w); allSet.add(w); }
    all.sort();
    DICT = {
      all: makeDict(all),
      common: makeDict(common),
      easy: makeDict(common.filter(w => w.length <= LEVELS.easy.max)),
      starts: common.filter(w => w.length === N && !/[ъь]/.test(w[0])),
    };
    return DICT;
  }

  // ═══ Правила (чистые функции) ═══
  function newGame(word, first){
    const b = Array(CELLS).fill('');
    const w = norm(word);
    for (let i = 0; i < N; i++) b[2 * N + i] = w[i];
    return { b, start: w, used: [w], sc: [0, 0], words: [[], []], turn: first ? 1 : 0, moves: 0, passes: 0, over: false, last: null };
  }
  const filled = (G, i) => !!G.b[i];
  const canPlace = (G, i) => i >= 0 && i < CELLS && !G.b[i] && NB[i].some(j => G.b[j]);
  const placeable = G => { const o = []; for (let i = 0; i < CELLS; i++) if (canPlace(G, i)) o.push(i); return o; };
  // Проверка хода { cell, ch, path }. dict — словарь для проверки (null — не проверять слово). Вернёт { ok, word, err }
  function check(G, mv, dict){
    if (!mv || G.over) return { ok: false, err: 'Игра окончена' };
    const cell = mv.cell | 0, ch = norm(mv.ch), path = Array.isArray(mv.path) ? mv.path.map(x => x | 0) : [];
    if (!canPlace(G, cell)) return { ok: false, err: 'Букву ставят в пустую клетку рядом с буквами' };
    if (ch.length !== 1 || !ABC.includes(ch)) return { ok: false, err: 'Выбери букву' };
    if (path.length < 2) return { ok: false, err: 'Составь слово: веди по клеткам' };
    if (!path.includes(cell)) return { ok: false, err: 'Слово должно проходить через новую букву' };
    if (new Set(path).size !== path.length) return { ok: false, err: 'Каждая клетка — только один раз' };
    for (let k = 0; k < path.length; k++) {
      const i = path[k];
      if (i < 0 || i >= CELLS || (i !== cell && !G.b[i])) return { ok: false, err: 'Слово — только по буквам на поле' };
      if (k && !NB[path[k - 1]].includes(i)) return { ok: false, err: 'Буквы слова должны быть соседями (без диагоналей)' };
    }
    const word = path.map(i => (i === cell ? ch : G.b[i])).join('');
    if (G.used.includes(word)) return { ok: false, word, err: `Слово «${word.toUpperCase()}» уже было` };
    if (dict && !dict.has(word)) return { ok: false, word, err: `Слова «${word.toUpperCase()}» нет в словаре` };
    return { ok: true, word };
  }
  function apply(G, mv, word){
    const p = G.turn;
    G.b[mv.cell] = norm(mv.ch);
    G.used.push(word);
    G.sc[p] += word.length;
    G.words[p].push(word);
    G.moves++; G.passes = 0;
    G.last = { cell: mv.cell, path: mv.path.slice(), word, p };
    G.turn = 1 - p;
    if (!G.b.includes('')) G.over = true;
  }
  function pass(G){
    G.passes++; G.moves++;
    G.last = { pass: true, p: G.turn };
    G.turn = 1 - G.turn;
    if (G.passes >= MAX_PASSES || !placeable(G).length) G.over = true;
  }
  // Победитель: сдался / вышел — другой; иначе по очкам (-1 — ничья)
  const winner = G => (G.gaveUp != null ? 1 - G.gaveUp : G.sc[0] === G.sc[1] ? -1 : G.sc[0] > G.sc[1] ? 0 : 1);

  // ═══ Все возможные ходы (для бота и подсказок): каждая клетка-кандидат × путь по префиксам словаря ═══
  function allMoves(G, dict, maxLen = 15, limit = 4000){
    const out = [], seen = new Set(), used = new Set(G.used);
    for (const X of placeable(G)) {
      const path = [];
      const inPath = new Uint8Array(CELLS);
      const dfs = (cell, prefix, letter) => {
        if (out.length >= limit) return;
        const tries = cell === X ? (letter ? [letter] : ABC) : [G.b[cell]];
        for (const L of tries) {
          const p2 = prefix + L;
          if (p2.length > maxLen || !dict.hasPrefix(p2)) continue;
          const lx = cell === X ? L : letter;
          path.push(cell); inPath[cell] = 1;
          if (lx && p2.length >= 2 && dict.has(p2) && !used.has(p2)) {
            const key = X + ':' + lx + ':' + p2;
            if (!seen.has(key)) { seen.add(key); out.push({ cell: X, ch: lx, path: path.slice(), word: p2 }); }
          }
          for (const nb of NB[cell]) if (!inPath[nb] && (G.b[nb] || nb === X)) dfs(nb, p2, lx);
          path.pop(); inPath[cell] = 0;
        }
      };
      for (let s = 0; s < CELLS; s++) if (G.b[s] || s === X) dfs(s, '', '');
    }
    return out;
  }
  // Бот ходит только понятными словами (nouns-common.js): лёгкий — короткими (до 4 букв, случайно), средний — среди 3 самых
  // длинных, сложный — самое длинное, а из 6 лучших — то, после которого у соперника лучший ответ короче
  function botMove(G, level, rand = Math.random){
    const D = dicts();
    if (level === 'easy') {
      const ms = allMoves(G, D.easy, LEVELS.easy.max);
      if (!ms.length) return null;
      const short = ms.filter(m => m.word.length <= 4);
      const pool = short.length ? short : ms;
      return pool[Math.floor(rand() * pool.length)];
    }
    if (level === 'normal') {
      const ms = allMoves(G, D.common, LEVELS.normal.max);
      if (!ms.length) return null;
      ms.sort((a, b) => b.word.length - a.word.length);
      const top = ms.slice(0, 3);
      return top[Math.floor(rand() * top.length)];
    }
    const ms = allMoves(G, D.common, LEVELS.hard.max);
    if (!ms.length) return null;
    ms.sort((a, b) => b.word.length - a.word.length);
    const top = ms.slice(0, 6);
    let best = top[0], bestV = -1e9;
    for (const m of top) {
      const T = JSON.parse(JSON.stringify(G));
      apply(T, m, m.word);
      const reply = T.over ? [] : allMoves(T, D.common, LEVELS.hard.max, 2000);
      const opp = reply.reduce((a, r) => Math.max(a, r.word.length), 0);
      const v = m.word.length * 1.2 - opp * .7 + rand() * .3;
      if (v > bestV) { bestV = v; best = m; }
    }
    return best;
  }

  // ═══════════════════ ЭКРАН ═══════════════════
  let rootEl = null, api = null, G = null, mode = 'menu', timers = [], keyOn = false;
  let opts = { level: 'normal', first: 0 };
  try { Object.assign(opts, JSON.parse(localStorage.getItem('d37_balda_opts') || '{}')); } catch (e) {}
  // vs: 'bot' | 'duo' | 'online'; me — мой номер (0/1); names
  let vs = 'bot', me = 0, names = ['Ты', 'Бот'], hist = [], hints = HINTS, room = null, O = null, deadline = 0, reported = false, hintMv = null;
  // Ход в процессе: клетка, буква, путь
  let pick = { cell: -1, ch: '', path: [] }, drag = null, err = '', busy = false;
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const esc0 = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const E = s => (typeof esc === 'function' ? esc(s) : esc0(s));
  const ru = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many);
  const saveOpts = () => { try { localStorage.setItem('d37_balda_opts', JSON.stringify(opts)); } catch (e) {} };
  const myTurn = () => G && !G.over && (vs === 'duo' || G.turn === me) && !busy;

  function menu(){
    leave();
    mode = 'menu';
    const st = api.local();
    rootEl.innerHTML = `<div class="bd bd-menu">
      <div class="bd-logo">${'БАЛДА'.split('').map(c => `<i>${c}</i>`).join('')}</div>
      <div class="bd-sub">Добавляй по одной букве и составляй слова по соседним клеткам. Чем длиннее слово, тем больше очков!</div>
      <div class="ct-row bd-row"><span>Бот</span><span class="ct-opts">${Object.entries(LEVELS).map(([k, v]) => `<button type="button" class="ct-opt${opts.level === k ? ' active' : ''}" data-act="lv:${k}">${v.name}</button>`).join('')}</span></div>
      <div class="ct-row bd-row"><span>Первым ходит</span><span class="ct-opts"><button type="button" class="ct-opt${!opts.first ? ' active' : ''}" data-act="first:0">Я</button><button type="button" class="ct-opt${opts.first ? ' active' : ''}" data-act="first:1">Бот</button></span></div>
      <div class="ct-actions"><button type="button" class="ct-start" data-act="bot">🤖 Играть с ботом</button><button type="button" class="ct-duel-btn" data-act="duo">👥 Вдвоём на экране</button><button type="button" class="ct-duel-btn" data-act="online">🌐 Онлайн с другом</button></div>
      ${st.plays ? `<div class="bd-sub">Партий: <b>${st.plays}</b> · побед: <b>${st.wins || 0}</b>${st.best ? ` · лучший счёт: <b>${st.best}</b>` : ''}</div>` : ''}
      <details class="un-rules"><summary>Правила</summary>
        <p>В середине поля 5×5 — слово из 5 букв. Игроки ходят по очереди.</p>
        <p>Ход: поставь одну букву в пустую клетку <b>рядом</b> с буквами и составь слово, проводя по соседним клеткам — вверх, вниз, влево, вправо (без диагоналей). Каждая клетка — один раз, и слово обязательно проходит через новую букву.</p>
        <p>Слова — существительные в начальной форме: «кот», «дом», «ножницы» (не «коты», не «красный»). Каждое слово — один раз за игру.</p>
        <p>Очки — по числу букв слова. Не нашёл слово — «Пропустить ход». Поле заполнилось или 4 пропуска подряд — у кого больше очков, тот победил.</p>
        <p>Как ходить: нажми клетку → выбери букву → нажимай буквы слова по порядку (или веди пальцем) → «✓ Готово». «⌫» — убрать последнюю букву слова, «✕» — отменить ход.</p>
      </details>
    </div>`;
  }

  function startBot(){
    leave();
    const D = dicts();
    vs = 'bot'; me = opts.first ? 1 : 0;
    names = me === 0 ? ['Ты', '🤖 ' + LEVELS[opts.level].name] : ['🤖 ' + LEVELS[opts.level].name, 'Ты'];
    G = newGame(D.starts[Math.floor(Math.random() * D.starts.length)], 0);
    hist = []; hints = HINTS; reported = false; hintMv = null; mode = 'play';
    resetPick(); build(); render();
    if (G.turn !== me) later(botTurn, 700);
  }
  function startDuo(){
    leave();
    const D = dicts();
    vs = 'duo'; me = 0; names = ['Игрок 1', 'Игрок 2'];
    G = newGame(D.starts[Math.floor(Math.random() * D.starts.length)], 0);
    hist = []; reported = false; hintMv = null; mode = 'play';
    resetPick(); build(); render();
  }
  function resetPick(){ pick = { cell: -1, ch: '', path: [] }; err = ''; drag = null; }
  function botTurn(){
    if (!G || G.over || vs !== 'bot' || G.turn === me) return;
    busy = true; render();
    later(() => {
      if (!G || G.over || vs !== 'bot') return;
      const m = botMove(G, opts.level);
      busy = false;
      if (m) { apply(G, m, m.word); api.sfx('move'); flashPath(m.path); }
      else { pass(G); api.toast('🤖 Бот пропускает ход'); }
      hintMv = null;
      render();
      if (G.over) finish();
    }, 350);
  }

  // ── Ввод хода ──
  function cellTap(i){
    if (!myTurn()) return;
    err = '';
    if (pick.ch && pick.cell >= 0) {
      // слово: клетки по порядку
      if (i !== pick.cell && !G.b[i]) { if (canPlace(G, i)) { pick.cell = i; pick.path = []; api.sfx('tick'); } render(); return; }
      const k = pick.path.indexOf(i);
      if (k === pick.path.length - 1) pick.path.pop();
      else if (k >= 0) pick.path = pick.path.slice(0, k + 1);
      else if (!pick.path.length || NB[pick.path[pick.path.length - 1]].includes(i)) pick.path.push(i);
      else { pick.path = [i]; }
      api.sfx('tick');
      render();
      return;
    }
    if (canPlace(G, i)) { pick = { cell: i, ch: pick.ch, path: [] }; api.sfx('tick'); render(); return; }
    if (G.b[i]) { err = 'Сначала выбери пустую клетку рядом с буквами'; render(); }
  }
  function letter(ch){
    if (!myTurn() || pick.cell < 0) return;
    pick.ch = ch;
    if (!pick.path.length) pick.path = [];
    err = '';
    api.sfx('tick');
    render();
  }
  function backspace(){
    if (!myTurn()) return;
    if (pick.path.length) pick.path.pop();
    else if (pick.ch) pick.ch = '';
    else pick.cell = -1;
    err = ''; render();
  }
  function cancel(){ if (!myTurn()) return; resetPick(); render(); }
  function submit(){
    if (!myTurn() || pick.cell < 0) return;
    const r = check(G, pick, dicts().all);
    if (!r.ok) { err = r.err; api.sfx('bad'); render(); shake(); return; }
    const mv = { cell: pick.cell, ch: pick.ch, path: pick.path.slice() };
    if (vs === 'bot') hist.push(JSON.stringify({ G, hints }));
    apply(G, mv, r.word);
    if (vs === 'online') sendMove(mv);
    api.sfx('ok');
    flashPath(mv.path);
    resetPick(); hintMv = null;
    render();
    if (G.over) { finish(); return; }
    if (vs === 'bot') later(botTurn, 450);
    if (vs === 'online') startClock();
  }
  function doPass(){
    if (!myTurn()) return;
    if (vs === 'bot') hist.push(JSON.stringify({ G, hints }));
    pass(G);
    if (vs === 'online') { O.n = G.moves; room?.send({ type: 'pass', n: G.moves }); }
    resetPick(); hintMv = null;
    render();
    if (G.over) { finish(); return; }
    if (vs === 'bot') later(botTurn, 450);
    if (vs === 'online') startClock();
  }
  function undo(){
    if (vs !== 'bot' || !hist.length || busy || !G || G.over) return;
    timers.forEach(clearTimeout); timers = [];
    const h = JSON.parse(hist.pop());
    G = h.G; hints = h.hints; busy = false; hintMv = null;
    resetPick(); build(); render();
    if (G.turn !== me && !G.over) later(botTurn, 500);
  }
  function hint(){
    if (vs !== 'bot' || !myTurn()) return;
    if (hints <= 0) { api.toast('Подсказки кончились — их 3 на партию'); return; }
    const ms = allMoves(G, dicts().common, 9);
    if (!ms.length) { api.toast('Понятных слов не видно — попробуй сам или пропусти ход'); return; }
    ms.sort((a, b) => b.word.length - a.word.length);
    const pickM = ms[Math.min(ms.length - 1, Math.floor(Math.random() * Math.min(3, ms.length)))];
    hints--; hintMv = pickM;
    pick = { cell: pickM.cell, ch: '', path: [] };
    err = '';
    api.toast(`💡 Сюда можно поставить букву: выйдет слово из ${pickM.word.length} ${ru(pickM.word.length, 'буквы', 'букв', 'букв')}, на «${pickM.word[0].toUpperCase()}»`);
    render();
  }

  // ── Поле и разметка ──
  function build(){
    rootEl.innerHTML = `<div class="bd bd-game">
      <div class="bd-head">
        <div class="bd-pl" data-p="0"><b></b><span class="bd-sc">0</span></div>
        <div class="bd-mid"><span class="bd-turn"></span><span class="bd-clock"></span></div>
        <div class="bd-pl" data-p="1"><b></b><span class="bd-sc">0</span></div>
      </div>
      <div class="bd-body">
        <div class="bd-left">
          <div class="bd-grid" role="grid" aria-label="Поле 5 на 5">${Array.from({ length: CELLS }, (_, i) => `<button type="button" class="bd-c" data-i="${i}" aria-label="Клетка ${Math.floor(i / N) + 1}-${i % N + 1}"></button>`).join('')}</div>
          <div class="bd-word" aria-live="polite"></div>
          <div class="bd-err" aria-live="assertive"></div>
          <div class="bd-ctl">
            <button type="button" class="bd-b" data-act="back" title="Убрать последнюю букву слова (Backspace)">⌫</button>
            <button type="button" class="bd-b bad" data-act="cancel" title="Отменить ход (Esc)">✕ Отмена</button>
            <button type="button" class="bd-b ok" data-act="submit" title="Готово (Enter)">✓ Готово</button>
          </div>
          <div class="bd-kb" hidden>${KB.map(r => `<div>${[...r].map(k => `<button type="button" data-k="${k}">${k}</button>`).join('')}</div>`).join('')}</div>
        </div>
        <div class="bd-right">
          <div class="bd-lists"><div class="bd-list" data-p="0"><b></b><ol></ol></div><div class="bd-list" data-p="1"><b></b><ol></ol></div></div>
          <div class="bd-acts"></div>
        </div>
      </div>
    </div>`;
    const grid = rootEl.querySelector('.bd-grid');
    grid.addEventListener('pointerdown', onDown);
    grid.addEventListener('pointermove', onMove);
    grid.addEventListener('pointerup', onUp);
    grid.addEventListener('pointercancel', () => { drag = null; });
    rootEl.querySelector('.bd-kb').addEventListener('pointerdown', e => { const b = e.target.closest('[data-k]'); if (!b) return; e.preventDefault(); letter(b.dataset.k); });
  }
  // Касание: нажал — клетка; повёл по буквам с нажатой кнопкой — слово (как в филворде)
  function cellAt(e, strict){
    const g = rootEl.querySelector('.bd-grid').getBoundingClientRect();
    const c = Math.floor((e.clientX - g.left) / g.width * N), r = Math.floor((e.clientY - g.top) / g.height * N);
    if (c < 0 || r < 0 || c >= N || r >= N) return -1;
    // ведём пальцем — считаем только середину клетки, иначе по диагонали легко задеть соседа
    const cx = (c + .5) * g.width / N + g.left, cy = (r + .5) * g.height / N + g.top;
    if (strict && (Math.abs(e.clientX - cx) > g.width / N * .38 || Math.abs(e.clientY - cy) > g.height / N * .38)) return -2;
    return r * N + c;
  }
  function onDown(e){
    const i = cellAt(e);
    if (i < 0) return;
    if (pick.ch && pick.cell >= 0 && myTurn() && (G.b[i] || i === pick.cell)) {
      e.preventDefault();
      try { e.target.releasePointerCapture?.(e.pointerId); } catch (er) {}
      drag = { id: e.pointerId, moved: false, start: i, was: pick.path.slice() };
      // начать слово заново с этой клетки, если она не продолжает текущее
      const lastI = pick.path[pick.path.length - 1];
      if (!pick.path.length || (i !== lastI && !pick.path.includes(i) && !NB[lastI].includes(i))) pick.path = [i];
      else if (!pick.path.includes(i)) pick.path.push(i);
      else drag.tapOn = i;
      render();
      return;
    }
    cellTap(i);
  }
  function onMove(e){
    if (!drag || e.pointerId !== drag.id) return;
    const i = cellAt(e, true);
    if (i < 0) return;
    const last = pick.path[pick.path.length - 1];
    if (i === last) return;
    drag.moved = true;
    const k = pick.path.indexOf(i);
    if (k >= 0) { pick.path = pick.path.slice(0, k + 1); render(); return; }
    if (NB[last]?.includes(i) && (G.b[i] || i === pick.cell)) { pick.path.push(i); api.sfx('tick'); render(); }
  }
  function onUp(e){
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    if (!d.moved && d.tapOn != null) { // нажатие на букву, уже бывшую в слове: последняя — убрать, другая — укоротить
      pick.path = d.was;
      const k = pick.path.indexOf(d.tapOn);
      if (k === pick.path.length - 1) pick.path.pop(); else if (k >= 0) pick.path = pick.path.slice(0, k + 1);
      render();
    }
  }
  function flashPath(path){
    const cells = rootEl?.querySelectorAll('.bd-c');
    if (!cells) return;
    path.forEach((i, k) => later(() => { cells[i]?.classList.add('flash'); later(() => cells[i]?.classList.remove('flash'), 500); }, k * 70));
  }
  function shake(){ const w = rootEl?.querySelector('.bd-word'); if (!w) return; w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake'); }

  function render(){
    if (!G || !rootEl?.querySelector('.bd-grid')) return;
    const cells = rootEl.querySelectorAll('.bd-c'), mine = myTurn(), path = pick.path, place = mine ? new Set(placeable(G)) : new Set();
    for (let i = 0; i < CELLS; i++) {
      const e = cells[i], tentative = i === pick.cell, ch = tentative && pick.ch ? pick.ch : G.b[i];
      const k = path.indexOf(i);
      let cls = 'bd-c' + (ch ? ' f' : '') + (tentative ? ' sel' : '') + (k >= 0 ? ' p' : '') + (!ch && place.has(i) && pick.cell < 0 ? ' can' : '');
      if (hintMv && hintMv.cell === i && pick.cell === i && !pick.ch) cls += ' hint';
      if (G.last && !G.last.pass && G.last.cell === i && !tentative) cls += ' last';
      if (e.className !== cls) e.className = cls;
      const html = (ch ? ch.toUpperCase() : '') + (k >= 0 ? `<i>${k + 1}</i>` : '');
      if (e.innerHTML !== html) e.innerHTML = html;
    }
    // шапка
    rootEl.querySelectorAll('.bd-pl').forEach(el => {
      const p = +el.dataset.p;
      el.querySelector('b').textContent = names[p] + (vs !== 'duo' && p === me ? '' : '');
      el.querySelector('.bd-sc').textContent = G.sc[p];
      el.classList.toggle('turn', !G.over && G.turn === p);
    });
    const t = rootEl.querySelector('.bd-turn');
    t.textContent = G.over ? (winner(G) < 0 ? '🤝 Ничья' : vs === 'duo' ? `🏆 Победил ${names[winner(G)]}` : winner(G) === me ? '🏆 Победа!' : '😔 Поражение')
      : busy ? '🤖 думает…' : mine ? (vs === 'duo' ? `Ходит ${names[G.turn]}` : 'Твой ход') : `Ходит ${names[G.turn]}…`;
    // слово
    const wordEl = rootEl.querySelector('.bd-word');
    const cur = path.map(i => (i === pick.cell ? pick.ch : G.b[i])).join('');
    wordEl.innerHTML = !mine ? (G.last && !G.last.pass ? `<span class="bd-hint">${E(names[G.last.p])}: <b>${E(G.last.word.toUpperCase())}</b> +${G.last.word.length}</span>` : G.last?.pass ? `<span class="bd-hint">${E(names[G.last.p])} пропускает ход</span>` : '')
      : pick.cell < 0 ? '<span class="bd-hint">1. Нажми пустую клетку рядом с буквами</span>'
      : !pick.ch ? '<span class="bd-hint">2. Выбери букву</span>'
      : path.length ? `<b class="bd-cur">${E(cur.toUpperCase())}</b> <small>${cur.length} ${ru(cur.length, 'буква', 'буквы', 'букв')}</small>`
      : '<span class="bd-hint">3. Составь слово: нажимай буквы по порядку или веди пальцем</span>';
    rootEl.querySelector('.bd-err').textContent = err;
    rootEl.querySelector('.bd-ctl').hidden = !mine || pick.cell < 0;
    rootEl.querySelector('[data-act="submit"]').disabled = !(pick.ch && path.length >= 2);
    rootEl.querySelector('.bd-kb').hidden = !(mine && pick.cell >= 0);
    rootEl.querySelectorAll('.bd-kb [data-k]').forEach(b => b.classList.toggle('on', b.dataset.k === pick.ch));
    // списки слов
    rootEl.querySelectorAll('.bd-list').forEach(el => {
      const p = +el.dataset.p;
      el.querySelector('b').textContent = `${names[p]} · ${G.sc[p]}`;
      const ol = el.querySelector('ol'), html = G.words[p].map(w => `<li>${E(w)} <small>${w.length}</small></li>`).join('');
      if (ol.innerHTML !== html) { ol.innerHTML = html; ol.scrollTop = ol.scrollHeight; }
    });
    // действия
    const acts = rootEl.querySelector('.bd-acts');
    acts.innerHTML = G.over ? `${vs === 'online' ? `<button type="button" class="ct-start" data-act="rematch">↻ Реванш</button>` : `<button type="button" class="ct-start" data-act="again">↻ Ещё партия</button>`}
        <button type="button" class="bd-b" data-act="leave">${vs === 'online' ? '🚪 Выйти' : '🏠 Меню'}</button>`
      : `${mine ? '<button type="button" class="bd-b" data-act="pass">⏭ Пропустить ход</button>' : ''}
        ${vs === 'bot' ? `<button type="button" class="bd-b" data-act="hint"${hints ? '' : ' disabled'}>💡 Подсказка <small>${hints}</small></button>` : ''}
        ${vs === 'bot' && hist.length ? `<button type="button" class="bd-b" data-act="undo"${busy ? ' disabled' : ''}>↶ Отменить ход</button>` : ''}
        <button type="button" class="bd-b" data-act="resign">🏳️ Сдаться</button>`;
    acts.insertAdjacentHTML('beforeend', `<div class="bd-note">Начальное слово: <b>${E(G.start.toUpperCase())}</b> · свободно клеток: ${G.b.filter(x => !x).length}${G.passes ? ` · пропусков подряд: ${G.passes}/${MAX_PASSES}` : ''}</div>`);
    renderClock();
  }
  function renderClock(){
    const c = rootEl?.querySelector('.bd-clock');
    if (!c) return;
    if (vs !== 'online' || !G || G.over || !deadline) { c.textContent = ''; return; }
    const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    c.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    c.classList.toggle('low', s <= 20);
  }

  function finish(){
    if (mode === 'over') { render(); return; }
    mode = 'over';
    clearInterval(O?.clockT);
    const w = winner(G), win = vs === 'duo' ? false : w === me;
    api.sfx(w < 0 ? 'ok' : vs === 'duo' || win ? 'win' : 'bad');
    render();
    if (reported || vs === 'duo') return;
    reported = true;
    if (vs === 'bot') api.report('balda_' + opts.level, win, G.sc[me], G.sc[me]);
    else if (G.moves >= 6) api.report('balda_online', win, G.sc[me], G.sc[me]);
  }
  function resign(){
    if (!G || G.over) return;
    if (vs === 'online') room?.send({ type: 'resign', n: G.moves });
    G.over = true; G.gaveUp = vs === 'duo' ? G.turn : me;
    finish();
  }

  // ═══ Онлайн: room.js, двое; хозяин шлёт старт (слово и кто первый) ═══
  function online(code){
    leave();
    vs = 'online'; mode = 'lobby';
    O = { round: 0, started: false, rematch: { me: false, opp: false }, n: 0 };
    root.GameRoom.lobby(rootEl, 'balda', code);
    room = root.GameRoom.join('balda', code, {
      onError: () => { if (rootEl) rootEl.innerHTML = root.GameRoom.errorHtml; },
      onFull: () => { if (rootEl) rootEl.innerHTML = root.GameRoom.fullHtml('balda'); },
      onPeer: (opp, R) => {
        if (!rootEl) return;
        if (!opp) {
          if (G && !G.over && O.started) { api.toast('Соперник вышел'); G.over = true; G.gaveUp = 1 - me; finish(); }
          else if (!O.started) root.GameRoom.lobbyText(rootEl, 'Ты в комнате. <b>Ждём друга…</b>');
          return;
        }
        const newcomer = O.oppId && O.oppId !== opp.id;
        O.oppId = opp.id; O.oppNick = opp.nick;
        if (!O.started || newcomer) { if (R.isHost) hostStart(); else if (!O.started) { root.GameRoom.lobbyText(rootEl, `<b>${E(opp.nick)}</b> на месте — начинаем…`); askStart(0); } }
      },
      onMessage: m => {
        if (!m || typeof m.type !== 'string') return;
        if (m.type === 'start' && !room.isHost) { if (O.started && m.round === O.round) return; begin(m); return; }
        if (m.type === 'want') { if (room.isHost && O.last) room.send(O.last); return; }
        if (!G || !O.started) return;
        if (m.type === 'mv') {
          if (G.over || G.turn === me || m.n !== G.moves + 1) return;
          const mv = { cell: m.cell | 0, ch: String(m.ch || ''), path: Array.isArray(m.path) ? m.path.slice(0, CELLS) : [] };
          let r = check(G, mv, dicts().all);
          if (!r.ok && r.word && /нет в словаре/.test(r.err)) r = check(G, mv, null);   // другой версии словарь у соперника — ход не ломаем
          if (!r.ok) return;
          apply(G, mv, r.word);
          api.sfx('move'); flashPath(mv.path);
          render();
          if (G.over) finish(); else startClock();
        } else if (m.type === 'pass') {
          if (G.over || G.turn === me || m.n !== G.moves + 1) return;
          pass(G); render(); if (G.over) finish(); else startClock();
        } else if (m.type === 'resign') {
          if (G.over) return;
          G.over = true; G.gaveUp = 1 - me; api.toast(`${O.oppNick || 'Соперник'} сдался`); finish();
        } else if (m.type === 'rematch') {
          O.rematch.opp = true;
          if (room.isHost && O.rematch.me) hostStart();
          else if (G.over) api.toast(`${O.oppNick || 'Соперник'} хочет реванш — жми «↻ Реванш»!`);
        }
      },
    });
    if (!room) rootEl.innerHTML = root.GameRoom.errorHtml;
  }
  function askStart(k){ later(() => { if (!O?.started && room && !room.closed && !room.isHost && room.opp && k < 3) { room.send({ type: 'want' }); askStart(k + 1); } }, 2500); }
  function hostStart(){
    const D = dicts();
    O.round++;
    const first = O.round % 2 === 1 ? room.opp.id : room.myId;   // первую партию начинает гость
    const msg = { type: 'start', round: O.round, word: D.starts[Math.floor(Math.random() * D.starts.length)], first, hostNick: room.nick };
    O.last = msg;
    room.send(msg);
    begin(msg);
  }
  function begin(m){
    if (typeof m.word !== 'string' || m.word.length !== N) return;
    O.started = true; O.round = m.round; O.rematch = { me: false, opp: false };
    if (m.hostNick && !room.isHost) O.oppNick = m.hostNick;
    // игрок 0 — тот, кто ходит первым
    me = m.first === room.myId ? 0 : 1;
    names = me === 0 ? ['Ты', O.oppNick || 'Соперник'] : [O.oppNick || 'Соперник', 'Ты'];
    G = newGame(m.word, 0); hist = []; reported = false; mode = 'play'; hintMv = null;
    resetPick(); build(); render();
    startClock();
  }
  function startClock(){
    if (vs !== 'online' || !G || G.over) return;
    deadline = Date.now() + MOVE_SEC * 1000;
    clearInterval(O.clockT);
    O.clockT = setInterval(() => {
      if (!G || G.over || vs !== 'online') { clearInterval(O.clockT); return; }
      renderClock();
      if (Date.now() >= deadline && G.turn === me) { clearInterval(O.clockT); api.toast('⏱ Время вышло — ход пропущен'); doPassForce(); }
    }, 500);
  }
  function doPassForce(){ busy = false; resetPick(); pass(G); room?.send({ type: 'pass', n: G.moves }); render(); if (G.over) finish(); else startClock(); }
  function sendMove(mv){ room?.send({ type: 'mv', n: G.moves, cell: mv.cell, ch: mv.ch, path: mv.path }); }
  function rematch(){
    O.rematch.me = true;
    room?.send({ type: 'rematch' });
    if (room?.isHost && O.rematch.opp) hostStart();
    else api.toast(`Ждём ${O.oppNick || 'соперника'}…`);
  }

  function leave(){
    timers.forEach(clearTimeout); timers = [];
    if (O) clearInterval(O.clockT);
    room?.leave(); room = null; O = null; deadline = 0;
    G = null; busy = false; drag = null;
  }
  function onClick(e){
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !rootEl?.contains(b)) return;
    const a = b.dataset.act;
    if (a.startsWith('lv:')) { opts.level = a.slice(3); saveOpts(); menu(); return; }
    if (a.startsWith('first:')) { opts.first = +a.slice(6); saveOpts(); menu(); return; }
    if (a === 'bot') { startBot(); return; }
    if (a === 'duo') { startDuo(); return; }
    if (a === 'online') { location.hash = '#/games/balda/' + root.GameRoom.newCode(); return; }
    if (a === 'again') { if (vs === 'duo') startDuo(); else startBot(); return; }
    if (a === 'leave') { if (vs === 'online') location.hash = '#/games/balda'; else menu(); return; }
    if (a === 'rematch') { rematch(); return; }
    if (a === 'submit') { submit(); return; }
    if (a === 'back') { backspace(); return; }
    if (a === 'cancel') { cancel(); return; }
    if (a === 'pass') { doPass(); return; }
    if (a === 'hint') { hint(); return; }
    if (a === 'undo') { undo(); return; }
    if (a === 'resign') { if (confirmResign(b)) resign(); }
  }
  // «Сдаться» — второе нажатие в течение 3 с (без системного окна)
  function confirmResign(b){
    if (b.dataset.sure === '1') return true;
    b.dataset.sure = '1'; b.textContent = '🏳️ Точно сдаться?';
    later(() => { if (b.isConnected) { b.dataset.sure = ''; b.textContent = '🏳️ Сдаться'; } }, 3000);
    return false;
  }
  function onKey(e){
    if (!G || mode !== 'play' || !rootEl?.isConnected || e.target?.closest?.('input,textarea,[contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'Enter') { e.preventDefault(); submit(); return; }
    if (k === 'Backspace') { e.preventDefault(); backspace(); return; }
    if (k === 'Escape') { if (pick.cell >= 0) { e.preventDefault(); e.stopPropagation(); cancel(); } return; }
    let ch = norm(k);
    if (!ABC.includes(ch) || ch.length !== 1) ch = CODE[e.code] || '';
    if (ch && pick.cell >= 0) { e.preventDefault(); letter(ch); }
  }

  // ═══ CSS ═══
  const CSS = `
.bd{--bd-t:#fbf3db;--bd-ink:#2a1e10}
.bd-menu{display:flex;flex-direction:column;align-items:center;gap:.8rem;text-align:center;padding:.6rem 0 1rem}
.bd-logo{display:flex;gap:6px}
.bd-logo i{font-style:normal;width:52px;height:52px;border-radius:12px;background:var(--bd-t);color:var(--bd-ink);display:flex;align-items:center;justify-content:center;font:900 1.7rem var(--font-display);box-shadow:0 4px 0 #c9b98f}
.bd-logo i:nth-child(2n){background:#86efac}
.bd-sub{font-size:.84rem;color:var(--muted);max-width:460px;line-height:1.5}
.bd-row{width:min(100%,420px)}
.bd-head{display:flex;align-items:stretch;gap:.5rem;margin-bottom:.6rem}
.bd-pl{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:.1rem;padding:.45rem .5rem;border-radius:14px;background:rgba(255,255,255,.05);border:2px solid transparent}
.bd-pl.turn{border-color:#facc15;box-shadow:0 0 14px rgba(250,204,21,.25)}
.bd-pl b{font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.bd-sc{font:900 1.5rem var(--font-display);color:#ffd166;line-height:1}
.bd-mid{flex:1.2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.15rem;text-align:center}
.bd-turn{font-weight:800;font-size:.86rem}
.bd-clock{font-weight:800;font-size:.8rem;font-variant-numeric:tabular-nums;color:var(--muted)}
.bd-clock.low{color:#f87171}
.bd-body{display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:.8rem;align-items:start}
.bd-left{display:flex;flex-direction:column;align-items:center;gap:.45rem;min-width:0}
.bd-grid{display:grid;grid-template-columns:repeat(5,1fr);grid-template-rows:repeat(5,1fr);gap:6px;width:min(100%,430px,calc(100vh - 330px));min-width:min(100%,250px);aspect-ratio:1;padding:8px;border-radius:16px;background:#3a2b18;touch-action:none;user-select:none;-webkit-user-select:none}
.bd-c{position:relative;min-width:0;min-height:0;border:0;border-radius:10px;background:#5a4528;color:var(--bd-ink);font:900 clamp(1.2rem,6.2vw,2.1rem) var(--font-display);display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;transition:transform .12s,background .15s;touch-action:none}
.bd-c.f{background:var(--bd-t);box-shadow:0 3px 0 #c9b98f}
.bd-c.can{background:#6e5531;outline:2px dashed rgba(250,204,21,.45);outline-offset:-5px}
.bd-c.can:hover{background:#7d6239}
.bd-c.sel{background:#fde68a;box-shadow:0 0 0 3px #facc15}
.bd-c.sel:not(.f){background:#8a6d3f}
.bd-c.p{background:#86efac;box-shadow:0 3px 0 #22a05a}
.bd-c.sel.p{background:#fcd34d}
.bd-c.last{box-shadow:0 0 0 3px #60a5fa,0 3px 0 #c9b98f}
.bd-c.hint{animation:bdHint .7s ease-in-out infinite alternate}
.bd-c.flash{transform:scale(1.08);background:#bbf7d0}
.bd-c i{position:absolute;top:2px;right:5px;font:800 .62rem 'Montserrat',sans-serif;color:#166534}
@keyframes bdHint{to{box-shadow:0 0 0 4px #facc15;background:#a5823f}}
.bd-word{min-height:2.1rem;display:flex;align-items:center;justify-content:center;gap:.4rem;text-align:center}
.bd-word.shake{animation:slShake .3s}
.bd-cur{font:900 1.5rem var(--font-display);letter-spacing:2px;color:#4ade80}
.bd-word small{color:var(--muted);font-size:.72rem}
.bd-hint{font-size:.8rem;color:var(--muted)}
.bd-hint b{color:#ffd166}
.bd-err{min-height:1.1rem;font-size:.78rem;color:#f87171;text-align:center;font-weight:700}
.bd-ctl{display:flex;gap:.4rem;justify-content:center}
.bd-ctl[hidden],.bd-kb[hidden]{display:none}
.bd-b{border:1px solid var(--border);background:rgba(255,255,255,.06);color:var(--text);border-radius:11px;padding:.55rem .85rem;font:800 .8rem 'Montserrat',sans-serif;cursor:pointer;touch-action:manipulation;min-height:42px}
.bd-b:disabled{opacity:.45;cursor:default}
.bd-b.ok{border:0;color:#fff;background:linear-gradient(135deg,#16a34a,#22c55e)}
.bd-b.bad{border-color:rgba(248,113,113,.5)}
.bd-b small{opacity:.7}
.bd-kb{display:flex;flex-direction:column;gap:4px;width:100%;max-width:520px}
.bd-kb div{display:flex;gap:4px;justify-content:center}
.bd-kb button{flex:1;max-width:44px;min-width:0;height:44px;border-radius:8px;border:0;background:rgba(255,255,255,.12);color:var(--text);font:800 .95rem 'Montserrat',sans-serif;cursor:pointer;padding:0;touch-action:manipulation;text-transform:uppercase}
.bd-kb button.on{background:#facc15;color:#1a1020}
.bd-right{display:flex;flex-direction:column;gap:.6rem;min-width:0}
.bd-lists{display:grid;grid-template-columns:1fr 1fr;gap:.4rem}
.bd-list{background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:12px;padding:.4rem .5rem;min-width:0}
.bd-list b{display:block;font-size:.72rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:.2rem}
.bd-list ol{margin:0;padding-left:1.2rem;font-size:.78rem;line-height:1.5;max-height:250px;overflow-y:auto}
.bd-list li small{color:#ffd166;font-weight:800}
.bd-acts{display:flex;flex-direction:column;gap:.4rem}
.bd-acts .ct-start{align-self:stretch}
.bd-note{font-size:.7rem;color:var(--muted);text-align:center}
@media(max-width:760px){
  .bd-body{grid-template-columns:1fr}
  .bd-acts{flex-direction:row;flex-wrap:wrap;justify-content:center}
  .bd-list ol{max-height:120px}
  .bd-grid{width:min(100%,430px)}
}
@media(max-width:420px){.bd-kb button{height:40px;font-size:.85rem}.bd-b{padding:.5rem .65rem;font-size:.74rem}}
@media(orientation:landscape) and (max-height:560px){
  .bd-body{grid-template-columns:auto minmax(0,1fr)}
  .bd-grid{width:calc(100vh - 150px);min-width:200px}
  .bd-left{flex-direction:column}
}
body:not(.high) .bd-c{transition:none}
`;
  function css(){ if (document.getElementById('bdCss')) return; const s = document.createElement('style'); s.id = 'bdCss'; s.textContent = CSS; document.head.appendChild(s); }

  root.GAME_IMPL = root.GAME_IMPL || {};
  root.GAME_IMPL.balda = {
    mount(el, gameApi){
      rootEl = el; api = gameApi;
      css();
      rootEl.addEventListener('click', onClick);
      if (!keyOn) { root.addEventListener('keydown', onKey); keyOn = true; }
      if (root.GameRoom?.validCode(gameApi.param)) online(gameApi.param); else menu();
    },
    unmount(){
      leave();
      rootEl?.removeEventListener('click', onClick);
      if (keyOn) { root.removeEventListener('keydown', onKey); keyOn = false; }
      rootEl = null; mode = 'menu';
    },
    get _G(){ return G; },
    _test: { N, ABC, NB, LEVELS, unfront, makeDict, dicts, newGame, canPlace, placeable, check, apply, pass, winner, allMoves, botMove, norm },
  };
})();
