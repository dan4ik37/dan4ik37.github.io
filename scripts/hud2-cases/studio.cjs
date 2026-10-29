// HUD 2.0 (T-123): «Студия 3D» в игре (▶ Играть) для scripts/hud2-e2e.cjs
module.exports = {
  url: '/#/games/studio3d',
  ready: `window.GAME_IMPL?.studio3d?._test?.state()?.R`,
  root: '[data-hud2-root]', extra: '.s3-top, .s3-top *',
  async prep(T){
    await T.ev(`(async () => { const ED = GAME_IMPL.studio3d._test.state(); ED.R.r.domElement.parentElement.setAttribute('data-hud2-root', '1'); document.querySelector('.s3-play')?.click(); await new Promise(r => setTimeout(r, 3500)); return !!ED.playing; })()`, 60000);
  },
  scenes: {
    async 'idle-play'(T){ await T.sleep(9500); },   // кнопки побледнели (4 с) — покой
    // ☰ в игре виден и под пальцем — он (на телефоне .s3-compact прятал его, css/studio3d-x.css — T-123 fix 3); нажал — меню
    async menu(T){
      const m = await T.ev(`(() => { const e = document.querySelector('.s3-e2menu'); if (!e) return 'нет ☰'; const q = e.getBoundingClientRect(), cs = getComputedStyle(e);
        if (cs.display === 'none' || !q.width) return '☰ скрыт (display ' + cs.display + ')'; if (q.left < 0 || q.right > innerWidth || q.top < 0) return '☰ за краем экрана';
        const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); if (!(hit === e || e.contains(hit))) return '☰: под пальцем не он, а ' + String(hit?.className || hit?.tagName);
        return [Math.round(q.left + q.width / 2), Math.round(q.top + q.height / 2)]; })()`);
      if (typeof m === 'string') throw new Error('«Студия 3D» в игре: ' + m);
      if (T.P.mobile) await T.touch(m[0], m[1], 70); else await T.ev(`(() => { document.querySelector('.s3-e2menu').click(); return 1; })()`);
      await T.sleep(800);
      const items = await T.ev(`[...document.querySelectorAll('.gs-menu .gs-menu-it')].filter(b => b.getClientRects().length).map(b => b.textContent.trim().slice(0, 18))`);
      console.log('  ☰ (1 нажатие):', JSON.stringify(items));
      await T.ev(`(() => { GAME_IMPL.studio3d._test.state().e2m?.close(); return 1; })()`); await T.sleep(400);
      if (!items.some(t => /Телефон/.test(t)) || !items.some(t => /Выйти/.test(t))) throw new Error('«Студия 3D» в игре: в ☰ нет 📱 или «Выйти»: ' + JSON.stringify(items));
    },
  },
};
