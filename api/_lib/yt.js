// api/_lib/yt.js — YouTube Data API для серверных страниц (/v/<id>, /sitemap.xml)
//
// Ключ: YT_API_KEY из переменных окружения Vercel, иначе — тот же публичный
// ключ, что и в js/core/config.js (он и так виден в браузере любому).
// Ответы кэшируются на CDN Vercel (заголовки в самих функциях), плюс здесь —
// в памяти «тёплого» инстанса функции, чтобы соседние запросы не тратили квоту.

import { SNAPSHOT } from './uploads-snapshot.js';
import { DETAILS_JSON } from './video-details.js';

const KEY = process.env.YT_API_KEY || 'AIzaSyA0dK2a1YG_s54zG-zapYgjycIempCvHp0';
const HANDLE = '@Dan4ik37Yt';
const API = 'https://www.googleapis.com/youtube/v3/';

export const SITE = 'https://dan4ik37.vercel.app';
export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
// Весь архив (~6000 роликов на 2026). Через API это 120 запросов по 50 подряд — поэтому берётся из снимка
// (uploads-snapshot.js, scripts/snapshot-uploads.mjs) плюс свежие ролики сверху. Страница ролика — getUploads(200).
export const ALL_UPLOADS = 10000;

const mem = new Map();
// Кладём в память сразу обещание: одновременные запросы ждут один и тот же поход в API, а не делают свой
// (на холодном старте /api/feed спрашивал канал трижды). Ошибка — забываем, чтобы следующий запрос попробовал снова.
async function cached(key, ttlMs, fn) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const p = fn();
  mem.set(key, { t: Date.now(), v: p });
  try { return await p; } catch (e) { mem.delete(key); throw e; }
}

async function api(path) {
  // Ключ может быть ограничен по HTTP-рефереру (настройка в Google Cloud) — представляемся сайтом
  const r = await fetch(API + path + '&key=' + KEY, { headers: { Referer: SITE + '/' } });
  if (!r.ok) throw new Error('YouTube API ' + r.status);
  return r.json();
}

// { id, uploads } канала
export function getChannel() {
  return cached('channel', 24 * 3600e3, async () => {
    const d = await api(`channels?part=contentDetails&forHandle=${encodeURIComponent(HANDLE)}`);
    const it = d.items?.[0];
    if (!it) throw new Error('Канал не найден');
    return { id: it.id, uploads: it.contentDetails.relatedPlaylists.uploads };
  });
}

// Полные данные одного ролика (или null, если нет / чужой канал)
export function getVideo(id) {
  return cached('v:' + id, 3600e3, async () => {
    const [ch, d] = await Promise.all([
      getChannel(),
      api(`videos?part=snippet,contentDetails,statistics&id=${id}`)
    ]);
    const v = d.items?.[0];
    // Только ролики этого канала — иначе на нашем домене можно было бы
    // «сгенерировать» страницу для любого видео YouTube
    if (!v || v.snippet.channelId !== ch.id) return null;
    return v;
  });
}

// Последние загрузки: [{ id, title, thumb, publishedAt }]. max — до ALL_UPLOADS (по 50 за запрос).
// ttlMs — сколько держать в памяти инстанса; api/push-check.js берёт свежие (0).
// Больше 50 — снимок архива + только новые ролики сверху (обычно 1 запрос вместо ~120; холодная загрузка
// /videos была 25–35 с). YouTube API недоступен (квота кончилась) — отдаём снимок как есть, страницы не падают.
export function getUploads(max = 50, ttlMs = 3600e3) {
  return cached('uploads:' + max, ttlMs, async () => {
    const snap = max > 50 ? snapshotList() : [];
    if (!snap.length) return (await fetchUploads(max)).filter(v => !hiddenVideo(v.id, v.title));
    const known = new Set(snap.map(v => v.id));
    let head = [];
    try { head = await fetchUploads(200, id => known.has(id)); } catch (e) { /* без свежих — только снимок */ }
    const seen = new Set(), all = [];
    for (const v of [...head, ...snap]) if (!seen.has(v.id)) { seen.add(v.id); all.push(v); }
    return all.filter(v => !hiddenVideo(v.id, v.title))
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, max);
  });
}

// Загрузки канала через API, от новых к старым; stopAt(id) → true — дальше не идём (уже есть в снимке)
async function fetchUploads(max, stopAt = null) {
  const { uploads } = await getChannel();
  const out = [];
  let page = '';
  while (out.length < max) {
    const d = await api(`playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${uploads}${page ? '&pageToken=' + page : ''}`);
    let stop = false;
    for (const it of d.items || []) {
      const sn = it.snippet;
      if (stopAt && stopAt(it.contentDetails.videoId)) { stop = true; break; }
      if (sn.title === 'Private video' || sn.title === 'Deleted video') continue;
      out.push({
        id: it.contentDetails.videoId,
        title: sn.title,
        thumb: sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || '',
        publishedAt: it.contentDetails.videoPublishedAt || sn.publishedAt
      });
    }
    page = d.nextPageToken;
    if (stop || !page) break;
  }
  return out.slice(0, max).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

// Ролик из снимка по id: { id, title, thumb, publishedAt } или null (новый ролик — его в снимке нет)
let snapById = null;
export function snapshotById(id) {
  if (!snapById) snapById = new Map(snapshotList().map(v => [v.id, v]));
  return snapById.get(id) || null;
}

let snapCache = null;
function snapshotList() {
  if (!snapCache) snapCache = SNAPSHOT ? SNAPSHOT.split('\n').map(line => {
    const [id, publishedAt, title] = line.split('\t');
    return { id, title, thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, publishedAt };
  }) : [];
  return snapCache;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// PT1H2M3S → «1:02:03»
export function fmtDuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return '';
  const h = +(m[1] || 0), mi = +(m[2] || 0), s = +(m[3] || 0);
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(mi)}:${p(s)}` : `${mi}:${p(s)}`;
}

// 12345 → «12,3 тыс.»
export function fmtCount(n) {
  n = +n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',').replace(',0', '') + ' млн';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.', ',').replace(',0', '') + ' тыс.';
  return String(n);
}

// Похожие ролики: общие слова в названии (и теги текущего ролика), затем — свежие.
// Без внешних сервисов: на канале игровые ролики, игра в названии — главный признак темы.
const STOP = new Set('и в во на с со по за из к ко у о об от до не но а я ты мы он она это как что то же ли бы или для the a an of in on to and for with my is it'.split(' '));
const words = t => String(t || '').toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/i).filter(w => w.length >= 3 && !STOP.has(w) && !/^(shorts|short|video|видео)$/.test(w));
export function relatedVideos(cur, list, n = 8) {
  const mine = new Set([...words(cur.title), ...(cur.tags || []).flatMap(words)]);
  const scored = list.filter(v => v.id !== cur.id).map((v, i) => {
    const ws = new Set(words(v.title));
    let s = 0;
    for (const w of ws) if (mine.has(w)) s++;
    return { v, s, i };
  });
  const top = scored.filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, n).map(x => x.v);
  const seen = new Set(top.map(v => v.id));
  for (const x of scored) { if (top.length >= n) break; if (!seen.has(x.v.id)) { top.push(x.v); seen.add(x.v.id); } }
  return { list: top, similar: scored.some(x => x.s > 0) };
}

// Статистика канала для медиакита: { subscriberCount, viewCount, videoCount, publishedAt, thumb }
export function getChannelStats() {
  return cached('chstats', 6 * 3600e3, async () => {
    const d = await api(`channels?part=statistics,snippet&forHandle=${encodeURIComponent(HANDLE)}`);
    const it = d.items?.[0];
    if (!it) throw new Error('Канал не найден');
    return { ...it.statistics, publishedAt: it.snippet.publishedAt, thumb: it.snippet.thumbnails?.high?.url || '', title: it.snippet.title || 'Dan4ik37', handle: it.snippet.customUrl || '@dan4ik37yt' };
  });
}
// Просмотры и длительность роликов (до 50 id за запрос, 1 ед. квоты): [{ id, viewCount, likeCount, duration }]
export function getVideoStats(ids) {
  const list = ids.slice(0, 50);
  return cached('vstats:' + list.join(','), 6 * 3600e3, async () => {
    if (!list.length) return [];
    const d = await api(`videos?part=statistics,contentDetails&id=${list.join(',')}`);
    return (d.items || []).map(v => ({ id: v.id, ...v.statistics, duration: v.contentDetails?.duration || '' }));
  });
}

// Ролики про открытие кейсов / промокоды на депозит (GGDROP, CaseBattle…): у AdSense это «азартные игры» —
// рекламу Google рядом показывать нельзя, иначе могут отклонить сайт или отключить показы.
// «деп» отдельным словом: \b в JS — только для латиницы (у «деп» он не срабатывал никогда) — границы по кириллице руками, без
// (?<!…): старый Safari такие выражения не понимает. То же выражение — в js/core/ad-places.js и js/core/age.js (тест сверяет).
const GAMBLING_RE = /ggdrop|ггдроп|case\s*battle|casebattle|кейс\s*батл|кейсбатл|казино|casino|промокод на деп|(?:^|[^а-яёa-z0-9_])деп(?![а-яёa-z0-9_])|депозит|рулетк|ставк[аиу]/i;
export const isGambling = (...texts) => texts.some(t => GAMBLING_RE.test(String(t || '')));

// 28.10.2026: AdSense отклонил сайт — «Обнаружены нарушения правил». У 555 из 5978 роликов в описании промокоды на депозит
// («БОНУС КОДИК НА ДЕП»), у ~490 — в названии; аудитория сайта — дети. Такие ролики сайт не показывает вовсе: нет в списках,
// карте сайта, поиске, «похожих»; /v/<id> — 404. Ролики на YouTube не трогаем. Вернуть как было — false.
export const HIDE_GAMBLING = true;
// Подробности снимка (video-details.js) — один разбор на всё (video-snap.js берёт отсюда же)
let details = null, gIds = null;
export function snapDetails() {
  if (!details) { try { details = JSON.parse(DETAILS_JSON); } catch (e) { details = { d: [], t: [], v: {} }; } }
  return details;
}
function gamblingIds() {
  if (gIds) return gIds;
  const D = snapDetails(), dg = D.d.map(x => isGambling(x));
  gIds = new Set();
  for (const id in D.v) if (dg[D.v[id][4]]) gIds.add(id);
  return gIds;
}
// 05.11.2026: с мая 2025 по начало января 2026 на стримах висел баннер GGDROP с промокодом — он виден на превью и в самих роликах
// (/v/14n46v57Biw, «СИРЕНОГОЛОВЫЙ?» и др.), а текстом (название, описание) его не поймать. Ролики этого времени (записи эфиров,
// клипы и шортсы со стримов) сайт не показывает, как и ролики про кейсы. Даты — по роликам с промокодом в описании (первый —
// 2025-05-03, последний — 2026-01-05); владелец уточняет, когда баннер правда был. Вернуть как было — false.
export const HIDE_GG_WINDOW = true;
export const GG_WINDOW = ['2025-05-01', '2026-01-10'];   // [с, до) — дата публикации ролика (UTC, как в снимке)
let ggIds = null;
function ggWindowIds() {
  if (!ggIds) ggIds = new Set(snapshotList().filter(v => v.publishedAt >= GG_WINDOW[0] && v.publishedAt < GG_WINDOW[1]).map(v => v.id));
  return ggIds;
}
export const hiddenVideo = (id, ...texts) => HIDE_GAMBLING && (isGambling(...texts) || gamblingIds().has(id) || (HIDE_GG_WINDOW && ggWindowIds().has(id)));

// Шортс: по длительности (с 15.10.2024 YouTube разрешил до 3 минут, раньше — до минуты); длительности нет — по #shorts в названии.
// (В названии многих многочасовых записей стримов тоже есть #shorts — по нему одному не судим.)
const isoSecs = iso => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : -1; };
export function isShortVideo(title, publishedAt, duration) {
  const s = isoSecs(duration);
  if (s < 0) return /#shorts?\b/i.test(title || '');
  return s > 0 && s <= (Date.parse(publishedAt) >= Date.parse('2024-10-15') ? 180 : 60);
}

// Описание ролика для страницы /v/<id> (05.11.2026, правила AdSense о скопированном и «пустом» содержимом): повторы строк убраны
// (три «Made with Restream» подряд), строки-реклама Restream и «обязательно можешь глянуть теги …» (набор ключевых слов — спам
// для поиска) — тоже. Ролики на YouTube не трогаем.
const DESC_DROP = /^\s*(?:made with restream|livestream on \d+\+? platforms|обязательно можешь глянуть теги)/i;
export function cleanDesc(desc) {
  const seen = new Set(), out = [];
  for (const raw of String(desc || '').split('\n')) {
    const l = raw.replace(/\s+$/, '');
    if (DESC_DROP.test(l) || /restream\.io/i.test(l)) continue;
    const k = l.trim().toLowerCase();
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    if (!k && (!out.length || !out[out.length - 1].trim())) continue;   // пустые строки — не больше одной подряд
    out.push(l);
  }
  return out.join('\n').trim();
}
// Своего текста в описании (слов): без ссылок, хэштегов, «подпишись / донаты / соцсети / теги» — то, что автор правда написал
// об этом ролике. Реклама на /v/<id> — только если его ≥ VIDEO_OWN_WORDS (страница ролика, где кроме данных YouTube ничего нет,
// — «бесполезный контент» для AdSense и нарушение правил YouTube API III.G.1.d).
export const VIDEO_OWN_WORDS = 150;
const BOILER = /https?:\/\/|restream|поддерж|подпис|мемкоин|телеграм|telegram|tiktok|тикток|донат|donat|дискорд|discord|steam|стим(?![а-яё])|capcut|лайк|заранее спасибо|плейлист|глянуть теги|^\s*#|vk\.com|memealerts/i;
export function ownWords(desc) {
  return String(desc || '').split('\n').filter(l => l.trim() && !BOILER.test(l)).join(' ')
    .replace(/#\S+/g, ' ').replace(/[^\p{L}\p{N}\s'-]+/gu, ' ').split(/\s+/).filter(w => w.length > 1).length;
}
