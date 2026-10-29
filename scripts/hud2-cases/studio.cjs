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
  },
};
