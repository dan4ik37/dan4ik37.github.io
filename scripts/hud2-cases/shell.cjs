// HUD 2.0 (T-123): шапка игры (#gamesStage) для scripts/hud2-e2e.cjs — обычная игра без своего меню («Клеточки», меню игры):
// в шапке ← · название · ☰ · ⛶; ☰ открывает пункты (📣 📖 🔊 ⚙️ 📱 ⛶ ←)
module.exports = {
  url: '/#/games/kletochki',
  ready: `document.querySelector('[data-io="bots"]')`,
  root: '#gamesStage', skip: '#gamesStageBox',
  caps: { P: 100, L: 100, PC: 100 },   // шапка — не окно игры: считаем кнопки, а не долю
  scenes: {
    async bar(T){
      const r = await T.ev(`[...document.querySelectorAll('#gamesStage .gm-stage-bar > *')].filter(e => { const q = e.getBoundingClientRect(); return q.width && getComputedStyle(e).display !== 'none'; }).map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 16))`);
      console.log('  шапка:', JSON.stringify(r));
    },
    async menu(T){
      const r = await T.ev(`(async () => { window.D37Shell?.menu(); await new Promise(r => setTimeout(r, 600)); const m = document.querySelector('.gs-menu'); const items = m ? [...m.querySelectorAll('.gs-menu-it')].map(b => b.textContent.trim().slice(0, 22)) : null; m?.querySelector('.gs-menu-it')?.click(); document.querySelector('.gs-menu')?.remove(); return items; })()`);
      console.log('  ☰:', JSON.stringify(r));
    },
  },
};
