// ═══════════════════════════════════════
//  «КУБОМИР» (#/games/kubomir) — своя песочница из кубиков: бесконечный мир по зерну, выживание и творчество,
//  руды и инструменты, верстак и печь, мобы днём и ночью, вода и песок, сохранения и моды
// ═══════════════════════════════════════
// Движок кубиков — js/engine/voxel*.js (данные, генерация и свет+сетки в потоках, подгрузка, графика, сохранения, моды);
// небо по времени суток, туман, тени, качество, FSR — общий рендер движка (render.js + gfx.js), управление — controls.js
// (клавиатура и мышь с захватом, геймпад, кнопки телефона), камера — camera.js (1-е и 3-е лицо), игрок — свой персонаж
// (world3d.js через actors.js). Мобы, выпавшие вещи, падающий песок, течение воды и лавы, печи — kubomir-ents.js;
// окна вещей (инвентарь, верстак, печь, сундук, каталог творчества) — kubomir-ui.js.
// Маршруты: #/games/kubomir — миры; #/games/kubomir/play/<id> — сразу в мир. Награды: достижения (только выживание) —
// монеты D37Coins.run('kubomir', …) один раз на аккаунт, XP — game_result('kubomir') в общем лимите игр.
(() => {
  const ID = 'kubomir';
  const E = () => window.D37E, VX = () => window.D37E.vox;
  const PI = Math.PI;
  const DAY_SEC = 20 * 60;                 // сутки игры — 20 минут
  const REACH = 5, REACH_C = 6.5;
  const G_ACC = 32, JUMP_V = 9, TERM = 60;
  const SPD = { walk: 4.3, sprint: 5.7, sneak: 1.35, fly: 11, flyFast: 22, swim: 2.4 };
  const PW = .6, PH = 1.8, PHS = 1.5;
  const RD_OPTS = [4, 6, 8, 10, 12, 16];
  const LS_OPT = 'd37_kb_opt', LS_ACH = 'd37_kb_ach';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => performance.now();
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  // ── Достижения: монеты — один раз на аккаунт (ref kb:<id>), только в выживании ──
  const ACH = [
    ['log', '🪵', 'Первое бревно', 'Добудь бревно', 3], ['table', '🛠️', 'Мастерская', 'Сделай верстак', 3],
    ['pick', '⛏️', 'За работу!', 'Сделай кирку', 3], ['stone_pick', '🪨', 'Каменный век', 'Сделай каменную кирку', 4],
    ['coal', '⚫', 'Есть огонь', 'Добудь уголь', 3], ['torch', '🔥', 'Да будет свет', 'Поставь факел', 3],
    ['furnace', '🧱', 'Горячая штучка', 'Сделай печь', 4], ['iron', '🔩', 'Железный век', 'Выплавь железный слиток', 6],
    ['diamond', '💎', 'Алмазы!', 'Добудь алмаз', 15], ['cook', '🍖', 'Повар', 'Пожарь мясо', 4],
    ['night', '🌙', 'Пережил ночь', 'Встреть утро в выживании', 5], ['zombie', '🧟', 'Охотник', 'Победи зомби', 5],
    ['far', '🧭', 'Путешественник', 'Уйди на 1000 блоков от начала', 8], ['deep', '🕳️', 'Глубоко копаешь', 'Спустись ниже 12-го уровня', 5],
    ['high', '🏔️', 'Покоритель вершин', 'Поднимись выше 100-го уровня', 5], ['builder', '🏠', 'Строитель', 'Поставь 200 блоков', 6],
    ['door', '🚪', 'Свой дом', 'Поставь дверь', 3], ['bounce', '🟩', 'Прыг-скок', 'Подпрыгни на батуте', 3],
  ];
  const ACH_BY = new Map(ACH.map(a => [a[0], a]));

  let el = null, api = null, S = null, view = 'menu', opts = null;
  // без kubomir-input.js (не загрузился) — молчаливая заглушка: игра работает на общем управлении
  const NOK = { step(){}, down: () => false, downRaw: () => false, held: () => false, heldTime: () => 0, up: () => false, ctrl: false, pad: false, finger: null, taps: [], fingerHolding: () => false, frameEnd(){}, label: () => '', reset(){} };
  // дальность по умолчанию: телефон — 6 (безопасно для слабых видеокарт), «низкая» графика — 4, «высокая» на компьютере — 10
  const optsLoad = () => { const Ex = E(), q = Ex?.gfxQuality?.() || 'mid', phone = !!Ex?.isMobile?.(); return Object.assign({ rd: q === 'low' ? 4 : phone ? 6 : q === 'high' ? 10 : 8, auto: null, sens: 1 }, lsGet(LS_OPT, {})); };
  function css(){
    if (document.getElementById('kb-css')) return;
    const l = document.createElement('link'); l.id = 'kb-css'; l.rel = 'stylesheet';
    l.href = 'css/kubomir.css?v=' + (typeof GAMES_VER !== 'undefined' ? GAMES_VER : '1');
    document.head.appendChild(l);
  }
  const ver = () => (typeof GAMES_VER !== 'undefined' ? GAMES_VER : '1');

  // ═══ Вход в игру ═══
  function mount(root, gapi){
    el = root; api = gapi; css(); opts = optsLoad();
    const FS = window.D37Full;
    el.innerHTML = `<div class="wld kb gs-noesc">
        <div class="wld-top kb-top"><b>🧊 Кубомир</b><span class="kb-where"></span>
          <span class="wld-topbtns"><button type="button" data-kb="settings" title="Настройки: графика, звук, управление (Esc — меню)">⚙️</button>${FS ? FS.rotBtn('#gamesStage') + FS.btn('#gamesStage', { esc: false, cls: 'gs-fullbtn' }) : ''}<button type="button" data-kb="help" title="Как играть">❓</button></span></div>
        <div class="wld-wrap kb-wrap is3d"><div class="kb-screen"></div></div>
      </div>`;
    el.querySelector('.kb-top').addEventListener('click', e => { const b = e.target.closest('[data-kb]'); if (!b) return; onTop(b.dataset.kb); });
    el.closest('#gamesStage')?.classList.add('gm-own-bar');
    const p = String(gapi?.param || '');
    const m = /^play\/([\w-]+)$/.exec(p);
    if (m) playById(m[1]); else showMenu();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
  }
  function unmount(){
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVis);
    if (S) { journalNow(); stopWorld({ quick: true }); }
    el = null; api = null;
  }
  function onTop(a){
    if (a === 'settings') { if (window.D37Settings) window.D37Settings.open({ ctx: S ? 'engine' : 'game', tab: S ? 'kubomir' : undefined }); }
    else if (a === 'help') help();
  }
  const screen = () => el?.querySelector('.kb-screen');
  const wrap = () => el?.querySelector('.kb-wrap');

  // ═══ Меню: мои миры ═══
  async function showMenu(){
    view = 'menu';
    const sc = screen(); if (!sc) return;
    setWhere('');
    sc.innerHTML = `<div class="kb-menu"><div class="kb-logo"><span>🧊</span><div><b>Кубомир</b><small>Бесконечный мир из кубиков: строй, копай, выживай</small></div></div>
      <div class="kb-mbtns"><button type="button" class="kb-btn primary" data-m="new">➕ Новый мир</button><button type="button" class="kb-btn" data-m="import">📂 Загрузить файл мира</button><button type="button" class="kb-btn" data-m="mc">📥 Из Minecraft</button><button type="button" class="kb-btn" data-m="mods">🧩 Моды</button><button type="button" class="kb-btn" data-m="ach">🏆 Достижения</button></div>
      <div class="kb-worlds"><div class="kb-note">⏳ Загружаем миры…</div></div>
      <input type="file" class="kb-file" accept=".kubomir,.json,application/json" hidden></div>`;
    sc.querySelector('.kb-mbtns').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; menuAct(b.dataset.m); });
    sc.querySelector('.kb-file').addEventListener('change', e => importFile(e.target.files?.[0]));
    const V = VX(), [list] = await Promise.all([V.store.worlds().catch(() => []), window.KubomirMods?.ready?.()?.catch?.(() => {})]);
    if (view !== 'menu' || !el) return;
    const box = sc.querySelector('.kb-worlds');
    if (!V.store.persistent()) box.insertAdjacentHTML('beforebegin', '<div class="kb-warn">⚠️ Браузер не даёт сохранять в базу (приватный режим?) — мир сохранится, только пока открыта вкладка. Выгружай мир в файл.</div>');
    if (!list.length) { box.innerHTML = '<div class="kb-empty">Миров пока нет. Нажми «➕ Новый мир» — и вперёд!</div>'; return; }
    box.innerHTML = list.map(w => `<div class="kb-world" data-id="${esc(w.id)}">
        <div class="kb-thumb">${w.thumb ? `<img src="${esc(w.thumb)}" alt="">` : '<span>🧊</span>'}</div>
        <div class="kb-wi"><b>${esc(w.name)}</b><small>${w.mode === 'creative' ? '🎨 Творчество' : '⚔️ Выживание'} · зерно ${esc(w.seed)} · ${new Date(w.played || w.created || Date.now()).toLocaleDateString('ru')}${w.mods?.length ? ' · 🧩 ' + w.mods.length : ''}</small></div>
        <div class="kb-wb"><button type="button" class="kb-btn primary" data-w="play">▶ Играть</button><button type="button" class="kb-btn" data-w="rename" title="Переименовать">✏️</button><button type="button" class="kb-btn" data-w="export" title="Выгрузить файл мира">📤</button><button type="button" class="kb-btn danger" data-w="del" title="Удалить">🗑</button></div></div>`).join('');
    box.addEventListener('click', e => { const b = e.target.closest('[data-w]'), w = e.target.closest('.kb-world'); if (!b || !w) return; worldAct(b.dataset.w, w.dataset.id, list.find(x => x.id === w.dataset.id)); });
  }
  function menuAct(a){
    if (a === 'new') newWorldDialog();
    else if (a === 'import') screen()?.querySelector('.kb-file')?.click();
    else if (a === 'mods') window.KubomirMods?.library(screen(), { back: showMenu, mc: file => window.KubomirMC?.open(screen(), { back: () => menuAct('mods'), play: id => playById(id), file }) });
    else if (a === 'mc') window.KubomirMC?.open(screen(), { back: showMenu, play: id => playById(id) });
    else if (a === 'ach') achScreen();
  }
  async function worldAct(a, id, w){
    const V = VX();
    if (a === 'play') return playById(id);
    if (a === 'rename') { const n = prompt('Новое название мира', w?.name || ''); if (n && w) { w.name = n.trim().slice(0, 40) || w.name; await V.store.putWorld(w); showMenu(); } return; }
    if (a === 'export') return exportWorld(id);
    if (a === 'del') {
      const ok = window.GameKit?.ask ? await window.GameKit.ask(`Удалить мир «${w?.name}»? Это нельзя отменить.`, { yes: '🗑 Удалить', no: 'Нет' }) : confirm(`Удалить мир «${w?.name}»?`);
      if (ok) { await V.store.delWorld(id); showMenu(); }
    }
  }
  function newWorldDialog(){
    const sc = screen(); if (!sc) return;
    const V = VX(), mods = window.KubomirMods?.list?.() || [];
    sc.innerHTML = `<div class="kb-menu kb-new"><h3>➕ Новый мир</h3>
      <label>Название<input type="text" class="kb-in" data-f="name" maxlength="40" value="Мой мир"></label>
      <label>Зерно <small>(число или слово — один и тот же мир у всех, оставь пустым — случайный)</small><input type="text" class="kb-in" data-f="seed" maxlength="32" placeholder="случайное"></label>
      <div class="kb-seg" data-f="mode"><button type="button" class="on" data-v="survival">⚔️ Выживание</button><button type="button" data-v="creative">🎨 Творчество</button></div>
      <div class="kb-seg" data-f="diff"><button type="button" data-v="peaceful">🕊 Мирно</button><button type="button" class="on" data-v="easy">🙂 Легко</button><button type="button" data-v="normal">😈 Обычно</button><button type="button" data-v="hard">💀 Сложно</button></div>
      <p class="kb-note kb-diffnote">Легко: ночью приходят мобы, но после смерти вещи остаются.</p>
      ${mods.length ? `<div class="kb-modpick"><b>🧩 Моды в этом мире</b>${mods.map(m => `<label class="kb-chk"><input type="checkbox" data-mod="${esc(m.id)}"> ${esc(m.manifest?.name || m.id)} <small>${esc(m.manifest?.version || '')}</small></label>`).join('')}</div>` : '<p class="kb-note">🧩 Моды можно добавить в меню миров → «Моды».</p>'}
      <div class="kb-mbtns"><button type="button" class="kb-btn primary" data-n="go">🌍 Создать мир</button><button type="button" class="kb-btn" data-n="back">← Назад</button></div></div>`;
    const DN = { peaceful: 'Мирно: мобов-врагов нет, голод не отнимает здоровье.', easy: 'Легко: ночью приходят мобы, но после смерти вещи остаются.', normal: 'Обычно: после смерти вещи выпадают — успей их подобрать.', hard: 'Сложно: мобов больше и бьют в полтора раза сильнее, голод может убить, вещи после смерти выпадают.' };
    sc.querySelectorAll('.kb-seg').forEach(g => g.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); if (g.dataset.f === 'diff') sc.querySelector('.kb-diffnote').textContent = DN[b.dataset.v]; }));
    sc.querySelector('[data-n="back"]').onclick = showMenu;
    sc.querySelector('[data-n="go"]').onclick = async () => {
      const f = k => sc.querySelector(`[data-f="${k}"]`);
      const name = f('name').value.trim().slice(0, 40) || 'Мой мир';
      let seed = f('seed').value.trim().slice(0, 32);
      if (!seed) seed = String(Math.floor(Math.random() * 2e9));
      const mode = f('mode').querySelector('.on')?.dataset.v || 'survival', diff = f('diff').querySelector('.on')?.dataset.v || 'easy';
      const modIds = [...sc.querySelectorAll('[data-mod]:checked')].map(x => x.dataset.mod);
      const w = { id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, seed, mode, diff, created: Date.now(), played: Date.now(), time: 8, mods: modIds, palette: null, player: null, v: 1, genVer: 2 };
      await V.store.putWorld(w);
      playWorld(w);
    };
  }
  async function playById(id){
    const w = await VX().store.world(id).catch(() => null);
    if (!w) { toastMsg('Мир не найден'); showMenu(); return; }
    playWorld(w);
  }
  async function exportWorld(id){
    const V = VX(), obj = await V.store.exportWorld(id);
    if (!obj) return;
    // моды мира — в тот же файл (на другом компьютере мир откроется с ними)
    try { const mods = await window.KubomirMods?.pack?.(obj.world.mods || []); if (mods?.length) obj.mods = mods; } catch (e) {}
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (obj.world.name || 'мир').replace(/[\\/:*?"<>|]+/g, '_') + '.kubomir'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function importFile(file){
    if (!file) return;
    try {
      if (file.size > 60e6) throw new Error('файл больше 60 МБ');
      const obj = JSON.parse(await file.text());
      const w = await VX().store.importWorld(obj, 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      const got = Array.isArray(obj.mods) ? await window.KubomirMods?.unpack?.(obj.mods).catch(() => null) : null;
      toastMsg('📥 Мир «' + w.name + '» загружен' + (got?.added?.length ? ' + моды: ' + got.added.join(', ') : '')); showMenu();
    } catch (e) { toastMsg('Не получилось: ' + (e.message || e)); }
  }
  function achScreen(){
    const sc = screen(); if (!sc) return;
    const got = lsGet(LS_ACH, {});
    sc.innerHTML = `<div class="kb-menu"><h3>🏆 Достижения</h3><p class="kb-note">Только в режиме «Выживание». За каждое — монеты 🪙 (один раз), а XP — как за победу в игре.</p>
      <div class="kb-achs">${ACH.map(a => `<div class="kb-ach${got[a[0]] ? ' on' : ''}"><span>${a[1]}</span><b>${esc(a[2])}</b><small>${esc(a[3])} · +${a[4]} 🪙</small></div>`).join('')}</div>
      <div class="kb-mbtns"><button type="button" class="kb-btn" data-n="back">← Назад</button></div></div>`;
    sc.querySelector('[data-n="back"]').onclick = showMenu;
  }
  function help(){
    const t = window.D37Full?.isTouch?.() || E()?.isTouch?.();
    const txt = t ? (opts.touchMode === 'cross'
        ? 'Джойстик слева — идти, палец справа — смотреть. Прицел в центре: нажми по экрану — поставить/открыть, держи — ломать (или ⛏ и 🧱). ⤒ — прыжок (два раза в «Творчестве» — полёт, ⤓ — вниз), ⬇ — красться, 🎒 — вещи. Панель вещей — проведи пальцем, подержи ячейку — выбросить.'
        : 'Как в Bedrock: джойстик слева — идти, палец справа — смотреть. Нажми по блоку — поставить/открыть/съесть, держи палец на блоке — ломать (вокруг пальца — кольцо), нажми по мобу — удар. ⤒ — прыжок (два раза в «Творчестве» — полёт, ⤓ — вниз), ⬇ — красться, 🎒 — вещи. Панель вещей — проведи пальцем, подержи ячейку — выбросить. В ⚙️ можно включить «прицел».')
      : 'Как в Майнкрафте: WASD — идти, Пробел — прыжок (два раза в «Творчестве» — полёт), Shift — красться (с края не упадёшь), Ctrl или два раза W — бег. ЛКМ (держать) — ломать, ПКМ — поставить/открыть/съесть, СКМ — взять блок в руку, колесо и 1–9 — ячейки, Q — выбросить (Ctrl+Q — стопку), E — вещи, F5 — вид, F1 — спрятать интерфейс, F3 — сведения, T или Enter — чат, / — команда (/help), Esc — меню. В вещах: Shift+клик — перекинуть, ПКМ с протяжкой — по одной в каждую ячейку, ЛКМ с протяжкой — поровну, двойной клик — собрать. Геймпад: RT — ломать, LT — ставить, LB/RB — ячейки, Y — вещи, B — красться. Клавиши — в ⚙️ → «🧊 Кубомир».';
    if (window.GameKit?.ask) window.GameKit.ask(txt, { yes: 'Понятно', no: null }); else alert(txt);
  }
  function setWhere(t){ const w = el?.querySelector('.kb-where'); if (w) w.textContent = t; }
  function toastMsg(t, ok){ if (S?.H) S.H.toast(t, ok); else if (typeof gameToast === 'function') gameToast(t); }

  // ═══ Мир: запуск ═══
  async function playWorld(meta){
    const sc = screen(); if (!sc) return;
    view = 'loading';
    sc.innerHTML = '<div class="kb-load"><div class="spinner"></div><b>Загружаем мир…</b><small class="kb-lp"></small></div>';
    setWhere(meta.name);
    const adL = window.D37AdPlaces?.loading?.({ anchor: sc.firstChild, game: ID });
    const ok = await E().load();
    adL?.done?.();
    if (!el || view !== 'loading') return;
    if (!ok) { sc.innerHTML = '<div class="kb-menu"><b>Не загрузилась 3D-графика</b><p class="kb-note">Проверь интернет и обнови страницу. Нужен браузер с WebGL.</p></div>'; return; }
    try { await startWorld(meta); }
    catch (e) { console.error(e); stopWorld({ quick: true }); sc.innerHTML = `<div class="kb-menu"><b>Мир не открылся</b><p class="kb-note">${esc(e.message || e)}</p><button type="button" class="kb-btn" data-n="back">← К мирам</button></div>`; sc.querySelector('[data-n="back"]').onclick = showMenu; }
  }

  async function startWorld(meta){
    const Ex = E(), V = VX(), sc = screen(), wr = wrap();
    // журнал (вкладку закрыли до сохранения) — сначала дописать в базу
    const J = V.store.takeJournal(meta.id);
    if (J) {
      try {
        if (J.recs?.length) {
          const recs = [];
          for (const r of J.recs) { const old = await V.store.chunk(meta.id, r.cx, r.cz).catch(() => null); recs.push({ cx: r.cx, cz: r.cz, e: new Uint32Array(V.store.unb64(r.e).buffer), t: r.t || [], b: old?.b }); }   // «основа» (мир из Minecraft) — не терять
          await V.store.putChunks(meta.id, recs);
        }
        if (J.meta) Object.assign(meta, J.meta); await V.store.putWorld(meta);
      } catch (e) { console.error(e); }
    }
    // моды мира: блоки, вещи, рецепты, текстуры, фичи генерации, скрипты
    const modState = window.KubomirMods ? await window.KubomirMods.forWorld(meta) : { features: [], loaded: [] };
    // перенос из Minecraft: цветные блоки «mc:…» мира, пакет текстур; мир «без земли» — весь из сохранения
    try { await window.KubomirMC?.beforeWorld(meta); } catch (e) { console.error(e); }
    if (meta.gen === 'void') modState.features = [...modState.features, { type: 'void' }];
    V.compile();
    // палитра мира: номер в сохранении → имя блока
    if (!Array.isArray(meta.palette) || !meta.palette.length) meta.palette = V.blocks.map(b => b.name);
    const remapIn = new Uint16Array(4096), palIdx = new Map(meta.palette.map((n, i) => [n, i]));
    for (let i = 0; i < meta.palette.length && i < 4096; i++) { const b = V.block(meta.palette[i]); remapIn[i] = b ? b.id : V.ID.missing; }
    for (const b of V.blocks) if (!palIdx.has(b.name)) { palIdx.set(b.name, meta.palette.length); meta.palette.push(b.name); }
    const remapOut = new Uint16Array(V.blocks.length); for (const b of V.blocks) remapOut[b.id] = palIdx.get(b.name);
    sc.innerHTML = '';
    view = 'world';
    const R = Ex.renderer(wr, { quality: Ex.gfxQuality() });
    R.r.domElement.classList.add('kb-gl');
    const W = new V.World({ seed: meta.seed });
    const G = V.genInit(W.seed, { features: modState.features, ver: meta.genVer || 1 });   // genVer: старые миры — 1 (как были), новые — 2
    const st = {
      meta, W, G, R, mods: modState, remapIn, remapOut, ox: 0, oz: 0, t: 0, steps: 0, ready: false, dead: false, paused: false, saving: false,
      unsaved: new Set(), savedKeys: await V.store.chunkKeys(meta.id).catch(() => new Set()), lastSave: now(), creative: meta.mode === 'creative',
      hit: null, mine: { key: '', t: 0, need: 0, st: -1, cool: 0 }, placeCool: 0, eat: null, hud: {}, keys: { q: false }, raw: new Set(),
      stats: { placed: 0, fps: 0 }, chat: [], achQ: [], dayPrev: null,
    };
    S = st;
    // новые блоки посреди игры (постройка из Minecraft с блоками «mc:…»): реестр, палитра мира, картинки, потоки
    st.addBlocks = names => {
      const n = window.KubomirMC?.registerBlocks(names) || 0; if (!n) return 0;
      for (const b of V.blocks) if (!palIdx.has(b.name)) { palIdx.set(b.name, meta.palette.length); meta.palette.push(b.name); }
      const ro = new Uint16Array(V.blocks.length); for (const b of V.blocks) ro[b.id] = palIdx.get(b.name); st.remapOut = ro;
      for (let i = 0; i < meta.palette.length && i < 4096; i++) { const b = V.block(meta.palette[i]); remapIn[i] = b ? b.id : V.ID.missing; }
      meta.mc = meta.mc || { blocks: [] }; for (const nm of names) if (!meta.mc.blocks.includes(nm)) meta.mc.blocks.push(nm);
      st.VR?.rebuildTextures(); st.ST?.reinit(st.mods.features);
      return n;
    };
    // свет и время суток (небо движка): своя дальность тумана — по дальности прорисовки
    R.setLighting({ time: meta.time ?? 8, brightness: .66, ambient: .82, fogEnd: fogFor(R), shadows: true, gfx: { sky: { haze: .2, clouds: .9 }, fog: { density: 0, height: 0, sun: .5 }, grade: 'neutral', bloom: .8 } });
    dayLight(R);
    R.clouds(R.q === 'low' ? 8 : 14, 3);
    const VR = st.VR = V.renderer(R);
    st.KL = window.KubomirLight ? window.KubomirLight.create(st) : null;   // настоящие лампы, факел в руке, туман в пещере
    // подгрузка мира
    const url = 'js/engine/voxel-worker.js?v=' + ver();
    st.ST = V.streamer({ world: W, rd: opts.rd, url, features: modState.features, genVer: meta.genVer || 1,
      load: c => st.savedKeys.has(c.cx + '|' + c.cz) ? V.store.chunk(meta.id, c.cx, c.cz) : null,
      applySaved: (c, rec) => applySaved(c, rec),
      onGen: c => { st.ents?.onChunkTiles?.(c); },
      onMesh: (c, m) => { VR.setChunk(c, m); st.KL?.onChunk(c, m); },
      onDrop: c => { VR.dropChunk(c); st.KL?.onDrop(c); if (st.unsaved.has(c.key)) saveChunks([c]); window.KubomirEnts?.onDrop?.(st, c); },
      log: t => console.warn('Кубомир:', t) });
    W.listeners.push((x, y, z, was, v, o) => onEdit(x, y, z, was, v, o));
    // управление, камера, звук, интерфейс
    const C = st.C = Ex.controls({});
    const I = st.I = Ex.input(wr, { controls: C, ignore: 'button, a, input, .e-btn, .kb-ui, .kb-hud button, .gs-menu, .kb-chat' });
    // камера — всегда «от 1-го лица» движка (мышь, тряска, бег); вид сзади и спереди (F5) — сдвигом камеры в frame()
    st.rig = Ex.cameraRig(R.camera, { yaw: 0, pitch: .25, dist: 4.4, minD: 1.6, maxD: 9, lift: 1.5, mode: 'first' });
    st.rig.minP = -1.25; st.rig.maxP = 1.4; st.rig.maxLook = 89 * PI / 180; st.rig.fovFirst = 70;
    st.camMode = window.D37Settings?.get('view') === 'third' ? 1 : 0; st.camD = 0;
    st.H = Ex.ui(wr, C);
    st.AU = Ex.audio(); sounds();
    st.hudEl = hudBuild(wr); st.hurtEl = st.hudEl.querySelector('.kb-hurt');
    // вспышка молнии (гром вдалеке): мягко, k ≤ 0,22
    st.flash = k => { const f = st.hudEl?.querySelector('.kb-flash'); if (!f) return; f.style.transition = 'none'; f.style.opacity = String(Math.min(.22, k)); void f.offsetWidth; f.style.transition = 'opacity .45s ease-out'; f.style.opacity = '0'; };
    // свои клавиши «Кубомира» (как в Майнкрафте), геймпад, палец по миру; кнопки телефона — как в Bedrock
    st.K = window.KubomirInput ? window.KubomirInput.create({ el: wr, C, isOpen: () => !!(S && (S.ui?.isOpen() || S.menu || S.modWin || S.chatEl)) }) : null;
    // игрок
    const P = st.P = { x: 0, y: 80, z: 0, vx: 0, vy: 0, vz: 0, w: PW, h: PH, onGround: false, fly: st.creative, sneak: false, sprint: false, water: 0, lava: 0, climb: false, eyeWater: false,
      fallTop: 80, hp: 20, food: 20, sat: 5, exh: 0, air: 15, regT: 0, starveT: 0, hurtT: 0, inv: new Array(36).fill(null), sel: 0, cursor: null, dead: false, stepT: 0, lastStepX: 0, lastStepZ: 0, bodyYaw: 0, swimT: 0 };
    const sp = meta.spawn || (meta.spawn = V.findSpawn(G, 0, 0));
    const pl = meta.player;
    if (pl && Number.isFinite(pl.x)) { Object.assign(P, { x: pl.x, y: pl.y, z: pl.z, hp: pl.hp ?? 20, food: pl.food ?? 20, sat: pl.sat ?? 5, sel: pl.sel | 0, fly: st.creative && !!pl.fly }); invLoad(P.inv, pl.inv); st.rig.yaw = pl.yaw || 0; st.rig.fp = pl.pitch || 0; }
    else { P.x = sp.x; P.y = sp.y; P.z = sp.z; if (!st.creative) giveStart(P); else { P.inv[0] = { id: 'grass', n: 64 }; P.inv[1] = { id: 'planks_oak', n: 64 }; P.inv[2] = { id: 'torch', n: 64 }; P.inv[3] = { id: 'glass', n: 64 }; } }
    P.fallTop = P.y;
    rebase(true);
    // свой персонаж (виден от 3-го лица)
    st.A = Ex.actors(R);
    const look = Object.assign({}, window.D37Char ? window.D37Char.look() : {}, { item: 'none' });
    st.A.add('me', look, { x: P.x - st.ox, y: P.y, z: P.z - st.oz, yaw: 0 });
    // сущности и окна
    st.ents = window.KubomirEnts ? window.KubomirEnts.create(st) : null;
    if (st.ents) { st.ents.hookHurt = (n, m) => hurt(st, n, 'mob', m); st.ents.hookUnlock = id => unlock(id); st.ents.give = s => give(st, s); st.ents.room = s => room(st, s);
      st.ents.hookPickup = (id, n) => { popSlot(st, id); st.modRun?.event('pickup', { item: id, n }); };   // моды: подобрал вещь, победил моба
      st.ents.hookKill = (m, by) => { if (by === 'player') st.modRun?.event('mobKill', { mob: m.type, x: m.x, y: m.y, z: m.z }); }; }
    if (meta.ents && st.ents) st.ents.load(meta.ents);
    st.hand = window.KubomirHand && window.KubomirEnts?.Lit ? window.KubomirHand.create(st) : null;   // руки как в Майнкрафте, свет человечков
    st.weatherOff = opts.weather === false;
    st.seasons = ['calendar', 'cycle', 'off'].includes(opts.seasons) ? opts.seasons : 'calendar';   // времена года (движок погоды)
    st.WX = window.KubomirWeather ? window.KubomirWeather.create(st) : null;   // дождь и снег по биому (расписание — от зерна и дня)
    st.ui = window.KubomirUI ? window.KubomirUI.create(st, uiHooks()) : null;
    if (I.touch) touchUI(st);   // кнопки телефона — когда уже есть игрок
    crossUpdate(st);
    // моды: события в песочнице
    st.modRun = window.KubomirMods ? window.KubomirMods.run(st, modState, modHooks()) : null;
    // настройки, полный экран, телефон
    st.stage = el.closest('#gamesStage');
    st.offCtx = window.D37Settings?.context({ engine: true, R: () => S?.R, gfx: () => setTimeout(() => restartWorld(), 60), view: v => { if (S && S.rig.mode !== v) toggleView(); }, onClose: () => S?.C?.reset_state() });
    settingsTab();
    st.ro = window.ResizeObserver ? new ResizeObserver(() => { if (S?.R && !S.R.dead) S.R.resize(); }) : null;
    st.ro?.observe(wr); R.resize();
    st.loop = Ex.loop(update, frame);
    st.tick = setInterval(housekeeping, 1000);
    setWhere(meta.name + (st.creative ? ' · 🎨' : ''));
    meta.played = Date.now();
    V.store.putWorld(meta).catch(() => {});
    if (modState.loaded.length) unlock('mod');
  }
  // туман движка начинается с 30 % дальности — у кубиков видно дальше: начало тумана — 60 % (конец прячет край мира)
  function fogNear(st){ const f = st.R.scene.fog; if (f && !(st.uwK > 0) && f.far > 20) f.near = f.far * .6; }
  // глубина глаз под гладью воды (м; над водой — меньше 0, воды нет — −9)
  function eyeDepth(st){
    const V = VX(), W = st.W, P = st.P, ey = P.y + (P.sneak ? 1.27 : 1.62), Tl = V.T.liquid;
    let y = Math.floor(ey), v = W.raw(P.x, y, P.z);
    if (!(v > 0 && Tl[v & 0xfff] === 1)) { y--; v = W.raw(P.x, y, P.z); if (!(v > 0 && Tl[v & 0xfff] === 1)) return -9; }
    for (let n = 0; n < 24; n++) { const u = W.raw(P.x, y + 1, P.z); if (!(u > 0 && Tl[u & 0xfff] === 1)) break; y++; v = u; }
    return y + V.liquidHeight(v) - ey;
  }
  // Под водой — вид (и звук — ниже): с запасом по глубине глаз (нырнул — глубже 0,08, вынырнул — выше 0,05: на плаву глаза
  // качаются у самой глади, и без запаса туман и цвет кадра переключались каждый кадр — «моргало») и плавно за 0,25 с
  // (R.setUnder с { near, far, k }: туман смешивается с обычным). Видно 16–24 блока: днём у поверхности — дальше, глубже и ночью —
  // ближе и темнее. Пока k > 0, туман неба (раз в 0,25 с, погода, пещера) его не перебивает: render.js применяет подводный поверх.
  let UWC = null, UWB = null;
  const UWO = { near: 1, far: 20, k: 0 };
  function underwater(st, dt){
    const R = st.R, dep = eyeDepth(st);
    st.uw = st.uw ? dep > -.05 : dep > .08;
    st.uwK = clamp((st.uwK || 0) + (st.uw ? dt : -dt) / .25, 0, 1);
    if (st.uwK > 0) {
      if (!UWC) { UWC = new R.T.Color(); UWB = new R.T.Color('#1f6aa6'); }
      const P = st.P, day = 1 - clamp(R.night || 0, 0, 1), sky = VX().lSky(st.W.lightAt(P.x, P.y + 1.6, P.z)) / 15, d = Math.max(0, dep);
      const lum = (.22 + .78 * day) * (.4 + .6 * sky) * (1 - Math.min(.45, d * .025));
      UWC.copy(UWB).multiplyScalar(lum);
      UWO.far = 16 + 8 * day * sky * (1 - Math.min(1, d / 30)); UWO.near = 1; UWO.k = st.uwK * st.uwK * (3 - 2 * st.uwK);
      R.setUnder?.(true, UWC, UWO);
      st.uwOn = true;
    } else if (st.uwOn) { st.uwOn = false; R.setUnder?.(false); fogNear(st); st.KL?.afterSky(); }
    // звук под водой: всё глуше и тише (фильтр в движке), тихий подводный фон — гул и редкие пузыри
    const A = st.AU; if (!A) return;
    A.muffle?.(st.uwK);
    if (st.uwK > 0 && !st.uwLoop && A.loop) st.uwLoop = A.loop('kb_underwater', { vol: 0 });
    if (st.uwLoop) { if (st.uwK > 0) st.uwLoop.set({ vol: .5 * st.uwK }); else { st.uwLoop.stop(); st.uwLoop = null; } }
  }
  // яркость солнца и неба: днём мягче, чем у движка по умолчанию (иначе трава и песок выгорают в белёсое), ночью луна чуть
  // тусклее движковой (темно, но видно дорогу) — свет факелов от этого не зависит: ночью и в пещерах он заметен пятнами
  // w — сила непогоды (0…1): в дождь солнце и небо тусклее
  function dayLight(R, w = 0){ const n = Math.max(0, Math.min(1, R.night || 0)); R.lighting.brightness = (.66 - .16 * n) * (1 - .34 * w); R.lighting.ambient = (.82 - .12 * n) * (1 - .2 * w); }
  function fogFor(R){ const O = R.opt || { dist: 1, fog: true }; return Math.max(40, (opts.rd * 16 - 10) / (O.dist || 1) / (O.fog === false ? 1.6 : 1)); }
  function giveStart(P){ P.inv[0] = null; }
  function invLoad(inv, arr){ if (!Array.isArray(arr)) return; for (let i = 0; i < inv.length; i++) { const s = arr[i]; inv[i] = s && VX().item(s.id) && s.n > 0 ? { id: s.id, n: Math.min(s.n | 0, VX().item(s.id).stack), d: s.d | 0 } : null; } }

  async function stopWorld(o = {}){
    const st = S; if (!st) return;
    S = null;
    try { if (!o.quick) await saveAll(st, true); else saveAll(st, true); } catch (e) { console.error(e); }
    try { st.loop?.stop(); } catch (e) {}
    clearInterval(st.tick);
    st.ro?.disconnect();
    st.offCtx?.();
    try { st.modRun?.stop(); } catch (e) {}
    try { st.ents?.dispose(); } catch (e) {}
    try { st.hand?.dispose(); } catch (e) {}
    try { st.ui?.dispose(); } catch (e) {}
    try { st.KL?.dispose(); } catch (e) {}
    try { st.WX?.dispose(); } catch (e) {}
    try { st.AU?.muffle?.(0); st.uwLoop?.stop(); st.uwLoop = null; } catch (e) {}   // звук — снова чистый (движок общий для игр)
    st.ST?.close(); st.VR?.dispose(); st.A?.dispose();
    st.C?.dispose(); st.I?.dispose(); st.H?.dispose(); st.K?.dispose();
    try { st.R?.dispose(); } catch (e) {}
    st.hudEl?.remove(); st.modWin?.remove(); st.tbar?.el?.remove(); st.ringEl?.remove(); st.lockEl?.remove();
    wrap()?.classList.remove('kb-nohud', 'kb-touchtap');
    settingsTab(true);
  }
  async function restartWorld(){ if (!S) return; const m = S.meta; await stopWorld(); playWorld(m); }

  // ═══ Сохранение ═══
  function applySaved(c, rec){
    const V = VX(), e = rec.e, ri = S.remapIn;
    // «основа» — целый слой чанка (мир или постройка из Minecraft), сжатый повторами; правки игрока — поверх
    if (rec.b && rec.b.length && window.KubomirMC) {
      const raw = new Uint16Array(V.CELLS);
      if (window.KubomirMC.unrle(rec.b, raw) === V.CELLS) {
        for (let i = 0; i < raw.length; i++) { const v = raw[i]; if (v) c.ids[i] = ((ri[v & 0xfff] ?? V.ID.missing) & 0xfff) | (v & 0xf000); }
        c.base = rec.b;
      }
    }
    if (e && e.length) {
      c.edits = c.edits || new Map();
      for (let i = 0; i < e.length; i++) {
        const k = e[i] >>> 16, v = e[i] & 0xffff, t = ri[v & 0xfff] ?? V.ID.missing, cv = (t & 0xfff) | (v & 0xf000);
        c.ids[k] = cv; c.edits.set(k, cv);
      }
    }
    if (rec.t && rec.t.length) { c.tiles = new Map(); for (const [k, t] of rec.t) if (Number.isInteger(k) && t && typeof t === 'object') c.tiles.set(k, t); }
  }
  function chunkRec(c, st = S){
    const out = new Uint32Array(c.edits ? c.edits.size : 0); let i = 0;
    if (c.edits) for (const [k, v] of c.edits) out[i++] = ((k & 0x7fff) << 16 | ((st.remapOut[v & 0xfff] ?? 0) | (v & 0xf000))) >>> 0;
    const r = { cx: c.cx, cz: c.cz, e: out, t: c.tiles ? [...c.tiles] : [] };
    if (c.base) r.b = c.base;   // мир из Minecraft: слой как был + правки
    return r;
  }
  function saveChunks(list, st = S){
    if (!st || !list.length) return Promise.resolve();
    const recs = list.map(c => chunkRec(c, st));
    for (const c of list) { st.unsaved.delete(c.key); st.savedKeys.add(c.cx + '|' + c.cz); }
    return VX().store.putChunks(st.meta.id, recs).catch(e => console.error(e));
  }
  function metaSnap(st = S){
    const P = st.P, m = st.meta;
    m.player = { x: P.x, y: P.y, z: P.z, yaw: st.rig.yaw, pitch: st.rig.fp, hp: P.hp, food: P.food, sat: P.sat, sel: P.sel, fly: P.fly, inv: P.inv.map(s => s ? { id: s.id, n: s.n, d: s.d | 0 } : null) };
    m.time = st.R?.lighting?.time ?? m.time;
    m.ents = st.ents?.save?.() || [];
    if (st.modRun) m.modData = st.modRun.data();
    return m;
  }
  async function saveAll(st = S, thumb){
    if (!st || st.saving) return;
    st.saving = true;
    try {
      const list = []; for (const k of st.unsaved) { const c = st.W.chunks.get(k); if (c && c.gen) list.push(c); }
      await saveChunks(list, st);
      metaSnap(st);
      if (thumb) { try { st.R.render(); const c = document.createElement('canvas'); c.width = 192; c.height = 108; c.getContext('2d').drawImage(st.R.r.domElement, 0, 0, 192, 108); st.meta.thumb = c.toDataURL('image/jpeg', .7); } catch (e) {} }
      await VX().store.putWorld(st.meta);
      VX().store.clearJournal(st.meta.id);
      st.lastSave = now();
    } finally { st.saving = false; }
  }
  // вкладку закрывают: синхронно в localStorage (журнал), база — как успеет
  function journalNow(){
    const st = S; if (!st || !st.ready) return;
    const V = VX(), recs = [];
    for (const k of st.unsaved) { const c = st.W.chunks.get(k); if (c && c.gen) { const r = chunkRec(c, st); recs.push({ cx: r.cx, cz: r.cz, e: V.store.b64(new Uint8Array(r.e.buffer)), t: r.t }); } }
    const m = metaSnap(st), meta = { player: m.player, time: m.time, day: m.day, ents: m.ents, palette: m.palette, spawn: m.spawn, modData: m.modData };
    V.store.journal(st.meta.id, { recs, meta });
    saveAll(st).catch(() => {});
  }
  function onHide(){ journalNow(); }
  function onVis(){ if (document.visibilityState === 'hidden') journalNow(); }

  // ═══ Правка блока: сетки, сохранение, сущности, моды ═══
  function onEdit(x, y, z, was, v, o){
    if (!S) return;
    const c = S.W.chunkAt(x, z); if (c) S.unsaved.add(c.key);
    S.ST.touch(x, z, o.urgent ?? 2);
    S.ents?.onBlockChanged(x, y, z, was, v);
  }

  // ═══ Шаг логики (1/60 с) ═══
  function update(dt){
    const st = S; if (!st || st.dead) return;
    const { C, P, W } = st, V = VX();
    const uiOpen = !!st.ui?.isOpen(), menu = !!st.menu || !!st.modWin, chatting = !!st.chatEl;   // modWin — окно «Моды мира»
    C.blocked = uiOpen || menu || chatting || !!window.D37Settings?.isOpen?.();
    C.step(dt);
    const K = st.K || NOK;
    K.step(dt);
    if (!st.ready) { if (st.ST.readyAt(P.x, P.z) && spawnReady(st)) { st.ready = true; placeSafe(st); } return; }
    st.steps++;
    // Esc: окно → закрыть; иначе меню
    if (C.down('pause') && !window.D37Settings?.isOpen?.()) { if (chatting) chatClose(); else if (uiOpen) st.ui.close(); else if (st.modWin) { if (st.modWin.close) st.modWin.close(); else st.modWin.querySelector('[data-x]')?.click(); } else if (menu) closeMenu(); else openMenu(); }
    // E — вещи (и закрыть окно вещей той же клавишей, как в Майнкрафте)
    if (K.downRaw('inventory') && !menu && !chatting && !window.D37Settings?.isOpen?.()) { if (uiOpen) st.ui.close(); else st.ui?.open('inv'); }
    if (K.down('camera')) cycleCam();
    if (K.down('hud')) hideHud(!st.hudHidden);
    if (K.down('debug')) { st.dbg = !st.dbg; st.hudEl.querySelector('.kb-dbg').hidden = !st.dbg; }
    if (!uiOpen && (K.down('chat') || C.down('chat'))) chatOpen();
    else if (!uiOpen && K.down('command')) chatOpen('/');
    if (!C.blocked) {
      for (let i = 1; i <= 9; i++) if (C.down('slot' + i)) P.sel = i - 1;
      if (K.down('prev')) P.sel = (P.sel + 8) % 9;
      if (K.down('next')) P.sel = (P.sel + 1) % 9;
      // Q — выбросить одну (держишь — ещё и ещё), Ctrl+Q — всю стопку
      if (K.down('drop')) { dropSel(st, K.ctrl); st.dropT = .45; }
      else if (K.held('drop') && (st.dropT -= dt) <= 0) { dropSel(st, K.ctrl); st.dropT = .1; }
    }
    if (P.dead) return;
    physics(st, dt);
    interact(st, dt);
    // 20 раз в секунду: мобы, вода, печи, голод
    if (st.steps % 3 === 0) {
      st.ents?.tick(1 / 20);
      if (!st.creative) survivalTick(st, 1 / 20);
      st.modRun?.tick(1 / 20);
    }
    // время суток
    if (!st.paused) {
      const L = st.R.lighting, t0 = L.time;
      L._t = ((t0 + 24 * dt / DAY_SEC) % 24 + 24) % 24;
      const prevNight = t0 > 19 || t0 < 5.5, nowDay = L._t >= 5.5 && L._t < 19;
      if (prevNight && nowDay && !st.creative && st.nightSeen) unlock('night');
      if (!prevNight && !nowDay) st.nightSeen = true;   // сумерки при тебе: ночь началась — дожить до утра (смерть сбрасывает)
      if (L._t < t0) st.meta.day = (st.meta.day || 1) + 1;   // полночь — новый день (счётчик дней для модов: world.day())
      L.time = L._t;
    }
    st.WX?.step(dt);
    if (now() - st.lastSave > 12000) saveAll(st).catch(() => {});
  }
  function spawnReady(st){
    // вокруг игрока все ближние чанки с сеткой
    const W = st.W, cx = Math.floor(st.P.x) >> 4, cz = Math.floor(st.P.z) >> 4;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const c = W.chunk(cx + dx, cz + dz); if (!c || !c.ready || c.meshRev < 0) return false; }
    return true;
  }
  // встать на поверхность, если внутри блоков (новый мир или мир поменялся)
  function placeSafe(st){
    const P = st.P, V = VX();
    if (!V.boxHits(st.W, P.x, P.y, P.z, P.w, P.h) && P.y > 0) return;
    const hgt = st.W.heightAt(P.x, P.z);
    let y = Math.max(1, hgt);
    while (y < V.H - 2 && V.boxHits(st.W, P.x, y, P.z, P.w, P.h)) y++;
    P.y = y; P.vy = 0; P.fallTop = y;
  }

  // ── Игрок: ходьба, бег, присед, прыжок, полёт, вода, лестницы, удар о землю ──
  const BOX = { x: 0, y: 0, z: 0, w: PW, h: PH, hitX: false, hitY: false, hitZ: false }, TCH = {};
  function physics(st, dt){
    const { C, P, W, rig } = st, V = VX();
    const touch = V.touching(W, P.x, P.y, P.z, P.w, P.h, TCH);
    P.water = touch.water; P.lava = touch.lava; P.climb = touch.climb;
    const eyeY = P.y + (P.sneak ? 1.27 : 1.62), ev = W.raw(P.x, eyeY, P.z);
    P.eyeWater = ev > 0 && V.T.liquid[ev & 0xfff] === 1 && eyeY < Math.floor(eyeY) + V.liquidHeight(ev);
    // ввод → направление
    const f = rig.fwd(), r = rig.right();
    let wx = f.x * C.move.z + r.x * C.move.x, wz = f.z * C.move.z + r.z * C.move.x;
    const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }
    const K = st.K || NOK, jump = C.held('jump');
    // красться — Shift (держать; в настройках — «нажал/отжал»), на телефоне — кнопка-переключатель
    if (opts.sneakToggle && K.down('sneak')) st.sneakOn = !st.sneakOn;
    const sneak = (opts.sneakToggle ? st.sneakOn : K.held('sneak')) || !!st.touchSneak || (!st.K && C.held('crouch'));
    // полёт в «Творчестве»: двойной прыжок
    if (st.creative && C.doubleTap('jump')) { P.fly = !P.fly; P.vy = 0; st.H.toast(P.fly ? '🕊 Полёт (два раза «прыжок» — выключить)' : '🚶 Полёт выключен'); st.tbarSync?.(); }
    if (!st.creative) P.fly = false;
    P.sneak = sneak && !P.fly;
    // бег как в Майнкрафте: Ctrl (или два раза «вперёд», или джойстик до упора) — и бежит, пока идёт вперёд; стоп — отпустил
    // «вперёд», присел, проголодался (еда ≤ 3 окорочков) или упёрся в стену
    const hungry = !st.creative && P.food <= 6, fwd = C.move.z > .3;
    if (opts.sprintToggle && K.down('sprint')) st.sprintOn = !st.sprintOn;
    const wantRun = (opts.sprintToggle ? st.sprintOn : K.held('sprint')) || C.doubleTap('forward') || (st.I.touch && C.held('run')) || (!st.K && C.held('run'));
    if (!P.sprint && wantRun && fwd && !hungry && !P.sneak && !st.eat) P.sprint = true;
    else if (P.sprint && (!fwd || P.sneak || hungry || st.eat || (P.onGround && st.wallHit && !P.fly))) P.sprint = false;
    const inLiquid = P.water > .3 || P.lava > .2;
    let spd = P.fly ? (P.sprint ? SPD.flyFast : SPD.fly) : P.sneak ? SPD.sneak : P.sprint ? SPD.sprint : SPD.walk;
    if (inLiquid && !P.fly) spd = P.lava > .2 ? 1.2 : SPD.swim * (P.sprint ? 1.4 : 1);
    if (st.eat && !P.fly) spd *= .35;   // ест — идёт медленно (как в Майнкрафте)
    const slip = P.onGround && touch.slip ? touch.slip : 0;
    const acc = P.fly ? 9 : P.onGround ? (slip ? 1.5 : 14) : inLiquid ? 5 : 2.6, k = 1 - Math.exp(-acc * dt);
    P.vx += (wx * spd - P.vx) * k; P.vz += (wz * spd - P.vz) * k;
    // по вертикали
    if (P.fly) {
      const want = (jump ? 1 : 0) - (sneak ? 1 : 0);
      P.vy += (want * (P.sprint ? 12 : 8) - P.vy) * (1 - Math.exp(-10 * dt));
    } else if (P.climb && !inLiquid) {
      if (jump || (C.move.z > .2 && (BOX.hitX || BOX.hitZ || st.climbPush))) P.vy = 3.2;
      else if (P.sneak) P.vy = 0;
      else P.vy = Math.max(P.vy - G_ACC * dt, -2.4);
      P.fallTop = P.y;
    } else if (inLiquid) {
      P.vy -= (P.lava > .2 ? 4 : 6) * dt;
      P.vy *= 1 - Math.min(1, 2.2 * dt);
      if (jump) P.vy = Math.min(P.vy + 18 * dt, P.eyeWater ? 3.2 : 4.6);
      P.vy = Math.max(P.vy, -3.2);
      P.fallTop = P.y;
    } else {
      P.vy = Math.max(-TERM, P.vy - G_ACC * dt);
      if (jump && P.onGround && P.jumpCD <= 0) { P.vy = JUMP_V; P.onGround = false; P.jumpCD = .1; P.exh += P.sprint ? .2 : .05; st.AU?.play('jump', { vol: .25 }); }
    }
    P.jumpCD = (P.jumpCD || 0) - dt;
    // батут (свой блок или мода): подбросить
    if (touch.bounce && P.onGround && !P.sneak && P.vy <= 0 && st.bounceCD <= 0) { P.vy = touch.bounce; P.onGround = false; st.bounceCD = .3; st.AU?.play('kb_bounce', { vol: .6 }); P.fallTop = P.y; unlock('bounce'); }
    st.bounceCD = (st.bounceCD || 0) - dt;
    // присел на краю — не падать
    let mx = P.vx * dt, mz = P.vz * dt;
    if (P.sneak && P.onGround) {
      if (mx && !V.boxHits(W, P.x + mx, P.y - .6, P.z, P.w, .55)) mx = 0;
      if (mz && !V.boxHits(W, P.x + mx, P.y - .6, P.z + mz, P.w, .55)) mz = 0;
    }
    // высота: присел — ниже (если есть куда встать)
    const wantH = P.sneak ? PHS : PH;
    if (P.h !== wantH) { if (wantH < P.h || !V.boxHits(W, P.x, P.y, P.z, P.w, wantH)) P.h = wantH; }
    BOX.x = P.x; BOX.y = P.y; BOX.z = P.z; BOX.w = P.w; BOX.h = P.h;
    const vy0 = P.vy;
    V.moveBox(W, BOX, mx, P.vy * dt, mz);
    // автопрыжок (телефон): упёрся в ступеньку высотой 1 — подпрыгнуть
    if ((BOX.hitX || BOX.hitZ) && P.onGround && !P.sneak && !P.fly && st.I.touch && opts.autoJump !== false && wl > .3) {
      if (!V.boxHits(W, BOX.x + wx * .5, BOX.y + 1.05, BOX.z + wz * .5, P.w, P.h)) { P.vy = JUMP_V; }
    }
    st.climbPush = BOX.hitX || BOX.hitZ;
    st.wallHit = (BOX.hitX && Math.abs(mx) > Math.abs(mz) * .5) || (BOX.hitZ && Math.abs(mz) > Math.abs(mx) * .5);   // в стену «лбом» — бег кончается
    if (BOX.hitX) P.vx = 0; if (BOX.hitZ) P.vz = 0;
    const was = P.onGround;
    P.onGround = BOX.hitY && vy0 <= 0;
    if (BOX.hitY) P.vy = 0;
    P.x = BOX.x; P.y = BOX.y; P.z = BOX.z;
    if (P.fly && P.onGround) P.fly = false;
    // упал: урон от высоты (не в воде, не на лестнице, не в творчестве)
    if (!P.onGround && !inLiquid && !P.climb && !P.fly) { if (P.y > P.fallTop) P.fallTop = P.y; }
    if (P.onGround && !was) {
      const d = P.fallTop - P.y;
      if (d > 3.4 && !st.creative && !touch.bounce && !P.modFall) hurt(st, Math.ceil(d - 3.4), 'fall');   // modFall — подбросил мод (батут): приземление без урона
      if (d > 1.2) st.AU?.play('land', { vol: Math.min(1, .25 + d * .08) });
      // пыль кольцом (обычный прыжок — чуть-чуть), камера «приседает», с высоты — ещё и вздрагивает (⚙️ «Камера»)
      if (d > 1.15) {
        const fv = W.raw(P.x, P.y - .1, P.z);
        if (fv > 0) st.ents?.dust?.(P.x, P.y, P.z, fv & 0xfff, Math.min(14, Math.round(2 + (d - 1.15) * 3)), { ring: true, sp: 1.2 + Math.min(2, d * .15), s: .22, s1: .6, a: .5, vy: .25 });
        if (camFx(st) > 0) st.rig.land?.(-vy0 * (E().UNIT || 1));
        if (d > 2.5 && shakeOK(st)) st.rig.shake?.(Math.min(2.4, .45 * (d - 2)), .25);
      }
      P.fallTop = P.y; P.modFall = false;
    }
    if (P.onGround || inLiquid || P.climb || P.fly) P.fallTop = P.y;
    // шаги и усталость от бега: звук по полу (песок, гравий, снег — свои), на сыпучем и траве — облачко пыли у ног
    const moved = Math.hypot(P.x - P.lastStepX, P.z - P.lastStepZ);
    if (P.onGround && moved > (P.sprint ? 2.1 : 1.6)) {
      P.lastStepX = P.x; P.lastStepZ = P.z;
      const fv = W.raw(P.x, P.y - .1, P.z);
      if (fv > 0) {
        const fb = V.blocks[fv & 0xfff], ks = STEP_KB[fb?.sound];
        if (st.uw) st.AU?.play('step_carpet' + ((Math.random() * 3) | 0), { vol: .22 });   // по дну — мягко (и так глушь)
        else if (ks) st.AU?.play(ks, { x: P.x - st.ox, y: P.y, z: P.z - st.oz, vol: P.sprint ? .7 : .5, rate: .9 + Math.random() * .2 });
        else st.AU?.step(floorSound(fv & 0xfff), P.sprint, P.x - st.ox, P.y, P.z - st.oz);
        if (DUSTY[fb?.sound] && (P.sprint || (st.ents?.fxQ || 0) > .5)) st.ents?.dust?.(P.x - P.vx * .06, P.y, P.z - P.vz * .06, fv & 0xfff, P.sprint ? 2 : 1, { w: .3, sp: .5, s: .16, s1: .38, a: .38, life: .45, vy: .3 });
      }
      if (P.sprint) P.exh += .1 * moved;
    } else if (!P.onGround) { P.lastStepX = P.x; P.lastStepZ = P.z; }
    // плавание: брызги
    if (inLiquid && Math.hypot(P.vx, P.vz) > 1 && (P.swimT -= dt) < 0) { P.swimT = .7; if (!st.uw) st.AU?.play('step_water' + ((Math.random() * 3) | 0), { vol: .35 }); }   // под водой — без плеска (был резкий)
    // вода: прыгнул — всплеск, плывёшь у поверхности — след, под водой — пузыри у лица
    const inW = P.water > .3;
    if (inW && !st.inW && vy0 < -4 && !P.fly) { st.ents?.splash?.(P.x, waterTop(st), P.z, Math.min(1.5, -vy0 / 10)); st.AU?.play('kb_splash', { vol: Math.min(1, .3 + -vy0 * .05), rate: .9 + Math.random() * .2 }); }
    st.inW = inW;
    if (inW && !P.eyeWater && Math.hypot(P.vx, P.vz) > 1.2 && ((st.wakeT = (st.wakeT || 0) - dt) < 0)) { st.wakeT = .14; st.ents?.wake?.(P.x - P.vx * .1, waterTop(st), P.z - P.vz * .1); }
    if (P.eyeWater && ((st.bubT = (st.bubT || 0) - dt) < 0)) { st.bubT = .5 + Math.random() * .6; const [ex, ey, ez] = eye(st), d = lookDir(st); st.ents?.bubbles?.(ex + d.x * .45, ey - .15, ez + d.z * .45, 1 + (Math.random() * 2 | 0)); }
    // лава и кактус: урон
    if (!st.creative) {
      if (touch.hurt) { P.hurtSrc = (P.hurtSrc || 0) + dt * touch.hurt; if (P.hurtSrc >= 1) { const n = Math.floor(P.hurtSrc); P.hurtSrc -= n; hurt(st, n, P.lava > .2 ? 'lava' : 'cactus'); } }
      if (P.y < -20) hurt(st, 4, 'void');
    } else if (P.y < -30) { P.y = 130; P.vy = 0; }
    if (P.y > 100) unlock('high');
    if (P.y < 12 && P.y > 0) unlock('deep');
    if (st.meta.spawn && Math.hypot(P.x - st.meta.spawn.x, P.z - st.meta.spawn.z) > 1000) unlock('far');
    // моды: «встал на блок мода»
    if (st.modRun && touch.blocks.length) st.modRun.stepOn(touch.blocks, P);
    rebase(false);
  }
  const SND_FLOOR = { stone: 'concrete', metal: 'metal', wood: 'wood', grass: 'grass', dirt: 'grass', sand: 'carpet', gravel: 'concrete', snow: 'carpet', glass: 'tile', water: 'water', wool: 'carpet' };
  function floorSound(t){ return SND_FLOOR[VX().blocks[t]?.sound] || 'concrete'; }
  const STEP_KB = { sand: 'kb_step_sand', gravel: 'kb_step_gravel', snow: 'kb_step_snow' };   // свои шаги (хруст, шорох)
  const DUSTY = { sand: 1, gravel: 1, dirt: 1, grass: 1, snow: 1 };   // где из-под ног летит пыль
  // поверхность воды над игроком (всплеск и след — на ней)
  function waterTop(st){
    const V = VX(), W = st.W, P = st.P, x = P.x, z = P.z;
    let y = Math.floor(P.y + .3), v = W.raw(x, y, z);
    if (!(v > 0 && V.T.liquid[v & 0xfff])) return P.y + .5;
    for (let n = 0; n < 6; n++) { const u = W.raw(x, y + 1, z); if (!(u > 0 && V.T.liquid[u & 0xfff])) break; y++; v = u; }
    return y + V.liquidHeight(v);
  }
  // ⚙️ «Камера»: покачивание 0 или «меньше движения» в системе (если сайт не в режиме «Мощное») — без крена и тряски
  let rmq = null;
  function camFx(st){
    const O = window.D37Opt, mo = O && O.motion != null ? +O.motion : st.rig?.motion ?? 1;
    if (!rmq) try { rmq = window.matchMedia?.('(prefers-reduced-motion: reduce)') || { matches: false }; } catch (e) { rmq = { matches: false }; }
    return mo <= 0 || (rmq.matches && !document.body.classList.contains('high')) ? 0 : Math.min(1, mo);
  }
  const shakeOK = st => camFx(st) > 0 && window.D37Opt?.shake !== false && !st.rig?.noShake;
  // есть ли место в вещах (иначе выпавшая вещь к игроку не тянется)
  function room(st, s){ const it = VX().item(s.id), P = st.P; if (!it) return false; for (let i = 0; i < 36; i++) { const q = P.inv[i]; if (!q || (q.id === s.id && q.n < it.stack && !it.tool)) return true; } return false; }
  // подобрал — ячейка панели с этой вещью «подпрыгивает»
  function popSlot(st, id){
    const i = st.P.inv.findIndex((s, k) => k < 9 && s && s.id === id); if (i < 0) return;
    const d = st.hudEl?.querySelectorAll('.kb-slot')[i]; if (!d) return;
    d.classList.remove('pop'); void d.offsetWidth; d.classList.add('pop');
  }
  // сдвиг начала координат сцены (далеко от нуля float32 дрожит)
  function rebase(force){
    const st = S, P = st.P;
    if (!force && Math.abs(P.x - st.ox) < 768 && Math.abs(P.z - st.oz) < 768) return;
    const nx = Math.floor(P.x / 16) * 16, nz = Math.floor(P.z / 16) * 16, dx = nx - st.ox, dz = nz - st.oz;
    st.ox = nx; st.oz = nz;
    st.VR?.setOrigin(nx, nz);
    if (st.rig) { st.rig.tx -= dx; st.rig.tz -= dz; }
  }

  // ═══ Выживание: голод, здоровье, воздух ═══
  function survivalTick(st, dt){
    const P = st.P, diff = st.meta.diff || 'easy';
    // голод: усталость → насыщение → еда
    if (P.exh >= 4) { P.exh -= 4; if (P.sat > 0) P.sat = Math.max(0, P.sat - 1); else if (diff !== 'peaceful') P.food = Math.max(0, P.food - 1); }
    P.exh += dt * .012;   // жизнь тоже тратит силы (медленно)
    if (P.food >= 18 && P.hp < 20) { P.regT += dt; if (P.regT >= 3) { P.regT = 0; P.hp = Math.min(20, P.hp + 1); P.exh += 3; } } else P.regT = 0;
    if (diff === 'peaceful' && P.hp < 20) { P.regT += dt * .5; if (P.regT >= 3) { P.regT = 0; P.hp++; } }
    if (P.food <= 0 && diff !== 'peaceful') { P.starveT += dt; if (P.starveT >= 4) { P.starveT = 0; if (P.hp > (diff === 'easy' ? 10 : diff === 'hard' ? 0 : 1)) hurt(st, 1, 'starve'); } }   // «сложно» — голод убивает (как в Майнкрафте)
    // воздух под водой
    if (P.eyeWater) { P.air = Math.max(0, P.air - dt); if (P.air <= 0) { P.drownT = (P.drownT || 0) + dt; if (P.drownT >= 1) { P.drownT = 0; hurt(st, 2, 'drown'); } } }
    else P.air = Math.min(15, P.air + dt * 4);
  }
  // ранили: звук, кивок камеры, крен в сторону удара (как в Майнкрафте; src — кто ударил, без него — в другую сторону, чем
  // прошлый раз), красные края экрана — сильнее от сильного удара
  function hurt(st, n, why, src){
    const P = st.P;
    if (st.creative || P.dead || n <= 0) return;
    if ((P.hurtT || 0) > now() - 450 && why !== 'drown' && why !== 'starve' && why !== 'void') return;
    P.hurtT = now();
    P.hp = Math.max(0, P.hp - n);
    st.AU?.play('kb_hurt', { vol: .7 });
    st.rig.kick?.(1.2);
    const k = camFx(st);
    if (k > 0) {
      let side = st.hurtSide = -(st.hurtSide || 1);
      if (src && Number.isFinite(src.x)) { const r = st.rig.right(), dx = src.x - P.x, dz = src.z - P.z, s = dx * r.x + dz * r.z; if (Math.abs(s) > .2 * Math.hypot(dx, dz)) side = s > 0 ? 1 : -1; }
      st.roll = { t: 0, a: -side * (6 + Math.min(6, n * 1.5)) * k };
    }
    const he = st.hurtEl;
    if (he) { he.style.transition = 'none'; he.style.opacity = String(Math.min(1, .5 + n * .1)); void he.offsetWidth; he.style.transition = 'opacity .6s ease-out'; he.style.opacity = '0'; }
    if (P.hp <= 0) die(st, why);
  }
  const DEATH = { fall: 'разбился', lava: 'сгорел в лаве', cactus: 'укололся о кактус', starve: 'умер от голода', drown: 'утонул', void: 'упал в бездну', mob: 'не справился с монстром' };
  function die(st, why){
    const P = st.P; P.dead = true;
    st.I.unlock();
    const keep = !['normal', 'hard'].includes(st.meta.diff || 'easy');
    if (!keep) { for (let i = 0; i < P.inv.length; i++) if (P.inv[i]) { st.ents?.addItem(P.x, P.y + 1, P.z, P.inv[i], true); P.inv[i] = null; } }
    st.lastDeath = { x: P.x, y: P.y, z: P.z, t: now(), drop: !keep && !!st.ents };
    st.nightSeen = false;   // «Пережил ночь» — только если дожил до утра, не погибнув
    const xyz = `X ${Math.floor(P.x)}, Y ${Math.floor(P.y)}, Z ${Math.floor(P.z)}`;
    const box = document.createElement('div'); box.className = 'kb-dead kb-ui';
    box.innerHTML = `<div><b>💀 Ты ${esc(DEATH[why] || 'погиб')}</b><small>${keep ? 'Вещи остались с тобой (сложность «мирно» или «легко»).' : `Вещи выпали там, где ты погиб (${xyz}), и лежат 5 минут — подсказка вверху покажет, куда идти.`}</small><small class="kb-where">Возродишься ${st.meta.bed ? 'у своей кровати' : 'в начале мира'} с полным здоровьем и сытостью.</small><div class="kb-btns"><button type="button" class="kb-btn primary" data-r="1">↺ Возродиться</button><button type="button" class="kb-btn" data-m="1">🏠 В меню</button></div></div>`;
    wrap().appendChild(box);
    box.querySelector('[data-m]').onclick = () => { box.remove(); P.dead = false; P.hp = 20; P.food = Math.max(P.food, 6); const sp = st.meta.bed || st.meta.spawn; Object.assign(P, { x: sp.x, y: sp.y, z: sp.z, vx: 0, vy: 0, vz: 0, fallTop: sp.y }); stopWorld().then(() => showMenu()); };
    box.querySelector('[data-r]').onclick = () => {
      box.remove(); const sp = st.meta.bed || st.meta.spawn;
      Object.assign(P, { x: sp.x, y: sp.y, z: sp.z, vx: 0, vy: 0, vz: 0, hp: 20, food: 20, sat: 5, air: 15, dead: false, fallTop: sp.y });
      placeSafe(st); rebase(true); st.C.reset_state();
    };
  }

  // ═══ Прицел: ломать, ставить, открывать, есть ═══
  function eye(st){ const P = st.P; return [P.x, P.y + (P.sneak ? 1.27 : 1.62), P.z]; }
  const DIR = { x: 0, y: 0, z: 0 };
  // куда смотрит игрок (по повороту головы, а не по камере: в виде спереди камера смотрит на него самого)
  function lookDir(st){
    const y = st.rig.yaw, p = st.rig.fp, c = Math.cos(p);
    DIR.x = -Math.sin(y) * c; DIR.y = -Math.sin(p); DIR.z = -Math.cos(y) * c;
    return DIR;
  }
  // луч прицела: от глаз по взгляду — или (телефон, «как в Bedrock») от камеры через палец; дальность — от глаз
  const RAY = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0, max: 0 };
  function aimRay(st, pt, reach){
    if (pt) {
      const r = st.R.screenRay(pt.x, pt.y), [ex, ey, ez] = eye(st);
      Object.assign(RAY, { ox: r.ox + st.ox, oy: r.oy, oz: r.oz + st.oz, dx: r.dx, dy: r.dy, dz: r.dz });
      RAY.max = reach + Math.hypot(RAY.ox - ex, RAY.oy - ey, RAY.oz - ez);
    } else {
      const [ex, ey, ez] = eye(st), d = lookDir(st);
      Object.assign(RAY, { ox: ex, oy: ey, oz: ez, dx: d.x, dy: d.y, dz: d.z, max: reach });
    }
    return RAY;
  }
  function interact(st, dt){
    const { C, P, W } = st, V = VX(), K = st.K || NOK;
    const reach = st.creative ? REACH_C : REACH;
    // телефон: «нажал — поставить, держишь — ломать» под пальцем (или в режиме «прицел» — по центру экрана)
    const touchTap = st.I.touch && opts.touchMode !== 'cross', holding = st.I.touch && !C.blocked && K.fingerHolding();
    const fing = touchTap && holding ? K.finger : null;
    const ray = aimRay(st, fing, reach);
    const look = !C.blocked && !(touchTap && !fing);   // палец не держит мир — в режиме «под пальцем» прицела нет
    const hit = st.hit = look ? V.raycast(W, ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, ray.max) : null;
    st.mobHit = look ? st.ents?.rayMob?.(ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, Math.min(ray.max, hit ? hit.t : ray.max)) || null : null;
    // на компьютере — только с захваченной мышью (первый клик лишь захватывает её); геймпад и палец — всегда
    const live = !C.blocked && (st.I.touch || st.I.locked || K.pad);
    st.placeCool -= dt; st.mine.cool -= dt;
    // короткие нажатия пальцем: по мобу — удар, по блоку — поставить / открыть / съесть
    while (K.taps.length) {
      const tp = K.taps.shift(); if (!live) continue;
      const r = aimRay(st, touchTap ? tp : null, reach), h = V.raycast(W, r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, r.max);
      const m = st.ents?.rayMob?.(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, Math.min(r.max, h ? h.t : r.max));
      if (m) { attackMob(st, m); st.hand?.act('swing'); } else use(st, h, true);
    }
    // еда (держать ПКМ / LT; палец — само): пока ест — не копает и не ставит
    if (st.eat && eatTick(st, dt, live)) { st.hand?.mine(false); st.mine.key = ''; st.mine.t = 0; st.mine.st = -1; st.mine.k = 0; return; }
    // удар по мобу (ЛКМ / RT)
    if (live && st.mobHit && (C.down('mine') || K.down('mine'))) { attackMob(st, st.mobHit); st.hand?.act('swing'); st.hand?.mine(false); return; }
    // ломать: ЛКМ (держать), RT, палец держит мир, кнопка ⛏ (режим «прицел»); рука машет, пока держишь (и по воздуху — раз)
    const mining = live && (C.held('mine') || K.held('mine') || holding) && hit;
    st.hand?.mine(!!mining);
    if (live && !hit && (C.down('mine') || K.down('mine'))) st.hand?.act('swing');
    if (mining) {
      const key = hit.x + ',' + hit.y + ',' + hit.z, b = V.blocks[hit.v & 0xfff];
      if (st.mine.key !== key) { st.mine.key = key; st.mine.t = 0; st.mine.need = breakTime(st, b); st.mine.snd = 0; }
      if (st.creative) { if (st.mine.cool <= 0) { breakBlock(st, hit); st.mine.cool = .18; st.mine.key = ''; } }
      else if (st.mine.need < Infinity) {
        st.mine.t += dt;
        st.mine.snd -= dt; if (st.mine.snd <= 0) { st.mine.snd = .24; st.AU?.play(digSound(b), { x: hit.x - st.ox + .5, y: hit.y + .5, z: hit.z - st.oz + .5, vol: .45, rate: .9 + Math.random() * .2 }); st.ents?.hitFx?.(hit.x, hit.y, hit.z, b.id, hit.nx | 0, hit.ny | 0, hit.nz | 0); }
        if (st.mine.t >= st.mine.need) { breakBlock(st, hit); st.mine.key = ''; st.mine.t = 0; st.mine.cool = .05; }
      }
    } else { st.mine.key = ''; st.mine.t = 0; }
    st.mine.st = mining && st.mine.need < Infinity && !st.creative ? Math.floor(st.mine.t / st.mine.need * 8) : -1;
    st.mine.k = mining && st.mine.need < Infinity && !st.creative ? Math.min(1, st.mine.t / st.mine.need) : mining ? 1 : 0;
    // поставить / открыть / съесть (ПКМ, LT; держишь — повтор). ЛКМ никогда не ставит, ПКМ никогда не ломает
    const wantPlace = live && (C.down('place') || (C.held('place') && st.placeCool <= 0));
    if (wantPlace) { st.placeCool = .22; use(st, hit); }
    // СКМ / X — блок под прицелом в руку
    if (live && (C.down('pick') || K.down('pick')) && hit) pickBlock(st, hit);
  }
  function breakTime(st, b){
    if (b.hard < 0) return Infinity;
    const it = st.P.inv[st.P.sel], tool = it ? VX().item(it.id)?.tool : null;
    const right = !!(tool && b.tool && tool.kind === b.tool);
    const can = !b.tier || (right && tool.tier >= b.tier);
    let t = b.hard * (can ? 1.5 : 5) / (right ? tool.speed : 1);
    if (!st.P.onGround && !st.P.fly && !st.P.climb) t *= 2;
    if (st.P.eyeWater) t *= 3;
    return Math.max(.05, t);
  }
  function canHarvest(st, b){
    if (!b.tier) return true;
    const it = st.P.inv[st.P.sel], tool = it ? VX().item(it.id)?.tool : null;
    return !!(tool && tool.kind === b.tool && tool.tier >= b.tier);
  }
  const DIG = { stone: 'kb_dig_stone', metal: 'kb_dig_stone', glass: 'kb_dig_stone', wood: 'kb_dig_wood', grass: 'kb_dig_grass', dirt: 'kb_dig_dirt', sand: 'kb_dig_dirt', gravel: 'kb_dig_dirt', snow: 'kb_dig_dirt', wool: 'kb_dig_grass' };
  function digSound(b){ return DIG[b.sound] || 'kb_dig_stone'; }
  function breakBlock(st, hit){
    const V = VX(), W = st.W, b = V.blocks[hit.v & 0xfff];
    if (!b || b.hard < 0 && !st.creative) return;
    if (b.hard < 0 && st.creative && b.name === 'bedrock' && hit.y === 0) return;
    // дверь — обе половины
    const st2 = hit.v >>> 12;
    if (b.shape === V.SHAPE.door) { const oy = st2 & 8 ? -1 : 1, o = W.raw(hit.x, hit.y + oy, hit.z); if (o > 0 && (o & 0xfff) === b.id) W.set(hit.x, hit.y + oy, hit.z, 0); }
    W.set(hit.x, hit.y, hit.z, 0, { urgent: 3 });
    st.AU?.play(digSound(b), { x: hit.x - st.ox + .5, y: hit.y + .5, z: hit.z - st.oz + .5, vol: .8 });
    if (st.ents?.breakFx) st.ents.breakFx(hit.x, hit.y, hit.z, b.id); else st.ents?.debris(hit.x, hit.y, hit.z, b.id);   // осколки кувыркаются и прыгают
    if (opts.fell !== false && /^log_/.test(b.name)) st.ents?.fellTree?.(hit.x, hit.y, hit.z, st.P);   // подрубил дерево — валится (kubomir-ents.js)
    st.modRun?.event('blockBreak', { x: hit.x, y: hit.y, z: hit.z, block: b.name });
    if (st.creative) return;
    // вещь выпала
    const P = st.P, it = P.inv[P.sel], tool = it ? V.item(it.id)?.tool : null;
    if (canHarvest(st, b)) {
      for (const [name, n] of dropsOf(st, b)) st.ents?.addItem(hit.x + .5, hit.y + .4, hit.z + .5, { id: name, n });
    }
    // сундук и печь — содержимое тоже
    const tile = W.dropTile(hit.x, hit.y, hit.z);
    if (tile) for (const s of [...(tile.items || []), tile.in, tile.fuel, tile.out]) if (s && s.n > 0) st.ents?.addItem(hit.x + .5, hit.y + .5, hit.z + .5, s);
    // износ инструмента, голод
    if (tool && b.hard > 0) wear(st, P.sel, 1);
    P.exh += .005;
    if (b.name.startsWith('log_')) unlock('log');
    if (b.name === 'ore_diamond' && canHarvest(st, b)) unlock('diamond');
    if (b.name === 'ore_coal') unlock('coal');
  }
  // что выпадает: [[имя, сколько]]
  function dropsOf(st, b){
    const V = VX(), r = Math.random();
    if (/^leaves_/.test(b.name)) { const out = []; if (r < .05) out.push(['sapling_' + b.name.slice(7), 1]); if (b.name === 'leaves_oak' && Math.random() < .02) out.push(['apple', 1]); return out; }
    if (b.name === 'clay') return [['clay_ball', 4]];
    if (b.name === 'door_oak') return [['door', 1]];
    if (b.name === 'furnace_lit') return [['furnace', 1]];
    if (b.name === 'gravel' && r < .1) return [['gravel', 1]];
    const d = b.drop;
    if (!d || !V.item(d)) return [];
    return [[d, 1]];
  }
  function wear(st, slot, n){
    const s = st.P.inv[slot], it = s && VX().item(s.id);
    if (!it?.tool) return;
    s.d = (s.d | 0) + n;
    if (s.d >= it.tool.dur) { st.P.inv[slot] = null; st.AU?.play('break', { vol: .5 }); st.H.toast('🔨 ' + it.title + ' сломался(-ась)'); }
  }
  function attackMob(st, m){
    const it = st.P.inv[st.P.sel], tool = it ? VX().item(it.id)?.tool : null;
    const dmg = tool ? tool.dmg : 1;
    const d = lookDir(st);
    st.ents?.damage(m, dmg, d.x, d.z, 'player');
    if (tool) wear(st, st.P.sel, tool.kind === 'sword' ? 1 : 2);
    st.P.exh += .1;
  }
  // правая кнопка: открыть / дверь / съесть / поставить; tap — нажатие пальцем (еда тогда доедается сама)
  function use(st, hit, tap){
    const V = VX(), P = st.P, W = st.W, s = P.inv[P.sel], it = s ? V.item(s.id) : null;
    if (st.eat) return;
    if (hit && !P.sneak) {
      const b = V.blocks[hit.v & 0xfff];
      if (b.ui) { st.ui?.open(b.ui, { x: hit.x, y: hit.y, z: hit.z }); st.hand?.act('push'); return; }
      if (b.shape === V.SHAPE.door) { toggleDoor(st, hit); st.hand?.act('push'); return; }
      if (st.modRun?.hasUse(b.name) || st.modRun?.hasUse(s?.id)) { st.modRun.event('use', { x: hit.x, y: hit.y, z: hit.z, block: b.name, item: s?.id || '' }); st.hand?.act('push'); return; }
    }
    // вещь мода «в воздух» (палочка, свиток) — тоже событие use
    if (!hit && s && st.modRun?.hasUse(s.id)) { st.modRun.event('use', { x: Math.floor(P.x), y: Math.floor(P.y + 1), z: Math.floor(P.z), block: '', item: s.id }); st.hand?.act('push'); return; }
    // еда — как в Майнкрафте: держать ~1,6 с (рука ко рту); съел — eat()
    if (it?.food && (P.food < 20 || st.creative)) { st.eat = { t: 0, need: +it.food.t > 0 ? +it.food.t : 1.6, slot: P.sel, id: s.id, auto: !!tap, snd: 0 }; return; }
    // лечебная вещь мода (heal в mod.json)
    if (it?.heal && P.hp < 20) { P.hp = Math.min(20, P.hp + it.heal); st.AU?.play('kb_eat', { vol: .5, rate: 1.3 }); if (!st.creative) { s.n--; if (s.n <= 0) P.inv[P.sel] = null; } st.hand?.act('push'); return; }
    if (!hit || !it?.place) return;
    if (placeBlock(st, hit, s, it)) { st.hand?.act('push'); if (!st.creative) { s.n--; if (s.n <= 0) P.inv[P.sel] = null; } }
  }
  function eat(st, it){
    const P = st.P;
    P.food = Math.min(20, P.food + it.food.h); P.sat = Math.min(P.food, P.sat + it.food.sat);
    st.AU?.play('kb_eat', { vol: .6 });
    if (!st.creative) { const s = P.inv[P.sel]; s.n--; if (s.n <= 0) P.inv[P.sel] = null; }
  }
  // идёт еда: держишь ПКМ / LT (палец — нажал, дальше само) — хруст и крошки у рта; отпустил, сменил ячейку, наелся — не съел
  function eatTick(st, dt, live){
    const P = st.P, E = st.eat, s = P.inv[P.sel], it = s ? VX().item(s.id) : null;
    const hold = live && (E.auto || st.C.held('place'));
    if (!it?.food || s.id !== E.id || P.sel !== E.slot || !hold || P.dead || (P.food >= 20 && !st.creative)) { st.eat = null; return false; }
    E.t += dt;
    if ((E.snd -= dt) <= 0 && E.t > .3) {
      E.snd = .21;
      st.AU?.play('kb_eat', { vol: .3, rate: .85 + Math.random() * .3 });
      const [ex, ey, ez] = eye(st), d = lookDir(st);
      st.ents?.crumbs?.(ex + d.x * 1.05, ey - .45 + d.y * .6, ez + d.z * 1.05, s.id, 2);   // перед лицом, чуть ниже (точки крупные — не у самых глаз)
    }
    if (E.t >= E.need) { st.eat = null; eat(st, it); st.placeCool = .3; }
    return true;
  }
  const FACE_IDX = (nx, nz) => nz > 0 ? 0 : nx < 0 ? 1 : nz < 0 ? 2 : 3;   // как V.FACING
  function placeBlock(st, hit, s, it){
    const V = VX(), W = st.W, P = st.P, b = V.block(it.place);
    if (!b) return false;
    const hv = hit.v, hb = V.blocks[hv & 0xfff];
    let x = hit.x, y = hit.y, z = hit.z;
    if (!(hb.replace && !hb.liquid && hb.id !== b.id)) { x += hit.nx; y += hit.ny; z += hit.nz; }
    if (y < 1 || y >= V.H - 1) return false;
    const cur = W.get(x, y, z);
    if (cur < 0 || !V.blocks[cur].replace) return false;
    const below = W.get(x, y - 1, z), solidBelow = below > 0 && V.T.solid[below] && V.T.shape[below] === V.SHAPE.cube;
    let state = 0;
    const f = lookDir(st), toward = Math.abs(f.x) >= Math.abs(f.z) ? FACE_IDX(f.x > 0 ? -1 : 1, 0) : FACE_IDX(0, f.z > 0 ? -1 : 1);   // лицом к игроку
    if (b.shape === V.SHAPE.cross) {
      if (!(below > 0 && /grass|dirt|snow_grass|sand/.test(V.blocks[below].name)) || (b.name === 'cactus')) return false;
    } else if (b.shape === V.SHAPE.torch) {
      if (hit.ny === 1 && solidBelow) state = 0;
      else if (!hit.ny && V.T.solid[hb.id] && V.T.shape[hb.id] === V.SHAPE.cube) state = 1 + FACE_IDX(hit.nx, hit.nz);
      else return false;
    } else if (b.shape === V.SHAPE.ladder) {
      if (hit.ny || !(V.T.solid[hb.id] && V.T.shape[hb.id] === V.SHAPE.cube)) return false;
      state = FACE_IDX(hit.nx, hit.nz);
    } else if (b.shape === V.SHAPE.door) {
      const up = W.get(x, y + 1, z);
      if (!solidBelow || up < 0 || !V.blocks[up].replace) return false;
      state = toward;
      if (boxOverlap(P, x, y, z, 2) || st.ents?.blocked?.(x, y, z) || st.ents?.blocked?.(x, y + 1, z)) return false;
      W.set(x, y, z, V.cell(b.id, state), { urgent: 3 });
      W.set(x, y + 1, z, V.cell(b.id, state | 8), { urgent: 3 });
      st.AU?.play('kb_place', { x: x - st.ox + .5, y: y + .5, z: z - st.oz + .5 });
      st.ents?.placeFx?.(x, y, z, b.id);
      unlock('door'); countPlaced(st);
      return true;
    } else if (b.axis) state = hit.nx ? 1 : hit.nz ? 2 : 0;
    else if (b.ui || b.shape === V.SHAPE.chest) state = toward;
    else if (b.shape === V.SHAPE.cactus) { if (!(below === V.ID.sand || below === V.ID.cactus)) return false; }
    // нельзя ставить твёрдое туда, где стоит игрок или моб
    if (b.solid && (boxOverlap(P, x, y, z, 1) || st.ents?.blocked?.(x, y, z))) return false;
    W.set(x, y, z, V.cell(b.id, state), { urgent: 3 });
    st.AU?.play('kb_place', { x: x - st.ox + .5, y: y + .5, z: z - st.oz + .5, vol: .7, rate: .92 + Math.random() * .16 });
    st.ents?.placeFx?.(x, y, z, b.id);   // блок «пружинит» и пыль у основания
    st.modRun?.event('blockPlace', { x, y, z, block: b.name });
    if (b.name === 'torch') unlock('torch');
    countPlaced(st);
    return true;
  }
  function countPlaced(st){ if (st.creative) return; const n = (st.meta.placed = (st.meta.placed | 0) + 1); if (n >= 200) unlock('builder'); }
  function boxOverlap(P, x, y, z, h){ const hw = P.w / 2; return P.x + hw > x && P.x - hw < x + 1 && P.z + hw > z && P.z - hw < z + 1 && P.y + P.h > y && P.y < y + h; }
  function toggleDoor(st, hit){
    const V = VX(), W = st.W, v = hit.v, s = v >>> 12, t = v & 0xfff, oy = s & 8 ? -1 : 1;
    W.set(hit.x, hit.y, hit.z, V.cell(t, s ^ 4), { urgent: 3 });
    const o = W.raw(hit.x, hit.y + oy, hit.z); if (o > 0 && (o & 0xfff) === t) W.set(hit.x, hit.y + oy, hit.z, V.cell(t, (o >>> 12) ^ 4), { urgent: 3 });
    st.AU?.play(s & 4 ? 'door_wood_close' : 'door_wood_open', { x: hit.x - st.ox + .5, y: hit.y + .5, z: hit.z - st.oz + .5, vol: .7 });
  }
  function pickBlock(st, hit){
    const V = VX(), P = st.P, b = V.blocks[hit.v & 0xfff];
    let name = b.name === 'door_oak' ? 'door' : b.name === 'furnace_lit' ? 'furnace' : b.name;
    if (!V.item(name)) return;
    // как в Майнкрафте: есть на панели — выбрать; есть в рюкзаке — на панель (в пустую ячейку или вместо выбранной);
    // в «Творчестве» нет нигде — целая стопка
    const i = P.inv.findIndex((s, k) => k < 9 && s && s.id === name);
    if (i >= 0) { P.sel = i; return; }
    const free = !P.inv[P.sel] ? P.sel : P.inv.findIndex((s, k) => k < 9 && !s);
    const j = P.inv.findIndex((s, k) => k >= 9 && s && s.id === name);
    if (j >= 0) {
      if (free >= 0) { P.inv[free] = P.inv[j]; P.inv[j] = null; P.sel = free; }
      else { const t = P.inv[P.sel]; P.inv[P.sel] = P.inv[j]; P.inv[j] = t; }
      return;
    }
    if (st.creative) { const k = free >= 0 ? free : P.sel; P.inv[k] = { id: name, n: V.item(name).stack }; P.sel = k; }
  }
  function dropSel(st, all){
    const P = st.P, s = P.inv[P.sel]; if (!s) return;
    const n = all ? s.n : 1, d = lookDir(st), [ex, ey, ez] = eye(st);
    st.ents?.addItem(ex + d.x * .4, ey - .3, ez + d.z * .4, { id: s.id, n, d: s.d }, false, [d.x * 5, 2.5, d.z * 5]);
    s.n -= n; if (s.n <= 0) P.inv[P.sel] = null;
  }
  // добавить в инвентарь (сначала к таким же, потом в пустые) → сколько не влезло
  function give(st, stack){
    const V = VX(), P = st.P, it = V.item(stack.id); if (!it) return stack.n;
    let n = stack.n;
    for (let pass = 0; pass < 2 && n > 0; pass++) for (let i = 0; i < 36 && n > 0; i++) {
      const s = P.inv[i];
      if (pass === 0 && s && s.id === stack.id && s.n < it.stack && !it.tool) { const k = Math.min(n, it.stack - s.n); s.n += k; n -= k; }
      else if (pass === 1 && !s) { const k = Math.min(n, it.stack); P.inv[i] = { id: stack.id, n: k, d: stack.d | 0 }; n -= k; }
    }
    return n;
  }
  // ═══ Кадр: подгрузка, камера, персонаж, вещь в руке, экран ═══
  const CAMP = { ch: { x: 0, y: 0, z: 0, vx: 0, vz: 0, h: PH, grounded: true }, mode: 'move', running: false, crouchW: 0, stepOff: 0 };
  const PHYS = { raycast(ox, oy, oz, dx, dy, dz, maxT){ const st = S; if (!st) return null; const V = VX(); const h = V.raycast(st.W, ox + st.ox, oy, oz + st.oz, dx, dy, dz, maxT, t => V.T.opaque[t] === 1); return h ? { t: h.t } : null; } };
  function frame(dt, alpha){
    const st = S; if (!st) return;
    const { R, P, rig, I, C, VR, A } = st, V = VX(), t = now() / 1000;
    // мобы, вещи и песок считаются 20 раз в секунду (каждый 3-й шаг логики) — рисуем их плавно: доля пути до следующего такта
    if (st.ents) st.ents.frac = P.dead || !st.ready ? 1 : Math.min(1, ((st.steps % 3) + (alpha || 0)) / 3);   // такты стоят — рисуем как есть
    const f = rig.fwd();
    st.ST.update(P.x, P.z, -f.x, -f.z);
    if (!st.ready) { loadingInfo(st); }
    // камера: мышь, палец, правый стик; колесо мыши — ячейки (щипок пальцами — нет)
    const look = { dx: I.look.dx + C.look.dx, dy: I.look.dy + C.look.dy, zoom: 1 };
    if (I.zoom !== 1 && !I.touch && !st.ui?.isOpen()) { P.sel = (P.sel + (I.zoom > 1 ? 1 : 8)) % 9; }
    const ch = CAMP.ch, U = E().UNIT || 1;
    // скорость — в единицах движка (1 м = UNIT): камера по ней узнаёт бег (шире обзор на 8°) и темп покачивания
    ch.x = P.x - st.ox; ch.y = P.y; ch.z = P.z - st.oz; ch.vx = P.vx * U; ch.vz = P.vz * U; ch.h = P.sneak ? 1.5 : 1.85; ch.grounded = P.onGround;
    CAMP.running = P.sprint; CAMP.crouchW = P.sneak ? 1 : 0;
    const over = st.ui?.isOpen() || st.menu || st.modWin;   // открыто окно поверх мира
    rig.mode = 'first';
    rig.update(dt, CAMP, over ? null : look, PHYS, C);
    camApply(st, dt);
    // ранили — крен камеры: быстро в сторону удара, плавно обратно (0,5 с)
    if (st.roll) { const r = st.roll, q = (r.t += dt); if (q > .5) st.roll = null; else R.camera.rotateZ(r.a * (q < .06 ? Math.sin(q / .06 * PI / 2) : (1 - (q - .06) / .44) ** 2) * PI / 180); }
    I.wantLock = !I.touch && !over && !st.chatEl && !P.dead && !window.D37Settings?.isOpen?.();
    if (st.wasLocked && !I.locked && !over && !st.chatEl && !P.dead && !window.D37Settings?.isOpen?.()) openMenu();
    const padNow = !!st.K?.padLast;
    if (st.wasLocked !== I.locked || st.padWas !== padNow) { st.padWas = padNow; crossUpdate(st); }   // мышь отпущена — прицел прячем (иначе «кружок» висит посреди экрана)
    st.wasLocked = I.locked;
    // мышь не захвачена и окон нет (закрыл меню паузы Esc, браузер не вернул мышь после «Продолжить», только вошёл) — подсказка;
    // через 0,3 с, чтобы не мигала, пока браузер захватывает мышь после «Продолжить»
    const free = st.ready && !I.touch && !I.locked && !padNow && !over && !st.chatEl && !P.dead && !window.D37Settings?.isOpen?.();
    st.freeT = free ? (st.freeT || 0) + dt : 0;
    lockHint(st, st.freeT > .3);
    // персонаж: тело — по взгляду (на ходу поворачивается к движению, но не больше чем на 60°), голова — туда, куда смотрит игрок
    const me = A.get('me');
    if (me) {
      const sp = Math.hypot(P.vx, P.vz), lookYaw = rig.yaw + PI;
      let want = lookYaw;
      if (sp > .5) { const dd = ((Math.atan2(P.vx, P.vz) - lookYaw + PI * 3) % (PI * 2)) - PI; if (Math.abs(dd) < PI / 2) want = lookYaw + clamp(dd, -1.05, 1.05); }
      P.bodyYaw = want;
      A.pose('me', { x: P.x - st.ox, y: P.y, z: P.z - st.oz, yaw: want, moving: sp > .4, speed: sp, air: !P.onGround && !P.climb && !(P.water > .3), crouch: P.sneak ? 1 : 0, swim: P.water > .9, ladder: P.climb && !P.onGround, sit: false });
      me.hidden = !st.camMode || st.camD < .95;   // вид сзади/спереди, а камера прижата к стене — не смотреть изнутри головы
      const [ex, ey, ez] = eye(st), d = lookDir(st);
      me.lookAt = me.lookAt || { x: 0, y: 0, z: 0 };
      me.lookAt.x = ex - st.ox + d.x * 8; me.lookAt.y = ey + d.y * 8; me.lookAt.z = ez - st.oz + d.z * 8;
      if (me.ch && me.ch !== st.meCh) { st.meCh = me.ch; me.ch.root.scale.setScalar(.8); }
    }
    A.update(dt, t, R.camera.position);
    st.hand?.frame(dt, t);   // руки и вещь в руке (поверх позы человечка), свет человечков — как у кубиков
    st.ents?.frame(dt, t);
    st.WX?.frame(dt, t);   // дождь / снег вокруг камеры, шум, гром
    VR.select(st.hit && !C.blocked ? st.hit : null);
    if (st.mine.st >= 0 && st.hit) VR.crack(st.hit.x, st.hit.y, st.hit.z, st.mine.st); else VR.crack(0, 0, 0, -1);
    ghostUpdate(st);
    ringUpdate(st);
    if (st.tbar && st.flyWas !== P.fly) { st.flyWas = P.fly; st.tbarSync?.(); }   // в полёте: ⤒ вверх, ⤓ вниз
    VR.update(dt, t);
    // небо и туман: время суток — раз в 0,25 с
    if ((st.skyT = (st.skyT || 0) - dt) <= 0) {
      st.skyT = .25;
      const wk = st.WX?.k || 0, wq = Math.round(wk * 20) / 20, hq = Math.round(R.lighting.time * 2) / 2, key = wq * 1000 + hq;
      dayLight(R, wk);
      // непогода: небо в дымке, солнце бледнее, горизонт серый (свой цвет тумана мира — плавно от цвета неба к серому),
      // кадр темнее; меняем, только когда сила или время (по 0,5 ч) заметно сдвинулись
      if (key !== st.wxQ) {
        st.wxQ = key;
        let fc = '';
        if (wq > .02) {
          const M = st.skyM = E().skyModel(R.lighting.time, { haze: .2, sun: 1, clouds: .9 }, st.skyM), h = M.hor, g = (.2126 * h[0] + .7152 * h[1] + .0722 * h[2]) * .4, k = .85 * wq;
          fc = '#' + [g * .94, g, g * 1.08].map((v, i) => Math.round(Math.min(1, Math.pow(Math.max(0, h[i] * (1 - k) + v * k), 1 / 2.2)) * 255).toString(16).padStart(2, '0')).join('');
        }
        R.setLighting({ time: R.lighting.time, fogEnd: fogFor(R), gfx: { sky: { haze: .2 + .65 * wq, sun: Math.max(.3, 1 - .7 * wq), clouds: .9 + .1 * wq }, fog: { color: fc }, exposure: -.3 * wq } });
      } else R.setLighting({ time: R.lighting.time, fogEnd: fogFor(R) });
      fogNear(st); st.KL?.afterSky();
    }
    // под водой — синий туман
    underwater(st, dt);
    // лампы у факелов, лавы и ламп, факел в руке, туман в пещере
    st.KL?.frame(dt, t);
    st.AU?.listener(R.camera.position.x, R.camera.position.y, R.camera.position.z, rig.yaw);
    R.update(dt); R.follow(P.x - st.ox, P.z - st.oz, P.y);
    R.render();
    hudUpdate(st);
    I.frameEnd(); C.frameEnd();
  }
  // F5: 1-е лицо → сзади → спереди (как в Майнкрафте)
  function cycleCam(to){
    const st = S; if (!st) return;
    st.camMode = to != null ? to : ((st.camMode | 0) + 1) % 3;
    try { window.D37Settings?.set('view', st.camMode ? 'third' : 'first'); } catch (e) {}
    crossUpdate(st);
    st.H.toast(['👁 Вид от 1-го лица', '🎥 Вид сзади', '🤳 Вид спереди'][st.camMode] + ` (${(st.K || NOK).label('camera') || 'F5'} — дальше)`);
  }
  // вид сзади / спереди: камера в 4 блоках от глаз (ближе, если мешает стена); спереди — смотрит на игрока
  function camApply(st, dt){
    const m = st.camMode | 0, cam = st.R.camera;
    if (!m) { st.camD = 0; return; }
    const V = VX(), [ex, ey, ez] = eye(st), d = lookDir(st), s = m === 1 ? -1 : 1;
    const h = V.raycast(st.W, ex, ey, ez, d.x * s, d.y * s, d.z * s, 4.3, t => V.T.opaque[t] === 1);
    const dist = h ? Math.max(.5, h.t - .3) : 4;
    st.camD = dist < st.camD || !st.camD ? dist : st.camD + (dist - st.camD) * Math.min(1, dt * 6);
    cam.position.set(ex - st.ox + d.x * s * st.camD, ey + d.y * s * st.camD, ez - st.oz + d.z * s * st.camD);
    if (m === 2) cam.lookAt(ex - st.ox, ey, ez - st.oz);
    cam.updateMatrixWorld();
  }
  // прицел: виден от 1-го лица и сзади; не виден спереди, без интерфейса (F1) и на телефоне в режиме «под пальцем»
  function crossUpdate(st){ st.H.crosshair(st.camMode !== 2 && !st.hudHidden && !(st.I.touch && opts.touchMode !== 'cross') && (st.I.touch || st.I.locked || !!st.K?.padLast)); }
  // «🖱 Нажми на мир, чтобы играть» — щелчок проходит сквозь подсказку в мир, мир сам захватывает мышь (input.js, wantLock)
  function lockHint(st, on){
    if (!st.lockEl) {
      if (!on) return;
      const el = document.createElement('div'); el.className = 'kb-lockhint'; el.textContent = '🖱 Нажми на мир, чтобы играть';
      const w = wrap(); if (!w) return; w.appendChild(el); st.lockEl = el; return;
    }
    if (st.lockEl.hidden !== !on) st.lockEl.hidden = !on;
  }
  // F1: спрятать всё (для снимков), ещё раз — вернуть
  function hideHud(on){
    const st = S; if (!st) return;
    st.hudHidden = !!on;
    wrap()?.classList.toggle('kb-nohud', st.hudHidden);
    crossUpdate(st);
  }
  // «призрак» блока: куда встанет блок из руки (ПКМ) — полупрозрачный, только для обычных кубиков
  function ghostUpdate(st){
    const VR = st.VR; if (!VR.ghost) return;
    const V = VX(), P = st.P, s = P.inv[P.sel], it = s && V.item(s.id), b = it?.place && V.block(it.place), hit = st.hit;
    let pos = null;
    if (hit && b && b.shape === V.SHAPE.cube && !st.hudHidden && !st.C.blocked && opts.ghost !== false) {
      const hb = V.blocks[hit.v & 0xfff];
      const usable = !P.sneak && (hb.ui || hb.shape === V.SHAPE.door || st.modRun?.hasUse(hb.name));
      if (!usable) {
        let x = hit.x, y = hit.y, z = hit.z;
        if (!(hb.replace && !hb.liquid && hb.id !== b.id)) { x += hit.nx; y += hit.ny; z += hit.nz; }
        const cur = st.W.get(x, y, z);
        if (y >= 1 && y < V.H - 1 && cur >= 0 && V.blocks[cur].replace && !(b.solid && boxOverlap(P, x, y, z, 1))) pos = [x, y, z];
      }
    }
    VR.ghost(pos ? b.name : null, pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0, it?.name);
  }
  // кольцо ломания вокруг пальца (телефон): сколько осталось до «сломал»
  function ringUpdate(st){
    if (!st.I.touch) return;
    const K = st.K || NOK, k = st.mine.k || 0, f = K.finger, on = k > 0 && !!st.hit && !st.C.blocked;
    let r = st.ringEl;
    if (!r) { r = st.ringEl = document.createElement('div'); r.className = 'kb-ring'; r.innerHTML = '<i></i>'; wrap()?.appendChild(r); }
    r.hidden = !on;
    if (!on) return;
    const b = wrap().getBoundingClientRect(), tap = opts.touchMode !== 'cross' && f;
    r.style.left = (tap ? f.x - b.left : b.width / 2) + 'px'; r.style.top = (tap ? f.y - b.top : b.height / 2) + 'px';
    r.style.setProperty('--k', String(Math.round(k * 100)));
  }
  // кнопки телефона «как в Bedrock»: прыжок (в полёте — вверх), красться (переключатель; в полёте — вниз), вещи;
  // в режиме «прицел» — ещё ⛏ и 🧱
  function touchUI(st){
    const K = st.K; if (!K) return;
    const cross = opts.touchMode === 'cross';
    wrap()?.classList.toggle('kb-touchtap', !cross);
    st.touchSneak = false;
    const list = [
      { id: 'inv', icon: '🎒', label: 'вещи', onTap: () => { if (S?.ui?.isOpen()) S.ui.close(); else S?.ui?.open('inv'); } },
      { id: 'sneak', icon: '⬇', label: 'красться', toggle: () => (S.touchSneak = !S.touchSneak) },
      { id: 'down', icon: '⤓', label: 'вниз', k: 'sneak' },
    ];
    if (cross) list.push({ id: 'place', icon: '🧱', label: 'поставить', c: 'place' }, { id: 'mine', icon: '⛏', label: 'ломать', c: 'mine' });
    list.push({ id: 'jump', icon: '⤒', label: 'прыжок', big: true, c: 'jump' });
    st.tbar = K.touchBar(wrap(), list);
    st.tbarSync = () => { const fly = !!S?.P?.fly; st.tbar.show('sneak', !fly); st.tbar.show('down', fly); st.tbar.btn('jump').querySelector('b').textContent = fly ? 'вверх' : 'прыжок'; if (fly && S) S.touchSneak = false; st.tbar.on('sneak', !!S?.touchSneak); };
    st.tbarSync();
  }

  // ═══ Экран: полоски здоровья и еды, панель вещей, отладка ═══
  function hudBuild(wr){
    const h = document.createElement('div'); h.className = 'kb-hud';
    h.innerHTML = `<div class="kb-flash"></div><div class="kb-hurt"></div><div class="kb-lowhp"></div><div class="kb-dbg" hidden></div><div class="kb-log"></div><div class="kb-tip" hidden><div><b>ПОДСКАЗКА</b><span></span></div><button type="button" aria-label="Скрыть подсказки" title="Скрыть подсказки в этом мире">✕</button></div>
      <div class="kb-bottom"><div class="kb-bars"><div class="kb-hp"></div><div class="kb-food"></div></div><div class="kb-air"></div><div class="kb-iname"></div>
      <div class="kb-hotbar">${Array.from({ length: 9 }, (_, i) => `<div class="kb-slot" data-s="${i}"><i></i><b></b><u></u></div>`).join('')}</div></div>
      <div class="kb-loadbar" hidden><div class="spinner"></div><b>Строим мир вокруг…</b><small></small></div>`;
    // панель вещей: нажал — выбрать; провёл пальцем — выбор едет за пальцем; подержал (палец) — выбросить по одной
    const hb = h.querySelector('.kb-hotbar');
    h.querySelector('.kb-tip button').addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (S) { S.meta.tips = false; tipsUpdate(S); S.H?.toast('Подсказки скрыты (вернуть — ⚙️ «🧊 Кубомир»)'); } });
    let hp = null;
    const slotAt = (x, y) => { const s = document.elementFromPoint(x, y)?.closest?.('.kb-hotbar [data-s]'); return s ? +s.dataset.s : -1; };
    const holdDrop = () => { if (!hp || !S) return; dropSel(S, false); hp.timer = setTimeout(holdDrop, 220); };
    hb.addEventListener('pointerdown', e => {
      const s = e.target.closest('[data-s]'); if (!s || !S) return;
      e.stopPropagation(); e.preventDefault();
      S.P.sel = +s.dataset.s;
      try { hb.setPointerCapture(e.pointerId); } catch (er) {}
      hp = { id: e.pointerId, slot: S.P.sel, touch: e.pointerType === 'touch', timer: 0 };
      if (hp.touch) hp.timer = setTimeout(holdDrop, 550);
    });
    hb.addEventListener('pointermove', e => {
      if (!hp || hp.id !== e.pointerId || !S) return;
      const i = slotAt(e.clientX, e.clientY);
      if (i >= 0 && i !== hp.slot) { hp.slot = i; S.P.sel = i; clearTimeout(hp.timer); if (hp.touch) hp.timer = setTimeout(holdDrop, 550); }
    });
    const end = e => { if (!hp || hp.id !== e.pointerId) return; clearTimeout(hp.timer); hp = null; };
    hb.addEventListener('pointerup', end); hb.addEventListener('pointercancel', end);
    wr.appendChild(h);
    return h;
  }
  function hudUpdate(st){
    const h = st.hudEl, P = st.P, C = st.hud, V = VX();
    // панель вещей
    for (let i = 0; i < 9; i++) {
      const s = P.inv[i], key = s ? s.id + ':' + s.n + ':' + (s.d | 0) : '', sel = i === P.sel;
      if (C['s' + i] !== key + sel) {
        C['s' + i] = key + sel;
        const d = h.querySelectorAll('.kb-slot')[i];
        d.classList.toggle('on', sel);
        d.querySelector('i').style.backgroundImage = s ? `url(${V.iconURL(s.id, 40)})` : '';
        d.querySelector('b').textContent = s && s.n > 1 ? s.n : '';
        const it = s && V.item(s.id), dur = it?.tool && s.d ? 1 - s.d / it.tool.dur : -1;
        const u = d.querySelector('u'); u.style.display = dur >= 0 ? '' : 'none'; if (dur >= 0) { u.style.width = Math.round(dur * 80) + '%'; u.style.background = dur > .5 ? '#4ade80' : dur > .2 ? '#facc15' : '#ef4444'; }
      }
    }
    const nm = P.inv[P.sel] ? V.item(P.inv[P.sel].id)?.title || '' : '';
    if (C.nm !== nm) { C.nm = nm; const e = h.querySelector('.kb-iname'); e.textContent = nm; e.classList.remove('show'); void e.offsetWidth; if (nm) e.classList.add('show'); }
    // здоровье, еда, воздух (в творчестве — нет)
    const surv = !st.creative, bars = surv ? P.hp + '|' + P.food + '|' + Math.ceil(P.air) + '|' + (P.eyeWater ? 1 : 0) : 'c';
    if (C.bars !== bars) {
      C.bars = bars;
      const icons = (n, full, half, empty) => { let s = ''; for (let i = 0; i < 10; i++) s += n >= (i + 1) * 2 ? full : n === i * 2 + 1 ? half : empty; return s; };
      h.querySelector('.kb-bars').hidden = !surv;
      h.classList.toggle('kb-low', surv && P.hp <= 6 && !P.dead);   // мало здоровья — края экрана красноватые
      if (surv) {
        h.querySelector('.kb-hp').innerHTML = icons(P.hp, '<i class="f">❤</i>', '<i class="h">❤</i>', '<i class="e">❤</i>');
        h.querySelector('.kb-food').innerHTML = icons(P.food, '<i class="f">🍗</i>', '<i class="h">🍗</i>', '<i class="e">🍗</i>');
        const air = h.querySelector('.kb-air'); air.hidden = !(P.eyeWater || P.air < 15);
        air.textContent = '🫧'.repeat(Math.max(0, Math.ceil(P.air / 1.5)));
      } else h.querySelector('.kb-air').hidden = true;
    }
    // отладка (F3)
    if (st.dbg) {
      const d = h.querySelector('.kb-dbg');
      if ((st.dbgT = (st.dbgT || 0) - 1) <= 0) {
        st.dbgT = 10;
        const s = st.ST.stats, r = st.VR.count(), c = st.G ? V.genColumn(st.G, Math.floor(P.x), Math.floor(P.z), {}) : null, L = st.W.lightAt(P.x, P.y + 1, P.z), rs = st.R.stats;
        d.innerHTML = `XYZ ${P.x.toFixed(1)} / ${P.y.toFixed(1)} / ${P.z.toFixed(1)} · чанк ${Math.floor(P.x) >> 4}, ${Math.floor(P.z) >> 4}<br>биом ${c ? V.BIOMES[c.b] : '—'} · свет небо ${V.lSky(L)} блоки ${V.lR(L)}/${V.lG(L)}/${V.lB(L)} · время ${st.R.lighting.time.toFixed(1)} ч<br>`
          + `чанков ${s.chunks} · сетка ${s.mesh} (${(s.meshMs / Math.max(1, s.mesh)).toFixed(1)} мс) · ген ${s.gen} (${(s.genMs / Math.max(1, s.gen)).toFixed(1)} мс) · в работе ${s.jobs} · ждут ${s.pend}<br>`
          + (st.WX ? `погода: ${st.WX.biome} · дождь ${st.WX.rain.toFixed(2)} · снег ${st.WX.snow.toFixed(2)}<br>` : '') + `мешей ${r.meshes} · квадов ${(r.quads / 1000).toFixed(0)} тыс. · пул ${r.poolFree} · ~${(r.bytes / 1048576).toFixed(0)} МБ · вызовов ${rs.calls} · ${st.ST.inline ? 'без потоков' : st.ST.workers.length + ' поток(а)'} · дальность ${opts.rd}`;
      }
    }
  }
  function loadingInfo(st){
    const b = st.hudEl.querySelector('.kb-loadbar');
    b.hidden = false;
    const s = st.ST.stats;
    b.querySelector('small').textContent = `чанков готово: ${s.mesh} · в работе ${s.jobs}`;
    if (st.ready) b.hidden = true;
  }
  function housekeeping(){
    const st = S; if (!st) return;
    if (st.ready) st.hudEl.querySelector('.kb-loadbar').hidden = true;
    tipsUpdate(st);
    // награды: очередь достижений (сервер — не чаще раза в 20 с)
    if (st.achQ.length && (!st.achAt || now() - st.achAt > 21000)) { const a = st.achQ.shift(); st.achAt = now(); rewardAch(a); }
    st.modRun?.second?.();
  }

  // ═══ Подсказки новичку (выживание): следующий шаг — по достижениям этого мира и вещам; после смерти — где лежат вещи ═══
  const hasItem = (st, re) => st.P.inv.some(s => s && re.test(s.id));
  const ARROWS = ['⬆', '↗', '➡', '↘', '⬇', '↙', '⬅', '↖'];
  function tipText(st){
    const A = st.meta.ach || {}, P = st.P, t = st.R.lighting.time, touch = !!st.I?.touch, K = st.K || NOK;
    const D = st.lastDeath;
    if (D && D.drop && now() - D.t < 300000) {
      const dx = D.x - P.x, dz = D.z - P.z, d = Math.hypot(dx, dz);
      if (d > 4) { const f = lookDir(st), a = Math.atan2(dx * f.z - dz * f.x, dx * f.x + dz * f.z), i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8; return `📍 Твои вещи — в ${Math.round(d)} блоках ${ARROWS[i]} (X ${Math.floor(D.x)}, Z ${Math.floor(D.z)}). Лежат ещё ${Math.ceil((300000 - (now() - D.t)) / 60000)} мин`; }
      if (d <= 4) st.lastDeath = null;
    }
    if (P.food <= 6) return `🍗 Ты голоден и не можешь бежать: возьми еду в руку и ${touch ? 'нажми на экран' : 'держи ПКМ'} — съешь`;
    if (!A.log && !hasItem(st, /^log_/)) return `🪵 Подойди к дереву и ${touch ? 'держи палец на стволе' : 'держи ЛКМ на стволе'} — добудешь брёвна`;
    if (!A.table && !hasItem(st, /^planks_/) && !hasItem(st, /^crafting_table$/)) return `🎒 Открой вещи (${touch ? '🎒' : K.label('inventory') || 'E'}) и в «📖 Можно сделать» нажми доски`;
    if (!A.table) return '🛠️ Сделай верстак из 4 досок (📖 в окне вещей), поставь его и открой — там сетка 3×3';
    if (!A.pick) return '⛏️ На верстаке сделай деревянную кирку — «📖 Можно сделать» подскажет, чего не хватает';
    if (!A.stone_pick) return '🪨 Накопай камня (серые блоки, нужна кирка) и сделай каменную кирку — копает быстрее и берёт железо';
    if (!A.night && t > 16.8 && t < 19) return '🌙 Скоро ночь — придут зомби. Построй укрытие или выкопай нору и поставь факелы';
    if (!A.coal) return '⚫ Найди уголь — чёрные пятна в камне; из угля и палки делают факелы';
    if (!A.torch) return '🔥 Поставь факел: рядом со светом монстры не появляются';
    if (!A.furnace) return '🧱 Сделай печь из 8 булыжников — в ней плавят руду и жарят мясо';
    if (!A.iron) return '🔩 Железная руда — рыжие пятна в камне. Выплавь её в печи (топливо — уголь или доски)';
    return '';
  }
  function tipsUpdate(st){
    const box = st.hudEl?.querySelector('.kb-tip'); if (!box) return;
    const txt = !st.creative && st.meta.tips !== false && !st.P.dead && st.ready ? tipText(st) : '';
    if (st.tipNow !== txt) { st.tipNow = txt; box.hidden = !txt; if (txt) box.querySelector('span').textContent = txt; }
  }

  // ═══ Достижения ═══
  function unlock(id){
    const st = S; if (!st || (st.creative && id !== 'mod')) return;
    const a = ACH_BY.get(id); if (!a) return;
    const all = lsGet(LS_ACH, {});
    st.meta.ach = st.meta.ach || {};
    if (st.meta.ach[id]) return;
    st.meta.ach[id] = Date.now();
    if (all[id]) return;   // это достижение уже было (в другом мире) — без новой награды
    all[id] = Date.now(); lsSet(LS_ACH, all);
    st.H?.toast(`${a[1]} Достижение: ${a[2]}!`, true);
    st.AU?.play('coin', { vol: .5 });
    st.achQ.push(a);
  }
  async function rewardAch(a){
    const n = Object.keys(lsGet(LS_ACH, {})).length;
    try { const r = await window.D37Coins?.run(ID, a[4], 'kb:' + a[0]); if (r?.got) S?.H?.toast(`🪙 +${r.got} за «${a[2]}»`, true); } catch (e) {}
    try { await api?.report(ID, true, n, n); } catch (e) {}
  }

  // ═══ Меню паузы, чат и команды ═══
  function openMenu(){
    const st = S; if (!st || st.menu || !window.D37Settings) return;
    st.I.unlock();
    const fsOn = () => !!window.D37Full?.contains?.(wrap());
    st.menu = window.D37Settings.menu(wrap(), {
      title: '🧊 ' + esc(st.meta.name), sub: st.creative ? '🎨 Творчество' : '⚔️ Выживание · мир сохраняется сам',
      items: () => [
        { id: 'resume', icon: '▶', text: 'Продолжить', primary: true },
        { id: 'settings', icon: '⚙️', text: 'Настройки' },
        { id: 'mods', icon: '🧩', text: 'Моды мира' + (st.mods.loaded.length ? ` (${st.mods.loaded.length})` : '') },
        { id: 'mc', icon: '📥', text: 'Импорт из Minecraft' },
        { id: 'export', icon: '📤', text: 'Сохранить файл мира' },
        { id: 'full', icon: window.D37Full?.icon?.(fsOn()) || '⛶', text: fsOn() ? 'Обычный экран' : 'Во весь экран' },
        { id: 'help', icon: '❓', text: 'Как играть' },
        { id: 'exit', icon: '🏠', text: 'Сохранить и выйти в меню', warn: true },
      ],
      onPick: id => menuPick(id),
      onClose: () => { if (S) { S.menu = null; S.C?.reset_state(); } },
    });
  }
  function closeMenu(){ S?.menu?.close(); }
  async function menuPick(id){
    const st = S; if (!st) return;
    if (id === 'resume') { closeMenu(); if (!st.I.touch) st.I.lock?.(); }   // не вышло (браузер не дал сразу после Esc) — «🖱 Нажми на мир»
    else if (id === 'settings') window.D37Settings?.open({ ctx: 'engine', tab: 'kubomir' });
    else if (id === 'mods') { closeMenu(); window.KubomirMods?.worldPanel?.(st, wrap(), { restart: ids => { if (S !== st) return; st.meta.mods = ids; restartWorld(); } }); }
    else if (id === 'mc') { closeMenu(); mcWindow(st); }
    else if (id === 'export') { await saveAll(st); exportWorld(st.meta.id); }
    else if (id === 'full') { window.D37Full?.toggle(el.closest('#gamesStage') || wrap(), { esc: false }); setTimeout(() => S?.menu?.redraw(), 80); }
    else if (id === 'help') help();
    else if (id === 'exit') { closeMenu(); const sc = screen(); await stopWorld(); if (sc) showMenu(); }
  }
  // «📥 Импорт из Minecraft» в игре: окно поверх мира (постройку — перед собой, мир — новым миром)
  function mcWindow(st){
    if (!window.KubomirMC || st.modWin) return;
    st.I.unlock();
    const box = document.createElement('div'); box.className = 'kb-inv kb-modwin kb-ui kb-mcwin';
    box.innerHTML = '<div class="kb-mcbox"></div>';
    const close = () => { box.remove(); st.C?.reset_state?.(); if (st.modWin === box) st.modWin = null; };
    box.close = close;
    box.addEventListener('click', e => { if (e.target === box) close(); });
    wrap().appendChild(box); st.modWin = box;
    window.KubomirMC.open(box.querySelector('.kb-mcbox'), { st, back: close, play: async id => { close(); const sc = screen(); await stopWorld(); if (sc) playById(id); } });
  }
  function chatOpen(prefix){
    const st = S; if (!st || st.chatEl) return;
    st.I.unlock();
    const f = document.createElement('form'); f.className = 'kb-chat kb-ui';
    f.innerHTML = '<input type="text" maxlength="200" autocomplete="off" placeholder="Команда: /help, /time day, /gamemode creative…">';
    wrap().appendChild(f); st.chatEl = f;
    const inp = f.querySelector('input'); if (prefix) inp.value = prefix;
    setTimeout(() => { inp.focus(); inp.setSelectionRange?.(inp.value.length, inp.value.length); }, 0);
    f.onsubmit = e => { e.preventDefault(); const v = inp.value.trim(); chatClose(); if (v) command(v); };
    inp.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); chatClose(); } });
  }
  function chatClose(){ const st = S; if (!st?.chatEl) return; st.chatEl.remove(); st.chatEl = null; st.C.reset_state(); }
  function log(t){
    const st = S; if (!st) return;
    const box = st.hudEl.querySelector('.kb-log'), d = document.createElement('div'); d.textContent = t; box.appendChild(d);
    while (box.children.length > 8) box.firstChild.remove();
    setTimeout(() => d.classList.add('old'), 9000);
  }
  function command(line){
    const st = S; if (!st) return;
    if (line[0] !== '/') { log('💬 ' + line); st.modRun?.event('chat', { text: line }); return; }
    const [cmd, ...a] = line.slice(1).split(/\s+/), P = st.P, V = VX();
    const cheat = st.creative || st.meta.cheats;
    switch (cmd) {
      case 'help': log('Команды: /time day|night|<часы>, /weather clear|rain|auto, /gamemode survival|creative, /tp x y z, /seed, /give <вещь> [сколько], /spawn, /where'); for (const c of st.modRun?.commandInfo?.() || []) log(`🧩 /${c.name}${c.desc ? ' — ' + c.desc : ''} (${c.mod})`); return;
      case 'seed': log('🌱 Зерно мира: ' + st.meta.seed); return;
      case 'weather': { if (!cheat || !st.WX) break; const f = a[0] === 'rain' || a[0] === 'snow' ? 1 : a[0] === 'clear' ? 0 : null; st.WX.force = f; log(f == null ? '🌦 Погода — по расписанию мира' : f ? '🌧 Непогода (дождь, в снегах — снег)' : '☀️ Ясно'); return; }
      case 'where': log(`📍 ${Math.floor(P.x)} ${Math.floor(P.y)} ${Math.floor(P.z)}`); return;
      case 'time': { if (!cheat) break; const h = a[0] === 'day' ? 8 : a[0] === 'night' ? 21 : a[0] === 'noon' ? 12 : +a[0]; if (Number.isFinite(h)) { st.R.lighting.time = ((h % 24) + 24) % 24; log('🕐 Время: ' + st.R.lighting.time + ' ч'); } return; }
      case 'gamemode': { if (!cheat && a[0] !== 'survival') break; const c = a[0] === 'creative' || a[0] === 'c' || a[0] === '1'; st.creative = c; st.meta.mode = c ? 'creative' : 'survival'; if (c) st.meta.cheats = true; P.fly = false; log(c ? '🎨 Творчество (достижения в этом мире больше не засчитываются)' : '⚔️ Выживание'); setWhere(st.meta.name + (c ? ' · 🎨' : '')); return; }
      case 'tp': { if (!cheat) break; const x = +a[0], y = +a[1], z = +a[2]; if ([x, y, z].every(Number.isFinite) && Math.abs(x) < V.LIMIT && Math.abs(z) < V.LIMIT) { P.x = x; P.y = clamp(y, 1, V.H + 20); P.z = z; P.vy = 0; P.fallTop = P.y; rebase(true); st.ready = false; log('✨ Телепорт'); } return; }
      case 'spawn': { const sp = st.meta.spawn; P.x = sp.x; P.y = sp.y; P.z = sp.z; P.vy = 0; rebase(true); st.ready = false; return; }
      case 'give': { if (!cheat) break; const it = V.item(a[0]) || V.items.find(i => i.title.toLowerCase() === (a.join(' ') || '').toLowerCase()); if (!it) { log('Нет такой вещи'); return; } const n = clamp(+a[1] || it.stack, 1, 640); give(st, { id: it.name, n }); log('🎁 ' + it.title + ' × ' + n); return; }
      default: if (st.modRun?.command(cmd, a)) return; log('Нет такой команды. /help — список'); return;
    }
    log('🔒 Эта команда — только в «Творчестве»');
  }

  // ═══ Настройки: своя вкладка «🧊 Кубомир» в ⚙️ ═══
  function settingsTab(off){
    const D = window.D37Settings; if (!D?.addTab) return;
    if (off) { D.addTab({ id: 'kubomir', icon: '🧊', title: 'Кубомир', order: 5, ctx: [], render: () => '' }); return; }
    D.addTab({ id: 'kubomir', icon: '🧊', title: 'Кубомир', order: 5, ctx: ['engine'], render(body){
      const st = S;
      const seg = (k, list, cur) => `<div class="gs-seg">${list.map(([v, t]) => `<button type="button" class="${String(cur) === String(v) ? 'on' : ''}" data-kbo="${k}:${v}">${t}</button>`).join('')}</div>`;
      const K = st?.K;
      body.innerHTML = `<div class="gs-row"><div class="gs-lbl">Дальность прорисовки<small>Сколько чанков (по 16 блоков) видно во все стороны. Меньше — быстрее, особенно на телефоне.</small></div><div class="gs-ctl">${seg('rd', RD_OPTS.map(n => [n, n]), opts.rd)}</div></div>
        <div class="gs-row"><div class="gs-lbl">Телефон: как ломать и ставить<small>«Под пальцем» — как в Bedrock: нажал по блоку — поставить, держишь — ломать. «Прицел» — по центру экрана, кнопки ⛏ и 🧱.</small></div><div class="gs-ctl">${seg('touchMode', [['tap', 'Под пальцем'], ['cross', 'Прицел']], opts.touchMode === 'cross' ? 'cross' : 'tap')}</div></div>
        <div class="gs-row"><div class="gs-lbl">Автопрыжок на телефоне<small>Упёрся в ступеньку в один блок — прыгнет сам.</small></div><div class="gs-ctl">${seg('autoJump', [[1, 'Вкл'], [0, 'Выкл']], opts.autoJump === false ? 0 : 1)}</div></div>
        <div class="gs-row"><div class="gs-lbl">Красться<small>Держать Shift — как в Майнкрафте по умолчанию; «Нажал — отжал» — один раз нажать, ещё раз — встать.</small></div><div class="gs-ctl">${seg('sneakToggle', [[0, 'Держать'], [1, 'Нажал — отжал']], opts.sneakToggle ? 1 : 0)}</div></div>
        <div class="gs-row"><div class="gs-lbl">Бег<small>Держать Ctrl или один раз нажать.</small></div><div class="gs-ctl">${seg('sprintToggle', [[0, 'Держать'], [1, 'Нажал — отжал']], opts.sprintToggle ? 1 : 0)}</div></div>
        <div class="gs-row"><div class="gs-lbl">«Призрак» блока<small>Полупрозрачный кубик там, куда встанет блок из руки.</small></div><div class="gs-ctl">${seg('ghost', [[1, 'Вкл'], [0, 'Выкл']], opts.ghost === false ? 0 : 1)}</div></div>
        <div class="gs-row"><div class="gs-lbl">Времена года<small>«Как в общем мире» — как у всех на сайте: быстрые сезоны (около недели), декабрь–январь — зима, ноябрь — осень. «По игровым дням» — 3 суток игры на сезон. Зимой снег на блоках и лёд на озёрах (по нему можно ходить), осенью желтеет листва. «Выкл» — всегда лето.</small></div><div class="gs-ctl">${seg('seasons', [['calendar', 'Как в общем мире'], ['cycle', 'По игровым дням'], ['off', 'Выкл']], opts.seasons || 'calendar')}</div></div>
        <div class="gs-row"><div class="gs-lbl">Деревья падают<small>Подрубил ствол — дерево валится от тебя и рассыпается на брёвна (только настоящие деревья, не постройки).</small></div><div class="gs-ctl">${seg('fell', [[1, 'Вкл'], [0, 'Выкл']], opts.fell === false ? 0 : 1)}</div></div>
        <div class="gs-row"><div class="gs-lbl">Погода<small>Дождь и снег по месту (в пустыне — сухо): небо темнее, капли и хлопья вокруг, шум дождя. На «низкой» графике — без капель.</small></div><div class="gs-ctl">${seg('weather', [[1, 'Вкл'], [0, 'Выкл']], opts.weather === false ? 0 : 1)}</div></div>
        ${st && !st.creative ? `<div class="gs-row"><div class="gs-lbl">Подсказки новичку<small>Вверху слева — что делать дальше: брёвна, верстак, кирка, факелы… и где лежат вещи после смерти.</small></div><div class="gs-ctl">${seg('tips', [[1, 'Показывать'], [0, 'Скрыть']], st.meta.tips === false ? 0 : 1)}</div></div>` : ''}
        ${K ? K.keysHtml(K.capId) : '<p class="gs-note">Клавиши «Кубомира» можно поменять, когда открыт мир.</p>'}
        ${st ? `<p class="gs-note">Мир: ${esc(st.meta.name)} · зерно ${esc(st.meta.seed)} · потоков: ${st.ST.inline ? 'нет (всё в кадре)' : st.ST.workers.length}. F3 — сведения о мире и скорости.</p>` : ''}`;
      body.onclick = e => {
        if (K && K.keysClick(e, () => D.refresh())) return;
        const b = e.target.closest('[data-kbo]'); if (!b) return;
        const [k, v] = b.dataset.kbo.split(':');
        if (k === 'rd') { opts.rd = +v; S?.ST.setRd(opts.rd); if (S) S.R.setLighting({ fogEnd: fogFor(S.R) }); }
        if (k === 'autoJump') opts.autoJump = v === '1';
        if (k === 'touchMode') { opts.touchMode = v; if (S?.I.touch) { touchUI(S); crossUpdate(S); } }
        if (k === 'sneakToggle') { opts.sneakToggle = v === '1'; if (S) S.sneakOn = false; }
        if (k === 'sprintToggle') { opts.sprintToggle = v === '1'; if (S) S.sprintOn = false; }
        if (k === 'ghost') opts.ghost = v === '1';
        if (k === 'fell') opts.fell = v === '1';
        if (k === 'weather') { opts.weather = v === '1'; if (S) S.weatherOff = !opts.weather; }
        if (k === 'seasons') { opts.seasons = ['calendar', 'cycle', 'off'].includes(v) ? v : 'calendar'; if (S) S.WX?.setSeasons?.(opts.seasons); }
        if (k === 'tips' && S) { S.meta.tips = v === '1'; tipsUpdate(S); }
        lsSet(LS_OPT, opts); D.refresh();
      };
    } });
  }

  // ═══ Звуки «Кубомира» (шум через резонаторы, как все звуки движка) ═══
  function sounds(){
    const Sy = E().synth; if (!Sy?.add || Sy.NAMES.includes('kb_place')) return;
    Sy.add('kb_dig_stone', k => { const a = new k.Bp(1800, 1.2), b = new k.Bp(420, 1.4); let hp = 0; return k.make(.16, 201, (t, r) => { const w = k.N(r); hp += (w - hp) * .4; return (w - hp) * k.exp(-t * 90) * .9 + a.do(w) * k.exp(-t * 60) * 1.4 + b.do(w) * k.exp(-t * 45) * 1.6; }, .1); });
    Sy.add('kb_dig_wood', k => { const a = new k.Bp(260, 3), b = new k.Bp(900, 2); return k.make(.18, 202, (t, r) => { const w = k.N(r); return a.do(w) * k.exp(-t * 30) * 3 + b.do(w) * k.exp(-t * 50) * 1.2; }, .11); });
    Sy.add('kb_dig_dirt', k => { const a = new k.Bp(180, 1), b = new k.Bp(1300, .8); let lp = 0; return k.make(.17, 203, (t, r) => { const w = k.N(r); lp += (w - lp) * .1; return lp * k.exp(-t * 26) * 2 + a.do(w) * k.exp(-t * 34) * 1.6 + b.do(w) * k.exp(-t * 50) * .5; }, .1); });
    Sy.add('kb_dig_grass', k => { const a = new k.Bp(3200, .8), b = new k.Bp(160, 1.1); return k.make(.2, 204, (t, r) => { const w = k.N(r); return a.do(w) * k.exp(-Math.abs(t - .04) * 30) * .8 + b.do(w) * k.exp(-t * 30) * 1.5; }, .09); });
    Sy.add('kb_place', k => { const a = new k.Bp(150, 1.3), b = new k.Bp(700, 1.6); let hp = 0; return k.make(.14, 205, (t, r) => { const w = k.N(r); hp += (w - hp) * .3; return a.do(w) * k.exp(-t * 40) * 3 + b.do(w) * k.exp(-t * 60) * 1 + (w - hp) * k.exp(-t * 200) * .4; }, .12); });
    Sy.add('kb_hurt', k => { const a = new k.Bp(520, 2.2), b = new k.Bp(250, 2); return k.make(.22, 206, (t, r) => { const w = k.N(r), e = Math.sin(Math.min(1, t / .22) * Math.PI); return (a.do(w) * 1.8 + b.do(w) * 1.4) * e; }, .1, .04); });
    Sy.add('kb_eat', k => { const a = new k.Bp(2400, 1.5); return k.make(.5, 207, (t, r) => { const w = k.N(r); let s = 0; for (const at of [0, .12, .25, .37]) if (t >= at) s += a.do(w) * k.exp(-(t - at) * 40); return s; }, .08); });
    Sy.add('kb_bounce', k => { const a = new k.Bp(300, 4), b = new k.Bp(600, 3); return k.make(.3, 208, (t, r) => { const w = k.N(r); return (a.do(w) * 2 + b.do(w)) * k.exp(-t * 12); }, .1); });
    Sy.add('kb_moo', k => { const a = new k.Bp(150, 6), b = new k.Bp(310, 5), c = new k.Bp(640, 4); return k.make(1, 209, (t, r) => { const w = k.N(r), e = Math.sin(Math.min(1, t / 1) * Math.PI); return (a.do(w) * 3 + b.do(w) * 2 + c.do(w)) * e * (.8 + .2 * Math.sin(t * 9)); }, .08, .1); });
    Sy.add('kb_oink', k => { const a = new k.Bp(420, 5), b = new k.Bp(900, 4); return k.make(.3, 210, (t, r) => { const w = k.N(r), e = Math.sin(Math.min(1, t / .3) * Math.PI); return (a.do(w) * 2.5 + b.do(w)) * e; }, .08); });
    Sy.add('kb_cluck', k => { const a = new k.Bp(1400, 5), b = new k.Bp(2600, 4); return k.make(.25, 211, (t, r) => { const w = k.N(r); let s = 0; for (const at of [0, .1]) if (t >= at) s += (a.do(w) * 2 + b.do(w)) * k.exp(-(t - at) * 35); return s; }, .07); });
    Sy.add('kb_groan', k => { const a = new k.Bp(110, 4), b = new k.Bp(230, 3), c = new k.Bp(480, 2); return k.make(1.1, 212, (t, r) => { const w = k.N(r), e = Math.sin(Math.min(1, t / 1.1) * Math.PI); return (a.do(w) * 3 + b.do(w) * 2 + c.do(w) * .6) * e * (.7 + .3 * Math.sin(t * 5)); }, .09, .1); });
    Sy.add('kb_squish', k => { const a = new k.Bp(240, 3), b = new k.Bp(900, 2); let lp = 0; return k.make(.3, 213, (t, r) => { const w = k.N(r); lp += (w - lp) * .2; return (a.do(w) * 2 + lp * 1.2 + b.do(w) * .5) * k.exp(-t * 14); }, .1); });
    Sy.add('kb_pop', k => { const a = new k.Bp(2100, 3); return k.make(.08, 214, (t, r) => a.do(k.N(r)) * k.exp(-t * 70), .07, .01); });
    // шаги: песок — мягкий шорох, гравий — хруст камешков, снег — скрип; всплеск; «пуф» (моб исчез облачком)
    Sy.add('kb_step_sand', k => { const a = new k.Bp(900, .7), b = new k.Bp(2600, .9); let lp = 0; return k.make(.2, 215, (t, r) => { const w = k.N(r); lp += (w - lp) * .15; return (a.do(w) * 1.3 + b.do(w) * .7) * k.exp(-Math.abs(t - .03) * 28) + lp * k.exp(-t * 30) * .8; }, .07); });
    Sy.add('kb_step_gravel', k => { const a = new k.Bp(1500, 1.4), b = new k.Bp(500, 1.2); return k.make(.22, 216, (t, r) => { const w = k.N(r), c = r() < .03 ? k.N(r) * 3 : 0; return (a.do(w + c) * 1.4 + b.do(w) * 1.1) * k.exp(-t * 18); }, .08); });
    Sy.add('kb_step_snow', k => { const a = new k.Bp(1100, 1.8), b = new k.Bp(3400, 1.2); return k.make(.22, 217, (t, r) => { const w = k.N(r), e = Math.sin(Math.min(1, t / .2) * Math.PI); return (a.do(w) * 1.4 + b.do(w) * .5) * e; }, .07); });
    Sy.add('kb_splash', k => { const a = new k.Bp(700, .8), b = new k.Bp(2200, 1), c = new k.Bp(5000, 1.2); return k.make(.6, 218, (t, r) => { const w = k.N(r); return a.do(w) * k.exp(-t * 7) * 1.6 + b.do(w) * k.exp(-t * 9) * 1.2 + c.do(w) * k.exp(-t * 14) * .6; }, .1, .08); });
    // гром вдалеке: низкий рокот, нарастает и долго затихает (мягко — не пугать)
    Sy.add('kb_thunder', k => { const a = new k.Bp(55, 1.2), b = new k.Bp(110, 1.4), c = new k.Bp(260, 1.6); let lp = 0; return k.make(2.6, 220, (t, r) => { const w = k.N(r); lp += (w - lp) * .02; const e = Math.min(1, t / .25) * k.exp(-t * 1.3) * (1 + .5 * Math.sin(t * 7.3) * k.exp(-t * 2)); return (a.do(w) * 2.4 + b.do(w) * 1.6 + c.do(w) * .5 + lp * 2) * e; }, .12, .3); });
    // под водой: тихий низкий гул и редкие мягкие пузыри (петля 8 с)
    Sy.add('kb_underwater', k => {
      const lo = new k.Bp(70, .7), mid = new k.Bp(150, 1.1), r0 = k.rng(221), bub = []; let lp = 0;
      for (let i = 0; i < 6; i++) bub.push([.5 + r0() * 7, new k.Bp(300 + r0() * 380, 8), .5 + r0() * .5]);
      return k.make(8, 222, (t, r) => { const w = k.N(r); lp += (w - lp) * .03; let s = lo.do(w) * 2.2 + mid.do(w) * .5 + lp * 1.2; for (const b of bub) { const d = t - b[0]; if (d > 0 && d < .14) s += b[1].do(w) * k.exp(-d * 34) * 1.3 * b[2]; } return s; }, .05, .03);
    });
    // дерево: скрип (трещит, кренясь) и глухой удар о землю
    Sy.add('kb_creak', k => { const a = new k.Bp(240, 6), b = new k.Bp(520, 5); return k.make(.9, 223, (t, r) => { const w = k.N(r), e = Math.sin(Math.min(1, t / .9) * Math.PI), tick = (Math.sin(t * 38 + Math.sin(t * 7) * 3) > .6 ? 1 : .25); return (a.do(w) * 2.2 + b.do(w) * 1.1) * e * tick; }, .07, .05); });
    Sy.add('kb_thud', k => { const a = new k.Bp(70, 1.1), b = new k.Bp(180, 1.4), c = new k.Bp(900, 1); let lp = 0; return k.make(.7, 224, (t, r) => { const w = k.N(r); lp += (w - lp) * .04; return (a.do(w) * 3 + b.do(w) * 1.5 + lp * 2) * k.exp(-t * 7) + c.do(w) * k.exp(-t * 30) * .6; }, .13, .06); });
    Sy.add('kb_poof', k => { const a = new k.Bp(500, .9), b = new k.Bp(1400, 1.1); return k.make(.3, 219, (t, r) => { const w = k.N(r), e = Math.min(1, t / .02) * k.exp(-t * 11); return (a.do(w) * 1.6 + b.do(w)) * e; }, .09, .05); });
  }

  // ── связь с окнами и сущностями ──
  function uiHooks(){ return { give: s => give(S, s), drop: s => S?.ents?.addItem(S.P.x, S.P.y + 1.4, S.P.z, s, false, (() => { const d = lookDir(S); return [d.x * 4, 2, d.z * 4]; })()), unlock, toast: (t, ok) => S?.H.toast(t, ok), sound: (n, o) => S?.AU?.play(n, o || {}) }; }
  function modHooks(){
    return {
      log, toast: (t, ok) => S?.H.toast(t, ok),
      player: () => S?.P, give: s => give(S, s), hurt: n => hurt(S, n, 'mob'), heal: n => { if (S) S.P.hp = clamp(S.P.hp + n, 0, 20); },
      launch: (vx, vy, vz) => { if (!S) return; const P = S.P; P.vx += vx; P.vy = vy; P.vz += vz; P.onGround = false; P.fallTop = P.y; P.modFall = true; },
      teleport: (x, y, z) => { if (!S) return; Object.assign(S.P, { x, y, z, vx: 0, vy: 0, vz: 0, fallTop: y }); rebase(true); },
      particles: (kind, x, y, z, n, color) => S?.ents?.particles?.(kind, x, y, z, n, color), sound: (n, x, y, z, vol) => S?.AU?.play(n, { x: x - S.ox, y, z: z - S.oz, vol: vol ?? 1 }),
      text: (x, y, z, t) => log('✨ ' + t), shake: p => S?.rig?.shake?.(1 + p * 4, .25 + p * .4),
      spawn: (type, x, y, z) => { const M = window.KubomirEnts?.MOBS?.[type]; if (!S || !M || (S.meta.diff === 'peaceful' && !M.passive)) return; S.ents?.spawn?.(type, x, y, z); },
    };
  }

  window.GAME_IMPL = window.GAME_IMPL || {};
  // для проверок (консоль, node): навести взгляд на точку, нажать «поставить/использовать»
  function aim(x, y, z){ const st = S; if (!st) return null; const [ex, ey, ez] = eye(st), dx = x - ex, dy = y - ey, dz = z - ez; st.rig.yaw = Math.atan2(-dx, -dz); st.rig.fp = Math.atan2(-dy, Math.hypot(dx, dz)); st.rig.mode = 'first'; st.camMode = 0; return st.rig; }
  window.GAME_IMPL[ID] = { mount, unmount, _test: { state: () => S, give: s => give(S, s), command: c => command(c), unlock, ACH, save: () => saveAll(S), stop: () => stopWorld(), aim, use: () => use(S, S.hit), dig: () => S?.hit && breakBlock(S, S.hit), menu: () => showMenu(),
    cam: m => cycleCam(m), hud: v => hideHud(v), pick: () => S?.hit && pickBlock(S, S.hit), drop: all => S && dropSel(S, all), lookDir: () => S && { ...lookDir(S) },
    hand: () => S?.hand?.state(), act: k => S?.hand?.act(k), eat: () => S?.eat && { ...S.eat } } };
})();
