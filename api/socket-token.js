// api/socket-token.js — токен(ы) для Centrifugo WebSocket (живые алерты о донатах)
//
// БАГ (найден и исправлен): подписка на приватный канал ($alerts:donation_<id>)
// по официальному протоколу DonationAlerts требует параметр client —
// UUIDv4, который Centrifugo выдаёт ТОЛЬКО ПОСЛЕ того, как фронтенд уже
// открыл WebSocket-соединение и представился туда socket_connection_token'ом
// (см. donationalerts.com/apidoc#introduction__centrifugo, шаги 1 и 2).
// Раньше этот эндпоинт пытался подписаться на канал сразу одним запросом,
// без client — DonationAlerts на такой запрос отвечает ошибкой, подписка
// физически не может произойти в один шаг. Теперь эндпоинт работает в
// два режима:
//   GET /api/socket-token             -> { socket_token } (шаг 1)
//   GET /api/socket-token?client=UUID -> { channels }      (шаг 2, после WS)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://dan4ik37.vercel.app');

  const token = (req.headers.cookie || '').match(/da_token=([^;]+)/)?.[1];
  if (!token) return res.status(401).json({ error: 'not_authorized' });

  try {
    // Данные пользователя + socket_connection_token — нужны в любом случае
    const ur = await fetch('https://www.donationalerts.com/api/v1/user/oauth', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const ud = await ur.json();
    const user = ud.data;
    if (!user) throw new Error('no user');

    const { client } = req.query;

    if (!client) {
      // Шаг 1: только connection-токен, чтобы фронтенд открыл WebSocket
      return res.status(200).json({ socket_token: user.socket_connection_token || '' });
    }

    // Шаг 2: фронтенд уже подключился и получил client UUID от Centrifugo —
    // теперь можно по-настоящему подписаться на канал донатов
    const cr = await fetch('https://www.donationalerts.com/api/v1/centrifuge/subscribe', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channels: [`$alerts:donation_${user.id}`],
        client,
      }),
    });
    const cd = await cr.json();
    if (!cd.channels) throw new Error(JSON.stringify(cd));

    res.status(200).json({ channels: cd.channels });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
}
