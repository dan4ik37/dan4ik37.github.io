// ═══════════════════════════════════════
//  СЕТЬ ДЛЯ ИГР ВДВОЁМ В РЕАЛЬНОМ ВРЕМЕНИ — WebRTC напрямую между игроками
// ═══════════════════════════════════════
// Комната — GameRoom (room.js, Supabase Realtime): через неё игроки «знакомятся» (предложение/ответ WebRTC
// и ICE-кандидаты), дальше данные идут напрямую между браузерами — быстро и не тратит лимит сообщений
// Supabase. Не соединилось за 7 с (строгий NAT мобильного оператора) — те же данные идут через комнату
// Supabase («relay»), но быстрые сообщения — не чаще 5 раз в секунду.
//
// const np = NetPlay.start(room, { onMessage(msg), onBinary(arrayBuffer), onMode(mode) })
//   np.handle(msg) — отдать сообщение из комнаты: true, если оно сетевое (его разберёт np);
//   np.offer() — начать соединение (зовёт хозяин, когда пришёл напарник);
//   np.send(msg, fast) — fast: можно потерять (позиции), иначе гарантированно и по порядку;
//   np.sendBin(arrayBuffer) — снимок мира (как fast); np.mode() — 'connecting' | 'p2p' | 'relay';
//   np.hz() — сколько снимков в секунду слать сейчас; np.close().
(() => {
  const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  const toB64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };

  function start(room, hooks){
    const N = { pc: null, fast: null, rel: null, mode: 'connecting', sid: '', closed: false, queue: [], relayAt: 0, timer: 0 };
    const setMode = m => { if (N.mode !== m && !N.closed) { N.mode = m; hooks.onMode?.(m); } };
    const deliver = m => { try { hooks.onMessage(m); } catch (e) { console.error(e); } };
    const deliverBin = b => { try { hooks.onBinary?.(b); } catch (e) { console.error(e); } };

    function dropPc(){
      try { N.pc?.close(); } catch (e) {}
      N.pc = null; N.fast = null; N.rel = null; N.queue = [];
    }
    function newPc(){
      dropPc();
      if (typeof RTCPeerConnection === 'undefined') { setMode('relay'); return null; }
      const pc = new RTCPeerConnection({ iceServers: ICE });
      N.pc = pc;
      pc.onicecandidate = e => { if (e.candidate && pc === N.pc) room.send({ type: 'np-ice', sid: N.sid, c: e.candidate.toJSON() }); };
      pc.onconnectionstatechange = () => { if (pc === N.pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) setMode('relay'); };
      pc.ondatachannel = e => bind(e.channel);
      return pc;
    }
    function bind(ch){
      ch.binaryType = 'arraybuffer';
      if (ch.label === 'fast') N.fast = ch; else N.rel = ch;
      ch.onopen = () => { if (N.rel?.readyState === 'open' && N.fast?.readyState === 'open') { clearTimeout(N.timer); setMode('p2p'); } };
      ch.onclose = () => { if (!N.closed && (ch === N.rel || ch === N.fast)) setMode('relay'); };
      ch.onmessage = e => {
        if (typeof e.data !== 'string') { deliverBin(e.data); return; }
        let m; try { m = JSON.parse(e.data); } catch (err) { return; }
        deliver(m);
      };
    }
    function armTimer(){ clearTimeout(N.timer); N.timer = setTimeout(() => { if (N.mode !== 'p2p') setMode('relay'); }, 7000); }
    function flushIce(){ const pc = N.pc; if (pc) for (const c of N.queue.splice(0)) pc.addIceCandidate(c).catch(() => {}); }

    // Хозяин: новое соединение (и при каждом новом напарнике)
    async function offer(){
      if (N.closed) return;
      N.sid = Math.random().toString(36).slice(2, 10);
      setMode('connecting');
      const pc = newPc();
      if (!pc) return;
      bind(pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
      bind(pc.createDataChannel('rel', { ordered: true }));
      armTimer();
      try {
        await pc.setLocalDescription(await pc.createOffer());
        room.send({ type: 'np-offer', sid: N.sid, sdp: pc.localDescription.toJSON() });
      } catch (e) { setMode('relay'); }
    }

    async function signal(m){
      try {
        if (m.type === 'np-offer' && !room.isHost) {
          N.sid = m.sid;
          setMode('connecting');
          const pc = newPc();
          if (!pc) return;
          armTimer();
          await pc.setRemoteDescription(m.sdp);
          await pc.setLocalDescription(await pc.createAnswer());
          room.send({ type: 'np-answer', sid: N.sid, sdp: pc.localDescription.toJSON() });
          flushIce();
        } else if (m.type === 'np-answer' && room.isHost && m.sid === N.sid && N.pc) {
          await N.pc.setRemoteDescription(m.sdp);
          flushIce();
        } else if (m.type === 'np-ice' && m.sid === N.sid && N.pc) {
          if (N.pc.remoteDescription) await N.pc.addIceCandidate(m.c); else N.queue.push(m.c);
        }
      } catch (e) {}
    }
    function handle(m){
      if (!m || typeof m.type !== 'string' || m.type.slice(0, 3) !== 'np-') return false;
      if (N.closed) return true;
      if (m.type === 'np-relay') deliver(m.m);
      else if (m.type === 'np-bin') { try { deliverBin(fromB64(m.b)); } catch (e) {} }
      else signal(m);
      return true;
    }

    const p2p = ch => N.mode === 'p2p' && ch && ch.readyState === 'open';
    function relayOk(){ const t = Date.now(); if (t - N.relayAt < 190) return false; N.relayAt = t; return true; }
    function send(msg, fast){
      if (N.closed) return;
      const ch = fast ? N.fast : N.rel;
      if (p2p(ch)) {
        if (fast && ch.bufferedAmount > 128e3) return;   // канал забит — устаревший снимок не нужен
        try { ch.send(JSON.stringify(msg)); return; } catch (e) {}
      }
      if (fast && !relayOk()) return;
      room.send({ type: 'np-relay', m: msg });
    }
    function sendBin(buf){
      if (N.closed) return;
      if (p2p(N.fast)) {
        if (N.fast.bufferedAmount > 128e3) return;
        try { N.fast.send(buf); return; } catch (e) {}
      }
      if (!relayOk()) return;
      room.send({ type: 'np-bin', b: toB64(buf) });
    }
    function close(){ N.closed = true; clearTimeout(N.timer); dropPc(); }

    return { send, sendBin, handle, offer, close, mode: () => N.mode, hz: () => N.mode === 'p2p' ? 15 : 5 };
  }

  window.NetPlay = { start };
})();
