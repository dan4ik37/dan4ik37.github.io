// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — звуки без файлов: шаги по 7 видам пола, прыжок, приземление, кувырок, паркур, двери, стройка,
//  удар, кодовый замок, кнопки (перенос Core/AudioSynth.cs из Unity-проекта Backrooms)
// ═══════════════════════════════════════
// Правило из Unity (AUDIO-7): звуки мира — только шум через полосовые резонаторы (Bp), без чистых тонов — тон звучит
// как «писк кода». Тоны — только у кнопок и замка (это и есть электроника). Громкость — по среднеквадратичной (RMS),
// но пик не выше 0,85: у щелчков большой «крест-фактор», жёсткое выравнивание срезало бы атаку.
// Синтез — один раз при первом обращении, дальше из кэша (22 кГц: вдвое меньше памяти и времени).
// A = D37E.audio() (одна на страницу): A.play(имя, { x, y, z, vol, rate }) — со стороной и затуханием по расстоянию до
// слушателя (A.listener(x, y, z, yaw) — камера каждый кадр); A.step(пол, бег, x, y, z) — шаг (не тот же вариант подряд);
// A.volume(0…1). Звук игр выключен на сайте (d37_games_mute = 1) — тишина. Браузер разрешает звук после первого нажатия.
// D37E.synth.render(имя) → Float32Array — сами формулы (проверяются в node); D37E.synth.NAMES — все имена.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const RATE = 22050, PI2 = Math.PI * 2;
  const FLOORS = ['carpet', 'concrete', 'tile', 'metal', 'water', 'wood', 'grass'];

  // Полосовой резонатор (biquad band-pass, постоянная пиковая амплитуда) — как Bp в AudioSynth
  class Bp {
    constructor(f, q, rate = RATE){
      const w = PI2 * Math.min(f, rate * .45) / rate, al = Math.sin(w) / (2 * q), a0 = 1 + al;
      this.b0 = al / a0; this.b2 = -al / a0; this.a1 = -2 * Math.cos(w) / a0; this.a2 = (1 - al) / a0;
      this.x1 = this.x2 = this.y1 = this.y2 = 0;
    }
    do(x){ const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
  }
  const rng = seed => E.rng ? E.rng(seed) : (() => { let a = seed >>> 0; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const N = r => r() * 2 - 1;
  const exp = Math.exp;
  function render(sec, fn, seed){
    const n = Math.ceil(sec * RATE), d = new Float32Array(n), r = rng(seed);
    for (let i = 0; i < n; i++) d[i] = fn(i / RATE, r);
    return d;
  }
  // Плавные края разового звука (без щелчка)
  function fadeEdges(d, fin, fout){
    const a = Math.min(d.length, fin * RATE | 0), b = Math.min(d.length, fout * RATE | 0);
    for (let i = 0; i < a; i++) d[i] *= i / a;
    for (let i = 0; i < b; i++) d[d.length - 1 - i] *= i / b;
  }
  // RMS к цели, но пик не выше peak (без искажений)
  function normalizeSafe(d, target, peak){
    let s = 0, m = 0;
    for (let i = 0; i < d.length; i++) { s += d[i] * d[i]; m = Math.max(m, Math.abs(d[i])); }
    const rms = Math.sqrt(s / Math.max(1, d.length));
    if (rms < 1e-7 || m < 1e-7) return d;
    const g = Math.min(target / rms, peak / m);
    for (let i = 0; i < d.length; i++) d[i] *= g;
    return d;
  }
  const make = (sec, seed, fn, rms = .1, fout = .02) => { const d = render(sec, fn, seed); fadeEdges(d, .0015, fout); return normalizeSafe(d, rms, .85); };

  // ── Шаг по полу (MakeStep): 3 варианта, громкость по материалу выровнена ──
  function step(floor, v){
    const fi = Math.max(0, FLOORS.indexOf(floor)), seed = 900 + fi * 31 + v * 7, r0 = rng(seed + 1);
    const jitter = 1 + (v - 1) * .08, toe = .045 + v * .008;
    const drops = Array.from({ length: 6 }, () => .05 + r0() * .28);
    let lp = 0, lp2 = 0, hp = 0, fn, sec;
    switch (floor) {
      case 'concrete': {   // ботинок по бетону: щелчок каблука, глухой удар плиты, скрип песка
        const thudF = new Bp(140 * jitter, .9), gritF = new Bp(1800 * jitter, .8);
        fn = (t, r) => {
          const w = N(r); hp += (w - hp) * .25; const click = w - hp;
          lp += (w - lp) * .06;
          const tt = t - toe, toeHit = tt > 0 ? click * exp(-tt * 140) * .45 : 0;
          return click * exp(-t * 110) * .9 + thudF.do(w) * exp(-t * 45) * 2.4 + toeHit + lp * exp(-t * 22) * .9 + gritF.do(w) * exp(-t * 35) * .4;
        };
        sec = .26; break;
      }
      case 'tile': {   // твёрдая подошва по керамике: короткий яркий «тик», корпус пола, носок, шорох
        const bodyF = new Bp(230 * jitter, 1.4), tickF = new Bp(3100 * jitter, 1.8), toeF = new Bp(2500 * jitter, 1.6), scuffF = new Bp(5200, .9);
        fn = (t, r) => {
          const w = N(r); hp += (w - hp) * .3; const click = w - hp;
          const tt = t - toe, te = tt > 0 ? exp(-tt * 210) : 0;
          return click * exp(-t * 170) * .9 + tickF.do(w) * exp(-t * 120) * 2.2 + bodyF.do(w) * exp(-t * 60) * 2.6
            + click * te * .5 + toeF.do(w) * te * 1.3 + scuffF.do(w) * exp(-Math.abs(t - .02) * 90) * .35;
        };
        sec = .26; break;
      }
      case 'metal': {   // жесть: неровные моды, возбуждённые шумом удара (не синусы), + дребезг
        const mf = [92, 151, 287, 433, 691, 1003, 1237, 1790], mq = [9, 10, 12, 12, 14, 14, 15, 14], mg = [1.4, .7, .55, .45, .35, .25, .2, .14];
        const modes = mf.map((f, i) => new Bp(f * jitter, mq[i]));
        fn = (t, r) => {
          const w = N(r), exc = w * (exp(-t * 90) + .15 * exp(-t * 12));
          let s = 0; for (let i = 0; i < modes.length; i++) s += modes[i].do(exc) * mg[i] * 4;
          const rattle = w * exp(-t * 30) * (Math.sin(PI2 * 37 * t) > .2 ? .5 : .15);
          return s + rattle * .6 + w * exp(-t * 200) * .6;
        };
        sec = .55; break;
      }
      case 'water': {   // шлёп (темнеющий шум) + капли — короткие всплески полосового шума
        const dropF = drops.map((_, i) => new Bp(1300 + i * 290, 5));
        fn = (t, r) => {
          const w = N(r), k = .5 + (.04 - .5) * Math.min(1, t / .25);
          lp += (w - lp) * k;
          let d = 0;
          for (let i = 0; i < dropF.length; i++) { const y = dropF[i].do(w), td = t - drops[i]; if (td >= 0 && td <= .04) d += y * exp(-td * 120) * .7; }
          return lp * Math.min(1, t * 300) * exp(-t * 9) * 1.4 + d;
        };
        sec = .4; break;
      }
      case 'wood': {   // дощатый настил: гулкая доска (полосы шума), стук
        const f0 = (150 + v * 18) * jitter, b1 = new Bp(f0, 6), b2 = new Bp(f0 * 2.8, 5), b3 = new Bp(900, 1.2);
        fn = (t, r) => {
          const w = N(r); hp += (w - hp) * .25;
          return b1.do(w) * exp(-t * 14) * 3.2 + b2.do(w) * exp(-t * 25) * 1.2 + (w - hp) * exp(-t * 120) * .8 + b3.do(w) * exp(-t * 60) * .5;
        };
        sec = .4; break;
      }
      case 'grass': {   // трава (своё, в том же духе): мягкий «тук» земли и шелест травинок
        const thump = new Bp(85 * jitter, 1.1), leaf = new Bp(3600 * jitter, .7), leaf2 = new Bp(6200, .8);
        fn = (t, r) => {
          const w = N(r), env = Math.min(1, t / .006);
          return thump.do(w) * exp(-t * 30) * 2 * env + leaf.do(w) * exp(-Math.abs(t - .05) * 28) * .55 + leaf2.do(w) * exp(-Math.abs(t - .08) * 24) * .3;
        };
        sec = .3; break;
      }
      default: {   // ковёр: глухой «тук» и шорох ворса
        const thumpF = new Bp(75 * jitter, 1);
        fn = (t, r) => {
          const env = exp(-t * 28) * (t < .004 ? t / .004 : 1), w = N(r);
          lp += (w - lp) * .08; lp2 += (w - lp2) * .35;
          return lp * 2.2 * env + (lp2 - lp) * .6 * exp(-t * 18) + thumpF.do(w) * exp(-t * 35) * .9;
        };
        sec = .26;
      }
    }
    return make(sec, seed, fn, .1);
  }

  // ── События (в духе AudioSynth: шум через резонаторы) ──
  const FX = {
    jump(){ const b = new Bp(700, 1.2); return make(.2, 11, (t, r) => { const w = N(r); return b.do(w) * Math.sin(Math.min(1, t / .2) * Math.PI) * 1.4; }, .05, .05); },   // свист одежды
    land(){ const a = new Bp(70, 1), bd = new Bp(160, 1.4), cr = new Bp(1900, .8); let hp = 0;
      return make(.42, 12, (t, r) => { const w = N(r); hp += (w - hp) * .3; return a.do(w) * exp(-t * 16) * 3 + bd.do(w) * exp(-t * 30) * 1.5 + cr.do(w) * exp(-t * 40) * .5 + (w - hp) * exp(-t * 160) * .5; }, .13); },
    roll(){ const c = new Bp(420, .9), th = new Bp(110, 1.2); let lp = 0;
      return make(.6, 13, (t, r) => { const w = N(r); lp += (w - lp) * .12; const hit = (k, at) => t > at ? exp(-(t - at) * k) : 0;
        return lp * Math.sin(Math.min(1, t / .6) * Math.PI) * 1.1 + c.do(w) * .5 * Math.sin(Math.min(1, t / .6) * Math.PI) + th.do(w) * (hit(28, .08) * 1.6 + hit(30, .38) * 1.3); }, .08, .06); },
    grip(){ const s = new Bp(950, 1.1); let hp = 0; return make(.12, 14, (t, r) => { const w = N(r); hp += (w - hp) * .4; return (w - hp) * exp(-t * 90) * 1.2 + s.do(w) * exp(-t * 60) * 1.6; }, .1); },   // ладони о край
    scuff(){ const s = new Bp(2200, 1), s2 = new Bp(700, 1.2); return make(.4, 15, (t, r) => { const w = N(r), env = Math.max(0, Math.sin(t * 38) * .5 + .5) * exp(-t * 5); return s.do(w) * env * 1.3 + s2.do(w) * env * .7; }, .07, .06); },   // ботинки скребут
    door_wood_open(){ const cr = new Bp(330, 14), k = new Bp(180, 2); let ph = 0;
      return make(.75, 21, (t, r) => { const w = N(r); ph += (.4 + t) * .02; const creak = cr.do(w * (Math.sin(ph * 40) > .6 ? 1 : .2)) * exp(-Math.abs(t - .35) * 4); return creak * 1.4 + k.do(w) * exp(-t * 40) * 1.5; }, .08); },
    door_wood_close(){ const k = new Bp(150, 1.6), k2 = new Bp(420, 3); let hp = 0;
      return make(.45, 22, (t, r) => { const w = N(r); hp += (w - hp) * .3; return k.do(w) * exp(-t * 18) * 3 + k2.do(w) * exp(-t * 25) * 1.2 + (w - hp) * exp(-t * 150) * .7; }, .12); },
    door_metal_open(){ const m = [230, 470, 910, 1530].map(f => new Bp(f, 16)); return make(.8, 23, (t, r) => { const w = N(r), e = w * (exp(-t * 60) + .05); let s = 0; m.forEach((b, i) => { s += b.do(e) * [1.2, .8, .5, .3][i]; }); return s * 3 + w * exp(-Math.abs(t - .3) * 20) * .15; }, .08); },
    door_metal_close(){ const m = [180, 390, 760, 1290, 2100].map(f => new Bp(f, 18)); return make(.9, 24, (t, r) => { const w = N(r), e = w * (exp(-t * 120) + .03); let s = 0; m.forEach((b, i) => { s += b.do(e) * [1.4, 1, .6, .4, .25][i]; }); return s * 3.5; }, .12); },
    build_wood(){ const k = new Bp(190, 2.2), k2 = new Bp(620, 3); let hp = 0;   // три удара молотка
      return make(.55, 31, (t, r) => { const w = N(r); hp += (w - hp) * .35; let s = 0; for (const at of [0, .16, .32]) if (t >= at) { const e = exp(-(t - at) * 38); s += k.do(w) * e * 2 + k2.do(w) * e * .8 + (w - hp) * exp(-(t - at) * 200) * .6; } return s; }, .12); },
    build_metal(){ const m = [140, 310, 655, 1180, 1870].map(f => new Bp(f, 14)); return make(.9, 32, (t, r) => { const w = N(r), e = w * (exp(-t * 80) + .04 + (t > .2 ? exp(-(t - .2) * 60) : 0)); let s = 0; m.forEach((b, i) => { s += b.do(e) * [1.3, .9, .6, .35, .2][i]; }); return s * 3; }, .1); },
    hit(){ const b = new Bp(120, 1.1), c = new Bp(1400, .9); let hp = 0; return make(.2, 41, (t, r) => { const w = N(r); hp += (w - hp) * .3; return b.do(w) * exp(-t * 26) * 3 + c.do(w) * exp(-t * 70) * .8 + (w - hp) * exp(-t * 180) * .7; }, .13); },
    break(){ const lpS = { v: 0 }, kn = [.0, .07, .13, .22, .31, .43].map((at, i) => [at, new Bp(160 + i * 90, 2)]);   // обломки
      return make(1.1, 42, (t, r) => { const w = N(r), k = .45 - .4 * Math.min(1, t / 1.1); lpS.v += (w - lpS.v) * k; let s = lpS.v * exp(-t * 4) * 1.6; for (const [at, b] of kn) if (t >= at) s += b.do(w) * exp(-(t - at) * 30) * 1.4; return s; }, .12, .15); },
    pickup(){ const b = new Bp(2600, 2.5); let lp = 0; return make(.18, 51, (t, r) => { const w = N(r); lp += (w - lp) * .2; return lp * exp(-t * 60) * 1.2 + b.do(w) * exp(-Math.abs(t - .05) * 50) * .9; }, .07); },
    // электроника (тон можно — это настоящий писк): кнопки замка, ошибка, монета, щелчок интерфейса
    keypad(){ return make(.07, 61, t => Math.sin(PI2 * 2100 * t) * Math.min(1, t / .004) * exp(-t * 18), .08, .015); },
    buzz(){ return make(.38, 62, t => Math.sign(Math.sin(PI2 * 118 * t)) * .6 * Math.min(1, t / .01) * (1 - t / .38), .09, .03); },
    coin(){ return make(.32, 63, t => (Math.sin(PI2 * 1320 * t) * (t < .08 ? 1 : 0) + Math.sin(PI2 * 1760 * t) * (t >= .07 ? 1 : 0)) * exp(-Math.max(0, t - .07) * 9) * Math.min(1, t / .003), .08, .05); },
    click(){ let hp = 0; return make(.03, 64, (t, r) => { const w = N(r); hp += (w - hp) * .5; return (w - hp) * exp(-t * 400); }, .05, .005); },
  };
  // ── Звуки-петли окружения (A.loop): тот же шум через резонаторы; края сшиты наплывом — петля без щелчка ──
  function loopMake(sec, seed, fn, rms){
    const X = Math.round(.6 * RATE), n = Math.round(sec * RATE), d = render(sec + .6, fn, seed), out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = i < X ? d[i] * (i / X) + d[n + i] * (1 - i / X) : d[i];
    return normalizeSafe(out, rms, .85);
  }
  const LOOPS = {
    amb_fire(){   // костёр: тёмный гул, шипение, редкие щелчки углей
      const crack = new Bp(2400, 1.3), body = new Bp(260, .8), hiss = new Bp(5200, .6); let lp = 0, ev = 0, evF = 0;
      return loopMake(4, 71, (t, r) => { const w = N(r); lp += (w - lp) * .035; if (r() < .0011) { ev = .5 + r() * .8; evF = r(); } ev *= .9925;
        return lp * .8 + body.do(w) * .3 + hiss.do(w) * .08 + crack.do(w) * ev * (1.2 + evF); }, .07);
    },
    amb_rain(){   // дождь: ровный высокий шум и капли
      const hi = new Bp(5600, .5), mid = new Bp(2100, .7), drop = new Bp(3300, 6); let ev = 0;
      return loopMake(3, 72, (t, r) => { const w = N(r); if (r() < .004) ev = .4 + r() * .6; ev *= .985; return hi.do(w) * .9 + mid.do(w) * .4 + drop.do(w) * ev * 1.4; }, .07);
    },
    amb_wind(){   // ветер: низкий шум, медленно дышит
      const b = new Bp(300, .5), w2 = new Bp(900, 2.2); let lp = 0;
      return loopMake(6, 73, (t, r) => { const w = N(r); lp += (w - lp) * .018; const m = .55 + .45 * Math.sin(t * PI2 / 6) * Math.sin(t * PI2 / 3 + 1);
        return (b.do(w) * .5 + lp * 1.3 + w2.do(w) * .12 * m) * m; }, .05);
    },
    amb_water(){   // вода у берега: плеск волнами
      const s = new Bp(700, .8), sp = new Bp(2600, 3); let lp = 0;
      return loopMake(4, 74, (t, r) => { const w = N(r); lp += (w - lp) * .06; const wave = Math.pow(Math.max(0, Math.sin(t * PI2 / 2)), 3);
        return (lp * .9 + s.do(w) * .5) * (.25 + wave) + sp.do(w) * wave * .2; }, .05);
    },
    amb_magic(){   // волшебство: тихий звон-переливы (полосы шума, не чистые тоны)
      const bells = [1900, 2530, 3170, 3800].map(f => new Bp(f, 40)); let ev = 0, k = 0;
      return loopMake(4, 75, (t, r) => { const w = N(r); if (r() < .0016) { ev = 1; k = (r() * 4) | 0; } ev *= .9993; let s = 0; for (let i = 0; i < 4; i++) s += bells[i].do(w * (i === k ? ev : ev * .15)); return s * 3; }, .04);
    },
  };
  const NAMES = [...Object.keys(FX), ...Object.keys(LOOPS), ...FLOORS.flatMap(f => [0, 1, 2].map(v => `step_${f}${v}`))];
  const cache = new Map();
  const synthRender = name => {
    if (cache.has(name)) return cache.get(name);
    let d;
    const m = /^step_(\w+?)(\d)$/.exec(name);
    if (m) d = step(m[1], +m[2]);
    else if (FX[name]) d = FX[name]();
    else if (LOOPS[name]) d = LOOPS[name]();
    else return null;
    cache.set(name, d);
    return d;
  };
  E.synth = { render: synthRender, NAMES, FLOORS, RATE, Bp };

  // ═══ Проигрывание (WebAudio): сторона и затухание по расстоянию ═══
  E.audio = function (){
    if (E._audio) return E._audio;
    const A = { vol: 1, lx: 0, ly: 0, lz: 0, lyaw: 0, ctx: null, master: null, bufs: new Map(), lastStep: {} };
    const muted = () => { try { return localStorage.getItem('d37_games_mute') === '1'; } catch (e) { return false; } };
    const ensure = () => {
      if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume().catch(() => {}); return A.ctx; }
      const C = root.AudioContext || root.webkitAudioContext; if (!C) return null;
      A.ctx = new C(); A.master = A.ctx.createGain(); A.master.gain.value = A.vol; A.master.connect(A.ctx.destination);
      return A.ctx;
    };
    // браузер разрешает звук только после действия человека
    if (typeof window !== 'undefined') {
      const wake = () => { ensure(); };
      window.addEventListener('pointerdown', wake, { passive: true });
      window.addEventListener('keydown', wake);
    }
    const buf = name => {
      if (A.bufs.has(name)) return A.bufs.get(name);
      const d = synthRender(name); if (!d || !A.ctx) return null;
      const b = A.ctx.createBuffer(1, d.length, RATE); b.copyToChannel ? b.copyToChannel(d, 0) : b.getChannelData(0).set(d);
      A.bufs.set(name, b); return b;
    };
    // громкость и сторона по месту (как у A.play): полностью — до 3 м, не слышно — дальше 40 м
    const place = (o, g) => {
      if (o.x == null) return [g, 0];
      const U = E.UNIT || 1, dx = o.x - A.lx, dy = (o.y ?? A.ly) - A.ly, dz = o.z - A.lz, d = Math.hypot(dx, dy, dz) / U;
      const k = d <= 3 ? 1 : Math.max(0, 1 - (d - 3) / 37), rx = Math.cos(A.lyaw), rz = -Math.sin(A.lyaw), dl = Math.hypot(dx, dz) || 1;
      return [g * k * k, Math.max(-1, Math.min(1, (dx * rx + dz * rz) / dl)) * Math.min(1, d / 2) * .8];
    };
    // Петли окружения: h = A.loop('amb_fire', { x, y, z, vol }) → h.set({ x, y, z, vol }), h.stop(). Без x — со всех сторон.
    // Звук разрешён только после первого нажатия — петля ждёт и включается сама; громкость пересчитывается в A.listener.
    const loops = new Set();
    A.loop = (name, o = {}) => {
      const h = { name, o: { ...o }, src: null, gain: null, pan: null, dead: false };
      h.set = p => { Object.assign(h.o, p); };
      h.stop = () => { h.dead = true; loops.delete(h); try { h.src?.stop(); } catch (e) {} h.src?.disconnect(); h.gain?.disconnect(); h.pan?.disconnect(); };
      loops.add(h); tick(h);
      return h;
    };
    function tick(h){
      const ctx = A.ctx; if (!ctx || ctx.state !== 'running') return;
      if (!h.src) {
        const b = buf(h.name); if (!b) return;
        h.src = ctx.createBufferSource(); h.src.buffer = b; h.src.loop = true;
        h.gain = ctx.createGain(); h.gain.gain.value = 0; h.src.connect(h.gain);
        if (ctx.createStereoPanner) { h.pan = ctx.createStereoPanner(); h.gain.connect(h.pan); h.pan.connect(A.master); } else h.gain.connect(A.master);
        h.src.start(0, Math.random() * b.duration);   // с разного места — две одинаковые петли не звучат в унисон
      }
      const [g, p] = place(h.o, muted() ? 0 : h.o.vol ?? .6), t = ctx.currentTime;
      h.gain.gain.setTargetAtTime(g, t, .08);
      if (h.pan) h.pan.pan.setTargetAtTime(p, t, .08);
    }
    A.listener = (x, y, z, yaw) => { A.lx = x; A.ly = y; A.lz = z; A.lyaw = yaw || 0; for (const h of loops) tick(h); };
    A.stopLoops = () => { for (const h of [...loops]) h.stop(); };
    A.volume = v => { A.vol = Math.max(0, Math.min(1, v)); if (A.master) A.master.gain.value = A.vol; };
    A.play = (name, o = {}) => {
      if (muted() || A.vol <= 0) return;
      const ctx = A.ctx; if (!ctx || ctx.state !== 'running') { ensure(); return; }
      const b = buf(name); if (!b) return;
      let g = o.vol ?? 1, pan = 0;
      if (o.x != null) {   // в мире: тише издалека (полностью — до 3 м, не слышно — дальше 40 м), сторона — по камере
        const U = E.UNIT || 1, dx = o.x - A.lx, dy = (o.y ?? A.ly) - A.ly, dz = o.z - A.lz, d = Math.hypot(dx, dy, dz) / U;
        const k = d <= 3 ? 1 : Math.max(0, 1 - (d - 3) / 37); g *= k * k;
        if (g < .003) return;
        const rx = Math.cos(A.lyaw), rz = -Math.sin(A.lyaw), dl = Math.hypot(dx, dz) || 1;
        pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / dl)) * Math.min(1, d / 2) * .8;
      }
      const src = ctx.createBufferSource(), gain = ctx.createGain();
      src.buffer = b; src.playbackRate.value = o.rate || 1; gain.gain.value = g;
      let node = gain;
      if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; gain.connect(p); node = p; }
      src.connect(gain); node.connect(A.master); src.start();
    };
    // шаг: пол по месту, не тот же вариант подряд, на бегу громче
    A.step = (floor, run, x, y, z) => {
      const f = FLOORS.includes(floor) ? floor : floor === 'build' ? 'wood' : 'grass';
      let v = Math.random() * 3 | 0; if (v === A.lastStep[f]) v = (v + 1) % 3; A.lastStep[f] = v;
      A.play(`step_${f}${v}`, { x, y, z, vol: run ? .75 : .5, rate: .96 + Math.random() * .08 });
    };
    E._audio = A;
    return A;
  };
})();
