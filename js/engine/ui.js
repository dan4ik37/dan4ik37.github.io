// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — экран поверх мира: подсказка «[E] открыть» с кольцом удержания, полоска выносливости, всплывающие
//  сообщения, прицел, кнопки телефона (прыжок, действие, присесть, бег…) и джойстик — стили вставляет сам (#d37e-css)
// ═══════════════════════════════════════
// H = D37E.ui(el, C) → H.prompt(текст, удержание 0…1), H.stamina(0…1, выдохся), H.toast(текст, хорошо?), H.crosshair(вкл),
// H.buttons([{ id, icon, label, action, hold }], { layout, title }) — кнопки справа снизу (тем же путём, что клавиши: C.press),
// H.show(id, вкл), H.dispose(). Кнопка «действие» сама появляется, когда есть подсказка. Кнопки 50 px («большие» 62; T-074 —
// компактнее), игрок может переставить их (⚙️ → «Управление» → «🎮 Настроить кнопки», js/core/touch-layout.js).
//
// HUD 2.0 (T-123, docs/HUD_V2.md §8): E.ui(el, C, { v2: true, game, touch }) — по выбору игры (без v2 всё как было, байт в байт).
// С v2: кнопки 46/56 px с «попаданием» 58/68 (css/hud2.css), подписи — до первого нажатия (не больше двух), бледнеют без касаний;
// H.buttons(list) — item.kind: 'pose' (кнопка позы: нажал — присесть/встать, на бегу — кувырок; удержал — круг позы) | 'act'
// (одна кнопка действия, значок — глагол); item.ctx — по обстановке (H.show). H.act(verb | null) — кнопка действия сама по
// себе, не по тексту подсказки ({ icon, label }); H.pose({ items(), current(), onPick(it) }), H.poseIcon(id) — значок позы;
// H.radialAt(items, at?) — круг выбора (ПК: T — в середине экрана); H.tray(o) / H.sheet(o) — лоток и лист (как D37E.tray /
// D37E.sheet, внутри экрана игры); H.inset() + событие 'e2:inset' на el; H.chip(id, o) → { set(text), show(on), el };
// H.hint(id, text, { ms }) — один раз на устройство; H.debug(fn, { every }) — окно отладки (F3, ⚙️ «Окно отладки», ?debug=1).
// Отдельно (для игр без E.ui): D37E.radial(host, o), D37E.tray(host, o), D37E.sheet(host, o), D37E.verbIcon(text),
// D37E.fade(el, hud) — бледнеть без касаний, D37E.viewOffset(camera) — сдвиг картинки, пока открыт лист (персонаж виден).
// Правила: DOM строится один раз, в кадре пишем только изменившееся, все таймеры и слушатели снимает dispose().
(() => {
  const E = window.D37E = window.D37E || {};
  const CSS = `
.e-hud{position:absolute;inset:0;pointer-events:none;z-index:4;font-family:Montserrat,system-ui,sans-serif;user-select:none;-webkit-user-select:none}
.e-joy{position:absolute;border-radius:50%;background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.35);pointer-events:none;z-index:5}
.e-joy-k{position:absolute;left:50%;top:50%;width:44%;height:44%;margin:-22% 0 0 -22%;border-radius:50%;background:rgba(255,255,255,.55);box-shadow:0 2px 8px rgba(0,0,0,.3)}
.e-prompt{position:absolute;left:50%;bottom:22%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:7px 14px 7px 8px;border-radius:99px;
  background:rgba(12,10,24,.72);color:#fff;font-weight:800;font-size:14px;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.35);transition:opacity .15s}
.e-prompt[hidden]{display:none}
.e-ring{width:26px;height:26px;flex:none}
.e-ring circle{fill:none;stroke-width:4}
.e-ring .bg{stroke:rgba(255,255,255,.2)} .e-ring .fg{stroke:#ffd23f;stroke-linecap:round;transform:rotate(-90deg);transform-origin:50% 50%}
.e-stam{position:absolute;left:50%;bottom:16%;width:min(220px,40vw);height:7px;transform:translateX(-50%);border-radius:9px;background:rgba(0,0,0,.4);overflow:hidden;transition:opacity .4s}
.e-stam i{display:block;height:100%;width:100%;border-radius:9px;background:linear-gradient(90deg,#4ade80,#a3e635);transform-origin:left;transition:background .3s}
.e-stam.tired i{background:linear-gradient(90deg,#f87171,#fb923c)}
.e-toast{position:absolute;left:50%;top:12%;transform:translateX(-50%);padding:8px 16px;border-radius:12px;background:rgba(12,10,24,.82);color:#fff;font-weight:800;
  font-size:14px;max-width:86%;text-align:center;opacity:0;transition:opacity .25s}
.e-toast.on{opacity:1} .e-toast.ok{background:rgba(22,101,52,.88)} .e-toast.bad{background:rgba(153,27,27,.88)}
.e-cross{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px rgba(0,0,0,.35)}
.e-btns{position:absolute;right:max(12px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(3,auto);gap:10px;
  align-items:end;justify-items:center;pointer-events:none}
.e-btn{pointer-events:auto;touch-action:none;width:50px;height:50px;border-radius:50%;border:2px solid rgba(255,255,255,.45);background:rgba(18,14,36,.5);color:#fff;
  font-size:20px;display:grid;place-items:center;line-height:1;position:relative;-webkit-tap-highlight-color:transparent;box-sizing:border-box;padding:0}
.e-btn b{position:absolute;bottom:-13px;left:50%;transform:translateX(-50%);font-size:9px;font-weight:800;white-space:nowrap;text-shadow:0 1px 3px #000}
.e-btn.big{width:62px;height:62px;font-size:25px}
.e-btn.on,.e-btn:active{background:rgba(124,58,237,.75);border-color:#fff}
.e-btn[hidden]{display:none}
/* без переходов: при «уменьшить движение» сайт даёт всему переход 0,01 мс — раскладка (js/core/touch-layout.js) мерила бы старое место */
.e-hud .e-btns,.e-hud .e-btn{transition:none!important}
.e-hud .e-btns.tl-free{left:0!important;right:0!important;top:0!important;bottom:0!important;display:block;transform:none!important;padding:0!important;direction:ltr!important}
.e-btns.tl-free .e-btn{position:absolute;margin:0}
`;
  function css(){
    if (document.getElementById('d37e-css')) return;
    const s = document.createElement('style'); s.id = 'd37e-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  E.ui = function (el, C, uo){
    css();
    const v2 = !!(uo && uo.v2);
    const hud = document.createElement('div'); hud.className = 'e-hud'; el.appendChild(hud);
    const h = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; hud.appendChild(d); return d; };
    const R = 10, L = 2 * Math.PI * R;
    const pr = h('e-prompt', `<svg class="e-ring" viewBox="0 0 26 26" hidden><circle class="bg" cx="13" cy="13" r="${R}"/><circle class="fg" cx="13" cy="13" r="${R}" stroke-dasharray="${L}" stroke-dashoffset="${L}"/></svg><span></span>`);
    pr.hidden = true;
    const ring = pr.querySelector('svg'), fg = pr.querySelector('.fg'), txt = pr.querySelector('span');
    const st = h('e-stam', '<i></i>'), bar = st.firstChild; st.style.opacity = 0;
    let stQ = -1, stT = false, stO = 0;
    const toast = h('e-toast'); let toastT = 0;
    const cross = h('e-cross'); cross.hidden = true;
    const btns = h('e-btns'); const byId = new Map();
    let lastText = null, lastK = -1, fullAt = 0, actBtn = null, K2 = null;
    const H = {
      el: hud,
      prompt(text, k = 0){
        if (text !== lastText) { lastText = text; pr.hidden = !text; if (text) txt.textContent = text; if (actBtn && !v2) actBtn.hidden = !text; }
        const kq = k > 0 ? Math.round(k * 50) / 50 : 0;   // удержание — шагами 2 %: атрибут пишется, только когда сменился шаг
        if (kq === lastK) return;
        lastK = kq;
        ring.hidden = !(kq > 0);
        if (kq > 0) fg.setAttribute('stroke-dashoffset', String(L * (1 - kq)));
        if (v2 && K2) K2.hold(kq);
      },
      // пишет в страницу, только когда сменилось (T-123: раньше — стиль каждый кадр, пересчёт стилей 60–120 раз в секунду)
      stamina(v, tired){
        const q = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
        if (q !== stQ) { stQ = q; bar.style.transform = `scaleX(${q})`; }
        tired = !!tired;
        if (tired !== stT) { stT = tired; st.classList.toggle('tired', tired); }
        const now = performance.now();
        let op = stO;
        if (v < .999 || tired) { fullAt = 0; op = 1; }
        else { if (!fullAt) fullAt = now; if (now - fullAt > 900) op = 0; }
        if (op !== stO) { stO = op; st.style.opacity = op; }
      },
      toast(text, ok){
        toast.textContent = text; toast.className = 'e-toast on' + (ok === true ? ' ok' : ok === false ? ' bad' : '');
        clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('on'), 2200);
      },
      crosshair(on){ on = !!on; if (cross.hidden === on) cross.hidden = !on; },
      // кнопки для пальца: нажал — как клавиша действия (C.press), отпустил — отпущена. «Отпустил» ловит и окно (палец увели
      // с кнопки и отпустили где угодно), перерисовка кнопок (вошёл в боевую зону) отпускает нажатые — иначе кнопка «залипала»
      buttons(list, o = {}){
        releaseBtns();
        if (K2) K2.reset();
        btns.innerHTML = ''; byId.clear(); actBtn = null;
        for (const b of list) {
          const d = document.createElement('button');
          d.type = 'button'; d.className = 'e-btn' + (b.big ? ' big' : ''); d.innerHTML = `${b.icon}<b>${b.label || ''}</b>`;
          if (v2 && K2 && K2.button(b, d)) { btns.appendChild(d); byId.set(b.id || b.action, d); continue; }   // поза, действие — свои нажатия (ниже)
          if (b.toggle) d.onclick = () => { d.classList.toggle('on', b.toggle()); };
          else {
            const rec = { pid: null, set: null };
            const set = rec.set = v => { if (!v) rec.pid = null; C?.press(b.action, v); d.classList.toggle('on', v); if (v) pressed.add(rec); else pressed.delete(rec); };
            d.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); try { d.setPointerCapture(e.pointerId); } catch (er) {} rec.pid = e.pointerId; set(true); });
            for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) d.addEventListener(ev, () => set(false));
          }
          if (b.action === 'interact') { actBtn = d; d.hidden = !lastText; }
          if (v2 && K2) K2.plain(b, d);
          btns.appendChild(d); byId.set(b.id || b.action, d);
        }
        if (v2 && K2) K2.labels(list);
        tlAttach(list, o);
      },
      show(id, on){ const d = byId.get(id); if (d && d.hidden === !!on) d.hidden = !on; },
      button: id => byId.get(id),
      dispose(){ clearTimeout(toastT); releaseBtns(); if (K2) K2.dispose(); tl?.detach(); tl = null; ro?.disconnect(); for (const f of offs) f(); offs.length = 0; hud.remove(); },
    };
    // ── своя раскладка кнопок (T-074): ⚙️ → «Управление» → «🎮 Настроить кнопки» (js/core/touch-layout.js). Пока игрок её не
    // трогал — сетка, как была (CSS); переставил — кнопки стоят свободно (.tl-free: px по окну игры, с поправкой на zoom «Размера
    // интерфейса» у .e-hud). Набор кнопок = своя раскладка («Мир» и «Студия 3D» с одинаковыми кнопками — общая, в боевой зоне — своя);
    // o.layout — своё имя, false — без настройки. Стили пишутся только при смене окна/настроек (ResizeObserver → layout())
    let tl = null, ro = null;
    const tlFree = on => { if (btns.classList.contains('tl-free') !== on) btns.classList.toggle('tl-free', on); };
    function tlAttach(list, o){
      tl?.detach(); tl = null; tlFree(false);
      const TL = window.D37TouchLayout;
      if (!TL || !list.length || o.layout === false) return;
      // v2: кнопка позы встала на место «присесть» — раскладка та же (имя по старым id, alias { pose: 'crouch' }), свои места игрока не теряются
      const alias = o.alias || (v2 ? { pose: 'crouch' } : null);
      const ids = list.map(b => b.id || b.action);
      let h = 0; for (const c of (alias ? ids.map(i => alias[i] || i) : ids).join(',')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      const items = list.map(b => ({ id: b.id || b.action, icon: b.icon, label: b.label || '', opt: b.action === 'interact' ? 'когда рядом есть что сделать' : undefined }));
      tl = TL.attach({ id: o.layout || 'e3d-' + h.toString(36), title: o.title || 'Кнопки 3D-мира', el, items: () => items, btn: k => byId.get(k) || null,
        defaults: (W, H, k, cx) => gridPos(cx), apply: (k, b, p) => tlPlace(b, p), alias: alias || undefined, avoid: o.avoid || (K2 ? K2.avoid : undefined) });
      if (!ro && window.ResizeObserver) { ro = new ResizeObserver(() => tl?.layout()); ro.observe(el); }
    }
    // по умолчанию — где кнопки стоят в сетке (меряем со всеми кнопками, и спрятанной «действие»): для правой руки
    function gridPos(cx){
      const free = btns.classList.contains('tl-free'), keep = [], out = {};
      tlFree(false);
      for (const b of byId.values()) { const s = b.style; keep.push([b, s.left, s.top, s.width, s.height, s.fontSize, b.hidden]); s.left = s.top = s.width = s.height = s.fontSize = ''; b.hidden = false; }
      const B = el.getBoundingClientRect();
      for (const [k, b] of byId) { const r = b.getBoundingClientRect(); if (!r.width) continue; const x = r.left + r.width / 2 - B.left; out[k] = { x: cx?.lefty ? B.width - x : x, y: r.top + r.height / 2 - B.top, d: r.width }; }
      for (const [b, l, t, w, hh, f, hid] of keep) { const s = b.style; s.left = l; s.top = t; s.width = w; s.height = hh; s.fontSize = f; b.hidden = hid; }
      tlFree(free);
      return out;
    }
    function tlPlace(b, p){
      const s = b.style;
      if (!p.any) { tlFree(false); if (s.left) s.left = s.top = s.width = s.height = s.fontSize = ''; return; }
      tlFree(true);
      const z = parseFloat(getComputedStyle(hud).zoom) || 1, x = p.lefty ? p.W - p.x : p.x;
      s.left = (x - p.d / 2) / z + 'px'; s.top = (p.y - p.d / 2) / z + 'px'; s.width = s.height = p.d / z + 'px'; s.fontSize = p.d * .4 / z + 'px';
    }
    // нажатые кнопки: отпустить, если палец отпустили не над ними, окно потеряло фокус, вкладку спрятали
    const pressed = new Set(), offs = [];
    function releaseBtns(){ for (const r of [...pressed]) r.set(false); }
    const onWin = (t, ev, f, o) => { t.addEventListener(ev, f, o); offs.push(() => t.removeEventListener(ev, f, o)); };
    const upAny = e => { for (const r of [...pressed]) if (r.pid === e.pointerId) r.set(false); };
    onWin(window, 'pointerup', upAny, true); onWin(window, 'pointercancel', upAny, true);
    onWin(window, 'blur', releaseBtns); onWin(document, 'visibilitychange', () => { if (document.hidden) releaseBtns(); });
    if (v2) K2 = kit2({ H, hud, el, C, uo, onWin, get: id => byId.get(id) });
    return H;
  };

  // ═══ HUD 2.0: кнопки позы и действия, круг, лоток, листы, плашки, подсказки, отладка (T-123, docs/HUD_V2.md) ═══
  const TL = () => window.D37TouchLayout;
  const touchDev = () => { try { return E.isTouch ? E.isTouch() : matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } };
  const vib = () => { try { if (window.D37Opt?.shake !== false && navigator.vibrate) navigator.vibrate(8); } catch (e) {} };
  const opt = (k, d) => { try { const v = window.D37Settings?.get?.(k); return v === undefined ? d : v; } catch (e) { return d; } };
  // значок глагола по подписи действия (одна таблица на все игры): «[E] Открыть дверь» → 🚪
  const VERBS = [[/^(за руль|водить|поехать|сесть за руль)/i, '🚗'], [/^(открыть|закрыть|войти|выйти|зайти)/i, '🚪'], [/^(сесть|сядь|присесть на)/i, '🪑'],
    [/^(лечь|спать|поспать)/i, '🛌'], [/^(поговорить|говорить|спросить|позвать)/i, '💬'], [/^(взять|подобрать|поднять|собрать)/i, '✋'], [/^встать/i, '⬆'],
    [/^(купить|магазин|продать)/i, '🛒'], [/^(читать|прочитать|посмотреть)/i, '📖']];
  E.verbIcon = text => {
    const t = String(text || '').replace(/^\s*\[[^\]]*\]\s*/, '').replace(/^[^\p{L}\p{N}]+/u, '');
    for (const [re, ic] of VERBS) if (re.test(t)) return ic;
    return '✋';
  };

  // ── Круг выбора: открыть у пальца (или в середине), вести к пункту и отпустить; отпустил, не сдвинув, — круг ждёт 3 с нажатия.
  //    ПК с захваченной мышью: выбор — по движению мыши (movementX/Y), щелчок — выбрать, Esc — закрыть (мышь не отпускаем) ──
  E.radial = function (host, o = {}){
    const el = document.createElement('div'); el.className = 'e2-radial'; el.hidden = true;
    el.innerHTML = '<div class="e2-rad-bg"></div><div class="e2-rad-lbl"></div><div class="e2-rad-x" aria-hidden="true">✕</div>';
    host.appendChild(el);
    const lbl = el.children[1], RAD = o.r || 92, DEAD = 28;
    let items = [], btns = [], sel = -1, open = false, sticky = false, stickyT = 0, moved = false, ox = 0, oy = 0, hb = null, lock = false, vx = 0, vy = 0, onPick = null, from = null;
    function setSel(i){
      if (i === sel) return;
      if (btns[sel]) btns[sel].classList.toggle('on', false);
      sel = i;
      if (btns[i]) { btns[i].classList.toggle('on', true); lbl.textContent = items[i].label || ''; vib(); } else lbl.textContent = '';
    }
    function build(list){
      for (const b of btns) b.remove();
      const n = list.length;
      btns = list.map((it, i) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'e2-rad-it' + (it.cur ? ' cur' : ''); b.textContent = it.icon || '•';
        b.setAttribute('aria-label', it.label || ''); b.dataset.i = i;
        const a = -Math.PI / 2 + i * 2 * Math.PI / n;
        b.style.transform = `translate(${Math.round(Math.cos(a) * RAD)}px,${Math.round(Math.sin(a) * RAD)}px)`;
        el.appendChild(b); return b;
      });
    }
    const R = {
      el, isOpen: () => open, isSticky: () => sticky,
      // at — точка в px окна host (по умолчанию середина); list — [{ id, icon, label, cur, on }]
      open(list, at, oo = {}){
        items = list || []; if (!items.length) return;
        build(items); onPick = oo.onPick || null;
        hb = host.getBoundingClientRect();
        const W = hb.width, Hh = hb.height, m = RAD + 30;
        ox = Math.max(m, Math.min(W - m, at ? at.x : W / 2)); oy = Math.max(m + 26, Math.min(Hh - m, at ? at.y : Hh / 2));
        el.style.left = ox + 'px'; el.style.top = oy + 'px';
        sel = -1; lbl.textContent = oo.title || ''; moved = false; sticky = false; clearTimeout(stickyT);
        lock = !!oo.lock; vx = vy = 0;
        from = oo.from || null;   // палец (px экрана), с которого открыли: выбор — по сдвигу от него (круг может стоять в стороне)
        el.hidden = false; open = true;
        if (oo.sticky) toSticky();
      },
      // палец (px экрана): сектор — по углу от середины круга, ближе 28 px — «отмена»
      move(cx, cy){
        if (!open || !hb) return;
        const dx = from ? cx - from.x : cx - hb.left - ox, dy = from ? cy - from.y : cy - hb.top - oy, d = Math.hypot(dx, dy);
        if (d > 14) moved = true;
        if (d < DEAD) { setSel(-1); return; }
        const n = items.length, a = Math.atan2(dy, dx) + Math.PI / 2;
        setSel(((Math.round(a / (2 * Math.PI / n)) % n) + n) % n);
      },
      // отпустили: выбран пункт — выбрать; не двигали — круг ждёт нажатия 3 с; иначе (в середине) — закрыть
      up(){
        if (!open) return;
        if (sel >= 0) { pick(sel); return; }
        if (!moved && o.sticky !== false) { toSticky(); return; }
        R.close(true);
      },
      close(cancel){
        if (!open) return;
        open = false; sticky = false; lock = false; clearTimeout(stickyT); el.hidden = true; setSel(-1);
        if (cancel) o.onCancel?.();
      },
      dispose(){ R.close(); offAll(); el.remove(); },
    };
    function toSticky(){ sticky = true; clearTimeout(stickyT); stickyT = setTimeout(() => R.close(true), 3000); }
    function pick(i){
      const it = items[i], f = onPick; R.close();
      if (!it) return;
      try { (f || o.onPick)?.(it, i); it.on?.(); } catch (e) { console.error(e); }
    }
    // нажатия по пунктам (круг ждёт), мимо круга — закрыть; ПК: мышь при захвате
    const offs = [], on = (t, ev, f, op) => { t.addEventListener(ev, f, op); offs.push(() => t.removeEventListener(ev, f, op)); };
    const offAll = () => { for (const f of offs) f(); offs.length = 0; };
    on(el, 'pointerdown', e => { const b = e.target.closest?.('.e2-rad-it'); if (!b || !open) return; e.preventDefault(); e.stopPropagation(); pick(+b.dataset.i); });
    on(document, 'pointerdown', e => { if (open && sticky && !el.contains(e.target) && !lock) R.close(true); }, true);
    on(document, 'mousemove', e => { if (!open || !lock || !document.pointerLockElement) return; vx += e.movementX || 0; vy += e.movementY || 0; const d = Math.hypot(vx, vy); if (d > 120) { vx *= 120 / d; vy *= 120 / d; } R.move(hb.left + ox + vx, hb.top + oy + vy); moved = true; });
    on(document, 'mousedown', e => { if (!open || !lock || !document.pointerLockElement) return; e.stopPropagation(); if (sel >= 0) pick(sel); else R.close(true); }, true);
    on(window, 'keydown', e => { if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); R.close(true); } }, true);
    return R;
  };

  // ── Бледнеть без касаний: 4 с без касания окна игры — hud.e2-idle (только смена класса; один таймер, один слушатель) ──
  E.fade = function (win, root, ms = 4000){
    let t = 0, idle = false, dead = false;
    const set = v => { if (v !== idle) { idle = v; root.classList.toggle('e2-idle', v); } };
    const poke = () => { if (dead) return; set(false); clearTimeout(t); t = setTimeout(() => set(true), ms); };
    win.addEventListener('pointerdown', poke, { passive: true, capture: true });
    poke();
    return { poke, dispose(){ dead = true; clearTimeout(t); win.removeEventListener('pointerdown', poke, { capture: true }); set(false); } };
  };

  // ── Лоток вещей: свёрнут — вещь в руке и соседи; нажал — весь ряд (сам свернётся через 3 с); смахнул — соседняя; удержал —
  //    круг вещей; смахнул вверх — «🎒» (o.more). ⚙️ «Вещи внизу экрана»: авто (телефон — свёрнут, ПК — весь), все, свёрнуты.
  //    o: { slots() → [{ icon, n, empty }], sel, onSel(i), anchor: 'bottom' | 'top', peek: 1, more: { icon, on }, ms: 3000, wheel: true } ──
  E.tray = function (host, o = {}){
    const el = document.createElement('div'); el.className = 'e2-tray' + (o.anchor === 'top' ? ' top' : '');
    el.setAttribute('role', 'toolbar'); el.setAttribute('aria-label', o.title || 'Вещи');
    host.appendChild(el);
    const peek = o.peek ?? 1, MS = o.ms || 3000;
    let cells = [], sel = o.sel | 0, isOpen = false, closeT = 0, pid = null, x0 = 0, y0 = 0, holdT = 0, swiped = false, dead = false, wheel = null, wheelOn = false, nSlots = 0;
    const mode = () => { const m = opt('hudTray', 'auto'); return m === 'auto' ? (touchDev() ? 'closed' : 'open') : m; };
    let always = mode() === 'open';
    function cell(i){
      let c = cells[i];
      if (!c) { c = cells[i] = document.createElement('button'); c.type = 'button'; c.className = 'e2-tray-c'; c.dataset.i = i; c.innerHTML = '<s></s><i></i>'; c._k = ''; el.appendChild(c); }
      return c;
    }
    function render(){
      const list = (o.slots ? o.slots() : []) || [];
      nSlots = list.length;
      const total = nSlots + (o.more ? 1 : 0), show = always || isOpen;
      for (let i = 0; i < total; i++) {
        const c = cell(i), it = i < nSlots ? list[i] : { icon: o.more.icon || '🎒', more: 1 };
        const k = (it.icon || '') + '|' + (it.n > 1 ? it.n : '') + '|' + (it.empty ? 1 : 0);
        if (k !== c._k) { c._k = k; c.firstChild.textContent = it.icon || ''; c.lastChild.textContent = it.n > 1 ? String(it.n) : ''; c.classList.toggle('empty', !!it.empty && !it.icon); c.setAttribute('aria-label', it.label || it.icon || ''); }
        const vis = show || (i < nSlots && Math.abs(i - sel) <= peek);
        if (c.hidden === vis) c.hidden = !vis;
        const s = i === sel;
        if (c.classList.contains('sel') !== s) c.classList.toggle('sel', s);
      }
      for (let i = total; i < cells.length; i++) if (!cells[i].hidden) cells[i].hidden = true;
      if (el.classList.contains('open') !== show) el.classList.toggle('open', show);
    }
    function arm(){ clearTimeout(closeT); if (!always && isOpen) closeT = setTimeout(() => T.close(), MS); }
    const T = {
      el,
      set(i){ if (i < 0 || i >= nSlots) return; sel = i; render(); o.onSel?.(i); },
      update(i){ if (i != null) sel = i; always = mode() === 'open'; render(); },
      open(){ isOpen = true; render(); arm(); host.dispatchEvent(new CustomEvent('e2:tray', { detail: { open: true } })); },
      close(){ clearTimeout(closeT); if (!isOpen) return; isOpen = false; render(); host.dispatchEvent(new CustomEvent('e2:tray', { detail: { open: false } })); },
      isOpen: () => isOpen || always,
      // прямоугольник лотка в px окна host (свёрнут и раскрыт — для D37TouchLayout avoid; меряется только по запросу)
      rect(){ const b = el.getBoundingClientRect(), h = host.getBoundingClientRect(); return { l: b.left - h.left, t: b.top - h.top, r: b.right - h.left, b: b.bottom - h.top, label: 'Вещи' }; },
      dispose(){ dead = true; clearTimeout(closeT); clearTimeout(holdT); wheel?.dispose(); el.remove(); },
    };
    el.addEventListener('pointerdown', e => {
      if (dead) return;
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (er) {}
      pid = e.pointerId; x0 = e.clientX; y0 = e.clientY; swiped = false; wheelOn = false;
      clearTimeout(closeT); clearTimeout(holdT);
      if (o.wheel !== false && nSlots > 1) holdT = setTimeout(() => {   // удержал — круг вещей вокруг пальца
        if (pid == null || swiped) return;
        const wh = o.wheelHost || host;
        wheel = wheel || E.radial(wh, { sticky: false });
        const h = wh.getBoundingClientRect(), list = (o.slots ? o.slots() : []).map((it, i) => ({ id: i, icon: it.icon || '·', label: it.label || '', cur: i === sel }));
        wheel.open(list.slice(0, 10), { x: x0 - h.left, y: y0 - h.top - 60 }, { onPick: it => T.set(it.id), from: { x: x0, y: y0 } });
        wheelOn = true;
      }, 380);
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerId !== pid) return;
      if (wheelOn) { wheel.move(e.clientX, e.clientY); return; }
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (dy < -36 && Math.abs(dx) < 30 && o.more) { clearTimeout(holdT); pid = null; swiped = true; o.more.on?.(); return; }   // вверх — 🎒
      if (Math.abs(dx) > 26) {   // вбок — соседняя вещь (без раскрытия)
        clearTimeout(holdT); swiped = true; x0 = e.clientX;
        if (nSlots) T.set((sel + (dx > 0 ? 1 : -1) + nSlots) % nSlots);
      }
    });
    const up = e => {
      if (e.pointerId !== pid) return;
      pid = null; clearTimeout(holdT);
      if (wheelOn) { wheelOn = false; wheel.up(); arm(); return; }
      if (swiped) { arm(); return; }
      const c = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.e2-tray-c');
      const i = c && el.contains(c) ? +c.dataset.i : -1;
      if (i >= nSlots && o.more) { o.more.on?.(); T.close(); return; }
      if (!always && !isOpen) { T.open(); return; }
      if (i >= 0 && i < nSlots) T.set(i);
      arm();
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', e => { if (e.pointerId === pid) { pid = null; clearTimeout(holdT); if (wheelOn) { wheelOn = false; wheel.close(true); } } });
    render();
    return T;
  };

  // ── Лист (инвентарь, «➕ Ещё», телефон…): лёжа — справа (≤ 50 %), стоя — снизу (≤ 55 %); вкладки; ✕, смахнуть, Esc — закрыть.
  //    o: { title, tabs: [{ id, icon, label, render(body) }], body: el, onClose, max: .55 }. S.open(tab?), S.close(), S.isOpen(), S.body ──
  E.sheet = function (host, o = {}){
    const el = document.createElement('div'); el.className = 'e2-sheet'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', o.title || 'Окно');
    el.innerHTML = '<div class="e2-sheet-h"><b></b><button type="button" class="e2-sheet-x" aria-label="Закрыть">✕</button></div><div class="e2-sheet-tabs" role="tablist"></div><div class="e2-sheet-b"></div>';
    host.appendChild(el);
    const head = el.firstChild, tabsEl = el.children[1], body = el.children[2];
    head.firstChild.textContent = o.title || '';
    if (o.body) body.appendChild(o.body);
    let open = false, cur = null, sx = 0, sy = 0, spid = null;
    const tabs = o.tabs || [];
    tabsEl.hidden = tabs.length < 2;
    for (const t of tabs) { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.t = t.id; b.textContent = (t.icon ? t.icon + ' ' : '') + (t.label || ''); tabsEl.appendChild(b); }
    function tab(id){
      const t = tabs.find(x => x.id === id) || tabs[0]; if (!t) return;
      cur = t.id;
      for (const b of tabsEl.children) b.classList.toggle('on', b.dataset.t === cur);
      body.textContent = ''; try { t.render?.(body); } catch (e) { console.error(e); }
    }
    const S = {
      el, body, isOpen: () => open, tab: () => cur,
      open(t){
        const hb = host.getBoundingClientRect(), side = hb.width > hb.height;
        el.className = 'e2-sheet ' + (side ? 'side' : 'bottom');
        if (!side && o.max) el.style.maxHeight = Math.round(o.max * 100) + '%';
        if (tabs.length) tab(t || cur);
        el.hidden = false; open = true;
        inset();
      },
      close(){ if (!open) return; open = false; el.hidden = true; inset(); try { o.onClose?.(); } catch (e) { console.error(e); } },
      setTab: tab, title(t){ head.firstChild.textContent = t || ''; },
      dispose(){ open = false; offAll(); el.remove(); },
    };
    // сколько окна закрывает лист (px от каждого края) — для сдвига картинки (D37E.viewOffset)
    function inset(){
      let d = { l: 0, t: 0, r: 0, b: 0 };
      if (open) { const b = el.getBoundingClientRect(), h = host.getBoundingClientRect(); if (el.classList.contains('side')) { if (b.left - h.left > h.width / 3) d.r = h.right - b.left; else d.l = b.right - h.left; } else d.b = h.bottom - b.top; }
      S.inset = d;
      host.dispatchEvent(new CustomEvent('e2:inset', { detail: d }));
    }
    S.inset = { l: 0, t: 0, r: 0, b: 0 };
    const offs = [], on = (t, ev, f, op) => { t.addEventListener(ev, f, op); offs.push(() => t.removeEventListener(ev, f, op)); };
    const offAll = () => { for (const f of offs) f(); offs.length = 0; };
    on(head.lastChild, 'click', e => { e.stopPropagation(); S.close(); });
    on(tabsEl, 'click', e => { const b = e.target.closest('[data-t]'); if (b) { e.stopPropagation(); tab(b.dataset.t); } });
    // мир под листом не крутится
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'contextmenu']) on(el, ev, e => e.stopPropagation(), ev === 'wheel' ? { passive: true } : undefined);
    on(head, 'pointerdown', e => { spid = e.pointerId; sx = e.clientX; sy = e.clientY; });
    on(head, 'pointerup', e => { if (e.pointerId !== spid) return; spid = null; const side = el.classList.contains('side'); if (side ? Math.abs(e.clientX - sx) > 60 : e.clientY - sy > 60) S.close(); });
    on(window, 'keydown', e => { if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); S.close(); } }, true);
    return S;
  };

  // ── Сдвиг картинки, пока лист закрывает часть окна: центр кадра — в свободной части (камера не двигается, игра та же).
  //    V = D37E.viewOffset(camera); V.want(inset, W, H) — куда; V.tick(dt) — каждый кадр (пишет, только пока едет, 0,2 с) ──
  E.viewOffset = function (cam){
    let cx = 0, cy = 0, tx = 0, ty = 0, W = 0, H = 0, live = false;
    return {
      want(d, w, h){ W = w; H = h; tx = d ? ((d.r || 0) - (d.l || 0)) / 2 : 0; ty = d ? ((d.b || 0) - (d.t || 0)) / 2 : 0; live = true; },
      tick(dt){
        if (!live || !cam) return;
        const k = Math.min(1, (dt || .016) / .07);
        cx += (tx - cx) * k; cy += (ty - cy) * k;
        if (Math.abs(tx - cx) < .5 && Math.abs(ty - cy) < .5) { cx = tx; cy = ty; live = false; }
        if (!cx && !cy) { cam.clearViewOffset?.(); }
        else if (W && H) cam.setViewOffset(W, H, cx, cy, W, H);
      },
      clear(){ cx = cy = tx = ty = 0; live = false; cam?.clearViewOffset?.(); },
      busy: () => live || !!(cx || cy),
    };
  };

  // ── Набор 2.0 для E.ui: поза (нажал — присесть/встать/кувырок; удержал — круг), действие (значок — глагол, подпись рядом),
  //    подписи до первого нажатия, плашки, подсказки один раз, отладка, бледнеть без касаний ──
  function kit2({ H, hud, el, C, uo, onWin, get }){
    const game = uo.game || 'e3d', touch = uo.touch ?? touchDev();
    hud.classList.add('e2'); if (touch) hud.classList.add('e2-touch');
    const timers = new Set();
    const later = (f, ms) => { const t = setTimeout(() => { timers.delete(t); f(); }, ms); timers.add(t); return t; };
    const tap = a => { C?.press(a, true); later(() => C?.press(a, false), 120); };   // короткое нажатие (как клавиша)
    const fade = touch ? E.fade(el, hud) : null;
    let rad = null;
    const radial = () => rad || (rad = E.radial(el));
    // ── поза ──
    let poseO = null, poseBtn = null, latch = false, poseCur = '';
    const POSE_IC = { stand: '⬇', crouch: '⬇', sit: '🪑', lie: '🛌', crawl: '🐛', fly: '⬇' };
    function poseItems(){
      const cur = poseO?.current ? poseO.current() : '';
      return ((poseO?.items ? poseO.items() : null) || []).map(it => Object.assign({}, it, { cur: it.id === cur }));
    }
    function openPose(at, oo = {}){
      const list = poseItems(); if (!list.length) return false;
      radial().open(list, at, { onPick: pickPose, lock: oo.lock, sticky: oo.sticky, title: oo.title || '', from: oo.from });
      return true;
    }
    function pickPose(it){
      setLatch(false);
      const cur = poseO?.current ? poseO.current() : '';
      if (it.id === cur && (cur === 'sit' || cur === 'lie' || cur === 'crouch' || cur === 'crawl')) { tap('crouch'); return; }   // та же поза — встать
      if (it.id === 'crouch' && !poseO?.crouch) { if (cur === 'sit' || cur === 'lie') tap('crouch'); else setLatch(true); return; }   // присесть — как нажатие кнопки (держится)
      try { poseO?.onPick?.(it); } catch (e) { console.error(e); }
    }
    function setLatch(v){ if (latch === v) return; latch = v; C?.press('crouch', v); poseBtn?.classList.toggle('on', v); }
    function wirePose(d){
      poseBtn = d;
      let pid = null, x0 = 0, y0 = 0, holdT = 0, opened = false;
      d.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation(); try { d.setPointerCapture(e.pointerId); } catch (er) {}
        pid = e.pointerId; x0 = e.clientX; y0 = e.clientY; opened = false;
        clearTimeout(holdT); holdT = later(() => { if (pid != null && !opened) opened = openPose(center(d), { from: { x: x0, y: y0 } }); }, 250);
        seenBtn(d);
      });
      d.addEventListener('pointermove', e => {
        if (e.pointerId !== pid) return;
        if (!opened && Math.hypot(e.clientX - x0, e.clientY - y0) > 18) { clearTimeout(holdT); timers.delete(holdT); opened = openPose(center(d), { from: { x: x0, y: y0 } }); }
        if (opened) radial().move(e.clientX, e.clientY);
      });
      const up = e => {
        if (e.pointerId !== pid) return;
        pid = null; clearTimeout(holdT); timers.delete(holdT);
        if (opened) { opened = false; radial().up(); return; }
        if (e.type !== 'pointerup') return;
        // нажатие: сидит/лежит/ползёт — встать; бежит — кувырок; иначе — присесть и держать (нажал ещё раз — встал)
        const cur = poseO?.current ? poseO.current() : '';
        if (cur === 'sit' || cur === 'lie' || cur === 'crawl') { setLatch(false); tap('crouch'); return; }
        if (!latch && C?.held?.('run')) { tap('crouch'); return; }
        setLatch(!latch);
      };
      d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
    }
    // круг — над кнопкой позы (не закрывает кнопки; выбор считается от пальца, так что место круга на выбор не влияет)
    const center = d => { const b = d.getBoundingClientRect(), h = el.getBoundingClientRect(); return { x: b.left + b.width / 2 - h.left - 40, y: b.top - h.top - 124 }; };
    // ── действие ──
    let actBtn = null, pill = null, holdC = null, verb = null, verbK = '', holdQ = 0, pillT = 0;
    const HR = 15, HL = 2 * Math.PI * HR;
    function wireAct(d){
      actBtn = d;
      pill = document.createElement('span'); pill.className = 'e2-pill'; pill.hidden = true; d.appendChild(pill);
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'e2-hold'); s.setAttribute('viewBox', '0 0 34 34'); s.setAttribute('hidden', '');
      s.innerHTML = `<circle cx="17" cy="17" r="${HR}" stroke-dasharray="${HL}" stroke-dashoffset="${HL}"/>`; d.appendChild(s); holdC = s;
      d.hidden = !verb;
      if (verb) paintVerb();
    }
    function paintVerb(){
      if (!actBtn) return;
      if (actBtn.hidden === !!verb) actBtn.hidden = !verb;
      if (!verb) { if (pill) pill.hidden = true; return; }
      const ic = actBtn.firstChild; if (ic && ic.nodeType === 3) ic.textContent = verb.icon || '✋'; else actBtn.insertBefore(document.createTextNode(verb.icon || '✋'), actBtn.firstChild);
      // подпись цели — 3 с после смены (потом хватает значка: экран чище); новая цель — снова
      if (pill) { pill.textContent = verb.label || ''; pill.hidden = !verb.label || !touch; clearTimeout(pillT); if (!pill.hidden) pillT = later(() => { if (pill && !pill.hidden) pill.hidden = true; }, 3000); }
    }
    H.act = v => {
      const k = v ? (v.icon || '') + '|' + (v.label || '') : '';
      if (k === verbK) return;
      verbK = k; verb = v ? { icon: v.icon || '✋', label: v.label || '' } : null;
      paintVerb();
    };
    H.pose = o => { poseO = o || null; };
    H.poseIcon = id => { if (id === poseCur || !poseBtn) return; poseCur = id; const ic = poseBtn.firstChild; if (ic && ic.nodeType === 3) ic.textContent = POSE_IC[id] || '⬇'; if (id !== 'crouch' && id !== 'stand') setLatch(false); };
    H.radialAt = (items, at, oo = {}) => { radial().open(items, at, Object.assign({ sticky: true }, oo)); return radial(); };
    H.poseRadial = oo => openPose(null, Object.assign({ sticky: true, lock: !!document.pointerLockElement }, oo));
    H.radialOpen = () => !!rad?.isOpen();
    // ── подписи кнопок — до первого нажатия, не больше двух сразу ──
    function seenBtn(d){ if (d.classList.contains('new')) { d.classList.toggle('new', false); TL()?.markSeen?.(game, 'b-' + d.dataset.k); } }
    // ── листы и сдвиг ──
    const sheets = new Set();
    H.sheet = o => { const s = E.sheet(el, o); sheets.add(s); return s; };
    H.tray = o => { const t = E.tray(hud, Object.assign({ wheelHost: el }, o)); trays.add(t); return t; };
    const trays = new Set();
    H.inset = () => { const d = { l: 0, t: 0, r: 0, b: 0 }; for (const s of sheets) if (s.isOpen()) { const q = s.inset; d.l = Math.max(d.l, q.l); d.t = Math.max(d.t, q.t); d.r = Math.max(d.r, q.r); d.b = Math.max(d.b, q.b); } return d; };
    // ── плашки ──
    const chipBox = document.createElement('div'); chipBox.className = 'e2-chips'; hud.appendChild(chipBox);
    const chips = new Map();
    H.chip = (id, o = {}) => {
      let c = chips.get(id);
      if (!c) {
        const d = document.createElement(o.tap ? 'button' : 'div'); if (o.tap) d.type = 'button';
        d.className = 'e2-chip ' + (o.at || 'tl') + (o.tap ? ' tap' : ''); d.innerHTML = '<span></span><em></em>';
        if (o.title) d.title = o.title;
        if (o.tap) d.addEventListener('pointerdown', e => { e.stopPropagation(); }), d.addEventListener('click', e => { e.stopPropagation(); o.tap(); });
        d.firstChild.textContent = o.icon || '';
        chipBox.appendChild(d);
        let txt = null, vis = true;
        c = { el: d, set(t){ t = t == null ? '' : String(t); if (t !== txt) { txt = t; d.lastChild.textContent = t; } return c; }, show(on){ on = !!on; if (on !== vis) { vis = on; d.hidden = !on; } return c; }, icon(i){ d.firstChild.textContent = i; return c; } };
        chips.set(id, c);
      }
      if (o.text != null) c.set(o.text);
      return c;
    };
    // ── подсказка один раз на устройство ──
    const hintEl = document.createElement('div'); hintEl.className = 'e2-hint'; hintEl.setAttribute('aria-live', 'polite'); hud.appendChild(hintEl);
    let hintT = 0, hintId = '';
    H.hint = (id, text, o = {}) => {
      const T = TL(); if (!o.force && (!T?.hintOnce || !T.hintOnce(game, 'h-' + id))) return false;
      hintId = id; hintEl.textContent = text; hintEl.classList.toggle('on', true);
      clearTimeout(hintT); hintT = later(() => hintEl.classList.toggle('on', false), o.ms || 6000);
      return true;
    };
    H.hintDone = id => { if (hintId === id) { clearTimeout(hintT); hintEl.classList.toggle('on', false); } };
    // ── окно отладки: F3 / ⚙️ «Окно отладки» / ?debug=1; fn зовётся, только пока окно видно ──
    let dbg = null;
    H.debug = (fn, o = {}) => {
      if (!dbg) {
        const d = document.createElement('div'); d.className = 'e2-debug'; d.hidden = true; hud.appendChild(d);
        dbg = { el: d, fn, t: 0, every: o.every || 250, on: false };
        const want = () => !!opt('hudDebug', false) || /[?&]debug=1/.test(location.search);
        const sync = v => { v = !!v; if (v === dbg.on) return; dbg.on = v; d.hidden = !v; clearInterval(dbg.t); if (v) { const w = () => { try { d.textContent = String(dbg.fn() ?? ''); } catch (e) { d.textContent = String(e.message || e); } }; w(); dbg.t = setInterval(w, dbg.every); } };
        dbg.sync = sync; sync(want());
        onWin(window, 'keydown', e => { if (e.code === 'F3' && !e.repeat) { e.preventDefault(); sync(!dbg.on); } });
        onWin(window, 'd37:settings', e => { if (e.detail?.key === 'hudDebug' || e.detail?.key === '*') sync(want()); });
      } else dbg.fn = fn;
      return { show: v => dbg.sync(v), on: () => dbg.on };
    };
    return {
      // кнопка позы — свои нажатия (true — обработано здесь)
      button(b, d){
        d.dataset.k = b.id || b.action || b.kind || '';
        if (b.kind !== 'pose') { if (b.own) d.addEventListener('pointerdown', () => seenBtn(d)); return !!b.own; }   // own — нажатия ведёт игра сама
        wirePose(d); return true;
      },
      plain(b, d){
        d.dataset.k = b.id || b.action || '';
        if (b.kind === 'act' || b.action === 'interact') { wireAct(d); d.classList.add('e2-ctx'); }
        else if (b.ctx) { d.hidden = true; d.classList.add('e2-ctx'); }
        d.addEventListener('pointerdown', () => seenBtn(d));
      },
      labels(list){
        let n = 0; const T = TL();
        for (const b of list) { const d = get(b.id || b.action); if (!d || !b.label || n >= 2) continue; if (T?.seen?.(game, 'b-' + d.dataset.k)) continue; d.classList.add('new'); n++; }
      },
      reset(){ setLatch(false); rad?.close(); actBtn = null; poseBtn = null; pill = null; holdC = null; poseCur = ''; },
      hold(k){
        if (!holdC) return;
        const q = Math.round(k * 50) / 50; if (q === holdQ) return; holdQ = q;
        if (q > 0) { holdC.removeAttribute('hidden'); holdC.firstChild.setAttribute('stroke-dashoffset', String(HL * (1 - q))); } else holdC.setAttribute('hidden', '');
      },
      avoid(){ const out = []; for (const t of trays) out.push(t.rect()); return out; },
      dispose(){ for (const t of timers) clearTimeout(t); timers.clear(); setLatch(false); clearTimeout(hintT); if (dbg) clearInterval(dbg.t); fade?.dispose(); rad?.dispose(); for (const s of sheets) s.dispose(); for (const t of trays) t.dispose(); },
    };
  }
})();
