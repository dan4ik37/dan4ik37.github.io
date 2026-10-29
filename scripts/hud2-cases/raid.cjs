// HUD 2.0 (T-123, сборка C): «Набег» (обучение) для scripts/hud2-e2e.cjs — бой в покое: панель отрядов, подсказка
module.exports = {
  url: '/#/games/raid',
  ready: `(() => { try { if (GAME_IMPL.raid._test.state().bt && document.querySelector('.rdCv')) return true; } catch (e) {} const t = document.querySelector('.rd-grid [data-a="tut"]'); if (t) t.click(); else document.querySelector('.rd [data-a="hub"]')?.click(); return false; })()`,
  root: '.rd-field',
  caps: { P: 25, L: 22, PC: 15 },   // §2.2: стратегия
  scenes: { async 'idle-battle'(T){ await T.sleep(3500); } },
};
