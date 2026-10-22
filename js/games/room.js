// ═══════════════════════════════════════
//  ОНЛАЙН-КОМНАТА ДЛЯ ИГР ВДВОЁМ — Supabase Realtime (broadcast + presence), без таблиц
// ═══════════════════════════════════════
// Ссылка #/games/<игра>/<код>. Хозяин — тот, кто вошёл в комнату раньше (по времени входа
// в presence). Третий лишний получает «Комната занята». Сообщения — произвольные объекты,
// каждая игра сама проверяет ходы соперника. «Города» используют свою копию этой логики.
//
// Сеть (T-039). Ссылка-приглашение может открыть игру раньше, чем сайт подключил Supabase (sbClient создаёт chat.js →
// initChat()). Поэтому ВСЕ комнаты сайта (этот файл, table.js, «Города», «Крокодил», комнаты Unity-игр) заводят канал через
// GameRoom.channel(): он сам ждёт sbClient (до 8 с, без клиента и без интернета — сразу) и копит сообщения до подписки
// (иначе supabase-js шлёт их через REST: медленно и с предупреждением). Не дождались — статус 'TIMED_OUT' → onError игры:
// «Нет связи — попробуй ещё раз», а не тихий переход к ботам. Новая комната — тоже через GameRoom.channel, не sbClient.channel.
(() => {
  const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';
  const NET_WAIT_MS = 8000, QUEUE_MAX = 50;

  function nick(){
    if (typeof currentProfile !== 'undefined' && currentProfile?.nick) return currentProfile.nick;
    let n = '';
    try { n = sessionStorage.getItem('d37_duel_guest') || ''; } catch (e) {}
    if (!n) { n = 'Гость ' + Math.floor(100 + Math.random() * 900); try { sessionStorage.setItem('d37_duel_guest', n); } catch (e) {} }
    return n;
  }

  // ── Ждём клиента Supabase ──
  const netOk = () => { try { return !!(typeof sbClient !== 'undefined' && sbClient); } catch (e) { return false; } };
  const browserOffline = () => { try { return typeof navigator !== 'undefined' && navigator.onLine === false; } catch (e) { return false; } };
  // fn(true) — клиент есть (если он уже есть — сразу, в этом же вызове); fn(false) — нет: не появился за ms (8 с) или браузер
  // без интернета (SDK не загрузился — ждать нечего; тогда fn вызовется чуть позже, не из самого whenNet).
  // Возвращает «отмена» (снимает ожидание). Опрос — раз в 0,1 с, только пока ждём.
  function whenNet(fn, ms){
    if (netOk()) { fn(true); return () => {}; }
    if (browserOffline()) { const z = setTimeout(() => fn(false), 0); return () => clearTimeout(z); }
    const t0 = Date.now(), limit = ms > 0 ? ms : NET_WAIT_MS;
    let t = setInterval(() => {
      const ok = netOk();
      if (ok || Date.now() - t0 >= limit) { clearInterval(t); t = 0; fn(ok); }
    }, 100);
    return () => { if (t) { clearInterval(t); t = 0; } };
  }

  // Канал Supabase Realtime без готового sbClient. Методы те же, что у настоящего канала (on / subscribe / send / track /
  // untrack / presenceState), плюс close() (untrack + removeChannel + снять ожидание) и ready() (первый SUBSCRIBED был).
  //  • настоящий канал создаётся в subscribe(): сразу, если sbClient есть, иначе — когда появится; не появился — cb('TIMED_OUT');
  //  • send() до подписки копит сообщения (до 50, лишнее старое вытесняется) и отдаёт их сразу после SUBSCRIBED;
  //  • on() можно звать до создания — вешается при создании; presenceState() до подписки — {}.
  function channel(name, opts){
    const ons = [];
    let ch = null, cl = null, subCb = null, started = false, joined = false, closed = false, stopWait = null, queue = [];
    const P = {};
    const quiet = r => { if (r && typeof r.catch === 'function') r.catch(() => {}); return r; };
    P.on = (type, filter, cb) => { ons.push([type, filter, cb]); if (ch) ch.on(type, filter, cb); return P; };
    function flush(){
      const q = queue; queue = [];
      for (const m of q) { try { quiet(ch.send(m)); } catch (e) {} }
    }
    function open(){
      try {
        cl = window.D37RT?.client?.() || sbClient;   // свой сервер (js/core/rt.js, T-045); RT_URL пустой — sbClient, как было
        ch = cl.channel(name, opts);
        for (const [t, f, c] of ons) ch.on(t, f, c);
        ch.subscribe(status => {
          if (closed) return;
          if (status === 'SUBSCRIBED' && !joined) { joined = true; flush(); }
          subCb?.(status);
        });
      } catch (e) { console.error(e); ch = null; subCb?.('CHANNEL_ERROR'); }
    }
    P.subscribe = cb => {
      if (started || closed) return P;
      started = true; subCb = cb;
      stopWait = whenNet(ok => { stopWait = null; if (closed) return; if (ok) open(); else subCb?.('TIMED_OUT'); });
      return P;
    };
    P.send = msg => {
      if (closed) return Promise.resolve('closed');
      if (ch && joined) return ch.send(msg);
      if (queue.length >= QUEUE_MAX) queue.shift();
      queue.push(msg);
      return Promise.resolve('queued');
    };
    P.track = meta => (ch ? ch.track(meta) : Promise.resolve('error'));
    P.untrack = () => (ch ? ch.untrack() : Promise.resolve('ok'));
    P.presenceState = () => (ch ? ch.presenceState() : {});
    P.ready = () => joined;
    P.close = () => {
      if (closed) return;
      closed = true; queue = [];
      if (stopWait) { stopWait(); stopWait = null; }
      if (ch) {
        const c = ch; ch = null;
        try { quiet(c.untrack()); } catch (e) {}
        try { quiet((cl || sbClient).removeChannel(c)); } catch (e) {}
      }
    };
    return P;
  }

  // handlers: onPeer(opp|null, room) — соперник пришёл/ушёл; onMessage(msg, room); onFull(); onError()
  // Комната возвращается сразу (до появления sbClient тоже): нет связи — onError() чуть позже, не из самого join().
  function join(game, code, handlers){
    // Ключ присутствия — кто (аккаунт или гость этой вкладки); номер игрока — кто + когда вошёл. Обновил страницу —
    // старое и новое присутствие одного человека склеиваются (берётся самое свежее), а номер новый: игры видят
    // «новичка» и начинают партию заново
    const key = (typeof currentUser !== 'undefined' && currentUser?.id) || guestId();
    const joinedAt = Date.now(), myId = key + '~' + joinedAt;
    const room = { game, code, myId, nick: nick(), joinedAt, isHost: false, opp: null, closed: false };
    const ch = channel(`${game}-duel-${code}`, { config: { broadcast: { self: false }, presence: { key } } });
    // Служебное поле отправителя — _by (не from: у ходов шашек from — это клетка)
    room.send = payload => { if (!room.closed) ch.send({ type: 'broadcast', event: 'm', payload: { ...payload, _by: myId } }).catch(() => {}); };
    room.leave = () => { if (room.closed) return; room.closed = true; clearTimeout(room.peerTimer); window.removeEventListener('pagehide', room.leave); ch.close(); };
    // Закрыл/обновил страницу — сразу уходим из комнаты (иначе старое «присутствие» висит и комната кажется занятой)
    window.addEventListener('pagehide', room.leave);
    ch.on('broadcast', { event: 'm' }, ({ payload }) => { if (!room.closed && payload?._by !== myId) handlers.onMessage?.(payload, room); });
    ch.on('presence', { event: 'sync' }, () => {
      if (room.closed) return;
      const players = Object.entries(ch.presenceState()).map(([k, metas]) => {
        const m = (metas || []).reduce((a, b) => ((b?.t || 0) > (a?.t || 0) ? b : a), (metas || [])[0] || {});
        return { id: k + '~' + (m.t || 0), nick: m.nick, t: m.t || 0 };
      }).sort((a, b) => a.t - b.t);
      const me = players.findIndex(p => p.id === myId);
      if (me === -1) return;
      if (me > 1) { room.leave(); handlers.onFull?.(); return; }
      room.isHost = me === 0;
      const opp = players[me === 0 ? 1 : 0] || null;
      // Первый sync сообщаем всегда — чтобы экран ожидания сменил «Подключаемся…» на «Ждём друга»
      const changed = !room.synced || (opp?.id || null) !== (room.opp?.id || null);
      const was = room.synced;
      room.synced = true;
      room.opp = opp ? { id: opp.id, nick: opp.nick || 'соперник' } : null;
      if (!changed) return;
      clearTimeout(room.peerTimer);
      // Соперник вошёл после нас — сообщаем через 0,8 с: сервер ещё подписывает его на сообщения комнаты, и отправленное
      // ему в первую долю секунды (например, «старт» партии) до него не доходит. Ушёл или мы сами вошли — сразу.
      if (opp && was) room.peerTimer = setTimeout(() => { if (!room.closed && room.opp?.id === opp.id) handlers.onPeer?.(room.opp, room); }, 800);
      else handlers.onPeer?.(room.opp, room);
    });
    ch.subscribe(async status => {
      if (status === 'SUBSCRIBED') await ch.track({ nick: room.nick, t: room.joinedAt });
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') handlers.onError?.();
    });
    return room;
  }

  // Гость — один и тот же номер, пока открыта вкладка: обновил страницу — вернулся на своё место, а не «третий лишний»
  function guestId(){
    let id = '';
    try { id = sessionStorage.getItem('d37_room_gid') || ''; } catch (e) {}
    if (!id) { id = 'g-' + Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem('d37_room_gid', id); } catch (e) {} }
    return id;
  }

  function newCode(){ let c = ''; for (let i = 0; i < 6; i++) c += ABC[Math.floor(Math.random() * ABC.length)]; return c; }
  const validCode = c => /^[a-z0-9]{4,12}$/.test(String(c || ''));

  // Экран ожидания со ссылкой
  function lobby(el, game, code, text){
    const link = (window.D37Ref?.wrap || (u => u))((window.D37Route ? D37Route.abs(`#/games/${game}/${code}`) : location.origin + location.pathname + `#/games/${game}/${code}`));   // 👥 с кодом приглашения (js/core/ref.js)
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
  // Кнопка «ещё раз» — перезагрузка страницы: адрес комнаты тот же, заходим заново (и сайт заново подключает Supabase)
  const retryBtn = '<button type="button" class="ct-start" style="margin-top:1rem" onclick="location.reload()">🔄 Попробовать ещё раз</button>';
  const errorHtml = `<div class="empty-state"><span class="empty-state-icon">📡</span><div class="empty-state-title">Нет связи</div><div class="empty-state-text">Не удалось подключиться к комнате — проверь интернет и попробуй ещё раз.</div>${retryBtn}</div>`;

  window.GameRoom = { join, newCode, validCode, lobby, lobbyText, fullHtml, errorHtml, retryBtn, nick, guestId, channel, whenNet, netOk };
})();
