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

  console.log(fail ? `forum test: ${fail} FAIL / ${pass + fail}` : `forum test OK (${pass} checks)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e && e.stack || e); process.exit(1); });
