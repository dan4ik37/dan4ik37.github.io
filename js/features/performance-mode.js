// ═══════════════════════════════════════
//  РЕЖИМ ПРОИЗВОДИТЕЛЬНОСТИ
// ═══════════════════════════════════════
const PERF_KEY = 'd37_perf';
let currentPerf = null;

// persist=false — режим подобран автоматически (см. autoDetectPerf), в localStorage
// не пишем: при следующем заходе определим заново. Явный выбор пользователя
// (кнопка справа / попап) всегда сохраняется.
function setPerf(mode, persist = true) {
  currentPerf = mode;
  if (persist) {
    window.__perfAuto = false;
    try { localStorage.setItem(PERF_KEY, mode); } catch(e) {}
  }

  document.body.classList.remove('low','high');
  document.body.classList.add(mode);

  // Кнопка сбоку
  const icon = document.getElementById('ptIcon');
  const lbl  = document.getElementById('ptLbl');
  if (mode === 'low') {
    icon.textContent = '🐢'; lbl.textContent = 'Слабое';
    document.getElementById('cardLow').classList.add('active-low');
    document.getElementById('cardHigh').classList.remove('active-high');
  } else {
    icon.textContent = '🚀'; lbl.textContent = 'Мощное';
    document.getElementById('cardHigh').classList.add('active-high');
    document.getElementById('cardLow').classList.remove('active-low');
  }

  // Закрываем попап
  const popup = document.getElementById('perfPopup');
  popup.classList.remove('show');

  if (mode === 'high') {
    initParticles();
    // кольцо показывает CSS (body.high); узкое окно — попробуем при следующем включении
    if (!window.cursorInitialized) window.cursorInitialized = initCursorTrail() !== false;
    initScrollReveal();
  } else {
    // Очищаем частицы
    document.getElementById('particles').innerHTML = '';
    // Все reveal сразу видимы
    document.querySelectorAll('.reveal').forEach(el => {
      el.classList.add('visible');
    });
  }
}

function openPerfPopup() {
  // Обновляем активные карточки
  if (currentPerf) {
    document.getElementById('card'+( currentPerf==='low'?'Low':'High')).classList.add('active-'+currentPerf);
  }
  document.getElementById('perfPopup').classList.add('show');
}

function initPerfMode() {
  let saved = null;
  try { saved = localStorage.getItem(PERF_KEY); } catch(e) {}
  if (saved) {
    setPerf(saved);
  } else {
    // Первый заход. Раньше здесь висел блокирующий попап «Выбери режим» —
    // человек ещё ничего не увидел, а сайт уже просит настроек (и большинство
    // жмёт «Пропустить (слабое)» → видит самую плоскую версию сайта).
    // Теперь режим подбирается сам, а попап остаётся по кнопке справа.
    window.__perfAuto = true;
    setPerf(autoDetectPerf(), false);
  }
}

function autoDetectPerf() {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'low';
    if (navigator.connection && navigator.connection.saveData) return 'low';
    const cores  = navigator.hardwareConcurrency || 4;
    const mem    = navigator.deviceMemory || 4;   // есть только в Chromium; иначе считаем 4 ГБ
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
    if (mobile) return (cores >= 6 && mem >= 4) ? 'high' : 'low';
    return (cores >= 4 && mem >= 4) ? 'high' : 'low';
  } catch(e) { return 'low'; }
}

// ── ЧАСТИЦЫ ──
function initParticles() {
  const container = document.getElementById('particles');
  container.innerHTML = '';
  const colors = ['rgba(255,45,85,.7)','rgba(145,71,255,.6)','rgba(41,182,246,.6)','rgba(255,107,53,.6)','rgba(168,85,247,.6)'];
  const count = window.innerWidth < 768 ? 15 : 40;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 4 + 1;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const dur   = (Math.random() * 14 + 7).toFixed(1);
    const delay = (Math.random() * 10).toFixed(1);
    p.style.cssText = `
      left:${Math.random()*100}%;
      bottom:${Math.random()*-20}%;
      width:${size}px;height:${size}px;
      background:${color};
      animation-duration:${dur}s;
      animation-delay:-${delay}s;
      box-shadow:0 0 ${size*2}px ${color};
    `;
    container.appendChild(p);
  }
}

// ── КУРСОР: кольцо плавно догоняет обычную стрелку (только HIGH и широкое окно; стрелку не прячем) ──
function initCursorTrail() {
  if (window.innerWidth < 768) return false;
  const trail = document.getElementById('cursorTrail');
  if (!trail) return false;
  let mx = -200, my = -200, cx = -200, cy = -200, running = false;

  document.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    if (!running && currentPerf === 'high') { running = true; requestAnimationFrame(animCursor); }
  });

  // На кликабельном кольцо больше и оранжевое — делегированием, чтобы работало и на кнопках, появившихся позже
  const HOT = 'a,button,.vcard,.hub-card,.dc,.stat-card';
  let hot = false;
  document.addEventListener('mouseover', e => {
    const on = !!(e.target.closest && e.target.closest(HOT));
    if (on === hot) return;
    hot = on;
    trail.style.width = trail.style.height = on ? '44px' : '28px';
    trail.style.borderColor = on ? 'rgba(255,107,53,.9)' : 'rgba(255,45,85,.8)';
    trail.style.background = on ? 'rgba(255,107,53,.08)' : 'rgba(255,45,85,.05)';
  });

  function animCursor() {
    if (currentPerf !== 'high') { running = false; return; }
    cx += (mx - cx) * 0.14;
    cy += (my - cy) * 0.14;
    // центр кольца — на стрелке при любом размере кольца
    trail.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
    if (Math.abs(mx - cx) + Math.abs(my - cy) < 0.3) { running = false; return; }   // догнал — ждём движения мыши
    requestAnimationFrame(animCursor);
  }
  return true;
}

// ── SCROLL REVEAL ──
function initScrollReveal() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if(e.isIntersecting){ e.target.classList.add('visible'); obs.unobserve(e.target); }
    });
  }, { threshold: 0.01 });
  document.querySelectorAll('.reveal').forEach(el => {
    el.classList.remove('visible');
    obs.observe(el);
  });
}
