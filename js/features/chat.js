// ═══════════════════════════════════════
//  SUPABASE REALTIME CHAT + AUTH + MOD
// ═══════════════════════════════════════
// Общий чат сайта = официальный сервер «Денчик37» в разделе #/chat (как Дискорд: серверы слева, каналы, участники справа).
// Канал #общий — та же таблица messages, что и раньше (старые вкладки пишут туда же); #игры, #поиск-тиммейтов, #мемы и
// голосовой — после community.sql (колонки channel / reply_to / edited_at, таблица chat_channels). Пока он не выполнен —
// только #общий, без ответов и правки (как было). Сама лента и поле ввода — общий компонент MsgView (msgview.js), раскладка
// «как Дискорд» и сообщества — community.js (оба грузятся при первом заходе в чат или в телефон).
// Здесь: вход/роль, баны, анти-спам, «кто онлайн» (presence: ник, а у вошедших — id, роль, VIP; невидимку — без id),
// живая лента (одна подписка на messages — и для тоста «новое сообщение» на других страницах), адаптер канала для MsgView.
const SB_URL = 'https://zdisuowyjgqirhvcyjfq.supabase.co';
const SB_KEY = 'sb_publishable_55GhvJbDxDQA1JEawZRQ6g_ozx_cgMV';

let sbClient = null, sbChannel = null, onlineChannel = null;
let currentUser = null, currentRole = null, currentProfile = null;
let bannedNicks = new Set();
let msgTimestamps = []; // rate limit
let lastSentText = ''; // для детекта повтора одного и того же сообщения подряд
// Эскалация наказания за спам: N нарушений подряд -> временный локальный мут
// с растущей длительностью. Переживает перезагрузку страницы (localStorage),
// иначе спамер просто обновлял бы вкладку и сбрасывал счётчик.
let rateStrikes = parseInt(localStorage.getItem('d37_strikes') || '0', 10) || 0;
let muteUntil = parseInt(localStorage.getItem('d37_mute_until') || '0', 10) || 0;
function saveStrikeState(){
  try { localStorage.setItem('d37_strikes', String(rateStrikes)); localStorage.setItem('d37_mute_until', String(muteUntil)); } catch(e) {}
}
function registerStrike(){
  rateStrikes++;
  if (rateStrikes >= 3) {
    const muteMin = Math.min(30 * Math.pow(2, rateStrikes - 3), 300); // 30с → 60с → 120с → ... максимум 5 мин
    muteUntil = Date.now() + muteMin * 1000;
  }
  saveStrikeState();
}
function registerGoodMsg(){
  rateStrikes = Math.max(0, rateStrikes - 1);
  saveStrikeState();
}
const PRESENCE_KEY = 'user_' + Math.random().toString(36).slice(2,8);

// Фильтр спама — базовые стоп-слова (расширяй по необходимости). Ссылки на сам сайт можно (из них — карточки игр и видео)
const SPAM_WORDS = ['http://','https://','discord.gg','t.me/joinchat','bit.ly','cutt.ly'];
const MAX_MSG_LEN = 300;
const RATE_LIMIT = 5; // сообщений
const RATE_WINDOW = 60000; // за 60 секунд
const isChatStaff = () => currentRole === 'admin' || currentRole === 'moderator' || currentRole === 'helper';

function initSupabase() {
  try {
    if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
      console.warn('Supabase SDK не загружен');
      showChatStatus('💡 Чат работает локально', false, 0);
      return false;
    }
    sbClient = supabase.createClient(SB_URL, SB_KEY);
    // Ссылка "забыл пароль" из письма возвращает человека на сайт с
    // токеном восстановления в URL — Supabase SDK сам его парсит
    // (detectSessionInUrl включён по умолчанию) и шлёт это событие.
    // Открываем форму "новый пароль" вместо обычного логина.
    sbClient.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        openLoginModal();
        switchAuthTab('reset');
      }
    });
    return true;
  } catch(e) {
    console.warn('Supabase init error:', e);
    showChatStatus('⚠ Ошибка подключения к чату', false, 0);
    return false;
  }
}

// Чтение профилей — через представление profiles_public (privacy.sql): оно само
// прячет закрытые поля (о себе, игры, сумма донатов, логин DA...) по настройкам
// приватности. Пока privacy.sql не выполнен, представления нет — читаем таблицу.
// Использование: (await sbProfiles()).select(...)
let PROFILES_SRC = null;
let profilesSrcCheck = null;
function profilesSource(){
  if (PROFILES_SRC) return Promise.resolve(PROFILES_SRC);
  if (!profilesSrcCheck) {
    profilesSrcCheck = sbClient.from('profiles_public').select('id').limit(1)
      .then(({ error }) => (PROFILES_SRC = error ? 'profiles' : 'profiles_public'),
            () => (PROFILES_SRC = 'profiles'));
  }
  return profilesSrcCheck;
}
async function sbProfiles(){ return sbClient.from(await profilesSource()); }
const privacyAvailable = () => PROFILES_SRC === 'profiles_public';

// ─── AUTH ───
// Единая точка входа/выхода — doGlobalLogin()/doGlobalLogout() (global-auth.js).

// Запасной ник, если в профиле ника нет. НЕ из email: раньше тут было
// user.email.split('@')[0] — и начало почты светилось всем в чате и в шапке.
function fallbackNick(user){
  return 'user_' + String(user?.id || '').replace(/-/g, '').slice(0, 6);
}

async function onAuthStateChange(user) {
  if (!user) return;
  currentUser = user;
  document.body.classList.add('is-authed');
  const { data } = await (await sbProfiles()).select('*').eq('id', user.id).single();
  if (data) {
    currentProfile = data;
    currentRole = data.role || 'user';
  }
  // Для страниц, открытых до входа (идеи и т.п.) — роль уже известна
  window.dispatchEvent(new Event('d37:auth'));
  // Вернулись со входа через Google (global-auth.js → signInWithProvider) — открыть свой профиль, как после обычного входа
  try { const go = localStorage.getItem('d37_after_login'); if (go && user) { localStorage.removeItem('d37_after_login'); setTimeout(() => { location.hash = go; }, 300); } } catch (e) {}
  if (typeof applyThemeAccent === 'function') applyThemeAccent(currentProfile);
  if (typeof recordTodayVisit === 'function') recordTodayVisit();

  if (typeof subscribeDmRealtime === 'function') subscribeDmRealtime();
  if (typeof updateDmUnreadBadge === 'function') updateDmUnreadBadge();

  // Ник, который человек ввёл при регистрации, но который не успел
  // попасть в профиль, если Supabase потребовал подтверждение email
  // (сессии на момент signUp ещё не было, см. doGlobalRegister()).
  // Применяем один раз при первом реальном входе и забываем.
  try {
    const pendingNick = localStorage.getItem('d37_pending_nick');
    if (pendingNick && currentProfile && currentProfile.nick !== pendingNick) {
      await sbClient.from('profiles').update({ nick: pendingNick }).eq('id', user.id);
      currentProfile.nick = pendingNick;
    }
    localStorage.removeItem('d37_pending_nick');
  } catch(e) {}

  // Обновляем глобальную кнопку
  updateGlobalAuthBtn();

  // Ник в чате = ник профиля для ЛЮБОГО вошедшего аккаунта
  chatNick = data?.nick || fallbackNick(user);
  try { localStorage.setItem('d37_nick', chatNick); } catch(e) {}
  showChatInput();
  chatInfo(true);

  if (isChatStaff()) {
    const roleLabel = currentRole === 'admin' ? '👑 Администратор' : currentRole === 'moderator' ? '🛡 Модератор' : '🧹 Хелпер';
    const mr = document.getElementById('modPanelRole'); if (mr) mr.textContent = roleLabel;
    const mn = document.getElementById('modPanelNick'); if (mn) mn.textContent = data?.nick || fallbackNick(user);
    document.getElementById('chatMsgs')?.classList.add(currentRole === 'helper' ? 'is-helper' : 'is-mod');
    showChatStatus(`${roleLabel} — режим модерации активен`, true);
    if (currentRole === 'admin') {
      const editBtn = document.getElementById('pollEditBtn');
      if (editBtn) editBtn.style.display = 'inline-flex';
      document.getElementById('schedEditBtn')?.style.setProperty('display','inline-flex');
      document.getElementById('goalEditBtn')?.style.setProperty('display','inline-flex');
      initDonationAlerts();
    }
  }
}
// Выход (global-auth.js шлёт d37:auth) — у ленты пересчитать «можно ли писать»
window.addEventListener('d37:auth', () => { if (!currentUser) { OFF.info = OFF.info ? Object.assign({}, OFF.info, { staff: null, muted_until: null }) : null; } chatRefresh(); trackOnline(); });

// ─── BANS ───
async function loadBans() {
  if (!sbClient) return;
  try {
    const { data } = await sbClient.from('banned_nicks').select('nick');
    if (data) data.forEach(r => bannedNicks.add(r.nick.toLowerCase()));
  } catch(e) {}
}

// Бан по нику (как раньше): сообщения убираются у всех. → { ok, msg }
async function banNickOfficial(nick) {
  if (!sbClient || (currentRole !== 'admin' && currentRole !== 'moderator')) return { ok: false, msg: 'Банить могут админ и модераторы' };
  const myNick = currentProfile?.nick || '';
  if (nick.toLowerCase() === myNick.toLowerCase() || nick.toLowerCase() === (chatNick || '').toLowerCase()) return { ok: false, msg: '⚠ Нельзя забанить себя' };
  try {
    await sbOk(sbClient.from('banned_nicks').insert([{ nick, banned_by: currentUser.id }]));
    bannedNicks.add(nick.toLowerCase());
    await sbOk(sbClient.from('messages').update({ deleted: true }).eq('nick', nick));
    chatPushSys(`🔨 «${nick}» заблокирован`);
    return { ok: true, msg: `🔨 «${nick}» заблокирован — его сообщения удалены` };
  } catch(e) { console.warn('ban error:', e); return { ok: false, msg: '⚠ Бан не прошёл: ' + humanErr(e) }; }
}
async function banNick(nick) {
  if (!confirm(`Забанить «${nick}»? Все его сообщения будут удалены.`)) return;
  const r = await banNickOfficial(nick);
  showChatStatus(r.msg, r.ok, 5000);
}

async function deleteMsg(id) {
  if (!sbClient || !isChatStaff() || !id) return { ok: false, err: 'нет прав' };
  try {
    await sbOk(sbClient.from('messages').update({ deleted: true }).eq('id', id));
    return { ok: true };
  } catch(e) {
    console.warn('delete error:', e);
    return { ok: false, err: humanErr(e) };
  }
}

// ─── RATE LIMIT & SPAM ───
function checkRateLimit() {
  const now = Date.now();
  msgTimestamps = msgTimestamps.filter(t => now - t < RATE_WINDOW);
  if (msgTimestamps.length >= RATE_LIMIT) return false;
  msgTimestamps.push(now);
  return true;
}

function checkSpam(text) {
  if (text.length > MAX_MSG_LEN) return `Сообщение слишком длинное (макс. ${MAX_MSG_LEN} символов)`;
  const rest = text.replace(/https?:\/\/dan4ik37\.vercel\.app\S*/gi, '');   // ссылки на сам сайт — можно
  for (const w of SPAM_WORDS) {
    if (rest.toLowerCase().includes(w)) return 'Ссылки в чате запрещены (кроме ссылок на этот сайт)';
  }
  // Повтор символов (флуд типа "ааааааааа")
  if (/(.)\1{9,}/.test(text)) return 'Флуд запрещён';
  return null;
}

// Тост "новое сообщение в чате" — только если пользователь сейчас не на странице чата
let chatToastTimer=null;
const CHAT_TOAST_DEFAULT_HTML = '<span>💬</span><span>Новое сообщение в чате</span>';
function showChatToast(customText){
  if(currentRoute()==='chat') return;
  // Возраст (js/core/age.js): чат не по возрасту (12+) — не зовём туда тостом и значком
  if(window.D37Age && !D37Age.canOpen(D37Age.area('chat')?.age || 0)) return;
  const t=document.getElementById('chatToast');
  if(t){
    t.innerHTML = customText ? `<span>✨</span><span>${customText}</span>` : CHAT_TOAST_DEFAULT_HTML;
    t.classList.add('show');
    clearTimeout(chatToastTimer);
    chatToastTimer=setTimeout(()=>{t.classList.remove('show'); t.innerHTML=CHAT_TOAST_DEFAULT_HTML;},customText?6000:4000);
  }
  // Бейдж, в отличие от тоста, не гаснет сам — висит, пока не зайдёшь в чат
  document.getElementById('navChatBadge')?.classList.add('show');
  document.getElementById('btChatBadge')?.classList.add('show');
}
function hideChatBadge(){
  document.getElementById('navChatBadge')?.classList.remove('show');
  document.getElementById('btChatBadge')?.classList.remove('show');
}

// ═══════════════════════════════════════
//  СЕРВЕР «ДЕНЧИК37»: каналы общего чата и адаптер для MsgView
// ═══════════════════════════════════════
const OFF = {
  info: null,            // chat_info() — каналы, мой мут, роль в команде; null — community.sql ещё не выполнен
  infoP: null,
  channels: [{ id: 'general', name: 'общий', kind: 'text', slow: 0, mods_only: false, about: 'Общий чат сайта' }],
  lastId: {},            // канал → последний известный id сообщения
  mentions: {},          // канал → сколько раз меня упомянули, пока не смотрел
  subs: new Map(),       // канал → Set(функций ленты)
  authors: new Map(),    // id → { id, nick, role, vip, at } — кто писал (для «не в сети»)
};
const TWITCH_CH = { id: 'twitch', name: 'twitch-чат', kind: 'twitch', about: 'Чат трансляции на Twitch' };
function chatInfo(fresh){
  if (!sbClient) return Promise.resolve(null);
  if (OFF.infoP && !fresh) return OFF.infoP;
  OFF.infoP = sbClient.rpc('chat_info').then(({ data, error }) => {
    if (error || !data?.channels) { OFF.info = null; return null; }
    OFF.info = data;
    OFF.channels = data.channels.filter(c => c.kind === 'text' || c.kind === 'voice');
    if (!OFF.channels.some(c => c.id === 'general')) OFF.channels.unshift({ id: 'general', name: 'общий', kind: 'text', slow: 0, mods_only: false });
    window.dispatchEvent(new Event('d37:chatinfo'));
    chatRefresh();
    return data;
  }, () => null);
  return OFF.infoP;
}
const chatHasNew = () => !!OFF.info;   // каналы, ответы, правка, жалобы — после community.sql
function offChannels(){ return [...OFF.channels, TWITCH_CH]; }
// Последние id каналов — для точек «есть новое» в списке каналов (по одному запросу на канал)
async function chatLastIds(){
  if (!sbClient || !chatHasNew()) return OFF.lastId;
  await Promise.all(OFF.channels.filter(c => c.kind === 'text').map(async c => {
    let qy = sbClient.from('messages').select('id').eq('deleted', false).order('id', { ascending: false }).limit(1);
    qy = c.id === 'general' ? qy.is('channel', null) : qy.eq('channel', c.id);
    try { const { data } = await qy; if (data?.[0]) OFF.lastId[c.id] = Math.max(OFF.lastId[c.id] || 0, data[0].id); } catch (e) {}
  }));
  return OFF.lastId;
}
// Строка messages → сообщение ленты
function offMsg(r){
  return { id: r.id, uid: r.user_id || null, nick: r.nick || 'гость', text: r.text || '', at: r.created_at || new Date().toISOString(),
    reply: r.reply_to || null, edited: r.edited_at || null, deleted: !!r.deleted, sticker: !!r.is_sticker, role: r.role, vip: r.vip_tier || null,
    color: r.color, pinned: !!(r.pinned_until && Date.parse(r.pinned_until) > Date.now()), pinnedUntil: r.pinned_until || null, pinnedBy: r.user_id, ch: r.channel || 'general' };
}
function rememberAuthor(m){
  if (!m.uid || m.role === 'guest') return;
  const a = OFF.authors.get(m.uid);
  if (!a || a.at < m.at) OFF.authors.set(m.uid, { id: m.uid, nick: m.nick, role: m.role, vip: m.vip, at: m.at });
}
function chanQuery(q, chId){
  if (!chatHasNew()) return q;
  return chId === 'general' ? q.is('channel', null) : q.eq('channel', chId);
}
const DEMO_MSGS = [
  { nick: 'dan4ik37', text: 'Привет всем! Добро пожаловать на сайт 👋', role: 'admin' },
  { nick: 'Зритель', text: 'Привет! Очень крутой сайт! 🔥', role: 'user' },
  { nick: 'FanDan', text: 'Когда следующий стрим? 🎮', role: 'user' },
  { nick: 'dan4ik37', text: 'Скоро! Следите в Telegram 💪', role: 'admin' },
];
// Адаптер канала сервера «Денчик37» для MsgView (msgview.js)
function chatAdapter(chId){
  const ch = OFF.channels.find(c => c.id === chId) || OFF.channels[0];
  const id = ch.id, staffRole = () => OFF.info?.staff || (isChatStaff() ? currentRole : null);
  const mine = m => m.uid ? m.uid === currentUser?.id : (!currentUser && m.nick === chatNick);
  const A = {
    key: 'o:' + id, title: '#' + ch.name, maxLen: MAX_MSG_LEN, official: true, ch,
    placeholder: `Написать в #${ch.name}`,
    startText: id === 'general' ? 'Это начало общего чата сайта dan4ik37 👋' : `Это начало канала #${ch.name}. ${ch.about || ''}`,
    emptyText: 'Пока тихо — напиши первым! 👋',
    pinsEmpty: 'Закреплённых сообщений нет. VIP и команда сайта могут закреплять свои сообщения (кнопка «⋯» → 📌)',
    get caps(){ const nw = chatHasNew(); return { reply: nw, edit: nw && !!currentUser, del: nw && !!currentUser, react: 'site', pin: true, report: nw && !!currentUser, typing: true, search: true, stickers: true }; },
    async load({ before }){
      if (!sbClient) return { list: DEMO_MSGS.map((m, i) => ({ id: 'demo' + i, uid: null, nick: m.nick, text: m.text, role: m.role, at: new Date().toISOString() })), more: false };
      let qy = chanQuery(sbClient.from('messages').select('*').eq('deleted', false), id).order('id', { ascending: false }).limit(50);
      if (before) qy = qy.lt('id', before);
      const { data, error } = await qy;
      if (error) return { list: [], err: error, errText: humanErr(error) };
      const list = (data || []).filter(r => !bannedNicks.has(String(r.nick || '').toLowerCase())).map(offMsg).reverse();
      list.forEach(rememberAuthor);
      if (list.length) OFF.lastId[id] = Math.max(OFF.lastId[id] || 0, list[list.length - 1].id);
      return { list, more: (data || []).length === 50 };
    },
    sub(fn){
      if (!OFF.subs.has(id)) OFF.subs.set(id, new Set());
      OFF.subs.get(id).add(fn);
      return () => OFF.subs.get(id)?.delete(fn);
    },
    send: (text, reply) => sendOfficial(id, text, reply),
    sendSticker: emoji => sendStickerOfficial(id, emoji),
    async edit(m, text){
      const err = checkSpam(text); if (err) return { ok: false, err };
      const { data, error } = await sbClient.rpc('chat_edit', { p_id: m.id, p_text: text });
      return error ? { ok: false, err: humanErr(error) } : data?.ok ? { ok: true } : { ok: false, err: data?.reason === 'old' ? 'изменять можно 48 часов' : 'не получилось' };
    },
    async del(m){
      if (mine(m) && currentUser && chatHasNew()) {
        const { data, error } = await sbClient.rpc('chat_delete_own', { p_id: m.id });
        return error ? { ok: false, err: humanErr(error) } : { ok: !!data?.ok, err: 'не получилось' };
      }
      return deleteMsg(m.id);
    },
    canDel: m => !!staffRole() && !mine(m),
    react: async () => ({ ok: true }),   // реакции общего чата — reactions.js (message_reactions)
    canPin: m => (mine(m) && !!currentUser && typeof getPinPerks === 'function' && !!getPinPerks(currentRole, currentProfile)) || (m.pinned && (currentRole === 'admin' || currentRole === 'moderator')),
    async pin(m, on){
      const { error } = await sbClient.rpc(on ? 'pin_own_message' : 'unpin_message', { msg_id: m.id });
      if (error) return { ok: false, err: humanErr(error) };
      loadPinnedMessage();
      return { ok: true };
    },
    async report(m, why){
      const { data, error } = await sbClient.rpc('chat_report', { p_id: m.id, p_reason: why });
      if (error) return { ok: false, err: humanErr(error) };
      return data?.ok ? { ok: true, hidden: data.hidden } : { ok: false, err: { rate: 'слишком много жалоб — попробуй позже', self: 'на себя нельзя' }[data?.reason] || 'не получилось' };
    },
    async fetch(ids){
      const { data } = await sbClient.from('messages').select('*').in('id', ids.filter(x => typeof x === 'number'));
      return (data || []).map(offMsg);
    },
    async search(q){
      const s = q.replace(/[%_,()]/g, ' ').trim(); if (!s) return [];
      const { data } = await chanQuery(sbClient.from('messages').select('*').eq('deleted', false), id).or(`text.ilike.%${s}%,nick.ilike.%${s}%`).order('id', { ascending: false }).limit(40);
      return (data || []).map(offMsg);
    },
    async pins(){
      const { data } = await chanQuery(sbClient.from('messages').select('*').eq('deleted', false), id).gt('pinned_until', new Date().toISOString()).order('pinned_until', { ascending: false }).limit(20);
      return (data || []).map(offMsg);
    },
    typing: chatTyping(id),
    async members(q){
      const { data } = await sbClient.from('profiles').select('id, nick').ilike('nick', `${q.replace(/[%_]/g, '')}%`).not('nick', 'is', null).limit(7);
      return data || [];
    },
    state(){
      if (!sbClient) return { mode: 'readonly', note: 'Нет связи с сервером — чат только для чтения' };
      if (!chatNick) return { mode: 'guest' };
      if (bannedNicks.has(chatNick.toLowerCase())) return { mode: 'muted', note: '🔨 Ты заблокирован в чате' };
      const until = OFF.info?.muted_until;
      if (until && Date.parse(until) > Date.now() && !isChatStaff()) return { mode: 'muted', note: `🔇 Тебя заглушили до ${new Date(until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` };
      if (ch.mods_only && !isChatStaff()) return { mode: 'readonly', note: '📢 Здесь пишут только админ и модераторы' };
      return { mode: 'write', slow: !isChatStaff() && ch.slow ? ch.slow : 0 };
    },
    guest: async () => { enterAsGuest(); },
    me: () => ({ uid: currentUser?.id || null, nick: chatNick, staff: !!staffRole() }),
    roleOf: () => null,
    modActions(m){
      const r = staffRole(); if (!r || mine(m)) return [];
      const out = [];
      if (chatHasNew() && (m.uid || m.nick)) out.push(['mute10', '🔇 Мут 10 мин'], ['mute60', '🔇 Мут 1 час']);
      if (chatHasNew() && r !== 'helper') out.push(['mute1440', '🔇 Мут 1 день']);
      if (r === 'admin' || r === 'moderator') out.push(['ban', '🔨 Бан (по нику, навсегда)']);
      return out;
    },
    mod: (k, m) => chatMod(k, m.uid, m.nick),
    userMod(uid){ return this.modActions({ uid, nick: '' }).filter(([k]) => k !== 'ban' || true); },
    userModDo: (k, uid, nick) => chatMod(k, uid, nick),
  };
  return A;
}
async function chatMod(k, uid, nick){
  if (k.startsWith('mute')) {
    const min = +k.slice(4);
    const { data, error } = await sbClient.rpc('chat_mute', { p_user: uid || null, p_nick: uid ? null : nick, p_minutes: min, p_reason: '' });
    if (error) return { ok: false, msg: '⚠ ' + humanErr(error) };
    return data?.ok ? { ok: true, msg: `🔇 ${nick || 'игрок'} заглушён на ${min >= 1440 ? min / 1440 + ' дн' : min >= 60 ? min / 60 + ' ч' : min + ' мин'}` } : { ok: false, msg: '⚠ ' + ({ rights: 'команду сайта глушит только админ', minutes: 'хелпер — не больше часа', staff: 'нет прав' }[data?.reason] || 'не получилось') };
  }
  if (k === 'ban') {
    if (!nick) { const p = uid ? (await (await sbProfiles()).select('nick').eq('id', uid).maybeSingle()).data : null; nick = p?.nick || ''; }
    if (!nick || !confirm(`Забанить «${nick}»? Все его сообщения будут удалены.`)) return { ok: false };
    const r = await banNickOfficial(nick);
    return { ok: r.ok, msg: r.msg, removed: r.ok };
  }
  return { ok: false };
}

// «Печатает…»: свой маленький канал на каждый канал чата (подписка — только пока канал открыт), не чаще раза в 3 с
const chatTypingChans = new Map();
function chatTyping(chId){
  return {
    send(){ const t = chatTypingChans.get(chId); if (t?.ready && chatNick) t.chan.send({ type: 'broadcast', event: 't', payload: { u: currentUser?.id || null, n: String(chatNick).slice(0, 24) } }).catch(() => {}); },
    on(fn){
      if (!sbClient) return () => {};
      let t = chatTypingChans.get(chId);
      if (!t) {
        t = { fns: new Set(), ready: false };
        t.chan = sbClient.channel('typing-o-' + chId, { config: { broadcast: { self: false } } })
          .on('broadcast', { event: 't' }, ({ payload }) => { if (payload && typeof payload.n === 'string' && !bannedNicks.has(payload.n.toLowerCase())) t.fns.forEach(f => f({ uid: typeof payload.u === 'string' ? payload.u : null, nick: payload.n.slice(0, 24) })); })
          .subscribe(s => { t.ready = s === 'SUBSCRIBED'; });
        chatTypingChans.set(chId, t);
      }
      t.fns.add(fn);
      return () => { t.fns.delete(fn); if (!t.fns.size) { try { sbClient.removeChannel(t.chan); } catch (e) {} chatTypingChans.delete(chId); } };
    },
  };
}

// Отправить в канал сервера «Денчик37» (анти-спам, мут, бан — как раньше) → { ok, err }
async function sendOfficial(chId, text, reply){
  if (!chatNick) return { ok: false, err: 'сначала войди — гостем или в аккаунт' };
  const isStaff = isChatStaff();
  // Временный мут — за накопленные подряд нарушения (см. registerStrike). Не применяется к команде.
  if (!isStaff && Date.now() < muteUntil) return { ok: false, err: `🔇 мут за спам — ещё ${Math.ceil((muteUntil - Date.now()) / 1000)} сек` };
  if (bannedNicks.has(chatNick.toLowerCase())) return { ok: false, err: '🔨 ты заблокирован в чате' };
  if (!checkRateLimit()) {
    if (!isStaff) registerStrike();
    return { ok: false, err: Date.now() < muteUntil ? `🔇 слишком много попыток — мут на ${Math.ceil((muteUntil - Date.now()) / 1000)} сек` : `⏱ не так быстро — максимум ${RATE_LIMIT} сообщений в минуту` };
  }
  const spamErr = checkSpam(text);
  if (spamErr) { if (!isStaff) registerStrike(); return { ok: false, err: '🚫 ' + spamErr }; }
  // Повтор той же реплики подряд — частый паттерн спама
  if (!isStaff && text.toLowerCase() === lastSentText.toLowerCase()) { registerStrike(); return { ok: false, err: '🚫 не повторяй одно и то же' }; }
  if (!isStaff) registerGoodMsg();
  const prevSent = lastSentText;
  lastSentText = text;
  const row = chatRow(text);
  if (chatHasNew()) { if (chId !== 'general') row.channel = chId; if (reply && typeof reply === 'number') row.reply_to = reply; }
  const err = await sendMsgToSupabase(row);
  if (err) { lastSentText = prevSent; return { ok: false, err }; }
  return { ok: true };
}
const CHAT_COLORS = ['#9147ff','#29b6f6','#ff6b35','#22c55e','#f59e0b','#ec4899','#5bc4ff'];
function chatRow(text, extra){
  const col = CHAT_COLORS[Math.abs(chatNick.split('').reduce((a,c)=>a+c.charCodeAt(0),0)) % CHAT_COLORS.length];
  const role = (currentUser && currentRole) ? currentRole : 'guest';
  // Уровень VIP — снимок на момент отправки (сервер всё равно пересчитает, vip-balance.sql)
  const vipTierKey = (typeof getVipTier === 'function' && currentProfile) ? (getVipTier(currentProfile)?.key || null) : null;
  return Object.assign({ nick: chatNick, text, color: col, role, vip_tier: vipTierKey, user_id: currentUser?.id || null }, extra || {});
}
// Возвращает null, если сообщение принято, иначе — текст ошибки для человека
async function sendMsgToSupabase(row) {
  if (!sbClient) return chatSendError(null);
  try {
    const { error } = await sbClient.from('messages').insert([row]);
    return error ? chatSendError(error) : null;
  } catch(e) { return chatSendError(e); }
}
// Ошибки сервера про флуд/длину/стикеры/мут уже по-русски (server-hardening.sql, vip-balance.sql, community.sql) — их показываем как есть
function chatSendError(err){
  const m = String(err?.message || err || '');
  if (!navigator.onLine || !sbClient || /fetch|network|timeout|load failed/i.test(m)) return 'нет связи с сервером — проверь интернет';
  if (/[а-яё]/i.test(m)) return m;
  if (/row-level security|permission denied|42501/i.test(m)) return 'нет прав писать в чат (бан или нужно войти заново)';
  return 'сервер не принял сообщение — попробуй ещё раз';
}

function showChatStatus(msg, good = true, autoHideMs = 3000) {
  const bar = document.getElementById('chatStatusBar');
  if (!bar) return;
  bar.textContent = msg;
  bar.style.display = 'block';
  bar.style.background = good ? 'rgba(34,197,94,.06)' : 'rgba(255,200,0,.06)';
  bar.style.color = good ? 'rgba(34,197,94,.8)' : 'rgba(255,200,0,.8)';
  bar.style.borderColor = good ? 'rgba(34,197,94,.1)' : 'rgba(255,200,0,.1)';
  // По умолчанию прячется через autoHideMs; постоянные статусы (нет связи) — autoHideMs=0.
  clearTimeout(bar._hideTimer);
  if (autoHideMs) bar._hideTimer = setTimeout(()=>{ bar.style.display='none'; }, autoHideMs);
}

// ─── Живая лента: одна подписка на messages на весь сайт ───
function subscribeRealtime() {
  if (!sbClient || sbChannel) return;
  sbChannel = sbClient
    .channel('public:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      const r = payload.new;
      if (!r || r.deleted) return;
      if (bannedNicks.has(String(r.nick || '').toLowerCase())) return;
      const m = offMsg(r), ch = chatHasNew() ? m.ch : 'general';
      OFF.lastId[ch] = Math.max(OFF.lastId[ch] || 0, m.id);
      rememberAuthor(m);
      OFF.subs.get(ch)?.forEach(fn => { try { fn({ t: 'ins', m }); } catch (e) { console.error(e); } });
      const isOwn = currentUser ? m.uid === currentUser.id : m.nick === chatNick;
      const viewing = window.D37Chat.viewing === 'o:' + ch && !document.hidden && currentRoute() === 'chat';
      if (!isOwn && m.role !== 'reaction') {
        const isMention = chatNick && new RegExp(`@${chatNick.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\p{L}0-9_])`, 'iu').test(m.text);
        if (isMention && !viewing) OFF.mentions[ch] = (OFF.mentions[ch] || 0) + 1;
        const chName = OFF.channels.find(c => c.id === ch)?.name || ch;
        showChatToast(isMention ? `${esc(m.nick)} упомянул(а) тебя${ch !== 'general' ? ' в #' + esc(chName) : ' в чате'}` : (ch !== 'general' ? `Новое в #${esc(chName)}` : null));
      }
      window.dispatchEvent(new CustomEvent('d37:chatmsg', { detail: m }));
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
      const m = offMsg(payload.new), ch = chatHasNew() ? m.ch : 'general';
      OFF.subs.get(ch)?.forEach(fn => { try { fn({ t: 'upd', m }); } catch (e) { console.error(e); } });
      // Пин/анпин своего или чужого сообщения — обновляем полоску у всех
      if (payload.new.id === chatPinnedId || (payload.new.pinned_until && new Date(payload.new.pinned_until) > new Date())) loadPinnedMessage();
    })
    .subscribe();
  subscribeOnline();
}

// ─── «Кто онлайн»: ник; у вошедших — id, роль, VIP (список участников); невидимка — только ник ───
// Чем занят (мир и сервер, игра и комната — для «📍 К другу», phone.js) — только у профилей «видят все» (privacy.sql)
function onlineMeta(){
  const meta = { nick: chatNick || 'Гость', ts: Date.now() };
  if (currentUser && !currentProfile?.privacy_invisible) {
    meta.u = currentUser.id;
    if (currentRole && currentRole !== 'user') meta.r = currentRole;
    const t = typeof getVipTier === 'function' && currentProfile ? getVipTier(currentProfile) : null;
    if (t) meta.v = t.key;
    if ((currentProfile?.profile_visibility || 'all') === 'all' && window.D37Phone?.activity) {
      const a = window.D37Phone.actCode(window.D37Phone.activity());
      if (a) meta.a = a.slice(0, 160);
    }
  }
  return meta;
}
// Обновить своё «кто онлайн»: каждое обновление получают все на сайте (сообщения Supabase — квота) — поэтому не чаще раза
// в 15 с (и лимит presence 5 за 30 с) и только если что-то поменялось (гость перешёл в другой раздел — никому не шлём)
let onlineTrackT = 0, onlineTrackAt = 0, onlineSig = '';
const onlineMetaSig = m => JSON.stringify(Object.assign({}, m, { ts: 0 }));
function trackOnline(){
  if (!onlineChannel) return;
  clearTimeout(onlineTrackT);
  const wait = Math.max(400, 15000 - (Date.now() - onlineTrackAt));
  onlineTrackT = setTimeout(() => {
    const m = onlineMeta(), sig = onlineMetaSig(m);
    if (sig === onlineSig) return;
    onlineSig = sig; onlineTrackAt = Date.now(); onlineChannel?.track(m).catch(() => {});
  }, wait);
}
function subscribeOnline(){
  if (!sbClient || onlineChannel) return;
  onlineChannel = sbClient.channel('online-users', { config: { presence: { key: PRESENCE_KEY } } });
  let syncT = 0;
  onlineChannel
    .on('presence', { event: 'sync' }, () => {
      const state = onlineChannel.presenceState();
      const online = Object.keys(state).length;
      const cnt = document.getElementById('chatOnlineCount'); if (cnt) cnt.textContent = online;
      window.__d37Online = online;
      window.dispatchEvent(new CustomEvent('d37:online', { detail: online }));   // «Сейчас на сайте» на главной (games.js)
      clearTimeout(syncT); syncT = setTimeout(() => window.dispatchEvent(new Event('d37:presence')), 300);
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') { const m = onlineMeta(); onlineSig = onlineMetaSig(m); onlineTrackAt = Date.now(); await onlineChannel.track(m); }
    });
}
// Онлайн сейчас: вошедшие (по id, без повторов) и сколько гостей
function chatOnline(){
  const st = onlineChannel?.presenceState?.() || {};
  const users = new Map(); let guests = 0;
  for (const metas of Object.values(st)) {
    const m = (metas || [])[metas.length - 1]; if (!m) continue;
    if (typeof m.u === 'string' && /^[0-9a-f-]{36}$/.test(m.u)) { if (!users.has(m.u)) users.set(m.u, { id: m.u, nick: String(m.nick || 'игрок').slice(0, 24), role: ['admin', 'moderator', 'helper'].includes(m.r) ? m.r : null, vip: ['gold', 'silver', 'bronze'].includes(m.v) ? m.v : null, a: typeof m.a === 'string' ? m.a.slice(0, 200) : '' }); }
    else guests++;
  }
  return { users: [...users.values()], guests, total: Object.keys(st).length };
}
// Кто писал недавно (для «не в сети») — один запрос за визит
let chatAuthorsLoaded = false;
async function chatRecentAuthors(){
  if (!chatAuthorsLoaded && sbClient) {
    chatAuthorsLoaded = true;
    try {
      const { data } = await sbClient.from('messages').select('user_id, nick, role, vip_tier, created_at').not('user_id', 'is', null).eq('deleted', false).order('id', { ascending: false }).limit(200);
      (data || []).forEach(r => rememberAuthor({ uid: r.user_id, nick: r.nick, role: r.role, vip: r.vip_tier, at: r.created_at }));
    } catch (e) {}
  }
  return [...OFF.authors.values()].sort((a, b) => (b.at > a.at ? 1 : -1));
}

const EMOJI=[
  '😀','😂','🤣','😍','😎','🥳','😱','😤','🤡','🥺','😭','😡','🤔','🙄','😴','🤗','🫡','😏','🤨','😬',
  '🔥','❤','🧡','💛','💚','💙','💜','🖤','🤍','💯','💝','💔','✨','⚡','💥','⭐','🎉','🎊','🏆','👑',
  '👍','👎','🙌','👏','🤝','✌','🤞','👀','💪','🫶','🖕','🤙','👋','🙏','💀','👻','🤖','👽','🎮','🕹',
  '🍕','🍔','🍿','☕','🍺','🎂','🍩','🍭','⚽','🏀','🎯','🎲','🚀','💎','🔫','⚔','🛡','🎃','😹','🐸',
];

// Вкладка «Twitch» — теперь канал «twitch-чат» сервера «Денчик37» (community.js); функция осталась для старых ссылок
function switchChat(type){
  if (type === 'twitch') location.hash = '#/chat/twitch';
  else location.hash = '#/chat/general';
}
// Чат Twitch (грузится один раз: по dataset.loaded, не по iframe.src — у пустого iframe src = адрес страницы)
function loadTwitchChat(frame){
  if (!frame || frame.dataset.loaded) return;
  // darkpopout — тёмная тема, как у сайта (на телефоне тоже работает)
  frame.src = `https://www.twitch.tv/embed/${TWITCH}/chat?parent=${HOST}&darkpopout&migration=true`;
  frame.dataset.loaded = '1';
}

// ── Чат на весь экран (кнопка ⛶): удобно держать телефон рядом во время стрима ──
// Экран не гаснет (Wake Lock API, где поддерживается), Esc или ✕ — выйти.
let chatWakeLock = null;
async function toggleChatFull(force){
  const on = typeof force === 'boolean' ? force : !document.body.classList.contains('chat-full');
  if (on && !/^#\/chat/.test(location.hash)) location.hash = '#/chat';
  document.body.classList.toggle('chat-full', on);
  document.querySelectorAll('#chatFullBtn,.ds-full').forEach(btn => { btn.textContent = on ? '✕' : '⛶'; btn.title = on ? 'Выйти из полноэкранного чата' : 'Чат на весь экран (экран не будет гаснуть)'; btn.setAttribute('aria-label', btn.title); });
  try {
    if (on && 'wakeLock' in navigator) chatWakeLock = await navigator.wakeLock.request('screen');
    else if (!on && chatWakeLock) { await chatWakeLock.release(); chatWakeLock = null; }
  } catch (e) { chatWakeLock = null; }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('chat-full') && !window.D37Phone?.isOpen?.()) toggleChatFull(false); });
// Ушли из чата — выйти из полноэкранного режима; вернулись на вкладку — снова не гасить экран
window.addEventListener('hashchange', () => { if (!/^#\/chat/.test(location.hash) && document.body.classList.contains('chat-full')) toggleChatFull(false); });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && document.body.classList.contains('chat-full') && 'wakeLock' in navigator) {
    try { chatWakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  }
});

// Ник выбран (гость или вход) — поле ввода и «кто онлайн» обновить
function showChatInput() {
  const d = document.getElementById('chatNickDisplay'); if (d) d.textContent = chatNick;
  trackOnline();
  chatRefresh();
}
// Ленты MsgView пересчитывают «можно ли писать» (гость / вошёл / мут) — и шапка сервера
function chatRefresh(){ window.dispatchEvent(new Event('d37:chatstate')); }
function chatPushSys(text){ window.dispatchEvent(new CustomEvent('d37:chatsys', { detail: text })); }

function initChat(){
  const sbReady = initSupabase();
  if (sbReady) {
    sbClient.auth.getSession().then(({ data }) => {
      if (data?.session?.user) onAuthStateChange(data.session.user);
    });
    // Эмодзи сайта и баны — сразу; сама лента грузится, только когда открыли чат (раньше 50 сообщений + реакции
    // грузились на каждой странице). Подписка на новые сообщения — сразу: тост «новое сообщение» на других страницах.
    loadCustomEmoji().then(() => Promise.all([loadBans(), chatInfo()])).then(() => {
      subscribeRealtime();
      subscribeReactionsRealtime();
      loadPinnedMessage();
    }).catch(() => subscribeRealtime());
  }
}

// ─── ЧАТ: ВХОД ───
function enterAsGuest() {
  // Генерируем случайный гостевой ник
  const saved = localStorage.getItem('d37_nick');
  if (saved) {
    chatNick = saved;
  } else {
    chatNick = 'Гость' + Math.floor(Math.random() * 9000 + 1000);
    try { localStorage.setItem('d37_nick', chatNick); } catch(e) {}
  }
  if (bannedNicks.has(chatNick.toLowerCase())) {
    chatNick = 'Гость' + Math.floor(Math.random() * 9000 + 1000);
    try { localStorage.setItem('d37_nick', chatNick); } catch(e) {}
  }
  showChatInput();
}
// Гостю — «войти гостем» (реакции и пр. зовут это вместо старого экрана ника)
function chatAskNick(){ if (!chatNick) enterAsGuest(); }

function chatLogout() {
  // Вход один — через шапку. Админ/модератор не может "выйти из чата" отдельно от сайта.
  if (isChatStaff()) {
    showChatStatus('Это выход из чата. Чтобы выйти из аккаунта — кнопка "Выйти" в шапке сайта', false, 3500);
    return;
  }
  chatNick = '';
  try { localStorage.removeItem('d37_nick'); } catch(e) {}
  chatRefresh();
}

// Старый способ добавить строчку в чат (системные сообщения) — теперь строчка в открытой ленте общего чата
function addMsg(nick, text){ chatPushSys(`${nick}: ${text}`); }

// ─── ЗАКРЕП СООБЩЕНИЯ (VIP/модерация) ───
// Право проверяется ещё раз на сервере внутри RPC-функции (chat-pin.sql) — фронтенд лишь не показывает кнопку тем, кому нельзя.
let chatPinnedId = null;
let chatPinnedUntil = null;
setInterval(() => {
  if (chatPinnedId && chatPinnedUntil && new Date(chatPinnedUntil) <= new Date()) {
    renderPinBar(null);
  }
}, 20000);
async function pinMessage(msgId){
  if (!sbClient || !msgId) return;
  try {
    const { error } = await sbClient.rpc('pin_own_message', { msg_id: msgId });
    if (error) throw error;
    const perks = (typeof getPinPerks === 'function') ? getPinPerks(currentRole, currentProfile) : null;
    showChatStatus('📌 Закреплено' + (perks ? ' на ' + perks.minutes + ' мин' : ''), true);
  } catch(e) {
    showChatStatus('Не удалось закрепить: ' + humanErr(e), false);
  }
}
async function unpinMessage(msgId){
  if (!sbClient || !msgId) return;
  try {
    const { error } = await sbClient.rpc('unpin_message', { msg_id: msgId });
    if (error) throw error;
  } catch(e) {
    showChatStatus('Не удалось открепить: ' + humanErr(e), false);
  }
}
let chatPinned = null;
function renderPinBar(msg){
  const active = msg && msg.pinned_until && new Date(msg.pinned_until) > new Date();
  chatPinned = active ? msg : null;
  chatPinnedId = active ? msg.id : null;
  chatPinnedUntil = active ? msg.pinned_until : null;
  window.dispatchEvent(new Event('d37:chatpin'));
}
async function loadPinnedMessage(){
  if (!sbClient) return;
  try {
    const { data } = await sbClient
      .from('messages')
      .select('*')
      .not('pinned_until', 'is', null)
      .gt('pinned_until', new Date().toISOString())
      .order('pinned_until', { ascending: false })
      .limit(1)
      .maybeSingle();
    renderPinBar(data);
  } catch(e) { /* тихо — полоска закрепа не критична для работы чата */ }
}

// ═══════════════════════════════════════
//  СТИКЕРЫ (VIP/стафф) — см. chat-stickers.sql
// ═══════════════════════════════════════
// Обычные emoji-реакции есть у всех, стикеры — крупные, на всё сообщение. Не-VIP видит набор, но клик ведёт на /vip.
// Наборы открываются с уровнем VIP (VIP_TIERS[].stickerSets в profile.js). Сервер проверяет «стикер может слать VIP/стафф».
const STICKER_SETS = {
  base:   ['🔥','💯','😂','😭','🎉','👑','💀','🤝','🎮','❤️','😎','🍿','🫡','🥶','👀','⚡'],
  silver: ['🌟','🚀','😈','🤯','🥳','💎','🧠','🫶'],
  gold:   ['🏆','🦄','☄️','🐉','🪩','🎯','💫','🔱'],
};
async function sendStickerOfficial(chId, emoji){
  if (!chatNick) return { ok: false, err: 'сначала войди — гостем или в аккаунт' };
  if (!sbClient) return { ok: false, err: 'нет связи с сервером' };
  const row = chatRow(emoji, { is_sticker: true });
  if (chatHasNew() && chId !== 'general') row.channel = chId;
  try {
    const { error } = await sbClient.from('messages').insert([row]);
    if (error) throw error;
    return { ok: true };
  } catch(e) {
    // Сервер (vip-balance.sql) отказал: стикеры — только VIP/стафф
    if (/VIP|стикер/i.test(e?.message || '')) return { ok: false, err: '🔒 Стикеры — только для VIP и команды сайта' };
    return { ok: false, err: humanErr(e) };
  }
}
// Старые имена (ссылки из старой разметки, custom-emoji.js) — вставка в открытое поле ввода
function insertEmoji(em){ window.D37Chat?.view?.insert?.(em); }
function sendSticker(emoji){ return sendStickerOfficial('general', emoji); }

// Страница #/chat: раскладка «как Дискорд» (community.js + msgview.js — грузятся при первом заходе)
async function renderChatPage(param){
  const host = document.getElementById('dsHost'); if (!host) return;
  if (!window.D37DS?.page) {
    if (!host.firstElementChild) host.innerHTML = '<div class="mv-load"><i></i>Загружаем чат…</div>';
    try { await window.D37Phone.need('ds'); }
    catch (e) { host.innerHTML = '<div class="mv-empty">😵 Чат не загрузился — проверь интернет и обнови страницу<br><button type="button" class="mv-retry" onclick="renderChatPage(currentRouteParam())">Ещё раз</button></div>'; return; }
  }
  if (currentRoute() !== 'chat') return;
  window.D37DS.page(host, param);
}

// Старые имена из прежней разметки чата (страница могла остаться в кэше браузера) — безопасные заглушки
function sendMsg(){ window.D37Chat?.view?.focus?.(); }
function toggleChatSearch(){ window.D37Chat?.view?.search?.(); }
function toggleEmoji(e){ e?.stopPropagation?.(); }
function toggleStickerPicker(e){ e?.stopPropagation?.(); }
function handleMentionInput(){}
function handleChatInputKeydown(){}
function debouncedChatSearch(){}

// Для раскладки «как Дискорд» (community.js) и телефона
window.D37Chat = {
  viewing: '',                     // открытый канал ('o:general', 'c:12'…) — чтобы не звать тостом
  view: null,                      // открытая лента (MsgView) на странице чата
  info: () => OFF.info, channels: offChannels, lastIds: chatLastIds, lastId: ch => OFF.lastId[ch] || 0,
  mentions: OFF.mentions, adapter: chatAdapter, online: chatOnline, recentAuthors: chatRecentAuthors,
  pinned: () => chatPinned, loadTwitch: loadTwitchChat, refreshInfo: chatInfo, hasNew: chatHasNew,
  setSlow: async (ch, sec, modsOnly) => { const { data, error } = await sbClient.rpc('chat_channel_set', { p_id: ch, p_slow: sec, p_mods_only: modsOnly }); if (!error && data?.ok) await chatInfo(true); return error ? { ok: false, err: humanErr(error) } : data; },
  reports: async () => { const { data, error } = await sbClient.rpc('chat_reports_list'); return error ? null : data; },
  resolve: async (id, act) => { const { data, error } = await sbClient.rpc('chat_report_resolve', { p_id: id, p_action: act }); return error ? { ok: false, err: humanErr(error) } : data; },
  _test: { checkSpam, offMsg, onlineMeta },
};
