// ═══════════════════════════════════════
//  «КАК ДИСКОРД» — раздел #/chat и приложение «Сообщества» в телефоне 📱. Слева серверы: официальный «Денчик37» (общий
//  чат сайта, chat.js) и сообщества игроков (community.sql), дальше каналы, лента (MsgView — msgview.js) и участники.
//  Компьютер: всё в ряд. Телефон (узко): каналы и участники — выдвижные панели, как в мобильном Дискорде. В телефоне 📱 —
//  те же куски по экранам (серверы+каналы → лента → участники).
// ═══════════════════════════════════════
// Адреса: #/chat[/<канал сайта>] (general, games, lfg, memes, voice, twitch, reports), #/chat/c/<id>[/<канал>|members|settings|reports],
// #/chat/find, #/chat/new, #/chat/join/<код>, приглашение #/c/<код> → join. В телефоне: comm, comm/<сервер>[/<канал>…] (сервер d37 или id).
// Сообщества без community.sql: «появятся, когда сайт обновится», общий чат работает как раньше.
(() => {
  const P = window.D37Phone, MV = window.MsgView;
  const DS = window.D37DS = window.D37DS || {};
  const OFF_ID = 'd37';
  const e = s => esc(s);
  const PLANNED = [['games', 'игры'], ['lfg', 'поиск-тиммейтов'], ['memes', 'мемы'], ['voice', 'Голосовой', 'voice']];
  const ICONS = ['💬', '🎮', '🏰', '⚔️', '🧟', '🎨', '🎵', '📚', '⚽', '🏎️', '🐱', '🐉', '🌍', '🚀', '💎', '🔥', '👑', '🍕', '🎬', '🧩', '♟️', '🃏', '🛠️', '🌸'];
  const REASON = {
    auth: 'нужно войти', name: 'название — от 2 до 40 символов', about: 'описание — до 300 символов', bad: 'без мата, пожалуйста', link: 'ссылки нельзя',
    limit: 'достигнут предел', too_fast: 'не так быстро — подожди немного', joined: 'ты уже в 50 сообществах', not_found: 'не найдено', banned: 'тебя забанили в этом сообществе',
    full: 'в сообществе уже 500 человек', owner: 'владелец не может выйти — передай сообщество или удали его', rights: 'нет прав', member: 'сначала вступи',
    muted: 'тебя заглушили', mods_only: 'здесь пишут только модераторы', len: 'слишком длинно (до 1000 символов)', rate: 'слишком часто — подожди', slow: 'медленный режим',
    repeat: 'не повторяй одно и то же', flood: 'флуд запрещён', old: 'изменять можно 48 часов', emoji: 'такой реакции нет', many: 'слишком много разных реакций',
    self: 'с собой так нельзя', last: 'последний текстовый канал не удалить', kind: 'неверный тип', role: 'неверная роль', minutes: 'неверный срок', private: 'сообщество закрытое — вступить можно только по приглашению',
  };
  const why = (r, def = 'не получилось') => r?.error ? (r.missing ? 'появится, когда сайт обновится' : P.err(r.error)) : REASON[r?.data?.reason] || r?.data?.reason || def;

  // ═══ Данные сообществ ═══
  const S = { my: [], myAt: 0, sql: null, cache: new Map(), members: new Map(), pub: null };
  async function loadMy(fresh){
    if (!P.me()) { S.my = []; return S.my; }
    if (!fresh && Date.now() - S.myAt < 30000) return S.my;
    const r = await P.rpc('cm_my');
    if (r.error) { if (r.missing) S.sql = false; return S.my; }
    S.sql = true; S.my = r.data || []; S.myAt = Date.now();
    commBadge();
    return S.my;
  }
  async function openC(cid, fresh){
    const c = S.cache.get(cid);
    if (!fresh && c && Date.now() - c.t < 20000) return c.d;
    const r = await P.rpc('cm_open', { p_id: cid });
    if (r.error) return { ok: false, reason: r.missing ? 'soon' : 'error', err: P.err(r.error) };
    S.cache.set(cid, { t: Date.now(), d: r.data });
    return r.data;
  }
  async function membersOf(cid, fresh){
    const c = S.members.get(cid);
    if (!fresh && c && Date.now() - c.t < 60000) return c.list;
    const r = await P.rpc('cm_members', { p_id: cid });
    const list = r.data || [];
    S.members.set(cid, { t: Date.now(), list });
    P.profiles(list.map(m => m.id));
    return list;
  }
  const dropC = cid => { S.cache.delete(cid); S.members.delete(cid); S.myAt = 0; };
  // Точка «есть новое» у сообщества: последнее сообщение новее, чем когда открывал его в последний раз
  const commUnread = c => c.last_id && c.last_id > MV.lastRead('cc:' + c.id);
  function commBadge(){
    const n = S.my.filter(commUnread).length + Object.values(window.D37Chat?.mentions || {}).reduce((a, b) => a + b, 0);
    P.badge('comm', n);
  }
  DS.refreshBadge = () => loadMy(true).then(commBadge);

  // Сообщение сообщества → сообщение ленты
  const cmMsg = r => ({ id: r.id, uid: r.user_id || null, nick: r.nick || 'игрок', text: r.text || '', at: r.created_at, reply: r.reply_to || null,
    edited: r.edited_at || null, deleted: !!r.deleted, hidden: !!r.hidden, reactions: r.reactions || {}, pinned: !!r.pinned_at, ch: r.channel_id });

  // ═══ Адаптер канала сообщества для MsgView ═══
  function commAdapter(C, ch){
    const cid = C.c.id, chId = ch.id, me = P.me();
    const isMod = C.role === 'owner' || C.role === 'mod' || !!C.staff;
    const roles = new Map();
    membersOf(cid).then(list => list.forEach(m => roles.set(m.id, m.role)));
    const myReacts = async ids => {
      if (!me || !ids.length) return new Map();
      const { data } = await sbClient.from('community_reactions').select('message_id, emoji').in('message_id', ids);
      const m = new Map(); (data || []).forEach(r => { if (!m.has(r.message_id)) m.set(r.message_id, new Set()); m.get(r.message_id).add(r.emoji); });
      return m;
    };
    const withMine = async list => { const mine = await myReacts(list.map(x => x.id)); list.forEach(x => { x.myReacts = mine.get(x.id) || new Set(); }); return list; };
    const rpcOk = async (fn, args, okMsg) => { const r = await P.rpc(fn, args); return r.data?.ok ? { ok: true, msg: okMsg, data: r.data } : { ok: false, msg: '⚠️ ' + why(r), err: why(r) }; };
    const modList = uid => {
      if (!isMod || !uid || uid === me) return [];
      const tr = roles.get(uid);
      if (!C.staff && C.role === 'mod' && tr && tr !== 'member') return [];
      return [['mute10', '🔇 Мут 10 мин'], ['mute60', '🔇 Мут 1 час'], ['mute1440', '🔇 Мут 1 день'], ['kick', '👢 Выгнать'], ['ban', '⛔ Забанить'], ['banpurge', '⛔ Бан + удалить сообщения за сутки']];
    };
    const doMod = async (k, uid, nick) => {
      if (k.startsWith('mute')) { const min = +k.slice(4); return rpcOk('cm_mute', { p_community: cid, p_user: uid, p_minutes: min }, `🔇 ${nick} заглушён`); }
      if (k === 'kick') return rpcOk('cm_kick', { p_community: cid, p_user: uid }, `👢 ${nick} выгнан`);
      if (k === 'ban' || k === 'banpurge') return rpcOk('cm_ban', { p_community: cid, p_user: uid, p_reason: '', p_minutes: 0, p_purge: k === 'banpurge' }, `⛔ ${nick} забанен`);
      return { ok: false };
    };
    let typ = null;
    return {
      key: 'c:' + chId, title: '#' + ch.name, maxLen: 1000, placeholder: `Написать в #${ch.name}`, community: cid,
      startText: `Это начало канала #${ch.name} сообщества «${C.c.name}»`,
      caps: { reply: true, edit: !!me, del: !!me, react: 'count', pin: true, report: !!me, typing: !!C.rt, search: true, stickers: false },
      reactSet: ['👍', '❤️', '😂', '🔥', '😮', '😢', '🎉', '👀', '💯', '🤝', '😎', '🙏'],
      async load({ before }){
        if (!C.role && !C.staff) return { list: [], more: false };
        let qy = sbClient.from('community_messages').select('*').eq('channel_id', chId).eq('deleted', false).order('id', { ascending: false }).limit(50);
        if (before) qy = qy.lt('id', before);
        const { data, error } = await qy;
        if (error) return { list: [], err: error, errText: P.err(error) };
        const list = await withMine((data || []).map(cmMsg).reverse());
        MV.markRead('cc:' + cid, Math.max(MV.lastRead('cc:' + cid), C.lastMax || 0));
        return { list, more: (data || []).length === 50 };
      },
      sub(fn){
        const chan = sbClient.channel('cmsg-' + chId)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'community_messages', filter: 'channel_id=eq.' + chId }, p => fn({ t: 'ins', m: Object.assign(cmMsg(p.new), { myReacts: new Set() }) }))
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'community_messages', filter: 'channel_id=eq.' + chId }, p => { const m = cmMsg(p.new); delete m.myReacts; fn({ t: 'upd', m }); })
          .subscribe();
        return () => { try { sbClient.removeChannel(chan); } catch (er) {} };
      },
      async send(text, reply){
        const r = await P.rpc('cm_send', { p_channel: chId, p_text: text, p_reply: typeof reply === 'number' ? reply : null });
        if (r.data?.ok) return { ok: true, m: Object.assign(cmMsg(r.data.msg), { myReacts: new Set() }) };
        if (r.data?.reason === 'slow') return { ok: false, err: `🐢 медленный режим — ещё ${r.data.wait} с` };
        if (r.data?.reason === 'muted') return { ok: false, err: `🔇 тебя заглушили до ${P.hm(r.data.until)}` };
        return { ok: false, err: why(r) };
      },
      edit: async (m, text) => { const r = await P.rpc('cm_edit', { p_id: m.id, p_text: text }); return r.data?.ok ? { ok: true } : { ok: false, err: why(r) }; },
      del: async m => { const r = await P.rpc('cm_delete_msg', { p_id: m.id }); return r.data?.ok ? { ok: true } : { ok: false, err: why(r) }; },
      canDel: m => isMod && m.uid !== me && (C.role === 'owner' || C.staff || (roles.get(m.uid) || 'member') === 'member'),
      react: async (m, em) => { const r = await P.rpc('cm_react', { p_id: m.id, p_emoji: em }); return r.data?.ok ? { ok: true, on: r.data.on, n: r.data.n } : { ok: false, err: why(r) }; },
      canPin: () => isMod,
      pin: async (m, on) => { const r = await P.rpc('cm_pin', { p_id: m.id, p_on: on }); return r.data?.ok ? { ok: true } : { ok: false, err: why(r) }; },
      report: async (m, w) => { const r = await P.rpc('cm_report', { p_msg: m.id, p_reason: w, p_community: null }); return r.data?.ok ? { ok: true, hidden: r.data.hidden } : { ok: false, err: why(r) }; },
      async fetch(ids){ const { data } = await sbClient.from('community_messages').select('*').in('id', ids.filter(x => typeof x === 'number')); return (data || []).map(cmMsg); },
      async search(q){
        const s = q.replace(/[%_,()]/g, ' ').trim(); if (!s) return [];
        const { data } = await sbClient.from('community_messages').select('*').eq('channel_id', chId).eq('deleted', false).or(`text.ilike.%${s}%,nick.ilike.%${s}%`).order('id', { ascending: false }).limit(40);
        return (data || []).map(cmMsg);
      },
      async pins(){ const { data } = await sbClient.from('community_messages').select('*').eq('channel_id', chId).eq('deleted', false).not('pinned_at', 'is', null).order('pinned_at', { ascending: false }).limit(25); return (data || []).map(cmMsg); },
      pinsEmpty: 'Закреплённых нет. Модераторы закрепляют важное: «⋯» → 📌',
      typing: C.rt ? {
        send(){ if (typ?.ready) typ.chan.send({ type: 'broadcast', event: 't', payload: { u: me, n: P.myNick() } }).catch(() => {}); },
        on(fn){
          typ = { ready: false };
          typ.chan = sbClient.channel(`typ-${C.rt}-${chId}`, { config: { broadcast: { self: false } } })
            .on('broadcast', { event: 't' }, ({ payload }) => { if (payload && typeof payload.n === 'string') fn({ uid: typeof payload.u === 'string' ? payload.u : null, nick: payload.n.slice(0, 24) }); })
            .subscribe(s => { if (typ) typ.ready = s === 'SUBSCRIBED'; });
          const mine = typ;
          return () => { try { sbClient.removeChannel(mine.chan); } catch (er) {} if (typ === mine) typ = null; };
        },
      } : null,
      async members(q){ const list = await membersOf(cid); const s = q.toLowerCase(); return list.filter(m => (m.nick || '').toLowerCase().startsWith(s)).slice(0, 7); },
      state(){
        if (!me) return { mode: 'login', note: 'Войди, чтобы писать в сообществе' };
        if (!C.role && !C.staff) return { mode: 'join', note: C.c.public ? 'Ты пока не в сообществе' : 'Сообщество закрытое' };
        if (C.muted_until && Date.parse(C.muted_until) > Date.now()) return { mode: 'muted', note: `🔇 Тебя заглушили до ${P.hm(C.muted_until)}` };
        if (ch.mods_only && !isMod) return { mode: 'readonly', note: '📢 Здесь пишут только владелец и модераторы' };
        return { mode: 'write', slow: !isMod && ch.slow ? ch.slow : 0 };
      },
      async onJoin(){ const r = await P.rpc('cm_join', { p_id: cid, p_code: null }); if (r.data?.ok) { dropC(cid); DS.reroute(); } else alert('Не получилось: ' + why(r)); },
      me: () => ({ uid: me, nick: P.myNick(), staff: isMod }),
      roleOf: uid => { const r = roles.get(uid); return r === 'owner' || r === 'mod' ? r : null; },
      modActions: m => modList(m.uid),
      mod: (k, m) => doMod(k, m.uid, m.nick),
      userMod: uid => modList(uid),
      userModDo: (k, uid, nick) => doMod(k, uid, nick),
    };
  }

  // ═══ Сервер: официальный или сообщество ═══
  async function server(id, fresh){
    if (id === OFF_ID) {
      const C = window.D37Chat;
      const info = C?.info?.(), staff = info?.staff || (typeof currentRole !== 'undefined' && ['admin', 'moderator', 'helper'].includes(currentRole) ? currentRole : null);
      let chans = (C?.channels?.() || []).map(c => ({ ...c }));
      if (!C?.hasNew?.()) chans = [chans[0], ...PLANNED.map(([id, name, kind]) => ({ id, name, kind: kind || 'text', soon: true })), chans.find(c => c.kind === 'twitch')].filter(Boolean);
      return { ok: true, id: OFF_ID, official: true, name: 'Денчик37', icon: '<img src="/icon-192.png" alt="">', about: 'Официальный сервер сайта: общий чат, игры, мемы и голосовой', channels: chans, staff, role: null };
    }
    const d = await openC(id, fresh);
    if (!d || !d.ok) return { ok: false, id, reason: d?.reason, err: d?.err, name: d?.name, until: d?.until };
    const my = S.my.find(x => x.id === id);
    return { ok: true, id, official: false, name: d.c.name, icon: e(d.c.icon), about: d.c.about, channels: d.channels || [], role: d.role, staff: d.staff, muted_until: d.muted_until, rt: d.rt, c: d.c, raw: d, lastMax: my?.last_id || 0 };
  }

  // ═══ Куски интерфейса (одни и те же для страницы и телефона) ═══
  // Ссылки: на странице — #/chat/…, в телефоне — #/phone/comm/… (телефон сам перехватывает)
  const link = (mode, srv, rest = '') => mode === 'phone' ? `#/phone/comm/${srv}${rest ? '/' + rest : ''}` : srv === OFF_ID ? `#/chat${rest ? '/' + rest : ''}` : `#/chat/c/${srv}${rest ? '/' + rest : ''}`;
  const special = (mode, k) => mode === 'phone' ? `#/phone/comm/${k}` : `#/chat/${k}`;
  function railHtml(mode, sel){
    const offUnread = (window.D37Chat?.channels?.() || []).some(c => c.kind === 'text' && (window.D37Chat.lastId(c.id) || 0) > MV.lastRead('o:' + c.id));
    const offMent = Object.values(window.D37Chat?.mentions || {}).reduce((a, b) => a + b, 0);
    const item = (id, icon, name, unread, ment, href) => `<a class="ds-srv${String(sel) === String(id) ? ' on' : ''}${unread ? ' unread' : ''}" href="${href}" title="${e(name)}" aria-label="${e(name)}"><span class="ds-pill"></span><span class="ds-sic">${icon}</span>${ment ? `<em class="ds-ment">${ment > 9 ? '9+' : ment}</em>` : ''}</a>`;
    return item(OFF_ID, '<img src="/icon-192.png" alt="">', 'Денчик37 — сервер сайта', offUnread, offMent, link(mode, OFF_ID))
      + '<i class="ds-rsep"></i>'
      + S.my.map(c => item(c.id, e(c.icon), c.name, commUnread(c) && String(sel) !== String(c.id), 0, link(mode, c.id))).join('')
      + `<a class="ds-srv ds-add" href="${special(mode, 'new')}" title="Создать сообщество" aria-label="Создать сообщество"><span class="ds-sic">＋</span></a>`
      + `<a class="ds-srv ds-find" href="${special(mode, 'find')}" title="Найти сообщество" aria-label="Найти сообщество"><span class="ds-sic">🧭</span></a>`;
  }
  function channelsHtml(mode, srv, selCh){
    const ch = srv.channels || [];
    const unread = c => srv.official ? (window.D37Chat.lastId(c.id) || 0) > MV.lastRead('o:' + c.id) : (c.last_id || 0) > MV.lastRead('c:' + c.id);
    const row = c => {
      const ic = c.kind === 'voice' ? '🔊' : c.kind === 'twitch' ? '📺' : '#';
      if (c.soon) return `<span class="ds-ch soon" title="Канал появится, когда сайт обновится"><i>${ic}</i><span>${e(c.name)}</span><small>скоро</small></span>`;
      const ment = srv.official ? window.D37Chat.mentions[c.id] || 0 : 0;
      const voiceIn = c.kind === 'voice' ? `<div class="ds-vppl" data-vch="${e(srv.official ? 'o' : c.id)}"></div>` : '';
      return `<a class="ds-ch${String(selCh) === String(c.id) ? ' on' : ''}${c.kind !== 'voice' && c.kind !== 'twitch' && unread(c) ? ' unread' : ''}" href="${link(mode, srv.id, c.id)}"><i>${ic}</i><span>${e(c.name)}</span>${c.slow ? '<small title="Медленный режим">🐢</small>' : ''}${c.mods_only ? '<small title="Пишут только модераторы">📢</small>' : ''}${ment ? `<em class="ds-ment">${ment}</em>` : ''}</a>${voiceIn}`;
    };
    const text = ch.filter(c => c.kind !== 'voice'), voice = ch.filter(c => c.kind === 'voice');
    return `<div class="ds-cat">Текстовые каналы</div>${text.map(row).join('')}${voice.length ? `<div class="ds-cat">Голосовые каналы</div>${voice.map(row).join('')}` : ''}`;
  }
  function headHtml(mode, srv){
    const acts = [];
    if (srv.official) {
      if (srv.staff === 'admin' || srv.staff === 'moderator') acts.push(`<a class="ds-hb" href="${link(mode, OFF_ID, 'reports')}" title="Жалобы">🚩</a>`, `<a class="ds-hb" href="${link(mode, OFF_ID, 'settings')}" title="Настройки каналов">⚙️</a>`);
    } else {
      if (srv.role) acts.push(`<button type="button" class="ds-hb" data-ds="invite" title="Пригласить">🔗</button>`);
      if (srv.role === 'owner' || srv.role === 'mod' || srv.staff) acts.push(`<a class="ds-hb" href="${link(mode, srv.id, 'settings')}" title="Настройки">⚙️</a>`);
      if (srv.role === 'owner' || srv.role === 'mod' || srv.staff) acts.push(`<a class="ds-hb" href="${link(mode, srv.id, 'reports')}" title="Жалобы">🚩</a>`);
    }
    return `<div class="ds-sh"><span class="ds-shi">${srv.icon}</span><b title="${e(srv.about || '')}">${e(srv.name)}</b><span class="ds-shacts">${acts.join('')}</span></div>`;
  }
  // Участники: на сервере сайта — кто онлайн (по группам) и кто писал недавно; в сообществе — все участники (онлайн — сверху)
  async function membersRender(box, srv){
    if (!box) return;
    const C = window.D37Chat, on = C?.online?.() || { users: [], guests: 0 };
    const onlineIds = new Set(on.users.map(u => u.id));
    const group = (t, list) => list.length ? `<div class="ds-mg">${t} — ${list.length}</div>${list.map(row).join('')}` : '';
    const row = u => `<button type="button" class="ds-mem${u.off ? ' off' : ''}" data-uid="${e(u.id)}" data-nick="${e(u.nick)}">${P.avatar(P.prof(u.id) || { nick: u.nick, role: u.role }, u.nick, 30)}<span>${P.nick(P.prof(u.id) || { nick: u.nick, role: u.role }, u.nick)}${u.sub ? `<small>${e(u.sub)}</small>` : ''}</span>${u.crole === 'owner' ? '<i title="Владелец">👑</i>' : u.crole === 'mod' ? '<i title="Модератор">🛡</i>' : ''}</button>`;
    on.users.forEach(x => { x.sub = x.a ? P.actText(P.actParse(x.a)) : ''; });   // чем занят («в Мире, сервер 2»…)
    const actOf = new Map(on.users.map(x => [x.id, x.sub]));
    if (srv.official) {
      const u = on.users, used = new Set();
      const take = f => u.filter(x => !used.has(x.id) && f(x)).map(x => { used.add(x.id); return x; });
      const admins = take(x => x.role === 'admin'), mods = take(x => x.role === 'moderator' || x.role === 'helper'), vip = take(x => !!x.vip), rest = take(() => true);
      const recent = (await C.recentAuthors()).filter(x => !onlineIds.has(x.id)).slice(0, 30).map(x => ({ ...x, off: true }));
      await P.profiles([...u.map(x => x.id), ...recent.map(x => x.id)]);
      box.innerHTML = `<div class="ds-mtitle">В сети — ${on.total || 0}</div>` + group('👑 Админ', admins) + group('🛡 Модераторы', mods) + group('✨ VIP', vip) + group('🟢 В сети', rest)
        + (on.guests ? `<div class="ds-mg">👤 Гости — ${on.guests}</div>` : '') + group('⚪ Не в сети', recent)
        + (!u.length && !on.guests ? '<div class="ds-dim">Никого — позови друзей!</div>' : '');
      return;
    }
    if (!srv.role && !srv.staff) { box.innerHTML = `<div class="ds-dim">Участники видны после вступления. Всего: ${srv.c?.members || 0}</div>`; return; }
    const list = await membersOf(srv.id);
    await P.profiles(list.map(m => m.id));
    const all = list.map(m => ({ id: m.id, nick: m.nick, crole: m.role, role: P.prof(m.id)?.role, sub: m.muted_until ? '🔇 заглушён' : actOf.get(m.id) || '', off: !onlineIds.has(m.id) }));
    const onl = all.filter(x => !x.off), off = all.filter(x => x.off);
    box.innerHTML = `<div class="ds-mtitle">Участники — ${list.length}</div>` + group('👑 Владелец', onl.filter(x => x.crole === 'owner')) + group('🛡 Модераторы', onl.filter(x => x.crole === 'mod'))
      + group('🟢 В сети', onl.filter(x => x.crole === 'member')) + group('⚪ Не в сети', off);
  }
  // Голосовой канал: кто сейчас в нём (под названием канала) — calls.js сообщает
  function voicePeople(root){
    root.querySelectorAll('.ds-vppl').forEach(b => {
      const v = window.D37Calls?.voiceInfo?.();
      const key = b.dataset.vch;
      const here = v && (key === 'o' ? v.kind === 'official' : String(v.channel) === key);
      b.innerHTML = here ? v.people.map(p => `<span class="${p.speaking ? 'spk' : ''}">${P.avatar(P.prof(p.uid) || null, p.nick, 18)}${e(p.nick)}${p.mute ? ' 🔇' : ''}</span>`).join('') : '';
    });
  }
  // Внизу списка каналов: я (ник, роль) и голосовой, если подключён
  function meHtml(){
    const me = P.me(), nick = (typeof chatNick !== 'undefined' && chatNick) || P.myNick();
    const v = window.D37Calls?.voiceInfo?.();
    const voice = v ? `<div class="ds-vbar"><span><b>🔊 ${e(v.title)}</b><small>${v.state === 'ok' ? 'голос подключён' : v.state === 'full' ? 'канал полон' : 'подключаемся…'}</small></span><button type="button" data-ds="vmute" title="Микрофон">${v.mute ? '🔇' : '🎙'}</button><button type="button" data-ds="vdeaf" title="Звук">${v.deaf ? '🔈' : '🎧'}</button><button type="button" class="bad" data-ds="vleave" title="Выйти из голосового">✕</button></div>` : '';
    if (!nick) return voice + `<div class="ds-me"><span class="ds-dim">Ты не в чате</span><button type="button" class="ds-btn" data-ds="guest">👤 Гостем</button><button type="button" class="ds-btn ghost" data-ds="login">Войти</button></div>`;
    const p = me ? P.prof(me) || (typeof currentProfile !== 'undefined' ? currentProfile : null) : null;
    const role = typeof currentRole !== 'undefined' ? currentRole : null;
    return voice + `<div class="ds-me">${P.avatar(p, nick, 32)}<span><b>${e(nick)}</b><small>${role === 'admin' ? '👑 админ' : role === 'moderator' ? '🛡 модератор' : role === 'helper' ? '🧹 хелпер' : me ? '🟢 в сети' : '👤 гость'}</small></span>${me ? '' : '<button type="button" class="ds-btn ghost" data-ds="login">Войти</button>'}<button type="button" class="ds-hb" data-ds="phone" title="Телефон 📱 — звонки, друзья, личные сообщения">📱</button></div>`;
  }

  // ═══ Экраны: найти, создать, приглашение, настройки, жалобы ═══
  async function screenFind(el, mode){
    el.innerHTML = `<div class="ds-pane"><h3>🧭 Найти сообщество</h3><p class="ds-dim">Открытые сообщества игроков сайта. Своё — кнопкой «＋».</p>
      <div class="ds-row"><input type="search" class="ds-in" data-f="q" placeholder="Название…" aria-label="Поиск сообщества"><a class="ds-btn" href="${special(mode, 'new')}">＋ Создать</a></div>
      <div class="ds-row"><input type="text" class="ds-in" data-f="code" placeholder="Код приглашения (8 знаков)" maxlength="12" aria-label="Код приглашения"><button type="button" class="ds-btn ghost" data-ds="bycode">Войти по коду</button></div>
      <div class="ds-list" data-f="list"><div class="ds-dim">Загружаем…</div></div></div>`;
    const list = el.querySelector('[data-f="list"]'), qi = el.querySelector('[data-f="q"]');
    const load = async () => {
      const r = await P.rpc('cm_list_public', { p_q: qi.value.trim() || null });
      if (r.error) { list.innerHTML = r.missing ? '<div class="ds-soon">🛠️ Сообщества появятся, когда сайт обновится. Общий чат — уже работает (сервер «Денчик37» слева).</div>' : `<div class="ds-dim">⚠️ ${e(P.err(r.error))}</div>`; return; }
      const mine = new Set(S.my.map(x => x.id));
      list.innerHTML = (r.data || []).length ? r.data.map(c => `<a class="ds-card" href="${link(mode, c.id)}"><span class="ds-cic">${e(c.icon)}</span><span><b>${e(c.name)}</b><small>${c.members} ${P.plural(c.members, 'участник', 'участника', 'участников')}${mine.has(c.id) ? ' · ты здесь' : ''}</small>${c.about ? `<em>${e(c.about)}</em>` : ''}</span></a>`).join('')
        : '<div class="ds-dim">Ничего не нашли. Создай своё!</div>';
    };
    let t = 0; qi.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 350); });
    el.querySelector('[data-ds="bycode"]').onclick = () => { const c = el.querySelector('[data-f="code"]').value.trim().toLowerCase().replace(/[^a-z0-9]/g, ''); if (c.length >= 6) go(mode, special(mode, 'join/' + c)); };
    load();
  }
  function screenCreate(el, mode){
    if (!P.me()) { P.login(el, 'Создавать сообщества могут вошедшие игроки.'); return; }
    let icon = '🎮';
    el.innerHTML = `<div class="ds-pane"><h3>＋ Своё сообщество</h3><p class="ds-dim">Как сервер в Дискорде: каналы, голосовой, свои модераторы. До 3 своих сообществ.</p>
      <div class="ds-icons">${ICONS.map(x => `<button type="button" class="${x === icon ? 'on' : ''}" data-ic="${x}">${x}</button>`).join('')}</div>
      <label class="ds-lbl">Название<input class="ds-in" data-f="name" maxlength="40" placeholder="Например: Клан Денчика"></label>
      <label class="ds-lbl">О чём (необязательно)<textarea class="ds-in" data-f="about" maxlength="300" rows="3" placeholder="Во что играем, правила…"></textarea></label>
      <label class="ds-chk"><input type="checkbox" data-f="pub" checked> Открытое — видно в поиске, вступить может любой. Иначе — только по приглашению.</label>
      <p class="ds-dim">Правила: без мата, оскорблений, рекламы и ссылок. Не проси и не пиши личные данные (адрес, телефон, школу). Нарушение — жалоба команде сайта.</p>
      <div class="ds-row"><button type="button" class="ds-btn" data-ds="create">Создать</button></div><div class="ds-err" hidden></div></div>`;
    el.querySelector('.ds-icons').onclick = ev => { const b = ev.target.closest('[data-ic]'); if (!b) return; icon = b.dataset.ic; el.querySelectorAll('[data-ic]').forEach(x => x.classList.toggle('on', x === b)); };
    el.querySelector('[data-ds="create"]').onclick = async btn => {
      const b = btn.currentTarget || btn.target; b.disabled = true;
      const r = await P.rpc('cm_create', { p_name: el.querySelector('[data-f="name"]').value, p_about: el.querySelector('[data-f="about"]').value, p_icon: icon, p_public: el.querySelector('[data-f="pub"]').checked });
      b.disabled = false;
      if (r.data?.ok) { S.myAt = 0; await loadMy(true); go(mode, link(mode, r.data.id)); return; }
      const er = el.querySelector('.ds-err'); er.hidden = false; er.textContent = '⚠️ ' + why(r);
    };
  }
  async function screenJoin(el, mode, code){
    el.innerHTML = '<div class="ds-pane"><div class="ds-dim">Загружаем приглашение…</div></div>';
    const r = await P.rpc('cm_invite_info', { p_code: code });
    if (r.error) { el.innerHTML = `<div class="ds-pane">${r.missing ? '<div class="ds-soon">🛠️ Сообщества появятся, когда сайт обновится.</div>' : `<div class="ds-dim">⚠️ ${e(P.err(r.error))}</div>`}</div>`; return; }
    const c = r.data;
    if (!c) { el.innerHTML = '<div class="ds-pane"><h3>Приглашение не работает</h3><p class="ds-dim">Ссылка устарела или сообщество закрыто. Попроси новую.</p></div>'; return; }
    await loadMy();
    const already = S.my.some(x => x.id === c.id);
    el.innerHTML = `<div class="ds-pane ds-join"><span class="ds-big">${e(c.icon)}</span><h3>${e(c.name)}</h3><p class="ds-dim">${c.members} ${P.plural(c.members, 'участник', 'участника', 'участников')} · ${c.public ? 'открытое' : 'по приглашению'}</p>${c.about ? `<p>${e(c.about)}</p>` : ''}
      ${already ? `<a class="ds-btn" href="${link(mode, c.id)}">Открыть</a>` : P.me() ? '<button type="button" class="ds-btn" data-ds="join">Вступить</button>' : '<button type="button" class="ds-btn" data-ds="login">Войти, чтобы вступить</button>'}<div class="ds-err" hidden></div></div>`;
    el.querySelector('[data-ds="join"]')?.addEventListener('click', async () => {
      const j = await P.rpc('cm_join', { p_id: null, p_code: code });
      if (j.data?.ok) { S.myAt = 0; await loadMy(true); go(mode, link(mode, j.data.id)); return; }
      const er = el.querySelector('.ds-err'); er.hidden = false; er.textContent = '⚠️ ' + why(j);
    });
  }
  async function screenSettings(el, mode, srv){
    if (srv.official) return screenOfficialSettings(el, mode, srv);
    const C = srv.raw, owner = srv.role === 'owner' || srv.staff, mod = owner || srv.role === 'mod';
    if (!mod) { el.innerHTML = '<div class="ds-pane"><div class="ds-dim">Настройки — для владельца и модераторов</div></div>'; return; }
    const bans = (await P.rpc('cm_bans', { p_id: srv.id })).data || [];
    const url = `${location.origin}/c/${C.c.code}`;
    el.innerHTML = `<div class="ds-pane"><h3>⚙️ Настройки «${e(C.c.name)}»</h3>
      ${owner ? `<div class="ds-sect"><b>Сообщество</b>
        <div class="ds-icons">${ICONS.map(x => `<button type="button" class="${x === C.c.icon ? 'on' : ''}" data-ic="${x}">${x}</button>`).join('')}</div>
        <label class="ds-lbl">Название<input class="ds-in" data-f="name" maxlength="40" value="${e(C.c.name)}"></label>
        <label class="ds-lbl">О чём<textarea class="ds-in" data-f="about" maxlength="300" rows="2">${e(C.c.about || '')}</textarea></label>
        <label class="ds-chk"><input type="checkbox" data-f="pub"${C.c.public ? ' checked' : ''}> Открытое (видно в поиске)</label>
        <button type="button" class="ds-btn" data-ds="save">Сохранить</button></div>` : ''}
      <div class="ds-sect"><b>Приглашение</b><div class="ds-row"><input class="ds-in" readonly value="${e(url)}" aria-label="Ссылка-приглашение"><button type="button" class="ds-btn ghost" data-ds="copy">📋</button><button type="button" class="ds-btn ghost" data-ds="newcode" title="Новая ссылка — старая перестанет работать">🔄</button></div></div>
      <div class="ds-sect"><b>Каналы</b>${C.channels.map(c => `<div class="ds-chrow" data-chid="${c.id}"><span>${c.kind === 'voice' ? '🔊' : '#'} ${e(c.name)}</span>
        ${c.kind === 'text' ? `<select class="ds-in ds-sm" data-chf="slow" aria-label="Медленный режим">${[0, 5, 10, 30, 60, 300, 900].map(s => `<option value="${s}"${c.slow === s ? ' selected' : ''}>${s ? '🐢 ' + (s >= 60 ? s / 60 + ' мин' : s + ' с') : 'без задержки'}</option>`).join('')}</select>
        <label class="ds-chk ds-sm"><input type="checkbox" data-chf="mods"${c.mods_only ? ' checked' : ''}> 📢</label>` : ''}
        <button type="button" class="ds-hb" data-ds="chren" title="Переименовать">✏️</button>${owner ? '<button type="button" class="ds-hb" data-ds="chdel" title="Удалить канал">🗑</button>' : ''}</div>`).join('')}
        <div class="ds-row"><input class="ds-in" data-f="newch" maxlength="32" placeholder="Новый канал"><select class="ds-in ds-sm" data-f="newkind"><option value="text"># текст</option><option value="voice">🔊 голос</option></select><button type="button" class="ds-btn ghost" data-ds="chadd">＋</button></div>
        <p class="ds-dim">🐢 — медленный режим (одно сообщение раз в N секунд), 📢 — пишут только модераторы.</p></div>
      <div class="ds-sect"><b>Баны — ${bans.length}</b>${bans.length ? bans.map(b => `<div class="ds-chrow"><span>${e(b.nick)}${b.reason ? ` · ${e(b.reason)}` : ''}${b.until ? ` · до ${new Date(b.until).toLocaleDateString('ru-RU')}` : ' · навсегда'}</span><button type="button" class="ds-btn ghost ds-sm" data-unban="${e(b.id)}">Разбанить</button></div>`).join('') : '<div class="ds-dim">Никого</div>'}</div>
      ${owner ? `<div class="ds-sect ds-danger"><b>Опасно</b><button type="button" class="ds-btn bad" data-ds="delete">Удалить сообщество навсегда</button></div>` : ''}
      <div class="ds-err" hidden></div></div>`;
    let icon = C.c.icon;
    const err = t => { const x = el.querySelector('.ds-err'); x.hidden = !t; x.textContent = t ? '⚠️ ' + t : ''; };
    el.querySelector('.ds-icons')?.addEventListener('click', ev => { const b = ev.target.closest('[data-ic]'); if (!b) return; icon = b.dataset.ic; el.querySelectorAll('[data-ic]').forEach(x => x.classList.toggle('on', x === b)); });
    el.addEventListener('change', async ev => {
      const row = ev.target.closest('[data-chid]'); if (!row || !ev.target.dataset.chf) return;
      const ch = C.channels.find(c => String(c.id) === row.dataset.chid);
      const r = await P.rpc('cm_channel_save', { p_community: srv.id, p_id: ch.id, p_name: ch.name, p_kind: ch.kind, p_slow: +row.querySelector('[data-chf="slow"]').value, p_mods_only: row.querySelector('[data-chf="mods"]').checked });
      if (!r.data?.ok) err(why(r)); else { dropC(srv.id); P.toast?.('✅ Сохранено', true); }
    });
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-ds],[data-unban]'); if (!b) return;
      const k = b.dataset.ds, row = b.closest('[data-chid]'), ch = row && C.channels.find(c => String(c.id) === row.dataset.chid);
      if (b.dataset.unban) { const r = await P.rpc('cm_unban', { p_community: srv.id, p_user: b.dataset.unban }); if (r.data?.ok) b.closest('.ds-chrow').remove(); else err(why(r)); return; }
      if (k === 'save') { const r = await P.rpc('cm_update', { p_id: srv.id, p_name: el.querySelector('[data-f="name"]').value, p_about: el.querySelector('[data-f="about"]').value, p_icon: icon, p_public: el.querySelector('[data-f="pub"]').checked }); if (r.data?.ok) { dropC(srv.id); S.myAt = 0; DS.reroute(); } else err(why(r)); }
      else if (k === 'copy') { try { await navigator.clipboard.writeText(url); b.textContent = '✅'; } catch (er) { prompt('Ссылка-приглашение:', url); } }
      else if (k === 'newcode') { const r = await P.rpc('cm_invite_reset', { p_id: srv.id }); if (r.data?.ok) { dropC(srv.id); DS.reroute(); } else err(why(r)); }
      else if (k === 'chren' && ch) { const n = prompt('Новое название канала:', ch.name); if (!n) return; const r = await P.rpc('cm_channel_save', { p_community: srv.id, p_id: ch.id, p_name: n, p_kind: ch.kind, p_slow: ch.slow, p_mods_only: ch.mods_only }); if (r.data?.ok) { dropC(srv.id); DS.reroute(); } else err(why(r)); }
      else if (k === 'chdel' && ch) { if (!confirm(`Удалить канал «${ch.name}» со всеми сообщениями?`)) return; const r = await P.rpc('cm_channel_delete', { p_id: ch.id }); if (r.data?.ok) { dropC(srv.id); DS.reroute(); } else err(why(r)); }
      else if (k === 'chadd') { const n = el.querySelector('[data-f="newch"]').value.trim(); if (!n) return; const r = await P.rpc('cm_channel_save', { p_community: srv.id, p_id: null, p_name: n, p_kind: el.querySelector('[data-f="newkind"]').value, p_slow: 0, p_mods_only: false }); if (r.data?.ok) { dropC(srv.id); DS.reroute(); } else err(why(r)); }
      else if (k === 'delete') { const n = prompt(`Удалить «${C.c.name}» навсегда — со всеми каналами и сообщениями? Напиши название, чтобы подтвердить:`); if (n !== C.c.name) return; const r = await P.rpc('cm_delete', { p_id: srv.id }); if (r.data?.ok) { dropC(srv.id); S.myAt = 0; await loadMy(true); go(mode, link(mode, OFF_ID)); } else err(why(r)); }
    });
  }
  async function screenOfficialSettings(el, mode, srv){
    if (!(srv.staff === 'admin' || srv.staff === 'moderator')) { el.innerHTML = '<div class="ds-pane"><div class="ds-dim">Настройки каналов — для админа и модераторов</div></div>'; return; }
    if (!window.D37Chat.hasNew()) { el.innerHTML = '<div class="ds-pane"><div class="ds-soon">🛠️ Медленный режим и каналы появятся, когда сайт обновится (community.sql).</div></div>'; return; }
    const chans = srv.channels.filter(c => c.kind === 'text');
    el.innerHTML = `<div class="ds-pane"><h3>⚙️ Каналы сервера «Денчик37»</h3>${chans.map(c => `<div class="ds-chrow" data-ch="${e(c.id)}"><span># ${e(c.name)}</span>
      <select class="ds-in ds-sm" data-chf="slow" aria-label="Медленный режим">${[0, 5, 10, 30, 60, 300].map(s => `<option value="${s}"${c.slow === s ? ' selected' : ''}>${s ? '🐢 ' + (s >= 60 ? s / 60 + ' мин' : s + ' с') : 'без задержки'}</option>`).join('')}</select>
      <label class="ds-chk ds-sm"><input type="checkbox" data-chf="mods"${c.mods_only ? ' checked' : ''}> 📢 только команда</label></div>`).join('')}<div class="ds-err" hidden></div></div>`;
    el.addEventListener('change', async ev => {
      const row = ev.target.closest('[data-ch]'); if (!row) return;
      const r = await window.D37Chat.setSlow(row.dataset.ch, +row.querySelector('[data-chf="slow"]').value, row.querySelector('[data-chf="mods"]').checked);
      if (!r?.ok) { const x = el.querySelector('.ds-err'); x.hidden = false; x.textContent = '⚠️ ' + (r?.err || REASON[r?.reason] || 'не получилось'); } else P.toast?.('✅ Сохранено', true);
    });
  }
  async function screenReports(el, mode, srv){
    el.innerHTML = '<div class="ds-pane"><div class="ds-dim">Загружаем жалобы…</div></div>';
    const official = srv.official;
    const list = official ? await window.D37Chat.reports() : (await P.rpc('cm_reports', { p_community: srv.id })).data;
    if (!list) { el.innerHTML = '<div class="ds-pane"><div class="ds-dim">Жалобы видят модераторы</div></div>'; return; }
    el.innerHTML = `<div class="ds-pane"><h3>🚩 Жалобы — ${list.length}</h3>${list.length ? list.map(r => `<div class="ds-rep" data-mid="${e(official ? r.mid : r.id)}">
      <div><b>${e(r.author || '—')}</b> <small>${r.n} ${P.plural(r.n, 'жалоба', 'жалобы', 'жалоб')}${r.hidden ? ' · скрыто' : ''}${official ? ' · #' + e(r.channel) : ''}${r.reasons ? ' · ' + e(r.reasons) : ''}</small></div>
      <p>${e(P.clean(r.text || (r.mid === null ? '(жалоба на сообщество)' : '(удалено)')))}</p>
      <div class="ds-row">${official ? '<button type="button" class="ds-btn ghost ds-sm" data-rep="restore">✅ Оставить</button><button type="button" class="ds-btn bad ds-sm" data-rep="delete">🗑 Удалить</button>' : '<button type="button" class="ds-btn ghost ds-sm" data-rep="dismiss">✅ Оставить</button><button type="button" class="ds-btn bad ds-sm" data-rep="delete">🗑 Удалить</button>'}</div></div>`).join('') : '<div class="ds-dim">Жалоб нет 🎉</div>'}</div>`;
    el.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-rep]'); if (!b) return;
      const box = b.closest('[data-mid]'), id = +box.dataset.mid;
      const r = official ? await window.D37Chat.resolve(id, b.dataset.rep) : (await P.rpc('cm_report_resolve', { p_report: id, p_action: b.dataset.rep })).data;
      if (r?.ok) box.remove(); else alert('Не получилось: ' + (r?.err || REASON[r?.reason] || ''));
    });
  }
  async function showInvite(srv){
    const url = `${location.origin}/c/${srv.c?.code}`;
    if (!srv.c?.code) return;
    if (navigator.share && P.touch()) { navigator.share({ title: srv.name, text: `Заходи в сообщество «${srv.name}» на сайте dan4ik37`, url }).catch(() => {}); return; }
    try { await navigator.clipboard.writeText(url); P.toast?.('🔗 Ссылка-приглашение скопирована', true); if (!P.isOpen()) alert('Ссылка-приглашение скопирована:\n' + url); } catch (er) { prompt('Ссылка-приглашение:', url); }
  }
  function go(mode, href){
    if (mode === 'phone') P.go(href.replace(/^#\/phone\//, ''));
    else location.hash = href;
  }

  // ═══ Канал справа: лента / голосовой / Twitch / «скоро» ═══
  let mv = null, mvHost = null;
  function showChannel(host, mode, srv, ch){
    window.D37Chat.viewing = '';
    if (ch.kind === 'twitch') {
      dropView();
      host.innerHTML = '<div class="ds-twitch"></div>';
      const fr = document.getElementById('chat-twitch');
      if (fr && mode === 'page') { host.firstChild.appendChild(fr); fr.style.display = 'block'; window.D37Chat.loadTwitch(fr); }
      else host.firstChild.innerHTML = `<div class="ds-pane"><p>Чат трансляции Twitch.</p><a class="ds-btn" href="https://www.twitch.tv/popout/${typeof TWITCH !== 'undefined' ? TWITCH : 'dan4ik37'}/chat?darkpopout" target="_blank" rel="noopener">📺 Открыть чат Twitch</a></div>`;
      return;
    }
    if (ch.kind === 'voice') {
      dropView();
      host.innerHTML = '<div class="ds-voice"><div class="ds-dim">Загружаем голосовой…</div></div>';
      P.need('calls').then(() => window.D37Calls.voiceView(host.firstChild, srv.official ? { kind: 'official', channel: 0, title: `${ch.name} · Денчик37`, name: ch.name } : { kind: 'community', channel: ch.id, cid: srv.id, title: `${ch.name} · ${srv.name}`, name: ch.name, topic: ch.topic, member: !!(srv.role || srv.staff) }))
        .catch(() => { host.firstChild.innerHTML = '<div class="ds-dim">Не загрузилось — проверь интернет</div>'; });
      return;
    }
    const A = srv.official ? window.D37Chat.adapter(ch.id) : commAdapter(srv.raw, ch);
    if (!srv.official) A.lastMax = srv.lastMax;
    if (!mv || mvHost !== host || !host.contains(mvHost?.firstChild)) {
      dropView();
      host.innerHTML = '<div class="ds-mv"></div>';
      mvHost = host;
      mv = MV.mount(host.firstChild, { compact: mode === 'phone' });
    }
    if (mode === 'page') window.D37Chat.view = mv;
    window.D37Chat.viewing = A.key;
    if (srv.official) delete window.D37Chat.mentions[ch.id];
    if (!srv.official) MV.markRead('cc:' + srv.id, srv.lastMax || 0);
    mv.setAdapter(A);
    commBadge();
    return mv;
  }
  function dropView(){ if (mv) { mv.destroy(); mv = null; mvHost = null; } if (window.D37Chat) { window.D37Chat.view = null; window.D37Chat.viewing = ''; } }
  // системные строчки общего чата (бан и т.п.) — в открытую ленту
  window.addEventListener('d37:chatsys', ev => { if (mv && window.D37Chat.viewing.startsWith('o:')) mv.push({ text: ev.detail }); });
  window.addEventListener('d37:chatstate', () => { mv?.gate?.(); refreshSide(); });

  // ═══ СТРАНИЦА #/chat ═══
  let page = null;   // { root, srv, ch, mode }
  DS.page = async (host, param) => {
    const parts = String(param || '').split('/').filter(Boolean);
    let srvId = OFF_ID, rest = parts;
    if (parts[0] === 'c' && /^\d+$/.test(parts[1] || '')) { srvId = +parts[1]; rest = parts.slice(2); }
    if (!page || page.root !== host.firstElementChild) {
      host.innerHTML = `<div class="ds" data-mode="page">
          <nav class="ds-rail" aria-label="Серверы"></nav>
          <aside class="ds-side" aria-label="Каналы"><div class="ds-shost"></div><div class="ds-chans"></div><div class="ds-mehost"></div></aside>
          <main class="ds-main">
            <header class="ds-top"><button type="button" class="ds-hb ds-burger" data-ds="left" aria-label="Каналы">☰</button><b class="ds-ttl"></b><span class="ds-topic"></span>
              <span class="ds-tools"><button type="button" class="ds-hb" data-ds="search" title="Поиск по каналу" aria-label="Поиск">🔍</button><button type="button" class="ds-hb" data-ds="pins" title="Закреплённые" aria-label="Закреплённые">📌</button><button type="button" class="ds-hb" data-ds="right" title="Участники" aria-label="Участники">👥</button><button type="button" class="ds-hb ds-full" id="chatFullBtn" onclick="toggleChatFull()" title="Чат на весь экран (экран не будет гаснуть)" aria-label="Чат на весь экран">⛶</button></span></header>
            <div class="ds-pin" hidden></div>
            <div class="ds-body"></div>
          </main>
          <aside class="ds-members" aria-label="Участники"><div class="ds-mbody"></div></aside>
          <div class="ds-scrim" data-ds="close"></div>
        </div>`;
      page = { root: host.firstElementChild, mode: 'page' };
      page.root.addEventListener('click', onDsClick);
      // наш чат больше не «главный» — у старого чата были бейджи и т.п.
    }
    const root = page.root;
    root.classList.remove('l-open', 'r-open');
    await loadMy();
    // особые экраны
    if (srvId === OFF_ID && ['find', 'new', 'join'].includes(rest[0])) {
      page.srv = null; page.ch = null;
      root.querySelector('.ds-rail').innerHTML = railHtml('page', rest[0] === 'find' ? 'find' : '');
      dropView();
      const srv = await server(OFF_ID);
      paintSide(root, 'page', srv, null);
      setTop(root, rest[0] === 'find' ? '🧭 Найти сообщество' : rest[0] === 'new' ? '＋ Новое сообщество' : '🏰 Приглашение', '', true);
      const body = root.querySelector('.ds-body');
      body.innerHTML = '<div class="ds-scroll"></div>';
      if (rest[0] === 'find') screenFind(body.firstChild, 'page');
      else if (rest[0] === 'new') screenCreate(body.firstChild, 'page');
      else screenJoin(body.firstChild, 'page', (rest[1] || '').toLowerCase());
      return;
    }
    const srv = await server(srvId);
    page.srv = srv;
    root.querySelector('.ds-rail').innerHTML = railHtml('page', srvId);
    if (!srv.ok) {
      dropView(); paintSide(root, 'page', null, null);
      setTop(root, srv.name ? e(srv.name) : 'Сообщество', '', true);
      root.querySelector('.ds-body').innerHTML = `<div class="ds-scroll"><div class="ds-pane">${srv.reason === 'soon' ? '<div class="ds-soon">🛠️ Сообщества появятся, когда сайт обновится. Общий чат уже работает — сервер «Денчик37» слева.</div>'
        : srv.reason === 'banned' ? `<h3>⛔ Тебя забанили</h3><p class="ds-dim">${srv.until ? 'До ' + new Date(srv.until).toLocaleString('ru-RU') : 'Навсегда'}.</p>`
        : srv.reason === 'private' ? '<h3>🔒 Закрытое сообщество</h3><p class="ds-dim">Вступить можно только по ссылке-приглашению.</p>'
        : `<h3>Сообщество не найдено</h3><p class="ds-dim">${e(srv.err || 'Его удалили или закрыли.')}</p>`}</div></div>`;
      return;
    }
    let sub = rest[0] || '', ch = null;
    if (['settings', 'reports', 'members'].includes(sub)) {
      paintSide(root, 'page', srv, null);
      dropView();
      setTop(root, sub === 'settings' ? '⚙️ Настройки' : sub === 'reports' ? '🚩 Жалобы' : '👥 Участники', '', true);
      const body = root.querySelector('.ds-body'); body.innerHTML = '<div class="ds-scroll"></div>';
      if (sub === 'settings') screenSettings(body.firstChild, 'page', srv);
      else if (sub === 'reports') screenReports(body.firstChild, 'page', srv);
      else { body.firstChild.innerHTML = '<div class="ds-mlist"></div>'; membersRender(body.firstChild.firstChild, srv); }
      membersRender(root.querySelector('.ds-mbody'), srv);
      return;
    }
    ch = srv.channels.find(c => String(c.id) === sub && !c.soon) || srv.channels.find(c => c.kind === 'text' && !c.soon);
    page.ch = ch;
    paintSide(root, 'page', srv, ch?.id);
    if (!ch) { dropView(); root.querySelector('.ds-body').innerHTML = '<div class="ds-scroll"><div class="ds-pane"><div class="ds-dim">Каналов нет</div></div></div>'; return; }
    setTop(root, `${ch.kind === 'voice' ? '🔊' : ch.kind === 'twitch' ? '📺' : '#'} ${e(ch.name)}`, e(ch.about || (srv.official ? '' : srv.about || '')), ch.kind !== 'text');
    // полоска закрепа общего чата (VIP) — как раньше, над лентой
    paintPin(root, srv, ch);
    if (srv.official && ch.kind === 'text' && !srv.c) hideChatBadgeSafe();
    showChannel(root.querySelector('.ds-body'), 'page', srv, ch);
    membersRender(root.querySelector('.ds-mbody'), srv);
  };
  const hideChatBadgeSafe = () => { if (typeof hideChatBadge === 'function') hideChatBadge(); };
  function setTop(root, title, topic, noTools){
    root.querySelector('.ds-ttl').innerHTML = title;
    root.querySelector('.ds-topic').innerHTML = topic || '';
    root.querySelectorAll('[data-ds="search"],[data-ds="pins"]').forEach(b => { b.hidden = !!noTools; });
  }
  function paintSide(root, mode, srv, chId){
    root.querySelector('.ds-shost').innerHTML = srv ? headHtml(mode, srv) : '';
    root.querySelector('.ds-chans').innerHTML = srv ? channelsHtml(mode, srv, chId) : '';
    root.querySelector('.ds-mehost').innerHTML = meHtml();
    voicePeople(root);
  }
  function paintPin(root, srv, ch){
    const bar = root.querySelector('.ds-pin');
    const pm = srv.official && ch?.kind === 'text' ? window.D37Chat.pinned() : null;
    const show = pm && (window.D37Chat.hasNew() ? (pm.channel || 'general') === ch.id : true);
    bar.hidden = !show;
    if (show) bar.innerHTML = `<span>📌</span><div><b>${e(pm.nick)}</b>: ${e(P.clean(pm.text || ''))}</div>${(typeof currentUser !== 'undefined' && currentUser && (currentUser.id === pm.user_id || ['admin', 'moderator'].includes(currentRole))) ? '<button type="button" data-ds="unpin" title="Открепить">✕</button>' : ''}<button type="button" data-ds="jumppin" title="Показать">↗</button>`;
  }
  function refreshSide(){
    if (!page || !page.srv || !document.body.contains(page.root)) return;
    page.root.querySelector('.ds-rail').innerHTML = railHtml('page', page.srv.id);
    page.root.querySelector('.ds-chans').innerHTML = channelsHtml('page', page.srv, page.ch?.id);
    page.root.querySelector('.ds-mehost').innerHTML = meHtml();
    voicePeople(page.root);
  }
  DS.refreshSide = refreshSide;
  // новое сообщение / прочитано / закреп / онлайн / голосовой — перерисовать боковые панели (не чаще раза в 400 мс)
  let sideT = 0;
  const sideSoon = () => { clearTimeout(sideT); sideT = setTimeout(() => { refreshSide(); commBadge(); }, 400); };
  ['d37:chatmsg', 'd37:read', 'd37:chatinfo', 'd37:voice'].forEach(ev => window.addEventListener(ev, sideSoon));
  window.addEventListener('d37:chatpin', () => { if (page?.srv && page.root.isConnected) paintPin(page.root, page.srv, page.ch); });
  let memT = 0;
  window.addEventListener('d37:presence', () => { clearTimeout(memT); memT = setTimeout(() => { if (page?.srv && page.root.isConnected && currentRoute() === 'chat') membersRender(page.root.querySelector('.ds-mbody'), page.srv); }, 800); });
  DS.reroute = () => {
    if (currentRoute() === 'chat' && page) DS.page(page.root.parentElement, currentRouteParam());
    if (P.isOpen() && (P.path() || '').startsWith('comm')) P.refresh();
  };
  // ушли со страницы чата — ленту закрыть (отписаться от «печатает…» и т.п.)
  window.addEventListener('hashchange', () => {
    if (currentRoute() !== 'chat' && page && mvHost && page.root.contains(mvHost)) dropView();
    const fr = document.getElementById('chat-twitch');
    if (fr && currentRoute() !== 'chat') { fr.style.display = 'none'; document.getElementById('chatTwitchHome')?.appendChild(fr); }
  });

  async function onDsClick(ev){
    const b = ev.target.closest('[data-ds]');
    const root = page?.root || ev.currentTarget;
    if (ev.target.closest('.ds-ch, .ds-srv, .ds-card, a.ds-hb')) root.classList.remove('l-open', 'r-open');
    const mem = ev.target.closest('.ds-mem');
    if (mem) { root.classList.remove('r-open'); if (mv && mvHost && root.contains(mvHost)) mv.userCard(mem.dataset.uid, mem.dataset.nick, mem, null); else location.hash = '#/profile/' + mem.dataset.uid; return; }
    if (!b) return;
    const k = b.dataset.ds;
    if (k === 'left') root.classList.toggle('l-open');
    else if (k === 'right') { if (matchMedia('(min-width: 1181px)').matches) root.classList.toggle('m-hide'); else root.classList.toggle('r-open'); }
    else if (k === 'close') root.classList.remove('l-open', 'r-open');
    else if (k === 'search') mv?.search();
    else if (k === 'pins') mv?.pins();
    else await commonAct(k, page?.srv, 'page');
  }
  async function commonAct(k, srv, mode){
    if (k === 'guest') { if (typeof enterAsGuest === 'function') enterAsGuest(); }
    else if (k === 'login') { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); }
    else if (k === 'phone') P.open();
    else if (k === 'invite' && srv) showInvite(srv);
    else if (k === 'unpin') { const pm = window.D37Chat.pinned(); if (pm && typeof unpinMessage === 'function') unpinMessage(pm.id); }
    else if (k === 'jumppin') { const pm = window.D37Chat.pinned(); if (pm) mv?.jump(pm.id); }
    else if (k === 'vmute') window.D37Calls?.voiceMute();
    else if (k === 'vdeaf') window.D37Calls?.voiceDeaf();
    else if (k === 'vleave') window.D37Calls?.voiceLeave();
  }

  // ═══ ТЕЛЕФОН: приложение «Сообщества» ═══
  // comm → серверы + каналы; comm/<сервер>/<канал> → лента; …/members, …/settings, …/reports; comm/find, comm/new, comm/join/<код>
  P.define('comm', {
    render(el, arg){
      const parts = String(arg || '').split('/').filter(Boolean);
      let disposed = false;
      const draw = async () => {
        if (parts[0] === 'find' || parts[0] === 'new' || parts[0] === 'join') {
          el.innerHTML = P.head(parts[0] === 'find' ? '🧭 Найти' : parts[0] === 'new' ? '＋ Новое' : '🏰 Приглашение') + '<div class="ph-body ds-ph"></div>';
          const b = el.querySelector('.ph-body');
          if (parts[0] === 'find') screenFind(b, 'phone'); else if (parts[0] === 'new') screenCreate(b, 'phone'); else screenJoin(b, 'phone', parts[1] || '');
          return;
        }
        await loadMy();
        let srvId = parts[0] ? (parts[0] === OFF_ID ? OFF_ID : +parts[0]) : (DS.lastPhoneSrv || OFF_ID);
        if (srvId !== OFF_ID && !Number.isFinite(srvId)) srvId = OFF_ID;
        const srv = await server(srvId);
        if (disposed) return;
        const sub = parts[1];
        if (!sub) {
          // серверы слева, каналы справа (как левая панель мобильного Дискорда)
          DS.lastPhoneSrv = srvId;
          el.innerHTML = P.head('Сообщества', srv.ok && !srv.official && srv.role ? '<button type="button" class="ph-hbtn" data-ds="invite" title="Пригласить">🔗</button>' : '') +
            `<div class="ph-body ds-ph ds-phhome"><nav class="ds-rail">${railHtml('phone', srvId)}</nav><div class="ds-side">${srv.ok ? headHtml('phone', srv) + `<div class="ds-chans">${channelsHtml('phone', srv, null)}</div>` : `<div class="ds-pane">${srv.reason === 'soon' ? '<div class="ds-soon">🛠️ Сообщества появятся, когда сайт обновится. Сервер «Денчик37» (общий чат) — уже работает.</div>' : srv.reason === 'banned' ? '<b>⛔ Тебя забанили здесь</b>' : srv.reason === 'private' ? '<b>🔒 Закрытое сообщество</b><p class="ds-dim">Только по приглашению</p>' : '<b>Не найдено</b>'}</div>`}${srv.ok ? `<a class="ds-ch ds-memlink" href="${link('phone', srv.id, 'members')}"><i>👥</i><span>Участники</span></a>` : ''}<div class="ds-mehost">${meHtml()}</div></div></div>`;
          voicePeople(el);
          el.querySelector('.ph-body').addEventListener('click', ev => { const b = ev.target.closest('[data-ds]'); if (b) commonAct(b.dataset.ds, srv, 'phone'); });
          el.querySelector('[data-ds="invite"]')?.addEventListener('click', () => showInvite(srv));
          return;
        }
        if (!srv.ok) { P.back(); return; }
        if (sub === 'members' || sub === 'settings' || sub === 'reports') {
          el.innerHTML = P.head(sub === 'members' ? '👥 Участники' : sub === 'settings' ? '⚙️ Настройки' : '🚩 Жалобы') + '<div class="ph-body ds-ph"></div>';
          const b = el.querySelector('.ph-body');
          if (sub === 'members') { b.innerHTML = '<div class="ds-mlist"></div>'; membersRender(b.firstChild, srv); b.addEventListener('click', ev => { const m = ev.target.closest('.ds-mem'); if (m) location.hash = '#/profile/' + m.dataset.uid; }); }
          else if (sub === 'settings') screenSettings(b, 'phone', srv);
          else screenReports(b, 'phone', srv);
          return;
        }
        const ch = srv.channels.find(c => String(c.id) === sub && !c.soon);
        if (!ch) { P.back(); return; }
        el.innerHTML = P.head(`${ch.kind === 'voice' ? '🔊' : ch.kind === 'twitch' ? '📺' : '#'} ${e(ch.name)}`, ch.kind === 'text' ? '<button type="button" class="ph-hbtn" data-ds="search" title="Поиск">🔍</button><button type="button" class="ph-hbtn" data-ds="pins" title="Закреплённые">📌</button>' : '') + '<div class="ph-body ph-mvhost"></div>';
        const view = showChannel(el.querySelector('.ph-body'), 'phone', srv, ch);
        el.querySelector('[data-ds="search"]')?.addEventListener('click', () => view?.search());
        el.querySelector('[data-ds="pins"]')?.addEventListener('click', () => view?.pins());
      };
      draw();
      const onSide = () => { if (!parts[1] && !disposed) draw(); };
      window.addEventListener('d37:voice', onSide);
      return () => { disposed = true; window.removeEventListener('d37:voice', onSide); if (mvHost && el.contains(mvHost)) dropView(); };
    },
  });

  // Приглашение #/c/<код> → страница чата с экраном вступления
  DS._test = { cmMsg, link, REASON, railHtml: () => railHtml('page', OFF_ID) };
  commBadge();
  window.addEventListener('d37:auth', () => { S.my = []; S.myAt = 0; S.cache.clear(); S.members.clear(); if (P.me()) loadMy(true); });
})();
