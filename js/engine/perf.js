// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — счётчик производительности (F3) и замер (D37E.bench): FPS, время кадра, ЦП, вызовы отрисовки,
//  треугольники, память видеокарты, разрешение, лампы, тени + свои счётчики систем
// ═══════════════════════════════════════
// D37E.perf.toggle() или F3 — табличка поверх 3D. Выключена — не стоит ничего: R.render зовёт perf.frame только при perf.on.
// D37E.perf.stat('Название', () => значение) → функция «убрать» (склейка, сеть, физика — каждый добавляет своё).
// Замер (в консоли браузера): await D37E.bench.studio(2000) — в открытой «Студии 3D» добавляет 2000 деталей, предметов
// и ламп, меряет «как раньше» (склейка выключена) и «со склейкой»: вызовы отрисовки (сцена + тени + постобработка),
// треугольники, мс ЦП на кадр (среднее, 95%, худший), мс видеокарты (если браузер даёт таймер), потом всё убирает.
// await D37E.bench.world() — то же для открытого «Мира Денчика». Результат — console.table и объект.
(() => {
  const E = window.D37E = window.D37E || {};
  const P = E.perf = E.perf || { on: false };
  P.stats = P.stats || new Map();
  P.stat = (name, fn) => { P.stats.set(name, fn); return () => { if (P.stats.get(name) === fn) P.stats.delete(name); }; };
  let el = null, last = 0, shUpd0 = 0, shT0 = 0;
  const f1 = v => (Math.round(v * 10) / 10).toLocaleString('ru-RU'), k = v => v >= 1e6 ? f1(v / 1e6) + ' млн' : v >= 1e4 ? Math.round(v / 1e3) + ' тыс.' : String(v);
  function box(){
    if (el) return el;
    el = document.createElement('div');
    el.className = 'd37-perf';
    el.style.cssText = 'position:fixed;left:8px;top:64px;z-index:2147483000;pointer-events:none;font:12px/1.35 ui-monospace,Consolas,monospace;'   // ниже верхних панелей студии и мира
      + 'color:#e5f6ff;background:rgba(8,10,20,.78);padding:6px 9px;border-radius:8px;white-space:pre;box-shadow:0 2px 10px rgba(0,0,0,.4)';
    el.textContent = 'F3 · ждём кадр 3D…';
    document.body.appendChild(el);
    return el;
  }
  P.toggle = v => {
    P.on = v ?? !P.on;
    if (P.on) { box(); last = 0; } else { el?.remove(); el = null; }
    return P.on;
  };
  // Зовёт R.render после кадра (только когда табличка включена); текст — 4 раза в секунду
  P.frame = R => {
    const t = performance.now();
    if (t - last < 250) return;
    const S = R.stats, n = Math.max(1, S.frames), ms = S.sumDt / n, inf = R.r.info, D = R.dynRes, post = R.post;
    if (!last) { S.frames = S.sumDt = S.maxDt = S.sumCpu = S.maxCpu = S.sumR = 0; last = t; shUpd0 = R.shadow?.updates || 0; shT0 = t; return; }
    const shPerSec = R.shadow ? (R.shadow.updates - shUpd0) / ((t - shT0) / 1000) : 0;
    shUpd0 = R.shadow?.updates || 0; shT0 = t;
    const lines = [
      `FPS ${f1(1000 / ms)} · кадр ${f1(ms)} мс (худший ${f1(S.maxDt)})`,
      `ЦП: кадр ${f1(S.sumCpu / n)} мс (худший ${f1(S.maxCpu)}) · отрисовка ${f1(S.sumR / n)}`,
      `Вызовы: ${S.calls} (сцена ${S.scene - (S.shadowNow ? S.shadow : 0)} · тени ~${S.shadow} · пост ${S.post})`,
      `Треугольники: ${k(S.tris)}`,
      `Память: геометрий ${inf.memory.geometries} · текстур ${inf.memory.textures} · программ ${inf.programs?.length ?? '?'}`,
      `Разрешение: ${f1((D?.scale ?? 1) * 100)}% × ${f1(R.pr0 || 1)}${D && !D.on ? ' (ручное)' : ''}` + (post ? ` · ${post.msaa ? 'MSAA ' + post.msaa + '×' : ''}${post.fxaa ? (post.msaa ? ' + ' : '') + 'FXAA' : ''}${post.bloom.on ? ' · свечение' : ''}` : ' · без постобработки'),
      `Тени: ${R.shadow ? f1(shPerSec) + ' раз/с' : 'нет'} · лампы ${R.lights ? R.lights.lit + '/' + R.lights.list.length + ' (макс ' + R.lights.max + ')' : '—'} · качество ${R.q}`,
    ];
    for (const [name, fn] of P.stats) { let v; try { v = fn(); } catch (e) { v = '—'; } lines.push(`${name}: ${typeof v === 'number' ? f1(v) : v}`); }
    box().textContent = lines.join('\n');
    S.frames = S.sumDt = S.maxDt = S.sumCpu = S.maxCpu = S.sumR = 0;
    last = t;
  };
  window.addEventListener('keydown', e => {
    if (e.code !== 'F3' || e.repeat) return;
    e.preventDefault();   // иначе браузер открывает поиск по странице
    P.toggle();
  }, true);

  // ═══ Замер ═══
  const BN = E.bench = E.bench || {};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // таймер видеокарты (если браузер даёт EXT_disjoint_timer_query_webgl2)
  function gpuTimer(R){
    const gl = R.r.getContext(), ext = R.r.capabilities.isWebGL2 && gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return null;
    const qs = [];
    return {
      begin(){ const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); qs.push(q); },
      end(){ gl.endQuery(ext.TIME_ELAPSED_EXT); },
      async read(){
        const out = [];
        for (let tries = 0; tries < 200 && qs.length; tries++) {
          while (qs.length && gl.getQueryParameter(qs[0], gl.QUERY_RESULT_AVAILABLE)) { const q = qs.shift(); if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) out.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
          if (qs.length) await sleep(16);
        }
        for (const q of qs) gl.deleteQuery(q);
        qs.length = 0;
        return out;
      },
    };
  }
  const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0; };
  const r2 = v => Math.round(v * 100) / 100;
  // Кадры подряд: мс ЦП на R.render (+ видеокарта), вызовы отрисовки последнего кадра: всего = сцена + тени + постобработка.
  // shadows: true — тени каждый кадр (старый движок так и рисовал). Работает и на старом движке (без R.stats) — для «до».
  async function measure(R, label, frames = 60, shadows = false){
    const inf = R.r.info, auto0 = inf.autoReset;
    for (let i = 0; i < 8; i++) { R.shadowDirty?.(); R.render(); }   // прогрев: шейдеры, загрузка буферов
    await sleep(30);
    let main = 0;
    if (!R.stats) { inf.autoReset = true; R.render(); main = inf.render.calls; }   // старый движок: сцена без теней
    else { if (R.shadow) R.shadow.last = performance.now(); R.shadow && (R.shadow.dirty = false); R.render(); }   // кадр без теней — запомнить «сцену»
    const cpu = [], G = gpuTimer(R);
    let calls = 0, tris = 0, post = 0;
    inf.autoReset = false;
    for (let i = 0; i < frames; i++) {
      if (shadows) R.shadowDirty?.(); else if (R.shadow) R.shadow.last = performance.now();   // без страховки: тени только «по делу»
      inf.reset();
      G?.begin();
      const t0 = performance.now(); R.render(); cpu.push(performance.now() - t0);
      G?.end();
      calls = inf.render.calls; tris = inf.render.triangles;
      if (R.stats) { post = R.stats.post; main = R.stats.sceneNoSh || R.stats.scene; }
    }
    inf.autoReset = auto0;
    const gpu = G ? await G.read() : [];
    const avg = cpu.reduce((a, b) => a + b, 0) / cpu.length;
    return { 'замер': label, 'вызовы всего': calls, 'сцена': main, 'тени': Math.max(0, calls - main - post), 'пост': post, 'треуг.': tris,
      'ЦП мс': r2(avg), 'ЦП 95%': r2(pct(cpu, .95)), 'ЦП макс': r2(Math.max(...cpu)), 'видеокарта мс': gpu.length ? r2(gpu.reduce((a, b) => a + b, 0) / gpu.length) : '—' };
  }
  // Наполнение: детали разных форм и материалов, предметы, лампы — по кругу ~90 м
  const MATS = ['plastic', 'plastic', 'smooth', 'wood', 'brick', 'concrete', 'metal', 'neon', 'grass', 'marble', 'cobble', 'planks'];
  const COLORS = ['#f2f3f3', '#a3a2a5', '#635f62', '#c4281c', '#da8541', '#f5cd30', '#a4bd47', '#4b974b', '#0d69ac', '#6e99ca', '#6b327c', '#ff66cc', '#7c5c46', '#d7c59a'];
  const KINDS = ['tree', 'tree', 'pine', 'bush', 'rock', 'lamp', 'bench', 'fence', 'flowers', 'sign'];
  function fill(SC, n, seed, TR){
    const rnd = E.rng(seed || 37), pick = a => a[Math.floor(rnd() * a.length)], out = [];
    const ground = (x, z) => TR?.enabled ? TR.sample(x, z) : 0;
    const nl = Math.min(40, Math.round(n * .02)), np = Math.round(n * .18);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 88, x = Math.round(Math.cos(a) * d * 2) / 2, z = Math.round(Math.sin(a) * d * 2) / 2;
      let o;
      if (i < nl) o = SC.add('Light', { name: 'замер', pos: [x, ground(x, z) + 3 + rnd() * 3, z], color: pick(['#fff1c4', '#ffd27a', '#9ad7ff', '#ff9ad5']), range: 10 + Math.round(rnd() * 15), power: 1.5 + rnd() * 2 });
      else if (i < nl + np) o = SC.add('Prefab', { name: 'замер', kind: pick(KINDS), pos: [x, ground(x, z), z], rot: [0, Math.round(rnd() * 8) * 45, 0], text: 'Замер' });
      else {
        const u = rnd(), shape = u < .7 ? 'block' : u < .8 ? 'wedge' : u < .9 ? 'cyl' : 'ball';
        const size = shape === 'block' ? [1 + Math.round(rnd() * 7), .5 + Math.round(rnd() * 7) / 2, 1 + Math.round(rnd() * 7)] : shape === 'wedge' ? [4, 2, 4] : [2, 2, 2];
        o = SC.add('Part', { name: 'замер', shape, size, pos: [x, ground(x, z) + size[1] / 2 + (rnd() < .15 ? Math.round(rnd() * 6) : 0), z], rot: [0, rnd() < .25 ? Math.round(rnd() * 8) * 45 : 0, 0], color: pick(COLORS), mat: pick(MATS) });
      }
      out.push(o);
    }
    return out;
  }
  // В «Студии 3D»: n объектов, «как раньше» (без склейки) и «со склейкой»; тени — по делу и каждый кадр
  BN.studio = async (n = 2000, o = {}) => {
    const ed = window.GAME_IMPL?.studio3d?._test?.state?.();
    if (!ed?.SC || !ed.R) return 'Открой «Студию 3D» (#/games/studio3d) и дождись загрузки';
    if (ed.playing) return 'Сначала ■ Стоп';
    const { SC, R } = ed, BT = SC.batch, frames = o.frames || 60, rows = [];
    const dyn = R.dynRes, dynOn = dyn?.on;
    R.setRes?.(1);
    const t0 = performance.now(), list = fill(SC, n, o.seed, ed.TR), tFill = performance.now() - t0;
    try {
      if (BT) { BT.setEnabled(false); rows.push(await measure(R, `${n} — как раньше (отдельно)`, frames)); rows.push(await measure(R, `${n} — как раньше, тени каждый кадр`, frames, true)); BT.setEnabled(true); }
      const tb = performance.now(); BT?.flush(); const tBatch = performance.now() - tb;
      rows.push(await measure(R, `${n} — ${BT ? 'склейка' : 'этот движок'}`, frames));
      rows.push(await measure(R, `${n} — ${BT ? 'склейка' : 'этот движок'}, тени каждый кадр`, frames, true));
      const st = BT?.stats();
      console.table(rows);
      if (st) console.log('склейка:', st, `наполнение ${Math.round(tFill)} мс, первая склейка ${Math.round(tBatch)} мс`);
      return { rows, batch: st, fillMs: Math.round(tFill), batchMs: BT ? Math.round(tBatch) : null };
    } finally {
      if (o.keep !== true) for (const x of list) if (SC.get(x.id)) SC.remove(x);
      BT?.flush();
      if (dyn) dyn.on = dynOn;
    }
  };
  // Открытый «Мир Денчика»: кадры как есть и с тенями каждый кадр
  BN.world = async (o = {}) => {
    const S = window.GAME_IMPL?.world?._test?.state?.();
    if (!S?.R) return 'Открой «Мир Денчика» (#/games/world) в 3D';
    const R = S.R, dyn = R.dynRes, dynOn = dyn?.on;
    R.setRes?.(1);
    try {
      const rows = [await measure(R, 'мир', o.frames || 60), await measure(R, 'мир, тени каждый кадр', o.frames || 60, true)];
      console.table(rows);
      return { rows };
    } finally { if (dyn) dyn.on = dynOn; }
  };
})();
