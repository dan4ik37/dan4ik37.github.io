// ═══════════════════════════════════════
//  СТОЛ ДЛЯ ИГР НА 2–4 ИГРОКОВ — карты и настолки онлайн (Supabase Realtime: presence + broadcast)
// ═══════════════════════════════════════
// Места — по времени входа: первый — хозяин стола (создатель ссылки), он раздаёт и проверяет все ходы.
// Карты в руке — личные сообщения, зашифрованные для одного игрока: у каждого своя пара ключей ECDH
// (WebCrypto), открытый ключ лежит в presence; общий ключ хозяина с игроком → AES-GCM. Остальные в комнате
// видят только шифр. Сообщений мало (ход — одно-два), поэтому всё идёт через Supabase, без WebRTC.
//
// TableRoom.join(game, code, { max, onSeats(seats, room), onMessage(msg, fromId, room), onPrivate(msg, fromId, room), onFull, onError })
//   room.seats — [{ id, nick, me }] по порядку входа; room.isHost; room.myId;
//   room.send(msg) — всем; room.sendTo(id, msg) — одному (шифр); room.leave().
// Новых игроков сообщаем через 0,8 с после входа: в первую долю секунды сервер ещё не доставляет им сообщения.
(() => {
  const subtle = window.crypto && window.crypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const newest = metas => (metas || []).reduce((a, b) => ((b?.t || 0) > (a?.t || 0) ? b : a), (metas || [])[0] || {});

  function join(game, code, h){
    if (typeof sbClient === 'undefined' || !sbClient) { h.onError?.(); return null; }
    const key = (typeof currentUser !== 'undefined' && currentUser?.id) || GameRoom.guestId();
    const joinedAt = Date.now(), myId = key + '~' + joinedAt;
    const room = { game, code, myId, nick: GameRoom.nick(), joinedAt, isHost: false, seats: [], closed: false, max: h.max || 4, synced: false };
    const keys = new Map();
    let kp = null, myPub = null;
    const ch = sbClient.channel(`${game}-table-${code}`, { config: { broadcast: { self: false }, presence: { key } } });

    room.send = m => { if (!room.closed) ch.send({ type: 'broadcast', event: 'm', payload: { ...m, _by: myId } }).catch(() => {}); };
    async function sharedFor(id){
      if (!kp || !subtle) return null;
      if (keys.has(id)) return keys.get(id);
      const seat = room.seats.find(s => s.id === id);
      if (!seat?.pk) return null;
      try {
        const pub = await subtle.importKey('jwk', seat.pk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
        const k = await subtle.deriveKey({ name: 'ECDH', public: pub }, kp.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        keys.set(id, k);
        return k;
      } catch (e) { return null; }
    }
    room.sendTo = async (id, m) => {
      if (room.closed) return;
      if (id === myId) { h.onPrivate?.(m, myId, room); return; }
      const k = await sharedFor(id);
      if (!k) { room.send({ type: '_pm', to: id, plain: m }); return; }   // браузер без WebCrypto — открыто
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, k, te.encode(JSON.stringify(m))));
      room.send({ type: '_pm', to: id, iv: b64(iv), ct: b64(ct) });
    };

    ch.on('broadcast', { event: 'm' }, async ({ payload: m }) => {
      if (room.closed || !m || m._by === myId) return;
      if (m.type === '_pm') {
        if (m.to !== myId) return;
        if (m.plain) { h.onPrivate?.(m.plain, m._by, room); return; }
        const k = await sharedFor(m._by);
        if (!k) return;
        try { h.onPrivate?.(JSON.parse(td.decode(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(m.iv) }, k, unb64(m.ct)))), m._by, room); } catch (e) {}
        return;
      }
      h.onMessage?.(m, m._by, room);
    });
    ch.on('presence', { event: 'sync' }, () => {
      if (room.closed) return;
      const list = Object.entries(ch.presenceState()).map(([k, metas]) => {
        const mm = newest(metas);
        return { id: k + '~' + (mm.t || 0), nick: String(mm.nick || 'Игрок').slice(0, 24), t: mm.t || 0, pk: mm.pk || null, look: mm.look || null };
      }).sort((a, b) => a.t - b.t);
      const idx = list.findIndex(s => s.id === myId);
      if (idx === -1) return;
      if (idx >= room.max) { room.leave(); h.onFull?.(); return; }
      const seats = list.slice(0, room.max).map(s => ({ ...s, me: s.id === myId }));
      const added = seats.some(s => !room.seats.some(o => o.id === s.id));
      const removed = room.seats.some(o => !seats.some(s => s.id === o.id));
      const was = room.synced;
      room.isHost = idx === 0;
      room.seats = seats;
      room.synced = true;
      clearTimeout(room.seatT);
      if (!was || removed || !added) { h.onSeats?.(seats, room); autoGo(); }
      else room.seatT = setTimeout(() => { if (!room.closed) { h.onSeats?.(room.seats, room); autoGo(); } }, 800);
    });
    // Пришли из «Мира Денчика» (сели за стол): хозяин сам жмёт «Начать», когда все, кто сидел за столом, на месте
    let auto = 0;
    try { const a = JSON.parse(sessionStorage.getItem('d37_autostart') || 'null'); if (a && a.g === game && a.c === code && Date.now() - a.t < 120e3) auto = Math.max(2, Math.min(room.max, a.n | 0)); } catch (e) {}
    function autoGo(){
      if (!auto || room.closed || !room.isHost || room.seats.length < auto) return;
      setTimeout(() => {
        if (!auto || room.closed || !room.isHost || room.seats.length < auto) return;
        const b = document.querySelector('.ct-start[data-act="go"]:not([disabled])');
        if (!b) return;
        auto = 0;
        try { sessionStorage.removeItem('d37_autostart'); } catch (e) {}
        b.click();
      }, 1600);   // новичку сервер первые доли секунды ничего не доставляет — начало партии потерялось бы
    }
    ch.subscribe(async st => {
      if (st === 'SUBSCRIBED') {
        try { if (subtle) { kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']); myPub = await subtle.exportKey('jwk', kp.publicKey); } } catch (e) { kp = null; myPub = null; }
        await ch.track({ nick: room.nick, t: joinedAt, pk: myPub, look: window.D37Char?.look() || null });
      } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') h.onError?.();
    });
    room.leave = () => {
      if (room.closed) return;
      room.closed = true;
      clearTimeout(room.seatT);
      window.removeEventListener('pagehide', room.leave);
      try { ch.untrack(); sbClient.removeChannel(ch); } catch (e) {}
    };
    window.addEventListener('pagehide', room.leave);
    return room;
  }

  // Экран ожидания стола: ссылка, места, кнопки хозяина
  function lobbyHtml(link, seats, max, opts){
    const rows = [];
    for (let i = 0; i < max; i++) {
      const s = seats[i];
      rows.push(s ? `<li class="tb-seat${s.me ? ' me' : ''}">${s.bot ? '🤖' : i === 0 ? '👑' : '🙂'} <b>${esc(s.nick)}</b>${s.me ? ' <small>(ты)</small>' : ''}${s.bot && opts.host ? ` <button type="button" class="tb-x" data-act="unbot:${i}" aria-label="Убрать бота">✕</button>` : ''}</li>`
        : `<li class="tb-seat empty">Свободно${opts.host ? ' · <button type="button" class="tb-add" data-act="bot">+ бот</button>' : ''}</li>`);
    }
    return `<div class="tb-lobby">
      <div class="tb-title">${opts.title}</div>
      <div class="ct-link"><input readonly value="${esc(link)}"><button type="button" data-act="copy">📋 Копировать</button></div>
      <div class="tb-note">Отправь ссылку друзьям — до ${max} игроков. Пустые места можно занять ботами.</div>
      <ol class="tb-seats">${rows.join('')}</ol>
      ${opts.host ? `<button type="button" class="ct-start" data-act="go"${opts.canStart ? '' : ' disabled'}>▶ Начать</button>` : `<div class="tb-note">Ждём, пока хозяин стола начнёт игру…</div>`}
    </div>`;
  }

  window.TableRoom = { join, lobbyHtml };
})();
