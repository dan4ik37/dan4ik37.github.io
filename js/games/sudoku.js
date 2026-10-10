// ═══════════════════════════════════════
//  «СУДОКУ» — 4 уровня + «Судоку дня» (одно на всех, новое в полночь по МСК)
// ═══════════════════════════════════════
// Генератор: случайное решённое поле → убираем клетки парами (симметрично), пока решение единственное (countSolutions)
// и, для Лёгкого/Среднего, пока решается одними «одиночками» (singlesSolve — без перебора). Судоку дня — тот же генератор
// с зерном от даты (день №1 = 10.10.2026), уровень «Сложный». Заметки карандашом, 3 ошибки (вторая попытка — реклама или
// 30 монет, раз за игру), 3 подсказки (ещё — реклама/монеты), отмена, клавиатура (цифры, стрелки, N — заметки, Backspace).
// Очки: база уровня × min(3, эталон / секунды) − 50 за ошибку. Ключи: sudoku1..4, sudoku_daily, sudoku_duel.
// Рекорды дня — RPC daily_top('sudoku_daily') (games-more.sql; засчитывается первая попытка). Движок — GAME_IMPL.sudoku._test.
(() => {
  const LEVELS = {
    1: { name: 'Лёгкий', givens: 40, singles: true, base: 100, ref: 300, coins: 10 },
    2: { name: 'Средний', givens: 33, singles: true, base: 200, ref: 480, coins: 20 },
    3: { name: 'Сложный', givens: 28, singles: false, base: 400, ref: 720, coins: 35 },
    4: { name: 'Эксперт', givens: 24, singles: false, base: 800, ref: 1200, coins: 60 },
  };
  const MAX_MISTAKES = 3, DUEL_SEC = 600, DAY1 = Date.UTC(2026, 9, 10), DAILY_KEY = 'd37_sudoku_daily', PREF = 'd37_sudoku_level';

  // ── Движок ──
  function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const RW = i => Math.floor(i / 9), CL = i => i % 9, BX = i => Math.floor(RW(i) / 3) * 3 + Math.floor(CL(i) / 3);
  const UNITS = [];
  for (let k = 0; k < 9; k++) {
    UNITS.push(Array.from({ length: 9 }, (_, j) => k * 9 + j));
    UNITS.push(Array.from({ length: 9 }, (_, j) => j * 9 + k));
    UNITS.push(Array.from({ length: 9 }, (_, j) => (Math.floor(k / 3) * 3 + Math.floor(j / 3)) * 9 + (k % 3) * 3 + (j % 3)));
  }
  const PEERS = Array.from({ length: 81 }, (_, i) => {
    const s = new Set();
    for (let j = 0; j < 81; j++) if (j !== i && (RW(j) === RW(i) || CL(j) === CL(i) || BX(j) === BX(i))) s.add(j);
    return [...s];
  });
  const bits = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
  function cand(g, i){ let m = 0x3FE; for (const j of PEERS[i]) if (g[j]) m &= ~(1 << g[j]); return m; }
  // Сколько решений (до limit). rand — перебирать цифры в случайном порядке (для генерации), out — первое решение
  function search(g0, limit, rand, out){
    const g = g0.slice(), rows = Array(9).fill(0), cols = Array(9).fill(0), boxes = Array(9).fill(0);
    for (let i = 0; i < 81; i++) if (g[i]) {
      const b = 1 << g[i];
      if ((rows[RW(i)] | cols[CL(i)] | boxes[BX(i)]) & b) return 0;
      rows[RW(i)] |= b; cols[CL(i)] |= b; boxes[BX(i)] |= b;
    }
    let count = 0;
    const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    (function rec(){
      let best = -1, bm = 0, bn = 10;
      for (let i = 0; i < 81; i++) if (!g[i]) {
        const m = ~(rows[RW(i)] | cols[CL(i)] | boxes[BX(i)]) & 0x3FE, n = bits(m);
        if (n < bn) { bn = n; best = i; bm = m; if (n <= 1) break; }
      }
      if (best < 0) { count++; if (out && count === 1) out.push(...g); return count >= limit; }
      if (!bn) return false;
      const order = rand ? shuffle(digits.slice(), rand) : digits;   // не sort со случайным сравнением: в разных браузерах разный порядок
      const r = RW(best), c = CL(best), x = BX(best);
      for (const d of order) {
        const b = 1 << d;
        if (!(bm & b)) continue;
        g[best] = d; rows[r] |= b; cols[c] |= b; boxes[x] |= b;
        if (rec()) return true;
        g[best] = 0; rows[r] &= ~b; cols[c] &= ~b; boxes[x] &= ~b;
      }
      return false;
    })();
    return count;
  }
  const countSolutions = (g, limit = 2) => search(g, limit);
  function randomSolution(rand){ const out = []; search(Array(81).fill(0), 1, rand, out); return out; }
  // Решается ли одними «одиночками» (голые и скрытые) — без перебора
  function singlesSolve(g0){
    const g = g0.slice();
    for (let progress = true; progress;) {
      progress = false;
      for (let i = 0; i < 81; i++) if (!g[i]) {
        const m = cand(g, i);
        if (!m) return false;
        if (!(m & (m - 1))) { g[i] = 31 - Math.clz32(m); progress = true; }
      }
      for (const u of UNITS) for (let d = 1; d <= 9; d++) {
        let pos = -1, cnt = 0, here = false;
        for (const i of u) { if (g[i] === d) { here = true; break; } if (!g[i] && (cand(g, i) & (1 << d))) { cnt++; pos = i; } }
        if (!here && cnt === 1) { g[pos] = d; progress = true; }
      }
    }
    return g.every(Boolean);
  }
  function shuffle(a, rand){ for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  // Сложный и Эксперт: несколько вариантов, берём самый трудный (не решается одними «одиночками», меньше подсказок)
  function generate(lv, rand){
    const tries = lv === 4 ? 6 : lv === 3 ? 3 : 1;
    let best = null;
    for (let k = 0; k < tries; k++) {
      const P = generateOnce(lv, rand), v = (singlesSolve(P.puzzle) ? 100 : 0) + P.givens;
      if (!best || v < best.v) best = { ...P, v };
    }
    delete best.v;
    return best;
  }
  function generateOnce(lv, rand){
    const L = LEVELS[lv], solution = randomSolution(rand), g = solution.slice();
    let givens = 81;
    for (const i of shuffle([...Array(41).keys()], rand)) {
      if (givens <= L.givens) break;
      const j = 80 - i, a = g[i], b = g[j];
      if (!a) continue;
      g[i] = 0; g[j] = 0;
      if (countSolutions(g) === 1 && (!L.singles || singlesSolve(g))) givens -= i === j ? 1 : 2;
      else { g[i] = a; g[j] = b; }
    }
    return { puzzle: g, solution, givens };
  }
  const dayNo = (t = Date.now()) => Math.floor((t + 3 * 3600e3 - DAY1) / 86400e3) + 1;   // по МСК
  const dailyPuzzle = n => generate(3, rng(0x5d0c + n * 7919));
  const scoreOf = (lv, sec, mistakes) => Math.max(10, Math.round(LEVELS[lv].base * Math.min(3, LEVELS[lv].ref / Math.max(1, sec))) - 50 * mistakes);

  // ── Экран ──
  let root, api, B = null, stopDuel = null;
  const C = () => window.D37Coins;
  const num = n => Number(n || 0).toLocaleString('ru');
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const readDaily = () => { try { const d = JSON.parse(localStorage.getItem(DAILY_KEY) || 'null'); return d && d.day === dayNo() ? d : null; } catch (e) { return null; } };
  const saveKey = mode => 'd37_sudoku_save_' + mode;

  // Одна партия. o: { mode: 'daily'|'lv'|'duel', lv, P: {puzzle, solution}, saved, day, timeLimit, onScore, onEnd, onMode(mode, lv) }
  function createBoard(el, o){
    const P = o.P, me = {};
    const S = o.saved || { cur: P.puzzle.slice(), notes: Array(81).fill(0), mistakes: 0, hints: 3, elapsed: 0, revived: false };
    let sel = -1, notesMode = false, hist = [], runAt = 0, tick = 0, ended = false, stopped = false;
    const daily = o.mode === 'daily', duel = o.mode === 'duel';
    el.innerHTML = `<div class="sd">
        ${duel ? '' : `<div class="sl-opts sd-lv"><button type="button" data-act="mode:daily"${daily ? ' class="on"' : ''}>📅 Судоку дня #${dayNo()}</button>${Object.entries(LEVELS).map(([k, v]) => `<button type="button" data-act="mode:lv:${k}"${!daily && +k === o.lv ? ' class="on"' : ''}>${v.name}</button>`).join('')}</div>`}
        <div class="sd-bar"><span>⏱ <b class="sdTime">0:00</b></span><span>Ошибки <b class="sdMis">0/3</b></span><span class="sdLv">${daily ? 'Судоку дня · сложный' : duel ? 'Средний' : LEVELS[o.lv].name}</span></div>
        <div class="sd-wrap"><div class="sd-grid"></div><div class="sl-over" hidden></div></div>
        <div class="sd-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => `<button type="button" data-d="${d}"><b>${d}</b><i></i></button>`).join('')}</div>
        <div class="sd-tools">
          <button type="button" data-act="undo">↶<span>Отменить</span></button>
          <button type="button" data-act="erase">⌫<span>Стереть</span></button>
          <button type="button" data-act="notes" class="sdNotes">✏️<span>Заметки</span></button>
          <button type="button" data-act="hint">💡<span>Подсказка <b class="sdHints">3</b></span></button>
        </div>
        ${daily ? '<div class="sd-top" hidden></div>' : ''}
        ${duel ? '' : '<div class="ct-actions"><button type="button" class="ct-duel-btn" data-act="duel">⚔️ Наперегонки с другом</button></div>'}
      </div>`;
    const q = s => el.querySelector(s), grid = q('.sd-grid'), ov = q('.sl-over');
    grid.innerHTML = Array.from({ length: 81 }, (_, i) => `<div class="sc${RW(i) % 3 === 2 && RW(i) < 8 ? ' bb' : ''}${CL(i) % 3 === 2 && CL(i) < 8 ? ' br' : ''}" data-i="${i}"></div>`).join('');
    const cells = [...grid.children];

    function paint(){
      const sv = sel >= 0 ? S.cur[sel] : 0;
      for (let i = 0; i < 81; i++) {
        const e = cells[i], v = S.cur[i], given = !!P.puzzle[i], bad = v && v !== P.solution[i];
        let cls = 'sc' + (RW(i) % 3 === 2 && RW(i) < 8 ? ' bb' : '') + (CL(i) % 3 === 2 && CL(i) < 8 ? ' br' : '');
        if (given) cls += ' gv'; else if (v) cls += bad ? ' us bad' : ' us';
        if (i === sel) cls += ' sel';
        else if (sel >= 0 && (RW(i) === RW(sel) || CL(i) === CL(sel) || BX(i) === BX(sel))) cls += ' peer';
        if (sv && v === sv && i !== sel) cls += ' same';
        if (e.className !== cls) e.className = cls;
        const html = v ? String(v) : S.notes[i] ? `<span class="nt">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => `<i>${S.notes[i] & (1 << d) ? d : ''}</i>`).join('')}</span>` : '';
        if (e.innerHTML !== html) e.innerHTML = html;
      }
      q('.sdMis').textContent = `${S.mistakes}/${MAX_MISTAKES}`;
      q('.sdHints').textContent = S.hints;
      q('.sdNotes').classList.toggle('on', notesMode);
      // сколько каждой цифры осталось поставить
      const left = Array(10).fill(9);
      S.cur.forEach((v, i) => { if (v && v === P.solution[i]) left[v]--; });
      el.querySelectorAll('.sd-pad button').forEach(b => { const d = +b.dataset.d; b.querySelector('i').textContent = left[d] || ''; b.classList.toggle('done', !left[d]); });
    }
    const secs = () => S.elapsed + (runAt ? (Date.now() - runAt) / 1000 : 0);
    function clock(){
      if (document.hidden && runAt) { S.elapsed = secs(); runAt = 0; }
      else if (!document.hidden && !runAt && !ended && !stopped) runAt = Date.now();
      const s = secs();
      q('.sdTime').textContent = duel ? mmss(Math.max(0, o.timeLimit - s)) : mmss(s);
      if (duel && !ended && s >= o.timeLimit) finish(false, '⏱ Время вышло!');
    }
    function start(){ if (!runAt && !ended) runAt = Date.now(); clearInterval(tick); tick = setInterval(clock, 500); }
    function save(){
      if (duel || ended) return;
      try { localStorage.setItem(saveKey(o.mode === 'daily' ? 'daily' : 'lv' + o.lv), JSON.stringify({ v: 1, day: o.day, lv: o.lv, P, S: { ...S, elapsed: secs() } })); } catch (e) {}
    }
    function snap(){ hist.push(JSON.stringify({ cur: S.cur, notes: S.notes })); if (hist.length > 300) hist.shift(); }
    const duelScore = () => S.cur.reduce((a, v, i) => a + (!P.puzzle[i] && v && v === P.solution[i] ? 10 : 0), 0) - 30 * S.mistakes;

    function input(d){
      if (ended || sel < 0 || P.puzzle[sel] || (S.cur[sel] && S.cur[sel] === P.solution[sel])) return;
      if (notesMode) {
        if (S.cur[sel]) return;
        snap();
        S.notes[sel] ^= 1 << d;
        api.sfx('move'); paint(); save();
        return;
      }
      if (S.cur[sel] === d) return;
      snap();
      S.cur[sel] = d;
      if (d !== P.solution[sel]) {
        S.mistakes++;
        api.sfx('bad');
        paint(); save();
        o.onScore?.(duelScore());
        if (S.mistakes >= MAX_MISTAKES) setTimeout(() => outOfLives(), 350);
        return;
      }
      S.notes[sel] = 0;
      for (const j of PEERS[sel]) S.notes[j] &= ~(1 << d);
      // собрал строку / столбец / квадрат — вспышка
      const doneUnits = UNITS.filter(u => u.includes(sel) && u.every(i => S.cur[i] === P.solution[i]));
      api.sfx(doneUnits.length ? 'win' : 'ok');
      paint();
      doneUnits.forEach(u => u.forEach((i, k) => { const e = cells[i]; setTimeout(() => { e.classList.add('flash'); setTimeout(() => e.classList.remove('flash'), 420); }, k * 25); }));
      save();
      o.onScore?.(duelScore());
      if (S.cur.every((v, i) => v === P.solution[i])) setTimeout(() => finish(true), 450);
    }
    function erase(){
      if (ended || sel < 0 || P.puzzle[sel] || (S.cur[sel] && S.cur[sel] === P.solution[sel])) return;
      if (!S.cur[sel] && !S.notes[sel]) return;
      snap();
      S.cur[sel] = 0; S.notes[sel] = 0;
      api.sfx('move'); paint(); save();
    }
    function undo(){
      if (ended || !hist.length) return;
      const h = JSON.parse(hist.pop());
      // ошибки отменой не стираются
      S.cur = h.cur; S.notes = h.notes;
      api.sfx('move'); paint(); save();
    }
    function hint(){
      if (ended) return;
      if (S.hints <= 0) { if (!duel) offer('hint'); return; }
      let i = sel >= 0 && !P.puzzle[sel] && S.cur[sel] !== P.solution[sel] ? sel : -1;
      if (i < 0) { const empty = S.cur.map((v, k) => (!P.puzzle[k] && v !== P.solution[k] ? k : -1)).filter(k => k >= 0); if (!empty.length) return; i = empty[Math.floor(Math.random() * empty.length)]; }
      S.hints--;
      sel = i;
      const keepNotes = notesMode;
      notesMode = false;
      input(P.solution[i]);
      notesMode = keepNotes;
      paint();
    }
    async function paid(how){
      if (how === 'ad') { if (await window.D37Ads.showReward('sudoku_help')) return true; api.toast('Реклама не досмотрена'); return false; }
      const r = await C().revive('sudoku');
      if (r?.ok) return true;
      api.toast(r?.reason === 'coins' ? 'Не хватает монет' : 'Не получилось — попробуй ещё раз');
      return false;
    }
    function offer(what){
      const adOk = !!window.D37Ads?.rewardReady?.(), price = C()?.RULES?.revive ?? 30, coins = C()?.coins?.() ?? 0;
      showOv(`<div class="sl-t">${what === 'hint' ? 'Подсказки кончились' : '3 ошибки'}</div>
        <div class="sl-s">${what === 'hint' ? 'Ещё одна подсказка — за рекламу или монеты.' : 'Вторая попытка (ошибок станет 2) — за рекламу или монеты. Можно один раз за игру.'}</div>
        <div class="sl-col">${adOk ? `<button type="button" class="ct-start" data-act="pay-ad:${what}">📺 Посмотреть рекламу</button>` : ''}
        ${C() ? `<button type="button" class="${adOk ? 'hd-alt' : 'ct-start'}" data-act="pay-coins:${what}"${coins >= price ? '' : ' disabled'}>🪙 За ${price} монет</button>` : ''}
        <button type="button" class="hd-alt" data-act="${what === 'hint' ? 'close' : 'giveup'}">${what === 'hint' ? '↩ Играть дальше' : '🏁 Закончить'}</button></div>`);
    }
    function outOfLives(){
      if (ended) return;
      if (duel || S.revived) { finish(false, '❌ 3 ошибки'); return; }
      runAt && (S.elapsed = secs(), runAt = 0);
      offer('lives');
    }

    // ── Ввод ──
    grid.addEventListener('pointerdown', e => { const c = e.target.closest('.sc'); if (!c || ended) return; sel = +c.dataset.i; paint(); });
    el.querySelector('.sd-pad').addEventListener('click', e => { const b = e.target.closest('button'); if (b) input(+b.dataset.d); });
    function onKey(e){
      if (!el.isConnected || ended || stopped || e.target?.closest?.('input,textarea,[contenteditable]') || !ov.hidden) return;
      const k = e.key;
      if (/^[1-9]$/.test(k)) { e.preventDefault(); input(+k); return; }
      if (k === 'Backspace' || k === 'Delete' || k === '0') { e.preventDefault(); erase(); return; }
      if (k === 'n' || k === 'N' || k === 'т' || k === 'Т') { notesMode = !notesMode; paint(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'я')) { e.preventDefault(); undo(); return; }
      const mv = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[k];
      if (mv) {
        e.preventDefault();
        if (sel < 0) sel = 40;
        else { const n = sel + mv; if (n >= 0 && n < 81 && !(Math.abs(mv) === 1 && RW(n) !== RW(sel))) sel = n; }
        paint();
      }
    }
    window.addEventListener('keydown', onKey);

    const showOv = html => { ov.innerHTML = html; ov.hidden = false; };
    const hideOv = () => { ov.hidden = true; ov.innerHTML = ''; };
    async function finish(won, title){
      if (ended) return;
      ended = true;
      S.elapsed = secs(); runAt = 0;
      clearInterval(tick);
      clock();
      const sec = S.elapsed;
      if (duel) {
        const sc = duelScore() + (won ? 1000 + Math.max(0, Math.round(o.timeLimit - sec)) : 0);
        api.sfx(won ? 'win' : 'bad');
        showOv(`<div class="sl-t">${won ? '🎉 Решено!' : title}</div><div class="sl-big">${num(sc)}</div><div class="sl-s">${mmss(sec)} · ошибок: ${S.mistakes}. Итог соревнования — сверху</div>`);
        o.onEnd?.(sc);
        return;
      }
      try { localStorage.removeItem(saveKey(daily ? 'daily' : 'lv' + o.lv)); } catch (e) {}
      const lv = daily ? 3 : o.lv, key = daily ? 'sudoku_daily' : 'sudoku' + lv;
      if (!won) {
        api.sfx('bad');
        api.report(key, false, 0, 0);
        if (daily) { try { localStorage.setItem(DAILY_KEY, JSON.stringify({ day: o.day, won: false, sec: Math.round(sec), mistakes: S.mistakes })); } catch (e) {} }
        showOv(`<div class="sl-t">${title || '❌ 3 ошибки'}</div><div class="sl-s">${daily ? 'Судоку дня не решено — завтра будет новое.' : 'Попробуй ещё раз — новое судоку.'}</div>
          <div class="ct-actions"><button type="button" class="ct-start" data-act="${daily ? 'mode:lv:' + (o.lv || 2) : 'again'}">${daily ? '🔢 Сыграть обычное' : '↻ Новое судоку'}</button><button type="button" data-act="look">👀 Посмотреть поле</button></div>`);
        return;
      }
      const sc = scoreOf(lv, sec, S.mistakes), prevBest = api.local().best || 0, coins = daily ? 40 : LEVELS[lv].coins, runId = 'sd' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
      api.report(key, true, sc, sc);
      api.sfx('win');
      if (daily) { try { localStorage.setItem(DAILY_KEY, JSON.stringify({ day: o.day, won: true, sec: Math.round(sec), mistakes: S.mistakes, score: sc })); } catch (e) {} window.dispatchEvent(new Event('d37:daily')); }
      showOv(`<div class="sl-t">🎉 ${daily ? `Судоку дня #${o.day} решено!` : 'Решено!'}</div><div class="sl-big">${mmss(sec)}</div>
        <div class="sl-s">${daily ? 'Сложный' : LEVELS[lv].name} · ошибок: ${S.mistakes} · ${num(sc)} очков${sc > prevBest ? ' · 🏆 рекорд!' : ''}</div>
        <div class="sl-coins">${C() && sec >= 20 ? `🪙 +${coins} монет…` : ''}</div>
        <div class="ct-actions"><button type="button" class="ct-start" data-act="${daily ? 'mode:lv:' + (o.lv || 2) : 'again'}">${daily ? '🔢 Ещё судоку' : '↻ Новое судоку'}</button><button type="button" data-act="share">📤 Поделиться</button></div>`);
      if (daily) loadTop();
      if (!C() || sec < 20) return;
      const r = await C().run('sudoku', coins, runId);
      const box = ov.querySelector('.sl-coins');
      if (box && !stopped) box.innerHTML = r?.ok ? `🪙 <b>+${num(r.got)}</b> монет${r.base && r.got > r.base ? ' <span class="hd-vip">VIP ×2</span>' : ''}` : r?.reason === 'day_cap' ? '🪙 Лимит монет за игры на сегодня исчерпан' : '🪙 Монеты не начислились';
    }
    // Рекорды дня: кто быстрее решил сегодняшнее (первая попытка). Без games-more.sql блока нет
    async function loadTop(){
      const box = q('.sd-top');
      if (!box || typeof sbClient === 'undefined' || !sbClient) return;
      try {
        const { data, error } = await sbClient.rpc('daily_top', { p_game: 'sudoku_daily', lim: 10 });
        if (error || !data?.length) return;
        box.hidden = false;
        box.innerHTML = `<b>🏆 Судоку дня — лучшие сегодня</b><ol>${data.map(r => `<li><span>${esc(r.nick || 'Игрок')}</span><b>${num(r.best_score)}</b></li>`).join('')}</ol>`;
      } catch (e) {}
    }
    async function share(btn){
      const text = daily ? `Решил «Судоку дня» #${o.day} за ${mmss(S.elapsed)} (ошибок: ${S.mistakes}). А ты?` : `Решил судоку «${LEVELS[o.lv].name}» за ${mmss(S.elapsed)}. Сможешь быстрее?`, url = location.origin + '/games/sudoku';
      if (navigator.share) { navigator.share({ title: 'Судоку', text, url }).catch(() => {}); return; }
      try { await navigator.clipboard.writeText(text + ' ' + url); btn.textContent = '✅ Скопировано'; } catch (e) { prompt('Скопируй и отправь другу:', text + ' ' + url); }
    }
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]');
      if (!b || !el.contains(b) || stopped) return;
      const a = b.dataset.act;
      if (a === 'undo') undo();
      else if (a === 'erase') erase();
      else if (a === 'notes') { notesMode = !notesMode; paint(); }
      else if (a === 'hint') hint();
      else if (a.startsWith('pay-')) {
        const [how, what] = a.slice(4).split(':');
        ov.querySelectorAll('button').forEach(x => { x.disabled = true; });
        if (await paid(how)) {
          hideOv();
          if (what === 'hint') { S.hints++; hint(); }
          else { S.mistakes = MAX_MISTAKES - 1; S.revived = true; start(); api.sfx('win'); paint(); save(); }
        } else offer(what);
      }
      else if (a === 'close') hideOv();
      else if (a === 'giveup') finish(false, '❌ 3 ошибки');
      else if (a === 'look') { ov.hidden = true; }
      else if (a === 'again') { b.disabled = true; try { await window.D37Ads?.interstitial?.('sudoku'); } catch (err) {} if (!stopped) o.onMode?.('lv', o.lv, true); }
      else if (a.startsWith('mode:')) {
        const [, m, lv] = a.split(':');
        if (!ended && S.cur.some((v, i) => v && !P.puzzle[i])) save();
        o.onMode?.(m, +lv || o.lv);
      }
      else if (a === 'duel') location.hash = '#/games/sudoku/' + GameRoom.newCode();
      else if (a === 'share') share(b);
    });
    paint();
    start();
    if (daily) loadTop();
    me.stop = () => { if (!ended) { S.elapsed = secs(); runAt = 0; save(); } stopped = true; clearInterval(tick); window.removeEventListener('keydown', onKey); };
    me.S = S; me.P = P;
    me.select = i => { sel = i; paint(); };
    me.input = input;
    return me;
  }

  // Готовая «Судоку дня» — экран итога (решать второй раз нельзя)
  function dailyDoneHtml(d){
    return `<div class="sd-done"><div class="sl-t">${d.won ? '✅' : '❌'} Судоку дня #${d.day} ${d.won ? 'решено' : 'не решено'}</div>
      <div class="sl-s">${d.won ? `Время ${mmss(d.sec)} · ошибок: ${d.mistakes} · ${num(d.score)} очков` : 'Сегодня не получилось'}. Новое судоку — завтра в 00:00 по Москве.</div>
      <div class="ct-actions"><button type="button" class="ct-start" data-act="mode:lv:2">🔢 Сыграть обычное</button><button type="button" data-act="share-daily">📤 Поделиться</button></div>
      <div class="sd-top" hidden></div></div>`;
  }
  function loadSaved(mode, lv){
    try {
      const d = JSON.parse(localStorage.getItem(saveKey(mode === 'daily' ? 'daily' : 'lv' + lv)) || 'null');
      if (!d || d.v !== 1 || !d.P?.puzzle?.length || !d.S?.cur?.length) return null;
      if (mode === 'daily' && d.day !== dayNo()) return null;
      return d;
    } catch (e) { return null; }
  }
  function open(mode, lv, fresh){
    B?.stop(); B = null;
    lv = LEVELS[lv] ? lv : 2;
    try { if (mode === 'lv') localStorage.setItem(PREF, String(lv)); } catch (e) {}
    if (mode === 'daily') {
      const d = readDaily();
      if (d) {
        root.innerHTML = `<div class="sd"><div class="sl-opts sd-lv"><button type="button" class="on">📅 Судоку дня #${dayNo()}</button>${Object.entries(LEVELS).map(([k, v]) => `<button type="button" data-act="mode:lv:${k}">${v.name}</button>`).join('')}</div>${dailyDoneHtml(d)}</div>`;
        root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
          const a = b.dataset.act;
          if (a.startsWith('mode:lv:')) open('lv', +a.split(':')[2]);
          else if (a === 'share-daily') { const text = `Решил «Судоку дня» #${d.day} за ${mmss(d.sec)}. А ты?`, url = location.origin + '/games/sudoku'; if (navigator.share) navigator.share({ title: 'Судоку дня', text, url }).catch(() => {}); else navigator.clipboard?.writeText(text + ' ' + url).then(() => { b.textContent = '✅ Скопировано'; }); }
        }));
        loadDailyTop(root.querySelector('.sd-top'));
        return;
      }
    }
    const saved = !fresh && loadSaved(mode, lv);
    const P = saved ? saved.P : mode === 'daily' ? dailyPuzzle(dayNo()) : generate(lv, Math.random);
    B = createBoard(root, { mode, lv, P, saved: saved?.S, day: dayNo(), onMode: (m, l, f) => open(m, l, f) });
    if (saved && saved.S.cur.some((v, i) => v && !saved.P.puzzle[i])) api.toast('▶ Продолжаем судоку');
  }
  async function loadDailyTop(box){
    if (!box || typeof sbClient === 'undefined' || !sbClient) return;
    try {
      const { data, error } = await sbClient.rpc('daily_top', { p_game: 'sudoku_daily', lim: 10 });
      if (error || !data?.length) return;
      box.hidden = false;
      box.innerHTML = `<b>🏆 Судоку дня — лучшие сегодня</b><ol>${data.map(r => `<li><span>${esc(r.nick || 'Игрок')}</span><b>${num(r.best_score)}</b></li>`).join('')}</ol>`;
    } catch (e) {}
  }

  window.GAME_IMPL.sudoku = {
    mount(el, gameApi){
      root = el; api = gameApi;
      if (window.GameRoom?.validCode(gameApi.param)) {
        stopDuel = Versus.start(root, api, 'sudoku', gameApi.param, {
          run(stage, rand, hooks){
            B?.stop();
            stage.insertAdjacentHTML('afterbegin', `<div class="ct-note" style="text-align:center">⏱ 10 минут · одинаковое судоку у обоих · очки за верные цифры, решил — +1000 и бонус за время</div>`);
            const host = document.createElement('div');
            stage.appendChild(host);
            B = createBoard(host, { mode: 'duel', lv: 2, P: generate(2, rand), timeLimit: DUEL_SEC, onScore: hooks.progress, onEnd: score => hooks.done(score) });
          },
          stop(){ B?.stop(); B = null; },
        });
        return;
      }
      // По умолчанию — «Судоку дня», если сегодня ещё не решено
      let lv = 2;
      try { lv = +localStorage.getItem(PREF) || 2; } catch (e) {}
      if (gameApi.param === 'daily' || !readDaily()) open('daily', lv);
      else open('lv', lv);
    },
    unmount(){ B?.stop(); B = null; stopDuel?.(); stopDuel = null; root = null; },
    get board(){ return B; },
    _test: { LEVELS, rng, cand, countSolutions, randomSolution, singlesSolve, generate, dayNo, dailyPuzzle, scoreOf, UNITS, PEERS },
  };
  window.sudokuToday = () => ({ day: dayNo(), done: readDaily() });
})();
