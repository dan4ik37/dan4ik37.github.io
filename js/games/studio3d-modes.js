// ═══════════════════════════════════════
//  «СТУДИЯ 3D» — режим игры и ракурс в редакторе (расширение студии 'modes'): окно «🎮 Режим», предметы для игры,
//  свойства (команда, номер чекпоинта, камера), заготовки миров под каждый режим, страница «Как сделать свой режим»
// ═══════════════════════════════════════
// Всё пишется в SC.settings (сохраняется и выкладывается с миром): game { mode, …параметры D37E.modes }, camera { mode, free,
// dist, angle } (D37E.views), age — метка возраста по умолчанию при «📤 Выложить» (бои — 12+, остальное — 6+).
// Предметы для игры (➕ Деталь → «🎮 Для игры», круговое меню геймпада): 🎥 камера (по виду редактора, с зоной), 🏁 финиш,
// 🚩 чекпоинт (номер — по порядку), 💰 монетка, 🟩 зона холма, точки команд 🔴🔵🟢🟡, 🟥 зона зомби, 💀 лава, 🦘 батут, ⚡ ускоритель.
// Заготовки: Файл → «🎮 Режимы игры» (data-m="new:m-…"; studioTemplates в studio3d.js template()).
(() => {
  const E = window.D37E = window.D37E || {};
  const S3X = E.s3x = E.s3x || { surface: true, nextAt: null };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEG = Math.PI / 180;
  let api = null;
  const ed = () => api?.ed, core = () => api.core, SC = () => api?.ed?.SC;
  const MD = () => E.modes, VW = () => E.views;
  const TEAMC = ['', '#ef4444', '#3b82f6', '#22c55e', '#eab308'];

  // ═══ Предметы для игры ═══
  const ITEMS = [
    ['cam', '🎥', 'Камера (как видишь)'], ['finish', '🏁', 'Финиш'], ['check', '🚩', 'Чекпоинт гонки'], ['coin', '💰', 'Монетка'],
    ['hill', '🟩', 'Зона холма'], ['t1', '🔴', 'Точка красных'], ['t2', '🔵', 'Точка синих'], ['t3', '🟢', 'Точка зелёных'], ['t4', '🟡', 'Точка жёлтых'],
    ['zspawn', '🟥', 'Зона зомби'], ['lava', '💀', 'Лава'], ['bounce', '🦘', 'Батут'], ['speed', '⚡', 'Ускоритель'],
  ];
  S3X.gameItems = () => ITEMS.filter(x => !['t3', 't4'].includes(x[0])).map(([k, i, n]) => [i, n, 'm:s3g:' + k]);
  function addItem(k){
    const e = ed(), C = core(), S = SC();
    const ins = (cls, p) => api.insert(cls, p);
    let o = null;
    if (k === 'cam') {
      const c = e.cam;
      o = ins('Camera', { name: 'Камера ' + (S.all().filter(x => x.cls === 'Camera').length + 1), pos: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)], rot: [+(-c.pitch / DEG).toFixed(1), +((c.yaw / DEG) % 360).toFixed(1), 0], fov: 50, kind: 'fixed' });
      // зона перед камерой на земле — игрок в ней → эта камера
      const f = [-Math.sin(c.yaw), -Math.cos(c.yaw)], zx = c.x + f[0] * 12, zz = c.z + f[1] * 12, gy = e.ph.groundAt ? e.ph.groundAt(zx, zz) : 0;
      S.add('Part', { name: 'Зона камеры', pos: [+zx.toFixed(2), +(gy + 3).toFixed(2), +zz.toFixed(2)], size: [14, 6, 14], color: '#f472b6', mat: 'neon', alpha: 1, collide: false, shadow: false }, o);
      const cc = S.settings?.camera;
      if (!cc || cc.mode === 'third') { setCam({ mode: 'fixed' }); api.msg('🎥 Камера по виду + зона. Ракурс мира — «📹 Камеры в мире» (🎮 Режим → Ракурс)', true); }
      else api.msg('🎥 Камера по виду + розовая зона: игрок в зоне — включается эта камера', true);
    }
    else if (k === 'finish') o = ins('Part', { name: 'Финиш', size: [6, .4, 6], color: '#f5cd30', mat: 'neon', touch: 'finish' });
    else if (k === 'check') { const n = S.all().filter(x => x.touch === 'check').length + 1; o = ins('Part', { name: 'Чекпоинт ' + n, size: [10, 5, .6], color: '#22c55e', mat: 'neon', alpha: .6, collide: false, shadow: false, touch: 'check', order: n }); }
    else if (k === 'coin') { o = ins('Part', { name: 'Монетка', shape: 'cyl', size: [.3, 1.2, 1.2], rot: [0, 0, 90], color: '#f5cd30', mat: 'metal', collide: false, touch: 'coin' }); if (o?.pos) S.set(o, 'pos', [o.pos[0], +(o.pos[1] + .9).toFixed(3), o.pos[2]]); }
    else if (k === 'hill') o = ins('Part', { name: 'Зона холма', size: [10, .3, 10], color: '#22c55e', mat: 'neon', alpha: .5, collide: false, shadow: false, touch: 'hill' });
    else if (/^t[1-4]$/.test(k)) { const t = +k[1], T = MD().TEAMS[t]; o = ins('Spawn', { name: 'Точка: ' + T[1], team: t, color: TEAMC[t] }); }
    else if (k === 'zspawn') o = ins('Part', { name: 'Зона зомби', size: [8, .3, 8], color: '#ef4444', mat: 'neon', alpha: .6, collide: false, shadow: false, touch: 'zspawn' });
    else if (k === 'lava') o = ins('Part', { name: 'Лава', size: [8, .4, 8], color: '#ff4b1f', mat: 'neon', touch: 'kill' });
    else if (k === 'bounce') o = ins('Part', { name: 'Батут', size: [4, .5, 4], color: '#ff66cc', mat: 'smooth', touch: 'bounce' });
    else if (k === 'speed') o = ins('Part', { name: 'Ускоритель', size: [4, .2, 6], color: '#38bdf8', mat: 'neon', touch: 'speed' });
    C.renderTree(); C.renderProps(); api.markDirty();
    if (E.s3ui?.sheetOpen('mode')) setTimeout(openPanel, 30);
    return o;
  }

  // ═══ Настройки мира ═══
  const S0 = () => { const S = SC(); S.settings = S.settings || {}; return S.settings; };
  function setGame(g){
    const s = S0();
    if (!g || g.mode === 'none') delete s.game; else s.game = g;
    s.age = g && MD().PVP.has(g.mode) ? 12 : 6;   // метка возраста по умолчанию при «Выложить»: бои — 12+
    api.markDirty();
  }
  function setCam(c){ const s = S0(); if (!c || (c.mode === 'third' && c.free !== false && !c.dist && !c.angle)) delete s.camera; else s.camera = c; api.markDirty(); }
  // что есть в мире для режима: [ключ, есть сколько, нужно сколько, подпись, ➕ какой предмет]
  function needs(mode){
    const S = SC(), all = S.all(), n = f => all.filter(f).length;
    const spawns = n(o => o.cls === 'Spawn'), g = S.settings?.game || {}, teams = mode === 'teams' ? Math.max(2, g.teams || 2) : g.teams || 0;
    const out = [];
    for (const k of MD().MODES[mode]?.needs || []) {
      if (k === 'spawn') out.push([k, spawns, 1, '📍 Точка появления (старт)', 'spawn']);
      if (k === 'finish') out.push([k, n(o => o.touch === 'finish'), 1, '🏁 Финиш', 's3g:finish']);
      if (k === 'check') out.push([k, n(o => o.touch === 'check'), 2, '🚩 Чекпоинты (по кругу трассы)', 's3g:check']);
      if (k === 'hill') out.push([k, n(o => o.touch === 'hill'), 1, '🟩 Зона холма', 's3g:hill']);
      if (k === 'coin') out.push([k, n(o => o.touch === 'coin'), 5, '💰 Монетки', 's3g:coin']);
      if (k === 'zspawn') out.push([k, n(o => o.touch === 'zspawn'), 1, '🟥 Зоны зомби (без них — вокруг старта)', 's3g:zspawn']);
    }
    if (teams) for (let t = 1; t <= teams; t++) out.push(['t' + t, n(o => o.cls === 'Spawn' && (o.team | 0) === t), 1, `${MD().TEAMS[t][0]} Точка команды «${MD().TEAMS[t][1]}»`, 's3g:t' + t]);
    if (S.settings?.camera?.mode === 'fixed') out.push(['cam', n(o => o.cls === 'Camera'), 1, '🎥 Камеры (с зонами)', 's3g:cam']);
    return out;
  }

  // ═══ Окно «🎮 Режим игры» ═══
  function openPanel(){
    const S = SC(); if (!S) return;
    const g = S.settings?.game || { mode: 'none' }, mode = MD().MODES[g.mode] ? g.mode : 'none', D = MD().MODES[mode], c = MD().cfg(mode, g);
    const cam = VW().cfg(S.settings?.camera || 'third');
    const par = D.params.map(k => {
      const P = MD().PARAMS[k];
      if (P.list) return `<label>${P.label}<select data-g="${k}">${P.list.filter(([v]) => mode !== 'teams' || v >= 2).map(([v, t]) => `<option value="${v}"${c[k] === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
      const val = c[k], txt = val === 0 && P.zero ? P.zero : val + (P.unit ? ' ' + P.unit : '');
      return `<label>${P.label}: <b>${esc(txt)}</b><input type="range" min="${P.min}" max="${P.max}" step="${P.step}" value="${esc(val)}" data-g="${k}"></label>`;
    }).join('');
    const need = mode === 'none' ? [] : needs(mode);
    const html = `<div class="s3x-modes">${MD().LIST.map(id => { const M2 = MD().MODES[id]; return `<button type="button" class="s3x-mode${id === mode ? ' on' : ''}" data-mode="${id}" title="${esc(M2.desc)}"><i>${M2.icon}</i>${esc(M2.name)}</button>`; }).join('')}</div>`
      + `<p class="s3x-desc">${D.icon} <b>${esc(D.name)}</b> — ${esc(D.desc)}</p>`
      + (par ? `<div class="s3x-sec">⚙ Настройки режима</div><div class="s3x-par">${par}</div>` : '')
      + (need.length ? `<div class="s3x-sec">🧩 Что нужно в мире</div><div class="s3x-need">${need.map(([k, has, want, t, add]) => `<div><span>${has >= want ? '✅' : '⬜'} ${t}: <b>${has}</b></span><button type="button" data-add="${add}" title="Поставить перед камерой">➕ Поставить</button></div>`).join('')}</div>` : '')
      + `<div class="s3x-sec">🎥 Ракурс камеры для игроков</div><div class="s3x-modes">${VW().MODES.map(([id, n, i, d]) => `<button type="button" class="s3x-mode${id === cam.mode ? ' on' : ''}" data-cam="${id}" title="${esc(d)}"><i>${i}</i>${esc(n)}</button>`).join('')}</div>`
      + `<p class="s3x-desc">${esc(VW().MODES.find(m => m[0] === cam.mode)?.[3] || '')}</p>`
      + (['third', 'first', 'shoulder'].includes(cam.mode) ? `<label class="s3-chk"><input type="checkbox" data-c="free"${cam.free ? ' checked' : ''}> Игрок может переключать вид (V)</label>` : '')
      + (['top', 'iso', 'side'].includes(cam.mode) ? `<div class="s3x-par"><label>Расстояние камеры: <b>${esc(cam.dist)}</b><input type="range" min="8" max="70" step="1" value="${esc(cam.dist)}" data-c="dist"></label>${cam.mode === 'top' ? `<label>Наклон: <b>${esc(cam.angle)}°</b><input type="range" min="35" max="89" step="1" value="${esc(cam.angle)}" data-c="angle"></label>` : ''}</div>` : '')
      + `<div class="s3x-row"><button type="button" class="s3-play" data-go="play">▶ Проверить</button><button type="button" data-go="test" title="Вторая вкладка или друг — по ссылке">👥 Вдвоём</button><button type="button" data-go="help">❓ Как сделать свой режим</button></div>`;
    const sh = E.s3ui?.sheet('mode', { title: '🎮 Режим игры и ракурс', html, cls: 's3x-wide' }); if (!sh) return;
    sh.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.mode) { const m = b.dataset.mode; setGame(m === 'none' ? null : { mode: m, ...MD().MODES[m].def }); openPanel(); }
      else if (b.dataset.cam) { setCam({ ...(SC().settings?.camera || {}), mode: b.dataset.cam }); openPanel(); }
      else if (b.dataset.add) { const a = b.dataset.add; if (a === 'spawn') core().menu('spawn'); else addItem(a.slice(4)); }
      else if (b.dataset.go === 'play') { E.s3ui.closeSheet(); core().play(); }
      else if (b.dataset.go === 'test') { E.s3ui.closeSheet(); core().act('mp:test'); }
      else if (b.dataset.go === 'help') help();
    });
    const onIn = (ev, commit) => {
      const el = ev.target, s = S0();
      if (el.dataset.g) {
        const k = el.dataset.g, v = +el.value, P = MD().PARAMS[k];
        s.game = { ...(s.game || { mode }), [k]: v }; api.markDirty();
        const lb = el.closest('label')?.querySelector('b'); if (lb) lb.textContent = v === 0 && P.zero ? P.zero : v + (P.unit ? ' ' + P.unit : '');
        if (commit && k === 'teams') openPanel();
      } else if (el.dataset.c) {
        const k = el.dataset.c, v = el.type === 'checkbox' ? el.checked : +el.value;
        setCam({ ...VW().cfg(s.camera || 'third'), ...(s.camera || {}), [k]: v });
        const lb = el.closest('label')?.querySelector('b'); if (lb) lb.textContent = k === 'angle' ? v + '°' : v;
      }
    };
    sh.addEventListener('input', ev => onIn(ev, false));
    sh.addEventListener('change', ev => onIn(ev, true));
  }

  // ═══ «Как сделать свой режим» — одна страница ═══
  function help(){
    const rows = MD().LIST.filter(m => m !== 'none').map(m => { const D = MD().MODES[m]; const need = { spawn: '📍 старт', finish: '🏁 финиш', check: '🚩 чекпоинты', hill: '🟩 зона холма', coin: '💰 монетки', zspawn: '🟥 зоны зомби', tspawn: '🔴🔵 точки команд' }; return `<li><b>${D.icon} ${esc(D.name)}</b> — ${D.needs.map(n => need[n]).join(', ')}</li>`; }).join('');
    E.s3ui?.sheet('help', { title: '❓ Как сделать свой режим', cls: 's3x-wide s3x-help', html: `
      <h4>1. Выбери режим</h4><p>Нажми <b>🎮 Режим</b> и выбери карточку: Обби, Гонка, Каждый сам за себя, Команды, Царь горы, Прятки, Сбор монет или Выживание. Или открой готовую заготовку: <b>📁 Файл → 🎮 Режимы игры</b>.</p>
      <h4>2. Поставь, что нужно</h4><p>В окне режима есть список «Что нужно в мире» — у каждого пункта кнопка <b>➕ Поставить</b>. Предмет встаёт туда, куда смотришь. Их же можно взять в <b>➕ Деталь → 🎮 Для игры</b>.</p><ul>${rows}</ul>
      <h4>3. Настрой правила</h4><p>Время раунда, очков для победы, сколько раундов, команды, жизни, отсчёт перед стартом — ползунками в окне режима. 0 у времени — без ограничения.</p>
      <h4>4. Выбери ракурс камеры</h4><p>От 3-го или 1-го лица, из-за плеча, сверху (2.5D), изометрия, сбоку (как 2D-платформер — ходьба только влево-вправо) или <b>📹 камеры в мире</b>: ставишь 🎥 камеру «как видишь», у неё розовая зона — игрок зашёл в зону, и включилась эта камера. Зону можно растянуть стрелками или добавить ещё одну деталь внутрь камеры (в Проводнике).</p>
      <h4>5. Проверь</h4><p><b>▶ Проверить</b> — одному. Бои и прятки интереснее вдвоём: <b>👥 Тест вдвоём</b> откроет комнату — зайди второй вкладкой или позови друга. Правила считает хозяин комнаты, у всех — одно табло.</p>
      <h4>6. Выложи</h4><p><b>📤 Выложить</b> → ссылка для друзей (или в каталог после проверки). Режим и ракурс уходят вместе с миром.</p>
      <h4>Своя логика — скриптом (по желанию)</h4><p>Режим можно дополнить: скрипты видят <code>Game</code> и <code>Camera</code>.</p>
      <pre>Game.RoundStart.Connect(round => {
  gui.message('Раунд ' + round + '! Вперёд!', 3);
});
Game.RoundEnd.Connect((winner, text) => {
  gui.message(text, 5);
});
// бонус: монетка-звезда даёт 5 очков
script.Parent.Touched.Connect((hit, player) => {
  if (player) Game.AddScore(player, 5);
});
// сменить ракурс всем: Camera.Mode = 'top';
// сменить режим: Game.Mode = 'ffa';</pre>
      <p>Ещё: <code>Game.Mode</code>, <code>Game.State</code> ('wait', 'count', 'play', 'end', 'over'), <code>Game.Round</code>, <code>Game.TimeLeft</code>, <code>Game.GetScore(player)</code>, <code>Game.GetTeam(player)</code>, <code>Game.EndRound(player)</code>, <code>Camera.SetMode('first', player)</code>, <code>Camera.Shake(1, 0.5)</code>. В Lua — то же через двоеточие: <code>Game:AddScore(player, 5)</code>.</p>` });
  }

  // ═══ Заготовки миров под режимы (📁 Файл → 🎮 Режимы игры) ═══
  const T = {};
  const B = (SC2, name, pos, size, color, mat, more = {}, parent = null) => SC2.add('Part', { name, pos, size, color, mat, ...more }, parent);
  const settings = (SC2, game, camera) => { SC2.settings = { game: { mode: game, ...E.modes.MODES[game].def }, age: E.modes.PVP.has(game) ? 12 : 6 }; if (camera) SC2.settings.camera = typeof camera === 'string' ? { mode: camera } : camera; };
  T['m-obby'] = { name: 'Обби: полоса препятствий', icon: '🏃', build(S){
    B(S, 'Старт', [0, -.5, 0], [16, 1, 16], '#4b974b', 'grass');
    S.add('Spawn', { name: 'Старт', pos: [0, .2, 0], rot: [0, 180, 0] });   // лицом к полосе (−Z)
    let z = -10; const plat = [[0, 1.2], [3, 2.2], [-2, 3.2], [1, 4], [-1, 4.8]];
    plat.forEach(([x, y], i) => { z -= 4.2; B(S, 'Платформа ' + (i + 1), [x, y, z], [3, .6, 3], ['#0d69ac', '#00ffff', '#6e99ca'][i % 3], 'smooth'); });
    B(S, 'Лава', [0, .05, -24], [20, .2, 30], '#ff4b1f', 'neon', { touch: 'kill' });
    S.add('Spawn', { name: 'Чекпоинт', pos: [0, 5.2, z - 5], size: [5, .4, 5], color: '#22c55e' });
    B(S, 'Батут', [0, 5.6, z - 10.5], [3, .4, 3], '#ff66cc', 'smooth', { touch: 'bounce' });
    B(S, 'Высокая платформа', [0, 11, z - 16], [5, .6, 5], '#6b327c', 'smooth');
    B(S, 'Финиш', [0, 11.5, z - 21], [6, .4, 6], '#f5cd30', 'neon', { touch: 'finish' });
    B(S, 'Мостик', [0, 11, z - 18.6], [1.2, .4, 1.4], '#7c5c46', 'wood');
    settings(S, 'obby');
    return { time: 13 };
  } };
  T['m-race'] = { name: 'Гонка по кругу', icon: '🏎️', build(S){
    B(S, 'Трава', [0, -.6, 0], [120, 1, 80], '#4b974b', 'grass');
    const w = 10, L = 80, Wd = 46;   // трасса — прямоугольник с углами
    B(S, 'Прямая 1', [0, -.05, -Wd / 2], [L, .1, w], '#3a3d48', 'asphalt'); B(S, 'Прямая 2', [0, -.05, Wd / 2], [L, .1, w], '#3a3d48', 'asphalt');
    B(S, 'Поворот 1', [-L / 2, -.05, 0], [w, .1, Wd + w], '#3a3d48', 'asphalt'); B(S, 'Поворот 2', [L / 2, -.05, 0], [w, .1, Wd + w], '#3a3d48', 'asphalt');
    for (const [x, z] of [[-L / 2 - 6, 0], [L / 2 + 6, 0]]) B(S, 'Отбойник', [x, .6, z], [1, 1.2, Wd + 22], '#c4281c', 'plastic');
    for (const z of [-Wd / 2 - 6, Wd / 2 + 6]) B(S, 'Отбойник', [0, .6, z], [L + 12, 1.2, 1], '#f2f3f3', 'plastic');
    S.add('Spawn', { name: 'Старт', pos: [-6, .2, Wd / 2], size: [5, .4, 8], rot: [0, 90, 0] });   // лицом вдоль трассы (+X)
    B(S, 'Финиш', [0, 2.5, Wd / 2], [.6, 5, w], '#f5cd30', 'neon', { alpha: .45, collide: false, shadow: false, touch: 'finish' });
    B(S, 'Чекпоинт 1', [L / 2, 2.5, 0], [w, 5, .6], '#22c55e', 'neon', { alpha: .55, collide: false, shadow: false, touch: 'check', order: 1 });
    B(S, 'Чекпоинт 2', [0, 2.5, -Wd / 2], [.6, 5, w], '#22c55e', 'neon', { alpha: .55, collide: false, shadow: false, touch: 'check', order: 2 });
    B(S, 'Чекпоинт 3', [-L / 2, 2.5, 0], [w, 5, .6], '#22c55e', 'neon', { alpha: .55, collide: false, shadow: false, touch: 'check', order: 3 });
    for (const [x, z, sx, sz] of [[0, -18, 70, .6], [0, 18, 70, .6], [-35, 0, .6, 36], [35, 0, .6, 36]]) B(S, 'Бортик', [x, 1.5, z], [sx, 3, sz], '#f2f3f3', 'plastic');   // не срезать через поле
    B(S, 'Ускоритель', [20, .02, Wd / 2], [6, .1, 6], '#38bdf8', 'neon', { touch: 'speed' });
    B(S, 'Ускоритель', [-20, .02, -Wd / 2], [6, .1, 6], '#38bdf8', 'neon', { touch: 'speed' });
    settings(S, 'race');
    return { time: 15 };
  } };
  T['m-ffa'] = { name: 'Арена: каждый сам за себя', icon: '⚔️', build(S){
    B(S, 'Арена', [0, -.5, 0], [44, 1, 44], '#a3a2a5', 'concrete');
    for (const [x, z, sx, sz] of [[0, -22, 44, 1], [0, 22, 44, 1], [-22, 0, 1, 44], [22, 0, 1, 44]]) B(S, 'Стена', [x, 2, z], [sx, 4, sz], '#635f62', 'brick');
    for (const [x, z] of [[-8, -8], [8, 8], [-8, 8], [8, -8]]) B(S, 'Укрытие', [x, 1, z], [4, 2, 1], '#7c5c46', 'wood');
    B(S, 'Центр', [0, .5, 0], [6, 1, 6], '#da8541', 'cobble');
    for (const [x, z, n] of [[-17, -17, 1], [17, 17, 2], [-17, 17, 3], [17, -17, 4]]) S.add('Spawn', { name: 'Спавн ' + n, pos: [x, .2, z], size: [4, .4, 4], rot: [0, +(Math.atan2(-x, -z) / DEG).toFixed(1), 0] });   // лицом к центру
    settings(S, 'ffa', 'shoulder');
    return { time: 16 };
  } };
  T['m-teams'] = { name: 'Красные против синих', icon: '🛡️', build(S){
    B(S, 'Поле', [0, -.5, 0], [70, 1, 34], '#4b974b', 'grass');
    B(S, 'База красных', [-30, .1, 0], [10, .2, 34], '#ef4444', 'plastic'); B(S, 'База синих', [30, .1, 0], [10, .2, 34], '#3b82f6', 'plastic');
    for (const [x, z] of [[-12, -6], [-12, 8], [0, 0], [12, 6], [12, -8], [0, -12], [0, 12]]) B(S, 'Укрытие', [x, 1.2, z], [2, 2.4, 5], '#a3a2a5', 'concrete');
    for (const z of [-17.5, 17.5]) B(S, 'Забор', [0, 1, z], [70, 2, 1], '#7c5c46', 'wood');
    S.add('Spawn', { name: 'Точка: Красные', pos: [-31, .4, -6], team: 1, color: '#ef4444', rot: [0, 90, 0] }); S.add('Spawn', { name: 'Точка: Красные', pos: [-31, .4, 6], team: 1, color: '#ef4444', rot: [0, 90, 0] });
    S.add('Spawn', { name: 'Точка: Синие', pos: [31, .4, -6], team: 2, color: '#3b82f6', rot: [0, -90, 0] }); S.add('Spawn', { name: 'Точка: Синие', pos: [31, .4, 6], team: 2, color: '#3b82f6', rot: [0, -90, 0] });
    settings(S, 'teams');
    return { time: 15 };
  } };
  T['m-koth'] = { name: 'Царь горы', icon: '👑', build(S){
    B(S, 'Земля', [0, -.5, 0], [60, 1, 60], '#a4bd47', 'grass');
    [[24, 0], [18, 1], [12, 2], [7, 3]].forEach(([s, i]) => B(S, 'Ступень ' + (i + 1), [0, i + .5, 0], [s, 1, s], ['#d7c59a', '#cc8e69', '#da8541', '#c4281c'][i], 'rock'));
    B(S, 'Зона холма', [0, 4.15, 0], [7, .3, 7], '#22c55e', 'neon', { alpha: .5, collide: false, shadow: false, touch: 'hill' });
    for (const [x, z, n] of [[-24, 0, 1], [24, 0, 2], [0, -24, 3], [0, 24, 4]]) S.add('Spawn', { name: 'Спавн ' + n, pos: [x, .2, z], size: [5, .4, 5], rot: [0, +(Math.atan2(-x, -z) / DEG).toFixed(1), 0] });   // лицом к холму
    settings(S, 'koth');
    return { time: 12 };
  } };
  T['m-hide'] = { name: 'Прятки в городке', icon: '🙈', build(S){
    B(S, 'Земля', [0, -.5, 0], [70, 1, 70], '#4b974b', 'grass');
    S.add('Spawn', { name: 'Площадь', pos: [0, .2, 0], size: [8, .4, 8] });
    const house = (x, z, c) => { const m = S.add('Model', { name: 'Домик' }); B(S, 'Стена', [x, 2, z - 4], [8, 4, .5], c, 'brick', {}, m); B(S, 'Стена', [x - 4, 2, z], [.5, 4, 8], c, 'brick', {}, m); B(S, 'Стена', [x + 4, 2, z], [.5, 4, 8], c, 'brick', {}, m); B(S, 'Стена', [x - 2.6, 2, z + 4], [2.8, 4, .5], c, 'brick', {}, m); B(S, 'Стена', [x + 2.6, 2, z + 4], [2.8, 4, .5], c, 'brick', {}, m); B(S, 'Крыша', [x, 4.25, z], [8.6, .5, 8.6], '#7c5c46', 'wood', {}, m); };
    house(-18, -16, '#c4281c'); house(18, -16, '#0d69ac'); house(-18, 18, '#f5cd30'); house(18, 18, '#4b974b');
    for (const [x, z] of [[-6, -26], [6, 26], [26, 2], [-26, -2], [10, -8], [-10, 8]]) S.add('Prefab', { kind: 'tree', pos: [x, 0, z] });
    for (const [x, z] of [[-4, -12], [4, 12], [14, 0], [-14, 0], [0, -20], [0, 20]]) S.add('Prefab', { kind: 'bush', pos: [x, 0, z] });
    for (const [x, z] of [[8, -2], [-8, 2], [22, -28], [-22, 28]]) B(S, 'Ящик', [x, .75, z], [1.5, 1.5, 1.5], '#da8541', 'wood');
    settings(S, 'hide');
    return { time: 17 };
  } };
  T['m-coins'] = { name: 'Сбор монет (вид сверху)', icon: '💰', build(S){
    B(S, 'Поле', [0, -.5, 0], [60, 1, 60], '#a4bd47', 'grass');
    S.add('Spawn', { name: 'Старт', pos: [0, .2, 0] });
    const coin = (x, y, z) => B(S, 'Монетка', [x, y, z], [.3, 1.2, 1.2], '#f5cd30', 'metal', { shape: 'cyl', rot: [0, 0, 90], collide: false, touch: 'coin' });
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; coin(+(Math.cos(a) * 10).toFixed(2), 1, +(Math.sin(a) * 10).toFixed(2)); }
    for (let i = 0; i < 8; i++) coin(-24 + i * 2.2, 1, -20);
    for (const [x, z, h] of [[18, 14, 2], [-16, 16, 3.5], [20, -14, 5]]) { B(S, 'Платформа', [x, h / 2, z], [5, h, 5], '#6e99ca', 'smooth'); coin(x, h + 1, z); coin(x + 1.5, h + 1, z); }
    for (const [x, z] of [[-24, 24], [24, -24], [-24, -6], [6, 24]]) S.add('Prefab', { kind: 'tree', pos: [x, 0, z] });
    B(S, 'Батут', [-16, .25, 10], [3, .5, 3], '#ff66cc', 'smooth', { touch: 'bounce' });
    settings(S, 'coins', { mode: 'top', dist: 24, angle: 58 });
    return { time: 11 };
  } };
  T['m-survival'] = { name: 'Выживание: ночь зомби', icon: '🧟', build(S){
    B(S, 'Двор', [0, -.5, 0], [56, 1, 56], '#635f62', 'dirt');
    for (const [x, z, sx, sz] of [[0, -28, 56, 1], [0, 28, 56, 1], [-28, 0, 1, 56], [28, 0, 1, 56]]) B(S, 'Забор', [x, 1.5, z], [sx, 3, sz], '#7c5c46', 'wood');
    // укрытие без крыши (камера сверху-сбоку не должна терять игрока): низкие стенки и ящики
    for (const [x, z, sx, sz] of [[0, -5, 10, .6], [-5, 0, .6, 10], [5, 2.5, .6, 5]]) B(S, 'Стенка', [x, .6, z], [sx, 1.2, sz], '#7c5c46', 'wood');
    for (const [x, z] of [[-12, 8], [10, -10], [14, 12], [-14, -12]]) B(S, 'Ящик', [x, .75, z], [1.5, 1.5, 1.5], '#da8541', 'wood');
    S.add('Spawn', { name: 'Убежище', pos: [0, .2, 0], size: [6, .4, 6] });
    for (const [x, z] of [[-22, -22], [22, 22], [-22, 22], [22, -22]]) B(S, 'Зона зомби', [x, .05, z], [6, .2, 6], '#ef4444', 'neon', { alpha: .6, collide: false, shadow: false, touch: 'zspawn' });
    S.add('Light', { name: 'Фонарь', pos: [0, 6, 0], color: '#ffd9a0', range: 30, power: 3 });
    S.add('Effect', { name: 'Туман', kind: 'smoke', pos: [0, .5, -18], rate: .6, scale: 2 });
    settings(S, 'survival', { mode: 'iso', dist: 36 });
    return { time: 21.5, ambient: 1.25, fogEnd: 220 };
  } };
  T['m-side'] = { name: 'Платформер сбоку (2D)', icon: '🎮', build(S){
    B(S, 'Пол', [-6, -.5, 0], [30, 1, 6], '#4b974b', 'grass');
    S.add('Spawn', { name: 'Старт', pos: [-16, .2, 0], size: [4, .4, 4], rot: [0, 90, 0] });
    const steps = [[2, 1.2, 4], [7, 2.4, 3], [12, 3.6, 3], [17, 2.4, 3], [22, 3.8, 2.5], [27, 5.2, 2.5], [33, 4, 4]];
    steps.forEach(([x, y, w], i) => B(S, 'Платформа ' + (i + 1), [x, y, 0], [w, .6, 4], ['#0d69ac', '#6b327c', '#da8541'][i % 3], 'smooth'));
    B(S, 'Лава', [16, .05, 0], [30, .2, 6], '#ff4b1f', 'neon', { touch: 'kill' });
    B(S, 'Батут', [38, .25, 0], [3, .5, 4], '#ff66cc', 'smooth', { touch: 'bounce' });
    B(S, 'Пол 2', [44, -.5, 0], [10, 1, 6], '#4b974b', 'grass');
    B(S, 'Высокая', [44, 6, 0], [4, .6, 4], '#f5cd30', 'smooth');
    B(S, 'Финиш', [50, .2, 0], [4, .4, 4], '#f5cd30', 'neon', { touch: 'finish' });
    for (let i = 0; i < 6; i++) B(S, 'Монетка', [3 + i * 5.5, 5 + (i % 2), 0], [.3, 1.2, 1.2], '#f5cd30', 'metal', { shape: 'cyl', rot: [0, 0, 90], collide: false, touch: 'coin' });
    settings(S, 'obby', { mode: 'side', dist: 18 });
    return { time: 15 };
  } };
  T['m-cams'] = { name: 'Дом с камерами (как в ужастиках)', icon: '📹', build(S){
    B(S, 'Пол', [0, -.5, 0], [40, 1, 24], '#7c5c46', 'planks');
    for (const [x, z, sx, sz] of [[0, -12, 40, .6], [0, 12, 40, .6], [-20, 0, .6, 24], [20, 0, .6, 24]]) B(S, 'Стена', [x, 2.5, z], [sx, 5, sz], '#d7c59a', 'concrete');
    B(S, 'Перегородка', [0, 2.5, -7], [.6, 5, 10], '#d7c59a', 'concrete'); B(S, 'Перегородка', [0, 2.5, 7], [.6, 5, 10], '#d7c59a', 'concrete');
    S.add('Spawn', { name: 'Старт', pos: [-14, .2, 0], size: [4, .4, 4] });
    const cam = (name, pos, rot, zone) => { const c = S.add('Camera', { name, pos, rot, fov: 60, kind: 'fixed' }); B(S, 'Зона камеры', zone[0], zone[1], '#f472b6', 'neon', { alpha: 1, collide: false, shadow: false }, c); };
    cam('Камера: комната 1', [-19, 4.5, 11], [-20, -39, 0], [[-10, 3, 0], [19, 6, 23]]);   // из угла — на середину комнаты
    cam('Камера: комната 2', [19, 4.5, -11], [-20, 141, 0], [[10, 3, 0], [19, 6, 23]]);
    S.add('Light', { name: 'Лампа', pos: [-10, 4.5, 0], color: '#fff1c4', range: 22, power: 2.6 }); S.add('Light', { name: 'Лампа', pos: [10, 4.5, 0], color: '#ffd9a0', range: 22, power: 2.6 });
    for (const [x, z] of [[-14, -8], [-6, 8], [8, -8], [15, 8], [6, 2]]) B(S, 'Монетка', [x, 1, z], [.3, 1.2, 1.2], '#f5cd30', 'metal', { shape: 'cyl', rot: [0, 0, 90], collide: false, touch: 'coin' });
    B(S, 'Финиш', [16, .2, 0], [3, .4, 3], '#f5cd30', 'neon', { touch: 'finish' });
    settings(S, 'obby', { mode: 'fixed' });
    return { time: 20, ambient: .8 };
  } };
  E.studioTemplates = Object.assign(E.studioTemplates || {}, T);

  // весь мир в кадре: камера редактора по диагонали сверху на коробку всех объектов
  function frameAll(){
    const e = ed(); if (!e?.SC) return;
    const T3 = e.R.T, b = new T3.Box3();
    for (const o of e.SC.all()) if (o.cls === 'Part' || o.cls === 'Spawn' || o.cls === 'Prefab' || o.cls === 'Model') b.union(e.SC.box(o));
    if (b.isEmpty()) return;
    const c = b.getCenter(new T3.Vector3()), s = b.getSize(new T3.Vector3()), r = Math.max(12, Math.min(160, Math.hypot(s.x, s.z) * .62 + s.y)), yaw = .7, pitch = .62;
    Object.assign(e.cam, { yaw, pitch, x: c.x + Math.sin(yaw) * Math.cos(pitch) * r, y: c.y + Math.sin(pitch) * r, z: c.z + Math.cos(yaw) * Math.cos(pitch) * r });
  }
  S3X.frameAll = frameAll;

  // ═══ Подключение к студии ═══
  const ICONS ={ check: '🚩', hill: '🟩', zspawn: '🟥', finish: '🏁', coin: '💰' };
  const TOUCH_MORE = [['check', '🚩 Чекпоинт гонки'], ['hill', '🟩 Зона «Царя горы»'], ['zspawn', '🟥 Здесь появляются зомби']];
  E.studioExt = E.studioExt || [];
  E.studioExt.push({
    id: 'modes',
    mount(a){
      api = a; const e = a.ed; if (!e || e.player) return;
      const b = document.createElement('button'); b.type = 'button'; b.dataset.a = 's3g:panel'; b.className = 's3x-modebtn';
      b.title = 'Режим игры и ракурс камеры: обби, гонка, бои, команды, прятки… — без кода'; b.setAttribute('aria-label', 'Режим игры');
      b.innerHTML = '🎮<span> Режим</span>';
      a.slot?.prepend(b);
    },
    unmount(){ api = null; },
    act(a){
      if (a === 's3g:panel') { if (E.s3ui?.sheetOpen('mode')) E.s3ui.closeSheet(); else openPanel(); return true; }
      if (a === 's3g:help') { help(); return true; }
      if (a === 's3g:camfromview') { const o = ed().sel; if (o?.cls !== 'Camera') return true; api.pushHist(); const c = ed().cam; SC().set(o, 'pos', [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)]); SC().set(o, 'rot', [+(-c.pitch / DEG).toFixed(1), +((c.yaw / DEG) % 360).toFixed(1), 0]); core().updateGizmo(); core().renderProps(); api.markDirty(); api.msg('📷 Камера смотрит, как ты сейчас', true); return true; }
      if (a === 's3g:camview') { const o = ed().sel; if (o?.cls !== 'Camera') return true; Object.assign(ed().cam, { x: o.pos[0], y: o.pos[1], z: o.pos[2], pitch: -(o.rot?.[0] || 0) * DEG, yaw: (o.rot?.[1] || 0) * DEG }); api.msg('👁 Так видит камера (сдвинься — вид как обычно)', true); return true; }
      if (a === 's3g:camzone') { const o = ed().sel; if (o?.cls !== 'Camera') return true; api.pushHist(); const z = SC().add('Part', { name: 'Зона камеры', pos: [o.pos[0], Math.max(3, o.pos[1] - 2), o.pos[2] - 10], size: [12, 6, 12], color: '#f472b6', mat: 'neon', alpha: 1, collide: false, shadow: false }, o); core().renderTree(); api.select(z); api.markDirty(); return true; }
      return false;
    },
    menu(a){
      // новый мир из заготовки — камеру редактора сверху-сбоку на весь мир (когда студия его построит)
      if (a.startsWith('new:m-')) { const was = ed()?.placeId; let n = 0; const t = setInterval(() => { const e = ed(); if (!e || ++n > 30) { clearInterval(t); return; } if (e.placeId !== was) { clearInterval(t); frameAll(); } }, 100); return false; }
      if (!a.startsWith('s3g:')) return false; addItem(a.slice(4)); return true;
    },
    menuHtml(html, kind){
      if (kind === 'part') return html + '<div class="s3-mh">🎮 Для игры (режимы без кода)</div>' + ITEMS.map(([k, i, n]) => `<button type="button" data-m="s3g:${k}">${i} ${n}</button>`).join('');
      if (kind === 'file') return html + '<div class="s3-mh">🎮 Режимы игры — готовые миры</div>' + Object.entries(T).map(([k, t]) => `<button type="button" data-m="new:${k}">${t.icon} ${esc(t.name)}</button>`).join('');
      return html;
    },
    // свойства: команда у точки появления, номер чекпоинта, новые «касания», камера
    propsHtml(h, o){
      if (!o) { const g = SC()?.settings?.game, D = g && MD().MODES[g.mode], cm = SC()?.settings?.camera; return h + `<p class="s3-note">🎮 Режим игры: <b>${D ? D.icon + ' ' + esc(D.name) : 'нет — просто мир'}</b>${cm ? ` · 🎥 ${esc(VW().MODES.find(m => m[0] === cm.mode)?.[1] || '')}` : ''}</p><button type="button" data-a="s3g:panel">🎮 Режим игры и ракурс…</button>`; }
      let x = '';
      if (o.cls === 'Spawn') x += `<label class="s3-lbl">Команда (режим «Команды»)<select data-p="team" data-num>${[0, 1, 2, 3, 4].map(t => `<option value="${t}"${(o.team | 0) === t ? ' selected' : ''}>${t ? MD().TEAMS[t][0] + ' ' + MD().TEAMS[t][1] : 'Для всех'}</option>`).join('')}</select></label>`;
      if (o.cls === 'Part' && o.touch === 'check') x += `<label class="s3-lbl">Номер чекпоинта (проезжать по порядку)<input type="number" min="0" max="99" step="1" value="${o.order | 0}" data-p="order"></label>`;
      if (o.cls === 'Camera') {
        const v3 = (k, lbl) => `<div class="s3-lbl">${lbl}</div><div class="s3-v3">${[0, 1, 2].map(i => `<label>${'XYZ'[i]}<input type="number" step="${k === 'rot' ? 5 : .5}" value="${+(+o[k][i]).toFixed(2)}" data-p="${k}:${i}"></label>`).join('')}</div>`;
        x += `<p class="s3-note">🎥 Камера для ракурса «📹 Камеры в мире». Розовые детали внутри неё (в Проводнике) — зоны: игрок в зоне — включается эта камера.</p>`
          + v3('pos', 'Где стоит') + v3('rot', 'Куда смотрит (°)')
          + `<label class="s3-lbl">Угол обзора <b>${esc(o.fov || 50)}</b><input type="range" min="20" max="100" step="1" value="${esc(o.fov || 50)}" data-p="fov"></label>`
          + `<label class="s3-lbl">Как снимает<select data-p="kind"><option value="fixed"${o.kind !== 'track' ? ' selected' : ''}>📌 Смотрит, куда поставили</option><option value="track"${o.kind === 'track' ? ' selected' : ''}>👀 Следит за игроком</option></select></label>`
          + `<div class="s3-grid3"><button type="button" data-a="s3g:camfromview" title="Поставить камеру туда, откуда смотришь сейчас">📷 По виду</button><button type="button" data-a="s3g:camview" title="Посмотреть глазами камеры">👁 Глазами</button><button type="button" data-a="s3g:camzone" title="Добавить зону">➕ Зона</button></div>`;
      }
      h = h.replace(/(<select data-p="touch">[\s\S]*?)(<\/select>)/, (m, a2, b2) => a2 + TOUCH_MORE.map(([k, n]) => `<option value="${k}"${o.touch === k ? ' selected' : ''}>${n}</option>`).join('') + b2);
      return x ? h.replace('<!--s3x-->', () => x) : h;
    },
    icon(ic, o){
      if (o.cls === 'Camera') return '🎥';
      if (o.cls === 'Part' && ICONS[o.touch]) return ICONS[o.touch];
      if (o.cls === 'Spawn' && (o.team | 0)) return MD().TEAMS[o.team | 0]?.[0] || ic;
      if (o.cls === 'Part' && o.parent && SC()?.get(o.parent)?.cls === 'Camera') return '🎦';
      return ic;
    },
  });
  E.s3modes = { _test: { needs: m => needs(m), templates: T } };
})();
