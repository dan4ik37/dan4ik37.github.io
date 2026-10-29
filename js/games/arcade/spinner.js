// ═══════════════════════════════════════
//  ИГРА «СПИННЕР» (T-140) — держи скорость спиннера в зелёной зоне: раскручивай свайпом, тормози касанием. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440: спиннер в центре, внизу шкала скорости (об/с) с зоной.
// Своё: не «кто сильнее», а точность — зона скорости меняется каждые 5 с (rng); держишься в зоне дольше 2 с — 🔥 очки ×2.
// Свайп по кругу добавляет скорость по пройденному углу (четверть круга ≈ +1,5 об/с) — не по скорости пальца, поэтому
// одинаково на любом экране и частоте кадров; палец держишь неподвижно — тормозит; трение — в секунду.
// Очки: каждые 0,1 с в зоне +1 (с 🔥 +2). Партия — 40 секунд.
// Исправлено против прототипа: вращение a += w и трение w *= .993 за КАДР (на 144 Гц в 2,4 раза быстрее и дольше) → в
// секунду; рекорд «максимальная скорость» — кто быстрее дёрнет мышь (на ПК и телефоне по-разному) → зона скорости;
// партия без конца → 40 с; строка HUD на каждом кадре → только при изменении.
(() => {
  const T = ArcadeKit.T, TAU = Math.PI * 2;
  const W = 320, H = 440, CX = 160, CY = 190, R = 82;
  const TIME = 40 * 60, BAND = 300, NB = 8, BW = 3, MAXR = 16;  // шагов: партия, смена зоны; зон; ширина зоны и шкала (об/с)
  const GAIN = 6, FLICK = 1.5 * TAU, FR = .2, BR = 3, WMAX = 18 * TAU, STILL = 6, FIRE = 120;
  const C = { bg: '#14101f', ring: 'rgba(255,255,255,.06)', hub: '#e9e6f2', hole: '#14101f', lobe: ['#ff4d6d', '#2ec27e', '#ffc233'],
    bar: 'rgba(255,255,255,.12)', band: '#2ec27e', bandHot: '#ffc233', needle: '#fff', ink: '#f0eef8', mute: '#9c96b4' };
  // подписи заранее (рисование без новых строк на кадр): скорость с шагом 0,1 об/с и зоны
  const RT = [], LT = [];
  for (let i = 0; i <= 180; i++) RT.push((i / 10).toFixed(1) + ' об/с');
  for (let i = 0; i <= 15; i++) LT.push('зона ' + i + '–' + (i + 3) + ' об/с');

  function create(rng){
    const s = { rng, a: 0, pa: 0, w: 0, hold: false, la: 0, fx: 0, fy: 0, fd: 0, fm: 0, still: 0, left: TIME, bi: 0, bandT: BAND, lo: 0, inb: false, streak: 0,
      sub: 0, score: 0, fires: 0, over: false, snd: 0, bands: new Uint8Array(NB) };
    // зоны заранее (у соперников одинаковые): нижняя граница 2…11 об/с, не та же, что прошлая
    let prev = -1;
    for (let i = 0; i < NB; i++) { let v; do v = 2 + Math.floor(rng() * 10); while (v === prev); s.bands[i] = prev = v; }
    s.lo = s.bands[0];
    return s;
  }

  // касание: событие только запоминает точку пальца, угол считается раз в шаг (меньше дробных чисел на событие);
  // за 1/60 с палец не обойдёт полкруга, поэтому угол «от прошлой точки до последней» = сумма углов всех событий шага
  function input(s, e){
    if (s.over) return;
    const t = e.type;
    if (t === T.DOWN) { s.hold = true; s.fx = e.x; s.fy = e.y; s.fd = 1; s.still = 0; }
    else if (t === T.MOVE) { if (s.hold) { s.fx = e.x; s.fy = e.y; s.fm = 1; } }
    else if (t === T.UP) s.hold = false;   // последний отрезок свайпа (fm) шаг ещё досчитает
    else if (t === T.KEY && e.k === 0) { s.w += s.w < 0 ? -FLICK : FLICK; s.snd = 330; }   // клавиша — толчок в сторону вращения
  }

  const FRK = Math.exp(-FR * ArcadeKit.STEP), BRK = Math.exp(-BR * ArcadeKit.STEP);   // трение за шаг (шаг всегда 1/60 с)
  function step(s, dt, inp){
    if (s.over) return;
    s.pa = s.a;
    // палец: пройденный угол крутит спиннер и добавляет скорость; палец стоит дольше 0,1 с — тормоз
    if (s.fd) { s.fd = 0; s.fm = 0; s.la = Math.atan2(s.fy - CY, s.fx - CX); }
    else if (s.fm) {
      s.fm = 0;
      const n = Math.atan2(s.fy - CY, s.fx - CX);
      let d = n - s.la;
      if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
      s.la = n;
      if (d !== 0) { s.w += d * GAIN; s.a += d; s.still = 0; }
    } else if (s.hold) s.still++;
    s.w *= FRK;
    if ((s.hold && s.still > STILL) || (inp && (inp.keys & 2))) s.w *= BRK;
    if (s.w > WMAX) s.w = WMAX; else if (s.w < -WMAX) s.w = -WMAX;
    s.a += s.w * dt;
    if (s.a > 1000 || s.a < -1000) { const k = TAU * Math.floor(s.a / TAU); s.a -= k; s.pa -= k; }
    // зона
    const rev = Math.abs(s.w) / TAU, inb = rev >= s.lo && rev <= s.lo + BW;
    if (inb) {
      if (++s.streak === FIRE) { s.fires++; s.snd = 'ok'; }
      if (++s.sub === 6) { s.sub = 0; s.score += s.streak > FIRE ? 2 : 1; }
    } else { s.streak = 0; s.sub = 0; }
    s.inb = inb;
    if (!--s.bandT) { s.bi++; s.lo = s.bands[s.bi % NB]; s.bandT = BAND; s.streak = 0; s.snd = 660; }
    if (--s.left <= 0) { s.left = 0; s.over = true; s.hold = false; s.snd = 'win'; }
  }

  function draw(G, s, al){
    const ctx = G.ctx, a = s.pa + (s.a - s.pa) * al;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.ring; ctx.beginPath(); ctx.arc(CX, CY, R + 52, 0, TAU); ctx.fill();
    // спиннер
    ctx.save(); ctx.translate(CX, CY); ctx.rotate(a);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = C.lobe[i];
      ctx.beginPath(); ctx.arc(0, -R, 40, 0, TAU); ctx.fill();
      ctx.fillStyle = C.hole; ctx.beginPath(); ctx.arc(0, -R, 15, 0, TAU); ctx.fill();
      ctx.rotate(TAU / 3);
    }
    ctx.fillStyle = C.hub; ctx.beginPath(); ctx.arc(0, 0, 46, 0, TAU); ctx.fill();
    ctx.fillStyle = C.hole; ctx.beginPath(); ctx.arc(0, 0, 17, 0, TAU); ctx.fill();
    ctx.restore();
    // шкала скорости: зона, стрелка, подписи
    const x0 = 20, bw = 280, y = 368, rev = Math.abs(s.w) / TAU;
    ctx.fillStyle = C.bar; ctx.fillRect(x0, y, bw, 22);
    ctx.fillStyle = s.streak > FIRE ? C.bandHot : C.band; ctx.fillRect(x0 + bw * s.lo / MAXR, y, bw * BW / MAXR, 22);
    ctx.fillStyle = C.needle; ctx.fillRect(x0 + bw * Math.min(1, rev / MAXR) - 2, y - 6, 4, 34);
    const st = s.streak > FIRE ? 2 : s.inb ? 1 : 0;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 26px Montserrat, system-ui, sans-serif'; ctx.fillStyle = st ? (st === 2 ? C.bandHot : C.band) : C.ink;
    ctx.fillText(RT[Math.min(180, Math.round(rev * 10))], CX, 330);
    ctx.font = '600 13px system-ui, sans-serif'; ctx.fillStyle = C.mute;
    ctx.fillText(LT[s.lo], CX, 410);
    if (st === 2) { ctx.font = '22px system-ui, sans-serif'; ctx.fillText('🔥', 292, 330); }
    // зона сменится — полоска до смены
    ctx.fillStyle = C.bar; ctx.fillRect(x0, 428, bw, 4);
    ctx.fillStyle = C.mute; ctx.fillRect(x0, 428, bw * s.bandT / BAND, 4);
  }

  ArcadeKit.define('spinner', {
    kind: 'canvas', W, H, drag: true,
    title: '🌀 Спиннер',
    intro: 'Держи скорость спиннера в зелёной зоне шкалы. Свайп по кругу раскручивает, палец, прижатый к экрану, тормозит. Зона меняется каждые 5 секунд. В зоне дольше 2 с — 🔥 очки ×2. 40 секунд.',
    controls: 'Палец или мышь: веди по кругу — раскрутка, держи на месте — тормоз. Клавиши: пробел (или →) — толчок, ↓ — тормоз.',
    duelTitle: 'Одинаковые зоны у обоих',
    keys: { Space: 0, ArrowRight: 0, KeyD: 0, ArrowDown: 1, KeyS: 1 },
    create, input, step, draw,
    hudKey: s => Math.ceil(s.left / 60),
    hud: s => '⏱ ' + Math.ceil(s.left / 60) + ' с',
    win: s => s.score >= 250,
    result: s => ({
      title: s.score >= 450 ? '🌀 Мастер вращения!' : s.score >= 250 ? '🎉 Точная рука!' : '🌀 Время вышло',
      text: '🔥 серий: ' + s.fires,
    }),
    consts: { W, H, CX, CY, R, TIME, BAND, NB, BW, MAXR, GAIN, FLICK, FR, BR, WMAX, STILL, FIRE },
  });
})();
