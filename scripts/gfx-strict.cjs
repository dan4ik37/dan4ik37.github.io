// Графика на «чужих» бэкендах: «Мир Денчика» в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm) с профилем телефона и
// ANGLE не на Direct3D — SwiftShader (Vulkan → SPIR-V, программно), Vulkan или OpenGL драйвера видеокарты. Компьютер с Direct3D
// многое прощает; здесь шейдеры проходят другой путь сборки (16.10.2026, после «чёрной земли» на телефоне владельца).
// Проверяет: все программы собрались (three: diagnostics), страж графики (post.js) ничего лишнего не выключил, его самопроверка
// прошла, кадр в полдень не чёрный. Картинка — <папка временных файлов>/gfx-strict-<бэкенд>-<пресет>.png.
// Запуск из корня сайта: node scripts/gfx-strict.cjs [swiftshader|vulkan|gl|d3d11] [high|mid|ultra|auto] [плотность пикселей] [набор шейдеров] [lose]
// lose — ещё и потеря контекста WebGL (как на телефоне, выгрузившем видеопамять): страж ничего не выключает, после возврата кадр рисуется
// PAGE=planet — то же для скрытой «Планеты» (/play/planet, T-075): полёт вниз, посадка в полдень, тени движка на земле, два диапазона
// глубины (AO на «высокой» — снова есть), все программы (поверхность с перетеканием и тенями, небо, звёзды, тела неба, туман движка с
// дымкой атмосферы) собрались без предупреждений, страж ничего не выключил — ни навсегда, ни на сессию, самопроверка кадра прошла.
// T-075 на паузе: новое включается флагом (localStorage d37_planet_v2 = '1') — проверка ставит его сама; PLANET_V2=0 — без флага
// (как до T-075: один диапазон глубины, без теней на земле и дымки; общие проверки — те же)
// (Chrome — переменная CHROME или стандартный путь Windows; временная папка — D37_TMP, иначе E:\claude-tmp, иначе системная)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const [angle = 'swiftshader', preset = 'high', DSF = '1', PACK = 'auto', LOSE = ''] = process.argv.slice(2);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
let fail = 0; const ok = (c, name, extra) => { if (!c) { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } else console.log('ok  ', name); };
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(TMP, 'd37-gfx-strict-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    `--use-angle=${angle}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
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
  // «Планета» (T-075): спуск, посадка в полдень, проверки — как у мира + свои (два диапазона, тени, AO, туман-дымка)
  async function planet(){
    const T = 'GAME_IMPL.planet._test', V2 = process.env.PLANET_V2 !== '0';
    await send('Page.navigate', { url: BASE + '/#/games/planet' });
    let up = false;
    for (let i = 0; i < 240 && !up; i++) { await sleep(500); try { up = await ev(`!!(window.GAME_IMPL?.planet?._test?.S?.V)`, 5000); } catch (e) {} }
    ok(up, 'планета открылась');
    if (!up) throw new Error('планета не открылась');
    await sleep(2500);
    await ev(`${T}.descend(40)`); await sleep(9000);
    // полдень на месте посадки: своё время = часы мира + сдвиг
    await ev(`(() => { const S = ${T}.S, d = S.P.dirFromLatLon(29, 81), hr = S.P.localHour(d, S.t), dt = ((12.5 - hr + 24) % 24) / 24 * S.P.def.day; ${T}.time(S.t + dt, 1); })()`);
    await ev(`${T}.goto(29, 81, 30)`); await sleep(2000); await ev(`${T}.land()`); await sleep(6000);
    for (let i = 0; i < 120; i++) { const t = await ev(`(${T}.S.R.guard || {}).tests ?? -1`, 5000).catch(() => -2); if (t >= 1 || t === -1) break; await sleep(500); }
    const res = await ev(`(async () => {
      const S = ${T}.S, R = S.R, P = R.post, G = R.guard, V = S.V;
      let rep = null; if (G) { G.check(x => { rep = x; }); for (let i = 0; i < 80 && !rep; i++) await new Promise(r => setTimeout(r, 100)); }
      await new Promise(r => setTimeout(r, 500));
      R.render(); const c = R.r.domElement, k = document.createElement('canvas'); k.width = 206; k.height = Math.round(c.height * 206 / c.width);
      const g = k.getContext('2d'); g.drawImage(c, 0, 0, k.width, k.height); const d = g.getImageData(0, 0, k.width, k.height).data;
      let sum = 0, black = 0, n = 0, top = 0, tn = 0; for (let i = 0; i < d.length; i += 4) { const L = .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]; sum += L; if (L < 12) black++; n++; if (i / 4 < k.width * Math.round(k.height * .1)) { top += L; tn++; } }
      const gl = R.r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const progs = R.r.info.programs.map(p => ({ name: p.name, ok: !p.diagnostics || p.diagnostics.runnable !== false, log: p.diagnostics ? (p.diagnostics.fragmentShader.log || p.diagnostics.vertexShader.log || p.diagnostics.programLog || '').slice(0, 160) : '' }));
      const st = V.stats(), sh = R.sun && R.sun.castShadow;
      const terr = R.scene.getObjectByName('planet')?.children?.[0]?.material;
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), mobile: D37E.isMobile(), q: R.q, mode: ${T}.state().mode,
        post: P && { on: P.on, depthOK: P.depthOK, ao: P.ao.on, rt: P.rt.on }, split: st.split, shadow: { cast: !!sh, terrain: terr ? terr.uniforms.uShP.value.x : -1 },
        aerial: D37E.GFXU.apA ? D37E.GFXU.apA[3] : -1, sunProv: !!D37E.sunProvider?.(), rep: rep && { log: rep.log, sum: rep.sum }, off: D37E.gfxGuardInfo().off, vol: G ? Object.keys(G.vol || {}) : [],
        stored: (() => { try { return localStorage.getItem('d37_gfx_guard'); } catch (e) { return 'x'; } })(),
        programs: progs.length, failed: progs.filter(p => !p.ok), withLog: progs.filter(p => p.log).slice(0, 4), frame: { mean: +(sum / n).toFixed(1), black: +(black / n).toFixed(3), sky: +(top / tn).toFixed(1) }, shot: k.toDataURL('image/png') };
    })()`, 120000);
    const out = path.join(TMP, `gfx-strict-planet-${angle}-${preset}-${PACK}.png`);
    fs.writeFileSync(out, Buffer.from(res.shot.split(',')[1], 'base64')); delete res.shot;
    console.log(`  ${res.renderer} · телефон: ${res.mobile} · качество ${res.q} · ${res.mode} · программ ${res.programs} · кадр ${JSON.stringify(res.frame)} · ${out}`);
    console.log('  ', JSON.stringify({ post: res.post, split: res.split, shadow: res.shadow, aerial: res.aerial, sunProv: res.sunProv, rep: res.rep, vol: res.vol }).slice(0, 700));
    ok(res.mobile, 'профиль телефона (E.isMobile)');
    ok(res.mode === 'walk', 'посадка: пешком на земле');
    ok(!res.failed.length, 'все программы шейдеров собрались', res.failed);
    ok(!res.withLog.length, 'без предупреждений компилятора', res.withLog);
    ok(!res.off.length && !res.stored, 'страж графики ничего не выключил навсегда (и ничего не записал)', { off: res.off, stored: res.stored });
    ok(!res.vol.length, 'страж ничего не выключил и на эту сессию', res.vol);
    ok(!res.rep || !res.rep.log.length, 'самопроверка кадра прошла', res.rep);
    ok(res.frame.mean > 40 && res.frame.black < .25, 'кадр в полдень не чёрный', res.frame);
    ok(res.frame.sky > 70, 'небо над горизонтом в полдень светлое (верх кадра; дальний проход не стёрт ближним)', res.frame);
    if (V2) {
      ok(res.split > 0, 'два диапазона глубины включены', res.split);
      ok(res.q === 'low' || !res.post || !res.post.depthOK || (preset !== 'high' && preset !== 'ultra') || res.post.ao, 'AO снова работает на планете («высокая»)', res.post);
      ok(res.q === 'low' || (res.shadow.cast && res.shadow.terrain > 0), 'тени движка ложатся на землю у игрока', res.shadow);
      ok(res.aerial === 1, 'дымка атмосферы в тумане движка включена', res.aerial);
    } else {
      ok(!res.split && !(res.shadow.terrain > 0) && res.aerial !== 1 && (!res.post || !res.post.ao), 'флаги T-075 выкл: как раньше — один диапазон глубины, без AO, теней на земле и дымки',
        { split: res.split, shadow: res.shadow, aerial: res.aerial, post: res.post });
    }
    ok(res.sunProv, 'солнце движка — через E.setSunProvider');
    const bad = logs.filter(l => /WebGLProgram|Shader Error|страж графики|exception/i.test(l));
    ok(!bad.length, 'в консоли — без ошибок шейдеров', bad.slice(0, 4));
  }
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: +DSF || 1, mobile: true });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const base = preset === 'ultra' ? 'high' : preset;
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_settings: JSON.stringify({ gfxPreset: preset, gfx: base, shaders: PACK, pack: PACK }) };
    if (process.env.PAGE === 'planet' && process.env.PLANET_V2 !== '0') ls.d37_planet_v2 = '1';   // T-075: новое — флагом (на паузе выкл)
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_gfx_guard');${preset === 'auto' ? `localStorage.removeItem('d37_gfx');` : `localStorage.setItem('d37_gfx',${JSON.stringify(base)});`}}catch(e){}` });
    if (process.env.PAGE === 'planet') await planet();
    else {
    await send('Page.navigate', { url: BASE + '/#/games/world' });
    let up = false;
    for (let i = 0; i < 240 && !up; i++) { await sleep(500); try { up = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.R)`, 5000); } catch (e) {} }
    ok(up, 'мир открылся');
    if (!up) throw new Error('мир не открылся');
    for (let i = 0; i < 240; i++) { await sleep(500); const t = await ev(`(GAME_IMPL.world._test.state().R.guard || {}).tests ?? -1`, 5000).catch(() => -2); if (t >= 1 || t === -1) break; }
    const res = await ev(`(async () => {
      // мир мог пересобраться (страж графики что-то выключил → 'd37:gfxfallback') — ждём новый
      for (let i = 0; i < 240 && !GAME_IMPL.world._test.state()?.R; i++) await new Promise(r => setTimeout(r, 500));
      const S = GAME_IMPL.world._test.state(), R = S.R, P = R.post, G = R.guard;
      S.fixedTime = 12; R.setLighting({ time: 12 });
      await new Promise(r => setTimeout(r, 1500));
      let rep = null; if (G) { G.check(x => { rep = x; }); for (let i = 0; i < 60 && !rep; i++) await new Promise(r => setTimeout(r, 100)); }
      R.render(); const c = R.r.domElement, k = document.createElement('canvas'); k.width = 206; k.height = Math.round(c.height * 206 / c.width);
      const g = k.getContext('2d'); g.drawImage(c, 0, 0, k.width, k.height); const d = g.getImageData(0, 0, k.width, k.height).data;
      let sum = 0, black = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const L = .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]; sum += L; if (L < 12) black++; n++; }
      const gl = R.r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const progs = R.r.info.programs.map(p => ({ name: p.name, ok: !p.diagnostics || p.diagnostics.runnable !== false, log: p.diagnostics ? (p.diagnostics.fragmentShader.log || p.diagnostics.vertexShader.log || p.diagnostics.programLog || '').slice(0, 160) : '' }));
      // волны (waves.js, T-022c): у воды с волнами программы собраны и рисуются (море — «блин», пруд — нормали)
      const wp = [...(D37E.waves?.mats || [])].map(m => R.r.properties.get(m)?.currentProgram).filter(Boolean);
      const waves = { mats: D37E.waves?.mats.size || 0, progs: wp.length, bad: wp.filter(p => p.diagnostics && p.diagnostics.runnable === false).length, patch: [...(D37E.waves?.patches || [])].some(p => p.on && p.mesh.visible) };
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), mobile: D37E.isMobile(), q: R.q, pack: R.pack && R.pack.id, waves,
        post: P && { on: P.on, depthOK: P.depthOK, ao: P.ao.on, rt: P.rt.on, fol: P.fol, codes: P.codesOn() }, rep: rep && { sum: rep.sum, log: rep.log }, off: D37E.gfxGuardInfo().off,
        programs: progs.length, failed: progs.filter(p => !p.ok), withLog: progs.filter(p => p.log).slice(0, 4), frame: { mean: +(sum / n).toFixed(1), black: +(black / n).toFixed(3) }, shot: k.toDataURL('image/png') };
    })()`, 120000);
    const out = path.join(TMP, `gfx-strict-${angle}-${preset}-${PACK}.png`);
    fs.writeFileSync(out, Buffer.from(res.shot.split(',')[1], 'base64')); delete res.shot;
    console.log(`  ${res.renderer} · телефон: ${res.mobile} · качество ${res.q} · набор ${res.pack} · программ ${res.programs} · кадр ${JSON.stringify(res.frame)} · ${out}`);
    ok(res.mobile, 'профиль телефона (E.isMobile)');
    ok(res.q === 'low' || (res.waves.progs >= 2 && !res.waves.bad && res.waves.patch), 'волны: программы воды с волнами собрались, «блин» моря рисуется', res.waves);
    ok(PACK === 'auto' || res.pack === PACK || (res.q === 'low' && res.pack === 'normal'), 'набор шейдеров включился (или страж вернул предыдущий — тогда ошибка ниже)', res.pack);
    ok(!res.failed.length, 'все программы шейдеров собрались', res.failed);
    ok(!res.withLog.length, 'без предупреждений компилятора', res.withLog);
    ok(!res.off.length, 'страж графики ничего не выключил', res.off);
    ok(!res.rep || !res.rep.log.length, 'самопроверка кадра прошла', res.rep);
    ok(res.frame.mean > 60 && res.frame.black < .2, 'кадр в полдень не чёрный', res.frame);
    const bad = logs.filter(l => /WebGLProgram|Shader Error|страж графики|exception/i.test(l));
    ok(!bad.length, 'в консоли — без ошибок шейдеров', bad.slice(0, 4));
    if (LOSE === 'lose') {
      const lr = await ev(`(async () => {
        const S = GAME_IMPL.world._test.state(), R = S.R, G = R.guard, gl = R.r.getContext(), x = gl.getExtension('WEBGL_lose_context');
        if (!x) return { skip: true };
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const shot = () => { R.render(); const c = R.r.domElement, k = document.createElement('canvas'); k.width = 103; k.height = Math.round(c.height * 103 / c.width);
          const g = k.getContext('2d'); g.drawImage(c, 0, 0, k.width, k.height); const d = g.getImageData(0, 0, k.width, k.height).data;
          let sum = 0, n = 0; for (let i = 0; i < d.length; i += 4) { sum += .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]; n++; } return +(sum / n).toFixed(1); };
        const before = shot();
        x.loseContext(); await wait(300);
        const lostNow = gl.isContextLost();
        if (G) G.check(); await wait(4000);
        const offLost = D37E.gfxGuardInfo().off.slice();
        x.restoreContext(); await wait(3000);
        let rep = null; if (G) { G.check(r => { rep = r; }); for (let i = 0; i < 80 && !rep; i++) await wait(100); }
        await wait(1500);
        return { lostNow, offLost, offAfter: D37E.gfxGuardInfo().off, restored: !gl.isContextLost(), same: GAME_IMPL.world._test.state() === S,
          before, after: shot(), rep: rep && { log: rep.log, err: rep.err }, log: G ? G.log.slice(-6) : [] };
      })()`, 90000);
      console.log('  потеря контекста:', JSON.stringify(lr).slice(0, 500));
      ok(lr && (lr.skip || (lr.lostNow && !lr.offLost.length)), 'контекст потерян — страж ничего не выключил', lr);
      ok(lr && (lr.skip || (lr.restored && lr.same && !lr.offAfter.length && lr.after > 60 && Math.abs(lr.after - lr.before) < 4)), 'контекст вернулся — тот же мир, кадр как до потери, страж чист', lr);
    }
    }
  } catch (e) {
    fail++; console.log('ОШИБКА', e.message);
    try { console.log('  страж:', JSON.stringify(await ev(`window.D37E?.gfxGuardInfo?.() || null`, 5000)).slice(0, 600)); } catch (e2) {}
    for (const l of logs.slice(-6)) console.log('  консоль:', l.slice(0, 240));
  }
  finally { try { ws.close(); } catch (e) {} proc.kill(); server.close(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
  console.log(fail ? `gfx-strict: ${fail} ошибок` : 'gfx-strict: всё в порядке');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
