// ═══════════════════════════════════════
//  D37E.sheet — общий «лист» для помощников игр (T-049, docs/plans/kubomir-modpacks.md §4.0): книга рецептов, точки карты,
//  дорожная книга… На телефоне (узкое окно) — снизу, на компьютере — справа (рядом с окном вещей), геймпад — фокус по стрелкам
// ═══════════════════════════════════════
// sh = D37E.sheet.open(родитель, { id, title, tabs: [{ id, label }], tab, search: { ph, value }, cls, render(body, ctx), onTab(id),
//   onSearch(q), onBack() → true (свой «назад» — например, из карточки в список), onClose() }) — один лист за раз (новый закрывает
//   прошлый). ctx = { tab, q, sh }. sh.redraw(), sh.setTab(id), sh.setTitle(t), sh.close(), sh.el, sh.body.
// Мышь и пальцы над листом в игру не проходят. Esc закрывает лист, если фокус внутри (игра зовёт D37E.sheet.escape() сама, когда
// Esc пришёл к ней). Геймпад (опрос — только пока лист открыт и есть геймпад): крестовина / стик — фокус к ближайшему по
// направлению (сетки значков и списки), Ⓐ — нажать (при отпускании), Ⓑ — назад или закрыть, LB / RB — вкладки.
// D37E.sheet.vlist(коробка, { n, rowH, row(i, el) }) — длинный список: в DOM не больше видимых строк + 4 (переиспользуются).
// Пользовательский текст — только через textContent / esc (правило сайта).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const doc = root.document;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CSS = `
.d37sh{position:absolute;z-index:12;display:flex;flex-direction:column;background:rgba(14,16,28,.95);color:#eef1ff;border:1px solid rgba(255,255,255,.14);box-shadow:0 10px 40px rgba(0,0,0,.55);font-family:Montserrat,system-ui,sans-serif;touch-action:manipulation;overscroll-behavior:contain;pointer-events:auto}
.d37sh.dock{top:8px;right:8px;bottom:8px;width:min(420px,calc(46% - 8px));min-width:300px;border-radius:14px}
.d37sh.bottom{left:0;right:0;bottom:0;max-height:84%;border-radius:16px 16px 0 0;padding-bottom:env(safe-area-inset-bottom)}
.d37sh.center{left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100% - 16px));max-height:calc(100% - 16px);border-radius:14px}
.d37sh-hd{display:flex;align-items:center;gap:8px;padding:10px 10px 6px 14px;flex:none}
.d37sh-hd b{flex:1;font-size:1rem;letter-spacing:.2px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.d37sh-hd small{display:block;color:#9aa4c8;font-weight:600;font-size:.74rem}
.d37sh-x,.d37sh-bk{flex:none;width:40px;height:40px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.07);color:#fff;font-size:17px;cursor:pointer}
.d37sh-bk[hidden]{display:none}
.d37sh.bottom .d37sh-hd::before{content:'';position:absolute;left:50%;top:5px;width:38px;height:4px;margin-left:-19px;border-radius:2px;background:rgba(255,255,255,.22)}
.d37sh-tabs{display:flex;gap:4px;padding:0 10px 6px;overflow-x:auto;flex:none;scrollbar-width:none}
.d37sh-tabs button{flex:none;min-height:36px;padding:4px 11px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#dfe5ff;font:700 .84rem Montserrat,system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.d37sh-tabs button.on{background:rgba(79,140,255,.38);border-color:#7aa6ff;color:#fff}
.d37sh-find{flex:none;margin:0 10px 6px;min-height:38px;padding:6px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.32);color:#fff;font:600 .9rem Montserrat,system-ui,sans-serif}
.d37sh-body{position:relative;flex:1;min-height:0;overflow:auto;padding:4px 10px 12px;-webkit-overflow-scrolling:touch}
.d37sh-body:focus{outline:none}
.d37sh button{font-family:inherit}
.d37sh.pad :focus{outline:3px solid #ffd23f;outline-offset:1px}
.d37sh-note{margin:6px 2px;color:#9aa4c8;font-size:.82rem;line-height:1.4}
.d37sh-vl{position:relative}
.d37sh-vl>.d37sh-vr{position:absolute;left:0;right:0}
@media (max-width:719px){.d37sh.dock{left:0;right:0;top:auto;bottom:0;width:auto;min-width:0;max-height:84%;border-radius:16px 16px 0 0}}
`;
  function css(){
    if (!doc || doc.getElementById('d37-sheet-css')) return;
    const s = doc.createElement('style'); s.id = 'd37-sheet-css'; s.textContent = CSS; doc.head.appendChild(s);
  }
  let cur = null;
  const FOC = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  const shown = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects?.().length) && !e.closest('[hidden]');

  function open(parent, o = {}){
    if (!doc || !parent) return null;
    css();
    if (cur) cur.close();
    const el = doc.createElement('div');
    const W = parent.clientWidth || 800, wide = W >= 720;
    const where = o.where || (wide ? 'dock' : 'bottom');
    el.className = 'd37sh ' + where + (o.cls ? ' ' + o.cls : '');
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', o.title || 'Окно');
    el.dataset.sheet = o.id || '';
    const tabs = Array.isArray(o.tabs) ? o.tabs : [];
    el.innerHTML = `<div class="d37sh-hd"><button type="button" class="d37sh-bk" data-sh="back" aria-label="Назад" hidden>←</button><b></b><button type="button" class="d37sh-x" data-sh="x" aria-label="Закрыть">✕</button></div>`
      + (tabs.length ? `<div class="d37sh-tabs" role="tablist">${tabs.map(t => `<button type="button" role="tab" data-tab="${esc(t.id)}">${esc(t.label)}</button>`).join('')}</div>` : '')
      + (o.search ? `<input class="d37sh-find" type="search" enterkeyhint="search" autocomplete="off" spellcheck="false">` : '')
      + `<div class="d37sh-body" tabindex="-1"></div>`;
    const sh = { el, id: o.id || '', body: el.querySelector('.d37sh-body'), tab: o.tab || (tabs[0] && tabs[0].id) || '', q: '', o, back: false, dead: false };
    const ttl = el.querySelector('.d37sh-hd b');
    sh.setTitle = (t, sub) => { ttl.textContent = String(t ?? ''); if (sub) { const s = doc.createElement('small'); s.textContent = String(sub); ttl.appendChild(s); } };
    sh.setTitle(o.title || '', o.sub || '');
    const find = el.querySelector('.d37sh-find');
    if (find) { find.placeholder = o.search.ph || 'Найти…'; if (o.search.value) { find.value = String(o.search.value); sh.q = find.value; } }
    const paintTabs = () => { for (const b of el.querySelectorAll('[data-tab]')) { const on = b.dataset.tab === sh.tab; if (b.classList.contains('on') !== on) b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); } };
    sh.showBack = v => { const b = el.querySelector('.d37sh-bk'); if (b && b.hidden !== !v) b.hidden = !v; sh.back = !!v; };
    sh.redraw = () => { if (sh.dead) return; paintTabs(); try { o.render?.(sh.body, { tab: sh.tab, q: sh.q, sh }); } catch (e) { console.error(e); root.d37Err?.('sheet:' + sh.id, e); sh.body.textContent = 'Что-то пошло не так — закрой и открой окно ещё раз.'; } };
    sh.setTab = id => { if (!tabs.some(t => t.id === id)) return; sh.tab = id; try { o.onTab?.(id); } catch (e) {} sh.body.scrollTop = 0; sh.redraw(); };
    sh.close = () => {
      if (sh.dead) return; sh.dead = true;
      el.remove(); if (cur === sh) cur = null;
      parent.classList.remove('d37sh-docked'); parent.style.removeProperty('--d37sh-w');
      padStop();
      try { o.onClose?.(); } catch (e) { console.error(e); }
    };
    sh.goBack = () => { if (sh.back && o.onBack?.()) return true; sh.close(); return true; };
    // нажатия: ✕, ←, вкладки; мышь и пальцы — не в игру
    el.addEventListener('click', e => {
      el.classList.remove('pad');
      const b = e.target.closest('[data-sh],[data-tab]'); if (!b) return;
      if (b.dataset.sh === 'x') sh.close();
      else if (b.dataset.sh === 'back') sh.goBack();
      else if (b.dataset.tab) sh.setTab(b.dataset.tab);
    });
    for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'contextmenu', 'touchstart', 'touchmove']) el.addEventListener(ev, e => { e.stopPropagation(); if (ev === 'contextmenu') e.preventDefault(); }, ev.startsWith('touch') ? { passive: true } : undefined);
    el.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (find && doc.activeElement === find && find.value) { find.value = ''; sh.q = ''; try { o.onSearch?.(''); } catch (er) {} sh.redraw(); } else sh.goBack(); return; }
      e.stopPropagation();   // буквы в поиске — не клавиши игры
    });
    el.addEventListener('keyup', e => e.stopPropagation());
    if (find) find.addEventListener('input', () => { sh.q = find.value; try { o.onSearch?.(sh.q); } catch (e) {} sh.redraw(); });
    parent.appendChild(el);
    if (where === 'dock' && wide) { parent.classList.add('d37sh-docked'); parent.style.setProperty('--d37sh-w', el.offsetWidth + 'px'); }
    cur = sh;
    sh.redraw();
    // фокус: на компьютере — в поиск (если есть), на телефоне — не открывать клавиатуру
    const touch = root.matchMedia?.('(pointer: coarse)')?.matches;
    try { (find && !touch ? find : sh.body).focus({ preventScroll: true }); } catch (e) {}
    padWake();
    return sh;
  }
  // Esc пришёл к игре: закрыть лист (или шаг назад) → true
  function escape(){ if (!cur) return false; cur.goBack(); return true; }

  // ═══ Геймпад: ближайший по направлению, Ⓐ — нажать при отпускании, Ⓑ — назад, LB/RB — вкладки ═══
  const NAV = { raf: 0, prev: null, dir: '', next: 0 };
  function padRead(){ try { const ps = root.navigator?.getGamepads?.(); if (ps) for (const p of ps) if (p && p.connected) return p; } catch (e) {} return null; }
  function padWake(){ if (NAV.raf || !cur || !root.requestAnimationFrame || !padRead()) return; NAV.prev = null; NAV.raf = root.requestAnimationFrame(padTick); }
  function padStop(){ if (NAV.raf && root.cancelAnimationFrame) root.cancelAnimationFrame(NAV.raf); NAV.raf = 0; NAV.prev = null; NAV.dir = ''; }
  root.addEventListener?.('gamepadconnected', () => padWake());
  function focusables(){ return cur ? [...cur.el.querySelectorAll(FOC)].filter(shown) : []; }
  // к ближайшему по направлению (dx, dy): сначала по оси, потом сбоку — штраф
  function moveDir(dx, dy){
    const all = focusables(); if (!all.length) return;
    const a = doc.activeElement;
    if (!a || !cur.el.contains(a) || a === cur.body) { focus(all[0]); return; }
    const r = a.getBoundingClientRect(), ax = r.left + r.width / 2, ay = r.top + r.height / 2;
    let best = null, bs = Infinity;
    for (const b of all) {
      if (b === a) continue;
      const q = b.getBoundingClientRect(), bx = q.left + q.width / 2, by = q.top + q.height / 2, vx = bx - ax, vy = by - ay;
      const along = vx * dx + vy * dy; if (along <= 2) continue;
      const side = Math.abs(vx * dy - vy * dx), s = along + side * 2.2;
      if (s < bs) { bs = s; best = b; }
    }
    if (best) focus(best);
  }
  function focus(b){ try { b.focus({ preventScroll: true }); } catch (e) {} b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
  function stepTab(d){
    if (!cur) return; const t = cur.o.tabs || []; if (!t.length) return;
    const i = t.findIndex(x => x.id === cur.tab), j = (i + d + t.length) % t.length;
    cur.setTab(t[j].id);
  }
  function padTick(t){
    NAV.raf = 0;
    const gp = cur && padRead();
    if (!gp) { NAV.prev = null; NAV.dir = ''; return; }
    const B = i => { const x = gp.buttons[i]; return !!x && (x.pressed || x.value > .5); };
    const ay = gp.axes[1] || 0, ax = gp.axes[0] || 0;
    const c = { up: B(12) || ay < -.6, down: B(13) || ay > .6, left: B(14) || ax < -.6, right: B(15) || ax > .6, a: B(0), b: B(1), lb: B(4), rb: B(5) };
    const P = NAV.prev; NAV.prev = c;
    if (P) {
      const dir = c.up ? 'up' : c.down ? 'down' : c.left ? 'left' : c.right ? 'right' : '';
      if (dir && (dir !== NAV.dir || t >= NAV.next)) { NAV.next = t + (dir !== NAV.dir ? 380 : 110); cur.el.classList.add('pad'); moveDir(dir === 'left' ? -1 : dir === 'right' ? 1 : 0, dir === 'up' ? -1 : dir === 'down' ? 1 : 0); }
      NAV.dir = dir;
      if (P.a && !c.a) { cur.el.classList.add('pad'); const a = doc.activeElement; if (a && cur.el.contains(a) && a !== cur.body && !a.matches('input')) a.click(); else moveDir(0, 1); }
      else if (P.b && !c.b) cur.goBack();
      else if ((c.lb && !P.lb) || (c.rb && !P.rb)) stepTab(c.rb && !P.rb ? 1 : -1);
    }
    if (cur) NAV.raf = root.requestAnimationFrame(padTick); else { NAV.prev = null; NAV.dir = ''; }
  }

  // ═══ Длинный список: видимые строки + запас, строки переиспользуются (без пересборки всего списка при прокрутке) ═══
  function vlist(box, o = {}){
    const rowH = Math.max(16, o.rowH | 0 || 48), pool = [];
    let n = 0, from = -1, to = -1;
    box.classList.add('d37sh-vl');
    const scroller = o.scroller || box.closest('.d37sh-body') || box.parentElement;
    const paint = force => {
      const top = Math.max(0, (scroller.scrollTop || 0) - (box.offsetTop || 0)), h = scroller.clientHeight || 400;
      const a = Math.max(0, Math.floor(top / rowH) - 2), b = Math.min(n, Math.ceil((top + h) / rowH) + 2);
      if (!force && a === from && b === to) return;
      from = a; to = b;
      const need = b - a;
      while (pool.length < need) { const r = doc.createElement('div'); r.className = 'd37sh-vr'; r.style.height = rowH + 'px'; box.appendChild(r); pool.push({ el: r, i: -1 }); }
      for (let k = 0; k < pool.length; k++) {
        const p = pool[k], i = k < need ? a + k : -1;
        if (i < 0) { if (!p.el.hidden) p.el.hidden = true; p.i = -1; continue; }
        if (p.el.hidden) p.el.hidden = false;
        if (p.i !== i || force) { p.i = i; p.el.style.top = (i * rowH) + 'px'; try { o.row?.(i, p.el); } catch (e) { console.error(e); } }
      }
    };
    const onScroll = () => paint(false);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const L = {
      set(count){ n = Math.max(0, count | 0); box.style.height = (n * rowH) + 'px'; paint(true); },
      refresh(){ paint(true); },
      dispose(){ scroller.removeEventListener('scroll', onScroll); for (const p of pool) p.el.remove(); pool.length = 0; },
      get rows(){ return pool.length; },
    };
    L.set(typeof o.n === 'number' ? o.n : 0);
    return L;
  }

  E.sheet = { open, escape, vlist, current: () => cur, closeAll: () => { if (cur) cur.close(); }, esc };
})();
