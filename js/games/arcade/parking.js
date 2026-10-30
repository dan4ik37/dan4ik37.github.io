// ═══════════════════════════════════════
//  ИГРА «ПАРКОВКА» (T-140) — выпусти все машины со стоянки: машина едет по стрелке, если путь свободен. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md), поле — стоянка 6×6 с машинами-кнопками (DOM). Время — в шагах (60 в секунду).
// Три стоянки за 2 минуты (8, 10, 13 машин). Своё: машина, которой перегородили путь, сигналит «БИП!» и показывает,
// кто мешает (та машина качается) — это −5 очков; машины уезжают с анимацией.
// Очки: машина уехала +10, стоянка пуста +30, все три — бонус 2 за каждую оставшуюся секунду; врезался — −5 (не ниже 0).
// Стоянка строится так, что машины всегда можно выпустить (в порядке, обратном постановке) — бот так и делает.
// Проверка T-140 (D3): нажимать все машины подряд, не думая, выигрывало каждую партию (40 из 40, в среднем 501–574 очка
// против 599 у решателя): −5 за БИП (не ниже 0) почти ничего не стоило, а 3/4 машин на старте уже были свободны.
// Теперь (1) 3 БИП на одной стоянке — 🚛 эвакуатор: оставшиеся машины увозят (за них 0 и нет +30), дальше следующая
// стоянка; бонус за время — только если все три стоянки пусты; (2) стоянка строится «плотнее»: из следующих TRY мест
// (порядок — rng) берётся то, что перекрывает путь больше всего уже стоящих машин (на старте свободна ~половина).
// Исправлено против прототипа: Math.random → rng (у соперников одинаковые стоянки); время по Date.now и «меньше — лучше»
// без конца партии → очки и общий предел времени; нажатие на запертую машину ничего не стоило — теперь штраф и подсказка;
// filter/flatMap всех клеток на каждое нажатие → сетка занятости Int8Array.
(() => {
  const T = ArcadeKit.T;
  const S = 6, LOTS = [8, 10, 13], MC = 16;
  const TIME = 120 * 60, WAIT = 45, OUT = 24, HONK = 40;   // шагов
  const TOW = 3, TRY = 12;   // БИП на стоянку до эвакуатора; из скольких свободных мест выбирается самое «мешающее»
  const PAL = ['#ff4d6d', '#ff9f1c', '#ffd60a', '#2ec27e', '#3a86ff', '#b15cff', '#ff6fd8', '#22d3ee'];

  // путь машины i до края (по её стрелке): первая занятая клетка → номер машины-помехи, иначе −1
  function blocker(s, i){
    const h = s.h[i], d = s.d[i];
    let x = h ? (d > 0 ? s.x[i] + s.len[i] : s.x[i] - 1) : s.x[i], y = h ? s.y[i] : (d > 0 ? s.y[i] + s.len[i] : s.y[i] - 1);
    while (x >= 0 && x < S && y >= 0 && y < S) {
      const o = s.occ[y * S + x];
      if (o >= 0) return o;
      if (h) x += d; else y += d;
    }
    return -1;
  }

  // все возможные места машины на стоянке: [горизонтальная, длина, x, y, направление] — 216 вариантов, таблица одна на страницу
  const CAND = (() => {
    const a = [];
    for (let h = 0; h < 2; h++) for (let len = 2; len <= 3; len++) for (let p = 0; p <= S - len; p++) for (let q = 0; q < S; q++) for (let d = -1; d <= 1; d += 2)
      a.push(h, len, h ? p : q, h ? q : p, d);
    return Int8Array.from(a);
  })();
  const NC = CAND.length / 5;

  // стоянка L: места перебираются в случайном порядке (rng), машина встаёт, если её клетки и путь до края свободны —
  // значит, в обратном порядке постановки каждая уезжает. Одно rng() даёт 4 случайных байта (меньше «упакованных» чисел).
  function gen(s, L){
    const occ = s.occ, o = L * MC, P = s.perm;
    occ.fill(-1);
    for (let i = 0; i < NC; i++) P[i] = i;
    let r = 0;
    for (let i = NC - 1; i > 0; i--) {
      if ((i & 3) === 3 || i === NC - 1) r = (s.rng() * 4294967296) >>> 0;
      const j = (r & 255) % (i + 1), t = P[i];
      r >>>= 8;
      P[i] = P[j]; P[j] = t;
    }
    // место P[m] годно для машины K: клетки свободны и путь до края свободен (место, негодное сейчас, не станет годным —
    // машин только прибавляется, поэтому начало перестановки можно пропускать насовсем); USED — место уже занято машиной
    let K = 0, n = 0;
    while (K < LOTS[L]) {
      while (n < NC && (P[n] === USED || !fits(s, P[n], K))) n++;
      if (n >= NC) break;
      let best = n, most = -1;
      for (let m = n, seen = 0; m < NC && seen < TRY; m++) {
        if (P[m] === USED || !fits(s, P[m], K)) continue;
        seen++;
        const b = closes(s, P[m], K);
        if (b > most) { most = b; best = m; }
      }
      fits(s, P[best], K);   // s.x[K] … s.d[K] — выбранное место
      const h = s.h[K], len = s.len[K], x = s.x[K], y = s.y[K];
      for (let i = 0; i < len; i++) occ[(h ? y : y + i) * S + (h ? x + i : x)] = K;
      s.lx[o + K] = x; s.ly[o + K] = y; s.ll[o + K] = len; s.lh[o + K] = h; s.ld[o + K] = s.d[K];
      P[best] = USED;
      K++;
    }
    s.ln[L] = K;
  }
  const USED = 255;   // NC = 216 мест — 255 не номер места
  // ставит машину K на место c (поля s.x[K] … s.d[K]) и отвечает, годно ли оно
  function fits(s, c, K){
    const q = c * 5, h = CAND[q], len = CAND[q + 1], x = CAND[q + 2], y = CAND[q + 3];
    for (let i = 0; i < len; i++) if (s.occ[(h ? y : y + i) * S + (h ? x + i : x)] >= 0) return false;
    s.x[K] = x; s.y[K] = y; s.len[K] = len; s.h[K] = h; s.d[K] = CAND[q + 4];
    return blocker(s, K) < 0;
  }
  // сколько уже стоящих машин 0…K−1 потеряют свободный путь, если встать на место c
  function closes(s, c, K){
    const q = c * 5, h = CAND[q], len = CAND[q + 1], x = CAND[q + 2], y = CAND[q + 3];
    let b = 0;
    for (let j = 0; j < K; j++) {
      const hj = s.h[j], dj = s.d[j], xj = s.x[j], yj = s.y[j], lj = s.len[j];
      let on = 0;
      for (let i = 0; i < len && !on; i++) {
        const cx = h ? x + i : x, cy = h ? y : y + i;
        on = hj ? (cy === yj && (dj > 0 ? cx >= xj + lj : cx < xj) ? 1 : 0) : (cx === xj && (dj > 0 ? cy >= yj + lj : cy < yj) ? 1 : 0);
      }
      b += on;
    }
    return b;
  }

  function load(s, L){
    const o = L * MC, n = s.ln[L];
    s.lot = L; s.n = n; s.cars = n; s.occ.fill(-1); s.out = -1; s.outT = 0; s.honk = -1; s.honkT = 0; s.who = -1; s.lb = 0; s.tw = 0;
    for (let i = 0; i < MC; i++) {
      s.alive[i] = i < n ? 1 : 0;
      if (i >= n) continue;
      s.x[i] = s.lx[o + i]; s.y[i] = s.ly[o + i]; s.len[i] = s.ll[o + i]; s.h[i] = s.lh[o + i]; s.d[i] = s.ld[o + i];
      for (let k = 0; k < s.len[i]; k++) s.occ[(s.h[i] ? s.y[i] : s.y[i] + k) * S + (s.h[i] ? s.x[i] + k : s.x[i])] = i;
    }
    s.v++;
  }

  function create(rng){
    const s = { rng, lot: 0, n: 0, cars: 0, out: -1, outT: 0, honk: -1, honkT: 0, who: -1, score: 0, gone: 0, bumps: 0, solved: 0, lb: 0, tw: 0, towed: 0,
      bonus: 0, left: TIME, wait: 0, over: false, v: 0, snd: 0,
      x: new Int8Array(MC), y: new Int8Array(MC), len: new Int8Array(MC), h: new Int8Array(MC), d: new Int8Array(MC), alive: new Uint8Array(MC),
      occ: new Int8Array(S * S), perm: new Uint8Array(NC),
      lx: new Int8Array(LOTS.length * MC), ly: new Int8Array(LOTS.length * MC), ll: new Int8Array(LOTS.length * MC),
      lh: new Int8Array(LOTS.length * MC), ld: new Int8Array(LOTS.length * MC), ln: new Uint8Array(LOTS.length) };
    for (let L = 0; L < LOTS.length; L++) gen(s, L);
    load(s, 0);
    return s;
  }

  function input(s, e){
    if (s.over || s.wait || e.type !== T.PICK) return;
    const i = e.k;
    if (!(i >= 0 && i < s.n) || !s.alive[i]) return;
    const b = blocker(s, i);
    s.v++;
    if (b >= 0) {   // путь занят: БИП, помеха качается, −5; TOW-й БИП на стоянке — эвакуатор
      s.honk = b; s.honkT = HONK; s.who = i; s.bumps++; s.lb++;
      s.score = Math.max(0, s.score - 5); s.snd = 'bad';
      if (s.lb >= TOW) { s.tw = 1; s.towed += s.cars; s.wait = WAIT; }   // оставшиеся увозят: 0 очков за них, без +30
      return;
    }
    s.alive[i] = 0; s.cars--; s.gone++;
    for (let k = 0; k < s.len[i]; k++) s.occ[(s.h[i] ? s.y[i] : s.y[i] + k) * S + (s.h[i] ? s.x[i] + k : s.x[i])] = -1;
    s.out = i; s.outT = OUT; s.score += 10; s.snd = 392 + 49 * (s.gone % 5);
    if (s.honk === i) { s.honk = -1; s.honkT = 0; }
    if (s.cars) return;
    s.score += 30; s.solved++; s.wait = WAIT; s.snd = 'ok';
  }

  function step(s){
    if (s.over) return;
    if (s.outT && !--s.outT) { s.out = -1; s.v++; }
    if (s.honkT && !--s.honkT) { s.honk = -1; s.who = -1; s.v++; }
    if (s.wait) {
      if (--s.wait) return;
      if (s.lot + 1 < LOTS.length) { load(s, s.lot + 1); return; }
      const all = s.solved === LOTS.length;   // бонус за время — только за три пустые стоянки
      s.bonus = all ? 2 * Math.ceil(s.left / 60) : 0;
      s.score += s.bonus; s.over = true; s.snd = all ? 'win' : 'ok'; s.v++;
      return;
    }
    if (--s.left <= 0) { s.left = 0; s.over = true; s.snd = 'bad'; s.v++; }
  }

  const CSS = '.pk{display:flex;flex-direction:column;align-items:center;gap:.6rem;padding:.9rem .6rem .8rem;border-radius:14px;background:#1d2129}'
    + '.pk-lot{position:relative;width:100%;max-width:360px;aspect-ratio:1;border-radius:12px;overflow:hidden;background:#3b404b;'
    + 'background-image:linear-gradient(90deg,rgba(255,255,255,.13) 2px,transparent 2px),linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px);background-size:calc(100%/6) calc(100%/6);'
    + 'box-shadow:inset 0 0 0 4px #ffd60a55}'
    + '.pk-c{position:absolute;border:0;padding:0;cursor:pointer;background:transparent;touch-action:manipulation;transition:transform .4s ease-in,opacity .4s ease-in}'
    + '.pk-c i{position:absolute;inset:7%;border-radius:12px;background:var(--c);box-shadow:inset 0 -5px 0 rgba(0,0,0,.25),0 3px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;'
    + 'font:800 clamp(16px,6vw,26px) system-ui,sans-serif;font-style:normal;color:rgba(255,255,255,.92);text-shadow:0 1px 2px rgba(0,0,0,.4)}'
    + '.pk-c i::after{content:"";position:absolute;background:rgba(190,230,255,.75);border-radius:4px}'
    + '.pk-c.r i::after{right:14%;top:18%;bottom:18%;width:10%}.pk-c.l i::after{left:14%;top:18%;bottom:18%;width:10%}'
    + '.pk-c.d i::after{bottom:14%;left:18%;right:18%;height:10%}.pk-c.u i::after{top:14%;left:18%;right:18%;height:10%}'
    + '.pk-c.go.r{transform:translateX(700%);opacity:0}.pk-c.go.l{transform:translateX(-700%);opacity:0}.pk-c.go.d{transform:translateY(700%);opacity:0}.pk-c.go.u{transform:translateY(-700%);opacity:0}'
    + '.pk-c.gone{display:none}'
    + '.pk-c.hk i{animation:pkH .12s linear infinite alternate;box-shadow:0 0 0 3px #ff4d6d,0 0 14px #ff4d6d}'
    + '@keyframes pkH{from{transform:rotate(-4deg)}to{transform:rotate(4deg)}}'
    + '.pk-c.who i::before{content:"БИП!";position:absolute;top:-2px;left:50%;transform:translate(-50%,-100%);font:800 11px system-ui,sans-serif;color:#ffd60a;background:#000a;padding:1px 4px;border-radius:5px;white-space:nowrap}'
    + '.pk-c:focus-visible{outline:3px solid #7dd3fc;outline-offset:-2px}'
    + '.pk-msg{font-size:.8rem;color:#dfe3ea;min-height:1.2em;font-variant-numeric:tabular-nums}'
    + '.pk-c.tw i{filter:grayscale(1);opacity:.45}'
    + 'body.low .pk-c{transition:none}body.low .pk-c.hk i{animation:none}';
  const ARR = ['◀', '▶', '▲', '▼'];

  function build(G){
    if (!document.getElementById('pkCss')) { const st = document.createElement('style'); st.id = 'pkCss'; st.textContent = CSS; document.head.appendChild(st); }
    G.host.innerHTML = '<div class="pk"><div class="pk-lot"></div><div class="pk-msg"></div></div>';
    G.box = G.host.firstChild;
    G.lot = G.box.querySelector('.pk-lot');
    G.msg = G.box.querySelector('.pk-msg');
    G.L = -1; G.cars = null;
  }

  function draw(G, s){
    if (G.L !== s.lot) {
      G.L = s.lot;
      let h = '';
      for (let i = 0; i < s.n; i++) {
        const hz = s.h[i], d = s.d[i], dir = hz ? (d > 0 ? 'r' : 'l') : (d > 0 ? 'd' : 'u');
        h += '<button type="button" class="pk-c ' + dir + '" data-k="' + i + '" style="left:' + (s.x[i] * 100 / S) + '%;top:' + (s.y[i] * 100 / S) + '%;width:'
          + ((hz ? s.len[i] : 1) * 100 / S) + '%;height:' + ((hz ? 1 : s.len[i]) * 100 / S) + '%;--c:' + PAL[i % PAL.length] + '" aria-label="Машина ' + (i + 1)
          + ', едет ' + (hz ? (d > 0 ? 'вправо' : 'влево') : (d > 0 ? 'вниз' : 'вверх')) + '"><i>' + ARR[hz ? (d > 0 ? 1 : 0) : (d > 0 ? 3 : 2)] + '</i></button>';
      }
      G.lot.innerHTML = h;
      G.cars = G.lot.children;
    }
    for (let i = 0; i < s.n; i++) {
      const c = G.cars[i];
      c.classList.toggle('go', !s.alive[i]);
      c.classList.toggle('gone', !s.alive[i] && s.out !== i);
      c.classList.toggle('hk', s.honk === i);
      c.classList.toggle('who', s.who === i);
      c.classList.toggle('tw', s.tw === 1 && s.alive[i] === 1);
      c.disabled = !s.alive[i];
    }
    G.msg.textContent = s.over ? (s.solved === LOTS.length ? 'Все стоянки пусты! Бонус за время: +' + s.bonus : s.left ? 'Стоянки кончились' : 'Время вышло')
      : s.wait ? (s.tw ? '🚛 Эвакуатор: ' + TOW + ' БИП — оставшиеся машины увезли' : 'Стоянка ' + (s.lot + 1) + ' пуста! +30')
        : s.honk >= 0 ? 'Путь занят — мешает машина, которая качается (−5, БИП ' + s.lb + ' из ' + TOW + ')' : 'Машин осталось: ' + s.cars;
  }

  const clock = n => { const sec = Math.ceil(n / 60); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

  ArcadeKit.define('parking', {
    kind: 'dom', W: 320, H: 380, maxW: 400,
    title: '🚗 Парковка',
    intro: 'Выпусти все машины со стоянки. Нажми машину — она поедет по стрелке, если путь до края свободен. Врезался — БИП и −5, три БИП на одной стоянке — приедет эвакуатор. Три стоянки за 2 минуты.',
    controls: 'Нажимай на машины пальцем или мышью. На клавиатуре — Tab по машинам и Enter.',
    duelTitle: 'Одинаковые стоянки у обоих',
    create, input, step, draw, build,
    hudKey: s => s.lot * 1e7 + s.lb * 1e6 + s.cars * 1000 + Math.ceil(s.left / 60),
    hud: s => '🅿️ ' + (s.lot + 1) + '/' + LOTS.length + ' · 🚗 ' + s.cars + (s.lb ? ' · БИП ' + s.lb + '/' + TOW : '') + ' · ⏱ ' + clock(s.left),
    win: s => s.solved === LOTS.length,
    result: s => ({
      title: s.solved === LOTS.length ? (s.bumps ? '🏁 Все уехали!' : '🏆 Ни одного БИП!') : s.left ? '🚛 Не все уехали' : '⏰ Время вышло',
      text: 'стоянок: ' + s.solved + '/' + LOTS.length + ' · машин: ' + s.gone + (s.bumps ? ' · БИП: ' + s.bumps : '') + (s.towed ? ' · увёз эвакуатор: ' + s.towed : '')
        + (s.bonus ? ' · за время +' + s.bonus : ''),
    }),
    consts: { S, LOTS, MC, TIME, WAIT, OUT, HONK, TOW, TRY, blocker },
  });
})();
