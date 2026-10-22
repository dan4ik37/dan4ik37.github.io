// Нагрузка на свой сервер (T-045, server/rt): настоящий сервер отдельным процессом (со сторожем Supabase на подменном Supabase),
// нагрузку дают несколько процессов-«толп» (каждый — сотни соединений), чтобы упирался сервер, а не генератор.
//  1) N соединений в R комнатах (по N/R человек, как в io-игре на 10): вход, presence, память на 1000 соединений;
//  2) каждый шлёт M сообщений в секунду (~120 байт, как ход/управление) T секунд: процессор сервера, сообщения в секунду,
//     задержка доставки p50 / p99 / max (метка времени в сообщении, один компьютер — одни часы);
//  3) «шторм переподключений»: половина соединений рвётся разом (как у телефонов при смене сети) и возвращается — с тем же
//     сеансом (resumed) и заново (без сеанса): за сколько все снова в комнатах, процессор и задержка цикла событий сервера.
// Запуск из корня сайта: DEPS_DIR=<ws@8.21.3> node scripts/rt-load-test.cjs [--conns 1000] [--rooms 100] [--rate 10] [--secs 20] [--quick]
//   --quick (для ci-run): 200 соединений, 20 комнат, 5 с — проверяет, что всё доходит и задержка разумная, без замеров «в цифрах».
const path = require('path'), { fork } = require('child_process');
const K = require('./rt-kit.cjs');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? +argv[i + 1] : d; };
const QUICK = argv.includes('--quick');

if (process.env.RT_LOAD_WORKER) worker();
else main();

// ═══ Процесс-толпа: свои соединения, свои замеры ═══
function worker(){
  const D = K.deps();
  const conns = [];
  let cfg = null, sending = false, lat = [], recv = 0, sent = 0, errors = 0, closedUnexpected = 0;
  const why = {};
  const now = () => performance.timeOrigin + performance.now();
  const PAD = 'x'.repeat(48);
  function connect(c, resume){
    return new Promise(res => {
      const ws = new D.WS(cfg.url, { origin: 'http://localhost:5500', perMessageDeflate: false });
      c.ws = ws; c.joined = false; c.t0 = now();
      let done = false;
      const fin = v => { if (!done) { done = true; res(v); } };
      ws.on('open', () => ws.send(JSON.stringify({ t: 'hi', v: 1, sid: resume ? c.sid : undefined })));
      ws.on('message', d => {
        const s = d.toString();
        if (s.charCodeAt(6) === 98 && s.startsWith('{"t":"b"')) {   // broadcast — самое частое: разбор только метки времени
          recv++;
          if ((recv & 7) === 0) { const k = s.indexOf('"ts":'); if (k > 0) { const ts = parseFloat(s.slice(k + 5, k + 25)); if (ts > 0) lat.push(now() - ts); } }
          return;
        }
        let m; try { m = JSON.parse(s); } catch (e) { return; }
        if (m.t === 'hi') {
          c.sid = m.sid;
          if (m.resumed) { c.joined = true; c.resumed = true; fin(now() - c.t0); }
          else { c.resumed = false; c.i = c.i || 1; ws.send(JSON.stringify({ t: 'j', i: c.i, c: 'load-room-' + c.room, k: 'u' + c.id, p: 1 })); }
        } else if (m.t === 'j') {
          if (m.home !== 'rt') { errors++; why['home-' + m.home + '-' + m.e] = (why['home-' + m.home + '-' + m.e] || 0) + 1; fin(-1); return; }
          ws.send(JSON.stringify({ t: 'tr', i: m.i, m: { nick: 'игрок ' + c.id, t: c.id, look: { c: 'x1a2b3c', h: 3 } }, r: 1 }));
        } else if (m.t === 'ok') { c.joined = true; fin(now() - c.t0); }
      });
      ws.on('close', code => { if (c.ws === ws && !c.dropping) closedUnexpected++; if (!done) { errors++; why['close' + code] = (why['close' + code] || 0) + 1; fin(-1); } });
      ws.on('error', () => {});
    });
  }
  // как D37RT: не вышло — ещё раз с разбросом (0 / 0,4 / 1 / 2 / 3 с + случайно), сеанс тот же (если был)
  async function connectRetry(c, resume){
    const t0 = now();
    for (let k = 0; k < 6; k++) {
      if (k) await new Promise(r => setTimeout(r, [0, 400, 1000, 2000, 3000, 3000][k] + Math.random() * 400));
      const v = await connect(c, resume);
      if (v >= 0) { c.tries = k; return now() - t0; }
    }
    return -1;
  }
  const loop = () => {
    if (!sending) return;
    const t = now();
    for (const c of conns) {
      if (!c.joined || !c.ws || c.ws.readyState !== 1) continue;
      if (t < c.next) continue;
      c.next = t + 1000 / cfg.rate;
      c.ws.send('{"t":"b","i":' + (c.i || 1) + ',"e":"m","p":{"ts":' + now().toFixed(3) + ',"k":"in","x":' + (c.id % 97) + '.5,"y":12.25,"a":[1,0,1],"s":"' + PAD + '"}}');
      sent++;
    }
    setTimeout(loop, 5);
  };
  process.on('message', async msg => {
    if (msg.cmd === 'connect') {
      cfg = msg;
      const t0 = now();
      const times = [];
      for (let k = 0; k < msg.ids.length; k += 25) {   // по 25 сразу — как люди, а не одним залпом
        const part = msg.ids.slice(k, k + 25).map(([id, room]) => { const c = { id, room, next: now() + Math.random() * 100 }; conns.push(c); return connect(c, false); });
        times.push(...await Promise.all(part));
      }
      process.send({ ev: 'connected', ms: now() - t0, ok: times.filter(x => x >= 0).length, fail: times.filter(x => x < 0).length });
    } else if (msg.cmd === 'send') { sending = true; lat = []; recv = 0; sent = 0; loop(); }
    else if (msg.cmd === 'stop') {
      sending = false;
      process.send({ ev: 'stats', lat: lat.slice(-20000), recv, sent, errors, closedUnexpected });
    } else if (msg.cmd === 'storm') {
      const victims = conns.filter((c, i) => i % 2 === 0);
      for (const c of victims) { c.dropping = true; c.joined = false; try { c.ws.terminate(); } catch (e) {} }
      await new Promise(r => setTimeout(r, msg.pause || 0));
      const t0 = now();
      const res = await Promise.all(victims.map(c => connectRetry(c, msg.resume).then(v => { c.dropping = false; return v; })));
      const okN = res.filter(x => x >= 0);
      process.send({ ev: 'storm', ms: now() - t0, n: victims.length, ok: okN.length, resumed: victims.filter(c => c.resumed).length, fail: res.length - okN.length, why: Object.assign({}, why), retried: victims.filter(c => c.tries > 0).length, p99: okN.sort((a, b) => a - b)[Math.floor(okN.length * .99)] || 0 });
    } else if (msg.cmd === 'churn') {   // --soak: люди переходят из комнаты в комнату, часть связей рвётся и продолжается
      const end = now() + msg.secs * 1000;
      let moves = 0, drops = 0, dropFail = 0;
      sending = true; lat = []; recv = 0; sent = 0; loop();
      const pending = [];
      while (now() < end) {
        await new Promise(r => setTimeout(r, msg.period));
        const c = conns[Math.floor(Math.random() * conns.length)];
        if (c && c.joined && c.ws && c.ws.readyState === 1) {
          c.ws.send(JSON.stringify({ t: 'l', i: c.i || 1 }));
          c.i = (c.i || 1) + 1; c.room = (c.room + 1 + Math.floor(Math.random() * 7)) % msg.rooms;
          c.ws.send(JSON.stringify({ t: 'j', i: c.i, c: 'load-room-' + c.room, k: 'u' + c.id, p: 1 }));
          moves++;
        }
        if (Math.random() < msg.period / 30000) {
          for (const v of conns.filter(() => Math.random() < .05)) {
            if (!v.joined || v.dropping) continue;
            v.dropping = true; v.joined = false; drops++;
            try { v.ws.terminate(); } catch (e) {}
            pending.push(connectRetry(v, true).then(x => { v.dropping = false; if (x < 0) dropFail++; }));
          }
        }
      }
      await Promise.all(pending);
      sending = false;
      process.send({ ev: 'churned', moves, drops, dropFail, recv, sent, errors, closedUnexpected, lat: lat.slice(-5000) });
    } else if (msg.cmd === 'exit') { for (const c of conns) { try { c.ws.close(1000); } catch (e) {} } setTimeout(() => process.exit(0), 300); }
  });
  process.send({ ev: 'ready' });
}

// ═══ Главный: сервер, толпы, замеры, итог ═══
async function main(){
  const D = K.deps();
  if (!D) { console.log('rt-load-test: нет пакета ws (DEPS_DIR) — пропуск'); process.exit(process.env.CI_STRICT ? 1 : 0); }
  const N = opt('conns', QUICK ? 200 : 1000), R = opt('rooms', QUICK ? 20 : 100), RATE = opt('rate', QUICK ? 5 : 10), SECS = opt('secs', QUICK ? 5 : 20);
  const W = Math.max(1, Math.min(8, opt('workers', QUICK ? 2 : 4)));
  const EXT = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : '';   // уже запущенный сервер (замеры профилировщиком)
  const ADMIN = EXT ? (argv[argv.indexOf('--admin') + 1] || '') : 'load-' + Math.random().toString(36).slice(2);
  const PH = require('./rt-phoenix.cjs');
  const P = EXT ? { close: async () => {}, ws: '' } : await PH.start({ WS: D.WS });
  const S = EXT ? { ws: EXT.replace(/^http/, 'ws') + '/rt', metrics: async t => (await fetch(EXT + '/metrics', { headers: { Authorization: 'Bearer ' + t } })).json(), kill: async () => {} } : await K.startServer(D, { ADMIN_TOKEN: ADMIN, WATCH: '1', SB_WS: P.ws, MAX_CONNS: '20000', MAX_PER_IP: '20000', IP_BURST: '20000', IP_PER_SEC: '5000', LOG_LEVEL: 'warn', GRACE_MS: '4000' }, { nodeArgs: argv.includes('--prof') ? ['--cpu-prof', '--cpu-prof-dir=' + (process.env.RT_PROF_DIR || 'E:/claude-tmp/t045/prof')] : [] });
  const M = () => S.metrics(ADMIN);
  // --prio: на общем (занятом) компьютере — сервер и толпы выше прочих программ, иначе замер мерит чужую нагрузку
  const PRIO = argv.includes('--prio'), os = require('os');
  const prio = (pid, v) => { try { os.setPriority(pid, v); return true; } catch (e) { return false; } };
  const prioOk = PRIO && S.p ? prio(S.p.pid, os.constants.priority.PRIORITY_HIGH) : false;
  if (!EXT) await K.until(async () => (await M()).watcher?.up >= 1, 5000);
  const base = await M();
  const workers = [];
  for (let w = 0; w < W; w++) {
    const p = fork(__filename, argv, { env: { ...process.env, RT_LOAD_WORKER: '1' } });
    const inbox = [];
    p.on('message', m => inbox.push(m));
    if (PRIO) prio(p.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
    workers.push({ p, inbox, next: (ev, ms = 120000) => K.until(() => { const i = inbox.findIndex(m => m.ev === ev); return i >= 0 ? inbox.splice(i, 1)[0] : false; }, ms, 10) });
  }
  for (const w of workers) await w.next('ready');
  // 1) соединения
  const ids = Array.from({ length: N }, (_, i) => [i, i % R]);
  const t0 = Date.now();
  workers.forEach((w, k) => w.p.send({ cmd: 'connect', url: S.ws, rate: RATE, ids: ids.filter((_, i) => i % W === k) }));
  const con = await Promise.all(workers.map(w => w.next('connected')));
  const connMs = Date.now() - t0, connOk = con.reduce((a, c) => a + c.ok, 0), connFail = con.reduce((a, c) => a + c.fail, 0);
  await K.sleep(2500);
  const idle = await M();
  // --soak <с>: долгий прогон с «жизнью» (переходы между комнатами, обрывы связи с продолжением) — память и ошибки по времени
  const SOAK = opt('soak', 0);
  if (SOAK > 0) {
    workers.forEach(w => w.p.send({ cmd: 'churn', secs: SOAK, period: 250, rooms: R }));
    const series = [];
    const t0s = Date.now();
    const sampler = setInterval(async () => { try { const m = await M(); series.push({ s: Math.round((Date.now() - t0s) / 1000), rss: m.mem.rssMb, heap: m.mem.heapMb, conns: m.counts.conns, members: m.counts.members, rooms: m.counts.rooms, cpu: m.cpuPct, internal: m.stats.internal, zombies: m.counts.zombies, inS: m.perSec.msgIn, outS: m.perSec.msgOut }); } catch (e) {} }, 30000);
    const ch = await Promise.all(workers.map(w => w.next('churned', (SOAK + 180) * 1000)));
    clearInterval(sampler);
    await K.sleep(6000);   // ушедшие без возврата — освобождены (GRACE_MS 4 с)
    const fin = await M();
    workers.forEach(w => w.p.send({ cmd: 'exit' }));
    await K.sleep(800);
    const exited = S.exited;
    await S.kill(); await P.close();
    const lat = ch.flatMap(c => c.lat).sort((a, b) => a - b), q = f => (lat.length ? Math.round(lat[Math.floor(lat.length * f)] * 10) / 10 : NaN);
    const first = series.slice(0, 2), last = series.slice(-2);
    const avg = (a, k) => a.reduce((x, y) => x + y[k], 0) / Math.max(1, a.length);
    const out = {
      soak: `${SOAK} с, ${N} соединений, ${R} комнат, ${RATE} сообщ./с, переход в другую комнату каждые 250 мс в каждом процессе, ~5 % обрывов каждые 30 с`,
      moves: ch.reduce((a, c) => a + c.moves, 0), drops: ch.reduce((a, c) => a + c.drops, 0), dropFail: ch.reduce((a, c) => a + c.dropFail, 0),
      sent: ch.reduce((a, c) => a + c.sent, 0), recv: ch.reduce((a, c) => a + c.recv, 0), errors: ch.reduce((a, c) => a + c.errors, 0), unexpectedClose: ch.reduce((a, c) => a + c.closedUnexpected, 0),
      latencyMs: { p50: q(.5), p99: q(.99) }, rssFirstMb: Math.round(avg(first, 'rss')), rssLastMb: Math.round(avg(last, 'rss')), heapFirstMb: Math.round(avg(first, 'heap')), heapLastMb: Math.round(avg(last, 'heap')),
      serverInternal: fin.stats.internal, serverExited: exited, end: fin.counts, series,
    };
    console.log(JSON.stringify(out, null, 1));
    const bad = [];
    if (exited) bad.push('сервер упал');
    if (fin.stats.internal) bad.push('внутренние ошибки');
    if (out.dropFail) bad.push('не вернулись после обрыва: ' + out.dropFail);
    if (fin.counts.members !== N || fin.counts.zombies) bad.push('в конце мест ' + fin.counts.members + ' из ' + N + ', ждут ' + fin.counts.zombies);
    if (out.heapLastMb > out.heapFirstMb * 1.5 + 10) bad.push('память кучи растёт: ' + out.heapFirstMb + ' → ' + out.heapLastMb + ' МБ');
    console.log(`rt-load-test --soak: ${bad.length ? 'ПРОБЛЕМЫ: ' + bad.join('; ') : 'ok'} — ${out.moves} переходов, ${out.drops} обрывов, куча ${out.heapFirstMb} → ${out.heapLastMb} МБ, RSS ${out.rssFirstMb} → ${out.rssLastMb} МБ, p99 ${out.latencyMs.p99} мс`);
    process.exit(bad.length ? 1 : 0);
  }
  // 2) сообщения
  workers.forEach(w => w.p.send({ cmd: 'send' }));
  await K.sleep(Math.min(6000, SECS * 1000 / 3));
  const busy1 = await M();   // сервер считает процессор за 5 с
  await K.sleep(SECS * 1000 - Math.min(6000, SECS * 1000 / 3));
  const busy2 = await M();
  workers.forEach(w => w.p.send({ cmd: 'stop' }));
  const st = await Promise.all(workers.map(w => w.next('stats')));
  const lat = st.flatMap(s => s.lat).sort((a, b) => a - b);
  const q = f => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * f))] : NaN);
  const recv = st.reduce((a, s) => a + s.recv, 0), sent = st.reduce((a, s) => a + s.sent, 0);
  const expectRecv = sent * (N / R - 1);
  // 3) шторм: половина рвётся и возвращается с тем же сеансом; потом — ещё раз, но заново (без сеанса)
  workers.forEach(w => w.p.send({ cmd: 'storm', resume: true, pause: 300 }));
  const st1 = await Promise.all(workers.map(w => w.next('storm')));
  const afterStorm1 = await M();
  await K.sleep(1000);
  workers.forEach(w => w.p.send({ cmd: 'storm', resume: false, pause: 0 }));
  const st2 = await Promise.all(workers.map(w => w.next('storm')));
  await K.sleep(5500);
  const afterStorm2 = await M();
  const fin = await M();
  workers.forEach(w => w.p.send({ cmd: 'exit' }));
  await K.sleep(800);
  await S.kill(); await P.close();

  const n1 = st1.reduce((a, s) => a + s.n, 0), ok1 = st1.reduce((a, s) => a + s.ok, 0), res1 = st1.reduce((a, s) => a + s.resumed, 0);
  const n2 = st2.reduce((a, s) => a + s.n, 0), ok2 = st2.reduce((a, s) => a + s.ok, 0);
  const rssPer1000 = (idle.mem.rssMb - base.mem.rssMb) * 1000 / Math.max(1, connOk);
  const R2 = x => Math.round(x * 100) / 100;
  const out = {
    setup: (prioOk ? '[приоритет: сервер HIGH, толпы ABOVE_NORMAL] ' : '') + `${N} соединений, ${R} комнат по ${N / R}, ${RATE} сообщ./с с каждого, ${SECS} с; процессов-толп: ${W}; Node ${process.version}, ${require('os').cpus()[0].model}`,
    connect: { ok: connOk, fail: connFail, ms: connMs },
    loopIdle: idle.loopMs, loopBusy1: busy1.loopMs,
    memory: { baseRssMb: base.mem.rssMb, idleRssMb: idle.mem.rssMb, busyRssMb: busy2.mem.rssMb, rssPer1000Mb: R2(rssPer1000), heapMb: busy2.mem.heapMb },
    traffic: { inPerSec: busy2.perSec.msgIn, outPerSec: busy2.perSec.msgOut, outMbitPerSec: R2(busy2.perSec.bytesOut * 8 / 1e6), cpuPctOneCore: [busy1.cpuPct, busy2.cpuPct], loopP99ms: busy2.loopMs.p99, delivered: R2(recv / Math.max(1, expectRecv)) },
    latencyMs: { p50: R2(q(.5)), p90: R2(q(.9)), p99: R2(q(.99)), max: R2(lat[lat.length - 1] || NaN), samples: lat.length },
    storm: {
      resume: { n: n1, ok: ok1, resumed: res1, retried: st1.reduce((a, s) => a + s.retried, 0), ms: Math.max(...st1.map(s => s.ms)), p99ms: Math.max(...st1.map(s => s.p99)) },
      fresh: { n: n2, ok: ok2, retried: st2.reduce((a, s) => a + s.retried, 0), ms: Math.max(...st2.map(s => s.ms)), p99ms: Math.max(...st2.map(s => s.p99)), why: st2.map(s => s.why) },
      cpuPctAfter: afterStorm1.cpuPct, loopMaxMs: afterStorm2.loopMs.max,
    },
    errors: { worker: st.reduce((a, s) => a + s.errors, 0), unexpectedClose: st.reduce((a, s) => a + s.closedUnexpected, 0), serverInternal: fin.stats.internal, drops: fin.stats.drop },
    end: fin.counts,
  };
  console.log(JSON.stringify(out, null, 2));
  let bad = [];
  if (connFail || connOk !== N) bad.push('не все соединились');
  if (out.traffic.delivered < .98) bad.push('доставлено меньше 98 %');
  if (!(out.latencyMs.p99 < (QUICK ? 1500 : 500))) bad.push('p99 задержки слишком большая');
  if (ok1 !== n1 || res1 !== n1) bad.push('шторм с сеансом: не все продолжили сеанс');
  if (ok2 !== n2) bad.push('шторм заново: не все вошли');
  if (fin.stats.internal) bad.push('внутренние ошибки сервера');
  if (fin.counts.members !== N) bad.push('после шторма мест не ' + N + ': ' + fin.counts.members);
  console.log(`rt-load-test: ${bad.length ? 'ПРОБЛЕМЫ: ' + bad.join('; ') : 'ok'} — ${N} соединений, p50 ${out.latencyMs.p50} мс, p99 ${out.latencyMs.p99} мс, ЦП ${busy2.cpuPct}% ядра, ${R2(rssPer1000)} МБ на 1000 соединений`);
  process.exit(bad.length ? 1 : 0);
}
