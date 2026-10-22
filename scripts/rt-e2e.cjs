// Свой сервер в настоящем Chrome (T-045): два отдельных headless Chrome (свои профили — два разных человека) на локальном сайте,
// свой сервер (server/rt) отдельным процессом со сторожем НАСТОЯЩЕГО Supabase, настоящий Supabase и WebRTC.
//  1) io-игра «Клеточки» по ссылке: хозяин и гость, комната через свой сервер (D37RT), гость получает снимки;
//  2) стол (table.js, личные сообщения шифром) — тоже через свой сервер;
//  3) /turn: форма ответа, D37RT.ice() и window.D37_TURN;
//  4) сервер убит посреди партии → обе вкладки сами уходят в Supabase, комната собирается там: хозяин — хозяин, гость — гость,
//     «нет связи» нет, снимки идут, места за столом не пропадали, личное сообщение после переезда доходит;
//  5) ?rt=0 — D37RT выключен (только Supabase).
// Запуск: DEPS_DIR=<ws@8.21.3> node scripts/rt-e2e.cjs   (сам поднимает scripts/serve.py и сервер; нужны Chrome, Python, интернет)
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const K = require('./rt-kit.cjs');
const D = K.deps();
if (!D) { console.log('rt-e2e: нет пакета ws (DEPS_DIR) — пропуск'); process.exit(process.env.CI_STRICT ? 1 : 0); }
const TMP = process.env.D37_TMP || 'E:/claude-tmp/t045';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PY = process.env.PYTHON || 'python';
const { sleep } = K;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 900)); } };
const kids = [];
const killAll = () => { for (const p of kids) { try { p.kill(); } catch (e) {} } };
process.on('exit', killAll);

async function browser(tag, initJs){
  const port = await K.freePort();   // свободный порт (у других проверок свои Chrome)
  const profile = path.join(TMP, `chrome-${tag}-` + Date.now().toString(36));
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--mute-audio', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  kids.push(proc);
  let page = null;
  for (let i = 0; i < 120 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && t.url === 'about:blank'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) throw new Error('chrome did not start');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const cb = new Map(), errors = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [okf, bad] = cb.get(d.id); cb.delete(d.id); d.error ? bad(new Error(d.error.message)) : okf(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').slice(0, 200));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('error ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 150));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; cb.set(i, [res, rej]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('d37_age_ask',String(Date.now()+864e6));localStorage.setItem('d37_app',JSON.stringify({x:1,v:1}));localStorage.setItem('d37_games_mute','1')}catch(e){}` + (initJs || '') });
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  return { ws, send, ev, errors, close: async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} } };
}
const waitFor = async (P, expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await P.ev(expr); if (v) return v; } catch (e) {} await sleep(250); } return false; };

(async () => {
  const t0 = Date.now();
  fs.mkdirSync(TMP, { recursive: true });
  // сайт
  const sitePort = await K.freePort();
  const site = spawn(PY, [path.join(K.SITE, 'scripts/serve.py'), String(sitePort)], { cwd: K.SITE, stdio: 'ignore' });
  kids.push(site);
  const BASE = 'http://localhost:' + sitePort;
  await K.until(async () => { const r = await fetch(BASE + '/js/core/rt.js'); await r.text(); return r.ok; }, 10000, 100);
  // свой сервер (сторож — настоящий Supabase сайта)
  const ADMIN = crypto.randomBytes(8).toString('hex'), TS = crypto.randomBytes(8).toString('hex');
  const rtPort = await K.freePort();
  const env = { ADMIN_TOKEN: ADMIN, WATCH: '1', TURN_SECRET: TS, TURN_HOST: '127.0.0.1', ALLOW_NO_ORIGIN: '0', RT_PORT: String(rtPort), GRACE_MS: '5000' };
  let S = await K.startServer(D, env);
  kids.push(S.p);
  ok(!!(await K.until(async () => (await (await fetch(S.url + '/health')).json()).rooms === true, 8000)), 'сервер: сторож подключился к настоящему Supabase (/health rooms: true)');
  const init = `;try{localStorage.setItem('d37_rt_url','${S.url}')}catch(e){};window.__D37RT_T={FAIL_MS:2500,DOWN_MS:4000,SETTLE_MS:4000};`;
  const A = await browser('a', init), B = await browser('b', init);
  const report = {};
  try {
    // 1) «Клеточки» вдвоём
    const g = 'kletochki', code = 'rte' + Math.random().toString(36).slice(2, 7);
    const st = `(() => { const S = GAME_IMPL.${g}?._test?.S; if (!S) return null; return { role: S.role, me: S.me, mode: S.netMode(), humans: S.humans(), ready: !!(S.G && S.G.ready), bin: S.nBinOk, err: S.err || '' }; })()`;
    const rt = `(() => { const s = window.D37RT?.stats(); return s && { st: s.st, chans: s.chans, probeMs: s.probeMs, fallbacks: s.fallbacks, moves: s.moves, badWhy: s.badWhy }; })()`;
    await A.send('Page.navigate', { url: `${BASE}/#/games/${g}/${code}` });
    ok(!!(await waitFor(A, `(${st})?.role === 'host'`, 25000)), 'io: первый — хозяин');
    await B.send('Page.navigate', { url: `${BASE}/#/games/${g}/${code}` });
    if (!(await waitFor(B, `!!window.GAME_IMPL?.${g}`, 8000))) await B.ev(`location.hash = '#/games/${g}/${code}', 1`);
    ok(!!(await waitFor(B, `(${st})?.ready && (${st}).me >= 0`, 30000)), 'io: гость в игре (снимки пришли, своё место)');
    const ra = await A.ev(rt), rb = await B.ev(rt);
    report.rtA = ra; report.rtB = rb;
    const main = 'kletochki-io-' + code;
    ok(ra?.st === 'up' && ra.chans.some(c => c.name === main && c.via === 'rt') && rb.chans.some(c => c.name === main && c.via === 'rt'), 'io: комната — через свой сервер (D37RT, проба прошла)', [ra, rb]);
    report.probeMs = [ra?.probeMs, rb?.probeMs];
    let m = await S.metrics(ADMIN);
    ok(m.counts.members >= 2 && m.counts.watchedRooms >= 1, 'сервер: места в комнате и сторож смотрит её Supabase-канал', m.counts);
    // 2) стол: свои обработчики в странице (настоящие table.js / room.js / rt.js)
    const tcode = 'rtt' + Math.random().toString(36).slice(2, 7);
    const tjoin = who => `(() => { window.__T = { seats: [], priv: [], err: 0 }; window.__tr = TableRoom.join('rtcheck', '${tcode}', { max: 3, onSeats: s => __T.seats.push(s.length), onPrivate: m => __T.priv.push(m), onError: () => __T.err++ }); return 1; })()`;
    await A.ev(`(async () => { if (!window.TableRoom) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/games/table.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); return 1; })()`);
    await B.ev(`(async () => { if (!window.TableRoom) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'js/games/table.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); return 1; })()`);
    await A.ev(tjoin('A'));
    await waitFor(A, `__tr.seats.length === 1`, 10000);
    await B.ev(tjoin('B'));
    ok(!!(await waitFor(A, `__tr.seats.length === 2 && __tr.seats.every(s => s.pk)`, 15000)) && !!(await waitFor(B, `__tr.seats.length === 2`, 5000)), 'стол: двое, ключи шифра в presence');
    await A.ev(`(async () => { const g = __tr.seats.find(s => !s.me); await __tr.sendTo(g.id, { k: 'до' }); return 1; })()`);
    ok(!!(await waitFor(B, `__T.priv.some(p => p.k === 'до')`, 8000)), 'стол: личное сообщение (шифр) через свой сервер дошло');
    ok(!!(await waitFor(A, `D37RT.stats().chans.some(c => c.name === 'rtcheck-table-${tcode}' && c.via === 'rt')`, 3000)), 'стол: через свой сервер');
    // 3) TURN
    await A.ev(`D37RT.prefetchTurn(), 1`);
    const turn = await waitFor(A, `(() => { const l = D37RT.ice(); return l.length === 2 && window.D37_TURN === l ? l : null; })()`, 5000);
    ok(Array.isArray(turn) && turn[0].urls[0] === 'stun:127.0.0.1:3478' && /^turn:127\.0\.0\.1:3478\?transport=udp$/.test(turn[1].urls[0]) && /^\d{10}:/.test(turn[1].username) && turn[1].credential.length > 20, 'TURN: /turn из страницы (CORS), D37RT.ice() и window.D37_TURN', turn);
    // 4) сервер убит посреди партии
    const bin0 = (await B.ev(st)).bin;
    const sample = async () => ({ a: await A.ev(`[${st}, ${rt}, __tr.seats.length, __T.err]`).catch(() => null), b: await B.ev(`[${st}, ${rt}, __tr.seats.length, __T.err]`).catch(() => null) });
    await S.kill();
    const tk = Date.now();
    const hist = [];
    let moved = 0;
    while (Date.now() - tk < 20000) {
      const s = await sample(); hist.push(s);
      const allSb = x => x && x[1] && x[1].chans.length && x[1].chans.every(c => c.via === 'sb');
      if (!moved && allSb(s.a) && allSb(s.b)) moved = Date.now() - tk;
      if (moved && Date.now() - tk > moved + 6000) break;
      await sleep(300);
    }
    report.movedMs = moved;
    ok(moved > 0, 'сервер убит: обе вкладки ушли в Supabase', hist.at(-1));
    const last = hist.at(-1);
    const rolesKept = hist.every(s => s.a?.[0]?.role === 'host' && s.b?.[0]?.role === 'guest');
    ok(rolesKept && !hist.some(s => s.a?.[0]?.err || s.b?.[0]?.err), 'io: всё время — хозяин и гость, без «нет связи»', hist.map(s => [s.a?.[0]?.role, s.b?.[0]?.role, s.a?.[0]?.err, s.b?.[0]?.err]).slice(-6));
    ok(last.b[0].bin > bin0 + 10, 'io: гость получает снимки и после смерти сервера', [bin0, last.b[0].bin, last.b[0].mode]);
    const seatsMin = Math.min(...hist.map(s => Math.min(s.a?.[2] ?? 0, s.b?.[2] ?? 0)));
    ok(seatsMin === 2 && !hist.some(s => s.a?.[3] || s.b?.[3]), 'стол: места не пропадали ни на миг (presence «замер» на время переезда), ошибок нет', hist.map(s => [s.a?.[2], s.b?.[2]]));
    await A.ev(`(async () => { const g = __tr.seats.find(s => !s.me); await __tr.sendTo(g.id, { k: 'после' }); return 1; })()`);
    ok(!!(await waitFor(B, `__T.priv.some(p => p.k === 'после')`, 8000)), 'стол: личное сообщение после переезда (через Supabase) дошло');
    // 5) ?rt=0
    await B.send('Page.navigate', { url: `${BASE}/?rt=0#/home` });
    ok(!!(await waitFor(B, `window.D37RT && D37RT.enabled() === false && D37RT.client() === null`, 15000)), '?rt=0: D37RT выключен');
    report.errorsA = A.errors.slice(0, 8); report.errorsB = B.errors.slice(0, 8);
    ok(!A.errors.some(e => /D37RT|rt\.js/.test(e)) && !B.errors.some(e => /D37RT|rt\.js/.test(e)), 'ошибок rt.js в консоли нет', [A.errors, B.errors]);
  } catch (e) { fail++; console.log('FAIL исключение', e.stack || e); }
  console.log(JSON.stringify(report));
  await A.close(); await B.close();
  try { await S.kill(); } catch (e) {}
  killAll();
  console.log(`rt-e2e: ${pass} ok, ${fail} fail (${Math.round((Date.now() - t0) / 1000)} с)`);
  process.exit(fail ? 1 : 0);
})();
