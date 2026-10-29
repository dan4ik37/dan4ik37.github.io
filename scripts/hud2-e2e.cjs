// HUD 2.0 (T-123, docs/HUD_V2.md §10): интерфейс игр в настоящем Chrome (headless, DevTools Protocol, без npm).
// Для каждой игры (scripts/hud2-cases/<игра>.cjs) и профиля — телефон стоя P 412×915, лёжа L 844×390 (касание, ЦП ×4, графика «mid»)
// и ПК 1280×720 — по сценам: доля окна игры под интерфейсом (COVER: объединение прямоугольников «с краской», сетка 2 px — как
// scripts/touch-hud-e2e.cjs), доля экрана под окном игры, сколько кнопок видно всегда (§2.1, ≤ 5; по обстановке — отдельно),
// что стоит в середине экрана (x 30–70 %, y 22–70 % — §2.3, лицо персонажа), попадание пальцем (середина и ±(44/2 − 2) px — та же
// кнопка), пересчёты стилей и раскладки в покое (за 5 с), ошибки в консоли. Снимок — <D37_TMP или E:\claude-tmp>\t123\after\
// <игра>-<профиль>-<сцена>.jpg. Выход 1 — нарушен предел (§2.2).
// Запуск из корня сайта: node scripts/hud2-e2e.cjs [игры через запятую: world,studio,terra,shell] [профили: P,L,PC]
// Дело игры: module.exports = { url, ready: 'выражение', root, extra?, skip?, caps?: { P, L, PC }, sceneCaps?: { сцена: { P, L, PC } }, prep?: async T => {}, scenes: { имя: async T => {} } }
// T — { ev(expr), send(method, params), sleep(ms), touch(x, y, ms), prof }.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const OUT = path.join(TMP, 't123', 'after'); fs.mkdirSync(OUT, { recursive: true });
const GAMES = (process.argv[2] || 'world,studio,terra,shell').split(',');
const PROFS = (process.argv[3] || 'P,L,PC').split(',');
const PROF = { P: { w: 412, h: 915, dsf: 2, mobile: true, cpu: 4 }, L: { w: 844, h: 390, dsf: 2, mobile: true, cpu: 4 }, PC: { w: 1280, h: 720, dsf: 1, mobile: false, cpu: 1 } };
const CAPS = { P: 15, L: 12, PC: 6 };   // §2.2: предел доли окна игры под интерфейсом (цель — 10 / 8 / —)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/' || p.startsWith('/play/')) p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});

// в странице: окно игры root (+ extra поверх него), skip — окна-панели (не HUD)
const MEAS = `(rootSel, extraSel, skipSel) => {
  const rootEl = document.querySelector(rootSel); if (!rootEl) return { err: 'no root ' + rootSel };
  const VW = innerWidth, VH = innerHeight, B = rootEl.getBoundingClientRect(), W = Math.round(B.width), H = Math.round(B.height), C = 2, gw = Math.ceil(W / C), gh = Math.ceil(H / C), g = new Uint8Array(gw * gh);
  const vis = el => { let op = 1; for (let p = el; p && p !== document.documentElement; p = p.parentElement) { if (p.hidden) return 0; const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden') return 0; op *= +s.opacity; } return op; };
  const mark = q => { const x0 = Math.max(0, Math.floor((q.left - B.left) / C)), x1 = Math.min(gw, Math.ceil((q.right - B.left) / C)), y0 = Math.max(0, Math.floor((q.top - B.top) / C)), y1 = Math.min(gh, Math.ceil((q.bottom - B.top) / C)); for (let y = y0; y < y1; y++) g.fill(1, y * gw + x0, y * gw + Math.max(x0, x1)); };
  const els = [...rootEl.querySelectorAll('*'), ...(extraSel ? document.querySelectorAll(extraSel) : [])];
  const TRANSIENT = '.e-toast,.e2-hint,.e2-radial,.e2-sheet,.mz-banner,.wld-tag,.wb-tag,.mz-tags,.e-prompt,.tr-msg';
  const cx0 = B.left + B.width * .3, cx1 = B.left + B.width * .7, cy0 = B.top + B.height * .22, cy1 = B.top + B.height * .7;
  let center = [];
  for (const el of els) {
    if (el.tagName === 'CANVAS' || (skipSel && el.closest(skipSel))) continue;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1 || r.width * r.height > W * H * .45) continue;
    const cs = getComputedStyle(el);
    const bg = (cs.backgroundColor && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(cs.backgroundColor)) || (cs.backgroundImage && cs.backgroundImage !== 'none');
    const bd = parseFloat(cs.borderTopWidth) > 0 && !/rgba\\(0, 0, 0, 0\\)/.test(cs.borderTopColor) && cs.borderTopStyle !== 'none';
    const txt = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!bg && !bd && !txt && el.tagName !== 'svg') continue;
    if (vis(el) < .05) continue;
    let rects = [];
    if (bg || bd || el.tagName === 'svg') rects = [r];
    else { const rg = document.createRange(); for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { rg.selectNodeContents(n); for (const q of rg.getClientRects()) rects.push(q); } }
    for (const q of rects) mark(q);
    if (!el.closest(TRANSIENT) && r.left < cx1 && r.right > cx0 && r.top < cy1 && r.bottom > cy0 && !el.classList.contains('e-cross') && !el.classList.contains('tr-cross') && !el.classList.contains('mz-cross'))
      center.push((el.className && String(el.className).split(' ')[0]) || el.tagName.toLowerCase());
  }
  let n = 0; for (let i = 0; i < g.length; i++) n += g[i];
  // кнопки, видимые всегда (§2.1): нажимаемое в окне игры, видно (opacity > .3); по обстановке (.e2-ctx) — отдельно
  const TAP = 'button,[role="button"],a[href],input,.e-btn';
  const inWin = q => q.right > B.left && q.left < B.right && q.bottom > B.top && q.top < B.bottom;
  const ctrls = [], ctx = []; const seen = new Set();
  for (const el of els) {
    const t = el.closest(TAP); if (!t || seen.has(t) || (skipSel && t.closest(skipSel)) || t.closest(TRANSIENT)) continue; seen.add(t);
    const q = t.getBoundingClientRect(); if (q.width < 4 || !inWin(q) || vis(t) < .3 || getComputedStyle(t).pointerEvents === 'none') continue;
    (t.classList.contains('e2-ctx') ? ctx : ctrls).push(t);
  }
  // попадание пальцем: середина и ±(44/2 − 2) px — та же кнопка
  const R = 20; let hitOk = 0; const hitBad = [];
  for (const t of [...ctrls, ...ctx]) {
    const q = t.getBoundingClientRect(), x = q.left + q.width / 2, y = q.top + q.height / 2;
    const pts = [[x, y], [x - R, y], [x + R, y], [x, y - R], [x, y + R]].filter(([a, b]) => a >= 0 && b >= 0 && a < VW && b < VH);
    const ok = pts.every(([a, b]) => { const e = document.elementFromPoint(a, b); return e && (e === t || t.contains(e)); });
    if (ok) hitOk++; else hitBad.push((t.getAttribute('aria-label') || t.textContent || t.className).trim().slice(0, 14) + ' ' + Math.round(q.width) + 'x' + Math.round(q.height));
  }
  const visW = Math.max(0, Math.min(B.right, VW) - Math.max(B.left, 0)), visH = Math.max(0, Math.min(B.bottom, VH) - Math.max(B.top, 0));
  const lab = t => (t.getAttribute('aria-label') || t.title || t.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 12);
  return { pct: +(100 * n / g.length).toFixed(1), gameShare: +(100 * visW * visH / (VW * VH)).toFixed(1), controls: ctrls.length, ctx: ctx.length, list: ctrls.map(lab), center: [...new Set(center)].slice(0, 8), hitOk, hitBad };
}`;

async function chrome(P){
  const port = 9400 + Math.floor(Math.random() * 500), profile = fs.mkdtempSync(path.join(OUT, 'chrome-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--ignore-gpu-blocklist', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP: OUT, TEMP: OUT } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('chrome did not start'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), logs = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('error: ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, ms = 60000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Performance.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: P.w, height: P.h, deviceScaleFactor: P.dsf, mobile: P.mobile, ...(P.mobile ? { screenOrientation: P.w > P.h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } } : {}) });
  if (P.mobile) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
  }
  const close = () => { try { ws.close(); } catch (e) {} proc.kill(); setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }, 1500); };
  const touch = async (x, y, ms = 70) => { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4 }] }); await sleep(ms); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(60); };
  return { send, ev, logs, close, touch, sleep };
}
async function thrash(send, ms = 5000){
  const m = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  const a = await m(); await sleep(ms); const b = await m(), s = ms / 1000;
  return { layouts: +((b.LayoutCount - a.LayoutCount) / s).toFixed(1), styles: +((b.RecalcStyleCount - a.RecalcStyleCount) / s).toFixed(1) };
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port;
  const rows = []; let bad = 0;
  for (const gid of GAMES) {
    const file = path.join(__dirname, 'hud2-cases', gid + '.cjs'); if (!fs.existsSync(file)) { console.log('нет дела', file); continue; }
    const G = require(file);
    for (const pk of PROFS) {
      const P = PROF[pk]; if (!P) continue;
      console.log(`\n== ${gid} ${pk} ${P.w}x${P.h}`);
      let B = null;
      try {
        B = await chrome(P);
        const ls = Object.assign({ d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_age: JSON.stringify({ y: 2000, at: Date.now() - 864e6 }), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_gfx: 'mid', d37_s3_learn: 'done', d37_settings: JSON.stringify({ gfxPreset: 'mid', gfx: 'mid', autoLand: true }) }, G.ls || {});
        await B.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
        await B.send('Page.navigate', { url: BASE + G.url });
        let up = false; for (let i = 0; i < 240 && !up; i++) { await sleep(500); up = await B.ev(`!!(${G.ready})`, 3000).catch(() => false); }
        if (!up) throw new Error('game did not open');
        await sleep(2500);
        const T = { ev: B.ev, send: B.send, sleep, touch: B.touch, prof: pk, P };
        await G.prep?.(T);
        if (P.mobile) { await B.touch(Math.round(P.w * .72), Math.round(P.h * .4)); await B.send('Emulation.setCPUThrottlingRate', { rate: P.cpu }); }
        for (const [name, fn] of Object.entries(G.scenes)) {
          await fn(T);
          const m = await B.ev(`(${MEAS})(${JSON.stringify(G.root)}, ${JSON.stringify(G.extra || null)}, ${JSON.stringify(G.skip || null)})`, 30000);
          const shotR = await B.send('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
          fs.writeFileSync(path.join(OUT, `${gid}-${pk}-${name}.jpg`), Buffer.from(shotR.data, 'base64'));
          const th = name.startsWith('idle') || G.thrash?.includes(name) ? await thrash(B.send) : null;
          const cap = G.sceneCaps?.[name]?.[pk] ?? (G.caps && G.caps[pk]) ?? CAPS[pk], over = m.pct > cap;
          if (over) bad++;
          rows.push({ game: gid, prof: pk, scene: name, ...m, thrash: th, cap });
          console.log(`  ${name.padEnd(12)} HUD ${m.pct}% (предел ${cap}${over ? ' ✗' : ''}) · окно ${m.gameShare}% · кнопок ${m.controls}${m.ctx ? ' + ' + m.ctx + ' по обстановке' : ''} [${m.list.join(' ')}] · середина: ${m.center.join(',') || '—'} · палец ${m.hitOk} ок${m.hitBad.length ? ', мимо: ' + m.hitBad.join('; ') : ''}${th ? ` · покой: раскладок ${th.layouts}/с, стилей ${th.styles}/с` : ''}`);
        }
        const errs = B.logs.filter(l => !/favicon|ERR_|net::|Failed to load resource|supabase|websocket|WebSocket|realtime/i.test(l));
        if (errs.length) console.log('  ошибки:', errs.slice(0, 4).join(' | '));
      } catch (e) { console.log('  ✗', e.message); bad++; }
      finally { B?.close(); }
    }
  }
  fs.writeFileSync(path.join(OUT, 'hud2-e2e.json'), JSON.stringify(rows, null, 1));
  console.log(`\nhud2-e2e: ${rows.length} сцен, ${bad ? bad + ' за пределом' : 'все в пределах'}`);
  server.close(); process.exit(bad ? 1 : 0);
})();
