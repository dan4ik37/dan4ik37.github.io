// api/donations.js — топ донатеров и последние донаты
//
// БАГ (найден и исправлен): da_refresh-кука сохранялась при входе, но нигде
// не использовалась. da_token живёт 24 часа — после этого приходилось
// заново проходить весь OAuth руками. Теперь при протухшем токене сначала
// пробуем обновиться по refresh_token и только если это тоже не выйдет —
// просим войти заново.
import { storeConfigured, sbSelect } from './_lib/store.js';

// Снимок, который раз в несколько минут обновляет api/vip-sync.js. Отдаём его,
// когда у посетителя нет своей сессии DonationAlerts — то есть ВСЕМ, кроме владельца.
// Раньше публичный «Топ донатеров» требовал, чтобы каждый посетитель сам вошёл в
// DonationAlerts (и увидел бы там уже свои, а не стримера, данные).
async function readSnapshot() {
  if (!storeConfigured()) return null;
  try {
    const rows = await sbSelect('vip_sync_state', 'id=eq.1&select=snapshot,snapshot_at');
    return rows[0]?.snapshot ? { data: rows[0].snapshot, at: rows[0].snapshot_at } : null;
  } catch (e) { return null; }
}
function sendSnapshot(res, snap) {
  const ageMin = (Date.now() - Date.parse(snap.at)) / 60000;
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  return res.status(200).json({ ...snap.data, source: 'server', updated_at: snap.at, stale: ageMin > 30 });
}

function authUrl() {
  const p = new URLSearchParams({
    client_id:     process.env.DA_CLIENT_ID,
    redirect_uri:  'https://dan4ik37.vercel.app/api/auth',
    response_type: 'code',
    scope:         'oauth-donation-index oauth-user-show oauth-donation-subscribe',
  });
  return `https://www.donationalerts.com/oauth/authorize?${p}`;
}

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
  res.setHeader('Cache-Control', 'private, no-store');   // ответы по cookie владельца не кэшируем

  // Ссылка для входа владельца (кнопка в админ-статусе синхронизации) — без данных
  if (req.query?.login === '1') {
    if (!process.env.DA_CLIENT_ID) return res.status(500).json({ error: 'env_missing' });
    return res.status(200).json({ auth_url: authUrl() });
  }

  const cookies = req.headers.cookie || '';
  let token = cookies.match(/da_token=([^;]+)/)?.[1];
  const refreshTok = cookies.match(/da_refresh=([^;]+)/)?.[1];

  if (!token && !refreshTok) {
    const snap = await readSnapshot();
    if (snap) return sendSnapshot(res, snap);
    return res.status(401).json({ error: 'not_authorized', reason: 'no_session', auth_url: authUrl() });
  }

  if (!process.env.DA_CLIENT_ID || !process.env.DA_CLIENT_SECRET) {
    return res.status(500).json({ error: 'env_missing', reason: 'Задай DA_CLIENT_ID и DA_CLIENT_SECRET в настройках Vercel' });
  }

  try {
    let r = token
      ? await fetch('https://www.donationalerts.com/api/v1/alerts/donations', {
          headers: { 'Authorization': `Bearer ${token}` },
        })
      : { status: 401 };

    if (r.status === 401) {
      if (!refreshTok) {
        const snap = await readSnapshot();
        if (snap) return sendSnapshot(res, snap);
        return res.status(401).json({ error: 'not_authorized', auth_url: authUrl() });
      }
      const t = await refreshToken(refreshTok);
      if (!t) {
        // refresh_token тоже не сработал (например, отозван) — сначала пробуем снимок
        const snap = await readSnapshot();
        if (snap) return sendSnapshot(res, snap);
        return res.status(401).json({ error: 'not_authorized', reason: 'session_expired', auth_url: authUrl() });
      }
      setAuthCookies(res, t, refreshTok);
      token = t.access_token;
      r = await fetch('https://www.donationalerts.com/api/v1/alerts/donations', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (r.status === 401) {
        const snap = await readSnapshot();
        if (snap) return sendSnapshot(res, snap);
        return res.status(401).json({ error: 'not_authorized', auth_url: authUrl() });
      }
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
    // DonationAlerts недоступен — лучше показать последний снимок, чем ошибку
    const snap = await readSnapshot();
    if (snap) return sendSnapshot(res, snap);
    res.status(500).json({ error: 'server_error' });
  }
}
