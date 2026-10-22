// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — экран поверх мира: подсказка «[E] открыть» с кольцом удержания, полоска выносливости, всплывающие
//  сообщения, прицел, кнопки телефона (прыжок, действие, присесть, бег…) и джойстик — стили вставляет сам (#d37e-css)
// ═══════════════════════════════════════
// H = D37E.ui(el, C) → H.prompt(текст, удержание 0…1), H.stamina(0…1, выдохся), H.toast(текст, хорошо?), H.crosshair(вкл),
// H.buttons([{ id, icon, label, action, hold }], { layout, title }) — кнопки справа снизу (тем же путём, что клавиши: C.press),
// H.show(id, вкл), H.dispose(). Кнопка «действие» сама появляется, когда есть подсказка. Кнопки 50 px («большие» 62; T-074 —
// компактнее), игрок может переставить их (⚙️ → «Управление» → «🎮 Настроить кнопки», js/core/touch-layout.js).
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

  E.ui = function (el, C){
    css();
    const hud = document.createElement('div'); hud.className = 'e-hud'; el.appendChild(hud);
    const h = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; hud.appendChild(d); return d; };
    const R = 10, L = 2 * Math.PI * R;
    const pr = h('e-prompt', `<svg class="e-ring" viewBox="0 0 26 26" hidden><circle class="bg" cx="13" cy="13" r="${R}"/><circle class="fg" cx="13" cy="13" r="${R}" stroke-dasharray="${L}" stroke-dashoffset="${L}"/></svg><span></span>`);
    pr.hidden = true;
    const ring = pr.querySelector('svg'), fg = pr.querySelector('.fg'), txt = pr.querySelector('span');
    const st = h('e-stam', '<i></i>'), bar = st.firstChild; st.style.opacity = 0;
    const toast = h('e-toast'); let toastT = 0;
    const cross = h('e-cross'); cross.hidden = true;
    const btns = h('e-btns'); const byId = new Map();
    let lastText = null, fullAt = 0, actBtn = null;
    const H = {
      el: hud,
      prompt(text, k = 0){
        if (text !== lastText) { lastText = text; pr.hidden = !text; if (text) txt.textContent = text; if (actBtn) actBtn.hidden = !text; }
        ring.hidden = !(k > 0);
        if (k > 0) fg.setAttribute('stroke-dashoffset', String(L * (1 - k)));
      },
      stamina(v, tired){
        bar.style.transform = `scaleX(${Math.max(0, Math.min(1, v))})`;
        st.classList.toggle('tired', !!tired);
        const now = performance.now();
        if (v < .999 || tired) { fullAt = 0; st.style.opacity = 1; }
        else { if (!fullAt) fullAt = now; if (now - fullAt > 900) st.style.opacity = 0; }
      },
      toast(text, ok){
        toast.textContent = text; toast.className = 'e-toast on' + (ok === true ? ' ok' : ok === false ? ' bad' : '');
        clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('on'), 2200);
      },
      crosshair(on){ cross.hidden = !on; },
      // кнопки для пальца: нажал — как клавиша действия (C.press), отпустил — отпущена. «Отпустил» ловит и окно (палец увели
      // с кнопки и отпустили где угодно), перерисовка кнопок (вошёл в боевую зону) отпускает нажатые — иначе кнопка «залипала»
      buttons(list, o = {}){
        releaseBtns();
        btns.innerHTML = ''; byId.clear(); actBtn = null;
        for (const b of list) {
          const d = document.createElement('button');
          d.type = 'button'; d.className = 'e-btn' + (b.big ? ' big' : ''); d.innerHTML = `${b.icon}<b>${b.label || ''}</b>`;
          if (b.toggle) d.onclick = () => { d.classList.toggle('on', b.toggle()); };
          else {
            const rec = { pid: null, set: null };
            const set = rec.set = v => { if (!v) rec.pid = null; C?.press(b.action, v); d.classList.toggle('on', v); if (v) pressed.add(rec); else pressed.delete(rec); };
            d.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); try { d.setPointerCapture(e.pointerId); } catch (er) {} rec.pid = e.pointerId; set(true); });
            for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) d.addEventListener(ev, () => set(false));
          }
          if (b.action === 'interact') { actBtn = d; d.hidden = !lastText; }
          btns.appendChild(d); byId.set(b.id || b.action, d);
        }
        tlAttach(list, o);
      },
      show(id, on){ const d = byId.get(id); if (d) d.hidden = !on; },
      button: id => byId.get(id),
      dispose(){ clearTimeout(toastT); releaseBtns(); tl?.detach(); tl = null; ro?.disconnect(); for (const f of offs) f(); offs.length = 0; hud.remove(); },
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
      const ids = list.map(b => b.id || b.action);
      let h = 0; for (const c of ids.join(',')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      const items = list.map(b => ({ id: b.id || b.action, icon: b.icon, label: b.label || '', opt: b.action === 'interact' ? 'когда рядом есть что сделать' : undefined }));
      tl = TL.attach({ id: o.layout || 'e3d-' + h.toString(36), title: o.title || 'Кнопки 3D-мира', el, items: () => items, btn: k => byId.get(k) || null,
        defaults: (W, H, k, cx) => gridPos(cx), apply: (k, b, p) => tlPlace(b, p) });
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
    return H;
  };
})();
