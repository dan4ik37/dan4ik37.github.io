// IndexNow — сразу сообщить Яндексу и Bing (а через Bing — DuckDuckGo, Yahoo, поиску ChatGPT) о новых страницах,
// не дожидаясь, пока робот сам их найдёт. Протокол открытый, без входа в кабинеты.
// Ключ лежит файлом в корне сайта: /<KEY>.txt (внутри — сам ключ): так поисковик убеждается, что сайт наш.
// Не удалять файл ключа! Вызовы: api/push-check.js (новое видео), scripts/indexnow.mjs (вручную — все страницы).
import { SITE } from './yt.js';

export const INDEXNOW_KEY = '351f920e862a819020eb7eb5ea035ac2';
const ENDPOINTS = ['https://api.indexnow.org/indexnow', 'https://yandex.com/indexnow'];

// urls — полные адреса этого сайта (до 10 000 за раз). Ответ: { 'api.indexnow.org': 200, 'yandex.com': 202 }
export async function indexNow(urls) {
  const urlList = [...new Set(urls)].filter(u => typeof u === 'string' && u.startsWith(SITE)).slice(0, 10000);
  if (!urlList.length) return {};
  const body = JSON.stringify({ host: new URL(SITE).host, key: INDEXNOW_KEY, keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`, urlList });
  const res = await Promise.allSettled(ENDPOINTS.map(u => fetch(u, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body, signal: AbortSignal.timeout(8000),
  })));
  return Object.fromEntries(ENDPOINTS.map((u, i) => [new URL(u).host, res[i].status === 'fulfilled' ? res[i].value.status : 'error']));
}
