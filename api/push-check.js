// api/push-check.js — push-уведомления о новом видео и начале стрима (даже при закрытом сайте)
//
// Режимы:
//  • GET ?pubkey=1            — публичный VAPID-ключ для браузера (js/features/push-pwa.js)
//  • POST ?test=1 {endpoint}  — одно приветственное уведомление только на эту подписку
//                               (сразу после подписки; только если она создана < 10 мин назад)
//  • остальное — проверка и рассылка, только с "Authorization: Bearer ${CRON_SECRET}":
//      – Vercel Cron раз в сутки (vercel.json) сам шлёт этот заголовок;
//      – cron-job.org каждые 5–10 минут (заголовок прописан в задании).
//
// Что уже разослано, хранится в push_state (push.sql): последнее видео и был ли эфир.
// Первый запуск ничего не рассылает — только запоминает текущее состояние.
// Мёртвые подписки (404/410 от push-сервиса) удаляются.
//
// Переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (см. api/_lib/webpush.js).
import { storeConfigured, sbSelect, sbUpsert, sbDelete, timedFetch } from './_lib/store.js';
import { vapidConfigured, sendPush } from './_lib/webpush.js';
import { getUploads, SITE } from './_lib/yt.js';
import { indexNow } from './_lib/indexnow.js';

const TWITCH = 'dan4ik37';
const HOUR = 3600e3;
const STREAM_RENOTIFY_MS = 3 * HOUR;   // эфир «моргнул» offline→live — повторно не шлём
const VIDEO_MAX_AGE_MS = 3 * 24 * HOUR; // старые ролики (снятые с приватного и т.п.) не анонсируем

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, 'http://x');

  if (url.searchParams.get('pubkey') === '1') {
    return res.status(200).json({ key: process.env.VAPID_PUBLIC_KEY || null });
  }
  if (!storeConfigured() || !vapidConfigured()) {
    return res.status(200).json({ ok: false, reason: 'not_configured' });
  }
  if (url.searchParams.get('test') === '1') return handleTest(req, res);

  const authorized = !!process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  if (!authorized) return res.status(401).json({ ok: false, reason: 'unauthorized' });

  const deadline = Date.now() + 50000;   // maxDuration 60 c (vercel.json)
  let state;
  try {
    const rows = await sbSelect('push_state', 'select=key,value');
    state = Object.fromEntries(rows.map(r => [r.key, parseJson(r.value)]));
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'db_unavailable' });
  }

  const out = { ok: true };
  try { out.video = await checkVideo(state.last_video, deadline); }
  catch (e) { out.video = { error: String(e?.message || e) }; console.error('[push video]', e); }
  try { out.stream = await checkStream(state.stream, deadline); }
  catch (e) { out.stream = { error: String(e?.message || e) }; console.error('[push stream]', e); }
  try { out.words = await checkWords(state.words, deadline); }
  catch (e) { out.words = { error: String(e?.message || e) }; console.error('[push words]', e); }   // push-words.sql не выполнен — ошибка только здесь
  return res.status(200).json(out);
}

// ── Новое видео ──
async function checkVideo(prev, deadline) {
  const now = Date.now();
  const uploads = (await getUploads(5, 0)).filter(v => Date.parse(v.publishedAt) <= now);
  const latest = uploads[0];
  if (!latest) return { status: 'no_videos' };

  const cur = { id: latest.id, publishedAt: latest.publishedAt };
  if (!prev?.id) { await saveState('last_video', cur); return { status: 'initialized', id: latest.id }; }
  if (latest.id === prev.id) return { status: 'same', id: latest.id };
  // Удалили/скрыли последний ролик — «новым» стал предыдущий. Такое не анонсируем.
  if (Date.parse(latest.publishedAt) <= Date.parse(prev.publishedAt)) {
    await saveState('last_video', cur);
    return { status: 'older', id: latest.id };
  }

  await saveState('last_video', cur);   // сначала запоминаем — повторный запуск не задвоит рассылку
  // Новый ролик — сразу в Яндекс и Bing (IndexNow), не ждём, пока робот сам дойдёт до страницы
  let indexed = null;
  try { indexed = await indexNow([`${SITE}/v/${latest.id}`, `${SITE}/videos`, `${SITE}/`]); } catch (e) { indexed = 'error'; }
  if (now - Date.parse(latest.publishedAt) > VIDEO_MAX_AGE_MS) return { status: 'too_old', id: latest.id, indexed };

  const sent = await broadcast('want_videos', {
    title: '🎬 Новое видео на канале dan4ik37',
    body: latest.title,
    url: `/v/${latest.id}`,
    image: latest.thumb || undefined,
    tag: 'video-' + latest.id,
  }, deadline);
  return { status: 'sent', id: latest.id, indexed, ...sent };
}

// ── Начало стрима ──
async function checkStream(prev, deadline) {
  const live = await twitchLive();
  if (live === null) return { status: 'unknown' };   // decapi недоступен — состояние не трогаем
  const now = Date.now();

  if (!live) {
    if (prev?.live !== false) await saveState('stream', { live: false, notifiedAt: prev?.notifiedAt || 0 });
    return { status: 'offline' };
  }
  if (prev?.live === true) return { status: 'live_already' };

  const first = !prev;   // самый первый запуск во время эфира — не рассылаем
  const recent = prev?.notifiedAt && now - prev.notifiedAt < STREAM_RENOTIFY_MS;
  await saveState('stream', { live: true, notifiedAt: first || recent ? (prev?.notifiedAt || 0) : now });
  if (first) return { status: 'initialized' };
  if (recent) return { status: 'live_again_quiet' };

  const title = await twitchTitle();
  const sent = await broadcast('want_streams', {
    title: '🔴 dan4ik37 в эфире!',
    body: title || 'Стрим начался — залетай!',
    url: '/#/home',
    tag: 'stream-' + new Date().toISOString().slice(0, 10),
  }, deadline);
  return { status: 'sent', ...sent };
}

// Тот же разбор ответа decapi, что в js/features/twitch.js
async function twitchLive() {
  try {
    const r = await timedFetch(`https://decapi.me/twitch/uptime/${TWITCH}`, {}, { timeoutMs: 6000 });
    if (!r.ok) return null;
    const t = (await r.text()).trim();
    if (/offline/i.test(t)) return false;
    if (t && !/error|not found|could not|invalid/i.test(t)) return true;
  } catch (e) {}
  return null;
}
async function twitchTitle() {
  try {
    const r = await timedFetch(`https://decapi.me/twitch/title/${TWITCH}`, {}, { timeoutMs: 5000, retries: 0 });
    const t = r.ok ? (await r.text()).trim() : '';
    return t && !/error|not found|could not|invalid/i.test(t) ? t.slice(0, 150) : '';
  } catch (e) { return ''; }
}

// ── «Новое слово дня» («5 букв», push-words.sql): раз в день после 12:00 по МСК — тем, кто включил (want_words) ──
// Слово меняется в полночь МСК; днём — самое время напомнить. Сначала запоминаем день — повторный запуск не задвоит.
async function checkWords(prev, deadline) {
  const msk = new Date(Date.now() + 3 * HOUR);
  const day = msk.toISOString().slice(0, 10);
  if (msk.getUTCHours() < 12) return { status: 'early' };
  if (prev?.day === day) return { status: 'sent_today' };
  await saveState('words', { day });
  const sent = await broadcast('want_words', {
    title: '🔤 Новое слово дня',
    body: 'Угадай слово из 5 букв за 6 попыток — пока друзья не опередили!',
    url: '/#/games/words',
    tag: 'words-day',
  }, deadline);
  return { status: 'sent', day, ...sent };
}

// ── Рассылка всем подписчикам темы (want_videos / want_streams / want_words) ──
async function broadcast(column, data, deadline) {
  let sent = 0, failed = 0, removed = 0, offset = 0;
  const PAGE = 500, PARALLEL = 25;
  while (Date.now() < deadline) {
    const subs = await sbSelect('push_subscriptions',
      `${column}=eq.true&select=endpoint,p256dh,auth&order=id&limit=${PAGE}&offset=${offset}`);
    const gone = [];
    for (let i = 0; i < subs.length && Date.now() < deadline; i += PARALLEL) {
      const results = await Promise.all(subs.slice(i, i + PARALLEL).map(s => sendPush(s, data)));
      results.forEach((r, j) => {
        if (r.ok) sent++; else failed++;
        if (r.gone) gone.push(subs[i + j].endpoint);
      });
    }
    for (const ep of gone) {
      try { await sbDelete('push_subscriptions', `endpoint=eq.${encodeURIComponent(ep)}`); removed++; } catch (e) {}
    }
    // удалённые сдвигают следующие страницы — учитываем
    offset += subs.length - gone.length;
    if (subs.length < PAGE) break;
  }
  return { sent, failed, removed };
}

// ── Приветственное уведомление одной свежей подписке ──
async function handleTest(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  let body = req.body;
  if (typeof body === 'string') body = parseJson(body);
  const endpoint = String(body?.endpoint || '');
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) return res.status(400).json({ ok: false });

  let sub;
  try {
    const rows = await sbSelect('push_subscriptions',
      `endpoint=eq.${encodeURIComponent(endpoint)}&select=endpoint,p256dh,auth,updated_at`);
    sub = rows[0];
  } catch (e) {
    return res.status(200).json({ ok: false, reason: 'db_unavailable' });
  }
  if (!sub) return res.status(404).json({ ok: false, reason: 'not_subscribed' });
  if (Date.now() - Date.parse(sub.updated_at) > 10 * 60e3) return res.status(429).json({ ok: false, reason: 'too_late' });

  const r = await sendPush(sub, {
    title: 'dan4ik37',
    body: '✅ Уведомления включены! Сообщим о новом видео и о начале стрима.',
    url: '/#/home',
    tag: 'welcome',
  }, { ttl: 600, urgency: 'normal' });
  if (r.gone) { try { await sbDelete('push_subscriptions', `endpoint=eq.${encodeURIComponent(endpoint)}`); } catch (e) {} }
  return res.status(200).json({ ok: r.ok, status: r.status });
}

function parseJson(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function saveState(key, value) {
  return sbUpsert('push_state', { key, value: JSON.stringify(value), updated_at: new Date().toISOString() }, 'key');
}
