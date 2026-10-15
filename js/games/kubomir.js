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
      <div class="kb-mbtns"><button type="button" class="kb-btn primary" data-m="new">➕ Новый мир</button><button type="button" class="kb-btn" data-m="import">📥 Загрузить файл мира</button><button type="button" class="kb-btn" data-m="mods">🧩 Моды</button><button type="button" class="kb-btn" data-m="ach">🏆 Достижения</button></div>
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
    else if (a === 'mods') window.KubomirMods?.library(screen(), { back: showMenu });
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
      <div class="kb-seg" data-f="diff"><button type="button" data-v="peaceful">🕊 Мирно</button><button type="button" class="on" data-v="easy">🙂 Легко</button><button type="button" data-v="normal">😈 Обычно</button></div>
      <p class="kb-note kb-diffnote">Легко: ночью приходят мобы, но после смерти вещи остаются.</p>
      ${mods.length ? `<div class="kb-modpick"><b>🧩 Моды в этом мире</b>${mods.map(m => `<label class="kb-chk"><input type="checkbox" data-mod="${esc(m.id)}"> ${esc(m.manifest?.name || m.id)} <small>${esc(m.manifest?.version || '')}</small></label>`).join('')}</div>` : '<p class="kb-note">🧩 Моды можно добавить в меню миров → «Моды».</p>'}
      <div class="kb-mbtns"><button type="button" class="kb-btn primary" data-n="go">🌍 Создать мир</button><button type="button" class="kb-btn" data-n="back">← Назад</button></div></div>`;
    const DN = { peaceful: 'Мирно: мобов-врагов нет, голод не отнимает здоровье.', easy: 'Легко: ночью приходят мобы, но после смерти вещи остаются.', normal: 'Обычно: после смерти вещи выпадают — успей их подобрать.' };
    sc.querySelectorAll('.kb-seg').forEach(g => g.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); if (g.dataset.f === 'diff') sc.querySelector('.kb-diffnote').textContent = DN[b.dataset.v]; }));
    sc.querySelector('[data-n="back"]').onclick = showMenu;
    sc.querySelector('[data-n="go"]').onclick = async () => {
      const f = k => sc.querySelector(`[data-f="${k}"]`);
      const name = f('name').value.trim().slice(0, 40) || 'Мой мир';
      let seed = f('seed').value.trim().slice(0, 32);
      if (!seed) seed = String(Math.floor(Math.random() * 2e9));
      const mode = f('mode').querySelector('.on')?.dataset.v || 'survival', diff = f('diff').querySelector('.on')?.dataset.v || 'easy';
      const modIds = [...sc.querySelectorAll('[data-mod]:checked')].map(x => x.dataset.mod);
      const w = { id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, seed, mode, diff, created: Date.now(), played: Date.now(), time: 8, mods: modIds, palette: null, player: null, v: 1 };
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
    const txt = t ? 'Джойстик слева — идти, палец справа — смотреть. ⛏ (держать) — ломать, 🧱 — поставить или открыть, ⤒ — прыжок (два раза в «Творчестве» — полёт), 🎒 — вещи.'
      : 'WASD — идти, Shift — бег, C — присесть, Пробел — прыжок (два раза в «Творчестве» — полёт). Левая кнопка — ломать, правая — поставить/открыть/съесть, колесо и 1–9 — выбор вещи, Q — выбросить, Tab — вещи, V — вид, Enter — чат и команды (/help), F3 — сведения, Esc — меню.';
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
    if (J) { try { if (J.recs?.length) await V.store.putChunks(meta.id, J.recs.map(r => ({ cx: r.cx, cz: r.cz, e: new Uint32Array(V.store.unb64(r.e).buffer), t: r.t || [] }))); if (J.meta) Object.assign(meta, J.meta); await V.store.putWorld(meta); } catch (e) { console.error(e); } }
    // моды мира: блоки, вещи, рецепты, текстуры, фичи генерации, скрипты
    const modState = window.KubomirMods ? await window.KubomirMods.forWorld(meta) : { features: [], loaded: [] };
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
    const G = V.genInit(W.seed, { features: modState.features });
    const st = {
      meta, W, G, R, mods: modState, remapIn, remapOut, ox: 0, oz: 0, t: 0, steps: 0, ready: false, dead: false, paused: false, saving: false,
      unsaved: new Set(), savedKeys: await V.store.chunkKeys(meta.id).catch(() => new Set()), lastSave: now(), creative: meta.mode === 'creative',
      hit: null, mine: { key: '', t: 0, need: 0, st: -1, cool: 0 }, placeCool: 0, swing: 0, hud: {}, keys: { q: false }, raw: new Set(),
      stats: { placed: 0, fps: 0 }, chat: [], achQ: [], dayPrev: null,
    };
    S = st;
    // свет и время суток (небо движка): своя дальность тумана — по дальности прорисовки
    R.setLighting({ time: meta.time ?? 8, brightness: 1.05, ambient: 1.1, fogEnd: fogFor(R), shadows: true, gfx: { sky: { haze: .2, clouds: .9 }, fog: { density: 0, height: 0, sun: .5 }, grade: 'neutral', bloom: .8 } });
    R.clouds(R.q === 'low' ? 8 : 14, 3);
    const VR = st.VR = V.renderer(R);
    // подгрузка мира
    const url = 'js/engine/voxel-worker.js?v=' + ver();
    st.ST = V.streamer({ world: W, rd: opts.rd, url, features: modState.features,
      load: c => st.savedKeys.has(c.cx + '|' + c.cz) ? V.store.chunk(meta.id, c.cx, c.cz) : null,
      applySaved: (c, rec) => applySaved(c, rec),
      onGen: c => { st.ents?.onChunkTiles?.(c); },
      onMesh: (c, m) => VR.setChunk(c, m),
      onDrop: c => { VR.dropChunk(c); if (st.unsaved.has(c.key)) saveChunks([c]); window.KubomirEnts?.onDrop?.(st, c); },
      log: t => console.warn('Кубомир:', t) });
    W.listeners.push((x, y, z, was, v, o) => onEdit(x, y, z, was, v, o));
    // управление, камера, звук, интерфейс
    const C = st.C = Ex.controls({});
    const I = st.I = Ex.input(wr, { controls: C, ignore: 'button, a, input, .e-btn, .kb-ui, .kb-hud button, .gs-menu, .kb-chat' });
    st.rig = Ex.cameraRig(R.camera, { yaw: 0, pitch: .25, dist: 4.4, minD: 1.6, maxD: 9, lift: 1.5, mode: (window.D37Settings?.get('view') || 'first') });
    st.rig.minP = -1.25; st.rig.maxP = 1.4; st.rig.maxLook = 89 * PI / 180; st.rig.fovFirst = 70;
    st.H = Ex.ui(wr, C);
    st.H.crosshair(true);
    st.AU = Ex.audio(); sounds();
    st.hudEl = hudBuild(wr);
    if (I.touch) st.H.buttons([{ action: 'inventory', icon: '🎒', label: 'вещи' }, { action: 'crouch', icon: '⬇', label: 'присесть' }, { action: 'place', icon: '🧱', label: 'поставить' }, { action: 'mine', icon: '⛏', label: 'ломать' }, { action: 'jump', icon: '⤒', label: 'прыжок', big: true }]);
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
    if (st.ents) { st.ents.hookHurt = n => hurt(st, n, 'mob'); st.ents.hookUnlock = id => unlock(id); st.ents.give = s => give(st, s); }
    if (meta.ents && st.ents) st.ents.load(meta.ents);
    st.ui = window.KubomirUI ? window.KubomirUI.create(st, uiHooks()) : null;
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
  function fogNear(st){ const f = st.R.scene.fog; if (f && !st.P.eyeWater && f.far > 20) f.near = f.far * .6; }
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
    try { st.ui?.dispose(); } catch (e) {}
    st.ST?.close(); st.VR?.dispose(); st.A?.dispose();
    st.C?.dispose(); st.I?.dispose(); st.H?.dispose();
    try { st.R?.dispose(); } catch (e) {}
    st.hudEl?.remove(); st.modWin?.remove();
    settingsTab(true);
  }
  async function restartWorld(){ if (!S) return; const m = S.meta; await stopWorld(); playWorld(m); }

  // ═══ Сохранение ═══
  function applySaved(c, rec){
    const V = VX(), e = rec.e, ri = S.remapIn;
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
    return { cx: c.cx, cz: c.cz, e: out, t: c.tiles ? [...c.tiles] : [] };
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
    const m = metaSnap(st), meta = { player: m.player, time: m.time, ents: m.ents, palette: m.palette, spawn: m.spawn, modData: m.modData };
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
    if (!st.ready) { if (st.ST.readyAt(P.x, P.z) && spawnReady(st)) { st.ready = true; placeSafe(st); } return; }
    st.steps++;
    // Esc: окно → закрыть; иначе меню
    if (C.down('pause') && !window.D37Settings?.isOpen?.()) { if (chatting) chatClose(); else if (uiOpen) st.ui.close(); else if (st.modWin) st.modWin.querySelector('[data-x]')?.click(); else if (menu) closeMenu(); else openMenu(); }
    if (C.downRaw('inventory') && !menu && !chatting) { if (uiOpen) st.ui.close(); else st.ui?.open('inv'); }
    if (C.down('view')) toggleView();
    if (C.down('chat') && !uiOpen) chatOpen();
    if (!C.blocked) {
      for (let i = 1; i <= 9; i++) if (C.down('slot' + i)) P.sel = i - 1;
      if (st.keys.q) { st.keys.q = false; dropSel(st, false); }
      padHotbar(st);
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
      if (!nowDay) st.nightSeen = true;
      L.time = L._t;
    }
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
    const jump = C.held('jump'), sneak = C.held('crouch');
    // полёт в «Творчестве»: двойной прыжок
    if (st.creative && C.doubleTap('jump')) { P.fly = !P.fly; P.vy = 0; st.H.toast(P.fly ? '🕊 Полёт (два раза Пробел — выключить)' : '🚶 Полёт выключен'); }
    if (!st.creative) P.fly = false;
    P.sneak = sneak && !P.fly;
    // бег: вперёд + Shift (или двойное «вперёд»), не голодный, не присел
    if (C.held('run') && C.move.z > .3 && (st.creative || P.food > 6) && !P.sneak) P.sprint = true;
    else if (C.move.z <= .2 || P.sneak || (!st.creative && P.food <= 6)) P.sprint = false;
    const inLiquid = P.water > .3 || P.lava > .2;
    let spd = P.fly ? (P.sprint ? SPD.flyFast : SPD.fly) : P.sneak ? SPD.sneak : P.sprint ? SPD.sprint : SPD.walk;
    if (inLiquid && !P.fly) spd = P.lava > .2 ? 1.2 : SPD.swim * (P.sprint ? 1.4 : 1);
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
      P.fallTop = P.y; P.modFall = false;
    }
    if (P.onGround || inLiquid || P.climb || P.fly) P.fallTop = P.y;
    // шаги и усталость от бега
    const moved = Math.hypot(P.x - P.lastStepX, P.z - P.lastStepZ);
    if (P.onGround && moved > (P.sprint ? 2.1 : 1.6)) {
      P.lastStepX = P.x; P.lastStepZ = P.z;
      const fv = W.raw(P.x, P.y - .1, P.z);
      if (fv > 0) st.AU?.step(floorSound(fv & 0xfff), P.sprint, P.x - st.ox, P.y, P.z - st.oz);
      if (P.sprint) P.exh += .1 * moved;
    } else if (!P.onGround) { P.lastStepX = P.x; P.lastStepZ = P.z; }
    // плавание: брызги
    if (inLiquid && Math.hypot(P.vx, P.vz) > 1 && (P.swimT -= dt) < 0) { P.swimT = .7; st.AU?.play('step_water' + ((Math.random() * 3) | 0), { vol: .35 }); }
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
    if (P.food <= 0 && diff !== 'peaceful') { P.starveT += dt; if (P.starveT >= 4) { P.starveT = 0; if (P.hp > (diff === 'easy' ? 10 : 1)) hurt(st, 1, 'starve'); } }
    // воздух под водой
    if (P.eyeWater) { P.air = Math.max(0, P.air - dt); if (P.air <= 0) { P.drownT = (P.drownT || 0) + dt; if (P.drownT >= 1) { P.drownT = 0; hurt(st, 2, 'drown'); } } }
    else P.air = Math.min(15, P.air + dt * 4);
  }
  function hurt(st, n, why){
    const P = st.P;
    if (st.creative || P.dead || n <= 0) return;
    if ((P.hurtT || 0) > now() - 450 && why !== 'drown' && why !== 'starve' && why !== 'void') return;
    P.hurtT = now();
    P.hp = Math.max(0, P.hp - n);
    st.AU?.play('kb_hurt', { vol: .7 });
    st.rig.kick?.(1.2);
    st.hudEl?.classList.remove('kb-hit'); void st.hudEl?.offsetWidth; st.hudEl?.classList.add('kb-hit');
    if (P.hp <= 0) die(st, why);
  }
  const DEATH = { fall: 'разбился', lava: 'сгорел в лаве', cactus: 'укололся о кактус', starve: 'умер от голода', drown: 'утонул', void: 'упал в бездну', mob: 'не справился с монстром' };
  function die(st, why){
    const P = st.P; P.dead = true;
    st.I.unlock();
    const keep = (st.meta.diff || 'easy') !== 'normal';
    if (!keep) { for (let i = 0; i < P.inv.length; i++) if (P.inv[i]) { st.ents?.addItem(P.x, P.y + 1, P.z, P.inv[i], true); P.inv[i] = null; } }
    const box = document.createElement('div'); box.className = 'kb-dead kb-ui';
    box.innerHTML = `<div><b>💀 Ты ${esc(DEATH[why] || 'погиб')}</b><small>${keep ? 'Вещи остались с тобой.' : 'Вещи выпали там, где ты погиб, — успей забрать.'}</small><button type="button" class="kb-btn primary">↺ Возродиться</button></div>`;
    wrap().appendChild(box);
    box.querySelector('button').onclick = () => {
      box.remove(); const sp = st.meta.bed || st.meta.spawn;
      Object.assign(P, { x: sp.x, y: sp.y, z: sp.z, vx: 0, vy: 0, vz: 0, hp: 20, food: 20, sat: 5, air: 15, dead: false, fallTop: sp.y });
      placeSafe(st); rebase(true); st.C.reset_state();
    };
  }

  // ═══ Прицел: ломать, ставить, открывать, есть ═══
  function eye(st){ const P = st.P; return [P.x, P.y + (P.sneak ? 1.27 : 1.62), P.z]; }
  const DIR = { x: 0, y: 0, z: 0 };
  function lookDir(st){
    const cam = st.R.camera; cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements; DIR.x = -e[8]; DIR.y = -e[9]; DIR.z = -e[10];
    return DIR;
  }
  function interact(st, dt){
    const { C, P, W } = st, V = VX();
    const [ex, ey, ez] = eye(st), d = lookDir(st), reach = st.creative ? REACH_C : REACH;
    const hit = st.hit = C.blocked ? null : V.raycast(W, ex, ey, ez, d.x, d.y, d.z, reach);
    st.mobHit = C.blocked ? null : st.ents?.rayMob?.(ex, ey, ez, d.x, d.y, d.z, Math.min(reach, hit ? hit.t : reach)) || null;
    // на компьютере — только с захваченной мышью (первый клик лишь захватывает её)
    const canAct = !C.blocked && (st.I.touch || st.I.locked);
    st.placeCool -= dt; st.mine.cool -= dt;
    // удар по мобу
    if (canAct && st.mobHit && (C.down('mine') || C.down('attack'))) { attackMob(st, st.mobHit); st.swing = 1; return; }
    // ломать
    const mining = canAct && (C.held('mine') || C.held('attack')) && hit;
    if (mining) {
      const key = hit.x + ',' + hit.y + ',' + hit.z, b = V.blocks[hit.v & 0xfff];
      if (st.mine.key !== key) { st.mine.key = key; st.mine.t = 0; st.mine.need = breakTime(st, b); st.mine.snd = 0; }
      if (st.creative) { if (st.mine.cool <= 0) { breakBlock(st, hit); st.mine.cool = .18; st.mine.key = ''; } }
      else if (st.mine.need < Infinity) {
        st.mine.t += dt; st.swing = 1;
        st.mine.snd -= dt; if (st.mine.snd <= 0) { st.mine.snd = .24; st.AU?.play(digSound(b), { x: hit.x - st.ox + .5, y: hit.y + .5, z: hit.z - st.oz + .5, vol: .45, rate: .9 + Math.random() * .2 }); }
        if (st.mine.t >= st.mine.need) { breakBlock(st, hit); st.mine.key = ''; st.mine.t = 0; st.mine.cool = .05; }
      }
    } else { st.mine.key = ''; st.mine.t = 0; }
    st.mine.st = mining && st.mine.need < Infinity && !st.creative ? Math.floor(st.mine.t / st.mine.need * 8) : -1;
    // поставить / открыть / съесть (правая кнопка; держишь — повтор)
    const wantPlace = canAct && (C.down('place') || (C.held('place') && st.placeCool <= 0));
    if (wantPlace) { st.placeCool = .22; use(st, hit); }
    if (canAct && C.down('pick') && hit) pickBlock(st, hit);
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
    st.ents?.debris(hit.x, hit.y, hit.z, b.id);
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
  // правая кнопка: открыть / дверь / съесть / поставить
  function use(st, hit){
    const V = VX(), P = st.P, W = st.W, s = P.inv[P.sel], it = s ? V.item(s.id) : null;
    if (hit && !P.sneak) {
      const b = V.blocks[hit.v & 0xfff];
      if (b.ui) { st.ui?.open(b.ui, { x: hit.x, y: hit.y, z: hit.z }); st.swing = 1; return; }
      if (b.shape === V.SHAPE.door) { toggleDoor(st, hit); st.swing = 1; return; }
      if (st.modRun?.hasUse(b.name) || st.modRun?.hasUse(s?.id)) { st.modRun.event('use', { x: hit.x, y: hit.y, z: hit.z, block: b.name, item: s?.id || '' }); st.swing = 1; return; }
    }
    // вещь мода «в воздух» (палочка, свиток) — тоже событие use
    if (!hit && s && st.modRun?.hasUse(s.id)) { st.modRun.event('use', { x: Math.floor(P.x), y: Math.floor(P.y + 1), z: Math.floor(P.z), block: '', item: s.id }); st.swing = 1; return; }
    if (it?.food && (P.food < 20 || st.creative)) { eat(st, it); return; }
    if (!hit || !it?.place) return;
    if (placeBlock(st, hit, s, it)) { st.swing = 1; if (!st.creative) { s.n--; if (s.n <= 0) P.inv[P.sel] = null; } }
  }
  function eat(st, it){
    const P = st.P;
    P.food = Math.min(20, P.food + it.food.h); P.sat = Math.min(P.food, P.sat + it.food.sat);
    st.AU?.play('kb_eat', { vol: .6 });
    if (!st.creative) { const s = P.inv[P.sel]; s.n--; if (s.n <= 0) P.inv[P.sel] = null; }
    st.swing = 1;
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
      unlock('door'); countPlaced(st);
      return true;
    } else if (b.axis) state = hit.nx ? 1 : hit.nz ? 2 : 0;
    else if (b.ui || b.shape === V.SHAPE.chest) state = toward;
    else if (b.shape === V.SHAPE.cactus) { if (!(below === V.ID.sand || below === V.ID.cactus)) return false; }
    // нельзя ставить твёрдое туда, где стоит игрок или моб
    if (b.solid && (boxOverlap(P, x, y, z, 1) || st.ents?.blocked?.(x, y, z))) return false;
    W.set(x, y, z, V.cell(b.id, state), { urgent: 3 });
    st.AU?.play('kb_place', { x: x - st.ox + .5, y: y + .5, z: z - st.oz + .5, vol: .7 });
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
    const i = P.inv.findIndex((s, k) => k < 9 && s && s.id === name);
    if (i >= 0) { P.sel = i; return; }
    if (st.creative) { P.inv[P.sel] = { id: name, n: V.item(name).stack }; }
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
  function padHotbar(st){
    const pads = navigator.getGamepads ? navigator.getGamepads() : null, gp = pads && [...pads].find(p => p && p.connected);
    if (!gp) return;
    const lb = !!gp.buttons[4]?.pressed, rb = !!gp.buttons[5]?.pressed, y = !!gp.buttons[3]?.pressed;
    if (lb && !st.padLB) st.P.sel = (st.P.sel + 8) % 9;
    if (rb && !st.padRB) st.P.sel = (st.P.sel + 1) % 9;
    if (y && !st.padY) st.ui?.open('inv');
    st.padLB = lb; st.padRB = rb; st.padY = y;
  }

  // ═══ Кадр: подгрузка, камера, персонаж, вещь в руке, экран ═══
  const CAMP = { ch: { x: 0, y: 0, z: 0, vx: 0, vz: 0, h: PH, grounded: true }, mode: 'move', running: false, crouchW: 0, stepOff: 0 };
  const PHYS = { raycast(ox, oy, oz, dx, dy, dz, maxT){ const st = S; if (!st) return null; const V = VX(); const h = V.raycast(st.W, ox + st.ox, oy, oz + st.oz, dx, dy, dz, maxT, t => V.T.opaque[t] === 1); return h ? { t: h.t } : null; } };
  function frame(dt){
    const st = S; if (!st) return;
    const { R, P, rig, I, C, VR, A } = st, V = VX(), t = now() / 1000;
    const f = rig.fwd();
    st.ST.update(P.x, P.z, -f.x, -f.z);
    if (!st.ready) { loadingInfo(st); }
    // камера
    const look = { dx: I.look.dx + C.look.dx, dy: I.look.dy + C.look.dy, zoom: 1 };
    if (I.zoom !== 1 && !st.ui?.isOpen()) { P.sel = (P.sel + (I.zoom > 1 ? 1 : 8)) % 9; }
    const ch = CAMP.ch;
    ch.x = P.x - st.ox; ch.y = P.y; ch.z = P.z - st.oz; ch.vx = P.vx; ch.vz = P.vz; ch.h = P.sneak ? 1.5 : 1.85; ch.grounded = P.onGround;
    CAMP.running = P.sprint; CAMP.crouchW = P.sneak ? 1 : 0;
    const over = st.ui?.isOpen() || st.menu || st.modWin;   // открыто окно поверх мира
    rig.update(dt, CAMP, over ? null : look, PHYS, C);
    I.wantLock = !I.touch && !over && !st.chatEl && !P.dead && !window.D37Settings?.isOpen?.();
    if (st.wasLocked && !I.locked && !over && !st.chatEl && !P.dead && !window.D37Settings?.isOpen?.()) openMenu();
    st.wasLocked = I.locked;
    // персонаж: смотрит туда, куда камера; на ходу — туда, куда идёт (от 3-го лица)
    const me = A.get('me');
    if (me) {
      const sp = Math.hypot(P.vx, P.vz), first = rig.mode === 'first';
      const want = first || sp < .5 ? rig.yaw + PI : Math.atan2(P.vx, P.vz);
      P.bodyYaw = want;
      A.pose('me', { x: P.x - st.ox, y: P.y, z: P.z - st.oz, yaw: want, moving: sp > .4, speed: sp, air: !P.onGround && !P.climb && !(P.water > .3), crouch: P.sneak ? 1 : 0, swim: P.water > .9, ladder: P.climb && !P.onGround, sit: false });
      me.hidden = first;
      if (me.ch && me.ch !== st.meCh) { st.meCh = me.ch; me.ch.root.scale.setScalar(.8); st.handItem = null; heldInHand(st, true); }
    }
    A.update(dt, t, R.camera.position);
    lightEntity(st);
    st.ents?.frame(dt, t);
    heldItem(st, dt);
    VR.select(st.hit && !C.blocked ? st.hit : null);
    if (st.mine.st >= 0 && st.hit) VR.crack(st.hit.x, st.hit.y, st.hit.z, st.mine.st); else VR.crack(0, 0, 0, -1);
    VR.update(dt, t);
    // небо и туман: время суток — раз в 0,25 с
    if ((st.skyT = (st.skyT || 0) - dt) <= 0) { st.skyT = .25; R.setLighting({ time: R.lighting.time, fogEnd: fogFor(R) }); fogNear(st); }
    // под водой — синий туман
    R.setUnder?.(!!st.P.eyeWater, '#1f5f9e');
    st.AU?.listener(R.camera.position.x, R.camera.position.y, R.camera.position.z, rig.yaw);
    R.update(dt); R.follow(P.x - st.ox, P.z - st.oz, P.y);
    R.render();
    hudUpdate(st);
    I.frameEnd(); C.frameEnd();
  }
  // яркость своего персонажа в пещере (материалы — свои копии)
  function lightEntity(st){
    const me = st.A.get('me'); if (!me?.ch) return;
    const V = VX(), P = st.P, L = st.W.lightAt(P.x, P.y + 1, P.z), sky = (L >> 4) / 15, blk = (L & 15) / 15;
    const k = Math.max(sky * sky, blk * blk * .9, .06);
    if (Math.abs((st.meK ?? -1) - k) < .02 && st.meKch === me.ch) return;
    st.meK = k;
    if (st.meKch !== me.ch) { st.meKch = me.ch; me.ch.root.traverse(o => { if (o.isMesh && o.material && !o.material.userData?.kbOwn) { o.material = o.material.clone(); o.material.userData.kbOwn = true; o.material.userData.kbBase = o.material.color ? o.material.color.clone() : null; } }); }
    me.ch.root.traverse(o => { const m = o.material; if (m?.userData?.kbBase && m.color) m.color.copy(m.userData.kbBase).multiplyScalar(k); });
  }
  // вещь в руке: от 1-го лица — у камеры (взмах при ударе), от 3-го — в кисти персонажа
  function heldItem(st, dt){
    const P = st.P, s = P.inv[P.sel], name = s ? s.id : '', R = st.R, VR = st.VR;
    const L = st.W.lightAt(P.x, P.y + 1.5, P.z), sky = L >> 4, blk = L & 15;
    if (st.heldName !== name) {
      st.heldName = name;
      if (st.held) { st.held.parent?.remove(st.held); st.held.geometry.dispose(); st.held = null; }
      if (name) { st.held = VR.itemMesh(name, sky, blk); st.held.renderOrder = 20; st.held.frustumCulled = false; }
      heldInHand(st, true);
    }
    if (!st.held) return;
    VR.itemLight(st.held.geometry, sky, blk);
    st.swing = Math.max(0, st.swing - dt * 4);
    if (st.rig.mode === 'first') {
      if (st.held.parent !== R.camera) { R.camera.add(st.held); if (!R.camera.parent) R.scene.add(R.camera); }
      const sw = Math.sin(st.swing * PI), flat = st.held.geometry.userData.flat, bob = st.rig.feel ? Math.sin(st.rig.feel.bobPh) * .012 * st.rig.feel.bobW : 0;
      st.held.position.set(.42 - sw * .12, -.36 - sw * .1 + bob, -.62 + sw * .1);
      st.held.rotation.set(-sw * .9, flat ? -.6 : .7, flat ? .25 : 0);
      st.held.scale.setScalar(flat ? .42 : .26);
    } else heldInHand(st, false);
  }
  function heldInHand(st, force){
    const me = st.A.get('me'), h = st.held;
    if (!h || !me?.ch?.handR) return;
    if (h.parent !== me.ch.handR || force) {
      me.ch.handR.add(h);
      const flat = h.geometry.userData.flat;
      h.position.set(0, -.08, .1); h.rotation.set(flat ? -.4 : 0, 0, flat ? -1.2 : 0); h.scale.setScalar(flat ? .38 : .26);
    }
  }
  function toggleView(){
    const st = S; if (!st) return;
    const m = st.rig.toggle(); st.H.crosshair(true);
    try { window.D37Settings?.set('view', m); } catch (e) {}
    st.H.toast(m === 'first' ? '👁 Вид от 1-го лица (V — обратно)' : '🎥 Вид от 3-го лица');
  }

  // ═══ Экран: полоски здоровья и еды, панель вещей, отладка ═══
  function hudBuild(wr){
    const h = document.createElement('div'); h.className = 'kb-hud';
    h.innerHTML = `<div class="kb-dbg" hidden></div><div class="kb-log"></div>
      <div class="kb-bottom"><div class="kb-bars"><div class="kb-hp"></div><div class="kb-food"></div></div><div class="kb-air"></div><div class="kb-iname"></div>
      <div class="kb-hotbar">${Array.from({ length: 9 }, (_, i) => `<div class="kb-slot" data-s="${i}"><i></i><b></b><u></u></div>`).join('')}</div></div>
      <div class="kb-loadbar" hidden><div class="spinner"></div><b>Строим мир вокруг…</b><small></small></div>`;
    h.querySelector('.kb-hotbar').addEventListener('pointerdown', e => { const s = e.target.closest('[data-s]'); if (!s || !S) return; e.stopPropagation(); S.P.sel = +s.dataset.s; });
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
        d.innerHTML = `XYZ ${P.x.toFixed(1)} / ${P.y.toFixed(1)} / ${P.z.toFixed(1)} · чанк ${Math.floor(P.x) >> 4}, ${Math.floor(P.z) >> 4}<br>биом ${c ? V.BIOMES[c.b] : '—'} · свет небо ${L >> 4} блоки ${L & 15} · время ${st.R.lighting.time.toFixed(1)} ч<br>`
          + `чанков ${s.chunks} · сетка ${s.mesh} (${(s.meshMs / Math.max(1, s.mesh)).toFixed(1)} мс) · ген ${s.gen} (${(s.genMs / Math.max(1, s.gen)).toFixed(1)} мс) · в работе ${s.jobs} · ждут ${s.pend}<br>`
          + `мешей ${r.meshes} · квадов ${(r.quads / 1000).toFixed(0)} тыс. · пул ${r.poolFree} · ~${(r.bytes / 1048576).toFixed(0)} МБ · вызовов ${rs.calls} · ${st.ST.inline ? 'без потоков' : st.ST.workers.length + ' поток(а)'} · дальность ${opts.rd}`;
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
    // награды: очередь достижений (сервер — не чаще раза в 20 с)
    if (st.achQ.length && (!st.achAt || now() - st.achAt > 21000)) { const a = st.achQ.shift(); st.achAt = now(); rewardAch(a); }
    st.modRun?.second?.();
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
    if (id === 'resume') { closeMenu(); if (!st.I.touch) { try { wrap().querySelector('.kb-gl')?.requestPointerLock?.()?.catch?.(() => {}); } catch (e) {} } }
    else if (id === 'settings') window.D37Settings?.open({ ctx: 'engine', tab: 'kubomir' });
    else if (id === 'mods') { closeMenu(); window.KubomirMods?.worldPanel?.(st, wrap(), { restart: ids => { if (S !== st) return; st.meta.mods = ids; restartWorld(); } }); }
    else if (id === 'export') { await saveAll(st); exportWorld(st.meta.id); }
    else if (id === 'full') { window.D37Full?.toggle(el.closest('#gamesStage') || wrap(), { esc: false }); setTimeout(() => S?.menu?.redraw(), 80); }
    else if (id === 'help') help();
    else if (id === 'exit') { closeMenu(); const sc = screen(); await stopWorld(); if (sc) showMenu(); }
  }
  function chatOpen(){
    const st = S; if (!st || st.chatEl) return;
    st.I.unlock();
    const f = document.createElement('form'); f.className = 'kb-chat kb-ui';
    f.innerHTML = '<input type="text" maxlength="200" autocomplete="off" placeholder="Команда: /help, /time day, /gamemode creative…">';
    wrap().appendChild(f); st.chatEl = f;
    const inp = f.querySelector('input'); setTimeout(() => inp.focus(), 0);
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
      case 'help': log('Команды: /time day|night|<часы>, /gamemode survival|creative, /tp x y z, /seed, /give <вещь> [сколько], /spawn, /where' + (st.modRun?.commands().length ? ', моды: /' + st.modRun.commands().join(', /') : '')); return;
      case 'seed': log('🌱 Зерно мира: ' + st.meta.seed); return;
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
      body.innerHTML = `<div class="gs-row"><div class="gs-lbl">Дальность прорисовки<small>Сколько чанков (по 16 блоков) видно во все стороны. Меньше — быстрее, особенно на телефоне.</small></div><div class="gs-ctl">${seg('rd', RD_OPTS.map(n => [n, n]), opts.rd)}</div></div>
        <div class="gs-row"><div class="gs-lbl">Автопрыжок на телефоне<small>Упёрся в ступеньку в один блок — прыгнет сам.</small></div><div class="gs-ctl">${seg('autoJump', [[1, 'Вкл'], [0, 'Выкл']], opts.autoJump === false ? 0 : 1)}</div></div>
        ${st ? `<p class="gs-note">Мир: ${esc(st.meta.name)} · зерно ${esc(st.meta.seed)} · потоков: ${st.ST.inline ? 'нет (всё в кадре)' : st.ST.workers.length}. F3 — сведения о мире и скорости.</p>` : ''}`;
      body.onclick = e => {
        const b = e.target.closest('[data-kbo]'); if (!b) return;
        const [k, v] = b.dataset.kbo.split(':');
        if (k === 'rd') { opts.rd = +v; S?.ST.setRd(opts.rd); if (S) S.R.setLighting({ fogEnd: fogFor(S.R) }); }
        if (k === 'autoJump') opts.autoJump = v === '1';
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
  }

  // ── связь с окнами и сущностями ──
  function uiHooks(){ return { give: s => give(S, s), drop: s => S?.ents?.addItem(S.P.x, S.P.y + 1.4, S.P.z, s, false, (() => { const d = lookDir(S); return [d.x * 4, 2, d.z * 4]; })()), unlock, toast: (t, ok) => S?.H.toast(t, ok), sound: (n, o) => S?.AU?.play(n, o || {}) }; }
  function modHooks(){
    return {
      log, toast: (t, ok) => S?.H.toast(t, ok),
      player: () => S?.P, give: s => give(S, s), hurt: n => hurt(S, n, 'mob'), heal: n => { if (S) S.P.hp = clamp(S.P.hp + n, 0, 20); },
      launch: (vx, vy, vz) => { if (!S) return; const P = S.P; P.vx += vx; P.vy = vy; P.vz += vz; P.onGround = false; P.fallTop = P.y; P.modFall = true; },
      teleport: (x, y, z) => { if (!S) return; Object.assign(S.P, { x, y, z, vx: 0, vy: 0, vz: 0, fallTop: y }); rebase(true); },
      particles: (kind, x, y, z, n) => S?.ents?.particles?.(kind, x, y, z, n), sound: (n, x, y, z) => S?.AU?.play(n, { x: x - S.ox, y, z: z - S.oz }),
      spawn: (type, x, y, z) => { const M = window.KubomirEnts?.MOBS?.[type]; if (!S || !M || (S.meta.diff === 'peaceful' && !M.passive)) return; S.ents?.spawn?.(type, x, y, z); },
    };
  }

  // клавиши мимо controls.js: Q — выбросить, F3 — сведения
  document.addEventListener('keydown', e => {
    if (!S || e.repeat || e.target?.closest?.('input, textarea')) return;
    if (e.code === 'KeyQ' && !S.C.blocked) { S.keys.q = true; }
    if (e.code === 'F3') { e.preventDefault(); S.dbg = !S.dbg; S.hudEl.querySelector('.kb-dbg').hidden = !S.dbg; }
  });

  window.GAME_IMPL = window.GAME_IMPL || {};
  // для проверок (консоль, node): навести взгляд на точку, нажать «поставить/использовать»
  function aim(x, y, z){ const st = S; if (!st) return null; const [ex, ey, ez] = eye(st), dx = x - ex, dy = y - ey, dz = z - ez; st.rig.yaw = Math.atan2(-dx, -dz); st.rig.fp = Math.atan2(-dy, Math.hypot(dx, dz)); st.rig.mode = 'first'; return st.rig; }
  window.GAME_IMPL[ID] = { mount, unmount, _test: { state: () => S, give: s => give(S, s), command: c => command(c), unlock, ACH, save: () => saveAll(S), stop: () => stopWorld(), aim, use: () => use(S, S.hit), menu: () => showMenu() } };
})();
