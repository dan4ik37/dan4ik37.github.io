// ═══════════════════════════════════════
//  ИГРА «ШАХМАТЫ» — против компьютера трёх уровней, вдвоём на экране или онлайн с другом
// ═══════════════════════════════════════
// Все правила: рокировка, взятие на проходе, превращение пешки (выбор фигуры), мат, пат, ничья по правилу
// 50 ходов, троекратному повторению и нехватке материала. Компьютер — перебор с альфа-бета отсечением
// (глубина по уровню) + доски «где фигуре лучше стоять». Онлайн — стол на двоих (js/games/table.js):
// ходы проверяет хозяин стола, сообщения зашифрованы. Ключи сервера: chess_easy / chess_normal / chess_hard,
// chess_online.
// Доска: массив 64, индекс r*8+c, r=0 — 8-я горизонталь (сверху). Белые — заглавные KQRBNP, чёрные — строчные.
(() => {
  const START = 'rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR';
  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  // «Где фигуре лучше стоять» (для белых, r=0 — 8-я горизонталь); для чёрных — зеркально
  const PST = {
    p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
    n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
    b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
    r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
    q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
    k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
  };
  // Фигуры — свои SVG (символы ♟ и др. в Windows рисуются цветными эмодзи и не красятся в цвет стороны)
  const PATHS = {
    p: 'M22.5 8.5a5 5 0 0 1 3.4 8.7c2.7 1.3 4.1 3.5 4.1 5.6h-3.6l2.6 11.2H16l2.6-11.2H15c0-2.1 1.4-4.3 4.1-5.6a5 5 0 0 1 3.4-8.7zM11 34h23v5H11z',
    r: 'M11 34h23v5H11zM13.5 34l1.7-15h14.6l1.7 15zM12 18.5h21V11h-4.5v3.2h-3.2V11h-5.6v3.2h-3.2V11H12z',
    b: 'M22.5 6.5a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2zM22.5 12.5c-5.2 3.9-8.3 8.7-8.3 12.6 0 3.6 3.1 6.1 8.3 6.1s8.3-2.5 8.3-6.1c0-3.9-3.1-8.7-8.3-12.6zM15.5 32.5h14v2.5h-14zM11 35.5h23v3.5H11z',
    n: 'M13 39h20c.4-8.6-.7-16.2-4.4-22.6-2.7-4.6-6.9-7.3-11.4-7.6l.9 3.8-5.2 3.6c-2.9 2.1-4.3 5.3-4.4 8.9l2.9 2.1 5.3-2.6c1.9-.2 3.2.6 3.4 2.6-4.3 3-7.5 6.9-7.1 11.8z',
    q: 'M9.5 15.5l4.2 18.5h17.6l4.2-18.5-6.3 7.4-3-10.6-3.7 9.6-3.7-9.6-3 10.6zM12 34.5h21v4.5H12z M9.5 12.5a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6zM17.3 9.6a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6zM27.7 9.6a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6zM35.5 12.5a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6zM22.5 8a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6z',
    k: 'M21 5h3v4h4v3h-4v4.2c5.8.7 10 4.5 9.6 10.1L32.5 34h-20l-1.1-7.7C11 20.7 15.2 16.9 21 16.2V12h-4V9h4zM12 34.5h21v4.5H12z',
  };
  const DETAIL = { b: 'M19.5 19.5l6 6', n: 'M17.6 15.4a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z', k: 'M15 27.5h15', q: 'M14.5 30h16' };
  const piece = (t, col, cls = '') => `<svg class="ch-svg ${col}${cls ? ' ' + cls : ''}" viewBox="0 0 45 45" aria-hidden="true"><path d="${PATHS[t]}"/>${DETAIL[t] ? `<path class="ch-dt" d="${DETAIL[t]}"/>` : ''}</svg>`;
  const NAME = { q: 'ферзь', r: 'ладья', b: 'слон', n: 'конь' };
  const LEVELS = { easy: { label: 'Новичок', depth: 1, rnd: 60, nodes: 4000 }, normal: { label: 'Любитель', depth: 3, rnd: 20, nodes: 9000 }, hard: { label: 'Мастер', depth: 4, rnd: 0, nodes: 35000 } };
  const isW = p => p !== '.' && p === p.toUpperCase();
  const colorOf = p => p === '.' ? null : isW(p) ? 'w' : 'b';
  const sq = i => 'abcdefgh'[i % 8] + (8 - Math.floor(i / 8));

  // ═══ ПРАВИЛА ═══
  function newPos(){ return { b: START.split(''), turn: 'w', cast: { K: true, Q: true, k: true, q: true }, ep: -1, half: 0, full: 1, keys: [] }; }
  const posKey = P => P.b.join('') + P.turn + (P.cast.K ? 'K' : '') + (P.cast.Q ? 'Q' : '') + (P.cast.k ? 'k' : '') + (P.cast.q ? 'q' : '') + P.ep;
  const N_OFF = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const K_OFF = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]], ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  function attacked(b, i, by){
    const r = Math.floor(i / 8), c = i % 8;
    const up = by === 'w' ? 1 : -1;   // белые пешки бьют вверх (к r-1): атакуют i с клетки r+1
    for (const dc of [-1, 1]) { const rr = r + up, cc = c + dc; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === (by === 'w' ? 'P' : 'p')) return true; }
    for (const [dr, dc] of N_OFF) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === (by === 'w' ? 'N' : 'n')) return true; }
    for (const [dr, dc] of K_OFF) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === (by === 'w' ? 'K' : 'k')) return true; }
    const slide = (dirs, set) => {
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
          const p = b[rr * 8 + cc];
          if (p !== '.') { if (colorOf(p) === by && set.includes(p.toLowerCase())) return true; break; }
          rr += dr; cc += dc;
        }
      }
      return false;
    };
    return slide(DIAG, 'bq') || slide(ORTH, 'rq');
  }
  const kingAt = (b, col) => b.indexOf(col === 'w' ? 'K' : 'k');
  const inCheck = (P, col) => attacked(P.b, kingAt(P.b, col), col === 'w' ? 'b' : 'w');
  // Ход: { f, t, promo?, ep?, castle? }
  function pseudo(P){
    const out = [], b = P.b, me = P.turn, op = me === 'w' ? 'b' : 'w';
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (colorOf(p) !== me) continue;
      const t = p.toLowerCase(), r = Math.floor(i / 8), c = i % 8;
      const add = (to, extra) => out.push({ f: i, t: to, ...extra });
      if (t === 'p') {
        const dir = me === 'w' ? -1 : 1, startR = me === 'w' ? 6 : 1, lastR = me === 'w' ? 0 : 7;
        const one = i + dir * 8;
        const pushP = (to, extra) => { if (Math.floor(to / 8) === lastR) for (const q of 'qrbn') add(to, { ...extra, promo: q }); else add(to, extra); };
        if (one >= 0 && one < 64 && b[one] === '.') { pushP(one); if (r === startR && b[one + dir * 8] === '.') add(one + dir * 8, { double: true }); }
        for (const dc of [-1, 1]) {
          const cc = c + dc, rr = r + dir;
          if (cc < 0 || cc > 7 || rr < 0 || rr > 7) continue;
          const to = rr * 8 + cc;
          if (colorOf(b[to]) === op) pushP(to);
          else if (to === P.ep) add(to, { ep: true });
        }
      } else if (t === 'n' || t === 'k') {
        for (const [dr, dc] of t === 'n' ? N_OFF : K_OFF) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && colorOf(b[rr * 8 + cc]) !== me) add(rr * 8 + cc); }
        if (t === 'k') {
          const home = me === 'w' ? 60 : 4, rights = me === 'w' ? ['K', 'Q'] : ['k', 'q'];
          if (i === home && !attacked(b, i, op)) {
            if (P.cast[rights[0]] && b[i + 1] === '.' && b[i + 2] === '.' && b[i + 3] === (me === 'w' ? 'R' : 'r') && !attacked(b, i + 1, op) && !attacked(b, i + 2, op)) add(i + 2, { castle: 'K' });
            if (P.cast[rights[1]] && b[i - 1] === '.' && b[i - 2] === '.' && b[i - 3] === '.' && b[i - 4] === (me === 'w' ? 'R' : 'r') && !attacked(b, i - 1, op) && !attacked(b, i - 2, op)) add(i - 2, { castle: 'Q' });
          }
        }
      } else {
        const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : DIAG.concat(ORTH);
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
            const to = rr * 8 + cc, q = b[to];
            if (q === '.') add(to);
            else { if (colorOf(q) === op) add(to); break; }
            rr += dr; cc += dc;
          }
        }
      }
    }
    return out;
  }
  // Сделать ход (возвращает новую позицию)
  function make(P, m){
    const b = P.b.slice(), p = b[m.f], me = P.turn, cap = b[m.t];
    const N = { b, turn: me === 'w' ? 'b' : 'w', cast: { ...P.cast }, ep: -1, half: P.half + 1, full: P.full + (me === 'b' ? 1 : 0), keys: P.keys };
    b[m.t] = m.promo ? (me === 'w' ? m.promo.toUpperCase() : m.promo) : p;
    b[m.f] = '.';
    if (m.ep) b[m.t + (me === 'w' ? 8 : -8)] = '.';
    if (m.castle === 'K') { b[m.t - 1] = b[m.t + 1]; b[m.t + 1] = '.'; }
    if (m.castle === 'Q') { b[m.t + 1] = b[m.t - 2]; b[m.t - 2] = '.'; }
    if (m.double) N.ep = (m.f + m.t) / 2;
    if (p.toLowerCase() === 'p' || cap !== '.') N.half = 0;
    if (p === 'K') { N.cast.K = N.cast.Q = false; } if (p === 'k') { N.cast.k = N.cast.q = false; }
    for (const [s, k] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (m.f === s || m.t === s) N.cast[k] = false;
    return N;
  }
  function legal(P){ return pseudo(P).filter(m => !inCheck(make(P, m), P.turn)); }
  function insufficient(b){
    const pcs = b.filter(p => p !== '.' && p.toLowerCase() !== 'k');
    if (!pcs.length) return true;
    return pcs.length === 1 && 'bn'.includes(pcs[0].toLowerCase());
  }
  // Итог позиции: null — игра идёт; иначе { result: 'w'|'b'|'draw', why }
  function status(P){
    const moves = legal(P);
    if (!moves.length) return inCheck(P, P.turn) ? { result: P.turn === 'w' ? 'b' : 'w', why: 'мат' } : { result: 'draw', why: 'пат' };
    if (P.half >= 100) return { result: 'draw', why: 'правило 50 ходов' };
    if (insufficient(P.b)) return { result: 'draw', why: 'недостаточно фигур для мата' };
    const k = posKey(P);
    if (P.keys.filter(x => x === k).length >= 2) return { result: 'draw', why: 'троекратное повторение' };
    return null;
  }
  // Обозначение хода (кратко: Кf3, exd5, O-O, e8=Ф)
  const RU = { k: 'Кр', q: 'Ф', r: 'Л', b: 'С', n: 'К', p: '' };
  function san(P, m){
    if (m.castle) return m.castle === 'K' ? 'O-O' : 'O-O-O';
    const p = P.b[m.f].toLowerCase(), cap = P.b[m.t] !== '.' || m.ep;
    let s = (p === 'p' ? (cap ? 'abcdefgh'[m.f % 8] : '') : RU[p]) + (cap ? ':' : '') + sq(m.t) + (m.promo ? '=' + RU[m.promo] : '');
    const N = make(P, m);
    if (inCheck(N, N.turn)) s += legal(N).length ? '+' : '#';
    return s;
  }

  // ═══ КОМПЬЮТЕР: негамакс с альфа-бета, взятия первыми ═══
  function evaluate(b){
    let s = 0;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (p === '.') continue;
      const t = p.toLowerCase(), w = isW(p), idx = w ? i : (7 - Math.floor(i / 8)) * 8 + i % 8;
      s += (w ? 1 : -1) * (VAL[t] + PST[t][idx]);
    }
    return s;
  }
  function order(P, ms){ return ms.map(m => ({ m, s: (P.b[m.t] !== '.' ? 10 * VAL[P.b[m.t].toLowerCase()] - VAL[P.b[m.f].toLowerCase()] : 0) + (m.promo ? 800 : 0) })).sort((a, b) => b.s - a.s).map(x => x.m); }
  // Законность хода проверяем лениво — только у тех ходов, до которых дошёл перебор (так в разы быстрее)
  function search(P, depth, alpha, beta, ctx){
    ctx.nodes++;
    if (depth <= 0) return quiesce(P, alpha, beta, ctx, 0);
    let any = false;
    for (const m of order(P, pseudo(P))) {
      const N = make(P, m);
      if (inCheck(N, P.turn)) continue;
      any = true;
      const v = -search(N, depth - 1, -beta, -alpha, ctx);
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
      if (ctx.nodes > ctx.max) break;
    }
    if (!any) return inCheck(P, P.turn) ? -100000 - depth : 0;
    return alpha;
  }
  function quiesce(P, alpha, beta, ctx, d){
    ctx.nodes++;
    const stand = (P.turn === 'w' ? 1 : -1) * evaluate(P.b);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (d > 3 || ctx.nodes > ctx.max) return alpha;
    for (const m of order(P, pseudo(P).filter(m => P.b[m.t] !== '.' || m.promo || m.ep))) {
      const N = make(P, m);
      if (inCheck(N, P.turn)) continue;
      const v = -quiesce(N, -beta, -alpha, ctx, d + 1);
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }
  // Постепенное углубление: все ходы на глубину 1, потом 2, 3… пока хватает лимита позиций.
  // Повтор уже бывшей позиции — штраф (иначе сильный компьютер ходит по кругу и сводит в ничью)
  function bestMove(P, level){
    const L = LEVELS[level] || LEVELS.normal;
    let ordered = order(P, legal(P));
    if (!ordered.length) return null;
    const ctx = { nodes: 0, max: L.nodes }, seen = new Set(P.keys);
    let scored = ordered.map(m => ({ m, v: 0 }));
    for (let d = 1; d <= L.depth; d++) {
      const cur = [];
      let alpha = -Infinity, done = true;
      for (const m of ordered) {
        const N = make(P, m);
        let v = -search(N, d - 1, -Infinity, -alpha, ctx);
        if (seen.has(posKey(N))) v -= 35;
        cur.push({ m, v });
        if (v > alpha) alpha = v;
        if (ctx.nodes > ctx.max && d > 1) { done = false; break; }
      }
      if (!done) break;
      scored = cur.sort((a, b) => b.v - a.v);
      ordered = scored.map(x => x.m);
    }
    if (!L.rnd) return scored[0].m;
    let best = scored[0], bv = -Infinity;
    for (const x of scored) { const v = x.v + (Math.random() - .5) * 2 * L.rnd; if (v > bv) { bv = v; best = x; } }
    return best.m;
  }

  // ═══ ЭКРАН ═══
  let root, api, P = null, hist = [], mode = 'menu', vs = 'bot', level = 'normal', myCol = 'w', sel = -1, lastMv = null, over = null, room = null, timers = [], pendingPromo = null, flip = false, names = { w: 'Белые', b: 'Чёрные' };
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const isHost = () => !room || room.isHost;
  const hostId = () => room?.seats[0]?.id;
  function menu(){
    mode = 'menu'; P = null;
    root.innerHTML = `<div class="dk-menu">
        <div class="pl-logo">♞</div><div class="un-title">Шахматы</div>
        <div class="un-sub">Классические шахматы со всеми правилами: рокировка, взятие на проходе, превращение пешки. Сыграй с компьютером, с другом на одном экране или онлайн.</div>
        <div class="pl-levels">${Object.entries(LEVELS).map(([k, L]) => `<button type="button" class="un-n wide${k === level ? ' sel' : ''}" data-act="lv:${k}">${L.label}</button>`).join('')}</div>
        <div class="pl-levels">${[['w', '♔ Белыми'], ['b', '♚ Чёрными'], ['r', '🎲 Случайно']].map(([k, l]) => `<button type="button" class="un-n wide${k === (menu.col || 'w') ? ' sel' : ''}" data-act="col:${k}">${l}</button>`).join('')}</div>
        <div class="ct-actions"><button type="button" class="ct-start" data-act="bot">🤖 С компьютером</button><button type="button" class="ct-duel-btn" data-act="duo">👥 Вдвоём на экране</button><button type="button" class="ct-duel-btn" data-act="online">🌐 Онлайн с другом</button></div>
        ${api.local().plays ? `<div class="un-sub">Партий: <b>${api.local().plays}</b> · побед: <b>${api.local().wins || 0}</b></div>` : ''}
      </div>`;
  }
  const movesLog = [];   // ходы партии — для «Отменить ход»
  function start(kind, col){
    vs = kind; myCol = col; P = newPos(); hist = []; sel = -1; lastMv = null; over = null; pendingPromo = null; mode = 'play';
    movesLog.length = 0;
    flip = myCol === 'b';
    if (kind === 'bot') names = myCol === 'w' ? { w: 'Ты', b: '🤖 ' + LEVELS[level].label } : { w: '🤖 ' + LEVELS[level].label, b: 'Ты' };
    if (kind === 'duo') names = { w: 'Белые', b: 'Чёрные' };
    render();
    if (kind === 'bot' && P.turn !== myCol) later(botMove, 500);
  }
  function apply(m){
    movesLog.push(m);
    const s = san(P, m);
    P.keys = P.keys.concat([posKey(P)]);
    P = make(P, m);
    hist.push(s); lastMv = m; sel = -1;
    over = status(P);
    api.sfx(over ? (over.result === 'draw' ? 'ok' : 'win') : inCheck(P, P.turn) ? 'bad' : 'move');
  }
  function botMove(){
    if (!P || over || mode !== 'play' || vs !== 'bot' || P.turn === myCol) return;
    const m = bestMove(P, level);
    if (m) apply(m);
    render();
  }
  function tryMove(f, t, promo){
    const ms = legal(P).filter(m => m.f === f && m.t === t);
    if (!ms.length) return false;
    if (ms[0].promo && !promo) { pendingPromo = { f, t }; render(); return true; }
    const m = ms.find(x => !x.promo || x.promo === promo) || ms[0];
    if (vs === 'online' && !isHost()) { room.sendTo(hostId(), { type: 'mv', f, t, promo: m.promo || null }); sel = -1; pendingPromo = null; return true; }
    apply(m); pendingPromo = null;
    if (vs === 'online') syncOnline();
    render();
    if (vs === 'bot' && !over) later(botMove, 350);
    return true;
  }
  function myTurn(){ return P && !over && (vs === 'duo' || P.turn === myCol); }
  function render(){
    if (!P) return;
    const ms = myTurn() ? legal(P) : [];
    const targets = new Set(sel >= 0 ? ms.filter(m => m.f === sel).map(m => m.t) : []);
    const checkSq = inCheck(P, P.turn) ? kingAt(P.b, P.turn) : -1;
    const cells = [];
    for (let k = 0; k < 64; k++) {
      const i = flip ? 63 - k : k, r = Math.floor(i / 8), c = i % 8, p = P.b[i];
      const cls = ['ch-sq', (r + c) % 2 ? 'dark' : 'light'];
      if (i === sel) cls.push('sel');
      if (lastMv && (i === lastMv.f || i === lastMv.t)) cls.push('last');
      if (i === checkSq) cls.push('check');
      if (targets.has(i)) cls.push(p !== '.' ? 'cap' : 'dot');
      const coord = (flip ? r === 0 : r === 7) ? `<i class="ch-f">${'abcdefgh'[c]}</i>` : '';
      const rank = (flip ? c === 7 : c === 0) ? `<i class="ch-r">${8 - r}</i>` : '';
      cells.push(`<button type="button" class="${cls.join(' ')}" data-sq="${i}" aria-label="${sq(i)}">${p !== '.' ? piece(p.toLowerCase(), isW(p) ? 'w' : 'b') : ''}${coord}${rank}</button>`);
    }
    const turnName = names[P.turn];
    let statusTxt = over ? (over.result === 'draw' ? `🤝 Ничья: ${over.why}` : `🏆 ${over.why === 'мат' ? 'Мат!' : ''} Победили ${over.result === 'w' ? 'белые' : 'чёрные'} (${esc(names[over.result])})`)
      : `${inCheck(P, P.turn) ? '⚠️ Шах! ' : ''}${myTurn() ? (vs === 'duo' ? `Ходят ${P.turn === 'w' ? 'белые' : 'чёрные'}` : '🟢 Твой ход') : `⏳ Ходит ${esc(turnName)}…`}`;
    const capW = START.split('').filter(x => x !== '.' && isW(x)), capB = START.split('').filter(x => x !== '.' && !isW(x));
    const lost = (all, col) => { const now = P.b.filter(x => x !== '.' && colorOf(x) === col); const cnt = {}; for (const x of now) cnt[x] = (cnt[x] || 0) + 1; return all.filter(x => !(cnt[x]-- > 0)).map(x => piece(x.toLowerCase(), isW(x) ? 'w' : 'b', 'mini')).join(''); };
    root.innerHTML = `<div class="ch">
        <div class="ch-pl"><b>${esc(names[flip ? 'w' : 'b'])}</b><span class="ch-lost">${lost(flip ? capW : capB, flip ? 'w' : 'b')}</span></div>
        <div class="ch-board${flip ? ' flip' : ''}">${cells.join('')}</div>
        <div class="ch-pl"><b>${esc(names[flip ? 'b' : 'w'])}</b><span class="ch-lost">${lost(flip ? capB : capW, flip ? 'b' : 'w')}</span></div>
        <div class="un-status">${statusTxt}</div>
        <div class="ch-moves">${hist.map((s, i) => i % 2 ? `${s} ` : `<b>${i / 2 + 1}.</b> ${s} `).join('')}</div>
        <div class="un-acts">${over ? `${vs === 'online' && !isHost() ? '<span class="un-sub">Ждём реванша…</span>' : '<button type="button" class="ct-start" data-act="again">↻ Ещё партия</button>'}<button type="button" class="un-btn" data-act="leave">${vs === 'online' ? '🚪 Выйти' : '🏠 Меню'}</button>`
          : `${vs !== 'online' && hist.length ? '<button type="button" class="un-btn" data-act="undo">↶ Отменить ход</button>' : ''}<button type="button" class="un-btn" data-act="resign">🏳️ Сдаться</button>`}</div>
        ${pendingPromo ? `<div class="ch-promo"><div>Во что превратить пешку?</div><div>${'qrbn'.split('').map(q => `<button type="button" data-act="promo:${q}" aria-label="${NAME[q]}">${piece(q, P.turn === 'w' ? 'w' : 'b')}</button>`).join('')}</div></div>` : ''}
      </div>`;
    if (over && mode === 'play') finish();
  }
  function finish(){
    mode = 'over';
    if (vs === 'duo') return;
    const win = over.result === myCol, draw = over.result === 'draw';
    if (vs === 'bot') api.report('chess_' + level, win, win ? 1 : 0, (api.local().wins || 0) + (win ? 1 : 0));
    else api.report('chess_online', win, win ? 1 : 0, (api.local().wins || 0) + (win ? 1 : 0));
    if (!draw) api.sfx(win ? 'win' : 'bad');
  }
  // Отменить ход (против компьютера — сразу свой и его)
  const snapshots = [];
  function onClick(e){
    const b = e.target.closest('[data-act],[data-sq]');
    if (!b) return;
    if (b.dataset.sq != null) {
      if (!myTurn() || pendingPromo) return;
      const i = +b.dataset.sq, p = P.b[i];
      if (sel >= 0 && tryMove(sel, i)) return;
      sel = colorOf(p) === P.turn ? (sel === i ? -1 : i) : -1;
      render();
      return;
    }
    const a = b.dataset.act;
    if (a.startsWith('lv:')) { level = a.slice(3); menu(); }
    else if (a.startsWith('col:')) { menu.col = a.slice(4); menu(); }
    else if (a === 'bot') { const c = menu.col || 'w'; start('bot', c === 'r' ? (Math.random() < .5 ? 'w' : 'b') : c); }
    else if (a === 'duo') start('duo', 'w');
    else if (a === 'online') location.hash = '#/games/chess/' + GameRoom.newCode();
    else if (a.startsWith('promo:')) { const { f, t } = pendingPromo || {}; if (f != null) tryMove(f, t, a.slice(6)); }
    else if (a === 'again') { if (vs === 'online') hostStart(); else start(vs, vs === 'bot' ? myCol : 'w'); }
    else if (a === 'leave') { if (vs === 'online') location.hash = '#/games/chess'; else menu(); }
    else if (a === 'resign') {
      if (over || !P) return;
      const loser = vs === 'duo' ? P.turn : myCol;
      if (vs === 'online' && !isHost()) { room.sendTo(hostId(), { type: 'resign' }); return; }
      over = { result: loser === 'w' ? 'b' : 'w', why: 'сдача' };
      if (vs === 'online') syncOnline();
      render();
    } else if (a === 'undo') undo();
  }
  // Отменить ход: партия переигрывается из журнала без последних ходов (против компьютера — до твоего хода)
  function undo(){
    if (!movesLog.length || vs === 'online') return;
    const n = vs === 'bot' ? (P.turn === myCol ? 2 : 1) : 1;
    const keep = movesLog.slice(0, Math.max(0, movesLog.length - n));
    P = newPos(); hist = []; lastMv = null; over = null; sel = -1; pendingPromo = null; mode = 'play';
    movesLog.length = 0;
    for (const m of keep) apply(m);
    render();
    if (vs === 'bot' && P.turn !== myCol) later(botMove, 400);
  }

  // ═══ ОНЛАЙН: стол на двоих, хозяин — белые и проверяет ходы ═══
  let code = '';
  function syncOnline(){
    const g = room?.seats?.find(s => !s.me);
    if (g) room.sendTo(g.id, { type: 'st', b: P.b, turn: P.turn, cast: P.cast, ep: P.ep, half: P.half, full: P.full, keys: P.keys.slice(-12), hist, last: lastMv, over });
  }
  function lobby(){
    if (!room || mode === 'play' || mode === 'over') return;
    mode = 'lobby';
    const seats = (room.seats || []).map(s => ({ id: s.id, nick: s.nick, me: s.me }));
    root.innerHTML = TableRoom.lobbyHtml(location.origin + location.pathname + '#/games/chess/' + code, seats, 2, { title: '♞ Шахматы — стол', host: room.isHost, canStart: seats.length === 2 });
  }
  function hostStart(){
    if (!room?.isHost || room.seats.length < 2) return;
    const g = room.seats.find(s => !s.me);
    start('online', 'w');
    names = { w: 'Ты', b: g.nick };
    render();
    syncOnline();
  }
  function joinTable(c){
    code = c;
    root.innerHTML = '<div class="gm-loading"><div class="spinner"></div>Подключаемся к столу…</div>';
    room = TableRoom.join('chess', c, {
      max: 2,
      onError: () => { root.innerHTML = GameRoom.errorHtml; },
      onFull: () => { root.innerHTML = GameRoom.fullHtml('chess'); },
      onSeats: seats => { if (mode === 'play' || mode === 'over') { if (seats.length < 2) api.toast('Соперник вышел'); return; } lobby(); },
      onMessage: (m, from) => { if (m.type === 'go') lobby(); },
      onPrivate: (m, from) => {
        if (room.isHost) {
          if (!P || over) return;
          if (m.type === 'mv' && P.turn === 'b') { const ok = legal(P).find(x => x.f === m.f && x.t === m.t && (x.promo || null) === (m.promo || null)); if (ok) { apply(ok); syncOnline(); render(); } }
          else if (m.type === 'resign') { over = { result: 'w', why: 'соперник сдался' }; syncOnline(); render(); }
          return;
        }
        if (from !== hostId() || m.type !== 'st') return;
        const first = mode !== 'play';
        P = { b: m.b, turn: m.turn, cast: m.cast, ep: m.ep, half: m.half, full: m.full, keys: m.keys || [] };
        hist = m.hist || []; lastMv = m.last; over = m.over;
        if (first) { vs = 'online'; myCol = 'b'; flip = true; mode = 'play'; names = { w: room.seats[0]?.nick || 'Соперник', b: 'Ты' }; }
        if (over && mode === 'over') mode = 'play';
        sel = -1; pendingPromo = null;
        if (P.turn === myCol && !over) api.sfx('tick');
        render();
      },
    });
    if (!room) root.innerHTML = GameRoom.errorHtml;
  }

  window.GAME_IMPL.chess = {
    mount(el, gameApi){
      root = el; api = gameApi;
      root.addEventListener('click', onClick);
      if (GameRoom.validCode(gameApi.param)) joinTable(gameApi.param); else menu();
    },
    unmount(){
      timers.forEach(clearTimeout); timers = [];
      root?.removeEventListener('click', onClick);
      room?.leave(); room = null;
      P = null; mode = 'menu';
      root = null;
    },
    _test: { newPos, legal, make, status, bestMove, san, inCheck, posKey },
  };
})();
