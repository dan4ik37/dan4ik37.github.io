// ═══════════════════════════════════════
//  🔗 КОМНАТЫ БЕЗ СЕРВЕРА ИГР — ПРЯМОЕ СОЕДИНЕНИЕ БРАУЗЕРОВ (T-175, владелец 20.11; движок — d37-core/spec/NET_JOIN.md §6)
// ═══════════════════════════════════════
// «Можно ли свободнее — через браузер, как торрент…»: комнату держит браузер ХОЗЯИНА, остальные соединяются с ним напрямую (WebRTC,
// канал данных: по порядку, без потерь). Свой сервер игр не нужен. Движок сам считает комнату у хозяина (d37_net::p2p::Hub) и
// идёт за ним у остальных; страница только возит байты (engine-host.js handle.net: host / join / peerJoined / peerLeft / deliver /
// onSend / onEvent) — сам движок WebRTC не трогает.
// Знакомство (предложение / ответ / ICE) — канал Supabase Realtime 'p2p-<КОД>' (broadcast, без базы); список комнат — присутствие
// в канале 'p2plobby' (запись комнаты ставит страница хозяина: код, игра, название, кто может войти, n / max, тег хозяина, сборка).
// Без таблиц и без SQL. Хозяин ушёл — комнату подхватывает следующий по порядку входа (у всех полный мир: lockstep), запись в
// списке переезжает к нему (событие движка role: host), остальные соединяются с ним сами (событие connect).
// АДРЕС (правило владельца, p2pPolicy): прямое соединение показывает IP друг другу — напрямую ТОЛЬКО взаимные друзья, оба 18+ и ни у
// кого не включено «Скрыть мой адрес»; иначе — только через сервер-посредник (TURN, iceTransportPolicy 'relay'). Админ сайта — скрыт
// по умолчанию. TURN и «Скрыть мой адрес» — из calls.js (D37Calls.iceFor / hideIp / relayOk), здесь адресов и паролей нет.
// Всё чужое (название комнаты, ники, теги) — только textContent (рисует join.js). Откат — JOIN_P2P = false (js/core/config.js).
// Тест: node scripts/t175-e2e.cjs (три страницы, свой «канал» вместо Supabase, настоящий WebRTC на 127.0.0.1).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37JoinP2P) return;
  // localhost: тест комнат на сервере игр (t174-e2e) выключает этот путь сам — d37_join_p2p = '0'
  const ON = () => { try { if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && localStorage.getItem('d37_join_p2p') === '0') return false; } catch (e) {} try { return typeof JOIN_P2P === 'undefined' ? true : !!JOIN_P2P; } catch (e) { return true; } };
  const GAMES = { klet2: 1 };
  const gameOk = g => Object.prototype.hasOwnProperty.call(GAMES, g);
  const CODE_RE = /^[A-HJKMNP-Z2-9]{6}$/;
  const TAG_RE = /^[a-z0-9]{8,16}$/;
  const BUILD_RE = /^[0-9a-f]{6,16}$/;
  const RELAY_NOTE = 'Нужен сервер-посредник — пока играть можно только с друзьями';
  const CONNECT_MS = 12000;
  const rnd = (n, abc) => { const b = new Uint8Array(n); try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < n; i++) b[i] = Math.random() * 256 | 0; } return Array.from(b, x => abc[x % abc.length]).join(''); };
  // тег этой вкладки (не номер аккаунта): переживает перезагрузку вкладки — так хозяин узнаёт вернувшегося
  const tag = (() => { let t = ''; try { t = sessionStorage.getItem('d37p2p_tag') || ''; } catch (e) {} if (!TAG_RE.test(t)) { t = rnd(12, 'abcdefghijkmnpqrstuvwxyz23456789'); try { sessionStorage.setItem('d37p2p_tag', t); } catch (e) {} } return t; })();
  const newCode = () => rnd(6, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789');
  const report = (where, msg) => { try { root.d37Err && root.d37Err('p2p:' + where, new Error(String(msg || '').slice(0, 200))); } catch (e) {} };
  const num = (v, max) => { const n = Math.floor(+v); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0; };
  const cleanName = t => { const s = String(t == null ? '' : t).replace(/_/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 24); try { return root.D37Phone?.clean ? root.D37Phone.clean(s) : s; } catch (e) { return s; } };

  // ═══ Правило адреса: 'direct' | 'relay' (одна чистая функция; таблица всех сочетаний — в t175-e2e) ═══
  // me / peer: { adult, hide, admin, hideSet ('on' | 'off' | 'auto'), friend } — friend у peer: он мой взаимный друг (мой список друзей).
  // Каждая сторона решает за себя: «relay» у меня — мои адреса не уходят никому, что бы ни прислала другая сторона.
  function p2pPolicy(me, peer){
    if (!me || !peer) return 'relay';
    const hidden = x => x.hide === true || (x.admin === true && x.hideSet !== 'off');
    return peer.friend === true && me.adult === true && peer.adult === true && !hidden(me) && !hidden(peer) ? 'direct' : 'relay';
  }
  const C = () => root.D37Calls || null;
  function meInfo(){
    const A = root.D37Age, P = root.D37Phone;
    let admin = false; try { admin = typeof currentRole !== 'undefined' && currentRole === 'admin'; } catch (e) {}
    let uid = ''; try { uid = typeof currentUser !== 'undefined' && currentUser && currentUser.id || (root.__d37P2PUid ? String(root.__d37P2PUid()) : ''); } catch (e) {}   // __d37P2PUid — тест (без входа)
    const hideSet = P && P.set && P.set.hide || 'auto';
    // «Скрыть мой адрес» — как в звонках (T-141: 'auto' — скрыт всем, кроме 18+); без calls.js — скрыт
    let hide = true; try { hide = C() && C().hideIp ? !!C().hideIp() : (hideSet === 'on' || (hideSet === 'auto' && !(A && A.group && A.group() === 'adult'))); } catch (e) {}
    return { adult: !!(A && A.group && A.group() === 'adult'), hide, admin, hideSet, uid: /^[0-9a-f-]{36}$/.test(uid) ? uid : '' };
  }
  let frCache = { at: 0, ids: null };
  async function friendOf(uid){
    if (!uid) return false;
    const P = root.D37Phone; if (!P || !P.friends) return false;
    if (!frCache.ids || Date.now() - frCache.at > 60000) {
      try { const f = await P.friends(false); frCache = { at: Date.now(), ids: new Set((f && f.list) || []) }; } catch (e) { frCache = { at: Date.now(), ids: new Set() }; }
    }
    return frCache.ids.has(uid);
  }
  async function needCalls(){ try { if (!C() && root.D37Phone && root.D37Phone.need) await root.D37Phone.need('calls'); } catch (e) {} }
  async function iceFor(relay){
    if (root.__d37P2PIce) return root.__d37P2PIce(relay);   // тест: свои настройки (без внешних STUN / TURN)
    await needCalls();
    try { if (C() && C().iceFor) return await C().iceFor(relay); } catch (e) { report('ice', e && e.message); }
    return { iceServers: [], iceTransportPolicy: relay ? 'relay' : 'all', relay, ok: !relay };
  }
  // есть ли TURN: calls.js (если загружен) или то, что уже выдал свой сервер (D37RT, window.D37_TURN) — без calls.js тоже честно
  const hasTurn = l => Array.isArray(l) && l.some(x => [].concat(x && x.urls || []).some(u => /^turns?:/i.test(String(u))));
  const relayOk = () => { try { if (root.__d37P2PRelayOk) return !!root.__d37P2PRelayOk(); if (C() && C().relayOk && C().relayOk()) return true; return hasTurn(root.D37_TURN) || hasTurn(root.D37RT && root.D37RT.ice ? root.D37RT.ice() : null); } catch (e) { return false; } };

  // ═══ Каналы Realtime (тест подставляет свой: __d37P2PChannel) ═══
  function channel(name, key){
    if (root.__d37P2PChannel) return root.__d37P2PChannel(name, key);
    if (typeof sbClient === 'undefined' || !sbClient) return null;
    return sbClient.channel(name, { config: { presence: { key }, broadcast: { self: false } } });
  }
  function unsub(ch){ try { if (!root.__d37P2PChannel && typeof sbClient !== 'undefined' && sbClient && sbClient.removeChannel) sbClient.removeChannel(ch); else ch.unsubscribe && ch.unsubscribe(); } catch (e) {} }

  // ═══ Список комнат: присутствие в 'p2plobby' (запись ставит хозяин; ≤ 1 раза в 7 с — предел Supabase 5 за 30 с) ═══
  const lob = { ch: null, ok: false, rows: new Map(), mine: null, trackAt: 0, trackT: 0, waiters: new Set() };
  function lobbyOpen(){
    if (lob.ch) return lob.ch;
    const ch = channel('p2plobby', tag); if (!ch) return null;
    lob.ch = ch;
    ch.on('presence', { event: 'sync' }, lobSync);
    ch.subscribe(s => { if (s === 'SUBSCRIBED') { lob.ok = true; if (lob.mine) lobTrack(true); lobSync(); } });
    return ch;
  }
  // запись комнаты от чужой страницы — не доверяем ни одному полю
  function entry(m){
    if (!m || typeof m !== 'object') return null;
    const code = String(m.code || ''), game = String(m.game || ''), host = String(m.host || '');
    if (!CODE_RE.test(code) || !gameOk(game) || !TAG_RE.test(host)) return null;
    const max = num(m.max, 16) || 16;
    return { code, game, host, name: cleanName(m.name || ''), vis: ['open', 'friends', 'code'].includes(m.vis) ? m.vis : 'open', n: num(m.n, 99), max,
      ages: ['all', 'kids', 'adults'].includes(m.ages) ? m.ages : 'all', v: BUILD_RE.test(String(m.v || '')) ? String(m.v) : '', at: num(m.at, 9e15) };
  }
  function lobSync(){
    let s = {}; try { s = lob.ch.presenceState() || {}; } catch (e) {}
    const rows = new Map();
    for (const metas of Object.values(s)) {
      for (const m of (metas || []).slice(-1)) {
        const e = entry(m); if (!e) continue;
        const old = rows.get(e.code);
        if (!old || e.at >= old.at) rows.set(e.code, e);   // во время переезда хозяина — самая свежая запись
      }
    }
    lob.rows = rows;
    for (const w of [...lob.waiters]) w();
  }
  function lobTrack(now){
    if (!lob.ch || !lob.ok) return;
    clearTimeout(lob.trackT);
    const wait = now ? 0 : Math.max(0, 7000 - (Date.now() - lob.trackAt));
    lob.trackT = setTimeout(() => {
      lob.trackAt = Date.now();
      try { const r = lob.mine ? lob.ch.track(lob.mine) : lob.ch.untrack(); r && r.catch && r.catch(() => {}); } catch (e) {}
    }, wait);
  }
  const waitFor = (test, ms) => new Promise(res => {
    const v0 = test(); if (v0) { res(v0); return; }
    const w = () => { const v = test(); if (v) { lob.waiters.delete(w); clearTimeout(t); res(v); } };
    const t = setTimeout(() => { lob.waiters.delete(w); res(test() || null); }, ms);
    lob.waiters.add(w);
  });
  // список: строки как у сервера игр (join.js row()); null — канал не на связи
  async function list(game){
    if (!lobbyOpen()) return null;
    if (!lob.ok) await waitFor(() => lob.ok, 4000);
    if (!lob.ok) return null;
    await new Promise(r => setTimeout(r, 300));   // первый снимок присутствия
    return [...lob.rows.values()].filter(e => e.vis === 'open' && (!game || e.game === game)).slice(0, 200)
      .map(e => ({ game: e.game, id: '', code: e.code, vis: e.vis, players: e.n, max: e.max, mode: '', map: '', name: e.name, ages: e.ages, region: '', full: e.n >= e.max, p2p: true }));
  }
  async function find(code, ms){
    if (!lobbyOpen()) return null;
    return waitFor(() => lob.rows.get(code) || null, ms || 8000);
  }
  async function quick(game){
    const l = await list(game);
    if (!l) return null;
    const best = l.filter(r => !r.full).sort((a, b) => b.players - a.players)[0];
    return best ? { code: best.code, fresh: false, players: best.players } : { code: newCode(), fresh: true, players: 0 };
  }

  // ═══ Комната: соединения WebRTC (канал данных 'room') ═══
  let room = null;   // { h, game, code, host, sig, conns: Map(tag → c), links: Map(link → c), next, build, meta, toast }
  function sigOpen(r){
    const ch = channel('p2p-' + r.code, tag); if (!ch) return null;
    ch.on('broadcast', { event: 'sig' }, msg => { const d = msg && (msg.payload || msg); if (room === r) onSig(r, d).catch(e => report('sig', e && e.message)); });
    ch.subscribe(s => { if (s === 'SUBSCRIBED') { r.sigOk = true; for (const f of r.sigQ.splice(0)) f(); } });
    return ch;
  }
  function sigSend(r, to, t, d, extra){
    const payload = Object.assign({ t, from: tag, to, d }, extra || {});
    const go = () => { try { const x = r.sig.send({ type: 'broadcast', event: 'sig', payload }); x && x.catch && x.catch(() => {}); } catch (e) {} };
    if (r.sigOk) go(); else r.sigQ.push(go);
  }
  const pubInfo = () => { const m = meInfo(); return { uid: m.uid, adult: m.adult, hide: m.hide || (m.admin && m.hideSet !== 'off') }; };
  async function policyFor(info){
    const i = info && typeof info === 'object' ? info : {};
    const uid = /^[0-9a-f-]{36}$/.test(String(i.uid || '')) ? String(i.uid) : '';
    return p2pPolicy(meInfo(), { adult: i.adult === true, hide: i.hide === true, friend: await friendOf(uid) });
  }
  function closeConn(r, c, why){
    if (c.dead) return;
    c.dead = true; clearTimeout(c.timer); clearTimeout(c.dropT);
    if (r.conns.get(c.tag) === c) r.conns.delete(c.tag);
    if (c.link) { r.links.delete(c.link); try { r.h.net.peerLeft(c.link); } catch (e) {} }
    try { c.dc && c.dc.close(); } catch (e) {}
    try { c.pc && c.pc.close(); } catch (e) {}
    if (why && !c.link && c.migr) { try { r.h.net.failed(c.tag); } catch (e) {} }
    if (why && !c.link && !c.migr && !r.host) fail(r, c);
  }
  // не соединились с хозяином при входе: понятная причина
  function fail(r, c){
    if (c.relay && !relayOk()) say(r, RELAY_NOTE);
    else say(r, 'Не получилось соединиться с хозяином комнаты — играешь с ботами');
    r.failed = c.relay && !relayOk() ? 'relay' : 'connect';
  }
  function say(r, t){ try { r.toast && r.toast(t); } catch (e) {} }
  function wire(r, c, dc){
    c.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      if (c.dead || room !== r) return;
      clearTimeout(c.timer);
      c.link = r.next++;
      r.links.set(c.link, c);
      try { r.h.net.peerJoined(c.link, c.tag); } catch (e) {}
    };
    dc.onmessage = e => { if (c.link && !c.dead && room === r) { try { r.h.net.deliver(c.link, new Uint8Array(e.data)); } catch (er) {} } };
    dc.onclose = () => closeConn(r, c, 'closed');
    dc.onerror = () => closeConn(r, c, 'error');
  }
  async function makePc(r, c){
    const cfg = await iceFor(c.relay);
    if (c.relay && !cfg.ok) { closeConn(r, c, 'relay'); return null; }
    const pc = new RTCPeerConnection({ iceServers: cfg.iceServers || [], iceTransportPolicy: c.relay ? 'relay' : 'all' });
    c.pc = pc;
    pc.onicecandidate = ev => {
      if (!ev.candidate) return;
      if (c.relay && !/ typ relay/.test(ev.candidate.candidate || '')) return;   // как в звонках: свой адрес не отдаём никогда
      sigSend(r, c.tag, 'ice', ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate);
    };
    // оборвалось (вкладку закрыли, пропала сеть): ждём 5 с — вернулось ли, иначе соединение закрыто (движок узнаёт peerLeft)
    pc.onconnectionstatechange = () => { const cs = pc.connectionState; clearTimeout(c.dropT); if (cs === 'failed' || cs === 'closed') closeConn(r, c, cs); else if (cs === 'disconnected') c.dropT = setTimeout(() => { if (pc.connectionState === 'disconnected') closeConn(r, c, 'lost'); }, 5000); };
    return pc;
  }
  // к хозяину (вход; или к новому хозяину после переезда — migr)
  async function connect(r, to, migr){
    if (!TAG_RE.test(to) || to === tag) return;
    const old = r.conns.get(to); if (old && !old.dead) return;
    const c = { tag: to, migr: !!migr, relay: true, link: 0, cands: [], knock: true };
    r.conns.set(to, c);
    c.timer = setTimeout(() => closeConn(r, c, 'timeout'), CONNECT_MS);
    // сначала «тук-тук»: правило адреса нужно до соединения, а данные другой стороны (друг? 18+? скрыт?) приходят в ответе
    sigSend(r, to, 'knock', null, { info: pubInfo() });
  }
  async function offer(r, c, info){
    c.knock = false;
    c.relay = (await policyFor(info)) === 'relay';
    const pc = await makePc(r, c); if (!pc || c.dead) return;
    wire(r, c, pc.createDataChannel('room', { ordered: true }));
    const o = await pc.createOffer();
    await pc.setLocalDescription(o);
    sigSend(r, c.tag, 'offer', { type: o.type, sdp: o.sdp }, { info: pubInfo() });
  }
  async function onSig(r, d){
    if (!d || typeof d !== 'object' || d.to !== tag || !TAG_RE.test(String(d.from || '')) || d.from === tag) return;
    const from = String(d.from);
    if (d.t === 'knock') { sigSend(r, from, 'info', null, { info: pubInfo() }); return; }
    if (d.t === 'info') { const c = r.conns.get(from); if (c && c.knock && !c.dead) await offer(r, c, d.info); return; }
    if (d.t === 'offer' && d.d && d.d.type === 'offer' && typeof d.d.sdp === 'string' && d.d.sdp.length < 20000) {
      // принимаем всегда (во время переезда хозяина нас могут позвать раньше, чем движок решил, что хозяин теперь мы)
      const old = r.conns.get(from); if (old) closeConn(r, old, '');
      if (r.links.size >= 15) return;
      const c = { tag: from, relay: (await policyFor(d.info)) === 'relay', link: 0, cands: [] };
      r.conns.set(from, c);
      c.timer = setTimeout(() => closeConn(r, c, 'timeout'), CONNECT_MS);
      const pc = await makePc(r, c);
      if (!pc || c.dead) { sigSend(r, from, 'nope', c.relay ? 'relay' : 'busy'); return; }
      pc.ondatachannel = ev => { if (ev.channel && ev.channel.label === 'room') wire(r, c, ev.channel); };
      await pc.setRemoteDescription({ type: 'offer', sdp: d.d.sdp });
      for (const x of c.cands.splice(0)) { try { await pc.addIceCandidate(x); } catch (e) {} }
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      sigSend(r, from, 'answer', { type: ans.type, sdp: ans.sdp }, { info: pubInfo() });
    } else if (d.t === 'answer' && d.d && d.d.type === 'answer' && typeof d.d.sdp === 'string' && d.d.sdp.length < 20000) {
      const c = r.conns.get(from); if (!c || !c.pc || c.dead) return;
      await c.pc.setRemoteDescription({ type: 'answer', sdp: d.d.sdp });
      for (const x of c.cands.splice(0)) { try { await c.pc.addIceCandidate(x); } catch (e) {} }
    } else if (d.t === 'ice' && d.d && typeof d.d === 'object') {
      const c = r.conns.get(from); if (!c || c.dead) return;
      const cand = { candidate: String(d.d.candidate || '').slice(0, 600), sdpMid: d.d.sdpMid == null ? null : String(d.d.sdpMid).slice(0, 16), sdpMLineIndex: d.d.sdpMLineIndex == null ? null : num(d.d.sdpMLineIndex, 16) };
      if (c.relay && cand.candidate && !/ typ relay/.test(cand.candidate)) return;
      if (c.pc && c.pc.remoteDescription) { try { await c.pc.addIceCandidate(cand); } catch (e) {} } else c.cands.push(cand);
    } else if (d.t === 'nope') {
      const c = r.conns.get(from); if (c && !c.link) { if (d.d === 'relay') c.relay = true; closeConn(r, c, 'nope'); }
    }
  }
  function myEntry(r, patch){
    const m = Object.assign({}, lob.mine || {}, r.meta || {}, patch || {});
    return { code: r.code, game: r.game, host: tag, name: cleanName(m.name || ''), vis: ['open', 'friends', 'code'].includes(m.vis) ? m.vis : 'open', n: num(m.n, 99) || 1, max: num(m.max, 16) || 16, ages: m.ages === 'kids' ? 'kids' : 'all', v: r.build || '', at: Date.now() };
  }
  function becameHost(r){
    if (r.host) return;
    r.host = true;
    const old = lob.rows.get(r.code);
    lob.mine = myEntry(r, old ? { name: old.name, vis: old.vis, max: old.max, ages: old.ages, n: Math.max(1, old.n - 1) } : {});
    lobTrack(true);
  }

  // ═══ Наружу (join.js зовёт, когда нет сервера игр) ═══
  // t: { game, code }; o: { host, meta: { name, vis, max, ages }, toast(text) }
  async function enter(h, t, o){
    o = o || {};
    if (!h || !h.net || typeof h.net.ok !== 'function' || !h.net.ok()) { o.toast && o.toast('Комнаты без сервера появятся с новой версией игры — пока играешь с ботами'); return false; }
    if (!gameOk(t.game) || !CODE_RE.test(t.code)) return false;
    leave();
    let build = '';
    try { const g = root.D37Hub && root.D37Hub.resolveGame ? await root.D37Hub.resolveGame(t.game) : null; build = String(g && g.build && g.build.id || ''); } catch (e) {}
    const r = { h, game: t.game, code: t.code, host: !!o.host, conns: new Map(), links: new Map(), next: 1, build: BUILD_RE.test(build) ? build : '', meta: o.meta || null, toast: o.toast, sigOk: false, sigQ: [], failed: '' };
    room = r;
    lobbyOpen();
    r.sig = sigOpen(r);
    if (!r.sig || !lob.ch) { say(r, 'Нет связи с сайтом — комнаты не работают, играешь с ботами'); room = null; return false; }
    h.net.onSend((link, bytes) => { const c = r.links.get(link); if (c && c.dc && c.dc.readyState === 'open') { try { c.dc.send(bytes); } catch (e) {} } });
    h.net.onEvent(ev => {
      if (room !== r || !ev) return;
      if (ev.ev === 'connect' && TAG_RE.test(String(ev.tag || ''))) connect(r, String(ev.tag), true).catch(e => report('connect', e && e.message));
      else if (ev.ev === 'role' && ev.role === 'host') becameHost(r);
      else if (ev.ev === 'closed') say(r, /hash/.test(String(ev.why || '')) ? 'Твоя игра разошлась с комнатой — тебя отключили' : /took you out/.test(String(ev.why || '')) ? 'Хозяин убрал тебя из комнаты' : /full/.test(String(ev.why || '')) ? 'Комната полная' : 'Комната закрылась');
    });
    if (r.host) {
      h.net.host(t.game, t.code, '', tag);
      lob.mine = myEntry(r, Object.assign({ n: 1 }, r.meta || {}));
      if (lob.ok) lobTrack(true);
      return true;
    }
    const e = await find(t.code, 8000);
    if (room !== r) return false;
    if (!e) { say(r, 'Комната не найдена — может, она уже закрылась. Пока играешь с ботами'); r.failed = 'missing'; return false; }
    if (e.v && r.build && e.v !== r.build) { say(r, 'У хозяина другая версия игры — обновите страницу оба'); r.failed = 'version'; return false; }
    if (e.n >= e.max) { say(r, 'Комната полная'); r.failed = 'full'; return false; }
    h.net.join(t.game, t.code, '', tag, e.host);
    await connect(r, e.host, false);
    return true;
  }
  // presence движка (игроков, кто может войти) → запись в списке, если я хозяин
  function presence(cur){
    const r = room; if (!r || !r.host || !cur || cur.session !== r.code) return;
    const next = myEntry(r, { n: cur.n, max: cur.max, vis: cur.vis });
    const was = lob.mine;
    lob.mine = next;
    if (!was || was.n !== next.n || was.max !== next.max || was.vis !== next.vis || was.name !== next.name) lobTrack(false);
  }
  function meta(m){
    const r = room; if (!r) return;
    r.meta = Object.assign({}, r.meta || {}, m || {});
    if (r.host) { lob.mine = myEntry(r); lobTrack(false); }
  }
  function leave(){
    const r = room; if (!r) return;
    room = null;
    for (const c of [...r.conns.values()]) closeConn(r, c, '');
    if (r.sig) unsub(r.sig);
    if (lob.mine) { lob.mine = null; lobTrack(true); }
  }
  function state(){
    const r = room;
    return r ? { code: r.code, host: r.host, failed: r.failed, links: r.links.size, conns: [...r.conns.values()].map(c => ({ tag: c.tag, open: !!c.link, relay: !!c.relay })) } : null;
  }

  root.D37JoinP2P = { on: ON, tag, p2pPolicy, meInfo, list, find, quick, enter, presence, meta, leave, state, newCode, relayOk, RELAY_NOTE, get lobby(){ return lob; } };
})();
