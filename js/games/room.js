// ═══════════════════════════════════════
//  ОНЛАЙН-КОМНАТА ДЛЯ ИГР ВДВОЁМ — Supabase Realtime (broadcast + presence), без таблиц
// ═══════════════════════════════════════
// Ссылка #/games/<игра>/<код>. Хозяин — тот, кто вошёл в комнату раньше (по времени входа
// в presence). Третий лишний получает «Комната занята». Сообщения — произвольные объекты,
// каждая игра сама проверяет ходы соперника. «Города» используют свою копию этой логики.
(() => {
  const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';

  function nick(){
    if (typeof currentProfile !== 'undefined' && currentProfile?.nick) return currentProfile.nick;
    let n = '';
    try { n = sessionStorage.getItem('d37_duel_guest') || ''; } catch (e) {}
    if (!n) { n = 'Гость ' + Math.floor(100 + Math.random() * 900); try { sessionStorage.setItem('d37_duel_guest', n); } catch (e) {} }
    return n;
  }

  // handlers: onPeer(opp|null, room) — соперник пришёл/ушёл; onMessage(msg, room); onFull(); onError()
  function join(game, code, handlers){
    if (typeof sbClient === 'undefined' || !sbClient) { handlers.onError?.(); return null; }
    const myId = (typeof currentUser !== 'undefined' && currentUser?.id) || 'g-' + Math.random().toString(36).slice(2, 10);
    const room = { game, code, myId, nick: nick(), joinedAt: Date.now(), isHost: false, opp: null, closed: false };
    const ch = sbClient.channel(`${game}-duel-${code}`, { config: { broadcast: { self: false }, presence: { key: myId } } });
    // Служебное поле отправителя — _by (не from: у ходов шашек from — это клетка)
    room.send = payload => { if (!room.closed) ch.send({ type: 'broadcast', event: 'm', payload: { ...payload, _by: myId } }).catch(() => {}); };
    room.leave = () => { if (room.closed) return; room.closed = true; try { ch.untrack(); sbClient.removeChannel(ch); } catch (e) {} };
    ch.on('broadcast', { event: 'm' }, ({ payload }) => { if (!room.closed && payload?._by !== myId) handlers.onMessage?.(payload, room); });
    ch.on('presence', { event: 'sync' }, () => {
      if (room.closed) return;
      const players = Object.entries(ch.presenceState()).map(([id, metas]) => ({ id, ...(metas[0] || {}) })).sort((a, b) => (a.t || 0) - (b.t || 0));
      const me = players.findIndex(p => p.id === myId);
      if (me === -1) return;
      if (me > 1) { room.leave(); handlers.onFull?.(); return; }
      room.isHost = me === 0;
      const opp = players[me === 0 ? 1 : 0] || null;
      // Первый sync сообщаем всегда — чтобы экран ожидания сменил «Подключаемся…» на «Ждём друга»
      const changed = !room.synced || (opp?.id || null) !== (room.opp?.id || null);
      room.synced = true;
      room.opp = opp ? { id: opp.id, nick: opp.nick || 'соперник' } : null;
      if (changed) handlers.onPeer?.(room.opp, room);
    });
    ch.subscribe(async status => {
      if (status === 'SUBSCRIBED') await ch.track({ nick: room.nick, t: room.joinedAt });
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') handlers.onError?.();
    });
    return room;
  }

  function newCode(){ let c = ''; for (let i = 0; i < 6; i++) c += ABC[Math.floor(Math.random() * ABC.length)]; return c; }
  const validCode = c => /^[a-z0-9]{4,12}$/.test(String(c || ''));

  // Экран ожидания со ссылкой
  function lobby(el, game, code, text){
    const link = location.origin + location.pathname + `#/games/${game}/${code}`;
    el.innerHTML = `<div class="ct-lobby">
        <div class="gv-big">👥</div>
        <p class="rm-text">${text || 'Подключаемся к комнате…'}</p>
        <div class="ct-link"><input readonly value="${esc(link)}"><button type="button">📋 Копировать</button></div>
        <div class="ct-note">Отправь ссылку другу — игра начнётся, как только он её откроет.</div>
      </div>`;
    const btn = el.querySelector('.ct-link button'), inp = el.querySelector('.ct-link input');
    btn.onclick = async () => { try { await navigator.clipboard.writeText(link); btn.textContent = '✅ Скопировано'; } catch (e) { inp.select(); } };
  }
  function lobbyText(el, html){ const t = el?.querySelector('.rm-text'); if (t) t.innerHTML = html; }
  const fullHtml = game => `<div class="empty-state"><span class="empty-state-icon">🚪</span><div class="empty-state-title">Комната занята</div><div class="empty-state-text">Здесь уже играют двое. <a href="#/games/${game}">Создай свою комнату</a>.</div></div>`;
  const errorHtml = '<div class="empty-state"><span class="empty-state-icon">📡</span><div class="empty-state-title">Нет связи</div><div class="empty-state-text">Не удалось подключиться к комнате. Обнови страницу.</div></div>';

  window.GameRoom = { join, newCode, validCode, lobby, lobbyText, fullHtml, errorHtml, nick };
})();
