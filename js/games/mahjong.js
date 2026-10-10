// ═══════════════════════════════════════
//  «МАДЖОНГ КОННЕКТ» — соедини пары (как Onet): две одинаковые картинки, путь между ними — не больше двух поворотов
// ═══════════════════════════════════════
// Путь идёт по пустым клеткам и может огибать поле снаружи. Уровни растут, со 2-го фишки «падают» (вниз, влево, вверх,
// вправо). Время на уровень; кончилось — «+60 секунд» за рекламу или 30 монет (раз за уровень). 3 подсказки и 2 перемешивания
// на уровень, ещё — за рекламу/монеты. Ходов нет — поле перемешивается само. Очки: пара +10, быстрые пары подряд (≤ 4 с) —
// комбо +5×N, уровень — 10 × оставшиеся секунды + 100 × номер. Партия сохраняется (localStorage d37_mahjong_save).
// «⚔️ Соревнование» (versus.js): одинаковое поле 8×8 у обоих, 3 минуты, у кого больше очков. Движок — GAME_IMPL.mahjong._test.
(() => {
  const SETS = {
    fruit: ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍒', '🍑', '🍍', '🥝', '🥥', '🥕', '🌽', '🍄', '🍩', '🍪', '🧁', '🍭', '🍬', '🍫', '🍕', '🍔'],
    animal: ['🐶', '🐱', '🐭', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🦉', '🐢', '🐙', '🦋', '🐝', '🐞', '🦄', '🐳'],
    game: ['🎮', '🕹️', '🎧', '🏆', '💎', '⚔️', '🛡️', '🏹', '🔮', '👑', '💰', '🎲', '🚀', '⭐', '🔥', '❤️', '⚡', '🎯', '🧩', '🍀', '🗝️', '🧪', '💣', '🎁'],
  };
  const SET_ORDER = ['fruit', 'animal', 'game'];
  // [строк, столбцов, видов картинок, куда падают, секунд, набор] — для широкого экрана; на узком строки и столбцы меняются
  const LV = [[6, 8, 12, '', 240, 'fruit'], [7, 10, 16, 'down', 270, 'animal'], [8, 10, 20, 'left', 300, 'game'], [8, 12, 22, 'up', 330, 'fruit'], [8, 12, 24, 'right', 330, 'animal'], [8, 14, 28, 'down', 360, 'game']];
  const GRAV = { '': 'не падают', down: 'падают вниз ⬇️', up: 'падают вверх ⬆️', left: 'падают влево ⬅️', right: 'падают вправо ➡️' };
  const DUEL_SEC = 180, SAVE = 'd37_mahjong_save', COMBO_MS = 4000;

  function levelDef(n){
    if (n <= LV.length) return LV[n - 1];
    return [8, 14, 30, ['down', 'left', 'up', 'right', ''][n % 5], Math.max(240, 380 - (n - 6) * 10), SET_ORDER[n % 3]];
  }
  function facesFor(set, kinds){
    const i = SET_ORDER.indexOf(set), all = [...SETS[set], ...SETS[SET_ORDER[(i + 1) % 3]], ...SETS[SET_ORDER[(i + 2) % 3]]];
    return all.slice(0, kinds);
  }
  function shuffleArr(a, rand){ for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // ── Движок ──
  // cells[r*C+c] = null | { id, f }
  function makeBoard(R, C, kinds, grav, time, faces, rand, n){
    const P = R * C / 2, list = [];
    for (let p = 0; p < P; p++) list.push(p % kinds, p % kinds);
    shuffleArr(list, rand);
    const G = { n, R, C, grav, time, left: time, faces, cells: list.map((f, i) => ({ id: i, f })), pairs: P, done: 0, score: 0, combo: 0, lastAt: 0, hints: 3, shuffles: 2, revived: false, rand };
    ensureMove(G);
    return G;
  }
  function newLevel(n, narrow, rand){
    let [R, C, kinds, grav, time, set] = levelDef(n);
    if (narrow) [R, C] = [C, R];
    return makeBoard(R, C, kinds, grav, time, facesFor(set, kinds), rand, n);
  }
  const free = (G, r, c) => r < 0 || c < 0 || r >= G.R || c >= G.C || !G.cells[r * G.C + c];
  // Прямой отрезок свободен (концы не проверяются)
  function clear(G, r1, c1, r2, c2){
    if (r1 === r2) { for (let c = Math.min(c1, c2) + 1; c < Math.max(c1, c2); c++) if (!free(G, r1, c)) return false; return true; }
    if (c1 === c2) { for (let r = Math.min(r1, r2) + 1; r < Math.max(r1, r2); r++) if (!free(G, r, c1)) return false; return true; }
    return false;
  }
  const plen = p => p.reduce((s, q, i) => i ? s + Math.abs(q[0] - p[i - 1][0]) + Math.abs(q[1] - p[i - 1][1]) : 0, 0);
  // Путь a → b с не более чем двумя поворотами: точки [a, углы…, b] или null
  function findPath(G, a, b){
    const A = G.cells[a], Bt = G.cells[b];
    if (a === b || !A || !Bt || A.f !== Bt.f) return null;
    const ra = Math.floor(a / G.C), ca = a % G.C, rb = Math.floor(b / G.C), cb = b % G.C;
    if ((ra === rb || ca === cb) && clear(G, ra, ca, rb, cb)) return [[ra, ca], [rb, cb]];
    for (const [r, c] of [[ra, cb], [rb, ca]]) if (free(G, r, c) && clear(G, ra, ca, r, c) && clear(G, r, c, rb, cb)) return [[ra, ca], [r, c], [rb, cb]];
    let best = null;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let r = ra + dr, c = ca + dc; r >= -1 && c >= -1 && r <= G.R && c <= G.C && free(G, r, c); r += dr, c += dc) {
        const Y = dr ? [r, cb] : [rb, c];
        if (!free(G, Y[0], Y[1]) || !clear(G, r, c, Y[0], Y[1]) || !clear(G, Y[0], Y[1], rb, cb)) continue;
        const p = [[ra, ca], [r, c], Y, [rb, cb]];
        if (!best || plen(p) < plen(best)) best = p;
      }
    }
    return best;
  }
  // Любая доступная пара (для подсказки и проверки «ходов нет»)
  function findMove(G){
    const by = new Map();
    G.cells.forEach((t, i) => { if (t) { if (!by.has(t.f)) by.set(t.f, []); by.get(t.f).push(i); } });
    for (const list of by.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (findPath(G, list[i], list[j])) return [list[i], list[j]];
    return null;
  }
  function reshuffle(G){
    const idx = [], tiles = [];
    G.cells.forEach((t, i) => { if (t) { idx.push(i); tiles.push(t); } });
    shuffleArr(tiles, G.rand);
    idx.forEach((i, k) => { G.cells[i] = tiles[k]; });
  }
  function ensureMove(G){
    for (let k = 0; k < 60 && G.done < G.pairs && !findMove(G); k++) reshuffle(G);
  }
  function applyGravity(G){
    const { R, C, cells } = G;
    if (G.grav === 'down' || G.grav === 'up') for (let c = 0; c < C; c++) {
      const col = [];
      for (let r = 0; r < R; r++) if (cells[r * C + c]) col.push(cells[r * C + c]);
      for (let r = 0; r < R; r++) cells[r * C + c] = null;
      col.forEach((t, k) => { cells[(G.grav === 'down' ? R - col.length + k : k) * C + c] = t; });
    }
    if (G.grav === 'left' || G.grav === 'right') for (let r = 0; r < R; r++) {
      const row = [];
      for (let c = 0; c < C; c++) if (cells[r * C + c]) row.push(cells[r * C + c]);
      for (let c = 0; c < C; c++) cells[r * C + c] = null;
      row.forEach((t, k) => { cells[r * C + (G.grav === 'right' ? C - row.length + k : k)] = t; });
    }
  }
  // Убрать пару. now — время в мс (для комбо). Возвращает { path, gained, combo, cleared, shuffled } или null
  function match(G, a, b, now){
    const path = findPath(G, a, b);
    if (!path) return null;
    G.cells[a] = null; G.cells[b] = null;
    G.done++;
    G.combo = now - G.lastAt <= COMBO_MS && G.lastAt ? G.combo + 1 : 0;
    G.lastAt = now;
    const gained = 10 + 5 * G.combo;
    G.score += gained;
    applyGravity(G);
    const cleared = G.done === G.pairs;
    let shuffled = false;
    if (!cleared && !findMove(G)) { ensureMove(G); shuffled = true; }
    return { path, gained, combo: G.combo, cleared, shuffled };
  }
  const levelBonus = G => Math.max(0, Math.round(G.left)) * 10 + 100 * G.n;

  // ── Экран ──
  let root, api, B = null, stopDuel = null;
  const C = () => window.D37Coins;
  const num = n => Number(n || 0).toLocaleString('ru');
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function saveGame(G){
    try { localStorage.setItem(SAVE, JSON.stringify({ v: 1, n: G.n, R: G.R, C: G.C, grav: G.grav, time: G.time, left: G.left, faces: G.faces, cells: G.cells, pairs: G.pairs, done: G.done, score: G.score, hints: G.hints, shuffles: G.shuffles, revived: G.revived })); } catch (e) {}
  }
  function dropSave(){ try { localStorage.removeItem(SAVE); } catch (e) {} }
  function loadGame(){
    try {
      const d = JSON.parse(localStorage.getItem(SAVE) || 'null');
      if (!d || d.v !== 1 || !Array.isArray(d.cells) || d.cells.length !== d.R * d.C || !Array.isArray(d.faces)) return null;
      if (!d.cells.every(t => t === null || (t && Number.isInteger(t.f) && t.f >= 0 && t.f < d.faces.length))) return null;
      if (d.done >= d.pairs || d.left <= 0) return null;
      const G = { ...d, combo: 0, lastAt: 0, rand: Math.random };
      ensureMove(G);
      return G;
    } catch (e) { return null; }
  }

  // Одно поле. o: { G, duel, onScore, onEnd, onLevel(G) }
  function createBoard(el, o){
    let G = o.G;
    const me = {};
    let sel = -1, tick = 0, lastT = 0, ended = false, stopped = false, busy = false, hintT = 0, tw = 40, th = 46, pad = 20;
    const els = new Map();
    el.innerHTML = `<div class="mj">
        <div class="mj-bar">
          <span class="mj-st">${o.duel ? '' : `Уровень <b class="mjLv">${G.n}</b>`}</span>
          <span class="mj-st">Очки <b class="mjScore">0</b></span>
          <span class="mj-btns"><button type="button" data-act="hint" title="Подсказка">💡 <b class="mjHints">3</b></button><button type="button" data-act="shuffle" title="Перемешать">🔀 <b class="mjShuf">2</b></button></span>
        </div>
        <div class="mj-time"><i class="mjBar"></i><span class="mjTime"></span></div>
        <div class="mj-note mjGrav"></div>
        <div class="mj-wrap"><div class="mj-board"></div><svg class="mj-path" aria-hidden="true"></svg><div class="sl-over" hidden></div></div>
        ${o.duel ? '' : '<div class="ct-actions"><button type="button" class="ct-duel-btn" data-act="duel">⚔️ Наперегонки с другом</button><button type="button" data-act="restart">↻ Сначала</button></div>'}
      </div>`;
    const q = s => el.querySelector(s), board = q('.mj-board'), svg = q('.mj-path'), ov = q('.sl-over');

    function layout(){
      const W = Math.min(q('.mj').clientWidth || 340, 760);
      const narrowRatio = G.C <= 8 ? 1.08 : 1.18;
      tw = Math.max(26, Math.min(62, Math.floor((W - 16) / (G.C + 1))));
      th = Math.round(tw * narrowRatio);
      pad = Math.round(tw / 2);
      board.style.width = (G.C * tw + pad * 2) + 'px';
      board.style.height = (G.R * th + pad * 2) + 'px';
      board.style.setProperty('--tw', tw + 'px'); board.style.setProperty('--th', th + 'px');
      svg.setAttribute('width', G.C * tw + pad * 2); svg.setAttribute('height', G.R * th + pad * 2);
      svg.style.width = (G.C * tw + pad * 2) + 'px'; svg.style.height = (G.R * th + pad * 2) + 'px';
      render(false);
    }
    const cx = c => pad + c * tw + tw / 2, cy = r => pad + r * th + th / 2;
    function render(animate = true){
      const seen = new Set();
      G.cells.forEach((t, i) => {
        if (!t) return;
        seen.add(t.id);
        let e = els.get(t.id);
        if (!e) {
          e = document.createElement('button');
          e.type = 'button'; e.className = 'mj-t';
          e.innerHTML = `<span>${G.faces[t.f]}</span>`;
          board.appendChild(e);
          els.set(t.id, e);
        }
        if (e.dataset.f !== String(t.f)) { e.dataset.f = t.f; e.firstChild.textContent = G.faces[t.f]; }
        e.dataset.i = i;
        e.classList.toggle('noanim', !animate);
        e.classList.toggle('sel', i === sel);
        e.style.transform = `translate(${pad + (i % G.C) * tw}px,${pad + Math.floor(i / G.C) * th}px)`;
      });
      for (const [id, e] of els) if (!seen.has(id)) { els.delete(id); e.classList.add('gone'); setTimeout(() => e.remove(), 260); }
      ui();
    }
    function ui(){
      q('.mjScore').textContent = num(G.score);
      const lv = q('.mjLv'); if (lv) lv.textContent = G.n;
      q('.mjHints').textContent = G.hints;
      q('.mjShuf').textContent = G.shuffles;
      q('.mjGrav').textContent = o.duel ? `Пар: ${G.done} из ${G.pairs}` : `Пар: ${G.done} из ${G.pairs} · картинки ${GRAV[G.grav]}`;
      const left = Math.max(0, G.left), pct = Math.max(0, Math.min(100, left / G.time * 100));
      q('.mjBar').style.width = pct + '%';
      q('.mjBar').classList.toggle('low', left <= 30);
      q('.mjTime').textContent = mmss(left);
    }
    function drawPath(path){
      const pts = path.map(([r, c]) => `${cx(c)},${cy(r)}`).join(' ');
      svg.innerHTML = `<polyline points="${pts}" />`;
      clearTimeout(drawPath.t);
      drawPath.t = setTimeout(() => { svg.innerHTML = ''; }, 380);
    }
    // Время: идёт, пока вкладка открыта
    function clock(){
      const now = performance.now(), dt = Math.min(1, (now - lastT) / 1000);
      lastT = now;
      if (ended || busy || !ov.hidden || document.hidden) return;
      G.left -= dt;
      if (G.left <= 0) { G.left = 0; ui(); timeUp(); return; }
      ui();
    }
    function start(){ lastT = performance.now(); clearInterval(tick); tick = setInterval(clock, 250); }

    function pick(i){
      if (ended || busy || !ov.hidden || !G.cells[i]) return;
      if (sel < 0 || sel === i) { sel = sel === i ? -1 : i; api.sfx('move'); render(); return; }
      const a = sel;
      sel = -1;
      if (G.cells[a].f !== G.cells[i].f) { sel = i; api.sfx('move'); render(); return; }
      const res = match(G, a, i, performance.now());
      if (!res) { flash([a, i], 'no'); api.sfx('bad'); render(); return; }
      drawPath(res.path);
      api.sfx(res.combo >= 2 ? 'win' : 'ok');
      render();
      if (res.combo >= 1) floatText(`Комбо ×${res.combo + 1}  +${res.gained}`);
      if (res.shuffled) api.toast('🔀 Ходов не было — перемешали');
      o.onScore?.(G.score);
      if (!o.duel) saveGame(G);
      if (res.cleared) setTimeout(() => levelDone(), 420);
    }
    function flash(idx, cls){
      idx.forEach(i => { const t = G.cells[i]; const e = t && els.get(t.id); if (!e) return; e.classList.remove(cls); void e.offsetWidth; e.classList.add(cls); setTimeout(() => e.classList.remove(cls), 600); });
    }
    function floatText(t){
      const f = document.createElement('div');
      f.className = 'mj-float'; f.textContent = t;
      q('.mj-wrap').appendChild(f);
      setTimeout(() => f.remove(), 900);
    }
    board.addEventListener('click', e => { const t = e.target.closest('.mj-t'); if (t) pick(+t.dataset.i); });

    async function paid(kind){   // 'ad' | 'coins' → true, если оплачено
      if (kind === 'ad') {
        if (await window.D37Ads.showReward('mahjong_' + (busy ? 'x' : 'help'))) return true;
        api.toast('Реклама не досмотрена'); return false;
      }
      const r = await C().revive('mahjong');
      if (r?.ok) return true;
      api.toast(r?.reason === 'coins' ? 'Не хватает монет' : 'Не получилось — попробуй ещё раз');
      return false;
    }
    function offer(what){
      const adOk = !!window.D37Ads?.rewardReady?.(), price = C()?.RULES?.revive ?? 30, coins = C()?.coins?.() ?? 0;
      const txt = what === 'hint' ? 'Подсказки кончились' : 'Перемешивания кончились';
      showOv(`<div class="sl-t">${txt}</div><div class="sl-s">Ещё одна — за рекламу или за монеты.</div>
        <div class="sl-col">${adOk ? `<button type="button" class="ct-start" data-act="buy-ad:${what}">📺 Посмотреть рекламу → ещё одна</button>` : ''}
        ${C() ? `<button type="button" class="${adOk ? 'hd-alt' : 'ct-start'}" data-act="buy-coins:${what}"${coins >= price ? '' : ' disabled'}>🪙 За ${price} монет</button>` : ''}
        <button type="button" class="hd-alt" data-act="close">↩ Играть дальше</button></div>`);
    }
    function useHint(){
      const m = findMove(G);
      if (!m) return;
      sel = -1;
      render();
      flash(m, 'hint');
      clearTimeout(hintT);
    }
    function useShuffle(){ sel = -1; reshuffle(G); ensureMove(G); api.sfx('move'); render(); if (!o.duel) saveGame(G); }

    // ── Конец уровня / время ──
    const showOv = html => { ov.innerHTML = html; ov.hidden = false; };
    const hideOv = () => { ov.hidden = true; ov.innerHTML = ''; };
    async function levelDone(){
      if (ended) return;
      const bonus = o.duel ? Math.max(0, Math.round(G.left)) * 5 : levelBonus(G);
      G.score += bonus;
      ui();
      api.sfx('win');
      if (o.duel) { ended = true; clearInterval(tick); showOv(`<div class="sl-t">✨ Все пары найдены!</div><div class="sl-big">${num(G.score)}</div><div class="sl-s">Бонус за время +${num(bonus)}. Итог соревнования — сверху</div>`); o.onScore?.(G.score); o.onEnd?.(G.score); return; }
      busy = true;
      const coins = Math.min(40, 5 + 2 * G.n), runId = 'mj' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
      api.report('mahjong', true, G.score, G.score);
      const next = G.n + 1;
      dropSave();
      try { localStorage.setItem(SAVE + '_lv', String(next)); localStorage.setItem(SAVE + '_sc', String(G.score)); } catch (e) {}
      showOv(`<div class="sl-t">✨ Уровень ${G.n} пройден!</div><div class="sl-big">${num(G.score)}</div>
        <div class="sl-s">Бонус +${num(bonus)} (время и уровень)</div><div class="sl-coins">${C() ? `🪙 +${coins} монет…` : ''}</div>
        <div class="ct-actions"><button type="button" class="ct-start" data-act="next">▶ Уровень ${next}</button><button type="button" data-act="share">📤 Поделиться</button></div>`);
      if (!C()) return;
      const r = await C().run('mahjong', coins, runId);
      const box = ov.querySelector('.sl-coins');
      if (box && !stopped) box.innerHTML = r?.ok ? `🪙 <b>+${num(r.got)}</b> монет${r.base && r.got > r.base ? ' <span class="hd-vip">VIP ×2</span>' : ''}` : r?.reason === 'day_cap' ? '🪙 Лимит монет за игры на сегодня исчерпан' : '🪙 Монеты не начислились';
    }
    function timeUp(){
      if (ended) return;
      if (o.duel) { ended = true; clearInterval(tick); api.sfx('bad'); showOv(`<div class="sl-t">⏱ Время вышло!</div><div class="sl-big">${num(G.score)}</div><div class="sl-s">Найдено пар: ${G.done} из ${G.pairs}. Итог соревнования — сверху</div>`); o.onEnd?.(G.score); return; }
      busy = true;
      api.sfx('bad');
      if (G.revived) { gameOver(); return; }
      const adOk = !!window.D37Ads?.rewardReady?.(), price = C()?.RULES?.revive ?? 30, coins = C()?.coins?.() ?? 0;
      showOv(`<div class="sl-t">⏱ Время вышло!</div><div class="sl-s">Осталось пар: ${G.pairs - G.done}. Добавить минуту? Можно один раз за уровень.</div>
        <div class="sl-col">${adOk ? '<button type="button" class="ct-start" data-act="time-ad">📺 Посмотреть рекламу → +60 секунд</button>' : ''}
        ${C() ? `<button type="button" class="${adOk ? 'hd-alt' : 'ct-start'}" data-act="time-coins"${coins >= price ? '' : ' disabled'}>🪙 +60 секунд за ${price} монет</button>` : ''}
        <button type="button" class="hd-alt" data-act="end">🏁 Закончить</button></div>`);
    }
    function gameOver(){
      ended = true;
      clearInterval(tick);
      dropSave();
      try { localStorage.removeItem(SAVE + '_lv'); localStorage.removeItem(SAVE + '_sc'); } catch (e) {}
      const prevBest = api.local().best || 0;
      api.report('mahjong', false, G.score, G.score);
      showOv(`<div class="sl-t">${G.score > prevBest && G.score > 0 ? '🏆 Новый рекорд!' : '🏁 Игра окончена'}</div><div class="sl-big">${num(G.score)}</div>
        <div class="sl-s">Дошёл до уровня ${G.n}</div>
        <div class="ct-actions"><button type="button" class="ct-start" data-act="again">↻ Сначала</button><button type="button" class="ct-duel-btn" data-act="duel">⚔️ С другом</button><button type="button" data-act="share">📤 Поделиться</button></div>`);
    }
    async function share(btn){
      const text = `Дошёл до ${G.n}-го уровня в «Маджонг Коннект» и набрал ${num(G.score)} очков. Попробуй!`, url = location.origin + '/games/mahjong';
      if (navigator.share) { navigator.share({ title: 'Маджонг Коннект', text, url }).catch(() => {}); return; }
      try { await navigator.clipboard.writeText(text + ' ' + url); btn.textContent = '✅ Скопировано'; } catch (e) { prompt('Скопируй и отправь другу:', text + ' ' + url); }
    }
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]');
      if (!b || !el.contains(b) || stopped) return;
      const a = b.dataset.act;
      if (a === 'hint') {
        if (ended || busy || !ov.hidden) return;
        if (G.hints > 0) { G.hints--; useHint(); ui(); if (!o.duel) saveGame(G); }
        else if (!o.duel) offer('hint');
      } else if (a === 'shuffle') {
        if (ended || busy || !ov.hidden) return;
        if (G.shuffles > 0) { G.shuffles--; useShuffle(); }
        else if (!o.duel) offer('shuffle');
      } else if (a.startsWith('buy-')) {
        const [how, what] = a.slice(4).split(':');
        ov.querySelectorAll('button').forEach(x => { x.disabled = true; });
        if (await paid(how)) { hideOv(); if (what === 'hint') useHint(); else useShuffle(); }
        else offer(what);
      } else if (a === 'close') hideOv();
      else if (a === 'time-ad' || a === 'time-coins') {
        ov.querySelectorAll('button').forEach(x => { x.disabled = true; });
        if (await paid(a === 'time-ad' ? 'ad' : 'coins')) { G.left += 60; G.revived = true; busy = false; hideOv(); lastT = performance.now(); api.sfx('win'); ui(); saveGame(G); }
        else timeUp();
      } else if (a === 'end') gameOver();
      else if (a === 'next') { b.disabled = true; try { await window.D37Ads?.interstitial?.('mahjong'); } catch (err) {} if (!stopped) o.onLevel?.(G.n + 1, G.score); }
      else if (a === 'again' || a === 'restart') {
        if (a === 'restart' && G.done && !ended && !confirm('Начать с первого уровня? Текущая игра засчитается.')) return;
        if (a === 'restart' && !ended) api.report('mahjong', false, G.score, G.score);
        try { localStorage.removeItem(SAVE + '_lv'); localStorage.removeItem(SAVE + '_sc'); } catch (err) {}
        dropSave();
        if (a === 'again') { b.disabled = true; try { await window.D37Ads?.interstitial?.('mahjong'); } catch (err) {} }
        if (!stopped) o.onLevel?.(1, 0);
      }
      else if (a === 'duel') location.hash = '#/games/mahjong/' + GameRoom.newCode();
      else if (a === 'share') share(b);
    });

    window.addEventListener('resize', layout);
    layout();
    ui();
    start();
    me.stop = () => { stopped = true; clearInterval(tick); clearTimeout(hintT); window.removeEventListener('resize', layout); if (!ended && !o.duel && G.done < G.pairs) saveGame(G); };
    me.G = () => G;
    me.pick = pick;
    return me;
  }

  const isNarrow = () => (root?.clientWidth || window.innerWidth) < 560;
  function play(n, score, G0){
    B?.stop();
    const G = G0 || newLevel(n, isNarrow(), Math.random);
    if (!G0) { G.score = score || 0; }
    B = createBoard(root, { G, onLevel: (lv, sc) => play(lv, sc) });
  }
  window.GAME_IMPL.mahjong = {
    mount(el, gameApi){
      root = el; api = gameApi;
      if (window.GameRoom?.validCode(gameApi.param)) {
        stopDuel = Versus.start(root, api, 'mahjong', gameApi.param, {
          run(stage, rand, hooks){
            B?.stop();
            stage.insertAdjacentHTML('afterbegin', `<div class="ct-note" style="text-align:center">⏱ 3 минуты · одинаковое поле у обоих · у кого больше очков (нашёл все пары — бонус за время)</div>`);
            const host = document.createElement('div');
            stage.appendChild(host);
            const G = makeBoard(8, 8, 16, '', DUEL_SEC, facesFor('fruit', 16), rand, 1);
            G.hints = 1; G.shuffles = 1;
            B = createBoard(host, { G, duel: true, onScore: hooks.progress, onEnd: score => hooks.done(score) });
          },
          stop(){ B?.stop(); B = null; },
        });
        return;
      }
      const saved = loadGame();
      if (saved) { play(saved.n, saved.score, saved); api.toast(`▶ Продолжаем уровень ${saved.n}`); return; }
      let lv = 1, sc = 0;
      try { lv = Math.max(1, +localStorage.getItem(SAVE + '_lv') || 1); sc = Math.max(0, +localStorage.getItem(SAVE + '_sc') || 0); } catch (e) {}
      play(lv, sc);
    },
    unmount(){ B?.stop(); B = null; stopDuel?.(); stopDuel = null; root = null; },
    get board(){ return B; },
    _test: { levelDef, facesFor, makeBoard, newLevel, findPath, findMove, reshuffle, ensureMove, applyGravity, match, levelBonus },
  };
})();
