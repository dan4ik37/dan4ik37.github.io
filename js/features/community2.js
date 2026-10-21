// ═══════════════════════════════════════
//  СООБЩЕСТВА 2 (community.sql) — поверх community.js (D37DS) и ленты msgview.js:
//  📅 события (как Discord Events): список «📅 События» над каналами, создать / изменить / отменить, «✅ Пойду», «🔴 Сейчас идёт»,
//  страница события #/chat/ev/<id> (карточка в ленте — msgview.js MV.evCardHtml). «Денчик-бот» и «📢 новости» — api/push-check.js.
//  🧭 обзор сообществ (#/chat/find): поиск, категории, «большие / активные / новые», метка возраста, «Вступить»;
//  категория и метка — при создании и в настройках сообщества (владелец).
//  community.sql: 🎭 свои роли (#/chat/c/<id>/roles — цвет, место, права, кому выдать; цвет ника и группы участников — community.js).
//  Адреса: #/chat[/c/<id>]/events[/new | /edit/<id>], #/chat/ev/<id>; в телефоне — comm/<сервер>/events…, comm/ev/<id>.
//  Грузится вместе с community.js (phone.js → MODS.ds). Пока community.sql не выполнен — «появится, когда сайт обновится».
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
    // нет community.sql — сами не спрашиваем 10 минут (каждый запрос — лишняя 404 в консоли); открыл экран — спросим
    if (!fresh && c && c.d && Date.now() - c.d.t < (c.d.missing ? 600000 : 60000)) return Promise.resolve(c.d);
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
    if (!c || Date.now() - c.t > (c.missing ? 600000 : 60000)) evLoad(srv).catch(() => {});
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
      const url = (window.D37Ref?.wrap || (u => u))(window.D37Route ? D37Route.abs(`#/chat/ev/${id}`) : `${location.origin}/#/chat/ev/${id}`);
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

  // ═══ 🧭 Обзор сообществ (cm_catalog). Без community.sql — старый поиск по названию (cm_list_public) ═══
  const CATS = [['', 'Все'], ['games', '🎮 Игры'], ['art', '🎨 Творчество'], ['chat', '💬 Общение'], ['study', '📚 Учёба'], ['stream', '📺 Стримы']];
  const CAT_NAME = Object.fromEntries(CATS.slice(1));
  const CAT_BG = { games: '#7c3aed,#2563eb', art: '#db2777,#f59e0b', chat: '#0ea5e9,#22c55e', study: '#16a34a,#0d9488', stream: '#9147ff,#ef4444' };
  const SORTS = [['members', '👥 Большие'], ['active', '🔥 Активные'], ['new', '🆕 Новые']];
  X.CATS = CATS;
  X.ccard = (c, mode) => {
    const ag = +c.age || 0;
    if (window.D37Age && !window.D37Age.listOk(ag)) return '';
    const okAge = !window.D37Age || window.D37Age.canOpen(ag), mine = c.mine || DS.mine().some(x => x.id === c.id);
    const bg = c.boost && c.banner && X.BANNERS?.[c.banner] || `linear-gradient(135deg,${CAT_BG[c.category] || CAT_BG.chat})`;
    return `<div class="ds-cc${c.boost ? ' boost' : ''}" data-cid="${e(c.id)}"><div class="ds-ccban" style="background:${bg}"></div>
      <span class="ds-ccic${c.anim ? ' anim' : ''}">${e(c.icon)}</span>
      <div class="ds-ccb"><a class="ds-cct" href="${DS.link(mode, c.id)}">${e(P.clean(c.name))}${c.boost ? ' <i title="Буст">🚀</i>' : ''}</a>
        <small>👥 ${e(c.members)}${c.category ? ' · ' + e(CAT_NAME[c.category] || '') : ''}${ag ? ' · ' + ageBadge(ag) : ''}${c.active_at ? ' · 💬 ' + e(P.ago(c.active_at)) : ''}</small>
        ${c.about ? `<em>${e(P.clean(kidAbout(c.about)))}</em>` : ''}</div>
      <div class="ds-ccacts">${mine ? `<a class="ds-btn ghost ds-sm" href="${DS.link(mode, c.id)}">✓ Ты здесь — открыть</a>`
        : !okAge ? '<span class="ds-dim">🔞 Не по возрасту</span>'
        : `<a class="ds-btn ghost ds-sm" href="${DS.link(mode, c.id)}">Посмотреть</a><button type="button" class="ds-btn ds-sm" data-join="${e(c.id)}">Вступить</button>`}</div></div>`;
  };
  X.find = (el, mode) => {
    const st = { q: '', cat: '', sort: 'members', off: 0, list: [], old: !!X.oldCatalog, seq: 0 };
    el.innerHTML = `<div class="ds-pane ds-wide"><h3>🧭 Обзор сообществ</h3><p class="ds-dim">Открытые сообщества игроков сайта: найди своих или создай своё.</p>
      <div class="ds-row"><input type="search" class="ds-in" data-f="q" placeholder="Название или о чём…" aria-label="Поиск сообщества"><a class="ds-btn" href="${DS.special(mode, 'new')}">＋ Создать</a></div>
      <div class="ds-chips" data-f="cats">${CATS.map(([k, t]) => `<button type="button" class="${k ? '' : 'on'}" data-cat="${k}">${t}</button>`).join('')}</div>
      <div class="ds-chips ds-sort" data-f="sort">${SORTS.map(([k, t]) => `<button type="button" class="${k === 'members' ? 'on' : ''}" data-sort="${k}">${t}</button>`).join('')}</div>
      <div class="ds-dim ds-oldnote" hidden>Категории и сортировка появятся, когда сайт обновится — пока только поиск по названию.</div>
      <div class="ds-grid" data-f="list"><div class="ds-dim">Загружаем…</div></div>
      <div class="ds-row" data-f="morebox" hidden><button type="button" class="ds-btn ghost" data-ds="more">Показать ещё</button></div>
      <div class="ds-row ds-bycode"><input type="text" class="ds-in" data-f="code" placeholder="Код приглашения" title="Код приглашения — 8 знаков" maxlength="12" aria-label="Код приглашения"><button type="button" class="ds-btn ghost" data-ds="bycode">Войти по коду</button></div></div>`;
    const q = s => el.querySelector(`[data-f="${s}"]`), box = q('list');
    const load = async reset => {
      const my = ++st.seq;
      if (reset) { st.off = 0; st.list = []; }
      let r = st.old ? null : await P.rpc('cm_catalog', { p_q: st.q || null, p_cat: st.cat || null, p_sort: st.sort, p_offset: st.off });
      if (r?.missing) X.oldCatalog = st.old = true;
      if (st.old) { el.querySelector('.ds-oldnote').hidden = false; q('cats').hidden = q('sort').hidden = true; }
      if (st.old) r = await P.rpc('cm_list_public', { p_q: st.q || null });
      if (my !== st.seq || !el.isConnected) return;
      if (r.error) { box.innerHTML = r.missing ? '<div class="ds-soon">🛠️ Сообщества появятся, когда сайт обновится. Общий чат — уже работает (сервер «Денчик37» слева).</div>' : `<div class="ds-dim">⚠️ ${e(P.err(r.error))}</div>`; q('morebox').hidden = true; return; }
      const rows = Array.isArray(r.data) ? r.data : [];
      st.list = st.list.concat(rows); st.off += rows.length;
      const html = st.list.map(c => X.ccard(c, mode)).join('');
      box.innerHTML = html || `<div class="ds-dim">Ничего не нашли${st.q || st.cat ? '' : ' — пока пусто'}. Создай своё!</div>`;
      q('morebox').hidden = st.old || rows.length < 24;
    };
    let t = 0;
    q('q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.q = q('q').value.trim(); load(true); }, 350); });
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-cat],[data-sort],[data-ds],[data-join]'); if (!b || !el.contains(b)) return;
      if (b.dataset.cat !== undefined) { st.cat = b.dataset.cat; q('cats').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); load(true); }
      else if (b.dataset.sort) { st.sort = b.dataset.sort; q('sort').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); load(true); }
      else if (b.dataset.join) {
        if (!P.me()) { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); return; }
        b.disabled = true;
        const r = await P.rpc('cm_join', { p_id: +b.dataset.join, p_code: null });
        if (r.data?.ok) { await DS.loadMy(true); DS.go(mode, DS.link(mode, r.data.id)); return; }
        b.disabled = false; alert('Не получилось: ' + DS.why(r));
      } else if (b.dataset.ds === 'more') load(false);
      else if (b.dataset.ds === 'bycode') { const c = q('code').value.trim().toLowerCase().replace(/[^a-z0-9]/g, ''); if (c.length >= 6) DS.go(mode, DS.special(mode, 'join/' + c)); }
    });
    load(true);
  };

  // ═══ Категория и возраст сообщества: при создании и в настройках (владелец) ═══
  X.metaHtml = id => {
    const staff = typeof currentRole !== 'undefined' && ['admin', 'moderator'].includes(currentRole);
    if (id) setTimeout(() => metaFill(id), 0);
    return `<div class="ds-row ds-meta" data-meta="${e(id || '')}"><label class="ds-lbl">Категория<select class="ds-in" data-f="mcat">${CATS.slice(1).map(([k, t]) => `<option value="${k}"${k === 'chat' ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="ds-lbl">Возраст<select class="ds-in" data-f="mage">${[0, 6, 12, 16].concat(staff ? [18] : []).map(n => `<option value="${n}">${n}+</option>`).join('')}</select></label></div>`;
  };
  async function metaFill(id){
    const box = document.querySelector(`.ds-meta[data-meta="${+id}"]`); if (!box || typeof sbClient === 'undefined' || !sbClient) return;
    const { data, error } = await sbClient.from('communities').select('category, age').eq('id', +id).maybeSingle();
    if (error) { box.innerHTML = '<div class="ds-dim">Категория и возраст появятся, когда сайт обновится.</div>'; return; }
    if (data) { box.querySelector('[data-f="mcat"]').value = data.category; box.querySelector('[data-f="mage"]').value = String(data.age); }
  }
  X.metaSave = async (el, id) => {
    const c = el.querySelector('[data-f="mcat"]'), a = el.querySelector('[data-f="mage"]');
    if (!c || !a) return {};
    const r = await P.rpc('cm_set_meta', { p_id: +id, p_category: c.value, p_age: +a.value });
    return r.data?.ok || r.missing ? {} : { err: DS.why(r) };
  };

  // ═══ 🎭 Свои роли (community.sql): цвет ника, место, права; выдаёт владелец ═══
  // roleData: { roles: [{ id, name, color, position, perms }] (выше — первой), byId, my (мои права), top (моё место), missing }
  const RD = new Map();
  const PERMS = [[1, '📁 Каналы'], [2, '🔨 Модерация'], [4, '📌 Закреп'], [8, '📅 События'], [16, '📣 @everyone']];
  X.roleSync = cid => RD.get(String(cid))?.d || null;
  X.roleData = (cid, fresh) => {
    const k = String(cid), c = RD.get(k);
    if (!fresh && c?.d && Date.now() - c.d.t < (c.d.missing ? 600000 : 60000)) return Promise.resolve(c.d);
    if (c?.p) return c.p;
    const p = P.rpc('cm_roles', { p_id: +cid }).then(r => {
      const roles = (r.data?.ok && Array.isArray(r.data.roles) ? r.data.roles : []).filter(x => /^#[0-9a-f]{6}$/i.test(x.color || ''));
      const d = { t: Date.now(), roles, byId: new Map(roles.map(x => [x.id, x])), my: +r.data?.my || 0, top: +r.data?.top || 0, missing: !!r.missing };
      RD.set(k, { d });
      if (roles.length || d.my) window.dispatchEvent(new CustomEvent('d37:roles', { detail: k }));
      return d;
    });
    RD.set(k, { d: c?.d || null, p });
    return p;
  };
  // в настройках сообщества — переход к ролям (владелец) и к бусту
  X.settingsMore = (srv, mode) => (srv.role === 'owner' || srv.staff ? `<div class="ds-sect"><b>🎭 Роли</b><p class="ds-dim">Свои роли, как в Дискорде: цвет ника, место в списке и права (каналы, модерация, закреп, события, @everyone).</p>
    <a class="ds-btn ghost" href="${DS.link(mode, srv.id, 'roles')}">Настроить роли →</a></div>` : '')
    + `<div class="ds-sect"><b>🚀 Буст</b><p class="ds-dim">Баннер, анимированный значок, красивая ссылка, до 40 каналов.</p><a class="ds-btn ghost" href="${DS.link(mode, srv.id, 'boost')}">Буст →</a></div>`;

  // ═══ 🚀 Буст (community.sql): 30 дней — 100 💎 / 90 — 270 💎, сроки складываются, можно в подарок; оформление — владелец ═══
  X.BANNERS = { sunset: 'linear-gradient(135deg,#f97316,#db2777)', ocean: 'linear-gradient(135deg,#0ea5e9,#6366f1)', forest: 'linear-gradient(135deg,#16a34a,#065f46)',
    neon: 'linear-gradient(135deg,#22d3ee,#a855f7)', gold: 'linear-gradient(135deg,#fbbf24,#b45309)', night: 'linear-gradient(135deg,#1e3a8a,#0f172a)',
    candy: 'linear-gradient(135deg,#f472b6,#a78bfa)', lava: 'linear-gradient(135deg,#ef4444,#7f1d1d)' };
  const BANNER_NAME = { sunset: 'Закат', ocean: 'Океан', forest: 'Лес', neon: 'Неон', gold: 'Золото', night: 'Ночь', candy: 'Конфета', lava: 'Лава' };
  const BOOST_REASON = { member: 'бустить могут участники сообщества', gems: 'не хватает 💎', months: 'неверный срок', closed: 'магазин на паузе — попробуй позже',
    rate: 'слишком часто — попробуй завтра', gems_off: 'кристаллы появятся, когда сайт обновится', rights: 'оформляет владелец', boost: 'сначала нужен буст',
    vanity: 'ссылка — от 6 до 12 латинских букв и цифр', taken: 'такая ссылка уже занята', bad: 'без мата, пожалуйста', banner: 'неизвестный баннер', auth: 'нужно войти', not_found: 'не найдено' };
  const boostWhy = r => (r.missing ? 'появится, когда сайт обновится' : r.error ? P.err(r.error) : BOOST_REASON[r.data?.reason] || 'не получилось');
  X.sub.boost = {
    title: '🚀 Буст',
    async render(el, mode, srv){
      el.innerHTML = '<div class="ds-pane"><div class="ds-dim">Загружаем…</div></div>';
      const r = await P.rpc('cm_boost_info', { p_id: srv.id });
      if (!el.isConnected) return;
      if (r.missing) { el.innerHTML = `<div class="ds-pane"><h3>🚀 Буст</h3>${SOON}</div>`; return; }
      const b = r.data?.ok ? r.data : null;
      if (!b) { el.innerHTML = `<div class="ds-pane"><div class="ds-dim">⚠️ ${e(boostWhy(r))}</div></div>`; return; }
      const owner = srv.role === 'owner' || srv.staff, member = !!srv.role || !!srv.staff;
      const gems = window.D37Gems?.isOn?.() ? window.D37Gems.balance() : null;
      const until = b.until ? new Date(b.until).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '';
      const van = b.vanity ? `${location.origin}/c/${b.vanity}` : '';
      el.innerHTML = `<div class="ds-pane"><div class="ds-bhero" style="background:${b.boost && X.BANNERS[b.banner] || 'linear-gradient(135deg,#ec4899,#8b5cf6)'}"><span class="${b.boost && b.anim ? 'ds-anim' : ''}">${e(srv.c?.icon || '🚀')}</span><b>${e(srv.name)}</b><small>${b.boost ? '🚀 Буст до ' + e(until) : 'Без буста'}${b.boosters ? ` · бустили: ${e(b.boosters)}` : ''}</small></div>
        <h3>🚀 Буст сообщества</h3>
        <ul class="ds-perks"><li>🖼 Баннер — в обзоре и над каналами</li><li>✨ Анимированный значок</li><li>🔗 Красивая ссылка-приглашение /c/имя</li><li>📁 До 40 каналов (голосовых — до 10)</li><li>🚀 Значок буста в обзоре</li></ul>
        <p class="ds-dim">Только красота и удобство: место в обзоре буст не поднимает. Сроки складываются, бустить можно и в подарок любимому сообществу.</p>
        ${member ? `<div class="ds-row"><button type="button" class="ds-btn" data-bb="1">🚀 30 дней — ${e(b.prices['1'])} 💎</button><button type="button" class="ds-btn ghost" data-bb="3">🚀 90 дней — ${e(b.prices['3'])} 💎</button></div>
          <p class="ds-dim">${gems !== null ? `У тебя ${e(gems)} 💎 · ` : ''}<a href="#/shop">💎 Кристаллы — в магазине</a></p>` : '<p class="ds-dim">Бустить могут участники сообщества.</p>'}
        ${van ? `<div class="ds-row"><input class="ds-in" readonly value="${e(van)}" aria-label="Красивая ссылка"><button type="button" class="ds-btn ghost" data-bs="copy">📋</button></div>` : ''}
        ${owner ? b.boost ? `<div class="ds-sect"><b>Оформление</b>
          <div class="ds-banners">${Object.keys(X.BANNERS).map(k => `<button type="button" class="${k === b.banner ? 'on' : ''}" data-bn="${k}" style="background:${X.BANNERS[k]}" title="${BANNER_NAME[k]}" aria-label="Баннер «${BANNER_NAME[k]}»"></button>`).join('')}</div>
          <label class="ds-chk"><input type="checkbox" data-f="anim"${b.anim ? ' checked' : ''}> ✨ Анимированный значок</label>
          <label class="ds-lbl">Красивая ссылка (6–12 латинских букв и цифр)<div class="ds-row"><span class="ds-dim">${e(location.host)}/c/</span><input class="ds-in" data-f="van" maxlength="12" value="${e(b.vanity || '')}" placeholder="например, denchik37"></div></label>
          <button type="button" class="ds-btn" data-bs="save">Сохранить оформление</button></div>`
          : '<p class="ds-dim">Когда буст включится, здесь появится оформление: баннер, анимация и красивая ссылка.</p>' : ''}
        <div class="ds-err" hidden></div></div>`;
      let banner = b.banner || '';
      const err = t => { const x = el.querySelector('.ds-err'); x.hidden = !t; x.innerHTML = t ? '⚠️ ' + t : ''; };
      el.onclick = async ev => {
        const t = ev.target.closest('[data-bb],[data-bn],[data-bs]'); if (!t) return;
        if (t.dataset.bn) { banner = t.dataset.bn; el.querySelectorAll('[data-bn]').forEach(x => x.classList.toggle('on', x === t)); return; }
        if (t.dataset.bs === 'copy') { try { await navigator.clipboard.writeText(van); P.toast?.('🔗 Ссылка скопирована', true); } catch (er) { prompt('Ссылка:', van); } return; }
        if (t.dataset.bb) {
          if (!P.me()) { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); return; }
          const m = +t.dataset.bb, price = b.prices[String(m)];
          if (!confirm(`Потратить ${price} 💎 на буст «${srv.name}» на ${m * 30} дней?`)) return;
          t.disabled = true;
          const r2 = await P.rpc('cm_boost_buy', { p_community: srv.id, p_months: m });
          t.disabled = false;
          if (!r2.data?.ok) { err(r2.data?.reason === 'gems' ? `не хватает 💎 — нужно ${e(r2.data.need)}. <a href="#/shop">Пополнить</a>` : e(boostWhy(r2))); return; }
          P.toast?.('🚀 Спасибо за буст!', true);
          window.D37Gems?.sync?.();
        } else if (t.dataset.bs === 'save') {
          const r2 = await P.rpc('cm_boost_set', { p_community: srv.id, p_banner: banner, p_anim: !!el.querySelector('[data-f="anim"]')?.checked, p_vanity: el.querySelector('[data-f="van"]')?.value || '' });
          if (!r2.data?.ok) { err(e(boostWhy(r2))); return; }
          P.toast?.('✅ Оформление сохранено', true);
        }
        DS.dropC(srv.id); await DS.loadMy(true);
        X.sub.boost.render(el, mode, srv);
        window.dispatchEvent(new Event('d37:events'));   // перерисовать список серверов и шапку
      };
    },
  };
  X.sub.roles = {
    title: '🎭 Роли',
    async render(el, mode, srv){
      el.innerHTML = '<div class="ds-pane"><div class="ds-dim">Загружаем роли…</div></div>';
      const owner = srv.role === 'owner' || srv.staff;
      const R = await X.roleData(srv.id, true);
      if (!el.isConnected) return;
      if (R.missing) { el.innerHTML = `<div class="ds-pane"><h3>🎭 Роли</h3>${SOON}</div>`; return; }
      if (!owner) { el.innerHTML = '<div class="ds-pane"><h3>🎭 Роли</h3><p class="ds-dim">Роли настраивает и выдаёт владелец сообщества.</p></div>'; return; }
      const members = (await DS.membersOf(srv.id, true)).filter(m => m.role !== 'owner');
      const next = R.roles.reduce((a, x) => Math.max(a, x.position), 0) + 1;
      const roleRow = x => `<div class="ds-role" data-rid="${x ? e(x.id) : ''}">
        <div class="ds-row"><input type="color" class="ds-rc" data-rf="color" value="${e(x?.color || '#99aab5')}" aria-label="Цвет роли"><input class="ds-in" data-rf="name" maxlength="24" value="${e(x?.name || '')}" placeholder="Название роли" aria-label="Название роли">
          <label class="ds-chk ds-sm" title="Выше — главнее">Место <input type="number" class="ds-in ds-num" data-rf="pos" min="1" max="99" value="${x ? e(x.position) : Math.min(99, next)}"></label></div>
        <div class="ds-perms">${PERMS.map(([b, t]) => `<label class="ds-chk ds-sm"><input type="checkbox" data-pb="${b}"${x && x.perms & b ? ' checked' : ''}> ${t}</label>`).join('')}</div>
        <div class="ds-row"><button type="button" class="ds-btn ds-sm" data-ra="save">${x ? '💾 Сохранить' : '＋ Добавить роль'}</button>${x ? '<button type="button" class="ds-btn bad ds-sm" data-ra="del">🗑 Удалить</button>' : ''}</div></div>`;
      const chip = id => { const x = R.byId.get(id); return x ? `<button type="button" class="ds-rchip" data-ra="take" data-rid="${e(id)}" style="--rc:${e(x.color)}" title="Снять роль">● ${e(x.name)} ✕</button>` : ''; };
      el.innerHTML = `<div class="ds-pane"><h3>🎭 Роли «${e(srv.name)}»</h3>
        <p class="ds-dim">Цвет ника — по верхней роли. Роль с «🔨 Модерацией» глушит, выгоняет и банит только участников, у кого роль ниже. Владелец и модераторы — как раньше.</p>
        ${R.roles.map(roleRow).join('')}<div class="ds-sect"><b>Новая роль</b>${R.roles.length >= 20 ? '<p class="ds-dim">Не больше 20 ролей.</p>' : roleRow(null)}</div>
        <div class="ds-sect"><b>Кому какая роль</b>${members.length ? members.map(m => `<div class="ds-chrow" data-uid="${e(m.id)}"><span>${e(m.nick)}${m.role === 'mod' ? ' 🛡' : ''}</span>${(m.roles || []).map(chip).join('')}
          ${R.roles.length ? `<select class="ds-in ds-sm" data-ra="give" aria-label="Выдать роль"><option value="">＋ роль…</option>${R.roles.filter(x => !(m.roles || []).includes(x.id)).map(x => `<option value="${e(x.id)}">${e(x.name)}</option>`).join('')}</select>` : ''}</div>`).join('') : '<div class="ds-dim">Пока никого, кроме тебя</div>'}</div>
        <div class="ds-err" hidden></div></div>`;
      const err = t => { const x = el.querySelector('.ds-err'); x.hidden = !t; x.textContent = t ? '⚠️ ' + t : ''; };
      const done = async r => { if (r.data?.ok) { DS.dropC(srv.id); await X.roleData(srv.id, true); X.sub.roles.render(el, mode, srv); } else err(DS.why(r)); };
      el.onclick = async ev => {
        const b = ev.target.closest('[data-ra]'); if (!b || b.tagName === 'SELECT') return;
        const box = b.closest('.ds-role'), uid = b.closest('[data-uid]')?.dataset.uid;
        if (b.dataset.ra === 'save' && box) {
          const perms = [...box.querySelectorAll('[data-pb]')].reduce((a, x) => a | (x.checked ? +x.dataset.pb : 0), 0);
          done(await P.rpc('cm_role_save', { p_community: srv.id, p_id: box.dataset.rid ? +box.dataset.rid : null, p_name: box.querySelector('[data-rf="name"]').value,
            p_color: box.querySelector('[data-rf="color"]').value, p_position: +box.querySelector('[data-rf="pos"]').value, p_perms: perms }));
        } else if (b.dataset.ra === 'del' && box) { if (confirm('Удалить роль? У всех, у кого она есть, она пропадёт.')) done(await P.rpc('cm_role_delete', { p_id: +box.dataset.rid })); }
        else if (b.dataset.ra === 'take' && uid) done(await P.rpc('cm_role_assign', { p_community: srv.id, p_user: uid, p_role: +b.dataset.rid, p_on: false }));
      };
      el.onchange = async ev => {
        const s = ev.target.closest('select[data-ra="give"]'); if (!s || !s.value) return;
        done(await P.rpc('cm_role_assign', { p_community: srv.id, p_user: s.closest('[data-uid]').dataset.uid, p_role: +s.value, p_on: true }));
      };
    },
  };
})();

// ═══════════════════════════════════════
//  СООБЩЕСТВА 4 (community.sql, ч. 4) — управлять удобнее (владелец 16.10: «доработай настройки управления, чтобы модерам легче
//  было и участникам, с каналами что-то сделать надо»). Сервер «Денчик37» и сообщества — одинаково:
//  📁 категории в списке каналов (свернуть/развернуть — d37_ds_fold), экран «📁 Каналы» #/chat[/c/<id>]/channels[/<канал>]:
//  порядок (⠿ перетаскивание на компьютере, ↑ ↓ на телефоне), категории, настройки канала (название, тема, 🐢, кто пишет, 🗄 архив,
//  удалить); модераторам — в меню сообщения и в карточке человека: ⚠️ предупредить, ⏳ тайм-аут, 🗑 с причиной, 🧹 его последние,
//  👢 / ⛔ с причиной (DS.x.wrapAdapter); «🛡 Модерация» #/chat[/c/<id>]/reports[/log|/automod|/all] — жалобы с быстрыми действиями,
//  📜 журнал, 🤖 автомодерация; участникам — 🔔 все / @ / ничего, 🔕 сервер или канал, «✓ прочитано» (d37_ds_notif + cm_notif_*).
//  Пока свежий community.sql не выполнен — старое поведение и «появится, когда сайт обновится».
// ═══════════════════════════════════════
(() => {
  const P = window.D37Phone, MV = window.MsgView, DS = window.D37DS;
  if (!P || !MV || !DS) return;
  const X = DS.x = DS.x || {};
  X.sub = X.sub || {};
  const e = s => esc(s);
  const SOON = '<div class="ds-soon">🛠️ Появится, когда сайт обновится.</div>';
  const R4 = { name: 'название — от 1 до 32 символов', about: 'тема — до 200 символов', bad: 'без мата, пожалуйста', link: 'ссылки нельзя', slow: 'неверная задержка',
    rights: 'нет прав', limit: 'достигнут предел', not_found: 'не найдено', last: 'этот канал убрать нельзя', data: 'неверные данные', auth: 'нужно войти',
    self: 'с собой так нельзя', staff: 'только команда сайта', guest: 'у гостя нет уведомлений — только тайм-аут', minutes: 'такой срок нельзя (хелпер — до часа)',
    member: 'его уже нет в сообществе', action: 'неизвестное действие', rate: 'слишком часто — попробуй позже', level: 'неверный уровень', private: 'сообщество закрытое' };
  const why4 = r => (r?.missing ? 'появится, когда сайт обновится' : r?.error ? P.err(r.error) : R4[r?.data?.reason] || (DS.why ? DS.why(r) : 'не получилось'));
  const toast = (t, good) => (P.toast ? P.toast(t, good) : alert(t));
  const staffRole = () => window.D37Chat?.info?.()?.staff || (typeof currentRole !== 'undefined' && ['admin', 'moderator', 'helper'].includes(currentRole) ? currentRole : null);
  const LS = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (er) { return d; } };
  const LSset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (er) {} };
  const skey = s => (s && typeof s === 'object' ? (s.official ? 'o' : String(s.id)) : s == null || s === DS.OFF_ID || s === 'o' ? 'o' : String(s));
  const repaint = () => { DS.refreshSide?.(); DS.refreshBadge?.(); window.dispatchEvent(new Event('d37:events')); };

  // ═══ Лист с кнопками поверх всего (и телефона 📱): выбор → data-v (или collect(лист, v)); Esc / мимо — null ═══
  function sheet(title, body, collect){
    return new Promise(res => {
      const w = document.createElement('div');
      w.className = 'ds4-sh'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true');
      w.innerHTML = `<div class="ds4-box"><div class="ds4-t">${title}</div>${body}<button type="button" class="ds4-wide ghost" data-v="">Отмена</button></div>`;
      const key = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); done(null); } };
      const done = v => { w.remove(); document.removeEventListener('keydown', key, true); res(v); };
      w.addEventListener('click', ev => {
        if (ev.target === w) return done(null);
        const chip = ev.target.closest('[data-chip]'), pk = ev.target.closest('[data-pick]');
        if (chip) { const i = w.querySelector('[data-f="reason"]'); if (i) { i.value = chip.dataset.chip; i.focus(); } return; }
        if (pk) { pk.parentElement.querySelectorAll('[data-pick]').forEach(x => x.classList.toggle('on', x === pk)); return; }
        const b = ev.target.closest('[data-v]'); if (!b) return;
        done(b.dataset.v ? (collect ? collect(w, b.dataset.v) : b.dataset.v) : null);
      });
      w.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.matches('input')) { ev.preventDefault(); w.querySelector('.ds4-go')?.click(); } });
      document.addEventListener('keydown', key, true);
      document.body.appendChild(w);
      setTimeout(() => (w.querySelector('input') || w.querySelector('.ds4-box button'))?.focus?.(), 30);
    });
  }
  X.sheet = sheet;
  const REASONS = ['Спам', 'Флуд', 'Мат', 'Оскорбления', 'Реклама', 'Не по теме', 'Личные данные'];
  const DUR = [[5, '5 минут'], [60, '1 час'], [1440, '1 день'], [10080, '1 неделя']];
  const picks = (list, on) => `<div class="ds4-opts">${list.map(([v, t]) => `<button type="button" class="ds4-opt${String(v) === String(on) ? ' on' : ''}" data-pick="${e(v)}">${e(t)}</button>`).join('')}</div>`;
  const askReason = (title, btn, extra = '', notify = false) => sheet(title, `${extra}<div class="ds4-chips">${REASONS.map(t => `<button type="button" class="ds4-chip" data-chip="${e(t)}">${e(t)}</button>`).join('')}</div>
    <label class="ds-lbl">Причина — видна в журнале${notify ? ' и ему в 🔔' : ''}<input class="ds-in" data-f="reason" maxlength="200" placeholder="Например: спам ссылками"></label>
    <button type="button" class="ds4-wide ds4-go ${btn.cls ?? 'bad'}" data-v="go">${btn.t}</button>`,
    w => ({ reason: w.querySelector('[data-f="reason"]').value.trim(), pick: [...w.querySelectorAll('.ds4-opts')].map(o => o.querySelector('.on')?.dataset.pick), purge: !!w.querySelector('[data-f="purge"]')?.checked }));

  // ═══ 🔔 Уведомления сервера: все / только @упоминания / ничего; заглушить сервер или канал (без точек «новое» и без @everyone) ═══
  const NP = LS('d37_ds_notif', {});
  const pref = k => Object.assign({ level: 'all', muted: false, ch: [] }, NP[k] || {});
  DS.muteOf = (srv, ch) => { const p = NP[skey(srv)]; if (!p) return false; return !!p.muted || (ch != null && (p.ch || []).includes(String(ch.id ?? ch))); };
  function prefSet(k, p){
    if (p.level === 'all' && !p.muted && !(p.ch || []).length) delete NP[k]; else NP[k] = p;
    LSset('d37_ds_notif', NP);
    if (P.me()) P.rpc('cm_notif_set', { p_community: k === 'o' ? 0 : +k, p_level: p.level, p_muted: !!p.muted, p_muted_ch: (p.ch || []).map(String) });
    repaint();
  }
  X.prefSet = prefSet;
  async function prefSync(){
    if (!P.me()) return;
    const r = await P.rpc('cm_notif_get');
    if (r.error || !Array.isArray(r.data)) return;
    if (!r.data.length) { Object.keys(NP).forEach(k => prefSet(k, pref(k))); return; }   // настроил до входа — на сервер
    Object.keys(NP).forEach(k => delete NP[k]);
    r.data.forEach(x => { NP[+x.c === 0 ? 'o' : String(x.c)] = { level: x.level, muted: !!x.muted, ch: (x.ch || []).map(String) }; });
    LSset('d37_ds_notif', NP); repaint();
  }
  setTimeout(prefSync, 1500);
  window.addEventListener('d37:auth', () => setTimeout(prefSync, 500));
  function markAll(srv){
    const C = window.D37Chat;
    if (srv.official) {
      (srv.channels || []).forEach(c => { const id = c.kind === 'text' ? C?.lastId?.(c.id) || 0 : 0; if (id) MV.markRead('o:' + c.id, id); });
      if (C?.mentions) Object.keys(C.mentions).forEach(k => delete C.mentions[k]);
    } else {
      let mx = srv.lastMax || 0;
      (srv.channels || []).forEach(c => { if (c.last_id) { MV.markRead('c:' + c.id, c.last_id); mx = Math.max(mx, c.last_id); } });
      MV.markRead('cc:' + srv.id, mx);
    }
    repaint();
  }
  async function notifSheet(sid, chId){
    const srv = await DS.server(sid === 'o' ? DS.OFF_ID : +sid);
    if (!srv?.ok) return;
    const k = skey(srv), p = pref(k), ch = chId ? (srv.channels || []).find(c => String(c.id) === String(chId) && c.kind === 'text') : null;
    const LV = [['all', '🔔 Все сообщения'], ['mentions', '@ Только упоминания'], ['none', '🔕 Ничего']];
    const v = await sheet(`🔔 <b>${srv.official ? 'Денчик37' : e(srv.name)}</b> — уведомления`, `<div class="ds4-opts">${LV.map(([x, t]) => `<button type="button" class="ds4-opt${p.level === x ? ' on' : ''}" data-v="lv:${x}">${t}</button>`).join('')}</div>
      <p class="ds-dim">«Упоминания» — @ник и ответы тебе. «Ничего» — без 🔔 от сервера. Предупреждения модераторов приходят всегда.</p>
      <button type="button" class="ds4-wide" data-v="srv">${p.muted ? '🔔 Включить сервер' : '🔕 Заглушить сервер — без точек «новое» и @everyone'}</button>
      ${ch ? `<button type="button" class="ds4-wide" data-v="ch">${p.ch.includes(String(ch.id)) ? '🔔 Включить' : '🔕 Заглушить'} канал #${e(ch.name)}</button>` : ''}
      <button type="button" class="ds4-wide" data-v="read">✓ Отметить всё прочитанным</button>`);
    if (!v) return;
    if (v === 'read') { markAll(srv); toast('✓ Всё прочитано', true); return; }
    if (v.startsWith('lv:')) p.level = v.slice(3);
    else if (v === 'srv') p.muted = !p.muted;
    else if (v === 'ch' && ch) p.ch = p.ch.includes(String(ch.id)) ? p.ch.filter(x => x !== String(ch.id)) : p.ch.concat(String(ch.id));
    prefSet(k, p);
    toast(v === 'srv' ? (p.muted ? '🔕 Сервер заглушён — @упоминания всё равно придут' : '🔔 Сервер включён') : v === 'ch' ? '✅ Готово' : '✅ ' + LV.find(x => x[0] === p.level)[1], true);
  }

  // ═══ 📁 Категории в списке каналов (свернуть/развернуть запоминается). null — категорий и архива нет, список как раньше ═══
  const FOLD = LS('d37_ds_fold', {});
  const folded = (s, k) => (k === 'arch' ? FOLD[s + ':' + k] !== 0 : !!FOLD[s + ':' + k]);
  X.chanLayout = (mode, srv, selCh, row) => {
    const cats = (srv.cats || []).slice().sort((a, b) => a.pos - b.pos || a.id - b.id);
    const all = srv.channels || [], arch = all.filter(c => c.archived), live = all.filter(c => !c.archived);
    if (!cats.length && !arch.length) return null;
    const s = skey(srv), ids = new Set(cats.map(k => k.id));
    const head = (k, name, n) => { const f = folded(s, k); return `<button type="button" class="ds-cat ds4-cat${f ? ' fold' : ''}" data-ds4="fold" data-s="${e(s)}" data-k="${e(k)}" aria-expanded="${!f}"><i>▾</i><span>${e(name)}</span>${f && n ? `<small>${n}</small>` : ''}</button>`; };
    const list = (k, arr) => arr.filter(c => !folded(s, k) || String(c.id) === String(selCh)).map(row).join('');
    let h = live.filter(c => (c.cat == null || !ids.has(c.cat)) && c.kind !== 'twitch').map(row).join('');
    cats.forEach(k => { const arr = live.filter(c => c.cat === k.id && c.kind !== 'twitch'); h += head(k.id, k.name, arr.length) + list(k.id, arr); });
    if (arch.length) h += head('arch', '🗄 Архив', arch.length) + list('arch', arch);
    return h + live.filter(c => c.kind === 'twitch').map(row).join('');
  };
  function toggleFold(s, k){ FOLD[s + ':' + k] = folded(s, k) ? 0 : 1; LSset('d37_ds_fold', FOLD); repaint(); }
  X.fold = toggleFold;

  // ═══ 🛡 Модерация в меню сообщения и в карточке человека: кого можно трогать — решают старые права адаптера ═══
  X.wrapAdapter = (A0, srv, ch) => {
    if (!A0 || !A0.modActions) return A0;
    const A = Object.create(A0), off = !!srv.official, cid = srv.id;
    const list = (m, card) => {
      const base = A0.modActions(m) || [];
      if (!base.length) return [];
      const out = [['warn', '⚠️ Предупредить…'], ['timeout', '⏳ Тайм-аут…']];
      if (!card && m.id != null && !String(m.id).startsWith('demo')) out.push(['delr', '🗑 Удалить с причиной…']);
      if (ch?.kind === 'text') out.push(['purge', '🧹 Удалить его последние…']);
      if (!off) out.push(['kick', '👢 Выгнать…'], ['ban', '⛔ Забанить…']);
      else if (base.some(([k]) => k === 'ban')) out.push(['ban', '🔨 Бан по нику…']);
      return out;
    };
    const res = (r, okMsg, extra) => (r.data?.ok ? Object.assign({ ok: true, msg: okMsg }, extra || {}) : { ok: false, msg: '⚠️ ' + why4(r) });
    const fn = off ? 'chat_mod' : 'cm_mod';
    const args = (uid, nick, a, min, reason, purge) => (off ? { p_user: uid || null, p_nick: nick || '', p_action: a, p_minutes: min, p_reason: reason }
      : { p_community: cid, p_user: uid, p_action: a, p_minutes: min, p_reason: reason, p_purge: !!purge });
    async function act(k, uid, nick, m){
      const who = `<b>${e(nick || 'игрок')}</b>`, mm = m || { uid, nick };
      if (k === 'warn') {
        if (off && !uid) return { ok: false, msg: '⚠️ ' + R4.guest };
        const a = await askReason(`⚠️ Предупредить ${who}`, { t: '⚠️ Предупредить', cls: '' }, '<p class="ds-dim">Ему придёт 🔔 с причиной, в журнал — запись.</p>', true);
        return a ? res(await P.rpc(fn, args(uid, nick, 'warn', 0, a.reason)), `⚠️ ${nick} предупреждён`) : { ok: false };
      }
      if (k === 'timeout') {
        const d = off && staffRole() === 'helper' ? DUR.slice(0, 2) : DUR;
        const a = await askReason(`⏳ Тайм-аут для ${who}`, { t: '⏳ Заглушить' }, '<p class="ds-dim">Сколько не сможет писать:</p>' + picks(d, 60));
        if (!a) return { ok: false };
        const min = +(a.pick[0] || 60), r = await P.rpc(fn, args(uid, nick, 'mute', min, a.reason));
        if (r.missing) return A0.mod('mute' + min, mm);   // старый сервер — без причины
        return res(r, `⏳ ${nick} заглушён: ${(DUR.find(x => x[0] === min) || [0, min + ' мин'])[1]}`);
      }
      if (k === 'delr' && m) {
        const a = await askReason('🗑 Удалить сообщение', { t: '🗑 Удалить' });
        if (!a) return { ok: false };
        const r = await P.rpc(off ? 'chat_mod_delete' : 'cm_mod_delete', { p_id: m.id, p_reason: a.reason });
        if (r.missing) { const d = await A0.del(m); return { ok: !!d?.ok, msg: d?.ok ? '🗑 Удалено' : '⚠️ ' + (d?.err || 'не получилось'), removed: !!d?.ok }; }
        return res(r, '🗑 Удалено', { removed: true });
      }
      if (k === 'purge') {
        const a = await askReason(`🧹 Удалить последние сообщения ${who} в #${e(ch?.name || '')}`, { t: '🧹 Удалить' }, picks([[10, '10'], [25, '25'], [50, '50'], [100, '100']], 25));
        if (!a) return { ok: false };
        const n = +(a.pick[0] || 25);
        const r = await P.rpc(off ? 'chat_purge' : 'cm_purge', off ? { p_channel: ch.id, p_user: uid || null, p_nick: nick || '', p_n: n, p_reason: a.reason }
          : { p_channel: ch.id, p_user: uid, p_n: n, p_reason: a.reason });
        return res(r, `🧹 Удалено сообщений: ${r.data?.n ?? 0}`, { removed: !!m });
      }
      if (k === 'kick' && !off) {
        const a = await askReason(`👢 Выгнать ${who}?`, { t: '👢 Выгнать' }, '<p class="ds-dim">Сможет вернуться по ссылке или из обзора.</p>');
        if (!a) return { ok: false };
        const r = await P.rpc(fn, args(uid, nick, 'kick', 0, a.reason));
        return r.missing ? A0.mod('kick', mm) : res(r, `👢 ${nick} выгнан`);
      }
      if (k === 'ban') {
        if (off) return A0.mod('ban', mm);
        const a = await askReason(`⛔ Забанить ${who}`, { t: '⛔ Забанить' }, picks([[0, 'навсегда'], [1440, '1 день'], [10080, 'неделя'], [43200, '30 дней']], 0)
          + '<label class="ds-chk"><input type="checkbox" data-f="purge"> 🧹 удалить его сообщения за сутки</label>');
        if (!a) return { ok: false };
        const r = await P.rpc(fn, args(uid, nick, 'ban', +(a.pick[0] || 0), a.reason, a.purge));
        return r.missing ? A0.mod(a.purge ? 'banpurge' : 'ban', mm) : res(r, `⛔ ${nick} забанен`);
      }
      return A0.mod ? A0.mod(k, mm) : { ok: false };
    }
    A.modActions = m => list(m, false);
    A.userMod = (uid, nick) => list({ uid, nick: nick || '' }, true);
    A.mod = (k, m) => act(k, m.uid, m.nick, m);
    A.userModDo = (k, uid, nick) => act(k, uid, nick, null);
    // общий чат: автомодерация остановила (сервер объяснил по-русски) — сервер сам проверит ещё раз и запишет в журнал
    if (off) A.send = async (text, reply) => {
      const r = await A0.send(text, reply);
      if (!r?.ok && /Автомодерация/.test(r?.err || '')) P.rpc('chat_automod_note', { p_channel: ch.id, p_text: text, p_nick: (typeof chatNick !== 'undefined' && chatNick) || '' });
      return r;
    };
    return A;
  };

  // ═══ 📁 «Каналы и категории»: порядок, категории, настройки канала ═══
  X.sub.channels = {
    title: '📁 Каналы',
    async render(el, mode, srv, rest){
      el.innerHTML = '<div class="ds-pane"><div class="ds-dim">Загружаем каналы…</div></div>';
      const off = !!srv.official;
      if (off) await window.D37Chat?.refreshInfo?.(true);
      const S = await DS.server(off ? DS.OFF_ID : srv.id, true);
      if (!el.isConnected || !S?.ok) return;
      const v4 = off ? Array.isArray(window.D37Chat?.info?.()?.cats) : Array.isArray(S.raw?.cats);
      const can = off ? ['admin', 'moderator'].includes(S.staff) : !!S.raw?.manage;
      if (!v4) { el.innerHTML = `<div class="ds-pane"><h3>📁 Каналы и категории</h3>${SOON}${off ? '' : `<p><a class="ds-btn ghost" href="${DS.link(mode, srv.id, 'settings')}">⚙️ Каналы — в настройках</a></p>`}</div>`; return; }
      if (!can) { el.innerHTML = '<div class="ds-pane"><h3>📁 Каналы и категории</h3><p class="ds-dim">Каналы настраивают владелец, модераторы и роли с правом «📁 Каналы».</p></div>'; return; }
      const admin = off && S.staff === 'admin', R = off ? null : await X.roleData?.(srv.id);
      const cats = (S.cats || []).slice().sort((a, b) => a.pos - b.pos || a.id - b.id);
      const chans = (S.channels || []).filter(c => !c.soon && c.kind !== 'twitch').map(c => ({ ...c }));
      const has = id => cats.some(k => k.id === id);
      const arch = chans.filter(c => c.archived);
      // порядок — один список: каналы без категории, потом категории со своими каналами; категория канала — ближайшая выше
      let items = [...chans.filter(c => !c.archived && !has(c.cat)).map(c => ({ t: 'ch', c })),
        ...cats.flatMap(k => [{ t: 'cat', k }, ...chans.filter(c => !c.archived && c.cat === k.id).map(c => ({ t: 'ch', c }))])];
      let open = rest?.[0] || '';
      const touch = !!P.touch?.();
      const SLOW = [0, 5, 30, 60, 300];
      const setHtml = c => {
        const sl = SLOW.includes(c.slow || 0) ? SLOW : SLOW.concat(c.slow).sort((a, b) => a - b);
        const who = c.mods_only ? (c.write_role ? 'r' + c.write_role : 'mods') : 'all';
        const canDel = off ? admin && !['general', 'news', 'voice'].includes(c.id) : true;
        const canArch = off ? c.kind === 'text' && !['general', 'news'].includes(c.id) : true;
        return `<div class="ds4-set" data-set="${e(c.id)}">
          <label class="ds-lbl">Название<input class="ds-in" data-s="name" maxlength="32" value="${e(c.name)}"></label>
          <label class="ds-lbl">Тема — видна под названием канала<input class="ds-in" data-s="about" maxlength="200" value="${e(c.about || '')}" placeholder="О чём этот канал"></label>
          ${c.kind === 'text' ? `<label class="ds-lbl">Медленный режим<select class="ds-in" data-s="slow">${sl.map(s => `<option value="${s}"${(c.slow || 0) === s ? ' selected' : ''}>${s ? '🐢 раз в ' + (s >= 60 ? s / 60 + ' мин' : s + ' с') : 'без задержки'}</option>`).join('')}</select></label>
          <label class="ds-lbl">Кто пишет<select class="ds-in" data-s="who"><option value="all"${who === 'all' ? ' selected' : ''}>Все участники</option><option value="mods"${who === 'mods' ? ' selected' : ''}>📢 Только ${off ? 'команда сайта' : 'владелец и модераторы'}</option>${(R?.roles || []).map(x => `<option value="r${e(x.id)}"${who === 'r' + x.id ? ' selected' : ''}>📢 Модераторы и роль «${e(x.name)}»</option>`).join('')}</select></label>` : ''}
          <div class="ds-row ds4-acts"><button type="button" class="ds-btn" data-a="save">💾 Сохранить</button>${canArch ? `<button type="button" class="ds-btn ghost" data-a="arch">${c.archived ? '🗄 Вернуть из архива' : '🗄 В архив'}</button>` : ''}${canDel ? '<button type="button" class="ds-btn bad" data-a="del">🗑 Удалить</button>' : ''}</div>
          <p class="ds-dim">🗄 Архив — канал спрятан от участников, история сохраняется.</p></div>`;
      };
      const btn = (a, t, l) => `<button type="button" class="ds-hb" data-a="${a}" title="${l}" aria-label="${l}">${t}</button>`;
      const chRow = (c, i) => `<div class="ds4-row${c.archived ? ' arch' : ''}" data-i="${i}" data-ch="${e(c.id)}" draggable="${!touch && i >= 0}">${touch ? '' : '<span class="ds4-h" aria-hidden="true">⠿</span>'}<span>${c.kind === 'voice' ? '🔊' : '#'} ${e(c.name)}${c.slow ? ' 🐢' : ''}${c.mods_only ? ' 📢' : ''}</span>
        ${i >= 0 ? btn('up', '↑', 'Выше') + btn('down', '↓', 'Ниже') : ''}${btn('set', '⚙️', 'Настройки канала')}</div>${String(open) === String(c.id) ? setHtml(c) : ''}`;
      const catRow = (k, i) => `<div class="ds4-row cat" data-i="${i}" draggable="${!touch}">${touch ? '' : '<span class="ds4-h" aria-hidden="true">⠿</span>'}<span>📁 ${e(k.name)}</span>
        ${btn('up', '↑', 'Категорию выше')}${btn('down', '↓', 'Категорию ниже')}${btn('cren', '✏️', 'Переименовать')}${btn('cdel', '🗑', 'Удалить категорию')}</div>`;
      const err = t => { const x = el.querySelector('.ds-err'); if (x) { x.hidden = !t; x.textContent = t ? '⚠️ ' + t : ''; } };
      const draw = () => {
        el.innerHTML = `<div class="ds-pane"><h3>📁 Каналы и категории ${off ? 'сервера «Денчик37»' : '«' + e(S.name) + '»'}</h3>
          <p class="ds-dim">${touch ? '↑ ↓ — порядок (через край категории — в соседнюю)' : 'Перетаскивай за ⠿ (на категорию — внутрь неё) или ↑ ↓'}; ⚙️ — название, тема, 🐢, кто пишет, архив.</p>
          <div class="ds4-tree">${items.map((it, i) => (it.t === 'cat' ? catRow(it.k, i) : chRow(it.c, i))).join('')}
            ${arch.length ? `<div class="ds4-row cat arch"><span>🗄 Архив — ${arch.length}</span></div>${arch.map(c => chRow(c, -1)).join('')}` : ''}</div>
          <div class="ds-row"><input class="ds-in" data-f="newcat" maxlength="32" placeholder="Новая категория" aria-label="Новая категория"><button type="button" class="ds-btn ghost" data-a="cadd">＋ Категория</button></div>
          <div class="ds-row"><input class="ds-in" data-f="newch" maxlength="32" placeholder="Новый канал" aria-label="Новый канал">${off ? '' : '<select class="ds-in ds-sm" data-f="newkind" aria-label="Тип канала"><option value="text"># текст</option><option value="voice">🔊 голос</option></select>'}<button type="button" class="ds-btn ghost" data-a="chadd">＋ Канал</button></div>
          <div class="ds-err" hidden></div></div>`;
        if (open) el.querySelector(`[data-set]`)?.scrollIntoView?.({ block: 'nearest' });
      };
      const block = i => { let j = i + 1; while (j < items.length && items[j].t === 'ch') j++; return [i, j]; };
      const move = (i, d) => {
        if (items[i].t === 'ch') { const j = i + d; if (j < 0 || j >= items.length) return false; [items[i], items[j]] = [items[j], items[i]]; return true; }
        const [a, b] = block(i);
        if (d < 0) {
          let p = a - 1; if (p < 0) return false;
          while (p > 0 && items[p].t === 'ch') p--;
          if (items[p].t !== 'cat') return false;   // выше — только каналы без категории
          const blk = items.splice(a, b - a); items.splice(p, 0, ...blk); return true;
        }
        if (b >= items.length) return false;
        const nb = block(b)[1], blk = items.splice(a, b - a); items.splice(nb - blk.length, 0, ...blk); return true;
      };
      const dropOn = (di, ti) => {
        if (di === ti || di < 0 || ti < 0) return false;
        const it = items[di], tg = items[ti];
        if (it.t === 'ch') { items.splice(di, 1); let t = ti > di ? ti - 1 : ti; if (tg.t === 'cat') t++; items.splice(t, 0, it); return true; }
        if (tg.t !== 'cat') return false;
        const [a, b] = block(di); if (ti > a && ti < b) return false;
        const blk = items.splice(a, b - a); items.splice(ti > a ? ti - blk.length : ti, 0, ...blk); return true;
      };
      const after = () => { if (off) window.D37Chat?.refreshInfo?.(true); else DS.dropC(srv.id); DS.refreshSide?.(); window.dispatchEvent(new Event('d37:events')); };
      const saveLayout = async () => {
        let cur = null; items.forEach(it => { if (it.t === 'cat') cur = it.k.id; else it.c.cat = cur; });
        const chs = items.filter(it => it.t === 'ch').map(it => it.c).concat(arch);
        const r = await P.rpc('cm_layout', { p_community: off ? null : srv.id, p_cats: items.filter(it => it.t === 'cat').map((it, i) => ({ id: it.k.id, pos: i })),
          p_chans: chs.map((c, i) => ({ id: String(c.id), pos: i, cat: c.cat ?? null })) });
        if (!r.data?.ok) { err(why4(r)); return; }
        after();
      };
      const again = o => X.sub.channels.render(el, mode, srv, o ? [o] : []);
      el.onclick = async ev => {
        const b = ev.target.closest('[data-a]'); if (!b || !el.contains(b)) return;
        const a = b.dataset.a, i = +(b.closest('[data-i]')?.dataset.i ?? -1);
        const id = b.closest('[data-ch]')?.dataset.ch ?? b.closest('[data-set]')?.dataset.set;
        const c = id != null ? chans.find(x => String(x.id) === String(id)) : null;
        if ((a === 'up' || a === 'down') && i >= 0) { if (move(i, a === 'up' ? -1 : 1)) { draw(); saveLayout(); } return; }
        if (a === 'set' && c) { open = String(open) === String(c.id) ? '' : c.id; draw(); return; }
        if ((a === 'save' || a === 'arch') && c) {
          const box = b.closest('[data-set]'), q = s => box?.querySelector(`[data-s="${s}"]`);
          const who = q('who')?.value || (c.mods_only ? 'mods' : 'all');
          const r = await P.rpc('cm_chan_set', { p_community: off ? null : srv.id, p_id: String(c.id), p_name: q('name')?.value ?? c.name, p_about: q('about')?.value ?? c.about ?? '',
            p_slow: q('slow') ? +q('slow').value : c.slow || 0, p_mods_only: who !== 'all', p_write_role: who.startsWith('r') ? +who.slice(1) : null,
            p_archived: a === 'arch' ? !c.archived : !!c.archived });
          if (!r.data?.ok) { err(why4(r)); return; }
          toast(a === 'arch' ? (c.archived ? '🗄 Канал вернулся из архива' : '🗄 Канал в архиве — история сохранена') : '✅ Сохранено', true);
          after(); return again(a === 'arch' ? '' : c.id);
        }
        if (a === 'del' && c) {
          if (await sheet(`🗑 Удалить канал <b>#${e(c.name)}</b>?`, '<p class="ds-dim">Все сообщения канала пропадут навсегда. Если историю жалко — лучше 🗄 в архив.</p><button type="button" class="ds4-wide bad" data-v="yes">🗑 Удалить навсегда</button>') !== 'yes') return;
          const r = await P.rpc(off ? 'chat_chan_delete' : 'cm_channel_delete', { p_id: off ? String(c.id) : +c.id });
          if (!r.data?.ok) { err(why4(r)); return; }
          toast('🗑 Канал удалён', true); after(); return again();
        }
        if (a === 'cadd' || a === 'chadd') {
          const n = el.querySelector(`[data-f="${a === 'cadd' ? 'newcat' : 'newch'}"]`).value.trim(); if (!n) return;
          const r = a === 'cadd' ? await P.rpc('cm_cat_save', { p_community: off ? null : srv.id, p_id: null, p_name: n })
            : off ? await P.rpc('chat_chan_add', { p_name: n })
            : await P.rpc('cm_channel_save', { p_community: srv.id, p_id: null, p_name: n, p_kind: el.querySelector('[data-f="newkind"]').value, p_slow: 0, p_mods_only: false });
          if (!r.data?.ok) { err(why4(r)); return; }
          if (a === 'chadd') toast('＋ Канал создан — перетащи его в нужную категорию', true);
          after(); return again(a === 'chadd' ? r.data.id : '');
        }
        if ((a === 'cren' || a === 'cdel') && items[i]?.t === 'cat') {
          const k = items[i].k;
          let r;
          if (a === 'cren') {
            const v = await sheet('✏️ Название категории', `<input class="ds-in" data-f="reason" maxlength="32" value="${e(k.name)}" aria-label="Название категории"><button type="button" class="ds4-wide ds4-go" data-v="go">💾 Сохранить</button>`, w => w.querySelector('[data-f="reason"]').value.trim());
            if (!v) return;
            r = await P.rpc('cm_cat_save', { p_community: off ? null : srv.id, p_id: k.id, p_name: v });
          } else {
            if (await sheet(`🗑 Удалить категорию <b>${e(k.name)}</b>?`, '<p class="ds-dim">Каналы останутся — просто без категории.</p><button type="button" class="ds4-wide bad" data-v="yes">🗑 Удалить категорию</button>') !== 'yes') return;
            r = await P.rpc('cm_cat_delete', { p_id: k.id });
          }
          if (!r.data?.ok) { err(why4(r)); return; }
          after(); return again();
        }
      };
      // перетаскивание (компьютер): канал — перед целью или внутрь категории, категория — со всеми своими каналами
      let dragI = -1;
      el.ondragstart = ev => { const r = ev.target.closest?.('[data-i]'); if (!r || +r.dataset.i < 0) return; dragI = +r.dataset.i; r.classList.add('drag'); try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(dragI)); } catch (er) {} };
      el.ondragover = ev => { const r = ev.target.closest?.('[data-i]'); if (dragI < 0 || !r || +r.dataset.i < 0) return; ev.preventDefault(); el.querySelectorAll('.ds4-row.over').forEach(x => x.classList.remove('over')); r.classList.add('over'); };
      el.ondragend = () => { dragI = -1; el.querySelectorAll('.ds4-row.drag,.ds4-row.over').forEach(x => x.classList.remove('drag', 'over')); };
      el.ondrop = ev => { const r = ev.target.closest?.('[data-i]'); if (dragI < 0 || !r) return; ev.preventDefault(); const done = dropOn(dragI, +r.dataset.i); dragI = -1; draw(); if (done) saveLayout(); };
      draw();
    },
  };

  // ═══ 🛡 «Модерация»: 🚩 жалобы (быстрые действия) · 📜 журнал · 🤖 автомодерация · 🏰 все сообщества (команда сайта) ═══
  const ACT = { delete: '🗑 удалил(а) сообщение', purge: '🧹 удалил(а) сообщения', mute: '⏳ дал(а) тайм-аут', unmute: '🔊 снял(а) тайм-аут', kick: '👢 выгнал(а)',
    ban: '⛔ забанил(а)', unban: '✅ разбанил(а)', warn: '⚠️ предупредил(а)', automod: 'остановила сообщение от', cat_add: '📁 создал(а) категорию', cat_delete: '📁 удалил(а) категорию',
    chan_add: '＋ создал(а) канал', chan_edit: '⚙️ изменил(а) канал', chan_archive: '🗄 убрал(а) в архив канал', chan_unarchive: '🗄 вернул(а) из архива канал',
    chan_delete: '🗑 удалил(а) канал', automod_cfg: '🤖 изменил(а) автомодерацию' };
  const AMR = [['bad', '🤬 Мат', 'сообщения с матом не уходят'], ['flood', '🌊 Флуд', '4 сообщения за 6 секунд'], ['caps', '🔠 КАПС', '70 % заглавных (от 12 букв)'],
    ['repeat', '🔁 Повтор', 'то же самое в течение 2 минут'], ['mentions', '📣 Массовые @', '5 и больше @упоминаний в сообщении'], ['links', '🔗 Ссылки новичков', '']];
  const amName = k => (AMR.find(x => x[0] === k) || [k, k])[1];
  X.sub.reports = {
    title: '🛡 Модерация',
    async render(el, mode, srv, rest){
      const site = typeof currentRole !== 'undefined' && ['admin', 'moderator'].includes(currentRole);
      const tab = ['log', 'automod', 'all'].includes(rest?.[0]) && (rest[0] !== 'all' || (srv.official && site)) ? rest[0] : 'rep';
      const tabs = [['rep', '🚩 Жалобы'], ['log', '📜 Журнал'], ['automod', '🤖 Автомод']].concat(srv.official && site ? [['all', '🏰 Сообщества']] : []);
      el.innerHTML = `<div class="ds-pane"><div class="ds4-tabs">${tabs.map(([k, t]) => `<a class="${k === tab ? 'on' : ''}" href="${DS.link(mode, srv.id, 'reports' + (k === 'rep' ? '' : '/' + k))}">${t}</a>`).join('')}</div><div class="ds4-tab"><div class="ds-dim">Загружаем…</div></div></div>`;
      const box = el.querySelector('.ds4-tab');
      if (tab === 'log') return logTab(box, srv);
      if (tab === 'automod') return amTab(box, srv);
      return repTab(box, srv, tab === 'all', mode);
    },
  };
  async function repTab(box, srv, all, mode){
    const official = srv.official && !all;
    const list = official ? await window.D37Chat.reports() : (await P.rpc('cm_reports', { p_community: all ? null : srv.id })).data;
    if (!box.isConnected) return;
    if (!list) { box.innerHTML = '<p class="ds-dim">Жалобы видят модераторы</p>'; return; }
    box.innerHTML = `<h3>🚩 Жалобы — ${list.length}</h3>${list.length ? list.map(r => `<div class="ds-rep" data-mid="${e(official ? r.mid : r.id)}" data-uid="${e(r.target || '')}" data-nick="${e(r.author || '')}" data-cid="${e(r.cid || '')}">
      <div><b>${e(r.author || '—')}</b> <small>${r.n} ${P.plural(r.n, 'жалоба', 'жалобы', 'жалоб')}${r.hidden ? ' · скрыто' : ''}${official ? ' · #' + e(r.channel) : ''}${all ? ' · ' + e(r.cname || '') : ''}${r.reasons ? ' · ' + e(r.reasons) : ''}${P.ago && r.at ? ' · ' + e(P.ago(r.at)) : ''}</small></div>
      <p>${e(P.clean(r.text || (r.mid === null ? '(жалоба на сообщество)' : '(удалено)')))}</p>
      <div class="ds-row ds4-acts"><button type="button" class="ds-btn ghost ds-sm" data-rep="${official ? 'restore' : 'dismiss'}">✅ Оставить</button><button type="button" class="ds-btn bad ds-sm" data-rep="delete">🗑 Удалить</button>${r.target ? '<button type="button" class="ds-btn ghost ds-sm" data-rq="warn">⚠️ Предупредить</button><button type="button" class="ds-btn ghost ds-sm" data-rq="mute">⏳ Тайм-аут на час</button>' : ''}${all && r.cid ? `<a class="ds-btn ghost ds-sm" href="${DS.link(mode, r.cid)}">Открыть</a>` : ''}</div></div>`).join('') : '<div class="ds-dim">Жалоб нет 🎉</div>'}`;
    box.onclick = async ev => {
      const b = ev.target.closest('[data-rep],[data-rq]'); if (!b) return;
      const it = b.closest('[data-mid]'), id = +it.dataset.mid;
      if (b.dataset.rep) {
        const r = official ? await window.D37Chat.resolve(id, b.dataset.rep) : (await P.rpc('cm_report_resolve', { p_report: id, p_action: b.dataset.rep })).data;
        if (r?.ok) it.remove(); else toast('⚠️ ' + (r?.err || R4[r?.reason] || 'не получилось'));
        return;
      }
      const uid = it.dataset.uid, nick = it.dataset.nick, warn = b.dataset.rq === 'warn';
      const a = warn ? await askReason(`⚠️ Предупредить <b>${e(nick)}</b>`, { t: '⚠️ Предупредить', cls: '' }, '', true) : { reason: '🚩 по жалобе' };
      if (!a) return;
      const r = official ? await P.rpc('chat_mod', { p_user: uid, p_nick: nick, p_action: b.dataset.rq, p_minutes: 60, p_reason: a.reason || '🚩 по жалобе' })
        : await P.rpc('cm_mod', { p_community: all ? +it.dataset.cid : srv.id, p_user: uid, p_action: b.dataset.rq, p_minutes: 60, p_reason: a.reason || '🚩 по жалобе', p_purge: false });
      toast(r.data?.ok ? (warn ? '⚠️ Предупреждение отправлено' : '⏳ Тайм-аут на час') : '⚠️ ' + why4(r), !!r.data?.ok);
    };
  }
  async function logTab(box, srv){
    const L = []; let before = null;
    const chn = id => { const c = (srv.channels || []).find(x => String(x.id) === String(id)); return c ? ' в #' + e(c.name) : ''; };
    const load = async () => {
      const r = await P.rpc('cm_modlog', { p_community: srv.official ? null : srv.id, p_before: before });
      if (!box.isConnected) return;
      if (r.missing) { box.innerHTML = '<h3>📜 Журнал модерации</h3>' + SOON; return; }
      if (!r.data?.ok) { box.innerHTML = `<h3>📜 Журнал модерации</h3><p class="ds-dim">${r.data?.reason === 'rights' ? 'Журнал видят ' + (srv.official ? 'админ и модераторы сайта' : 'владелец и модераторы сообщества') : '⚠️ ' + e(why4(r))}</p>`; return; }
      const add = r.data.list || []; L.push(...add); if (add.length) before = add[add.length - 1].id;
      box.innerHTML = `<h3>📜 Журнал модерации</h3><p class="ds-dim">Кто, что, кому и почему. Видят ${srv.official ? 'админ и модераторы сайта' : 'владелец и модераторы'}.</p>
        <div class="ds4-log">${L.map(x => `<div class="ds4-li"><small>${e(new Date(x.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</small><div>${x.action === 'automod' ? '<b>🤖 Автомодерация</b>' : `<b>${e(x.actor_nick || '—')}</b>`} ${e(ACT[x.action] || x.action)}${x.target_nick ? ` <b>${e(x.target_nick)}</b>` : ''}${['automod', 'delete', 'purge'].includes(x.action) ? chn(x.channel) : ''}${x.action === 'automod' ? ' · ' + e(amName(x.reason)) : x.reason ? ` · <i>«${e(x.reason)}»</i>` : ''}${x.detail ? ` <span class="ds-dim">· ${e(P.clean(x.detail))}</span>` : ''}</div></div>`).join('')
          || '<div class="ds-dim">Пока пусто — здесь появятся удаления, тайм-ауты, баны, предупреждения и работа автомодерации.</div>'}</div>
        ${add.length === 50 ? '<div class="ds-row"><button type="button" class="ds-btn ghost" data-a="more">Показать раньше</button></div>' : ''}`;
    };
    box.onclick = ev => { if (ev.target.closest('[data-a="more"]')) load(); };
    await load();
  }
  async function amTab(box, srv){
    const r = await P.rpc('cm_automod_get', { p_community: srv.official ? null : srv.id });
    if (!box.isConnected) return;
    if (r.missing) { box.innerHTML = '<h3>🤖 Автомодерация</h3>' + SOON; return; }
    if (!r.data?.ok) { box.innerHTML = `<p class="ds-dim">⚠️ ${e(why4(r))}</p>`; return; }
    const cfg = r.data.cfg || {}, can = !!r.data.can, dis = can ? '' : ' disabled';
    const lnk = srv.official ? 'аккаунту меньше 3 дней и гостям' : 'кто в сообществе меньше суток';
    box.innerHTML = `<h3>🤖 Автомодерация</h3><p class="ds-dim">Сервер сам не пропускает нарушение, объясняет человеку, что не так, и пишет в 📜 журнал. ${srv.official ? 'Команду сайта' : 'Владельца и модераторов'} не трогает.</p>
      <label class="ds-chk ds4-am"><input type="checkbox" data-am="on"${cfg.off ? '' : ' checked'}${dis}> <b>Автомодерация включена</b></label>
      ${AMR.map(([k, t, d]) => `<label class="ds-chk ds4-am"><input type="checkbox" data-am="${k}"${cfg[k] === false ? '' : ' checked'}${dis}> ${t} <small class="ds-dim">— ${k === 'links' ? 'ссылки нельзя тем, ' + lnk : d}</small></label>`).join('')}
      ${can ? '<div class="ds-row"><button type="button" class="ds-btn" data-a="amsave">💾 Сохранить</button></div>' : '<p class="ds-dim">Менять могут модераторы.</p>'}`;
    box.onclick = async ev => {
      if (!ev.target.closest('[data-a="amsave"]')) return;
      const c = {};
      box.querySelectorAll('[data-am]').forEach(x => { if (x.dataset.am === 'on') { if (!x.checked) c.off = true; } else if (!x.checked) c[x.dataset.am] = false; });
      const r2 = await P.rpc('cm_automod_set', { p_community: srv.official ? null : srv.id, p_cfg: c });
      toast(r2.data?.ok ? '✅ Автомодерация сохранена' : '⚠️ ' + why4(r2), !!r2.data?.ok);
    };
  }

  // ═══ Ссылки в настройках: сервер сайта (⚙️) и сообщество ═══
  X.officialMore = (srv, mode) => `<div class="ds-row ds4-links"><a class="ds-btn ghost" href="${DS.link(mode, DS.OFF_ID, 'channels')}">📁 Каналы и категории</a><a class="ds-btn ghost" href="${DS.link(mode, DS.OFF_ID, 'reports')}">🛡 Модерация и журнал</a></div>`;
  const more0 = X.settingsMore;
  X.settingsMore = (srv, mode) => `<div class="ds-sect"><b>📁 Каналы · 🛡 Модерация</b><p class="ds-dim">Категории и порядок каналов, тема, архив, кто пишет; жалобы, 📜 журнал и 🤖 автомодерация.</p>
    <div class="ds-row ds4-links"><a class="ds-btn ghost" href="${DS.link(mode, srv.id, 'channels')}">📁 Каналы и категории →</a><a class="ds-btn ghost" href="${DS.link(mode, srv.id, 'reports')}">🛡 Модерация →</a></div></div>` + (more0 ? more0(srv, mode) : '');

  // ═══ Кнопки data-ds4 (в шапке, списке каналов, телефоне): свернуть категорию, 🔔, ⚙ канала ═══
  document.addEventListener('click', ev => {
    const b = ev.target?.closest?.('[data-ds4]'); if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    const k = b.dataset.ds4, cur = DS.cur?.();
    if (k === 'fold') toggleFold(b.dataset.s, b.dataset.k);
    else if (k === 'notif') {
      const sid = b.dataset.srv || (cur?.srv ? skey(cur.srv) : 'o');
      notifSheet(sid, b.dataset.ch || (cur?.srv && skey(cur.srv) === sid && cur.ch?.kind === 'text' ? cur.ch.id : ''));
    } else if (k === 'chset') DS.go(b.dataset.mode || 'page', DS.link(b.dataset.mode || 'page', b.dataset.srv === 'o' ? DS.OFF_ID : +b.dataset.srv, 'channels/' + b.dataset.ch));
  }, true);
})();
