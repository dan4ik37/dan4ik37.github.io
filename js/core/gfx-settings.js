// ═══════════════════════════════════════
//  НАСТРОЙКИ ГРАФИКИ 3D (вкладка «🎨 Графика» окна ⚙️ — поверх js/core/settings.js через define / addTab / on)
// ═══════════════════════════════════════
// Пресеты: Авто (по устройству + сам снижает/поднимает ступени по времени кадра) / Низкая / Средняя / Высокая / Ультра / Своя.
// Тронул любую мелочь — пресет становится «Своя» (с теми же значениями, что были). Ключи в d37_settings: gfxPreset, shadowQ,
// ao, water, refl, aa, fog, dist, grade, fpsCap, res, battery (+ старые gfx — «основа» рендерера, fsr, shadows, fps, world2d).
// Перенос: был d37_gfx (low/mid/high) — пресет он же; «Тени: выкл» сохраняются. На живую: window.D37Opt.gfx (+ rev++) —
// render.js (E.gfxResolve → R.applyGfx). Смена «основы» (low ↔ mid ↔ high) — мир пересобирается (ctx.gfx), студия — при
// следующем запуске. Пресеты — те же, что E.GFX_PRESETS в js/engine/gfx.js (render-test сверяет).
// T-043: в «⭐ Главное» — «Качество графики» и «Шейдеры» (addMain); у строк — простые названия и подсказки в одну строку;
// «↺ Сбросить «Графика»» — все значения вкладки (keys).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const S = root.D37Settings;
  if (!S || S.gfxExt) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // ── Пресеты (как E.GFX_PRESETS в gfx.js; «основа» ultra — high) ──
  const PRESETS = {
    low: { tier: 'low', shadows: false, shadowQ: 'low', ao: 'off', water: 'simple', refl: false, aa: 'off', fog: true, dist: .8, grade: false, rt: 'off' },
    mid: { tier: 'mid', shadows: true, shadowQ: 'mid', ao: 'off', water: 'good', refl: true, aa: 'fxaa', fog: true, dist: 1, grade: true, rt: 'off' },
    high: { tier: 'high', shadows: true, shadowQ: 'high', ao: 'on', water: 'good', refl: true, aa: 'msaa', fog: true, dist: 1.25, grade: true, rt: 'on' },
    ultra: { tier: 'high', shadows: true, shadowQ: 'ultra', ao: 'high', water: 'good', refl: true, aa: 'msaa', fog: true, dist: 1.6, grade: true, rt: 'high' },
  };
  const DETAIL = ['shadows', 'shadowQ', 'ao', 'water', 'refl', 'aa', 'fog', 'dist', 'grade', 'rt'];
  S.define('gfxPreset', { def: 'auto', list: ['auto', 'low', 'mid', 'high', 'ultra', 'custom'] })
    .define('shadowQ', { def: 'mid', list: ['low', 'mid', 'high', 'ultra'] })
    .define('ao', { def: 'off', list: ['off', 'on', 'high'] })
    .define('water', { def: 'good', list: ['simple', 'good'] })
    .define('refl', { def: true, bool: 1 })
    .define('aa', { def: 'fxaa', list: ['off', 'fxaa', 'msaa'] })
    .define('fog', { def: true, bool: 1 })
    .define('dist', { def: 1, min: .5, max: 2 })
    .define('grade', { def: true, bool: 1 })
    .define('fpsCap', { def: '0', list: ['0', '30', '45', '60', '90', '120'] })
    .define('res', { def: 100, min: 50, max: 100 })
    .define('battery', { def: false, bool: 1 })
    .define('upscaler', { def: 'fsr', list: ['fsr', 'nis', 'off'] })
    .define('sharp', { def: 50, min: 0, max: 100 })
    .define('rt', { def: 'off', list: ['off', 'on', 'high'] })
    .define('framegen', { def: false, bool: 1 })
    // ── «Шейдеры» — наборы для 2D и 3D (2D — js/engine/shade2d.js; 3D — js/engine/gfx.js E.PACKS, тот же ключ; render-test
    //    сверяет список и имена). «Мультяшные» (toon) — только 3D: в 2D они выглядят как «Красивые» ──
    .define('shaders', { def: 'auto', list: ['auto', 'normal', 'pretty', 'ultra', 'toon', 'retro'] })
    .define('crt', { def: false, bool: 1 })
    .define('dof', { def: true, bool: 1 });   // «Глубина резкости» (набор «Ультра» на компьютере; автофокус — post.js)
  // что сбрасывает «↺ Сбросить «Графика»» (всё, что во вкладке; пресет — «Авто», как у нового игрока)
  const KEYS = ['gfxPreset', ...DETAIL, 'gfx', 'fsr', 'fps', 'world2d', 'fpsCap', 'res', 'battery', 'upscaler', 'sharp', 'framegen', 'shaders', 'crt', 'dof'];
  // имена 3D-наборов (как E.PACKS[id].name) и подсказки для 3D-игр
  const PACKS = [['auto', '🤖 Авто'], ['normal', '🎨 Обычные'], ['pretty', '✨ Красивые'], ['ultra', '💎 Ультра'], ['toon', '🖍 Мультяшные'], ['retro', '👾 Ретро/пиксели']];
  const PACK_HINT = {
    auto: 'По устройству: телефон — «Обычные», мощный ПК — «Красивые».',
    normal: 'Проверено на всех устройствах, самое быстрое.',
    pretty: 'Лучи сквозь листву, облака, трава на ветру, блики на воде.',
    ultra: '«Красивые» в полном качестве и глубина резкости — для мощных компьютеров.',
    toon: 'Как мультфильм: свет полосами, контуры, сочные цвета.',
    retro: 'Крупные пиксели и цвет полосами, как в старых играх.',
  };
  // те же наборы в 2D-играх («Подземье»…)
  const SHH = { auto: 'По качеству графики; на телефоне — «Обычные».', normal: 'Мягкий цветной свет и огонь — быстро везде.',
    pretty: 'Плюс свечение, рябь воды, дрожь воздуха над лавой.', ultra: 'Ещё мягче свет, больше искр — для мощных компьютеров.',
    toon: 'В 2D-играх — как «Красивые» (мультяшный вид — у 3D-миров).', retro: 'Крупные пиксели и свет клетками, как в старых играх.' };
  const SHO = [['auto', 'Авто'], ['normal', 'Обычные'], ['pretty', 'Красивые'], ['ultra', 'Ультра'], ['toon', 'Мультяшные'], ['retro', 'Ретро']];
  const PP = [['auto', 'Авто'], ['low', 'Низкое'], ['mid', 'Среднее'], ['high', 'Высокое'], ['ultra', 'Ультра'], ['custom', 'Своё']];

  const dev = () => { const E = root.D37E; try { return E?.quality ? E.quality() : 'mid'; } catch (e) { return 'mid'; } };   // устройство (body.low, телефон, ядра)
  const presetOf = p => PRESETS[p === 'auto' || p === 'custom' ? dev() : p] || PRESETS.mid;
  // ── Перенос: был выбор качества (d37_gfx) — пресет он же ──
  try {
    const raw = JSON.parse(root.localStorage?.getItem('d37_settings') || '{}') || {};
    if (!('gfxPreset' in raw)) {
      const old = root.localStorage?.getItem('d37_gfx');
      if (['low', 'mid', 'high'].includes(old)) S.set('gfxPreset', old);
    }
  } catch (e) {}

  // ── «На живую»: D37Opt.gfx для движка ──
  function publish(){
    const O = root.D37Opt || (root.D37Opt = { rev: 0 });
    O.gfx = { preset: S.get('gfxPreset'), shadowQ: S.get('shadowQ'), ao: S.get('ao'), water: S.get('water'), refl: S.get('refl'), aa: S.get('aa'),
      fog: S.get('fog'), dist: S.get('dist'), grade: S.get('grade'), fpsCap: +S.get('fpsCap') || 0, res: S.get('res'), battery: S.get('battery'),
      upscaler: S.get('upscaler'), sharp: S.get('sharp'), rt: S.get('rt'), framegen: S.get('framegen'), shaders: S.get('shaders'), crt: S.get('crt'), dof: S.get('dof') };
    O.rev++;
  }
  // ── Контекст открытой игры (её «качество — пересобрать мир»): перехватываем context(), окно его не отдаёт ──
  let gctx = null;
  const ctx0 = S.context;
  S.context = c => { gctx = c || null; const off = ctx0(c); return () => { if (gctx === c) gctx = null; off(); }; };
  const liveR = () => { try { return gctx?.R?.() || null; } catch (e) { return null; } };
  // основа рендерера сменилась — пересобрать мир (если игра умеет), иначе — при следующем запуске
  function tierTo(t){
    if (S.get('gfx') === t) return;
    S.set('gfx', t);
    const R = liveR(); if (!R) return;
    try { const now = root.D37E?.gfxQuality?.(); if (now && now !== R.q) gctx?.gfx?.(t); } catch (e) { console.error(e); }
  }
  let busy = false;
  S.on(d => {
    if (busy) return;
    busy = true;
    try {
      const k = d?.key;
      if (k === 'gfxPreset' && d.ui) {
        const p = d.value;
        if (p !== 'custom') {   // пресет: «основа» по нему, тени — как в пресете, мелочи — его значения (для «Своя» потом)
          const v = presetOf(p);
          for (const key of DETAIL) S.set(key, v[key]);
          S.set('shadows', true);
          tierTo(p === 'auto' ? 'auto' : v.tier);
        }
      } else if (d?.ui && DETAIL.includes(k) && S.get('gfxPreset') !== 'custom') {   // тронул мелочь — «Своя» с прежними значениями
        // ui: окно не перерисовывается посреди перетаскивания ползунка (перерисуем, когда отпустят — 'change' ниже)
        const v = presetOf(S.get('gfxPreset'));
        for (const key of DETAIL) if (key !== k) S.set(key, key === 'shadows' ? S.get('shadows') && v.shadows !== false : v[key], { ui: true });
        S.set('gfxPreset', 'custom', { ui: true });
      }
    } finally { busy = false; }
    publish();
  });
  publish();

  // ── Строки ──
  // что показывать: в пресете — его значения (мелочи хранятся для «Своя»), «Тени: выкл» — как выбрал игрок
  const val = k => { const p = S.get('gfxPreset'); return p !== 'custom' && DETAIL.includes(k) && k !== 'shadows' ? presetOf(p)[k] : S.get(k); };
  const row = (label, ctl, hint, o = {}) => `<div class="gs-row${o.dis ? ' dis' : ''}"${o.words ? ` data-words="${esc(o.words)}"` : ''}><div class="gs-lbl"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</div><div class="gs-ctl">${ctl}</div></div>`;
  const seg = (k, opts, o = {}) => `<div class="gs-seg" role="radiogroup" aria-label="${esc(o.label || k)}">${opts.map(([v, t]) => { const on = val(k) === v; return `<button type="button" role="radio" aria-checked="${on}" class="${on ? 'on' : ''}" data-set="${k}" data-v="${esc(v)}"${o.dis ? ' disabled' : ''}>${t}</button>`; }).join('')}</div>`;
  const sw = (k, o = {}) => `<label class="gs-sw"><input type="checkbox" data-sw="${k}"${val(k) ? ' checked' : ''}${o.dis ? ' disabled' : ''} aria-label="${esc(o.label || k)}"><i aria-hidden="true"></i></label>`;
  const FMT = { dist: v => Math.round(v * 100) + '%', res: v => Math.round(v) + '%', sharp: v => Math.round(v) + '%' };
  const range = (k, min, max, step, mul = 1, o = {}) => `<div class="gs-range"><input type="range" min="${min}" max="${max}" step="${step}" value="${Math.round(val(k) * mul)}" data-range="${k}" data-mul="${mul}" aria-label="${esc(o.label || k)}"${o.dis ? ' disabled' : ''}><output data-out="${k}">${FMT[k] ? FMT[k](val(k)) : val(k)}</output></div>`;
  const head = t => `<div class="gs-sec">${t}</div>`;
  const note = t => `<p class="gs-note">${t}</p>`;
  const QN = { low: 'низкое', mid: 'среднее', high: 'высокое' };
  const HINT = { auto: 'Подберёт само и упростит, если тормозит.', low: 'Без теней и текстур — для слабых телефонов.', mid: 'Тени, вода, свечение — для телефонов и ноутбуков.',
    high: 'Мягкие тени, затенение, отражения — для компьютеров.', ultra: 'Всё на максимум и дальше видно — для мощных компьютеров.', custom: 'Своё — настрой всё ниже по вкладке «🎨 Графика».' };
  // «Качество графики»: что сейчас и что значит выбранное (и в «Главном», и во вкладке)
  function presetHint(){
    const R = liveR(), p = S.get('gfxPreset');
    const aq = R?.autoQ?.(), steps = aq && aq.step ? ` Сейчас упрощено на ${aq.step} из ${aq.steps - 1} — 3D тормозило.` : '';
    const now = R ? `Сейчас: ${QN[R.q] || R.q}${p === 'ultra' && R.q === 'high' ? ' + ультра' : ''}.` : p === 'auto' ? `Для этого устройства: ${QN[dev()]}.` : '';
    return `${now} ${HINT[p] || ''}${steps}`.trim();
  }
  const presetRow = () => row('Качество графики', seg('gfxPreset', PP, { label: 'Качество графики' }), presetHint(), { words: 'пресет графика качество лагает тормозит производительность fps' });
  // «Шейдеры»: что включено на деле (страж графики мог вернуть предыдущий набор, на «низкой» — «Обычные»)
  function shaderHint(){
    const R = liveR(), sh = S.get('shaders'), SH = root.D37E?.shade2d, is3d = !!(gctx?.engine || R);
    let shNow = '';
    if (is3d) {
      const fx = R?.pack, bad = (root.D37E?.gfxGuardInfo?.().off || []).filter(k => k.startsWith('pack:')).map(k => (PACKS.find(x => x[0] === k.slice(5)) || [0, k.slice(5)])[1]);
      shNow = (fx && fx.id ? `Сейчас: ${(PACKS.find(x => x[0] === fx.id) || [0, fx.id])[1]}. ` : '') + (bad.length ? `Не заработали здесь: ${bad.join(', ')} — включён предыдущий. ` : '');
    } else if (sh === 'auto' && SH) shNow = `Сейчас: «${SH.PACKS[SH.pack()]?.name || ''}». `;
    return shNow + ((is3d ? PACK_HINT : SHH)[sh] || '');
  }
  const shaderRow = (label = 'Шейдеры') => row(label, seg('shaders', SHO, { label: 'Шейдеры' }), shaderHint(), { words: 'набор шейдеров красиво картинка эффекты стиль ретро пиксели мульт' });
  // «⭐ Главное»: качество и шейдеры (в обычной игре — шейдеры, только если она рисуется 2D-шейдерами)
  S.addMain?.({ id: 'preset', order: 10, ctx: ['engine', 'site'], html: presetRow });
  S.addMain?.({ id: 'shaders', order: 20, ctx: ['engine', 'site', 'game'], when: c => c !== 'game' || (root.D37E?.shade2d?.users || 0) > 0, html: () => shaderRow() });

  // ── Вкладка ──
  function tab(){
    const R = liveR(), p = S.get('gfxPreset'), tier = R ? R.q : (S.get('gfx') === 'auto' ? dev() : S.get('gfx')), low = tier === 'low';
    const sh = S.get('shaders'), is3d = !!(gctx?.engine || R);
    let h = head('Шейдеры') + shaderRow('Набор шейдеров')
      + (sh === 'retro' ? row('Полоски старого телевизора', sw('crt', { label: 'Полоски старого телевизора' }), 'Строки и цветная сетка, как у кинескопа.', { words: 'crt телевизор ретро' }) : '')
      // глубина резкости — у 3D-миров («Ультра» на компьютере; «Авто» с пресетом «Ультра» — тоже); на телефоне её нет
      + (is3d && !root.D37E?.isMobile?.() && (sh === 'ultra' || (sh === 'auto' && S.get('gfxPreset') === 'ultra') || R?.pack?.id === 'ultra')
        ? row('Глубина резкости', sw('dof', { label: 'Глубина резкости' }), 'Резко там, куда смотришь; даль мягко размыта. Выкл — всё чётко.', { words: 'размытие dof фокус мыло' }) : '');
    // открыта 2D-игра (не на 3D-движке) — ей нужны только шейдеры
    let game2d = false; try { game2d = !gctx?.engine && typeof gamesActive !== 'undefined' && !!gamesActive; } catch (e) {}   // gamesActive — let в games.js
    if (game2d) return h + note('Остальная графика — для 3D-миров («Мир Денчика», «Студия 3D»).');
    h += head('3D-миры: «Мир Денчика», «Студия 3D»') + presetRow();
    if (p === 'custom') h += row('Основа графики', seg('gfx', [['auto', 'Авто'], ['low', 'Низкая'], ['mid', 'Средняя'], ['high', 'Высокая']], { label: 'Основа графики' }), 'Материалы и свет. «Низкая» — без теней и текстур; смена — мир перезагрузится.', { words: 'основа качество' });
    const lowDis = { dis: low }, lowHint = 'На низком качестве этого нет.';
    // глубина кадра на этой видеокарте неточная (post.js проверяет при запуске) — AO, трассировка и генерация кадров выключены
    const dfx = !R?.post || R.post.depthOK !== false, depDis = { dis: low || !dfx }, depHint = 'Недоступно на этом устройстве: видеокарта неточно отдаёт глубину (были бы пятна).';
    const shOff = low || !S.get('shadows');
    h += head('Картинка')
      + row('Тени', sw('shadows', { ...lowDis, label: 'Тени' }), low ? 'На низком качестве теней нет.' : 'Выключи, если 3D тормозит.', { ...lowDis, words: 'тень' })
      + row('Качество теней', seg('shadowQ', [['low', 'Низкое'], ['mid', 'Среднее'], ['high', 'Высокое'], ['ultra', 'Ультра']], { dis: shOff, label: 'Качество теней' }), 'Выше — чётче и мягче, но тяжелее.', { dis: shOff, words: 'тень' })
      + row('Затенение в углах', seg('ao', [['off', 'Выкл'], ['on', 'Вкл'], ['high', 'Высокое']], { ...depDis, label: 'Затенение в углах' }), low ? lowHint : !dfx ? depHint : 'Мягкие тени в углах и под предметами (тяжело для телефона).', { ...depDis, words: 'ao ambient occlusion тень' })
      + row('Вода', seg('water', [['simple', 'Простая'], ['good', 'Красивая']], { ...lowDis, label: 'Вода' }), low ? lowHint : '«Красивая» — глубина, пена у берега и рябь.', lowDis)
      + row('Отражения неба', sw('refl', { ...lowDis, label: 'Отражения неба' }), low ? lowHint : 'Блеск металла, стекла и воды.', { ...lowDis, words: 'блеск' })
      + row('Трассировка лучей', seg('rt', [['off', 'Выкл'], ['on', 'Вкл'], ['high', 'Высокая']], { ...depDis, label: 'Трассировка лучей' }),
        low ? lowHint : !dfx ? depHint : 'Отражения домов в воде и стекле, тени у ножек — тяжело, для компьютеров.', { ...depDis, words: 'rtx raytracing лучи отражения' })
      + row('Сглаживание краёв', seg('aa', [['off', 'Выкл'], ['fxaa', 'FXAA'], ['msaa', 'MSAA']], { ...lowDis, label: 'Сглаживание краёв' }), low ? lowHint : 'Убирает «лесенку» на краях; MSAA чище, но тяжелее.', { ...lowDis, words: 'сглаживание лесенка зубцы msaa fxaa' })
      + row('Туман и дымка', sw('fog', { label: 'Туман и дымка' }), 'Воздух вдали и туман у земли.')
      + row('Дальность прорисовки', range('dist', 50, 200, 5, 100, { label: 'Дальность прорисовки' }), 'Дальше — видно больше, но тяжелее.', { words: 'дальность видимость' })
      + row('Цвет кадра', sw('grade', { ...lowDis, label: 'Цвет кадра' }), low ? lowHint : 'Цветокоррекция мира и затемнение по краям.', { ...lowDis, words: 'цветокоррекция виньетка' })
      + head('Скорость')
      + row('Растягивание кадра', seg('upscaler', [['fsr', 'FSR 1 (AMD)'], ['nis', 'NIS (NVIDIA)'], ['off', 'Выкл']], { ...lowDis, label: 'Растягивание кадра' }),
        low ? 'Работает на среднем качестве и выше.' : 'Чем растянуть уменьшенный кадр: FSR 1 (AMD) или NIS (NVIDIA).', { ...lowDis, words: 'апскейлер fsr nis dlss upscale' })
      + row('Размер кадра', seg('fsr', [['auto', 'Авто'], ['native', '100%'], ['quality', 'Качество'], ['balanced', 'Баланс'], ['performance', 'Скорость']], { ...lowDis, label: 'Размер кадра' }),
        low ? 'На низком качестве — всегда 100%.' : 'Кадр меньше экрана — быстрее. «Авто» — только когда тормозит.', { ...lowDis, words: 'разрешение fsr' })
      + row('Резкость', range('sharp', 0, 100, 5, 1, { ...lowDis, label: 'Резкость' }), low ? '' : 'Резкость растянутого кадра.', { ...lowDis, words: 'чёткость мыло' })
      + row('Генерация кадров ×2', sw('framegen', { ...depDis, label: 'Генерация кадров' }), low ? lowHint : !dfx ? depHint : 'Повороты и бег вдвое плавнее на слабой видеокарте.', { ...depDis, words: 'плавность fps frame generation' })
      + row('Наибольший размер кадра', range('res', 50, 100, 5, 1, { label: 'Наибольший размер кадра' }), 'Меньше — быстрее, но мыльнее.', { words: 'разрешение масштаб' })
      + row('Лимит кадров в секунду', seg('fpsCap', [['0', 'Нет'], ['30', '30'], ['45', '45'], ['60', '60'], ['90', '90'], ['120', '120']], { label: 'Лимит кадров в секунду' }), 'Меньше кадров — телефон меньше греется.', { words: 'fps кадры нагрев' })
      + row('Экономия батареи', sw('battery', { label: 'Экономия батареи' }), '30 кадров, без затенения, тени проще.', { words: 'батарея заряд нагрев' })
      + row('Счётчик кадров (FPS)', sw('fps', { label: 'Счётчик кадров' }), 'Кадры в секунду поверх 3D (клавиша F3).', { words: 'fps лаги' })
      + (R && R.r?.capabilities?.isWebGL2 ? row('📸 Фото с трассировкой пути', '<button type="button" class="gs-btn" data-ptphoto="1">📸 Снять</button>', 'Красивый снимок того, что видно сейчас (PNG).', { words: 'скриншот снимок фото' }) : '')
      + row('Плоский «Мир Денчика»', sw('world2d', { label: 'Плоский мир' }), 'Мир без 3D — для очень слабых телефонов.', { words: '2d плоский' })
      + note('Графику своего мира задаёт автор («Студия 3D» → «🎨 Графика»); твои настройки — потолок. Анимации сайта — во вкладке «🌐 Сайт».')
      + guardBlock(R)
      + head('Технологии')
      + TECH.map(t => `<p class="gs-note"><b>${esc(t.name)}</b> — ${esc(t.who)}, лицензия ${esc(t.lic)} · <a href="${t.url}" target="_blank" rel="noopener noreferrer">лицензия и код</a></p>`).join('');
    return h;
  }
  // ── 🛡 Страж графики (js/engine/post.js E.gfxGuard): что на этом устройстве выключено само и почему, «Проверить», «Вернуть» ──
  const GNAME = { clim: 'погода на поверхностях (снег, лужи, листва)', codes: 'коды в кадре (трава без затенения, блеск для отражений)', fol: 'трава и листва без затенения', ao: 'затенение в углах (AO)', rt: 'трассировка лучей',
    fg: 'генерация кадров', nis: 'NIS', fsr: 'FSR 1', fxaa: 'FXAA', bloom: 'свечение', dof: 'глубина резкости', post: 'постобработка', test: 'самопроверка', patch: 'туман и тени v3', tier: 'графика выше низкой', waves: 'волны на воде', kbtex: '«живые» текстуры «Кубомира» (рельеф, лава, блёстки)' };
  const GWHY = { link: 'шейдер не собрался', color: 'менял цвет картинки', ao: 'затенение считалось неверно', nan: 'в кадре были «не числа»', crush: 'кадр гас', black: 'кадр был чёрным', error: 'проверка не удалась' };
  let gLast = null;   // итог последней «🩺 Проверить»
  function guardBlock(R){
    const E = root.D37E; if (!E?.gfxGuardInfo) return '';
    const g = E.gfxGuardInfo(), last = {};
    for (const w of g.why) last[w.k] = w;
    const list = g.off.map(k => (k.startsWith('pack:') ? `шейдеры «${(PACKS.find(x => x[0] === k.slice(5)) || [0, k.slice(5)])[1].replace(/^\S+\s/, '')}»` : GNAME[k] || k) + (last[k] ? ` (${GWHY[last[k].why] || last[k].why})` : ''));
    const btn = (R?.guard ? '<button type="button" class="gs-btn" data-gguard="check">🩺 Проверить</button> ' : '') + (g.off.length ? '<button type="button" class="gs-btn" data-gguard="reset">↺ Вернуть всё</button>' : '');
    const hint = g.off.length ? `Само выключилось на этом устройстве: ${list.join('; ')}. «Вернуть всё» — включить снова.`
      : 'Движок сам проверяет картинку и выключает только то, что сломалось.';
    return head('🛡 Страж графики') + row('Проверка графики', btn || '—', esc(hint), { words: 'страж поломка чёрный экран' }) + (gLast ? note(esc(gLast)) : '');
  }
  function guardText(rep){
    if (!rep) return 'Проверка не прошла: игра на паузе? Закрой настройки и попробуй ещё раз.';
    const s = rep.sum || {}, bad = rep.log.length ? ' Выключено сейчас: ' + rep.log.map(x => GNAME[x.split(':')[0]] || x).join(', ') + '.' : '';
    const parts = [`шейдеров ${rep.programs}${rep.failed ? `, не собралось ${rep.failed}` : ', все собрались'}`];
    if (s.codes) parts.push(s.codes.bad ? `коды меняли цвет в ${s.codes.bad} точках` : 'коды в кадре — без следов');
    if (s.ao) parts.push(`затенение ${Math.round(s.ao.mean * 100)}%`);
    if (s.comp) parts.push(s.comp.bad ? `кадр гас в ${s.comp.bad} из ${s.comp.n} точек` : 'кадр собирается правильно');
    return `${rep.failed || bad ? '⚠️' : '✅'} ${rep.gpu?.model || ''}: ${parts.join(', ')}.${bad}${rep.err ? ' Ошибка: ' + rep.err : ''}`;
  }
  root.document?.addEventListener?.('click', e => {
    const b = e.target?.closest?.('[data-gguard]'); if (!b) return;
    const E = root.D37E, R = liveR();
    if (b.dataset.gguard === 'reset') { gLast = null; E?.gfxGuardReset?.(); S.refresh(); return; }
    if (!R?.guard) return;
    b.disabled = true; b.textContent = '⏳ Проверяем…';
    let done = false;
    const fin = rep => { if (done) return; done = true; gLast = guardText(rep); S.refresh(); };
    R.guard.check(fin);
    setTimeout(() => fin(null), 4000);   // кадров нет (пауза, панель скрыта) — честно сказать
  });
  // благодарности: чужой код в графике (лицензии требуют сохранить уведомление — оно в js/engine/post.js)
  const TECH = [
    { name: 'AMD FidelityFX Super Resolution 1 (FSR 1)', who: '© Advanced Micro Devices, Inc.', lic: 'MIT', url: 'https://github.com/GPUOpen-Effects/FidelityFX-FSR/blob/master/license.txt' },
    { name: 'NVIDIA Image Scaling (NIS) SDK 1.0.3', who: '© NVIDIA Corporation & Affiliates', lic: 'MIT', url: 'https://github.com/NVIDIAGameWorks/NVIDIAImageScaling/blob/main/licence.txt' },
    { name: 'three.js r149', who: '© three.js authors', lic: 'MIT', url: 'https://github.com/mrdoob/three.js/blob/r149/LICENSE' },
  ];
  // в обычной игре — только если она рисуется 2D-шейдерами (js/engine/shade2d.js: D37E.shade2d.use()), и там — только «Шейдеры»
  S.addTab({ id: 'gfx', icon: '🎨', title: 'Графика', order: 10, ctx: ['engine', 'site', 'game'], when: c => c !== 'game' || (root.D37E?.shade2d?.users || 0) > 0, render: tab, keys: KEYS });
  // проценты у ползунков (окно настроек пишет число — поправляем подпись)
  root.document?.addEventListener?.('input', e => {
    const t = e.target, k = t?.dataset?.range; if (!FMT[k]) return;
    const out = t.closest('.gs-range')?.querySelector(`[data-out="${k}"]`); if (out) out.textContent = FMT[k](S.get(k));
  });
  // отпустили ползунок графики — перерисовать (пресет мог стать «Своя»)
  root.document?.addEventListener?.('change', e => { const k = e.target?.dataset?.range; if (k && (DETAIL.includes(k) || FMT[k])) S.refresh(); });
  // «📸 Фото с трассировкой пути»: трассировщик грузится только по кнопке (js/engine/pathtrace.js)
  root.document?.addEventListener?.('click', e => {
    const b = e.target?.closest?.('[data-ptphoto]'); if (!b) return;
    const R = liveR(); if (!R) return;
    b.disabled = true; b.textContent = '⏳ Загружаем…';
    const go = () => { S.close(); try { root.D37E.pathPhoto(R); } catch (er) { console.error(er); } };
    if (root.D37E?.pathPhoto) { go(); return; }
    const load = typeof root.gamesLoadScript === 'function' ? root.gamesLoadScript('js/engine/pathtrace.js')
      : new Promise((res, rej) => { const s = root.document.createElement('script'); s.src = 'js/engine/pathtrace.js'; s.onload = res; s.onerror = rej; root.document.head.appendChild(s); });
    Promise.resolve(load).then(go, () => { b.disabled = false; b.textContent = '📸 Снять'; });
  });
  S.gfxExt = { PRESETS, DETAIL, publish, presetOf, KEYS };
})();
