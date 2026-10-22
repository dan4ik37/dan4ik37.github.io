// ═══════════════════════════════════════
//  МИНИ-КАРТОЧКА ИГРОКА (T-086) — одна на весь сайт: чат и сообщества (msgview.js V.userCard), участники сообществ, друзья,
//  гости профиля, тиммейты, форум и идеи, топы, «Сообщество» на главной и любая ссылка на профиль (#/profile/<id>, /profile/<id>)
// ═══════════════════════════════════════
// D37Mini.open(uid, { nick, anchor, actions, guest }) → Promise (всё догрузилось) · D37Mini.close() · D37Mini.isOpen()
//   anchor — элемент, у которого открыть (компьютер: всплывает рядом и целиком в экране; телефон: лист снизу, «Назад» закрывает)
//   actions — крючки ленты сообщений (msgview.js): report() — пожаловаться на сообщение, mods(uid, nick) → [[k, текст]],
//   modDo(k, uid, nick) → { ok, msg }, block(uid, nick) — своё подтверждение ленты. Без них — блокировка и модерация общего чата сайта.
//   guest — автор без аккаунта (гость чата): только жалоба и модерация.
// Что видно — те же правила, что раньше: профиль только через sbProfiles() (profiles_public — база сама прячет скрытое), «чем занят» —
//   общее «кто онлайн» и friends_online (только то, что человек разрешил), безопасность детей — D37Age (friendBlock / contact / kidMsg),
//   заявки — accepts_friend_requests и friendBlockReason(). Решение «какие кнопки» — чистая функция decide() (scripts/ui-test.cjs).
// Свои элементы со ссылкой на профиль, которые НЕ должны открывать карточку: data-nomini. Свой ник без ссылки: data-mini-uid="<id>".
// Живой персонаж: свой 2D-персонаж из гардероба (D37Char, без загрузок); «дышит» (D37Sprite) только если char2d.js уже загружен
//   играми и лист готов — Three.js ради карточки не грузим. Непрерывная анимация — только в «Мощном» (body.high).
(() => {
  'use strict';
  if (window.D37Mini) return;
  const M = window.D37Mini = {};
  const e = s => (typeof esc === 'function' ? esc(String(s ?? '')) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const PROFILE_HREF = /^(?:\/?#)?\/profile\/([0-9a-f-]{36})\/?$/i;
  const uiV2 = () => { try { return typeof UI_V2 === 'undefined' || !!UI_V2; } catch (er) { return true; } };
  const me = () => (typeof currentUser !== 'undefined' && currentUser?.id) || null;
  const P = () => window.D37Phone || null;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // ═══ Что показать: чистая функция (тест — scripts/ui-test.cjs) ═══
  // s: { uid, self, logged, guest, status: 'none'|'pending_sent'|'pending_received'|'friends'|null, accepts, why, kb, kp, join, blocked,
  //      canReport, mods: [[k, t]], hidden, vis } → { acts: [{ k, t, cls, dis, href }], notes: [текст], mods, lock }
  function decide(s){
    const acts = [], notes = [];
    const KM = k => (window.D37Age?.kidMsg ? window.D37Age.kidMsg(k) : '🔒 Недоступно');
    if (s.uid) acts.push({ k: 'profile', t: s.self ? '👤 Мой профиль' : '👤 Профиль', href: '#/profile/' + s.uid, cls: 'pri' });
    // 📍 К нему — в его сервер мира или комнату игры; ребёнку со взрослым / без возраста — нельзя (как дружба)
    if (s.join && !s.self && !s.kp) acts.push({ k: 'join', t: s.join.label });
    if (s.uid && s.logged && !s.self) {
      const kid = k => { notes.push(KM(k)); return { k: '', t: '🔒 ' + (s.status === 'friends' ? 'Только дружба' : 'Нельзя'), dis: true }; };
      if (s.status === 'friends') {
        if (s.kb) acts.push(kid(s.kb));
        else acts.push({ k: 'dm', t: '✉ Написать' }, { k: 'call', t: '📞 Позвонить' });
      } else if (s.status === 'pending_received') acts.push(s.kp ? kid('agefriend') : { k: 'friend-acc', t: '✅ Принять в друзья', cls: 'ok' });
      else if (s.status === 'pending_sent') acts.push({ k: '', t: '⏳ Заявка отправлена', dis: true });
      else if (s.status === 'none') {
        if (s.kp) acts.push(kid('agefriend'));
        else if (s.accepts === false) acts.push({ k: '', t: '🚫 Не принимает заявки', dis: true });
        else if (s.why) { acts.push({ k: '', t: '➕ В друзья', dis: true }); notes.push(s.why); }
        else acts.push({ k: 'friend-add', t: '➕ В друзья', cls: 'ok' });
      }
      acts.push({ k: 'block', t: s.blocked ? '✅ Разблокировать' : '🚫 Заблокировать', cls: s.blocked ? '' : 'warn' });
    }
    if (s.canReport && s.logged && !s.self) acts.push({ k: 'report', t: '🚩 Пожаловаться', cls: 'warn' });
    if (s.uid && !s.logged) notes.push('Войди, чтобы дружить, писать и звонить');
    const lock = s.hidden && !s.self ? (s.vis === 'friends' ? '🔒 Профиль видят только друзья' : '🔒 Пользователь скрыл профиль') : '';
    return { acts, notes, mods: s.self ? [] : (s.mods || []), lock };
  }
  M._test = { decide, PROFILE_HREF };

  // ═══ Данные (кэш на визит: профиль — 60 с, дружба — 15 с, персонаж и его картинка — до перезагрузки) ═══
  const PC = new Map(), FC = new Map(), LOOK = new Map(), IMG = new Map();
  // Фокус в карточку (и обратно) — только при работе с клавиатуры: focus() заставляет пересчитать стили и раскладку всей страницы
  // до первого кадра (телефон, ЦП ×4: ≈ 12 мс на открытие и столько же на закрытие); пальцем и мышью он не нужен
  let kbd = false;
  addEventListener('keydown', () => { kbd = true; }, true);
  addEventListener('pointerdown', () => { kbd = false; }, true);
  async function profileOf(uid, fresh){
    const c = PC.get(uid);
    if (c && !fresh && Date.now() - c.t < 60e3) return c.p;
    if (typeof sbClient === 'undefined' || !sbClient || typeof sbProfiles !== 'function') return c?.p || null;
    try {
      const { data } = await (await sbProfiles()).select('*').eq('id', uid).maybeSingle();
      if (data) { PC.set(uid, { p: data, t: Date.now() }); if (PC.size > 300) PC.delete(PC.keys().next().value); }
      return data || null;
    } catch (er) { return c?.p || null; }
  }
  async function friendOf(uid){
    const c = FC.get(uid);
    if (c && Date.now() - c.t < 15e3 && c.me === me()) return c.v;
    const v = typeof getFriendshipStatus === 'function' ? await getFriendshipStatus(uid).catch(() => 'none') : 'none';
    FC.set(uid, { v, t: Date.now(), me: me() });
    return v;
  }
  const dropFriend = uid => { FC.delete(uid); P()?.dropFriends?.(); try { if (typeof myFriendStatusCache !== 'undefined') myFriendStatusCache = null; } catch (er) {} };
  async function lookOf(uid, self){
    if (!window.D37Char) return null;
    if (self) return D37Char.look();
    if (LOOK.has(uid)) return LOOK.get(uid);
    const m = await D37Char.looksOf([uid]).catch(() => ({}));
    const l = m[uid] || null; LOOK.set(uid, l);
    return l;
  }

  // ═══ Разметка (один раз) ═══
  let root = null, card = null, open = null, seq = 0, hist = 0, ignorePop = 0, sprRaf = 0;
  function build(){
    if (root) return;
    root = document.createElement('div');
    root.className = 'd37m'; root.hidden = true;
    root.innerHTML = `<div class="d37m-back" data-mk="close"></div>
      <div class="d37m-card" role="dialog" aria-modal="false" aria-labelledby="d37mNick" tabindex="-1">
        <div class="d37m-ban"></div><button type="button" class="d37m-x" data-mk="close" aria-label="Закрыть">✕</button>
        <div class="d37m-top"><span class="d37m-avw"><span class="d37m-ava"></span><i class="d37m-on" hidden title="В сети"></i></span><span class="d37m-char" hidden></span></div>
        <div class="d37m-body">
          <div class="d37m-name"><b id="d37mNick" class="d37m-nick"></b><span class="d37m-badges"></span></div>
          <div class="d37m-sub"><span class="d37m-lv lv-badge" hidden></span><span class="d37m-title nick-title" hidden></span><span class="d37m-role"></span></div>
          <div class="d37m-act" hidden></div>
          <div class="d37m-status" hidden></div>
          <p class="d37m-bio" hidden></p>
          <div class="d37m-games" hidden></div>
          <div class="d37m-lock" hidden></div>
          <div class="d37m-acts"></div>
          <div class="d37m-notes"></div>
          <div class="d37m-mods" hidden></div>
          <div class="d37m-ask" hidden></div>
        </div>
      </div>`;
    card = root.querySelector('.d37m-card');
    root.addEventListener('click', onClick);
    document.body.appendChild(root);
  }
  // Разметку — заранее, когда браузер свободен (скрытая: ни стилей, ни раскладки) — первое открытие не дольше повторного
  const idle = f => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 5000 }) : setTimeout(f, 2000));
  const prebuild = () => idle(() => {
    try {
      if (!document.body || root) return;
      build();
      // прогрев: один раз разложить невидимой с типичными кнопками (стили, шрифты, значки) — первый кадр открытия короче
      q('.d37m-acts').innerHTML = '<span class="d37m-btn pri">👤 Профиль</span><span class="d37m-btn ok">➕ В друзья</span><span class="d37m-btn warn">🚫 Заблокировать</span><span class="d37m-btn">✉ Написать</span><span class="d37m-btn">📞 Позвонить</span>';
      q('.d37m-nick').textContent = 'Игрок';
      root.style.visibility = 'hidden'; root.classList.add(sheetMode() ? 'sheet' : 'pop'); root.hidden = false;
      void card.offsetHeight;
      root.hidden = true; root.style.visibility = ''; root.classList.remove('sheet', 'pop');
      q('.d37m-acts').textContent = ''; q('.d37m-nick').textContent = '';
    } catch (er) {}
  });
  if (document.readyState === 'complete') prebuild(); else addEventListener('load', prebuild, { once: true });
  const q = s => card.querySelector(s);
  const sheetMode = () => { try { return matchMedia('(max-width: 640px)').matches || (matchMedia('(pointer: coarse)').matches && innerHeight < 480); } catch (er) { return false; } };

  // Компьютер: рядом с элементом и целиком в экране (под ним, не помещается — над; по горизонтали — в пределах окна)
  function place(){
    if (!open || !root || root.hidden) return;
    if (open.sheet) { card.style.left = card.style.top = ''; return; }
    const a = open.anchor?.isConnected ? open.anchor.getBoundingClientRect() : null;
    const W = innerWidth, H = innerHeight, w = card.offsetWidth, h = card.offsetHeight, pad = 12;
    let x = a ? a.left : (W - w) / 2, y = a ? a.bottom + 8 : (H - h) / 2;
    if (a && y + h > H - pad) y = a.top - h - 8;
    x = Math.max(pad, Math.min(x, W - w - pad));
    y = Math.max(pad, Math.min(y, H - h - pad));
    card.style.left = Math.round(x) + 'px'; card.style.top = Math.round(y) + 'px';
  }

  // ═══ Открыть ═══
  M.open = (uid, o = {}) => {
    try { return openCard(uid, o); }
    catch (er) {   // запасной путь: карточка сломалась — открыть профиль, сайт живёт
      console.error(er);
      if (uid && UUID.test(uid)) { try { location.hash = '#/profile/' + uid; } catch (er2) {} }
      return Promise.resolve();
    }
  };
  function openCard(uid, o){
    uid = uid && UUID.test(String(uid)) ? String(uid) : null;
    const guest = !uid;
    if (guest && !o.nick) return Promise.resolve();
    build();
    const id = ++seq, self = !!uid && uid === me(), sheet = sheetMode();
    if (open && open.uid === uid && !root.hidden && open.anchor === o.anchor) { close(); return Promise.resolve(); }   // второе нажатие — закрыть
    stopSprite();
    open = { id, uid, nick: String(o.nick || '').slice(0, 40), anchor: o.anchor || null, actions: o.actions || null, guest, self, sheet, ret: document.activeElement };
    root.classList.toggle('sheet', sheet);
    root.classList.toggle('pop', !sheet);
    const pcache = uid ? (PC.get(uid)?.p || P()?.prof?.(uid) || null) : null;
    paintHead(pcache || { nick: open.nick, role: null }, true);
    paintActs({ status: null });
    q('.d37m-ask').hidden = true;
    if (root.hidden) {   // появление — анимацией CSS (.in) с первого кадра, без принудительного пересчёта раскладки
      root.classList.add('in');
      root.hidden = false;
      document.addEventListener('keydown', onKey, true);
      addEventListener('resize', place);
      document.addEventListener('scroll', onScroll, true);
      if (sheet) pushHist();
    }
    place();
    if (kbd) requestAnimationFrame(() => { if (open?.id === id) { try { card.focus({ preventScroll: true }); } catch (er) {} } });
    return load(id, uid, o);
  }

  async function load(id, uid, o){
    const live = () => open && open.id === id;
    if (!uid) { paintActs({ status: null, guest: true }); place(); return; }
    const logged = !!me(), self = open.self;
    const pP = profileOf(uid);
    const pDonor = window.D37Donor ? D37Donor.badges([uid]).catch(() => {}) : null;
    const pEx = typeof xpGetExtras === 'function' ? xpGetExtras(uid).catch(() => null) : null;
    const pSt = logged && !self ? friendOf(uid) : null;
    const A = window.D37Age;
    const pKb = logged && !self && A?.contact ? A.contact(uid).catch(() => null) : null;
    const pKp = logged && !self && A?.friendBlock ? A.friendBlock(uid).catch(() => null) : null;
    const pOn = P()?.friendStatus ? P().friendStatus([uid]).catch(() => null) : null;
    const pLook = lookOf(uid, self).catch(() => null);
    const p = await pP; if (!live()) return;
    if (p) paintHead(p, false);
    else if (!PC.get(uid)) { q('.d37m-lock').hidden = false; q('.d37m-lock').textContent = '📡 Не удалось загрузить профиль'; }
    await pDonor; if (!live()) return;
    if (p) paintStatus(p);
    const ex = await pEx; if (!live()) return;
    paintLevel(ex);
    const ava = q('.d37m-ava');
    if (typeof applyLevelFrame === 'function') applyLevelFrame(ava, uid).catch?.(() => {});
    const on = await pOn; if (!live()) return;
    const st = on?.get?.(uid) || null, act = st?.a || null;
    paintActivity(st, act);
    const [status, kb, kp] = await Promise.all([pSt, pKb, pKp]); if (!live()) return;
    let why = null;
    if (status === 'none' && !kp && p?.accepts_friend_requests !== false && typeof friendBlockReason === 'function') why = await friendBlockReason().catch(() => null);
    if (!live()) return;
    const join = act && P()?.actJoin ? P().actJoin(act) : null;
    paintActs({ status, kb, kp, why, join, act, accepts: p?.accepts_friend_requests, hidden: !!p?.profile_hidden, vis: p?.profile_visibility });
    place();
    const look = await pLook; if (!live()) return;
    paintChar(look);
    place();
  }

  // ═══ Отрисовка частей (текст игроков — только textContent) ═══
  function paintHead(p, first){
    const nick = p?.nick || open.nick || 'Игрок';
    q('.d37m-nick').textContent = nick;
    if (window.d37NickFx?.markEl && open.uid) { try { d37NickFx.markEl(q('.d37m-nick'), open.uid); } catch (er) {} }
    const ava = q('.d37m-ava'), url = p?.avatar_url && typeof safeImgUrl === 'function' ? safeImgUrl(p.avatar_url) : '';
    ava.style.backgroundImage = url ? `url("${url}")` : '';
    ava.textContent = url ? '' : (String(nick).replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, '') || '?').slice(0, 2).toUpperCase();
    if (first) { ava.className = 'd37m-ava'; ava.removeAttribute('data-ss'); }
    if (p && typeof applyProfileGlow === 'function' && !first) applyProfileGlow(ava, p);
    const ban = q('.d37m-ban'), burl = p?.banner_url && typeof safeImgUrl === 'function' ? safeImgUrl(p.banner_url) : '';
    ban.style.backgroundImage = burl ? `url("${burl}")` : '';
    ban.classList.toggle('empty', !burl);
    q('.d37m-badges').innerHTML = p?.role && typeof ROLE_BADGE_HTML !== 'undefined' ? (ROLE_BADGE_HTML[p.role] || '') : '';
    q('.d37m-role').textContent = open.guest ? 'Гость (без аккаунта)' : p?.role === 'admin' ? 'Администратор сайта' : p?.role === 'moderator' ? 'Модератор сайта' : p?.role === 'helper' ? 'Хелпер сайта' : '';
    const hidden = !!p?.profile_hidden && !open.self;
    const lock = q('.d37m-lock');
    if (first) { for (const s of ['.d37m-status', '.d37m-bio', '.d37m-games', '.d37m-act']) q(s).hidden = true; lock.hidden = true; q('.d37m-lv').hidden = true; q('.d37m-title').hidden = true; q('.d37m-on').hidden = true; q('.d37m-char').hidden = true; q('.d37m-char').textContent = ''; return; }
    lock.hidden = !hidden;
    lock.textContent = hidden ? (p.profile_visibility === 'friends' ? '🔒 Профиль видят только друзья' : '🔒 Пользователь скрыл профиль') : '';
    const status = q('.d37m-status'); status.textContent = hidden ? '' : String(p?.status_text || ''); status.hidden = !status.textContent;
    const bio = q('.d37m-bio'); bio.textContent = hidden ? '' : String(p?.bio || ''); bio.hidden = !bio.textContent;
    const g = q('.d37m-games'), games = hidden ? [] : (Array.isArray(p?.favorite_games) ? p.favorite_games : []).slice(0, 10);
    const mine = new Set((typeof currentProfile !== 'undefined' && currentProfile?.favorite_games) || []);
    g.innerHTML = games.map(x => { const sh = !open.self && mine.has(x); return `<span class="d37m-game${sh ? ' shared' : ''}" title="${sh ? 'Ты тоже играешь' : ''}">${sh ? '✓ ' : ''}🎮 ${e(x)}</span>`; }).join('');
    g.hidden = !games.length;
  }
  function paintStatus(p){
    const st = typeof statusOf === 'function' ? statusOf(p) : null, b = q('.d37m-badges');
    b.querySelector('.d37m-vip')?.remove();
    if (!st) return;
    const s = document.createElement('span');
    s.className = 'd37m-vip';
    s.style.setProperty('--vc', st.rgb);
    s.textContent = st.kind === 'donor' ? '💛 ' + (window.D37Donor?.roman ? D37Donor.roman(st.lv) : st.lv) : (st.tier.key === 'gold' ? '✨ GOLD' : st.tier.key === 'silver' ? '⭐ SILVER' : '🔸 VIP');
    s.title = st.kind === 'donor' ? `Донатер${st.until && window.D37Donor?.untilText ? ' — ' + D37Donor.untilText(st.until) : ''} · статус за поддержку стрима` : st.tier.label;
    b.appendChild(s);
  }
  function paintLevel(ex){
    const lv = q('.d37m-lv'), t = q('.d37m-title');
    if (ex?.level) { lv.hidden = false; lv.textContent = 'Lv ' + ex.level; lv.className = 'd37m-lv lv-badge' + (typeof xpTierClass === 'function' ? xpTierClass(ex.level) : ''); }
    const d = ex?.title && typeof achTitleDef === 'function' ? achTitleDef(ex.title) : null;
    t.hidden = !d; t.textContent = d ? `${d.icon} ${d.title}` : '';
  }
  function paintActivity(st, act){
    const el = q('.d37m-act');
    q('.d37m-on').hidden = !st?.online;
    const txt = st?.online && act && P()?.actText ? P().actText(act) : '';
    el.textContent = txt; el.hidden = !txt;
  }
  function paintActs(x){
    const o = open, logged = !!me();
    o.lastX = x;
    let mods = [];
    try { mods = o.actions?.mods ? o.actions.mods(o.uid, o.nick) || [] : staffMods(o.uid); } catch (er) { mods = []; }
    const d = decide({ uid: o.uid, self: o.self, logged, guest: o.guest, status: x.status ?? null, accepts: x.accepts, why: x.why, kb: x.kb, kp: x.kp,
      join: x.join, blocked: !!o.uid && !!window.MsgView?.blocked?.has?.(o.uid), canReport: !!o.actions?.report, mods, hidden: x.hidden, vis: x.vis });
    o.act = x.act || null;
    // пока не знаем дружбу — кнопки дружбы не показываем (без «прыжка» кнопок: место держит заглушка)
    const pending = logged && !o.self && o.uid && x.status == null;
    q('.d37m-acts').innerHTML = d.acts.map(a => a.href ? `<a class="d37m-btn ${a.cls || ''}" href="${e(a.href)}" data-nomini="1" data-mk="go">${e(a.t)}</a>`
      : `<button type="button" class="d37m-btn ${a.cls || ''}" data-mk="${e(a.k)}"${a.dis ? ' disabled' : ''}>${e(a.t)}</button>`).join('')
      + (pending ? '<span class="d37m-btn ghost" aria-hidden="true">…</span>' : '');
    q('.d37m-notes').innerHTML = d.notes.map(t => `<div class="d37m-note">${e(t)}</div>`).join('')
      + (o.uid && !logged ? '<button type="button" class="d37m-btn wide d37m-login" data-mk="login">🔑 Войти</button>' : '');
    const mb = q('.d37m-mods');
    mb.hidden = !d.mods.length;
    mb.innerHTML = d.mods.length ? '<div class="d37m-msep">Модерация</div>' + d.mods.map(([k, t]) => `<button type="button" class="d37m-btn warn" data-mod="${e(k)}">${e(t)}</button>`).join('') : '';
  }
  // Вне чата: модерация общего чата сайта — команде сайта (те же функции сервера, права проверяет он же)
  function staffMods(uid){
    if (!uid || typeof isChatStaff !== 'function' || !isChatStaff() || uid === me()) return [];
    const A = staffAdapter(); return A?.userMod ? A.userMod(uid, open.nick) || [] : [];
  }
  let sa = null;
  function staffAdapter(){ if (!sa && window.D37Chat?.adapter) { try { sa = window.D37Chat.adapter('general'); } catch (er) { sa = null; } } return sa; }

  // Персонаж: картинка 2D сразу; «дышит», только если D37Sprite уже есть (char2d.js загрузили игры) — Three.js не грузим
  function paintChar(look){
    const box = q('.d37m-char');
    if (!look || !window.D37Char) { box.hidden = true; return; }
    try {
      const key = JSON.stringify(look);   // картинка персонажа — одна на образ (D37Char.img рисует и кодирует PNG ≈ 3 мс на телефоне)
      let src = IMG.get(key);
      if (!src) { src = D37Char.img(look, 120); if (!src) return; IMG.set(key, src); if (IMG.size > 60) IMG.delete(IMG.keys().next().value); }
      box.innerHTML = '';
      const img = new Image(); img.alt = ''; img.decoding = 'async'; img.src = src;
      box.appendChild(img); box.hidden = false;
      box.title = open.self ? 'Мой персонаж — гардероб' : 'Персонаж игрока';
      liveSprite(look, box);
    } catch (er) { box.hidden = true; }
  }
  function liveSprite(look, box){
    const S = window.D37Sprite; if (!S?.handle) return;
    const id = open.id, H = S.handle(look, { view: 'front', size: 80, style: S.styleFor ? S.styleFor('toon') : undefined, anims: ['idle'] });
    let t0 = 0, cv = null, ctx = null;
    const draw = t => {
      if (!open || open.id !== id || root.hidden) { sprRaf = 0; return; }
      if (!H.ready('idle')) { sprRaf = requestAnimationFrame(draw); return; }
      if (!cv) {
        cv = document.createElement('canvas'); const dpr = Math.min(2, devicePixelRatio || 1);
        cv.width = 96 * dpr; cv.height = 112 * dpr; ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
        box.textContent = ''; box.appendChild(cv); t0 = t;
      }
      ctx.clearRect(0, 0, 96, 112);
      H.draw(ctx, 'idle', (t - t0) / 1000, 48, 108, { h: 96 });
      sprRaf = document.body.classList.contains('high') ? requestAnimationFrame(draw) : 0;   // непрерывно — только в «Мощном»
    };
    sprRaf = requestAnimationFrame(draw);
    setTimeout(() => { if (open?.id === id && !cv) stopSprite(); }, 2500);   // лист не готов за 2,5 с — остаётся картинка
  }
  function stopSprite(){ if (sprRaf) cancelAnimationFrame(sprRaf); sprRaf = 0; }

  // ═══ Действия ═══
  async function onClick(ev){
    const t = ev.target.closest('[data-mk],[data-mod]'); if (!t || !open) return;
    const o = open, k = t.dataset.mk, uid = o.uid, nick = q('.d37m-nick').textContent || o.nick;
    if (t.dataset.mod) { t.disabled = true; await modDo(t.dataset.mod, uid, nick); return; }
    if (k === 'close') { close(); return; }
    if (k === 'go') {   // «Профиль»: компьютер — обычная ссылка (роутер); лист на телефоне — переход ВМЕСТО своей записи «Назад»
      if (!hist) { close({ nav: true }); return; }
      ev.preventDefault();
      const href = t.getAttribute('href'); close({ nav: true });
      if (window.D37Route?.go) D37Route.go(href, { replace: true }); else location.hash = href;
      return;
    }
    if (k === 'login') { close(); if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); return; }
    if (k === 'join') { const a = o.act; close(); P()?.goJoin?.(uid, a); return; }
    if (k === 'dm') { close(); if (P()?.open) P().open('msgs/' + uid); else if (typeof openDmWith === 'function') openDmWith(uid, nick); return; }
    if (k === 'call') { close(); await P()?.need?.('calls'); window.D37Calls?.call(uid, nick); return; }
    if (k === 'report') { const f = o.actions?.report; close(); f?.(); return; }
    if (k === 'friend-add' || k === 'friend-acc') {
      t.disabled = true;
      const r = k === 'friend-add' ? (typeof sendFriendRequest === 'function' ? await sendFriendRequest(uid, { quiet: true }) : null)
        : (typeof acceptFriendRequest === 'function' ? await acceptFriendRequest(uid, { quiet: true }) : null);
      dropFriend(uid);
      if (!open || open.id !== o.id) return;
      if (r?.ok) t.textContent = k === 'friend-add' ? '⏳ Заявка отправлена' : '✅ Теперь друзья';
      else { t.disabled = false; note(r?.msg || '⚠️ Не получилось'); }
      if (r?.ok && k === 'friend-acc') { const st = await friendOf(uid); if (open?.id === o.id) paintActs({ ...o.lastX, status: st }); }
      return;
    }
    if (k === 'block') {
      if (o.actions?.block) { close(); o.actions.block(uid, nick); return; }
      const on = !window.MsgView?.blocked?.has?.(uid);
      if (on && !(await askHere(`Заблокировать ${nick}? Его сообщения скроются, он не сможет писать тебе в личку, звонить и звать в друзья. Дружба удалится.`, '🚫 Заблокировать'))) return;
      try { await P()?.need?.('mv'); } catch (er) {}
      const r = window.MsgView?.block ? await MsgView.block(uid, on) : { ok: false, err: 'не загрузилось' };
      dropFriend(uid);
      note(r.ok ? (on ? '🚫 Заблокирован' : '✅ Разблокирован') : '⚠️ ' + (r.err || 'Не получилось'), !r.ok);
      if (r.ok && open?.id === o.id) paintActs({ ...(o.lastX || {}), status: await friendOf(uid) });
    }
  }
  async function modDo(k, uid, nick){
    const o = open;
    try {
      const r = o.actions?.modDo ? await o.actions.modDo(k, uid, nick) : await staffAdapter()?.userModDo?.(k, uid, nick);
      if (open?.id !== o.id) return;
      note(r?.msg || (r?.ok ? '✅ Готово' : '⚠️ Не получилось'), !r?.ok);
      if (r?.ok) setTimeout(() => { if (open?.id === o.id) close(); }, 1400);
    } catch (er) { note('⚠️ Не получилось'); }
  }
  function note(text, bad = true){
    const n = q('.d37m-notes');
    let el = n.querySelector('.d37m-res');
    if (!el) { el = document.createElement('div'); el.className = 'd37m-note d37m-res'; n.prepend(el); }
    el.classList.toggle('bad', !!bad); el.textContent = text;
    place();
  }
  // Подтверждение прямо в карточке (без окна поверх окна)
  function askHere(text, yes){
    const box = q('.d37m-ask');
    return new Promise(res => {
      box.innerHTML = `<p></p><div><button type="button" class="d37m-btn warn" data-ans="1"></button><button type="button" class="d37m-btn ghost" data-ans="">Отмена</button></div>`;
      box.querySelector('p').textContent = text; box.querySelector('[data-ans="1"]').textContent = yes;
      box.hidden = false; place();
      box.onclick = ev => { const b = ev.target.closest('[data-ans]'); if (!b) return; box.hidden = true; box.onclick = null; place(); res(!!b.dataset.ans); };
    });
  }

  // ═══ Закрыть: Esc, нажатие мимо, «Назад» (телефон), прокрутка страницы (компьютер), переход ═══
  function close(o = {}){
    if (!root || root.hidden) return;
    const was = open; open = null; stopSprite();
    root.hidden = true; root.classList.remove('in');
    document.removeEventListener('keydown', onKey, true);
    removeEventListener('resize', place);
    document.removeEventListener('scroll', onScroll, true);
    const a = q('.d37m-ask'); a.hidden = true; a.onclick = null;
    if (hist && !o.fromPop) {
      if (history.state?.d37mini === hist && !o.nav) { ignorePop++; try { history.back(); } catch (er) { ignorePop--; } }
      hist = 0;
    } else hist = 0;
    const r = was?.ret;
    if (kbd && r && r.isConnected && typeof r.focus === 'function' && !o.nav && !o.fromPop) { try { r.focus({ preventScroll: true }); } catch (er) {} }
  }
  M.close = () => close();
  M.isOpen = () => !!root && !root.hidden;
  function onKey(ev){
    if (ev.key !== 'Escape' || !M.isOpen()) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    close();
  }
  // прокрутка (компьютер): карточка едет за элементом; элемент ушёл с экрана — закрыть
  let scrollRaf = 0;
  function onScroll(ev){
    if (!open || open.sheet || scrollRaf || card.contains(ev.target)) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const a = open?.anchor; if (!a || !M.isOpen()) return;
      const r = a.isConnected ? a.getBoundingClientRect() : null;
      if (!r || r.bottom < 0 || r.top > innerHeight || (!r.width && !r.height)) close({ nav: true }); else place();
    });
  }
  // «Назад» на телефоне: своя запись в истории (тот же адрес — роутер раздел не перерисовывает); чужие метки (полный экран, окна) — сохраняем
  function pushHist(){
    if (!history.pushState) return;
    hist = ++seq;
    try { history.pushState(Object.assign({}, history.state && typeof history.state === 'object' ? history.state : null, { d37mini: hist }), '', location.href); } catch (er) { hist = 0; }
  }
  addEventListener('popstate', () => {
    if (ignorePop > 0) { ignorePop--; return; }
    if (hist && history.state?.d37mini !== hist) { hist = 0; close({ fromPop: true }); }
  });
  addEventListener('d37:route', () => { if (M.isOpen()) close({ nav: true }); });
  // нажатие мимо карточки (компьютер; у листа — затемнение data-mk="close")
  document.addEventListener('pointerdown', ev => {
    if (!M.isOpen() || open?.sheet || card.contains(ev.target)) return;
    if (open?.anchor && open.anchor.contains?.(ev.target)) return;   // то же место — решит click (второе нажатие закрывает)
    close();
  }, true);

  // ═══ Ник или ссылка на профиль по всему сайту → карточка (UI_V2; с Ctrl/Shift/колёсиком — как обычная ссылка) ═══
  // свои места (data-mini-uid: друзья, гости, тиммейты) — всегда; любые ссылки на профиль — только с UI_V2
  document.addEventListener('click', ev => {
    if (ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const el = ev.target?.closest?.('[data-mini-uid], a[href]'); if (!el) return;
    if (el.closest('[data-nomini], .d37m, .ph-head, .gs-set')) return;
    let uid = el.dataset?.miniUid || '';
    if (!uid && el.tagName === 'A' && uiV2() && (!el.target || el.target === '_self')) { const m = PROFILE_HREF.exec(el.getAttribute('href') || ''); uid = m ? m[1] : ''; }
    if (!UUID.test(uid)) return;
    ev.preventDefault();
    M.open(uid, { nick: el.dataset.miniNick || (el.textContent || '').trim().slice(0, 24), anchor: el });
  });

  // Старое имя (тиммейты, гости профиля и т.п.): openMiniProfile(id, ник, элемент)
  window.openMiniProfile = (uid, nick, anchor) => M.open(uid, { nick, anchor });
  M._t = { profileOf, PC, FC, decide };
})();
