// ═══════════════════════════════════════
//  D37E.info — подсказки помощников на экране (T-049, docs/plans/kubomir-modpacks.md §4.1; решение владельца §7½: это
//  аксессуары — часы, компас, глубиномер, лупа «что под прицелом», рудоискатель). Только DOM, без Three.js, общий для игр
// ═══════════════════════════════════════
// hud = D37E.info.hud(родитель, { cls }) — слой поверх игры (pointer-events: none):
//   hud.chip(id, значок, текст, порядок) — строка справа сверху (часы, координаты, глубина, руда); hud.hide(id)
//   hud.card(rec | null) — карточка «что под прицелом» сверху по центру: { key, icon (холст canvas или адрес картинки) | emo, name, sub,
//     lines: [[текст, цвет 'ok' | 'warn' | 'bad' | '']], drops: [холст или адрес] } — перерисовка только при смене key
//     (холст копируется drawImage — без toDataURL: перевод значка в адрес на телефоне стоил миллисекунды)
//     (живое — сердечки, прогресс — rec.live: та же карточка, меняется одна строка)
//   hud.compass(курс 0…2π от севера по часовой, метки [{ a — курс на метку, ic — значок, far — далеко }], номер меток) — полоса сверху:
//     С, В, Ю, З и метки в поле зрения (±90°); двигается transform, когда курс поменялся на 1° и больше; номер меток тот же и курс
//     не сдвинулся — метки не пересчитываются (игра меняет номер, когда пересчитала углы)
//   hud.show(вкл) — спрятать всё (F1, нокаут); hud.dispose()
// Пишет в DOM только то, что поменялось (сравнение с прошлым), без мусора за кадр (строки — только при смене).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const doc = root.document;
  const CSS = `
.d37in{position:absolute;inset:0;pointer-events:none;z-index:5;font-family:Montserrat,system-ui,sans-serif;color:#fff}
.d37in[hidden]{display:none}
.d37in-chips{position:absolute;right:10px;top:10px;display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.d37in-chip{display:flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:rgba(10,14,26,.66);border:1px solid rgba(255,255,255,.12);font:800 13px/1.3 Montserrat,system-ui,sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;text-shadow:0 1px 2px #000;transition:none}
.d37in-chip[hidden]{display:none}
.d37in-chip i{font-style:normal}
.d37in-card{position:absolute;left:50%;top:34px;transform:translateX(-50%);min-width:180px;max-width:min(380px,70%);padding:6px 12px 7px;border-radius:12px;background:rgba(10,14,26,.74);border:1px solid rgba(255,255,255,.14);box-shadow:0 6px 18px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center;transition:none}
.d37in-card[hidden]{display:none}
.d37in-ci{flex:none;position:relative;width:34px;height:34px;background:center/contain no-repeat;image-rendering:pixelated;display:grid;place-items:center;font-size:24px}
.d37in-ci canvas{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated}
.d37in-ci canvas[hidden]{display:none}
.d37in-ci i{font-style:normal}
.d37in-cb{min-width:0;flex:1}
.d37in-cb b{display:block;font-size:14px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.d37in-cb small{display:block;font-size:11.5px;line-height:1.3;color:#c8cfea}
.d37in-cb small[hidden]{display:none}
.d37in-cb small.ok{color:#86efac}.d37in-cb small.warn{color:#fcd34d}.d37in-cb small.bad{color:#fca5a5}
.d37in-dr{display:flex;gap:3px;margin-top:2px}
.d37in-dr[hidden],.d37in-dr span[hidden],.d37in-dr canvas[hidden]{display:none}
.d37in-dr span{position:relative;width:18px;height:18px;background:center/contain no-repeat;image-rendering:pixelated}
.d37in-dr canvas{position:absolute;inset:0;width:18px;height:18px;image-rendering:pixelated}
.d37in-hp{color:#ff5a6e;font-size:12px;letter-spacing:-1px}
.d37in-cbar{position:absolute;left:50%;top:6px;width:min(360px,56%);height:22px;margin-left:calc(min(360px,56%) / -2);overflow:hidden;border-radius:8px;background:linear-gradient(90deg,transparent,rgba(10,14,26,.62) 18%,rgba(10,14,26,.62) 82%,transparent);transition:none}
.d37in-cbar[hidden]{display:none}
.d37in-strip{position:absolute;left:0;top:0;height:22px;will-change:transform}
.d37in-strip span{position:absolute;top:2px;width:30px;margin-left:-15px;text-align:center;font:800 12px/18px Montserrat,system-ui,sans-serif;color:#dfe5ff;text-shadow:0 1px 2px #000}
.d37in-strip span.n{color:#ff6b6b}
.d37in-strip span.t{color:rgba(223,229,255,.45);font-size:9px}
.d37in-cbar::after{content:'';position:absolute;left:50%;top:0;width:2px;height:6px;margin-left:-1px;background:#ffd23f}
.d37in-mk{position:absolute;left:0;top:2px;width:22px;margin-left:-11px;text-align:center;font-size:13px;line-height:18px;will-change:transform}
.d37in-mk[hidden]{display:none}
.d37in-mk.far{opacity:.6;font-size:11px}
`;
  function css(){ if (!doc || doc.getElementById('d37-info-css')) return; const s = doc.createElement('style'); s.id = 'd37-info-css'; s.textContent = CSS; doc.head.appendChild(s); }
  const PX_PER_DEG = 2;   // полоса компаса: 2 px на градус (поле зрения ±90° — 360 px)
  const LETTERS = [[0, 'С', 'n'], [45, 'СВ', 't'], [90, 'В', ''], [135, 'ЮВ', 't'], [180, 'Ю', ''], [225, 'ЮЗ', 't'], [270, 'З', ''], [315, 'СЗ', 't']];

  function hud(parent, o = {}){
    if (!doc || !parent) return null;
    css();
    const el = doc.createElement('div'); el.className = 'd37in' + (o.cls ? ' ' + o.cls : '');
    // карточка — постоянные узлы (имя, 5 строк, 4 значка добычи, живая строка): смена цели меняет только текст и картинки, без
    // новых узлов и холстов (раньше на каждую цель — новые узлы и холсты добычи: на ходу это мусор и лишняя работа видеокарте)
    const LN = 5, DR = 4;
    el.innerHTML = '<div class="d37in-cbar" hidden><div class="d37in-strip"></div></div><div class="d37in-card" hidden><span class="d37in-ci"><canvas width="34" height="34"></canvas><i></i></span><div class="d37in-cb"><b></b><small class="d37in-sub" hidden></small>'
      + '<small class="d37in-ln" hidden></small>'.repeat(LN) + '<div class="d37in-dr" hidden>' + '<span hidden><canvas width="18" height="18"></canvas></span>'.repeat(DR) + '</div><small class="d37in-live" hidden></small></div></div><div class="d37in-chips"></div>';
    parent.appendChild(el);
    const chipsEl = el.querySelector('.d37in-chips'), cardEl = el.querySelector('.d37in-card'), cardIc = cardEl.querySelector('.d37in-ci'), cardBody = cardEl.querySelector('.d37in-cb');
    const icCv = cardIc.querySelector('canvas'), icEmo = cardIc.querySelector('i'), icG = icCv.getContext('2d'); icG.imageSmoothingEnabled = false;
    const nameEl = cardBody.querySelector('b'), subEl = cardBody.querySelector('.d37in-sub'), lineEls = Array.from(cardBody.querySelectorAll('.d37in-ln')), liveEl = cardBody.querySelector('.d37in-live');
    const drEl = cardBody.querySelector('.d37in-dr'), drSlots = Array.from(drEl.children).map(sp => { const cv = sp.firstChild, g = cv.getContext('2d'); g.imageSmoothingEnabled = false; return { sp, cv, g }; });
    // значок: готовый холст (без перекодирования в картинку — на телефоне toDataURL стоит миллисекунды) или адрес картинки
    const isCanvas = v => !!v && typeof v === 'object' && typeof v.getContext === 'function';
    const chips = new Map();
    const H = { el };
    // ── строки справа сверху ──
    H.chip = (id, icon, text, order = 0) => {
      let c = chips.get(id);
      if (!c) {
        const d = doc.createElement('div'); d.className = 'd37in-chip'; d.style.order = String(order | 0);
        const i = doc.createElement('i'), s = doc.createElement('span'); d.appendChild(i); d.appendChild(s); chipsEl.appendChild(d);
        c = { d, i, s, icon: null, text: null, on: true }; chips.set(id, c);
      }
      if (!c.on) { c.on = true; c.d.hidden = false; }
      if (c.icon !== icon) { c.icon = icon; c.i.textContent = icon; }
      if (c.text !== text) { c.text = text; c.s.textContent = text; }
    };
    H.hide = id => { const c = chips.get(id); if (c && c.on) { c.on = false; c.d.hidden = true; } };
    // ── карточка «что под прицелом» ──
    let cardKey = null, liveKey = null;
    H.card = rec => {
      if (!rec) { if (cardKey !== null) { cardKey = null; liveKey = null; cardEl.hidden = true; } return; }
      if (rec.key !== cardKey) {
        cardKey = rec.key; liveKey = null;
        icG.clearRect(0, 0, 34, 34);
        const cv = isCanvas(rec.icon);
        icCv.hidden = !cv; if (cv) icG.drawImage(rec.icon, 0, 0, 34, 34);
        cardIc.style.backgroundImage = !cv && rec.icon ? 'url(' + rec.icon + ')' : '';
        icEmo.textContent = rec.icon ? '' : rec.emo || '';
        nameEl.textContent = rec.name || '';
        subEl.hidden = !rec.sub; if (rec.sub) subEl.textContent = rec.sub;
        const L = rec.lines || [];
        for (let i = 0; i < LN; i++) {
          const e = lineEls[i], l = L[i];
          if (!l) { if (!e.hidden) e.hidden = true; continue; }
          e.hidden = false; e.textContent = l[0]; e.className = l[1] ? 'd37in-ln ' + l[1] : 'd37in-ln';
        }
        const D = rec.drops || [];
        drEl.hidden = !D.length;
        for (let i = 0; i < DR; i++) {
          const s = drSlots[i], u = D[i];
          if (!u) { if (!s.sp.hidden) s.sp.hidden = true; continue; }
          s.sp.hidden = false;
          const cv = isCanvas(u);
          s.g.clearRect(0, 0, 18, 18); s.cv.hidden = !cv; if (cv) s.g.drawImage(u, 0, 0, 18, 18);
          s.sp.style.backgroundImage = cv ? '' : 'url(' + u + ')';
        }
        cardEl.hidden = false;
      }
      // живая строка (сердечки моба, печь): только текст
      const lv = rec.live || '';
      if (lv !== liveKey) { liveKey = lv; liveEl.hidden = !lv; liveEl.textContent = lv; liveEl.className = 'd37in-live' + (rec.liveCls ? ' ' + rec.liveCls : ''); }
    };
    // ── полоса компаса ──
    const cbar = el.querySelector('.d37in-cbar'), strip = el.querySelector('.d37in-strip');
    // ширину полосы меряем только при показе и после изменения окна (чтение clientWidth на каждом шаге заставляло браузер
    // пересчитывать раскладку всей страницы — на телефоне это миллисекунды)
    let cbOn = false, cbDeg = null, W = 0, wDirty = true;
    const onResize = () => { wDirty = true; };
    root.addEventListener?.('resize', onResize);
    const marks = [];
    const buildStrip = () => {
      // буквы на трёх оборотах (−360…+720°) — сдвиг полосы покрывает любой курс без перестройки
      let h = ''; for (let k = -1; k <= 2; k++) for (const [d, t, c] of LETTERS) h += `<span class="${c}" style="left:${(d + k * 360) * PX_PER_DEG}px">${t}</span>`;
      for (let k = -1; k <= 2; k++) for (let d = 15; d < 360; d += 30) if (d % 45) h += `<span class="t" style="left:${(d + k * 360) * PX_PER_DEG}px">·</span>`;
      strip.innerHTML = h;
    };
    // rev — номер списка меток (игра меняет его, когда пересчитала углы): курс не сдвинулся на 1° и номер тот же — метки не трогаем
    let mkRev = NaN;
    H.compass = (bearing, list, rev) => {
      if (bearing == null) { if (cbOn) { cbOn = false; cbar.hidden = true; } return; }
      if (!cbOn) { cbOn = true; cbar.hidden = false; if (!strip.firstChild) buildStrip(); cbDeg = null; wDirty = true; }
      if (wDirty) { wDirty = false; W = cbar.clientWidth || W || 360; cbDeg = null; }
      const deg0 = ((bearing * 180 / Math.PI) % 360 + 360) % 360, turned = cbDeg === null || Math.abs(deg0 - cbDeg) >= 1;
      if (turned) {
        cbDeg = deg0;
        strip.style.transform = 'translateX(' + Math.round(W / 2 - deg0 * PX_PER_DEG) + 'px)';
      }
      if (!turned && rev !== undefined && rev === mkRev) return;
      mkRev = rev;
      const deg = cbDeg;   // метки — по тому же курсу, что и полоса (не разъезжаются с буквами)
      // метки: в поле ±(W/2) px
      const n = list ? list.length : 0;
      for (let i = 0; i < n || i < marks.length; i++) {
        let m = marks[i];
        if (i >= n) { if (m && !m.d.hidden) m.d.hidden = true; continue; }
        if (!m) { const d = doc.createElement('span'); d.className = 'd37in-mk'; cbar.appendChild(d); m = marks[i] = { d, ic: null, x: null, far: null }; }
        const q = list[i];
        let rel = ((q.a * 180 / Math.PI - deg) % 360 + 540) % 360 - 180;
        const x = Math.round(W / 2 + rel * PX_PER_DEG), vis = Math.abs(rel) * PX_PER_DEG < W / 2 - 8;
        if (m.d.hidden === vis) m.d.hidden = !vis;
        if (!vis) continue;
        if (m.ic !== q.ic) { m.ic = q.ic; m.d.textContent = q.ic; }
        if (m.x !== x) { m.x = x; m.d.style.transform = 'translateX(' + x + 'px)'; }   // transform — без пересчёта раскладки
        const far = !!q.far; if (m.far !== far) { m.far = far; m.d.classList.toggle('far', far); }
      }
    };
    let shown = true;
    H.show = v => { v = !!v; if (v !== shown) { shown = v; el.hidden = !v; if (v) wDirty = true; } };
    H.dispose = () => { el.remove(); chips.clear(); marks.length = 0; root.removeEventListener?.('resize', onResize); };
    return H;
  }

  // ── общие расчёты для игр ──
  const SIDES = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
  // сторона света по курсу (0 — север, по часовой)
  const side = bearing => SIDES[((Math.round(bearing / (Math.PI / 4)) % 8) + 8) % 8];
  // стрелка «куда идти» относительно взгляда: dx, dz — к цели, fx, fz — куда смотришь (по земле). Право — (−fz, fx) (как rig.right()
  // камеры движка: смотришь на север −Z — восток +X справа)
  const ARROWS = ['⬆', '↗', '➡', '↘', '⬇', '↙', '⬅', '↖'];
  const turn = (dx, dz, fx, fz) => ((Math.round(Math.atan2(fx * dz - fz * dx, dx * fx + dz * fz) / (Math.PI / 4)) % 8) + 8) % 8;
  const arrow = (dx, dz, fx, fz) => ARROWS[turn(dx, dz, fx, fz)];
  // часы: «07:40» (точность — 10 игровых минут: реже пишет в DOM)
  const clock = (hours, step = 10) => { const m = Math.floor(((hours % 24) + 24) % 24 * 60 / step) * step; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

  E.info = { hud, side, arrow, turn, clock, SIDES, ARROWS };
})();
