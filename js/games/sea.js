// ═══════════════════════════════════════
//  ИГРА «МОРСКОЙ БОЙ» — против бота (3 уровня) или онлайн с другом по ссылке
// ═══════════════════════════════════════
// Классика: поле 10×10, флот 4+3+3+2+2+2+1+1+1+1, корабли не касаются даже углами.
// Попал — стреляешь ещё раз; клетки вокруг потопленного корабля отмечаются сами.
// Бот: «Лёгкий» — наугад, «Средний» — добивает раненого, «Сложный» — ещё и считает,
// где корабли вероятнее всего (плотность возможных расстановок).
// Онлайн — js/games/room.js: #/games/sea/<код>. Каждый хранит свой флот у себя и честно
// отвечает на выстрелы соперника (hit/miss/sunk). Первым стреляет гость, дальше по очереди.
(() => {
  const N = 10, LENS = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1], TOTAL = 20;
  const LEVELS = { easy: 'Лёгкий', normal: 'Средний', hard: 'Сложный' };
  const LETTERS = 'АБВГДЕЖЗИК';
  let root, api, G = null, R = null, timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); };
  const inside = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
  const grid = v => Array.from({ length: N }, () => Array(N).fill(v));

  // ── Флот ──
  function makeFleet(rand = Math.random){
    for (let attempt = 0; attempt < 200; attempt++) {
      const cells = grid(-1), ships = [];
      let ok = true;
      for (const len of LENS) {
        let placed = false;
        for (let t = 0; t < 300 && !placed; t++) {
          const hor = rand() < .5;
          const r = Math.floor(rand() * (hor ? N : N - len + 1));
          const c = Math.floor(rand() * (hor ? N - len + 1 : N));
          const sc = Array.from({ length: len }, (_, i) => hor ? [r, c + i] : [r + i, c]);
          if (sc.every(([y, x]) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (inside(yy, xx) && cells[yy][xx] !== -1) return false; } return true; })) {
            sc.forEach(([y, x]) => { cells[y][x] = ships.length; });
            ships.push({ cells: sc, hits: 0 });
            placed = true;
          }
        }
        if (!placed) { ok = false; break; }
      }
      if (ok) return { cells, ships, left: TOTAL };
    }
    throw new Error('fleet');
  }

  // Выстрел по своему флоту → { res: 'miss'|'hit'|'sunk', ship?: [[r,c]...], over? }
  function fire(fleet, r, c){
    const i = fleet.cells[r][c];
    if (i < 0) return { res: 'miss' };
    const s = fleet.ships[i];
    s.hits++; fleet.left--;
    if (s.hits < s.cells.length) return { res: 'hit' };
    return { res: 'sunk', ship: s.cells, over: fleet.left === 0 };
  }

  // Отметить результат на «карте выстрелов»: 0 — неизвестно, 1 — мимо, 2 — ранен, 3 — потоплен
  function mark(map, r, c, out){
    if (out.res === 'miss') { map[r][c] = 1; return []; }
    if (out.res === 'hit') { map[r][c] = 2; return []; }
    const around = [];
    out.ship.forEach(([y, x]) => { map[y][x] = 3; });
    out.ship.forEach(([y, x]) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (inside(yy, xx) && map[yy][xx] === 0) { map[yy][xx] = 1; around.push([yy, xx]); }
      }
    });
    return around;
  }

  // ── Бот ──
  function botPick(map, level, sunkLens){
    const unknown = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (map[r][c] === 0) unknown.push([r, c]);
    const rnd = arr => arr[Math.floor(Math.random() * arr.length)];
    const hits = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (map[r][c] === 2) hits.push([r, c]);

    if (level === 'easy' && (hits.length === 0 || Math.random() < .65)) return rnd(unknown);

    // Добивание раненого: соседи по линии попаданий
    if (hits.length && level !== 'hard') {
      let cand = [];
      const neigh = hs => hs.flatMap(([r, c]) => [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]).filter(([y, x]) => inside(y, x) && map[y][x] === 0);
      const straight = hits.length >= 2 && (hits.every(h => h[0] === hits[0][0]) || hits.every(h => h[1] === hits[0][1]));
      if (straight) {
        const hor = hits[0][0] === hits[1][0];
        const line = hits.map(([r, c]) => hor ? c : r).sort((a, b) => a - b);
        const fixed = hor ? hits[0][0] : hits[0][1];
        const ends = [line[0] - 1, line[line.length - 1] + 1];
        cand = ends.map(v => hor ? [fixed, v] : [v, fixed]).filter(([r, c]) => inside(r, c) && map[r][c] === 0);
      }
      if (!cand.length) cand = neigh(hits);   // одно попадание или раненые корабли в разных местах
      if (cand.length) return rnd(cand);
    }
    if (level === 'normal') {
      // Шахматная раскраска: однопалубник всё равно найдётся в конце
      const even = unknown.filter(([r, c]) => (r + c) % 2 === 0);
      return rnd(even.length ? even : unknown);
    }

    // «Сложный»: плотность возможных расстановок оставшихся кораблей
    const left = LENS.slice();
    sunkLens.forEach(l => left.splice(left.indexOf(l), 1));
    const score = grid(0);
    for (const len of left) {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) for (const hor of [true, false]) {
        const sc = [];
        for (let i = 0; i < len; i++) sc.push(hor ? [r, c + i] : [r + i, c]);
        if (!sc.every(([y, x]) => inside(y, x) && (map[y][x] === 0 || map[y][x] === 2))) continue;
        const covered = sc.filter(([y, x]) => map[y][x] === 2).length;
        if (hits.length && !covered) continue;
        const w = hits.length ? 1 + covered * 20 : 1;
        sc.forEach(([y, x]) => { if (map[y][x] === 0) score[y][x] += w; });
      }
    }
    let best = -1, pick = [];
    unknown.forEach(([r, c]) => {
      if (score[r][c] > best) { best = score[r][c]; pick = [[r, c]]; }
      else if (score[r][c] === best) pick.push([r, c]);
    });
    return rnd(pick.length ? pick : unknown);
  }

  // ── Экран настройки ──
  function renderSetup(){
    let lvl = 'normal';
    try { lvl = localStorage.getItem('d37_sea_level') || 'normal'; } catch (e) {}
    const st = api.local();
    root.innerHTML = `<div class="ct-setup">
        <div class="ct-row"><span>Соперник</span><div class="ct-opts">${Object.entries(LEVELS).map(([k, l]) => `<button class="ct-opt${k === lvl ? ' active' : ''}" data-l="${k}">${l}</button>`).join('')}</div></div>
        <button class="ct-start" id="sStart">▶ Играть с ботом</button>
        <button class="ct-duel-btn" id="sOnline">👥 Играть с другом онлайн</button>
        <div class="ct-stats">Побед: <b>${st.wins || 0}</b> · Игр: <b>${st.plays || 0}</b></div>
        <details class="ct-rules"><summary>Правила</summary>
          Поле 10×10, у каждого флот: один 4-палубный, два 3-палубных, три 2-палубных и четыре однопалубных.
          Корабли не касаются друг друга даже углами. Стреляйте по очереди; попал — стреляешь ещё раз.
          Клетки вокруг потопленного корабля отмечаются сами. Кто первым потопит весь флот — победил.
        </details>
      </div>`;
    root.querySelectorAll('.ct-opt').forEach(b => b.onclick = () => {
      lvl = b.dataset.l;
      try { localStorage.setItem('d37_sea_level', lvl); } catch (e) {}
      root.querySelectorAll('.ct-opt').forEach(x => x.classList.toggle('active', x === b));
    });
    root.querySelector('#sStart').onclick = () => place(lvl);
    root.querySelector('#sOnline').onclick = () => { location.hash = '#/games/sea/' + GameRoom.newCode(); };
  }

  function boardHtml(id, label){
    let h = `<div class="sb-wrap"><div class="sb-label">${label}</div><div class="sb-board" id="${id}"><span></span>`;
    for (let c = 0; c < N; c++) h += `<span class="sb-hd">${LETTERS[c]}</span>`;
    for (let r = 0; r < N; r++) {
      h += `<span class="sb-hd">${r + 1}</span>`;
      for (let c = 0; c < N; c++) h += `<button class="sb-cell" data-r="${r}" data-c="${c}" aria-label="${LETTERS[c]}${r + 1}"></button>`;
    }
    return h + '</div></div>';
  }
  const cellEl = (id, r, c) => root.querySelector(`#${id} .sb-cell[data-r="${r}"][data-c="${c}"]`);
  function paintOwn(){
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const el = cellEl('sMine', r, c);
      el.className = 'sb-cell' + (G.fleet.cells[r][c] >= 0 ? ' ship' : '') + ['', ' miss', ' hit', ' sunk'][G.inc[r][c]];
      el.disabled = true;
    }
  }
  function paintCell(id, r, c, v){
    const el = cellEl(id, r, c);
    if (!el) return;
    el.classList.remove('miss', 'hit', 'sunk');
    if (v) el.classList.add(['', 'miss', 'hit', 'sunk'][v]);
    if (id === 'sEnemy') el.disabled = v !== 0;
  }

  // Расстановка: случайная, можно перемешать
  function place(level, online){
    G = { level, online: online || null, fleet: makeFleet(), inc: grid(0), shots: grid(0), enemy: null, turn: null, over: false, myShots: 0, sunkLens: [], botSunk: [], ready: false };
    root.innerHTML = `<div class="sb">
        <div class="ct-top"><span class="ct-badge">${online ? '👥 против ' + esc(R?.opp?.nick || 'соперника') : LEVELS[level]}</span><span class="ct-status" id="sStatus">Расставь флот</span></div>
        <div class="sb-boards">${boardHtml('sMine', 'Твой флот')}</div>
        <div class="ct-actions" id="sActions">
          <button id="sShuffle">🔀 Перемешать</button>
          <button class="ct-start" id="sGo">⚓ В бой!</button>
          ${online ? '' : '<button id="sSetup">⚙ Соперник</button>'}
        </div>
      </div>`;
    paintOwn();
    root.querySelector('#sShuffle').onclick = () => { G.fleet = makeFleet(); paintOwn(); api.sfx('move'); };
    root.querySelector('#sSetup')?.addEventListener('click', renderSetup);
    root.querySelector('#sGo').onclick = () => online ? onlineReady() : battle();
  }

  function battle(){
    G.ready = true;
    const boards = root.querySelector('.sb-boards');
    boards.insertAdjacentHTML('beforeend', boardHtml('sEnemy', G.online ? 'Флот ' + esc(R?.opp?.nick || 'соперника') : 'Флот бота'));
    paintOwn();
    root.querySelectorAll('#sEnemy .sb-cell').forEach(el => el.onclick = () => shoot(+el.dataset.r, +el.dataset.c));
    const acts = root.querySelector('#sActions');
    acts.innerHTML = G.online ? '' : '<button id="sAgain">↻ Заново</button><button id="sSetup">⚙ Соперник</button>';
    acts.querySelector('#sAgain')?.addEventListener('click', () => place(G.level));
    acts.querySelector('#sSetup')?.addEventListener('click', renderSetup);
    if (!G.online) {
      G.enemy = makeFleet();
      G.turn = 'me';
    }
    status();
    if (!G.online && G.turn === 'bot') later(botTurn, 700);
  }

  function status(text){
    const el = root?.querySelector('#sStatus');
    if (!el) return;
    if (text) { el.innerHTML = text; return; }
    const who = G.online ? esc(R?.opp?.nick || 'соперника') : 'бота';
    el.innerHTML = G.turn === 'me' ? '🎯 Твой выстрел' : `⏳ Стреляет ${G.online ? who : '🤖'}…`;
    root.querySelector('#sEnemy')?.classList.toggle('active', G.turn === 'me');
  }

  // Мой выстрел
  function shoot(r, c){
    if (!G || G.over || G.turn !== 'me' || G.shots[r][c] !== 0 || G.pending) return;
    G.myShots++;
    if (G.online) {
      G.pending = true;
      G.n = (G.n || 0) + 1;
      R?.send({ type: 'shot', r, c, n: G.n });
      paintCell('sEnemy', r, c, 0);
      cellEl('sEnemy', r, c)?.classList.add('aim');
      return;
    }
    applyMyShot(r, c, fire(G.enemy, r, c));
  }

  function applyMyShot(r, c, out){
    cellEl('sEnemy', r, c)?.classList.remove('aim');
    const around = mark(G.shots, r, c, out);
    paintCell('sEnemy', r, c, G.shots[r][c]);
    if (out.res === 'sunk') {
      out.ship.forEach(([y, x]) => paintCell('sEnemy', y, x, 3));
      around.forEach(([y, x]) => paintCell('sEnemy', y, x, 1));
      G.sunkLens.push(out.ship.length);
      api.sfx('win');
    } else api.sfx(out.res === 'hit' ? 'ok' : 'move');
    if (out.over) return end(true);
    if (out.res === 'miss') { G.turn = 'opp'; if (!G.online) G.turn = 'bot'; status(); if (!G.online) later(botTurn, 650 + Math.random() * 400); }
    else status(out.res === 'sunk' ? '💥 Потоплен! Стреляй ещё' : '🔥 Попал! Стреляй ещё');
  }

  // Выстрел по мне (бот или соперник онлайн) → ответ
  function incoming(r, c){
    const out = fire(G.fleet, r, c);
    const around = mark(G.inc, r, c, out);
    paintOwn();
    cellEl('sMine', r, c)?.classList.add('last');
    if (out.res !== 'miss') api.sfx('bad');
    if (out.res === 'sunk') G.botSunk.push(out.ship.length);
    return { out, around };
  }

  function botTurn(){
    if (!G || G.over || G.turn !== 'bot' || !root) return;
    const [r, c] = botPick(G.inc, G.level, G.botSunk);
    const { out } = incoming(r, c);
    if (out.over) return end(false);
    if (out.res === 'miss') { G.turn = 'me'; status(); }
    else { status(out.res === 'sunk' ? '🤖 потопил твой корабль…' : '🤖 попал…'); later(botTurn, 650 + Math.random() * 400); }
  }

  function end(win, note){
    if (G.over) return;
    G.over = true;
    root.querySelector('#sEnemy')?.classList.remove('active');
    // Показать уцелевшие корабли бота
    if (!G.online && G.enemy) {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (G.enemy.cells[r][c] >= 0 && G.shots[r][c] === 0) cellEl('sEnemy', r, c)?.classList.add('ship', 'rest');
    }
    const left = G.fleet.left;
    status(note || (win ? `🎉 Победа! Уцелело палуб: ${left} из ${TOTAL}` : G.online ? `😔 Победил ${esc(R?.opp?.nick || 'соперник')}` : '🤖 Бот потопил весь твой флот'));
    api.sfx(win ? 'win' : 'bad');
    if (G.online) {
      const acts = root.querySelector('#sActions');
      acts.innerHTML = '<button class="ct-start" id="sRematch">↻ Реванш</button><button id="sLeave">🚪 Выйти</button>';
      acts.querySelector('#sRematch').onclick = rematch;
      acts.querySelector('#sLeave').onclick = () => { location.hash = '#/games/sea'; };
      // «Победа» из-за ухода соперника в самом начале не засчитывается (защита от накрутки)
      if (!note || G.myShots >= 10) api.report('sea_online', win, win ? left : 0, 0);
      return;
    }
    api.report('sea_' + G.level, win, win ? left : 0, win && G.level === 'hard' ? left : 0);
  }

  // ═══ Онлайн ═══
  const O = { round: 0, started: false, rematch: { me: false, opp: false }, oppReady: false, first: null };
  function online(code){
    GameRoom.lobby(root, 'sea', code);
    O.round = 0; O.started = false;
    R = GameRoom.join('sea', code, {
      onError: () => { if (root) root.innerHTML = GameRoom.errorHtml; },
      onFull: () => { if (root) root.innerHTML = GameRoom.fullHtml('sea'); },
      onPeer: (opp, room) => {
        if (!root) return;
        if (!opp) {
          if (G?.online && G.ready && !G.over) end(true, `🎉 ${esc(R?.lastOpp || 'Соперник')} вышел — победа`);
          else if (!O.started) GameRoom.lobbyText(root, 'Ты в комнате. <b>Ждём друга…</b>');
          else if (G && !G.over) status(`${esc(R?.lastOpp || 'Соперник')} вышел. Ждём, вдруг вернётся…`);
          return;
        }
        const newcomer = R.lastOppId && R.lastOppId !== opp.id;
        R.lastOpp = opp.nick; R.lastOppId = opp.id;
        if (!O.started || newcomer) {
          if (room.isHost) hostStart();
          else if (!O.started) GameRoom.lobbyText(root, `<b>${esc(opp.nick)}</b> на месте — начинаем…`);
        }
      },
      onMessage: m => {
        if (m.type === 'start' && R && !R.isHost) return begin(m);
        if (!G?.online || m.round !== O.round) return;
        if (m.type === 'ready') { O.oppReady = true; maybeFight(); }
        else if (m.type === 'shot') {
          // Стреляет соперник: только в свою очередь и по новой клетке
          if (G.over || !G.ready || G.turn !== 'opp' || !inside(m.r, m.c) || G.inc[m.r][m.c] !== 0) return;
          const { out, around } = incoming(m.r, m.c);
          R.send({ type: 'res', r: m.r, c: m.c, n: m.n, res: out.res, ship: out.ship || null, over: !!out.over, round: O.round });
          if (out.over) return end(false);
          if (out.res === 'miss') { G.turn = 'me'; status(); }
          else status(out.res === 'sunk' ? `💥 ${esc(R.opp?.nick || 'Соперник')} потопил твой корабль` : `🔥 ${esc(R.opp?.nick || 'Соперник')} попал`);
        } else if (m.type === 'res') {
          if (!G.pending || m.n !== G.n) return;
          G.pending = false;
          const ok = ['miss', 'hit', 'sunk'].includes(m.res) && (m.res !== 'sunk' || (Array.isArray(m.ship) && m.ship.length >= 1 && m.ship.length <= 4 && m.ship.every(p => Array.isArray(p) && inside(p[0], p[1]))));
          if (!ok) return;
          applyMyShot(m.r, m.c, { res: m.res, ship: m.ship, over: m.over });
        } else if (m.type === 'rematch') {
          O.rematch.opp = true;
          if (R.isHost && O.rematch.me) hostStart();
          else if (G.over) status(`${esc(R.opp?.nick || 'Соперник')} хочет реванш — жми «↻ Реванш»!`);
        }
      },
    });
    if (!R) root.innerHTML = GameRoom.errorHtml;
  }
  function hostStart(){
    O.round++;
    const first = O.round % 2 === 1 ? R.opp.id : R.myId;   // первую партию начинает гость
    const msg = { type: 'start', first, round: O.round };
    R.send(msg);
    begin(msg);
  }
  function begin(m){
    O.started = true; O.round = m.round; O.rematch = { me: false, opp: false }; O.oppReady = false; O.first = m.first;
    place('online', { round: m.round });
  }
  function onlineReady(){
    G.ready = true;
    R?.send({ type: 'ready', round: O.round });
    const acts = root.querySelector('#sActions');
    acts.innerHTML = '';
    battle();
    G.turn = null;
    if (!maybeFight()) status(`Флот готов. Ждём, пока расставит ${esc(R?.opp?.nick || 'соперник')}…`);
  }
  function maybeFight(){
    if (!G?.ready || !O.oppReady || G.turn) return false;
    G.turn = O.first === R.myId ? 'me' : 'opp';
    status();
    return true;
  }
  function rematch(){
    O.rematch.me = true;
    R?.send({ type: 'rematch', round: O.round });
    if (R?.isHost && O.rematch.opp) hostStart();
    else status(`Ждём ${esc(R?.opp?.nick || 'соперника')}…`);
  }

  window.GAME_IMPL.sea = {
    mount(el, gameApi){
      root = el; api = gameApi; G = null;
      if (GameRoom.validCode(gameApi.param)) online(gameApi.param); else renderSetup();
    },
    unmount(){ timers.forEach(clearTimeout); timers = []; if (G) G.over = true; R?.leave(); R = null; root = null; },
    _test: { makeFleet, fire, mark, botPick, N, TOTAL },
  };
})();
