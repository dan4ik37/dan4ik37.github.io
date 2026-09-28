// ═══════════════════════════════════════
//  ИГРА «ЛОВИ ДОНАТЫ» — аркада на canvas
// ═══════════════════════════════════════
// Лови 💰 (+10) и 💎 (+50), ❤️ возвращает жизнь, 🚫 бан и 💣 бомба — минус жизнь.
// Управление: мышь/палец (тянуть), стрелки или A/D. Скорость растёт со временем.
(() => {
  const ITEMS = [
    { e: '💰', pts: 10, w: 60 },
    { e: '💎', pts: 50, w: 7 },
    { e: '❤️', life: 1, w: 3 },
    { e: '🚫', hurt: 1, w: 18 },
    { e: '💣', hurt: 1, w: 12 },
  ];
  const TOTAL_W = ITEMS.reduce((s, i) => s + i.w, 0);
  let root, api, cv, ctx, st, raf = 0, keys = {}, onKey, onKeyUp, onResize, onVis;

  function pickItem(){
    let x = Math.random() * TOTAL_W;
    for (const it of ITEMS) { if ((x -= it.w) < 0) return it; }
    return ITEMS[0];
  }

  function size(){
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.min(root.clientWidth, 560);
    const h = Math.round(Math.min(520, w * 1.05));
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (st) { st.W = w; st.H = h; st.px = Math.min(st.px, w - st.pw / 2); }
  }

  function reset(){
    st = { W: cv.clientWidth, H: cv.clientHeight, px: cv.clientWidth / 2, pw: 76, items: [], pops: [], score: 0, lives: 3, t: 0, spawn: 0, over: false, running: false, last: 0, caught: 0 };
  }

  function start(){
    reset();
    st.running = true;
    st.last = performance.now();
    root.querySelector('#caOver').hidden = true;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function loop(now){
    if (!st || !st.running) return;
    const dt = Math.min(50, now - st.last) / 1000;
    st.last = now;
    st.t += dt;
    const speed = 150 + st.t * 7;          // пикселей в секунду, растёт
    const every = Math.max(.28, .9 - st.t * .012);
    // Клавиатура
    const kv = (keys.ArrowLeft || keys.a || keys['ф'] ? -1 : 0) + (keys.ArrowRight || keys.d || keys['в'] ? 1 : 0);
    if (kv) st.px = Math.max(st.pw / 2, Math.min(st.W - st.pw / 2, st.px + kv * 420 * dt));
    // Появление
    st.spawn -= dt;
    if (st.spawn <= 0) {
      st.spawn = every * (.6 + Math.random() * .8);
      const it = pickItem();
      st.items.push({ ...it, x: 20 + Math.random() * (st.W - 40), y: -30, v: speed * (.85 + Math.random() * .35), rot: (Math.random() - .5) * 2 });
    }
    // Движение и ловля
    const py = st.H - 34;
    for (const it of st.items) {
      it.y += it.v * dt;
      if (!it.done && it.y > py - 26 && it.y < py + 14 && Math.abs(it.x - st.px) < st.pw / 2 + 12) {
        it.done = true;
        if (it.pts) { st.score += it.pts; st.caught++; pop(it.x, py - 30, '+' + it.pts, '#ffd166'); api.sfx('ok'); }
        if (it.life) { st.lives = Math.min(5, st.lives + 1); pop(it.x, py - 30, '+❤️', '#ff6b8a'); api.sfx('ok'); }
        if (it.hurt) { st.lives--; pop(it.x, py - 30, it.e === '🚫' ? 'БАН!' : 'БУМ!', '#f87171'); api.sfx('bad'); st.shake = .25; }
      }
    }
    st.items = st.items.filter(it => !it.done && it.y < st.H + 40);
    st.pops = st.pops.filter(p => (p.t -= dt) > 0);
    if (st.shake) st.shake = Math.max(0, st.shake - dt);
    draw();
    if (st.lives <= 0) return gameOver();
    raf = requestAnimationFrame(loop);
  }

  function pop(x, y, text, color){ st.pops.push({ x, y, text, color, t: .8 }); }

  function draw(){
    const { W, H } = st;
    ctx.save();
    if (st.shake) ctx.translate((Math.random() - .5) * 8, (Math.random() - .5) * 8);
    ctx.clearRect(-10, -10, W + 20, H + 20);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#120c1f'); g.addColorStop(1, '#1d1030');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '28px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
    for (const it of st.items) {
      ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(it.rot * .2 * Math.sin(it.y / 40)); ctx.fillText(it.e, 0, 0); ctx.restore();
    }
    // Ловушка-«стрим»: платформа с логотипом
    const py = st.H - 34;
    ctx.fillStyle = 'rgba(255,45,85,.9)';
    roundRect(st.px - st.pw / 2, py - 8, st.pw, 20, 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Montserrat, sans-serif';
    ctx.fillText('D37', st.px, py + 2);
    // Всплывашки
    for (const p of st.pops) {
      ctx.globalAlpha = Math.min(1, p.t / .4);
      ctx.fillStyle = p.color; ctx.font = 'bold 16px Montserrat, sans-serif';
      ctx.fillText(p.text, p.x, p.y - (0.8 - p.t) * 40);
    }
    ctx.globalAlpha = 1;
    // Счёт и жизни
    ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = 'bold 18px Montserrat, sans-serif';
    ctx.fillText(st.score.toLocaleString('ru'), 14, 22);
    ctx.textAlign = 'right'; ctx.font = '16px system-ui, "Segoe UI Emoji", sans-serif';
    ctx.fillText('❤️'.repeat(Math.max(0, st.lives)), W - 12, 22);
    ctx.restore();
  }
  function roundRect(x, y, w, h, r){ ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function gameOver(){
    st.running = false;
    cancelAnimationFrame(raf);
    api.sfx(st.score >= 500 ? 'win' : 'bad');
    const best = Math.max(api.local().best || 0, st.score);
    const box = root.querySelector('#caOver');
    box.hidden = false;
    box.querySelector('.ca-title').textContent = st.score >= 1000 ? '🤑 Щедрый стрим!' : st.score >= 500 ? '🎉 Отличный улов!' : '💸 Донаты утекли';
    box.querySelector('.ca-score').innerHTML = `Счёт: <b>${st.score.toLocaleString('ru')}</b> · поймано: ${st.caught} · рекорд: ${best.toLocaleString('ru')}`;
    root.querySelector('#caStart').textContent = '↻ Ещё раз';
    api.report('catch', st.score >= 500, st.score, st.score);
  }

  function pointer(e){
    if (!st?.running) return;
    const r = cv.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    st.px = Math.max(st.pw / 2, Math.min(st.W - st.pw / 2, x));
  }

  window.GAME_IMPL.catch = {
    mount(el, gameApi){
      root = el; api = gameApi;
      root.innerHTML = `<div class="ca">
          <div class="ca-wrap"><canvas id="caCanvas"></canvas>
            <div class="ca-over" id="caOver"><div class="ca-title">💰 Лови донаты!</div>
              <div class="ca-score">Лови 💰 и 💎, ❤️ — жизнь. Уворачивайся от 🚫 банов и 💣 бомб.</div>
              <button class="ct-start" id="caStart">▶ Начать</button></div></div>
          <div class="ct-note" style="text-align:center">Мышь или палец — двигай платформу, на клавиатуре — ← → или A / D.</div>
        </div>`;
      cv = root.querySelector('#caCanvas'); ctx = cv.getContext('2d');
      size(); reset(); draw();
      root.querySelector('#caStart').onclick = start;
      cv.addEventListener('mousemove', pointer);
      cv.addEventListener('touchstart', pointer, { passive: true });
      cv.addEventListener('touchmove', e => { pointer(e); e.preventDefault(); }, { passive: false });
      onKey = e => { if (e.target?.closest?.('input,textarea')) return; keys[e.key] = true; if (st?.running && /Arrow(Left|Right)/.test(e.key)) e.preventDefault(); };
      onKeyUp = e => { keys[e.key] = false; };
      onResize = () => { size(); if (!st.running) draw(); };
      // Вкладку свернули — пауза (иначе после возврата dt огромный и всё рухнет разом)
      onVis = () => { if (document.hidden && st?.running) { st.running = false; cancelAnimationFrame(raf); root.querySelector('#caOver').hidden = false; root.querySelector('.ca-title').textContent = '⏸ Пауза'; root.querySelector('#caStart').textContent = '▶ Продолжить'; root.querySelector('#caStart').onclick = resume; } };
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('resize', onResize);
      document.addEventListener('visibilitychange', onVis);
    },
    unmount(){
      if (st) st.running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      keys = {}; root = null;
    },
  };
  function resume(){
    root.querySelector('#caOver').hidden = true;
    root.querySelector('#caStart').onclick = start;
    st.running = true; st.last = performance.now();
    raf = requestAnimationFrame(loop);
  }
})();
