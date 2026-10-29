// ═══════════════════════════════════════
//  КНОПКИ ТЕЛЕФОНА: РАСКЛАДКА И «НАСТРОИТЬ КНОПКИ» (D37TouchLayout) — общий помощник игр с кнопками на экране
// ═══════════════════════════════════════
// T-074 (владелец 22.10: «сделай не так размашисто кнопку «Инвентарь» и другие тоже получше. А то пол-экрана всё»).
// Игра кладёт кнопки в окно игры сама, а ГДЕ они стоят — решает помощник: по умолчанию — раскладка игры (функция defaults),
// а если игрок переставил их в редакторе (⚙️ → «Управление» → «🎮 Настроить кнопки», как в Minecraft Bedrock) — его раскладка.
// T = D37TouchLayout.attach({
//   id: 'kubomir', title: 'Кубомир', el: окно игры (кнопки — position: absolute в том же прямоугольнике),
//   items: () => [{ id, icon, label, same, opt }],   // все кнопки (и те, что иногда спрятаны: opt — когда видна); same — стоит там же, где другая
//   btn: id => элемент кнопки (или null),
//   defaults: (W, H, k, { lefty }) => ({ id: { x, y, d } }),   // середины (px от левого верхнего угла окна) и диаметры — для ПРАВОЙ
//                                                   // руки; k — «Размер кнопок» из ⚙️ (1 = 100 %); левша — зеркало делает помощник
//   apply: (id, el, { x, y, d, lefty, W, H, k, custom, any }) — своя расстановка (по умолчанию left/top/width/height в px, зеркало
//          для левши); custom — эта кнопка переставлена игроком, any — хоть одна (игра может до этого держать свою сетку),
//   avoid: () => [{ l, t, r, b, label }]        // что кнопкам закрывать нельзя (панель вещей…) — подсветка в редакторе
//   onEdit: (on, overlay) => {}                 // редактор открыт/закрыт — игра не слушает пальцы (overlay.close() — «Отмена»)
// })
// T.layout(force) — расставить (пишет стили ТОЛЬКО если поменялись окно, размер кнопок, левша или раскладка — не каждый кадр);
// игра зовёт из своего resize; T.detach(). D37TouchLayout.edit() — редактор для последней открытой игры; settingsRow() — строка
// для ⚙️ → «Управление» («🎮 Настроить кнопки»); seen(game, id) / markSeen(game, id) — подписи кнопок «до первого нажатия»;
// hintOnce(game, id) — подсказка один раз на устройство (T-123), resetSeen() — показать всё снова. attach({ alias: { pose: 'crouch' } })
// — сохранённое место старой кнопки достаётся новой (T-123: «⬇ присесть» стала кнопкой позы).
// Хранится на этом устройстве: localStorage d37_touch_layout = { v: 1, g: { <игра>: { l: {…}, p: {…} } } } — лёжа (l) и стоя (p)
// отдельно; кнопка = { x, y, ax, ay, d }: середина от ближнего края (ax: 1 — от правого, ay: 1 — от нижнего) и диаметр при 100 %.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const doc = root.document;
  if (root.D37TouchLayout) return;
  const LS = 'd37_touch_layout', SEEN = 'd37_touch_seen', MIN_K = .6, MAX_K = 1.7;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const r1 = v => Math.round(v * 2) / 2;
  const lsGet = k => { try { const v = JSON.parse(root.localStorage?.getItem(k) || 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) root.localStorage?.removeItem(k); else root.localStorage?.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const lefty = () => !!root.D37Opt?.lefty || !!doc?.documentElement?.classList?.contains('gs-lefty');
  const tsize = () => { const v = root.D37Settings?.get?.('touchSize'); return clamp((Number.isFinite(v) ? v : 100) / 100, .5, 2); };
  const orient = (W, H) => W > H ? 'l' : 'p';
  const ID_RE = /^[a-z0-9_-]{1,24}$/i;

  // ── хранилище (читается один раз; чужие/битые записи отбрасываются) ──
  let store = null, rev = 1;
  function load(){
    if (store) return store;
    const s = lsGet(LS), out = { v: 1, g: {} };
    if (s && s.v === 1 && s.g && typeof s.g === 'object') for (const [g, o] of Object.entries(s.g).slice(0, 20)) {
      if (!ID_RE.test(g) || !o || typeof o !== 'object') continue;
      for (const k of ['l', 'p']) { const m = clean(o[k]); if (m) (out.g[g] = out.g[g] || {})[k] = m; }
    }
    return (store = out);
  }
  function clean(m){
    if (!m || typeof m !== 'object') return null;
    const out = {}; let n = 0;
    for (const [id, e] of Object.entries(m).slice(0, 40)) {
      if (!ID_RE.test(id) || !e || typeof e !== 'object') continue;
      const x = +e.x, y = +e.y, d = +e.d;
      if (![x, y, d].every(Number.isFinite) || x < -50 || y < -50 || x > 5000 || y > 5000 || d < 16 || d > 300) continue;
      out[id] = { x: r1(x), y: r1(y), ax: e.ax ? 1 : 0, ay: e.ay ? 1 : 0, d: r1(d) }; n++;
    }
    return n ? out : null;
  }
  const saved = (g, o) => load().g[g]?.[o] || null;
  function put(g, o, m){
    const S = load();
    if (m && Object.keys(m).length) (S.g[g] = S.g[g] || {})[o] = m;
    else if (S.g[g]) { delete S.g[g][o]; if (!S.g[g].l && !S.g[g].p) delete S.g[g]; }
    lsSet(LS, Object.keys(S.g).length ? S : null);
    rev++;
    for (const T of live) T.layout(true);
  }

  // ── подписи «до первого нажатия» ──
  let seenM = null;
  const seenLoad = () => seenM || (seenM = lsGet(SEEN) || {});
  const seen = (g, id) => !!seenLoad()[g]?.[id];
  function markSeen(g, id){
    if (!ID_RE.test(g) || !ID_RE.test(id) || seen(g, id)) return;
    const m = seenLoad(); (m[g] = m[g] || {})[id] = 1; lsSet(SEEN, m);
  }
  // подсказка один раз на устройство (T-123): true — показать сейчас (и сразу запомнить); ⚙️ «Подсказки → Показать снова» — resetSeen
  const hintOnce = (g, id) => { if (!ID_RE.test(g) || !ID_RE.test(id) || seen(g, id)) return false; markSeen(g, id); return true; };
  function resetSeen(){ seenM = {}; lsSet(SEEN, null); }

  // ── вырез экрана (safe-area): меряется пробником внутри окна игры (только при раскладке, не каждый кадр) ──
  function safe(el){
    if (!doc || !el) return { t: 0, r: 0, b: 0, l: 0 };
    const p = doc.createElement('div');
    p.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    el.appendChild(p);
    const cs = root.getComputedStyle ? root.getComputedStyle(p) : null, v = k => (cs && parseFloat(cs[k])) || 0;
    const out = { t: v('paddingTop'), r: v('paddingRight'), b: v('paddingBottom'), l: v('paddingLeft') };
    p.remove();
    return out;
  }

  // ═══ Раскладка ═══
  const live = new Set();
  let cur = null;
  function attach(o){
    if (!o || !o.el || !ID_RE.test(String(o.id || ''))) return null;
    css();
    const T = { o, key: '', pos: new Map(), dead: false, W: 0, H: 0 };
    T.layout = force => layout(T, force);
    T.detach = () => { if (T.dead) return; T.dead = true; live.delete(T); if (ed && ed.T === T) closeEd(false); if (cur === T) cur = [...live].pop() || null; };
    T.custom = () => !!saved(o.id, orient(T.W || 1, T.H || 0));
    live.add(T); cur = T;
    T.layout(true);
    return T;
  }
  function size(el){ return { W: el.clientWidth || 0, H: el.clientHeight || 0 }; }
  // позиции для правой руки: своя раскладка игрока или по умолчанию; в окне целиком
  function compute(T, W, H, k){
    const o = T.o, sv = saved(o.id, orient(W, H)), def = (o.defaults && o.defaults(W, H, k, { lefty: lefty() })) || {}, out = new Map();
    for (const it of (o.items ? o.items() : [])) {
      // o.alias { новый id: старый } (T-123): раскладка, сохранённая под старым id (crouch → pose), переезжает на новую кнопку
      const s = sv && (sv[it.same || it.id] || (o.alias && o.alias[it.id] && sv[o.alias[it.id]])), d0 = def[it.id];
      let p = null;
      if (s) p = { x: s.ax ? W - s.x : s.x, y: s.ay ? H - s.y : s.y, d: s.d * k, custom: true };
      else if (d0 && Number.isFinite(d0.x) && Number.isFinite(d0.y)) p = { x: d0.x, y: d0.y, d: d0.d, custom: false };
      if (!p) continue;
      const r = p.d / 2 + 2;
      p.x = clamp(p.x, r, Math.max(r, W - r)); p.y = clamp(p.y, r, Math.max(r, H - r));
      out.set(it.id, p);
    }
    return out;
  }
  function layout(T, force){
    if (T.dead) return;
    const el = T.o.el; if (!el || el.isConnected === false) return;
    const { W, H } = size(el); if (!W || !H) return;
    const k = tsize(), L = lefty(), key = W + 'x' + H + '|' + k + '|' + (L ? 1 : 0) + '|' + rev;
    if (!force && key === T.key) return;
    T.key = key; T.W = W; T.H = H;
    T.pos = compute(T, W, H, k);
    let any = false; for (const p of T.pos.values()) if (p.custom) { any = true; break; }
    for (const [id, p] of T.pos) {
      const b = T.o.btn ? T.o.btn(id) : null; if (!b) continue;
      if (T.o.apply) T.o.apply(id, b, { x: p.x, y: p.y, d: p.d, lefty: L, W, H, k, custom: p.custom, any });
      else place(b, L ? W - p.x : p.x, p.y, p.d);
    }
  }
  function place(b, x, y, d){
    const s = b.style;
    s.left = r1(x - d / 2) + 'px'; s.top = r1(y - d / 2) + 'px'; s.width = s.height = r1(d) + 'px';
    s.setProperty('--tl-d', r1(d) + 'px');
  }
  // «⚙️ Размер кнопок», «Для левши» поменяли — расставить заново
  // через кадр: игра могла сдвинуть свои панели (левша), а при «уменьшить движение» сайт даёт всему переход 0,01 мс — мерить после него
  const raf = root.requestAnimationFrame || (f => setTimeout(f, 16));
  root.addEventListener?.('d37:settings', e => { const k = e.detail?.key; if (k === 'touchSize' || k === 'lefty' || k === '*') { for (const T of live) T.layout(true); raf(() => { for (const T of live) T.layout(true); }); } });
  const liveT = () => { const T = cur; if (!T || T.dead || !T.o.el?.isConnected) return null; return T.o.el.getClientRects?.().length ? T : null; };

  // ═══ Редактор: перетащить, размер, «Как было» ═══
  let ed = null;
  function edit(T){
    T = T || liveT();
    if (!T || !doc) return false;
    if (ed) closeEd(false);
    try { if (root.D37Settings?.isOpen?.()) root.D37Settings.close(); } catch (e) {}
    T.layout(true);
    const el = T.o.el, { W, H } = size(el), k = tsize(), L = lefty();
    const ov = doc.createElement('div');
    ov.className = 'tl-ed'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Настроить кнопки');
    const def = compute({ o: Object.assign({}, T.o, { id: '__none' }) }, W, H, k);   // раскладка по умолчанию (без своей)
    const items = (T.o.items ? T.o.items() : []).filter(it => !it.same && T.pos.has(it.id));
    ed = { T, ov, W, H, k, L, def, P: new Map(), sel: null, drag: null, dirty: false, offs: [] };
    let html = `<div class="tl-ed-bar"><b>🎮 ${esc(T.o.title || 'Кнопки')}</b>
      <button type="button" data-tl="smaller" aria-label="Меньше" title="Меньше">−</button><span class="tl-ed-sz">—</span><button type="button" data-tl="bigger" aria-label="Больше" title="Больше">＋</button>
      <button type="button" data-tl="reset" title="Все кнопки — как было">↺ Как было</button><button type="button" data-tl="cancel" aria-label="Отмена" title="Отмена">✕</button><button type="button" class="pri" data-tl="done">✓ Готово</button>
      <span class="tl-ed-st">Перетащи кнопку пальцем. Нажми на кнопку — «−» / «＋» меняют размер. ${orient(W, H) === 'l' ? 'Это раскладка лёжа' : 'Это раскладка стоя'} — на этом устройстве.</span></div>`;
    for (const a of (T.o.avoid ? T.o.avoid() : []) || []) if (a && a.r > a.l && a.b > a.t) html += `<div class="tl-av" style="left:${r1(a.l)}px;top:${r1(a.t)}px;width:${r1(a.r - a.l)}px;height:${r1(a.b - a.t)}px">${esc(a.label || '')}</div>`;
    ov.innerHTML = html;
    for (const it of items) {
      const p = T.pos.get(it.id), q = doc.createElement('div');
      q.className = 'tl-p' + (it.opt ? ' opt' : ''); q.dataset.id = it.id;
      if (it.opt) q.title = 'Видна ' + it.opt;
      q.innerHTML = `<span>${esc(it.icon || '•')}</span><small>${esc(it.label || it.id)}</small>`;
      ov.appendChild(q);
      const P = { id: it.id, x: L ? W - p.x : p.x, y: p.y, d: p.d, d0: def.get(it.id)?.d || p.d, el: q };
      ed.P.set(it.id, P); drawP(P);
    }
    const on = (t, ev, f, o) => { t.addEventListener(ev, f, o); ed.offs.push(() => t.removeEventListener(ev, f, o)); };
    // пальцы и мышь — только редактору (игра под ним не видит)
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'contextmenu', 'wheel', 'touchstart', 'touchmove']) ov.addEventListener(ev, e => { e.stopPropagation(); if (ev === 'contextmenu' || ev === 'touchmove') e.preventDefault(); }, ev === 'wheel' || ev.startsWith('touch') ? { passive: false } : undefined);
    ov.addEventListener('pointerdown', onDown);
    ov.addEventListener('pointermove', onMove);
    ov.addEventListener('pointerup', onUp); ov.addEventListener('pointercancel', onUp);
    // кнопки панели — по «отпустил на той же кнопке» (без задержки «клика» у пальца: «＋» можно жать часто); клавиатура — click
    ov.addEventListener('click', e => { if (e.detail === 0) onBar(e); });
    on(root, 'keydown', e => { if (!ed) return; if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation?.(); closeEd(false); } else if (e.key === 'Enter') { e.preventDefault(); closeEd(true); } }, true);
    ov.close = () => closeEd(false);
    el.appendChild(ov);
    try { T.o.onEdit?.(true, ov); } catch (e) { console.error(e); }
    select(items.find(it => it.id === 'jump')?.id || items[0]?.id || null);
    check();
    return true;
  }
  function drawP(P){ const s = P.el.style, d = P.d; s.left = r1(P.x - d / 2) + 'px'; s.top = r1(P.y - d / 2) + 'px'; s.width = s.height = r1(d) + 'px'; s.fontSize = r1(Math.max(14, d * .42)) + 'px'; }
  function select(id){
    if (!ed) return;
    ed.sel = id;
    for (const P of ed.P.values()) P.el.classList.toggle('sel', P.id === id);
    const P = id && ed.P.get(id), sz = ed.ov.querySelector('.tl-ed-sz');
    if (sz) sz.textContent = P ? Math.round(100 * P.d / P.d0) + '%' : '—';
    for (const b of ed.ov.querySelectorAll('[data-tl="smaller"],[data-tl="bigger"]')) b.disabled = !P;
  }
  const local = e => { const r = ed.T.o.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function onDown(e){
    if (!ed) return;
    const bb = e.target.closest?.('[data-tl]');
    if (bb) { ed.press = { pid: e.pointerId, b: bb }; return; }
    const q = e.target.closest?.('.tl-p');
    if (!q) { if (!e.target.closest?.('.tl-ed-bar')) select(null); return; }
    e.preventDefault();
    const P = ed.P.get(q.dataset.id); if (!P) return;
    select(P.id);
    const m = local(e);
    ed.drag = { pid: e.pointerId, P, dx: m.x - P.x, dy: m.y - P.y };
    try { q.setPointerCapture(e.pointerId); } catch (er) {}
  }
  function onMove(e){
    const g = ed?.drag; if (!g || g.pid !== e.pointerId) return;
    const m = local(e), P = g.P, r = P.d / 2 + 2;
    P.x = clamp(m.x - g.dx, r, ed.W - r); P.y = clamp(m.y - g.dy, r, ed.H - r);
    ed.dirty = true; drawP(P); check();
  }
  function onUp(e){
    if (!ed) return;
    if (ed.drag && ed.drag.pid === e.pointerId) { ed.drag = null; check(); }
    const pr = ed.press; if (!pr || pr.pid !== e.pointerId) return;
    ed.press = null;
    const hit = e.type === 'pointerup' ? (doc.elementFromPoint?.(e.clientX, e.clientY) || e.target)?.closest?.('[data-tl]') : null;   // отпустил на той же кнопке (палец не увели)
    if (hit === pr.b && !pr.b.disabled) { swallowClick(e.clientX, e.clientY); onBar({ target: pr.b }); }
  }
  // «Готово»/«Отмена» закрывают редактор по «отпустил» — следующий за ним «клик» браузера попал бы в то, что под пальцем
  // (⚙️ игры открыл бы настройки): этот один клик рядом с местом нажатия глотаем
  function swallowClick(x, y){
    const t0 = root.performance?.now?.() || 0;
    const f = e => { root.removeEventListener('click', f, true); if ((root.performance?.now?.() || 0) - t0 < 800 && Math.hypot(e.clientX - x, e.clientY - y) < 40) { e.preventDefault(); e.stopImmediatePropagation(); } };
    root.addEventListener('click', f, true);
    setTimeout(() => root.removeEventListener('click', f, true), 800);
  }
  function onBar(e){
    const b = e.target.closest?.('[data-tl]'); if (!b || !ed || b.disabled) return;
    const a = b.dataset.tl, P = ed.sel && ed.P.get(ed.sel);
    if (a === 'smaller' || a === 'bigger') {
      if (!P) return;
      const lo = Math.max(30, P.d0 * MIN_K), hi = Math.min(P.d0 * MAX_K, Math.min(ed.W, ed.H) / 2.5);
      P.d = clamp(P.d * (a === 'bigger' ? 1.1 : 1 / 1.1), lo, Math.max(lo, hi));
      const r = P.d / 2 + 2; P.x = clamp(P.x, r, ed.W - r); P.y = clamp(P.y, r, ed.H - r);
      ed.dirty = true; drawP(P); select(P.id); check();
    } else if (a === 'reset') {
      for (const Q of ed.P.values()) { const d = ed.def.get(Q.id); if (!d) continue; Q.x = ed.L ? ed.W - d.x : d.x; Q.y = d.y; Q.d = d.d; drawP(Q); }
      ed.dirty = true; ed.reset = true; select(ed.sel); check();
    } else if (a === 'cancel') closeEd(false);
    else if (a === 'done') closeEd(true);
  }
  // кнопки наезжают друг на друга или на панель вещей — подсветить и сказать (сохранить всё равно можно)
  function check(){
    if (!ed) return;
    const list = [...ed.P.values()], bad = new Set();
    let over = false, onAv = false;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const a = list[i], b = list[j]; if (Math.hypot(a.x - b.x, a.y - b.y) < (a.d + b.d) / 2 + 3) { bad.add(a.id); bad.add(b.id); over = true; } }
    for (const a of ed.ov.querySelectorAll('.tl-av')) {
      const l = parseFloat(a.style.left), t = parseFloat(a.style.top), r = l + parseFloat(a.style.width), bt = t + parseFloat(a.style.height);
      for (const P of list) { const h = P.d / 2 - 2; if (P.x + h > l && P.x - h < r && P.y + h > t && P.y - h < bt) { bad.add(P.id); onAv = true; } }
    }
    for (const P of list) P.el.classList.toggle('bad', bad.has(P.id));
    const st = ed.ov.querySelector('.tl-ed-st');
    if (st && (over || onAv)) { st.textContent = over ? '⚠️ Кнопки наезжают друг на друга — так легко промахнуться' : '⚠️ Кнопка закрывает панель или значки игры'; st.classList.add('bad'); }
    else if (st && st.classList.contains('bad')) { st.textContent = 'Хорошо: кнопки не мешают друг другу.'; st.classList.remove('bad'); }
  }
  function closeEd(save){
    const E = ed; if (!E) return;
    ed = null;
    E.offs.forEach(f => f());
    if (save && (E.dirty || E.reset)) {
      const m = {}, k = E.k;
      for (const P of E.P.values()) {
        const rx = E.L ? E.W - P.x : P.x, d = E.def.get(P.id);
        if (d && Math.abs(rx - d.x) < 3 && Math.abs(P.y - d.y) < 3 && Math.abs(P.d - d.d) < 2) continue;   // как по умолчанию — не храним
        const ax = rx > E.W / 2 ? 1 : 0, ay = P.y > E.H / 2 ? 1 : 0;
        m[P.id] = { x: r1(ax ? E.W - rx : rx), y: r1(ay ? E.H - P.y : P.y), ax, ay, d: r1(P.d / k) };
      }
      put(E.T.o.id, orient(E.W, E.H), m);
    }
    E.ov.remove();
    try { E.T.o.onEdit?.(false, E.ov); } catch (e) { console.error(e); }
    E.T.layout(true);
  }

  // ═══ ⚙️ → «Управление»: строка «Настроить кнопки» (кнопку ловит сам) ═══
  function settingsRow(){
    const T = liveT();
    return `<div class="gs-row" data-words="кнопки расположение переставить перетащить раскладка телефон сенсор настроить"><div class="gs-lbl"><b>Расположение кнопок</b><small>${T ? `«${esc(T.o.title || '')}»: перетащи кнопки пальцем, поменяй размер, «Как было» — вернуть. Лёжа и стоя — отдельно, на этом устройстве.` : 'Открой «Кубомир» или «Подземье» на телефоне — и настрой кнопки прямо в игре.'}</small></div><div class="gs-ctl"><button type="button" class="gs-btn${T ? ' primary' : ''}" data-tl-edit="1"${T ? '' : ' disabled'}>🎮 Настроить кнопки</button></div></div>`;
  }
  doc?.addEventListener?.('click', e => { const b = e.target?.closest?.('[data-tl-edit]'); if (!b || b.disabled) return; e.preventDefault(); edit(); });

  function css(){
    if (!doc || doc.getElementById('tl-css')) return;
    const s = doc.createElement('style'); s.id = 'tl-css';
    s.textContent = `.tl-ed{position:absolute;inset:0;z-index:60;touch-action:none;user-select:none;-webkit-user-select:none;background:rgba(6,8,18,.5);font-family:Montserrat,system-ui,sans-serif;color:#fff}
.tl-ed-bar{position:absolute;left:50%;top:max(6px,env(safe-area-inset-top));transform:translateX(-50%);z-index:3;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:5px;width:max-content;max-width:calc(100% - 12px);padding:6px 8px;border-radius:14px;background:rgba(14,16,30,.94);border:1px solid rgba(255,255,255,.16);box-shadow:0 8px 24px rgba(0,0,0,.45)}
.tl-ed-bar>b{font-size:13px;margin-right:2px;white-space:nowrap}
.tl-ed-bar button{min-width:38px;height:36px;padding:0 10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;font:800 14px Montserrat,system-ui,sans-serif;cursor:pointer;touch-action:manipulation}
.tl-ed-bar button.pri{background:linear-gradient(180deg,#4f8cff,#3566d8);border-color:#7aa6ff}
.tl-ed-bar button:disabled{opacity:.4}
.tl-ed-sz{min-width:42px;text-align:center;font:800 12px Montserrat,system-ui,sans-serif;color:#ffd23f}
.tl-ed-st{flex-basis:100%;text-align:center;font-size:11px;line-height:1.3;color:#c9d2f0}
.tl-ed-st.bad{color:#ffb4b4}
.tl-ed .tl-p,.tl-ed .tl-ed-bar,.tl-ed .tl-av{transition:none!important}
.tl-p{position:absolute;border-radius:50%;display:grid;place-items:center;background:rgba(40,60,120,.5);border:2px dashed rgba(255,255,255,.75);line-height:1;cursor:grab;touch-action:none;box-sizing:border-box}
.tl-p.sel{border-style:solid;border-color:#ffd23f;box-shadow:0 0 0 3px rgba(255,210,63,.35)}
.tl-p.bad{border-color:#ff6b6b;box-shadow:0 0 0 3px rgba(255,80,80,.4)}
.tl-p.opt{background:rgba(40,60,120,.3);border-color:rgba(255,255,255,.5)}
.tl-p small{position:absolute;top:calc(100% + 2px);left:50%;transform:translateX(-50%);font:800 10px/1.2 Montserrat,system-ui,sans-serif;white-space:nowrap;padding:1px 6px;border-radius:6px;background:rgba(0,0,0,.62);pointer-events:none}
.tl-av{position:absolute;border-radius:8px;background:repeating-linear-gradient(135deg,rgba(255,255,255,.13) 0 6px,rgba(255,255,255,0) 6px 12px);border:1px dashed rgba(255,255,255,.4);pointer-events:none;display:grid;place-items:center;font:700 10px Montserrat,system-ui,sans-serif;color:rgba(255,255,255,.8);overflow:hidden;white-space:nowrap}`;
    doc.head.appendChild(s);
  }

  root.D37TouchLayout = {
    attach, edit, settingsRow, seen, markSeen, hintOnce, resetSeen, safe,
    current: () => liveT(),
    isEditing: () => !!ed,
    saved: (g, o) => saved(g, o),
    clear(g){ const S = load(); if (g) delete S.g[g]; else S.g = {}; lsSet(LS, Object.keys(S.g).length ? S : null); rev++; for (const T of live) T.layout(true); },
    _test: { clean, compute, reload(){ store = null; seenM = null; rev++; }, live: () => live.size },
  };
})();
