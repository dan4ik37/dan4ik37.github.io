// ═══════════════════════════════════════
//  «СТУДИЯ 3D» — инструменты (расширение студии 'tools'): виды «сверху / спереди / сбоку» и закладки камеры,
//  «🧲 на поверхность», «⤓ на землю», «▦ массив» (копии рядом, лестница, кольцо, стопка)
// ═══════════════════════════════════════
// Виды (кнопка «🎥 Вид», Num 7 / 1 / 3, Num 5 — обычный): камера далеко и с узким углом — почти без перспективы (как
// чертёж); ПКМ или два пальца — сдвиг, колесо / щипок — ближе, WASD — сдвиг, Q/E — ближе/дальше; туман на это время
// отодвигается. Закладки: Alt+1…4 — перейти, Alt+Shift+1…4 — запомнить (на каждый мир своё, в браузере d37_s3_bm_<мир>).
// 🧲 На поверхность (M, или 🧲 на телефоне): новое и перетаскиваемое ложится на то, что под курсором/пальцем/прицелом;
// на стене деталь встаёт плашмя к стене (локальная ось Y — от стены), на полу — стоя; шаг сетки — вдоль поверхности.
// E.s3x.place(obj, raycaster) — то же для геймпада. ⤓ На землю (End) — опустить выбранное, пока не упрётся.
// ▦ Массив (R): сколько копий, сдвиг на шаг и поворот на шаг — «черепаха»: без поворота — ряд, с подъёмом — лестница,
// 360/N — кольцо; предпросмотр рамками; один шаг «Отменить».
(() => {
  const E = window.D37E = window.D37E || {};
  const S3X = E.s3x = E.s3x || { surface: true, nextAt: null };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEG = Math.PI / 180;
  const VIEWS = { top: ['🗺️', 'Сверху'], front: ['🎯', 'Спереди'], side: ['📐', 'Сбоку'] };
  let api = null, V = null, anim = null, rdrag = null, prev = null, offHint = null;
  const ed = () => api?.ed, core = () => api.core;

  // ═══ Виды «сверху / спереди / сбоку» ═══
  const D = 320;   // камера далеко, угол узкий — почти чертёж
  const fwd = (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  function viewCenter(){
    const e = ed(), T = e.R.T, L = core().selTop().filter(o => o.cls !== 'Script');
    if (L.length) { const b = new T.Box3(); for (const o of L) b.union(e.SC.box(o)); if (!b.isEmpty()) { const c = b.getCenter(new T.Vector3()); return [c.x, c.y, c.z]; } }
    const ray = core().centerRay(), hit = e.SC.pick(ray); if (hit) return [hit.point.x, hit.point.y, hit.point.z];
    const o = ray.ray.origin, d = ray.ray.direction, h = e.ph.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 300); if (h) return [h.x, h.y, h.z];
    const c = e.cam, f = fwd(c.yaw, c.pitch); return [c.x + f[0] * 20, c.y + f[1] * 20, c.z + f[2] * 20];
  }
  function setView(kind, o = {}){
    const e = ed(); if (!e) return;
    if (!kind || kind === 'persp') { exitView(); return; }
    const c = e.cam, C = o.center || (V ? V.center : viewCenter());
    if (!V) V = { saved: { ...c }, H: Math.max(4, Math.min(120, Math.hypot(c.x - C[0], c.y - C[1], c.z - C[2]) * Math.tan(25 * DEG))) };
    V.kind = kind; V.center = C.slice(); if (o.H) V.H = o.H;
    const yaw = kind === 'side' ? Math.PI / 2 : 0, pitch = kind === 'top' ? Math.PI / 2 - 1e-4 : 0, f = fwd(yaw, pitch);
    Object.assign(c, { x: C[0] - f[0] * D, y: C[1] - f[1] * D, z: C[2] - f[2] * D, yaw, pitch });
    tag(); E.s3ui?.refreshHints();
  }
  function exitView(){
    const e = ed(); if (!e || !V) return;
    const s = V.saved, C = V.center, dist = V.H / Math.tan(25 * DEG), f = fwd(s.yaw, s.pitch);
    Object.assign(e.cam, { x: C[0] - f[0] * dist, y: C[1] - f[1] * dist, z: C[2] - f[2] * dist, yaw: s.yaw, pitch: s.pitch });
    fogBack(); V = null;
    const cam = e.R.camera; cam.fov = cam.userData.fov0 || 50; cam.updateProjectionMatrix();
    tag(); E.s3ui?.refreshHints();
  }
  function panView(dx, dy){
    const e = ed(); if (!V || !e) return;
    const c = e.cam, f = fwd(c.yaw, c.pitch), r = [Math.cos(c.yaw), 0, -Math.sin(c.yaw)], u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const k = 2 * V.H / (e.q('.s3-view').clientHeight || 600);
    for (let i = 0; i < 3; i++) { const m = -r[i] * dx * k + u[i] * dy * k; V.center[i] += m; }
    c.x = V.center[0] - f[0] * D; c.y = V.center[1] - f[1] * D; c.z = V.center[2] - f[2] * D;
  }
  const zoomView = k => { if (V) V.H = Math.max(1.5, Math.min(400, V.H * k)); };
  S3X.ortho = { get on(){ return !!V; }, pan: panView, zoom: zoomView, set: (k, o) => setView(k, o) };
  // туман и дальняя плоскость — дальше на время вида (камера в 320 ед. от мира), потом как были. render.js сам меняет туман и
  // camera.far (свет, «Дальность» в ⚙️) — тогда берём его новые значения за основу
  let fogObj = null, fogBase = null, fogSet = null, far0 = 0, farSet = 0;
  function fogFor(){
    const R = ed()?.R, fog = R?.scene.fog, cam = R?.camera; if (!cam) return;
    if (cam.far !== farSet) far0 = cam.far;
    const fw = Math.max(far0, D + 400); if (cam.far !== fw) { cam.far = fw; cam.updateProjectionMatrix(); } farSet = fw;
    if (!fog) return;
    if (fog !== fogObj || !fogSet || fog.near !== fogSet.near || fog.far !== fogSet.far) { fogObj = fog; fogBase = { near: fog.near, far: fog.far }; }
    fog.near = fogBase.near + D; fog.far = fogBase.far + D; fogSet = { near: fog.near, far: fog.far };
  }
  function fogBack(){
    if (fogObj && fogBase && fogSet && fogObj.near === fogSet.near && fogObj.far === fogSet.far) { fogObj.near = fogBase.near; fogObj.far = fogBase.far; }
    const cam = ed()?.R?.camera; if (cam && far0 && cam.far === farSet) { cam.far = far0; cam.updateProjectionMatrix(); }
    fogObj = fogBase = fogSet = null; far0 = farSet = 0;
  }
  function tag(){
    const e = ed(); if (!e) return;
    let t = e.q('.s3x-viewtag');
    if (!V) { t?.remove(); return; }
    if (!t) { t = document.createElement('div'); t.className = 's3x-viewtag'; e.q('.s3-view').appendChild(t); }
    t.textContent = `${VIEWS[V.kind][0]} Вид ${VIEWS[V.kind][1].toLowerCase()} · Num 5 — обычный`;
  }

  // ═══ Закладки камеры ═══
  const bmKey = () => 'd37_s3_bm_' + (ed()?.placeId || 'x');
  const bmAll = () => { try { const v = JSON.parse(localStorage.getItem(bmKey()) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  function bmSave(i){
    const e = ed(), list = bmAll();
    list[i] = { ...e.cam, v: V ? { kind: V.kind, H: V.H, center: V.center.slice(), saved: { ...V.saved } } : null };
    try { localStorage.setItem(bmKey(), JSON.stringify(list.slice(0, 4))); } catch (er) {}
    api.msg(`📌 Закладка ${i + 1} запомнена (Alt+${i + 1} — сюда)`, true);
  }
  function bmGo(i){
    const b = bmAll()[i]; if (!b) { api.msg(`Закладки ${i + 1} нет — Alt+Shift+${i + 1}, чтобы запомнить`, false); return; }
    const e = ed();
    if (b.v) { if (!V) V = { saved: { ...b.v.saved }, H: b.v.H }; setView(b.v.kind, { center: b.v.center, H: b.v.H }); return; }
    if (V) { fogBack(); V = null; tag(); const cam = e.R.camera; cam.fov = cam.userData.fov0 || 50; cam.updateProjectionMatrix(); }
    anim = { from: { ...e.cam }, to: b, t: 0 };
  }
  function animStep(dt){
    if (!anim) return;
    const e = ed(); anim.t = Math.min(1, anim.t + dt / .45);
    const k = anim.t * anim.t * (3 - 2 * anim.t), a = anim.from, b = anim.to;
    let dy = b.yaw - a.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    Object.assign(e.cam, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: a.yaw + dy * k, pitch: a.pitch + (b.pitch - a.pitch) * k });
    if (anim.t >= 1) anim = null;
  }
  function viewSheet(){
    const list = bmAll(), cur = V?.kind || 'persp';
    const sh = E.s3ui?.sheet('view', { title: '🎥 Вид и закладки', html:
      `<div class="s3x-tiles">${[['persp', '🎥', 'Обычный', 'Num 5'], ['top', '🗺️', 'Сверху', 'Num 7'], ['front', '🎯', 'Спереди', 'Num 1'], ['side', '📐', 'Сбоку', 'Num 3']].map(([k, i, t, h]) => `<button type="button" class="s3x-tile${cur === k ? ' on' : ''}" data-v="${k}" title="${h}"><i>${i}</i>${t}</button>`).join('')}</div>`
      + `<p class="s3-note">Сверху/спереди/сбоку — как чертёж: удобно ровнять детали. ПКМ (или два пальца) — сдвиг, колесо — ближе.</p>`
      + `<div class="s3x-sec">📌 Закладки камеры</div>`
      + [0, 1, 2, 3].map(i => `<div class="s3x-bm"><button type="button" data-g="${i}" ${list[i] ? '' : 'disabled'} title="Alt+${i + 1}">🎯 ${i + 1}</button><span>${list[i] ? (list[i].v ? VIEWS[list[i].v.kind][1] : 'Своя камера') : 'пусто'}</span><button type="button" data-s="${i}" title="Alt+Shift+${i + 1}">📌 Запомнить</button></div>`).join('') });
    if (!sh) return;
    sh.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.v) { setView(b.dataset.v); E.s3ui.closeSheet(); }
      else if (b.dataset.g) { bmGo(+b.dataset.g); E.s3ui.closeSheet(); }
      else if (b.dataset.s) { bmSave(+b.dataset.s); viewSheet(); }
    });
  }

  // ═══ 🧲 На поверхность ═══
  const UPRIGHT_ONLY = new Set(['Prefab', 'NPC', 'Light', 'Effect', 'Model', 'Mesh', 'Camera']);
  const autoRot = new WeakSet();   // кого повернули к стене мы (их и возвращаем стоя)
  // луч по всему, кроме самого объекта (и его частей), + ландшафт или земля; нормаль — в мире
  function surfaceHit(o, ray){
    const e = ed(), skip = new Set([o.id, ...e.SC.descendants(o).map(x => x.id)]), meshes = [];
    for (const x of e.SC.all()) if (x._mesh && !skip.has(x.id) && x._mesh.visible !== false && !['Light', 'Effect', 'Camera', 'Script'].includes(x.cls)) meshes.push(x._mesh);
    if (e.TR.enabled && e.TR.mesh) meshes.push(e.TR.mesh); else if (e.ground) meshes.push(e.ground);
    const T = e.R.T;
    for (const h of ray.intersectObjects(meshes, true)) {
      let n = h.object; while (n && !n.userData.oid && !n.userData.terrain && n !== e.ground && n !== e.TR.mesh) n = n.parent;
      if (n?.userData.oid && skip.has(n.userData.oid)) continue;
      const nrm = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new T.Vector3(0, 1, 0);
      if (nrm.dot(ray.ray.direction) > 0) nrm.negate();   // изнанка — к нам
      return { p: h.point, n: nrm, oid: n?.userData.oid || null };
    }
    return null;
  }
  // поставить объект на поверхность под лучом (true — получилось)
  function place(o, ray, opt = {}){
    const e = ed(); if (!e || !o) return false;
    const h = surfaceHit(o, ray); if (!h) return false;
    const n = h.n, wall = Math.abs(n.y) < .45, ceil = n.y < -.6, snap = e.G.snap || 0, sn = v => snap ? Math.round(v / snap) * snap : v;
    const align = S3X.surface && !UPRIGHT_ONLY.has(o.cls) && (o.cls === 'Part' || o.cls === 'Spawn') && opt.align !== false;
    // к стене — плашмя; поворачиваем только стоящие ровно (или повёрнутые нами же), свой наклон человека не трогаем
    const ours = autoRot.has(o), upright = !o.rot?.[0] && !o.rot?.[2];
    if (align && o.rot && (upright || ours)) {
      if (wall) { const yaw = (((Math.round(Math.atan2(n.x, n.z) / DEG / 90) * 90) % 360) + 360) % 360; if (o.rot[0] !== 90 || o.rot[1] !== yaw || o.rot[2]) { e.SC.set(o, 'rot', [90, yaw, 0]); autoRot.add(o); } }
      else if (ours && o.rot[0] === 90) { e.SC.set(o, 'rot', [0, o.rot[1], 0]); autoRot.delete(o); }   // со стены — снова стоя
    }
    const b = e.SC.box(o); if (b.isEmpty()) return false;
    const size = b.getSize(new e.R.T.Vector3()), piv = o.cls === 'Model' ? e.SC.pivot(o) : o.pos;
    const off = [piv[0] - (b.min.x + b.max.x) / 2, piv[1] - b.min.y, piv[2] - (b.min.z + b.max.z) / 2];   // от «низа-середины» коробки до точки объекта
    let x, y, z;
    if (wall) {
      const ax = Math.abs(n.x) > Math.abs(n.z) ? 0 : 2, half = (ax === 0 ? size.x : size.z) / 2;
      const cx = h.p.x + (ax === 0 ? Math.sign(n.x) * half : 0), cz = h.p.z + (ax === 2 ? Math.sign(n.z) * half : 0);
      x = ax === 0 ? cx : sn(cx); z = ax === 2 ? cz : sn(cz);
      const bottom = sn(h.p.y - size.y / 2); y = Math.max(bottom, e.ph.groundAt ? e.ph.groundAt(x, z) - 1e-3 : -1e9);
      x += off[0]; z += off[2]; y += off[1];
    } else if (ceil) { x = sn(h.p.x) + off[0]; z = sn(h.p.z) + off[2]; y = h.p.y - size.y + off[1]; }
    else { x = sn(h.p.x) + off[0]; z = sn(h.p.z) + off[2]; y = h.p.y + off[1]; }
    const p = [+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)];
    if (!opt.noHist && opt.hist) api.pushHist();
    e.SC.set(o, 'pos', p);
    return true;
  }
  S3X.place = place;
  S3X.placer = true;   // studio3d-touch.js: «➕ Добавить сюда» ставим здесь
  // ⤓ на землю: вниз, пока не упрётся (детали, модели, предметы)
  function drop(){
    const e = ed(), L = core().selTop().filter(o => o.cls !== 'Script' && (o.pos || o.cls === 'Model'));
    if (!L.length) { api.msg('Выбери, что опустить', false); return; }
    api.pushHist();
    const T = e.R.T, rc = new T.Raycaster();
    for (const o of L) {
      const b = e.SC.box(o); if (b.isEmpty()) continue;
      const c = b.getCenter(new T.Vector3());
      rc.set(new T.Vector3(c.x, b.min.y + .02, c.z), new T.Vector3(0, -1, 0));
      const h = surfaceHit(o, rc), floor = Math.max(h ? h.p.y : -Infinity, e.ph.groundAt ? e.ph.groundAt(c.x, c.z) : 0);
      if (!Number.isFinite(floor)) continue;
      core().moveBy(o, [0, +(floor - b.min.y).toFixed(4), 0]);
    }
    api.markDirty(); core().updateGizmo(); core().renderProps();
    api.msg('⤓ Опущено на землю', true);
  }

  // ═══ ▦ Массив ═══
  let arr = null;   // { n, d: [x,y,z], turn, boxes: [] }
  function arraySheet(){
    const e = ed(), L = core().selTop().filter(o => o.cls !== 'Script');
    if (!L.length) { api.msg('Сначала выбери, что размножить', false); return; }
    const T = e.R.T, b = new T.Box3(); for (const o of L) b.union(e.SC.box(o));
    const s = b.getSize(new T.Vector3());
    arr = arr && arr.sel === L.map(o => o.id).join() ? arr : { sel: L.map(o => o.id).join(), n: 5, d: [+s.x.toFixed(2), 0, 0], turn: 0, size: [s.x, s.y, s.z] };
    const num = (k, v, st, lbl) => `<label>${lbl}<input type="number" step="${st}" value="${v}" data-k="${k}"></label>`;
    const sh = E.s3ui?.sheet('array', { title: '▦ Массив — копии рядом', html:
      `<p class="s3-note">Выбрано: <b>${L.length}</b>. Каждая копия сдвигается на шаг и поворачивается на угол — как черепашка.</p>`
      + `<div class="s3x-tiles">${[['row', '➡️', 'Ряд'], ['stack', '⬆️', 'Стопка'], ['stairs', '🪜', 'Лестница'], ['ring', '⭕', 'Кольцо'], ['spiral', '🌀', 'Винтовая']].map(([k, i, t]) => `<button type="button" class="s3x-tile" data-p="${k}"><i>${i}</i>${t}</button>`).join('')}</div>`
      + `<div class="s3x-arr">${num('n', arr.n, 1, 'Сколько всего')}${num('turn', arr.turn, 5, 'Поворот на шаг, °')}<span></span>${num('dx', arr.d[0], .5, 'Шаг X')}${num('dy', arr.d[1], .5, 'Шаг Y')}${num('dz', arr.d[2], .5, 'Шаг Z')}</div>`
      + `<div class="s3x-row"><button type="button" class="s3-play" data-go="1">▦ Сделать</button></div>`,
      onClose: () => preview(false) });
    if (!sh) return;
    const read = () => { const g = k => +sh.querySelector(`[data-k="${k}"]`).value || 0; arr.n = Math.max(2, Math.min(50, Math.round(g('n')))); arr.turn = Math.max(-360, Math.min(360, g('turn'))); arr.d = [g('dx'), g('dy'), g('dz')].map(v => Math.max(-500, Math.min(500, v))); preview(true); };
    const fill = () => { sh.querySelector('[data-k="n"]').value = arr.n; sh.querySelector('[data-k="turn"]').value = arr.turn; ['dx', 'dy', 'dz'].forEach((k, i) => { sh.querySelector(`[data-k="${k}"]`).value = +arr.d[i].toFixed(3); }); preview(true); };
    sh.addEventListener('input', read);
    sh.addEventListener('click', ev => {
      const p = ev.target.closest('[data-p]')?.dataset.p, [sx, sy, sz] = arr.size;
      if (p === 'row') { arr.turn = 0; arr.d = [+sx.toFixed(2), 0, 0]; }
      else if (p === 'stack') { arr.turn = 0; arr.d = [0, +sy.toFixed(2), 0]; }
      else if (p === 'stairs') { arr.turn = 0; arr.d = [0, +sy.toFixed(2), -+sz.toFixed(2)]; arr.n = Math.max(arr.n, 8); }
      else if (p === 'ring') { arr.n = Math.max(arr.n, 8); arr.turn = +(360 / arr.n).toFixed(2); arr.d = [+(sx * 1.05).toFixed(2), 0, 0]; }
      else if (p === 'spiral') { arr.n = Math.max(arr.n, 12); arr.turn = 30; arr.d = [+(sx * .9).toFixed(2), +(sy * .9).toFixed(2), 0]; }
      if (p) { fill(); return; }
      if (ev.target.closest('[data-go]')) { read(); makeArray(); E.s3ui.closeSheet(); }
    });
    preview(true);
  }
  // k-я копия: поворот на k·угол вокруг центра выбранного, потом сдвиг на сумму шагов (каждый шаг повёрнут на i·угол)
  const stepOf = (k, d, turn) => { let x = 0, y = 0, z = 0; for (let i = 0; i < k; i++) { const a = i * turn * DEG, ca = Math.cos(a), sa = Math.sin(a); x += d[0] * ca + d[2] * sa; z += -d[0] * sa + d[2] * ca; y += d[1]; } return [x, y, z]; };
  function preview(on){
    const e = ed(); if (!e) return;
    for (const b of arr?.boxes || []) { e.R.scene.remove(b); b.geometry?.dispose(); }
    if (arr) arr.boxes = [];
    if (!on || !arr) return;
    const T = e.R.T, L = core().selTop().filter(o => o.cls !== 'Script'), b0 = new T.Box3(); for (const o of L) b0.union(e.SC.box(o));
    if (b0.isEmpty()) return;
    for (let k = 1; k < arr.n; k++) {
      const s = stepOf(k, arr.d, arr.turn), bb = b0.clone().translate(new T.Vector3(...s));
      const h = new T.Box3Helper(bb, new T.Color('#4ade80')); h.material.depthTest = false; h.material.toneMapped = false; h.renderOrder = 995;
      e.R.scene.add(h); arr.boxes.push(h);
    }
  }
  function makeArray(){
    const e = ed(), C = core(), L = C.selTop().filter(o => o.cls !== 'Script'); if (!L.length || !arr) return;
    preview(false);
    const T = e.R.T, b0 = new T.Box3(); for (const o of L) b0.union(e.SC.box(o));
    const c0 = b0.getCenter(new T.Vector3()), made = [];
    api.pushHist();
    for (let k = 1; k < arr.n; k++) {
      const s = stepOf(k, arr.d, arr.turn);
      for (const o of L) { const c = e.SC.clone(o); if (arr.turn) C.turnAround(c, [c0.x, c0.y, c0.z], k * arr.turn); C.moveBy(c, s); made.push(c); }
      if (e.SC.all().length > 3000) break;
    }
    api.markDirty(); C.renderTree(); api.setSel([...L, ...made]);
    api.msg(`▦ Готово: ${made.length} копий (Ctrl+Z — отменить)`, true);
  }

  // ═══ Подключение ═══
  function hintFn(kind){
    if (!V) return null;
    if (kind === 'touch') return `${VIEWS[V.kind][0]} Вид ${VIEWS[V.kind][1].toLowerCase()}: палец — сдвиг, щипок — ближе · 🎥 → Обычный`;
    if (kind === 'pad') return `${VIEWS[V.kind][0]} Вид ${VIEWS[V.kind][1].toLowerCase()}: стик — сдвиг, LT/RT — ближе/дальше`;
    return `${VIEWS[V.kind][0]} Вид ${VIEWS[V.kind][1].toLowerCase()}: <kbd>ПКМ</kbd> сдвиг · <kbd>WASD</kbd> сдвиг · <kbd>колесо</kbd> ближе · <kbd>Num 5</kbd> обычный вид`;
  }
  E.studioExt = E.studioExt || [];
  E.studioExt.push({
    id: 'tools',
    mount(a){
      api = a; const e = a.ed; if (!e || e.player) return;
      try { const v = localStorage.getItem('d37_s3_surface'); if (v !== null) S3X.surface = v === '1'; } catch (er) {}
      const add = (cls, a2, html, title) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.a = a2; b.title = title; b.setAttribute('aria-label', title.split(' (')[0]); b.innerHTML = html; a.slot?.appendChild(b); return b; };
      add('', 's3x:view', '🎥<span> Вид</span>', 'Вид сверху / спереди / сбоку и закладки камеры (Num 7 / 1 / 3)');
      add('', 's3x:array', '▦<span> Массив</span>', 'Массив: копии рядом, лестница, кольцо (R)');
      add('', 's3x:drop', '⤓<span> На землю</span>', 'Опустить выбранное на землю (End)');
      offHint = E.s3ui?.hint(hintFn, 4);
    },
    unmount(){ fogBack(); preview(false); arr = null; V = null; anim = null; offHint?.(); api = null; },
    act(a){
      if (a === 's3x:view') { if (E.s3ui?.sheetOpen('view')) E.s3ui.closeSheet(); else viewSheet(); return true; }
      if (a === 's3x:array') { if (E.s3ui?.sheetOpen('array')) E.s3ui.closeSheet(); else arraySheet(); return true; }
      if (a === 's3x:drop') { drop(); return true; }
      return false;
    },
    key(ev){
      const k = ev.code, ctrl = ev.ctrlKey || ev.metaKey;
      if (ctrl) return false;
      if (ev.altKey && /^Digit[1-4]$/.test(k)) { const i = +k.slice(5) - 1; if (ev.shiftKey) bmSave(i); else bmGo(i); return true; }
      if (k === 'Numpad7') { setView('top'); return true; } if (k === 'Numpad1') { setView('front'); return true; } if (k === 'Numpad3') { setView('side'); return true; }
      if (k === 'Numpad5' || k === 'Numpad0') { exitView(); return true; }
      if (k === 'KeyR' && !ev.altKey && !ev.shiftKey) { arraySheet(); return true; }
      if (k === 'End') { drop(); return true; }
      if (k === 'KeyM' && !ev.altKey) { S3X.surface = !S3X.surface; try { localStorage.setItem('d37_s3_surface', S3X.surface ? '1' : '0'); } catch (er) {} api.msg(S3X.surface ? '🧲 На поверхность: вкл — новое и перетаскиваемое ложится на поверхность, на стены — плашмя' : '🧲 На поверхность: выкл', true); return true; }
      if (V && k === 'KeyF') { const L = core().selTop(); if (L.length) { const T = ed().R.T, b = new T.Box3(); for (const o of L) b.union(ed().SC.box(o)); if (!b.isEmpty()) { const c = b.getCenter(new T.Vector3()), s = b.getSize(new T.Vector3()); setView(V.kind, { center: [c.x, c.y, c.z], H: Math.max(3, Math.max(s.x, s.y, s.z) * .9) }); } } return true; }
      return false;
    },
    // ПКМ / средняя кнопка в виде «сверху» — сдвиг (а не поворот)
    pointer(type, ev){
      if (!V || ev.pointerType === 'touch') return false;
      if (type === 'down' && (ev.button === 2 || ev.button === 1)) { rdrag = { x: ev.clientX, y: ev.clientY, id: ev.pointerId }; try { ev.target.setPointerCapture(ev.pointerId); } catch (er) {} return true; }
      if (rdrag && ev.pointerId === rdrag.id) {
        if (type === 'move') { panView(ev.clientX - rdrag.x, ev.clientY - rdrag.y); rdrag.x = ev.clientX; rdrag.y = ev.clientY; }
        else if (type === 'up') rdrag = null;
        return true;
      }
      return false;
    },
    wheel(ev){ if (!V) return false; zoomView(ev.deltaY > 0 ? 1.12 : 1 / 1.12); return true; },
    editFly(f, s, u, sp){ if (!V) return false; const k = (ed().q('.s3-view').clientHeight || 600) / (2 * V.H) * sp * .06 * V.H; panView(-s * k, f * k); if (u) zoomView(u > 0 ? 1 + sp * .05 : 1 / (1 + sp * .05)); return true; },
    editStep(dt){ animStep(dt); },
    editFrame(){
      const e = ed(); if (!e) return;
      if (V) {
        const cam = e.R.camera, fov = 2 * Math.atan(V.H / D) / DEG;
        if (Math.abs(cam.fov - fov) > 1e-4) { cam.fov = fov; cam.updateProjectionMatrix(); }
        fogFor(); e.R.follow(V.center[0], V.center[2], 0);
      }
      if (e.placeId !== prev) { prev = e.placeId; if (V) exitView(); }
    },
    inserted(obj){
      const at = S3X.nextAt; S3X.nextAt = null;
      if (!obj || ['Script', 'Light', 'Effect', 'Camera'].includes(obj.cls) || (!obj.pos && obj.cls !== 'Model')) return;   // лампа — в воздухе, камера — по виду
      if (!at && !S3X.surface) return;
      const ray = at ? core().rayAt(at.x, at.y) : core().centerRay();
      place(obj, ray);
    },
    dragPart(o, ray){ if (!S3X.surface) return false; return place(o, ray); },
    stop(){ /* после игры камера редактора — та же */ },
  });
  E.s3tools = { _test: { stepOf, fwd } };
})();
