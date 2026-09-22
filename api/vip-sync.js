// api/vip-sync.js — серверное начисление VIP по донатам (без участия админа)
//
// Что делает: берёт токен владельца из БД, забирает свежие донаты из
// DonationAlerts (до VIP_SYNC_MAX_PAGES страниц, не только последние 20),
// каждый ещё не учтённый отдаёт в SQL-функцию credit_donation (атомарно,
// идемпотентно) и сохраняет снимок для публичного «Топа донатеров».
//
// Кто и когда его вызывает:
//  • любой посетитель сайта — js/features/vip-sync-ping.js раз в несколько минут;
//  • Vercel Cron раз в сутки (vercel.json) — страховка на случай пустого сайта;
//  • сам эндпоинт защищён замком в БД (try_lock_vip_sync): чаще, чем раз в
//    2 минуты, реальную работу не делает, сколько бы ни пришло запросов.
// Запрос не принимает никаких данных от клиента — подделывать нечего.
//
// Настройка (Vercel → Environment Variables), сверх уже имеющихся DA_CLIENT_*:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY        — обязательно
//   CRON_SECRET                                    — рекомендуется (любая длинная строка)
//   DA_OWNER_ID                                    — рекомендуется (id вашего аккаунта DA)
//   VIP_SYNC_LOOKBACK_DAYS (14), VIP_SYNC_MAX_PAGES (8) — необязательно
import { storeConfigured, sbRpc, sbSelect } from './_lib/store.js';
import { getAccessToken, fetchDonationPages, buildSnapshot } from './_lib/da.js';

const DAY = 86400000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', 'https://dan4ik37.vercel.app');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!storeConfigured()) {
    return res.status(200).json({ ok: false, reason: 'store_not_configured' });
  }

  const isCron = !!process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const startedAt = Date.now();
  const deadline = startedAt + 22000;   // укладываемся в maxDuration (30 c) с запасом

  let locked;
  try {
    locked = await sbRpc('try_lock_vip_sync', { p_seconds: isCron ? 20 : 120 });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'db_unavailable' });
  }
  if (!locked) return res.status(200).json({ ok: true, ran: false });

  let seen = 0, credited = 0;
  try {
    const tok = await getAccessToken();
    if (!tok.token) throw new Error(tok.reason || 'no_token');

    const maxPages = Number(process.env.VIP_SYNC_MAX_PAGES) || 8;
    const { donations } = await fetchDonationPages(tok.token, { maxPages, deadline });
    seen = donations.length;

    // Начисляем только свежие: старше окна не трогаем — иначе при первом запуске
    // «вдруг» начислилась бы вся давняя история людям, которые зарегистрировались
    // позже и заняли чей-то ник.
    const lookback = (Number(process.env.VIP_SYNC_LOOKBACK_DAYS) || 14) * DAY;
    const fresh = donations.filter(d => d.id && d.username && !(d.createdMs < Date.now() - lookback));

    // Один запрос в лог вместо вызова функции на каждый донат при каждом запуске
    let known = new Set();
    if (fresh.length) {
      const ids = fresh.map(d => d.id).join(',');
      const rows = await sbSelect('vip_donation_log', `donation_id=in.(${ids})&select=donation_id`);
      known = new Set(rows.map(r => String(r.donation_id)));
    }
    // От старых к новым: месяцы и пороги уровней набегают в той же последовательности, что и донаты
    const todo = fresh.filter(d => !known.has(String(d.id))).reverse();

    for (const d of todo) {
      if (Date.now() > deadline) break;   // остаток доберём в следующий запуск
      const useRub = d.amountRub != null;
      const r = await sbRpc('credit_donation', {
        p_id: d.id,
        p_username: d.username,
        p_amount: useRub ? d.amountRub : d.amount,
        p_currency: useRub ? 'RUB' : d.currency,
      });
      if (r?.status === 'credited') credited++;
    }

    await sbRpc('save_vip_snapshot', { p_snapshot: buildSnapshot(donations) });
    await sbRpc('finish_vip_sync', { p_ok: true, p_error: null, p_seen: seen, p_credited: credited });
    return res.status(200).json({ ok: true, ran: true, ...(isCron ? { seen, credited } : {}) });
  } catch (e) {
    const msg = String(e?.message || e);
    try { await sbRpc('finish_vip_sync', { p_ok: false, p_error: msg, p_seen: seen, p_credited: credited }); } catch (_) {}
    console.error('[vip-sync]', msg);
    return res.status(200).json({ ok: false, ran: true, reason: 'sync_failed' });
  }
}
