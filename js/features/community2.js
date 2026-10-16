// ═══════════════════════════════════════
//  СООБЩЕСТВА 2 (community2.sql) — поверх community.js (D37DS) и ленты msgview.js:
//  📅 события (как Discord Events): список «📅 События» над каналами, создать / изменить / отменить, «✅ Пойду», «🔴 Сейчас идёт»,
//  страница события #/chat/ev/<id> (карточка в ленте — msgview.js MV.evCardHtml). «Денчик-бот» и «📢 новости» — api/push-check.js.
//  🧭 обзор сообществ (#/chat/find): поиск, категории, «большие / активные / новые», метка возраста, «Вступить»;
//  категория и метка — при создании и в настройках сообщества (владелец).
//  community3.sql: 🎭 свои роли (#/chat/c/<id>/roles — цвет, место, права, кому выдать; цвет ника и группы участников — community.js).
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
    // нет community2.sql — сами не спрашиваем 10 минут (каждый запрос — лишняя 404 в консоли); открыл экран — спросим
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

  // ═══ 🧭 Обзор сообществ (cm_catalog). Без community2.sql — старый поиск по названию (cm_list_public) ═══
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

  // ═══ 🎭 Свои роли (community3.sql): цвет ника, место, права; выдаёт владелец ═══
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

  // ═══ 🚀 Буст (community3.sql): 30 дней — 100 💎 / 90 — 270 💎, сроки складываются, можно в подарок; оформление — владелец ═══
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
