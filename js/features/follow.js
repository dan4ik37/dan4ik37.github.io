// ═══════════════════════════════════════
//  🔔 «СЛЕДИТЬ» (T-170, владелец 19.11: «подписаться на человека или автора игр и видеть в ленте его новое»)
// ═══════════════════════════════════════
// Одна подписка на человека на весь сайт — та же таблица, что у «Подписок» форума (forum_follows): подписался в профиле — его статьи
// видны и во вкладке форума «👤 Подписки», и наоборот.
//   D37Follow.info(uid) → { on, notify, followers, why, p18 }   — слежу ли, число подписчиков, почему нельзя
//   D37Follow.set(uid, on, notify?) → { ok, msg }               — следить / не следить, колокольчик
//   D37Follow.list() → [{ id, nick, notify }] · D37Follow.feed() → [{ kind, id, title, nick, author, at, icon, descr }]
//   D37Follow.profile(uid, isOwn, profile)                      — кнопка и число в шапке профиля; на своём — вкладка «🔔 Подписки»
// Сервер: community.sql ч. 18 (follow_set / follow_info / follow_list / follow_feed: правила как у друзей — возраст, блокировка,
// скрытый профиль; 🔔 о новом — только с включённым колокольчиком). Пока ч. 18 не выполнена, работает главное — на уже выполненном
// forum.sql (forum_follow): «Следить / Не следить» и лента (статьи — forum_feed «follow», игры — открытые каталоги); числа подписчиков
// и колокольчика нет. Возраст без ч. 18 проверяет сайт (D37Age.friendBlock — то же правило, что у дружбы).
// Чужой текст (ники, названия) — только textContent. Откат — FOLLOW_ON = false (js/core/config.js).
(() => {
  'use strict';
  const ON = (() => { try { return typeof FOLLOW_ON === 'undefined' || !!FOLLOW_ON; } catch (e) { return true; } })();
  if (!ON || window.D37Follow) return;
  const F = window.D37Follow = {};
  const me = () => (typeof currentUser !== 'undefined' && currentUser?.id) || null;
  const sb = () => (typeof sbClient !== 'undefined' && sbClient) || null;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const p18 = () => (window.D37Mini?.p18 ? window.D37Mini.p18() : Promise.resolve(false));
  const kid = k => (window.D37Age?.kidMsg ? window.D37Age.kidMsg(k) : 'Недоступно по возрасту');
  const WHY = () => ({ age: kid('agefriend'), blocked: 'Вы заблокированы друг у друга', hidden: 'Профиль скрыт — следить нельзя', limit: 'Слишком много подписок — сначала убери лишние',
    own: 'За собой следить нельзя', auth: 'Нужно войти', not_found: 'Такого человека нет' });
  const plural = (n, a, b, c) => (n % 10 === 1 && n % 100 !== 11 ? a : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? b : c);
  const rpc = async (fn, args) => { try { const r = await sb().rpc(fn, args || {}); return r.error ? null : r.data; } catch (e) { return null; } };

  // ═══ Данные ═══
  const IC = new Map();   // uid → { v, t, me }
  F.drop = uid => { if (uid) IC.delete(uid); else IC.clear(); };
  F.info = async (uid, fresh) => {
    if (!UUID.test(String(uid || '')) || !sb()) return null;
    const c = IC.get(uid);
    if (c && !fresh && c.me === me() && Date.now() - c.t < 30e3) return c.v;
    let v = null;
    if (await p18()) {
      const d = await rpc('follow_info', { p_user: uid });
      if (d?.ok) v = { on: !!d.following, notify: !!d.notify, followers: d.followers == null ? null : +d.followers, mine: d.mine == null ? null : +d.mine,
        why: d.following || d.can || !me() ? null : (WHY()[d.why] || 'Сейчас нельзя'), p18: true };
    }
    if (!v) {   // без ч. 18: своя строка подписки (её отдаёт forum.sql) и правило возраста на сайте
      v = { on: false, notify: false, followers: null, mine: null, why: null, p18: false };
      if (me() && uid !== me()) {
        try { const { data } = await sb().from('forum_follows').select('author').eq('follower', me()).eq('author', uid).limit(1); v.on = Array.isArray(data) && data.length > 0; } catch (e) {}
        if (!v.on) { try { if (await window.D37Age?.friendBlock?.(uid)) v.why = kid('agefriend'); } catch (e) {} }
      }
    }
    IC.set(uid, { v, t: Date.now(), me: me() }); if (IC.size > 200) IC.delete(IC.keys().next().value);
    return v;
  };
  F.set = async (uid, on, notify) => {
    if (!me()) { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); return { ok: false, msg: 'Нужно войти' }; }
    if (!UUID.test(String(uid || '')) || uid === me() || !sb()) return { ok: false, msg: 'Не получилось' };
    let d = null;
    if (await p18()) d = await rpc('follow_set', { p_user: uid, p_on: !!on, p_notify: notify === undefined ? null : !!notify });
    else {
      if (on) { let kp = null; try { kp = await window.D37Age?.friendBlock?.(uid); } catch (e) { kp = true; } if (kp) return { ok: false, msg: kid('agefriend') }; }
      d = await rpc('forum_follow', { p_author: uid, p_on: !!on });
    }
    IC.delete(uid); LC = null; FC = null;
    if (!d) return { ok: false, msg: 'Нет связи с сервером — попробуй ещё раз' };
    if (!d.ok) return { ok: false, msg: WHY()[d.reason] || 'Не получилось' };
    try { window.dispatchEvent(new CustomEvent('d37:follow', { detail: { uid, on: !!d.follow } })); } catch (e) {}
    return { ok: true, on: !!d.follow, notify: !!d.notify, followers: d.followers == null ? null : +d.followers };
  };
  let LC = null, FC = null;   // кэш списка и ленты (до изменения подписок, не дольше минуты)
  F.list = async () => {
    if (!me() || !sb()) return [];
    if (LC && LC.me === me() && Date.now() - LC.t < 60e3) return LC.v;
    let v = [];
    if (await p18()) { const d = await rpc('follow_list'); v = Array.isArray(d?.list) ? d.list.map(x => ({ id: x.id, nick: String(x.nick || 'игрок'), notify: !!x.notify })) : []; }
    else {
      try {
        const { data } = await sb().from('forum_follows').select('author, created_at').eq('follower', me()).order('created_at', { ascending: false }).limit(200);
        const ids = (data || []).map(x => x.author).filter(x => UUID.test(x));
        const nick = new Map();
        if (ids.length && typeof sbProfiles === 'function') { const r = await (await sbProfiles()).select('id, nick').in('id', ids); (r.data || []).forEach(p => nick.set(p.id, p.nick)); }
        v = ids.map(id => ({ id, nick: String(nick.get(id) || 'игрок'), notify: false }));
      } catch (e) { v = []; }
    }
    LC = { v, t: Date.now(), me: me() };
    return v;
  };
  const GAME_MAX = () => { let g = 'unknown'; try { g = window.D37Age ? window.D37Age.group() : 'unknown'; } catch (e) {} return g === 'teen16' || g === 'adult' ? 16 : 12; };
  F.feed = async () => {
    if (!me() || !sb()) return [];
    if (FC && FC.me === me() && Date.now() - FC.t < 60e3) return FC.v;
    let v = [];
    if (await p18()) { const d = await rpc('follow_feed', { p_limit: 30 }); v = Array.isArray(d?.list) ? d.list : []; }
    else {
      // без ч. 18: статьи — лента форума «подписки» (правила возраста — на сервере), игры — открытые каталоги по авторам
      const L = await F.list(), ids = L.map(x => x.id), nick = new Map(L.map(x => [x.id, x.nick]));
      if (ids.length) {
        const th = await rpc('forum_feed', { p_sort: 'follow', p_tag: null, p_author: null, p_offset: 0, p_limit: 20 });
        (Array.isArray(th) ? th : []).forEach(t => v.push({ kind: 'thread', id: String(t.id), title: t.title, author: t.author_id, nick: t.nick, at: t.at, icon: '', descr: t.excerpt || '' }));
        const since = new Date(Date.now() - 90 * 864e5).toISOString(), max = GAME_MAX();
        const pull = async (table, cols, kindOf) => {
          try {
            const { data } = await sb().from(table).select(cols).eq('status', 'public').in('author', ids.slice(0, 100)).gte('updated_at', since).order('updated_at', { ascending: false }).limit(20);
            (data || []).filter(g => g.age_rating == null || +g.age_rating <= max).forEach(g => v.push({ kind: kindOf(g), id: String(g.id), title: g.title, author: g.author, nick: nick.get(g.author) || 'игрок', at: g.updated_at, icon: g.icon || '🎮', descr: g.descr || '' }));
          } catch (e) {}
        };
        await Promise.all([pull('ugc_games', 'id,title,icon,kind,descr,author,updated_at,age_rating', g => (g.kind === 'place' ? 'place' : 'game')), pull('unity_games', 'id,title,icon,descr,author,updated_at,age_rating', () => 'unity')]);
        v.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)); v = v.slice(0, 30);
      }
    }
    FC = { v, t: Date.now(), me: me() };
    return v;
  };
  const hrefOf = x => (x.kind === 'thread' ? '/forum/' + encodeURIComponent(x.id) : x.kind === 'unity' ? '#/games/unity/play/' + encodeURIComponent(x.id)
    : x.kind === 'place' ? '#/games/studio3d/play/' + encodeURIComponent(x.id) : '#/games/studio/play/' + encodeURIComponent(x.id));
  const KIND = { thread: ['📰', 'статья'], game: ['🎮', 'игра'], place: ['🧱', '3D-мир'], unity: ['🕹️', 'игра'] };
  const ago = at => { const s = Math.max(0, (Date.now() - Date.parse(at)) / 1000); if (!Number.isFinite(s)) return ''; if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' мин назад'; if (s < 86400) return Math.round(s / 3600) + ' ч назад'; const d = Math.round(s / 86400); return d + ' ' + plural(d, 'день', 'дня', 'дней') + ' назад'; };
  F._test = { hrefOf, plural, ago, WHY };

  // ═══ Профиль: кнопка «Следить» и число подписчиков в шапке; на своём — вкладка «🔔 Подписки» ═══
  const h = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
  let seq = 0, feedSeq = 0;
  // Профиль начал открываться (profile.js зовёт сразу, до своих запросов): убрать кнопку, число и ленту прошлого человека —
  // иначе, пока грузится новый профиль, на экране кнопка «✓ Слежу» прошлого, и нажатие отписало бы от него
  F.reset = () => {
    seq++; feedSeq++;
    document.getElementById('profileAddFriendWrap')?.querySelectorAll('.fol-btn, .fol-bell').forEach(x => x.remove());
    const folEl = document.getElementById('pfwFol'); if (folEl) { folEl.hidden = true; folEl.textContent = ''; }
    const feed = document.getElementById('pfwFeed'); if (feed) { feed.hidden = true; feed.textContent = ''; }
  };
  F.profile = async (uid, isOwn, o = {}) => {
    F.reset();
    const id = seq, live = () => id === seq && (typeof profileViewedId === 'undefined' || profileViewedId === uid);
    const folEl = document.getElementById('pfwFol'), wrap = document.getElementById('profileAddFriendWrap');
    const feedBox = feedCard();
    if (feedBox) { feedBox.hidden = true; feedBox.textContent = ''; }
    const info = await F.info(uid, true);
    if (!live() || !info) return;
    const paintCount = n => {
      if (!folEl) return;
      folEl.textContent = '';
      if (n == null && !(isOwn && info.mine != null)) { folEl.hidden = true; return; }
      if (n != null) { folEl.append('🔔 ', h('b', '', String(n)), ' ' + plural(n, 'подписчик', 'подписчика', 'подписчиков')); }
      if (isOwn && info.mine != null) folEl.append((n != null ? ' · ' : '') + 'слежу за ', h('b', '', String(info.mine)));
      folEl.hidden = false;
    };
    paintCount(info.followers);
    if (!isOwn && me() && wrap && !(o.hidden && !info.on)) {
      const more = wrap.querySelector('.pf-more');
      const btn = h('button', 'pf-btn fol-btn'); btn.type = 'button';
      const bell = h('button', 'pf-btn pf-btn-ghost fol-bell'); bell.type = 'button';
      const note = h('span', 'pf-fnote fol-btn');
      const paint = () => {
        btn.className = 'pf-btn fol-btn ' + (info.on ? 'pf-btn-ghost' : 'pf-btn-primary');
        btn.textContent = info.on ? '✓ Слежу' : '🔔 Следить';
        btn.title = info.on ? 'Нажми, чтобы перестать следить' : 'Его новые статьи и игры — в твоём профиле, вкладка «Подписки»';
        btn.setAttribute('aria-pressed', String(!!info.on));
        bell.hidden = !(info.on && info.p18);
        bell.textContent = info.notify ? '🔔' : '🔕';
        bell.title = info.notify ? 'Уведомления о новом включены — нажми, чтобы выключить' : 'Включить уведомления о его новых статьях и играх';
        bell.setAttribute('aria-label', bell.title); bell.setAttribute('aria-pressed', String(!!info.notify));
      };
      if (info.why && !info.on) { note.textContent = '🔔 ' + info.why; (more ? more.before(note) : wrap.appendChild(note)); }
      else {
        paint();
        if (more) more.before(btn, bell); else wrap.append(btn, bell);
        btn.onclick = async () => {
          if (!live()) return;   // кнопка от прошлого профиля — не действует
          btn.disabled = true;
          const r = await F.set(uid, !info.on);
          btn.disabled = false;
          if (!live()) return;
          if (!r.ok) { if (typeof xpToast === 'function') xpToast('⚠️ ' + r.msg); return; }
          info.on = r.on; info.notify = r.notify; if (r.followers != null) { info.followers = r.followers; paintCount(r.followers); }
          paint();
          if (typeof xpToast === 'function') xpToast(r.on ? '🔔 Следишь — новое увидишь в своём профиле, вкладка «Подписки»' : '🔕 Больше не следишь');
        };
        bell.onclick = async () => {
          if (!live()) return;
          bell.disabled = true;
          const r = await F.set(uid, true, !info.notify);
          bell.disabled = false;
          if (!live() || !r.ok) return;
          info.notify = r.notify; paint();
          if (typeof xpToast === 'function') xpToast(r.notify ? '🔔 Будут приходить уведомления о его новых статьях и играх' : '🔕 Уведомления выключены — новое останется в ленте');
        };
      }
      if (wrap.style.display === 'none') wrap.style.display = '';
    }
    if (isOwn && feedBox) renderFeed(feedBox, live);
  };
  // карточка ленты: во вкладке «🔔 Подписки» (profile.js pfwLayout); в старой раскладке — в конце главной колонки
  function feedCard(){
    let el = document.getElementById('pfwFeed');
    if (!el) { const host = document.querySelector('#profileContent .pf2-main') || document.getElementById('profileContent'); if (!host) return null; el = h('div', 'pf-card pf-card-tw'); el.id = 'pfwFeed'; el.hidden = true; host.appendChild(el); }
    return el;
  }
  async function renderFeed(box, live){
    const token = ++feedSeq;   // два быстрых нажатия «✕» запускают две перерисовки — дорисовывает только последняя
    box.textContent = '';
    box.append(h('div', 'pf-kicker fol-k', '🔔 Новое у тех, за кем ты следишь'));
    const list = h('div', 'fol-feed'); list.append(h('div', 'fol-dim', 'Загружаем…'));
    box.append(list);
    box.hidden = false;
    const [feed, who] = await Promise.all([F.feed(), F.list()]);
    if (!live() || token !== feedSeq) return;
    list.textContent = '';
    if (!who.length) list.append(h('div', 'pfw-empty', 'Ты пока ни за кем не следишь. Открой профиль игрока или автора игры и нажми «🔔 Следить» — его новые статьи и игры появятся здесь.'));
    else if (!feed.length) list.append(h('div', 'pfw-empty', 'Пока ничего нового. Когда те, за кем ты следишь, выложат статью или игру — она появится здесь.'));
    for (const x of feed) {
      const k = KIND[x.kind] || KIND.game;
      const a = h('a', 'fol-item'); a.href = hrefOf(x); a.dataset.nomini = '1';
      const ic = h('span', 'fol-ic', x.kind === 'thread' ? k[0] : String(x.icon || k[0]).slice(0, 4));
      const body = h('span', 'fol-body');
      body.append(h('b', '', String(x.title || 'без названия').slice(0, 80)), h('small', '', `${k[1]} · ${String(x.nick || 'игрок').slice(0, 40)} · ${ago(x.at)}`));
      if (x.descr) body.append(h('span', 'fol-d', String(x.descr).slice(0, 160)));
      a.append(ic, body);
      list.append(a);
    }
    if (who.length) {
      box.append(h('div', 'pf-kicker fol-k', `Слежу за: ${who.length}`));
      const ppl = h('div', 'fol-ppl');
      for (const p of who.slice(0, 60)) {
        const row = h('span', 'fol-p');
        const a = h('a', 'fol-pn', p.nick.slice(0, 40)); a.href = '#/profile/' + p.id;
        const x = h('button', 'fol-px', '✕'); x.type = 'button'; x.title = 'Не следить'; x.setAttribute('aria-label', 'Не следить за ' + p.nick.slice(0, 40));
        x.onclick = async () => { x.disabled = true; const r = await F.set(p.id, false); if (r.ok) { row.remove(); if (live()) renderFeed(box, live); } else x.disabled = false; };
        row.append(a, x); ppl.append(row);
      }
      box.append(ppl);
    }
  }
  window.addEventListener('d37:auth', () => { IC.clear(); LC = null; FC = null; });
})();
