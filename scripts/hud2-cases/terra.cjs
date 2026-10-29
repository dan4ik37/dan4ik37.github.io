// HUD 2.0 (T-123): «Терра» (/play/terra) для scripts/hud2-e2e.cjs — пешком (в покое) и в полёте
module.exports = {
  url: '/#/games/terra',
  ready: `window.GAME_IMPL?.terra?._test?.S?.TS`,
  root: '.tr-wrap',
  caps: { P: 9, L: 7, PC: 6 },   // §9.4
  scenes: {
    async 'idle-walk'(T){ await T.sleep(9500); },   // подсказка (8 с) ушла, кнопки побледнели (4 с) — покой
    async fly(T){ await T.ev(`(() => { GAME_IMPL.terra._test.fly(true); return 1; })()`); await T.sleep(1500); },
  },
};
