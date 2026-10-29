// HUD 2.0 (T-123): «Терра» (/play/terra) для scripts/hud2-e2e.cjs — пешком (в покое), сесть и лечь (круг позы → player.js
// sitHere / lieHere, поза «лежит» world3d 13), в полёте
const S = 'GAME_IMPL.terra._test.S';
module.exports = {
  url: '/#/games/terra',
  ready: `window.GAME_IMPL?.terra?._test?.S?.TS`,
  root: '.tr-wrap',
  caps: { P: 9, L: 7, PC: 6 },   // §9.4
  scenes: {
    async 'idle-walk'(T){ await T.sleep(9500); },   // подсказка (8 с) ушла, кнопки побледнели (4 с) — покой
    async sit(T){
      const r = await T.ev(`(async () => { const P = ${S}.Pl; P.sitHere([]); await new Promise(r => setTimeout(r, 900)); return P.mode + (P.seat?.lie ? ':lie' : ''); })()`);
      console.log('  сесть на землю →', r);
    },
    async lie(T){
      const r = await T.ev(`(async () => { const P = ${S}.Pl; P.standUp(); await new Promise(r => setTimeout(r, 400)); P.lieHere([]); await new Promise(r => setTimeout(r, 1200)); const a = ${S}.A.get('me'); return P.mode + (P.seat?.lie ? ':lie' : '') + ' · человечек: ' + (a?.ch?.cat === 13 ? 'лежит (13)' : 'поза ' + a?.ch?.cat); })()`);
      console.log('  лечь →', r);
    },
    async fly(T){ await T.ev(`(() => { ${S}.Pl.standUp(); GAME_IMPL.terra._test.fly(true); return 1; })()`); await T.sleep(1500); },
  },
};
