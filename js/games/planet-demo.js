// ═══════════════════════════════════════
//  ПЛАНЕТА — скрытая страница проверки (/play/planet, #/games/planet): полёт с орбиты до земли без экранов загрузки,
//  посадка и ходьба своим персонажем по «плоскому куску» (обычный player.js), день и ночь от вращения планеты.
//  Движок — js/engine/planet.js + planet-view.js (T-051, docs/plans/planet.md). Нет в каталоге, поиске и рекордах.
//  Небесная механика (T-079, docs/plans/planet-space.md PS-1): время — часы мира (js/engine/clock.js: у всех одно, по серверу),
//  Луна и Песчаная летят по орбитам Кеплера (orbit.js, system.js) и видны в небе с фазами (space-view.js); «🪐 Система» (M) — карта.
// ═══════════════════════════════════════
// Управление: полёт — W/S вперёд/назад, A/D вбок, Пробел/C вверх/вниз, Shift — быстрее, мышь (тянуть) — смотреть;
// L — сесть / взлететь; T — время быстрее (своё: смещение от времени мира); M — карта системы. Телефон: джойстик слева, палец —
// смотреть, кнопки справа.
// Проверки: GAME_IMPL.planet._test — state(), stats(), goto(шир, долг, высота), land(), fly(), descend(сек), sky(), map(), look(id)…
(() => {
  const CSS = `
.pl-wrap{position:relative;height:min(78vh,760px);min-height:340px;border-radius:14px;overflow:hidden;background:#000;touch-action:none;user-select:none;-webkit-user-select:none}
body.game-on .pl-wrap{height:calc(100dvh - 210px);min-height:300px}
.pl-hud{position:absolute;left:10px;top:10px;z-index:5;max-width:min(92%,520px);padding:6px 10px;border-radius:12px;background:rgba(6,8,20,.6);color:#e2e8f0;font:700 12px/1.45 Montserrat,system-ui,sans-serif;pointer-events:none;white-space:pre-wrap}
.pl-hud b{color:#fff}
.pl-st{display:block;margin-top:2px;font:600 11px/1.4 ui-monospace,Consolas,monospace;color:#a5b4fc}
.pl-bar{position:absolute;right:10px;top:10px;z-index:6;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;max-width:60%}
.pl-bar button{border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:.38rem .7rem;background:rgba(10,8,24,.66);color:#fff;font:800 .78rem Montserrat,sans-serif;cursor:pointer;min-height:36px}
.pl-bar button.on{background:var(--accent,#9b6dff);border-color:transparent}
.pl-msg{position:absolute;inset:0;display:grid;place-items:center;color:#cbd5e1;font:800 15px Montserrat,sans-serif;text-align:center;padding:20px;z-index:3}
.pl-help{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:5;max-width:92%;padding:8px 12px;border-radius:12px;background:rgba(6,8,20,.72);color:#e2e8f0;font:700 12px/1.5 Montserrat,sans-serif;text-align:center}
.pl-help[hidden]{display:none}
.pl-tele{position:absolute;left:50%;bottom:64px;transform:translateX(-50%);z-index:6;border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:.34rem .8rem;background:rgba(10,8,24,.72);color:#fff;font:800 .76rem Montserrat,sans-serif;cursor:pointer;min-height:36px}
.pl-tele[hidden]{display:none}
@media (max-width:640px){.pl-bar{left:10px;right:10px;max-width:none;justify-content:flex-start}.pl-bar button{padding:.3rem .55rem;font-size:.72rem}.pl-tele{bottom:150px}.pl-lbl{display:none}
.pl-hud{top:58px;max-width:calc(100% - 20px);font-size:11px;padding:5px 8px}.pl-st{font-size:10px}}`;
  const css = () => { if (document.getElementById('pl-css')) return; const s = document.createElement('style'); s.id = 'pl-css'; s.textContent = CSS; document.head.appendChild(s); };
  const DEG = Math.PI / 180, U = 2.1 / 1.8, HOME_LL = [29, 81];
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  let S = null;

  function mount(el){
    css();
    const wrap = document.createElement('div'); wrap.className = 'wld-wrap pl-wrap';
    const msg = document.createElement('div'); msg.className = 'pl-msg'; msg.textContent = '🪐 Загружаем планету…';
    wrap.appendChild(msg); el.appendChild(wrap);
    const st = S = { el, wrap, msg, dead: false };
    window.D37E.load().then(ok => {
      if (S !== st) return;
      if (!ok || !window.D37E.supported?.()) { msg.textContent = 'Нужен браузер с WebGL (3D) — открой в Chrome или на компьютере'; return; }
      try { start(st); } catch (e) { console.error(e); msg.textContent = 'Ошибка запуска планеты'; }
    });
  }

  function start(st){
    const E = window.D37E, PL = E.planet, wrap = st.wrap;
    const R = st.R = E.renderer(wrap);
    R.r.domElement.classList.add('pl-gl');
    const P = st.P = PL.create(PL.HOME);
    // старт — берег с горами (у этого зерна на 43° с. ш. 77° в. д. — море: там потом встанет «Мир Денчика», §10.1 плана)
    const home = P.dirFromLatLon(HOME_LL[0], HOME_LL[1]);
    const V = st.V = E.planetView(R, P, { dir: home });
    st.msg.remove();
    // время — часы мира (у всех одно); сутки планеты — 40 мин. Ночь над стартом — своё время: сдвиг до 9 утра (не больше суток)
    const CL = st.CL = E.clock;
    st.offClock = CL.start();
    st.timeK = 1;
    const tw0 = CL.t(), hr0 = P.localHour(home, tw0);
    st.off = hr0 >= 7 && hr0 <= 16 ? 0 : ((9 - hr0 + 24) % 24) / 24 * P.def.day;
    st.t = tw0 + st.off;
    // небо системы: Луна и Песчаная по орбитам Кеплера (сломалось — планета живёт без них)
    try {
      st.S = E.system.create(E.system.HOME);
      st.SV = E.spaceView(R, V, st.S, { observer: P.def.id });
      st.map = E.spaceMap(wrap, st.S, { observer: P.def.id, time: () => st.t, clock: CL, onLook: id => lookAt(st, id), where: () => whereOnPlanet(st) });
    } catch (e) { console.warn('планета: небо системы не запустилось', e); st.SV = null; }
    // управление
    const C = st.C = E.controls({});
    const I = st.I = E.input(wrap, { controls: C, ignore: 'button, .pl-bar, .e-btn, .sm, .pl-tele' });
    const H = st.H = E.ui(wrap, C);
    // полёт: место и скорость — в системе планеты (double), взгляд — рысканье/тангаж от местного горизонта
    const r0 = P.SEAR + 300000;
    st.fly = { pos: new Float64Array([home[0] * r0, home[1] * r0, home[2] * r0]), vel: new Float64Array(3), yaw: 0, pitch: -1.25, auto: null };
    st.mode = 'fly';
    st.B9 = new Array(9);
    // ходьба: физика плоского куска, свой персонаж
    const ph = st.ph = new E.Phys({ ground: 0 });
    V.physics(ph);
    st.offRebase = V.onRebase(ev => onRebase(st, ev));
    // HUD и кнопки
    const hud = document.createElement('div'); hud.className = 'pl-hud';
    const h1 = document.createElement('div'), h2 = document.createElement('span'); h2.className = 'pl-st';
    hud.appendChild(h1); hud.appendChild(h2); wrap.appendChild(hud);
    st.h1 = h1; st.h2 = h2;
    const bar = document.createElement('div'); bar.className = 'pl-bar'; wrap.appendChild(bar);
    const btn = (txt, title, f) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = title; b.addEventListener('click', e => { e.stopPropagation(); f(b); }); bar.appendChild(b); return b; };
    st.bLand = btn('🛬 Сесть', 'Сесть на землю под собой / взлететь (L)', () => toggleLand(st));
    btn('🛰 Орбита', 'Подняться на орбиту', () => goOrbit(st));
    btn('⬇ Вниз', 'Сам спустится к земле', () => descend(st, 40));
    st.bTime = btn('⏩ ×1', 'Время быстрее (T)', () => cycleTime(st));
    if (st.map) { const b = btn('🪐', 'Карта системы: орбиты, фазы Луны, затмения (M)', () => st.map.toggle()), s = document.createElement('span'); s.className = 'pl-lbl'; s.textContent = ' Система'; b.appendChild(s); }
    const tele = st.tele = document.createElement('button'); tele.type = 'button'; tele.className = 'pl-tele'; tele.hidden = true;
    tele.addEventListener('click', e => { e.stopPropagation(); untele(st); });
    wrap.appendChild(tele);
    btn('❓', 'Как управлять', () => { st.help.hidden = !st.help.hidden; });
    const help = st.help = document.createElement('div'); help.className = 'pl-help';
    help.textContent = I.touch ? 'Полёт: джойстик — лететь, палец — смотреть, ⬆ ⬇ — вверх и вниз, 🚀 — быстрее. «🛬 Сесть» — идти пешком.'
      : 'Полёт: W/S — вперёд/назад, A/D — вбок, Пробел/C — вверх/вниз, Shift — быстрее, мышь (тянуть) — смотреть. L — сесть/взлететь, T — время быстрее, M — карта системы.';
    wrap.appendChild(help);
    st.helpT = setTimeout(() => { if (S === st) help.hidden = true; }, 9000);   // снимается в unmount: иначе 9 с держит весь прошлый мир (замыкание видит R)
    touchButtons(st);
    st.ro = window.ResizeObserver ? new ResizeObserver(() => { if (!R.dead) R.resize(); }) : null;
    st.ro?.observe(wrap);
    R.resize();
    st.loop = E.loop(dt => step(st, dt), dt => frame(st, dt));
    st.keyT = e => {
      if (e.repeat || e.target?.closest?.('input, textarea')) return;
      if (st.map?.isOpen) return;
      if (e.code === 'KeyT') cycleTime(st);
      if (e.code === 'KeyL') toggleLand(st);
    };
    window.addEventListener('keydown', st.keyT);
  }
  function touchButtons(st){
    if (!st.I.touch) return;
    if (st.mode === 'fly') st.H.buttons([{ action: 'crouch', icon: '⬇', label: 'вниз' }, { action: 'run', icon: '🚀', label: 'быстрее' }, { action: 'jump', icon: '⬆', label: 'вверх', big: true }]);
    else st.H.buttons([{ action: 'crouch', icon: '⬇', label: 'присесть' }, { action: 'jump', icon: '⤒', label: 'прыжок', big: true }]);
  }

  // ═══ Шаг логики (1/60 с): полёт или ходьба; переезд якоря — только здесь (одинаково на телефоне и ПК) ═══
  const TMP = [0, 0, 0], TMP2 = [0, 0, 0], FL = [0, 0, 0], RL = [0, 0, 0];
  // местные оси (восток, вверх, юг; базис B) → система планеты, без мусора
  const locToBF = (B, v, o) => { o[0] = B[0] * v[0] + B[3] * v[1] + B[6] * v[2]; o[1] = B[1] * v[0] + B[4] * v[1] + B[7] * v[2]; o[2] = B[2] * v[0] + B[5] * v[1] + B[8] * v[2]; return o; };
  function step(st, dt){
    if (st.dead) return;
    const { C, P, V } = st;
    C.blocked = !!window.D37Settings?.isOpen?.();
    C.step(dt);
    st.off += dt * (st.timeK - 1);   // ускорение — своё смещение от часов мира (шагами по 1/60 с: одинаково на любом экране)
    if (st.map && C.down('map')) st.map.toggle();   // M или Back на геймпаде (действие «Карта» controls.js)
    if (st.map?.isOpen) return;   // карта закрывает вид — никуда не летим и не идём
    if (st.mode === 'fly') flyStep(st, dt);
    else {
      const Pl = st.Pl;
      Pl.update(dt, C, st.rig);
      // вышел в другую область — якорь туда (координаты области общие у всех — для сети)
      const ch = Pl.ch;
      if (Math.abs(ch.x) > 200 || Math.abs(ch.z) > 200) {
        P.toBF(V.fr, ch.x, 0, ch.z, TMP);
        const l = Math.hypot(TMP[0], TMP[1], TMP[2]); TMP[0] /= l; TMP[1] /= l; TMP[2] /= l;
        const rg = P.region(TMP);
        if (rg.key !== st.anchorKey) { st.anchorKey = rg.key; V.setAnchor(rg.dir); }
      }
    }
  }
  function altGround(st, X){   // высота над землёй (поверхность как нарисована) в точке системы планеты
    const P = st.P, l = Math.hypot(X[0], X[1], X[2]);
    const h = Math.max(P.renderMin, P.height(X[0] / l, X[1] / l, X[2] / l));
    return l - P.R - h;
  }
  function flyStep(st, dt){
    const { C, I, P } = st, F = st.fly, B = P.basis(F.pos, st.B9);
    // взгляд (мышь/палец/стик): рысканье и тангаж от местного горизонта
    if (!F.auto) {
      const dx = I.look.dx + C.look.dx, dy = I.look.dy + C.look.dy;
      if (st.track && (dx || dy)) st.track = null;   // смотрит сам — телескоп больше не следит
      F.yaw -= dx * .0042; F.pitch = clamp(F.pitch - dy * .0042, -1.55, 1.55);
      if (st.track) aim(st, st.track);
    }
    const altG = Math.max(.5, altGround(st, F.pos));
    // вперёд / вправо / вверх в системе планеты
    const cy = Math.cos(F.yaw), sy = Math.sin(F.yaw), cp = Math.cos(F.pitch), sp = Math.sin(F.pitch);
    FL[0] = -sy * cp; FL[1] = sp; FL[2] = -cy * cp; RL[0] = cy; RL[1] = 0; RL[2] = -sy;
    locToBF(B, FL, TMP); locToBF(B, RL, TMP2);
    let mz = C.move.z, mx = C.move.x, my = (C.held('jump') ? 1 : 0) - (C.held('crouch') ? 1 : 0);
    let speed = clamp(altG * .9, 14, 90000) * (C.held('run') ? 6 : 1);
    if (F.auto) {   // сам спускается к земле: к точке под собой, высота падает в e раз за ~6 с
      const a = F.auto; a.left -= dt;
      mz = 0; mx = 0; my = -1; speed = clamp(altG * .32, 8, 120000);
      F.pitch += (-.35 - F.pitch) * Math.min(1, dt * .6);
      if (a.left <= 0 || altG < 40) { F.auto = null; my = 0; }
    }
    const tx = (TMP[0] * mz + TMP2[0] * mx + B[3] * my) * speed, ty = (TMP[1] * mz + TMP2[1] * mx + B[4] * my) * speed, tz = (TMP[2] * mz + TMP2[2] * mx + B[5] * my) * speed;
    const k = 1 - Math.exp(-3 * dt);
    F.vel[0] += (tx - F.vel[0]) * k; F.vel[1] += (ty - F.vel[1]) * k; F.vel[2] += (tz - F.vel[2]) * k;
    F.pos[0] += F.vel[0] * dt; F.pos[1] += F.vel[1] * dt; F.pos[2] += F.vel[2] * dt;
    // не под землю: не ниже 2 ед. над поверхностью
    const ag = altGround(st, F.pos);
    if (ag < 2) { const l = Math.hypot(F.pos[0], F.pos[1], F.pos[2]), s = (l + 2 - ag) / l; F.pos[0] *= s; F.pos[1] *= s; F.pos[2] *= s; }
    // якорь: высоко — под камерой (переезд, когда ушла вбок на четверть высоты), низко — область (общие координаты)
    const V = st.V, fr = V.fr;
    P.toL(fr, F.pos[0], F.pos[1], F.pos[2], TMP);
    const off = Math.hypot(TMP[0], TMP[2]), altS = Math.hypot(F.pos[0], F.pos[1], F.pos[2]) - P.SEAR;
    if (altS > 1500) { if (off > Math.max(384, altS * .25)) { st.anchorKey = 0; V.setAnchor([F.pos[0], F.pos[1], F.pos[2]]); } }
    else {
      const rg = P.region(F.pos);
      if (rg.key !== st.anchorKey && off > 120) { st.anchorKey = rg.key; V.setAnchor(rg.dir); }
    }
    st.flyAlt = ag;
  }
  // переезд якоря: игрок, скорость, взгляд, камера — в новые координаты (тот же шаг)
  function onRebase(st, ev){
    if (st.mode !== 'walk' || !st.Pl) return;
    const ch = st.Pl.ch, p = ev.point(ch.x, ch.y, ch.z), v = ev.dir(ch.vx || 0, ch.vy || 0, ch.vz || 0);
    ch.x = p[0]; ch.y = p[1]; ch.z = p[2]; ch.vx = v[0]; ch.vy = v[1]; ch.vz = v[2];
    const f = ev.dir(Math.sin(st.Pl.yaw), 0, Math.cos(st.Pl.yaw)); st.Pl.yaw = Math.atan2(f[0], f[2]);
    const rig = st.rig;
    if (rig) {
      const g = ev.dir(-Math.sin(rig.yaw), 0, -Math.cos(rig.yaw)); rig.yaw = Math.atan2(-g[0], -g[2]);
      const tp = ev.point(rig.tx, rig.ty, rig.tz); rig.tx = tp[0]; rig.ty = tp[1]; rig.tz = tp[2];
      const cp = ev.point(st.R.camera.position.x, st.R.camera.position.y, st.R.camera.position.z); st.R.camera.position.set(cp[0], cp[1], cp[2]);
    }
  }

  // ═══ Кадр: камера, человечек, вид планеты, HUD ═══
  const LA = new Float64Array(3);
  function frame(st, dt){
    if (st.dead) return;
    const { R, V, P, I, C } = st, cam = R.camera;
    st.t = st.CL.t() + st.off;   // секунды мира (+ своё ускорение)
    // карта системы закрывает вид — 3D не рисуем (батарея); логика идёт
    if (st.map?.isOpen) { I.frameEnd(); C.frameEnd(); hud(st); return; }
    if (st.mode === 'fly') {
      const F = st.fly, B = P.basis(F.pos, st.B9), fr = V.fr;
      P.toL(fr, F.pos[0], F.pos[1], F.pos[2], LA);
      cam.position.set(LA[0], LA[1], LA[2]);
      const cy = Math.cos(F.yaw), sy = Math.sin(F.yaw), cp = Math.cos(F.pitch), sp = Math.sin(F.pitch);
      // взгляд и «верх» камеры: местные оси → система планеты → оси куска
      const fx = -sy * cp, fy = sp, fz = -cy * cp;
      const X = B[0] * fx + B[3] * fy + B[6] * fz, Y = B[1] * fx + B[4] * fy + B[7] * fz, Z = B[2] * fx + B[5] * fy + B[8] * fz;
      P.dirToL(fr, X, Y, Z, TMP); P.dirToL(fr, B[3], B[4], B[5], TMP2);
      cam.up.set(TMP2[0], TMP2[1], TMP2[2]);
      cam.lookAt(LA[0] + TMP[0], LA[1] + TMP[1], LA[2] + TMP[2]);
      V.blob(0, 0, 0, 0);
    } else {
      const Pl = st.Pl, A = st.A, rig = st.rig;
      const me = A.get('me'); if (me) A.pose('me', Pl.pose());
      const look = { dx: I.look.dx + C.look.dx, dy: I.look.dy + C.look.dy, zoom: I.zoom };
      cam.up.set(0, 1, 0);
      rig.update(dt, Pl, look, st.ph, C);
      R.follow(Pl.ch.x, Pl.ch.z, Pl.ch.y);
      V.blob(Pl.ch.x, Pl.ch.y, Pl.ch.z, 1.1);
      H_stamina(st);
    }
    st.A?.update(dt, performance.now() / 1000, cam.position);   // в полёте человечек спрятан (hidden) — и это тоже через update
    I.frameEnd(); C.frameEnd();
    const ms = st.CL.msOf(st.t);
    if (st.SV) { try { st.SV.update(st.t, ms); } catch (e) { console.warn('планета: небо системы', e); st.SV.dispose(); st.SV = null; } }
    V.update(dt, st.t, ms);
    R.update(dt);
    R.render();
    hud(st);
  }
  function H_stamina(st){ st.H.stamina(st.Pl.stamina / st.Pl.maxStamina, st.Pl.exhausted); }
  const fmtMin = s => { s = Math.abs(s); return s < 5400 ? Math.round(s / 60) + ' мин' : s < 172800 ? (s / 3600).toFixed(1) + ' ч' : (s / 86400).toFixed(1) + ' сут'; };
  let hudAt = 0;
  function hud(st){
    const tn = performance.now(); if (tn - hudAt < 250) return; hudAt = tn;
    const { P, V, R } = st, cam = R.camera;
    const X = V.toBF(cam.position.x, cam.position.y, cam.position.z), l = Math.hypot(X[0], X[1], X[2]), d = [X[0] / l, X[1] / l, X[2] / l];
    const ll = P.latLon(d), hr = P.localHour(d, st.t), hh = Math.floor(hr), mm = Math.floor((hr - hh) * 60);
    const alt = (l - P.SEAR) / U, spd = st.mode === 'fly' ? Math.hypot(...st.fly.vel) / U : (st.Pl ? st.Pl.speed / U : 0);
    const altS = alt > 9999 ? (alt / 1000).toFixed(alt > 99999 ? 0 : 1) + ' км' : Math.round(alt) + ' м';
    const spdS = spd > 2000 ? (spd / 1000).toFixed(1) + ' км/с' : Math.round(spd) + ' м/с';
    const lat = Math.abs(ll[0]).toFixed(1) + '° ' + (ll[0] >= 0 ? 'с' : 'ю') + '. ш.', lon = Math.abs(ll[1]).toFixed(1) + '° ' + (ll[1] >= 0 ? 'в' : 'з') + '. д.';
    const mo = st.SV?.moon, pc = mo && mo.id ? Math.round(mo.lit * 100) : -1;
    const moonS = pc < 0 ? '' : ` · 🌙 ${pc < 3 ? 'новолуние' : pc > 97 ? 'полнолуние' : pc + ' %' + (mo.wax ? ' ↑' : ' ↓')}`;
    const sk = V.sunK < .98 ? ` · ☀🌑 затмение ${Math.round((1 - V.sunK) * 100)} %` : '';
    const own = Math.abs(st.off) > 1 ? `⏩ своё время ${st.off > 0 ? '+' : '−'}${fmtMin(st.off)}` : '🌍 время мира';
    st.h1.textContent = `🪐 ${st.mode === 'fly' ? '✈ полёт' : '🚶 пешком'} · высота ${altS} · ${spdS}\n${lat}, ${lon} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} местного${moonS}${sk}\n${own}`;
    const s = V.stats(), rs = R.stats;
    const fps = rs.frames ? 1000 / (rs.sumDt / rs.frames) : 0, cpu = rs.frames ? rs.sumCpu / rs.frames : 0;
    st.h2.textContent = `кусков ${s.shown} · кэш ${s.cached} · в очереди ${s.queued + s.building} · вызовов ${rs.calls} · FPS ${fps.toFixed(0)} · ЦП ${cpu.toFixed(1)} мс`;
    rs.frames = 0; rs.sumDt = 0; rs.sumCpu = 0; rs.maxDt = 0; rs.maxCpu = 0; rs.sumR = 0;
    if (st.tele && !st.tele.hidden && st.teleId) st.tele.textContent = `🔭 ${st.teleName} ×${Math.round(50 / cam.fov)}${st.track ? ' · слежу' : ''} — вернуть`;
    st.bLand.textContent = st.mode === 'fly' ? '🛬 Сесть' : '✈ Взлететь';
    st.bLand.disabled = st.mode === 'fly' && st.flyAlt > 120;
  }

  // ═══ Режимы ═══
  function toggleLand(st){ if (st.mode === 'fly') land(st); else fly(st); }
  function land(st){
    if (st.mode !== 'fly') return;
    const { P, V, R } = st, F = st.fly;
    if (altGround(st, F.pos) > 120) { st.H.toast('Слишком высоко — спустись ниже 100 м', false); return; }
    untele(st);
    // якорь — область под собой (координаты области — общие)
    const rg = P.region(F.pos); st.anchorKey = rg.key; V.setAnchor(rg.dir);
    P.toL(V.fr, F.pos[0], F.pos[1], F.pos[2], LA);
    const E = window.D37E, ph = st.ph;
    const Pl = st.Pl = E.player(ph, { x: LA[0], z: LA[2], yaw: F.yaw + Math.PI });
    const gy = ph.supportAt(LA[0], LA[2], Pl.ch.r * .5, 1e6).y, wy = ph.waterLevel(LA[0], LA[2]);   // над водой — на воду (плыть)
    Pl.place(LA[0], Math.max(gy, wy > -Infinity ? wy - .6 : gy), LA[2], F.yaw + Math.PI);
    if (!st.A) { st.A = E.actors(R); }
    const look = Object.assign({}, window.D37Char?.look?.() || {});
    const me = st.A.get('me');   // человечек один на всю игру: в полёте спрятан (не собирать заново при каждой посадке)
    if (me) me.hidden = false; else st.A.add('me', look, { x: Pl.ch.x, y: Pl.ch.y, z: Pl.ch.z, yaw: Pl.yaw });
    if (!st.rig) st.rig = E.cameraRig(R.camera, { yaw: F.yaw, pitch: .35, dist: 8, minD: 2.6, maxD: 22 });
    st.rig.yaw = F.yaw; st.rig.snap(Pl.ch.x, Pl.ch.y, Pl.ch.z);
    st.unfollow?.(); st.unfollow = st.rig.follow(Pl);   // приземления нового игрока — камере
    st.mode = 'walk'; F.vel.fill(0);
    touchButtons(st);
    st.H.toast('🚶 На земле. L или «✈ Взлететь» — снова в полёт', true);
  }
  function fly(st){
    if (st.mode === 'fly') return;
    const { P, V, R } = st, cam = R.camera, F = st.fly;
    P.toBF(V.fr, cam.position.x, cam.position.y + 3, cam.position.z, F.pos);
    F.vel.fill(0); F.yaw = st.rig ? st.rig.yaw : F.yaw; F.pitch = -.15;
    st.mode = 'fly';
    const me = st.A?.get('me'); if (me) me.hidden = true;
    touchButtons(st);
  }
  function goOrbit(st){
    if (st.mode !== 'fly') fly(st);
    const F = st.fly, l = Math.hypot(F.pos[0], F.pos[1], F.pos[2]), r = st.P.SEAR + 300000;
    F.pos[0] *= r / l; F.pos[1] *= r / l; F.pos[2] *= r / l; F.vel.fill(0); F.pitch = -1.25; F.auto = null;
  }
  function descend(st, sec){ if (st.mode !== 'fly') return; st.fly.auto = { left: sec }; }
  function cycleTime(st){ const L = [1, 30, 300]; st.timeK = L[(L.indexOf(st.timeK) + 1) % L.length]; st.bTime.textContent = '⏩ ×' + st.timeK; st.bTime.classList.toggle('on', st.timeK > 1); }

  // ═══ Небо системы: «👁 Посмотреть» (телескоп), слежение, «ты здесь» на карте ═══
  // запись неба по id (без замыканий: зовётся каждый шаг, пока телескоп следит)
  function skyEntry(st, id){ const L = st.SV ? st.SV.list : null; if (L) for (let k = 0; k < L.length; k++) if (L[k].b.id === id) return L[k]; return null; }
  // направление на тело (BF) → рысканье и тангаж от местного горизонта в точке полёта
  function aim(st, id){
    const e = skyEntry(st, id); if (!e) return false;
    const P = st.P, F = st.fly, B = P.basis(F.pos, st.B9), d = e.d;
    const le = d[0] * B[0] + d[1] * B[1] + d[2] * B[2], lu = d[0] * B[3] + d[1] * B[4] + d[2] * B[5], ls = d[0] * B[6] + d[1] * B[7] + d[2] * B[8];
    F.pitch = clamp(Math.asin(clamp(lu, -1, 1)), -1.55, 1.55); F.yaw = Math.atan2(-le, -ls);
    return true;
  }
  function lookAt(st, id){
    if (!st.SV) return;
    if (st.mode !== 'fly') fly(st);
    st.fly.auto = null;
    const e = skyEntry(st, id);
    if (!e || !aim(st, id)) return;
    // телескоп: тело — на треть кадра (точка — увеличение ×25); следим, пока не повернёшь камеру сам
    const cam = st.R.camera, deg = e.rad * 360 / Math.PI;
    if (st.fov0 == null) st.fov0 = cam.fov;
    cam.fov = deg < .4 ? 2 : clamp(deg / .33, 1.6, 50); cam.updateProjectionMatrix();
    st.track = id; st.teleId = id; st.teleName = e.b.title; st.tele.hidden = false;
    // за планетой ли (луч к телу упирается в шар моря)
    const c = st.fly.pos, d = e.d, b = c[0] * d[0] + c[1] * d[1] + c[2] * d[2], q = b * b - (c[0] * c[0] + c[1] * c[1] + c[2] * c[2] - st.P.SEAR * st.P.SEAR);
    if (q > 0 && -b - Math.sqrt(q) > 0) st.H.toast(`${e.b.title} сейчас за планетой (под горизонтом) — поднимись выше или подожди`, false);
  }
  function untele(st){
    if (st.fov0 != null) { st.R.camera.fov = st.fov0; st.R.camera.updateProjectionMatrix(); st.fov0 = null; }
    st.track = null; st.teleId = null; if (st.tele) st.tele.hidden = true;
  }
  // где камера на планете — направление от центра в осях системы (для «ты здесь» на карте)
  const WH = new Float64Array(3), WB = new Float64Array(3);
  function whereOnPlanet(st){
    if (!st.SV) return null;
    const M = st.SV.F.M, c = st.V.camBF, l = Math.hypot(c[0], c[1], c[2]) || 1;
    WB[0] = c[0] / l; WB[1] = c[1] / l; WB[2] = c[2] / l;
    // M — «система → BF» (поворот): обратно — транспонированная
    WH[0] = M[0] * WB[0] + M[3] * WB[1] + M[6] * WB[2]; WH[1] = M[1] * WB[0] + M[4] * WB[1] + M[7] * WB[2]; WH[2] = M[2] * WB[0] + M[5] * WB[1] + M[8] * WB[2];
    return WH;
  }

  function unmount(){
    const st = S; S = null;
    if (!st) return;
    st.dead = true;
    clearTimeout(st.helpT);
    try { st.loop?.stop(); } catch (e) {}
    window.removeEventListener('keydown', st.keyT);
    try { st.ro?.disconnect(); } catch (e) {}
    try { st.unfollow?.(); st.offRebase?.(); } catch (e) {}
    try { st.map?.dispose(); st.SV?.dispose(); } catch (e) { console.error(e); }
    try { st.offClock?.(); } catch (e) {}
    try { st.V?.dispose(); } catch (e) { console.error(e); }
    try { st.A?.dispose(); } catch (e) {}
    try { st.H?.dispose(); st.I?.dispose(); st.C?.dispose?.(); } catch (e) {}
    try { st.R?.dispose(); } catch (e) { console.error(e); }
    st.wrap?.remove();
  }

  // ═══ Для проверок (scripts/planet-perf.cjs) ═══
  const _test = {
    state: () => S && { mode: S.mode, t: S.t, alt: S.V?.alt, altG: S.V?.altG, fly: S.fly && { pos: [...S.fly.pos], yaw: S.fly.yaw, pitch: S.fly.pitch, auto: !!S.fly.auto }, anchor: S.anchorKey,
      player: S.Pl && { x: S.Pl.ch.x, y: S.Pl.ch.y, z: S.Pl.ch.z, grounded: S.Pl.ch.grounded, swim: S.Pl.swim } },
    stats: () => S?.V?.stats(),
    goto: (lat, lon, alt) => { if (!S) return; if (S.mode !== 'fly') fly(S); const d = S.P.dirFromLatLon(lat, lon), r = S.P.SEAR + Math.max(alt, altGround(S, d.map(x => x * S.P.SEAR)) + 3); S.fly.pos.set([d[0] * r, d[1] * r, d[2] * r]); S.fly.vel.fill(0); S.fly.auto = null; },
    look: (yaw, pitch) => { if (S) { S.fly.yaw = yaw; S.fly.pitch = pitch; } },
    move: (x, z, run) => { if (S) { S.C.stick(x, z); S.C.press('run', !!run); } },
    vert: v => { if (S) { S.C.press('jump', v > 0); S.C.press('crouch', v < 0); } },
    land: () => S && land(S), fly: () => S && fly(S), orbit: () => S && goOrbit(S), descend: sec => S && descend(S, sec || 40),
    // t — секунды мира, которые показать (своё смещение от часов мира), k — ускорение
    time: (t, k) => { if (S) { if (t != null) { S.off = t - S.CL.t(); S.t = t; } if (k != null) S.timeK = k; } },
    world: () => { if (S) { S.off = 0; S.timeK = 1; } },
    sky: () => S?.SV && { moon: { ...S.SV.moon }, sunK: S.V.sunK, cpu: S.SV.cpu, t: S.t, list: S.SV.list.map(e => { const B = S.P.basis(S.V.camBF, new Array(9)); const cl = Math.hypot(e.cen[0], e.cen[1], e.cen[2]) || 1; return { id: e.b.id, kind: e.kind, ll: e.kind === 'sun' ? null : [Math.asin(e.cen[1] / cl) * 180 / Math.PI, Math.atan2(-e.cen[2], e.cen[0]) * 180 / Math.PI], lit: +e.lit.toFixed(3), rad: e.rad, light: +e.light.toFixed(3), flux: e.flux, d: [...e.d], up: +(e.d[0] * B[3] + e.d[1] * B[4] + e.d[2] * B[5]).toFixed(4) }; }) },
    map: on => { if (S?.map) { if (on === undefined) S.map.toggle(); else if (on) S.map.open(); else S.map.close(); return S.map.isOpen; } },
    look: id => S && lookAt(S, id), untele: () => S && untele(S),
    stubs: on => { if (S?.SV) S.SV.stubs = !!on; },
    events: () => S?.S && S.S.moonEvents('home', 'luna', S.t),
    clock: () => S && { state: S.CL.state, off: S.CL.off, rtt: S.CL.rtt, src: S.CL.src, err: S.CL.err },
    get S(){ return S; },
  };
  window.GAME_IMPL = window.GAME_IMPL || {};
  window.GAME_IMPL.planet = { mount, unmount, _test };
})();
