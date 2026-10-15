// ═══════════════════════════════════════
//  2D-ПЕРСОНАЖ: ВИТРИНА И ДЕМО (листы — js/core/char2d.js)
// ═══════════════════════════════════════
// D37SpriteView.wardrobe(el) — кнопка «🎞 2D» в гардеробе (3D-редактор): как твой персонаж выглядит в 2D-играх — сбоку,
//   сверху на 8 сторон, портрет; все стили и анимации; «Стиль в играх» (D37Sprite.setMyStyle: «как задумано игрой» или свой).
// #/games/sprites — скрытая демо-страница (нет в каталоге): платформер сбоку и мир сверху с толпой случайных персонажей
//   (VIP-части, свои цвета), все анимации своего персонажа и цифры печи (листы, память, мс на кадр, из кэша). Для проверок.
(() => {
  const SP = () => window.D37Sprite, C = () => window.D37Char;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const EF = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  const CSS = `
.spv-btn{position:absolute;left:10px;top:54px;z-index:4;border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:.38rem .8rem;background:rgba(10,8,24,.62);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);color:#fff;font:800 .82rem 'Montserrat',sans-serif;cursor:pointer}
.spv-btn.on{background:var(--accent,#9b6dff);border-color:transparent}
.spv-pane{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;background:radial-gradient(120% 90% at 50% 78%,#3d3285 0%,#1e1945 55%,#120f28 100%);border-radius:inherit;overflow:hidden}
.spv-cv{flex:1;min-height:150px;width:100%;display:block;touch-action:pan-y}
.spv-rows{display:flex;flex-direction:column;gap:4px;padding:6px 8px 8px;background:rgba(10,8,24,.55)}
.spv-row{display:flex;gap:5px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.spv-row::-webkit-scrollbar{display:none}
.spv-chip{flex:none;border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:.3rem .65rem;background:rgba(255,255,255,.06);color:#e2e8f0;font:700 .76rem 'Montserrat',sans-serif;cursor:pointer;white-space:nowrap}
.spv-chip.on{background:linear-gradient(135deg,rgba(155,109,255,.55),rgba(255,111,181,.4));border-color:transparent;color:#fff}
.spv-pref{display:flex;align-items:center;gap:6px;color:#cbd5e1;font:700 .76rem 'Montserrat',sans-serif;flex-wrap:wrap}
.spv-pref select{background:#1e1945;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:.2rem .4rem;font:700 .76rem 'Montserrat',sans-serif}
.spv-mini{position:absolute;right:10px;bottom:64px;width:64px;height:64px;z-index:2;border-radius:14px;background:rgba(10,8,24,.62);border:1px solid rgba(255,255,255,.14);cursor:pointer}
.spv-x{position:absolute;right:10px;top:54px;z-index:4;width:34px;height:34px;border-radius:50%;border:0;background:rgba(10,8,24,.62);color:#fff;font-size:1rem;cursor:pointer}
.spd{display:flex;flex-direction:column;gap:10px}
.spd-head b{font:900 1.1rem 'Montserrat',sans-serif;color:#fff}.spd-head span{display:block;color:var(--muted,#94a3b8);font-size:.85rem;margin-top:2px}
.spd-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.spd-bar select,.spd-bar button{background:rgba(255,255,255,.07);color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:999px;padding:.32rem .75rem;font:700 .8rem 'Montserrat',sans-serif;cursor:pointer}
.spd-bar button.on{background:var(--accent,#9b6dff);border-color:transparent}
.spd-cv{width:100%;display:block;border-radius:14px;border:1px solid rgba(255,255,255,.08);touch-action:pan-y}
.spd-cap{color:var(--muted,#94a3b8);font:700 .78rem 'Montserrat',sans-serif;margin:2px 0 -4px}
.spd-stats{font:600 .78rem/1.5 ui-monospace,Consolas,monospace;color:#cbd5e1;background:rgba(10,8,24,.45);border-radius:10px;padding:8px 10px;white-space:pre-wrap;word-break:break-word}`;
  function css(){ if (document.getElementById('spv-css')) return; const s = document.createElement('style'); s.id = 'spv-css'; s.textContent = CSS; document.head.appendChild(s); }
  const EMOS = () => Object.keys(SP().ANIMS).filter(a => SP().ANIMS[a].emo);
  const VIEW_ANIMS = {
    get side(){ return Object.keys(SP().ANIMS); },
    get iso8(){ return ['idle', 'walk', 'run', 'sit', ...EMOS()]; },
    get front(){ return ['idle', ...EMOS()]; },
  };
  const VIEW_NAME = { side: 'Сбоку', iso8: 'Сверху · 8 сторон', front: 'Портрет' };
  function fit(cv){
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(100, Math.round(r.width)), h = Math.max(100, Math.round(r.height));
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    return { w, h, dpr };
  }
  const now = () => performance.now();

  // ═══ Гардероб: «🎞 2D» ═══
  let W = null;
  function wardrobe(el){
    close();
    if (!SP() || !C()) return;
    css();
    const host = el.querySelector('.ce-stage') || el;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'spv-btn'; btn.textContent = '🎞 2D';
    btn.title = 'Как твой персонаж выглядит в 2D-играх';
    host.appendChild(btn);
    W = { el, host, btn, pane: null, raf: 0, view: 'side', style: SP().styleFor('toon'), anim: 'walk', hs: [], look: null, t0: now(), off: null, mini: null, mh: null, miniT: 0 };
    btn.addEventListener('click', () => (W?.pane ? hide() : show()));
    W.off = C().on(look => { if (W?.pane) handles(true); W?.mh?.set(look); });
    mini();
  }
  // Окошко редактора «так ты выглядишь в 2D-играх» (.ce-2d, рисует старого 2D-персонажа) — накрываем живой 2D-проекцией
  // на том же месте (те же right/bottom/размер — переживает смену размера); нажал — панель «🎞 2D»
  function mini(){
    const old = W.host.querySelector('.ce-2d');
    if (!old) return;
    const cs = getComputedStyle(old), c = document.createElement('canvas');
    c.className = 'spv-mini'; c.title = 'Так ты выглядишь в 2D-играх — нажми, чтобы посмотреть все виды и стили';
    for (const k of ['right', 'bottom', 'width', 'height', 'borderRadius']) if (cs[k] && cs[k] !== 'auto') c.style[k] = cs[k];
    W.host.appendChild(c);
    c.addEventListener('click', () => (W?.pane ? hide() : show()));
    W.mini = c;
    W.mh = SP().handle(C().look(), { view: 'side', size: 56, style: SP().styleFor('toon'), anims: ['idle'], key: SP().myKey(), pin: true });
    const paintMini = () => {
      if (!W?.mini?.isConnected) return;
      const r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(16, Math.round(r.width)), h = Math.max(16, Math.round(r.height));
      if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      W.mh.draw(g, 'idle', (now() - W.t0) / 1000, w / 2, h * .94, { h: h * .98 });
    };
    W.miniT = setInterval(paintMini, 200);
    paintMini();
  }
  function show(){
    if (!W) return;
    const p = W.pane = document.createElement('div');
    p.className = 'spv-pane';
    p.innerHTML = `<canvas class="spv-cv" aria-label="Твой персонаж в 2D"></canvas>
      <div class="spv-rows">
        <div class="spv-row" data-row="view">${Object.keys(VIEW_NAME).map(v => `<button type="button" class="spv-chip" data-view="${v}">${VIEW_NAME[v]}</button>`).join('')}</div>
        <div class="spv-row" data-row="style">${SP().STYLE_LIST.map(s => `<button type="button" class="spv-chip" data-style="${s}">${SP().STYLES[s].icon} ${esc(SP().STYLES[s].name)}</button>`).join('')}</div>
        <div class="spv-row" data-row="anim"></div>
        <label class="spv-pref">Стиль в играх: <select>${['auto', ...SP().STYLE_LIST].map(s => `<option value="${s}">${s === 'auto' ? 'как задумано игрой' : esc(SP().STYLES[s].name)}</option>`).join('')}</select></label>
      </div>
      <button type="button" class="spv-x" aria-label="Закрыть 2D">✕</button>`;
    W.host.appendChild(p);
    W.btn.classList.add('on');
    p.querySelector('select').value = SP().myStyle();
    p.querySelector('select').addEventListener('change', e => { SP().setMyStyle(e.target.value); });
    p.querySelector('.spv-x').addEventListener('click', hide);
    p.querySelector('.spv-rows').addEventListener('click', e => {
      const b = e.target.closest('.spv-chip');
      if (!b) return;
      if (b.dataset.view) { W.view = b.dataset.view; if (!VIEW_ANIMS[W.view].includes(W.anim)) W.anim = W.view === 'front' ? 'idle' : 'walk'; handles(); }
      if (b.dataset.style) { W.style = b.dataset.style; handles(); }
      if (b.dataset.anim) { W.anim = b.dataset.anim; W.t0 = now(); }
      chips();
    });
    handles();
    chips();
    const frame = () => { if (!W?.pane) return; W.raf = requestAnimationFrame(frame); paint(); };
    W.raf = requestAnimationFrame(frame);
  }
  function hide(){
    if (!W) return;
    cancelAnimationFrame(W.raf);
    W.pane?.remove(); W.pane = null;
    W.btn.classList.remove('on');
  }
  function close(){
    if (!W) return;
    hide(); W.off?.(); W.btn.remove();
    clearInterval(W.miniT); W.mini?.remove();
    W = null;
  }
  function chips(){
    const p = W.pane;
    p.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === W.view));
    p.querySelectorAll('[data-style]').forEach(b => b.classList.toggle('on', b.dataset.style === W.style));
    const row = p.querySelector('[data-row="anim"]');
    row.innerHTML = VIEW_ANIMS[W.view].map(a => `<button type="button" class="spv-chip${a === W.anim ? ' on' : ''}" data-anim="${a}">${esc(SP().ANIMS[a].name)}</button>`).join('');
  }
  function handles(force){
    const look = C().look();
    if (!force && W.look && JSON.stringify(look) === JSON.stringify(W.look) && W.hs.key === W.view + W.style) return;
    W.look = look;
    const big = W.view === 'iso8' ? 72 : W.view === 'front' ? 168 : 150;
    const h = SP().handle(look, { view: W.view, size: big, style: W.style, anims: ['idle', W.anim], key: SP().myKey(), pin: true });
    W.hs = [h]; W.hs.key = W.view + W.style;   // остальные анимации допекутся, когда их выберут
  }
  function paint(){
    const cv = W.pane.querySelector('.spv-cv'), { w, h, dpr } = fit(cv), g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const H = W.hs[0], t = (now() - W.t0) / 1000;
    if (!H) return;
    const gy = h * .86;
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(0, gy, w, 2);
    if (W.view === 'iso8') {   // все 8 сторон по кругу
      const R = Math.min(w * .36, h * .32), cx = w / 2, cy = h * .52, sz = Math.min(80, h * .28);
      const order = [4, 5, 3, 6, 2, 7, 1, 0];   // дальние — первыми
      for (const d of order) {
        const a = d * Math.PI / 4, x = cx + Math.sin(a) * R, y = cy + Math.cos(a) * R * .55 + sz * .45;
        H.draw(g, W.anim, t + d * .07, x, y, { dir: d, h: sz });
      }
    } else {
      const sz = Math.min(h * .78, w * .7), x = w / 2;
      H.draw(g, W.anim, t, x, W.view === 'front' ? h * .92 : gy, { h: sz, flip: false });
      const pet = C().petEmoji(W.look);
      if (pet && W.view === 'side') { g.font = `${Math.round(sz * .22)}px ${EF}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(pet, x - sz * .55, gy - Math.abs(Math.sin(t * 6)) * sz * .05); }
    }
    if (!H.ready(W.anim)) {
      g.fillStyle = 'rgba(255,255,255,.75)'; g.font = "700 12px 'Montserrat',sans-serif"; g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(SP().supported() ? '⏳ Печём кадры из 3D…' : 'Нет WebGL — в играх простой 2D-персонаж', 10, h - 22);
    }
  }

  // ═══ Демо: #/games/sprites ═══
  let D = null;
  function randomLook(seed){
    let s = (seed * 2654435761) >>> 0;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const P = C().PARTS, L = {};
    for (const sl of C().SLOTS) {
      const list = P[sl].list;
      if (P[sl].pal && rnd() < .3) L[sl] = 'x' + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0');
      else L[sl] = list[Math.floor(rnd() * list.length)][0];
    }
    if (rnd() < .5) L.item = 'none';
    L.pet = 'none';
    return L;
  }
  function demoMount(el, api){
    css();
    el.innerHTML = `<div class="spd">
      <div class="spd-head"><b>🎞 2D-персонажи</b><span>Проекция настоящего 3D-персонажа: сбоку (платформеры) и сверху на 8 сторон. Кадры печёт скрытый 3D-рендер, потом — из кэша браузера.</span></div>
      <div class="spd-bar">
        ${SP().STYLE_LIST.map(s => `<button type="button" data-style="${s}">${SP().STYLES[s].icon} ${esc(SP().STYLES[s].name)}</button>`).join('')}
        <select data-size aria-label="Размер">${[48, 64, 96, 128].map(n => `<option value="${n}">${n} px</option>`).join('')}</select>
        <button type="button" data-act="new">🎲 Новые персонажи</button>
        <button type="button" data-act="clear">🗑 Очистить кэш</button>
      </div>
      <div class="spd-cap">Сбоку — как в платформере</div><canvas class="spd-cv spd-side" style="height:260px"></canvas>
      <div class="spd-cap">Сверху — 8 сторон, как в 2D-мире</div><canvas class="spd-cv spd-top" style="height:320px"></canvas>
      <div class="spd-cap">Все анимации твоего персонажа</div><canvas class="spd-cv spd-all" style="height:520px"></canvas>
      <div class="spd-stats">…</div>
    </div>`;
    D = { el, api, style: SP().styleFor('toon'), size: 64, seed: 1, side: [], top: [], all: null, raf: 0, last: now(), statT: 0 };
    el.querySelector('[data-size]').value = '64';
    el.querySelector('.spd-bar').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.style) { D.style = b.dataset.style; build(); }
      if (b.dataset.act === 'new') { D.seed++; build(); }
      if (b.dataset.act === 'clear') { SP().clear(true); build(); api?.toast?.('🗑 Кэш листов очищен — печём заново'); }
    });
    el.querySelector('[data-size]').addEventListener('change', e => { D.size = +e.target.value; build(); });
    build();
    const frame = t => { if (!D) return; D.raf = requestAnimationFrame(frame); const dt = Math.min(.05, (t - D.last) / 1000); D.last = t; step(dt); paintDemo(t / 1000); };
    D.raf = requestAnimationFrame(frame);
  }
  function build(){
    D.el.querySelectorAll('[data-style]').forEach(b => b.classList.toggle('on', b.dataset.style === D.style));
    const S = SP(), me = C().look(), mk = S.myKey();
    const looks = [me, ...[1, 2, 3, 4, 5, 6, 7].map(i => randomLook(D.seed * 100 + i))];
    const opt = (view, i, anims) => ({ view, size: D.size, style: D.style, anims, key: i ? 'demo-' + D.seed + '-' + i : mk, pin: !i });
    const sw = D.el.querySelector('.spd-side').getBoundingClientRect().width || 600;
    D.side = looks.slice(0, 5).map((L, i) => ({ h: S.handle(L, opt('side', i, ['idle', 'walk', 'run', 'jump', 'fall', 'use', 'phone', 'call', 'wave', 'dance', 'cheer'])), x: (i + .5) / 5 * sw, y: 0, vx: 0, vy: 0, st: 'idle', t: 0, at: Math.random() * 2, face: i % 2 ? -1 : 1, air: false, jt: 0 }));
    D.top = looks.map((L, i) => ({ h: S.handle(L, opt('iso8', i, ['idle', 'walk'])), x: 40 + ((i * 97) % 100) / 100 * (sw - 80), y: 60 + (i * 53) % 220, tx: 0, ty: 0, d: i % 8, st: 'idle', t: 0, at: Math.random() * 2 }));
    D.all = S.handle(me, opt('side', 0, VIEW_ANIMS.side));
    D.all.want(VIEW_ANIMS.side);
  }
  // Простые «жители»: ходят, бегут, прыгают, машут; сверху — к случайной точке, 8 сторон
  function step(dt){
    const sideCv = D.el.querySelector('.spd-side'), W2 = sideCv.getBoundingClientRect().width || 600, H2 = 260, G = H2 - 34;
    const plats = [[W2 * .22, G - 70, 120], [W2 * .62, G - 110, 140]];
    for (const c of D.side) {
      c.t += dt; c.at -= dt;
      if (c.at <= 0 && !c.air) {
        const r = Math.random();
        const E = EMOS();
        c.st = r < .28 ? 'walk' : r < .5 ? 'run' : r < .62 ? 'idle' : r < .72 ? 'jump' : r < .78 ? 'use' : r < .88 ? (r < .83 ? 'phone' : 'call') : E[Math.floor(Math.random() * E.length)];   // телефон 📱 — постоят, посмотрят, поговорят
        c.at = c.st === 'jump' ? 0 : 1 + Math.random() * 2.5; c.t = 0;
        if (c.st === 'walk' || c.st === 'run') c.face = Math.random() < .5 ? -1 : 1;
        if (c.st === 'jump') { c.vy = -520; c.air = true; c.jt = 0; c.st = Math.random() < .5 ? 'run' : 'walk'; }
      }
      const sp = c.st === 'run' ? 170 : c.st === 'walk' ? 80 : 0;
      c.vx = sp * c.face;
      c.x += c.vx * dt;
      if (c.x < 20) { c.x = 20; c.face = 1; } if (c.x > W2 - 20) { c.x = W2 - 20; c.face = -1; }
      if (c.air || c.y < G) {
        c.vy += 1300 * dt; const oy = c.y; c.y += c.vy * dt; c.jt += dt; c.air = true;
        let floor = G;
        for (const [px, py, pw] of plats) if (c.x > px && c.x < px + pw && oy <= py && c.y >= py && c.vy > 0) floor = py;
        if (c.y >= floor) { c.y = floor; c.vy = 0; c.air = false; }
      } else if (c.y > G || !c.y) c.y = G;
      if (!c.air && c.y < G && !plats.some(([px, py, pw]) => Math.abs(c.y - py) < 1 && c.x > px && c.x < px + pw)) { c.air = true; c.vy = 0; }
    }
    const topCv = D.el.querySelector('.spd-top'), W3 = topCv.getBoundingClientRect().width || 600, H3 = 320;
    for (const c of D.top) {
      c.t += dt; c.at -= dt;
      if (c.at <= 0) {
        const r = Math.random();
        if (r < .65) { c.st = 'walk'; c.tx = 40 + Math.random() * (W3 - 80); c.ty = 70 + Math.random() * (H3 - 90); c.at = 9; }
        else { const E = EMOS(); c.st = r < .8 ? 'idle' : E[Math.floor(Math.random() * E.length)]; c.at = 1.5 + Math.random() * 2; }
        c.t = 0;
      }
      if (c.st === 'walk') {
        const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
        if (d < 4) { c.st = 'idle'; c.at = .8 + Math.random() * 2; c.t = 0; }
        else { c.x += dx / d * 70 * dt; c.y += dy / d * 70 * dt; c.d = SP().dir8(dx, dy, c.d); }
      }
    }
  }
  function sky(g, w, h){
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#7cc8ff'); gr.addColorStop(1, '#d9f1ff');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#9bd17a';
    for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(i * w / 5, h - 40, w / 5, 60, 0, Math.PI, 0); g.fill(); }
  }
  function paintDemo(time){
    const S = SP();
    // сбоку
    {
      const cv = D.el.querySelector('.spd-side'), { w, h, dpr } = fit(cv), g = cv.getContext('2d'), G = h - 34;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      sky(g, w, h);
      g.fillStyle = '#6b4f2e'; g.fillRect(0, G, w, h - G); g.fillStyle = '#4caf50'; g.fillRect(0, G, w, 8);
      for (const [px, py, pw] of [[w * .22, G - 70, 120], [w * .62, G - 110, 140]]) { g.fillStyle = '#8d6e4a'; g.fillRect(px, py, pw, 14); g.fillStyle = '#4caf50'; g.fillRect(px, py, pw, 5); }
      for (const c of D.side) {
        const anim = c.air ? (c.vy < 0 ? 'jump' : 'fall') : c.st;
        c.h.draw(g, anim, c.air ? c.jt : c.t, c.x, c.y || G, { flip: c.face < 0, h: D.size });
      }
    }
    // сверху
    {
      const cv = D.el.querySelector('.spd-top'), { w, h, dpr } = fit(cv), g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#5c9e4a'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,.06)';
      for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 * 32; x < w; x += 64) g.fillRect(x, y, 32, 32);
      const items = D.top.map(c => ({ y: c.y, f: () => c.h.draw(g, c.st, c.t, c.x, c.y, { dir: c.d, h: D.size }) }));
      for (let i = 0; i < 5; i++) { const x = (i * 211 + 60) % (w - 40) + 20, y = 40 + (i * 97) % (h - 60); items.push({ y, f: () => { g.font = `46px ${EF}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText('🌳', x, y + 6); } }); }
      items.sort((a, b) => a.y - b.y).forEach(it => it.f());
    }
    // все анимации своего
    {
      const cv = D.el.querySelector('.spd-all'), { w, h, dpr } = fit(cv), g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#1e1945'; g.fillRect(0, 0, w, h);
      const list = VIEW_ANIMS.side, cols = w < 520 ? 4 : 7, cw = w / cols, rows = Math.ceil(list.length / cols), rh = h / rows, sz = Math.min(rh * .72, cw * .9, D.size * 1.2);
      list.forEach((a, i) => {
        const x = (i % cols + .5) * cw, y = (Math.floor(i / cols) + .82) * rh;
        g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x - cw * .42, y, cw * .84, 2);
        D.all.draw(g, a, time % (S.ANIMS[a].loop ? 99 : 1.2), x, y, { h: sz, item: a === 'use' ? '🗡️' : null });
        g.fillStyle = '#cbd5e1'; g.font = "700 11px 'Montserrat',sans-serif"; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(S.ANIMS[a].name, x, y + 4);
      });
    }
    // цифры
    if (time - D.statT > .5) {
      D.statT = time;
      const s = S.stats();
      D.el.querySelector('.spd-stats').textContent = `WebGL: ${s.gl ? 'да' : 'нет'} · листов: ${s.sheets} (анимаций ${s.anims}) · память: ${s.mb} из ${s.budgetMb} МБ · в очереди: ${s.queue}\n` +
        `испечено кадров: ${s.frames} · ЦП: ${s.cpuMs} мс (${s.cpuPerFrame} мс на кадр) · самый долгий кусок: ${s.longestSliceMs} мс · первый idle: ${s.firstIdleMs ?? '—'} мс · из кэша: ${s.fromIdb}\n` +
        (s.log.slice(-4).map(l => `${l.view}/${l.style} ${l.anim}: ${l.frames} кадров, ${l.cpu} мс ЦП, ${l.kb} КБ`).join('\n'));
    }
  }
  function demoUnmount(){ if (!D) return; cancelAnimationFrame(D.raf); D = null; }

  window.GAME_IMPL = window.GAME_IMPL || {};
  window.GAME_IMPL.sprites = { mount: demoMount, unmount: demoUnmount };
  window.D37SpriteView = { wardrobe, close };
})();
