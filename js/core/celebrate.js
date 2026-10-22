// ═══════════════════════════════════════
//  ПРАЗДНИКИ НА САЙТЕ И В ИГРАХ (D37Celebrate; 16.10.2026, docs/SEASONS.md): салют, конфетти, обратный отсчёт, поздравления
//  поверх всего (3D, 2D, обычные страницы); «🎄 Новогоднее задание» (1–31 декабря) и вкладка ⚙️ «🌦 Погода»
// ═══════════════════════════════════════
// Праздники и даты — D37E.climate (js/engine/climate.js: C.HOLIDAYS, C.holidays, C.advent) по МЕСТНОМУ времени игрока.
// Раз в секунду: C.tick → фаза праздника: 'pre' — отсчёт (только Новый год: последние 10 с), 'burst' — салют (первые минуты),
// 'day' — открыл сайт в праздник — поздравление один раз за день. Торжественные (стиль calm) — только поздравление.
// API: D37Celebrate.show(id | праздник, { big }), fireworks(n, стиль), confetti(n, стиль), countdown(сек), stop(), decor(id) →
// крючки украшений; onAdventDone(день, задание) — крючок для своих дел; награду за день забирает сам (advent_claim в games-more.sql:
// раз за день, проверка на сервере; 20 дней — ⛄; ADVENT ↔ advent_task, scripts/economy-test.cjs сверяет; docs/SEASONS.md §9).
// Холст поверх всего (z 100250: выше полного экрана игр и «Студии 3D», ниже окон ⚙️ и телефона), нажатия проходят сквозь.
// «Экономный» режим и prefers-reduced-motion — меньше частиц, без вспышек. ⚙️ «Праздники» выкл — ни салюта, ни поздравлений.
// Новогоднее задание: карточка .cel-adv (над HUD игры; свернуть можно, убрать нельзя), на главной — полоса .cel-ban; задание
// дня — ADVENT (31); выполнено — события d37:game (games.js), переходы #/…, d37:chatmsg (свой), d37:advent { kind } (игры).
// Прогресс — localStorage d37_advent { y, done: { день: время }, col }. В 00:00 1 января по местному — праздник.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37Celebrate) return;
  const doc = root.document;
  const C = () => root.D37E?.climate || null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k, d) => { try { const v = JSON.parse(root.localStorage?.getItem(k) || 'null'); return v ?? d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { root.localStorage?.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const S = () => root.D37Settings || null;
  const setting = (k, d) => { try { const v = S()?.get?.(k); return v === undefined ? d : v; } catch (e) { return d; } };
  const holidaysOn = () => setting('holidays', true) !== false;
  const low = () => !!doc?.body?.classList.contains('low') || !!root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const mobile = () => !!root.D37E?.isMobile?.() || (root.innerWidth || 1024) < 700;

  // ═══ Новогоднее задание: 31 задание (день декабря → что сделать). kind: play | win | game:<id через |> | route:<начало #/…>
  //     | chat | wish (кнопка); n — сколько раз (разных игр — для play) ═══
  const ADVENT = [
    ['🎮', 'Сыграй в любую игру на сайте', 'play'], ['🌍', 'Загляни в «Мир Денчика»', 'route:#/games/world'], ['🎭', 'Переодень персонажа к зиме — гардероб', 'route:#/games/wardrobe'],
    ['🔤', 'Отгадай слово дня в «5 букв»', 'game:words'], ['🏆', 'Победи в любой игре', 'win'], ['💬', 'Напиши в чат что-нибудь доброе', 'chat'],
    ['🧊', 'Построй что-нибудь в «Кубомире»', 'route:#/games/kubomir'], ['📺', 'Посмотри Shorts на сайте', 'route:#/shorts'], ['🧩', 'Реши судоку', 'game:sudoku'],
    ['👥', 'Позови друга — «Мои приглашения»', 'route:#/invite'], ['🎨', 'Загляни в «Студию 3D»', 'route:#/games/studio3d'], ['♟️', 'Сыграй в шахматы или шашки', 'game:chess|checkers'],
    ['🃏', 'Сыграй в «Дурака» или «Одна!»', 'game:durak|uno'], ['🐉', 'Продержись в «Орде»', 'game:horde'], ['🧱', 'Сыграй в «Блоки»', 'game:blocks'],
    ['⛏', 'Спустись в «Подземье»', 'route:#/games/podzem'], ['🏰', 'Отбей волну в «Башнях»', 'game:td'], ['🔎', 'Найди слова в «Филворде»', 'game:fillword'],
    ['🎱', 'Сыграй в бильярд', 'game:pool'], ['🂡', 'Разложи пасьянс', 'game:kosynka|pauk|freecell'], ['🖍', 'Нарисуй или угадай в «Крокодиле»', 'game:krokodil'],
    ['🏅', 'Посмотри свой профиль и ачивки', 'route:#/profile'], ['💣', 'Сыграй в «Сапёра»', 'game:miner'], ['🀄', 'Пройди уровень маджонга', 'game:mahjong'],
    ['🎯', 'Сыграй в «Арену»', 'game:arena'], ['💡', 'Загляни в «Идеи» и поддержи чью-нибудь', 'route:#/ideas'], ['📈', 'Посмотри рекорды недели в играх', 'route:#/games'],
    ['🎲', 'Сыграй в 3 разные игры', 'play', 3], ['🥇', 'Победи 2 раза', 'win', 2], ['📱', 'Открой телефон и посмотри приложения', 'route:#/phone'],
    ['🎆', 'Загадай желание — и жди полночи!', 'wish'],
  ].map(([icon, text, kind, n], i) => ({ day: i + 1, icon, text, kind, n: n || 1 }));

  // ═══ Звук: движок (если игра его загрузила) или свой маленький синтез шумом ═══
  let AC = null, noiseB = null;
  const muted = () => { const O = root.D37Opt; if (O?.mute) return true; try { return root.localStorage?.getItem('d37_games_mute') === '1' && !!doc?.body?.classList.contains('game-on'); } catch (e) { return false; } };
  const gain0 = () => { const O = root.D37Opt; return O ? (O.vol ?? 1) * (O.volFx ?? 1) : 1; };
  const wake = () => { try { if (!AC) { const K = root.AudioContext || root.webkitAudioContext; if (!K) return; AC = new K(); } if (AC.state === 'suspended') AC.resume().catch(() => {}); } catch (e) {} };
  if (root.addEventListener) { root.addEventListener('pointerdown', wake, { passive: true }); root.addEventListener('keydown', wake); }
  function snd(kind, vol = 1){
    if (muted() || !holidaysOn()) return;
    const A = root.D37E?.synth && root.D37E?.audio ? root.D37E.audio() : null;
    if (A) { A.play('fw_' + kind, { vol: .45 * vol, rate: .9 + Math.random() * .2 }); return; }
    if (!AC || AC.state !== 'running') return;
    try {
      if (!noiseB) { noiseB = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); const d = noiseB.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      const t = AC.currentTime, src = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
      src.buffer = noiseB; src.loop = true; src.connect(f); f.connect(g); g.connect(AC.destination);
      const G = .35 * vol * gain0();
      if (kind === 'launch') { f.type = 'bandpass'; f.Q.value = 8; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(3600, t + .8); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(G * .5, t + .2); g.gain.linearRampToValueAtTime(0, t + .85); src.start(t); src.stop(t + .9); }
      else if (kind === 'boom') { f.type = 'lowpass'; f.frequency.value = 260; g.gain.setValueAtTime(G * 1.6, t); g.gain.exponentialRampToValueAtTime(.001, t + 1.3); src.start(t); src.stop(t + 1.35); }
      else { f.type = 'highpass'; f.frequency.value = 2500; g.gain.setValueAtTime(0, t); for (let i = 0; i < 14; i++) { const a = t + i * .05 + Math.random() * .02; g.gain.setValueAtTime(G * .5, a); g.gain.exponentialRampToValueAtTime(.001, a + .025); } src.start(t); src.stop(t + .8); }
    } catch (e) {}
  }

  // ═══ Холст: салют, конфетти, лепестки, фонарики, капли ═══
  const STYLE = {
    fireworks: { cols: ['#ff4d6d', '#ffd23f', '#4cc9f0', '#c77dff', '#7cf29c', '#ffffff', '#ff9f1c'], conf: 'confetti' },
    light: { cols: ['#ffe8a3', '#ffffff', '#ffd23f', '#bde0fe'], conf: 'confetti' },
    lanterns: { cols: ['#ff3b30', '#ffcc00', '#ff9500', '#ffd60a'], conf: 'lanterns' },
    spring: { cols: ['#ffc8dd', '#ffafcc', '#ffffff', '#b9fbc0', '#ffd166', '#00afca', '#fec50c'], conf: 'petals' },
    water: { cols: ['#4cc9f0', '#4895ef', '#a0e7ff', '#ffffff'], conf: 'drops' },
    flowers: { cols: ['#ffd23f', '#ffe066', '#fff3b0', '#7cf29c'], conf: 'petals' },
    pumpkin: { cols: ['#ff8c00', '#ffb347', '#8e44ad', '#c39bd3', '#7cf29c'], conf: 'confetti' },
    calm: { cols: ['#ffffff'], conf: '' },
  };
  const NMAX = 1400;
  const P = { x: new Float32Array(NMAX), y: new Float32Array(NMAX), vx: new Float32Array(NMAX), vy: new Float32Array(NMAX), life: new Float32Array(NMAX), max: new Float32Array(NMAX),
    size: new Float32Array(NMAX), rot: new Float32Array(NMAX), vr: new Float32Array(NMAX), type: new Uint8Array(NMAX), col: new Array(NMAX).fill('#fff'), n: 0 };
  const rockets = [];
  let cv = null, g2 = null, raf = 0, last = 0, W = 0, H = 0, dpr = 1, auto = null;
  const CSS = `.cel-fx{position:fixed;inset:0;width:100%;height:100%;z-index:100250;pointer-events:none}
.cel-card{position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:100260;width:max-content;max-width:min(92vw,560px);padding:3px;border-radius:22px;background:linear-gradient(135deg,#ff4d6d,#ffd23f,#4cc9f0,#c77dff);box-shadow:0 18px 50px rgba(0,0,0,.45);animation:celIn .6s cubic-bezier(.2,1.4,.4,1) both;cursor:pointer}
.cel-card-in{position:relative;padding:16px 46px 16px 22px;border-radius:19px;background:rgba(14,12,30,.92);color:#fff;text-align:center;font:600 15px/1.35 Montserrat,system-ui,sans-serif}
.cel-card b{display:block;font-size:clamp(22px,5vw,34px);font-weight:900}.cel-card span{display:block;margin-top:6px;color:#e5e7ff;opacity:.92}
.cel-x{position:absolute;top:8px;right:10px;border:0;background:rgba(255,255,255,.14);color:#fff;border-radius:50%;width:28px;height:28px;cursor:pointer}
.cel-card.out{animation:celOut .6s ease both}
.cel-lanterns{background:linear-gradient(135deg,#ff3b30,#ffcc00,#ff9500)}.cel-spring{background:linear-gradient(135deg,#00afca,#fec50c,#ffafcc)}.cel-water{background:linear-gradient(135deg,#4cc9f0,#4895ef,#a0e7ff)}
.cel-calm{background:linear-gradient(135deg,#c7d2fe,#a5b4fc)}.cel-flowers{background:linear-gradient(135deg,#ffd23f,#7cf29c)}.cel-pumpkin{background:linear-gradient(135deg,#ff8c00,#8e44ad)}.cel-light{background:linear-gradient(135deg,#ffe8a3,#bde0fe)}
.cel-count{position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);z-index:100260;pointer-events:none;font:900 clamp(80px,22vw,200px)/1 Montserrat,system-ui,sans-serif;color:#fff;text-shadow:0 0 30px rgba(255,210,63,.9),0 6px 24px rgba(0,0,0,.6)}
.cel-count.beat{animation:celBeat .9s ease both}
@keyframes celIn{from{opacity:0;transform:translate(-50%,-20px) scale(.9)}to{opacity:1;transform:translate(-50%,0) scale(1)}}
@keyframes celOut{to{opacity:0;transform:translate(-50%,-14px) scale(.96)}}
@keyframes celBeat{0%{opacity:0;transform:translate(-50%,-50%) scale(1.6)}25%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:.15;transform:translate(-50%,-50%) scale(.85)}}
.cel-adv{position:fixed;left:10px;top:var(--cel-top,70px);z-index:100100;max-width:min(330px,calc(100vw - 20px));padding:8px 10px;border-radius:14px;background:rgba(16,24,48,.9);border:1px solid rgba(147,197,253,.4);color:#e8f0ff;font:12.5px/1.35 Montserrat,system-ui,sans-serif;box-shadow:0 10px 26px rgba(0,0,0,.35);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);cursor:default}
html.gs-full .cel-adv{--cel-top:8px}
.cel-adv.col{padding:0;background:none;border:0;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none}
.cel-adv-pill{border:1px solid rgba(147,197,253,.5);background:rgba(16,24,48,.88);color:#fff;border-radius:999px;padding:5px 11px;font:700 12px Montserrat,system-ui,sans-serif;cursor:pointer;font-variant-numeric:tabular-nums}
.cel-adv-h{display:flex;align-items:center;gap:6px}.cel-adv-h b{flex:1}.cel-adv-h span{font-variant-numeric:tabular-nums;color:#ffd23f;font-weight:800}
.cel-adv-c{border:0;background:rgba(255,255,255,.12);color:#fff;border-radius:7px;padding:1px 7px;cursor:pointer}
.cel-adv-t{margin:5px 0}.cel-adv.ok .cel-adv-t{color:#7cf29c}
.cel-adv-f{display:flex;align-items:center;gap:6px;min-height:18px}.cel-adv-f i{display:block;height:6px;border-radius:3px;background:linear-gradient(90deg,#4cc9f0,#7cf29c);min-width:4px;max-width:150px;flex:none}.cel-adv-f small{opacity:.8}
.cel-adv-w{margin-left:auto;border:0;background:#ffd23f;color:#1b1b2f;border-radius:8px;padding:2px 8px;font-weight:800;cursor:pointer}
.cel-adv-s{margin-left:auto;white-space:nowrap;color:#ffd23f}.cel-adv-w+.cel-adv-s{margin-left:0}
.cel-adv.done{pointer-events:none;display:flex;flex-direction:column}
body.cel-ban-on .cel-adv{display:none}
.cel-ban{margin:10px auto 0;max-width:1100px;width:calc(100% - 32px);box-sizing:border-box;padding:10px 16px;border-radius:14px;background:linear-gradient(90deg,rgba(76,201,240,.18),rgba(199,125,255,.18));border:1px solid rgba(147,197,253,.35);display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}
.cel-ban b{font-size:16px}.cel-ban span{opacity:.92}.cel-ban i{font-style:normal;font-weight:800;color:#ffd23f;font-variant-numeric:tabular-nums}
.cel-ban.cel-spring{background:linear-gradient(90deg,rgba(0,175,202,.22),rgba(254,197,12,.2))}
.cel-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:100260;padding:9px 16px;border-radius:12px;background:rgba(16,24,48,.95);color:#fff;font:700 13px Montserrat,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4);animation:celIn .4s ease both}
.cel-toast.out{animation:celOut .5s ease both}
@media (max-width:640px){.cel-adv{left:6px;font-size:12px;max-width:calc(100vw - 12px)}.cel-card-in{padding:12px 40px 12px 14px}}
@media (prefers-reduced-motion:reduce){.cel-card,.cel-count.beat,.cel-toast{animation:none}}`;
  function style(){ if (!doc?.head || doc.getElementById('cel-css')) return; const st = doc.createElement('style'); st.id = 'cel-css'; st.textContent = CSS; doc.head.appendChild(st); }
  function canvas(){
    style();
    if (cv || !doc?.body) return cv;
    cv = doc.createElement('canvas'); cv.className = 'cel-fx'; cv.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(cv); g2 = cv.getContext('2d');
    return cv;
  }
  function fit(){ dpr = Math.min(2, root.devicePixelRatio || 1); W = root.innerWidth || 800; H = root.innerHeight || 600; if (cv) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); } }
  const cap = () => low() ? 260 : mobile() ? 600 : NMAX;
  function add(type, x, y, vx, vy, life, size, col){
    if (P.n >= cap()) return -1;
    const i = P.n++;
    P.x[i] = x; P.y[i] = y; P.vx[i] = vx; P.vy[i] = vy; P.life[i] = P.max[i] = life; P.size[i] = size; P.rot[i] = Math.random() * 6.283; P.vr[i] = (Math.random() - .5) * 8; P.type[i] = type; P.col[i] = col;
    return i;
  }
  const pick = a => a[Math.random() * a.length | 0];
  function burst(x, y, style){
    const st = STYLE[style] || STYLE.fireworks, n = low() ? 36 : mobile() ? 60 : 90, c1 = pick(st.cols), c2 = pick(st.cols), sp = (120 + Math.random() * 90) * Math.min(1.4, Math.max(.7, W / 900));
    for (let k = 0; k < n; k++) { const a = k / n * 6.283 + Math.random() * .1, v = sp * (.55 + Math.random() * .5); add(0, x, y, Math.cos(a) * v, Math.sin(a) * v, 1.1 + Math.random() * .7, 2 + Math.random() * 1.6, k % 3 ? c1 : c2); }
    snd('boom', .8 + Math.random() * .3); if (!low() && Math.random() < .6) setTimeout(() => snd('crackle', .6), 250);
    if (!low() && style !== 'lanterns') flash = Math.min(.35, flash + .18);
  }
  function rocket(style){
    if (!canvas()) return;
    const x = W * (.12 + Math.random() * .76), y = H + 10, tgt = H * (.18 + Math.random() * .3);
    rockets.push({ x, y, vx: (Math.random() - .5) * 40, vy: -Math.sqrt(2 * 420 * (y - tgt)), style, t: 0 });
    snd('launch', .7);
    run();
  }
  function confetti(n = 120, style = 'fireworks'){
    if (!canvas()) return;
    const st = STYLE[style] || STYLE.fireworks, kind = st.conf || 'confetti', m = Math.round(n * (low() ? .35 : mobile() ? .6 : 1));
    for (let k = 0; k < m; k++) {
      const col = pick(st.cols);
      if (kind === 'lanterns') add(3, W * Math.random(), H + 20 + Math.random() * H * .5, (Math.random() - .5) * 12, -(28 + Math.random() * 30), 9 + Math.random() * 5, 9 + Math.random() * 8, col);
      else if (kind === 'drops') add(4, W * Math.random(), H * (.55 + Math.random() * .5), (Math.random() - .5) * 160, -(260 + Math.random() * 260), 2.2 + Math.random(), 3 + Math.random() * 3, col);
      else add(kind === 'petals' ? 2 : 1, W * Math.random(), -20 - Math.random() * H * .6, (Math.random() - .5) * 40, 40 + Math.random() * 70, 6 + Math.random() * 4, kind === 'petals' ? 5 + Math.random() * 4 : 4 + Math.random() * 4, col);
    }
    run();
  }
  let flash = 0;
  function run(){ if (!raf) { fit(); last = performance.now(); raf = requestAnimationFrame(tick); } }
  function tick(now){
    raf = 0;
    const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now;
    if (!cv) return;
    if (cv.width !== Math.round((root.innerWidth || 800) * Math.min(2, root.devicePixelRatio || 1))) fit();
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.clearRect(0, 0, W, H);
    if (flash > .005) { g2.fillStyle = `rgba(255,240,210,${flash * .25})`; g2.fillRect(0, 0, W, H); flash *= Math.exp(-dt * 6); } else flash = 0;
    // ракеты: взлёт со следом, на вершине — взрыв
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i]; r.t += dt; r.vy += 420 * dt; r.x += r.vx * dt; r.y += r.vy * dt;
      if (P.n < cap() && Math.random() < .8) add(0, r.x, r.y, (Math.random() - .5) * 20, 20 + Math.random() * 20, .35, 1.6, '#ffd9a0');
      if (r.vy >= -30 || r.t > 2.4) { burst(r.x, r.y, r.style); rockets.splice(i, 1); }
    }
    g2.globalCompositeOperation = 'lighter';
    let j = 0;
    for (let i = 0; i < P.n; i++) {
      const tp = P.type[i];
      P.life[i] -= dt;
      if (P.life[i] <= 0 || P.y[i] > H + 60 || P.y[i] < -H) continue;
      // движение
      if (tp === 0) { P.vy[i] += 140 * dt; P.vx[i] *= 1 - 1.4 * dt; P.vy[i] *= 1 - 1.4 * dt; }
      else if (tp === 1 || tp === 2) { P.vx[i] += Math.sin(now / 400 + i) * 20 * dt; P.rot[i] += P.vr[i] * dt; }
      else if (tp === 3) P.vx[i] = Math.sin(now / 900 + i) * 10;
      else if (tp === 4) P.vy[i] += 520 * dt;
      P.x[i] += P.vx[i] * dt; P.y[i] += P.vy[i] * dt;
      // копия в j (плотный массив)
      if (j !== i) { P.x[j] = P.x[i]; P.y[j] = P.y[i]; P.vx[j] = P.vx[i]; P.vy[j] = P.vy[i]; P.life[j] = P.life[i]; P.max[j] = P.max[i]; P.size[j] = P.size[i]; P.rot[j] = P.rot[i]; P.vr[j] = P.vr[i]; P.type[j] = tp; P.col[j] = P.col[i]; }
      const a = Math.max(0, Math.min(1, P.life[j] / P.max[j] * (tp === 0 ? 1.3 : 3))), s = P.size[j];
      g2.globalAlpha = a; g2.fillStyle = P.col[j];
      if (tp === 0) { g2.beginPath(); g2.arc(P.x[j], P.y[j], s * (.6 + .4 * a), 0, 6.283); g2.fill(); }
      else if (tp === 1) { g2.globalCompositeOperation = 'source-over'; g2.save(); g2.translate(P.x[j], P.y[j]); g2.rotate(P.rot[j]); g2.fillRect(-s / 2, -s / 4, s, s / 2); g2.restore(); g2.globalCompositeOperation = 'lighter'; }
      else if (tp === 2) { g2.globalCompositeOperation = 'source-over'; g2.beginPath(); g2.ellipse(P.x[j], P.y[j], s, s * .55, P.rot[j], 0, 6.283); g2.fill(); g2.globalCompositeOperation = 'lighter'; }
      else if (tp === 3) { g2.globalAlpha = a * .35; g2.beginPath(); g2.arc(P.x[j], P.y[j], s * 2.2, 0, 6.283); g2.fill(); g2.globalAlpha = a; g2.fillRect(P.x[j] - s * .5, P.y[j] - s * .7, s, s * 1.3); }
      else { g2.beginPath(); g2.arc(P.x[j], P.y[j], s, 0, 6.283); g2.fill(); }
      j++;
    }
    P.n = j;
    g2.globalAlpha = 1; g2.globalCompositeOperation = 'source-over';
    if (auto && now < auto.until) { if (now >= auto.next) { rocket(auto.style); auto.next = now + auto.every * (.6 + Math.random() * .8); } }
    else if (auto && now >= auto.until) auto = null;
    if (P.n || rockets.length || auto || flash) raf = requestAnimationFrame(tick);
    else g2.clearRect(0, 0, W, H);
  }
  // салют на sec секунд: ракета раз в every мс
  function fireworks(sec = 20, style = 'fireworks', big = true){
    if (!holidaysOn() || !canvas()) return;
    const now = performance.now();
    auto = { style, until: now + sec * 1000, next: now, every: big ? (low() ? 1400 : 650) : (low() ? 2600 : 1600) };
    run();
  }

  // ═══ Поздравление и отсчёт (DOM поверх холста) ═══
  let card = null, cardT = 0, count = null;
  function greet(h, o = {}){
    if (!doc?.body || !holidaysOn()) return;
    style();
    const hd = typeof h === 'string' ? C()?.HOLIDAYS.find(x => x.id === h) : h;
    if (!hd) return;
    card?.remove(); clearTimeout(cardT);
    const st = hd.style || 'fireworks', sub = o.sub || hd.sub || '';
    card = doc.createElement('div'); card.className = 'cel-card cel-' + st; card.setAttribute('role', 'status');
    card.innerHTML = `<div class="cel-card-in"><b>${esc(hd.greet || hd.name)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}<button type="button" class="cel-x" aria-label="Закрыть">✕</button></div>`;
    card.addEventListener('click', () => { card?.remove(); card = null; });
    doc.body.appendChild(card);
    cardT = setTimeout(() => { card?.classList.add('out'); setTimeout(() => { card?.remove(); card = null; }, 600); }, (o.sec || 9) * 1000);
  }
  function countdown(sec){
    if (!doc?.body || !holidaysOn()) return;
    const n = Math.max(0, Math.ceil(sec));
    style();
    if (!count) { count = doc.createElement('div'); count.className = 'cel-count'; count.setAttribute('aria-live', 'assertive'); doc.body.appendChild(count); }
    if (count.dataset.n !== String(n)) { count.dataset.n = String(n); count.textContent = n > 0 ? String(n) : '🎆'; count.classList.remove('beat'); void count.offsetWidth; count.classList.add('beat'); if (n > 0 && n <= 10) snd('crackle', .25); }
    if (n <= 0) setTimeout(() => { count?.remove(); count = null; }, 1200);
  }
  // праздник целиком: поздравление + салют/конфетти по стилю
  function show(h, o = {}){
    const C0 = C(); const hd = typeof h === 'string' ? C0?.HOLIDAYS.find(x => x.id === h) : h?.h || h;
    if (!hd || !holidaysOn()) return;
    greet(hd, { sub: h?.sub, sec: o.big ? 12 : 8 });
    const st = hd.style || 'fireworks';
    if (st === 'calm') return;   // торжественные — только поздравление
    if (hd.fireworks === 'big' && o.big !== false) { fireworks(o.sec || (o.big ? 60 : 12), st, true); confetti(140, st); }
    else if (hd.fireworks === 'small') { fireworks(o.sec || 8, st, false); confetti(90, st); }
    else confetti(110, st);
  }

  // ═══ Расписание: раз в секунду — фаза праздников (C.tick) ═══
  const seenKey = 'd37_cel_seen';
  function onHoliday(r){
    if (!r || r.phase === 'end') return;
    if (r.phase === 'pre' && r.h?.countdown) return;   // отсчёт ведёт цикл (каждую секунду)
    const seen = lsGet(seenKey, {}), day = new Date().toDateString(), k = r.id + ':' + r.year;
    if (r.phase === 'burst') {
      if (seen[k + ':burst']) return;
      seen[k + ':burst'] = Date.now(); seen[k + ':day'] = day; lsSet(seenKey, trim(seen));
      const left = (r.start + (r.h.burst || 1) * 60000 - Date.now()) / 1000;
      show(r, { big: r.h.fireworks === 'big', sec: Math.max(8, Math.min(180, left)) });
    } else if (r.phase === 'day') {
      if (seen[k + ':day'] === day) return;
      seen[k + ':day'] = day; lsSet(seenKey, trim(seen));
      setTimeout(() => show(r, { big: false, sec: 6 }), 2500);
    }
  }
  const trim = o => { const ks = Object.keys(o); if (ks.length > 60) for (const k of ks.slice(0, ks.length - 60)) delete o[k]; return o; };
  let timer = 0, subH = null;
  function second(){
    const c = C(); if (!c) return;
    const now = Date.now();
    let L = [];
    try { L = c.tick(now); } catch (e) {}
    // отсчёт к Новому году (последние 10 с)
    const pre = L.find(h => h.phase === 'pre' && h.h?.countdown);
    if (pre && holidaysOn()) countdown(pre.left);
    else if (count && count.dataset.n !== '0') { count.remove(); count = null; }
    advTick(now);
    banner(now, L);
  }
  function start(){
    style();
    if (timer || !C()) return;
    subH = C().on('holiday', onHoliday);
    second();
    timer = setInterval(second, 1000);
    setTimeout(srvSync, 4000);   // декабрь: награды за сделанное без входа (после входа — ещё раз, d37:auth)
  }

  // ═══ Новогоднее задание ═══
  const advLoad = y => { const s = lsGet('d37_advent', null); return s && s.y === y && s.done && typeof s.done === 'object' ? s : { y, done: {}, col: mobile(), plays: [], wins: 0, d: 0 }; };
  let adv = null, advEl = null, advDay = 0;
  const fmtLeft = s => { s = Math.max(0, Math.floor(s)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60, p = v => String(v).padStart(2, '0'); return d ? `${d} дн ${p(h)}:${p(m)}:${p(ss)}` : `${p(h)}:${p(m)}:${p(ss)}`; };
  function advDone(day, how){
    if (!adv || adv.done[day]) return;
    adv.done[day] = Date.now(); lsSet('d37_advent', adv);
    confetti(70, 'light'); snd('crackle', .3);
    toast(`🎁 Задание дня выполнено! ${Object.keys(adv.done).length} из 31`);
    srvClaim(day, true);   // награда с сервера (вошёл); гостю — подсказка войти
    try { API.onAdventDone?.(day, ADVENT[day - 1], how); } catch (e) {}
    advRender(true);
  }
  // ═══ Награды с сервера (games-more.sql: advent_claim / advent_state; T-024). Раз за каждый день; день задания — местный, сервер
  //     принимает соседний день по МСК. Что сервер видит (сыграл, победил, игра, чат) — полная награда, остальное — маленькая;
  //     20 дней из 31 — ⛄ «Снеговик» (питомец навсегда) и монеты. Прогресс в браузере (d37_advent) — как был: сделанное без входа
  //     (сегодня и вчера) заберётся после входа (srvSync) ═══
  const sbc = () => { try { return typeof sbClient !== 'undefined' && sbClient && typeof currentUser !== 'undefined' && currentUser ? sbClient : null; } catch (e) { return null; } };   // eslint-disable-line no-undef
  const noFn = e => e && (e.code === 'PGRST202' || /Could not find the function/i.test(e.message || ''));
  let srv = null, srvOff = false, srvBusy = null, srvGuestHint = false;   // srv: { uid, year, days: Set, total, big, need }
  function srvLoad(force){
    const sb = sbc();
    if (!sb || srvOff) return Promise.resolve(null);
    const uid = currentUser.id;   // eslint-disable-line no-undef
    if (srv && !force && srv.uid === uid) return Promise.resolve(srv);
    if (srvBusy) return srvBusy;
    srvBusy = (async () => {
      try {
        const { data, error } = await sb.rpc('advent_state');
        if (error) { if (noFn(error)) srvOff = true; return null; }
        srv = data?.on && data.auth ? { uid, year: data.year, days: new Set((data.days || []).map(x => x.d)), total: data.total || 0, big: !!data.big, need: data.need || 20 } : null;
        return srv;
      } catch (e) { return null; } finally { srvBusy = null; }
    })();
    return srvBusy;
  }
  const CLAIM_MSG = { new: '🎄 Новогодние награды — со второго дня в аккаунте' };
  async function srvClaim(day, fresh){
    const sb = sbc();
    if (!sb) { if (fresh && !srvGuestHint) { srvGuestHint = true; setTimeout(() => toast('🔑 Войди — и за новогоднее задание будут монеты и ⛄'), 2900); } return null; }
    if (srvOff) return null;
    const s = await srvLoad();
    if (s && s.days.has(day)) return null;
    try {
      const { data, error } = await sb.rpc('advent_claim', { p_day: day });
      if (error) { if (noFn(error)) srvOff = true; return null; }
      if (data?.ok) {
        if (srv) { srv.days.add(day); srv.total = data.total; if (data.big) srv.big = true; }
        const msg = data.big ? `⛄ ${data.total} дней — «Снеговик» твой! За день: +${data.coins} 🪙${data.xp ? ` · +${data.xp} XP` : ''}`
          : `🎁 Награда за день ${day}: +${data.coins} 🪙${data.xp ? ` · +${data.xp} XP` : ''}`;
        setTimeout(() => toast(msg), fresh ? 2900 : 0);
        try { root.D37Coins?.sync?.(); } catch (e) {}
        advRender(true);
      } else if (data?.reason === 'claimed') { if (srv) srv.days.add(day); }
      else if (fresh && CLAIM_MSG[data?.reason]) setTimeout(() => toast(CLAIM_MSG[data.reason]), 2900);
      return data;
    } catch (e) { return null; }
  }
  // при входе и при открытии сайта: забрать сделанное без входа или не дошедшее (сегодня и вчера по местному)
  async function srvSync(){
    const c = C();
    if (!c || !sbc() || srvOff) return;
    const A = c.advent(Date.now());
    if (!A) return;
    if (!adv || adv.y !== A.year) adv = advLoad(A.year);
    const s = await srvLoad(true);
    if (!s) return;
    for (const d of [A.day - 1, A.day]) if (d >= 1 && adv.done[d] && !s.days.has(d)) await srvClaim(d, false);
    advRender(true);
  }
  const srvLine = () => !sbc() ? '<small class="cel-adv-s">🔑 войди — награды</small>'
    : srv ? `<small class="cel-adv-s" title="Дней с наградой; ${srv.need} — питомец «Снеговик»">${srv.big ? '⛄ ✓' : `⛄ ${Math.min(srv.total, srv.need)}/${srv.need}`}</small>` : '';
  // проверка «сделано ли» по событию
  function advCheck(ev, d = {}){
    const c = C(); if (!c) return;
    const A = c.advent(Date.now()); if (!A) return;
    if (!adv || adv.y !== A.year) adv = advLoad(A.year);
    if (adv.d !== A.day) { adv.d = A.day; adv.plays = []; adv.wins = 0; }   // счётчики — на сегодня
    const t = ADVENT[A.day - 1]; if (!t || adv.done[A.day]) return;
    const [kind, arg] = t.kind.split(':');
    if (ev === 'game') {
      if (d.id && !adv.plays.includes(d.id)) adv.plays.push(d.id);
      if (d.win) adv.wins++;
      lsSet('d37_advent', adv);
      if (kind === 'play' && adv.plays.length >= t.n) advDone(A.day, 'play');
      else if (kind === 'win' && adv.wins >= t.n) advDone(A.day, 'win');
      else if (kind === 'game' && arg.split('|').includes(d.id)) advDone(A.day, 'game');
    } else if (ev === 'route' && kind === 'route' && String(d.hash || '').startsWith(arg)) advDone(A.day, 'route');
    else if (ev === 'chat' && kind === 'chat') advDone(A.day, 'chat');
    else if (ev === 'wish' && kind === 'wish') advDone(A.day, 'wish');
    else if (ev === 'kind' && d.kind && t.kind === d.kind) advDone(A.day, 'game');
  }
  function advRender(force){
    const c = C(); if (!c || !doc?.body) return;
    style();
    const now = Date.now(), A = c.advent(now), tz = c.localTz(now), p = c.parts(now, tz);
    const after = !A && p.m === 1 && p.d <= 2 ? lsGet('d37_advent', null) : null;   // 1–2 января: итог задания
    if (!A && !after) { advEl?.remove(); advEl = null; return; }
    if (A && (!adv || adv.y !== A.year)) adv = advLoad(A.year);
    if (!advEl) {
      advEl = doc.createElement('div'); advEl.className = 'cel-adv'; advEl.setAttribute('role', 'region'); advEl.setAttribute('aria-label', 'Новогоднее задание');
      advEl.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (b?.dataset.a === 'col') { adv.col = !adv.col; lsSet('d37_advent', adv); advRender(true); e.stopPropagation(); return; }
        if (b?.dataset.a === 'wish') { advCheck('wish'); return; }
        if (adv?.col) { adv.col = false; lsSet('d37_advent', adv); advRender(true); }
      });
      doc.body.appendChild(advEl);
    }
    if (after) { const n = Object.keys(after.done || {}).length; advEl.className = 'cel-adv done'; advEl.innerHTML = `<b>🎆 С Новым годом!</b><span>Новогоднее задание: ${n} из 31</span>`; return; }
    const t = ADVENT[A.day - 1], done = !!adv.done[A.day], n = Object.keys(adv.done).length;
    const left = fmtLeft(A.left);
    if (!force && advDay === A.day && advEl.dataset.col === String(!!adv.col)) { const el = advEl.querySelector('[data-left]'); if (el) el.textContent = left; return; }
    advDay = A.day; advEl.dataset.col = String(!!adv.col);
    advEl.className = 'cel-adv' + (adv.col ? ' col' : '') + (done ? ' ok' : '');
    advEl.innerHTML = adv.col
      ? `<button type="button" class="cel-adv-pill" data-a="col" title="Новогоднее задание — развернуть">🎄 <span data-left>${left}</span>${done ? ' ✓' : ''}</button>`
      : `<div class="cel-adv-h"><b>🎄 До Нового года</b><span data-left>${left}</span><button type="button" class="cel-adv-c" data-a="col" aria-label="Свернуть">▾</button></div>
        <div class="cel-adv-t">${done ? '✅' : t.icon} <span>День ${A.day}: ${esc(t.text)}</span></div>
        <div class="cel-adv-f"><i style="width:${Math.round(n / 31 * 100)}%"></i><small>${n} из 31</small>${t.kind === 'wish' && !done ? '<button type="button" class="cel-adv-w" data-a="wish">✨ Загадал!</button>' : ''}${srvLine()}</div>`;
  }
  function advTick(now){
    const c = C(); if (!c) return;
    if (!c.advent(now) && !advEl) { const p = c.parts(now, c.localTz(now)); if (!(p.m === 1 && p.d <= 2)) return; }
    advRender(false);
  }
  // события сайта → задание дня
  if (root.addEventListener) {
    root.addEventListener('d37:game', e => advCheck('game', e.detail || {}));
    root.addEventListener('d37:route', () => { advCheck('route', { hash: (root.D37Route ? root.D37Route.hash() : root.location?.hash) || '' }); setTimeout(() => { try { banner(Date.now(), C()?.holidays(Date.now()) || []); } catch (e) {} }, 60); });
    root.addEventListener('d37:chatmsg', e => { const m = e.detail || {}; try { if (typeof currentUser !== 'undefined' && currentUser && m.uid === currentUser.id) advCheck('chat'); } catch (er) {} });   // eslint-disable-line no-undef
    root.addEventListener('d37:advent', e => advCheck('kind', e.detail || {}));
    // вошёл / вышел — награды с сервера заново (вне декабря srvSync ничего не спрашивает)
    root.addEventListener('d37:auth', () => { srv = null; setTimeout(srvSync, 1500); });
  }

  // ═══ Полоса на главной: праздник сегодня / новогоднее задание ═══
  let banEl = null, banKey = '';
  function banner(now, L){
    if (!doc?.body) return;
    const home = doc.body.dataset.route === 'home', today = doc.getElementById('today');
    const h = holidaysOn() ? L.find(x => x.phase !== 'pre') : null, A = C()?.advent(now);
    const key = home && today ? (h ? h.id + h.year : A ? 'adv' + A.day : '') : '';
    if (!key) { if (banEl) { banEl.remove(); banEl = null; banKey = ''; } doc.body.classList.remove('cel-ban-on'); return; }
    if (!banEl || !banEl.isConnected) { banEl = doc.createElement('div'); banEl.className = 'cel-ban'; today.before(banEl); banKey = ''; }
    doc.body.classList.add('cel-ban-on');   // на главной карточка задания не нужна — она в полосе
    if (key === banKey) { const el = banEl.querySelector('[data-left]'); if (el && A) el.textContent = fmtLeft(A.left); return; }
    banKey = key;
    if (h) { banEl.className = 'cel-ban cel-' + (h.style || 'fireworks'); banEl.innerHTML = `<b>${esc(h.greet)}</b><span>${esc(h.sub || '')}</span>`; return; }
    if (!adv || adv.y !== A.year) adv = advLoad(A.year);
    const t = ADVENT[A.day - 1], done = !!adv.done[A.day];
    banEl.className = 'cel-ban cel-adv-ban';
    banEl.innerHTML = `<b>🎄 Новогоднее задание</b><span>До Нового года <i data-left>${fmtLeft(A.left)}</i> · День ${A.day}: ${done ? '✅ ' : t.icon + ' '}${esc(t.text)} · ${Object.keys(adv.done).length} из 31</span>`;
  }

  // ═══ Маленькое уведомление ═══
  function toast(text){
    if (!doc?.body) return;
    const t = doc.createElement('div'); t.className = 'cel-toast'; t.textContent = text; doc.body.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 500); }, 2600);
  }

  // ═══ ⚙️ «🌦 Погода»: эффекты погоды, частицы, праздники ═══
  function settingsTab(){
    const SS = S(); if (!SS?.define || !SS.addTab) return;
    SS.define('wxFx', { def: true, bool: 1 }).define('wxAmt', { def: 100, min: 0, max: 100 }).define('holidays', { def: true, bool: 1 });
    const row = (label, ctl, hint) => `<div class="gs-row"><div class="gs-lbl"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</div><div class="gs-ctl">${ctl}</div></div>`;
    const sw = k => `<label class="gs-sw"><input type="checkbox" data-sw="${k}"${SS.get(k) !== false ? ' checked' : ''}><i aria-hidden="true"></i></label>`;
    SS.addTab({ id: 'weather', icon: '🌦', title: 'Погода', order: 12, ctx: ['engine', 'game', 'site'], keys: ['wxFx', 'wxAmt', 'holidays'], render(){
      const c = C(), cal = c ? c.calendar(Date.now()) : null, X = root.D37E?.climate?.current?.(), st = X ? X.at(0, 0) : null;
      const nx = cal?.next, nxD = nx ? Math.ceil((nx.start - Date.now()) / 86400000) : 0;
      const amt = SS.get('wxAmt');
      return '<div class="gs-sec">Погода в 3D-мирах</div>'
        + row('Эффекты погоды', sw('wxFx'), 'Дождь, снег, лужи, осенняя листва и гроза в 3D. Выкл — всегда ясно.')
        + row('Сколько частиц', `<div class="gs-range"><input type="range" min="0" max="100" step="10" value="${amt}" data-range="wxAmt" data-mul="1" aria-label="Сколько частиц"><output data-out="wxAmt">${amt}%</output></div>`, 'Капли и снежинки; меньше — быстрее.')
        + '<div class="gs-sec">Праздники</div>'
        + row('Салют и поздравления', sw('holidays'), 'Салют в Новый год (в твою полночь), Наурыз и другие праздники.')
        + (cal ? `<p class="gs-note">Сейчас в общем мире: ${cal.icon} ${esc(cal.name)}${st ? ` · ${c.STATE_ICONS[st.state] || ''} ${esc(c.STATE_NAMES[st.state] || '')}, ${Math.round(st.temp)}°` : ''}. Времена года — примерно по 39 дней; декабрь–февраль — зима.${nx ? ` Ближайший праздник: ${nx.h.icon} ${esc(nx.h.name)}${nxD > 0 ? ` — через ${nxD} дн.` : ''}` : ''}</p>` : '')
        + '<p class="gs-note"><button type="button" class="gs-btn" data-celtest="1">🎆 Показать салют</button></p>';
    } });
    doc?.addEventListener?.('click', e => { const b = e.target?.closest?.('[data-celtest]'); if (!b) return; e.preventDefault(); style(); fireworks(8, 'fireworks', true); confetti(80); });
    doc?.addEventListener?.('input', e => { const t = e.target; if (t?.dataset?.range !== 'wxAmt') return; const o = t.closest('.gs-range')?.querySelector('output'); if (o) o.textContent = t.value + '%'; });
  }

  const API = root.D37Celebrate = {
    show, fireworks, confetti, countdown, greet, stop(){ auto = null; rockets.length = 0; P.n = 0; card?.remove(); card = null; count?.remove(); count = null; },
    decor: id => (C()?.HOLIDAYS.find(h => h.id === id)?.decor || []).slice(),
    ADVENT, advent: () => adv, adventCheck: advCheck, onAdventDone: null, toast, adventServer: () => srv, adventSync: srvSync,
    _test: { STYLE, P, rockets, second, advRender, banner, fmtLeft },
  };
  settingsTab();
  if (doc?.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => setTimeout(start, 400)); else setTimeout(start, 400);
})();
