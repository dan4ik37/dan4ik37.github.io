// ═══════════════════════════════════════
//  ТЕЛЕФОН 📱 (D37Phone) — один телефон на весь сайт: кнопка 📱 в шапке, страница #/phone, «Мир Денчика» (кнопка в панели
//  и клавиша P), «Студия 3D» в игре (кнопка рядом с ⚙️ и клавиша P), игры во весь экран (кнопка в полоске игры).
//  Приложения: Сообщения, Звонки, Сообщества, Друзья, Камера, Карта, Уведомления, Настройки + ярлыки (Мир, Игры, Чат, Персонаж).
// ═══════════════════════════════════════
// Здесь — корпус, переходы между экранами, значки непрочитанного, входящий звонок (личное сообщение со ссылкой
// #/phone/call/<код> — слышно на любой странице, пока вошёл; таблиц не нужно), «чем занят» для друзей (presence чата +
// comm_ping), звуки (WebAudio, без файлов), вкладка «📱 Телефон» в окне «⚙️ Настройки» (js/core/settings.js).
// Приложения грузятся при первом открытии: phone-apps.js (сообщения, друзья, камера, карта, уведомления), calls.js (звонки,
// «компания», голосовые каналы), community.js + msgview.js (сообщества, чат «как Дискорд»). База — community.sql; пока он не
// выполнен, сообщества и голосовые каналы пишут «появятся, когда сайт обновится», остальное работает.
// Файлы приложений грузятся с ?v=VER — поменял phone-apps.js / calls.js / community.js / msgview.js / worldchat.js — подними VER.
//
// Игра подключает телефон: off = D37Phone.attach('world', { title, hotkey: true, bar: элемент (сюда кнопка 📱), pause(on),
//   activity(), shot(), where(), players(), tp(x, z, yaw), toFriend(uid) → true/false, shard(n?) }) → off() при выходе.
//   Пока телефон открыт — pause(true): игра держит C.blocked (как при окне ⚙️), мышь отпущена; Esc и P забирает телефон.
// Пути: '' (домашний), msgs, msgs/<uid>, friends, calls, calls/<код> (войти в звонок), incall, comm, comm/<id>[/<канал>|…],
//   comm/join/<код>, camera, map, game (мини-игра «Птичка»), notif, settings. Ссылка #/phone/<путь>; приглашение #/c/<код> → #/chat/join/<код>.
// Телефон в руке персонажа (как в ГТА, world3d.js): hooks.hand(состояние) — '' (убран), use (смотрит в экран), call (у уха —
//   звонок 1 на 1, и с закрытым телефоном), play (мини-игра), photo (камера); вернула true — игра показывает это 3D-человечком:
//   тогда экран телефона выезжает, когда телефон уже в руке (~0,33 с), а закрывается — сначала экран, потом персонаж убирает
//   телефон. Без 3D (нет WebGL, плоский мир, обычная страница) — только экран, без задержки. Событие 'd37:hand' (detail —
//   состояние) — всем (плоский мир рисует 📱 над игроком). Чистая функция: D37Phone.handFor(открыт, путь, звонок).
// Приложение: D37Phone.define(id, { render(el, arg, ctx) → функция уборки (необязательно), title }).
(() => {
  const VER = '4';
  // файлы приложений (грузятся при первом открытии); лента сообщений msgview.js — общая для чата, сообществ и ЛС
  const MODS = { mv: ['js/features/msgview.js'], apps: ['js/features/msgview.js', 'js/features/phone-apps.js'], calls: ['js/features/calls.js'], ds: ['js/features/msgview.js', 'js/features/community.js', 'js/features/community2.js'], wchat: ['js/features/worldchat.js'] };
  const APPS = [
    { id: 'msgs', ic: '💬', t: 'Сообщения', bg: '#22c55e,#15803d', mod: 'apps', b: 'msgs' },
    { id: 'calls', ic: '📞', t: 'Звонки', bg: '#34d399,#059669', mod: 'calls', b: 'calls' },
    { id: 'comm', ic: '🏰', t: 'Сообщества', bg: '#818cf8,#4f46e5', mod: 'ds', b: 'comm' },
    { id: 'friends', ic: '🤝', t: 'Друзья', bg: '#f472b6,#db2777', mod: 'apps', b: 'friends' },
    { id: 'camera', ic: '📷', t: 'Камера', bg: '#94a3b8,#475569', mod: 'apps' },
    { id: 'map', ic: '🗺️', t: 'Карта', bg: '#4ade80,#0d9488', mod: 'apps' },
    { id: 'game', ic: '🐤', t: 'Птичка', bg: '#fde047,#f97316', mod: 'apps' },
    { id: 'notif', ic: '🔔', t: 'Уведомления', bg: '#fbbf24,#ea580c', mod: 'apps', b: 'notif' },
    { id: 'settings', ic: '⚙️', t: 'Настройки', bg: '#a1a1aa,#3f3f46' },
  ];
  const LINKS = [
    { ic: '🌍', t: 'Мир', h: '#/games/world', bg: '#38bdf8,#2563eb' }, { ic: '🎮', t: 'Игры', h: '#/games', bg: '#fb7185,#e11d48' },
    { ic: '💭', t: 'Чат', h: '#/chat', bg: '#c084fc,#7c3aed' }, { ic: '🎭', t: 'Персонаж', h: '#/games/wardrobe', bg: '#f9a8d4,#be185d' },
  ];
  const DOCK = ['msgs', 'calls', 'comm', 'friends'];
  const P = window.D37Phone = window.D37Phone || {};
  const defs = new Map();         // приложения (render)
  const mods = new Map();         // загрузка файлов приложений
  const badges = { msgs: 0, calls: 0, notif: 0, comm: 0, friends: 0 };
  let root = null, view = null, stack = [], cur = null, cleanup = null, isOpen = false, docked = false, ctx = null, returnFocus = null;
  let openedByCall = false;

  // ── Телефон в руке персонажа (как в ГТА): что держит — по экрану и звонку; игре — hooks.hand, всем — событие d37:hand ──
  const HAND_IN = 330, HAND_OUT = 190;   // мс: экран выезжает, когда телефон уже в руке; закрыли — сначала экран, потом убирает
  // открыт (поверх игры, не страница #/phone), путь экрана, звонок (D37Calls.state()) → '' | use | call | play | photo
  P.handFor = (open, path, call) => {
    const talk = !!call && call.kind === 'call' && ['out', 'joining', 'live'].includes(call.state);   // 1 на 1 — у уха (и с закрытым экраном)
    if (!open) return talk ? 'call' : '';
    const id = String(path || '').split('/')[0];
    if (id === 'camera') return 'photo';
    if (id === 'game') return 'play';
    if (id === 'incall' && talk) return 'call';
    return 'use';
  };
  let hand = '', slideT = 0;
  // сообщить, что в руке; true — игра показывает это человечком (тогда экран ждёт руку)
  function handSync(){
    const s = P.handFor(isOpen && !docked, cur, window.D37Calls?.state?.());
    let anim = false;
    try { anim = ctx?.hooks.hand?.(s) === true; } catch (e) { console.error(e); }
    if (s !== hand) { hand = s; try { window.dispatchEvent(new CustomEvent('d37:hand', { detail: s })); } catch (e) {} }
    return anim;
  }
  P.hand = () => hand;
  window.addEventListener('d37:callstate', () => handSync());   // calls.js: звонит / ответил / положил
  window.addEventListener('d37:voice', () => handSync());

  // ── Настройки (браузер, d37_phone; меняются во вкладке «📱 Телефон» окна ⚙️ — внизу файла) ──
  // vol — громкость мелодии и звуков телефона (0…1); calls — кто может звонить; ns — шумоподавление; ptt — рация
  const SET0 = { vol: .8, ring: 'classic', ptt: false, pttKey: 'Backquote', ns: true, sounds: true, calls: 'friends' };
  P.set = Object.assign({}, SET0);
  try { Object.assign(P.set, JSON.parse(localStorage.getItem('d37_phone') || '{}')); } catch (e) {}
  P.saveSet = () => {
    try { localStorage.setItem('d37_phone', JSON.stringify(P.set)); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('d37:phoneset')); } catch (e) {}   // calls.js: рация, шумоподавление — сразу
  };

  // ── Сервер ──
  const sb = () => (typeof sbClient !== 'undefined' && sbClient) || null;
  P.me = () => (typeof currentUser !== 'undefined' && currentUser?.id) || null;
  P.myNick = () => (typeof currentProfile !== 'undefined' && currentProfile?.nick) || '';
  // функции ещё нет на сервере (SQL не выполнен) — PGRST202 / 404
  P.missing = e => !!e && (e.code === 'PGRST202' || e.code === '42883' || e.code === '42P01' || /could not find the function|schema cache|does not exist/i.test(e.message || ''));
  P.rpc = async (name, args) => {
    const s = sb(); if (!s) return { error: { message: 'нет связи с сервером' }, offline: true };
    try { const r = await s.rpc(name, args || {}); return { data: r.data, error: r.error, missing: P.missing(r.error) }; }
    catch (e) { return { error: e, missing: false }; }
  };
  P.err = e => (typeof humanErr === 'function' ? humanErr(e) : String(e?.message || e || 'ошибка'));
  // Профили по id: ник, роль, аватар, VIP (публичные колонки, privacy.sql); кэш на визит
  const profCache = new Map();
  P.profiles = async ids => {
    const need = [...new Set(ids.filter(id => id && !profCache.has(id)))];
    if (need.length && sb() && typeof sbProfiles === 'function') {
      try {
        for (let i = 0; i < need.length; i += 100) {
          const { data } = await (await sbProfiles()).select('id, nick, role, avatar_url, is_vip, vip_until').in('id', need.slice(i, i + 100));
          (data || []).forEach(p => profCache.set(p.id, p));
        }
      } catch (e) {}
    }
    const out = {}; for (const id of ids) if (profCache.has(id)) out[id] = profCache.get(id);
    return out;
  };
  P.prof = id => profCache.get(id) || null;
  // Друзья (принятые) и входящие заявки — кэш 30 с
  let friendsCache = null;
  P.friends = async fresh => {
    const me = P.me(); if (!me || !sb()) return { list: [], incoming: [] };
    if (!fresh && friendsCache && Date.now() - friendsCache.t < 30000 && friendsCache.me === me) return friendsCache;
    const { data } = await sb().from('friendships').select('requester_id, addressee_id, status').or(`requester_id.eq.${me},addressee_id.eq.${me}`);
    const rows = data || [];
    const list = rows.filter(r => r.status === 'accepted').map(r => r.requester_id === me ? r.addressee_id : r.requester_id);
    const incoming = rows.filter(r => r.status === 'pending' && r.addressee_id === me).map(r => r.requester_id);
    await P.profiles([...list, ...incoming]);
    friendsCache = { t: Date.now(), me, list, incoming };
    setBadge('friends', incoming.length);
    return friendsCache;
  };
  P.dropFriends = () => { friendsCache = null; };
  // Кто из друзей онлайн и где (community.sql: friends_online) — кэш 20 с
  let onlineCache = null;
  P.online = async fresh => {
    if (!P.me()) return new Map();
    if (!fresh && onlineCache && Date.now() - onlineCache.t < 20000) return onlineCache.m;
    const { data, error } = await P.rpc('friends_online');
    const m = new Map();
    if (!error && Array.isArray(data)) for (const x of data) m.set(x.id, x);
    onlineCache = { t: Date.now(), m };
    return m;
  };
  P.placeText = pl => {
    if (!pl) return '';
    if (pl.startsWith('world:')) return `🌍 в мире, сервер ${pl.slice(6)}`;
    if (pl === 'studio') return '🧱 в Студии 3D';
    if (pl.startsWith('game:')) { const g = typeof GAMES !== 'undefined' && GAMES.find(x => x.id === pl.slice(5)); return g ? `${g.icon} играет: ${g.title}` : '🎮 в игре'; }
    if (pl.startsWith('voice')) return '🔊 в голосовом';
    if (pl === 'call') return '📞 разговаривает';
    return '🟢 на сайте';
  };

  // ── Текст: мат закрывается, чужие ссылки — «[ссылка]», ссылки на сайт — кнопками, снимки камеры — картинками ──
  const LAT = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', '3': 'з', '0': 'о', '@': 'а' };
  const BAD = [
    /ху[йеёяюи]/u, /п[иеё]зд/u, /(?:^|[^\p{L}])бля(?!х)/u, /(?:^|[^\p{L}])(?:за|на|вы|у|от|по|до|про|раз|рас|съ|подъ|из|изъ|при|пере|недо)?[её]б(?:а|ал|ан|ат|ут|ну|ло|ли|л|ы|ош|уч|ен|ис|ыв|ыр|ет|ёт)/u,
    /(?:^|[^\p{L}])[её]б(?!\p{L})/u, /(?:^|[^\p{L}])сук(?:а+|и|е|у|ой|ин|ам)(?!\p{L})/u, /муда[кч]|мудил/u, /пид[ао]р|педик/u, /г[ао]нд[ао]н/u, /шлюх/u, /залуп/u, /дроч/u,
  ];
  P.clean = text => {
    const chars = Array.from(String(text || ''));
    const low = chars.map(c => { const l = c.toLowerCase(); return l.length === 1 ? (LAT[l] || l) : c; }).join('');
    if (low.length !== chars.join('').length) return chars.join('');   // редкие символы — без маски
    const mask = Array(low.length).fill(false);
    for (const re of BAD) { const g = new RegExp(re.source, 'gu'); let m; while ((m = g.exec(low))) { for (let i = m.index; i < m.index + m[0].length; i++) mask[i] = true; if (!m[0].length) g.lastIndex++; } }
    let out = '', i = 0; const s = chars.join('');
    while (i < s.length) {
      if (/\s/u.test(s[i])) { out += s[i++]; continue; }
      let j = i, bad = false;
      while (j < s.length && !/\s/u.test(s[j])) { if (mask[j]) bad = true; j++; }
      out += bad ? '*'.repeat(Math.min(6, j - i)) : s.slice(i, j);
      i = j;
    }
    return out;
  };
  // (ссылки → карточки, @ и эмодзи сайта — в ленте сообщений, msgview.js: MsgView.rich)
  P.onlyEmoji = t => /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,8}$/u.test(t || '') && !/[0-9#*]/.test(t);

  // ── Время ──
  P.hm = iso => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  P.when = iso => {
    const d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return P.hm(iso);
    if (d.toDateString() === y.toDateString()) return 'вчера ' + P.hm(iso);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' ' + P.hm(iso);
  };
  P.ago = iso => {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 90) return 'только что';
    if (s < 3600) return Math.floor(s / 60) + ' мин назад';
    if (s < 86400) return Math.floor(s / 3600) + ' ч назад';
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  };
  P.plural = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? b : c;

  // ── Аватар и ник (цвет роли/VIP — как в чате) ──
  const ROLE_RGB = { admin: '255,45,85', moderator: '145,71,255', helper: '34,197,94' };
  P.rgb = p => {
    if (!p) return null;
    if (ROLE_RGB[p.role]) return ROLE_RGB[p.role];
    const t = typeof getVipTier === 'function' ? getVipTier(p) : null;
    return t ? t.rgb : null;
  };
  P.avatar = (p, nick, size = 36) => {
    const n = (p?.nick || nick || '?'), rgb = P.rgb(p);
    const ini = esc((n.replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, '') || '?').slice(0, 2).toUpperCase());
    const url = p?.avatar_url && typeof safeImgUrl === 'function' ? safeImgUrl(p.avatar_url) : '';
    const bg = url ? `url('${url}') center/cover` : rgb ? `linear-gradient(135deg,rgb(${rgb}),rgba(${rgb},.55))` : `hsl(${hashHue(n)} 55% 42%)`;
    return `<span class="ph-ava" style="width:${size}px;height:${size}px;background:${bg};font-size:${Math.round(size * .36)}px">${url ? '' : ini}</span>`;
  };
  P.nick = (p, nick) => {
    const n = p?.nick || nick || 'игрок', rgb = P.rgb(p);
    const badge = p?.role === 'admin' ? ' <i class="ph-role">ADMIN</i>' : p?.role === 'moderator' ? ' <i class="ph-role mod">MOD</i>' : '';
    return `<span class="ph-nick"${rgb ? ` style="color:rgb(${rgb})"` : ''}>${esc(n)}</span>${badge}`;
  };
  function hashHue(s){ let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

  // ── Звуки (WebAudio, без файлов) ──
  let actx = null;
  P.audioCtx = () => {
    try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume().catch(() => {}); } catch (e) { actx = null; }
    return actx;
  };
  // ноты: [частота, длительность, пауза после, тип]
  P.tone = (notes, vol = 1) => {
    const ctx = P.audioCtx(); if (!ctx) return 0;
    const out = ctx.createGain(); out.gain.value = Math.max(0, Math.min(1, vol * P.set.vol)) * .32; out.connect(ctx.destination);
    let t = ctx.currentTime + .02;
    for (const [f, d, gap = 0, type = 'sine'] of notes) {
      if (f) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = f;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + .012); g.gain.setValueAtTime(1, t + d * .6); g.gain.exponentialRampToValueAtTime(.001, t + d);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + d + .03);
      }
      t += d + gap;
    }
    setTimeout(() => { try { out.disconnect(); } catch (e) {} }, (t - ctx.currentTime) * 1000 + 300);
    return t - ctx.currentTime;
  };
  P.RINGS = {
    classic: { t: 'Классика', n: [[784, .12], [988, .12], [1175, .2, .08], [784, .12], [988, .12], [1175, .2]] },
    mir: { t: 'Мир Денчика', n: [[523, .1], [659, .1], [784, .1], [1047, .22, .06], [784, .1], [1047, .3]] },
    pulse: { t: 'Пульс', n: [[880, .09, .06, 'square'], [880, .09, .06, 'square'], [880, .09, .3, 'square'], [1320, .09, .06, 'square'], [1320, .09, 0, 'square']] },
  };
  P.sfx = kind => {
    if (!P.set.sounds && kind !== 'ring') return;
    if (kind === 'msg') P.tone([[1046, .07], [1568, .12]], .6);
    else if (kind === 'tap') P.tone([[1400, .025]], .25);
    else if (kind === 'join') P.tone([[660, .07], [990, .11]], .5);
    else if (kind === 'leave') P.tone([[990, .07], [660, .11]], .5);
    else if (kind === 'hang') P.tone([[480, .14], [360, .2]], .6);
    else if (kind === 'ring') P.tone((P.RINGS[P.set.ring] || P.RINGS.classic).n, 1);
  };

  // ── Значки непрочитанного: элементы с data-ph-badge="total|msgs|calls|…" обновляются сами ──
  function setBadge(k, n){
    n = Math.max(0, n | 0); if (badges[k] === n) return; badges[k] = n; renderBadges();
    try { window.dispatchEvent(new CustomEvent('d37:badges', { detail: Object.assign({}, badges) })); } catch (e) {}   // приложение 📲: число на значке (app.js)
  }
  P.badge = (k, n) => n === undefined ? badges[k] || 0 : setBadge(k, n);
  P.total = () => badges.msgs + badges.calls + badges.friends + badges.comm;
  function renderBadges(){
    document.querySelectorAll('[data-ph-badge]').forEach(el => {
      const k = el.dataset.phBadge, n = k === 'total' ? P.total() : badges[k] || 0;
      el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n);
    });
  }
  P.renderBadges = renderBadges;
  // значки новых уведомлений (community.sql) в колокольчике 🔔
  if (typeof NOTIF_ICON !== 'undefined') Object.assign(NOTIF_ICON, { cm_mention: '@', cm_reply: '↩️', chat_reply: '↩️', cm_mod: '🔇', cm_report: '🚩', call_missed: '📞' });
  window.addEventListener('d37:dm-unread', e => setBadge('msgs', +e.detail || 0));
  window.addEventListener('d37:notif', e => { setBadge('notif', +e.detail || 0); });
  window.addEventListener('d37:dm', e => { if (isOpen && cur && cur.startsWith('msgs')) return; if (P.me() && e.detail?.sender_id !== P.me() && !P.callCode?.(e.detail?.text)) P.sfx('msg'); });

  // ── Корпус телефона ──
  function build(){
    if (root) return root;
    root = document.createElement('div');
    root.className = 'ph'; root.id = 'd37Phone'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Телефон'); root.tabIndex = -1;
    root.innerHTML = `<div class="ph-dev"><div class="ph-scr">
        <div class="ph-bar"><b class="ph-clock"></b><span class="ph-island"></span><span class="ph-sys"><i class="ph-net"></i><i class="ph-bat"></i></span></div>
        <button type="button" class="ph-live" hidden></button>
        <div class="ph-view"></div>
        <div class="ph-toast" hidden></div>
        <div class="ph-sheet-wrap" hidden><div class="ph-sheet"></div></div>
        <button type="button" class="ph-homebar" aria-label="Домой"></button>
      </div></div>
      <button type="button" class="ph-close" aria-label="Закрыть телефон" title="Закрыть (P / Esc)">✕</button>`;
    document.body.appendChild(root);
    view = root.querySelector('.ph-view');
    root.querySelector('.ph-homebar').onclick = () => { P.sfx('tap'); P.go('', true); };
    root.querySelector('.ph-close').onclick = () => P.close();
    root.querySelector('.ph-live').onclick = () => { if (window.D37Calls?.liveTarget) P.go(window.D37Calls.liveTarget()); };
    root.querySelector('.ph-sheet-wrap').addEventListener('click', e => { if (e.target.classList.contains('ph-sheet-wrap')) P.closeSheet(); });
    root.addEventListener('click', e => {
      const a = e.target.closest('a[href]');
      if (a && root.contains(a)) {
        const h = a.getAttribute('href') || '';
        if (h.startsWith('#/phone/')) { e.preventDefault(); P.go(h.slice(8)); return; }
        const inv = /^#\/c\/([a-z0-9]{6,12})$/.exec(h);   // приглашение в сообщество — прямо в телефоне
        if (inv) { e.preventDefault(); P.go('comm/join/' + inv[1]); return; }
        const evm = /^#\/chat\/ev\/(\d{1,12})$/.exec(h);   // событие (community2.sql) — тоже в телефоне
        if (evm) { e.preventDefault(); P.go('comm/ev/' + evm[1]); return; }
        if (h.startsWith('#/') && !docked) setTimeout(() => P.close(), 0);   // переход по сайту — телефон убираем
      }
    });
    tickClock(); setInterval(tickClock, 15000);
    return root;
  }
  function tickClock(){ const c = root?.querySelector('.ph-clock'); if (c) c.textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }

  // ── Открыть / закрыть ──
  P.isOpen = () => isOpen;
  P.isDocked = () => docked;
  P.open = (path, opt = {}) => {
    build();
    if (!isOpen) {
      isOpen = true; openedByCall = !!opt.byCall;
      returnFocus = document.activeElement;
      root.hidden = false;
      document.documentElement.classList.add('ph-open');
      // персонаж достаёт телефон (3D) — экран выезжает снизу, когда телефон уже в руке; иначе — сразу
      cur = path !== undefined && path !== null ? String(path).replace(/^\/+|\/+$/g, '').replace(/^call\//, 'calls/') : cur;
      const anim = handSync() && !docked;
      root.classList.toggle('ph-rise', anim);
      clearTimeout(slideT);
      if (anim) slideT = setTimeout(() => { if (isOpen) root.classList.add('on'); }, HAND_IN);
      else requestAnimationFrame(() => root.classList.add('on'));
      if (ctx?.hooks.pause) try { ctx.hooks.pause(true); } catch (e) {}
      if (!docked) setTimeout(() => { if (isOpen && !root.contains(document.activeElement)) root.focus({ preventScroll: true }); }, 30);
      refreshCounts();
    } else if (!opt.byCall) openedByCall = false;
    if (path !== undefined && path !== null) P.go(path, true);
    else if (!cur && cur !== '') P.go('', true);
    else if (!view.childElementCount) P.go(cur || '', true);
  };
  P.close = () => {
    if (!isOpen || docked) return;
    isOpen = false; openedByCall = false;
    P.closeSheet();
    clearTimeout(slideT);
    root.classList.remove('on');
    document.documentElement.classList.remove('ph-open');
    setTimeout(() => { if (!isOpen) root.hidden = true; }, root.classList.contains('ph-rise') ? 240 : 180);
    runCleanup();
    view.innerHTML = '';
    if (ctx?.hooks.pause) try { ctx.hooks.pause(false); } catch (e) {}
    slideT = setTimeout(() => { if (!isOpen) handSync(); }, HAND_OUT);   // сначала уехал экран — потом персонаж убирает телефон
    if (returnFocus && document.body.contains(returnFocus) && returnFocus.focus) try { returnFocus.focus({ preventScroll: true }); } catch (e) {}
    returnFocus = null;
  };
  P.toggle = path => isOpen && !docked ? P.close() : P.open(path);
  // звонок закончился, а телефон открыл сам звонок — убрать
  P.closeIfByCall = () => { if (openedByCall && isOpen && !docked) P.close(); };

  // ── Переходы ──
  function runCleanup(){ const c = cleanup; cleanup = null; if (typeof c === 'function') try { c(); } catch (e) { console.error(e); } }
  P.path = () => cur;
  P.go = async (path, reset) => {
    build();
    path = String(path || '').replace(/^\/+|\/+$/g, '').replace(/^call\//, 'calls/');   // #/phone/call/<код> — войти в звонок
    if (reset) stack = [path]; else if (stack[stack.length - 1] !== path) stack.push(path);
    if (stack.length > 30) stack = stack.slice(-30);
    if (!isOpen) { P.open(path); return; }
    await show(path);
  };
  P.back = () => { if (stack.length > 1) { stack.pop(); show(stack[stack.length - 1]); } else if (cur) { stack = ['']; show(''); } else P.close(); };
  P.replace = path => { stack[stack.length - 1] = path; show(path); };
  P.refresh = () => show(cur || '');
  let showSeq = 0;
  async function show(path){
    const seq = ++showSeq;
    runCleanup();
    P.closeSheet();
    cur = path;
    if (isOpen) handSync();   // камера — снимает, игра — держит боком, звонок — у уха
    const [id, ...rest] = path.split('/');
    if (!id) { renderHome(); return; }
    const app = APPS.find(a => a.id === id) || (id === 'incall' ? { id, mod: 'calls', t: 'Звонок' } : null);
    if (!app) { renderHome(); return; }
    // Возраст (js/core/age.js): сообщества — как чат (12+); не по возрасту — «обложка» (ЛС и звонки — только друзья, их не трогаем)
    const AG = window.D37Age, area = AG?.area('chat');
    if (id === 'comm' && area && !AG.canOpen(area.age)) {
      view.innerHTML = `<div class="ph-app">${P.head(app.t)}<div class="ph-agec"></div></div>`;
      AG.cover(view.querySelector('.ph-agec'), area.age, { why: area.why, title: app.t, compact: true, back: () => P.open(''), onOpen: () => show(path) });
      return;
    }
    if (!defs.has(id)) {
      view.innerHTML = `<div class="ph-app"><div class="ph-load"><i></i>Загружаем…</div></div>`;
      try { await P.need(app.mod); } catch (e) {
        if (seq === showSeq) view.innerHTML = `<div class="ph-app">${P.head(app.t)}<div class="ph-empty"><b>😵 Не загрузилось</b><span>Проверь интернет и попробуй ещё раз.</span></div></div>`;
        return;
      }
      if (seq !== showSeq) return;
    }
    const d = defs.get(id);
    if (!d) { renderHome(); return; }
    view.innerHTML = '';
    const el = document.createElement('div'); el.className = 'ph-app ph-app-' + id; view.appendChild(el);
    try { cleanup = d.render(el, rest.join('/'), ctx?.hooks || null) || null; } catch (e) { console.error(e); el.innerHTML = P.head(app.t) + `<div class="ph-empty"><b>😵 Ошибка</b><span>${esc(e.message || e)}</span></div>`; }
  }
  P.define = (id, d) => { defs.set(id, d); if (isOpen && cur && cur.split('/')[0] === id && !view.querySelector('.ph-app-' + id)) show(cur); };
  // загрузить файл(ы) приложения один раз; общий файл (msgview.js) — тоже один раз на всех
  const files = new Map();
  const loadFile = src => {
    if (files.has(src)) return files.get(src);
    const p = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src + '?v=' + VER;
      s.onload = () => res(); s.onerror = () => { files.delete(src); rej(new Error('не загрузилось: ' + src)); };
      document.head.appendChild(s);
    });
    files.set(src, p);
    return p;
  };
  P.need = name => {
    if (!MODS[name]) return Promise.resolve();
    if (mods.has(name)) return mods.get(name);
    const p = MODS[name].reduce((acc, src) => acc.then(() => loadFile(src)), Promise.resolve());
    p.catch(() => mods.delete(name));
    mods.set(name, p);
    return p;
  };
  // Шапка экрана приложения: ‹ назад, заголовок, кнопки справа
  P.head = (title, right = '', opt = {}) => `<div class="ph-head"><button type="button" class="ph-back" data-ph="back" aria-label="Назад">‹</button><b class="ph-title">${title}</b><span class="ph-acts">${right}</span></div>`;
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-ph="back"]'); if (b && root?.contains(b)) { P.sfx('tap'); P.back(); return; }
    // ссылки #/phone/… на странице (карточка звонка в чате и т.п.) — телефон поверх, со страницы не уходим
    const a = e.target.closest('a[href^="#/phone/"]');
    if (a && !root?.contains(a) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); P.open(a.getAttribute('href').slice(8)); }
  });

  // ── Домашний экран ──
  function renderHome(){
    const d = new Date();
    const live = window.D37Calls?.liveInfo?.();
    const day = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });   // «среда, 15 октября» → «Среда, 15 октября»
    view.innerHTML = `<div class="ph-home">
      <div class="ph-wid"><b>${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</b><span>${esc(day.charAt(0).toUpperCase() + day.slice(1))}</span>
        <div class="ph-wid-info">${P.me() ? '<span class="ph-wid-on">👥 друзья онлайн: …</span>' : '<button type="button" class="ph-wid-login" data-ph-login>🔑 Войди — будут звонки, друзья и сообщества</button>'}${ctx ? `<span>📍 ${esc(ctx.hooks.title || '')}</span>` : ''}${live ? `<span>${esc(live)}</span>` : ''}</div></div>
      <div class="ph-grid">${APPS.filter(a => !DOCK.includes(a.id)).map(appIcon).join('')}${LINKS.map(l => `<a class="ph-icon" href="${l.h}"><i style="background:linear-gradient(135deg,${l.bg})">${l.ic}</i><span>${l.t}</span></a>`).join('')}</div>
      <div class="ph-dock">${DOCK.map(id => appIcon(APPS.find(a => a.id === id))).join('')}</div>
    </div>`;
    view.querySelector('[data-ph-login]')?.addEventListener('click', () => { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); });
    view.querySelectorAll('[data-ph-app]').forEach(b => b.addEventListener('click', () => {
      P.sfx('tap');
      if (b.dataset.phApp === 'settings' && openSettings()) return;   // ⚙️ — общее окно настроек, вкладка «📱 Телефон»
      P.go(b.dataset.phApp);
    }));
    renderBadges();
    if (P.me()) P.online().then(m => { const w = view.querySelector('.ph-wid-on'); if (w) w.textContent = `👥 друзья онлайн: ${m.size}`; });
  }
  const appIcon = a => `<button type="button" class="ph-icon" data-ph-app="${a.id}"><i style="background:linear-gradient(135deg,${a.bg})">${a.ic}${a.b ? `<em class="ph-bdg" data-ph-badge="${a.b}" hidden></em>` : ''}</i><span>${a.t}</span></button>`;

  // ── Нижний лист (действия над сообщением, формы) ──
  P.sheet = (html, onClick) => {
    build();
    const w = root.querySelector('.ph-sheet-wrap'), s = w.firstChild;
    s.innerHTML = `<div class="ph-sheet-grip"></div>${html}`;
    w.hidden = false; requestAnimationFrame(() => w.classList.add('on'));
    s.onclick = e => { const b = e.target.closest('[data-s]'); if (b && onClick) onClick(b.dataset.s, b, s); };
    const inp = s.querySelector('input, textarea'); if (inp && !P.touch()) setTimeout(() => inp.focus(), 60);
    return s;
  };
  P.closeSheet = () => { const w = root?.querySelector('.ph-sheet-wrap'); if (!w || w.hidden) return; w.classList.remove('on'); w.hidden = true; w.firstChild.innerHTML = ''; };
  P.sheetOpen = () => !!root && !root.querySelector('.ph-sheet-wrap').hidden;
  // Спросить (вместо confirm): кнопки [{ k, t, cls }] → Promise<k | null>
  P.ask = (text, btns) => new Promise(res => {
    let done = false;
    P.sheet(`<p class="ph-ask">${text}</p><div class="ph-row">${btns.map(b => `<button type="button" class="ph-btn ${b.cls || ''}" data-s="${esc(b.k)}">${b.t}</button>`).join('')}<button type="button" class="ph-btn ghost" data-s="">Отмена</button></div>`,
      k => { done = true; P.closeSheet(); res(k || null); });
    const w = root.querySelector('.ph-sheet-wrap');
    const obs = new MutationObserver(() => { if (w.hidden) { obs.disconnect(); if (!done) res(null); } });
    obs.observe(w, { attributes: true, attributeFilter: ['hidden'] });
  });
  P.toast = (text, ok) => {
    if (!isOpen) { if (typeof xpToast === 'function') xpToast(text); return; }
    const t = root.querySelector('.ph-toast');
    t.textContent = text; t.className = 'ph-toast' + (ok === false ? ' bad' : ok ? ' ok' : ''); t.hidden = false;
    clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 2600);
  };
  P.touch = () => matchMedia('(pointer: coarse)').matches;
  P.login = (el, text) => {
    el.innerHTML = `<div class="ph-empty"><b>🔑 Нужно войти</b><span>${text}</span><button type="button" class="ph-btn" data-ph-auth>Войти или зарегистрироваться</button></div>`;
    el.querySelector('[data-ph-auth]').onclick = () => { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); };
  };
  P.soon = (el, what) => { el.innerHTML = `<div class="ph-empty"><b>🛠️ Скоро</b><span>${what} появятся, когда сайт обновится. Загляни чуть позже!</span></div>`; };

  // ── Подключение игры (мир, студия) ──
  P.attach = (name, hooks) => {
    const me = { name, hooks: hooks || {} };
    ctx = me;
    // кнопка 📱 в панели игры (у «Студии 3D» — рядом с ⚙️ ⛶: шапки сайта там не видно)
    let btn = null;
    if (hooks?.bar?.appendChild) {
      btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ph-barbtn';
      btn.title = 'Телефон (P): друзья, звонки, сообщения'; btn.setAttribute('aria-label', 'Телефон');
      btn.innerHTML = '📱<em class="ph-bdg" data-ph-badge="total" hidden></em>';
      btn.addEventListener('click', ev => { ev.stopPropagation(); P.toggle(); });
      hooks.bar.insertBefore(btn, hooks.bar.firstChild);
      renderBadges();
    }
    if (isOpen && hooks?.pause) try { hooks.pause(true); } catch (e) {}
    hand = ''; handSync();   // разговор уже идёт — персонаж сразу у уха (вошёл в мир во время звонка)
    setTimeout(() => actCheck(true), 300);
    if (pendingTp) tryPendingTp();
    return () => {
      btn?.remove();
      if (ctx !== me) return;
      if (isOpen && me.hooks.pause) try { me.hooks.pause(false); } catch (e) {}
      ctx = null;
      if (isOpen && (cur === 'map' || cur === 'camera')) P.refresh();
      setTimeout(() => actCheck(true), 300);
    };
  };
  P.ctx = () => ctx?.hooks || null;
  P.ctxName = () => ctx?.name || '';
  // Телепорт к другу после перехода в мир: мир ещё грузится — ждём до 25 с, пока друг появится рядом
  let pendingTp = null;
  P.goToFriend = (uid, shard) => {
    pendingTp = { uid, shard: +shard || 0, t: Date.now() };
    if (ctx?.name === 'world') tryPendingTp();
    else location.hash = '#/games/world';
  };
  function tryPendingTp(){
    const tp = pendingTp; if (!tp || ctx?.name !== 'world') return;
    if (Date.now() - tp.t > 25000) { pendingTp = null; P.toast('Друга в мире не видно — может, он уже ушёл', false); return; }
    const h = ctx.hooks;
    if (tp.shard && h.shard && h.shard() !== tp.shard && !tp.switched) { tp.switched = true; h.shard(tp.shard); }
    if (h.toFriend?.(tp.uid)) { pendingTp = null; P.toast('🌍 Ты рядом с другом!', true); return; }
    setTimeout(tryPendingTp, 700);
  }

  // Полный экран сайта (D37Full) — на всю страницу: телефон и плашка звонка в body и так видны (z-index выше слоя игры 9100).
  // Если что-то развернули само (Fullscreen API на элементе) — видно только его содержимое: переносим телефон туда.
  document.addEventListener('fullscreenchange', () => {
    const fs = document.fullscreenElement;
    const host = fs && fs !== document.documentElement && fs !== document.body && fs.tagName !== 'IFRAME' && fs.tagName !== 'VIDEO' ? fs : document.body;
    if (root && !docked && root.parentElement !== host) host.appendChild(root);
    renderBadges();
  });

  // ── Клавиши: P — телефон (в мире/студии), Esc — назад/закрыть. Забираем клавишу целиком (stopImmediatePropagation):
  //    управление игры её не видит — иначе Esc, закрывший телефон, в следующем шаге открыл бы меню паузы мира ──
  const eat = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (window.D37Settings?.isOpen?.()) return;   // поверх открыто окно ⚙️ — Esc его
    const typing = !!e.target?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
    if (isOpen) {
      if (e.code === 'Escape') {
        if (P.sheetOpen()) P.closeSheet(); else if (docked || stack.length > 1 || cur) P.back(); else P.close();
        eat(e); return;
      }
      if (e.code === 'KeyP' && !typing && !docked && !e.repeat) { P.close(); eat(e); }
      return;
    }
    if (e.code === 'KeyP' && !typing && !e.repeat && ctx?.hooks.hotkey && !document.querySelector('.wld-edit')) { P.open(); eat(e); }
  }, true);

  // ── Маршруты сайта: #/phone/<путь> и #/c/<код> ──
  window.phoneRoute = (route, param) => {
    build();
    const host = document.getElementById('phoneDock');
    if (host && root.parentElement !== host) {
      if (ctx?.hooks.pause && isOpen) try { ctx.hooks.pause(false); } catch (e) {}
      host.appendChild(root);
    }
    docked = !!host;
    root.classList.add('docked');
    isOpen = false;
    P.open(route === 'c' ? 'comm/join/' + String(param || '').replace(/[^a-z0-9]/gi, '').toLowerCase() : decodeURIComponent(param || ''));
  };
  window.addEventListener('hashchange', () => {
    if (!docked || /^#\/(phone|c)(\/|$)/.test(location.hash)) return;
    docked = false;
    root.classList.remove('docked', 'on');
    isOpen = false; root.hidden = true; runCleanup(); view.innerHTML = '';
    document.body.appendChild(root);
  });

  // ── Входящий звонок: личное сообщение со ссылкой #/phone/call/<код> (ЛС может прислать только друг — так устроены
  //    правила ЛС на сервере, новых таблиц не нужно). Слышно на любой странице сайта, в мире и в играх, пока вошёл. ──
  const CALL_RE = /#\/phone\/call\/([a-z0-9]{8,16})/;
  P.callCode = text => (CALL_RE.exec(String(text || '')) || [])[1] || null;
  window.addEventListener('d37:dm', ev => {
    const m = ev.detail; if (!m || m.sender_id === P.me()) return;
    const code = P.callCode(m.text); if (!code) return;
    if (Date.now() - Date.parse(m.created_at) > 45000) return;
    P.need('calls').then(() => window.D37Calls?.incoming(m, code)).catch(() => {});
  });
  // Пропущенные (браузер): id сообщений-вызовов, на которые не ответили
  const MISSED_KEY = 'd37_missed';
  P.missed = {
    list(){ try { return JSON.parse(localStorage.getItem(MISSED_KEY) || '[]') || []; } catch (e) { return []; } },
    add(x){ const l = P.missed.list().filter(y => y.id !== x.id); l.unshift(x); try { localStorage.setItem(MISSED_KEY, JSON.stringify(l.slice(0, 30))); } catch (e) {} setBadge('calls', l.length); },
    clear(){ try { localStorage.removeItem(MISSED_KEY); } catch (e) {} setBadge('calls', 0); },
  };
  setBadge('calls', P.missed.list().length);

  // ═══ Чем я занят (друзьям — «в Мире, сервер 2», «играет в шахматы», «в мире игрока», и кнопка «📍 К другу») ═══
  // Код занятия — части через «|»: w:<сервер мира>, g:<игра>, j:<путь комнаты, куда можно прийти>, s:<мир игрока>,
  // t:<название мира>, v (смотрит ролики), ch (в чате), c (в звонке). Публикуется в общем «кто онлайн» сайта (chat.js,
  // только у профилей «видят все», невидимку — нет), а с community.sql — ещё и друзьям через comm_ping/friends_online.
  // Игра поверх мира (или любой модуль) может уточнить: D37Phone.setActivity({ g: 'chess', j: 'games/chess/abc123' }), сброс — setActivity(null).
  let extraAct = {};
  P.setActivity = patch => { extraAct = patch ? Object.assign({}, extraAct, patch) : {}; actCheck(true); };
  const JOIN_RE = /^games\/(?:[a-z0-9]+\/(?:coop\/)?[a-z0-9]{4,12}|studio3d\/play\/[A-Za-z0-9]{4,16}(?:\/[a-z0-9]{4,12})?|studio3d\/join\/[a-z0-9]{4,12}|unity\/play\/[A-Za-z0-9]{4,16}(?:\/[a-z0-9]{4,12})?|studio\/play\/[A-Za-z0-9]{4,16})$/;
  P.activity = () => {
    const a = {};
    try { Object.assign(a, ctx?.hooks.activity?.() || {}); } catch (e) {}
    const ga = typeof gamesActive !== 'undefined' ? gamesActive : null;
    if (ga && ga !== 'world' && ga !== 'studio3d' && !a.g) {
      a.g = ga;
      const path = location.hash.replace(/^#\//, '');
      if (JOIN_RE.test(path) && path.split('/')[1] === ga && path.split('/').length > 2) a.j = path;
    }
    Object.assign(a, extraAct);
    if (!a.w && !a.g && !a.s) {
      const r = typeof currentRoute === 'function' ? currentRoute() : '';
      if (r === 'home' || r === 'shorts' || document.getElementById('modal')?.classList.contains('open')) a.v = 1;
      else if (r === 'chat') a.ch = 1;
    }
    if (window.D37Calls?.inCall?.()) a.c = 1;
    return a;
  };
  P.actCode = a => [a.w ? 'w:' + a.w : '', a.g ? 'g:' + a.g : '', a.s ? 's:' + a.s : '', a.j ? 'j:' + a.j : '', a.t ? 't:' + String(a.t).replace(/[|]/g, ' ').slice(0, 32) : '', a.v ? 'v' : '', a.ch ? 'ch' : '', a.c ? 'c' : ''].filter(Boolean).join('|');
  // Чужой код занятия (из presence — не доверяем): только знакомые части и безопасные значения
  P.actParse = code => {
    const a = {};
    for (const part of String(code || '').slice(0, 200).split('|')) {
      const i = part.indexOf(':'), k = i < 0 ? part : part.slice(0, i), v = i < 0 ? '' : part.slice(i + 1);
      if (k === 'w' && /^\d{1,2}$/.test(v)) a.w = +v;
      else if (k === 'g' && /^[a-z0-9]{2,16}$/.test(v)) a.g = v;
      else if (k === 's' && /^[A-Za-z0-9]{4,16}$/.test(v)) a.s = v;
      else if (k === 'j' && JOIN_RE.test(v)) a.j = v;
      else if (k === 't' && v) a.t = P.clean(v.slice(0, 32));
      else if (k === 'v' || k === 'ch' || k === 'c') a[k] = 1;
    }
    return a;
  };
  P.actText = a => {
    if (!a) return '';
    const g = a.g && typeof GAMES !== 'undefined' ? GAMES.find(x => x.id === a.g) : null;
    const parts = [];
    if (a.w) parts.push(`🌍 В Мире, сервер ${a.w}`);
    if (a.s || (a.j || '').startsWith('games/studio3d/')) parts.push(`🧱 В мире игрока${a.t ? ` «${a.t}»` : ''}`);
    else if (g) parts.push(`${g.icon} ${a.w ? 'играет' : 'Играет'} в «${g.title}»`);
    else if (a.g) parts.push('🎮 Играет');
    if (!parts.length && a.v) parts.push('🎬 Смотрит ролики');
    if (!parts.length && a.ch) parts.push('💬 В чате');
    if (a.c) parts.push('📞 в звонке');
    return parts.join(' · ') || '🟢 На сайте';
  };
  // Куда «📍 К другу»: в его сервер мира (и к нему) или в его комнату игры / мир игрока
  P.actJoin = a => {
    if (a?.j) { const g = typeof GAMES !== 'undefined' ? GAMES.find(x => x.id === a.j.split('/')[1]) : null; return { hash: '#/' + a.j, label: a.j.startsWith('games/studio3d/') ? '📍 В его мир' : `📍 В комнату${g ? ' — ' + g.title : ''}` }; }
    if (a?.w) return { world: a.w, label: `📍 К другу (сервер ${a.w})` };
    return null;
  };
  P.goJoin = (uid, a) => {
    const t = P.actJoin(a); if (!t) return;
    if (t.world) P.goToFriend(uid, t.world);
    else { if (!docked) P.close(); location.hash = t.hash; }
  };
  // Статус друзей: из общего «кто онлайн» (профили «видят все») + с community.sql — friends_online (и «видят друзья»)
  P.friendStatus = async ids => {
    const out = new Map();
    const on = window.D37Chat?.online?.() || { users: [] };
    for (const u of on.users) if (ids.includes(u.id)) out.set(u.id, { online: true, a: P.actParse(u.a) });
    const m = await P.online();
    for (const [id, x] of m) if (ids.includes(id)) out.set(id, { online: true, a: P.actParse(x.place), seen: x.seen });
    return out;
  };
  // Занятие сменилось — в «кто онлайн» (не чаще раза в 15 с) и друзьям (comm_ping)
  let lastAct = '';
  function actCheck(force){
    const code = P.actCode(P.activity());
    if (code === lastAct && !force) return;
    lastAct = code;
    if (typeof trackOnline === 'function') trackOnline();
    ping(true);
  }
  P.actNow = () => lastAct;
  setInterval(() => actCheck(false), 5000);
  window.addEventListener('hashchange', () => setTimeout(() => actCheck(false), 1500));

  // ── «Я онлайн» для друзей (community.sql): раз в минуту, пока вкладка видна ──
  let pingOff = false, lastPing = 0, lastPlace = '';
  const place = () => P.actCode(P.activity()) || 'site';
  async function ping(force){
    if (!P.me() || pingOff || document.hidden) return;
    const pl = place();
    if (!force && Date.now() - lastPing < 55000 && pl === lastPlace) return;
    if (force && Date.now() - lastPing < 4000 && pl === lastPlace) return;
    lastPing = Date.now(); lastPlace = pl;
    const { error } = await P.rpc('comm_ping', { p_place: pl });
    if (error && P.missing(error)) pingOff = true;
  }
  P.ping = ping;
  setInterval(() => ping(false), 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(false); });
  window.addEventListener('hashchange', () => setTimeout(() => ping(true), 1200));

  // ── Счётчики при входе и открытии ──
  async function refreshCounts(){
    if (!P.me()) return;
    if (typeof dmUnreadCount !== 'undefined') setBadge('msgs', dmUnreadCount);
    if (typeof notifUnread !== 'undefined') setBadge('notif', notifUnread);
    P.friends(false).catch(() => {});
  }
  window.addEventListener('d37:auth', () => {
    if (P.me()) { ping(true); refreshCounts(); }
    else { for (const k in badges) badges[k] = 0; renderBadges(); friendsCache = null; onlineCache = null; window.D37Calls?.leave?.(); }
    if (isOpen) P.refresh();
  });
  if (P.me()) setTimeout(() => { ping(true); refreshCounts(); }, 0);

  // ── Камера: снимок холста 3D (до 1280 px, jpeg) ──
  P.snap = (canvas, max = 1280) => {
    const k = Math.min(1, max / Math.max(canvas.width, canvas.height));
    const c = document.createElement('canvas'); c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', .86);
  };

  // ═══ ⚙️ Настройки телефона — вкладка «📱 Телефон» в общем окне настроек (js/core/settings.js) ═══
  // Значения свои (P.set, d37_phone): их читают звуки телефона и calls.js. Громкость собеседников — «🔊 Звук → Голос» (D37Opt.volVoice).
  function openSettings(){
    const SS = window.D37Settings; if (!SS?.open) return false;
    SS.open({ tab: 'phone' });
    return true;
  }
  P.openSettings = openSettings;
  P.define('settings', {   // ссылка #/phone/settings: окно настроек поверх телефона
    render(el){
      el.innerHTML = P.head('⚙️ Настройки') + `<div class="ph-empty"><b>⚙️ Настройки телефона</b><span>Мелодия, кто может звонить, рация и заблокированные — в общем окне настроек, вкладка «📱 Телефон».</span><button type="button" class="ph-btn" data-ph-set>Открыть настройки</button></div>`;
      el.querySelector('[data-ph-set]').onclick = () => { if (!openSettings()) P.toast('Окно настроек не загрузилось — обнови страницу', false); };
      setTimeout(openSettings, 0);
    },
  });
  const KEYN = { Backquote: 'Ё', Space: 'Пробел', CapsLock: 'Caps Lock', Quote: 'Э', Semicolon: 'Ж', BracketLeft: 'Х', BracketRight: 'Ъ', Comma: 'Б', Period: 'Ю', Slash: '.', Backslash: '\\', Minus: '−', Equal: '=' };
  P.keyName = c => KEYN[c] || String(c || '').replace(/^Key|^Digit/, '').replace(/(Left|Right)$/, '') || '—';
  (function settingsTab(){
    const SS = window.D37Settings; if (!SS?.addTab) return;
    const row = (label, ctl, hint) => `<div class="gs-row"><div class="gs-lbl"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</div><div class="gs-ctl">${ctl}</div></div>`;
    const seg = (k, opts) => `<div class="gs-seg" role="radiogroup">${opts.map(([v, t]) => { const on = (P.set[k] || opts[0][0]) === v; return `<button type="button" role="radio" aria-checked="${on}" class="${on ? 'on' : ''}" data-phs="${k}" data-v="${v}">${t}</button>`; }).join('')}</div>`;
    const sw = k => `<label class="gs-sw"><input type="checkbox" data-phw="${k}"${P.set[k] ? ' checked' : ''}><i aria-hidden="true"></i></label>`;
    const localBlocks = () => { try { return JSON.parse(localStorage.getItem('d37_blocks_local') || '[]') || []; } catch (e) { return []; } };
    SS.addTab({ id: 'phone', icon: '📱', title: 'Телефон', order: 60, ctx: ['engine', 'game', 'site'], render(body){
      const box = document.createElement('div'); body.appendChild(box);
      let capturing = false;
      const draw = () => {
        const s = P.set, v = Math.round((s.vol ?? .8) * 100);
        box.innerHTML = '<div class="gs-sec">Звонки</div>'
          + row('Кто может звонить', seg('calls', [['friends', '🤝 Друзья'], ['nobody', '🔕 Никто']]), 'Звонить могут только друзья. «Никто» — телефон молчит, вызовы попадут в пропущенные.')
          + row('Мелодия', `${seg('ring', Object.entries(P.RINGS).map(([k, r]) => [k, r.t]))} <button type="button" class="gs-btn" data-pht="ring" title="Послушать" aria-label="Послушать мелодию">▶</button>`)
          + row('Громкость мелодии', `<div class="gs-range"><input type="range" min="0" max="100" step="5" value="${v}" data-phr="vol" aria-label="Громкость мелодии"><output>${v}%</output></div>`, 'И звуки телефона.')
          + row('Звуки телефона', sw('sounds'), 'Новое сообщение, нажатия.')
          + '<div class="gs-sec">Голос</div>'
          + row('Шумоподавление', sw('ns'), 'Выключи, если голос звучит «как под водой».')
          + row('Рация', sw('ptt'), 'Говоришь, только пока держишь клавишу. На телефоне — кнопка «📻 Держи, чтобы говорить» в разговоре.')
          + row('Клавиша рации', `<button type="button" class="gs-key${capturing ? ' cap' : ''}" data-pht="key">${capturing ? 'Нажми клавишу…' : esc(P.keyName(s.pttKey || 'Backquote'))}</button>`, capturing ? 'Нажми нужную клавишу.' : '')
          + '<p class="gs-note">Громкость собеседников — во вкладке «🔊 Звук» → «Голос».</p>'
          + '<div class="gs-sec">Заблокированные</div><div data-phb><p class="gs-note">Загружаем…</p></div>'
          + '<p class="gs-note">Кто видит профиль и чем ты занят, невидимка — во вкладке «🌐 Сайт» → «Профиль и приватность».</p>';
        blocks();
      };
      async function blocks(){
        let ids = localBlocks();
        if (P.me()) { try { await P.need('mv'); await window.MsgView?.loadBlocks?.(); ids = [...new Set([...ids, ...(window.MsgView?.blocked || [])])]; } catch (e) {} }
        const el = box.querySelector('[data-phb]'); if (!el || !box.isConnected) return;
        if (!ids.length) { el.innerHTML = '<p class="gs-note">Никого. Заблокировать — нажми на ник в чате → «🚫 Заблокировать».</p>'; return; }
        await P.profiles(ids);
        if (!box.isConnected) return;
        el.innerHTML = ids.map(id => { const p = P.prof(id) || {}; return row(`${P.avatar(p, p.nick, 26)} ${esc(p.nick || 'игрок')}`, `<button type="button" class="gs-btn" data-phu="${esc(id)}">Разблокировать</button>`); }).join('');
      }
      // клавиша рации: следующее нажатие (Esc закрывает окно настроек — тогда ждать перестаём)
      const onCap = e => {
        window.removeEventListener('keydown', onCap, true);
        if (!capturing || !box.isConnected) return;
        e.preventDefault(); e.stopImmediatePropagation();
        capturing = false;
        if (e.code && e.code !== 'Escape') { P.set.pttKey = e.code; P.saveSet(); }
        draw();
      };
      box.addEventListener('click', async ev => {
        const t = ev.target.closest('button'); if (!t || t.disabled) return;
        const d = t.dataset;
        if (d.phs) { P.set[d.phs] = d.v; P.saveSet(); draw(); if (d.phs === 'ring') P.sfx('ring'); }
        else if (d.pht === 'ring') P.sfx('ring');
        else if (d.pht === 'key') { if (capturing) return; capturing = true; draw(); setTimeout(() => window.addEventListener('keydown', onCap, true), 0); }
        else if (d.phu) {
          t.disabled = true;
          try { localStorage.setItem('d37_blocks_local', JSON.stringify(localBlocks().filter(x => x !== d.phu))); } catch (e) {}
          if (P.me() && window.MsgView?.block) { const r = await window.MsgView.block(d.phu, false); if (!r.ok) { t.disabled = false; P.toast(r.err || 'Не получилось', false); return; } }
          else window.MsgView?.blocked?.delete?.(d.phu);
          window.dispatchEvent(new Event('d37:blocks'));
          blocks();
        }
      });
      box.addEventListener('input', ev => {
        const t = ev.target; if (t.dataset.phr !== 'vol') return;
        P.set.vol = Math.max(0, Math.min(1, +t.value / 100)); P.saveSet();
        const o = t.parentElement.querySelector('output'); if (o) o.textContent = t.value + '%';
      });
      box.addEventListener('change', ev => {
        const t = ev.target;
        if (t.dataset.phw) { P.set[t.dataset.phw] = t.checked; P.saveSet(); }
        else if (t.dataset.phr === 'vol') P.sfx('ring');   // отпустил ползунок — послушать
      });
      draw();
    } });
  })();

  P._test = { clean: P.clean, APPS, place, MODS };
  renderBadges();
})();
