// Онлайн «Клеточек» и «Червячков» по-настоящему: два отдельных headless Chrome (свои профили — как два разных человека) на
// локальном сайте, настоящий Supabase Realtime (присутствие и знакомство) и WebRTC между ними. Проверяет: хозяин и гость, связь
// напрямую, гость получает снимки и своё место, управление гостя двигает его у хозяина, хозяин ушёл — гость становится хозяином.
// Сообщений Supabase — несколько десятков на игру.
// Запуск: python scripts/serve.py 5571, потом node scripts/iogames-online-e2e.cjs http://localhost:5571 [kletochki|chervyachki]
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const BASE = (process.argv[2] || 'http://localhost:5571').replace(/\/+$/, '');
const GAMES = process.argv[3] ? [process.argv[3]] : ['kletochki', 'chervyachki'];
const TMP = 'E:/claude-tmp/iogames', OUT = path.join(TMP, 'shots');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function browser(tag){
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = path.join(TMP, `chrome-${tag}-` + Date.now().toString(36));
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--mute-audio', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const cb = new Map(), errors = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [ok, bad] = cb.get(d.id); cb.delete(d.id); d.error ? bad(new Error(d.error.message)) : ok(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').slice(0, 200));
    else if (d.method === 'Page.frameNavigated' && !d.params.frame.parentId) errors.push('NAV ' + d.params.frame.url);
    else if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) errors.push(d.params.type + ' ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 150));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; cb.set(i, [res, rej]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('d37_age_ask',String(Date.now()+864e6));localStorage.setItem('d37_app',JSON.stringify({x:1,v:1}));localStorage.setItem('d37_games_mute','1')}catch(e){}` });
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  return { ws, send, ev, errors, close: async () => { try { ws.close(); } catch (e) {} proc.kill(); await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} } };
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const A = await browser('a'), B = await browser('b');
  const report = {};
  const waitFor = async (P, expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await P.ev(expr); if (v) return v; } catch (e) {} await sleep(250); } return false; };
  try {
    for (const g of GAMES) {
      const code = 'e2e' + Math.random().toString(36).slice(2, 7);
      const R = report[g] = { code };
      const st = `(() => { const S = GAME_IMPL.${g}?._test?.S; if (!S) return null; return { role: S.role, me: S.me, mode: S.netMode(), humans: S.humans(), ready: !!(S.G && S.G.ready), owners: S.W ? S.W.owners.filter(o => o && !o.bot).length : null, bin: S.nBin, binOk: S.nBinOk, sent: S.nSent, rtt: Math.round(S.rtt), err: S.binErr }; })()`;
      await A.send('Page.navigate', { url: `${BASE}/#/games/${g}/${code}` });
      R.hostRole = !!(await waitFor(A, `(${st})?.role === 'host'`));
      await B.send('Page.navigate', { url: `${BASE}/#/games/${g}/${code}` });
      // первый заход нового профиля иногда остаётся на главной — тогда ещё раз переход по адресу
      if (!(await waitFor(B, `!!window.GAME_IMPL?.${g}`, 8000))) { R.renav = true; await B.ev(`location.hash = '#/games/${g}/${code}', 1`); }
      R.guestReady = !!(await waitFor(B, `(${st})?.ready && (${st}).me >= 0`, 25000));
      if (!R.guestReady) {
        R.bDebug = await B.ev(`({ hash: location.hash, ready: document.readyState, impl: Object.keys(window.GAME_IMPL || {}), box: (document.getElementById('gamesStageBox')?.innerText || '').slice(0, 200), sb: typeof sbClient,
          res: performance.getEntriesByType('resource').length, slow: performance.getEntriesByType('resource').filter(e => e.duration > 3000).map(e => e.name.slice(-40) + ' ' + Math.round(e.duration)).slice(0, 8),
          pending: [...document.scripts].filter(s => s.src && !performance.getEntriesByName(s.src).length).map(s => s.src.slice(-40)).slice(0, 8) })`).catch(e => String(e));
        const s0 = await B.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, `${g}-online-guest-fail.png`), Buffer.from(s0.data, 'base64'));
      }
      R.p2p = !!(await waitFor(B, `(${st})?.mode === 'p2p'`, 15000));
      await sleep(3000);
      R.host = await A.ev(st); R.guest = await B.ev(st);
      R.hostSees2 = R.host?.owners === 2;
      const meB = R.guest?.me;
      const pos = g === 'kletochki' ? `(o => o && o.alive ? Math.round(o.cx) : null)(GAME_IMPL.${g}._test.S.W.owners[${meB}])` : `(o => o && o.alive ? Math.round(o.x) : null)(GAME_IMPL.${g}._test.S.W.owners[${meB}])`;
      const x0 = await A.ev(pos).catch(() => null);
      await B.ev(`GAME_IMPL.${g}._test.S.setInput(Float64Array.from(${g === 'kletochki' ? '[1, 0, 0, 0, 0, 0]' : '[0, 0, 0, 0]'}), performance.now()), 1`);
      await sleep(2500);
      const x1 = await A.ev(pos).catch(() => null);
      R.guestMoves = x0 != null && x1 != null && x1 > x0 + 50;
      R.moved = [x0, x1];
      const shot = await B.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, `${g}-online-guest.png`), Buffer.from(shot.data, 'base64'));
      // хозяин ушёл → гость стал хозяином со своим размером
      const before = g === 'kletochki' ? `(o => o ? Math.round(o.mass) : null)(GAME_IMPL.${g}._test.S.W.owners[${meB}])` : `(o => o ? Math.round(o.L) : null)(GAME_IMPL.${g}._test.S.W.owners[${meB}])`;
      R.sizeBefore = await A.ev(before).catch(() => null);
      await A.send('Page.navigate', { url: `${BASE}/#/home` });
      R.migrated = !!(await waitFor(B, `(${st})?.role === 'host'`, 20000));
      await sleep(1000);
      R.after = await B.ev(st);
      R.sizeAfter = await B.ev(g === 'kletochki' ? `(o => o ? Math.round(o.mass) : null)(GAME_IMPL.${g}._test.S.W.owners[GAME_IMPL.${g}._test.S.me])` : `(o => o ? Math.round(o.L) : null)(GAME_IMPL.${g}._test.S.W.owners[GAME_IMPL.${g}._test.S.me])`).catch(() => null);
      await B.send('Page.navigate', { url: `${BASE}/#/home` });
      await sleep(1500);
    }
  } catch (e) { report.error = String(e.stack || e); }
  report.errorsA = A.errors; report.errorsB = B.errors;
  console.log(JSON.stringify(report, null, 1));
  await A.close(); await B.close();
})();
