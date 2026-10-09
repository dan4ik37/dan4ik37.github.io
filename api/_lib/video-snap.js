// Ролик из снимка (uploads-snapshot.js + video-details.js) в том же виде, что ответ YouTube API videos.list.
// Зачем: страницы /v/<id> обходят роботы поисковиков тысячами (все 6000 адресов отправлены в IndexNow), и каждый
// поход в API тратил бы квоту, общую с главной сайта (там список видео берётся тем же ключом). Теперь известные
// ролики — без API; новых (вышли после снимка) в снимке нет — для них null, и страница берёт их из API.
import { DETAILS_JSON } from './video-details.js';
import { snapshotById } from './yt.js';

let details = null;
export function videoFromSnapshot(id) {
  const base = snapshotById(id);
  if (!base) return null;
  if (!details) { try { details = JSON.parse(DETAILS_JSON); } catch (e) { details = { d: [], t: [], v: {} }; } }
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
