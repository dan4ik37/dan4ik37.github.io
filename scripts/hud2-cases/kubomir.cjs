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
    async cross(T){
      await T.ev(`(() => { const t = ${T0}, S = t.state(); S.ui.close(); t.opts({ touchMode: 'cross' }); t.touchUI?.(); return 1; })()`);
      await T.sleep(1200);
    },
  },
};
