// Ролик из снимка (uploads-snapshot.js + video-details.js) в том же виде, что ответ YouTube API videos.list.
// Зачем: страницы /v/<id> обходят роботы поисковиков тысячами (все 6000 адресов отправлены в IndexNow), и каждый
// поход в API тратил бы квоту, общую с главной сайта (там список видео берётся тем же ключом). Теперь известные
// ролики — без API; новых (вышли после снимка) в снимке нет — для них null, и страница берёт их из API.
import { snapshotById, snapDetails, isShortVideo, ownWords, VIDEO_OWN_WORDS } from './yt.js';

export function videoFromSnapshot(id) {
  const base = snapshotById(id);
  if (!base) return null;
  const details = snapDetails();
  const [duration = '', views = 0, likes = 0, maxres = 0, di = -1, ti = -1] = details.v[id] || [];
  const description = details.d[di] || '', tags = details.t[ti] || [];
  const img = q => ({ url: `https://i.ytimg.com/vi/${id}/${q}.jpg` });
  return {
    id,
    snippet: { title: base.title, description, publishedAt: base.publishedAt, tags,
      thumbnails: { ...(maxres ? { maxres: img('maxresdefault') } : {}), high: img('hqdefault'), medium: img('mqdefault') } },
    contentDetails: { duration },
    statistics: views ? { viewCount: String(views), likeCount: String(likes) } : {},
  };
}

// Ролик из снимка годится для поиска и карты сайта (14.11.2026, page.js INDEX_DIET): не шортс и в описании есть свой текст автора
// (≥ VIDEO_OWN_WORDS слов, yt.js ownWords). Ролика нет в снимке (вышел позже) — описания не знаем, в карту не идёт.
export function snapIndexable(v) {
  const x = videoFromSnapshot(v.id);
  if (!x) return false;
  return !isShortVideo(v.title, v.publishedAt, x.contentDetails.duration) && ownWords(x.snippet.description) >= VIDEO_OWN_WORDS;
}
