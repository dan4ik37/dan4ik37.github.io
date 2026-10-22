// ═══════════════════════════════════════
//  СВОЙ СЕРВЕР РЕАЛЬНОГО ВРЕМЕНИ — D37RT (T-045, docs/SERVER.md)
// ═══════════════════════════════════════
// Комнаты игр (room.js / table.js / «Города» / «Крокодил» / Unity-игры — через GameRoom.channel; «Клеточки» и «Червячки» —
// IoKit) могут идти через свой сервер владельца (Oracle, server/), а не через Supabase Realtime (у бесплатного Supabase —
// 200 соединений, 100 сообщений в секунду и 5 presence за 30 с на человека). Supabase остаётся для базы и входа и — запасной путь.
//  • RT_URL в js/core/config.js пустой (по умолчанию) → D37RT.client() = null: всё ровно как раньше (sbClient напрямую).
//  • RT_URL задан → /health один раз за сеанс вкладки (помнит sessionStorage 30 мин) и «проба» 40 КБ на каждом новом сокете
//    (провайдеры в России режут соединения к зарубежным хостингам после ~16 КБ: такая связь не годится — тогда весь сеанс через
//    Supabase, итог помнит sessionStorage); связь «умирает» по сердцебиению дважды за 3 мин — то же самое (порезали посреди игры).
//  • D37RT.channel(name, opts) — тот же набор, что у канала supabase-js: on / subscribe(статусы) / send / track / untrack /
//    presenceState / unsubscribe, плюс D37RT.removeChannel(ch). Presence — тем же алгоритмом, что в supabase-js (формы
//    presenceState(), join / leave / sync — те же). Игры не знают, через что идёт их комната.
//  • Комната НИКОГДА не делится между своим сервером и Supabase: сервер смотрит канал комнаты в Supabase (без присутствия);
//    кто-то оказался там (нет связи с нашим сервером, старая вкладка, ?rt=0) — сервер переводит ВСЮ комнату в Supabase
//    ('mv'), а новичкам сразу отвечает «sb». Перешедшая комната остаётся в Supabase до конца (не прыгает обратно).
//  • Сервер упал → 5 с пробуем переподключиться (сеанс продолжается без потерь: сервер держит места 10 с и досылает
//    пропущенное, мы досылаем своё), не вышло → все комнаты в Supabase; комната собирается там же. На время перехода
//    presenceState() и события presence «замирают» (до 5 с), пока все прежние игроки не появятся снова — игра не видит
//    «соперник ушёл», если он просто переехал вместе с ней.
//  • TURN для WebRTC: D37RT.ice() (netplay.js) и window.D37_TURN (calls.js читает сам) — временные пароли с /turn.
//  • ?rt=0 в адресе — только Supabase в этой вкладке (?rt=1 — снова как настроено). На localhost свой адрес сервера для
//    проверок — localStorage d37_rt_url (на сайте не действует).
(() => {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  // сроки (мс); __D37RT_T — только для проверок в node (scripts/rt-test.cjs), на сайте его нет
  const TM = Object.assign({ PROBE_BYTES: 40000, PROBE_MS: 8000, HEALTH_MS: 4000, JOIN_MS: 8000, PING_MS: 4000, DEAD_MS: 9000,
    FAIL_MS: 5000, FAIL_RESTART_MS: 9000, SETTLE_MS: 5000, IDLE_MS: 120000, DOWN_MS: 60000, ACK_MS: 10000, WAIT_MS: 2500 }, root.__D37RT_T || {});
  const { PROBE_BYTES, PROBE_MS, HEALTH_MS, JOIN_MS, PING_MS, DEAD_MS, FAIL_MS, FAIL_RESTART_MS, SETTLE_MS, IDLE_MS, DOWN_MS, ACK_MS, WAIT_MS } = TM;
  const QUEUE_MAX = 100, OUTBOX_MAX = 400, OUTBOX_BYTES = 512 * 1024;
  const BAD = { stall: 15 * 60e3, conn: 3 * 60e3, health: 60e3, kicked: 30 * 60e3 };
  const SS_KEY = 'd37_rt', OFF_KEY = 'd37_rt_off', OK_KEY = 'd37_rt_ok';
  const now = () => Date.now();
  const ss = { get(k){ try { return root.sessionStorage?.getItem(k) ?? null; } catch (e) { return null; } }, set(k, v){ try { root.sessionStorage?.setItem(k, v); } catch (e) {} }, del(k){ try { root.sessionStorage?.removeItem(k); } catch (e) {} } };

  // ── Настройки ──
  function baseUrl(){
    let u = '';
    try { if (typeof RT_URL !== 'undefined' && RT_URL) u = String(RT_URL); } catch (e) {}
    try { if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(root.location?.hostname || '')) u = root.localStorage?.getItem('d37_rt_url') || u; } catch (e) {}
    u = u.trim().replace(/\/+$/, '');
    return /^https?:\/\/[^/\s]+$/i.test(u) ? u : '';
  }
  function share(){ try { const v = typeof RT_SHARE !== 'undefined' ? Number(RT_SHARE) : 1; return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1; } catch (e) { return 1; } }
  (function readSwitch(){
    try {
      const q = String(root.location?.search || '');
      if (/[?&]rt=0(&|$)/.test(q)) ss.set(OFF_KEY, '1');
      else if (/[?&]rt=1(&|$)/.test(q)) ss.del(OFF_KEY);
    } catch (e) {}
  })();
  const forcedOff = () => ss.get(OFF_KEY) === '1';
  const hasApi = () => typeof root.WebSocket === 'function' && typeof root.fetch === 'function';
  const enabled = () => !!baseUrl() && !forcedOff() && hasApi();
  const sb = () => { try { return typeof sbClient !== 'undefined' && sbClient ? sbClient : (root.sbClient || null); } catch (e) { return root.sbClient || null; } };
  // Комната и её «соседи» (у io-игр канал «<комната>-r»): решение — одно на семью
  const family = n => String(n).replace(/-r$/, '');
  function hash32(s){ let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const inShare = n => { const k = share(); return k >= 1 || hash32(family(n)) / 4294967296 < k; };

  // ── Плохая связь с нашим сервером: помним до конца срока (весь сеанс вкладки, sessionStorage) ──
  function badUntil(){ try { const o = JSON.parse(ss.get(SS_KEY) || 'null'); return o && o.u === baseUrl() && o.until > now() ? o : null; } catch (e) { return null; } }
  function markBad(why){ const ms = BAD[why] || BAD.conn; ss.set(SS_KEY, JSON.stringify({ u: baseUrl(), until: now() + ms, why })); ss.del(OK_KEY); N.stats.bad++; N.badWhy = why; }
  // /health уже отвечал «можно» в этом сеансе (30 мин) — не спрашиваем снова
  const healthOk = () => { try { const o = JSON.parse(ss.get(OK_KEY) || 'null'); return !!(o && o.u === baseUrl() && o.until > now()); } catch (e) { return false; } };

  // Комнаты, ушедшие в Supabase: пока у вкладки открыт хоть один канал этой комнаты (и её «-…» соседей) + 30 с — только Supabase.
  // Потом снова можно через свой сервер: если в Supabase ещё кто-то есть, сервер сам ответит «sb» (он смотрит канал комнаты)
  const sticky = new Map();   // семья → до какого времени (Infinity — пока открыт канал)
  function stickyOn(n){ const t = sticky.get(n); return t !== undefined && t > now(); }
  function isSticky(n){
    if (!sticky.size) return false;
    if (stickyOn(n)) return true;
    let p = n.length;
    for (;;) { p = n.lastIndexOf('-', p - 1); if (p <= 0) return false; if (stickyOn(n.slice(0, p))) return true; }
  }
  function unstickLater(fam){
    if (!sticky.has(fam)) return;
    for (const c of reg.values()) if (!c.dead && family(c.name) === fam) return;
    sticky.set(fam, now() + 30e3);
    for (const [k, t] of sticky) if (t <= now()) sticky.delete(k);
  }

  // ═══ Соединение (одно на вкладку) ═══
  const N = {
    st: 'idle', ws: null, sid: '', url: '', byI: new Map(), byR: new Map(), nextI: 0, refs: new Map(), nextRef: 0,
    outSeq: 0, outbox: [], outBytes: 0, pingT: 0, pingAt: 0, lastIn: 0, idleT: 0, failT: 0, retryT: 0, probeT: 0, tries: 0,
    downUntil: 0, restart: false, waiters: [], authT: 0, badWhy: '', helloAt: 0, deaths: [],
    stats: { connects: 0, probeMs: 0, resumes: 0, rejoins: 0, fallbacks: 0, moves: 0, stalls: 0, bad: 0, sbChannels: 0, rtChannels: 0, slowProbe: 0 },
  };
  function wsUrl(){ return N.url.replace(/^http/i, 'ws') + '/rt'; }
  function settle(ok){ const w = N.waiters; N.waiters = []; for (const f of w) { try { f(ok); } catch (e) { console.error(e); } } }
  // ok(true) — сокет готов (сразу, если уже); ok(false) — нельзя (не задан, плохая связь, сервер лежит недавно) или не дождались
  // waitMs: проба идёт дольше — эта комната идёт через Supabase сразу (проба продолжается; раздела нет — сервер сам переведёт
  // остальных, если они у нас), игра по ссылке не ждёт 8 с
  function ensure(cb, waitMs){
    if (!enabled()) { cb(false); return; }
    if (N.st === 'up') { cb(true); return; }
    if (N.st === 'down') { if (now() < N.downUntil) { cb(false); return; } N.st = 'idle'; }
    if (N.st === 'idle' && badUntil()) { cb(false); return; }
    let done = false, t = 0;
    const f = ok => { if (done) return; done = true; clearTimeout(t); cb(ok); };
    if (waitMs > 0) t = setTimeout(() => { N.waiters = N.waiters.filter(x => x !== f); N.stats.slowProbe++; f(false); }, waitMs);
    N.waiters.push(f);
    if (N.st === 'idle') start();
  }
  // Разогрев: открыли раздел игр — проверить связь заранее (раз за сеанс; к моменту входа в комнату уже ясно, куда)
  function warm(){ if (enabled() && N.st === 'idle' && !badUntil()) ensure(() => {}); }
  function start(){
    N.url = baseUrl(); N.st = 'probing'; N.sid = ''; N.tries = 0;
    const t0 = now();
    if (healthOk()) { N.helloAt = t0; open(); return; }
    let done = false;
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const tm = setTimeout(() => { if (!done) { done = true; try { ac?.abort(); } catch (e) {} first(false, 'health'); } }, HEALTH_MS);
    root.fetch(N.url + '/health', { cache: 'no-store', signal: ac?.signal }).then(r => r.ok ? r.json() : null).then(j => {
      if (done) return; done = true; clearTimeout(tm);
      if (!j || j.ok !== true || j.rooms === false || j.proto !== 1) { first(false, 'health'); return; }
      ss.set(OK_KEY, JSON.stringify({ u: N.url, until: now() + 30 * 60e3 }));
      N.helloAt = t0;
      open();
    }, () => { if (!done) { done = true; clearTimeout(tm); first(false, 'conn'); } });
  }
  function first(ok, why){
    if (N.st !== 'probing') return;
    if (ok) return;
    closeWs();
    markBad(why);
    N.st = 'idle';
    settle(false);
  }
  function open(){
    let ws;
    try { ws = new root.WebSocket(wsUrl()); } catch (e) { onLost('conn'); return; }
    N.ws = ws; N.lastIn = now();
    clearTimeout(N.probeT);
    N.probeT = setTimeout(() => { if (N.ws === ws && N.st !== 'up') { N.stats.stalls++; markBad('stall'); onLost('stall'); } }, PROBE_MS);
    ws.onopen = () => { if (N.ws === ws) raw({ t: 'hi', v: 1, sid: N.sid || undefined, pb: PROBE_BYTES }); };
    ws.onmessage = e => { if (N.ws === ws) { N.lastIn = now(); onMsg(typeof e.data === 'string' ? e.data : String(e.data)); } };
    ws.onclose = e => { if (N.ws === ws) { N.ws = null; onClose(e?.code || 0); } };
    ws.onerror = () => {};
  }
  function closeWs(code){
    const ws = N.ws; N.ws = null;
    clearTimeout(N.probeT); clearInterval(N.pingT); N.pingT = 0; N.pingAt = 0; clearTimeout(N.authT); N.authT = 0;
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close(code || 1000); } catch (e) {} }
  }
  const raw = o => { try { N.ws?.send(JSON.stringify(o)); } catch (e) {} };
  // Сообщение комнаты: с номером (q) — после переподключения сервер скажет, до какого номера получил, остальное дошлём
  function out(o){
    o.q = ++N.outSeq;
    const s = JSON.stringify(o);
    N.outbox.push([o.q, s]); N.outBytes += s.length;
    while (N.outbox.length > OUTBOX_MAX || N.outBytes > OUTBOX_BYTES) N.outBytes -= N.outbox.shift()[1].length;
    if (N.st === 'up' && N.ws) { try { N.ws.send(s); } catch (e) {} }
  }
  function acked(q){ while (N.outbox.length && N.outbox[0][0] <= q) N.outBytes -= N.outbox.shift()[1].length; }

  function onMsg(s){
    let m; try { m = JSON.parse(s); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'b': { const ch = N.byR.get(m.r); if (ch) ch._rtB(m.e, m.p); return; }
      case 'pd': { const ch = N.byR.get(m.r); if (ch) ch._rtDiff(m.j, m.l); return; }
      case 'pong': if (Number.isFinite(m.q)) acked(m.q); N.pingAt = 0; return;
      case 'ps': { const ch = N.byR.get(m.r); if (ch) ch._rtState(m.s); return; }
      case 'j': { const ch = N.byI.get(m.i); if (ch) ch._joined(m); return; }
      case 'ok': { const f = N.refs.get(m.r); if (f) { N.refs.delete(m.r); f(m.e ? 'error' : 'ok'); } return; }
      case 'mv': { const ch = N.byR.get(m.r); if (ch) { N.stats.moves++; ch._toSb('moved'); } return; }
      case 'hi': onHi(m); return;
      case 'pr': onProbe(m); return;
      case 'bye':
        if (m.e === 'restart') N.restart = true;
        else if (m.e === 'rate' || m.e === 'bad') markBad('kicked');
        else if (m.e === 'maintenance' || m.e === 'busy') markBad('health');
        return;
      case 'auth': return;
    }
  }
  function onHi(m){
    if (typeof m.sid !== 'string') return;
    const resumed = !!m.resumed && m.sid === N.sid;
    N.sid = m.sid; N.resumedNow = resumed;
    if (resumed && Number.isFinite(m.q)) acked(m.q);
    if (!resumed) { N.outSeq = 0; N.outbox = []; N.outBytes = 0; N.byR.clear(); }
  }
  function onProbe(m){
    if (typeof m.d !== 'string' || m.d.length < PROBE_BYTES) return;
    clearTimeout(N.probeT);
    const firstTime = N.st === 'probing';
    N.stats.probeMs = now() - N.helloAt;
    N.st = 'up'; N.tries = 0; N.restart = false; N.stats.connects++;
    clearTimeout(N.failT); N.failT = 0; clearTimeout(N.retryT); N.retryT = 0;
    clearInterval(N.pingT); N.pingAt = 0; N.pingT = setInterval(ping, PING_MS);
    if (!firstTime) {
      if (N.resumedNow) {   // тот же сеанс: дошлём то, что сервер не получил (после номера q), и то, что копилось, пока не было связи
        N.stats.resumes++;
        for (const [, s] of N.outbox) { try { N.ws.send(s); } catch (e) {} }
        for (const ch of [...N.byI.values()]) ch._flush();
      } else { N.stats.rejoins++; for (const ch of [...N.byI.values()]) ch._rtRejoin(); }
    }
    sendAuth();
    settle(true);
    idleCheck();
  }
  function ping(){
    if (N.st !== 'up' || !N.ws) return;
    const t = now();
    if (N.pingAt && t - N.pingAt > DEAD_MS && N.lastIn < N.pingAt) {
      // сокет «висит» (не закрылся, но молчит): второй раз за 3 мин — связь режут (как «16 КБ»), весь сеанс через Supabase
      N.stats.stalls++; N.deaths = N.deaths.filter(x => t - x < 180e3); N.deaths.push(t);
      if (N.deaths.length >= 2) markBad('stall');
      onLost('stall'); return;
    }
    if (!N.pingAt || N.lastIn >= N.pingAt) { N.pingAt = t; raw({ t: 'ping', n: t % 1e9 }); }
  }
  function onClose(code){
    clearTimeout(N.probeT); clearInterval(N.pingT); N.pingT = 0;
    if (code === 4008 || code === 4009) markBad('kicked');
    if (code === 1012) N.restart = true;
    onLost('closed');
  }
  // Связь пропала: первая попытка — честный отказ; потом — переподключение с тем же сеансом, не вышло за 5 с — всё в Supabase
  function onLost(why){
    closeWs(4000);
    if (N.st === 'probing') { first(false, why === 'stall' ? 'stall' : 'conn'); return; }
    if (N.st === 'idle' || N.st === 'down') return;
    if (!N.byI.size) { N.st = 'idle'; N.sid = ''; settle(false); return; }
    if (N.st === 'up') {
      N.st = 'lost';
      clearTimeout(N.failT);
      N.failT = setTimeout(() => fallbackAll('lost'), N.restart ? FAIL_RESTART_MS : FAIL_MS);
    }
    if (badUntil() && why === 'stall') { fallbackAll('stall'); return; }
    clearTimeout(N.retryT);
    // с разбросом: после перезапуска сервера все вкладки не стучатся в одну и ту же миллисекунду
    const d = [0, 400, 1000, 2000, 3000][Math.min(N.tries++, 4)] + Math.floor(Math.random() * (N.tries > 1 ? 400 : 250));
    N.retryT = setTimeout(() => { N.retryT = 0; if (N.st === 'lost' && !N.ws) { N.helloAt = now(); open(); } }, d);
  }
  function fallbackAll(why){
    clearTimeout(N.failT); N.failT = 0; clearTimeout(N.retryT); N.retryT = 0;
    closeWs(4000);
    N.stats.fallbacks++;
    N.st = 'down'; N.downUntil = now() + DOWN_MS; N.sid = '';
    for (const r of N.refs.values()) { try { r('ok'); } catch (e) {} }
    N.refs.clear(); N.outbox = []; N.outBytes = 0;
    for (const ch of [...N.byI.values()]) ch._toSb(why);
    settle(false);
  }
  function idleCheck(){
    clearTimeout(N.idleT);
    if (N.byI.size || N.st !== 'up') return;
    N.idleT = setTimeout(() => { if (!N.byI.size && N.st === 'up') { closeWs(1000); N.st = 'idle'; N.sid = ''; } }, IDLE_MS);
  }
  function push(o){   // с подтверждением (track / untrack)
    const r = ++N.nextRef; o.r = r;
    return new Promise(res => {
      const tm = setTimeout(() => { if (N.refs.get(r)) { N.refs.delete(r); res('timed out'); } }, ACK_MS);
      N.refs.set(r, v => { clearTimeout(tm); res(v); });
      out(o);
    });
  }
  // Вход в аккаунт: сервер проверит пароль-«пропуск» Supabase своими открытыми ключами (presence с ключом = id аккаунта → _v: 1)
  function sendAuth(){
    clearTimeout(N.authT);
    const c = sb();
    if (!c?.auth?.getSession || N.st !== 'up') return;
    c.auth.getSession().then(({ data }) => { const tok = data?.session?.access_token; if (N.st === 'up' && N.ws && tok) raw({ t: 'auth', jwt: tok }); }).catch(() => {});
    N.authT = setTimeout(sendAuth, 40 * 60e3);
  }

  // ═══ Presence — тот же алгоритм, что у supabase-js (Phoenix Presence) ═══
  const clone = o => JSON.parse(JSON.stringify(o));
  const metasOut = p => (p && Array.isArray(p.metas) ? p.metas.map(m => { const o = Object.assign({}, m); o.presence_ref = o.phx_ref; delete o.phx_ref; delete o.phx_ref_prev; return o; }) : []);
  const transform = st => { const o = {}; for (const k of Object.keys(st)) o[k] = metasOut(st[k]); return o; };
  // diff — свежий объект (из JSON.parse), его не копируем; состояние ключа — новый объект (старый уходит в событие join как «было»)
  function syncDiff(state, diff, onJoin, onLeave){
    const joins = diff.joins || {}, leaves = diff.leaves || {};
    for (const key of Object.keys(joins)) {
      const np = joins[key];
      if (!np || !Array.isArray(np.metas)) continue;
      const cur = state[key];
      let metas = np.metas.slice();
      if (cur) { const jr = new Set(metas.map(m => m.phx_ref)); metas = cur.metas.filter(m => !jr.has(m.phx_ref)).concat(metas); }
      state[key] = { metas };
      onJoin(key, cur, np);
    }
    for (const key of Object.keys(leaves)) {
      const cur = state[key], lp = leaves[key];
      if (!cur || !lp || !Array.isArray(lp.metas)) continue;
      const rm = new Set(lp.metas.map(m => m.phx_ref));
      cur.metas = cur.metas.filter(p => !rm.has(p.phx_ref));
      onLeave(key, cur, lp);
      if (!cur.metas.length) delete state[key];
    }
    return state;
  }
  function syncState(cur, next, onJoin, onLeave){
    const state = clone(cur), joins = {}, leaves = {};
    for (const key of Object.keys(state)) if (!next[key]) leaves[key] = clone(state[key]);
    for (const key of Object.keys(next)) {
      const np = next[key], cp = state[key];
      if (!np || !Array.isArray(np.metas)) continue;
      if (cp) {
        const newRefs = np.metas.map(m => m.phx_ref), curRefs = cp.metas.map(m => m.phx_ref);
        const joined = np.metas.filter(m => curRefs.indexOf(m.phx_ref) < 0), left = cp.metas.filter(m => newRefs.indexOf(m.phx_ref) < 0);
        if (joined.length) { joins[key] = clone(np); joins[key].metas = joined; }
        if (left.length) { leaves[key] = clone(cp); leaves[key].metas = left; }
      } else joins[key] = np;
    }
    return syncDiff(state, { joins, leaves }, onJoin, onLeave);
  }
  const strip = metas => JSON.stringify((metas || []).map(m => { const o = Object.assign({}, m); delete o.presence_ref; return o; }));

  // ═══ Канал ═══
  const reg = new Map();   // имя → канал (как supabase-js: то же имя — тот же объект, пока не закрыт)
  const ours = new WeakSet();   // каналы supabase-js, которые завёл сам D37RT (чужие с тем же именем не трогаем)
  class Chan {
    constructor(name, opts){
      this.name = String(name); this.topic = 'realtime:' + this.name; this.params = opts || { config: {} };
      const cfg = this.params.config || {};
      this.key = String(cfg.presence?.key || ''); this.self = !!cfg.broadcast?.self;
      this.binds = []; this.state = 'closed'; this.started = false; this.via = ''; this.sb = null;
      this.i = 0; this.r = 0; this.P = {}; this.meta = null; this.q = []; this.subCb = null; this.told = false;
      this.hold = null; this.joinT = 0; this.myKey = this.key; this.switched = false; this.dead = false;
    }
    on(type, filter, cb){
      if (typeof cb !== 'function') return this;
      const t = String(type || '').toLowerCase();
      this.binds.push([t, filter || {}, cb]);
      if (this.sb && t !== 'broadcast' && t !== 'presence') { try { this.sb.on(type, filter, cb); } catch (e) {} }
      return this;
    }
    _hasPres(){ return !!this.params.config?.presence?.enabled || this.binds.some(b => b[0] === 'presence'); }
    _emit(t, payload){
      const ev = String(payload?.event || '').toLowerCase();
      for (const [bt, f, cb] of this.binds) {
        if (bt !== t) continue;
        const want = String(f?.event || '').toLowerCase();
        if (want !== '*' && want !== ev) continue;
        try { cb(payload); } catch (e) { console.error(e); }
      }
    }
    _status(st, err){ try { this.subCb?.(st, err); } catch (e) { console.error(e); } }
    subscribe(cb){
      if (this.started || this.dead) return this;
      this.started = true; this.subCb = typeof cb === 'function' ? cb : null; this.state = 'joining';
      if (enabled()) prefetchTurn();
      // postgres_changes наш сервер пока не раздаёт (этап 2, docs/SERVER.md) — такие каналы всегда через Supabase
      const pg = this.binds.some(b => b[0] === 'postgres_changes');
      if (!enabled() || pg || isSticky(this.name) || !inShare(this.name)) { this._openSb(); return this; }
      ensure(ok => { if (this.dead || this.via) return; if (ok) this._rtJoin(); else this._openSb(); }, WAIT_MS);
      return this;
    }
    // ── свой сервер ──
    _rtJoin(){
      this.via = 'rt'; N.stats.rtChannels++;
      if (!this.i) this.i = ++N.nextI;
      N.byI.set(this.i, this);
      clearTimeout(N.idleT);
      clearTimeout(this.joinT);
      this.joinT = setTimeout(() => { if (this.via === 'rt' && !this.r && !this.dead) { this.joinT = 0; onLost('dead'); } }, JOIN_MS);
      out({ t: 'j', i: this.i, c: this.name, k: this.key || undefined, s: this.self ? 1 : 0, p: this._hasPres() ? 1 : 0 });
    }
    _joined(m){
      clearTimeout(this.joinT); this.joinT = 0;
      if (this.dead || this.via !== 'rt') return;
      if (m.home === 'sb' || (m.e && m.e !== 'full')) { this._toSb(m.home === 'sb' ? 'home' : 'err'); return; }
      if (m.e === 'full') { this.state = 'errored'; this._dropRt(); this._status('CHANNEL_ERROR', new Error('room full')); return; }
      this.r = m.r; N.byR.set(this.r, this);
      if (typeof m.k === 'string' && m.k) this.myKey = m.k;
      this.state = 'joined';
      if (this.meta) push({ t: 'tr', i: this.i, m: this.meta });
      this._flush();
      if (!this.told) { this.told = true; this._status('SUBSCRIBED'); }
    }
    _rtState(s){
      this.P = syncState(this.P, s && typeof s === 'object' ? s : {}, (k, c, n) => this._pj(k, c, n), (k, c, l) => this._pl(k, c, l));
      this._presChanged();
    }
    _rtDiff(j, l){
      this.P = syncDiff(this.P, { joins: j && typeof j === 'object' ? j : {}, leaves: l && typeof l === 'object' ? l : {} }, (k, c, n) => this._pj(k, c, n), (k, c, x) => this._pl(k, c, x));
      this._presChanged();
    }
    _pj(key, cur, np){ if (!this.hold) this._emit('presence', { event: 'join', key, currentPresences: metasOut(cur), newPresences: metasOut(np) }); }
    _pl(key, cur, lp){ if (!this.hold) this._emit('presence', { event: 'leave', key, currentPresences: metasOut(cur), leftPresences: metasOut(lp) }); }
    _presChanged(){ if (this.hold) this._checkHold(); else this._emit('presence', { event: 'sync' }); }
    _rtB(event, payload){ this._emit('broadcast', { type: 'broadcast', event, payload }); }
    _dropRt(){
      clearTimeout(this.joinT); this.joinT = 0;
      if (N.byI.get(this.i) === this) N.byI.delete(this.i);
      if (this.r && N.byR.get(this.r) === this) N.byR.delete(this.r);
      this.r = 0; this.P = {};
      idleCheck();
    }
    // Сервер начал заново (перезапуск): входим снова; presence замирает, пока не соберутся все прежние
    _rtRejoin(){
      if (this.dead || this.via !== 'rt') return;
      if (this.state === 'joined') this._startHold();
      this.r = 0; this.P = {}; this.state = 'joining';
      this._rtJoin();
    }
    // ── Supabase ──
    _toSb(why){
      if (this.dead || this.via === 'sb') return;
      sticky.set(family(this.name), Infinity);
      const wasJoined = this.state === 'joined';
      if (this.via === 'rt') {
        if (wasJoined) this._startHold();
        if (this.r && N.st === 'up') out({ t: 'l', i: this.i });
        this._dropRt();
      }
      this.switched = wasJoined || this.told;
      this.via = '';
      this.state = 'joining';
      this._openSb();
    }
    _openSb(){
      if (this.dead) return;
      this.via = 'sb'; N.stats.sbChannels++;
      const c = sb();
      if (!c?.channel) { this.state = 'errored'; this._endHold(); this._status('CHANNEL_ERROR', new Error('no supabase')); return; }
      const old = c.getChannels?.().find(x => x.topic === this.topic && x !== this.sb && ours.has(x));
      if (old) {   // наш старый канал с тем же именем ещё закрывается — supabase-js отдал бы его же
        let gone = false;
        const go = () => { if (gone) return; gone = true; if (!this.dead && this.via === 'sb' && !this.sb) this._makeSb(c); };
        Promise.resolve(c.removeChannel(old)).then(go, go);
        setTimeout(go, 2000);
        return;
      }
      this._makeSb(c);
    }
    _makeSb(c){
      let ch;
      try { ch = c.channel(this.name, this.params); } catch (e) { this.state = 'errored'; this._endHold(); this._status('CHANNEL_ERROR', e); return; }
      this.sb = ch; ours.add(ch);
      ch.on('broadcast', { event: '*' }, m => { if (this.sb === ch && !this.dead) this._emit('broadcast', m); });
      if (this._hasPres()) ch.on('presence', { event: '*' }, p => { if (this.sb !== ch || this.dead) return; if (p?.event === 'sync') this._presChanged(); else if (!this.hold) this._emit('presence', p); });
      for (const [t, f, cb] of this.binds) if (t !== 'broadcast' && t !== 'presence') { try { ch.on(t, f, cb); } catch (e) {} }
      let first = true;
      ch.subscribe((st, err) => {
        if (this.sb !== ch || this.dead) return;
        if (st === 'SUBSCRIBED') {
          this.state = 'joined';
          const quiet = first && this.switched;   // переезд: игра уже подписана — сами повторим presence и очередь
          first = false;
          if (quiet && this.meta) Promise.resolve(ch.track(this.meta)).catch(() => {});
          this._flush();
          if (quiet) return;
          this.told = true;
        } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') this._endHold();
        this._status(st, err);
      });
    }
    _flush(){
      const q = this.q; this.q = [];
      for (const m of q) this._sendNow(m);
    }
    _sendNow(msg){
      if (this.via === 'rt') { out({ t: 'b', i: this.i, e: String(msg.event), p: msg.payload }); return Promise.resolve('ok'); }
      if (this.via === 'sb' && this.sb) return this.sb.send(msg);
      return Promise.resolve('error');
    }
    // ── Поведение как у канала supabase-js ──
    send(msg, opts){
      if (this.dead) return Promise.resolve('error');
      if (!msg || msg.type !== 'broadcast' || typeof msg.event !== 'string') return Promise.resolve('error');
      if (this.state === 'joined' && ((this.via === 'sb' && this.sb) || (this.via === 'rt' && N.st === 'up'))) {
        if (this.via === 'sb') return this.sb.send(msg, opts);
        return this._sendNow(msg);
      }
      // ещё входим / связь пропала (переподключаемся или переезжаем в Supabase) — копим, отправим там, где окажемся
      if (this.q.length >= QUEUE_MAX) this.q.shift();
      this.q.push(msg);
      return Promise.resolve('ok');
    }
    track(meta){
      this.meta = meta && typeof meta === 'object' ? meta : {};
      if (this.dead) return Promise.resolve('error');
      if (this.via === 'rt' && this.state === 'joined') return push({ t: 'tr', i: this.i, m: this.meta });
      if (this.via === 'sb' && this.sb) return this.sb.track(this.meta);
      return Promise.resolve('ok');   // уйдёт при входе
    }
    untrack(){
      this.meta = null;
      if (this.dead) return Promise.resolve('ok');
      if (this.via === 'rt' && this.state === 'joined') return push({ t: 'ut', i: this.i });
      if (this.via === 'sb' && this.sb) return this.sb.untrack();
      return Promise.resolve('ok');
    }
    presenceState(){
      if (this.hold) return clone(this.hold.state);
      return this._raw();
    }
    _raw(){
      if (this.via === 'rt') return transform(this.P);
      if (this.via === 'sb' && this.sb) { try { return this.sb.presenceState() || {}; } catch (e) { return {}; } }
      return {};
    }
    // ── Переезд без «соперник ушёл»: presence замирает, пока не вернутся все, кто был (или 5 с) ──
    _startHold(){
      if (this.hold) return;
      const st = this._raw();
      if (!Object.keys(st).length) return;
      this.hold = { state: st, t: setTimeout(() => this._endHold(), SETTLE_MS) };
    }
    _checkHold(){
      const h = this.hold; if (!h) return;
      const cur = this._raw();
      if (Object.keys(h.state).every(k => cur[k] && cur[k].length >= h.state[k].length)) this._endHold();
    }
    _endHold(){
      const h = this.hold; if (!h) return;
      clearTimeout(h.t); this.hold = null;
      if (this.dead) return;
      const prev = h.state, cur = this._raw();
      let changed = false;
      for (const k of Object.keys(cur)) {
        if (!prev[k]) { changed = true; this._emit('presence', { event: 'join', key: k, currentPresences: [], newPresences: cur[k] }); }
        else if (strip(prev[k]) !== strip(cur[k])) {
          changed = true;
          this._emit('presence', { event: 'join', key: k, currentPresences: prev[k], newPresences: cur[k] });
          this._emit('presence', { event: 'leave', key: k, currentPresences: cur[k], leftPresences: prev[k] });
        }
      }
      for (const k of Object.keys(prev)) if (!cur[k]) { changed = true; this._emit('presence', { event: 'leave', key: k, currentPresences: [], leftPresences: prev[k] }); }
      if (changed) this._emit('presence', { event: 'sync' });
    }
    unsubscribe(){
      if (this.dead) return Promise.resolve('ok');
      this.dead = true;
      if (reg.get(this.name) === this) reg.delete(this.name);
      if (this.hold) { clearTimeout(this.hold.t); this.hold = null; }
      this.q = [];
      let p = Promise.resolve('ok');
      if (this.via === 'rt') { if (this.r && (N.st === 'up' || N.st === 'lost')) out({ t: 'l', i: this.i }); this._dropRt(); }
      else if (this.via === 'sb' && this.sb) { const c = sb(), ch = this.sb; this.sb = null; try { p = Promise.resolve(c ? c.removeChannel(ch) : ch.unsubscribe()).catch(() => 'error'); } catch (e) {} }
      const was = this.started;
      this.state = 'closed'; this.via = '';
      unstickLater(family(this.name));
      if (was) this._status('CLOSED');
      return p;
    }
    teardown(){ this.unsubscribe(); }
  }

  // ═══ TURN для WebRTC ═══
  const turn = { list: null, exp: 0, busy: false, badUntil: 0, mine: null };
  function prefetchTurn(){
    if (!enabled() || turn.busy || now() < turn.badUntil) return;
    if (turn.list && turn.exp - now() > 10 * 60e3) return;
    turn.busy = true;
    let done = false;
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const fin = ok => { if (done) return; done = true; turn.busy = false; if (!ok) turn.badUntil = now() + 5 * 60e3; };
    const tm = setTimeout(() => { try { ac?.abort(); } catch (e) {} fin(false); }, 5000);
    root.fetch(baseUrl() + '/turn', { cache: 'no-store', signal: ac?.signal }).then(r => r.ok ? r.json() : null).then(j => {
      clearTimeout(tm);
      const list = Array.isArray(j?.iceServers) ? j.iceServers.filter(s => s && (typeof s.urls === 'string' || Array.isArray(s.urls))).slice(0, 4) : null;
      if (!list || !list.length || !(j.ttl > 0)) { fin(false); return; }
      turn.list = list; turn.exp = now() + j.ttl * 1000;
      // calls.js берёт window.D37_TURN сам; заданный кем-то другим (свой TURN вручную) не трогаем
      if (root.D37_TURN === undefined || root.D37_TURN === turn.mine) { root.D37_TURN = list; turn.mine = list; }
      fin(true);
    }, () => { clearTimeout(tm); fin(false); });
  }
  function ice(){
    if (!enabled()) return [];
    if (!turn.list || turn.exp - now() < 10 * 60e3) prefetchTurn();
    return turn.list && turn.exp > now() + 30e3 ? turn.list : [];
  }

  // ═══ Наружу ═══
  const D = {
    enabled,
    // клиент для хуков: GameRoom.channel / IoKit — `(D37RT.client() || sbClient).channel(…)`; выключен — null (всё как раньше)
    client: () => (enabled() ? D : null),
    channel(name, opts){
      const n = String(name);
      const ex = reg.get(n);
      if (ex && !ex.dead) return ex;
      const ch = new Chan(n, opts);
      reg.set(n, ch);
      return ch;
    },
    removeChannel(ch){ return ch && typeof ch.unsubscribe === 'function' ? ch.unsubscribe() : Promise.resolve('ok'); },
    remove(ch){ return D.removeChannel(ch); },
    getChannels: () => [...reg.values()],
    ice, prefetchTurn, warm,
    stats(){
      return { enabled: enabled(), url: baseUrl(), st: N.st, sid: !!N.sid, badWhy: badUntil()?.why || '', probeMs: N.stats.probeMs, turn: !!turn.list,
        chans: [...reg.values()].map(c => ({ name: c.name, via: c.via, state: c.state, held: !!c.hold })), ...N.stats, sticky: sticky.size };
    },
    _test: { N, reg, sticky, syncState, syncDiff, transform, family, inShare, hash32, markBad, badUntil, fallbackAll, onLost, turn, feed: onMsg,
      reset(){ for (const c of [...reg.values()]) c.unsubscribe(); reg.clear(); sticky.clear(); closeWs(1000); clearTimeout(N.failT); clearTimeout(N.retryT); clearTimeout(N.idleT); clearTimeout(N.authT); clearTimeout(N.probeT); clearInterval(N.pingT);
        Object.assign(N, { st: 'idle', ws: null, sid: '', byI: new Map(), byR: new Map(), refs: new Map(), outbox: [], outBytes: 0, waiters: [], downUntil: 0, restart: false, pingT: 0, pingAt: 0 }); ss.del(SS_KEY); turn.list = null; turn.exp = 0; turn.badUntil = 0; turn.busy = false; } },
  };
  root.D37RT = D;
  try {
    root.addEventListener?.('d37:auth', () => { if (N.st === 'up') { const c = sb(); if (c?.auth?.getSession) c.auth.getSession().then(({ data }) => raw({ t: 'auth', jwt: data?.session?.access_token || '' })).catch(() => {}); } });
    root.addEventListener?.('d37:callstate', () => prefetchTurn());   // звонок начинается — TURN понадобится через секунды
    const gameRoute = h => /^#\/(games|play)(\/|$)/.test(String(h || ''));
    root.addEventListener?.('d37:route', e => { if (gameRoute(e?.detail?.to)) warm(); });
    setTimeout(() => { try { if (gameRoute(root.D37Route?.hash?.())) warm(); } catch (e) {} }, 0);
    root.addEventListener?.('pagehide', e => { if (!e?.persisted && N.ws) { closeWs(1000); } });
  } catch (e) {}
})();
