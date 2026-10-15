// ═══════════════════════════════════════
//  «СТУДИЯ 3D» — общее для телефона, геймпада и компьютера: стили (css/studio3d-x.css), раскладка под экран (узкий —
//  s3-compact, стоя — s3-port, лёжа — s3-land), подсказки внизу вида — сами меняются под то, чем управляют (клавиатура
//  и мышь / палец / геймпад), шпаргалка клавиш (⌨ или ?), выдвижные листы для своих окон
// ═══════════════════════════════════════
// D37E.s3ui: css() — подключить стили (и в режиме игрока); hint(fn, приоритет) → отписка: fn(kind, ed) → текст подсказки или null
// (kind — 'kb' | 'touch' | 'pad'); refreshHints(); sheet(id, { title, html, cls, onClose }) → элемент листа (один за раз);
// closeSheet(); pad(t) — подписи кнопок геймпада: pad('Ⓐ выбрать'); keys() — шпаргалка. Расширение студии 'ui'.
(() => {
  const E = window.D37E = window.D37E || {};
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let api = null, ro = null, offKind = null, hintsT = 0, lastHint = '';
  const providers = [];   // { fn, pr }

  const UI = E.s3ui = {
    esc,
    css(){
      if (document.getElementById('s3x-css')) return;
      const l = document.createElement('link');
      l.id = 's3x-css'; l.rel = 'stylesheet';
      l.href = 'css/studio3d-x.css?v=' + (typeof GAMES_VER !== 'undefined' ? GAMES_VER : '1');
      document.head.appendChild(l);
    },
    hint(fn, pr = 0){ const h = { fn, pr }; providers.push(h); providers.sort((a, b) => b.pr - a.pr); UI.refreshHints(); return () => { const i = providers.indexOf(h); if (i >= 0) providers.splice(i, 1); }; },
    refreshHints(){ clearTimeout(hintsT); hintsT = setTimeout(drawHints, 30); },
    // лист снизу (телефон стоя) / сбоку (лёжа) / окно (компьютер): один за раз, ✕ и Esc закрывают
    sheet(id, o = {}){
      const ed = api?.ed; if (!ed) return null;
      UI.closeSheet(true);
      const s = document.createElement('div');
      s.className = 's3x-sheet ' + (o.cls || ''); s.dataset.sheet = id;
      s.innerHTML = `<div class="s3x-sh"><b>${o.title || ''}</b><button type="button" class="s3x-x" data-x="close" title="Закрыть" aria-label="Закрыть">✕</button></div><div class="s3x-sb">${o.html || ''}</div>`;
      s.querySelector('[data-x="close"]').onclick = () => UI.closeSheet();
      s._close = o.onClose || null;
      ed.box.appendChild(s);
      requestAnimationFrame(() => s.classList.add('on'));
      return s;
    },
    closeSheet(silent){
      const s = api?.ed?.box.querySelector('.s3x-sheet'); if (!s) return false;
      s.remove(); if (!silent) try { s._close?.(); } catch (e) {}
      return true;
    },
    sheetOpen: id => !!api?.ed?.box.querySelector(id ? `.s3x-sheet[data-sheet="${id}"]` : '.s3x-sheet'),
    kind: () => E.inputKind?.kind || 'kb',
    compact: () => !!api?.ed?.box.classList.contains('s3-compact'),
    keys(){ openKeys(); },
    layout: () => layout(),
  };

  // ── Подсказки внизу вида ──
  function drawHints(){
    const ed = api?.ed; if (!ed?.SC) return;
    const view = ed.q('.s3-view'); if (!view) return;
    let el = ed.q('.s3x-hints');
    let off = false; try { off = localStorage.getItem('d37_s3_hints') === '0'; } catch (e) {}
    if (off || ed.playing) { if (el) el.hidden = true; return; }
    const kind = UI.kind();
    let text = null;
    for (const p of providers) { try { text = p.fn(kind, ed); } catch (e) { text = null; } if (text) break; }
    if (!text) text = baseHint(kind, ed);
    if (!el) {
      el = document.createElement('div'); el.className = 's3x-hints';
      el.innerHTML = '<span></span><button type="button" title="Спрятать подсказки (вернуть — ••• → Подсказки)" aria-label="Спрятать подсказки">✕</button>';
      el.querySelector('button').onclick = () => { try { localStorage.setItem('d37_s3_hints', '0'); } catch (e) {} el.hidden = true; };
      view.appendChild(el);
    }
    el.hidden = false;
    if (text !== lastHint) { lastHint = text; el.querySelector('span').innerHTML = text; }
    el.dataset.kind = kind;
  }
  const K = (k, t) => `<kbd>${esc(k)}</kbd> ${t}`;
  function baseHint(kind, ed){
    const sel = !!ed.sel;
    if (kind === 'touch') return sel
      ? '👆 Потяни деталь или стрелку · ✌️ Два пальца — сдвиг и зум · ✋ Держи палец — меню'
      : '👆 Нажми на деталь — выбрать · ☝️ Веди пальцем — крутить вид · ✌️ Два пальца — сдвиг и зум · ➕ — добавить';
    if (kind === 'pad') return sel
      ? `${K('Ⓐ', 'взять / поставить')} · ${K('Ⓑ', 'снять выбор')} · ${K('LB RB', 'повернуть')} · ${K('Ⓧ Ⓨ', 'инструмент')} · ${K('☰', 'меню')}`
      : `${K('Ⓐ', 'выбрать')} · ${K('стики', 'лететь и смотреть')} · ${K('LT RT', 'вниз / вверх')} · ${K('☰', 'добавить')} · ${K('Start', 'играть')}`;
    return sel
      ? `${K('2', 'двигать')} · ${K('3', 'размер')} · ${K('4', 'вращать')} · ${K('Ctrl+D', 'копия')} · ${K('Del', 'удалить')} · ${K('F', 'к нему')} · ${K('?', 'все клавиши')}`
      : `${K('ЛКМ', 'выбрать')} · ${K('ПКМ', 'осмотреться')} · ${K('WASD', 'лететь')} · ${K('колесо', 'ближе')} · ${K('?', 'все клавиши')}`;
  }

  // ── Шпаргалка клавиш ──
  const KEYS = [
    ['Камера', [['ПКМ + мышь', 'осмотреться'], ['W A S D', 'лететь'], ['Q / E', 'вниз / вверх'], ['Shift', 'быстрее'], ['колесо', 'вперёд / назад'], ['F', 'к выбранному'],
      ['Num 7 / 1 / 3', 'вид сверху / спереди / сбоку'], ['Num 5', 'обычный вид'], ['Alt + 1…4', 'к закладке'], ['Alt + Shift + 1…4', 'запомнить закладку']]],
    ['Инструменты', [['1', 'выбор'], ['2', 'двигать'], ['3', 'размер'], ['4', 'вращать'], ['ЛКМ по детали', 'выбрать (Ctrl / Shift — несколько)'], ['Alt + ЛКМ', 'деталь внутри модели']]],
    ['Правка', [['Ctrl + Z / Y', 'отменить / вернуть'], ['Ctrl + D', 'копия'], ['Ctrl + C / X / V', 'копировать / вырезать / вставить'], ['Delete', 'удалить'],
      ['Ctrl + G / U', 'группа / разгруппировать'], ['Ctrl + A', 'выбрать всё'], ['Ctrl + S', 'сохранить'], ['R', 'массив (копии рядом)'], ['End', 'опустить на землю'], ['M', '🧲 на поверхность — вкл / выкл']]],
    ['Игра', [['▶ Играть', 'проверить мир'], ['W A S D', 'идти'], ['Пробел', 'прыжок'], ['E', 'действие'], ['F', 'удар (в режимах с боем)'], ['V', 'вид от 1-го / 3-го лица'], ['Esc', 'стоп']]],
  ];
  function openKeys(){
    const kind = UI.kind();
    let html = '';
    if (kind === 'pad') html = '<p class="s3-note">Геймпад: стики — лететь и смотреть, LT/RT — вниз/вверх, Ⓐ — выбрать, ещё Ⓐ — взять и нести, Ⓐ — поставить, Ⓑ — назад, Ⓧ/Ⓨ — инструмент, LB/RB — повернуть, крестовина — шаг сетки и угла, ☰ — меню «добавить», Start — играть.</p>';
    else if (kind === 'touch') html = '<p class="s3-note">Палец: нажать — выбрать, вести — крутить вид, два пальца — сдвиг, щипок — ближе/дальше, поворот двумя — повернуть вид, держать — меню (копия, удалить, группа, замок). Детали — кнопкой ➕ внизу.</p>';
    html += KEYS.map(([t, rows]) => `<div class="s3x-kh">${t}</div><div class="s3x-kt">${rows.map(([k, v]) => `<kbd>${esc(k)}</kbd><span>${esc(v)}</span>`).join('')}</div>`).join('');
    UI.sheet('keys', { title: '⌨ Клавиши и управление', html, cls: 's3x-wide' });
  }

  // ── Раскладка: узкий экран / стоя / лёжа ──
  function layout(){
    const ed = api?.ed; if (!ed?.box) return;
    const w = ed.box.clientWidth || innerWidth, h = ed.box.clientHeight || innerHeight;
    const compact = w <= 760 || h <= 500, land = w > h;
    ed.box.classList.toggle('s3-compact', compact);
    ed.box.classList.toggle('s3-port', compact && !land);
    ed.box.classList.toggle('s3-land', compact && land);
    if (api?.ed?.R) setTimeout(() => api?.ed?.R?.resize(), 0);
  }
  function kindClass(k){ const b = api?.ed?.box; if (!b) return; for (const x of ['kb', 'touch', 'pad']) b.classList.toggle('s3-in-' + x, x === k); UI.refreshHints(); }

  E.studioExt = E.studioExt || [];
  E.studioExt.push({
    id: 'ui',
    mount(a){
      api = a; UI.api = a;
      UI.css();
      const ed = a.ed; if (!ed || ed.player) return;
      E.inputKind?.listen();
      offKind = E.inputKind?.on(kindClass); kindClass(UI.kind());
      layout();
      ro = new ResizeObserver(layout); ro.observe(ed.box);
      addEventListener('resize', layout);   // ResizeObserver стоит, пока вкладка скрыта — запасной путь
      // кнопка шпаргалки (на компьютере), «?» / F1
      const b = document.createElement('button');
      b.type = 'button'; b.className = 's3x-keysbtn'; b.dataset.a = 's3x:keys'; b.title = 'Клавиши и управление (?)'; b.setAttribute('aria-label', 'Клавиши и управление');
      b.innerHTML = '⌨<span> Клавиши</span>';
      a.slot?.appendChild(b);
      UI.refreshHints();
    },
    unmount(){ ro?.disconnect(); ro = null; removeEventListener('resize', layout); offKind?.(); offKind = null; api = null; UI.api = null; lastHint = ''; },
    select(){ UI.refreshHints(); },
    play(){ UI.closeSheet(true); UI.refreshHints(); },
    stop(){ UI.refreshHints(); },
    act(a){
      if (a === 's3x:keys') { openKeys(); return true; }
      if (a === 's3x:hints') { try { localStorage.removeItem('d37_s3_hints'); } catch (e) {} UI.refreshHints(); return true; }
      return false;
    },
    key(e){
      if ((e.key === '?' || e.code === 'F1') && !e.ctrlKey && !e.altKey) { if (UI.sheetOpen('keys')) UI.closeSheet(); else openKeys(); return true; }
      if (e.code === 'Escape' && UI.closeSheet()) return true;
      return false;
    },
  });
})();
