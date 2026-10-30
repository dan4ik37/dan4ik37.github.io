// ═══════════════════════════════════════
//  ИГРА «СВЕТ В ОКНАХ» (T-140) — уложи дом спать: нажатие переключает окно и соседей крестом. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md), поле — кнопки-окна (DOM). Ночь — 5 домов (3×3 … 5×5) за 2 минуты.
// Дом собирается из погашенного «норма» нажатиями по разным окнам (генератор — rng), значит, всегда решается не дольше нормы.
// Очки за дом: 100 + 25 за каждое нажатие меньше нормы − 10 за каждое сверх (не меньше 20); уложился в норму — ⭐.
// Все 5 домов — бонус 3 очка за каждую оставшуюся секунду. Время — в шагах (60 в секунду), паузы между домами — тоже.
// Исправлено против прототипа: ходы считались «меньше — лучше» и без конца партии — для соревнования теперь общий счёт
// (больше — лучше) и общий предел времени; уровень из Math.random → из rng (у соперников одинаковые дома).
(() => {
  const T = ArcadeKit.T;
  const HOUSES = [[3, 3], [4, 4], [4, 5], [5, 6], [5, 8]];   // [сторона, норма нажатий]
  const TIME = 120 * 60, WAIT = 45;                          // шагов: вся ночь (2 мин) и пауза «дом уснул»

  function toggle(g, n, k){
    const x = k % n, y = (k / n) | 0;
    g[k] ^= 1;
    if (x > 0) g[k - 1] ^= 1;
    if (x < n - 1) g[k + 1] ^= 1;
    if (y > 0) g[k - n] ^= 1;
    if (y < n - 1) g[k + n] ^= 1;
  }
  function lit(g, n){ let c = 0; for (let i = 0; i < n * n; i++) c += g[i]; return c; }

  function gen(s){
    const H = HOUSES[s.house], n = H[0], par = H[1], g = s.g, P = s.perm;
    s.n = n; s.par = par; s.moves = 0; s.last = -1;
    do {
      g.fill(0);
      for (let i = 0; i < n * n; i++) P[i] = i;
      for (let i = 0; i < par; i++) {
        const j = i + Math.floor(s.rng() * (n * n - i)), t = P[i];
        P[i] = P[j]; P[j] = t;
        toggle(g, n, P[i]);
        s.sol[i] = P[i];
      }
    } while (!lit(g, n));
    s.v++;
  }

  function create(rng){
    const s = { rng, house: 0, n: 3, par: 3, moves: 0, last: -1, score: 0, stars: 0, solved: 0, gain: 0, bonus: 0,
      left: TIME, wait: 0, over: false, v: 0, snd: 0,
      g: new Uint8Array(25), perm: new Uint8Array(25), sol: new Int8Array(8) };
    gen(s);
    return s;
  }

  function input(s, e){
    if (e.type !== T.PICK || s.over || s.wait) return;
    const k = e.k, n = s.n;
    if (!(k >= 0 && k < n * n)) return;
    toggle(s.g, n, k);
    s.moves++; s.last = k; s.v++;
    s.snd = s.g[k] ? 659 : 494;
    if (lit(s.g, n)) return;
    // дом уснул
    s.gain = Math.max(20, 100 + 25 * Math.max(0, s.par - s.moves) - 10 * Math.max(0, s.moves - s.par));
    s.score += s.gain; s.solved++;
    if (s.moves <= s.par) s.stars++;
    s.wait = WAIT; s.snd = 'ok';
  }

  function step(s){
    if (s.over) return;
    if (s.wait) {
      if (--s.wait) return;
      if (s.house + 1 < HOUSES.length) { s.house++; gen(s); return; }
      s.bonus = 3 * Math.ceil(s.left / 60);
      s.score += s.bonus; s.v++;
      s.over = true; s.snd = 'win';
      return;
    }
    if (--s.left <= 0) { s.left = 0; s.over = true; s.snd = 'bad'; s.v++; }
  }

  const CSS = '.lt{display:flex;flex-direction:column;align-items:center;gap:.55rem;padding:1rem .6rem .8rem;border-radius:14px;'
    + 'background:radial-gradient(1px 1px at 12% 18%,#fff9 50%,#0000),radial-gradient(1px 1px at 70% 10%,#fff8 50%,#0000),radial-gradient(1.5px 1.5px at 88% 30%,#fffa 50%,#0000),'
    + 'radial-gradient(1px 1px at 30% 6%,#fff7 50%,#0000),linear-gradient(#0a0f2c,#1b1342)}'
    + '.lt-moon{align-self:flex-end;margin:-.4rem .4rem -1.6rem 0;font-size:1.5rem;opacity:.85;transition:opacity .3s}'
    + '.lt-roof{width:92%;aspect-ratio:5/1.3;background:linear-gradient(#7a3247,#5a2235);clip-path:polygon(50% 0,100% 100%,0 100%)}'
    + '.lt-wall{width:84%;margin-top:-1px;background:#3a2d55;border-radius:0 0 8px 8px;padding:6%;display:grid;grid-template-columns:repeat(var(--n),1fr);gap:.45rem}'
    + '.lt-win{aspect-ratio:1;border:2px solid #171128;border-radius:6px;background:#121a36;cursor:pointer;padding:0;position:relative;'
    + 'transition:background-color .12s,box-shadow .12s;touch-action:manipulation}'
    + '.lt-win::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(#0000 46%,#171128 46% 54%,#0000 54%),linear-gradient(90deg,#0000 46%,#171128 46% 54%,#0000 54%)}'
    + '.lt-win.on{background:radial-gradient(circle at 50% 40%,#fff6c2,#ffc233 72%);box-shadow:0 0 14px rgba(255,194,51,.55)}'
    + '.lt-win:focus-visible{outline:3px solid #7dd3fc;outline-offset:2px}'
    + '.lt.sleep .lt-wall{filter:brightness(.85)}.lt.sleep .lt-moon{opacity:1}'
    + '.lt-msg{font-size:.8rem;color:#d9d5f5;min-height:1.2em;font-variant-numeric:tabular-nums}'
    + 'body.low .lt-win{transition:none}';

  function build(G){
    if (!document.getElementById('ltCss')) { const st = document.createElement('style'); st.id = 'ltCss'; st.textContent = CSS; document.head.appendChild(st); }
    G.host.innerHTML = '<div class="lt"><div class="lt-moon">🌙</div><div class="lt-roof"></div><div class="lt-wall"></div><div class="lt-msg"></div></div>';
    G.box = G.host.firstChild;
    G.wall = G.box.querySelector('.lt-wall');
    G.msg = G.box.querySelector('.lt-msg');
    G.n = -1; G.house = -1; G.cells = null;
  }

  function draw(G, s){
    if (G.n !== s.n || G.house !== s.house) {
      G.n = s.n; G.house = s.house;
      G.wall.style.setProperty('--n', s.n);
      let h = '';
      for (let i = 0; i < s.n * s.n; i++) h += '<button type="button" class="lt-win" data-k="' + i + '" aria-label="Окно ' + (i + 1) + '"></button>';
      G.wall.innerHTML = h;
      G.cells = G.wall.children;
    }
    for (let i = 0; i < s.n * s.n; i++) G.cells[i].classList.toggle('on', s.g[i] === 1);
    G.box.classList.toggle('sleep', !!s.wait || (s.over && !lit(s.g, s.n)));
    G.msg.textContent = s.wait ? 'Дом ' + (s.house + 1) + ' уснул 🌙 +' + s.gain + (s.moves <= s.par ? ' ⭐' : '')
      : s.over ? (s.solved === HOUSES.length ? 'Квартал спит. Бонус за время: +' + s.bonus : 'Утро наступило ☀️')
        : 'Ходов: ' + s.moves + ' · норма: ' + s.par;
  }

  const clock = n => { const sec = Math.ceil(n / 60); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

  ArcadeKit.define('lights', {
    kind: 'dom', W: 320, H: 400, maxW: 400,
    title: '💡 Свет в окнах',
    intro: 'Ночь, а в домах горит свет. Нажатие на окно переключает его и соседей сверху, снизу, слева и справа. Погаси все окна — дом уснёт. 5 домов за 2 минуты.',
    controls: 'Нажимай на окна. На клавиатуре — Tab по окнам и Enter. Уложился в норму нажатий — ⭐ и больше очков.',
    duelTitle: 'Одинаковые дома у обоих',
    create, input, step, draw, build,
    hudKey: s => s.house * 1e6 + s.stars * 1e4 + Math.ceil(s.left / 60),
    hud: s => '🏠 ' + (s.house + 1) + '/' + HOUSES.length + ' · ⭐ ' + s.stars + ' · ⏱ ' + clock(s.left),
    win: s => s.solved === HOUSES.length,
    result: s => ({
      title: s.solved === HOUSES.length ? '🌙 Весь квартал спит!' : '⏰ Утро — не успел',
      text: 'домов: ' + s.solved + '/' + HOUSES.length + ' · ⭐ ' + s.stars + (s.bonus ? ' · за время +' + s.bonus : ''),
    }),
    consts: { HOUSES, TIME, WAIT },
  });
})();
