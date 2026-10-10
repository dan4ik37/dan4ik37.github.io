// ═══════════════════════════════════════
//  ИГРА «ОДНА!» — карточная игра по правилам Уно: с ботами или онлайн с друзьями (2–4 игрока)
// ═══════════════════════════════════════
// 108 карт: 4 цвета × (0, 1–9 по две, «пропуск» ⊘, «разворот» ⇄, «+2») + 4 «дикие» и 4 «дикие +4».
// Ходи картой того же цвета или того же значения, дикую — на что угодно (выбираешь цвет). Нечем — тяни одну;
// подошла — можно сразу сыграть. Осталась одна карта — жми «Одна!», иначе соперник поймает: +2 карты.
// Первый, кто избавился от карт, побеждает и получает очки за карты соперников (цифра — по номиналу,
// действия — 20, дикие — 50).
// Онлайн — стол на 2–4 (js/games/table.js): хозяин стола раздаёт и проверяет ходы. Всё по сети — только личными
// зашифрованными сообщениями (AES-GCM подтверждает и отправителя): чужую руку не подсмотреть, ход за другого и
// «состояние стола» от имени хозяина не подделать.
// Ключи сервера: uno (с ботами), uno_online (с людьми) — games-more.sql.
(() => {
  const COLORS = ['r', 'y', 'g', 'b'];
  const CNAME = { r: 'красный', y: 'жёлтый', g: 'зелёный', b: 'синий' };
  const SYM = { S: '⊘', R: '⇄', D: '+2', W: '★', F: '+4' };
  const BOTS = ['Робо-Вася', 'Бот Петя', 'Кибер-Маша'];

  // ═══ ПРАВИЛА (чистые функции — проверяются в node) ═══
  function deck(){
    const d = [];
    for (const c of COLORS) {
      d.push(c + '0');
      for (let n = 1; n <= 9; n++) d.push(c + n, c + n);
      for (const s of ['S', 'R', 'D']) d.push(c + s, c + s);
    }
    for (let i = 0; i < 4; i++) d.push('W', 'F');
    return d;
  }
  const colorOf = c => 'rygb'.includes(c[0]) ? c[0] : null;
  const valOf = c => colorOf(c) ? c.slice(1) : c;
  const playable = (c, top, color) => !colorOf(c) || colorOf(c) === color || valOf(c) === valOf(top);
  const points = c => { const v = valOf(c); return /^\d$/.test(v) ? +v : v === 'W' || v === 'F' ? 50 : 20; };
  function shuffle(a, rand){ for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // players: [{ id, nick, bot }]
  function newGame(players, rand){
    const d = shuffle(deck(), rand);
    const G = { players, hands: players.map(() => d.splice(0, 7)), deck: d, discard: [], top: '', color: '', turn: 0, dir: 1,
      drew: null, said: players.map(() => false), exposed: null, winner: -1, pts: 0, log: 'Игра началась', v: 0, rand };
    let top = G.deck.shift();
    while (!colorOf(top)) { G.deck.push(top); top = G.deck.shift(); }
    G.top = top; G.color = colorOf(top); G.discard.push(top);
    // первая открытая — действие
    const v = valOf(top);
    if (v === 'S') { G.turn = nextOf(G, 0); G.log = `Первая карта — пропуск: ${players[0].nick} пропускает ход`; }
    else if (v === 'R') { G.dir = -1; G.turn = players.length === 2 ? 1 : players.length - 1; G.log = 'Первая карта — разворот'; }
    else if (v === 'D') { give(G, 0, 2); G.turn = nextOf(G, 0); G.log = `Первая карта — +2: ${players[0].nick} берёт 2`; }
    return G;
  }
  const nextOf = (G, p, k = 1) => ((p + G.dir * k) % G.players.length + G.players.length) % G.players.length;
  function refill(G){
    if (G.deck.length) return;
    const keep = G.discard.pop();
    G.deck = shuffle(G.discard, G.rand);
    G.discard = [keep];
  }
  function give(G, p, n){ for (let i = 0; i < n; i++) { refill(G); if (!G.deck.length) break; G.hands[p].push(G.deck.shift()); } if (G.hands[p].length > 1) G.said[p] = false; }

  // Ход игрока p. a: { a: 'play', i, color } | { a: 'draw' } | { a: 'pass' } | { a: 'uno' } | { a: 'catch' }. Вернёт текст ошибки или null
  function act(G, p, a, now){
    if (G.winner >= 0) return 'Игра окончена';
    const nick = G.players[p].nick;
    if (a.a === 'uno') {
      if (G.hands[p].length > 2) return 'Рано: «Одна!» — когда остаётся одна-две карты';
      G.said[p] = true;
      if (G.exposed?.p === p) G.exposed = null;
      G.log = `${nick}: «Одна!»`; G.v++;
      return null;
    }
    if (a.a === 'catch') {
      const ex = G.exposed;
      if (!ex || ex.p === p || now > ex.until || G.hands[ex.p].length !== 1) return 'Некого ловить';
      give(G, ex.p, 2); G.exposed = null;
      G.log = `${nick} поймал ${G.players[ex.p].nick}: +2 карты!`; G.v++;
      return null;
    }
    if (G.turn !== p) return 'Сейчас не твой ход';
    if (a.a === 'draw') {
      if (G.drew != null) return 'Ты уже взял карту';
      refill(G);
      if (!G.deck.length) { pass(G, p, `${nick} пропускает ход (колода пуста)`); return null; }
      const c = G.deck.shift();
      G.hands[p].push(c);
      if (G.hands[p].length > 1) G.said[p] = false;
      if (playable(c, G.top, G.color)) { G.drew = G.hands[p].length - 1; G.log = `${nick} берёт карту`; G.v++; }
      else pass(G, p, `${nick} берёт карту и пропускает ход`);
      return null;
    }
    if (a.a === 'pass') {
      if (G.drew == null) return 'Сначала возьми карту';
      pass(G, p, `${nick} пропускает ход`);
      return null;
    }
    if (a.a === 'play') {
      const i = a.i | 0, c = G.hands[p][i];
      if (c == null) return 'Нет такой карты';
      if (G.drew != null && i !== G.drew) return 'Можно сыграть только взятую карту';
      if (!playable(c, G.top, G.color)) return 'Эта карта не подходит';
      if (!colorOf(c) && !COLORS.includes(a.color)) return 'Выбери цвет';
      G.hands[p].splice(i, 1);
      G.discard.push(c); G.top = c; G.color = colorOf(c) || a.color; G.drew = null;
      const v = valOf(c), left = G.hands[p].length;
      let log = `${nick}: ${cardName(c)}${colorOf(c) ? '' : ` → ${CNAME[G.color]}`}`;
      if (left === 0) { G.winner = p; G.pts = G.hands.reduce((s, h, j) => s + (j === p ? 0 : h.reduce((x, y) => x + points(y), 0)), 0); G.log = `${nick} сбросил все карты и победил! +${G.pts} очков`; G.v++; return null; }
      if (left === 1 && !G.said[p]) G.exposed = { p, until: now + 4000 };
      let step = 1;
      if (v === 'S') { step = 2; log += ` · ${G.players[nextOf(G, p)].nick} пропускает`; }
      else if (v === 'R') { if (G.players.length === 2) step = 2; else G.dir *= -1; log += ' · разворот'; }
      else if (v === 'D' || v === 'F') { const t = nextOf(G, p), n = v === 'D' ? 2 : 4; give(G, t, n); step = 2; log += ` · ${G.players[t].nick} берёт ${n}`; }
      G.turn = nextOf(G, p, step);
      G.log = log; G.v++;
      return null;
    }
    return 'Непонятный ход';
  }
  function pass(G, p, log){ G.drew = null; G.turn = nextOf(G, p); G.log = log; G.v++; }
  function cardName(c){
    const v = valOf(c);
    if (v === 'W') return 'дикая карта';
    if (v === 'F') return 'дикая +4';
    const n = { S: 'пропуск', R: 'разворот', D: '+2' }[v] || v;
    return `${n} (${CNAME[colorOf(c)]})`;
  }
  // Бот: выбрать ход. Сначала — подходящие цветные (покрупнее), дикие — напоследок; если у следующего мало карт — бьём действиями
  function botMove(G, p){
    const hand = G.hands[p];
    if (G.drew != null) {
      const c = hand[G.drew];
      return playable(c, G.top, G.color) ? { a: 'play', i: G.drew, color: bestColor(hand, G.drew) } : { a: 'pass' };
    }
    const nextN = G.hands[nextOf(G, p)].length;
    const opts = hand.map((c, i) => ({ c, i })).filter(o => playable(o.c, G.top, G.color));
    if (!opts.length) return { a: 'draw' };
    const score = o => {
      const v = valOf(o.c);
      if (!colorOf(o.c)) return nextN <= 2 && v === 'F' ? 90 : -50 + (v === 'F' ? 5 : 0);
      if (nextN <= 2 && (v === 'D' || v === 'S')) return 80;
      return (colorOf(o.c) === G.color ? 10 : 0) + (/\d/.test(v) ? +v : 12);
    };
    opts.sort((a, b) => score(b) - score(a));
    return { a: 'play', i: opts[0].i, color: bestColor(hand, opts[0].i) };
  }
  function bestColor(hand, skip){
    const n = { r: 0, y: 0, g: 0, b: 0 };
    hand.forEach((c, i) => { if (i !== skip && colorOf(c)) n[colorOf(c)]++; });
    return COLORS.reduce((a, b) => (n[b] > n[a] ? b : a), 'r');
  }
  // Что видят все (без чужих карт)
  function pub(G){
    return { order: G.players.map((pl, i) => ({ id: pl.id, nick: pl.nick, bot: !!pl.bot, n: G.hands[i].length, said: G.said[i], look: pl.look || null })),
      turn: G.turn, dir: G.dir, color: G.color, top: G.top, deckN: G.deck.length, drew: G.drew, exposed: G.exposed ? G.exposed.p : -1,
      winner: G.winner, pts: G.pts, log: G.log, v: G.v };
  }

  // ═══ ЭКРАН ═══
  let root, api, G = null, P = null, hand = [], meIdx = 0, mode = 'menu', room = null, timers = [], botT = 0, tickT = 0, nBots = 2, wildPick = -1, seatsCache = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const nickMe = () => GameRoom.nick();
  const online = () => !!room;
  const isHost = () => !room || room.isHost;

  function cardHtml(c, i, opts = {}){
    const col = colorOf(c), v = valOf(c);
    const label = SYM[v] || v;
    return `<button type="button" class="uc ${col ? 'c-' + col : 'c-w'}${opts.ok ? ' ok' : ''}${opts.dim ? ' dim' : ''}${opts.big ? ' big' : ''}" ${i != null ? `data-act="play:${i}"` : ''} aria-label="${cardName(c)}"${opts.disabled ? ' disabled' : ''}>
      <span class="uc-c">${label}</span><span class="uc-t">${label}</span><span class="uc-b">${label}</span></button>`;
  }

  function menu(){
    mode = 'menu'; G = null; P = null;
    const best = api.local().best || 0;
    root.innerHTML = `<div class="un-menu">
        <div class="un-logo">${cardHtml('rS', null, { big: true })}${cardHtml('W', null, { big: true })}${cardHtml('b7', null, { big: true })}</div>
        <div class="un-title">Одна!</div>
        <div class="un-sub">Карточная игра по правилам Уно: сбрось все карты первым. Не забудь крикнуть «Одна!», когда останется последняя.</div>
        <div class="un-bots">Ботов: ${[1, 2, 3].map(n => `<button type="button" class="un-n${n === nBots ? ' sel' : ''}" data-act="nb:${n}">${n}</button>`).join('')}</div>
        <div class="ct-actions"><button type="button" class="ct-start" data-act="solo">▶ Играть с ботами</button><button type="button" class="ct-duel-btn" data-act="online">👥 С друзьями онлайн</button></div>
        ${best ? `<div class="un-sub">Лучший результат: <b>${best}</b> очков</div>` : ''}
        <details class="un-rules"><summary>Правила</summary>
          <p>Ходи картой того же цвета или того же значения. Дикая ★ — на что угодно, ты выбираешь цвет; дикая +4 — ещё и следующий берёт 4.</p>
          <p>⊘ — следующий пропускает ход, ⇄ — разворот, +2 — следующий берёт две и пропускает.</p>
          <p>Нечем ходить — нажми на колоду и возьми карту. Подошла — можно сразу сыграть.</p>
          <p>Осталась одна карта — жми «Одна!». Не успел — соперник нажмёт «Поймал!», и ты возьмёшь 2.</p>
        </details>
      </div>`;
  }

  function startSolo(){
    const players = [{ id: 'me', nick: nickMe(), look: window.D37Char?.look() || null }];
    for (let i = 0; i < nBots; i++) players.push({ id: 'bot' + i, nick: BOTS[i], bot: true });
    G = newGame(players, Math.random);
    meIdx = 0; mode = 'play';
    sync();
  }

  // Хозяин: после любого изменения — всем публичное состояние, каждому его руку; боты ходят сами
  function sync(){
    if (!G) return;
    P = pub(G);
    hand = G.hands[meIdx].slice();
    if (room) G.players.forEach((pl, i) => { if (!pl.bot && pl.id !== room.myId) room.sendTo(pl.id, { type: 'up', pub: P, hand: G.hands[i] }); });
    render();
    scheduleBot();
    if (G.winner >= 0) over();
  }
  function scheduleBot(){
    clearTimeout(botT);
    if (!G || G.winner >= 0 || !isHost()) return;
    // бот ловит того, кто не сказал «Одна!»
    if (G.exposed && !G.players[G.exposed.p].bot) {
      const catcher = G.players.findIndex((pl, i) => pl.bot && i !== G.exposed.p);
      if (catcher >= 0) later(() => { if (G && G.exposed && Math.random() < .7) { act(G, catcher, { a: 'catch' }, Date.now()); sync(); } }, 2200 + Math.random() * 1200);
    }
    const p = G.turn, pl = G.players[p];
    if (!pl.bot) { armTurnTimer(); return; }
    botT = later(() => {
      if (!G || G.turn !== p || G.winner >= 0) return;
      const m = botMove(G, p);
      if (m.a === 'play' && G.hands[p].length === 2 && Math.random() < .9) act(G, p, { a: 'uno' }, Date.now());
      act(G, p, m, Date.now());
      sync();
    }, 900 + Math.random() * 700);
  }
  // Онлайн: человек думает дольше 30 с — ход за него (берёт карту / пропускает), чтобы стол не стоял
  function armTurnTimer(){
    clearTimeout(tickT);
    if (!room || !G || G.winner >= 0) return;
    const p = G.turn, v = G.v;
    tickT = later(() => {
      if (!G || G.turn !== p || G.v !== v) return;
      act(G, p, G.drew != null ? { a: 'pass' } : { a: 'draw' }, Date.now());
      if (G.turn === p && G.drew != null) act(G, p, { a: 'pass' }, Date.now());
      sync();
    }, 30000);
  }

  // Свой ход (и у хозяина, и у гостя)
  function doAct(a){
    if (!P || P.winner >= 0) return;
    if (isHost()) {
      const err = act(G, meIdx, a, Date.now());
      if (err) { api.toast(err); return; }
      api.sfx(a.a === 'play' ? 'move' : a.a === 'catch' ? 'win' : 'tick');
      sync();
    } else {
      room.sendTo(hostId(), { type: 'act', act: a, v: P.v });
      api.sfx('tick');
    }
  }

  function render(){
    if (!P || mode !== 'play') return;
    const myTurn = P.turn === meIdx && P.winner < 0;
    const others = P.order.map((o, i) => ({ ...o, i })).filter(o => o.i !== meIdx);
    // соперники — по кругу от меня
    others.sort((a, b) => ((a.i - meIdx + P.order.length) % P.order.length) - ((b.i - meIdx + P.order.length) % P.order.length));
    const canPlay = myTurn ? hand.map((c, i) => (P.drew == null || i === P.drew) && playable(c, P.top, P.color)) : [];
    const exposedMe = P.exposed === meIdx;
    const canCatch = P.exposed >= 0 && P.exposed !== meIdx;
    root.innerHTML = `<div class="un">
        <div class="un-opps">${others.map(o => `<div class="un-opp${P.turn === o.i ? ' turn' : ''}">
            ${o.bot ? '<span class="un-av">🤖</span>' : o.look && window.D37Char ? `<img class="un-av" alt="" src="${window.D37Char.img(o.look, 56)}">` : '<span class="un-av">🙂</span>'}
            <b>${esc(o.nick)}</b><span class="un-cnt"><i class="un-mini"></i>×${o.n}</span>${o.n === 1 && o.said ? '<i class="un-said">Одна!</i>' : ''}</div>`).join('')}</div>
        <div class="un-table">
          <button type="button" class="uc c-back un-deck" data-act="draw"${myTurn && P.drew == null ? '' : ' disabled'} aria-label="Взять карту"><span class="uc-c un-logo-t">Одна!</span><small>${P.deckN}</small></button>
          <div class="un-top">${cardHtml(P.top, null, { big: true })}</div>
          <div class="un-info"><span class="un-dot c-${P.color}" title="Цвет: ${CNAME[P.color]}"></span><span class="un-dir">${P.dir > 0 ? '↻' : '↺'}</span></div>
        </div>
        <div class="un-log" aria-live="polite">${esc(P.log)}</div>
        <div class="un-status">${P.winner >= 0 ? '' : myTurn ? (P.drew != null ? '🃏 Сыграй взятую карту или пропусти ход' : '🟢 Твой ход') : `⏳ Ходит ${esc(P.order[P.turn].nick)}…`}</div>
        <div class="un-acts">
          ${hand.length <= 2 && !P.order[meIdx].said && P.winner < 0 ? `<button type="button" class="un-btn uno${exposedMe ? ' urgent' : ''}" data-act="uno">📢 Одна!</button>` : ''}
          ${canCatch ? `<button type="button" class="un-btn catch" data-act="catch">🫵 Поймал ${esc(P.order[P.exposed].nick)}!</button>` : ''}
          ${myTurn && P.drew != null ? '<button type="button" class="un-btn" data-act="pass">Пропустить ход</button>' : ''}
        </div>
        <div class="un-hand${myTurn ? ' my' : ''}${hand.length > 9 ? ' many' : ''}">${hand.map((c, i) => cardHtml(c, i, { ok: canPlay[i], dim: myTurn && !canPlay[i] })).join('')}</div>
        <div class="un-wild" hidden><div class="un-wt">Выбери цвет</div><div class="un-wc">${COLORS.map(c => `<button type="button" class="un-dot big c-${c}" data-act="color:${c}" aria-label="${CNAME[c]}"></button>`).join('')}</div></div>
      </div>`;
  }

  function over(){
    clearTimeout(botT); clearTimeout(tickT);
    const win = P.winner === meIdx;
    const res = root.querySelector('.un-status');
    if (res) res.innerHTML = win ? `🏆 <b>Победа!</b> +${P.pts} очков` : `😔 Победил ${esc(P.order[P.winner].nick)}`;
    api.sfx(win ? 'win' : 'bad');
    const box = root.querySelector('.un-acts');
    if (box) box.innerHTML = (isHost() ? '<button type="button" class="ct-start" data-act="again">↻ Ещё партия</button>' : '<span class="un-sub">Ждём, пока хозяин начнёт новую…</span>')
      + `<button type="button" class="un-btn" data-act="leave">${online() ? '🚪 Выйти' : '🏠 Меню'}</button>`;
    if (mode === 'play') {
      mode = 'over';
      api.report(online() ? 'uno_online' : 'uno', win, win ? P.pts : 0, win ? P.pts : 0);
    }
  }

  function onClick(e){
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a.startsWith('nb:')) { nBots = +a.slice(3); menu(); return; }
    if (a === 'solo') { startSolo(); return; }
    if (a === 'online') { location.hash = '#/games/uno/' + GameRoom.newCode(); return; }
    if (a === 'again') { if (online()) hostStart(); else startSolo(); return; }
    if (a === 'leave') { if (online()) location.hash = '#/games/uno'; else menu(); return; }
    if (a === 'draw') { doAct({ a: 'draw' }); return; }
    if (a === 'pass') { doAct({ a: 'pass' }); return; }
    if (a === 'uno') { doAct({ a: 'uno' }); return; }
    if (a === 'catch') { doAct({ a: 'catch' }); return; }
    if (a.startsWith('play:')) {
      const i = +a.slice(5), c = hand[i];
      if (!c) return;
      if (!colorOf(c)) { wildPick = i; const w = root.querySelector('.un-wild'); if (w) w.hidden = false; return; }
      doAct({ a: 'play', i });
      return;
    }
    if (a.startsWith('color:')) { const w = root.querySelector('.un-wild'); if (w) w.hidden = true; if (wildPick >= 0) doAct({ a: 'play', i: wildPick, color: a.slice(6) }); wildPick = -1; return; }
    // лобби стола
    if (a === 'copy') { const inp = root.querySelector('.ct-link input'); navigator.clipboard?.writeText(inp.value).then(() => { b.textContent = '✅ Скопировано'; }, () => inp.select()); return; }
    if (a === 'bot') { bots++; lobby(); return; }
    if (a.startsWith('unbot:')) { bots = Math.max(0, bots - 1); lobby(); return; }
    if (a === 'go') { hostStart(); return; }
  }

  // ═══ ОНЛАЙН: стол на 2–4 ═══
  let bots = 0, code = '';
  const hostId = () => room?.seats[0]?.id;
  function seatList(){
    const humans = (room?.seats || []).map(s => ({ id: s.id, nick: s.nick, me: s.me, look: s.look }));
    const list = humans.slice(0, 4);
    for (let i = 0; i < bots && list.length < 4; i++) list.push({ id: 'bot' + i, nick: BOTS[i], bot: true });
    return list;
  }
  function lobby(){
    if (!room || mode === 'play' || mode === 'over') return;
    mode = 'lobby';
    const seats = seatList();
    root.innerHTML = TableRoom.lobbyHtml(location.origin + location.pathname + '#/games/uno/' + code, seats, 4, { title: '🃏 Одна! — стол', host: room.isHost, canStart: seats.length >= 2 });
  }
  function hostStart(){
    if (!room?.isHost) return;
    const players = seatList().map(s => ({ id: s.id, nick: s.nick, bot: !!s.bot, look: s.look || null }));
    if (players.length < 2) { api.toast('Нужно хотя бы двое: позови друга или добавь бота'); return; }
    G = newGame(players, Math.random);
    meIdx = players.findIndex(p => p.id === room.myId);
    mode = 'play';
    sync();
  }
  function joinTable(c){
    code = c;
    root.innerHTML = '<div class="gm-loading"><div class="spinner"></div>Подключаемся к столу…</div>';
    room = TableRoom.join('uno', c, {
      max: 4,
      onError: () => { root.innerHTML = GameRoom.errorHtml; },
      onFull: () => { root.innerHTML = GameRoom.fullHtml('uno'); },
      onSeats: seats => {
        seatsCache = seats;
        if (mode === 'play' || mode === 'over') {
          if (!room.isHost && G == null && !seats[0]?.me && P && !seats.some(s => s.id === P.order[0].id)) { api.toast('Хозяин стола вышел'); mode = 'lobby'; lobby(); }
          if (room.isHost && G) {
            // кто-то ушёл — за него доигрывает бот
            G.players.forEach((pl, i) => { if (!pl.bot && pl.id !== room.myId && !seats.some(s => s.id === pl.id)) { pl.bot = true; pl.nick += ' (бот)'; G.log = `${pl.nick.replace(' (бот)', '')} вышел — за него играет бот`; G.v++; } });
            sync();
          }
          return;
        }
        lobby();
      },
      onPrivate: (m, from) => {
        if (room.isHost) {
          if (m.type !== 'act' || !G) return;
          const p = G.players.findIndex(pl => pl.id === from && !pl.bot);
          if (p < 0) return;
          const err = act(G, p, m.act || {}, Date.now());
          if (err) { room.sendTo(from, { type: 'err', text: err }); return; }
          sync();
          return;
        }
        if (from !== hostId()) return;   // всё — только от хозяина стола
        if (m.type === 'up') {
          const first = !P || mode !== 'play';
          P = m.pub; hand = m.hand || [];
          meIdx = P.order.findIndex(o => o.id === room.myId);
          if (meIdx < 0) return;
          if (first && P.winner < 0) mode = 'play';
          render();
          if (P.winner >= 0) over();
        } else if (m.type === 'err') api.toast(m.text);
      },
    });
    if (!room) root.innerHTML = GameRoom.errorHtml;
  }

  window.GAME_IMPL.uno = {
    mount(el, gameApi){
      root = el; api = gameApi;
      root.addEventListener('click', onClick);
      if (GameRoom.validCode(gameApi.param)) joinTable(gameApi.param); else menu();
    },
    unmount(){
      timers.forEach(clearTimeout); timers = [];
      clearTimeout(botT); clearTimeout(tickT);
      root?.removeEventListener('click', onClick);
      room?.leave(); room = null;
      G = null; P = null; hand = []; bots = 0; mode = 'menu';
      root = null;
    },
    _test: { deck, newGame, act, botMove, playable, pub, points, colorOf, valOf },
  };
})();
