// /api/vstats?id=<id> — свежие просмотры и лайки ОДНОГО ролика канала (YouTube Data API videos.list, 1 ед. квоты).
// Зачем (владелец 05.11: «ставил лайк, и он не работал»): сайт сам лайк на YouTube не ставит и не видит — кнопка
// «👍 Лайк на YouTube» (js/core/vlike.js) открывает ролик на YouTube, лайк ставится там. Человек вернулся на сайт — страница
// спрашивает здесь настоящие цифры этого ролика и пишет «обновлено ЧЧ:ММ». Настоящий лайк с сайта — вход через Google с правом
// youtube.force-ssl + videos.rate + проверка приложения в Google (docs/areas/architecture.md, «Видео») — не сделано, решает владелец.
// Квота (общая с главной и страницами роликов): CDN держит ответ 10 мин на ролик (у адреса с ?id= свой кэш), память инстанса — тоже
// 10 мин (yt.js getVideoLive); только ролики канала — снимок + свежие загрузки, чужой id → 404 без похода в API; не больше BUDGET
// походов в API за 10 мин на инстанс — дальше цифры снимка с его датой (src 'snapshot'), так же при ошибке API.
// Ответ: { id, views, likes, at, src } — at: когда YouTube отдал цифры (ISO; у снимка — день снимка), src: 'live' | 'snapshot'.
import { VIDEO_ID_RE, ALL_UPLOADS, SNAPSHOT_AT, VSTATS_TTL_S, getUploads, getVideoLive, snapshotById, hiddenVideo } from '../yt.js';
import { videoFromSnapshot } from '../video-snap.js';

export const BUDGET = 30;           // походов в API за окно на инстанс (≈ 4 300 ед. в сутки в худшем случае — меньше половины квоты)
const WINDOW_MS = VSTATS_TTL_S * 1000;
let spent = [];                     // время походов в API (только за последнее окно)
const lastLive = new Map();         // id → когда ходили в API за этим роликом (в окне — ответ из памяти yt.js, бюджет не тратит)

const send = (res, code, maxAge, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', `public, s-maxage=${maxAge}, stale-while-revalidate=${Math.min(maxAge, 300)}`);
  res.status(code).send(JSON.stringify(obj));
};

function fromSnapshot(id) {
  const st = videoFromSnapshot(id)?.statistics;
  return st && st.viewCount ? { id, views: +st.viewCount || 0, likes: +st.likeCount || 0, at: SNAPSHOT_AT, src: 'snapshot' } : null;
}

// Ролик этого канала и не спрятан (кейсы/депозит — yt.js hiddenVideo)? Снимок — без сети; новее снимка — загрузки (память 1 ч)
async function ownVideo(id) {
  const snap = snapshotById(id);
  if (snap) return !hiddenVideo(id, snap.title);
  let list = [];
  try { list = await getUploads(ALL_UPLOADS); } catch (e) { return false; }
  return list.some(v => v.id === id);   // getUploads уже без спрятанных
}

export default async function handler(req, res) {
  const id = String(req.query.id || '');
  if (!VIDEO_ID_RE.test(id)) return send(res, 400, 86400, { error: 'bad id' });
  if (!(await ownVideo(id))) return send(res, 404, 3600, { error: 'not found' });

  const now = Date.now();
  spent = spent.filter(t => now - t < WINDOW_MS);
  for (const [k, t] of lastLive) if (now - t >= WINDOW_MS) lastLive.delete(k);
  const inMem = lastLive.has(id);
  if (inMem || spent.length < BUDGET) {
    if (!inMem) { spent.push(now); lastLive.set(id, now); }
    try {
      const v = await getVideoLive(id);
      if (v) return send(res, 200, VSTATS_TTL_S, { ...v, src: 'live' });
    } catch (e) { lastLive.delete(id); /* квота / сеть — ниже снимок; следующий поход — снова из бюджета */ }
  }
  const snap = fromSnapshot(id);
  if (snap) return send(res, 200, 120, snap);   // снимок — ненадолго: через 2 мин попробуем снова
  return send(res, 503, 60, { error: 'unavailable' });
}

// для проверки (scripts/video-test.cjs): обнулить счёт походов
export function _resetBudget() { spent = []; lastLive.clear(); }
