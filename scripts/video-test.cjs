// Видео и YouTube (владелец 05.11: «лайки видео и всё, что связано с видео, работает с настоящими видео на YouTube?») — без браузера:
//  1) /api/vstats (api/_lib/routes/vstats.js): свежие цифры ОДНОГО ролика после «👍 Лайк на YouTube» — только ролики канала, чужой
//     id без похода в API, кэш 10 мин (CDN + память), бюджет походов в API, при ошибке/бюджете — снимок с его датой;
//  2) /api/feed: время цифр (at) и снимок (snapAt, snap) — правила YouTube API III.E.4.f (старые данные — с указанием времени);
//  3) /v/<id>: кнопка «👍 Лайк на YouTube» — ссылка на ролик там, дата цифр, «Подписаться на YouTube»; /reklama без своих метрик
//     из данных API (III.E.4.h); подписи «Подписаться» везде — с «YouTube» (III.C.2);
//  4) js/core/vlike.js в маленьком окне: нажатие → отметка ✓ (только этот браузер) → ушёл на YouTube → вернулся → один запрос
//     /api/vstats → событие d37:vstats; без ухода, через 30 мин, плохой id — запроса нет; перезагрузка после возврата; пауза плеера;
//  5) код: нет всплывающих окон для лайка, нет «лайкнуть выбранные», нет наград за лайк/подписку/просмотр, плееры не меньше
//     200×200 и без наложений (Shorts, плеер в чате), снимок YouTube не старше 30 дней (III.E.4.b/c).
// Запуск из корня сайта: node scripts/video-test.cjs     (временная папка — D37_TMP или системная)
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { pathToFileURL } = require('url');
const SITE = process.argv[2] || path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(SITE, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

(async () => {
  // ═══ 1–3. Сервер: копия api/ во временной папке, YouTube API подменён ═══
  const base = process.env.D37_TMP || os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(base, 'd37-video-api-'));
  const realFetch = globalThis.fetch;
  try {
    fs.cpSync(path.join(SITE, 'api'), path.join(tmp, 'api'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
    const imp = f => import(pathToFileURL(path.join(tmp, f)).href);
    const yt = await imp('api/_lib/yt.js');
    const { SNAPSHOT } = await imp('api/_lib/uploads-snapshot.js');
    const snapIds = SNAPSHOT.split('\n').map(l => l.split('\t'));
    const visible = snapIds.filter(([id, , t]) => !yt.hiddenVideo(id, t)).map(([id]) => id);
    const hidden = snapIds.find(([id, , t]) => yt.hiddenVideo(id, t));
    const NEW_ID = 'NEWvid00001', GONE = 'zzzzzzzzzzz';
    const NET = { calls: [], failVideos: false };
    const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    globalThis.fetch = async (url) => {
      const u = String(url); NET.calls.push(u);
      if (!/googleapis\.com\/youtube\/v3\//.test(u)) return J({}, 404);
      if (u.includes('channels?part=contentDetails')) return J({ items: [{ id: 'UCtest', contentDetails: { relatedPlaylists: { uploads: 'UUtest' } } }] });
      if (u.includes('channels?part=statistics')) return J({ items: [{ statistics: { subscriberCount: '1000', viewCount: '5000000', videoCount: '6000' }, snippet: { publishedAt: '2016-01-01T00:00:00Z', title: 'Dan4ik37' } }] });
      if (u.includes('playlistItems?')) return J({ items: [
        { contentDetails: { videoId: NEW_ID, videoPublishedAt: '2026-11-04T10:00:00Z' }, snippet: { title: 'Новый ролик', publishedAt: '2026-11-04T10:00:00Z', thumbnails: {} } },
        { contentDetails: { videoId: visible[0], videoPublishedAt: '2026-04-10T05:00:42Z' }, snippet: { title: 'старый', publishedAt: '2026-04-10T05:00:42Z', thumbnails: {} } }] });
      if (u.includes('videos?')) {
        if (NET.failVideos) return J({ error: 'quota' }, 403);
        const ids = decodeURIComponent((u.match(/[?&]id=([^&]+)/) || [])[1] || '').split(',');
        return J({ items: ids.filter(id => id !== GONE).map(id => ({ id, statistics: { viewCount: '12345', likeCount: '678' }, contentDetails: { duration: 'PT10M' },
          snippet: { channelId: 'UCtest', title: 'Ролик ' + id, description: '', publishedAt: '2026-11-04T10:00:00Z', thumbnails: {} } })) });
      }
      return J({}, 404);
    };
    const pages = (await imp('api/pages.js')).default;
    const vs = await imp('api/_lib/routes/vstats.js');
    const call = async (handler, q) => {
      const out = { code: 200, headers: {}, body: '' };
      const res = { status(c){ out.code = c; return res; }, setHeader(k, v){ out.headers[k] = v; return res; }, send(b){ out.body = b; return res; } };
      await handler({ query: q, headers: {} }, res);
      try { out.json = JSON.parse(out.body); } catch (e) { out.json = null; }
      out.maxAge = +((out.headers['Cache-Control'] || '').match(/s-maxage=(\d+)/) || [])[1] || 0;
      return out;
    };
    const vcalls = () => NET.calls.filter(u => /youtube\/v3\/videos\?/.test(u)).length;

    // ── 1. /api/vstats ──
    ok(JSON.parse(src('vercel.json')).rewrites.some(r => r.source === '/api/vstats' && r.destination === '/api/pages?page=vstats'), 'vercel.json: /api/vstats → pages?page=vstats');
    ok(fs.readdirSync(path.join(SITE, 'api')).filter(f => f.endsWith('.js')).length <= 12, 'Vercel Hobby: функций в api/ не больше 12 (vstats — маршрут в pages.js, не своя функция)');
    let r = await call(pages, { page: 'vstats', id: 'abc' });
    ok(r.code === 400 && vcalls() === 0 && r.maxAge >= 3600, 'vstats: неверный id → 400 без API, кэш надолго', r);
    r = await call(pages, { page: 'vstats', id: GONE });
    ok(r.code === 404 && vcalls() === 0, 'vstats: чужой ролик (нет в снимке и загрузках) → 404 без videos.list', { code: r.code, v: vcalls() });
    if (hidden) { r = await call(pages, { page: 'vstats', id: hidden[0] }); ok(r.code === 404 && vcalls() === 0, 'vstats: спрятанный ролик (кейсы/депозит, yt.js hiddenVideo) → 404', r.code); }
    const t0 = Date.now();
    r = await call(pages, { page: 'vstats', id: visible[1] });
    ok(r.code === 200 && r.json?.src === 'live' && r.json.views === 12345 && r.json.likes === 678 && r.json.id === visible[1], 'vstats: ролик канала → живые цифры YouTube', r.json);
    ok(Math.abs(Date.parse(r.json?.at) - t0) < 5000, 'vstats: at — время ответа YouTube', r.json?.at);
    ok(r.maxAge >= 600, 'vstats: CDN держит ответ ≥ 10 мин на ролик', r.headers);
    let before = vcalls();
    r = await call(pages, { page: 'vstats', id: visible[1] });
    ok(r.code === 200 && vcalls() === before, 'vstats: тот же ролик в течение 10 мин — из памяти, квота не тратится', vcalls() - before);
    r = await call(pages, { page: 'vstats', id: NEW_ID });
    ok(r.code === 200 && r.json?.src === 'live', 'vstats: ролик новее снимка (из свежих загрузок) → живые цифры', r.json);
    // бюджет походов в API
    vs._resetBudget(); before = vcalls();
    const many = visible.slice(10, 10 + vs.BUDGET + 6);
    const res = [];
    for (const id of many) res.push(await call(pages, { page: 'vstats', id }));
    ok(vcalls() - before === vs.BUDGET, `vstats: не больше ${vs.BUDGET} походов в API за 10 мин на инстанс`, vcalls() - before);
    const over = res.slice(vs.BUDGET);
    ok(over.every(x => x.code === 200 ? x.json.src === 'snapshot' && x.json.at === yt.SNAPSHOT_AT && x.maxAge <= 120 : x.code === 503), 'vstats: сверх бюджета — снимок с его датой, CDN ненадолго', over.map(x => [x.code, x.json?.src, x.maxAge]));
    // ошибка API (квота) → снимок; следующий запрос снова пробует API (и снова из бюджета)
    vs._resetBudget(); NET.failVideos = true; before = vcalls();
    const fid = visible[200];
    r = await call(pages, { page: 'vstats', id: fid });
    ok((r.code === 200 && r.json.src === 'snapshot') || r.code === 503, 'vstats: YouTube API ответил ошибкой → снимок, не падает', [r.code, r.json]);
    NET.failVideos = false;
    r = await call(pages, { page: 'vstats', id: fid });
    ok(r.code === 200 && r.json.src === 'live' && vcalls() - before === 2, 'vstats: после ошибки — новая попытка (ошибка не кэшируется)', [r.json, vcalls() - before]);

    // ── 2. /api/feed: время цифр ──
    NET.failVideos = true;
    r = await call(pages, { page: 'feed' });
    ok(r.code === 200 && r.json?.snapAt === yt.SNAPSHOT_AT && r.json.vids.some(v => v.snap === 1), 'feed: свежих цифр нет — у роликов snap: 1 и день снимка snapAt', r.json && { snapAt: r.json.snapAt, snap: r.json.vids.filter(v => v.snap).length });
    NET.failVideos = false;
    r = await call(pages, { page: 'feed' });
    ok(r.code === 200 && !isNaN(Date.parse(r.json?.at)) && Math.abs(Date.parse(r.json.at) - Date.now()) < 60e3, 'feed: at — когда YouTube отдал цифры', r.json?.at);
    ok(r.json?.vids?.length && r.json.vids.every(v => !v.snap) && r.json.vids.every(v => v.likes === 678 || v.likes === 0), 'feed: свежие цифры — без snap', r.json?.vids?.slice(0, 2));
    ok(/getVideoStats[\s\S]{0,200}cached\('vstats:' \+ list\.join\(','\), 3600e3/.test(src('api/_lib/yt.js')), 'yt.js: цифры ленты в памяти не дольше часа');

    // ── 3. /v/<id>, /reklama, подписи ──
    const video = (await imp('api/video.js')).default;
    r = await call(video, { id: visible[1] });
    const like = (r.body.match(/<a [^>]*data-vlike="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) || []);
    ok(r.code === 200 && like[1] === visible[1] && /Лайк на YouTube/.test(like[2] || '') && new RegExp(`href="https://www\\.youtube\\.com/(watch\\?v=|shorts/)${visible[1]}"`).test(like[0]) && /target="_blank"/.test(like[0]),
      '/v/<id>: «👍 Лайк на YouTube» — ссылка на этот ролик на YouTube', like[0]);
    ok(/<script src="\/js\/core\/vlike\.js"><\/script>/.test(r.body) && /d37:vstats/.test(r.body), '/v/<id>: vlike.js и обновление цифр после возврата');
    const snapDay = new Date(yt.SNAPSHOT_AT).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    ok(r.body.includes('data-vs="at"') && r.body.includes('данные YouTube на ' + snapDay), '/v/<id> из снимка: цифры с датой снимка', snapDay);
    ok(!/❤/.test((r.body.match(/<div class="meta">[\s\S]*?<\/div>/) || [''])[0]), '/v/<id>: лайки — 👍 (как на YouTube), не ❤');
    r = await call(video, { id: NEW_ID });
    ok(r.code === 200 && r.body.includes('data-vs="at"') && /данные YouTube на /.test(r.body), '/v/<id> из API: цифры с датой сборки страницы');
    r = await call(pages, { page: 'reklama' });
    ok(r.code === 200 && !/медиана/i.test(r.body), '/reklama: без медианы просмотров (своя метрика из данных API, III.E.4.h)');
    // все «Подписаться» — с «YouTube» (действие YouTube должно быть видно как действие YouTube, III.C.2)
    const subs = [];
    for (const f of ['index.html', 'js/features/shorts.js', 'api/video.js', 'api/_lib/page.js', 'api/_lib/routes/topic.js', 'api/_lib/routes/videos.js', 'js/ui/modal.js', 'js/features/youtube.js'])
      for (const m of src(f).matchAll(/<a [^>]*sub_confirmation=1[^>]*>([\s\S]*?)<\/a>/g)) subs.push([f, m[1].replace(/<[^>]+>/g, '')]);
    ok(subs.length >= 8 && subs.every(([, t]) => /YouTube/.test(t)), 'подписка: каждая кнопка «Подписаться» говорит «YouTube»', subs.filter(([, t]) => !/YouTube/.test(t)));
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ═══ 4. js/core/vlike.js в маленьком окне ═══
  {
    let now = 1e12;
    const RealDate = Date;
    class FakeDate extends RealDate { constructor(...a){ super(...(a.length ? a : [now])); } static now(){ return now; } }
    const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
    const mkWin = (ls, ss) => {
      const L = {}, on = (t, f) => (L[t] = L[t] || []).push(f), fire = (t, e = {}) => (L[t] || []).forEach(f => f(e));
      const fetches = [], events = [], posted = [];
      const anchor = id => ({ id, attrs: { 'data-vlike': id }, title: '', cls: new Set(), mark: { textContent: '' },
        getAttribute(k){ return this.attrs[k]; }, classList: null, querySelector(s){ return s === '.vl-mark' ? this.mark : null; },
        closest(s){ return s === 'a[data-vlike]' ? this : null; } });
      const A = [anchor('dQw4w9WgXcQ'), anchor('bad id')];
      A.forEach(a => { a.classList = { toggle: (n, v) => v ? a.cls.add(n) : a.cls.delete(n) }; });
      const iframe = { contentWindow: { postMessage: m => posted.push(m) } };
      const doc = { visibilityState: 'visible', addEventListener: on,
        querySelectorAll: s => s === 'a[data-vlike]' ? A : /iframe/.test(s) ? [iframe] : [] };
      const win = { document: doc, localStorage: ls, sessionStorage: ss, Date: FakeDate, Set, JSON, Array, String, Promise, isFinite, encodeURIComponent, console, setTimeout,
        addEventListener: on, dispatchEvent: e => { events.push(e); return true; },
        CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
        fetch: u => { fetches.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'dQw4w9WgXcQ', views: 2000, likes: 51, at: new RealDate(now).toISOString(), src: 'live' }) }); } };
      win.window = win;
      vm.createContext(win);
      vm.runInContext(src('js/core/vlike.js'), win);
      return { win, doc, A, fire, fetches, events, posted, V: win.D37VLike };
    };
    const ls = store(), ss = store();
    let W = mkWin(ls, ss);
    const V = W.V;
    ok(V.url('dQw4w9WgXcQ') === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' && V.url('dQw4w9WgXcQ', true) === 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'vlike: ссылка — ролик на YouTube (обычный и Shorts)');
    // нажал → отметка только в этом браузере
    W.fire('click', { target: W.A[0] });
    ok(V.marked('dQw4w9WgXcQ') && JSON.parse(ls.getItem('d37_liked')).includes('dQw4w9WgXcQ'), 'vlike: нажатие → отметка ✓ в этом браузере (d37_liked)');
    ok(W.A[0].mark.textContent === ' ✓' && W.A[0].title === V.T_ON && /только в этом браузере/.test(V.T_ON) && /видно только на YouTube/.test(V.T_ON), 'vlike: подпись отметки — «только в этом браузере», лайк — на YouTube', W.A[0].title);
    ok(/Сам сайт лайк не ставит/.test(V.T_OFF), 'vlike: подсказка кнопки — лайк ставится на YouTube, не сайтом');
    ok(W.posted.some(m => /pauseVideo/.test(m)), 'vlike: ушёл на YouTube — ролик на сайте на паузе (не играет в спрятанной вкладке)');
    // вернулся, не уходя (focus сразу) → запроса нет
    W.fire('focus'); await tick();
    ok(W.fetches.length === 0, 'vlike: без ухода со страницы цифры не спрашиваем');
    // ушёл (вкладка спрятана) и вернулся через 20 с → один запрос, событие d37:vstats
    W.doc.visibilityState = 'hidden'; W.fire('visibilitychange'); now += 20e3; W.doc.visibilityState = 'visible'; W.fire('visibilitychange'); W.fire('focus'); await tick(20);
    ok(W.fetches.length === 1 && W.fetches[0] === '/api/vstats?id=dQw4w9WgXcQ', 'vlike: вернулся с YouTube → один запрос /api/vstats этого ролика', W.fetches);
    const ev = W.events.find(e => e.type === 'd37:vstats');
    ok(ev && ev.detail.likes === 51 && ev.detail.views === 2000 && ev.detail.src === 'live', 'vlike: событие d37:vstats с настоящими цифрами', ev && ev.detail);
    ok(/^обновлено \d\d:\d\d$/.test(V.when(ev.detail)), 'vlike: подпись «обновлено ЧЧ:ММ»', V.when(ev.detail));
    ok(V.when({ at: '2026-11-05', src: 'snapshot' }).startsWith('данные YouTube на 5 нояб'), 'vlike: у снимка — «данные YouTube на <день>»', V.when({ at: '2026-11-05', src: 'snapshot' }));
    ok(ss.getItem('d37_vlike_pending') === null, 'vlike: ожидание возврата снято');
    // ещё раз за минуту — из памяти страницы
    await V.stats('dQw4w9WgXcQ'); ok(W.fetches.length === 1, 'vlike: те же цифры в течение минуты — без нового запроса');
    // ушёл и вернулся через 40 мин → не спрашиваем (это уже не «после лайка»)
    W.fire('click', { target: W.A[0] }); W.fire('blur'); now += 40 * 60e3; W.fire('focus'); await tick();
    ok(W.fetches.length === 1, 'vlike: вернулся через 40 мин — запроса нет');
    // плохой id — ни отметки, ни ожидания
    W.fire('click', { target: W.A[1] }); W.fire('blur'); now += 5e3; W.fire('focus'); await tick();
    ok(!V.marked('bad id') && W.fetches.length === 1, 'vlike: плохой id — без отметки и запроса');
    // телефон выгрузил вкладку: открылась заново с ожиданием в sessionStorage → цифры всё равно обновятся
    ss.setItem('d37_vlike_pending', JSON.stringify({ id: 'dQw4w9WgXcQ', t: now - 30e3 }));
    W = mkWin(ls, ss); await tick(20);
    ok(W.fetches.length === 1 && W.V.marked('dQw4w9WgXcQ'), 'vlike: сайт открылся заново после YouTube — один запрос, отметка на месте', W.fetches);
  }

  // ═══ 5. Код: честный лайк, без наград, плееры по правилам ═══
  const yjs = src('js/features/youtube.js'), tabs = src('js/ui/tabs-nav.js'), sh = src('js/features/shorts.js'), modal = src('js/ui/modal.js'), html = src('index.html');
  const popups = [['youtube.js', yjs], ['tabs-nav.js', tabs], ['shorts.js', sh], ['modal.js', modal], ['vlike.js', src('js/core/vlike.js')]]
    .filter(([, s]) => /window\.open\([^)]*youtube\.com[^)]*width=/.test(s)).map(([f]) => f);
  ok(!popups.length, 'лайк: без всплывающих окон с размером (телефоны их блокируют)', popups);
  ok(!/function toggleLike|function likeSelected/.test(yjs + tabs) && !/likeSelBtn|likeSelected/.test(html + tabs), 'лайк: старых «toggleLike» и «❤ Лайкнуть выбранные» нет');
  const likes = [];
  for (const [f, s] of [['youtube.js', yjs], ['shorts.js', sh], ['index.html', html], ['api/video.js', src('api/video.js')]])
    for (const m of s.matchAll(/<a [^>]*data-vlike=[^>]*>([\s\S]*?)<\/a>/g)) likes.push([f, m[0].slice(0, 200), m[1].replace(/<[^>]+>/g, ' ')]);
  ok(likes.length >= 4 && likes.every(([, a, t]) => /Лайк\s+на YouTube/.test(t) && /href="https:\/\/www\.youtube\.com\//.test(a) && /target="_blank"/.test(a) && /rel="noopener"/.test(a)),
    'лайк: каждая кнопка — ссылка на YouTube с надписью «Лайк на YouTube» (карточка, окно ролика, Shorts, /v/<id>)', likes.map(([f, , t]) => [f, t.trim()]));
  ok(html.indexOf('js/core/vlike.js') > 0 && html.indexOf('js/core/vlike.js') < html.indexOf('js/features/youtube.js'), 'index.html: vlike.js раньше youtube.js');
  ok(/data-vs="likes"[^`]*👍/.test(yjs) && /renderDataNote/.test(yjs) && /данные YouTube/.test(yjs), 'лента: 👍 лайки — данными YouTube, под сеткой — откуда и на когда цифры');
  ok(/Это не история просмотров YouTube/.test(yjs), '«✓ Просмотрено» — подписано как отметка сайта, не история YouTube');
  // награды: ни XP, ни 🪙, ни заданий за просмотр, лайк, подписку (III.F.3.c)
  ok(/const XP_WATCH = false/.test(src('js/features/xp.js')), 'xp.js: XP за просмотр выключены (XP_WATCH = false)');
  const vl = src('js/core/vlike.js');
  ok(!/xp|coins|D37Coins|rpc\(|quest|D37Gems/i.test(vl.replace(/\/\/.*$/gm, '')), 'vlike.js: лайк ничего не начисляет');
  const gs = src('js/features/games.js');
  const quests = [(gs.match(/const WEEKLY_QUESTS = \{[\s\S]*?\n\};/) || [''])[0], (gs.match(/const DAILY_QUESTS = \{[\s\S]*?\n\};/) || [''])[0]];
  // «Угадай видео» — игра-викторина по превью, не просмотр и не лайк; запрещена награда за «смотри / лайкни / подпишись»
  ok(quests.every(q => q.length > 100) && !quests.some(q => /watch|like|лайк|подпис|subscri|посмотр|смотр/i.test(q)), 'задания дня/недели: нет заданий за просмотр, лайк, подписку', quests.map(q => q.length));
  // плееры: не меньше 200×200 и без наложений
  const ds = src('css/ds.css'), pc = src('css/premium.css');
  ok(/\.ds-plframe\{[^}]*min-height:200px/.test(ds) && /\.ds-player\.mini \.ds-plframe\{[^}]*min-height:200px/.test(ds) && /\.ds-player\.mini\{[^}]*width:min\(360px/.test(ds), 'плеер в чате: окно не меньше 200×200 (и в «окошке» тоже)');
  ok(!/Math\.max\(140,/.test(src('js/features/chatplayer.js')), 'плеер в чате: тянуть ниже 200 px нельзя');
  ok(/\.sh-item\.is-active \.sh-info\{display:none\}/.test(pc) && !/\.sh-item\.is-active \.sh-frame:hover \.sh-info/.test(pc), 'Shorts: пока играет — подписи поверх плеера нет');
  const phone = (pc.match(/\/\* Телефон: ролик на всю ширину[\s\S]*?\.sh-row-track/) || [''])[0];
  ok(/\.sh-player\{bottom:58px\}/.test(phone) && /\.sh-side\{[^}]*bottom:8px/.test(phone), 'Shorts на телефоне: кнопки — полосой под плеером, не поверх', phone.slice(0, 200));
  // снимок YouTube не старше 30 дней (III.E.4.b/c) — пересобрать: node scripts/snapshot-uploads.mjs
  const at = (src('api/_lib/uploads-snapshot.js').match(/SNAPSHOT_AT = '([\d-]+)'/) || [])[1];
  const age = (Date.now() - Date.parse(at)) / 864e5;
  if (age > 23 && age <= 30) console.log(`WARN снимку YouTube ${Math.floor(age)} дн. — через ${Math.ceil(30 - age)} дн. пересобрать: node scripts/snapshot-uploads.mjs`);
  ok(at && age <= 30, `снимок YouTube (${at}) не старше 30 дней — правила YouTube API; пересобрать: node scripts/snapshot-uploads.mjs`, Math.floor(age));

  console.log(`\nvideo-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
