// ═══════════════════════════════════════
//  СООБЩЕСТВА 2 (community2.sql) — поверх community.js (D37DS) и ленты msgview.js:
//  📅 события (как Discord Events): список «📅 События» над каналами, создать / изменить / отменить, «✅ Пойду», «🔴 Сейчас идёт»,
//  страница события #/chat/ev/<id> (карточка в ленте — msgview.js MV.evCardHtml). «Денчик-бот» и «📢 новости» — api/push-check.js.
//  Адреса: #/chat[/c/<id>]/events[/new | /edit/<id>], #/chat/ev/<id>; в телефоне — comm/<сервер>/events…, comm/ev/<id>.
//  Грузится вместе с community.js (phone.js → MODS.ds). Пока community2.sql не выполнен — «появится, когда сайт обновится».
// ═══════════════════════════════════════
(() => {
  const P = window.D37Phone, MV = window.MsgView, DS = window.D37DS;
  if (!P || !MV || !DS) return;
  const X = DS.x = DS.x || {};
  X.special = X.special || {}; X.sub = X.sub || {};
  const e = s => esc(s);
  const SOON = '<div class="ds-soon">🛠️ Появится, когда сайт обновится.</div>';
  const kidAbout = t => (window.D37Age?.kid?.() ? window.D37Age.kidText(String(t || ''), { at: false }) : String(t || ''));
  const ageBadge = n => (window.D37Age?.badge ? window.D37Age.badge(n) : `<span class="age-b">${+n}+</span>`);

  // ═══ События: кэш по серверу ('o' — «Денчик37», иначе номер сообщества) ═══
  const EV = new Map();
  const evKey = srv => (srv.official ? 'o' : String(srv.id));
  function evLoad(srv, fresh){
    const k = evKey(srv), c = EV.get(k);
    if (!fresh && c && c.d && Date.now() - c.d.t < 60000) return Promise.resolve(c.d);
    if (c?.p) return c.p;
    const p = P.rpc('cm_events', { p_community: srv.official ? null : srv.id }).then(r => {
      const d = { t: Date.now(), list: r.data?.list || [], can: !!r.data?.can, missing: !!r.missing,
        err: r.error && !r.missing ? P.err(r.error) : r.data && !r.data.ok ? r.data.reason || 'error' : '' };
      d.list.forEach(MV.evSet);
      EV.set(k, { d });
      window.dispatchEvent(new Event('d37:events'));
      return d;
    });
    EV.set(k, { d: c?.d || null, p });
    return p;
  }
  const evDrop = srv => EV.delete(evKey(srv));
  X.evLoad = evLoad;

  // Строка «📅 События» над каналами: сколько впереди, «идёт» — красным
  X.chanTop = (mode, srv, selCh) => {
    const c = EV.get(evKey(srv))?.d;
    if (!c || Date.now() - c.t > 60000) evLoad(srv).catch(() => {});
    const live = c && c.list.some(MV.evLive), n = c ? c.list.length : 0;
    return `<a class="ds-ch ds-evrow${selCh === 'x:events' ? ' on' : ''}" href="${DS.link(mode, srv.id, 'events')}"><i>📅</i><span>События</span>${live ? '<small class="ds-evlive">идёт</small>' : n ? `<em class="ds-evn">${n}</em>` : c?.missing ? '<small>скоро</small>' : ''}</a>`;
  };

  // ═══ Пункт списка событий ═══
  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const evHref = (mode, id) => (mode === 'phone' ? `#/phone/comm/ev/${id}` : `#/chat/ev/${id}`);
  function evItem(ev, mode, full){
    const d = new Date(ev.starts_at), live = MV.evLive(ev), pl = MV.evPlace(ev), ageOk = MV.evAgeOk(ev);
    const over = ev.status !== 'active' || Date.now() >= Date.parse(ev.ends_at);
    const btns = [];
    if (!ageOk) btns.push('<span class="ds-dim">🔞 Не по возрасту</span>');
    else if (!over) {
      if (live && pl.href) btns.push(`<a class="ds-btn ds-sm" href="${e(pl.href)}"${pl.ext ? ' target="_blank" rel="noopener"' : ''}>▶ Зайти</a>`);
      btns.push(`<button type="button" class="ds-btn ds-sm${ev.mine ? ' on' : ' ghost'}" data-ev="go" data-id="${e(ev.id)}">${ev.mine ? '✓ Иду' : '✅ Пойду'} · ${e(ev.going || 0)}</button>`);
    }
    btns.push(`<button type="button" class="ds-hb" data-ev="share" data-id="${e(ev.id)}" title="Ссылка на событие">🔗</button>`);
    if (ev.can && !over) btns.push(`<a class="ds-hb" href="${DS.link(mode, ev.community || DS.OFF_ID, 'events/edit/' + ev.id)}" title="Изменить">✏️</a>`,
      `<button type="button" class="ds-hb" data-ev="cancel" data-id="${e(ev.id)}" title="Отменить событие">❌</button>`);
    const about = ev.about ? `<p class="${full ? '' : 'ds-clamp'}">${e(P.clean(kidAbout(ev.about)))}</p>` : '';
    return `<div class="ds-ev${live ? ' live' : ''}${over ? ' off' : ''}" data-evid="${e(ev.id)}">
      <div class="ds-evd"><b>${d.getDate()}</b><small>${MONTHS[d.getMonth()]}</small></div>
      <div class="ds-evb"><a class="ds-evt" href="${evHref(mode, ev.id)}">${e(P.clean(ev.title))}</a>
        <small>${e(MV.evWhen(ev))}${pl.label ? ' · ' + e(pl.label) : ''}${ev.age ? ' · ' + ageBadge(ev.age) : ''}${full && ev.creator ? ' · создал(а) ' + e(ev.creator) : ''}</small>
        ${about}<div class="ds-row ds-evacts">${btns.join('')}</div></div></div>`;
  }
  const EV_REASON = { title: 'название — от 2 до 80 символов', about: 'описание — до 500 символов', bad: 'без мата, пожалуйста', link: 'ссылки нельзя',
    time: 'время — от «сейчас» до 90 дней вперёд', minutes: 'длится от 15 минут до 12 часов', age: 'метку 18+ ставит только команда сайта', place: 'место не найдено',
    rights: 'нет прав', limit: 'уже 15 будущих событий — подожди, пока какие-то пройдут', too_fast: 'не так быстро — до 6 новых событий в час',
    not_found: 'событие не найдено', auth: 'нужно войти', private: 'сообщество закрытое' };
  const evWhy = r => (r.missing ? 'появится, когда сайт обновится' : r.error ? P.err(r.error) : EV_REASON[r.data?.reason] || 'не получилось');

  // Кнопки списка и страницы события (свой обработчик — это не лента MsgView)
  async function evAct(ev0, root, mode, after){
    const b = ev0.target.closest('[data-ev]'); if (!b || !root.contains(b)) return;
    const id = +b.dataset.id, k = b.dataset.ev;
    if (k === 'go') {
      b.disabled = true;
      const r = await MV.evRsvp(id);
      b.disabled = false;
      if (!r.ok) { if (r.err !== 'auth') { if (P.toast) P.toast('⚠️ ' + r.err); else alert(r.err); } return; }
      P.toast?.(r.on ? '✅ Ты идёшь! Напомним за 15 минут 🔔' : 'Ок, не идёшь', true);
    } else if (k === 'share') {
      const url = (window.D37Ref?.wrap || (u => u))(`${location.origin}/#/chat/ev/${id}`);
      try { await navigator.clipboard.writeText(url); P.toast?.('🔗 Ссылка на событие скопирована — вставь её в чат', true); } catch (er) { prompt('Ссылка на событие:', url); }
      return;
    } else if (k === 'cancel') {
      if (!confirm('Отменить событие? Тем, кто идёт, придёт 🔔')) return;
      const r = await P.rpc('cm_event_cancel', { p_id: id });
      if (!r.data?.ok) { alert('Не получилось: ' + evWhy(r)); return; }
      await MV.evLoad(id, true); MV.evRefresh(id);
    }
    EV.clear();
    after?.();
  }

  // ═══ «📅 События» сервера: список / новое / изменить ═══
  X.sub.events = {
    title: '📅 События',
    async render(el, mode, srv, rest){
      if (rest[0] === 'new' || rest[0] === 'edit') return evForm(el, mode, srv, rest[0] === 'edit' ? +rest[1] : null);
      el.innerHTML = '<div class="ds-pane"><div class="ds-dim">Загружаем события…</div></div>';
      const d = await evLoad(srv, true);
      if (!el.isConnected) return;
      if (d.missing) { el.innerHTML = `<div class="ds-pane"><h3>📅 События</h3>${SOON}</div>`; return; }
      if (d.err) { el.innerHTML = `<div class="ds-pane"><h3>📅 События</h3><div class="ds-dim">⚠️ ${e(EV_REASON[d.err] || d.err)}</div></div>`; return; }
      const list = d.list.filter(ev => !window.D37Age || window.D37Age.listOk(ev.age));
      el.innerHTML = `<div class="ds-pane"><h3>📅 События ${srv.official ? 'сайта' : '«' + e(srv.name) + '»'}</h3>
        <p class="ds-dim">${srv.official ? 'Стримы, турниры и праздники на сайте.' : 'Встречи, турниры и игры сообщества.'} Нажми «✅ Пойду» — 🔔 напомним за 15 минут.</p>
        ${d.can ? `<div class="ds-row"><a class="ds-btn" href="${DS.link(mode, srv.id, 'events/new')}">＋ Создать событие</a></div>` : ''}
        <div class="ds-evlist">${list.length ? list.map(ev => evItem(ev, mode)).join('') : `<div class="ds-dim">Пока ничего не запланировано${d.can ? ' — создай первое!' : '.'}</div>`}</div></div>`;
      el.onclick = ev0 => evAct(ev0, el, mode, () => X.sub.events.render(el, mode, srv, rest));
    },
  };

  // Форма события: название, описание, когда, сколько длится, где, возраст, куда карточку
  async function evForm(el, mode, srv, id){
    if (!P.me()) { P.login(el, 'Создавать события могут вошедшие.'); return; }
    let ev = null;
    if (id) { ev = await MV.evLoad(id, true); if (!ev) { el.innerHTML = '<div class="ds-pane"><div class="ds-dim">Событие не найдено</div></div>'; return; } }
    const staff = typeof currentRole !== 'undefined' && ['admin', 'moderator'].includes(currentRole);
    const chans = (srv.channels || []).filter(c => !c.soon && (c.kind === 'text' || c.kind === 'voice'));
    const pad = n => String(n).padStart(2, '0');
    let start = ev ? new Date(ev.starts_at) : new Date();
    if (!ev) { start.setMinutes(0, 0, 0); start.setHours(start.getHours() < 18 ? 19 : 43); }   // сегодня в 19:00 или завтра в 19:00
    const dur = ev ? Math.round((Date.parse(ev.ends_at) - Date.parse(ev.starts_at)) / 60000) : 60;
    const curPlace = ev ? (ev.place_kind === 'text' || ev.place_kind === 'voice' ? ev.place_kind + ':' + ev.place : ev.place_kind) : 'none';
    const places = [['none', '— не указано']].concat(chans.map(c => [c.kind + ':' + c.id, (c.kind === 'voice' ? '🔊 ' : '# ') + c.name]),
      [['world', '🌍 Мир Денчика'], ['game', '🎮 Игра на сайте…'], ['stream', '📺 Стрим Денчика на Twitch']]);
    const games = (typeof GAMES !== 'undefined' ? GAMES : []).filter(g => g.id && !g.href);
    const ages = [0, 6, 12, 16].concat(staff ? [18] : []);
    const durs = [[30, '30 минут'], [60, '1 час'], [90, '1,5 часа'], [120, '2 часа'], [180, '3 часа'], [240, '4 часа'], [360, '6 часов'], [720, '12 часов']];
    if (!durs.some(x => x[0] === dur)) durs.push([dur, dur + ' мин']);
    const textCh = chans.filter(c => c.kind === 'text');
    el.innerHTML = `<div class="ds-pane"><h3>${ev ? '✏️ Изменить событие' : '📅 Новое событие'}</h3>
      <label class="ds-lbl">Название<input class="ds-in" data-f="title" maxlength="80" placeholder="Например: Турнир по шашкам" value="${e(ev?.title || '')}"></label>
      <label class="ds-lbl">Описание (необязательно)<textarea class="ds-in" data-f="about" maxlength="500" rows="3" placeholder="Правила, призы, кого ждём…">${e(ev?.about || '')}</textarea></label>
      <div class="ds-row ds-evtime"><label class="ds-lbl">Дата<input type="date" class="ds-in" data-f="date" value="${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}"></label>
        <label class="ds-lbl">Время<input type="time" class="ds-in" data-f="time" value="${pad(start.getHours())}:${pad(start.getMinutes())}"></label>
        <label class="ds-lbl">Длится<select class="ds-in" data-f="min">${durs.map(([m, t]) => `<option value="${m}"${m === dur ? ' selected' : ''}>${t}</option>`).join('')}</select></label></div>
      <label class="ds-lbl">Где<select class="ds-in" data-f="place">${places.map(([v, t]) => `<option value="${e(v)}"${v === curPlace ? ' selected' : ''}>${e(t)}</option>`).join('')}</select></label>
      <label class="ds-lbl" data-f="gamebox"${curPlace === 'game' ? '' : ' hidden'}>Игра<select class="ds-in" data-f="game">${games.map(g => `<option value="${e(g.id)}"${ev?.place === g.id ? ' selected' : ''}>${g.icon} ${e(g.title)}</option>`).join('')}</select></label>
      <label class="ds-lbl">Возраст<select class="ds-in" data-f="age">${ages.map(n => `<option value="${n}"${n === (ev?.age || 0) ? ' selected' : ''}>${n}+</option>`).join('')}</select></label>
      ${ev ? '' : srv.official ? '<p class="ds-dim">Карточка события появится в «📢 новости».</p>'
        : textCh.length ? `<label class="ds-lbl">Карточку — в канал<select class="ds-in" data-f="ann">${textCh.map(c => `<option value="${e(c.id)}">#${e(c.name)}</option>`).join('')}</select></label>` : ''}
      <p class="ds-dim">Без мата, ссылок и личных данных. Тем, кто нажмёт «✅ Пойду», придёт 🔔 за 15 минут до начала.</p>
      <div class="ds-row"><button type="button" class="ds-btn" data-ds="evsave">${ev ? 'Сохранить' : 'Создать'}</button><a class="ds-btn ghost" href="${DS.link(mode, srv.id, 'events')}">Отмена</a></div>
      <div class="ds-err" hidden></div></div>`;
    const q = s => el.querySelector(`[data-f="${s}"]`);
    q('place').onchange = () => { q('gamebox').hidden = q('place').value !== 'game'; };
    el.querySelector('[data-ds="evsave"]').onclick = async ev0 => {
      const b = ev0.currentTarget, err = el.querySelector('.ds-err');
      const at = new Date(`${q('date').value}T${q('time').value || '00:00'}`);
      if (!q('date').value || isNaN(at)) { err.hidden = false; err.textContent = '⚠️ Укажи дату и время'; return; }
      const pv = q('place').value, [pk, pid] = pv.includes(':') ? pv.split(':') : [pv, ''];
      b.disabled = true;
      const r = await P.rpc('cm_event_save', { p_id: ev ? ev.id : null, p_community: srv.official ? null : srv.id, p_title: q('title').value, p_about: q('about').value,
        p_start: at.toISOString(), p_minutes: +q('min').value, p_place_kind: pk, p_place: pk === 'game' ? q('game').value : pid, p_age: +q('age').value,
        p_announce: q('ann') ? +q('ann').value : null });
      b.disabled = false;
      if (r.data?.ok) { evDrop(srv); await MV.evLoad(r.data.id, true); MV.evRefresh(r.data.id); P.toast?.(ev ? '✅ Сохранено' : '📅 Событие создано', true); DS.go(mode, DS.link(mode, srv.id, 'events')); return; }
      err.hidden = false; err.textContent = '⚠️ ' + evWhy(r);
    };
  }

  // ═══ Страница события #/chat/ev/<id> ═══
  X.special.ev = {
    title: '📅 Событие',
    async render(el, mode, rest){
      const id = +rest[0];
      el.innerHTML = '<div class="ds-pane"><div class="ds-dim">Загружаем событие…</div></div>';
      if (!id) { el.innerHTML = '<div class="ds-pane"><div class="ds-dim">Событие не найдено</div></div>'; return; }
      const r = await P.rpc('cm_event_get', { p_id: id });
      if (!el.isConnected) return;
      if (r.missing) { el.innerHTML = `<div class="ds-pane"><h3>📅 Событие</h3>${SOON}</div>`; return; }
      const ev = r.data?.ok ? r.data.ev : null;
      if (!ev) { el.innerHTML = `<div class="ds-pane"><h3>Событие недоступно</h3><p class="ds-dim">${r.error ? '⚠️ ' + e(P.err(r.error)) : 'Его удалили, или оно только для участников закрытого сообщества.'}</p></div>`; return; }
      MV.evSet(ev);
      if (window.D37Age && !window.D37Age.listOk(ev.age)) { el.innerHTML = '<div class="ds-pane"><h3>🔞 Событие не по возрасту</h3></div>'; return; }
      const srvId = ev.community || DS.OFF_ID;
      el.innerHTML = `<div class="ds-pane">${ev.community ? `<a class="ds-evsrv" href="${DS.link(mode, srvId)}">${e(ev.cicon || '💬')} ${e(ev.cname || 'Сообщество')}</a>` : `<a class="ds-evsrv" href="${DS.link(mode, DS.OFF_ID, 'events')}">📅 Все события сайта</a>`}
        <div class="ds-evlist">${evItem(ev, mode, true)}</div>
        ${ev.status === 'cancelled' ? '<p class="ds-dim">❌ Событие отменено.</p>' : ''}</div>`;
      el.onclick = ev0 => evAct(ev0, el, mode, () => X.special.ev.render(el, mode, rest));
    },
  };
  // свежая карточка в ленте после «Пойду» в списке — и наоборот
  window.addEventListener('d37:event', () => EV.clear());
})();
