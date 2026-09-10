// ═══════════════════════════════════════
//  РЕЖИМ ПРОИЗВОДИТЕЛЬНОСТИ
// ═══════════════════════════════════════
const PERF_KEY = 'd37_perf';
let currentPerf = null;

function setPerf(mode) {
  currentPerf = mode;
  try { localStorage.setItem(PERF_KEY, mode); } catch(e) {}

  document.body.classList.remove('low','high');
  document.body.classList.add(mode);

  // Кнопка сбоку
  const icon = document.getElementById('ptIcon');
  const lbl  = document.getElementById('ptLbl');
  if (mode === 'low') {
    icon.textContent = '🐢'; lbl.textContent = 'Low';
    document.getElementById('cardLow').classList.add('active-low');
    document.getElementById('cardHigh').classList.remove('active-high');
  } else {
    icon.textContent = '🚀'; lbl.textContent = 'High';
    document.getElementById('cardHigh').classList.add('active-high');
    document.getElementById('cardLow').classList.remove('active-low');
  }

  // Закрываем попап
  const popup = document.getElementById('perfPopup');
  popup.classList.remove('show');

  if (mode === 'high') {
    initParticles();
    if (!window.cursorInitialized) {
      initCursorTrail();
      window.cursorInitialized = true;
    } else {
      // Вернулись в High — просто показываем курсор
      const trail = document.getElementById('cursorTrail');
      const dot   = document.getElementById('cursorDot');
      if (trail) trail.style.display = 'block';
      if (dot)   dot.style.display   = 'block';
    }
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
    // Первый заход — даём выбрать режим самому
    document.getElementById('perfPopup').classList.add('show');
  }
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

// ── КУРСОР ──
function initCursorTrail() {
  if (window.innerWidth < 768) return;
  const trail = document.getElementById('cursorTrail');
  const dot   = document.getElementById('cursorDot');
  let mx = -200, my = -200;
  let cx = -200, cy = -200;
  let started = false;

  document.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    // Точка — мгновенно через transform
    dot.style.transform = `translate(${mx - 2.5}px, ${my - 2.5}px)`;
    if (!started) { started = true; animCursor(); }
  });

  // Hover-эффект — увеличиваем кольцо на кликабельных
  document.querySelectorAll('a,button,.vcard,.hub-card,.dc,.stat-card').forEach(el => {
    el.addEventListener('mouseenter', () => {
      trail.style.width = '44px';
      trail.style.height = '44px';
      trail.style.borderColor = 'rgba(255,107,53,.9)';
      trail.style.background = 'rgba(255,107,53,.08)';
    });
    el.addEventListener('mouseleave', () => {
      trail.style.width = '28px';
      trail.style.height = '28px';
      trail.style.borderColor = 'rgba(255,45,85,.8)';
      trail.style.background = 'rgba(255,45,85,.05)';
    });
  });

  function animCursor() {
    if (currentPerf !== 'high') return;
    // Кольцо — плавно догоняет через lerp
    cx += (mx - cx) * 0.14;
    cy += (my - cy) * 0.14;
    // Используем translate чтобы центрировать кольцо на курсоре
    trail.style.transform = `translate(${cx - 14}px, ${cy - 14}px)`;
    requestAnimationFrame(animCursor);
  }
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
