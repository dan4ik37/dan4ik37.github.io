// ═══════════════════════════════════════
//  ТЕРРА — скрытая страница проверки (T-111, W1; /play/terra, #/games/terra): новый рельеф ядра T1 (js/engine/terra*.js, сборка
//  terra.wasm из E:\d37-terrain) — плотность (высоты, биомы, реки, пещеры), блоки 32³ кольцами вокруг игрока, сборка в потоках,
//  копать и насыпать, ходьба обычным player.js со своим человечком (анимации world3d), полёт (F). Плавающее начало: якорь
//  (кратен 32 м) переезжает только в шаге логики. Нет в каталоге, поиске и рекордах. Флаг: D37E.terra.ON (terra.js).
// ═══════════════════════════════════════
// Управление: WASD — идти/лететь, Пробел — прыжок / вверх, C — присесть / вниз, Shift — бег / быстрее, мышь (тянуть) — смотреть;
// клик по земле — копать (или насыпать: Q меняет), правый клик — насыпать; E / R — копать / насыпать в центр экрана; F — полёт.
// Телефон: джойстик слева, палец — смотреть, нажатие — копать/насыпать, кнопки справа.
// Проверки: GAME_IMPL.terra._test — state(), stats(), fly(on), move(x, z, run), vert(v), look(yaw, pitch), dig(), fill(), tp(x, z), S
(() => {
  const CSS = `
.tr-wrap{position:relative;height:min(78vh,760px);min-height:340px;border-radius:14px;overflow:hidden;background:#0b1020;touch-action:none;user-select:none;-webkit-user-select:none}
body.game-on .tr-wrap{height:calc(100dvh - 210px);min-height:300px}
.tr-hud{position:absolute;left:10px;top:10px;z-index:5;max-width:min(92%,520px);padding:6px 10px;border-radius:12px;background:rgba(6,8,20,.6);color:#e2e8f0;font:700 12px/1.45 Montserrat,system-ui,sans-serif;pointer-events:none;white-space:pre-wrap}
.tr-st{display:block;margin-top:2px;font:600 11px/1.4 ui-monospace,Consolas,monospace;color:#a5b4fc}
.tr-bar{position:absolute;right:10px;top:10px;z-index:6;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;max-width:60%}
.tr-bar button{border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:.38rem .7rem;background:rgba(10,8,24,.66);color:#fff;font:800 .78rem Montserrat,sans-serif;cursor:pointer;min-height:40px}
.tr-bar button.on{background:var(--accent,#9b6dff);border-color:transparent}
.tr-msg{position:absolute;inset:0;display:grid;place-items:center;color:#cbd5e1;font:800 15px Montserrat,sans-serif;text-align:center;padding:20px;z-index:3}
.tr-help{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:5;max-width:92%;padding:8px 12px;border-radius:12px;background:rgba(6,8,20,.72);color:#e2e8f0;font:700 12px/1.5 Montserrat,sans-serif;text-align:center}
.tr-help[hidden]{display:none}
.tr-cross{position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;z-index:4;pointer-events:none;border:2px solid rgba(255,255,255,.75);border-radius:50%;box-shadow:0 0 3px rgba(0,0,0,.6)}
@media (max-width:640px){.tr-bar{left:10px;right:10px;max-width:none;justify-content:flex-start}.tr-bar button{padding:.3rem .55rem;font-size:.72rem}
.tr-hud{top:58px;max-width:calc(100% - 20px);font-size:11px;padding:5px 8px}.tr-st{font-size:10px}}`;
  const css = () => { if (document.getElementById('tr-css')) return; const s = document.createElement('style'); s.id = 'tr-css'; s.textContent = CSS; document.head.appendChild(s); };
  const U = 2.1 / 1.8, SEED = 1337, REBASE = 192;   // переезд якоря, когда игрок дальше 192 ед. (~165 м) от него
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  let S = null;

  function mount(el){
    css();
    const wrap = document.createElement('div'); wrap.className = 'wld-wrap tr-wrap';
    const msg = document.createElement('div'); msg.className = 'tr-msg'; msg.textContent = '⛰ Загружаем рельеф…';
    wrap.appendChild(msg); el.appendChild(wrap);
    const st = S = { el, wrap, msg, dead: false };
    window.D37E.load().then(ok => {
      if (S !== st) return;
      if (!window.D37E.terra?.ON) { msg.textContent = 'Проверка рельефа выключена'; return; }
      if (!ok || !window.D37E.supported?.()) { msg.textContent = 'Нужен браузер с WebGL (3D) — открой в Chrome или на компьютере'; return; }
      try { start(st); } catch (e) { console.error(e); msg.textContent = 'Ошибка запуска рельефа'; }
    });
  }

  // суша у начала координат: высота 2…30 м (не вода, не пик)
  function findSpawn(T1){
    for (let r = 0; r < 4000; r += 24) for (let a = 0; a < 16; a++) {
      const x = Math.round(Math.cos(a * Math.PI / 8) * r), z = Math.round(Math.sin(a * Math.PI / 8) * r), h = T1.height(SEED, x, z);
      if (h > 2 && h < 30) return { x, z, h };
      if (r === 0) break;
    }
    return { x: 0, z: 0, h: T1.height(SEED, 0, 0) };
  }

  function start(st){
    const E = window.D37E, T1 = E.terraCore, wrap = st.wrap;
    const R = st.R = E.renderer(wrap);
    let useWasm = true; try { useWasm = localStorage.getItem('d37_terra_wasm') !== '0'; } catch (e) {}
    const TS = st.TS = E.terra.create({ seed: SEED, wasm: useWasm });
    const TM = st.TM = E.terraMesh(R, TS, { unit: U });
    st.msg.remove();
    const sp = findSpawn(T1);
    st.ax = Math.floor(sp.x / 32) * 32; st.az = Math.floor(sp.z / 32) * 32;
    TM.setAnchor(st.ax, st.az);
    R.setLighting({ time: 10.5, brightness: 1.05, fogEnd: Math.max(120, (TS.radius * 32 - 10) * U) });
    // вода: плоскость моря (0 м) под камерой
    const T = R.T;
    st.sea = new T.Mesh(new T.PlaneGeometry(1, 1), R.water('#2f86c9', { key: 'terra' }));
    st.sea.rotation.x = -Math.PI / 2; st.sea.scale.set(TS.radius * 64 * U + 80, TS.radius * 64 * U + 80, 1); st.sea.renderOrder = 2;
    R.scene.add(st.sea);
    // управление
    const C = st.C = E.controls({});
    const I = st.I = E.input(wrap, { controls: C, ignore: 'button, .tr-bar, .e-btn' });
    const H = st.H = E.ui(wrap, C);
    // физика: земля и вода — из плотности ядра (пещеры: пол той пещеры, в которой стоишь); координаты физики — ед. от якоря
    const ph = st.ph = new E.Phys({ ground: null });
    st.refY = sp.h + 1;
    // земля — нарисованные треугольники (TS.ground по показанной сетке; блок ещё не показан — плотность). col — рельеф как «тело»:
    // за края ям, обрывов и насыпей хватаются руки (паркур player.js); blocked — встать/залезть не сквозь рельеф и не под свод пещеры
    ph.terrain = {
      sample: (x, z) => TS.ground(st.ax + x / U, st.az + z / U, st.refY) * U,
      blocked: (x, z, y0, y1, r) => TS.blocked(st.ax + x / U, st.az + z / U, y0 / U, y1 / U, (r || 0) / U),
      normal: (x, y, z, out, dx, dy, dz) => TS.normal(st.ax + x / U, y / U, st.az + z / U, out, dx, dy, dz),
      col: { terrain: true, solid: true },
    };
    ph.waterLevel = (x, z) => TS.water(st.ax + x / U, st.az + z / U) === 0 ? 0 : -Infinity;
    const x0 = (sp.x - st.ax) * U, z0 = (sp.z - st.az) * U;
    const Pl = st.Pl = E.player(ph, { x: x0, z: z0, yaw: 0 });
    Pl.place(x0, ph.terrain.sample(x0, z0), z0, 0);
    st.A = E.actors(R);
    st.A.add('me', Object.assign({}, window.D37Char?.look?.() || {}), { x: Pl.ch.x, y: Pl.ch.y, z: Pl.ch.z, yaw: Pl.yaw });
    st.rig = E.cameraRig(R.camera, { yaw: 0, pitch: .35, dist: 9, minD: 2.6, maxD: 24 });
    st.rig.snap(Pl.ch.x, Pl.ch.y, Pl.ch.z);
    st.unfollow = st.rig.follow(Pl);
    st.mode = 'walk'; st.tool = 'dig';
    st.fly = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: -.2 };
    st.pend = [];   // правки из кадра → применяются в шаге логики
    st.rebases = 0;
    // HUD и кнопки
    const hud = document.createElement('div'); hud.className = 'tr-hud';
    const h1 = document.createElement('div'), h2 = document.createElement('span'); h2.className = 'tr-st';
    hud.appendChild(h1); hud.appendChild(h2); wrap.appendChild(hud);
    st.h1 = h1; st.h2 = h2;
    const cross = document.createElement('div'); cross.className = 'tr-cross'; wrap.appendChild(cross);
    const bar = document.createElement('div'); bar.className = 'tr-bar'; wrap.appendChild(bar);
    const btn = (txt, title, f) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = title; b.addEventListener('click', e => { e.stopPropagation(); f(b); }); bar.appendChild(b); return b; };
    st.bFly = btn('✈ Полёт', 'Полёт / ходьба (F)', () => setFly(st, st.mode !== 'fly'));
    st.bTool = btn('⛏ Копать', 'Копать / насыпать (Q)', () => toggleTool(st));
    btn('❓', 'Как управлять', () => { st.help.hidden = !st.help.hidden; });
    const help = st.help = document.createElement('div'); help.className = 'tr-help';
    help.textContent = I.touch ? 'Джойстик — идти, палец — смотреть, нажатие по земле — копать (⛏/🧱 — насыпать), ✈ — полёт.'
      : 'WASD — идти, мышь (тянуть) — смотреть, клик — копать, правый клик — насыпать (Q — поменять), E/R — в центр экрана, F — полёт, Shift — быстрее.';
    wrap.appendChild(help);
    st.helpT = setTimeout(() => { if (S === st) help.hidden = true; }, 9000);
    touchButtons(st);
    st.onCtx = e => { e.preventDefault(); const b = wrap.getBoundingClientRect(); queueEdit(st, e.clientX, e.clientY, 'fill'); void b; };
    wrap.addEventListener('contextmenu', st.onCtx);
    st.keyT = e => {
      if (e.repeat || e.target?.closest?.('input, textarea')) return;
      if (e.code === 'KeyF') setFly(st, st.mode !== 'fly');
      else if (e.code === 'KeyQ') toggleTool(st);
      else if (e.code === 'KeyE' || e.code === 'KeyR') { const b = wrap.getBoundingClientRect(); queueEdit(st, b.left + b.width / 2, b.top + b.height / 2, e.code === 'KeyE' ? 'dig' : 'fill'); }
    };
    window.addEventListener('keydown', st.keyT);
    st.offCtx = window.D37Settings?.context({ engine: true, R: () => S?.R, onClose: () => S?.C?.reset_state?.() });
    st.ro = window.ResizeObserver ? new ResizeObserver(() => { if (!R.dead) R.resize(); }) : null;
    st.ro?.observe(wrap);
    R.resize();
    st.loop = E.loop(dt => step(st, dt), dt => frame(st, dt));
  }
  function touchButtons(st){
    if (!st.I.touch) return;
    if (st.mode === 'fly') st.H.buttons([{ action: 'crouch', icon: '⬇', label: 'вниз' }, { action: 'run', icon: '🚀', label: 'быстрее' }, { action: 'jump', icon: '⬆', label: 'вверх', big: true }]);
    else st.H.buttons([{ action: 'crouch', icon: '⬇', label: 'присесть' }, { action: 'jump', icon: '⤒', label: 'прыжок', big: true }]);
  }
  function toggleTool(st){ st.tool = st.tool === 'dig' ? 'fill' : 'dig'; st.bTool.textContent = st.tool === 'dig' ? '⛏ Копать' : '🧱 Насыпать'; st.bTool.classList.toggle('on', st.tool === 'fill'); }
  function setFly(st, on){
    if (on === (st.mode === 'fly')) return;
    const F = st.fly, Pl = st.Pl, me = st.A.get('me');
    if (on) {
      F.x = Pl.ch.x; F.y = Pl.ch.y + 3; F.z = Pl.ch.z; F.vx = F.vy = F.vz = 0; F.yaw = st.rig.yaw; F.pitch = -.15;
      st.mode = 'fly'; if (me) me.hidden = true;
    } else {
      st.refY = F.y / U + 2;
      const gy = st.ph.terrain.sample(F.x, F.z);
      Pl.place(F.x, Math.max(gy, Math.min(F.y, gy + 40)), F.z, F.yaw + Math.PI);
      st.rig.yaw = F.yaw; st.rig.snap(Pl.ch.x, Pl.ch.y, Pl.ch.z);
      st.mode = 'walk'; if (me) me.hidden = false;
    }
    st.bFly.textContent = st.mode === 'fly' ? '🚶 Пешком' : '✈ Полёт';
    st.bFly.classList.toggle('on', st.mode === 'fly');
    touchButtons(st);
  }
  // нажатие по экрану → луч (в метрах мира) → в очередь шага
  function queueEdit(st, cx, cy, kind){
    const r = st.R.screenRay(cx, cy);
    st.pend.push({ kind, ox: st.ax + r.ox / U, oy: r.oy / U, oz: st.az + r.oz / U, dx: r.dx, dy: r.dy, dz: r.dz });
    if (st.pend.length > 8) st.pend.shift();
  }

  // ═══ Шаг логики (1/60 с): ходьба или полёт, правки, переезд якоря, подгрузка ═══
  function step(st, dt){
    if (st.dead) return;
    const { C, TS } = st;
    C.blocked = !!window.D37Settings?.isOpen?.();
    C.step(dt);
    while (st.pend.length) {   // копать / насыпать: луч по плотности — первая точка земли (до 60 м)
      const p = st.pend.shift(), hit = TS.ray(p.ox, p.oy, p.oz, p.dx, p.dy, p.dz, 60);
      if (!hit) continue;
      if (p.kind === 'dig') TS.dig(hit.x, hit.y, hit.z, 2.5);
      else TS.fill(hit.x - p.dx * .6, hit.y - p.dy * .6, hit.z - p.dz * .6, 2);
      st.edits = (st.edits || 0) + 1;
    }
    let px, py, pz;
    if (st.mode === 'walk') {
      const Pl = st.Pl;
      st.refY = Pl.ch.y / U;
      Pl.update(dt, C, st.rig);
      px = Pl.ch.x; py = Pl.ch.y; pz = Pl.ch.z;
      if (py < -400) { const gy = st.ph.terrain.sample(px, pz); Pl.place(px, gy, pz, Pl.yaw); }   // провалился — на землю
    } else {
      flyStep(st, dt);
      px = st.fly.x; py = st.fly.y; pz = st.fly.z;
    }
    if (Math.abs(px) > REBASE || Math.abs(pz) > REBASE) rebase(st, Math.round(px / U / 32) * 32, Math.round(pz / U / 32) * 32);
    const P = st.mode === 'walk' ? st.Pl.ch : st.fly;
    TS.update(st.ax + P.x / U, P.y / U, st.az + P.z / U);
  }
  function flyStep(st, dt){
    const { C, I } = st, F = st.fly;
    const dx = I.look.dx + C.look.dx, dy = I.look.dy + C.look.dy;
    F.yaw -= dx * .0042; F.pitch = clamp(F.pitch - dy * .0042, -1.5, 1.5);
    const cy = Math.cos(F.yaw), sy = Math.sin(F.yaw), cp = Math.cos(F.pitch), sp = Math.sin(F.pitch);
    const mz = C.move.z, mx = C.move.x, my = (C.held('jump') ? 1 : 0) - (C.held('crouch') ? 1 : 0);
    const speed = (C.held('run') ? 100 : 25) * U;   // 25 м/с, с Shift 100 м/с
    const tx = (-sy * cp * mz + cy * mx) * speed, ty = (sp * mz + my) * speed, tz = (-cy * cp * mz - sy * mx) * speed;
    const k = 1 - Math.exp(-4 * dt);
    F.vx += (tx - F.vx) * k; F.vy += (ty - F.vy) * k; F.vz += (tz - F.vz) * k;
    F.x += F.vx * dt; F.y += F.vy * dt; F.z += F.vz * dt;
    // не под землю: высота рельефа под точкой (без пещер)
    const g = st.TS.height(st.ax + F.x / U, st.az + F.z / U) * U + 2;
    if (F.y < g) { F.y = g; if (F.vy < 0) F.vy = 0; }
    if (F.y > 900) F.y = 900;
  }
  // переезд якоря на (dxm, dzm) метров (кратно 32): всё своё — на столько же назад; в шаге логики (одинаково на любом экране)
  function rebase(st, dxm, dzm){
    if (!dxm && !dzm) return;
    st.ax += dxm; st.az += dzm; st.rebases++;
    const sx = dxm * U, sz = dzm * U, Pl = st.Pl, F = st.fly, rig = st.rig, cam = st.R.camera;
    Pl.ch.x -= sx; Pl.ch.z -= sz;
    F.x -= sx; F.z -= sz;
    rig.tx -= sx; rig.tz -= sz; cam.position.x -= sx; cam.position.z -= sz;
    const me = st.A.get('me'); if (me) { me.x -= sx; me.z -= sz; if (me.ch?.root) { me.ch.root.position.x -= sx; me.ch.root.position.z -= sz; } }
    st.TM.setAnchor(st.ax, st.az);
  }

  // ═══ Кадр: камера, человечек, сетки рельефа (бюджет), HUD ═══
  function frame(st, dt){
    if (st.dead) return;
    const { R, I, C, TM } = st, cam = R.camera;
    for (let i = 0; i < I.taps.length; i++) queueEdit(st, I.taps[i].x, I.taps[i].y, st.tool);
    if (st.mode === 'fly') {
      const F = st.fly, cy = Math.cos(F.yaw), sy = Math.sin(F.yaw), cp = Math.cos(F.pitch), sp = Math.sin(F.pitch);
      cam.up.set(0, 1, 0); cam.position.set(F.x, F.y, F.z);
      cam.lookAt(F.x - sy * cp, F.y + sp, F.z - cy * cp);
      R.follow(F.x, F.z, F.y);
    } else {
      const Pl = st.Pl;
      st.A.pose('me', Pl.pose());
      st.rig.update(dt, Pl, { dx: I.look.dx + C.look.dx, dy: I.look.dy + C.look.dy, zoom: I.zoom }, st.ph, C);
      R.follow(Pl.ch.x, Pl.ch.z, Pl.ch.y);
      st.H.stamina(Pl.stamina / Pl.maxStamina, Pl.exhausted);
    }
    st.A.update(dt, performance.now() / 1000, cam.position);
    st.sea.position.set(Math.round(cam.position.x / 8) * 8, 0, Math.round(cam.position.z / 8) * 8);
    I.frameEnd(); C.frameEnd();
    const mob = !!window.D37E.isMobile?.();
    TM.upload(mob ? 2 : 3, mob ? 2 : 4);
    R.update(dt);
    R.render();
    hud(st);
  }
  const BIO = ['вода', 'пляж', 'равнина', 'лес', 'тайга', 'пустыня', 'саванна', 'болото', 'тундра', 'скалы', 'снег'];
  let hudAt = 0;
  function hud(st){
    const tn = performance.now(); if (tn - hudAt < 250) return; hudAt = tn;
    const P = st.mode === 'walk' ? st.Pl.ch : st.fly, wx = st.ax + P.x / U, wz = st.az + P.z / U, wy = P.y / U;
    const T1 = window.D37E.terraCore, b = T1.biome(SEED, wx, wz);
    const s = st.TS.stats(), m = st.TM.stats(), rs = st.R.stats;
    const fps = rs.frames ? 1000 / (rs.sumDt / rs.frames) : 0, cpu = rs.frames ? rs.sumCpu / rs.frames : 0;
    st.h1.textContent = `⛰ ${st.mode === 'fly' ? '✈ полёт' : '🚶 пешком'} · ${Math.round(wx)}, ${Math.round(wy)}, ${Math.round(wz)} м · ${BIO[b] || ''}`;
    st.h2.textContent = `ядро ${s.kinds} · блоков ${m.live}/${s.blocks} · очередь ${s.queued + s.inflight} · сборка ${s.buildAvg.toFixed(1)} мс · загрузка ${m.upAvg.toFixed(2)} мс · правок ${s.edits}\nвызовов ${rs.calls} · FPS ${fps.toFixed(0)} · ЦП ${cpu.toFixed(1)} мс`;
    rs.frames = 0; rs.sumDt = 0; rs.sumCpu = 0; rs.maxDt = 0; rs.maxCpu = 0; rs.sumR = 0;
  }

  function unmount(){
    const st = S; S = null;
    if (!st) return;
    st.dead = true;
    clearTimeout(st.helpT);
    try { st.loop?.stop(); } catch (e) {}
    window.removeEventListener('keydown', st.keyT);
    try { st.wrap?.removeEventListener('contextmenu', st.onCtx); } catch (e) {}
    try { st.offCtx?.(); } catch (e) {}
    try { st.ro?.disconnect(); } catch (e) {}
    try { st.unfollow?.(); } catch (e) {}
    try { st.TM?.dispose(); } catch (e) { console.error(e); }
    try { st.TS?.dispose(); } catch (e) { console.error(e); }
    try { st.sea?.geometry.dispose(); } catch (e) {}
    try { st.A?.dispose(); } catch (e) {}
    try { st.H?.dispose(); st.I?.dispose(); st.C?.dispose?.(); } catch (e) {}
    try { st.R?.dispose(); } catch (e) { console.error(e); }
    st.wrap?.remove();
  }

  // ═══ Для проверок (scripts/terra-e2e.cjs) ═══
  const _test = {
    state: () => S && S.Pl && { mode: S.mode, ax: S.ax, az: S.az, rebases: S.rebases, edits: S.edits || 0,
      player: { x: S.Pl.ch.x, y: S.Pl.ch.y, z: S.Pl.ch.z, grounded: S.Pl.ch.grounded, swim: S.Pl.swim, wx: S.ax + S.Pl.ch.x / U, wz: S.az + S.Pl.ch.z / U },
      fly: { ...S.fly, wx: S.ax + S.fly.x / U, wz: S.az + S.fly.z / U } },
    stats: () => S && { ts: S.TS.stats(), tm: S.TM.stats() },
    fly: on => S && setFly(S, on !== false),
    move: (x, z, run) => { if (S) { S.C.stick(x, z); S.C.press('run', !!run); } },
    vert: v => { if (S) { S.C.press('jump', v > 0); S.C.press('crouch', v < 0); } },
    look: (yaw, pitch) => { if (!S) return; if (S.mode === 'fly') { S.fly.yaw = yaw; if (pitch != null) S.fly.pitch = pitch; } else { S.rig.yaw = yaw; S.Pl.yaw = yaw + Math.PI; } },
    dig: () => { if (S) { const b = S.wrap.getBoundingClientRect(); queueEdit(S, b.left + b.width / 2, b.top + b.height * .62, 'dig'); } },
    fill: () => { if (S) { const b = S.wrap.getBoundingClientRect(); queueEdit(S, b.left + b.width / 2, b.top + b.height * .62, 'fill'); } },
    tp: (x, z) => { if (!S) return; const ax = Math.floor(x / 32) * 32, az = Math.floor(z / 32) * 32; rebase(S, ax - S.ax, az - S.az); const lx = (x - S.ax) * U, lz = (z - S.az) * U; if (S.mode === 'fly') { S.fly.x = lx; S.fly.z = lz; } else { S.refY = S.TS.height(x, z) + 2; S.Pl.place(lx, S.ph.terrain.sample(lx, lz), lz, S.Pl.yaw); } },
    get S(){ return S; },
  };
  window.GAME_IMPL = window.GAME_IMPL || {};
  window.GAME_IMPL.terra = { mount, unmount, _test };
})();
