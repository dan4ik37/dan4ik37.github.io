// api/ids.js — /api/ids: id всех роликов канала одной строкой (для кнопки «🎲 Удиви меня»).
// Ответ кэширует CDN на 6 часов — нажатия кнопки не тратят квоту YouTube API.
// Формат: { ids: "id1id2id3…" } — id по 11 символов подряд (так в ~2 раза меньше, чем массив).
// /api/ids?t=1 — для поиска по всему архиву (Ctrl+K, hotkeys.js): { v: [[id, "название", "ГГГГ-ММ-ДД"], …] }.
import { ALL_UPLOADS, getUploads } from '../yt.js';

export default async function handler(req, res) {
  let vids = [];
  try { vids = await getUploads(ALL_UPLOADS); } catch (e) { /* пусто — клиент возьмёт /videos */ }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', vids.length ? 'public, s-maxage=21600, stale-while-revalidate=604800' : 'public, s-maxage=300');
  const body = req.query.t
    ? { v: vids.map(v => [v.id, v.title, String(v.publishedAt).slice(0, 10)]) }
    : { ids: vids.map(v => v.id).join('') };
  res.status(vids.length ? 200 : 503).send(JSON.stringify(body));
}
