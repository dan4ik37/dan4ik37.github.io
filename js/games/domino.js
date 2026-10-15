// ═══════════════════════════════════════
//  «ДОМИНО» («Козёл») — 2–4 игрока: с ботами или онлайн с друзьями (стол js/games/table.js)
// ═══════════════════════════════════════
// 28 костяшек (0–0 … 6–6), каждому по 7, остальное — «базар». Первый ход раунда — у кого 1–1 (нет — 2–2 … 6–6, 0–0; дублей нет —
// самая маленькая костяшка), дальше раунды начинает победитель прошлого. Ход — приставить костяшку к концу цепочки по числу
// точек. Нечем ходить — бери из базара по одной, пока не найдёшь (режим «без базара» — сразу пропуск); базар пуст — пропуск.
// Раунд: кто первым выложил все костяшки — получает сумму очков в руках соперников; «рыба» (никто не может сходить) — побеждает
// тот, у кого меньше очков в руке (поровну — никто). Игра — до 51 или 101: набравший — победитель, меньше всех — «козёл» 🐐.
// Ход в два касания: костяшка → (конец цепочки, если подходит к обоим) → «Сходить» или ещё раз нажать; «Отмена», нажатие мимо,
// Esc — передумал (отмены хода нет: базар и ответы соперников уже видны — как в картах, docs/GAMES_UX.md).
// Онлайн — стол на 2–4 (хозяин сдаёт и проверяет ходы, всё — шифром sendTo; ушёл игрок — за него бот; думает > 30 с — ход за
// него). Ключи: domino (с ботами), domino_online; очки — набранные за игру. Движок — GAME_IMPL.domino._test.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const TILES = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) TILES.push([a, b]);
  const BOTS = ['Бот Федя', 'Бот Нина', 'Бот Гена'];
  const TURN_MS = 30000;
  const pips = t => TILES[t][0] + TILES[t][1];
  const isDbl = t => TILES[t][0] === TILES[t][1];
  const has = (t, v) => TILES[t][0] === v || TILES[t][1] === v;
  const other = (t, v) => (TILES[t][0] === v ? TILES[t][1] : TILES[t][0]);
  const handPips = h => h.reduce((s, t) => s + pips(t), 0);
  function shuffle(a, rand){ for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // ═══ ПРАВИЛА (чистые функции) ═══
  // o: { target: 51 | 101, yard: true (с базаром) | false (без) }
  function newGame(players, rand, o = {}){
    const G = { players, n: players.length, sc: players.map(() => 0), target: o.target === 101 ? 101 : 51, yard: o.yard !== false,
      round: 0, starter: -1, over: false, winner: -1, rand, v: 0, gid: Math.floor(rand() * 1e9) };
    deal(G);
    return G;
  }
  function deal(G){
    const ids = shuffle(TILES.map((_, i) => i), G.rand);
    G.hands = G.players.map((_, i) => ids.slice(i * 7, i * 7 + 7));
    const rest = ids.slice(G.n * 7);
    G.bazar = G.yard ? rest : [];
    G.sleep = G.yard ? 0 : rest.length;
    G.line = []; G.c = 0;
    G.passes = 0; G.rover = false; G.res = null; G.must = -1;
    G.round++;
    if (G.round === 1 || G.starter < 0) {
      // самый маленький дубль (1–1 … 6–6, потом 0–0); дублей нет — самая маленькая костяшка
      const order = [1, 2, 3, 4, 5, 6, 0].map(v => TILES.findIndex(t => t[0] === v && t[1] === v));
      let who = -1, tile = -1;
      for (const t of order) { const p = G.hands.findIndex(h => h.includes(t)); if (p >= 0) { who = p; tile = t; break; } }
      if (who < 0) {
        let best = 99;
        G.hands.forEach((h, p) => h.forEach(t => { const k = pips(t) * 10 + TILES[t][0]; if (k < best) { best = k; who = p; tile = t; } }));
      }
      G.turn = who; G.must = tile; G.starter = who;
    } else { G.turn = G.starter; }
    G.log = G.round === 1 ? `Первым ходит ${G.players[G.turn].nick}${G.must >= 0 ? ` — с ${TILES[G.must].join('–')}` : ''}` : `Раунд ${G.round}: начинает ${G.players[G.turn].nick}`;
    G.v++;
  }
  const ends = G => (G.line.length ? [G.line[0].a, G.line[G.line.length - 1].b] : null);
  // Куда можно положить костяшку t: [] | ['C'] (первая) | ['L'] | ['R'] | ['L','R']
  function sidesFor(G, t){
    if (!G.line.length) return G.must < 0 || G.must === t ? ['C'] : [];
    const [l, r] = ends(G), s = [];
    if (has(t, l)) s.push('L');
    if (has(t, r)) s.push('R');
    if (s.length === 2 && l === r) return ['R'];   // оба конца одинаковые — всё равно, куда
    return s;
  }
  const playable = (G, p) => G.hands[p].filter(t => sidesFor(G, t).length);
  const canDraw = (G, p) => G.yard && G.bazar.length > 0 && !playable(G, p).length;
  const canPass = (G, p) => !playable(G, p).length && !(G.yard && G.bazar.length > 0);
  // Ход игрока p: { a: 'play', t, side } | { a: 'draw' } | { a: 'pass' }. Вернёт текст ошибки или null
  function act(G, p, a){
    if (G.over || G.rover) return 'Раунд окончен';
    if (p !== G.turn) return 'Сейчас ходит другой игрок';
    const nick = G.players[p].nick, hand = G.hands[p];
    if (a.a === 'play') {
      const t = a.t | 0, i = hand.indexOf(t);
      if (i < 0) return 'Нет такой костяшки';
      const sides = sidesFor(G, t);
      if (!sides.length) return G.must >= 0 && !G.line.length ? `Первый ход — ${TILES[G.must].join('–')}` : 'Эта костяшка не подходит';
      const side = sides.includes(a.side) ? a.side : sides.length === 1 ? sides[0] : null;
      if (!side) return 'Выбери, к какому концу';
      hand.splice(i, 1);
      if (side === 'C') G.line.push({ t, a: TILES[t][0], b: TILES[t][1] });
      else if (side === 'L') { const l = G.line[0].a; G.line.unshift({ t, a: other(t, l), b: l }); G.c++; }
      else { const r = G.line[G.line.length - 1].b; G.line.push({ t, a: r, b: other(t, r) }); }
      G.must = -1; G.passes = 0;
      G.log = `${nick}: ${TILES[t].join('–')}`;
      if (!hand.length) { endRound(G, p, false); G.v++; return null; }
      G.turn = (p + 1) % G.n;
    } else if (a.a === 'draw') {
      if (!canDraw(G, p)) return G.yard && G.bazar.length ? 'Есть чем ходить' : 'Базар пуст';
      hand.push(G.bazar.shift());
      G.log = `${nick} берёт из базара`;
    } else if (a.a === 'pass') {
      if (!canPass(G, p)) return playable(G, p).length ? 'Есть чем ходить' : 'Сначала возьми из базара';
      G.passes++;
      G.log = `${nick} пропускает ход`;
      if (G.passes >= G.n) { fish(G); G.v++; return null; }
      G.turn = (p + 1) % G.n;
    } else return 'Непонятный ход';
    G.v++;
    return null;
  }
  // «Рыба»: никто не может сходить — побеждает тот, у кого меньше очков в руке (поровну — никто)
  function fish(G){
    const sums = G.hands.map(handPips), min = Math.min(...sums), who = sums.filter(s => s === min).length === 1 ? sums.indexOf(min) : -1;
    endRound(G, who, true);
  }
  function endRound(G, p, isFish){
    const sums = G.hands.map(handPips);
    const pts = p >= 0 ? sums.reduce((s, x, i) => s + (i === p ? 0 : x), 0) : 0;
    if (p >= 0) G.sc[p] += pts;
    G.rover = true;
    G.res = { p, pts, fish: isFish, sums };
    G.log = p < 0 ? '🐟 Рыба! Поровну — очков никто не получил' : `${isFish ? '🐟 Рыба! ' : ''}${G.players[p].nick} ${isFish ? 'выигрывает раунд' : 'выложил все костяшки'}: +${pts}`;
    if (p >= 0) G.starter = p;
    if (p >= 0 && G.sc[p] >= G.target) { G.over = true; G.winner = p; G.log += ' — победа в игре!'; }
  }
  function nextRound(G){ if (G.rover && !G.over) deal(G); }
  // «Козёл» — у кого меньше всех очков в конце игры
  const goats = G => { const m = Math.min(...G.sc); return G.sc.map((s, i) => (s === m ? i : -1)).filter(i => i >= 0); };

  // ═══ Бот: лёгкий — любую подходящую; обычный — выгодную ═══
  // Обычный: тяжёлые костяшки и дубли — раньше; оставляет на концах числа, которых у него много, а у следующего игрока нет
  // (он брал из базара или пропускал на этих числах — запоминаем в G.miss)
  function botMove(G, p, level = 'normal', rand = Math.random){
    const plays = [];
    for (const t of G.hands[p]) for (const side of sidesFor(G, t)) plays.push({ a: 'play', t, side });
    if (!plays.length) return canDraw(G, p) ? { a: 'draw' } : { a: 'pass' };
    if (level === 'easy') return plays[Math.floor(rand() * plays.length)];
    const next = (p + 1) % G.n, miss = G.miss?.[next] || [];
    let best = plays[0], bv = -1e9;
    for (const m of plays) {
      const rest = G.hands[p].filter(t => t !== m.t);
      const e = ends(G);
      let nl, nr;
      if (!e) { nl = TILES[m.t][0]; nr = TILES[m.t][1]; }
      else if (m.side === 'L') { nl = other(m.t, e[0]); nr = e[1]; }
      else { nl = e[0]; nr = other(m.t, e[1]); }
      const mine = rest.filter(t => has(t, nl) || has(t, nr)).length;
      let v = pips(m.t) * .6 + (isDbl(m.t) ? 4 : 0) + mine * 1.6;
      if (miss.includes(nl)) v += 2.5;
      if (miss.includes(nr)) v += 2.5;
      if (!rest.length) v += 100;
      v += rand() * .3;
      if (v > bv) { bv = v; best = m; }
    }
    return best;
  }
  // Запомнить, на каких числах игрок не смог сходить (для бота)
  function noteMiss(G, p){
    const e = ends(G);
    if (!e) return;
    G.miss = G.miss || G.players.map(() => []);
    for (const v of e) if (!G.miss[p].includes(v)) G.miss[p].push(v);
  }
  function pub(G){
    return { gid: G.gid, players: G.players.map((pl, i) => ({ id: pl.id, nick: pl.nick, bot: !!pl.bot, n: G.hands[i].length, look: pl.look || null })),
      line: G.line.map(x => ({ t: x.t, a: x.a, b: x.b })), c: G.c, bazar: G.bazar.length, sleep: G.sleep, turn: G.turn, sc: G.sc.slice(), target: G.target, yard: G.yard,
      must: G.must, round: G.round, rover: G.rover, over: G.over, winner: G.winner, res: G.res && { ...G.res, hands: G.rover ? G.hands.map(h => h.slice()) : null }, log: G.log, v: G.v, passes: G.passes };
  }

  // ═══ Выбор хода: нажал — поднялась; ещё раз / «Сходить» / конец цепочки — ход; другая, «Отмена», мимо, Esc — передумал ═══
  // Чистая функция: s = { pick, side }, ctx = { hand, sides(t) → [] }. Вернёт { s, act, msg }; до act всё только у себя.
  const NOSEL = { pick: -1, side: '' };
  function pickReduce(s, ev, ctx){
    const clear = { ...NOSEL };
    let cur = s.pick >= 0 && (!ctx.hand.includes(s.pick) || !ctx.sides(s.pick).length) ? { ...clear } : { ...s };
    if (cur.pick >= 0 && cur.side && !ctx.sides(cur.pick).includes(cur.side)) cur.side = '';
    const confirm = c => {
      const sd = ctx.sides(c.pick);
      const side = c.side || (sd.length === 1 ? sd[0] : '');
      return side ? { s: clear, act: { a: 'play', t: c.pick, side } } : { s: c, act: null, msg: 'side' };
    };
    switch (ev.t) {
      case 'sync': return { s: cur, act: null };
      case 'tile': {
        const sd = ctx.sides(ev.tile);
        if (!sd.length) return { s: cur, act: null, msg: 'bad' };
        if (cur.pick === ev.tile) return confirm(cur);
        return { s: { pick: ev.tile, side: sd.length === 1 ? sd[0] : '' }, act: null };
      }
      case 'end': {
        if (cur.pick < 0) return { s: cur, act: null, msg: 'pick' };
        if (!ctx.sides(cur.pick).includes(ev.side)) return { s: cur, act: null, msg: 'bad' };
        return { s: clear, act: { a: 'play', t: cur.pick, side: ev.side } };
      }
      case 'go': return cur.pick >= 0 ? confirm(cur) : { s: cur, act: null };
      case 'cancel': case 'bg': case 'esc': return { s: clear, act: null };
    }
    return { s: cur, act: null };
  }

  // ═══ Раскладка цепочки «змейкой»: от первой костяшки влево и вправо, у края поля — поворот (вниз справа, вверх слева) ═══
  // Единица — ширина костяшки; костяшка 2×1, дубль — поперёк (1×2), кроме сразу после поворота. Вернёт прямоугольники
  // { x, y, w, h, v1, v2 } (v1 — левая/верхняя половина) по номерам цепочки. half — полуширина поля в единицах.
  function layout(line, c, half){
    const out = new Array(line.length);
    if (!line.length) return out;
    const ce = line[c], cd = ce.a === ce.b;
    out[c] = cd ? { x: -.5, y: -1, w: 1, h: 2, v1: ce.a, v2: ce.b } : { x: -1, y: -.5, w: 2, h: 1, v1: ce.a, v2: ce.b };
    for (const dir of [1, -1]) {
      let d = dir, vdir = dir, x = (cd ? .5 : 1) * dir, y = 0, edge = cd ? 1 : .5, afterTurn = false;
      for (let k = c + dir; k >= 0 && k < line.length; k += dir) {
        const t = line[k], near = dir > 0 ? t.a : t.b, far = dir > 0 ? t.b : t.a, dbl = t.a === t.b;
        const cross = dbl && !afterTurn, len = cross ? 1 : 2;
        const fits = d > 0 ? x + len <= half + 1e-9 : x - len >= -half - 1e-9;
        if (!fits) {
          const vx = d > 0 ? x - 1 : x, y0 = y + vdir * edge;
          out[k] = { x: vx, y: vdir > 0 ? y0 : y0 - 2, w: 1, h: 2, v1: vdir > 0 ? near : far, v2: vdir > 0 ? far : near };
          y = y0 + vdir * 2.5; d = -d; edge = .5; afterTurn = true;
          continue;
        }
        if (cross) out[k] = { x: d > 0 ? x : x - 1, y: y - 1, w: 1, h: 2, v1: near, v2: far };
        else out[k] = { x: d > 0 ? x : x - 2, y: y - .5, w: 2, h: 1, v1: d > 0 ? near : far, v2: d > 0 ? far : near };
        x += d * len; edge = cross ? 1 : .5; afterTurn = false;
      }
    }
    return out;
  }
  // Где встанет костяшка t у конца side (для «призрака» на поле)
  function ghostRect(line, c, half, t, side){
    if (!line.length) { const tt = { t, a: TILES[t][0], b: TILES[t][1] }; return layout([tt], 0, half)[0]; }
    if (side === 'L') { const l = line[0].a, g = { t, a: other(t, l), b: l }; return layout([g, ...line], c + 1, half)[0]; }
    const r = line[line.length - 1].b, g = { t, a: r, b: other(t, r) };
    return layout([...line, g], c, half)[line.length];
  }

  // ═══ ЭКРАН ═══
  let rootEl = null, api = null, G = null, P = null, hand = [], meIdx = 0, mode = 'menu', room = null, timers = [], botT = 0, tickT = 0, bots = 0, code = '';
  let S = { ...NOSEL }, turnUntil = 0, lastV = -1, keyOn = false, reported = 0;
  let opts = { bots: 1, target: 51, yard: true, level: 'normal' };
  try { Object.assign(opts, JSON.parse(localStorage.getItem('d37_domino_opts') || '{}')); } catch (e) {}
  const saveOpts = () => { try { localStorage.setItem('d37_domino_opts', JSON.stringify(opts)); } catch (e) {} };
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const online = () => !!room;
  const isHost = () => !room || room.isHost;
  const hostId = () => room?.seats[0]?.id;
  const esc0 = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const E = s => (typeof esc === 'function' ? esc(s) : esc0(s));
  const ru = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many);
  const PIP = { 0: [], 1: [[.5, .5]], 2: [[.27, .27], [.73, .73]], 3: [[.25, .25], [.5, .5], [.75, .75]], 4: [[.27, .27], [.73, .27], [.27, .73], [.73, .73]],
    5: [[.25, .25], [.75, .25], [.5, .5], [.25, .75], [.75, .75]], 6: [[.27, .22], [.73, .22], [.27, .5], [.73, .5], [.27, .78], [.73, .78]] };
  // Костяшка в SVG: x, y, w, h — в единицах; v1/v2 — половины (лево/верх и право/низ)
  function tileSvg(r, o = {}){
    const vert = r.h > r.w, pad = .05;
    let s = `<g class="dn-t${o.cls ? ' ' + o.cls : ''}"${o.act ? ` data-act="${o.act}"` : ''}><rect x="${r.x + pad}" y="${r.y + pad}" width="${r.w - pad * 2}" height="${r.h - pad * 2}" rx=".16" class="dn-tb"/>`;
    s += vert ? `<line x1="${r.x + .18}" y1="${r.y + 1}" x2="${r.x + r.w - .18}" y2="${r.y + 1}" class="dn-tl"/>` : `<line x1="${r.x + 1}" y1="${r.y + .18}" x2="${r.x + 1}" y2="${r.y + r.h - .18}" class="dn-tl"/>`;
    for (const [half, v] of [[0, r.v1], [1, r.v2]]) {
      const ox = vert ? r.x : r.x + half, oy = vert ? r.y + half : r.y;
      for (const [px, py] of PIP[v] || []) {
        // у горизонтальной костяшки точки повёрнуты (шестёрка — рядами вдоль)
        const [qx, qy] = vert ? [px, py] : [py, px];
        s += `<circle cx="${(ox + .08 + qx * .84).toFixed(3)}" cy="${(oy + .08 + qy * .84).toFixed(3)}" r=".085" class="dn-p"/>`;
      }
    }
    return s + '</g>';
  }
  const handTileSvg = (t, o = {}) => `<svg viewBox="0 0 1 2" aria-hidden="true">${tileSvg({ x: 0, y: 0, w: 1, h: 2, v1: TILES[t][0], v2: TILES[t][1] }, o)}</svg>`;

  function menu(){
    leave();
    mode = 'menu';
    const st = api.local();
    rootEl.innerHTML = `<div class="dn dn-menu">
      <div class="dn-logo">${[[6, 6], [6, 3], [3, 1]].map(([a, b], i) => `<span style="--r:${(i - 1) * 12}deg">${handTileSvg(TILES.findIndex(t => t[0] === Math.min(a, b) && t[1] === Math.max(a, b)))}</span>`).join('')}</div>
      <div class="un-title">Домино</div>
      <div class="un-sub">Классический «Козёл»: приставляй костяшки по числу точек, первым избавься от своих и собирай очки соперников. Набравший меньше всех — козёл 🐐</div>
      <div class="ct-row dn-row"><span>Ботов</span><span class="ct-opts">${[1, 2, 3].map(k => `<button type="button" class="ct-opt${k === opts.bots ? ' active' : ''}" data-act="nb:${k}">${k}</button>`).join('')}</span></div>
      <div class="ct-row dn-row"><span>Боты</span><span class="ct-opts"><button type="button" class="ct-opt${opts.level === 'easy' ? ' active' : ''}" data-act="lv:easy">Простые</button><button type="button" class="ct-opt${opts.level !== 'easy' ? ' active' : ''}" data-act="lv:normal">Хитрые</button></span></div>
      <div class="ct-row dn-row"><span>Игра до</span><span class="ct-opts"><button type="button" class="ct-opt${opts.target === 51 ? ' active' : ''}" data-act="tg:51">51 очка</button><button type="button" class="ct-opt${opts.target === 101 ? ' active' : ''}" data-act="tg:101">101 очка</button></span></div>
      <div class="ct-row dn-row"><span>Базар</span><span class="ct-opts"><button type="button" class="ct-opt${opts.yard ? ' active' : ''}" data-act="yd:1">С базаром</button><button type="button" class="ct-opt${!opts.yard ? ' active' : ''}" data-act="yd:0">Без базара</button></span></div>
      <div class="ct-actions"><button type="button" class="ct-start" data-act="solo">▶ Играть с ботами</button><button type="button" class="ct-duel-btn" data-act="online">👥 С друзьями онлайн</button></div>
      ${st.plays ? `<div class="un-sub">Игр: <b>${st.plays}</b> · побед: <b>${st.wins || 0}</b>${st.best ? ` · лучший счёт: <b>${st.best}</b>` : ''}</div>` : ''}
      <details class="un-rules"><summary>Правила</summary>
        <p>28 костяшек, у каждого по 7, остальные — «базар». Первым ходит тот, у кого 1–1 (нет — 2–2, 3–3…).</p>
        <p>Ход — приставь к концу цепочки костяшку с тем же числом точек. Нечем ходить — бери из базара по одной, пока не найдёшь подходящую; базар пуст — пропусти ход.</p>
        <p>Выложил все костяшки — раунд твой: получаешь все очки из рук соперников. Никто не может сходить — «рыба»: раунд выигрывает тот, у кого в руке меньше очков.</p>
        <p>Кто первым набрал ${opts.target} — победил. У кого меньше всех очков — «козёл» 🐐.</p>
      </details>
    </div>`;
  }
  function startSolo(){
    leave();
    const players = [{ id: 'me', nick: root.GameRoom?.nick?.() || 'Ты', look: root.D37Char?.look?.() || null }];
    for (let i = 0; i < opts.bots; i++) players.push({ id: 'bot' + i, nick: BOTS[i], bot: true, lv: opts.level });
    G = newGame(players, Math.random, { target: opts.target, yard: opts.yard });
    meIdx = 0; mode = 'play'; S = { ...NOSEL }; reported = 0;
    build(); sync();
  }
  function sync(){
    if (!G) return;
    P = pub(G);
    trackLast(P);
    hand = G.hands[meIdx].slice();
    if (room) G.players.forEach((pl, i) => { if (!pl.bot && pl.id !== room.myId) room.sendTo(pl.id, { type: 'up', pub: P, hand: G.hands[i] }); });
    schedule();
    render();
  }
  // Боты ходят по одному; человек онлайн думает до 30 с, потом ход за него (лучший ход бота)
  function schedule(){
    clearTimeout(botT); clearTimeout(tickT);
    if (!G || !isHost()) return;
    const v = G.v;
    if (G.over) return;
    if (G.rover) { botT = later(() => { if (G && G.v === v && G.rover && !G.over) { nextRound(G); sync(); } }, room ? 6000 : 4500); return; }
    const p = G.turn, pl = G.players[p];
    if (pl.bot) {
      botT = later(() => {
        if (!G || G.v !== v || G.rover) return;
        const m = botMove(G, p, pl.lv || 'normal');
        if (m.a !== 'play') noteMiss(G, p);
        act(G, p, m);
        sync();
      }, 650 + Math.random() * 500);
      return;
    }
    if (!room) return;
    turnUntil = Date.now() + TURN_MS;
    tickT = later(() => {
      if (!G || G.v !== v || G.rover) return;
      const m = botMove(G, p, 'normal');
      if (m.a !== 'play') noteMiss(G, p);
      act(G, p, m);
      sync();
    }, TURN_MS);
  }
  function doAct(a){
    if (!P || P.over || P.rover) return;
    if (isHost()) {
      if (a.a !== 'play') noteMiss(G, meIdx);
      const err = act(G, meIdx, a);
      if (err) { api.toast(err); return; }
      api.sfx(a.a === 'play' ? 'move' : 'tick');
      sync();
    } else {
      room.sendTo(hostId(), { type: 'act', act: a, v: P.v });
      api.sfx('tick');
    }
  }
  // Ход по выбору (pickReduce)
  function selCtx(){
    const mine = P && P.turn === meIdx && !P.over && !P.rover;
    const sidesF = t => (mine && hand.includes(t) ? sidesP(P, t) : []);
    return { hand, sides: sidesF };
  }
  // То же, что sidesFor, но по публичному состоянию (у гостя нет G)
  function sidesP(p, t){
    if (!p.line.length) return p.must < 0 || p.must === t ? ['C'] : [];
    const l = p.line[0].a, r = p.line[p.line.length - 1].b, s = [];
    if (has(t, l)) s.push('L');
    if (has(t, r)) s.push('R');
    if (s.length === 2 && l === r) return ['R'];
    return s;
  }
  function pickEv(ev){
    const r = pickReduce(S, ev, selCtx());
    S = r.s;
    if (r.msg === 'bad') { api.sfx('bad'); hint(ev.t === 'tile' ? 'Эта костяшка сейчас не подходит' : 'Сюда эту костяшку не положить'); }
    else if (r.msg === 'side') hint('Подходит к обоим концам — нажми подсвеченный конец на поле или «◀» / «▶»');
    else if (r.msg === 'pick') hint('Сначала выбери костяшку в руке');
    if (r.act) doAct(r.act);
    render();
  }
  let hintTxt = '', hintT = 0;
  function hint(t){ hintTxt = t; clearTimeout(hintT); hintT = later(() => { hintTxt = ''; render(); }, 3500); }

  // ── Разметка ──
  function build(){
    rootEl.innerHTML = `<div class="dn dn-game">
      <div class="un-opps dn-opps"></div>
      <div class="dn-board"><svg class="dn-svg" preserveAspectRatio="xMidYMid meet"></svg><div class="dn-res" hidden></div></div>
      <div class="dn-info"><span class="dn-bz"></span><span class="un-log dn-log" aria-live="polite"></span></div>
      <div class="un-status dn-status"></div>
      <div class="un-acts dn-acts"></div>
      <div class="gk-hint dn-hint"></div>
      <div class="dn-hand" role="listbox" aria-label="Мои костяшки"></div>
      <div class="dn-me"></div>
    </div>`;
    rootEl.querySelector('.dn-board').addEventListener('click', e => {
      const g = e.target.closest('[data-act]');
      if (g) return;   // кнопки разберёт onClick
      if (S.pick >= 0) pickEv({ t: 'bg' });
    });
  }
  const halfW = () => (rootEl?.querySelector('.dn-board')?.clientWidth || 600) < 520 ? 6.5 : 9;
  function render(){
    if (!P || !rootEl?.querySelector('.dn-svg')) return;
    S = pickReduce(S, { t: 'sync' }, selCtx()).s;
    const me = meIdx, mine = P.turn === me && !P.over && !P.rover;
    // соперники
    const others = P.players.map((o, i) => ({ ...o, i })).filter(o => o.i !== me)
      .sort((a, b) => ((a.i - me + P.players.length) % P.players.length) - ((b.i - me + P.players.length) % P.players.length));
    rootEl.querySelector('.dn-opps').innerHTML = others.map(o => `<div class="un-opp${P.turn === o.i && !P.rover && !P.over ? ' turn' : ''}">
        ${o.bot ? '<span class="un-av">🤖</span>' : o.look && root.D37Char ? `<img class="un-av" alt="" src="${root.D37Char.img(o.look, 56)}">` : '<span class="un-av">🙂</span>'}
        <b>${E(o.nick)}</b><span class="un-cnt"><i class="dn-mini"></i>×${o.n} · <i class="dn-sc">${P.sc[o.i]}</i></span></div>`).join('');
    // поле
    const half = halfW(), svg = rootEl.querySelector('.dn-svg');
    const rects = layout(P.line, P.c, half);
    let body = '', minX = -half, maxX = half, minY = -1.6, maxY = 1.6;
    const grow = r => { minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x + r.w); minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y + r.h); };
    rects.forEach((r, k) => { grow(r); body += tileSvg(r, { cls: P.line[k].t === lastPlayed() ? 'last' : '' }); });
    // «призраки»: куда встанет выбранная костяшка
    if (mine && S.pick >= 0) {
      for (const side of sidesP(P, S.pick)) {
        if (side === 'C') continue;
        const g = ghostRect(P.line, P.c, half, S.pick, side);
        grow(g);
        body += tileSvg(g, { cls: 'ghost' + (S.side === side ? ' on' : ''), act: 'end:' + side });
      }
    }
    if (!P.line.length) body += `<text x="0" y=".2" class="dn-empty">${mine ? (P.must >= 0 ? `Твой ход: начни с ${TILES[P.must].join('–')}` : 'Твой ход: положи любую') : 'Ждём первый ход…'}</text>`;
    const vb = [minX - .4, minY - .4, maxX - minX + .8, maxY - minY + .8];
    svg.setAttribute('viewBox', vb.map(v => v.toFixed(2)).join(' '));
    svg.style.aspectRatio = `${vb[2]} / ${vb[3]}`;
    svg.innerHTML = body;
    // базар и журнал
    rootEl.querySelector('.dn-bz').innerHTML = P.yard ? `🎒 Базар: <b>${P.bazar}</b>` : `<span title="Костяшки, которые не сдавали">🛌 Без базара${P.sleep ? ` (${P.sleep} спят)` : ''}</span>`;
    rootEl.querySelector('.dn-log').textContent = P.log || '';
    // статус
    const status = P.over ? (P.winner === me ? '🏆 Победа в игре!' : `😔 Победил ${E(P.players[P.winner]?.nick || '')}`)
      : P.rover ? (P.res?.p === me ? '🎉 Раунд твой!' : P.res?.p >= 0 ? `Раунд: ${E(P.players[P.res.p].nick)}` : '🐟 Рыба — поровну')
      : mine ? (S.pick >= 0 ? '🟢 Твой ход: «Сходить» или нажми костяшку ещё раз' : '🟢 Твой ход: выбери костяшку') : `⏳ Ходит ${E(P.players[P.turn].nick)}…`;
    rootEl.querySelector('.dn-status').innerHTML = (root.GameKit ? root.GameKit.turn(mine, status, P.over || P.rover) : status) + (online() && mine ? `<span class="gk-cd" data-gk-cd="${turnUntil}"></span>` : '');
    root.GameKit?.cd?.();
    // кнопки
    const play = mine ? hand.filter(t => sidesP(P, t).length) : [];
    const sd = S.pick >= 0 ? sidesP(P, S.pick) : [];
    let acts = '';
    if (P.over) acts = (isHost() ? '<button type="button" class="ct-start" data-act="again">↻ Ещё игра</button>' : '<span class="un-sub">Ждём, пока хозяин начнёт новую…</span>') + `<button type="button" class="un-btn" data-act="leave">${online() ? '🚪 Выйти' : '🏠 Меню'}</button>`;
    else if (P.rover) acts = isHost() ? '<button type="button" class="ct-start" data-act="next">▶ Следующий раунд</button>' : '<span class="un-sub">Следующий раунд — через пару секунд…</span>';
    else if (mine) {
      if (S.pick >= 0 && sd.length === 2) acts += '<button type="button" class="un-btn gk-go" data-act="end:L">◀ Влево</button><button type="button" class="un-btn gk-go" data-act="end:R">Вправо ▶</button>';
      else if (S.pick >= 0) acts += '<button type="button" class="un-btn gk-go" data-act="commit">✅ Сходить</button>';
      if (S.pick >= 0) acts += '<button type="button" class="un-btn" data-act="cancel">✕ Отмена</button>';
      if (!play.length && P.yard && P.bazar > 0) acts += '<button type="button" class="un-btn gk-go" data-act="draw">🎒 Взять из базара</button>';
      if (!play.length && !(P.yard && P.bazar > 0)) acts += '<button type="button" class="un-btn gk-go" data-act="pass">⏭ Пропустить ход</button>';
    }
    rootEl.querySelector('.dn-acts').innerHTML = acts;
    rootEl.querySelector('.dn-hint').innerHTML = hintTxt ? E(hintTxt) : mine && !P.rover && !P.over ? (play.length ? 'Подходящие костяшки подсвечены. Нажми костяшку — и ещё раз, или «Сходить».' : P.yard && P.bazar > 0 ? 'Нечем ходить — бери из базара, пока не найдёшь подходящую.' : 'Нечем ходить, базар пуст — пропусти ход.') : '';
    // рука
    const order = hand.slice().sort((a, b) => TILES[a][0] - TILES[b][0] || TILES[a][1] - TILES[b][1]);
    rootEl.querySelector('.dn-hand').innerHTML = order.map(t => {
      const ok = play.includes(t), sel = S.pick === t;
      return `<button type="button" class="dn-ht${ok ? ' ok' : mine ? ' dim' : ''}${sel ? ' sel' : ''}" data-act="tile:${t}" role="option" aria-selected="${sel}" aria-label="${TILES[t].join(' и ')}">${handTileSvg(t)}</button>`;
    }).join('');
    rootEl.querySelector('.dn-me').innerHTML = `Ты: <b>${P.sc[me]}</b> из ${P.target}${P.round ? ` · раунд ${P.round}` : ''}`;
    // итоги раунда
    const res = rootEl.querySelector('.dn-res');
    if ((P.rover || P.over) && P.res) {
      const g = P.over ? goats(P) : [];
      res.hidden = false;
      res.innerHTML = `<div class="dn-rt">${E(P.log)}</div>
        <table class="dn-tab"><tr><th></th><th>в руке</th><th>счёт</th></tr>${P.players.map((pl, i) => `<tr class="${i === me ? 'me' : ''}${i === P.res.p ? ' win' : ''}"><td>${E(pl.nick)}${i === me ? ' (ты)' : ''}${P.over && g.includes(i) ? ' 🐐' : ''}${P.over && i === P.winner ? ' 🏆' : ''}</td><td>${P.res.sums[i]}</td><td><b>${P.sc[i]}</b></td></tr>`).join('')}</table>
        ${P.over && g.length ? `<div class="dn-goat">🐐 ${g.map(i => E(P.players[i].nick)).join(', ')} — ${g.length > 1 ? 'козлы' : 'козёл'}!</div>` : ''}`;
    } else res.hidden = true;
    if (P.over && reported !== P.gid) over();
  }
  let lastT = -1;
  const lastPlayed = () => lastT;
  function over(){
    reported = P.gid;
    const win = P.winner === meIdx;
    api.sfx(win ? 'win' : 'bad');
    api.report(online() ? 'domino_online' : 'domino', win, P.sc[meIdx], P.sc[meIdx]);
  }

  function onClick(e){
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !rootEl?.contains(b)) return;
    const a = b.dataset.act;
    if (a.startsWith('nb:')) { opts.bots = +a.slice(3); saveOpts(); menu(); return; }
    if (a.startsWith('lv:')) { opts.level = a.slice(3); saveOpts(); menu(); return; }
    if (a.startsWith('tg:')) { opts.target = +a.slice(3); saveOpts(); menu(); return; }
    if (a.startsWith('yd:')) { opts.yard = a.slice(3) === '1'; saveOpts(); menu(); return; }
    if (a === 'solo') { startSolo(); return; }
    if (a === 'online') { location.hash = '#/games/domino/' + root.GameRoom.newCode(); return; }
    if (a === 'again') { if (online()) hostStart(); else startSolo(); return; }
    if (a === 'next') { if (isHost() && G?.rover && !G.over) { clearTimeout(botT); nextRound(G); sync(); } return; }
    if (a === 'leave') { if (online()) location.hash = '#/games/domino'; else menu(); return; }
    if (a.startsWith('tile:')) { e.stopPropagation(); pickEv({ t: 'tile', tile: +a.slice(5) }); return; }
    if (a.startsWith('end:')) { e.stopPropagation(); pickEv({ t: 'end', side: a.slice(4) }); return; }
    if (a === 'commit') { pickEv({ t: 'go' }); return; }
    if (a === 'cancel') { pickEv({ t: 'cancel' }); return; }
    if (a === 'draw') { S = { ...NOSEL }; doAct({ a: 'draw' }); return; }
    if (a === 'pass') { S = { ...NOSEL }; doAct({ a: 'pass' }); return; }
    if (a === 'copy') { const inp = rootEl.querySelector('.ct-link input'); navigator.clipboard?.writeText(inp.value).then(() => { b.textContent = '✅ Скопировано'; }, () => inp.select()); return; }
    if (a === 'bot') { bots++; lobby(); return; }
    if (a.startsWith('unbot:')) { bots = Math.max(0, bots - 1); lobby(); return; }
    if (a === 'go') { hostStart(); return; }
  }
  function onKey(e){
    if (!P || mode !== 'play' || !rootEl?.isConnected || e.target?.closest?.('input,textarea')) return;
    if (e.key === 'Escape' && S.pick >= 0 && !root.GameKit?.isOpen?.()) { e.preventDefault(); e.stopPropagation(); pickEv({ t: 'esc' }); }
    else if (e.key === 'Enter' && S.pick >= 0) { e.preventDefault(); pickEv({ t: 'go' }); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && S.pick >= 0) { e.preventDefault(); pickEv({ t: 'end', side: e.key === 'ArrowLeft' ? 'L' : 'R' }); }
  }

  // ═══ ОНЛАЙН: стол table.js на 2–4 ═══
  function seatList(){
    const list = (room?.seats || []).map(s => ({ id: s.id, nick: s.nick, me: s.me, look: s.look })).slice(0, 4);
    for (let i = 0; i < bots && list.length < 4; i++) list.push({ id: 'bot' + i, nick: BOTS[i], bot: true });
    return list;
  }
  function lobby(){
    if (!room || mode === 'play') return;
    mode = 'lobby';
    const seats = seatList();
    rootEl.innerHTML = root.TableRoom.lobbyHtml(location.origin + location.pathname + '#/games/domino/' + code, seats, 4, { title: '🐐 Домино — стол', host: room.isHost, canStart: seats.length >= 2 })
      + (room.isHost ? `<div class="dn-lset"><span class="ct-opts"><button type="button" class="ct-opt${opts.target === 51 ? ' active' : ''}" data-act="otg:51">до 51</button><button type="button" class="ct-opt${opts.target === 101 ? ' active' : ''}" data-act="otg:101">до 101</button><button type="button" class="ct-opt${opts.yard ? ' active' : ''}" data-act="oyd:1">с базаром</button><button type="button" class="ct-opt${!opts.yard ? ' active' : ''}" data-act="oyd:0">без базара</button></span></div>` : '');
    rootEl.querySelectorAll('[data-act^="otg:"],[data-act^="oyd:"]').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      const v = b.dataset.act;
      if (v.startsWith('otg:')) opts.target = +v.slice(4); else opts.yard = v.slice(4) === '1';
      saveOpts(); mode = 'lobby2'; lobby();
    }));
  }
  function hostStart(){
    if (!room?.isHost) return;
    const players = seatList().map(s => ({ id: s.id, nick: s.nick, bot: !!s.bot, look: s.look || null }));
    if (players.length < 2) { api.toast('Нужно хотя бы двое: позови друга или добавь бота'); return; }
    G = newGame(players, Math.random, { target: opts.target, yard: opts.yard });
    meIdx = players.findIndex(p => p.id === room.myId);
    mode = 'play'; S = { ...NOSEL }; reported = 0;
    build(); sync();
  }
  function joinTable(c){
    code = c;
    rootEl.innerHTML = '<div class="gm-loading"><div class="spinner"></div>Подключаемся к столу…</div>';
    room = root.TableRoom.join('domino', c, {
      max: 4,
      onError: () => { if (rootEl) rootEl.innerHTML = root.GameRoom.errorHtml; },
      onFull: () => { if (rootEl) rootEl.innerHTML = root.GameRoom.fullHtml('domino'); },
      onSeats: seats => {
        if (mode === 'play') {
          if (room.isHost && G) {
            let ch = false;
            G.players.forEach(pl => { if (!pl.bot && pl.id !== room.myId && !seats.some(s => s.id === pl.id)) { pl.bot = true; pl.lv = 'normal'; G.log = `${pl.nick} вышел — за него играет бот`; pl.nick += ' (бот)'; ch = true; } });
            if (ch) { G.v++; sync(); }
          } else if (!room.isHost && P && !seats.some(s => s.id === P.players[0]?.id)) { api.toast('Хозяин стола вышел'); mode = 'lobby'; P = null; lobby(); }
          return;
        }
        lobby();
      },
      onPrivate: (m, from) => {
        if (room.isHost) {
          if (m.type !== 'act' || !G) return;
          const p = G.players.findIndex(pl => pl.id === from && !pl.bot);
          if (p < 0) return;
          const a = m.act || {};
          if (a.a !== 'play') noteMiss(G, p);
          const err = act(G, p, { a: a.a, t: a.t, side: a.side });
          if (err) { room.sendTo(from, { type: 'err', text: err }); sync(); return; }
          sync();
          return;
        }
        if (from !== hostId()) return;
        if (m.type === 'up') {
          const first = !P || mode !== 'play';
          P = m.pub; hand = m.hand || [];
          meIdx = P.players.findIndex(o => o.id === room.myId);
          if (meIdx < 0) return;
          if (P.v !== lastV) { lastV = P.v; turnUntil = Date.now() + TURN_MS - 600; }
          if (first) { mode = 'play'; S = { ...NOSEL }; reported = 0; build(); }
          trackLast(P);
          render();
          if (P.turn === meIdx && !P.rover && !P.over) api.sfx('tick');
        } else if (m.type === 'err') api.toast(m.text);
      },
    });
    if (!room) rootEl.innerHTML = root.GameRoom.errorHtml;
  }
  // Последняя положенная костяшка — подсветить (по изменению концов цепочки)
  let prevLine = '';
  function trackLast(p){
    const key = p.line.map(x => x.t).join(',');
    if (key !== prevLine) {
      const was = prevLine ? prevLine.split(',').map(Number) : [];
      const now = p.line.map(x => x.t), add = now.find(t => !was.includes(t));
      lastT = add ?? -1; prevLine = key;
    }
  }

  function leave(){
    timers.forEach(clearTimeout); timers = [];
    clearTimeout(botT); clearTimeout(tickT);
    room?.leave(); room = null;
    G = null; P = null; hand = []; bots = 0; S = { ...NOSEL }; prevLine = ''; lastT = -1;
  }

  // ═══ CSS ═══
  const CSS = `
.dn-menu{display:flex;flex-direction:column;align-items:center;gap:.7rem;text-align:center;padding:.4rem 0}
.dn-logo{display:flex;gap:.5rem;padding-top:.5rem}
.dn-logo span{width:38px;transform:rotate(var(--r))}
.dn-logo svg{width:100%;display:block;filter:drop-shadow(0 3px 6px rgba(0,0,0,.5))}
.dn-row{width:min(100%,440px)}
.dn-game{display:flex;flex-direction:column;gap:.45rem}
.dn-board{position:relative;border-radius:16px;background:radial-gradient(ellipse at 50% 40%,#1f6b45,#134a31 70%,#0f3d29);border:2px solid #2c7a52;box-shadow:inset 0 0 40px rgba(0,0,0,.45);padding:.4rem;min-height:150px;display:flex;align-items:center;justify-content:center}
.dn-svg{display:block;width:100%;max-height:52vh}
.dn-tb{fill:#fbfaf3;stroke:#2b2b33;stroke-width:.045}
.dn-tl{stroke:#55555f;stroke-width:.04}
.dn-p{fill:#1d1d24}
.dn-t.last .dn-tb{fill:#fff7cc;stroke:#f59e0b;stroke-width:.07}
.dn-t.ghost{cursor:pointer}
.dn-t.ghost .dn-tb{fill:rgba(250,204,21,.28);stroke:#facc15;stroke-width:.07;stroke-dasharray:.14 .08}
.dn-t.ghost .dn-p{fill:rgba(255,255,255,.75)}
.dn-t.ghost .dn-tl{stroke:rgba(255,255,255,.4)}
.dn-t.ghost.on .dn-tb{fill:rgba(250,204,21,.55)}
body.high .dn-t.ghost .dn-tb{animation:dnGhost 1s ease-in-out infinite alternate}
@keyframes dnGhost{to{fill:rgba(250,204,21,.5)}}
.dn-empty{fill:rgba(255,255,255,.75);font:700 .42px Montserrat,sans-serif;text-anchor:middle}
.dn-info{display:flex;align-items:center;gap:.6rem;justify-content:center;flex-wrap:wrap;font-size:.76rem;color:var(--muted)}
.dn-info b{color:var(--text)}
.dn-log{margin:0}
.dn-hand{display:flex;flex-wrap:wrap;gap:.35rem;justify-content:center;padding:.3rem .2rem .2rem;min-height:84px}
.dn-ht{flex:none;width:40px;padding:0;border:0;background:none;cursor:pointer;border-radius:7px;transition:transform .15s,filter .15s;touch-action:manipulation}
.dn-ht svg{display:block;width:100%;filter:drop-shadow(0 3px 5px rgba(0,0,0,.45))}
.dn-ht.dim{filter:brightness(.55) saturate(.5)}
.dn-ht.ok{transform:translateY(-4px)}
.dn-ht.ok svg{filter:drop-shadow(0 0 6px rgba(74,222,128,.75))}
.dn-ht.sel{transform:translateY(-14px)}
.dn-ht.sel svg{filter:drop-shadow(0 0 8px #facc15) drop-shadow(0 0 2px #facc15)}
.dn-me{text-align:center;font-size:.8rem;color:var(--muted)}
.dn-me b{color:#ffd166}
.dn-sc{font-style:normal;color:#ffd166}
.dn-mini{display:inline-block;width:9px;height:15px;border-radius:2px;background:linear-gradient(#fbfaf3 0 45%,#55555f 45% 55%,#fbfaf3 55%);border:1px solid #2b2b33;vertical-align:-2px}
.dn-res{position:absolute;inset:.4rem;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5rem;padding:.8rem;border-radius:12px;background:rgba(6,20,14,.86);text-align:center}
.dn-res[hidden]{display:none}
.dn-rt{font-weight:800;font-size:.92rem;max-width:520px}
.dn-tab{border-collapse:collapse;font-size:.8rem;min-width:220px}
.dn-tab th{font-weight:700;color:var(--muted);font-size:.7rem;padding:.15rem .5rem}
.dn-tab td{padding:.25rem .5rem;border-top:1px solid rgba(255,255,255,.1)}
.dn-tab td:first-child{text-align:left}
.dn-tab tr.me td{color:#bbf7d0}
.dn-tab tr.win td:first-child{font-weight:800}
.dn-goat{font-weight:900;color:#fde68a}
.dn-lset{display:flex;justify-content:center;margin-top:.6rem}
@media(max-width:520px){.dn-ht{width:34px}.dn-hand{gap:.28rem}.dn-svg{max-height:44vh}}
@media(orientation:landscape) and (max-height:560px){.dn-svg{max-height:calc(100vh - 230px)}.dn-ht{width:30px}.dn-hand{min-height:66px}}
body:not(.high) .dn-ht{transition:none}
`;
  function css(){ if (document.getElementById('dnCss')) return; const s = document.createElement('style'); s.id = 'dnCss'; s.textContent = CSS; document.head.appendChild(s); }

  root.GAME_IMPL = root.GAME_IMPL || {};
  root.GAME_IMPL.domino = {
    mount(el, gameApi){
      rootEl = el; api = gameApi;
      css();
      rootEl.addEventListener('click', onClick);
      if (!keyOn) { root.addEventListener('keydown', onKey); keyOn = true; }
      if (root.GameRoom?.validCode(gameApi.param)) joinTable(gameApi.param); else menu();
    },
    unmount(){
      leave();
      rootEl?.removeEventListener('click', onClick);
      if (keyOn) { root.removeEventListener('keydown', onKey); keyOn = false; }
      rootEl = null; mode = 'menu';
    },
    get _P(){ return P; },
    _test: { TILES, newGame, deal, act, sidesFor, playable, canDraw, canPass, botMove, noteMiss, nextRound, pub, goats, pickReduce, layout, ghostRect, handPips, pips, NOSEL },
  };
})();
