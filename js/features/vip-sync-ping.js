// ═══════════════════════════════════════════════════════════════════
//  «Пинг» серверной синхронизации донатов → VIP
//
//  Начисление VIP делает сервер (api/vip-sync.js), но Vercel Hobby умеет
//  запускать cron лишь раз в сутки. Чтобы донат превращался в VIP за минуты,
//  а не за сутки, любой открытый сайт раз в несколько минут «стучится» в этот
//  эндпоинт. Он ничего не принимает от клиента и сам ограничивает частоту
//  (замок в БД, не чаще раза в 2 минуты), поэтому безопасно, сколько бы людей
//  ни было на сайте. Работает и для гостей — VIP-статус зависит только от
//  донатов, а не от того, кто открыл страницу.
// ═══════════════════════════════════════════════════════════════════
(function vipSyncPing(){
  'use strict';
  const KEY = 'd37_vipsync_at';
  const EVERY = 5 * 60 * 1000;

  async function ping(){
    if (document.hidden) return;
    try {
      const last = Number(localStorage.getItem(KEY)) || 0;
      if (Date.now() - last < EVERY) return;       // эта вкладка/браузер уже стучались недавно
      localStorage.setItem(KEY, String(Date.now()));
    } catch(e) { /* приватный режим без localStorage — стучимся при каждом вызове таймера */ }

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);   // никогда не вешаем сайт на медленном ответе
    try {
      await fetch('/api/vip-sync', { method: 'POST', keepalive: true, signal: ctl.signal });
    } catch(e) { /* сервер недоступен — не страшно, стукнемся в следующий раз */ }
    finally { clearTimeout(timer); }
  }

  setTimeout(ping, 4000);                              // не мешаем первой отрисовке
  setInterval(ping, EVERY + 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
})();
