// HUD 2.0 (T-123, сборка C): «Орда» для scripts/hud2-e2e.cjs — забег в покое (подпись управления — один раз на устройство)
module.exports = {
  url: '/#/games/horde',
  // «▶ Играть» — пока не пошёл забег (холст поля виден, экран игры не спрятан)
  ready: `(() => { const h = document.querySelector('.hd-hud'), c = document.querySelector('.hd-cv'); if (h && !h.hidden && c && c.getClientRects().length && !document.querySelector('.hd [data-act="play"]')) return true; document.querySelector('.hd [data-act="play"]')?.click(); return false; })()`,
  root: '.hd-wrap', skip: '.hd-ov',
  caps: { P: 15, L: 12, PC: 6 },
  scenes: {
    async 'idle-play'(T){
      await T.sleep(6000);
      console.log('  подпись:', JSON.stringify(await T.ev(`(() => { const n = document.querySelector('.hd-note'); return n && !n.hidden && n.getClientRects().length ? Math.round(n.getBoundingClientRect().height) + ' px' : 'нет'; })()`)),
        '· в забеге:', await T.ev(`!document.querySelector('.hd [data-act="play"]') && !document.querySelector('.hd-hud').hidden`));
    },
  },
};
