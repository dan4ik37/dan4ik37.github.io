// ═══════════════════════════════════════
//  ЛЕНТА СООБЩЕНИЙ + ПОЛЕ ВВОДА (MsgView) — одна на весь сайт: общий чат (сервер «Денчик37», chat.js), сообщества
//  (community.js), личные сообщения в телефоне (phone-apps.js). Разница — только в «адаптере» канала (откуда сообщения).
// ═══════════════════════════════════════
// const v = MsgView.mount(el, { adapter, compact }) → v.setAdapter(a), v.destroy(), v.focus(), v.search(), v.pins(), v.jump(id),
//   v.push({ sys: true, text }) — строчка от системы (только у себя).
// Адаптер: key ('o:general' | 'c:12' | 'dm:<uid>'), title ('#общий'), maxLen,
//   caps { reply, edit, del, react: 'site' | 'count' | false, pin, report, typing, search, stickers, mod },
//   load({ before }) → { list, more } (по возрастанию id) · sub(fn) → отписка, fn({ t: 'ins' | 'upd', m })
//   send(text, replyId) → { ok, m?, err } · edit(m, text) · del(m) · react(m, emoji) · pin(m, on) · report(m, why) → { ok, err }
//   fetch(ids) → [m] · search(q) → [m] · pins() → [m] · typing { send(), on(fn) → off } · members(q) → [{ id, nick }]
//   state() → { mode: 'write' | 'guest' | 'login' | 'join' | 'muted' | 'readonly', note, until, slow } · me() → { uid, nick, staff }
//   canPin(m), canDel(m), modActions(m) → [[k, текст]], mod(k, m), userMod(uid, nick) → [[k, текст]], onJoin()
// Сообщение: { id, uid, nick, text, at, reply, edited, deleted, hidden, sticker, role, vip, reactions, pinned, sys, mine }
// Ссылки на сайт превращаются в карточки: ролик /v/<id>, игра /games/<id>, комната #/games/<id>/<код> («позвать в игру»),
// игра игрока /g/<id>, приглашение в сообщество #/c/<код>, событие #/chat/ev/<id> (community2.sql: «✅ Пойду» прямо в карточке),
// эфир #/chat/twitch (так пишет «Денчик-бот»). Чужие ссылки — «[ссылка]», мат закрывается (как в мире).
(() => {
  const P = window.D37Phone;
  const MV = window.MsgView = window.MsgView || {};
  const GROUP_MS = 7 * 60e3, KEEP = 350;
  const touch = () => matchMedia('(pointer: coarse)').matches;
  const e = s => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  // ── Прочитано: последний увиденный id по каналам (браузер) ──
  let readMap = {};
  try { readMap = JSON.parse(localStorage.getItem('d37_read') || '{}') || {}; } catch (er) {}
  let readSaveT = 0;
  MV.lastRead = key => +readMap[key] || 0;
  MV.markRead = (key, id) => {
    if (!key || !id || (+readMap[key] || 0) >= id) return;
    readMap[key] = id;
    clearTimeout(readSaveT);
    readSaveT = setTimeout(() => {
      const keys = Object.keys(readMap); if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete readMap[k];
      try { localStorage.setItem('d37_read', JSON.stringify(readMap)); } catch (er) {}
    }, 500);
    window.dispatchEvent(new CustomEvent('d37:read', { detail: { key, id } }));
  };

  // ── Заблокированные: с community.sql — на сервере (user_blocks: не напишет в ЛС, не позовёт в друзья); до него — в этом
  //    браузере (его сообщения скрыты, звонки не звонят) + дружба удаляется на сервере (и ЛС он больше писать не сможет) ──
  const LB = 'd37_blocks_local';
  const localBlocks = () => { try { return JSON.parse(localStorage.getItem(LB) || '[]') || []; } catch (er) { return []; } };
  MV.blocked = new Set(localBlocks());
  let blocksLoaded = '';
  MV.loadBlocks = async () => {
    const me = P.me(); if (!me || blocksLoaded === me || typeof sbClient === 'undefined' || !sbClient) return;
    blocksLoaded = me;
    try { const { data, error } = await sbClient.from('user_blocks').select('blocked_id'); MV.blocked = new Set([...(error ? [] : (data || []).map(r => r.blocked_id)), ...localBlocks()]); } catch (er) {}
  };
  window.addEventListener('d37:auth', () => { blocksLoaded = ''; MV.blocked = new Set(localBlocks()); MV.loadBlocks(); });
  MV.block = async (uid, on) => {
    const me = P.me();
    const { data, error } = await P.rpc(on ? 'user_block' : 'user_unblock', { p_uid: uid });
    if (error && !error.missing && !P.missing(error)) return { ok: false, err: P.err(error) };
    const l = localBlocks().filter(x => x !== uid);
    if (error) {   // community.sql ещё нет — блокируем у себя
      if (on) l.push(uid);
      if (on && me) { try { await sbClient.from('friendships').delete().or(`and(requester_id.eq.${me},addressee_id.eq.${uid}),and(requester_id.eq.${uid},addressee_id.eq.${me})`); } catch (er) {} }
    }
    try { localStorage.setItem(LB, JSON.stringify(l.slice(-500))); } catch (er) {}
    if (error || data?.ok) { if (on) MV.blocked.add(uid); else MV.blocked.delete(uid); P.dropFriends?.(); window.dispatchEvent(new Event('d37:blocks')); return { ok: true }; }
    return { ok: false, err: 'Не получилось' };
  };

  // ═══ Текст сообщения: эмодзи сайта, @, ссылки → карточки, мат закрыт ═══
  const SITE_RE = /^(?:https?:\/\/)?dan4ik37\.vercel\.app(\/[^\s<>"']*)?$/i;
  const HASH_RE = /^#\/(?:games|c|chat|phone|profile)\/[^\s<>"']*$/;
  const EXT_RE = /^(?:https?:\/\/|www\.)\S+$|^[a-z0-9-]{2,}\.(?:ru|com|net|org|io|gg|me|xyz|su|ly|cc|top|link|рф)(?:\/\S*)?$/i;
  function sitePath(w){
    let m = SITE_RE.exec(w);
    if (m) { let p = m[1] || '/'; if (p.startsWith('/#')) p = p.slice(1); return p; }
    if (HASH_RE.test(w)) return w;
    return null;
  }
  MV.cardOf = path => {
    let m;
    if ((m = /^\/v\/([A-Za-z0-9_-]{11})\/?$/.exec(path))) return { t: 'video', id: m[1] };
    if ((m = /^#\/games\/([a-z0-9]+)\/(coop\/)?([a-z0-9]{4,12})\/?$/.exec(path)) && m[1] !== 'studio' && m[1] !== 'studio3d' && m[1] !== 'unity') return { t: 'room', g: m[1], coop: !!m[2], code: m[3] };
    if ((m = /^(?:#\/games|\/games)\/([a-z0-9]+)\/?$/.exec(path))) return { t: 'game', g: m[1] };
    if ((m = /^\/g\/([0-9a-f]{8})\/?$/.exec(path))) return { t: 'ugc', id: m[1] };
    if ((m = /^(?:#\/c|\/c)\/([a-z0-9]{6,12})\/?$/.exec(path))) return { t: 'invite', code: m[1] };
    if ((m = /^#\/phone\/call\/([a-z0-9]{8,16})$/.exec(path))) return { t: 'call', code: m[1] };
    if ((m = /^#\/chat\/ev\/(\d{1,12})\/?$/.exec(path))) return { t: 'event', id: +m[1] };
    if (/^#\/chat\/twitch\/?$/.test(path)) return { t: 'live' };
    return null;
  };
  const gameOf = id => (typeof GAMES !== 'undefined' && GAMES.find(g => g.id === id)) || null;
  function linkLabel(path, card){
    if (card?.t === 'video') return '🎬 видео';
    if (card?.t === 'room' || card?.t === 'game') { const g = gameOf(card.g); return g ? `${g.icon} ${g.title}` : '🎮 игра'; }
    if (card?.t === 'ugc') return '🛠️ игра игрока';
    if (card?.t === 'invite') return '🏰 приглашение';
    if (card?.t === 'call') return '📞 звонок';
    if (card?.t === 'event') return '📅 событие';
    if (card?.t === 'live') return '🔴 эфир';
    return '🔗 ' + path.replace(/^#?\//, '').slice(0, 32);
  }
  const hrefOf = path => path.startsWith('#') ? path : path;
  function emojiImg(name){
    const list = typeof customEmoji !== 'undefined' && Array.isArray(customEmoji) ? customEmoji : [];
    const c = list.find(x => x.name === name);
    return c ? `<img class="custom-emoji-img inline-emoji" src="${e(c.image_url)}" alt=":${e(name)}:" title=":${e(name)}:">` : null;
  }
  // → { html, cards: [описание], big: только эмодзи }. o.kid — ребёнок до 13 (js/core/age.js) в общем канале: ссылки скрыты
  // (кроме роликов и игр сайта), телефоны, почта и соцсети — «[скрыто]»; в ЛС (только друзья) — как у всех
  MV.rich = (text, myNick, o = {}) => {
    const cards = [];
    const kid = !!o.kid && !!window.D37Age;
    const words = (kid ? window.D37Age.kidText(String(text || ''), { at: false }) : String(text || '')).split(/(\s+)/);
    const html = words.map(w => {
      if (!w) return '';
      if (/^\s+$/.test(w)) return w.includes('\n') ? '<br>'.repeat(Math.min(3, (w.match(/\n/g) || []).length)) : ' ';
      const path = sitePath(w);
      if (path) {
        const card = MV.cardOf(path);
        if (kid && !(card && (card.t === 'video' || card.t === 'game' || card.t === 'event'))) return '<span class="mv-dim">[ссылка]</span>';
        if (card && cards.length < 2 && !cards.some(c => JSON.stringify(c) === JSON.stringify(card))) cards.push(card); return `<a class="mv-link" href="${e(hrefOf(path))}">${e(linkLabel(path, card))}</a>`;
      }
      if (EXT_RE.test(w)) return '<span class="mv-dim">[ссылка]</span>';
      let c = P.clean(w);
      if (/^@[\p{L}0-9_.-]{2,24}[.,!?:;)]*$/u.test(c)) {
        const nick = c.slice(1).replace(/[.,!?:;)]+$/, ''), tail = c.slice(1 + nick.length);
        return `<b class="mv-at${myNick && nick.toLowerCase() === String(myNick).toLowerCase() ? ' me' : ''}">@${e(nick)}</b>${e(tail)}`;
      }
      let out = e(c);
      if (out.includes(':')) out = out.replace(/:([a-z0-9_]{1,32}):/g, (m, n) => emojiImg(n) || m);
      return out;
    }).join('');
    const big = P.onlyEmoji(text) || (/^(:[a-z0-9_]{1,32}:\s*){1,4}$/.test(String(text).trim()) && !!emojiImg(String(text).trim().split(':')[1]));
    return { html, cards, big };
  };
  const ugcCache = new Map(), invCache = new Map();
  MV.cardHtml = c => {
    if (c.t === 'video') {
      const v = typeof allVids !== 'undefined' && Array.isArray(allVids) ? allVids.find(x => x.id === c.id) : null;
      return `<a class="mv-card mv-vid" href="/v/${e(c.id)}"><img src="https://i.ytimg.com/vi/${e(c.id)}/mqdefault.jpg" alt="" loading="lazy"><span><b>${e(v?.title || 'Видео dan4ik37')}</b><small>▶ Смотреть на сайте</small></span></a>`;
    }
    if (c.t === 'game' || c.t === 'room') {
      const g = gameOf(c.g); if (!g) return '';
      const href = c.t === 'room' ? `#/games/${c.g}/${c.coop ? 'coop/' : ''}${c.code}` : (g.href || `#/games/${g.id}`);
      return `<div class="mv-card mv-game${c.t === 'room' ? ' mv-room' : ''}" style="--gc:${e(g.color || '#7c3aed')}"><i>${g.icon}</i><span><b>${c.t === 'room' ? `Зовёт в «${e(g.title)}»` : e(g.title)}</b><small>${c.t === 'room' ? `Комната ${e(c.code)} · ${c.coop ? 'играем вместе' : 'друг против друга'}` : e((g.desc || '').slice(0, 90))}</small></span><a class="mv-cbtn" href="${e(href)}">${c.t === 'room' ? '▶ Войти' : 'Играть'}</a></div>`;
    }
    if (c.t === 'ugc') return `<a class="mv-card" href="/g/${e(c.id)}"><i>🛠️</i><span><b data-ugc="${e(c.id)}">${e(ugcCache.get(c.id)?.title || 'Игра игрока')}</b><small>Студия игр — играть по ссылке</small></span></a>`;
    if (c.t === 'call') return `<div class="mv-card mv-call" style="--gc:#16a34a"><i>📞</i><span><b>Голосовой звонок</b><small>Разговор напрямую — до 6 друзей</small></span><a class="mv-cbtn" href="#/phone/call/${e(c.code)}">Войти</a></div>`;
    if (c.t === 'live') return `<div class="mv-card mv-live" style="--gc:#9147ff"><i>🔴</i><span><b>Денчик в эфире на Twitch</b><small>Стрим идёт — смотри и пиши в чат трансляции</small></span><a class="mv-cbtn" href="https://www.twitch.tv/${typeof TWITCH !== 'undefined' ? e(TWITCH) : 'dan4ik37'}" target="_blank" rel="noopener">▶ Смотреть</a></div>`;
    if (c.t === 'event') return MV.evCardHtml(c.id);
    if (c.t === 'invite') { const i = invCache.get(c.code); return `<div class="mv-card mv-inv" data-inv="${e(c.code)}"><i>${e(i?.icon || '🏰')}</i><span><b>${i ? e(i.name) : 'Приглашение в сообщество'}</b><small>${i ? `${i.members} ${P.plural(i.members, 'участник', 'участника', 'участников')}${i.about ? ' · ' + e(i.about.slice(0, 60)) : ''}` : 'Сообщество на сайте dan4ik37'}</small></span><a class="mv-cbtn" href="#/c/${e(c.code)}">Вступить</a></div>`; }
    return '';
  };
  // ── События (community2.sql): карточка в ленте, «✅ Пойду» прямо в ней ──
  // evCache: id → событие (как cm_event_get) | false (нет, отменено или не видно); пусто — ещё грузим
  const evCache = new Map();
  MV.evSet = ev => { if (ev && ev.id) evCache.set(+ev.id, ev); };
  MV.evGet = id => evCache.get(+id);
  MV.evLive = ev => !!ev && ev.status === 'active' && Date.parse(ev.starts_at) <= Date.now() && Date.now() < Date.parse(ev.ends_at);
  MV.evWhen = ev => {
    const s = Date.parse(ev.starts_at), en = Date.parse(ev.ends_at), now = Date.now();
    if (ev.status === 'cancelled') return '❌ отменено';
    if (now >= en) return 'закончилось';
    if (now >= s) return '🔴 Сейчас идёт';
    const d = new Date(s), t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const days = Math.round((new Date(s).setHours(0, 0, 0, 0) - d0) / 864e5);
    if (days === 0) return s - now < 3600e3 ? `через ${Math.max(1, Math.round((s - now) / 60e3))} мин` : `сегодня в ${t}`;
    if (days === 1) return `завтра в ${t}`;
    return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + t;
  };
  // Где проходит: { label, href, ext } (ссылка на Twitch детям не показывается)
  MV.evPlace = ev => {
    const k = ev.place_kind, p = String(ev.place || '');
    if (k === 'text' || k === 'voice') return { label: (k === 'voice' ? '🔊 ' : '#') + (ev.place_name || p), href: ev.community ? `#/chat/c/${ev.community}/${p}` : `#/chat/${p}` };
    if (k === 'world') return { label: '🌍 Мир Денчика', href: '#/games/world' };
    if (k === 'game') { const g = gameOf(p); return { label: g ? `${g.icon} ${g.title}` : '🎮 игра', href: `#/games/${p}` }; }
    if (k === 'stream') return { label: '📺 Стрим на Twitch', href: window.D37Age?.kid?.() ? '' : `https://www.twitch.tv/${typeof TWITCH !== 'undefined' ? TWITCH : 'dan4ik37'}`, ext: true };
    return { label: '', href: '' };
  };
  MV.evAgeOk = ev => !window.D37Age || !ev.age || window.D37Age.canOpen(ev.age);
  MV.evCardHtml = id => {
    const ev = evCache.get(+id);
    if (ev === undefined) return `<div class="mv-card mv-ev" data-ev="${e(id)}"><i>📅</i><span><b>Событие</b><small>Загружаем…</small></span></div>`;
    if (!ev) return `<div class="mv-card mv-ev off" data-ev="${e(id)}"><i>📅</i><span><b>Событие недоступно</b><small>Его отменили или оно только для участников сообщества</small></span></div>`;
    if (!MV.evAgeOk(ev)) return `<div class="mv-card mv-ev off" data-ev="${e(id)}"><i>🔞</i><span><b>Событие ${e(ev.age)}+</b><small>Не по возрасту</small></span></div>`;
    const live = MV.evLive(ev), pl = MV.evPlace(ev), over = Date.now() >= Date.parse(ev.ends_at) || ev.status !== 'active';
    const btn = over ? '' : live && pl.href ? `<a class="mv-cbtn" href="${e(pl.href)}"${pl.ext ? ' target="_blank" rel="noopener"' : ''}>▶ Зайти</a>`
      : `<button type="button" class="mv-cbtn${ev.mine ? ' on' : ''}" data-evgo="${e(ev.id)}">${ev.mine ? '✓ Иду' : '✅ Пойду'}</button>`;
    return `<div class="mv-card mv-ev${live ? ' live' : ''}${over ? ' off' : ''}" data-ev="${e(ev.id)}"><i>${live ? '🔴' : '📅'}</i><span><b><a href="#/chat/ev/${e(ev.id)}">${e(P.clean(ev.title))}</a></b><small>${e(MV.evWhen(ev))}${pl.label ? ' · ' + e(pl.label) : ''}${ev.age ? ` · ${e(ev.age)}+` : ''} · ✅ ${e(ev.going || 0)}</small></span>${btn}</div>`;
  };
  MV.evRefresh = id => document.querySelectorAll(`.mv-ev[data-ev="${+id}"]`).forEach(x => { x.outerHTML = MV.evCardHtml(+id); });
  const EV_REASON = { auth: 'нужно войти', member: 'сначала вступи в сообщество', age: 'не по возрасту', over: 'событие уже закончилось', rate: 'слишком часто — подожди', not_found: 'событие не найдено' };
  // «✅ Пойду» / «отменить»: → { ok, on, going } | { ok: false, err }
  MV.evRsvp = async id => {
    if (!P.me()) { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); return { ok: false, err: 'auth' }; }
    const cur = evCache.get(+id);
    const r = await P.rpc('cm_event_rsvp', { p_id: +id, p_on: !(cur && cur.mine) });
    if (r.data?.ok) {
      if (cur) { cur.mine = r.data.on; cur.going = r.data.going; }
      MV.evRefresh(id);
      window.dispatchEvent(new CustomEvent('d37:event', { detail: { id: +id, on: r.data.on, going: r.data.going } }));
      return { ok: true, on: r.data.on, going: r.data.going };
    }
    return { ok: false, err: r.missing ? 'события появятся, когда сайт обновится' : r.error ? P.err(r.error) : EV_REASON[r.data?.reason] || 'не получилось' };
  };
  MV.evLoad = async (id, fresh) => {
    if (!fresh && evCache.has(+id)) return evCache.get(+id);
    const r = await P.rpc('cm_event_get', { p_id: +id });
    const ev = r.data?.ok ? r.data.ev : r.data || r.missing ? false : null;   // null — нет связи: спросим ещё раз
    if (ev !== null) evCache.set(+id, ev);
    return ev;
  };

  // дозагрузка названий для карточек (игры игроков, приглашения, события)
  async function fillCards(root){
    const ugc = [...root.querySelectorAll('[data-ugc]')].map(x => x.dataset.ugc).filter(id => !ugcCache.has(id));
    if (ugc.length && typeof sbClient !== 'undefined' && sbClient) {
      ugc.forEach(id => ugcCache.set(id, null));
      try { const { data } = await sbClient.from('ugc_games').select('id, title, icon').in('id', [...new Set(ugc)]); (data || []).forEach(g => ugcCache.set(g.id, g)); } catch (er) {}
      root.querySelectorAll('[data-ugc]').forEach(b => { const g = ugcCache.get(b.dataset.ugc); if (g) { b.textContent = g.title; const i = b.closest('.mv-card')?.querySelector('i'); if (i && g.icon) i.textContent = g.icon; } });
    }
    for (const el of root.querySelectorAll('.mv-inv[data-inv]')) {
      const code = el.dataset.inv; if (invCache.has(code)) continue;
      invCache.set(code, null);
      const { data } = await P.rpc('cm_invite_info', { p_code: code });
      if (data) { invCache.set(code, data); root.querySelectorAll(`.mv-inv[data-inv="${code}"]`).forEach(x => { x.outerHTML = MV.cardHtml({ t: 'invite', code }); }); }
    }
    for (const el of root.querySelectorAll('.mv-ev[data-ev]')) {
      const id = +el.dataset.ev; if (evCache.has(id)) continue;
      const ev = await MV.evLoad(id);
      if (ev !== null) MV.evRefresh(id);
    }
  }

  // ── Цвет и значки автора ──
  const ROLE = { admin: ['ADMIN', '255,45,85'], moderator: ['MOD', '145,71,255'], helper: ['HELPER', '34,197,94'], bot: ['🤖 БОТ', '88,101,242'], owner: ['👑', '250,204,21'], mod: ['🛡', '96,165,250'] };
  // «Денчик-бот» (community2.sql → bot_post): роль 'bot' ставит только сервер — браузер её подделать не может (vip-balance.sql)
  const isBot = m => !!m && m.role === 'bot' && !m.uid;
  function authorStyle(m){
    const p = m.uid ? P.prof(m.uid) : null;
    const role = m.role && ROLE[m.role] ? m.role : p?.role && ROLE[p.role] ? p.role : null;
    let rgb = role ? ROLE[role][1] : null, vip = null;
    if (!rgb && typeof VIP_TIERS !== 'undefined') {
      vip = m.vip ? VIP_TIERS.find(t => t.key === m.vip) : (p && typeof getVipTier === 'function' ? getVipTier(p) : null);
      if (vip) rgb = vip.rgb;
    }
    if (!rgb && m.color && /^#[0-9a-f]{3,8}$/i.test(m.color)) return { color: m.color, role, vip };
    return { rgb, role, vip };
  }
  function badgeHtml(m, st, extra){
    let b = '';
    if (st.role && !['owner', 'mod'].includes(st.role)) b += `<i class="mv-role" style="--rc:${ROLE[st.role][1]}">${ROLE[st.role][0]}</i>`;
    else if (st.vip) b += `<i class="mv-role" style="--rc:${st.vip.rgb}">${st.vip.key === 'gold' ? '✨' : st.vip.key === 'silver' ? '⭐' : '🔸'} ${st.vip.key.toUpperCase()}</i>`;
    if (extra && ROLE[extra]) b += `<i class="mv-crole" title="${extra === 'owner' ? 'Владелец' : 'Модератор'}">${ROLE[extra][0]}</i>`;
    if (m.uid) b += `<span class="lv-badge" data-lv-uid="${e(m.uid)}"></span>`;
    return b;
  }
  const dayName = iso => {
    const d = new Date(iso), n = new Date(), y = new Date(n); y.setDate(n.getDate() - 1);
    if (d.toDateString() === n.toDateString()) return 'Сегодня';
    if (d.toDateString() === y.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
  };

  // ═══ Компонент ═══
  MV.mount = (root, opt = {}) => {
    const V = { root, A: null, msgs: new Map(), order: [], more: false, loading: false, unsub: null, typOff: null, typers: new Map(), lastTyping: 0,
      reply: null, editing: null, atBottom: true, newCount: 0, divider: 0, seq: 0, destroyed: false, slowT: 0 };
    root.classList.add('mv'); if (opt.compact) root.classList.add('mv-compact');
    root.innerHTML = `<div class="mv-list" role="log" aria-live="polite" aria-label="Сообщения"></div>
      <button type="button" class="mv-down" hidden>↓ <span>Новые сообщения</span></button>
      <div class="mv-typing" aria-live="polite"></div>
      <div class="mv-comp">
        <div class="mv-bar mv-replybar" hidden><span></span><button type="button" data-c="noreply" aria-label="Не отвечать">✕</button></div>
        <div class="mv-bar mv-editbar" hidden><span>✏️ Изменение сообщения · Esc — отмена</span><button type="button" data-c="noedit" aria-label="Отменить изменение">✕</button></div>
        <div class="mv-note" hidden></div>
        <div class="mv-ac" hidden role="listbox"></div>
        <div class="mv-panel" hidden></div>
        <div class="mv-row">
          <button type="button" class="mv-cb" data-c="emoji" title="Эмодзи" aria-label="Эмодзи">😀</button>
          <button type="button" class="mv-cb mv-stk" data-c="sticker" title="Стикеры (VIP)" aria-label="Стикеры" hidden>🎉</button>
          <textarea class="mv-in" rows="1" aria-label="Сообщение"></textarea>
          <button type="button" class="mv-send" data-c="send" aria-label="Отправить">➤</button>
        </div>
        <div class="mv-gate" hidden></div>
      </div>
      <div class="mv-over" hidden></div>
      <div class="mv-menu" hidden></div>`;
    const q = s => root.querySelector(s);
    const list = q('.mv-list'), input = q('.mv-in'), over = q('.mv-over'), menu = q('.mv-menu');
    const myNick = () => V.A?.me?.()?.nick || P.myNick() || (typeof chatNick !== 'undefined' ? chatNick : '');
    const myUid = () => V.A?.me?.()?.uid || P.me();
    // ребёнок (js/core/age.js) в общем канале или сообществе — строгий вид; ЛС (только друзья) — как у всех
    const kidView = () => !!window.D37Age?.kid?.() && !/^dm:/.test(V.A?.key || '');

    // ── Отрисовка одного сообщения ──
    function html(m, prev){
      if (m.sys) return `<div class="mv-sys" data-id="${e(m.id)}">${e(m.text)}</div>`;
      const st = authorStyle(m), blocked = m.uid && MV.blocked.has(m.uid);
      const first = !prev || prev.sys || prev.uid !== m.uid || prev.nick !== m.nick || m.reply || Date.parse(m.at) - Date.parse(prev.at) > GROUP_MS || dayName(prev.at) !== dayName(m.at);
      const me = myNick(), mine = m.mine || (m.uid ? m.uid === myUid() : !!me && m.nick === me && !myUid());
      const r = blocked ? { html: '', cards: [] } : MV.rich(m.text, me, { kid: kidView() });
      const hl = !mine && me && (new RegExp('@' + me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}0-9_])', 'iu').test(m.text || '') || (m.reply && V.msgs.get(m.reply)?.mine));
      const color = st.rgb ? `color:rgb(${st.rgb})` : st.color ? `color:${e(st.color)}` : '';
      const prof = m.uid ? P.prof(m.uid) : null;
      const ava = isBot(m) ? `<span class="ph-ava mv-ava mv-botava" data-u="" data-n="${e(m.nick)}" style="width:${opt.compact ? 32 : 38}px;height:${opt.compact ? 32 : 38}px">🤖</span>`
        : P.avatar(prof || (st.rgb ? { nick: m.nick, role: st.role } : null), m.nick, opt.compact ? 32 : 38).replace('class="ph-ava"', `class="ph-ava mv-ava" data-u="${e(m.uid || '')}" data-n="${e(m.nick)}"`);
      const rq = m.reply ? replyQuote(m.reply) : '';
      const crole = V.A?.roleOf?.(m.uid) || null;
      const tools = `<div class="mv-tools">${V.A.caps.react ? '<button type="button" data-a="react" title="Реакция">😊</button>' : ''}${V.A.caps.reply && V.canWrite ? '<button type="button" data-a="reply" title="Ответить">↩</button>' : ''}<button type="button" data-a="more" title="Ещё">⋯</button></div>`;
      const reacts = V.A.caps.react === 'site' ? `<div class="msg-reactions mv-reacts" data-mr="${e(m.id)}"></div>` : V.A.caps.react === 'count' ? `<div class="msg-reactions mv-reacts">${countReacts(m)}</div>` : '';
      const body = blocked
        ? `<div class="mv-text mv-blk">🚫 Сообщение от заблокированного <button type="button" data-a="showblk">показать</button></div>`
        : m.sticker ? `<div class="mv-text mv-sticker">${e(m.text)}</div>`
        : `<div class="mv-text${r.big ? ' mv-big' : ''}">${r.html}${m.edited ? ` <span class="mv-ed" title="${e(P.when(m.edited))}">(изменено)</span>` : ''}</div>${r.cards.length ? `<div class="mv-cards">${r.cards.map(MV.cardHtml).join('')}</div>` : ''}`;
      return `<div class="mv-m${first ? ' mv-first' : ''}${mine ? ' mv-mine' : ''}${hl ? ' mv-hl' : ''}${m.hidden ? ' mv-hid' : ''}" data-id="${e(m.id)}" data-nick="${e(m.nick)}"${m.uid ? ` data-uid="${e(m.uid)}"` : ''}>
        ${rq}${first ? ava : `<time class="mv-t2" title="${e(P.when(m.at))}">${P.hm(m.at)}</time>`}
        <div class="mv-b">${first ? `<div class="mv-h"><button type="button" class="mv-nick" data-a="user" style="${color}">${e(m.nick)}</button>${badgeHtml(m, st, crole)}<time title="${e(new Date(m.at).toLocaleString('ru-RU'))}">${P.when(m.at)}</time>${m.pinned ? '<i class="mv-pin" title="Закреплено">📌</i>' : ''}${m.hidden ? '<i class="mv-flag" title="Скрыто жалобами — видят только модераторы">🚩</i>' : ''}</div>` : ''}${body}${reacts}</div>
        ${tools}</div>`;
    }
    function replyQuote(id){
      const t = V.msgs.get(id);
      if (!t) return `<div class="mv-rq" data-jump="${e(id)}"><i>↪</i><span class="mv-dim">сообщение…</span></div>`;
      if (t.deleted) return `<div class="mv-rq"><i>↪</i><span class="mv-dim">сообщение удалено</span></div>`;
      const txt = t.sticker ? t.text : P.clean(t.text || '').slice(0, 90);
      return `<div class="mv-rq" data-jump="${e(id)}"><i>↪</i><b>${e(t.nick)}</b><span>${e(txt)}</span></div>`;
    }
    function countReacts(m){
      const mine = m.myReacts || new Set();
      return Object.entries(m.reactions || {}).filter(([, n]) => n > 0).map(([em, n]) => `<button type="button" class="react-badge${mine.has(em) ? ' mine' : ''}" data-a="r" data-em="${e(em)}">${e(em)}<span>${n}</span></button>`).join('');
    }

    // ── Список: полностью / добавить / заменить ──
    function renderAll(){
      let out = '', prev = null, lastDay = '';
      for (const id of V.order) {
        const m = V.msgs.get(id); if (!m || m.deleted) continue;
        const day = dayName(m.at);
        if (day !== lastDay) { out += `<div class="mv-day"><span>${e(day)}</span></div>`; lastDay = day; prev = null; }
        if (V.divider && id === V.divider) out += '<div class="mv-new"><span>Новые сообщения</span></div>';
        out += html(m, prev); prev = m;
      }
      if (V.more) out = `<button type="button" class="mv-older" data-a="older">⬆ Загрузить раньше</button>` + out;
      else if (V.order.length) out = `<div class="mv-start">${e(V.A.startText || 'Это начало канала')}</div>` + out;
      list.innerHTML = out || `<div class="mv-empty">${e(V.A.emptyText || 'Пока тихо — напиши первым! 👋')}</div>`;
      after(list);
    }
    function after(scope){
      if (V.A.caps.react === 'site' && typeof renderReactionsFor === 'function') scope.querySelectorAll('[data-mr]').forEach(x => renderReactionsFor(+x.dataset.mr));
      if (typeof xpQueueBadges === 'function') xpQueueBadges();
      window.d37NickFx?.mark?.(scope);
      fillCards(scope);
    }
    function appendOne(m){
      if (!V.order.length) { renderAll(); return; }
      const prevId = V.order[V.order.length - 2], prev = prevId != null ? V.msgs.get(prevId) : null;
      list.querySelector('.mv-empty')?.remove();
      let out = '';
      if (!prev || dayName(prev.at) !== dayName(m.at)) out += `<div class="mv-day"><span>${e(dayName(m.at))}</span></div>`;
      out += html(m, prev && dayName(prev.at) === dayName(m.at) ? prev : null);
      list.insertAdjacentHTML('beforeend', out);
      after(list.lastElementChild || list);
      // слишком длинная лента — старое убираем (подгрузится снова по «раньше»)
      if (V.order.length > KEEP && V.atBottom) { const drop = V.order.splice(0, V.order.length - KEEP); drop.forEach(id => V.msgs.delete(id)); V.more = true; renderAll(); }
    }
    function rerender(id){
      const m = V.msgs.get(id), el = list.querySelector(`.mv-m[data-id="${CSS.escape(String(id))}"]`);
      if (!el) return;
      if (!m || m.deleted) { el.remove(); return; }
      const i = V.order.indexOf(id), prevId = i > 0 ? V.order[i - 1] : null;
      const tmp = document.createElement('div'); tmp.innerHTML = html(m, prevId != null && !el.classList.contains('mv-first') ? V.msgs.get(prevId) : null).trim();
      const ne = tmp.firstElementChild; el.replaceWith(ne); after(ne);
    }

    // ── Прокрутка: внизу ли, «новые», подгрузка истории ──
    const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    function toBottom(){ list.scrollTop = list.scrollHeight; V.atBottom = true; V.newCount = 0; downBtn(); markRead(); }
    function downBtn(){
      const b = q('.mv-down');
      const divEl = list.querySelector('.mv-new');
      const show = !V.atBottom && (V.newCount > 0 || !!divEl);
      b.hidden = !show;
      if (show) b.querySelector('span').textContent = V.newCount ? `${V.newCount} ${P.plural(V.newCount, 'новое сообщение', 'новых сообщения', 'новых сообщений')}` : divEl && divEl.offsetTop > list.scrollTop + list.clientHeight ? 'К новым сообщениям' : 'Вниз, к последним';
    }
    function markRead(){
      if (document.hidden || !V.atBottom || !V.A) return;
      const last = V.order[V.order.length - 1];
      if (typeof last === 'number') MV.markRead(V.A.key, last);
    }
    list.addEventListener('scroll', () => {
      V.atBottom = nearBottom();
      if (V.atBottom) { V.newCount = 0; markRead(); }
      downBtn();
      if (list.scrollTop < 60 && V.more && !V.loading) older();
      closeMenu();
    }, { passive: true });
    q('.mv-down').addEventListener('click', () => {
      const d = list.querySelector('.mv-new');
      if (d && !V.newCount && d.offsetTop > list.scrollTop + list.clientHeight) d.scrollIntoView({ block: 'center', behavior: 'smooth' });
      else list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    });
    const onVis = () => { if (!document.hidden) markRead(); };
    document.addEventListener('visibilitychange', onVis);

    async function older(){
      if (V.loading || !V.more || !V.A) return;
      V.loading = true;
      const A = V.A, first = V.order.find(id => typeof id === 'number');
      const h0 = list.scrollHeight, t0 = list.scrollTop;
      let r;
      try { r = await A.load({ before: first }); } catch (er) { r = null; }
      V.loading = false;
      if (A !== V.A || !r) return;
      const add = (r.list || []).filter(m => !V.msgs.has(m.id));
      add.forEach(m => V.msgs.set(m.id, m));
      V.order = [...add.map(m => m.id), ...V.order];
      V.more = !!r.more;
      renderAll();
      list.scrollTop = list.scrollHeight - h0 + t0;
      loadReplies(add); loadAuthors(add);
      if (A.caps.react === 'site' && typeof loadReactionsFor === 'function') loadReactionsFor(add.map(m => m.id));
    }

    // ── Ответы на сообщения, которых нет на экране ──
    async function loadReplies(ms){
      const need = [...new Set(ms.filter(m => m.reply && !V.msgs.has(m.reply)).map(m => m.reply))];
      if (!need.length || !V.A.fetch) return;
      const A = V.A;
      let got = [];
      try { got = await A.fetch(need); } catch (er) {}
      if (A !== V.A) return;
      const byId = new Map(got.map(m => [m.id, m]));
      for (const id of need) if (!byId.has(id)) byId.set(id, { id, deleted: true });
      for (const el of list.querySelectorAll('.mv-rq[data-jump]')) {
        const t = byId.get(+el.dataset.jump) || byId.get(el.dataset.jump); if (!t) continue;
        V.refs = V.refs || new Map(); V.refs.set(t.id, t);
        el.outerHTML = t.deleted ? '<div class="mv-rq"><i>↪</i><span class="mv-dim">сообщение удалено</span></div>' : `<div class="mv-rq" data-jump="${e(t.id)}"><i>↪</i><b>${e(t.nick)}</b><span>${e(t.sticker ? t.text : P.clean(t.text || '').slice(0, 90))}</span></div>`;
      }
    }
    // ── Аватарки и цвета авторов (профили) ──
    async function loadAuthors(ms){
      const ids = [...new Set(ms.filter(m => m.uid).map(m => m.uid))].filter(id => !P.prof(id));
      if (!ids.length) return;
      await P.profiles(ids);
      for (const id of ids) {
        const p = P.prof(id); if (!p) continue;
        list.querySelectorAll(`.mv-ava[data-u="${CSS.escape(id)}"]`).forEach(a => { a.outerHTML = P.avatar(p, p.nick, opt.compact ? 32 : 38).replace('class="ph-ava"', `class="ph-ava mv-ava" data-u="${e(id)}" data-n="${e(p.nick)}"`); });
      }
    }

    // ── Канал ──
    V.setAdapter = async (A) => {
      const seq = ++V.seq;
      V.unsub?.(); V.unsub = null; V.typOff?.(); V.typOff = null; V.typers.clear(); renderTyping();
      V.A = A; V.msgs.clear(); V.order = []; V.more = false; V.reply = null; V.editing = null; V.newCount = 0; V.divider = 0; V.refs = null;
      closeOver(); closeMenu(); closePanel(); setReply(null); setEdit(null);
      input.value = ''; autosize();
      input.placeholder = A.placeholder || `Написать в ${A.title || 'чат'}`;
      input.maxLength = A.maxLen || 500;
      q('.mv-stk').hidden = !A.caps.stickers;
      list.innerHTML = '<div class="mv-load"><i></i>Загружаем сообщения…</div>';
      gate();
      const lastRead = MV.lastRead(A.key);
      let r;
      try { r = await A.load({}); } catch (er) { r = { list: [], err: er }; }
      if (seq !== V.seq || V.destroyed) return;
      if (r.err && !(r.list || []).length) { list.innerHTML = `<div class="mv-empty">😵 ${e(r.errText || 'Не удалось загрузить сообщения')}<br><button type="button" class="mv-retry" data-a="retry">Ещё раз</button></div>`; return; }
      for (const m of r.list || []) { V.msgs.set(m.id, m); V.order.push(m.id); }
      V.more = !!r.more;
      const firstNew = lastRead ? (r.list || []).find(m => typeof m.id === 'number' && m.id > lastRead && !(m.uid && m.uid === myUid())) : null;
      V.divider = firstNew ? firstNew.id : 0;
      renderAll();
      const d = list.querySelector('.mv-new');
      if (d) { d.scrollIntoView({ block: 'center' }); V.atBottom = nearBottom(); downBtn(); } else toBottom();
      loadReplies(r.list || []); loadAuthors(r.list || []);
      if (A.caps.react === 'site' && typeof loadReactionsFor === 'function') loadReactionsFor((r.list || []).map(m => m.id));
      V.unsub = A.sub ? A.sub(onEvent) : null;
      if (A.typing) V.typOff = A.typing.on(onTyping);
      if (!touch() && !opt.noFocus) setTimeout(() => { if (seq === V.seq && V.canWrite) input.focus({ preventScroll: true }); }, 50);
    };
    function onEvent(ev){
      const m = ev.m; if (!m || V.destroyed) return;
      if (ev.t === 'ins') {
        if (V.msgs.has(m.id)) { V.msgs.set(m.id, Object.assign(V.msgs.get(m.id), m)); rerender(m.id); return; }
        // своё «ожидающее» сообщение (показали сразу) — заменить настоящим
        const tmp = V.order.find(id => typeof id === 'string' && id.startsWith('tmp') && V.msgs.get(id)?.text === m.text && V.msgs.get(id)?.mine);
        if (tmp) { V.msgs.delete(tmp); V.order = V.order.filter(x => x !== tmp); list.querySelector(`.mv-m[data-id="${tmp}"]`)?.remove(); }
        const was = nearBottom();
        V.msgs.set(m.id, m); V.order.push(m.id);
        V.typers.delete(m.uid || m.nick); renderTyping();
        appendOne(m);
        if (m.reply) loadReplies([m]);
        loadAuthors([m]);
        const mine = m.uid ? m.uid === myUid() : m.mine;
        if (was || mine) toBottom(); else { V.newCount++; downBtn(); }
        if (V.A.caps.react === 'site' && typeof renderReactionsFor === 'function') renderReactionsFor(m.id);
      } else if (ev.t === 'upd') {
        const old = V.msgs.get(m.id); if (!old) return;
        Object.assign(old, m);
        if (old.deleted) { V.order = V.order.filter(x => x !== m.id); V.msgs.delete(m.id); }
        rerender(m.id);
      }
    }
    // ── «Печатает…» ──
    function onTyping(who){
      if (!who || (who.uid && who.uid === myUid()) || (!who.uid && who.nick === myNick())) return;
      V.typers.set(who.uid || who.nick, { nick: who.nick, t: Date.now() });
      renderTyping();
      clearTimeout(V.typT); V.typT = setTimeout(renderTyping, 4200);
    }
    function renderTyping(){
      const now = Date.now();
      for (const [k, v] of V.typers) if (now - v.t > 4000) V.typers.delete(k);
      const names = [...V.typers.values()].map(v => v.nick);
      const el = q('.mv-typing');
      el.innerHTML = !names.length ? '' : `<i class="mv-dots"><b></b><b></b><b></b></i> ${names.length > 3 ? 'Несколько человек печатают…' : names.map(n => `<b>${e(n)}</b>`).join(names.length === 2 ? ' и ' : ', ') + (names.length > 1 ? ' печатают…' : ' печатает…')}`;
      if (names.length) { clearTimeout(V.typT); V.typT = setTimeout(renderTyping, 1000); }
    }

    // ── Поле ввода: можно ли писать, ответ, изменение ──
    function gate(){
      const st = V.A?.state?.() || { mode: 'write' };
      V.canWrite = st.mode === 'write';
      const g = q('.mv-gate'), row = q('.mv-row'), note = q('.mv-note');
      g.hidden = V.canWrite || st.mode === 'muted' || st.mode === 'readonly';
      row.hidden = !V.canWrite;
      clearInterval(V.slowT);
      if (st.mode === 'guest') g.innerHTML = `<button type="button" class="mv-gbtn" data-a="guest">👤 Войти как гость</button><span>или <button type="button" class="mv-glink" data-a="login">войти в аккаунт</button> — с уровнями, XP и ответами</span>`;
      else if (st.mode === 'login') g.innerHTML = `<span>🔑 ${e(st.note || 'Войди, чтобы писать')}</span><button type="button" class="mv-gbtn" data-a="login">Войти</button>`;
      else if (st.mode === 'join') g.innerHTML = `<span>${e(st.note || 'Вступи, чтобы писать')}</span><button type="button" class="mv-gbtn" data-a="join">Вступить</button>`;
      else g.innerHTML = '';
      if (st.mode === 'muted' || st.mode === 'readonly') { note.hidden = false; note.className = 'mv-note bad'; note.textContent = st.note || (st.mode === 'muted' ? '🔇 Тебя заглушили' : '📢 Здесь пишут только модераторы'); }
      else if (st.slow && V.canWrite) { note.hidden = false; note.className = 'mv-note'; note.textContent = `🐢 Медленный режим: одно сообщение в ${st.slow} с`; }
      else note.hidden = true;
      // ответ и «Ещё» на сообщениях — только если можно писать
      list.classList.toggle('mv-ro', !V.canWrite);
    }
    V.gate = gate;
    function setReply(m){
      V.reply = m ? m.id : null;
      const b = q('.mv-replybar');
      b.hidden = !m;
      if (m) { b.querySelector('span').innerHTML = `↪ Ответ <b>${e(m.nick)}</b>: <i>${e((m.sticker ? m.text : P.clean(m.text || '')).slice(0, 80))}</i>`; if (!touch()) input.focus(); }
    }
    function setEdit(m){
      V.editing = m ? m.id : null;
      q('.mv-editbar').hidden = !m;
      root.classList.toggle('mv-editing', !!m);
      if (m) { setReply(null); input.value = m.text; autosize(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
    function autosize(){ input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, opt.compact ? 110 : 160) + 'px'; }
    function note(text, bad = true, ms = 4000){
      const n = q('.mv-note'); n.hidden = false; n.className = 'mv-note' + (bad ? ' bad' : ' ok'); n.textContent = text;
      clearTimeout(V.noteT); V.noteT = setTimeout(gate, ms);
    }
    V.note = note;
    async function send(){
      const A = V.A; if (!A || !V.canWrite) return;
      const text = input.value.trim();
      if (!text) return;
      if (V.editing) {
        const m = V.msgs.get(V.editing); setEdit(null); input.value = ''; autosize();
        if (!m || text === m.text) return;
        const r = await A.edit(m, text);
        if (r?.ok) { m.text = text; m.edited = new Date().toISOString(); rerender(m.id); }
        else note('⚠️ Не изменилось: ' + (r?.err || 'ошибка'));
        return;
      }
      const reply = V.reply;
      input.value = ''; autosize(); setReply(null); closePanel(); closeAc();
      const r = await A.send(text, reply);
      if (!r?.ok) {
        if (!input.value) input.value = text; autosize();
        if (reply && V.msgs.get(reply)) setReply(V.msgs.get(reply));
        note('⚠️ Не отправлено: ' + (r?.err || 'ошибка'));
        return;
      }
      if (r.m && !V.msgs.has(r.m.id)) onEvent({ t: 'ins', m: r.m });
      toBottom();
    }
    input.addEventListener('input', () => {
      autosize();
      if (V.A?.typing && input.value.trim() && Date.now() - V.lastTyping > 3000 && !V.editing) { V.lastTyping = Date.now(); try { V.A.typing.send(); } catch (er) {} }
      acCheck();
    });
    input.addEventListener('keydown', ev => {
      if (acKey(ev)) return;
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); send(); return; }
      if (ev.key === 'Escape') { if (V.editing) { setEdit(null); input.value = ''; autosize(); ev.stopPropagation(); } else if (V.reply) { setReply(null); ev.stopPropagation(); } else if (!q('.mv-panel').hidden) { closePanel(); ev.stopPropagation(); } return; }
      if (ev.key === 'ArrowUp' && !input.value && V.A?.caps.edit) {
        const last = [...V.order].reverse().map(id => V.msgs.get(id)).find(m => m && !m.sys && !m.sticker && (m.uid ? m.uid === myUid() : false));
        if (last) { ev.preventDefault(); setEdit(last); }
      }
    });
    input.addEventListener('focus', () => { if (touch()) setTimeout(() => toBottom(), 350); });

    // ── @упоминания: подсказка ников ──
    let acList = [], acI = 0, acT = 0;
    function acCtx(){ const pos = input.selectionStart, m = input.value.slice(0, pos).match(/(?:^|\s)@([\p{L}0-9_.-]{1,24})$/u); return m ? { q: m[1], start: pos - m[1].length } : null; }
    function acCheck(){
      clearTimeout(acT);
      const c = acCtx(); if (!c || !V.A?.members) { closeAc(); return; }
      acT = setTimeout(async () => {
        let r = []; try { r = await V.A.members(c.q); } catch (er) {}
        acList = (r || []).filter(x => x.nick).slice(0, 7); acI = 0;
        if (!acList.length || !acCtx()) { closeAc(); return; }
        const box = q('.mv-ac'); box.hidden = false;
        box.innerHTML = acList.map((x, i) => `<button type="button" role="option" class="${i === 0 ? 'on' : ''}" data-ac="${i}">${P.avatar(P.prof(x.id) || null, x.nick, 22)}<b>@${e(x.nick)}</b></button>`).join('');
      }, 180);
    }
    function closeAc(){ const b = q('.mv-ac'); b.hidden = true; b.innerHTML = ''; acList = []; }
    function acPick(i){
      const x = acList[i], c = acCtx(); if (!x) return;
      const end = input.selectionStart;
      input.value = input.value.slice(0, c ? c.start : end) + x.nick + ' ' + input.value.slice(end);
      closeAc(); input.focus(); autosize();
    }
    function acKey(ev){
      if (!acList.length || q('.mv-ac').hidden) return false;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); acI = (acI + (ev.key === 'ArrowDown' ? 1 : acList.length - 1)) % acList.length; q('.mv-ac').querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === acI)); return true; }
      if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); acPick(acI); return true; }
      if (ev.key === 'Escape') { closeAc(); ev.stopPropagation(); return true; }
      return false;
    }

    // ── Эмодзи и стикеры ──
    function openPanel(kind){
      const p = q('.mv-panel');
      if (!p.hidden && p.dataset.k === kind) { closePanel(); return; }
      p.dataset.k = kind; p.hidden = false;
      if (kind === 'emoji') {
        const base = typeof EMOJI !== 'undefined' ? EMOJI : ['😀', '😂', '😍', '😎', '🥳', '😭', '😡', '🤔', '🔥', '❤', '👍', '👎', '🎉', '💀', '👀', '💯'];
        const custom = typeof customEmoji !== 'undefined' && Array.isArray(customEmoji) ? customEmoji : [];
        p.innerHTML = `<div class="mv-emo">${base.map(x => `<button type="button" data-ins="${e(x)}">${x}</button>`).join('')}${custom.length ? `<div class="mv-emo-h">Эмодзи сайта</div>${custom.map(c => `<button type="button" data-ins=":${e(c.name)}:" title=":${e(c.name)}:"><img src="${e(c.image_url)}" alt=":${e(c.name)}:"></button>`).join('')}` : ''}</div>`;
      } else if (kind === 'sticker') {
        const sets = typeof STICKER_SETS !== 'undefined' ? STICKER_SETS : {};
        const open = typeof allowedStickerSets === 'function' ? allowedStickerSets(typeof currentRole !== 'undefined' ? currentRole : null, typeof currentProfile !== 'undefined' ? currentProfile : null) : [];
        p.innerHTML = `<div class="mv-emo mv-stks">${Object.entries(sets).map(([k, list]) => (open.length || k === 'base') ? `${k !== 'base' ? `<div class="mv-emo-h">${k === 'gold' ? '✨ Gold' : '⭐ Silver'}${open.includes(k) ? '' : ' — 🔒'}</div>` : ''}${list.map(s => `<button type="button" data-stk="${e(s)}" class="${open.includes(k) ? '' : 'lock'}">${s}</button>`).join('')}` : '').join('')}</div>${open.length ? '' : '<div class="mv-emo-note">🔒 Стикеры — с VIP. <a href="/vip">Как получить</a></div>'}`;
      }
    }
    function closePanel(){ const p = q('.mv-panel'); p.hidden = true; p.innerHTML = ''; }
    function insertAt(t){
      const s = input.selectionStart ?? input.value.length, en = input.selectionEnd ?? s;
      input.value = input.value.slice(0, s) + t + input.value.slice(en);
      input.focus(); input.setSelectionRange(s + t.length, s + t.length); autosize();
    }
    V.insert = insertAt;

    // ── Окна поверх ленты: поиск, закреплённые ──
    function openOver(head, bodyHtml){
      over.hidden = false;
      over.innerHTML = `<div class="mv-ohead">${head}<button type="button" data-a="closeover" aria-label="Закрыть">✕</button></div><div class="mv-obody">${bodyHtml}</div>`;
      return over.querySelector('.mv-obody');
    }
    function closeOver(){ over.hidden = true; over.innerHTML = ''; }
    const resultRow = m => `<button type="button" class="mv-res" data-go="${e(m.id)}"><b>${e(m.nick)}</b><time>${e(P.when(m.at))}</time><span>${e((m.sticker ? m.text : P.clean(m.text || '')).slice(0, 160))}</span></button>`;
    V.search = () => {
      if (!V.A?.search) return;
      const b = openOver('<input type="search" class="mv-sq" placeholder="🔍 Поиск по каналу…" aria-label="Поиск по каналу">', '<div class="mv-dim">Введи слово или ник</div>');
      const inp = over.querySelector('.mv-sq'); inp.focus();
      let t = 0;
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const s = inp.value.trim(); if (s.length < 2) { b.innerHTML = '<div class="mv-dim">Введи хотя бы 2 буквы</div>'; return; }
          b.innerHTML = '<div class="mv-dim">Ищем…</div>';
          let r = []; try { r = await V.A.search(s); } catch (er) {}
          if (inp.value.trim() !== s) return;
          b.innerHTML = r.length ? r.map(resultRow).join('') : '<div class="mv-dim">Ничего не нашли</div>';
        }, 350);
      });
      inp.addEventListener('keydown', ev => { if (ev.key === 'Escape') { closeOver(); ev.stopPropagation(); } });
    };
    V.pins = async () => {
      if (!V.A?.pins) return;
      const b = openOver('<b>📌 Закреплённые</b>', '<div class="mv-dim">Загружаем…</div>');
      let r = []; try { r = await V.A.pins(); } catch (er) {}
      b.innerHTML = r.length ? r.map(resultRow).join('') : `<div class="mv-dim">${e(V.A.pinsEmpty || 'Закреплённых сообщений нет')}</div>`;
    };
    // ── Перейти к сообщению (ответ, поиск, закреп): нет на экране — подгружаем раньше, до 6 страниц ──
    V.jump = async id => {
      closeOver();
      for (let i = 0; i < 6 && !V.msgs.has(id) && V.more; i++) await older();
      const el = list.querySelector(`.mv-m[data-id="${CSS.escape(String(id))}"]`);
      if (!el) { note('Это сообщение слишком старое или удалено', true, 2500); return; }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('mv-flash'); void el.offsetWidth; el.classList.add('mv-flash');
    };

    // ── Меню сообщения ──
    function closeMenu(){ menu.hidden = true; menu.innerHTML = ''; root.querySelector('.mv-m.mv-sel')?.classList.remove('mv-sel'); }
    function openMenu(m, anchor){
      const A = V.A, mine = m.uid ? m.uid === myUid() : m.mine, logged = !!P.me();
      const items = [];
      if (A.caps.react === 'count' && V.canWrite) items.push(`<div class="mv-qr">${(A.reactSet || ['👍', '❤️', '😂', '🔥', '😮', '🎉']).map(x => `<button type="button" data-m="react:${e(x)}">${x}</button>`).join('')}</div>`);
      if (A.caps.react === 'site') items.push(`<button type="button" data-m="reactpick">😊 Реакция</button>`);
      if (A.caps.reply && V.canWrite) items.push('<button type="button" data-m="reply">↩ Ответить</button>');
      if (mine && A.caps.edit && !m.sticker) items.push('<button type="button" data-m="edit">✏️ Изменить</button>');
      if (A.caps.pin && A.canPin?.(m)) items.push(`<button type="button" data-m="pin">${m.pinned ? '📌 Открепить' : '📌 Закрепить'}</button>`);
      if (!m.sticker) items.push('<button type="button" data-m="copy">📋 Скопировать текст</button>');
      if (m.uid || m.nick) items.push('<button type="button" data-m="user">👤 Профиль автора</button>');
      if (A.caps.report && logged && !mine) items.push('<button type="button" data-m="report">🚩 Пожаловаться</button>');
      if (m.uid && logged && !mine) items.push(`<button type="button" data-m="block">${MV.blocked.has(m.uid) ? '✅ Разблокировать' : '🚫 Заблокировать автора'}</button>`);
      const mods = A.modActions?.(m) || [];
      if (mods.length) items.push('<div class="mv-msep">Модерация</div>' + mods.map(([k, t]) => `<button type="button" data-m="mod:${e(k)}" class="warn">${t}</button>`).join(''));
      if ((mine && A.caps.del) || A.canDel?.(m)) items.push('<button type="button" data-m="del" class="bad">🗑 Удалить</button>');
      menu.innerHTML = items.join('');
      menu.hidden = false;
      menu.dataset.id = m.id;
      const el = list.querySelector(`.mv-m[data-id="${CSS.escape(String(m.id))}"]`); el?.classList.add('mv-sel');
      // рядом с кнопкой (компьютер) или снизу листом (телефон, узко)
      const rb = root.getBoundingClientRect();
      if (touch() || rb.width < 520) { menu.className = 'mv-menu mv-sheet'; menu.style.cssText = ''; return; }
      menu.className = 'mv-menu';
      const ab = (anchor || el || list).getBoundingClientRect();
      const w = 230, h = Math.min(menu.scrollHeight, rb.height - 20);
      let top = ab.bottom - rb.top + 4; if (top + h > rb.height - 8) top = Math.max(8, ab.top - rb.top - h - 4);
      menu.style.cssText = `top:${top}px;left:${Math.max(8, Math.min(ab.right - rb.left - w, rb.width - w - 8))}px;max-height:${rb.height - 16}px`;
    }
    async function menuAct(k, m, btn){
      const A = V.A; closeMenu();
      if (k === 'reply') setReply(m);
      else if (k === 'edit') setEdit(m);
      else if (k === 'copy') { try { await navigator.clipboard.writeText(m.text || ''); note('📋 Скопировано', false, 1500); } catch (er) {} }
      else if (k === 'user') V.userCard(m.uid, m.nick, list.querySelector(`.mv-m[data-id="${CSS.escape(String(m.id))}"] .mv-nick`), m);
      else if (k === 'reactpick') { const el = list.querySelector(`.mv-m[data-id="${CSS.escape(String(m.id))}"] [data-a="react"]`) || btn; if (typeof openReactionPicker === 'function') openReactionPicker(m.id, el || root); }
      else if (k.startsWith('react:')) react(m, k.slice(6));
      else if (k === 'pin') { const r = await A.pin(m, !m.pinned); if (r?.ok) { m.pinned = !m.pinned; rerender(m.id); note(m.pinned ? '📌 Закреплено' : 'Откреплено', false, 1600); } else note('⚠️ ' + (r?.err || 'Не получилось')); }
      else if (k === 'del') {
        const ok = await ask('Удалить сообщение?', [['yes', '🗑 Удалить', 'bad']]); if (ok !== 'yes') return;
        const r = await A.del(m);
        if (r?.ok) { m.deleted = true; V.order = V.order.filter(x => x !== m.id); V.msgs.delete(m.id); rerender(m.id); } else note('⚠️ Не удалилось: ' + (r?.err || 'ошибка'));
      }
      else if (k === 'report') reportFlow(m);
      else if (k === 'block') blockFlow(m.uid, m.nick);
      else if (k.startsWith('mod:')) { const r = await A.mod(k.slice(4), m); if (r?.msg) note(r.msg, !r.ok, 2600); if (r?.ok && r.removed) { V.order = V.order.filter(x => x !== m.id); V.msgs.delete(m.id); rerender(m.id); } }
    }
    async function react(m, em){
      const r = await V.A.react(m, em);
      if (!r?.ok) { note('⚠️ ' + (r?.err || 'Реакция не поставилась')); return; }
      m.myReacts = m.myReacts || new Set();
      if (r.on) m.myReacts.add(em); else m.myReacts.delete(em);
      m.reactions = Object.assign({}, m.reactions, { [em]: r.n }); if (!r.n) delete m.reactions[em];
      rerender(m.id);
    }
    async function reportFlow(m){
      const why = await ask(`Пожаловаться на сообщение <b>${e(m.nick)}</b>? Команда посмотрит. 3 жалобы от разных людей — сообщение скроется до проверки.`,
        [['Оскорбления', 'Оскорбления'], ['Спам или реклама', 'Спам'], ['Взрослое или жестокое', '18+ / жесть'], ['Опасно: просит личные данные, встречу', '⚠️ Опасно'], ['Другое', 'Другое']]);
      if (!why) return;
      const r = await V.A.report(m, why);
      note(r?.ok ? (r.hidden ? '🚩 Жалоба принята — сообщение скрыто до проверки' : '🚩 Спасибо, жалоба отправлена') : '⚠️ ' + (r?.err || 'Не отправилось'), !r?.ok, 3000);
      if (r?.hidden) { V.order = V.order.filter(x => x !== m.id); V.msgs.delete(m.id); rerender(m.id); }
    }
    async function blockFlow(uid, nick){
      const on = !MV.blocked.has(uid);
      if (on && await ask(`Заблокировать <b>${e(nick)}</b>? Его сообщения скроются, он не сможет писать тебе в личку, звонить и звать в друзья. Дружба удалится.`, [['yes', '🚫 Заблокировать', 'bad']]) !== 'yes') return;
      const r = await MV.block(uid, on);
      note(r.ok ? (on ? '🚫 Заблокирован' : '✅ Разблокирован') : '⚠️ ' + r.err, !r.ok, 2500);
      if (r.ok) renderAll();
    }
    // Вопрос с кнопками — в телефоне его лист, на странице — своё окошко
    function ask(text, btns){
      if (root.closest('.ph')) return P.ask(text, btns.map(([k, t, cls]) => ({ k, t, cls })));
      return new Promise(res => {
        const b = openOver('<b>Подтверди</b>', `<p class="mv-ask">${text}</p><div class="mv-askb">${btns.map(([k, t, cls]) => `<button type="button" class="mv-gbtn ${cls || ''}" data-askk="${e(k)}">${t}</button>`).join('')}<button type="button" class="mv-gbtn ghost" data-askk="">Отмена</button></div>`);
        b.addEventListener('click', ev => { const x = ev.target.closest('[data-askk]'); if (!x) return; closeOver(); res(x.dataset.askk || null); });
        V.askRes = res;
      });
    }
    V.ask = ask;

    // ── Карточка человека: профиль, друзья, ЛС, звонок, блок, модерация ──
    V.userCard = async (uid, nick, anchor, m) => {
      closeMenu();
      if (isBot(m)) {   // карточка бота: что он делает, без дружбы и жалоб
        openOver('', `<div class="mv-user"><span class="ph-ava mv-botava" style="width:56px;height:56px;font-size:30px">🤖</span><div><b>Денчик-бот</b><span>Бот сайта: пишет в «📢 новости», когда Денчик в эфире и когда выходит новое видео</span></div></div>
          <div class="mv-uacts"><a class="mv-ubtn" href="#/chat/news">📢 Новости</a><a class="mv-ubtn" href="#/chat/events">📅 События</a></div>`);
        over.classList.add('mv-over-user');
        return;
      }
      const p = uid ? (await P.profiles([uid]))[uid] : null;
      const me = P.me(), self = uid && uid === me;
      const acts = [];
      // чем занят сейчас (общее «кто онлайн») и «📍 К нему» — в его сервер мира или комнату игры
      const onl = uid ? window.D37Chat?.online?.()?.users.find(u => u.id === uid) : null;
      const act = onl ? P.actParse(onl.a) : null, join = act ? P.actJoin(act) : null;
      if (uid) acts.push(`<a class="mv-ubtn" href="#/profile/${e(uid)}">👤 Профиль</a>`);
      if (join && !self) acts.push(`<button type="button" class="mv-ubtn" data-u="join">${e(join.label)}</button>`);
      if (uid && me && !self) acts.push('<button type="button" class="mv-ubtn" data-u="friend">…</button>');
      if (uid && me && !self) acts.push(`<button type="button" class="mv-ubtn" data-u="block">${MV.blocked.has(uid) ? '✅ Разблокировать' : '🚫 Заблокировать'}</button>`);
      if (m && V.A.caps.report && me && !self) acts.push('<button type="button" class="mv-ubtn" data-u="report">🚩 Пожаловаться</button>');
      const mods = !self && V.A.userMod ? V.A.userMod(uid, nick) : [];
      const bx = openOver('', `<div class="mv-user">${P.avatar(p, nick, 56)}<div><b>${P.nick(p, nick)}</b><span>${uid ? (p?.role === 'admin' ? 'Администратор сайта' : p?.role === 'moderator' ? 'Модератор сайта' : 'Игрок') : 'Гость (без аккаунта)'}${uid ? `<span class="lv-badge" data-lv-uid="${e(uid)}"></span>` : ''}</span>${onl ? `<span>${e(P.actText(act))}</span>` : ''}</div></div>
        <div class="mv-uacts">${acts.join('')}</div>${mods.length ? `<div class="mv-msep">Модерация</div><div class="mv-uacts">${mods.map(([k, t]) => `<button type="button" class="mv-ubtn warn" data-um="${e(k)}">${t}</button>`).join('')}</div>` : ''}${!me && uid ? '<div class="mv-dim">Войди, чтобы дружить, писать и звонить</div>' : ''}`);
      over.classList.add('mv-over-user');
      if (typeof xpQueueBadges === 'function') xpQueueBadges();
      bx.addEventListener('click', async ev => {
        const b = ev.target.closest('[data-u],[data-um]'); if (!b) return;
        if (b.dataset.um) { const r = await V.A.userModDo(b.dataset.um, uid, nick); if (r?.msg) note(r.msg, !r.ok, 2600); closeOver(); return; }
        const k = b.dataset.u;
        if (k === 'join') { closeOver(); P.goJoin(uid, act); return; }
        if (k === 'friend-add') { if (typeof sendFriendRequest === 'function') sendFriendRequest(uid); b.textContent = '⏳ Заявка отправлена'; b.dataset.u = ''; }
        else if (k === 'friend-acc') { if (typeof acceptFriendRequest === 'function') await acceptFriendRequest(uid); b.textContent = '✅ Теперь друзья'; b.dataset.u = ''; P.dropFriends?.(); }
        else if (k === 'dm') { closeOver(); P.open('msgs/' + uid); }
        else if (k === 'call') { closeOver(); await P.need('calls'); window.D37Calls?.call(uid, nick); }
        else if (k === 'block') { closeOver(); blockFlow(uid, nick); }
        else if (k === 'report' && m) { closeOver(); reportFlow(m); }
      });
      if (uid && me && !self && typeof getFriendshipStatus === 'function') {
        const st = await getFriendshipStatus(uid), b = bx.querySelector('[data-u="…"],[data-u=""]') || bx.querySelector('.mv-ubtn:not([href]):not([data-u="block"]):not([data-u="report"])');
        if (!b) return;
        if (st === 'friends') { b.textContent = '✉ Написать'; b.dataset.u = 'dm'; b.insertAdjacentHTML('afterend', '<button type="button" class="mv-ubtn" data-u="call">📞 Позвонить</button>'); }
        else if (st === 'pending_received') { b.textContent = '✅ Принять в друзья'; b.dataset.u = 'friend-acc'; }
        else if (st === 'pending_sent') { b.textContent = '⏳ Заявка отправлена'; b.dataset.u = ''; }
        else { b.textContent = '➕ В друзья'; b.dataset.u = 'friend-add'; }
      }
    };

    // ── Клики ──
    root.addEventListener('click', ev => {
      const t = ev.target;
      const c = t.closest('[data-c]');
      if (c && root.contains(c)) {
        const k = c.dataset.c;
        if (k === 'send') send();
        else if (k === 'emoji' || k === 'sticker') openPanel(k);
        else if (k === 'noreply') setReply(null);
        else if (k === 'noedit') { setEdit(null); input.value = ''; autosize(); }
        return;
      }
      const ins = t.closest('[data-ins]'); if (ins) { insertAt(ins.dataset.ins); return; }
      const evb = t.closest('[data-evgo]'); if (evb) { evb.disabled = true; MV.evRsvp(+evb.dataset.evgo).then(r => { evb.disabled = false; if (!r.ok && r.err !== 'auth') note('⚠️ ' + r.err); }); return; }
      const stk = t.closest('[data-stk]');
      if (stk) { if (stk.classList.contains('lock')) { location.href = '/vip'; return; } closePanel(); V.A.sendSticker?.(stk.dataset.stk).then(r => { if (r && !r.ok) note('⚠️ ' + (r.err || 'Стикер не отправился')); else if (r?.m) onEvent({ t: 'ins', m: r.m }); }); return; }
      const acb = t.closest('[data-ac]'); if (acb) { acPick(+acb.dataset.ac); return; }
      const go = t.closest('[data-go]'); if (go) { const id = isNaN(+go.dataset.go) ? go.dataset.go : +go.dataset.go; V.jump(id); return; }
      const jm = t.closest('.mv-rq[data-jump]'); if (jm) { const id = isNaN(+jm.dataset.jump) ? jm.dataset.jump : +jm.dataset.jump; V.jump(id); return; }
      const mi = t.closest('[data-m]');
      if (mi && menu.contains(mi)) { const id = menu.dataset.id, m = V.msgs.get(isNaN(+id) ? id : +id); if (m) menuAct(mi.dataset.m, m, mi); return; }
      const a = t.closest('[data-a]');
      if (a && root.contains(a)) {
        const k = a.dataset.a, el = a.closest('.mv-m'), m = el ? V.msgs.get(isNaN(+el.dataset.id) ? el.dataset.id : +el.dataset.id) : null;
        if (k === 'older') older();
        else if (k === 'retry') V.setAdapter(V.A);
        else if (k === 'closeover') { closeOver(); V.askRes?.(null); V.askRes = null; }
        else if (k === 'guest') V.A.guest?.().then(gate);
        else if (k === 'login') { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); }
        else if (k === 'join') V.A.onJoin?.();
        else if (k === 'showblk' && el) { el.querySelector('.mv-blk')?.replaceWith(Object.assign(document.createElement('div'), { className: 'mv-text', innerHTML: MV.rich(m?.text || '', myNick(), { kid: kidView() }).html })); }
        else if (m && k === 'reply') setReply(m);
        else if (m && k === 'react') { if (V.A.caps.react === 'site' && typeof openReactionPicker === 'function') openReactionPicker(m.id, a); else openMenu(m, a); }
        else if (m && k === 'more') openMenu(m, a);
        else if (m && k === 'user') V.userCard(m.uid, m.nick, a, m);
        else if (m && k === 'r') react(m, a.dataset.em);
        return;
      }
      if (t.closest('.mv-ava')) { const el = t.closest('.mv-m'); const m = el && V.msgs.get(isNaN(+el.dataset.id) ? el.dataset.id : +el.dataset.id); if (m) V.userCard(m.uid, m.nick, t, m); return; }
      // телефон: нажатие на сообщение — меню (кроме ссылок и кнопок)
      if (!menu.hidden && !t.closest('.mv-menu')) { closeMenu(); return; }
      const mm = t.closest('.mv-m');
      if (mm && touch() && !t.closest('a,button,.react-badge') && !window.getSelection()?.toString()) { const m = V.msgs.get(isNaN(+mm.dataset.id) ? mm.dataset.id : +mm.dataset.id); if (m) openMenu(m, mm); }
      if (!t.closest('.mv-panel,[data-c="emoji"],[data-c="sticker"]')) closePanel();
    });
    // правый клик по сообщению — меню (как в Дискорде)
    list.addEventListener('contextmenu', ev => {
      const mm = ev.target.closest('.mv-m'); if (!mm || ev.target.closest('a')) return;
      ev.preventDefault();
      const m = V.msgs.get(isNaN(+mm.dataset.id) ? mm.dataset.id : +mm.dataset.id); if (m) openMenu(m, mm);
    });

    // ── Снаружи ──
    V.push = m => { const id = 'sys' + Date.now() + Math.random(); const x = Object.assign({ id, sys: true, at: new Date().toISOString() }, m, { id }); V.msgs.set(id, x); V.order.push(id); appendOne(x); if (nearBottom()) toBottom(); };
    V.addLocal = m => { const id = 'tmp' + Date.now(); const x = Object.assign({ at: new Date().toISOString(), mine: true }, m, { id }); V.msgs.set(id, x); V.order.push(id); appendOne(x); toBottom(); return id; };
    V.focus = () => input.focus();
    V.refreshAll = () => renderAll();
    V.destroy = () => { V.destroyed = true; V.unsub?.(); V.typOff?.(); clearInterval(V.slowT); clearTimeout(V.typT); document.removeEventListener('visibilitychange', onVis); root.innerHTML = ''; root.classList.remove('mv', 'mv-compact'); };
    window.addEventListener('d37:blocks', () => { if (!V.destroyed && V.A) renderAll(); });
    if (opt.adapter) V.setAdapter(opt.adapter);
    return V;
  };

  MV._test = { cardOf: MV.cardOf, rich: MV.rich, sitePath };
})();
