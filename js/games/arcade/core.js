// ═══════════════════════════════════════
//  ArcadeKit — shared core of the mini-games (T-140; recipe and rules: docs/ARCADE.md)
// ═══════════════════════════════════════
// One game = one file js/games/arcade/<id>.js that calls ArcadeKit.define('<id>', spec); the kit registers
// GAME_IMPL['<id>'] = { mount, unmount, _test } for js/features/games.js and gives every game the same shell:
//   - fixed step 60 Hz (at most 5 steps per frame, extra lag time is dropped), speeds are per second, so phone and PC
//     (30 / 60 / 144 FPS) play the same game; input events are queued with their time and applied at step boundaries;
//   - canvas with devicePixelRatio (logical field spec.W × spec.H) or a DOM field; pointer / keys → events → action state;
//   - seeded rng (Versus.rng — mulberry32): solo — a new seed per run, ⚔️ competition — the host's seed for both;
//   - start / pause / game-over overlay, HUD line, records (api.report), ⚔️ competition through js/games/versus.js;
//   - sound (one shared AudioContext with games.js gameSfx) and short vibration; theme colours from CSS tokens;
//   - solo: pause when the tab is hidden or a window of the site covers the game (☰ menu, 📖 rules, ⚙️ settings);
//     ⚔️ competition: no pause and no lost time — hidden time is caught up (one clock for both players);
//   - a held key / finger is let go on pause and on focus loss (T.CANCEL); Space / arrows do not scroll the page in a run;
//   - unmount removes every listener / rAF / timer;
//   - ArcadeKit.sim(spec, opts) — the same runner headless with a fake clock (node tests: scripts/arcade-test.cjs).
// spec (all functions except draw/build must be PURE and use only the rng given to create — no Math.random, no Date):
//   kind: 'canvas' | 'dom', W, H — logical field size (canvas: drawing units; dom: aspect only)
//   create(rng, opt) → state s   (s.score — number, bigger is better; s.over — true ends the run; s.snd — sound request:
//     'ok' | 'bad' | 'win' | 'tick' | 'move' (games.js gameSfx) or an INTEGER frequency in Hz (a tone; integers — no boxed doubles))
//   input(s, ev, inp) — one queued event: ev.type (ArcadeKit.T), ev.x / ev.y (field units), ev.k (key index / data-k);
//     T.CANCEL — every held finger / key was let go WITHOUT an action (pause, a window over the game, focus loss): drop
//     «held» state (aiming, charging, pulling, drawing), never fire the release action
//   step(s, dt, inp) — one fixed step (dt = 1/60 s); inp = action state { down, x, y, keys (bit mask) }
//   draw(G, s, alpha) — canvas: G = { ctx, W, H, theme, now }; dom: G = { host, theme } and draw only when s.v changed
//   build(G, s) — dom: build the field for a new state;   keys: { KeyD: 0, ArrowLeft: 1, … } → ev.k / inp.keys bit
//   drag: true — also send MOVE / UP (default: DOWN only);   pick: 'click' | 'down' — dom event for [data-k] elements
//     ('down' — pointerdown: several fingers at once, the tap counts at touch; keyboard Enter / Space still work via click)
//   hud(s) → string, hudKey(s) → number (hud() is called only when the key changes — no string garbage per frame)
//   win(s) → bool (solo «победа» → XP);   result(s) → { title, text };   intro, controls, title — overlay / note texts
//   scoreName — HUD label of the score ('Очки' by default)
(() => {
  if (window.ArcadeKit) return;
  const STEP_MS = 1000 / 60, STEP = 1 / 60, MAX_STEPS = 5;
  const T = { DOWN: 1, MOVE: 2, UP: 3, KEY: 4, KEYUP: 5, PICK: 6, CANCEL: 7 };
  // ⚔️: at most this many steps per frame while catching up hidden time (2 s of game per frame — a few frames after a return)
  const CATCH = 120;
  // keys that scroll the page: when the game does not use them, no page scroll during a run (the run would go on off-screen)
  const SCROLL = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, PageUp: 1, PageDown: 1 };
  const games = {};

  // ── seeded rng: the same generator as Versus.rng (mulberry32); a copy for node tests where versus.js is not loaded ──
  function mulberry32(seed){
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rng = seed => ((window.Versus && window.Versus.rng) || mulberry32)(seed >>> 0);
  // the only allowed Math.random in arcade games: choosing the seed of a solo run
  const newSeed = () => 1 + Math.floor(Math.random() * 2147483646);

  // ── input queue: a fixed ring of pooled events (no allocation per event); handlers must not keep ev ──
  // x / y / t start as doubles (0.5) and are then zeroed: the fields are «double» from birth, so V8 never re-types them
  // later (a Smi → double change deoptimizes the runner and makes it box numbers for a while)
  class Ring {
    constructor(size){
      this.size = size; this.h = 0; this.n = 0; this.b = [];
      for (let i = 0; i < size; i++) { const e = { type: 0, x: 0.5, y: 0.5, k: 0, t: 0.5 }; e.x = e.y = e.t = 0; this.b.push(e); }
    }
    push(type, x, y, k, t){
      const size = this.size;
      if (this.n === size) { this.h = (this.h + 1) % size; this.n--; }   // overflow: the oldest is dropped
      const e = this.b[(this.h + this.n) % size];
      e.type = type; e.x = x; e.y = y; e.k = k; e.t = t; this.n++;
    }
    peek(){ return this.n ? this.b[this.h] : null; }
    shift(){ const e = this.b[this.h]; this.h = (this.h + 1) % this.size; this.n--; return e; }
    clear(){ this.h = 0; this.n = 0; }
  }
  const Queue = size => new Ring(size);

  // ── fixed-step runner. Step k starts at wall time off + k·STEP_MS; an event with time t is applied before the first
  // step whose start ≥ t — so the result depends on event times only, not on the frame rate. hooks.before(s, k) — test
  // bots (R.pushNow stamps an event with the time of this step), hooks.after(s) — after each step (sounds). ──
  // Hot-path hardening (T-140): a class — the methods live once on the prototype (one feedback vector: a new run / game
  // creates no new closures, so the optimized frame() is not thrown away and does not box numbers for a while); every
  // double of the runner lives in the Float64Array tm (typed-array stores never box); every field has one type from birth
  // (no hook → noop, not null); steps is a Smi.
  const noop = () => {};
  class Run {
    constructor(spec, s, hooks){
      this.spec = spec; this.s = s; this.steps = 0; this.on = false;
      this.real = false;   // ⚔️ one clock: lag is never dropped, it is caught up (at most CATCH steps per frame); solo drops it
      // tm[0] off — wall time of step 0, tm[1] lim — wall time of the current step, tm[2] alpha — draw interpolation
      this.tm = new Float64Array(3); this.tm[2] = 1;
      this.q = new Ring(64);
      const inp = this.inp = { down: false, x: 0.5, y: 0.5, keys: 0 };
      inp.x = inp.y = 0;
      const rel = this.rel = { type: T.CANCEL, x: 0.5, y: 0.5, k: 0, t: 0.5 };   // the pooled T.CANCEL event of release()
      rel.x = rel.y = rel.t = 0;
      this.before = (hooks && hooks.before) || noop;
      this.after = (hooks && hooks.after) || noop;
    }
    start(now){ this.on = true; this.tm[0] = now - this.steps * STEP_MS; this.q.clear(); }   // also «continue» after a pause
    stop(){ this.on = false; this.q.clear(); this.release(); }
    // let go of every held finger / key now (a key released while paused never reaches the runner, alt-tab never sends
    // keyup): inp is cleared and the game gets one T.CANCEL — it drops aiming / charging, no release action
    release(){
      const inp = this.inp;
      if (!inp.down && !inp.keys) return;
      inp.down = false; inp.keys = 0;
      if (this.spec.input && !this.s.over) this.spec.input(this.s, this.rel, inp);
    }
    push(type, x, y, k, t){ if (this.on) this.q.push(type, x, y, k, t); }
    pushNow(type, x, y, k){ if (this.on) this.q.push(type, x, y, k, this.tm[1]); }   // for bots inside hooks.before
    drain(){
      const q = this.q, inp = this.inp, sp = this.spec;
      while (q.n) {
        const e = q.peek();
        if (e.t > this.tm[1]) break;
        q.shift();
        const ty = e.type;
        if (ty === T.DOWN) { inp.down = true; inp.x = e.x; inp.y = e.y; }
        else if (ty === T.MOVE) { inp.x = e.x; inp.y = e.y; }
        else if (ty === T.UP) { inp.down = false; inp.x = e.x; inp.y = e.y; }
        else if (ty === T.KEY) inp.keys |= 1 << e.k;
        else if (ty === T.KEYUP) inp.keys &= ~(1 << e.k);
        else if (ty === T.CANCEL) { if (!inp.down && !inp.keys) continue; inp.down = false; inp.keys = 0; }
        if (sp.input) sp.input(this.s, e, inp);
        if (this.s.over) return;
      }
    }
    frame(now){
      if (!this.on) return 0;
      const tm = this.tm, sp = this.spec;
      let target = Math.floor((now - tm[0]) / STEP_MS);
      // lag (slow phone, hidden tab): solo — at most MAX_STEPS per frame, the rest of the time is dropped (no catch-up
      // storm; a hidden tab pauses anyway). ⚔️ (real) — time is never dropped: a hidden tab must not stop the clock
      // (riddles' question timer, the run's time limit); it is caught up at most CATCH steps per frame
      if (target - this.steps > MAX_STEPS) {
        if (this.real) { if (target - this.steps > CATCH) target = this.steps + CATCH; }
        else { tm[0] += (target - this.steps - MAX_STEPS) * STEP_MS; target = this.steps + MAX_STEPS; }
      }
      let n = 0;
      while (this.steps < target) {
        tm[1] = tm[0] + this.steps * STEP_MS;   // wall time of this step (typed array, not an argument: no boxed double per call)
        this.before(this.s, this.steps);
        this.drain();
        if (!this.s.over) sp.step(this.s, STEP, this.inp);
        this.steps++; n++;
        this.after(this.s);
        if (this.s.over) { this.on = false; break; }
      }
      const a = (now - tm[0]) / STEP_MS - this.steps;
      tm[2] = !this.on ? 1 : a < 0 ? 0 : a > 1 ? 1 : a;
      return n;
    }
  }
  const Runner = (spec, s, hooks) => new Run(spec, s, hooks);

  // ── headless run (node tests, e2e): the same Runner with a fake clock ──
  // o: { seed, fps, maxMs, opt, events: [{ t, type, x, y, k }] (sorted by t), bot(s, step, push), draw: G | null }
  // bot — called before every step; push(type, x, y, k) queues an event at the time of that step
  function sim(spec, o){
    const s = spec.create(rng(o.seed >>> 0), o.opt || {});
    const fps = o.fps || 60, ev = o.events || [], maxMs = o.maxMs || 600000;
    const bot = o.bot, G = o.draw || null;
    let R = null;
    const push = (type, x, y, k) => R.pushNow(type, x, y, k);
    R = Runner(spec, s, { before: bot ? (st, k) => bot(st, k, push) : null, after: st => { st.snd = 0; } });
    R.start(0);
    let i = 0, f = 0;
    while (R.on) {
      const now = ++f * 1000 / fps;
      if (now > maxMs) break;
      while (i < ev.length && ev[i].t <= now) { const e = ev[i++]; R.push(e.type, e.x || 0, e.y || 0, e.k || 0, e.t); }
      R.frame(now);
      if (G) spec.draw(G, s, R.tm[2]);
    }
    return { s, steps: R.steps, frames: f, over: !!s.over, score: s.score };
  }

  // State fingerprint for determinism checks: numbers, booleans, strings and typed arrays (functions skipped)
  function hash(s){
    let h = 2166136261 >>> 0;
    const mix = v => { h ^= v >>> 0; h = Math.imul(h, 16777619) >>> 0; };
    const num = x => { const r = Math.round(x * 1e6); mix(r); mix(Math.floor(r / 4294967296)); };
    const walk = (v, depth) => {
      if (v == null || depth > 4) return mix(7);
      if (typeof v === 'number') return num(v);
      if (typeof v === 'boolean') return mix(v ? 3 : 5);
      if (typeof v === 'string') { for (let i = 0; i < v.length; i++) mix(v.charCodeAt(i)); return; }
      if (typeof v === 'function') return;
      if (ArrayBuffer.isView(v)) { for (let i = 0; i < v.length; i++) num(v[i]); return; }
      if (Array.isArray(v)) { mix(v.length); for (const x of v) walk(x, depth + 1); return; }
      if (typeof v === 'object') for (const k of Object.keys(v).sort()) { if (typeof v[k] === 'function') continue; walk(k, depth + 1); walk(v[k], depth + 1); }
    };
    walk(s, 0);
    return h.toString(16);
  }

  // ── sound and vibration: one AudioContext for the whole site (games.js gameAudioCtx), mute and volume from settings ──
  let ownCtx = null;
  function audio(){
    try {
      if (localStorage.getItem('d37_games_mute') === '1') return null;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      /* global gameAudioCtx */
      if (typeof gameAudioCtx !== 'undefined') { if (!gameAudioCtx) gameAudioCtx = new AC(); return gameAudioCtx; }
      return ownCtx || (ownCtx = new AC());
    } catch (e) { return null; }
  }
  // call from a user gesture (tap / click / key): phones start the context «suspended»
  function unlock(){ try { const c = audio(); if (c && c.state === 'suspended') c.resume(); } catch (e) {} }
  function tone(freq, dur, type, vol){
    const ctx = audio();
    if (!ctx) return;
    try {
      const k = window.D37Settings ? D37Settings.sfxGain() : 1;
      if (k < .01) return;
      const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime, d = dur || .12;
      o.type = type || 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime((vol || .07) * k, t0);
      g.gain.exponentialRampToValueAtTime(.0001, t0 + d);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0); o.stop(t0 + d);
    } catch (e) {}
  }
  function buzz(ms){ try { if (window.D37Opt?.shake !== false && navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

  // ── styles of the shell (once per page) ──
  const CSS = '.ak{display:flex;flex-direction:column;align-items:center;gap:.45rem;width:100%}'
    // HUD — two short rows: «Очки · Рекорд», under them the game's line across the whole width (squeezed between the two it
    // was cut with «…» on a 360-px phone); not narrower than 340 px (phone held sideways — the field itself is ~190 px)
    + '.ak-hud{display:grid;grid-template-columns:auto 1fr auto;grid-template-areas:"a . c" "x x x";align-items:center;column-gap:.6rem;row-gap:.1rem;'
    + 'width:max(var(--ak-w,100%),min(100%,340px));max-width:100%;font-size:.78rem;color:var(--muted);font-variant-numeric:tabular-nums}'
    + '.ak-hud b{color:var(--text)}.ak-h1{grid-area:a}.ak-h3{grid-area:c;text-align:right}'
    + '.ak-hx{grid-area:x;min-width:0;min-height:1.25em;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ak-duel .ak-h1{display:none}'
    + '.ak-wrap{position:relative;width:var(--ak-w,100%);max-width:100%}'
    + '.ak-cv{display:block;width:100%;border-radius:14px;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none}'
    + '.ak-dom{position:relative;width:100%;touch-action:manipulation;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}'
    + '.ak-over{position:absolute;inset:0;z-index:2;border-radius:14px;background:rgba(8,8,14,.8);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.7rem;text-align:center;padding:1rem}'
    + '.ak-over[hidden],.ak-over button[hidden]{display:none}'
    + '.ak-ot{font-weight:800;font-size:1.15rem;color:#fff;line-height:1.3}.ak-os{font-size:.82rem;color:#d4d4e4;max-width:32ch;line-height:1.5}'
    + '.ak-note{text-align:center;max-width:46ch}';
  function css(){
    if (document.getElementById('akCss')) return;
    const st = document.createElement('style'); st.id = 'akCss'; st.textContent = CSS; document.head.appendChild(st);
  }
  // Theme colours — CSS tokens of the page (games are «dark islands»: #gamesStage keeps dark tokens in both themes)
  function theme(el){
    const cs = getComputedStyle(el), v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    return { text: v('--text', '#f0f0f8'), muted: v('--muted', '#8d8daa'), accent: v('--accent', '#ff2d55'), tw: v('--tw', '#9147ff'),
      card: v('--card', '#111119'), bg: v('--bg', '#08080e'), bg2: v('--bg2', '#0f0f18'), line: v('--line', 'rgba(255,255,255,.08)'),
      ok: v('--ok-t', '#22c55e'), bad: v('--bad-t', '#f87171'), gold: v('--gold-t', '#ffd166') };
  }
  const fmt = n => Number(n || 0).toLocaleString('ru');

  // ── one mounted game (solo or ⚔️ competition) ──
  function mount(spec, root, api){
    css();
    const I = { spec, root, api, dead: false, duel: false, hooks: null, run: null, s: null, raf: 0, timers: new Set(),
      el: null, cv: null, ctx: null, G: null, rect: null, lastScore: -1, lastKey: NaN, lastV: -1, needNew: false, shownAt: 0, rngFn: null };

    I.later = (fn, ms) => { const t = setTimeout(() => { I.timers.delete(t); if (!I.dead) fn(); }, ms); I.timers.add(t); return t; };
    I.tick = () => tick(I);
    I.after = s => { const k = s.snd; if (!k) return; s.snd = 0; if (typeof k === 'number') tone(k); else { api.sfx(k); if (k === 'bad') buzz(30); } };
    I.onKey = e => key(I, e, true);
    I.onKeyUp = e => key(I, e, false);
    I.onResize = () => { if (I.el) { size(I); paint(I, 1, true); } };
    // solo: pause; ⚔️ — no pause: the runner catches the hidden time up (R.real), the clock is the same for both players
    I.onVis = () => { if (document.hidden && !I.duel && I.run && I.run.on) pause(I); };
    // focus lost (alt-tab, a click into an ad frame): keyup / pointerup never come — let go of held keys and fingers
    I.onBlur = () => { if (I.run && I.run.on) I.run.push(T.CANCEL, 0, 0, 0, performance.now()); };
    I.menus = document.getElementsByClassName('gs-menu');   // live: the game's ☰ menu (D37Settings.menu) is open — no query per frame
    window.addEventListener('keydown', I.onKey);
    window.addEventListener('keyup', I.onKeyUp);
    window.addEventListener('resize', I.onResize);
    window.addEventListener('blur', I.onBlur);
    document.addEventListener('visibilitychange', I.onVis);

    if (window.GameRoom && window.Versus && GameRoom.validCode(api.param)) {
      I.duel = true;
      I.stopDuel = Versus.start(root, api, spec.id, api.param, {
        run(stage, r, h){ halt(I); I.rngFn = r; I.hooks = h; build(I, stage); },
        stop(){ halt(I); },
        onMsg: d => spec.onMsg?.(I.s, d),
      });
    } else build(I, root);

    I.destroy = () => {
      I.dead = true;
      halt(I);
      for (const t of I.timers) clearTimeout(t);
      I.timers.clear();
      window.removeEventListener('keydown', I.onKey);
      window.removeEventListener('keyup', I.onKeyUp);
      window.removeEventListener('resize', I.onResize);
      window.removeEventListener('blur', I.onBlur);
      document.removeEventListener('visibilitychange', I.onVis);
      I.stopDuel?.(); I.stopDuel = null;
      I.run = I.s = I.G = I.el = I.cv = I.ctx = I.hooks = I.rngFn = I.menus = null;
      I.root = null;
    };
    return I;
  }

  function build(I, host){
    const sp = I.spec, canvas = sp.kind !== 'dom';
    host.innerHTML = '<div class="ak"><div class="ak-hud"><span class="ak-h1"><span class="ak-sn"></span>: <b class="ak-sc">0</b></span>'
      + '<span class="ak-hx"></span><span class="ak-h3">Рекорд: <b class="ak-best">0</b></span></div>'
      + '<div class="ak-wrap">' + (canvas ? '<canvas class="ak-cv"></canvas>' : '<div class="ak-dom"></div>')
      + '<div class="ak-over"><div class="ak-ot"></div><div class="ak-os"></div><button type="button" class="ct-start ak-go"></button>'
      + '<button type="button" class="ct-duel-btn ak-vs">⚔️ Соревноваться с другом</button></div></div>'
      + '<div class="ct-note ak-note"></div></div>';
    const el = I.el = host.querySelector('.ak');
    el.dataset.ak = sp.id;
    el.classList.toggle('ak-duel', I.duel);
    el.querySelector('.ak-sn').textContent = sp.scoreName || 'Очки';
    el.querySelector('.ak-note').textContent = sp.controls || '';
    if (I.duel) el.querySelector('.ak-h3').hidden = true;
    else el.querySelector('.ak-best').textContent = fmt(I.api.local().best || 0);
    I.go = el.querySelector('.ak-go');
    I.over = el.querySelector('.ak-over');
    I.go.addEventListener('click', () => { if (performance.now() - I.shownAt < 350) return; unlock(); I.goFn?.(); });   // a late tap from the game must not press it
    const vs = el.querySelector('.ak-vs');
    if (I.duel) vs.remove();
    else vs.addEventListener('click', () => { location.hash = '#/games/' + sp.id + '/' + GameRoom.newCode(); });
    I.G = { ctx: null, host: null, W: sp.W, H: sp.H, theme: theme(el), now: 0, dpr: 1 };
    if (canvas) {
      I.cv = el.querySelector('.ak-cv'); I.ctx = I.cv.getContext('2d'); I.G.ctx = I.ctx;
      const pt = (e, type) => {
        if (!I.run || !I.run.on) return;
        if (type === T.DOWN || !I.rect) I.rect = I.cv.getBoundingClientRect();   // cached for moves: no DOMRect per move
        const r = I.rect;
        I.run.push(type, (e.clientX - r.left) * sp.W / (r.width || 1), (e.clientY - r.top) * sp.H / (r.height || 1), 0, performance.now());
      };
      I.cv.addEventListener('pointerdown', e => { e.preventDefault(); unlock(); if (sp.drag) { try { I.cv.setPointerCapture(e.pointerId); } catch (er) {} } pt(e, T.DOWN); });
      if (sp.drag) {
        I.cv.addEventListener('pointermove', e => { if (I.run?.inp.down) pt(e, T.MOVE); });
        I.cv.addEventListener('pointerup', e => pt(e, T.UP));
        I.cv.addEventListener('pointercancel', e => pt(e, T.UP));
      }
      I.cv.addEventListener('contextmenu', e => e.preventDefault());
    } else {
      const dom = I.G.host = el.querySelector('.ak-dom');
      // pick: 'down' — the press counts at pointerdown: browsers fire no click for overlapping multi-touch taps (two thumbs);
      // the click that follows a pointer press is skipped (detail ≥ 1), keyboard Enter / Space clicks (detail 0) still count
      const down = sp.pick === 'down';
      const pick = e => {
        if (e.type === 'pointerdown' ? e.button !== 0 : down && e.detail !== 0) return;
        const b = e.target.closest?.('[data-k]');
        if (!b || !dom.contains(b) || !I.run || !I.run.on) return;
        if (e.type === 'pointerdown') e.preventDefault();
        unlock();
        I.run.push(T.PICK, 0, 0, +b.dataset.k, performance.now());
      };
      dom.addEventListener('click', pick);
      if (down) dom.addEventListener('pointerdown', pick);
    }
    fresh(I);
    size(I);
    paint(I, 1, true);
    overlay(I, sp.title || '', sp.intro || '', I.duel ? '▶ Старт' : '▶ Начать', () => start(I));
    if (I.duel) I.el.querySelector('.ak-ot').textContent = '⚔️ ' + (sp.duelTitle || 'Одинаковая игра у обоих');
  }

  // a new state: competition — from the host's rng (one per round), solo — from a new seed
  function fresh(I){
    const sp = I.spec;
    I.s = sp.create(I.duel ? I.rngFn : rng(newSeed()), {});
    I.run = null;
    I.lastScore = -1; I.lastKey = NaN; I.lastV = -1; I.needNew = false;
    if (sp.kind === 'dom' && sp.build) sp.build(I.G, I.s);
    hud(I);
  }

  function size(I){
    const sp = I.spec, el = I.el;
    const avail = Math.max(200, (el.parentElement?.clientWidth || el.clientWidth || 360));
    const maxH = Math.max(260, (window.innerHeight || 700) - (sp.kind === 'dom' ? 180 : 210) - 18);   // − 18: the HUD's second row
    const w = Math.floor(Math.min(avail, sp.maxW || 420, maxH * sp.W / sp.H));
    el.style.setProperty('--ak-w', w + 'px');
    if (!I.cv) return;
    const h = Math.round(w * sp.H / sp.W), dpr = Math.min(2, window.devicePixelRatio || 1);
    I.cv.style.height = h + 'px';
    I.cv.width = Math.round(w * dpr); I.cv.height = Math.round(h * dpr);
    I.G.dpr = dpr;
    I.ctx.setTransform(w * dpr / sp.W, 0, 0, h * dpr / sp.H, 0, 0);   // the game draws in field units
    I.rect = null;
  }

  function paint(I, alpha, force){
    const s = I.s, sp = I.spec;
    if (!s || !I.G) return;
    if (sp.kind === 'dom') { if (force || s.v !== I.lastV) { I.lastV = s.v; sp.draw(I.G, s, alpha); } return; }
    I.G.now = performance.now();
    sp.draw(I.G, s, alpha);
  }

  function hud(I){
    const s = I.s, sp = I.spec;
    if (s.score !== I.lastScore) {
      I.lastScore = s.score;
      I.el.querySelector('.ak-sc').textContent = fmt(s.score);
      if (I.hooks && I.run) I.hooks.progress(s.score);
    }
    if (sp.hudKey) { const k = sp.hudKey(s); if (k !== I.lastKey) { I.lastKey = k; I.el.querySelector('.ak-hx').textContent = sp.hud(s); } }
  }

  function overlay(I, title, text, btn, fn){
    I.over.hidden = false;
    I.el.querySelector('.ak-ot').textContent = title;
    I.el.querySelector('.ak-os').textContent = text;
    I.go.hidden = !btn;
    I.go.textContent = btn || '';
    I.goFn = fn;
    I.shownAt = performance.now();
    const vs = I.el.querySelector('.ak-vs');
    if (vs) vs.hidden = !!(I.run && I.run.on) || title === '⏸ Пауза';
  }

  function start(I){
    if (I.needNew) { fresh(I); paint(I, 1, true); }
    I.over.hidden = true;
    I.run = Runner(I.spec, I.s, { after: I.after });
    I.run.real = I.duel;
    I.run.start(performance.now());
    cancelAnimationFrame(I.raf);
    I.raf = requestAnimationFrame(I.tick);
  }
  function resume(I){
    if (!I.run) return start(I);
    I.over.hidden = true;
    I.run.start(performance.now());
    cancelAnimationFrame(I.raf);
    I.raf = requestAnimationFrame(I.tick);
  }
  function halt(I){
    cancelAnimationFrame(I.raf); I.raf = 0;
    if (I.run) I.run.stop();
  }
  // solo pause: the steps stop, held keys / fingers are let go (stop → release), «▶ Продолжить» goes on
  function pause(I){
    halt(I);
    overlay(I, '⏸ Пауза', 'Игра ждёт тебя.', '▶ Продолжить', () => resume(I));
  }
  // a window of the site is over the game: ☰ menu, 📖 rules / «точно?» (GameKit), ⚙️ settings — the game must not run on
  // behind it (solo pauses) and must not take keys meant for it
  function blocked(I){
    const GK = window.GameKit, ST = window.D37Settings;
    return !!((I.menus && I.menus.length) || (GK && GK.isOpen && GK.isOpen()) || (ST && ST.isOpen && ST.isOpen()));
  }

  function tick(I){
    I.raf = 0;
    const R = I.run;
    if (I.dead || !R || !R.on) return;
    if (!I.duel && blocked(I)) return pause(I);
    R.frame(performance.now());
    paint(I, R.tm[2], false);
    hud(I);
    if (I.s.over) return finish(I);
    if (R.on) I.raf = requestAnimationFrame(I.tick);
  }

  function finish(I){
    const s = I.s, sp = I.spec, api = I.api, score = Math.max(0, Math.round(s.score || 0));
    const res = (sp.result && sp.result(s)) || {};
    paint(I, 1, true);
    hud(I);
    if (I.hooks) {
      I.hooks.done(score);
      I.later(() => overlay(I, res.title || '🏁 Финиш', 'Твой счёт: ' + fmt(score) + '. Итог — над полем.', '', null), 450);
      return;
    }
    const win = !!(sp.win && sp.win(s));
    const best = Math.max(api.local().best || 0, score);
    I.needNew = true;
    api.report(sp.id, win, score, score);
    I.el.querySelector('.ak-best').textContent = fmt(best);
    // the overlay appears a moment later: the player sees what happened, and a late tap does not press «Ещё раз»
    I.later(() => overlay(I, res.title || '🏁 Игра окончена', (res.text ? res.text + ' · ' : '') + sp.scoreName0(score) + ' · рекорд: ' + fmt(best), '↻ Ещё раз', () => start(I)), 450);
  }

  function key(I, e, down){
    if (I.dead || !I.el) return;
    if (e.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    if (blocked(I)) return;
    if (down && !I.over.hidden && !I.go.hidden && (e.code === 'Space' || e.code === 'Enter') && !e.target?.closest?.('button')) {
      e.preventDefault(); unlock(); if (performance.now() - I.shownAt >= 350) I.goFn?.(); return;
    }
    const k = I.spec.keys ? I.spec.keys[e.code] : undefined;
    if (k === undefined) {
      // not the game's key: Space / arrows / PageUp / PageDown would scroll the page and the run would go on off-screen
      // (Space on a focused button presses it — that stays)
      if (down && SCROLL[e.code] === 1 && I.run && I.run.on && !(e.code === 'Space' && e.target?.closest?.('button,a,[role="button"]'))) e.preventDefault();
      return;
    }
    if (!I.run || !I.run.on) return;
    e.preventDefault();
    if (down && e.repeat) return;
    if (down) unlock();
    I.run.push(down ? T.KEY : T.KEYUP, 0, 0, k, performance.now());
  }

  // ── register a game ──
  function define(id, spec){
    spec.id = id;
    spec.scoreName0 = spec.scoreName0 || (n => (spec.scoreName || 'Очки') + ': ' + fmt(n));
    let live = null;   // the mounted instance (for e2e bots via _test.cur); dropped on unmount
    const impl = {
      mount(el, api){ live?.destroy(); live = mount(spec, el, api); },
      unmount(){ live?.destroy(); live = null; },
      _test: { spec, cur: () => (live && live.s) || null, running: () => !!(live && live.run && live.run.on), inst: () => live },
    };
    games[id] = spec;
    if (window.GAME_IMPL) window.GAME_IMPL[id] = impl;
    return impl;
  }

  window.ArcadeKit = { define, sim, hash, rng, newSeed, Runner, Queue, T, STEP, STEP_MS, MAX_STEPS, tone, buzz, unlock, theme, fmt, games };
})();
