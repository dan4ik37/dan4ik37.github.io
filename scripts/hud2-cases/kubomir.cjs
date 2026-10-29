// HUD 2.0 (T-123, docs/HUD_V2.md §9.5): «Кубомир» для scripts/hud2-e2e.cjs — новый мир «Выживание» (мирно, дальность 4) с вещами в
// панели; сцены: покой (подсказка ушла, кнопки побледнели), вид сзади, лоток раскрыт, круг вещей (удержать лоток), круг позы (удержать ⬇),
// сесть, лечь (поза world3d 13), окно вещей (лист: доля окна), режим «прицел» (⛏ и 🧱). Без интерфейса 2.0 (старая копия сайта, SITE_DIR)
// сцены 2.0 просто снимают то, что есть.
const T0 = 'GAME_IMPL.kubomir._test';
const tray = `(() => { const r = document.querySelector('.kb-hrow .kb-slot.on')?.getBoundingClientRect(); return r ? [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] : null; })()`;
const poseBtn = `(() => { const r = document.querySelector('.kb-tbtn[data-id="pose"]:not([hidden])')?.getBoundingClientRect(); return r && r.width ? [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] : null; })()`;
const hold = async (T, xy, ms) => { await T.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: xy[0], y: xy[1], id: 1, radiusX: 4, radiusY: 4 }] }); await T.sleep(ms); await T.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await T.sleep(120); };
module.exports = {
  url: '/#/games/kubomir',
  ready: `document.querySelector('.kb-menu [data-m="new"]')`,
  root: '.kb-wrap',
  extra: '.kb-top *',
  skip: '.kb-screen,.kb-inv',
  caps: { P: 10, L: 8, PC: 6 },   // §9.5 цели «Кубомира»
  // по обстановке — общие пределы §2.2 (лоток раскрыт 3 с, «прицел» — режим для опытных, лист открыт — под ним не меряем);
  // круг — на миг, его не меряют (§2.2), только снимок
  sceneCaps: { 'tray-open': { P: 15, L: 12, PC: 6 }, cross: { P: 15, L: 12, PC: 6 }, inv: { P: 15, L: 12, PC: 6 }, wheel: { P: 60, L: 60, PC: 60 }, 'pose-radial': { P: 60, L: 60, PC: 60 } },
  ls: { d37_kb_opt: JSON.stringify({ rd: 4 }) },
  async prep(T){
    for (let i = 0; i < 20; i++) { if (await T.ev(`(() => { if (document.querySelector('[data-f="seed"]')) return true; document.querySelector('.kb-menu [data-m="new"]')?.click(); return !!document.querySelector('[data-f="seed"]'); })()`)) break; await T.sleep(300); }
    await T.sleep(400);
    await T.ev(`(() => { const s = document.querySelector('[data-f="seed"]'); if (s) s.value = 't123'; document.querySelector('[data-f="mode"] [data-v="survival"]')?.click(); document.querySelector('[data-f="diff"] [data-v="peaceful"]')?.click(); document.querySelector('[data-n="go"]')?.click(); return 1; })()`);
    let up = false; for (let i = 0; i < 240 && !up; i++) { await T.sleep(500); up = await T.ev(`!!(${T0}?.state()?.ready)`, 3000).catch(() => false); }
    if (!up) throw new Error('kubomir world did not open');
    await T.ev(`(async () => { const t = ${T0}, S = t.state(); S.R.lighting.time = 11; for (const s of [{ id: 'planks_oak', n: 32 }, { id: 'torch', n: 16 }, { id: 'cobble', n: 20 }, { id: 'apple', n: 5 }, { id: 'bed', n: 1 }, { id: 'stick', n: 8 }]) t.give(s); S.P.sel = 1; document.querySelectorAll('.age-sheet,#appCard,.apu,.apt,.notif-toast,.chat-toast').forEach(e => e.remove()); await new Promise(r => setTimeout(r, 1500)); return 1; })()`, 20000);
  },
  thrash: ['third'],
  scenes: {
    async idle(T){ await T.sleep(9000); },   // подсказка (6 с) ушла, кнопки побледнели (4 с) — покой
    // KB_PERF=1: кадр в покое (телефон — ЦП ×4): медиана и 95 % промежутка кадров, скрипт / стили / раскладка на кадр
    async perf(T){
      if (!process.env.KB_PERF) return;
      const m = async () => Object.fromEntries((await T.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
      for (const walk of [false, true]) {
        if (walk) await T.ev(`(() => { const S = ${T0}.state(); S.C.press('forward', true); return 1; })()`);
        const a = await m();
        const fr = await T.ev(`(async () => { const d = []; let p = performance.now(); await new Promise(r => { const f = t => { d.push(t - p); p = t; if (d.length < 240) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); d.sort((x, y) => x - y); return [d[d.length >> 1], d[Math.floor(d.length * .95)], d.length]; })()`, 90000);
        const b = await m(), per = k => ((b[k] - a[k]) * 1000 / fr[2]).toFixed(2);
        if (walk) await T.ev(`(() => { const S = ${T0}.state(); S.C.press('forward', false); return 1; })()`);
        console.log(`  кадр ${walk ? 'идёт' : 'стоит'}: ${fr[0].toFixed(1)} / ${fr[1].toFixed(1)} мс (медиана / 95 %) · скрипт ${per('ScriptDuration')} · стили ${per('RecalcStyleDuration')} · раскладка ${per('LayoutDuration')} мс/кадр`);
      }
    },
    async third(T){ await T.ev(`(() => { ${T0}.cam(1); return 1; })()`); await T.sleep(3500); },   // всплывашка «🎥 Вид сзади» ушла
    async 'tray-open'(T){
      if (T.P.mobile) { const xy = await T.ev(tray); if (xy) await T.touch(xy[0], xy[1]); }
      await T.sleep(400);
      console.log('  лоток раскрыт:', await T.ev(`!!document.querySelector('.kb-hrow.kb-open')`));
    },
    async wheel(T){
      await T.sleep(3300);   // лоток свернулся сам (3 с)
      if (!T.P.mobile) return;
      const xy = await T.ev(tray); if (xy) await hold(T, xy, 600);
      console.log('  круг вещей:', await T.ev(`(() => { const r = document.querySelector('.kb-wrap .e2-radial:not([hidden])'); return r ? r.querySelectorAll('.e2-rad-it').length + ' пунктов, картинок ' + r.querySelectorAll('.kb-radimg').length : 'нет'; })()`));
    },
    async 'pose-radial'(T){
      await T.sleep(3300);   // круг вещей закрылся сам (3 с)
      if (T.P.mobile) { const xy = await T.ev(poseBtn); if (xy) await hold(T, xy, 500); }
      else await T.ev(`(() => { const S = ${T0}.state(); S.K?.press?.('pose', true); return 1; })()`);
      await T.sleep(200);
      console.log('  круг позы:', await T.ev(`(() => { const r = document.querySelector('.kb-wrap .e2-radial:not([hidden])'); return r ? [...r.querySelectorAll('.e2-rad-it')].map(b => b.textContent).join(' ') : 'нет'; })()`));
      if (!T.P.mobile) await T.ev(`(() => { const S = ${T0}.state(); S.K?.press?.('pose', false); return 1; })()`);
    },
    async sit(T){
      await T.sleep(3300);
      const r = await T.ev(`(async () => { const t = ${T0}; t.pose?.('sit'); await new Promise(r => setTimeout(r, 900)); const a = t.state().A.get('me'); return t.poseCur?.() + ' · человечек: поза ' + a?.ch?.cat + ' · кнопка ' + (document.querySelector('.kb-tbtn[data-id="pose"]')?.firstChild?.textContent || '—'); })()`);
      console.log('  сесть →', r);
    },
    async lie(T){
      const r = await T.ev(`(async () => { const t = ${T0}; t.pose?.('lie'); await new Promise(r => setTimeout(r, 1200)); const a = t.state().A.get('me'); return t.poseCur?.() + ' · человечек: ' + (a?.ch?.cat === 13 ? 'лежит (13)' : 'поза ' + a?.ch?.cat); })()`);
      console.log('  лечь →', r);
    },
    async inv(T){
      await T.ev(`(() => { const t = ${T0}; t.pose?.('lie'); t.cam(0); t.state().ui.open('inv'); return 1; })()`);
      await T.sleep(700);
      console.log('  окно вещей:', await T.ev(`(() => { const w = document.querySelector('.kb-wrap').getBoundingClientRect(), p = document.querySelector('.kb-inv .kb-panel')?.getBoundingClientRect(); if (!p) return 'нет'; const a = Math.max(0, Math.min(p.right, w.right) - Math.max(p.left, w.left)) * Math.max(0, Math.min(p.bottom, w.bottom) - Math.max(p.top, w.top)); const sc = document.querySelector('.kb-inv .kb-panel'); return 'лист ' + (100 * a / (w.width * w.height)).toFixed(1) + '% окна · ' + Math.round(p.width) + '×' + Math.round(p.height) + ' · прокрутка ' + (sc.scrollHeight > sc.clientHeight + 2 ? 'есть' : 'нет') + ' · вкладки: ' + [...document.querySelectorAll('.kb-stabs button')].map(b => b.textContent).join(' / '); })()`));
    },
    // KB_LEAK=1: 20 кругов интерфейса 2.0 (лоток, круг, лист с вкладками, сесть / встать) и 20 раз мир закрыть / открыть — узлы,
    // слушатели, память (ЦП без замедления)
    async leak(T){
      if (!process.env.KB_LEAK) return;
      await T.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const heap = () => T.ev(`(async () => { for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise(r => setTimeout(r, 250)); } return performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null; })()`, 30000);
      const cnt = async () => { const h = await heap(); const d = await T.send('Memory.getDOMCounters'); return { nodes: d.nodes, listeners: d.jsEventListeners, mb: h }; };
      const ui = n => T.ev(`(async () => { const t = ${T0}, w = ms => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < ${'${n}'}; i++) { const S = t.state(); t.tray?.(true); await w(20); t.tray?.(false); S.ui.open('inv'); await w(20); for (const b of document.querySelectorAll('.kb-stabs button')) { b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await w(10); } S.ui.close(); t.pose?.('sit'); await w(20); t.pose?.('sit'); const R = S.rad; if (R) { R.open([{ id: 1, icon: 'a' }, { id: 2, icon: 'b' }], null, {}); R.close(true); } } return 1; })()`.replace('${n}', String(n)), 180000);
      const world = n => T.ev(`(async () => { const t = ${T0}; let ok = 0; for (let i = 0; i < ${'${n}'}; i++) { const id = t.state().meta.id; await t.stop(); await new Promise(r => setTimeout(r, 200)); t.play(id); for (let k = 0; k < 150; k++) { await new Promise(r => setTimeout(r, 400)); if (t.state()?.ready) break; } if (t.state()?.ready) ok++; } return ok; })()`.replace('${n}', String(n)), 900000);
      await ui(3); const a0 = await cnt(); await ui(20); const a1 = await cnt();
      console.log('  утечки, 20 кругов (лоток, круг, лист, сесть):', JSON.stringify(a0), '→', JSON.stringify(a1));
      await world(2); const b0 = await cnt(); const n = await world(20); await T.sleep(2000); const b1 = await cnt();
      console.log(`  утечки, мир закрыть / открыть ${n} из 20:`, JSON.stringify(b0), '→', JSON.stringify(b1));
      if (T.P.mobile) await T.send('Emulation.setCPUThrottlingRate', { rate: T.P.cpu });
    },
    async cross(T){
      if (!T.P.mobile) return;   // «прицел» — режим телефона
      await T.ev(`(() => { const t = ${T0}, S = t.state(); S.ui.close(); t.opts({ touchMode: 'cross' }); t.touchUI?.(); return 1; })()`);
      await T.sleep(1200);
    },
  },
};
