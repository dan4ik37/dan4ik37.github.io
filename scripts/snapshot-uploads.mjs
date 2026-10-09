// Снимок всех роликов канала → api/_lib/uploads-snapshot.js (список) и api/_lib/video-details.js (подробности)
// Запуск из корня репозитория: node scripts/snapshot-uploads.mjs  (≈240 запросов к YouTube API, ≈240 ед. квоты)
//
// Зачем: весь архив (~6000 роликов) через API — это ~120 запросов подряд. На холодном кэше /videos, /topic/…,
// /history, /sitemap-*.xml и /api/ids («Удиви меня») ждали 25–35 секунд и каждый раз тратили квоту.
// Теперь getUploads() в api/_lib/yt.js берёт этот снимок и докачивает только новые ролики сверху (обычно один запрос).
// Подробности (описание, длительность, просмотры, теги) — для страниц /v/<id>: после отправки 6000 адресов в поисковики
// их роботы обходят ролики тысячами, и каждый поход в API съедал бы общую квоту с главной сайта. Ролики, которых
// нет в снимке (новые), страница по-прежнему берёт из API. Удалили/скрыли много роликов — перезапустить скрипт.
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
  process.stdout.write('\rсписок: ' + rows.length + '…');
} while (page);
rows.sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));

// Подробности — по 50 id за запрос: [длительность ISO, просмотры, лайки, есть maxres-превью (1/0), описание (до 1500), теги (до 12)]
const details = {};
for (let i = 0; i < rows.length; i += 50) {
  const ids = rows.slice(i, i + 50).map(r => r[0]).join(',');
  const d = await api(`videos?part=snippet,contentDetails,statistics&id=${ids}`);
  for (const v of d.items || []) {
    const sn = v.snippet || {}, st = v.statistics || {};
    details[v.id] = [v.contentDetails?.duration || '', +st.viewCount || 0, +st.likeCount || 0, sn.thumbnails?.maxres ? 1 : 0,
      (sn.description || '').slice(0, 1500), (sn.tags || []).slice(0, 12)];
  }
  process.stdout.write('\rподробности: ' + Object.keys(details).length + '…');
}

// Описаний на канале всего ~1000 разных на 6000 роликов (#shorts, промокоды, ссылки повторяются) — храним каждое
// описание и набор тегов один раз, а у ролика — их номера: файл в ~5 раз меньше
const descs = [], descIdx = new Map(), tagSets = [], tagIdx = new Map();
const pick = (list, idx, key, val) => { if (!idx.has(key)) { idx.set(key, list.length); list.push(val); } return idx.get(key); };
const compact = {};
for (const [id, [dur, views, likes, maxres, desc, tags]] of Object.entries(details))
  compact[id] = [dur, views, likes, maxres, pick(descs, descIdx, desc, desc), pick(tagSets, tagIdx, tags.join('\u0001'), tags)];

const day = new Date().toISOString().slice(0, 10);
fs.writeFileSync('api/_lib/uploads-snapshot.js',
`// Снимок списка роликов канала: ${rows.length} шт. на ${day}. Создан scripts/snapshot-uploads.mjs — руками не править.
// Строка на ролик: id<TAB>дата публикации (ISO)<TAB>название; от новых к старым.
export const SNAPSHOT_AT = '${day}';
export const SNAPSHOT = ${JSON.stringify(rows.map(r => r.join('\t')).join('\n'))};
`);
fs.writeFileSync('api/_lib/video-details.js',
`// Подробности роликов для страниц /v/<id>: ${Object.keys(details).length} шт. на ${day}. Создан scripts/snapshot-uploads.mjs — руками не править.
// { d: [описания], t: [наборы тегов], v: { id: [длительность ISO, просмотры, лайки, есть maxres-превью, № описания, № тегов] } }
// — JSON строкой (разбор при первом обращении).
export const DETAILS_AT = '${day}';
export const DETAILS_JSON = ${JSON.stringify(JSON.stringify({ d: descs, t: tagSets, v: compact }))};
`);
console.log('\nготово:', rows.length, 'роликов, подробности —', Object.keys(details).length);
