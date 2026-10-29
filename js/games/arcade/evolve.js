// ═══════════════════════════════════════
//  ИГРА «ЭВОЛЮЦИЯ» (T-140) — соединяй двух одинаковых: яйцо → птенец → ящерка → дракончик → дракон. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md), поле — гнездо 4×4 (DOM). Время — в шагах (60 в секунду).
// Своё: яйца падают в гнездо сами и всё чаще; выросший дракон улетает (клетка освобождается); быстрые слияния подряд —
// серия (+1…+5 сверху); гнездо переполнилось — конец. Партия — 2 минуты.
// Очки: птенец +1, ящерка +3, дракончик +8, дракон +25, и серия: слияние меньше чем через секунду после прошлого — +серия.
// Исправлено против прототипа: Math.random → rng (у соперников одинаковые яйца в те же клетки); «меньше ходов — лучше» и
// тупик без конца (гнездо полное, слить нечего — игра висела) → общий счёт, предел 2 минуты и конец при переполнении;
// дракон оставался в клетке навсегда → улетает.
(() => {
  const T = ArcadeKit.T;
  const N = 16, MAXL = 4, TIME = 120 * 60, FLY = 40, CHAIN = 60;   // шагов: партия, полёт дракона, окно серии
  const SP0 = 132, SPD = 2, SPMIN = 54;                            // шагов между яйцами: в начале, быстрее с каждым яйцом, предел
  const PTS = [0, 1, 3, 8, 25];
  const FACE = ['🥚', '🐣', '🦎', '🐲', '🐉'], NAME = ['Яйцо', 'Птенец', 'Ящерка', 'Дракончик', 'Дракон'];

  function spawn(s){
    let free = 0;
    for (let i = 0; i < N; i++) if (s.g[i] < 0) free++;
    if (!free) { s.over = true; s.why = 'full'; s.snd = 'bad'; s.v++; return; }
    let c = Math.floor(s.rng() * free);
    for (let i = 0; i < N; i++) if (s.g[i] < 0 && c-- === 0) { s.g[i] = 0; s.born = i; break; }
    s.eggs++; s.v++;
  }

  function create(rng){
    const s = { rng, left: TIME, next: SP0, eggs: 0, sel: -1, born: -1, merged: -1, mc: 0, combo: 0, comboT: 0, best: 0, score: 0, dragons: 0,
      over: false, why: '', v: 0, snd: 0, g: new Int8Array(N), fly: new Uint8Array(N) };
    s.g.fill(-1);
    for (let i = 0; i < 4; i++) spawn(s);
    s.born = -1;
    return s;
  }

  function input(s, e){
    if (s.over || e.type !== T.PICK) return;
    const k = e.k;
    if (!(k >= 0 && k < N) || s.fly[k]) return;
    const a = s.sel, L = s.g[k];
    s.v++;
    if (a < 0) { if (L >= 0) { s.sel = k; s.snd = 440; } return; }
    if (a === k) { s.sel = -1; return; }
    if (L < 0) { s.g[k] = s.g[a]; s.g[a] = -1; s.sel = -1; s.snd = 330; return; }   // в пустую клетку — переставить
    if (L !== s.g[a] || L >= MAXL) { s.sel = k; s.snd = 440; return; }
    // слияние: в клетку k вырастает следующий
    s.g[a] = -1; s.g[k] = L + 1; s.sel = -1; s.merged = k; s.mc++;
    s.combo = s.comboT ? Math.min(5, s.combo + 1) : 0;
    s.comboT = CHAIN;
    if (s.combo > s.best) s.best = s.combo;
    s.score += PTS[L + 1] + s.combo;
    s.snd = 392 + 131 * (L + 1);
    if (L + 1 === MAXL) { s.fly[k] = FLY; s.dragons++; s.snd = 'win'; }
  }

  function step(s){
    if (s.over) return;
    if (s.comboT && !--s.comboT) s.combo = 0;
    for (let i = 0; i < N; i++) if (s.fly[i] && !--s.fly[i]) { s.g[i] = -1; s.v++; if (s.sel === i) s.sel = -1; }
    if (--s.left <= 0) { s.left = 0; s.over = true; s.why = 'time'; s.snd = s.dragons ? 'win' : 'ok'; s.v++; return; }
    if (--s.next > 0) return;
    spawn(s);
    s.next = Math.max(SPMIN, SP0 - SPD * s.eggs);
  }

  const CSS = '.ev{display:flex;flex-direction:column;align-items:center;gap:.6rem;padding:.9rem .7rem .8rem;border-radius:14px;background:radial-gradient(circle at 50% 110%,#5a3a1a,#2a1b10 60%,#160e08)}'
    + '.ev-g{width:100%;max-width:340px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:10px;border-radius:22px;background:repeating-linear-gradient(35deg,#8a5a2b 0 8px,#7a4e24 8px 16px);box-shadow:inset 0 0 0 4px #a87035}'
    + '.ev-c{aspect-ratio:1;border:0;border-radius:14px;padding:0;cursor:pointer;background:rgba(40,25,10,.55);font-size:clamp(26px,9vw,40px);line-height:1;touch-action:manipulation;transition:transform .1s,background-color .15s}'
    + '.ev-c.l1{background:#5b4a2a}.ev-c.l2{background:#3f5b2a}.ev-c.l3{background:#2a4f5b}.ev-c.l4{background:#5b2a4f}'
    + '.ev-c.sel{transform:scale(1.08);box-shadow:0 0 0 3px #ffd60a,0 0 14px #ffd60a}'
    + '.ev-c.born{animation:evB .3s ease-out}@keyframes evB{from{transform:translateY(-60%) scale(.6);opacity:.2}}'
    + '.ev-c.mg{animation:evM .25s ease-out}@keyframes evM{50%{transform:scale(1.2)}}'
    + '.ev-c.fly{animation:evF .7s ease-in forwards}@keyframes evF{to{transform:translateY(-180%) scale(1.3);opacity:0}}'
    + '.ev-c:focus-visible{outline:3px solid #7dd3fc;outline-offset:2px}'
    + '.ev-chain{font:600 .82rem system-ui,sans-serif;color:#ffe9b3;min-height:1.2em;font-variant-numeric:tabular-nums}'
    + 'body.low .ev-c{transition:none;animation:none!important}';

  function build(G){
    if (!document.getElementById('evCss')) { const st = document.createElement('style'); st.id = 'evCss'; st.textContent = CSS; document.head.appendChild(st); }
    let h = '<div class="ev"><div class="ev-g">';
    for (let i = 0; i < N; i++) h += '<button type="button" class="ev-c" data-k="' + i + '"></button>';
    G.host.innerHTML = h + '</div><div class="ev-chain"></div></div>';
    G.box = G.host.firstChild;
    G.cells = G.box.querySelector('.ev-g').children;
    G.chain = G.box.querySelector('.ev-chain');
    G.eggs = -1; G.mc = -1;
  }
  function restart(el, c){ el.classList.remove(c); void el.offsetWidth; el.classList.add(c); }

  function draw(G, s){
    for (let i = 0; i < N; i++) {
      const c = G.cells[i], L = s.g[i];
      c.textContent = L >= 0 ? FACE[L] : '';
      for (let l = 1; l <= MAXL; l++) c.classList.toggle('l' + l, L === l);
      c.classList.toggle('sel', s.sel === i);
      c.classList.toggle('fly', s.fly[i] > 0);
      c.setAttribute('aria-label', L >= 0 ? NAME[L] : 'Пусто');
    }
    // анимации появления и слияния — один раз на событие (счётчики яиц и слияний)
    if (s.eggs !== G.eggs) { G.eggs = s.eggs; if (s.born >= 0) restart(G.cells[s.born], 'born'); }
    if (s.mc !== G.mc) { G.mc = s.mc; if (s.merged >= 0) restart(G.cells[s.merged], 'mg'); }
    G.chain.textContent = s.over ? (s.why === 'full' ? 'Гнездо переполнилось!' : 'Время вышло') : s.combo ? 'Серия ×' + s.combo + '! +' + s.combo : 'Соединяй двух одинаковых — вырастет следующий';
  }

  ArcadeKit.define('evolve', {
    kind: 'dom', W: 320, H: 380, maxW: 400,
    title: '🐉 Эволюция',
    intro: 'В гнездо падают яйца — всё чаще. Нажми на двух одинаковых: 🥚+🥚 → 🐣, дальше 🦎, 🐲 и 🐉. Дракон улетает и освобождает место. Гнездо переполнится — конец. 2 минуты.',
    controls: 'Нажми одного, потом второго такого же. Нажатие на пустую клетку переставит выбранного. Слияния подряд быстрее секунды — серия.',
    duelTitle: 'Одинаковые яйца у обоих',
    create, input, step, draw, build,
    hudKey: s => s.dragons * 1000 + Math.ceil(s.left / 60),
    hud: s => '🐉 ' + s.dragons + ' · ⏱ ' + Math.floor(Math.ceil(s.left / 60) / 60) + ':' + String(Math.ceil(s.left / 60) % 60).padStart(2, '0'),
    win: s => s.dragons >= 2,
    result: s => ({
      title: s.dragons >= 4 ? '🐉 Повелитель драконов!' : s.dragons >= 2 ? '🎉 Драконы летят!' : s.why === 'full' ? '🥚 Гнездо переполнилось' : '⏰ Время вышло',
      text: 'драконов: ' + s.dragons + (s.best ? ' · лучшая серия ×' + s.best : ''),
    }),
    consts: { N, MAXL, TIME, FLY, CHAIN, SP0, SPD, SPMIN, PTS },
  });
})();
