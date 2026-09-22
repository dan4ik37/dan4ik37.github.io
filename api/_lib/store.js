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
