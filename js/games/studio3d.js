// ═══════════════════════════════════════
//  «СТУДИЯ 3D» (#/games/studio3d) — свой 3D-мир как в Roblox Studio: детали и готовые предметы, стрелки «двигать /
//  размер / вращать» с привязкой к сетке, материалы и цвета, ландшафт кистью, освещение и время суток, скрипты
//  в объектах (JavaScript с именами Roblox, в песочнице), «▶ Играть» — проверить мир своим персонажем, «■ Стоп» — назад
// ═══════════════════════════════════════
// Движок: js/engine/* (scene — объекты, gizmo — стрелки, terrain — ландшафт, script — скрипты, player/camera/… — игра).
// Миры хранятся в браузере (d37_s3_index + d37_s3_<id>), можно выгрузить/загрузить файлом. Окно — поверх всего сайта.
// Управление в редакторе: ПКМ + мышь — осмотреться, WASD/QE — лететь (Shift — быстрее), колесо — вперёд/назад, F — к
// выбранному, Ctrl+Z/Y — отменить/вернуть, Ctrl+D — копия, Delete — удалить, 1–4 — выбор/двигать/размер/вращать.
(() => {
  const PI = Math.PI, DEG = PI / 180;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const AI_LINKS = [['DeepSeek', 'https://chat.deepseek.com/'], ['GigaChat', 'https://giga.chat/'], ['Алиса', 'https://alice.yandex.ru/'], ['ChatGPT', 'https://chatgpt.com/']];
  // палитра как в Roblox (BrickColor)
  const COLORS = ['#f2f3f3', '#a3a2a5', '#635f62', '#1b2a35', '#c4281c', '#ff0000', '#da8541', '#f5cd30', '#ffff00', '#a4bd47', '#4b974b', '#00ff00', '#287f47',
    '#0d69ac', '#00ffff', '#6e99ca', '#b4d2e4', '#6b327c', '#aa00aa', '#ff66cc', '#e8bac8', '#7c5c46', '#cc8e69', '#ffc9c9', '#d7c59a', '#111111'];
  const LOOK_KEYS = 'd37_s3_index';

  // ── Примеры скриптов (как в Roblox: «вставь и поменяй») ──
  const EXAMPLES = [
    ['Монетка: +1 очко и исчезает', `// Положи этот скрипт в деталь-монетку
const coin = script.Parent;
coin.Touched.Connect((hit, player) => {
  if (!player) return;
  player.AddStat('Монеты', 1);
  sound.play('coin');
  coin.Destroy();
});`],
    ['Лава: касание — смерть', `// Положи в красную деталь (материал «Неон»)
script.Parent.Touched.Connect((hit, player) => {
  if (player) player.Humanoid.Health = 0;
});`],
    ['Дверь: [E] открыть / закрыть', `// Положи в деталь-дверь
const door = script.Parent;
const closed = door.Position;
let open = false;
door.Prompt('Открыть дверь').Triggered.Connect(player => {
  open = !open;
  const to = open ? closed.add(new Vector3(0, door.Size.Y, 0)) : closed;
  TweenService.Create(door, { Time: 0.6 }, { Position: to }).Play();
  sound.play(open ? 'door_wood_open' : 'door_wood_close');
});`],
    ['Движущаяся платформа', `// Платформа ездит туда-сюда (игрок едет на ней)
const p = script.Parent;
const tween = TweenService.Create(p, { Time: 3, Reverses: true, RepeatCount: -1, EasingStyle: 'sine' },
  { Position: p.Position.add(new Vector3(0, 0, 12)) });
tween.Play();`],
    ['Крутилка: вращается всегда', `const p = script.Parent;
RunService.Heartbeat.Connect(dt => {
  const r = p.Orientation;
  p.Orientation = new Vector3(r.X, (r.Y + 90 * dt) % 360, r.Z);
});`],
    ['Батут: подкидывает вверх', `script.Parent.Touched.Connect((hit, player) => {
  if (!player) return;
  player.Humanoid.JumpPower = 140;   // прыжок выше
  task.delay(2, () => { player.Humanoid.JumpPower = 50; });
  player.Message('Жми пробел — высокий прыжок!', 2);
});`],
    ['Телепорт к детали «Выход»', `const exit = workspace.FindFirstChild('Выход', true);
script.Parent.Touched.Connect((hit, player) => {
  if (player && exit) player.Teleport(exit.Position.add(new Vector3(0, 3, 0)));
});`],
    ['Кнопка: меняет цвет', `const b = script.Parent;
b.Prompt('Нажать').Triggered.Connect(() => {
  b.Color = Color3.fromHSV(Math.random(), 0.8, 1);
  sound.play('click');
});`],
    ['Финиш: сообщение и таймер', `// Положи в деталь «Финиш». Таймер — сколько секунд от начала
const start = Date.now();
let done = false;
script.Parent.Touched.Connect((hit, player) => {
  if (!player || done) return;
  done = true;
  const s = ((Date.now() - start) / 1000).toFixed(1);
  gui.message('🏁 ' + player.Name + ' прошёл за ' + s + ' с!', 5);
  player.SetStat('Время', s);
  sound.play('coin');
});`],
    ['При входе: приветствие и очки', `// Положи в Workspace (без родителя)
Players.PlayerAdded.Connect(player => {
  player.SetStat('Монеты', 0);
  player.Message('Привет, ' + player.Name + '! Собери все монетки 🪙', 4);
});`],
  ];
  const AI_TASK = `Напиши скрипт для «Студии 3D» сайта dan4ik37 (это как Roblox Studio, но язык — JavaScript).
Скрипт лежит внутри объекта: script.Parent — этот объект. Доступно (имена как в Roblox):
- workspace.FindFirstChild(имя, искатьГлубже), obj.GetChildren(), obj.Destroy(), obj.Clone(), Instance.new('Part' | 'WedgePart' | 'PointLight' | 'Model', родитель)
- свойства деталей: Name, Position, Size, Orientation (Vector3, градусы), Color (Color3.fromRGB(r,g,b) или '#rrggbb'), Material ('plastic','neon','glass','metal','wood','brick','grass','sand','ice'…), Transparency (0–1), CanCollide, Anchored (false — падает), Shape ('block','ball','cyl','wedge')
- события: obj.Touched.Connect((hit, player) => …), obj.TouchEnded, obj.Clicked.Connect(player => …), obj.Prompt('Текст', секундыУдержания).Triggered.Connect(player => …), RunService.Heartbeat.Connect(dt => …), Players.PlayerAdded.Connect(player => …)
- игрок: player.Name, player.Position, player.Humanoid.WalkSpeed (16 обычно), .JumpPower (50), .Health / .MaxHealth (100), .TakeDamage(n), player.Teleport(Vector3), player.SetStat(имя, число) / AddStat / GetStat (таблица очков), player.Message(текст, секунды)
- TweenService.Create(obj, { Time, EasingStyle: 'quad'|'sine'|'linear'|'back'|'bounce', Reverses, RepeatCount (-1 бесконечно), DelayTime }, { Position, Size, Orientation, Color, Transparency }).Play() — плавно
- task.wait(сек) (с await), task.delay(сек, fn), task.spawn(fn), random(a, b), print(...), gui.message(текст, сек), gui.text(ключ, текст), sound.play('coin'|'jump'|'hit'|'click'|'pickup'|'buzz'|'door_wood_open'|'build_wood'|'break')
Нельзя: сеть, document, window, localStorage. Код выполняется сразу (можно await на верхнем уровне).
Задача: `;

  // ── Хранилище миров (в браузере) ──
  const store = {
    index(){ try { return JSON.parse(localStorage.getItem(LOOK_KEYS) || '[]') || []; } catch (e) { return []; } },
    saveIndex(list){ try { localStorage.setItem(LOOK_KEYS, JSON.stringify(list.slice(0, 60))); } catch (e) {} },
    load(id){ try { return JSON.parse(localStorage.getItem('d37_s3_' + id) || 'null'); } catch (e) { return null; } },
    save(id, name, data){
      const s = JSON.stringify(data);
      try { localStorage.setItem('d37_s3_' + id, s); } catch (e) { return { ok: false, why: 'Места в браузере не хватило — выгрузи мир файлом (📁 → Выгрузить)' }; }
      const list = store.index().filter(x => x.id !== id); list.unshift({ id, name, t: Date.now(), n: data.objects?.length || 0 }); store.saveIndex(list);
      return { ok: true, kb: Math.round(s.length / 1024) };
    },
    remove(id){ try { localStorage.removeItem('d37_s3_' + id); } catch (e) {} store.saveIndex(store.index().filter(x => x.id !== id)); },
  };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ── Шаблоны новых миров ──
  function template(SC, TR, kind){
    SC.clear();
    const A = (cls, p, parent) => SC.add(cls, p, parent);
    if (kind === 'empty') {
      TR?.setEnabled(false);
      A('Part', { name: 'Основание', pos: [0, -.5, 0], size: [128, 1, 128], color: '#6b7a8f', mat: 'concrete' });
      A('Spawn', { pos: [0, .2, 0] });
    } else if (kind === 'obby') {
      TR?.setEnabled(false);
      A('Part', { name: 'Основание', pos: [0, -.5, 0], size: [40, 1, 40], color: '#4b974b', mat: 'grass' });
      A('Spawn', { pos: [0, .2, 0] });
      let z = -12;
      const plat = [[0, 2, -4], [3, 3.2, -4], [-2, 4.4, -4.5], [1, 5.4, -5], [-1, 6.6, -4]];
      plat.forEach(([x, y, dz], i) => { z += dz; A('Part', { name: 'Платформа ' + (i + 1), pos: [x, y, z], size: [3, .6, 3], color: COLORS[13 + (i % 3)], mat: 'smooth' }); });
      const lava = A('Part', { name: 'Лава', pos: [0, .05, -22], size: [16, .2, 26], color: '#ff4b1f', mat: 'neon', collide: true });
      A('Script', { name: 'Убивает', code: EXAMPLES[1][1] }, lava);
      const fin = A('Part', { name: 'Финиш', pos: [0, 7.4, z - 5], size: [6, .6, 6], color: '#f5cd30', mat: 'neon' });
      A('Script', { name: 'Финиш', code: EXAMPLES[8][1] }, fin);
      const coin = A('Part', { name: 'Монетка', shape: 'cyl', pos: [3, 4.4, -20], rot: [0, 0, 90], size: [.3, 1.2, 1.2], color: '#f5cd30', mat: 'metal', collide: false });
      A('Script', { name: 'Монетка', code: EXAMPLES[0][1] }, coin);
      A('Script', { name: 'Приветствие', code: EXAMPLES[9][1] });
    } else if (kind === 'island') {
      TR?.setEnabled(true);
      if (TR) { generateHills(TR, 7); TR.setWater(true, .6); }
      A('Spawn', { pos: [0, (TR?.sample(0, 0) || 0) + .2, 0] });
      A('Prefab', { kind: 'tree', pos: [6, TR?.sample(6, 4) || 0, 4] });
      A('Prefab', { kind: 'pine', pos: [-8, TR?.sample(-8, -6) || 0, -6] });
    } else {   // площадка с травой
      TR?.setEnabled(true);
      A('Spawn', { pos: [0, .2, 0] });
      A('Prefab', { kind: 'tree', pos: [10, 0, -6] }); A('Prefab', { kind: 'bench', pos: [-6, 0, 4], rot: [0, 90, 0] }); A('Prefab', { kind: 'lamp', pos: [-4, 0, -4] });
      A('Part', { name: 'Дом-стена', pos: [0, 2, -14], size: [12, 4, 1], color: '#c4281c', mat: 'brick' });
    }
    SC.R.setLighting({ time: 14, brightness: 1, ambient: 1, fogEnd: 360, shadows: true });
  }
  // Холмы: сумма синусов + остров к центру; низины — песок, высоко — снег
  function generateHills(TR, seed){
    const n = TR.n, rnd = window.D37E.rng(seed), waves = Array.from({ length: 6 }, () => [rnd() * 3 + .6, rnd() * 3 + .6, rnd() * 6, rnd() * 6, .5 + rnd()]);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const u = ix / (n - 1) * 2 - 1, v = iz / (n - 1) * 2 - 1, i = iz * n + ix;
      let h = 0; for (const [a, b, p, q, k] of waves) h += Math.sin(u * a * PI + p) * Math.cos(v * b * PI + q) * k;
      const isl = Math.max(0, 1 - Math.hypot(u, v) * 1.15);
      TR.H[i] = h * 2.2 * isl + isl * 7 - 2;
      const w = TR.W.subarray(i * 4, i * 4 + 4);
      const hh = TR.H[i];
      if (hh < 1.4) { w.set([30, 225, 0, 0]); } else if (hh > 9) { w.set([40, 0, 40, 175]); } else w.set([255, 0, 0, 0]);
    }
    TR.dirty = true;
    TR.brush('smooth', 0, 0, TR.size, .001, 1);   // пересчитать сетку (почти без сглаживания)
  }

  // ═══ Экран ═══
  let root = null, api = null, ED = null;

  function mount(el, gapi){
    root = el; api = gapi;
    const E = window.D37E;
    el.innerHTML = `<div class="s3-stub"><b>🧱 Студия 3D</b><p>Редактор открыт поверх сайта. Закрыл — нажми, чтобы вернуться.</p><button type="button" class="ct-start" data-s3="reopen">Открыть редактор</button></div>`;
    el.querySelector('[data-s3="reopen"]').onclick = () => { if (!ED) mount(el, gapi); };
    const box = document.createElement('div');
    box.className = 's3';
    box.innerHTML = `
      <div class="s3-top">
        <button type="button" data-a="exit" title="Выйти из студии">←</button>
        <input class="s3-name" maxlength="40" value="Мой мир" aria-label="Название мира">
        <span class="s3-sep"></span>
        <div class="s3-dd"><button type="button" data-a="menu:file">📁<span> Файл</span></button></div>
        <button type="button" data-a="undo" title="Отменить (Ctrl+Z)">↶</button><button type="button" data-a="redo" title="Вернуть (Ctrl+Y)">↷</button>
        <span class="s3-sep"></span>
        <span class="s3-tools">
          <button type="button" data-tool="select" title="Выбор (1)">🖱<span> Выбор</span></button><button type="button" data-tool="move" title="Двигать (2)">✥<span> Двигать</span></button><button type="button" data-tool="scale" title="Размер (3)">⤢<span> Размер</span></button><button type="button" data-tool="rotate" title="Вращать (4)">⟳<span> Вращать</span></button>
        </span>
        <select class="s3-snap" title="Шаг сетки"><option value="0">Сетка: нет</option><option value="0.25">Сетка 0,25</option><option value="0.5">Сетка 0,5</option><option value="1" selected>Сетка 1</option><option value="2">Сетка 2</option></select>
        <select class="s3-rsnap" title="Шаг поворота"><option value="0">Угол: нет</option><option value="5">5°</option><option value="15" selected>15°</option><option value="45">45°</option><option value="90">90°</option></select>
        <span class="s3-sep"></span>
        <div class="s3-dd"><button type="button" data-a="menu:part">➕<span> Деталь</span></button></div>
        <div class="s3-dd"><button type="button" data-a="menu:prefab">🌳<span> Предметы</span></button></div>
        <button type="button" data-a="add:Script" title="Скрипт в выбранный объект">📜<span> Скрипт</span></button>
        <span class="s3-sep"></span>
        <button type="button" data-panel="terrain" title="Ландшафт">⛰<span> Земля</span></button><button type="button" data-panel="light" title="Освещение">☀<span> Свет</span></button>
        <span class="s3-grow"></span>
        <button type="button" class="s3-play" data-a="play">▶ Играть</button>
      </div>
      <div class="s3-main">
        <div class="s3-left"><div class="s3-ph">🌲 Проводник</div><div class="s3-tree"></div></div>
        <div class="s3-view"><div class="s3-hint"></div><div class="s3-msg" hidden></div></div>
        <div class="s3-right"><div class="s3-ph s3-rtitle">⚙ Свойства</div><div class="s3-props"></div></div>
      </div>
      <div class="s3-bottom"><div class="s3-btabs"><button type="button" data-b="out" class="on">🖨 Вывод</button><button type="button" data-b="code">📜 Скрипт</button><span class="s3-grow"></span><button type="button" data-a="toggleLeft" class="s3-mob">🌲</button><button type="button" data-a="toggleRight" class="s3-mob">⚙</button><button type="button" data-a="toggleBottom" title="Свернуть">▾</button></div>
        <div class="s3-out"></div>
        <div class="s3-code" hidden><div class="s3-codebar"><select class="s3-lang" title="Язык скрипта"></select><select class="s3-ex"><option value="">📚 Примеры…</option></select><button type="button" data-a="compile" class="s3-wasm s3-build" hidden>⚙️ Собрать</button><button type="button" data-a="wasm" class="s3-wasm" hidden>📦 Загрузить .wasm</button><span class="s3-wasminfo"></span><button type="button" data-a="ai">🤖 Задание для ИИ</button><span class="s3-ai" hidden>${AI_LINKS.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n}</a>`).join(' · ')}</span><span class="s3-grow"></span><span class="s3-cname"></span></div><textarea class="s3-ta" spellcheck="false" placeholder="// Код скрипта. script.Parent — объект, в котором лежит скрипт.&#10;// Нажми «📚 Примеры», чтобы вставить готовый."></textarea></div>
      </div>
      <div class="s3-menu" hidden></div>
      <div class="s3-loading">🧱 Загружаем студию…</div>`;
    document.body.appendChild(box);
    document.documentElement.classList.add('s3-open');
    const q = s => box.querySelector(s);
    ED = { box, q, tool: 'move', sel: null, panel: 'props', hist: [], fut: [], placeId: null, dirty: false, keys: new Set(), cam: { x: 18, y: 14, z: 22, yaw: .7, pitch: .45 }, brush: { tool: 'raise', r: 7, s: 1.2, ch: 0 }, out: [], playing: null };
    const st = ED;
    E.load().then(ok => {
      if (ED !== st) return;
      if (!ok || !E.supported?.()) { q('.s3-loading').textContent = 'Нужен браузер с WebGL (3D) — открой на компьютере или в Chrome'; return; }
      try { start(); } catch (e) { console.error(e); q('.s3-loading').textContent = 'Ошибка: ' + (e.message || e); }
    });
  }

  // ═══ Запуск редактора ═══
  function start(){
    const E = window.D37E, ed = ED, q = ed.q, view = q('.s3-view');
    E.lang('js', { examples: EXAMPLES, ai: AI_TASK, placeholder: '// Код скрипта. script.Parent — объект, в котором лежит скрипт.\n// Нажми «📚 Примеры», чтобы вставить готовый.' });
    const R = ed.R = E.renderer(view);
    R.r.domElement.classList.add('s3-gl');
    const ph = ed.ph = new E.Phys({ ground: 0 });
    const TR = ed.TR = E.terrain(R, ph, { size: 192, n: 129 });
    const SC = ed.SC = E.scene(R, ph, { edit: true });
    SC.terrain = TR;
    R.clouds(10, 4);
    // плоская земля, когда ландшафт выключен
    ed.ground = new R.T.Mesh(new R.T.PlaneGeometry(600, 600), R.texMat('s3ground', R.proc('grass'), { tile: 3, flatColor: '#6cbf58' }));
    ed.ground.rotation.x = -PI / 2; ed.ground.receiveShadow = true; ed.ground.position.y = -.01;
    R.worldUV(ed.ground, 3 * E.UNIT); R.scene.add(ed.ground);
    const G = ed.G = E.gizmo(R);
    ed.boxHelper = new R.T.Box3Helper(new R.T.Box3(), new R.T.Color('#38bdf8')); ed.boxHelper.visible = false; ed.boxHelper.renderOrder = 997; ed.boxHelper.material.depthTest = false; ed.boxHelper.material.toneMapped = false; R.scene.add(ed.boxHelper);
    ed.ray = new R.T.Raycaster();
    // мир: последний открытый или новый «площадка»
    const list = store.index();
    const last = list[0] && store.load(list[0].id);
    if (last) openPlace(list[0].id, last); else { template(SC, TR, 'grass'); ed.placeId = newId(); q('.s3-name').value = 'Мой мир'; save(true); }
    SC.on('add', () => markDirty()); SC.on('remove', () => markDirty()); SC.on('change', () => markDirty());
    TR.setEnabled(TR.enabled);
    ed.ground.visible = !TR.enabled;
    wire();
    setTool('move');
    renderTree(); renderProps();
    R.resize();
    ed.ro = new ResizeObserver(() => R.resize()); ed.ro.observe(view);
    ed.loop = E.loop(editStep, editFrame);
    q('.s3-loading').remove();
    hint('ПКМ + мышь — осмотреться, WASD — лететь, колесо — ближе/дальше. ➕ Деталь — добавить, тяни стрелки. ▶ Играть — проверить мир.');
    ed.autosave = setInterval(() => { if (ed.dirty && !ed.playing) save(true); }, 15000);
    // закрыли/обновили вкладку — сохраняем сразу, без сжатия ландшафта
    window.addEventListener('pagehide', ed.onHide = () => {
      if (!ed.dirty || ed.playing || !ed.SC) return;
      const d = ed.SC.toJSON(); d.terrain = ed.TR.toJSONSync(); d.name = ed.q('.s3-name').value.trim() || 'Мой мир'; d.cam = { ...ed.cam };
      store.save(ed.placeId, d.name, d); ed.dirty = false;
    });
  }
  function hint(t){ const h = ED.q('.s3-hint'); h.textContent = t; h.hidden = !t; clearTimeout(ED.hintT); ED.hintT = setTimeout(() => { h.hidden = true; }, 12000); }
  function msg(t, ok){ const m = ED.q('.s3-msg'); m.textContent = t; m.className = 's3-msg' + (ok === false ? ' bad' : ok ? ' ok' : ''); m.hidden = false; clearTimeout(ED.msgT); ED.msgT = setTimeout(() => { m.hidden = true; }, 2600); }
  function print(text, kind){
    const o = ED.q('.s3-out'), d = document.createElement('div');
    d.className = 's3-ol ' + (kind || ''); d.textContent = text;
    o.appendChild(d); while (o.children.length > 200) o.firstChild.remove();
    o.scrollTop = o.scrollHeight;
  }
  function markDirty(){ if (!ED) return; ED.dirty = true; }

  // ── Сохранение ──
  // ed — явно: при выходе из студии ED уже пуст, а мир дописывается после (ландшафт сжимается асинхронно)
  async function snapshot(ed = ED){ const name = ed.q('.s3-name').value.trim() || 'Мой мир', d = ed.SC.toJSON(); d.terrain = await ed.TR.toJSON(); d.name = name; d.cam = { ...ed.cam }; return d; }
  async function save(quiet, ed = ED){
    if (!ed?.SC) return;
    const d = await snapshot(ed);
    const r = store.save(ed.placeId, d.name, d);
    ed.dirty = false;
    if (!quiet && ED === ed) msg(r.ok ? `💾 Сохранено в браузере (${r.kb} КБ)` : r.why, r.ok);
  }
  async function openPlace(id, data){
    const ed = ED;
    ed.placeId = id;
    ed.q('.s3-name').value = data.name || 'Мой мир';
    ed.SC.fromJSON(data);
    if (data.terrain) { const ok = await ed.TR.fromJSON(data.terrain); if (!ok) ed.TR.setEnabled(data.terrain.enabled !== false); } else ed.TR.setEnabled(false);
    if (ed.ground) ed.ground.visible = !ed.TR.enabled;
    if (data.cam) Object.assign(ed.cam, data.cam);
    ed.hist = []; ed.fut = []; select(null); renderTree(); ed.dirty = false;
  }

  // ── История (отменить/вернуть): снимок объектов перед каждым действием ──
  function pushHist(){ const ed = ED; ed.hist.push(JSON.stringify(ed.SC.toJSON().objects)); if (ed.hist.length > 80) ed.hist.shift(); ed.fut = []; }
  function undo(redo){
    const ed = ED, from = redo ? ed.fut : ed.hist, to = redo ? ed.hist : ed.fut;
    if (!from.length) return;
    to.push(JSON.stringify(ed.SC.toJSON().objects));
    const objs = JSON.parse(from.pop()), sel = ed.sel?.id;
    ed.SC.fromJSON({ objects: objs });
    select(sel ? ed.SC.get(sel) : null); renderTree();
  }

  // ── Выбор ──
  function select(obj){
    const ed = ED;
    ed.sel = obj || null;
    updateGizmo();
    renderProps(); highlightTree();
    // скрипт — в редактор кода
    if (obj?.cls === 'Script') showCode(obj);
  }
  function updateGizmo(){
    const ed = ED, o = ed.sel;
    if (!o || o.cls === 'Script' || ed.playing) { ed.G.attach(null); ed.boxHelper.visible = false; return; }
    const SC = ed.SC, box = SC.box(o);
    const center = o.cls === 'Model' ? (() => { const c = box.getCenter(new ed.R.T.Vector3()); return [c.x, c.y, c.z]; })() : o.pos.slice();
    ed.G.attach({ pos: o.cls === 'Model' ? SC.pivot(o) : o.pos, rot: o.rot || [0, 0, 0], size: o.size, center, model: o.cls === 'Model' || o.cls === 'Prefab' || o.cls === 'Light' });
    if (!box.isEmpty()) { ed.boxHelper.box.copy(box); ed.boxHelper.visible = true; } else ed.boxHelper.visible = false;
  }
  function setTool(t){
    const ed = ED; ed.tool = t;
    ed.q('.s3-tools').querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    ed.G.setMode(t === 'select' ? null : t); updateGizmo();
  }

  // ── Вставка ──
  function insertPoint(){
    // перед камерой: куда смотрит центр экрана (деталь, ландшафт) или 14 м вперёд
    const ed = ED, T = ed.R.T, cam = ed.R.camera;
    ed.ray.setFromCamera(new T.Vector2(0, 0), cam);
    const hit = ed.SC.pick(ed.ray);
    const o = ed.ray.ray.origin, d = ed.ray.ray.direction;
    const ph = ed.ph.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 120);
    let p = hit ? hit.point : ph ? new T.Vector3(ph.x, ph.y, ph.z) : o.clone().addScaledVector(d, 14);
    if (!hit && !ph) p.y = ed.ph.groundAt(p.x, p.z);
    const s = ed.G.snap || 1;
    return [Math.round(p.x / s) * s, p.y, Math.round(p.z / s) * s];
  }
  function insert(cls, props = {}){
    const ed = ED, SC = ed.SC;
    pushHist();
    let parent = null;
    if (cls === 'Script') { parent = ed.sel && ed.sel.cls !== 'Script' ? ed.sel : null; let l = 'js'; try { l = localStorage.getItem('d37_s3_lang') || 'js'; } catch (e) {} if (!props.lang && window.D37E.langs[l]) props.lang = l; }
    else {
      const p = insertPoint(), def = SC.DEF[cls];
      const h = cls === 'Part' ? (props.size || def.size)[1] / 2 : cls === 'Spawn' ? def.size[1] / 2 : cls === 'Light' ? 3 : 0;
      props.pos = [p[0], +(p[1] + h).toFixed(3), p[2]];
      if (ed.sel?.cls === 'Model') parent = ed.sel;
    }
    const obj = SC.add(cls, props, parent);
    renderTree(); select(obj);
    if (cls === 'Script') { setBottom('code'); ED.q('.s3-ta').focus(); }
    return obj;
  }
  function duplicate(){
    const ed = ED, o = ed.sel; if (!o) return;
    pushHist();
    const c = ed.SC.clone(o);
    if (c.pos) ed.SC.set(c, 'pos', [c.pos[0] + (ed.G.snap || 1) * 2, c.pos[1], c.pos[2]]);
    else if (c.cls === 'Model') { const pv = ed.SC.pivot(c); ed.SC.set(c, 'pos', [pv[0] + 4, pv[1], pv[2]]); }
    renderTree(); select(c);
  }
  function remove(){ const ed = ED, o = ed.sel; if (!o) return; pushHist(); ed.SC.remove(o); select(null); renderTree(); }

  // ═══ Ввод в редакторе ═══
  function wire(){
    const ed = ED, q = ed.q, box = ed.box, view = q('.s3-view'), canvas = ed.R.r.domElement, T = ed.R.T;
    // кнопки
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-a],[data-tool],[data-panel],[data-b],[data-m]'); if (!b || !box.contains(b)) return;
      if (b.dataset.tool) { setTool(b.dataset.tool); return; }
      if (b.dataset.panel) { setPanel(ed.panel === b.dataset.panel ? 'props' : b.dataset.panel); return; }
      if (b.dataset.b) { setBottom(b.dataset.b); return; }
      if (b.dataset.m) { menuAct(b.dataset.m); return; }
      act(b.dataset.a, b);
    });
    q('.s3-snap').onchange = e => { ed.G.snap = +e.target.value; };
    q('.s3-rsnap').onchange = e => { ed.G.rsnap = +e.target.value; };
    q('.s3-name').onchange = () => markDirty();
    q('.s3-ex').onchange = e => { const i = e.target.value; e.target.value = ''; if (i === '') return; const ex = langOf(ed.codeFor).examples?.[+i]; if (!ex) return; const ta = q('.s3-ta'); if (ta.value.trim() && !confirm('Заменить код примером?')) return; ta.value = ex[1]; codeChanged(); };
    q('.s3-lang').onchange = e => { const o = ed.codeFor && ed.SC.get(ed.codeFor.id); if (o) setLang(o, e.target.value); };
    const ta = q('.s3-ta');
    ta.addEventListener('input', () => codeChanged());
    ta.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); codeChanged(); } e.stopPropagation(); });
    // клавиатура
    ed.kd = e => {
      if (!ED || e.target.closest?.('input,textarea,select,[contenteditable]')) return;
      const k = e.code, ctrl = e.ctrlKey || e.metaKey;
      if (ed.playing) return;
      if (ctrl && k === 'KeyZ') { e.preventDefault(); undo(e.shiftKey); return; }
      if (ctrl && k === 'KeyY') { e.preventDefault(); undo(true); return; }
      if (ctrl && k === 'KeyD') { e.preventDefault(); duplicate(); return; }
      if (ctrl && k === 'KeyS') { e.preventDefault(); save(); return; }
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); remove(); return; }
      if (k === 'Digit1') setTool('select'); else if (k === 'Digit2') setTool('move'); else if (k === 'Digit3') setTool('scale'); else if (k === 'Digit4') setTool('rotate');
      else if (k === 'KeyF') focusSel();
      else if (k === 'Escape') { closeMenu(); select(null); }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) { ed.keys.add(k); e.preventDefault(); }
    };
    ed.ku = e => ed.keys.delete(e.code);
    window.addEventListener('keydown', ed.kd, true); window.addEventListener('keyup', ed.ku, true);
    window.addEventListener('blur', ed.blur = () => ed.keys.clear());
    // мышь и пальцы по 3D-виду
    const ptrs = new Map();
    const rayAt = (x, y) => { const b = canvas.getBoundingClientRect(); ed.ray.setFromCamera(new T.Vector2((x - b.left) / b.width * 2 - 1, -((y - b.top) / b.height) * 2 + 1), ed.R.camera); return ed.ray; };
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => {
      if (ed.playing) return;
      closeMenu();
      try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
      const p = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, btn: e.button, type: e.pointerType, moved: false, mode: null };
      ptrs.set(e.pointerId, p);
      if (ptrs.size === 2) { for (const o of ptrs.values()) o.mode = 'cam2'; return; }
      if (e.button === 2 || e.button === 1) { p.mode = 'look'; return; }
      const ray = rayAt(e.clientX, e.clientY);
      if (ed.panel === 'terrain' && ed.TR.enabled) { p.mode = 'brush'; ed.brushOn = true; ed.brushStart = true; return; }
      if (ed.G.down(ray)) { p.mode = 'gizmo'; pushHist(); return; }
      const hit = ed.SC.pick(ray);
      p.hit = hit;
      p.mode = hit && hit.obj === ed.sel && ed.tool === 'move' && ed.sel.cls !== 'Model' ? 'dragPart' : e.pointerType === 'touch' ? 'look' : 'click';
    });
    canvas.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId);
      const ray = rayAt(e.clientX, e.clientY);
      if (!p) { if (!ed.playing) { ed.G.hover(ray); brushCursor(ray); } return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 5) p.moved = true;
      if (p.mode === 'look' || (p.mode === 'click' && p.moved && p.type === 'mouse' && false)) { ed.cam.yaw -= dx * .005; ed.cam.pitch = Math.max(-1.45, Math.min(1.45, ed.cam.pitch + dy * .005)); return; }
      if (p.mode === 'cam2') {   // два пальца: сдвиг и приближение
        const all = [...ptrs.values()]; if (all.length < 2) return;
        const d = Math.hypot(all[0].x - all[1].x, all[0].y - all[1].y);
        if (ed.pinch) flyMove(0, 0, (d - ed.pinch) * .06);
        ed.pinch = d;
        flyMove(-dx * .02, dy * .02, 0);
        return;
      }
      if (p.mode === 'gizmo') { const r = ed.G.drag(ray); if (r && ed.sel) applyTransform(r); return; }
      if (p.mode === 'brush') { brushCursor(ray); return; }
      if (p.mode === 'dragPart' && p.moved) dragPart(ray, p);
    });
    const up = e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) ed.pinch = 0;
      if (p.mode === 'gizmo') { if (!ed.G.up()) ed.hist.pop(); renderProps(); updateGizmo(); return; }
      if (p.mode === 'brush') { ed.brushOn = false; markDirty(); return; }
      if (p.mode === 'dragPart') { if (p.moved) { renderProps(); updateGizmo(); } else select(p.hit.obj); return; }
      if ((p.mode === 'click' || (p.mode === 'look' && p.type === 'touch')) && !p.moved && e.type === 'pointerup') { select(p.hit ? p.hit.obj : null); renderTree(); }
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', e => { if (ed.playing) return; e.preventDefault(); if (ed.panel === 'terrain' && e.shiftKey) { ed.brush.r = Math.max(2, Math.min(30, ed.brush.r * (e.deltaY > 0 ? .9 : 1.1))); renderProps(); return; } flyMove(0, 0, e.deltaY > 0 ? -2.5 : 2.5); }, { passive: false });
    // тащим деталь по поверхностям (как в Roblox)
    function dragPart(ray, p){
      const o = ed.sel; if (!o?.pos) return;
      if (!p.started) { pushHist(); p.started = true; }
      const meshes = [];
      for (const x of ed.SC.all()) if (x._mesh && x !== o) meshes.push(x._mesh);
      if (ed.TR.enabled) meshes.push(ed.TR.mesh); else meshes.push(ed.ground);
      const hs = ray.intersectObjects(meshes, true);
      const h = hs.find(x => { let n = x.object; while (n && !n.userData.oid && !n.userData.terrain && n !== ed.ground) n = n.parent; return !n || n.userData.oid !== o.id; });
      if (!h) return;
      const nrm = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new T.Vector3(0, 1, 0);
      const bb = ed.SC.box(o), half = bb.isEmpty() ? new T.Vector3(.5, .5, .5) : bb.getSize(new T.Vector3()).multiplyScalar(.5);
      const s = ed.G.snap || 0, sn = v => s ? Math.round(v / s) * s : v;
      let x = sn(h.point.x), y = h.point.y, z = sn(h.point.z);
      const off = o.pos[1] - (bb.isEmpty() ? o.pos[1] : bb.min.y);   // от низа до центра
      if (nrm.y > .6) y = h.point.y + off;
      else { x = h.point.x + nrm.x * half.x; z = h.point.z + nrm.z * half.z; y = Math.max(h.point.y, o.pos[1]); }
      ed.SC.set(o, 'pos', [+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)]);
      updateGizmo();
    }
  }
  function applyTransform(r){
    const ed = ED, o = ed.sel, SC = ed.SC;
    if (o.cls === 'Model') { if (r.pos) { const pv = SC.pivot(o), c = ed.G.target.center; SC.set(o, 'pos', [pv[0] + r.pos[0] - ed.G.target.pos[0], pv[1] + r.pos[1] - ed.G.target.pos[1], pv[2] + r.pos[2] - ed.G.target.pos[2]]); ed.G.target.pos = r.pos; ed.G.target.center = [c[0] + r.pos[0] - ed.G.target.pos[0], c[1], c[2]]; }
      if (r.rot) SC.set(o, 'rot', r.rot); }
    else {
      if (r.size) SC.set(o, 'size', r.size);
      if (r.pos) SC.set(o, 'pos', r.pos);
      if (r.rot && o.rot) SC.set(o, 'rot', o.cls === 'Prefab' || o.cls === 'Light' ? [0, r.rot[1], 0] : r.rot);
    }
    const box = SC.box(o); if (!box.isEmpty()) ed.boxHelper.box.copy(box);
    if (o.pos && o.cls !== 'Model') ed.G.target.center = o.pos.slice();
    ed.G.update();
    throttleProps();
  }
  let propsT = 0;
  function throttleProps(){ clearTimeout(propsT); propsT = setTimeout(renderProps, 120); }

  // ── Камера редактора: полёт ──
  function flyMove(dx, dy, dz){
    const c = ED.cam, fx = -Math.sin(c.yaw) * Math.cos(c.pitch), fy = -Math.sin(c.pitch), fz = -Math.cos(c.yaw) * Math.cos(c.pitch), rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
    c.x += rx * dx + fx * dz; c.y += dy + fy * dz; c.z += rz * dx + fz * dz;
  }
  function focusSel(){
    const ed = ED, o = ed.sel; if (!o) return;
    const b = ed.SC.box(o); if (b.isEmpty()) return;
    const c = b.getCenter(new ed.R.T.Vector3()), r = Math.max(3, b.getSize(new ed.R.T.Vector3()).length());
    const cam = ed.cam, fx = -Math.sin(cam.yaw) * Math.cos(cam.pitch), fy = -Math.sin(cam.pitch), fz = -Math.cos(cam.yaw) * Math.cos(cam.pitch);
    cam.x = c.x - fx * r * 1.4; cam.y = c.y - fy * r * 1.4; cam.z = c.z - fz * r * 1.4;
  }
  function editStep(dt){
    const ed = ED; if (!ed || ed.playing) return;
    const k = ed.keys, sp = (k.has('ShiftLeft') || k.has('ShiftRight') ? 60 : 20) * dt;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0), s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0), u = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    if (f || s || u) flyMove(s * sp, u * sp, f * sp);
    // кисть ландшафта
    if (ed.brushOn && ed.brushPt) {
      const b = ed.brush, opt = { ch: b.ch };
      if (ed.brushStart) { ed.brushTarget = ed.TR.sample(ed.brushPt.x, ed.brushPt.z); ed.brushStart = false; }
      opt.target = ed.brushTarget;
      ed.TR.brush(b.tool, ed.brushPt.x, ed.brushPt.z, b.r, b.s, dt, opt);
    }
  }
  function editFrame(dt){
    const ed = ED; if (!ed || ed.playing) return;
    const c = ed.cam, cam = ed.R.camera;
    cam.position.set(c.x, c.y, c.z);
    cam.rotation.set(-c.pitch, c.yaw, 0, 'YXZ');
    ed.G.update();
    ed.R.update(dt); ed.R.follow(c.x - Math.sin(c.yaw) * 20, c.z - Math.cos(c.yaw) * 20, 0);
    ed.R.render();
  }
  function brushCursor(ray){
    const ed = ED;
    if (ed.panel !== 'terrain' || !ed.TR.enabled) { ed.TR.cursor(null); ed.brushPt = null; return; }
    const o = ray.ray.origin, d = ray.ray.direction, h = ed.ph.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 400, c => !c.data?.part);
    if (!h) { ed.TR.cursor(null); ed.brushPt = null; return; }
    ed.brushPt = { x: h.x, z: h.z };
    ed.TR.cursor(h.x, h.z, ed.brush.r);
  }

  // ═══ Меню ═══
  function openMenu(kind, btn){
    const ed = ED, m = ed.q('.s3-menu'), SC = ed.SC;
    let html = '';
    if (kind === 'part') html = SC.SHAPES.map(([k, n, i]) => `<button type="button" data-m="part:${k}">${i} ${n}</button>`).join('') + '<hr><button type="button" data-m="spawn">📍 Точка появления</button><button type="button" data-m="light">💡 Свет (лампа)</button><button type="button" data-m="model">📦 Модель (группа)</button>';
    else if (kind === 'prefab') html = SC.PREFABS.map(([k, n, i]) => `<button type="button" data-m="prefab:${k}">${i} ${n}</button>`).join('');
    else if (kind === 'file') {
      const list = store.index();
      html = `<button type="button" data-m="save">💾 Сохранить (Ctrl+S)</button><div class="s3-mh">Новый мир</div><button type="button" data-m="new:grass">🌿 Площадка с травой</button><button type="button" data-m="new:empty">⬜ Пустой (основание)</button><button type="button" data-m="new:obby">🏃 Обби (паркур) со скриптами</button><button type="button" data-m="new:island">🏝 Остров (холмы и вода)</button>`
        + (list.length ? `<div class="s3-mh">Мои миры</div>${list.slice(0, 12).map(x => `<div class="s3-mrow"><button type="button" data-m="open:${esc(x.id)}">${x.id === ed.placeId ? '▸ ' : ''}${esc(x.name)} <small>${x.n} об.</small></button><button type="button" data-m="del:${esc(x.id)}" title="Удалить">🗑</button></div>`).join('')}` : '')
        + '<div class="s3-mh">Файл</div><button type="button" data-m="export">⬇ Выгрузить в файл</button><button type="button" data-m="import">⬆ Загрузить из файла</button>';
    }
    m.innerHTML = html;
    const b = btn.getBoundingClientRect(), bb = ed.box.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(bb.width - 230, b.left - bb.left)) + 'px'; m.style.top = (b.bottom - bb.top + 4) + 'px';
    m.hidden = false;
  }
  function closeMenu(){ const m = ED?.q('.s3-menu'); if (m) m.hidden = true; }
  async function menuAct(a){
    const ed = ED; closeMenu();
    const [k, v] = a.split(':');
    if (k === 'part') insert('Part', { shape: v, size: v === 'ball' ? [2, 2, 2] : v === 'cyl' ? [2, 2, 2] : v === 'wedge' ? [4, 2, 4] : [4, 1, 2], name: { block: 'Деталь', ball: 'Шар', cyl: 'Цилиндр', wedge: 'Клин' }[v] });
    else if (k === 'spawn') insert('Spawn');
    else if (k === 'light') insert('Light');
    else if (k === 'model') insert('Model');
    else if (k === 'prefab') insert('Prefab', { kind: v, name: ed.SC.PREFABS.find(p => p[0] === v)?.[1] || 'Предмет' });
    else if (k === 'save') save();
    else if (k === 'new') { if (ed.dirty) await save(true); template(ed.SC, ed.TR, v); ed.placeId = newId(); ed.q('.s3-name').value = { grass: 'Мой мир', empty: 'Пустой мир', obby: 'Моё обби', island: 'Остров' }[v]; ed.ground.visible = !ed.TR.enabled; ed.hist = []; ed.fut = []; select(null); renderTree(); await save(true); msg('Новый мир создан', true); }
    else if (k === 'open') { if (ed.dirty) await save(true); const d = store.load(v); if (d) { await openPlace(v, d); msg('Открыт: ' + (d.name || 'мир'), true); } }
    else if (k === 'del') { if (v === ed.placeId) { msg('Сначала открой другой мир', false); return; } if (confirm('Удалить мир из браузера навсегда?')) { store.remove(v); msg('Удалено'); } }
    else if (k === 'export') { const d = await snapshot(); const blob = new Blob([JSON.stringify(d)], { type: 'application/json' }); const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob); a2.download = (d.name || 'мир').replace(/[^\p{L}\p{N} _-]/gu, '') + '.d37world.json'; a2.click(); setTimeout(() => URL.revokeObjectURL(a2.href), 4000); }
    else if (k === 'import') {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; if (f.size > 8e6) { msg('Файл слишком большой', false); return; } try { const d = JSON.parse(await f.text()); if (!Array.isArray(d.objects)) throw 0; if (ed.dirty) await save(true); await openPlace(newId(), d); await save(true); msg('Мир загружен', true); } catch (e) { msg('Это не файл мира', false); } };
      inp.click();
    }
  }
  function act(a, b){
    const ed = ED;
    if (a.startsWith('menu:')) { const m = ed.q('.s3-menu'); if (!m.hidden && ed.menuFor === a) { closeMenu(); return; } ed.menuFor = a; openMenu(a.slice(5), b); return; }
    if (a === 'exit') { exitStudio(); return; }
    if (a === 'undo') undo(false); else if (a === 'redo') undo(true);
    else if (a === 'add:Script') insert('Script');
    else if (a === 'play') { if (ed.playing) stopPlay(); else startPlay(); }
    else if (a === 'toggleLeft') ed.box.classList.toggle('s3-showL');
    else if (a === 'toggleRight') ed.box.classList.toggle('s3-showR');
    else if (a === 'toggleBottom') ed.box.classList.toggle('s3-minB');
    else if (a === 'ai') { const ta = ed.q('.s3-ta'), L = langOf(ed.codeFor), what = prompt('Что должен делать скрипт? (например: «дверь открывается, когда у игрока 5 монет»)'); if (!what) return; const task = (L.ai || AI_TASK) + what + '\nОтвет — только код скрипта.'; navigator.clipboard?.writeText(task).then(() => { msg('Задание скопировано — вставь в ИИ, а его ответ — сюда', true); ed.q('.s3-ai').hidden = false; }, () => prompt('Скопируй задание:', task)); ta.focus(); }
    else if (a === 'wasm') pickWasm();
    else if (a === 'compile') compileScript();
    else if (a === 'dup') duplicate(); else if (a === 'del') remove(); else if (a === 'focus') focusSel();
    else if (a === 'terrain:gen') { if (!confirm('Создать новые холмы? Текущий ландшафт пропадёт.')) return; generateHills(ed.TR, Math.random() * 1e9 | 0); markDirty(); }
    else if (a === 'terrain:flat') { if (!confirm('Сделать землю ровной?')) return; ed.TR.H.fill(0); for (let i = 0; i < ed.TR.n * ed.TR.n; i++) ed.TR.W.set([255, 0, 0, 0], i * 4); ed.TR.brush('smooth', 0, 0, 1, 0, 0); markDirty(); }
    else if (a.startsWith('time:')) { ed.R.setLighting({ time: +a.slice(5) }); renderProps(); markDirty(); }
    else if (a.startsWith('btool:')) { ed.brush.tool = a.slice(6); renderProps(); }
    else if (a.startsWith('bch:')) { ed.brush.tool = 'paint'; ed.brush.ch = +a.slice(4); renderProps(); }
    else if (a.startsWith('color:')) { if (ed.sel) { pushHist(); ed.SC.set(ed.sel, 'color', a.slice(6)); renderProps(); } }
    else if (a.startsWith('mat:')) { if (ed.sel) { pushHist(); ed.SC.set(ed.sel, 'mat', a.slice(4)); renderProps(); } }
  }
  function setPanel(p){
    const ed = ED; ed.panel = p;
    ed.box.querySelectorAll('[data-panel]').forEach(b => b.classList.toggle('on', b.dataset.panel === p));
    ed.q('.s3-rtitle').textContent = p === 'terrain' ? '⛰ Земля' : p === 'light' ? '☀ Освещение' : '⚙ Свойства';
    if (p !== 'terrain') ed.TR.cursor(null);
    ed.box.classList.add('s3-showR');
    renderProps();
  }
  function setBottom(b){
    const ed = ED;
    ed.box.querySelectorAll('[data-b]').forEach(x => x.classList.toggle('on', x.dataset.b === b));
    ed.q('.s3-out').hidden = b !== 'out'; ed.q('.s3-code').hidden = b !== 'code';
    ed.box.classList.remove('s3-minB');
  }
  const langOf = o => { const L = window.D37E.langs || {}; return L[o?.lang] || L.js; };
  function fillLangUI(obj){
    const ed = ED, q = ed.q, L = langOf(obj), bin = L.kind === 'binary';
    q('.s3-lang').innerHTML = Object.values(window.D37E.langs).map(l => `<option value="${l.id}"${l.id === L.id ? ' selected' : ''}>${l.icon} ${esc(l.label)}</option>`).join('');
    q('.s3-ex').innerHTML = '<option value="">📚 Примеры…</option>' + (L.examples || []).map((e, i) => `<option value="${i}">${esc(e[0])}</option>`).join('');
    q('.s3-wasm:not(.s3-build)').hidden = !bin;
    q('.s3-build').hidden = !(bin && typeof L.compile === 'function');
    q('.s3-wasminfo').textContent = bin ? (obj?.code ? `файл: ${Math.max(1, Math.round(obj.code.length * .75 / 1024))} КБ` : 'файл не загружен') : '';
    const ta = q('.s3-ta');
    ta.placeholder = L.placeholder || (bin ? '// Исходник — для себя и для ИИ. Запускается загруженный файл .wasm' : '// Код скрипта');
    ta.value = (bin ? obj?.src : obj?.code) || '';
  }
  function setLang(o, id){
    const ed = ED, was = langOf(o), L = window.D37E.langs[id]; if (!L || L === was) return;
    pushHist();
    if (L.kind !== was.kind) { if (L.kind === 'binary') { o.src = o.code || ''; o.code = ''; } else { o.code = o.src || ''; delete o.src; } }
    o.lang = id; try { localStorage.setItem('d37_s3_lang', id); } catch (e) {}
    markDirty(); if (ed.codeFor === o) fillLangUI(o); renderTree(); renderProps();
  }
  // .wasm (Rust, C++ и т. п. — собраны у себя на компьютере): проверка заголовка, до 2 МБ, хранится base64 в code
  function pickWasm(){
    const ed = ED, o = ed.codeFor && ed.SC.get(ed.codeFor.id); if (!o) return;
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.wasm,application/wasm';
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      if (f.size > 2e6) { msg('Файл .wasm больше 2 МБ — собери с оптимизацией (release, -O2, strip)', false); return; }
      const u8 = new Uint8Array(await f.arrayBuffer());
      if (u8[0] !== 0 || u8[1] !== 0x61 || u8[2] !== 0x73 || u8[3] !== 0x6d) { msg('Это не WebAssembly (.wasm)', false); return; }
      let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      pushHist(); o.code = btoa(s); markDirty(); fillLangUI(o); msg(`📦 ${f.name} загружен (${Math.round(f.size / 1024)} КБ)`, true);
    };
    inp.click();
  }
  async function compileScript(){
    const ed = ED, o = ed.codeFor && ed.SC.get(ed.codeFor.id), L = langOf(o);
    if (!o || typeof L.compile !== 'function' || ed.building) return;
    clearTimeout(codeT); o.src = ed.q('.s3-ta').value;
    if (!o.src.trim()) { msg('Сначала напиши код', false); return; }
    ed.building = true; const btn = ed.q('.s3-build'); btn.disabled = true;
    print(`⚙️ Сборка «${o.name}» (${L.label})…`, 'sys');
    try {
      const r = await L.compile(o.src, { name: o.name, onStep: t => { btn.textContent = '⚙️ ' + t; } });
      const u8 = r instanceof Uint8Array ? r : r.wasm;
      if (r.log) for (const line of String(r.log).split('\n').filter(Boolean).slice(0, 40)) print(line, 'warn');
      let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      if (ED !== ed || !ed.SC.get(o.id)) return;
      pushHist(); o.code = btoa(s); markDirty();
      print(`✅ Собрано: ${Math.max(1, Math.round(u8.length / 1024))} КБ`, 'sys'); msg('✅ Собрано — жми ▶ Играть', true);
    } catch (e) {
      const log = String(e && (e.log || e.message) || e);
      for (const line of log.split('\n').filter(Boolean).slice(0, 60)) print(line, 'err');
      setBottom('out'); msg('❌ Не собралось — ошибки во «Выводе»', false);
    } finally { ed.building = false; btn.disabled = false; btn.textContent = '⚙️ Собрать'; if (ED === ed && ed.codeFor === o) fillLangUI(o); }
  }
  function showCode(obj){
    const ed = ED;
    ed.codeFor = obj;
    fillLangUI(obj);
    ed.q('.s3-cname').textContent = langOf(obj).icon + ' ' + obj.name;
    setBottom('code');
  }
  let codeT = 0;
  function codeChanged(){
    const ed = ED, o = ed.codeFor;
    if (!o || !ed.SC.get(o.id)) { const s = ed.sel?.cls === 'Script' ? ed.sel : null; if (!s) { msg('Сначала выбери скрипт (📜 Скрипт — новый)', false); return; } ed.codeFor = s; }
    clearTimeout(codeT);
    codeT = setTimeout(() => { if (ed.codeFor) { ed.codeFor[langOf(ed.codeFor).kind === 'binary' ? 'src' : 'code'] = ed.q('.s3-ta').value; markDirty(); } }, 300);
  }

  // ═══ Проводник ═══
  const ICON = o => o.cls === 'Part' ? ({ block: '🟫', ball: '⚪', cyl: '🛢️', wedge: '📐' }[o.shape] || '🟫') : { Spawn: '📍', Light: '💡', Model: '📦', Script: langOf(o).icon, Prefab: (window.D37E.scene.PREFABS.find(p => p[0] === o.kind) || [])[2] || '🌳' }[o.cls] || '❔';
  function renderTree(){
    const ed = ED, SC = ed.SC, tree = ed.q('.s3-tree');
    const rows = [`<div class="s3-row s3-root" data-id="" draggable="false">🌍 Workspace</div>`];
    const walk = (list, depth) => { for (const o of list) { rows.push(`<div class="s3-row${o === ed.sel ? ' sel' : ''}" data-id="${o.id}" draggable="true" style="padding-left:${8 + depth * 14}px">${ICON(o)} ${esc(o.name)}</div>`); walk(SC.children(o), depth + 1); } };
    walk(SC.children(null), 1);
    tree.innerHTML = rows.join('');
    if (!tree.dataset.wired) {
      tree.dataset.wired = 1;
      tree.addEventListener('click', e => { const r = e.target.closest('.s3-row'); if (!r) return; select(r.dataset.id ? ED.SC.get(r.dataset.id) : null); });
      tree.addEventListener('dblclick', e => { const r = e.target.closest('.s3-row'); const o = r?.dataset.id && ED.SC.get(r.dataset.id); if (!o) return; const n = prompt('Имя:', o.name); if (n && n.trim()) { pushHist(); o.name = n.trim().slice(0, 40); markDirty(); renderTree(); renderProps(); } });
      tree.addEventListener('dragstart', e => { const r = e.target.closest('.s3-row'); if (r?.dataset.id) e.dataTransfer.setData('text/plain', r.dataset.id); });
      tree.addEventListener('dragover', e => { if (e.target.closest('.s3-row')) e.preventDefault(); });
      tree.addEventListener('drop', e => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain'), r = e.target.closest('.s3-row'), SC2 = ED.SC, o = SC2.get(id);
        if (!o || !r) return;
        const target = r.dataset.id ? SC2.get(r.dataset.id) : null;
        if (target === o || (target && SC2.isAncestor(o, target))) return;
        pushHist(); SC2.reparent(o, target); renderTree();
      });
    }
  }
  function highlightTree(){ const ed = ED; ed.q('.s3-tree').querySelectorAll('.s3-row').forEach(r => r.classList.toggle('sel', !!ed.sel && r.dataset.id === ed.sel.id)); }

  // ═══ Панель справа: свойства / земля / свет ═══
  function renderProps(){
    const ed = ED; if (!ed?.SC) return;
    const P = ed.q('.s3-props'), o = ed.sel, SC = ed.SC;
    if (ed.panel === 'terrain') {
      const b = ed.brush, TR = ed.TR, mats = [['🌿', 'Трава'], ['🏖️', 'Песок'], ['🪨', 'Камень'], ['❄️', 'Снег']];
      P.innerHTML = `<label class="s3-chk"><input type="checkbox" data-p="t:on"${TR.enabled ? ' checked' : ''}> Ландшафт (холмы, кисти)</label>
        <div class="s3-lbl">Кисть — зажми и води по земле</div>
        <div class="s3-grid2">${[['raise', '⬆ Поднять'], ['lower', '⬇ Опустить'], ['smooth', '〰 Сгладить'], ['flatten', '▬ Выровнять']].map(([k, n]) => `<button type="button" data-a="btool:${k}" class="${b.tool === k ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div class="s3-lbl">🎨 Покрасить</div><div class="s3-grid4">${mats.map(([i, n], k) => `<button type="button" data-a="bch:${k}" class="${b.tool === 'paint' && b.ch === k ? 'on' : ''}" title="${n}">${i}<small>${n}</small></button>`).join('')}</div>
        <label class="s3-lbl">Размер кисти <b>${b.r.toFixed(0)}</b> (Shift + колесо)<input type="range" min="2" max="30" step="1" value="${b.r}" data-p="b:r"></label>
        <label class="s3-lbl">Сила <b>${b.s.toFixed(1)}</b><input type="range" min="0.2" max="4" step="0.1" value="${b.s}" data-p="b:s"></label>
        <label class="s3-chk"><input type="checkbox" data-p="t:water"${TR.water.on ? ' checked' : ''}> 🌊 Вода</label>
        <label class="s3-lbl">Уровень воды <b>${TR.water.level.toFixed(1)}</b><input type="range" min="-10" max="20" step="0.1" value="${TR.water.level}" data-p="t:level"></label>
        <div class="s3-grid2"><button type="button" data-a="terrain:gen">🏝 Холмы</button><button type="button" data-a="terrain:flat">▭ Ровно</button></div>`;
    } else if (ed.panel === 'light') {
      const L = ed.R.lighting;
      P.innerHTML = `<label class="s3-lbl">🕒 Время суток <b>${fmtTime(L.time)}</b><input type="range" min="0" max="24" step="0.1" value="${L.time}" data-p="l:time"></label>
        <div class="s3-grid4"><button type="button" data-a="time:7">🌅</button><button type="button" data-a="time:13">☀</button><button type="button" data-a="time:18.6">🌇</button><button type="button" data-a="time:0">🌙</button></div>
        <label class="s3-lbl">Солнце <b>${(+L.brightness).toFixed(1)}</b><input type="range" min="0" max="2.5" step="0.05" value="${L.brightness}" data-p="l:brightness"></label>
        <label class="s3-lbl">Свет неба <b>${(+L.ambient).toFixed(1)}</b><input type="range" min="0" max="2.5" step="0.05" value="${L.ambient}" data-p="l:ambient"></label>
        <label class="s3-lbl">Туман: видно на <b>${L.fogEnd | 0}</b><input type="range" min="40" max="800" step="10" value="${L.fogEnd}" data-p="l:fogEnd"></label>
        <label class="s3-chk"><input type="checkbox" data-p="l:shadows"${L.shadows !== false ? ' checked' : ''}> Тени</label>
        <p class="s3-note">Ночью включай 💡 Свет (лампы) — они светятся.</p>`;
    } else if (!o) {
      P.innerHTML = `<p class="s3-note">Ничего не выбрано. Нажми на деталь в мире или в Проводнике.<br><br>➕ <b>Деталь</b> — блок, шар, цилиндр, клин.<br>🌳 <b>Предметы</b> — дерево, фонарь, скамейка…<br>📜 <b>Скрипт</b> — оживить деталь.<br>▶ <b>Играть</b> — пройтись по миру.</p>`;
    } else {
      const v3 = (k, lbl, step) => `<div class="s3-lbl">${lbl}</div><div class="s3-v3">${[0, 1, 2].map(i => `<label>${'XYZ'[i]}<input type="number" step="${step}" value="${+(+o[k][i]).toFixed(3)}" data-p="${k}:${i}"></label>`).join('')}</div>`;
      let h = `<label class="s3-lbl">Имя<input type="text" maxlength="40" value="${esc(o.name)}" data-p="name"></label>`;
      if (o.cls === 'Part' || o.cls === 'Spawn') {
        h += `<label class="s3-lbl">Форма<select data-p="shape">${SC.SHAPES.map(([k, n]) => `<option value="${k}"${o.shape === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
        h += v3('pos', 'Позиция', ed.G.snap || .1) + v3('size', 'Размер', ed.G.snap || .1) + v3('rot', 'Поворот (°)', ed.G.rsnap || 1);
        h += `<div class="s3-lbl">Цвет</div><div class="s3-pal">${COLORS.map(c => `<button type="button" data-a="color:${c}" style="background:${c}" class="${o.color === c ? 'on' : ''}" title="${c}"></button>`).join('')}<label class="s3-cpick" title="Свой цвет"><input type="color" value="${o.color}" data-p="color">🎨</label></div>`;
        h += `<div class="s3-lbl">Материал</div><div class="s3-mats">${SC.MATS.map(([k, n, i]) => `<button type="button" data-a="mat:${k}" class="${o.mat === k ? 'on' : ''}" title="${n}">${i}<small>${n}</small></button>`).join('')}</div>`;
        h += `<label class="s3-lbl">Прозрачность <b>${(+o.alpha).toFixed(2)}</b><input type="range" min="0" max="1" step="0.05" value="${o.alpha}" data-p="alpha"></label>`;
        h += `<label class="s3-chk"><input type="checkbox" data-p="collide"${o.collide !== false ? ' checked' : ''}> Сталкивается (CanCollide)</label>
          <label class="s3-chk"><input type="checkbox" data-p="anchored"${o.anchored !== false ? ' checked' : ''}> Закреплена (Anchored) — иначе падает</label>
          <label class="s3-chk"><input type="checkbox" data-p="shadow"${o.shadow !== false ? ' checked' : ''}> Тень</label>`;
      } else if (o.cls === 'Light') {
        h += v3('pos', 'Позиция', ed.G.snap || .1);
        h += `<label class="s3-lbl">Цвет<input type="color" value="${o.color}" data-p="color"></label>
          <label class="s3-lbl">Дальность <b>${o.range}</b><input type="range" min="2" max="60" step="1" value="${o.range}" data-p="range"></label>
          <label class="s3-lbl">Яркость <b>${o.power}</b><input type="range" min="0" max="8" step="0.1" value="${o.power}" data-p="power"></label>`;
      } else if (o.cls === 'Prefab') {
        h += `<label class="s3-lbl">Вид<select data-p="kind">${SC.PREFABS.map(([k, n]) => `<option value="${k}"${o.kind === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
        h += v3('pos', 'Позиция', ed.G.snap || .1);
        h += `<label class="s3-lbl">Поворот (°)<input type="number" step="${ed.G.rsnap || 1}" value="${o.rot[1]}" data-p="rot:1"></label>`;
        if (['tree', 'pine', 'bush', 'rock'].includes(o.kind)) h += `<label class="s3-lbl">Размер <b>${o.scale}</b><input type="range" min="0.4" max="3" step="0.1" value="${o.scale}" data-p="scale"></label>`;
        if (o.kind === 'sign') h += `<label class="s3-lbl">Текст<input type="text" maxlength="40" value="${esc(o.text)}" data-p="text"></label><label class="s3-lbl">Цвет таблички<input type="color" value="${o.color}" data-p="color"></label>`;
      } else if (o.cls === 'Model') {
        h += `<p class="s3-note">Модель — группа. Перетащи детали на неё в Проводнике. Двигай и крути её стрелками целиком.</p>`;
      } else if (o.cls === 'Script') {
        h += `<label class="s3-lbl">Язык<select data-p="lang">${Object.values(window.D37E.langs).map(l => `<option value="${l.id}"${l.id === langOf(o).id ? ' selected' : ''}>${l.icon} ${esc(l.label)}</option>`).join('')}</select></label>`;
        h += `<label class="s3-chk"><input type="checkbox" data-p="enabled"${o.enabled !== false ? ' checked' : ''}> Включён</label><p class="s3-note">Код — внизу во вкладке «📜 Скрипт». Скрипт работает, когда нажмёшь ▶ Играть.</p>`;
      }
      h += `<div class="s3-grid3"><button type="button" data-a="dup">⧉ Копия</button><button type="button" data-a="focus">🎯 К нему</button><button type="button" data-a="del" class="warn">🗑 Удалить</button></div>`;
      P.innerHTML = h;
    }
    if (!P.dataset.wired) {
      P.dataset.wired = 1;
      const onIn = (e, commit) => {
        const el = e.target, key = el.dataset.p; if (!key) return;
        const ed2 = ED, o2 = ed2.sel, SC2 = ed2.SC;
        const val = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? +el.value : el.value;
        if (key.startsWith('b:')) { ed2.brush[key.slice(2)] = val; const b = el.closest('label')?.querySelector('b'); if (b) b.textContent = (+val).toFixed(key === 'b:r' ? 0 : 1); return; }
        if (key.startsWith('l:')) { ed2.R.setLighting({ [key.slice(2)]: val }); const b = el.closest('label')?.querySelector('b'); if (b) b.textContent = key === 'l:time' ? fmtTime(val) : key === 'l:fogEnd' ? (val | 0) : (+val).toFixed(1); markDirty(); return; }
        if (key === 't:on') { ed2.TR.setEnabled(val); ed2.ground.visible = !val; markDirty(); return; }
        if (key === 't:water') { ed2.TR.setWater(val); markDirty(); return; }
        if (key === 't:level') { ed2.TR.setWater(ed2.TR.water.on, val); const b = el.closest('label')?.querySelector('b'); if (b) b.textContent = (+val).toFixed(1); markDirty(); return; }
        if (!o2) return;
        if (key === 'lang') { setLang(o2, val); return; }
        if (!commit && (el.type === 'text' || el.type === 'number')) return;   // текст и числа — по Enter/уходу
        if (!ed2.histOpen) { pushHist(); ed2.histOpen = true; setTimeout(() => { if (ED) ED.histOpen = false; }, 600); }
        if (key.includes(':')) { const [k, i] = key.split(':'); if (!Number.isFinite(val)) return; const arr = o2[k].slice(); arr[+i] = k === 'size' ? Math.max(.05, val) : val; SC2.set(o2, k, arr); }
        else if (key === 'name') { o2.name = String(val).trim().slice(0, 40) || o2.name; renderTree(); }
        else SC2.set(o2, key, val);
        if (el.type === 'range') { const b = el.closest('label')?.querySelector('b'); if (b) b.textContent = (+val).toFixed(key === 'alpha' ? 2 : 1); }
        updateGizmo();
        if (key === 'shape' || key === 'kind' || key === 'enabled') renderProps();
        if (key === 'kind') renderTree();
      };
      P.addEventListener('input', e => onIn(e, false));
      P.addEventListener('change', e => onIn(e, true));
    }
  }
  const fmtTime = t => { const h = Math.floor(t) % 24, m = Math.round((t - Math.floor(t)) * 60); return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

  // ═══ Игра: ▶ Играть / ■ Стоп ═══
  function startPlay(){
    const ed = ED, E = window.D37E, SC = ed.SC, R = ed.R, T = R.T;
    if (ed.playing) return;
    if (ed.dirty) save(true);   // снимок берётся сразу, до первого шага игры
    ed.TR.cursor(null); ed.G.attach(null); ed.boxHelper.visible = false; closeMenu();
    const snap = SC.toJSON().objects;
    // свет-лампочки и невидимые детали — как в игре
    for (const o of SC.all()) { if (o.cls === 'Light' && o._mesh) o._mesh.visible = false; if ((o.alpha || 0) >= .999 && o._mesh) o._mesh.visible = false; }
    const spawn = SC.all().find(o => o.cls === 'Spawn');
    const sp = spawn ? [spawn.pos[0], spawn.pos[1] + spawn.size[1] / 2 + .05, spawn.pos[2]] : [0, ed.ph.groundAt(0, 0) + .05, 0];
    const P = E.player(ed.ph, { x: sp[0], z: sp[2], yaw: 0 });
    P.place(sp[0], sp[1], sp[2], 0);
    const C = E.controls({});
    const I = E.input(R.r.domElement.parentElement, { controls: C, ignore: 'button, input, textarea, select, .e-btn' });
    const X = E.interact(ed.ph, { who: 'me' });
    const A = E.actors(R);
    const look = window.D37Char ? window.D37Char.look() : {};
    A.add('me', look, { x: sp[0], y: sp[1], z: sp[2] });
    const rig = E.cameraRig(R.camera, { yaw: Math.PI, pitch: .42, dist: 10, minD: 2.6, maxD: 24 });
    rig.snap(sp[0], sp[1], sp[2]);
    const unf = rig.follow(P);
    const H = E.ui(R.r.domElement.parentElement, C);
    if (I.touch) H.buttons([{ action: 'crouch', icon: '⬇', label: 'присесть' }, { action: 'interact', icon: '✋', label: 'действие' }, { action: 'jump', icon: '⤒', label: 'прыжок', big: true }]);
    const AU = E.audio();
    P.on('step', e => AU.step(e.floor, e.run, e.x, e.y, e.z)); P.on('jump', e => AU.play('jump', e)); P.on('land', e => AU.play('land', { ...e, vol: .35 + e.k * .65 }));
    const nick = (typeof currentProfile !== 'undefined' && currentProfile?.nick) || window.GameRoom?.nick?.() || 'Игрок';
    // HUD: очки, здоровье, надписи
    const hud = document.createElement('div'); hud.className = 's3-hud';
    hud.innerHTML = '<div class="s3-stats" hidden></div><div class="s3-health"><i></i></div><div class="s3-labels"></div>';
    R.r.domElement.parentElement.appendChild(hud);
    const pl = { P, C, I, X, A, rig, H, AU, hud, snap, sp, stats: {}, labels: {}, health: 100, maxHealth: 100, touching: new Set(), tweens: [], clicks: new Map(), prompts: new Map(), dead: 0, nick, unf };
    ed.playing = pl;
    // скрипты
    pl.SH = E.scripts({
      apply: d => applyCmd(d),
      print: (t, k) => print(t, k),
      error: (s, line, m) => { print(`❌ ${s || 'скрипт'}${line > 0 ? ', строка ' + line : ''}: ${m}`, 'err'); setBottom('out'); },
      hang: () => { print('⛔ Скрипт завис (бесконечный цикл?) — остановлен. Используй await task.wait() в циклах.', 'err'); setBottom('out'); },
    });
    for (const o of SC.all()) if (o.cls === 'Script' && o.enabled !== false && langOf(o).kind === 'binary' && !o.code) print(`⚠️ Скрипт «${o.name}» не собран — ${typeof langOf(o).compile === 'function' ? 'нажми ⚙️ Собрать' : 'загрузи .wasm'}`, 'warn');
    const any = pl.SH.start(SC, [{ id: 'me', name: nick, pos: sp }]);
    if (any) print('▶ Скрипты запущены', 'sys');
    ed.box.classList.add('s3-playing');
    ed.q('.s3-play').textContent = '■ Стоп';
    ed.q('.s3-hint').hidden = true;
    pl.loop = E.loop(playStep, playFrame);
    ed.loop.pause(true);
    msg('▶ Играешь! WASD — идти, Пробел — прыжок, E — действие. ■ Стоп — назад в редактор', true);
  }
  function stopPlay(){
    const ed = ED, pl = ed.playing; if (!pl) return;
    pl.loop.stop(); pl.SH.stop(); pl.unf?.(); pl.I.dispose(); pl.C.dispose(); pl.H.dispose(); pl.A.dispose(); pl.hud.remove();
    ed.playing = null;
    const sel = ed.sel?.id;
    ed.SC.fromJSON({ objects: pl.snap });
    select(sel ? ed.SC.get(sel) : null); renderTree();
    ed.box.classList.remove('s3-playing');
    ed.q('.s3-play').textContent = '▶ Играть';
    ed.loop.pause(false);
    print('■ Остановлено — мир вернулся как был', 'sys');
  }
  // Команды из скриптов — проверяем и применяем
  const SETK = new Set(['name', 'shape', 'pos', 'rot', 'size', 'color', 'mat', 'alpha', 'collide', 'anchored', 'shadow', 'text', 'range', 'power', 'attrs']);
  const okVec = v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) < 5000);
  function cleanProp(k, v, SC){
    if (k === 'pos' || k === 'rot') return okVec(v) ? v : undefined;
    if (k === 'size') return okVec(v) ? v.map(n => Math.max(.05, Math.min(1000, n))) : undefined;
    if (k === 'color') return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined;
    if (k === 'mat') return SC.MATS.some(m => m[0] === v) ? v : undefined;
    if (k === 'shape') return ['block', 'ball', 'cyl', 'wedge'].includes(v) ? v : undefined;
    if (k === 'alpha') return Math.max(0, Math.min(1, +v || 0));
    if (k === 'collide' || k === 'anchored' || k === 'shadow') return !!v;
    if (k === 'name' || k === 'text') return String(v).slice(0, 60);
    if (k === 'range') return Math.max(0, Math.min(100, +v || 0));
    if (k === 'power') return Math.max(0, Math.min(10, +v || 0));
    if (k === 'attrs') return v && typeof v === 'object' && JSON.stringify(v).length < 2000 ? v : undefined;
    return undefined;
  }
  function applyCmd(d){
    const ed = ED, pl = ed?.playing; if (!pl) return;
    const SC = ed.SC;
    pl.cmds = (pl.cmds || 0) + 1; if (pl.cmds > 4000) return;   // не больше 4000 команд за кадр
    if (d.t === 'set') { const o = SC.get(d.id), k = d.k; if (!o || !SETK.has(k)) return; const v = cleanProp(k, d.v, SC); if (v === undefined) return; if (k === 'name' || k === 'attrs') o[k] = v; else SC.set(o, k, v, true); if ((o.alpha || 0) >= .999 && o._mesh) o._mesh.visible = false; }
    else if (d.t === 'new') { if (SC.all().length > 3000 || !['Part', 'Spawn', 'Light', 'Model'].includes(d.cls) || typeof d.id !== 'string') return; const props = {}; for (const [k, v] of Object.entries(d.props || {})) { const c = cleanProp(k, v, SC); if (c !== undefined) props[k] = c; } SC.add(d.cls, props, d.parent ? SC.get(d.parent) : null, d.id.slice(0, 24)); }
    else if (d.t === 'destroy') { const o = SC.get(d.id); if (o) SC.remove(o); }
    else if (d.t === 'parent') { const o = SC.get(d.id); if (o) SC.reparent(o, d.parent ? SC.get(d.parent) : null); }
    else if (d.t === 'clone') {
      const src = SC.get(d.src); if (!src || !d.map || SC.all().length > 3000) return;
      const list = SC.serialize([src, ...SC.descendants(src)]);
      for (const x of list) { const nid = d.map[x.id]; if (typeof nid !== 'string') continue; const par = x.id === src.id ? (src.parent ? SC.get(src.parent) : null) : SC.get(d.map[x.parent]); SC.add(x.cls, x, par, nid.slice(0, 24)); }
    }
    else if (d.t === 'tween') {
      const o = SC.get(d.id); if (!o) return;
      const from = {}, to = {};
      for (const [k, v] of Object.entries(d.goals || {})) { const c = cleanProp(k, v, SC); if (c === undefined || !['pos', 'rot', 'size', 'color', 'alpha'].includes(k)) continue; from[k] = JSON.parse(JSON.stringify(o[k])); to[k] = c; }
      pl.tweens = pl.tweens.filter(t => !(t.o === o && Object.keys(to).some(k => k in t.to)));
      pl.tweens.push({ tid: d.tid, o, from, to, time: Math.max(.01, +d.time || 1), ease: String(d.ease || 'quad'), reverses: !!d.reverses, repeat: d.repeat | 0, t: -(+d.delay || 0), dir: 1 });
    }
    else if (d.t === 'tweenCancel') pl.tweens = pl.tweens.filter(t => t.tid !== d.tid);
    else if (d.t === 'prompt') { const o = SC.get(d.id); if (o) { pl.prompts.set(d.id, { text: String(d.text || 'Нажать'), hold: +d.hold || 0 }); syncItems(); } }
    else if (d.t === 'want' && d.ev === 'clicked') { if (d.on) pl.clicks.set(d.id, true); else pl.clicks.delete(d.id); syncItems(); }
    else if (d.t === 'player') playerCmd(d.cmd, d.v);
    else if (d.t === 'gui') {
      if (d.cmd === 'message') pl.H.toast(String(d.text || ''));
      else if (d.cmd === 'text') { pl.labels[d.key] = String(d.text || ''); drawLabels(); }
      else if (d.cmd === 'clear') { delete pl.labels[d.key]; drawLabels(); }
    }
    else if (d.t === 'sound') { const ok = window.D37E.synth.NAMES.includes(d.name); if (ok) pl.AU.play(d.name, Array.isArray(d.pos) ? { x: d.pos[0], y: d.pos[1], z: d.pos[2] } : {}); }
  }
  // Подсказки «[E] …» и клики у деталей со скриптами
  function syncItems(){
    const pl = ED.playing; if (!pl) return;
    pl.items = pl.items || new Map();
    const want = new Set([...pl.prompts.keys(), ...pl.clicks.keys()]);
    for (const [id, it] of pl.items) if (!want.has(id)) { pl.X.remove(it); pl.items.delete(id); }
    for (const id of want) {
      if (pl.items.has(id)) continue;
      const o = ED.SC.get(id); if (!o?.pos) continue;
      const it = pl.X.add({ x: o.pos[0], y: o.pos[1], z: o.pos[2], r: Math.max(.6, Math.max(...(o.size || [1, 1, 1])) / 2),
        get col(){ return ED?.SC.get(id)?._cols?.[0]; },   // своё тело не считается стеной (после сдвига тело новое)
        get hold(){ return pl.prompts.get(id)?.hold || 0; },
        prompt: () => pl.prompts.get(id)?.text || 'Нажать',
        act: () => { if (pl.prompts.has(id)) pl.SH.event('prompt', { id, player: 'me' }); if (pl.clicks.has(id)) pl.SH.event('clicked', { id, player: 'me' }); } });
      it.oid = id;
      pl.items.set(id, it);
    }
  }
  function playerCmd(cmd, v){
    const pl = ED.playing, P = pl.P, U = window.D37E.UNIT;
    if (cmd === 'walk') { const k = Math.max(0, +v || 0) / 16; P.walk = 4 * U * k; P.runSpeed = 7 * U * k; P.crouchSpeed = 2 * U * k; }
    else if (cmd === 'jump') { const k = Math.max(0, +v || 0) / 50; P.jumpH = 1.2 * U * k * k; P.sync(); }
    else if (cmd === 'health') { pl.health = Math.max(0, Math.min(pl.maxHealth, +v || 0)); if (pl.health <= 0) die(); drawHealth(); }
    else if (cmd === 'maxHealth') { pl.maxHealth = Math.max(1, +v || 100); drawHealth(); }
    else if (cmd === 'teleport' && okVec(v)) P.place(v[0], v[1], v[2]);
    else if (cmd === 'respawn') respawn();
    else if (cmd === 'stat' && v && typeof v.k === 'string') { pl.stats[v.k.slice(0, 20)] = typeof v.v === 'number' ? Math.round(v.v * 100) / 100 : String(v.v).slice(0, 20); drawStats(); }
    else if (cmd === 'message' && v) pl.H.toast(String(v.text || ''));
  }
  function die(){
    const pl = ED.playing; if (!pl || pl.dead) return;
    pl.dead = 1.6; pl.P.enabled = false;
    pl.H.toast('💀 Ты погиб — сейчас вернёшься', false);
    pl.AU.play('hit'); pl.SH.event('died', { player: 'me' });
  }
  function respawn(){
    const pl = ED.playing; if (!pl) return;
    const sp = pl.sp;
    pl.P.place(sp[0], sp[1], sp[2], 0); pl.P.enabled = true; pl.dead = 0;
    pl.health = pl.maxHealth; drawHealth();
    pl.SH.event('respawned', { player: 'me' });
  }
  function drawHealth(){ const pl = ED.playing; if (!pl) return; const i = pl.hud.querySelector('.s3-health i'); i.style.width = (pl.health / pl.maxHealth * 100) + '%'; i.parentElement.classList.toggle('low', pl.health < pl.maxHealth * .35); }
  function drawStats(){ const pl = ED.playing; const box = pl.hud.querySelector('.s3-stats'), e = Object.entries(pl.stats); box.hidden = !e.length; box.innerHTML = `<b>${esc(pl.nick)}</b>` + e.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join(''); }
  function drawLabels(){ const pl = ED.playing; pl.hud.querySelector('.s3-labels').innerHTML = Object.values(pl.labels).map(t => `<div>${esc(t)}</div>`).join(''); }
  const EASE = {
    linear: k => k, quad: k => k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2, sine: k => -(Math.cos(PI * k) - 1) / 2,
    back: k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2; },
    bounce: k => { const n = 7.5625, d = 2.75; if (k < 1 / d) return n * k * k; if (k < 2 / d) return n * (k -= 1.5 / d) * k + .75; if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + .9375; return n * (k -= 2.625 / d) * k + .984375; },
    elastic: k => k === 0 || k === 1 ? k : 2 ** (-10 * k) * Math.sin((k * 10 - .75) * (2 * PI) / 3) + 1,
  };
  const lerpColor = (a, b, k) => { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16), c = s => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k); return '#' + ((1 << 24) + (c(16) << 16) + (c(8) << 8) + c(0)).toString(16).slice(1); };
  function playStep(dt){
    const ed = ED, pl = ed?.playing; if (!pl) return;
    const { P, C, X, rig, SC = ed.SC } = { ...pl, SC: ed.SC };
    pl.cmds = 0;
    C.step(dt);
    if (C.down('pause')) { stopPlay(); return; }
    // едем на движущейся детали
    const on = P.ch.grounded ? P.ch.onCol?.data?.part : null, onObj = on && SC.get(on);
    if (onObj?.pos && pl.onId === on && pl.onPos) { const dx = onObj.pos[0] - pl.onPos[0], dy = onObj.pos[1] - pl.onPos[1], dz = onObj.pos[2] - pl.onPos[2]; if (dx || dy || dz) { P.ch.x += dx; P.ch.y += dy; P.ch.z += dz; } }
    pl.onId = on; pl.onPos = onObj?.pos ? onObj.pos.slice() : null;
    P.update(dt, C, rig);
    X.update(dt, P, C, rig.fwd(), false);
    // касания (Touched / TouchEnded)
    const now = SC.touching(P.ch), SH = pl.SH;
    for (const id of now) if (!pl.touching.has(id) && SH.want.touched.has(id)) SH.event('touched', { id, player: 'me' });
    for (const id of pl.touching) if (!now.has(id) && SH.want.touchEnded.has(id)) SH.event('touchEnded', { id, player: 'me' });
    pl.touching = now;
    // плавные изменения (TweenService)
    for (const tw of pl.tweens.slice()) {
      tw.t += dt; if (tw.t < 0) continue;
      let k = Math.min(1, tw.t / tw.time); const e = (EASE[tw.ease] || EASE.quad)(tw.dir > 0 ? k : 1 - k);
      if (!SC.get(tw.o.id)) { pl.tweens.splice(pl.tweens.indexOf(tw), 1); continue; }
      for (const key of Object.keys(tw.to)) {
        const a = tw.from[key], b = tw.to[key];
        const v = key === 'color' ? lerpColor(a, b, e) : Array.isArray(a) ? a.map((x, i) => x + (b[i] - x) * e) : a + (b - a) * e;
        SC.set(tw.o, key, v, true);
      }
      if (k >= 1) {
        if (tw.reverses && tw.dir > 0) { tw.dir = -1; tw.t = 0; continue; }
        if (tw.repeat !== 0) { if (tw.repeat > 0) tw.repeat--; tw.dir = 1; tw.t = 0; continue; }
        pl.tweens.splice(pl.tweens.indexOf(tw), 1);
        SH.sync(tw.o.id, Object.fromEntries(Object.keys(tw.to).map(k2 => [k2, tw.o[k2]])));
        SH.event('tweenDone', { tid: tw.tid });
      }
    }
    // подсказки едут за своими деталями
    if (pl.items) for (const it of pl.items.values()) { const o = SC.get(it.oid); if (o?.pos) { it.x = o.pos[0]; it.y = o.pos[1]; it.z = o.pos[2]; } }
    SC.step(dt);
    SH.tick(dt, [{ id: 'me', pos: [P.ch.x, P.ch.y, P.ch.z] }]);
    // упал с мира или смерть
    if (P.ch.y < -60) { pl.health = 0; die(); }
    if (pl.dead) { pl.dead -= dt; if (pl.dead <= 0) respawn(); }
  }
  function playFrame(dt){
    const ed = ED, pl = ed?.playing; if (!pl) return;
    const { P, A, rig, I, C, H } = pl, R = ed.R, t = performance.now() / 1000;
    A.pose('me', P.pose());
    rig.update(dt, P, { dx: I.look.dx + C.look.dx, dy: I.look.dy + C.look.dy, zoom: I.zoom }, ed.ph, C);
    A.update(dt, t, R.camera.position);
    pl.AU.listener(R.camera.position.x, R.camera.position.y, R.camera.position.z, rig.yaw);
    // клик/тап по детали со скриптом «Clicked»
    for (const tp of I.taps) { const b = R.r.domElement.getBoundingClientRect(); ed.ray.setFromCamera(new R.T.Vector2((tp.x - b.left) / b.width * 2 - 1, -((tp.y - b.top) / b.height) * 2 + 1), R.camera); const h = ed.SC.pick(ed.ray); if (h && pl.clicks.has(h.obj.id)) pl.SH.event('clicked', { id: h.obj.id, player: 'me' }); }
    I.frameEnd(); C.frameEnd();
    R.update(dt); R.follow(P.ch.x, P.ch.z, P.ch.y);
    R.render();
    H.prompt(I.touch ? (pl.X.raw && pl.X.cur ? '✋ ' + pl.X.raw : null) : pl.X.text, pl.X.progress);
    H.stamina(P.stamina / P.maxStamina, P.exhausted);
  }

  // ═══ Выход ═══
  async function exitStudio(){
    if (ED?.playing) stopPlay();
    if (ED?.dirty) await save(true);
    unmount();
    location.hash = '#/games';
  }
  function unmount(){
    const ed = ED; if (!ed) return;
    ED = null;
    try { if (ed.playing) { const pl = ed.playing; pl.loop.stop(); pl.SH.stop(); pl.I.dispose(); pl.C.dispose(); pl.H.dispose(); pl.A.dispose(); } } catch (e) {}
    if (ed.dirty && ed.SC && !ed.playing) save(true, ed);
    clearInterval(ed.autosave);
    ed.loop?.stop(); ed.ro?.disconnect();
    window.removeEventListener('keydown', ed.kd, true); window.removeEventListener('keyup', ed.ku, true); window.removeEventListener('blur', ed.blur); window.removeEventListener('pagehide', ed.onHide);
    try { ed.SC?.dispose(); ed.TR?.dispose(); ed.G?.dispose(); ed.R?.dispose(); } catch (e) {}
    ed.box.remove();
    document.documentElement.classList.remove('s3-open');
  }

  window.GAME_IMPL = window.GAME_IMPL || {};
  window.GAME_IMPL.studio3d = { mount, unmount, _test: { EXAMPLES, AI_TASK, state: () => ED, template, generateHills } };
})();
