// ═══════════════════════════════════════
//  «СТУДИЯ 3D» НА ТЕЛЕФОНЕ — пальцы и узкий экран (расширение студии 'touch')
// ═══════════════════════════════════════
// Узкий экран (s3-compact, studio3d-ui.js): внизу — крупная панель (➕ Добавить, ✥ Двигать, ⤢ Размер, ⟳ Вращать, 🎨 Цвет,
// ⚙ Свойства, 🌲 Объекты), лёжа — колонкой слева; Проводник, Свойства, Вывод и меню — выдвижными листами; наверху — ← имя ↶ ↷
// ⋯ ▶; «⋯ Ещё» — всё остальное плитками (файл, земля, свет, скрипт, режим игры, тест вдвоём, выложить, настройки…).
// Плашка выбранного (⧉ 🗑 ☑ ⋯) и 🧲 (сетка, угол, «на поверхность») — поверх вида.
// Пальцы (D37E.gestures, js/engine/edit-input.js): нажать — выбрать (☑ — добавлять к выбору), дважды — к нему; вести —
// крутить вид вокруг выбранного (или того, что в центре); по выбранной детали (✥) — тащить её по поверхностям; по стрелке —
// стрелка (крупные ручки: G.k); два пальца — сдвиг, щипок — ближе/дальше, поворот двумя — повернуть вид; держать —
// меню у пальца (копия, удалить, группа, замок…; по пустому месту — «➕ Добавить сюда», «📋 Вставить»).
(() => {
  const E = window.D37E = window.D37E || {};
  const S3X = E.s3x = E.s3x || { surface: true, nextAt: null };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // палитра — как у студии (BrickColor)
  const COLORS = ['#f2f3f3', '#a3a2a5', '#635f62', '#1b2a35', '#c4281c', '#ff0000', '#da8541', '#f5cd30', '#ffff00', '#a4bd47', '#4b974b', '#00ff00', '#287f47',
    '#0d69ac', '#00ffff', '#6e99ca', '#b4d2e4', '#6b327c', '#aa00aa', '#ff66cc', '#e8bac8', '#7c5c46', '#cc8e69', '#ffc9c9', '#d7c59a', '#111111'];
  const TOOLS = [['move', '✥', 'Двигать'], ['scale', '⤢', 'Размер'], ['rotate', '⟳', 'Вращать']];
  let api = null, G = null, longT = 0, drag = null, two = null, multi = false, lastTool = '', lastSel = undefined, mo = null, moOut = null, offHint = null, offKind = null;

  const core = () => api.core;
  const ed = () => api?.ed;
  const UI = () => E.s3ui;

  // ═══ Камера пальцами: вокруг точки, сдвиг, ближе / дальше ═══
  function fwd(c){ return [-Math.sin(c.yaw) * Math.cos(c.pitch), -Math.sin(c.pitch), -Math.cos(c.yaw) * Math.cos(c.pitch)]; }
  function pivotPoint(){
    const e = ed(), T = e.R.T;
    const L = core().selTop().filter(o => o.cls !== 'Script');
    if (L.length) { const b = new T.Box3(); for (const o of L) b.union(e.SC.box(o)); if (!b.isEmpty()) { const c = b.getCenter(new T.Vector3()); return [c.x, c.y, c.z]; } }
    const ray = core().centerRay(), hit = e.SC.pick(ray);
    if (hit) return [hit.point.x, hit.point.y, hit.point.z];
    const o = ray.ray.origin, d = ray.ray.direction, h = e.ph.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 200);
    if (h) return [h.x, h.y, h.z];
    const c = e.cam, f = fwd(c); return [c.x + f[0] * 15, c.y + f[1] * 15, c.z + f[2] * 15];
  }
  // повернуть камеру вокруг точки: a — вокруг вертикали, b — вверх/вниз; точка остаётся на том же месте экрана
  function orbit(P, a, b){
    const c = ed().cam;
    const pitch = Math.max(-1.45, Math.min(1.45, c.pitch + b)); b = pitch - c.pitch;
    let v = [c.x - P[0], c.y - P[1], c.z - P[2]];
    const ca = Math.cos(a), sa = Math.sin(a);
    v = [v[0] * ca + v[2] * sa, v[1], -v[0] * sa + v[2] * ca];
    const yaw = c.yaw + a, r = [Math.cos(yaw), 0, -Math.sin(yaw)], t = -b, ct = Math.cos(t), st = Math.sin(t);
    const dot = r[0] * v[0] + r[2] * v[2], cr = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
    v = [0, 1, 2].map(i => v[i] * ct + cr[i] * st + r[i] * dot * (1 - ct));
    c.x = P[0] + v[0]; c.y = P[1] + v[1]; c.z = P[2] + v[2]; c.yaw = yaw; c.pitch = pitch;
  }
  function pan(P, dx, dy){
    const e = ed(), c = e.cam, f = fwd(c), r = [Math.cos(c.yaw), 0, -Math.sin(c.yaw)];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const d = Math.max(2, Math.hypot(c.x - P[0], c.y - P[1], c.z - P[2])), h = e.q('.s3-view').clientHeight || 600;
    const k = 2 * d * Math.tan((e.R.camera.fov || 50) * Math.PI / 360) / h;
    for (let i = 0; i < 3; i++) { const m = -r[i] * dx * k + u[i] * dy * k; if (i === 0) c.x += m; else if (i === 1) c.y += m; else c.z += m; }
    P[0] += -r[0] * dx * k + u[0] * dy * k; P[1] += -r[1] * dx * k + u[1] * dy * k; P[2] += -r[2] * dx * k + u[2] * dy * k;
  }
  function dolly(P, s){
    const c = ed().cam, v = [c.x - P[0], c.y - P[1], c.z - P[2]], d = Math.hypot(...v) || 1;
    const nd = Math.max(1.5, Math.min(400, d / Math.max(.2, Math.min(5, s))));
    c.x = P[0] + v[0] / d * nd; c.y = P[1] + v[1] / d * nd; c.z = P[2] + v[2] / d * nd;
  }

  // ═══ События жестов ═══
  function run(evs){ for (const ev of evs) { try { on(ev); } catch (e) { console.error('студия, пальцы', e); } } }
  function on(ev){
    const e = ed(), C = core(); if (!e?.SC) return;
    if (ev.type === 'dragstart') {
      const ray = C.rayAt(ev.sx, ev.sy);
      if (e.G.target && e.G.mode && e.G.handleAt(ray) && C.gizmoDown(ray)) { drag = { kind: 'gizmo' }; return; }
      const hit = C.pick(ray, false);
      if (hit && hit.obj === e.sel && e.selSet.size <= 1 && e.tool === 'move' && e.sel.cls !== 'Model' && e.sel.pos) { drag = { kind: 'part', st: {} }; return; }
      drag = { kind: 'orbit', P: pivotPoint() };
    } else if (ev.type === 'drag') {
      if (!drag) return;
      if (drag.kind === 'gizmo') C.gizmoDrag(C.rayAt(ev.x, ev.y));
      else if (drag.kind === 'part') C.dragPart(C.rayAt(ev.x, ev.y), drag.st);
      else orbit(drag.P, -ev.dx * .0065, ev.dy * .0055);
    } else if (ev.type === 'dragend') {
      if (drag?.kind === 'gizmo') C.gizmoUp(); else if (drag?.kind === 'part') C.dragEnd(drag.st);
      drag = null; chip();
    } else if (ev.type === 'tap') {
      const hit = C.pick(C.rayAt(ev.x, ev.y), false);
      if (hit) { api.select(hit.obj, multi && !ev.double); if (ev.double) C.focus(); }   // ☑ — нажатие добавляет или убирает
      else if (!multi) api.select(null);
      chip();
    } else if (ev.type === 'long') {
      const hit = C.pick(C.rayAt(ev.x, ev.y), false);
      try { navigator.vibrate?.(18); } catch (er) {}
      if (hit) { if (!e.selSet.has(hit.obj)) api.select(hit.obj, multi); openCtx(ev.x, ev.y, true); }
      else openCtx(ev.x, ev.y, false);
    } else if (ev.type === 'twostart') { if (drag?.kind === 'gizmo') C.gizmoUp(); drag = null; two = { P: pivotPoint() }; }
    else if (ev.type === 'two' && two) {
      pan(two.P, ev.dx, ev.dy);
      if (ev.scale !== 1) dolly(two.P, ev.scale);
      if (ev.rot) orbit(two.P, ev.rot, 0);
    } else if (ev.type === 'twoend') two = null;
  }

  // ═══ Меню у пальца ═══
  function closeCtx(){ ed()?.q('.s3x-ctx')?.remove(); }
  function openCtx(x, y, onObj){
    closeCtx();
    const e = ed(), view = e.q('.s3-view'), b = view.getBoundingClientRect(), o = e.sel;
    let clip = false; try { clip = !!JSON.parse(localStorage.getItem('d37_s3_clip') || 'null')?.list?.length; } catch (er) {}
    const top = core().selTop(), it = [];
    if (onObj && o) {
      it.push(['dup', '⧉', 'Копия'], ['del', '🗑', 'Удалить'], ['paint', '🎨', 'Цвет'], ['props', '⚙', 'Свойства']);
      if (top.length > 1) it.push(['group', '📦', 'В группу']);
      if (o.cls === 'Model') it.push(['ungroup', '📤', 'Разгруппировать']);
      it.push(['lock', o.locked ? '🔓' : '🔒', o.locked ? 'Разблокировать' : 'Заблокировать'], ['focus', '🎯', 'Показать'], ['multi', '☑', multi ? 'Выбор по одному' : 'Выбрать ещё'], ['copy', '📋', 'Копировать'], ['cut', '✂', 'Вырезать']);
    } else {
      it.push(['addhere', '➕', 'Добавить сюда']);
      if (clip) it.push(['paste', '📋', 'Вставить']);
      it.push(['all', '✅', 'Выбрать всё'], ['undo', '↶', 'Отменить']);
    }
    const m = document.createElement('div'); m.className = 's3x-ctx';
    m.innerHTML = `<b>${onObj && o ? (top.length > 1 ? `Выбрано: ${top.length}` : esc(o.name)) : 'Здесь'}</b>` + it.map(([k, i, t]) => `<button type="button" data-c="${k}"><i>${i}</i>${t}</button>`).join('');
    view.appendChild(m);
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(b.width - w - 8, x - b.left - w / 2)) + 'px';
    m.style.top = Math.max(8, Math.min(b.height - h - 8, y - b.top - h - 14)) + 'px';
    m.onclick = ev => { const k = ev.target.closest('[data-c]')?.dataset.c; if (!k) return; closeCtx(); ctxAct(k, x, y); };
    m.addEventListener('pointerdown', ev => ev.stopPropagation());
  }
  function ctxAct(k, x, y){
    const e = ed(), C = core(), o = e.sel;
    if (k === 'dup') C.duplicate(); else if (k === 'del') C.remove(); else if (k === 'group') C.group(); else if (k === 'ungroup') C.ungroup();
    else if (k === 'focus') C.focus(); else if (k === 'copy') C.copy(false); else if (k === 'cut') C.copy(true); else if (k === 'paste') C.paste();
    else if (k === 'paint') paintSheet(); else if (k === 'props') showProps();
    else if (k === 'multi') { multi = !multi; chip(); api.msg(multi ? '☑ Нажимай детали — добавляются к выбору' : 'Выбор по одной', true); }
    else if (k === 'lock' && o) { api.pushHist(); const v = !o.locked; for (const x2 of C.selTop()) e.SC.set(x2, 'locked', v); api.markDirty(); C.renderTree(); C.renderProps(); api.msg(v ? '🔒 Заблокировано — пальцем не выберется (Проводник — можно)' : '🔓 Снова выбирается', true); }
    else if (k === 'addhere') { S3X.nextAt = { x, y }; openAdd(); }
    else if (k === 'all') api.setSel(e.SC.children(null).filter(x2 => x2.cls !== 'Script' && !x2.locked));
    else if (k === 'undo') C.undo(false);
    chip();
  }

  // ═══ Панель внизу, «⋯ Ещё», плашка выбранного, 🧲 ═══
  function build(){
    const e = ed(), box = e.box;
    const bar = document.createElement('div'); bar.className = 's3x-bar';
    bar.innerHTML = `<button type="button" class="add" data-a="s3x:add" title="Добавить деталь, предмет, свет…"><i>➕</i>Добавить</button>`
      + TOOLS.map(([t, i, n]) => `<button type="button" data-a="s3x:tool:${t}" data-t="${t}" title="${n}"><i>${i}</i>${n}</button>`).join('')
      + `<button type="button" data-a="s3x:paint" title="Цвет и материал выбранного"><i>🎨</i>Цвет</button><button type="button" data-a="s3x:props" title="Свойства выбранного"><i>⚙</i>Свойства</button><button type="button" data-a="s3x:tree" title="Все объекты мира (Проводник)"><i>🌲</i>Объекты</button>`;
    box.appendChild(bar);
    // ⋯ — после ↷
    const more = document.createElement('button'); more.type = 'button'; more.className = 's3x-more'; more.dataset.a = 's3x:more'; more.title = 'Ещё: файл, земля, свет, скрипт, режим игры, выложить…'; more.setAttribute('aria-label', 'Ещё'); more.textContent = '•••';
    e.q('[data-a="redo"]')?.after(more);
    // плашка выбранного и 🧲
    const view = e.q('.s3-view');
    const ch = document.createElement('div'); ch.className = 's3x-chip'; ch.hidden = true; view.appendChild(ch);
    ch.addEventListener('click', ev => { const k = ev.target.closest('[data-c]')?.dataset.c; if (!k) return; if (k === 'name') showProps(); else if (k === 'ctx') { const r = ev.target.closest('button').getBoundingClientRect(); openCtx(r.left + r.width / 2, r.bottom + 160, true); } else ctxAct(k); });
    const sb = document.createElement('button'); sb.type = 'button'; sb.className = 's3x-snapbtn'; sb.dataset.a = 's3x:snap'; sb.title = 'Сетка, угол и «на поверхность»'; view.appendChild(sb);
    // ✕ у листов Проводника и Вывода (у Свойств — дописываем в кадре: заголовок перерисовывается)
    const xb = (a, t) => { const b = document.createElement('button'); b.type = 'button'; b.className = 's3x-x'; b.dataset.a = a; b.title = t; b.setAttribute('aria-label', t); b.textContent = '✕'; return b; };
    e.q('.s3-left .s3-ph')?.appendChild(xb('s3x:closeL', 'Закрыть'));
    e.q('.s3-btabs')?.appendChild(xb('s3x:closeB', 'Закрыть'));
    snapLabel(); chip(); barTools();
  }
  function barTools(){
    const e = ed(); if (!e) return;
    lastTool = e.tool;
    e.box.querySelectorAll('.s3x-bar [data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === e.tool));
  }
  function chip(){
    const e = ed(), el = e?.q('.s3x-chip'); if (!el) return;
    const top = core().selTop(), o = e.sel;
    lastSel = o ? o.id + ':' + top.length : null;
    if (!o) { el.hidden = !multi; el.innerHTML = multi ? '<b>☑ Нажимай детали — выбор</b><button type="button" data-c="multi" class="on" title="Закончить выбор">✓</button>' : ''; return; }
    el.hidden = false;
    el.innerHTML = `<b data-c="name" title="Свойства">${top.length > 1 ? '📦 Выбрано: ' + top.length : esc(o.name)}</b><button type="button" data-c="dup" title="Копия">⧉</button><button type="button" data-c="del" title="Удалить">🗑</button><button type="button" data-c="multi" class="${multi ? 'on' : ''}" title="Выбирать несколько">☑</button><button type="button" data-c="ctx" title="Ещё действия">•••</button>`;
  }
  function snapLabel(){
    const e = ed(), b = e?.q('.s3x-snapbtn'); if (!b) return;
    const s = e.G.snap, r = e.G.rsnap;
    b.innerHTML = `🧲${S3X.surface ? '' : '<small>✕</small>'} ${s ? String(s).replace('.', ',') : '—'}<small>${r ? r + '°' : ''}</small>`;
  }
  function setSnap(v, rot){
    const e = ed(), sel = e.q(rot ? '.s3-rsnap' : '.s3-snap'); if (!sel) return;
    if (![...sel.options].some(o => +o.value === v)) { const op = document.createElement('option'); op.value = String(v); op.textContent = rot ? v + '°' : 'Сетка ' + String(v).replace('.', ','); sel.appendChild(op); }
    sel.value = String(v); sel.dispatchEvent(new Event('change', { bubbles: true }));
    snapLabel();
  }
  S3X.setSnap = setSnap;
  function snapSheet(){
    const e = ed(), s = e.G.snap, r = e.G.rsnap;
    const seg = (list, cur, rot) => `<div class="s3x-seg">${list.map(([v, t]) => `<button type="button" data-v="${v}" data-r="${rot ? 1 : 0}" class="${+v === +cur ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    const sh = UI().sheet('snap', { title: '🧲 Сетка и угол', html:
      `<div class="s3x-sec">Шаг сетки — на сколько прыгает деталь</div>${seg([[0, 'Нет'], [.25, '0,25'], [.5, '0,5'], [1, '1'], [2, '2'], [4, '4']], s, false)}`
      + `<div class="s3x-sec">Шаг поворота</div>${seg([[0, 'Нет'], [5, '5°'], [15, '15°'], [45, '45°'], [90, '90°']], r, true)}`
      + `<label class="s3-chk"><input type="checkbox" data-s="surface"${S3X.surface ? ' checked' : ''}> 🧲 На поверхность — новое и перетаскиваемое ложится на то, что под ним (и на стены)</label>` });
    if (!sh) return;
    sh.addEventListener('click', ev => { const b = ev.target.closest('[data-v]'); if (!b) return; setSnap(+b.dataset.v, b.dataset.r === '1'); b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
    sh.addEventListener('change', ev => { if (ev.target.dataset.s === 'surface') { S3X.surface = ev.target.checked; try { localStorage.setItem('d37_s3_surface', S3X.surface ? '1' : '0'); } catch (er) {} snapLabel(); } });
  }
  // 🎨 цвет, материал, прозрачность — для всех выбранных
  function paintSheet(){
    const e = ed(), L = api.selected().filter(o => o.color !== undefined || o.mat !== undefined);
    if (!L.length) { api.msg('Сначала выбери деталь — нажми на неё', false); return; }
    const o = L[0];
    const sh = UI().sheet('paint', { title: `🎨 Цвет${L.length > 1 ? ' — выбрано ' + L.length : ': ' + esc(o.name)}`, html:
      `<div class="s3-pal">${COLORS.map(c => `<button type="button" data-a="color:${c}" style="background:${c}" class="${o.color === c ? 'on' : ''}" title="${c}"></button>`).join('')}<label class="s3-cpick" title="Свой цвет"><input type="color" value="${/^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color : '#888888'}" data-s="color">🎨</label></div>`
      + `<div class="s3x-sec">Материал</div><div class="s3-mats">${e.SC.MATS.map(([k, n, i]) => `<button type="button" data-a="mat:${k}" class="${o.mat === k ? 'on' : ''}" title="${n}">${i}<small>${n}</small></button>`).join('')}</div>`
      + (o.alpha !== undefined ? `<label class="s3-lbl">Прозрачность <b>${(+o.alpha || 0).toFixed(2)}</b><input type="range" min="0" max="1" step="0.05" value="${+o.alpha || 0}" data-s="alpha"></label>` : '') });
    if (!sh) return;
    sh.classList.add('s3x-paint');
    sh.addEventListener('click', ev => { const b = ev.target.closest('[data-a]'); if (!b) return; setTimeout(() => { sh.querySelectorAll(`[data-a^="${b.dataset.a.split(':')[0]}:"]`).forEach(x => x.classList.toggle('on', x === b)); }, 0); });
    let histT = 0;
    const live = (k, v, el) => {
      const now = performance.now(); if (now - histT > 700) api.pushHist(); histT = now;
      for (const x of api.selected()) if (x[k] !== undefined) e.SC.set(x, k, v);
      api.markDirty();
      if (k === 'alpha') { const b = el.closest('label')?.querySelector('b'); if (b) b.textContent = (+v).toFixed(2); }
    };
    sh.addEventListener('input', ev => { const k = ev.target.dataset.s; if (k === 'alpha') live('alpha', +ev.target.value, ev.target); });
    sh.addEventListener('change', ev => { const k = ev.target.dataset.s; if (k === 'color') { live('color', ev.target.value.toLowerCase(), ev.target); core().renderProps(); } });
  }
  function showProps(){ const e = ed(); e.box.classList.remove('s3-showL', 's3-showB'); if (e.panel !== 'props') core().setPanel('props'); else e.box.classList.toggle('s3-showR'); }
  function openAdd(){ const e = ed(), b = e.q('.s3x-bar .add') || e.q('[data-a="menu:part"]'); e.box.classList.remove('s3-showL', 's3-showR', 's3-showB'); UI().closeSheet(true); core().openMenu('part', b); e.menuFor = 'menu:part'; }
  function showB(tab){ const e = ed(); api.setBottom(tab || 'out'); e.box.classList.remove('s3-showL', 's3-showR'); e.box.classList.add('s3-showB'); }
  // «⋯ Ещё»: всё, что не влезло, — плитками (и кнопки других расширений)
  function moreSheet(){
    const e = ed(), tiles = [
      ['menu:file', '📁', 'Файл и новый мир'], ['menu:prefab', '🌳', 'Предметы'], ['menu:models', '🧩', 'Мои модели'], ['add:Script', '📜', 'Скрипт'],
      ['s3x:panel:terrain', '⛰', 'Земля'], ['s3x:panel:light', '☀', 'Свет'], ['s3x:out', '🖨', 'Вывод'],
    ];
    const ext = [...(e.q('.s3-ext')?.querySelectorAll('button') || [])].filter(b => !b.hidden && b.dataset.a !== 's3x:keys');
    let html = '<div class="s3x-tiles">' + tiles.map(([a, i, t]) => `<button type="button" class="s3x-tile" data-m2="${a}"><i>${i}</i>${t}</button>`).join('')
      + ext.map((b, k) => { const t = (b.title || b.textContent || '').split(/[—:(]/)[0].trim(), ic = (b.textContent.trim().match(/^\S+/) || ['•'])[0]; return `<button type="button" class="s3x-tile" data-ext="${k}"><i>${esc(ic)}</i>${esc(t.replace(ic, '').trim() || t)}</button>`; }).join('')
      + `<button type="button" class="s3x-tile" data-m2="mp:test"><i>👥</i>Тест вдвоём</button><button type="button" class="s3x-tile go" data-m2="publish"><i>📤</i>Выложить</button>`
      + `<button type="button" class="s3x-tile" data-m2="s3x:settings"><i>⚙️</i>Настройки</button><button type="button" class="s3x-tile" data-m2="s3x:full"><i>⛶</i>Весь экран</button>`
      + `<button type="button" class="s3x-tile" data-m2="s3x:keys"><i>❓</i>Управление</button><button type="button" class="s3x-tile" data-m2="s3x:hints"><i>💡</i>Подсказки</button>`
      + '</div>';
    const sh = UI().sheet('more', { title: '••• Ещё', html }); if (!sh) return;
    sh.addEventListener('click', ev => {
      const b = ev.target.closest('[data-m2],[data-ext]'); if (!b) return;
      UI().closeSheet(true);
      if (b.dataset.ext) { ext[+b.dataset.ext]?.click(); return; }
      const a = b.dataset.m2, C = core();
      if (a.startsWith('menu:')) { C.openMenu(a.slice(5), e.q('.s3x-more')); e.menuFor = a; }
      else if (a.startsWith('s3x:panel:')) { e.box.classList.remove('s3-showL', 's3-showB'); C.setPanel(a.slice(10)); }
      else if (a === 's3x:out') showB('out');
      else if (a === 's3x:settings') window.D37Settings?.open?.({ ctx: 'engine' });
      else if (a === 's3x:full') e.q('.gs-s3 [data-gs-full]')?.click();
      else if (a === 's3x:keys') UI().keys();
      else if (a === 's3x:hints') { try { localStorage.removeItem('d37_s3_hints'); } catch (er) {} UI().refreshHints(); api.msg('💡 Подсказки снова видны', true); }
      else C.act(a, b);
    });
  }

  // меню студии на узком экране — плитками: значок отдельно от подписи
  function tileMenu(){
    const e = ed(), m = e?.q('.s3-menu'); if (!m || !e.box.classList.contains('s3-compact')) return;
    for (const b of m.children) {
      if (b.tagName !== 'BUTTON' || b.querySelector('.s3x-ti') || b.classList.contains('s3x-full')) continue;
      const t = b.textContent.trim(), mm = /^(\S+)\s+([\s\S]+)$/u.exec(t);
      if (!mm || /[a-zа-яё0-9]/i.test(mm[1])) continue;
      b.innerHTML = `<span class="s3x-ti">${esc(mm[1])}</span><span>${esc(mm[2])}</span>`;
    }
  }

  const touchK = k => k === 'touch' ? 1.75 : k === 'pad' ? 1.25 : 1;
  function hintFn(kind, e){
    if (kind !== 'touch') return null;
    if (multi) return '☑ Нажимай детали — добавляются к выбору · ✓ на плашке — закончить';
    return null;
  }

  E.studioExt = E.studioExt || [];
  E.studioExt.push({
    id: 'touch',
    mount(a){
      api = a; const e = a.ed; if (!e || e.player) return;
      try { const v = localStorage.getItem('d37_s3_surface'); if (v !== null) S3X.surface = v === '1'; } catch (er) {}
      G = E.gestures({});
      e.G.k = touchK(E.inputKind?.kind);
      offKind = E.inputKind?.on(k => { if (ed()?.G) { ed().G.k = touchK(k); ed().G.update(); } });
      build();
      mo = new MutationObserver(tileMenu); mo.observe(e.q('.s3-menu'), { childList: true });
      // ошибка скрипта на узком экране — подсказать, где смотреть
      moOut = new MutationObserver(ms => {
        const box = ed()?.box; if (!box?.classList.contains('s3-compact') || box.classList.contains('s3-showB')) return;
        for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('err')) { api.msg('❌ Ошибка в скрипте — ••• → 🖨 Вывод', false); return; }
      });
      moOut.observe(e.q('.s3-out'), { childList: true });
      offHint = E.s3ui?.hint(hintFn, 5);
    },
    unmount(){ clearTimeout(longT); mo?.disconnect(); moOut?.disconnect(); offHint?.(); offKind?.(); G = null; drag = two = null; multi = false; api = null; },
    select(o){
      chip(); closeCtx();
      const e = ed(); if (!e) return;
      if (o?.cls === 'Script' && e.box.classList.contains('s3-compact')) { e.box.classList.remove('s3-showL', 's3-showR'); e.box.classList.add('s3-showB'); }
    },
    play(){ closeCtx(); const e = ed(); e?.box.classList.remove('s3-showL', 's3-showR', 's3-showB'); G?.reset(); drag = two = null; },
    pointer(type, ev){
      if (ev.pointerType !== 'touch' || !G || !ed()?.SC || ed().playing) return false;
      const t = performance.now();
      if (type === 'down') {
        closeCtx(); core().closeMenu(); ed().box.classList.remove('s3-showL', 's3-showR', 's3-showB');
        try { ev.target.setPointerCapture(ev.pointerId); } catch (er) {}
        run(G.down(ev.pointerId, ev.clientX, ev.clientY, t));
        clearTimeout(longT); longT = setTimeout(() => run(G.tick(performance.now())), 560);
      } else if (type === 'move') run(G.move(ev.pointerId, ev.clientX, ev.clientY, t));
      else { clearTimeout(longT); run(G.up(ev.pointerId, ev.clientX, ev.clientY, t, ev.type === 'pointercancel')); }
      return true;
    },
    act(a, b){
      if (!a.startsWith('s3x:')) return false;
      const e = ed(), C = core();
      if (a === 's3x:add') { if (!e.q('.s3-menu').hidden && e.menuFor === 'menu:part') C.closeMenu(); else openAdd(); }
      else if (a.startsWith('s3x:tool:')) { const t = a.slice(9); C.tool(e.tool === t && t !== 'move' ? 'move' : t); barTools(); }
      else if (a === 's3x:paint') { if (E.s3ui.sheetOpen('paint')) E.s3ui.closeSheet(); else paintSheet(); }
      else if (a === 's3x:props') showProps();
      else if (a === 's3x:tree') { e.box.classList.remove('s3-showR', 's3-showB'); e.box.classList.toggle('s3-showL'); }
      else if (a === 's3x:more') { if (E.s3ui.sheetOpen('more')) E.s3ui.closeSheet(); else moreSheet(); }
      else if (a === 's3x:snap') { if (E.s3ui.sheetOpen('snap')) E.s3ui.closeSheet(); else snapSheet(); }
      else if (a === 's3x:closeL') e.box.classList.remove('s3-showL');
      else if (a === 's3x:closeR') e.box.classList.remove('s3-showR');
      else if (a === 's3x:closeB') e.box.classList.remove('s3-showB');
      else return false;
      return true;
    },
    // узкий экран: в «➕ Добавить» — ещё и готовые предметы, и свои модели
    menuHtml(html, kind){
      const e = ed(); if (kind !== 'part' || !e?.box.classList.contains('s3-compact')) return html;
      return html + '<div class="s3-mh">🌳 Готовые предметы</div>' + e.SC.PREFABS.map(([k, n, i]) => `<button type="button" data-m="prefab:${k}">${i} ${n}</button>`).join('')
        + '<button type="button" class="s3x-full" data-a="menu:models">🧩 Мои 3D-модели (.glb, .obj)…</button>';
    },
    // «➕ Добавить сюда» без studio3d-tools.js — просто на точку под пальцем
    inserted(obj){
      const at = S3X.nextAt; if (!at || S3X.placer) return;
      S3X.nextAt = null;
      const e = ed(), hit = core().pick(core().rayAt(at.x, at.y), true);
      const ray = core().rayAt(at.x, at.y), o = ray.ray.origin, d = ray.ray.direction, h = e.ph.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 200);
      const p = hit && hit.obj !== obj ? hit.point : h ? { x: h.x, y: h.y, z: h.z } : null;
      if (!p || !obj.pos) return;
      const half = obj.size && obj.cls !== 'Mesh' ? obj.size[1] / 2 : obj.cls === 'Mesh' ? obj.size[1] / 2 : 0;
      e.SC.set(obj, 'pos', [+p.x.toFixed(3), +(p.y + half).toFixed(3), +p.z.toFixed(3)]);
    },
    editFrame(){
      const e = ed(); if (!e) return;
      if (e.tool !== lastTool) barTools();
      const top = core().selTop(), sig = e.sel ? e.sel.id + ':' + top.length : null;
      if (sig !== lastSel) chip();
      const snapB = e.q('.s3x-snapbtn'); if (snapB && snapB.dataset.k !== `${e.G.snap}|${e.G.rsnap}|${S3X.surface}`) { snapB.dataset.k = `${e.G.snap}|${e.G.rsnap}|${S3X.surface}`; snapLabel(); }
      // ✕ у листа Свойств (заголовок перерисовывает setPanel)
      const rt = e.q('.s3-rtitle'); if (rt && !rt.querySelector('.s3x-x')) { const b = document.createElement('button'); b.type = 'button'; b.className = 's3x-x'; b.dataset.a = 's3x:closeR'; b.title = 'Закрыть'; b.textContent = '✕'; rt.appendChild(b); }
      const bar = e.q('.s3x-bar'); if (bar && e.box.classList.contains('s3-port')) { const h = bar.offsetHeight; if (h && e.box.style.getPropertyValue('--s3x-bar') !== h + 'px') e.box.style.setProperty('--s3x-bar', h + 'px'); }
    },
    key(ev){ if (ev.code === 'Escape' && ed()?.q('.s3x-ctx')) { closeCtx(); return true; } return false; },
  });
  E.s3touch = { _test: { orbit, fwd } };
})();
