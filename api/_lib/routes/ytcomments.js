// /api/ytcomments?id=<ролик>[&parent=<ветка>] — 💬 комментарии с YouTube для окна комментариев сайта (js/features/ytcomments.js;
// владелец 26.11: «можно ли сделать комменты от ютуба и убрать лишнее»). Читаем ключом сайта (yt.js), НЕ токеном человека:
//  без parent — 20 верхних веток ролика (commentThreads.list, order=relevance), с parent — ответы этой ветки (comments.list), по 1 ед.
// Только ролики канала и не спрятанные (как /api/vstats — routes/vstats.js ownVideo); чужой id → 404 без похода в API.
// Квота (общая с главной, /v/<id>, /api/vstats): CDN держит ответ 10 мин на адрес, память инстанса — тоже (yt.js YTC_TTL_S); не больше
// BUDGET походов в API за 10 мин на инстанс — дальше 503 'busy' на минуту (окно скажет «открыть на YouTube»); кончилась квота YouTube —
// 503 'quota' на 5 мин. Комментарии отключены у ролика — 200 { disabled: true }.
// Ответ: { id, parent, at, items: [{ id, author, authorUrl, text, likes, at, replies }], disabled? } — at: когда YouTube отдал (подпись
// «обновлено ЧЧ:ММ», правила YouTube API III.E.4). Текст — простой (textFormat=plainText); страница выводит его только как текст.
import { VIDEO_ID_RE, YTC_TTL_S, getCommentThreads, getCommentReplies } from '../yt.js';
import { ownVideo } from './vstats.js';

export const BUDGET = 40;           // походов в API за окно на инстанс (≈ 5 800 ед. в сутки в худшем случае на инстанс; CDN режет повторы)
const WINDOW_MS = YTC_TTL_S * 1000;
const PARENT_RE = /^[A-Za-z0-9_-]{10,100}$/;
let spent = [];
const seen = new Map();             // ключ → когда ходили в API (в окне — ответ из памяти yt.js, бюджет не тратит)

const send = (res, code, maxAge, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', `public, s-maxage=${maxAge}, stale-while-revalidate=${Math.min(maxAge, 300)}`);
  res.status(code).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  const id = String(req.query.id || ''), parent = String(req.query.parent || '');
  if (!VIDEO_ID_RE.test(id) || (parent && !PARENT_RE.test(parent))) return send(res, 400, 86400, { error: 'bad id' });
  if (!(await ownVideo(id))) return send(res, 404, 3600, { error: 'not found' });
  const key = parent ? 'r:' + parent : 'v:' + id;
  const now = Date.now();
  spent = spent.filter(t => now - t < WINDOW_MS);
  for (const [k, t] of seen) if (now - t >= WINDOW_MS) seen.delete(k);
  const inMem = seen.has(key);
  if (!inMem && spent.length >= BUDGET) return send(res, 503, 60, { error: 'busy' });
  if (!inMem) { spent.push(now); seen.set(key, now); }
  try {
    const d = parent ? await getCommentReplies(parent) : await getCommentThreads(id);
    return send(res, 200, YTC_TTL_S, { id, parent: parent || '', ...d });
  } catch (e) {
    seen.delete(key);
    if (/quotaExceeded|dailyLimitExceeded/.test(String(e?.reason || ''))) return send(res, 503, 300, { error: 'quota' });
    if (e?.status === 404 || /commentNotFound|videoNotFound/.test(String(e?.reason || ''))) return send(res, 404, 600, { error: 'not found' });
    return send(res, 503, 60, { error: 'unavailable' });
  }
}

// для проверки (scripts/ytcomments-test.cjs): обнулить счёт походов
export function _resetBudget() { spent = []; seen.clear(); }
