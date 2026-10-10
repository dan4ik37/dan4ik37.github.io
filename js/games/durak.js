// ═══════════════════════════════════════
//  ИГРА «ДУРАК» (подкидной) — с ботами или онлайн с друзьями (2–4 игрока)
// ═══════════════════════════════════════
// 36 карт, козырь — масть открытой карты под колодой. Первым ходит тот, у кого младший козырь.
// Отбиваются старшей картой той же масти или козырем. Подкидывать могут все, кроме отбивающегося, — карты
// того же достоинства, что уже на столе; всего за раунд не больше 6 и не больше, чем карт было у отбивающегося.
// Не отбился — «Беру» (остальные ещё могут подкинуть), отбился — «Бито». Добор до 6: сначала нападавший,
// отбивающийся последним. Кто остался с картами, когда у всех кончились, — дурак.
// Онлайн — стол на 2–4 (js/games/table.js): хозяин раздаёт и проверяет ходы, всё по сети — зашифрованными
// личными сообщениями (чужие карты не подсмотреть, ход за другого не подделать). Ключи: durak, durak_online.
(() => {
  const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const SUITS = ['s', 'c', 'h', 'd'];
  const SCH = { s: '♠', c: '♣', h: '♥', d: '♦' };
  const SNAME = { s: 'пики', c: 'трефы', h: 'червы', d: 'бубны' };
  const RL = { J: 'В', Q: 'Д', K: 'К', A: 'Т' };
  const BOTS = ['Бот Федя', 'Бот Нина', 'Бот Гена'];
  const rank = c => c.slice(0, -1), suit = c => c.slice(-1), rv = c => RANKS.indexOf(rank(c));
  const label = c => (RL[rank(c)] || rank(c)) + SCH[suit(c)];
  const beats = (d, a, tr) => (suit(d) === suit(a) && rv(d) > rv(a)) || (suit(d) === tr && suit(a) !== tr);
  function shuffle(a, rand){ for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // ═══ ПРАВИЛА (чистые функции) ═══
  function newGame(players, rand){
    const deck = shuffle(SUITS.flatMap(s => RANKS.map(r => r + s)), rand);
    const hands = players.map(() => deck.splice(0, 6));
    const trumpCard = deck[deck.length - 1], trump = suit(trumpCard);
    let first = 0, low = 99;
    hands.forEach((h, i) => h.forEach(c => { if (suit(c) === trump && rv(c) < low) { low = rv(c); first = i; } }));
    const G = { players, hands, deck, trump, trumpCard, table: [], attacker: first, defender: 0, taking: false, passed: [], out: [], loser: -1, over: false, log: '', v: 0, limit: 6, rand };
    startRound(G, first);
    G.log = low < 99 ? `Козырь — ${SNAME[trump]} ${SCH[trump]}. Первым ходит ${players[first].nick} (младший козырь)` : `Козырь — ${SNAME[trump]} ${SCH[trump]}`;
    return G;
  }
  const n = G => G.players.length;
  const inGame = (G, i) => G.hands[i].length > 0 || G.deck.length > 0;
  function nextActive(G, i){ for (let k = 1; k <= n(G); k++) { const j = (i + k) % n(G); if (inGame(G, j)) return j; } return -1; }
  function startRound(G, att){
    G.table = []; G.taking = false; G.passed = [];
    G.attacker = inGame(G, att) ? att : nextActive(G, att);
    G.defender = nextActive(G, G.attacker);
    G.limit = Math.min(6, G.hands[G.defender]?.length || 0);
  }
  const attackersOf = G => G.players.map((_, i) => i).filter(i => i !== G.defender && G.hands[i].length > 0);
  function canThrow(G, p, c){
    if (G.over || p === G.defender || G.table.length >= G.limit) return false;
    if (!G.table.length) return p === G.attacker;
    return G.table.some(t => rank(t.a) === rank(c) || (t.d && rank(t.d) === rank(c)));
  }
  const unbeaten = G => G.table.map((t, i) => t.d ? -1 : i).filter(i => i >= 0);
  // Ход игрока p. a: { a: 'attack', i } | { a: 'beat', i, t } | { a: 'take' } | { a: 'pass' }. Вернёт текст ошибки или null
  function act(G, p, a){
    if (G.over) return 'Игра окончена';
    const nick = G.players[p].nick, hand = G.hands[p];
    if (a.a === 'attack') {
      const c = hand[a.i | 0];
      if (!c) return 'Нет такой карты';
      if (!canThrow(G, p, c)) return !G.table.length ? 'Сейчас ходит другой игрок' : G.table.length >= G.limit ? 'Больше подкидывать нельзя' : 'Подкинуть можно только карту того же достоинства';
      hand.splice(a.i | 0, 1);
      G.table.push({ a: c, d: null, by: p });
      G.passed = [];
      G.log = `${nick}: ${G.table.length === 1 ? 'ходит' : 'подкидывает'} ${label(c)}`;
    } else if (a.a === 'beat') {
      if (p !== G.defender) return 'Отбивается другой игрок';
      if (G.taking) return 'Ты уже берёшь';
      const c = hand[a.i | 0];
      if (!c) return 'Нет такой карты';
      const free = unbeaten(G);
      const t = a.t != null && free.includes(a.t) ? a.t : free.find(j => beats(c, G.table[j].a, G.trump));
      if (t == null || !beats(c, G.table[t].a, G.trump)) return 'Эта карта не бьёт';
      hand.splice(a.i | 0, 1);
      G.table[t].d = c;
      G.passed = [];
      G.log = `${nick} бьёт ${label(G.table[t].a)} картой ${label(c)}`;
    } else if (a.a === 'take') {
      if (p !== G.defender || G.taking || !G.table.length) return 'Сейчас нельзя';
      G.taking = true; G.passed = [];
      G.log = `${nick}: «Беру»`;
    } else if (a.a === 'pass') {
      if (p === G.defender || !attackersOf(G).includes(p)) return 'Сейчас нельзя';
      if (!G.table.length || (!G.taking && unbeaten(G).length)) return 'Подожди, пока отобьются';
      if (!G.passed.includes(p)) G.passed.push(p);
    } else return 'Непонятный ход';
    G.v++;
    roundEnd(G);
    return null;
  }
  // Раунд кончился? (все подкинувшие сказали «пас»/«бито», или подкидывать нечего/некуда)
  function roundEnd(G){
    if (!G.table.length) return;
    const att = attackersOf(G);
    const waiting = att.filter(i => !G.passed.includes(i) && G.hands[i].some(c => canThrow(G, i, c)));
    if (G.taking) {
      if (waiting.length && G.table.length < G.limit) return;
      const def = G.defender, cards = G.table.flatMap(t => t.d ? [t.a, t.d] : [t.a]);
      G.hands[def].push(...cards);
      G.log = `${G.players[def].nick} берёт ${cards.length} ${cards.length === 1 ? 'карту' : cards.length < 5 ? 'карты' : 'карт'}`;
      refill(G);
      if (!finished(G)) startRound(G, nextActive(G, def));
    } else if (!unbeaten(G).length) {
      if (waiting.length && G.table.length < G.limit) return;
      const def = G.defender;
      G.log = 'Бито!';
      refill(G);
      if (!finished(G)) startRound(G, inGame(G, def) ? def : nextActive(G, def));
    }
    G.v++;
  }
  function refill(G){
    const order = [];
    for (let k = 0; k < n(G); k++) { const i = (G.attacker + k) % n(G); if (i !== G.defender) order.push(i); }
    order.push(G.defender);
    for (const p of order) while (G.hands[p].length < 6 && G.deck.length) G.hands[p].push(G.deck.shift());
    G.table = [];
    G.players.forEach((_, i) => { if (!G.hands[i].length && !G.deck.length && !G.out.includes(i)) G.out.push(i); });
  }
  function finished(G){
    const left = G.players.map((_, i) => i).filter(i => G.hands[i].length > 0);
    if (left.length > 1) return false;
    G.over = true;
    G.loser = left.length === 1 ? left[0] : -1;
    G.log = G.loser >= 0 ? `${G.players[G.loser].nick} — дурак! 🃏` : 'Ничья — карты кончились у всех сразу';
    return true;
  }
  // Бот: что сделать сейчас (или null — ждать)
  function botMove(G, p){
    const hand = G.hands[p], tr = G.trump, cheap = (a, b) => (suit(a) === tr) - (suit(b) === tr) || rv(a) - rv(b);
    if (p === G.defender) {
      if (G.taking) return null;
      const free = unbeaten(G);
      if (!free.length) return null;
      const t = free[0], a = G.table[t].a;
      const opts = hand.map((c, i) => ({ c, i })).filter(o => beats(o.c, a, tr)).sort((x, y) => cheap(x.c, y.c));
      if (!opts.length) return { a: 'take' };
      // не трать старший козырь в начале игры на мелочь
      if (suit(opts[0].c) === tr && suit(a) !== tr && G.deck.length > 8 && rv(opts[0].c) >= 5 && G.table.length <= 2) return { a: 'take' };
      return { a: 'beat', i: opts[0].i, t };
    }
    if (!attackersOf(G).includes(p)) return null;
    const throwable = hand.map((c, i) => ({ c, i })).filter(o => canThrow(G, p, o.c)).sort((x, y) => cheap(x.c, y.c));
    if (!G.table.length) return throwable.length ? { a: 'attack', i: throwable[0].i } : null;
    if (G.passed.includes(p)) return null;
    if (!G.taking && unbeaten(G).length) return null;
    const ok = throwable.filter(o => G.deck.length < 4 || (suit(o.c) !== tr && rv(o.c) <= 4));
    if (ok.length) return { a: 'attack', i: ok[0].i };
    return { a: 'pass' };
  }
  function pub(G){
    return { order: G.players.map((pl, i) => ({ id: pl.id, nick: pl.nick, bot: !!pl.bot, n: G.hands[i].length, out: G.out.includes(i), look: pl.look || null })),
      table: G.table.map(t => ({ a: t.a, d: t.d })), trump: G.trump, trumpCard: G.trumpCard, deckN: G.deck.length,
      attacker: G.attacker, defender: G.defender, taking: G.taking, passed: G.passed.slice(), limit: G.limit,
      over: G.over, loser: G.loser, log: G.log, v: G.v };
  }

  // ═══ ЭКРАН ═══
  let root, api, G = null, P = null, hand = [], meIdx = 0, mode = 'menu', room = null, timers = [], botT = 0, tickT = 0, nBots = 1, sel = -1, bots = 0, code = '';
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const online = () => !!room;
  const isHost = () => !room || room.isHost;
  const hostId = () => room?.seats[0]?.id;
  const red = c => suit(c) === 'h' || suit(c) === 'd';
  function cardHtml(c, i, o = {}){
    return `<button type="button" class="dk${red(c) ? ' red' : ''}${o.ok ? ' ok' : ''}${o.dim ? ' dim' : ''}${o.sel ? ' sel' : ''}${o.small ? ' sm' : ''}" ${i != null ? `data-act="card:${i}"` : ''} aria-label="${label(c)}"${o.disabled ? ' disabled' : ''}>
      <span class="dk-t">${RL[rank(c)] || rank(c)}<i>${SCH[suit(c)]}</i></span><span class="dk-m">${SCH[suit(c)]}</span></button>`;
  }

  function menu(){
    mode = 'menu'; G = null; P = null;
    const st = api.local();
    root.innerHTML = `<div class="dk-menu">
        <div class="dk-logo">${cardHtml('As', null)}${cardHtml('Kh', null)}${cardHtml('6d', null)}</div>
        <div class="un-title">Дурак</div>
        <div class="un-sub">Подкидной дурак на 36 карт. Отбивайся старшей картой или козырём, подкидывай карты того же достоинства. Не останься с картами последним!</div>
        <div class="un-bots">Ботов: ${[1, 2, 3].map(k => `<button type="button" class="un-n${k === nBots ? ' sel' : ''}" data-act="nb:${k}">${k}</button>`).join('')}</div>
        <div class="ct-actions"><button type="button" class="ct-start" data-act="solo">▶ Играть с ботами</button><button type="button" class="ct-duel-btn" data-act="online">👥 С друзьями онлайн</button></div>
        ${st.plays ? `<div class="un-sub">Партий: <b>${st.plays}</b> · не остался дураком: <b>${st.wins || 0}</b></div>` : ''}
        <details class="un-rules"><summary>Правила</summary>
          <p>Козырь — масть открытой карты под колодой. Первым ходит тот, у кого младший козырь.</p>
          <p>Отбиться — положить старшую карту той же масти или любой козырь (на козырь — только старший козырь).</p>
          <p>Остальные могут подкидывать карты того же достоинства, что уже на столе: не больше 6 за раунд.</p>
          <p>Не можешь отбиться — «Беру». Отбился — «Бито», и ты ходишь следующим. Потом все добирают до 6.</p>
          <p>Кто последним остался с картами — дурак.</p>
        </details>
      </div>`;
  }
  function startSolo(){
    const players = [{ id: 'me', nick: GameRoom.nick(), look: window.D37Char?.look() || null }];
    for (let i = 0; i < nBots; i++) players.push({ id: 'bot' + i, nick: BOTS[i], bot: true });
    G = newGame(players, Math.random);
    meIdx = 0; mode = 'play'; sel = -1;
    sync();
  }
  function sync(){
    if (!G) return;
    P = pub(G);
    hand = G.hands[meIdx].slice();
    if (room) G.players.forEach((pl, i) => { if (!pl.bot && pl.id !== room.myId) room.sendTo(pl.id, { type: 'up', pub: P, hand: G.hands[i] }); });
    render();
    schedule();
    if (G.over) over();
  }
  // Боты ходят по одному; люди онлайн — не дольше 25 с (иначе «беру»/«пас»/младшая карта)
  function schedule(){
    clearTimeout(botT); clearTimeout(tickT);
    if (!G || G.over || !isHost()) return;
    const v = G.v;
    const order = [G.defender, G.attacker, ...attackersOf(G)];
    for (const p of order) {
      if (!G.players[p].bot) continue;
      const m = botMove(G, p);
      if (!m) continue;
      botT = later(() => { if (G && G.v === v && !G.over) { act(G, p, m); sync(); } }, 700 + Math.random() * 600);
      return;
    }
    if (!room) return;
    tickT = later(() => {
      if (!G || G.v !== v || G.over) return;
      const p = G.defender;
      if (!G.players[p].bot && !G.taking && unbeaten(G).length) { act(G, p, { a: 'take' }); sync(); return; }
      if (!G.table.length) { const a = G.attacker, i = G.hands[a].findIndex(c => canThrow(G, a, c)); if (i >= 0) { act(G, a, { a: 'attack', i }); sync(); } return; }
      for (const q of attackersOf(G)) if (!G.passed.includes(q) && !G.players[q].bot) act(G, q, { a: 'pass' });
      sync();
    }, 25000);
  }
  function doAct(a){
    if (!P || P.over) return;
    if (isHost()) {
      const err = act(G, meIdx, a);
      if (err) { api.toast(err); return; }
      api.sfx(a.a === 'take' ? 'bad' : 'move');
      sel = -1;
      sync();
    } else {
      room.sendTo(hostId(), { type: 'act', act: a, v: P.v });
      sel = -1;
      api.sfx('tick');
    }
  }

  function render(){
    if (!P || mode !== 'play') return;
    const me = meIdx, isDef = P.defender === me, isAtt = !isDef && P.order[me].n > 0 && !P.over;
    const free = P.table.map((t, i) => t.d ? -1 : i).filter(i => i >= 0);
    const ranks = new Set(P.table.flatMap(t => t.d ? [rank(t.a), rank(t.d)] : [rank(t.a)]));
    const canThrowC = c => isAtt && P.table.length < P.limit && (P.table.length ? ranks.has(rank(c)) : P.attacker === me);
    const canBeatC = c => isDef && !P.taking && free.some(j => beats(c, P.table[j].a, P.trump));
    const okCard = c => canThrowC(c) || canBeatC(c);
    const passedMe = P.passed.includes(me);
    let status = '';
    if (P.over) status = '';
    else if (isDef) status = P.taking ? '🛡️ Ты берёшь — ждём, что подкинут' : free.length ? '🛡️ Отбивайся: нажми карту, которой бьёшь' : '🛡️ Отбился! Ждём, подкинут ли ещё';
    else if (!P.table.length) status = P.attacker === me ? '⚔️ Твой ход: положи любую карту' : `⏳ Ходит ${esc(P.order[P.attacker].nick)}…`;
    else if (passedMe) status = '⏳ Ждём остальных…';
    else status = P.taking ? `⚔️ ${esc(P.order[P.defender].nick)} берёт — можешь подкинуть` : free.length ? `⏳ ${esc(P.order[P.defender].nick)} отбивается…` : '⚔️ Подкинь карту или нажми «Бито»';
    const others = P.order.map((o, i) => ({ ...o, i })).filter(o => o.i !== me)
      .sort((a, b) => ((a.i - me + P.order.length) % P.order.length) - ((b.i - me + P.order.length) % P.order.length));
    root.innerHTML = `<div class="un dkg">
        <div class="un-opps">${others.map(o => `<div class="un-opp${(P.defender === o.i || (!P.table.length && P.attacker === o.i)) && !P.over ? ' turn' : ''}${o.out ? ' out' : ''}">
            ${o.bot ? '<span class="un-av">🤖</span>' : o.look && window.D37Char ? `<img class="un-av" alt="" src="${window.D37Char.img(o.look, 56)}">` : '<span class="un-av">🙂</span>'}
            <b>${esc(o.nick)}</b><span class="un-cnt">${o.out ? '✅ вышел' : `<i class="un-mini"></i>×${o.n}`}</span>
            <i class="dk-role">${P.defender === o.i ? '🛡️' : P.attacker === o.i ? '⚔️' : ''}</i></div>`).join('')}</div>
        <div class="dk-mid">
          <div class="dk-deck">${P.deckN ? `<div class="dk-trump">${cardHtml(P.trumpCard, null, { small: true })}</div><div class="dk-back"><b>${P.deckN}</b></div>` : ''}<div class="dk-tr">козырь <b class="${P.trump === 'h' || P.trump === 'd' ? 'redt' : ''}">${SCH[P.trump]}</b></div></div>
          <div class="dk-table">${P.table.length ? P.table.map(t => `<div class="dk-pair">${cardHtml(t.a, null, { small: true })}${t.d ? `<div class="dk-on">${cardHtml(t.d, null, { small: true })}</div>` : ''}</div>`).join('') : '<div class="dk-empty">Стол пуст</div>'}</div>
        </div>
        <div class="un-log" aria-live="polite">${esc(P.log)}</div>
        <div class="un-status">${status}</div>
        <div class="un-acts">
          ${isDef && !P.taking && free.length && !P.over ? '<button type="button" class="un-btn catch" data-act="take">🫴 Беру</button>' : ''}
          ${isAtt && P.table.length && !passedMe && (P.taking || !free.length) ? `<button type="button" class="un-btn" data-act="pass">${P.taking ? '✋ Пас' : '✅ Бито'}</button>` : ''}
        </div>
        <div class="un-hand dk-hand${hand.length > 9 ? ' many' : ''}">${hand.map((c, i) => cardHtml(c, i, { ok: okCard(c), dim: !okCard(c), sel: sel === i })).join('')}</div>
      </div>`;
  }
  function over(){
    clearTimeout(botT); clearTimeout(tickT);
    const fool = P.loser === meIdx, win = !fool;
    const st = root.querySelector('.un-status');
    if (st) st.innerHTML = P.loser < 0 ? '🤝 <b>Ничья</b>' : fool ? '🃏 <b>Ты остался дураком!</b>' : `🎉 <b>Ты не дурак!</b> Дурак — ${esc(P.order[P.loser].nick)}`;
    api.sfx(win ? 'win' : 'bad');
    const box = root.querySelector('.un-acts');
    if (box) box.innerHTML = (isHost() ? '<button type="button" class="ct-start" data-act="again">↻ Ещё партия</button>' : '<span class="un-sub">Ждём, пока хозяин начнёт новую…</span>')
      + `<button type="button" class="un-btn" data-act="leave">${online() ? '🚪 Выйти' : '🏠 Меню'}</button>`;
    if (mode === 'play') {
      mode = 'over';
      const prev = api.local();
      api.report(online() ? 'durak_online' : 'durak', win, win ? 1 : 0, (prev.wins || 0) + (win ? 1 : 0));
    }
  }

  function onClick(e){
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a.startsWith('nb:')) { nBots = +a.slice(3); menu(); return; }
    if (a === 'solo') { startSolo(); return; }
    if (a === 'online') { location.hash = '#/games/durak/' + GameRoom.newCode(); return; }
    if (a === 'again') { if (online()) hostStart(); else startSolo(); return; }
    if (a === 'leave') { if (online()) location.hash = '#/games/durak'; else menu(); return; }
    if (a === 'take') { doAct({ a: 'take' }); return; }
    if (a === 'pass') { doAct({ a: 'pass' }); return; }
    if (a.startsWith('card:')) {
      const i = +a.slice(5), c = hand[i];
      if (!c || !P) return;
      if (P.defender === meIdx) doAct({ a: 'beat', i });
      else doAct({ a: 'attack', i });
      return;
    }
    if (a === 'copy') { const inp = root.querySelector('.ct-link input'); navigator.clipboard?.writeText(inp.value).then(() => { b.textContent = '✅ Скопировано'; }, () => inp.select()); return; }
    if (a === 'bot') { bots++; lobby(); return; }
    if (a.startsWith('unbot:')) { bots = Math.max(0, bots - 1); lobby(); return; }
    if (a === 'go') { hostStart(); return; }
  }

  // ═══ ОНЛАЙН ═══
  function seatList(){
    const list = (room?.seats || []).map(s => ({ id: s.id, nick: s.nick, me: s.me, look: s.look })).slice(0, 4);
    for (let i = 0; i < bots && list.length < 4; i++) list.push({ id: 'bot' + i, nick: BOTS[i], bot: true });
    return list;
  }
  function lobby(){
    if (!room || mode === 'play' || mode === 'over') return;
    mode = 'lobby';
    const seats = seatList();
    root.innerHTML = TableRoom.lobbyHtml(location.origin + location.pathname + '#/games/durak/' + code, seats, 4, { title: '🃏 Дурак — стол', host: room.isHost, canStart: seats.length >= 2 });
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
    room = TableRoom.join('durak', c, {
      max: 4,
      onError: () => { root.innerHTML = GameRoom.errorHtml; },
      onFull: () => { root.innerHTML = GameRoom.fullHtml('durak'); },
      onSeats: seats => {
        if (mode === 'play' || mode === 'over') {
          if (room.isHost && G) {
            G.players.forEach(pl => { if (!pl.bot && pl.id !== room.myId && !seats.some(s => s.id === pl.id)) { pl.bot = true; G.log = `${pl.nick} вышел — за него играет бот`; pl.nick += ' (бот)'; G.v++; } });
            sync();
          } else if (!room.isHost && P && !seats.some(s => s.id === P.order[0]?.id)) { api.toast('Хозяин стола вышел'); mode = 'lobby'; P = null; lobby(); }
          return;
        }
        lobby();
      },
      onPrivate: (m, from) => {
        if (room.isHost) {
          if (m.type !== 'act' || !G) return;
          const p = G.players.findIndex(pl => pl.id === from && !pl.bot);
          if (p < 0) return;
          const err = act(G, p, m.act || {});
          if (err) { room.sendTo(from, { type: 'err', text: err }); return; }
          sync();
          return;
        }
        if (from !== hostId()) return;
        if (m.type === 'up') {
          const first = !P || mode !== 'play';
          P = m.pub; hand = m.hand || [];
          meIdx = P.order.findIndex(o => o.id === room.myId);
          if (meIdx < 0) return;
          if (first && !P.over) mode = 'play';
          render();
          if (P.over) over();
        } else if (m.type === 'err') api.toast(m.text);
      },
    });
    if (!room) root.innerHTML = GameRoom.errorHtml;
  }

  window.GAME_IMPL.durak = {
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
    _test: { newGame, act, botMove, beats, canThrow, pub, label, attackersOf, unbeaten },
  };
})();
