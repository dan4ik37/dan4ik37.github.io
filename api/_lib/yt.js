// api/_lib/yt.js — YouTube Data API для серверных страниц (/v/<id>, /sitemap.xml)
//
// Ключ: YT_API_KEY из переменных окружения Vercel, иначе — тот же публичный
// ключ, что и в js/core/config.js (он и так виден в браузере любому).
// Ответы кэшируются на CDN Vercel (заголовки в самих функциях), плюс здесь —
// в памяти «тёплого» инстанса функции, чтобы соседние запросы не тратили квоту.

const KEY = process.env.YT_API_KEY || 'AIzaSyA0dK2a1YG_s54zG-zapYgjycIempCvHp0';
const HANDLE = '@Dan4ik37Yt';
const API = 'https://www.googleapis.com/youtube/v3/';

export const SITE = 'https://dan4ik37.vercel.app';
export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const mem = new Map();
async function cached(key, ttlMs, fn) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  mem.set(key, { t: Date.now(), v });
  return v;
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

// Последние загрузки: [{ id, title, thumb, publishedAt }]. max — до 1000 (по 50 за запрос).
// ttlMs — сколько держать в памяти инстанса; api/push-check.js берёт свежие (0).
export function getUploads(max = 50, ttlMs = 3600e3) {
  return cached('uploads:' + max, ttlMs, async () => {
    const { uploads } = await getChannel();
    const out = [];
    let page = '';
    while (out.length < max) {
      const d = await api(`playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${uploads}${page ? '&pageToken=' + page : ''}`);
      for (const it of d.items || []) {
        const sn = it.snippet;
        if (sn.title === 'Private video' || sn.title === 'Deleted video') continue;
        out.push({
          id: it.contentDetails.videoId,
          title: sn.title,
          thumb: sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || '',
          publishedAt: it.contentDetails.videoPublishedAt || sn.publishedAt
        });
      }
      page = d.nextPageToken;
      if (!page) break;
    }
    return out.slice(0, max).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  });
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
