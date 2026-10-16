// ═══════════════════════════════════════
//  СООБЩЕСТВА 2 (community2.sql) — поверх community.js (D37DS) и ленты msgview.js:
//  «Денчик-бот» и «📢 новости» сервера «Денчик37» (сам бот — api/push-check.js).
//  Грузится вместе с community.js (phone.js → MODS.ds). Пока community2.sql не выполнен — «появится, когда сайт обновится».
// ═══════════════════════════════════════
(() => {
  const P = window.D37Phone, MV = window.MsgView, DS = window.D37DS;
  if (!P || !MV || !DS) return;
  DS.x = DS.x || {};
})();
