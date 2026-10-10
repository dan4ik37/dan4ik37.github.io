// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА (D37E) — ядро: загрузка Three.js, цикл с фиксированным шагом, события, математика, качество
// ═══════════════════════════════════════
// Файлы движка (js/engine/), порядок подключения:
//   core (это) · physics (столкновения, ступеньки, луч, путь A*) · controls (действия и клавиши, геймпад — из Unity Controls.cs)
//   · input (мышь, палец: джойстик, камера, щипок) · player (ходьба, бег, выносливость, кувырок, паркур, лестницы — из Unity
//   PlayerController/Parkour) · camera (3-е и 1-е лицо + «ощущение тела» — из CameraFeel.cs) · interact (подсказка «[E] открыть»
//   и удержание — из PlayerInteractor) · build (стройка как в Rust: сетка, опора, уровни прочности, двери с кодом — из Building/*)
//   · inventory (вещи: вес, стопки, ячейки, ящик с кодовым замком — из Inventory/*, StorageBox) · synth (звуки кодом — из
//   AudioSynth.cs) · render (сцена, небо, детали, предметы, склейка) · actors (человечки в сцене) · ui (подсказки, полоска сил,
//   кнопки телефона) · scene (объекты как в Roblox: детали, материалы, модели, свет, предметы, скрипты) · gizmo (стрелки
//   редактора) · terrain (ландшафт: кисти, материалы, вода) · script (скрипты игроков в песочнице). Человечки — World3D.kit
//   (js/games/world3d.js). Логика — шагами по 1/60 с, рисование — каждый кадр.
// Единицы: 1 м Unity = E.UNIT единиц движка (капсула человека 1,8 м → 2,1), поэтому все цифры Unity — «× U».
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  E.VERSION = 2;
  E.UNIT = 2.1 / 1.8;
  E.supported = () => !!root.World3D?.supported?.();
  E.load = () => root.World3D ? root.World3D.load() : Promise.resolve(false);

  // ── Математика ──
  E.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  E.lerp = (a, b, t) => a + (b - a) * t;
  E.damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));      // плавно к цели, не зависит от частоты кадров
  E.wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  E.dampAngle = (a, b, k, dt) => a + E.wrap(b - a) * (1 - Math.exp(-k * dt));
  E.rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  // ── События ──
  E.emitter = () => {
    const m = new Map();
    return {
      on(e, f){ if (!m.has(e)) m.set(e, new Set()); m.get(e).add(f); return () => m.get(e)?.delete(f); },
      emit(e, d){ m.get(e)?.forEach(f => { try { f(d); } catch (er) { console.error(er); } }); },
      clear(){ m.clear(); },
    };
  };

  E.smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);   // Mathf.SmoothStep(0, 1, t)
  E.moveTo = (a, b, d) => Math.abs(b - a) <= d ? b : a + Math.sign(b - a) * d;   // Mathf.MoveTowards
  // Плавный шум 0…1 (замена Mathf.PerlinNoise для тряски камеры)
  E.noise = (x, seed = 0) => {
    const h = n => { const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return s - Math.floor(s); };
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return h(i) * (1 - u) + h(i + 1) * u;
  };

  // ── Качество графики: low (слабые телефоны / «Экономный» режим сайта), mid, high ──
  E.quality = () => {
    if (document.body.classList.contains('low')) return 'low';
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent), cores = navigator.hardwareConcurrency || 4;
    if (mobile && cores <= 4) return 'low';
    if (mobile || cores <= 4) return 'mid';
    return 'high';
  };
  E.isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

  // ── Цикл: update(step) — ровно 60 раз в секунду (не больше 5 шагов за кадр), frame(dt, alpha) — каждый кадр ──
  E.loop = (update, frame, step = 1 / 60) => {
    let acc = 0, last = performance.now(), raf = 0, on = true, paused = false;
    const f = now => {
      if (!on) return;
      E.frameT0 = performance.now();   // начало кадра — render.js считает ЦП всего кадра (логика + отрисовка)
      raf = requestAnimationFrame(f);
      const dt = Math.min(.1, Math.max(0, (now - last) / 1000)); last = now;
      if (paused || document.hidden) return;
      acc += dt;
      let n = 0;
      while (acc >= step && n < 5) { update(step); acc -= step; n++; }
      if (n === 5) acc = 0;
      frame(dt, acc / step);
    };
    raf = requestAnimationFrame(f);
    return { stop(){ on = false; cancelAnimationFrame(raf); }, pause(v){ paused = !!v; last = performance.now(); }, get paused(){ return paused; } };
  };
})();
