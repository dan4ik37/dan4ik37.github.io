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
      // ── общее для замеров: мир на телефоне, все помощники надеты (часы, компас, глубиномер, лупа, рудоискатель, атлас), книги открыты ──
      const gear = async () => {
        await ev(`(() => { const S = ${T}.state(); for (const a of ['night', 'iron', 'deep', 'diamond']) S.X.emit('ach', a); S.meta.diff = 'peaceful'; return S.X.acc.open; })()`);
        await give([['watch', 1], ['compass', 1], ['depth_meter', 1], ['lens', 1], ['ore_finder', 1], ['atlas', 1], ['master_book', 1], ['planks_oak', 20], ['bed', 1], ['bucket', 2], ['map_blank', 6], ['apple', 10], ['torch', 32], ['cobble', 64], ['recall', 4]]);
        const w = await wear(['watch', 'compass', 'depth_meter', 'lens', 'ore_finder', 'atlas']);
        await ev(`(() => { const S = ${T}.state(), V = D37E.vox, j = S.P.inv.findIndex(s => s && s.id === 'master_book'); if (j >= 0) { S.P.sel = j < 9 ? j : 0; if (j >= 9) { const t = S.P.inv[0]; S.P.inv[0] = S.P.inv[j]; S.P.inv[j] = t; } S.X.useItem(S.P.inv[S.P.sel], V.item('master_book'), 'main', null); S.X.closeSheet(); } const M = S.X.feats.find(f => f.id === 'map'); for (let i = 0; i < 6; i++) { S.P.x += 3; M._add(); } S.P.x -= 18; return 1; })()`);
        return w;
      };
      // время помощников за кадр (их крючки X.hud / X.update — обёрткой; кадр движка — R.stats.cpuFrame)
      const measure = (sec, walk) => ev(`(async () => {
        const S = ${T}.state(), X = S.X, h0 = X.hud, u0 = X.update, C = S.C, wait = ms => new Promise(r => setTimeout(r, ms));
        let th = 0, nh = 0, mh = 0, tu = 0, nu = 0; const cpu = [];
        X.hud = dt => { const t = performance.now(); h0(dt); const d = performance.now() - t; th += d; nh++; if (d > mh) mh = d; };
        X.update = dt => { const t = performance.now(); u0(dt); tu += performance.now() - t; nu++; };
        let run = true; const tick = () => { if (!run) return; cpu.push(S.R.stats.cpuFrame); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        if (${!!walk}) { C.press('forward', true); }
        const t0 = performance.now(); while (performance.now() - t0 < ${sec * 1000}) { if (${!!walk}) S.rig.yaw += .02; await wait(100); }
        C.press('forward', false); run = false; X.hud = h0; X.update = u0;
        cpu.sort((a, b) => a - b); const avg = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
        return { frames: nh, hudMs: +(th / Math.max(1, nh)).toFixed(3), hudMax: +mh.toFixed(2), updMs: +(tu / Math.max(1, nu)).toFixed(4), cpu: +avg(cpu).toFixed(2), p95: +(cpu[Math.floor(cpu.length * .95)] || 0).toFixed(2), calls: S.R.stats.calls };
      })()`, (sec + 20) * 1000);
      if (M === 'perf') {
        await openWorld('survival', true);
        await gear();
        await ev(`(async () => { const S = ${T}.state(); S.R.lighting.time = 12; S.paused = true; S.rig.fp = .3; await new Promise(r => setTimeout(r, 4000)); return 1; })()`);
        await send('Emulation.setCPUThrottlingRate', { rate: 4 });
        const res = {};
        for (const [name, walk, on] of [['прогрев', false, true], ['стоит, всё надето', false, true], ['идёт, всё надето', true, true], ['стоит, снято всё', false, false], ['идёт, снято всё', true, false]]) {
          if (!on) await ev(`(() => { const S = ${T}.state(); for (let i = 0; i < S.P.acc.length; i++) S.P.acc[i] = null; S.X.accChanged(); return 1; })()`);
          res[name] = await measure(15, walk);
          console.log('ЗАМЕР', name, JSON.stringify(res[name]));
        }
        // открыть листы (ЦП ×4): первый раз и потом
        await ev(`(() => { const S = ${T}.state(); S.X.closeSheet(); return 1; })()`);
        const openT = await ev(`(async () => { const S = ${T}.state(), X = S.X, out = {}, wait = ms => new Promise(r => setTimeout(r, ms));
          const t = async (name, f) => { const a = performance.now(); f(); const b = performance.now(); await new Promise(r => requestAnimationFrame(() => r())); out[name] = +(b - a).toFixed(1); X.closeSheet(); S.ui.close?.(); await wait(300); };
          for (const k of [1, 2]) {
            await t('вещи ' + k, () => S.ui.open('inv'));
            await t('помощники ' + k, () => X.openAcc());
            await t('рецепты ' + k, () => X.openRecipes());
            await t('рецепт компаса ' + k, () => X.openRecipes('compass'));
            await t('атлас ' + k, () => X.feats.find(f => f.id === 'map').pick('x:atlas'));
            await t('дорожная книга ' + k, () => X.feats.find(f => f.id === 'quests')._open());
          }
          return out; })()`, 60000);
        console.log('ОТКРЫТЬ, мс (ЦП ×4):', JSON.stringify(openT));
        res.open = openT;
        await send('Emulation.setCPUThrottlingRate', { rate: 1 });
        const A = res['стоит, всё надето'], B = res['стоит, снято всё'], Aw = res['идёт, всё надето'];
        ok(A.hudMs <= .2 && Aw.hudMs <= .3, 'помощники на экране: ≤ 0,2 мс на кадр стоя и ≤ 0,3 на ходу (телефон, ЦП ×4)', { stand: A.hudMs, walk: Aw.hudMs, off: B.hudMs });
        ok(Object.entries(openT).filter(([k]) => / 2$/.test(k)).every(([, v]) => v <= 60), 'листы открываются ≤ 60 мс (повторно, ЦП ×4)', openT);
        fs.writeFileSync(path.join(SHOTS, '..', TAG + '-perf.json'), JSON.stringify(res, null, 1));
      }
      if (M === 'leak') {
        await openWorld('survival', true);
        await gear();
        const cycle = async n => ev(`(async () => { const S = ${T}.state(), X = S.X, wait = ms => new Promise(r => setTimeout(r, ms));
          for (let i = 0; i < ${'${n}'}; i++) {
            S.ui.open('inv'); await wait(30); X.openRecipes(); await wait(30); X.openRecipes('torch'); await wait(30); X.closeSheet(); S.ui.close();
            X.openAcc(); await wait(30); X.closeSheet();
            X.feats.find(f => f.id === 'map').pick('x:atlas'); await wait(30); X.closeSheet();
            const F = X.feats.find(f => f.id === 'quests'); F._open(); await wait(30); document.querySelector('[data-q]')?.click(); await wait(30); X.closeSheet();
          }
          return 1; })()`.replace('${n}', String(n)), 120000);
        await cycle(3);   // прогрев (первые открытия создают своё один раз)
        const h0 = await heap(), c0 = await counts();   // сначала сборка мусора (heap), потом счёт: отцепленные узлы до сборки ещё живы
        await cycle(20);
        const h1 = await heap(), c1 = await counts();
        console.log('УТЕЧКИ: до', JSON.stringify(c0), h0, 'МБ, после 20 кругов', JSON.stringify(c1), h1, 'МБ');
        ok(c1.nodes - c0.nodes < 150 && c1.listeners - c0.listeners <= 4 && h1 - h0 < 3, '20 открытий / закрытий всех листов и окна вещей: узлы, слушатели и память не растут', { c0, c1, h0, h1 });
        // мир закрыть и открыть 5 раз: помощники снимают свои слушатели и слои
        const m0 = await heap(), r0 = await counts();
        let reopened = 0;
        for (let i = 0; i < 5; i++) reopened += await ev(`(async () => { const t = ${T}, S = t.state(); if (!S) return 0; const id = S.meta.id; await t.stop(); await new Promise(r => setTimeout(r, 300)); t.play(id); for (let k = 0; k < 120; k++) { await new Promise(r => setTimeout(r, 500)); const s = t.state(); if (s && s.ready && s.X) break; } return t.state()?.X ? 1 : 0; })()`, 90000) || 0;
        await sleep(3000);
        const m1 = await heap(), r1 = await counts();
        ok(reopened === 5, 'мир закрыт и открыт заново 5 раз', reopened);
        console.log('МИР 5 раз: до', JSON.stringify(r0), m0, 'МБ, после', JSON.stringify(r1), m1, 'МБ');
        ok(r1.listeners - r0.listeners <= 6 && m1 - m0 < 25, 'мир закрыть / открыть 5 раз — слушатели и память на месте', { r0, r1, m0, m1 });
      }
      if (M === 'soak') {
        const MIN = +process.env.QOL_MIN || 10;
        await openWorld('survival', false);
        await gear();
        const h0 = await heap(), c0 = await counts();
        const t0 = Date.now(); let rounds = 0;
        // случайная игра с помощниками: ходит и смотрит, копает и ставит, открывает листы, ест, спит, ведро, лист карты, точки, свиток
        while (Date.now() - t0 < MIN * 60000) {
          await ev(`(async () => { const S = ${T}.state(), X = S.X, V = D37E.vox, C = S.C, P = S.P, r = Math.random, wait = ms => new Promise(q => setTimeout(q, ms));
            const pick = r();
            if (pick < .3) { C.press('forward', true); S.rig.yaw += (r() - .5) * 2; await wait(1500 + r() * 2000); C.press('forward', false); if (r() < .3) { C.press('jump', true); await wait(200); C.press('jump', false); } }
            else if (pick < .4) { S.rig.fp = .7; await wait(300); if (S.hit) ${T}.dig(); await wait(200); const j = P.inv.findIndex(s => s && s.id === 'cobble'); if (j >= 0 && j < 9) { P.sel = j; ${T}.use(); } }
            else if (pick < .5) { X.openRecipes(['torch', 'compass', 'bed', 'watch'][Math.floor(r() * 4)]); await wait(600); X.closeSheet(); }
            else if (pick < .58) { X.feats.find(f => f.id === 'quests')._open(); await wait(500); X.closeSheet(); }
            else if (pick < .64) { X.feats.find(f => f.id === 'map').pick('x:atlas'); await wait(400); X.closeSheet(); if (r() < .3 && P.ext.map.wp.length < 60) X.feats.find(f => f.id === 'map')._add(); }
            else if (pick < .7) { S.ui.open('inv'); await wait(500); S.ui.close(); }
            else if (pick < .75) { P.food = 12; const j = P.inv.findIndex(s => s && s.id === 'apple'); if (j >= 0 && j < 9) { P.sel = j; await wait(200); } }
            else if (pick < .8) { const t = S.R.lighting.time; S.R.lighting.time = 22; const x = Math.floor(P.x) + 2, z = Math.floor(P.z), y = S.W.heightAt(x, z); if (y > 0) { S.W.set(x, y, z, V.cell(V.ID.bed), { urgent: 3 }); S.W.set(x, y + 1, z, 0); S.W.set(x, y + 2, z, 0); X.useBlock({ x, y, z, v: V.cell(V.ID.bed), nx: 0, ny: 1, nz: 0 }, V.block('bed')); await wait(1800); } if (S.R.lighting.time > 20) S.R.lighting.time = t; }
            else if (pick < .85) { const j = P.inv.findIndex(s => s && s.id === 'map_blank'); if (j >= 0) { P.x += 140; X.useItem(P.inv[j], V.item('map_blank'), 'main', null); } }
            else if (pick < .9) { const j = P.inv.findIndex(s => s && /^bucket/.test(s.id)); if (j >= 0 && j < 9) { P.sel = j; S.rig.fp = 1; S.steps += 60; X.useItem(P.inv[j], V.item(P.inv[j].id), 'main', S.hit); } }
            else if (pick < .93) { const j = P.inv.findIndex(s => s && s.id === 'recall'); if (j >= 0) { S.steps += 600; X.useItem(P.inv[j], V.item('recall'), 'main', null); await wait(2500); } }
            else { const i = Math.floor(r() * 6); const s = P.acc[i]; if (s) { X.unequip(i); await wait(300); const j = P.inv.findIndex(q => q && q.id === s.id); if (j >= 0) X.equip(P.inv[j], () => { P.inv[j] = null; }); } }
            if (P.dead) document.querySelector('.kb-dead [data-r]')?.click();
            return 1; })()`, 60000).catch(e => logs.push('soak: ' + e.message));
          rounds++;
          if (rounds % 40 === 0) console.log('  soak: ' + Math.round((Date.now() - t0) / 60000) + ' мин, кругов ' + rounds + ', ошибок в консоли ' + logs.length);
        }
        const h1 = await heap(), c1 = await counts(), st1 = await ev(`(() => { const S = ${T}.state(); return { alive: S.X.H.stats(), wp: S.P.ext.map.wp.length, quests: S.X.quests.stats(), x: Math.round(S.P.x), ready: S.ready }; })()`);
        console.log('SOAK', MIN, 'мин: кругов', rounds, 'память', h0, '→', h1, 'МБ, DOM', JSON.stringify(c0), '→', JSON.stringify(c1), JSON.stringify(st1));
        ok(!st1.alive.dead.length, 'за ' + MIN + ' мин ни один помощник не выключился', st1.alive);
        ok(c1.listeners - c0.listeners <= 8 && h1 - h0 < 40, 'слушатели на месте, память на полке', { c0, c1, h0, h1 });
      }
    }
    const bad = logs.filter(l => !/WebGL|GPU stall|X3595|Wake Lock|wakeLock|NotAllowedError|AudioContext|favicon|404/.test(l));
    ok(!bad.length, 'в консоли нет ошибок и предупреждений', bad.slice(0, 8));
  } catch (e) { if (e.message !== '__готово') { fail++; console.log('FAIL', e.message); } }
  finally { try { ws.close(); } catch (e) {} proc.kill(); server.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
  console.log(fail ? `\nkubomir-qol-e2e: ${fail} провал(ов)` : '\nkubomir-qol-e2e: всё прошло');
  process.exit(fail ? 1 : 0);
})();
