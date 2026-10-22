// Общее для проверок своего сервера (T-045): где лежат пакеты, запуск server/rt отдельным процессом, «сырой» клиент протокола.
// Пакеты не в репозитории (как three/Rapier/PGlite в ci-run.cjs): ws@8.21.3 и @supabase/supabase-js@2.117.2 —
//   npm install --prefix <папка> --no-save --ignore-scripts ws@8.21.3 @supabase/supabase-js@2.117.2   и DEPS_DIR=<папка>
const fs = require('fs'), path = require('path'), net = require('net');
const { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');

function deps(){
  for (const d of [process.env.RT_DEPS, process.env.DEPS_DIR].filter(Boolean)) {
    const nm = path.join(d, 'node_modules');
    if (fs.existsSync(path.join(nm, 'ws', 'package.json'))) {
      const umd = path.join(nm, '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
      return { nm, WS: require(path.join(nm, 'ws')), umd: fs.existsSync(umd) ? umd : '' };
    }
  }
  return null;
}
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

// Сервер отдельным процессом (как в контейнере): env — настройки server/rt/src/config.js
async function startServer(D, env = {}, o = {}){
  const port = env.RT_PORT && env.RT_PORT !== '0' ? +env.RT_PORT : await freePort();
  const out = [];
  const p = spawn(process.execPath, [...(o.nodeArgs || []), path.join(SITE, 'server/rt/src/server.js')], {
    env: { ...process.env, NODE_PATH: D.nm, LOG_LEVEL: 'info', ALLOW_NO_ORIGIN: '1', WATCH: '0', ...env, RT_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const S = { p, port, out, url: 'http://127.0.0.1:' + port, ws: 'ws://127.0.0.1:' + port + '/rt', exited: false, code: null };
  p.stdout.on('data', d => { out.push(String(d)); if (out.length > 4000) out.splice(0, 2000); });
  p.stderr.on('data', d => { out.push('[stderr] ' + String(d)); });
  p.on('exit', code => { S.exited = true; S.code = code; });
  const t0 = Date.now();
  for (;;) {   // готов — когда отвечает /health (журнал может быть приглушён LOG_LEVEL)
    if (out.join('').includes('d37-rt listening')) break;
    try { const r = await fetch(S.url + '/health'); await r.text(); if (r.status === 200) break; } catch (e) {}
    if (S.exited || Date.now() - t0 > 10000) throw new Error('server did not start: ' + out.join('').slice(-800));
    await new Promise(r => setTimeout(r, 25));
  }
  S.kill = sig => new Promise(res => { if (S.exited) return res(); p.once('exit', () => res()); try { p.kill(sig || 'SIGKILL'); } catch (e) { res(); } });
  S.metrics = async token => (await fetch(S.url + '/metrics', { headers: { Authorization: 'Bearer ' + token } })).json();
  S.log = () => out.join('');
  return S;
}

// «Сырой» клиент протокола v1: ждать сообщение по условию, считать всё пришедшее
function rawClient(D, url, o = {}){
  const headers = {};
  if (o.xff) headers['x-forwarded-for'] = o.xff;
  const ws = new D.WS(url, { origin: o.origin === undefined ? 'http://localhost:5500' : o.origin || undefined, headers, perMessageDeflate: false });
  const C = { ws, msgs: [], closed: null, code: 0, n: 0 };
  const waiters = [];
  C.open = new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); ws.once('unexpected-response', (req, r) => rej(new Error('HTTP ' + r.statusCode))); });
  C.open.catch(() => {});
  C.closed = new Promise(res => ws.once('close', code => { C.code = code; res(code); }));
  ws.on('error', () => {});
  ws.on('message', (d, bin) => {
    C.n++;
    let m; try { m = JSON.parse(String(d)); } catch (e) { m = { t: '?raw', d: String(d).slice(0, 80) }; }
    if (o.keep !== false) C.msgs.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].f(m)) { const w = waiters.splice(i, 1)[0]; clearTimeout(w.t); w.res(m); }
  });
  C.send = x => { try { ws.send(typeof x === 'string' ? x : JSON.stringify(x)); } catch (e) {} };
  C.wait = (f, ms = 3000) => {
    const hit = C.msgs.find(f);
    if (hit) return Promise.resolve(hit);
    return new Promise(res => { const w = { f, res, t: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); res(null); }, ms) }; waiters.push(w); });
  };
  C.hi = async (extra = {}) => { await C.open; C.send({ t: 'hi', v: 1, ...extra }); return C.wait(m => m.t === 'hi'); };
  C.close = () => { try { ws.close(1000); } catch (e) {} };
  C.kill = () => { try { ws.terminate(); } catch (e) {} };
  return C;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms = 5000, step = 20){ const t0 = Date.now(); for (;;) { let v; try { v = await f(); } catch (e) { v = false; } if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(step); } }

module.exports = { SITE, deps, freePort, startServer, rawClient, sleep, until };
