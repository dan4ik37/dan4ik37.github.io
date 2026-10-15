// ═══════════════════════════════════════
//  «СТУДИЯ 3D» С ГЕЙМПАДА — расширение студии 'pad' (логика кнопок — D37E.padEdit, js/engine/edit-input.js)
// ═══════════════════════════════════════
// Стики — лететь и смотреть, LT / RT — вниз / вверх, L3 — быстрее. Прицел в центре: Ⓐ — выбрать то, что под ним; ещё раз Ⓐ
// по выбранному — взять и нести (едет по поверхностям за прицелом, LT / RT — ниже / выше), Ⓐ — поставить, Ⓑ — отмена.
// Ⓑ — снять выбор / закрыть; Ⓧ / Ⓨ — инструмент (выбор, двигать, размер, вращать); LB / RB — повернуть на шаг угла
// (инструмент «Размер» — меньше / больше; ничего не выбрано — повернуть вид на 45°); крестовина ← → — шаг сетки, ↑ ↓ —
// шаг угла; ☰ (Back / View) — круговое меню: добавить детали, предметы, персонажей, эффекты, «для игры», инструменты, цвет,
// копия, удалить, отменить; Start — ▶ Играть (в игре Start — стоп), R3 — к выбранному. Подсказки внизу — studio3d-ui.js.
(() => {
  const E = window.D37E = window.D37E || {};
  const S3X = E.s3x = E.s3x || { surface: true, nextAt: null };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TOOLS = [['select', '🖱', 'Выбор'], ['move', '✥', 'Двигать'], ['scale', '⤢', 'Размер'], ['rotate', '⟳', 'Вращать']];
  const GRID = [0, .25, .5, 1, 2, 4], ANG = [0, 5, 15, 45, 90];
  const PAL = ['#f2f3f3', '#1b2a35', '#c4281c', '#f5cd30', '#4b974b', '#0d69ac', '#6b327c', '#ff66cc', '#da8541', '#7c5c46'];
  let api = null, PE = null, grab = null, radial = null, lock = false, playWait = false, hover = null, histT = 0, offHint = null;
  const ed = () => api?.ed, core = () => api.core;

  // ── Круговое меню ──
  function items(){
    const e = ed(), SC = e.SC, fx = E.fx?.KINDS || {}, npc = core().npcPresets?.() || {};
    const sub = (list) => list.map(([i, t, a]) => ({ i, t, a }));
    const top = [
      { i: '🟫', t: 'Детали', sub: sub([['🟫', 'Блок', 'm:part:block'], ['⚪', 'Шар', 'm:part:ball'], ['🛢️', 'Цилиндр', 'm:part:cyl'], ['📐', 'Клин', 'm:part:wedge'], ['📍', 'Точка появления', 'm:spawn'], ['💡', 'Свет', 'm:light'], ['📦', 'Группа', 'm:model']]) },
      { i: '🌳', t: 'Предметы', sub: sub(SC.PREFABS.map(([k, n, i]) => [i, n, 'm:prefab:' + k])) },
      { i: '✨', t: 'Эффекты', sub: sub(Object.entries(fx).slice(0, 10).map(([k, K]) => [K.icon, K.name, 'm:fx:' + k])) },
      { i: '🧍', t: 'Персонажи', sub: sub(Object.entries(npc).map(([k, p]) => [p.icon, p.name.split(' (')[0], 'm:npc:' + k])) },
      { i: '🛠', t: 'Инструмент', sub: sub(TOOLS.map(([k, i, n]) => [i, n, 'tool:' + k])) },
      { i: '🎨', t: 'Цвет', sub: sub(PAL.map(c => [`<span style="display:inline-block;width:26px;height:26px;border-radius:50%;background:${c};border:2px solid #fff"></span>`, c, 'color:' + c])) },
      { i: '⧉', t: 'Копия', a: 'dup' }, { i: '🗑', t: 'Удалить', a: 'del' }, { i: '↶', t: 'Отменить', a: 'undo' }, { i: '▶', t: 'Играть', a: 'play' },
    ];
    const game = E.s3x.gameItems?.();   // studio3d-modes.js: камера, зоны, чекпоинты…
    if (game?.length) top.splice(4, 0, { i: '🎮', t: 'Для игры', sub: sub(game) });
    if (!npc || !Object.keys(npc).length) top.splice(top.findIndex(x => x.t === 'Персонажи'), 1);
    return top;
  }
  function openRadial(){
    const e = ed(); closeRadial();
    radial = { list: items(), stack: [], hot: -1, el: document.createElement('div') };
    radial.el.className = 's3x-radial';
    e.q('.s3-view').appendChild(radial.el);
    radial.el.addEventListener('click', ev => { const it = ev.target.closest('[data-k]'); if (it) { radial.hot = +it.dataset.k; pick(); } else if (ev.target === radial.el || ev.target.closest('.s3x-rc')) back(); });
    drawRadial();
  }
  function drawRadial(){
    const R = radial; if (!R) return;
    const n = R.list.length, title = R.stack.length ? R.stack[R.stack.length - 1].t : 'Меню';
    R.el.innerHTML = `<div class="s3x-rc">${esc(title)}<small>${E.inputKind?.kind === 'pad' ? 'Стик — выбрать<br>Ⓐ — да · Ⓑ — назад' : 'Нажми пункт'}</small></div>`
      + R.list.map((it, k) => { const a = (k / n) * Math.PI * 2, r = 38; return `<div class="s3x-ri${k === R.hot ? ' on' : ''}" data-k="${k}" style="left:${50 + Math.sin(a) * r}%;top:${50 - Math.cos(a) * r}%"><i>${it.i}</i>${esc(it.t)}</div>`; }).join('');
  }
  function closeRadial(){ radial?.el.remove(); radial = null; E.s3ui?.refreshHints(); }
  function back(){ const R = radial; if (!R) return; if (R.stack.length) { R.list = R.stack.pop().from; R.hot = -1; drawRadial(); } else closeRadial(); }
  function pick(){
    const R = radial; if (!R || R.hot < 0) return;
    const it = R.list[R.hot];
    if (it.sub) { R.stack.push({ t: it.t, from: R.list }); R.list = it.sub; R.hot = -1; drawRadial(); return; }
    closeRadial();
    doAct(it.a);
  }
  function doAct(a){
    const C = core(), e = ed();
    if (a.startsWith('m:')) C.menu(a.slice(2));
    else if (a.startsWith('tool:')) { C.tool(a.slice(5)); api.msg(toolName(), true); }
    else if (a.startsWith('color:')) { if (!api.selected().some(o => o.color !== undefined)) api.msg('Сначала выбери деталь (Ⓐ)', false); else C.act(a); }
    else if (a === 'dup') C.duplicate(); else if (a === 'del') C.remove(); else if (a === 'undo') C.undo(false);
    else if (a === 'play') playWait = true;
    void e;
  }
  const toolName = () => { const t = TOOLS.find(x => x[0] === ed().tool); return t ? `${t[1]} ${t[2]}` : ''; };

  // ── Взять и нести ──
  function startGrab(){
    const e = ed(), o = e.sel; if (!o) return;
    if (!o.pos && o.cls !== 'Model') return;
    grab = { o, st: {}, dy: 0 };
    api.msg('✋ Несёшь — Ⓐ поставить, Ⓑ отмена, LT/RT ниже/выше', true);
  }
  function grabStep(dt, lift){
    const e = ed(), g = grab; if (!g || !e.SC.get(g.o.id)) { grab = null; return; }
    const ray = core().centerRay();
    if (!g.st.started) { api.pushHist(); g.st.started = true; }
    if (S3X.place) S3X.place(g.o, ray, { noHist: true });
    else if (g.o.cls !== 'Model') core().dragPart(ray, g.st);
    if (lift) g.dy += lift * 6 * dt;
    if (g.dy && g.o.pos) e.SC.set(g.o, 'pos', [g.o.pos[0], +(g.o.pos[1] + g.dy).toFixed(3), g.o.pos[2]]);
    else if (g.dy && g.o.cls === 'Model') { const pv = e.SC.pivot(g.o); e.SC.set(g.o, 'pos', [pv[0], pv[1] + g.dy, pv[2]]); }
    core().updateGizmo();
  }
  function endGrab(cancel){
    const g = grab; grab = null; if (!g) return;
    if (cancel && g.st.started) { core().undo(false); api.msg('Отменено', false); }
    else { core().dragEnd(g.st); api.markDirty(); core().tut('move'); api.msg('✅ Поставлено', true); }
  }

  // ── Шаг: стики, кнопки ──
  function step(dt){
    const e = ed(); if (!e?.SC || e.playing || !PE) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : null, gp = pads && [...pads].find(p => p && p.connected);
    if (!gp) { PE.reset(); return; }
    // после игры (Start) — ждём, пока отпустят все кнопки, иначе тот же Start запустит игру снова
    if (lock) { if (gp.buttons.some(b => (b.value ?? (b.pressed ? 1 : 0)) > .3)) return; lock = false; PE.reset(); }
    const out = PE.update(gp, dt, { sel: !!e.sel, grab: !!grab, radial: !!radial });
    if (out.active && E.inputKind?.kind !== 'pad') E.inputKind?.set('pad');
    if (playWait && !gp.buttons[9]?.pressed && !gp.buttons[0]?.pressed) { playWait = false; endGrab(false); closeRadial(); lock = true; core().play(); return; }
    if (radial) {
      if (out.radial && Math.hypot(out.radial.x, out.radial.y) > .5) {
        const n = radial.list.length, a = Math.atan2(out.radial.x, -out.radial.y), k = ((Math.round(a / (Math.PI * 2) * n) % n) + n) % n;
        if (k !== radial.hot) { radial.hot = k; drawRadial(); }
      }
      for (const a of out.actions) { if (a === 'radialPick') pick(); else if (a === 'radialBack') back(); else if (a === 'radialClose') closeRadial(); }
      return;
    }
    // лететь и смотреть (чувствительность и инверсия — из ⚙️)
    const O = window.D37Opt || {}, sens = O.sens || 1, inv = O.invertY ? -1 : 1, sp = (out.fast ? 60 : 20) * dt;
    if (out.fly.x || out.fly.y || out.fly.z) core().fly(out.fly.x * sp, out.fly.y * sp, out.fly.z * sp);
    if (out.look.x || out.look.y) { const c = e.cam; c.yaw -= out.look.x * Math.abs(out.look.x) * 2.6 * sens * dt; c.pitch = Math.max(-1.45, Math.min(1.45, c.pitch + out.look.y * Math.abs(out.look.y) * 2 * sens * inv * dt)); }
    if (grab) grabStep(dt, out.lift);
    for (const a of out.actions) act(a);
  }
  function act(a){
    const e = ed(), C = core();
    if (a === 'select') {
      const hit = C.pick(C.centerRay(), false);
      if (hit && hit.obj === e.sel && (e.tool === 'move' || e.tool === 'select') && api.selected().length <= 1) startGrab();
      else if (hit) { api.select(hit.obj); api.msg(`Выбрано: ${hit.obj.name} — ещё Ⓐ, чтобы нести`, true); }
      else if (e.sel) api.select(null);
    }
    else if (a === 'place') endGrab(false);
    else if (a === 'cancel') endGrab(true);
    else if (a === 'deselect') api.select(null);
    else if (a === 'back') { if (!E.s3ui?.closeSheet()) C.closeMenu(); }
    else if (a === 'tool+' || a === 'tool-') { const i = TOOLS.findIndex(x => x[0] === e.tool), n = TOOLS.length; C.tool(TOOLS[(i + (a === 'tool+' ? 1 : n - 1)) % n][0]); api.msg(toolName(), true); }
    else if (a === 'rot+' || a === 'rot-') turn(a === 'rot+' ? 1 : -1);
    else if (a === 'grid+' || a === 'grid-') { const i = GRID.indexOf(+e.G.snap), j = Math.max(0, Math.min(GRID.length - 1, (i < 0 ? 3 : i) + (a === 'grid+' ? 1 : -1))); setSel('.s3-snap', GRID[j]); api.msg(GRID[j] ? `Сетка: ${String(GRID[j]).replace('.', ',')}` : 'Сетка: нет', true); }
    else if (a === 'angle+' || a === 'angle-') { const i = ANG.indexOf(+e.G.rsnap), j = Math.max(0, Math.min(ANG.length - 1, (i < 0 ? 2 : i) + (a === 'angle+' ? 1 : -1))); setSel('.s3-rsnap', ANG[j]); api.msg(ANG[j] ? `Шаг угла: ${ANG[j]}°` : 'Угол: свободно', true); }
    else if (a === 'radial') openRadial();
    else if (a === 'play') playWait = true;
    else if (a === 'focus') C.focus();
  }
  function setSel(q, v){
    if (S3X.setSnap) { S3X.setSnap(v, q === '.s3-rsnap'); return; }
    const s = ed().q(q); if (!s) return;
    if (![...s.options].some(o => +o.value === v)) { const op = document.createElement('option'); op.value = String(v); op.textContent = String(v); s.appendChild(op); }
    s.value = String(v); s.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // LB / RB: повернуть выбранное на шаг угла (Размер — меньше / больше); ничего не выбрано — повернуть вид на 45°
  function turn(dir){
    const e = ed(), C = core(), list = C.selTop().filter(o => o.cls !== 'Script');
    if (!list.length) { e.cam.yaw += dir * Math.PI / 4; return; }
    const now = performance.now(); if (now - histT > 700 && !grab) api.pushHist(); histT = now;
    if (e.tool === 'scale') {
      const k = dir > 0 ? 1.25 : .8;
      for (const o of list) if (Array.isArray(o.size)) e.SC.set(o, 'size', o.size.map(v => Math.max(.1, Math.min(1000, +(v * k).toFixed(3)))));
    } else {
      const step = (e.G.rsnap || 15) * dir;
      if (list.length === 1 && list[0].rot && list[0].cls !== 'Model') { const o = list[0]; e.SC.set(o, 'rot', [o.rot[0], (((o.rot[1] + step) % 360) + 360) % 360, o.rot[2]]); }
      else { const T = e.R.T, b = new T.Box3(); for (const o of list) b.union(e.SC.box(o)); const c = b.getCenter(new T.Vector3()); for (const o of list) C.turnAround(o, [c.x, c.y, c.z], step); }
    }
    api.markDirty(); C.updateGizmo(); C.renderProps();
  }

  // ── Прицел и подсветка ──
  function frame(){
    const e = ed(); if (!e?.SC) return;
    const on = E.inputKind?.kind === 'pad' && !e.playing;
    let cr = e.q('.s3x-cross'), tag = e.q('.s3x-padtag');
    if (!cr) { cr = document.createElement('div'); cr.className = 's3x-cross'; tag = document.createElement('div'); tag.className = 's3x-padtag'; e.q('.s3-view').append(cr, tag); }
    cr.hidden = tag.hidden = !on;
    if (!hover) { const T = e.R.T; hover = new T.Box3Helper(new T.Box3(), new T.Color('#fbbf24')); hover.material.depthTest = false; hover.material.toneMapped = false; hover.renderOrder = 996; e.R.scene.add(hover); }
    hover.visible = false;
    if (!on) return;
    const ray = core().centerRay();
    e.G.hover(ray);
    let text = '';
    if (grab) { cr.className = 's3x-cross grab'; text = '✋ ' + grab.o.name; }
    else {
      const hit = core().pick(ray, false);
      cr.className = 's3x-cross' + (hit ? ' hot' : '');
      if (hit && hit.obj !== e.sel) { hover.box.copy(e.SC.box(hit.obj)); hover.visible = !hover.box.isEmpty(); text = 'Ⓐ ' + hit.obj.name; }
      else if (hit) text = e.tool === 'move' || e.tool === 'select' ? 'Ⓐ взять: ' + hit.obj.name : hit.obj.name;
    }
    if (tag.textContent !== text) tag.textContent = text;
    tag.hidden = !text;
  }

  function hintFn(kind){
    if (kind !== 'pad') return null;
    const K = (k, t) => `<kbd>${k}</kbd> ${t}`;
    if (radial) return `${K('стик', 'выбрать')} · ${K('Ⓐ', 'да')} · ${K('Ⓑ', 'назад')} · ${K('☰', 'закрыть')}`;
    if (grab) return `${K('Ⓐ', 'поставить')} · ${K('Ⓑ', 'отмена')} · ${K('LT RT', 'ниже / выше')} · ${K('LB RB', 'повернуть')} · ${K('крестовина', 'сетка')}`;
    return null;
  }

  E.studioExt = E.studioExt || [];
  E.studioExt.push({
    id: 'pad',
    mount(a){
      api = a; const e = a.ed; if (!e || e.player) return;
      PE = E.padEdit({});
      offHint = E.s3ui?.hint(hintFn, 6);
      window.addEventListener('gamepadconnected', onConn);
    },
    unmount(){ window.removeEventListener('gamepadconnected', onConn); offHint?.(); closeRadial(); grab = null; hover = null; PE = null; api = null; },
    editStep(dt){ try { step(dt); } catch (er) { console.error('студия, геймпад', er); } },
    editFrame(){ frame(); },
    select(){ if (grab && ed()?.sel !== grab.o) grab = null; E.s3ui?.refreshHints(); },
    play(){ closeRadial(); if (grab) endGrab(false); },
    stop(){ lock = true; PE?.reset(); },
    key(e){ if (e.code === 'Escape' && radial) { closeRadial(); return true; } return false; },
  });
  function onConn(){ if (!api?.ed) return; E.inputKind?.set('pad'); api.msg('🎮 Геймпад подключён: стики — лететь, Ⓐ — выбрать, ☰ — меню', true); }
  E.s3pad = { _test: { items: () => (api ? items() : []) } };
})();
