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
        openGlobalAuth();
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
      data.forEach(m => addMsg(m.nick, m.text, m.color || 'var(--tw)', false, true, m.id, m.role, m.user_id));
      loadReactionsFor(data.map(m => m.id));
    }
  } catch(e) { console.warn('loadMessages:', e); }
}

// Тост "новое сообщение в чате" — только если пользователь сейчас не на странице чата
let chatToastTimer=null;
function showChatToast(){
  if(currentRoute()==='chat') return;
  const t=document.getElementById('chatToast');
  if(t){
    t.classList.add('show');
    clearTimeout(chatToastTimer);
    chatToastTimer=setTimeout(()=>t.classList.remove('show'),4000);
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
      addMsg(m.nick, m.text, m.color || 'var(--tw)', isOwn, true, m.id, m.role, m.user_id);
      if (!isOwn && m.role !== 'reaction') showChatToast();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
      if (payload.new.deleted) {
        const el = document.querySelector(`[data-msgid="${payload.new.id}"]`);
        if (el) el.classList.add('deleted');
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

async function sendMsgToSupabase(nick, text, color, role) {
  if (!sbClient) return false;
  try {
    const { error } = await sbClient.from('messages').insert([{ nick, text, color, role, user_id: currentUser?.id || null }]);
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

function addMsg(nick, text, color, isOwn, fromDB, msgId, msgRole, userId){
  const msgs=document.getElementById('chatMsgs');
  const initials=(nick.replace(/[^a-zA-Zа-яА-Я0-9]/g,'')||'?').substring(0,2).toUpperCase();
  const time=new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  const badge = msgRole==='admin' ? '<span class="role-badge admin">ADMIN</span>'
              : msgRole==='moderator' ? '<span class="role-badge moderator">MOD</span>'
              : msgRole==='helper' ? '<span class="role-badge helper">HELPER</span>' : '';
  const div=document.createElement('div');
  div.className='chat-msg'+(isOwn?' own-msg':'');
  if(msgId) div.dataset.msgid=msgId;
  div.dataset.nick=nick;
  // Клик по нику/аватарке открывает мини-профиль — только если у автора
  // есть аккаунт (userId не пустой). У гостей аккаунта нет, смотреть нечего.
  const profileClick = userId ? `onclick="openMiniProfile('${userId}','${nick.replace(/'/g,"\\'")}',this)" style="cursor:pointer"` : '';
  div.innerHTML=`
    <div class="chat-avatar" style="background:${color||'var(--accent)'}" ${profileClick}>${initials}</div>
    <div class="chat-bubble-col">
      <div class="chat-bubble">
        <div class="chat-user" style="color:${color||'var(--accent)'}" ${profileClick}>${esc(nick)}${badge}</div>
        <div class="chat-text">${renderMessageText(esc(text))}</div>
        <div class="chat-time">${time}</div>
      </div>
      ${msgId?`<div class="msg-reactions" id="mr-${msgId}"></div>`:''}
    </div>
    ${msgId?`<button class="msg-react-btn" aria-label="Поставить реакцию" onclick="openReactionPicker(${msgId},this)" title="Реакция">😊</button>
    <button class="msg-ban-btn" aria-label="Забанить пользователя" onclick="banNick(this.closest('.chat-msg').dataset.nick,this.closest('.chat-msg'))" title="Забанить">🔨</button>
    <button class="msg-del-btn" aria-label="Удалить сообщение" onclick="deleteMsg(${msgId},this.closest('.chat-msg'))" title="Удалить">✕</button>`:''}`;
  msgs.appendChild(div);
  if(msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 100) msgs.scrollTop=msgs.scrollHeight;
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

  if (sbClient) {
    const ok = await sendMsgToSupabase(chatNick, text, col, role);
    if (!ok) addMsg(chatNick, text, col, true, false, null, role);
  } else {
    addMsg(chatNick, text, col, true, false, null, role);
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
document.addEventListener('click',()=>{const p=document.getElementById('emojiPicker');if(p)p.style.display='none'});

