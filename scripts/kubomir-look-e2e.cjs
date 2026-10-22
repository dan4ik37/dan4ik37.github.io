// «Кубомир» в НАСТОЯЩЕМ Chrome (T-096a, владелец 22.10: руки, факел, Esc, тени травы, «залез сквозь блок» и ползком, рельеф блоков):
// снимки «до/после», замеры, утечки. Без npm (DevTools Protocol). Запуск из корня сайта:
//   node scripts/kubomir-look-e2e.cjs [метка] [ultra|high|mid] [d3d11|swiftshader]
//   KB_LOOK=shots (по умолчанию) — сцены: руки от 1-го лица и сзади/спереди (пусто, кирка, меч + щит, кирка + факел слева, лук,
//     замах, лестница, вис), факел на полу и на стене ночью в каменной комнате, трава и цветы при низком солнце (тени), стена
//     с низким потолком (залезть нельзя — сквозь блок), лаз высотой в блок (ползком), рельеф и «живые» текстуры (камень, руды, лава)
//   KB_LOOK=esc — настоящий захват мыши (нажатие по миру через протокол), E — вещи, Esc — закрыть: меню паузы НЕ открылось; лист
//     помощника, сундук, верстак — так же; без окон Esc — меню
//   KB_LOOK=perf — профиль телефона (412 × 915, ЦП ×4, «средняя»): ЦП на кадр и вызовы — от 1-го лица в лесу, в пещере с факелами
//   KB_LOOK=gpu — компьютер (1280 × 720, «высокая»/«ультра»): цена рельефа блоков на видеокарте (таймер запросов) — с ним и без
//   KB_LOOK=leak — 20 раз открыть/закрыть вещи (и сундук, лист помощника), 8 раз закрыть/открыть мир — память JS и узлы не растут
//   SITE_DIR=папка — снимать другую копию сайта («до»). Снимки — <D37_TMP или E:\claude-tmp>\t096a\shots\<метка>-<пресет>-*.jpg
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const [label = 'now', preset0 = '', angle = 'd3d11'] = process.argv.slice(2);
const LOOK = process.env.KB_LOOK || 'shots';
const PHONE = LOOK === 'perf' || !!process.env.KB_PHONE;
const preset = preset0 || (PHONE ? 'mid' : LOOK === 'gpu' ? 'ultra' : 'high');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const SHOTS = path.join(TMP, 't096a', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
let fail = 0; const ok = (c, name, extra) => { if (!c) { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); } else console.log('ok  ', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); };
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 400);
  fs.mkdirSync(path.join(TMP, 't096a', 'tmp'), { recursive: true });
  const profile = fs.mkdtempSync(path.join(TMP, 't096a', 'chrome-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    `--use-angle=${angle}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'],
    { stdio: 'ignore', env: { ...process.env, TMP: path.join(TMP, 't096a', 'tmp'), TEMP: path.join(TMP, 't096a', 'tmp') } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { console.log('Chrome не запустился'); proc.kill(); server.close(); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), subs = new Set(), logs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); } else if (d.method) subs.forEach(f => f(d)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  subs.add(d => {
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
  });
  const ev = async (expr, ms = 60000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: null } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 }); const f = path.join(SHOTS, `${label}-${preset}-${name}.jpg`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('  снимок', f); return f; };
  const progsOk = `R => { const L = R.r.info.programs || []; return { n: L.length, bad: L.filter(p => p.diagnostics && p.diagnostics.runnable === false).map(p => p.name + ': ' + (p.diagnostics.fragmentShader.log || p.diagnostics.vertexShader.log || '').slice(0, 300)) }; }`;
  const heap = async () => ev(`(async () => { for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise(r => setTimeout(r, 300)); } return performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null; })()`, 30000);
  const idle = () => ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(); for (let i = 0; i < 160; i++) { const s = S.ST?.stats; if (S.ready && s && !s.jobs && !s.pend) break; await new Promise(r => setTimeout(r, 500)); } return true; })()`, 120000);
  const res = {};
  // общее: «стройка» — клетки мира рядом (публичное: st.W, st.P, st.rig), снимки без подсказок поверх
  const PRE = `const wait = ms => new Promise(r => setTimeout(r, ms)), T = GAME_IMPL.kubomir._test, S = T.state(), V = D37E.vox, W = S.W, P = S.P, ID = V.ID;
    const set = (x, y, z, n, s) => W.set(x, y, z, n ? V.cell(ID[n], s || 0) : 0, { urgent: 1 });
    const fill = (x0, y0, z0, x1, y1, z1, n) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) set(x, y, z, n); };`;
  // вид: yaw, наклон, камера (0 — от 1-го лица, 1 — сзади, 2 — спереди); hud — интерфейс (руки от 1-го лица видны только с ним)
  const view = (yaw, fp, cam = 0, ms = 1500) => ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(); S.rig.yaw = ${yaw}; S.rig.fp = ${fp}; GAME_IMPL.kubomir._test.cam(${cam}); await new Promise(r => setTimeout(r, ${ms})); return true; })()`, 20000);
  // руки: что в правой и левой (вещь или null), заморозка фаз (взмах, лук) — перед каждой отрисовкой (window.__pre)
  const hands = (main, off, o = {}) => ev(`(async () => { ${PRE}
    window.__pre = null; P.inv[P.sel] = ${main ? `{ id: '${main}', n: ${/torch|planks|stone/.test(main) ? 16 : 1} }` : 'null'}; P.off = ${off ? `{ id: '${off}', n: 1 }` : 'null'};
    await wait(500);
    const o = ${JSON.stringify(o)}, H = S.hand, CB = D37E.combat, F = S.F;
    window.__pre = () => {
      if (o.sw != null && H) { H.sw = o.sw; H.mining = false; }
      if (F && CB) { if (o.draw) { F.drawOn = true; F.draw = 1.2; } if (o.guard) F.guard = 1; }
      if (o.eat != null) S.eat = { t: .6, need: 1.6, hand: o.eatOff ? 'off' : 'main' };
    };
    await wait(${o.ms || 900});
    return true; })()`, 30000);
  async function openWorld(mode){
    await send('Page.enable'); await send('Runtime.enable');
    if (PHONE) {
      await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    const base = preset === 'ultra' ? 'high' : preset;
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_gfx: base, d37_settings: JSON.stringify({ gfxPreset: preset, gfx: base, shaders: 'auto' }), d37_s3_learn: '1', d37_fsr: 'native',
      d37_kb_opt: JSON.stringify({ rd: PHONE ? 6 : 8, tips: false }) };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_gfx_guard');}catch(e){}` });
    // KB_LOOK=esc: Esc при захвате мыши забирает браузер (страница нажатия не видит) — слушатель раньше всех игровых
    if (LOOK === 'esc') await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const I = () => window.GAME_IMPL?.kubomir?._test?.state?.()?.I;
      window.addEventListener('keydown', e => { const i = I(); if (e.key === 'Escape' && i && i.locked) { e.stopImmediatePropagation(); e.preventDefault(); i.locked = false; } }, true);
      window.addEventListener('keyup', e => { const i = I(); if (e.key === 'Escape' && i && i.locked) i.locked = false; }, true); })();` });
    await send('Page.navigate', { url: BASE + '/#/games/kubomir' });
    for (let i = 0; i < 120; i++) { await sleep(500); const okm = await ev(`!!document.querySelector('.kb-menu')`, 3000).catch(() => false); if (okm) break; }
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Новый мир/.test(x.textContent)); b && b.click(); return !!b; })()`);
    await sleep(500);
    await ev(`(() => { const s = document.querySelector('[data-f="seed"]'); if (s) s.value = 'озеро37'; const c = document.querySelector('[data-f="mode"] [data-v="${mode}"]'); c && c.click(); document.querySelector('[data-f="diff"] [data-v="peaceful"]')?.click(); const g = document.querySelector('[data-n="go"]'); g && g.click(); return !!g; })()`);
    let kb = false;
    for (let i = 0; i < 240 && !kb; i++) { await sleep(500); kb = await ev(`!!(GAME_IMPL.kubomir?._test?.state()?.ready && GAME_IMPL.kubomir._test.state().WX)`, 3000).catch(() => false); }
    ok(kb, '«Кубомир»: мир открылся');
    if (!kb) throw new Error('мир не открылся');
    await idle();
    // снимки: во всё окно, без подсказок поверх и без панели (руки от 1-го лица видны только с интерфейсом — прячем его стилем)
    await ev(`(async () => { const st = document.createElement('style'); st.id = 'look-css'; st.textContent = '.kb-lockhint,.e-toast,.kb-tip,.kb-hud,.kb-tbar,.e-hud{visibility:hidden!important}'; document.head.appendChild(st);
      if (!${PHONE}) window.D37Full?.toggle(document.querySelector('#gamesStage'), { esc: false });
      const S = GAME_IMPL.kubomir._test.state(), R = S.R;
      if (!R.__lookP) { R.__lookP = true; const r0 = R.render.bind(R); R.render = (...a) => { try { window.__pre?.(); } catch (e) {} return r0(...a); }; }
      await new Promise(r => setTimeout(r, 1500)); return true; })()`, 20000);
    // ровная площадка 40 × 40 (трава), игрок посередине, ходит (не летит)
    res.base = await ev(`(async () => { ${PRE}
      try { S.WX.clim.setWorld({ seed: 'kb', mode: 'fixed', season: 'summer', weather: 'clear', lapse: 0, seaY: 52 }); } catch (e) {}
      const cx = Math.floor(P.x), cz = Math.floor(P.z), gy = Math.max(Math.floor(P.y), 64);
      for (let x = cx - 20; x <= cx + 20; x++) for (let z = cz - 20; z <= cz + 20; z++) { for (let y = gy; y <= gy + 18; y++) if (W.raw(x, y, z) > 0) set(x, y, z, null); set(x, gy - 1, z, 'grass'); for (let y = gy - 4; y < gy - 1; y++) set(x, y, z, 'dirt'); }
      Object.assign(P, { x: cx + .5, y: gy, z: cz + .5, vx: 0, vy: 0, vz: 0, fly: false });
      S.R.lighting.time = 12; S.paused = true; S.rig.yaw = 0; S.rig.fp = .1;
      window.__b = { cx, cz, gy };
      await wait(5000);
      return window.__b; })()`, 120000);
  }

  const ONLY = (process.env.KB_ONLY || '').split(',').filter(Boolean), only = k => !ONLY.length || ONLY.includes(k);   // KB_ONLY=hands,torch,shadow,climb,pom
  async function shots(){
    if (only('hands')) {
    // ── 1. руки ──
    await ev(`(async () => { ${PRE} const { cx, cz, gy } = window.__b;
      fill(cx - 6, gy, cz - 7, cx + 6, gy + 4, cz - 7, 'stone_bricks'); for (let x = cx - 6; x <= cx + 6; x += 3) set(x, gy + 1, cz - 6, 'ore_gold');
      Object.assign(P, { x: cx + .5, y: gy, z: cz + .5, vx: 0, vy: 0, vz: 0 }); await wait(3000); return 1; })()`, 60000);
    const HS = [['empty', null, null], ['pick', 'pick_iron', null], ['sword-shield', 'sword_iron', 'shield'], ['pick-torchL', 'pick_iron', 'torch'], ['torch', 'torch', null],
      ['block', 'planks_oak', null], ['bow-draw', 'bow', null, { draw: 1 }], ['dig-mid', 'pick_iron', null, { sw: .3 }], ['guard', 'sword_iron', 'shield', { guard: 1 }], ['eat', 'apple', 'torch', { eat: 1 }]];
    for (const [n, m, o, x] of HS) { await hands(m, o, x || {}); await view(0, .08, 0); await shot('hands-fp-' + n); }
    for (const [n, m, o, x] of HS.filter(h => ['pick', 'sword-shield', 'pick-torchL', 'bow-draw'].includes(h[0]))) { await hands(m, o, x || {}); await view(Math.PI, .25, 2); await shot('hands-front-' + n); await view(.6, .3, 1); await shot('hands-back-' + n); }
    await ev(`(() => { window.__pre = null; return 1; })()`);
    // ходьба (покачивание обеих рук): держит «вперёд», снимок на ходу
    await hands('pick_iron', 'torch'); await view(0, .08, 0, 300);
    await ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(); S.C.press('forward', true); await new Promise(r => setTimeout(r, 700)); return 1; })()`);
    await shot('hands-fp-walk');
    await ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(); S.C.press('forward', false); await new Promise(r => setTimeout(r, 300)); return 1; })()`);
    // лестница (лезет — руки на перекладинах)
    await ev(`(async () => { ${PRE} const { cx, cz, gy } = window.__b; window.__pre = null;
      P.inv[P.sel] = null; P.off = null;
      for (let y = gy; y < gy + 4; y++) set(cx + 3, y, cz - 6, 'ladder', 3);
      Object.assign(P, { x: cx + 3.5, y: gy + 1.2, z: cz - 5.2, vx: 0, vy: 0, vz: 0 }); S.rig.yaw = 0; S.rig.fp = -.2;
      S.C.press('forward', true); await wait(500); S.C.press('forward', false); return { climb: S.P.climb }; })()`, 20000).then(r => { res.ladder = r; });
    await shot('hands-fp-ladder');
    }
    if (only('torch')) {
    // ── 2. факел: каменная комната ночью — на полу и на стене ──
    await ev(`(async () => { ${PRE} const { cx, cz, gy } = window.__b; window.__pre = null;
      const x0 = cx - 5, x1 = cx + 5, z0 = cz - 12, z1 = cz - 2;
      fill(x0, gy, z0, x1, gy + 4, z1, 'stone'); fill(x0 + 1, gy, z0 + 1, x1 - 1, gy + 3, z1 - 1, null);
      set(cx, gy, z0 + 3, 'torch');                 // на полу
      set(cx + 2, gy + 1, z0 + 1, 'torch', 3);      // на северной стене (прижат к −z)
      set(cx - 3, gy + 1, z0 + 1, 'torch', 3);
      Object.assign(P, { x: cx + .5, y: gy, z: z1 - 1.5, vx: 0, vy: 0, vz: 0 }); P.inv[P.sel] = null; P.off = null;
      S.R.lighting.time = 23; await wait(6000); window.__room = { x0, z0, x1, z1 }; return 1; })()`, 60000);
    await view(0, .15, 0, 1200); await shot('torch-room-fp');
    await ev(`(async () => { ${PRE} const r = window.__room, { cx, gy } = window.__b; Object.assign(P, { x: cx + 2.5, y: gy, z: r.z0 + 3.8 }); await wait(1200); return 1; })()`);
    await view(0, .05, 0, 1200); await shot('torch-wall-close');
    await ev(`(async () => { ${PRE} const r = window.__room, { cx, gy } = window.__b; Object.assign(P, { x: cx + .5, y: gy, z: r.z0 + 5.5 }); await wait(1200); return 1; })()`);
    await view(0, .45, 0, 1200); await shot('torch-floor');
    await hands('torch', null); await view(.4, .1, 0, 1200); await shot('torch-hand');
    await ev(`(() => { window.__pre = null; GAME_IMPL.kubomir._test.state().R.lighting.time = 12; return 1; })()`);
    }
    if (only('shadow')) {
    // ── 3. тени травы и цветов: низкое солнце ──
    await ev(`(async () => { ${PRE} const { cx, cz, gy } = window.__b; window.__pre = null;
      fill(cx - 12, gy, cz + 3, cx + 12, gy + 4, cz + 16, null);
      const F = ['tall_grass', 'tall_grass', 'flower_red', 'tall_grass', 'flower_yellow', 'tall_grass', 'sapling_oak', 'dead_bush'];
      let k = 0; for (let x = cx - 8; x <= cx + 8; x++) for (let z = cz + 4; z <= cz + 14; z++) if ((x * 7 + z * 13) % 3 !== 0) set(x, gy, z, F[(k++) % F.length]);
      fill(cx + 9, gy, cz + 9, cx + 9, gy + 2, cz + 9, 'log_oak');
      Object.assign(P, { x: cx + .5, y: gy, z: cz + 1.5, vx: 0, vy: 0, vz: 0 }); P.inv[P.sel] = null; P.off = null;
      S.R.lighting.time = 8.2; await wait(6000); return 1; })()`, 60000);
    await view(Math.PI, .55, 0, 1500); await shot('shadow-plants');
    await view(Math.PI - .7, .3, 0, 1500); await shot('shadow-plants-low');
    await ev(`(() => { GAME_IMPL.kubomir._test.state().R.lighting.time = 12; return 1; })()`);
    }
    if (only('climb')) {
    // ── 4. низкий потолок над головой у стены: залезть нельзя (не сквозь блок); лаз высотой в блок — ползком ──
    res.climb = await ev(`(async () => { ${PRE} const { cx, cz, gy } = window.__b; window.__pre = null;
      const x0 = cx + 12; fill(x0 - 4, gy, cz - 3, x0 + 6, gy + 5, cz + 3, null);
      fill(x0 + 2, gy, cz - 3, x0 + 5, gy + 1, cz + 3, 'stone');          // стена в 2 блока
      fill(x0 - 4, gy + 3, cz - 3, x0 + 1, gy + 3, cz + 3, 'planks_oak');  // потолок над игроком (3 блока)
      Object.assign(P, { x: x0 + .5, y: gy, z: cz + .5, vx: 0, vy: 0, vz: 0 }); S.rig.yaw = -Math.PI / 2; S.rig.fp = 0; await wait(1500);
      let eyeIn = 0, pk = 0;
      S.C.press('forward', true); S.C.press('jump', true);
      for (let i = 0; i < 90; i++) { await wait(16); const v = W.raw(P.x, P.y + (P.sneak ? 1.27 : P.crawl ? .42 : 1.62), P.z); if (v > 0 && V.T.opaque[v & 0xfff]) eyeIn++; if (P.pk) pk++; }
      S.C.press('forward', false); S.C.press('jump', false); await wait(500);
      return { eyeIn, pk, y: +P.y.toFixed(2), x: +P.x.toFixed(2) }; })()`, 30000);
    console.log('ЗАЛЕЗТЬ под низким потолком', JSON.stringify(res.climb));
    await view(-Math.PI / 2, 0, 0, 800); await shot('climb-lowceil');
    // лаз: туннель высотой 1 блок, длиной 6
    res.crawl = await ev(`(async () => { ${PRE} const { cx, cz, gy } = window.__b;
      const x0 = cx - 14; fill(x0 - 4, gy, cz - 3, x0 + 8, gy + 4, cz + 3, null);
      fill(x0, gy, cz - 2, x0 + 6, gy + 2, cz + 2, 'stone'); fill(x0, gy, cz, x0 + 6, gy, cz, null);   // лаз высотой в блок по z = cz
      Object.assign(P, { x: x0 - 1.5, y: gy, z: cz + .5, vx: 0, vy: 0, vz: 0 }); S.rig.yaw = -Math.PI / 2; S.rig.fp = .05; await wait(1200);
      const T2 = GAME_IMPL.kubomir._test, K = S.K;
      const x1 = P.x; K?.press?.('crawl', true); S.C.press('forward', true); await wait(2600); S.C.press('forward', false);
      const inside = { x: +P.x.toFixed(2), crawl: !!P.crawl, h: P.h };
      K?.press?.('crawl', false); await wait(400);
      return { moved: +(P.x - x1).toFixed(2), inside, stillCrawl: !!P.crawl, hasCrawl: !!(K && 'crawl' in (P || {})) }; })()`, 30000);
    console.log('ЛАЗ высотой в блок', JSON.stringify(res.crawl));
    await view(-Math.PI / 2, .05, 0, 800); await shot('crawl-fp');
    // ползком на открытом месте — вид сзади и спереди (поза человечка)
    await ev(`(async () => { ${PRE} const { cx, cz, gy } = window.__b; Object.assign(P, { x: cx + 4.5, y: gy, z: cz + .5, vx: 0, vy: 0, vz: 0 }); S.rig.yaw = -Math.PI / 2; S.K?.press?.('crawl', true); await wait(400); S.C.press('forward', true); await wait(1200); return { crawl: !!P.crawl, h: P.h }; })()`).then(r => { res.crawlOpen = r; });
    await view(-Math.PI / 2 + .6, .3, 1, 900); await shot('crawl-tp');
    await view(-Math.PI / 2, .3, 2, 900); await shot('crawl-front');
    await ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(); S.C.press('forward', false); await new Promise(r => setTimeout(r, 300)); await new Promise(r => setTimeout(r, 300)); return 1; })()`);
    await view(-Math.PI / 2 + 1.2, .2, 1, 900); await shot('crawl-tp-idle');
    await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(); GAME_IMPL.kubomir._test.cam(0); S.K?.press?.('crawl', false); return 1; })()`);
    }
    if (only('pom')) {
    // ── 5. рельеф и «живые» текстуры: стена из разных блоков вскользь, лава ──
    await ev(`(async () => { ${PRE} const { cx, cz, gy } = window.__b; window.__pre = null;
      const z0 = cz + 18; fill(cx - 8, gy, z0, cx + 8, gy + 4, z0 + 6, null);
      const L = ['stone', 'cobble', 'ore_diamond', 'ore_gold', 'bricks', 'planks_oak', 'stone_bricks', 'mossy_cobble', 'sandstone', 'ore_iron', 'gravel', 'dirt'];
      for (let x = cx - 8; x <= cx + 8; x++) for (let y = gy; y <= gy + 3; y++) set(x, y, z0 + 4, L[((x - cx + 8) + y * 5) % L.length]);
      for (let x = cx - 3; x <= cx + 3; x++) for (let z = z0 + 1; z <= z0 + 2; z++) set(x, gy - 1, z, 'lava');
      Object.assign(P, { x: cx - 6.5, y: gy, z: z0 + 2.2, vx: 0, vy: 0, vz: 0 }); P.inv[P.sel] = null; P.off = null;
      S.R.lighting.time = 15.5; await wait(5000); return 1; })()`, 60000);
    await view(-Math.PI / 2 + .35, .1, 0, 1500); await shot('pom-wall-grazing');
    await view(Math.PI - .2, .05, 0, 1500); await shot('pom-wall-front');
    await view(-Math.PI / 2 + .1, .75, 0, 1500); await shot('pom-lava');
    }
  }

  async function escTest(){
    // Захват мыши в безголовом Chrome не работает — ведём себя, как Chrome с захватом (так у владельца): I.lock / I.unlock — флаг
    // захвата и событие; Esc при захвате браузер забирает себе (страница не видит нажатия) и отпускает мышь, в том числе на
    // ОТПУСКАНИИ Esc (захват, сделанный, пока Esc ещё нажат, — тоже отпускается). Клавиши — настоящие (протокол), окна — настоящие
    await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(), I = S.I;
      const set = v => { I.locked = v; if (v) I.lockFail = false; };
      I.lock = () => { if (!I.locked) set(true); }; I.unlock = () => { if (I.locked) set(false); };
      return 1; })()`);
    const key = async (code, k, vk, hold = 90) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key: k, windowsVirtualKeyCode: vk }); await sleep(hold); await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, windowsVirtualKeyCode: vk }); };
    const state = () => ev(`(() => { const S = GAME_IMPL.kubomir._test.state(); return { locked: !!S.I.locked, inv: !!S.ui?.isOpen(), menu: !!S.menu, x: !!S.X?.isOpen?.(), set: !!window.D37Settings?.isOpen?.() }; })()`);
    const reset = () => ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(); if (window.D37Settings?.isOpen?.()) window.D37Settings.close(); if (S.menu) S.menu.close?.(); if (S.ui?.isOpen()) S.ui.close(); S.X?.closeSheet?.(); await new Promise(r => setTimeout(r, 300)); S.I.lock(); await new Promise(r => setTimeout(r, 300)); return 1; })()`);
    const runs = [];
    for (const win of ['inv', 'chest', 'craft', 'sheet', 'sheet-focus']) {
      await reset();
      const s0 = await state();
      if (win === 'inv') await key('KeyE', 'e', 69);
      else if (win.startsWith('sheet')) { await key('KeyJ', 'j', 74); }
      else await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(); S.ui.open('${win === 'chest' ? 'chest' : 'craft'}', { x: 0, y: 0, z: 0 }); return 1; })()`);
      await sleep(600);
      if (win === 'sheet') await ev(`(() => { document.activeElement?.blur?.(); return 1; })()`);   // фокус не в листе — Esc ловит игра
      const s1 = await state();
      await key('Escape', 'Escape', 27, 120); await sleep(900);
      const s2 = await state();
      runs.push({ win, s0, s1, s2 });
      console.log('ESC', win, JSON.stringify({ s0, s1, s2 }));
      ok((s1.inv || s1.x) && !s2.inv && !s2.x && !s2.menu, `Esc закрыл окно «${win}» — и меню паузы НЕ открылось`, { s1, s2 });
      ok(s2.locked, `после Esc («${win}») мышь снова захвачена (когда Esc отпустили)`, s2);
    }
    // ⚙️ поверх меню паузы: Esc закрывает только ⚙️
    await reset(); await key('Escape', 'Escape', 27); await sleep(500);
    const m1 = await state();
    await ev(`(() => { window.D37Settings?.open?.({ ctx: 'engine', tab: 'kubomir' }); return 1; })()`); await sleep(700);
    const m2 = await state(); await key('Escape', 'Escape', 27); await sleep(800); const m3 = await state();
    ok(m1.menu && m2.set && !m3.set && m3.menu, 'Esc в ⚙️ поверх меню — закрыл только ⚙️ (меню паузы осталось)', { m1, m2, m3 });
    res.esc = runs;
    // E закрывает вещи той же клавишей и лист помощника тоже
    await reset(); await key('KeyE', 'e', 69); await sleep(400); const e1 = await state(); await key('KeyE', 'e', 69); await sleep(700); const e2 = await state();
    ok(e1.inv && !e2.inv && !e2.menu && e2.locked, 'E открыл и закрыл вещи (меню паузы не открылось, мышь снова захвачена)', { e1, e2 });
    await reset(); await key('KeyJ', 'j', 74); await sleep(600); const j1 = await state(); await ev(`(() => { document.activeElement?.blur?.(); return 1; })()`); await key('KeyE', 'e', 69); await sleep(700); const j2 = await state();
    ok(j1.x && !j2.x && !j2.inv && !j2.menu, 'E закрыл лист помощника (вещи не открылись)', { j1, j2 });
    // без окон: Esc — меню паузы (мышь отпущена)
    await reset(); const l0 = await state(); await key('Escape', 'Escape', 27); await sleep(900); const l1 = await state();
    ok(l0.locked && l1.menu, 'без окон Esc — меню паузы', { l0, l1 });
  }

  async function perf(){
    // лес (деревья вокруг, руки с киркой и факелом слева) и пещера с факелами — от 1-го лица; ЦП ×4
    await ev(`(async () => { ${PRE} const { cx, cz, gy } = window.__b;
      const tree = (x, z, h) => { for (let y = gy; y < gy + h; y++) set(x, y, z, 'log_oak'); const t = gy + h - 1; for (let y = t - 2; y <= t + 1; y++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { if (y > t - 1 && (Math.abs(dx) > 1 || Math.abs(dz) > 1)) continue; if ((dx || dz || y > t) && W.raw(x + dx, y, z + dz) === 0) set(x + dx, y, z + dz, 'leaves_oak'); } };
      for (let i = 0; i < 28; i++) { const a = i * 2.4, r = 5 + (i % 7) * 2.2; tree(Math.round(cx + Math.cos(a) * r), Math.round(cz + Math.sin(a) * r), 5 + (i % 3)); }
      for (let x = cx - 14; x <= cx + 14; x++) for (let z = cz - 14; z <= cz + 14; z++) if ((x * 31 + z * 17) % 4 === 0 && W.raw(x, gy, z) === 0) set(x, gy, z, (x + z) % 5 ? 'tall_grass' : 'flower_red');
      P.inv[P.sel] = { id: 'pick_iron', n: 1 }; P.off = { id: 'torch', n: 16 };
      await wait(6000); return 1; })()`, 90000);
    await send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const measure = (name, yaw, fp) => ev(`(async () => {
      const S = GAME_IMPL.kubomir._test.state(), wait = ms => new Promise(r => setTimeout(r, ms));
      S.rig.yaw = ${yaw}; S.rig.fp = ${fp}; GAME_IMPL.kubomir._test.cam(0);
      await wait(5000);
      const cpu = [], dts = []; let run = true;
      const tick = () => { if (!run) return; const st = S.R.stats; cpu.push(st.cpuFrame); dts.push(st.dt); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      await wait(12000); run = false;
      cpu.sort((a, b) => a - b);
      const avg = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
      return { name: ${JSON.stringify(name)}, frames: cpu.length, cpu: +avg(cpu).toFixed(2), med: +cpu[cpu.length >> 1].toFixed(2), p95: +cpu[Math.floor(cpu.length * .95)].toFixed(2), fps: +(1000 / avg(dts)).toFixed(1), calls: S.R.stats.calls, q: S.R.q };
    })()`, 90000);
    res.perf = [];
    for (const [n, yaw, fp] of [['warmup', 0, .1], ['forest-fp', 0, .1], ['forest-fp2', 1.9, .05]]) { const r = await measure(n, yaw, fp); if (n !== 'warmup') res.perf.push(r); console.log('ЗАМЕР', JSON.stringify(r)); }
    await send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await ev(`(async () => { ${PRE} const { cx, cz, gy } = window.__b;
      const x0 = cx + 22, z0 = cz - 8; fill(x0, gy - 1, z0, x0 + 14, gy + 5, z0 + 16, 'stone'); fill(x0 + 1, gy, z0 + 1, x0 + 13, gy + 3, z0 + 15, null);
      for (let x = x0 + 2; x <= x0 + 12; x += 3) for (let z = z0 + 2; z <= z0 + 14; z += 4) set(x, gy, z, 'torch');
      for (let z = z0 + 3; z <= z0 + 13; z += 4) set(x0 + 1, gy + 1, z, 'torch', 4);
      Object.assign(P, { x: x0 + 7.5, y: gy, z: z0 + 14.5, vx: 0, vy: 0, vz: 0 }); S.R.lighting.time = 23;
      await wait(6000); return 1; })()`, 90000);
    await send('Emulation.setCPUThrottlingRate', { rate: 4 });
    for (const [n, yaw, fp] of [['cave-torches', 0, .1], ['cave-torches2', .8, .2]]) { const r = await measure(n, yaw, fp); res.perf.push(r); console.log('ЗАМЕР', JSON.stringify(r)); }
    await send('Emulation.setCPUThrottlingRate', { rate: 1 });
    res.heapMB = await heap(); console.log('память JS, МБ', res.heapMB);
  }

  async function gpu(){
    // стена из разных блоков вскользь и пол — с рельефом блоков (если есть) и без: видеокарта (таймер запросов) и ЦП
    await ev(`(async () => { ${PRE} const { cx, cz, gy } = window.__b;
      const L = ['stone', 'cobble', 'ore_diamond', 'bricks', 'planks_oak', 'stone_bricks', 'mossy_cobble', 'gravel'];
      for (let x = cx - 16; x <= cx + 16; x++) for (let z = cz - 16; z <= cz + 16; z++) set(x, gy - 1, z, L[Math.abs(x * 3 + z * 7) % L.length]);
      fill(cx - 16, gy, cz - 9, cx + 16, gy + 5, cz - 9, 'cobble');
      await wait(6000); return 1; })()`, 90000);
    const run = (name, pom) => ev(`(async () => {
      const S = GAME_IMPL.kubomir._test.state(), R = S.R, VR = S.VR, gl = R.r.getContext(), ext = R.r.capabilities.isWebGL2 && gl.getExtension('EXT_disjoint_timer_query_webgl2'), wait = ms => new Promise(r => setTimeout(r, ms));
      const has = !!(VR.setPom); if (has) VR.setPom(${pom ? 'true' : 'false'});
      S.rig.yaw = 0; S.rig.fp = .35; await wait(3000);
      const r0 = R.render, qs = [], gpu = [], cpu = []; let on = true;
      R.render = function (...a) { let q = null; if (ext && on) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); } const o = r0.apply(this, a); if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); } cpu.push(R.stats.cpuFrame); return o; };
      await wait(8000); on = false; R.render = r0;
      for (let k = 0; k < 120 && qs.length; k++) { while (qs.length && gl.getQueryParameter(qs[0], gl.QUERY_RESULT_AVAILABLE)) { const q = qs.shift(); if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); } if (qs.length) await wait(16); }
      const avg = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length); gpu.sort((a, b) => a - b); cpu.sort((a, b) => a - b);
      return { name: ${JSON.stringify(name)}, has, frames: cpu.length, cpu: +avg(cpu).toFixed(2), gpu: gpu.length ? +avg(gpu).toFixed(3) : null, gpuMed: gpu.length ? +gpu[gpu.length >> 1].toFixed(3) : null, calls: R.stats.calls, q: R.q };
    })()`, 90000);
    res.gpu = [];
    for (let i = 0; i < 3; i++) for (const [n, p] of [['pom-on', 1], ['pom-off', 0]]) { const r = await run(n, p); res.gpu.push(r); console.log('ЗАМЕР', JSON.stringify(r)); }
  }

  async function leak(){
    const nodes = () => ev(`(async () => { for (let i = 0; i < 2; i++) { window.gc?.(); await new Promise(r => setTimeout(r, 200)); } return { nodes: document.getElementsByTagName('*').length, heap: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null }; })()`);
    const cycle = n => ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(), wait = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < ${n}; i++) { const k = ['inv', 'chest', 'craft', 'furnace'][i % 4]; S.ui.open(k, { x: 0, y: 0, z: 0 }); await wait(120); S.ui.close(); await wait(80);
        if (S.X?.open) { try { S.X.open('quests'); await wait(120); S.X.escape?.(); S.X.closeSheet?.(); } catch (e) {} await wait(60); } }
      return 1; })()`, 120000);
    await cycle(4); const a = await nodes(); await cycle(20); const b = await nodes(); await cycle(20); const c = await nodes();
    res.windows = { a, b, c }; console.log('ОКНА 20×', JSON.stringify(res.windows));
    ok(c.nodes <= a.nodes + 5 && c.heap - b.heap < 3, '20 раз открыть/закрыть окна — узлы и память не растут', res.windows);
    const hs = [];
    for (let i = 0; i < (+process.env.KB_N || 8); i++) {
      await idle(); await sleep(1500); hs.push(await heap());
      await ev(`(async () => { await GAME_IMPL.kubomir._test.stop(); GAME_IMPL.kubomir._test.menu(); return true; })()`, 60000);
      for (let k = 0; k < 60; k++) { await sleep(500); if (await ev(`!!document.querySelector('.kb-world [data-w="play"]')`, 3000).catch(() => false)) break; }
      await ev(`(() => { const b = document.querySelector('.kb-world [data-w="play"]'); b && b.click(); return !!b; })()`);
      let up = false; for (let k = 0; k < 240 && !up; k++) { await sleep(500); up = await ev(`!!(GAME_IMPL.kubomir?._test?.state()?.ready)`, 3000).catch(() => false); }
      if (!up) { ok(false, 'мир снова открылся (' + (i + 1) + ')'); break; }
    }
    await idle(); await sleep(1500); hs.push(await heap());
    res.reopen = hs; console.log('ЗАМЕР reopen, память JS (МБ):', hs.join(' → '));
    ok(hs.length >= 8 && hs[hs.length - 1] - hs[1] < 25, 'закрыть/открыть мир ' + (hs.length - 1) + ' раз — память не растёт', hs);
  }

  try {
    await openWorld(LOOK === 'esc' || LOOK === 'leak' ? 'survival' : 'creative');
    if (LOOK === 'shots') await shots();
    else if (LOOK === 'esc') await escTest();
    else if (LOOK === 'perf') await perf();
    else if (LOOK === 'gpu') await gpu();
    else if (LOOK === 'leak') await leak();
    const pr = await ev(`(${progsOk})(GAME_IMPL.kubomir._test.state().R)`);
    const guard = await ev(`D37E.gfxGuardInfo ? D37E.gfxGuardInfo().off : []`);
    ok(!pr.bad.length, 'все программы шейдеров собрались', pr.bad);
    ok(!guard || !guard.length, 'страж графики ничего не выключил', guard);
    const bad = logs.filter(l => /WebGLProgram|Shader Error|exception|TypeError|ReferenceError/i.test(l) && !/X3595/.test(l));
    ok(!bad.length, 'в консоли — без ошибок шейдеров и исключений', bad.slice(0, 6));
  } catch (e) {
    fail++; console.log('ОШИБКА', e.message);
    for (const l of logs.slice(-8)) console.log('  консоль:', l.slice(0, 240));
  } finally {
    console.log('ЗАМЕР', JSON.stringify(res, null, 1).slice(0, 4000));
    try { ws.close(); } catch (e) {} proc.kill(); server.close(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('снимки:', SHOTS);
  console.log(fail ? `kubomir-look-e2e: ${fail} ошибок` : 'kubomir-look-e2e: всё в порядке');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
