// ═══════════════════════════════════════
//  ИГРА «ДРОН» (T-140) — тап: дрон подлетает; пролетай сквозь ворота ночного города. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, всё в единицах поля в секунду (тяга, тяжесть, ход ворот).
// Своё: дрон на батарейке — заряд тает каждую секунду, ⚡ в центре каждых пятых ворот подзаряжает (+4 с); пролёт точно через
// кольцо в центре ворот — +1 очко. Подзарядка всегда медленнее расхода — партия конечна (меньше 2 минут даже у идеального пилота).
// Исправлено против прототипа: (1) движение за кадр → в секунду (на экране 144 Гц прототип летел в 2,4 раза быстрее);
// (2) Math.random → rng из create (у соперников одинаковые ворота); (3) щель следующих ворот могла прыгнуть через всё поле —
// сдвиг ограничен (SHIFT), щель всегда достижима; (4) нажатие после падения сразу начинало заново — теперь итог ядра с защитой
// от позднего нажатия; (5) счёт рисовался поверх поля — теперь в строке над полем; (6) массив ворот пересоздавался каждый кадр
// (filter) — кольцо типизированных массивов; (7) касание потолка убивало — теперь потолок мягкий; (8) первые ворота появлялись
// сразу в момент старта — теперь дрон висит, пока не нажмёшь, а ворота приходят через ~2 с.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, GROUND = 410, DX = 84, HR = 9;           // дрон: x центра, радиус столкновения (рисунок шире — прощает)
  const GRAV = 1150, FLAP = -330, FALL = 520;                      // ед/с², ед/с
  const GW = 44, SPACE = 196, V0 = 128, DV = 1.1, VMAX = 178;      // ширина ворот, шаг ворот, скорость: старт, + за ворота, предел
  const HG0 = 60, DHG = .35, HGMIN = 46, SHIFT = 150;              // половина щели: старт, сужение за ворота, минимум; сдвиг центра
  const PERF = 13, BAT0 = 40, CHG = 4, EVERY = 5;                  // кольцо «в центр»; батарейка: старт и максимум, ⚡ +4 с, каждые 5 ворот
  const RING = 8, MASK = RING - 1;
  const C = { sky: '#121a31', star: 'rgba(255,255,255,.55)', city: '#1b2442', win: 'rgba(255,214,102,.5)', ground: '#1f2a4a', edge: '#35e0c3',
    gate: '#27325c', ring: 'rgba(255,255,255,.28)', ringHit: 'rgba(53,224,195,.75)', bolt: '#ffd166', body: '#ffc233', dark: '#141a2e',
    glass: '#bfe9ff', prop: 'rgba(230,236,255,.75)', bad: '#ff4d6d' };
  // небо и город — только для красоты, без rng (одинаковы у всех): звёзды и дома из своего простого генератора
  const STARS = new Float32Array(60), CITY = new Float32Array(32);
  { let a = 12345; const r = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let i = 0; i < 60; i += 2) { STARS[i] = r() * W; STARS[i + 1] = r() * 300; }
    for (let i = 0; i < 32; i++) CITY[i] = 40 + r() * 120; }

  function addGate(s){
    const i = s.count++, j = i & MASK, hg = Math.max(HGMIN, HG0 - DHG * i);
    const lo = hg + 40, hi = GROUND - hg - 30;
    let y = i === 0 ? 210 : s.lastY + (s.rng() * 2 - 1) * SHIFT;
    y = y < lo ? lo : y > hi ? hi : y;
    s.lastY = y;
    s.gx[j] = s.count === 1 ? W + 90 : s.gx[(i - 1) & MASK] + SPACE;
    s.gy[j] = y; s.gh[j] = hg; s.gs[j] = 0; s.gc[j] = 0;
    s.gb[j] = i % EVERY === EVERY - 1 ? 1 : 0;
  }

  function create(rng){
    const s = { rng, y: 200, py: 200, vy: 0, started: false, t: 0, bat: BAT0, spd: V0, dist: 0, pd: 0, score: 0, passed: 0, perfect: 0,
      bolts: 0, over: false, why: '', snd: 0, first: 0, count: 0, lastY: 210,
      gx: new Float64Array(RING), gy: new Float64Array(RING), gh: new Float64Array(RING), gs: new Uint8Array(RING), gc: new Uint8Array(RING), gb: new Uint8Array(RING) };
    while (s.count < 4) addGate(s);
    return s;
  }

  function input(s, e){
    if (s.over || (e.type !== T.DOWN && e.type !== T.KEY)) return;
    s.started = true;
    s.vy = FLAP;
    s.snd = 660;
  }

  function step(s, dt){
    s.py = s.y; s.pd = 0;
    if (!s.started) return;
    s.t += dt;
    s.bat -= dt;
    if (s.bat <= 0) { s.bat = 0; s.over = true; s.why = 'bat'; s.snd = 'bad'; return; }
    s.vy += GRAV * dt; if (s.vy > FALL) s.vy = FALL;
    s.y += s.vy * dt;
    if (s.y < HR) { s.y = HR; if (s.vy < 0) s.vy = 0; }
    s.spd = Math.min(VMAX, V0 + DV * s.passed);
    const d = s.spd * dt;
    s.pd = d; s.dist += d;
    for (let i = s.first; i < s.count; i++) {
      const j = i & MASK, x = (s.gx[j] -= d), gy = s.gy[j], hg = s.gh[j];
      if (!s.gc[j] && x + GW / 2 <= DX) {          // центр ворот прошёл через дрон: кольцо и ⚡
        const off = Math.abs(s.y - gy);
        s.gc[j] = off <= PERF ? 2 : 1;
        if (off <= PERF) { s.perfect++; s.score++; s.snd = 988; }
        if (s.gb[j] === 1 && off <= hg - 8) { s.gb[j] = 2; s.bolts++; s.bat = Math.min(BAT0, s.bat + CHG); s.snd = 1175; }
      }
      if (!s.gs[j] && x + GW < DX - HR) { s.gs[j] = 1; s.passed++; s.score++; if (!s.snd) s.snd = 'tick'; }
      if (x < DX + HR && x + GW > DX - HR && (s.y - HR < gy - hg || s.y + HR > gy + hg)) { s.over = true; s.why = 'gate'; s.snd = 'bad'; return; }
    }
    if (s.y + HR >= GROUND) { s.y = GROUND - HR; s.over = true; s.why = 'ground'; s.snd = 'bad'; return; }
    while (s.first < s.count && s.gx[s.first & MASK] + GW < -6) s.first++;
    while (s.count - s.first < RING && s.gx[(s.count - 1) & MASK] + SPACE <= W + 90) addGate(s);
  }

  function bolt(ctx, x, y){
    ctx.beginPath();
    ctx.moveTo(x + 2, y - 11); ctx.lineTo(x - 6, y + 2); ctx.lineTo(x - 1, y + 2);
    ctx.lineTo(x - 3, y + 11); ctx.lineTo(x + 6, y - 2); ctx.lineTo(x + 1, y - 2);
    ctx.closePath(); ctx.fill();
  }

  function draw(G, s, a){
    const ctx = G.ctx, back = s.over ? 0 : s.pd * (1 - a), dist = s.dist - back;
    const y = s.over ? s.y : s.py + (s.y - s.py) * a;
    ctx.fillStyle = C.sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.star;
    for (let i = 0; i < 60; i += 2) ctx.fillRect(STARS[i], STARS[i + 1], 1.5, 1.5);
    // город сзади едет медленнее (параллакс)
    const off = (dist * .3) % 40, b0 = Math.floor(dist * .3 / 40);
    for (let k = 0; k < 10; k++) {
      const h = CITY[(b0 + k) & 31], x = k * 40 - off;
      ctx.fillStyle = C.city; ctx.fillRect(x, GROUND - h, 36, h);
      ctx.fillStyle = C.win;
      for (let wy = GROUND - h + 10; wy < GROUND - 12; wy += 18) if (((b0 + k) * 7 + (wy | 0)) % 3) ctx.fillRect(x + 8, wy, 5, 6);
    }
    ctx.fillStyle = C.ground; ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = C.edge; ctx.fillRect(0, GROUND, W, 2);
    for (let i = s.first; i < s.count; i++) {
      const j = i & MASK, x = s.gx[j] + back, gy = s.gy[j], hg = s.gh[j];
      if (x > W + 4 || x + GW < -4) continue;
      ctx.fillStyle = C.gate;
      ctx.fillRect(x, 0, GW, gy - hg); ctx.fillRect(x, gy + hg, GW, GROUND - gy - hg);
      ctx.fillStyle = C.edge;
      ctx.fillRect(x, 0, 3, gy - hg); ctx.fillRect(x + GW - 3, 0, 3, gy - hg);
      ctx.fillRect(x, gy + hg, 3, GROUND - gy - hg); ctx.fillRect(x + GW - 3, gy + hg, 3, GROUND - gy - hg);
      ctx.fillRect(x - 4, gy - hg - 6, GW + 8, 6); ctx.fillRect(x - 4, gy + hg, GW + 8, 6);
      ctx.strokeStyle = s.gc[j] === 2 ? C.ringHit : C.ring; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x + GW / 2, gy, PERF + 6, 0, 6.2832); ctx.stroke();
      if (s.gb[j] === 1) { ctx.fillStyle = C.bolt; bolt(ctx, x + GW / 2, gy); }
    }
    // дрон: наклон по скорости, винты крутятся
    ctx.save();
    ctx.translate(DX, s.started ? y : y + 4 * Math.sin(G.now / 260));
    ctx.rotate(s.vy * .0007);
    ctx.fillStyle = s.over && s.why !== 'bat' ? C.bad : C.body;
    ctx.fillRect(-14, -5, 28, 10);
    ctx.fillStyle = C.glass; ctx.fillRect(2, -4, 8, 6);
    ctx.fillStyle = C.dark; ctx.fillRect(-19, -9, 6, 4); ctx.fillRect(13, -9, 6, 4); ctx.fillRect(-4, 5, 8, 3);
    const pw = s.over ? 8 : 4 + 9 * Math.abs(Math.sin(G.now / 35));
    ctx.fillStyle = C.prop; ctx.fillRect(-16 - pw, -11, pw * 2, 2); ctx.fillRect(16 - pw, -11, pw * 2, 2);
    ctx.restore();
  }

  ArcadeKit.define('drone', {
    kind: 'canvas', W, H,
    title: '🚁 Дрон',
    intro: 'Тап — дрон подлетает. Пролетай сквозь ворота и не задевай их. Батарейка тает — лови ⚡ в центре ворот. Кольцо в центре — +1 очко.',
    controls: 'Тап по полю, мышь или пробел / ↑ — подлететь.',
    duelTitle: 'Одинаковые ворота у обоих',
    keys: { Space: 0, ArrowUp: 0, KeyW: 0 },
    create, input, step, draw,
    hudKey: s => (s.started ? Math.ceil(s.bat) : -1),
    hud: s => (s.started ? '🔋 ' + Math.ceil(s.bat) + ' с' + (s.bat <= 8 ? ' — лови ⚡' : '') : 'Тап — взлёт'),
    win: s => s.score >= 40,
    result: s => ({
      title: s.why === 'bat' ? '🔋 Батарейка села' : s.score >= 80 ? '🏆 Ас-пилот!' : s.why === 'ground' ? '⬇️ Дрон упал' : '💥 Врезался в ворота',
      text: 'ворот: ' + s.passed + ' · в центр: ' + s.perfect + ' · ⚡ ' + s.bolts,
    }),
    consts: { W, H, GROUND, DX, HR, GRAV, FLAP, FALL, GW, SPACE, V0, DV, VMAX, HG0, DHG, HGMIN, SHIFT, PERF, BAT0, CHG, EVERY, RING },
  });
})();
