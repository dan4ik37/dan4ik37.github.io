// ═══════════════════════════════════════
//  РЕАКЦИИ НА СООБЩЕНИЯ (как в Discord)
//  Раньше реакция была общей на весь чат и уходила отдельным "сообщением"
//  в ленту — засоряло чат и не было понятно, на что именно реагируют.
//  Теперь реакция привязана к конкретному сообщению (таблица
//  message_reactions в Supabase), показывается бейджиком под ним с
//  счётчиком, повторный клик по своей же реакции снимает её.
//
//  КАСТОМНЫЕ ЭМОДЗИ: элемент реакции — { id, char } для обычных эмодзи
//  или { id, img: 'https://...' } для кастомных (картинкой, грузит админ
//  через "⚙️ Настройки сайта", см. customEmoji/uploadCustomEmoji ниже).
//  emojiValue() даёт "значение" реакции для хранения в базе и сравнения —
//  символ для обычных, ':shortcode:' для кастомных — а renderEmoji()
//  рендерит любой из них одинаково что в пикере, что в бейдже, что в тексте
//  сообщения (см. renderMessageText).
function buildReactionSet(){
  return [
    ...EMOJI.map(ch => ({ id: ch, char: ch })),
    ...customEmoji.map(e => ({ id: e.name, img: e.image_url })),
  ];
}
function emojiValue(e){ return e.img ? `:${e.id}:` : e.char; }
function renderEmoji(e){
  return e.img ? `<img src="${esc(e.img)}" alt=":${esc(e.id)}:" title=":${esc(e.id)}:" class="custom-emoji-img">` : e.char;
}
function findEmojiDef(value){
  return buildReactionSet().find(e => emojiValue(e) === value) || {char:value};
}

let messageReactions = {}; // { msgId: { emoji: Set(nick) } }
let reactionsChannel = null;
let reactPickerTargetMsg = null;

function addReactionToState(msgId, emoji, nick){
  if (!messageReactions[msgId]) messageReactions[msgId] = {};
  if (!messageReactions[msgId][emoji]) messageReactions[msgId][emoji] = new Set();
  messageReactions[msgId][emoji].add(nick);
}
function removeReactionFromState(msgId, emoji, nick){
  messageReactions[msgId]?.[emoji]?.delete(nick);
}

function renderReactionsFor(msgId){
  const el = document.getElementById(`mr-${msgId}`);
  if (!el) return;
  const byEmoji = messageReactions[msgId] || {};
  const entries = Object.entries(byEmoji).filter(([,nicks]) => nicks.size > 0);
  el.innerHTML = entries.map(([emoji,nicks]) => {
    const mine = chatNick && nicks.has(chatNick);
    const def = findEmojiDef(emoji);
    return `<button class="react-badge${mine?' mine':''}" data-emoji-value="${esc(emoji)}" onclick="toggleReaction(${msgId},this.dataset.emojiValue)" aria-label="Реакция ${esc(def.id||emoji)}, ${nicks.size}${mine?', твоя':''}">${renderEmoji(def)}<span>${nicks.size}</span></button>`;
  }).join('');
}

async function loadReactionsFor(msgIds){
  if (!sbClient || !msgIds.length) return;
  try {
    const { data } = await sbClient.from('message_reactions').select('*').in('message_id', msgIds);
    (data||[]).forEach(r => addReactionToState(r.message_id, r.emoji, r.nick));
    msgIds.forEach(id => renderReactionsFor(id));
  } catch(e) {}
}

async function toggleReaction(msgId, emoji){
  if (!chatNick) { document.getElementById('chatNickScreen').style.display='flex'; document.getElementById('chatMainInput').style.display='none'; closeReactionPicker(); return; }
  const already = !!messageReactions[msgId]?.[emoji]?.has(chatNick);
  // Оптимистично — не ждём ответа сервера, чтобы не было задержки на клик
  if (already) removeReactionFromState(msgId, emoji, chatNick);
  else addReactionToState(msgId, emoji, chatNick);
  renderReactionsFor(msgId);
  closeReactionPicker();
  try {
    if (already) await sbClient.from('message_reactions').delete().match({ message_id: msgId, emoji, nick: chatNick });
    else await sbClient.from('message_reactions').insert({ message_id: msgId, emoji, nick: chatNick });
  } catch(e) {
    // не получилось сохранить на сервере — откатываем локально
    if (already) addReactionToState(msgId, emoji, chatNick); else removeReactionFromState(msgId, emoji, chatNick);
    renderReactionsFor(msgId);
  }
}

function buildReactionPicker(){
  let picker = document.getElementById('reactPickerPop');
  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'reactPickerPop';
    picker.className = 'react-picker-pop';
    picker.setAttribute('role','menu');
    picker.setAttribute('aria-label','Выбор реакции');
    document.body.appendChild(picker);
  }
  // Перестраиваем содержимое каждый раз — иначе новый кастомный эмодзи,
  // загруженный админом, не появился бы в уже построенном пикере без
  // перезагрузки страницы.
  picker.innerHTML = buildReactionSet().map(e =>
    `<button role="menuitem" data-emoji-value="${esc(emojiValue(e))}" aria-label="Поставить реакцию ${esc(e.id)}" onclick="toggleReaction(reactPickerTargetMsg,this.dataset.emojiValue)">${renderEmoji(e)}</button>`
  ).join('');
  return picker;
}
function openReactionPicker(msgId, triggerBtn){
  const picker = buildReactionPicker();
  reactPickerTargetMsg = msgId;
  const rect = triggerBtn.getBoundingClientRect();
  const pickerWidth = 216, pickerHeight = 210;
  // position:fixed — координаты уже относительно вьюпорта, scrollY тут
  // добавлять НЕ нужно (это правило для position:absolute) — раньше из-за
  // этого пикер на некоторых страницах уезжал за пределы экрана.
  let top = rect.bottom + 4;
  if (top + pickerHeight > window.innerHeight) top = rect.top - pickerHeight - 4;
  picker.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - pickerWidth - 8)) + 'px';
  picker.style.top = Math.max(8, top) + 'px';
  picker.classList.add('open');
}
function closeReactionPicker(){
  document.getElementById('reactPickerPop')?.classList.remove('open');
  reactPickerTargetMsg = null;
}
document.addEventListener('click', (e) => {
  const picker = document.getElementById('reactPickerPop');
  if (picker && picker.classList.contains('open') && !picker.contains(e.target) && !e.target.closest('.msg-react-btn')) {
    closeReactionPicker();
  }
});

// Живая синхронизация реакций между всеми, кто сейчас смотрит чат
function subscribeReactionsRealtime(){
  if (!sbClient || reactionsChannel) return;
  reactionsChannel = sbClient
    .channel('message_reactions_live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, (payload) => {
      const r = payload.new;
      addReactionToState(r.message_id, r.emoji, r.nick);
      renderReactionsFor(r.message_id);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, (payload) => {
      const r = payload.old;
      removeReactionFromState(r.message_id, r.emoji, r.nick);
      renderReactionsFor(r.message_id);
    })
    .subscribe();
}

