// ═══════════════════════════════════════
//  «МИР ДЕНЧИКА» — огонь в боевой зоне (T-022d, docs/PHYSICS_PLAN.md §4): ядро движка D37E.fire (детали) поверх разрушений
//  (D37E.destruct). Только боевая зона (12+): детский городок, столица, Большой город и природа — никогда
// ═══════════════════════════════════════
// Горит то, что в зоне ломается: деревья, ящики, заборы, скамейки, мешки, бочки (материал огня — по виду, KIND). Поджигают взрывы:
// хлопок разбитой машины (by: 'boom') и снаряды с разлётом (by: 'shot', урон ≥ 3) — у того, кто стрелял (он же «хозяин» удара);
// по сети — одно событие { k: 'fire', x, y, z, r, s, t } с зерном и номером такта огня: у всех то же поджигается и так же
// горит (случайность ядра — от места детали и номера такта, не от порядка, в каком зона строилась). Догорело — ломается путём
// разрушений (DS.breakId: дерево валится, ящик — на куски) без рассылки (у всех своё), через 5 минут — всё как было (как у
// разрушений), и снова может гореть. Бочка догорела — вспыхивает (поджигает рядом). Ветер и дождь — погода мира.
//   X = MirFire.attach(rt, { S, R, ph, zoneAt }) → { F, step(dt), frame(dt, t), remote(d), ignite(…), dispose(), stats }
(() => {
  const MF = window.MirFire = window.MirFire || {};
  MF.ON = true;   // откат одной строкой: false — огня в «Мире» нет
  const KIND = { tree: 'tree', pine: 'tree', crate: 'planks', fence: 'planks', bench: 'planks', prop: 'planks', sign: 'planks', bag: 'cloth', barrel: 'fuel' };
  const r2 = v => Math.round(v * 100) / 100;
  MF.attach = (rt, o) => {
    const E = window.D37E, FI = E?.fire, DS = rt.destruct;
    if (!MF.ON || !FI || !DS) return null;
    const { S, R, ph, zoneAt } = o;
    const zoneOf = (x, z) => zoneAt(x, z)?.id || null;
    const F = FI.parts({ hz: 10, cap: 512, parts: 4096, budget: 512, cell: 8, reach: 4.5, seed: 0x37f1e, onBurnt: p => burnt(p) });
    const PID = new Map(), BYP = [];
    let restoreWait = 0;   // сломанное горючее ждёт возврата (тогда снова может гореть)
    const X = { F, stats: { parts: 0, ignited: 0, burnt: 0, sent: 0, remote: 0, refused: 0 } };
    const war = b => (b.zone !== undefined && b.zone !== null ? b.zone : zoneOf(b.x, b.z)) === 'war';
    // горючее зоны — в ядро: центр (дерево — середина кроны), радиус (сколько места занимает), материал по виду
    function reg(b){
      if (!b || PID.has(b.id)) return;
      const k = KIND[b.kind]; if (!k || !war(b)) return;
      const tree = b.kind === 'tree' || b.kind === 'pine', h = b.h || (tree ? 7 : 1);
      const r = tree ? Math.max(.8, h * .2) : Math.max(.35, Math.max(b.w || .8, b.d || .4) * .5);
      const p = F.add(b.x, (b.y || 0) + h * (tree ? .55 : .5), b.z, r, FI.mat(k));
      if (p < 0) return;
      PID.set(b.id, p); BYP[p] = b; X.stats.parts++;
    }
    const add0 = DS.add, rem0 = DS.remove, hit0 = DS.hit, brk0 = DS.breakId;
    // сломали (взрыв, машина, чужое событие) — уже не горит и не загорится, пока не вернётся (slow: восстановилось — снова горючее)
    DS.breakId = (id, ...a) => { const r = brk0(id, ...a); if (r) { const p = PID.get(id); if (p !== undefined) { if (F.burning(p)) F.out(p); F.PB[p] = 1; restoreWait++; } } return r; };
    DS.add = b => { const r = add0(b); try { reg(b); } catch (e) { console.error(e); } return r; };
    DS.remove = id => { const p = PID.get(id); if (p !== undefined) { F.remove(p); PID.delete(id); BYP[p] = null; } return rem0(id); };
    // взрыв в боевой зоне — поджигает рядом (свой — рассылка события)
    DS.hit = (x, z, r, dmg = 1, hit = {}) => {
      const n = hit0(x, z, r, dmg, hit);
      if (hit && (hit.by === 'boom' || (hit.by === 'shot' && dmg >= 3)) && zoneOf(x, z) === 'war') {
        try { X.ignite(x, hit.y ?? groundY(x, z) + 1, z, Math.min(8, Math.max(3, r * 1.6)), (Math.random() * 1e9) >>> 0, true); } catch (e) { console.error(e); }   // жар — дальше разлёта: то, что уцелело рядом
      }
      return n;
    };
    for (const b of DS.list.values()) reg(b);   // что уже есть
    function groundY(x, z){ try { return ph?.groundAt ? ph.groundAt(x, z) : 0; } catch (e) { return 0; } }
    // поджечь в точке: рядом «ленивые» деревья — в ядро (удар без урона их подгружает), шанс — по расстоянию (ядро, igniteNear)
    let sendT = 0, sendN = 0;
    X.ignite = (x, y, z, r, seed, local) => {
      if (local) {   // не чаще 4 событий в секунду: лишнее не поджигаем вовсе (иначе у других было бы иначе)
        const t = performance.now(); if (t - sendT > 1000) { sendT = t; sendN = 0; }
        if (++sendN > 4) { X.stats.refused++; return 0; }
        rt.send({ k: 'fire', x: r2(x), y: r2(y), z: r2(z), r: r2(r), s: seed >>> 0, t: F.T }); X.stats.sent++;
        x = r2(x); y = r2(y); z = r2(z); r = r2(r);   // у себя — те же числа, что ушли в сеть
      }
      hit0(x, z, r + 4, 0);   // подгрузить деревья карты рядом (урона нет)
      let n = F.igniteNear(x, y, z, r, seed);
      if (!n) { const q = F.nearest(x, y, z, r); if (q >= 0 && F.ignite(q) >= 0) n = 1; }   // горючее в радиусе есть — хоть ближнее загорится (как от прямого попадания)
      X.stats.ignited += n;
      return n;
    };
    // событие другого игрока: в боевой зоне, разумные числа; ядро свободно — взять его номер такта (горит так же, как у него)
    X.remote = d => {
      const x = +d.x, y = +d.y, z = +d.z, r = +d.r;
      if (![x, y, z, r].every(Number.isFinite) || Math.abs(x) > 1e5 || Math.abs(z) > 1e5 || !(r > 0 && r <= 8) || zoneOf(x, z) !== 'war') return;
      if (!F.n && Number.isFinite(+d.t)) F.T = (+d.t) >>> 0;
      X.stats.remote++;
      X.ignite(x, y, z, r, (+d.s || 0) >>> 0, false);
    };
    // догорело: сломать путём разрушений (у всех своё, без рассылки); бочка — вспыхивает
    function burnt(p){
      const b = BYP[p]; if (!b) return;
      X.stats.burnt++;
      const s = FI.hash(F.PK[p], F.T, 0x6b, 0, 0) >>> 0, a = (s & 1023) / 1023 * Math.PI * 2;
      try { DS.breakId(b.id, s, Math.cos(a), Math.sin(a), true); } catch (e) { console.error(e); }
      if (b.kind === 'barrel') { F.igniteNear(b.x, (b.y || 0) + .5, b.z, 4.5, s); try { DS.burst?.('fire', b.x, (b.y || 0) + 1, b.z, 24); } catch (e) {} }
    }
    // шаг игры: такты ядра; раз в секунду — что восстановилось (снова может гореть), подгрузить деревья у огня, погода
    let slowT = 0, wxT = 0;
    X.step = dt => {
      if (!F.n && !restoreWait) return;
      F.step(dt);
      if ((slowT -= dt) <= 0) { slowT = 1; slow(); }
      if ((wxT -= dt) <= 0) { wxT = 5; const s = S.wx?.state; F.setWind(s ? +s.wind || 0 : 0, s ? +s.windDir || 0 : 0); F.setRain(s ? Math.min(1, +s.rain || 0) : 0); }
    };
    function slow(){
      restoreWait = 0;
      for (const [id, p] of PID) if (F.PB[p]) { if (!DS.broken.has(id)) F.restore(p); else restoreWait++; }
      for (let i = 0, k = 0; i < F.n && k < 8; i += Math.max(1, F.n >> 3), k++) { const p = F.X[F.ACT[i]]; hit0(F.PX[p], F.PZ[p], 8, 0); }   // деревья карты у огня
    }
    // ── картинка: пламя движка (fx.js FX.flames: языки, дым, угли, лампы), звук пожара ──
    let FL = null, snd = null, flOn = false;
    X.frame = (dt, t) => {
      if (!F.n) { if (flOn) { FL?.clear(); flOn = false; snd?.set({ vol: 0 }); } return; }
      if (!FL) { try { FL = S.FX?.flames?.({ lights: E.isMobile?.() ? 1 : 2 }) || null; } catch (e) { console.error(e); FL = null; } if (!FL) return; }
      flOn = true;
      const cam = R.camera.position, Q = FL.Q;
      FL.begin(cam); FL.dt = dt; FL.t = t;
      const ws = S.wx?.state; FL.windIn[0] = ws ? Math.cos(+ws.windDir || 0) * (+ws.wind || 0) : 0; FL.windIn[1] = ws ? Math.sin(+ws.windDir || 0) * (+ws.wind || 0) : 0;
      let nd = 1e9, nx = 0, ny = 0, nz = 0, near = 0;
      for (let i = 0; i < F.n; i++) {
        const s = F.ACT[i], p = F.X[s], b = BYP[p]; if (!b) continue;
        const dx = F.PX[p] - cam.x, dz = F.PZ[p] - cam.z, d2 = dx * dx + dz * dz; if (d2 > 25600) continue;   // дальше 160 — не видно
        const h = F.heat(s), sd = (F.PK[p] & 1023) / 1024, base = b.y || 0;
        if (d2 < nd) { nd = d2; nx = b.x; ny = base + 1; nz = b.z; } if (d2 < 900) near++;
        if (b.kind === 'tree' || b.kind === 'pine') {
          const H = b.h || 7, cr = F.PR[p];
          let q = FL.push(); if (q >= 0) { Q[q] = b.x; Q[q + 1] = base; Q[q + 2] = b.z; Q[q + 3] = .7 + .3 * h; Q[q + 4] = h; Q[q + 5] = sd; Q[q + 6] = .8; Q[q + 7] = 1.6; }
          q = FL.push(); if (q >= 0) { Q[q] = b.x; Q[q + 1] = base + H * .42; Q[q + 2] = b.z; Q[q + 3] = cr * (1 + .5 * h); Q[q + 4] = h; Q[q + 5] = (sd + .31) % 1; Q[q + 6] = 1; Q[q + 7] = 1.2; }
          if (h > .6) { q = FL.push(); if (q >= 0) { Q[q] = b.x + cr * .5; Q[q + 1] = base + H * .6; Q[q + 2] = b.z - cr * .4; Q[q + 3] = cr * .8; Q[q + 4] = h; Q[q + 5] = (sd + .62) % 1; Q[q + 6] = .6; Q[q + 7] = 1; } }
        } else {
          const q = FL.push(); if (q >= 0) { Q[q] = b.x; Q[q + 1] = base; Q[q + 2] = b.z; Q[q + 3] = Math.max(.5, F.PR[p] * 1.4); Q[q + 4] = h; Q[q + 5] = sd; Q[q + 6] = b.kind === 'barrel' ? 1 : .7; Q[q + 7] = 1; }
        }
      }
      FL.end();
      // звук: треск у ближнего очага, громче, когда горит много рядом
      const A = S.AU;
      if (A?.loop) {
        if (!snd) snd = A.loop(window.D37E?.synth?.NAMES?.includes('fire_roar') ? 'fire_roar' : 'amb_fire', { vol: 0 });
        const d = Math.sqrt(nd);
        snd?.set(d < 40 ? { x: nx, y: ny, z: nz, vol: Math.min(.6, .2 + near * .03) * (1 - d / 40) } : { vol: 0 });
      }
    };
    X.flames = () => FL;   // для замеров
    X.dispose = () => {
      DS.add = add0; DS.remove = rem0; DS.hit = hit0; DS.breakId = brk0;
      try { FL?.dispose(); } catch (e) {} FL = null;
      try { snd?.stop(); } catch (e) {} snd = null;
      PID.clear(); BYP.length = 0; F.reset();
    };
    return X;
  };
})();
