// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — экран поверх мира: подсказка «[E] открыть» с кольцом удержания, полоска выносливости, всплывающие
//  сообщения, прицел, кнопки телефона (прыжок, действие, присесть, бег…) и джойстик — стили вставляет сам (#d37e-css)
// ═══════════════════════════════════════
// H = D37E.ui(el, C) → H.prompt(текст, удержание 0…1), H.stamina(0…1, выдохся), H.toast(текст, хорошо?), H.crosshair(вкл),
// H.buttons([{ id, icon, label, action, hold }]) — кнопки справа снизу (тем же путём, что клавиши: C.press), H.show(id, вкл),
// H.dispose(). Кнопка «действие» сама появляется, когда есть подсказка.
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
.e-btn{pointer-events:auto;touch-action:none;width:58px;height:58px;border-radius:50%;border:2px solid rgba(255,255,255,.45);background:rgba(18,14,36,.55);color:#fff;
  font-size:22px;display:grid;place-items:center;line-height:1;position:relative;-webkit-tap-highlight-color:transparent}
.e-btn b{position:absolute;bottom:-15px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:800;white-space:nowrap;text-shadow:0 1px 3px #000}
.e-btn.big{width:74px;height:74px;font-size:28px}
.e-btn.on,.e-btn:active{background:rgba(124,58,237,.75);border-color:#fff}
.e-btn[hidden]{display:none}
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
      // кнопки для пальца: нажал — как клавиша действия (C.press), отпустил — отпущена
      buttons(list){
        btns.innerHTML = ''; byId.clear(); actBtn = null;
        for (const b of list) {
          const d = document.createElement('button');
          d.type = 'button'; d.className = 'e-btn' + (b.big ? ' big' : ''); d.innerHTML = `${b.icon}<b>${b.label || ''}</b>`;
          if (b.toggle) d.onclick = () => { d.classList.toggle('on', b.toggle()); };
          else {
            const set = v => { C?.press(b.action, v); d.classList.toggle('on', v); };
            d.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); try { d.setPointerCapture(e.pointerId); } catch (er) {} set(true); });
            for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) d.addEventListener(ev, () => set(false));
          }
          if (b.action === 'interact') { actBtn = d; d.hidden = !lastText; }
          btns.appendChild(d); byId.set(b.id || b.action, d);
        }
      },
      show(id, on){ const d = byId.get(id); if (d) d.hidden = !on; },
      button: id => byId.get(id),
      dispose(){ clearTimeout(toastT); hud.remove(); },
    };
    return H;
  };
})();
