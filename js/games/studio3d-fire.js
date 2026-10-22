// ═══════════════════════════════════════
//  «СТУДИЯ 3D» — огонь (T-022d, docs/PHYSICS_PLAN.md §4): ядро движка D37E.fire (детали) в мирах игроков. Расширение
//  D37E.studioExt (свойства детали «Горючее» и «Горит»), модуль игры D37E.studioPlay 'fire' (считает тот, кто считает мир;
//  скрипты Fire.*); studio3d.js не трогает
// ═══════════════════════════════════════
// Деталь горит по своему материалу огня: свойство burn — '' (по материалу вида: дерево — как бревно, доски — как доски, ткань,
// трава…), none (не горит), wood | planks | leaves | grass | cloth | fuel. Свойство fire — '' (нет), start (загорится при ▶),
// eternal (вечный огонь: горит и не сгорает — костёр, факел). В игре огонь перекидывается на горючее рядом (ветер погоды мира —
// дальше), под водой гаснет; почерневшее темнеет; сгоревшее исчезает (Destroy) — что на нём держалось, обрушится (прочность
// построек — своим путём, studio3d-support.js). Стоять в огне — больно. Гостям — картинка: горящие детали помечены свойством
// onfire (1…3, по сети как другие свойства), пламя каждый рисует сам; считает хозяин (или один игрок).
// Скрипты (у того, кто считает мир): Fire.Ignite(part), Fire.Extinguish(part), Fire.IsBurning(part), Fire.Count;
// события Fire.Ignited(part), Fire.Burnt(part), Fire.Extinguished(part). «■ Стоп» — мир как был.
(() => {
  const E = window.D37E = window.D37E || {};
  const FI = E.fire;
  if (!FI) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // материал огня по материалу вида (scene.js MATS): горит то, что горит в жизни
  const BY_MAT = { wood: 'wood', planks: 'planks', fabric: 'cloth', grass: 'grass' };
  const BURNS = [['', '🔄 По материалу вида'], ['none', '🚫 Не горит'], ['wood', '🪵 Дерево (бревно)'], ['planks', '🟫 Доски'], ['leaves', '🍃 Листва'], ['grass', '🌾 Трава'], ['cloth', '🧶 Ткань'], ['fuel', '🛢️ Горючее (вспыхивает)']];
  const FIRES = [['', '— Нет'], ['start', '🔥 Загорится при ▶'], ['eternal', '♾ Вечный огонь (не сгорает)']];
  const burnKey = o => { if (o.burn === 'none') return ''; if (o.burn && FI.MAT[o.burn] !== undefined && o.burn !== 'none') return o.burn; return BY_MAT[o.mat] || ''; };
  const takes = o => (o.cls === 'Part' || o.cls === 'Mesh') && Array.isArray(o.pos) && Array.isArray(o.size);
  const eternal = o => o.fire === 'eternal' || o.onfire === 9;   // по сети идёт только onfire (предел своих свойств net.js)
  const radiusOf = o => .5 * Math.sqrt((o.size[0] * o.size[0] + o.size[1] * o.size[1] + o.size[2] * o.size[2]) / 3);
  let papi = null;

  // ═══ Редактор: свойства детали «Горючее» и «Горит» ═══
  const ext = {
    id: 'fire',
    mount(){}, unmount(){},
    propsHtml(h, o){
      if (!o || !takes(o) || typeof h !== 'string') return h;
      const auto = BY_MAT[o.mat], sel = `<label class="s3-lbl">🔥 Горючее<select data-p="burn">${BURNS.map(([k, n]) => `<option value="${k}"${(o.burn || '') === k ? ' selected' : ''}>${esc(k === '' ? n + (auto ? ' — горит' : ' — не горит') : n)}</option>`).join('')}</select></label>`
        + `<label class="s3-lbl">🔥 Горит<select data-p="fire">${FIRES.map(([k, n]) => `<option value="${k}"${(o.fire || '') === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
      return h.includes('<!--s3x-->') ? h.replace('<!--s3x-->', () => sel + '<!--s3x-->') : h + sel;
    },
  };
  (E.studioExt = E.studioExt || []).push(ext);

  // ═══ Модуль игры ═══
  const live = () => !!papi?.live?.();
  let F = null, offs = [], busy = false;
  const PID = new Map(), BYP = [];   // id детали → номер в ядре и обратно
  const EV = { ign: [], out: [], burnt: [] }, NOBURN = new Set();   // NOBURN — негорючее, подожжённое скриптом: погаснет, не исчезнет
  const stats = { parts: 0, ignited: 0, burnt: 0, eternal: 0 };
  function reg(o){
    if (!takes(o) || PID.has(o.id)) return;
    const k = burnKey(o); if (!k) return;
    const p = F.add(o.pos[0], o.pos[1], o.pos[2], radiusOf(o), FI.mat(k)); if (p < 0) return;
    PID.set(o.id, p); BYP[p] = o; stats.parts++;
  }
  function unreg(id){ const p = PID.get(id); if (p === undefined) return; F.remove(p); PID.delete(id); BYP[p] = null; }
  function setOnfire(o, v){ if (!o || (o.onfire | 0) === v) return; busy = true; try { papi.SC.set(o, 'onfire', v); } finally { busy = false; } }
  function hook(){
    for (const f of offs) f?.(); offs = [];
    const SC = papi?.SC; if (!SC?.on) return;
    offs.push(SC.on('add', o => { if (F && live()) reg(o); }));
    offs.push(SC.on('remove', o => { if (F) unreg(o.id); }));
    offs.push(SC.on('change', d => {
      const o = d?.obj; if (!F || busy || !o || !live()) return;
      const p = PID.get(o.id);
      if (d.key === 'pos' && p !== undefined) F.move(p, o.pos[0], o.pos[1], o.pos[2]);
      else if (d.key === 'mat' || d.key === 'burn' || d.key === 'size') { unreg(o.id); reg(o); }
    }));
  }
  const water = () => { const W = papi?.ed?.TR?.water; return W && W.on ? +W.level || 0 : -Infinity; };
  function world(){
    const SC = papi?.SC; if (!SC) return;
    F = FI.parts({ hz: 15, cap: 1024, parts: 4096, budget: 512, cell: 8, reach: 3, seed: 0x5f1e,
      onIgnite: p => { const o = BYP[p]; if (o) { EV.ign.push(o.id); stats.ignited++; } },
      onBurnt: p => burnt(p), onOut: p => { const o = BYP[p]; if (o) EV.out.push(o.id); },
      onChar: p => { const o = BYP[p]; if (o && !eternal(o) && !NOBURN.has(o.id)) { busy = true; try { SC.set(o, 'color', darker(o.color)); } finally { busy = false; } } },
    });
    PID.clear(); BYP.length = 0; stats.parts = stats.ignited = stats.burnt = 0;
    for (const o of SC.all()) reg(o);
    for (const o of SC.all()) if (o.fire === 'start' || eternal(o) || o.onfire > 0) { const p = PID.get(o.id); if (p !== undefined) F.ignite(p, 0, { force: true }); }   // onfire — новый хозяин: горело у прежнего
  }
  function darker(c){ const v = parseInt(String(c || '#888888').replace('#', ''), 16) || 0x888888; const k = .32, r = (v >> 16 & 255) * k + 26, g = (v >> 8 & 255) * k + 20, b = (v & 255) * k + 16; return '#' + ((r << 16 | g << 8 | b) >>> 0).toString(16).padStart(6, '0'); }
  // догорело: вечный — загорается снова; остальное — исчезает (Destroy: прочность построек обрушит то, что держалось на нём)
  function burnt(p){
    const o = BYP[p]; if (!o) return;
    if (eternal(o)) { stats.eternal++; F.ignite(p, 0, { force: true }); return; }
    if (NOBURN.has(o.id)) { NOBURN.delete(o.id); EV.out.push(o.id); return; }   // негорючее догорело — просто погасло
    stats.burnt++; EV.burnt.push(o.id);
    const SC = papi.SC;
    try { const em = papi.ed?.FX?.emitter?.({ kind: 'smoke', at: o.pos.slice(), rate: 0, size: 1.1, color: '#57534e', color2: '#292524' }); em?.burst?.(16); if (em) setTimeout(() => em.dispose?.(), 3000); } catch (e) {}
    if (SC.get(o.id)) SC.remove(o);
  }
  // события — скриптам (раз в шаг, пачкой) и пометка onfire (картинка у гостей)
  function flush(){
    if (!EV.ign.length && !EV.out.length && !EV.burnt.length) return;
    const SC = papi.SC;
    for (const id of EV.ign) { const o = SC.get(id); setOnfire(o, o && eternal(o) ? 9 : 2); }   // 9 — вечный (новый хозяин узнает по сети)
    for (const id of EV.out) setOnfire(SC.get(id), 0);
    const burning = {}; for (let i = 0; i < F.n && i < 2000; i++) { const o = BYP[F.X[F.ACT[i]]]; if (o) burning[o.id] = 1; }
    try { papi.scriptEvent('fire', { ign: EV.ign.slice(0, 500), out: EV.out.slice(0, 500), burnt: EV.burnt.slice(0, 500), burning }); } catch (e) {}
    EV.ign.length = 0; EV.out.length = 0; EV.burnt.length = 0;
  }
  let slowT = 0, hurtT = 0;
  function slow(){
    const lv = water(), st = E.studioWeather?.X?.()?.state;
    F.setWind(st ? +st.wind || 0 : 0, st ? +st.windDir || 0 : 0); F.setRain(st ? Math.min(1, +st.rain || 0) : 0);
    if (lv > -Infinity) for (let i = F.n - 1; i >= 0; i--) { const p = F.X[F.ACT[i]], o = BYP[p]; if (o && o.pos[1] < lv) F.out(p); }   // под водой — гаснет
  }
  // ── картинка: пламя движка (fx.js FX.flames) у всех — по свойству onfire; стоять в огне — больно ──
  let FL = null, flOn = false, scanT = 0;
  const SEEN = [];
  function scan(SC){ SEEN.length = 0; for (const o of SC.all()) if (o.onfire > 0 && takes(o)) SEEN.push(o); }
  function frame(dt){
    const ed = papi?.ed, SC = papi?.SC; if (!ed || !SC) return;
    if ((scanT -= dt) <= 0) { scanT = .25; scan(SC); }
    if (!SEEN.length) { if (flOn) { FL?.clear(); flOn = false; } return; }
    if (!FL) { try { FL = ed.FX?.flames?.({ lights: E.isMobile?.() ? 1 : 2 }) || null; } catch (e) { FL = null; } if (!FL) return; }
    flOn = true;
    const R = ed.R, cam = R.camera.position, Q = FL.Q, t = performance.now() / 1000;
    FL.begin(cam); FL.dt = dt; FL.t = t;
    const st = E.studioWeather?.X?.()?.state; FL.windIn[0] = st ? Math.cos(+st.windDir || 0) * (+st.wind || 0) : 0; FL.windIn[1] = st ? Math.sin(+st.windDir || 0) * (+st.wind || 0) : 0;
    const me = papi.pl?.P?.ch;
    let hot = false;
    for (const o of SEEN) {
      if (!SC.get(o.id)) continue;
      // языки — вдоль длинной стороны (поворот на 90° по Y — стороны меняются местами), у высокой детали — ещё по середине лица
      const ry = Math.round(((o.rot?.[1] || 0) % 180 + 180) % 180 / 90) === 1, sx = ry ? o.size[2] : o.size[0], sy = o.size[1], sz = ry ? o.size[0] : o.size[2];
      const top = o.pos[1] + sy / 2, along = sx >= sz, L = Math.max(sx, sz), n = Math.min(5, Math.max(1, Math.round(L / 1.6))), fs = Math.min(2.6, Math.max(.7, .35 * L / n + .2 * sy + .25));
      const sd = ((o.id.charCodeAt(0) * 31 + o.id.charCodeAt(o.id.length - 1) * 7) % 97) / 97, heat = o.onfire >= 3 ? 1 : .85;
      for (let k = 0; k < n; k++) {
        const u = n > 1 ? (k / (n - 1) - .5) * L * .8 : 0, mid = sy > 2.5 && (k & 1);
        const q = FL.push(); if (q < 0) break;
        Q[q] = o.pos[0] + (along ? u : 0); Q[q + 1] = mid ? o.pos[1] - sy * .1 : top - Math.min(.4, sy * .3); Q[q + 2] = o.pos[2] + (along ? 0 : u);
        Q[q + 3] = mid ? fs * .8 : fs; Q[q + 4] = heat; Q[q + 5] = (sd + k * .37) % 1; Q[q + 6] = mid ? .4 : .8; Q[q + 7] = 1.2;
      }
      if (me && !hot) { const dx = me.x - o.pos[0], dz = me.z - o.pos[2]; if (Math.abs(dx) < sx / 2 + .9 && Math.abs(dz) < sz / 2 + .9 && me.y > o.pos[1] - sy / 2 - 1 && me.y < top + 2.2) hot = true; }
    }
    FL.end();
    if (hot && (hurtT -= dt) <= 0) { hurtT = .5; try { papi.hurt?.(6); } catch (e) {} }
  }
  const play = {
    id: 'fire',
    start(p){ papi = p; F = null; EV.ign.length = EV.out.length = EV.burnt.length = 0; SEEN.length = 0; scanT = 0; hurtT = 0; hook(); },
    world(){ world(); },   // этот браузер считает мир
    unworld(){ F = null; PID.clear(); BYP.length = 0; },
    step(dt){ if (!F || !live()) return; F.step(dt); if ((slowT -= dt) <= 0) { slowT = 1; slow(); } flush(); },
    frame(dt){ try { frame(dt); } catch (e) { console.warn('огонь студии:', e); } },
    // Fire.* из скриптов: зажечь, потушить, зажечь в точке
    cmd(d){
      if (d.t !== 'mode' || d.cmd !== 'fire' || !F || !live()) return;
      const o = typeof d.id === 'string' ? papi.SC.get(d.id) : null;
      if (d.op === 'ignite' && o) { if (!PID.has(o.id) && takes(o)) { const k = burnKey(o) || 'flame'; if (!burnKey(o)) NOBURN.add(o.id); const pp = F.add(o.pos[0], o.pos[1], o.pos[2], radiusOf(o), FI.mat(k)); if (pp >= 0) { PID.set(o.id, pp); BYP[pp] = o; } } const p = PID.get(o.id); if (p !== undefined) { F.restore(p); F.ignite(p, 0, { force: true }); } }
      else if (d.op === 'out' && o) { const p = PID.get(o.id); if (p !== undefined) F.out(p); }
      else if (d.op === 'at' && Array.isArray(d.pos) && d.pos.length === 3 && d.pos.every(Number.isFinite)) F.igniteNear(d.pos[0], d.pos[1], d.pos[2], Math.max(.5, Math.min(12, +d.r || 3)), (+d.s || 7) >>> 0);
    },
    stop(){ for (const f of offs) f?.(); offs = []; try { FL?.dispose(); } catch (e) {} FL = null; flOn = false; F = null; PID.clear(); BYP.length = 0; SEEN.length = 0; NOBURN.clear(); papi = null; },
  };
  (E.studioPlay = E.studioPlay || []).push(play);
  E.studioFire = { ext, play, burnKey, takes, BURNS, FIRES, stats: () => ({ ...stats, burning: F ? F.n : 0 }), core: () => F };
})();
