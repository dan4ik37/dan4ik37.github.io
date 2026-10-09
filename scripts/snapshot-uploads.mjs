// Снимок списка всех роликов канала → api/_lib/uploads-snapshot.js
// Запуск из корня репозитория: node scripts/snapshot-uploads.mjs  (≈120 запросов к YouTube API, ≈120 ед. квоты)
//
// Зачем: весь архив (~6000 роликов) через API — это ~120 запросов подряд. На холодном кэше /videos, /topic/…,
// /history, /sitemap-*.xml и /api/ids («Удиви меня») ждали 25–35 секунд и каждый раз тратили квоту.
// Теперь getUploads(ALL_UPLOADS) в api/_lib/yt.js берёт этот снимок и докачивает только новые ролики сверху
// (обычно один запрос). Если на канале удалили или скрыли много роликов — перезапустить скрипт.
import fs from 'fs';

const KEY = process.env.YT_API_KEY || 'AIzaSyA0dK2a1YG_s54zG-zapYgjycIempCvHp0';
const SITE = 'https://dan4ik37.vercel.app';
const api = async path => {
  const r = await fetch('https://www.googleapis.com/youtube/v3/' + path + '&key=' + KEY, { headers: { Referer: SITE + '/' } });
  if (!r.ok) throw new Error('YouTube API ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.json();
};

const ch = await api('channels?part=contentDetails&forHandle=' + encodeURIComponent('@Dan4ik37Yt'));
const uploads = ch.items[0].contentDetails.relatedPlaylists.uploads;
const rows = [];
let page = '';
do {
  const d = await api(`playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${uploads}${page ? '&pageToken=' + page : ''}`);
  for (const it of d.items || []) {
    const sn = it.snippet;
    if (sn.title === 'Private video' || sn.title === 'Deleted video') continue;
    rows.push([it.contentDetails.videoId, it.contentDetails.videoPublishedAt || sn.publishedAt, sn.title.replace(/[\t\r\n]+/g, ' ').trim()]);
  }
  page = d.nextPageToken;
  process.stdout.write('\r' + rows.length + ' роликов…');
} while (page);
rows.sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));

const day = new Date().toISOString().slice(0, 10);
fs.writeFileSync('api/_lib/uploads-snapshot.js',
`// Снимок списка роликов канала: ${rows.length} шт. на ${day}. Создан scripts/snapshot-uploads.mjs — руками не править.
// Строка на ролик: id<TAB>дата публикации (ISO)<TAB>название; от новых к старым.
export const SNAPSHOT_AT = '${day}';
export const SNAPSHOT = ${JSON.stringify(rows.map(r => r.join('\t')).join('\n'))};
`);
console.log('\nготово:', rows.length, 'роликов → api/_lib/uploads-snapshot.js');
