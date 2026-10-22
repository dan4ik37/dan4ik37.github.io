// ═══════════════════════════════════════
//  🖼 ФОТОРЕДАКТОР — интерфейс (D37PhotoUI): панели, кнопки, телефон и компьютер, «📤 Отправить в…», «Мои материалы», ИИ
// ═══════════════════════════════════════
// Все кнопки, которые меняют работу, идут через команды «d37 v1» (E.exec → D37Tools.run) — тем же путём, что и ИИ; у каждого
// шага — «Отменить». Ползунки показывают сразу (без шага истории), а отпустил — одна команда. Раскладка: компьютер — инструменты
// слева, панель справа (≥ 1400 px — ещё столбик рекламы справа от панели, не поверх холста); телефон — холст, под ним панель
// и полоса инструментов. Стили — css/photo.css (pe-*). Монтирует js/apps/apps.js на разделе /photo.
(function (root) {
  'use strict';
  const PC = root.D37PhotoCmds;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MB = b => (b / 1048576 < 10 ? (b / 1048576).toFixed(1) : Math.round(b / 1048576)) + ' МБ';
  const TOOLS = [
    ['move', '✥', 'Двигать', 'V'], ['crop', '✂️', 'Обрезать', 'C'], ['brush', '🖌️', 'Кисть', 'B'], ['eraser', '🧽', 'Ластик', 'E'],
    ['text', '🔤', 'Текст', 'T'], ['adjust', '🎛️', 'Коррекция'], ['filters', '✨', 'Фильтры'], ['layers', '🗂️', 'Слои'], ['image', '🖼️', 'Размер'],
  ];
  const PANEL_TOOLS = new Set(['adjust', 'filters', 'layers', 'image']);
  const NEW_PRESETS = [['1080×1080', 1080, 1080, 'Квадрат'], ['1080×1350', 1080, 1350, 'Пост'], ['1080×1920', 1080, 1920, 'Шортс / сторис'],
    ['1280×720', 1280, 720, 'Превью YouTube'], ['1920×1080', 1920, 1080, 'Full HD']];
  const SWATCHES = ['#ffffff', '#000000', '#ff3b5c', '#ff8a00', '#ffe000', '#22c55e', '#22b8ff', '#1e50ff', '#8a3cf0', '#ff5fa8', '#8b4513', '#808080'];
  const FILTER_ICON = { none: '⭕', bw: '⚫', sepia: '🟤', vintage: '📜', kodachrome: '🎞️', technicolor: '🌈', polaroid: '📷', brownie: '🍫', invert: '🔁' };

  function mount(host, o = {}){
    const phone = (() => { try { return matchMedia('(pointer: coarse)').matches || innerWidth < 900; } catch (e) { return false; } })();
    host.innerHTML = `
<div class="pe" data-tool="move" role="application" aria-label="Фоторедактор">
  <div class="pe-top">
    <button type="button" class="pe-btn" data-a="menu" title="Файл" aria-label="Файл">☰</button>
    <div class="pe-title" aria-live="polite"><b>Фоторедактор</b><span></span></div>
    <button type="button" class="pe-btn" data-a="undo" title="Отменить (Ctrl+Z)" aria-label="Отменить" disabled>↶</button>
    <button type="button" class="pe-btn" data-a="redo" title="Вернуть (Ctrl+Y)" aria-label="Вернуть" disabled>↷</button>
    <button type="button" class="pe-btn" data-a="ai" title="ИИ-помощник: скажи, что сделать" aria-label="ИИ-помощник">🤖</button>
    <button type="button" class="pe-btn pe-acc" data-a="send" title="Сохранить или отправить" aria-label="Сохранить или отправить">📤<span class="pe-lbl"> Сохранить</span></button>
    <button type="button" class="pe-btn" data-a="full" title="Во весь экран" aria-label="Во весь экран">⛶</button>
  </div>
  <div class="pe-main">
    <div class="pe-tools" role="toolbar" aria-label="Инструменты">${TOOLS.map(([id, ic, t, k]) => `<button type="button" class="pe-tool" data-tool="${id}" title="${t}${k ? ' (' + k + ')' : ''}" aria-label="${t}"><i>${ic}</i><span>${t}</span></button>`).join('')}</div>
    <div class="pe-stage">
      <div class="pe-stage-in"></div>
      <button type="button" class="pe-zoom" data-a="fit" title="Вписать в экран (Ctrl+0)">100%</button>
      <div class="pe-start" hidden></div>
      <div class="pe-busy" hidden><i></i><span></span></div>
      <div class="pe-toasts" aria-live="polite"></div>
    </div>
    <div class="pe-panel"><div class="pe-ph"><b></b><button type="button" class="pe-btn pe-pclose" data-a="pclose" aria-label="Свернуть панель">▾</button></div><div class="pe-pb"></div></div>
    <aside class="pe-ad" aria-label="Реклама"><div class="pe-ad-in"></div></aside>
  </div>
  <input type="file" accept="image/*" class="pe-file" hidden>
</div>`;
    const $ = s => host.querySelector(s), pe = $('.pe'), fileIn = $('.pe-file');
    document.body.classList.add('pe-on');
    const ui = { panel: phone ? '' : 'layers', drag: null, fileMode: 'open', toasts: 0, ratio: true, menu: null, startShown: false };

    // ── место под шапкой сайта ──
    function place(){
      const nav = document.getElementById('nav');
      const top = pe.classList.contains('gs-fs') || !nav ? 0 : Math.max(0, Math.round(nav.getBoundingClientRect().bottom));
      pe.style.setProperty('--pe-top', top + 'px');
    }
    place();
    const onResize = () => { place(); adCheck(); };
    root.addEventListener('resize', onResize);

    // ── движок (его события приходят уже во время создания — всё, что они трогают, объявлено выше) ──
    let E = null, paintT = 0;
    const want = new Set();
    function later(what){ want.add(what); if (paintT) return; paintT = requestAnimationFrame(() => { paintT = 0; if (!E || E.disposed) return; const w = new Set(want); want.clear(); if (w.has('title')) paintTitle(); if (w.has('hist')) paintHist(); if (w.has('panel')) paintPanel(); }); }
    try { E = root.D37PhotoCore.create($('.pe-stage-in'), { workerUrl: o.workerUrl, fabricUrl: o.fabricUrl, ai: o.ai, onEvent }); }
    catch (e) { $('.pe-stage-in').innerHTML = `<div class="pe-fail">⚠️ ${esc(e.message || e)}<br><small>Обнови страницу или открой в Chrome / Яндекс Браузере.</small></div>`; return { active: false, unmount(){ root.removeEventListener('resize', onResize); document.body.classList.remove('pe-on'); host.innerHTML = ''; } }; }
    const api = { E, active: true, open: (blob, name) => openFile(blob, name) };
    root.D37Photo = api;

    function onEvent(type, d){
      if (!E && type !== 'toast' && type !== 'busy' && type !== 'zoom') { later('title'); later('hist'); later('panel'); return; }
      if (type === 'toast') toast(d.msg, d.kind);
      else if (type === 'busy') { const b = $('.pe-busy'); b.hidden = !d.on; b.querySelector('span').textContent = d.text || ''; }
      else if (type === 'history') later('hist');
      else if (type === 'doc' || type === 'dirty') later('title');
      else if (type === 'zoom') $('.pe-zoom').textContent = Math.round(d * 100) + '%';
      else if (type === 'tool') { pe.dataset.tool = d; paintTools(); if (!PANEL_TOOLS.has(ui.panel)) { ui.panel = d === 'move' && phone ? '' : 'tool'; } later('panel'); }
      else if (type === 'layers' || type === 'active' || type === 'crop' || type === 'brush') { if (!ui.drag) later('panel'); }
      else if (type === 'textEdit') { ui.panel = 'tool'; later('panel'); setTimeout(() => { const t = $('.pe-pb textarea'); if (t) { t.focus(); t.select(); } }, 60); }
    }

    // ── заголовок, отмена ──
    function paintTitle(){ const i = E.info(); $('.pe-title span').textContent = `${i.name} · ${i.w}×${i.h}${E.dirty ? ' •' : ''}`; }
    function paintHist(){ const h = E.histState(); $('[data-a="undo"]').disabled = !h.undo; $('[data-a="redo"]').disabled = !h.redo; $('[data-a="undo"]').title = h.label ? `Отменить: ${h.label} (Ctrl+Z)` : 'Отменить (Ctrl+Z)'; paintTitle(); }
    function paintTools(){
      for (const b of host.querySelectorAll('.pe-tool')) {
        const id = b.dataset.tool, on = PANEL_TOOLS.has(id) ? ui.panel === id : (E.tool === id && !PANEL_TOOLS.has(ui.panel));
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      }
    }

    // ── уведомления ──
    function toast(msg, kind){
      const box = $('.pe-toasts'); if (!box) return;
      const t = document.createElement('div'); t.className = 'pe-toast ' + (kind || ''); t.textContent = msg;
      box.appendChild(t);
      while (box.children.length > 3) box.firstChild.remove();
      setTimeout(() => t.classList.add('out'), kind === 'warn' || kind === 'err' ? 5200 : 3200);
      setTimeout(() => t.remove(), kind === 'warn' || kind === 'err' ? 5700 : 3700);
    }
    async function run(cmd, args, okMsg){
      const r = await E.exec(cmd, args);
      if (!r.ok) toast('⚠ ' + r.error, 'err');
      else if (okMsg) toast(okMsg, 'ok');
      return r;
    }

    // ═══ Панели ═══
    const A = () => E.activeLayer();
    // Коррекция и фильтры — для слоя-картинки: выбран слой-надпись → верхний слой-картинка
    const RT = () => { const L = A(); if (L && L.type === 'raster') return L; const ls = E.doc.layers; for (let i = ls.length - 1; i >= 0; i--) if (ls[i].type === 'raster') return ls[i]; return null; };
    const slider = (k, label, min, max, val, step) => `<label class="pe-sl"><span>${esc(label)}<b data-v="${k}">${val}</b></span><input type="range" min="${min}" max="${max}" step="${step || 1}" value="${val}" data-k="${k}"></label>`;
    function paintPanel(){
      const pb = $('.pe-pb'), ph = $('.pe-ph b');
      pe.classList.toggle('pe-sheet-on', !!ui.panel);
      paintTools();
      if (!ui.panel) { pb.innerHTML = ''; ph.textContent = ''; return; }
      const p = ui.panel === 'tool' ? E.tool : ui.panel, L = A();
      let h = '', title = '';
      if (p === 'move') {
        title = '✥ Двигать';
        h = (L && L.locked ? `<p class="pe-warn">🔒 «${esc(L.name)}» закреплён. <button type="button" class="pe-mini" data-lock="${L.id}">🔓 Двигать его</button></p>` : '') +
          `<p class="pe-hint">Нажми на слой и тяни. Уголки — размер, кружок сверху — поворот.${phone ? ' Двумя пальцами — приблизить и сдвинуть.' : ' Колесо — масштаб, пробел + мышь — сдвиг.'}</p>` + layerQuick(L);
      } else if (p === 'brush' || p === 'eraser') {
        const b = E.brush;
        title = p === 'brush' ? '🖌️ Кисть' : '🧽 Ластик';
        h = (L && L.type !== 'raster' ? `<p class="pe-warn">Выбран слой-надпись. Рисуют на картинке: <button type="button" class="pe-mini" data-a="layerNew">➕ Новый слой</button></p>` : '') +
          slider('bsize', 'Размер', 1, 400, b.size) + slider('bhard', 'Жёсткость', 0, 100, b.hardness) + slider('bop', 'Непрозрачность', 1, 100, b.opacity) +
          (p === 'brush' ? colorRow('bcolor', b.color) : '') +
          `<p class="pe-hint">${phone ? 'Веди пальцем по фото. Два пальца — масштаб (рисунок не испортится).' : 'Веди мышью. [ и ] — размер кисти.'}</p>`;
      } else if (p === 'crop') {
        const r = E.cropRect();
        title = '✂️ Обрезать';
        h = `<div class="pe-chips">${[['', 'Свободно'], ['1:1', '1:1'], ['4:5', '4:5'], ['9:16', '9:16 шортс'], ['16:9', '16:9'], ['4:3', '4:3'], ['3:4', '3:4']].map(([a, t]) => `<button type="button" class="pe-chip${E.cropAspect === a ? ' on' : ''}" data-crop="${a}">${t}</button>`).join('')}</div>
          <p class="pe-hint">${r ? `${r.w} × ${r.h} пикселей` : ''}. Тяни рамку за уголки и середину.</p>
          <div class="pe-row"><button type="button" class="pe-big pe-acc" data-a="cropOk">✓ Обрезать</button><button type="button" class="pe-big" data-a="cropNo">✕ Отмена</button></div>`;
      } else if (p === 'text') {
        title = '🔤 Текст';
        if (!L || L.type !== 'text') h = `<p class="pe-hint">Нажми на фото — там появится надпись. Или:</p><div class="pe-row"><button type="button" class="pe-big pe-acc" data-a="textNew">➕ Надпись по центру</button></div>`;
        else {
          const ob = L.obj;
          h = `<textarea class="pe-text" maxlength="500" rows="2" aria-label="Текст надписи">${esc(ob.text)}</textarea>
            <label class="pe-sel"><span>Шрифт</span><select data-t="font">${PC.FONT_NAMES.map(f => `<option${f === ob.fontFamily ? ' selected' : ''} style="font-family:'${esc(f)}'">${esc(f)}</option>`).join('')}</select></label>
            ${slider('tsize', 'Размер', 8, Math.max(400, Math.round(E.doc.h / 2)), Math.round(ob.fontSize))}
            ${colorRow('tcolor', ob.fill)}
            <div class="pe-row pe-toggles">
              <button type="button" class="pe-mini${ob.fontWeight === 'bold' ? ' on' : ''}" data-t="bold"><b>Ж</b></button>
              <button type="button" class="pe-mini${ob.fontStyle === 'italic' ? ' on' : ''}" data-t="italic"><i>К</i></button>
              <button type="button" class="pe-mini${ob.shadow ? ' on' : ''}" data-t="shadow">Тень</button>
              ${['left', 'center', 'right'].map(al => `<button type="button" class="pe-mini${ob.textAlign === al ? ' on' : ''}" data-t="align" data-v="${al}">${al === 'left' ? '⇤' : al === 'center' ? '↔' : '⇥'}</button>`).join('')}
            </div>
            ${slider('tstroke', 'Обводка', 0, 40, Math.round(ob.strokeWidth || 0))}
            <label class="pe-sel"><span>Цвет обводки</span><input type="color" data-t="stroke" value="${esc(String(ob.stroke || '#000000').slice(0, 7))}"></label>
            <div class="pe-row"><button type="button" class="pe-mini" data-a="textNew">➕ Ещё надпись</button></div>`;
        }
      } else if (p === 'adjust') {
        title = '🎛️ Коррекция';
        const R = RT();
        if (!R) h = '<p class="pe-hint">Нет слоя-картинки — открой фото.</p>';
        else h = `<p class="pe-hint">Слой: <b>${esc(R.name)}</b></p><div class="pe-row"><button type="button" class="pe-big pe-acc" data-a="auto">✨ Авто</button><button type="button" class="pe-big" data-a="adjReset">↺ Сбросить</button></div>` +
          `<div class="pe-row"><button type="button" class="pe-big" data-a="removeBg" title="ИИ прямо в браузере — фото никуда не отправляется">🪄 Убрать фон (ИИ)</button></div>` +
          PC.ADJ_KEYS.map(k => slider('adj:' + k, PC.ADJ[k].ru, PC.ADJ[k].min, PC.ADJ[k].max, R.adj[k] || 0)).join('') +
          '<p class="pe-hint">Коррекции не портят фото — их можно поменять в любой момент.</p>';
      } else if (p === 'filters') {
        title = '✨ Фильтры';
        const R = RT();
        if (!R) h = '<p class="pe-hint">Нет слоя-картинки — открой фото.</p>';
        else h = `<p class="pe-hint">Слой: <b>${esc(R.name)}</b></p><div class="pe-grid">${Object.entries(PC.PRESETS).map(([k, t]) => `<button type="button" class="pe-flt${R.preset === k ? ' on' : ''}" data-preset="${k}"><i>${FILTER_ICON[k] || '✨'}</i><span>${esc(t)}</span></button>`).join('')}</div>`;
      } else if (p === 'layers') {
        title = '🗂️ Слои';
        const list = E.doc.layers.slice().reverse();
        h = `<div class="pe-lrow">
            <button type="button" class="pe-mini" data-a="layerNew" title="Новый пустой слой">➕ Слой</button>
            <button type="button" class="pe-mini" data-a="placeFile" title="Добавить фото слоем">🖼 Фото</button>
            <button type="button" class="pe-mini" data-a="textNew" title="Добавить надпись">🔤 Текст</button>
          </div>
          <ul class="pe-layers">${list.map(Lr => `<li class="pe-layer${Lr.id === E.doc.active ? ' on' : ''}" data-id="${Lr.id}">
            <span class="pe-lthumb" data-thumb="${Lr.id}"></span><span class="pe-lname">${esc(Lr.name)}</span>
            <button type="button" class="pe-eye${Lr.locked ? '' : ' off'}" data-lock="${Lr.id}" aria-label="${Lr.locked ? 'Открепить' : 'Закрепить'} слой" title="${Lr.locked ? 'Закреплён — рукой не сдвинуть' : 'Можно двигать рукой'}">${Lr.locked ? '🔒' : '🔓'}</button>
            <button type="button" class="pe-eye${Lr.obj.visible ? '' : ' off'}" data-eye="${Lr.id}" aria-label="${Lr.obj.visible ? 'Скрыть' : 'Показать'} слой">${Lr.obj.visible ? '👁' : '◌'}</button></li>`).join('')}</ul>` +
          (L ? layerQuick(L) + `<div class="pe-lrow">
            <button type="button" class="pe-mini" data-a="lUp" title="Выше">⬆</button><button type="button" class="pe-mini" data-a="lDown" title="Ниже">⬇</button>
            <button type="button" class="pe-mini" data-a="lDup" title="Копия">⧉ Копия</button><button type="button" class="pe-mini" data-a="lMerge" title="Объединить с нижним">⤓ Объединить</button>
            <button type="button" class="pe-mini" data-a="flatten" title="Свести все слои">≡ Свести</button></div>` : '');
      } else if (p === 'image') {
        const i = E.info();
        title = '🖼️ Размер и поворот';
        h = `<div class="pe-size"><label>Ширина<input type="number" min="16" max="${E.B.maxSide}" value="${i.w}" data-s="w"></label>
            <button type="button" class="pe-mini${ui.ratio ? ' on' : ''}" data-a="ratio" title="Сохранять пропорции">🔗</button>
            <label>Высота<input type="number" min="16" max="${E.B.maxSide}" value="${i.h}" data-s="h"></label></div>
          <div class="pe-chips"><button type="button" class="pe-chip" data-scale="0.5">50%</button><button type="button" class="pe-chip" data-long="1080">1080</button><button type="button" class="pe-chip" data-long="1920">1920</button><button type="button" class="pe-chip" data-long="2048">2048</button></div>
          <div class="pe-row"><button type="button" class="pe-big pe-acc" data-a="resize">Применить размер</button></div>
          <div class="pe-row"><button type="button" class="pe-big" data-rot="-90">⟲ 90°</button><button type="button" class="pe-big" data-rot="90">⟳ 90°</button><button type="button" class="pe-big" data-rot="180">180°</button></div>
          <div class="pe-row"><button type="button" class="pe-big" data-flip="h">⇋ Отразить</button><button type="button" class="pe-big" data-flip="v">⇵ Отразить</button></div>
          <p class="pe-hint">Новый холст:</p><div class="pe-chips">${NEW_PRESETS.map(([t, w, hh, d]) => `<button type="button" class="pe-chip" data-new="${w}x${hh}" title="${esc(d)}">${t}</button>`).join('')}</div>
          <p class="pe-hint">Предел этого устройства: ${E.B.maxSide} пикселей по стороне.</p>`;
      }
      ph.textContent = title;
      pb.innerHTML = h;
      for (const s of pb.querySelectorAll('[data-thumb]')) { const Lr = E.layerById(+s.dataset.thumb); if (Lr) s.appendChild(E.layerThumb(Lr, 40)); }
    }
    function colorRow(k, cur){
      return `<div class="pe-colors" role="group" aria-label="Цвет">${SWATCHES.map(c => `<button type="button" class="pe-sw${String(cur).toLowerCase() === c ? ' on' : ''}" data-c="${k}" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}<input type="color" data-c="${k}" value="${esc(String(cur || '#000000').slice(0, 7))}" aria-label="Свой цвет"></div>`;
    }
    function layerQuick(L){
      if (!L) return '';
      const op = Math.round((L.obj.opacity == null ? 1 : L.obj.opacity) * 100), bl = Object.keys(PC.BLENDS).find(k => PC.BLENDS[k] === L.obj.globalCompositeOperation) || 'normal';
      return `<div class="pe-quick">${slider('lop', 'Непрозрачность', 0, 100, op)}
        <label class="pe-sel"><span>Наложение</span><select data-l="blend">${Object.keys(PC.BLENDS).map(k => `<option value="${k}"${k === bl ? ' selected' : ''}>${esc(PC.BLEND_RU[k])}</option>`).join('')}</select></label>
        <div class="pe-row"><button type="button" class="pe-mini" data-a="lFlipH">⇋</button><button type="button" class="pe-mini" data-a="lFlipV">⇵</button><button type="button" class="pe-mini pe-danger" data-a="lDel">🗑 Удалить</button></div></div>`;
    }

    // ── ползунки: показываем сразу, отпустил — одна команда ──
    function onInput(e){
      const t = e.target, k = t.dataset.k, L = A();
      if (!k) {
        if (t.dataset.c && t.type === 'color') previewColor(t.dataset.c, t.value);
        if (t.classList.contains('pe-text') && L && L.type === 'text') { if (!ui.drag) ui.drag = { k: 'text', L, v0: L.obj.text }; L.obj.set('text', t.value || ' '); L.obj.initDimensions && L.obj.initDimensions(); L.obj.setCoords(); E.cv.requestRenderAll(); }
        return;
      }
      const v = +t.value;
      const out = t.closest('.pe-sl') && t.closest('.pe-sl').querySelector('b'); if (out) out.textContent = v;
      if (k === 'bsize') { E.brush.size = v; return; }
      if (k === 'bhard') { E.brush.hardness = v; return; }
      if (k === 'bop') { E.brush.opacity = v; return; }
      if (!L) return;
      if (k.startsWith('adj:')) { const R = (ui.drag && ui.drag.L) || RT(); if (!R) return; if (!ui.drag) ui.drag = { k, L: R, v0: Object.assign({}, R.adj) }; R.adj[k.slice(4)] = v; E.previewFilters(R); }
      else if (k === 'lop') { if (!ui.drag) ui.drag = { k, L, v0: L.obj.opacity }; L.obj.set('opacity', v / 100); L.obj.dirty = true; E.cv.requestRenderAll(); }
      else if (k === 'tsize' && L.type === 'text') { if (!ui.drag) ui.drag = { k, L, v0: L.obj.fontSize }; L.obj.set('fontSize', v); L.obj.initDimensions && L.obj.initDimensions(); L.obj.setCoords(); E.cv.requestRenderAll(); }
      else if (k === 'tstroke' && L.type === 'text') { if (!ui.drag) ui.drag = { k, L, v0: L.obj.strokeWidth }; L.obj.set('strokeWidth', v); E.cv.requestRenderAll(); }
    }
    function onChange(e){
      const t = e.target, k = t.dataset.k, d = ui.drag;
      if (t.classList.contains('pe-text')) { commitText(t.value); return; }
      if (t.dataset.c && t.type === 'color') { commitColor(t.dataset.c, t.value); return; }
      if (t.dataset.t === 'font') { const L = A(); if (L) run('textEdit', { layer: L.id, font: t.value }); return; }
      if (t.dataset.t === 'stroke') { const L = A(); if (L) run('textEdit', { layer: L.id, stroke: t.value }); return; }
      if (t.dataset.l === 'blend') { const L = A(); if (L) run('layer', { layer: L.id, blend: t.value }); return; }
      if (t.dataset.s) { sizeLinked(t); return; }
      if (!k || !d || d.k !== k) { ui.drag = null; return; }
      ui.drag = null;
      const L = d.L, v = +t.value;
      if (k.startsWith('adj:')) { L.adj = d.v0; E.applyFilters(L); run('adjust', { layer: L.id, [k.slice(4)]: v }); }
      else if (k === 'lop') { L.obj.set('opacity', d.v0); run('layer', { layer: L.id, opacity: v }); }
      else if (k === 'tsize') { L.obj.set('fontSize', d.v0); run('textEdit', { layer: L.id, size: v }); }
      else if (k === 'tstroke') { L.obj.set('strokeWidth', d.v0); run('textEdit', { layer: L.id, strokeWidth: v }); }
    }
    function commitText(v){
      const d = ui.drag, L = A(); ui.drag = null;
      if (!L || L.type !== 'text') return;
      if (d && d.k === 'text') L.obj.set('text', d.v0);
      if (String(v).trim()) run('textEdit', { layer: L.id, text: String(v).slice(0, 500) });
      else { L.obj.initDimensions && L.obj.initDimensions(); E.cv.requestRenderAll(); }
    }
    function previewColor(k, v){ if (k === 'bcolor') E.brush.color = v; else if (k === 'tcolor') { const L = A(); if (L && L.type === 'text') { if (!ui.drag) ui.drag = { k: 'tcolor', L, v0: L.obj.fill }; L.obj.set('fill', v); E.cv.requestRenderAll(); } } }
    function commitColor(k, v){
      if (k === 'bcolor') { E.brush.color = v; later('panel'); return; }
      const L = A(), d = ui.drag; ui.drag = null;
      if (k === 'tcolor' && L && L.type === 'text') { if (d && d.k === 'tcolor') L.obj.set('fill', d.v0); run('textEdit', { layer: L.id, color: v }); }
    }
    function sizeLinked(t){
      const i = E.info(), w = $('[data-s="w"]'), h = $('[data-s="h"]');
      if (!ui.ratio) return;
      if (t.dataset.s === 'w') h.value = Math.max(1, Math.round(+w.value * i.h / i.w));
      else w.value = Math.max(1, Math.round(+h.value * i.w / i.h));
    }

    // ═══ Нажатия ═══
    async function onClick(e){
      const b = e.target.closest('button, [data-id]'); if (!b || !host.contains(b)) return;
      if (b.closest('.pe-menu')) return;   // меню — своим обработчиком
      const L = A();
      if (b.dataset.tool) {
        const id = b.dataset.tool;
        if (PANEL_TOOLS.has(id)) { ui.panel = ui.panel === id && phone ? '' : id; if (id === 'adjust' || id === 'filters') { if (E.tool !== 'move' && E.tool !== 'hand') E.setTool('move'); } paintPanel(); return; }
        if (E.tool === id && ui.panel === 'tool' && phone) { ui.panel = ''; paintPanel(); return; }
        ui.panel = id === 'move' && phone ? '' : 'tool';
        E.setTool(id); paintPanel(); return;
      }
      if (b.dataset.eye) { const Lr = E.layerById(+b.dataset.eye); if (Lr) run('layer', { layer: Lr.id, visible: !Lr.obj.visible }); return; }
      if (b.dataset.lock) { const Lr = E.layerById(+b.dataset.lock); if (Lr) run('layer', { layer: Lr.id, locked: !Lr.locked }); return; }
      if (b.dataset.id && !b.dataset.a) { run('select', { layer: +b.dataset.id }); return; }
      if (b.dataset.crop !== undefined) { E.setCropAspect(b.dataset.crop); later('panel'); return; }
      if (b.dataset.preset) { const R = RT(); if (R) run('filter', { layer: R.id, preset: b.dataset.preset }); return; }
      if (b.dataset.rot) { run('rotate', { deg: +b.dataset.rot }); return; }
      if (b.dataset.flip) { run('flip', { axis: b.dataset.flip }); return; }
      if (b.dataset.new) { const [w, h] = b.dataset.new.split('x').map(Number); await newCanvas(w, h); return; }
      if (b.dataset.scale) { const i = E.info(); $('[data-s="w"]').value = Math.round(i.w * +b.dataset.scale); $('[data-s="h"]').value = Math.round(i.h * +b.dataset.scale); return; }
      if (b.dataset.long) { const i = E.info(), k = +b.dataset.long / Math.max(i.w, i.h); $('[data-s="w"]').value = Math.round(i.w * k); $('[data-s="h"]').value = Math.round(i.h * k); return; }
      if (b.dataset.c && b.dataset.v) { previewColor(b.dataset.c, b.dataset.v); commitColor(b.dataset.c, b.dataset.v); if (b.dataset.c === 'bcolor') later('panel'); return; }
      if (b.dataset.t) {
        if (!L || L.type !== 'text') return;
        const t = b.dataset.t, ob = L.obj;
        if (t === 'bold') run('textEdit', { layer: L.id, bold: ob.fontWeight !== 'bold' });
        else if (t === 'italic') run('textEdit', { layer: L.id, italic: ob.fontStyle !== 'italic' });
        else if (t === 'shadow') run('textEdit', { layer: L.id, shadow: !ob.shadow });
        else if (t === 'align') run('textEdit', { layer: L.id, align: b.dataset.v });
        return;
      }
      const a = b.dataset.a;
      if (!a) return;
      if (a === 'undo') run('undo');
      else if (a === 'redo') run('redo');
      else if (a === 'fit') E.fit();
      else if (a === 'full') { if (root.D37Full) { await root.D37Full.toggle(pe, { api: true }); setTimeout(place, 60); } }
      else if (a === 'menu') openMenu(b, fileMenu());
      else if (a === 'send') openMenu(b, sendMenu());
      else if (a === 'ai') openAI();
      else if (a === 'pclose') { ui.panel = ''; paintPanel(); }
      else if (a === 'cropOk') { const r = E.cropRect(); if (r) run('crop', r); }
      else if (a === 'cropNo') E.setTool('move');
      else if (a === 'textNew') { const r = await run('text', { text: 'Текст' }); if (r.ok) { ui.panel = 'tool'; E.setTool('text'); E.emit('textEdit', r.result.layer); } }
      else if (a === 'layerNew') run('layerNew', {});
      else if (a === 'placeFile') { ui.fileMode = 'place'; fileIn.click(); }
      else if (a === 'auto') { const R = RT(); if (R) run('auto', { layer: R.id }, '✨ Готово — можно подправить ползунками'); }
      else if (a === 'adjReset') { const R = RT(); if (R) run('adjust', { layer: R.id, reset: true }); }
      else if (a === 'removeBg') {
        const R = RT(); if (!R) return;
        let asked = false; try { asked = !!localStorage.getItem('d37_pe_ai'); } catch (er) {}
        // первый раз — предупредить про загрузку (~8 МБ, дальше из кэша браузера); второе нажатие — начать
        if (!asked && !b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '🪄 Скачает ~8 МБ один раз — нажми ещё раз'; return; }
        try { localStorage.setItem('d37_pe_ai', '1'); } catch (er) {}
        run('removeBg', { layer: R.id }, '🪄 Фон убран — проверь края; «↶» вернёт как было');
      }
      else if (a === 'lUp' || a === 'lDown') { if (L) run('layerOrder', { layer: L.id, to: a === 'lUp' ? 'up' : 'down' }); }
      else if (a === 'lDup') { if (L) run('layerDup', { layer: L.id }); }
      else if (a === 'lMerge') { if (L) run('layerMerge', { layer: L.id }); }
      else if (a === 'flatten') run('flatten', {});
      else if (a === 'lDel') { if (L) run('layerDelete', { layer: L.id }); }
      else if (a === 'lFlipH' || a === 'lFlipV') { if (L) run('flip', { axis: a === 'lFlipH' ? 'h' : 'v', layer: L.id }); }
      else if (a === 'ratio') { ui.ratio = !ui.ratio; b.classList.toggle('on', ui.ratio); }
      else if (a === 'resize') { const w = +$('[data-s="w"]').value, h = +$('[data-s="h"]').value; if (w >= 16 && h >= 16) run('resize', ui.ratio ? { w } : { w, h }); }
      else if (a === 'open') { ui.fileMode = 'open'; fileIn.click(); }
      else if (a === 'assets') openAssets('open');
      else if (a === 'startClose') hideStart();
    }
    async function newCanvas(w, h){
      if (E.dirty && root.GameKit && root.GameKit.ask) { if (!await root.GameKit.ask('Начать новый холст? Текущую работу можно вернуть кнопкой «↶ Отменить».')) return; }
      const r = await run('new', { w, h, bg: '#ffffff' });
      if (r.ok) { hideStart(); E.setTool('move'); }
    }

    // ── открыть фото: файл, перетащить, вставить ──
    // ui.fileMode: 'open' — вместо текущей работы (отменяется), 'place' — новым слоем, 'auto' (перетащили, вставили) — открыть,
    // если холст ещё чистый, иначе слоем
    async function openFile(blob, name){
      if (!blob) return;
      hideStart();
      const mode = ui.fileMode === 'auto' ? (E.dirty ? 'place' : 'open') : ui.fileMode;
      ui.fileMode = 'open';
      if (mode === 'place') return placeBlob(blob, name);
      try { await E.openBlob(blob, name); } catch (er) { toast('⚠ ' + (er.message || er), 'err'); }
    }
    async function placeBlob(blob, name){
      try {
        if (!root.D37Assets) return E.placeBlob(blob, { fileName: name });
        // через «Мои материалы» — тем же путём, что и команда place (ИИ сможет повторить)
        const meta = await root.D37Assets.put(blob, { type: 'image', name: name || 'Картинка', tool: 'photo' });
        return run('place', { asset: meta.id });
      } catch (er) { toast('⚠ ' + (er.message || er), 'err'); }
    }
    fileIn.addEventListener('change', () => { const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (f) openFile(f, f.name); });
    const stage = $('.pe-stage');
    const onDragOver = e => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); stage.classList.add('pe-drop'); } };
    const onDragLeave = () => stage.classList.remove('pe-drop');
    const onDrop = e => { stage.classList.remove('pe-drop'); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return; e.preventDefault(); if (/^image\//.test(f.type)) { ui.fileMode = 'auto'; openFile(f, f.name); } else toast('Это не картинка', 'warn'); };
    stage.addEventListener('dragover', onDragOver); stage.addEventListener('dragleave', onDragLeave); stage.addEventListener('drop', onDrop);
    const onPaste = e => {
      const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const it = [...((e.clipboardData && e.clipboardData.items) || [])].find(x => x.kind === 'file' && /^image\//.test(x.type));
      if (!it) return; e.preventDefault(); ui.fileMode = 'auto'; openFile(it.getAsFile(), 'Вставка');
    };
    root.addEventListener('paste', onPaste);

    // ── стартовая карточка ──
    function showStart(){
      const s = $('.pe-start'); ui.startShown = true;
      s.innerHTML = `<div class="pe-card"><b>🖼 Фоторедактор</b><p>Открой фото или начни с пустого холста. Работает без входа; фото не уходят на сервер.</p>
        <div class="pe-row"><button type="button" class="pe-big pe-acc" data-a="open">📂 Открыть фото</button><button type="button" class="pe-big" data-a="assets">📁 Мои материалы</button></div>
        <div class="pe-chips">${NEW_PRESETS.map(([t, w, h, d]) => `<button type="button" class="pe-chip" data-new="${w}x${h}">${esc(d)} <small>${t}</small></button>`).join('')}</div>
        <button type="button" class="pe-link" data-a="startClose">Рисовать на белом холсте →</button></div>`;
      s.hidden = false;
    }
    function hideStart(){ const s = $('.pe-start'); if (s && !s.hidden) { s.hidden = true; s.innerHTML = ''; } ui.startShown = false; }

    // ═══ Меню ═══
    function openMenu(btn, items){
      closeMenu();
      const m = document.createElement('div'); m.className = 'pe-menu'; m.setAttribute('role', 'menu');
      m.innerHTML = items.map(it => it.sep ? '<hr>' : `<button type="button" role="menuitem" data-m="${esc(it.id)}"${it.off ? ' disabled' : ''}><i>${it.icon}</i><span>${esc(it.t)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`).join('');
      pe.appendChild(m);
      const r = btn.getBoundingClientRect(), pr = pe.getBoundingClientRect();
      m.style.top = (r.bottom - pr.top + 4) + 'px';
      const left = Math.min(r.left - pr.left, pr.width - m.offsetWidth - 6);
      m.style.left = Math.max(6, left) + 'px';
      ui.menu = { m, items };
      m.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (!b) return; const it = items.find(x => x.id === b.dataset.m); closeMenu(); if (it && it.run) it.run(); });
      setTimeout(() => document.addEventListener('pointerdown', menuOut, true), 0);
    }
    function menuOut(e){ if (ui.menu && !ui.menu.m.contains(e.target)) closeMenu(); }
    function closeMenu(){ if (!ui.menu) return; ui.menu.m.remove(); ui.menu = null; document.removeEventListener('pointerdown', menuOut, true); }
    function fileMenu(){
      return [
        { id: 'open', icon: '📂', t: 'Открыть фото…', run: () => { ui.fileMode = 'open'; fileIn.click(); } },
        { id: 'place', icon: '🖼', t: 'Добавить фото слоем…', run: () => { ui.fileMode = 'place'; fileIn.click(); } },
        { id: 'assets', icon: '📁', t: 'Мои материалы', sub: 'всё, что сохранено на сайте в этом браузере', run: () => openAssets('open') },
        { id: 'new', icon: '⬜', t: 'Новый холст', run: () => { ui.panel = 'image'; paintPanel(); } },
        { sep: true },
        { id: 'keys', icon: '⌨️', t: 'Клавиши', run: () => toast('V двигать · C обрезать · B кисть · E ластик · T текст · H рука · [ ] кисть · Ctrl+Z / Ctrl+Y · Ctrl+0 вписать · колесо — масштаб · пробел — сдвиг', 'info') },
        { id: 'about', icon: 'ℹ️', t: 'О редакторе', sub: 'основа — fabric.js 7.4.0 (MIT)', run: () => toast('Фоторедактор сайта Денчика: свой код + fabric.js 7.4.0 (MIT, fabricjs.com). Фото обрабатываются только в твоём браузере.', 'info') },
      ];
    }
    function sendMenu(){
      return [
        { id: 'png', icon: '💾', t: 'Скачать PNG', sub: 'без потери качества, с прозрачностью', run: () => exportTo('download', 'png') },
        { id: 'jpg', icon: '💾', t: 'Скачать JPG', sub: 'меньше файл, для соцсетей', run: () => exportTo('download', 'jpeg', 90) },
        { id: 'webp', icon: '💾', t: 'Скачать WebP', sub: 'ещё меньше файл', run: () => exportTo('download', 'webp', 88) },
        { sep: true },
        { id: 'assets', icon: '📁', t: 'В «Мои материалы»', sub: 'чтобы взять в другом инструменте сайта', run: () => exportTo('assets', 'png') },
        { id: 'studio3d', icon: '🧱', t: 'В «Студию 3D»', sub: 'картинкой-плоскостью в «🧩 Модели»', run: () => exportTo('studio3d', 'png') },
        { id: 'video', icon: '🎬', t: 'В видеоредактор', sub: 'скоро', off: true },
        { id: 'avatar', icon: '🎭', t: 'На персонажа', sub: 'скоро', off: true },
        { id: 'chat', icon: '💬', t: 'В чат', sub: 'пока нельзя: картинки в чате видят все — нужна проверка', off: true },
      ];
    }
    async function exportTo(to, format, quality){
      const name = E.doc.name || 'Картинка';
      const r = await run('export', Object.assign({ to, format, name }, quality ? { quality } : {}));
      if (!r.ok) return;
      E.dirty = false; paintTitle();
      if (to === 'download') toast(`💾 Скачано: ${r.result.w}×${r.result.h}, ${MB(r.result.bytes)}`, 'ok');
      else if (to === 'assets') toast('📁 Сохранено в «Мои материалы»', 'ok');
      else if (to === 'studio3d') { toast('🧱 Готово: «Студия 3D» → 🧩 Модели', 'ok'); }
    }

    // ═══ «Мои материалы» ═══
    async function openAssets(mode){
      if (!root.D37Assets) { toast('Хранилище материалов не загрузилось', 'err'); return; }
      const box = document.createElement('div'); box.className = 'pe-modal'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Мои материалы');
      box.innerHTML = `<div class="pe-modal-in"><div class="pe-ph"><b>📁 Мои материалы</b><button type="button" class="pe-btn" data-x aria-label="Закрыть">✕</button></div><div class="pe-assets"><p class="pe-hint">Загрузка…</p></div><p class="pe-hint pe-usage"></p></div>`;
      pe.appendChild(box);
      const close = () => box.remove();
      async function paint(){
        let list = [];
        try { list = await root.D37Assets.list({ type: 'image' }); } catch (er) { box.querySelector('.pe-assets').innerHTML = `<p class="pe-warn">${esc(er.message)}</p>`; return; }
        const u = await root.D37Assets.usage().catch(() => null);
        box.querySelector('.pe-usage').textContent = u ? `Занято: ${MB(u.bytes)} из ${MB(u.cap)} · всё хранится только в этом браузере` : '';
        box.querySelector('.pe-assets').innerHTML = list.length ? `<ul>${list.map(m => `<li data-asset="${esc(m.id)}"><span class="pe-ath">${m.thumb ? `<img src="${esc(m.thumb)}" alt="">` : '🖼'}</span>
          <span class="pe-an"><b>${esc(m.name)}</b><small>${m.w}×${m.h} · ${MB(m.size)}${m.tool ? ' · ' + esc(m.tool) : ''}</small></span>
          <button type="button" class="pe-mini" data-use="open">Открыть</button><button type="button" class="pe-mini" data-use="place">Слоем</button><button type="button" class="pe-mini pe-danger" data-use="del" aria-label="Удалить">🗑</button></li>`).join('')}</ul>`
          : '<p class="pe-hint">Пока пусто. Нажми «📤 Сохранить → В «Мои материалы»», и картинку можно будет взять в других инструментах сайта.</p>';
      }
      box.addEventListener('click', async e => {
        if (e.target === box || e.target.closest('[data-x]')) { close(); return; }
        const b = e.target.closest('[data-use]'); if (!b) return;
        const id = b.closest('[data-asset]').dataset.asset;
        if (b.dataset.use === 'del') { await root.D37Assets.remove(id); paint(); return; }
        close(); hideStart();
        run(b.dataset.use === 'place' ? 'place' : 'open', { asset: id });
      });
      paint();
    }

    // ═══ ИИ-помощник ═══
    function openAI(){
      if (!root.D37AI) { toast('ИИ-помощник не загрузился', 'err'); return; }
      root.D37AI.open({ tools: ['photo'], title: 'ИИ-помощник фоторедактора',
        examples: ['Сделай ярче и теплее', 'Обрежь 9:16 и добавь сверху надпись «ПОБЕДА» жёлтым', 'Чёрно-белое и чуть контраста', 'Сохрани в «Мои материалы» шириной 1080'] });
    }

    // ═══ Реклама: только столбик сбоку на широком компьютере (не поверх холста) ═══
    let adShown = false;
    function adCheck(){
      const wide = innerWidth >= 1400 && !phone;
      if (!wide) { pe.classList.remove('has-ad'); return; }
      if (adShown) { pe.classList.add('has-ad'); return; }
      const P = root.D37AdPlaces; if (!P) return;
      pe.classList.add('has-ad');
      adShown = !!P.show($('.pe-ad-in'), 'rail', { onEmpty: () => pe.classList.remove('has-ad') });
      if (!adShown) pe.classList.remove('has-ad');
    }
    setTimeout(adCheck, 1200);

    // ── события ──
    host.addEventListener('click', onClick);
    host.addEventListener('input', onInput);
    host.addEventListener('change', onChange);
    // «Назад»/закрытие вкладки с несохранённой работой — спросит браузер
    const onBeforeUnload = e => { if (E && !E.disposed && E.dirty && E.histState().undo) { e.preventDefault(); e.returnValue = ''; } };
    root.addEventListener('beforeunload', onBeforeUnload);

    // ── старт ──
    const param = String(o.param || '');
    paintPanel(); paintHist(); paintTitle();
    const fromAsset = /^a[a-z0-9]{6,30}$/.test(param) ? param : '';
    if (fromAsset) run('open', { asset: fromAsset });   // /photo/<номер материала> — открыть сразу (из другого инструмента)
    else showStart();

    function unmount(){
      if (!api.active) return;
      api.active = false;
      closeMenu();
      try { root.D37AI && root.D37AI.close(); } catch (e) {}
      if (root.D37Full && pe.classList.contains('gs-fs')) { try { root.D37Full.release(pe); } catch (e) {} }
      root.removeEventListener('resize', onResize);
      root.removeEventListener('paste', onPaste);
      root.removeEventListener('beforeunload', onBeforeUnload);
      host.removeEventListener('click', onClick); host.removeEventListener('input', onInput); host.removeEventListener('change', onChange);
      if (paintT) cancelAnimationFrame(paintT);
      try { E.dispose(); } catch (e) { console.warn(e); }
      document.body.classList.remove('pe-on');
      host.innerHTML = '';
      if (root.D37Photo === api) root.D37Photo = null;
    }
    api.unmount = unmount;
    return api;
  }

  root.D37PhotoUI = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
