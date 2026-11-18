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
  // T-141 «🕶 Скрыть мой адрес»: звук только через наш TURN (iceTransportPolicy 'relay') — собеседник видит адрес сервера, не мой.
  // P.set.hide: 'auto' (по умолчанию: включено в детском мире — всем, кроме надёжно подтверждённых 18+) | 'on' | 'off'. Откат — HIDE_IP = false.
  const HIDE_IP = true;
  const kidsRealm = () => { const A = window.D37Age; return !A?.group || A.group() !== 'adult'; };
  C.hideIp = () => HIDE_IP && (P.set.hide === 'on' || ((P.set.hide || 'auto') === 'auto' && kidsRealm()));
  const turnList = () => (Array.isArray(window.D37_TURN) ? window.D37_TURN : []).filter(s => [].concat(s?.urls || []).some(u => /^turns?:/i.test(String(u))));
  C.relayOk = () => turnList().length > 0;
  // T-167: TURN Cloudflare Realtime через наш сервер (/api/turn-cred). Выключено, пока владелец не задаст ключи в Vercel — тогда сервер
  // отвечает { off: true } и мы 30 минут не спрашиваем. Свой TURN (D37RT, window.D37_TURN) — главнее. Откат: TURN_CF = false.
  const TURN_CF = true, cfT = { at: 0, p: null, exp: 0 };
  function cfTurn(){
    if (!TURN_CF || (Array.isArray(window.D37_TURN) && window.D37_TURN.length && !cfT.mine) || typeof sbClient === 'undefined') return Promise.resolve();
    if (cfT.p) return cfT.p;
    if (Date.now() < cfT.at || (cfT.mine && Date.now() < cfT.exp)) return Promise.resolve();
    cfT.p = (async () => {
      try {
        const tok = (await sbClient.auth.getSession())?.data?.session?.access_token; if (!tok) { cfT.at = Date.now() + 60e3; return; }
        const r = await fetch('/api/turn-cred', { headers: { Authorization: 'Bearer ' + tok }, cache: 'no-store' });
        const j = r.ok ? await r.json() : null;
        if (!j?.ok || !Array.isArray(j.iceServers) || !j.iceServers.length) { cfT.at = Date.now() + 30 * 60e3; return; }
        if (window.D37_TURN === undefined || window.D37_TURN === cfT.mine) { window.D37_TURN = j.iceServers; cfT.mine = j.iceServers; cfT.exp = Date.now() + (j.ttl || 3600) * 1000 - 5 * 60e3; }
      } catch (er) { cfT.at = Date.now() + 5 * 60e3; }
      finally { cfT.p = null; }
    })();
    return cfT.p;
  }
  // перед входом в комнату: адрес скрываем, а пароли TURN ещё не пришли — попросить и подождать до 4 с
  async function ensureRelay(){
    if (TURN_CF) await Promise.race([cfTurn(), new Promise(r => setTimeout(r, 1500))]);
    if (!C.hideIp() || C.relayOk()) return;
    try { window.D37RT?.prefetchTurn?.(); window.D37RT?.ice?.(); } catch (er) {}
    for (let i = 0; i < 20 && !C.relayOk(); i++) await new Promise(r => setTimeout(r, 200));
  }
  const RELAY_NOTE = '🕶 Адрес скрыт, но сервер-посредник сейчас недоступен — звук не соединится. Попробуй через минуту или выключи «Скрыть мой адрес» в ⚙️ → 📱 Телефон (тогда собеседник сможет узнать твой адрес в сети).';
  const MAX = 6, RING_MS = 40000, DIAL_MS = 35000, CONNECT_MS = 30000;
  // T-167 (владелец 19.11: «вебкамера, проверка камеры, микро… прямое подключение… количество участников в войсе»). Откат — по флагу:
  //   DEVCHECK — экран «🎛 Проверка микрофона и камеры» и выбор устройств; CAM_ON — камера в звонках и голосовых (по возрасту — решает
  //   сервер: cam_me / cv_pass.cam, community.sql ч. 15; без ч. 15 кнопки камеры нет); NETFIX — перезапуск ICE вместо нового соединения,
  //   состояние у каждого, «нет интернета → вернулся»; VLIMIT — лимит голосового канала и «кто внутри» (cv_who / cv_ping / cv_leave);
  //   UVOL — своя громкость каждого собеседника (нажми на плитку).
  const DEVCHECK = true, CAM_ON = true, NETFIX = true, VLIMIT = true, UVOL = true;
  // выбранные устройства — на этом устройстве (d37_phone): micId / camId / spkId; шумоподавление ns, эхо ec, автогромкость agc
  const micC = () => Object.assign({ echoCancellation: P.set.ec !== false, noiseSuppression: P.set.ns !== false, autoGainControl: P.set.agc !== false, channelCount: 1 },
    DEVCHECK && P.set.micId ? { deviceId: { ideal: P.set.micId } } : {});
  const camC = () => Object.assign({ width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 24 } }, DEVCHECK && P.set.camId ? { deviceId: { ideal: P.set.camId } } : {});
  const sinkOk = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  const setSink = el => { if (DEVCHECK && sinkOk && P.set.spkId && el?.setSinkId) el.setSinkId(P.set.spkId).catch(() => {}); };
  // громкость каждого: uid → 0…1 (localStorage d37_uvol)
  const UV = (() => { try { return JSON.parse(localStorage.getItem('d37_uvol') || '{}') || {}; } catch (er) { return {}; } })();
  const uvOf = uid => (UVOL && uid && Number.isFinite(UV[uid]) ? Math.max(0, Math.min(1, UV[uid])) : 1);
  const camErr = er => {
    const n = er?.name || '';
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return '📷 Нет доступа к камере. Нажми на значок 🔒 слева от адреса сайта → «Камера» → «Разрешить» и попробуй ещё раз.';
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return '📷 Камера не найдена. Подключи камеру или выбери другую в «🎛 Проверка».';
    if (n === 'NotReadableError') return '📷 Камера занята другой программой (Zoom, OBS?) — закрой её.';
    if (n === 'SecurityError') return '📷 Камера работает только на https-адресе сайта.';
    return '📷 Не удалось включить камеру: ' + (er?.message || n || 'ошибка');
  };
  // видео по числу людей: чем больше, тем меньше (сетка — каждый шлёт каждому)
  const camCap = n => (n <= 2 ? { maxBitrate: 600000, scaleResolutionDownBy: 1, maxFramerate: 24 } : n <= 4 ? { maxBitrate: 280000, scaleResolutionDownBy: 1.5, maxFramerate: 15 } : { maxBitrate: 150000, scaleResolutionDownBy: 2, maxFramerate: 12 });
  const e = s => esc(s);
  // Безопасность детей (community.sql ч. 5, js/core/age.js): до 9 — звонков нет; ребёнку до 13 — не со взрослыми и не с «без возраста»
  const kidMsg = k => window.D37Age?.kidMsg?.(k) || '🚫 Нельзя позвонить этому игроку';
  const kidBlock = uid => (window.D37Age?.contact ? window.D37Age.contact(uid).catch(() => null) : Promise.resolve(null));
  const u9 = () => !!window.D37Age?.u9?.();
  const dmErr = error => /row-level|42501/i.test(error?.message || '') || error?.code === '42501' ? kidMsg('nocall') : P.err(error);
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
  // T-141: те же подписи и настройки ICE — для передачи файлов (js/features/files.js): один код подписи на звонки и файлы
  C.sig = { myKeys, importPub, sign, verifySig };
  C.iceConfig = async () => { await ensureRelay(); return C.hideIp() ? { iceServers: turnList(), iceTransportPolicy: 'relay', relay: true, ok: C.relayOk() } : { iceServers: ICE(), relay: false, ok: true }; };
  C.inCall = C.inCall || (() => false);

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
    try { return await navigator.mediaDevices.getUserMedia({ audio: micC(), video: false }); }
    catch (er) {   // выбранного микрофона больше нет — берём любой
      if (P.set.micId && (er?.name === 'NotFoundError' || er?.name === 'OverconstrainedError')) return navigator.mediaDevices.getUserMedia({ audio: Object.assign(micC(), { deviceId: undefined }), video: false });
      throw er;
    }
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
    if (!opt.observe) await ensureRelay(); else cfTurn();
    const keys = await myKeys();
    const myKey = (opt.me.uid || 'g') + '~' + rid(6);
    const R = { opt, myKey, keys, members: new Map(), verified: new Map(), pubs: new Map(), peers: new Map(), early: new Map(), stream: opt.stream,
      closed: false, mute: false, deaf: false, at: Date.now(), state: 'joining', changeT: 0, hiT: new Map(), seen: false,
      camOk: CAM_ON && opt.cam === true, camTrack: null, vids: new Map(), net: { restarts: 0, rebuilds: 0, drops: 0 } };
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
    if (R.camTrack) { try { R.camTrack.stop(); } catch (er) {} R.camTrack = null; }
    for (const v of R.vids.values()) { v.srcObject = null; v.remove(); }
    R.vids.clear();
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
    const p = { key, offerer, sid: '', state: 'connecting', tries: 0, timer: 0, ice: [], iceT: 0, pend: [], audio: null, an: null, vad: {}, speaking: false, mute: false, deaf: false,
      t0: Date.now(), tc: 0, restarts: 0, discT: 0, route: '', vt: null, vstream: null, cam: false };
    makePc(R, p);
    return p;
  }
  function makePc(R, p){
    try { p.pc?.close(); } catch (er) {}
    const hide = C.hideIp();
    const pc = new RTCPeerConnection(hide ? { iceServers: turnList(), iceTransportPolicy: 'relay' } : { iceServers: ICE() });
    p.pc = pc; p.relay = hide;
    if (R.stream) R.stream.getTracks().forEach(t => pc.addTrack(t, R.stream));
    // T-167 камера: место под видео есть с самого начала (вкл/выкл — replaceTrack, без нового знакомства)
    p.vt = null;
    if (R.camOk && p.offerer) { try { p.vt = pc.addTransceiver('video', { direction: 'sendrecv' }); if (R.camTrack) p.vt.sender.replaceTrack(R.camTrack).catch(() => {}); } catch (er) { p.vt = null; } }
    pc.onicecandidate = ev => {
      if (!ev.candidate || pc !== p.pc) return;
      if (hide && !/ typ relay/.test(ev.candidate.candidate || '')) return;   // на всякий случай: свой адрес не отдаём никогда
      p.ice.push(ev.candidate.toJSON());
      if (!p.iceT) p.iceT = setTimeout(() => { p.iceT = 0; const c = p.ice.splice(0, 40); if (c.length) R.send({ t: 'ice', to: p.key, sid: p.sid, c }); }, 250);   // пачкой: меньше сообщений
    };
    pc.ontrack = ev => {
      if (pc !== p.pc) return;
      if (ev.track.kind === 'video') { p.vstream = new MediaStream([ev.track]); R.changed(); return; }
      attachAudio(R, p, ev.streams[0] || new MediaStream([ev.track]));
    };
    pc.onconnectionstatechange = () => {
      if (pc !== p.pc) return;
      const s = pc.connectionState;
      clearTimeout(p.discT);
      if (s === 'connected') {
        p.state = 'ok'; clearTimeout(p.timer); p.restarts = 0;
        if (!p.tc) p.tc = Date.now() - p.t0;
        R.changed(); R.opt.onConnected?.(R, p); routeOf(R, p); camCaps(R);
        if (R.camTrack || R.mute || R.deaf) R.send({ t: 'st', mute: R.mute, deaf: R.deaf, cam: !!R.camTrack });   // новенький узнаёт, что у меня камера / микрофон
      } else if (s === 'failed') {
        if (!NETFIX) { if (p.offerer && p.tries < 3) offer(R, p); else { p.state = 'fail'; R.changed(); } return; }
        if (p.offerer) { if (p.restarts < 2) restart(R, p); else if (p.tries < 4) { R.net.rebuilds++; offer(R, p); } else { p.state = 'fail'; R.changed(); } }
        else { p.state = 'reconnect'; R.send({ t: 'hi', to: p.key }); R.changed(); }   // предлагает тот, кто вошёл раньше — попросить
      } else if (s === 'disconnected') {
        p.state = NETFIX ? 'reconnect' : 'connecting'; R.net.drops++; R.changed();
        // связь моргнула: 3 с ждём сама вернётся, потом — перезапуск ICE (тот же разговор, новые пути)
        if (NETFIX && p.offerer) p.discT = setTimeout(() => { if (pc === p.pc && pc.connectionState !== 'connected' && !R.closed) restart(R, p); }, 3000);
      }
    };
  }
  // T-167: перезапуск ICE — то же соединение (тот же sid), только новые пути; звук не надо заново знакомить
  async function restart(R, p){
    if (R.closed || !p.pc) return;
    p.restarts++; R.net.restarts++; p.state = 'reconnect'; R.changed();
    clearTimeout(p.timer);
    p.timer = setTimeout(() => { if (!R.closed && p.state !== 'ok' && R.peers.get(p.key) === p) { if (p.tries < 4) { R.net.rebuilds++; offer(R, p); } else { p.state = 'fail'; R.changed(); } } }, 9000);
    try {
      const pc = p.pc;
      pc.restartIce?.();
      await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
      R.send({ t: 'offer', to: p.key, sid: p.sid, sdp: pc.localDescription.toJSON() });
    } catch (er) { if (p.tries < 4) { R.net.rebuilds++; offer(R, p); } else { p.state = 'fail'; R.changed(); } }
  }
  // как соединились: напрямую или через сервер-посредник (TURN) — честно в плитке
  async function routeOf(R, p){
    try {
      const st = await p.pc.getStats(); let pair = null; const loc = new Map();
      st.forEach(x => { if (x.type === 'transport' && x.selectedCandidatePairId) pair = st.get(x.selectedCandidatePairId); if (x.type === 'local-candidate') loc.set(x.id, x); });
      if (!pair) st.forEach(x => { if (x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded') pair = x; });
      const lc = pair && loc.get(pair.localCandidateId);
      p.route = lc ? (lc.candidateType === 'relay' ? 'relay' : 'direct') : '';
      R.changed();
    } catch (er) {}
  }
  // камера: ограничение видео по числу людей (на каждом отправителе)
  function camCaps(R){
    if (!R.camOk) return;
    const cap = camCap(R.peers.size + 1);
    for (const p of R.peers.values()) {
      const snd = p.vt?.sender; if (!snd?.getParameters) continue;
      try { const prm = snd.getParameters(); prm.encodings = prm.encodings?.length ? prm.encodings : [{}]; Object.assign(prm.encodings[0], cap); snd.setParameters(prm).catch(() => {}); } catch (er) {}
    }
  }
  async function offer(R, p){
    if (R.closed) return;
    p.tries++; p.sid = rid(8); p.state = 'connecting'; p.pend = [];
    if (p.tries > 1) makePc(R, p);
    clearTimeout(p.timer);
    p.timer = setTimeout(() => { if (!R.closed && p.state !== 'ok' && R.peers.get(p.key) === p) { if (p.tries < 3) offer(R, p); else { p.state = 'fail'; R.changed(); } } }, 9000);
    try {
      const pc = p.pc;
      await pc.setLocalDescription(await pc.createOffer());
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
        if (CAM_ON) {
          const vt = p.pc.getTransceivers().find(t => !t.stopped && t.receiver?.track?.kind === 'video' && t.mid != null);
          if (vt) { p.vt = R.camOk ? vt : null; try { vt.direction = R.camOk ? 'sendrecv' : 'inactive'; if (R.camOk) await vt.sender.replaceTrack(R.camTrack || null); } catch (er) {} }
        }
        for (const c of R.early.get(from + '/' + d.sid) || []) await p.pc.addIceCandidate(c).catch(() => {});
        R.early.delete(from + '/' + d.sid);
        await p.pc.setLocalDescription(await p.pc.createAnswer());
        R.send({ t: 'answer', to: from, sid: d.sid, sdp: p.pc.localDescription.toJSON() });
      } catch (er) { p.state = 'fail'; R.changed(); }
    } else if (d.t === 'answer') {
      const p = R.peers.get(from); if (!p || !p.offerer || p.sid !== d.sid) return;
      try { await p.pc.setRemoteDescription(d.sdp); for (const c of p.pend.splice(0)) await p.pc.addIceCandidate(c).catch(() => {}); } catch (er) {}
      // T-167: перезапуск ICE на живом соединении — состояние так и остаётся «connected», события не будет: отмечаем сами
      if (p.state === 'reconnect' && p.pc.connectionState === 'connected') { p.state = 'ok'; p.restarts = 0; clearTimeout(p.timer); R.changed(); routeOf(R, p); }
    } else if (d.t === 'ice') {
      const p = R.peers.get(from);
      if (!p || p.sid !== d.sid) { const k = from + '/' + d.sid, l = R.early.get(k) || []; if (l.length < 80) R.early.set(k, l.concat(d.c)); return; }
      for (const c of d.c) { if (p.pc.remoteDescription) await p.pc.addIceCandidate(c).catch(() => {}); else p.pend.push(c); }
    } else if (d.t === 'hi') {
      const p = R.peers.get(from); if (p && p.offerer && p.state !== 'ok') { p.tries = 0; offer(R, p); }
    } else if (d.t === 'st') {
      const p = R.peers.get(from); if (m) { m.mute = !!d.mute; m.deaf = !!d.deaf; m.cam = !!d.cam; }
      if (p) { p.mute = !!d.mute; p.deaf = !!d.deaf; p.cam = !!d.cam; }
      R.changed();
    } else if (d.t === 'decline') R.opt.onDecline?.(R, m);
    else if (d.t === 'bye') { const p = R.peers.get(from); if (p) { dropPeer(R, p); R.peers.delete(from); } }
  }
  function dropPeer(R, p){
    clearTimeout(p.timer); clearTimeout(p.iceT); clearTimeout(p.discT);
    const v = R.vids?.get(p.key); if (v) { v.srcObject = null; v.remove(); R.vids.delete(p.key); }
    try { p.pc.close(); } catch (er) {}
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    try { p.an?.src.disconnect(); } catch (er) {}
    const t = R.hiT.get(p.key); if (t) { clearTimeout(t); R.hiT.delete(p.key); }
  }
  // громкость собеседников — окно ⚙️: «🔊 Звук» → «Общая громкость» × «Голос» (settings.js → D37Opt); «звук в играх» звонок не глушит
  const voiceVol = () => { const O = window.D37Opt; const v = O ? (O.vol ?? 1) * (O.volVoice ?? 1) : 1; return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1; };
  const peerVol = (R, p) => voiceVol() * uvOf(R?.members?.get(p.key)?.uid);
  window.addEventListener('d37:settings', () => { const R = S?.room; for (const p of R?.peers?.values() || []) if (p.audio) p.audio.volume = peerVol(R, p); });
  function attachAudio(R, p, stream){
    if (!p.audio) { p.audio = document.createElement('audio'); p.audio.autoplay = true; p.audio.setAttribute('playsinline', ''); document.getElementById('d37Audio').appendChild(p.audio); }
    p.audio.srcObject = stream; p.audio.muted = R.deaf; p.audio.volume = peerVol(R, p); setSink(p.audio);
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
    R.stream?.getAudioTracks().forEach(t => { try { t.applyConstraints?.({ echoCancellation: P.set.ec !== false, noiseSuppression: P.set.ns !== false, autoGainControl: P.set.agc !== false })?.catch?.(() => {}); } catch (er) {} });
    for (const p of R.peers.values()) if (p.audio) setSink(p.audio);
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
    const out = [{ key: R.myKey, uid: P.me(), nick: P.myNick() || 'Я', me: true, speaking: !!R.speaking, mute: R.mute || (P.set.ptt && !pttHeld), deaf: R.deaf, state: 'ok', cam: !!R.camTrack }];
    for (const [key, m] of R.members) {
      if (key === R.myKey || R.verified.get(key) !== true) continue;
      const p = R.peers.get(key);
      out.push({ key, uid: m.uid, nick: m.nick, speaking: !!p?.speaking, mute: !!(p?.mute || m.mute), deaf: !!(p?.deaf || m.deaf), state: p ? p.state : (R.failed?.has(key) ? 'fail' : 'connecting'),
        cam: !!(R.camOk && p?.cam && p?.vstream), route: p?.route || '' });
    }
    return out;
  };
  C.voiceInfo = () => S && S.kind === 'voice' && S.state !== 'ended' ? { kind: S.spec.kind, channel: S.spec.channel, title: S.title, state: S.room?.full ? 'full' : people().some(p => !p.me && p.state === 'ok') || people().length === 1 ? 'ok' : 'wait', mute: !!S.room?.mute, deaf: !!S.room?.deaf, people: people() } : null;

  // ── начать разговор: микрофон, комната ──
  async function startRoom(opt){
    let stream;
    try { stream = await getMic(); } catch (er) { return { err: micErr(er) }; }
    if (CAM_ON && opt.cam === undefined) { const cm = await P.rpc('cam_me'); opt.cam = cm.data?.cam === true; }   // звонок / компания: можно ли мне камеру
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
    clearInterval(s.pingT);
    if (VLIMIT && s.kind === 'voice' && s.spec && s.passOk) P.rpc('cv_leave', { p_channel: s.spec.channel });
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

  // ═══ Пропуск в звонок (community.sql ч. 5: call_pass / call_check), как у голосовых каналов ═══
  // Соседи по комнате call-<код> проверяют пропуск на сервере: ник — из базы, ребёнок до 13 и взрослый / «без возраста» друг друга не
  // проходят (браузер соединяется только с прошедшими), до 9 лет — пропуска нет. Нет функции на сервере (SQL не запущен) или нет
  // связи — как раньше, без пропуска (а у того, кто с пропуском, «без пропуска» не пройдёт — ребёнка это не откроет).
  async function callSpec(code){
    if (u9()) return { err: kidMsg('u9') };
    let keys; try { keys = await myKeys(); } catch (er) { return {}; }
    const pr = await P.rpc('call_pass', { p_code: code, p_pub: keys.pub });
    if (pr.error || !pr.data) return {};
    if (!pr.data.ok) return pr.data.reason === 'u9' ? { err: kidMsg('u9') } : {};
    return { pass: pr.data.pass, verify: async m => {
      if (typeof m.pass !== 'string' || typeof m.pub !== 'string') return null;
      const { data } = await P.rpc('call_check', { p_code: code, p_pass: m.pass, p_pub: m.pub });
      if (data?.ok && data.uid === m.uid) return { uid: data.uid, nick: data.nick };
      if (data?.ok === false && (data.reason === 'age' || data.reason === 'u9') && S?.code === code && !S.kidBlocked) { S.kidBlocked = data.reason; render(); }
      return null;
    } };
  }
  const withSpec = (opt, sp) => (sp.pass ? Object.assign(opt, { pass: sp.pass, verify: sp.verify }) : opt);

  // ═══ Позвонить другу ═══
  C.call = async (uid, nick) => {
    if (!P.me()) { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); return; }
    const kb = await kidBlock(uid);
    if (kb) { P.toast(kidMsg(kb), false); return; }
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
    const sp = await callSpec(code);
    if (!S || S.code !== code) return;
    if (sp.err) { S.reason = 'dm'; S.err = sp.err; setState('failed'); return; }
    const r = await startRoom(withSpec({ topic: S.topic, max: MAX,
      onEmpty: () => { if (S?.room && S.state === 'live') { S.reason = 'hangup'; setState('hangup'); } },
      onDecline: () => { if (S?.state === 'out') { S.reason = 'declined'; setState('declined'); } } }, sp));
    if (!S || S.code !== code) { if (r.R) closeRoom(r.R, false); return; }
    if (r.err) { S.reason = 'mic'; S.err = r.err; setState('failed'); return; }
    S.room = r.R;
    // вызов — личным сообщением (его может прислать только друг; ребёнку взрослый — нет: сервер, community.sql ч. 5)
    const link = `https://dan4ik37.vercel.app/#/phone/call/${code}`;
    const { error } = await sbClient.from('direct_messages').insert([{ sender_id: P.me(), recipient_id: uid, text: `📞 Звоню тебе! ${link}` }]);
    if (error) { S.reason = 'dm'; S.err = dmErr(error); setState('failed'); return; }
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
    const kb = await kidBlock(uid);
    if (kb) { P.toast(kidMsg(kb), false); return; }
    const { error } = await sbClient.from('direct_messages').insert([{ sender_id: P.me(), recipient_id: uid, text: `🎧 Зову в голосовой чат! https://dan4ik37.vercel.app/#/phone/call/${S.code}` }]);
    P.toast(error ? dmErr(error) : `📨 Позвал(а) ${nick}`, !error);
  };
  // Голосовая компания: своя комната, зовёшь друзей
  C.party = async () => {
    if (!P.me()) { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); return; }
    if (S && S.state !== 'ended') { P.go('incall'); return; }
    if (u9()) { P.toast(kidMsg('u9'), false); return; }
    const code = rid(10);
    S = { kind: 'party', dir: 'out', state: 'idle', code, topic: 'call-' + code, title: '🎧 Голосовая компания', at: Date.now() };
    setState('join');
    P.go('incall');
    const sp = await callSpec(code);
    if (!S || S.code !== code) return;
    if (sp.err) { S.reason = 'dm'; S.err = sp.err; setState('failed'); return; }
    const r = await startRoom(withSpec({ topic: S.topic, max: MAX }, sp));
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
    const sp = await callSpec(code);
    if (!S || S.code !== code) return;
    if (sp.err) { S.reason = 'dm'; S.err = sp.err; setState('failed'); return; }
    const r = await startRoom(withSpec({ topic: S.topic, max: MAX,
      onEmpty: () => { if (S?.room && S.state === 'live' && S.kind === 'call') { S.reason = 'hangup'; setState('hangup'); } } }, sp));
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
    const sp = await callSpec(s.code);
    if (S !== s) return;
    if (sp.err) { s.reason = 'dm'; s.err = sp.err; setState('failed'); return; }
    const r = await startRoom(withSpec({ topic: s.topic, max: MAX, onEmpty: () => { if (S === s && s.state === 'live' && s.kind === 'call') { s.reason = 'hangup'; setState('hangup'); } } }, sp));
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
    if (u9()) return { err: kidMsg('u9voice') };   // до 9 — голосовых нет (сервер не даст пропуск и сам: cv_pass)
    if (S && S.state !== 'ended') {
      if (S.kind === 'voice' && S.spec.kind === spec.kind && String(S.spec.channel) === String(spec.channel)) return { ok: true };
      if (await P.ask('Ты уже разговариваешь. Выйти и зайти в этот канал?', [{ k: 'yes', t: '🔊 Перейти' }]) !== 'yes') return { err: 'busy' };
      C.leave(); await new Promise(r => setTimeout(r, 300));
    }
    const keys = await myKeys();
    const pr = await P.rpc('cv_pass', { p_channel: spec.channel, p_pub: keys.pub });
    if (pr.error) return { err: pr.missing ? 'soon' : P.err(pr.error) };
    if (!pr.data?.ok) return { err: { member: 'Сначала вступи в сообщество', banned: 'Тебя забанили', muted: 'Тебя заглушили в чате', new: 'Голосовой канал сайта — для аккаунтов старше суток', not_found: 'Канал не найден', u9: kidMsg('u9voice'), full: `👥 Канал заполнен (${+pr.data?.max || MAX} из ${+pr.data?.max || MAX}) — подожди, пока кто-нибудь выйдет.` }[pr.data?.reason] || 'Не получилось' };
    const code = 'v' + spec.channel;
    S = { kind: 'voice', dir: 'out', state: 'idle', code: null, topic: pr.data.topic, title: spec.title, spec, at: Date.now() };
    setState('join');
    const ch = spec.channel;
    S.passOk = true;
    const r = await startRoom({ topic: pr.data.topic, max: pr.data.max || MAX, pass: pr.data.pass, cam: CAM_ON && pr.data.cam === true,
      verify: async m => { if (typeof m.pass !== 'string') return null; const { data } = await P.rpc('cv_check', { p_channel: ch, p_pass: m.pass, p_pub: m.pub }); return data && data.uid === m.uid ? { uid: data.uid, nick: data.nick } : null; },
      onFull: () => { if (S?.kind === 'voice') { S.full = true; render(); } } });
    if (!S || S.kind !== 'voice' || S.topic !== pr.data.topic) { if (r.R) closeRoom(r.R, false); return { err: 'busy' }; }
    if (r.err) { S.reason = 'mic'; S.err = r.err; setState('failed'); return { err: r.err }; }
    S.room = r.R; S.t0 = Date.now(); S.state = 'live'; armConnect();
    // ч. 15: «я ещё тут» раз в 25 с (сервер считает людей для лимита; без ч. 15 — функции нет, P.rpc запомнит)
    if (VLIMIT && pr.data.max !== undefined) { const s = S; s.pingT = setInterval(() => { if (S === s && s.state === 'live') P.rpc('cv_ping', { p_channel: ch }); else clearInterval(s.pingT); }, 25000); }
    P.sfx('join'); render(); pill(); window.dispatchEvent(new Event('d37:voice'));
    return { ok: true, code };
  };
  // Экран голосового канала (страница чата и телефон): кто внутри, войти / выйти, микрофон, звук, рация
  C.voiceView = (el, spec) => {
    const draw = () => {
      if (!el.isConnected) { window.removeEventListener('d37:voice', draw); return; }
      const here = S && S.kind === 'voice' && S.spec.kind === spec.kind && String(S.spec.channel) === String(spec.channel) && S.state !== 'ended';
      if (!here) {
        el.innerHTML = `<div class="vc"><div class="vc-head"><b>🔊 ${e(spec.name)}</b><small class="vc-cap">до ${MAX} человек · ${C.hideIp() ? '🕶 адрес скрыт' : 'звук напрямую между браузерами'}</small></div>
          <div class="vc-note">🎧 Зайди — и говори голосом. Микрофон спросит браузер. Не называй в голосовом адрес, телефон и школу.</div>
          <div class="vc-who" hidden></div>
          ${spec.kind === 'community' && !spec.member ? '<div class="vc-note">Сначала вступи в сообщество.</div>' : `<div class="vc-ctrl"><button type="button" class="go" data-v="join">🔊 Зайти в голосовой</button>${DEVCHECK ? '<button type="button" data-v="dev" title="Проверить микрофон, звук и камеру">🎛 Проверка</button>' : ''}</div>`}
          <div class="vc-err"></div></div>`;
        el.querySelector('[data-v="dev"]')?.addEventListener('click', () => P.open('devcheck'));
        if (VLIMIT && P.me()) whoBox(el, spec);
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

  if (NETFIX) {
    window.addEventListener('online', () => { const R = S?.room; if (!R) return; for (const p of R.peers.values()) if (p.state !== 'ok' && p.offerer) restart(R, p); else if (p.state !== 'ok') R.send({ t: 'hi', to: p.key }); R.changed(); });
    window.addEventListener('offline', () => { S?.room?.changed(); });
  }

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
  const TURN_NOTE0 = '📡 Не получилось соединиться. Так бывает в мобильном интернете и за строгим роутером, когда сервер-посредник (TURN) недоступен. Попробуйте оба через Wi-Fi или другой интернет.';
  const TURN_NOTE_FN = () => C.hideIp() && !C.relayOk() ? RELAY_NOTE : TURN_NOTE0;
  // строка «🕶 адрес скрыт / виден» — честно, как соединяемся сейчас
  const privHtml = () => !HIDE_IP ? '' : C.hideIp() ? (C.relayOk() ? '<div class="vc-note vc-priv">🕶 Твой адрес скрыт — звук идёт через сервер-посредник.</div>' : `<div class="vc-note bad">${RELAY_NOTE}</div>`)
    : '<div class="vc-note vc-priv dim">🌐 Звук напрямую — собеседник может узнать твой адрес в сети. Скрыть — ⚙️ → 📱 Телефон.</div>';
  function sessionHtml(){
    const ps = people(), R = S.room;
    const bad = S.netWarn || ps.some(p => p.state === 'fail');
    const max = R?.opt?.max || MAX, off = NETFIX && navigator.onLine === false;
    return `<div class="vc"><div class="vc-head"><b>${e(S.title)}</b><small>${S.t0 ? clock() + ' · ' : ''}${ps.length} из ${+max}</small></div>
      ${S.full ? `<div class="vc-note bad">👥 Канал заполнен (${+max} из ${+max}) — подожди, пока кто-нибудь выйдет.</div>` : ''}
      ${off ? '<div class="vc-note bad">📡 Нет интернета — разговор вернётся сам, как только связь появится.</div>' : ''}
      ${S.kidBlocked ? `<div class="vc-note bad">${e(kidMsg(S.kidBlocked === 'u9' ? 'u9' : 'agecall'))}</div>` : ''}
      ${bad ? `<div class="vc-note bad">${TURN_NOTE_FN()}</div>` : privHtml()}
      <div class="vc-grid${ps.some(p => p.cam) ? ' vc-vgrid' : ''}">${ps.map(p => `<div class="vc-tile${p.speaking ? ' spk' : ''}${p.state === 'fail' ? ' bad' : ''}${p.cam ? ' vid' : ''}" data-vk="${e(p.key)}"${!p.me && UVOL && p.uid ? ` data-vu="${e(p.uid)}" role="button" title="Громкость ${e(p.nick)}"` : ''}>${p.cam ? '<span class="vc-vid"></span>' : P.avatar(P.prof(p.uid) || null, p.nick, 64)}<b>${e(p.nick)}${p.me ? ' (ты)' : ''}</b><small>${tileState(p)}</small><span class="vc-ic">${p.deaf ? '🔈' : p.mute ? '🔇' : ''}${!p.me && uvOf(p.uid) < 1 ? '🔉' : ''}</span></div>`).join('')}</div>
      <div class="vc-ctrl">
        <button type="button" data-v="mute" class="${R?.mute ? 'on' : ''}">${R?.mute ? '🔇 Микрофон выкл' : '🎙 Микрофон'}</button>
        <button type="button" data-v="deaf" class="${R?.deaf ? 'on' : ''}">${R?.deaf ? '🔈 Звук выкл' : '🎧 Звук'}</button>
        ${R?.camOk ? `<button type="button" data-v="cam" class="${R.camTrack ? 'on' : ''}">${R.camTrack ? '📷 Камера вкл' : '📷 Камера'}</button>` : ''}
        ${P.set.ptt ? '<button type="button" class="vc-ptt" data-v="ptt">📻 Держи, чтобы говорить</button>' : ''}
        ${S.kind !== 'voice' ? '<button type="button" data-v="invite">➕ Позвать</button>' : ''}
        ${INV_ON && P.gameInvite ? '<button type="button" data-v="ginv" title="Позвать в игру или на сервер">📍 В игру</button>' : ''}
        ${DEVCHECK ? '<button type="button" data-v="dev" title="Проверить микрофон, звук и камеру" aria-label="Проверка устройств">🎛</button>' : ''}
        <button type="button" data-v="set" title="Настройки звонка" aria-label="Настройки звонка">⚙️</button>
        <button type="button" class="end" data-v="leave">📞 Выйти</button>
      </div></div>`;
  }
  // подпись под плиткой: как идёт связь (честно)
  const tileState = p => p.state === 'fail' ? '⚠️ нет прямой связи' : p.state === 'reconnect' ? '🔄 переподключаем…' : p.state === 'connecting' ? 'соединяем…'
    : p.speaking ? 'говорит' : !p.me && p.route === 'relay' ? 'через посредник' : ' ';
  // видео — одни и те же элементы <video> переносятся в новую плитку (экран перерисовывается часто — без мигания)
  function attachVideos(el){
    const R = S?.room; if (!R) return;
    el.querySelectorAll('.vc-tile.vid[data-vk]').forEach(t => {
      const k = t.dataset.vk, me = k === R.myKey, p = me ? null : R.peers.get(k);
      const src = me ? (R.camTrack ? (R.camPrev = R.camPrev?.getTracks()[0] === R.camTrack ? R.camPrev : new MediaStream([R.camTrack])) : null) : p?.vstream;
      if (!src) return;
      let v = R.vids.get(k);
      if (!v) { v = document.createElement('video'); v.autoplay = true; v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); if (me) v.className = 'me'; R.vids.set(k, v); }
      if (v.srcObject !== src) { v.srcObject = src; v.play().catch(() => {}); }
      t.querySelector('.vc-vid')?.appendChild(v);
    });
  }
  // камера вкл / выкл (только если сервер разрешил — R.camOk)
  C.camToggle = async () => {
    const R = S?.room; if (!R) return;
    if (!R.camOk) { P.toast('📷 Камера в звонках пока недоступна для твоего возраста (или возраст не указан)', false); return; }
    if (R.camTrack) {
      try { R.camTrack.stop(); } catch (er) {}
      R.camTrack = null;
      for (const p of R.peers.values()) p.vt?.sender.replaceTrack(null).catch(() => {});
    } else {
      let st; try { st = await navigator.mediaDevices.getUserMedia({ video: camC(), audio: false }); } catch (er) { P.toast(camErr(er), false); return; }
      if (S?.room !== R || R.closed) { st.getTracks().forEach(t => t.stop()); return; }
      R.camTrack = st.getVideoTracks()[0];
      R.camTrack.onended = () => { if (R.camTrack) C.camToggle(); };
      for (const p of R.peers.values()) p.vt?.sender.replaceTrack(R.camTrack).catch(() => {});
      camCaps(R);
    }
    R.send({ t: 'st', mute: R.mute, deaf: R.deaf, cam: !!R.camTrack }); R.changed();
  };
  // своя громкость собеседника (0–100 %, на этом устройстве)
  function volSheet(uid){
    const nick = people().find(p => p.uid === uid)?.nick || 'игрок', v = Math.round(uvOf(uid) * 100);
    P.sheet(`<b>🔉 Громкость: ${e(nick)}</b><div class="gs-range" style="margin:12px 0"><input type="range" min="0" max="100" step="5" value="${v}" data-uv aria-label="Громкость"><output>${v}%</output></div><small class="ph-dim">Только у тебя. Общая громкость голоса — ⚙️ → «🔊 Звук».</small>`, () => {});
    const inp = document.querySelector('[data-uv]'); if (!inp) return;
    inp.addEventListener('input', () => {
      const x = (+inp.value) / 100; UV[uid] = x; if (x >= 1) delete UV[uid];
      try { localStorage.setItem('d37_uvol', JSON.stringify(UV)); } catch (er) {}
      inp.nextElementSibling.textContent = inp.value + '%';
      const R = S?.room; for (const p of R?.peers?.values() || []) if (p.audio && R.members.get(p.key)?.uid === uid) p.audio.volume = peerVol(R, p);
    });
  }
  // «кто внутри» и лимит — до входа (ч. 15: cv_who); управляющий каналами меняет лимит прямо тут
  async function whoBox(el, spec){
    const r = await P.rpc('cv_who', { p_channel: spec.channel });
    const box = el.querySelector('.vc-who'); if (!box || !r.data?.ok) return;
    const d = r.data, ppl = Array.isArray(d.people) ? d.people : [], max = +d.max || MAX, cap = +d.cap || MAX;
    el.querySelector('.vc-cap').textContent = `${ppl.length} из ${max} · ${C.hideIp() ? '🕶 адрес скрыт' : 'звук напрямую между браузерами'}`;
    box.hidden = false;
    box.innerHTML = `${ppl.length ? `<div class="vc-in">${ppl.slice(0, 12).map(x => `<span>${P.avatar(P.prof(x.uid) || null, x.nick, 22)} ${e(x.nick)}</span>`).join('')}</div>` : '<small class="ph-dim">Внутри пока никого — зайди первым.</small>'}
      ${ppl.length >= max ? `<div class="vc-note bad">👥 Канал заполнен (${max} из ${max}).</div>` : ''}
      ${d.can_set ? `<label class="vc-lim">👥 Лимит канала <select data-v="lim">${[0, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 25].filter(n => n <= cap).map(n => `<option value="${n}"${+d.limit === n ? ' selected' : ''}>${n ? n : 'без своего (' + cap + ')'}</option>`).join('')}</select></label><small class="ph-dim">Больше ${cap} — не даёт сайт: звук идёт «каждый с каждым», с бо́льшим числом людей связь ненадёжна.</small>` : ''}`;
    box.querySelector('[data-v="lim"]')?.addEventListener('change', async ev => {
      const rr = await P.rpc('cm_voice_limit_set', { p_channel: spec.channel, p_limit: +ev.target.value });
      P.toast(rr.data?.ok ? '✅ Лимит сохранён' : '⚠️ Не получилось', !!rr.data?.ok);
      whoBox(el, spec);
    });
  }
  function wireSession(el){
    attachVideos(el);
    el.querySelectorAll('[data-vu]').forEach(t => t.addEventListener('click', () => volSheet(t.dataset.vu)));
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
        else if (k === 'set') C.settings();
        else if (k === 'cam') C.camToggle();
        else if (k === 'dev') P.open('devcheck');
        else if (k === 'ginv') ginvSheet();
      });
    });
  }
  async function inviteSheet(){
    const f = await P.friends(true);
    const st = await P.friendStatus(f.list);
    const inside = new Set(people().map(p => p.uid));
    const kb = window.D37Age?.contacts ? await window.D37Age.contacts(f.list).catch(() => new Map()) : new Map();   // ребёнку — без взрослых
    const list = f.list.filter(id => !inside.has(id) && !kb.has(id)).sort((a, b) => (st.has(b) ? 1 : 0) - (st.has(a) ? 1 : 0));
    P.sheet(`<b>➕ Позвать в разговор</b><div class="ph-list">${list.length ? list.map(id => { const p = P.prof(id) || {}; return `<button type="button" class="ph-item" data-s="${e(id)}">${P.avatar(p, p.nick, 34)}<span><b>${e(p.nick || 'друг')}</b><small>${st.has(id) ? e(P.actText(st.get(id).a)) : 'не в сети'}</small></span>➕</button>`; }).join('') : '<div class="ph-dim">Друзей нет — найди их в чате или в мире</div>'}</div>`,
      (k) => { const p = P.prof(k); P.closeSheet(); C.invite(k, p?.nick || 'друг'); });
  }
  // T-141: «📍 Позвать в игру / на сервер» прямо из разговора (откат — INV_ON = false). Один собеседник — сразу ему, несколько — выбрать
  const INV_ON = true;
  async function ginvSheet(){
    const others = people().filter(p => !p.me && p.uid);
    if (!others.length) { P.toast('Позвать некого — в разговоре только ты', false); return; }
    const go = uid => { const p = others.find(x => x.uid === uid); P.invite ? P.invite(uid, p?.nick) : P.gameInvite(uid); };
    if (others.length === 1) { go(others[0].uid); return; }
    P.sheet(`<b>📍 Кого позвать?</b><div class="ph-list">${others.map(p => `<button type="button" class="ph-item" data-s="${e(p.uid)}">${P.avatar(P.prof(p.uid) || null, p.nick, 34)}<span><b>${e(p.nick)}</b></span>📍</button>`).join('')}</div>`, uid => { P.closeSheet(); go(uid); });
  }
  // Настройки звонка — одно место: ⚙️ → «📱 Телефон» (микрофон, шумоподавление, рация и клавиша, «скрыть мой адрес», кто звонит)
  C.settings = () => { try { window.D37Settings?.open?.({ tab: 'phone', ctx: 'site' }); } catch (er) { P.openSettings?.(); } };
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
        <div class="ph-cnote"${S.err || S.reason === 'net' ? '' : ' hidden'}>${e(S.err || TURN_NOTE_FN())}</div>
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

  // ═══ 🎛 Проверка микрофона, звука и камеры (T-167, DEVCHECK). Ничего не записывается и не уходит с устройства ═══
  C.deviceCheck = el => {
    let mic = null, cam = null, an = null, raf = 0, toneStop = null, dead = false;
    const camAllowed = () => { const g = window.D37Age?.group?.(); return g === 'teen' || g === 'teen16' || g === 'adult'; };
    const stopMic = () => { cancelAnimationFrame(raf); try { an?.src.disconnect(); } catch (er) {} an = null; mic?.getTracks().forEach(t => t.stop()); mic = null; };
    const stopCam = () => { cam?.getTracks().forEach(t => t.stop()); cam = null; };
    const opt = (list, cur, none) => list.length ? list.map((d, i) => `<option value="${e(d.deviceId)}"${d.deviceId === cur ? ' selected' : ''}>${e(d.label || none + ' ' + (i + 1))}</option>`).join('') : `<option value="">${none} — по умолчанию</option>`;
    async function draw(){
      let devs = []; try { devs = await navigator.mediaDevices?.enumerateDevices?.() || []; } catch (er) {}
      if (dead) return;
      const mics = devs.filter(d => d.kind === 'audioinput' && d.deviceId), cams = devs.filter(d => d.kind === 'videoinput' && d.deviceId), spks = devs.filter(d => d.kind === 'audiooutput' && d.deviceId);
      const sw = (k, t) => `<label class="dc-sw"><input type="checkbox" data-dc-sw="${k}"${P.set[k] !== false ? ' checked' : ''}> ${t}</label>`;
      el.innerHTML = P.head('🎛 Проверка') + `<div class="ph-body dc">
        <p class="ph-dim">Проверь, что тебя слышно и видно, до входа в голосовой. Ничего не записывается и не уходит с этого устройства.</p>
        <div class="dc-sec"><b>🎙 Микрофон</b><select data-dc="micId" aria-label="Микрофон">${opt(mics, P.set.micId, 'Микрофон')}</select>
          <div class="dc-meter" aria-label="Уровень микрофона"><i></i></div><small class="dc-mnote ph-dim">${mic ? 'Скажи что-нибудь — полоска должна прыгать.' : ''}</small>
          <div class="dc-row"><button type="button" class="ph-btn" data-dc-a="mic">${mic ? '⏹ Остановить' : '🎙 Проверить микрофон'}</button></div>
          <div class="dc-row">${sw('ns', 'Шумоподавление')}${sw('ec', 'Убирать эхо')}${sw('agc', 'Автогромкость')}</div></div>
        <div class="dc-sec"><b>🔊 Звук</b>${sinkOk ? `<select data-dc="spkId" aria-label="Куда выводить звук">${opt(spks, P.set.spkId, 'Динамик')}</select>` : '<small class="ph-dim">Этот браузер выбирает динамик сам (настройки телефона / системы).</small>'}
          <div class="dc-row"><button type="button" class="ph-btn" data-dc-a="tone">🔔 Проверить звук</button></div></div>
        <div class="dc-sec"><b>📷 Камера</b>${CAM_ON && camAllowed() ? `<select data-dc="camId" aria-label="Камера">${opt(cams, P.set.camId, 'Камера')}</select>
          <div class="dc-cam"${cam ? '' : ' hidden'}><video muted playsinline autoplay></video></div>
          <div class="dc-row"><button type="button" class="ph-btn" data-dc-a="cam">${cam ? '⏹ Выключить' : '📷 Проверить камеру'}</button></div>
          <small class="ph-dim">В разговоре камера выключена, пока сам не включишь 📷.</small>` : '<small class="ph-dim">📷 Камера в звонках пока недоступна для твоего возраста или возраст не указан (⚙️ → «🌐 Сайт» → возраст).</small>'}</div>
        <div class="dc-err vc-note bad" hidden></div>
      </div>`;
      if (cam) { const v = el.querySelector('.dc-cam video'); v.srcObject = cam; v.play().catch(() => {}); }
      if (mic) meter();
    }
    const err = t => { const b = el.querySelector('.dc-err'); if (b) { b.hidden = !t; b.textContent = t || ''; } };
    function meter(){
      const i = el.querySelector('.dc-meter i');
      const tick = () => { if (dead || !an) return; if (i) i.style.width = Math.min(100, level(an) * 900) + '%'; raf = requestAnimationFrame(tick); };
      tick();
    }
    async function startMic(){
      stopMic();
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: micC(), video: false }); } catch (er) { err(micErr(er)); draw(); return; }
      if (dead) { stopMic(); return; }
      an = analyser(mic); err(''); draw();
    }
    async function startCam(){
      stopCam();
      try { cam = await navigator.mediaDevices.getUserMedia({ video: camC(), audio: false }); } catch (er) { err(camErr(er)); draw(); return; }
      if (dead) { stopCam(); return; }
      err(''); draw();
    }
    function tone(){
      toneStop?.();
      const ctx = P.audioCtx(); if (!ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain(), dst = ctx.createMediaStreamDestination(), a = new Audio();
      o.frequency.value = 660; g.gain.setValueAtTime(.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.25, ctx.currentTime + .05); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .9);
      o.connect(g); g.connect(dst); o.start(); o.stop(ctx.currentTime + 1);
      a.srcObject = dst.stream; setSink(a); a.volume = voiceVol(); a.play().catch(() => {});
      toneStop = () => { try { o.stop(); } catch (er) {} a.srcObject = null; toneStop = null; };
      setTimeout(() => toneStop?.(), 1200);
    }
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-dc-a]'); if (!b) return;
      const k = b.dataset.dcA;
      if (k === 'mic') { if (mic) { stopMic(); draw(); } else startMic(); }
      else if (k === 'cam') { if (cam) { stopCam(); draw(); } else startCam(); }
      else if (k === 'tone') tone();
    });
    el.addEventListener('change', ev => {
      const s = ev.target.closest('[data-dc]'), w = ev.target.closest('[data-dc-sw]');
      if (s) { P.set[s.dataset.dc] = s.value || ''; P.saveSet(); if (s.dataset.dc === 'micId' && mic) startMic(); if (s.dataset.dc === 'camId' && cam) startCam(); }
      if (w) { P.set[w.dataset.dcSw] = w.checked; P.saveSet(); if (mic) startMic(); }
    });
    draw();
    return () => { dead = true; stopMic(); stopCam(); toneStop?.(); };
  };
  if (DEVCHECK) P.define('devcheck', { render(el){ return C.deviceCheck(el); } });

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

  C._test = { FSM, step, plan, sigOk, vad, fakeMic: f => { fakeFreq = f || 0; }, state: () => S, people, camCap,
    net: () => { const R = S?.room; return R ? { net: R.net, peers: [...R.peers.values()].map(p => ({ state: p.state, tc: p.tc, restarts: p.restarts, tries: p.tries, route: p.route, cam: p.cam, vstream: !!p.vstream })) } : null; },
    room: () => S?.room || null, restart: () => { const R = S?.room; for (const p of R?.peers?.values() || []) if (p.offerer) restart(R, p); },
    // проверка «двое в одной комнате» без входа (scripts/t167-e2e.cjs): та же комната, что у компании, без пропуска (как без ч. 5)
    party: async (code, nick, cam) => {
      if (!/^[a-z0-9]{8,16}$/.test(code || '')) return false;
      S = { kind: 'party', dir: 'out', state: 'idle', code, topic: 'call-' + code, title: '🎧 Проверка', at: Date.now() };
      setState('join');
      const r = await startRoom({ topic: S.topic, max: MAX, cam: !!cam, me: { uid: null, nick: String(nick || 'тест').slice(0, 24) } });
      if (r.err) return r.err;
      S.room = r.R; S.t0 = Date.now(); S.state = 'live'; armConnect(); render(); pill();
      return true;
    } };
})();
