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
//
// Плюс та же авто-обновляемость токена, что и в donations.js — иначе через
// 24 часа (когда протухнет da_token) живые алерты бы просто тихо отвалились.
async function refreshToken(refreshTok) {
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     process.env.DA_CLIENT_ID,
    client_secret: process.env.DA_CLIENT_SECRET,
    refresh_token: refreshTok,
  });
  const r = await fetch('https://www.donationalerts.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const t = await r.json();
  return t.access_token ? t : null;
}
function setAuthCookies(res, t, fallbackRefresh) {
  res.setHeader('Set-Cookie', [
    `da_token=${t.access_token}; HttpOnly; Secure; SameSite=Lax; Max-Age=86400; Path=/`,
    `da_refresh=${t.refresh_token || fallbackRefresh}; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000; Path=/`,
  ]);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://dan4ik37.vercel.app');

  const cookies = req.headers.cookie || '';
  let token = cookies.match(/da_token=([^;]+)/)?.[1];
  const refreshTok = cookies.match(/da_refresh=([^;]+)/)?.[1];
  if (!token && !refreshTok) return res.status(401).json({ error: 'not_authorized' });

  try {
    // Данные пользователя + socket_connection_token — нужны в любом случае
    let ur = token
      ? await fetch('https://www.donationalerts.com/api/v1/user/oauth', {
          headers: { 'Authorization': `Bearer ${token}` },
        })
      : { status: 401 };

    if (ur.status === 401) {
      if (!refreshTok) return res.status(401).json({ error: 'not_authorized' });
      const t = await refreshToken(refreshTok);
      if (!t) return res.status(401).json({ error: 'not_authorized' });
      setAuthCookies(res, t, refreshTok);
      token = t.access_token;
      ur = await fetch('https://www.donationalerts.com/api/v1/user/oauth', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (ur.status === 401) return res.status(401).json({ error: 'not_authorized' });
    }

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
