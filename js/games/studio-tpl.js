// ═══════════════════════════════════════
//  ШАБЛОНЫ «СТУДИИ ИГР» — игры без кода: игрок меняет героя, предметы, цвета, скорость, тексты
// ═══════════════════════════════════════
// Каждый шаблон — функция code(P, D37): уходит в песочницу (studio/frame.html) текстом через toString(), поэтому
// ничего снаружи не видит — всё своё внутри. P — параметры из редактора (уже проверены clean()), D37 — счёт, конец игры,
// звуки и мини-движок D37.game() (холст высотой 600, ширина — по экрану). params — поля редактора:
// text (max), emoji, emojis (max), color, range (min…max, по умолчанию 1…10), bool, qa (вопросы викторины).
(() => {
  // ── 1. Раннер ──
  function runner(P, D37) {
    const G = D37.game({ h: 600, minW: 340, maxW: 1100 });
    const FLOOR = 470, HX = 120, HS = 64;
    const sp0 = 230 + P.speed * 32, jv = 610 + P.jump * 40, grav = 2000;
    let st = 'start', hero, obs, coins, score, coinsN, dist, speed, nextObs, nextCoin, lives, hurt, endT = 0;
    let best = +localStorage.getItem('best') || 0;
    const clouds = Array.from({ length: 7 }, (_, i) => ({ x: i * 200 + Math.random() * 120, y: 50 + Math.random() * 170, s: .6 + Math.random() * .8 }));
    function reset() {
      hero = { y: FLOOR, vy: 0, on: true, jumps: 0, rot: 0 };
      obs = []; coins = []; score = 0; coinsN = 0; dist = 0; speed = sp0; nextObs = 1.3; nextCoin = 2; lives = P.lives; hurt = 0;
    }
    reset();
    const jump = () => {
      if (hero.on || hero.jumps < (P.double ? 2 : 1)) { hero.vy = -jv * (hero.on ? 1 : .85); hero.on = false; hero.jumps++; D37.sfx('jump'); }
    };
    const overlay = (a, b) => {
      G.rect(0, 0, G.w, G.h, 'rgba(0,0,0,.32)');
      G.text(a, G.w / 2, G.h * .38, 44, '#fff');
      if (b) G.text(b, G.w / 2, G.h * .38 + 58, 22, '#fff');
    };
    G.loop(dt => {
      const tap = G.hit();
      for (const c of clouds) { c.x -= (st === 'play' ? speed * .12 : 18) * dt * c.s; if (c.x < -160) { c.x = G.w + 120; c.y = 50 + Math.random() * 170; } }
      if (st === 'start') { hero.rot = Math.sin(G.t * 5) * .08; if (tap) { st = 'play'; reset(); jump(); } return; }
      if (st === 'over') { endT += dt; if (tap && endT > .7) { st = 'play'; reset(); D37.again(); } return; }
      if (tap) jump();
      speed += dt * (4 + P.speed * .8);
      dist += speed * dt;
      hero.vy += grav * dt; hero.y += hero.vy * dt;
      if (hero.y >= FLOOR) { hero.y = FLOOR; hero.vy = 0; hero.on = true; hero.jumps = 0; }
      hero.rot = hero.on ? Math.sin(G.t * 18) * .08 : hero.rot + dt * 7;
      hurt = Math.max(0, hurt - dt);
      if ((nextObs -= dt) <= 0) {
        const s = 52 + Math.random() * 22;
        obs.push({ x: G.w + 60, s, e: D37.pick(P.obstacles), fly: dist > 3000 && Math.random() < .2 });
        nextObs = Math.max(.55, (1.55 - P.often * .09) * (sp0 / speed) * 1.25 + Math.random() * .75);
      }
      if ((nextCoin -= dt) <= 0) { coins.push({ x: G.w + 40, y: FLOOR - 70 - Math.random() * 170 }); nextCoin = .7 + Math.random() * 1.4; }
      for (const o of obs) o.x -= speed * dt;
      for (const c of coins) c.x -= speed * dt;
      obs = obs.filter(o => o.x > -120);
      coins = coins.filter(c => c.x > -60 && !c.got);
      const hy = hero.y - HS * .45, hr = HS * .32;
      for (const o of obs) {
        const oy = o.fly ? FLOOR - 165 : FLOOR - o.s * .45;
        if (!o.hit && Math.hypot(o.x - HX, oy - hy) < hr + o.s * .34) {
          o.hit = true;
          if (hurt > 0) continue;
          lives--; hurt = 1.2; D37.sfx('hit');
          if (lives <= 0) {
            st = 'over'; endT = 0;
            if (score > best) { best = score; localStorage.setItem('best', best); }
            D37.sfx('over'); D37.over(score);
            return;
          }
        }
      }
      for (const c of coins) if (Math.hypot(c.x - HX, c.y - hy) < hr + 24) { c.got = true; coinsN++; D37.sfx('coin'); }
      score = Math.floor(dist / 40) + coinsN * 10;
      D37.score(score);
    }, () => {
      G.bg(P.sky);
      G.circle(G.w - 90, 90, 42, 'rgba(255,240,150,.9)');
      for (const c of clouds) {
        const k = c.s;
        G.circle(c.x, c.y, 26 * k, 'rgba(255,255,255,.85)'); G.circle(c.x + 28 * k, c.y + 6 * k, 20 * k, 'rgba(255,255,255,.85)'); G.circle(c.x - 26 * k, c.y + 8 * k, 18 * k, 'rgba(255,255,255,.85)');
      }
      G.rect(-600, FLOOR + 2, G.w + 1200, 300, P.ground);
      G.rect(-600, FLOOR + 2, G.w + 1200, 8, 'rgba(0,0,0,.18)');
      const off = (dist || 0) % 70;
      for (let x = -off; x < G.w + 70; x += 70) G.rect(x, FLOOR + 34, 30, 6, 'rgba(0,0,0,.12)');
      for (const c of coins) G.emoji(P.coin, c.x, c.y + Math.sin(G.t * 5 + c.x * .02) * 4, 40);
      for (const o of obs) G.emoji(o.e, o.x, o.fly ? FLOOR - 165 + Math.sin(G.t * 4 + o.x * .01) * 10 : FLOOR - o.s * .45, o.s);
      G.ctx.globalAlpha = .22; G.circle(HX, FLOOR + 8, 26 * (1 - Math.min(.6, (FLOOR - hero.y) / 400)), '#000'); G.ctx.globalAlpha = 1;
      if (!(hurt > 0 && Math.floor(G.t * 12) % 2)) G.emoji(P.hero, HX, hero.y - HS * .45, HS, hero.rot);
      G.text(score, 20, 36, 32, '#fff', 'left');
      G.text('🏆 ' + best, G.w - 20, 36, 22, '#fff', 'right');
      if (P.lives > 1 && st === 'play') G.text('❤️'.repeat(Math.max(0, lives)), 20, 76, 22, '#fff', 'left', false);
      if (st === 'start') overlay(P.title, 'Нажми или пробел — прыжок' + (P.double ? ' (можно двойной)' : ''));
      if (st === 'over') overlay('Счёт: ' + score, endT > .7 ? 'Нажми — ещё раз' : '');
    });
  }

  // ── 2. Ловилка ──
  function catcher(P, D37) {
    const G = D37.game({ h: 600, minW: 340, maxW: 760 });
    const CY = 540, CS = 76;
    let st = 'start', x, items, score, lives, spawn, fall, hurt, endT = 0, shake = 0, combo = 0;
    let best = +localStorage.getItem('best') || 0;
    function reset() { x = G.w / 2; items = []; score = 0; lives = P.lives; spawn = .6; fall = 150 + P.speed * 26; hurt = 0; combo = 0; }
    reset();
    const overlay = (a, b) => { G.rect(0, 0, G.w, G.h, 'rgba(0,0,0,.35)'); G.text(a, G.w / 2, G.h * .36, 42, '#fff'); if (b) G.text(b, G.w / 2, G.h * .36 + 56, 21, '#fff'); };
    G.loop(dt => {
      const tap = G.hit();
      if (st === 'start') { if (tap) { st = 'play'; reset(); } return; }
      if (st === 'over') { endT += dt; if (tap && endT > .7) { st = 'play'; reset(); D37.again(); } return; }
      // управление: палец/мышь — корзина едет к нему, стрелки — сама
      if (G.pointer.down) x += (G.pointer.x - x) * Math.min(1, dt * 14);
      if (G.held('left')) x -= (420 + P.speed * 25) * dt;
      if (G.held('right')) x += (420 + P.speed * 25) * dt;
      x = Math.max(CS / 2, Math.min(G.w - CS / 2, x));
      fall += dt * (3 + P.speed);
      hurt = Math.max(0, hurt - dt); shake = Math.max(0, shake - dt);
      if ((spawn -= dt) <= 0) {
        const r = Math.random(), kind = r < .13 && P.bad.length ? 'bad' : r < .18 ? 'bonus' : 'good';
        items.push({ x: 30 + Math.random() * (G.w - 60), y: -40, k: kind, e: kind === 'bad' ? D37.pick(P.bad) : kind === 'bonus' ? P.bonus : D37.pick(P.good), v: fall * (.8 + Math.random() * .4), r: Math.random() * 6 });
        spawn = Math.max(.28, .95 - score * .006) * (1.3 - P.speed * .05);
      }
      for (const it of items) { it.y += it.v * dt; it.r += dt * 2; }
      for (const it of items) {
        if (!it.done && it.y > CY - 40 && it.y < CY + 20 && Math.abs(it.x - x) < CS * .62) {
          it.done = true;
          if (it.k === 'bad') {
            combo = 0; shake = .35; D37.sfx('bad');
            if (hurt <= 0) { lives--; hurt = .8; }
            if (lives <= 0) {
              st = 'over'; endT = 0;
              if (score > best) { best = score; localStorage.setItem('best', best); }
              D37.sfx('over'); D37.over(score);
              return;
            }
          } else { combo++; score += it.k === 'bonus' ? 5 : 1 + Math.floor(combo / 10); D37.sfx(it.k === 'bonus' ? 'good' : 'coin'); }
        }
      }
      items = items.filter(it => !it.done && it.y < G.h + 60);
      D37.score(score);
    }, () => {
      G.bg(P.bg);
      const sx = shake > 0 ? (Math.random() - .5) * 14 : 0;
      G.ctx.save(); G.ctx.translate(sx, 0);
      for (let i = 0; i < 26; i++) { const sxx = (i * 137) % G.w, syy = (i * 89 + G.t * (10 + i % 5 * 6)) % G.h; G.circle(sxx, syy, 1.5 + i % 3, 'rgba(255,255,255,.12)'); }
      for (const it of items) G.emoji(it.e, it.x, it.y, it.k === 'bonus' ? 50 : 46, Math.sin(it.r) * .3);
      if (!(hurt > 0 && Math.floor(G.t * 14) % 2)) G.emoji(P.catcher, x, CY, CS);
      G.ctx.restore();
      G.text(score, 18, 34, 30, '#fff', 'left');
      G.text('🏆 ' + best, G.w - 18, 34, 20, '#fff', 'right');
      if (st === 'play') G.text('❤️'.repeat(Math.max(0, lives)), G.w / 2, 34, 22, '#fff', 'center', false);
      if (combo >= 10 && st === 'play') G.text('Комбо ×' + (1 + Math.floor(combo / 10)), G.w / 2, 74, 20, '#ffd84d');
      if (st === 'start') overlay(P.title, 'Лови ' + P.good.slice(0, 3).join(' ') + (P.bad.length ? ', не лови ' + P.bad.slice(0, 2).join(' ') : ''));
      if (st === 'over') overlay('Счёт: ' + score, endT > .7 ? 'Нажми — ещё раз' : '');
    });
  }

  // ── 3. Летун (как Flappy Bird) ──
  function flappy(P, D37) {
    const G = D37.game({ h: 600, minW: 340, maxW: 900 });
    const HX = 130, HS = 56, GAP = 150 + P.gap * 12, SP = 150 + P.speed * 18, grav = 1500 + P.speed * 40, flap = 460;
    let st = 'start', y, vy, pipes, score, next, endT = 0;
    let best = +localStorage.getItem('best') || 0;
    function reset() { y = 280; vy = 0; pipes = []; score = 0; next = .9; }
    reset();
    const overlay = (a, b) => { G.rect(0, 0, G.w, G.h, 'rgba(0,0,0,.3)'); G.text(a, G.w / 2, G.h * .36, 44, '#fff'); if (b) G.text(b, G.w / 2, G.h * .36 + 58, 21, '#fff'); };
    G.loop(dt => {
      const tap = G.hit();
      if (st === 'start') { y = 280 + Math.sin(G.t * 3) * 14; if (tap) { st = 'play'; reset(); vy = -flap; D37.sfx('jump'); } return; }
      if (st === 'over') { endT += dt; vy += grav * dt; y = Math.min(560, y + vy * dt); if (tap && endT > .7) { st = 'play'; reset(); D37.again(); } return; }
      if (tap) { vy = -flap; D37.sfx('jump'); }
      vy += grav * dt; y += vy * dt;
      if ((next -= dt) <= 0) { const top = 70 + Math.random() * (600 - 140 - GAP); pipes.push({ x: G.w + 50, top, done: false }); next = (230 + Math.random() * 60) / SP; }
      for (const p of pipes) p.x -= SP * dt;
      pipes = pipes.filter(p => p.x > -90);
      let dead = y > 575 || y < -40;
      for (const p of pipes) {
        if (!p.done && p.x < HX - 40) { p.done = true; score++; D37.sfx('coin'); }
        if (Math.abs(p.x - HX) < 40 + HS * .32 && (y - HS * .32 < p.top || y + HS * .32 > p.top + GAP)) dead = true;
      }
      if (dead) {
        st = 'over'; endT = 0;
        if (score > best) { best = score; localStorage.setItem('best', best); }
        D37.sfx('hit'); setTimeout(() => D37.sfx('over'), 250); D37.over(score);
      }
      D37.score(score);
    }, () => {
      G.bg(P.bg);
      for (let i = 0; i < 6; i++) { const cx = ((i * 260 - G.t * 20) % (G.w + 300) + G.w + 300) % (G.w + 300) - 150; G.circle(cx, 90 + (i % 3) * 60, 30, 'rgba(255,255,255,.6)'); G.circle(cx + 32, 98 + (i % 3) * 60, 22, 'rgba(255,255,255,.6)'); }
      for (const p of pipes) {
        G.rect(p.x - 40, -10, 80, p.top + 10, P.pipe, 10); G.rect(p.x - 46, p.top - 26, 92, 26, P.pipe, 8);
        G.rect(p.x - 40, p.top + GAP, 80, 700, P.pipe, 10); G.rect(p.x - 46, p.top + GAP, 92, 26, P.pipe, 8);
        G.rect(p.x - 32, -10, 10, p.top + 10, 'rgba(255,255,255,.18)'); G.rect(p.x - 32, p.top + GAP + 26, 10, 700, 'rgba(255,255,255,.18)');
      }
      G.rect(-500, 585, G.w + 1000, 40, 'rgba(0,0,0,.25)');
      G.emoji(P.hero, HX, y, HS, Math.max(-.5, Math.min(1.1, vy / 900)));
      G.text(score, G.w / 2, 70, 54, '#fff');
      G.text('🏆 ' + best, G.w - 18, 30, 20, '#fff', 'right');
      if (st === 'start') overlay(P.title, 'Нажимай, чтобы лететь вверх');
      if (st === 'over') overlay('Счёт: ' + score, endT > .7 ? 'Нажми — ещё раз' : '');
    });
  }

  // ── 4. Тапалка (как «Убей крота») ──
  function whack(P, D37) {
    const G = D37.game({ h: 600, minW: 340, maxW: 760 });
    const N = P.grid, TIME = P.time;
    let st = 'start', holes, score, left, spawn, combo, endT = 0, pops = [];
    let best = +localStorage.getItem('best') || 0;
    function layout() {
      const cell = Math.min((G.w - 40) / N, 420 / N), ox = (G.w - cell * N) / 2, oy = 140 + (440 - cell * N) / 2;
      holes = holes || [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const i = r * N + c, h = holes[i] || (holes[i] = { up: 0, t: 0, e: '', bad: false, hit: 0 });
        h.x = ox + cell * (c + .5); h.y = oy + cell * (r + .5); h.r = cell * .38;
      }
    }
    function reset() { holes = null; layout(); score = 0; left = TIME; spawn = .5; combo = 0; pops = []; }
    reset();
    const overlay = (a, b) => { G.rect(0, 0, G.w, G.h, 'rgba(0,0,0,.4)'); G.text(a, G.w / 2, G.h * .36, 42, '#fff'); if (b) G.text(b, G.w / 2, G.h * .36 + 56, 21, '#fff'); };
    G.loop(dt => {
      layout();
      if (st === 'start') { if (G.hit()) { st = 'play'; reset(); } return; }
      if (st === 'over') { endT += dt; if (G.hit() && endT > .7) { st = 'play'; reset(); D37.again(); } return; }
      left -= dt;
      if (left <= 0) {
        st = 'over'; endT = 0;
        if (score > best) { best = score; localStorage.setItem('best', best); }
        D37.sfx('win'); D37.over(score);
        return;
      }
      const stay = Math.max(.45, 1.5 - P.speed * .09 - (TIME - left) * .008);
      if ((spawn -= dt) <= 0) {
        const free = holes.filter(h => !h.up);
        if (free.length) { const h = D37.pick(free); h.up = 1; h.t = stay; h.bad = P.bad.length > 0 && Math.random() < .2; h.e = h.bad ? D37.pick(P.bad) : D37.pick(P.good); h.hit = 0; }
        spawn = Math.max(.18, .75 - P.speed * .04 - (TIME - left) * .006) * (.7 + Math.random() * .6);
      }
      for (const h of holes) if (h.up) { h.t -= dt; if (h.t <= 0) { if (!h.bad && !h.hit) combo = 0; h.up = 0; } }
      if (G.tap) {
        const px = G.pointer.x, py = G.pointer.y;
        const h = holes.find(o => o.up && !o.hit && Math.hypot(o.x - px, o.y - py) < o.r * 1.15);
        if (h) {
          h.hit = 1; h.t = Math.min(h.t, .22);
          if (h.bad) { score = Math.max(0, score - 3); combo = 0; D37.sfx('bad'); pops.push({ x: h.x, y: h.y, s: '−3', c: '#ff6b6b', t: .7 }); }
          else { combo++; const add = 1 + Math.floor(combo / 5); score += add; D37.sfx('good'); pops.push({ x: h.x, y: h.y, s: '+' + add, c: '#ffd84d', t: .7 }); }
        }
      }
      for (const p of pops) { p.t -= dt; p.y -= 60 * dt; }
      pops = pops.filter(p => p.t > 0);
      D37.score(score);
    }, () => {
      G.bg(P.bg);
      for (const h of holes) {
        G.ctx.save(); G.ctx.translate(h.x, h.y + h.r * .45); G.ctx.scale(1, .42); G.circle(0, 0, h.r * 1.05, P.hole); G.ctx.restore();
        if (h.up) {
          const k = Math.min(1, (h.hit ? h.t / .22 : 1)) * Math.min(1, (h.t + .001) / .12 + .2);
          G.emoji(h.e, h.x, h.y + h.r * .35 - h.r * .55 * Math.min(1, k), h.r * 1.5, h.hit ? .4 : 0, h.hit ? .6 : 1);
        }
      }
      for (const p of pops) G.text(p.s, p.x, p.y - 30, 30, p.c);
      G.text(score, 20, 40, 34, '#fff', 'left');
      G.text('⏱ ' + Math.max(0, Math.ceil(left)), G.w / 2, 40, 30, left < 6 ? '#ff8080' : '#fff');
      G.text('🏆 ' + best, G.w - 20, 40, 20, '#fff', 'right');
      if (combo >= 5 && st === 'play') G.text('Комбо ×' + (1 + Math.floor(combo / 5)), G.w / 2, 92, 22, '#ffd84d');
      if (st === 'start') overlay(P.title, 'Жми на ' + P.good.slice(0, 3).join(' ') + (P.bad.length ? ' · не трогай ' + P.bad.slice(0, 2).join(' ') : ''));
      if (st === 'over') overlay('Счёт: ' + score, endT > .7 ? 'Нажми — ещё раз' : '');
    });
  }

  // ── 5. Викторина ──
  function quiz(P, D37) {
    const G = D37.game({ h: 600, minW: 340, maxW: 820 });
    let st = 'start', list, i, score, pick, wait, tleft, endT = 0;
    let best = +localStorage.getItem('best') || 0;
    const wrap = (s, max, size) => {
      G.ctx.font = '800 ' + size + 'px Montserrat, "Segoe UI", Arial, sans-serif';
      const words = String(s).split(' '), out = [];
      let cur = '';
      for (const w of words) { const t = cur ? cur + ' ' + w : w; if (G.ctx.measureText(t).width > max && cur) { out.push(cur); cur = w; } else cur = t; }
      if (cur) out.push(cur);
      return out;
    };
    function reset() {
      list = P.questions.map(q => ({ q: q.q, a: q.a.map((t, k) => ({ t, ok: k === q.right })) }));
      if (P.shuffle) { list.sort(() => Math.random() - .5); list.forEach(q => q.a.sort(() => Math.random() - .5)); }
      i = 0; score = 0; pick = -1; wait = 0; tleft = P.timer;
    }
    reset();
    const boxes = () => {
      const n = list[i].a.length, bw = Math.min(G.w - 40, 560), bh = 64, gap = 12, top = 600 - 30 - n * (bh + gap);
      return list[i].a.map((a, k) => ({ x: (G.w - bw) / 2, y: top + k * (bh + gap), w: bw, h: bh, a }));
    };
    function answer(k) {
      if (pick >= 0) return;
      pick = k; wait = 1.1;
      if (k >= 0 && list[i].a[k].ok) { score++; D37.sfx('good'); } else D37.sfx('bad');
    }
    G.loop(dt => {
      if (st === 'start') { if (G.hit()) { st = 'play'; reset(); } return; }
      if (st === 'over') { endT += dt; if (G.hit() && endT > .7) { st = 'play'; reset(); D37.again(); } return; }
      if (pick < 0) {
        if (P.timer) { tleft -= dt; if (tleft <= 0) answer(-1); }
        if (G.tap) { const b = boxes().findIndex(o => G.pointer.x > o.x && G.pointer.x < o.x + o.w && G.pointer.y > o.y && G.pointer.y < o.y + o.h); if (b >= 0) answer(b); }
        for (let k = 0; k < 4; k++) if (G.pressed[String(k + 1)] && k < list[i].a.length) answer(k);
      } else if ((wait -= dt) <= 0) {
        i++; pick = -1; tleft = P.timer;
        if (i >= list.length) {
          st = 'over'; endT = 0;
          if (score > best) { best = score; localStorage.setItem('best', best); }
          D37.sfx(score * 2 >= list.length ? 'win' : 'over'); D37.over(score, score === list.length);
        }
      }
      D37.score(score);
    }, () => {
      G.bg(P.bg);
      if (st === 'start') {
        wrap(P.title, G.w - 60, 40).forEach((l, k, a) => G.text(l, G.w / 2, 230 - (a.length - 1) * 24 + k * 48, 40, '#fff'));
        G.text(P.questions.length + ' ' + (P.questions.length % 10 === 1 && P.questions.length % 100 !== 11 ? 'вопрос' : [2, 3, 4].includes(P.questions.length % 10) && ![12, 13, 14].includes(P.questions.length % 100) ? 'вопроса' : 'вопросов'), G.w / 2, 330, 24, P.accent);
        G.text('Нажми, чтобы начать', G.w / 2, 400, 22, '#fff');
        return;
      }
      if (st === 'over') {
        const pct = list.length ? score / list.length : 0, msg = pct === 1 ? 'Идеально! 🏆' : pct >= .7 ? 'Отлично! 🎉' : pct >= .4 ? 'Неплохо! 👍' : 'Попробуй ещё 🙂';
        G.text(msg, G.w / 2, 210, 42, '#fff');
        G.text(score + ' из ' + list.length, G.w / 2, 290, 56, P.accent);
        G.text('Рекорд: ' + best, G.w / 2, 350, 22, '#fff');
        if (endT > .7) G.text('Нажми — ещё раз', G.w / 2, 430, 22, '#fff');
        return;
      }
      const q = list[i];
      G.text((i + 1) + ' / ' + list.length, 20, 34, 22, '#fff', 'left');
      G.text('✅ ' + score, G.w - 20, 34, 22, '#fff', 'right');
      if (P.timer) { G.rect(20, 60, G.w - 40, 8, 'rgba(255,255,255,.15)', 4); G.rect(20, 60, (G.w - 40) * Math.max(0, tleft / P.timer), 8, tleft < 3 ? '#ff6b6b' : P.accent, 4); }
      const lines = wrap(q.q, G.w - 60, 30), bx = boxes(), qTop = 110, qMid = qTop + (bx[0].y - 20 - qTop) / 2;
      lines.forEach((l, k) => G.text(l, G.w / 2, qMid - (lines.length - 1) * 19 + k * 38, 30, '#fff'));
      bx.forEach((b, k) => {
        let c = 'rgba(255,255,255,.12)';
        if (pick >= 0 && b.a.ok) c = '#22c55e'; else if (pick === k) c = '#ef4444';
        G.rect(b.x, b.y, b.w, b.h, c, 16);
        G.text((k + 1) + '. ' + b.a.t, b.x + 22, b.y + b.h / 2, 22, '#fff', 'left', false);
      });
    });
  }

  // ── 6. Космобой (стрелялка сверху) ──
  function shooter(P, D37) {
    const G = D37.game({ h: 600, minW: 340, maxW: 760 });
    const SY = 530, SS = 64;
    let st = 'start', x, shots, foes, booms, score, lives, fireT, spawn, hurt, endT = 0, lvl;
    let best = +localStorage.getItem('best') || 0;
    const stars = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random() * 600, v: 20 + Math.random() * 80, r: Math.random() * 1.6 + .4 }));
    function reset() { x = G.w / 2; shots = []; foes = []; booms = []; score = 0; lives = P.lives; fireT = 0; spawn = 1; hurt = 0; lvl = 1; }
    reset();
    const overlay = (a, b) => { G.rect(0, 0, G.w, G.h, 'rgba(0,0,0,.4)'); G.text(a, G.w / 2, G.h * .36, 42, '#fff'); if (b) G.text(b, G.w / 2, G.h * .36 + 56, 21, '#fff'); };
    G.loop(dt => {
      for (const s of stars) { s.y += s.v * dt * (st === 'play' ? 1 + lvl * .1 : .5); if (s.y > 600) { s.y = 0; s.x = Math.random(); } }
      if (st === 'start') { if (G.hit()) { st = 'play'; reset(); } return; }
      if (st === 'over') { endT += dt; if (G.hit() && endT > .7) { st = 'play'; reset(); D37.again(); } return; }
      lvl = 1 + Math.floor(score / 150);
      if (G.pointer.down) x += (G.pointer.x - x) * Math.min(1, dt * 16);
      if (G.held('left')) x -= 460 * dt;
      if (G.held('right')) x += 460 * dt;
      x = Math.max(SS / 2, Math.min(G.w - SS / 2, x));
      hurt = Math.max(0, hurt - dt);
      if ((fireT -= dt) <= 0) { shots.push({ x, y: SY - 40 }); fireT = Math.max(.1, .42 - P.fire * .03); D37.sfx('shoot'); }
      if ((spawn -= dt) <= 0) {
        foes.push({ x: 30 + Math.random() * (G.w - 60), y: -40, e: D37.pick(P.enemies), v: 70 + P.speed * 14 + lvl * 12 + Math.random() * 40, ph: Math.random() * 6, hp: Math.random() < .15 + lvl * .02 ? 2 : 1, s: 50 });
        spawn = Math.max(.25, 1.05 - P.speed * .05 - lvl * .06) * (.6 + Math.random() * .8);
      }
      for (const s of shots) s.y -= 720 * dt;
      for (const f of foes) { f.y += f.v * dt; f.x += Math.sin(G.t * 2 + f.ph) * 40 * dt; }
      for (const s of shots) for (const f of foes) {
        if (!s.done && !f.dead && Math.hypot(s.x - f.x, s.y - f.y) < f.s * .5) {
          s.done = true; f.hp--;
          if (f.hp <= 0) { f.dead = true; score += 10; booms.push({ x: f.x, y: f.y, t: .45 }); D37.sfx('boom'); }
        }
      }
      for (const f of foes) {
        if (f.dead) continue;
        const hitShip = Math.hypot(f.x - x, f.y - SY) < (f.s + SS) * .38;
        if (hitShip || f.y > 640) {
          f.dead = true; booms.push({ x: f.x, y: Math.min(f.y, 600), t: .45 });
          if (hurt <= 0) { lives--; hurt = 1; D37.sfx('hit'); }
          if (lives <= 0) {
            st = 'over'; endT = 0;
            if (score > best) { best = score; localStorage.setItem('best', best); }
            D37.sfx('over'); D37.over(score);
            return;
          }
        }
      }
      for (const b of booms) b.t -= dt;
      shots = shots.filter(s => !s.done && s.y > -30);
      foes = foes.filter(f => !f.dead);
      booms = booms.filter(b => b.t > 0);
      D37.score(score);
    }, () => {
      G.bg(P.bg);
      for (const s of stars) G.circle(s.x * G.w, s.y, s.r, 'rgba(255,255,255,.7)');
      for (const s of shots) { G.rect(s.x - 3, s.y - 14, 6, 22, '#fff2a8', 3); G.rect(s.x - 1.5, s.y - 12, 3, 16, '#ffffff', 2); }
      for (const f of foes) G.emoji(f.e, f.x, f.y, f.hp > 1 ? 58 : f.s, Math.sin(G.t * 3 + f.ph) * .15);
      for (const b of booms) { G.ctx.globalAlpha = Math.max(0, b.t / .45); G.circle(b.x, b.y, 40 * (1 - b.t / .45) + 10, '#ffb703'); G.circle(b.x, b.y, 22 * (1 - b.t / .45) + 6, '#fff3b0'); G.ctx.globalAlpha = 1; }
      if (!(hurt > 0 && Math.floor(G.t * 14) % 2)) { G.emoji('🔥', x, SY + 38, 24 + Math.sin(G.t * 30) * 4, Math.PI); G.emoji(P.ship, x, SY, SS); }
      G.text(score, 18, 34, 30, '#fff', 'left');
      G.text('🏆 ' + best, G.w - 18, 34, 20, '#fff', 'right');
      if (st === 'play') G.text('❤️'.repeat(Math.max(0, lives)), G.w / 2, 34, 22, '#fff', 'center', false);
      if (st === 'start') overlay(P.title, 'Веди пальцем или стрелками — стрельба сама');
      if (st === 'over') overlay('Счёт: ' + score, endT > .7 ? 'Нажми — ещё раз' : '');
    });
  }

  const QA_DEF = [
    { q: 'Как зовут стримера этого сайта?', a: ['Денчик37', 'Пятёрка', 'Влад А4'], right: 0 },
    { q: 'Сколько будет 7 × 8?', a: ['54', '56', '64', '48'], right: 1 },
    { q: 'Какой блок в Майнкрафте нельзя сломать в выживании?', a: ['Обсидиан', 'Бедрок', 'Алмаз'], right: 1 },
    { q: 'Столица России?', a: ['Москва', 'Казань', 'Санкт-Петербург'], right: 0 },
  ];
  const T = [
    { id: 'runner', name: 'Раннер', icon: '🏃', desc: 'Беги, прыгай через препятствия и собирай монеты — как динозаврик в браузере.', code: runner, params: [
      { k: 'title', t: 'text', label: 'Надпись на старте', def: 'Беги и прыгай!', max: 40 },
      { k: 'hero', t: 'emoji', label: 'Герой', def: '🏃' },
      { k: 'obstacles', t: 'emojis', label: 'Препятствия', def: ['🌵', '🪨', '🔥'], max: 6 },
      { k: 'coin', t: 'emoji', label: 'Монетка', def: '🪙' },
      { k: 'sky', t: 'color', label: 'Небо', def: '#7dd3fc' },
      { k: 'ground', t: 'color', label: 'Земля', def: '#65a30d' },
      { k: 'speed', t: 'range', label: 'Скорость', def: 5 },
      { k: 'jump', t: 'range', label: 'Сила прыжка', def: 5 },
      { k: 'often', t: 'range', label: 'Как часто препятствия', def: 5 },
      { k: 'double', t: 'bool', label: 'Двойной прыжок', def: true },
      { k: 'lives', t: 'range', label: 'Жизни', def: 1, min: 1, max: 5 },
    ] },
    { id: 'catcher', name: 'Ловилка', icon: '🧺', desc: 'Лови падающие предметы и уворачивайся от опасных. Чем дальше — тем быстрее.', code: catcher, params: [
      { k: 'title', t: 'text', label: 'Надпись на старте', def: 'Лови всё вкусное!', max: 40 },
      { k: 'catcher', t: 'emoji', label: 'Кто ловит', def: '🧺' },
      { k: 'good', t: 'emojis', label: 'Что ловить', def: ['🍎', '🍌', '🍓', '🍇'], max: 8 },
      { k: 'bad', t: 'emojis', label: 'Что нельзя ловить', def: ['💣'], max: 4, min: 0 },
      { k: 'bonus', t: 'emoji', label: 'Бонус (+5)', def: '⭐' },
      { k: 'bg', t: 'color', label: 'Фон', def: '#1e3a8a' },
      { k: 'speed', t: 'range', label: 'Скорость', def: 5 },
      { k: 'lives', t: 'range', label: 'Жизни', def: 3, min: 1, max: 5 },
    ] },
    { id: 'flappy', name: 'Летун', icon: '🐤', desc: 'Нажимай, чтобы взлететь, и пролетай между столбами. Как Flappy Bird.', code: flappy, params: [
      { k: 'title', t: 'text', label: 'Надпись на старте', def: 'Лети между столбами!', max: 40 },
      { k: 'hero', t: 'emoji', label: 'Кто летит', def: '🐤' },
      { k: 'pipe', t: 'color', label: 'Столбы', def: '#22c55e' },
      { k: 'bg', t: 'color', label: 'Небо', def: '#38bdf8' },
      { k: 'gap', t: 'range', label: 'Ширина прохода', def: 5 },
      { k: 'speed', t: 'range', label: 'Скорость', def: 5 },
    ] },
    { id: 'whack', name: 'Тапалка', icon: '🐹', desc: 'Жми на тех, кто выглядывает из норок, но не трогай бомбы. Игра на время.', code: whack, params: [
      { k: 'title', t: 'text', label: 'Надпись на старте', def: 'Поймай хомяков!', max: 40 },
      { k: 'good', t: 'emojis', label: 'На кого жать', def: ['🐹', '🐭'], max: 6 },
      { k: 'bad', t: 'emojis', label: 'Кого не трогать', def: ['💣'], max: 4, min: 0 },
      { k: 'bg', t: 'color', label: 'Фон', def: '#166534' },
      { k: 'hole', t: 'color', label: 'Норки', def: '#3f2a14' },
      { k: 'grid', t: 'range', label: 'Норок в ряд', def: 3, min: 2, max: 4 },
      { k: 'time', t: 'range', label: 'Время (сек)', def: 30, min: 10, max: 90, step: 5 },
      { k: 'speed', t: 'range', label: 'Скорость', def: 5 },
    ] },
    { id: 'quiz', name: 'Викторина', icon: '❓', desc: 'Свои вопросы и ответы: про игры, про друзей, про стрим. Друзья проверят, кто знает больше.', code: quiz, params: [
      { k: 'title', t: 'text', label: 'Название викторины', def: 'Что ты знаешь о Денчике?', max: 60 },
      { k: 'questions', t: 'qa', label: 'Вопросы', def: QA_DEF },
      { k: 'bg', t: 'color', label: 'Фон', def: '#312e81' },
      { k: 'accent', t: 'color', label: 'Акцент', def: '#a78bfa' },
      { k: 'timer', t: 'range', label: 'Секунд на ответ (0 — без таймера)', def: 0, min: 0, max: 30, step: 5 },
      { k: 'shuffle', t: 'bool', label: 'Перемешивать вопросы и ответы', def: true },
    ] },
    { id: 'shooter', name: 'Космобой', icon: '🚀', desc: 'Корабль стреляет сам — уводи его от врагов и сбивай всех. Чем дальше, тем жарче.', code: shooter, params: [
      { k: 'title', t: 'text', label: 'Надпись на старте', def: 'Защити галактику!', max: 40 },
      { k: 'ship', t: 'emoji', label: 'Корабль', def: '🚀' },
      { k: 'enemies', t: 'emojis', label: 'Враги', def: ['👾', '🛸', '☄️'], max: 6 },
      { k: 'bg', t: 'color', label: 'Космос', def: '#0b1026' },
      { k: 'speed', t: 'range', label: 'Скорость врагов', def: 5 },
      { k: 'fire', t: 'range', label: 'Скорострельность', def: 5 },
      { k: 'lives', t: 'range', label: 'Жизни', def: 3, min: 1, max: 5 },
    ] },
  ];

  // Проверка параметров (и в редакторе, и перед запуском чужой игры)
  const EMOJI_RE = /^[^\s<>"'`]{1,12}$/;
  function cleanEmoji(v, def){ const s = String(v ?? '').trim(); return EMOJI_RE.test(s) ? s : def; }
  function clean(tpl, P){
    const out = {};
    const src = P && typeof P === 'object' ? P : {};
    for (const p of tpl.params) {
      const v = src[p.k];
      if (p.t === 'text') out[p.k] = String(v ?? p.def).replace(/\s+/g, ' ').trim().slice(0, p.max || 40) || p.def;
      else if (p.t === 'emoji') out[p.k] = cleanEmoji(v, p.def);
      else if (p.t === 'emojis') {
        const arr = (Array.isArray(v) ? v : p.def).map(x => cleanEmoji(x, '')).filter(Boolean).slice(0, p.max || 6);
        out[p.k] = arr.length || p.min === 0 ? arr : p.def.slice();
      } else if (p.t === 'color') out[p.k] = /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : p.def;
      else if (p.t === 'range') { const mn = p.min ?? 1, mx = p.max ?? 10, st = p.step || 1, n = Math.round((+v || +p.def) / st) * st; out[p.k] = Math.max(mn, Math.min(mx, Number.isFinite(n) ? n : p.def)); }
      else if (p.t === 'bool') out[p.k] = v === undefined ? !!p.def : !!v;
      else if (p.t === 'qa') {
        const list = (Array.isArray(v) ? v : p.def).slice(0, 30).map(q => {
          const a = (Array.isArray(q?.a) ? q.a : []).map(x => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean).slice(0, 4);
          return { q: String(q?.q ?? '').replace(/\s+/g, ' ').trim().slice(0, 140), a, right: Math.max(0, Math.min(a.length - 1, +q?.right || 0)) };
        }).filter(q => q.q && q.a.length >= 2);
        out[p.k] = list.length ? list : p.def;
      }
    }
    return out;
  }
  function defaults(tpl){ const P = {}; for (const p of tpl.params) P[p.k] = Array.isArray(p.def) ? JSON.parse(JSON.stringify(p.def)) : p.def; return P; }

  window.STUDIO_TPL = { list: T, get: id => T.find(t => t.id === id) || null, clean, defaults };
})();
