// ═══════════════════════════════════════
//  «КУБОМИР» — 🗺 атлас: мини-карта, свои точки, место нокаута (T-049, docs/plans/kubomir-modpacks.md §4.6 + решение владельца §7½:
//  «1 предмет, и для него нужно много карт сделать» — атлас = компас + 8 листов карты из РАЗНЫХ мест; это аксессуар)
// ═══════════════════════════════════════
// «Чистый лист карты» (ПКМ) → «Лист карты»: зарисовать можно только место, где ещё не рисовал (участки 128 × 128 блоков —
// P.ext.map.regions), так атлас — правда из 8 мест. Надет атлас (💍) — мини-карта справа сверху (север — вверх, стрелка — куда
// смотришь), 🏠 дом, 💀 место нокаута (уходит, когда подошёл на 3 блока или через 10 минут), свои точки (до 64: значок, цвет, имя —
// без ссылок, телефонов и мата: D37E.mapkit.cleanName). Нажал на карту / M / ☰ → 🗺 — лист «Атлас»: точки с расстоянием и стрелкой,
// «📍 Точка здесь» (N), переименовать, значок, убрать. Точки видны и на полосе компаса. Карта — из загруженных участков (на
// диске не хранится — следующий шаг: большая карта, K1.7). Мини-карта — D37E.mapkit (js/engine/mapkit.js), участок рисуется один раз.
(() => {
  const VX = () => window.D37E.vox, E = () => window.D37E;
  const REGION = 128, MAX_WP = 64;
  window.KubomirX?.feature((st, X) => {
    const g = X.g, P = st.P;
    const map = () => { const m = X.ext('map'); if (!Array.isArray(m.wp)) m.wp = []; if (!Array.isArray(m.regions)) m.regions = []; return m; };
    let mm = null, onEditFn = null, tick = 0, mmOn = null, edit = null;
    const f = { id: 'map', title: 'Атлас', order: 40 };
    // ── цвета клеток: средний цвет верхней грани блока (лениво, раз на мир) с цветом травы / листвы / воды ──
    let COL = null;
    const TINTS = { 1: [124, 189, 90], 2: [96, 161, 62], 3: [70, 120, 225], 4: [128, 167, 85], 5: [80, 132, 88] };
    function colorOf(t){
      if (!COL) COL = new Uint32Array(VX().blocks.length + 1);
      if (t < COL.length && COL[t]) return COL[t];
      const V = VX(), b = V.blocks[t]; let c = E().mapkit.pack(110, 110, 110);
      try {
        const L = b?.texf ? b.texf.top : -1;
        if (L >= 0) {
          const tx = V.tex[L], d = V.paint(tx.name, V.specOf ? V.specOf(tx.name) : tx.spec || V.TEX_SPECS[tx.name]);
          let r = 0, gg = 0, bb = 0, n = 0; for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 100) { r += d[i]; gg += d[i + 1]; bb += d[i + 2]; n++; }
          if (n) { r /= n; gg /= n; bb /= n; const tn = TINTS[b.tint]; if (tn) { r = r * tn[0] / 255; gg = gg * tn[1] / 255; bb = bb * tn[2] / 255; } c = E().mapkit.pack(r, gg, bb); }
        }
      } catch (e) {}
      if (t < COL.length) COL[t] = c;
      return c;
    }
    // ── участок → 16 × 16 цветов: верхний блок (трава и цветы — насквозь), вода — темнее с глубиной, рельеф — светлее к северу выше ──
    const H = new Int16Array(256);
    const TILES = {
      rev(cx, cz){ const c = st.W?.chunk(cx, cz); return c && c.gen && c.ids ? (c.rev | 0) : -1; },
      fill(cx, cz, out){
        const V = VX(), c = st.W.chunk(cx, cz); if (!c || !c.ids) return false;
        const ids = c.ids, T = V.T, top = Math.min(V.H - 1, (c.maxY | 0) + 1), SH = E().mapkit.shade;
        for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
          const base = (lx << 11) | (lz << 7);
          let y = top, t = 0;
          for (; y > 0; y--) { t = ids[base | y] & 0xfff; if (t && T.shape[t] !== V.SHAPE.cross && T.shape[t] !== V.SHAPE.torch) break; }
          let col = colorOf(t);
          if (T.liquid[t] === 1) { let d = 0; while (d < 12 && y - d - 1 > 0 && T.liquid[ids[base | (y - d - 1)] & 0xfff] === 1) d++; col = SH(col, 1.05 - d * .045); }
          // рельеф как на картах Майнкрафта: выше соседа с севера — светлее, ниже — темнее (вода — без рельефа)
          const hn = lz ? H[(lz - 1) * 16 + lx] : y;
          H[lz * 16 + lx] = y;
          out[lz * 16 + lx] = T.liquid[t] ? col : SH(col, y > hn ? 1.12 : y < hn ? .84 : 1);
        }
        return true;
      },
    };
    // ── метки на карте и полосе компаса (точки игрока; дом и вещи после нокаута — у подсказок, тут — свой 💀 на 10 минут) ──
    const MARKS = []; let marksKey = 0, marksRev = -1, rev = 1;
    function marks(){
      const m = map(), h = X.home?.(), d = m.death;
      if (marksRev !== rev) {
        marksRev = rev; MARKS.length = 0;
        if (h) MARKS.push({ x: h.x, z: h.z, ic: '🏠', col: '#ffd23f' });
        if (d) MARKS.push({ x: d.x, z: d.z, ic: '💀', col: '#ff5a5a' });
        for (const w of m.wp) MARKS.push({ x: w.x, z: w.z, ic: w.ic || '📍', col: E().mapkit.COLORS[w.col | 0] || '#fff' });
        marksKey++;
      }
      return MARKS;
    }
    X.markers = () => X.on('map') ? map().wp : null;
    f.init = () => {
      const parent = g.hudEl?.(); if (!parent || !E().mapkit || !st.W) return;
      mm = E().mapkit.minimap(parent, { size: g.touch?.() ? 80 : 128, cls: 'kx-mm', onTap: () => openAtlas() });
      mm.show(false);
      onEditFn = (x, y, z) => { mm?.dirty(x >> 4, z >> 4); };
      st.W.listeners.push(onEditFn);
    };
    f.dispose = () => { mm?.dispose(); mm = null; const L = st.W?.listeners, i = L ? L.indexOf(onEditFn) : -1; if (i >= 0) L.splice(i, 1); g.hudEl?.()?.classList.remove('kx-mmon'); };
    f.hud = dt => {
      if (!mm) return;
      const on = X.on('map') && !!st.ready && !P.dead && !st.hudHidden;
      if (on !== mmOn) { mmOn = on; mm.show(on); g.hudEl?.()?.classList.toggle('kx-mmon', on); }
      if (!on) return;
      if ((tick -= dt) > 0) return;
      tick = .1;
      mm.frame(P.x, P.z, st.rig?.yaw || 0, TILES, marks(), marksKey);
    };
    // нокаут — место (даже если вещи остались с тобой: туда, где был); ушло, когда подошёл или через 10 минут
    f.on = { knockout: (x, y, z) => { map().death = { x: Math.round(x * 10) / 10, y: Math.round(y), z: Math.round(z * 10) / 10, t: Date.now() }; rev++; } };
    let slow = 0;
    f.update = dt => {
      const K = st.K;
      if (K?.downRaw?.('map') && !st.chatEl && !st.menu && !P.dead) { if (X.isOpen() && X.sheet.id === 'atlas') X.closeSheet(); else openAtlas(); }
      if (K?.downRaw?.('waypoint') && !st.chatEl && !st.menu && !P.dead && !X.isOpen() && !st.ui?.isOpen?.()) addHere(true);
      if ((slow -= dt) > 0) return; slow = 1;
      const d = map().death;
      if (d && (Date.now() - d.t > 600000 || Math.hypot(d.x - P.x, d.z - P.z) < 3)) { delete map().death; rev++; }
      const h = X.home?.(), hk = h ? h.x + h.z * 1e-4 : 0; if (hk !== f.hk) { f.hk = hk; rev++; }
    };
    // ── лист карты: зарисовать новое место ──
    f.useItem = (s, it, which) => {
      if (it.use !== 'map') return false;
      const m = map(), key = Math.floor(P.x / REGION) + ',' + Math.floor(P.z / REGION);
      if (m.regions.includes(key)) { g.toast?.('🗺 Это место уже зарисовано — отойди дальше (участки по ' + REGION + ' блоков)'); return true; }
      m.regions.push(key); if (m.regions.length > 400) m.regions.splice(0, m.regions.length - 400);
      g.take?.(which);
      const left = g.give?.({ id: 'map_filled', n: 1 }) ?? 1; if (left > 0) g.spawnItem?.(P.x, P.y + 1, P.z, { id: 'map_filled', n: left });
      g.sound?.('click', { vol: .5, rate: .8 });
      const n = m.regions.length;
      g.toast?.('🗺 Лист карты: место зарисовано (' + n + (n === 1 ? ' место' : n < 5 ? ' места' : ' мест') + '). Атлас — компас и 8 листов на верстаке', true);
      X.emit('use', 'map', Math.floor(P.x), Math.floor(P.y), Math.floor(P.z));
      return true;
    };
    f.menu = () => X.on('map') ? [{ id: 'x:atlas', icon: '🗺', text: 'Атлас: точки' }] : [];
    f.pick = id => { if (id !== 'x:atlas') return false; openAtlas(); return true; };
    // ── точки ──
    function addHere(quick){
      if (!X.on('map')) { g.toast?.('🗺 Точки ставятся на атлас: надень его (💍)'); return null; }
      const m = map(); if (m.wp.length >= MAX_WP) { g.toast?.('📍 Точек уже ' + MAX_WP + ' — убери ненужные (🗺 Атлас)'); return null; }
      let n = m.wp.length + 1; while (m.wp.some(w => w.name === 'Точка ' + n)) n++;
      const w = { id: Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: 'Точка ' + n, ic: '📍', col: m.wp.length % 8, x: Math.round(P.x * 10) / 10, y: Math.round(P.y), z: Math.round(P.z * 10) / 10, t: Date.now() };
      m.wp.push(w); rev++;
      g.toast?.('📍 ' + w.name + ' — на карте' + (quick ? ' (переименовать — 🗺 Атлас)' : ''), true);
      if (X.isOpen() && X.sheet.id === 'atlas') X.sheet.redraw();
      return w;
    }
    function openAtlas(){
      if (!X.on('map')) { g.toast?.('🗺 Нужен атлас: компас и 8 листов карты из разных мест (верстак), надень его в 💍'); return; }
      edit = null;
      X.open({ id: 'atlas', title: '🗺 Атлас', sub: 'точки на карте и полосе компаса', render: atlasSheet, onBack: () => { if (!edit) return false; edit = null; X.sheet.redraw(); return true; } });
    }
    function atlasSheet(body, ctx){
      const V = VX(), m = map(), L = g.lookDir?.() || { x: 0, z: -1 }, I = E().info;
      ctx.sh.showBack(!!edit);
      body.innerHTML = '';
      const add = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; body.appendChild(e); return e; };
      if (edit) {
        const w = m.wp.find(q => q.id === edit); if (!w) { edit = null; ctx.sh.redraw(); return; }
        const inp = add('input', 'd37sh-find kx-wpname'); inp.type = 'text'; inp.maxLength = 24; inp.value = w.name; inp.setAttribute('aria-label', 'Имя точки');
        inp.addEventListener('change', () => { const nm = E().mapkit.cleanName(inp.value, 24); if (nm) { w.name = nm; rev++; } inp.value = w.name; });
        add('p', 'd37sh-note', 'Значок:');
        const icons = add('div', 'kx-wpic'); for (const ic of E().mapkit.ICONS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'kx-ri sm' + (w.ic === ic ? ' on' : ''); b.dataset.wic = ic; b.textContent = ic; icons.appendChild(b); }
        add('p', 'd37sh-note', 'Цвет:');
        const cols = add('div', 'kx-wpcol'); E().mapkit.COLORS.forEach((c, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'kx-wc' + ((w.col | 0) === i ? ' on' : ''); b.dataset.wcol = String(i); b.style.background = c; b.setAttribute('aria-label', 'Цвет ' + (i + 1)); cols.appendChild(b); });
        const del = add('button', 'kx-btn', '🗑 Убрать точку'); del.type = 'button'; del.dataset.wdel = w.id;
        body.onclick = e => {
          const ic = e.target.closest('[data-wic]'), cl = e.target.closest('[data-wcol]'), dl = e.target.closest('[data-wdel]');
          if (ic) { w.ic = ic.dataset.wic; rev++; ctx.sh.redraw(); }
          else if (cl) { w.col = +cl.dataset.wcol; rev++; ctx.sh.redraw(); }
          else if (dl) { const i = m.wp.indexOf(w); if (i >= 0) m.wp.splice(i, 1); rev++; edit = null; ctx.sh.redraw(); }
        };
        return;
      }
      const top = add('div', 'kx-wptop');
      const here = document.createElement('button'); here.type = 'button'; here.className = 'kx-btn pri'; here.dataset.where = '1'; here.textContent = '📍 Точка здесь' + (g.label ? ' (' + (g.label('waypoint') || 'N') + ')' : ''); top.appendChild(here);
      const cnt = document.createElement('small'); cnt.textContent = m.wp.length + ' из ' + MAX_WP + ' · листов карты: ' + m.regions.length; top.appendChild(cnt);
      const list = add('div', 'kx-acc');
      const row = (ic, name, x, y, z, id) => {
        const dx = x - P.x, dz = z - P.z, d = Math.round(Math.hypot(dx, dz)), dy = Math.round(y - P.y);
        const r = document.createElement('div'); r.className = 'kx-arow';
        const i = document.createElement('span'); i.className = 'kx-ai'; i.textContent = ic; r.appendChild(i);
        const t = document.createElement('div'), b = document.createElement('b'), s = document.createElement('small');
        b.textContent = name; s.textContent = d + ' бл. ' + I.arrow(dx, dz, L.x, L.z) + (dy > 2 ? ' · выше ' + dy : dy < -2 ? ' · ниже ' + (-dy) : '') + ' · X ' + Math.floor(x) + ' Z ' + Math.floor(z);
        t.appendChild(b); t.appendChild(s); r.appendChild(t);
        if (id) { const e = document.createElement('button'); e.type = 'button'; e.className = 'kx-btn'; e.dataset.wedit = id; e.textContent = '✏️'; e.setAttribute('aria-label', 'Изменить точку'); r.appendChild(e); }
        list.appendChild(r);
      };
      const h = X.home?.(); if (h) row('🏠', 'Дом (лежанка)', h.x, h.y, h.z, null);
      if (m.death) row('💀', 'Место нокаута', m.death.x, m.death.y, m.death.z, null);
      const sorted = m.wp.slice().sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z));
      for (const w of sorted) row(w.ic || '📍', w.name, w.x, w.y, w.z, w.id);
      if (!h && !m.death && !m.wp.length) add('p', 'd37sh-note', 'Точек пока нет. «📍 Точка здесь» — запомнить место (шахта, дом, деревня…). Они видны на мини-карте и на полосе компаса.');
      body.onclick = e => {
        if (e.target.closest('[data-where]')) { addHere(false); return; }
        const ed = e.target.closest('[data-wedit]'); if (ed) { edit = ed.dataset.wedit; ctx.sh.redraw(); }
      };
    }
    f.state = () => ({ on: mmOn, mm: mm?.stats?.() || null, map: JSON.parse(JSON.stringify(map())), marks: MARKS.length });
    f._tiles = TILES; f._add = () => addHere(false);
    return f;
  });
})();
