// ═══════════════════════════════════════
//  «СТУДИЯ 3D» (#/games/studio3d) — свой 3D-мир как в Roblox Studio: детали и готовые предметы, стрелки «двигать /
//  размер / вращать» с привязкой к сетке, материалы и цвета, ландшафт кистью, освещение и время суток, скрипты
//  в объектах (JavaScript с именами Roblox, в песочнице), «▶ Играть» — проверить мир своим персонажем, «■ Стоп» — назад
// ═══════════════════════════════════════
// Движок: js/engine/* (scene — объекты, gizmo — стрелки, terrain — ландшафт, script — скрипты, player/camera/… — игра).
// Миры хранятся в браузере (d37_s3_index + d37_s3_<id>), можно выгрузить/загрузить файлом. Окно — поверх всего сайта.
// Свои модели (🧩: .glb/.gltf/.obj, model.js) — «компилируются» при загрузке и лежат только в этом браузере (видно только
// автору); в файл мира они вкладываются целиком.
// «📤 Выложить» (ugc.sql: ugc_games kind 'place' + ugc_models + хранилище ugc3d): мир — по ссылке /g/<id> или в каталог после
// проверки; свои модели уходят на проверку (до одобрения у других — пустая коробка). #/games/studio3d/play/<id> — режим игрока
// (без редактора). Модераторам — «🛡»: модели на проверке (посмотреть, одобрить, заблокировать).
// Управление в редакторе: ПКМ + мышь — осмотреться, WASD/QE — лететь (Shift — быстрее), колесо — вперёд/назад, F — к
// выбранному, Ctrl+Z/Y — отменить/вернуть, Ctrl+D — копия, Delete — удалить, 1–4 — выбор/двигать/размер/вращать.
// Несколько объектов: Ctrl/Shift + клик (стрелки двигают и крутят всё вместе), Ctrl+A — все; Ctrl+C/X/V — копировать/вырезать/
// вставить (и в другой мир), Ctrl+G — сгруппировать в модель, Ctrl+U — разгруппировать. Клик по детали модели выбирает всю
// модель (Alt + клик — саму деталь). 🔒 «Заблокирован» — не выбирается кликом в мире. Поиск по имени — над Проводником.
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
    if (TR) flatTerrain(TR, kind === 'winter' ? 3 : 0);
    const A = (cls, p, parent) => SC.add(cls, p, parent);
    let light = { time: 14, brightness: 1, ambient: 1, fogEnd: 360, shadows: true, cycle: 0 };
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
    } else if (kind === 'camp') {   // ночь, костёр, палатки, светлячки
      TR?.setEnabled(true);
      A('Spawn', { pos: [0, .2, 8] });
      const fire = A('Part', { name: 'Костёр', pos: [0, .25, 0], size: [1.6, .5, 1.6], color: '#4a3426', mat: 'rock' });
      A('Effect', { name: 'Огонь', kind: 'fire' }, fire); A('Effect', { name: 'Дым', kind: 'smoke' }, fire);
      A('Light', { name: 'Свет костра', pos: [0, 1.8, 0], color: '#ff9a3c', range: 20, power: 3.2 });
      for (const [x, z, rot] of [[3.2, 0, [90, 0, 0]], [-3.2, 0, [90, 0, 0]], [0, 3.2, [0, 0, 90]], [0, -3.2, [0, 0, 90]]]) A('Part', { name: 'Бревно', shape: 'cyl', pos: [x, .35, z], rot, size: [.7, 2.6, .7], color: '#7c5c46', mat: 'wood' });
      for (const [x, z, r, c] of [[8, -5, 30, '#e76f51'], [-8, -4, -30, '#2a9d8f']]) {
        const a = r * DEG, dx = Math.sin(a) * .8, dz = Math.cos(a) * .8;
        A('Part', { name: 'Палатка', shape: 'wedge', pos: [x + dx, 1, z + dz], rot: [0, r, 0], size: [3, 2, 1.6], color: c, mat: 'fabric' });
        A('Part', { name: 'Палатка', shape: 'wedge', pos: [x - dx, 1, z - dz], rot: [0, r + 180, 0], size: [3, 2, 1.6], color: c, mat: 'fabric' });
      }
      const rnd = window.D37E.rng(37);
      for (let i = 0; i < 22; i++) { const a = i / 22 * PI * 2 + rnd() * .2, d = 15 + rnd() * 9; A('Prefab', { kind: rnd() < .6 ? 'pine' : 'tree', pos: [Math.cos(a) * d, 0, Math.sin(a) * d], scale: .8 + rnd() * .7 }); }
      A('Effect', { name: 'Светлячки', kind: 'magic', pos: [5, 1.4, 5], rate: .5, scale: .6, color: '#d9ff8a', color2: '#ffe66d' });
      A('Prefab', { kind: 'lamp', pos: [5, 0, 9] });
      A('Script', { name: 'Приветствие', code: "Players.PlayerAdded.Connect(player => {\n  player.Message('Добро пожаловать в лагерь! Посиди у костра 🔥', 4);\n});" });
      light = { time: 21.5, brightness: 1, ambient: 1.3, fogEnd: 240, shadows: true, cycle: 0 };
    } else if (kind === 'winter') {   // снег, ёлки, каток, снеговик
      TR?.setEnabled(true);
      if (TR) { for (const [x, z, r] of [[34, -30, 20], [-38, 24, 24], [40, 36, 18], [-30, -40, 22]]) for (let k = 0; k < 6; k++) TR.brush('raise', x, z, r, .12, 1); TR.brush('smooth', 0, 0, TR.size, .001, 1); }
      A('Spawn', { pos: [0, .2, 0] });
      A('Effect', { name: 'Снегопад', kind: 'snow', pos: [0, 0, 0], scale: 1.5 });
      A('Part', { name: 'Каток', pos: [12, .1, -8], size: [14, .2, 10], color: '#bfe9ff', mat: 'ice' });
      const sm = A('Model', { name: 'Снеговик' });
      for (const [y, s] of [[.9, 1.8], [2.3, 1.3], [3.35, .9]]) A('Part', { name: 'Ком', shape: 'ball', pos: [-6, y, 4], size: [s, s, s], color: '#ffffff', mat: 'snow' }, sm);
      A('Part', { name: 'Нос', shape: 'cyl', pos: [-6, 3.35, 4.6], rot: [90, 0, 0], size: [.18, .5, .18], color: '#ff8c42', mat: 'smooth' }, sm);
      A('Part', { name: 'Шапка', shape: 'cyl', pos: [-6, 3.95, 4], size: [.7, .5, .7], color: '#1b2a35', mat: 'fabric' }, sm);
      const rnd = window.D37E.rng(73);
      for (let i = 0; i < 30; i++) { const a = rnd() * PI * 2, d = 14 + rnd() * 30, x = Math.cos(a) * d, z = Math.sin(a) * d; A('Prefab', { kind: 'pine', pos: [x, TR ? TR.sample(x, z) : 0, z], scale: .8 + rnd() * .9 }); }
      light = { time: 12.5, brightness: 1.1, ambient: 1.15, fogEnd: 260, shadows: true, cycle: 0 };
    } else {   // площадка с травой
      TR?.setEnabled(true);
      A('Spawn', { pos: [0, .2, 0] });
      A('Prefab', { kind: 'tree', pos: [10, 0, -6] }); A('Prefab', { kind: 'bench', pos: [-6, 0, 4], rot: [0, 90, 0] }); A('Prefab', { kind: 'lamp', pos: [-4, 0, -4] });
      A('Part', { name: 'Дом-стена', pos: [0, 2, -14], size: [12, 4, 1], color: '#c4281c', mat: 'brick' });
    }
    SC.R.setLighting(light);
  }
  // ровная земля одного материала (0 трава, 1 песок, 2 камень, 3 снег), без воды
  function flatTerrain(TR, ch){
    TR.H.fill(0);
    for (let i = 0; i < TR.n * TR.n; i++) for (let k = 0; k < 4; k++) TR.W[i * 4 + k] = k === ch ? 255 : 0;
    TR.setWater(false); TR.dirty = ch !== 0;
    TR.brush('smooth', 0, 0, TR.size, 0, 0);   // пересчитать всю сетку
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
        <div class="s3-dd"><button type="button" data-a="menu:models" title="Свои 3D-модели (.glb, .gltf, .obj)">🧩<span> Модели</span></button></div>
        <button type="button" data-a="add:Script" title="Скрипт в выбранный объект">📜<span> Скрипт</span></button>
        <span class="s3-sep"></span>
        <button type="button" data-panel="terrain" title="Ландшафт">⛰<span> Земля</span></button><button type="button" data-panel="light" title="Освещение">☀<span> Свет</span></button>
        <span class="s3-grow"></span>
        <span class="s3-pinfo" hidden></span>
        <div class="s3-dd s3-staff" hidden><button type="button" data-a="menu:mod" title="Модели на проверке">🛡</button></div>
        <button type="button" data-a="publish" class="s3-pubbtn" title="Выложить мир — по ссылке или в каталог">📤<span> Выложить</span></button>
        <button type="button" class="s3-play" data-a="play">▶ Играть</button>
      </div>
      <div class="s3-main">
        <div class="s3-left"><div class="s3-ph">🌲 Проводник<input type="search" class="s3-find" placeholder="🔍 Найти" aria-label="Найти объект"></div><div class="s3-tree"></div></div>
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
    ED = { box, q, tool: 'move', sel: null, panel: 'props', hist: [], fut: [], placeId: null, dirty: false, keys: new Set(), cam: { x: 18, y: 14, z: 22, yaw: .7, pitch: .45 }, brush: { tool: 'raise', r: 7, s: 1.2, ch: 0 }, out: [], playing: null, player: null, pubId: null, remoteAuthors: new Map(), selSet: new Set() };
    const pm = /^play\/([a-z0-9]{4,16})$/i.exec(String(gapi?.param || ''));
    if (pm) { ED.playId = pm[1]; box.classList.add('s3-player'); }
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
    ed.FX = SC.fx = E.fx(R);
    // вода ландшафта: в ней плавают (player.js)
    ph.waterLevel = (x, z) => TR.enabled && TR.water.on && Math.abs(x) < TR.size / 2 && Math.abs(z) < TR.size / 2 ? TR.water.level : -Infinity;
    R.clouds(10, 4);
    // плоская земля, когда ландшафт выключен
    ed.ground = new R.T.Mesh(new R.T.PlaneGeometry(600, 600), R.texMat('s3ground', R.proc('grass'), { tile: 3, flatColor: '#6cbf58' }));
    ed.ground.rotation.x = -PI / 2; ed.ground.receiveShadow = true; ed.ground.position.y = -.01;
    R.worldUV(ed.ground, 3 * E.UNIT); R.scene.add(ed.ground);
    const G = ed.G = E.gizmo(R);
    ed.boxHelper = new R.T.Box3Helper(new R.T.Box3(), new R.T.Color('#38bdf8')); ed.boxHelper.visible = false; ed.boxHelper.renderOrder = 997; ed.boxHelper.material.depthTest = false; ed.boxHelper.material.toneMapped = false; R.scene.add(ed.boxHelper);
    ed.ray = new R.T.Raycaster();
    E.models.remote = fetchRemoteModel;
    // мир: выложенный (режим игрока) или последний свой, или новый «площадка»
    if (ed.playId) openPublished(ed.playId);
    else {
      const list = store.index();
      const last = list[0] && store.load(list[0].id);
      if (last) openPlace(list[0].id, last); else { template(SC, TR, 'grass'); ed.placeId = newId(); q('.s3-name').value = 'Мой мир'; save(true); }
    }
    q('.s3-staff').hidden = !isStaff();
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
    let seen = '1'; try { seen = localStorage.getItem('d37_s3_tut') || ''; } catch (e) {}
    if (!seen && !ed.player) { ed.tut = new Set(); const t = document.createElement('div'); t.className = 's3-tut'; view.appendChild(t); renderTut(); }
    ed.autosave = setInterval(() => { if (ed.dirty && !ed.playing) save(true); }, 15000);
    // закрыли/обновили вкладку — сохраняем сразу, без сжатия ландшафта
    window.addEventListener('pagehide', ed.onHide = () => {
      if (!ed.dirty || ed.playing || !ed.SC) return;
      const d = ed.SC.toJSON(); d.terrain = ed.TR.toJSONSync(); d.name = ed.q('.s3-name').value.trim() || 'Мой мир'; d.cam = { ...ed.cam };
      store.save(ed.placeId, d.name, d); ed.dirty = false;
    });
  }
  const TUT = [['add', '➕ Добавь деталь: «➕ Деталь» → «Блок»'], ['move', '✥ Потяни цветную стрелку — деталь поедет'], ['script', '📜 Оживи её: «📜 Скрипт» → «📚 Примеры»'], ['play', '▶ Нажми «Играть» и пройдись по миру']];
  function tutStep(k){ const ed = ED; if (!ed?.tut || ed.tut.has(k)) return; ed.tut.add(k); renderTut(); }
  function renderTut(){
    const ed = ED, box = ed?.q('.s3-tut'); if (!box || !ed.tut) return;
    if (TUT.every(([k]) => ed.tut.has(k))) { box.remove(); ed.tut = null; try { localStorage.setItem('d37_s3_tut', '1'); } catch (e) {} msg('🎉 Студия освоена! Дальше — 🧩 модели, ✨ эффекты и 📤 Выложить', true); return; }
    box.innerHTML = `<b>🧭 Первые шаги</b>${TUT.map(([k, t]) => `<div class="${ed.tut.has(k) ? 'ok' : ''}">${ed.tut.has(k) ? '✅' : '⬜'} ${t}</div>`).join('')}<button type="button" data-a="tut:x">Скрыть</button>`;
  }
  function hint(t){ const h = ED.q('.s3-hint'); h.textContent = t; h.hidden = !t; clearTimeout(ED.hintT); ED.hintT = setTimeout(() => { h.hidden = true; }, 12000); }
  function msg(t, ok){ const m = ED.q('.s3-msg'); m.textContent = t; m.className = 's3-msg' + (ok === false ? ' bad' : ok ? ' ok' : ''); m.hidden = false; clearTimeout(ED.msgT); ED.msgT = setTimeout(() => { m.hidden = true; }, 2600); }
  function print(text, kind){
    const o = ED.q('.s3-out'), d = document.createElement('div');
    d.className = 's3-ol ' + (kind || ''); d.textContent = text;
    o.appendChild(d); while (o.children.length > 200) o.firstChild.remove();
    o.scrollTop = o.scrollHeight;
  }
  function markDirty(){ if (!ED || ED.player) return; ED.dirty = true; }

  // ── Сохранение ──
  // ed — явно: при выходе из студии ED уже пуст, а мир дописывается после (ландшафт сжимается асинхронно)
  async function snapshot(ed = ED){ const name = ed.q('.s3-name').value.trim() || 'Мой мир', d = ed.SC.toJSON(); d.terrain = await ed.TR.toJSON(); d.name = name; d.cam = { ...ed.cam }; if (ed.pubId) d.pub = ed.pubId; return d; }
  async function save(quiet, ed = ED){
    if (!ed?.SC || ed.player) return;
    const d = await snapshot(ed);
    const r = store.save(ed.placeId, d.name, d);
    ed.dirty = false;
    if (!quiet && ED === ed) msg(r.ok ? `💾 Сохранено в браузере (${r.kb} КБ)` : r.why, r.ok);
  }
  async function openPlace(id, data){
    const ed = ED;
    ed.placeId = id; ed.pubId = typeof data.pub === 'string' ? data.pub : null;
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
  // ed.sel — главный выбранный (его свойства и стрелки), ed.selSet — все выбранные
  const selList = () => [...ED.selSet].filter(o => ED.SC.get(o.id));
  const selTop = () => { const L = selList(); return L.filter(o => !L.some(p => p !== o && ED.SC.isAncestor(p, o))); };   // родитель и потомок → только родитель
  function select(obj, add){
    const ed = ED;
    if (add && obj) { if (ed.selSet.has(obj)) { ed.selSet.delete(obj); obj = ed.sel === obj ? selList()[0] || null : ed.sel; } else ed.selSet.add(obj); }
    else { ed.selSet.clear(); if (obj) ed.selSet.add(obj); }
    ed.sel = obj || null;
    updateGizmo();
    renderProps(); highlightTree();
    // скрипт — в редактор кода
    if (obj?.cls === 'Script' && ed.selSet.size === 1) showCode(obj);
  }
  function setSel(list){ const ed = ED; ed.selSet = new Set(list); ed.sel = list[list.length - 1] || null; updateGizmo(); renderProps(); highlightTree(); }
  // объект для клика в мире: деталь модели → вся модель (Alt — сама деталь); заблокированные пропускаем
  function pickAt(ray, alt){
    const ed = ED, SC = ed.SC;
    let hit = SC.pick(ray);
    if (hit?.obj.locked) {
      hit = null;
      const meshes = []; for (const o of SC.all()) if (o._mesh && !o.locked && o._mesh.visible !== false) meshes.push(o._mesh);
      for (const h of ray.intersectObjects(meshes, true)) { let n = h.object; while (n && !n.userData.oid) n = n.parent; const o = n && SC.get(n.userData.oid); if (o && !o.locked) { hit = { obj: o, point: h.point }; break; } }
    }
    if (hit && !alt) { let o = hit.obj; for (let p = SC.get(o.parent); p; p = SC.get(p.parent)) if (p.cls === 'Model' && !p.locked) o = p; hit = { ...hit, obj: o }; }
    return hit;
  }
  function updateGizmo(){
    const ed = ED, o = ed.sel;
    if (!o || o.cls === 'Script' || ed.playing) { ed.G.attach(null); ed.boxHelper.visible = false; return; }
    const many = selTop().filter(x => x.cls !== 'Script');
    if (many.length > 1) {
      const T = ed.R.T, box = new T.Box3(); for (const x of many) box.union(ed.SC.box(x));
      const c = box.getCenter(new T.Vector3());
      ed.G.attach({ pos: [c.x, box.min.y, c.z], rot: [0, 0, 0], size: null, center: [c.x, c.y, c.z], model: true, group: true });
      ed.boxHelper.box.copy(box); ed.boxHelper.visible = !box.isEmpty();
      return;
    }
    const SC = ed.SC, box = SC.box(o);
    const center = o.cls === 'Model' ? (() => { const c = box.getCenter(new ed.R.T.Vector3()); return [c.x, c.y, c.z]; })() : o.pos.slice();
    ed.G.attach({ pos: o.cls === 'Model' ? SC.pivot(o) : o.pos, rot: o.rot || [0, 0, 0], size: o.size, center, model: o.cls === 'Model' || o.cls === 'Prefab' || o.cls === 'Light' || o.cls === 'Effect' });
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
      const h = cls === 'Part' || cls === 'Mesh' ? (props.size || def.size)[1] / 2 : cls === 'Spawn' ? def.size[1] / 2 : cls === 'Light' ? 3 : 0;
      props.pos = [p[0], +(p[1] + h).toFixed(3), p[2]];
      if (ed.sel?.cls === 'Model') parent = ed.sel;
    }
    const obj = SC.add(cls, props, parent);
    renderTree(); select(obj);
    if (cls === 'Script') { setBottom('code'); ED.q('.s3-ta').focus(); tutStep('script'); } else if (cls === 'Part') tutStep('add');
    return obj;
  }
  function duplicate(){
    const ed = ED, top = selTop(); if (!top.length) return;
    pushHist();
    const off = (ed.G.snap || 1) * 2, made = top.map(o => { const c = ed.SC.clone(o); moveBy(c, [off, 0, 0]); return c; });
    renderTree(); setSel(made);
  }
  function remove(){ const ed = ED, top = selTop(); if (!top.length) return; pushHist(); for (const o of top) ed.SC.remove(o); select(null); renderTree(); }
  // буфер — в браузере (вставить можно и в другой мир)
  function copySel(cut){
    const ed = ED, top = selTop(); if (!top.length) return;
    const list = ed.SC.serialize(top.flatMap(o => [o, ...ed.SC.descendants(o)]));
    try { localStorage.setItem('d37_s3_clip', JSON.stringify({ t: Date.now(), roots: top.map(o => o.id), list })); } catch (e) { msg('Не хватило места для копии', false); return; }
    if (cut) { pushHist(); for (const o of top) ed.SC.remove(o); select(null); renderTree(); msg(`✂ Вырезано: ${top.length}`); }
    else msg(`📋 Скопировано: ${top.length}`);
  }
  function paste(){
    const ed = ED; let clip = null;
    try { clip = JSON.parse(localStorage.getItem('d37_s3_clip') || 'null'); } catch (e) {}
    if (!Array.isArray(clip?.list) || !clip.list.length) { msg('Буфер пуст — сначала Ctrl+C', false); return; }
    pushHist();
    const map = new Map(), made = [], off = (ed.G.snap || 1) * 2;
    for (const d of clip.list.slice(0, 3000)) {
      if (!d || !ed.SC.DEF[d.cls]) continue;
      const props = { ...d }; if (Array.isArray(props.pos)) props.pos = [props.pos[0] + off, props.pos[1], props.pos[2]];
      let o; try { o = ed.SC.add(d.cls, props, d.parent && map.get(d.parent) ? map.get(d.parent) : null); } catch (e) { continue; }
      map.set(d.id, o); if (clip.roots?.includes(d.id)) made.push(o);
    }
    renderTree(); setSel(made); msg(`📋 Вставлено: ${made.length}`);
  }
  function groupSel(){
    const ed = ED, top = selTop(); if (!top.length) return;
    pushHist();
    const par = top[0].parent ? ed.SC.get(top[0].parent) : null, m = ed.SC.add('Model', { name: 'Модель' }, par);
    for (const o of top) ed.SC.reparent(o, m);
    renderTree(); select(m); msg('📦 Сгруппировано (Ctrl+U — разгруппировать)');
  }
  function ungroupSel(){
    const ed = ED, m = ed.sel; if (m?.cls !== 'Model') return;
    pushHist();
    const par = m.parent ? ed.SC.get(m.parent) : null, kids = ed.SC.children(m);
    for (const k of kids) ed.SC.reparent(k, par);
    ed.SC.remove(m);
    renderTree(); setSel(kids.filter(k => k.cls !== 'Script'));
  }

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
      if (ctrl && k === 'KeyC') { e.preventDefault(); copySel(false); return; }
      if (ctrl && k === 'KeyX') { e.preventDefault(); copySel(true); return; }
      if (ctrl && k === 'KeyV') { e.preventDefault(); paste(); return; }
      if (ctrl && k === 'KeyG') { e.preventDefault(); if (e.shiftKey) ungroupSel(); else groupSel(); return; }
      if (ctrl && k === 'KeyU') { e.preventDefault(); ungroupSel(); return; }
      if (ctrl && k === 'KeyA') { e.preventDefault(); setSel(ed.SC.children(null).filter(o => o.cls !== 'Script' && !o.locked)); return; }
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
    // файл модели перетащили в окно — загрузить
    view.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    view.addEventListener('drop', e => { const fs = [...(e.dataTransfer?.files || [])]; if (!fs.length) return; e.preventDefault(); if (fs.some(f => /\.(glb|gltf|obj|fbx)$/i.test(f.name))) uploadModel(fs); else msg('Перетащи файл модели: .glb, .gltf или .obj', false); });
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
      const hit = pickAt(ray, e.altKey);
      p.hit = hit; p.add = e.ctrlKey || e.shiftKey || e.metaKey;
      p.mode = hit && hit.obj === ed.sel && ed.selSet.size <= 1 && !p.add && ed.tool === 'move' && ed.sel.cls !== 'Model' ? 'dragPart' : e.pointerType === 'touch' ? 'look' : 'click';
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
      if (p.mode === 'gizmo') { if (!ed.G.up()) ed.hist.pop(); else tutStep('move'); renderProps(); updateGizmo(); return; }
      if (p.mode === 'brush') { ed.brushOn = false; markDirty(); return; }
      if (p.mode === 'dragPart') { if (p.moved) { renderProps(); updateGizmo(); } else select(p.hit.obj); return; }
      if ((p.mode === 'click' || (p.mode === 'look' && p.type === 'touch')) && !p.moved && e.type === 'pointerup') { if (p.hit || !p.add) select(p.hit ? p.hit.obj : null, p.add); renderTree(); }
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
  // сдвиг и поворот вокруг вертикали — для группы выбранных
  function moveBy(o, d){
    const SC = ED.SC;
    if (o.cls === 'Model') { const pv = SC.pivot(o); SC.set(o, 'pos', [pv[0] + d[0], pv[1] + d[1], pv[2] + d[2]]); }
    else if (o.pos) SC.set(o, 'pos', [o.pos[0] + d[0], o.pos[1] + d[1], o.pos[2] + d[2]].map(v => +v.toFixed(4)));
  }
  function turnAround(o, c, dy){
    const SC = ED.SC, a = dy * DEG, ca = Math.cos(a), sa = Math.sin(a);
    const turn = p => [c[0] + (p[0] - c[0]) * ca + (p[2] - c[2]) * sa, p[1], c[2] - (p[0] - c[0]) * sa + (p[2] - c[2]) * ca];
    if (o.cls === 'Model') { const pv = SC.pivot(o), np = turn(pv); SC.set(o, 'rot', [0, (((o._yaw || 0) + dy) % 360 + 360) % 360, 0]); const pv2 = SC.pivot(o); SC.set(o, 'pos', [pv2[0] + np[0] - pv[0], pv2[1], pv2[2] + np[2] - pv[2]]); }
    else if (o.pos) { SC.set(o, 'pos', turn(o.pos).map(v => +v.toFixed(4))); if (o.rot) SC.set(o, 'rot', [o.rot[0], ((o.rot[1] + dy) % 360 + 360) % 360, o.rot[2]]); }
  }
  function applyTransform(r){
    const ed = ED, o = ed.sel, SC = ed.SC;
    if (ed.G.target?.group) {
      const t = ed.G.target, list = selTop();
      if (r.pos) { const d = [0, 1, 2].map(i => r.pos[i] - t.pos[i]); if (d.some(v => Math.abs(v) > 1e-6)) { for (const x of list) moveBy(x, d); t.pos = r.pos.slice(); t.center = t.center.map((v, i) => v + d[i]); } }
      if (r.rot) { let dy = r.rot[1] - (t.rot[1] || 0); dy = ((dy % 360) + 540) % 360 - 180; if (Math.abs(dy) > 1e-6) { for (const x of list) turnAround(x, t.center, dy); t.rot = r.rot.slice(); } }
      const box = new ed.R.T.Box3(); for (const x of list) box.union(SC.box(x)); if (!box.isEmpty()) ed.boxHelper.box.copy(box);
      ed.G.update(); throttleProps(); return;
    }
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
    ed.FX.update(dt);
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
    if (kind === 'part') html = SC.SHAPES.map(([k, n, i]) => `<button type="button" data-m="part:${k}">${i} ${n}</button>`).join('') + '<hr><button type="button" data-m="spawn">📍 Точка появления</button><button type="button" data-m="light">💡 Свет (лампа)</button><button type="button" data-m="model">📦 Модель (группа)</button><div class="s3-mh">✨ Эффекты (в выбранную деталь)</div>' + Object.entries(window.D37E.fx.KINDS).map(([k, K]) => `<button type="button" data-m="fx:${k}">${K.icon} ${K.name}</button>`).join('');
    else if (kind === 'prefab') html = SC.PREFABS.map(([k, n, i]) => `<button type="button" data-m="prefab:${k}">${i} ${n}</button>`).join('');
    else if (kind === 'mod') {
      html = '<div class="s3-mh">🛡 Модели на проверке</div><div class="s3-mlist"><small class="s3-mh">Загрузка…</small></div><p class="s3-note s3-mnote">👁 — вставить в этот мир и посмотреть. ✅ — видят все. ⛔ — заблокировать.</p>';
      sb()?.from('ugc_models').select('id,name,tris,bytes,author,created_at,profiles(nick)').eq('status', 'review').order('created_at').limit(40).then(({ data }) => {
        const box = m.querySelector('.s3-mlist'); if (!box) return;
        box.innerHTML = data?.length ? data.map(x => `<div class="s3-mrow" data-mid="${esc(x.id)}"><button type="button" data-m="mview:${esc(x.id)}:${esc(x.author)}">👁 ${esc(x.name)} <small>👤 ${esc(x.profiles?.nick || '?')} · ${(x.tris || 0).toLocaleString('ru')} тр.</small></button><button type="button" data-m="mok:${esc(x.id)}" title="Одобрить">✅</button><button type="button" data-m="mban:${esc(x.id)}" title="Заблокировать">⛔</button></div>`).join('') : '<small class="s3-mh">Очередь пуста 🎉</small>';
      }, () => {});
    }
    else if (kind === 'models') {
      html = '<button type="button" data-m="mupload">⬆ Загрузить модель (.glb, .gltf, .obj)</button><div class="s3-mh">🔒 Мои модели — видно только тебе</div><div class="s3-mlist"><small class="s3-mh">Загрузка…</small></div>'
        + '<p class="s3-note s3-mnote">Модель хранится в этом браузере. Можно перетащить файл прямо в окно. Из Blender — File → Export → glTF 2.0 (.glb).</p>';
      window.D37E.models.list().then(list => {
        const box = m.querySelector('.s3-mlist'); if (!box) return;
        box.innerHTML = list.length ? list.slice(0, 40).map(x => `<div class="s3-mrow"><button type="button" data-m="minsert:${esc(x.id)}">🧩 ${esc(x.name)} <small>${x.tris.toLocaleString('ru')} тр. · ${Math.max(1, Math.round(x.bytes / 1024))} КБ</small></button><button type="button" data-m="mdel:${esc(x.id)}" title="Удалить">🗑</button></div>`).join('') : '<small class="s3-mh">Пока нет — загрузи первую</small>';
      });
    }
    else if (kind === 'file') {
      const list = store.index();
      html = `<button type="button" data-m="save">💾 Сохранить (Ctrl+S)</button><div class="s3-mh">Новый мир</div><button type="button" data-m="new:grass">🌿 Площадка с травой</button><button type="button" data-m="new:empty">⬜ Пустой (основание)</button><button type="button" data-m="new:obby">🏃 Обби (паркур) со скриптами</button><button type="button" data-m="new:island">🏝 Остров (холмы и вода)</button><button type="button" data-m="new:camp">🏕 Лагерь у костра (ночь)</button><button type="button" data-m="new:winter">❄️ Зимний лес</button>`
        + (list.length ? `<div class="s3-mh">Мои миры</div>${list.slice(0, 12).map(x => `<div class="s3-mrow"><button type="button" data-m="open:${esc(x.id)}">${x.id === ed.placeId ? '▸ ' : ''}${esc(x.name)} <small>${x.n} об.</small></button><button type="button" data-m="del:${esc(x.id)}" title="Удалить">🗑</button></div>`).join('')}` : '')
        + '<div class="s3-mh">Файл</div><button type="button" data-m="export">⬇ Выгрузить в файл</button><button type="button" data-m="import">⬆ Загрузить из файла</button>';
    }
    m.innerHTML = html;
    const b = btn.getBoundingClientRect(), bb = ed.box.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(bb.width - 230, b.left - bb.left)) + 'px'; m.style.top = (b.bottom - bb.top + 4) + 'px';
    m.hidden = false;
  }
  function closeMenu(){ const m = ED?.q('.s3-menu'); if (m) m.hidden = true; }

  // ═══ Сервер (ugc.sql): выложить мир и свои модели, открыть чужой мир ═══
  const sb = () => (typeof sbClient !== 'undefined' && sbClient) || null;
  const me = () => { try { return (typeof currentUser !== 'undefined' && currentUser) || null; } catch (e) { return null; } };
  const isStaff = () => { try { return typeof currentProfile !== 'undefined' && ['admin', 'moderator'].includes(currentProfile?.role); } catch (e) { return false; } };
  const modelPath = (author, id) => `models/${author}/${id}.json`;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function rpc(name, args){
    const c = sb(); if (!c) return null;
    try { const { data, error } = await c.rpc(name, args || {}); if (error) return { ok: false, reason: /PGRST202|Could not find the function/i.test((error.code || '') + ' ' + (error.message || '')) ? 'missing' : 'error', message: error.message }; return data; }
    catch (e) { return null; }
  }
  const WHY = { auth: 'Войди в аккаунт', title: 'Название — от 2 до 60 знаков', data: 'Мир слишком большой для публикации', limit: 'У тебя уже 30 игр и миров — удали ненужные в «Студии игр»',
    too_fast: 'Подожди пару секунд и нажми ещё раз', banned: 'Этот мир заблокирован модератором', not_found: 'Мир не найден', missing: 'Публикация откроется, когда сайт обновится (нужен ugc.sql)' };
  // чужая модель из выложенного мира: только одобренные (или свои/модератору — так решает хранилище)
  async function fetchRemoteModel(id){
    const author = ED?.remoteAuthors?.get(id), c = sb();
    if (!c || !author || !/^[0-9a-f-]{36}$/i.test(author) || !/^[a-z0-9]{6,24}$/.test(id)) return null;
    try { const { data, error } = await c.storage.from('ugc3d').download(modelPath(author, id)); if (error || !data || data.size > 21e6) return null; return JSON.parse(await data.text()); }
    catch (e) { return null; }
  }
  // мои модели в мире (не скачанные чужие)
  async function ownModelsUsed(){
    const out = [];
    for (const id of new Set(ED.SC.all().filter(o => o.cls === 'Mesh' && o.model).map(o => o.model))) { const m = await window.D37E.models.load(id); if (m && !m.foreign) out.push(m); }
    return out;
  }
  async function openPublish(){
    const ed = ED; if (!ed || ed.player) return;
    if (ed.playing) stopPlay();
    if (!me()) { msg('Войди в аккаунт, чтобы выложить мир', false); if (typeof openGlobalAuth === 'function') openGlobalAuth(); return; }
    const own = await ownModelsUsed();
    ed.dlg?.remove();
    const dlg = ed.dlg = document.createElement('div'); dlg.className = 's3-dlg';
    dlg.innerHTML = `<div class="s3-dlg-in"><b>📤 Выложить мир</b>
      <label class="s3-lbl">Название<input type="text" class="s3p-t" maxlength="60" value="${esc(ed.q('.s3-name').value.trim() || 'Мой мир')}"></label>
      <label class="s3-lbl">Описание — что делать в мире<textarea class="s3p-d" maxlength="300" rows="3"></textarea></label>
      <label class="s3-lbl">Значок<input type="text" class="s3p-i" maxlength="4" value="🧱"></label>
      <label class="s3-chk"><input type="radio" name="s3p-v" value="link" checked> 🔗 По ссылке — играют те, кому дашь ссылку</label>
      <label class="s3-chk"><input type="radio" name="s3p-v" value="review"> 🌍 В каталог — после проверки модератором</label>
      ${own.length ? `<p class="s3-note">🧩 Своих моделей: ${own.length}. Они уйдут на проверку — пока модератор не одобрит, у других на их месте будет пустая коробка.</p>` : ''}
      ${ed.pubId ? '<p class="s3-note">Мир уже выложен — обновим его по той же ссылке.</p>' : ''}
      <div class="s3-grid2"><button type="button" data-a="pub:go" class="s3-play">📤 Выложить</button><button type="button" data-a="pub:close">Закрыть</button></div>
      <div class="s3-pubres"></div></div>`;
    ed.box.appendChild(dlg);
  }
  async function doPublish(){
    const ed = ED, dlg = ed?.dlg, c = sb(), u = me(), E = window.D37E;
    if (!dlg || !c || !u || ed.publishing) return;
    const res = dlg.querySelector('.s3-pubres'), say = t => { res.innerHTML = t; };
    const title = dlg.querySelector('.s3p-t').value.trim(), descr = dlg.querySelector('.s3p-d').value.trim(), icon = dlg.querySelector('.s3p-i').value.trim() || '🧱';
    const vis = dlg.querySelector('[name="s3p-v"]:checked')?.value === 'review' ? 'review' : 'link';
    if (title.length < 2) { say('Название — от 2 букв'); return; }
    ed.publishing = true; dlg.querySelector('[data-a="pub:go"]').disabled = true;
    try {
      // 1) свои модели — в хранилище (каждая один раз; дальше — проверка модератором)
      const ids = [...new Set(ed.SC.all().filter(o => o.cls === 'Mesh' && o.model).map(o => o.model))], authors = {};
      const known = new Map();
      if (ids.length) { const { data } = await c.from('ugc_models').select('id,author,status').in('id', ids); for (const r of data || []) known.set(r.id, r); }
      let n = 0, uploaded = 0;
      for (const id of ids) {
        const r = known.get(id);
        if (r) { authors[id] = r.author; continue; }
        const m = await E.models.load(id);
        if (!m || m.foreign) { const au = ed.remoteAuthors.get(id); if (au) authors[id] = au; continue; }
        if (uploaded) await sleep(2100);   // сервер: не чаще раза в 2 с
        say(`🧩 Загружаю модели: ${++n}…`);
        const blob = new Blob([JSON.stringify(await E.models.pack(m))], { type: 'application/json' });
        if (blob.size > 20e6) throw new Error(`Модель «${m.name}» слишком большая для сайта (до 20 МБ)`);
        const up = await c.storage.from('ugc3d').upload(modelPath(u.id, id), blob, { contentType: 'application/json', upsert: false });
        if (up.error && !/exist|duplicate/i.test(up.error.message || '')) throw new Error('Модель не загрузилась: ' + (up.error.message || 'ошибка'));
        const s = await rpc('ugc_model_save', { p_id: id, p_name: m.name, p_tris: m.tris, p_bytes: blob.size });
        if (!s?.ok) throw new Error(s?.reason === 'limit' ? 'Слишком много моделей (до 60)' : WHY[s?.reason] || 'Модель не записалась');
        authors[id] = u.id; uploaded++;
      }
      // 2) мир
      say('🧱 Сохраняю мир…');
      const d = await snapshot(); delete d.cam; delete d.pub; d.models = authors;
      if (JSON.stringify(d).length > 880000) throw new Error('Мир слишком большой для публикации — убери лишние детали или выключи ландшафт');
      const r = await rpc('ugc_save', { p_id: ed.pubId || null, p_title: title, p_descr: descr, p_icon: icon, p_kind: 'place', p_tpl: null, p_data: d, p_html: null });
      if (!r?.ok) { if (r?.reason === 'not_found' && ed.pubId) { ed.pubId = null; throw new Error('Старый выложенный мир удалён — нажми ещё раз, выложим заново'); } throw new Error(WHY[r?.reason] || 'Не получилось сохранить мир'); }
      if (ED !== ed) return;
      ed.pubId = r.id; ed.dirty = true; save(true);
      const st = await rpc('ugc_status', { p_id: r.id, p_status: vis });
      ed.pubLink = `${location.origin}/g/${r.id}`;
      say(`✅ Выложено!${st?.status === 'review' ? ' В каталог попадёт после проверки модератором.' : ''}${uploaded ? ` Моделей на проверке: ${uploaded}.` : ''}<br><a href="${esc(ed.pubLink)}" target="_blank" rel="noopener">${esc(ed.pubLink)}</a> <button type="button" data-a="pub:copy">📋 Скопировать</button>`);
      print(`📤 Мир выложен: ${ed.pubLink}`, 'sys');
    } catch (e) { say('❌ ' + esc(e.message || e)); }
    finally { ed.publishing = false; const b = dlg.querySelector('[data-a="pub:go"]'); if (b) b.disabled = false; }
  }
  // ═══ Режим игрока: чужой мир по ссылке (#/games/studio3d/play/<id>) ═══
  async function openPublished(id){
    const ed = ED, c = sb();
    ed.player = { id, row: null };
    const fail = t => { const L = document.createElement('div'); L.className = 's3-loading'; L.innerHTML = t; ed.box.appendChild(L); };
    if (!c) { fail('Не получилось открыть мир — обнови страницу'); return; }
    let row = null;
    try { ({ data: row } = await c.from('ugc_games').select('id,title,icon,descr,kind,data,status,author,plays,likes,profiles(nick)').eq('id', id).maybeSingle()); } catch (e) {}
    if (ED !== ed) return;
    if (!row || row.kind !== 'place' || !Array.isArray(row.data?.objects)) { fail('Мир не найден или скрыт автором.<br><a href="#/games/studio">Другие миры и игры</a>'); return; }
    ed.player.row = row;
    const d = row.data;
    for (const [mid, au] of Object.entries(d.models || {}).slice(0, 200)) if (typeof au === 'string') ed.remoteAuthors.set(mid, au);
    // больше 40 ламп — дальше без света (иначе слабые компьютеры не потянут)
    let lights = 0; d.objects = d.objects.filter(o => o && (o.cls !== 'Light' || ++lights <= 40));
    await openPlace('pub-' + id, d);
    if (ED !== ed) return;
    const nm = ed.q('.s3-name'); nm.value = row.title; nm.readOnly = true;
    renderPInfo();
    rpc('ugc_play', { p_id: id });
    startPlay();
  }
  function renderPInfo(){
    const ed = ED, row = ed?.player?.row, box = ed?.q('.s3-pinfo'); if (!row || !box) return;
    box.hidden = false;
    box.innerHTML = `<a href="#/profile/${esc(row.author)}" target="_blank">👤 ${esc(row.profiles?.nick || 'игрок')}</a><button type="button" data-a="like" title="Нравится">❤️ <b>${row.likes || 0}</b></button>`;
  }
  async function likePlace(){
    const ed = ED, row = ed?.player?.row; if (!row) return;
    if (!me()) { msg('Войди, чтобы ставить ❤️', false); if (typeof openGlobalAuth === 'function') openGlobalAuth(); return; }
    const r = await rpc('ugc_like', { p_id: row.id });
    if (r?.ok) { row.likes = r.likes; renderPInfo(); msg(r.liked ? '❤️ Нравится' : 'Убрал ❤️', true); }
  }

  // ═══ Свои модели: загрузка → «компиляция» (model.js) → хранилище браузера → в мир ═══
  function pickModel(){
    const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
    inp.accept = '.glb,.gltf,.obj,.mtl,.bin,.png,.jpg,.jpeg,.webp,.fbx';
    inp.onchange = () => { if (inp.files?.length) uploadModel([...inp.files]); };
    inp.click();
  }
  const STEP = { read: '📖 Читаю файл…', check: '🔍 Проверяю и собираю модель…', tex: '🖼 Сжимаю текстуры…', done: '✅ Готово' };
  async function uploadModel(files){
    const ed = ED; if (!ed || ed.playing || ed.busy) return;
    const busy = document.createElement('div'); busy.className = 's3-busy'; busy.innerHTML = '<b>⚙️ Компиляция модели</b><span>📖 Читаю файл…</span>';
    ed.q('.s3-view').appendChild(busy); ed.busy = true;
    try {
      const model = await window.D37E.models.compile(files, { onStep: s => { busy.querySelector('span').textContent = STEP[s] || s; } });
      await window.D37E.models.save(model);
      print(`🧩 «${model.name}»: ${model.tris.toLocaleString('ru')} треугольников, текстур: ${model.tex.filter(Boolean).length}, ${Math.max(1, Math.round(model.bytes / 1024))} КБ${model.fitted ? ' — размер подогнан' : ''}. Видно только тебе`, 'sys');
      if (ED === ed) insertModel(model.id);
    } catch (e) {
      const t = e && e.user ? e.message : 'Не получилось открыть модель: ' + (e && e.message || e);
      print('❌ ' + t, 'err'); if (ED === ed) { setBottom('out'); msg('❌ ' + t, false); }
    } finally { busy.remove(); ed.busy = false; }
  }
  async function insertModel(id){
    const m = await window.D37E.models.load(id); if (!m || !ED) return;
    insert('Mesh', { model: id, name: m.name, size: m.size.slice() });
  }
  // в файл мира — все модели, что стоят в мире
  async function packModels(){
    const out = {}, ids = new Set(ED.SC.all().filter(o => o.cls === 'Mesh' && o.model).map(o => o.model));
    for (const id of ids) { const m = await window.D37E.models.load(id); if (m) out[id] = await window.D37E.models.pack(m); }
    return out;
  }
  async function unpackModels(list){
    if (!list || typeof list !== 'object') return;
    for (const pm of Object.values(list).slice(0, 50)) { const m = window.D37E.models.unpack(pm); if (m && !(await window.D37E.models.load(m.id))) await window.D37E.models.save(m).catch(() => {}); }
  }
  async function menuAct(a){
    const ed = ED; closeMenu();
    const [k, v, w] = a.split(':');
    if (k === 'part') insert('Part', { shape: v, size: v === 'ball' ? [2, 2, 2] : v === 'cyl' ? [2, 2, 2] : v === 'wedge' ? [4, 2, 4] : [4, 1, 2], name: { block: 'Деталь', ball: 'Шар', cyl: 'Цилиндр', wedge: 'Клин' }[v] });
    else if (k === 'spawn') insert('Spawn');
    else if (k === 'fx') {
      const K = window.D37E.fx.KINDS[v]; if (!K) return;
      const par = ed.sel && ['Part', 'Mesh', 'Spawn', 'Prefab'].includes(ed.sel.cls) ? ed.sel : null, p = insertPoint();
      pushHist();
      const o = ed.SC.add('Effect', { kind: v, name: K.name, pos: par ? par.pos.slice() : [p[0], +(p[1] + .5).toFixed(3), p[2]] }, par);
      renderTree(); select(o);
    }
    else if (k === 'light') insert('Light');
    else if (k === 'model') insert('Model');
    else if (k === 'prefab') insert('Prefab', { kind: v, name: ed.SC.PREFABS.find(p => p[0] === v)?.[1] || 'Предмет' });
    else if (k === 'mupload') pickModel();
    else if (k === 'mview') { if (w) ed.remoteAuthors.set(v, w); const m = await window.D37E.models.load(v); if (m) insertModel(v); else msg('Модель не загрузилась', false); }
    else if (k === 'mok' || k === 'mban') { const r = await rpc('ugc_model_review', { p_id: v, p_status: k === 'mok' ? 'public' : 'banned' }); msg(r?.ok ? (k === 'mok' ? '✅ Модель одобрена' : '⛔ Модель заблокирована') : 'Не получилось', !!r?.ok); }
    else if (k === 'minsert') insertModel(v);
    else if (k === 'mdel') {
      const used = ed.SC.all().filter(o => o.cls === 'Mesh' && o.model === v).length;
      if (!confirm(used ? `Модель стоит в этом мире ${used} раз. Удалить её из браузера? В мире останутся пустые коробки.` : 'Удалить модель из браузера?')) return;
      await window.D37E.models.remove(v); for (const o of ed.SC.all()) if (o.cls === 'Mesh' && o.model === v) ed.SC.set(o, 'model', v, true); msg('Модель удалена');
    }
    else if (k === 'save') save();
    else if (k === 'new') { if (ed.dirty) await save(true); template(ed.SC, ed.TR, v); ed.placeId = newId(); ed.q('.s3-name').value = { grass: 'Мой мир', empty: 'Пустой мир', obby: 'Моё обби', island: 'Остров', camp: 'Лагерь у костра', winter: 'Зимний лес' }[v] || 'Мой мир'; ed.ground.visible = !ed.TR.enabled; ed.hist = []; ed.fut = []; select(null); renderTree(); await save(true); msg('Новый мир создан', true); }
    else if (k === 'open') { if (ed.dirty) await save(true); const d = store.load(v); if (d) { await openPlace(v, d); msg('Открыт: ' + (d.name || 'мир'), true); } }
    else if (k === 'del') { if (v === ed.placeId) { msg('Сначала открой другой мир', false); return; } if (confirm('Удалить мир из браузера навсегда?')) { store.remove(v); msg('Удалено'); } }
    else if (k === 'export') { const d = await snapshot(); d.models = await packModels(); const blob = new Blob([JSON.stringify(d)], { type: 'application/json' }); const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob); a2.download = (d.name || 'мир').replace(/[^\p{L}\p{N} _-]/gu, '') + '.d37world.json'; a2.click(); setTimeout(() => URL.revokeObjectURL(a2.href), 4000); }
    else if (k === 'import') {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; if (f.size > 40e6) { msg('Файл слишком большой', false); return; } try { const d = JSON.parse(await f.text()); if (!Array.isArray(d.objects)) throw 0; if (ed.dirty) await save(true); await unpackModels(d.models); delete d.models; await openPlace(newId(), d); await save(true); msg('Мир загружен', true); } catch (e) { msg('Это не файл мира', false); } };
      inp.click();
    }
  }
  function act(a, b){
    const ed = ED;
    if (a.startsWith('menu:')) { const m = ed.q('.s3-menu'); if (!m.hidden && ed.menuFor === a) { closeMenu(); return; } ed.menuFor = a; openMenu(a.slice(5), b); return; }
    if (a === 'exit') { exitStudio(); return; }
    if (a === 'undo') undo(false); else if (a === 'redo') undo(true);
    else if (a === 'add:Script') insert('Script');
    else if (a === 'play') { if (ed.player) { if (ed.playing) stopPlay(); if (ed.player.row) startPlay(); } else if (ed.playing) stopPlay(); else startPlay(); }
    else if (a === 'publish') openPublish();
    else if (a === 'tut:x') { ed.q('.s3-tut')?.remove(); ed.tut = null; try { localStorage.setItem('d37_s3_tut', '1'); } catch (e) {} }
    else if (a === 'pub:close') { ed.dlg?.remove(); ed.dlg = null; }
    else if (a === 'pub:go') doPublish();
    else if (a === 'pub:copy') { navigator.clipboard?.writeText(ed.pubLink || '').then(() => msg('Ссылка скопирована', true), () => prompt('Скопируй ссылку:', ed.pubLink)); }
    else if (a === 'like') likePlace();
    else if (a === 'toggleLeft') ed.box.classList.toggle('s3-showL');
    else if (a === 'toggleRight') ed.box.classList.toggle('s3-showR');
    else if (a === 'toggleBottom') ed.box.classList.toggle('s3-minB');
    else if (a === 'ai') { const ta = ed.q('.s3-ta'), L = langOf(ed.codeFor), what = prompt('Что должен делать скрипт? (например: «дверь открывается, когда у игрока 5 монет»)'); if (!what) return; const task = (L.ai || AI_TASK) + what + '\nОтвет — только код скрипта.'; navigator.clipboard?.writeText(task).then(() => { msg('Задание скопировано — вставь в ИИ, а его ответ — сюда', true); ed.q('.s3-ai').hidden = false; }, () => prompt('Скопируй задание:', task)); ta.focus(); }
    else if (a === 'wasm') pickWasm();
    else if (a === 'compile') compileScript();
    else if (a.startsWith('msize:')) { const o = ed.sel, md = o && window.D37E.models.cached(o.model); if (md) { pushHist(); ed.SC.set(o, 'size', a === 'msize:1' ? md.size.slice() : o.size.map(v => +(v * 2).toFixed(3))); updateGizmo(); renderProps(); } }
    else if (a === 'group') groupSel(); else if (a === 'ungroup') ungroupSel();
    else if (a === 'dup') duplicate(); else if (a === 'del') remove(); else if (a === 'focus') focusSel();
    else if (a === 'terrain:gen') { if (!confirm('Создать новые холмы? Текущий ландшафт пропадёт.')) return; generateHills(ed.TR, Math.random() * 1e9 | 0); markDirty(); }
    else if (a === 'terrain:flat') { if (!confirm('Сделать землю ровной?')) return; ed.TR.H.fill(0); for (let i = 0; i < ed.TR.n * ed.TR.n; i++) ed.TR.W.set([255, 0, 0, 0], i * 4); ed.TR.brush('smooth', 0, 0, ed.TR.size, 0, 0); markDirty(); }
    else if (a.startsWith('time:')) { ed.R.setLighting({ time: +a.slice(5) }); renderProps(); markDirty(); }
    else if (a.startsWith('btool:')) { ed.brush.tool = a.slice(6); renderProps(); }
    else if (a.startsWith('bch:')) { ed.brush.tool = 'paint'; ed.brush.ch = +a.slice(4); renderProps(); }
    else if (a.startsWith('color:')) { const L = selList().filter(o => o.color !== undefined); if (L.length) { pushHist(); for (const o of L) ed.SC.set(o, 'color', a.slice(6)); renderProps(); } }
    else if (a.startsWith('mat:')) { const L = selList().filter(o => o.mat !== undefined); if (L.length) { pushHist(); for (const o of L) ed.SC.set(o, 'mat', a.slice(4)); renderProps(); } }
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
  const ICON = o => o.cls === 'Part' ? ({ block: '🟫', ball: '⚪', cyl: '🛢️', wedge: '📐' }[o.shape] || '🟫') : { Spawn: '📍', Light: '💡', Model: '📦', Mesh: '🧩', Effect: (window.D37E.fx.KINDS[o.kind] || {}).icon || '✨', Script: langOf(o).icon, Prefab: (window.D37E.scene.PREFABS.find(p => p[0] === o.kind) || [])[2] || '🌳' }[o.cls] || '❔';
  function renderTree(){
    const ed = ED, SC = ed.SC, tree = ed.q('.s3-tree');
    const rows = [`<div class="s3-row s3-root" data-id="" draggable="false">🌍 Workspace</div>`];
    const find = (ed.q('.s3-find')?.value || '').trim().toLowerCase(), show = find ? new Set() : null;
    if (show) for (const o of SC.all()) if (o.name.toLowerCase().includes(find)) for (let p = o; p; p = SC.get(p.parent)) show.add(p);
    const walk = (list, depth) => { for (const o of list) { if (show && !show.has(o)) continue; rows.push(`<div class="s3-row${ed.selSet.has(o) ? ' sel' : ''}" data-id="${o.id}" draggable="true" style="padding-left:${8 + depth * 14}px">${ICON(o)} ${esc(o.name)}${o.locked ? ' 🔒' : ''}</div>`); walk(SC.children(o), depth + 1); } };
    walk(SC.children(null), 1);
    tree.innerHTML = rows.join('');
    if (!tree.dataset.wired) {
      tree.dataset.wired = 1;
      tree.addEventListener('click', e => { const r = e.target.closest('.s3-row'); if (!r) return; select(r.dataset.id ? ED.SC.get(r.dataset.id) : null, e.ctrlKey || e.shiftKey || e.metaKey); });
      ED.q('.s3-find').addEventListener('input', () => renderTree());
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
  function highlightTree(){ const ed = ED, ids = new Set(selList().map(o => o.id)); ed.q('.s3-tree').querySelectorAll('.s3-row').forEach(r => r.classList.toggle('sel', ids.has(r.dataset.id))); }

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
        <label class="s3-chk"><input type="checkbox" data-p="cycle:on"${L.cycle > 0 ? ' checked' : ''}> 🔁 Смена дня и ночи в игре</label>
        ${L.cycle > 0 ? `<label class="s3-lbl">Сутки длятся <b>${L.cycle} мин</b><input type="range" min="1" max="60" step="1" value="${L.cycle}" data-p="cycle:min"></label>` : ''}
        <p class="s3-note">Ночью включай 💡 Свет (лампы) — они светятся.</p>`;
    } else if (o && ed.selSet.size > 1) {
      const list = selList(), tinted = list.filter(x => x.color !== undefined), matd = list.filter(x => x.mat !== undefined), has = k => list.filter(x => x[k] !== undefined);
      const allOn = k => has(k).length && has(k).every(x => x[k] !== false);
      let h = `<p class="s3-note">Выбрано: <b>${list.length}</b>. Стрелки двигают и крутят всё вместе. Ctrl + клик — добавить или убрать.</p>`;
      if (tinted.length) h += `<div class="s3-lbl">Цвет (${tinted.length})</div><div class="s3-pal">${COLORS.map(c => `<button type="button" data-a="color:${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>`;
      if (matd.length) h += `<div class="s3-lbl">Материал (${matd.length})</div><div class="s3-mats">${SC.MATS.map(([k, n, i]) => `<button type="button" data-a="mat:${k}" title="${n}">${i}<small>${n}</small></button>`).join('')}</div>`;
      for (const [k, n] of [['anchored', 'Закреплены'], ['collide', 'Сталкиваются'], ['shadow', 'Тень']]) if (has(k).length) h += `<label class="s3-chk"><input type="checkbox" data-p="m:${k}"${allOn(k) ? ' checked' : ''}> ${n}</label>`;
      h += `<div class="s3-grid3"><button type="button" data-a="group">📦 Группа</button><button type="button" data-a="dup">⧉ Копия</button><button type="button" data-a="del" class="warn">🗑 Удалить</button></div>`;
      P.innerHTML = h;
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
      } else if (o.cls === 'Effect') {
        const KS = window.D37E.fx.KINDS, K = KS[o.kind] || KS.fire, inPart = o.parent && SC.get(o.parent)?.pos && SC.get(o.parent).cls !== 'Model';
        h += `<label class="s3-lbl">Вид<select data-p="kind">${Object.entries(KS).map(([k, x]) => `<option value="${k}"${o.kind === k ? ' selected' : ''}>${x.icon} ${x.name}</option>`).join('')}</select></label>`;
        h += inPart ? '<p class="s3-note">Летит из детали, в которой лежит (перетащи в Проводнике в другую — или в Workspace).</p>' : v3('pos', 'Позиция', ed.G.snap || .1);
        h += `<label class="s3-lbl">Сколько частиц <b>×${(+o.rate).toFixed(1)}</b><input type="range" min="0.1" max="4" step="0.1" value="${o.rate}" data-p="rate"></label>`;
        h += `<label class="s3-lbl">Размер <b>×${(+o.scale).toFixed(1)}</b><input type="range" min="0.2" max="5" step="0.1" value="${o.scale}" data-p="scale"></label>`;
        if (!K.palette) h += `<div class="s3-grid2"><label class="s3-lbl">Цвет<input type="color" value="${o.color || K.color}" data-p="color"></label><label class="s3-lbl">Цвет к концу<input type="color" value="${o.color2 || K.color2 || K.color}" data-p="color2"></label></div>`;
        h += `<label class="s3-chk"><input type="checkbox" data-p="enabled"${o.enabled !== false ? ' checked' : ''}> Включён</label>`;
      } else if (o.cls === 'Mesh') {
        const md = window.D37E.models.cached(o.model);
        h += `<p class="s3-note">${md ? `🧩 <b>${esc(md.name)}</b> · ${md.tris.toLocaleString('ru')} треугольников<br>🔒 Видно только тебе (модель в этом браузере)` : '⚠️ Модели нет в этом браузере — видна пустая коробка. Загрузи её снова или открой мир из файла.'}</p>`;
        h += v3('pos', 'Позиция', ed.G.snap || .1) + v3('size', 'Размер', ed.G.snap || .1) + v3('rot', 'Поворот (°)', ed.G.rsnap || 1);
        if (md) h += `<div class="s3-grid2"><button type="button" data-a="msize:1">↺ Исходный размер</button><button type="button" data-a="msize:2">× 2</button></div>`;
        h += `<label class="s3-lbl">Прозрачность <b>${(+o.alpha).toFixed(2)}</b><input type="range" min="0" max="1" step="0.05" value="${o.alpha}" data-p="alpha"></label>`;
        h += `<label class="s3-chk"><input type="checkbox" data-p="collide"${o.collide !== false ? ' checked' : ''}> Сталкивается (CanCollide)</label>
          <label class="s3-lbl">Форма столкновений<select data-p="fit"><option value="precise"${o.fit !== 'box' ? ' selected' : ''}>🎯 Точно — по поверхности модели</option><option value="box"${o.fit === 'box' ? ' selected' : ''}>📦 Коробкой — быстрее</option></select></label>
          <label class="s3-chk"><input type="checkbox" data-p="anchored"${o.anchored !== false ? ' checked' : ''}> Закреплена (Anchored)</label>
          <label class="s3-chk"><input type="checkbox" data-p="shadow"${o.shadow !== false ? ' checked' : ''}> Тень</label>`;
      } else if (o.cls === 'Model') {
        h += `<p class="s3-note">Модель — группа. Перетащи детали на неё в Проводнике. Двигай и крути её стрелками целиком.</p>`;
      } else if (o.cls === 'Script') {
        h += `<label class="s3-lbl">Язык<select data-p="lang">${Object.values(window.D37E.langs).map(l => `<option value="${l.id}"${l.id === langOf(o).id ? ' selected' : ''}>${l.icon} ${esc(l.label)}</option>`).join('')}</select></label>`;
        h += `<label class="s3-chk"><input type="checkbox" data-p="enabled"${o.enabled !== false ? ' checked' : ''}> Включён</label><p class="s3-note">Код — внизу во вкладке «📜 Скрипт». Скрипт работает, когда нажмёшь ▶ Играть.</p>`;
      }
      if (o.cls !== 'Script') h += `<label class="s3-chk"><input type="checkbox" data-p="locked"${o.locked ? ' checked' : ''}> 🔒 Заблокирован — не выбирается кликом в мире</label>`;
      if (o.cls === 'Model') h += `<button type="button" data-a="ungroup">📤 Разгруппировать (Ctrl+U)</button>`;
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
        if (key === 'cycle:on') { ed2.R.lighting.cycle = val ? 10 : 0; markDirty(); renderProps(); return; }
        if (key === 'cycle:min') { ed2.R.lighting.cycle = Math.max(1, Math.min(60, val | 0)); const b = el.closest('label')?.querySelector('b'); if (b) b.textContent = ed2.R.lighting.cycle + ' мин'; markDirty(); return; }
        if (key.startsWith('l:')) { ed2.R.setLighting({ [key.slice(2)]: val }); const b = el.closest('label')?.querySelector('b'); if (b) b.textContent = key === 'l:time' ? fmtTime(val) : key === 'l:fogEnd' ? (val | 0) : (+val).toFixed(1); markDirty(); return; }
        if (key === 't:on') { ed2.TR.setEnabled(val); ed2.ground.visible = !val; markDirty(); return; }
        if (key === 't:water') { ed2.TR.setWater(val); markDirty(); return; }
        if (key === 't:level') { ed2.TR.setWater(ed2.TR.water.on, val); const b = el.closest('label')?.querySelector('b'); if (b) b.textContent = (+val).toFixed(1); markDirty(); return; }
        if (!o2) return;
        if (key.startsWith('m:')) { const k = key.slice(2); pushHist(); for (const x of selList()) if (x[k] !== undefined) SC2.set(x, k, val); return; }
        if (key === 'lang') { setLang(o2, val); return; }
        if (!commit && (el.type === 'text' || el.type === 'number')) return;   // текст и числа — по Enter/уходу
        if (!ed2.histOpen) { pushHist(); ed2.histOpen = true; setTimeout(() => { if (ED) ED.histOpen = false; }, 600); }
        if (key.includes(':')) { const [k, i] = key.split(':'); if (!Number.isFinite(val)) return; const arr = o2[k].slice(); arr[+i] = k === 'size' ? Math.max(.05, val) : val; SC2.set(o2, k, arr); }
        else if (key === 'name') { o2.name = String(val).trim().slice(0, 40) || o2.name; renderTree(); }
        else SC2.set(o2, key, val);
        if (el.type === 'range') { const b = el.closest('label')?.querySelector('b'); if (b) b.textContent = (+val).toFixed(key === 'alpha' ? 2 : 1); }
        updateGizmo();
        if (key === 'shape' || key === 'kind' || key === 'enabled') renderProps();
        if (key === 'kind' || key === 'locked') renderTree();
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
    tutStep('play');
    ed.TR.cursor(null); ed.G.attach(null); ed.boxHelper.visible = false; closeMenu();
    const snap = SC.toJSON().objects;
    // свет-лампочки и невидимые детали — как в игре
    for (const o of SC.all()) { if ((o.cls === 'Light' || o.cls === 'Effect') && o._mesh) o._mesh.visible = false; if ((o.alpha || 0) >= .999 && o._mesh) o._mesh.visible = false; if (o.cls === 'Mesh' && o._mesh && !ed.player) o._mesh.traverse(c => { if (c.userData.stub) c.visible = false; }); }
    const spawn = SC.all().find(o => o.cls === 'Spawn');
    const sp = spawn ? [spawn.pos[0], spawn.pos[1] + spawn.size[1] / 2 + .05, spawn.pos[2]] : [0, ed.ph.groundAt(0, 0) + .05, 0];
    // на точке появления что-то стоит — появляемся сверху, а не внутри
    if (ed.ph.blocked(sp[0], sp[2], sp[1] + .05, sp[1] + 2, .42)) sp[1] = ed.ph.supportAt(sp[0], sp[2], .42, 1e6).y + .02;
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
    P.on('splash', e => AU.play('step_water' + ((Math.random() * 3) | 0), { x: e.x, y: e.y, z: e.z, vol: Math.min(1, .55 + e.v * .06), rate: .85 }));
    P.on('swim', e => AU.play('step_water' + ((Math.random() * 3) | 0), { x: e.x, y: e.y, z: e.z, vol: e.run ? .55 : .4, rate: .78 }));
    const nick = (typeof currentProfile !== 'undefined' && currentProfile?.nick) || window.GameRoom?.nick?.() || 'Игрок';
    // HUD: очки, здоровье, надписи
    const hud = document.createElement('div'); hud.className = 's3-hud';
    hud.innerHTML = '<div class="s3-stats" hidden></div><div class="s3-health"><i></i></div><div class="s3-labels"></div>';
    R.r.domElement.parentElement.appendChild(hud);
    const pl = { light0: { ...R.lighting }, P, C, I, X, A, rig, H, AU, hud, snap, sp, stats: {}, labels: {}, health: 100, maxHealth: 100, touching: new Set(), tweens: [], clicks: new Map(), prompts: new Map(), dead: 0, nick, unf };
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
    ed.q('.s3-play').textContent = ed.player ? '🔁 Заново' : '■ Стоп';
    ed.q('.s3-hint').hidden = true;
    pl.loop = E.loop(playStep, playFrame);
    ed.loop.pause(true);
    msg('▶ Играешь! WASD — идти, Пробел — прыжок, E — действие. ■ Стоп — назад в редактор', true);
  }
  function stopPlay(){
    const ed = ED, pl = ed.playing; if (!pl) return;
    pl.loop.stop(); pl.SH.stop(); pl.unf?.(); pl.I.dispose(); pl.C.dispose(); pl.H.dispose(); pl.A.dispose(); pl.hud.remove();
    for (const l of pl.amb || []) l.h.stop();
    ed.playing = null;
    const sel = ed.sel?.id;
    ed.SC.fromJSON({ objects: pl.snap });
    if (pl.light0.time !== ed.R.lighting.time) ed.R.setLighting(pl.light0);
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
  // Звуки окружения в игре: у огня — треск, дождь и снег — со всех сторон, у воды — плеск (synth.js, A.loop)
  const AMB = { fire: ['amb_fire', .75], rain: ['amb_rain', .55], snow: ['amb_wind', .35], magic: ['amb_magic', .35], sparkles: ['amb_magic', .25] };
  function ambTick(pl){
    const ed = ED, SC = ed.SC;
    if (!pl.amb) {
      pl.amb = [];
      for (const o of SC.all()) if (o.cls === 'Effect' && AMB[o.kind]) pl.amb.push({ id: o.id, area: o.kind === 'rain' || o.kind === 'snow', vol: AMB[o.kind][1], h: pl.AU.loop(AMB[o.kind][0], { vol: 0 }) });
      if (ed.TR.enabled && ed.TR.water.on) pl.amb.push({ water: true, vol: .3, h: pl.AU.loop('amb_water', { vol: 0 }) });
    }
    const cam = ed.R.camera.position;
    for (const l of pl.amb) {
      if (l.water) { l.h.set({ x: cam.x, y: ed.TR.water.level, z: cam.z, vol: l.vol }); continue; }
      const o = SC.get(l.id);
      if (!o || o.enabled === false) { l.h.set({ vol: 0 }); continue; }
      if (l.area) { l.h.set({ x: null, vol: l.vol }); continue; }
      const host = o.parent && SC.get(o.parent), p = host?.pos && host.cls !== 'Model' ? host.pos : o.pos;
      l.h.set({ x: p[0], y: p[1], z: p[2], vol: l.vol });
    }
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
    const Lg = ed.R.lighting;
    if (Lg.cycle > 0) { pl.cycT = (pl.cycT || 0) + dt; if (pl.cycT >= 1.5) { ed.R.setLighting({ time: (Lg.time + pl.cycT * 24 / (Lg.cycle * 60)) % 24 }); pl.cycT = 0; } }
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
    ambTick(pl);
    pl.AU.listener(R.camera.position.x, R.camera.position.y, R.camera.position.z, rig.yaw);
    // клик/тап по детали со скриптом «Clicked»
    for (const tp of I.taps) { const b = R.r.domElement.getBoundingClientRect(); ed.ray.setFromCamera(new R.T.Vector2((tp.x - b.left) / b.width * 2 - 1, -((tp.y - b.top) / b.height) * 2 + 1), R.camera); const h = ed.SC.pick(ed.ray); if (h && pl.clicks.has(h.obj.id)) pl.SH.event('clicked', { id: h.obj.id, player: 'me' }); }
    I.frameEnd(); C.frameEnd();
    ed.FX.update(dt);
    R.update(dt); R.follow(P.ch.x, P.ch.z, P.ch.y);
    R.render();
    H.prompt(I.touch ? (pl.X.raw && pl.X.cur ? '✋ ' + pl.X.raw : null) : pl.X.text, pl.X.progress);
    H.stamina(P.stamina / P.maxStamina, P.exhausted);
  }

  // ═══ Выход ═══
  async function exitStudio(){
    const wasPlayer = !!ED?.player;
    if (ED?.playing) stopPlay();
    if (ED?.dirty) await save(true);
    unmount();
    location.hash = wasPlayer ? '#/games/studio' : '#/games';
  }
  function unmount(){
    const ed = ED; if (!ed) return;
    ED = null;
    try { if (ed.playing) { const pl = ed.playing; pl.loop.stop(); pl.SH.stop(); pl.I.dispose(); pl.C.dispose(); pl.H.dispose(); pl.A.dispose(); for (const l of pl.amb || []) l.h.stop(); } } catch (e) {}
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
