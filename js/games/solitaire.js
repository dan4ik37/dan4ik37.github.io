// ═══════════════════════════════════════
//  ПАСЬЯНСЫ: «КОСЫНКА» (Klondike, по 1 или по 3 карты) и «ПАУК» (1, 2 или 4 масти)
// ═══════════════════════════════════════
// Один файл на оба: GAME_IMPL.kosynka и GAME_IMPL.pauk. Карты — DOM-элементы, едут CSS-переходом.
// Управление: перетащить (палец/мышь) или просто нажать — карта сама уйдёт на лучшее место (сначала в «дом»).
// Отмена ходов, подсказка, автосбор в конце «Косынки». Партия сохраняется (localStorage d37_sol_<игра>).
// Очки «Косынки» как в Windows: из колоды в ряд +5, в дом +10, открыл карту +5, из дома назад −15,
// новый круг колоды −100 (по 3 карты — −20); за победу бонус 700 000 / секунд игры.
// «Паук»: 500 − ходы + 100 за каждую собранную масть (Король→Туз одной масти уходит сама).
// «⚔️ Соревнование» — только «Косынка» по 1 карте: одинаковая раздача у обоих, 5 минут, у кого больше очков.
// Движок без DOM — GAME_IMPL.kosynka._test (проверять в node).
(() => {
  const RANKS = ['Т', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'В', 'Д', 'К'];
  const SUITS = ['♠', '♥', '♣', '♦'].map(s => s + '︎');   // FE0E — символ, а не цветной эмодзи
  const red = c => c.s % 2 === 1;
  const DUEL_SEC = 300;

  // ── Движок ──
  function shuffle(a, rand){ for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function dealKlondike(rand, draw){
    const deck = shuffle(Array.from({ length: 52 }, (_, i) => ({ id: i, s: Math.floor(i / 13), r: i % 13, up: false })), rand);
    const tab = Array.from({ length: 7 }, () => []);
    for (let row = 0; row < 7; row++) for (let i = row; i < 7; i++) tab[i].push(deck.pop());
    tab.forEach(p => { p[p.length - 1].up = true; });
    return { kind: 'k', draw: draw === 3 ? 3 : 1, stock: deck, waste: [], found: [[], [], [], []], tab, score: 0, moves: 0, recycles: 0, won: false };
  }
  function dealSpider(rand, suits){
    const ss = suits === 4 ? [0, 1, 2, 3] : suits === 2 ? [0, 1] : [0];
    const cards = [];
    for (let d = 0; d < 8; d++) for (let r = 0; r < 13; r++) cards.push({ id: cards.length, s: ss[d % ss.length], r, up: false });
    shuffle(cards, rand);
    const tab = Array.from({ length: 10 }, () => []);
    for (let i = 0; i < 54; i++) tab[i % 10].push(cards.pop());
    tab.forEach(p => { p[p.length - 1].up = true; });
    return { kind: 's', suits: ss.length, stock: cards, tab, done: [], score: 500, moves: 0, won: false };
  }
  // Стопки: st — колода, w — сброс, f0..f3 — «дом», t0.. — ряды
  function pile(S, id){
    if (id === 'st') return S.stock;
    if (id === 'w') return S.waste;
    const n = +id.slice(1);
    return id[0] === 'f' ? S.found?.[n] : id[0] === 't' ? S.tab[n] : null;
  }
  function canPick(S, id, idx){
    const p = pile(S, id);
    if (!p || id === 'st' || idx < 0 || idx >= p.length || !p[idx].up) return false;
    if (id === 'w' || id[0] === 'f') return idx === p.length - 1;
    for (let i = idx; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      if (a.r !== b.r + 1 || (S.kind === 'k' ? red(a) === red(b) : a.s !== b.s)) return false;
    }
    return true;
  }
  function canDrop(S, cards, id){
    const p = pile(S, id);
    if (!p || !cards.length) return false;
    const c = cards[0], top = p[p.length - 1];
    if (id[0] === 'f') return S.kind === 'k' && cards.length === 1 && (top ? top.s === c.s && c.r === top.r + 1 : c.r === 0);
    if (id[0] !== 't') return false;
    if (S.kind === 'k') return top ? top.up && red(top) !== red(c) && top.r === c.r + 1 : c.r === 12;
    return !top || (top.up && top.r === c.r + 1);
  }
  // «Паук»: собранная масть Король→Туз в конце ряда уходит
  function collect(S, ti){
    const p = S.tab[ti];
    if (p.length < 13) return false;
    const k = p.length - 13, s = p[k].s;
    for (let i = 0; i < 13; i++) { const c = p[k + i]; if (!c.up || c.s !== s || c.r !== 12 - i) return false; }
    S.done.push(p.splice(k, 13));
    S.score += 100;
    const top = p[p.length - 1];
    if (top && !top.up) top.up = true;
    S.won = S.done.length === 8;
    return true;
  }
  // Переложить from[idx..] → to. false — нельзя
  function move(S, from, idx, to){
    if (from === to || !canPick(S, from, idx)) return false;
    const a = pile(S, from), cards = a.slice(idx);
    if (!canDrop(S, cards, to)) return false;
    a.splice(idx);
    pile(S, to).push(...cards);
    S.moves++;
    const top = a[a.length - 1];
    if (S.kind === 'k') {
      let pts = 0;
      if (to[0] === 'f' && from[0] !== 'f') pts += 10;
      else if (from === 'w' && to[0] === 't') pts += 5;
      else if (from[0] === 'f' && to[0] === 't') pts -= 15;
      if (from[0] === 't' && top && !top.up) { top.up = true; pts += 5; }
      S.score = Math.max(0, S.score + pts);
      S.won = S.found.every(f => f.length === 13);
    } else {
      S.score = Math.max(0, S.score - 1);
      if (top && !top.up) top.up = true;
      collect(S, +to.slice(1));
    }
    return true;
  }
  // Колода. «Косынка»: взять 1 или 3 карты, пустая — новый круг. «Паук»: по карте в каждый ряд (если нет пустых)
  function drawStock(S){
    if (S.kind === 'k') {
      if (S.stock.length) {
        for (let i = 0; i < S.draw && S.stock.length; i++) { const c = S.stock.pop(); c.up = true; S.waste.push(c); }
        S.moves++;
        return 'draw';
      }
      if (!S.waste.length) return false;
      S.stock = S.waste.reverse();
      S.stock.forEach(c => { c.up = false; });
      S.waste = [];
      S.recycles++; S.moves++;
      S.score = Math.max(0, S.score - (S.draw === 3 ? 20 : 100));
      return 'recycle';
    }
    if (!S.stock.length || S.tab.some(p => !p.length)) return false;
    for (const p of S.tab) { const c = S.stock.pop(); c.up = true; p.push(c); }
    S.moves++;
    S.score = Math.max(0, S.score - 1);
    S.tab.forEach((_, i) => collect(S, i));
    return 'deal';
  }
  // Куда уйдёт карта по нажатию: «дом», потом ряд (в «Пауке» — лучше своей масти)
  function bestTarget(S, from, idx){
    if (!canPick(S, from, idx)) return null;
    const cards = pile(S, from).slice(idx), c = cards[0];
    if (S.kind === 'k' && cards.length === 1 && from[0] !== 'f') for (let f = 0; f < 4; f++) if (canDrop(S, cards, 'f' + f)) return 'f' + f;
    let best = null, bv = 0;
    S.tab.forEach((p, ti) => {
      const id = 't' + ti, top = p[p.length - 1];
      if (id === from || !canDrop(S, cards, id)) return;
      if (!top && from[0] === 't' && idx === 0) return;           // целый ряд на пустое место — бессмысленно
      const v = !top ? 1 : S.kind === 's' && top.s === c.s ? 3 : 2;
      if (v > bv) { bv = v; best = id; }
    });
    return best;
  }
  // Подсказка: самый полезный ход или колода. null — ходов нет
  function hint(S){
    const tabs = S.tab.map((_, i) => 't' + i), fs = S.kind === 'k' ? ['f0', 'f1', 'f2', 'f3'] : [];
    const froms = S.kind === 'k' ? ['w', ...tabs] : tabs, tos = [...fs, ...tabs];
    let best = null;
    for (const from of froms) {
      const p = pile(S, from);
      for (let idx = 0; idx < p.length; idx++) {
        if (!canPick(S, from, idx)) continue;
        for (const to of tos) {
          if (to === from || !canDrop(S, p.slice(idx), to)) continue;
          const v = hintValue(S, from, idx, to);
          if (v > 0 && (!best || v > best.v)) best = { from, idx, to, v };
        }
      }
    }
    if (best) return best;
    if (S.stock.length || (S.kind === 'k' && S.waste.length)) return { stock: true };
    return null;
  }
  function hintValue(S, from, idx, to){
    const p = pile(S, from), under = p[idx - 1], dest = pile(S, to), top = dest[dest.length - 1];
    const reveal = from[0] === 't' && under && !under.up, empties = from[0] === 't' && idx === 0;
    if (S.kind === 'k') {
      if (to[0] === 'f') return 50 + (reveal ? 10 : 0);
      if (from === 'w') return 30;
      if (reveal) return 40;
      if (empties && top) return 20;
      return 0;   // перекладывать туда-сюда смысла нет
    }
    if (!top && (empties || !reveal)) return 0;
    if (under && under.up && under.s === p[idx].s && under.r === p[idx].r + 1) return 0;   // не рвём свою масть
    return (top ? (top.s === p[idx].s ? 30 : 10) : 5) + (reveal ? 20 : 0) + (empties && top ? 15 : 0);
  }
  // Автосбор «Косынки»: всё открыто, колода пуста — карты по одной уходят в «дом»
  const canAuto = S => S.kind === 'k' && !S.won && !S.stock.length && !S.waste.length && S.tab.every(p => p.every(c => c.up));
  function autoMove(S){
    let best = null;
    S.tab.forEach((p, ti) => {
      const c = p[p.length - 1];
      if (c) for (let f = 0; f < 4; f++) if (canDrop(S, [c], 'f' + f) && (!best || c.r < best.r)) best = { from: 't' + ti, idx: p.length - 1, to: 'f' + f, r: c.r };
    });
    return best;
  }
  const finalScore = (S, sec) => S.kind === 'k' ? S.score + (S.won ? Math.round(700000 / Math.max(30, sec)) : 0) : S.score;
  function validState(S, kind){
    if (!S || S.kind !== kind || !Array.isArray(S.tab) || !Array.isArray(S.stock)) return false;
    if (kind === 'k' && (!Array.isArray(S.waste) || !Array.isArray(S.found) || S.found.length !== 4 || S.tab.length !== 7)) return false;
    if (kind === 's' && (!Array.isArray(S.done) || S.tab.length !== 10)) return false;
    const all = [...S.stock, ...S.tab.flat(), ...(kind === 'k' ? [...S.waste, ...S.found.flat()] : S.done.flat())], n = kind === 'k' ? 52 : 104;
    if (all.length !== n || new Set(all.map(c => c?.id)).size !== n) return false;
    return all.every(c => c && Number.isInteger(c.r) && c.r >= 0 && c.r < 13 && Number.isInteger(c.s) && c.s >= 0 && c.s < 4);
  }

  // ── Экран ──
  const CFG = {
    kosynka: { kind: 'k', save: 'd37_sol_kosynka', optKey: 'd37_sol_kosynka_draw', opts: [[1, 'По 1 карте'], [3, 'По 3 карты']], name: 'Косынка' },
    pauk:    { kind: 's', save: 'd37_sol_pauk', optKey: 'd37_sol_pauk_suits', opts: [[1, '1 масть'], [2, '2 масти'], [4, '4 масти']], name: 'Паук' },
  };
  const optOf = S => S.kind === 'k' ? S.draw : S.suits;
  const keyOf = S => S.kind === 'k' ? (S.draw === 3 ? 'kosynka3' : 'kosynka') : 'pauk' + S.suits;
  const coinsFor = S => S.kind === 'k' ? (S.draw === 3 ? 40 : 25) : ({ 1: 30, 2: 60, 4: 100 })[S.suits] || 30;
  const C = () => window.D37Coins;
  const num = n => Number(n || 0).toLocaleString('ru');
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const games = {};   // id → { root, api, T (стол), stopDuel }

  // Один стол. o: { S, hist, elapsed, duel, timeLimit, onScore(score), onEnd(score), onNew(opt) }
  function createTable(el, game, api, o){
    const cfg = CFG[game], me = {};
    let S = o.S, hist = o.hist || [], elapsed = o.elapsed || 0, runAt = 0, tick = 0, ended = false, stopped = false, auto = 0, hintT = 0;
    let W = 0, cw = 60, ch = 85, gap = 6, topH = 100, pos = new Map(), loc = new Map(), drag = null;
    const els = new Map(), slots = new Map();
    el.innerHTML = `<div class="sl ${S.kind === 'k' ? 'sl-kos' : 'sl-spd'}">
        <div class="sl-bar">
          <span class="sl-st">⏱ <b class="slTime">0:00</b></span><span class="sl-st">Ходов <b class="slMoves">0</b></span><span class="sl-st">Очки <b class="slScore">0</b></span>
          <span class="sl-btns"><button type="button" data-act="undo" title="Отменить ход (Ctrl+Z)">↶<span> Отменить</span></button><button type="button" data-act="hint" title="Подсказка">💡<span> Подсказка</span></button>${o.duel ? '<button type="button" data-act="giveup">🏁<span> Хватит</span></button>' : '<button type="button" data-act="new">↻<span> Новая</span></button>'}</span>
        </div>
        ${o.duel ? '' : `<div class="sl-opts">${cfg.opts.map(([v, t]) => `<button type="button" data-act="opt:${v}"${optOf(S) === v ? ' class="on"' : ''}>${t}</button>`).join('')}</div>`}
        <div class="sl-wrap"><div class="sl-board"></div><div class="sl-over" hidden></div></div>
        ${o.duel || S.kind !== 'k' ? '' : '<div class="ct-actions"><button type="button" class="ct-duel-btn" data-act="duel">⚔️ Наперегонки с другом</button></div>'}
      </div>`;
    const q = s => el.querySelector(s);
    const board = q('.sl-board'), ov = q('.sl-over');
    const colX = i => i * (cw + gap);
    const byId = () => { const m = new Map(); [S.stock, S.waste || [], ...(S.found || []), ...S.tab, ...(S.done || [])].forEach(p => p.forEach(c => m.set(c.id, c))); return m; };

    function layout(){
      const w = Math.round(board.clientWidth);
      if (!w || w === W) return;
      W = w;
      const cols = S.kind === 'k' ? 7 : 10;
      gap = Math.max(3, Math.round(w * (S.kind === 'k' ? .014 : .009)));
      cw = Math.floor((w - gap * (cols - 1)) / cols);
      ch = Math.round(cw * 1.42);
      topH = ch + Math.max(10, gap * 2);
      board.style.setProperty('--cw', cw + 'px');
      board.style.setProperty('--ch', ch + 'px');
      render(false);
    }
    function setSlot(id, x, y, label){
      let e = slots.get(id);
      if (!e) { e = document.createElement('div'); e.className = 'ssl'; e.dataset.pile = id; board.prepend(e); slots.set(id, e); }
      e.style.transform = `translate(${x}px,${y}px)`;
      if (e.textContent !== label) e.textContent = label;
    }
    function cardEl(c){
      let e = els.get(c.id);
      if (!e) {
        e = document.createElement('div');
        e.className = 'scd';
        e.dataset.id = c.id;
        e.innerHTML = `<div class="scd-f${red(c) ? ' red' : ''}"><b>${RANKS[c.r]}</b><i>${SUITS[c.s]}</i><u${c.r >= 10 ? ' class="fc"' : ''}>${c.r >= 10 ? RANKS[c.r] : SUITS[c.s]}</u></div>`;
        board.appendChild(e);
        els.set(c.id, e);
      }
      return e;
    }
    // Раскладка: где лежит каждая карта
    function render(animate = true){
      if (!W) return;
      const old = pos;
      pos = new Map(); loc = new Map();
      const put = (c, x, y, z, pid, idx) => { pos.set(c.id, { x, y, z }); loc.set(c.id, { pid, idx }); };
      if (S.kind === 'k') {
        setSlot('st', colX(0), 0, S.stock.length ? '' : S.waste.length ? '↻' : '');
        setSlot('w', colX(1), 0, '');
        for (let f = 0; f < 4; f++) setSlot('f' + f, colX(3 + f), 0, 'Т');
        S.stock.forEach((c, i) => put(c, colX(0), 0, 10 + i, 'st', i));
        const n = S.waste.length, fan = S.draw === 3 ? Math.min(3, n) : 1, step = Math.round(cw * .3);
        S.waste.forEach((c, i) => put(c, colX(1) + Math.max(0, i - (n - fan)) * step, 0, 100 + i, 'w', i));
        S.found.forEach((f, fi) => f.forEach((c, i) => put(c, colX(3 + fi), 0, 200 + i, 'f' + fi, i)));
      } else {
        setSlot('st', colX(9), 0, S.stock.length ? '' : '·');
        const step = Math.round(cw * .2);
        S.stock.forEach((c, i) => put(c, colX(9) - Math.floor(i / 10) * step, 0, 10 + i, 'st', i));
        const rs = Math.round(cw * .42);
        S.done.forEach((run, ri) => run.forEach((c, i) => put(c, ri * rs, 0, 100 + ri * 13 + i, 'dn', i)));
      }
      const avail = Math.max(ch * 4.2, (window.innerHeight || 700) - 170) - topH;
      let bottom = topH + ch;
      S.tab.forEach((p, ti) => {
        setSlot('t' + ti, colX(ti), topH, S.kind === 'k' ? 'К' : '');
        const downs = p.filter(c => !c.up).length, ups = p.length - downs;
        let dO = Math.max(4, Math.round(ch * .11)), uO = Math.max(11, Math.round(ch * (S.kind === 'k' ? .28 : .26)));
        const need = () => downs * dO + Math.max(0, ups - 1) * uO + ch;
        if (need() > avail && ups > 1) uO = Math.max(Math.round(ch * .17), Math.floor((avail - ch - downs * dO) / (ups - 1)));
        if (need() > avail && downs) dO = Math.max(3, Math.floor((avail - ch - Math.max(0, ups - 1) * uO) / downs));
        let y = topH;
        p.forEach((c, i) => { put(c, colX(ti), y, 300 + i, 't' + ti, i); if (i < p.length - 1) y += c.up ? uO : dO; });
        bottom = Math.max(bottom, y + ch);
      });
      board.style.height = bottom + 4 + 'px';
      const cards = byId();
      for (const [id, P] of pos) {
        const c = cards.get(id), e = cardEl(c), o2 = old.get(id), moved = o2 && (o2.x !== P.x || o2.y !== P.y);
        e.classList.toggle('up', !!c.up);
        e.classList.toggle('noanim', !animate);
        e.style.transform = `translate(${P.x}px,${P.y}px)`;
        // Едущая карта — поверх остальных, пока едет
        e.style.zIndex = animate && moved ? 1000 + P.z : P.z;
        if (animate && moved) setTimeout(() => { if (pos.get(id) === P) e.style.zIndex = P.z; }, 260);
      }
      stats();
    }
    function stats(){
      const s = secs();
      q('.slTime').textContent = o.duel ? mmss(Math.max(0, o.timeLimit - s)) : mmss(s);
      q('.slTime').parentNode.classList.toggle('low', !!o.duel && o.timeLimit - s <= 30);
      q('.slMoves').textContent = S.moves;
      q('.slScore').textContent = num(S.score);
      q('[data-act="undo"]').disabled = !hist.length || ended;
      if (o.duel && !ended && s >= o.timeLimit) finish('⏱ Время вышло!');
    }
    const secs = () => elapsed + (runAt ? (Date.now() - runAt) / 1000 : 0);
    function startClock(){ if (runAt || ended) return; runAt = Date.now(); clearInterval(tick); tick = setInterval(stats, 1000); }
    function stopClock(){ if (runAt) { elapsed = secs(); runAt = 0; } clearInterval(tick); }
    function save(){
      if (o.duel || ended) return;
      try { localStorage.setItem(cfg.save, JSON.stringify({ v: 1, S, hist: hist.slice(-60), elapsed: secs() })); } catch (e) {}
    }

    // Ход: снимок для отмены → применить → перерисовать, проверить конец
    function commit(apply){
      const snap = JSON.stringify(S), r = apply(S);
      if (!r) return r;
      hist.push(snap);
      if (hist.length > 400) hist.shift();
      startClock();
      api.sfx(r === 'recycle' ? 'move' : 'ok');
      render(true);
      save();
      o.onScore?.(finalScore(S, secs()));
      if (S.won) setTimeout(() => finish(), 350);
      else if (canAuto(S) && !auto) auto = setTimeout(autoStep, 300);
      return r;
    }
    function autoStep(){
      auto = 0;
      if (stopped || ended || S.won) return;
      const m = autoMove(S);
      if (m) commit(S2 => move(S2, m.from, m.idx, m.to));
    }
    function stockTap(){
      if (S.kind === 's' && S.stock.length && S.tab.some(p => !p.length)) { api.toast('Сначала положи карты во все пустые ряды'); api.sfx('bad'); return; }
      if (!commit(S2 => drawStock(S2))) api.sfx('bad');
    }
    function flash(ids, cls, ms = 1500){
      ids.forEach(id => { const e = typeof id === 'string' ? slots.get(id) : els.get(id); if (!e) return; e.classList.remove(cls); void e.offsetWidth; e.classList.add(cls); setTimeout(() => e.classList.remove(cls), ms); });
    }
    function tap(pid, idx){
      const to = bestTarget(S, pid, idx);
      if (!to || !commit(S2 => move(S2, pid, idx, to))) { flash(pile(S, pid).slice(idx).map(c => c.id), 'shake', 320); api.sfx('bad'); }
    }
    function showHint(){
      const h = hint(S);
      clearTimeout(hintT);
      if (!h) { api.toast(S.kind === 'k' ? 'Ходов больше нет — отмени несколько ходов или начни новую раздачу' : 'Ходов нет — отмени ходы или начни заново'); return; }
      if (h.stock) {
        const st = S.stock[S.stock.length - 1];
        flash(st ? [st.id] : ['st'], 'hint');
        api.toast(S.kind === 'k' ? (S.stock.length ? 'Возьми карту из колоды' : 'Переверни колоду ↻') : 'Раздай карты из колоды (справа вверху)');
        return;
      }
      const src = pile(S, h.from).slice(h.idx).map(c => c.id), dst = pile(S, h.to), top = dst[dst.length - 1];
      flash(src, 'hint');
      flash([top ? top.id : h.to], 'hint');
    }
    function undo(){
      if (!hist.length || ended || auto) return;
      S = JSON.parse(hist.pop());
      api.sfx('move');
      render(true);
      save();
      o.onScore?.(finalScore(S, secs()));
    }

    // ── Ввод ──
    const busy = () => ended || stopped || !ov.hidden || !!auto;
    board.addEventListener('pointerdown', e => {
      if (busy() || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const ce = e.target.closest('.scd'), se = e.target.closest('.ssl');
      if (ce) {
        const L = loc.get(+ce.dataset.id);
        if (!L || L.pid === 'dn') return;
        e.preventDefault();
        if (L.pid === 'st') { stockTap(); return; }
        if (!canPick(S, L.pid, L.idx)) { flash([+ce.dataset.id], 'shake', 320); return; }
        drag = { pid: L.pid, idx: L.idx, ids: pile(S, L.pid).slice(L.idx).map(c => c.id), x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false, pointer: e.pointerId };
        try { board.setPointerCapture(e.pointerId); } catch (err) {}
        return;
      }
      if (se?.dataset.pile === 'st') { e.preventDefault(); stockTap(); }
    });
    board.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.pointer) return;
      drag.dx = e.clientX - drag.x0; drag.dy = e.clientY - drag.y0;
      if (!drag.moved) {
        if (Math.hypot(drag.dx, drag.dy) < 7) return;
        drag.moved = true;
        drag.ids.forEach((id, k) => { const c = els.get(id); c.classList.add('drag'); c.style.zIndex = 3000 + k; });
      }
      drag.ids.forEach(id => { const P = pos.get(id); els.get(id).style.transform = `translate(${P.x + drag.dx}px,${P.y + drag.dy}px)`; });
    });
    function drop(e, cancel){
      if (!drag || e.pointerId !== drag.pointer) return;
      const d = drag;
      drag = null;
      d.ids.forEach(id => els.get(id)?.classList.remove('drag'));
      if (cancel) { render(true); return; }
      if (!d.moved) { tap(d.pid, d.idx); return; }
      const P = pos.get(d.ids[0]), to = target(d.pid, d.idx, P.x + d.dx + cw / 2, P.y + d.dy + ch / 2);
      if (!to || !commit(S2 => move(S2, d.pid, d.idx, to))) render(true);
    }
    board.addEventListener('pointerup', e => drop(e, false));
    board.addEventListener('pointercancel', e => drop(e, true));
    // Ближайшая подходящая стопка к центру перетаскиваемой карты
    function target(from, idx, cx, cy){
      const cards = pile(S, from).slice(idx), ids = [...(S.kind === 'k' ? ['f0', 'f1', 'f2', 'f3'] : []), ...S.tab.map((_, i) => 't' + i)];
      let best = null, bd = Infinity;
      for (const id of ids) {
        if (id === from || !canDrop(S, cards, id)) continue;
        let r;
        if (id[0] === 'f') r = { x: colX(3 + +id.slice(1)), y: 0, w: cw, h: ch };
        else { const p = pile(S, id), last = p[p.length - 1]; r = { x: colX(+id.slice(1)), y: topH, w: cw, h: (last ? pos.get(last.id).y : topH) + ch - topH }; }
        const dx = Math.max(r.x - cx, 0, cx - r.x - r.w), dy = Math.max(r.y - cy, 0, cy - r.y - r.h), dd = Math.hypot(dx, dy);
        if (dd < bd) { bd = dd; best = id; }
      }
      return bd <= cw * .9 ? best : null;
    }
    function onKey(e){
      if (!el.isConnected || e.target?.closest?.('input,textarea,[contenteditable]')) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'я' || e.code === 'KeyZ')) { e.preventDefault(); undo(); }
    }
    window.addEventListener('keydown', onKey);

    // ── Конец партии ──
    const showOv = html => { ov.innerHTML = html; ov.hidden = false; };
    const hideOv = () => { ov.hidden = true; ov.innerHTML = ''; };
    async function finish(title){
      if (ended) return;
      ended = true;
      stopClock(); clearTimeout(auto); auto = 0;
      const sec = secs(), sc = finalScore(S, sec);
      stats();
      if (o.duel) {
        api.sfx(S.won ? 'win' : 'bad');
        showOv(`<div class="sl-t">${S.won ? '🎉 Пасьянс сошёлся!' : title || '🏁 Готово'}</div><div class="sl-big">${num(sc)}</div><div class="sl-s">${S.found ? S.found.reduce((a, f) => a + f.length, 0) : 0} карт в доме · ${mmss(sec)}</div><div class="sl-s">Итог соревнования — сверху</div>`);
        o.onEnd?.(sc);
        return;
      }
      try { localStorage.removeItem(cfg.save); } catch (e) {}
      const prevBest = api.local().best || 0, coins = coinsFor(S), runId = 's' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
      api.report(keyOf(S), true, sc, sc);
      api.sfx('win');
      board.classList.add('won');
      showOv(`<div class="sl-t">🎉 Пасьянс сошёлся!</div>
        <div class="sl-big">${num(sc)}</div>
        <div class="sl-s">⏱ ${mmss(sec)} · ходов: ${S.moves}${sc > prevBest ? ' · 🏆 рекорд!' : ''}</div>
        <div class="sl-coins">${C() ? `🪙 +${coins} монет…` : ''}</div>
        <div class="ct-actions"><button type="button" class="ct-start" data-act="again">↻ Новая раздача</button>${S.kind === 'k' ? '<button type="button" class="ct-duel-btn" data-act="duel">⚔️ С другом</button>' : ''}<button type="button" data-act="share">📤 Поделиться</button></div>`);
      if (!C()) return;
      const r = await C().run(game, coins, runId);
      const box = ov.querySelector('.sl-coins');
      if (!box || stopped) return;
      if (!r?.ok) { box.textContent = r?.reason === 'day_cap' ? '🪙 Лимит монет за игры на сегодня исчерпан' : r?.reason === 'too_fast' ? '🪙 Слишком быстро для монет' : '🪙 Монеты не начислились — проверь интернет'; return; }
      box.innerHTML = `🪙 <b>+${num(r.got)}</b> монет${r.base && r.got > r.base ? ' <span class="hd-vip">VIP ×2</span>' : ''}`;
      if (window.D37Ads?.rewardReady?.() && C().canDouble()) box.insertAdjacentHTML('afterend', `<button type="button" class="hd-x2" data-act="x2" data-run="${runId}">📺 Смотреть рекламу → ещё +${num(r.base || r.got)} 🪙</button>`);
    }
    // Новая раздача: незаконченная партия засчитывается как проигрыш
    function askNew(opt){
      const go = opt ?? optOf(S);
      if (ended || !S.moves) { newDeal(go, false); return; }
      showOv(`<div class="sl-t">Начать новую раздачу?</div><div class="sl-s">Эта партия засчитается как несыгранная.</div>
        <div class="sl-col"><button type="button" class="ct-start" data-act="newyes:${go}">↻ Новая раздача</button><button type="button" class="hd-alt" data-act="resume">↩ Играть дальше</button></div>`);
    }
    async function newDeal(opt, lost){
      if (lost && !ended) { ended = true; stopClock(); api.report(keyOf(S), false, 0, 0); }
      try { localStorage.removeItem(cfg.save); localStorage.setItem(cfg.optKey, String(opt)); } catch (e) {}
      if (ended) { try { await window.D37Ads?.interstitial?.(game); } catch (e) {} }
      if (!stopped) o.onNew?.(opt);
    }
    async function share(btn){
      const text = `Разложил пасьянс «${cfg.name}» за ${mmss(secs())} — ${num(finalScore(S, secs()))} очков. Попробуй быстрее!`, url = location.origin + '/games/' + game;
      if (navigator.share) { navigator.share({ title: cfg.name, text, url }).catch(() => {}); return; }
      try { await navigator.clipboard.writeText(text + ' ' + url); btn.textContent = '✅ Скопировано'; } catch (e) { prompt('Скопируй и отправь другу:', text + ' ' + url); }
    }
    async function doubleCoins(btn){
      btn.disabled = true;
      if (!await window.D37Ads.showReward(game + '_x2')) { api.toast('Реклама не досмотрена — бонуса нет'); btn.disabled = false; return; }
      const r = await C().double(btn.dataset.run);
      if (r?.ok) { api.sfx('win'); api.toast(`📺 +${num(r.got)} 🪙 — спасибо!`); btn.remove(); }
      else { api.toast('Не получилось — попробуй ещё раз'); btn.disabled = false; }
    }
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || !el.contains(b) || stopped) return;
      const a = b.dataset.act;
      if (a === 'undo') undo();
      else if (a === 'hint') { if (!busy()) showHint(); }
      else if (a === 'new') askNew();
      else if (a.startsWith('opt:')) { if (+a.slice(4) !== optOf(S) || ended) askNew(+a.slice(4)); }
      else if (a.startsWith('newyes:')) newDeal(+a.slice(7), true);
      else if (a === 'resume') hideOv();
      else if (a === 'again') { b.disabled = true; newDeal(optOf(S), false); }
      else if (a === 'giveup') finish('🏁 Готово');
      else if (a === 'duel') location.hash = '#/games/' + game + '/' + GameRoom.newCode();
      else if (a === 'share') share(b);
      else if (a === 'x2') doubleCoins(b);
    });

    const ro = window.ResizeObserver ? new ResizeObserver(() => layout()) : null;
    ro?.observe(board);
    window.addEventListener('resize', layout);
    layout();
    if (o.duel) startClock();
    else if (S.moves && elapsed) stats();
    me.stop = () => {
      stopped = true;
      if (!ended) { stopClock(); save(); }
      clearInterval(tick); clearTimeout(auto); clearTimeout(hintT);
      ro?.disconnect();
      window.removeEventListener('resize', layout);
      window.removeEventListener('keydown', onKey);
    };
    me.state = () => S;
    me.setState = s => { S = s; hist = []; render(false); };   // для проверок
    me.debug = () => ({ W, cw, ch, gap, topH, ended, hist: hist.length, pos: Object.fromEntries([...pos].slice(0, 3)) });
    me.pos = id => pos.get(id);
    return me;
  }

  function load(game){
    try {
      const d = JSON.parse(localStorage.getItem(CFG[game].save) || 'null');
      if (!d || d.v !== 1 || !validState(d.S, CFG[game].kind) || d.S.won) return null;
      return { S: d.S, hist: Array.isArray(d.hist) ? d.hist.filter(h => typeof h === 'string') : [], elapsed: Math.max(0, +d.elapsed || 0) };
    } catch (e) { return null; }
  }
  function prefOpt(game){
    let v = 0;
    try { v = +localStorage.getItem(CFG[game].optKey); } catch (e) {}
    return CFG[game].opts.some(([x]) => x === v) ? v : CFG[game].opts[0][0];
  }
  function solo(game, fresh, opt){
    const g = games[game];
    g.T?.stop();
    const saved = !fresh && load(game);
    const o2 = opt || prefOpt(game);
    const S = saved ? saved.S : CFG[game].kind === 'k' ? dealKlondike(Math.random, o2) : dealSpider(Math.random, o2);
    g.T = createTable(g.root, game, g.api, { S, hist: saved?.hist, elapsed: saved?.elapsed, onNew: v => solo(game, true, v) });
    if (saved && saved.S.moves) g.api.toast('▶ Продолжаем прошлую партию');
  }
  function register(game){
    window.GAME_IMPL[game] = {
      mount(el, api){
        const g = games[game] = { root: el, api, T: null, stopDuel: null };
        if (game === 'kosynka' && window.GameRoom?.validCode(api.param)) {
          g.stopDuel = Versus.start(el, api, game, api.param, {
            run(stage, rand, hooks){
              g.T?.stop();
              stage.insertAdjacentHTML('afterbegin', `<div class="ct-note" style="text-align:center">⏱ ${DUEL_SEC / 60} минут · одинаковая раздача у обоих · у кого больше очков (сошёлся пасьянс — бонус за время)</div>`);
              const host = document.createElement('div');
              stage.appendChild(host);
              g.T = createTable(host, game, api, { S: dealKlondike(rand, 1), duel: true, timeLimit: DUEL_SEC, onScore: hooks.progress, onEnd: score => hooks.done(score) });
            },
            stop(){ g.T?.stop(); g.T = null; },
          });
        } else solo(game, false);
      },
      unmount(){ const g = games[game]; if (!g) return; g.T?.stop(); g.T = null; g.stopDuel?.(); delete games[game]; },
      get table(){ return games[game]?.T; },
      _test: { dealKlondike, dealSpider, pile, canPick, canDrop, move, drawStock, collect, bestTarget, hint, canAuto, autoMove, finalScore, validState, RANKS, SUITS },
    };
  }
  register('kosynka');
  register('pauk');
})();
