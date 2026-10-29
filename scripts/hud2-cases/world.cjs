// HUD 2.0 (T-123): «Мир Денчика» для scripts/hud2-e2e.cjs — лобби (в покое), большой город, боевая зона (после плашки зоны)
const W = 'GAME_IMPL.world._test.state()';
const clean = `document.querySelectorAll('.age-sheet,#appCard,.apu,.apt,.notif-toast,.chat-toast,.wld-panel').forEach(e => e.remove())`;
module.exports = {
  url: '/#/games/world',
  ready: `window.GAME_IMPL?.world?._test?.state()?.zones?.wmv`,
  root: '.wld-wrap', extra: '.wld-top, .wld-top *', skip: '.wld-pop,.wld-panel,.mp',
  caps: { P: 8, L: 6, PC: 4 },   // §9.2: цели «Мира» (меньше общего предела)
  ls: { d37_mir_pos: '' },
  async prep(T){
    await T.ev(`(() => { localStorage.removeItem('d37_mir_pos'); const A = window.D37Age; if (A) { A.known = () => true; A.canOpen = () => true; A.allows = () => true; A.group = () => 'adult'; } ${W}.fixedTime = 13; return 1; })()`);
  },
  scenes: {
    async 'idle-hub'(T){ await T.ev(`(async () => { ${clean}; await new Promise(r => setTimeout(r, 8000)); return 1; })()`, 30000); },
    async city(T){ await T.ev(`(async () => { const z = ${W}.zones, zs = z.zoneState('metro'); if (zs && !zs.ready) await z.buildNow(zs); z.padGo('metro'); await new Promise(r => setTimeout(r, 7000)); ${clean}; return 1; })()`, 120000); },
    async 'idle-war'(T){
      await T.ev(`(async () => { const S = ${W}, z = S.zones, C = MirWar.CENTER, zs = z.zoneState('war'); if (!zs.ready) await z.buildNow(zs);
        S.P.place((C.x0 + C.x1) / 2, MirZones.terrain((C.x0 + C.x1) / 2, C.z0 + 4) + .4, C.z0 + 4, 0);
        for (let i = 0; i < 60 && !(document.querySelector('.mz-war') && !document.querySelector('.mz-war').hidden); i++) await new Promise(r => setTimeout(r, 150));
        await new Promise(r => setTimeout(r, 5000)); ${clean}; return 1; })()`, 120000);
    },
  },
};
