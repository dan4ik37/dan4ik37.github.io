// ═══════════════════════════════════════
//  🖼 ФОТОРЕДАКТОР — движок (D37PhotoCore): документ, слои, история, кисть и ластик, коррекции, экспорт, команды «d37 v1»
// ═══════════════════════════════════════
// Основа — fabric.js 7.4.0 (MIT, jsDelivr; та же основа, что у TOAST UI Image Editor): объекты-слои, рамки с ручками
// (двигать, масштабировать, вращать — и пальцем), надписи, фильтры на видеокарте (WebGL), рисование кадра. Своё: документ
// и слои, история «Отменить» с бюджетом памяти, растровая кисть/ластик (отмена — кусками 256×256, копией на видеокарте, без
// чтения пикселей), обрезка, размер, поворот, экспорт в полный размер, жесты (щипок, два пальца), команды для кнопок и ИИ.
// Тяжёлое (открыть и уменьшить фото, PNG/JPEG/WebP, статистика) — photo-worker.js; нет потока — то же в странице.
// E = D37PhotoCore.create(hostEl, { onEvent }) → редактор; E.exec(cmd, args) — команда (D37Tools.run('photo', …)); E.dispose().
(function (root) {
  'use strict';
  const PC = root.D37PhotoCmds;
  const TILE = 256;
  const ACCENT = '#7c5cff';
  const isPhone = () => { try { return matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent); } catch (e) { return false; } };
  const userErr = m => Object.assign(new Error(m), { user: true });
  const clamp = PC.clamp;
  let glMax = 0;
  function maxTexture(){
    if (glMax) return glMax;
    try { const c = document.createElement('canvas'), gl = c.getContext('webgl'); glMax = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 4096; const ext = gl && gl.getExtension('WEBGL_lose_context'); ext && ext.loseContext(); }
    catch (e) { glMax = 4096; }
    return glMax || 4096;
  }

  // ═══ Поток (photo-worker.js) с запасным путём в странице ═══
  function makeWorker(url, fabricUrl){
    let w = null, seq = 0, broken = false; const wait = new Map();
    const can = typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined' && !!url;
    // поток создаётся при первой работе; recycle() — закрыть после тяжёлой работы (на телефоне память отдаётся сразу)
    function spawnW(){
      if (w || broken || !can) return w;
      try {
        w = new Worker(url);
        w.onmessage = e => { const p = wait.get(e.data.id); if (!p) return; wait.delete(e.data.id); e.data.ok ? p.res(e.data.out) : p.rej(new Error(e.data.error)); };
        w.onerror = () => { for (const p of wait.values()) p.rej(new Error('Поток фоторедактора упал')); wait.clear(); try { w.terminate(); } catch (er) {} w = null; };
      } catch (e) { w = null; broken = true; }
      return w;
    }
    const local = {   // то же самое в странице (старый iPhone, ошибка потока)
      async decode(d){
        const bmp = await createImageBitmap(d.blob, { imageOrientation: 'from-image' });
        const f = PC.fitSize(bmp.width, bmp.height, d.maxSide, d.maxPixels);
        if (!f.scaled) return { bitmap: bmp, w0: bmp.width, h0: bmp.height, w: bmp.width, h: bmp.height, scaled: false };
        const s = await createImageBitmap(bmp, { resizeWidth: f.w, resizeHeight: f.h, resizeQuality: 'high' });
        const r = { bitmap: s, w0: bmp.width, h0: bmp.height, w: f.w, h: f.h, scaled: true }; bmp.close(); return r;
      },
      async resample(d){ const b = await createImageBitmap(d.bitmap, { resizeWidth: d.w, resizeHeight: d.h, resizeQuality: 'high' }); d.bitmap.close(); return { bitmap: b }; },
      async encode(d){
        const c = document.createElement('canvas'); c.width = d.bitmap.width; c.height = d.bitmap.height;
        const g = c.getContext('2d'); if (d.bg) { g.fillStyle = d.bg; g.fillRect(0, 0, c.width, c.height); } g.drawImage(d.bitmap, 0, 0); d.bitmap.close();
        const blob = await new Promise(res => c.toBlob(res, d.type, d.quality)); c.width = c.height = 0;
        if (!blob) throw userErr('Не получилось сохранить картинку'); return { blob };
      },
      async filter(d){
        const F = root.fabric, c = document.createElement('canvas'); c.width = d.bitmap.width; c.height = d.bitmap.height;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(d.bitmap, 0, 0); d.bitmap.close();
        const st = { imageData: g.getImageData(0, 0, c.width, c.height), ctx: g, canvasEl: c, sourceWidth: c.width, sourceHeight: c.height };
        st.originalImageData = st.imageData;
        for (const [cls, o] of d.specs || []) new F.filters[cls](o).applyTo(st);
        g.putImageData(st.imageData, 0, 0);
        const bitmap = await createImageBitmap(c); c.width = c.height = 0;
        return { bitmap };
      },
      async stats(d){
        const c = document.createElement('canvas'); c.width = d.bitmap.width; c.height = d.bitmap.height;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(d.bitmap, 0, 0); d.bitmap.close();
        const px = g.getImageData(0, 0, c.width, c.height).data, hist = new Array(256).fill(0); let n = 0, sr = 0, sg = 0, sb = 0, mid = 0, sat = 0;
        for (let i = 0; i < px.length; i += 4) { if (px[i + 3] < 128) continue; const r = px[i], gg = px[i + 1], b = px[i + 2], y = (r * 54 + gg * 183 + b * 19) >> 8; hist[y]++; n++; const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); sat += mx ? (mx - mn) / mx : 0; if (y > 40 && y < 215) { sr += r; sg += gg; sb += b; mid++; } }
        return { hist, n, avg: mid ? [sr / mid, sg / mid, sb / mid] : [128, 128, 128], sat: n ? sat / n : 0 };
      },
    };
    return {
      get threaded(){ return can && !broken; },
      run(job, data, transfer){
        if (job === 'filter') data.fabricUrl = fabricUrl;
        if (!spawnW() || (job === 'filter' && !fabricUrl)) return local[job](data);
        return new Promise((res, rej) => {
          const id = ++seq; wait.set(id, { res, rej });
          try { w.postMessage({ id, job, data }, transfer || []); } catch (e) { wait.delete(id); local[job](data).then(res, rej); }
        });
      },
      local: (job, data) => local[job](data),   // запасной путь: поток упал или не загрузил fabric (нет сети)
      recycle(){ if (w && !wait.size) { try { w.terminate(); } catch (e) {} w = null; } },
      close(){ try { w && w.terminate(); } catch (e) {} w = null; broken = true; for (const p of wait.values()) p.rej(new Error('closed')); wait.clear(); },
    };
  }

  // ═══ Редактор ═══
  function create(host, opts = {}){
    const F = root.fabric;
    if (!F || !F.Canvas) throw userErr('Не загрузилась основа редактора (fabric.js)');
    const phone = isPhone();
    const B = PC.budget({ phone, devMem: navigator.deviceMemory || 0, maxTex: maxTexture() });
    // сторона копии слоя для экрана (коррекции на видеокарте): телефон — 1536 (экран ~1080 пикселей шириной; память фильтров
    // ~4× меньше, чем у 3072), компьютер — 4096 (12 Мп показываются почти в полный размер)
    const PREV = Math.min(maxTexture(), phone ? 1536 : 4096);
    try { F.config.configure({ textureSize: PREV }); } catch (e) {}
    const W = makeWorker(opts.workerUrl, opts.fabricUrl);
    const subs = new Set(opts.onEvent ? [opts.onEvent] : []);
    const emit = (type, d) => subs.forEach(f => { try { f(type, d); } catch (e) { console.error(e); } });
    const toast = (msg, kind) => emit('toast', { msg, kind: kind || 'info' });

    // ── холст fabric ──
    const el = document.createElement('canvas');
    host.appendChild(el);
    const cv = new F.Canvas(el, {
      width: Math.max(50, host.clientWidth), height: Math.max(50, host.clientHeight),
      preserveObjectStacking: true, selection: false, stopContextMenu: true, fireRightClick: false,
      renderOnAddRemove: false, skipOffscreen: true, uniformScaling: true, targetFindTolerance: phone ? 12 : 6,
      enableRetinaScaling: true, backgroundColor: '',
    });
    const CTRL = { cornerSize: 12, touchCornerSize: 38, transparentCorners: false, cornerStyle: 'circle', cornerColor: '#ffffff',
      cornerStrokeColor: ACCENT, borderColor: ACCENT, borderScaleFactor: 1.6, padding: 0 };

    // ── документ ──
    const doc = { w: 1280, h: 720, bg: '#ffffff', name: 'Без названия', layers: [], active: null, seq: 0 };
    let tool = 'move', dirty = false, disposed = false, paused = false, queue = Promise.resolve(), busyN = 0;
    const brush = { size: 24, color: '#ff3b5c', opacity: 100, hardness: 80 };
    const layerById = id => doc.layers.find(L => L.id === id) || null;
    const activeLayer = () => layerById(doc.active);
    function resolveLayer(ref, need){
      const L = ref === undefined || ref === null || ref === 'active' ? activeLayer() : layerById(typeof ref === 'string' ? parseInt(ref, 10) : ref);
      if (!L) throw userErr(doc.layers.length ? 'Нет такого слоя (номера — в info)' : 'Сначала открой или создай картинку');
      if (need && L.type !== need) throw userErr(need === 'raster' ? 'Это надпись, а нужен слой-картинка' : 'Это не надпись');
      return L;
    }
    const rasterPixels = () => doc.layers.reduce((s, L) => s + (L.type === 'raster' ? L.canvas.width * L.canvas.height : 0), 0);
    function canHold(px){ if (rasterPixels() + px > B.totalPixels) throw userErr('Мало памяти этого устройства для ещё одного большого слоя — объедини или удали слои, или уменьши картинку (Размер)'); }
    const setDirty = () => { dirty = true; emit('dirty', true); };
    function busy(on, text){ busyN = Math.max(0, busyN + (on ? 1 : -1)); emit('busy', { on: busyN > 0, text: text || '' }); }

    // ── слои ──
    function canvasOf(w, h){ const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
    function styleObj(o){ o.set(CTRL); o.setControlsVisibility && o.setControlsVisibility({ mtr: true }); return o; }
    function mkRaster(canvas, o = {}){
      // o.id — тот же номер, что у слоя, который этот заменяет (размер, объединить): ссылки ИИ на номера не ломаются
      const L = { id: o.id || ++doc.seq, type: 'raster', name: o.name || 'Слой ' + (doc.seq), canvas, adj: {}, preset: 'none', rev: 0, pxRev: 0, proxy: null, proxyRev: -1, filt: null, fkey: '' };
      // без кэша fabric: картинка и так рисуется видеокартой из своего холста, а кэш — до 8 МБ лишней памяти на каждый слой
      L.obj = styleObj(new F.FabricImage(canvas, { left: o.x != null ? o.x : doc.w / 2, top: o.y != null ? o.y : doc.h / 2, originX: 'center', originY: 'center',
        scaleX: o.scale || 1, scaleY: o.scale || 1, objectCaching: false }));
      L.obj.d37id = L.id;
      return L;
    }
    // Нетронутое фото слоя — его исходный файл (JPEG/PNG/WebP): проект хранит его, а не PNG (в разы меньше, без пересжатия)
    const SRC_MIME = ['image/jpeg', 'image/png', 'image/webp'];
    function keepSrc(L, blob){ if (blob && SRC_MIME.includes(blob.type) && blob.size > 0 && blob.size < L.canvas.width * L.canvas.height * 4) L.src = { blob, rev: L.pxRev, mime: blob.type }; }
    function textProps(a, base){
      const p = {};
      if (a.text != null) p.text = String(a.text).slice(0, 500);
      if (a.size != null) p.fontSize = clamp(+a.size, 6, 1000);
      if (a.color != null) { const c = PC.color(a.color); if (!c) throw userErr('Не понял цвет: ' + a.color); p.fill = c; }
      if (a.font != null) p.fontFamily = a.font;
      if (a.bold != null) p.fontWeight = a.bold ? 'bold' : 'normal';
      if (a.italic != null) p.fontStyle = a.italic ? 'italic' : 'normal';
      if (a.stroke != null) { const c = PC.color(a.stroke); if (!c) throw userErr('Не понял цвет обводки: ' + a.stroke); p.stroke = c; }
      if (a.strokeWidth != null) p.strokeWidth = clamp(+a.strokeWidth, 0, 60);
      if (a.align != null) p.textAlign = a.align;
      if (a.angle != null) p.angle = +a.angle;
      if (a.shadow != null) { const fs = p.fontSize || (base && base.fontSize) || 64; p.shadow = a.shadow ? new F.Shadow({ color: 'rgba(0,0,0,0.55)', blur: Math.round(fs * 0.12), offsetX: Math.round(fs * 0.05), offsetY: Math.round(fs * 0.05) }) : null; }
      return p;
    }
    function mkText(a){
      const L = { id: a.id || ++doc.seq, type: 'text', name: a.name || 'Надпись', rev: 0 };
      const size = a.size != null ? +a.size : Math.max(16, Math.round(Math.min(doc.w, doc.h) / 9));
      const p = Object.assign({ fontFamily: 'Montserrat', fontSize: size, fill: '#ffffff', stroke: '#000000', strokeWidth: Math.max(1, Math.round(size / 14)),
        fontWeight: 'bold', textAlign: 'center', paintFirst: 'stroke', strokeLineJoin: 'round' }, textProps(Object.assign({ size }, a)));
      L.obj = styleObj(new F.IText(p.text || 'Текст', Object.assign({ left: a.x != null ? a.x : doc.w / 2, top: a.y != null ? a.y : doc.h / 2,
        originX: 'center', originY: 'center', editable: !phone, objectCaching: true }, p)));
      L.obj.d37id = L.id;
      if (a.name == null) L.name = 'Т: ' + String(L.obj.text).slice(0, 18);
      fontReady(L);
      return L;
    }
    // Шрифт Google Fonts: подключить CSS один раз, дождаться загрузки и перерисовать надпись
    const fontsAsked = new Set();
    function fontReady(L){
      const fam = L.obj.fontFamily;
      if (!PC.isGoogleFont(fam) || !document.fonts) return;
      if (!fontsAsked.has(fam)) {
        fontsAsked.add(fam);
        const l = document.createElement('link'); l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(fam).replace(/%20/g, '+') + (PC.hasBold(fam) ? ':wght@400;700' : '') + '&display=swap';
        document.head.appendChild(l);
      }
      Promise.all([document.fonts.load(`400 40px "${fam}"`, 'АаZz'), document.fonts.load(`700 40px "${fam}"`, 'АаZz')]).then(() => {
        if (disposed) return;
        try { F.cache && F.cache.clearFontCache && F.cache.clearFontCache(fam); } catch (e) {}
        for (const T of doc.layers) if (T.type === 'text' && T.obj.fontFamily === fam) { T.obj.initDimensions && T.obj.initDimensions(); T.obj.setCoords(); T.obj.dirty = true; }
        cv.requestRenderAll(); emit('layers');
      }, () => {});
    }
    function attach(L, index){
      const i = index == null ? doc.layers.length : clamp(index, 0, doc.layers.length);
      doc.layers.splice(i, 0, L);
      cv.insertAt(i, L.obj);
      L.dead = false;
      if (L.type === 'raster' && !L.filt && hasAdj(L)) applyFilters(L, true);   // вернулся из истории — коррекции заново
    }
    // Слой ушёл из документа (в историю): копия для экрана и фильтры не нужны — память сразу назад
    function detach(L){
      const i = doc.layers.indexOf(L); if (i < 0) return -1;
      doc.layers.splice(i, 1); cv.remove(L.obj);
      if (L.type === 'raster' && L.filt) { dropFilt(L); L.obj._element = L.canvas; L.obj._filterScalingX = L.obj._filterScalingY = 1; }
      if (doc.active === L.id) doc.active = (doc.layers[Math.min(i, doc.layers.length - 1)] || {}).id || null;
      return i;
    }
    // Освободить память слоя, которого больше нет ни в документе, ни в истории
    function release(L){
      if (!L || L.dead || doc.layers.includes(L)) return;
      L.dead = true; L.src = null;
      if (L.type === 'raster') dropFilt(L);
      try { L.obj.dispose && L.obj.dispose(); } catch (e) {}
      if (L.canvas) { L.canvas.width = L.canvas.height = 0; L.canvas = null; }
    }
    // холст стоит ~2× своих пикселей (страница + видеокарта; замер 22.10: 200 кусков по 256² — +107 МБ на 50 МБ пикселей)
    const rasterBytes = list => list.reduce((s, L) => s + (L.type === 'raster' && L.canvas ? L.canvas.width * L.canvas.height * 8 : 1024), 0);

    // ── история ──
    const hist = { done: [], undone: [], bytes: 0, seq: 0 };   // seq — сколько шагов записано всего (для ctx.steps у D37Tools)
    let baseSeq = 0;   // seq, когда работу открыли / создали / сохранили: больше — есть несохранённая работа (черновик при уходе)
    function dropRedo(){
      for (const e of hist.undone) { hist.bytes -= e.bytes || 0; try { e.free && e.free('redo'); } catch (er) {} }
      hist.undone = [];
    }
    function push(entry){
      dropRedo();
      entry.bytes = entry.bytes || 256;
      if (entry.bytes > B.undoBytes) {   // один шаг больше всего бюджета: не храним (и честно говорим)
        try { entry.free && entry.free('drop'); } catch (er) {}
        toast('Этот шаг нельзя будет отменить: мало памяти устройства', 'warn');
      } else {
        hist.done.push(entry); hist.bytes += entry.bytes; hist.seq++;
        while ((hist.bytes > B.undoBytes || hist.done.length > 80) && hist.done.length > 1) {
          const old = hist.done.shift(); hist.bytes -= old.bytes || 0; try { old.free && old.free('drop'); } catch (er) {}
        }
      }
      setDirty(); emit('history', histState());
    }
    const histState = () => ({ undo: hist.done.length, redo: hist.undone.length, label: hist.done.length ? hist.done[hist.done.length - 1].label : '', bytes: hist.bytes });
    async function undo(){ const e = hist.done.pop(); if (!e) return false; hist.bytes -= e.bytes || 0; await e.undo(); hist.undone.push(e); hist.bytes += e.bytes || 0; afterChange(); emit('history', histState()); return true; }
    async function redo(){ const e = hist.undone.pop(); if (!e) return false; await e.redo(); hist.done.push(e); afterChange(); emit('history', histState()); return true; }
    function afterChange(){ setDirty(); syncTool(); cv.requestRenderAll(); emit('layers'); emit('doc', docInfo()); }

    // Снимки свойств слоя (для отмены перемещения, прозрачности, коррекций…)
    const PROPS = ['left', 'top', 'angle', 'scaleX', 'scaleY', 'flipX', 'flipY', 'opacity', 'visible', 'globalCompositeOperation', 'skewX', 'skewY'];
    const TPROPS = ['text', 'fontFamily', 'fontSize', 'fill', 'stroke', 'strokeWidth', 'fontWeight', 'fontStyle', 'textAlign', 'shadow'];
    function snapL(L){
      const s = { name: L.name, locked: !!L.locked, p: {} };
      for (const k of PROPS) s.p[k] = L.obj[k];
      if (L.type === 'raster') { s.adj = Object.assign({}, L.adj); s.preset = L.preset; }
      else for (const k of TPROPS) s.p[k] = k === 'shadow' && L.obj.shadow ? L.obj.shadow.toObject() : L.obj[k];
      return s;
    }
    function applySnap(L, s){
      L.name = s.name; L.locked = !!s.locked;
      const p = Object.assign({}, s.p);
      if (L.type === 'text') { p.shadow = p.shadow ? new F.Shadow(p.shadow) : null; }
      L.obj.set(p); L.obj.setCoords(); L.obj.dirty = true;
      if (L.type === 'raster' && (JSON.stringify(s.adj) !== JSON.stringify(L.adj) || s.preset !== L.preset)) { L.adj = Object.assign({}, s.adj); L.preset = s.preset; applyFilters(L); }
      if (L.type === 'text') { L.obj.initDimensions && L.obj.initDimensions(); fontReady(L); }
    }
    // Изменить слой(и) одним шагом: fn() меняет; до/после — снимки
    function change(label, layers, fn){
      const before = layers.map(snapL);
      fn();
      const after = layers.map(snapL);
      if (JSON.stringify(before) === JSON.stringify(after)) return false;
      push({ label, bytes: 512 * layers.length,
        undo(){ layers.forEach((L, i) => applySnap(L, before[i])); }, redo(){ layers.forEach((L, i) => applySnap(L, after[i])); } });
      layers.forEach(L => L.rev++);
      afterChange();
      return true;
    }
    // Снимок всего документа (открыть, новый, свести, размер…)
    const snapDoc = () => ({ w: doc.w, h: doc.h, bg: doc.bg, name: doc.name, active: doc.active, layers: doc.layers.slice() });
    function setDoc(s, keepView){
      for (const L of doc.layers.slice()) detach(L);
      doc.w = s.w; doc.h = s.h; doc.bg = s.bg; doc.name = s.name;
      s.layers.forEach((L, i) => attach(L, i));
      doc.active = s.active != null && layerById(s.active) ? s.active : (doc.layers[doc.layers.length - 1] || {}).id || null;
      if (!keepView) fit();
    }
    function replaceDoc(label, mutate, keepView){
      const before = snapDoc();
      mutate();
      const after = snapDoc();
      const gone = before.layers.filter(L => !after.layers.includes(L));
      push({ label, bytes: rasterBytes(gone) + 4096,
        undo(){ setDoc(before, keepView); }, redo(){ setDoc(after, keepView); },
        free(kind){ (kind === 'drop' ? gone : after.layers.filter(L => !before.layers.includes(L))).forEach(release); } });
      afterChange();
    }

    // ── коррекции: на экране — копия слоя ≤ PREV пикселей по стороне, фильтры fabric на видеокарте (мало памяти: на 12 Мп
    //    ~130 МБ вместо ~700 МБ у фильтров в полный размер); при сохранении — те же фильтры fabric в полный размер в потоке ──
    let filtT = 0; const filtWant = new Set();
    const backend = () => { try { return F.getFilterBackend && F.getFilterBackend(); } catch (e) { return null; } };
    function proxyOf(L){
      const c = L.canvas, k = Math.min(1, PREV / Math.max(c.width, c.height));
      if (k >= 1) { if (L.proxy) { L.proxy.width = L.proxy.height = 0; L.proxy = null; } return c; }
      const w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k));
      if (!L.proxy || L.proxy.width !== w || L.proxy.height !== h) { if (L.proxy) L.proxy.width = L.proxy.height = 0; L.proxy = canvasOf(w, h); L.proxyRev = -1; }
      if (L.proxyRev !== L.pxRev) {
        const g = L.proxy.getContext('2d'); g.imageSmoothingQuality = 'high'; g.clearRect(0, 0, w, h); g.drawImage(c, 0, 0, w, h);
        L.proxyRev = L.pxRev;
      }
      return L.proxy;
    }
    function dropFilt(L){
      const be = backend(); if (be && be.evictCachesForKey && L.fkey) be.evictCachesForKey(L.fkey);
      L.fkey = '';
      if (L.filt) { L.filt.width = L.filt.height = 0; L.filt = null; }
      if (L.proxy) { L.proxy.width = L.proxy.height = 0; L.proxy = null; }
    }
    function applyFilters(L, now){
      if (!L || L.type !== 'raster' || L.dead || !L.canvas) return;
      const o = L.obj, specs = PC.filterSpecs(L.adj, L.preset);
      if (!specs.length) {
        dropFilt(L);
        o._element = L.canvas; o._filteredEl = undefined; o._filterScalingX = o._filterScalingY = 1;
      } else {
        try {
          const src = proxyOf(L), be = backend();
          if (!be) throw new Error('нет фильтров');
          const key = 'd37f' + L.id + '_' + L.pxRev;
          if (L.fkey && L.fkey !== key && be.evictCachesForKey) be.evictCachesForKey(L.fkey);   // пиксели поменялись (кисть)
          L.fkey = key;
          if (!L.filt || L.filt.width !== src.width || L.filt.height !== src.height) { if (L.filt) L.filt.width = L.filt.height = 0; L.filt = canvasOf(src.width, src.height); }
          L.filt.getContext('2d').clearRect(0, 0, src.width, src.height);
          be.applyFilters(specs.map(([cls, op]) => new F.filters[cls](op)), src, src.width, src.height, L.filt, key);
          o._element = L.filt; o._filteredEl = undefined;
          o._filterScalingX = L.filt.width / L.canvas.width; o._filterScalingY = L.filt.height / L.canvas.height;
        } catch (e) {
          console.warn('photo: filters', e); dropFilt(L);
          o._element = L.canvas; o._filterScalingX = o._filterScalingY = 1;
          toast('Видеокарта не справилась с коррекцией — показано без неё (при сохранении она будет)', 'warn');
        }
      }
      o.dirty = true;
      if (!now) cv.requestRenderAll();
    }
    // Ползунок тянут: не чаще раза в кадр
    function previewFilters(L){
      filtWant.add(L);
      if (filtT) return;
      filtT = requestAnimationFrame(() => { filtT = 0; for (const X of filtWant) applyFilters(X); filtWant.clear(); });
    }
    const hasAdj = L => L.type === 'raster' && PC.filterSpecs(L.adj, L.preset).length > 0;
    // Пиксели слоя поменялись (кисть, заливка, отмена): копия для экрана и коррекции — заново
    function pixelsChanged(L, r){
      L.pxRev++;
      if (L.proxy && r && L.proxyRev === L.pxRev - 1) {   // копия была свежей — перерисовать только кусок
        const k = L.proxy.width / L.canvas.width, g = L.proxy.getContext('2d');
        const x0 = Math.floor(r.x * k), y0 = Math.floor(r.y * k), x1 = Math.ceil((r.x + r.w) * k), y1 = Math.ceil((r.y + r.h) * k);
        g.save(); g.imageSmoothingQuality = 'high'; g.clearRect(x0, y0, x1 - x0, y1 - y0);
        g.drawImage(L.canvas, x0 / k, y0 / k, (x1 - x0) / k, (y1 - y0) / k, x0, y0, x1 - x0, y1 - y0); g.restore();
        L.proxyRev = L.pxRev;
      }
      if (hasAdj(L)) applyFilters(L); else { L.obj.dirty = true; cv.requestRenderAll(); }
    }
    // Слой в полный размер с коррекциями — в потоке теми же фильтрами fabric (их 2D-вариант повторяет шейдер) → ImageBitmap
    async function fullFiltered(L){
      const specs = PC.filterSpecs(L.adj, L.preset);
      try { const bmp = await createImageBitmap(L.canvas); return (await W.run('filter', { bitmap: bmp, specs }, [bmp])).bitmap; }
      catch (e) { console.warn('photo: filter worker', e); const bmp = await createImageBitmap(L.canvas); return (await W.local('filter', { bitmap: bmp, specs })).bitmap; }
    }

    // ═══ Вид: масштаб, сдвиг, вписать ═══
    let fitted = true;   // вид «вписан»: окно поменялось (поворот телефона, панель) — вписываем заново
    function fit(){
      const W = cv.getWidth(), H = cv.getHeight(), pad = phone ? 12 : 32;
      const z = Math.max(0.01, Math.min((W - pad * 2) / doc.w, (H - pad * 2) / doc.h, 8));
      cv.setViewportTransform([z, 0, 0, z, (W - doc.w * z) / 2, (H - doc.h * z) / 2]);
      fitted = true;
      emit('zoom', z); cv.requestRenderAll();
    }
    function zoomAt(z, x, y){
      const cur = cv.getZoom(), fitZ = Math.min(cv.getWidth() / doc.w, cv.getHeight() / doc.h);
      z = clamp(z, Math.max(0.01, fitZ * 0.2), 32);
      if (x == null) { x = cv.getWidth() / 2; y = cv.getHeight() / 2; }
      cv.zoomToPoint(new F.Point(x, y), z);
      fitted = false;
      if (z !== cur) { emit('zoom', z); cv.requestRenderAll(); }
    }
    function panBy(dx, dy){ const v = cv.viewportTransform.slice(); v[4] += dx; v[5] += dy; cv.setViewportTransform(v); fitted = false; cv.requestRenderAll(); }
    function resize(){
      if (disposed) return;
      const w = Math.max(50, host.clientWidth), h = Math.max(50, host.clientHeight);
      if (w === cv.getWidth() && h === cv.getHeight()) return;
      const v = cv.viewportTransform.slice(), cx = (cv.getWidth() / 2 - v[4]) / v[0], cy = (cv.getHeight() / 2 - v[5]) / v[3];
      cv.setDimensions({ width: w, height: h });
      if (fitted) { fit(); return; }
      v[4] = w / 2 - cx * v[0]; v[5] = h / 2 - cy * v[3]; cv.setViewportTransform(v);
      cv.requestRenderAll();
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
    ro && ro.observe(host);

    // ═══ Рисование рабочего поля: подложка, шахматка прозрачности, затемнение вокруг, рамка обрезки, курсор кисти ═══
    let checker = null;
    function checkerPattern(ctx){
      if (checker) return checker;
      const c = canvasOf(16, 16), g = c.getContext('2d');
      g.fillStyle = '#d9d9de'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#b9b9c2'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
      return (checker = ctx.createPattern(c, 'repeat'));
    }
    const docRectScreen = () => { const v = cv.viewportTransform; return { x: v[4], y: v[5], w: doc.w * v[0], h: doc.h * v[3] }; };
    let hover = null, cropObj = null, cropAspect = '';
    cv.on('before:render', ({ ctx }) => {
      ctx.save();
      ctx.fillStyle = '#15151c'; ctx.fillRect(0, 0, cv.getWidth(), cv.getHeight());
      const r = docRectScreen();
      if (doc.bg && doc.bg !== '#00000000') { ctx.fillStyle = doc.bg; ctx.fillRect(r.x, r.y, r.w, r.h); }
      else { ctx.fillStyle = checkerPattern(ctx); ctx.fillRect(r.x, r.y, r.w, r.h); }
      ctx.restore();
    });
    cv.on('after:render', ({ ctx }) => {
      const r = docRectScreen(), W = cv.getWidth(), H = cv.getHeight();
      ctx.save();
      ctx.fillStyle = 'rgba(21,21,28,0.78)';
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(r.x, r.y, r.w, r.h); ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1);
      if (cropObj) {   // обрезка: всё вне рамки темнее
        const b = cropObj.getBoundingRect(), v = cv.viewportTransform;
        const x = b.left * v[0] + v[4], y = b.top * v[3] + v[5], w = b.width * v[0], h = b.height * v[3];
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.rect(x, y, w, h); ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath();
        for (let i = 1; i < 3; i++) { ctx.moveTo(x + w * i / 3, y); ctx.lineTo(x + w * i / 3, y + h); ctx.moveTo(x, y + h * i / 3); ctx.lineTo(x + w, y + h * i / 3); }
        ctx.stroke();
      }
      if (hover && (tool === 'brush' || tool === 'eraser')) {
        const z = cv.getZoom(), rr = Math.max(2, brush.size * z / 2);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(hover.x, hover.y, rr, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hover.x, hover.y, rr + 1.5, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    });

    // ═══ Инструменты ═══
    function syncTool(){
      const move = tool === 'move', text = tool === 'text';
      cv.skipTargetFind = !(move || text);
      for (const L of doc.layers) {
        L.obj.selectable = move && !L.locked;
        L.obj.evented = move || (text && L.type === 'text');
        L.obj.hoverCursor = move ? 'move' : 'text';
      }
      if (cropObj) { cropObj.selectable = cropObj.evented = true; }
      const A = activeLayer();
      if (move && A && A.obj.visible && !A.locked) { if (cv.getActiveObject() !== A.obj) cv.setActiveObject(A.obj); }
      else if (!cropObj) cv.discardActiveObject();
      cv.defaultCursor = { brush: 'crosshair', eraser: 'crosshair', hand: 'grab', text: 'text' }[tool] || 'default';
      cv.requestRenderAll();
    }
    function setTool(t){
      if (!['move', 'brush', 'eraser', 'crop', 'text', 'hand'].includes(t)) return;
      if (tool === 'crop' && t !== 'crop') cropCancel();
      tool = t; hover = null;
      if (t === 'crop') cropStart(cropAspect);
      syncTool(); emit('tool', t);
    }
    function select(id){
      const L = layerById(id); if (!L) return false;
      doc.active = L.id; syncTool(); emit('active', L.id); emit('layers'); return true;
    }
    cv.on('selection:created', e => onSel(e)); cv.on('selection:updated', e => onSel(e));
    function onSel(e){ const o = (e.selected || [])[0]; if (o && o.d37id && o.d37id !== doc.active) { doc.active = o.d37id; emit('active', o.d37id); emit('layers'); } }
    // Перетащили / повернули / растянули рукой — один шаг истории
    cv.on('object:modified', e => {
      const o = e.target, L = o && o.d37id && layerById(o.d37id);
      if (!L || !e.transform || !e.transform.original) return;
      const orig = e.transform.original, before = snapL(L);
      for (const k of ['left', 'top', 'angle', 'scaleX', 'scaleY', 'flipX', 'flipY', 'skewX', 'skewY']) if (orig[k] !== undefined) before.p[k] = orig[k];
      const after = snapL(L);
      push({ label: 'Перемещение', bytes: 512, undo(){ applySnap(L, before); }, redo(){ applySnap(L, after); } });
      L.rev++; emit('layers');
    });
    cv.on('text:changed', e => { const L = e.target && layerById(e.target.d37id); if (L) { L.name = 'Т: ' + String(L.obj.text).slice(0, 18); emit('layers'); } });
    // Правка надписи прямо на холсте (компьютер): весь ввод — один шаг
    let textBefore = null;
    cv.on('text:editing:entered', e => { const L = layerById(e.target.d37id); textBefore = L ? snapL(L) : null; });
    cv.on('text:editing:exited', e => {
      const L = layerById(e.target.d37id); if (!L || !textBefore) return;
      const before = textBefore, after = snapL(L); textBefore = null;
      if (JSON.stringify(before) !== JSON.stringify(after)) push({ label: 'Текст', bytes: 512, undo(){ applySnap(L, before); }, redo(){ applySnap(L, after); } });
    });

    // ── обрезка рамкой ──
    function cropStart(aspect){
      cropCancel();
      cropAspect = aspect || '';
      const r = (cropAspect && PC.aspectRect(doc.w, doc.h, cropAspect)) || { x: 0, y: 0, w: doc.w, h: doc.h };
      cropObj = new F.Rect({ left: r.x + r.w / 2, top: r.y + r.h / 2, width: r.w, height: r.h, originX: 'center', originY: 'center',
        fill: 'rgba(0,0,0,0)', stroke: '#ffffff', strokeWidth: 2, strokeUniform: true, strokeDashArray: [8, 6], objectCaching: false,
        lockRotation: true, lockScalingFlip: true, hasBorders: false });
      styleObj(cropObj); cropObj.setControlsVisibility({ mtr: false });
      cropObj.d37ui = true;
      cv.add(cropObj); cv.setActiveObject(cropObj); cv.requestRenderAll();
      emit('crop', cropRect());
    }
    function cropCancel(){ if (!cropObj) return; cv.remove(cropObj); cropObj = null; cv.requestRenderAll(); emit('crop', null); }
    function cropRect(){
      if (!cropObj) return null;
      const w = cropObj.width * cropObj.scaleX, h = cropObj.height * cropObj.scaleY;
      return { x: Math.round(cropObj.left - w / 2), y: Math.round(cropObj.top - h / 2), w: Math.round(w), h: Math.round(h) };
    }
    cv.on('object:scaling', e => {
      const o = e.target; if (o !== cropObj) return;
      let w = Math.max(8, o.width * o.scaleX), h = Math.max(8, o.height * o.scaleY);
      const m = /^(\d+):(\d+)$/.exec(cropAspect);
      if (m) { const r = (+m[1]) / (+m[2]); if (Math.abs(w / h - r) > 0.001) h = w / r; }
      o.set({ width: w, height: h, scaleX: 1, scaleY: 1 }); o.setCoords();
      emit('crop', cropRect());
    });
    cv.on('object:moving', e => { if (e.target === cropObj) emit('crop', cropRect()); });
    function setCropAspect(a){ cropAspect = a || ''; if (tool === 'crop') cropStart(cropAspect); }

    // ═══ Кисть и ластик (растр, отмена кусками 256×256 — копия на видеокарте) ═══
    let stroke = null;
    const stampCache = { key: '', c: null };
    function stampOf(d, hardness, color){
      const key = d + '|' + hardness + '|' + color;
      if (stampCache.key === key) return stampCache.c;
      const s = Math.max(1, Math.ceil(d)) + 2, c = canvasOf(s, s), g = c.getContext('2d'), r = d / 2, m = s / 2;
      const h = clamp(hardness / 100, 0, 1);
      if (h >= 0.99 || d < 3) { g.fillStyle = color; g.beginPath(); g.arc(m, m, Math.max(0.5, r), 0, Math.PI * 2); g.fill(); }
      else {
        const grd = g.createRadialGradient(m, m, r * h, m, m, r), c0 = color.slice(0, 7);
        grd.addColorStop(0, c0); grd.addColorStop(1, c0 + '00');
        g.fillStyle = grd; g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.fill();
      }
      stampCache.key = key; stampCache.c = c;
      return c;
    }
    // Точка документа → пиксель слоя (у слоя свой сдвиг, масштаб, поворот, отражение)
    function toLayerPx(L, x, y, inv){
      const p = F.util.transformPoint(new F.Point(x, y), inv);
      return { x: p.x + L.canvas.width / 2, y: p.y + L.canvas.height / 2 };
    }
    function strokeBegin(L, o){
      if (L.type !== 'raster') throw userErr('Кисть рисует на слое-картинке. Выбери слой-картинку или создай новый слой');
      if (!L.obj.visible) throw userErr('Слой скрыт — включи его, чтобы рисовать');
      const m = L.obj.calcTransformMatrix(), inv = F.util.invertTransform(m);
      const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;   // масштаб слоя
      const size = Math.max(1, o.size / k), hard = o.hardness, op = clamp(o.opacity / 100, 0.01, 1);
      const step = Math.max(0.5, size * 0.12), n = Math.max(1, size / step);
      const flow = 1 - Math.pow(1 - op, 1 / n);
      const color = o.erase ? '#000000' : (PC.color(o.color) || '#000000').slice(0, 7);
      // слой с коррекциями: на экране — уменьшенная копия с фильтрами; пока ведём кистью, рисуем и на ней (сразу видно)
      const filtered = L.filt && L.obj._element === L.filt ? L.filt : null;
      return { L, inv, size, step, flow, erase: !!o.erase, stamp: stampOf(size, hard, color), ctx: L.canvas.getContext('2d'),
        fctx: filtered ? filtered.getContext('2d') : null, fk: filtered ? filtered.width / L.canvas.width : 1,
        tiles: new Map(), last: null, dist: 0, any: false, box: null };
    }
    function saveTiles(st, x0, y0, x1, y1){
      const cw = st.L.canvas.width, ch = st.L.canvas.height;
      const tx0 = Math.max(0, Math.floor(x0 / TILE)), ty0 = Math.max(0, Math.floor(y0 / TILE));
      const tx1 = Math.min(Math.ceil(cw / TILE) - 1, Math.floor(x1 / TILE)), ty1 = Math.min(Math.ceil(ch / TILE) - 1, Math.floor(y1 / TILE));
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const key = ty * 4096 + tx; if (st.tiles.has(key)) continue;
        const x = tx * TILE, y = ty * TILE, w = Math.min(TILE, cw - x), h = Math.min(TILE, ch - y);
        const t = canvasOf(w, h); t.getContext('2d').drawImage(st.L.canvas, x, y, w, h, 0, 0, w, h);
        st.tiles.set(key, { x, y, w, h, c: t });
      }
    }
    function dab(st, x, y){
      const s = st.stamp, hw = s.width / 2;
      saveTiles(st, x - hw, y - hw, x + hw, y + hw);
      const g = st.ctx;
      g.save(); g.globalAlpha = st.flow; g.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over'; g.drawImage(s, x - hw, y - hw); g.restore();
      if (st.fctx) { const f = st.fctx, k = st.fk; f.save(); f.globalAlpha = st.flow; f.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over'; f.drawImage(s, (x - hw) * k, (y - hw) * k, s.width * k, s.height * k); f.restore(); }
      const b = st.box;
      if (!b) st.box = { x0: x - hw, y0: y - hw, x1: x + hw, y1: y + hw };
      else { if (x - hw < b.x0) b.x0 = x - hw; if (y - hw < b.y0) b.y0 = y - hw; if (x + hw > b.x1) b.x1 = x + hw; if (y + hw > b.y1) b.y1 = y + hw; }
      st.any = true;
    }
    const boxRect = b => b ? { x: Math.floor(b.x0), y: Math.floor(b.y0), w: Math.ceil(b.x1 - b.x0) + 1, h: Math.ceil(b.y1 - b.y0) + 1 } : null;
    function tilesRect(tiles){
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const t of tiles.values()) { x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h); }
      return x1 > x0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    }
    function strokeTo(st, dx, dy){   // dx, dy — точка документа
      const p = toLayerPx(st.L, dx, dy, st.inv);
      if (!st.last) { dab(st, p.x, p.y); st.last = p; return; }
      const ddx = p.x - st.last.x, ddy = p.y - st.last.y, d = Math.hypot(ddx, ddy);
      if (d < st.step) return;
      const n = Math.floor(d / st.step);
      for (let i = 1; i <= n; i++) dab(st, st.last.x + ddx * i / n, st.last.y + ddy * i / n);
      st.last = p;
    }
    function strokeShow(st){ st.L.obj.dirty = true; cv.requestRenderAll(); }
    function swapTiles(L, tiles){
      const g = L.canvas.getContext('2d');
      for (const t of tiles.values()) {
        const cur = canvasOf(t.w, t.h); cur.getContext('2d').drawImage(L.canvas, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
        g.clearRect(t.x, t.y, t.w, t.h); g.drawImage(t.c, t.x, t.y);
        t.c.width = t.c.height = 0; t.c = cur;
      }
      pixelsChanged(L, tilesRect(tiles));
    }
    function strokeEnd(st, label){
      if (!st || !st.any) return false;
      const L = st.L, tiles = st.tiles;
      let bytes = 0; for (const t of tiles.values()) bytes += t.w * t.h * 8;   // ×2: холст куска — и страница, и видеокарта
      push({ label: label || (st.erase ? 'Ластик' : 'Кисть'), bytes, undo(){ swapTiles(L, tiles); }, redo(){ swapTiles(L, tiles); },
        free(){ for (const t of tiles.values()) { t.c.width = t.c.height = 0; } } });
      L.rev++;
      pixelsChanged(L, boxRect(st.box) || tilesRect(tiles));
      emit('layers');
      return true;
    }
    function strokeCancel(st){ if (!st) return; if (st.any) { swapTiles(st.L, st.tiles); for (const t of st.tiles.values()) t.c.width = t.c.height = 0; } }

    // ═══ Ввод: инструменты, щипок двумя пальцами, колесо, рука ═══
    const pts = new Map(); let gest = null, pan = null, spaceDown = false;
    const local = e => { const r = cv.upperCanvasEl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const scene = p => { const v = cv.viewportTransform; return { x: (p.x - v[4]) / v[0], y: (p.y - v[5]) / v[3] }; };
    let downSnap = null;
    function onDown(e){
      if (disposed || paused) return;
      pts.set(e.pointerId, local(e));
      if (pts.size === 2) {   // второй палец — щипок/сдвиг; начатое одним пальцем отменяем
        if (stroke) { strokeCancel(stroke); stroke = null; }
        if (downSnap && downSnap.L && cv._currentTransform) { applySnap(downSnap.L, downSnap.s); cv._currentTransform = null; }
        downSnap = null;
        const [a, b] = [...pts.values()];
        gest = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, z: cv.getZoom(), v: cv.viewportTransform.slice() };
        e.stopImmediatePropagation(); e.preventDefault();
        return;
      }
      if (pts.size > 2) { e.stopImmediatePropagation(); return; }
      const p = local(e);
      if (e.button === 1 || tool === 'hand' || spaceDown) {   // средняя кнопка, «рука», пробел — сдвиг
        pan = { x: p.x, y: p.y }; e.stopImmediatePropagation(); e.preventDefault(); return;
      }
      if (e.button && e.button !== 0) return;
      if (tool === 'brush' || tool === 'eraser') {
        e.stopImmediatePropagation(); e.preventDefault();
        const L = activeLayer();
        try { stroke = strokeBegin(L ? L : resolveLayer('active'), { size: brush.size, hardness: brush.hardness, opacity: brush.opacity, color: brush.color, erase: tool === 'eraser' }); }
        catch (er) { stroke = null; toast(er.message, 'warn'); return; }
        const s = scene(p); strokeTo(stroke, s.x, s.y); strokeShow(stroke);
        return;
      }
      if (tool === 'text') {
        const t = cv.findTarget(e);
        if (t && t.d37id) { select(t.d37id); emit('textEdit', t.d37id); e.stopImmediatePropagation(); return; }
        const s = scene(p);
        e.stopImmediatePropagation(); e.preventDefault();
        exec('text', { text: 'Текст', x: Math.round(s.x), y: Math.round(s.y) }).then(r => { if (r.ok) emit('textEdit', r.result.layer); });
        return;
      }
      if (tool === 'move') { const A = activeLayer(); downSnap = A ? { L: A, s: snapL(A) } : null; }
    }
    function onMove(e){
      if (disposed || paused) return;
      if (pts.has(e.pointerId)) pts.set(e.pointerId, local(e));
      if (gest && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const fitZ = Math.min(cv.getWidth() / doc.w, cv.getHeight() / doc.h);
        const z = clamp(gest.z * d / gest.d, Math.max(0.01, fitZ * 0.2), 32), k = z / gest.z;
        const v = gest.v.slice(); v[0] = v[3] = z;
        v[4] = c.x - (gest.c.x - gest.v[4]) * k; v[5] = c.y - (gest.c.y - gest.v[5]) * k;
        cv.setViewportTransform(v); fitted = false; cv.requestRenderAll(); emit('zoom', z);
        e.stopImmediatePropagation(); e.preventDefault(); return;
      }
      if (pan && pts.has(e.pointerId)) { const p = local(e); panBy(p.x - pan.x, p.y - pan.y); pan = p; e.stopImmediatePropagation(); return; }
      if (stroke && pts.has(e.pointerId)) {
        const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
        for (const ce of (evs && evs.length ? evs : [e])) { const s = scene(local(ce)); strokeTo(stroke, s.x, s.y); }
        strokeShow(stroke);
        e.stopImmediatePropagation(); return;
      }
      if ((tool === 'brush' || tool === 'eraser') && e.pointerType === 'mouse') { hover = local(e); cv.requestRenderAll(); }
    }
    // Отпускание всегда доходит до fabric (иначе он «думает», что палец ещё на экране)
    function onUp(e){
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (gest) { if (pts.size < 2) gest = null; return; }
      if (pan) { pan = null; return; }
      if (stroke) { const st = stroke; stroke = null; strokeEnd(st); }
      downSnap = null;
    }
    const upper = cv.upperCanvasEl;
    upper.style.touchAction = 'none';
    host.addEventListener('pointerdown', onDown, true);
    root.addEventListener('pointermove', onMove, true);
    root.addEventListener('pointerup', onUp, true);
    root.addEventListener('pointercancel', onUp, true);
    const onLeave = () => { hover = null; cv.requestRenderAll(); };
    upper.addEventListener('pointerleave', onLeave);
    cv.on('mouse:wheel', opt => {
      const e = opt.e; e.preventDefault(); e.stopPropagation();
      const p = local(e);
      if (e.ctrlKey || e.metaKey || !e.shiftKey) zoomAt(cv.getZoom() * Math.pow(0.999, e.deltaY), p.x, p.y);
      else panBy(-e.deltaY, 0);
    });

    // ═══ Команды: открыть, создать, обрезать, размер, поворот… (то, что делают и кнопки, и ИИ) ═══
    async function decode(blob, maxPixels){
      if (!blob || !/^image\//.test(blob.type || 'image/')) throw userErr('Это не картинка');
      const job = { blob, maxSide: B.maxSide, maxPixels: Math.max(1, Math.min(B.maxPixels, maxPixels || B.maxPixels)) };
      let r;
      try { r = await W.run('decode', job); }
      catch (e) {
        try { r = await W.local('decode', job); }
        catch (er) { throw userErr('Не получилось открыть картинку (формат не поддерживается или файл повреждён)'); }
      }
      const c = canvasOf(r.w, r.h); c.getContext('2d').drawImage(r.bitmap, 0, 0); r.bitmap.close && r.bitmap.close();
      return { canvas: c, w0: r.w0, h0: r.h0, scaled: r.scaled };
    }
    function scaledNote(r){ if (r.scaled) toast(`Фото уменьшено до ${r.canvas.width}×${r.canvas.height} (было ${r.w0}×${r.h0}), чтобы на этом устройстве не тормозило и не вылетало`, 'warn'); }
    async function openBlob(blob, name){
      busy(true, 'Открываю фото…');
      try {
        const r = await decode(blob);
        scaledNote(r);
        const L = mkRaster(r.canvas, { name: 'Фон', x: r.canvas.width / 2, y: r.canvas.height / 2 }); L.locked = true;
        keepSrc(L, blob);
        replaceDoc('Открыть', () => { setDoc({ w: r.canvas.width, h: r.canvas.height, bg: null, name: cleanName(name), active: L.id, layers: [L] }); });
        fit(); baseSeq = hist.seq;   // только что открытое — ещё не «работа» (черновик не нужен)
        return { layer: L.id, w: doc.w, h: doc.h, scaled: r.scaled };
      } finally { busy(false); if (phone) W.recycle(); }   // телефон: поток с картинками закрыть — память сразу назад
    }
    async function placeBlob(blob, a = {}){
      busy(true, 'Добавляю картинку…');
      try {
        const r = await decode(blob);
        canHold(r.canvas.width * r.canvas.height);
        scaledNote(r);
        let k = a.scale || Math.min(1, doc.w / r.canvas.width, doc.h / r.canvas.height);
        const L = mkRaster(r.canvas, { name: a.name || cleanName(a.fileName || 'Картинка'), x: a.x != null ? a.x : doc.w / 2, y: a.y != null ? a.y : doc.h / 2, scale: k });
        keepSrc(L, blob);
        addLayer(L, 'Добавить картинку');
        return { layer: L.id };
      } finally { busy(false); if (phone) W.recycle(); }   // телефон: поток с картинками закрыть — память сразу назад
    }
    const cleanName = n => String(n || 'Без названия').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 60) || 'Без названия';
    function addLayer(L, label, index){
      const i = index == null ? doc.layers.length : index;
      attach(L, i); doc.active = L.id;
      push({ label, bytes: 1024, adds: L, undo(){ detach(L); }, redo(){ attach(L, i); doc.active = L.id; }, free(kind){ if (kind === 'redo') release(L); } });
      afterChange(); emit('active', L.id);
      return L;
    }
    function removeLayer(L, label){
      const i = detach(L);
      push({ label, bytes: rasterBytes([L]), undo(){ attach(L, i); doc.active = L.id; }, redo(){ detach(L); }, free(kind){ if (kind === 'drop') release(L); } });
      afterChange();
    }
    function newDoc(a){
      const w = clamp(a.w | 0, 16, B.maxSide), h = clamp(a.h | 0, 16, B.maxSide);
      const bg = a.bg === 'transparent' ? null : (PC.color(a.bg || '#ffffff') || '#ffffff');
      const c = canvasOf(w, h);
      if (bg) { const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, w, h); }
      const L = mkRaster(c, { name: 'Фон', x: w / 2, y: h / 2 }); L.locked = true;
      replaceDoc('Новый документ', () => setDoc({ w, h, bg: null, name: cleanName(a.name || 'Без названия'), active: L.id, layers: [L] }));
      fit(); baseSeq = hist.seq;
      return { w, h, layer: L.id };
    }
    // Обрезка: документ = рамка, слои сдвигаются (пиксели не режутся — можно вернуть)
    function crop(a){
      let r = a.aspect ? PC.aspectRect(doc.w, doc.h, a.aspect) : { x: a.x || 0, y: a.y || 0, w: a.w, h: a.h };
      if (!r || r.w < 1 || r.h < 1) throw userErr('Пустая рамка обрезки');
      if (r.w > B.maxSide || r.h > B.maxSide) throw userErr(`Больше ${B.maxSide} пикселей по стороне этому устройству не по силам`);
      const before = { w: doc.w, h: doc.h }, after = { w: r.w, h: r.h }, dx = -r.x, dy = -r.y;
      const shift = (s, mx, my) => { doc.w = s.w; doc.h = s.h; for (const L of doc.layers) { L.obj.set({ left: L.obj.left + mx, top: L.obj.top + my }); L.obj.setCoords(); } };
      if (!dx && !dy && before.w === after.w && before.h === after.h) return { w: doc.w, h: doc.h };
      const layers = doc.layers.slice();
      shift(after, dx, dy);
      push({ label: 'Обрезка', bytes: 1024,
        undo(){ doc.w = before.w; doc.h = before.h; for (const L of layers) { L.obj.set({ left: L.obj.left - dx, top: L.obj.top - dy }); L.obj.setCoords(); } fit(); },
        redo(){ doc.w = after.w; doc.h = after.h; for (const L of layers) { L.obj.set({ left: L.obj.left + dx, top: L.obj.top + dy }); L.obj.setCoords(); } fit(); } });
      cropCancel(); if (tool === 'crop') { tool = 'move'; emit('tool', tool); }
      fit(); afterChange();
      return { w: doc.w, h: doc.h };
    }
    // Поворот всего изображения на 90/180/270 (без потерь: слои поворачиваются вокруг центра)
    function rotateImage(deg){
      deg = ((deg % 360) + 360) % 360; if (!deg) return { w: doc.w, h: doc.h };
      const op = d => {
        const W0 = doc.w, H0 = doc.h, swap = d === 90 || d === 270;
        for (const L of doc.layers) {
          const x = L.obj.left - W0 / 2, y = L.obj.top - H0 / 2;
          const [nx, ny] = d === 90 ? [-y, x] : d === 180 ? [-x, -y] : [y, -x];
          const W1 = swap ? H0 : W0, H1 = swap ? W0 : H0;
          L.obj.set({ left: nx + W1 / 2, top: ny + H1 / 2, angle: ((L.obj.angle || 0) + d) % 360 }); L.obj.setCoords();
        }
        if (swap) { doc.w = H0; doc.h = W0; }
      };
      op(deg);
      push({ label: 'Поворот', bytes: 1024, undo(){ op((360 - deg) % 360); fit(); }, redo(){ op(deg); fit(); } });
      fit(); afterChange();
      return { w: doc.w, h: doc.h };
    }
    function flipImage(axis){
      const op = () => {
        for (const L of doc.layers) {
          if (axis === 'h') L.obj.set({ left: doc.w - L.obj.left, flipX: !L.obj.flipX, angle: -(L.obj.angle || 0) });
          else L.obj.set({ top: doc.h - L.obj.top, flipY: !L.obj.flipY, angle: -(L.obj.angle || 0) });
          L.obj.setCoords();
        }
      };
      op();
      push({ label: 'Отражение', bytes: 512, undo: op, redo: op });
      afterChange();
      return {};
    }
    // Размер изображения: пиксели пересчитываются качественно (в потоке), надписи — размером шрифта
    async function resizeImage(a){
      let k;
      if (a.scale) k = a.scale;
      else if (a.w && a.h) k = null;
      else k = a.w ? a.w / doc.w : a.h / doc.h;
      const nw = Math.max(1, Math.round(k ? doc.w * k : a.w)), nh = Math.max(1, Math.round(k ? doc.h * k : a.h));
      if (nw > B.maxSide || nh > B.maxSide) throw userErr(`Больше ${B.maxSide} пикселей по стороне этому устройству не по силам`);
      const kx = nw / doc.w, ky = nh / doc.h;
      busy(true, 'Меняю размер…');
      try {
        const news = new Map();
        let px = 0;
        for (const L of doc.layers) if (L.type === 'raster') { const w = Math.max(1, Math.round(L.canvas.width * kx)), h = Math.max(1, Math.round(L.canvas.height * ky)); px += w * h; news.set(L, { w, h }); }
        if (px > B.totalPixels) throw userErr('Столько пикселей этому устройству не по силам — выбери размер меньше');
        for (const [L, s] of news) {
          let r;
          try { const bmp = await createImageBitmap(L.canvas); r = await W.run('resample', { bitmap: bmp, w: s.w, h: s.h }, [bmp]); }
          catch (e) { r = await W.local('resample', { bitmap: await createImageBitmap(L.canvas), w: s.w, h: s.h }); }
          const c = canvasOf(s.w, s.h); c.getContext('2d').drawImage(r.bitmap, 0, 0); r.bitmap.close && r.bitmap.close();
          s.c = c;
        }
        const nextLayers = doc.layers.map(L => {
          if (L.type === 'raster') {
            const N = mkRaster(news.get(L).c, { id: L.id, name: L.name, x: L.obj.left * kx, y: L.obj.top * ky });
            N.obj.set({ angle: L.obj.angle, scaleX: L.obj.scaleX, scaleY: L.obj.scaleY, flipX: L.obj.flipX, flipY: L.obj.flipY, opacity: L.obj.opacity,
              visible: L.obj.visible, globalCompositeOperation: L.obj.globalCompositeOperation });
            N.adj = Object.assign({}, L.adj); N.preset = L.preset; N.locked = !!L.locked;
            if (PC.filterSpecs(N.adj, N.preset).length) applyFilters(N, true);
            return N;
          }
          const s = snapL(L), T = mkText({ id: L.id, text: L.obj.text, name: L.name });
          applySnap(T, s);
          const km = Math.sqrt(kx * ky);
          T.obj.set({ left: L.obj.left * kx, top: L.obj.top * ky, fontSize: L.obj.fontSize * km, strokeWidth: (L.obj.strokeWidth || 0) * km });
          if (T.obj.shadow) T.obj.shadow = new F.Shadow(Object.assign(T.obj.shadow.toObject(), { blur: T.obj.shadow.blur * km, offsetX: T.obj.shadow.offsetX * km, offsetY: T.obj.shadow.offsetY * km }));
          T.obj.initDimensions && T.obj.initDimensions(); T.obj.setCoords();
          return T;
        });
        const act = doc.layers.findIndex(L => L.id === doc.active);
        replaceDoc('Размер', () => setDoc({ w: nw, h: nh, bg: doc.bg, name: doc.name, active: act >= 0 ? nextLayers[act].id : null, layers: nextLayers }));
        return { w: nw, h: nh };
      } finally { busy(false); if (phone) W.recycle(); }   // телефон: поток с картинками закрыть — память сразу назад
    }

    // Нарисовать слои в холст размера документа: полный размер, без кэша fabric. full — слои с коррекциями берутся в полном
    // размере из потока (сохранить, свести, объединить); без full — как на экране (превью в «Материалах»)
    async function renderLayers(list, scale, bg, full){
      const prep = new Map();
      if (full) for (const L of list) if (L.obj.visible && L.obj.opacity && hasAdj(L)) prep.set(L, await fullFiltered(L));
      return drawLayers(list, scale, bg, prep);
    }
    function drawLayers(list, scale, bg, prep){
      const w = Math.max(1, Math.round(doc.w * scale)), h = Math.max(1, Math.round(doc.h * scale));
      const c = canvasOf(w, h), g = c.getContext('2d');
      if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
      g.setTransform(scale, 0, 0, scale, 0, 0);
      g.imageSmoothingQuality = 'high';
      const skip = cv.skipOffscreen; cv.skipOffscreen = false;
      try {
        for (const L of list) {
          if (!L.obj.visible || !L.obj.opacity) continue;
          const o = L.obj, oc = o.objectCaching, el = o._element, sx = o._filterScalingX, sy = o._filterScalingY, b = prep && prep.get(L);
          if (b) { o._element = b; o._filterScalingX = o._filterScalingY = 1; }
          o.objectCaching = false;
          try { o.render(g); } finally { o.objectCaching = oc; o._element = el; o._filterScalingX = sx; o._filterScalingY = sy; o.dirty = true; }
        }
      } finally { cv.skipOffscreen = skip; if (prep) for (const b of prep.values()) b.close && b.close(); }
      return c;
    }
    async function mergeDown(L){
      const i = doc.layers.indexOf(L);
      if (i <= 0) throw userErr('Ниже нет слоя');
      const below = doc.layers[i - 1];
      canHold(doc.w * doc.h);
      busy(true, 'Объединяю…');
      try {
        const c = await renderLayers([below, L], 1, null, true);
        const N = mkRaster(c, { id: below.id, name: below.name, x: doc.w / 2, y: doc.h / 2 }); N.locked = !!below.locked;
        replaceDoc('Объединить', () => { detach(L); const j = detach(below); attach(N, j); doc.active = N.id; }, true);
        return { layer: N.id };
      } finally { busy(false); if (phone) W.recycle(); }   // телефон: поток с картинками закрыть — память сразу назад
    }
    async function flatten(){
      if (!doc.layers.length) throw userErr('Нет слоёв');
      busy(true, 'Свожу слои…');
      try {
        const c = await renderLayers(doc.layers, 1, null, true);
        const N = mkRaster(c, { name: 'Сведено', x: doc.w / 2, y: doc.h / 2 }); N.locked = true;
        replaceDoc('Свести', () => setDoc({ w: doc.w, h: doc.h, bg: doc.bg, name: doc.name, active: N.id, layers: [N] }, true), true);
        return { layer: N.id };
      } finally { busy(false); if (phone) W.recycle(); }   // телефон: поток с картинками закрыть — память сразу назад
    }
    function dupLayer(L){
      let N;
      if (L.type === 'raster') {
        canHold(L.canvas.width * L.canvas.height);
        const c = canvasOf(L.canvas.width, L.canvas.height); c.getContext('2d').drawImage(L.canvas, 0, 0);
        N = mkRaster(c, { name: L.name + ' копия' });
        applySnap(N, Object.assign(snapL(L), { name: L.name + ' копия', locked: false }));   // и коррекции (фильтры пересчитает сам)
      } else { N = mkText({ text: L.obj.text }); applySnap(N, Object.assign(snapL(L), { name: L.name + ' копия', locked: false })); }
      N.obj.set({ left: N.obj.left + 12, top: N.obj.top + 12 }); N.obj.setCoords();
      addLayer(N, 'Копия слоя', doc.layers.indexOf(L) + 1);
      return { layer: N.id };
    }
    function orderLayer(L, to){
      const i = doc.layers.indexOf(L), n = doc.layers.length;
      const j = clamp(to === 'up' ? i + 1 : to === 'down' ? i - 1 : to === 'top' ? n - 1 : 0, 0, n - 1);
      if (i === j) return { index: i };
      const mv = (a, b) => { doc.layers.splice(a, 1); doc.layers.splice(b, 0, L); cv.moveObjectTo(L.obj, b); };
      mv(i, j);
      push({ label: 'Порядок слоёв', bytes: 256, undo(){ mv(j, i); }, redo(){ mv(i, j); } });
      afterChange();
      return { index: j };
    }
    function fillLayer(L, color){
      const c = PC.color(color); if (!c) throw userErr('Не понял цвет: ' + color);
      const st = strokeBegin(L, { size: 1, hardness: 100, opacity: 100, color: c });
      saveTiles(st, 0, 0, L.canvas.width, L.canvas.height);
      const g = L.canvas.getContext('2d'); g.save(); g.globalCompositeOperation = 'source-over'; g.fillStyle = c; g.fillRect(0, 0, L.canvas.width, L.canvas.height); g.restore();
      st.any = true;
      strokeEnd(st, 'Заливка');
      return {};
    }
    function draw(L, a){
      const st = strokeBegin(L, { size: a.size || brush.size, hardness: a.hardness != null ? a.hardness : brush.hardness, opacity: a.opacity || 100,
        color: a.color || brush.color, erase: !!a.erase });
      for (const [x, y] of a.points) strokeTo(st, x, y);
      if (a.points.length === 1) { const p = a.points[0]; st.last = null; strokeTo(st, p[0], p[1]); }
      strokeEnd(st, a.erase ? 'Ластик' : 'Кисть');
      return {};
    }
    async function autoEnhance(L){
      busy(true, 'Улучшаю…');
      try {
        const s = Math.min(1, 512 / Math.max(L.canvas.width, L.canvas.height));
        const small = () => createImageBitmap(L.canvas, { resizeWidth: Math.max(1, Math.round(L.canvas.width * s)), resizeHeight: Math.max(1, Math.round(L.canvas.height * s)), resizeQuality: 'medium' });
        let st;
        try { const bmp = await small(); st = await W.run('stats', { bitmap: bmp }, [bmp]); }
        catch (e) { st = await W.local('stats', { bitmap: await small() }); }
        const p = PC.autoParams(st);
        change('Автоулучшение', [L], () => { Object.assign(L.adj, p); applyFilters(L); });
        return p;
      } finally { busy(false); if (phone) W.recycle(); }   // телефон: поток с картинками закрыть — память сразу назад
    }

    // ── 🪄 Убрать фон: ИИ в браузере (U²-Netp, Apache-2.0; ONNX Runtime Web, MIT) — маска в потоке, к слою — «оставить по маске» ──
    async function removeBg(L){
      const ai = opts.ai || {};
      if (!ai.modelUrl || !ai.ortUrl) throw userErr('ИИ для фона не настроен');
      if (!W.threaded) throw userErr('Нужен браузер поновее (Chrome, Яндекс Браузер, Safari 16.4+)');
      busy(true, 'ИИ ищет фон… (первый раз скачивает ~8 МБ)');
      try {
        const s = Math.min(1, 640 / Math.max(L.canvas.width, L.canvas.height));
        const bmp = await createImageBitmap(L.canvas, { resizeWidth: Math.max(1, Math.round(L.canvas.width * s)), resizeHeight: Math.max(1, Math.round(L.canvas.height * s)), resizeQuality: 'high' });
        let r;
        try { r = await W.run('removeBg', { bitmap: bmp, ortUrl: ai.ortUrl, ortBase: ai.ortBase, modelUrl: ai.modelUrl }, [bmp]); }
        catch (e) { console.warn('photo: removeBg', e); throw userErr('ИИ не загрузился — проверь интернет и попробуй ещё раз'); }
        if (disposed || L.dead) { r.bitmap.close && r.bitmap.close(); return {}; }
        const st = strokeBegin(L, { size: 1, hardness: 100, opacity: 100, color: '#000' });
        saveTiles(st, 0, 0, L.canvas.width, L.canvas.height);
        const g = L.canvas.getContext('2d');
        g.save(); g.globalCompositeOperation = 'destination-in'; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        g.drawImage(r.bitmap, 0, 0, L.canvas.width, L.canvas.height); g.restore();
        r.bitmap.close && r.bitmap.close();
        st.any = true; strokeEnd(st, 'Убрать фон');
        return { layer: L.id };
      } finally { busy(false); if (phone) W.recycle(); }
    }

    // ── экспорт ──
    async function exportBlob(a = {}){
      const type = a.format === 'jpeg' ? 'image/jpeg' : a.format === 'webp' ? 'image/webp' : 'image/png';
      let scale = a.scale || 1;
      if (a.maxSide) scale = Math.min(scale, a.maxSide / Math.max(doc.w, doc.h));
      scale = Math.min(scale, B.exportMax / Math.max(doc.w, doc.h));
      busy(true, 'Сохраняю…');
      try {
        const bg = type === 'image/jpeg' ? (doc.bg || '#ffffff') : (doc.bg || null);
        const c = await renderLayers(doc.layers, scale, bg, true);
        const w = c.width, h = c.height, q = a.quality != null ? a.quality / 100 : (type === 'image/png' ? undefined : 0.92);
        let blob;
        try { const bmp = await createImageBitmap(c); blob = (await W.run('encode', { bitmap: bmp, type, quality: q, bg: type === 'image/jpeg' ? '#ffffff' : null }, [bmp])).blob; }
        catch (e) { console.warn('photo: encode worker', e); const bmp = await createImageBitmap(c); blob = (await W.local('encode', { bitmap: bmp, type, quality: q, bg: type === 'image/jpeg' ? '#ffffff' : null })).blob; }
        finally { c.width = c.height = 0; }
        if (!blob || !blob.size) throw userErr('Не получилось сохранить картинку');
        return { blob, w, h, type, ext: type === 'image/jpeg' ? 'jpg' : type.split('/')[1] };
      } finally { busy(false); if (phone) W.recycle(); }   // телефон: поток с картинками закрыть — память сразу назад
    }
    // Маленькая картинка (превью в «Материалах», ≤ 160 px, JPEG data URL)
    function thumbDataURL(max = 160){
      const s = Math.min(1, max / Math.max(doc.w, doc.h));
      const c = drawLayers(doc.layers, s, doc.bg || '#ffffff', null);
      let url = ''; try { url = c.toDataURL('image/jpeg', 0.7); } catch (e) {}
      c.width = c.height = 0;
      return url.length < 24000 ? url : '';
    }
    // Значок слоя для панели
    function layerThumb(L, size = 44){
      const c = canvasOf(size, size), g = c.getContext('2d');
      if (L.type === 'raster' && L.canvas) {
        const src = L.obj.getElement ? L.obj.getElement() : L.canvas, k = Math.min(size / src.width, size / src.height);
        const w = src.width * k, h = src.height * k; g.drawImage(src, (size - w) / 2, (size - h) / 2, w, h);
      } else if (L.type === 'text') {
        g.fillStyle = L.obj.fill || '#fff'; g.font = `bold ${size * 0.62}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.strokeStyle = L.obj.stroke || 'transparent'; g.lineWidth = 2; if (L.obj.stroke) g.strokeText('T', size / 2, size / 2 + 1); g.fillText('T', size / 2, size / 2 + 1);
      }
      return c;
    }

    // ═══ Проект «.d37photo»: слои как есть (картинки — PNG без потерь или исходный файл нетронутого фото, надписи — текстом,
    //     коррекции и фильтры — числами). Формат и проверка чужого файла — D37PhotoCmds.packProject / readProject ═══
    async function encodePng(c){
      try { const bmp = await createImageBitmap(c); return (await W.run('encode', { bitmap: bmp, type: 'image/png' }, [bmp])).blob; }
      catch (e) { const bmp = await createImageBitmap(c); return (await W.local('encode', { bitmap: bmp, type: 'image/png' })).blob; }
    }
    async function saveProject(label){
      busy(true, label || 'Сохраняю проект…');
      try {
        const layers = [], parts = [];
        for (const L of doc.layers.slice()) {
          const s = snapL(L), o = { t: L.type, name: L.name, locked: !!L.locked, p: s.p };
          if (L.type === 'raster') {
            let b = L.src && L.src.rev === L.pxRev ? L.src.blob : null;
            const mime = b ? L.src.mime : 'image/png';
            if (!b) b = await encodePng(L.canvas);
            if (!b || !b.size) throw userErr('Не получилось сохранить слой «' + L.name + '»');
            Object.assign(o, { adj: s.adj, preset: s.preset, cw: L.canvas.width, ch: L.canvas.height, mime, part: parts.length });
            parts.push(b);
          }
          layers.push(o);
        }
        return PC.packProject({ w: doc.w, h: doc.h, name: doc.name, active: doc.layers.findIndex(L => L.id === doc.active), layers }, parts);
      } finally { busy(false); if (phone) W.recycle(); }
    }
    async function openProject(blob, name){
      busy(true, 'Открываю проект…');
      const made = [];
      try {
        const P = await PC.readProject(blob), m = P.meta;
        // проект больше, чем умеет это устройство (с компьютера на телефон): документ и слои меньше, на холсте всё там же
        const g = Math.min(1, B.maxSide / Math.max(m.w, m.h));
        const want = m.layers.reduce((s, l) => s + (l.t === 'raster' ? l.cw * l.ch : 0), 0) * g * g;
        const k = want > B.totalPixels * 0.9 ? Math.sqrt(B.totalPixels * 0.9 / want) : 1;
        let scaled = g < 1 || k < 1;
        for (const l of m.layers) {
          const p = Object.assign({}, l.p);
          if (p.left != null) p.left *= g;
          if (p.top != null) p.top *= g;
          let L;
          if (l.t === 'raster') {
            const part = P.part(l), r = await decode(part, Math.floor(l.cw * l.ch * g * g * k * k));
            if (r.canvas.width < l.cw * g * 0.999) scaled = true;
            L = mkRaster(r.canvas, { name: l.name });
            const f = l.cw / r.canvas.width;   // слой стал меньше в f раз — во столько же больше его масштаб
            p.scaleX = (p.scaleX != null ? p.scaleX : 1) * f * g; p.scaleY = (p.scaleY != null ? p.scaleY : 1) * f * g;
            L.adj = Object.assign({}, l.adj); L.preset = l.preset;   // фильтры наложит attach()
            keepSrc(L, part);
            applySnap(L, { name: l.name, locked: l.locked, p, adj: L.adj, preset: L.preset });
          } else {
            p.scaleX = (p.scaleX != null ? p.scaleX : 1) * g; p.scaleY = (p.scaleY != null ? p.scaleY : 1) * g;
            L = mkText({ text: p.text || 'Текст' });
            applySnap(L, { name: l.name, locked: l.locked, p });
          }
          made.push(L);
        }
        const act = made[m.active] || made[made.length - 1];
        replaceDoc('Открыть проект', () => setDoc({ w: Math.max(16, Math.round(m.w * g)), h: Math.max(16, Math.round(m.h * g)), bg: null,
          name: cleanName(m.name || name), active: act.id, layers: made }));
        fit(); baseSeq = hist.seq;
        if (scaled) toast('Проект уменьшен под память этого устройства (на холсте всё на своих местах)', 'warn');
        return { layers: made.length, w: doc.w, h: doc.h, scaled };
      } catch (e) {
        for (const L of made) release(L);
        throw e;
      } finally { busy(false); if (phone) W.recycle(); }
    }
    // ── Черновик: ушли из редактора с несохранённой работой — проект молча в «Мои материалы» (один, последний) ──
    const DRAFT_KEY = 'd37_pe_draft';
    const draftId = () => { try { return localStorage.getItem(DRAFT_KEY) || ''; } catch (e) { return ''; } };
    async function saveDraft(){
      if (hist.seq <= baseSeq || !doc.layers.length) return null;
      const A = assets(), seq = hist.seq;
      const blob = await saveProject('Сохраняю черновик…');
      // закреплён: чистка места («давно не открывали») черновик не тронет — он один (каждый новый заменяет прежний)
      const meta = { type: 'project', name: 'Черновик: ' + doc.name, tool: 'photo', w: doc.w, h: doc.h, thumb: thumbDataURL(), extra: { draft: 1 }, pinned: true };
      let rec = null; const id = draftId();
      if (id) { try { const old = await A.meta(id); if (old && old.type === 'project') rec = await A.replace(id, blob, meta); } catch (e) { rec = null; } }
      if (!rec) rec = await A.put(blob, meta);
      try { localStorage.setItem(DRAFT_KEY, rec.id); } catch (e) {}
      baseSeq = seq;
      emit('draft', rec);
      return rec;
    }
    async function findDraft(){
      const id = draftId(); if (!id || !root.D37Assets) return null;
      try { const m = await root.D37Assets.meta(id); return m && m.type === 'project' ? m : null; } catch (e) { return null; }
    }
    async function dropDraft(){
      const id = draftId(); if (!id) return;
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
      try { root.D37Assets && await root.D37Assets.remove(id); } catch (e) {}
    }

    // ═══ Отправить в «Студию 3D»: картинка → плоскость (OBJ + MTL + PNG) → «🧩 Модели» студии (js/engine/model.js) ═══
    async function toStudio3d(blob, w, h, name){
      if (!root.D37E || !root.D37E.models) {
        if (typeof root.gamesLoadScript === 'function') await root.gamesLoadScript('js/engine/model.js');
        else await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/engine/model.js'; s.onload = res; s.onerror = () => rej(userErr('Не загрузилась «Студия 3D»')); document.head.appendChild(s); });
      }
      const M = root.D37E && root.D37E.models; if (!M) throw userErr('«Студия 3D» недоступна');
      const a = h / w, Hm = (2 * a).toFixed(4);
      const obj = ['mtllib pic.mtl', 'v -1 0 0', 'v 1 0 0', `v 1 ${Hm} 0`, `v -1 ${Hm} 0`, 'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'vn 0 0 1', 'vn 0 0 -1',
        'usemtl pic', 'f 1/1/1 2/2/1 3/3/1 4/4/1', 'f 2/2/2 1/1/2 4/4/2 3/3/2'].join('\n');
      const mtl = ['newmtl pic', 'Kd 1 1 1', 'map_Kd pic.png'].join('\n');
      const model = await M.compile([{ name: 'pic.obj', data: obj }, { name: 'pic.mtl', data: mtl }, { name: 'pic.png', data: await blob.arrayBuffer() }], { name: String(name || 'Картинка').slice(0, 40) });
      await M.save(model);
      return { model: model.id };
    }

    // ═══ Состояние для кнопок и ИИ ═══
    function layerInfo(L){
      const o = L.obj, i = { id: L.id, type: L.type, name: L.name, visible: !!o.visible, opacity: Math.round((o.opacity == null ? 1 : o.opacity) * 100),
        blend: Object.keys(PC.BLENDS).find(k => PC.BLENDS[k] === o.globalCompositeOperation) || 'normal',
        x: Math.round(o.left), y: Math.round(o.top), w: Math.round(o.getScaledWidth()), h: Math.round(o.getScaledHeight()), angle: Math.round(o.angle || 0), locked: !!L.locked };
      if (L.type === 'raster') { const adj = {}; for (const k of PC.ADJ_KEYS) if (L.adj[k]) adj[k] = L.adj[k]; i.adj = adj; i.preset = L.preset; i.px = [L.canvas.width, L.canvas.height]; }
      else Object.assign(i, { text: o.text, size: Math.round(o.fontSize), color: o.fill, font: o.fontFamily, bold: o.fontWeight === 'bold', italic: o.fontStyle === 'italic', stroke: o.stroke || null, strokeWidth: o.strokeWidth || 0 });
      return i;
    }
    const docInfo = () => ({ w: doc.w, h: doc.h, bg: doc.bg || 'transparent', name: doc.name });
    function info(){
      return Object.assign(docInfo(), { active: doc.active, tool, zoom: Math.round(cv.getZoom() * 1000) / 1000,
        layers: doc.layers.map(layerInfo), undo: hist.done.length, redo: hist.undone.length,
        limits: { maxSide: B.maxSide, maxPixels: B.maxPixels } });
    }

    // ═══ Команды «d37 v1» (D37Tools) ═══
    const assets = () => { if (!root.D37Assets) throw userErr('Хранилище материалов не загружено'); return root.D37Assets; };
    const RUN = {
      info: () => info(),
      new: a => newDoc(a),
      open: async a => {
        const g = await assets().get(a.asset);
        if (g && g.meta.type === 'project') return openProject(g.blob, String(g.meta.name || '').replace(/^Черновик: /, ''));
        if (!g || g.meta.type !== 'image') throw userErr('Нет такой картинки в «Моих материалах»');
        return openBlob(g.blob, g.meta.name);
      },
      place: async a => { const g = await assets().get(a.asset); if (!g || g.meta.type !== 'image') throw userErr('Нет такой картинки в «Моих материалах»'); return placeBlob(g.blob, Object.assign({ fileName: g.meta.name }, a)); },
      crop: a => crop(a),
      resize: a => resizeImage(a),
      rotate: a => rotateImage(a.deg),
      flip: a => { if (a.layer === undefined) return flipImage(a.axis); const L = resolveLayer(a.layer); change('Отражение слоя', [L], () => L.obj.set(a.axis === 'h' ? { flipX: !L.obj.flipX } : { flipY: !L.obj.flipY })); return { layer: L.id }; },
      adjust: a => {
        const L = resolveLayer(a.layer, 'raster');
        change('Коррекция', [L], () => {
          if (a.reset) L.adj = {};
          for (const k of PC.ADJ_KEYS) if (a[k] !== undefined) L.adj[k] = a[k];
          applyFilters(L);
        });
        return { layer: L.id, adj: Object.assign({}, L.adj) };
      },
      filter: a => { const L = resolveLayer(a.layer, 'raster'); change('Фильтр', [L], () => { L.preset = a.preset; applyFilters(L); }); return { layer: L.id }; },
      auto: a => autoEnhance(resolveLayer(a.layer, 'raster')),
      removeBg: a => removeBg(resolveLayer(a.layer, 'raster')),
      text: a => { const L = mkText(a); addLayer(L, 'Надпись'); return { layer: L.id }; },
      textEdit: a => {
        const L = resolveLayer(a.layer, 'text');
        const p = textProps(a, L.obj); if (a.x != null) p.left = a.x; if (a.y != null) p.top = a.y;
        const set = () => { L.obj.set(p); L.obj.initDimensions && L.obj.initDimensions(); L.obj.setCoords(); if (a.name) L.name = a.name; else if (a.text) L.name = 'Т: ' + String(a.text).slice(0, 18); fontReady(L); };
        // только что созданная надпись: набранный текст — тем же шагом «Надпись» (одно «Отменить» убирает её целиком, как в Фотошопе)
        const top = hist.done[hist.done.length - 1];
        if (top && top.adds === L && Object.keys(a).every(k => k === 'layer' || k === 'text')) {
          dropRedo(); set(); L.rev++; afterChange(); emit('history', histState());
          return { layer: L.id };
        }
        change('Текст', [L], set);
        return { layer: L.id };
      },
      layerNew: a => {
        canHold(doc.w * doc.h);
        const c = canvasOf(doc.w, doc.h);
        if (a.fill) { const col = PC.color(a.fill); if (!col) throw userErr('Не понял цвет: ' + a.fill); const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, doc.w, doc.h); }
        const L = mkRaster(c, { name: a.name || 'Слой ' + (doc.layers.length + 1) });
        const A = activeLayer(); addLayer(L, 'Новый слой', A ? doc.layers.indexOf(A) + 1 : doc.layers.length);
        return { layer: L.id };
      },
      layer: a => {
        const L = resolveLayer(a.layer);
        change('Слой', [L], () => {
          const p = {};
          if (a.visible != null) p.visible = a.visible;
          if (a.opacity != null) p.opacity = a.opacity / 100;
          if (a.blend != null) p.globalCompositeOperation = PC.BLENDS[a.blend];
          if (a.x != null) p.left = a.x; if (a.y != null) p.top = a.y;
          if (a.scale != null) { const sx = Math.sign(L.obj.scaleX) || 1; p.scaleX = a.scale * sx; p.scaleY = a.scale; }
          if (a.angle != null) p.angle = a.angle;
          L.obj.set(p); L.obj.setCoords(); L.obj.dirty = true;
          if (a.name != null) L.name = a.name;
          if (a.locked != null) L.locked = a.locked;
        });
        return layerInfo(L);
      },
      layerOrder: a => orderLayer(resolveLayer(a.layer), a.to),
      layerDup: a => dupLayer(resolveLayer(a.layer)),
      layerDelete: a => { const L = resolveLayer(a.layer); removeLayer(L, 'Удалить слой'); return { layers: doc.layers.length }; },
      layerMerge: a => mergeDown(resolveLayer(a.layer)),
      flatten: () => flatten(),
      select: a => { const L = resolveLayer(a.layer); select(L.id); return { layer: L.id }; },
      fill: a => fillLayer(resolveLayer(a.layer, 'raster'), a.color),
      draw: a => draw(resolveLayer(a.layer, 'raster'), a),
      export: async a => {
        const r = await exportBlob(a);
        const name = String(a.name || doc.name || 'Картинка').slice(0, 60);
        const out = { w: r.w, h: r.h, bytes: r.blob.size, format: r.ext };
        if (a.to === 'download') { download(r.blob, name + '.' + r.ext); return out; }
        if (a.to === 'studio3d') { Object.assign(out, await toStudio3d(r.blob, r.w, r.h, name)); return out; }
        const meta = await assets().put(r.blob, { type: 'image', name, tool: 'photo', w: r.w, h: r.h, thumb: thumbDataURL() });
        out.asset = meta.id;
        return out;
      },
      undo: async () => ({ done: await undo() }),
      redo: async () => ({ done: await redo() }),
    };
    function download(blob, name){
      const u = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = u; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 30000);
    }
    // Команды по очереди: пока одна идёт (открыть фото, экспорт), следующая ждёт
    const serial = fn => (...args) => { const p = queue.then(() => fn(...args)); queue = p.catch(() => {}); return p; };
    const commands = {};
    for (const [name, sch] of Object.entries(PC.SCHEMAS)) commands[name] = Object.assign({}, sch, { run: serial(async (a, ctx) => {
      if (disposed) throw userErr('Редактор закрыт');
      const n0 = hist.seq;
      try { return await RUN[name](a); } finally { if (ctx) ctx.steps = hist.seq - n0; }   // ничего не поменялось — 0 шагов
    }) });
    let unreg = null;
    if (root.D37Tools) unreg = root.D37Tools.register('photo', { title: 'Фоторедактор', version: 1, describe: () => PC.DESCRIBE, state: info, undo: () => undo(), commands });
    function exec(cmd, args){ return root.D37Tools ? root.D37Tools.run('photo', cmd, args || {}, { via: 'ui' }) : Promise.resolve({ ok: false, error: 'D37Tools не загружен' }); }

    // ═══ Клавиши (компьютер) ═══
    function onKey(e){
      if (disposed || paused || e.defaultPrevented) return;   // paused — редактор скрыт (ушли в другой раздел, сохраняется черновик)
      const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.type === 'keyup') { if (e.code === 'Space') { spaceDown = false; cv.defaultCursor = tool === 'hand' ? 'grab' : cv.defaultCursor; } return; }
      if (typing) return;
      const A = activeLayer(), io = cv.getActiveObject();
      if (io && io.isEditing) return;
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      let h = true;
      if (mod && k === 'z') exec(e.shiftKey ? 'redo' : 'undo');
      else if (mod && k === 'y') exec('redo');
      else if (mod && (k === '0' || k === 'о')) fit();
      else if (mod && k === '1') zoomAt(1);
      else if (mod) h = false;
      else if (e.code === 'Space') { spaceDown = true; }
      else if (k === 'v' || k === 'м') setTool('move');
      else if (k === 'b' || k === 'и') setTool('brush');
      else if (k === 'e' || k === 'у') setTool('eraser');
      else if (k === 't' || k === 'е') setTool('text');
      else if (k === 'c' || k === 'с') setTool('crop');
      else if (k === 'h' || k === 'р') setTool('hand');
      else if (k === '[' || k === 'х') { brush.size = clamp(Math.round(brush.size / 1.2), 1, 1000); emit('brush', brush); cv.requestRenderAll(); }
      else if (k === ']' || k === 'ъ') { brush.size = clamp(Math.round(brush.size * 1.2) + 1, 1, 1000); emit('brush', brush); cv.requestRenderAll(); }
      else if (k === '+' || k === '=') zoomAt(cv.getZoom() * 1.25);
      else if (k === '-') zoomAt(cv.getZoom() / 1.25);
      else if ((k === 'delete' || k === 'backspace') && A && tool === 'move') exec('layerDelete', { layer: A.id });
      else if (k === 'enter' && tool === 'crop' && cropObj) exec('crop', cropRect());
      else if (k === 'escape' && tool === 'crop') setTool('move');
      else if (k.startsWith('arrow') && A && tool === 'move') {
        const d = e.shiftKey ? 10 : 1, dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
        exec('layer', { layer: A.id, x: A.obj.left + dx, y: A.obj.top + dy });
      } else h = false;
      if (h) { e.preventDefault(); e.stopPropagation(); }
    }
    root.addEventListener('keydown', onKey, true);
    root.addEventListener('keyup', onKey, true);

    // ═══ Закрыть: всё отпустить (холсты, поток, слушатели) ═══
    function dispose(){
      if (disposed) return;
      disposed = true;
      try { unreg && unreg(); } catch (e) {}
      ro && ro.disconnect();
      host.removeEventListener('pointerdown', onDown, true);
      root.removeEventListener('pointermove', onMove, true);
      root.removeEventListener('pointerup', onUp, true);
      root.removeEventListener('pointercancel', onUp, true);
      root.removeEventListener('keydown', onKey, true);
      root.removeEventListener('keyup', onKey, true);
      upper.removeEventListener('pointerleave', onLeave);
      if (filtT) cancelAnimationFrame(filtT);
      const all = new Set(doc.layers);
      for (const e of hist.done.concat(hist.undone)) { try { e.free && e.free('drop'); e.free && e.free('redo'); } catch (er) {} }
      hist.done = []; hist.undone = [];
      for (const L of all) { detach(L); release(L); }
      for (const L of all) release(L);
      // холсты fabric: после dispose — нулевой размер (память видеокарты отдаётся сразу, а не при сборке мусора)
      const lo = cv.lowerCanvasEl, up = cv.upperCanvasEl;
      try { Promise.resolve(cv.dispose()).then(() => { for (const c of [lo, up]) if (c) c.width = c.height = 0; }, () => {}); } catch (e) {}
      // фильтры fabric на видеокарте — одни на страницу (свой WebGL): закрыли редактор — отдать память видеокарты сразу
      try {
        const be = F.getFilterBackend && F.getFilterBackend(false);
        if (be) { const gl = be.gl; be.dispose && be.dispose(); try { gl && gl.getExtension('WEBGL_lose_context') && gl.getExtension('WEBGL_lose_context').loseContext(); } catch (e) {} F.setFilterBackend && F.setFilterBackend(undefined); }
      } catch (e) {}
      W.close();
      subs.clear();
      el.remove && el.remove();
      checker = null; stampCache.c = null;
    }

    // стартовый документ — пустой белый холст
    newDoc({ w: phone ? 1080 : 1280, h: phone ? 1350 : 720, bg: '#ffffff' });
    hist.done = []; hist.undone = []; hist.bytes = 0; dirty = false;
    syncTool();

    return {
      cv, doc, brush, B, info, exec, undo, redo, fit, zoomAt, panBy, setTool, get tool(){ return tool; }, select, layerById, activeLayer,
      layerInfo, layerThumb, thumbDataURL, previewFilters, applyFilters, cropRect, setCropAspect, get cropAspect(){ return cropAspect; },
      // файл с устройства (кнопки, перетащить, вставить) — в той же очереди, что и команды: не пересекаются с ними
      openBlob: serial(openBlob), placeBlob: serial(placeBlob), exportBlob: serial(exportBlob), toStudio3d, download, histState, get dirty(){ return dirty; }, set dirty(v){ dirty = !!v; },
      // проект и черновик: edited — есть работа после открытия/создания/сохранения; markSaved — сохранили (проектом)
      saveProject: serial(() => saveProject()), openProject: serial(openProject), saveDraft: serial(saveDraft), findDraft, dropDraft,
      get edited(){ return hist.seq > baseSeq; }, markSaved(){ baseSeq = hist.seq; dirty = false; emit('dirty', false); },
      pause(on){ paused = !!on; if (paused) { pts.clear(); gest = pan = null; if (stroke) { const st = stroke; stroke = null; strokeEnd(st); } } }, get paused(){ return paused; },
      get threaded(){ return W.threaded; }, on(f){ subs.add(f); return () => subs.delete(f); }, emit, toast, dispose, get disposed(){ return disposed; },
      _test: { hist, rasterPixels, renderLayers, strokeBegin, strokeTo, strokeEnd },
    };
  }

  root.D37PhotoCore = { create, maxTexture };
})(typeof window !== 'undefined' ? window : globalThis);
