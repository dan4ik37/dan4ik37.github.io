// ═══════════════════════════════════════
//  ИГРА «СПУСК» (T-140) — огонёк спускается в пещеру сквозь каменные кольца: крути кольца пальцем, ныряй в щели, лаву обходи.
//  Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440: кольцо — полоса из 12 плит по ширине поля (развёртка),
// огонёк всегда посередине; скорости — в секунду, поворот — в плитах (единицы поля пальца / ширина плиты).
// Своё: пещера и огонёк; ⭐ золотая плита — отскок +3; дно на 60-м кольце — финиш, за каждую оставшуюся секунду +1;
// 2 минуты на спуск.
// Исправлено против прототипа: (1) тяжесть и отскок — за кадр → в секунду (на 144 Гц прототип падал в 2,4 раза быстрее);
// (2) поворот считали в пикселях экрана (/20) — на большом экране башня крутилась медленнее — теперь в единицах поля;
// (3) Math.random → rng (у соперников одна пещера); (4) кольца создавались лениво без конца (массив рос) — кольцо на 16 колец;
// (5) красные плиты могли выпасть на одну и ту же плиту или вплотную к щели — теперь не в щели и не рядом с ней;
// (6) можно было скакать на одной плите вечно — 2 минуты и дно на 60-м кольце; (7) тап после лавы сразу начинал заново —
// итог ядра; (8) не было клавиш — ← / →.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, NS = 12, SW = W / NS, RTH = 14, GAPY = 90, Y0 = 200, BR = 9, BX = W / 2, VIEW = 150;
  const G = 1500, VB = -470, VMAX = 600, KROT = 9, LIMIT = 120, NF = 60, RING = 16, M = RING - 1;   // тяжесть, отскок, предел падения; клавиши — плит/с
  const NORM = 0, HOLE = 1, LAVA = 2, GOLD = 3;
  const C = { bg: '#120f1c', wall: '#1d1830', wall2: '#251f3d', stone: '#6c5f8d', stoneTop: '#8a7cb0', lava: '#ff6b35', lavaTop: '#ffd166',
    gold: '#f2c94c', goldTop: '#fff3bf', ball: '#9be7ff', ballCore: '#ffffff', glow: 'rgba(155,231,255,.18)', bottom: '#40c057', bad: '#ff4d6d' };

  function ring(s, k){
    const j = k & M, b = j * NS, r = s.rng;
    for (let i = 0; i < NS; i++) s.seg[b + i] = NORM;
    if (k >= NF) { s.made = k + 1; return; }                  // дно — сплошное
    const g = Math.floor(r() * NS), wide = k < 6 ? 3 : 2;
    for (let i = 0; i < wide; i++) s.seg[b + (g + i) % NS] = HOLE;
    // лава: не в щели и не вплотную к ней; число растёт с глубиной (0 → 4)
    const nl = k < 2 ? 0 : Math.min(4, 1 + Math.floor(k / 12));
    for (let q = 0; q < nl; q++) {
      const i = (g + wide + 1 + Math.floor(r() * (NS - wide - 2))) % NS;
      s.seg[b + i] = LAVA;
    }
    if (k >= 1 && r() < .35) { const i = (g + wide + Math.floor(r() * (NS - wide))) % NS; if (s.seg[b + i] === NORM) s.seg[b + i] = GOLD; }
    s.made = k + 1;
  }

  function create(rng){
    const s = { rng, seg: new Uint8Array(RING * NS), made: 0, rot: 0, prot: 0, lx: 0, y: 100, py: 100, vy: 0, cam: 0, pcam: 0, floor: 0, golds: 0,
      started: false, t: 0, score: 0, over: false, why: '', snd: 0, seq: new Float32Array(8) };
    while (s.made < 8) ring(s, s.made);
    for (let i = 0; i < 8; i++) s.seq[i] = s.seg[NS + i] + 4 * s.seg[2 * NS + i];   // для ⚔️ сравнения: кольца одинаковы у соперников
    return s;
  }

  const under = s => { const v = (BX / SW - s.rot) % NS; const i = Math.floor(v < 0 ? v + NS : v); return i >= NS ? 0 : i; };   // плита под огоньком

  function input(s, e){
    if (s.over) return;
    if (e.type === T.DOWN) { s.lx = e.x; if (!s.started) { s.started = true; s.snd = 'move'; } return; }   // первый тап — старт
    if (e.type === T.MOVE && s.started) { s.rot += (e.x - s.lx) / SW; s.lx = e.x; if (s.rot > 1e4 || s.rot < -1e4) s.rot %= NS; return; }
    if (e.type === T.KEY && !s.started) { s.started = true; s.snd = 'move'; }
  }

  function step(s, dt, inp){
    s.py = s.y; s.pcam = s.cam; s.prot = s.rot;
    if (!s.started) return;
    s.t += dt;
    if (s.t >= LIMIT) { s.over = true; s.why = 'time'; s.snd = 'win'; return; }
    const keys = inp ? inp.keys : 0;
    if (keys & 3) s.rot += (((keys >> 1) & 1) - (keys & 1)) * KROT * dt;
    s.vy += G * dt; if (s.vy > VMAX) s.vy = VMAX;
    const y0 = s.y;
    s.y += s.vy * dt;
    // низ огонька пересёк верх кольца k за шаг
    const k = s.floor, top = Y0 + k * GAPY;
    if (s.vy > 0 && y0 + BR <= top && s.y + BR >= top) {
      const j = k & M, i = under(s), t = k >= NF ? NORM : s.seg[j * NS + i];
      if (k >= NF) { s.y = top - BR; s.score += Math.floor(LIMIT - s.t); s.over = true; s.why = 'bottom'; s.snd = 'win'; return; }
      if (t === HOLE) { s.floor++; s.score++; s.snd = 660 + 20 * (s.floor % 12); while (s.made < s.floor + 8) ring(s, s.made); }
      else if (t === LAVA) { s.y = top - BR; s.over = true; s.why = 'lava'; s.snd = 'bad'; return; }
      else {
        s.y = top - BR; s.vy = VB;
        if (t === GOLD) { s.seg[j * NS + i] = NORM; s.score += 3; s.golds++; s.snd = 1175; } else s.snd = 'tick';
      }
    }
    const want = s.y - VIEW;
    if (want > s.cam) s.cam = want;
  }

  function draw(Gx, s, al){
    const ctx = Gx.ctx, cam = s.over ? s.cam : s.pcam + (s.cam - s.pcam) * al, rot = s.over ? s.rot : s.prot + (s.rot - s.prot) * al;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    // стены пещеры: полосы едут с камерой
    ctx.fillStyle = C.wall;
    const off = ((-cam * .5) % 60 + 60) % 60;
    for (let y = off - 60; y < H; y += 60) ctx.fillRect(0, y, W, 24);
    // кольца: 12 плит со сдвигом rot (развёртка по кругу — плита у края продолжается с другой стороны)
    const k0 = Math.max(0, Math.floor((cam - Y0) / GAPY)), sh = ((rot % NS) + NS) % NS * SW;
    for (let k = k0; k < k0 + 7 && k <= NF; k++) {
      const y = Y0 + k * GAPY - cam;
      if (y > H) break;
      if (k < s.floor) continue;                               // пройденные кольца уже позади
      const j = k & M;
      for (let i = 0; i < NS; i++) {
        const t = k >= NF ? -1 : s.seg[j * NS + i];
        if (t === HOLE) continue;
        let x = i * SW + sh; if (x >= W) x -= W;
        ctx.fillStyle = t === -1 ? C.bottom : t === LAVA ? C.lava : t === GOLD ? C.gold : C.stone;
        ctx.fillRect(x, y, SW - 1, RTH);
        if (x + SW > W) ctx.fillRect(x - W, y, SW - 1, RTH);
        ctx.fillStyle = t === LAVA ? C.lavaTop : t === GOLD ? C.goldTop : C.stoneTop;
        ctx.fillRect(x, y, SW - 1, 3);
        if (x + SW > W) ctx.fillRect(x - W, y, SW - 1, 3);
      }
    }
    // огонёк
    const by = (s.over ? s.y : s.py + (s.y - s.py) * al) - cam;
    ctx.fillStyle = C.glow; ctx.beginPath(); ctx.arc(BX, by, BR + 8, 0, 6.2832); ctx.fill();
    ctx.fillStyle = s.over && s.why === 'lava' ? C.bad : C.ball; ctx.beginPath(); ctx.arc(BX, by, BR, 0, 6.2832); ctx.fill();
    ctx.fillStyle = C.ballCore; ctx.beginPath(); ctx.arc(BX - 2, by - 2, 3, 0, 6.2832); ctx.fill();
  }

  ArcadeKit.define('descent', {
    kind: 'canvas', W, H,
    title: '🔻 Спуск',
    intro: 'Огонёк спускается в пещеру. Води пальцем влево-вправо — кольца крутятся. Ныряй в щели, на 🔥 лаву не падай. ⭐ золото — +3. До дна 60 колец, на всё 2 минуты. Первый тап — старт.',
    controls: 'Палец или мышь — тяни влево / вправо. Клавиши ← / → или A / D.',
    duelTitle: 'Одинаковая пещера у обоих',
    keys: { ArrowLeft: 0, KeyA: 0, ArrowRight: 1, KeyD: 1 },
    drag: true,
    create, input, step, draw, gen: ring,   // gen — для тестов генератора колец (scripts/arcade/descent.cjs)
    hudKey: s => (s.started ? Math.ceil(LIMIT - s.t) * 100 + s.floor : -1),
    hud: s => (s.started ? '⏱ ' + Math.ceil(LIMIT - s.t) + ' с · кольцо ' + s.floor + ' из ' + NF : 'Тап — старт'),
    win: s => s.floor >= 20,
    result: s => ({
      title: s.why === 'bottom' ? '🏆 Дно пещеры!' : s.why === 'time' ? '⏱ Время вышло' : '🔥 Огонёк упал в лаву',
      text: 'колец: ' + s.floor + (s.golds ? ' · ⭐ ' + s.golds : ''),
    }),
    consts: { W, H, NS, SW, RTH, GAPY, Y0, BR, BX, VIEW, G, VB, VMAX, KROT, LIMIT, NF, RING, NORM, HOLE, LAVA, GOLD },
  });
})();
