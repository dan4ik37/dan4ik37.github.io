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
// ?backfill=1 — ОТДЕЛЬНЫЙ режим: полный разовый импорт ВСЕЙ истории донатов
// (не только последних 14 дней) для честной суммы на шкале цели. Доступен
// ТОЛЬКО администратору (проверяется его собственным токеном входа через
// verifyAdmin, см. api/_lib/store.js) — не путать с обычной синхронизацией
// выше, у которой отдельный лёгкий безусловный доступ. Возобновляемый:
// одна страница DonationAlerts ≈ время в пределах бюджета, поэтому вызывается
// в цикле с фронтенда (кнопка в настройках сайта), пока не вернётся done:true.
//
// Настройка (Vercel → Environment Variables), сверх уже имеющихся DA_CLIENT_*:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY        — обязательно
//   CRON_SECRET                                    — рекомендуется (любая длинная строка)
//   DA_OWNER_ID                                    — рекомендуется (id вашего аккаунта DA)
//   VIP_SYNC_LOOKBACK_DAYS (14), VIP_SYNC_MAX_PAGES (8) — необязательно
import { storeConfigured, sbRpc, sbSelect, verifyAdmin } from './_lib/store.js';
import { getAccessToken, fetchDonationPages, fetchDonationPagesFrom, buildSnapshot } from './_lib/da.js';

const DAY = 86400000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', 'https://dan4ik37.vercel.app');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!storeConfigured()) {
    return res.status(200).json({ ok: false, reason: 'store_not_configured' });
  }

  const url = new URL(req.url, 'http://x');
  if (url.searchParams.get('backfill') === '1') {
    return handleBackfill(req, res, url);
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
        // Время САМОГО доната (из DonationAlerts), а не время, когда сервер
        // его увидел — иначе шкала цели с фильтром "с даты X" была бы неточной
        // на несколько минут (обычно) или на весь бэкфилл при первом запуске.
        p_donated_at: d.created,
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

// ── Полный разовый импорт всей истории (см. пояснение в шапке файла) ──
async function handleBackfill(req, res, url) {
  const adminId = await verifyAdmin(req);
  if (!adminId) {
    return res.status(401).json({ ok: false, reason: 'admin_required' });
  }

  if (url.searchParams.get('reset') === '1') {
    try { await sbRpc('reset_backfill'); } catch (e) {
      return res.status(200).json({ ok: false, reason: 'db_unavailable' });
    }
  }

  const startedAt = Date.now();
  const deadline = startedAt + 22000;   // укладываемся в maxDuration (30 c) с запасом

  let locked;
  try {
    locked = await sbRpc('try_lock_backfill', { p_seconds: 25 });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'db_unavailable' });
  }
  if (!locked) {
    // Либо обычная синхронизация сейчас крутится, либо админ уже жмёт кнопку
    // в другой вкладке — фронтенд просто попробует ещё раз чуть позже.
    return res.status(200).json({ ok: true, done: false, busy: true });
  }

  let state;
  try {
    const rows = await sbSelect('vip_sync_state', 'id=eq.1&select=backfill_cursor,backfill_done,backfill_pages,backfill_imported');
    state = rows[0] || {};
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'db_unavailable' });
  }

  if (state.backfill_done) {
    // Забирали замок только чтобы прочитать состояние без гонки с параллельным
    // кликом — раз работы нет, сразу отпускаем (advance_backfill с нулевыми
    // дельтами не трогает счётчики, только снимает locked_until). Раньше тут
    // был баг: замок молча держался все 25 секунд, и следующий клик (например,
    // сразу после reset=1) на эти же 25 секунд упирался в busy:true.
    await sbRpc('advance_backfill', { p_cursor: state.backfill_cursor || null, p_done: true, p_pages: 0, p_imported: 0, p_error: null });
    return res.status(200).json({
      ok: true, done: true, alreadyDone: true,
      pages: state.backfill_pages || 0, imported: state.backfill_imported || 0,
    });
  }

  try {
    const tok = await getAccessToken();
    if (!tok.token) throw new Error(tok.reason || 'no_token');

    const maxPages = Number(process.env.VIP_BACKFILL_PAGES_PER_CALL) || 5;
    // cursor=null → начинаем с самой первой страницы (самые свежие донаты);
    // дальше идём строго по links.next, вглубь истории, без ограничения по дате.
    const { donations, pages, nextUrl } = await fetchDonationPagesFrom(tok.token, state.backfill_cursor || null, { maxPages, deadline });

    const usable = donations.filter(d => d.id && d.username);
    let imported = 0;
    for (const d of usable) {
      if (Date.now() > deadline) break;   // остаток — со следующего клика, курсор мы всё равно продвинем только до сюда
      const useRub = d.amountRub != null;
      const r = await sbRpc('credit_donation', {
        p_id: d.id,
        p_username: d.username,
        p_amount: useRub ? d.amountRub : d.amount,
        p_currency: useRub ? 'RUB' : d.currency,
        p_donated_at: d.created,
      });
      if (r?.status === 'credited' || r?.status === 'unmatched') imported++;   // "unmatched" тоже реально донат — просто не привёл к VIP
    }

    const done = !nextUrl;
    await sbRpc('advance_backfill', { p_cursor: nextUrl, p_done: done, p_pages: pages, p_imported: imported, p_error: null });

    return res.status(200).json({
      ok: true, done,
      pagesThisRun: pages, importedThisRun: imported,
      pages: (state.backfill_pages || 0) + pages, imported: (state.backfill_imported || 0) + imported,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    try { await sbRpc('advance_backfill', { p_cursor: state.backfill_cursor || null, p_done: false, p_pages: 0, p_imported: 0, p_error: msg }); } catch (_) {}
    console.error('[vip-sync backfill]', msg);
    return res.status(200).json({ ok: false, reason: 'backfill_failed', error: msg });
  }
}
