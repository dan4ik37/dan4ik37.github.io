// ═══════════════════════════════════════
//  «СТУДИЯ 3D» — прочность построек (T-022a, docs/PHYSICS_PLAN.md §1): ядро движка D37E.support на деталях-коробках;
//  панель «🧱 Прочность» (расширение D37E.studioExt), свойство детали «Материал прочности», модуль игры D37E.studioPlay
//  'support' (обрушение у того, кто считает мир; скрипты Support.*); studio3d.js не трогает
// ═══════════════════════════════════════
// Настройки мира — SC.settings.support = { mode: 'off' | 'soft' | 'real', show } (сохраняются в мире и выкладываются; гостям —
// блоком world). Детали (Part, Spawn, Mesh), закреплённые (Anchored), — узлы: касания сверху и сбоку по коробкам (поворот —
// описанная коробка), на земле (ландшафт или пол y = 0) — опора. Материал прочности — свойство детали smat: '' — по материалу
// вида (дерево, кирпич, бетон, металл, стекло…), wood | stone | brick | concrete | metal | glass, anchor — «Якорь» (сама —
// опора, не падает), none — не участвует (висит где угодно, как раньше). В редакторе — подсветка цветом устойчивости (синий —
// на земле, зелёный, жёлтый, красный — еле держится, тёмно-красный — упадёт при ▶). В игре: что не держится (при старте, после
// Destroy, Support.Break, открепления) — открепляется и падает настоящей физикой (rigid.js + Rapier); «■ Стоп» — мир как был.
// Скрипты (у того, кто считает мир): Support.Mode, Support.Holds(part), Support.Get(part) (0…100), Support.Break(part),
// Support.Collapsed — по одному вызову на упавшую деталь.
// Нагрузка (v2, T-124): SC.settings.phys = { load: 1 } (и D37E.support.LOAD) — у деталей есть вес (материал × объём), держит площадь
// касания: тяжёлое на тонкой балке, длинная консоль ломаются; «держалось до» — от посторонней правки не падает; подсветка в
// редакторе — по держанию и нагрузке. settings.support (режим, показ) не трогаем — свой ключ phys.
(() => {
  const E = window.D37E = window.D37E || {};
  const S = E.support;
  if (!S) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEG = Math.PI / 180;
  // ── материал прочности по виду детали (scene.js MATS) ──
  const BY_MAT = { wood: 'wood', planks: 'wood', plastic: 'wood', smooth: 'wood', neon: 'glass', fabric: 'wood', glass: 'glass', ice: 'glass',
    metal: 'metal', diamond: 'metal', brick: 'brick', concrete: 'concrete', asphalt: 'concrete', cobble: 'stone', rock: 'stone', marble: 'stone', tiles: 'stone',
    grass: 'dirt', dirt: 'dirt', sand: 'sand', snow: 'snow' };
  const SMATS = [['', '🔄 По материалу вида'], ['wood', '🪵 Дерево'], ['stone', '🪨 Камень'], ['brick', '🧱 Кирпич'], ['concrete', '⬜ Бетон'], ['metal', '⚙️ Металл'], ['glass', '🪟 Стекло (не держит других)'], ['anchor', '⚓ Якорь — опора, не падает'], ['none', '🚫 Не участвует (висит где угодно)']];
  const ANCHOR = S.mat('steel');
  const matOf = o => { const k = o.smat; if (k === 'anchor') return ANCHOR; if (k && S.MAT[k] !== undefined) return S.MAT[k]; return S.MAT[BY_MAT[o.mat] || 'stone']; };
  const takes = o => (o.cls === 'Part' || o.cls === 'Spawn' || o.cls === 'Mesh') && o.anchored !== false && o.smat !== 'none' && Array.isArray(o.pos) && Array.isArray(o.size);
  let api = null, papi = null, btn = null, box = null, lastBuild = null, ov = null, ovT = 0, offEv = [], hiT = 0;
  const ED = () => api?.ed || papi?.ed || null;
  const cfg = () => { const st = (api?.ed?.SC || papi?.SC || ED()?.SC)?.settings, s = st?.support || {}; return { mode: S.MODES[s.mode] ? s.mode : 'off', show: s.show !== false, load: !!(S.LOAD && B.collapse2 && (st?.phys?.load === 1 || st?.phys?.load === true)) }; };
  const B = S.boxes({ max: 4096 });

  // ── описанная коробка детали (поворот YXZ в градусах, как в Roblox) ──
  const BX = new Float64Array(6);
  function aabb(o){
    const sx = o.size[0] / 2, sy = o.size[1] / 2, sz = o.size[2] / 2, r = o.rot || [0, 0, 0];
    const a = (r[0] || 0) * DEG, b = (r[1] || 0) * DEG, c = (r[2] || 0) * DEG;
    let hx = sx, hy = sy, hz = sz;
    if (a || b || c) {
      const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
      // R = Ry(b) · Rx(a) · Rz(c)
      const m00 = cb * cc + sb * sa * sc, m01 = -cb * sc + sb * sa * cc, m02 = sb * ca;
      const m10 = ca * sc, m11 = ca * cc, m12 = -sa;
      const m20 = -sb * cc + cb * sa * sc, m21 = sb * sc + cb * sa * cc, m22 = cb * ca;
      hx = Math.abs(m00) * sx + Math.abs(m01) * sy + Math.abs(m02) * sz;
      hy = Math.abs(m10) * sx + Math.abs(m11) * sy + Math.abs(m12) * sz;
      hz = Math.abs(m20) * sx + Math.abs(m21) * sy + Math.abs(m22) * sz;
    }
    BX[0] = o.pos[0] - hx; BX[1] = o.pos[1] - hy; BX[2] = o.pos[2] - hz; BX[3] = o.pos[0] + hx; BX[4] = o.pos[1] + hy; BX[5] = o.pos[2] + hz;
    return BX;
  }
  // ── граф: все участвующие детали (+ только что сломанные — «до» они на месте) ──
  function build(SC, ph, extra){
    B.reset();
    const list = [];
    const add = o => {
      const b = aabb(o), m = matOf(o);
      let g = 0;
      if (o.smat === 'anchor') g = 1;
      else {
        const gy = ph?.groundAt ? Math.min(ph.groundAt(o.pos[0], o.pos[2]), ph.groundAt(b[0], b[2]), ph.groundAt(b[3], b[5])) : 0;
        if (b[1] <= gy + .08) g = 1;
      }
      if (B.add(b[0], b[1], b[2], b[3], b[4], b[5], m, g) >= 0) list.push(o);
    };
    for (const o of SC.all()) if (takes(o)) add(o);
    const broken = [];
    if (extra) for (const o of extra) { broken.push(list.length); add(o); }
    B.link(.06);
    lastBuild = { list, broken, n: B.n };
    return lastBuild;
  }
  const P = mode => S.prof(mode);

  // ═══ Редактор: подсветка цветом устойчивости (одна сетка экземпляров) ═══
  function overlay(){
    const ed = ED(), R = ed?.R; if (!R) return;
    const c = cfg(), on = !!box && c.mode !== 'off' && c.show && !ed.playing;
    if (!on) { if (ov) ov.visible = false; return; }
    const T = R.T;
    const L = build(ed.SC, ed.ph), Pm = P(c.mode);
    B.solve(Pm);
    const LDs = c.load ? B.loads(Pm) : null;   // v2: нагрузка (‰) — подсветка = худшее из держания и нагрузки
    if (LDs) B.solve(Pm);   // B.loads пересчитал держание теми же числами; подсветка читает B.g.sup
    const n = L.list.length;
    if (!ov || ov.userData.cap < n) {
      if (ov) { R.scene.remove(ov); ov.geometry.dispose(); ov.material.dispose(); }
      const cap = Math.max(64, Math.ceil(n * 1.5));
      ov = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .42, depthWrite: false, toneMapped: false, fog: false }), cap);
      ov.userData.cap = cap; ov.renderOrder = 995; ov.frustumCulled = false; ov.name = 's3:support';
      R.scene.add(ov);
    }
    const M = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), Sc = new T.Vector3(), C = new T.Color();
    let bad = 0;
    for (let i = 0; i < n; i++) {
      const b = B.bx, o6 = i * 6;
      M.compose(V.set((b[o6] + b[o6 + 3]) / 2, (b[o6 + 1] + b[o6 + 4]) / 2, (b[o6 + 2] + b[o6 + 5]) / 2), Q, Sc.set(b[o6 + 3] - b[o6] + .05, b[o6 + 4] - b[o6 + 1] + .05, b[o6 + 5] - b[o6 + 2] + .05));
      ov.setMatrixAt(i, M);
      let lv = S.level(B.g.sup[i], B.g.mat[i], Pm, B.g.gnd[i]);
      if (LDs && !LDs.unk[i]) { const r = LDs.ra[i], ll = r <= 0 ? 0 : r <= 500 ? 1 : r <= 800 ? 2 : r <= 1000 ? 3 : 4; if (ll > lv) lv = ll; }
      if (lv === 4) bad++;
      ov.setColorAt(i, C.setHex(S.COLORS[lv]));
    }
    ov.count = n; ov.instanceMatrix.needsUpdate = true; if (ov.instanceColor) ov.instanceColor.needsUpdate = true;
    ov.visible = true;
    const el = box?.querySelector('[data-sum]'); if (el) el.textContent = `Деталей: ${n}${bad ? ` · ⚠️ не держится (упадёт при ▶): ${bad}` : ' · всё держится'}`;
  }
  const later = () => { clearTimeout(ovT); ovT = setTimeout(() => { try { overlay(); } catch (e) { console.warn('прочность студии:', e); } }, 150); };
  function listen(on){
    for (const f of offEv) f?.(); offEv = [];
    const SC = ED()?.SC; if (!on || !SC?.on) return;
    offEv.push(SC.on('change', later), SC.on('add', later), SC.on('remove', later));
  }

  // ═══ Панель «🧱 Прочность» ═══
  const CSS = `.s3sp{position:absolute;z-index:7;top:48px;right:8px;width:300px;max-width:calc(100% - 16px);max-height:calc(100% - 64px);overflow:auto;padding:10px 12px 12px;border-radius:12px;background:#23252e;border:1px solid #4a4e5c;box-shadow:0 14px 34px rgba(0,0,0,.5);color:#e5e7eb;font:13px/1.4 system-ui,sans-serif}
.s3sp-head{display:flex;align-items:center;gap:6px;font-weight:800}.s3sp-head span{flex:1}.s3sp-head button{border:0;background:#383b48;color:#fff;border-radius:7px;padding:3px 8px;cursor:pointer}
.s3sp label{display:block;margin:6px 0}.s3sp select{width:100%;background:#2f323d;color:#e5e7eb;border:1px solid #4a4e5c;border-radius:7px;padding:4px}
.s3sp-leg{display:flex;flex-wrap:wrap;gap:4px 10px;margin:.5em 0}.s3sp-leg i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:4px;vertical-align:-1px}
.s3sp-sum{margin:.4em 0;padding:6px 8px;border-radius:8px;background:#1b2a3a;color:#e0f2fe}.s3sp-note{color:#9ca3af;font-size:11.5px;margin:.6em 0 0}`;
  function style(){ if (document.getElementById('s3sp-css')) return; const s = document.createElement('style'); s.id = 's3sp-css'; s.textContent = CSS; document.head.appendChild(s); }
  const opt = (v, t, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`;
  const hex = c => '#' + c.toString(16).padStart(6, '0');
  function render(){
    if (!box) return;
    const c = cfg();
    box.innerHTML = `<div class="s3sp-head"><span>🧱 Прочность построек</span><button type="button" data-a="close" aria-label="Закрыть">✕</button></div>
      <label>Обрушение<select data-k="mode">${opt('off', '⛔ Выкл — детали держатся где угодно', c.mode)}${opt('soft', '🏚 Мягкое — длинные балки без опор падают', c.mode)}${opt('real', '🏗 Реализм — опора важнее', c.mode)}</select></label>
      ${c.mode !== 'off' ? `<label><input type="checkbox" data-k="show"${c.show ? ' checked' : ''}> Показывать устойчивость цветом</label>
      <div class="s3sp-leg">${S.COLORS.map((col, i) => `<span><i style="background:${hex(col)}"></i>${esc(S.LEVEL_NAMES[i])}</span>`).join('')}</div>
      <div class="s3sp-sum" data-sum>…</div>` : ''}
      <p class="s3sp-note">Как в Valheim: на земле — синий, каждая деталь выше и вбок держится слабее (дерево — слабее, камень и бетон — крепче, металл — дальше всех вбок). В игре то, что не держится, падает настоящей физикой (детали становятся незакреплёнными); «■ Стоп» — мир как был. Материал прочности — у детали в «Свойствах» (⚓ Якорь — сама опора). Скрипты: <code>Support.Holds(part)</code>, <code>Support.Get(part)</code>, <code>Support.Break(part)</code>, <code>Support.Collapsed</code>.</p>`;
    later();
  }
  function put(k, v){
    const SC = ED()?.SC; if (!SC) return;
    SC.settings = SC.settings || {};
    const c = { ...cfg(), [k]: v };
    SC.settings.support = c.mode === 'off' ? { mode: 'off' } : { mode: c.mode, show: !!c.show };
    api?.markDirty?.(); api?.refresh?.();
  }
  function toggle(on){
    on = on ?? !box;
    if (!on) { box?.remove(); box = null; btn?.classList.remove('on'); listen(false); if (ov) ov.visible = false; return; }
    const host = api?.ed?.box; if (!host) return;
    style();
    box = document.createElement('div'); box.className = 's3sp'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Прочность построек');
    for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'contextmenu', 'keydown']) box.addEventListener(ev, e => e.stopPropagation());
    box.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    box.addEventListener('change', e => { const t = e.target, k = t.dataset?.k; if (!k) return; put(k, t.type === 'checkbox' ? t.checked : t.value); render(); });
    box.addEventListener('click', e => { if (e.target.closest('[data-a="close"]')) toggle(false); });
    host.appendChild(box); btn?.classList.add('on');
    listen(true); render();
  }
  const ext = {
    id: 'support',
    mount(a){
      api = a;
      const slot = a.slot; if (!slot || slot.querySelector('[data-s3sp]')) return;
      btn = document.createElement('button'); btn.type = 'button'; btn.dataset.s3sp = '1'; btn.title = 'Прочность построек: обрушение, подсветка устойчивости';
      btn.innerHTML = '🧱<span> Прочность</span>';
      btn.addEventListener('click', () => toggle());
      slot.appendChild(btn);
    },
    unmount(){ toggle(false); btn?.remove(); btn = null; if (ov) { ov.parent?.remove(ov); ov.geometry.dispose(); ov.material.dispose(); ov = null; } api = null; },
    play(){ if (ov) ov.visible = false; },
    stop(){ later(); },
    // свойство детали «Материал прочности» (только когда обрушение включено)
    propsHtml(h, o){
      if (!o || !(o.cls === 'Part' || o.cls === 'Spawn' || o.cls === 'Mesh') || cfg().mode === 'off' || typeof h !== 'string') return h;
      const sel = `<label class="s3-lbl">🧱 Материал прочности<select data-p="smat">${SMATS.map(([k, n]) => `<option value="${k}"${(o.smat || '') === k ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
      return h.includes('<!--s3x-->') ? h.replace('<!--s3x-->', () => sel + '<!--s3x-->') : h + sel;
    },
  };
  (E.studioExt = E.studioExt || []).push(ext);

  // ═══ Модуль игры: обрушение у того, кто считает мир (один или хозяин комнаты) ═══
  const pend = { full: false, gone: [] };
  let busy = false, offP = [], sendT = 0;
  const live = () => !!papi?.live?.();
  // сломали / убрали / открепили деталь — запомнить её коробку (граф «до» — с ней)
  const snap = o => ({ cls: o.cls, pos: o.pos.slice(), size: o.size.slice(), rot: (o.rot || [0, 0, 0]).slice(), mat: o.mat, smat: o.smat, anchored: true, id: o.id });
  function hook(){
    for (const f of offP) f?.(); offP = [];
    const SC = papi?.SC; if (!SC?.on) return;
    offP.push(SC.on('remove', o => { if (!busy && live() && cfg().mode !== 'off' && takes(o)) pend.gone.push(snap(o)); }));
    offP.push(SC.on('change', d => { const o = d?.obj; if (busy || !o || d.key !== 'anchored' || o.anchored !== false || !live() || cfg().mode === 'off') return; if ((o.cls === 'Part' || o.cls === 'Spawn' || o.cls === 'Mesh') && o.smat !== 'none') pend.gone.push(snap(o)); }));
  }
  // открепить (падает физикой) — то, что не держится
  function drop(list){
    const SC = papi.SC, out = [];
    if (!list.length) return out;
    window.D37E.rigid?.load?.();
    busy = true;
    try { for (const o of list) if (o && SC.get(o.id) && o.smat !== 'anchor') { SC.set(o, 'anchored', false); out.push(o.id); } } finally { busy = false; }
    return out;
  }
  function tell(fell){
    const L = lastBuild, Pm = P(cfg().mode), sup = {};
    if (L) for (let i = 0; i < L.list.length && i < 3000; i++) sup[L.list[i].id] = S.pct(B.g.sup[i], B.g.mat[i], Pm);
    for (const id of fell || []) sup[id] = 0;
    try { papi.scriptEvent('support', { mode: cfg().mode, sup, fell: fell || [] }); } catch (e) {}
  }
  function process(){
    const SC = papi?.SC, ed = papi?.ed; if (!SC || !ed) return;
    const mode = cfg().mode; if (mode === 'off') { pend.full = false; pend.gone.length = 0; return; }
    const Pm = P(mode), t0 = performance.now();
    let fell = [];
    if (pend.full) {   // старт игры: что не держится — сразу вниз
      pend.full = false; pend.gone.length = 0;
      const L = build(SC, ed.ph);
      B.solve(Pm);
      const bad = [];
      for (let i = 0; i < L.list.length; i++) if (B.g.sup[i] < Pm.min[B.g.mat[i]]) bad.push(L.list[i]);
      fell = drop(bad);
    } else if (pend.gone.length) {   // сломали опору: «до» — с ней, «после» — без неё
      const gone = pend.gone.splice(0);
      const L = build(SC, ed.ph, gone);
      const ld = !!cfg().load, ng = ld ? B.collapse2(Pm, L.broken) : B.collapse(Pm, L.broken), list = [], nOwn = L.list.length - gone.length;   // v2: с нагрузкой
      for (let k = 0; k < ng; k++) for (const i of B.groups(k)) if (i < nOwn) list.push(L.list[i]);
      // v2: раздавленные детали (их нет в группах) — тоже вниз (T-124: раньше перегруженная колонна оставалась стоять)
      const cr = ld ? B.g.L?.crushed : null; if (cr) for (let i = 0; i < nOwn; i++) if (cr[i] && !B.g.fall[i]) list.push(L.list[i]);
      fell = drop(list);
      if (fell.length) papi.print?.(`🧱 Обрушилось деталей: ${fell.length}`, 'sys');
    } else return;
    stats.solves++; stats.ms += performance.now() - t0; stats.fell += fell.length;
    tell(fell);
  }
  const stats = { solves: 0, ms: 0, fell: 0 };
  const play = {
    id: 'support',
    start(p){ papi = p; pend.full = false; pend.gone.length = 0; hook(); sendT = 0; },
    world(){ pend.full = true; },   // этот браузер считает мир — проверить всё при старте
    unworld(){ pend.full = false; pend.gone.length = 0; },
    step(){ if (!live() || cfg().mode === 'off') return; if (pend.full || pend.gone.length) process(); },
    // Support.Break(part) из скрипта: деталь ломается (пыль), что держалось через неё — падает
    cmd(d){
      if (d.t !== 'mode' || d.cmd !== 'support' || !live()) return;
      const SC = papi.SC, o = typeof d.id === 'string' ? SC.get(d.id) : null;
      if (d.op === 'break' && o && takes(o)) {
        try { const em = papi.ed?.FX?.emitter?.({ kind: 'smoke', at: o.pos.slice(), rate: 0, size: 1.2, color: '#a8a29e', color2: '#78716c' }); em?.burst?.(30); if (em) setTimeout(() => em.dispose?.(), 3000); } catch (e) {}
        SC.remove(o);
      }
    },
    stop(){ for (const f of offP) f?.(); offP = []; pend.full = false; pend.gone.length = 0; papi = null; },
  };
  (E.studioPlay = E.studioPlay || []).push(play);
  E.studioSupport = { ext, play, toggle: v => toggle(v), stats: () => ({ ...stats }), aabb, build: (SC, ph, extra) => build(SC, ph, extra), B, matOf, takes, SMATS };
})();
