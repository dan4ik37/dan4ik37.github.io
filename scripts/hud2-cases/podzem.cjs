// HUD 2.0 (T-123, сборка C): «Подземье» (/play/podzem) для scripts/hud2-e2e.cjs — экран игры в покое (подсказка ушла,
// кнопки побледнели), лоток вещей раскрыт (касание), окно «Вещи» (доля окна и закрыт ли герой), круг позы → сесть и лечь
const T0 = 'GAME_IMPL.podzem._test';
// герой на экране (px окна) и сколько его закрывает элемент sel (0…1)
const HERO = sel => `(() => { const G = ${T0}.G, p = G.pl, w = G.wrap.getBoundingClientRect(), t = G.cam.tile / G.res;
  const x = (p.x - G.cam.x) * t + w.width / 2, y = (p.y - G.cam.y) * t + w.height / 2, hw = p.w * t, hh = p.h * t;
  const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.hidden || !e.getClientRects().length) return { hero: [Math.round(x), Math.round(y)], covered: 0 };
  const r = e.getBoundingClientRect(), ix = Math.max(0, Math.min(w.left + x + hw, r.right) - Math.max(w.left + x, r.left)), iy = Math.max(0, Math.min(w.top + y + hh, r.bottom) - Math.max(w.top + y, r.top));
  return { hero: [Math.round(x), Math.round(y)], covered: +(ix * iy / (hw * hh)).toFixed(2), sheet: +(100 * r.width * r.height / (w.width * w.height)).toFixed(1) };
})()`;
module.exports = {
  url: '/#/games/podzem',
  // меню «Подземья» — «Играть» / «Быстрая игра», пока мир не пошёл
  ready: `(() => { const g = window.GAME_IMPL?.podzem?._test?.state?.(); if (g?.state === 'play') return true; document.querySelector('.pz-menu [data-a="quick"], .pz-menu [data-a="play"]:not([disabled])')?.click(); return false; })()`,
  root: '.pz-wrap', skip: '.pz-ko,.pz-load,.pz-menu,.pz-inv,.pz-goals',
  caps: { P: 12, L: 10, PC: 6 },   // §9.6
  ls: { d37_settings: JSON.stringify({ gfxPreset: 'mid', gfx: 'mid', autoLand: true }) },
  async prep(T){ await T.ev(`(() => { ${T0}.god(true); document.querySelectorAll('.age-sheet,#appCard,.apu,.apt,.notif-toast,.chat-toast').forEach(e => e.remove()); return 1; })()`); },
  scenes: {
    async 'idle-hud'(T){ await T.sleep(9000); },
    async tray(T){
      // свёрнутый лоток (2.0) — нажать, чтобы раскрыть; без лотка (старый экран) — панель как есть
      const r = await T.ev(`(() => { const t = document.querySelector('.pz-wrap .e2-tray'); if (!t) return 'нет лотка'; const b = t.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]; })()`);
      if (Array.isArray(r)) await T.touch(r[0], r[1]);
      await T.sleep(400);
      console.log('  лоток:', JSON.stringify(await T.ev(`(() => { const t = document.querySelector('.pz-wrap .e2-tray'); return t ? { open: t.classList.contains('open'), cells: [...t.children].filter(c => !c.hidden).length, w: Math.round(t.getBoundingClientRect().width) } : null; })()`)));
    },
    // палец: удержать кнопку позы → круг (ждёт нажатия) → «Сесть»; нажать кнопку позы — встать
    async 'pose-radial'(T){
      await T.sleep(3200);   // лоток свернулся сам
      const at = sel => T.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]; })()`);
      const pb = await at('.pz-touch [data-t="pose"]');
      if (!pb) { console.log('  круг позы: нет кнопки позы'); return; }
      await T.touch(pb[0], pb[1], 420);
      const it = await at('.pz-wrap > .e2-radial:not([hidden]) .e2-rad-it[aria-label="Сесть"]');
      const n = await T.ev(`document.querySelectorAll('.pz-wrap > .e2-radial:not([hidden]) .e2-rad-it').length`);
      if (it) await T.touch(it[0], it[1]);
      await T.sleep(400);
      const a1 = await T.ev(`${T0}.G.pl.anim`);
      await T.touch(pb[0], pb[1]);
      await T.sleep(400);
      console.log('  круг позы: пунктов', n, '· «Сесть» →', a1, '· кнопка позы →', await T.ev(`${T0}.G.pl.anim`));
    },
    async inv(T){
      await T.ev(`(() => { ${T0}.G.U.toggleInv(true); return 1; })()`);
      await T.sleep(700);
      console.log('  вещи:', JSON.stringify(await T.ev(HERO('.pz-inv'))));
      await T.ev(`(() => { ${T0}.G.U.toggleInv(false); return 1; })()`);
      await T.sleep(300);
    },
    async pose(T){
      const r = await T.ev(`(async () => { const A = GAME_IMPL.podzem.api, G = ${T0}.G; if (!A.pose) return 'нет позы'; const out = []; for (const k of ['sit', 'lie', 'crouch', 'wave']) { A.pose(k); await new Promise(r => setTimeout(r, 500)); out.push(k + '→' + G.pl.anim); } A.pose(null); await new Promise(r => setTimeout(r, 200)); out.push('встал→' + G.pl.anim); return out.join(' '); })()`);
      console.log('  поза:', r);
      // компьютер: G — круг позы посередине; Esc — закрыть
      if (T.prof === 'PC') console.log('  G:', await T.ev(`(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', key: 'g' })); await new Promise(r => setTimeout(r, 200)); const n = document.querySelectorAll('.pz-wrap > .e2-radial:not([hidden]) .e2-rad-it').length; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' })); await new Promise(r => setTimeout(r, 200)); return 'пунктов ' + n + ', после Esc открыт: ' + !!document.querySelector('.pz-wrap > .e2-radial:not([hidden])'); })()`));
    },
    // одно меню: ☰ «Подземья» — пункты игры и шапки (📣 📖 🔊 📱 ←), часы в заголовке
    async menu(T){
      const r = await T.ev(`(async () => { GAME_IMPL.podzem.api.pause(); await new Promise(r => setTimeout(r, 500)); const m = document.querySelector('.pz-wrap .gs-menu'); const out = m ? { head: m.querySelector('.gs-menu-head small')?.textContent?.slice(0, 40), items: [...m.querySelectorAll('.gs-menu-it')].map(b => b.textContent.trim().slice(0, 16)) } : null; GAME_IMPL.podzem.api.resume(); await new Promise(r => setTimeout(r, 300)); return out; })()`);
      console.log('  ☰:', JSON.stringify(r));
    },
  },
};
