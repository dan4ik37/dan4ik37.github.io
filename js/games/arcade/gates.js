// ═══════════════════════════════════════
//  ИГРА «ВОРОТА С ЧИСЛАМИ» (T-140) — веди фонарик через ворота и собери больше светлячков. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, дорога едет вниз (единиц в секунду, быстрее к концу).
// Своё: ты — фонарик, светлячков сначала нет (первые ворота — оба «+»); ворота +, −, ×, ÷ меняют их число; ☁️ туча на всю ширину гасит часть светлячков —
// к ней надо прийти с запасом; в конце пути — большой фонарь, счёт = светлячки, которых ты донёс. С 13-го ряда ворот трое.
// Исправлено против прототипа: (1) движение «за кадр» (на 144 Гц дорога ехала в 2,4 раза быстрее, герой догонял палец
// по-разному) — теперь шаг 60 Гц и скорости в секунду; (2) ворота из Math.random — теперь rng (у соперников одинаковые);
// (3) «÷2» давал дробный рост и рост < 1 «исчезал» без счёта — теперь целые светлячки, 0 — конец; (4) ворота
// выбирались по центру поля в момент пересечения линии в 380 по «кадрам» — теперь ровно когда ряд дошёл до героя, по
// воротам под ним (2 или 3 ворот); (5) после финиша тап сразу начинал заново — теперь кнопка ядра; (6) число росло
// без предела (×3 подряд) — умножения после 2000 светлячков заменяются сложением.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, HY = 372, ROWS = 24, GAP = 170, P0 = 320, START = 0;
  const LAMP = P0 + ROWS * GAP + 60;          // где стоит большой фонарь (путь в единицах)
  const V0 = 150, V1 = 270, HV = 640, KEYV = 380, HR = 15;
  const OPS = ['+', '−', '×', '÷'];
  const C = { bg: '#0b1222', path: '#131d33', dash: 'rgba(255,255,255,.07)', good: 'rgba(53,224,163,.30)', goodB: '#35e0a3', bad: 'rgba(255,77,109,.30)', badB: '#ff4d6d',
    ink: '#ffffff', cloud: '#56607a', cloudD: '#3a4258', glow: '#ffd166', body: '#ffe7a3', fly: '#fff3b0', lamp: '#ffd166', post: '#2a3552', done: .25 };

  function apply(op, v, n){ return op === 0 ? n + v : op === 1 ? n - v : op === 2 ? n * v : Math.floor(n / v); }

  function create(rng){
    const s = { rng, d: 0, d0: 0, v: V0, hx: W / 2, hx0: W / 2, tx: W / 2, n: START, score: START, row: 0, pick: -1, over: false, why: '', snd: 0, best: 0, flash: 0,
      cnt: new Uint8Array(ROWS), op: new Int8Array(ROWS * 3), val: new Int32Array(ROWS * 3), took: new Int8Array(ROWS), lbl: [] };
    // ряды: «хорошие» ворота (+ или ×) и «плохие» (− или ÷), с 13-го ряда — третьи; туча каждые 8 рядов.
    // g — сколько было бы у того, кто всегда выбирает лучшее: туча берёт от него 30–55 % (с запасом проходится)
    let g = START;
    for (let r = 0; r < ROWS; r++) {
      const b = r * 3;
      if (r % 8 === 7) {
        s.cnt[r] = 0; s.op[b] = 1; s.val[b] = Math.max(3, Math.floor(g * (.3 + .25 * rng())));
        g -= s.val[b]; s.lbl.push('☁ −' + s.val[b], '', ''); continue;
      }
      const k = r >= 12 ? 3 : 2;
      s.cnt[r] = k;
      const mul = g < 2000 && r > 0 && rng() < .38;
      s.op[b] = mul ? 2 : 0; s.val[b] = mul ? (rng() < .22 ? 3 : 2) : 4 + Math.floor(rng() * (6 + r * 1.5)) + (g >= 2000 ? Math.floor(g / 8) : 0);
      if (r === 0) { s.op[b + 1] = 0; s.val[b + 1] = 2 + Math.floor(rng() * 3); }          // первый ряд — оба «+» (светлячков ещё нет)
      else if (rng() < .5) { s.op[b + 1] = 1; s.val[b + 1] = 3 + Math.floor(rng() * (5 + r * 2)); } else { s.op[b + 1] = 3; s.val[b + 1] = 2; }
      if (k === 3) {
        // третьи ворота: если лучшие — «×», то «+» побольше (думай, что выгоднее), иначе «×2» или маленький «+»
        if (mul) { s.op[b + 2] = 0; s.val[b + 2] = 10 + Math.floor(rng() * (10 + r * 3)); }
        else if (g < 2000 && rng() < .5) { s.op[b + 2] = 2; s.val[b + 2] = 2; }
        else { s.op[b + 2] = 0; s.val[b + 2] = 2 + Math.floor(rng() * 6); }
      }
      // перемешать места ворот
      for (let i = k - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1)), o = s.op[b + i], v = s.val[b + i];
        s.op[b + i] = s.op[b + j]; s.val[b + i] = s.val[b + j]; s.op[b + j] = o; s.val[b + j] = v;
      }
      let m = 0;
      for (let i = 0; i < k; i++) m = Math.max(m, apply(s.op[b + i], s.val[b + i], g));
      g = m;
      for (let i = 0; i < 3; i++) s.lbl.push(i < k ? OPS[s.op[b + i]] + s.val[b + i] : '');
    }
    s.best = g;
    return s;
  }

  function input(s, e){
    if (s.over) return;
    if (e.type === T.DOWN || e.type === T.MOVE) s.tx = e.x < 0 ? 0 : e.x > W ? W : e.x;
  }

  function step(s, dt, inp){
    if (s.over) return;
    s.d0 = s.d; s.hx0 = s.hx;
    if (s.flash) s.flash--;
    const keys = inp ? inp.keys : 0;
    if (keys & 3) { s.hx += ((keys & 2 ? 1 : 0) - (keys & 1 ? 1 : 0)) * KEYV * dt; s.tx = s.hx; }
    else { const d = s.tx - s.hx, m = HV * dt; s.hx += d > m ? m : d < -m ? -m : d; }
    if (s.hx < HR) s.hx = HR; else if (s.hx > W - HR) s.hx = W - HR;
    const f = s.d / LAMP;
    s.v = V0 + (V1 - V0) * (f > 1 ? 1 : f);
    s.d += s.v * dt;
    // ряд дошёл до фонарика — ворота под ним (или туча на всю ширину)
    if (s.row < ROWS && s.d >= P0 + s.row * GAP) {
      const r = s.row, b = r * 3, k = s.cnt[r];
      let i = 0;
      if (k) { i = Math.floor(s.hx * k / W); if (i >= k) i = k - 1; }
      const was = s.n;
      s.n = apply(s.op[b + i], s.val[b + i], s.n);
      s.took[r] = i; s.pick = i; s.row++;
      s.flash = 18;
      if (s.n <= 0) { s.n = 0; s.score = 0; s.over = true; s.why = 'out'; s.snd = 'bad'; return; }
      s.score = s.n;
      s.snd = s.n > was ? 660 + Math.min(8, r % 9) * 40 : 247;
    }
    if (s.d >= LAMP) { s.over = true; s.why = 'lamp'; s.snd = 'win'; }
  }

  // ── рисование: дорога, ворота, туча, фонарь, фонарик со светлячками ──
  const F22 = 'bold 22px system-ui, sans-serif', F26 = 'bold 26px system-ui, sans-serif';
  function draw(G, s, a){
    const ctx = G.ctx, d = s.over ? s.d : s.d0 + (s.d - s.d0) * a, hx = s.over ? s.hx : s.hx0 + (s.hx - s.hx0) * a;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.path; ctx.fillRect(20, 0, W - 40, H);
    ctx.fillStyle = C.dash;
    const off = d % 60;
    for (let y = -60 + off; y < H; y += 60) ctx.fillRect(W / 2 - 2, y, 4, 30);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // большой фонарь в конце пути
    const ly = HY - (LAMP - d);
    if (ly > -80) {
      ctx.fillStyle = C.post; ctx.fillRect(W / 2 - 5, ly, 10, 90);
      ctx.fillStyle = C.lamp; ctx.beginPath(); ctx.arc(W / 2, ly, 34, 0, 6.2832); ctx.fill();
      ctx.fillStyle = C.bg; ctx.font = 'bold 15px system-ui, sans-serif'; ctx.fillText('ФИНИШ', W / 2, ly + 1);
    }
    // шрифт меняется только при смене размера (каждое присваивание ctx.font — разбор строки, дорого на телефоне)
    let font = '';
    for (let r = Math.max(0, s.row - 1); r < ROWS; r++) {
      const y = HY - (P0 + r * GAP - d);
      if (y < -40) break;
      if (y > H + 40) continue;
      const k = s.cnt[r], b = r * 3, past = r < s.row;
      ctx.globalAlpha = past ? C.done : 1;
      if (!k) {
        // ☁️ туча: гасит светлячков
        ctx.fillStyle = C.cloudD; ctx.fillRect(0, y - 26, W, 52);
        ctx.fillStyle = C.cloud;
        for (let x = 20; x < W; x += 56) { ctx.beginPath(); ctx.arc(x, y - 18, 24, 0, 6.2832); ctx.fill(); }
        ctx.fillStyle = C.ink;
        if (font !== F22) { font = F22; ctx.font = F22; }
        ctx.fillText(s.lbl[b], W / 2, y + 4);
      } else {
        const gw = W / k;
        for (let i = 0; i < k; i++) {
          const o = s.op[b + i], good = o === 0 || o === 2;
          ctx.fillStyle = good ? C.good : C.bad; ctx.fillRect(i * gw + 3, y - 24, gw - 6, 48);
          ctx.fillStyle = good ? C.goodB : C.badB; ctx.fillRect(i * gw + 3, y - 24, gw - 6, 4);
          if (past && s.took[r] === i) { ctx.globalAlpha = .6; }
          ctx.fillStyle = C.ink;
          const f = k === 3 ? F22 : F26;
          if (font !== f) { font = f; ctx.font = f; }
          ctx.fillText(s.lbl[b + i], i * gw + gw / 2, y + 2);
          if (past) ctx.globalAlpha = C.done;
        }
      }
      ctx.globalAlpha = 1;
    }
    // фонарик и светлячки вокруг (не больше 36 точек)
    if (!G.glow) { G.glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 46); G.glow.addColorStop(0, 'rgba(255,209,102,.55)'); G.glow.addColorStop(1, 'rgba(255,209,102,0)'); }
    ctx.save(); ctx.translate(hx, HY); ctx.fillStyle = G.glow; ctx.fillRect(-46, -46, 92, 92); ctx.restore();
    if (s.n > 0) {
      ctx.fillStyle = C.fly;
      const m = s.n < 36 ? s.n : 36, t = G.now / 900;
      for (let i = 0; i < m; i++) {
        const ang = i * 2.39996 + t * (1 + (i % 3) * .3), rr = 20 + (i * 7) % 18;
        ctx.fillRect(hx + Math.cos(ang) * rr - 1.5, HY + Math.sin(ang) * rr * .8 - 1.5, 3, 3);
      }
    }
    ctx.fillStyle = C.post; ctx.fillRect(hx - 2, HY - HR - 9, 4, 8);
    ctx.fillStyle = C.body; ctx.beginPath(); ctx.arc(hx, HY, HR, 0, 6.2832); ctx.fill();
    ctx.fillStyle = C.bg; ctx.font = 'bold 13px system-ui, sans-serif';
    if (G.nn !== s.n) { G.nn = s.n; G.nT = String(s.n); }
    ctx.fillText(G.nT, hx, HY + 1);
    if (s.flash) { ctx.globalAlpha = s.flash / 36; ctx.fillStyle = C.glow; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }

  ArcadeKit.define('gates', {
    kind: 'canvas', W, H, drag: true,
    title: '🚪 Ворота с числами',
    intro: 'Ты — фонарик со светлячками. Веди его через ворота: +, ×  — светлячков больше, −, ÷ — меньше. ☁️ Туча гасит часть светлячков. Донеси до фонаря как можно больше!',
    controls: 'Веди пальцем (или мышью с зажатой кнопкой) влево-вправо. Клавиатура: ← → или A D.',
    duelTitle: 'Одинаковые ворота у обоих',
    keys: { ArrowLeft: 0, KeyA: 0, ArrowRight: 1, KeyD: 1 },
    scoreName: 'Светлячки',
    create, input, step, draw,
    hudKey: s => s.row,
    hud: s => 'ворота ' + Math.min(s.row + 1, ROWS) + ' из ' + ROWS,
    win: s => s.why === 'lamp' && s.n * 2 >= s.best,
    result: s => ({
      title: s.why === 'out' ? '☁️ Светлячки погасли' : s.n >= s.best ? '🏆 Лучший путь!' : s.n * 2 >= s.best ? '✨ Фонарь сияет!' : '🏮 Дошёл до фонаря',
      text: s.why === 'out' ? 'пройдено ворот: ' + s.row + ' из ' + ROWS : 'лучший возможный путь: ' + s.best,
    }),
    consts: { W, H, HY, ROWS, GAP, P0, LAMP, START, V0, V1, HV, KEYV },
  });
})();
