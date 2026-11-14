// «Что нового» (/news) без сети: данные api/_lib/news-posts.js (адреса, даты, снимки есть и < 200 КБ, текст), страницы
// api/_lib/routes/news.js (список без рекламы, запись с рекламой только при ≥ 150 словах, 404 noindex, RSS — правильный XML),
// карта сайта и rewrites vercel.json. Запуск из корня сайта: node scripts/news-test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const imp = f => import(pathToFileURL(path.join(ROOT, f)).href);

const { POSTS, TAGS } = await imp('api/_lib/news-posts.js');
const N = await imp('api/_lib/routes/news.js');
const call = async query => {
  const r = { code: 0, headers: {}, body: '' };
  const res = { setHeader: (k, v) => { r.headers[k.toLowerCase()] = v; }, status(c) { r.code = c; return res; }, send(b) { r.body = String(b); return res; } };
  await N.default({ query }, res);
  return r;
};

// ── данные ──
ok(Array.isArray(POSTS) && POSTS.length >= 1, 'posts exist');
const slugs = new Set();
for (const p of POSTS) {
  const id = p.slug;
  ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug || '') && p.slug.length <= 80, 'slug format', id);
  ok(!slugs.has(p.slug), 'slug unique', id); slugs.add(p.slug);
  ok(/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(p.date || '') && !isNaN(Date.parse(p.date)), 'date format', id);
  ok(TAGS[p.tag], 'known tag', id);
  ok(typeof p.title === 'string' && p.title.length >= 10 && p.title.length <= 120, 'title length', id);
  ok(typeof p.lead === 'string' && p.lead.length >= 40 && p.lead.length <= 300, 'lead length (description)', [id, p.lead?.length]);
  ok(Array.isArray(p.body) && p.body.every(b => typeof b.p === 'string' || typeof b.h === 'string' || (Array.isArray(b.ul) && b.ul.every(x => typeof x === 'string'))), 'body blocks', id);
  ok((p.shots || []).length <= 3, 'at most 3 shots', id);
  for (const s of p.shots || []) {
    const f = path.join(ROOT, s.src.replace(/^\//, ''));
    ok(/^\/img\/news\/[a-z0-9-]+\.(webp|jpg)$/.test(s.src) && fs.existsSync(f), 'shot file exists', s.src);
    ok(fs.existsSync(f) && fs.statSync(f).size < 200 * 1024, 'shot < 200 KB', s.src);
    ok(s.alt && s.alt.length >= 5 && s.w > 0 && s.h > 0, 'shot alt + size', s.src);
  }
  for (const [h] of p.links || []) ok(/^\/[\w\-/]*$/.test(h) && (!h.startsWith('/news/') || POSTS.some(q => '/news/' + q.slug === h)), 'link is local and alive', [id, h]);
}

// ── список ──
const L = await call({});
ok(L.code === 200 && /<h1>Что нового/.test(L.body), 'index 200');
ok(!/adsbygoogle\.js/.test(L.body) && !/data-ad=/.test(L.body), 'index has no ads');
ok(POSTS.every(p => L.body.includes(`href="/news/${p.slug}"`)), 'index links every post');
ok(/rel="canonical" href="https:\/\/[^"]+\/news"/.test(L.body), 'index canonical');
ok(/application\/rss\+xml/.test(L.body), 'index rss alternate');
const order = POSTS.map(p => p.date).slice().sort().reverse();
ok(order[0] === [...L.body.matchAll(/<time datetime="([\d-]+)"/g)][0]?.[1], 'index newest first');

// ── записи ──
for (const p of POSTS) {
  const r = await call({ slug: p.slug });
  const words = N.wordCount(p), ads = N.NEWS_ADS && words >= N.ADS_MIN_WORDS;
  ok(r.code === 200 && r.body.includes('"@type":"BlogPosting"'), 'post 200 + ld', p.slug);
  ok(/<meta name="robots" content="max-image-preview:large">/.test(r.body), 'post indexable', p.slug);
  ok(ads === /data-ad="forum_article"/.test(r.body) && ads === /adsbygoogle\.js/.test(r.body), 'ads only with enough own text', [p.slug, words]);
  ok((r.body.match(/data-ad=/g) || []).length <= 1, 'one ad place at most', p.slug);
  ok(!/<script>alert/.test(r.body), 'no raw script', p.slug);
}
// злая строка в данных — только текстом
POSTS.push({ slug: 'zz-test', date: '2020-01-01', tag: 'site', title: 'Проверка <script>alert(1)</script>', lead: 'Описание "><img src=x onerror=alert(1)> для проверки экранирования текста записи.',
  shots: [], body: [{ p: '<b>жирный</b>' }, { ul: ['<i>x</i>'] }], links: [['javascript:alert(1)', 'плохая']] });
const X = await call({ slug: 'zz-test' });
ok(!X.body.includes('<script>alert(1)') && !X.body.includes('<img src=x') && !X.body.includes('<b>жирный') && !X.body.includes('href="javascript:'), 'evil strings escaped');
POSTS.pop();

// ── 404, RSS ──
const E = await call({ slug: 'nope-nope' });
ok(E.code === 404 && /content="noindex"/.test(E.body) && !/adsbygoogle\.js/.test(E.body), '404 noindex without ads');
const R = await call({ rss: '1' });
ok(R.code === 200 && /^application\/rss\+xml/.test(R.headers['content-type']) && R.body.startsWith('<?xml'), 'rss 200');
ok((R.body.match(/<item>/g) || []).length === Math.min(30, POSTS.length), 'rss items');
ok(!/&(?!(amp|lt|gt|quot|#39);)/.test(R.body) && [...R.body.matchAll(/<(title|description)>([^]*?)<\/>/g)].every(m => !/[<>]/.test(m[2])), 'rss well-formed entities');

// ── карта сайта и rewrites ──
ok(N.newsUrls().length === POSTS.length, 'sitemap urls');
const sm = fs.readFileSync(path.join(ROOT, 'api/sitemap.js'), 'utf8');
ok(/newsUrls\(\)/.test(sm) && /\/news`/.test(sm), 'sitemap includes /news');
const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const rw = (vj.rewrites || []).map(r => r.source + ' ' + r.destination);
ok(rw.includes('/news /api/pages?page=news') && rw.includes('/news/rss.xml /api/pages?page=news&rss=1') && rw.includes('/news/:slug /api/pages?page=news&slug=:slug'), 'vercel rewrites');
ok(rw.indexOf('/news/rss.xml /api/pages?page=news&rss=1') < rw.indexOf('/news/:slug /api/pages?page=news&slug=:slug'), 'rss rewrite before slug');
ok(/news/.test(fs.readFileSync(path.join(ROOT, 'api/pages.js'), 'utf8')), 'pages.js route');

console.log(`news-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
