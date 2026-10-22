// «Путь клетки» (T-056) в настоящем Chrome (headless, DevTools Protocol, без npm):
//   smoke — ПК и телефон: кнопка пути в меню, «Мой род», «Эволюция» (купить и поставить часть, сохранить), игра в Луже / Глубине
//           с ботами (облик, колония, ДНК в HUD), «Микромир», снимки экрана, ошибки в консоли;
//   perf  — «телефон»: CPU ×4 медленнее, 412×915, «средняя» (body без .high): время кадра (шаги + рисунок) обычной арены и пути в каждом
//           биоме, полная комната (16 участников) и снимки 9 гостям — как scripts/iogames-e2e.cjs; BASE2 — старая копия сайта для «до»;
//   leak  — 20 раз открыть путь (игра с ботами) и закрыть: память, узлы DOM, холсты;
//   soak  — 10 минут игры в пути (по кругу Лужа → Риф → Глубина, управление случайное): ошибки, память по минутам.
// Запуск из корня сайта: node scripts/evo-e2e.cjs [smoke|perf|leak|soak|all] [сек замера]
//   сайт раздаёт сам (из этой папки); BASE=http://localhost:5591 — чужая раздача (python scripts/serve.py 5591);
//   BASE2=http://localhost:5592 — старая копия сайта для «до» в perf; SOAK_MIN — минут прогона soak (10).
// Временное — D37_TMP или E:\claude-tmp\t056 (профиль Chrome, снимки).
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const SITE = path.join(__dirname, '..');
const MODE = process.argv[2] || 'smoke';
const SECS = +process.argv[3] || 12;
let BASE = (process.env.BASE || '').replace(/\/+$/, '');
const BASE2 = (process.env.BASE2 || '').replace(/\/+$/, '');
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp/t056' : path.join(os.tmpdir(), 'd37-t056')), OUT = path.join(TMP, 'shots');
// своя раздача: файлы сайта, /play/… и / → index.html
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function serve(){
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/' || p.startsWith('/play/')) p = '/index.html';
    const f = path.join(SITE, p);
    if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SOAK_MIN = +process.env.SOAK_MIN || 10;
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✓', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };

(async () => {
  let own = null;
  if (!BASE) { own = await serve(); BASE = 'http://localhost:' + own.address().port; }
  const port = 9300 + Math.floor(Math.random() * 300);
  const profile = path.join(TMP, 'chrome-' + Date.now().toString(36));
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился: ' + CHROME); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const cb = new Map(), subs = new Set();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [okf, bad] = cb.get(d.id); cb.delete(d.id); d.error ? bad(new Error(d.error.message)) : okf(d.result); } else if (d.method) subs.forEach(f => f(d)); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; cb.set(i, [res, rej]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result.value; };
  const errors = [];
  subs.add(d => {
    if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  });
  await send('Page.enable'); await send('Runtime.enable');
  // без окошек возраста и «установить приложение», без звука; perf — «средняя» (не .high)
  const perfMode = MODE === 'perf' ? 'mid' : 'high';
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('d37_age_ask',String(Date.now()+864e6));localStorage.setItem('d37_perf',${JSON.stringify(perfMode)});localStorage.setItem('d37_app',JSON.stringify({x:1,v:1}));localStorage.setItem('d37_games_mute','1')}catch(e){}` });
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); return name; };
  const go = async url => { await send('Page.navigate', { url }); await sleep(700); };
  const waitFor = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(200); } return false; };
  const click = sel => ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`);
  const pc = () => send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
  const phone = async () => { await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); };
  // пробный род с ДНК (гость): так можно сразу покупать части
  const seedTrial = (o = {}) => ev(`(() => { localStorage.setItem('d37_evo_trial', JSON.stringify(Object.assign({ stage: 1, dna: 600, earned: 0 }, ${JSON.stringify(o)}))); return 1; })()`);
  const T = 'GAME_IMPL.kletochki._test';
  const report = {};
  try {
    // ═══ smoke ═══
    if (MODE === 'smoke' || MODE === 'all') {
      console.log('— smoke');
      await pc();
      await go(`${BASE}/#/home`); await seedTrial();
      await go(`${BASE}/#/games/kletochki`);
      ok(await waitFor(`!!document.querySelector('[data-io="evhub"]')`), 'в меню «Клеточек» есть «🧬 Путь клетки»');
      await shot('evo-menu-pc.png');
      await click('[data-io="evhub"]');
      ok(await waitFor(`!!document.querySelector('.kp-hub .kp-bios')`), '«Мой род» открылся (биомы, стадии, ДНК)');
      ok(await ev(`document.querySelectorAll('.kp-bio.off').length === 2`), 'Риф и Глубина закрыты на стадии «Клетка»');
      await shot('evo-hub-pc.png');
      await click('[data-io="evedit"]');
      ok(await waitFor(`!!document.querySelector('.kp-evo .kp-ring')`), '«Эволюция»: мембрана с 6 местами');
      await click('[data-io="evbuy"][data-id="flagellum"]');
      ok(await waitFor(`D37Evo.api.st.owned.flagellum === 1 && D37Evo.api.st.stage === 2`), 'купил жгутик → стадия «Органоиды»');
      await click('[data-io="evbuy"][data-id="adhesion"]'); await sleep(200);
      await click('[data-io="evbuy"][data-id="eye"]'); await sleep(200);
      await click('[data-io="evslot"][data-k="3"]'); await sleep(150);
      await click('[data-io="evput"][data-id="flagellum"]'); await sleep(150);
      await click('[data-io="evslot"][data-k="2"]'); await sleep(150);
      await click('[data-io="evput"][data-id="adhesion"]'); await sleep(150);
      await click('[data-io="evslot"][data-k="0"]'); await sleep(150);
      await click('[data-io="evput"][data-id="eye"]'); await sleep(150);
      await click('[data-io="evform"][data-v="wedge"]'); await sleep(150);
      await shot('evo-editor-pc.png');
      await click('[data-io="evsave"]');
      ok(await waitFor(`D37Evo.designCode(D37Evo.api.st.design) === 'e.hf..w'`, 4000), 'облик сохранён: глазок, липкость, жгутик, клин', await ev(`D37Evo.designCode(D37Evo.api.st.design)`));
      ok(await waitFor(`!!document.querySelector('.kp-hub')`), 'после сохранения — снова «Мой род»');
      await click('[data-io="evplay"][data-b="pool"][data-m="bots"]');
      ok(await waitFor(`!!(${T}.S?.W?.evo && ${T}.S.W.evo.b === 'pool')`), 'Лужа: мир пути с ботами');
      await sleep(1500);
      const me = await ev(`(() => { const S = ${T}.S, o = S.W.owners[S.me]; return { parts: o.parts, colony: o.st.colony, form: o.form, kinds: S.W.owners.filter(q => q && q.bot).map(q => q.kind) }; })()`);
      ok(me.parts.join() === 'eye,adhesion,flagellum' && me.colony === 3 && me.form === 'wedge', 'облик рода в игре: части и колония 3', me);
      ok(me.kinds.every(k => k === 0 || k === 1), 'в Луже — только Капельки и Зелёнки', me.kinds);
      // разделиться дважды → колония 3
      await ev(`(() => { const S = ${T}.S; for (const s of S.W.cL.subarray(0, S.W.cN)) if (S.W.cO[s] === S.me) S.W.cM[s] = 200; return 1; })()`);
      await ev(`(() => { const S = ${T}.S; S.setInput(Float64Array.from([1, 0, 0, 0, 0, 0]), performance.now()); return 1; })()`); await sleep(300);   // первое управление — точка отсчёта счётчиков
      await ev(`(() => { const S = ${T}.S; S.setInput(Float64Array.from([1, 0, 1, 0, 0, 0]), performance.now()); return 1; })()`); await sleep(400);
      await ev(`(() => { const S = ${T}.S, I = Float64Array.from([1, 0, 2, 0, 0, 0]); S.setInput(I, performance.now()); return 1; })()`); await sleep(1200);
      const col = await ev(`(() => { const S = ${T}.S, W = S.W; let b = 0; for (const s of W.cL.subarray(0, W.cN)) if (W.cO[s] === S.me && W.cB[s]) b++; return { b, oc: W.oc[S.me], colN: W.owners[S.me].colN }; })()`);
      ok(col.b === 3 && col.colN === 3, 'колония: 3 клетки держатся вместе', col);
      await sleep(2500);
      ok(await ev(`/🧬/.test(document.querySelector('.kp-hl')?.textContent || '')`), 'HUD пути: ДНК жизни, свет, колония, цель', await ev(`document.querySelector('.kp-hl')?.textContent`));
      await shot('evo-pool-pc.png');
      // съесть себя (KO) → карточка с ДНК
      await ev(`(() => { const S = ${T}.S, W = S.W; for (const s of W.cL.subarray(0, W.cN)) if (W.cO[s] === S.me) W.cDead[s] = 1, W.oc[S.me]--; return 1; })()`);
      ok(await waitFor(`/ДНК/.test(document.querySelector('.kp-gain')?.textContent || '') && !/считаем/.test(document.querySelector('.kp-gain')?.textContent || '')`, 6000), 'съели → карточка: ДНК засчитана (пробный род)', await ev(`document.querySelector('.kp-gain')?.textContent`));
      ok(await ev(`D37Evo.api.st.rec.lives >= 1 && D37Evo.api.st.play > 0`), 'жизнь записана в род (минуты, рекорды)', await ev(`JSON.stringify(D37Evo.api.st.rec)`));
      await shot('evo-ko-pc.png');
      await click('[data-io="evedit"]');
      ok(await waitFor(`!!document.querySelector('.kp-evo')`), 'из карточки «съели» — в «Эволюцию»');
      await click('[data-io="evback"]');
      ok(await waitFor(`!!document.querySelector('.kp-gain')`), '«← Назад» — снова карточка «съели»');
      // «Ещё раз» → новая жизнь (новый билет) → конец раунда: итоги с ДНК, новый раунд — карточка уходит сама
      const lives0 = await ev('D37Evo.api.st.rec.lives');
      await click('[data-io="again"]');
      ok(await waitFor(`(() => { const S = ${T}.S; return S.W.owners[S.me].alive; })()`, 5000), '«Ещё раз» — снова в игре');
      await sleep(1500);
      ok(await ev(`!!D37Evo.api.st.tk`), 'новая жизнь — новый билет');
      await ev(`${T}.S.W.left = 15, 1`);
      ok(await waitFor(`!!document.querySelector('.io-pod') && /ДНК/.test(document.querySelector('.kp-gain')?.textContent || '') && !/считаем/.test(document.querySelector('.kp-gain')?.textContent || '')`, 6000), 'конец раунда: пьедестал и ДНК жизни', await ev(`document.querySelector('.kp-gain')?.textContent`));
      ok(await ev(`D37Evo.api.st.rec.lives === ${lives0} + 1`), 'жизнь до конца раунда записана в род');
      await shot('evo-podium-pc.png');
      ok(await waitFor(`document.querySelector('.io-ov').hidden && ${T}.S.W.phase === 0`, 12000), 'новый раунд — карточка ушла сама');
      // телефон: Глубина (род на стадии «Колония»: продвинутый пробный род)
      await phone();
      await go(`${BASE}/#/home`);
      await seedTrial({ stage: 3, dna: 900, earned: 400, play: 1500, col: 3, owned: { flagellum: 1, adhesion: 2, eye: 1, photo: 1, jaw: 1 },
        design: { s: ['jaw', 'eye', 'adhesion', 'flagellum', 'adhesion', 'photo'], f: 'ring', k: { p: 5, a: '#60a5fa', b: '#1e3a8a' } }, biomes: ['pool', 'reef'], finds: ['drop', 'green', 'spike'] });
      await go(`${BASE}/#/games/kletochki/evo`);
      ok(await waitFor(`!!document.querySelector('.kp-hub')`), 'телефон: #/games/kletochki/evo → «Мой род»');
      ok(await ev(`document.querySelectorAll('.kp-bio.off').length === 0`), 'на стадии «Колония» открыты все три биома');
      await shot('evo-hub-phone.png');
      await click('[data-io="evbook"]'); await sleep(300);
      ok(await ev(`document.querySelectorAll('.kp-mc:not(.off)').length === 3`), '«Микромир»: 3 открытых вида из 8');
      await shot('evo-book-phone.png');
      await click('[data-io="evhub"]'); await sleep(200);
      await click('[data-io="evplay"][data-b="deep"][data-m="bots"]');
      ok(await waitFor(`${T}.S?.W?.evo?.b === 'deep'`), 'Глубина: мир пути');
      await sleep(4000);
      const deep = await ev(`(() => { const S = ${T}.S, W = S.W; return { light: W.light, giants: W.owners.filter(q => q && q.giant).length, mins: (() => { let n = 0; for (let p = 0; p < 1600; p++) if (W.pAl[p] && ${T}.isMin(W, p)) n++; return n; })() }; })()`);
      ok(deep.light < .3 && deep.giants === 2 && deep.mins > 20, 'в Глубине темно, 2 гиганта, минералы', deep);
      await shot('evo-deep-phone.png');
      await click('[data-io="menu"]'); await sleep(500);
      ok(errors.length === 0, 'без ошибок в консоли', errors.slice(0, 5));
      report.smoke = { errors: errors.length };
    }

    // ═══ perf: телефон, CPU ×4, полная комната ═══
    if (MODE === 'perf' || MODE === 'all') {
      console.log('— perf (телефон, CPU ×4, «средняя»)');
      await phone();
      const measure = async (base, label, url, setup, biome, big) => {
        await go(`${base}/#/home`); await sleep(300);
        if (setup) await ev(setup);
        await go(url);
        if (biome) { await waitFor(`!!document.querySelector('[data-io="evplay"][data-b="${biome}"]')`, 10000); await click(`[data-io="evplay"][data-b="${biome}"][data-m="bots"]`); }
        if (!(await waitFor(`!!(${T}.S?.W)`, 20000))) { ok(false, label + ': игра не открылась'); return null; }
        await sleep(3000);
        await send('HeapProfiler.enable'); await send('HeapProfiler.collectGarbage');
        const heap0 = await ev('performance.memory ? performance.memory.usedJSHeapSize : 0');
        await send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await ev(`(window.__st = ${T}.stress({ guests: 9 })) ? 1 : 0`);
        if (big) {   // тяжёлый кадр: своя колония из 7 больших клеток (камера дальше — на экране все 16 участников с частями)
          await ev(`(() => { const S = ${T}.S, W = S.W; for (const s of W.cL.subarray(0, W.cN)) if (W.cO[s] === S.me) W.cM[s] = 4000; S.setInput(Float64Array.from([.2, .1, 0, 0, 0, 0]), performance.now()); return 1; })()`);
          for (let k = 1; k <= 7; k++) { await sleep(450); await ev(`${T}.S.setInput(Float64Array.from([.2, .1, ${k}, 0, 0, 0]), performance.now()), 1`); }
        }
        await sleep(2000);
        await ev('window.__st.n = 0, window.__st.bytes = 0, window.__st.snaps = 0, 1');
        await sleep(SECS * 1000);
        const P = await ev(`(() => { const s = window.__st, a = Array.from(s.ms.subarray(0, s.n)).sort((x, y) => x - y), q = k => a[Math.min(a.length - 1, Math.floor(a.length * k))];
          const dur = (s.t[s.n - 1] - s.t[0]) / 1000, V = ${T}.S.W;
          const part = k => { const b = Array.from(s[k].subarray(0, s.n)).sort((x, y) => x - y); return +(b.reduce((x, y) => x + y, 0) / b.length).toFixed(2); };
          return { frames: s.n, fps: +(s.n / dur).toFixed(1), avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p50: +q(.5).toFixed(2), p95: +q(.95).toFixed(2), p99: +q(.99).toFixed(2), max: +a[a.length - 1].toFixed(2),
            draw: part('dr'), enc: part('en'), step: part('st'), snap: Math.round(s.bytes / Math.max(1, s.snaps)), owners: V.owners.filter(Boolean).length, cells: V.cN }; })()`);
        await send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await send('HeapProfiler.collectGarbage');
        const heap1 = await ev('performance.memory ? performance.memory.usedJSHeapSize : 0');
        P.heapMB = +((heap1 - heap0) / 1048576).toFixed(2);
        console.log(`  ${label.padEnd(26)} кадр ср ${P.avg} мс · p50 ${P.p50} · p95 ${P.p95} · p99 ${P.p99} · макс ${P.max} · ${P.fps} к/с · рисунок ${P.draw} · снимки ${P.enc} · шаги ${P.step} · снимок ${P.snap} Б · клеток ${P.cells} · память ${P.heapMB} МБ`);
        await shot(`perf-${label.replace(/\W+/g, '_')}.png`);
        return P;
      };
      report.perf = {};
      if (BASE2) report.perf.before = await measure(BASE2, 'до: обычная арена', `${BASE2}/#/games/kletochki/bots`);
      report.perf.classic = await measure(BASE, 'после: обычная арена', `${BASE}/#/games/kletochki/bots`);
      const rich = `localStorage.setItem('d37_evo_trial', JSON.stringify({ stage: 3, dna: 100, earned: 400, play: 1500, col: 5, owned: { flagellum: 1, adhesion: 3, eye: 1, photo: 1, jaw: 1, spikes: 1 }, design: { s: ['jaw', 'eye', 'adhesion', 'adhesion', 'adhesion', 'photo'], f: 'wedge', k: { p: 5, a: '#60a5fa', b: '#1e3a8a' } } })), 1`;
      for (const b of ['pool', 'reef', 'deep']) {
        report.perf[b] = await measure(BASE, `после: путь ${b}`, `${BASE}/#/games/kletochki/evo`, rich, b);
      }
      if (BASE2) report.perf.beforeBig = await measure(BASE2, 'до: обычная, масса 4000', `${BASE2}/#/games/kletochki/bots`, null, null, true);
      report.perf.classicBig = await measure(BASE, 'после: обычная, масса 4000', `${BASE}/#/games/kletochki/bots`, null, null, true);
      report.perf.deepBig = await measure(BASE, 'путь deep: колония 7 ×4000', `${BASE}/#/games/kletochki/evo`, rich, 'deep', true);
      report.perf.reefBig = await measure(BASE, 'путь reef: колония 7 ×4000', `${BASE}/#/games/kletochki/evo`, rich, 'reef', true);
    }

    // ═══ leak: 20 открытий и закрытий ═══
    if (MODE === 'leak' || MODE === 'all') {
      console.log('— leak (20 раз открыть путь и закрыть)');
      await phone();
      await go(`${BASE}/#/home`); await seedTrial({ stage: 3, dna: 100, earned: 400, play: 1500, col: 3, owned: { adhesion: 1, photo: 1 }, design: { s: ['adhesion', 'photo', '', '', '', ''], f: 'chain', k: { p: 5, a: '#4ade80', b: '#166534' } } });
      const probe = async () => { await send('HeapProfiler.collectGarbage'); await sleep(150); await send('HeapProfiler.collectGarbage'); return ev(`({ heap: performance.memory.usedJSHeapSize, nodes: document.getElementsByTagName('*').length, canv: document.getElementsByTagName('canvas').length, styles: document.querySelectorAll('style#kpCss, style#ioCss').length })`); };
      const marks = [];
      for (let i = 0; i < 20; i++) {
        await go(`${BASE}/#/games/kletochki/evo`);
        await waitFor(`!!document.querySelector('[data-io="evplay"][data-b="deep"]')`, 8000);
        await click(`[data-io="evplay"][data-b="${['pool', 'reef', 'deep'][i % 3]}"][data-m="bots"]`);
        await waitFor(`!!(${T}.S?.W)`, 8000);
        await sleep(1200);
        await go(`${BASE}/#/games`); await sleep(300);
        if (i === 4 || i === 11 || i === 19) marks.push(await probe());   // первые 5 — разогрев сайта (кэши; так же и у обычной арены и в старом коде)
      }
      const [a, m, b] = marks;
      const grow = (b.heap - a.heap) / 1048576;
      console.log(`  после 5-го: ${(a.heap / 1048576).toFixed(1)} МБ, узлов ${a.nodes}, холстов ${a.canv}; после 12-го: ${(m.heap / 1048576).toFixed(1)} МБ; после 20-го: ${(b.heap / 1048576).toFixed(1)} МБ, узлов ${b.nodes}, холстов ${b.canv}`);
      ok(grow < 2, `память за 15 открытий после разогрева не растёт (${grow.toFixed(2)} МБ)`, grow);
      ok(b.nodes - a.nodes < 40 && b.canv <= a.canv + 1 && b.styles <= 2, 'узлы DOM, холсты и стили не копятся', { a, b });
      ok(errors.length === 0, 'без ошибок', errors.slice(0, 5));
      report.leak = { grow: +grow.toFixed(2), a, b };
    }

    // ═══ soak: 10 минут игры ═══
    if (MODE === 'soak') {
      console.log(`— soak (${SOAK_MIN} мин игры в пути)`);
      await phone();
      await go(`${BASE}/#/home`); await seedTrial({ stage: 3, dna: 50, earned: 400, play: 1500, col: 3, owned: { adhesion: 2, photo: 1, eye: 1, jaw: 1, flagellum: 1 }, design: { s: ['jaw', 'eye', 'adhesion', 'flagellum', 'adhesion', 'photo'], f: 'wedge', k: { p: 9, a: '#f472b6', b: '#fde68a' } } });
      const e0 = errors.length, heaps = [];
      const t0 = Date.now();
      let lap = 0;
      while (Date.now() - t0 < SOAK_MIN * 60000) {
        const b = ['pool', 'reef', 'deep'][lap++ % 3];
        // как человек: к списку игр и снова в «Путь клетки» (переход внутри страницы; тот же адрес ещё раз — это перезагрузка, не то)
        await go(`${BASE}/#/games`); await sleep(300);
        await go(`${BASE}/#/games/kletochki/evo`);
        ok(await waitFor(`!!document.querySelector('[data-io="evplay"][data-b="${b}"]')`, 8000), `круг ${lap}: «Мой род» открылся`);
        await click(`[data-io="evplay"][data-b="${b}"][data-m="bots"]`);
        ok(await waitFor(`${T}.S?.W?.evo?.b === '${b}'`, 8000), `круг ${lap}: игра в биоме ${b}`);
        // управление: новое направление раз в 0,7 с, деление и выброс иногда; съели — «Ещё раз»
        await ev(`window.__soak && clearInterval(window.__soak); window.__soak = setInterval(() => { const S = ${T}.S; if (!S) return; const I = window.__I || (window.__I = new Float64Array(6)); const a = Math.random() * 6.283; I[0] = Math.cos(a); I[1] = Math.sin(a); if (Math.random() < .25) I[2]++; if (Math.random() < .15) I[3]++; S.setInput(I, performance.now()); const ag = document.querySelector('[data-io="again"]'); if (ag && Math.random() < .5) ag.click(); }, 700), 1`);
        const until = Math.min(t0 + SOAK_MIN * 60000, Date.now() + 100000);
        while (Date.now() < until) { await sleep(20000); await send('HeapProfiler.collectGarbage'); heaps.push(+(await ev('performance.memory.usedJSHeapSize / 1048576')).toFixed(1)); }
        await ev('clearInterval(window.__soak), 1');
      }
      const lives = await ev('D37Evo.api.st.rec.lives');
      console.log(`  память (МБ, раз в 20 с): ${heaps.join(' ')}; жизней записано: ${lives}`);
      ok(errors.length === e0, `${SOAK_MIN} мин без ошибок`, errors.slice(e0, e0 + 5));
      ok(heaps.length > 4 && heaps[heaps.length - 1] - Math.min(...heaps.slice(1)) < 8, 'память выходит на полку', heaps);
      ok(lives > 3, 'жизни идут в род', lives);
      report.soak = { heaps, lives };
    }
  } catch (e) { fail++; console.log('FAIL исключение', e.stack || e); }
  fs.writeFileSync(path.join(TMP, `evo-e2e-${MODE}.json`), JSON.stringify(report, null, 1));
  console.log(`${pass} ок, ${fail} ошибок`);
  try { ws.close(); } catch (e) {}
  proc.kill();
  own?.close();
  process.exit(fail ? 1 : 0);
})();
