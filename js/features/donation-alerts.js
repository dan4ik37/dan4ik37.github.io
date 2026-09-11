// ═══════════════════════════════════════
//  ЖИВЫЕ АЛЕРТЫ О ДОНАТЕ — Centrifugo WebSocket
//  api/socket-token.js существовал, но нигде не вызывался — мёртвый код.
//  Протокол подключения (donationalerts.com/apidoc#introduction__centrifugo):
//   1. GET /api/socket-token            -> socket_token
//   2. WS wss://centrifugo.donationalerts.com/connection/websocket
//      -> отправить {params:{token:socket_token}, id:1}
//      <- получить {result:{client:<uuid>}}
//   3. GET /api/socket-token?client=<uuid> -> channels:[{channel,token}]
//   4. Для каждого канала: {params:{channel,token}, method:1, id:2}
//   5. Слушать входящие сообщения с donation-данными
//
//  Работает ТОЛЬКО в сессии самого админа (нужна da_token-кука, которая
//  появляется только после его собственного входа через DonationAlerts) —
//  это личное уведомление "на второй монитор", а не алерт для всех
//  посетителей сайта: у serverless-функций Vercel нет способа держать
//  постоянное соединение и транслировать события всем разом без отдельного
//  постоянно работающего бэкенда.
// ═══════════════════════════════════════
let donationWS = null;
let donationWSReconnectTimer = null;
let donationMsgId = 1;
let donationBroadcastChannel = null;
let donationPendingIds = new Set(); // id'ы наших же запросов — чтобы отличать ответы на них от чужих push-событий
let lastShownDonationKey = null; // защита от повторного показа при переподключении (напр. при обновлении страницы)

function showDonationAlert(username, amount, currency, message){
  const el = document.getElementById('donationAlert');
  if (!el) return;
  document.getElementById('donationAlertTitle').innerHTML = `<strong>${esc(username||'Аноним')}</strong> задонатил ${Math.round(amount)} ${esc(currency||'RUB')}`;
  document.getElementById('donationAlertMsg').textContent = message || '';
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 6000);
  // Обновляем цифры на странице, раз уж знаем, что появился новый донат
  if (typeof loadGoalFromDA === 'function') loadGoalFromDA();
  if (document.getElementById('leaderboard')?.style.display !== 'none' && typeof loadLeaderboard === 'function') loadLeaderboard();
}

// ═══════════════════════════════════════
//  ПУБЛИЧНАЯ ТРАНСЛЯЦИЯ ВСЕМ ПОСЕТИТЕЛЯМ (Supabase Broadcast)
//  У serverless-функций Vercel нет способа держать одно соединение и
//  разослать событие разом всем — поэтому ретранслятором служит открытая
//  вкладка самого админа: когда ЕЙ приходит донат по Centrifugo, она
//  публикует его в Supabase (уже подключён для чата, тот же sbClient),
//  а оттуда его в реальном времени получают все остальные посетители.
//  Ограничение: работает, только пока у админа открыт сайт — например,
//  во время стрима. Постоянно живущего сервера для 24/7-ретрансляции нет.
// ═══════════════════════════════════════
function initPublicDonationBroadcastListener(){
  if (!sbClient || donationBroadcastChannel) return;
  donationBroadcastChannel = sbClient
    .channel('donation-alerts', { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'donation' }, (payload) => {
      const d = payload.payload || {};
      showDonationAlert(d.username, d.amount, d.currency, d.message);
    })
    .subscribe();
}
function broadcastDonationToVisitors(username, amount, currency, message){
  if (!donationBroadcastChannel) return;
  donationBroadcastChannel.send({ type: 'broadcast', event: 'donation', payload: { username, amount, currency, message } });
}

async function initDonationAlerts(){
  if (currentRole !== 'admin' || donationWS) return;
  try {
    const r = await fetch('/api/socket-token');
    if (r.status !== 200) return; // не DA-авторизован в этой сессии — тихо выходим
    const { socket_token } = await r.json();
    if (!socket_token) return;

    const ws = new WebSocket('wss://centrifugo.donationalerts.com/connection/websocket');
    donationWS = ws;

    ws.onopen = () => {
      const id = donationMsgId++;
      donationPendingIds.add(id);
      ws.send(JSON.stringify({ params: { token: socket_token }, id }));
    };

    ws.onmessage = async (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch(e) { return; }

      // БАГ (найден и исправлен): ответ Centrifugo на НАШУ ЖЕ команду
      // (handshake, подтверждение подписки) структурно похож на push-событие
      // доната — у обоих есть result.channel. Раньше код не различал их,
      // из-за чего подтверждение подписки принималось за донат: отсюда
      // "NaN RUB" (в подтверждении нет полей username/amount) и алерт при
      // каждом обновлении страницы (подписка подтверждается заново на
      // каждом новом подключении, это не значит, что пришёл новый донат).
      const isReplyToOwnRequest = msg.id && donationPendingIds.has(msg.id);
      if (isReplyToOwnRequest) donationPendingIds.delete(msg.id);

      // Ответ на шаг 1 (handshake) — получили client UUID, просим бэкенд
      // подписать нас на канал (шаг 2)
      if (isReplyToOwnRequest && msg.result?.client) {
        try {
          const r2 = await fetch('/api/socket-token?client=' + encodeURIComponent(msg.result.client));
          const d2 = await r2.json();
          (d2.channels || []).forEach(ch => {
            const id = donationMsgId++;
            donationPendingIds.add(id);
            ws.send(JSON.stringify({ params: { channel: ch.channel, token: ch.token }, method: 1, id }));
          });
        } catch(e) {}
        return;
      }
      if (isReplyToOwnRequest) return; // подтверждение подписки и т.п. — не донат, дальше не идём

      // Дальше — только настоящие асинхронные push от сервера (не ответы
      // на что-то, что отправляли мы сами)
      const donation = msg.result?.data?.data || msg.result?.data || msg.push?.pub?.data;
      const channel = msg.result?.channel || msg.push?.channel;
      if (!donation || !channel?.startsWith('$alerts:donation_')) return;

      // Доп. защита: показываем только если данные реально похожи на донат
      const amount = Number(donation.amount);
      if (!donation.username || !Number.isFinite(amount)) return;

      // Защита от повтора: Centrifugo может прислать последнее сообщение
      // канала заново при свежем подключении — не переалертить один и тот
      // же донат на каждом обновлении страницы
      const key = donation.id != null ? `id:${donation.id}` : `${donation.username}|${amount}|${donation.created_at||''}`;
      if (key === lastShownDonationKey) return;
      lastShownDonationKey = key;

      showDonationAlert(donation.username, amount, donation.currency, donation.message);
      broadcastDonationToVisitors(donation.username, amount, donation.currency, donation.message);
    };

    ws.onclose = () => {
      donationWS = null;
      // Переподключение с задержкой — админ может держать сайт открытым часами на стриме
      clearTimeout(donationWSReconnectTimer);
      donationWSReconnectTimer = setTimeout(initDonationAlerts, 10000);
    };
    ws.onerror = () => { try { ws.close(); } catch(e) {} };
  } catch(e) {
    // Нет сети/DA недоступен — просто не показываем живые алерты, это не критично
  }
}
