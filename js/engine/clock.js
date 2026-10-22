// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — часы мира (D37E.clock): одно время на всех игроков — по часам сервера (Supabase RPC world_now(), planet.sql),
//  а не по часам телефона (они бывают сбиты на минуты). Небо, рельсы планет и лун (js/engine/orbit.js, system.js) — от C.t().
//  План — docs/plans/planet-space.md §2.1 (T-079 PS-1).
// ═══════════════════════════════════════
// C.now() — мс с 1970 (Date.now() + поправка); C.t() — секунды мира от C.EPOCH (2026-01-01 00:00 UTC); C.tOf(ms), C.msOf(t).
// C.start() → stop(): сверка сразу, потом раз в 10 мин и при возврате на вкладку (если она была скрыта дольше минуты); кто
// позвал start — тот зовёт stop (счётчик на страницу: часы общие для всех игр).
// Сверка: 3 запроса world_now() подряд, у каждого поправка = время сервера + полпути (RTT/2) − свои часы в миг ответа; берём
// среднюю из трёх (медиану). Ошибка 50 мс — это ~75 u на орбите: для неба незаметно (стыковка — по относительным скоростям).
// planet.sql ещё не запущен (PGRST202) — часы устройства (state 'nosql'), без ошибок и без повторов до конца получаса; нет сети —
// state 'local', повтор через 30 с, 1, 2… 10 мин. Поправка помнится во вкладке 10 мин (sessionStorage d37_clock) — после
// перезагрузки небо не прыгает.
// C.feed(serverMs, rtt, src) — уточнить с другого источника (свой сервер T-045, хозяин комнаты net.js): берётся, если путь
// короче; C.on(f) — поправка сменилась (f(C)); C.state: 'local' | 'sync' | 'nosql'.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  if (E.clock) return;
  const EPOCH = 1767225600000;   // 2026-01-01T00:00:00Z (= D37E.orbit.EPOCH_MS)
  const C = { EPOCH, off: 0, rtt: 0, state: 'local', src: '', at: 0, n: 0, err: '' };
  const lis = new Set();
  C.now = () => Date.now() + C.off;
  C.t = () => (Date.now() + C.off - EPOCH) / 1000;
  C.tOf = ms => (ms - EPOCH) / 1000;
  C.msOf = t => EPOCH + t * 1000;
  C.on = f => { lis.add(f); return () => lis.delete(f); };
  const ss = {
    get(k){ try { return JSON.parse(root.sessionStorage?.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v){ try { root.sessionStorage?.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  function set(off, rtt, src){
    C.off = off; C.rtt = rtt; C.src = src; C.at = Date.now(); C.n++; C.state = 'sync';
    ss.set('d37_clock', { off, rtt, at: C.at });
    for (const f of lis) { try { f(C); } catch (e) {} }
  }
  // поправка из этой вкладки (до 10 мин) — сразу; сервер без planet.sql (до 30 мин) — не спрашиваем
  { const k = ss.get('d37_clock'); if (k && Number.isFinite(k.off) && Date.now() - k.at < 600000 && Date.now() >= k.at) { C.off = k.off; C.rtt = k.rtt || 0; C.at = k.at; C.state = 'sync'; C.src = 'cache'; } }
  const noSql = () => { const k = ss.get('d37_clock_nosql'); return !!(k && Date.now() - k < 1800000 && Date.now() >= k); };
  if (noSql() && C.state !== 'sync') C.state = 'nosql';
  // запрос — обычный fetch без SDK (как push-pwa.js); в проверках — C._fetch
  const sbUrl = () => { try { if (typeof SB_URL !== 'undefined' && SB_URL) return SB_URL; } catch (e) {} return root.SB_URL || 'https://zdisuowyjgqirhvcyjfq.supabase.co'; };
  const sbKey = () => { try { if (typeof SB_KEY !== 'undefined' && SB_KEY) return SB_KEY; } catch (e) {} return root.SB_KEY || 'sb_publishable_55GhvJbDxDQA1JEawZRQ6g_ozx_cgMV'; };
  const pnow = () => root.performance && root.performance.now ? root.performance.now() : Date.now();
  async function sample(){
    const f = C._fetch || root.fetch;
    if (typeof f !== 'function') throw new Error('нет fetch');
    const t0 = pnow();
    const r = await f(sbUrl() + '/rest/v1/rpc/world_now', { method: 'POST', headers: { apikey: sbKey(), 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' });
    const t1 = pnow(), wall = Date.now();
    if (!r.ok) {
      let j = null; try { j = await r.json(); } catch (e) {}
      const er = new Error('world_now: ' + r.status); er.code = (j && j.code) || ''; er.status = r.status; throw er;
    }
    const v = Number(await r.json());
    if (!Number.isFinite(v) || v < 1.7e12 || v > 4.1e12) throw new Error('world_now: не время');
    const rtt = Math.max(0, t1 - t0);
    return { off: v + rtt / 2 - wall, rtt };
  }
  let busy = null, tm = 0, refs = 0, fails = 0, hidAt = 0;
  C.sync = () => busy || (busy = (async () => {
    try {
      const s = [];
      for (let k = 0; k < 3; k++) s.push(await sample());
      s.sort((a, b) => a.off - b.off);
      set(s[1].off, s[1].rtt, 'sb'); fails = 0; C.err = '';
      return true;
    } catch (e) {
      C.err = String((e && e.message) || e);
      if (e && (e.code === 'PGRST202' || e.status === 404)) { C.state = 'nosql'; ss.set('d37_clock_nosql', Date.now()); }
      else { fails++; if (C.state !== 'sync') C.state = 'local'; }
      return false;
    } finally { busy = null; }
  })());
  // уточнение с другого источника (T-045, net.js): время сервера в миг ответа и путь туда-обратно
  C.feed = (serverMs, rtt = 0, src = 'feed') => {
    if (!Number.isFinite(serverMs) || !Number.isFinite(rtt) || rtt < 0) return false;
    if (C.state === 'sync' && C.src !== 'cache' && rtt >= C.rtt) return false;
    set(serverMs + rtt / 2 - Date.now(), rtt, src);
    return true;
  };
  const plan = ms => { clearTimeout(tm); tm = refs > 0 ? setTimeout(tick, Math.max(1000, ms)) : 0; };
  async function tick(){
    tm = 0;
    if (refs <= 0 || C.state === 'nosql' && noSql()) return;
    const ok = await C.sync();
    if (C.state === 'nosql') return;
    plan(ok ? 600000 : Math.min(600000, 30000 * Math.pow(2, Math.min(5, fails - 1))));
  }
  const vis = () => {
    if (root.document.hidden) { hidAt = Date.now(); return; }
    if (hidAt && Date.now() - hidAt > 60000 && C.state !== 'nosql') { clearTimeout(tm); tick(); }
    hidAt = 0;
  };
  C.start = () => {
    refs++;
    if (refs === 1) {
      root.document?.addEventListener?.('visibilitychange', vis);
      const age = Date.now() - C.at;
      if (C.state === 'nosql') { /* до конца получаса — часы устройства */ }
      else if (C.state !== 'sync' || C.src === 'cache' || age > 600000) tick(); else plan(600000 - age);
    }
    let done = false;
    return () => {
      if (done) return; done = true;
      if (--refs <= 0) { refs = 0; clearTimeout(tm); tm = 0; root.document?.removeEventListener?.('visibilitychange', vis); }
    };
  };
  C.users = () => refs;
  E.clock = C;
})();
