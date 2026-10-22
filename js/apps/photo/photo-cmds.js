// ═══════════════════════════════════════
//  🖼 ФОТОРЕДАКТОР — команды «d37 v1» и чистые расчёты (D37PhotoCmds)
// ═══════════════════════════════════════
// Без DOM: схемы команд (их видят и кнопки, и ИИ через D37Tools), цвета, шрифты, режимы наложения, фильтры fabric.js из
// настроек слоя, бюджет памяти (телефон / компьютер), подгонка размера, обрезка по пропорции. Движок (photo-core.js) берёт
// отсюда схемы и вешает на них выполнение; тест — node scripts/photo-test.cjs.
(function (root) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // ═══ Цвета: '#rgb', '#rrggbb', '#rrggbbaa', rgb()/rgba(), имена (en/ru), 'transparent' → '#rrggbb' / '#rrggbbaa' или null ═══
  const NAMED = {
    transparent: '#00000000', white: '#ffffff', black: '#000000', red: '#ff1e1e', green: '#1fae3a', lime: '#00ff00', blue: '#1e50ff',
    yellow: '#ffe000', orange: '#ff8a00', purple: '#8a3cf0', pink: '#ff5fa8', gray: '#808080', grey: '#808080', cyan: '#00e5ff',
    magenta: '#ff00ff', brown: '#8b4513', gold: '#ffd700', silver: '#c0c0c0', navy: '#000080', teal: '#008080',
    'белый': '#ffffff', 'чёрный': '#000000', 'черный': '#000000', 'красный': '#ff1e1e', 'зелёный': '#1fae3a', 'зеленый': '#1fae3a',
    'синий': '#1e50ff', 'голубой': '#22b8ff', 'жёлтый': '#ffe000', 'желтый': '#ffe000', 'оранжевый': '#ff8a00', 'фиолетовый': '#8a3cf0',
    'розовый': '#ff5fa8', 'серый': '#808080', 'коричневый': '#8b4513', 'золотой': '#ffd700', 'бирюзовый': '#30d5c8', 'прозрачный': '#00000000',
  };
  const hex2 = n => (n < 16 ? '0' : '') + n.toString(16);
  function color(v){
    if (typeof v !== 'string') return null;
    let s = v.trim().toLowerCase();
    if (NAMED[s]) s = NAMED[s];
    let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
    if (m) { let h = m[1]; if (h.length <= 4) h = h.split('').map(c => c + c).join(''); return '#' + h; }
    m = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(s);
    if (m) {
      const c = [m[1], m[2], m[3]].map(x => clamp(+x, 0, 255));
      let a = 255;
      if (m[4] != null) a = /%$/.test(m[4]) ? parseFloat(m[4]) * 2.55 : parseFloat(m[4]) <= 1 ? parseFloat(m[4]) * 255 : parseFloat(m[4]);
      a = clamp(Math.round(a), 0, 255);
      return '#' + c.map(hex2).join('') + (a === 255 ? '' : hex2(a));
    }
    return null;
  }
  const COLOR_RE = '^(#[0-9a-fA-F]{3,8}|rgba?\\([^)]{5,40}\\)|[a-zA-Zа-яА-ЯёЁ]{3,12})$';

  // ═══ Шрифты надписей: системные + Google Fonts с кириллицей (лицензия OFL; грузятся при выборе) ═══
  // [название, из Google Fonts, есть жирный 700]
  const FONTS = [
    ['Montserrat', 1, 1], ['Rubik', 1, 1], ['Oswald', 1, 1], ['Russo One', 1, 0], ['Unbounded', 1, 1], ['Lobster', 1, 0], ['Pacifico', 1, 0], ['Caveat', 1, 1],
    ['Comfortaa', 1, 1], ['Press Start 2P', 1, 0], ['PT Serif', 1, 1], ['Roboto', 1, 1],
    ['Arial', 0, 1], ['Verdana', 0, 1], ['Georgia', 0, 1], ['Times New Roman', 0, 1], ['Courier New', 0, 1], ['Impact', 0, 0],
  ];
  const FONT_NAMES = FONTS.map(f => f[0]);
  const isGoogleFont = f => !!(FONTS.find(x => x[0] === f) || [])[1];
  const hasBold = f => !!(FONTS.find(x => x[0] === f) || [])[2];

  // ═══ Режимы наложения слоёв (canvas globalCompositeOperation) ═══
  const BLENDS = { normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
    'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light', difference: 'difference',
    exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity' };
  const BLEND_RU = { normal: 'Обычный', multiply: 'Умножение', screen: 'Экран', overlay: 'Перекрытие', darken: 'Темнее', lighten: 'Светлее',
    'color-dodge': 'Осветление основы', 'color-burn': 'Затемнение основы', 'hard-light': 'Жёсткий свет', 'soft-light': 'Мягкий свет',
    difference: 'Разница', exclusion: 'Исключение', hue: 'Цветовой тон', saturation: 'Насыщенность', color: 'Цветность', luminosity: 'Яркость' };

  // ═══ Коррекции слоя → фильтры fabric.js (все считаются на видеокарте — WebGL fabric, без пересчёта пикселей в странице) ═══
  // Значения слоя — в «человеческих» единицах (−100…100 и т. п.); 0 — без изменения. Порядок фильтров постоянный.
  const ADJ = {
    exposure:    { min: -100, max: 100, ru: 'Экспозиция' },
    brightness:  { min: -100, max: 100, ru: 'Яркость' },
    contrast:    { min: -100, max: 100, ru: 'Контраст' },
    saturation:  { min: -100, max: 100, ru: 'Насыщенность' },
    vibrance:    { min: -100, max: 100, ru: 'Сочность' },
    hue:         { min: -180, max: 180, ru: 'Оттенок' },
    temperature: { min: -100, max: 100, ru: 'Теплее / холоднее' },
    sharpen:     { min: 0, max: 100, ru: 'Резкость' },
    blur:        { min: 0, max: 100, ru: 'Размытие' },
    noise:       { min: 0, max: 100, ru: 'Зерно' },
    pixelate:    { min: 0, max: 50, ru: 'Пиксели' },
  };
  const ADJ_KEYS = Object.keys(ADJ);
  const PRESETS = { none: 'Без фильтра', bw: 'Ч/Б', sepia: 'Сепия', vintage: 'Винтаж', kodachrome: 'Кодахром', technicolor: 'Техниколор',
    polaroid: 'Полароид', brownie: 'Шоколад', invert: 'Негатив' };
  const PRESET_CLASS = { bw: 'Grayscale', sepia: 'Sepia', vintage: 'Vintage', kodachrome: 'Kodachrome', technicolor: 'Technicolor', polaroid: 'Polaroid', brownie: 'Brownie', invert: 'Invert' };
  // adj { … } + preset → [[имя класса fabric.filters, опции], …]
  function filterSpecs(adj, preset){
    const a = adj || {}, out = [], v = k => clamp(+a[k] || 0, ADJ[k].min, ADJ[k].max);
    if (v('exposure')) { const g = clamp(Math.pow(2, v('exposure') / 100 * 1.2), 0.2, 2.2); out.push(['Gamma', { gamma: [g, g, g] }]); }
    if (v('brightness')) out.push(['Brightness', { brightness: v('brightness') / 100 * 0.6 }]);
    if (v('contrast')) out.push(['Contrast', { contrast: v('contrast') / 100 * 0.6 }]);
    if (v('saturation')) out.push(['Saturation', { saturation: v('saturation') / 100 }]);
    if (v('vibrance')) out.push(['Vibrance', { vibrance: v('vibrance') / 100 }]);
    if (v('hue')) out.push(['HueRotation', { rotation: v('hue') / 180 }]);
    if (v('temperature')) { const t = v('temperature') / 100 * 0.16; out.push(['ColorMatrix', { matrix: [1 + t, 0, 0, 0, 0, 0, 1 + t * 0.15, 0, 0, 0, 0, 0, 1 - t, 0, 0, 0, 0, 0, 1, 0] }]); }
    if (preset && PRESET_CLASS[preset]) out.push([PRESET_CLASS[preset], {}]);
    if (v('sharpen')) { const k = v('sharpen') / 100 * 1.2; out.push(['Convolute', { matrix: [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0] }]); }
    if (v('blur')) out.push(['Blur', { blur: v('blur') / 100 * 0.35 }]);
    if (v('noise')) out.push(['Noise', { noise: Math.round(v('noise') * 4) }]);
    if (v('pixelate')) out.push(['Pixelate', { blocksize: 2 + Math.round(v('pixelate')) }]);
    return out;
  }

  // ═══ Бюджет памяти ═══
  // o: { phone, devMem (ГБ, navigator.deviceMemory), maxTex (gl MAX_TEXTURE_SIZE) } → пределы. Картинки больше — уменьшаются
  // при открытии (с предупреждением); слоёв больше бюджета — не создаём (подсказка объединить); история — по байтам.
  function budget(o = {}){
    const tex = o.maxTex > 0 ? o.maxTex : 4096;
    const mem = o.devMem > 0 ? o.devMem : (o.phone ? 3 : 8);
    if (o.phone) {   // слой 12 Мп = 48 МБ (+ копия на видеокарте): на телефоне — до 3 таких слоёв (6 на 4+ ГБ) и история 64/96 МБ
      const big = mem >= 4;
      return { maxSide: Math.min(4096, tex), maxPixels: 12.6e6, totalPixels: big ? 36e6 : 24e6, undoBytes: big ? 96e6 : 64e6, exportMax: 4096 };
    }
    return { maxSide: Math.min(8192, tex), maxPixels: 40e6, totalPixels: mem >= 8 ? 240e6 : 140e6, undoBytes: mem >= 8 ? 600e6 : 320e6, exportMax: Math.min(8192, tex) };
  }
  // Влезть в maxSide и maxPixels с сохранением пропорций → { w, h, k, scaled }
  function fitSize(w, h, maxSide, maxPixels){
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    let k = Math.min(1, maxSide / Math.max(w, h));
    if (maxPixels && w * h * k * k > maxPixels) k = Math.min(k, Math.sqrt(maxPixels / (w * h)));
    if (k >= 1) return { w, h, k: 1, scaled: false };
    return { w: Math.max(1, Math.floor(w * k)), h: Math.max(1, Math.floor(h * k)), k, scaled: true };
  }
  // Самая большая рамка пропорции 'a:b' по центру документа
  const ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '4:5', '5:4', '21:9'];
  function aspectRect(W, H, asp){
    const m = /^(\d{1,3}):(\d{1,3})$/.exec(String(asp || '')); if (!m) return null;
    const r = (+m[1]) / (+m[2]); if (!(r > 0)) return null;
    let w = W, h = Math.round(W / r);
    if (h > H) { h = H; w = Math.round(H * r); }
    return { x: Math.floor((W - w) / 2), y: Math.floor((H - h) / 2), w: Math.max(1, w), h: Math.max(1, h) };
  }
  // Рамку — в пределы документа (целые пиксели); пустая — null
  function clipRect(r, W, H){
    const x0 = clamp(Math.round(r.x), 0, W), y0 = clamp(Math.round(r.y), 0, H);
    const x1 = clamp(Math.round(r.x + r.w), 0, W), y1 = clamp(Math.round(r.y + r.h), 0, H);
    return x1 - x0 >= 1 && y1 - y0 >= 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  // ═══ Автоулучшение: по статистике слоя (photo-worker.js stats) → значения коррекций ═══
  // Уровни: 0,5 % и 99,5 % яркости растягиваем к краям (через яркость + контраст fabric: contrastF = 259(C+255)/(255(259−C)),
  // C = контраст·255); баланс белого — по среднему цвету середины (теплее/холоднее); блёклое — чуть насыщеннее.
  function autoParams(st){
    const out = { brightness: 0, contrast: 0, saturation: 0, vibrance: 0, temperature: 0 };
    if (!st || !st.n) return out;
    const pct = q => { let acc = 0; const lim = st.n * q; for (let i = 0; i < 256; i++) { acc += st.hist[i]; if (acc >= lim) return i; } return 255; };
    const lo = pct(0.005), hi = pct(0.995), mid = (lo + hi) / 2, span = Math.max(16, hi - lo);
    const f = clamp(255 / span, 1, 1.9);                       // во сколько раз растянуть
    const C = 66045 * (f - 1) / (259 + 255 * f);               // обратная формула контраста fabric
    out.contrast = Math.round(clamp(C / 255 / 0.6 * 100, 0, 60));
    out.brightness = Math.round(clamp((128 - mid) / 255 / 0.6 * 100, -35, 35));
    const [r, , b] = st.avg, t = (b - r) / Math.max(1, b + r);   // синее среднего — теплее, краснее — холоднее
    out.temperature = Math.round(clamp(t / 0.16 * 100 * 0.8, -40, 40));
    if (st.sat < 0.18) { out.saturation = 15; out.vibrance = 25; } else if (st.sat < 0.3) out.vibrance = 15;
    return out;
  }

  // ═══ Проект «.d37photo» — вся работа со слоями одним файлом (черновик при уходе из редактора, «Сохранить проект») ═══
  // Файл: 8 байт 'D37PHOT1' + длина JSON (4 байта, little-endian) + JSON (UTF-8) + картинки слоёв подряд (PNG; нетронутое фото —
  // своим исходным JPEG/WebP). JSON: { v: 1, w, h, name, active (номер слоя по порядку), layers: [{ t: 'raster', name, locked,
  // p, adj, preset, cw, ch, mime, part: [сдвиг, длина] } | { t: 'text', name, locked, p }] }. Чужой файл проверяется целиком:
  // берутся только известные поля, числа — в разумных пределах (файл из интернета не подсунет ни лишнего, ни гигантского).
  const PROJ_MAGIC = 'D37PHOT1', PROJ_MAX_JSON = 2e6, PROJ_MAX_LAYERS = 80, PROJ_MAX_SIDE = 16384;
  const PROJ_MIME = ['image/png', 'image/jpeg', 'image/webp'];
  const P_NUM = { left: [-1e6, 1e6], top: [-1e6, 1e6], angle: [-36000, 36000], scaleX: [-1000, 1000], scaleY: [-1000, 1000], opacity: [0, 1],
    skewX: [-89, 89], skewY: [-89, 89], fontSize: [1, 2000], strokeWidth: [0, 200] };
  const P_TEXT_NUM = ['fontSize', 'strokeWidth'];
  const P_ENUM = { fontWeight: ['normal', 'bold'], fontStyle: ['normal', 'italic'], textAlign: ['left', 'center', 'right', 'justify'] };
  const BLEND_OPS = Object.values(BLENDS);
  const perr = m => Object.assign(new Error('Проект не открылся: ' + m), { user: true });
  const cleanStr = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').slice(0, n);
  function cleanProps(p, text){
    const o = {}; if (!p || typeof p !== 'object') return o;
    for (const k in P_NUM) {
      if (p[k] == null || (!text && P_TEXT_NUM.includes(k))) continue;
      const v = +p[k]; if (Number.isFinite(v)) o[k] = clamp(v, P_NUM[k][0], P_NUM[k][1]);
    }
    if (o.scaleX === 0) o.scaleX = 1; if (o.scaleY === 0) o.scaleY = 1;
    for (const k of ['flipX', 'flipY', 'visible']) if (typeof p[k] === 'boolean') o[k] = p[k];
    if (BLEND_OPS.includes(p.globalCompositeOperation)) o.globalCompositeOperation = p.globalCompositeOperation;
    if (!text) return o;
    if (typeof p.text === 'string') o.text = p.text.slice(0, 500) || ' ';
    if (FONT_NAMES.includes(p.fontFamily)) o.fontFamily = p.fontFamily;
    for (const k in P_ENUM) if (P_ENUM[k].includes(p[k])) o[k] = p[k];
    for (const k of ['fill', 'stroke']) { const c = color(p[k]); if (c) o[k] = c; }
    const s = p.shadow;
    if (s === null) o.shadow = null;
    else if (s && typeof s === 'object') {
      const n = (v, a, b) => clamp(Number.isFinite(+v) ? +v : 0, a, b);
      o.shadow = { color: color(s.color) || '#0000008c', blur: n(s.blur, 0, 500), offsetX: n(s.offsetX, -1000, 1000), offsetY: n(s.offsetY, -1000, 1000) };
    }
    return o;
  }
  function cleanLayer(l, size){
    if (!l || typeof l !== 'object') throw perr('слой — не объект');
    const name = cleanStr(l.name, 60) || 'Слой';
    if (l.t === 'text') return { t: 'text', name, locked: !!l.locked, p: cleanProps(l.p, true) };
    if (l.t !== 'raster') throw perr('неизвестный вид слоя');
    const cw = +l.cw, ch = +l.ch;
    if (!(Number.isInteger(cw) && Number.isInteger(ch) && cw >= 1 && ch >= 1 && cw <= PROJ_MAX_SIDE && ch <= PROJ_MAX_SIDE)) throw perr('размер слоя');
    const pt = Array.isArray(l.part) ? l.part : [], off = +pt[0], len = +pt[1];
    if (!(Number.isInteger(off) && Number.isInteger(len) && off >= 0 && len > 0 && off + len <= size)) throw perr('картинка слоя за пределами файла');
    const adj = {};
    if (l.adj && typeof l.adj === 'object') for (const k of ADJ_KEYS) { const v = +l.adj[k]; if (Number.isFinite(v) && v) adj[k] = clamp(v, ADJ[k].min, ADJ[k].max); }
    const preset = Object.prototype.hasOwnProperty.call(PRESETS, l.preset) ? l.preset : 'none';
    const mime = PROJ_MIME.includes(l.mime) ? l.mime : 'image/png';
    return { t: 'raster', name, locked: !!l.locked, p: cleanProps(l.p, false), adj, preset, cw, ch, mime, part: [off, len] };
  }
  // meta.layers[i].part — номер картинки в parts (Blob) или нет у надписи → Blob файла
  function packProject(meta, parts){
    let off = 0; const refs = parts.map(b => { const r = [off, b.size]; off += b.size; return r; });
    const layers = meta.layers.map(l => (l.t === 'raster' ? Object.assign({}, l, { part: refs[l.part] }) : l));
    const json = new TextEncoder().encode(JSON.stringify(Object.assign({}, meta, { v: 1, app: 'd37photo', layers })));
    const head = new Uint8Array(12), n = json.length;
    for (let i = 0; i < 8; i++) head[i] = PROJ_MAGIC.charCodeAt(i);
    head[8] = n & 255; head[9] = (n >>> 8) & 255; head[10] = (n >>> 16) & 255; head[11] = (n >>> 24) & 255;
    return new Blob([head, json].concat(parts), { type: 'application/x-d37photo' });
  }
  async function isProject(blob){
    if (!blob || typeof blob.size !== 'number' || blob.size < 12) return false;
    const b = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    return String.fromCharCode.apply(null, Array.from(b)) === PROJ_MAGIC;
  }
  // Blob файла → { meta (проверенный), part(слой) → Blob картинки }; ошибка — понятным текстом
  async function readProject(blob){
    if (!blob || typeof blob.size !== 'number' || blob.size < 16) throw perr('файл пустой');
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (String.fromCharCode.apply(null, Array.from(head.subarray(0, 8))) !== PROJ_MAGIC) throw perr('это не проект фоторедактора (.d37photo)');
    const n = (head[8] | (head[9] << 8) | (head[10] << 16) | (head[11] << 24)) >>> 0;
    if (!(n > 1 && n <= PROJ_MAX_JSON && 12 + n <= blob.size)) throw perr('заголовок повреждён');
    let m; try { m = JSON.parse(await blob.slice(12, 12 + n).text()); } catch (e) { throw perr('описание повреждено'); }
    if (!m || typeof m !== 'object' || m.v !== 1) throw perr('другая версия проекта — обнови страницу');
    const w = +m.w, h = +m.h;
    if (!(Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1 && w <= PROJ_MAX_SIDE && h <= PROJ_MAX_SIDE)) throw perr('размер документа');
    if (!Array.isArray(m.layers) || !m.layers.length || m.layers.length > PROJ_MAX_LAYERS) throw perr('нет слоёв или их слишком много');
    const data = blob.slice(12 + n), layers = m.layers.map(l => cleanLayer(l, data.size));
    const active = Number.isInteger(m.active) && m.active >= 0 && m.active < layers.length ? m.active : layers.length - 1;
    return { meta: { v: 1, w, h, name: cleanStr(m.name, 60), active, layers },
      part: l => data.slice(l.part[0], l.part[0] + l.part[1], l.mime) };
  }

  // ═══ Схемы команд «d37 v1» инструмента photo ═══
  const LAYER = { type: ['integer', 'string'], description: 'номер слоя из info или "active" (выбранный)', default: 'active' };
  const COLOR = { type: 'string', pattern: COLOR_RE, description: 'цвет: #rrggbb, rgba(…) или название (red, жёлтый…)' };
  const INT = (a, b, d) => Object.assign({ type: 'integer', minimum: a, maximum: b }, d ? { description: d } : {});
  const NUM = (a, b, d) => Object.assign({ type: 'number', minimum: a, maximum: b }, d ? { description: d } : {});
  const ADJ_PROPS = {}; for (const k of ADJ_KEYS) ADJ_PROPS[k] = NUM(ADJ[k].min, ADJ[k].max, ADJ[k].ru);
  const obj = (props, req) => ({ type: 'object', properties: props, required: req || [], additionalProperties: false });
  const TEXT_PROPS = {
    text: { type: 'string', minLength: 1, maxLength: 500 },
    x: NUM(-20000, 20000, 'центр надписи по X, пиксели; нет — по центру'), y: NUM(-20000, 20000, 'центр по Y; нет — по центру'),
    size: NUM(6, 1000, 'размер шрифта, пиксели'), color: COLOR, font: { type: 'string', enum: FONT_NAMES },
    bold: { type: 'boolean' }, italic: { type: 'boolean' }, stroke: COLOR, strokeWidth: NUM(0, 60, 'обводка, пиксели'),
    align: { type: 'string', enum: ['left', 'center', 'right'] }, shadow: { type: 'boolean', description: 'тень под буквами' },
    angle: NUM(-360, 360), name: { type: 'string', maxLength: 60 },
  };
  const SCHEMAS = {
    info:       { title: 'Что открыто: размер, слои, выбранный слой', args: obj({}) },
    new:        { title: 'Новый пустой документ', undoable: true, args: obj({ w: INT(16, 8192), h: INT(16, 8192), bg: { type: 'string', pattern: COLOR_RE, default: '#ffffff', description: 'фон; transparent — прозрачный' }, name: { type: 'string', maxLength: 60 } }, ['w', 'h']) },
    open:       { title: 'Открыть картинку или проект со слоями из «Моих материалов» вместо текущей работы', undoable: true, args: obj({ asset: { type: 'string', pattern: '^a[a-z0-9]{6,30}$' } }, ['asset']) },
    place:      { title: 'Добавить картинку из «Моих материалов» новым слоем', undoable: true, args: obj({ asset: { type: 'string', pattern: '^a[a-z0-9]{6,30}$' }, x: NUM(-20000, 20000), y: NUM(-20000, 20000), scale: NUM(0.01, 20), name: { type: 'string', maxLength: 60 } }, ['asset']) },
    crop:       { title: 'Обрезать: рамка x, y, w, h ИЛИ пропорция aspect по центру', undoable: true, args: obj({ x: INT(-20000, 20000), y: INT(-20000, 20000), w: INT(1, 20000), h: INT(1, 20000), aspect: { type: 'string', enum: ASPECTS } }),
      check: a => (a.aspect ? (a.x != null || a.w != null ? 'или aspect, или x/y/w/h' : '') : (a.w == null || a.h == null ? 'нужна рамка w и h (и x, y) или aspect' : '')) },
    resize:     { title: 'Размер изображения (пересчитать пиксели); одно из w / h — пропорционально', undoable: true, args: obj({ w: INT(16, 16384), h: INT(16, 16384), scale: NUM(0.02, 8, 'во сколько раз') }),
      check: a => (a.w == null && a.h == null && a.scale == null ? 'нужно w, h или scale' : '') },
    rotate:     { title: 'Повернуть всё изображение на 90/180°', undoable: true, args: obj({ deg: { type: 'integer', enum: [90, -90, 180, 270] } }, ['deg']) },
    flip:       { title: 'Отразить всё изображение или один слой', undoable: true, args: obj({ axis: { type: 'string', enum: ['h', 'v'], description: 'h — слева направо, v — сверху вниз' }, layer: Object.assign({}, LAYER, { default: undefined, description: 'нет — отразить всё изображение' }) }, ['axis']) },
    adjust:     { title: 'Коррекция слоя (без потери качества, можно поменять позже); 0 — без изменения', undoable: true, args: obj(Object.assign({ layer: LAYER, reset: { type: 'boolean', description: 'сначала всё в 0' } }, ADJ_PROPS)) },
    filter:     { title: 'Готовый фильтр слоя', undoable: true, args: obj({ layer: LAYER, preset: { type: 'string', enum: Object.keys(PRESETS) } }, ['preset']) },
    auto:       { title: 'Автоулучшение: яркость, контраст и цвет по гистограмме', undoable: true, args: obj({ layer: LAYER }) },
    removeBg:   { title: 'Убрать фон (ИИ в браузере): остаётся главный предмет или человек, фон — прозрачный', undoable: true, args: obj({ layer: LAYER }) },
    text:       { title: 'Новая надпись (слой текста)', undoable: true, args: obj(TEXT_PROPS, ['text']) },
    textEdit:   { title: 'Изменить надпись', undoable: true, args: obj(Object.assign({ layer: LAYER }, TEXT_PROPS, { text: { type: 'string', minLength: 1, maxLength: 500 } })) },
    layerNew:   { title: 'Новый пустой слой для рисования', undoable: true, args: obj({ name: { type: 'string', maxLength: 60 }, fill: COLOR }) },
    layer:      { title: 'Свойства слоя: имя, видимость, прозрачность, наложение, место, масштаб, поворот', undoable: true,
      args: obj({ layer: LAYER, name: { type: 'string', minLength: 1, maxLength: 60 }, visible: { type: 'boolean' }, locked: { type: 'boolean', description: 'закреплён: рукой не сдвинуть' }, opacity: INT(0, 100, 'непрозрачность, %'),
        blend: { type: 'string', enum: Object.keys(BLENDS) }, x: NUM(-20000, 20000, 'центр по X'), y: NUM(-20000, 20000, 'центр по Y'), scale: NUM(0.01, 20), angle: NUM(-360, 360) }) },
    layerOrder: { title: 'Переставить слой', undoable: true, args: obj({ layer: LAYER, to: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] } }, ['to']) },
    layerDup:   { title: 'Копия слоя', undoable: true, args: obj({ layer: LAYER }) },
    layerDelete:{ title: 'Удалить слой', undoable: true, args: obj({ layer: LAYER }) },
    layerMerge: { title: 'Объединить слой с нижним', undoable: true, args: obj({ layer: LAYER }) },
    flatten:    { title: 'Свести все видимые слои в один', undoable: true, args: obj({}) },
    select:     { title: 'Выбрать слой', args: obj({ layer: LAYER }) },
    fill:       { title: 'Залить слой цветом', undoable: true, args: obj({ layer: LAYER, color: COLOR }, ['color']) },
    draw:       { title: 'Провести кистью (или ластиком) по точкам', undoable: true,
      args: obj({ layer: LAYER, points: { type: 'array', minItems: 1, maxItems: 4000, items: { type: 'array', minItems: 2, maxItems: 2, items: NUM(-20000, 20000) }, description: '[[x, y], …] в пикселях картинки' },
        size: NUM(1, 1000, 'толщина'), color: COLOR, opacity: INT(1, 100), hardness: INT(0, 100), erase: { type: 'boolean' } }, ['points']) },
    export:     { title: 'Сохранить картинку: скачать, в «Мои материалы» или в «Студию 3D»', args: obj({
        format: { type: 'string', enum: ['png', 'jpeg', 'webp'], default: 'png' }, quality: INT(1, 100), scale: NUM(0.02, 1, 'размер от исходного'),
        maxSide: INT(16, 16384, 'длинная сторона не больше'), to: { type: 'string', enum: ['assets', 'download', 'studio3d'], default: 'assets' }, name: { type: 'string', maxLength: 60 } }) },
    undo:       { title: 'Отменить последний шаг', args: obj({}) },
    redo:       { title: 'Вернуть отменённый шаг', args: obj({}) },
  };
  const DESCRIBE = 'Фоторедактор сайта: документ (холст) w×h пикселей, слои снизу вверх — картинки (raster) и надписи (text). ' +
    'Координаты — в пикселях документа, (0,0) — левый верхний угол; x, y у слоя — его центр. Коррекции и фильтры не портят пиксели — их можно менять. ' +
    'Номера слоёв — из команды info (поле layers[].id); "active" — выбранный слой. Картинки для open/place — номера из «Моих материалов» (export … to: "assets" возвращает asset).';

  const api = { NAMED, color, COLOR_RE, FONTS, FONT_NAMES, isGoogleFont, hasBold, BLENDS, BLEND_RU, ADJ, ADJ_KEYS, PRESETS, PRESET_CLASS, filterSpecs,
    budget, fitSize, ASPECTS, aspectRect, clipRect, autoParams, SCHEMAS, DESCRIBE, clamp,
    PROJ_MAGIC, PROJ_MAX_LAYERS, packProject, readProject, isProject, cleanProps };
  root.D37PhotoCmds = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
