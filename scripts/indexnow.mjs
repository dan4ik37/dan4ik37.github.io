// Отправить все страницы сайта в IndexNow (Яндекс, Bing): node scripts/indexnow.mjs [pages|videos|all]
// Берёт адреса из живых карт сайта (/sitemap-pages.xml, /sitemap-videos.xml). Запускать после больших изменений
// (новые разделы, переделка страниц) — не чаще раза в несколько дней, иначе поисковик может счесть это спамом.
const SITE = 'https://dan4ik37.vercel.app';
const KEY = '351f920e862a819020eb7eb5ea035ac2';   // = INDEXNOW_KEY в api/_lib/indexnow.js и файл /<KEY>.txt
const part = process.argv[2] || 'pages';
const maps = part === 'all' ? ['pages', 'videos'] : [part];
const urls = [];
for (const m of maps) {
  const xml = await (await fetch(`${SITE}/sitemap-${m}.xml`)).text();
  for (const x of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(x[1].replace(/&amp;/g, '&'));
}
console.log('адресов:', urls.length);
const body = JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urls.slice(0, 10000) });
for (const ep of ['https://api.indexnow.org/indexnow', 'https://yandex.com/indexnow']) {
  const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body });
  console.log(ep, '→', r.status, (await r.text()).slice(0, 200));
}
