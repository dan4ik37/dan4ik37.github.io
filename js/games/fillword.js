// ═══════════════════════════════════════
//  «ФИЛВОРД» — найди все слова в поле из букв: уровни, «Филворд дня» (один на всех) и наперегонки с другом
// ═══════════════════════════════════════
// Поле целиком состоит из спрятанных слов: каждое — «змейкой» по соседним клеткам (вверх, вниз, вбок, без диагоналей), каждая
// клетка — ровно в одном слове. Генератор: случайный путь через все клетки (из «змейки» ходами backbite) → режем на куски длиной
// 3–9 → в каждый кусок — понятное слово той же длины (js/games/nouns-common.js) → проверка: каждое слово читается на поле
// одним-единственным путём (иначе другое слово/путь). Уровни — свои поля (зерно от номера), «Филворд дня» — зерно от даты
// (день №1 = 15.10.2026 по МСК, как «Судоку дня»), одна попытка в день, рекорды дня — daily_top('fillword_daily').
// Ввод: веди пальцем по буквам (отпустил — проверка) или нажимай по одной: точный путь слова засчитывается сам, иначе
// «✓ Проверить»; «✕» — сбросить, нажал последнюю букву ещё раз — убрать её. Подсказки: 3 на поле (первая буква слова), ещё —
// за рекламу или монеты. Очки: клетки × 10 × min(3, эталон / секунды) − 40 за подсказку. Монеты (coin_run_cap 'fillword' = 15):
// уровень — 2–5, «Филворд дня» — 12 (партия от 20 с). Ключи: fillword, fillword_daily, fillword_duel. Движок — GAME_IMPL.fillword._test.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const DAY1 = Date.UTC(2026, 9, 15);
  const HINTS = 3, DUEL_SEC = 300, DAILY_COINS = 12;
  const COLORS = ['#fde047', '#fb923c', '#86efac', '#7dd3fc', '#f9a8d4', '#c4b5fd', '#fca5a5', '#5eead4', '#bef264', '#fdba74', '#a5b4fc', '#f0abfc', '#67e8f9', '#d9f99d'];

  function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // Размер поля и длины слов по уровню
  function sizeOf(lv){
    if (lv <= 2) return { w: 4, h: 4, min: 3, max: 5 };
    if (lv <= 6) return { w: 5, h: 5, min: 3, max: 6 };
    if (lv <= 12) return { w: 6, h: 6, min: 3, max: 7 };
    if (lv <= 20) return { w: 7, h: 7, min: 4, max: 8 };
    if (lv <= 35) return { w: 8, h: 8, min: 4, max: 9 };
    return { w: 9, h: 9, min: 4, max: 9 };
  }
  const DAILY_SIZE = { w: 7, h: 7, min: 4, max: 8 }, DUEL_SIZE = { w: 6, h: 6, min: 3, max: 7 };

  // ═══ Словарь: понятные существительные по длине ═══
  let BYLEN = null;
  function words(){
    if (BYLEN) return BYLEN;
    BYLEN = {};
    for (const w of String(root.NOUNS_COMMON || '').split(' ')) if (/^[а-я]{3,9}$/.test(w)) (BYLEN[w.length] = BYLEN[w.length] || []).push(w);
    for (const k in BYLEN) BYLEN[k].sort();
    return BYLEN;
  }

  // ═══ Путь через все клетки: «змейка» + случайные ходы backbite (каждый оставляет путь гамильтоновым) ═══
  function nbs(i, w, h){ const r = Math.floor(i / w), c = i % w, o = []; if (r > 0) o.push(i - w); if (r < h - 1) o.push(i + w); if (c > 0) o.push(i - 1); if (c < w - 1) o.push(i + 1); return o; }
  function hamPath(w, h, rand){
    const N = w * h, p = [];
    for (let r = 0; r < h; r++) for (let k = 0; k < w; k++) p.push(r * w + (r % 2 ? w - 1 - k : k));
    const pos = new Int32Array(N);
    const fix = () => { for (let i = 0; i < N; i++) pos[p[i]] = i; };
    fix();
    const steps = N * 30;
    for (let s = 0; s < steps; s++) {
      if (rand() < .5) p.reverse(), fix();   // работаем с концом пути
      const end = p[N - 1], nb = nbs(end, w, h);
      const u = nb[Math.floor(rand() * nb.length)], i = pos[u];
      if (i === N - 2) continue;   // сосед по пути
      // P[0..i], затем P[N-1] … P[i+1]
      for (let a = i + 1, b = N - 1; a < b; a++, b--) { const t = p[a]; p[a] = p[b]; p[b] = t; pos[p[a]] = a; pos[p[b]] = b; }
    }
    return p;
  }
  // Длины кусков: сумма = N, каждая — от min до max, и для каждой длины есть слова
  function cutLengths(N, o, rand, avail){
    const lens = [];
    let left = N;
    const okLen = L => L >= o.min && L <= o.max && (avail[L] || 0) > 0;
    for (let guard = 0; left > 0 && guard < 500; guard++) {
      if (okLen(left) && (left <= o.max - 1 || rand() < .3)) { lens.push(left); left = 0; break; }
      const opts = [];
      for (let L = o.min; L <= Math.min(o.max, left - o.min); L++) if (okLen(L)) opts.push(L);
      if (!opts.length) return null;
      // чаще — средние длины (4–7)
      const wts = opts.map(L => (L >= 4 && L <= 7 ? 3 : 1));
      let x = rand() * wts.reduce((a, b) => a + b, 0), L = opts[0];
      for (let k = 0; k < opts.length; k++) { x -= wts[k]; if (x <= 0) { L = opts[k]; break; } }
      lens.push(L); left -= L;
    }
    return left === 0 ? lens : null;
  }
  // Сколько путей на поле читают слово (до 2)
  function countPaths(grid, w, h, word){
    let n = 0;
    const used = new Uint8Array(grid.length);
    const dfs = (i, k) => {
      if (n > 1) return;
      if (k === word.length - 1) { n++; return; }
      used[i] = 1;
      for (const j of nbs(i, w, h)) if (!used[j] && grid[j] === word[k + 1]) dfs(j, k + 1);
      used[i] = 0;
    };
    for (let i = 0; i < grid.length && n < 2; i++) if (grid[i] === word[0]) dfs(i, 0);
    return n;
  }
  // Поле: { w, h, grid: ['к','о',…], words: [{ w, cells }] }
  function generate(o, rand){
    const BY = words(), avail = {};
    for (const k in BY) avail[k] = BY[k].length;
    for (let attempt = 0; attempt < 60; attempt++) {
      const N = o.w * o.h, path = hamPath(o.w, o.h, rand), lens = cutLengths(N, o, rand, avail);
      if (!lens) continue;
      const segs = [];
      let at = 0;
      for (const L of lens) { const s = path.slice(at, at + L); segs.push(rand() < .5 ? s : s.reverse()); at += L; }
      const grid = Array(N).fill(''), used = new Set(), placed = [];
      let ok = true;
      for (const cells of segs) {
        const list = BY[cells.length];
        let done = false;
        for (let t = 0; t < 25 && !done; t++) {
          const word = list[Math.floor(rand() * list.length)];
          if (used.has(word)) continue;
          cells.forEach((c, k) => { grid[c] = word[k]; });
          used.add(word); placed.push({ w: word, cells }); done = true;
        }
        if (!done) { ok = false; break; }
      }
      if (!ok) continue;
      // каждое слово — одним путём на всём поле; нет — меняем слово в этом куске (после замены проверяем всё заново)
      let fine = true;
      for (let pass = 0; ; pass++) {
        const bad = placed.find(p => countPaths(grid, o.w, o.h, p.w) !== 1);
        if (!bad) break;
        if (pass >= 40) { fine = false; break; }
        const list = BY[bad.cells.length];
        let word = null;
        for (let t = 0; t < 20 && !word; t++) { const w2 = list[Math.floor(rand() * list.length)]; if (!used.has(w2)) word = w2; }
        if (!word) { fine = false; break; }
        used.delete(bad.w); used.add(word);
        bad.cells.forEach((c, j) => { grid[c] = word[j]; });
        bad.w = word;
      }
      if (!fine) continue;
      return { w: o.w, h: o.h, grid, words: placed };
    }
    return null;
  }
  const dayNo = (t = Date.now()) => Math.floor((t + 3 * 3600e3 - DAY1) / 864e5) + 1;
  const levelPuzzle = lv => generate(sizeOf(lv), rng(0xA11 + lv * 104729));
  const dailyPuzzle = n => generate(DAILY_SIZE, rng(0xF11 + n * 7919));
  const scoreOf = (cells, sec, hints) => Math.max(10, Math.round(cells * 10 * Math.min(3, (cells * 6) / Math.max(1, sec))) - 40 * hints);
  const coinsOf = cells => Math.min(5, 1 + Math.floor(Math.sqrt(cells) / 2));

  // ═══════════════════ ЭКРАН ═══════════════════
  let rootEl = null, api = null, B = null, stopDuel = null;
  const C = () => root.D37Coins;
  const esc0 = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const E = s => (typeof esc === 'function' ? esc(s) : esc0(s));
  const num = n => Number(n || 0).toLocaleString('ru');
  // 1 слово, 2 слова, 5 слов
  const pl = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b > 1 && b < 5 ? few : many; };
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const PROG = 'd37_fillword', DAILY_KEY = 'd37_fillword_daily';
  const readDaily = () => { const d = load(DAILY_KEY, null); return d && d.day === dayNo() ? d : null; };

  // Одно поле. o: { mode: 'lv'|'daily'|'duel', lv, P, saved, onEnd(score), onScore(score), timeLimit }
  function board(el, o){
    const P = o.P, N = P.w * P.h, me = {};
    const S = o.saved && o.saved.n === P.words.length ? o.saved : { found: [], hints: 0, hinted: [], elapsed: 0 };
    let path = [], drag = null, runAt = 0, tick = 0, ended = false, stopped = false, msgT = 0;
    const daily = o.mode === 'daily', duel = o.mode === 'duel';
    const owner = new Int16Array(N).fill(-1);
    P.words.forEach((w, k) => w.cells.forEach(c => { owner[c] = k; }));
    el.innerHTML = `<div class="fw">
      ${duel ? '' : `<div class="sl-opts fw-modes"><button type="button" data-act="mode:daily"${daily ? ' class="on"' : ''}>📅 Филворд дня #${dayNo()}</button><button type="button" data-act="mode:lv"${!daily ? ' class="on"' : ''}>🧩 Уровень ${o.lv || load(PROG, { lv: 1 }).lv || 1}</button></div>`}
      <div class="fw-bar"><span>⏱ <b class="fwT">0:00</b></span><span>Слова: <b class="fwN">0/${P.words.length}</b></span><span class="fw-lv">${daily ? `День #${dayNo()} · ${P.w}×${P.h}` : duel ? `${P.w}×${P.h}` : `Уровень ${o.lv} · ${P.w}×${P.h}`}</span></div>
      <div class="fw-body"><div class="fw-wrap"><div class="fw-grid" style="--w:${P.w};--h:${P.h}"><svg class="fw-line" aria-hidden="true"></svg>${P.grid.map((ch, i) => `<div class="fw-c" data-i="${i}">${ch.toUpperCase()}</div>`).join('')}</div><div class="sl-over" hidden></div></div>
      <div class="fw-side"><div class="fw-word" aria-live="polite"></div>
      <div class="fw-ctl"><button type="button" class="fw-b" data-act="clear" title="Сбросить выбор (Esc)">✕</button><button type="button" class="fw-b ok" data-act="check" title="Проверить слово (Enter)">✓ Проверить</button><button type="button" class="fw-b" data-act="hint">💡 <span class="fwH"></span></button></div>
      <div class="fw-list"></div>
      ${daily ? '<div class="sd-top fw-top" hidden></div>' : ''}
      ${duel ? '' : '<div class="ct-actions"><button type="button" class="ct-duel-btn" data-act="duel">⚔️ Наперегонки с другом</button></div>'}
    </div></div></div>`;
    const q = s => el.querySelector(s), grid = q('.fw-grid'), cells = [...grid.querySelectorAll('.fw-c')], ov = q('.sl-over'), line = q('.fw-line');
    // Найденное слово — толстая цветная «змейка» под буквами (центры клеток — по настоящим размерам, в пикселях поля)
    const cellCenter = i => [cells[i].offsetLeft + cells[i].offsetWidth / 2, cells[i].offsetTop + cells[i].offsetHeight / 2];
    function paint(){
      const sel = new Set(path);
      for (let i = 0; i < N; i++) {
        const k = owner[i], f = S.found.includes(k);
        let cls = 'fw-c' + (f ? ' f' : '') + (sel.has(i) ? ' p' : '') + (!f && S.hinted.includes(k) && P.words[k].cells[0] === i ? ' hint' : '');
        if (cells[i].className !== cls) cells[i].className = cls;
        cells[i].style.background = '';
      }
      // линия выбранного пути и найденных слов
      let svg = '';
      const cw = cells[0]?.offsetWidth || 40;
      S.found.forEach((k, n) => { const pts = P.words[k].cells.map(cellCenter); svg += `<polyline points="${pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" class="fw-pl" style="stroke:${COLORS[n % COLORS.length]};stroke-width:${(cw * .86).toFixed(1)}px"/>`; });
      if (path.length > 1) svg += `<polyline points="${path.map(i => cellCenter(i).map(v => v.toFixed(1)).join(',')).join(' ')}" class="fw-pl cur" style="stroke-width:${(cw * .86).toFixed(1)}px"/>`;
      line.setAttribute('viewBox', `0 0 ${grid.clientWidth} ${grid.clientHeight}`);
      line.innerHTML = svg;
      const cur = path.map(i => P.grid[i]).join('');
      q('.fw-word').innerHTML = cur ? `<b>${E(cur.toUpperCase())}</b>` : msgHtml || `<span>${TIP}</span>`;
      q('.fwN').textContent = `${S.found.length}/${P.words.length}`;
      q('.fwH').textContent = duel ? '' : Math.max(0, HINTS - S.hints) || '+';
      q('[data-act="hint"]').hidden = duel;
      q('[data-act="check"]').disabled = path.length < 2;
      q('[data-act="clear"]').disabled = !path.length;
      // список слов: найденные — словом, остальные — клеточками по длине
      const order = P.words.map((w, k) => k).sort((a, b) => P.words[a].w.length - P.words[b].w.length || a - b);
      q('.fw-list').innerHTML = order.map(k => {
        const w = P.words[k].w, f = S.found.includes(k), hinted = S.hinted.includes(k);
        if (f) return `<span class="fw-w f" style="--c:${COLORS[S.found.indexOf(k) % COLORS.length]}">${E(w)}</span>`;
        return `<span class="fw-w" title="${w.length} ${pl(w.length, 'буква', 'буквы', 'букв')}">${[...w].map((ch, j) => `<i>${j === 0 && hinted ? ch.toUpperCase() : ''}</i>`).join('')}</span>`;
      }).join('');
    }
    let msgHtml = '';
    const TIP = root.matchMedia?.('(pointer:coarse)').matches ? 'Веди пальцем по буквам или нажимай их по очереди' : 'Зажми кнопку мыши и веди по буквам — или щёлкай их по очереди';
    function msg(html, bad){
      msgHtml = `<span class="${bad ? 'bad' : 'ok'}">${html}</span>`;
      clearTimeout(msgT); msgT = setTimeout(() => { msgHtml = ''; if (!stopped) paint(); }, 2200);
      paint();
    }
    const secs = () => S.elapsed + (runAt ? (Date.now() - runAt) / 1000 : 0);
    function clock(){
      if (document.hidden && runAt) { S.elapsed = secs(); runAt = 0; }
      else if (!document.hidden && !runAt && !ended && !stopped) runAt = Date.now();
      const s = secs();
      q('.fwT').textContent = duel ? mmss(Math.max(0, o.timeLimit - s)) : mmss(s);
      if (duel && !ended && s >= o.timeLimit) finish(false);
    }
    function persist(){ if (!duel && !ended) save('d37_fillword_save_' + (daily ? 'daily' : 'lv'), { v: 1, day: daily ? dayNo() : 0, lv: o.lv, S: { ...S, elapsed: secs(), n: P.words.length } }); }
    // ── Проверка выбранного пути ──
    function submit(auto){
      if (ended || path.length < 2) return false;
      const word = path.map(i => P.grid[i]).join('');
      const k = P.words.findIndex((w, j) => !S.found.includes(j) && w.cells.length === path.length && w.cells.every((c, n) => c === path[n]));
      if (k >= 0) {
        S.found.push(k);
        path = [];
        api.sfx(S.found.length === P.words.length ? 'win' : 'ok');
        const cl = P.words[k].cells;
        cl.forEach((c, n) => setTimeout(() => { cells[c].classList.add('pop'); setTimeout(() => cells[c].classList.remove('pop'), 380); }, n * 45));
        msg(`✅ ${E(P.words[k].w.toUpperCase())}`);
        o.onScore?.(duelScore());
        persist();
        if (S.found.length === P.words.length) setTimeout(() => finish(true), 420);
        return true;
      }
      if (auto) return false;
      const fj = P.words.findIndex(w => w.w === word);
      if (fj >= 0 && S.found.includes(fj)) msg(`«${E(word.toUpperCase())}» уже найдено`, true);
      else if (fj >= 0) msg(`«${E(word.toUpperCase())}» здесь есть — но в другом месте`, true);
      else msg(`Слова «${E(word.toUpperCase())}» здесь нет`, true);
      api.sfx('bad');
      path = [];
      paint();
      return false;
    }
    const duelScore = () => S.found.reduce((a, k) => a + P.words[k].w.length * 20, 0);
    // ── Ввод: нажатия и «веди пальцем» ──
    const free = i => i >= 0 && !S.found.includes(owner[i]);
    function cellAt(e, strict){
      const g = grid.getBoundingClientRect();
      const c = Math.floor((e.clientX - g.left) / g.width * P.w), r = Math.floor((e.clientY - g.top) / g.height * P.h);
      if (c < 0 || r < 0 || c >= P.w || r >= P.h) return -1;
      const cx = (c + .5) * g.width / P.w + g.left, cy = (r + .5) * g.height / P.h + g.top;
      if (strict && (Math.abs(e.clientX - cx) > g.width / P.w * .36 || Math.abs(e.clientY - cy) > g.height / P.h * .36)) return -2;
      return r * P.w + c;
    }
    const adj = (a, b) => nbs(a, P.w, P.h).includes(b);
    function tap(i){
      if (!free(i)) return;
      const k = path.indexOf(i);
      if (k >= 0 && k === path.length - 1) path.pop();
      else if (k >= 0) path = path.slice(0, k + 1);
      else if (!path.length || adj(path[path.length - 1], i)) path.push(i);
      else path = [i];
      api.sfx('tick');
      msgHtml = '';
      if (!submit(true)) paint();
    }
    grid.addEventListener('pointerdown', e => {
      if (ended || stopped) return;
      const i = cellAt(e);
      if (!free(i)) return;
      e.preventDefault();
      try { grid.setPointerCapture(e.pointerId); } catch (er) {}
      drag = { id: e.pointerId, start: i, moved: false, was: path.slice() };
      if (path.length && path[path.length - 1] !== i && !path.includes(i) && adj(path[path.length - 1], i)) path.push(i);
      else if (!path.includes(i)) path = [i];
      paint();
    });
    grid.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const i = cellAt(e, true);
      if (!free(i)) return;
      const last = path[path.length - 1];
      if (i === last) return;
      const k = path.indexOf(i);
      if (k >= 0) { path = path.slice(0, k + 1); drag.moved = true; paint(); return; }
      if (adj(last, i)) { path.push(i); drag.moved = true; api.sfx('tick'); paint(); }
    });
    const up = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      if (d.moved) { submit(false); return; }
      // нажатие без движения: по клетке, которая уже была в пути, — убрать/укоротить
      path = d.was;
      tap(d.start);
    };
    grid.addEventListener('pointerup', up);
    grid.addEventListener('pointercancel', () => { drag = null; });
    function onKey(e){
      if (!el.isConnected || ended || stopped || !ov.hidden || e.target?.closest?.('input,textarea') || root.GameKit?.isOpen?.()) return;
      if (e.key === 'Enter') { e.preventDefault(); submit(false); }
      else if (e.key === 'Escape' && path.length) { e.preventDefault(); e.stopPropagation(); path = []; paint(); }
      else if (e.key === 'Backspace' && path.length) { e.preventDefault(); path.pop(); paint(); }
    }
    root.addEventListener('keydown', onKey);
    // ── Подсказка: первая буква случайного ненайденного слова ──
    async function hint(){
      if (ended || duel) return;
      const left = P.words.map((w, k) => k).filter(k => !S.found.includes(k) && !S.hinted.includes(k));
      if (!left.length) { msg('Подсказки уже показаны для всех слов'); return; }
      if (S.hints >= HINTS) { offer(); return; }
      S.hints++;
      giveHint(left);
    }
    function giveHint(left){
      const k = left[Math.floor(Math.random() * left.length)];
      S.hinted.push(k);
      api.sfx('tick');
      msg(`💡 Слово из ${P.words[k].w.length} букв начинается с подсвеченной «${P.words[k].w[0].toUpperCase()}»`);
      persist();
    }
    async function paid(how){
      if (how === 'ad') { if (await root.D37Ads.showReward('fillword_help')) return true; api.toast('Реклама не досмотрена'); return false; }
      const r = await C().revive('fillword');
      if (r?.ok) return true;
      api.toast(r?.reason === 'coins' ? 'Не хватает монет' : 'Не получилось — попробуй ещё раз');
      return false;
    }
    function offer(){
      const adOk = !!root.D37Ads?.rewardReady?.(), price = C()?.RULES?.revive ?? 30, coins = C()?.coins?.() ?? 0;
      ov.hidden = false;
      ov.innerHTML = `<div class="sl-t">Подсказки кончились</div><div class="sl-s">Ещё одна подсказка — за рекламу или монеты (подсказка снижает очки на 40).</div>
        <div class="sl-col">${adOk ? '<button type="button" class="ct-start" data-act="pay-ad">📺 Посмотреть рекламу → подсказка</button>' : ''}
        ${C() ? `<button type="button" class="${adOk ? 'hd-alt' : 'ct-start'}" data-act="pay-coins"${coins >= price ? '' : ' disabled'}>🪙 За ${price} монет</button>` : ''}
        <button type="button" class="hd-alt" data-act="close">↩ Искать дальше</button></div>`;
    }
    // ── Конец ──
    async function finish(won){
      if (ended) return;
      ended = true;
      S.elapsed = secs(); runAt = 0; clearInterval(tick); clock();
      const sec = S.elapsed;
      if (duel) {
        const sc = duelScore() + (won ? 1000 + Math.max(0, Math.round(o.timeLimit - sec)) * 2 : 0);
        api.sfx(won ? 'win' : 'bad');
        ov.hidden = false;
        ov.innerHTML = `<div class="sl-t">${won ? '🎉 Все слова!' : '⏱ Время вышло'}</div><div class="sl-big">${num(sc)}</div><div class="sl-s">${mmss(Math.min(sec, o.timeLimit))} · найдено ${S.found.length} из ${P.words.length}. Итог соревнования — сверху</div>`;
        o.onEnd?.(sc);
        return;
      }
      try { localStorage.removeItem('d37_fillword_save_' + (daily ? 'daily' : 'lv')); } catch (e) {}
      const sc = scoreOf(N, sec, S.hints), key = daily ? 'fillword_daily' : 'fillword';
      const coins = daily ? DAILY_COINS : coinsOf(N), runId = 'fw' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
      const prevBest = api.local().best || 0;
      api.report(key, true, sc, daily ? sc : Math.max(sc, prevBest));
      api.sfx('win');
      if (daily) { save(DAILY_KEY, { day: dayNo(), sec: Math.round(sec), hints: S.hints, score: sc }); root.dispatchEvent(new Event('d37:daily')); }
      else { const pr = load(PROG, { lv: 1 }); if ((o.lv || 1) >= (pr.lv || 1)) save(PROG, { ...pr, lv: (o.lv || 1) + 1 }); }
      ov.hidden = false;
      ov.innerHTML = `<div class="sl-t">🎉 ${daily ? `Филворд дня #${dayNo()} решён!` : `Уровень ${o.lv} пройден!`}</div><div class="sl-big">${mmss(sec)}</div>
        <div class="sl-s">${P.words.length} ${pl(P.words.length, 'слово', 'слова', 'слов')} · подсказок: ${S.hints} · ${num(sc)} ${pl(sc, 'очко', 'очка', 'очков')}${!daily && sc > prevBest ? ' · 🏆 рекорд!' : ''}</div>
        <div class="sl-coins">${C() && sec >= 20 ? `🪙 +${coins} ${pl(coins, 'монета', 'монеты', 'монет')}…` : ''}</div>
        <div class="ct-actions">${daily ? '<button type="button" class="ct-start" data-act="mode:lv">🧩 К уровням</button>' : `<button type="button" class="ct-start" data-act="next">▶ Уровень ${(o.lv || 1) + 1}</button>`}<button type="button" data-act="share">📤 Поделиться</button></div>
        ${daily ? '<div class="sd-top fw-top" hidden></div>' : ''}`;
      if (daily) loadTop(ov.querySelector('.fw-top'));
      if (!C() || sec < 20) return;
      const r = await C().run('fillword', coins, runId);
      const box = ov.querySelector('.sl-coins');
      if (box && !stopped) box.innerHTML = r?.ok && r.got > 0 ? `🪙 <b>+${num(r.got)}</b> ${pl(r.got, 'монета', 'монеты', 'монет')}${r.base && r.got > r.base ? ' <span class="hd-vip">VIP ×2</span>' : ''}` : r?.reason === 'day_cap' ? '🪙 Лимит монет за игры на сегодня исчерпан' : '';
    }
    async function share(btn){
      const text = daily ? `Решил «Филворд дня» #${dayNo()} за ${mmss(S.elapsed)}${S.hints ? ` (подсказок: ${S.hints})` : ' без подсказок'}. А ты?` : `Прошёл уровень ${o.lv} в «Филворде» за ${mmss(S.elapsed)}. Попробуй!`;
      const url = location.origin + '/games/fillword';
      if (navigator.share) { navigator.share({ title: 'Филворд', text, url }).catch(() => {}); return; }
      try { await navigator.clipboard.writeText(text + ' ' + url); btn.textContent = '✅ Скопировано'; } catch (e) { prompt('Скопируй и отправь другу:', text + ' ' + url); }
    }
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]');
      if (!b || !el.contains(b) || stopped) return;
      const a = b.dataset.act;
      if (a === 'check') submit(false);
      else if (a === 'clear') { path = []; paint(); }
      else if (a === 'hint') hint();
      else if (a === 'pay-ad' || a === 'pay-coins') {
        ov.querySelectorAll('button').forEach(x => { x.disabled = true; });
        if (await paid(a === 'pay-ad' ? 'ad' : 'coins')) { ov.hidden = true; const left = P.words.map((w, k) => k).filter(k => !S.found.includes(k) && !S.hinted.includes(k)); S.hints++; if (left.length) giveHint(left); }
        else offer();
      }
      else if (a === 'close') { ov.hidden = true; }
      else if (a === 'share') share(b);
      else if (a === 'next') { b.disabled = true; try { await root.D37Ads?.interstitial?.('fillword'); } catch (er) {} if (!stopped) o.onMode?.('lv', (o.lv || 1) + 1); }
      else if (a.startsWith('mode:')) { persist(); o.onMode?.(a.slice(5)); }
      else if (a === 'duel') location.hash = '#/games/fillword/' + root.GameRoom.newCode();
    });
    paint();
    // поле поменяло размер (полный экран, поворот телефона, окно) — «змейки» пересчитать: они в пикселях поля
    let lastW = grid.clientWidth;
    const ro = root.ResizeObserver ? new ResizeObserver(() => { if (stopped || grid.clientWidth === lastW) return; lastW = grid.clientWidth; paint(); }) : null;
    ro?.observe(grid);
    runAt = Date.now(); tick = setInterval(clock, 500); clock();
    if (daily) loadTop(q('.fw-top'));
    me.stop = () => { if (!ended) { S.elapsed = secs(); runAt = 0; persist(); } stopped = true; clearInterval(tick); clearTimeout(msgT); ro?.disconnect(); root.removeEventListener('keydown', onKey); };
    me.S = S; me.P = P;
    me.trace = cellsList => { path = []; for (const c of cellsList) tap(c); return S.found.length; };
    me.check = () => submit(false);
    return me;
  }
  async function loadTop(box){
    if (!box || typeof sbClient === 'undefined' || !sbClient) return;
    try {
      const { data, error } = await sbClient.rpc('daily_top', { p_game: 'fillword_daily', lim: 10 });
      if (error || !data?.length) return;
      box.hidden = false;
      box.innerHTML = `<b>🏆 Филворд дня — лучшие сегодня</b><ol>${data.map(r => `<li><span>${E(r.nick || 'Игрок')}</span><b>${num(r.best_score)}</b></li>`).join('')}</ol>`;
    } catch (e) {}
  }

  function open(mode, lv){
    B?.stop(); B = null;
    if (mode === 'daily') {
      const d = readDaily();
      if (d) {
        rootEl.innerHTML = `<div class="fw"><div class="sl-opts fw-modes"><button type="button" class="on">📅 Филворд дня #${dayNo()}</button><button type="button" data-act="mode:lv">🧩 Уровень ${load(PROG, { lv: 1 }).lv || 1}</button></div>
          <div class="sd-done"><div class="sl-t">✅ Филворд дня #${d.day} решён</div><div class="sl-s">Время ${mmss(d.sec)} · подсказок: ${d.hints} · ${num(d.score)} ${pl(d.score, 'очко', 'очка', 'очков')}. Новый — завтра в 00:00 по Москве.</div>
          <div class="ct-actions"><button type="button" class="ct-start" data-act="mode:lv">🧩 Играть уровни</button></div><div class="sd-top fw-top" hidden></div></div></div>`;
        rootEl.querySelectorAll('[data-act="mode:lv"]').forEach(b => b.addEventListener('click', () => open('lv')));
        loadTop(rootEl.querySelector('.fw-top'));
        return;
      }
    }
    const prog = load(PROG, { lv: 1 });
    lv = mode === 'lv' ? Math.max(1, lv || prog.lv || 1) : 0;
    const sv = load('d37_fillword_save_' + mode, null);
    const saved = sv && sv.v === 1 && (mode === 'daily' ? sv.day === dayNo() : sv.lv === lv) ? sv.S : null;
    rootEl.innerHTML = '<div class="gm-loading"><div class="spinner"></div>Прячем слова…</div>';
    setTimeout(() => {
      if (!rootEl) return;
      const P = mode === 'daily' ? dailyPuzzle(dayNo()) : levelPuzzle(lv);
      if (!P) { rootEl.innerHTML = '<div class="empty-state"><div class="empty-state-title">Не получилось составить поле</div><div class="empty-state-text">Обнови страницу.</div></div>'; return; }
      B = board(rootEl, { mode, lv, P, saved, onMode: (m, l) => open(m, l) });
      if (saved && saved.found?.length) api.toast('▶ Продолжаем: найдено ' + saved.found.length);
    }, 20);
  }

  // ═══ CSS ═══
  const CSS = `
.fw{display:flex;flex-direction:column;align-items:center;gap:.5rem}
.fw-modes{justify-content:center}
.fw-bar{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;font-size:.8rem;color:var(--muted)}
.fw-bar b{color:var(--text);font-variant-numeric:tabular-nums}
.fw-body,.fw-side{display:flex;flex-direction:column;align-items:center;gap:.5rem;width:100%}
.fw-wrap{position:relative;width:min(100%,520px,calc(100vh - 300px));min-width:min(100%,240px)}
.fw-grid{display:grid;grid-template-columns:repeat(var(--w),1fr);grid-template-rows:repeat(var(--h),1fr);gap:5px;aspect-ratio:var(--w)/var(--h);padding:6px;border-radius:16px;background:#1e1b4b;touch-action:none;user-select:none;-webkit-user-select:none}
.fw-c{position:relative;z-index:1;min-width:0;min-height:0;border-radius:10px;background:#ede9fe;color:#1e1b4b;display:flex;align-items:center;justify-content:center;font:900 clamp(.9rem,calc(42vw / var(--w)),2rem) var(--font-display);cursor:pointer;transition:background .15s,transform .12s}
.fw-c.p{transform:scale(1.04)}
.fw-c.f{color:#1e1b4b;cursor:default}
.fw-c.hint{box-shadow:0 0 0 3px #f97316;animation:fwHint .7s ease-in-out infinite alternate}
.fw-c.pop{transform:scale(1.12)}
@keyframes fwHint{to{box-shadow:0 0 0 5px #f97316}}
.fw-grid{position:relative}
.fw-line{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:0}
.fw-pl{fill:none;stroke-linecap:round;stroke-linejoin:round}
.fw-pl.cur{stroke:#facc15}
.fw-c.f,.fw-c.p{background:transparent}
.fw-word{min-height:1.8rem;font-size:.82rem;color:var(--muted);text-align:center}
.fw-word b{font:900 1.35rem var(--font-display);letter-spacing:2px;color:#fde047}
.fw-word .bad{color:#f87171;font-weight:700}
.fw-word .ok{color:#4ade80;font-weight:800}
.fw-ctl{display:flex;gap:.4rem;justify-content:center}
.fw-b{min-height:42px;border:1px solid var(--border);background:rgba(255,255,255,.06);color:var(--text);border-radius:11px;padding:.5rem .85rem;font:800 .8rem 'Montserrat',sans-serif;cursor:pointer;touch-action:manipulation}
.fw-b.ok{border:0;color:#fff;background:linear-gradient(135deg,#16a34a,#22c55e)}
.fw-b:disabled{opacity:.4;cursor:default}
.fw-b[hidden]{display:none}
.fw-list{display:flex;flex-wrap:wrap;gap:.35rem;justify-content:center;max-width:560px}
.fw-w{display:inline-flex;gap:2px;align-items:center;padding:.2rem .35rem;border-radius:8px;background:rgba(255,255,255,.05);font-size:.8rem}
.fw-w i{display:inline-flex;align-items:center;justify-content:center;width:14px;height:16px;border-radius:3px;background:rgba(255,255,255,.12);font-style:normal;font-weight:800;font-size:.66rem;color:#fde047}
.fw-w.f{background:var(--c);color:#1e1b4b;font-weight:800;padding:.2rem .5rem}
.fw-top{width:100%;max-width:420px}
@media(min-width:900px),(orientation:landscape) and (min-width:600px){
  .fw-body{flex-direction:row;align-items:flex-start;justify-content:center;gap:1.2rem}
  .fw-wrap{flex:none;width:min(560px,max(240px,calc(100vh - 340px)))}
  .fw-side{width:min(300px,40vw);align-items:stretch}
  .fw-word{text-align:left}
  .fw-ctl,.fw-list{justify-content:flex-start}
  .fw-side .ct-actions{justify-content:flex-start}
}
@media(orientation:landscape) and (max-height:560px){.fw-wrap{width:min(100%,calc(100vh - 170px))}}
body:not(.high) .fw-c{transition:none}
`;
  function css(){ if (document.getElementById('fwCss')) return; const s = document.createElement('style'); s.id = 'fwCss'; s.textContent = CSS; document.head.appendChild(s); }

  root.GAME_IMPL = root.GAME_IMPL || {};
  root.GAME_IMPL.fillword = {
    mount(el, gameApi){
      rootEl = el; api = gameApi;
      css();
      if (gameApi.param !== 'daily' && root.GameRoom?.validCode(gameApi.param)) {
        stopDuel = root.Versus.start(rootEl, api, 'fillword', gameApi.param, {
          run(stage, rand, hooks){
            B?.stop();
            stage.insertAdjacentHTML('afterbegin', '<div class="ct-note" style="text-align:center">⏱ 5 минут · одинаковое поле у обоих · очки за найденные слова, нашёл все — +1000 и бонус за время</div>');
            const host = document.createElement('div');
            stage.appendChild(host);
            const P = generate(DUEL_SIZE, rand);
            B = board(host, { mode: 'duel', P, timeLimit: DUEL_SEC, onScore: hooks.progress, onEnd: sc => hooks.done(sc) });
          },
          stop(){ B?.stop(); B = null; },
        });
        return;
      }
      if (gameApi.param === 'daily' || !readDaily()) open('daily'); else open('lv');
    },
    unmount(){ B?.stop(); B = null; stopDuel?.(); stopDuel = null; rootEl = null; },
    get board(){ return B; },
    _test: { rng, sizeOf, words, hamPath, cutLengths, countPaths, generate, dayNo, levelPuzzle, dailyPuzzle, scoreOf, coinsOf, nbs, DAILY_SIZE, DUEL_SIZE },
  };
  // «Филворд дня» на главной — fillwordDayNo()/fillwordToday() в js/features/games.js (та же формула дня и d37_fillword_daily)
})();
