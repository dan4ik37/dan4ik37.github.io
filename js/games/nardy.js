// ═══════════════════════════════════════
//  ИГРА «НАРДЫ» (длинные) — против бота или онлайн с другом
// ═══════════════════════════════════════
// У каждого 15 шашек на «голове», ходят в одну сторону (против часовой), начиная с противоположных углов.
// Бить нельзя: на точку с чужой шашкой вставать нельзя. Дубль — ходишь 4 раза. С головы за ход — одна шашка
// (на первом ходу при 6-6, 4-4 и 3-3 — две). Нельзя ставить «заборчик» из 6 шашек подряд, если впереди него нет
// ни одной шашки соперника. Обязательно использовать кубики по максимуму; если можно только один — больший.
// Все 15 дома (последняя четверть) — выбрасываешь. Кто первым выбросил все — победил; соперник не выбросил ни
// одной — «марс» (двойная победа).
// Позиции у каждого свои: 0 — голова, 23 — последняя точка, 18–23 — дом. На общей доске белые: abs = pos,
// чёрные: abs = pos + 12. Онлайн — стол на 2 (js/games/table.js), кубики бросает хозяин стола.
// Ключи сервера: nardy_easy / nardy_hard (против бота), nardy_online.
(() => {
  const HOME = 18;
  const DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const absOf = (p, pos) => p === 0 ? pos : (pos + 12) % 24;
  const relOf = (p, abs) => p === 0 ? abs : (abs + 12) % 24;

  // ═══ ПРАВИЛА ═══
  function newGame(players, rand){
    const cnt = [Array(24).fill(0), Array(24).fill(0)];
    cnt[0][0] = 15; cnt[1][0] = 15;
    return { players, cnt, off: [0, 0], turn: 0, dice: [], left: [], headUsed: 0, first: [true, true], phase: 'roll', winner: -1, mars: false, log: `Первыми ходят белые — ${players[0].nick}`, v: 0, rand };
  }
  const oppAt = (cnt, p, pos) => cnt[1 - p][relOf(1 - p, absOf(p, pos))] > 0;
  function allHome(cnt, p){ for (let i = 0; i < HOME; i++) if (cnt[p][i]) return false; return true; }
  // «Заборчик»: 6 занятых подряд, а впереди (по ходу соперника) ни одной его шашки
  function badBlock(cnt, off, p){
    const o = 1 - p, occ = a => cnt[p][relOf(p, a)] > 0;
    for (let a = 0; a < 24; a++) {
      let run = true;
      for (let i = 0; i < 6; i++) if (!occ((a + i) % 24)) { run = false; break; }
      if (!run) continue;
      let qmax = -1;
      for (let i = 0; i < 6; i++) qmax = Math.max(qmax, relOf(o, (a + i) % 24));
      if (qmax - relOf(o, a) !== 5 && relOf(o, (a + 5) % 24) < relOf(o, a)) continue;   // блок «через» голову соперника — не считаем
      let ahead = off[o] > 0;
      for (let q = qmax + 1; q < 24 && !ahead; q++) if (cnt[o][q]) ahead = true;
      if (!ahead) return true;
    }
    return false;
  }
  // Один шаг: шашка с позиции f на d. headLeft — сколько ещё можно снять с головы
  function canStep(cnt, off, p, f, d, headLeft){
    if (!cnt[p][f]) return false;
    if (f === 0 && headLeft <= 0) return false;
    const t = f + d;
    if (t < 24) {
      if (oppAt(cnt, p, t)) return false;
      cnt[p][f]--; cnt[p][t]++;
      const bad = badBlock(cnt, off, p);
      cnt[p][f]++; cnt[p][t]--;
      return !bad;
    }
    if (!allHome(cnt, p)) return false;
    if (t === 24) return true;
    for (let i = HOME; i < f; i++) if (cnt[p][i]) return false;   // «лишним» очком — только с самой дальней шашки
    return true;
  }
  const headCapOf = (G, p) => (G.first[p] && G.dice.length === 2 && G.dice[0] === G.dice[1] && [6, 4, 3].includes(G.dice[0])) ? 2 : 1;
  const without = (left, i) => left.slice(0, i).concat(left.slice(i + 1));
  // Сколько кубиков ещё можно сыграть из позиции (с запоминанием — иначе дубли перебираются слишком долго)
  function maxRem(cnt, off, p, left, used, cap, memo){
    const key = cnt[p].join(',') + '|' + off[p] + '|' + left.slice().sort().join('') + '|' + used;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    const tried = new Set();
    for (let i = 0; i < left.length && best < left.length; i++) {
      const d = left[i];
      if (tried.has(d)) continue;
      tried.add(d);
      for (let f = 0; f < 24 && best < left.length; f++) {
        if (!canStep(cnt, off, p, f, d, cap - used)) continue;
        const t = f + d;
        cnt[p][f]--; if (t < 24) cnt[p][t]++; else off[p]++;
        const r = 1 + maxRem(cnt, off, p, without(left, i), used + (f === 0 ? 1 : 0), cap, memo);
        cnt[p][f]++; if (t < 24) cnt[p][t]--; else off[p]--;
        if (r > best) best = r;
      }
    }
    memo.set(key, best);
    return best;
  }
  // Какие шаги можно сделать прямо сейчас: только те, после которых кубики используются по максимуму;
  // если из двух разных кубиков можно сыграть лишь один — обязан больший
  function legalNow(G, p, memo = new Map()){
    if (!G.left.length) return [];
    const cnt = [G.cnt[0].slice(), G.cnt[1].slice()], off = G.off.slice(), cap = headCapOf(G, p);
    const total = maxRem(cnt, off, p, G.left, G.headUsed, cap, memo);
    if (!total) return [];
    let out = [];
    const tried = new Set();
    for (let i = 0; i < G.left.length; i++) {
      const d = G.left[i];
      if (tried.has(d)) continue;
      tried.add(d);
      for (let f = 0; f < 24; f++) {
        if (!canStep(cnt, off, p, f, d, cap - G.headUsed)) continue;
        const t = f + d;
        cnt[p][f]--; if (t < 24) cnt[p][t]++; else off[p]++;
        const r = 1 + maxRem(cnt, off, p, without(G.left, i), G.headUsed + (f === 0 ? 1 : 0), cap, memo);
        cnt[p][f]++; if (t < 24) cnt[p][t]--; else off[p]--;
        if (r === total) out.push({ f, d });
      }
    }
    if (total === 1 && G.left.length === 2 && G.left[0] !== G.left[1]) {
      const big = Math.max(...G.left);
      if (out.some(s => s.d === big)) out = out.filter(s => s.d === big);
    }
    return out;
  }
  // Все разные итоговые позиции хода (для бота): последовательность → позиция, повторы отбрасываются
  function sequences(G, p){
    const memo = new Map(), finals = new Map(), seen = new Set();
    const T = { ...G, cnt: [G.cnt[0].slice(), G.cnt[1].slice()], off: G.off.slice(), left: G.left.slice() };
    const rec = seq => {
      const k = T.cnt[p].join(',') + '|' + T.off[p] + '|' + T.left.slice().sort().join('') + '|' + T.headUsed;
      if (seen.has(k)) return;
      seen.add(k);
      const legal = legalNow(T, p, memo);
      if (!legal.length) { const fk = T.cnt[p].join(',') + '|' + T.off[p]; if (!finals.has(fk)) finals.set(fk, seq.slice()); return; }
      for (const m of legal) {
        const t = m.f + m.d, li = T.left.indexOf(m.d);
        T.cnt[p][m.f]--; if (t < 24) T.cnt[p][t]++; else T.off[p]++;
        T.left.splice(li, 1); if (m.f === 0) T.headUsed++;
        seq.push(m); rec(seq); seq.pop();
        T.cnt[p][m.f]++; if (t < 24) T.cnt[p][t]--; else T.off[p]--;
        T.left.splice(li, 0, m.d); if (m.f === 0) T.headUsed--;
      }
    };
    rec([]);
    return { seqs: [...finals.values()] };
  }
  function roll(G, p, a, b){
    if (G.winner >= 0 || G.turn !== p || G.phase !== 'roll') return 'Сейчас нельзя бросать';
    const d1 = a || 1 + Math.floor(G.rand() * 6), d2 = b || 1 + Math.floor(G.rand() * 6);
    G.dice = [d1, d2];
    G.left = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
    G.headUsed = 0;
    G.phase = 'move';
    G.log = `${G.players[p].nick}: ${DIE[d1]} ${DIE[d2]}${d1 === d2 ? ' — дубль!' : ''}`;
    if (!legalNow(G, p).length) { G.log += ' — ходить нечем'; endTurn(G); }
    G.v++;
    return null;
  }
  function move(G, p, f, d){
    if (G.winner >= 0 || G.turn !== p || G.phase !== 'move') return 'Сейчас нельзя ходить';
    if (!legalNow(G, p).some(s => s.f === f && s.d === d)) return 'Так ходить нельзя';
    const t = f + d;
    G.cnt[p][f]--;
    if (t < 24) G.cnt[p][t]++; else G.off[p]++;
    if (f === 0) G.headUsed++;
    G.left.splice(G.left.indexOf(d), 1);
    if (G.off[p] === 15) { G.winner = p; G.mars = G.off[1 - p] === 0; G.phase = 'over'; G.log = `${G.players[p].nick} выбросил все шашки — ${G.mars ? 'МАРС! Двойная победа' : 'победа'}!`; G.v++; return null; }
    if (!G.left.length || !legalNow(G, p).length) endTurn(G);
    G.v++;
    return null;
  }
  function endTurn(G){ G.first[G.turn] = false; G.turn = 1 - G.turn; G.phase = 'roll'; G.left = []; G.headUsed = 0; }
  // Оценка позиции для бота
  function evalPos(cnt, off, p){
    const o = 1 - p;
    let s = off[p] * 40 - off[o] * 40;
    for (let i = 0; i < 24; i++) { s += cnt[p][i] * i * 1.2; if (cnt[p][i] > 3) s -= (cnt[p][i] - 3) * 2.5; }
    // свои точки на пути соперника (перед его шашками) — мешают ему
    let oMin = 24; for (let q = 0; q < 24; q++) if (cnt[o][q]) { oMin = q; break; }
    for (let a = 0; a < 24; a++) { const q = relOf(o, a); if (q > oMin && q < oMin + 13 && cnt[p][relOf(p, a)] > 0) s += 3; }
    if (cnt[p][0] > 10) s -= (cnt[p][0] - 10) * 2;
    return s;
  }
  function botTurn(G, p, level){
    const { seqs } = sequences(G, p);
    if (!seqs.length || !seqs[0].length) return [];
    const scored = seqs.map(seq => {
      const cnt = [G.cnt[0].slice(), G.cnt[1].slice()], off = G.off.slice();
      for (const { f, d } of seq) { cnt[p][f]--; if (f + d < 24) cnt[p][f + d]++; else off[p]++; }
      return { seq, s: evalPos(cnt, off, p) };
    }).sort((a, b) => b.s - a.s);
    if (level === 'easy') return scored[Math.floor(G.rand() * Math.min(4, scored.length))].seq;
    return scored[0].seq;
  }
  const pub = G => ({ players: G.players.map(pl => ({ id: pl.id, nick: pl.nick, bot: !!pl.bot })), cnt: G.cnt.map(c => c.slice()), off: G.off.slice(), turn: G.turn, dice: G.dice.slice(), left: G.left.slice(), phase: G.phase, winner: G.winner, mars: G.mars, log: G.log, v: G.v, legal: G.phase === 'move' ? legalNow(G, G.turn) : [] });

  // ═══ ЭКРАН ═══
  let root, api, G = null, P = null, meIdx = 0, mode = 'menu', room = null, timers = [], botT = 0, tickT = 0, level = 'hard', vs = 'bot', cv, ctx, sel = -1;
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const isHost = () => !room || room.isHost;
  const hostId = () => room?.seats[0]?.id;

  function menu(){
    mode = 'menu'; G = null; P = null;
    const st = api.local();
    root.innerHTML = `<div class="dk-menu">
        <div class="pl-logo">🎲🎲</div><div class="un-title">Нарды</div>
        <div class="un-sub">Длинные нарды: проведи все 15 шашек по кругу в свой дом и выброси их раньше соперника. Бить нельзя — можно только перекрывать дорогу.</div>
        <div class="pl-levels">${[['easy', 'Лёгкий'], ['hard', 'Сложный']].map(([k, l]) => `<button type="button" class="un-n wide${k === level ? ' sel' : ''}" data-act="lv:${k}">${l}</button>`).join('')}</div>
        <div class="ct-actions"><button type="button" class="ct-start" data-act="bot">🤖 Против бота</button><button type="button" class="ct-duel-btn" data-act="online">👥 С другом онлайн</button></div>
        ${st.plays ? `<div class="un-sub">Партий: <b>${st.plays}</b> · побед: <b>${st.wins || 0}</b></div>` : ''}
        <details class="un-rules"><summary>Правила</summary>
          <p>У каждого 15 шашек на «голове». Ходите по кругу в одну сторону, начиная с противоположных углов.</p>
          <p>Бросаешь два кубика: каждый — ход одной шашкой на столько точек. Дубль — ходишь четыре раза.</p>
          <p>На точку, где стоит чужая шашка, вставать нельзя. С головы за ход можно снять только одну шашку (на первом ходу при 6-6, 4-4 и 3-3 — две).</p>
          <p>Нельзя строить «заборчик» из 6 шашек подряд, если впереди него нет ни одной шашки соперника.</p>
          <p>Когда все 15 шашек в доме (последняя четверть пути), их можно выбрасывать. Выбросил все первым — победа. Соперник не выбросил ни одной — «марс».</p>
        </details>
      </div>`;
  }
  function startBot(){
    vs = 'bot';
    G = newGame([{ id: 'me', nick: GameRoom.nick() }, { id: 'bot', nick: '🤖 Бот', bot: true }], Math.random);
    meIdx = 0; mode = 'play'; sel = -1;
    build(); sync();
  }
  function build(){
    root.innerHTML = `<div class="nd">
        <div class="nd-top"><div class="nd-pl" id="ndP1"></div></div>
        <div class="ld-wrap"><canvas class="nd-cv"></canvas></div>
        <div class="nd-top"><div class="nd-pl" id="ndP0"></div></div>
        <div class="un-log" aria-live="polite"></div>
        <div class="ld-ctl"><button type="button" class="ld-die nd-roll" data-act="roll" aria-label="Бросить кубики">🎲</button><div class="un-status"></div></div>
        <div class="un-acts"></div>
      </div>`;
    cv = root.querySelector('.nd-cv'); ctx = cv.getContext('2d');
    cv.addEventListener('pointerdown', onTap);
    resize();
  }
  function resize(){
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.min(cv.parentElement.clientWidth || 340, 640), h = Math.round(w * .72);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    draw();
  }
  function sync(){
    if (!G) return;
    P = pub(G);
    if (room) G.players.forEach(pl => { if (!pl.bot && pl.id !== room.myId) room.sendTo(pl.id, { type: 'up', pub: P }); });
    render();
    schedule();
  }
  function schedule(){
    clearTimeout(botT); clearTimeout(tickT);
    if (!G || G.winner >= 0 || !isHost()) return;
    const p = G.turn, v = G.v;
    if (G.players[p].bot) {
      botT = later(() => {
        if (!G || G.v !== v) return;
        if (G.phase === 'roll') { roll(G, p); sync(); return; }
        const seq = botTurn(G, p, level);
        let i = 0;
        const stepBot = () => { if (!G || G.turn !== p || G.phase !== 'move' || i >= seq.length) { sync(); return; } move(G, p, seq[i].f, seq[i].d); i++; sync(); if (G.turn === p && G.phase === 'move' && i < seq.length) later(stepBot, 420); };
        stepBot();
      }, 700);
      return;
    }
    if (room) tickT = later(() => {
      if (!G || G.v !== v) return;
      if (G.phase === 'roll') roll(G, p);
      else for (const s of botTurn(G, p, 'easy')) move(G, p, s.f, s.d);
      sync();
    }, 40000);
  }
  function doAct(a){
    if (!P || P.winner >= 0) return;
    if (isHost()) {
      const err = a.a === 'roll' ? roll(G, meIdx) : move(G, meIdx, a.f, a.d);
      if (err) { api.toast(err); return; }
      api.sfx(a.a === 'roll' ? 'tick' : 'move');
      sync();
    } else room.sendTo(hostId(), { type: 'act', act: a });
  }

  // ── Доска: точки abs 0…11 — верхний ряд справа налево, 12…23 — нижний слева направо ──
  function geom(){
    const Wd = cv.width, Hd = cv.height, pad = Wd * .03, bar = Wd * .05, pw = (Wd - pad * 2 - bar - Wd * .08) / 12;
    return { Wd, Hd, pad, bar, pw, offX: Wd - pad - Wd * .08 + Wd * .01 };
  }
  function pointX(g, abs){
    const col = abs < 12 ? 11 - abs : abs - 12;   // 0…11 слева направо
    return g.pad + col * g.pw + (col >= 6 ? g.bar : 0) + g.pw / 2;
  }
  function draw(){
    if (!ctx || !cv) return;
    const g = geom(), { Wd, Hd, pad, pw } = g;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#5b3417'; ctx.fillRect(0, 0, Wd, Hd);
    ctx.fillStyle = '#e9d3a8'; ctx.fillRect(pad, pad, Wd - pad * 2 - Wd * .08, Hd - pad * 2);
    const bx = pad + 6 * pw; ctx.fillStyle = '#7a4a24'; ctx.fillRect(bx, pad, g.bar, Hd - pad * 2);
    ctx.fillStyle = '#3b2412'; ctx.fillRect(Wd - pad - Wd * .08 + Wd * .01, pad, Wd * .06, Hd - pad * 2);
    const triH = (Hd - pad * 2) * .42;
    for (let abs = 0; abs < 24; abs++) {
      const x = pointX(g, abs), top = abs < 12;
      ctx.fillStyle = abs % 2 ? '#8b1d2c' : '#2b2b33';
      ctx.beginPath();
      if (top) { ctx.moveTo(x - pw / 2, pad); ctx.lineTo(x + pw / 2, pad); ctx.lineTo(x, pad + triH); }
      else { ctx.moveTo(x - pw / 2, Hd - pad); ctx.lineTo(x + pw / 2, Hd - pad); ctx.lineTo(x, Hd - pad - triH); }
      ctx.fill();
    }
    if (!P) return;
    const r = Math.min(pw * .46, (Hd - pad * 2) * .045), mine = P.turn === meIdx && P.phase === 'move' && P.winner < 0;
    const srcs = new Set(mine ? P.legal.map(s => absOf(meIdx, s.f)) : []);
    const dests = new Map();
    if (mine && sel >= 0) for (const s of P.legal) if (s.f === sel) { const t = s.f + s.d; dests.set(t < 24 ? absOf(meIdx, t) : 'off', s); }
    for (let abs = 0; abs < 24; abs++) {
      const x = pointX(g, abs), top = abs < 12;
      for (const p of [0, 1]) {
        const n = P.cnt[p][relOf(p, abs)];
        if (!n) continue;
        const show = Math.min(n, 5);
        for (let i = 0; i < show; i++) {
          const y = top ? pad + r + i * r * 2 : Hd - pad - r - i * r * 2;
          ctx.fillStyle = p === 0 ? '#f5f5f4' : '#1f2937'; ctx.strokeStyle = p === 0 ? '#a8a29e' : '#9ca3af'; ctx.lineWidth = r * .14;
          ctx.beginPath(); ctx.arc(x, y, r * .92, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        if (n > 5) { const y = top ? pad + r + 4 * r * 2 : Hd - pad - r - 4 * r * 2; ctx.fillStyle = p === 0 ? '#111' : '#fff'; ctx.font = `800 ${Math.round(r)}px Montserrat,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(n, x, y); }
      }
      // подсветка: откуда можно ходить и куда
      if (srcs.has(abs)) { const y = top ? pad + 2 : Hd - pad - 2; ctx.fillStyle = sel >= 0 && absOf(meIdx, sel) === abs ? '#ffd166' : 'rgba(255,209,102,.55)'; ctx.fillRect(x - pw * .4, top ? y - 2 : y - 4, pw * .8, 6); }
      if (dests.has(abs)) { const y = top ? pad + triH * .8 : Hd - pad - triH * .8; ctx.strokeStyle = '#22c55e'; ctx.lineWidth = r * .25; ctx.beginPath(); ctx.arc(x, y, r * .8, 0, Math.PI * 2); ctx.stroke(); }
    }
    // выброшенные
    const ox = Wd - pad - Wd * .08 + Wd * .04;
    for (const p of [0, 1]) {
      const n = P.off[p], top = p === 1;
      for (let i = 0; i < n; i++) { const y = top ? pad + 4 + i * (r * .45) : Hd - pad - 4 - i * (r * .45); ctx.fillStyle = p === 0 ? '#f5f5f4' : '#1f2937'; ctx.fillRect(ox - Wd * .025, y - r * .18, Wd * .05, r * .36); }
    }
    if (dests.has('off')) { ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 4; ctx.strokeRect(Wd - pad - Wd * .08 + Wd * .01, meIdx === 0 ? Hd / 2 : pad, Wd * .06, Hd / 2 - pad); }
    // кубики посередине
    if (P.dice.length) {
      const cy = Hd / 2, sz = Math.min(pw * 1.1, Hd * .12);
      P.dice.forEach((d, i) => {
        const x = pad + 3 * pw - sz - 4 + i * (sz + 8) + (P.turn === 1 ? 6 * pw + g.bar : 0);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, cy - sz / 2, sz, sz, sz * .18) : ctx.rect(x, cy - sz / 2, sz, sz); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#111';
        const pips = { 1: [[.5, .5]], 2: [[.25, .25], [.75, .75]], 3: [[.25, .25], [.5, .5], [.75, .75]], 4: [[.25, .25], [.75, .25], [.25, .75], [.75, .75]], 5: [[.25, .25], [.75, .25], [.5, .5], [.25, .75], [.75, .75]], 6: [[.25, .25], [.75, .25], [.25, .5], [.75, .5], [.25, .75], [.75, .75]] }[d];
        for (const [px, py] of pips) { ctx.beginPath(); ctx.arc(x + px * sz, cy - sz / 2 + py * sz, sz * .08, 0, Math.PI * 2); ctx.fill(); }
      });
    }
  }
  function render(){
    if (!P || !cv) return;
    const me = meIdx, myTurn = P.turn === me && P.winner < 0;
    for (const p of [0, 1]) {
      const el = root.querySelector('#ndP' + p);
      if (el) { el.className = 'nd-pl' + (P.turn === p && P.winner < 0 ? ' turn' : ''); el.innerHTML = `<span class="nd-chip ${p ? 'b' : 'w'}"></span><b>${esc(P.players[p].nick)}${p === me ? ' (ты)' : ''}</b><small>выброшено ${P.off[p]}/15</small>`; }
    }
    root.querySelector('.un-log').textContent = P.log;
    const rb = root.querySelector('.nd-roll');
    rb.disabled = !(myTurn && P.phase === 'roll');
    rb.classList.toggle('go', myTurn && P.phase === 'roll');
    root.querySelector('.un-status').innerHTML = P.winner >= 0 ? (P.winner === me ? `🏆 <b>Победа${P.mars ? ' с марсом' : ''}!</b>` : `😔 Победил ${esc(P.players[P.winner].nick)}`)
      : myTurn ? (P.phase === 'roll' ? '🟢 Брось кубики' : `🟢 Ходи: осталось ${P.left.map(d => DIE[d]).join(' ')} — нажми шашку, потом точку`) : `⏳ Ходит ${esc(P.players[P.turn].nick)}…`;
    if (!myTurn || P.phase !== 'move') sel = -1;
    draw();
    if (P.winner >= 0 && mode === 'play') over();
  }
  function over(){
    mode = 'over';
    const win = P.winner === meIdx;
    api.sfx(win ? 'win' : 'bad');
    root.querySelector('.un-acts').innerHTML = (isHost() ? '<button type="button" class="ct-start" data-act="again">↻ Ещё партия</button>' : '<span class="un-sub">Ждём, пока соперник начнёт новую…</span>')
      + `<button type="button" class="un-btn" data-act="leave">${room ? '🚪 Выйти' : '🏠 Меню'}</button>`;
    api.report(room ? 'nardy_online' : 'nardy_' + level, win, win ? (P.mars ? 2 : 1) : 0, (api.local().wins || 0) + (win ? 1 : 0));
  }
  // Тап: по своей точке — выбрать шашку; по подсвеченной — сходить
  function onTap(e){
    if (!P || P.turn !== meIdx || P.phase !== 'move' || P.winner >= 0) return;
    const r = cv.getBoundingClientRect(), k = cv.width / r.width, x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    const g = geom();
    if (x > g.Wd - g.pad - g.Wd * .08) {   // лоток выброса
      const s = P.legal.find(m => m.f === sel && m.f + m.d >= 24);
      if (s) { doAct({ a: 'move', f: s.f, d: s.d }); sel = -1; }
      return;
    }
    let abs = -1, bd = 1e9;
    for (let a = 0; a < 24; a++) { const top = a < 12; if ((y < g.Hd / 2) !== top) continue; const d = Math.abs(pointX(g, a) - x); if (d < bd) { bd = d; abs = a; } }
    if (abs < 0 || bd > g.pw * .6) return;
    const pos = relOf(meIdx, abs);
    if (sel >= 0) {
      const s = P.legal.find(m => m.f === sel && m.f + m.d === pos);
      if (s) { doAct({ a: 'move', f: s.f, d: s.d }); sel = -1; return; }
    }
    if (P.legal.some(m => m.f === pos)) { sel = sel === pos ? -1 : pos; draw(); }
  }
  function onClick(e){
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a.startsWith('lv:')) { level = a.slice(3); menu(); return; }
    if (a === 'bot') { startBot(); return; }
    if (a === 'online') { location.hash = '#/games/nardy/' + GameRoom.newCode(); return; }
    if (a === 'roll') { doAct({ a: 'roll' }); return; }
    if (a === 'again') { if (room) hostStart(); else startBot(); return; }
    if (a === 'leave') { if (room) location.hash = '#/games/nardy'; else menu(); return; }
    if (a === 'copy') { const inp = root.querySelector('.ct-link input'); navigator.clipboard?.writeText(inp.value).then(() => { b.textContent = '✅ Скопировано'; }, () => inp.select()); return; }
    if (a === 'go') { hostStart(); return; }
  }

  // ═══ ОНЛАЙН: стол на двоих ═══
  let code = '';
  function lobby(){
    if (!room || mode === 'play' || mode === 'over') return;
    mode = 'lobby';
    const seats = (room.seats || []).map(s => ({ id: s.id, nick: s.nick, me: s.me }));
    root.innerHTML = TableRoom.lobbyHtml(location.origin + location.pathname + '#/games/nardy/' + code, seats, 2, { title: '🎲 Нарды — стол', host: room.isHost, canStart: seats.length === 2 });
  }
  function hostStart(){
    if (!room?.isHost || room.seats.length < 2) return;
    const players = room.seats.slice(0, 2).map(s => ({ id: s.id, nick: s.nick }));
    G = newGame(players, Math.random);
    meIdx = 0; mode = 'play';
    build(); sync();
  }
  function joinTable(c){
    code = c;
    root.innerHTML = '<div class="gm-loading"><div class="spinner"></div>Подключаемся к столу…</div>';
    room = TableRoom.join('nardy', c, {
      max: 2,
      onError: () => { root.innerHTML = GameRoom.errorHtml; },
      onFull: () => { root.innerHTML = GameRoom.fullHtml('nardy'); },
      onSeats: seats => {
        if (mode === 'play' || mode === 'over') { if (seats.length < 2) { api.toast('Соперник вышел'); } return; }
        lobby();
      },
      onPrivate: (m, from) => {
        if (room.isHost) {
          if (m.type !== 'act' || !G || G.players[1].id !== from) return;
          const a = m.act || {};
          const err = a.a === 'roll' ? roll(G, 1) : move(G, 1, a.f | 0, a.d | 0);
          if (err) { room.sendTo(from, { type: 'err', text: err }); return; }
          sync();
          return;
        }
        if (from !== hostId()) return;
        if (m.type === 'up') {
          const first = !P || mode !== 'play';
          P = m.pub; meIdx = 1;
          if (first && P.winner < 0) { mode = 'play'; build(); }
          render();
        } else if (m.type === 'err') api.toast(m.text);
      },
    });
    if (!room) root.innerHTML = GameRoom.errorHtml;
  }

  window.GAME_IMPL.nardy = {
    mount(el, gameApi){
      root = el; api = gameApi;
      root.addEventListener('click', onClick);
      window.addEventListener('resize', resize);
      if (GameRoom.validCode(gameApi.param)) joinTable(gameApi.param); else menu();
    },
    unmount(){
      timers.forEach(clearTimeout); timers = [];
      clearTimeout(botT); clearTimeout(tickT);
      root?.removeEventListener('click', onClick);
      window.removeEventListener('resize', resize);
      room?.leave(); room = null;
      G = null; P = null; mode = 'menu';
      root = null; cv = null; ctx = null;
    },
    _test: { newGame, roll, move, sequences, legalNow, botTurn, badBlock, canStep, absOf, relOf },
  };
})();
