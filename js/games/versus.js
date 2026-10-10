// ═══════════════════════════════════════
//  «⚔️ СОРЕВНОВАНИЕ» ДЛЯ ОДИНОЧНЫХ ИГР — оба играют одинаковую партию, у кого больше очков
// ═══════════════════════════════════════
// Комната — js/games/room.js (#/games/<игра>/<код>). Хозяин присылает seed: у обоих
// одинаковый генератор случайных чисел → одни и те же ролики/плитки/предметы/задержки.
// Счёт соперника виден по ходу. Результат идёт в статистику как '<игра>_duel'
// (только если оба доиграли — защита от накрутки двумя вкладками).
//
// Игра подключается так:
//   Versus.start(root, api, 'catch', code, { run(stage, rng, hooks), stop() })
//   hooks.progress(score) — по ходу, hooks.done(score) — партия окончена (больше — лучше).
//   hooks.send(data) — своё сообщение сопернику (например, «Башни» отправляют монстров) → у него opts.onMsg(data).
(() => {
  // Детерминированный генератор (mulberry32)
  function rng(seed){
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function start(root, api, game, code, opts){
    const V = { room: null, round: 0, started: false, me: null, opp: null, rematch: { me: false, opp: false }, oppGone: false, lastSent: 0 };
    const fmt = s => (s == null ? '…' : Number(s).toLocaleString('ru'));
    GameRoom.lobby(root, game, code);

    V.room = GameRoom.join(game, code, {
      onError: () => { root.innerHTML = GameRoom.errorHtml; },
      onFull: () => { root.innerHTML = GameRoom.fullHtml(game); },
      onPeer: (opp, room) => {
        if (!opp) {
          if (V.started) { V.oppGone = true; setOpp(); if (V.me?.done) decide(); }
          else GameRoom.lobbyText(root, 'Ты в комнате. <b>Ждём соперника…</b>');
          return;
        }
        // Пришёл другой человек (или соперник обновил страницу) — у него нет текущей партии,
        // поэтому хозяин начинает новую
        const newcomer = V.oppId && V.oppId !== opp.id;
        V.oppId = opp.id; V.oppNick = opp.nick; V.oppGone = false;
        if (!V.started || newcomer) { if (room.isHost) hostStart(); else if (!V.started) { GameRoom.lobbyText(root, `<b>${esc(opp.nick)}</b> на месте — начинаем…`); askStart(0); } }
      },
      onMessage: m => {
        if (m.type === 'start' && !V.room.isHost) { if (V.started && m.round === V.round) return; return begin(m); }
        // Напарник не дождался «старта» (потерялся, пока он входил в комнату) — шлём ещё раз тот же
        if (m.type === 'want') { if (V.room.isHost) { if (V.lastStart) V.room.send(V.lastStart); else hostStart(); } return; }
        if (m.round !== V.round) return;
        if (m.type === 'x') { opts.onMsg?.(m.d); return; }
        if (m.type === 'score') { V.opp.score = m.score; setOpp(); }
        else if (m.type === 'done') { V.opp = { score: m.score, done: true }; setOpp(); if (V.me.done) decide(); }
        else if (m.type === 'rematch') {
          V.rematch.opp = true;
          if (V.room.isHost && V.rematch.me) hostStart();
          else if (V.decided) hint(`${esc(V.oppNick)} хочет реванш — жми «↻ Реванш»!`);
        }
      },
    });
    if (!V.room) { root.innerHTML = GameRoom.errorHtml; return () => {}; }

    // Гость: «старт» не пришёл за 2,5 с — переспросить (до 3 раз)
    function askStart(n){
      clearTimeout(V.askT);
      V.askT = setTimeout(() => { if (!V.started && V.room && !V.room.closed && !V.room.isHost && V.room.opp && n < 3) { V.room.send({ type: 'want' }); askStart(n + 1); } }, 2500);
    }

    function hostStart(){
      V.round++;
      const msg = { type: 'start', seed: Math.floor(Math.random() * 2 ** 31), round: V.round, hostNick: V.room.nick };
      V.lastStart = msg;
      V.room.send(msg);
      begin(msg);
    }

    function begin(m){
      opts.stop?.();
      V.started = true; V.round = m.round; V.decided = false;
      V.rematch = { me: false, opp: false };
      V.me = { score: 0, done: false }; V.opp = { score: 0, done: false };
      if (m.hostNick && !V.room.isHost) V.oppNick = m.hostNick;
      root.innerHTML = `<div class="vs">
          <div class="vs-bar">
            <div class="vs-side me"><small>Ты</small><b id="vsMe">0</b><i id="vsMeSt">играет</i></div>
            <div class="vs-mid">⚔️</div>
            <div class="vs-side opp"><small>${esc(V.oppNick || 'Соперник')}</small><b id="vsOpp">0</b><i id="vsOppSt">играет</i></div>
          </div>
          <div class="vs-note" id="vsNote"></div>
          <div class="vs-stage" id="vsStage"></div>
        </div>`;
      opts.run(root.querySelector('#vsStage'), rng(m.seed), {
        progress(score){
          if (!V.me || V.me.done) return;
          V.me.score = score; setMe();
          // Не чаще раза в 0,4 с, но последнее значение серии всё равно досылаем
          const send = () => { V.lastSent = Date.now(); clearTimeout(V.pending); V.pending = 0; if (!V.me.done) V.room.send({ type: 'score', score: V.me.score, round: V.round }); };
          if (Date.now() - V.lastSent > 400) send();
          else if (!V.pending) V.pending = setTimeout(send, 400);
        },
        send(d){ if (V.room && V.started) V.room.send({ type: 'x', d, round: V.round }); },
        oppNick: () => V.oppNick || 'Соперник',
        done(score){
          if (!V.me || V.me.done) return;
          V.me = { score, done: true }; setMe();
          V.room.send({ type: 'done', score, round: V.round });
          if (V.opp.done || V.oppGone) decide();
          else note(`Ты закончил — ждём, пока доиграет ${esc(V.oppNick || 'соперник')}…`);
        },
      });
    }

    function setMe(){
      const b = root.querySelector('#vsMe'); if (b) b.textContent = fmt(V.me.score);
      const s = root.querySelector('#vsMeSt'); if (s) s.textContent = V.me.done ? 'финиш' : 'играет';
    }
    function setOpp(){
      const b = root.querySelector('#vsOpp'); if (b) b.textContent = fmt(V.opp.score);
      const s = root.querySelector('#vsOppSt'); if (s) s.textContent = V.oppGone ? 'вышел' : V.opp.done ? 'финиш' : 'играет';
    }
    function note(html){ const n = root.querySelector('#vsNote'); if (n) n.innerHTML = html; }
    function hint(html){ const h = root.querySelector('#vsHint'); if (h) h.innerHTML = html; }

    function decide(){
      if (V.decided) return;
      V.decided = true;
      const a = V.me.score, b = V.opp.score;
      const gone = V.oppGone && !V.opp.done;
      const draw = !gone && a === b;
      const win = gone || a > b;
      api.sfx(draw ? 'ok' : win ? 'win' : 'bad');
      note(`<div class="vs-result">${draw ? '🤝 <b>Ничья!</b>' : win ? '🏆 <b>Ты победил!</b>' : `😔 <b>Победил ${esc(V.oppNick || 'соперник')}</b>`}
          <span>${fmt(a)} : ${gone ? '—' : fmt(b)}${gone ? ' · соперник вышел' : ''}</span></div>
        <div class="vs-hint" id="vsHint"></div>
        <div class="ct-actions"><button class="ct-start" id="vsRematch">↻ Реванш</button><button id="vsLeave">🚪 Выйти</button></div>`);
      root.querySelector('#vsRematch').onclick = () => {
        V.rematch.me = true;
        V.room.send({ type: 'rematch', round: V.round });
        if (V.room.isHost && V.rematch.opp) hostStart(); else hint(`Ждём ${esc(V.oppNick || 'соперника')}…`);
      };
      root.querySelector('#vsLeave').onclick = () => { location.hash = '#/games/' + game; };
      // В статистику — только настоящие партии: оба доиграли и кто-то что-то набрал
      if (V.opp.done && (a > 0 || b > 0)) api.report(game + '_duel', win && !draw, a, 0);
    }

    // Вызвать при выходе со страницы игры
    return () => { opts.stop?.(); V.room?.leave(); };
  }

  window.Versus = { start, rng };
})();
