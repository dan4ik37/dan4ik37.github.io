// /api/feed — список последних роликов и цифры канала для главной (js/features/youtube.js → loadYT).
// Зачем: раньше браузер каждого нового посетителя сам ходил в YouTube API (~7 единиц квоты на человека), и при
// росте трафика квота кончилась бы — а она общая со страницами роликов. Теперь список собирает сервер (снимок +
// свежие ролики, просмотры — один пакетный запрос на 50 роликов), а CDN отдаёт его всем 15 минут из кэша:
// расход квоты не зависит от числа посетителей. Не ответил — главная по-старому идёт в YouTube API сама.
// Формат: { channelId, stats: { subs, views, vids }, vids: [{ id, title, thumb, ts, views, likes, duration }] }
import { getChannel, getChannelStats, getUploads, getVideoStats } from '../yt.js';
import { videoFromSnapshot } from '../video-snap.js';

const COUNT = 150;   // как у браузера: больше половины — Shorts, обычным роликам в сетке нужен запас

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const [ch, cs, list] = await Promise.all([getChannel(), getChannelStats(), getUploads(COUNT)]);
    const top = list.slice(0, COUNT);
    const fresh = new Map();
    for (let i = 0; i < top.length; i += 50) {
      try { (await getVideoStats(top.slice(i, i + 50).map(v => v.id))).forEach(s => fresh.set(s.id, s)); } catch (e) { /* без свежих — из снимка */ }
    }
    const vids = top.map(v => {
      const s = fresh.get(v.id), snap = s ? null : videoFromSnapshot(v.id);
      return {
        id: v.id, title: v.title, thumb: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, ts: Date.parse(v.publishedAt) || 0,
        views: +(s?.viewCount ?? snap?.statistics?.viewCount ?? 0), likes: +(s?.likeCount ?? snap?.statistics?.likeCount ?? 0),
        duration: s?.duration || snap?.contentDetails?.duration || '',
      };
    });
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
    res.status(200).send(JSON.stringify({
      channelId: ch.id,
      stats: { subs: +cs.subscriberCount || 0, views: +cs.viewCount || 0, vids: +cs.videoCount || 0 },
      vids,
    }));
  } catch (e) {
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    res.status(503).send(JSON.stringify({ error: 'unavailable' }));
  }
}
