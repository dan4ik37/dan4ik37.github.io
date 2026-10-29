// HUD 2.0 (T-123, сборка C): «Арена» против бота для scripts/hud2-e2e.cjs — окно игры = вся «Арена» (.ar: счёт + поле);
// в логе — поле (размер и доля экрана) и видна ли подпись управления
module.exports = {
  url: '/#/games/arena',
  ready: `(() => { if (document.querySelector('.ar-cv')) return true; document.querySelector('[data-act="bot"]')?.click(); return false; })()`,
  root: '.ar', skip: '.ar-ov',
  caps: { P: 15, L: 12, PC: 6 },
  scenes: {
    async 'idle-play'(T){
      await T.sleep(6000);
      console.log('  поле:', JSON.stringify(await T.ev(`(() => { const w = document.querySelector('.ar-wrap'); if (!w) return { нет: location.hash, menu: !!document.querySelector('[data-act="bot"]'), ov: document.querySelector('.ar-ov')?.textContent?.slice(0, 60) }; const r = w.getBoundingClientRect(), n = document.querySelector('.ar .ct-note'); return { w: Math.round(r.width), h: Math.round(r.height), share: +(100 * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * r.width / (innerWidth * innerHeight)).toFixed(1), note: !!(n && !n.hidden && n.getClientRects().length) }; })()`)));
    },
  },
};
