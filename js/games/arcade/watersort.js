// ═══════════════════════════════════════
//  ИГРА «СОРТИРОВКА КРАСОК» (T-140) — переливай краски, пока в каждой банке не останется один цвет. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md), поле — банки-кнопки (DOM). Время — в шагах (60 в секунду).
// Три уровня за 3 минуты: 4, 5 и 6 красок (+2 пустые банки, в банке 4 слоя). Своё: у каждой краски свой знак (●▲■◆★♥ —
// играть можно и не различая цвета), собранная банка закрывается крышкой ⭐; отмена хода без ограничений.
// Очки: краска собрана в банку впервые на уровне — +10, уровень — +50, все три — бонус 2 за каждую оставшуюся секунду.
// Каждый уровень проверен решателем в create (поиск в глубину, без мусора), значит, всегда решается; решение — для ботов.
// Исправлено против прототипа: перемешивание через Math.random → rng (у соперников одинаковые банки) и без проверки, что
// уровень решается (мог выпасть тупик) → решатель; «меньше ходов — лучше» без конца партии → очки и предел времени;
// отмена через JSON.stringify всего поля → кольцо из 3 чисел на ход; одна и та же собранная банка, перелитая туда-обратно,
// не даёт очки повторно (награда — за краску, а не за банку).
(() => {
  const T = ArcadeKit.T;
  const LEVELS = [4, 5, 6], CAP = 4, MJ = 8, MAXS = 100, HMAX = 128, UNDO = 9;
  const TIME = 180 * 60, WAIT = 50;
  const COL = ['#ff4d6d', '#ff9f1c', '#ffd60a', '#2ec27e', '#3a86ff', '#b15cff'];
  const SIGN = ['●', '▲', '■', '◆', '★', '♥'];
  const NAME = ['красная', 'оранжевая', 'жёлтая', 'зелёная', 'синяя', 'фиолетовая'];

  // перелить из f в t (массивы J — слои снизу вверх, C — сколько слоёв): верхний слой одного цвета, сколько влезет
  function pour(J, C, f, t){
    const cf = C[f], ct = C[t];
    if (f === t || !cf || ct === CAP) return 0;
    const col = J[f * CAP + cf - 1];
    if (ct && J[t * CAP + ct - 1] !== col) return 0;
    let r = 1;
    while (r < cf && J[f * CAP + cf - 1 - r] === col) r++;
    const n = r < CAP - ct ? r : CAP - ct;
    for (let i = 0; i < n; i++) { J[t * CAP + ct + i] = col; J[f * CAP + cf - 1 - i] = -1; }
    C[t] = ct + n; C[f] = cf - n;
    return n;
  }
  const full = (J, C, i) => { if (C[i] !== CAP) return false; const c = J[i * CAP]; for (let k = 1; k < CAP; k++) if (J[i * CAP + k] !== c) return false; return true; };
  function sorted(J, C, nj){ for (let i = 0; i < nj; i++) if (C[i] && !full(J, C, i)) return false; return true; }

  // ── решатель (только в create): поиск в глубину + таблица посещённых состояний (два 32-битных хэша банок, порядок банок
  // не важен). Рабочие массивы — один раз на страницу, без мусора на каждый create ──
  const HS = 1 << 16, LIMIT = 20000;
  let SJ = null, SC, SH1, SH2, SP, SK, SB, nodes = 0, SL = 0;
  function scratch(){
    if (SJ) return;
    SJ = new Int8Array(MJ * CAP); SC = new Uint8Array(MJ); SH1 = new Int32Array(HS); SH2 = new Int32Array(HS);
    SP = new Int8Array(2 * MAXS); SK = new Int32Array(MJ); SB = new Int8Array(MJ * CAP);
  }
  function seen(nj){
    for (let i = 0; i < nj; i++) {
      let c = SC[i];
      for (let k = 0; k < SC[i]; k++) c = c * 7 + SJ[i * CAP + k] + 1;
      let j = i;
      while (j > 0 && SK[j - 1] > c) { SK[j] = SK[j - 1]; j--; }
      SK[j] = c;
    }
    let h1 = 0x811c9dc5 | 0, h2 = 0x2545f491;
    for (let i = 0; i < nj; i++) { h1 = Math.imul(h1 ^ SK[i], 16777619); h2 = Math.imul(h2 + SK[i], 0x9e3779b1) ^ (h2 >>> 13); }
    h1 |= 1;
    let p = h1 & (HS - 1);
    while (SH1[p] !== 0) { if (SH1[p] === h1 && SH2[p] === h2) return true; p = (p + 1) & (HS - 1); }
    SH1[p] = h1; SH2[p] = h2;
    return false;
  }
  function dfs(nj, d){
    if (sorted(SJ, SC, nj)) { SL = d; return true; }
    if (d >= MAXS || ++nodes > LIMIT || seen(nj)) return false;
    // сначала — на свой цвет, потом — в первую пустую банку
    for (let pass = 0; pass < 2; pass++) {
      for (let f = 0; f < nj; f++) {
        const cf = SC[f];
        if (!cf || full(SJ, SC, f)) continue;
        let uni = true;
        for (let k = 1; k < cf; k++) if (SJ[f * CAP + k] !== SJ[f * CAP]) uni = false;
        for (let t = 0; t < nj; t++) {
          const ct = SC[t];
          if (t === f || ct === CAP || (pass === 0) === (ct === 0)) continue;
          if (ct === 0 && uni) break;   // банку одного цвета — в пустую: бессмысленно
          const n = pour(SJ, SC, f, t);
          if (!n) continue;
          SP[2 * d] = f; SP[2 * d + 1] = t;
          if (dfs(nj, d + 1)) return true;
          const col = SJ[t * CAP + ct];
          for (let i = 0; i < n; i++) { SJ[t * CAP + ct + i] = -1; SJ[f * CAP + cf - n + i] = col; }
          SC[t] = ct; SC[f] = cf;
          if (ct === 0) break;          // в пустые — только в первую
        }
      }
    }
    return false;
  }
  // уровень L: краски вперемешку (rng), ни одной собранной банки, решатель нашёл решение
  function gen(s, L){
    scratch();
    const colors = LEVELS[L], nj = colors + 2, m = colors * CAP;
    for (;;) {
      for (let i = 0; i < m; i++) SB[i] = (i / CAP) | 0;
      for (let i = m - 1; i > 0; i--) { const j = Math.floor(s.rng() * (i + 1)), t = SB[i]; SB[i] = SB[j]; SB[j] = t; }
      SJ.fill(-1); SC.fill(0);
      for (let i = 0; i < m; i++) SJ[i] = SB[i];
      for (let i = 0; i < colors; i++) SC[i] = CAP;
      let bad = false;
      for (let i = 0; i < colors; i++) if (full(SJ, SC, i)) bad = true;
      if (bad) continue;
      for (let i = 0; i < MJ * CAP; i++) s.j0[L * MJ * CAP + i] = SJ[i];
      SH1.fill(0); SH2.fill(0); nodes = 0;
      if (!dfs(nj, 0)) continue;
      for (let i = 0; i < 2 * SL; i++) s.sol[L * 2 * MAXS + i] = SP[i];
      s.sl[L] = SL;
      return;
    }
  }

  function load(s, L){
    s.lvl = L; s.nj = LEVELS[L] + 2; s.sel = -1; s.moves = 0; s.hn = 0; s.doneC.fill(0);
    for (let i = 0; i < MJ * CAP; i++) s.j[i] = s.j0[L * MJ * CAP + i];
    for (let i = 0; i < MJ; i++) { let c = 0; while (c < CAP && s.j[i * CAP + c] >= 0) c++; s.c[i] = c; }
    s.v++;
  }

  function create(rng){
    const s = { rng, lvl: 0, nj: 6, sel: -1, moves: 0, hn: 0, score: 0, solved: 0, bonus: 0, left: TIME, wait: 0, last: -1,
      over: false, v: 0, snd: 0,
      j: new Int8Array(MJ * CAP), c: new Uint8Array(MJ), doneC: new Uint8Array(6), hist: new Int8Array(3 * HMAX),
      j0: new Int8Array(LEVELS.length * MJ * CAP), sol: new Int8Array(LEVELS.length * 2 * MAXS), sl: new Uint8Array(LEVELS.length) };
    for (let L = 0; L < LEVELS.length; L++) gen(s, L);
    load(s, 0);
    return s;
  }

  function undo(s){
    if (!s.hn) return;
    s.hn--;
    const f = s.hist[3 * s.hn], t = s.hist[3 * s.hn + 1], n = s.hist[3 * s.hn + 2], col = s.j[t * CAP + s.c[t] - 1];
    for (let i = 0; i < n; i++) { s.j[t * CAP + s.c[t] - 1] = -1; s.c[t]--; s.j[f * CAP + s.c[f]] = col; s.c[f]++; }
    s.moves++; s.sel = -1; s.last = -1; s.v++; s.snd = 330;
  }

  function input(s, e){
    if (s.over || s.wait) return;
    if (e.type !== T.PICK && e.type !== T.KEY) return;
    const k = e.k;
    if (k === UNDO) return undo(s);
    if (!(k >= 0 && k < s.nj)) return;
    s.v++;
    if (s.sel < 0) { if (s.c[k]) { s.sel = k; s.snd = 523; } return; }
    if (s.sel === k) { s.sel = -1; return; }
    const f = s.sel, n = pour(s.j, s.c, f, k);
    if (!n) { s.sel = s.c[k] ? k : -1; s.snd = 196; return; }
    if (s.hn === HMAX) { s.hist.copyWithin(0, 3); s.hn--; }
    s.hist[3 * s.hn] = f; s.hist[3 * s.hn + 1] = k; s.hist[3 * s.hn + 2] = n; s.hn++;
    s.moves++; s.sel = -1; s.last = k; s.snd = 659;
    if (full(s.j, s.c, k) && !s.doneC[s.j[k * CAP]]) { s.doneC[s.j[k * CAP]] = 1; s.score += 10; s.snd = 'ok'; }
    if (!sorted(s.j, s.c, s.nj)) return;
    s.score += 50; s.solved++; s.wait = WAIT; s.snd = 'win';
  }

  function step(s){
    if (s.over) return;
    if (s.wait) {
      if (--s.wait) return;
      if (s.lvl + 1 < LEVELS.length) { load(s, s.lvl + 1); return; }
      s.bonus = 2 * Math.ceil(s.left / 60);
      s.score += s.bonus; s.over = true; s.snd = 'win'; s.v++;
      return;
    }
    if (--s.left <= 0) { s.left = 0; s.over = true; s.sel = -1; s.snd = 'bad'; s.v++; }
  }

  const CSS = '.ws{display:flex;flex-direction:column;align-items:center;gap:.7rem;padding:1rem .6rem .8rem;border-radius:14px;background:linear-gradient(170deg,#2b2140,#141020)}'
    + '.ws-row{width:100%;max-width:360px;display:grid;grid-template-columns:repeat(var(--m),1fr);gap:14px 10px;justify-items:center}'
    + '.ws-j{width:100%;max-width:62px;aspect-ratio:1/2.3;border:3px solid rgba(255,255,255,.55);border-top-width:0;border-radius:6px 6px 22px 22px;padding:4px 4px 6px;'
    + 'background:rgba(255,255,255,.06);display:flex;flex-direction:column-reverse;gap:3px;cursor:pointer;position:relative;touch-action:manipulation;transition:transform .12s}'
    + '.ws-j.sel{transform:translateY(-12px);border-color:#fff;box-shadow:0 8px 18px rgba(255,255,255,.18)}'
    + '.ws-j.last{animation:wsP .25s}@keyframes wsP{50%{transform:scale(1.05)}}'
    + '.ws-j.lid::before{content:"⭐";position:absolute;top:-1.15em;left:50%;transform:translateX(-50%);font-size:1rem}'
    + '.ws-j:focus-visible{outline:3px solid #7dd3fc;outline-offset:3px}'
    + '.ws-s{flex:1;border-radius:4px;display:flex;align-items:center;justify-content:center;font:700 clamp(12px,4vw,17px) system-ui,sans-serif;color:rgba(0,0,0,.45);visibility:hidden}'
    + '.ws-s.on{visibility:visible;background:var(--c)}'
    + '.ws-s.on:first-child{border-radius:4px 4px 16px 16px}'
    + '.ws-u{font:600 .85rem system-ui,sans-serif;padding:.45rem 1rem;border-radius:999px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#eee;cursor:pointer;touch-action:manipulation}'
    + '.ws-u:disabled{opacity:.4;cursor:default}'
    + '.ws-msg{font-size:.8rem;color:#e2dcff;min-height:1.2em;font-variant-numeric:tabular-nums}'
    + 'body.low .ws-j{transition:none;animation:none}';

  function build(G){
    if (!document.getElementById('wsCss')) { const st = document.createElement('style'); st.id = 'wsCss'; st.textContent = CSS; document.head.appendChild(st); }
    G.host.innerHTML = '<div class="ws"><div class="ws-row"></div><button type="button" class="ws-u" data-k="' + UNDO + '">↶ Отменить ход</button><div class="ws-msg"></div></div>';
    G.box = G.host.firstChild;
    G.row = G.box.querySelector('.ws-row');
    G.undo = G.box.querySelector('.ws-u');
    G.msg = G.box.querySelector('.ws-msg');
    G.nj = -1; G.lvl = -1; G.jars = null;
  }

  function draw(G, s){
    if (G.nj !== s.nj || G.lvl !== s.lvl) {
      G.nj = s.nj; G.lvl = s.lvl;
      G.row.style.setProperty('--m', Math.ceil(s.nj / 2));
      let h = '';
      for (let i = 0; i < s.nj; i++) {
        h += '<button type="button" class="ws-j" data-k="' + i + '" aria-label="Банка ' + (i + 1) + '">';
        for (let k = 0; k < CAP; k++) h += '<i class="ws-s"></i>';
        h += '</button>';
      }
      G.row.innerHTML = h;
      G.jars = G.row.children;
    }
    for (let i = 0; i < s.nj; i++) {
      const b = G.jars[i], seg = b.children;
      for (let k = 0; k < CAP; k++) {
        const c = s.j[i * CAP + k], el = seg[k];
        el.classList.toggle('on', c >= 0);
        if (c >= 0) { el.style.setProperty('--c', COL[c]); el.textContent = SIGN[c]; } else el.textContent = '';
      }
      b.classList.toggle('sel', s.sel === i);
      b.classList.toggle('lid', full(s.j, s.c, i));
      b.classList.toggle('last', s.last === i);
      let txt = 'Банка ' + (i + 1) + ': ';
      for (let k = 0; k < s.c[i]; k++) txt += (k ? ', ' : '') + NAME[s.j[i * CAP + k]];
      b.setAttribute('aria-label', s.c[i] ? txt : 'Банка ' + (i + 1) + ': пустая');
    }
    G.undo.disabled = !s.hn || !!s.wait || s.over;
    G.msg.textContent = s.wait ? 'Уровень ' + (s.lvl + 1) + ' готов! +50'
      : s.over ? (s.solved === LEVELS.length ? 'Все краски разложены! Бонус за время: +' + s.bonus : 'Время вышло')
        : s.sel >= 0 ? 'Куда перелить? Нажми другую банку' : 'Нажми банку, потом — куда перелить';
  }

  const clock = n => { const sec = Math.ceil(n / 60); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

  ArcadeKit.define('watersort', {
    kind: 'dom', W: 320, H: 400, maxW: 400,
    title: '🎨 Сортировка красок',
    intro: 'Переливай краски из банки в банку, пока в каждой не останется один цвет. Лить можно только на такой же цвет или в пустую банку. Три уровня за 3 минуты.',
    controls: 'Нажми банку, потом ту, куда перелить. «↶ Отменить ход» — сколько угодно. Клавиши: 1–8 — банки, 9 — отмена.',
    duelTitle: 'Одинаковые банки у обоих',
    keys: { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7, Digit9: UNDO, KeyZ: UNDO, Backspace: UNDO },
    create, input, step, draw, build,
    hudKey: s => s.lvl * 1e7 + Math.min(9999, s.moves) * 1000 + Math.ceil(s.left / 60),
    hud: s => '🎨 ' + (s.lvl + 1) + '/' + LEVELS.length + ' · ходов ' + s.moves + ' · ⏱ ' + clock(s.left),
    win: s => s.solved === LEVELS.length,
    result: s => ({
      title: s.solved === LEVELS.length ? '🏆 Все краски разложены!' : '⏰ Время вышло',
      text: 'уровней: ' + s.solved + '/' + LEVELS.length + (s.bonus ? ' · за время +' + s.bonus : ''),
    }),
    consts: { LEVELS, CAP, MJ, MAXS, UNDO, TIME, WAIT, pour, full, sorted },
  });
})();
