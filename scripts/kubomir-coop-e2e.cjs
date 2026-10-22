// «Кубомир» вместе по-настоящему: отдельные headless Chrome (свои профили — как разные люди), свой сервер сайта, НАСТОЯЩИЙ Supabase
// Realtime (присутствие, знакомство WebRTC, запасной канал) и WebRTC между ними. Комнаты — свои, одноразовые (новый мир — новый ключ
// и код): данных в базе не меняет. Запуск из корня сайта: node scripts/kubomir-coop-e2e.cjs [basic|soak|leak|relay|perf]
//   basic — хозяин и гость: время входа, прямая связь, правки в обе стороны (сломать, поставить, дверь), отказ (далеко), моб и вещь
//           у гостя, сундук «по одному», чат, снимок экрана гостя
//   soak  — KC_MIN минут (10): оба ходят, копают, ставят, гость телепортируется; потом — ошибок нет, миры совпадают (сверка клеток
//           всех общих чанков), память не растёт
//   leak  — гость входит и выходит KC_N раз (20): у хозяина гости, человечки, каналы и память не копятся; у гостя — тоже
//   relay — гость без WebRTC (только через Supabase): сколько сообщений и байт в секунду
//   perf  — хозяин в профиле телефона (412×915, ЦП ×4, «средняя»): кадр один и с тремя гостями (гости — на этом же компьютере, без
//           картинки; их циклы и потоки делят процессор — замер с запасом), цена самой «игры вместе» у хозяина (шаг сети, кадр
//           человечков других); KC_PROF=1 — профиль ЦП хозяина
//   perfv — без других браузеров: три человечка других игроков в странице хозяина (сколько стоят их картинка и логика);
//           KC_VARIANTS=1 — ещё и без их теней
//   KC_TIMELINE=1 — ход входа гостя по секундам (ответ хозяина, ждёт чанков, мир готов)
// Снимки и отчёт — E:\claude-tmp\coop\shots
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const MODE = process.argv[2] || 'basic';
const TMP = 'E:/claude-tmp/coop', SHOTS = path.join(TMP, 'shots');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || /^\/play(\/|$)/.test(p)) p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
server.listen(0, '127.0.0.1');
let fail = 0; const ok = (c, name, extra) => { if (!c) { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); } else console.log('ok  ', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); };
const res = {};

async function browser(tag, o = {}){
  const profile = path.join(TMP, `chrome-${tag}-` + Date.now().toString(36));
  fs.mkdirSync(profile, { recursive: true });
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--enable-precise-memory-info', '--js-flags=--expose-gc', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--use-angle=${o.angle || 'd3d11'}`, 'about:blank'];
  const proc = spawn(CHROME, args, { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  // порт — свободный, его выбирает сам Chrome (файл DevToolsActivePort в профиле): чужие Chrome на этом компьютере не мешают
  let page = null, port = 0;
  for (let i = 0; i < 240 && !page; i++) { try { if (!port) port = +fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0] || 0; if (port) page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }   // до 60 с: компьютер бывает занят
  if (!page) throw new Error('Chrome не запустился: ' + tag);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), logs = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
    else if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, ms = 60000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: null } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  if (o.phone) {
    await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  } else await send('Emulation.setDeviceMetricsOverride', { width: o.w || 960, height: o.h || 600, deviceScaleFactor: 1, mobile: false });
  const q = o.q || 'mid';
  const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_gfx: q, d37_settings: JSON.stringify({ gfxPreset: q, gfx: q, shaders: 'auto' }), d37_games_mute: '1',
    d37_kb_opt: JSON.stringify({ rd: o.rd || 6, tips: false }) };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}${o.relay ? 'window.__coopRelay=1;' : ''}sessionStorage.setItem('d37_duel_guest','Тест ${tag.toUpperCase()}');}catch(e){}` });
  return { tag, send, ev, logs, proc, profile, close: async () => { try { ws.close(); } catch (e) {} proc.kill(); await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} } };
}
const waitFor = async (P, expr, ms = 30000, step = 300) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await P.ev(expr, 10000); if (v) return v; } catch (e) {} await sleep(step); } return false; };
const T = 'GAME_IMPL.kubomir._test';
const ST = `${T}.state()`;
async function newWorld(P, mode = 'creative', seed = 'вместе37'){
  await P.send('Page.navigate', { url: BASE + '/#/games/kubomir' });
  if (!(await waitFor(P, `!!document.querySelector('.kb-menu [data-m="new"]')`, 60000))) throw new Error(P.tag + ': меню миров не открылось');
  await P.ev(`document.querySelector('[data-m="new"]').click(), 1`);
  await sleep(400);
  await P.ev(`(() => { document.querySelector('[data-f="seed"]').value = ${JSON.stringify(seed)}; document.querySelector('[data-f="mode"] [data-v="${mode}"]').click(); document.querySelector('[data-f="diff"] [data-v="easy"]')?.click(); document.querySelector('[data-n="go"]').click(); return 1; })()`);
  if (!(await waitFor(P, `!!(${ST}?.ready)`, 120000, 500))) throw new Error(P.tag + ': мир не открылся');
}
async function join(P, code){
  const t0 = Date.now(), line = [];
  await P.send('Page.navigate', { url: BASE + '/play/kubomir/' + code });
  // ход входа (раз в секунду): ответ хозяина, сколько чанков с правками ждём, мир готов
  let okJ = false, last = '';
  while (Date.now() - t0 < 90000) {
    const s = await P.ev(`(() => { const G = ${T}.coop?.(), S = ${ST}; return { wel: G?.stats?.joinMs || 0, started: !!G?.started, wait: G?.wait?.size ?? -1, ready: !!(S && S.ready && S.coopGuest), mode: G?.R ? G.R.mode(G.hostId) : '-' }; })()`, 10000).catch(() => null);
    if (s) { const k = JSON.stringify(s); if (k !== last) { last = k; line.push([Math.round((Date.now() - t0) / 100) / 10, s]); } if (s.ready) { okJ = true; break; } }
    await sleep(250);
  }
  if (process.env.KC_TIMELINE) console.log('  вход:', JSON.stringify(line));
  return { ok: okJ, ms: Date.now() - t0, line };
}
let BASE = '';
(async () => {
  await new Promise(r => server.on('listening', r));
  BASE = 'http://localhost:' + server.address().port;
  const all = [];
  try {
    if (MODE === 'basic' || MODE === 'soak' || MODE === 'leak' || MODE === 'relay') {
      const A = await browser('a'), B = await browser('b', { relay: MODE === 'relay' });
      all.push(A, B);
      await newWorld(A, MODE === 'soak' || MODE === 'leak' ? 'survival' : 'creative');
      const code = await A.ev(`${T}.coopHost()`, 30000);
      ok(/^[a-z2-7]{8}$/.test(code || ''), 'хозяин открыл мир, код', code);
      if (MODE === 'relay') await B.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.addEventListener('DOMContentLoaded',()=>{try{if(window.D37Coop)window.D37Coop.forceRelay=true;}catch(e){}});` });
      const J = await join(B, code);
      res.joinMs = J.ms;
      ok(J.ok, 'гость вошёл в мир хозяина — можно играть', J);
      if (!J.ok) { const s = await B.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }); fs.writeFileSync(path.join(SHOTS, 'guest-fail.jpg'), Buffer.from(s.data, 'base64'));
        console.log('B чанки:', JSON.stringify(await B.ev(`(() => { const S = ${ST}, G = ${T}.coop(); if (!S) return null; const cx = Math.floor(S.P.x) >> 4, cz = Math.floor(S.P.z) >> 4, a = []; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const c = S.W.chunk(cx + dx, cz + dz), k = (cx + dx) + '|' + (cz + dz); a.push([cx + dx, cz + dz, !!c, c && c.gen, c && c.ready, c && c.meshRev, c && c.loading, G?.edited?.has(k), G?.wait?.has(k), G?.stale?.has(k)]); } return { P: [S.P.x, S.P.y, S.P.z], around: a, st: S.ST.stats, pend: S.ST.pending?.(), wait: [...(G?.wait?.keys() || [])], ckQ: G?.ckQ?.length, steps: S.steps, net: !!S.net }; })()`).catch(e => e.message))); console.log('B:', JSON.stringify(await B.ev(`(() => { const G = ${T}.coop(); return { txt: document.querySelector('.kb-screen')?.innerText?.slice(0, 200), started: G?.started, hostId: G?.hostId, list: G?.R?.list?.map(p => [p.id, p.host]), stat: G?.R?.stats?.(), fake: G?.R ? [...G.R.fake] : null }; })()`).catch(e => e.message))); console.log('A:', JSON.stringify(await A.ev(`(() => { const H = ${T}.coop(); return { me: H?.R?.me, list: H?.R?.list?.map(p => [p.id, p.host]), guests: [...(H?.guests?.values() || [])].map(G => [G.id, G.ready, G.hello]), stat: H?.R?.stats?.(), journal: H?.journal }; })()`).catch(e => e.message))); console.log('логи B', B.logs.slice(-10)); console.log('логи A', A.logs.slice(-10)); throw new Error('нет входа'); }
      if (MODE === 'basic') await basic(A, B);
      if (MODE === 'relay') await relay(A, B);
      if (MODE === 'soak') await soak(A, B);
      if (MODE === 'leak') await leak(A, B, code);
    }
    if (MODE === 'perf') await perf(all);
    if (MODE === 'perfv') await perfV(all);
    if (MODE === 'cloud') await cloudUi(all);
  } catch (e) { fail++; console.log('ОШИБКА', e.stack || e.message); }
  finally {
    for (const P of all) { const errs = P.logs.filter(l => !/X3595|DevTools|favicon|GL Driver|GPU stall|WebGL-|Permissions policy|preload/i.test(l)); if (errs.length) console.log(`  консоль ${P.tag}:`, errs.slice(0, 8)); res['errors_' + P.tag] = errs.length; }
    fs.writeFileSync(path.join(SHOTS, `report-${MODE}.json`), JSON.stringify(res, null, 1));
    console.log('ЗАМЕР', JSON.stringify(res).slice(0, 4000));
    for (const P of all) await P.close();
    server.close();
  }
  console.log(fail ? `kubomir-coop-e2e ${MODE}: ${fail} ошибок` : `kubomir-coop-e2e ${MODE}: всё в порядке`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// ── basic: правки в обе стороны, отказ, моб, вещь, сундук, чат ──
async function basic(A, B){
  const mode = await waitFor(B, `${T}.coop()?.mode?.() === 'p2p' && 'p2p'`, 15000);
  ok(!!mode, 'связь напрямую (WebRTC)', await B.ev(`${T}.coop()?.mode?.()`));
  // видят друг друга
  ok(await waitFor(A, `(() => { const S = ${ST}; return [...S.A.list.keys()].some(k => /^p\\d/.test(k)); })()`, 10000), 'хозяин видит гостя (человечек)');
  ok(await waitFor(B, `(() => { const S = ${ST}; return S.A.list.has('p0'); })()`, 10000), 'гость видит хозяина (человечек)');
  if (process.env.KC_DEBUG) for (const P of [A, B]) await P.ev(`(() => { const S = ${ST}; window.__ed = []; S.W.listeners.push((x, y, z, was, v, o) => { if (Math.abs(x - S.P.x) < 12 && Math.abs(z - S.P.z) < 12 && window.__ed.length < 400) window.__ed.push([x, y, z, was & 0xfff, v & 0xfff, o && o.net ? 'net' : '', String(new Error().stack || '').split(String.fromCharCode(10)).slice(2, 7).map(l => l.trim().slice(-60)).join(' | ')]); }); return 1; })()`);
  // место для опытов: площадка у гостя
  const P0 = await B.ev(`(() => { const P = ${ST}.P; return { x: Math.floor(P.x), y: Math.floor(P.y), z: Math.floor(P.z) }; })()`);
  // хозяин ставит блок у гостя → гость видит
  const hx = P0.x + 2, hy = P0.y + 1, hz = P0.z;
  await A.ev(`(() => { const S = ${ST}, V = D37E.vox; S.W.set(${hx}, ${hy}, ${hz}, V.cell(V.ID.planks_oak), { urgent: 3 }); return 1; })()`);
  ok(await waitFor(B, `${ST}.W.get(${hx}, ${hy}, ${hz}) === D37E.vox.ID.planks_oak`, 5000), 'правка хозяина дошла до гостя');
  // гость ломает этот блок (рядом) → у хозяина пусто
  await B.ev(`(() => { const S = ${ST}, T = ${T}; S.P.x = ${P0.x} + .5; S.P.z = ${P0.z} + .5; T.aim(${hx} + .5, ${hy} + .5, ${hz} + .5); S.hit = D37E.vox.raycast(S.W, ...(() => { const e = [S.P.x, S.P.y + 1.62, S.P.z], d = T.lookDir(); return [e[0], e[1], e[2], d.x, d.y, d.z, 6]; })()); T.dig(); return !!S.hit; })()`);
  ok(await waitFor(A, `${ST}.W.get(${hx}, ${hy}, ${hz}) === 0`, 5000), 'гость сломал — у хозяина пусто');
  // гость ставит блок (стекло) → у хозяина стекло
  const gl = await B.ev(`(() => { const S = ${ST}, T = ${T}; T.give({ id: 'glass', n: 8 }); const i = S.P.inv.findIndex(s => s && s.id === 'glass'); S.P.sel = i < 9 ? i : 0; if (i >= 9) { S.P.inv[0] = S.P.inv[i]; S.P.inv[i] = null; } T.aim(${hx} + .5, ${hy - 1} + .9, ${hz} + .5); S.hit = D37E.vox.raycast(S.W, S.P.x, S.P.y + 1.62, S.P.z, T.lookDir().x, T.lookDir().y, T.lookDir().z, 6); const V = D37E.vox, pt = T.placeTarget(S, S.hit, V.block('glass')), u = T.use(); return { hit: S.hit && [S.hit.x, S.hit.y, S.hit.z, S.hit.nx, S.hit.ny, S.hit.nz, S.hit.v & 0xfff], pt, u, sel: S.P.sel, inv: S.P.inv[S.P.sel], P: [S.P.x, S.P.y, S.P.z], eat: !!S.eat, mob: S.ents.blocked(${hx}, ${hy}, ${hz}), hand: T.hands(S).mainS }; })()`);
  const pt = gl && gl.pt;
  const glOk = pt && await waitFor(A, `${ST}.W.get(${pt ? pt.x : 0}, ${pt ? pt.y : 0}, ${pt ? pt.z : 0}) === D37E.vox.ID.glass`, 5000);
  ok(glOk, 'гость поставил стекло — у хозяина там же', glOk ? pt : { hit: gl, deny: await B.ev(`${T}.coop().lastDeny`), journal: await A.ev(`${T}.coop().journal`), guestCell: await B.ev(`${ST}.W.get(${hx}, ${hy}, ${hz})`), hostCell: pt ? await A.ev(`${ST}.W.get(${pt.x}, ${pt.y}, ${pt.z})`) : null });
  if (process.env.KC_DEBUG) { console.log('ПРАВКИ хозяина:'); for (const e of (await A.ev('window.__ed')) || []) console.log('   ', JSON.stringify(e)); console.log('ПРАВКИ гостя:'); for (const e of (await B.ev('window.__ed')) || []) console.log('   ', JSON.stringify(e)); }
  { // сверка миров сразу после входа (до опытов): все общие чанки клетка в клетку
    const dump = P => P.ev(`(() => { const S = ${ST}, out = {}; for (const c of S.W.chunks.values()) { if (!c.ready || !c.gen) continue; let h = 2166136261; for (let i = 0; i < c.ids.length; i++) { h ^= c.ids[i]; h = Math.imul(h, 16777619); } out[c.cx + '|' + c.cz] = h >>> 0; } return out; })()`, 60000);
    const [dA, dB] = await Promise.all([dump(A), dump(B)]);
    const common = Object.keys(dB).filter(k => k in dA), bad = common.filter(k => dA[k] !== dB[k]);
    console.log('  общих чанков', common.length, 'разных', bad.length, bad.slice(0, 10));
    if (bad.length) { const [cx, cz] = bad[0].split('|').map(Number); const col = P => P.ev(`(() => { const S = ${ST}, c = S.W.chunk(${cx}, ${cz}); const out = []; for (let i = 0; i < c.ids.length && out.length < 12; i++) out.push(0); const diff = []; return { gen: c.gen, edits: c.edits ? c.edits.size : 0, ids: Array.from(c.ids.subarray(0, 128 * 3)).join(',').slice(0, 400), meta: { seed: S.meta.seed, genVer: S.meta.genVer, gen: S.meta.gen } }; })()`); console.log('  A', JSON.stringify(await col(A)).slice(0, 600)); console.log('  B', JSON.stringify(await col(B)).slice(0, 600)); }
  }
  // отказ: гость «ломает» далеко (60 блоков) — у него вернулось как было
  const far = await B.ev(`(() => { const S = ${ST}, V = D37E.vox; const x = ${P0.x} + 40, z = ${P0.z}; const y = S.W.heightAt(x, z) - 1; return { x, y, z, v: S.W.get(x, y, z) }; })()`);
  if (far.v > 0) {
    await B.ev(`(() => { const S = ${ST}; S.W.set(${far.x}, ${far.y}, ${far.z}, 0, { urgent: 3 }); S.net.reqBreak(${far.x}, ${far.y}, ${far.z}, ''); return 1; })()`);
    ok(await waitFor(B, `${ST}.W.get(${far.x}, ${far.y}, ${far.z}) === ${far.v}`, 5000), 'отказ хозяина (далеко) — у гостя вернулось как было');
  }
  // дверь: хозяин ставит, гость открывает — у хозяина открыта
  { const dx = P0.x - 2, dy = P0.y, dz = P0.z;
    await A.ev(`(() => { const S = ${ST}, V = D37E.vox, d = V.ID.door_oak; S.W.set(${dx}, ${dy}, ${dz}, V.cell(d, 0), { urgent: 3 }); S.W.set(${dx}, ${dy} + 1, ${dz}, V.cell(d, 8), { urgent: 3 }); return 1; })()`);
    const seen = await waitFor(B, `(${ST}.W.raw(${dx}, ${dy}, ${dz}) & 0xfff) === D37E.vox.ID.door_oak`, 5000);
    await B.ev(`(() => { const S = ${ST}, T = ${T}; T.useAt(S, { x: ${dx}, y: ${dy}, z: ${dz}, v: S.W.raw(${dx}, ${dy}, ${dz}), nx: 1, ny: 0, nz: 0, t: 1 }); return 1; })()`);
    ok(seen && await waitFor(A, `((${ST}.W.raw(${dx}, ${dy}, ${dz}) >>> 12) & 4) === 4 && ((${ST}.W.raw(${dx}, ${dy} + 1, ${dz}) >>> 12) & 4) === 4`, 5000), 'гость открыл дверь — у хозяина открыта (обе половины)'); }
  // сундук: хозяин ставит с углём; гость открывает (замок), перекладывает и закрывает — у хозяина так же; пока открыт — «занято»
  { const cx = P0.x, cy = P0.y, cz = P0.z + 2;
    await A.ev(`(() => { const S = ${ST}, V = D37E.vox; S.W.set(${cx}, ${cy}, ${cz}, V.cell(V.ID.chest), { urgent: 3 }); const t = S.W.tile(${cx}, ${cy}, ${cz}, () => ({ items: new Array(27).fill(null) })); t.items[0] = { id: 'coal', n: 5 }; return 1; })()`);
    await waitFor(B, `${ST}.W.get(${cx}, ${cy}, ${cz}) === D37E.vox.ID.chest`, 5000);
    const op = await B.ev(`(async () => { const S = ${ST}; const ok = await S.net.openTile('chest', ${cx}, ${cy}, ${cz}); if (ok) S.ui.open('chest', { x: ${cx}, y: ${cy}, z: ${cz} }); const t = S.W.tile(${cx}, ${cy}, ${cz}); return { ok, item: t && t.items[0] }; })()`);
    ok(op.ok && op.item?.id === 'coal' && op.item.n === 5, 'гость открыл сундук хозяина — вещи те же', op);
    ok(!!(await A.ev(`${ST}.net.tileBusy(${cx}, ${cy}, ${cz})`)), 'пока открыт у гостя — у хозяина «занято»');
    await B.ev(`(() => { const S = ${ST}; const t = S.W.tile(${cx}, ${cy}, ${cz}); t.items[0] = null; t.items[5] = { id: 'coal', n: 2 }; S.W.markTile(${cx}, ${cz}); return 1; })()`);
    await sleep(600);
    await B.ev(`${ST}.ui.close(), 1`);
    ok(await waitFor(A, `(() => { const S = ${ST}, t = S.W.tile(${cx}, ${cy}, ${cz}); return !!t && !t.items[0] && t.items[5] && t.items[5].n === 2 && !S.net.tileBusy(${cx}, ${cy}, ${cz}); })()`, 5000), 'гость переложил и закрыл — у хозяина так же, сундук свободен'); }
  // моб у гостя: хозяин ставит зомби рядом с гостем → гость видит моба
  await A.ev(`(() => { const S = ${ST}; S.ents.spawn('cow', ${P0.x} + 3.5, ${P0.y} + .1, ${P0.z} + 3.5, { quiet: true }); return 1; })()`);
  ok(await waitFor(B, `${ST}.ents.mobs.some(m => m.type === 'cow' && Math.abs(m.x - ${P0.x} - 3.5) < 4)`, 5000), 'моб хозяина виден у гостя');
  // вещь: хозяин бросает алмаз у гостя → у гостя в вещах
  await B.ev(`(() => { const S = ${ST}; S.P.inv.fill(null); S.P.inv[0] = { id: 'dirt', n: 1 }; return 1; })()`);
  await A.ev(`(() => { const S = ${ST}, G = [...S.net.guests.values()][0]; S.ents.addItem(G.tx, G.ty + 1, G.tz, { id: 'diamond', n: 3 }); return 1; })()`);
  ok(await waitFor(B, `${ST}.P.inv.some(s => s && s.id === 'diamond' && s.n === 3)`, 8000), 'вещь подобрал гость (хозяин отдал)');
  ok(await waitFor(A, `!${ST}.ents.items.some(e => e.s.id === 'diamond')`, 3000), 'у хозяина вещи в мире больше нет');
  // чат
  await B.ev(`${T}.command('привет всем'), 1`);
  ok(await waitFor(A, `[...document.querySelectorAll('.kb-log div')].some(d => /привет всем/.test(d.textContent))`, 5000), 'чат гостя дошёл до хозяина');
  // снимок экрана гостя: хозяин в кадре
  await A.ev(`(() => { const S = ${ST}, G = [...S.net.guests.values()][0]; S.P.x = G.tx + 2; S.P.z = G.tz; S.P.y = G.ty; return 1; })()`);
  await sleep(1500);
  await B.ev(`(() => { const S = ${ST}, T = ${T}; const h = S.net.view.get(0); if (h) T.aim(h.x, h.y + 1.2, h.z); T.cam(1); T.hud(false); return 1; })()`);
  await sleep(1500);
  const shot = await B.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  fs.writeFileSync(path.join(SHOTS, 'guest-sees-host.jpg'), Buffer.from(shot.data, 'base64'));
  res.basic = { host: await A.ev(`${T}.coop().stat()`), guest: await B.ev(`${T}.coop().stat()`) };
}
async function relay(A, B){
  const t0 = await B.ev(`${T}.coop().stat()`);
  await sleep(30000);
  const t1 = await B.ev(`${T}.coop().stat()`), h1 = await A.ev(`${T}.coop().stat()`);
  const s = (t1.net.ms - t0.net.ms) / 1000;
  res.relay = { mode: t1.mode, sec: +s.toFixed(1), guestMsgsOutPerSec: +((t1.net.relayMsgsOut - t0.net.relayMsgsOut) / s).toFixed(2), guestMsgsInPerSec: +((t1.net.relayMsgsIn - t0.net.relayMsgsIn) / s).toFixed(2),
    guestBytesInPerSec: Math.round((t1.net.relayBytesIn - t0.net.relayBytesIn) / s), guestBytesOutPerSec: Math.round((t1.net.relayBytesOut - t0.net.relayBytesOut) / s), hostRelayMsgs: h1.net.relayMsgsOut, snaps: t1.snaps - t0.snaps };
  ok(t1.mode === 'relay', 'гость без WebRTC — через Supabase', t1.mode);
  ok(res.relay.guestMsgsOutPerSec <= 3.2 && res.relay.guestMsgsInPerSec <= 3.2, 'через Supabase — не больше 3 сообщений в секунду в каждую сторону', res.relay);
}
async function soak(A, B){
  const MIN = +process.env.KC_MIN || 10, t0 = Date.now();
  const heap = P => P.ev(`(async () => { for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise(r => setTimeout(r, 300)); } return performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null; })()`, 30000);
  const hA0 = await heap(A), hB0 = await heap(B), e0 = [A.logs.length, B.logs.length];
  let n = 0;
  const act = (P, guest) => P.ev(`(async () => {
    const S = ${ST}, T = ${T}, V = D37E.vox, wait = ms => new Promise(r => setTimeout(r, ms)), rnd = Math.random, C = S.C;
    if (!S || !S.ready) { await wait(1500); return { wait: 1 }; }
    const dead = document.querySelector('.kb-dead [data-r]'); if (dead) { dead.click(); await wait(1000); }
    S.rig.yaw += (rnd() - .5) * 2.5; S.rig.fp = (rnd() - .3) * .8;
    C.press('forward', true); if (rnd() < .5) C.press('jump', true);
    await wait(1200 + rnd() * 1500);
    C.press('jump', false); C.press('forward', false);
    T.give({ id: ['planks_oak', 'stone', 'torch', 'dirt', 'glass'][(rnd() * 5) | 0], n: 16 }); S.P.sel = 0;
    const d = T.lookDir();
    for (let i = 0; i < 4; i++) { S.rig.fp = .3 + rnd() * .6; S.rig.yaw += (rnd() - .5) * 1.2; const e = [S.P.x, S.P.y + 1.62, S.P.z], dd = T.lookDir(); S.hit = V.raycast(S.W, e[0], e[1], e[2], dd.x, dd.y, dd.z, 5); if (S.hit) { if (rnd() < .5) T.dig(); else T.use(); } await wait(250); }
    ${guest ? `if (rnd() < .15) { const H = S.net.view.get(0); if (H) { const x = H.x + (rnd() - .5) * 60, z = H.z + (rnd() - .5) * 60; T.command('/tp ' + x.toFixed(1) + ' 110 ' + z.toFixed(1)); await wait(2500); } }` : `if (rnd() < .1) { const G = [...S.net.guests.values()][0]; if (G) { S.ents.spawn(rnd() < .5 ? 'zombie' : 'pig', G.tx + 4, G.ty + .5, G.tz + 4, { quiet: true }); } }`}
    return { x: Math.round(S.P.x), z: Math.round(S.P.z), mobs: S.ents.mobs.length, items: S.ents.items.length };
  })()`, 30000).catch(e => ({ err: e.message }));
  let hMid = null;
  while (Date.now() - t0 < MIN * 60000) {
    n++;
    if (!hMid && Date.now() - t0 > MIN * 30000) hMid = [await heap(A), await heap(B)];   // середина: растёт ли память дальше или вышла на полку
    const [ra, rb] = await Promise.all([act(A, false), act(B, true)]);
    if (n % 10 === 0 || ra?.err || rb?.err) console.log('  шаг', n, JSON.stringify(ra), JSON.stringify(rb), Math.round((Date.now() - t0) / 1000) + ' с', await B.ev(`${T}.coop()?.mode?.()`).catch(() => '?'));
    if (!(await B.ev(`!!(${ST}?.coopGuest)`).catch(() => false))) { ok(false, 'гость выпал из мира во время игры', await B.ev(`document.querySelector('.kb-screen')?.innerText?.slice(0, 200)`).catch(() => '')); break; }
  }
  await sleep(4000);
  // сверка миров: все общие чанки (готовые у обоих) — клетка в клетку
  const dump = P => P.ev(`(() => { const S = ${ST}, out = {}; for (const c of S.W.chunks.values()) { if (!c.ready || !c.gen) continue; let h = 2166136261; for (let i = 0; i < c.ids.length; i++) { h ^= c.ids[i]; h = Math.imul(h, 16777619); } out[c.cx + '|' + c.cz] = h >>> 0; } return out; })()`, 60000);
  const [dA, dB] = await Promise.all([dump(A), dump(B)]);
  const common = Object.keys(dB).filter(k => k in dA);
  let bad = common.filter(k => dA[k] !== dB[k]);
  // правка могла быть в пути (песок падает, вода течёт, дерево валится) — разные снова через 3 с — это и есть расхождение
  for (let i = 0; i < 3 && bad.length; i++) { await sleep(3000); const [a2, b2] = await Promise.all([dump(A), dump(B)]); bad = bad.filter(k => k in a2 && k in b2 && a2[k] !== b2[k]); }
  if (bad.length) {
    const k = bad[0], [cx, cz] = k.split('|').map(Number);
    const diff = await Promise.all([A, B].map(P => P.ev(`(() => { const c = ${ST}.W.chunk(${cx}, ${cz}); return Array.from(c.ids); })()`, 30000)));
    const cells = []; for (let i = 0; i < diff[0].length && cells.length < 8; i++) if (diff[0][i] !== diff[1][i]) cells.push({ x: cx * 16 + (i >> 11), y: i & 127, z: cz * 16 + ((i >> 7) & 15), host: diff[0][i], guest: diff[1][i] });
    console.log('  расхождение', k, cells);
  }
  const hA1 = await heap(A), hB1 = await heap(B);
  const errs = [A, B].map((P, i) => P.logs.slice(e0[i]).filter(l => !/X3595|DevTools|favicon|GL Driver|GPU stall|WebGL-|Permissions policy|preload/i.test(l)));
  res.soak = { minutes: MIN, steps: n, commonChunks: common.length, desynced: bad.length, heapA: [hA0, hMid?.[0], hA1], heapB: [hB0, hMid?.[1], hB1], errorsA: errs[0].length, errorsB: errs[1].length, host: await A.ev(`${T}.coop().stat()`), guest: await B.ev(`${T}.coop().stat()`) };
  ok(common.length >= 20 && bad.length === 0, `сверка миров: ${common.length} общих чанков, расхождений ${bad.length}`);
  ok(!errs[0].length && !errs[1].length, MIN + ' мин вместе — без ошибок в консоли', errs.map(e => e.slice(0, 4)));
}
async function leak(A, B, code){
  const N = +process.env.KC_N || 20;
  const heap = P => P.ev(`(async () => { for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise(r => setTimeout(r, 300)); } return performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null; })()`, 30000);
  const hostInfo = () => A.ev(`(() => { const S = ${ST}, N = S.net; return { guests: N.guests.size, actors: S.A.list.size, others: S.ents.others.length, tags: document.querySelectorAll('.kb-tag').length, channels: (typeof sbClient !== 'undefined' && sbClient.getChannels ? sbClient.getChannels().length : -1), locks: N.locks.size }; })()`);
  const guestInfo = () => B.ev(`({ channels: (typeof sbClient !== 'undefined' && sbClient.getChannels ? sbClient.getChannels().length : -1), tags: document.querySelectorAll('.kb-tag').length })`);
  // гость входит и выходит в ОДНОЙ странице (меню миров → мир друга → «выйти» → меню): так видно, копится ли у него что-то
  const leaveB = async () => { await B.ev(`(async () => { ${T}.coop()?.leave?.(); await new Promise(r => setTimeout(r, 1500)); ${T}.menu?.(); return 1; })()`).catch(() => {}); await waitFor(A, `${ST}.net.guests.size === 0`, 15000); await sleep(1000); };
  const joinB = async () => { const t0 = Date.now(); await B.ev(`(${T}.joinCoop(${JSON.stringify(code)}), 1)`).catch(() => {}); const okJ = await waitFor(B, `(() => { const S = ${ST}; return !!(S && S.ready && S.coopGuest); })()`, 60000, 250); return { ok: !!okJ, ms: Date.now() - t0 }; };
  await leaveB();
  const h0 = await heap(A), i0 = await hostInfo();
  const times = [];
  let hB0 = null, iB0 = null;
  for (let i = 0; i < N; i++) {
    const J = await joinB();
    times.push(J.ms);
    if (!J.ok) { ok(false, 'вход ' + (i + 1) + ' не удался', await B.ev(`document.querySelector('.kb-screen')?.innerText?.slice(0, 200)`).catch(() => '')); break; }
    await sleep(1500);
    await leaveB();
    if (i === 1) { hB0 = await heap(B); iB0 = await guestInfo(); }
  }
  const h1 = await heap(A), i1 = await hostInfo(), hB1 = await heap(B), iB1 = await guestInfo();
  res.leak = { cycles: N, joinMs: { min: Math.min(...times), med: times.slice().sort((a, b) => a - b)[times.length >> 1], max: Math.max(...times) }, hostHeap: [h0, h1], hostInfo: [i0, i1], guestHeap: [hB0, hB1], guestInfo: [iB0, iB1] };
  ok(i1.guests === 0 && i1.actors === i0.actors && i1.others === 0 && i1.tags === 0 && i1.locks === 0, 'у хозяина после ' + N + ' входов/выходов ничего не копится (гости, человечки, имена, замки)', [i0, i1]);
  ok(iB1.channels <= iB0.channels && iB1.tags === 0, 'у гостя каналы и имена над головами не копятся', [iB0, iB1]);
  ok(hB1 - hB0 < 15, 'память гостя (та же страница): +' + (hB1 - hB0).toFixed(1) + ' МБ за ' + (N - 2) + ' входов', [hB0, hB1]);
  ok(i1.channels <= i0.channels + 1, 'каналы Supabase у хозяина не копятся', [i0.channels, i1.channels]);
  ok(h1 - h0 < 12, 'память хозяина: +' + (h1 - h0).toFixed(1) + ' МБ за ' + N + ' гостей', [h0, h1]);
}
// cloud — меню облака в настоящем браузере (без входа и без Supabase: «вошёл» подменой, хранилище — свой бэкенд в странице через
// D37Cloud.setBackend): мир уходит в облако при выходе; не менялся — второй раз не уходит; поменялся — уходит; убрали мир из браузера —
// он в «☁️ В облаке — с других устройств», «⬇ Скачать» возвращает его с теми же блоками
async function cloudUi(all){
  const A = await browser('cl'); all.push(A);
  await A.send('Page.navigate', { url: BASE + '/#/games/kubomir' });
  if (!(await waitFor(A, `!!window.D37Cloud && !!document.querySelector('.kb-menu [data-m="new"]')`, 60000))) throw new Error('меню миров не открылось');
  await A.ev(`(() => {
    currentUser = { id: '11111111-2222-3333-4444-555555555555' };
    const files = new Map(), rows = new Map(), log = window.__cl = { put: 0, get: 0, list: 0 };
    D37Cloud.setBackend({ name: 'test', ready: () => true,
      async rpc(fn, a){
        if (fn === 'cloud_list') { log.list++; return { ok: true, slots: 2, max_bytes: 2097152, plus: false, full: false, used: [...rows.values()].filter(r => r.path).length, list: [...rows.values()].filter(r => r.path).map(r => Object.assign({}, r)) }; }
        if (fn === 'cloud_begin') { const r = rows.get(a.p_world); if (r && r.path && a.p_base !== r.ver && !a.p_force) return { ok: false, reason: 'conflict', ver: r.ver }; const v = r ? r.ver : 0; return { ok: true, path: currentUser.id + '/kubomir/' + a.p_world + '/' + (v + 1) + '-x' + Date.now() + '.kbw', ver: v }; }
        if (fn === 'cloud_commit') { log.put++; const r = rows.get(a.p_world) || { world: a.p_world, ver: 0 }; const old = r.path; Object.assign(r, { name: a.p_name, ver: r.ver + 1, path: a.p_path, bytes: files.get(a.p_path).length, gt: a.p_gt, device: a.p_device, at: new Date().toISOString() }); rows.set(a.p_world, r); return { ok: true, ver: r.ver, old }; }
        if (fn === 'cloud_delete') { const r = rows.get(a.p_world); rows.delete(a.p_world); return r ? { ok: true, path: r.path } : { ok: false, reason: 'not_found' }; }
        return { ok: false, reason: 'off' };
      },
      async upload(p, u8){ files.set(p, u8.slice()); }, async download(p){ log.get++; const f = files.get(p); if (!f) throw new Error('нет'); return f; },
      async remove(ps){ for (const p of ps) files.delete(p); }, async list(dir){ return [...files.keys()].filter(p => p.startsWith(dir + '/')).map(p => p.slice(dir.length + 1)); } });
    return 1; })()`);
  await A.ev(`(${T}.menu(), 1)`);
  await sleep(800);
  await A.ev(`document.querySelector('[data-m="new"]').click(), 1`);
  await sleep(400);
  await A.ev(`(() => { document.querySelector('[data-f="seed"]').value = 'облако37'; document.querySelector('[data-f="mode"] [data-v="creative"]').click(); document.querySelector('[data-n="go"]').click(); return 1; })()`);
  if (!(await waitFor(A, `!!(${ST}?.ready)`, 120000, 500))) throw new Error('мир не открылся');
  const w0 = await A.ev(`(() => { const S = ${ST}; return { on: !!S.meta.cloud?.on, id: S.meta.id }; })()`);
  ok(w0.on, 'вошёл — новый мир сам «в облаке» (есть место)', w0);
  const place = (n, dz = 0) => A.ev(`(() => { const S = ${ST}, V = D37E.vox, x = Math.floor(S.P.x) + 3, z = Math.floor(S.P.z) + ${dz}; for (let i = 0; i < ${n}; i++) S.W.set(x + i, Math.floor(S.P.y) + 2, z, V.cell(V.ID.glass), { urgent: 2 }); return 1; })()`);
  await place(4);
  // «вошёл» — подменой (сайт при проверке сессии может вернуть currentUser = null — ставим перед каждым выходом)
  const exitToMenu = async () => { await A.ev(`(currentUser = { id: '11111111-2222-3333-4444-555555555555' }, ${T}.stop(), 1)`); await sleep(2500); await A.ev(`(${T}.menu(), 1)`); await sleep(1500); };
  await exitToMenu();
  let L = await A.ev(`({ put: __cl.put, line: document.querySelector('.kb-world .kb-cl')?.textContent || '', bar: document.querySelector('.kb-cloudbar')?.textContent || '' })`);
  ok(L.put === 1 && /В облаке/.test(L.line) && /1 из 2 мест/.test(L.bar), 'вышел — мир в облаке (отметка у мира, строка облака)', L);
  // ещё раз в мир и сразу выйти — не менялся: второй раз не отправляется
  await A.ev(`(() => { const b = document.querySelector('.kb-world[data-id] [data-w="play"]') || document.querySelector('.kb-world[data-id]'); b?.click(); return 1; })()`);
  await waitFor(A, `!!(${ST}?.ready)`, 60000, 500);
  await sleep(1500);
  await exitToMenu();
  L = await A.ev(`({ put: __cl.put })`);
  ok(L.put === 1, 'зашёл и вышел, ничего не меняя — в облако не отправлялось', L);
  await A.ev(`(() => { const b = document.querySelector('.kb-world[data-id] [data-w="play"]') || document.querySelector('.kb-world[data-id]'); b?.click(); return 1; })()`);
  await waitFor(A, `!!(${ST}?.ready)`, 60000, 500);
  await place(2, 2);   // в других клетках (игрок стоит там же — те же клетки ничего бы не поменяли)
  await sleep(21000);   // сервер облака принимает раз в 20 с
  if (process.env.KC_DEBUG) console.log('  перед выходом:', JSON.stringify(await A.ev(`(async () => { const S = ${ST}; return { busy: !!S.meta._cloudBusy, stBusy: !!S.cloudBusy, next: S.cloudNext && Math.round(S.cloudNext - performance.now()), cloud: S.meta.cloud, unsaved: S.unsaved.size, put: __cl.put }; })()`)));
  await exitToMenu();
  L = await A.ev(`(async () => { const V = D37E.vox, w = await V.store.world(${JSON.stringify(w0.id)}), u = await V.store.packWorld(w.id, { cloud: true }), sg = V.store.sig(w, u); return { put: __cl.put, list: __cl.list, cloud: w.cloud, sig: sg, user: typeof currentUser !== 'undefined' && !!currentUser, avail: D37Cloud.available() }; })()`);
  ok(L.put === 2, 'поменял блоки — отправилось', L);
  // «другое устройство»: мира в браузере нет — он в облаке, «⬇ Скачать» возвращает его
  await A.ev(`(async () => { await D37E.vox.store.delWorld(${JSON.stringify(w0.id)}); ${T}.menu(); return 1; })()`);
  await waitFor(A, `!!document.querySelector('.kb-cloudonly [data-c="get"]')`, 10000);
  await A.ev(`(document.querySelector('.kb-cloudonly [data-c="get"]').click(), 1)`);
  ok(await waitFor(A, `!!document.querySelector('.kb-world[data-id=${JSON.stringify(w0.id)}]')`, 15000), 'мир с другого устройства скачан — снова в списке');
  await A.ev(`(() => { const b = document.querySelector('.kb-world[data-id] [data-w="play"]') || document.querySelector('.kb-world[data-id]'); b?.click(); return 1; })()`);
  await waitFor(A, `!!(${ST}?.ready)`, 60000, 500);
  const glass = await A.ev(`(() => { const S = ${ST}, V = D37E.vox; let n = 0; for (const c of S.W.chunks.values()) if (c.edits) for (const v of c.edits.values()) if ((v & 0xfff) === V.ID.glass) n++; return n; })()`);
  ok(glass === 6, 'скачанный мир — с теми же правками (6 стёкол)', glass);
  res.cloud = await A.ev(`Object.assign({}, __cl)`);
  const s = await A.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }); fs.writeFileSync(path.join(SHOTS, 'cloud-world.jpg'), Buffer.from(s.data, 'base64'));
}
// perfv — то же без других браузеров: у хозяина три «гостя» внутри страницы (человечки других игроков ходят кругами, как по снимкам
// сети) — сколько стоят их картинка и логика, без чужой видеокарты на этом же компьютере
async function perfV(all){
  const A = await browser('ph', { phone: true, q: 'mid', rd: 6 }); all.push(A);
  await newWorld(A, 'survival');
  await A.ev(`(() => { const S = ${ST}; S.R.lighting.time = 12; return 1; })()`);
  await A.ev(`${T}.coopHost()`, 30000);
  const measure = async label => {
    await A.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const r = await A.ev(`(async () => {
      const S = ${ST}, wait = ms => new Promise(r => setTimeout(r, ms));
      await wait(3000);
      const cpu = [], dts = []; let run = true;
      const tick = () => { if (!run) return; const st = S.R.stats; cpu.push(st.cpuFrame); dts.push(st.dt); requestAnimationFrame(tick); };
      requestAnimationFrame(tick); await wait(12000); run = false;
      cpu.sort((a, b) => a - b);
      const avg = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
      return { frames: cpu.length, cpu: +avg(cpu).toFixed(2), med: +cpu[cpu.length >> 1].toFixed(2), p95: +cpu[Math.floor(cpu.length * .95)].toFixed(2), fps: +(1000 / avg(dts)).toFixed(1), calls: S.R.stats.calls };
    })()`, 90000);
    await A.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log('ЗАМЕР', label, JSON.stringify(r));
    return r;
  };
  const out = {};
  out.solo1 = await measure('один');
  await A.ev(`(() => { const S = ${ST}, H = S.net, P = S.P; window.__vg = setInterval(() => { const t = performance.now() / 1000; for (let i = 1; i <= 3; i++) { const a = t * .6 + i * 2.1; H.view.state(i, P.x + Math.cos(a) * (3 + i), P.y, P.z + Math.sin(a) * (3 + i), a + Math.PI / 2, 0, 1, i === 1 ? 'pick_iron' : i === 2 ? 'torch' : 'sword_wood', i === 3 ? 'shield' : '', 0, 20, 100); } }, 100); for (let i = 1; i <= 3; i++) H.view.add(i, 'Гость ' + i, null); return 1; })()`);
  out.three = await measure('три человечка других рядом');
  if (process.env.KC_VARIANTS) {   // из чего цена: тени человечков и подробная модель
    await A.ev(`(() => { const S = ${ST}; for (let i = 1; i <= 3; i++) { const a = S.A.list.get('p' + i); a?.ch?.root.traverse(o => { if (o.isMesh) o.castShadow = false; }); } S.R.shadowDirty?.(); return 1; })()`);
    out.threeNoShadow = await measure('три человечка, без их теней');
    out.calls = await A.ev(`(() => { const S = ${ST}; let n = 0, m = 0; S.A.list.get('p1')?.ch?.root.traverse(o => { if (o.isMesh && o.visible) { n++; } }); return { meshesPerHuman: n, shadowUpd: S.R.stats.shadowUpd, shadow: S.R.stats.shadow }; })()`);
    console.log('ЗАМЕР сетки человечка', JSON.stringify(out.calls));
  }
  await A.ev(`(() => { clearInterval(window.__vg); const H = ${ST}.net; for (let i = 1; i <= 3; i++) H.view.remove(i); return 1; })()`);
  out.solo2 = await measure('снова один');
  res.perfV = out;
  const solo = (out.solo1.med + out.solo2.med) / 2;
  ok(out.three.med - solo < 3, `три человечка других у хозяина (телефон, ×4): медиана кадра ${solo.toFixed(1)} → ${out.three.med} мс, вызовов ${out.solo1.calls} → ${out.three.calls}`, out);
}
async function perf(all){
  const A = await browser('ph', { phone: true, q: 'mid', rd: 6 }); all.push(A);
  await newWorld(A, 'survival');
  const measure = async label => {
    await A.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const r = await A.ev(`(async () => {
      const S = ${ST}, wait = ms => new Promise(r => setTimeout(r, ms));
      await wait(4000);
      const cpu = [], dts = []; let run = true;
      const tick = () => { if (!run) return; const st = S.R.stats; cpu.push(st.cpuFrame); dts.push(st.dt); requestAnimationFrame(tick); };
      requestAnimationFrame(tick); await wait(15000); run = false;
      cpu.sort((a, b) => a - b);
      const avg = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
      return { frames: cpu.length, cpu: +avg(cpu).toFixed(2), p95: +cpu[Math.floor(cpu.length * .95)].toFixed(2), fps: +(1000 / avg(dts)).toFixed(1), calls: S.R.stats.calls, mobs: S.ents.mobs.length, chunks: S.W.chunks.size };
    })()`, 90000);
    await A.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    console.log('ЗАМЕР', label, JSON.stringify(r));
    return r;
  };
  await A.ev(`(() => { const S = ${ST}; S.R.lighting.time = 12; return 1; })()`);
  res.perfSolo = await measure('один');
  const code = await A.ev(`${T}.coopHost()`, 30000);
  res.perfHosting = await measure('мир открыт, гостей нет');
  const G = [];
  // гости — по одному (четыре Chrome на одном компьютере: разом — загрузка страниц мешает замеру и самим гостям)
  const joins = [];
  // гости на этом же компьютере не рисуют (иначе видеокарта одна на четверых и замер хозяина — про чужие кадры): цикл игры, сеть и
  // мобы у них идут как обычно, нет только картинки
  for (let i = 0; i < 3; i++) { const P = await browser('g' + i, { w: 640, h: 400, q: 'low', rd: 4 }); all.push(P); G.push(P); joins.push(await join(P, code)); await P.ev(`(() => { const S = ${ST}; if (S?.R) S.R.render = () => {}; return 1; })()`).catch(() => {}); }
  res.perfJoins = joins.map(j => j.ms);
  ok(joins.every(j => j.ok), 'три гостя вошли', joins);
  // сколько стоит сама «игра вместе» у хозяина (его шаг сети и кадр человечков других), отдельно от картинки и от нагрузки компьютера
  const coopT = () => A.ev(`(() => { const N = ${ST}.net; if (!N || N.__w) return 0; const W = window.__cw = { step: 0, frame: 0, n: 0, t0: performance.now() }; const s0 = N.step, f0 = N.frame; N.__w = 1;
    N.step = function(dt){ const t = performance.now(); try { return s0.call(this, dt); } finally { W.step += performance.now() - t; } };
    N.frame = function(dt, tt){ const t = performance.now(); try { return f0.call(this, dt, tt); } finally { W.frame += performance.now() - t; W.n++; } }; return 1; })()`);
  const coopRead = () => A.ev(`(() => { const W = window.__cw; if (!W) return null; const s = (performance.now() - W.t0) / 1000, r = { stepMsPerSec: +(W.step / s).toFixed(2), frameMsPerFrame: +(W.frame / Math.max(1, W.n)).toFixed(3) }; W.step = 0; W.frame = 0; W.n = 0; W.t0 = performance.now(); return r; })()`);
  await coopT();
  await sleep(20000);   // у гостей догенерировались чанки вокруг (их потоки на этом же компьютере)
  await coopRead();
  res.perfGuests3 = await measure('три гостя рядом (стоят)');
  res.coopCost = { idle: await coopRead() };
  // гости ходят (каждый своё), хозяин стоит
  const walk = G.map((P, i) => P.ev(`(async () => { const S = ${ST}, C = S.C; for (let k = 0; k < 40; k++) { S.rig.yaw += .5; C.press('forward', true); await new Promise(r => setTimeout(r, 900)); } C.press('forward', false); return 1; })()`, 60000).catch(() => {}));
  res.perfGuests3walk = await measure('три гостя ходят');
  res.coopCost.walk = await coopRead();
  console.log('ЗАМЕР стоимость игры вместе у хозяина (×4):', JSON.stringify(res.coopCost));
  if (process.env.KC_PROF) {   // где тратится время хозяина с тремя гостями (профиль ЦП, 8 с, без замедления — оно путает «(program)»)
    await A.send('Profiler.enable'); await A.send('Profiler.setSamplingInterval', { interval: 200 });
    await A.send('Profiler.start'); await sleep(8000);
    const { profile } = await A.send('Profiler.stop');
    const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n])), dt = profile.timeDeltas, smp = profile.samples;
    for (let i = 0; i < smp.length; i++) { const n = byId.get(smp[i]); const f = n.callFrame, k = (f.functionName || '(anon)') + ' ' + (f.url || '').split('/').pop() + ':' + f.lineNumber; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); }
    const tot = [...self.values()].reduce((a, b) => a + b, 0);
    console.log('ПРОФИЛЬ хозяина (самое тяжёлое, % времени):'); for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log('   ', (v / tot * 100).toFixed(1) + '%', k);
    // с вложенными вызовами — только наши файлы игры (что из логики тяжелее)
    const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const incl = new Map();
    for (let i = 0; i < smp.length; i++) { const seen = new Set(); for (let id = smp[i]; id != null; id = parent.get(id)) { const n = byId.get(id), f = n.callFrame; if (!/kubomir|coop|voxel|engine|world3d|actors/.test(f.url || '')) continue; const k = (f.functionName || '(anon)') + ' ' + (f.url || '').split('/').pop().replace(/\?.*/, '') + ':' + f.lineNumber; if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) || 0) + (dt[i] || 0)); } }
    console.log('ПРОФИЛЬ хозяина, с вложенными (наши файлы, % времени):'); for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log('   ', (v / tot * 100).toFixed(1) + '%', k);
  }
  await Promise.all(walk);
  res.perfNet = await A.ev(`${T}.coop().stat()`);
  // гости ушли — ещё раз «один» (насколько шумит сам компьютер: на нём же идут другие проверки)
  for (const P of G) await P.close();
  all.length = 1;
  await sleep(8000);
  res.perfSolo2 = await measure('снова один');
  const solo = Math.min(res.perfSolo.cpu, res.perfSolo2.cpu), c = res.coopCost.idle;
  ok(c && c.frameMsPerFrame < 1 && c.stepMsPerSec < 30, `игра вместе у хозяина (×4): кадр человечков других ${c?.frameMsPerFrame} мс, сеть и снимки ${c?.stepMsPerSec} мс в секунду`, res.coopCost);
  // четыре Chrome на одном компьютере делят процессор (у гостей — свои циклы игры и потоки чанков): запас больше, чем у perfv
  ok(res.perfGuests3.cpu - solo < 12, `хозяин с тремя гостями рядом: ЦП кадра ${solo} → ${res.perfGuests3.cpu} мс (телефон, ×4; один — до и после: ${res.perfSolo.cpu} / ${res.perfSolo2.cpu})`, { solo: res.perfSolo, solo2: res.perfSolo2, three: res.perfGuests3, walk: res.perfGuests3walk });
}
