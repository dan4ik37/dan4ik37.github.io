// «Кубомир» в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm): снимки для сравнения «до/после» — зимнее озеро с берёзами
// при низком солнце (отражения, тени, снег на блоках, лёд), даль от 1-го лица (чёткость), рамка постройки на снегу и в пещере,
// дождь; все программы шейдеров собрались, страж графики ничего не выключил.
// Запуск из корня сайта: node scripts/kubomir-e2e.cjs [метка] [ultra|high|mid] [d3d11|swiftshader]
//   SITE_DIR=папка — снимать другую копию сайта (например, выгрузку прошлого коммита: «до»)
// Снимки — <D37_TMP или E:\claude-tmp>\kubomir2\shots\<метка>-<пресет>-*.jpg
// KB_MODE=perf — замер в профиле телефона (412 × 915, ЦП ×4 медленнее, пресет из аргумента — «средняя» = mid): ясно, снег, дождь —
//   ЦП мс на кадр (среднее, 95 %, худший), FPS, вызовы, память JS; «до» — SITE_DIR=выгрузка прошлого коммита
// KB_MODE=soak — 10 мин игры (KB_MIN — другое число минут): ходит, прыгает, плавает и лезет на стены, ставит и ломает блоки,
//   погода и время суток меняются, телепорты, бой (меч, щит, лук) — ошибок и исключений в консоли нет, игрок ходит (ввод не заперт),
//   память JS после сборки мусора — не растёт
// KB_MODE=reopen — мир закрыть и открыть 8 раз: память JS после сборки мусора — не растёт
// KB_MODE=combat — две руки и бой (T-012): снимки поз (от 1-го лица, спереди, сзади; фаза удара «заморожена»), зомби — нокаут
//   мечом, лук — стрела вылетела; круги боя (KB_ROUNDS) — память JS не растёт, мобы не копятся; ошибок в консоли нет
// KB_MODE=water — вода (T-044): бассейн от берега (1 блок) до глубины 9 с метками на дне — день, низкий взгляд, закат, ночь, под
//   водой, лёд; океан вдаль (полосы) днём и ночью, болото, река; простой режим (VR.goSafe — шейдер «не собрался»); замер ЦП и
//   видеокарты (таймер запросов) у бассейна и над океаном. KB_PHONE=1 — профиль телефона (412 × 915, на замере ЦП ×4 медленнее).
//   Снимки — <TMP>\water\shots\<метка>-<пресет>-*.jpg
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const [label = 'now', preset = 'ultra', angle = 'd3d11'] = process.argv.slice(2);
const MODE = process.env.KB_MODE || '';
const PHONE = MODE === 'perf' || !!process.env.KB_PHONE;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const SHOTS = path.join(TMP, MODE === 'water' ? 'water' : 'kubomir2', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
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
let fail = 0; const ok = (c, name, extra) => { if (!c) { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } else console.log('ok  ', name); };
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(TMP, 'kubomir2', 'chrome-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    `--use-angle=${angle}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP: path.join(TMP, 'kubomir2'), TEMP: path.join(TMP, 'kubomir2') } });
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
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 }); const f = path.join(SHOTS, `${label}-${preset}-${name}.jpg`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('  снимок', f); return f; };
  const progsOk = `R => { const L = R.r.info.programs || []; return { n: L.length, bad: L.filter(p => p.diagnostics && p.diagnostics.runnable === false).map(p => p.name + ': ' + (p.diagnostics.fragmentShader.log || p.diagnostics.vertexShader.log || '').slice(0, 300)) }; }`;
  const res = {};
  const heap = async () => ev(`(async () => { for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise(r => setTimeout(r, 300)); } return performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null; })()`, 30000);
  const idle = () => ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(); for (let i = 0; i < 160; i++) { const s = S.ST?.stats; if (S.ready && s && !s.jobs && !s.pend) break; await new Promise(r => setTimeout(r, 500)); } return true; })()`, 120000);
  async function runMode(){
    if (MODE === 'perf') {
      await idle(); await sleep(8000);
      await send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const CL = { mode: 'fixed', season: 'summer', weather: 'clear' }, SN = { mode: 'fixed', season: 'winter', weather: 'snow' }, RN = { mode: 'fixed', season: 'summer', weather: 'rain' };
      const Y0 = await ev(`GAME_IMPL.kubomir._test.state().rig.yaw`);
      for (const [name, w] of [['прогрев', CL], ['ясно', CL], ['снег', SN], ['дождь', RN], ['ясно 2', CL], ['снег 2', SN], ['дождь 2', RN]]) {
        const r = await ev(`(async () => {
          const S = GAME_IMPL.kubomir._test.state(), wait = ms => new Promise(r => setTimeout(r, ms));
          S.R.lighting.time = 12;
          try { S.WX.clim.setWorld(Object.assign({ seed: 'kb', lapse: 0, seaY: 52 }, ${JSON.stringify(w)})); if ('cover' in S.WX) S.WX.cover = -1; } catch (e) {}
          await wait(7000);
          const cpu = [], dts = []; let run = true;
          S.rig.yaw = ${Y0}; S.rig.fp = .15;   // камера стоит (одни и те же чанки в кадре — сравнимо «до» и «после»)
          const tick = () => { if (!run) return; const st = S.R.stats; cpu.push(st.cpuFrame); dts.push(st.dt); requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
          await wait(15000); run = false;
          cpu.sort((a, b) => a - b);
          const avg = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
          return { frames: cpu.length, cpu: +avg(cpu).toFixed(2), p95: +cpu[Math.floor(cpu.length * .95)].toFixed(2), max: +cpu[cpu.length - 1].toFixed(2), fps: +(1000 / avg(dts)).toFixed(1), calls: S.R.stats.calls, q: S.R.q, wx: S.WX.stats?.() };
        })()`, 90000);
        res['perf ' + name] = r; console.log('ЗАМЕР', name, JSON.stringify({ ...r, wx: undefined }));
      }
      await send('Emulation.setCPUThrottlingRate', { rate: 1 });
      res.heapMB = await heap(); console.log('память JS, МБ', res.heapMB);
      return;
    }
    if (MODE === 'soak') {
      const MIN = +process.env.KB_MIN || 10, t0 = Date.now(), h0 = await heap(), ex0 = logs.length;
      await idle();
      let n = 0;
      while (Date.now() - t0 < MIN * 60000) {
        n++;
        const r = await ev(`(async () => {
          const n = ${n}, S = GAME_IMPL.kubomir._test.state(), T = GAME_IMPL.kubomir._test, wait = ms => new Promise(r => setTimeout(r, ms)), rnd = Math.random;
          if (!S) return { n, closed: true };
          if (!S.ready) { await wait(2000); return { n, wait: true }; }
          const C = S.C;
          const dead = document.querySelector('.kb-dead [data-r]'); if (dead) { dead.click(); await wait(1500); }   // нокаут — «Прийти в себя»
          if (n % 6 === 0) { const W = [{ mode: 'fixed', season: 'winter', weather: 'snow' }, { mode: 'fixed', season: 'summer', weather: 'rain' }, { mode: 'fixed', season: 'summer', weather: 'clear' }, { mode: 'fixed', season: 'winter', weather: 'clear' }][(n / 6) % 4 | 0]; try { S.WX.clim.setWorld(Object.assign({ seed: 'kb', lapse: 0, seaY: 52 }, W)); } catch (e) {} }
          if (n % 9 === 0) S.R.lighting.time = [6, 12, 18.5, 23, 2][(n / 9) % 5 | 0];
          if (n % 15 === 0) { S.dbg = !S.dbg; }
          if (n % 20 === 0) T.cam?.((n / 20) % 3 | 0);
          if (n % 25 === 0) { const P = S.P, x = P.x + (rnd() - .5) * 500, z = P.z + (rnd() - .5) * 500; if (T.teleport) T.teleport(x, 110, z); else T.command('/tp ' + x.toFixed(1) + ' 110 ' + z.toFixed(1)); await wait(3000); for (let i = 0; i < 40 && !S.ready; i++) await wait(500); }
          // ходит, прыгает (у стен — лезет, в воде — плывёт и вылезает), смотрит по сторонам
          const x0 = S.P.x, z0 = S.P.z;
          S.rig.yaw += (rnd() - .5) * 2.5; S.rig.fp = (rnd() - .4) * .5;
          C.press('forward', true); if (rnd() < .6) C.press('jump', true); if (rnd() < .3) C.press('run', true);
          await wait(3500);
          const mv = Math.hypot(S.P.x - x0, S.P.z - z0), blk = !!C.blocked;
          C.press('jump', false); C.press('run', false); C.press('forward', false);
          // ставит и ломает
          if (n % 3 === 0) { T.give?.({ id: ['planks_oak', 'stone', 'torch', 'glass'][n % 4], n: 16 }); S.P.sel = 0; for (let i = 0; i < 3; i++) { T.use?.(); await wait(150); T.dig?.(); await wait(150); } }
          // бой (T-012): меч и щит против зомби, поменять руки, лук со стрелой
          if (n % 4 === 1 && T.attack && S.ents) {
            S.P.inv[4] = { id: 'sword_iron', n: 1 }; S.P.inv[5] = { id: 'bow', n: 1 }; S.P.inv[6] = { id: 'arrow', n: 8 }; S.P.off = { id: 'shield', n: 1 }; S.P.sel = 4;
            const d = T.lookDir(), z = S.ents.spawn('zombie', S.P.x + d.x * 2.5, S.P.y, S.P.z + d.z * 2.5, { quiet: true });
            const lk = S.I.locked; S.I.locked = true;
            for (let i = 0; i < 8 && z && S.ents.mobs.includes(z); i++) { T.aim(z.x, z.y + 1.2, z.z); T.attack(S, z, null); await wait(700); }   // до нокаута (иначе зомби копятся)
            S.C.press('place', true); await wait(500); S.C.press('place', false); T.swap?.(); await wait(200); T.swap?.();
            S.P.sel = 5; await wait(200); S.C.press('place', true); await wait(900); S.C.press('place', false); await wait(400);
            S.I.locked = lk; S.wasLocked = lk; S.P.sel = 0;   // «отпустили мышь» без меню паузы (иначе ввод заперт до конца прогона)
          }
          await wait(800);
          return { n, mv: +mv.toFixed(1), blk, x: Math.round(S.P.x), y: Math.round(S.P.y), z: Math.round(S.P.z), hp: S.P.hp, pk: !!S.P.pk, hang: !!S.P.hang, water: S.P.water > .3, wx: S.WX.stats?.().zone };
        })()`, 60000).catch(e => ({ n, err: e.message }));
        if (n % 10 === 0 || r?.err || r?.closed || r?.blk) console.log('  шаг', JSON.stringify(r), Math.round((Date.now() - t0) / 1000) + ' с');
        if (r?.closed) { ok(false, 'мир закрылся сам во время игры'); break; }
        if (r && !r.wait && !r.err) { res.walk = (res.walk || 0) + 1; if (r.mv > .5) res.moved = (res.moved || 0) + 1; }
        if (r?.err) { await sleep(1000); if ((res.soakErr = (res.soakErr || 0) + 1) > 5) { ok(false, 'шаг игры падает', r.err); break; } }
      }
      const h1 = await heap(), errs = logs.slice(ex0).filter(l => !/X3595|DevTools|favicon/i.test(l));
      res.soak = { minutes: MIN, steps: n, walked: res.moved | 0, of: res.walk | 0, heap0: h0, heap1: h1, errors: errs.length, first: errs.slice(0, 6) };
      console.log('ЗАМЕР soak', JSON.stringify(res.soak));
      ok(!errs.length, MIN + ' мин игры — без ошибок и исключений в консоли', errs.slice(0, 6));
      ok((res.moved | 0) >= (res.walk | 0) * .5, 'игрок ходил (ввод не заперт окном или меню) — в половине шагов и больше', { moved: res.moved | 0, of: res.walk | 0 });
      return;
    }
    if (MODE === 'combat') {
      // две руки и бой (docs/COMBAT.md): снимки поз от 1-го лица и спереди (фаза удара «заморожена»), потом настоящий бой с зомби
      await idle();
      await ev(`(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, W = S.W, P = S.P, ID = V.ID;
        const cx = Math.floor(P.x), cz = Math.floor(P.z), gy = Math.floor(P.y);
        const set = (x, y, z, n) => W.set(x, y, z, n ? V.cell(ID[n]) : 0, { urgent: 1 });
        for (let x = cx - 9; x <= cx + 9; x++) for (let z = cz - 9; z <= cz + 9; z++) { for (let y = gy; y <= gy + 8; y++) if (W.raw(x, y, z) > 0) set(x, y, z, null); set(x, gy - 1, z, 'grass'); }
        Object.assign(P, { x: cx + .5, y: gy, z: cz + .5, vx: 0, vy: 0, vz: 0 });
        P.inv[0] = { id: 'sword_iron', n: 1 }; P.inv[1] = { id: 'bow', n: 1 }; P.inv[2] = { id: 'torch', n: 16 }; P.inv[3] = { id: 'axe_iron', n: 1 }; P.inv[8] = { id: 'arrow', n: 32 };
        P.off = { id: 'shield', n: 1 }; P.sel = 0; P.hp = 20; P.food = 20;
        S.R.lighting.time = 12; S.paused = true; S.rig.yaw = 0; S.rig.fp = .05;
        const st = document.createElement('style'); st.textContent = '.kb-lockhint,.e-toast,.kb-tip{display:none!important}'; document.head.appendChild(st);
        // «заморозка» фазы для снимков: шаг, щит и лук своего бойца не меняются
        const CB = D37E.combat, o = { step: CB.step, bow: CB.bow, guard: CB.guard };
        CB.step = (f, dt) => { if (window.__frz && f === S.F) return; o.step(f, dt); };
        CB.bow = (f, on) => window.__frz && f === S.F ? 0 : o.bow(f, on);
        CB.guard = (f, on) => { if (window.__frz && f === S.F) return; o.guard(f, on); };
        await wait(5000);
        return true;
      })()`, 60000);
      await ev(`(async () => { window.D37Full?.toggle(document.querySelector('#gamesStage'), { esc: false }); await new Promise(r => setTimeout(r, 1200)); return true; })()`, 20000);
      // поза: что в руках (sel), удар (движение, время от начала), щит, лук; cam — 0 от 1-го лица, 2 — спереди
      const pose = async (name, o) => {
        await ev(`(async () => {
          const S = GAME_IMPL.kubomir._test.state(), CB = D37E.combat, F = S.F, o = ${JSON.stringify(o)};
          window.__frz = false; S.P.sel = o.sel ?? 0; if (o.off !== undefined) S.P.off = o.off ? { id: o.off, n: 1 } : null;
          await new Promise(r => setTimeout(r, 450));
          window.__frz = true;
          F.mv = o.mv ? CB.MOVES[o.mv] : null; F.tA = o.t || 0; F.live = false; F.lastW = F.main;
          F.guard = o.g || 0; F.drawOn = !!o.d; F.draw = o.d ? 1.2 : 0;
          window.__side = o.cam === 3 ? 1 : o.cam === 4 ? -1 : 0;
          if (!window.__sideP) {   // вид сбоку (только для снимков): камеру ставим перед самой отрисовкой
            window.__sideP = true; const R = S.R, r0 = R.render.bind(R);
            R.render = (...a) => { if (window.__side) { const P = S.P, y = S.rig.yaw, k = window.__side, rx = Math.cos(y) * k, rz = -Math.sin(y) * k; R.camera.position.set(P.x - S.ox + rx * 3.4 - Math.sin(y) * .6, P.y + 1.35, P.z - S.oz + rz * 3.4 - Math.cos(y) * .6); R.camera.lookAt(P.x - S.ox - Math.sin(y) * .3, P.y + .95, P.z - S.oz - Math.cos(y) * .3); R.camera.updateMatrixWorld(); } return r0(...a); };
          }
          GAME_IMPL.kubomir._test.cam(o.cam >= 3 ? 1 : o.cam || 0); GAME_IMPL.kubomir._test.hud(false);
          S.rig.yaw = o.yaw ?? 0; S.rig.fp = o.fp ?? .05;
          await new Promise(r => setTimeout(r, 900));
          return true;
        })()`, 20000);
        await shot('combat-' + name);
      };
      for (const cam of [0, 2, 3, 4]) {
        const c = ['fp-', 'back-', 'tp-', 'side-', 'sideL-'][cam];
        await pose(c + 'idle', { cam });
        await pose(c + 'guard', { cam, g: 1 });
        await pose(c + 'slash-wind', { cam, mv: 'slash', t: .06 });
        await pose(c + 'slash-hit', { cam, mv: 'slash', t: .15 });
        await pose(c + 'back-hit', { cam, mv: 'back', t: .13 });
        await pose(c + 'thrust-hit', { cam, mv: 'thrust', t: .17 });
        await pose(c + 'chop-wind', { cam, sel: 3, mv: 'chop', t: .15 });
        await pose(c + 'chop-hit', { cam, sel: 3, mv: 'chop', t: .26 });
        await pose(c + 'bow-draw', { cam, sel: 1, d: 1 });
        await pose(c + 'torch-off', { cam, sel: 3, off: 'torch' });
        await ev(`(() => { GAME_IMPL.kubomir._test.state().P.off = { id: 'shield', n: 1 }; return true; })()`);
      }
      await ev(`(() => { window.__frz = false; window.__side = 0; GAME_IMPL.kubomir._test.cam(0); return true; })()`);
      // настоящий бой: зомби в 2,5 блока, удары мечом раз в 0,7 с — урон, оглушение, отброс, нокаут
      res.fight = await ev(`(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const S = GAME_IMPL.kubomir._test.state(), T = GAME_IMPL.kubomir._test, P = S.P, V = D37E.vox;
        const cx = Math.floor(P.x), cz = Math.floor(P.z), gy = Math.floor(P.y);
        for (let x = cx - 5; x <= cx + 5; x++) for (let z = cz - 5; z <= cz + 5; z++) S.W.set(x, gy + 6, z, V.cell(V.ID.planks_oak), { urgent: 1 });   // крыша: зомби не горит
        await wait(1500);
        S.P.sel = 0; S.paused = false; S.R.lighting.time = 12;
        const z = S.ents.spawn('zombie', P.x, P.y, P.z - 2.5, { quiet: true }); if (!z) return { none: true };
        const log = [];
        for (let i = 0; i < 14 && z.hp > 0; i++) {
          T.aim(z.x, z.y + 1.2, z.z);
          T.attack(S, z, null);
          await wait(720);
          log.push([+z.hp.toFixed(2), z.stag > 0 ? 1 : 0]);
        }
        return { hp: z.hp, dead: !S.ents.mobs.includes(z), log, playerHp: P.hp, arrows: S.ents.arrows.length };
      })()`, 60000);
      console.log('ЗАМЕР бой', JSON.stringify(res.fight));
      ok(res.fight && res.fight.dead && res.fight.log.length >= 3, 'бой: зомби — нокаут мечом за несколько ударов', res.fight);
      // лук: стрела летит и втыкается
      res.bow = await ev(`(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const S = GAME_IMPL.kubomir._test.state(), CB = D37E.combat, P = S.P;
        S.P.sel = 1; S.rig.fp = -.15; await wait(300);
        const n0 = P.inv[8]?.n || 0, lk = S.I.locked;
        S.I.locked = true;   // мышь «захвачена» (в безголовом Chrome захвата нет) — ПКМ идёт в игру
        S.C.press('place', true); await wait(1100);
        const draw = +CB.drawK(S.F).toFixed(2);
        S.C.press('place', false); await wait(150);
        const a = S.ents.arrows.length; await wait(2500);
        S.I.locked = lk; S.wasLocked = lk;
        return { draw, arrows: a, stuck: S.ents.arrows.filter(x => x.stuck).length, n0, n1: P.inv[8]?.n || 0 };
      })()`, 30000);
      console.log('ЗАМЕР лук', JSON.stringify(res.bow));
      ok(res.bow && res.bow.draw >= .99 && res.bow.arrows === 1 && res.bow.n1 === res.bow.n0 - 1, 'лук: натянул ПКМ (1 с), отпустил — стрела вылетела, одна стрела потрачена', res.bow);
      // утечки: круги боя на месте (зомби — нокаут мечом, щит, поменять руки, выстрел из лука) — память JS после сборки мусора
      // не растёт, мобы не копятся (KB_ROUNDS — число кругов в замере, по умолчанию 15)
      const RN = +process.env.KB_ROUNDS || 15;
      const rounds = n => ev(`(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const S = GAME_IMPL.kubomir._test.state(), T = GAME_IMPL.kubomir._test, P = S.P, lk = S.I.locked;
        S.I.locked = true; let ko = 0;
        for (let c = 0; c < ${n}; c++) {
          P.hp = 20; P.food = 20; P.inv[0] = { id: 'sword_iron', n: 1 }; P.inv[1] = { id: 'bow', n: 1 }; P.inv[8] = { id: 'arrow', n: 32 }; P.off = { id: 'shield', n: 1 }; P.sel = 0;
          S.rig.yaw = (c % 4) * Math.PI / 2; S.rig.fp = .05; await wait(100);
          const d = T.lookDir(), z = S.ents.spawn('zombie', P.x + d.x * 2.4, P.y, P.z + d.z * 2.4, { quiet: true });
          for (let i = 0; i < 10 && z && S.ents.mobs.includes(z); i++) { T.aim(z.x, z.y + 1.2, z.z); T.attack(S, z, null); await wait(700); }
          if (z && !S.ents.mobs.includes(z)) ko++;
          S.C.press('place', true); await wait(500); S.C.press('place', false);
          T.swap(); await wait(150); T.swap();
          P.sel = 1; await wait(150); S.C.press('place', true); await wait(1050); S.C.press('place', false); await wait(300); P.sel = 0;
        }
        S.I.locked = lk; S.wasLocked = lk;
        await wait(1500);
        return { ko, zombies: S.ents.mobs.filter(m => m.type === 'zombie').length, mobs: S.ents.mobs.length, dying: S.ents.dying.length, arrows: S.ents.arrows.length };
      })()`, 600000);
      const r0 = await rounds(5), h1 = await heap(), r1 = await rounds(RN), h2 = await heap(), r2 = await rounds(RN), h3 = await heap();
      res.leak = { rounds: RN, heap: [h1, h2, h3], r0, r1, r2 };
      console.log('ЗАМЕР утечки', JSON.stringify(res.leak));
      ok(r1 && r2 && r1.ko >= RN - 1 && r2.ko >= RN - 1, 'круги боя: зомби каждый раз — нокаут', { r1, r2 });
      ok(r0 && r2 && r2.mobs <= r0.mobs + 4 && r2.dying === 0, 'круги боя: мобы не копятся (свои зомби — нокаут, «пуф» доигран; остальные — сами появились)', { r0, r2 });
      ok(h3 - h2 < 4, 'круги боя: память JS после сборки мусора не растёт (' + RN + ' кругов — меньше 4 МБ)', res.leak.heap);
      const pr = await ev(`(${progsOk})(GAME_IMPL.kubomir._test.state().R)`);
      ok(!pr.bad.length, 'бой: все программы шейдеров собрались', pr.bad);
      const bad = logs.filter(l => /WebGLProgram|Shader Error|exception|TypeError|ReferenceError/i.test(l) && !/X3595/.test(l));
      ok(!bad.length, 'бой: в консоли — без ошибок и исключений', bad.slice(0, 6));
      return;
    }
    if (MODE === 'water') {
      await idle();
      await ev(`(async () => { const st = document.createElement('style'); st.textContent = '.kb-lockhint,.e-toast,.kb-tip{display:none!important}'; document.head.appendChild(st); window.D37Full?.toggle(document.querySelector('#gamesStage'), { esc: false }); await new Promise(r => setTimeout(r, 1500)); return true; })()`, 20000);
      // телепорт и ожидание: мир подгрузился (потоки свободны), игрок стоит
      const tpTo = (x, y, z, fly) => ev(`(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms)), S = GAME_IMPL.kubomir._test.state(), P = S.P;
        P.fly = ${!!fly}; GAME_IMPL.kubomir._test.command('/tp ${x} ${y} ${z}');
        await wait(1500);
        for (let i = 0; i < 160; i++) { const s = S.ST?.stats; if (S.ready && s && !s.jobs && !s.pend) break; await wait(500); }
        await wait(3000); if (!${!!fly}) for (let i = 0; i < 40 && !P.onGround; i++) await wait(250);
        P.vx = P.vy = P.vz = 0;
        return { x: Math.round(P.x), y: +P.y.toFixed(2), z: Math.round(P.z) };
      })()`, 200000);
      // место бассейна: обычная зона климата, равнина/лес/березняк, земля чуть выше моря (одно и то же «до» и «после»: зерно мира)
      res.place = await ev(`(() => {
        const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, G = S.G, P = S.P, col = {};
        const good = (x, z) => { for (let dx = -10; dx <= 32; dx += 6) for (let dz = -18; dz <= 18; dz += 6) { if (V.climZoneAt && V.climZoneAt(G, x + dx, z + dz, col) !== 0) return false; const c = V.genColumn(G, x + dx, z + dz, col); if (c.h <= V.SEA + 1 || c.h > V.SEA + 14 || ![2, 3, 4].includes(c.b)) return false; } return true; };
        const x0 = Math.floor(P.x), z0 = Math.floor(P.z);
        for (let r = 0; r < 4000; r += 48) for (let a = 0; a < (r ? 32 : 1); a++) {
          const x = Math.round(x0 + r * Math.cos(a / 32 * 6.2832)), z = Math.round(z0 + r * Math.sin(a / 32 * 6.2832));
          if (good(x, z)) return { x, z, h: V.genColumn(G, x, z, col).h };
        }
        return null;
      })()`);
      // биомы с водой: океан (глубоко), болото, река — первое подходящее место по кругу от бассейна
      const findBiome = (b, minDepth) => ev(`(() => {
        const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, G = S.G, col = {}, x0 = ${res.place ? res.place.x : 0}, z0 = ${res.place ? res.place.z : 0};
        const okAt = (x, z) => { let wet = 0; for (let dx = -12; dx <= 12; dx += 4) for (let dz = -12; dz <= 12; dz += 4) { const c = V.genColumn(G, x + dx, z + dz, col); if (c.b !== ${b}) return false; if (c.h <= V.SEA - ${minDepth}) wet++; } return wet >= 20; };
        for (let r = 64; r < 6000; r += 64) for (let a = 0; a < 48; a++) { const x = Math.round(x0 + r * Math.cos(a / 48 * 6.2832)), z = Math.round(z0 + r * Math.sin(a / 48 * 6.2832)); if (okAt(x, z)) return { x, z }; }
        return null;
      })()`, 120000);
      const QUICK = process.env.KB_WATER === 'pool';   // только бассейн (быстрые пробы вида), без океана, болота, реки и замеров
      if (!QUICK) { res.ocean = await findBiome(0, 6); res.swamp = await findBiome(8, 1); res.river = await findBiome(9, 2); }
      console.log('  места', JSON.stringify({ pool: res.place, ocean: res.ocean, swamp: res.swamp, river: res.river }));
      if (!res.place) throw new Error('нет места для бассейна');
      res.tp = await tpTo(res.place.x + .5, res.place.h + 2, res.place.z + .5);
      // бассейн: от песчаного берега (1 блок) ступенями 2, 3, 5 — до 9 блоков; на дне — песок, гравий, камень и метки (кирпичи, железо,
      // алмаз, лампа), за водой — берёзы (отражения)
      res.pool = await ev(`(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, W = S.W, P = S.P, ID = V.ID;
        const cx = Math.floor(P.x), cz = Math.floor(P.z), gy = Math.floor(P.y);
        const set = (x, y, z, n) => W.set(x, y, z, n ? V.cell(ID[n]) : 0, { urgent: 1 });
        for (let x = cx - 10; x <= cx + 34; x++) for (let z = cz - 18; z <= cz + 18; z++) {
          for (let y = gy; y <= gy + 22; y++) if (W.raw(x, y, z) > 0) set(x, y, z, null);
          set(x, gy - 1, z, 'grass'); for (let y = gy - 12; y < gy - 1; y++) set(x, y, z, 'dirt');
        }
        const X0 = cx + 3, X1 = cx + 28, Z0 = cz - 12, Z1 = cz + 12;
        const prof = d => d < 2 ? 1 : d < 4 ? 2 : d < 6 ? 3 : d < 9 ? 5 : 9;
        for (let x = X0; x <= X1; x++) for (let z = Z0; z <= Z1; z++) {
          const dep = Math.min(prof(x - X0), prof(z - Z0), prof(Z1 - z), prof(X1 - x));
          for (let y = gy - dep; y <= gy - 1; y++) set(x, y, z, 'water');
          const mk = z === cz - 4 || z === cz - 3 ? 'bricks' : z === cz + 4 && (x - X0) % 3 === 0 ? 'iron_block' : z === cz + 7 && (x - X0) % 4 === 1 ? 'diamond_block' : '';
          set(x, gy - dep - 1, z, mk || (dep <= 3 ? 'sand' : dep <= 5 ? 'gravel' : 'stone'));
        }
        set(X0 + 12, gy - 10, cz, 'lamp');   // свет из глубины (ночью)
        for (let x = cx; x < X0; x++) for (let z = Z0 - 2; z <= Z1 + 2; z++) set(x, gy - 1, z, 'sand');
        const tree = (x, z, h) => { for (let y = gy; y < gy + h; y++) set(x, y, z, 'log_birch'); const t = gy + h - 1; for (let y = t - 2; y <= t + 1; y++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { if (y > t - 1 && (Math.abs(dx) > 1 || Math.abs(dz) > 1)) continue; if (dx || dz || y > t) if (W.raw(x + dx, y, z + dz) === 0) set(x + dx, y, z + dz, 'leaves_birch'); } };
        tree(X1 + 3, cz - 6, 7); tree(X1 + 4, cz + 2, 8); tree(X1 + 3, cz + 9, 6); tree(cx + 14, Z1 + 4, 7); tree(cx + 22, Z0 - 4, 6);
        Object.assign(P, { x: cx + .5, y: gy, z: cz + .5, vx: 0, vy: 0, vz: 0, fly: false });
        S.rig.yaw = -Math.PI / 2; S.rig.fp = .4;
        await wait(5000);
        return { cx, cz, gy };
      })()`, 120000);
      const pool = res.pool;
      // время и погода (лето, ясно / зима с морозом), камера: yaw, наклон, вид (0 — от 1-го лица)
      const sky = (time, w, ice) => ev(`(async () => {
        const S = GAME_IMPL.kubomir._test.state();
        S.R.lighting.time = ${time}; S.paused = true;
        try { S.WX.clim.setWorld(${JSON.stringify(w)}); if ('cover' in S.WX) S.WX.cover = ${w.season === 'winter' ? 1 : 0}; } catch (e) {}
        if ('iceForce' in S.WX) S.WX.iceForce = ${ice ? 'true' : 'false'};
        await new Promise(r => setTimeout(r, 6000));
        return true;
      })()`, 60000);
      const view = (yaw, fp, place) => ev(`(async () => {
        const S = GAME_IMPL.kubomir._test.state(), P = S.P, o = ${JSON.stringify(place || null)};
        if (o) { P.x = o.x; P.y = o.y; P.z = o.z; P.vx = P.vy = P.vz = 0; if ('fly' in o) P.fly = o.fly; }
        S.rig.yaw = ${yaw}; S.rig.fp = ${fp}; GAME_IMPL.kubomir._test.cam(0); GAME_IMPL.kubomir._test.hud(false);
        await new Promise(r => setTimeout(r, 2200)); return true;
      })()`, 20000);
      const SUMMER = { seed: 'kb', mode: 'fixed', season: 'summer', weather: 'clear', lapse: 0, seaY: 52 };
      const WINTER = { seed: 'kb', mode: 'fixed', season: 'winter', weather: 'clear', lapse: 0, seaY: 52 };
      const shore = { x: pool.cx + .5, y: pool.gy, z: pool.cz + .5, fly: false };
      // замер: N секунд кадров — ЦП (кадр игры), видеокарта (таймер запросов вокруг R.render), FPS, вызовы
      const measure = (name, sec) => ev(`(async () => {
        const S = GAME_IMPL.kubomir._test.state(), R = S.R, gl = R.r.getContext(), ext = R.r.capabilities.isWebGL2 && gl.getExtension('EXT_disjoint_timer_query_webgl2');
        const r0 = R.render, qs = [], gpu = [], cpu = [], dts = []; let run = true;
        R.render = function (...a) { let q = null; if (ext && run) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); } const o = r0.apply(this, a); if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); } return o; };
        const tick = () => { if (!run) return; cpu.push(R.stats.cpuFrame); dts.push(R.stats.dt); requestAnimationFrame(tick); };
        await new Promise(r => setTimeout(r, 1500)); requestAnimationFrame(tick);
        await new Promise(r => setTimeout(r, ${sec * 1000})); run = false; R.render = r0;
        for (let k = 0; k < 120 && qs.length; k++) { while (qs.length && gl.getQueryParameter(qs[0], gl.QUERY_RESULT_AVAILABLE)) { const q = qs.shift(); if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); } if (qs.length) await new Promise(r => setTimeout(r, 16)); }
        for (const q of qs) gl.deleteQuery(q);
        const avg = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length); cpu.sort((a, b) => a - b); gpu.sort((a, b) => a - b);
        return { name: ${JSON.stringify(name)}, frames: cpu.length, cpu: +avg(cpu).toFixed(2), cpu95: +(cpu[Math.floor(cpu.length * .95)] || 0).toFixed(2), gpu: gpu.length ? +avg(gpu).toFixed(3) : null, gpu95: gpu.length ? +gpu[Math.floor(gpu.length * .95)].toFixed(3) : null, fps: +(1000 / avg(dts)).toFixed(1), calls: R.stats.calls, q: R.q };
      })()`, 120000);
      res.perf = [];
      // ── бассейн: день, низкий взгляд, закат, ночь ──
      await sky(10.5, SUMMER, false);
      await view(-Math.PI / 2, .42, shore); await shot('pool-day');
      if (!QUICK) {
        if (PHONE) await send('Emulation.setCPUThrottlingRate', { rate: 4 });
        res.perf.push(await measure('бассейн днём', 8));
        if (PHONE) await send('Emulation.setCPUThrottlingRate', { rate: 1 });
      }
      await view(-Math.PI / 2, .1, shore); await shot('pool-day-low');
      await view(-Math.PI / 2 - .5, .3, { x: pool.cx + 12.5, y: pool.gy + 7, z: pool.cz - 15.5, fly: true }); await shot('pool-day-side');
      await sky(18.3, SUMMER, false);
      await view(-Math.PI / 2, .16, shore); await shot('pool-dusk');
      await sky(23.5, SUMMER, false);
      await view(-Math.PI / 2, .3, shore); await shot('pool-night');
      // под водой (в глубине, лицом к берегу) и лёд (зима, мороз)
      await sky(11, SUMMER, false);
      await view(Math.PI / 2, .05, { x: pool.cx + 16.5, y: pool.gy - 6, z: pool.cz + .5, fly: true }); await shot('pool-under');
      await sky(11, WINTER, true);
      await view(-Math.PI / 2, .38, shore); await shot('pool-ice');
      // ── океан вдаль (полосы и «пластик»), сверху; ночью ──
      if (res.ocean) {
        await sky(10.5, SUMMER, false);
        res.tpOcean = await tpTo(res.ocean.x + .5, 56, res.ocean.z + .5, true);
        await view(.6, .06, { x: res.ocean.x + .5, y: 56, z: res.ocean.z + .5, fly: true }); await shot('ocean-day-far');
        if (PHONE) await send('Emulation.setCPUThrottlingRate', { rate: 4 });
        res.perf.push(await measure('океан днём', 8));
        if (PHONE) await send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await view(.6, .6); await shot('ocean-day-down');
        await sky(23.5, SUMMER, false);
        await view(.6, .06); await shot('ocean-night-far');
      }
      if (res.swamp) { await sky(10.5, SUMMER, false); res.tpSwamp = await tpTo(res.swamp.x + .5, 60, res.swamp.z + .5, true); await view(.6, .35, { x: res.swamp.x + .5, y: 60, z: res.swamp.z + .5, fly: true }); await shot('swamp-day'); }
      if (res.river) { await sky(10.5, SUMMER, false); res.tpRiver = await tpTo(res.river.x + .5, 62, res.river.z + .5, true); await view(.6, .4, { x: res.river.x + .5, y: 62, z: res.river.z + .5, fly: true }); await shot('river-day'); }
      for (const p of res.perf) console.log('ЗАМЕР', JSON.stringify(p));
      const pr = await ev(`(${progsOk})(GAME_IMPL.kubomir._test.state().R)`);
      const guard = await ev(`D37E.gfxGuardInfo ? D37E.gfxGuardInfo().off : []`);
      ok(!pr.bad.length, 'вода: все программы шейдеров собрались', pr.bad);
      ok(!guard || !guard.length, 'вода: страж графики ничего не выключил', guard);
      // ── простой режим (шейдер кубиков «не собрался»): вода видна, программы собрались ──
      res.tpBack = await tpTo(pool.cx + .5, pool.gy + 1, pool.cz + .5);
      await sky(10.5, SUMMER, false);
      res.safe = await ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(); S.VR.goSafe?.(); await new Promise(r => setTimeout(r, 3000)); return { safe: !!S.VR.safe }; })()`, 30000);
      await view(-Math.PI / 2, .42, shore); await shot('pool-basic');
      const pr2 = await ev(`(${progsOk})(GAME_IMPL.kubomir._test.state().R)`);
      ok(res.safe && res.safe.safe && !pr2.bad.length, 'простой режим воды: включился, программы собрались', { safe: res.safe, bad: pr2.bad });
      const bad = logs.filter(l => /WebGLProgram|Shader Error|exception|TypeError|ReferenceError/i.test(l) && !/X3595/.test(l));
      ok(!bad.length, 'вода: в консоли — без ошибок шейдеров и исключений', bad.slice(0, 6));
      return;
    }
    if (MODE === 'reopen') {
      const hs = [];
      for (let i = 0; i < 8; i++) {
        await idle(); await new Promise(r => setTimeout(r, 2000));
        hs.push(await heap());
        await ev(`(async () => { await GAME_IMPL.kubomir._test.stop(); GAME_IMPL.kubomir._test.menu(); return true; })()`, 60000);
        for (let k = 0; k < 60; k++) { await sleep(500); if (await ev(`!!document.querySelector('.kb-world [data-w="play"]')`, 3000).catch(() => false)) break; }
        await ev(`(() => { const b = document.querySelector('.kb-world [data-w="play"]'); b && b.click(); return !!b; })()`);
        let up = false; for (let k = 0; k < 240 && !up; k++) { await sleep(500); up = await ev(`!!(GAME_IMPL.kubomir?._test?.state()?.ready)`, 3000).catch(() => false); }
        if (!up) { ok(false, 'мир снова открылся (' + (i + 1) + ')'); break; }
      }
      await idle(); await new Promise(r => setTimeout(r, 2000)); hs.push(await heap());
      res.reopen = hs; console.log('ЗАМЕР reopen, память JS после сборки мусора (МБ):', hs.join(' → '));
      ok(hs.length >= 8 && hs[hs.length - 1] - hs[1] < 25, 'закрыть/открыть мир 8 раз — память не растёт', hs);
      return;
    }
  }
  try {
    await send('Page.enable'); await send('Runtime.enable');
    if (PHONE) {   // профиль телефона
      await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    const base = preset === 'ultra' ? 'high' : preset;
    // настройки как у владельца: пресет графики, наборы шейдеров — «Авто» (у «Ультра» — «Ультра»), без генерации кадров
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_gfx: base, d37_settings: JSON.stringify({ gfxPreset: preset, gfx: base, shaders: 'auto' }), d37_s3_learn: '1', d37_fsr: 'native',
      d37_kb_opt: JSON.stringify({ rd: 8, tips: false }) };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_gfx_guard');}catch(e){}` });
    await send('Page.navigate', { url: BASE + '/#/games/kubomir' });
    for (let i = 0; i < 120; i++) { await sleep(500); const okm = await ev(`!!document.querySelector('.kb-menu')`, 3000).catch(() => false); if (okm) break; }
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Новый мир/.test(x.textContent)); b && b.click(); return !!b; })()`);
    await sleep(500);
    await ev(`(() => { const s = document.querySelector('[data-f="seed"]'); if (s) s.value = 'озеро37'; const c = document.querySelector('[data-f="mode"] [data-v="${MODE === 'soak' || MODE === 'combat' ? 'survival' : 'creative'}"]'); c && c.click(); const g = document.querySelector('[data-n="go"]'); g && g.click(); return !!g; })()`);
    let kb = false;
    for (let i = 0; i < 240 && !kb; i++) { await sleep(500); kb = await ev(`!!(GAME_IMPL.kubomir?._test?.state()?.ready && GAME_IMPL.kubomir._test.state().WX)`, 3000).catch(() => false); }
    if (!kb) { await shot('debug-open'); console.log('  состояние:', JSON.stringify(await ev(`(() => { const S = GAME_IMPL.kubomir?._test?.state(); return S ? { ready: S.ready, wx: !!S.WX, view: document.querySelector('.kb-screen')?.textContent?.slice(0, 200) } : { none: true, html: document.querySelector('.kb-screen')?.innerText?.slice(0, 300) }; })()`).catch(e => e.message))); }
    ok(kb, '«Кубомир»: мир открылся');
    if (!kb) throw new Error('мир не открылся');
    if (MODE) { await runMode(); throw new Error('__готово'); }
    // ── сцена: ровная площадка, озеро, берёзы (одинаково «до» и «после»: только публичное — st.W, st.P, st.rig) ──
    // сцена — в обычной климатической зоне (снег и лёд зимой; у новых версий — зоны «всегда зима» / «зимы нет»), рядом с началом
    res.place = await ev(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, G = S.G, P = S.P;
      if (!G || !V.climZoneAt) return { moved: false, why: 'старая версия' };
      const col = {}, good = (x, z) => { for (let dx = -18; dx <= 30; dx += 4) for (let dz = -20; dz <= 20; dz += 4) { if (V.climZoneAt(G, x + dx, z + dz, col) !== 0) return false; const c = V.genColumn(G, x + dx, z + dz, col); if (c.h <= V.SEA + 1 || c.h > V.SEA + 24) return false; } return true; };
      const x0 = Math.floor(P.x), z0 = Math.floor(P.z);
      if (good(x0, z0)) return { moved: false };
      for (let r = 48; r < 3000; r += 48) for (let a = 0; a < 32; a++) {
        const x = Math.round(x0 + r * Math.cos(a / 32 * 6.2832)), z = Math.round(z0 + r * Math.sin(a / 32 * 6.2832));
        if (!good(x, z)) continue;
        const h = V.genColumn(G, x, z, col).h;
        GAME_IMPL.kubomir._test.command('/tp ' + (x + .5) + ' ' + (h + 2) + ' ' + (z + .5));
        for (let i = 0; i < 80 && !S.ready; i++) await wait(500);
        await wait(5000);
        for (let i = 0; i < 40 && !P.onGround; i++) await wait(250);
        return { moved: true, x, z, h, ready: S.ready };
      }
      return { moved: false, why: 'нет места' };
    })()`, 120000);
    const scene = await ev(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, W = S.W, P = S.P, ID = V.ID;
      const cx = Math.floor(P.x), cz = Math.floor(P.z), gy = Math.floor(P.y);
      const set = (x, y, z, n) => W.set(x, y, z, n ? V.cell(ID[n]) : 0, { urgent: 1 });
      for (let x = cx - 14; x <= cx + 26; x++) for (let z = cz - 16; z <= cz + 16; z++) {
        for (let y = gy; y <= gy + 24; y++) if (W.raw(x, y, z) > 0) set(x, y, z, null);
        set(x, gy - 1, z, 'grass'); for (let y = gy - 5; y < gy - 1; y++) set(x, y, z, 'dirt');
      }
      for (let x = cx + 3; x <= cx + 13; x++) for (let z = cz - 6; z <= cz + 6; z++) for (let y = gy - 4; y <= gy - 1; y++) set(x, y, z, 'water');
      const tree = (x, z, h) => { for (let y = gy; y < gy + h; y++) set(x, y, z, 'log_birch'); const t = gy + h - 1; for (let y = t - 2; y <= t + 1; y++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { if (y > t - 1 && (Math.abs(dx) > 1 || Math.abs(dz) > 1)) continue; if (dx || dz || y > t) if (W.raw(x + dx, y, z + dz) === 0) set(x + dx, y, z + dz, 'leaves_birch'); } };
      tree(cx + 4, cz + 9, 6); tree(cx + 9, cz + 9, 7); tree(cx + 14, cz + 8, 6); tree(cx + 16, cz - 2, 7); tree(cx + 2, cz - 9, 6); tree(cx + 11, cz - 9, 6);
      Object.assign(P, { x: cx - 2.5, y: gy, z: cz + .5, vx: 0, vy: 0, vz: 0, fly: false });
      S.rig.yaw = -Math.PI / 2; S.rig.fp = .32;
      await wait(4000);
      return { cx, cz, gy };
    })()`, 120000);
    res.scene = scene;
    // зоны климата вокруг (по чанкам: какие зоны в чанке; '-' — чанка нет / без зон)
    res.zoneMap = await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, W = S.W, cx = Math.floor(S.P.x) >> 4, cz = Math.floor(S.P.z) >> 4, rows = [];
      for (let dz = -2; dz <= 2; dz++) { let r = ''; for (let dx = -2; dx <= 2; dx++) { const c = W.chunk(cx + dx, cz + dz); r += (c && c.zone ? [...new Set(c.zone)].sort().join('') : '-').padEnd(4); } rows.push(r); }
      const G = S.G, col = {}; let mism = 0; if (G && V.climZoneAt) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { const c = W.chunk(cx + dx, cz + dz); if (!c || !c.zone) continue; for (let i = 0; i < 256; i += 5) if (c.zone[i] !== V.climZoneAt(G, (cx + dx) * 16 + (i >> 4), (cz + dz) * 16 + (i & 15), col)) mism++; }
      return { rows, mism, wx: S.WX.stats() }; })()`);
    // во весь окно (без шапки сайта), без подсказок поверх (тост, «нажми на мир») — чтобы на снимке был только мир
    await ev(`(async () => { const st = document.createElement('style'); st.textContent = '.kb-lockhint,.e-toast,.kb-tip{display:none!important}'; document.head.appendChild(st); window.D37Full?.toggle(document.querySelector('#gamesStage'), { esc: false }); await new Promise(r => setTimeout(r, 1500)); return !!document.querySelector('.gs-fs'); })()`, 20000);
    // время и погода: низкое солнце, зима со снегом (вид «как у владельца»)
    const setup = async (time, w) => ev(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const S = GAME_IMPL.kubomir._test.state();
      S.R.lighting.time = ${time}; S.paused = true;
      try { S.WX.clim.setWorld(${JSON.stringify(w)}); if ('cover' in S.WX) S.WX.cover = -1; } catch (e) {}   // снег на земле — заново по новой погоде
      await wait(9000);
      return { st: S.WX.stats?.(), pack: S.R.packFx?.()?.id, opt: { ao: S.R.opt?.ao, rt: S.R.opt?.rt, aa: S.R.opt?.aa }, res: S.R.pixelRatio?.(), scaled: !!S.R.post?.scaled, dof: !!S.R.post?.dofOn };
    })()`, 60000);
    const view = async (yaw, fp, cam = 0) => ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(); S.rig.yaw = ${yaw}; S.rig.fp = ${fp}; GAME_IMPL.kubomir._test.cam(${cam}); GAME_IMPL.kubomir._test.hud(false); await new Promise(r => setTimeout(r, 1800)); return true; })()`, 20000);
    const winter = { seed: 'kb', mode: 'fixed', season: 'winter', weather: 'snow', lapse: -.12, seaY: 52 };
    res.winter = await setup(9.6, winter);
    await view(-Math.PI / 2, .32); await shot('winter-lake-fp');
    await view(-Math.PI / 2 + .5, .22, 1); await shot('winter-lake-tp');
    await view(-Math.PI / 2 - .35, .02, 0); await shot('winter-far-fp');
    // рамка постройки: доски в руке, прицел в снег перед собой; потом ночь в «пещере» под каменной крышей
    await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(); S.P.inv[S.P.sel] = { id: 'planks_oak', n: 64 }; return true; })()`);
    await view(-Math.PI / 2, .75, 0); await shot('preview-snow');
    res.preview = await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(); return { hit: !!S.hit, place: S.placeAt || null }; })()`);
    await ev(`(async () => {
      const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, W = S.W, P = S.P, ID = V.ID, x0 = Math.floor(P.x), z0 = Math.floor(P.z), y0 = Math.floor(P.y);
      for (let x = x0 - 4; x <= x0 + 4; x++) for (let z = z0 - 4; z <= z0 + 4; z++) { W.set(x, y0 + 3, z, V.cell(ID.stone), { urgent: 1 }); if (Math.abs(x - x0) === 4 || Math.abs(z - z0) === 4) for (let y = y0; y < y0 + 3; y++) W.set(x, y, z, V.cell(ID.stone), { urgent: 1 }); }
      S.R.lighting.time = 23; await new Promise(r => setTimeout(r, 5000)); return true; })()`, 30000);
    await view(-Math.PI / 2, .75, 0); await shot('preview-cave-night');
    // дождь летом (дымка не «съедает» картинку)
    res.rain = await setup(13, { seed: 'kb', mode: 'fixed', season: 'summer', weather: 'rain', lapse: -.12, seaY: 52 });
    await ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, W = S.W, P = S.P, x0 = Math.floor(P.x), z0 = Math.floor(P.z), y0 = Math.floor(P.y); for (let x = x0 - 4; x <= x0 + 4; x++) for (let z = z0 - 4; z <= z0 + 4; z++) for (let y = y0; y <= y0 + 3; y++) W.set(x, y, z, 0, { urgent: 1 }); await new Promise(r => setTimeout(r, 4000)); return true; })()`, 30000);
    await view(-Math.PI / 2 - .2, .1, 0); await shot('summer-rain-fp');
    // климатические зоны (летом, ясно): граница «всегда зима» (снег на кронах и земле) и обычной (зелено) — сверху
    res.zones = await ev(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, G = S.G, P = S.P;
      if (!G || !V.climZone || !('cover' in S.WX)) return { none: 'старая версия' };
      const col = {}, x0 = Math.floor(P.x), z0 = Math.floor(P.z); let best = null;
      for (let r = 32; r < 2400 && !best; r += 24) for (let a = 0; a < 48 && !best; a++) {
        const x = Math.round(x0 + r * Math.cos(a / 48 * 6.2832)), z = Math.round(z0 + r * Math.sin(a / 48 * 6.2832));
        const c1 = V.genColumn(G, x, z, col); if (V.climZone(c1.T, c1.h, c1.b) !== 1 || c1.h > V.SEA + 30 || c1.h <= V.SEA) continue;
        for (const [dx, dz] of [[16, 0], [-16, 0], [0, 16], [0, -16]]) { const c2 = V.genColumn(G, x + dx, z + dz, col); if (V.climZone(c2.T, c2.h, c2.b) === 0 && c2.h > V.SEA && c2.h <= V.SEA + 30) { best = { x, z, dx, dz, h: c1.h }; break; } }
      }
      if (!best) return { none: 'нет границы' };
      S.WX.clim.setWorld({ seed: 'kb', mode: 'fixed', season: 'summer', weather: 'clear', lapse: 0, seaY: 52 }); S.WX.cover = 0;
      S.R.lighting.time = 12; P.fly = true;
      GAME_IMPL.kubomir._test.command('/tp ' + (best.x - best.dx) + ' ' + (best.h + 24) + ' ' + (best.z - best.dz));
      for (let i = 0; i < 60 && !S.ready; i++) await wait(500);
      await wait(8000);
      S.rig.yaw = Math.atan2(-best.dx, -best.dz);
      return { best, ready: S.ready, st: S.WX.stats() };
    })()`, 90000);
    if (res.zones && res.zones.best) { await view(Math.atan2(-res.zones.best.dx, -res.zones.best.dz), .55, 0); await shot('zones-summer'); }
    const pr = await ev(`(${progsOk})(GAME_IMPL.kubomir._test.state().R)`);
    const guard = await ev(`D37E.gfxGuardInfo ? D37E.gfxGuardInfo().off : []`);
    res.progs = pr; res.guard = guard;
    ok(!pr.bad.length, 'все программы шейдеров собрались', pr.bad);
    ok(!guard || !guard.length, 'страж графики ничего не выключил', guard);
    const bad = logs.filter(l => /WebGLProgram|Shader Error|exception/i.test(l) && !/X3595/.test(l));
    ok(!bad.length, 'в консоли — без ошибок шейдеров и исключений', bad.slice(0, 5));
  } catch (e) {
    if (e.message !== '__готово') { fail++; console.log('ОШИБКА', e.message); }
    for (const l of logs.slice(-8)) console.log('  консоль:', l.slice(0, 240));
  } finally {
    console.log('ЗАМЕР', JSON.stringify(res, null, 1).slice(0, 3000));
    try { ws.close(); } catch (e) {} proc.kill(); server.close(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('снимки:', SHOTS);
  console.log(fail ? `kubomir-e2e: ${fail} ошибок` : 'kubomir-e2e: всё в порядке');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
