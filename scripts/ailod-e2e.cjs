// AI LOD in the REAL Chrome (T-127, AI_LOD.md §11 "Benchmarks" / "Site E2E"): headless, DevTools Protocol, no npm. Phone profile by
// default — 412 × 915, DPR 2, touch, mobile UA, CPU ×RATE (4), quality «mid». Scenes:
//   mir    — «Мир Денчика»: capital square, then the Big City with traffic and residents (frame CPU from render.js, NPC step ms, npc count)
//   horde  — «Орда» late wave: hero cannot die, enemies held at the cap (frame CPU = main-thread task time per frame, enemy count)
//   studio — «Студия 3D» «Выживание» template: waves pushed until the alive cap (frame CPU, NPC step ms, zombies alive)
// Run from the site root: node scripts/ailod-e2e.cjs [mir,horde,studio] [phone|pc]   (RATE=4, CHROME, D37_TMP; D37_OVERRIDE=<folder>
// — files from there instead of the site: the "before" column; OUT=<file.json>)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const [SCENES = 'mir,horde,studio', PROF = 'phone'] = process.argv.slice(2);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const phone = PROF === 'phone', RATE = +(process.env.RATE || (phone ? 4 : 1)), Q = phone ? 'mid' : 'high';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  let f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  if (process.env.D37_OVERRIDE) { const o = path.join(process.env.D37_OVERRIDE, p); if (fs.existsSync(o)) f = o; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
server.keepAliveTimeout = 1000;
// in the page before the site's scripts: frame counter, long frames, NPC step timer (wrapped when a game creates D37E.npcs)
const INSTR = `(() => { if (window.__ai) return; const T = window.__ai = { fr: 0, long: 0, last: 0, npcMs: 0, npcN: 0, npcMax: 0 };
  const tick = t => { if (T.last && t - T.last > 50) T.long++; T.last = t; T.fr++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  T.reset = () => { T.fr = 0; T.long = 0; T.npcMs = 0; T.npcN = 0; T.npcMax = 0; };
  T.wrap = N => { if (!N || N.__aiw) return N; N.__aiw = 1; const s = N.step; N.step = (dt, pl) => { const a = performance.now(); s(dt, pl); const d = performance.now() - a; T.npcMs += d; T.npcN++; if (d > T.npcMax) T.npcMax = d; }; return N; };
  let hooked = false; const hook = () => { const E = window.D37E; if (!E || !E.npcs || hooked) return; hooked = true; const f = E.npcs; E.npcs = function(R, ph){ return T.wrap(f(R, ph)); }; Object.assign(E.npcs, f); };
  const iv = setInterval(() => { hook(); if (hooked) clearInterval(iv); }, 20);
})();`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(TMP, 'd37-ailod-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { console.log('Chrome did not start'); proc.kill(); server.close(); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push('exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('error: ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, ms = 120000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const metric = async () => { const { metrics } = await send('Performance.getMetrics'); const g = k => metrics.find(m => m.name === k)?.value || 0; return { task: g('TaskDuration'), script: g('ScriptDuration'), layout: g('LayoutDuration') + g('RecalcStyleDuration') }; };
  const rows = [];
  // measure a window: main-thread task ms per frame (CDP), render.js CPU per frame when the game has R.stats, NPC step ms per step
  const windowOf = async (name, ms, statsExpr, extraExpr) => {
    await ev(`(() => { __ai.reset(); const R = ${statsExpr || 'null'}; const ST = R?.stats; if (ST) { ST.frames = ST.sumDt = ST.maxDt = ST.sumCpu = ST.maxCpu = ST.sumR = 0; } return 1; })()`);
    const m0 = await metric(); await sleep(ms); const m1 = await metric();
    const s = await ev(`(() => { const R = ${statsExpr || 'null'}, ST = R?.stats, n = Math.max(1, ST?.frames || 0), T = __ai;
      return { frames: T.fr, long: T.long, cpu: ST ? +(ST.sumCpu / n).toFixed(2) : null, cpuMax: ST ? +ST.maxCpu.toFixed(1) : null, calls: ST?.calls ?? null,
        npcMs: T.npcN ? +(T.npcMs / T.npcN).toFixed(3) : null, npcMax: +T.npcMax.toFixed(2), heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, ...(${extraExpr || '{}'}) }; })()`);
    s.fps = +(s.frames / (ms / 1000)).toFixed(1);
    s.taskMsFrame = +((m1.task - m0.task) * 1000 / Math.max(1, s.frames)).toFixed(2);
    s.scriptMsFrame = +((m1.script - m0.script) * 1000 / Math.max(1, s.frames)).toFixed(2);
    s.name = name; rows.push(s); console.log(name.padEnd(28), JSON.stringify(s));
    return s;
  };
  try {
    await send('Page.enable'); await send('Runtime.enable'); await send('Performance.enable');
    await send('Emulation.setDeviceMetricsOverride', phone ? { width: 412, height: 915, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    if (phone) {
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_age: JSON.stringify({ y: 2000, at: Date.now() - 864e6 }), d37_app: JSON.stringify({ x: 1, v: 1 }),
      d37_settings: JSON.stringify({ gfxPreset: Q, gfx: Q }), d37_gfx: Q, d37_s3_learn: 'done' };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_mir_pos');localStorage.removeItem('d37_gfx_guard');}catch(e){}` + INSTR });
    const go = async (hash, ready, sec = 120) => {
      await send('Page.navigate', { url: BASE + '/' + hash });
      let up = false; for (let i = 0; i < sec * 2 && !up; i++) { await sleep(500); try { up = await ev(`!!(${ready})`, 5000); } catch (e) {} }
      if (!up) throw new Error('did not open: ' + hash);
      await send('Emulation.setCPUThrottlingRate', { rate: RATE });
    };
    const list = SCENES.split(',');
    if (list.includes('mir')) {
      await go('#/games/world', 'window.GAME_IMPL?.world?._test?.state()?.zones?.wmv');
      await ev(`(() => { const A = window.D37Age; if (A) { A.known = () => true; A.canOpen = () => true; A.allows = () => true; A.group = () => 'adult'; }
        const S = GAME_IMPL.world._test.state(); S.fixedTime = 13; __ai.wrap(S.NPC); return 1; })()`);
      const SR = `GAME_IMPL.world._test.state().R`, X = `{ npc: GAME_IMPL.world._test.state().NPC?.list?.size ?? null, imp: GAME_IMPL.world._test.state().NPC?.A?.impCount?.() ?? null }`;
      await ev(`(async () => { GAME_IMPL.world._test.state().zones.padGo('hub'); await new Promise(r => setTimeout(r, 6000)); return 1; })()`, 60000);
      await windowOf('mir: capital square', 6000, SR, X);
      await ev(`(async () => { GAME_IMPL.world._test.state().zones.padGo('metro'); await new Promise(r => setTimeout(r, 12000)); return 1; })()`, 90000);
      await windowOf('mir: Big City', 8000, SR, X);
      await send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
    if (list.includes('horde')) {
      await go('#/games/horde', `window.GAME_IMPL?.horde?._test && document.querySelector('[data-act=play]')`);
      const started = await ev(`(async () => { for (let i = 0; i < 40 && !GAME_IMPL.horde._test.live(); i++) { document.querySelector('[data-act=play]')?.click(); await new Promise(r => setTimeout(r, 500)); } return !!GAME_IMPL.horde._test.live(); })()`, 60000);
      if (!started) throw new Error('horde run did not start');
      const cap = await ev(`(() => { const T = GAME_IMPL.horde._test, G = T.live(); const p = G.players[0]; p.maxHp = p.hp = 1e9; G.t = 560; G.evI = T.EVENTS.length;
        window.__hfill = () => { const G = T.live(); if (!G) return 0; const p = G.players[0]; p.hp = 1e9; const types = ['rex', 'ogre', 'wolf', 'eye', 'pumpkin', 'alien'];
          let k = 0; while (G.en.length < G.maxEnemies && k++ < 400) { const a = (G.eid * 2.39996) % 6.2832, d = 150 + (G.eid * 37) % 400; T.spawnEnemy(G, types[G.eid % types.length], p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, null, true); }
          return G.en.length; };
        window.__hiv = setInterval(window.__hfill, 250); return G.maxEnemies; })()`);
      console.log('horde cap', cap);
      await sleep(8000);
      await windowOf('horde: late wave at cap', 8000, null, `{ enemies: GAME_IMPL.horde._test.live()?.en.length, cap: GAME_IMPL.horde._test.live()?.maxEnemies }`);
      await ev(`(() => { const G = GAME_IMPL.horde._test.live(); G.maxEnemies = 260; return 1; })()`);
      await sleep(5000);
      await windowOf('horde: forced 260', 8000, null, `{ enemies: GAME_IMPL.horde._test.live()?.en.length }`);
      await ev(`clearInterval(window.__hiv)`);
      await send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
    if (list.includes('studio')) {
      await go('#/games/studio3d', 'window.GAME_IMPL?.studio3d?._test?.state()?.R && window.D37E?.studioTemplates?.["m-survival"]');
      await ev(`(async () => { const T = GAME_IMPL.studio3d._test, ED = T.state(); T.template(ED.SC, ED.TR, 'm-survival');
        ED.SC.settings.game = Object.assign({}, ED.SC.settings.game, { mode: 'survival', waves: 20, zombies: 20, grow: 10, lives: 0, zdmg: 5, count: 0, min: 1 });
        await new Promise(r => setTimeout(r, 1500)); __ai.wrap(ED.NPC); document.querySelector('.s3-play')?.click(); await new Promise(r => setTimeout(r, 4000)); return !!ED.playing; })()`, 60000);
      const SR = `GAME_IMPL.studio3d._test.state().R`;
      const X = `{ zombies: [...GAME_IMPL.studio3d._test.state().NPC.list.values()].filter(e => e.P).length, imp: GAME_IMPL.studio3d._test.state().NPC?.A?.impCount?.() ?? null }`;
      // clear a wave (remove the zombies) — the next one comes after 6 s: 20, 30, 40, 50, 60, 70 …
      const nextWave = `(async () => { const ED = GAME_IMPL.studio3d._test.state(); for (const o of ED.SC.all().slice()) if (o.cls === 'NPC' && o.name === 'Зомби') ED.SC.remove(o); await new Promise(r => setTimeout(r, 9000)); return 1; })()`;
      await sleep(3000);
      await windowOf('studio: wave 1', 6000, SR, X);
      await ev(nextWave, 60000);
      await windowOf('studio: wave 2', 6000, SR, X);
      for (let w = 3; w <= 6; w++) await ev(nextWave, 60000);
      await sleep(6000);
      await windowOf('studio: wave 6 (cap)', 8000, SR, X);
      await send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
  } catch (e) {
    console.log('ERROR', e.message);
  } finally {
    for (const l of errs.slice(-8)) console.log('  console:', l.slice(0, 240));
    try { ws.close(); } catch (e) {} proc.kill(); server.close(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ prof: PROF, rate: RATE, rows, errs }, null, 1));
  process.exit(rows.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
