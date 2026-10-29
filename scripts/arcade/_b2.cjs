// Shared helpers for the batch-b2 mini-game test modules (scripts/arcade/<id>.cjs): one «decide» function per game drives
// both the node bot (scripts/arcade-test.cjs) and the Chrome bot (scripts/arcade-e2e.cjs, real PointerEvents / KeyboardEvents).
// decide(s, C, m) is a plain self-contained function (it is stringified for the browser): s — game state, C — spec.consts,
// m — the bot's own memory object; it returns an action code the game module maps to input events.

// node: bot(K, spec, gap) → (s, step, push). act(code, push, T, C, s) turns a decision into queued events.
function nodeBot(decide, act){
  return (K, spec, gap = 1) => {
    const C = spec.consts, T = K.T, m = {};
    let last = -1e9;
    return (s, k, push) => {
      if (s.over || k - last < gap) return;
      const a = decide(s, C, m);
      if (!a) return;
      act(a, push, T, C, s, m);
      last = k;
    };
  };
}

// browser: a JS string that installs window.__bot (setInterval). It reads the live state, calls decide and performs the action
// with real events on the canvas (field units → client pixels). actSrc — body of function (a, s, C, m, P) where
// P.tap(fx, fy, type) dispatches a PointerEvent ('pointerdown' by default) and P.key(code, up) a KeyboardEvent on window.
// stopAfter — the bot stops acting after that score (the slower ⚔️ opponent B). initSrc — code run once (sets m.* for timer jitter).
function e2eBot(id, decide, actSrc, initSrc){
  return (gap, stopAfter = 1e9) => `(() => {
    clearInterval(window.__bot);
    const T = GAME_IMPL.${id}._test, C = T.spec.consts, m = {}, decide = ${decide.toString()};
    ${initSrc || ''}
    const P = {
      tap(fx, fy, type){ const cv = document.querySelector('.ak-cv'); if (!cv) return; const r = cv.getBoundingClientRect();
        cv.dispatchEvent(new PointerEvent(type || 'pointerdown', { clientX: r.left + fx * r.width / T.spec.W, clientY: r.top + fy * r.height / T.spec.H,
          bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true })); },
      key(code, up){ window.dispatchEvent(new KeyboardEvent(up ? 'keyup' : 'keydown', { code, bubbles: true, cancelable: true })); },
    };
    const act = (a, s) => { ${actSrc} };
    window.__bot = setInterval(() => { const s = T.cur(); if (!s || s.over || !T.running() || s.score >= ${stopAfter}) return; const a = decide(s, C, m); if (a) act(a, s); }, ${gap});
    return 1; })()`;
}

// a reusable scenario event (no allocation per call)
function evHelper(spec, K){
  const T = K.T, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 };
  return {
    tap(s, x, y){ ev.type = T.DOWN; ev.x = x; ev.y = y; spec.input(s, ev, null); },
    move(s, x, y){ ev.type = T.MOVE; ev.x = x; ev.y = y; spec.input(s, ev, null); },
    up(s, x, y){ ev.type = T.UP; ev.x = x; ev.y = y; spec.input(s, ev, null); },
    key(s, k){ ev.type = T.KEY; ev.k = k; spec.input(s, ev, null); },
    keyUp(s, k){ ev.type = T.KEYUP; ev.k = k; spec.input(s, ev, null); },
    steps(s, n, inp){ let i = 0; for (; i < n && !s.over; i++) spec.step(s, K.STEP, inp || null); return i; },
  };
}

module.exports = { nodeBot, e2eBot, evHelper };
