// ═══════════════════════════════════════
//  👤 ЛЮДИ «КАК В ДИСКОРДЕ» (T-164, ds-people; community.sql часть 13)
// ═══════════════════════════════════════
// Статус (в сети / не на месте / не беспокоить / невидимка) + свой статус (эмодзи, текст, срок), «о себе», цвет полосы карточки,
// кто видит «был в сети»; карточка человека (общая мини-карточка minicard.js + блок отсюда): ник и роли на этом сервере, на сайте с…,
// общие серверы и друзья, «был в сети», «сейчас играет», игнор; ник на сервере; значки ролей и статусы в списке участников;
// друзья (в сети / все / заявки / заблокированные и игнор / группы / добавить) — #/chat/friends[/<вкладка>];
// группы ЛС до 10 человек (только друзья; до 9 лет — нет; дети ↔ взрослые — нет) — #/chat/gdm/<id>, лента — общая MsgView.
// Всё решает сервер (функции ds_* / gdm_*, таблицы закрыты RLS); здесь — только показ. Чужой текст — только через esc() / textContent.
// Грузится: phone.js MODS.ppl (сразу после входа — «невидимка» и игнор действуют на всём сайте) и в MODS.ds.
// Крючки: community.js (railTop, membersDecor, meBtn, data-top / data-rid), minicard.js (card), msgview.js (isIgnored, srvNick),
//   chat.js onlineMeta (d37_ppl_inv — невидимку не видно в «кто онлайн»).
// Без части 13 на сервере (PGRST202) — тихо выключается, сайт работает как раньше.
// Откат одной строкой: PEOPLE_ON = false.
(() => {
  'use strict';
  if (window.D37People) return;
  const PEOPLE_ON = true;
  const PL = window.D37People = { on: PEOPLE_ON };
  if (!PEOPLE_ON) return;
  const P = window.D37Phone; if (!P) return;
  const e = s => (typeof esc === 'function' ? esc(String(s ?? '')) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const DS = () => window.D37DS || null;
  const sbc = () => (typeof sbClient !== 'undefined' && sbClient) || null;
  let missing = false;   // часть 13 не выполнена на сервере
  const miss = r => { if (r?.missing) { missing = true; PL.missing = true; } return missing; };

  // стили — своим файлом (один раз)
  if (typeof document !== 'undefined' && document.head && !document.getElementById('pplCss')) {
    const l = document.createElement('link'); l.id = 'pplCss'; l.rel = 'stylesheet'; l.href = 'css/ds-people.css?v=1'; document.head.appendChild(l);
  }

  const ST = { online: ['🟢', 'В сети'], idle: ['🌙', 'Не на месте'], dnd: ['⛔', 'Не беспокоить'], invisible: ['⚪', 'Невидимка'], offline: ['⚪', 'Не в сети'] };
  const stOk = s => (Object.prototype.hasOwnProperty.call(ST, s) ? s : 'offline');
  const REASON = { bad: 'есть запрещённые слова', link: 'без ссылок', emoji: 'значок — только эмодзи', len: 'слишком длинно', name: 'такой ник нельзя', rights: 'нет прав',
    member: 'человек не на этом сервере', too_fast: 'слишком часто — подожди', limit: 'достигнут предел', closed: 'не принимает заявки', blocked: 'есть блокировка',
    full: 'в группе уже 10 человек', empty: 'выбери хотя бы одного друга', friends: 'звать в группу можно только своих друзей', rate: 'не так быстро', repeat: 'это уже отправлено',
    old: 'править можно 48 часов', auth: 'нужно войти', not_found: 'не найдено', banned: 'тебя забанили здесь', minutes: 'неверный срок', color: 'неверный цвет', status: 'неверный статус' };
  const why = (r, ctx) => {
    const k = r?.data?.reason;
    if (k === 'age' || k === 'u9' || k === 'no') return window.D37Age?.kidMsg ? window.D37Age.kidMsg(ctx === 'friend' && k === 'age' ? 'agefriend' : k) : '🔒 Недоступно';
    if (k) return REASON[k] || k;
    return r?.error ? P.err(r.error) : 'не получилось';
  };
  const rpc = async (fn, args) => { const r = await P.rpc(fn, args); miss(r); return r; };
  const date = iso => { try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (er) { return ''; } };
  const dot = s => `<i class="ppl-dot" data-pst="${stOk(s)}" title="${ST[stOk(s)][1]}"></i>`;
  const custom = c => (c && (c.e || c.t) ? `${c.e ? `<span class="ppl-ce">${e(c.e)}</span> ` : ''}${e(c.t || '')}` : '');
  const special = (mode, k) => (DS()?.special ? DS().special(mode, k) : (mode === 'phone' ? '#/phone/comm/' : '#/chat/') + k);
  const curMode = () => (/^#\/phone\//.test(window.D37Route?.hash?.() || '') ? 'phone' : 'page');

  // ═══ Мой статус (ds_me) ═══
  let ME = null, meP = null;
  PL.me = () => ME;
  const setInv = on => {
    let was = false;
    try { was = localStorage.getItem('d37_ppl_inv') === P.me(); if (on && P.me()) localStorage.setItem('d37_ppl_inv', P.me()); else localStorage.removeItem('d37_ppl_inv'); } catch (er) {}
    if (was !== !!on && typeof trackOnline === 'function') { try { trackOnline(); } catch (er) {} }
  };
  async function loadMe(fresh){
    const me = P.me(); if (!me || missing) { ME = null; return null; }
    if (ME && ME.uid === me && !fresh) return ME;
    if (meP && !fresh) return meP;
    meP = rpc('ds_me').then(r => { meP = null; if (r.data?.ok) { ME = Object.assign({}, r.data, { uid: me }); setInv(ME.status === 'invisible'); repaint(); } return ME; });
    return meP;
  }
  const repaint = () => { try { DS()?.refreshSide?.(); } catch (er) {} };
  async function saveMe(patch){
    const r = await rpc('ds_status_set', { p: patch });
    if (r.data?.ok) { ME = Object.assign({}, r.data, { uid: P.me() }); setInv(ME.status === 'invisible'); repaint(); window.dispatchEvent(new Event('d37:ppl')); return { ok: true }; }
    return { ok: false, err: why(r) };
  }

  // ═══ Игнор: сообщения скрыты у меня (msgview.js спрашивает isIgnored) ═══
  let ignored = new Set();
  PL.isIgnored = uid => !!uid && ignored.has(uid);
  async function loadIgnores(){
    const s = sbc(); if (!s || !P.me() || missing) { ignored = new Set(); return; }
    try {
      const { data, error } = await s.from('user_ignores').select('ignored_id');
      if (error) { if (P.missing(error)) { missing = true; PL.missing = true; } return; }
      ignored = new Set((data || []).map(r => r.ignored_id));
      if (ignored.size) window.dispatchEvent(new Event('d37:blocks'));
    } catch (er) {}
  }
  PL.ignore = async (uid, on) => {
    const r = await rpc('ds_ignore', { p_uid: uid, p_on: !!on });
    if (!r.data?.ok) return { ok: false, err: why(r) };
    if (on) ignored.add(uid); else ignored.delete(uid);
    window.dispatchEvent(new Event('d37:blocks'));
    return { ok: true };
  };

  // ═══ Сервер: ники, статусы, значки ролей (ds_people_meta, кэш 30 с) ═══
  const scopeOfSrv = srv => (!srv ? null : srv.official ? 'd37' : srv.id != null && /^\d+$/.test(String(srv.id)) ? 'c' + srv.id : null);
  const scopeOfA = A => (!A ? null : A.official ? 'd37' : A.community != null && /^\d+$/.test(String(A.community)) ? 'c' + A.community : null);
  PL.scope = () => {
    const cur = DS()?.cur?.();
    if (cur?.srv) return scopeOfSrv(cur.srv);
    const h = window.D37Route?.hash?.() || '';
    const m = /^#\/phone\/comm\/(\d+)/.exec(h) || /^#\/chat\/c\/(\d+)/.exec(h);
    return m ? 'c' + m[1] : /^#\/(chat|phone\/comm)(\/|$)/.test(h) ? 'd37' : null;
  };
  const NK = new Map(), MC = new Map(), ICONS = new Map();   // NK: scope → Map(uid → ник | '' ), MC: scope|uid → { s, c, t }
  async function meta(scope, ids){
    if (missing || !scope || !ids.length) return null;
    const r = await rpc('ds_people_meta', { p_scope: scope, p_ids: ids.slice(0, 300) });
    if (!r.data?.ok) return null;
    const nk = NK.get(scope) || new Map(); NK.set(scope, nk);
    for (const id of ids) if (!nk.has(id)) nk.set(id, '');
    const list = Array.isArray(r.data.list) ? r.data.list : [];
    for (const x of list) { if (!UUID.test(x.id || '')) continue; nk.set(x.id, typeof x.n === 'string' ? x.n.slice(0, 32) : ''); MC.set(scope + '|' + x.id, { s: x.s || 'offline', c: x.c || null, t: Date.now() }); }
    if (nk.size > 3000) NK.set(scope, new Map([...nk].slice(-1500)));
    if (MC.size > 3000) MC.clear();
    ICONS.set(scope, r.data.icons && typeof r.data.icons === 'object' ? r.data.icons : {});
    return { list, icons: ICONS.get(scope) };
  }
  // ник на сервере для ленты: известен — сразу; нет — спросим пачкой и перерисуем ленту (событие d37:blocks)
  let nq = new Map(), nT = 0;
  PL.srvNick = (A, uid) => {
    if (missing || !uid || !UUID.test(uid)) return null;
    const s = scopeOfA(A); if (!s) return null;
    const nk = NK.get(s);
    if (nk && nk.has(uid)) return nk.get(uid) || null;
    if (!nq.has(s)) nq.set(s, new Set());
    nq.get(s).add(uid);
    (NK.get(s) || NK.set(s, new Map()).get(s)).set(uid, '');
    clearTimeout(nT); nT = setTimeout(flushNicks, 400);
    return null;
  };
  async function flushNicks(){
    const q = nq; nq = new Map(); let any = false;
    for (const [s, set] of q) { const d = await meta(s, [...set]); if (d) for (const x of d.list) if (x.n) any = true; }
    if (any) window.dispatchEvent(new Event('d37:blocks'));
  }
  const dropNicks = scope => { NK.delete(scope); };

  // ═══ Список участников: точка статуса, ник на сервере, свой статус, значок роли (крючок community.js) ═══
  async function membersDecor(box, srv){
    if (missing || !box || !P) return;
    const scope = scopeOfSrv(srv); if (!scope) return;
    const rows = [...box.querySelectorAll('.ds-mem[data-uid]')].filter(b => UUID.test(b.dataset.uid || ''));
    if (!rows.length) return;
    const d = await meta(scope, [...new Set(rows.map(b => b.dataset.uid))]);
    if (!d || !box.isConnected) return;
    const by = new Map(d.list.map(x => [x.id, x]));
    for (const b of rows) {
      if (!b.isConnected) continue;
      const x = by.get(b.dataset.uid) || {}, s = b.classList.contains('off') ? 'offline' : stOk(x.s || 'online');
      let w = b.querySelector('.ppl-avw');
      const ava = b.querySelector('.ph-ava');
      if (!w && ava) { w = document.createElement('i'); w.className = 'ppl-avw'; ava.replaceWith(w); w.appendChild(ava); w.insertAdjacentHTML('beforeend', dot(s)); }
      else if (w) { const dd = w.querySelector('.ppl-dot'); if (dd) { dd.dataset.pst = s; dd.title = ST[s][1]; } }
      const nk = b.querySelector('.ph-nick');
      if (nk && x.n) { if (!nk.dataset.orig) nk.dataset.orig = nk.textContent; nk.textContent = x.n; nk.title = 'Ник на сайте: ' + nk.dataset.orig; }
      if (x.c && (x.c.e || x.c.t)) {
        let sm = b.querySelector('span > small');
        if (!sm) { sm = document.createElement('small'); (nk?.parentElement || b).appendChild(sm); }
        if (sm.textContent && !sm.dataset.ppl) sm.title = sm.textContent;   // занятие — в подсказку, свой статус — строкой
        sm.dataset.ppl = '1'; sm.textContent = `${x.c.e || ''} ${x.c.t || ''}`.trim();
      }
      const top = b.dataset.top, ic = top && d.icons[top];
      if (ic && !b.querySelector('.ppl-ri') && nk) { const i = document.createElement('i'); i.className = 'ppl-ri'; i.textContent = String(ic).slice(0, 8); nk.after(i); }
    }
    box.querySelectorAll('[data-rid]').forEach(h => { const ic = d.icons[h.dataset.rid]; if (ic && !h.querySelector('.ppl-ri')) { const i = document.createElement('i'); i.className = 'ppl-ri'; i.textContent = String(ic).slice(0, 8); h.prepend(i); } });
  }

  // ═══ Внизу каналов: кнопка моего статуса; вверху серверов: 👥 друзья (крючки community.js) ═══
  function meBtn(){
    if (missing || !P.me()) return '';
    if (!ME) { loadMe(); return ''; }
    const s = stOk(ME.status), c = ME.ctext || ME.cemoji ? `${ME.cemoji || ''} ${ME.ctext || ''}`.trim() : '';
    return `<button type="button" class="ds-hb ppl-mebtn" data-ppl="status" title="${e(ST[s][1] + (c ? ' · ' + c : ''))}" aria-label="Мой статус">${dot(s)}${ME.cemoji ? `<span class="ppl-ce">${e(ME.cemoji)}</span>` : ''}</button>`;
  }
  function railTop(mode, sel){
    if (missing || !P.me()) return '';
    const h = window.D37Route?.hash?.() || '', on = /\/(friends|gdm)(\/|$)/.test(h) && !sel, n = +ME?.incoming || 0;
    return `<a class="ds-srv ppl-home${on ? ' on' : ''}" href="${special(mode, 'friends')}" title="Друзья и группы" aria-label="Друзья и группы"><span class="ds-pill"></span><span class="ds-sic">👥</span>${n ? `<em class="ds-ment">${n > 9 ? '9+' : n}</em>` : ''}</a><i class="ds-rsep"></i>`;
  }

  // ═══ Окно «Мой статус» ═══
  const QUICK_E = ['🎮', '🎧', '📚', '🍕', '😴', '🏰', '🔥', '🎨', '⚽', '💬'];
  const SAMPLE_COLORS = ['#5865f2', '#22c55e', '#ef4444', '#f59e0b', '#a855f7', '#0ea5e9', '#ec4899', '#64748b'];
  let sheet = null;
  function closeSheet(){ if (sheet) { sheet.remove(); sheet = null; document.removeEventListener('keydown', sheetKey, true); } }
  const sheetKey = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); closeSheet(); } };
  PL.openStatus = async () => {
    if (!P.me()) { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); return; }
    const me = await loadMe(true); if (!me) { P.toast?.(missing ? '🛠️ Статусы появятся, когда сайт обновится' : '📡 Не загрузилось', false); return; }
    closeSheet();
    sheet = document.createElement('div');
    sheet.className = 'ppl-sheet';
    const s0 = stOk(me.status);
    sheet.innerHTML = `<div class="ppl-back" data-pk="close"></div><div class="ppl-box" role="dialog" aria-modal="true" aria-label="Мой статус">
      <div class="ppl-hd"><b>Мой статус</b><button type="button" class="ppl-x" data-pk="close" aria-label="Закрыть">✕</button></div>
      <div class="ppl-sts">${['online', 'idle', 'dnd', 'invisible'].map(s => `<button type="button" class="ppl-st${s === s0 ? ' on' : ''}" data-st="${s}">${dot(s)}<span><b>${ST[s][1]}</b><small>${s === 'idle' ? 'отошёл ненадолго' : s === 'dnd' ? 'видно, что ты занят — лучше не отвлекать' : s === 'invisible' ? 'ты на сайте, но всем кажешься не в сети' : 'все видят, что ты здесь'}</small></span></button>`).join('')}</div>
      <label class="ppl-lbl">Свой статус</label>
      <div class="ppl-row"><input class="ppl-in ppl-em" data-f="em" maxlength="16" placeholder="😀" aria-label="Значок статуса"><input class="ppl-in" data-f="ct" maxlength="80" placeholder="Чем занят? Например: строю замок" aria-label="Текст статуса"></div>
      <div class="ppl-quick">${QUICK_E.map(x => `<button type="button" data-qe="${x}">${x}</button>`).join('')}</div>
      <div class="ppl-row"><span class="ppl-dim">Убрать через</span><select class="ppl-in" data-f="min" aria-label="Убрать статус через"><option value="0">не убирать</option><option value="30">30 минут</option><option value="60">1 час</option><option value="240">4 часа</option><option value="1440">сутки</option><option value="10080">неделю</option></select></div>
      <label class="ppl-lbl">О себе <small class="ppl-dim">(видно в карточке)</small></label>
      <textarea class="ppl-in" data-f="about" maxlength="190" rows="2" placeholder="Пара слов о себе — без адреса и телефона"></textarea>
      <label class="ppl-lbl">Цвет полосы карточки</label>
      <div class="ppl-quick ppl-cols">${SAMPLE_COLORS.map(c => `<button type="button" data-col="${c}" style="background:${c}" aria-label="Цвет ${c}"></button>`).join('')}<button type="button" data-col="" title="Без цвета">✕</button></div>
      <label class="ppl-lbl">«Был в сети» видят</label>
      <select class="ppl-in" data-f="seen" aria-label="Кто видит «был в сети»"><option value="all">все</option><option value="friends">только друзья</option><option value="nobody">никто</option></select>
      <div class="ppl-err" hidden></div>
      <div class="ppl-row ppl-end"><button type="button" class="ds-btn ghost" data-pk="clear">Убрать свой статус</button><button type="button" class="ds-btn" data-pk="save">Сохранить</button></div>
    </div>`;
    const q = s => sheet.querySelector(s);
    q('[data-f="em"]').value = me.cemoji || ''; q('[data-f="ct"]').value = me.ctext || ''; q('[data-f="about"]').value = me.about || '';
    q('[data-f="seen"]').value = me.seen_vis || 'friends';
    let st = s0, col = me.color || '';
    const markCol = () => sheet.querySelectorAll('[data-col]').forEach(b => b.classList.toggle('on', b.dataset.col === col));
    markCol();
    const err = t => { const x = q('.ppl-err'); x.textContent = t ? '⚠️ ' + t : ''; x.hidden = !t; };
    sheet.addEventListener('click', async ev => {
      const t = ev.target.closest('[data-pk],[data-st],[data-qe],[data-col]'); if (!t) return;
      if (t.dataset.pk === 'close') { closeSheet(); return; }
      if (t.dataset.st) {   // статус — сразу
        st = t.dataset.st; sheet.querySelectorAll('[data-st]').forEach(b => b.classList.toggle('on', b === t));
        const r = await saveMe({ status: st }); if (!r.ok) err(r.err); return;
      }
      if (t.dataset.qe) { q('[data-f="em"]').value = t.dataset.qe; return; }
      if (t.dataset.col != null && !t.dataset.pk) { col = t.dataset.col; markCol(); return; }
      if (t.dataset.pk === 'clear') { q('[data-f="em"]').value = ''; q('[data-f="ct"]').value = ''; }
      t.disabled = true;
      const r = await saveMe({ status: st, cemoji: q('[data-f="em"]').value.trim(), ctext: q('[data-f="ct"]').value.trim(), minutes: +q('[data-f="min"]').value || 0,
        about: q('[data-f="about"]').value.trim(), color: col, seen_vis: q('[data-f="seen"]').value });
      t.disabled = false;
      if (r.ok) { closeSheet(); P.toast?.('✅ Сохранено', true); } else err(r.err);
    });
    document.addEventListener('keydown', sheetKey, true);
    document.body.appendChild(sheet);
  };

  // ═══ Карточка человека: блок под общей мини-карточкой (крючок minicard.js) ═══
  PL.card = async (card, uid, o = {}) => {
    if (missing || !card || !UUID.test(uid || '')) return;
    const live = typeof o.live === 'function' ? o.live : () => true;
    const scope = PL.scope();
    const r = await rpc('ds_card', { p_uid: uid, p_scope: scope });
    if (!live() || !r.data?.ok || !card.isConnected) return;
    const d = r.data, logged = !!P.me();
    card.querySelectorAll('.ppl-c').forEach(x => x.remove());
    const s = stOk(d.status === 'invisible' ? 'invisible' : d.status);
    const on = card.querySelector('.d37m-on');
    if (on) { on.hidden = s === 'offline'; on.dataset.pst = s; on.title = ST[s][1]; }
    const ban = card.querySelector('.d37m-ban');
    if (ban && d.color && /^#[0-9a-f]{6}$/i.test(d.color) && ban.classList.contains('empty')) ban.style.backgroundColor = d.color;
    const actEl = card.querySelector('.d37m-act');
    if (actEl && d.act && actEl.hidden && P.actText) { actEl.textContent = P.actText(P.actParse(d.act)); actEl.hidden = false; }
    const bio = card.querySelector('.d37m-bio');
    if (bio && d.about && bio.hidden) { bio.textContent = d.about; bio.hidden = false; }
    const rows = [];
    if (d.custom) rows.push(`<div class="ppl-cs">${custom(d.custom)}</div>`);
    if (s !== 'offline' && s !== 'online') rows.push(`<div class="ppl-ln">${dot(s)} ${ST[s][1]}</div>`);
    if (s === 'offline' && d.seen) rows.push(`<div class="ppl-ln ppl-dim">⚪ Был(а) в сети ${e(P.ago ? P.ago(d.seen) : date(d.seen))}</div>`);
    const srv = d.srv;
    if (srv) {
      const roles = Array.isArray(srv.roles) ? srv.roles : [];
      rows.push(`<div class="ppl-sec"><b>На этом сервере</b>${srv.nick ? `<div class="ppl-ln">Ник: <b class="ppl-snick">${e(srv.nick)}</b></div>` : ''}${srv.crole === 'owner' ? '<div class="ppl-ln">👑 Владелец</div>' : srv.crole === 'mod' ? '<div class="ppl-ln">🛡 Модератор</div>' : ''}${roles.length ? `<div class="ppl-roles">${roles.map(x => `<span class="ppl-role" style="--rc:${/^#[0-9a-f]{6}$/i.test(x.color || '') ? x.color : '#888888'}">${x.icon ? e(x.icon) + ' ' : ''}${e(x.name)}</span>`).join('')}</div>` : ''}${srv.joined ? `<div class="ppl-ln ppl-dim">На сервере с ${e(date(srv.joined))}</div>` : ''}</div>`);
    }
    if (d.since) rows.push(`<div class="ppl-ln ppl-dim">На сайте с ${e(date(d.since))}</div>`);
    if (Array.isArray(d.mutual) && d.mutual.length) rows.push(`<div class="ppl-sec"><b>Общие серверы — ${d.mutual.length}</b><div class="ppl-chips">${d.mutual.map(c => `<a class="ppl-chip" href="#/chat/c/${+c.id}" data-nomini="1">${e(c.icon || '🏰')} ${e(c.name)}</a>`).join('')}</div></div>`);
    if (+d.mfriends_n > 0 && Array.isArray(d.mfriends)) rows.push(`<div class="ppl-sec"><b>Общие друзья — ${+d.mfriends_n}</b><div class="ppl-chips">${d.mfriends.map(f => `<button type="button" class="ppl-chip" data-pc="u" data-u="${e(f.id)}" data-n="${e(f.nick)}">${e(f.nick)}</button>`).join('')}</div></div>`);
    const acts = [];
    if (d.self) { acts.push('<button type="button" class="d37m-btn" data-pc="status">😀 Мой статус</button>'); if (srv) acts.push('<button type="button" class="d37m-btn" data-pc="nick">✏️ Ник на сервере</button>'); }
    else if (logged) {
      acts.push(`<button type="button" class="d37m-btn" data-pc="ign">${d.ignored ? '👁 Не игнорировать' : '🙈 Игнорировать'}</button>`);
      const cur = DS()?.cur?.()?.srv;
      if (srv && cur && (cur.role === 'owner' || cur.role === 'mod' || cur.staff || (DS()?.x?.roleSync?.(cur.id)?.my & 2))) acts.push('<button type="button" class="d37m-btn" data-pc="nick">✏️ Ник на сервере</button>');
    }
    const box = document.createElement('div');
    box.className = 'ppl-c';
    box.innerHTML = rows.join('') + (acts.length ? `<div class="ppl-acts">${acts.join('')}</div>` : '') + '<div class="ppl-nk" hidden></div>';
    const anchor = card.querySelector('.d37m-acts');
    if (anchor) anchor.before(box); else (card.querySelector('.d37m-body') || card).appendChild(box);
    box.addEventListener('click', async ev => {
      const t = ev.target.closest('[data-pc]'); if (!t) return;
      const k = t.dataset.pc;
      if (k === 'status') { window.D37Mini?.close?.(); PL.openStatus(); return; }
      if (k === 'u' && UUID.test(t.dataset.u || '')) { window.D37Mini?.open?.(t.dataset.u, { nick: t.dataset.n, anchor: o.anchor || null }); return; }
      if (k === 'ign') {
        t.disabled = true; const res = await PL.ignore(uid, !d.ignored); t.disabled = false;
        if (res.ok) { d.ignored = !d.ignored; t.textContent = d.ignored ? '👁 Не игнорировать' : '🙈 Игнорировать'; P.toast?.(d.ignored ? '🙈 Его сообщения скрыты у тебя' : '👁 Снова видно', true); }
        else P.toast?.('⚠️ ' + res.err, false);
        return;
      }
      if (k === 'nick') {
        const nb = box.querySelector('.ppl-nk'); nb.hidden = false;
        nb.innerHTML = '<input class="ppl-in" maxlength="32" placeholder="Ник на этом сервере (пусто — как на сайте)" aria-label="Ник на сервере"><button type="button" class="d37m-btn ok" data-pc="nsave">Сохранить</button>';
        const inp = nb.querySelector('input'); inp.value = srv?.nick || ''; inp.focus();
        return;
      }
      if (k === 'nsave') {
        const inp = box.querySelector('.ppl-nk input');
        t.disabled = true;
        const res = await rpc('ds_nick_set', { p_scope: scope, p_uid: uid, p_nick: inp.value.trim() });
        t.disabled = false;
        if (res.data?.ok) { dropNicks(scope); box.querySelector('.ppl-nk').hidden = true; P.toast?.('✅ Ник на сервере сохранён', true); window.dispatchEvent(new Event('d37:blocks')); DS()?.reroute?.(); }
        else P.toast?.('⚠️ ' + why(res), false);
      }
    });
    o.place?.();
  };

  // ═══ 👥 Друзья: #/chat/friends[/online|all|pending|blocked|groups|add] ═══
  const TABS = [['online', 'В сети'], ['all', 'Все'], ['pending', 'Заявки'], ['blocked', 'Блок и игнор'], ['groups', 'Группы'], ['add', '＋ Добавить']];
  let FR = null;
  async function friendsData(fresh){
    if (FR && !fresh && Date.now() - FR.t < 15000) return FR;
    const r = await rpc('ds_friends');
    if (!r.data?.ok) return { err: why(r) };
    FR = Object.assign({ t: Date.now() }, r.data);
    await P.profiles([...FR.friends, ...FR.incoming, ...FR.outgoing, ...FR.blocked, ...FR.ignored].map(x => x.id).filter(x => UUID.test(x || '')));
    if (ME) { ME.incoming = FR.incoming.length; }
    return FR;
  }
  const subLine = f => {
    if (f.c && (f.c.e || f.c.t)) return custom(f.c);
    if (f.a && P.actText) return e(P.actText(P.actParse(f.a)));
    const s = stOk(f.s);
    if (s !== 'offline') return ST[s][1];
    return f.seen ? 'был(а) в сети ' + e(P.ago ? P.ago(f.seen) : date(f.seen)) : 'не в сети';
  };
  const ava = (id, nick, s) => `<i class="ppl-avw">${P.avatar(P.prof(id) || null, nick, 36)}${s ? dot(s) : ''}</i>`;
  const frow = (f, btns, s) => `<div class="ppl-fr" data-u="${e(f.id)}" data-n="${e(f.nick)}">${ava(f.id, f.nick, s)}<span class="ppl-fn"><b>${e(f.nick)}</b><small>${btns.sub != null ? btns.sub : subLine(f)}</small></span><span class="ppl-fb">${btns.b.map(([k, t, cls]) => `<button type="button" class="ppl-ib${cls ? ' ' + cls : ''}" data-fa="${k}" title="${e(t)}" aria-label="${e(t)}">${e(t.split(' ')[0])}</button>`).join('')}</span></div>`;
  async function friendsScreen(el, mode, rest){
    if (!P.me()) { P.login(el, 'Друзья и группы — для вошедших игроков.'); return; }
    const tab = TABS.some(t => t[0] === rest?.[0]) ? rest[0] : 'online';
    el.innerHTML = `<div class="ds-pane ppl-pane"><nav class="ppl-tabs">${TABS.map(([k, t]) => `<a class="ppl-tab${k === tab ? ' on' : ''}" href="${special(mode, 'friends/' + k)}">${t}${k === 'pending' && ME?.incoming ? ` <em class="ds-ment">${+ME.incoming}</em>` : ''}</a>`).join('')}</nav><div class="ppl-list"><div class="ds-dim">Загружаем…</div></div></div>`;
    const list = el.querySelector('.ppl-list');
    if (missing) { list.innerHTML = '<div class="ds-soon">🛠️ Друзья «как в Дискорде» появятся, когда сайт обновится. Друзья в телефоне 📱 уже работают.</div>'; return; }
    if (tab === 'groups') return groupsTab(list, mode);
    if (tab === 'add') return addTab(list);
    const F = await friendsData(true);
    if (!el.isConnected) return;
    if (F.err) { list.innerHTML = `<div class="ds-dim">⚠️ ${e(F.err)}</div>`; return; }
    const fb = [['dm', '✉ Написать'], ['call', '📞 Позвонить'], ['rm', '✕ Удалить из друзей', 'bad']];
    let html = '';
    if (tab === 'online' || tab === 'all') {
      const L = tab === 'online' ? F.friends.filter(f => stOk(f.s) !== 'offline') : F.friends;
      html = `<div class="ds-mg">${tab === 'online' ? 'В сети' : 'Все друзья'} — ${L.length}</div>` + (L.length ? L.map(f => frow(f, { b: fb }, stOk(f.s))).join('')
        : `<div class="ds-dim">${tab === 'online' ? 'Сейчас никого из друзей нет в сети.' : 'Пока нет друзей. Найди их во вкладке «＋ Добавить», в чате или в мире.'}</div>`);
    } else if (tab === 'pending') {
      html = `<div class="ds-mg">Входящие — ${F.incoming.length}</div>` + (F.incoming.map(f => frow(f, { sub: 'хочет дружить · ' + e(P.ago ? P.ago(f.at) : ''), b: [['acc', '✅ Принять', 'ok'], ['dec', '✕ Отклонить', 'bad']] })).join('') || '<div class="ds-dim">Нет заявок</div>')
        + `<div class="ds-mg">Отправленные — ${F.outgoing.length}</div>` + (F.outgoing.map(f => frow(f, { sub: 'ждёт ответа', b: [['cancel', '✕ Отменить заявку', 'bad']] })).join('') || '<div class="ds-dim">Нет отправленных</div>');
    } else if (tab === 'blocked') {
      html = `<div class="ds-mg">Заблокированные — ${F.blocked.length}</div><p class="ds-dim">Не напишут тебе, не позвонят, не позовут в друзья; их сообщения скрыты.</p>` + (F.blocked.map(f => frow(f, { sub: '🚫 заблокирован', b: [['unblock', '✅ Разблокировать']] })).join('') || '<div class="ds-dim">Никого</div>')
        + `<div class="ds-mg">Игнор — ${F.ignored.length}</div><p class="ds-dim">Мягче блока: они могут писать, но ты их сообщений не видишь (можно «показать»).</p>` + (F.ignored.map(f => frow(f, { sub: '🙈 игнорируешь', b: [['unign', '👁 Не игнорировать']] })).join('') || '<div class="ds-dim">Никого</div>');
    }
    list.innerHTML = html;
    list.onclick = ev => frClick(ev, el, mode, rest);
  }
  async function frClick(ev, el, mode, rest){
    const row = ev.target.closest('.ppl-fr'); if (!row) return;
    const uid = row.dataset.u, nick = row.dataset.n || 'игрок', b = ev.target.closest('[data-fa]');
    if (!UUID.test(uid || '')) return;
    if (!b) { window.D37Mini?.open?.(uid, { nick, anchor: row }); return; }
    const k = b.dataset.fa;
    if (k === 'dm') { P.open?.('msgs/' + uid); return; }
    if (k === 'call') { try { await P.need('calls'); window.D37Calls?.call(uid, nick); } catch (er) {} return; }
    if (k === 'rm' && !confirm(`Удалить ${nick} из друзей?`)) return;
    b.disabled = true;
    let res;
    if (k === 'unblock') { try { await P.need('mv'); } catch (er) {} res = window.MsgView?.block ? await window.MsgView.block(uid, false) : { ok: false, err: 'не загрузилось' }; }
    else if (k === 'unign') res = await PL.ignore(uid, false);
    else { const r = await rpc('ds_friend', { p_uid: uid, p_act: { rm: 'remove', acc: 'accept', dec: 'decline', cancel: 'cancel' }[k] || 'bad' }); res = r.data?.ok ? { ok: true } : { ok: false, err: why(r, 'friend') }; }
    if (!res.ok) { b.disabled = false; P.toast?.('⚠️ ' + (res.err || 'не получилось'), false); return; }
    P.dropFriends?.(); FR = null; loadMe(true);
    friendsScreen(el, mode, rest);
  }
  function addTab(list){
    list.innerHTML = `<div class="ds-mg">Добавить в друзья</div><p class="ds-dim">Найди игрока по нику. Детям дружить можно только с теми, кому меньше 18 и кто указал возраст.</p>
      <div class="ppl-row"><input type="search" class="ppl-in" data-f="q" maxlength="24" placeholder="Ник игрока" aria-label="Ник игрока"></div><div class="ppl-found"></div>`;
    const qi = list.querySelector('[data-f="q"]'), out = list.querySelector('.ppl-found');
    let t = 0, seq = 0;
    qi.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => {
      const s = qi.value.trim().replace(/[%_,()*\\]/g, ''); const my = ++seq;
      if (s.length < 2 || typeof sbProfiles !== 'function') { out.innerHTML = ''; return; }
      let data = [];
      try { data = (await (await sbProfiles()).select('id, nick, role, avatar_url').ilike('nick', s + '%').limit(8)).data || []; } catch (er) {}
      if (my !== seq || !list.isConnected) return;
      data = data.filter(p => UUID.test(p.id || '') && p.id !== P.me());
      out.innerHTML = data.length ? data.map(p => frow({ id: p.id, nick: p.nick || 'игрок' }, { sub: '', b: [['add', '➕ В друзья', 'ok']] })).join('') : '<div class="ds-dim">Никого не нашли</div>';
    }, 350); });
    out.onclick = async ev => {
      const row = ev.target.closest('.ppl-fr'), b = ev.target.closest('[data-fa="add"]'); if (!row) return;
      if (!b) { window.D37Mini?.open?.(row.dataset.u, { nick: row.dataset.n, anchor: row }); return; }
      b.disabled = true;
      const r = await rpc('ds_friend', { p_uid: row.dataset.u, p_act: 'add' });
      const sm = row.querySelector('small');
      if (r.data?.ok) { sm.textContent = r.data.state === 'friends' ? '✅ Теперь друзья' : '⏳ Заявка отправлена'; P.dropFriends?.(); FR = null; }
      else { b.disabled = false; sm.textContent = '⚠️ ' + why(r, 'friend'); }
    };
    qi.focus?.();
  }

  // ═══ Группы ЛС (до 10, только друзья) ═══
  const gName = g => g.name || (g.members || []).filter(m => m.id !== P.me()).map(m => m.nick).slice(0, 4).join(', ') || 'Группа';
  async function groupsTab(list, mode){
    const u9 = !!window.D37Age?.u9?.();
    list.innerHTML = `<div class="ds-mg">Группы — до 10 человек, только друзья</div>${u9 ? `<p class="ds-dim">${e(window.D37Age.kidMsg('u9'))}</p>` : '<button type="button" class="ds-btn" data-g="new">＋ Новая группа</button>'}<div class="ppl-glist"><div class="ds-dim">Загружаем…</div></div><div class="ppl-gnew" hidden></div>`;
    const r = await rpc('gdm_list');
    if (!list.isConnected) return;
    const gl = list.querySelector('.ppl-glist');
    if (!r.data?.ok) { gl.innerHTML = `<div class="ds-dim">⚠️ ${e(why(r))}</div>`; return; }
    const L = Array.isArray(r.data.list) ? r.data.list : [];
    const MV = window.MsgView;
    gl.innerHTML = L.length ? L.map(g => `<a class="ppl-fr ppl-g" href="${special(mode, 'gdm/' + (+g.id))}"><i class="ppl-avw ppl-gic">${e(g.icon || '👥')}</i><span class="ppl-fn"><b>${e(gName(g))}</b><small>${(g.members || []).length} ${P.plural((g.members || []).length, 'участник', 'участника', 'участников')}</small></span>${MV && +g.last_id > MV.lastRead('g:' + g.id) ? '<em class="ppl-un"></em>' : ''}</a>`).join('')
      : '<div class="ds-dim">Групп пока нет. Позови друзей в общую переписку — кнопка «＋ Новая группа».</div>';
    const nb = list.querySelector('[data-g="new"]');
    if (nb) nb.onclick = () => newGroupForm(list.querySelector('.ppl-gnew'), mode);
  }
  async function newGroupForm(box, mode){
    box.hidden = false; box.innerHTML = '<div class="ds-dim">Загружаем друзей…</div>';
    const F = await friendsData(false);
    if (F.err) { box.innerHTML = `<div class="ds-dim">⚠️ ${e(F.err)}</div>`; return; }
    box.innerHTML = `<label class="ppl-lbl">Название (можно пусто)</label><input class="ppl-in" data-f="gn" maxlength="40" placeholder="Например: Клан" aria-label="Название группы">
      <label class="ppl-lbl">Кого позвать (до 9 друзей)</label><div class="ppl-pick">${F.friends.length ? F.friends.map(f => `<label class="ppl-pk"><input type="checkbox" value="${e(f.id)}">${ava(f.id, f.nick)}<span>${e(f.nick)}</span></label>`).join('') : '<div class="ds-dim">Сначала добавь друзей</div>'}</div>
      <div class="ppl-err" hidden></div><div class="ppl-row ppl-end"><button type="button" class="ds-btn" data-g="create">Создать группу</button></div>`;
    box.querySelector('[data-g="create"]').onclick = async ev => {
      const ids = [...box.querySelectorAll('.ppl-pick input:checked')].map(x => x.value).filter(x => UUID.test(x));
      const er = box.querySelector('.ppl-err');
      if (ids.length > 9) { er.hidden = false; er.textContent = '⚠️ ' + REASON.full; return; }
      ev.target.disabled = true;
      const r = await rpc('gdm_create', { p_ids: ids, p_name: box.querySelector('[data-f="gn"]').value.trim() });
      ev.target.disabled = false;
      if (r.data?.ok && r.data.g) { const h = special(mode, 'gdm/' + (+r.data.g.id)); if (window.D37Route?.go) D37Route.go(h); else location.hash = h; return; }
      const who = r.data?.who && F.friends.find(f => f.id === r.data.who);
      er.hidden = false; er.textContent = '⚠️ ' + (who ? who.nick + ': ' : '') + why(r);
    };
  }
  // лента группы — MsgView с адаптером; данные — через API (тест подменяет)
  const API = PL._api = {
    async hist(gid, before){
      const s = sbc(); if (!s) return { data: [], error: { message: 'нет связи' } };
      let qy = s.from('gdm_messages').select('*').eq('group_id', gid).eq('deleted', false).order('id', { ascending: false }).limit(50);
      if (before) qy = qy.lt('id', before);
      return qy;
    },
    async byIds(ids){ const s = sbc(); if (!s) return { data: [] }; return s.from('gdm_messages').select('*').in('id', ids); },
    async search(gid, q){ const s = sbc(); if (!s) return { data: [] }; return s.from('gdm_messages').select('*').eq('group_id', gid).eq('deleted', false).ilike('text', `%${q}%`).order('id', { ascending: false }).limit(40); },
    sub(gid, fn){
      const s = sbc(); if (!s) return () => {};
      const ch = s.channel('gdm-' + gid)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'gdm_messages', filter: 'group_id=eq.' + gid }, p => fn('ins', p.new))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'gdm_messages', filter: 'group_id=eq.' + gid }, p => fn('upd', p.new))
        .subscribe();
      return () => { try { s.removeChannel(ch); } catch (er) {} };
    },
  };
  function gdmAdapter(g){
    const me = P.me(), gid = +g.id, key = 'g:' + gid;
    const toM = r => ({ id: r.id, uid: r.user_id || null, nick: (r.user_id && P.prof(r.user_id)?.nick) || r.nick || 'игрок', text: r.deleted ? '' : String(r.text || ''), at: r.created_at,
      reply: r.reply_to || null, edited: r.edited_at || null, deleted: !!r.deleted, mine: !!me && r.user_id === me });
    return {
      key, title: gName(g), maxLen: 1000, placeholder: `Написать в «${gName(g).slice(0, 30)}»…`,
      startText: `Начало группы «${gName(g)}». Здесь только друзья. Не отправляй адрес, телефон и пароли.`, emptyText: 'Напиши первым! 👋',
      caps: { reply: true, edit: true, del: true, react: false, pin: false, report: false, typing: false, search: true, stickers: false },
      async load({ before }){
        const { data, error } = await API.hist(gid, before);
        if (error) return { list: [], err: error, errText: P.err(error) };
        const rows = data || [];
        await P.profiles(rows.map(r => r.user_id).filter(Boolean));
        const list = rows.map(toM).reverse();
        if (list.length && window.MsgView) window.MsgView.markRead(key, list[list.length - 1].id);
        return { list, more: rows.length === 50 };
      },
      sub(fn){ return API.sub(gid, (t, r) => { const m = toM(r); fn({ t, m }); if (t === 'ins' && !document.hidden) window.MsgView?.markRead(key, m.id); }); },
      async send(text, reply){
        const r = await rpc('gdm_send', { p_group: gid, p_text: text, p_reply: typeof reply === 'number' ? reply : null });
        return r.data?.ok ? { ok: true, m: toM(r.data.m) } : { ok: false, err: why(r) };
      },
      edit: async (m, text) => { const r = await rpc('gdm_edit', { p_id: m.id, p_text: text }); return r.data?.ok ? { ok: true } : { ok: false, err: why(r) }; },
      del: async m => { const r = await rpc('gdm_delete', { p_id: m.id }); return r.data?.ok ? { ok: true } : { ok: false, err: why(r) }; },
      canDel: m => !!me && (m.uid === me || g.owner === me),
      async fetch(ids){ const { data } = await API.byIds(ids.filter(x => typeof x === 'number')); return (data || []).map(toM); },
      async search(q){ const s = q.replace(/[%_,()]/g, ' ').trim(); if (!s) return []; const { data } = await API.search(gid, s); return (data || []).map(toM); },
      async members(q){ const s = q.toLowerCase(); return (g.members || []).filter(m => m.id !== me && (m.nick || '').toLowerCase().startsWith(s)).map(m => ({ id: m.id, nick: m.nick })).slice(0, 7); },
      state: () => (!me ? { mode: 'login', note: 'Войди, чтобы писать' } : window.D37Age?.u9?.() ? { mode: 'readonly', note: window.D37Age.kidMsg('u9') } : { mode: 'write' }),
      me: () => ({ uid: me, nick: P.myNick() }),
    };
  }
  let gv = null;
  const dropGv = () => { if (gv) { try { gv.destroy(); } catch (er) {} gv = null; } };
  window.addEventListener('d37:route', () => setTimeout(() => { if (gv && !gv.host?.isConnected) dropGv(); }, 0));
  async function gdmScreen(el, mode, rest){
    if (!P.me()) { P.login(el, 'Группы — для вошедших игроков.'); return; }
    const gid = /^\d+$/.test(rest?.[0] || '') ? +rest[0] : 0;
    if (!gid) { friendsScreen(el, mode, ['groups']); return; }
    dropGv();
    const host = mode === 'page' && el.parentElement ? el.parentElement : el;
    host.innerHTML = '<div class="ppl-gdm"><div class="ppl-ghd"><span class="ds-dim">Загружаем группу…</span></div><div class="ppl-gfeed"></div></div>';
    const r = await rpc('gdm_list');
    if (!host.isConnected) return;
    const g = r.data?.ok && Array.isArray(r.data.list) ? r.data.list.find(x => +x.id === gid) : null;
    const hd = host.querySelector('.ppl-ghd');
    if (!g) { hd.innerHTML = `<span>⚠️ ${e(r.data?.ok ? 'Группа не найдена или тебя в ней нет' : why(r))}</span> <a class="ds-btn ghost" href="${special(mode, 'friends/groups')}">← Группы</a>`; return; }
    await P.profiles((g.members || []).map(m => m.id));
    if (!host.isConnected) return;
    const paintHd = () => {
      hd.innerHTML = `<a class="ds-hb" href="${special(mode, 'friends/groups')}" title="Все группы" aria-label="Все группы">‹</a><span class="ppl-gic">${e(g.icon || '👥')}</span><b class="ppl-gt">${e(gName(g))}</b>
        <span class="ppl-gm">${(g.members || []).slice(0, 10).map(m => `<button type="button" class="ppl-gma" data-gu="${e(m.id)}" data-n="${e(m.nick)}" title="${e(m.nick)}">${P.avatar(P.prof(m.id) || null, m.nick, 24)}</button>`).join('')}</span>
        <span class="ppl-gtools"><button type="button" class="ds-hb" data-ga="add" title="Позвать друга" aria-label="Позвать друга">＋</button><button type="button" class="ds-hb" data-ga="ren" title="Название и значок" aria-label="Переименовать">✏️</button><button type="button" class="ds-hb" data-ga="leave" title="Выйти из группы" aria-label="Выйти">🚪</button></span>`;
    };
    paintHd();
    const feed = host.querySelector('.ppl-gfeed');
    feed.innerHTML = '<div class="ds-mv"></div>';
    gv = window.MsgView.mount(feed.firstChild, { compact: mode === 'phone' });
    gv.host = host;
    gv.setAdapter(gdmAdapter(g));
    hd.onclick = async ev => {
      const m = ev.target.closest('[data-gu]');
      if (m) { window.D37Mini?.open?.(m.dataset.gu, { nick: m.dataset.n, anchor: m }); return; }
      const b = ev.target.closest('[data-ga]'); if (!b) return;
      const k = b.dataset.ga;
      if (k === 'leave') {
        if (!confirm('Выйти из группы? Вернуть сможет только друг из группы.')) return;
        const res = await rpc('gdm_leave', { p_group: gid, p_uid: null });
        if (res.data?.ok) { dropGv(); const h = special(mode, 'friends/groups'); if (window.D37Route?.go) D37Route.go(h); else location.hash = h; } else P.toast?.('⚠️ ' + why(res), false);
      } else if (k === 'ren') {
        const name = prompt('Название группы (до 40 знаков, пусто — по именам):', g.name || ''); if (name == null) return;
        const res = await rpc('gdm_rename', { p_group: gid, p_name: name.trim().slice(0, 40), p_icon: null });
        if (res.data?.ok && res.data.g) { Object.assign(g, res.data.g); paintHd(); } else P.toast?.('⚠️ ' + why(res), false);
      } else if (k === 'add') {
        const F = await friendsData(false); if (F.err) { P.toast?.('⚠️ ' + F.err, false); return; }
        const inG = new Set((g.members || []).map(x => x.id)), cand = F.friends.filter(f => !inG.has(f.id));
        if (!cand.length) { P.toast?.('Все друзья уже здесь', true); return; }
        const pick = document.createElement('div'); pick.className = 'ppl-gpick';
        pick.innerHTML = cand.map(f => `<button type="button" class="ppl-pk" data-pu="${e(f.id)}">${ava(f.id, f.nick)}<span>${e(f.nick)}</span></button>`).join('') + '<button type="button" class="ds-btn ghost" data-pu="">Отмена</button>';
        hd.after(pick);
        pick.onclick = async ev2 => {
          const t = ev2.target.closest('[data-pu]'); if (!t) return;
          if (!t.dataset.pu) { pick.remove(); return; }
          const res = await rpc('gdm_add', { p_group: gid, p_uid: t.dataset.pu });
          pick.remove();
          if (res.data?.ok && res.data.g) { Object.assign(g, res.data.g); paintHd(); P.toast?.('✅ Позвали в группу', true); } else P.toast?.('⚠️ ' + why(res), false);
        };
      }
    };
  }

  // ═══ «Сейчас играет»: платформа D37 (/hub/play) — тоже занятие (phone.js P.activity / P.actText) ═══
  if (P.activity && !P._pplAct) {
    P._pplAct = 1;
    const oa = P.activity, ot = P.actText;
    P.activity = () => {
      const a = oa();
      try { if (!a.g && !a.w && !a.s && /^#\/hub\/(play|war|creative)/.test(window.D37Route?.hash?.() || '')) { a.g = 'hub'; delete a.v; delete a.ch; } } catch (er) {}
      return a;
    };
    P.actText = a => (a && a.g === 'hub' && !a.w && !a.s ? '🪐 Играет в D37' + (a.c ? ' · 📞 в звонке' : '') : ot(a));
  }

  // ═══ Регистрация в DS.x (community.js / community2.js) ═══
  const DSX = (window.D37DS = window.D37DS || {});
  DSX.x = DSX.x || {}; DSX.x.special = DSX.x.special || {};
  DSX.x.membersDecor = (box, srv) => { membersDecor(box, srv).catch(er => console.warn('ds-people', er)); };
  DSX.x.meBtn = meBtn;
  DSX.x.railTop = railTop;
  DSX.x.special.friends = { title: '👥 Друзья', render: friendsScreen };
  DSX.x.special.gdm = { title: '👥 Группа', render: gdmScreen };
  document.addEventListener('click', ev => { const t = ev.target.closest?.('[data-ppl="status"]'); if (t) { ev.preventDefault(); PL.openStatus(); } });

  // ═══ Старт и вход / выход ═══
  const start = () => { ME = null; FR = null; NK.clear(); MC.clear(); ignored = new Set(); if (P.me()) { loadMe(true); loadIgnores(); } else setInv(false); };
  window.addEventListener('d37:auth', start);
  start();
  PL._test = { REASON, why, stOk, scopeOfA, scopeOfSrv, meta, membersDecor, railTop, meBtn, gdmAdapter, friendsScreen, gdmScreen, NK, setMissing: v => { missing = !!v; } };
})();
