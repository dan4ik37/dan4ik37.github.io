// api/_lib/store.js — общий модуль серверных функций: доступ к Supabase по
// service-ключу + fetch с таймаутом и повтором.
//
// Файлы в api/_lib/ (с подчёркиванием) Vercel НЕ превращает в отдельные
// эндпоинты — это просто общий код.
//
// Нужные переменные окружения (Vercel → Settings → Environment Variables):
//   SUPABASE_URL               https://<проект>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  Supabase → Settings → API → service_role (СЕКРЕТ,
//                              никогда не класть в клиентский код!)
// Без них серверное начисление просто выключено, а сайт работает как раньше.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const baseUrl = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const storeConfigured = () => !!(baseUrl() && key());

// fetch с таймаутом. Повторяет при сетевой ошибке, 5xx и 429 (по умолчанию 1 раз).
// Повтор безопасен для всех наших запросов: чтение и идемпотентные RPC.
export async function timedFetch(url, opts = {}, { timeoutMs = 8000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal });
      clearTimeout(timer);
      if ((r.status >= 500 || r.status === 429) && attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      return r;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

function headers(extra) {
  return { apikey: key(), Authorization: 'Bearer ' + key(), 'Content-Type': 'application/json', ...extra };
}

export async function sbRpc(fn, args) {
  const r = await timedFetch(`${baseUrl()}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(args || {}),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`rpc ${fn}: HTTP ${r.status} ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}

export async function sbSelect(table, query) {
  const r = await timedFetch(`${baseUrl()}/rest/v1/${table}?${query}`, { headers: headers() });
  const txt = await r.text();
  if (!r.ok) throw new Error(`select ${table}: HTTP ${r.status} ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : [];
}

export async function sbUpsert(table, row, onConflict) {
  const r = await timedFetch(`${baseUrl()}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`upsert ${table}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
}

// Проверяет: "Authorization: Bearer <токен>" в запросе — это токен ЗАЛОГИНЕННОГО
// в браузере администратора (не сервисный ключ!). Используется там, где
// действие должен запускать именно человек из админки, а не любой посетитель
// или скрипт с CRON_SECRET (например — разовый полный импорт истории донатов,
// см. api/vip-sync.js?backfill=1).
//
// Шаг 1: спрашиваем у Supabase Auth, чей это токен (сам сервис проверяет
// подпись/срок — нам этого делать вручную не надо и небезопасно пытаться).
// Шаг 2: сервисным ключом (минуя RLS) смотрим role в profiles для этого id.
// Возвращает id пользователя, если он admin, иначе null — НИКОГДА не бросает
// исключение на «просто не админ», чтобы вызывающий код не путал это со
// сбоем самого Supabase.
export async function verifyAdmin(req) {
  if (!storeConfigured()) return null;
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  try {
    const ru = await timedFetch(`${baseUrl()}/auth/v1/user`, {
      headers: { apikey: key(), Authorization: `Bearer ${token}` },
    }, { timeoutMs: 6000, retries: 0 });
    if (!ru.ok) return null;
    const user = await ru.json();
    if (!user?.id) return null;
    const rows = await sbSelect('profiles', `id=eq.${user.id}&select=role`);
    return rows[0]?.role === 'admin' ? user.id : null;
  } catch (e) {
    return null;
  }
}
