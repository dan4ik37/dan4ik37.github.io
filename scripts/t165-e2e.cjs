// T-165: наш «Дискорд» — проверка в настоящем Chrome (headless, без npm, загрузки запрещены, без входа и без записи в базу).
//  Профиль телефона: 390x844, касания, CPU ×4.
//  1) /chat гостем: модули чата качаются параллельно и выполняются по порядку (D37DS, MsgView, D37Dsm, D37Mod на месте), лента есть;
//  2) «функции нет на сервере» (ч. 11–14 community.sql не выполнены) — второй заход не зовёт её снова (нет 404 в консоли);
//  3) текст файла без повтора имени и размера (подпись остаётся; только «📎 имя · размер» — без строки текста);
//  4) история 2000 сообщений страницами по 50: всё догружается сверху, порядок верный, разделитель дня один,
//     группировка по автору на стыке страниц, вставка сверху (старые узлы не пересоздаются);
//  5) утечки: 20 раз открыть / закрыть ленту (MsgView) — подписки сняты; 20 раз /chat ↔ главная — каналов realtime не прибавляется,
//     память после сборки мусора растёт не больше чем на 8 МБ; ошибок JS нет.
// Запуск из корня сайта: node scripts/t165-e2e.cjs  (CHROME=…, PYTHON=…, BASE=http://127.0.0.1:5500 — уже запущенный сервер)
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/t165-ds' : os.tmpdir());
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0;
const ok = (c, m, x) => { n++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); if (!c) fails++; };
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
async function startSite(){
  if (process.env.BASE) return { base: process.env.BASE.replace(/\/$/, ''), stop(){} };
  const port = await freePort();
  const py = spawn(process.env.PYTHON || 'python', [path.join(SITE, 'scripts/serve.py'), String(port)], { cwd: SITE, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) break; } catch (e) {} await sleep(150); }
  return { base: `http://127.0.0.1:${port}`, stop(){ try { py.kill(); } catch (e) {} } };
}
async function chrome(){
  fs.mkdirSync(TMP, { recursive: true });
  const port = await freePort(), profile = fs.mkdtempSync(path.join(TMP, 'chr-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', '--enable-precise-memory-info', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [], net404 = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && /\/rest\/v1\/rpc\//.test(d.params.entry.url || '')) net404.push(d.params.entry.url.replace(/.*\/rpc\//, '')); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Page.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const L = { d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_ds_tip: '1' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(150); } return false; };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, close, errs, net404 };
}
const FEED = `!!document.querySelector('#dsHost .mv-m, #dsHost .mv-empty')`;
// поддельный канал: N сообщений, страницы по 50 (по возрастанию id), авторы сменяются блоками по 3, 4 дня
const MOUNT = (N, tag) => `(async () => {
  await D37Phone.need('mv');
  document.getElementById('mvt')?.remove();
  const box = document.createElement('div'); box.id = 'mvt'; box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#111;display:flex;flex-direction:column';
  document.body.appendChild(box);
  const N = ${N}, t0 = Date.now() - N * 60e3, all = [];
  for (let i = 1; i <= N; i++) all.push({ id: i, uid: 'u' + (Math.floor((i - 1) / 3) % 4), nick: 'Игрок' + (Math.floor((i - 1) / 3) % 4), text: 'сообщение ' + i, at: new Date(t0 + i * 60e3 - (i < N / 2 ? 2 * 864e5 : 0)).toISOString(), reactions: {} });
  window.__subs = window.__subs || 0; window.__loads = 0;
  const A = { key: 'test:t165${tag}', title: '#тест', maxLen: 500, fileKind: 'chat',
    caps: { reply: true, edit: true, del: true, react: 'count', pin: false, report: false, typing: false, search: false, stickers: false },
    load: async ({ before } = {}) => { window.__loads++; const end = before ? all.findIndex(m => m.id === before) : all.length, st = Math.max(0, end - 50); return { list: all.slice(st, end), more: st > 0 }; },
    sub(fn){ window.__subs++; return () => { window.__subs--; }; },
    send: async () => ({ ok: false, err: 'тест' }), edit: async () => ({ ok: true }), del: async () => ({ ok: true }), react: async () => ({ ok: true }),
    state: () => ({ mode: 'write' }), me: () => ({ uid: 'me', nick: 'Я' }) };
  window.__v = MsgView.mount(box, { noFocus: true });
  await window.__v.setAdapter(A);
  return document.querySelectorAll('#mvt .mv-m').length;
})()`;

(async () => {
  // 0) «❓ Вопрос дня» (api/push-check.js) — чистая функция
  try {
    const pc = await import(require('url').pathToFileURL(path.join(SITE, 'api/push-check.js')).href);
    const a = pc.dailyQFor(pc.DAILY_Q_DEF, '2026-11-18'), b = pc.dailyQFor(pc.DAILY_Q_DEF, '2026-11-19');
    ok(a && b && a !== b && pc.DAILY_Q_DEF.length >= 30, 'вопрос дня: каждый день другой, список ≥ 30', [a, b]);
    ok(pc.dailyQFor([], '2026-11-18') === '' && pc.dailyQFor(['x', 5, ' '], 'bad') === '' && pc.dailyQFor(['x', 5, ' '], '2026-11-18') === 'x', 'вопрос дня: пустой / кривой список и дата — без вопроса, мусор пропущен');
  } catch (e) { ok(false, 'вопрос дня: ' + e.message); }
  const site = await startSite();
  const B = await chrome();
  try {
    // 1) /chat гостем
    await B.send('Page.navigate', { url: site.base + '/chat' });
    ok(await B.until(FEED, 60000), '/chat на телефоне: лента показана');
    ok(await B.until(`document.querySelector('.ds-top [data-ds="right"]')?.hasAttribute('data-n')`, 20000), 'шапка канала: на 👥 — число «в сети»', await B.ev(`document.querySelector('.ds-top [data-ds="right"]')?.dataset.n`));
    const mods = await B.ev(`['D37DS', 'MsgView', 'D37Dsm', 'D37Files', 'D37Mod', 'D37Player'].filter(k => !window[k])`);
    ok(!mods.length, 'модули чата загружены и выполнены по порядку', mods);
    const asyncs = await B.ev(`[...document.scripts].filter(s => /js\\/features\\/(msgview|community|ds-)/.test(s.src)).map(s => s.async)`);
    ok(asyncs.length >= 5 && asyncs.every(a => a === false), 'файлы чата вставлены с async=false (порядок выполнения держит браузер)', asyncs.length);

    // 2) память «функции нет на сервере»
    await sleep(2500);
    const miss = await B.ev(`Object.keys((JSON.parse(localStorage.getItem('d37_rpc_miss') || '{}').t) || {})`);
    const first404 = B.net404.slice();
    console.log('    нет на сервере:', JSON.stringify(miss), '404 при первом заходе:', first404.length);
    if (first404.length) {
      ok(miss.length > 0, 'отсутствующие функции запомнены', miss);
      B.net404.length = 0;
      await B.send('Page.reload', {});
      ok(await B.until(FEED, 60000), 'второй заход: лента показана');
      await sleep(3000);
      const again = B.net404.filter(f => miss.includes(f.split('?')[0]));
      ok(again.length === 0, 'второй заход: запомненные функции не зовутся (нет 404 в консоли)', again);
      ok(await B.ev(`(async () => { const r = await D37Phone.rpc(${JSON.stringify(miss[0])}, {}); return r.missing && r.cached; })()`), 'P.rpc отвечает «нет функции» из памяти');
    } else ok(true, 'все функции на сервере — 404 нет');

    // 3) текст файла
    const ft = await B.ev(`(async () => {
      await D37Phone.need('mv');
      const h = 'cd'.repeat(32), att = { v: 1, enc: 'none', kid: '', name: 'pngwing.com (11).png', size: 1153434, mime: 'image/png', chash: h, phash: h, w: 10, h: 10 };
      const sz = D37Files.size(att.size);
      const box = document.createElement('div'); box.id = 'mvf'; box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#111;display:flex;flex-direction:column'; document.body.appendChild(box);
      const A = { key: 'test:t165f', title: '#тест', maxLen: 500, fileKind: 'chat', caps: { reply: true, edit: false, del: false, react: false },
        load: async () => ({ list: [{ id: 1, uid: 'u1', nick: 'А', text: '📎 ' + att.name + ' · ' + sz + ' 123', at: new Date().toISOString(), att },
          { id: 2, uid: 'u1', nick: 'А', text: '📎 ' + att.name + ' · ' + sz, at: new Date().toISOString(), att }, { id: 3, uid: 'u1', nick: 'А', text: 'обычный текст', at: new Date().toISOString() }], more: false }),
        sub(){ return () => {}; }, send: async () => ({ ok: false }), state: () => ({ mode: 'write' }), me: () => ({ uid: 'me', nick: 'Я' }) };
      const v = MsgView.mount(box, { noFocus: true }); await v.setAdapter(A);
      const t = id => box.querySelector('.mv-m[data-id="' + id + '"] .mv-text')?.textContent.trim() ?? null;
      const r = { a: t(1), b: t(2), c: t(3), cards: box.querySelectorAll('.mv-file').length, link: box.textContent.includes('[ссылка]') };
      v.destroy(); box.remove(); return r;
    })()`);
    ok(ft.a === '123', 'файл с подписью: в тексте только подпись', ft.a);
    ok(ft.b === null && ft.cards === 2, 'файл без подписи: строки текста нет, карточка есть', ft);
    ok(ft.c === 'обычный текст' && !ft.link, 'обычный текст не тронут, «[ссылка]» из имени файла нет');

    // 4) история 2000 сообщений
    ok(await B.ev(MOUNT(2000, 'h')) === 50, 'лента 2000: первая страница — 50');
    const keep = await B.ev(`(window.__keepEl = document.querySelector('#mvt .mv-m[data-id="2000"]'), !!window.__keepEl)`);
    for (let i = 0; i < 60; i++) {
      const left = await B.ev(`(async () => { const l = document.querySelector('#mvt .mv-list'); l.scrollTop = 0; l.dispatchEvent(new Event('scroll')); await new Promise(r => setTimeout(r, 60)); return document.querySelectorAll('#mvt .mv-m').length; })()`);
      if (left >= 2000) break;
    }
    const h = await B.ev(`(() => {
      const ms = [...document.querySelectorAll('#mvt .mv-m')], ids = ms.map(m => +m.dataset.id);
      const days = [...document.querySelectorAll('#mvt .mv-list > .mv-day')].map(d => d.textContent);
      let sorted = true; for (let i = 1; i < ids.length; i++) if (ids[i] <= ids[i - 1]) sorted = false;
      // стык страниц: 1950/1951 — один автор (блоки по 3: 1949–1951)? проверяем группировку по правилу автора
      let badGroup = 0;
      for (let i = 1; i < ms.length; i++) { const a = Math.floor((ids[i - 1] - 1) / 3) % 4, b = Math.floor((ids[i] - 1) / 3) % 4; const prevSib = ms[i].previousElementSibling;
        if (a === b && prevSib === ms[i - 1] && ms[i].classList.contains('mv-first')) badGroup++; if (a !== b && !ms[i].classList.contains('mv-first')) badGroup++; }
      const dupDays = days.length !== new Set(days).size;
      return { n: ids.length, sorted, days: days.length, dupDays, badGroup, top: document.querySelector('#mvt .mv-list').firstElementChild.className, loads: window.__loads, kept: window.__keepEl.isConnected };
    })()`);
    ok(h.n === 2000 && h.sorted, 'история: все 2000 сообщений, по порядку', { n: h.n, loads: h.loads });
    ok(!h.dupDays && h.days >= 2, 'история: разделитель дня — по одному на день', h.days);
    ok(h.badGroup === 0, 'история: группировка по автору верная и на стыках страниц', h.badGroup);
    ok(/mv-start/.test(h.top), 'история: сверху «Это начало канала»', h.top);
    ok(keep && h.kept, 'история вставлялась сверху: последнее сообщение — тот же узел (без перерисовки всей ленты)');
    // 5) утечки: 20 раз лента
    await B.ev(`(window.__v.destroy(), document.getElementById('mvt').remove(), window.__subs = 0, 1)`);
    for (let i = 0; i < 20; i++) await B.ev(`(async () => { await (${MOUNT(200, 'l')}); window.__v.destroy(); document.getElementById('mvt').remove(); return 1; })()`);
    ok(await B.ev(`window.__subs`) === 0, '20 раз лента открыть / закрыть: подписки сняты');
    // 20 раз /chat ↔ главная
    const heap = async () => { await B.send('HeapProfiler.collectGarbage'); await sleep(300); await B.send('HeapProfiler.collectGarbage'); return B.ev(`Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10`); };
    const chans = () => B.ev(`(typeof sbClient !== 'undefined' && sbClient.getChannels ? sbClient.getChannels().length : -1)`);
    await B.ev(`D37Route.go('/'), 1`); await sleep(1500); await B.ev(`D37Route.go('/chat'), 1`); await B.until(FEED, 30000); await sleep(1500);
    const h0 = await heap(), c0 = await chans();
    for (let i = 0; i < 20; i++) { await B.ev(`D37Route.go('/'), 1`); await sleep(500); await B.ev(`D37Route.go('/chat'), 1`); await B.until(FEED, 30000); await sleep(500); }
    await sleep(2000);
    const h1 = await heap(), c1 = await chans();
    console.log('    память до / после 20 переходов, МБ:', h0, h1, 'каналов realtime:', c0, c1);
    ok(c1 <= c0, '20 раз /chat ↔ главная: каналов realtime не прибавилось', { c0, c1 });
    ok(h1 - h0 < 8, '20 раз /chat ↔ главная: память растёт меньше 8 МБ', { h0, h1 });
    ok(!B.errs.length, 'ошибок JS нет', B.errs.slice(0, 3));
  } catch (e) { ok(false, 'исключение: ' + (e.message || e)); }
  finally { await B.close(); site.stop(); }
  console.log(`\nT-165 e2e: ${n - fails}/${n} ok`);
  process.exit(fails ? 1 : 0);
})();
