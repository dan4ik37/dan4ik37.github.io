// ═══════════════════════════════════════════════════════════════════
//  FX — визуальный слой (в паре с css/premium.css)
//  Грузится ПОСЛЕДНИМ: после router.js и hotkeys.js.
//
//  • Всё тяжёлое (созвездие, прожектор, наклон, искры, магнит) работает
//    только при body.high и без prefers-reduced-motion.
//  • Каждый модуль независим и обёрнут в safe() — если что-то упало,
//    остальной сайт (чат, вход, роли) не страдает.
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mqFine   = window.matchMedia('(hover: hover) and (pointer: fine)');
  const isHigh   = () => document.body.classList.contains('high') && !mqReduce.matches;
  const safe = (name, fn) => { try { fn(); } catch (e) { console.warn('[fx] ' + name + ':', e); } };

  // ── Шапка: редкие разделы → «Ещё ▾», скользящая пилюля активного пункта ──
  function initNav() {
    const links = $('#navLinks');
    if (!links || $('.nav-more', links)) return;

    const wrap = document.createElement('div');
    wrap.className = 'nav-more';
    wrap.innerHTML =
      '<button type="button" class="nav-more-btn" aria-haspopup="true" aria-expanded="false" aria-controls="navMorePanel">' +
      'Ещё <span class="nm-caret" aria-hidden="true"></span></button>' +
      '<div class="nav-more-panel" id="navMorePanel"></div>';
    const panel = $('.nav-more-panel', wrap);
    const btn   = $('.nav-more-btn', wrap);

    // Переносим САМИ <a> (а не копии): на них уже висят обработчики из
    // tabs-nav.js, а router.js находит их по .nav-links a[data-route]
    ['poll', 'soundboard', 'clicker', 'ads'].forEach(r => {
      const a = $('a[data-route="' + r + '"]', links);
      if (a) panel.appendChild(a);
    });
    links.insertBefore(wrap, $('.nav-donate', links));

    const ind = document.createElement('span');
    ind.className = 'nav-ind';
    ind.setAttribute('aria-hidden', 'true');
    links.appendChild(ind);

    const setOpen = open => {
      wrap.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    };
    let hoverTimer = 0, hoverAt = 0;
    // На десктопе меню открывается при наведении, и последующий клик не должен
    // тут же его закрывать (иначе «наведи → кликни» = ничего не произошло)
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const justOpenedByHover = Date.now() - hoverAt < 600;
      setOpen(justOpenedByHover ? true : !wrap.classList.contains('open'));
    });
    if (mqFine.matches) {
      wrap.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); hoverAt = Date.now(); setOpen(true); });
      wrap.addEventListener('mouseleave', () => { hoverTimer = setTimeout(() => setOpen(false), 180); });
    }
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
    panel.addEventListener('click', () => setOpen(false));

    function placeIndicator() {
      const desktop = window.innerWidth > 1180;
      let target = $('a.active-route', links);
      const inMore = target && panel.contains(target);
      wrap.classList.toggle('has-active', !!inMore);
      if (inMore) target = btn;
      if (!desktop || !target || target.classList.contains('nav-donate')) { ind.classList.remove('on'); return; }
      const lr = links.getBoundingClientRect(), tr = target.getBoundingClientRect();
      if (!tr.width) { ind.classList.remove('on'); return; }
      ind.style.width = tr.width + 'px';
      ind.style.transform = 'translateX(' + (tr.left - lr.left) + 'px)';
      ind.classList.add('on');
    }
    const place = () => requestAnimationFrame(placeIndicator);
    new MutationObserver(place).observe(links, { attributes: true, attributeFilter: ['class'], subtree: true });
    window.addEventListener('resize', place);
    window.addEventListener('hashchange', place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    place();
  }

  // ── Плашка «ближайший эфир» (по расписанию из блока «Когда стримим?») ──
  function initHeroPill() {
    const pill = $('#heroPill'), txt = $('#heroPillText');
    if (!pill || !txt) return;
    const WHEN = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];
    const pad = n => String(n).padStart(2, '0');

    const slots = () => $$('.day-card').map(c => {
      const l = c.querySelector('.day-live');
      if (!l) return null;
      const [h, m] = l.textContent.trim().split(':').map(Number);
      return (isNaN(h) || isNaN(m)) ? null : { day: +c.dataset.d, h, m };
    }).filter(Boolean);

    function render() {
      const list = slots();
      if (!list.length) { pill.hidden = true; return; }
      const now = new Date();

      // Слот начался не более 3 часов назад → «по расписанию сейчас эфир».
      // Это оценка по расписанию, а не проверка Twitch (её на сайте нет).
      for (const s of list) {
        if (s.day !== now.getDay()) continue;
        const start = new Date(now); start.setHours(s.h, s.m, 0, 0);
        const d = now - start;
        if (d >= 0 && d < 3 * 3600e3) {
          pill.classList.add('is-live');
          pill.href = 'https://www.twitch.tv/dan4ik37';
          pill.target = '_blank'; pill.rel = 'noopener';
          txt.innerHTML = 'По расписанию сейчас эфир — <b>заходи на Twitch</b>';
          pill.hidden = false;
          return;
        }
      }
      pill.classList.remove('is-live');
      pill.href = '#/about'; pill.removeAttribute('target'); pill.removeAttribute('rel');

      for (let add = 0; add < 8; add++) {
        const day = (now.getDay() + add) % 7;
        const s = list.find(x => x.day === day);
        if (!s) continue;
        const at = new Date(now); at.setDate(now.getDate() + add); at.setHours(s.h, s.m, 0, 0);
        if (at <= now) continue;
        const mins = Math.round((at - now) / 60000);
        const h = Math.floor(mins / 60), m = mins % 60;
        const left = h >= 24 ? '' : (h ? h + ' ч ' : '') + m + ' мин';
        const when = add === 0 ? 'сегодня' : add === 1 ? 'завтра' : WHEN[day];
        txt.innerHTML = 'Ближайший эфир: <b>' + when + ' в ' + pad(s.h) + ':' + pad(s.m) + '</b>' +
          (left ? ' <em>· через ' + left + '</em>' : '');
        pill.hidden = false;
        return;
      }
      pill.hidden = true;
    }
    render();
    setInterval(render, 30000);
    const grid = $('.sched-grid');
    if (grid) new MutationObserver(render).observe(grid, { childList: true, subtree: true });
  }

  // ── Сменяющиеся фразы в подзаголовке ──
  function initRoleRotator() {
    const box = $('.role-rot');
    if (!box) return;
    const items = $$('span', box);
    if (items.length < 2 || mqReduce.matches) return;   // при reduce-motion — одна фраза
    box.classList.add('js');
    let i = 0;
    items[0].classList.add('on');
    setInterval(() => {
      if (document.hidden || !isHigh()) return;
      const cur = items[i];
      i = (i + 1) % items.length;
      const nxt = items[i];
      cur.classList.remove('on'); cur.classList.add('off');
      nxt.classList.remove('off'); nxt.classList.add('on');
      setTimeout(() => cur.classList.remove('off'), 800);
    }, 2900);
  }

  // ── Бегущая строка: клоны, чтобы лента не «обрывалась» на широких экранах ──
  function initMarquee() {
    const track = $('.mq-track');
    const group = track && $('.mq-group', track);
    if (!track || !group || track.dataset.ready) return;
    const gw = group.getBoundingClientRect().width;
    if (!gw) return;                       // герой скрыт (открыта не главная) — попробуем позже
    track.dataset.ready = '1';
    const copies = Math.max(1, Math.ceil((window.innerWidth * 1.2) / gw));
    const mk = src => {
      const g = src.cloneNode(true);
      g.setAttribute('aria-hidden', 'true');
      $$('a', g).forEach(a => { a.tabIndex = -1; });
      return g;
    };
    // 1) набираем «половину» шире экрана, 2) дублируем её целиком:
    //    анимация сдвигает ленту ровно на -50% — стык незаметен
    for (let i = 1; i < copies; i++) track.appendChild(mk(group));
    Array.from(track.children).forEach(g => track.appendChild(mk(g)));
    track.style.setProperty('--mq-dur', Math.round((gw * copies) / 55) + 's');   // ≈55 px/сек
  }

  // ── Герой: параллакс, прожектор за курсором, RGB-сплит от движения ──
  function initHeroPointer() {
    const hero = $('#hero');
    if (!hero) return;
    const spot = $('.hero-spot', hero);
    let tx = 0, ty = 0, cx = 0, cy = 0, sx = 0, sy = 0, tsx = 0, tsy = 0, raf = 0, visible = true;

    function loop() {
      raf = 0;
      if (!isHigh() || !visible) return;
      cx = lerp(cx, tx, .08); cy = lerp(cy, ty, .08);
      sx = lerp(sx, tsx, .12); sy = lerp(sy, tsy, .12);
      hero.style.setProperty('--px', cx.toFixed(3));
      hero.style.setProperty('--py', cy.toFixed(3));
      hero.style.setProperty('--cx', (cx * 9).toFixed(2));
      if (spot) spot.style.transform = 'translate3d(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px,0)';
      if (Math.abs(cx - tx) > .002 || Math.abs(cy - ty) > .002 || Math.abs(sx - tsx) > .5 || Math.abs(sy - tsy) > .5)
        raf = requestAnimationFrame(loop);
    }
    hero.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' || !isHigh()) return;
      const r = hero.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - .5) * 2;
      ty = ((e.clientY - r.top) / r.height - .5) * 2;
      tsx = e.clientX - r.left; tsy = e.clientY - r.top;
      hero.classList.add('pointer');
      if (!raf) raf = requestAnimationFrame(loop);
    }, { passive: true });
    hero.addEventListener('pointerleave', () => {
      tx = 0; ty = 0; hero.classList.remove('pointer');
      if (!raf) raf = requestAnimationFrame(loop);
    });
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; }, { threshold: 0 }).observe(hero);
    // после первого показа выключаем входные анимации (чтобы не играли при возврате на главную)
    setTimeout(() => hero.classList.add('seen'), 3600);
  }

  // ── Созвездие: узлы дрейфуют, соединяются линиями, тянутся к курсору ──
  function initConstellation() {
    const hero = $('#hero'), cv = $('#heroCanvas');
    if (!hero || !cv) return;
    const ctx = cv.getContext('2d');
    const COLORS = ['255,45,85', '145,71,255', '41,182,246', '255,107,53'];
    let W = 0, H = 0, nodes = [], raf = 0, visible = false, mx = -999, my = -999;

    function resize() {
      const r = hero.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.min(window.innerWidth < 768 ? 26 : 64, Math.round(W * H / 24000));
      while (nodes.length < target) nodes.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - .5) * .28, vy: (Math.random() - .5) * .28,
        r: Math.random() * 1.6 + .8, c: COLORS[(Math.random() * COLORS.length) | 0]
      });
      nodes.length = target;
    }
    function frame() {
      raf = 0;
      if (!isHigh() || !visible || document.hidden) return;
      ctx.clearRect(0, 0, W, H);
      const LINK = 130, MOUSE = 170;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const dx = a.x - mx, dy = a.y - my, dm = Math.hypot(dx, dy);
        if (dm < MOUSE && dm > 1) { a.vx += (dx / dm) * .012; a.vy += (dy / dm) * .012; }   // мягко отталкиваются
        a.vx *= .995; a.vy *= .995;
        a.x += a.vx; a.y += a.vy;
        if (a.x < -10) a.x = W + 10; else if (a.x > W + 10) a.x = -10;
        if (a.y < -10) a.y = H + 10; else if (a.y > H + 10) a.y = -10;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            ctx.strokeStyle = 'rgba(' + a.c + ',' + ((1 - d / LINK) * .28).toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
        if (dm < MOUSE) {
          ctx.strokeStyle = 'rgba(255,255,255,' + ((1 - dm / MOUSE) * .35).toFixed(3) + ')';
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mx, my); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(' + a.c + ',.9)';
        ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 6.2832); ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    const start = () => { if (!raf && isHigh() && visible && !document.hidden) raf = requestAnimationFrame(frame); };

    hero.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      const r = hero.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top;
    }, { passive: true });
    hero.addEventListener('pointerleave', () => { mx = my = -999; });
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) { resize(); start(); } }, { threshold: 0 }).observe(hero);
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(hero);
    document.addEventListener('visibilitychange', start);
    new MutationObserver(() => { if (isHigh()) start(); else ctx.clearRect(0, 0, W, H); })
      .observe(document.body, { attributes: true, attributeFilter: ['class'] });
    resize();
  }

  // ── Свет под курсором на карточках + наклон + магнит на кнопках ──
  function initPointerFx() {
    const GLOW  = '.stat-card,.hub-card,.about-card,.dc,.vcard,.sound-btn,.day-card,.goal-bar-wrap,.lb-wrap,.poll-wrap,.clicker-wrap,.chat-wrap,.stream-box,.pf-card,.profile-stat-card,#miniProfilePopover,#profileLoggedOut,#profileStaffVipPanel,#profileStaffPanel,#donateLoginPanel,#profileVipPromo,#profileVipPerksPanel,#profileAdminPanel';
    const TILT  = '.stat-card,.hub-card,.about-card,.dc';
    // Профильные кнопки — тоже магнитятся к курсору, как кнопки героя,
    // но без tilt (карточки с текстом/формами не должны «качаться»)
    const MAGNET = '.hero-btn,.chip,.pf-btn';
    let raf = 0, pend = null;

    document.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' || !mqFine.matches || !(e.target instanceof Element)) return;
      const glowEl = e.target.closest(GLOW);
      const magEl  = e.target.closest(MAGNET);
      if (!glowEl && !magEl) return;
      pend = { glowEl, magEl, x: e.clientX, y: e.clientY };
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const p = pend; if (!p) return;
        if (p.glowEl) {
          const r = p.glowEl.getBoundingClientRect();
          p.glowEl.style.setProperty('--mx', (p.x - r.left).toFixed(1) + 'px');
          p.glowEl.style.setProperty('--my', (p.y - r.top).toFixed(1) + 'px');
          if (isHigh() && p.glowEl.matches(TILT)) {
            const nx = (p.x - r.left) / r.width - .5, ny = (p.y - r.top) / r.height - .5;
            p.glowEl.style.setProperty('--ry', (nx * 9).toFixed(2) + 'deg');
            p.glowEl.style.setProperty('--rx', (-ny * 9).toFixed(2) + 'deg');
          }
        }
        if (p.magEl && isHigh()) {
          const r = p.magEl.getBoundingClientRect();
          p.magEl.style.setProperty('--tx', ((p.x - (r.left + r.width / 2)) * .16).toFixed(1) + 'px');
          p.magEl.style.setProperty('--ty', ((p.y - (r.top + r.height / 2)) * .22).toFixed(1) + 'px');
        }
      });
    }, { passive: true });

    document.addEventListener('pointerout', e => {
      if (!(e.target instanceof Element)) return;
      const t = e.target.closest(TILT);
      if (t && !t.contains(e.relatedTarget)) { t.style.removeProperty('--rx'); t.style.removeProperty('--ry'); }
      const m = e.target.closest(MAGNET);
      if (m && !m.contains(e.relatedTarget)) { m.style.removeProperty('--tx'); m.style.removeProperty('--ty'); }
      const g = e.target.closest(GLOW);
      if (g && !g.contains(e.relatedTarget)) { g.style.removeProperty('--mx'); g.style.removeProperty('--my'); }
    });
  }

  // ── Искры по клику (HIGH) ──
  function initSparks() {
    if (!mqFine.matches) return;
    const cv = document.createElement('canvas');
    cv.id = 'fxSparks'; cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    const COLORS = ['#ff2d55', '#ff6b35', '#9147ff', '#29b6f6', '#ffffff'];
    let parts = [], raf = 0, dpr = 1;
    function fit() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    fit(); window.addEventListener('resize', fit);
    function tick() {
      raf = 0;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts = parts.filter(p => p.life > 0);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy; p.vy += .12; p.vx *= .985; p.life -= .022;
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life + .4, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (parts.length) raf = requestAnimationFrame(tick);
    }
    document.addEventListener('pointerdown', e => {
      if (!isHigh() || e.button !== 0 || e.pointerType === 'touch') return;
      if (e.target instanceof Element && e.target.closest('input,textarea,select,iframe,[contenteditable]')) return;
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * 6.2832, s = Math.random() * 4.2 + 1.2;
        parts.push({ x: e.clientX, y: e.clientY, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.2, r: Math.random() * 2.6 + 1, life: 1, c: COLORS[(Math.random() * COLORS.length) | 0] });
      }
      if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: true });
  }

  // ── Индексы для «каскада» карточек + подчёркивание заголовков при появлении ──
  function initStaggerAndTitles() {
    ['.stats-row', '.about-grid', '.hub-grid', '.donate-grid', '.sched-grid', '.soundboard']
      .forEach(sel => $$(sel).forEach(box => Array.from(box.children).forEach((c, i) => c.style.setProperty('--i', i))));

    const titles = $$('.sec-title');
    if (!('IntersectionObserver' in window)) { titles.forEach(t => t.classList.add('in')); return; }
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: .6 });
    titles.forEach(t => io.observe(t));
  }

  // ── Фон: цветные пятна медленно «плывут» при скролле (обновляем ОДИН элемент) ──
  function initAmbient() {
    const amb = $('#ambient');
    if (!amb) return;
    let raf = 0;
    const upd = () => {
      raf = 0;
      const max = Math.max(document.body.scrollHeight - innerHeight, 1);
      amb.style.setProperty('--sp', Math.min(scrollY / max, 1).toFixed(4));
    };
    window.addEventListener('scroll', () => { if (!raf && isHigh()) raf = requestAnimationFrame(upd); }, { passive: true });
  }

  // ── Кнопка «вниз» в герое ──
  function initScrollHint() {
    const b = $('.scroll-hint');
    if (b) b.addEventListener('click', () => {
      const t = $('#stats'); if (t) t.scrollIntoView({ behavior: mqReduce.matches ? 'auto' : 'smooth' });
    });
  }

  // ── Страховка: если режим выбран АВТОМАТИЧЕСКИ и устройство тянет <28 fps —
  //    тихо переключаемся на Low и запоминаем это ──
  function initPerfGuard() {
    if (!window.__perfAuto || !isHigh() || typeof window.setPerf !== 'function') return;
    let frames = 0, t0 = 0, slow = 0, secs = 0;
    function tick(t) {
      if (document.hidden) { t0 = 0; frames = 0; return requestAnimationFrame(tick); }
      if (!t0) t0 = t;
      frames++;
      if (t - t0 >= 1000) {
        const fps = frames * 1000 / (t - t0);
        frames = 0; t0 = t; secs++;
        slow = fps < 28 ? slow + 1 : 0;
        if (slow >= 3) {
          window.setPerf('low');
          const el = document.createElement('div');
          el.className = 'fx-toast'; el.setAttribute('role', 'status');
          el.textContent = 'Включён лёгкий режим — так сайт работает плавнее. Вернуть эффекты можно кнопкой справа.';
          document.body.appendChild(el);
          requestAnimationFrame(() => el.classList.add('show'));
          setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 500); }, 6000);
          return;
        }
        if (secs >= 8) return;   // устройство справляется — больше не проверяем
      }
      requestAnimationFrame(tick);
    }
    setTimeout(() => requestAnimationFrame(tick), 2500);
  }

  safe('nav', initNav);
  safe('pill', initHeroPill);
  safe('rotator', initRoleRotator);
  safe('marquee', () => {
    const run = () => safe('marquee2', initMarquee);
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(run);
    window.addEventListener('hashchange', () => setTimeout(run, 400));   // если сайт открыли не с #/home
  });
  safe('heroPointer', initHeroPointer);
  safe('constellation', initConstellation);
  safe('pointerFx', initPointerFx);
  safe('sparks', initSparks);
  safe('stagger', initStaggerAndTitles);
  safe('ambient', initAmbient);
  safe('scrollHint', initScrollHint);
  safe('perfGuard', initPerfGuard);
})();
