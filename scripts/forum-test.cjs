// T-157 форум 2.0 без браузера и сети: проверка блоков (api/_lib/forum-blocks.js — те же причины, что forum_check в forum.sql),
// ссылки на видео (только YouTube / VK Видео / RuTube / Twitch → провайдер + id), адреса плееров, HTML статьи для серверной страницы
// (злые строки не становятся разметкой), адрес-«слаг», дерево комментариев, разметка редактора (**жирный**, *курсив*, [текст](https://…)),
// отрисовка блоков в браузере (js/features/forum2.js на маленьком DOM: только textContent, ссылки только https с rel="nofollow ugc noopener",
// iframe видео — только после нажатия), свежесть js/features/forum-blocks.js. Запуск из корня сайта: node scripts/forum-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const SITE = process.argv[2] || path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

(async () => {
  const { makeForumBlocks } = await import(pathToFileURL(path.join(SITE, 'api/_lib/forum-blocks.js')).href);
  const B = makeForumBlocks();
  // ── свежесть копии для браузера ──
  let fresh = true; try { execFileSync(process.execPath, [path.join(SITE, 'scripts/make-forum-blocks.mjs'), SITE, '--check'], { stdio: 'pipe' }); } catch (e) { fresh = false; }
  ok(fresh, 'js/features/forum-blocks.js is fresh (node scripts/make-forum-blocks.mjs)');
  const ctx = { window: {}, URL }; ctx.globalThis = ctx.window; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'js/features/forum-blocks.js'), 'utf8'), ctx);
  ok(ctx.window.D37ForumBlocks && typeof ctx.window.D37ForumBlocks.check === 'function', 'browser copy defines window.D37ForumBlocks');

  // ── проверка: те же причины, что forum.sql (scripts/forum-sql-test.mjs) ──
  const U = '11111111-1111-1111-1111-111111111111';
  const c = (d, o) => B.check(d, Object.assign({ publish: true, uid: U }, o));
  const T = 'Заголовок нормальный', P = x => ({ t: 'p', r: [{ x }] });
  ok(c({ title: T, blocks: [{ t: 'script' }] }).reason === 'block_type', 'unknown block type');
  ok(c({ title: T, blocks: [{ t: 'p', r: [{ x: 'a', h: 'javascript:alert(1)' }] }] }).reason === 'link', 'javascript: link');
  ok(c({ title: T, blocks: [{ t: 'p', r: [{ x: 'a', h: 'http://example.com' }] }] }).reason === 'link', 'http link');
  ok(c({ title: T, blocks: [{ t: 'p', r: [{ x: 'a', h: 'https://user@evil.com/' }] }] }).reason === 'link', 'userinfo link');
  ok(c({ title: T, blocks: [{ t: 'p', r: [{ x: 'a', h: 'https://ex.com/"><script>' }] }] }).reason === 'link', 'quote in link');
  ok(c({ title: T, blocks: [{ t: 'video', p: 'yt', id: '<iframe>' }] }).reason === 'video', 'bad video id');
  ok(c({ title: T, blocks: [{ t: 'video', p: 'dailymotion', id: 'x7abc' }] }).reason === 'video', 'provider not allowed');
  ok(c({ title: T, blocks: [P('a'.repeat(5001))] }).reason === 'text_long', 'paragraph > 5000');
  ok(c({ title: 'Ку', blocks: [] }).reason === 'title_short', 'title short on publish');
  ok(c({ title: '', blocks: [] }, { publish: false }).ok, 'empty draft ok');
  ok(c({ title: T, blocks: Array(61).fill({ t: 'hr' }) }).reason === 'blocks_many', '61 blocks');
  ok(c({ title: T, blocks: [{ t: 'img', src: U + '/abcdefabcdefabcdef.webp' }] }).reason === 'media_off', 'media off');
  ok(c({ title: T, blocks: [{ t: 'img', src: '22222222-2222-2222-2222-222222222222/abcdefabcdefabcdef.webp' }] }, { media: true }).reason === 'media_key', 'someone else image');
  ok(c({ title: T, blocks: [{ t: 'file', key: U + '/abcdefabcdefabcdef.exe', name: 'a.exe' }] }, { media: true }).reason === 'media_type', 'exe file');
  ok(c({ title: T, tags: ['<b>'], blocks: [P('текст текст текст текст')] }).reason === 'tag', 'bad tag');
  ok(c({ title: T, tags: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'], blocks: [P('текст текст текст текст')] }).reason === 'tags_many', '6 tags');
  ok(c({ title: T, source_url: 'ftp://x.ru/a', blocks: [P('текст текст текст текст')] }).reason === 'source', 'non-https source');
  ok(c({ title: T, blocks: [P('коротко')] }).reason === 'empty', 'too short to publish');
  const v = c({ title: T, age: 18, blocks: [{ t: 'p', r: [{ x: 'Жирный', b: 1, evil: '<x>' }, { x: ' и ссылка', h: 'https://example.com/a?b=1' }] },
    { t: 'h', x: 'Раздел', l: 9 }, { t: 'list', o: 1, items: ['раз', 'два', ''] }, { t: 'quote', x: 'цитата', by: 'кто-то' },
    { t: 'video', p: 'yt', id: 'dQw4w9WgXcQ', cap: 'ролик' }, { t: 'video', p: 'vk', id: '-123_456' }, { t: 'video', p: 'rt', id: 'a'.repeat(32) }, { t: 'video', p: 'tw', id: 'c:FunnyClip-abc' },
    { t: 'hr' }, P('')] });
  ok(v.ok && v.blocks.length === 9 && !('evil' in v.blocks[0].r[0]) && v.blocks[1].l === 2 && v.age === 16 && v.links === 1 && v.videos === 4, 'valid doc normalised like forum_check', v);
  ok(c({ title: T, age: 16, blocks: [P('текст текст текст текст')] }, { cap: 12 }).age === 12, 'age capped to the author band');
  const im = c({ title: T, blocks: [{ t: 'img', src: U + '/abcdefabcdefabcdef.webp', w: 800, h: 600 }] }, { media: true });
  ok(im.ok && im.cover === U + '/abcdefabcdefabcdef.webp', 'first own image becomes cover', im);

  // ── видео по ссылке ──
  const pv = u => JSON.stringify(B.parseVideo(u));
  ok(pv('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10') === '{"p":"yt","id":"dQw4w9WgXcQ"}', 'youtube watch');
  ok(pv('https://youtu.be/dQw4w9WgXcQ') === '{"p":"yt","id":"dQw4w9WgXcQ"}', 'youtu.be');
  ok(pv('https://youtube.com/shorts/dQw4w9WgXcQ') === '{"p":"yt","id":"dQw4w9WgXcQ"}', 'youtube shorts');
  ok(pv('https://vk.com/video-123_456') === '{"p":"vk","id":"-123_456"}', 'vk video');
  ok(pv('https://vkvideo.ru/video-22822305_456242102') === '{"p":"vk","id":"-22822305_456242102"}', 'vkvideo');
  ok(pv('https://vk.com/video_ext.php?oid=-1&id=2&hash=x') === '{"p":"vk","id":"-1_2"}', 'vk video_ext');
  ok(pv('https://rutube.ru/video/' + 'ab'.repeat(16) + '/') === '{"p":"rt","id":"' + 'ab'.repeat(16) + '"}', 'rutube');
  ok(pv('https://www.twitch.tv/videos/123456789') === '{"p":"tw","id":"v123456789"}', 'twitch vod');
  ok(pv('https://clips.twitch.tv/FunnyClipSlug-abc') === '{"p":"tw","id":"c:FunnyClipSlug-abc"}', 'twitch clip');
  ok(pv('https://www.twitch.tv/dan4ik37/clip/FunnyClipSlug') === '{"p":"tw","id":"c:FunnyClipSlug"}', 'twitch channel clip');
  ok(B.parseVideo('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ">') === null, 'embed code not accepted');
  ok(B.parseVideo('javascript:alert(1)') === null && B.parseVideo('https://evil.com/watch?v=dQw4w9WgXcQ') === null, 'other sites refused');
  ok(B.embedUrl({ p: 'yt', id: 'dQw4w9WgXcQ' }).startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), 'youtube-nocookie embed');
  ok(B.embedUrl({ p: 'tw', id: 'v123456' }, 'evil"host').includes('parent=evilhost'), 'twitch parent sanitised');
  ok(B.embedUrl({ p: 'yt', id: 'bad' }) === '', 'invalid id → no embed');

  // ── HTML для серверной страницы ──
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const evil = '<img src=x onerror=XSS()>"\'><script>XSS()</script>';
  const html = B.toHtml([{ t: 'p', r: [{ x: evil, b: 1 }, { x: evil, h: 'javascript:XSS()' }, { x: 'ok', h: 'https://ex.com/a' }] }, { t: 'h', x: evil }, { t: 'list', items: [evil] },
    { t: 'quote', x: evil, by: evil }, { t: 'img', src: U + '/abcdefabcdefabcdef.webp', cap: evil }, { t: 'video', p: 'yt', id: 'dQw4w9WgXcQ', cap: evil }, { t: 'video', p: 'yt', id: '"><x' },
    { t: 'file', key: U + '/abcdefabcdefabcdef.pdf', name: evil, size: 2048 }, { t: 'raw', html: evil }], { media: k => 'https://cdn.example/' + k });
  ok(!/<img src=x|<script|onerror=XSS\(\)>|href="javascript/i.test(html), 'server html: evil strings stay text', html.slice(0, 400));
  ok(/<a href="https:\/\/ex\.com\/a" rel="nofollow ugc noopener" target="_blank">ok<\/a>/.test(html), 'user links nofollow ugc noopener');
  ok(!/raw/.test(html) && !/"&gt;&lt;x/.test(html.split('youtube.com/watch?v=')[2] || ''), 'unknown blocks and bad video ids dropped');
  // подпись картинки в alt — через тот же фильтр текста, что и видимый текст (контакты не утекают в атрибут); без разметки, кавычки экранированы
  const altHtml = B.toHtml([{ t: 'img', src: U + '/abcdefabcdefabcdef.webp', cap: 'звони +7 777 123 45 67 "x' }, { t: 'video', p: 'yt', id: 'dQw4w9WgXcQ', cap: 'пиши +7 777 123 45 67' }],
    { media: k => 'https://cdn.example/' + k, text: s => esc(String(s).replace(/\+?\d(?:[\s\-().]{0,2}\d){6,}/g, '[скрыто]')) + '<br>' });
  ok(!/777/.test(altHtml) && /alt="звони \[скрыто\] &quot;x"/.test(altHtml) && !/alt="[^"]*<br>/.test(altHtml), 'server html: image / video alt uses the text filter', altHtml);
  ok(B.toText([{ t: 'p', r: [{ x: 'a' }, { x: 'b' }] }, { t: 'h', x: 'c' }]) === 'ab\nc', 'plain text');
  ok(B.slug('Привет, Мир! Щука и ёж') === 'privet-mir-schuka-i-ezh', 'slug like forum_slug in SQL');
  const tr = B.tree([{ id: 1 }, { id: 2, parent: 1 }, { id: 3, parent: 2 }, { id: 4, parent: 99 }]);
  ok(tr.length === 2 && tr[0].kids[0].kids[0].id === 3 && tr[1].id === 4, 'comments tree, orphans to root');
  ok(B.reason('u9').includes('9 лет') && B.reason('zzz').length > 5, 'reason texts');

  // ── клиент: разметка редактора и отрисовка блоков на маленьком DOM ──
  class N {
    constructor(tag){ this.nodeType = 1; this.tagName = tag; this.children = []; this.attrs = {}; this.style = {}; this.dataset = {}; this.classList = { add(){}, remove(){}, toggle(){} }; this.listeners = {}; this._text = ''; }
    append(...k){ k.forEach(x => this.children.push(x)); } appendChild(x){ this.children.push(x); return x; }
    setAttribute(k, v){ this.attrs[k] = String(v); } getAttribute(k){ return this.attrs[k]; } removeAttribute(k){ delete this.attrs[k]; }
    addEventListener(e, f){ (this.listeners[e] = this.listeners[e] || []).push(f); }
    replaceWith(x){ this.replaced = x; }
    set textContent(v){ this.children = [{ nodeType: 3, text: String(v) }]; } get textContent(){ return this.children.map(c => c.text != null ? c.text : c.textContent).join(''); }
    get href(){ return this.attrs.href; } set href(v){ this.attrs.href = v; }
  }
  const ser = n => n.text != null ? esc(n.text) : '<' + n.tagName + Object.entries(n.attrs).map(([k, v]) => ' ' + k + '="' + esc(v) + '"').join('') + '>' + n.children.map(ser).join('') + '</' + n.tagName + '>';
  const doc = { createElement: t => new N(t), createTextNode: t => ({ nodeType: 3, text: String(t) }), getElementById: () => null, head: new N('head'), body: new N('body') };
  const win = { D37ForumBlocks: ctx.window.D37ForumBlocks, addEventListener(){}, location: { hostname: 'dan4ik37.vercel.app', origin: 'https://dan4ik37.vercel.app' } };
  const cx2 = { window: win, document: doc, location: win.location, URL, console, setTimeout, clearTimeout, setInterval, clearInterval, localStorage: { getItem: () => null, setItem(){}, removeItem(){} } };
  vm.createContext(cx2);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'js/features/forum2.js'), 'utf8'), cx2);
  const F2 = win.D37Forum2;
  ok(F2 && F2._md && F2._render, 'forum2.js exposes test hooks');
  const md = '**жирный** и *курсив* и ***оба*** и [ссылка](https://ex.com/x) и 5 * 3';
  const runs = F2._md.mdToRuns(md);
  ok(runs.some(r => r.x === 'жирный' && r.b && !r.i) && runs.some(r => r.x === 'курсив' && r.i) && runs.some(r => r.x === 'оба' && r.b && r.i) && runs.some(r => r.x === 'ссылка' && r.h === 'https://ex.com/x'), 'editor markup → runs', runs);
  ok(F2._md.mdToRuns('[x](javascript:alert(1))').every(r => !r.h), 'javascript link in markup stays text');
  ok(F2._md.runsToMd(F2._md.mdToRuns(md)) === md, 'markup round trip');
  const dom = F2._render([{ t: 'p', r: [{ x: evil, b: 1 }, { x: 'bad', h: 'javascript:XSS()' }, { x: 'ok', h: 'https://ex.com/a' }] }, { t: 'h', x: evil, l: 3 }, { t: 'quote', x: evil, by: evil },
    { t: 'video', p: 'yt', id: 'dQw4w9WgXcQ' }, { t: 'video', p: 'yt', id: '"><x' }, { t: 'raw', html: evil }]);
  const out = ser(dom);
  ok(!/<img src=x|<script|href="javascript/i.test(out) && !/raw/.test(out), 'client render: evil strings are text nodes, bad links dropped', out.slice(0, 300));
  ok(/<a href="https:\/\/ex\.com\/a" rel="nofollow ugc noopener" target="_blank">/.test(out), 'client links nofollow ugc noopener');
  ok(!/<iframe/.test(out) && /i\.ytimg\.com\/vi\/dQw4w9WgXcQ/.test(out), 'video: poster only, iframe after click');
  const btn = (function find(n){ if (n.tagName === 'button') return n; for (const k of n.children || []) { const f = k.children && find(k); if (f) return f; } return null; })(dom);
  btn.listeners.click[0]();
  const fr = btn.replaced && btn.replaced.children[0];
  ok(fr && fr.tagName === 'iframe' && fr.attrs.sandbox && /^https:\/\/www\.youtube-nocookie\.com\/embed\//.test(fr.attrs.src), 'click → sandboxed iframe of the allow-listed provider', fr && fr.attrs);

  // ── детские правила (как чат, D37Age.kid): контакты скрыты, ссылки не нажимаются ──
  win.D37Age = { kid: () => true, kidText: s => String(s).replace(/\+?\d(?:[\s\-().]{0,2}\d){6,}/g, '[скрыто]').replace(/@[\p{L}\p{N}_.]{3,}/gu, '[скрыто]') };
  const kidOut = ser(F2._render([{ t: 'p', r: [{ x: 'звони +7 999 123 45 67, пиши @vasya и заходи www.evil.example ' }, { x: 'тут', h: 'https://ex.com/a' }] }, { t: 'quote', x: 'тел 89991234567', by: '@vasya' }]));
  ok(!/999|vasya|evil\.example|<a /.test(kidOut) && /\[скрыто\]/.test(kidOut) && /\[ссылка\]/.test(kidOut), 'kid reader: contacts hidden, links not clickable', kidOut);
  delete win.D37Age;

  // ── серверные страницы форума 2.0 (api/_lib/routes/forum.js, api/sitemap.js) с подменной базой ──
  {
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(process.env.D37_TMP || os.tmpdir(), 'd37-forum-api-'));
    try {
      fs.cpSync(path.join(SITE, 'api'), path.join(tmp, 'api'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
      process.env.SUPABASE_URL = 'https://sb.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
      const now = '2026-11-01T10:00:00Z', cover = U + '/abcdefabcdefabcdef.webp';
      // статья со своим текстом ≥ FORUM_MIN_CHARS (page.js, индекс-диета 14.11) — в поиске и в карте сайта; короткая — noindex
      const LONG = 'Базу ставим у реки на холме: вода рядом, а паводок не достанет. Стены сначала из брёвен, потом из камня. '.repeat(12);
      const ART = { id: 7, title: 'Гайд по базе', author_id: U, pinned: false, locked: false, created_at: now, published_at: now, edited_at: null, status: 'published',
        blocks: [{ t: 'p', r: [{ x: 'Текст статьи. Звони +7 999 123 45 67' }] }, { t: 'p', r: [{ x: LONG }] }, { t: 'video', p: 'yt', id: 'dQw4w9WgXcQ' }], chars: LONG.length + 36, cover, tags: ['гайд'], source_url: 'https://news.example/a', source_title: 'Новости',
        excerpt: 'Текст статьи', age_min: 12, realm: 'kids', rating: 5, votes_up: 6, comments: 1, trusted: true, reports_open: 0 };
      let art = ART, pinged = 0; const idx = [];
      const J = (b, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { 'Content-Type': 'application/json' } });
      globalThis.fetch = async (url, o = {}) => {
        const u = String(url);
        if (/indexnow|yandex\.com/.test(u)) { idx.push(JSON.parse(o.body).urlList); return new Response('', { status: 202 }); }
        if (u.includes('/rest/v1/forum_threads?id=eq.7&') && o.method === 'PATCH') { pinged++; return J(pinged === 1 ? [art] : []); }
        if (u.includes('/rest/v1/forum_threads?id=eq.7&')) return J([art]);
        if (u.includes('/rest/v1/forum_threads?id=eq.')) return J([]);
        if (u.includes('/rest/v1/forum_threads?status=eq.published')) return J([art]);
        if (u.includes('/rest/v1/forum_posts?thread_id=eq.7')) return J([{ id: 1, author_id: U, body: 'тело', is_body: true, created_at: now }, { id: 2, author_id: U, body: 'коммент', parent_id: null, created_at: now }]);
        if (u.includes('/rest/v1/profiles?id=in.')) return J([{ id: U, nick: 'alice', role: 'user' }]);
        if (/googleapis|youtube/.test(u)) return new Response('{}', { status: 500 });
        return J([]);
      };
      const imp = async f => (await import(pathToFileURL(path.join(tmp, f)).href)).default;
      const pages = await imp('api/pages.js'), sitemap = await imp('api/sitemap.js');
      const call = async (h, q, method = 'GET', body) => { const out = { code: 200, headers: {}, body: '' };
        const res = { status(c){ out.code = c; return res; }, setHeader(k, v){ out.headers[k] = String(v); return res; }, send(b){ out.body = String(b ?? ''); return res; }, end(b){ out.body = String(b ?? ''); return res; } };
        await h({ query: q, headers: {}, method, body, url: '/' }, res); return out; };
      const ld = b => [...b.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap(m => JSON.parse(m[1]));
      let r = await call(pages, { page: 'forum', id: '7' });
      ok(r.code === 301 && r.headers.Location === '/forum/7-gaid-po-baze', 'old /forum/7 → 301 /forum/7-gaid-po-baze', r.headers);
      r = await call(pages, { page: 'forum', id: '7-gaid-po-baze' });
      const post = ld(r.body).find(x => x['@type'] === 'DiscussionForumPosting');
      ok(r.code === 200 && post && post.image.includes('/forum-media/' + cover) && post.video && post.video.thumbnailUrl && post.citation === 'https://news.example/a' && post.keywords === 'гайд', 'article: JSON-LD (image, video, citation, keywords)', post);
      ok(/<link rel="canonical" href="https:\/\/dan4ik37\.vercel\.app\/forum\/7-gaid-po-baze">/.test(r.body) && /og:image" content="https:\/\/sb\.test\/storage\/v1\/object\/public\/forum-media\//.test(r.body), 'article: canonical + og:image = cover');
      ok(/data-ad="forum_article"/.test(r.body) && /adsbygoogle\.js/.test(r.body) && /\[скрыто\]/.test(r.body) && /rel="nofollow ugc noopener"/.test(r.body), 'article: one ad place (trusted), contacts hidden, source nofollow ugc');
      ok(!/name="robots" content="noindex"/.test(r.body), 'long article (>= FORUM_MIN_CHARS) → indexable');
      art = { ...ART, blocks: [{ t: 'p', r: [{ x: 'Коротко: привет всем.' }] }], chars: 21 }; r = await call(pages, { page: 'forum', id: '7-gaid-po-baze' });
      ok(r.code === 200 && /name="robots" content="noindex"/.test(r.body) && !/adsbygoogle\.js/.test(r.body), 'short article → 200, noindex, no ads (index diet)');
      r = await call(sitemap, { part: 'pages' });
      ok(!/\/forum\/7-gaid-po-baze</.test(r.body) && !/\/forum<\/loc>/.test(r.body), 'sitemap: short article and a forum with < 3 real articles are left out');
      art = { ...ART, trusted: false }; r = await call(pages, { page: 'forum', id: '7-gaid-po-baze' });
      ok(!/data-ad=/.test(r.body) && !/adsbygoogle\.js/.test(r.body), 'not-yet-trusted author → no ads');
      art = { ...ART, reports_open: 2 }; r = await call(pages, { page: 'forum', id: '7-gaid-po-baze' });
      ok(!/adsbygoogle\.js/.test(r.body), 'open reports → no ads');
      art = { ...ART, age_min: 16 }; r = await call(pages, { page: 'forum', id: '7-gaid-po-baze' });
      ok(r.code === 200 && /name="robots" content="noindex"/.test(r.body) && /data-age-page="16"/.test(r.body) && !/adsbygoogle\.js/.test(r.body), '16+ → noindex, age cover 16, no ads');
      for (const st of ['pending', 'hidden', 'draft']) { art = { ...ART, status: st }; r = await call(pages, { page: 'forum', id: '7-gaid-po-baze' }); ok(r.code === 404, st + ' → 404 (not served)'); }
      art = { ...ART, realm: 'adult' }; r = await call(pages, { page: 'forum', id: '7-gaid-po-baze' }); ok(r.code === 404, 'adult realm → 404 (18+ off)');
      // злые строки во всех полях статьи → серверная страница: только текст, JSON-LD разбирается, ссылки только https
      const EV = '</script><script>XSS()</script><img src=x onerror=XSS()>"\'';
      art = { ...ART, title: EV, excerpt: EV, source_title: EV, source_url: 'javascript:XSS()', tags: [EV, 'гайд'],
        blocks: [{ t: 'p', r: [{ x: EV, h: 'javascript:XSS()' }] }, { t: 'h', x: EV }, { t: 'list', items: [EV] }, { t: 'quote', x: EV, by: EV },
          { t: 'img', src: cover, cap: EV }, { t: 'video', p: 'yt', id: 'dQw4w9WgXcQ', cap: EV }, { t: 'video', p: 'evil', id: EV }, { t: 'file', key: U + '/abcdefabcdefabcdef.pdf', name: EV, size: 10 }] };
      r = await call(pages, { page: 'forum', id: '7' });
      const evPath = r.headers.Location || '';
      r = await call(pages, { page: 'forum', id: evPath.replace('/forum/', '') });
      let ldOk = true; try { ld(r.body); } catch (e) { ldOk = false; }
      ok(r.code === 200 && ldOk && !/<script>XSS|<img src=x|href="javascript/i.test(r.body), 'evil article: server page has no markup from user strings, JSON-LD parses', { code: r.code, loc: evPath, bad: (r.body.match(/.{40}(?:<script>XSS|<img src=x|href="javascript).{40}/i) || [])[0] });
      art = ART;
      r = await call(pages, { page: 'forum' });
      ok(r.code === 200 && r.body.includes('href="/forum/7-gaid-po-baze"') && r.body.includes('href="/forum/new"') && /fr-cover/.test(r.body), 'feed: slug links, write → /forum/new, cover');
      ok(/name="robots" content="noindex"/.test(r.body), 'feed with < 3 real articles → noindex (index diet)');
      r = await call(pages, { page: 'forum', tag: encodeURIComponent('гайд') });
      ok(r.code === 200 && /<h1>#гайд/.test(r.body) && /forum\/t\/%D0%B3%D0%B0%D0%B9%D0%B4/.test(r.body), 'tag page /forum/t/гайд');
      ok(/name="robots" content="noindex"/.test(r.body), 'tag page → noindex (only cards, index diet)');
      r = await call(pages, { page: 'forum', tag: '<x>' }); ok(r.code === 404, 'bad tag → 404');
      for (const [q, to] of [[{ id: 'new' }, '/#/forum/new'], [{ id: 'my' }, '/#/forum/my'], [{ id: 'mod' }, '/#/forum/mod'], [{ id: '7', spa: 'edit' }, '/#/forum/edit/7'], [{ id: U, spa: 'u' }, '/#/forum/u/' + U]]) {
        r = await call(pages, { page: 'forum', ...q }); ok(r.code === 302 && r.headers.Location === to, 'SPA path → ' + to, r.headers);
      }
      r = await call(pages, { page: 'forum', id: 'x', spa: 'edit' }); ok(r.code === 404, 'bad edit id → 404');
      r = await call(sitemap, { part: 'pages' });
      ok(r.body.includes('<loc>https://dan4ik37.vercel.app/forum/7-gaid-po-baze</loc>') && !r.body.includes('/forum/t/'), 'sitemap: long article slug, no tag pages (index diet)');
      r = await call(pages, { page: 'forumping' }, 'POST', { id: 7 });
      ok(JSON.parse(r.body).sent === true && idx.length >= 1 && idx[0].includes('https://dan4ik37.vercel.app/forum/7-gaid-po-baze'), 'IndexNow ping on publish', idx);
      r = await call(pages, { page: 'forumping' }, 'POST', { id: 7 }); ok(JSON.parse(r.body).sent === false, 'second ping does nothing (pinged_at)');
      r = await call(pages, { page: 'forumping' }, 'POST', { id: '1;drop' }); ok(JSON.parse(r.body).ok === false, 'ping: bad id refused');
      // ссылка автора на кусок текста с адресом сайта — без ссылки внутри ссылки (валидный HTML)
      art = { ...ART, blocks: [{ t: 'p', r: [{ x: 'смотри dan4ik37.vercel.app/games тут', h: 'https://news.example/a' }] }] };
      r = await call(pages, { page: 'forum', id: '7-gaid-po-baze' });
      ok(r.code === 200 && !/<a [^>]*>[^<]*(?:<(?!\/a>)[^<]*)*<a /.test((r.body.match(/<div class="fa-body">[\s\S]*?<\/div>/) || [''])[0]), 'linked run with a site address: no nested <a>', (r.body.match(/<div class="fa-body">[\s\S]*?<\/div>/) || [''])[0]);
      // сбой базы (500 / таймаут) на запросе 2.0 — НЕ откатываться на старый запрос без фильтра статуса (скрытое не утекает)
      const HID = { id: 7, title: 'Скрытая статья', author_id: U, pinned: false, locked: false, created_at: now };
      globalThis.fetch = async (url) => { const u = String(url);
        if (u.includes('/rest/v1/forum_threads?') && /status|age_min/.test(u)) return new Response('{"message":"upstream timeout"}', { status: 500 });
        if (u.includes('/rest/v1/forum_threads?')) return J([HID]);
        if (u.includes('/rest/v1/forum_posts?')) return J([{ id: 1, author_id: U, body: 'текст скрытой статьи', created_at: now }]);
        if (u.includes('/rest/v1/profiles?id=in.')) return J([{ id: U, nick: 'alice', role: 'user' }]);
        return J([]); };
      r = await call(pages, { page: 'forum', id: '7' });
      ok(r.code === 503 && !/Скрытая|текст скрытой/.test(r.body) && r.headers['Cache-Control'] === 'no-store', 'v2 query fails (500) → 503 no-store, hidden row not shown', { code: r.code, cc: r.headers['Cache-Control'] });
      r = await call(pages, { page: 'forum' });
      ok(r.code === 503 && !/Скрытая/.test(r.body), 'feed: v2 query fails → 503, no unfiltered legacy list', r.code);
      r = await call(sitemap, { part: 'pages' });
      ok(!/\/forum\/7</.test(r.body) && r.body.includes('<loc>https://dan4ik37.vercel.app/games</loc>'), 'sitemap: v2 query fails → no thread URLs from the unfiltered legacy query');
      // настоящая старая база (нет колонки status: 400 + 42703) — старые страницы как раньше
      globalThis.fetch = async (url) => { const u = String(url);
        if (u.includes('/rest/v1/forum_threads?') && /status|age_min/.test(u)) return new Response('{"code":"42703","message":"column forum_threads.status does not exist"}', { status: 400 });
        if (u.includes('/rest/v1/forum_threads?')) return J([{ ...HID, title: 'Старая тема' }]);
        if (u.includes('/rest/v1/forum_posts?')) return J([{ id: 1, author_id: U, body: 'текст старой темы', created_at: now }]);
        if (u.includes('/rest/v1/profiles?id=in.')) return J([{ id: U, nick: 'alice', role: 'user' }]);
        return J([]); };
      r = await call(pages, { page: 'forum', id: '7' });
      ok(r.code === 200 && /текст старой темы/.test(r.body), 'old database (42703) → old thread page as before', r.code);
      r = await call(sitemap, { part: 'pages' });
      ok(!r.body.includes('<loc>https://dan4ik37.vercel.app/forum/7</loc>'), 'old database (no chars column) → old short threads left out of the sitemap (index diet)');
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }
  }

  console.log(fail ? `forum test: ${fail} FAIL / ${pass + fail}` : `forum test OK (${pass} checks)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e && e.stack || e); process.exit(1); });
