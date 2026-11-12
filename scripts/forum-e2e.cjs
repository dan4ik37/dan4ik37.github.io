// T-157 форум 2.0 в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm) на профиле телефона (CPU ×4, качество mid, загрузки запрещены).
// Сервер базы — НАСТОЯЩИЙ forum.sql в PGlite (заглушки живых таблиц как в scripts/forum-sql-test.mjs): сайт ходит в «Supabase» по
// адресу этого же локального сервера (/sb/…: rpc, хранилище forum-media) — SB_URL в отдаваемом chat.js подменён только здесь.
// Шаги: лента (карточки, «показать ещё», реклама в ленте — место), статья (блоки, видео — заставка → iframe с sandbox), автор пишет
// статью со ВСЕМИ блоками (текст с жирным и ссылкой, заголовок, список, цитата, видео, фото — пересжатие в браузере и загрузка, файл,
// линия, источник, метки) и публикует, читатель ставит +, пишет комментарий и ответ, жалуется, модератор видит жалобу;
// 20 раз открыть / закрыть статью — память после сборки мусора не растёт, узлы раздела не копятся; ошибок в консоли нет.
// Запуск из корня сайта: node scripts/forum-e2e.cjs [phone|pc] [раз]   (DEPS_DIR / PGLITE_PATH — где лежит @electric-sql/pglite)
// Тяжёлое (CPU ×4) — через общую очередь: node M:/d37/d37-core/scripts/heavy-lock.mjs run --session site/t157 --job "forum-e2e" --min 10 --wait 30 -- node scripts/forum-e2e.cjs
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const SITE = path.join(__dirname, '..');
const [PROF = 'phone', ROUNDS = '20', MODE = ''] = process.argv.slice(2);
// MODE 'legacy': FORUM2 = false — старый форум (js/features/forum.js) на базе с forum.sql 2.0: прямые чтения / записи таблиц под RLS
// (роль authenticated / anon, как PostgREST), скрытое и черновики не видны, новая тема и ответ проходят охрану forum.sql
const LEGACY = MODE === 'legacy';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/t157/e2e' : path.join(os.tmpdir(), 't157-e2e'));
fs.mkdirSync(TMP, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon', '.pdf': 'application/pdf' };
let fail = 0; const ok = (c, name, extra) => { if (!c) { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); } else console.log('ok  ', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); };

async function findPglite(){
  const cands = [process.env.PGLITE_PATH, process.env.DEPS_DIR, path.join(os.tmpdir(), 'd37-pglite'), path.join(SITE, '..', 'd37-pglite'), SITE].filter(Boolean);
  const pick = x => (typeof x === 'string' ? x : x && (pick(x.import) || pick(x.default) || pick(x.module)));
  for (const c of cands) for (const dir of [c, path.join(c, '@electric-sql/pglite'), path.join(c, 'node_modules/@electric-sql/pglite')]) {
    try { const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); if (pj.name !== '@electric-sql/pglite') continue;
      const m = await import(pathToFileURL(path.join(dir, pick(pj.exports && pj.exports['.']) || pj.module || pj.main || 'dist/index.js')).href); if (m.PGlite) return m.PGlite; } catch (e) {}
  }
  return null;
}
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222', M = '44444444-4444-4444-4444-444444444444';

(async () => {
  const PGlite = await findPglite();
  if (!PGlite) { console.log('SKIP forum-e2e: PGlite не найден (DEPS_DIR=…)'); process.exit(process.env.CI_STRICT ? 1 : 0); }
  // ═══ база: настоящий forum.sql ═══
  const read = f => fs.readFileSync(path.join(SITE, f), 'utf8');
  const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + 1); return s.slice(i, j); };
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
create table cur(u uuid); insert into cur values (null);
create function auth.uid() returns uuid language sql stable as 'select u from public.cur';
create table auth.users(id uuid primary key, created_at timestamptz default now());
create table public.profiles(id uuid primary key, nick text, role text default 'user');
create table public.site_config(key text primary key, value text);
create table storage.objects(bucket_id text, name text, metadata jsonb, data bytea);
create table public.xp_ledger(id bigint generated always as identity primary key, user_id uuid not null, source text not null, ref text not null default '', amount int not null, day date not null default current_date, created_at timestamptz default now(), unique (user_id, source, ref, day));`);
  await db.exec(cut(read('community.sql'), 'create or replace function public.comm_norm(p text)', '-- Код приглашения'));
  await db.exec(cut(read('xp.sql'), 'create or replace function public.xp_award(', '-- Вызывать напрямую клиенту нельзя'));
  await db.exec(read('forum.sql'));
  await db.exec(`insert into auth.users values ('${A}', now() - interval '30 days'), ('${B}', now() - interval '30 days'), ('${M}', now() - interval '30 days');
insert into profiles values ('${A}', 'alice', 'user'), ('${B}', 'bob', 'user'), ('${M}', 'mod', 'moderator');
insert into site_config values ('forum', '{"premod_n":0,"media":true,"comment_gap_s":0,"hour_saves":1000,"day_articles":100}');`);
  let UID = M;
  const as = u => db.query(`update cur set u = ${u ? `'${u}'` : 'null'}`);
  const types = {};
  async function rpc(fn, args){
    if (!/^[a-z_0-9]{2,60}$/.test(fn)) return [404, { code: 'PGRST202', message: 'no function' }];
    if (!types[fn]) { const r = (await db.query(`select p.proargnames as n, p.proargtypes::regtype[]::text[] as t from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = $1`, [fn])).rows[0];
      if (!r) return [404, { code: 'PGRST202', message: 'Could not find the function public.' + fn }]; types[fn] = r; }
    const T = types[fn], keys = Object.keys(args || {}), vals = [];
    const parts = keys.map(k => { const i = (T.n || []).indexOf(k); if (i < 0) throw new Error('arg ' + k); const v = args[k]; vals.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v); return `${k} => $${vals.length}::${T.t[i]}`; });
    await as(UID);
    try { const r = await db.query(`select public.${fn}(${parts.join(', ')}) as r`, vals); return [200, r.rows[0].r]; }
    catch (e) { return [400, { code: e.code || 'P0001', message: e.message }]; }
  }
  // старт: модератор публикует 25 статей (сразу, без проверки) — лента с «показать ещё»
  for (let i = 1; i <= 25; i++) {
    const r = (await rpc('forum_save', { p_id: null, p_publish: true, p_doc: { title: `Статья номер ${i} про игры`, tags: i % 3 ? ['гайд'] : ['новости'],
      blocks: [{ t: 'p', r: [{ x: 'Это текст статьи номер ' + i + '. '.repeat(1) + 'Подробности, советы и разбор. '.repeat(12) }] }, ...(i === 25 ? [{ t: 'video', p: 'yt', id: 'dQw4w9WgXcQ' }] : [])] } }))[1];
    if (!r || !r.ok) { console.log('seed fail', r); process.exit(1); }
  }
  const lastSeed = (await db.query(`select max(id)::int r from forum_threads`)).rows[0].r;
  let hiddenId = 0;
  if (LEGACY) {   // права ролей как у Supabase + скрытая модератором статья и черновик — старый клиент не должен их показать
    await db.exec(`grant usage on schema public, auth to anon, authenticated; grant select on cur, profiles to anon, authenticated;
grant select, insert, update, delete on forum_threads, forum_posts to anon, authenticated; grant usage on all sequences in schema public to anon, authenticated;`);
    UID = B;
    hiddenId = (await rpc('forum_save', { p_id: null, p_publish: true, p_doc: { title: 'Скрытая модератором статья', blocks: [{ t: 'p', r: [{ x: 'Текст, который скрыли модераторы за нарушение правил.' }] }] } }))[1].id;
    await rpc('forum_save', { p_id: null, p_publish: false, p_doc: { title: 'Черновик Боба', blocks: [{ t: 'p', r: [{ x: 'не готово' }] }] } });
    UID = M; await rpc('forum_mod', { p_action: 'hide', p_id: hiddenId, p_note: 'правила' });
  }

  // ═══ сервер: сайт + «Supabase» на /sb ═══
  const PORTBOX = {};
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname);
    if (p.startsWith('/sb/')) {
      const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
      const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...H, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); return res.end(); }
      let m;
      if ((m = p.match(/^\/sb\/rest\/v1\/rpc\/([a-z_0-9]+)$/))) { let args = {}; try { args = body.length ? JSON.parse(body) : {}; } catch (e) {} const [st, out] = await rpc(m[1], args); res.writeHead(st, H); return res.end(JSON.stringify(out)); }
      if ((m = p.match(/^\/sb\/storage\/v1\/object\/forum-media\/(.+)$/)) && req.method === 'POST') {
        let data = body, mime = req.headers['content-type'] || '';
        const bm = mime.match(/boundary=([^;]+)/);
        if (bm) { const s = body.toString('latin1'), parts = s.split('--' + bm[1]);
          for (const part of parts) { const i = part.indexOf('\r\n\r\n'); if (i < 0) continue; const head = part.slice(0, i); if (!/filename=|Content-Type: (image|application|text)\//i.test(head)) continue;
            mime = (head.match(/Content-Type: ([^\r\n]+)/i) || [])[1] || 'application/octet-stream'; data = Buffer.from(part.slice(i + 4).replace(/\r\n$/, ''), 'latin1'); } }
        if (!new RegExp('^' + UID + '/[a-z0-9]{16,40}\\.(webp|jpg|pdf|txt|zip)$').test(m[1])) { res.writeHead(403, H); return res.end('{"error":"policy"}'); }
        await db.query(`insert into storage.objects values ('forum-media', $1, $2, $3)`, [m[1], JSON.stringify({ size: data.length, mimetype: mime }), data]);
        res.writeHead(200, H); return res.end(JSON.stringify({ Key: 'forum-media/' + m[1], Id: m[1] }));
      }
      if ((m = p.match(/^\/sb\/storage\/v1\/object\/public\/forum-media\/(.+)$/))) {
        const r = (await db.query(`select data, metadata from storage.objects where bucket_id = 'forum-media' and name = $1`, [m[1]])).rows[0];
        if (!r) { res.writeHead(404, H); return res.end('{}'); }
        res.writeHead(200, { 'Content-Type': r.metadata.mimetype, 'Access-Control-Allow-Origin': '*' }); return res.end(Buffer.from(r.data));
      }
      if (LEGACY && (m = p.match(/^\/sb\/rest\/v1\/(forum_threads|forum_posts)$/))) {   // мини-PostgREST для старого клиента: под RLS, как на сервере
        const tbl = m[1], single = /vnd\.pgrst\.object/.test(req.headers.accept || '');
        let sql;
        try {
          if (req.method === 'GET') {
            const w = [];
            for (const k of ['id', 'thread_id']) { const v = u.searchParams.get(k); if (v) { const mm = v.match(/^eq\.(\d{1,12})$/); if (!mm) throw new Error('bad filter'); w.push(`${k} = ${mm[1]}`); } }
            const ord = (u.searchParams.get('order') || '').split(',').filter(Boolean).map(o => { const [c, d] = o.split('.'); if (!/^(pinned|created_at|id)$/.test(c)) throw new Error('bad order'); return `${c} ${d === 'desc' ? 'desc' : 'asc'}`; });
            const cnt = /forum_posts\(count\)/.test(u.searchParams.get('select') || '');
            sql = `select coalesce(json_agg(x), '[]') r from (select t.*${cnt ? `, (select json_build_array(json_build_object('count', count(*))) from forum_posts p where p.thread_id = t.id) as forum_posts` : ''} from ${tbl} t`
              + `${w.length ? ' where ' + w.join(' and ') : ''}${ord.length ? ' order by ' + ord.join(', ') : ''} limit ${Math.min(+u.searchParams.get('limit') || 1000, 1000)}) x`;
          } else if (req.method === 'POST') {
            const rows = JSON.parse(body.toString() || '[]'), cols = tbl === 'forum_threads' ? 'title, author_id' : 'thread_id, author_id, body';
            const js = JSON.stringify(Array.isArray(rows) ? rows : [rows]).replace(/'/g, "''");
            sql = `with ins as (insert into ${tbl} (${cols}) select ${cols} from json_populate_recordset(null::${tbl}, '${js}'::json) returning *) select coalesce(json_agg(ins), '[]') r from ins`;
          } else throw new Error('method');
          const out = await db.exec(`begin; update cur set u = ${UID ? `'${UID}'` : 'null'}; set local role ${UID ? 'authenticated' : 'anon'}; ${sql}; commit;`);
          const rows = out[3].rows[0].r;
          if (single && !rows.length) { res.writeHead(406, H); return res.end(JSON.stringify({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })); }
          res.writeHead(req.method === 'POST' ? 201 : 200, H); return res.end(JSON.stringify(single ? rows[0] : rows));
        } catch (e) { try { await db.exec('rollback'); } catch (x) {} res.writeHead(400, H); return res.end(JSON.stringify({ code: e.code || 'P0001', message: e.message })); }
      }
      if (p.startsWith('/sb/rest/v1/')) { res.writeHead(200, H); return res.end('[]'); }   // остальные таблицы сайта — пусто
      res.writeHead(200, H); return res.end('{}');
    }
    if (p === '/api/forum-ping') { res.writeHead(200, { 'Content-Type': 'application/json' }); PORTBOX.pinged = (PORTBOX.pinged || 0) + 1; return res.end('{"ok":true}'); }
    if (p === '/' || !path.extname(p)) p = '/index.html';   // разделы SPA (/forum, /forum/new…) — та же index.html
    const f = path.join(SITE, p);
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
    if (LEGACY && p === '/js/core/config.js') { res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' });   // откат одной строкой — как его сделает владелец
      return res.end(fs.readFileSync(f, 'utf8').replace(/const FORUM2 = true;/, 'const FORUM2 = false;')); }
    if (p === '/js/features/chat.js') { res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' });
      return res.end(fs.readFileSync(f, 'utf8').replace(/const SB_URL = '[^']+';/, `const SB_URL = location.origin + '/sb';`)); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  });
  server.keepAliveTimeout = 1000;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 500);
  // файлы для загрузки: картинка PNG 2400×1600 (пересжатие до 1920) и текстовый файл
  const zlib = require('zlib');
  const png = (W, H) => { const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = -1; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ -1) >>> 0; };
    const ch = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(ty), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
    const raw = Buffer.alloc((W * 3 + 1) * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = x % 256; raw[o + 1] = y % 256; raw[o + 2] = 128; }
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]); };
  const IMG = path.join(TMP, 'photo.png'); fs.writeFileSync(IMG, png(2400, 1600));
  const TXT = path.join(TMP, 'notes.txt'); fs.writeFileSync(TXT, 'Заметки к статье\nстрока 2\n');

  const profile = fs.mkdtempSync(path.join(TMP, 'chrome-'));
  const dl = path.join(TMP, 'no-downloads'); fs.mkdirSync(dl, { recursive: true });
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null, browserWs = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); browserWs = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {} if (!page) await sleep(250); }
  if (!page) { console.log('Chrome не запустился'); proc.kill(); server.close(); process.exit(1); }
  try { const bw = new WebSocket(browserWs); await new Promise((r, j) => { bw.onopen = r; bw.onerror = j; }); bw.send(JSON.stringify({ id: 1, method: 'Browser.setDownloadBehavior', params: { behavior: 'deny' } })); await sleep(200); bw.close(); } catch (e) {}
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [], chooser = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push('exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) errs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (d.method === 'Page.fileChooserOpened') chooser.push(d.params.backendNodeId);
  };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, ms = 60000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr, 5000)) return Date.now() - t0; } catch (e) {} await sleep(100); } return -1; };
  const heap = async () => { await send('HeapProfiler.collectGarbage'); await sleep(300); await send('HeapProfiler.collectGarbage'); return +(await ev(`performance.memory.usedJSHeapSize / 1048576`)).toFixed(1); };
  const ourErr = () => errs.filter(e => /^(exception|error)/.test(e) && !/supabase|realtime|ERR_|Failed to fetch|NetworkError|adsbygoogle|googlesyndication|yandex|net::|WebSocket|401|403|404|CORS|130\.61\.75\.73|youtube|ytimg|twitch|mc\.yandex|insights/i.test(e));
  const phone = PROF === 'phone', RATE = phone ? 4 : 1, Q = phone ? 'mid' : 'high';
  const nums = {};
  const login = async (uid, roleName, nick) => { UID = uid; await ev(`(() => { currentUser = { id: ${JSON.stringify(uid)}, email: 'x@test' }; currentRole = ${JSON.stringify(roleName)}; currentProfile = { nick: ${JSON.stringify(nick)}, role: ${JSON.stringify(roleName)} }; return 1; })()`); };
  const go = async p => ev(`(() => { D37Route.go(${JSON.stringify(p)}); return 1; })()`);
  try {
    await send('Page.enable'); await send('Runtime.enable'); await send('HeapProfiler.enable'); await send('DOM.enable');
    try { await send('Page.setDownloadBehavior', { behavior: 'deny', downloadPath: dl }); } catch (e) {}
    await send('Page.setInterceptFileChooserDialog', { enabled: true });
    await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*youtube-nocookie.com*', '*youtube.com*', '*googlesyndication*', '*yandex*', '*twitch.tv*', '*/sb/realtime*', '*googleapis.com/youtube*'] });
    await send('Emulation.setDeviceMetricsOverride', phone ? { width: 412, height: 915, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    if (phone) { await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
    const ls = { d37_perf: 'high', d37_age: JSON.stringify({ y: 1995 }), d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_settings: JSON.stringify({ gfxPreset: Q, gfx: Q }), d37_gfx: Q, d37_forum_sort: 'new' };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
    if (LEGACY) {
    // ═══ FORUM2 = false: старый форум на базе 2.0 ═══
    UID = null;
    await send('Page.navigate', { url: BASE + '/forum' });
    if (RATE > 1) await send('Emulation.setCPUThrottlingRate', { rate: RATE });
    const tList = await waitFor(`document.querySelectorAll('#forumThreadsList a').length >= 10`, 40000);
    ok(tList >= 0, 'старый форум: список тем (FORUM2 = false)', tList >= 0 ? { ms: tList } : { status: await ev(`document.getElementById('forumThreadsStatus')?.textContent`), errs: errs.slice(0, 5) });
    ok(await ev(`!document.querySelector('#forum2') || getComputedStyle(document.querySelector('#forum2')).display === 'none'`), 'раздел 2.0 не показан');
    const listText = await ev(`document.getElementById('forumThreadsList').innerText`);
    ok(!/Скрытая модератором|Черновик Боба/.test(listText), 'скрытая модератором статья и чужой черновик не видны (RLS)');
    ok(/Статья номер 25 про игры/.test(listText) && /💬/.test(listText), 'статьи 2.0 видны как темы');
    await go('/forum/' + lastSeed);
    ok(await waitFor(`document.querySelectorAll('#forumPostsList [data-post-id]').length >= 1`) >= 0, 'статья 2.0 открылась как тема');
    ok(/Это текст статьи номер 25/.test(await ev(`document.getElementById('forumPostsList').innerText`)), 'текст статьи — первым постом');
    await go('/forum/' + hiddenId);
    ok(await waitFor(`/Не удалось загрузить тему/.test(document.getElementById('forumThreadHeader').innerText)`) >= 0 && !/скрыли модераторы/.test(await ev(`document.getElementById('forumPostsList').innerText`)), 'скрытая статья по прямой ссылке — не открывается');
    // новая тема и ответ старым клиентом (прямые записи → охрана forum.sql)
    await login(A, 'user', 'alice');
    await go('/forum'); await waitFor(`document.querySelectorAll('#forumThreadsList a').length >= 10`);
    await ev(`(() => { openForumCreate(); document.getElementById('forumNewTitle').value = 'Тема старым клиентом'; document.getElementById('forumNewBody').value = 'Текст новой темы из старого форума'; submitForumThread(); return 1; })()`);
    const tNew = await waitFor(`/Текст новой темы из старого форума/.test(document.getElementById('forumPostsList')?.innerText || '')`, 20000);
    ok(tNew >= 0, 'старый клиент: новая тема создана и открыта', tNew >= 0 ? undefined : { err: await ev(`document.getElementById('forumCreateError')?.textContent`), hash: await ev('location.href') });
    const nt = (await db.query(`select id, status, blocks->0->'r'->0->>'x' as x, trusted from forum_threads where title = 'Тема старым клиентом'`)).rows[0];
    ok(nt && nt.status === 'published' && nt.x === 'Текст новой темы из старого форума', 'тема старого клиента стала статьёй (статус решил сервер, тело — текстовым блоком)', nt);
    await ev(`(() => { document.getElementById('forumReplyInput').value = 'Ответ старым клиентом'; submitForumReply(); return 1; })()`);
    ok(await waitFor(`document.querySelectorAll('#forumPostsList [data-post-id]').length >= 2`) >= 0, 'старый клиент: ответ появился');
    ok(nt && (await db.query(`select comments r from forum_threads where id = ${nt.id}`)).rows[0].r === 1, 'ответ посчитан комментарием статьи');
    const E0 = ourErr();
    ok(E0.length === 0, 'ошибок в консоли нет (старый форум)', E0.slice(0, 5));
    } else {
    await send('Page.navigate', { url: BASE + '/forum' });
    if (RATE > 1) await send('Emulation.setCPUThrottlingRate', { rate: RATE });
    const tFeed = await waitFor(`document.querySelectorAll('#forum2 .f2-card:not(.f2-skel)').length >= 10`, 40000);
    nums.feed_first_cards_ms = tFeed;
    ok(tFeed >= 0, 'лента: первые карточки', tFeed >= 0 ? { ms: tFeed, rate: RATE } : { ms: tFeed, sb: await ev(`typeof supabase + '/' + typeof sbClient + '/' + (sbClient ? 1 : 0)`), route: await ev(`document.body.dataset.route`), text: await ev(`(document.getElementById('forum-page')?.innerText || '').slice(0, 300)`), errs: errs.slice(0, 5) });
    ok(await ev(`!document.getElementById('forumListView') || getComputedStyle(document.getElementById('forumListView')).display === 'none'`), 'старый список скрыт при FORUM2');
    ok(await ev(`[...document.querySelectorAll('#forum2 .f2-tab')].map(t => t.textContent).join('|').includes('Горячее')`), 'вкладки Горячее / Свежее / Лучшее');
    await ev(`document.querySelector('#forum2 .f2-more').click(), 1`);
    ok(await waitFor(`document.querySelectorAll('#forum2 .f2-card').length >= 25`) >= 0, 'показать ещё — следующая страница ленты');
    ok(await ev(`!!window.D37AdPlaces`), 'реклама в ленте — через D37AdPlaces (место есть, блок — по правилам ad-places.js)');
    // ── статья с видео ──
    const t0 = Date.now(); await go('/forum/' + lastSeed);
    const tArt = await waitFor(`!!document.querySelector('#forum2 .f2-title') && !!document.querySelector('#forum2 .f2-body p')`);
    nums.article_open_ms = tArt;
    ok(tArt >= 0, 'статья открылась', { ms: tArt });
    ok(await ev(`!document.querySelector('#forum2 iframe') && !!document.querySelector('#forum2 .f2-vplay')`), 'видео: сначала заставка, без iframe');
    await ev(`document.querySelector('#forum2 .f2-vplay').click(), 1`);
    ok(await ev(`(() => { const f = document.querySelector('#forum2 .f2-vframe iframe'); return !!f && /^https:\\/\\/www\\.youtube-nocookie\\.com\\/embed\\//.test(f.src) && f.getAttribute('sandbox').includes('allow-scripts'); })()`), 'видео по нажатию — iframe youtube-nocookie с sandbox');
    ok(await ev(`location.pathname.startsWith('/forum/${lastSeed}-')`), 'адрес статьи со «слагом»', await ev('location.pathname'));
    // ── автор пишет статью со всеми блоками ──
    await login(A, 'user', 'alice');
    await ev(`(() => { window.__toasts = []; const o = window.xpToast; window.xpToast = t => { window.__toasts.push(String(t)); if (o) try { o(t); } catch (e) {} }; return 1; })()`);
    await go('/forum/new');
    ok(await waitFor(`!!document.querySelector('#forum2 .f2-titlein')`) >= 0, 'редактор открылся');
    const typeIn = (sel, val, idx = 0) => ev(`(() => { const el = document.querySelectorAll(${JSON.stringify(sel)})[${idx}]; el.value = ${JSON.stringify(val)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    const clickText = t => ev(`(() => { const b = [...document.querySelectorAll('#forum2 button')].find(x => x.textContent.trim() === ${JSON.stringify(t)}); if (!b) return 0; b.click(); return 1; })()`);
    await typeIn('#forum2 .f2-titlein', 'Мой гайд: как построить базу');
    await typeIn('#forum2 .f2-bed[data-t="p"] textarea', 'Начнём с **главного**: строим у воды. Подробнее — [на вики](https://minecraft.fandom.com/ru/wiki/База). Это важный совет для новичков, проверено. ' + 'Подробный разбор: где копать, что ставить первым и как не потерять вещи ночью. '.repeat(4));
    ok(await clickText('Заголовок'), 'кнопка «Заголовок»'); await typeIn('#forum2 .f2-bed[data-t="h"] input', 'Материалы');
    ok(await clickText('Список'), 'кнопка «Список»'); await typeIn('#forum2 .f2-bed[data-t="list"] textarea', 'дерево\nкамень\nстекло');
    ok(await clickText('❝ Цитата'), 'кнопка «Цитата»'); await typeIn('#forum2 .f2-bed[data-t="quote"] textarea', 'Лучшая база — та, что у воды');
    ok(await clickText('🎬 Видео'), 'кнопка «Видео»'); await typeIn('#forum2 .f2-bed[data-t="video"] input', 'https://youtu.be/dQw4w9WgXcQ');
    ok(await ev(`!!document.querySelector('#forum2 .f2-bed[data-t="video"] .f2-vplay')`), 'видео: ссылка распознана, заставка в редакторе');
    chooser.length = 0; ok(await clickText('🖼 Фото'), 'кнопка «Фото»');
    for (let i = 0; i < 50 && !chooser.length; i++) await sleep(100);
    const gotImgChooser = chooser.length > 0;
    if (chooser.length) await send('DOM.setFileInputFiles', { files: [IMG], backendNodeId: chooser.shift() });
    ok(gotImgChooser, 'фото: окно выбора файла открылось');
    const tImg = await waitFor(`!!document.querySelector('#forum2 .f2-bed[data-t="img"] img')`, 120000);
    nums.photo_reencode_upload_ms = tImg;
    ok(tImg >= 0, 'фото: пересжато в браузере и загружено', { ms: tImg, chooserLeft: chooser.length, toasts: await ev('window.__toasts') });
    const stored = (await db.query(`select name, (metadata->>'size')::int as size, metadata->>'mimetype' as mime from storage.objects where name like '${A}/%' and name ~ '\\.(webp|jpg)$'`)).rows[0];
    ok(stored && stored.size < 900 * 1024 && /image\/(webp|jpeg)/.test(stored.mime), 'фото в хранилище: WebP/JPEG, не больше img_kb', stored);
    chooser.length = 0; ok(await clickText('📎 Файл'), 'кнопка «Файл»');
    for (let i = 0; i < 50 && !chooser.length; i++) await sleep(100);
    if (chooser.length) await send('DOM.setFileInputFiles', { files: [TXT], backendNodeId: chooser.shift() });
    ok(await waitFor(`!!document.querySelector('#forum2 .f2-bed[data-t="file"]')`, 30000) >= 0, 'файл (.txt) загружен', { chooser: chooser.length, toasts: await ev('window.__toasts') });
    ok(await clickText('— Линия'), 'кнопка «Линия»');
    await typeIn('#forum2 .f2-srcurl', 'https://minecraft.fandom.com/ru/wiki/');
    await typeIn('#forum2 .f2-lab input', 'Minecraft Wiki', 1);
    await typeIn('#forum2 .f2-lab input', 'minecraft, гайд', 2);
    await ev(`(() => { const b = [...document.querySelectorAll('#forum2 .f2-edtabs button')][1]; b.click(); return 1; })()`);
    ok(await ev(`!!document.querySelector('#forum2 .f2-prev strong') && !!document.querySelector('#forum2 .f2-prev .f2-source')`), 'просмотр: блоки и источник');
    await ev(`(() => { const b = [...document.querySelectorAll('#forum2 .f2-edtabs button')][0]; b.click(); return 1; })()`);
    ok(await waitFor(`Object.keys(localStorage).some(x => x.startsWith('d37_forum_draft_')) || /черновик сохранён/.test(document.querySelector('#forum2 .f2-saved')?.textContent || '')`, 5000) >= 0, 'черновик сохранён (на устройстве или на сервере)', await ev(`document.querySelector('#forum2 .f2-saved')?.textContent`));
    const tPub0 = Date.now(); await clickText('🚀 Опубликовать');
    const tPub = await waitFor(`/^\\/forum\\/\\d+-/.test(location.pathname) && !!document.querySelector('#forum2 .f2-title')`, 30000);
    nums.publish_to_article_ms = tPub;
    ok(tPub >= 0, 'статья опубликована и открыта', { ms: tPub, path: await ev('location.pathname'), err: await ev(`document.querySelector('#forum2 .f2-err-line')?.textContent || ''`) });
    const art = await ev(`(() => { const b = document.querySelector('#forum2 .f2-body'); if (!b) return null; return { strong: !!b.querySelector('strong'), link: b.querySelector('a[rel="nofollow ugc noopener"]')?.href || '', h2: !!b.querySelector('h2'),
      list: b.querySelectorAll('li').length, quote: !!b.querySelector('blockquote'), img: !!b.querySelector('figure:not(.f2-video) img'), video: !!b.querySelector('.f2-vplay'), file: !!b.querySelector('.f2-file a[download]'), hr: !!b.querySelector('hr'),
      source: document.querySelector('#forum2 .f2-source a')?.rel || '', tags: document.querySelectorAll('#forum2 .f2-art .f2-tag').length }; })()`);
    ok(art && art.strong && /fandom/.test(art.link) && art.h2 && art.list === 3 && art.quote && art.img && art.video && art.file && art.hr && /ugc/.test(art.source) && art.tags === 2, 'статья: все блоки на месте', art);
    const newId = +(await ev(`location.pathname.match(/\\/forum\\/(\\d+)/)[1]`));
    ok(PORTBOX.pinged >= 1, 'после публикации — запрос IndexNow (/api/forum-ping)');
    ok((await db.query(`select count(*)::int r from xp_ledger where source = 'forum_thread' and ref = '${newId}'`)).rows[0].r === 1, 'XP за опубликованную статью — один раз');
    // ── читатель: оценка, закладка, комментарий, ответ, жалоба ──
    await login(B, 'user', 'bob');
    await go('/forum'); await waitFor(`document.querySelectorAll('#forum2 .f2-card').length > 0`);
    await go('/forum/' + newId); await waitFor(`!!document.querySelector('#forum2 .f2-vote')`);
    await ev(`document.querySelector('#forum2 .f2-vote').click(), 1`);
    ok(await waitFor(`document.querySelector('#forum2 .f2-rating')?.textContent === '+1'`) >= 0, 'оценка +1');
    await ev(`[...document.querySelectorAll('#forum2 .f2-act')].find(b => b.textContent.includes('закладки')).click(), 1`);
    ok(await waitFor(`[...document.querySelectorAll('#forum2 .f2-act')].some(b => b.textContent.includes('В закладках'))`) >= 0, 'закладка');
    await typeIn('#forum2 .f2-comments > .f2-reply textarea', 'Отличный гайд, спасибо!');
    await ev(`document.querySelector('#forum2 .f2-comments > .f2-reply button').click(), 1`);
    ok(await waitFor(`[...document.querySelectorAll('#forum2 .f2-c-body')].some(x => x.textContent.includes('Отличный гайд'))`) >= 0, 'комментарий появился');
    await ev(`[...document.querySelectorAll('#forum2 .f2-c .f2-link')].find(b => b.textContent === 'Ответить').click(), 1`);
    await typeIn('#forum2 .f2-c .f2-reply textarea', 'И ещё вопрос: а зимой?');
    await ev(`document.querySelector('#forum2 .f2-c .f2-reply button').click(), 1`);
    ok(await waitFor(`!!document.querySelector('#forum2 .f2-kids .f2-c')`) >= 0, 'ответ деревом');
    await ev(`(() => { window.prompt = () => 'спам'; [...document.querySelectorAll('#forum2 .f2-act')].find(b => b.textContent.includes('Пожаловаться')).click(); return 1; })()`);
    await sleep(800);
    ok((await db.query(`select count(*)::int r from forum_reports where kind = 'article' and target = ${newId}`)).rows[0].r === 1, 'жалоба записана');
    // ── модератор видит жалобу ──
    await login(M, 'moderator', 'mod');
    await go('/forum/mod');
    ok(await waitFor(`[...document.querySelectorAll('#forum2 .f2-mod .f2-card a')].some(a => a.getAttribute('href').startsWith('/forum/${newId}'))`) >= 0, 'модератор: жалоба в очереди');
    // ── 20 раз открыть / закрыть ──
    await login(B, 'user', 'bob');
    await go('/'); await sleep(1500);
    const h0 = await heap(), n0 = await ev(`document.getElementsByTagName('*').length`);
    const R = +ROUNDS || 20, times = [];
    for (let i = 0; i < R; i++) {
      const s = Date.now(); await go('/forum/' + newId); const t = await waitFor(`!!document.querySelector('#forum2 .f2-c-body')`, 20000); times.push(t >= 0 ? Date.now() - s : -1);
      await go('/'); await waitFor(`document.body.dataset.route === 'home'`, 10000);
    }
    const h1 = await heap(), n1 = await ev(`document.getElementsByTagName('*').length`);
    times.sort((a, b) => a - b);
    nums.reopen_median_ms = times[Math.floor(times.length / 2)]; nums.heap_before_mb = h0; nums.heap_after_mb = h1; nums.dom_before = n0; nums.dom_after = n1;
    ok(times.every(t => t >= 0), `${R}× открыть / закрыть статью`, { median: nums.reopen_median_ms, max: times[times.length - 1] });
    ok(h1 - h0 < 6, 'память после переоткрытий не растёт (< 6 МБ)', { h0, h1 });
    ok(n1 - n0 < 400, 'узлы DOM не копятся', { n0, n1 });
    ok(await ev(`document.querySelectorAll('#f2Css').length === 1 && document.querySelectorAll('#forum2').length === 1`), 'стили и корень раздела — по одному');
    const E = ourErr();
    ok(E.length === 0, 'ошибок в консоли нет', E.slice(0, 5));
    }   // конец «FORUM2 = true»
  } catch (e) { fail++; console.log('FAIL', e.stack || e); }
  console.log('NUMBERS', JSON.stringify({ prof: PROF, rate: RATE, q: Q, ...nums }));
  try { ws.close(); } catch (e) {}
  proc.kill(); server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  console.log(fail ? `forum-e2e: ${fail} FAIL` : 'forum-e2e OK');
  process.exit(fail ? 1 : 0);
})();
