// ═══════════════════════════════════════
//  🛡 ЦЕНТР МОДЕРАЦИИ (T-164 ds-mod, владелец 13.11: «нет одной какой-то общей категории для модераторов… я пожаловался сам на себя
//  ещё… На создателя разве можно жаловаться?»). Одно место для команды — сервер «Денчик37» и сообщества одинаково:
//  слева меню — 📊 Обзор (жалобы, последние действия, рейд / автомод) · 🚩 Жалобы (статусы: новая / в работе / готово / отклонено,
//  кто взял, снимок переписки, быстрые действия) · 👥 Участники (поиск, тайм-аут / кик / бан с причиной и сроком, заметки команды) ·
//  📁 Каналы и категории · 🎭 Роли и права · 🤖 Автомод (+ запрещённые слова, 🐢 новичкам, 🛡 режим рейда) · 📜 Журнал (фильтры) ·
//  📎 Файлы · 🔗 Приглашения · ⚙️ Настройки сервера. Телефон и узкий экран — лист на весь экран.
//  Адреса: #/chat[/c/<id>]/reports[/<раздел>] (старые …/reports, …/reports/log|automod|all|files и ⚙️ …/settings открывают центр).
//  Права решает сервер (community.sql ч. 11: mod_* функции); здесь — только показ. Нет ч. 11 на сервере — старые экраны внутри центра.
//  Жалобы: на себя и на создателя сайта кнопки нет (сервер всё равно отказывает: 'self' / 'creator'), жалоба на команду — только создателю.
//  Грузится после community2.js (phone.js MODS.ds). Откат одной строкой: MOD_HUB = false — всё как раньше.
// ═══════════════════════════════════════
(() => {
  const MOD_HUB = true;
  const P = window.D37Phone, MV = window.MsgView, DS = window.D37DS;
  if (!MOD_HUB || !P || !MV || !DS || !DS.x || window.D37Mod) return;
  const X = DS.x;
  const OLD = { reports: X.sub.reports, settings: X.sub.settings };   // старые экраны — запасной путь, пока ч. 11 не выполнена
  const e = s => esc(s);
  const toast = (t, good) => (P.toast ? P.toast(t, good) : alert(t));
  const clean = s => (P.clean ? P.clean(s || '') : String(s || ''));
  const ago = at => (at ? (P.ago ? P.ago(at) : new Date(at).toLocaleString('ru-RU')) : '');
  const dt = at => new Date(at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const plural = (n, a, b, c) => (P.plural ? P.plural(n, a, b, c) : c);
  const SOON = '<div class="ds-soon">🛠️ Появится, когда сайт обновится.</div>';

  // стили центра — отдельный файл (css/ds-mod.css), чтобы не мешать соседним правкам ds.css
  if (!document.querySelector('link[data-dsmod]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/ds-mod.css?v=1'; l.dataset.dsmod = '1'; document.head.appendChild(l);
  }

  // ═══ Кто создатель сайта (role = 'admin' в profiles_public): на него — без «🚩 Пожаловаться» ═══
  const ADMINS = new Set();
  (async () => {
    try { if (typeof sbProfiles !== 'function') return; const { data } = await sbProfiles().select('id').eq('role', 'admin').limit(5); (data || []).forEach(x => ADMINS.add(x.id)); } catch (er) {}
  })();
  // msgview.js и minicard: true — кнопку жалобы не показывать (своё сообщение, создатель сайта)
  MV.noReport = m => !!m && ((m.uid && m.uid === P.me()) || m.role === 'admin' || (m.uid && ADMINS.has(m.uid)));
  const RSN = { creator: 'на создателя сайта жаловаться нельзя', self: 'на себя жаловаться нельзя', closed: 'жалобу уже закрыли', state: 'неверный статус',
    rights: 'нет прав', staff: 'только админ и модераторы сайта', not_found: 'не найдено', bad: 'без мата, пожалуйста', len: 'заметка — до 500 символов',
    rate: 'слишком часто — попробуй позже', slow: 'неверная задержка', minutes: 'такой срок нельзя', guest: 'у гостя нет уведомлений — только тайм-аут',
    member: 'его уже нет в сообществе', action: 'неизвестное действие', auth: 'нужно войти', scope: 'неверный раздел', data: 'неверные данные' };
  if (DS._test?.REASON) Object.assign(DS._test.REASON, { creator: RSN.creator });   // ответы сервера в ленте сообществ (community.js)
  const why = r => (r?.missing ? 'появится, когда сайт обновится' : r?.error ? P.err(r.error) : RSN[r?.data?.reason] || (DS.why ? DS.why(r) : 'не получилось'));

  // ═══ Права (показ): сайт — admin / moderator / helper; сообщество — владелец, модераторы, роль с правом «модерация» (бит 2) ═══
  const siteRole = () => window.D37Chat?.info?.()?.staff || (typeof currentRole !== 'undefined' && ['admin', 'moderator', 'helper'].includes(currentRole) ? currentRole : null);
  function rights(srv){
    const sr = siteRole();
    if (srv.official) {
      const r = srv.staff || sr, m = r === 'admin' || r === 'moderator';
      return { team: !!r, mod: m, owner: r === 'admin', chans: m, settings: m, log: m, roles: m, invites: true };
    }
    const bits = X.roleSync?.(srv.id)?.my || 0, own = srv.role === 'owner' || !!srv.staff, mod = own || srv.role === 'mod' || !!(bits & 2);
    return { team: mod, mod, owner: sr === 'admin', chans: own || srv.role === 'mod' || !!(bits & 1), settings: own || srv.role === 'mod' || !!(bits & 3), log: mod, roles: own, invites: !!srv.role };
  }
  const SECT = [
    ['overview', '📊', 'Обзор', R => R.team], ['reports', '🚩', 'Жалобы', R => R.team], ['members', '👥', 'Участники', R => R.team],
    ['channels', '📁', 'Каналы и категории', R => R.chans], ['roles', '🎭', 'Роли и права', R => R.team || R.settings], ['automod', '🤖', 'Автомод', R => R.team],
    ['log', '📜', 'Журнал', R => R.log], ['files', '📎', 'Файлы', R => R.team], ['invites', '🔗', 'Приглашения', R => R.invites || R.team],
    ['settings', '⚙️', 'Настройки сервера', R => R.settings],
  ];
  const ALIAS = { rep: 'reports', all: 'reports', owner: 'reports' };   // старые вкладки и ссылки из 🔔
  const cidOf = srv => (srv.official ? null : srv.id);
  const RPC = async (fn, args) => { const r = await P.rpc(fn, args); return r; };
  const hubLink = (mode, srv, k) => DS.link(mode, srv.official ? DS.OFF_ID : srv.id, 'reports' + (k ? '/' + k : ''));
  const closeLink = (mode, srv) => DS.link(mode, srv.official ? DS.OFF_ID : srv.id);

  // ═══ Сам центр: меню слева (узко — полоска вверху), справа раздел ═══
  async function hub(el, mode, srv, rest, force){
    const R = rights(srv);
    const vis = SECT.filter(s => s[3](R));
    if (!vis.length) { el.innerHTML = '<div class="ds-pane"><div class="ds-dim">🛡 Модерация — для команды сервера</div></div>'; return; }
    let k = force || ALIAS[rest?.[0]] || rest?.[0] || 'overview';
    if (!vis.some(s => s[0] === k)) k = vis[0][0];
    const sub = force ? rest || [] : (rest || []).slice(ALIAS[rest?.[0]] ? 0 : 1);
    const narrow = mode === 'phone' || matchMedia('(max-width: 760px)').matches;
    el.innerHTML = `<div class="dm-hub${narrow ? ' dm-narrow' : ''}${narrow && mode !== 'phone' ? ' dm-sheet' : ''}" data-sect="${e(k)}">
      <div class="dm-top"><b>🛡 Модерация · ${srv.official ? 'Денчик37' : e(srv.name)}</b><a class="dm-x" href="${e(closeLink(mode, srv))}" title="Закрыть" aria-label="Закрыть">✕</a></div>
      <nav class="dm-nav" aria-label="Разделы модерации">${vis.map(([id, ic, t]) => `<a class="dm-ni${id === k ? ' on' : ''}" href="${e(hubLink(mode, srv, id))}"${id === k ? ' aria-current="page"' : ''}><i>${ic}</i><span>${t}</span>${id === 'reports' ? '<em class="dm-badge" hidden></em>' : ''}</a>`).join('')}</nav>
      <section class="dm-main"><h3 class="dm-h">${e(vis.find(s => s[0] === k)[1])} ${e(vis.find(s => s[0] === k)[2])}</h3><div class="dm-body"><div class="ds-dim">Загружаем…</div></div></section></div>`;
    el.querySelector('.dm-nav .on')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    const body = el.querySelector('.dm-body');
    badge(el, srv);
    try { await (SCREENS[k] || SCREENS.overview)(body, mode, srv, sub, R); }
    catch (er) { if (body.isConnected) body.innerHTML = `<p class="ds-dim">⚠️ Не загрузилось: ${e(er?.message || er)}</p>`; }
  }
  async function badge(el, srv){
    if (!rights(srv).team) return;
    const r = await RPC('mod_overview', { p_cid: cidOf(srv) });
    const b = el.querySelector('.dm-badge'); if (!b || !r.data?.ok) return;
    const n = (+r.data.new || 0) + (+r.data.owner || 0);
    b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n);
  }

  // старый экран внутри центра (без его вкладок)
  async function legacy(box, mode, srv, tab){
    if (!OLD.reports) { box.innerHTML = SOON; return; }
    box.innerHTML = '<div class="dm-legacy"></div>';
    await OLD.reports.render(box.firstChild, mode, srv, tab ? [tab] : []);
  }

  // ═══ 📊 Обзор ═══
  async function overview(box, mode, srv, sub, R){
    const r = await RPC('mod_overview', { p_cid: cidOf(srv) });
    if (!box.isConnected) return;
    if (r.missing) return legacy(box, mode, srv, '');
    if (!r.data?.ok) { box.innerHTML = `<p class="ds-dim">⚠️ ${e(why(r))}</p>`; return; }
    const d = r.data, raid = d.raid_until && Date.parse(d.raid_until) > Date.now();
    const tile = (n, t, href, warn) => `<a class="dm-tile${warn && n ? ' warn' : ''}" href="${e(href)}"><b>${+n || 0}</b><span>${t}</span></a>`;
    box.innerHTML = `${raid ? `<div class="dm-alert bad">🛡 <b>Защита от рейда</b> — до ${e(P.hm ? P.hm(d.raid_until) : dt(d.raid_until))}: новички и гости только читают. <button type="button" class="ds-btn ghost ds-sm" data-raid="0">Выключить</button></div>`
        : d.raid_hint ? `<div class="dm-alert">⚠️ <b>Похоже на рейд</b>: за 10 минут ${+d.joins10} новых, автомодерация сработала ${+d.automod10} раз. <button type="button" class="ds-btn bad ds-sm" data-raid="30">🛡 Защита на 30 мин</button></div>` : ''}
      <div class="dm-tiles">${tile(d.new, '🆕 новых жалоб', hubLink(mode, srv, 'reports'), true)}${tile(d.work, '🙋 в работе', hubLink(mode, srv, 'reports/work'))}${tile(d.files, '📎 жалоб на файлы', hubLink(mode, srv, 'files'), true)}
        ${d.owner != null ? tile(d.owner, '👑 жалоб на команду', hubLink(mode, srv, 'owner'), true) : ''}${tile(d.joins10, '👋 новых за 10 мин', hubLink(mode, srv, 'members'))}${tile(d.automod10, '🤖 автомод за 10 мин', hubLink(mode, srv, 'log/msg'))}${tile(d.muted, '🔇 в тайм-ауте', hubLink(mode, srv, 'members/muted'))}</div>
      ${raid ? '' : `<div class="ds-row dm-raidrow"><span class="ds-dim">🛡 Защита от рейда:</span>${[15, 60, 240].map(m => `<button type="button" class="ds-btn ghost ds-sm" data-raid="${m}">${m < 60 ? m + ' мин' : m / 60 + ' ч'}</button>`).join('')}</div>`}
      ${Array.isArray(d.log) ? `<h4>📜 Последние действия</h4><div class="ds4-log">${d.log.map(logRow).join('') || '<div class="ds-dim">Пока пусто</div>'}</div><a class="ds-btn ghost ds-sm" href="${e(hubLink(mode, srv, 'log'))}">Весь журнал →</a>` : ''}`;
    box.onclick = async ev => {
      const b = ev.target.closest('[data-raid]'); if (!b) return;
      b.disabled = true;
      const x = await RPC('mod_raid', { p_cid: cidOf(srv), p_minutes: +b.dataset.raid });
      toast(x.data?.ok ? (+b.dataset.raid ? '🛡 Защита от рейда включена' : '🛡 Защита выключена') : '⚠️ ' + why(x), !!x.data?.ok);
      overview(box, mode, srv, sub, R);
    };
  }

  // ═══ 🚩 Жалобы ═══
  const ST = { new: ['🆕', 'новая'], work: ['🙋', 'в работе'], done: ['✅', 'готово'], rejected: ['❌', 'отклонено'] };
  const STF = [['open', 'Открытые'], ['new', '🆕 Новые'], ['work', '🙋 В работе'], ['done', '✅ Готово'], ['rejected', '❌ Отклонено']];
  async function reports(box, mode, srv, sub, R, onlyFiles){
    const site = srv.official && R.mod;
    let scope = 'here', state = 'open', kind = onlyFiles ? 'file' : null;
    (sub || []).forEach(x => { if (x === 'all' && site) scope = 'all'; else if (x === 'owner' && R.owner) scope = 'owner'; else if (STF.some(s => s[0] === x)) state = x; else if (x === 'msg' && !onlyFiles) kind = 'msg'; });
    const draw = async () => {
      box.innerHTML = '<div class="ds-dim">Загружаем…</div>';
      const r = await RPC('mod_reports', { p_cid: cidOf(srv), p_scope: scope, p_state: state, p_kind: kind });
      if (!box.isConnected) return;
      if (r.missing) return legacy(box, mode, srv, onlyFiles ? 'files' : scope === 'all' ? 'all' : '');
      if (!r.data?.ok) { box.innerHTML = `<p class="ds-dim">⚠️ ${e(why(r))}</p>`; return; }
      const L = r.data.list || [];
      const chip = (v, t, on, attr) => `<button type="button" class="dm-chip${on ? ' on' : ''}" data-${attr}="${e(v)}">${t}</button>`;
      box.innerHTML = `<div class="dm-chips">${(site ? [['here', '🏠 Сервер сайта'], ['all', '🏰 Все сообщества']] : [['here', srv.official ? '🏠 Сервер сайта' : '🏠 Это сообщество']]).concat(R.owner ? [['owner', '👑 На команду']] : []).map(([v, t]) => chip(v, t, scope === v, 'sc')).join('')}</div>
        <div class="dm-chips">${STF.map(([v, t]) => chip(v, t, state === v, 'st')).join('')}${onlyFiles ? '' : chip('', 'Всё', !kind, 'kd') + chip('msg', '💬 Сообщения', kind === 'msg', 'kd') + chip('file', '📎 Файлы', kind === 'file', 'kd')}</div>
        ${scope === 'owner' ? '<p class="ds-dim">👑 Жалобы на модераторов и хелперов сайта и на команды сообществ видит только создатель сайта — тот, на кого жалуются, их не видит.</p>' : ''}
        <h4>${L.length} ${plural(L.length, 'жалоба', 'жалобы', 'жалоб')}</h4>${L.map(repRow).join('') || '<div class="ds-dim dm-empty">Жалоб нет 🎉</div>'}`;
    };
    function repRow(x){
      const s = ST[x.state] || ST.new, file = x.kind === 'file', a = x.att || {};
      const where = file ? (x.channel === 'dm' ? 'файл в ЛС' : x.channel === 'cm' ? 'файл в сообществе' : 'файл в общем чате') : x.kind === 'chat' ? '#' + (x.channel || 'общий') : '#' + (x.channel || '?');
      const ctx = Array.isArray(x.ctx) && x.ctx.length > 1 ? `<details class="dm-ctx"><summary>💬 Переписка в момент жалобы</summary>${x.ctx.map(c => `<div class="${+c.id === +x.mid ? 'dm-hit' : ''}"><b>${e(c.nick || '—')}</b> ${e(clean(c.text) || '(удалено)')}</div>`).join('')}</details>` : '';
      const open = x.state === 'new' || x.state === 'work';
      return `<div class="ds-rep dm-rep" data-k="${e(x.kind)}" data-key="${e(x.key)}" data-uid="${e(x.target || '')}" data-nick="${e(x.author || '')}" data-cid="${e(x.cid || '')}">
        <div class="dm-rh"><span class="dm-st dm-st-${e(x.state)}">${s[0]} ${s[1]}</span><b>${e(x.author || '—')}</b><small>${e(where)}${x.cname ? ' · ' + e(x.cname) : ''} · ${+x.n} ${plural(+x.n, 'жалоба', 'жалобы', 'жалоб')}${x.hidden ? ' · скрыто' : ''}${x.to_owner ? ' · 👑 на команду' : ''} · ${e(ago(x.at))}</small></div>
        ${x.reasons ? `<div class="dm-why">🚩 ${e(x.reasons)}</div>` : ''}
        ${file ? `<p>📎 <b>${e(a.name || 'файл')}</b> <span class="ds-dim">${e(a.mime || '')}${a.size ? ' · ' + e(window.D37Files?.size ? window.D37Files.size(+a.size) : a.size + ' Б') : ''}</span></p>` : `<p>${e(clean(x.text) || (x.mid == null ? '(жалоба на сообщество)' : '(удалено)'))}</p>`}
        ${ctx}${x.by_nick ? `<div class="ds-dim dm-by">${x.state === 'work' ? '🙋 Взял(а)' : 'Решил(а)'}: <b>${e(x.by_nick)}</b>${x.by_at ? ' · ' + e(ago(x.by_at)) : ''}</div>` : ''}
        ${open ? `<div class="ds-row ds4-acts">${x.state === 'new' ? '<button type="button" class="ds-btn ghost ds-sm" data-ra="work">🙋 В работу</button>' : ''}<button type="button" class="ds-btn bad ds-sm" data-ra="done">✅ Нарушение…</button><button type="button" class="ds-btn ghost ds-sm" data-ra="rejected">❌ Отклонить…</button>${x.target && !file ? '<button type="button" class="ds-btn ghost ds-sm" data-ra="punish">⏳ Наказать…</button>' : ''}${x.target ? '<button type="button" class="ds-btn ghost ds-sm" data-ra="card">👤 Карточка</button>' : ''}</div>` : ''}</div>`;
    }
    box.onclick = async ev => {
      const sc = ev.target.closest('[data-sc]'), st = ev.target.closest('[data-st]'), kd = ev.target.closest('[data-kd]');
      if (sc) { scope = sc.dataset.sc; return draw(); }
      if (st) { state = st.dataset.st; return draw(); }
      if (kd) { kind = kd.dataset.kd || null; return draw(); }
      const b = ev.target.closest('[data-ra]'); if (!b) return;
      const it = b.closest('[data-key]'), k = it.dataset.k, key = +it.dataset.key, a = b.dataset.ra;
      const cid = it.dataset.cid ? +it.dataset.cid : cidOf(srv);
      if (a === 'card') return memberCard(mode, srv.official && k !== 'cm' && !(k === 'file' && it.dataset.cid) ? srv : { id: cid, official: false, name: '' }, it.dataset.uid, it.dataset.nick);
      if (a === 'punish') return punish(srv.official && k === 'chat' ? null : cid, it.dataset.uid, it.dataset.nick, 'mute');
      let act = '', note = '';
      if (a === 'done' || a === 'rejected') {
        const file = k === 'file', canBlock = file && srv.official && R.mod;
        const v = await X.sheet(a === 'done' ? '✅ Нарушение подтверждено' : '❌ Нарушений нет',
          `${a === 'done' ? `<div class="ds4-opts">${(file ? (canBlock ? [['block', '⛔ Запретить файл (больше не отправить)'], ['', 'Просто закрыть']] : [['', 'Закрыть']]) : [['delete', '🗑 Удалить сообщение'], ['', 'Оставить сообщение, закрыть']]).map(([v2, t], i) => `<button type="button" class="ds4-opt${i ? '' : ' on'}" data-pick="${e(v2)}">${t}</button>`).join('')}</div>` : '<p class="ds-dim">Скрытое жалобами сообщение вернётся.</p>'}
           <label class="ds-lbl">Заметка — видна команде в 📜 журнале<input class="ds-in" data-f="reason" maxlength="200" placeholder="${a === 'done' ? 'Например: спам ссылками' : 'Например: шутка между друзьями'}"></label>
           <p class="ds-dim">Тому, кто пожаловался, придёт 🔔 «Жалобу рассмотрели» (без имени модератора).</p>
           <button type="button" class="ds4-wide ds4-go ${a === 'done' ? 'bad' : ''}" data-v="go">${a === 'done' ? '✅ Готово' : '❌ Отклонить'}</button>`,
          w => ({ act: w.querySelector('.ds4-opt.on')?.dataset.pick || '', note: w.querySelector('[data-f="reason"]').value.trim() }));
        if (!v) return;
        act = a === 'done' ? v.act : ''; note = v.note;
      }
      b.disabled = true;
      const r = await RPC('mod_report_set', { p_kind: k, p_key: key, p_state: a, p_action: act, p_note: note });
      if (!r.data?.ok) { b.disabled = false; toast('⚠️ ' + why(r)); return; }
      toast(a === 'work' ? '🙋 Жалоба у тебя в работе' : a === 'done' ? '✅ Готово — жалобщику придёт «рассмотрено»' : '❌ Отклонено', true);
      draw(); badge(box.closest('.dm-hub')?.parentElement || box, srv);
    };
    await draw();
  }

  // ═══ ⏳ Наказание с причиной и сроком (старые chat_mod / cm_mod пишут журнал и 🔔 человеку); cid null — сервер сайта ═══
  const REASONS = ['Спам', 'Флуд', 'Мат', 'Оскорбления', 'Реклама', 'Не по теме', 'Личные данные'];
  const DUR = [[10, '10 мин'], [60, '1 час'], [1440, '1 день'], [10080, '1 неделя']];
  async function punish(cid, uid, nick, act){
    const site = cid == null;
    const T = { warn: ['⚠️ Предупредить', ''], mute: ['⏳ Тайм-аут', 'ghost'], kick: ['👢 Выгнать', 'bad'], ban: ['⛔ Забанить', 'bad'], siteban: ['🔨 Бан ника', 'bad'] }[act];
    const durs = act === 'mute' ? DUR : act === 'ban' ? DUR.concat([[0, 'навсегда']]) : null;
    const v = await X.sheet(`${T[0]} <b>${e(nick || 'игрок')}</b>`,
      `${durs ? `<div class="ds4-opts">${durs.map(([m, t], i) => `<button type="button" class="ds4-opt${i === (act === 'ban' ? durs.length - 1 : 1) ? ' on' : ''}" data-pick="${e(m)}">${e(t)}</button>`).join('')}</div>` : ''}
       <div class="ds4-chips">${REASONS.map(t => `<button type="button" class="ds4-chip" data-chip="${e(t)}">${e(t)}</button>`).join('')}</div>
       <label class="ds-lbl">Причина — видна в журнале${act === 'siteban' ? '' : ' и ему в 🔔'}<input class="ds-in" data-f="reason" maxlength="200" placeholder="Например: спам ссылками"></label>
       ${act === 'ban' ? '<label class="ds-chk"><input type="checkbox" data-f="purge"> Удалить его сообщения за сутки</label>' : ''}
       <p class="ds-dim">Тайм-аут держит сервер: писать не получится, пока срок не выйдет.</p>
       <button type="button" class="ds4-wide ds4-go ${T[1]}" data-v="go">${T[0]}</button>`,
      w => ({ min: +(w.querySelector('.ds4-opt.on')?.dataset.pick || 60), reason: w.querySelector('[data-f="reason"]').value.trim(), purge: !!w.querySelector('[data-f="purge"]')?.checked }));
    if (!v) return false;
    const r = act === 'siteban' ? await RPC('mod_site_ban', { p_user: uid, p_on: true, p_reason: v.reason })
      : site ? await RPC('chat_mod', { p_user: uid || null, p_nick: nick || '', p_action: act, p_minutes: v.min, p_reason: v.reason })
      : await RPC('cm_mod', { p_community: cid, p_user: uid, p_action: act, p_minutes: v.min, p_reason: v.reason, p_purge: v.purge });
    toast(r.data?.ok ? `${T[0]}: ${nick} — готово` : '⚠️ ' + why(r), !!r.data?.ok);
    return !!r.data?.ok;
  }
  async function undo(cid, uid, nick, act){
    const r = act === 'unban' ? (cid == null ? await RPC('mod_site_ban', { p_user: uid, p_on: false, p_reason: '' }) : await RPC('cm_unban', { p_community: cid, p_user: uid }))
      : cid == null ? await RPC('chat_mod', { p_user: uid || null, p_nick: nick || '', p_action: 'unmute', p_minutes: 0, p_reason: '' })
      : await RPC('cm_mod', { p_community: cid, p_user: uid, p_action: 'unmute', p_minutes: 0, p_reason: '', p_purge: false });
    toast(r.data?.ok ? (act === 'unban' ? '✅ Разбанен' : '🔊 Тайм-аут снят') : '⚠️ ' + why(r), !!r.data?.ok);
    return !!r.data?.ok;
  }

  // ═══ 👥 Участники ═══
  const MF = [['all', 'Все'], ['muted', '🔇 Тайм-аут'], ['banned', '⛔ Баны'], ['staff', '🛡 Команда']];
  const ROLE = { admin: '👑 админ', moderator: '🛡 модератор', helper: '🔰 хелпер', owner: '👑 владелец', mod: '🛡 модератор' };
  async function members(box, mode, srv, sub){
    let q = '', f = MF.some(x => x[0] === sub?.[0]) ? sub[0] : 'all', tm = 0;
    box.innerHTML = `<div class="ds-row dm-search"><input class="ds-in" type="search" data-q maxlength="24" placeholder="🔎 Ник" aria-label="Поиск по нику"></div>
      <div class="dm-chips">${MF.map(([v, t]) => `<button type="button" class="dm-chip${v === f ? ' on' : ''}" data-mf="${v}">${t}</button>`).join('')}</div><div class="dm-mlist"><div class="ds-dim">Загружаем…</div></div>`;
    const list = box.querySelector('.dm-mlist');
    const load = async () => {
      const r = await RPC('mod_members', { p_cid: cidOf(srv), p_q: q, p_filter: f });
      if (!list.isConnected) return;
      if (r.missing) { list.innerHTML = SOON + `<p class="ds-dim">Пока — 👥 список справа и меню сообщения (⚠️ ⏳ 👢 ⛔).</p>`; return; }
      if (!r.data?.ok) { list.innerHTML = `<p class="ds-dim">⚠️ ${e(why(r))}</p>`; return; }
      const L = r.data.list || [];
      list.innerHTML = L.map(x => `<button type="button" class="dm-mem" data-uid="${e(x.id || '')}" data-nick="${e(x.nick || '')}"><b>${e(x.nick || '—')}</b>${x.role && ROLE[x.role] ? `<span class="dm-tag">${ROLE[x.role]}</span>` : ''}${x.muted_until ? `<span class="dm-tag warn">🔇 до ${e(dt(x.muted_until))}</span>` : ''}${x.banned ? `<span class="dm-tag bad">⛔ бан${x.until ? ' до ' + e(dt(x.until)) : ''}</span>` : ''}${+x.notes ? `<span class="dm-tag">📝 ${+x.notes}</span>` : ''}${+x.strikes ? `<span class="dm-tag warn">⚠️ ${+x.strikes} за 30 дн.</span>` : ''}${x.reason ? `<small class="ds-dim">«${e(x.reason)}»</small>` : ''}</button>`).join('')
        || `<div class="ds-dim dm-empty">${q ? 'Никого не нашли' : f === 'all' && srv.official ? 'Введи ник — или здесь появятся те, кто писал недавно' : 'Пусто'}</div>`;
    };
    box.oninput = ev => { if (!ev.target.matches('[data-q]')) return; clearTimeout(tm); tm = setTimeout(() => { q = ev.target.value.trim(); load(); }, 300); };
    box.onclick = ev => {
      const c = ev.target.closest('[data-mf]'); if (c) { f = c.dataset.mf; box.querySelectorAll('[data-mf]').forEach(x => x.classList.toggle('on', x === c)); return load(); }
      const m = ev.target.closest('.dm-mem'); if (m && m.dataset.uid) memberCard(mode, srv, m.dataset.uid, m.dataset.nick, load);
    };
    await load();
  }

  // Карточка человека для команды: действия, заметки (сам человек их не видит), история на этом сервере
  function overlay(html){
    const w = document.createElement('div');
    w.className = 'ds4-sh dm-cardsh'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true');
    w.innerHTML = `<div class="ds4-box dm-card">${html}</div>`;
    const key = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); close(); } };
    const close = () => { w.remove(); document.removeEventListener('keydown', key, true); };
    w.addEventListener('click', ev => { if (ev.target === w || ev.target.closest('[data-cx]')) close(); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(w);
    return { w, box: w.firstChild, close };
  }
  async function memberCard(mode, srv, uid, nick, after){
    if (!uid) return;
    const cid = cidOf(srv), site = cid == null, R = rights(srv);
    const o = overlay(`<div class="ds4-t">👤 <b>${e(nick || 'игрок')}</b></div><div class="dm-cbody"><div class="ds-dim">Загружаем…</div></div><button type="button" class="ds4-wide ghost" data-cx>Закрыть</button>`);
    const body = o.box.querySelector('.dm-cbody');
    const draw = async () => {
      const r = await RPC('mod_member', { p_cid: cid, p_user: uid });
      if (!body.isConnected) return;
      if (r.missing) { body.innerHTML = SOON; return; }
      if (!r.data?.ok) { body.innerHTML = `<p class="ds-dim">⚠️ ${e(why(r))}</p>`; return; }
      const d = r.data, me = uid === P.me(), can = d.can !== false && !me && !ADMINS.has(uid);
      const acts = can ? [['warn', '⚠️ Предупредить'], ['mute', '⏳ Тайм-аут'], ['unmute', '🔊 Снять тайм-аут']]
        .concat(site ? (R.mod ? [['siteban', '🔨 Бан ника'], ['unban', '✅ Разбан']] : []) : [['kick', '👢 Выгнать'], ['ban', '⛔ Забанить'], ['unban', '✅ Разбан']]) : [];
      body.innerHTML = `${me ? '<p class="ds-dim">Это ты 🙂</p>' : !can ? '<p class="ds-dim">🛡 Это команда или создатель — наказывать может только создатель сайта.</p>' : ''}
        ${acts.length ? `<div class="dm-cacts">${acts.map(([k, t]) => `<button type="button" class="ds-btn ${['kick', 'ban', 'siteban'].includes(k) ? 'bad' : 'ghost'} ds-sm" data-ca="${k}">${t}</button>`).join('')}</div>` : ''}
        ${me ? '' : `<h4>📝 Заметки команды <small class="ds-dim">— он их не видит</small></h4>
        <div class="dm-notes">${(d.notes || []).map(n => `<div class="dm-note"><div>${e(n.text)}</div><small class="ds-dim">${e(n.by || '—')} · ${e(dt(n.at))}</small>${n.mine || R.log ? `<button type="button" class="dm-nx" data-nd="${e(n.id)}" title="Удалить заметку" aria-label="Удалить заметку">✕</button>` : ''}</div>`).join('') || '<div class="ds-dim">Заметок нет</div>'}</div>
        <div class="ds-row"><input class="ds-in" data-note maxlength="500" placeholder="Например: уже предупреждали за рекламу" aria-label="Новая заметка"><button type="button" class="ds-btn ds-sm" data-ca="note">＋</button></div>`}
        <h4>📜 Что с ним делали здесь</h4><div class="ds4-log">${(d.log || []).map(x => `<div class="ds4-li"><small>${e(dt(x.at))}</small><div><b>${e(x.by || '🤖')}</b> ${e(ACT[x.action] || x.action)}${x.reason ? ` · <i>«${e(x.reason)}»</i>` : ''}</div></div>`).join('') || '<div class="ds-dim">Ничего</div>'}</div>`;
    };
    body.onclick = async ev => {
      const nd = ev.target.closest('[data-nd]');
      if (nd) { const r = await RPC('mod_note_del', { p_id: +nd.dataset.nd }); if (r.data?.ok) draw(); else toast('⚠️ ' + why(r)); return; }
      const b = ev.target.closest('[data-ca]'); if (!b) return;
      const a = b.dataset.ca;
      if (a === 'note') {
        const i = body.querySelector('[data-note]'), t = i.value.trim(); if (!t) return i.focus();
        b.disabled = true; const r = await RPC('mod_note_add', { p_cid: cid, p_user: uid, p_text: t }); b.disabled = false;
        if (r.data?.ok) draw(); else toast('⚠️ ' + why(r));
        return;
      }
      const ok = a === 'unmute' || a === 'unban' ? await undo(cid, uid, nick, a) : await punish(cid, uid, nick, a);
      if (ok) { draw(); after?.(); }
    };
    body.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.matches('[data-note]')) { ev.preventDefault(); body.querySelector('[data-ca="note"]')?.click(); } });
    await draw();
  }

  // ═══ 📜 Журнал ═══
  const ACT = { delete: '🗑 удалил(а) сообщение', purge: '🧹 удалил(а) сообщения', mute: '⏳ дал(а) тайм-аут', unmute: '🔊 снял(а) тайм-аут', kick: '👢 выгнал(а)',
    ban: '⛔ забанил(а)', unban: '✅ разбанил(а)', warn: '⚠️ предупредил(а)', automod: 'остановила сообщение от', note: '📝 оставил(а) заметку о',
    report_work: '🙋 взял(а) жалобу на', report_done: '✅ закрыл(а) жалобу (нарушение) на', report_rejected: '❌ отклонил(а) жалобу на',
    raid_on: '🛡 включил(а) защиту от рейда', raid_off: '🛡 выключил(а) защиту от рейда', modcfg: '🚫 изменил(а) слова и 🐢 новичкам',
    cat_add: '📁 создал(а) категорию', cat_delete: '📁 удалил(а) категорию', chan_add: '＋ создал(а) канал', chan_edit: '⚙️ изменил(а) канал',
    chan_archive: '🗄 убрал(а) в архив канал', chan_unarchive: '🗄 вернул(а) из архива канал', chan_delete: '🗑 удалил(а) канал', automod_cfg: '🤖 изменил(а) автомодерацию' };
  function logRow(x){
    return `<div class="ds4-li"><small>${e(dt(x.at))}</small><div>${x.action === 'automod' ? '<b>🤖 Автомодерация</b>' : `<b>${e(x.actor_nick || '—')}</b>`} ${e(ACT[x.action] || x.action)}${x.target_nick ? ` <b>${e(x.target_nick)}</b>` : ''}${x.reason ? ` · <i>«${e(x.reason)}»</i>` : ''}${x.detail ? ` <span class="ds-dim">· ${e(clean(x.detail))}</span>` : ''}</div></div>`;
  }
  const LG = [['all', 'Всё'], ['msg', '🗑 Сообщения и автомод'], ['punish', '⏳ Наказания'], ['report', '🚩 Жалобы'], ['settings', '⚙️ Настройки']];
  async function log(box, mode, srv, sub){
    let g = LG.some(x => x[0] === sub?.[0]) ? sub[0] : 'all', q = '', before = null, L = [], tm = 0;
    box.innerHTML = `<div class="ds-row dm-search"><input class="ds-in" type="search" data-lq maxlength="24" placeholder="🔎 Ник — кто сделал или кому" aria-label="Поиск по нику"></div>
      <div class="dm-chips">${LG.map(([v, t]) => `<button type="button" class="dm-chip${v === g ? ' on' : ''}" data-lg="${v}">${t}</button>`).join('')}</div><div class="dm-log"><div class="ds-dim">Загружаем…</div></div>`;
    const out = box.querySelector('.dm-log');
    const load = async more => {
      if (!more) { L = []; before = null; }
      const r = await RPC('mod_log', { p_cid: cidOf(srv), p_group: g, p_q: q, p_before: before });
      if (!out.isConnected) return;
      if (r.missing) return legacy(box, mode, srv, 'log');
      if (!r.data?.ok) { out.innerHTML = `<p class="ds-dim">${r.data?.reason === 'rights' ? 'Журнал видят ' + (srv.official ? 'админ и модераторы сайта' : 'владелец и модераторы сообщества') : '⚠️ ' + e(why(r))}</p>`; return; }
      const add = r.data.list || []; L.push(...add); if (add.length) before = add[add.length - 1].id;
      out.innerHTML = `<div class="ds4-log">${L.map(logRow).join('') || '<div class="ds-dim">Пусто</div>'}</div>${add.length === 50 ? '<div class="ds-row"><button type="button" class="ds-btn ghost" data-lm>Показать раньше</button></div>' : ''}`;
    };
    box.oninput = ev => { if (!ev.target.matches('[data-lq]')) return; clearTimeout(tm); tm = setTimeout(() => { q = ev.target.value.trim(); load(); }, 300); };
    box.onclick = ev => {
      const c = ev.target.closest('[data-lg]'); if (c) { g = c.dataset.lg; box.querySelectorAll('[data-lg]').forEach(x => x.classList.toggle('on', x === c)); return load(); }
      if (ev.target.closest('[data-lm]')) load(true);
    };
    await load();
  }

  // ═══ 🤖 Автомод: старые правила (мат, флуд, КАПС, повтор, @, ссылки) + слова, 🐢 новичкам, 🛡 рейд (ч. 11) ═══
  async function automod(box, mode, srv){
    box.innerHTML = '<div class="dm-am0"></div><div class="ds-sect dm-am1"><div class="ds-dim">Загружаем…</div></div>';
    if (OLD.reports) OLD.reports.render(box.firstChild, mode, srv, ['automod']);
    const host = box.querySelector('.dm-am1');
    const r = await RPC('mod_cfg_get', { p_cid: cidOf(srv) });
    if (!host.isConnected) return;
    if (r.missing) { host.innerHTML = '<b>🚫 Запрещённые слова · 🐢 новичкам · 🛡 рейд</b>' + SOON; return; }
    if (!r.data?.ok) { host.innerHTML = `<p class="ds-dim">⚠️ ${e(why(r))}</p>`; return; }
    const c = r.data.cfg || {}, can = !!r.data.can, dis = can ? '' : ' disabled', raid = r.data.raid_until;
    host.innerHTML = `<b>🚫 Запрещённые слова</b><p class="ds-dim">Через запятую, до 50 слов. Сообщение с таким словом сервер не пропустит. Команду не трогает.</p>
      <textarea class="ds-in" data-w rows="3" maxlength="1600"${dis} placeholder="казино, ставки, …">${e((c.words || []).join(', '))}</textarea>
      <label class="ds-lbl">🐢 Медленный режим новичкам (${srv.official ? 'аккаунту меньше суток и гостям' : 'в сообществе меньше суток'})<select class="ds-in" data-ns${dis}>${[[0, 'выключен'], [10, '10 с'], [30, '30 с'], [60, '1 мин'], [120, '2 мин'], [300, '5 мин']].map(([v, t]) => `<option value="${v}"${(+c.newslow || 0) === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      ${can ? '<div class="ds-row"><button type="button" class="ds-btn" data-amx="save">💾 Сохранить</button></div>' : '<p class="ds-dim">Менять могут админ и модераторы.</p>'}
      <b>🛡 Защита от рейда</b><p class="ds-dim">Новички и гости только читают. Включить может любой из команды.</p>
      <div class="ds-row">${raid ? `<span>Включена до ${e(dt(raid))}</span><button type="button" class="ds-btn ghost ds-sm" data-amr="0">Выключить</button>` : [15, 60, 240].map(m => `<button type="button" class="ds-btn ghost ds-sm" data-amr="${m}">${m < 60 ? m + ' мин' : m / 60 + ' ч'}</button>`).join('')}</div>`;
    host.onclick = async ev => {
      const rr = ev.target.closest('[data-amr]');
      if (rr) { const x = await RPC('mod_raid', { p_cid: cidOf(srv), p_minutes: +rr.dataset.amr }); toast(x.data?.ok ? '🛡 Готово' : '⚠️ ' + why(x), !!x.data?.ok); return automod(box, mode, srv); }
      if (!ev.target.closest('[data-amx="save"]')) return;
      const words = host.querySelector('[data-w]').value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      const x = await RPC('mod_cfg_set', { p_cid: cidOf(srv), p_cfg: { words, newslow: +host.querySelector('[data-ns]').value } });
      toast(x.data?.ok ? `✅ Сохранено: слов ${x.data.cfg.words.length}` : '⚠️ ' + why(x), !!x.data?.ok);
    };
  }

  // ═══ 🎭 Роли и права ═══
  async function roles(box, mode, srv, sub, R){
    if (!srv.official && X.sub.roles && R.roles) return X.sub.roles.render(box, mode, srv, sub);
    box.innerHTML = `<div class="ds-sect"><b>${srv.official ? 'Роли сервера сайта' : 'Роли сообщества'}</b>
      <p class="ds-dim">${srv.official ? '👑 админ — всё; 🛡 модератор — каналы, удаление, тайм-ауты, баны ников, журнал, файлы; 🔰 хелпер — жалобы, тайм-аут до часа, заметки, защита от рейда. Роли назначает владелец сайта.'
        : '👑 владелец — всё; 🛡 модераторы и роли с правом «🔨 Модерация» — жалобы, тайм-ауты, кики, баны, журнал. Роли с цветами и правами настраивает владелец (⚙️ → 🎭 Роли).'}</p>
      <p class="ds-dim">👑 Жалобы на команду видит только создатель сайта.</p></div><h4>🛡 Команда</h4><div class="dm-mlist"><div class="ds-dim">Загружаем…</div></div>`;
    const list = box.querySelector('.dm-mlist');
    const r = await RPC('mod_members', { p_cid: cidOf(srv), p_q: '', p_filter: 'staff' });
    if (!list.isConnected) return;
    list.innerHTML = r.data?.ok ? (r.data.list || []).map(x => `<div class="dm-mem"><b>${e(x.nick || '—')}</b>${ROLE[x.role] ? `<span class="dm-tag">${ROLE[x.role]}</span>` : ''}</div>`).join('') || '<div class="ds-dim">Пусто</div>' : r.missing ? SOON : `<p class="ds-dim">⚠️ ${e(why(r))}</p>`;
  }

  // ═══ 🔗 Приглашения ═══
  async function invites(box, mode, srv, sub, R){
    const code = srv.c?.code || srv.raw?.c?.code;
    const url = (window.D37Ref?.wrap || (u => u))(srv.official ? location.origin + '/chat' : code ? `${location.origin}/c/${code}` : '');
    box.innerHTML = url ? `<div class="ds-sect"><b>🔗 Ссылка-приглашение</b><div class="ds-row"><input class="ds-in" readonly value="${e(url)}" aria-label="Ссылка-приглашение"><button type="button" class="ds-btn ghost" data-ic title="Скопировать">📋</button></div>
      ${!srv.official && R.settings ? '<p class="ds-dim">Старая ссылка утекла? Новая — и старая перестанет работать.</p><button type="button" class="ds-btn ghost ds-sm" data-ir>🔄 Новая ссылка</button>' : ''}
      ${!srv.official && !srv.raw?.c?.is_public ? '<p class="ds-dim">🔒 Сообщество закрытое — войти можно только по ссылке.</p>' : ''}</div>` : '<p class="ds-dim">Ссылки нет</p>';
    box.onclick = async ev => {
      if (ev.target.closest('[data-ic]')) { try { await navigator.clipboard.writeText(url); toast('🔗 Скопировано', true); } catch (er) { prompt('Ссылка:', url); } }
      if (ev.target.closest('[data-ir]')) { const r = await RPC('cm_invite_reset', { p_id: srv.id }); if (r.data?.ok) { DS.dropC?.(srv.id); toast('🔄 Новая ссылка готова', true); const s2 = await DS.server(srv.id); if (s2?.ok) invites(box, mode, s2, sub, R); } else toast('⚠️ ' + why(r)); }
    };
  }

  // ═══ ⚙️ Настройки сервера, 📁 каналы — старые экраны внутри центра ═══
  async function settings(box, mode, srv){
    if (DS.screenSettings) return DS.screenSettings(box, mode, srv);
    if (OLD.settings) return OLD.settings.render(box, mode, srv, []);
    box.innerHTML = '<p class="ds-dim">Настройки — появятся, когда сайт обновится.</p>';
  }
  async function channels(box, mode, srv, sub){
    if (X.sub.channels) return X.sub.channels.render(box, mode, srv, sub);
    box.innerHTML = SOON;
  }

  const SCREENS = { overview, reports, members, channels, roles, automod, log, settings, invites,
    files: (box, mode, srv, sub, R) => reports(box, mode, srv, sub, R, true) };

  // ═══ Подключение: «🛡» (…/reports) и «⚙️» (…/settings) открывают центр ═══
  X.sub.reports = { title: '🛡 Модерация', render: (el, mode, srv, rest) => hub(el, mode, srv, rest) };
  X.sub.settings = { title: '🛡 Модерация · ⚙️', render: (el, mode, srv, rest) => hub(el, mode, srv, rest, 'settings') };
  window.D37Mod = { hub, rights, noReport: MV.noReport, _test: { SECT, rights, ACT, ALIAS } };
})();
