// ═══════════════════════════════════════
//  SUPABASE REALTIME CHAT + AUTH + MOD
// ═══════════════════════════════════════
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

// Фильтр спама — базовые стоп-слова (расширяй по необходимости)
const SPAM_WORDS = ['http://','https://','discord.gg','t.me/joinchat','bit.ly','cutt.ly'];
const MAX_MSG_LEN = 300;
const RATE_LIMIT = 5; // сообщений
const RATE_WINDOW = 60000; // за 60 секунд

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

// ─── AUTH ───
// Единая точка входа/выхода — doGlobalLogin()/doGlobalLogout() ниже.
// (Раньше здесь был второй, независимый логин-модал (#chatAuthModal,
// doLogin/openChatAuth/closeChatAuth) — он никогда не открывался ни из
// одной кнопки и полностью дублировал глобальный вход. Удалён.)


async function onAuthStateChange(user) {
  if (!user) return;
  currentUser = user;
  const { data } = await sbClient.from('profiles').select('*').eq('id', user.id).single();
  if (data) {
    currentProfile = data;
    currentRole = data.role || 'user';
  }
  if (typeof applyThemeAccent === 'function') applyThemeAccent(currentProfile);

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

  // Ник в чате = ник профиля для ЛЮБОГО вошедшего аккаунта (не только
  // admin/moderator) — иначе зарегистрированный обычный пользователь
  // видел бы экран "придумай ник гостя", хотя уже вошёл в аккаунт.
  chatNick = data?.nick || user.email.split('@')[0];
  try { localStorage.setItem('d37_nick', chatNick); } catch(e) {}
  showChatInput();

  if (currentRole === 'admin' || currentRole === 'moderator' || currentRole === 'helper') {
    const roleLabel = currentRole === 'admin' ? '👑 Администратор' : currentRole === 'moderator' ? '🛡 Модератор' : '🧹 Хелпер';
    document.getElementById('modPanelRole').textContent = roleLabel;
    document.getElementById('modPanelNick').textContent = data?.nick || user.email;
    document.getElementById('chatModPanel').style.display = 'flex';
    document.getElementById('chatAuthBtn').style.display = 'none';
    // helper видит только кнопку удаления (см. CSS .is-helper), у
    // admin/moderator — ещё и бан (.is-mod)
    document.getElementById('chatMsgs').classList.add(currentRole === 'helper' ? 'is-helper' : 'is-mod');
    showChatStatus(`${roleLabel} — режим модерации активен`, true);
    if (currentRole === 'helper') {
      document.querySelectorAll('.msg-del-btn').forEach(b=>b.style.display='flex');
    } else {
      document.querySelectorAll('.msg-del-btn,.msg-ban-btn').forEach(b=>b.style.display='flex');
    }
    if (currentRole === 'admin') {
      const editBtn = document.getElementById('pollEditBtn');
      if (editBtn) editBtn.style.display = 'inline-flex';
      document.getElementById('schedEditBtn')?.style.setProperty('display','inline-flex');
      document.getElementById('goalEditBtn')?.style.setProperty('display','inline-flex');
      initDonationAlerts();
    }
  }
}

// ─── BANS ───
async function loadBans() {
  if (!sbClient) return;
  try {
    const { data } = await sbClient.from('banned_nicks').select('nick');
    if (data) data.forEach(r => bannedNicks.add(r.nick.toLowerCase()));
  } catch(e) {}
}

async function banNick(nick, msgEl) {
  if (!sbClient || (currentRole !== 'admin' && currentRole !== 'moderator')) return;
  // Нельзя банить себя
  const myNick = currentProfile?.nick || '';
  if (nick.toLowerCase() === myNick.toLowerCase() || nick.toLowerCase() === chatNick.toLowerCase()) {
    showChatStatus('⚠ Нельзя забанить себя', false);
    setTimeout(()=>document.getElementById('chatStatusBar').style.display='none',2000);
    return;
  }
  // Нельзя банить других модераторов/админов
  if (!confirm(`Забанить «${nick}»? Все его сообщения будут удалены.`)) return;
  try {
    await sbClient.from('banned_nicks').insert([{ nick, banned_by: currentUser.id }]);
    bannedNicks.add(nick.toLowerCase());
    await sbClient.from('messages').update({ deleted: true }).eq('nick', nick);
    document.querySelectorAll('.chat-msg').forEach(el => {
      if (el.dataset.nick === nick) el.classList.add('deleted');
    });
    addMsg('🔨 Система', `«${nick}» заблокирован`, 'var(--accent)', false, false, null, 'system');
  } catch(e) { console.warn('ban error:', e); }
}

async function deleteMsg(id, msgEl) {
  if (!sbClient || !(currentRole === 'admin' || currentRole === 'moderator' || currentRole === 'helper')) return;
  if (!id) { msgEl?.classList.add('deleted'); return; }
  try {
    await sbClient.from('messages').update({ deleted: true }).eq('id', id);
    msgEl.classList.add('deleted');
  } catch(e) {
    console.warn('delete error:', e);
    msgEl?.classList.add('deleted'); // fallback локально
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
  for (const w of SPAM_WORDS) {
    if (text.toLowerCase().includes(w)) return 'Ссылки в чате запрещены';
  }
  // Повтор символов (флуд типа "ааааааааа")
  if (/(.)\1{9,}/.test(text)) return 'Флуд запрещён';
  return null;
}

// ─── MESSAGES ───
async function loadRecentMessages() {
  if (!sbClient) return;
  try {
    const { data } = await sbClient
      .from('messages')
      .select('*')
      .eq('deleted', false)
      .order('created_at', { ascending: true })
      .limit(50);
    if (data && data.length) {
      document.getElementById('chatMsgs').innerHTML = '';
      data.forEach(m => addMsg(m.nick, m.text, m.color || 'var(--tw)', false, true, m.id, m.role, m.user_id, m.vip_tier));
      loadReactionsFor(data.map(m => m.id));
    }
    loadPinnedMessage();
  } catch(e) { console.warn('loadMessages:', e); }
}

// Тост "новое сообщение в чате" — только если пользователь сейчас не на странице чата
let chatToastTimer=null;
const CHAT_TOAST_DEFAULT_HTML = '<span>💬</span><span>Новое сообщение в чате</span>';
function showChatToast(customText){
  if(currentRoute()==='chat') return;
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

function subscribeRealtime() {
  if (!sbClient) return;
  sbChannel = sbClient
    .channel('public:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      const m = payload.new;
      if (m.deleted) return;
      if (bannedNicks.has(m.nick.toLowerCase())) return;
      const isOwn = m.nick === chatNick;
      addMsg(m.nick, m.text, m.color || 'var(--tw)', isOwn, true, m.id, m.role, m.user_id, m.vip_tier);
      if (!isOwn && m.role !== 'reaction') {
        const isMention = chatNick && new RegExp(`@${chatNick.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`, 'i').test(m.text);
        showChatToast(isMention ? `${esc(m.nick)} упомянул(а) тебя в чате` : null);
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
      if (payload.new.deleted) {
        const el = document.querySelector(`[data-msgid="${payload.new.id}"]`);
        if (el) el.classList.add('deleted');
      }
      // Пин/анпин своего или чужого сообщения — обновляем бар у всех
      if (payload.new.id === chatPinnedId || (payload.new.pinned_until && new Date(payload.new.pinned_until) > new Date())) {
        loadPinnedMessage();
      }
    })
    .subscribe();

  onlineChannel = sbClient.channel('online-users', { config: { presence: { key: PRESENCE_KEY } } });
  onlineChannel
    .on('presence', { event: 'sync' }, () => {
      const state = onlineChannel.presenceState();
      document.getElementById('chatOnlineCount').textContent = Object.keys(state).length;
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await onlineChannel.track({ nick: chatNick || 'Гость', ts: Date.now() });
      }
    });
}

async function sendMsgToSupabase(nick, text, color, role, vipTier) {
  if (!sbClient) return false;
  try {
    const { error } = await sbClient.from('messages').insert([{ nick, text, color, role, vip_tier: vipTier || null, user_id: currentUser?.id || null }]);
    return !error;
  } catch(e) { return false; }
}

function showChatStatus(msg, good = true, autoHideMs = 3000) {
  const bar = document.getElementById('chatStatusBar');
  if (!bar) return;
  bar.textContent = msg;
  bar.style.display = 'block';
  bar.style.background = good ? 'rgba(34,197,94,.06)' : 'rgba(255,200,0,.06)';
  bar.style.color = good ? 'rgba(34,197,94,.8)' : 'rgba(255,200,0,.8)';
  bar.style.borderColor = good ? 'rgba(34,197,94,.1)' : 'rgba(255,200,0,.1)';
  // БАГ: раньше бар никогда не прятался сам — "режим модерации активен"
  // (и другие транзитные сообщения) висели до перезагрузки страницы или
  // выхода. Теперь по умолчанию прячется через autoHideMs; для по-настоящему
  // постоянных статусов (демо-режим, ошибка подключения) вызывающий код
  // явно передаёт autoHideMs=0.
  clearTimeout(bar._hideTimer);
  if (autoHideMs) bar._hideTimer = setTimeout(()=>{ bar.style.display='none'; }, autoHideMs);
}

const demoMsgs=[
  {nick:'dan4ik37',text:'Привет всем! Добро пожаловать на сайт 👋',color:'var(--accent)',role:'admin'},
  {nick:'Зритель',text:'Привет! Очень крутой сайт! 🔥',color:'#5bc4ff',role:'user'},
  {nick:'FanDan',text:'Когда следующий стрим? 🎮',color:'var(--tw)',role:'user'},
  {nick:'dan4ik37',text:'Скоро! Следите в Telegram 💪',color:'var(--accent)',role:'admin'},
];

// Общий набор для пикера в сообщениях И в реакциях — раньше было 24 штуки
// только для сообщений, а реакции вообще были на 8 своих. Теперь один
// большой список (~70), оба пикера прокручиваемые.
const EMOJI=[
  '😀','😂','🤣','😍','😎','🥳','😱','😤','🤡','🥺','😭','😡','🤔','🙄','😴','🤗','🫡','😏','🤨','😬',
  '🔥','❤','🧡','💛','💚','💙','💜','🖤','🤍','💯','💝','💔','✨','⚡','💥','⭐','🎉','🎊','🏆','👑',
  '👍','👎','🙌','👏','🤝','✌','🤞','👀','💪','🫶','🖕','🤙','👋','🙏','💀','👻','🤖','👽','🎮','🕹',
  '🍕','🍔','🍿','☕','🍺','🎂','🍩','🍭','⚽','🏀','🎯','🎲','🚀','💎','🔫','⚔','🛡','🎃','😹','🐸',
];

function switchChat(type,btn){
  document.querySelectorAll('.chat-tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('chat-local').style.display='none';
  const twFr=document.getElementById('chat-twitch');
  twFr.classList.remove('active');twFr.style.display='none';

  if(type==='local'){
    document.getElementById('chat-local').style.display='flex';
    document.getElementById('chatSubtitle').textContent='Сайт';
  } else if(type==='twitch'){
    if(!twFr.src){
      const isMob = /Mobi|Android/i.test(navigator.userAgent);
      twFr.src=`https://www.twitch.tv/embed/${TWITCH}/chat?parent=${HOST}${isMob?'':'&darkpopout'}&migration=true`;
    }
    twFr.style.cssText='display:block;width:100%;height:100%;border:none;min-height:320px;flex:1';
    twFr.classList.add('active');
    document.getElementById('chatSubtitle').textContent='Twitch';
  }
}

function showChatInput() {
  document.getElementById('chatNickScreen').style.display = 'none';
  document.getElementById('chatMainInput').style.display  = 'flex';
  document.getElementById('chatNickDisplay').textContent  = chatNick;
  const roleEl = document.getElementById('chatNickRole');
  const isElevated = currentRole === 'admin' || currentRole === 'moderator' || currentRole === 'helper';
  if (roleEl) {
    if (currentRole === 'admin') roleEl.textContent = '👑';
    else if (currentRole === 'moderator') roleEl.textContent = '🛡';
    else if (currentRole === 'helper') roleEl.textContent = '🧹';
    else if (currentUser) roleEl.textContent = '✅';
    else roleEl.textContent = '👤 гость';
  }
  // Admin/модератор выходят только через кнопку в шапке (доGlobalLogout) —
  // локальный "Выйти" тут для них скрыт, чтобы не улетать в гостя со
  // старой ролью в currentRole (баг: "Гость1234 [ADMIN]" в сообщениях).
  const localLogoutBtn = document.getElementById('chatLocalLogoutBtn');
  if (localLogoutBtn) localLogoutBtn.style.display = isElevated ? 'none' : '';
  if (onlineChannel) onlineChannel.track({ nick: chatNick, ts: Date.now() });
}

function initChat(){
  document.getElementById('chat-local').style.display='flex';
  const picker=document.getElementById('emojiPicker');
  EMOJI.forEach(em=>{
    const btn=document.createElement('button');
    btn.textContent=em;
    btn.setAttribute('aria-label', 'Вставить эмодзи ' + em);
    btn.onclick=()=>insertEmoji(em);
    btn.style.cssText='background:none;border:none;font-size:1.2rem;cursor:pointer;padding:.2rem .25rem;border-radius:6px;transition:background .15s';
    btn.onmouseover=()=>btn.style.background='rgba(255,255,255,.1)';
    btn.onmouseout=()=>btn.style.background='none';
    picker.appendChild(btn);
  });
  appendCustomEmojiToComposerPicker();

  // Если ник уже сохранён — сразу показываем поле ввода
  if (chatNick) showChatInput();

  const sbReady = initSupabase();
  if (sbReady) {
    sbClient.auth.getSession().then(({ data }) => {
      if (data?.session?.user) onAuthStateChange(data.session.user);
    });
    // БАГ: customEmoji раньше грузился с задержкой в 2 сек ПОСЛЕ истории
    // сообщений — любое :имя: в уже загруженных сообщениях так и оставалось
    // сырым текстом навсегда (addMsg рендерит один раз, повторно не
    // перерисовывается). Promise.all тут не подошёл бы — он ждёт, пока ВСЕ
    // завершатся, но не гарантирует, что customEmoji закончит раньше, чем
    // loadRecentMessages успеет отрендерить сообщения внутри себя. Поэтому
    // сначала ждём эмодзи (быстрый запрос), потом уже баны+историю параллельно.
    loadCustomEmoji().then(() => Promise.all([loadBans(), loadRecentMessages()])).then(() => {
      subscribeRealtime();
      subscribeReactionsRealtime();
      const msgs = document.getElementById('chatMsgs');
      if (!msgs.children.length) {
        demoMsgs.forEach((m,i)=>setTimeout(()=>addMsg(m.nick,m.text,m.color,false,false,null,m.role),i*400));
      }
      showChatStatus('🟢 Чат подключён');
      setTimeout(()=>{ const b=document.getElementById('chatStatusBar'); if(b) b.style.display='none'; }, 3000);
    }).catch(()=>{
      demoMsgs.forEach((m,i)=>setTimeout(()=>addMsg(m.nick,m.text,m.color,false,false,null,m.role),i*400));
    });
  } else {
    demoMsgs.forEach((m,i)=>setTimeout(()=>addMsg(m.nick,m.text,m.color,false,false,null,m.role),i*400));
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

function chatLogout() {
  // Вход один — через шапку. Админ/модератор не может "выйти из чата" отдельно
  // от сайта: раньше это молча превращало его в Гость#### с ролью currentRole,
  // ещё оставшейся 'admin' — и в чат уходили сообщения вида "Гость1234 [ADMIN]".
  if (currentRole === 'admin' || currentRole === 'moderator' || currentRole === 'helper') {
    showChatStatus('Это выход из чата. Чтобы выйти из аккаунта — кнопка "Выйти" в шапке сайта', false);
    setTimeout(()=>{ const b=document.getElementById('chatStatusBar'); if(b) b.style.display='none'; }, 3500);
    return;
  }
  chatNick = '';
  try { localStorage.removeItem('d37_nick'); } catch(e) {}
  document.getElementById('chatNickScreen').style.display = 'flex';
  document.getElementById('chatMainInput').style.display = 'none';
}

function addMsg(nick, text, color, isOwn, fromDB, msgId, msgRole, userId, vipTier){
  const msgs=document.getElementById('chatMsgs');
  const initials=(nick.replace(/[^a-zA-Zа-яА-Я0-9]/g,'')||'?').substring(0,2).toUpperCase();
  const time=new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  const badge = msgRole==='admin' ? '<span class="role-badge admin">ADMIN</span>'
              : msgRole==='moderator' ? '<span class="role-badge moderator">MOD</span>'
              : msgRole==='helper' ? '<span class="role-badge helper">HELPER</span>' : '';
  // Единый цвет для роли/VIP — те же RGB, что и в профиле (GLOW_RGB/
  // VIP_TIERS из profile.js), чтобы человек выглядел одинаково везде:
  // им подсвечивается бейдж, ник, полоска слева у сообщения и аватарка.
  // Роль важнее VIP — как и везде на сайте.
  const ROLE_RGB_CHAT = { admin: '255,45,85', moderator: '145,71,255', helper: '34,197,94' };
  const roleRgb = msgRole && ROLE_RGB_CHAT[msgRole] ? ROLE_RGB_CHAT[msgRole] : null;
  const vipMeta = !roleRgb && vipTier && typeof VIP_TIERS !== 'undefined' ? VIP_TIERS.find(t => t.key === vipTier) : null;
  const highlightRgb = roleRgb || vipMeta?.rgb || null;
  const vipBadge = (!badge && vipMeta) ? `<span class="role-badge" style="background:rgba(${vipMeta.rgb},.22);color:rgb(${vipMeta.rgb})">${vipMeta.key==='gold'?'✨':vipMeta.key==='silver'?'⭐':'🔸'} ${vipMeta.key.toUpperCase()}</span>` : '';
  const nickColor = highlightRgb ? `rgb(${highlightRgb})` : (color||'var(--accent)');
  const avatarBg = highlightRgb ? `linear-gradient(135deg, rgb(${highlightRgb}), rgba(${highlightRgb},.6))` : (color||'var(--accent)');
  const stripeStyle = highlightRgb ? `border-left:3px solid rgb(${highlightRgb})` : '';
  const div=document.createElement('div');
  const mentionsMe = !isOwn && chatNick && new RegExp(`@${chatNick.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`, 'i').test(text);
  div.className='chat-msg'+(isOwn?' own-msg':'')+(mentionsMe?' mentioned-me':'');
  if(msgId) div.dataset.msgid=msgId;
  div.dataset.nick=nick;
  // Клик по нику/аватарке открывает мини-профиль — только если у автора
  // есть аккаунт (userId не пустой). У гостей аккаунта нет, смотреть нечего.
  const profileClick = userId ? `onclick="openMiniProfile('${userId}','${nick.replace(/'/g,"\\'")}',this)" style="cursor:pointer"` : '';
  const canPin = isOwn && msgId && ((typeof getVipTier === 'function' && currentProfile && getVipTier(currentProfile)) || currentRole === 'admin' || currentRole === 'moderator');
  div.innerHTML=`
    <div class="chat-avatar" style="background:${avatarBg}" ${profileClick}>${initials}</div>
    <div class="chat-bubble-col">
      <div class="chat-bubble">
        <div class="chat-user" style="color:${nickColor}" ${profileClick}>${esc(nick)}${badge}${vipBadge}</div>
        <div class="chat-text" style="${stripeStyle}${stripeStyle?';padding-left:.5rem':''}">${renderMessageText(esc(text))}</div>
        <div class="chat-time">${time}</div>
      </div>
      ${msgId?`<div class="msg-reactions" id="mr-${msgId}"></div>`:''}
    </div>
    ${msgId?`<button class="msg-react-btn" aria-label="Поставить реакцию" onclick="openReactionPicker(${msgId},this)" title="Реакция">😊</button>
    <button class="msg-ban-btn" aria-label="Забанить пользователя" onclick="banNick(this.closest('.chat-msg').dataset.nick,this.closest('.chat-msg'))" title="Забанить">🔨</button>
    <button class="msg-del-btn" aria-label="Удалить сообщение" onclick="deleteMsg(${msgId},this.closest('.chat-msg'))" title="Удалить">✕</button>`:''}
    ${canPin?`<button class="msg-pin-btn" aria-label="Закрепить на 15 минут" onclick="pinMessage(${msgId})" title="Закрепить на 15 минут (VIP)">📌</button>`:''}`;
  msgs.appendChild(div);
  if(msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 100) msgs.scrollTop=msgs.scrollHeight;
}

// ─── ЗАКРЕП СООБЩЕНИЯ (VIP/модерация) ───
// Право проверяется ещё раз на сервере внутри RPC-функции (см.
// chat-pin.sql) — фронтенд лишь не показывает кнопку тем, кому нельзя,
// это не единственная защита.
let chatPinnedId = null;
let chatPinnedUntil = null;
setInterval(() => {
  if (chatPinnedId && chatPinnedUntil && new Date(chatPinnedUntil) <= new Date()) {
    document.getElementById('chatPinBar').style.display = 'none';
    chatPinnedId = null; chatPinnedUntil = null;
  }
}, 20000);
async function pinMessage(msgId){
  if (!sbClient || !msgId) return;
  try {
    const { error } = await sbClient.rpc('pin_own_message', { msg_id: msgId });
    if (error) throw error;
    showChatStatus('📌 Закреплено на 15 минут', true);
  } catch(e) {
    showChatStatus('Не удалось закрепить: ' + (e.message || e), false);
  }
}
async function unpinMessage(msgId){
  if (!sbClient || !msgId) return;
  try {
    const { error } = await sbClient.rpc('unpin_message', { msg_id: msgId });
    if (error) throw error;
  } catch(e) {
    showChatStatus('Не удалось открепить: ' + (e.message || e), false);
  }
}
function renderPinBar(msg){
  const bar = document.getElementById('chatPinBar');
  if (!bar) return;
  const active = msg && msg.pinned_until && new Date(msg.pinned_until) > new Date();
  if (!active) {
    bar.style.display = 'none';
    chatPinnedId = null; chatPinnedUntil = null;
    return;
  }
  chatPinnedId = msg.id;
  chatPinnedUntil = msg.pinned_until;
  document.getElementById('chatPinNick').textContent = msg.nick;
  document.getElementById('chatPinText').textContent = msg.text;
  const canUnpin = currentUser && (currentUser.id === msg.user_id || currentRole === 'admin' || currentRole === 'moderator');
  document.getElementById('chatPinUnpinBtn').style.display = canUnpin ? 'inline-block' : 'none';
  bar.style.display = 'flex';
}
async function loadPinnedMessage(){
  if (!sbClient) return;
  try {
    const { data } = await sbClient
      .from('messages')
      .select('id,nick,text,user_id,pinned_until')
      .not('pinned_until', 'is', null)
      .gt('pinned_until', new Date().toISOString())
      .order('pinned_until', { ascending: false })
      .limit(1)
      .maybeSingle();
    renderPinBar(data);
  } catch(e) { /* тихо — пин-бар не критичен для работы чата */ }
}

async function sendMsg(){
  if(!chatNick){document.getElementById('chatNickScreen').style.display='flex';document.getElementById('chatMainInput').style.display='none';return}
  const inp=document.getElementById('chatInput'),text=inp.value.trim();
  if(!text) return;
  const isStaff = currentRole === 'admin' || currentRole === 'moderator' || currentRole === 'helper';

  // Временный мут — за накопленные подряд нарушения (см. registerStrike).
  // Не применяется к admin/mod, чтобы не мешать модерации.
  if (!isStaff && Date.now() < muteUntil) {
    const secLeft = Math.ceil((muteUntil - Date.now()) / 1000);
    showChatStatus(`🔇 Мут за спам — ещё ${secLeft} сек`, false);
    return;
  }
  // Ban check
  if(bannedNicks.has(chatNick.toLowerCase())){
    showChatStatus('🔨 Ты заблокирован в чате', false);
    return;
  }
  // Rate limit
  if(!checkRateLimit()){
    if (!isStaff) registerStrike();
    showChatStatus(Date.now() < muteUntil
      ? `🔇 Слишком много попыток — мут на ${Math.ceil((muteUntil-Date.now())/1000)} сек`
      : `⏱ Не так быстро — максимум ${RATE_LIMIT} сообщений в минуту`, false);
    return;
  }
  // Spam check
  const spamErr = checkSpam(text);
  if(spamErr){
    if (!isStaff) registerStrike();
    showChatStatus(`🚫 ${spamErr}`, false);
    return;
  }
  // Повтор той же реплики подряд — частый паттерн спама, checkSpam() его не ловит
  if (!isStaff && text.toLowerCase() === lastSentText.toLowerCase()) {
    registerStrike();
    showChatStatus('🚫 Не повторяй одно и то же', false);
    return;
  }

  if (!isStaff) registerGoodMsg();
  lastSentText = text;
  inp.value='';
  const colors=['#9147ff','#29b6f6','#ff6b35','#22c55e','#f59e0b','#ec4899','#5bc4ff'];
  const col = colors[Math.abs(chatNick.split('').reduce((a,c)=>a+c.charCodeAt(0),0)) % colors.length];
  const role = (currentUser && currentRole) ? currentRole : 'guest';
  // Уровень VIP — снимок на момент отправки (как и role выше), чат живёт
  // через realtime-поток, дешевле хранить, чем джойнить profiles на
  // каждое сообщение. См. getVipTier() в profile.js.
  const vipTierKey = (typeof getVipTier === 'function' && currentProfile) ? (getVipTier(currentProfile)?.key || null) : null;

  if (sbClient) {
    const ok = await sendMsgToSupabase(chatNick, text, col, role, vipTierKey);
    if (!ok) addMsg(chatNick, text, col, true, false, null, role, currentUser?.id, vipTierKey);
  } else {
    addMsg(chatNick, text, col, true, false, null, role, currentUser?.id, vipTierKey);
  }
}

function insertEmoji(em){
  const inp=document.getElementById('chatInput');
  inp.value+=em;inp.focus();
  document.getElementById('emojiPicker').style.display='none';
}
function toggleEmoji(e){
  e.stopPropagation();
  const picker=document.getElementById('emojiPicker');
  picker.style.display=picker.style.display==='flex'?'none':'flex';
}
document.addEventListener('click',(e)=>{
  const p=document.getElementById('emojiPicker');if(p)p.style.display='none';
  if(!e.target.closest('#chatMentionAutocomplete,#chatInput')) closeMentionAutocomplete();
});

// ═══════════════════════════════════════
//  АВТОДОПОЛНЕНИЕ @УПОМИНАНИЙ
// ═══════════════════════════════════════
let mentionDebounce = null;
let mentionActiveIndex = 0;
let mentionCurrentMatches = [];

function getMentionQueryAtCursor(){
  const inp = document.getElementById('chatInput');
  const pos = inp.selectionStart;
  const before = inp.value.slice(0, pos);
  const m = before.match(/(?:^|\s)@([a-zA-Zа-яА-Я0-9_]{1,24})$/);
  return m ? { query: m[1], start: pos - m[1].length } : null;
}

function handleMentionInput(){
  clearTimeout(mentionDebounce);
  const ctx = getMentionQueryAtCursor();
  if (!ctx) { closeMentionAutocomplete(); return; }
  mentionDebounce = setTimeout(() => searchMentionCandidates(ctx.query), 200);
}

async function searchMentionCandidates(query){
  const box = document.getElementById('chatMentionAutocomplete');
  if (!sbClient) { closeMentionAutocomplete(); return; }
  try {
    const { data } = await sbClient.from('profiles').select('nick').ilike('nick', `${query}%`).not('nick','is',null).limit(6);
    mentionCurrentMatches = (data || []).map(r => r.nick).filter(Boolean);
    mentionActiveIndex = 0;
    if (!mentionCurrentMatches.length) { closeMentionAutocomplete(); return; }
    box.innerHTML = mentionCurrentMatches.map((nick, i) => `
      <div class="chat-mention-option${i===0?' active':''}" data-nick="${esc(nick)}" onclick="selectMention('${nick.replace(/'/g,"\\'")}')"
           style="padding:.5rem .8rem;cursor:pointer;font-size:.82rem;${i===0?'background:rgba(145,71,255,.15)':''}">@${esc(nick)}</div>
    `).join('');
    box.style.cssText = 'display:block;position:absolute;bottom:100%;left:0;right:0;background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:.3rem;box-shadow:0 -8px 24px rgba(0,0,0,.4);z-index:20';
  } catch(e) { closeMentionAutocomplete(); }
}

function closeMentionAutocomplete(){
  const box = document.getElementById('chatMentionAutocomplete');
  box.style.display = 'none';
  box.innerHTML = '';
  mentionCurrentMatches = [];
}

function selectMention(nick){
  const inp = document.getElementById('chatInput');
  const ctx = getMentionQueryAtCursor();
  if (ctx) {
    inp.value = inp.value.slice(0, ctx.start) + nick + ' ' + inp.value.slice(inp.selectionStart);
  } else {
    inp.value += nick + ' ';
  }
  closeMentionAutocomplete();
  inp.focus();
}

function handleChatInputKeydown(event){
  if (mentionCurrentMatches.length && document.getElementById('chatMentionAutocomplete').style.display === 'block') {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      mentionActiveIndex = (mentionActiveIndex + 1) % mentionCurrentMatches.length;
      updateMentionActiveOption();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      mentionActiveIndex = (mentionActiveIndex - 1 + mentionCurrentMatches.length) % mentionCurrentMatches.length;
      updateMentionActiveOption();
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      selectMention(mentionCurrentMatches[mentionActiveIndex]);
      return;
    }
    if (event.key === 'Escape') {
      closeMentionAutocomplete();
      return;
    }
  }
  if (event.key === 'Enter') sendMsg();
}

function updateMentionActiveOption(){
  document.querySelectorAll('#chatMentionAutocomplete .chat-mention-option').forEach((el, i) => {
    el.style.background = i === mentionActiveIndex ? 'rgba(145,71,255,.15)' : '';
  });
}



// ═══════════════════════════════════════
//  ПОИСК ПО ЧАТУ
//  Ищет по ВСЕЙ истории в БД, а не только по тому, что сейчас
//  прогружено на экране (в DOM держится лишь последние ~50 сообщений).
//  Результаты — отдельным списком (ник, отрывок, время), не пытаемся
//  прокручивать к сообщению в живой ленте — оно там может и не быть
//  загружено, а перестройка ленты ради этого только всё усложнит.
// ═══════════════════════════════════════
let chatSearchDebounce = null;

function toggleChatSearch(){
  const bar = document.getElementById('chatSearchBar');
  const opening = bar.style.display === 'none';
  bar.style.display = opening ? 'block' : 'none';
  if (opening) {
    document.getElementById('chatSearchInput').focus();
  } else {
    document.getElementById('chatSearchInput').value = '';
    document.getElementById('chatSearchResults').innerHTML = '';
  }
}

function debouncedChatSearch(){
  clearTimeout(chatSearchDebounce);
  chatSearchDebounce = setTimeout(searchChatMessages, 350);
}

async function searchChatMessages(){
  const q = document.getElementById('chatSearchInput').value.trim();
  const resultsEl = document.getElementById('chatSearchResults');
  if (!q) { resultsEl.innerHTML = ''; return; }
  if (!sbClient) { resultsEl.innerHTML = '<div style="color:var(--muted);font-size:.78rem;text-align:center;padding:.5rem">Поиск недоступен offline</div>'; return; }

  resultsEl.innerHTML = '<div style="color:var(--muted);font-size:.78rem;text-align:center;padding:.5rem">Ищем...</div>';
  try {
    const { data, error } = await sbClient
      .from('messages')
      .select('id, nick, text, color, role, created_at')
      .eq('deleted', false)
      .or(`text.ilike.%${q}%,nick.ilike.%${q}%`)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;

    if (!data || !data.length) {
      resultsEl.innerHTML = '<div style="color:var(--muted);font-size:.78rem;text-align:center;padding:.5rem">Ничего не нашли</div>';
      return;
    }
    // Подсветка совпадения — экранируем текст ДО подсветки, чтобы не
    // открыть XSS через regex-замену уже безопасной строки.
    const reQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const highlight = s => esc(s).replace(new RegExp(reQ, 'gi'), m => `<mark style="background:rgba(145,71,255,.35);color:inherit;border-radius:3px;padding:0 .15rem">${m}</mark>`);

    resultsEl.innerHTML = data.map(m => `
      <div style="background:rgba(255,255,255,.03);border-radius:8px;padding:.5rem .7rem">
        <div style="display:flex;justify-content:space-between;font-size:.68rem;color:var(--muted)">
          <span style="color:${m.color||'var(--tw)'};font-weight:700">${highlight(m.nick)}</span>
          <span>${new Date(m.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
        </div>
        <div style="font-size:.8rem;margin-top:.25rem;word-break:break-word">${highlight(m.text)}</div>
      </div>`).join('');
  } catch(e) {
    resultsEl.innerHTML = `<div style="color:var(--accent);font-size:.78rem;text-align:center;padding:.5rem">Ошибка поиска: ${esc(e.message||String(e))}</div>`;
  }
}


