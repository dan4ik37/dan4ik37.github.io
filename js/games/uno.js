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

  // ═══ ВЫБОР КАРТЫ: нажал — поднялась, ещё раз / «Сходить» — ход; передумал — другая карта, «Отмена», мимо, Esc ═══
  // Чистая функция (проверяется в node): s = { pick, pickC, wild, arm } — выбранная карта (номер в руке и сама карта),
  // открыт выбор цвета, до какого времени колода ждёт второго нажатия; ev — что нажали; ctx = { hand, canPlay, myTurn, drew, now }.
  // Вернёт { s, act, msg }: act — ход для отправки (до него всё — только у себя, по сети ничего не уходит).
  const NOSEL = { pick: -1, pickC: '', wild: false, arm: 0 };
  function pickReduce(s, ev, ctx){
    const clear = { ...NOSEL };
    const valid = i => i >= 0 && !!ctx.myTurn && !!ctx.canPlay[i];
    // стол обновился: выбранная — та же карта и её ещё можно сыграть? колода ещё ждёт?
    const cur = s.pick >= 0 && (ctx.hand[s.pick] !== s.pickC || !valid(s.pick)) ? { ...clear, arm: s.arm } : { ...s };
    if (cur.arm && (ctx.now > cur.arm || !ctx.myTurn || ctx.drew)) cur.arm = 0;
    const confirm = c => colorOf(ctx.hand[c.pick]) ? { s: clear, act: { a: 'play', i: c.pick } } : { s: { ...c, wild: true, arm: 0 }, act: null };
    switch (ev.t) {
      case 'sync': return { s: cur, act: null };
      case 'card':
        if (!ctx.myTurn) return { s: cur, act: null, msg: 'wait' };
        if (!valid(ev.i)) return { s: { ...cur, arm: 0 }, act: null, msg: 'bad' };
        if (cur.pick === ev.i) return confirm(cur);
        return { s: { pick: ev.i, pickC: ctx.hand[ev.i], wild: false, arm: 0 }, act: null };
      case 'go': return cur.pick >= 0 ? confirm(cur) : { s: cur, act: null };
      case 'color': return cur.pick >= 0 && cur.wild && COLORS.includes(ev.c) ? { s: clear, act: { a: 'play', i: cur.pick, color: ev.c } } : { s: cur, act: null };
      case 'back': return { s: { ...cur, wild: false }, act: null };
      case 'cancel': case 'bg': return { s: clear, act: null };
      case 'esc': return { s: cur.wild ? { ...cur, wild: false } : clear, act: null };
      case 'deck':
        if (!ctx.myTurn || ctx.drew) return { s: cur, act: null };
        // есть чем ходить — колода сначала спрашивает «Точно взять?» (второе нажатие за 4 с)
        if (!ctx.canPlay.some(Boolean) || cur.arm) return { s: clear, act: { a: 'draw' } };
        return { s: { ...clear, arm: ctx.now + 4000 }, act: null, msg: 'arm' };
    }
    return { s: cur, act: null };
  }
  // Порядок карт в руке на экране: по цвету, внутри — по значению, дикие — в конце (в данных порядок свой)
  const ORDER_C = { r: 0, y: 1, g: 2, b: 3 }, ORDER_V = { S: 10, R: 11, D: 12, W: 20, F: 21 };
  const sortKey = c => (colorOf(c) ? ORDER_C[colorOf(c)] : 4) * 100 + (ORDER_V[valOf(c)] ?? +valOf(c));

  // ═══ ЭКРАН ═══
  const TURN_MS = 30000;   // онлайн: столько думает человек, потом ход за него
  let root, api, G = null, P = null, hand = [], meIdx = 0, mode = 'menu', room = null, timers = [], botT = 0, tickT = 0, nBots = 2, seatsCache = [];
  let S = { ...NOSEL }, armT = 0, turnUntil = 0, lastV = -1;
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const nickMe = () => GameRoom.nick();
  const online = () => !!room;
  const isHost = () => !room || room.isHost;

  function cardHtml(c, i, opts = {}){
    const col = colorOf(c), v = valOf(c);
    const label = SYM[v] || v;
    return `<button type="button" class="uc ${col ? 'c-' + col : 'c-w'}${opts.ok ? ' ok' : ''}${opts.dim ? ' dim' : ''}${opts.big ? ' big' : ''}${opts.sel ? ' sel' : ''}" ${i != null ? `data-act="play:${i}"` : ''} aria-label="${cardName(c)}"${opts.sel ? ' aria-pressed="true"' : ''}${opts.disabled ? ' disabled' : ''}>
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
    meIdx = 0; mode = 'play'; S = { ...NOSEL };
    sync();
  }

  // Хозяин: после любого изменения — всем публичное состояние, каждому его руку; боты ходят сами
  function sync(){
    if (!G) return;
    P = pub(G);
    hand = G.hands[meIdx].slice();
    if (room) G.players.forEach((pl, i) => { if (!pl.bot && pl.id !== room.myId) room.sendTo(pl.id, { type: 'up', pub: P, hand: G.hands[i] }); });
    scheduleBot();   // раньше рисования: отсчёт хода онлайн (turnUntil) уже свежий
    render();
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
    turnUntil = Date.now() + TURN_MS;
    tickT = later(() => {
      if (!G || G.turn !== p || G.v !== v) return;
      act(G, p, G.drew != null ? { a: 'pass' } : { a: 'draw' }, Date.now());
      if (G.turn === p && G.drew != null) act(G, p, { a: 'pass' }, Date.now());
      sync();
    }, TURN_MS);
  }

  // Свой ход (и у хозяина, и у гостя)
  function doAct(a){
    if (!P || P.winner >= 0) return;
    if (a.a === 'play' || a.a === 'draw' || a.a === 'pass') S = { ...NOSEL };   // «Одна!» и «Поймал» выбор не снимают
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

  const ctxOf = () => {
    const myTurn = !!P && P.turn === meIdx && P.winner < 0 && mode === 'play';
    return { hand, myTurn, drew: P?.drew != null, now: Date.now(), canPlay: myTurn ? hand.map((c, i) => (P.drew == null || i === P.drew) && playable(c, P.top, P.color)) : [] };
  };
  // Нажатие → новое состояние выбора; ход (если подтверждён) — отправить; потом перерисовать
  function pickEv(ev){
    if (!P || mode !== 'play') return;
    const r = pickReduce(S, ev, ctxOf());
    S = r.s;
    clearTimeout(armT);
    if (S.arm) armT = later(() => { if (S.arm && Date.now() >= S.arm) { S = { ...S, arm: 0 }; render(); } }, S.arm - Date.now() + 30);
    if (r.msg === 'bad') { api.sfx('bad'); root.querySelector('.uc[data-act="play:' + ev.i + '"]')?.classList.add('no'); setTimeout(() => render(), 260); return; }
    if (r.act) { doAct(r.act); return; }
    if (ev.t === 'card' && S.pick >= 0) api.sfx('tick');
    render();
  }

  function render(){
    if (!P || mode !== 'play') return;
    S = pickReduce(S, { t: 'sync' }, ctxOf()).s;   // стол обновился — выбор ещё в силе?
    const { myTurn, canPlay } = ctxOf();
    const others = P.order.map((o, i) => ({ ...o, i })).filter(o => o.i !== meIdx);
    // соперники — по кругу от меня
    others.sort((a, b) => ((a.i - meIdx + P.order.length) % P.order.length) - ((b.i - meIdx + P.order.length) % P.order.length));
    const exposedMe = P.exposed === meIdx;
    const canCatch = P.exposed >= 0 && P.exposed !== meIdx;
    const any = canPlay.some(Boolean), sel = S.pick >= 0;
    const order = hand.map((c, i) => i).sort((a, b) => sortKey(hand[a]) - sortKey(hand[b]) || a - b);
    const turnTxt = P.winner >= 0 ? '' : myTurn ? (P.drew != null ? '🃏 Сыграй взятую карту или пропусти ход' : '🟢 Твой ход') : `⏳ Ходит ${esc(P.order[P.turn].nick)}…`;
    const hint = P.winner >= 0 || !myTurn ? '' : S.arm ? '⚠️ Тебе есть чем ходить. Нажми колоду <b>ещё раз</b>, если всё равно берёшь'
      : sel ? `Нажми карту ещё раз или «Сходить». Передумал — другая карта или «Отмена»${online() ? ' · сходил — отменить нельзя' : ''}`
      : P.drew != null ? '' : any ? 'Нажми карту, которой хочешь сходить' : 'Нечем ходить — нажми колоду, возьми карту';
    const keep = root.querySelector('.un-hand')?.scrollLeft || 0;   // рука шире экрана — прокрутку не сбрасываем
    root.innerHTML = `<div class="un">
        <div class="un-opps">${others.map(o => `<div class="un-opp${P.turn === o.i ? ' turn' : ''}">
            ${o.bot ? '<span class="un-av">🤖</span>' : o.look && window.D37Char ? `<img class="un-av" alt="" src="${window.D37Char.img(o.look, 56)}">` : '<span class="un-av">🙂</span>'}
            <b>${esc(o.nick)}</b><span class="un-cnt"><i class="un-mini"></i>×${o.n}</span>${o.n === 1 && o.said ? '<i class="un-said">Одна!</i>' : ''}</div>`).join('')}</div>
        <div class="un-table">
          <button type="button" class="uc c-back un-deck${S.arm ? ' gk-armed' : ''}" data-act="draw"${myTurn && P.drew == null ? '' : ' disabled'} aria-label="${S.arm ? 'Точно взять карту?' : 'Взять карту'}"><span class="uc-c un-logo-t">${S.arm ? 'Взять?' : 'Одна!'}</span><small>${P.deckN}</small></button>
          <div class="un-top">${cardHtml(P.top, null, { big: true })}</div>
          <div class="un-info"><span class="un-dot c-${P.color}" title="Цвет: ${CNAME[P.color]}"></span><span class="un-dir">${P.dir > 0 ? '↻' : '↺'}</span></div>
        </div>
        <div class="un-log" aria-live="polite">${esc(P.log)}</div>
        <div class="un-status">${turnTxt ? (window.GameKit ? GameKit.turn(myTurn, turnTxt) : turnTxt) : ''}${online() && myTurn ? `<span class="gk-cd" data-gk-cd="${turnUntil}"></span>` : ''}</div>
        <div class="un-acts">
          ${sel ? `<button type="button" class="un-btn gk-go" data-act="commit">${colorOf(hand[S.pick]) ? '✅ Сходить' : '🎨 Выбрать цвет'}</button><button type="button" class="un-btn" data-act="cancel">✕ Отмена</button>` : ''}
          ${hand.length <= 2 && !P.order[meIdx].said && P.winner < 0 ? `<button type="button" class="un-btn uno${exposedMe ? ' urgent' : ''}" data-act="uno">📢 Одна!</button>` : ''}
          ${canCatch ? `<button type="button" class="un-btn catch" data-act="catch">🫵 Поймал ${esc(P.order[P.exposed].nick)}!</button>` : ''}
          ${myTurn && P.drew != null && !sel ? '<button type="button" class="un-btn" data-act="pass">Пропустить ход</button>' : ''}
        </div>
        <div class="gk-hint">${hint}</div>
        <div class="un-hand${myTurn ? ' my' : ''}${hand.length > 9 ? ' many' : ''}${sel ? ' picking' : ''}">${order.map(i => cardHtml(hand[i], i, { ok: canPlay[i], dim: myTurn && !canPlay[i], sel: S.pick === i })).join('')}</div>
        <div class="un-wild"${S.wild && sel ? '' : ' hidden'}><div class="un-wt">Выбери цвет</div><div class="un-wc">${COLORS.map(c => `<button type="button" class="un-dot big c-${c}" data-act="color:${c}" aria-label="${CNAME[c]}"></button>`).join('')}</div>
          <button type="button" class="un-btn" data-act="back">← Назад — выбрать другую карту</button></div>
      </div>`;
    const h = root.querySelector('.un-hand');
    if (h && keep) h.scrollLeft = keep;
    window.GameKit?.cd();
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
    if (!b || b.disabled) {
      // нажал мимо карт и кнопок: в окне цвета — «назад», на столе — снять выбор
      if (mode === 'play' && (S.pick >= 0 || S.arm) && !e.target.closest('.un-hand')) pickEv({ t: S.wild ? 'back' : 'bg' });
      return;
    }
    const a = b.dataset.act;
    if (a.startsWith('nb:')) { nBots = +a.slice(3); menu(); return; }
    if (a === 'solo') { startSolo(); return; }
    if (a === 'online') { location.hash = '#/games/uno/' + GameRoom.newCode(); return; }
    if (a === 'again') { if (online()) hostStart(); else startSolo(); return; }
    if (a === 'leave') { if (online()) location.hash = '#/games/uno'; else menu(); return; }
    if (a === 'draw') { pickEv({ t: 'deck' }); return; }
    if (a === 'pass') { doAct({ a: 'pass' }); return; }
    if (a === 'uno') { doAct({ a: 'uno' }); return; }
    if (a === 'catch') { doAct({ a: 'catch' }); return; }
    if (a.startsWith('play:')) { pickEv({ t: 'card', i: +a.slice(5) }); return; }
    if (a === 'commit') { pickEv({ t: 'go' }); return; }   // «Сходить» (не 'go' — это «▶ Начать» за столом)
    if (a === 'cancel' || a === 'back') { pickEv({ t: a }); return; }
    if (a.startsWith('color:')) { pickEv({ t: 'color', c: a.slice(6) }); return; }
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
    mode = 'play'; S = { ...NOSEL };
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
          if (first && P.winner < 0) { mode = 'play'; S = { ...NOSEL }; }
          if (P.v !== lastV) { lastV = P.v; turnUntil = Date.now() + TURN_MS - 600; }   // хозяин заводит отсчёт на каждое изменение стола
          render();
          if (P.winner >= 0) over();
        } else if (m.type === 'err') api.toast(m.text);
      },
    });
    if (!room) root.innerHTML = GameRoom.errorHtml;
  }

  // Esc — закрыть выбор цвета / снять выбор карты (раньше выхода из полного экрана: он смотрит defaultPrevented)
  function onKey(e){
    if (e.key !== 'Escape' || mode !== 'play' || window.GameKit?.isOpen?.() || !(S.pick >= 0 || S.arm)) return;
    e.preventDefault();
    pickEv({ t: 'esc' });
  }

  window.GAME_IMPL.uno = {
    mount(el, gameApi){
      root = el; api = gameApi; S = { ...NOSEL }; lastV = -1;
      root.addEventListener('click', onClick);
      window.addEventListener('keydown', onKey, true);
      if (GameRoom.validCode(gameApi.param)) joinTable(gameApi.param); else menu();
    },
    unmount(){
      timers.forEach(clearTimeout); timers = [];
      clearTimeout(botT); clearTimeout(tickT); clearTimeout(armT);
      root?.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey, true);
      room?.leave(); room = null;
      G = null; P = null; hand = []; bots = 0; mode = 'menu'; S = { ...NOSEL };
      root = null;
    },
    _test: { deck, newGame, act, botMove, playable, pub, points, colorOf, valOf, pickReduce, sortKey, NOSEL },
  };
})();
