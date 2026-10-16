// ═══════════════════════════════════════
//  НАСТРОЙКИ ГРАФИКИ 3D (вкладка «🎨 Графика» окна ⚙️ — поверх js/core/settings.js через define / addTab / on)
// ═══════════════════════════════════════
// Пресеты: Авто (по устройству + сам снижает/поднимает ступени по времени кадра) / Низкая / Средняя / Высокая / Ультра / Своя.
// Тронул любую мелочь — пресет становится «Своя» (с теми же значениями, что были). Ключи в d37_settings: gfxPreset, shadowQ,
// ao, water, refl, aa, fog, dist, grade, fpsCap, res, battery (+ старые gfx — «основа» рендерера, fsr, shadows, fps, world2d).
// Перенос: был d37_gfx (low/mid/high) — пресет он же; «Тени: выкл» сохраняются. На живую: window.D37Opt.gfx (+ rev++) —
// render.js (E.gfxResolve → R.applyGfx). Смена «основы» (low ↔ mid ↔ high) — мир пересобирается (ctx.gfx), студия — при
// следующем запуске. Пресеты — те же, что E.GFX_PRESETS в js/engine/gfx.js (render-test сверяет).
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
    .define('crt', { def: false, bool: 1 });
  // имена 3D-наборов (как E.PACKS[id].name) и подсказки для 3D-игр
  const PACKS = [['auto', '🤖 Авто'], ['normal', '🎨 Обычные'], ['pretty', '✨ Красивые'], ['ultra', '💎 Ультра'], ['toon', '🖍 Мультяшные'], ['retro', '👾 Ретро/пиксели']];
  const PACK_HINT = {
    auto: 'Само по устройству: телефон — «Обычные» (сильный — «Красивые»), мощный компьютер — «Красивые».',
    normal: 'Как сейчас: проверено на всех устройствах, самое быстрое.',
    pretty: 'Мягкий кинотон, лучи солнца сквозь листву, облака по небу, трава и листва на ветру, блики по дну воды.',
    ultra: 'Всё из «Красивых» в полном качестве, перистые облака и глубина резкости (фон мягко размыт) — для мощных компьютеров.',
    toon: 'Как мультфильм: свет полосами, чёрные контуры, сочные цвета.',
    retro: 'Крупные пиксели и цвет полосами — как в старых играх. Можно с полосками старого телевизора.',
  };

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
      upscaler: S.get('upscaler'), sharp: S.get('sharp'), rt: S.get('rt'), framegen: S.get('framegen'), shaders: S.get('shaders'), crt: S.get('crt') };
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

  // ── Вкладка ──
  // что показывать: в пресете — его значения (мелочи хранятся для «Своя»), «Тени: выкл» — как выбрал игрок
  const val = k => { const p = S.get('gfxPreset'); return p !== 'custom' && DETAIL.includes(k) && k !== 'shadows' ? presetOf(p)[k] : S.get(k); };
  const row = (label, ctl, hint, o = {}) => `<div class="gs-row${o.dis ? ' dis' : ''}"><div class="gs-lbl"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</div><div class="gs-ctl">${ctl}</div></div>`;
  const seg = (k, opts, o = {}) => `<div class="gs-seg" role="radiogroup">${opts.map(([v, t]) => { const on = val(k) === v; return `<button type="button" role="radio" aria-checked="${on}" class="${on ? 'on' : ''}" data-set="${k}" data-v="${esc(v)}"${o.dis ? ' disabled' : ''}>${t}</button>`; }).join('')}</div>`;
  const sw = (k, o = {}) => `<label class="gs-sw"><input type="checkbox" data-sw="${k}"${val(k) ? ' checked' : ''}${o.dis ? ' disabled' : ''}><i aria-hidden="true"></i></label>`;
  const FMT = { dist: v => Math.round(v * 100) + '%', res: v => Math.round(v) + '%', sharp: v => Math.round(v) + '%' };
  const range = (k, min, max, step, mul = 1, o = {}) => `<div class="gs-range"><input type="range" min="${min}" max="${max}" step="${step}" value="${Math.round(val(k) * mul)}" data-range="${k}" data-mul="${mul}" aria-label="${k}"${o.dis ? ' disabled' : ''}><output data-out="${k}">${FMT[k] ? FMT[k](val(k)) : val(k)}</output></div>`;
  const head = t => `<div class="gs-sec">${t}</div>`;
  const note = t => `<p class="gs-note">${t}</p>`;
  const QN = { low: 'низкое', mid: 'среднее', high: 'высокое' };
  function tab(){
    const R = liveR(), p = S.get('gfxPreset'), tier = R ? R.q : (S.get('gfx') === 'auto' ? dev() : S.get('gfx')), low = tier === 'low';
    const aq = R?.autoQ?.(), steps = aq && aq.step ? ` Сейчас упрощено на ${aq.step} из ${aq.steps - 1} ступеней — 3D тормозило.` : '';
    const now = R ? `Сейчас: ${QN[R.q] || R.q}${p === 'ultra' && R.q === 'high' ? ' + ультра' : ''}.` : p === 'auto' ? `Для этого устройства: ${QN[dev()]}.` : '';
    const HINT = { auto: 'Само подбирает под устройство и снижает, если тормозит.', low: 'Без теней и текстур — для слабых телефонов.', mid: 'Тени, вода, свечение — для телефонов и ноутбуков.',
      high: 'Мягкие тени, затенение в углах (AO), трассировка лучей, MSAA, рельеф текстур.', ultra: 'Для мощных компьютеров: тени 4096, AO и трассировка лучей выше, дальше видно.', custom: 'Своя — всё ниже на выбор.' };
    const pp = [['auto', 'Авто'], ['low', 'Низкая'], ['mid', 'Средняя'], ['high', 'Высокая'], ['ultra', 'Ультра'], ['custom', 'Своя']];
    // «Шейдеры»: наборы картинки для 2D-игр («Подземье»…) и 3D (js/engine/shade2d.js — 2D; 3D-наборы — по этому же ключу)
    const sh = S.get('shaders'), SH = root.D37E?.shade2d, is3d = !!(gctx?.engine || R);
    const SHH = { auto: 'По пресету графики и устройству: на телефоне — «Обычные».', normal: 'Мягкий цветной свет, мерцание огня, ореолы — быстро на любом устройстве.',
      pretty: 'Плюс свечение (bloom), рябь воды, дрожь воздуха над лавой, цвет кадра по краю мира, виньетка, объём текстур по свету.', ultra: 'Плюс свет ещё мягче, свечение шире, больше искр и частиц — для мощных компьютеров.',
      toon: 'В 2D-играх — как «Красивые» (мультяшный вид — у 3D-миров).',
      retro: 'Крупные пиксели, свет клетками и меньше оттенков — как старые игры. Можно с полосками старого телевизора.' };
    // открыт 3D-мир: что включено на деле (страж графики мог вернуть предыдущий набор, на «низкой» — «Обычные»)
    let shNow = '';
    if (is3d) {
      const fx = R?.pack, bad = (root.D37E?.gfxGuardInfo?.().off || []).filter(k => k.startsWith('pack:')).map(k => (PACKS.find(x => x[0] === k.slice(5)) || [0, k.slice(5)])[1]);
      shNow = (fx && fx.id ? `Сейчас: ${(PACKS.find(x => x[0] === fx.id) || [0, fx.id])[1]}. ` : '') + (bad.length ? `На этом устройстве не заработали: ${bad.join(', ')} — включён предыдущий. ` : '');
    } else if (sh === 'auto' && SH) shNow = `Сейчас: «${SH.PACKS[SH.pack()]?.name || ''}». `;
    let h = head('Шейдеры')
      + row('Набор', seg('shaders', [['auto', 'Авто'], ['normal', 'Обычные'], ['pretty', 'Красивые'], ['ultra', 'Ультра'], ['toon', 'Мультяшные'], ['retro', 'Ретро']]), shNow + ((is3d ? PACK_HINT : SHH)[sh] || ''))
      + (sh === 'retro' ? row('Полоски CRT', sw('crt'), 'Строки и цветная маска, как у старого телевизора.') : '');
    // открыта 2D-игра (не на 3D-движке) — ей нужны только шейдеры
    let game2d = false; try { game2d = !gctx?.engine && typeof gamesActive !== 'undefined' && !!gamesActive; } catch (e) {}   // gamesActive — let в games.js
    if (game2d) return h + note('Остальная графика — для 3D-миров («Мир Денчика», «Студия 3D»).');
    h += head('3D-миры: «Мир Денчика», «Студия 3D»')
      + row('Пресет', seg('gfxPreset', pp), `${now} ${HINT[p] || ''}${steps}` + (gctx?.gfx ? '' : R ? ' Смена основы (низкая/средняя/высокая) — при следующем запуске.' : ''));
    if (p === 'custom') h += row('Основа', seg('gfx', [['auto', 'Авто'], ['low', 'Низкая'], ['mid', 'Средняя'], ['high', 'Высокая']]), 'Материалы и свет. Низкая — без теней и текстур (Ламберт). Мир перезагрузится.');
    const lowDis = { dis: low }, lowHint = 'На низкой основе этого нет.';
    // глубина кадра на этой видеокарте неточная (post.js проверяет при запуске) — AO, трассировка и генерация кадров выключены
    const dfx = !R?.post || R.post.depthOK !== false, depDis = { dis: low || !dfx }, depHint = 'На этом устройстве недоступно: видеокарта отдаёт глубину кадра неточно — были бы пятна на полу.';
    h += head('Картинка')
      + row('Тени', `${sw('shadows', lowDis)}`, low ? lowHint : 'Выключи, если 3D тормозит.', lowDis)
      + row('Качество теней', seg('shadowQ', [['low', 'Низкое'], ['mid', 'Среднее'], ['high', 'Высокое'], ['ultra', 'Ультра']], { dis: low || !S.get('shadows') }), 'Выше — чётче и мягче (карта 1024 → 4096), дороже.', { dis: low || !S.get('shadows') })
      + row('Затенение в углах (AO)', seg('ao', [['off', 'Выкл'], ['on', 'Вкл'], ['high', 'Высокое']], depDis), low ? lowHint : !dfx ? depHint : 'Тени в углах, под предметами и у стен — объёмнее. Дорого для телефона.', depDis)
      + row('Вода', seg('water', [['simple', 'Простая'], ['good', 'Красивая']], lowDis), low ? lowHint : 'Красивая: глубина, пена у берега, два слоя ряби.', lowDis)
      + row('Отражения неба', sw('refl', lowDis), low ? lowHint : 'Блеск металла, стекла и воды.', lowDis)
      + row('Трассировка лучей', seg('rt', [['off', 'Выкл'], ['on', 'Вкл'], ['high', 'Высокая']], depDis),
        low ? lowHint : !dfx ? depHint : 'Лучи по кадру (как RTX-эффекты): в воде, стекле, льду, металле и мокром полу отражаются здания и деревья, у ножек и стен — контактные тени от солнца. «Высокая» — луч длиннее и точнее. Дорого: для компьютеров (на телефоне в «Авто» выключена).', depDis)
      + row('Сглаживание', seg('aa', [['off', 'Выкл'], ['fxaa', 'FXAA'], ['msaa', 'MSAA']], lowDis), low ? lowHint : 'MSAA — чище, но дороже (на «ретине» само станет FXAA).', lowDis)
      + row('Туман и дымка', sw('fog'), 'Воздух вдали, туман у земли, тёплое свечение к солнцу.')
      + row('Дальность прорисовки', range('dist', 50, 200, 5, 100), 'Дальше — видно больше, но тяжелее.')
      + row('Цвет кадра', sw('grade', lowDis), low ? lowHint : 'Цветокоррекция мира и виньетка (как задумал автор мира).', lowDis)
      + head('Скорость')
      + row('Апскейлер', seg('upscaler', [['fsr', 'FSR 1 (AMD)'], ['nis', 'NIS (NVIDIA)'], ['off', 'Выкл']], lowDis),
        low ? 'Апскейлеры работают на средней основе и выше.' : 'Чем чётко растянуть кадр, нарисованный меньше экрана: AMD FidelityFX Super Resolution 1 или NVIDIA Image Scaling (NIS). «Выкл» — просто растянуть (мыльнее).', lowDis)
      + row('Разрешение', seg('fsr', [['auto', 'Авто'], ['native', '100%'], ['quality', 'Качество'], ['balanced', 'Баланс'], ['performance', 'Скорость']], lowDis),
        low ? 'На низкой основе — всегда 100%.' : 'Кадр рисуется меньше (77 / 67 / 59%), апскейлер растягивает его до экрана — игра быстрее. «Авто» снижает разрешение само, только когда тормозит.', lowDis)
      + row('Резкость', range('sharp', 0, 100, 5, 1, lowDis), low ? '' : 'Резкость апскейлера. У NIS — и в 100% кадре (как в панели NVIDIA).', lowDis)
      + row('Генерация кадров (×2)', sw('framegen', depDis), low ? 'На низкой основе этого нет.' : !dfx ? depHint : 'Для слабых видеокарт: настоящий кадр — через раз, между ними — прошлый, переложенный под новое положение камеры: повороты и бег вдвое плавнее (идея как у Frame Generation в AMD FSR 3 и NVIDIA DLSS — своим способом). При резком движении рисует по-настоящему. В счётчике FPS — «60 (30 настоящих)».', depDis)
      + row('Масштаб разрешения', range('res', 50, 100, 5), 'Потолок доли кадра: меньше — быстрее, но мыльнее.')
      + row('Лимит FPS', seg('fpsCap', [['0', 'Нет'], ['30', '30'], ['45', '45'], ['60', '60'], ['90', '90'], ['120', '120']]), 'Меньше кадров — телефон меньше греется.')
      + row('Экономия батареи', sw('battery'), '30 кадров, без AO, тени попроще, плотность пикселей ×1.')
      + row('Счётчик FPS', sw('fps'), 'Кадры в секунду и нагрузка — поверх 3D (клавиша F3).')
      + (R && R.r?.capabilities?.isWebGL2 ? row('📸 Фото с трассировкой пути', '<button type="button" class="gs-btn" data-ptphoto="1">📸 Снять</button>', 'Снимок того, что видно сейчас: честные лучи света (тени, отражения, отскоки), картинка уточняется на глазах. «💾 Сохранить» — PNG.') : '')
      + row('Плоский «Мир Денчика»', sw('world2d'), 'Мир без 3D — для очень слабых телефонов.')
      + note('Графику своего мира (время суток, небо, туман, цвет, вода) автор задаёт в «Студии 3D» → «🎨 Графика». Твои настройки — потолок: на слабом устройстве тяжёлое само выключается. Анимации сайта — во вкладке «🌐 Сайт».')
      + guardBlock(R)
      + head('Технологии')
      + TECH.map(t => `<p class="gs-note"><b>${esc(t.name)}</b> — ${esc(t.who)}, лицензия ${esc(t.lic)} · <a href="${t.url}" target="_blank" rel="noopener noreferrer">лицензия и код</a></p>`).join('');
    return h;
  }
  // ── 🛡 Страж графики (js/engine/post.js E.gfxGuard): что на этом устройстве выключено само и почему, «Проверить», «Вернуть» ──
  const GNAME = { clim: 'погода на поверхностях (снег, лужи, листва)', codes: 'коды в кадре (трава без затенения, блеск для отражений)', fol: 'трава и листва без затенения', ao: 'затенение в углах (AO)', rt: 'трассировка лучей',
    fg: 'генерация кадров', nis: 'NIS', fsr: 'FSR 1', fxaa: 'FXAA', bloom: 'свечение', post: 'постобработка', test: 'самопроверка', patch: 'туман и тени v3', tier: 'графика выше низкой' };
  const GWHY = { link: 'шейдер не собрался', color: 'менял цвет картинки', ao: 'затенение считалось неверно', nan: 'в кадре были «не числа»', crush: 'кадр гас', black: 'кадр был чёрным', error: 'проверка не удалась' };
  let gLast = null;   // итог последней «🩺 Проверить»
  function guardBlock(R){
    const E = root.D37E; if (!E?.gfxGuardInfo) return '';
    const g = E.gfxGuardInfo(), last = {};
    for (const w of g.why) last[w.k] = w;
    const list = g.off.map(k => (k.startsWith('pack:') ? `шейдеры «${(PACKS.find(x => x[0] === k.slice(5)) || [0, k.slice(5)])[1].replace(/^\S+\s/, '')}»` : GNAME[k] || k) + (last[k] ? ` (${GWHY[last[k].why] || last[k].why})` : ''));
    const btn = (R?.guard ? '<button type="button" class="gs-btn" data-gguard="check">🩺 Проверить</button> ' : '') + (g.off.length ? '<button type="button" class="gs-btn" data-gguard="reset">↺ Вернуть всё</button>' : '');
    const hint = g.off.length ? `На этом устройстве само выключилось: ${list.join('; ')}. «Вернуть всё» — включить снова (с новой версией сайта страж проверит всё заново сам).`
      : 'Движок сам проверяет, что картинка рисуется правильно: шейдеры собрались, кадр не чёрный, затенение и отражения — числа. Сломалось на этом устройстве — выключит только это и запомнит.';
    return head('🛡 Страж графики') + row('Проверка графики', btn || '—', esc(hint)) + (gLast ? note(esc(gLast)) : '');
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
  S.addTab({ id: 'gfx', icon: '🎨', title: 'Графика', order: 10, ctx: ['engine', 'site', 'game'], when: c => c !== 'game' || (root.D37E?.shade2d?.users || 0) > 0, render: tab });
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
  S.gfxExt = { PRESETS, DETAIL, publish, presetOf };
})();
