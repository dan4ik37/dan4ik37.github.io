// ═══════════════════════════════════════
//  ИГРА «САПЁР» — как в Windows: Новичок 9×9, Любитель 16×16, Профи 30×16 (на телефоне — 16×30)
// ═══════════════════════════════════════
// Первый ход всегда безопасный (мины ставятся после него, не рядом). Клик — открыть, правый клик или долгое
// нажатие — флажок; кнопка «🚩» включает режим флажков для телефона. Нажатие на открытую цифру, вокруг которой
// стоит столько же флажков, открывает соседей («аккорд»). Смайлик — новая игра (и F2).
// Очки за победу: база уровня × скорость (100/400/1000 × до 3, эталон 30/150/400 с) — ключи miner1/2/3.
// «⚔️ Соревнование» (versus.js): одинаковое поле «Любитель» и одинаковая открытая стартовая область;
// очки — открытые клетки, победа +1000 и бонус за время; 5 минут.
// Движок без DOM — GAME_IMPL.miner._test.
(() => {
  const LEVELS = { 1: { w: 9, h: 9, m: 10, name: 'Новичок', base: 100, ref: 30, coins: 10 }, 2: { w: 16, h: 16, m: 40, name: 'Любитель', base: 400, ref: 150, coins: 30 }, 3: { w: 30, h: 16, m: 99, name: 'Профи', base: 1000, ref: 400, coins: 60 } };
  const DUEL_SEC = 300, PREF = 'd37_miner_level';

  // ── Движок ──
  function newGame(lv, w, h, rand){
    const L = LEVELS[lv];
    return { lv, w, h, m: L.m, cells: Array.from({ length: w * h }, () => ({ mine: false, open: false, flag: false, n: 0 })), started: false, over: false, won: false, opened: 0, flags: 0, rand, boom: -1 };
  }
  function around(G, i){
    const x = i % G.w, y = Math.floor(i / G.w), out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < G.w && ny < G.h) out.push(ny * G.w + nx);
    }
    return out;
  }
  // Мины — после первого хода: не в этой клетке и не рядом (если поле позволяет)
  function placeMines(G, safe){
    const ban = new Set([safe, ...around(G, safe)]), free = [];
    for (let i = 0; i < G.cells.length; i++) if (!ban.has(i)) free.push(i);
    const pool = free.length >= G.m ? free : G.cells.map((_, i) => i).filter(i => i !== safe);
    for (let k = 0; k < G.m; k++) { const j = k + Math.floor(G.rand() * (pool.length - k)); [pool[k], pool[j]] = [pool[j], pool[k]]; G.cells[pool[k]].mine = true; }
    G.cells.forEach((c, i) => { c.n = around(G, i).filter(j => G.cells[j].mine).length; });
    G.started = true;
  }
  // Открыть клетку. Возвращает список открытых индексов (или 'boom')
  function open(G, i){
    const c = G.cells[i];
    if (G.over || !c || c.open || c.flag) return [];
    if (!G.started) placeMines(G, i);
    if (c.mine) { c.open = true; G.over = true; G.boom = i; return 'boom'; }
    const done = [], stack = [i];
    while (stack.length) {
      const k = stack.pop(), d = G.cells[k];
      if (d.open || d.flag || d.mine) continue;
      d.open = true; G.opened++; done.push(k);
      if (!d.n) for (const j of around(G, k)) if (!G.cells[j].open) stack.push(j);
    }
    checkWin(G);
    return done;
  }
  // «Аккорд»: вокруг цифры стоит столько же флажков — открыть остальных соседей
  function chord(G, i){
    const c = G.cells[i];
    if (G.over || !c.open || !c.n) return [];
    const nb = around(G, i);
    if (nb.filter(j => G.cells[j].flag).length !== c.n) return [];
    let all = [];
    for (const j of nb) {
      const r = open(G, j);
      if (r === 'boom') return 'boom';
      all = all.concat(r);
    }
    return all;
  }
  function toggleFlag(G, i){
    const c = G.cells[i];
    if (G.over || c.open) return false;
    c.flag = !c.flag;
    G.flags += c.flag ? 1 : -1;
    return true;
  }
  function checkWin(G){
    if (G.over || G.opened !== G.w * G.h - G.m) return false;
    G.over = true; G.won = true;
    G.cells.forEach(c => { if (c.mine && !c.flag) { c.flag = true; G.flags++; } });
    return true;
  }
  const winScore = (lv, sec) => Math.round(LEVELS[lv].base * Math.min(3, LEVELS[lv].ref / Math.max(1, sec)));
  const duelScore = (G, sec) => G.opened + (G.won ? 1000 + Math.max(0, Math.round(DUEL_SEC - sec)) : 0);

  // ── Экран ──
  let root, api, B = null, stopDuel = null;
  const C = () => window.D37Coins;
  const num = n => Number(n || 0).toLocaleString('ru');
  const fmt = s => s < 60 ? s.toFixed(1) + ' с' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // Одно поле. o: { lv, duel, rand, timeLimit, onScore, onEnd, onNew(lv) }
  function createBoard(el, o){
    const L = LEVELS[o.lv], narrow = (el.clientWidth || window.innerWidth) < 560;
    const w = o.lv === 3 && narrow ? 16 : L.w, h = o.lv === 3 && narrow ? 30 : L.h;
    const G = newGame(o.lv, w, h, o.rand || Math.random), me = { G };
    let t0 = 0, tick = 0, flagMode = false, stopped = false, press = null;
    el.innerHTML = `<div class="mn">
        ${o.duel ? '' : `<div class="sl-opts mn-lv">${Object.entries(LEVELS).map(([k, v]) => `<button type="button" data-act="lv:${k}"${+k === o.lv ? ' class="on"' : ''}>${v.name}</button>`).join('')}</div>`}
        <div class="mn-bar">
          <span class="mn-cnt" title="Мин осталось">💣 <b class="mnLeft">${G.m}</b></span>
          <button type="button" class="mn-face" data-act="face" title="Новая игра (F2)">🙂</button>
          <span class="mn-cnt" title="Время">⏱ <b class="mnTime">0</b></span>
          <button type="button" class="mn-flag" data-act="flag" title="Режим флажков">🚩</button>
        </div>
        <div class="mn-wrap"><div class="mn-grid" style="--w:${w};--h:${h}"></div><div class="sl-over" hidden></div></div>
        <div class="ct-note mn-note">Клик — открыть, правый клик или долгое нажатие — флажок 🚩. Нажми на цифру, вокруг которой уже стоят все флажки, — откроются соседи.</div>
        ${o.duel ? '' : '<div class="ct-actions"><button type="button" class="ct-duel-btn" data-act="duel">⚔️ Наперегонки с другом</button></div>'}
      </div>`;
    const q = s => el.querySelector(s), grid = q('.mn-grid'), ov = q('.sl-over'), face = q('.mn-face');
    grid.innerHTML = G.cells.map((_, i) => `<div class="mc" data-i="${i}"></div>`).join('');
    const cellEls = [...grid.children];
    // Размер клетки — от настоящей ширины блока (18…34 px)
    function fit(){
      const avail = Math.min(q('.mn').clientWidth || 320, 760);
      grid.style.setProperty('--cs', Math.max(18, Math.min(34, Math.floor((avail - 12 - (w - 1) * 2) / w))) + 'px');
    }
    fit();
    window.addEventListener('resize', fit);

    function paint(idx){
      const list = idx || G.cells.map((_, i) => i);
      for (const i of list) {
        const c = G.cells[i], e = cellEls[i];
        let cls = 'mc', txt = '';
        if (c.open) {
          cls += ' op';
          if (c.mine) { cls += ' boom'; txt = '💥'; }
          else if (c.n) { cls += ' n' + c.n; txt = c.n; }
        } else if (G.over && !G.won && c.mine && !c.flag) { cls += ' op mine'; txt = '💣'; }
        else if (c.flag) { cls += ' fl'; txt = G.over && !G.won && !c.mine ? '❌' : '🚩'; }
        if (e.className !== cls) e.className = cls;
        if (e.textContent !== String(txt)) e.textContent = txt;
      }
      q('.mnLeft').textContent = G.m - G.flags;
    }
    const secs = () => t0 ? (Date.now() - t0) / 1000 : 0;
    function clock(){
      const s = secs();
      q('.mnTime').textContent = o.duel ? Math.max(0, Math.ceil(o.timeLimit - s)) : Math.floor(s);
      if (o.duel && !G.over && s >= o.timeLimit) { G.over = true; finish(); }
    }
    function start(){ if (t0) return; t0 = Date.now(); tick = setInterval(clock, 250); }

    function act(i, kind){
      if (G.over || stopped) return;
      const c = G.cells[i];
      let r;
      if (kind === 'flag' || (flagMode && !c.open)) { if (toggleFlag(G, i)) { api.sfx('move'); paint([i]); } return; }
      if (c.open) r = chord(G, i);
      else { start(); r = open(G, i); }
      if (r === 'boom') { paint(); finish(); return; }
      if (!r.length) return;
      api.sfx(r.length > 1 ? 'ok' : 'move');
      paint(r);
      o.onScore?.(o.duel ? duelScore(G, secs()) : G.opened);
      if (G.won) { paint(); finish(); }
    }

    // Мышь: левая — открыть, правая — флажок. Палец: нажатие — открыть, держать 0,45 с — флажок
    grid.addEventListener('contextmenu', e => { e.preventDefault(); const t = e.target.closest('.mc'); if (t && !press?.long) act(+t.dataset.i, 'flag'); });
    grid.addEventListener('pointerdown', e => {
      const t = e.target.closest('.mc');
      if (!t || G.over || (e.pointerType === 'mouse' && e.button !== 0)) return;
      face.textContent = '😮';
      press = { i: +t.dataset.i, x: e.clientX, y: e.clientY, id: e.pointerId, long: false, timer: 0 };
      if (e.pointerType !== 'mouse') press.timer = setTimeout(() => { if (!press) return; press.long = true; navigator.vibrate?.(25); act(press.i, 'flag'); }, 450);
    });
    grid.addEventListener('pointermove', e => { if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) { clearTimeout(press.timer); press = null; face.textContent = '🙂'; } });
    const up = e => {
      if (!press || e.pointerId !== press.id) return;
      const p = press;
      press = null;
      clearTimeout(p.timer);
      if (!G.over) face.textContent = '🙂';
      if (!p.long && e.type === 'pointerup') act(p.i, 'open');
    };
    grid.addEventListener('pointerup', up);
    grid.addEventListener('pointercancel', up);

    const showOv = html => { ov.innerHTML = html; ov.hidden = false; };
    async function finish(){
      clearInterval(tick);
      const sec = secs();
      clock();
      face.textContent = G.won ? '😎' : '😵';
      paint();
      if (o.duel) {
        api.sfx(G.won ? 'win' : 'bad');
        const sc = duelScore(G, sec);
        setTimeout(() => { if (!stopped) showOv(`<div class="sl-t">${G.won ? '😎 Поле разминировано!' : G.boom >= 0 ? '💥 Подорвался!' : '⏱ Время вышло!'}</div><div class="sl-big">${num(sc)}</div><div class="sl-s">Открыто клеток: ${G.opened}. Итог соревнования — сверху</div>`); }, G.won ? 300 : 900);
        o.onEnd?.(sc);
        return;
      }
      if (!G.won) {
        api.sfx('bad');
        api.report('miner' + o.lv, false, 0, 0);
        setTimeout(() => { if (!stopped) showOv(`<div class="sl-t">💥 Мина!</div><div class="sl-s">Открыто ${G.opened} из ${G.w * G.h - G.m} клеток за ${fmt(sec)}.</div>
          <div class="ct-actions"><button type="button" class="ct-start" data-act="again">🙂 Ещё раз</button><button type="button" data-act="look">👀 Посмотреть поле</button></div>`); }, 900);
        return;
      }
      const sc = winScore(o.lv, sec), prevBest = api.local().best || 0, coins = L.coins, runId = 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
      api.report('miner' + o.lv, true, sc, sc);
      api.sfx('win');
      showOv(`<div class="sl-t">😎 Поле разминировано!</div><div class="sl-big">${fmt(sec)}</div>
        <div class="sl-s">${L.name} · ${num(sc)} очков${sc > prevBest ? ' · 🏆 рекорд!' : ''}</div>
        <div class="sl-coins">${C() && sec >= 20 ? `🪙 +${coins} монет…` : ''}</div>
        <div class="ct-actions"><button type="button" class="ct-start" data-act="again">🙂 Ещё раз</button><button type="button" class="ct-duel-btn" data-act="duel">⚔️ С другом</button><button type="button" data-act="share">📤 Поделиться</button></div>`);
      // Монеты — за партию не короче 20 с (сервер всё равно не даёт чаще раза в 20 с)
      if (!C() || sec < 20) return;
      const r = await C().run('miner', coins, runId);
      const box = ov.querySelector('.sl-coins');
      if (!box || stopped) return;
      box.innerHTML = r?.ok ? `🪙 <b>+${num(r.got)}</b> монет${r.base && r.got > r.base ? ' <span class="hd-vip">VIP ×2</span>' : ''}` : r?.reason === 'day_cap' ? '🪙 Лимит монет за игры на сегодня исчерпан' : '🪙 Монеты не начислились — проверь интернет';
    }
    async function share(btn){
      const text = `Разминировал поле «${L.name}» в «Сапёре» за ${fmt(secs())}. Сможешь быстрее?`, url = location.origin + '/games/miner';
      if (navigator.share) { navigator.share({ title: 'Сапёр', text, url }).catch(() => {}); return; }
      try { await navigator.clipboard.writeText(text + ' ' + url); btn.textContent = '✅ Скопировано'; } catch (e) { prompt('Скопируй и отправь другу:', text + ' ' + url); }
    }
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]');
      if (!b || !el.contains(b) || stopped) return;
      const a = b.dataset.act;
      if (a === 'face') { if (!o.duel) newGame2(o.lv); }
      else if (a === 'flag') { flagMode = !flagMode; b.classList.toggle('on', flagMode); }
      else if (a.startsWith('lv:')) newGame2(+a.slice(3));
      else if (a === 'again') { b.disabled = true; try { await window.D37Ads?.interstitial?.('miner'); } catch (err) {} newGame2(o.lv); }
      else if (a === 'look') { ov.hidden = true; }
      else if (a === 'duel') location.hash = '#/games/miner/' + GameRoom.newCode();
      else if (a === 'share') share(b);
    });
    function newGame2(lv){
      if (G.started && !G.over && G.opened > 0) api.report('miner' + o.lv, false, 0, 0);
      try { localStorage.setItem(PREF, String(lv)); } catch (e) {}
      o.onNew?.(lv);
    }
    function onKey(e){
      if (!el.isConnected || o.duel) return;
      if (e.key === 'F2') { e.preventDefault(); newGame2(o.lv); }
    }
    window.addEventListener('keydown', onKey);

    // Соревнование: стартовая область открыта у обоих одинаково
    if (o.duel) {
      const startIdx = Math.floor(G.rand() * G.cells.length);
      placeMines(G, startIdx);
      start();
      open(G, startIdx);
      o.onScore?.(duelScore(G, 0));
    }
    paint();
    me.stop = () => { stopped = true; clearInterval(tick); clearTimeout(press?.timer); window.removeEventListener('keydown', onKey); window.removeEventListener('resize', fit); };
    me.act = act;
    return me;
  }

  function prefLevel(){ let v = 1; try { v = +localStorage.getItem(PREF) || 1; } catch (e) {} return LEVELS[v] ? v : 1; }
  function solo(lv){
    B?.stop();
    B = createBoard(root, { lv: lv || prefLevel(), onNew: v => solo(v) });
  }
  window.GAME_IMPL.miner = {
    mount(el, gameApi){
      root = el; api = gameApi;
      if (window.GameRoom?.validCode(gameApi.param)) {
        stopDuel = Versus.start(root, api, 'miner', gameApi.param, {
          run(stage, rand, hooks){
            B?.stop();
            stage.insertAdjacentHTML('afterbegin', `<div class="ct-note" style="text-align:center">⏱ 5 минут · одинаковое поле «Любитель» у обоих · очки — открытые клетки, разминировал — +1000 и бонус за время</div>`);
            const host = document.createElement('div');
            stage.appendChild(host);
            B = createBoard(host, { lv: 2, duel: true, rand, timeLimit: DUEL_SEC, onScore: hooks.progress, onEnd: score => hooks.done(score) });
          },
          stop(){ B?.stop(); B = null; },
        });
      } else solo();
    },
    unmount(){ B?.stop(); B = null; stopDuel?.(); stopDuel = null; root = null; },
    get board(){ return B; },
    _test: { LEVELS, newGame, around, placeMines, open, chord, toggleFlag, checkWin, winScore, duelScore },
  };
})();
