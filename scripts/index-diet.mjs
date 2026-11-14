// scripts/index-diet.mjs — what the sitemaps hand to search engines and whether each page has our own text (AdSense 14.11:
// «Бесполезный контент»). Renders api/sitemap.js locally (pages + videos), then renders every sitemap-pages URL through its own
// handler (vercel.json rewrites → api/pages.js / api/game.js / static html) and counts visible words outside <script>/<style>.
// Also checks: a URL in a sitemap must not answer noindex. Run: node scripts/index-diet.mjs [--prod] [--list]
//   --prod  also count the live sitemaps (before/after comparison); --list  print every URL with its word count.
// Forum articles, ideas and player games come from Supabase — without SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY they are absent
// locally (the live counts are printed with --prod).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const SITE = 'https://dan4ik37.vercel.app';
const imp = p => import(pathToFileURL(path.join(ROOT, p)).href);

function mock(query) {
  const r = { code: 200, headers: {}, body: '' };
  const res = {
    setHeader(k, v) { r.headers[k.toLowerCase()] = v; return res; },
    getHeader(k) { return r.headers[k.toLowerCase()]; },
    status(c) { r.code = c; return res; },
    send(b) { r.body = String(b); return res; },
    end(b) { if (b) r.body = String(b); return res; },
    json(o) { r.body = JSON.stringify(o); return res; },
    redirect(c, u) { r.code = typeof c === 'number' ? c : 302; return res; },
  };
  return { req: { query, method: 'GET', headers: {}, url: '/' }, res, r };
}
const locs = xml => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));

async function sitemap(part) {
  const { default: h } = await imp('api/sitemap.js');
  const { req, res, r } = mock({ part });
  await h(req, res);
  return locs(r.body);
}

// vercel.json rewrite → local target
const VJ = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
function route(pathname) {
  for (const rw of VJ.rewrites) {
    const names = [];
    const re = new RegExp('^' + rw.source.replace(/:(\w+)\+/g, (_, n) => { names.push(n); return '(.+)'; })
      .replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    const m = pathname.match(re);
    if (!m) continue;
    let dest = rw.destination;
    names.forEach((n, i) => { dest = dest.replace(':' + n, encodeURIComponent(m[i + 1])); });
    return dest;
  }
  return null;
}
async function render(u) {
  const url = new URL(u, SITE);
  const dest = route(url.pathname) || (url.pathname === '/' ? '/index.html' : null);
  if (!dest) return { code: 0, body: '', headers: {} };
  const d = new URL(dest, SITE);
  if (/\.html$/.test(d.pathname)) {
    const body = fs.readFileSync(path.join(ROOT, d.pathname), 'utf8');
    return { code: 200, body, headers: headerRules(url.pathname) };
  }
  const query = Object.fromEntries(d.searchParams);
  for (const [k, v] of url.searchParams) query[k] = v;
  const { default: h } = await imp(d.pathname.replace(/^\//, '') + '.js');
  const { req, res, r } = mock(query);
  await h(req, res);
  return { code: r.code, body: r.body, headers: { ...headerRules(url.pathname), ...r.headers } };
}
// vercel.json "headers" for one path (exact, :path+, :path*, (a|b) groups)
function headerRules(pathname) {
  const out = {};
  for (const h of VJ.headers) {
    const re = new RegExp('^' + h.source.replace(/:(\w+)\(([^)]+)\)/g, '($2)').replace(/:(\w+)\+/g, '.+').replace(/:(\w+)\*/g, '.*').replace(/\/\(\.\*\)$/, '/.*') + '$');
    if (re.test(pathname)) for (const x of h.headers) out[x.key.toLowerCase()] = x.value;
  }
  return out;
}
function words(html) {
  const main = (html.match(/<main[\s\S]*<\/main>/i) || [html.replace(/^[\s\S]*?<body[^>]*>/i, '')])[0];
  return main.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ').replace(/[^\p{L}\p{N}\s'-]+/gu, ' ').split(/\s+/).filter(w => w.length > 1).length;
}
const noindexOf = x => /noindex/i.test(x.headers['x-robots-tag'] || '') || /<meta name="robots" content="[^"]*noindex/i.test(x.body);
const typeOf = u => { const p = new URL(u).pathname; return p === '/' ? '/' : '/' + p.split('/').filter(Boolean).slice(0, p.startsWith('/tools/') ? 2 : 1).join('/') + (p.split('/').filter(Boolean).length > (p.startsWith('/tools/') ? 2 : 1) ? '/*' : ''); };

const pages = await sitemap('pages');
const videos = await sitemap('videos');
const types = {};
const bad = [];
for (const u of pages) {
  let x;
  try { x = await render(u); } catch (e) { x = { code: -1, body: String(e), headers: {} }; }
  const w = words(x.body), t = typeOf(u);
  (types[t] ||= { n: 0, min: Infinity }).n++;
  types[t].min = Math.min(types[t].min, w);
  if (args.has('--list')) console.log(String(w).padStart(5), x.code, u.replace(SITE, ''));
  if (x.code !== 200 || noindexOf(x)) bad.push(`${u.replace(SITE, '')} → ${x.code}${noindexOf(x) ? ' noindex' : ''}`);
}
console.log('sitemap-pages (local):', pages.length, '· sitemap-videos (local):', videos.length, '· total indexable in sitemaps:', pages.length + videos.length);
console.log('page types kept (count · min words in <main>):');
for (const [t, v] of Object.entries(types).sort()) console.log('  ', t.padEnd(16), String(v.n).padStart(4), '·', v.min);
if (bad.length) { console.log('IN SITEMAP BUT NOT 200 / NOINDEX:'); bad.forEach(b => console.log('  ', b)); }

// Thin page types (index diet, api/_lib/page.js INDEX_DIET) must answer noindex and stay reachable (200) for viewers.
const { getUploads, ALL_UPLOADS } = await imp('api/_lib/yt.js');
const ALL = await getUploads(ALL_UPLOADS).catch(() => []);
const { snapIndexable } = await imp('api/_lib/video-snap.js');
const thinVid = ALL.find(v => !snapIndexable(v) && !/#shorts/i.test(v.title));
const keepVid = ALL.find(v => snapIndexable(v));
const DROP = ['/videos', '/videos?p=2', '/top', '/topics', '/topic/roblox', '/history', '/ideas', '/chat', '/chat/abc', '/shorts', '/profile',
  '/donate', '/lfg', '/hub', ...(thinVid ? ['/v/' + thinVid.id] : [])];
for (const p of DROP) {
  const x = await render(SITE + p);
  if (!noindexOf(x) || x.code !== 200) bad.push(`${p} → ${x.code}${noindexOf(x) ? '' : ' INDEXABLE'} (thin page must be 200 + noindex)`);
}
if (keepVid) { const x = await render(SITE + '/v/' + keepVid.id); if (noindexOf(x)) bad.push(`/v/${keepVid.id} has own text but answers noindex`); }
console.log(`thin types checked noindex: ${DROP.length}${keepVid ? ' · /v/ with own text indexable: /v/' + keepVid.id : ''}`);
if (bad.length) { console.log('PROBLEMS:'); bad.forEach(b => console.log('  ', b)); }

if (args.has('--prod')) {
  const get = async p => locs(await (await fetch(SITE + p)).text());
  const [pp, pv] = await Promise.all([get('/sitemap-pages.xml'), get('/sitemap-videos.xml')]);
  console.log('live now: sitemap-pages', pp.length, '· sitemap-videos', pv.length, '· total', pp.length + pv.length);
}
process.exitCode = bad.length ? 1 : 0;
