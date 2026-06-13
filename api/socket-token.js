// api/socket-token.js — токен для Centrifugo WebSocket
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://dan4ik37.vercel.app');

  const token = (req.headers.cookie||'').match(/da_token=([^;]+)/)?.[1];
  if (!token) return res.status(401).json({ error: 'not_authorized' });

  try {
    // Данные пользователя
    const ur = await fetch('https://www.donationalerts.com/api/v1/user/oauth', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const ud = await ur.json();
    const user = ud.data;
    if (!user) throw new Error('no user');

    // Подписка на Centrifugo канал
    const cr = await fetch('https://www.donationalerts.com/api/v1/centrifuge/subscribe', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channels: [{ channel: `$alerts:donation_${user.id}` }] }),
    });
    const cd = await cr.json();

    res.status(200).json({
      socket_token: user.socket_connection_token || '',
      channels:     cd.data?.channels || [],
    });
  } catch(e) {
    res.status(500).json({ error: 'server_error' });
  }
}
