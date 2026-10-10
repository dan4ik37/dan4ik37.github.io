// ═══════════════════════════════════════
//  ИГРА «БЛОКИ» — головоломка как Block Blast: ставь фигуры на поле 8×8, собирай полные ряды и столбцы
// ═══════════════════════════════════════
// Внизу 3 фигуры; поставил все три — дают новые. Ни одна не помещается — конец (один раз за игру можно
// взять новые фигуры: за рекламу или за 30 монет). Очки: +1 за клетку фигуры; линии разом — 40·L·(L+1)
// (1 → 80, 2 → 240, 3 → 480), × комбо (линии хотя бы раз за 3 хода подряд: ×1,5, ×2… до ×5); пустое поле +300.
// Одиночная партия сохраняется (localStorage d37_blocks_save) — можно закрыть и продолжить.
// «⚔️ Соревнование» (versus.js): у обоих одни и те же фигуры (общий seed, без подсказок), 3 минуты — у кого больше.
// Движок без DOM — GAME_IMPL.blocks._test (проверять в node).
(() => {
  const N = 8, DUEL_SEC = 180, WIN = 2000, COIN_DIV = 50, COIN_MAX = 150, SAVE = 'd37_blocks_save';
  const COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];
  // «#» — клетка, «.» — пусто, «|» — новая строка; число — как часто выпадает
  const DEFS = [
    ['#', 2],
    ['##', 3], ['#|#', 3], ['###', 3], ['#|#|#', 3], ['####', 2], ['#|#|#|#', 2], ['#####', 1], ['#|#|#|#|#', 1],
    ['##|##', 4], ['###|###|###', 1], ['###|###', 2], ['##|##|##', 2],
    ['##|#.', 2], ['##|.#', 2], ['#.|##', 2], ['.#|##', 2],
    ['###|#..|#..', 1], ['###|..#|..#', 1], ['#..|#..|###', 1], ['..#|..#|###', 1],
    ['###|.#.', 2], ['.#.|###', 2], ['#.|##|#.', 2], ['.#|##|.#', 2],
    ['.##|##.', 1], ['##.|.##', 1], ['#.|##|.#', 1], ['.#|##|#.', 1],
    ['#.|#.|##', 1], ['.#|.#|##', 1], ['##|#.|#.', 1], ['##|.#|.#', 1], ['###|#..', 1], ['###|..#', 1], ['#..|###', 1], ['..#|###', 1],
  ];
  const SHAPES = DEFS.map(([pic, weight], i) => {
    const rows = pic.split('|'), cells = [];
    rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '#') cells.push([r, c]); }));
    return { i, cells, h: rows.length, w: Math.max(...rows.map(x => x.length)), weight };
  });
  const TOTAL = SHAPES.reduce((s, x) => s + x.weight, 0);
  const pick = rand => { let x = rand() * TOTAL; for (const s of SHAPES) { x -= s.weight; if (x < 0) return s.i; } return 0; };

  // ── Движок (без DOM) ──
  function fits(board, si, r0, c0){
    const s = SHAPES[si];
    if (!s || r0 < 0 || c0 < 0 || r0 + s.h > N || c0 + s.w > N) return false;
    for (const [r, c] of s.cells) if (board[(r0 + r) * N + c0 + c]) return false;
    return true;
  }
  function fitsAnywhere(board, si){
    const s = SHAPES[si];
    for (let r = 0; r + s.h <= N; r++) for (let c = 0; c + s.w <= N; c++) if (fits(board, si, r, c)) return true;
    return false;
  }
  const canMove = G => G.tray.some(si => si != null && fitsAnywhere(G.board, si));
  function fullLines(board){
    const rows = [], cols = [];
    for (let k = 0; k < N; k++) {
      let r = true, c = true;
      for (let j = 0; j < N; j++) { if (!board[k * N + j]) r = false; if (!board[j * N + k]) c = false; }
      if (r) rows.push(k);
      if (c) cols.push(k);
    }
    return { rows, cols };
  }
  // Какие линии соберутся, если поставить фигуру сюда (для подсветки)
  function preview(board, si, r0, c0){
    const b = board.slice();
    for (const [r, c] of SHAPES[si].cells) b[(r0 + r) * N + c0 + c] = 9;
    return fullLines(b);
  }
  function newGame(rand, help){
    const G = { board: Array(N * N).fill(0), tray: [null, null, null], colors: [0, 1, 2], score: 0, combo: 0, since: 0, moves: 0, lines: 0, deals: 0, revived: false, over: false, help: !!help, rand };
    deal(G);
    return G;
  }
  // Новая тройка. С подсказкой (одиночная игра): если ни одна не встаёт — тянем заново (до 6 раз).
  // В соревновании подсказки нет: у обоих ровно одна и та же последовательность фигур
  function deal(G){
    let t, tries = G.help ? 6 : 1;
    do t = [pick(G.rand), pick(G.rand), pick(G.rand)];
    while (--tries > 0 && !t.some(si => fitsAnywhere(G.board, si)));
    G.tray = t;
    G.colors = [0, 1, 2].map(k => (G.deals * 3 + k) % COLORS.length);
    G.deals++;
  }
  // Поставить фигуру из ячейки slot левым верхним углом в (r0, c0). null — нельзя
  function place(G, slot, r0, c0){
    const si = G.tray[slot];
    if (G.over || si == null || !fits(G.board, si, r0, c0)) return null;
    const s = SHAPES[si], col = G.colors[slot] + 1;
    for (const [r, c] of s.cells) G.board[(r0 + r) * N + c0 + c] = col;
    G.tray[slot] = null;
    G.moves++;
    const { rows, cols } = fullLines(G.board), L = rows.length + cols.length, gone = [];
    let bonus = 0, perfect = false;
    if (L) {
      const set = new Set();
      rows.forEach(r => { for (let c = 0; c < N; c++) set.add(r * N + c); });
      cols.forEach(c => { for (let r = 0; r < N; r++) set.add(r * N + c); });
      for (const i of set) { gone.push([i, G.board[i]]); G.board[i] = 0; }
      G.combo++; G.since = 0;
      bonus = Math.round(40 * L * (L + 1) * (1 + (Math.min(G.combo, 9) - 1) / 2));
      G.lines += L;
      if (G.board.every(v => !v)) { perfect = true; bonus += 300; }
    } else if (++G.since >= 3) G.combo = 0;
    const gained = s.cells.length + bonus;
    G.score += gained;
    if (G.tray.every(x => x == null)) deal(G);
    G.over = !canMove(G);
    return { si, slot, r0, c0, col, rows, cols, L, gone, gained, bonus, combo: L ? G.combo : 0, perfect };
  }
  function clearsLine(board, si){
    const s = SHAPES[si];
    for (let r = 0; r + s.h <= N; r++) for (let c = 0; c + s.w <= N; c++) {
      if (!fits(board, si, r, c)) continue;
      const f = preview(board, si, r, c);
      if (f.rows.length + f.cols.length) return true;
    }
    return false;
  }
  // Новые фигуры после «не помещается» (за рекламу или монеты): три маленькие, которые точно встанут,
  // лучше — те, что сразу собирают линию. Одна точка встанет всегда: полностью занятого поля не бывает
  function rescue(G){
    const ok = SHAPES.filter(s => s.cells.length <= 3 && fitsAnywhere(G.board, s.i)).map(s => s.i);
    const good = ok.filter(si => clearsLine(G.board, si));
    const pool = good.length ? good : ok.length ? ok : [0];
    G.tray = [0, 1, 2].map(() => pool[Math.floor(G.rand() * pool.length)]);
    G.colors = [0, 1, 2].map(k => (G.deals * 3 + k) % COLORS.length);
    G.deals++;
    G.revived = true;
    G.over = false;
  }

  // ── Сохранение одиночной партии ──
  function saveGame(G){
    try { localStorage.setItem(SAVE, JSON.stringify({ v: 1, board: G.board, tray: G.tray, colors: G.colors, score: G.score, combo: G.combo, since: G.since, moves: G.moves, lines: G.lines, deals: G.deals, revived: G.revived })); } catch (e) {}
  }
  function dropSave(){ try { localStorage.removeItem(SAVE); } catch (e) {} }
  function loadGame(){
    try {
      const d = JSON.parse(localStorage.getItem(SAVE) || 'null');
      if (!d || d.v !== 1) return null;
      const cellOk = v => Number.isInteger(v) && v >= 0 && v <= COLORS.length;
      if (!Array.isArray(d.board) || d.board.length !== N * N || !d.board.every(cellOk)) return null;
      if (!Array.isArray(d.tray) || d.tray.length !== 3 || !d.tray.every(si => si === null || (Number.isInteger(si) && SHAPES[si]))) return null;
      if (d.tray.every(si => si === null)) return null;
      const G = newGame(Math.random, true), n = v => Math.max(0, Math.floor(Number(v) || 0));
      Object.assign(G, {
        board: d.board, tray: d.tray,
        colors: Array.isArray(d.colors) && d.colors.length === 3 ? d.colors.map(c => n(c) % COLORS.length) : [0, 1, 2],
        score: n(d.score), combo: n(d.combo), since: n(d.since), moves: n(d.moves), lines: n(d.lines), deals: n(d.deals) || 1, revived: !!d.revived,
      });
      G.over = !canMove(G);
      return G;
    } catch (e) { return null; }
  }

  // ── Экран ──
  let root, api, B = null, stopDuel = null;
  const C = () => window.D37Coins;
  const num = n => Number(n || 0).toLocaleString('ru');
  function rr(g, x, y, w, h, r){
    g.beginPath();
    if (g.roundRect) { g.roundRect(x, y, w, h, r); return; }
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  // Одна доска в el. opt: { G, duel, timeLimit, onScore(score), onEnd(score), onNew() }
  function createBoard(el, opt){
    const G = opt.G, me = { G };
    el.innerHTML = `<div class="bl">
        <div class="ct-top"><span class="ct-score">Счёт: <b class="blScore">0</b></span><span class="ct-score bl-combo blCombo"></span>
          ${opt.duel ? '<span class="ct-timer blTimer"></span>' : '<span class="ct-score">Рекорд: <b class="blBest">0</b></span><button type="button" class="g2-new" data-act="new">↻ Заново</button>'}</div>
        <div class="bl-wrap"><canvas class="bl-cv" aria-label="Поле 8 на 8 и три фигуры под ним"></canvas><div class="bl-over" hidden></div></div>
        <div class="ct-note bl-note">Перетащи фигуру на поле — или нажми на фигуру, потом на клетку. Полный ряд или столбец исчезает.</div>
        ${opt.duel ? '' : '<div class="ct-actions"><button type="button" class="ct-duel-btn" data-act="duel">⚔️ Соревноваться с другом</button></div>'}
      </div>`;
    const q = s => el.querySelector(s);
    const cv = q('.bl-cv'), wrap = q('.bl-wrap'), ov = q('.bl-over'), ctx = cv.getContext('2d'), sprites = new Map();
    let W = 0, H = 0, dpr = 1, cs = 40, bx = 0, by = 0, ty = 0, th = 0, lastW = 0;
    let drag = null, sel = null, hover = null, fx = [], texts = [], raf = 0, timer = 0, overT = 0, left = opt.timeLimit || 0, ended = false, stopped = false;

    function layout(){
      const w = Math.round(Math.min(wrap.clientWidth || 0, 440));
      if (!w || w === lastW) return;
      lastW = w;
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const pad = Math.round(w * .03);
      cs = Math.floor((w - pad * 2) / N);
      bx = Math.round((w - cs * N) / 2); by = pad + 2;
      ty = by + cs * N + Math.round(cs * .45); th = Math.round(cs * 2.8);
      W = w; H = ty + th + pad;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.height = H + 'px';
      sprites.clear();
      draw();
    }
    // Картинка одного кубика (с объёмом) — рисуется один раз на цвет и размер. ci = −1 — серый (фигура не встаёт)
    function sprite(ci, size){
      const key = ci + ':' + size;
      let c = sprites.get(key);
      if (c) return c;
      c = document.createElement('canvas'); c.width = c.height = size;
      const g = c.getContext('2d'), p = Math.max(1, Math.round(size * .04)), r = size * .17;
      rr(g, p, p, size - p * 2, size - p * 2, r);
      g.fillStyle = ci < 0 ? '#4b5068' : COLORS[ci]; g.fill();
      const gr = g.createLinearGradient(0, p, 0, size - p);
      gr.addColorStop(0, 'rgba(255,255,255,.45)'); gr.addColorStop(.45, 'rgba(255,255,255,.05)'); gr.addColorStop(1, 'rgba(0,0,0,.3)');
      g.fillStyle = gr; g.fill();
      g.lineWidth = Math.max(1, size * .045); g.strokeStyle = 'rgba(0,0,0,.28)'; g.stroke();
      rr(g, size * .25, size * .2, size * .5, size * .5, r * .7); g.fillStyle = 'rgba(255,255,255,.16)'; g.fill();
      sprites.set(key, c);
      return c;
    }
    const slotX = k => k * W / 3;
    function dragTopLeft(d){
      const s = SHAPES[G.tray[d.slot]], lift = d.touch ? s.h * cs / 2 + cs * 1.1 : 0;
      return { x: d.x - s.w * cs / 2, y: d.y - lift - s.h * cs / 2 };
    }
    // Клетка под курсором → куда встанет выбранная фигура (центром в эту клетку, прижатая к краям поля)
    function anchorAt(si, x, y){
      const c = Math.floor((x - bx) / cs), r = Math.floor((y - by) / cs);
      if (r < 0 || c < 0 || r >= N || c >= N) return null;
      const s = SHAPES[si];
      return { r0: Math.max(0, Math.min(N - s.h, r - Math.floor((s.h - 1) / 2))), c0: Math.max(0, Math.min(N - s.w, c - Math.floor((s.w - 1) / 2))) };
    }
    function ghost(){
      let slot, a;
      if (drag?.moved) { slot = drag.slot; const p = dragTopLeft(drag); a = { r0: Math.round((p.y - by) / cs), c0: Math.round((p.x - bx) / cs) }; }
      else if (sel != null && hover) { slot = sel; a = anchorAt(G.tray[sel], hover.x, hover.y); }
      const si = slot == null ? null : G.tray[slot];
      if (si == null || !a || !fits(G.board, si, a.r0, a.c0)) return null;
      return { si, ...a, ci: G.colors[slot], lines: preview(G.board, si, a.r0, a.c0) };
    }

    function draw(){
      if (!W || stopped) return;
      const now = performance.now(), sz = Math.round(cs * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      rr(ctx, bx - 5, by - 5, cs * N + 10, cs * N + 10, 12); ctx.fillStyle = '#141838'; ctx.fill();
      ctx.fillStyle = '#20264f';
      for (let i = 0; i < N * N; i++) { rr(ctx, bx + (i % N) * cs + 1.5, by + Math.floor(i / N) * cs + 1.5, cs - 3, cs - 3, cs * .15); ctx.fill(); }
      const gh = ghost(), hl = new Set();
      if (gh) {
        gh.lines.rows.forEach(r => { for (let c = 0; c < N; c++) hl.add(r * N + c); });
        gh.lines.cols.forEach(c => { for (let r = 0; r < N; r++) hl.add(r * N + c); });
      }
      for (let i = 0; i < N * N; i++) {
        const v = G.board[i];
        if (v) ctx.drawImage(sprite(hl.has(i) ? gh.ci : v - 1, sz), bx + (i % N) * cs, by + Math.floor(i / N) * cs, cs, cs);
      }
      if (gh) {
        for (const [r, c] of SHAPES[gh.si].cells) {
          const i = (gh.r0 + r) * N + gh.c0 + c;
          ctx.globalAlpha = hl.has(i) ? .85 : .4;
          ctx.drawImage(sprite(gh.ci, sz), bx + (gh.c0 + c) * cs, by + (gh.r0 + r) * cs, cs, cs);
        }
        ctx.globalAlpha = 1;
      }
      // Собранные линии исчезают: вспышка и сжатие
      fx = fx.filter(f => now - f.t < 400);
      for (const f of fx) {
        const k = (now - f.t) / 400, s = cs * (1 - k * .7);
        for (const [i, v] of f.cells) {
          const x = bx + (i % N) * cs + (cs - s) / 2, y = by + Math.floor(i / N) * cs + (cs - s) / 2;
          ctx.globalAlpha = 1 - k;
          ctx.drawImage(sprite(v - 1, sz), x, y, s, s);
          ctx.globalAlpha = (1 - k) * .55; ctx.fillStyle = '#fff';
          rr(ctx, x, y, s, s, s * .17); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      // Фигуры внизу (не встаёт никуда — серая)
      const ts = cs * .5, tsz = Math.round(ts * dpr);
      for (let k = 0; k < 3; k++) {
        const si = G.tray[k];
        if (si == null || (drag?.moved && drag.slot === k)) continue;
        const s = SHAPES[si], cx = slotX(k) + W / 6, cy = ty + th / 2, ok = fitsAnywhere(G.board, si);
        if (sel === k) {
          rr(ctx, slotX(k) + 6, ty, W / 3 - 12, th, 14);
          ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(250,204,21,.8)'; ctx.stroke();
        }
        const x0 = cx - s.w * ts / 2, y0 = cy - s.h * ts / 2;
        for (const [r, c] of s.cells) ctx.drawImage(sprite(ok ? G.colors[k] : -1, tsz), x0 + c * ts, y0 + r * ts, ts, ts);
      }
      if (drag?.moved) {
        const s = SHAPES[G.tray[drag.slot]], p = dragTopLeft(drag);
        ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 6;
        for (const [r, c] of s.cells) ctx.drawImage(sprite(G.colors[drag.slot], sz), p.x + c * cs, p.y + r * cs, cs, cs);
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      }
      // Всплывающие надписи: очки, комбо
      texts = texts.filter(t => now - t.t < 1000);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      for (const t of texts) {
        const k = (now - t.t) / 1000, y = t.y - k * cs;
        ctx.globalAlpha = Math.min(1, (1 - k) * 2.5);
        ctx.font = `900 ${t.size}px Montserrat, sans-serif`;
        ctx.lineWidth = Math.max(3, t.size / 6); ctx.strokeStyle = 'rgba(10,8,30,.75)'; ctx.strokeText(t.text, t.x, y);
        ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, y);
      }
      ctx.globalAlpha = 1;
      if ((fx.length || texts.length) && !raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
    }

    function ui(){
      q('.blScore').textContent = num(G.score);
      const b = q('.blBest'); if (b) b.textContent = num(Math.max(api.local().best || 0, G.score));
      q('.blCombo').textContent = G.combo >= 2 ? `🔥 комбо ×${G.combo}` : '';
    }
    const showOv = html => { ov.innerHTML = html; ov.hidden = false; };
    const hideOv = () => { ov.hidden = true; ov.innerHTML = ''; };

    function tryPlace(slot, r0, c0){
      const res = place(G, slot, r0, c0);
      if (!res) return false;
      sel = null; hover = null;
      const now = performance.now(), s = SHAPES[res.si];
      if (res.gone.length) fx.push({ t: now, cells: res.gone });
      if (res.L) {
        texts.push({ text: '+' + res.gained, x: bx + (c0 + s.w / 2) * cs, y: by + (r0 + s.h / 2) * cs, t: now, size: Math.round(cs * .55), color: '#fff' });
        const word = res.L >= 4 ? 'Невероятно!' : res.L === 3 ? 'Отлично!' : res.L === 2 ? 'Здорово!' : '';
        if (res.combo >= 2 || word) texts.push({ text: res.combo >= 2 ? `Комбо ×${res.combo}${word ? ' · ' + word : ''}` : word, x: W / 2, y: by + cs * 2.6, t: now + 60, size: Math.round(cs * .62), color: '#facc15' });
        if (res.perfect) texts.push({ text: 'Чистое поле! +300', x: W / 2, y: by + cs * 4.4, t: now + 120, size: Math.round(cs * .6), color: '#4ade80' });
        api.sfx(res.perfect || res.combo >= 3 || res.L >= 3 ? 'win' : 'ok');
      } else api.sfx('move');
      ui();
      opt.onScore?.(G.score);
      if (!opt.duel) saveGame(G);
      draw();
      if (G.over) { clearTimeout(overT); overT = setTimeout(() => { if (!stopped) outOfMoves(); }, 650); }
      return true;
    }

    // ── Ввод: перетаскивание или «нажми фигуру → нажми клетку» ──
    const pos = e => { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) * W / (b.width || W), y: (e.clientY - b.top) * H / (b.height || H) }; };
    const busy = () => ended || stopped || G.over || !ov.hidden;
    cv.addEventListener('pointerdown', e => {
      if (busy() || !W) return;
      const p = pos(e);
      if (p.y >= ty - cs * .3) {
        const k = Math.max(0, Math.min(2, Math.floor(p.x / (W / 3))));
        if (G.tray[k] == null) return;
        drag = { slot: k, x: p.x, y: p.y, sx: p.x, sy: p.y, touch: e.pointerType !== 'mouse', moved: false, id: e.pointerId };
        try { cv.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
        return;
      }
      if (sel != null) {
        const a = anchorAt(G.tray[sel], p.x, p.y);
        if (a && !tryPlace(sel, a.r0, a.c0)) api.sfx('bad');
      }
    });
    cv.addEventListener('pointermove', e => {
      if (!W) return;
      const p = pos(e);
      if (drag && e.pointerId === drag.id) {
        drag.x = p.x; drag.y = p.y;
        if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) > 8) { drag.moved = true; sel = null; }
        if (drag.moved) draw();
        return;
      }
      if (sel != null && e.pointerType === 'mouse') { hover = p; draw(); }
    });
    cv.addEventListener('pointerup', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (!d.moved) { sel = sel === d.slot ? null : d.slot; hover = null; draw(); return; }
      const p = dragTopLeft(d);
      if (!tryPlace(d.slot, Math.round((p.y - by) / cs), Math.round((p.x - bx) / cs))) draw();
    });
    cv.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.id) { drag = null; draw(); } });
    cv.addEventListener('pointerleave', () => { if (hover) { hover = null; draw(); } });

    // ── Конец игры ──
    function outOfMoves(){
      if (ended || !G.over) return;
      if (opt.duel || G.revived) { end(); return; }
      const adOk = !!window.D37Ads?.rewardReady?.(), price = C()?.RULES?.revive ?? 30, coins = C()?.coins?.() ?? 0;
      api.sfx('bad');
      showOv(`<div class="bl-t">😬 Фигуры не помещаются!</div>
        <div class="bl-s">Счёт: <b>${num(G.score)}</b>. Взять три новые фигуры? Можно один раз за игру.</div>
        <div class="bl-col">
          ${adOk ? '<button type="button" class="ct-start" data-act="rv-ad">📺 Посмотреть рекламу → новые фигуры</button>' : ''}
          ${C() ? `<button type="button" class="${adOk ? 'hd-alt' : 'ct-start'}" data-act="rv-coins"${coins >= price ? '' : ' disabled'}>🪙 Новые фигуры за ${price} монет</button>` : ''}
          <button type="button" class="hd-alt" data-act="end">🏁 Закончить игру</button>
        </div>
        ${!C() || coins >= price ? '' : `<div class="bl-s">У тебя ${num(coins)} 🪙 — монеты дают за победы в играх и бонус дня.</div>`}`);
    }
    async function revive(how){
      if (ended || !G.over || G.revived) return;
      ov.querySelectorAll('button').forEach(b => { b.disabled = true; });
      if (how === 'ad') {
        if (!await window.D37Ads.showReward('blocks_revive')) { api.toast('Реклама не досмотрена — новых фигур нет'); outOfMoves(); return; }
      } else {
        const r = await C().revive('blocks');
        if (!r?.ok) { api.toast(r?.reason === 'coins' ? 'Не хватает монет' : 'Не получилось — попробуй ещё раз'); outOfMoves(); return; }
      }
      if (stopped) return;
      rescue(G);
      saveGame(G);
      hideOv();
      api.sfx('win');
      texts.push({ text: '✨ Новые фигуры!', x: W / 2, y: ty - cs * .1, t: performance.now(), size: Math.round(cs * .55), color: '#facc15' });
      draw();
    }
    async function end(title){
      if (ended) return;
      ended = true; drag = null; sel = null;
      clearInterval(timer); clearTimeout(overT);
      draw();
      if (opt.duel) {
        api.sfx('bad');
        showOv(`<div class="bl-t">${title || '😬 Фигуры не помещаются!'}</div><div class="bl-big">${num(G.score)}</div><div class="bl-s">Итог соревнования — сверху</div>`);
        opt.onEnd?.(G.score);
        return;
      }
      dropSave();
      const sc = G.score, prevBest = api.local().best || 0, rec = sc > prevBest && sc > 0;
      const coins = Math.min(COIN_MAX, Math.floor(sc / COIN_DIV)), runId = 'b' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
      api.report('blocks', sc >= WIN, sc, sc);
      api.sfx(rec ? 'win' : 'bad');
      showOv(`<div class="bl-t">${rec ? '🏆 Новый рекорд!' : '🏁 Игра окончена'}</div>
        <div class="bl-big">${num(sc)}</div>
        <div class="bl-s">${num(G.lines)} линий · ${num(G.moves)} фигур${sc >= WIN ? ' · победа!' : ` · набери ${num(WIN)} — будет победа`}</div>
        <div class="bl-coins">${coins && C() ? `🪙 +${num(coins)} монет…` : C() ? `🪙 Монеты — за каждые ${COIN_DIV} очков` : ''}</div>
        <div class="ct-actions"><button type="button" class="ct-start" data-act="again">↻ Ещё раз</button><button type="button" class="ct-duel-btn" data-act="duel">⚔️ С другом</button><button type="button" data-act="share">📤 Поделиться</button></div>`);
      if (!coins || !C()) return;
      const r = await C().run('blocks', coins, runId);
      const box = ov.querySelector('.bl-coins');
      if (!box || stopped) return;
      if (!r?.ok) { box.textContent = r?.reason === 'day_cap' ? '🪙 Лимит монет за игры на сегодня исчерпан' : r?.reason === 'too_fast' ? '🪙 Игра слишком короткая для монет' : '🪙 Монеты не начислились — проверь интернет'; return; }
      box.innerHTML = `🪙 <b>+${num(r.got)}</b> монет${r.base && r.got > r.base ? ' <span class="hd-vip">VIP ×2</span>' : ''}`;
      if (window.D37Ads?.rewardReady?.() && C().canDouble()) box.insertAdjacentHTML('afterend', `<button type="button" class="hd-x2" data-act="x2" data-run="${runId}">📺 Смотреть рекламу → ещё +${num(r.base || r.got)} 🪙</button>`);
    }
    async function doubleCoins(btn){
      btn.disabled = true;
      if (!await window.D37Ads.showReward('blocks_x2')) { api.toast('Реклама не досмотрена — бонуса нет'); btn.disabled = false; return; }
      const r = await C().double(btn.dataset.run);
      if (r?.ok) { api.sfx('win'); api.toast(`📺 +${num(r.got)} 🪙 — спасибо!`); btn.remove(); }
      else { api.toast('Не получилось — попробуй ещё раз'); btn.disabled = false; }
    }
    async function share(btn){
      const text = `Я набрал ${num(G.score)} очков в «Блоках» — головоломке как Block Blast. Побьёшь?`, url = location.origin + '/games/blocks';
      if (navigator.share) { navigator.share({ title: 'Блоки', text, url }).catch(() => {}); return; }
      try { await navigator.clipboard.writeText(text + ' ' + url); btn.textContent = '✅ Скопировано'; } catch (e) { prompt('Скопируй и отправь другу:', text + ' ' + url); }
    }
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]');
      if (!b || !el.contains(b) || stopped) return;
      const a = b.dataset.act;
      if (a === 'new') {
        if (ended || !G.moves) { opt.onNew?.(); return; }
        showOv(`<div class="bl-t">Закончить эту игру?</div><div class="bl-s">Счёт <b>${num(G.score)}</b> засчитается, потом начнёшь заново.</div>
          <div class="bl-col"><button type="button" class="ct-start" data-act="end">🏁 Закончить</button><button type="button" class="hd-alt" data-act="resume">↩ Играть дальше</button></div>`);
      }
      else if (a === 'resume') { hideOv(); if (G.over) outOfMoves(); }
      else if (a === 'end') end();
      else if (a === 'rv-ad') revive('ad');
      else if (a === 'rv-coins') revive('coins');
      else if (a === 'duel') location.hash = '#/games/blocks/' + GameRoom.newCode();
      else if (a === 'share') share(b);
      else if (a === 'x2') doubleCoins(b);
      else if (a === 'again') {
        b.disabled = true;
        try { await window.D37Ads?.interstitial?.('blocks'); } catch (err) {}
        if (!stopped) opt.onNew?.();
      }
    });

    if (opt.duel && opt.timeLimit) {
      const t = q('.blTimer');
      const tick = () => { t.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; t.classList.toggle('low', left <= 15); };
      tick();
      timer = setInterval(() => { left--; tick(); if (left <= 0) end('⏱ Время вышло!'); }, 1000);
    }
    // Размер: ResizeObserver + resize окна (поворот телефона; в фоне RO может не сработать)
    const ro = window.ResizeObserver ? new ResizeObserver(() => layout()) : null;
    ro?.observe(wrap);
    window.addEventListener('resize', layout);
    ui();
    layout();
    if (G.over) overT = setTimeout(() => { if (!stopped) outOfMoves(); }, 300);

    me.stop = () => {
      stopped = true;
      clearInterval(timer); clearTimeout(overT); cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', layout);
    };
    me.debug = () => ({ W, H, cs, bx, by, ty, th, sel, ended });
    return me;
  }

  function solo(fresh){
    B?.stop();
    const G = (!fresh && loadGame()) || newGame(Math.random, true);
    B = createBoard(root, { G, onNew: () => solo(true) });
    if (!fresh && G.moves && !G.over) api.toast('▶ Продолжаем прошлую игру');
  }

  window.GAME_IMPL.blocks = {
    mount(el, gameApi){
      root = el; api = gameApi;
      if (GameRoom.validCode(gameApi.param)) {
        stopDuel = Versus.start(root, api, 'blocks', gameApi.param, {
          run(stage, rand, hooks){
            B?.stop();
            stage.insertAdjacentHTML('afterbegin', `<div class="ct-note" style="text-align:center">⏱ ${DUEL_SEC / 60} минуты · одинаковые фигуры у обоих · у кого больше очков</div>`);
            const host = document.createElement('div');
            stage.appendChild(host);
            B = createBoard(host, { G: newGame(rand, false), duel: true, timeLimit: DUEL_SEC, onScore: hooks.progress, onEnd: score => hooks.done(score) });
          },
          stop(){ B?.stop(); B = null; },
        });
      } else solo(false);
    },
    unmount(){ B?.stop(); B = null; stopDuel?.(); stopDuel = null; root = null; },
    get board(){ return B; },
    _test: { N, SHAPES, COLORS, fits, fitsAnywhere, fullLines, preview, newGame, deal, place, rescue, canMove, clearsLine, loadGame, saveGame },
  };
})();
