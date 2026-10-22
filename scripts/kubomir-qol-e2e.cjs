// «Кубомир» удобнее (T-049) в НАСТОЯЩЕМ Chrome (headless, DevTools, без npm): помощники-аксессуары, подсказки на экране, книга
// рецептов, лежанка, вёдра, атлас (мини-карта), свиток, задания — снимки, замеры на профиле телефона (ЦП ×4), открыть/закрыть
// 20 раз (узлы и слушатели не растут), 10 минут игры (ошибок нет, память на полке).
// Запуск из корня сайта: node scripts/kubomir-qol-e2e.cjs [shots|perf|leak|soak|all]   (по умолчанию — shots)
//   SITE_DIR=папка — другая копия сайта («до»: выгрузка прошлого коммита); QOL_MIN — минут игры в soak (10)
//   Снимки — <D37_TMP или E:\claude-tmp>\kbqol\shots\<метка>-*.jpg (QOL_TAG — метка, по умолчанию now)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const MODE = process.argv[2] || 'shots', TAG = process.env.QOL_TAG || 'now';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const SHOTS = path.join(TMP, 'kbqol', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
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
  const profile = fs.mkdtempSync(path.join(TMP, 'kbqol', 'chrome-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP: path.join(TMP, 'kbqol'), TEMP: path.join(TMP, 'kbqol') } });
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
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 }); const f = path.join(SHOTS, `${TAG}-${name}.jpg`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('  снимок', f); return f; };
  const heap = async () => ev(`(async () => { for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise(r => setTimeout(r, 300)); } return performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null; })()`, 30000);
  const counts = async () => { const d = await send('Memory.getDOMCounters').catch(() => null); return d ? { nodes: d.nodes, listeners: d.jsEventListeners } : null; };
  const screen = async (w, h, mobile) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: mobile ? 5 : 1 });
    await ev(`(() => { window.dispatchEvent(new Event('resize')); return 1; })()`); await sleep(900);
  };
  const T = 'GAME_IMPL.kubomir._test';
  async function openWorld(mode, mobile){
    if (mobile) {
      await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 675, deviceScaleFactor: 1, mobile: false });
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_gfx: 'mid', d37_settings: JSON.stringify({ gfxPreset: 'mid', gfx: 'mid', shaders: 'auto' }), d37_fsr: 'native', d37_kb_opt: JSON.stringify({ rd: mobile ? 6 : 8, tips: false }) };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_gfx_guard');}catch(e){}` });
    await send('Page.navigate', { url: BASE + '/#/games/kubomir' });
    for (let i = 0; i < 120; i++) { await sleep(500); const okm = await ev(`!!document.querySelector('.kb-menu')`, 3000).catch(() => false); if (okm) break; }
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Новый мир/.test(x.textContent)); b && b.click(); return !!b; })()`);
    await sleep(600);
    await ev(`(() => { const s = document.querySelector('[data-f="seed"]'); if (s) s.value = 'помощники37'; const c = document.querySelector('[data-f="mode"] [data-v="${mode}"]'); c && c.click(); const g = document.querySelector('[data-n="go"]'); g && g.click(); return !!g; })()`);
    let kb = false;
    for (let i = 0; i < 240 && !kb; i++) { await sleep(500); kb = await ev(`!!(${T}?.state()?.ready && ${T}.state().X)`, 3000).catch(() => false); }
    ok(kb, '«Кубомир»: мир открылся, помощники подключены (' + mode + (mobile ? ', телефон' : '') + ')');
    if (!kb) throw new Error('мир не открылся');
    await ev(`(async () => { const st = document.createElement('style'); st.textContent = '.kb-lockhint{display:none!important}'; document.head.appendChild(st); window.D37Full?.toggle(document.querySelector('#gamesStage'), { esc: false }); await new Promise(r => setTimeout(r, 1200)); return 1; })()`, 20000);
    await ev(`(async () => { const S = ${T}.state(); for (let i = 0; i < 120; i++) { const s = S.ST?.stats; if (S.ready && s && !s.jobs && !s.pend) break; await new Promise(r => setTimeout(r, 500)); } S.R.lighting.time = 10; S.paused = true; return 1; })()`, 90000);
  }
  // дать вещи и надеть помощников (как игрок: ПКМ с вещью в руке)
  const give = list => ev(`(() => { const t = ${T}; for (const [id, n] of ${JSON.stringify(list)}) t.give({ id, n }); return 1; })()`);
  const wear = ids => ev(`(() => { const S = ${T}.state(), V = D37E.vox; for (const id of ${JSON.stringify(ids)}) { const j = S.P.inv.findIndex(s => s && s.id === id); if (j < 0) continue; S.P.sel = j < 9 ? j : S.P.sel; S.X.equip(S.P.inv[j], () => { const s = S.P.inv[j]; if (--s.n <= 0) S.P.inv[j] = null; }); } return S.P.acc.filter(Boolean).map(s => s.id); })()`);
  try {
    await send('Page.enable'); await send('Runtime.enable');
    const modes = MODE === 'all' ? ['shots', 'perf', 'leak', 'soak'] : [MODE];
    for (const M of modes) {
      if (M === 'shots') {
        for (const phone of [false, true]) {
          const P = phone ? 'phone' : 'pc';
          await openWorld('survival', phone);
          await ev(`(() => { const S = ${T}.state(); S.X.emit('ach', 'night'); S.X.emit('ach', 'iron'); return S.X.acc.open; })()`);
          await give([['watch', 1], ['compass', 1], ['depth_meter', 1], ['lens', 1], ['ore_finder', 1], ['atlas', 1], ['navigator', 1], ['bed', 2], ['bucket', 1], ['recall', 3], ['master_book', 1], ['map_blank', 4], ['apple', 5], ['meat_cooked', 3]]);
          const worn = await wear(['watch', 'compass', 'lens', 'depth_meter']);
          ok(worn.length === 4, P + ': надеты 4 помощника', worn);
          // смотрим на землю перед собой (лупа), держим яблоко (сытость), голод — 12
          await ev(`(async () => { const S = ${T}.state(); S.rig.fp = .7; S.P.food = 12; const j = S.P.inv.findIndex(s => s && s.id === 'apple'); if (j >= 0 && j < 9) S.P.sel = j; else if (j >= 0) { const t = S.P.inv[0]; S.P.inv[0] = S.P.inv[j]; S.P.inv[j] = t; S.P.sel = 0; } ${phone ? `S.hit = null;` : ''} await new Promise(r => setTimeout(r, 900)); return 1; })()`);
          await ev(`(() => { ${T}.state().ui.open('inv'); return 1; })()`); await sleep(700); await shot(P + '-inv');
          await ev(`(() => { ${T}.state().ui.close(); ${T}.state().X.openAcc(); return 1; })()`); await sleep(700); await shot(P + '-acc-sheet');
          await ev(`(() => { ${T}.state().X.closeSheet(); return 1; })()`); await sleep(1200); await shot(P + '-hud');
          // 📖 книга рецептов: прочитать «Книгу мастера», открыть вещи + книгу рядом, карточку компаса
          await give([['iron_ingot', 9], ['glass', 4], ['flint', 2], ['planks_oak', 12], ['stick', 4], ['coal', 6], ['fiber', 9]]);
          const learned = await ev(`(() => { const S = ${T}.state(), V = D37E.vox, j = S.P.inv.findIndex(s => s && s.id === 'master_book'); if (j < 0) return false; S.P.sel = j < 9 ? j : 0; if (j >= 9) { const t = S.P.inv[0]; S.P.inv[0] = S.P.inv[j]; S.P.inv[j] = t; } return S.X.useItem(S.P.inv[S.P.sel], V.item('master_book'), 'main', null) && S.X.recipesKnown(); })()`);
          ok(learned, P + ': «Книга мастера» прочитана — книга рецептов открыта');
          await ev(`(() => { const S = ${T}.state(); S.X.closeSheet(); S.ui.open('craft', null); S.X.openRecipes(); return 1; })()`); await sleep(900); await shot(P + '-recipes-can');
          await ev(`(() => { ${T}.state().X.openRecipes('compass'); return 1; })()`); await sleep(700); await shot(P + '-recipes-compass');
          const filled = await ev(`(() => { const S = ${T}.state(), b = document.querySelector('[data-fill]:not([disabled])'); if (!b) return 'нет кнопки'; b.click(); return S.ui.craft.filter(Boolean).map(s => s.id).join(','); })()`);
          ok(/iron_ingot/.test(filled || '') && /flint/.test(filled || ''), P + ': «Положить в сетку» — компас разложен на верстаке', filled);
          await sleep(500); await shot(P + '-recipes-filled');
          await ev(`(() => { const S = ${T}.state(); S.X.closeSheet(); S.ui.close(); return 1; })()`);
          // 🗺 атлас: пятая ячейка (глубина), надеть атлас, две точки — мини-карта, лист «Атлас»
          const atlas = await ev(`(() => { const S = ${T}.state(), V = D37E.vox; S.X.emit('ach', 'deep'); const j = S.P.inv.findIndex(s => s && s.id === 'atlas'); if (j < 0) return 'нет атласа'; S.X.equip(S.P.inv[j], () => { S.P.inv[j] = null; }); const M = S.X.feats.find(f => f.id === 'map'); S.P.x += 6; M._add(); S.P.x -= 6; S.P.z += 9; M._add(); S.P.z -= 9; return S.X.on('map') && S.P.ext.map.wp.length; })()`);
          ok(atlas === 2, P + ': атлас надет, две точки', atlas);
          await ev(`(async () => { const S = ${T}.state(); S.rig.fp = .15; await new Promise(r => setTimeout(r, 1500)); return 1; })()`); await shot(P + '-atlas-hud');
          await ev(`(() => { const S = ${T}.state(); S.X.feats.find(f => f.id === 'map').pick('x:atlas'); return 1; })()`); await sleep(700); await shot(P + '-atlas-sheet');
          await ev(`(() => { ${T}.state().X.closeSheet(); return 1; })()`);
          // 🛏 лежанка: ночь, «Мирно» (монстров нет), лечь — экран темнеет, через 1,2 с — утро
          const bed = await ev(`(async () => { const S = ${T}.state(), V = D37E.vox, W = S.W, P = S.P; S.meta.diff = 'peaceful'; S.ents.mobs.length = 0;
            const x = Math.floor(P.x) + 2, z = Math.floor(P.z), y = W.heightAt(x, z); W.set(x, y, z, V.cell(V.ID.bed), { urgent: 3 }); W.set(x, y + 1, z, 0); W.set(x, y + 2, z, 0);
            S.paused = false; S.R.lighting.time = 22.5; const d0 = S.meta.day || 1;   // новый мир: дня в meta ещё нет — это день 1
            const ok1 = S.X.useBlock({ x, y, z, v: V.cell(V.ID.bed), nx: 0, ny: 1, nz: 0 }, V.block('bed'));
            await new Promise(r => setTimeout(r, 700)); return { ok1, d0, sleeping: !!S.X.feats.find(f => f.id === 'world').state().sleep }; })()`);
          ok(bed && bed.ok1 && bed.sleeping, P + ': ночью на лежанке — уснул', bed);
          await shot(P + '-sleep');
          const woke = await ev(`(async () => { const S = ${T}.state(); await new Promise(r => setTimeout(r, 1500)); return { t: +S.R.lighting.time.toFixed(2), day: S.meta.day | 0, sleeping: !!S.X.feats.find(f => f.id === 'world').state().sleep, home: S.X.home() }; })()`);
          ok(woke && !woke.sleeping && woke.t >= 5.6 && woke.t < 6.5 && woke.day === bed.d0 + 1 && woke.home, P + ': утро следующего дня, дом — у лежанки', woke);
          await ev(`(() => { const S = ${T}.state(); S.R.lighting.time = 10; S.paused = true; return 1; })()`);
          // 📜 Дорожная книга: глава, задание, следить
          const qb = await ev(`(async () => { const S = ${T}.state(), F = S.X.feats.find(f => f.id === 'quests'); F._open(); await new Promise(r => setTimeout(r, 600)); return { open: S.X.isOpen(), stats: F.state().stats }; })()`);
          ok(qb && qb.open && qb.stats.quests > 50, P + ': Дорожная книга открыта', qb);
          await shot(P + '-quests');
          await ev(`(async () => { const b = document.querySelector('[data-q="table"]') || document.querySelector('[data-q]'); b?.click(); await new Promise(r => setTimeout(r, 400)); document.querySelector('[data-pin]')?.click(); await new Promise(r => setTimeout(r, 400)); return 1; })()`);
          await shot(P + '-quest-detail');
          await ev(`(async () => { ${T}.state().X.closeSheet(); await new Promise(r => setTimeout(r, 900)); return 1; })()`); await shot(P + '-quest-track');
          if (phone) {
            await screen(390, 844, true); await shot('phone-portrait-hud');
            await ev(`(() => { ${T}.state().X.openAcc(); return 1; })()`); await sleep(700); await shot('phone-portrait-acc-sheet');
            await ev(`(() => { ${T}.state().X.closeSheet(); return 1; })()`);
          }
          await ev(`(async () => { await ${T}.stop(); return 1; })()`, 30000);
        }
      }
      if (M === 'perf' || M === 'leak' || M === 'soak') console.log('режим', M, '— добавляется по шагам T-049');
    }
    const bad = logs.filter(l => !/WebGL|GPU stall|X3595|Wake Lock|wakeLock|NotAllowedError|AudioContext|favicon|404/.test(l));
    ok(!bad.length, 'в консоли нет ошибок и предупреждений', bad.slice(0, 8));
  } catch (e) { if (e.message !== '__готово') { fail++; console.log('FAIL', e.message); } }
  finally { try { ws.close(); } catch (e) {} proc.kill(); server.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
  console.log(fail ? `\nkubomir-qol-e2e: ${fail} провал(ов)` : '\nkubomir-qol-e2e: всё прошло');
  process.exit(fail ? 1 : 0);
})();
