// HUD 2.0 (T-123, сборка C): io-игры для scripts/hud2-e2e.cjs — «Клеточки» с ботами (по умолчанию), IO_GAME=chervyachki —
// «Червячки», IO_GAME=evo — «Путь клетки» (одиночная игра в луже). Сцена: игра в покое (8 с), таблица лидеров свёрнута
const G = process.env.IO_GAME || 'kletochki';
const DEF = {
  kletochki: { url: '/#/games/kletochki', btn: '[data-io="bots"]', ready: 'GAME_IMPL.kletochki?._test?.S?.W' },
  chervyachki: { url: '/#/games/chervyachki', btn: '[data-io="bots"]', ready: 'GAME_IMPL.chervyachki?._test?.S?.W' },
  evo: { url: '/#/games/kletochki/evo', btn: '[data-io="evplay"][data-b="pool"][data-m="bots"]', ready: 'GAME_IMPL.kletochki?._test?.S?.W?.evo' },
}[G];
module.exports = {
  url: DEF.url,
  ready: `(() => { if (window.${DEF.ready}) return true; document.querySelector(${JSON.stringify(DEF.btn)})?.click(); return false; })()`,
  root: '.io-wrap', skip: '.io-ov',
  caps: { P: 9, L: 9, PC: 6 },   // §9.7
  scenes: {
    async 'idle-play'(T){
      await T.sleep(8000);
      console.log('  ' + G + ' таблица:', JSON.stringify(await T.ev(`(() => { const l = document.querySelector('.io-lb'); if (!l) return null; const r = l.getBoundingClientRect(); return { rows: l.children.length, w: Math.round(r.width), h: Math.round(r.height) }; })()`)));
    },
  },
};
