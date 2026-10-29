// ═══════════════════════════════════════
//  ИГРА «БАШНЯ» (T-140) — тап: кран роняет блок на башню; что свисает — отрезается. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, этаж — 22 единицы; скорость блока — единиц в секунду.
// Своё: кран сам опускает блок — не успел нажать, и блок встанет там, где окажется (время на этаж сокращается с высотой);
// идеальная укладка (±3,5) — ⭐ +2 очка вместо 1 и нота выше с каждой подряд; цель — крыша на 100-м этаже.
// Исправлено против прототипа: (1) ход блока за кадр → в секунду (на 144 Гц прототип ездил в 2,4 раза быстрее); (2) блок заезжал
// за край поля и только потом разворачивался (дёргался у стенки) — теперь точное отражение от края; (3) нажатие после промаха
// сразу начинало заново — теперь итог ядра с защитой от позднего нажатия; (4) каждый кадр собирались строки цвета hsl(…) — теперь
// готовая палитра; (5) камера прыгала на этаж — теперь плавно; (6) башня была бесконечной, а без нажатий партия не кончалась
// никогда — теперь кран и крыша на 100-м этаже (у соперников партия всегда заканчивается); (7) двойной тап (дрожь пальца) сразу
// ронял и следующий блок с края поля — теперь 0,18 с после укладки нажатия не считаются.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, BH = 22, BASE = 414, TOP = 100;      // высота этажа, земля, этажей до крыши
  const W0 = 160, X0 = 80, V0 = 120, DV = 3.6, VMAX = 300;      // ширина основания, его x; скорость блока: старт, + за этаж, предел
  const LT0 = 4.5, DLT = .03, LTMIN = 2.4, LIFT = 70;           // кран опускает блок за LT секунд (с высотой быстрее), с высоты LIFT
  const PERF = 3.5, MINW = 4, SHOW = 10, COOL = .18;           // идеальная укладка, тоньше MINW — промах; камера — 10 этажей;
                                                                // после укладки 0,18 с кран цепляет новый блок — двойной тап не роняет его
  const RING = 32, MASK = RING - 1;
  const PAL = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#b197fc', '#f783ac', '#e599f7'];
  const NOTES = [523, 587, 659, 784, 880, 988, 1175, 1319];
  const C = { sky: '#17142b', star: 'rgba(255,255,255,.4)', ground: '#2a2346', edge: '#7c6cf0', win: 'rgba(255,240,180,.55)', cable: '#9a94c4',
    hook: '#c9c3ee', crane: '#3a3266', bad: '#ff4d6d', glow: '#ffffff', chip: 'rgba(255,255,255,.35)' };

  function spawn(s){
    const j = s.floors & MASK;
    s.w = s.fw[j];
    s.dir = s.floors % 2 ? -1 : 1;
    s.x = s.px = s.dir > 0 ? 0 : W - s.w;
    s.drop = s.pdrop = 0;
    s.cool = COOL;
  }

  function create(rng){
    const s = { rng, floors: 0, x: 0, px: 0, w: W0, dir: 1, drop: 0, pdrop: 0, spd: V0, started: false, t: 0, cam: 0, pcam: 0,
      score: 0, perfect: 0, streak: 0, flash: 0, cool: 0, over: false, why: '', snd: 0,
      chipX: 0, chipW: 0, chipY: 0, chipV: 0, chipC: 0, badX: 0, badW: 0,
      fx: new Float64Array(RING), fw: new Float64Array(RING) };
    s.fx[0] = X0; s.fw[0] = W0;
    spawn(s);
    // ⚔️ соперники: одинаковый первый ход блока (с какой стороны и где он стоит) — небольшой сдвиг старта из rng
    s.x = s.px = Math.floor(rng() * 60);
    s.seed0 = s.x; s.cool = 0;
    return s;
  }

  function place(s){
    const t = s.floors & MASK, tx = s.fx[t], tw = s.fw[t], x = s.x, w = s.w;
    const l = x > tx ? x : tx, r = x + w < tx + tw ? x + w : tx + tw, ow = r - l;
    s.started = true;
    if (ow < MINW) { s.over = true; s.why = 'miss'; s.badX = x; s.badW = w; s.snd = 'bad'; return; }
    let nx = l, nw = ow;
    if (Math.abs(x - tx) <= PERF) {
      nx = tx; nw = tw;
      s.score += 2; s.perfect++; s.streak++; s.flash = .35;
      s.snd = NOTES[(s.streak - 1) % NOTES.length];
    } else {
      s.score += 1; s.streak = 0; s.snd = 'tick';
      s.chipC = s.floors + 1; s.chipV = 0; s.chipY = BASE - (s.floors + 2) * BH;
      if (x < tx) { s.chipX = x; s.chipW = tx - x; } else { s.chipX = tx + tw; s.chipW = x + w - tx - tw; }
    }
    s.floors++;
    const j = s.floors & MASK;
    s.fx[j] = nx; s.fw[j] = nw;
    if (s.floors >= TOP) { s.over = true; s.why = 'top'; s.snd = 'win'; return; }
    spawn(s);
  }

  function input(s, e){
    if (s.over || s.cool > 0 || (e.type !== T.DOWN && e.type !== T.KEY)) return;
    place(s);
  }

  function step(s, dt){
    s.px = s.x; s.pdrop = s.drop; s.pcam = s.cam;
    s.spd = Math.min(VMAX, V0 + DV * s.floors);
    let x = s.x + s.dir * s.spd * dt;
    if (x < 0) { x = -x; s.dir = 1; } else if (x > W - s.w) { x = 2 * (W - s.w) - x; s.dir = -1; }
    s.x = x;
    if (s.chipW > 0) { s.chipV += 1400 * dt; s.chipY += s.chipV * dt; if (s.chipY > BASE + 40 - s.cam + H) s.chipW = 0; }
    if (s.flash > 0) s.flash -= dt;
    if (s.cool > 0) s.cool -= dt;
    const target = s.floors > SHOW ? (s.floors - SHOW) * BH : 0;
    s.cam += (target - s.cam) * (1 - Math.exp(-6 * dt));
    if (!s.started) return;
    s.t += dt;
    s.drop += dt / Math.max(LTMIN, LT0 - DLT * s.floors);
    if (s.drop >= 1) { s.drop = 1; place(s); }      // кран опустил блок — встаёт, где оказался
  }

  function draw(G, s, a){
    const ctx = G.ctx, cam = s.over ? s.cam : s.pcam + (s.cam - s.pcam) * a;
    const x = s.over ? s.x : s.px + (s.x - s.px) * a, drop = s.over ? s.drop : s.pdrop + (s.drop - s.pdrop) * a;
    ctx.fillStyle = C.sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.star;
    for (let i = 0; i < 14; i++) ctx.fillRect((i * 97 + 31) % W, ((i * 53 + 17) % 260 + cam * .2) % H, 1.5, 1.5);
    const gy = BASE + cam;
    if (gy < H) { ctx.fillStyle = C.ground; ctx.fillRect(0, gy, W, H - gy); ctx.fillStyle = C.edge; ctx.fillRect(0, gy, W, 2); }
    // этажи (видимые): снизу вверх
    const f0 = Math.max(0, s.floors - RING + 1, Math.floor(cam / BH) - 1);
    for (let k = f0; k <= s.floors; k++) {
      const y = BASE - (k + 1) * BH + cam;
      if (y > H) continue;
      const j = k & MASK, fx = s.fx[j], fw = s.fw[j];
      ctx.fillStyle = PAL[k % PAL.length]; ctx.fillRect(fx, y, fw, BH - 1);
      ctx.fillStyle = C.win;
      for (let wx = fx + 6; wx < fx + fw - 8; wx += 16) ctx.fillRect(wx, y + 7, 6, 7);
    }
    if (s.flash > 0) { const y = BASE - (s.floors + 1) * BH + cam, j = s.floors & MASK; ctx.strokeStyle = C.glow; ctx.lineWidth = 2; ctx.strokeRect(s.fx[j] - 2, y - 2, s.fw[j] + 4, BH + 3); }
    if (s.chipW > 0) { ctx.fillStyle = PAL[s.chipC % PAL.length]; ctx.fillRect(s.chipX, s.chipY + cam, s.chipW, BH - 1); ctx.fillStyle = C.chip; ctx.fillRect(s.chipX, s.chipY + cam, s.chipW, BH - 1); }
    if (s.over && s.why === 'miss') { ctx.fillStyle = C.bad; ctx.fillRect(s.badX, BASE - (s.floors + 2) * BH + cam - LIFT * (1 - s.drop), s.badW, BH - 1); return; }
    if (s.over) return;
    // кран: балка сверху, трос и крюк над блоком
    const by = BASE - (s.floors + 2) * BH + cam - LIFT * (1 - drop);
    ctx.fillStyle = C.crane; ctx.fillRect(0, 0, W, 8);
    ctx.fillStyle = C.cable; ctx.fillRect(x + s.w / 2 - 1, 8, 2, by - 14);
    ctx.fillStyle = C.hook; ctx.fillRect(x + s.w / 2 - 7, by - 8, 14, 6); ctx.fillRect(x + s.w / 2 - 12, 2, 24, 8);
    ctx.fillStyle = PAL[(s.floors + 1) % PAL.length]; ctx.fillRect(x, by, s.w, BH - 1);
    ctx.fillStyle = C.win;
    for (let wx = x + 6; wx < x + s.w - 8; wx += 16) ctx.fillRect(wx, by + 7, 6, 7);
  }

  ArcadeKit.define('tower', {
    kind: 'canvas', W, H,
    title: '🏗️ Башня',
    intro: 'Тап — кран роняет блок. Что свисает за край башни — отрезается. Ровно в край — ⭐ +2 очка. Не успел — кран опустит блок сам. Цель — крыша на 100-м этаже.',
    controls: 'Тап по полю, мышь или пробел / ↓ — уронить блок.',
    duelTitle: 'Одинаковая башня у обоих',
    keys: { Space: 0, ArrowDown: 0, KeyS: 0 },
    create, input, step, draw,
    hudKey: s => (s.started ? s.floors : -1),
    hud: s => (s.started ? '🏢 этаж ' + s.floors + ' из ' + TOP : 'Тап — поставить первый блок'),
    win: s => s.floors >= 25,
    result: s => ({
      title: s.why === 'top' ? '🏆 Крыша! Башня достроена' : s.floors >= 50 ? '🔥 Небоскрёб!' : s.floors >= 25 ? '🎉 Высокая башня!' : '💥 Блок упал мимо',
      text: 'этажей: ' + s.floors + ' · ⭐ ' + s.perfect,
    }),
    consts: { W, H, BH, BASE, TOP, W0, X0, V0, DV, VMAX, LT0, DLT, LTMIN, LIFT, PERF, MINW, RING },
  });
})();
