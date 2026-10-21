// ═══════════════════════════════════════
//  ЗВОНКИ И ГОЛОС (D37Calls) — звонок другу, голосовая компания (до 6 человек), голосовые каналы (сервер «Денчик37» и
//  сообщества). Живёт сам по себе, не внутри игры: из мира — в партию и обратно, с сервера мира на другой — разговор не
//  рвётся. Пока идёт разговор — на любой странице плашка «📞 02:13 · 🎙 · ✕».
// ═══════════════════════════════════════
// Звук — WebRTC напрямую между браузерами (каждый с каждым, «сетка»), STUN Google и Cloudflare (как netplay.js). Знакомство
// (предложение/ответ/ICE) — Supabase Realtime: комната = секретный код (звонок, компания) или тема голосового канала (её и
// пропуск выдаёт база, community.sql). Все сообщения подписаны ключом ECDSA своей вкладки (подделать чужое нельзя).
// Вызов друга = личное сообщение со ссылкой #/phone/call/<код> — ЛС может прислать только друг (правила ЛС на сервере),
// у друга звонит телефон (phone.js слушает новые ЛС). Ответил — заходит в комнату, звук идёт напрямую.
// Без TURN-сервера часть сетей (мобильный интернет, строгий роутер) напрямую не соединяется — пишем это честно.
// D37Calls.call(uid, nick) · party() · join(code) · voiceJoin(spec) · leave() · voiceMute() · voiceDeaf() · incoming(dm, code)
(() => {
  const P = window.D37Phone;
  const C = window.D37Calls = window.D37Calls || {};
  const STUN = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  // TURN — когда появится (см. отчёт: Cloudflare Realtime TURN или свой coturn): window.D37_TURN = [{ urls, username, credential }]
  const ICE = () => [...STUN, ...(Array.isArray(window.D37_TURN) ? window.D37_TURN : [])];
  const MAX = 6, RING_MS = 40000, DIAL_MS = 35000, CONNECT_MS = 30000;
  const e = s => esc(s);
  const rid = n => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; const b = crypto.getRandomValues(new Uint8Array(n)); for (const x of b) s += a[x % a.length]; return s; };

  // ═══ Чистые части (проверяются в node: scripts/community-test.cjs) ═══
  // Звонок 1 на 1: idle → out (вызываю) | in (звонят мне) → joining (ответил, вхожу) → live (разговор) → ended
  const FSM = {
    idle: { dial: 'out', ring: 'in', join: 'joining' },
    out: { joined: 'live', timeout: 'ended', hangup: 'ended', declined: 'ended', failed: 'ended' },
    in: { accept: 'joining', decline: 'ended', timeout: 'ended', gone: 'ended', hangup: 'ended' },
    joining: { joined: 'live', failed: 'ended', hangup: 'ended', timeout: 'ended', empty: 'ended' },
    live: { hangup: 'ended', failed: 'ended', empty: 'ended' },
    ended: { reset: 'idle', dial: 'out', ring: 'in', join: 'joining' },
  };
  const step = (s, ev) => (FSM[s] && FSM[s][ev]) || s;
  // Сетка: первые MAX по времени входа — внутри; кто вошёл раньше — тот и предлагает соединение
  const before = (a, b) => a.at < b.at || (a.at === b.at && a.key < b.key);
  function plan(members, myKey, max = MAX){
    const sorted = [...members].sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
    const i = sorted.findIndex(m => m.key === myKey);
    if (i === -1) return { joined: false, full: false, offer: [], wait: [], inside: [] };
    if (i >= max) return { joined: false, full: true, offer: [], wait: [], inside: sorted.slice(0, max).map(m => m.key) };
    const inside = sorted.slice(0, max), me = sorted[i];
    return { joined: true, full: false, inside: inside.map(m => m.key),
      offer: inside.filter(m => m.key !== myKey && m.ok && before(me, m)).map(m => m.key),
      wait: inside.filter(m => m.key !== myKey && m.ok && before(m, me)).map(m => m.key) };
  }
  // Сигнальное сообщение: знакомые поля и разумные размеры (чужому не верим)
  function sigOk(d, myKey){
    if (!d || typeof d !== 'object' || typeof d.t !== 'string') return false;
    if (['offer', 'answer', 'ice', 'hi', 'decline'].includes(d.t) && d.to !== myKey) return false;
    if ((d.t === 'offer' || d.t === 'answer') && !(d.sdp && typeof d.sdp.sdp === 'string' && d.sdp.sdp.length < 30000 && ['offer', 'answer'].includes(d.sdp.type))) return false;
    if (d.t === 'ice' && !(Array.isArray(d.c) && d.c.length <= 40 && d.c.every(c => c && typeof c.candidate === 'string' && c.candidate.length < 600))) return false;
    if (d.sid !== undefined && !(typeof d.sid === 'string' && d.sid.length <= 16)) return false;
    return ['offer', 'answer', 'ice', 'hi', 'st', 'bye', 'decline'].includes(d.t);
  }
  // Говорит ли: включается сразу (громче порога 60 мс), выключается не сразу (тише 0,4 с) — без мигания
  function vad(st, level, dt){
    if (level > .045) { st.hi = (st.hi || 0) + dt; st.lo = 0; if (st.hi >= .06) st.on = true; }
    else if (level < .02) { st.lo = (st.lo || 0) + dt; st.hi = 0; if (st.lo >= .4) st.on = false; }
    return st.on || false;
  }

  // ═══ Ключи и подписи (как в мире) ═══
  const enc = s => new TextEncoder().encode(s);
  const b64 = buf => { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  let keysP = null;
  const myKeys = () => keysP || (keysP = crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
    .then(async kp => ({ kp, pub: b64(await crypto.subtle.exportKey('raw', kp.publicKey)) })));
  const importPub = pub => crypto.subtle.importKey('raw', unb64(pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const sign = async (priv, str) => b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, enc(str)));
  const verifySig = (pub, sig, str) => crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64(sig), enc(str)).catch(() => false);

  // ═══ Микрофон ═══
  let fakeFreq = 0;
  async function getMic(){
    if (fakeFreq) {   // для проверки без микрофона: тон с «паузами речи» (D37Calls._test.fakeMic(440))
      const ctx = P.audioCtx(), o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain(), dst = ctx.createMediaStreamDestination();
      o.frequency.value = fakeFreq; g.gain.value = .15; lfo.frequency.value = .7; lg.gain.value = .15;
      lfo.connect(lg); lg.connect(g.gain); o.connect(g); g.connect(dst); o.start(); lfo.start();
      const s = dst.stream; s._stop = () => { try { o.stop(); lfo.stop(); } catch (er) {} };
      return s;
    }
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no'), { name: window.isSecureContext ? 'NotSupportedError' : 'SecurityError' });
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: P.set.ns !== false, autoGainControl: true, channelCount: 1 }, video: false });
  }
  const micErr = er => {
    const n = er?.name || '';
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return '🎙 Нет доступа к микрофону. Нажми на значок 🔒 слева от адреса сайта → «Микрофон» → «Разрешить» и попробуй ещё раз.';
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return '🎙 Микрофон не найден. Подключи наушники с микрофоном.';
    if (n === 'NotReadableError') return '🎙 Микрофон занят другой программой (Discord, Zoom?) — закрой её.';
    if (n === 'SecurityError') return '🎙 Микрофон работает только на https-адресе сайта.';
    return '🎙 Не удалось включить микрофон: ' + (er?.message || n || 'ошибка');
  };

  // ═══ Комната голоса: присутствие + знакомство + сетка WebRTC ═══
  // opt: { topic, max, me: { uid, nick }, verify(meta) → Promise<{ uid, nick } | null>, stream, onChange(), onFull(), onEmpty(), onError(text), onDecline() }
  async function openRoom(opt){
    const keys = await myKeys();
    const myKey = (opt.me.uid || 'g') + '~' + rid(6);
    const R = { opt, myKey, keys, members: new Map(), verified: new Map(), pubs: new Map(), peers: new Map(), early: new Map(), stream: opt.stream,
      closed: false, mute: false, deaf: false, at: Date.now(), state: 'joining', changeT: 0, hiT: new Map(), seen: false };
    const audioBox = document.getElementById('d37Audio') || Object.assign(document.createElement('div'), { id: 'd37Audio', hidden: true });
    if (!audioBox.parentElement) document.body.appendChild(audioBox);
    R.changed = () => { clearTimeout(R.changeT); R.changeT = setTimeout(() => { if (!R.closed) opt.onChange?.(R); }, 60); };
    // supabase-js отдаёт уже открытый канал с той же темой (например, «смотрели», пока звонило) — сначала убрать его
    for (const old of sbClient.getChannels?.() || []) if (old.topic === 'realtime:' + opt.topic) { try { await sbClient.removeChannel(old); } catch (er) {} }
    const ch = sbClient.channel(opt.topic, { config: { broadcast: { self: false }, presence: { key: myKey } } });
    R.ch = ch;
    // «отклонил» шлёт тот, кто ещё не в комнате (только смотрел) — его ключ подписи едет в самом сообщении
    R.send = async d => { if (R.closed) return; d.ts = Date.now(); const m = JSON.stringify(d); try { await ch.send({ type: 'broadcast', event: 'v', payload: { k: myKey, m, s: await sign(keys.kp.privateKey, m), p: d.t === 'decline' ? keys.pub : undefined } }); } catch (er) {} };
    ch.on('presence', { event: 'sync' }, () => sync(R));
    ch.on('broadcast', { event: 'v' }, ({ payload }) => onMsg(R, payload));
    ch.subscribe(async st => {
      if (R.closed) return;
      if (st === 'SUBSCRIBED') {
        if (opt.observe) return;   // только смотреть, кто внутри (звонят мне — ещё не ответил)
        await ch.track({ k: myKey, uid: opt.me.uid || null, nick: String(opt.me.nick || 'игрок').slice(0, 24), at: R.at, pub: keys.pub, pass: opt.pass || null, m: false });
      } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') opt.onError?.('Связь с сервером знакомства потерялась — переподключаемся…');
    });
    // уровни громкости — раз в 100 мс
    R.vadT = setInterval(() => vadTick(R), 100);
    if (R.stream) R.localAn = analyser(R.stream);
    return R;
  }
  function closeRoom(R, bye = true){
    if (!R || R.closed) return;
    if (bye) R.send({ t: 'bye' });
    R.closed = true;
    clearInterval(R.vadT); clearTimeout(R.changeT);
    for (const p of R.peers.values()) dropPeer(R, p);
    R.peers.clear();
    try { R.ch.untrack(); } catch (er) {}
    if (bye) setTimeout(() => { try { sbClient.removeChannel(R.ch); } catch (er) {} }, 300);
    else { try { sbClient.removeChannel(R.ch); } catch (er) {} }
    if (R.stream && R.ownStream) { R.stream.getTracks().forEach(t => t.stop()); R.stream._stop?.(); }
  }
  async function sync(R){
    if (R.closed) return;
    const st = R.ch.presenceState(), seen = new Map();
    for (const [key, metas] of Object.entries(st)) {
      const m = (metas || [])[metas.length - 1];
      if (m && m.k === key && typeof m.pub === 'string' && m.pub.length < 200 && typeof m.at === 'number') seen.set(key, m);
    }
    R.members = seen;
    // новенькие: ключ подписи и (если надо) проверка пропуска
    for (const [key, m] of seen) {
      if (key === R.myKey || R.verified.has(key)) continue;
      R.verified.set(key, 'wait');
      Promise.all([importPub(m.pub).catch(() => null), R.opt.verify ? R.opt.verify(m).catch(() => null) : Promise.resolve({ uid: m.uid, nick: m.nick })]).then(([pk, who]) => {
        if (R.closed) return;
        R.pubs.set(key, pk);
        R.verified.set(key, !!(pk && who));
        if (who) { m.uid = who.uid || m.uid; m.nick = String(who.nick || m.nick || 'игрок').slice(0, 24); }
        sync(R);
      });
    }
    const list = [...seen.values()].map(m => ({ key: m.k, at: m.at, ok: m.k === R.myKey || R.verified.get(m.k) === true }));
    const me = seen.get(R.myKey);
    if (!me) { R.changed(); return; }
    const pl = plan(list, R.myKey, R.opt.max || MAX);
    if (pl.full) { R.full = true; R.opt.onFull?.(R, pl); return; }
    R.full = false;
    const want = new Set([...pl.offer, ...pl.wait]);
    for (const [key, p] of R.peers) if (!want.has(key)) { dropPeer(R, p); R.peers.delete(key); }
    for (const key of pl.offer) if (!R.peers.has(key)) { const p = newPeer(R, key, true); R.peers.set(key, p); setTimeout(() => { if (!R.closed && R.peers.get(key) === p) offer(R, p); }, 700); }
    for (const key of pl.wait) if (!R.hiT.has(key)) R.hiT.set(key, setTimeout(() => hiCheck(R, key, 0), 6000));
    const others = [...seen.keys()].filter(k => k !== R.myKey);
    if (others.length) R.seen = true;
    if (!others.length && R.seen) R.opt.onEmpty?.(R);
    R.changed();
  }
  // ждём предложения от того, кто вошёл раньше; нет — просим («hi»), до 3 раз
  function hiCheck(R, key, n){
    if (R.closed || !R.members.has(key)) { R.hiT.delete(key); return; }
    const p = R.peers.get(key);
    if (p?.state === 'ok') { R.hiT.delete(key); return; }
    if (n >= 3) { if (p) p.state = 'fail'; else { R.failed = R.failed || new Set(); R.failed.add(key); } R.hiT.delete(key); R.changed(); return; }
    R.send({ t: 'hi', to: key });
    R.hiT.set(key, setTimeout(() => hiCheck(R, key, n + 1), 9000));
  }
  function newPeer(R, key, offerer){
    const p = { key, offerer, sid: '', state: 'connecting', tries: 0, timer: 0, ice: [], iceT: 0, pend: [], audio: null, an: null, vad: {}, speaking: false, mute: false, deaf: false };
    makePc(R, p);
    return p;
  }
  function makePc(R, p){
    try { p.pc?.close(); } catch (er) {}
    const pc = new RTCPeerConnection({ iceServers: ICE() });
    p.pc = pc;
    if (R.stream) R.stream.getTracks().forEach(t => pc.addTrack(t, R.stream));
    pc.onicecandidate = ev => {
      if (!ev.candidate || pc !== p.pc) return;
      p.ice.push(ev.candidate.toJSON());
      if (!p.iceT) p.iceT = setTimeout(() => { p.iceT = 0; const c = p.ice.splice(0, 40); if (c.length) R.send({ t: 'ice', to: p.key, sid: p.sid, c }); }, 250);   // пачкой: меньше сообщений
    };
    pc.ontrack = ev => { if (pc === p.pc) attachAudio(R, p, ev.streams[0] || new MediaStream([ev.track])); };
    pc.onconnectionstatechange = () => {
      if (pc !== p.pc) return;
      const s = pc.connectionState;
      if (s === 'connected') { p.state = 'ok'; clearTimeout(p.timer); R.changed(); R.opt.onConnected?.(R, p); }
      else if (s === 'failed') { if (p.offerer && p.tries < 3) offer(R, p); else { p.state = 'fail'; R.changed(); } }
      else if (s === 'disconnected') { p.state = 'connecting'; R.changed(); }
    };
  }
  async function offer(R, p){
    if (R.closed) return;
    p.tries++; p.sid = rid(8); p.state = 'connecting'; p.pend = [];
    if (p.tries > 1) makePc(R, p);
    clearTimeout(p.timer);
    p.timer = setTimeout(() => { if (!R.closed && p.state !== 'ok' && R.peers.get(p.key) === p) { if (p.tries < 3) offer(R, p); else { p.state = 'fail'; R.changed(); } } }, 9000);
    try {
      const pc = p.pc;
      await pc.setLocalDescription(await pc.createOffer({ offerToReceiveAudio: true }));
      R.send({ t: 'offer', to: p.key, sid: p.sid, sdp: pc.localDescription.toJSON() });
    } catch (er) { p.state = 'fail'; R.changed(); }
  }
  async function onMsg(R, pl){
    if (R.closed || !pl || typeof pl.k !== 'string' || typeof pl.m !== 'string' || typeof pl.s !== 'string' || pl.m.length > 40000) return;
    const from = pl.k;
    let pk = R.pubs.get(from);
    // «отклонил вызов» — от того, кто только смотрел (его нет в комнате): ключ в сообщении, код комнаты знал только он
    if (!pk && typeof pl.p === 'string' && pl.p.length < 200 && R.opt.onDecline) { try { pk = await importPub(pl.p); } catch (er) { return; } if (!await verifySig(pk, pl.s, pl.m)) return; let d0; try { d0 = JSON.parse(pl.m); } catch (er) { return; } if (d0?.t === 'decline' && sigOk(d0, R.myKey)) R.opt.onDecline(R, null); return; }
    if (!pk || R.verified.get(from) !== true) return;   // не знаем или не прошёл проверку — не слушаем
    if (!await verifySig(pk, pl.s, pl.m)) return;
    let d; try { d = JSON.parse(pl.m); } catch (er) { return; }
    if (!sigOk(d, R.myKey)) return;
    const m = R.members.get(from);
    if (d.t === 'offer') {
      let p = R.peers.get(from);
      if (p && p.offerer) return;   // я должен предлагать сам (по порядку входа)
      if (!p) { p = newPeer(R, from, false); R.peers.set(from, p); }
      else if (p.sid !== d.sid) makePc(R, p);
      p.sid = d.sid; p.pend = [];
      try {
        await p.pc.setRemoteDescription(d.sdp);
        for (const c of R.early.get(from + '/' + d.sid) || []) await p.pc.addIceCandidate(c).catch(() => {});
        R.early.delete(from + '/' + d.sid);
        await p.pc.setLocalDescription(await p.pc.createAnswer());
        R.send({ t: 'answer', to: from, sid: d.sid, sdp: p.pc.localDescription.toJSON() });
      } catch (er) { p.state = 'fail'; R.changed(); }
    } else if (d.t === 'answer') {
      const p = R.peers.get(from); if (!p || !p.offerer || p.sid !== d.sid) return;
      try { await p.pc.setRemoteDescription(d.sdp); for (const c of p.pend.splice(0)) await p.pc.addIceCandidate(c).catch(() => {}); } catch (er) {}
    } else if (d.t === 'ice') {
      const p = R.peers.get(from);
      if (!p || p.sid !== d.sid) { const k = from + '/' + d.sid, l = R.early.get(k) || []; if (l.length < 80) R.early.set(k, l.concat(d.c)); return; }
      for (const c of d.c) { if (p.pc.remoteDescription) await p.pc.addIceCandidate(c).catch(() => {}); else p.pend.push(c); }
    } else if (d.t === 'hi') {
      const p = R.peers.get(from); if (p && p.offerer && p.state !== 'ok') { p.tries = 0; offer(R, p); }
    } else if (d.t === 'st') {
      const p = R.peers.get(from); if (m) { m.mute = !!d.mute; m.deaf = !!d.deaf; }
      if (p) { p.mute = !!d.mute; p.deaf = !!d.deaf; }
      R.changed();
    } else if (d.t === 'decline') R.opt.onDecline?.(R, m);
    else if (d.t === 'bye') { const p = R.peers.get(from); if (p) { dropPeer(R, p); R.peers.delete(from); } }
  }
  function dropPeer(R, p){
    clearTimeout(p.timer); clearTimeout(p.iceT);
    try { p.pc.close(); } catch (er) {}
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    try { p.an?.src.disconnect(); } catch (er) {}
    const t = R.hiT.get(p.key); if (t) { clearTimeout(t); R.hiT.delete(p.key); }
  }
  // громкость собеседников — окно ⚙️: «🔊 Звук» → «Общая громкость» × «Голос» (settings.js → D37Opt); «звук в играх» звонок не глушит
  const voiceVol = () => { const O = window.D37Opt; const v = O ? (O.vol ?? 1) * (O.volVoice ?? 1) : 1; return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1; };
  window.addEventListener('d37:settings', () => { const v = voiceVol(); for (const p of S?.room?.peers?.values() || []) if (p.audio) p.audio.volume = v; });
  function attachAudio(R, p, stream){
    if (!p.audio) { p.audio = document.createElement('audio'); p.audio.autoplay = true; p.audio.setAttribute('playsinline', ''); document.getElementById('d37Audio').appendChild(p.audio); }
    p.audio.srcObject = stream; p.audio.muted = R.deaf; p.audio.volume = voiceVol();
    p.audio.play().catch(() => {});
    try { p.an?.src.disconnect(); } catch (er) {}
    p.an = analyser(stream);
  }
  function analyser(stream){
    const ctx = P.audioCtx(); if (!ctx) return null;
    try { const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an); return { src, an, buf: new Float32Array(an.fftSize) }; } catch (er) { return null; }
  }
  function level(a){
    if (!a) return 0;
    a.an.getFloatTimeDomainData(a.buf); let s = 0; for (const v of a.buf) s += v * v;
    return Math.sqrt(s / a.buf.length);
  }
  function vadTick(R){
    let ch = false;
    const mine = !R.mute && (!P.set.ptt || pttHeld) ? level(R.localAn) : 0;
    R.myLevel = mine;
    const was = R.speaking; R.speaking = vad(R.vadMe = R.vadMe || {}, mine, .1); if (was !== R.speaking) ch = true;
    for (const p of R.peers.values()) { const w = p.speaking; p.speaking = !R.deaf && vad(p.vad, level(p.an), .1); if (w !== p.speaking) ch = true; }
    if (ch) R.changed();
    if (R.opt.onLevel) R.opt.onLevel(mine);
  }
  // свой микрофон: выключен (кнопка), или рация — только пока держишь
  function applyMic(R){
    if (!R?.stream) return;
    const on = !R.mute && (!P.set.ptt || pttHeld);
    R.stream.getAudioTracks().forEach(t => { t.enabled = on; });
  }
  let pttHeld = false;
  const setPtt = v => { if (pttHeld === v) return; pttHeld = v; applyMic(S?.room); S?.room?.changed(); };
  window.addEventListener('keydown', ev => { if (!P.set.ptt || !S?.room || ev.repeat || ev.code !== (P.set.pttKey || 'Backquote')) return; if (ev.target?.closest?.('input,textarea,[contenteditable]')) return; setPtt(true); }, true);
  window.addEventListener('keyup', ev => { if (ev.code === (P.set.pttKey || 'Backquote')) setPtt(false); }, true);
  window.addEventListener('blur', () => setPtt(false));
  // настройки телефона поменяли во время разговора (вкладка «📱 Телефон»): рация и шумоподавление — сразу
  window.addEventListener('d37:phoneset', () => {
    const R = S?.room; if (!R) return;
    if (!P.set.ptt) pttHeld = false;
    applyMic(R);
    R.stream?.getAudioTracks().forEach(t => { try { t.applyConstraints?.({ echoCancellation: true, noiseSuppression: P.set.ns !== false, autoGainControl: true })?.catch?.(() => {}); } catch (er) {} });
    R.changed(); pill();
  });

  // ═══ Текущий разговор (один на вкладку) ═══
  // S = { kind: 'call' | 'party' | 'voice', state (FSM), code, topic, title, peer: { uid, nick } (звонок), room, t0, reason, spec (голосовой) }
  let S = null;
  const ringLoop = { t: 0, on: false };
  function ring(on, kind = 'ring'){
    clearInterval(ringLoop.t); ringLoop.on = on;
    if (!on) { try { navigator.vibrate?.(0); } catch (er) {} return; }
    const play = () => {
      if (kind === 'ring') { P.sfx('ring'); try { navigator.vibrate?.([300, 150, 300]); } catch (er) {} }
      else P.tone([[425, .9]], .55);   // гудок вызова (как в телефоне)
    };
    play(); ringLoop.t = setInterval(play, kind === 'ring' ? 2600 : 4000);
  }
  function setState(ev){
    if (!S) return;
    const next = step(S.state, ev);
    if (next === S.state) return;
    S.state = next;
    if (next === 'live' && !S.t0) S.t0 = Date.now();
    if (next !== 'in' && next !== 'out') ring(false);
    if (next === 'ended') finish();
    render();
    try { window.dispatchEvent(new Event('d37:callstate')); } catch (er) {}   // телефон 📱: персонаж подносит к уху / убирает (phone.js)
  }
  C.inCall = () => !!S && ['out', 'joining', 'live'].includes(S.state);
  C.state = () => S ? { kind: S.kind, state: S.state, title: S.title, code: S.code } : null;
  C.liveTarget = () => 'incall';
  C.liveInfo = () => S && S.state !== 'ended' ? `📞 ${S.title}${S.t0 ? ' · ' + clock() : ''}` : '';
  const clock = () => { const s = Math.floor((Date.now() - (S?.t0 || Date.now())) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const people = () => {
    const R = S?.room; if (!R) return [];
    const out = [{ key: R.myKey, uid: P.me(), nick: P.myNick() || 'Я', me: true, speaking: !!R.speaking, mute: R.mute || (P.set.ptt && !pttHeld), deaf: R.deaf, state: 'ok' }];
    for (const [key, m] of R.members) {
      if (key === R.myKey || R.verified.get(key) !== true) continue;
      const p = R.peers.get(key);
      out.push({ key, uid: m.uid, nick: m.nick, speaking: !!p?.speaking, mute: !!(p?.mute || m.mute), deaf: !!(p?.deaf || m.deaf), state: p ? p.state : (R.failed?.has(key) ? 'fail' : 'connecting') });
    }
    return out;
  };
  C.voiceInfo = () => S && S.kind === 'voice' && S.state !== 'ended' ? { kind: S.spec.kind, channel: S.spec.channel, title: S.title, state: S.room?.full ? 'full' : people().some(p => !p.me && p.state === 'ok') || people().length === 1 ? 'ok' : 'wait', mute: !!S.room?.mute, deaf: !!S.room?.deaf, people: people() } : null;

  // ── начать разговор: микрофон, комната ──
  async function startRoom(opt){
    let stream;
    try { stream = await getMic(); } catch (er) { return { err: micErr(er) }; }
    const R = await openRoom(Object.assign({ stream, me: { uid: P.me(), nick: P.myNick() || (typeof chatNick !== 'undefined' && chatNick) || 'игрок' },
      onChange: () => {
        // ник собеседника — из комнаты, если профиль ещё не загрузился
        if (S?.peer && S.room === R && (!S.peer.nick || S.peer.nick === 'Друг')) { const m = [...R.members.values()].find(x => x.uid === S.peer.uid); if (m?.nick) { S.peer.nick = m.nick; if (S.kind === 'call') S.title = m.nick; } }
        render(); window.dispatchEvent(new Event('d37:voice'));
      },
      onConnected: () => { if (S && S.room === R) setState('joined'); },
    }, opt));
    R.ownStream = true;
    applyMic(R);
    return { R };
  }
  function finish(){
    const s = S; if (!s) return;
    ring(false);
    clearTimeout(s.timer); clearInterval(s.tick);
    if (s.room) { closeRoom(s.room, true); s.room = null; }
    if (s.watch) { closeRoom(s.watch, false); s.watch = null; }
    if (s.t0) logCall({ dir: s.dir, uid: s.peer?.uid, nick: s.peer?.nick || s.title, kind: s.kind, at: s.at, dur: Math.round((Date.now() - s.t0) / 1000) });
    P.sfx('hang');
    pill();
    window.dispatchEvent(new Event('d37:voice'));
    setTimeout(() => { if (S === s) { S = null; render(); pill(); if (P.path() === 'incall') P.closeIfByCall(); } }, 2600);
  }
  // журнал звонков (браузер)
  const LOG_KEY = 'd37_calls_log';
  const readLog = () => { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]') || []; } catch (er) { return []; } };
  function logCall(x){ const l = readLog(); l.unshift(Object.assign({ at: Date.now() }, x)); try { localStorage.setItem(LOG_KEY, JSON.stringify(l.slice(0, 40))); } catch (er) {} }

  // ═══ Позвонить другу ═══
  C.call = async (uid, nick) => {
    if (!P.me()) { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); return; }
    if (S && S.state !== 'ended') {
      if (S.kind === 'party' || S.kind === 'call') { const ok = await P.ask(`Ты уже в разговоре. Позвать <b>${e(nick)}</b> к вам?`, [{ k: 'yes', t: '➕ Позвать', cls: 'ok' }]); if (ok) C.invite(uid, nick); return; }
      if (await P.ask('Выйти из голосового канала и позвонить?', [{ k: 'yes', t: '📞 Позвонить' }]) !== 'yes') return; C.leave(); await new Promise(r => setTimeout(r, 300));
    }
    const code = rid(10);
    S = { kind: 'call', dir: 'out', state: 'idle', code, topic: 'call-' + code, title: nick, peer: { uid, nick }, at: Date.now() };
    setState('dial');
    P.open('incall', { byCall: !P.isOpen() });
    ring(true, 'back');
    // код комнаты знает только тот, кому отправили вызов (личным сообщением), — в звонок можно позвать ещё друзей
    const r = await startRoom({ topic: S.topic, max: MAX,
      onEmpty: () => { if (S?.room && S.state === 'live') { S.reason = 'hangup'; setState('hangup'); } },
      onDecline: () => { if (S?.state === 'out') { S.reason = 'declined'; setState('declined'); } } });
    if (!S || S.code !== code) { if (r.R) closeRoom(r.R, false); return; }
    if (r.err) { S.reason = 'mic'; S.err = r.err; setState('failed'); return; }
    S.room = r.R;
    // вызов — личным сообщением (его может прислать только друг)
    const link = `https://dan4ik37.vercel.app/#/phone/call/${code}`;
    const { error } = await sbClient.from('direct_messages').insert([{ sender_id: P.me(), recipient_id: uid, text: `📞 Звоню тебе! ${link}` }]);
    if (error) { S.reason = 'dm'; S.err = /row-level|42501/i.test(error.message || '') ? 'Звонить можно только друзьям (и если вы не заблокировали друг друга)' : P.err(error); setState('failed'); return; }
    S.timer = setTimeout(() => { if (S?.code === code && S.state === 'out') { S.reason = 'noanswer'; setState('timeout'); } }, DIAL_MS);
    // друг вошёл в комнату — разговор
    const watch = setInterval(() => {
      if (!S || S.code !== code || S.state !== 'out') { clearInterval(watch); return; }
      if ([...(S.room?.members.keys() || [])].some(k => k !== S.room.myKey && S.room.verified.get(k) === true)) { clearInterval(watch); clearTimeout(S.timer); ring(false); setState('joined'); armConnect(); }
    }, 300);
    render(); pill();
  };
  // связь не установилась за 30 с — честно говорим про сеть
  function armConnect(){
    const s = S; clearTimeout(s.ctimer);
    s.ctimer = setTimeout(() => {
      if (S !== s || s.state !== 'live') return;
      const ps = people().filter(p => !p.me);
      if (ps.length && !ps.some(p => p.state === 'ok')) { s.netWarn = true; render(); if (s.kind === 'call') { s.reason = 'net'; setState('failed'); } }
    }, CONNECT_MS);
  }
  // Позвать в текущий разговор (компания до 6): то же сообщение-вызов
  C.invite = async (uid, nick) => {
    if (!S || !S.code) return;
    const n = people().length; if (n >= MAX) { P.toast('В разговоре уже 6 человек — больше нельзя', false); return; }
    const { error } = await sbClient.from('direct_messages').insert([{ sender_id: P.me(), recipient_id: uid, text: `🎧 Зову в голосовой чат! https://dan4ik37.vercel.app/#/phone/call/${S.code}` }]);
    P.toast(error ? '⚠️ ' + (/row-level|42501/i.test(error.message || '') ? 'звать можно только друзей' : P.err(error)) : `📨 Позвал(а) ${nick}`, !error);
  };
  // Голосовая компания: своя комната, зовёшь друзей
  C.party = async () => {
    if (!P.me()) { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); return; }
    if (S && S.state !== 'ended') { P.go('incall'); return; }
    const code = rid(10);
    S = { kind: 'party', dir: 'out', state: 'idle', code, topic: 'call-' + code, title: '🎧 Голосовая компания', at: Date.now() };
    setState('join');
    P.go('incall');
    const r = await startRoom({ topic: S.topic, max: MAX });
    if (!S || S.code !== code) { if (r.R) closeRoom(r.R, false); return; }
    if (r.err) { S.reason = 'mic'; S.err = r.err; setState('failed'); return; }
    S.room = r.R; S.t0 = Date.now(); S.state = 'live'; armConnect(); render(); pill();
  };
  // Войти по ссылке #/phone/call/<код> (ответить на вызов или прийти в компанию)
  C.join = async (code, opt = {}) => {
    if (!/^[a-z0-9]{8,16}$/.test(code || '')) return;
    if (!P.me()) { P.toast('Войди, чтобы разговаривать', false); if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); return; }
    if (S && S.code === code && S.state !== 'ended') { if (S.state === 'in') C.accept(); else P.go('incall'); return; }
    if (S && S.state !== 'ended' && S.state !== 'in') { if (await P.ask('Ты уже разговариваешь. Выйти и зайти в этот звонок?', [{ k: 'yes', t: '📞 Перейти' }]) !== 'yes') return; C.leave(); await new Promise(r => setTimeout(r, 300)); }
    S = { kind: opt.kind || 'party', dir: 'in', state: 'idle', code, topic: 'call-' + code, title: opt.title || '📞 Звонок', peer: opt.peer || null, at: Date.now() };
    setState('join');
    P.go('incall');
    const r = await startRoom({ topic: S.topic, max: MAX,
      onEmpty: () => { if (S?.room && S.state === 'live' && S.kind === 'call') { S.reason = 'hangup'; setState('hangup'); } } });
    if (!S || S.code !== code) { if (r.R) closeRoom(r.R, false); return; }
    if (r.err) { S.reason = 'mic'; S.err = r.err; setState('failed'); return; }
    S.room = r.R;
    // в комнате никого — звонок уже закончился
    S.timer = setTimeout(() => { if (S?.code === code && S.room && ![...S.room.members.keys()].some(k => k !== S.room.myKey)) { S.reason = 'over'; setState('empty'); } }, 7000);
    const s = S;
    const w = setInterval(() => { if (S !== s || s.state === 'ended') { clearInterval(w); return; } if ([...(s.room?.members.keys() || [])].some(k => k !== s.room.myKey)) { clearInterval(w); clearTimeout(s.timer); if (s.state === 'joining') { s.state = 'live'; s.t0 = s.t0 || Date.now(); armConnect(); render(); pill(); } } }, 300);
  };
  // Мне звонят (личное сообщение с вызовом от друга — phone.js)
  C.incoming = (dm, code) => {
    const uid = dm.sender_id;
    if (window.MsgView?.blocked?.has(uid) || localBlocked(uid)) return;
    const nick = P.prof(uid)?.nick || 'Друг';
    const party = /Зову в голосовой/.test(dm.text || '');
    if (P.set.calls === 'nobody') { P.missed.add({ id: dm.id, uid, nick, at: Date.parse(dm.created_at), code }); return; }
    if (S && S.state !== 'ended') {
      if (S.code === code) return;
      P.missed.add({ id: dm.id, uid, nick, at: Date.parse(dm.created_at), code });
      P.toast(`📞 ${nick} звонит — ты уже разговариваешь`, false);
      return;
    }
    P.profiles([uid]).then(() => { if (S?.code === code && S.peer) { S.peer.nick = P.prof(uid)?.nick || S.peer.nick; S.title = party ? `🎧 ${S.peer.nick} зовёт в голосовой` : S.peer.nick; render(); } });
    S = { kind: party ? 'party' : 'call', dir: 'in', state: 'idle', code, topic: 'call-' + code, title: party ? `🎧 ${nick} зовёт в голосовой` : nick, peer: { uid, nick }, at: Date.now(), dm };
    setState('ring');
    P.open('incall', { byCall: !P.isOpen() });
    ring(true, 'ring');
    S.timer = setTimeout(() => { if (S?.code === code && S.state === 'in') { P.missed.add({ id: dm.id, uid, nick, at: Date.now(), code }); S.reason = 'missed'; setState('timeout'); } }, RING_MS);
    // смотрим (без входа), не положил ли друг трубку
    const s = S;
    openRoom({ topic: S.topic, observe: true, me: { uid: P.me(), nick: P.myNick() }, onChange: R => {
      if (S !== s || s.state !== 'in') return;
      const anyone = [...R.members.keys()].length;
      if (anyone) s.sawCaller = true;
      else if (s.sawCaller) { P.missed.add({ id: dm.id, uid, nick, at: Date.now(), code }); s.reason = 'missed'; setState('gone'); }
    } }).then(R => { if (S === s && s.state === 'in') s.watch = R; else closeRoom(R, false); });
    pill();
  };
  C.accept = async () => {
    if (!S || S.state !== 'in') return;
    const s = S; clearTimeout(s.timer); ring(false);
    if (s.watch) { closeRoom(s.watch, false); s.watch = null; }
    setState('accept');
    const r = await startRoom({ topic: s.topic, max: MAX, onEmpty: () => { if (S === s && s.state === 'live' && s.kind === 'call') { s.reason = 'hangup'; setState('hangup'); } } });
    if (S !== s) { if (r.R) closeRoom(r.R, false); return; }
    if (r.err) { s.reason = 'mic'; s.err = r.err; setState('failed'); return; }
    s.room = r.R; s.t0 = Date.now();
    setState('joined'); armConnect(); pill();
  };
  C.decline = async () => {
    if (!S || S.state !== 'in') return;
    const s = S;
    s.reason = 'declined_me'; clearTimeout(s.timer); ring(false);
    const to = s.watch && [...s.watch.members.keys()][0];
    if (to) await Promise.race([s.watch.send({ t: 'decline', to }), new Promise(r => setTimeout(r, 1500))]);
    if (S === s) setState('decline');
  };
  C.leave = () => { if (!S) return; if (S.state === 'in') { C.decline(); return; } S.reason = S.reason || 'me'; setState('hangup'); if (S && S.state !== 'ended') { S.state = 'ended'; finish(); render(); } };
  C.voiceMute = () => { const R = S?.room; if (!R) return; R.mute = !R.mute; applyMic(R); R.send({ t: 'st', mute: R.mute, deaf: R.deaf }); R.changed(); pill(); };
  C.voiceDeaf = () => {
    const R = S?.room; if (!R) return;
    R.deaf = !R.deaf;
    if (R.deaf && !R.mute) { R.mute = true; R.deafMuted = true; } else if (!R.deaf && R.deafMuted) { R.mute = false; R.deafMuted = false; }
    for (const p of R.peers.values()) if (p.audio) p.audio.muted = R.deaf;
    applyMic(R); R.send({ t: 'st', mute: R.mute, deaf: R.deaf }); R.changed(); pill();
  };
  C.voiceLeave = () => C.leave();
  C.hangupAll = () => C.leave();
  const localBlocked = uid => { try { return (JSON.parse(localStorage.getItem('d37_blocks_local') || '[]') || []).includes(uid); } catch (er) { return false; } };

  // ═══ Голосовой канал (сервер «Денчик37» — канал 0, сообщество — номер канала): пропуск выдаёт база ═══
  C.voiceJoin = async spec => {
    if (!P.me()) { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); return { err: 'login' }; }
    if (S && S.state !== 'ended') {
      if (S.kind === 'voice' && S.spec.kind === spec.kind && String(S.spec.channel) === String(spec.channel)) return { ok: true };
      if (await P.ask('Ты уже разговариваешь. Выйти и зайти в этот канал?', [{ k: 'yes', t: '🔊 Перейти' }]) !== 'yes') return { err: 'busy' };
      C.leave(); await new Promise(r => setTimeout(r, 300));
    }
    const keys = await myKeys();
    const pr = await P.rpc('cv_pass', { p_channel: spec.channel, p_pub: keys.pub });
    if (pr.error) return { err: pr.missing ? 'soon' : P.err(pr.error) };
    if (!pr.data?.ok) return { err: { member: 'Сначала вступи в сообщество', banned: 'Тебя забанили', muted: 'Тебя заглушили в чате', new: 'Голосовой канал сайта — для аккаунтов старше суток', not_found: 'Канал не найден' }[pr.data?.reason] || 'Не получилось' };
    const code = 'v' + spec.channel;
    S = { kind: 'voice', dir: 'out', state: 'idle', code: null, topic: pr.data.topic, title: spec.title, spec, at: Date.now() };
    setState('join');
    const ch = spec.channel;
    const r = await startRoom({ topic: pr.data.topic, max: pr.data.max || MAX, pass: pr.data.pass,
      verify: async m => { if (typeof m.pass !== 'string') return null; const { data } = await P.rpc('cv_check', { p_channel: ch, p_pass: m.pass, p_pub: m.pub }); return data && data.uid === m.uid ? { uid: data.uid, nick: data.nick } : null; },
      onFull: () => { if (S?.kind === 'voice') { S.full = true; render(); } } });
    if (!S || S.kind !== 'voice' || S.topic !== pr.data.topic) { if (r.R) closeRoom(r.R, false); return { err: 'busy' }; }
    if (r.err) { S.reason = 'mic'; S.err = r.err; setState('failed'); return { err: r.err }; }
    S.room = r.R; S.t0 = Date.now(); S.state = 'live'; armConnect();
    P.sfx('join'); render(); pill(); window.dispatchEvent(new Event('d37:voice'));
    return { ok: true, code };
  };
  // Экран голосового канала (страница чата и телефон): кто внутри, войти / выйти, микрофон, звук, рация
  C.voiceView = (el, spec) => {
    const draw = () => {
      if (!el.isConnected) { window.removeEventListener('d37:voice', draw); return; }
      const here = S && S.kind === 'voice' && S.spec.kind === spec.kind && String(S.spec.channel) === String(spec.channel) && S.state !== 'ended';
      if (!here) {
        el.innerHTML = `<div class="vc"><div class="vc-head"><b>🔊 ${e(spec.name)}</b><small>до 6 человек · звук напрямую между браузерами</small></div>
          <div class="vc-note">🎧 Зайди — и говори голосом. Микрофон спросит браузер. Не называй в голосовом адрес, телефон и школу.</div>
          ${spec.kind === 'community' && !spec.member ? '<div class="vc-note">Сначала вступи в сообщество.</div>' : `<div class="vc-ctrl"><button type="button" class="go" data-v="join">🔊 Зайти в голосовой</button></div>`}
          <div class="vc-err"></div></div>`;
        el.querySelector('[data-v="join"]')?.addEventListener('click', async ev => {
          ev.currentTarget.disabled = true;
          const r = await C.voiceJoin(spec);
          if (r?.err && r.err !== 'busy') el.querySelector('.vc-err').innerHTML = `<div class="vc-note bad">${r.err === 'soon' ? '🛠️ Голосовые каналы появятся, когда сайт обновится. А пока — 🎧 голосовая компания с друзьями: телефон 📱 → «Звонки».' : r.err === 'login' ? 'Войди в аккаунт' : e(r.err)}</div>`;
          draw();
        });
        return;
      }
      el.innerHTML = sessionHtml();
      wireSession(el);
    };
    window.addEventListener('d37:voice', draw);
    draw();
  };

  // ═══ Плашка разговора на любой странице ═══
  let pillEl = null, pillT = 0;
  function pill(){
    const show = S && ['out', 'joining', 'live'].includes(S.state) && !(P.isOpen() && P.path() === 'incall');
    if (!pillEl) {
      pillEl = document.createElement('div'); pillEl.className = 'call-pill'; pillEl.setAttribute('role', 'status');
      pillEl.addEventListener('click', ev => {
        const b = ev.target.closest('[data-p]');
        if (!b) { P.open('incall'); return; }
        if (b.dataset.p === 'mute') C.voiceMute(); else if (b.dataset.p === 'leave') C.leave();
      });
      document.body.appendChild(pillEl);
      document.addEventListener('fullscreenchange', () => { const fs = document.fullscreenElement; const host = fs && fs.tagName !== 'IFRAME' && fs.tagName !== 'VIDEO' && fs !== document.documentElement ? fs : document.body; if (pillEl.parentElement !== host) host.appendChild(pillEl); });
    }
    pillEl.hidden = !show;
    clearInterval(pillT);
    if (!show) return;
    const upd = () => {
      if (!S) return;
      const n = people().length, R = S.room;
      pillEl.innerHTML = `<span class="cp-dot${R?.speaking ? ' spk' : ''}"></span><b>${S.state === 'out' ? 'Вызов…' : e(S.kind === 'call' && S.peer ? S.peer.nick : S.title)}</b><span class="cp-t">${S.t0 && S.state === 'live' ? clock() : ''}${n > 1 ? ` · ${n} 👥` : ''}</span><button type="button" data-p="mute" title="Микрофон">${R?.mute ? '🔇' : '🎙'}</button><button type="button" data-p="leave" class="cp-end" title="Завершить">✕</button>`;
    };
    upd(); pillT = setInterval(upd, 1000);
  }
  window.addEventListener('d37:route', () => setTimeout(pill, 50));
  C.pill = pill;

  // ═══ Экран разговора (телефон: incall) ═══
  const REASONS = { noanswer: 'Не отвечает', declined: 'Отклонил(а) вызов', declined_me: 'Вызов отклонён', missed: 'Пропущенный вызов', hangup: 'Звонок завершён', me: 'Звонок завершён', over: 'Звонок уже закончился', mic: '', dm: '', net: 'Нет связи' };
  const TURN_NOTE = '📡 Не получилось соединиться напрямую. Так бывает в мобильном интернете и за строгим роутером: для таких сетей нужен сервер-посредник (TURN), а на сайте его пока нет. Попробуйте оба через Wi-Fi или другой интернет.';
  function sessionHtml(){
    const ps = people(), R = S.room;
    const bad = S.netWarn || ps.some(p => p.state === 'fail');
    return `<div class="vc"><div class="vc-head"><b>${e(S.title)}</b><small>${S.t0 ? clock() + ' · ' : ''}${ps.length} из ${MAX}</small></div>
      ${S.full ? '<div class="vc-note bad">Канал полон (6 человек) — подожди, пока кто-нибудь выйдет.</div>' : ''}
      ${bad ? `<div class="vc-note bad">${TURN_NOTE}</div>` : ''}
      <div class="vc-grid">${ps.map(p => `<div class="vc-tile${p.speaking ? ' spk' : ''}${p.state === 'fail' ? ' bad' : ''}">${P.avatar(P.prof(p.uid) || null, p.nick, 64)}<b>${e(p.nick)}${p.me ? ' (ты)' : ''}</b><small>${p.state === 'fail' ? '⚠️ нет связи' : p.state === 'connecting' ? 'соединяем…' : p.speaking ? 'говорит' : ' '}</small><span class="vc-ic">${p.deaf ? '🔈' : p.mute ? '🔇' : ''}</span></div>`).join('')}</div>
      <div class="vc-ctrl">
        <button type="button" data-v="mute" class="${R?.mute ? 'on' : ''}">${R?.mute ? '🔇 Микрофон выкл' : '🎙 Микрофон'}</button>
        <button type="button" data-v="deaf" class="${R?.deaf ? 'on' : ''}">${R?.deaf ? '🔈 Звук выкл' : '🎧 Звук'}</button>
        ${P.set.ptt ? '<button type="button" class="vc-ptt" data-v="ptt">📻 Держи, чтобы говорить</button>' : ''}
        ${S.kind !== 'voice' ? '<button type="button" data-v="invite">➕ Позвать</button>' : ''}
        <button type="button" class="end" data-v="leave">📞 Выйти</button>
      </div></div>`;
  }
  function wireSession(el){
    el.querySelectorAll('[data-v]').forEach(b => {
      const k = b.dataset.v;
      if (k === 'ptt') {
        const on = v => { b.classList.toggle('held', v); setPtt(v); };
        b.addEventListener('pointerdown', ev => { ev.preventDefault(); try { b.setPointerCapture(ev.pointerId); } catch (er) {} on(true); });
        for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, () => on(false));
        return;
      }
      b.addEventListener('click', () => {
        if (k === 'mute') C.voiceMute(); else if (k === 'deaf') C.voiceDeaf(); else if (k === 'leave') C.leave();
        else if (k === 'invite') inviteSheet();
      });
    });
  }
  async function inviteSheet(){
    const f = await P.friends(true);
    const st = await P.friendStatus(f.list);
    const inside = new Set(people().map(p => p.uid));
    const list = f.list.filter(id => !inside.has(id)).sort((a, b) => (st.has(b) ? 1 : 0) - (st.has(a) ? 1 : 0));
    P.sheet(`<b>➕ Позвать в разговор</b><div class="ph-list">${list.length ? list.map(id => { const p = P.prof(id) || {}; return `<button type="button" class="ph-item" data-s="${e(id)}">${P.avatar(p, p.nick, 34)}<span><b>${e(p.nick || 'друг')}</b><small>${st.has(id) ? e(P.actText(st.get(id).a)) : 'не в сети'}</small></span>➕</button>`; }).join('') : '<div class="ph-dim">Друзей нет — найди их в чате или в мире</div>'}</div>`,
      (k) => { const p = P.prof(k); P.closeSheet(); C.invite(k, p?.nick || 'друг'); });
  }
  let incallEl = null;
  function render(){
    pill();
    if (!incallEl?.isConnected) return;
    const el = incallEl;
    if (!S) { el.innerHTML = P.head('📞 Звонок') + '<div class="ph-empty"><b>Нет звонка</b><span>Позвони другу из «Звонков» или «Друзей».</span></div>'; return; }
    const pr = S.peer ? P.prof(S.peer.uid) : null;
    if (S.state === 'in' || S.state === 'out' || (S.state === 'joining' && S.kind === 'call')) {
      const inc = S.state === 'in';
      el.innerHTML = `<div class="ph-call ring${inc ? ' in' : ''}">${P.avatar(pr, S.peer?.nick || S.title, 104)}<h3>${e(S.peer?.nick || S.title)}</h3>
        <div class="ph-cst">${inc ? (S.kind === 'party' ? '🎧 Зовёт в голосовой чат…' : '📞 Звонит тебе…') : S.state === 'out' ? 'Вызываем…' : 'Соединяем…'}</div>
        <div class="ph-meter"><i></i></div>
        <div class="ph-cbtns">${inc ? '<button type="button" class="ph-cb end" data-c="decline"><i>✕</i>Отклонить</button><button type="button" class="ph-cb ok" data-c="accept"><i>📞</i>Ответить</button>'
          : `<button type="button" class="ph-cb${S.room?.mute ? ' on' : ''}" data-c="mute"><i>${S.room?.mute ? '🔇' : '🎙'}</i>Микрофон</button><button type="button" class="ph-cb end" data-c="leave"><i>✕</i>${S.state === 'out' ? 'Отменить' : 'Положить'}</button>`}</div></div>`;
    } else if (S.state === 'ended') {
      el.innerHTML = `<div class="ph-call">${P.avatar(pr, S.peer?.nick || S.title, 96)}<h3>${e(S.peer?.nick || S.title)}</h3><div class="ph-cst">${e(REASONS[S.reason] ?? 'Звонок завершён')}${S.t0 ? ' · ' + clock() : ''}</div>
        <div class="ph-cnote"${S.err || S.reason === 'net' ? '' : ' hidden'}>${e(S.err || TURN_NOTE)}</div>
        <div class="ph-cbtns">${S.peer && S.kind === 'call' ? '<button type="button" class="ph-cb ok" data-c="again"><i>📞</i>Перезвонить</button>' : ''}<button type="button" class="ph-cb" data-c="close"><i>✓</i>Закрыть</button></div></div>`;
    } else {
      el.innerHTML = P.head(e(S.kind === 'voice' ? '🔊 ' + S.title : S.kind === 'call' ? '📞 ' + (S.peer?.nick || 'Звонок') : S.title)) + `<div class="ph-body">${sessionHtml()}</div>`;
      wireSession(el);
    }
    el.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.c;
      if (k === 'accept') C.accept(); else if (k === 'decline') C.decline(); else if (k === 'leave') C.leave(); else if (k === 'mute') C.voiceMute();
      else if (k === 'again') { const p = S?.peer; S = null; C.call(p.uid, p.nick); }
      else if (k === 'close') { S = null; P.back(); pill(); }
    }));
  }
  // уровень своего микрофона на экране вызова
  setInterval(() => { const i = incallEl?.isConnected && incallEl.querySelector('.ph-meter i'); if (i) i.style.width = Math.min(100, (S?.room?.myLevel || 0) * 900) + '%'; }, 120);

  P.define('incall', {
    render(el){ incallEl = el; render(); pill(); return () => { if (incallEl === el) incallEl = null; setTimeout(pill, 0); }; },
  });

  // ═══ Приложение «Звонки»: компания, позвонить другу, история ═══
  P.define('calls', {
    render(el, arg){
      if (arg && /^[a-z0-9]{8,16}$/.test(arg)) { el.innerHTML = '<div class="ph-load"><i></i>Входим в звонок…</div>'; C.join(arg); return; }
      const draw = async () => {
        el.innerHTML = P.head('📞 Звонки') + '<div class="ph-body"></div>';
        const b = el.querySelector('.ph-body');
        if (!P.me()) { P.login(b, 'Звонить можно друзьям — нужен аккаунт.'); return; }
        const missed = P.missed.list(), log = readLog();
        P.missed.clear();
        const f = await P.friends(true), st = await P.friendStatus(f.list);
        const fr = [...f.list].sort((x, y) => (st.has(y) ? 1 : 0) - (st.has(x) ? 1 : 0) || (P.prof(x)?.nick || '').localeCompare(P.prof(y)?.nick || ''));
        const ids = [...new Set([...missed.map(m => m.uid), ...log.map(l => l.uid)].filter(Boolean))];
        await P.profiles(ids);
        b.innerHTML = `${S && S.state !== 'ended' ? `<button type="button" class="ph-item" data-k="open"><span class="ph-ava" style="width:40px;height:40px;background:#16a34a;font-size:18px">📞</span><span><b>${e(S.title)}</b><small>Идёт разговор — открыть</small></span></button>` : ''}
          <div class="ph-row" style="margin:6px 0 4px"><button type="button" class="ph-btn" data-k="party">🎧 Голосовая компания</button></div>
          <small class="ph-dim">Компания — до 6 друзей в одном разговоре. Разговор не прерывается, когда ходишь по сайту: из мира в игру и обратно.</small>
          ${missed.length ? `<div class="ph-sec">Пропущенные</div>${missed.map(m => `<button type="button" class="ph-item miss" data-call="${e(m.uid)}">${P.avatar(P.prof(m.uid), m.nick, 38)}<span><b>${e(P.prof(m.uid)?.nick || m.nick)}</b><small>↙ пропущенный · ${e(P.ago(new Date(m.at).toISOString()))}</small></span><i class="ph-ib call">📞</i></button>`).join('')}` : ''}
          <div class="ph-sec">Позвонить другу</div>
          ${fr.length ? fr.map(id => { const p = P.prof(id) || {}, s = st.get(id); return `<div class="ph-item">${P.avatar(p, p.nick, 38)}${s ? '<i class="ph-dot"></i>' : ''}<span><b>${e(p.nick || 'друг')}</b><small>${s ? e(P.actText(s.a)) : 'не в сети'}</small></span><span class="ph-ibtns"><button type="button" class="ph-ib call" data-call="${e(id)}" aria-label="Позвонить">📞</button></span></div>`; }).join('')
            : '<div class="ph-dim" style="padding:8px">Звонить можно только друзьям. Добавь друзей в чате, в мире или по нику («Друзья»).</div>'}
          ${log.length ? `<div class="ph-sec">Недавние</div>${log.slice(0, 15).map(l => `<button type="button" class="ph-item" ${l.uid ? `data-call="${e(l.uid)}"` : ''}>${P.avatar(P.prof(l.uid), l.nick, 34)}<span><b>${e(P.prof(l.uid)?.nick || l.nick || 'звонок')}</b><small>${l.dir === 'out' ? '↗' : '↙'} ${l.kind === 'voice' ? 'голосовой' : l.kind === 'party' ? 'компания' : 'звонок'} · ${Math.floor((l.dur || 0) / 60)}:${String((l.dur || 0) % 60).padStart(2, '0')}</small></span><time>${e(P.ago(new Date(l.at).toISOString()))}</time></button>`).join('')}` : ''}`;
        b.addEventListener('click', ev => {
          const x = ev.target.closest('[data-call],[data-k]'); if (!x) return;
          if (x.dataset.k === 'party') C.party(); else if (x.dataset.k === 'open') P.go('incall');
          else if (x.dataset.call) { const p = P.prof(x.dataset.call); C.call(x.dataset.call, p?.nick || 'друг'); }
        });
      };
      draw();
    },
  });

  C._test = { FSM, step, plan, sigOk, vad, fakeMic: f => { fakeFreq = f || 0; }, state: () => S, people };
})();
