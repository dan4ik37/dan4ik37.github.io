// ═══════════════════════════════════════
//  ИГРА «ПОП-ИТ» (T-140) — лопай пупырки как можно быстрее: 40 секунд. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md), поле — 30 кнопок-пупырок 5×6 (DOM). Время — в шагах (60 в секунду).
// Своё: лопнул весь лист — +10, лист переворачивается (пупырки снова целые, новые цвета); ✨ золотая пупырка появляется
// на 1,5 с — +5; каждая пупырка «щёлкает» своей нотой.
// Очки: пупырка +1, ✨ +5, весь лист +10. Время одно на всех — 40 с.
// Исправлено против прототипа: время по Date.now и «меньше — лучше» без конца партии → общий предел 40 с и счёт (больше —
// лучше); перезапуск через setTimeout сам по себе → оверлей ядра «↻ Ещё раз»; звук через Math.random и свой AudioContext →
// целые ноты через общий звук ядра; инлайн-стили всего поля при каждом нажатии → классы, перерисовка только изменений.
(() => {
  const T = ArcadeKit.T;
  const COLS = 5, ROWS = 6, N = COLS * ROWS;
  const TIME = 40 * 60, FLIP = 24, GOLD = 90, NG = 64;          // шагов: партия, переворот листа, жизнь ✨; ✨ на партию (запас)
  const PAL = ['#ff4d6d', '#ff8a3d', '#ffc233', '#3fd6a4', '#4da3ff', '#a77bff', '#ff6fd8'];
  const NOTE = [523, 587, 659, 784, 880, 988];                  // Гц по ряду (целые)

  function create(rng){
    const s = { rng, left: TIME, n: 0, sheet: 0, flip: 0, gold: -1, goldT: 0, gj: 0, nextG: 0, score: 0, pops: 0, golds: 0,
      over: false, v: 0, snd: 0, p: new Uint8Array(N), gi: new Uint16Array(NG), gq: new Uint16Array(NG) };
    // расписание ✨ заранее (у соперников одинаково): промежуток 1,5–3 с и «случайное число» для выбора целой пупырки
    for (let j = 0; j < NG; j++) { s.gi[j] = 90 + Math.floor(rng() * 90); s.gq[j] = Math.floor(rng() * 1000); }
    s.nextG = 60 + s.gi[0];
    return s;
  }

  function input(s, e){
    if (s.over || s.flip || e.type !== T.PICK) return;
    const k = e.k;
    if (!(k >= 0 && k < N) || s.p[k]) return;
    s.p[k] = 1; s.n++; s.pops++; s.v++;
    if (k === s.gold) { s.score += 5; s.golds++; s.gold = -1; s.snd = 1319; }
    else { s.score += 1; s.snd = NOTE[(k / COLS) | 0]; }
    if (s.n < N) return;
    s.score += 10; s.sheet++; s.flip = FLIP; s.gold = -1; s.snd = 'ok';
  }

  function step(s){
    if (s.over) return;
    if (--s.left <= 0) { s.left = 0; s.over = true; s.gold = -1; s.snd = 'win'; s.v++; return; }
    if (s.flip && !--s.flip) { s.p.fill(0); s.n = 0; s.v++; }
    if (s.gold >= 0) { if (!--s.goldT) { s.gold = -1; s.v++; } return; }
    if (--s.nextG > 0 || s.flip) { if (s.nextG < 1) s.nextG = 1; return; }
    // новая ✨ — на целой пупырке
    const j = s.gj % NG, free = N - s.n;
    s.gj++; s.nextG = s.gi[j];
    if (!free) return;
    let c = s.gq[j] % free;
    for (let i = 0; i < N; i++) if (!s.p[i] && c-- === 0) { s.gold = i; break; }
    s.goldT = GOLD; s.v++;
  }

  const CSS = '.pp{display:flex;flex-direction:column;align-items:center;gap:.6rem;padding:.9rem .7rem .8rem;border-radius:14px;background:linear-gradient(160deg,#241a3a,#151024)}'
    + '.pp-g{width:100%;max-width:330px;display:grid;grid-template-columns:repeat(5,1fr);gap:9px;padding:12px;border-radius:26px;background:var(--bd,#3a2a5c);box-shadow:inset 0 -6px 0 rgba(0,0,0,.25);transition:transform .2s}'
    + '.pp.flip .pp-g{transform:rotateY(90deg)}'
    + '.pp-b{aspect-ratio:1;border:0;border-radius:50%;padding:0;cursor:pointer;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.55),rgba(255,255,255,0) 45%),var(--c);'
    + 'box-shadow:inset 0 -5px 8px rgba(0,0,0,.28),0 3px 0 rgba(0,0,0,.18);touch-action:manipulation;transition:transform .07s}'
    + '.pp-b.pp-x{transform:scale(.84);background:var(--c);opacity:.5;box-shadow:inset 0 5px 9px rgba(0,0,0,.45);cursor:default}'
    + '.pp-b.pp-g1{background:radial-gradient(circle at 35% 30%,#fff,#ffe58a 30%,#ffb300 75%);box-shadow:0 0 16px #ffd23f,inset 0 -5px 8px rgba(0,0,0,.2);animation:ppG .5s ease-in-out infinite alternate}'
    + '@keyframes ppG{to{transform:scale(1.08)}}'
    + '.pp-b:focus-visible{outline:3px solid #7dd3fc;outline-offset:2px}'
    + '.pp-msg{font-size:.8rem;color:#e2dcff;min-height:1.2em;font-variant-numeric:tabular-nums}'
    + 'body.low .pp-b,body.low .pp-g{transition:none;animation:none}';

  function build(G){
    if (!document.getElementById('ppCss')) { const st = document.createElement('style'); st.id = 'ppCss'; st.textContent = CSS; document.head.appendChild(st); }
    let h = '<div class="pp"><div class="pp-g">';
    for (let i = 0; i < N; i++) h += '<button type="button" class="pp-b" data-k="' + i + '" aria-label="Пупырка ' + (i + 1) + '"></button>';
    G.host.innerHTML = h + '</div><div class="pp-msg"></div></div>';
    G.box = G.host.firstChild;
    G.grid = G.box.querySelector('.pp-g');
    G.cells = G.grid.children;
    G.msg = G.box.querySelector('.pp-msg');
    G.sheet = -1;
  }

  function draw(G, s){
    if (G.sheet !== s.sheet) {
      // новый лист — новые цвета рядов
      G.sheet = s.sheet;
      for (let i = 0; i < N; i++) G.cells[i].style.setProperty('--c', PAL[(((i / COLS) | 0) + s.sheet * 2) % PAL.length]);
      G.grid.style.setProperty('--bd', ['#3a2a5c', '#1f3a4a', '#4a2a3a', '#2a4a33'][s.sheet % 4]);
    }
    for (let i = 0; i < N; i++) {
      G.cells[i].classList.toggle('pp-x', s.p[i] === 1);
      G.cells[i].classList.toggle('pp-g1', s.gold === i);
    }
    G.box.classList.toggle('flip', s.flip > FLIP / 2);
    G.msg.textContent = s.over ? 'Время! Листов: ' + s.sheet + ', ✨ ' + s.golds
      : s.flip ? 'Лист готов! +10 — переворачиваем' : 'Осталось на листе: ' + (N - s.n) + (s.gold >= 0 ? ' · лови ✨!' : '');
  }

  ArcadeKit.define('popit', {
    kind: 'dom', W: 320, H: 400, maxW: 400,
    title: '🟣 Поп-ит',
    intro: 'Лопай пупырки как можно быстрее — у тебя 40 секунд. Весь лист — +10 и он переворачивается. ✨ Золотая пупырка — +5, но живёт всего полторы секунды.',
    controls: 'Нажимай на пупырки пальцем или мышью (можно двумя пальцами). На клавиатуре — Tab по пупыркам и Enter.',
    duelTitle: 'Одинаковые золотые пупырки у обоих',
    create, input, step, draw, build,
    hudKey: s => s.sheet * 1000 + Math.ceil(s.left / 60),
    hud: s => '📄 лист ' + (s.sheet + 1) + ' · ⏱ ' + Math.ceil(s.left / 60) + ' с',
    win: s => s.score >= 200,
    result: s => ({
      title: s.score >= 400 ? '🔥 Пальцы-пулемёт!' : s.score >= 200 ? '🎉 Отличный темп!' : '🫧 Время вышло',
      text: 'пупырок: ' + s.pops + ' · листов: ' + s.sheet + (s.golds ? ' · ✨ ' + s.golds : ''),
    }),
    consts: { COLS, ROWS, N, TIME, FLIP, GOLD },
  });
})();
