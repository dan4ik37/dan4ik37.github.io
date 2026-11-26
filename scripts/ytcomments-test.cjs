// 💬 Комментарии с YouTube на сайте (ytlike-3; владелец 26.11: «можно ли сделать комменты от ютуба и убрать лишнее») — быстрые проверки
// без браузера (путь в Chrome — scripts/ytlike-e2e.cjs, сечения cmt*):
//  1) /api/ytcomments (api/_lib/routes/ytcomments.js): только ролики канала; ключ сайта, не токен; commentThreads.list order=relevance,
//     20 веток, plainText; ответы ветки — comments.list по parentId; кэш 10 мин (CDN и память), бюджет походов, квота → 503 'quota',
//     комментарии отключены → disabled; ссылка на автора — только youtube.com; лишних полей нет;
//  2) код окна (js/features/ytcomments.js): только 13+ (D37Age.known и не kid), текст — только textContent, наград нет;
//  3) переключатели: SITE_LIKE_VIDEO ('auto' по умолчанию), YT_COMMENTS; ❤ стрима не зависит от SITE_LIKE_VIDEO.
// Запуск из корня сайта: node scripts/ytcomments-test.cjs
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const { pathToFileURL } = require('url');
const SITE = process.argv[2] || path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(SITE, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); } };

(async () => {
  const base = process.env.D37_TMP || os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(base, 'd37-ytc-api-'));
  const realFetch = globalThis.fetch;
  try {
    fs.cpSync(path.join(SITE, 'api'), path.join(tmp, 'api'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
    const imp = f => import(pathToFileURL(path.join(tmp, f)).href);
    const yt = await imp('api/_lib/yt.js');
    const { SNAPSHOT } = await imp('api/_lib/uploads-snapshot.js');
    const snap = SNAPSHOT.split('\n').map(l => l.split('\t'));
    const visible = snap.filter(([id, , t]) => !yt.hiddenVideo(id, t)).map(([id]) => id);
    const hidden = snap.find(([id, , t]) => yt.hiddenVideo(id, t));
    const GONE = 'zzzzzzzzzzz', OFF = visible[2], Q = visible[3];
    const NET = { calls: [], quota: false };
    const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    const th = (id, author, text, url, likes, rep) => ({ id, snippet: { totalReplyCount: rep, topLevelComment: { id, snippet: { authorDisplayName: author, authorChannelUrl: url, textDisplay: text, textOriginal: 'NOT FOR US', likeCount: likes, publishedAt: '2026-11-20T10:00:00Z', authorProfileImageUrl: 'https://yt3.ggpht.com/x', viewerRating: 'none' } } } });
    globalThis.fetch = async (url, opt = {}) => {
      const u = String(url); NET.calls.push([u, opt.headers || {}]);
      if (!/googleapis\.com\/youtube\/v3\//.test(u)) return J({}, 404);
      if (u.includes('channels?part=contentDetails')) return J({ items: [{ id: 'UCtest', contentDetails: { relatedPlaylists: { uploads: 'UUtest' } } }] });
      if (u.includes('playlistItems?')) return J({ items: [] });
      if (u.includes('/commentThreads?')) {
        const vid = (u.match(/videoId=([^&]+)/) || [])[1];
        if (NET.quota || vid === Q) return J({ error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } }, 403);
        if (vid === OFF) return J({ error: { code: 403, errors: [{ reason: 'commentsDisabled' }] } }, 403);
        return J({ items: [th('UgxA1234567', '@viewer', 'Текст <script>alert(1)</script>', 'http://www.youtube.com/@viewer', 12, 2), th('UgxB1234567', '@evil', 'второй', 'https://evil.example/x', 0, 0)] });
      }
      if (u.includes('/comments?')) return J({ items: [{ id: 'UgxA1234567.r1', snippet: { authorDisplayName: '@rep', textDisplay: 'ответ', likeCount: 1, publishedAt: '2026-11-21T10:00:00Z', parentId: 'UgxA1234567' } }] });
      return J({}, 404);
    };
    const pages = (await imp('api/pages.js')).default;
    const rt = await imp('api/_lib/routes/ytcomments.js');
    const call = async q => {
      const out = { code: 200, headers: {}, body: '' };
      const res = { status(c){ out.code = c; return res; }, setHeader(k, v){ out.headers[k] = v; return res; }, send(b){ out.body = b; return res; } };
      await pages({ query: { page: 'ytcomments', ...q }, headers: {} }, res);
      try { out.json = JSON.parse(out.body); } catch (e) { out.json = null; }
      out.maxAge = +((out.headers['Cache-Control'] || '').match(/s-maxage=(\d+)/) || [])[1] || 0;
      return out;
    };
    const cc = () => NET.calls.filter(([u]) => /\/(commentThreads|comments)\?/.test(u));

    ok(JSON.parse(src('vercel.json')).rewrites.some(r => r.source === '/api/ytcomments' && r.destination === '/api/pages?page=ytcomments'), 'vercel.json: /api/ytcomments → pages?page=ytcomments');
    ok(fs.readdirSync(path.join(SITE, 'api')).filter(f => f.endsWith('.js')).length <= 12, 'Vercel Hobby: функций в api/ не больше 12 (маршрут в pages.js)');
    let r = await call({ id: 'abc' });
    ok(r.code === 400 && !cc().length, 'неверный id → 400 без похода в API', r);
    r = await call({ id: visible[0], parent: 'bad id!' });
    ok(r.code === 400 && !cc().length, 'неверный parent → 400', r);
    r = await call({ id: GONE });
    ok(r.code === 404 && !cc().length, 'чужой ролик → 404 без commentThreads.list', r.code);
    if (hidden) { r = await call({ id: hidden[0] }); ok(r.code === 404 && !cc().length, 'спрятанный ролик (кейсы/депозит) → 404', r.code); }
    r = await call({ id: visible[0] });
    const c0 = cc()[0];
    ok(r.code === 200 && r.json?.items?.length === 2 && r.json.id === visible[0], 'ролик канала → ветки комментариев', r.json);
    ok(c0 && /part=snippet/.test(c0[0]) && /order=relevance/.test(c0[0]) && /maxResults=20/.test(c0[0]) && /textFormat=plainText/.test(c0[0]) && /[?&]key=/.test(c0[0]) && !c0[1].Authorization, 'commentThreads.list: snippet, relevance, 20, plainText, ключ сайта (без токена человека)', c0);
    const it = r.json?.items?.[0] || {};
    ok(it.text === 'Текст <script>alert(1)</script>' && it.author === '@viewer' && it.likes === 12 && it.replies === 2 && it.authorUrl === 'https://www.youtube.com/@viewer', 'поля: текст (textDisplay как есть — страница выводит только текстом), автор, лайки, ответы; ссылка → https', it);
    ok(Object.keys(it).sort().join() === 'at,author,authorUrl,id,likes,replies,text', 'лишних полей нет (аватар, viewerRating, textOriginal не отдаём)', Object.keys(it));
    ok(r.json.items[1].authorUrl === '', 'ссылка автора не на youtube.com — выброшена', r.json.items[1]);
    ok(r.maxAge >= 600 && Math.abs(Date.parse(r.json.at) - Date.now()) < 5000, 'CDN держит 10 мин, at — время ответа YouTube', r.headers);
    const n1 = cc().length;
    r = await call({ id: visible[0] });
    ok(r.code === 200 && cc().length === n1, 'тот же ролик в 10 мин — из памяти, квота не тратится');
    r = await call({ id: visible[0], parent: 'UgxA1234567' });
    const c1 = cc().slice(-1)[0];
    ok(r.code === 200 && r.json?.items?.[0]?.text === 'ответ' && /\/comments\?part=snippet&parentId=UgxA1234567&maxResults=20&textFormat=plainText/.test(c1[0]), 'ответы ветки — comments.list по parentId', { j: r.json, u: c1 && c1[0] });
    // ветка должна быть из ЭТОГО ролика (список веток, который сайт сам отдал): иначе ключ и квота читали бы ответы любого комментария YouTube
    let nr = NET.calls.filter(([u]) => u.includes('/comments?')).length;
    r = await call({ id: visible[0], parent: 'UgxZ9999999' });
    ok(r.code === 404 && NET.calls.filter(([u]) => u.includes('/comments?')).length === nr, 'чужая ветка (не из веток этого ролика) → 404 без comments.list', r);
    r = await call({ id: visible[0], parent: 'UgxB1234567' });
    ok(r.code === 404 && NET.calls.filter(([u]) => u.includes('/comments?')).length === nr, 'ветка без ответов → 404 без comments.list', r);
    r = await call({ id: OFF, parent: 'UgxA1234567' });
    ok(r.code === 404 && NET.calls.filter(([u]) => u.includes('/comments?')).length === nr, 'ролик с отключёнными комментариями: ответы → 404', r);
    r = await call({ id: OFF });
    ok(r.code === 200 && r.json?.disabled === true && Array.isArray(r.json.items) && !r.json.items.length, 'комментарии у ролика отключены → disabled', r.json);
    r = await call({ id: Q });
    ok(r.code === 503 && r.json?.error === 'quota' && r.maxAge >= 300, 'квота YouTube → 503 quota (CDN 5 мин)', r);
    rt._resetBudget();
    const before = cc().length, res = [];
    for (const id of visible.slice(10, 10 + rt.BUDGET + 5)) res.push(await call({ id }));
    ok(cc().length - before === rt.BUDGET && res.slice(rt.BUDGET).every(x => x.code === 503 && x.json?.error === 'busy'), `не больше ${rt.BUDGET} походов в API за 10 мин на инстанс, дальше 503 busy`, { spent: cc().length - before });
  } finally { globalThis.fetch = realFetch; try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }

  // ═══ 2. Код окна ═══
  {
    const c = src('js/features/ytcomments.js');
    const code = c.replace(/\/\/[^\n]*/g, '');
    ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(code), 'окно комментариев: разметка не собирается из строк (только textContent)');
    ok(/A\.known\(\) && !A\.kid\(\)/.test(c), 'окно и «💬» — только 13+ (возраст указан и не «до 13»)');
    ok(/YT_URL_RE = \/\^https:\\\/\\\/\(www\\\.\)\?youtube\\\.com\\\//.test(c), 'ссылка — только на youtube.com');
    ok(!/addXp|addXP|grantXp|claim_\w+|🪙|reward|награ/i.test(code), 'наград за комментарий нет (III.F)');
    ok(!/Authorization|access_token/.test(code), 'окно не трогает токен (чтение — через сервер сайта)');
    const html = src('index.html');
    ok(html.indexOf('src="js/features/ytcomments.js"') > html.indexOf('src="js/core/ytlike.js"'), 'ytcomments.js — после ytlike.js');
    ok(/id="mCmt"[^>]*\shidden/.test(html) && /class="sh-btn ytc-btn"[^>]*\shidden/.test(src('js/features/shorts.js')), 'кнопки «💬» в разметке спрятаны, пока окно не решит (13+)');
  }
  // ═══ 3. Переключатели ═══
  {
    const cfg = src('js/core/config.js');
    ok(/const SITE_LIKE_VIDEO = 'auto';/.test(cfg) && /const YT_COMMENTS = '(on|test|off)';/.test(cfg), "config.js: SITE_LIKE_VIDEO = 'auto', YT_COMMENTS");
    // site-like.js: videoWanted() по флагу и D37YtLike.why()
    const run = (flag, why) => {
      const w = { document: null, console };
      w.window = w; w.globalThis = w;
      const ctx = vm.createContext(w);
      vm.runInContext((flag ? `var SITE_LIKE_VIDEO = ${JSON.stringify(flag)};` : '') + src('js/features/site-like.js'), ctx);
      w.D37YtLike = why === undefined ? undefined : { why: () => why };
      return w.D37SiteLike.videoWanted();
    };
    ok(run('auto', null) === false && run('auto', 'off') === true && run('auto', 'quota') === true && run('auto', undefined) === true, "'auto': настоящий лайк работает → без ❤ ролика; не работает (off / квота / нет ytlike.js) → ❤ как раньше");
    ok(run('always', null) === true && run('never', 'off') === false && run(null, null) === true, "'always' — ❤ всегда (откат), 'never' — никогда; без флага — как раньше");
  }
  console.log(`ytcomments-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e?.stack || e); process.exit(1); });
