// api/donations.js — топ донатеров и последние донаты
//
// БАГ (найден и исправлен): da_refresh-кука сохранялась при входе, но нигде
// не использовалась. da_token живёт 24 часа — после этого приходилось
// заново проходить весь OAuth руками. Теперь при протухшем токене сначала
// пробуем обновиться по refresh_token и только если это тоже не выйдет —
// просим войти заново.
import { storeConfigured, sbSelect, sbRpc } from './_lib/store.js';

// Снимок, который раз в несколько минут обновляет api/vip-sync.js. Отдаём его,
// когда у посетителя нет своей сессии DonationAlerts — то есть ВСЕМ, кроме владельца.
// Раньше публичный «Топ донатеров» требовал, чтобы каждый посетитель сам вошёл в
// DonationAlerts (и увидел бы там уже свои, а не стримера, данные).
// "С какой даты копится шкала цели" — из site_config (key='goal', поле since).
// Без настроенного Supabase или пока admin ничего не сохранял — считаем всю
// историю донатов (goal_progress сам подставит свой дефолт).
async function goalSince() {
  if (!storeConfigured()) return null;
  try {
    const rows = await sbSelect('site_config', `key=eq.goal&select=value`);
    const cfg = rows[0]?.value ? JSON.parse(rows[0].value) : null;
    return cfg?.since || null;
  } catch (e) { return null; }
}

// Сколько реально собрано на цель — ВСЕГДА из постоянного журнала vip_donation_log
// (api/vip-sync.js), а не из того, что случайно попало в текущий ответ DA.
// БАГ (найден и исправлен): раньше это на клиенте суммировалось из последних
// ≤20 донатов, показанных на странице — после 20-го доната сумма переставала
// расти и даже уменьшалась, когда старые донаты вымывались из окна новыми.
async function goalData() {
  if (!storeConfigured()) return null;
  try {
    const since = await goalSince();
    const g = await sbRpc('goal_progress', since ? { p_since: since } : {});
    return g ? { raised: Number(g.raised) || 0, since: g.since } : null;
  } catch (e) { return null; }
}

async function readSnapshot() {
  if (!storeConfigured()) return null;
  try {
    const rows = await sbSelect('vip_sync_state', 'id=eq.1&select=snapshot,snapshot_at');
    return rows[0]?.snapshot ? { data: rows[0].snapshot, at: rows[0].snapshot_at } : null;
  } catch (e) { return null; }
}
async function sendSnapshot(res, snap) {
  const ageMin = (Date.now() - Date.parse(snap.at)) / 60000;
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  // Снимок (donations/leaderboard) обновляется раз в несколько минут, а цель
  // считаем прямо сейчас отдельным запросом — она "легче" (один select с
  // фильтром) и не обязана ждать следующего прогона синхронизации.
  const goal = await goalData();
  return res.status(200).json({ ...snap.data, source: 'server', updated_at: snap.at, stale: ageMin > 30, ...(goal ? { goal } : {}) });
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
    if (snap) return await sendSnapshot(res, snap);
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
        if (snap) return await sendSnapshot(res, snap);
        return res.status(401).json({ error: 'not_authorized', auth_url: authUrl() });
      }
      const t = await refreshToken(refreshTok);
      if (!t) {
        // refresh_token тоже не сработал (например, отозван) — сначала пробуем снимок
        const snap = await readSnapshot();
        if (snap) return await sendSnapshot(res, snap);
        return res.status(401).json({ error: 'not_authorized', reason: 'session_expired', auth_url: authUrl() });
      }
      setAuthCookies(res, t, refreshTok);
      token = t.access_token;
      r = await fetch('https://www.donationalerts.com/api/v1/alerts/donations', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (r.status === 401) {
        const snap = await readSnapshot();
        if (snap) return await sendSnapshot(res, snap);
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

    // Цель — тем же способом, что и для остальных посетителей (из постоянного
    // журнала), а не пересчётом по этой единственной странице выдачи DA —
    // иначе у владельца (у него как раз есть cookie, он идёт этой веткой)
    // цель считалась бы иначе, чем у всех прочих, и число бы "прыгало".
    const goal = await goalData();
    res.status(200).json({ donations: donations.slice(0, 20), leaderboard, ...(goal ? { goal } : {}) });
  } catch(e) {
    // DonationAlerts недоступен — лучше показать последний снимок, чем ошибку
    const snap = await readSnapshot();
    if (snap) return await sendSnapshot(res, snap);
    res.status(500).json({ error: 'server_error' });
  }
}
