// api/_lib/da.js — работа с DonationAlerts от имени ВЛАДЕЛЬЦА сайта без браузера.
//
// Как это устроено. Раньше данные о донатах можно было получить только по
// cookie da_token в браузере того, кто прошёл OAuth (живёт сутки, а список
// отдавал лишь последние 20 донатов). Теперь при входе владельца токены
// (access + refresh) сохраняются в таблице integration_tokens, а сервер сам
// обновляет их и ходит в DonationAlerts.
//
// ВАЖНО про refresh_token: DonationAlerts выдаёт НОВЫЙ refresh при каждом
// обновлении, а старый перестаёт работать. Поэтому единственный, кто
// обновляет токен, — api/vip-sync.js (он под замком try_lock_vip_sync);
// остальные эндпоинты токен только читают.
import { storeConfigured, sbSelect, sbUpsert, timedFetch } from './store.js';

const DA = 'https://www.donationalerts.com';
const PROVIDER = 'donationalerts';

export async function getStoredToken() {
  const rows = await sbSelect('integration_tokens', `provider=eq.${PROVIDER}&select=*`);
  return rows[0] || null;
}

async function saveToken(t, userId) {
  await sbUpsert('integration_tokens', {
    provider: PROVIDER,
    provider_user_id: userId == null ? null : String(userId),
    access_token: t.access_token,
    access_expires_at: new Date(Date.now() + (Number(t.expires_in) || 3600) * 1000).toISOString(),
    refresh_token: t.refresh_token,
    updated_at: new Date().toISOString(),
  }, 'provider');
}

// Вызывается из api/auth.js после входа владельца. Возвращает строку-статус.
// Защита от подмены: OAuth может пройти КТО УГОДНО со своим аккаунтом DonationAlerts,
// а токен потом определяет, чьи донаты превращаются в VIP. Поэтому:
//  • если задана переменная DA_OWNER_ID — принимаем только этот аккаунт;
//  • иначе первый вошедший «запоминается» (id аккаунта сохраняется), и
//    любой другой аккаунт уже не сможет подменить токен.
export async function adoptSession(t) {
  if (!storeConfigured()) return 'store_off';
  if (!t?.access_token || !t?.refresh_token) return 'no_refresh_token';
  const meRes = await timedFetch(`${DA}/api/v1/user/oauth`, { headers: { Authorization: `Bearer ${t.access_token}` } });
  if (!meRes.ok) return 'user_check_failed';
  const me = (await meRes.json())?.data;
  if (!me?.id) return 'user_check_failed';
  const id = String(me.id);
  if (process.env.DA_OWNER_ID && String(process.env.DA_OWNER_ID) !== id) return 'not_owner';
  const existing = await getStoredToken();
  if (existing?.provider_user_id && existing.provider_user_id !== id) return 'other_account';
  await saveToken(t, id);
  return 'stored';
}

async function refreshWith(refreshToken) {
  const r = await timedFetch(`${DA}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.DA_CLIENT_ID,
      client_secret: process.env.DA_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  }, { timeoutMs: 10000, retries: 0 });   // без повтора: повторный refresh со старым токеном уже не сработает
  const t = await r.json().catch(() => ({}));
  return t.access_token ? { ok: true, ...t } : { ok: false, reason: t.error_description || t.error || ('HTTP ' + r.status) };
}

// Живой access-токен для сервера. { token } либо { token: null, reason }
export async function getAccessToken() {
  if (!process.env.DA_CLIENT_ID || !process.env.DA_CLIENT_SECRET) return { token: null, reason: 'env_missing_da' };
  const row = await getStoredToken();
  if (!row) return { token: null, reason: 'no_stored_session' };
  if (row.access_token && row.access_expires_at && new Date(row.access_expires_at).getTime() > Date.now() + 120000) {
    return { token: row.access_token };
  }
  if (!row.refresh_token) return { token: null, reason: 'no_refresh_token' };
  const t = await refreshWith(row.refresh_token);
  if (!t.ok) return { token: null, reason: 'refresh_failed: ' + t.reason };
  // Сохраняем НОВЫЙ refresh_token сразу — иначе следующий запуск останется без сессии
  await saveToken({ ...t, refresh_token: t.refresh_token || row.refresh_token }, row.provider_user_id);
  return { token: t.access_token };
}

// created_at приходит как «2026-09-21 12:34:56» (UTC) — приводим к мс
function parseDaTime(s) {
  if (!s) return NaN;
  const iso = String(s).includes('T') ? String(s) : String(s).replace(' ', 'T');
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
}

// Приводит донат к виду, удобному серверу. amountRub — сумма в рублях, если её удалось
// определить: для RUB это amount, для валют — amount_in_user_currency (сумма,
// пересчитанная DonationAlerts в валюту аккаунта стримера; считаем её рублями,
// если не задана DA_USER_CURRENCY с другим значением).
export function normalizeDonation(d) {
  const cur = String(d.currency || 'RUB').toUpperCase();
  const raw = parseFloat(d.amount) || 0;
  let amountRub = null;
  if (cur === 'RUB') amountRub = raw;
  else if ((process.env.DA_USER_CURRENCY || 'RUB').toUpperCase() === 'RUB') {
    const conv = parseFloat(d.amount_in_user_currency);
    if (conv > 0) amountRub = conv;
  }
  return {
    id: d.id,
    username: String(d.username || '').trim(),
    amount: raw,
    currency: cur,
    amountRub,
    created: d.created_at || null,
    createdMs: parseDaTime(d.created_at),
  };
}

// Забирает страницы списка донатов (от новых к старым), идя по links.next.
// Возвращает { donations, pages, complete }: complete=false, если упёрлись в лимит/дедлайн.
export async function fetchDonationPages(token, { maxPages = 8, deadline = Infinity } = {}) {
  const out = [];
  let url = `${DA}/api/v1/alerts/donations?page=1`;
  let pages = 0;
  while (url && pages < maxPages && Date.now() < deadline) {
    const r = await timedFetch(url, { headers: { Authorization: `Bearer ${token}` } }, { timeoutMs: 9000, retries: 1 });
    if (r.status === 401 || r.status === 403) throw new Error('da_unauthorized');
    if (!r.ok) throw new Error('da_http_' + r.status);
    const j = await r.json();
    pages++;
    (j.data || []).forEach(d => out.push(normalizeDonation(d)));
    url = j.links?.next || null;
  }
  return { donations: out, pages, complete: !url };
}

// Публичный снимок для «Топа донатеров»: никаких сообщений донатеров и почт — только
// то, что и так показывается на странице
export function buildSnapshot(donations) {
  const recent = donations.slice(0, 20).map(d => ({
    id: d.id, username: d.username || 'Аноним', amount: d.amount, currency: d.currency, created: d.created,
  }));
  const map = {};
  donations.forEach(d => {
    const k = (d.username || 'Аноним').toLowerCase();
    // Суммируем в рублях, где DonationAlerts дал пересчёт; иначе валюты смешивались бы как есть
    const inRub = d.amountRub != null;
    (map[k] ||= { username: d.username || 'Аноним', total: 0, count: 0, currency: inRub ? 'RUB' : d.currency }).total += inRub ? d.amountRub : d.amount;
    map[k].count++;
  });
  const leaderboard = Object.values(map).sort((a, b) => b.total - a.total).slice(0, 20);
  return { donations: recent, leaderboard };
}
