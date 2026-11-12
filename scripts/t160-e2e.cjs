// T-160 📎 передача файлов: проверка в настоящем Chrome (headless, без npm, загрузки запрещены), два браузера = два устройства.
// Без входа и без записи в базу: только broadcast роя (Supabase Realtime) и TURN владельца (/turn на RT_URL).
// Режимы (по умолчанию — все по очереди):
//   probe   — какие ICE-кандидаты получает браузер (host / srflx / relay) от STUN и TURN владельца; TURN жив или нет
//   direct  — файл MB МБ напрямую (оба «показывать адрес»)
//   relay   — файл MB МБ только через TURN (оба «🕶 скрыть адрес» → iceTransportPolicy relay)
//   offline — получатель просит файл, отправителя нет в сети → строка «ждём», отправитель появился → файл пришёл сам
//   turndown— у получателя «скрыть адрес», а TURN недоступен → за ≤ 40 с понятная причина, без бесконечного «соединяемся…»
//   limits  — размер выше лимита: обычному — отказ с понятным текстом; владельцу (cfg от сервера: owner) — можно
// Запуск: node M:/d37/d37-core/scripts/heavy-lock.mjs run --session site/t160 --job t160-e2e --min 10 -- node scripts/t160-e2e.cjs [mode] (MB=5)
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/t160' : os.tmpdir());
const MODES = (process.argv[2] || 'probe,click,direct,relay,offline,turndown,limits').split(',');
const MB = +(process.env.MB || 5);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r1 = v => Math.round(v * 10) / 10;
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); if (!c) fails++; };
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
  const port = 9600 + Math.floor(Math.random() * 600), profile = fs.mkdtempSync(path.join(TMP, 'chr-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  const L = { d37_perf: 'low', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_ds_tip: '1' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(150); } return false; };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, close, errs };
}
const READY = `typeof sbClient !== 'undefined' && !!sbClient && !!window.D37Route && document.readyState === 'complete'`;
const PREP = hide => `(async () => { const s = JSON.parse(localStorage.getItem('d37_phone') || '{}'); s.hide = ${JSON.stringify(hide)}; localStorage.setItem('d37_phone', JSON.stringify(s)); if (window.D37Phone) D37Phone.set.hide = ${JSON.stringify(hide)}; await D37Phone.need('mv'); await D37Phone.need('calls'); return !!window.D37Files && !!window.D37Calls; })()`;
// источник: случайный ZIP MB МБ в хранилище устройства (как после «📎»), раздаётся сразу или позже (seedNow)
const MAKE = (mb, seedNow) => `(async () => {
  const n = Math.round(${mb} * 1048576), u = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(u.subarray(i, Math.min(n, i + 65536)));
  u.set([0x50, 0x4B, 3, 4], 0);
  const b = new Blob([u], { type: 'application/zip' }), h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer())), x => x.toString(16).padStart(2, '0')).join('');
  await D37Files._store.store({ chash: h, name: 'test.zip', mime: 'application/zip', size: n, pinned: true, sent: true, got: 0, used: Date.now(), at: Date.now() }, b);
  if (${!!seedNow}) await D37Files._test.seed(h);
  return { v: 1, enc: 'none', kid: '', name: 'test.zip', size: n, mime: 'application/zip', chash: h, phash: h };
})()`;
const FETCH = (att, ms) => `(async () => { const t0 = performance.now(); try { const b = await Promise.race([D37Files.fetch(${JSON.stringify(att)}), new Promise((_, j) => setTimeout(() => j(new Error('timeout ${ms / 1000} s')), ${ms}))]);
  return { ok: b.size === ${att.size}, ms: performance.now() - t0, via: D37Files._test.last?.via || '' }; } catch (er) { return { ok: false, ms: performance.now() - t0, err: String(er.message || er), code: er.code || '', st: D37Files.state(${JSON.stringify(att.chash)}) }; } })()`;

(async () => {
  const site = await startSite();
  const open = async hide => { const C = await chrome(); await C.send('Page.navigate', { url: site.base + '/' }); if (!await C.until(READY, 60000)) throw new Error('сайт не загрузился'); await sleep(2500); if (!await C.ev(PREP(hide))) throw new Error('files.js / calls.js не загрузились'); if (process.env.RELAY_KBS) await C.ev(`D37Files._test.setCfg({ relay_kbs: ${+process.env.RELAY_KBS} })`); return C; };
  const out = {};
  try {
    for (const MODE of MODES) {
      console.log(`— ${MODE}`);
      if (MODE === 'probe') {
        const C = await open('off');
        const r = await C.ev(`(async () => {
          const res = {};
          let turn = null; try { turn = await (await fetch(RT_URL + '/turn', { cache: 'no-store' })).json(); } catch (e) { res.turnErr = String(e.message || e); }
          const stun = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
          const run = async (servers, policy) => { const pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: policy }); pc.createDataChannel('x'); const c = []; const t0 = performance.now(); let tRelay = 0;
            pc.onicecandidate = e => { if (e.candidate && e.candidate.candidate) { const t = (/ typ (\\w+)/.exec(e.candidate.candidate) || [])[1]; c.push(t); if (t === 'relay' && !tRelay) tRelay = performance.now() - t0; } };
            await pc.setLocalDescription(await pc.createOffer());
            await new Promise(res => { pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') res(); }; setTimeout(res, 12000); });
            pc.close(); const n = k => c.filter(x => x === k).length; return { host: n('host'), srflx: n('srflx'), relay: n('relay'), relayMs: Math.round(tRelay), ms: Math.round(performance.now() - t0) }; };
          res.stun = await run(stun, 'all');
          if (turn?.iceServers) { res.turnAll = await run(turn.iceServers, 'all'); res.turnRelay = await run(turn.iceServers, 'relay'); res.turnUrls = turn.iceServers.flatMap(s => [].concat(s.urls)).join(' '); }
          return res; })()`);
        console.log(JSON.stringify(r));
        out.probe = r;
        ok(r.stun.srflx > 0, 'STUN (Google/Cloudflare) отвечает: есть srflx', r.stun);
        ok(!r.turnErr && r.turnRelay && r.turnRelay.relay > 0, 'TURN владельца выдаёт relay-кандидат', r.turnRelay || r.turnErr);
        await C.close();
      } else if (MODE === 'direct' || MODE === 'relay') {
        const hide = MODE === 'relay' ? 'on' : 'off';
        const S = await open(hide), R = await open(hide);
        const att = await S.ev(MAKE(MB, true));
        await sleep(1500);
        const r = await R.ev(FETCH(att, 300000));
        const mbps = r.ok ? r1(att.size / 1048576 / (r.ms / 1000)) : 0;
        console.log(JSON.stringify({ MODE, MB, r }));
        out[MODE + MB] = { s: r1(r.ms / 1000), mbps, via: r.via };
        ok(r.ok, `${MODE}: ${MB} МБ за ${r1(r.ms / 1000)} с (${mbps} МБ/с)${r.via ? ', путь ' + r.via : ''}`, r.err ? { err: r.err, st: r.st } : undefined);
        if (MODE === 'relay') ok(!r.ok || /relay/.test(r.via), 'relay: путь действительно через посредник', r.via);
        const sst = await S.ev(`JSON.stringify(D37Files.sendState(${JSON.stringify(att.chash)}))`);
        ok(/got|done/.test(sst || ''), 'у отправителя видно «доставлено»', sst);
        ok(!S.errs.length && !R.errs.length, 'исключений нет', [...S.errs, ...R.errs].slice(0, 3));
        await S.close(); await R.close();
      } else if (MODE === 'click') {
        // карточка в ленте: нажать «⬇ Получить» → файл пришёл → «✅ на устройстве» и есть «Сохранить» (до T-160 кнопки не работали)
        const S = await open('off'), R = await open('off');
        const att = await S.ev(MAKE(1, true));
        await R.ev(`(() => { const list = document.createElement('div'); list.id = 'tl'; document.body.appendChild(list); const m = { id: 7, att: ${JSON.stringify(att)} };
          list.innerHTML = D37Files.cardHtml(m.att, m, 'cm'); window.__unw = D37Files.watch(list, () => m); return 1; })()`);
        await sleep(800);
        await R.ev(`document.querySelector('#tl [data-f="get"]').click(), 1`);
        const done = await R.until(`/на устройстве/.test(document.querySelector('#tl .mvf-st')?.textContent || '')`, 60000);
        ok(done, 'кнопка «⬇ Получить» работает: файл пришёл', await R.ev(`document.querySelector('#tl .mvf-st')?.textContent`));
        ok(await R.ev(`!!document.querySelector('#tl [data-f="open"]')`), 'есть кнопка «Сохранить / Открыть»');
        await R.ev('window.__unw && window.__unw(), 1');
        await S.close(); await R.close();
      } else if (MODE === 'offline') {
        const S = await open('off'), R = await open('off');
        const att = await S.ev(MAKE(1, false));
        await R.ev(`window.__p = D37Files.fetch(${JSON.stringify(att)}).then(b => b.size, e => 'ERR ' + e.message); 0`);
        await sleep(26000);
        const st = await R.ev(`JSON.stringify(D37Files.state(${JSON.stringify(att.chash)}))`), txt = await R.ev(`D37Files.noteText(D37Files.state(${JSON.stringify(att.chash)}))`);
        ok(/nosrc/.test(st || ''), 'получатель: отправителя нет в сети → состояние «ждём» (не тишина)', st);
        ok(/нет на сайте|не в сети/.test(txt || ''), 'текст понятный', txt);
        await S.ev(`D37Files._test.seed(${JSON.stringify(att.chash)})`);
        const got = await R.until(`window.__p && (async () => (await window.__p) === ${att.size})()`, 60000);
        ok(got, 'отправитель появился → файл пришёл сам', await R.ev('window.__p'));
        await S.close(); await R.close();
      } else if (MODE === 'turndown') {
        const S = await open('on'), R = await open('on');
        const att = await S.ev(MAKE(1, true));
        await R.ev(`window.D37_TURN = [{ urls: ['turn:127.0.0.1:9?transport=udp'], username: 'x', credential: 'y' }]; 0`);
        const r = await R.ev(FETCH(att, 60000));
        const txt = r.code;
        console.log(JSON.stringify({ r, txt }));
        ok(!r.ok && r.ms < 45000 && /relaydown|noroute/.test(r.code), `TURN недоступен → отказ с причиной за ${r1(r.ms / 1000)} с`, r.err);
        ok(/посредник/.test(r.err || ''), 'причина простыми словами', r.err);
        await S.close(); await R.close();
      } else if (MODE === 'limits') {
        const C = await open('off');
        const r = await C.ev(`(async () => {
          const mk = mb => { const u = new Uint8Array(Math.round(mb * 1048576)); u.set([0x50, 0x4B, 3, 4], 0); return new File([u], 'big.zip', { type: 'application/zip' }); };
          const out = {};
          D37Files._test.setCfg({ owner: false, file_mb: 10 });
          try { await D37Files.prepare(mk(11)); out.user = 'accepted'; } catch (e) { out.user = e.message; }
          D37Files._test.setCfg({ owner: true, file_mb: 100, max_mb: 100 });
          try { const a = await D37Files.prepare(mk(11)); out.owner = a.size; } catch (e) { out.owner = e.message; }
          try { await D37Files.prepare(new File([new Uint8Array([77, 90, 0, 0])], 'x.exe')); out.exe = 'accepted'; } catch (e) { out.exe = e.message; }
          return out; })()`);
        console.log(JSON.stringify(r));
        ok(/больше 10 МБ/.test(r.user), 'обычному: 11 МБ — отказ с понятным текстом', r.user);
        ok(r.owner === Math.round(11 * 1048576), 'владельцу: 11 МБ — можно', r.owner);
        ok(/тип/.test(r.exe), 'exe — нельзя никому (типы остаются безопасными)', r.exe);
        await C.close();
      }
    }
  } catch (e) { console.error(e); fails++; }
  finally { site.stop(); }
  console.log(JSON.stringify(out));
  console.log(fails ? `t160-e2e: ${fails} FAIL` : 't160-e2e: OK');
  process.exit(fails ? 1 : 0);
})();
