// api/donations.js — топ донатеров и последние донаты
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://dan4ik37.vercel.app');

  const token = (req.headers.cookie||'').match(/da_token=([^;]+)/)?.[1];

  if (!token) {
    // Даём URL для авторизации.
    // БАГ (найден и исправлен): раньше client_id был захардкожен здесь как
    // '19366', а фронтенд (lbLogin()) отдельно хардкодил '19389' — два
    // разных значения в двух местах, легко разъехаться. Теперь оба места
    // (тут и в api/auth.js) читают ОДНУ и ту же переменную окружения —
    // единственный источник правды.
    const p = new URLSearchParams({
      client_id:     process.env.DA_CLIENT_ID,
      redirect_uri:  'https://dan4ik37.vercel.app/api/auth',
      response_type: 'code',
      scope:         'oauth-donation-index oauth-user-show oauth-donation-subscribe',
    });
    return res.status(401).json({
      error: 'not_authorized',
      auth_url: `https://www.donationalerts.com/oauth/authorize?${p}`,
    });
  }

  try {
    const r = await fetch('https://www.donationalerts.com/api/v1/alerts/donations', {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (r.status === 401) {
      return res.status(401).json({ error: 'token_expired', auth_url: null });
    }

    const data = await r.json();
    const donations = (data.data || []).map(d => ({
      id:       d.id,
      username: d.username || 'Аноним',
      amount:   parseFloat(d.amount) || 0,
      currency: d.currency || 'RUB',
      message:  d.message || '',
      created:  d.created_at,
    }));

    // Агрегируем топ по сумме
    const map = {};
    donations.forEach(d => {
      const k = d.username.toLowerCase();
      if (!map[k]) map[k] = { username: d.username, total: 0, count: 0, currency: d.currency };
      map[k].total += d.amount;
      map[k].count++;
    });
    const leaderboard = Object.values(map).sort((a,b) => b.total - a.total).slice(0, 20);

    res.status(200).json({ donations: donations.slice(0, 20), leaderboard });
  } catch(e) {
    res.status(500).json({ error: 'server_error' });
  }
}
