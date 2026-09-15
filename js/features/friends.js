// ═══════════════════════════════════════
//  ДРУЗЬЯ + ЛИЧНЫЕ СООБЩЕНИЯ
//  ЛС можно писать только подтверждённому другу — проверяется не
//  только здесь, но и в RLS-политике на direct_messages (friends-dm.sql),
//  так что даже прямой запрос в обход интерфейса ничего не даст.
// ═══════════════════════════════════════

let dmChannel = null;
let dmCurrentFriendId = null;
let dmUnreadCount = 0;

// ─── ДРУЗЬЯ ───

async function sendFriendRequest(targetId){
  if (!currentUser) { openGlobalAuth(); return; }
  if (targetId === currentUser.id) return;
  try {
    const { error } = await sbClient.from('friendships').insert([{ requester_id: currentUser.id, addressee_id: targetId }]);
    if (error) throw error;
    alert('Заявка в друзья отправлена');
    if (typeof openMiniProfile === 'function' && profileViewedId === targetId) renderProfilePage(targetId);
  } catch(e) {
    if (String(e.message||'').includes('duplicate')) alert('Заявка уже отправлена или вы уже друзья');
    else alert('Не удалось отправить заявку: ' + (e.message || e));
  }
}

async function acceptFriendRequest(requesterId){
  try {
    await sbClient.from('friendships').update({ status: 'accepted' }).eq('requester_id', requesterId).eq('addressee_id', currentUser.id);
    renderFriendsPanel();
  } catch(e) { alert('Не получилось: ' + (e.message || e)); }
}

async function removeFriendship(otherId){
  if (!confirm('Удалить из друзей / отменить заявку?')) return;
  try {
    await sbClient.from('friendships').delete().or(`and(requester_id.eq.${currentUser.id},addressee_id.eq.${otherId}),and(requester_id.eq.${otherId},addressee_id.eq.${currentUser.id})`);
    renderFriendsPanel();
  } catch(e) { alert('Не получилось: ' + (e.message || e)); }
}

async function getFriendshipStatus(otherId){
  if (!currentUser || otherId === currentUser.id) return 'self';
  try {
    const { data } = await sbClient.from('friendships').select('*')
      .or(`and(requester_id.eq.${currentUser.id},addressee_id.eq.${otherId}),and(requester_id.eq.${otherId},addressee_id.eq.${currentUser.id})`)
      .maybeSingle();
    if (!data) return 'none';
    if (data.status === 'accepted') return 'friends';
    return data.requester_id === currentUser.id ? 'pending_sent' : 'pending_received';
  } catch(e) { return 'none'; }
}

async function renderFriendsPanel(){
  const listEl = document.getElementById('friendsList');
  const reqEl = document.getElementById('friendRequestsList');
  if (!currentUser || !listEl) return;
  try {
    const { data: rows } = await sbClient.from('friendships').select('*, requester:requester_id(nick), addressee:addressee_id(nick)')
      .or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`);

    const friends = (rows||[]).filter(r => r.status === 'accepted').map(r => {
      const isMe = r.requester_id === currentUser.id;
      return { id: isMe ? r.addressee_id : r.requester_id, nick: (isMe ? r.addressee : r.requester)?.nick || '?' };
    });
    const incoming = (rows||[]).filter(r => r.status === 'pending' && r.addressee_id === currentUser.id)
      .map(r => ({ id: r.requester_id, nick: r.requester?.nick || '?' }));

    reqEl.innerHTML = incoming.length ? incoming.map(f => `
      <div class="role-result-row">
        <span class="role-result-nick">${esc(f.nick)}</span>
        <button class="role-result-save" onclick="acceptFriendRequest('${f.id}')">✅ Принять</button>
        <button onclick="removeFriendship('${f.id}')" style="background:none;border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:.4rem .6rem;font-size:.72rem;cursor:pointer">✕</button>
      </div>`).join('') : '<div style="color:var(--muted);font-size:.78rem">Заявок нет</div>';

    listEl.innerHTML = friends.length ? friends.map(f => `
      <div class="role-result-row">
        <span class="role-result-nick" style="cursor:pointer" onclick="location.hash='#/profile/${f.id}'">${esc(f.nick)}</span>
        <button class="role-result-save" onclick="openDmWith('${f.id}','${esc(f.nick).replace(/'/g,"\\'")}')">✉ Написать</button>
        <button onclick="removeFriendship('${f.id}')" style="background:none;border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:.4rem .6rem;font-size:.72rem;cursor:pointer">✕</button>
      </div>`).join('') : '<div style="color:var(--muted);font-size:.78rem">Пока нет друзей — найди кого-нибудь через мини-профиль в чате или на странице профиля</div>';
  } catch(e) {
    listEl.innerHTML = '<div style="color:var(--accent);font-size:.78rem">Ошибка загрузки</div>';
  }
}

// ─── ЛИЧНЫЕ СООБЩЕНИЯ ───

function openDmWith(friendId, nick){
  dmCurrentFriendId = friendId;
  document.getElementById('dmModal').style.display = 'flex';
  document.getElementById('dmModalNick').textContent = nick;
  loadDmConversation(friendId);
  trapModalFocus(document.getElementById('dmModal'));
}
function closeDmModal(){
  document.getElementById('dmModal').style.display = 'none';
  dmCurrentFriendId = null;
  releaseModalFocus();
}

async function loadDmConversation(friendId){
  const listEl = document.getElementById('dmMessages');
  listEl.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:.8rem;padding:1rem">Загружаем...</div>';
  try {
    const { data } = await sbClient.from('direct_messages').select('*')
      .or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${friendId}),and(sender_id.eq.${friendId},recipient_id.eq.${currentUser.id})`)
      .order('created_at', { ascending: true })
      .limit(100);
    renderDmMessages(data || []);
    // Отмечаем прочитанным то, что нам написали
    await sbClient.from('direct_messages').update({ read_at: new Date().toISOString() })
      .eq('sender_id', friendId).eq('recipient_id', currentUser.id).is('read_at', null);
    updateDmUnreadBadge();
  } catch(e) {
    listEl.innerHTML = '<div style="color:var(--accent);font-size:.8rem;text-align:center">Не удалось загрузить переписку</div>';
  }
}

function renderDmMessages(messages){
  const listEl = document.getElementById('dmMessages');
  if (!messages.length) { listEl.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:.8rem;padding:1rem">Пока пусто — напиши первым</div>'; return; }
  listEl.innerHTML = messages.map(m => {
    const isOwn = m.sender_id === currentUser.id;
    return `<div style="display:flex;justify-content:${isOwn?'flex-end':'flex-start'};margin-bottom:.5rem">
      <div style="max-width:75%;background:${isOwn?'linear-gradient(135deg,var(--accent),var(--accent2))':'rgba(255,255,255,.06)'};color:${isOwn?'#fff':'var(--text)'};padding:.5rem .8rem;border-radius:12px;font-size:.82rem;word-break:break-word">
        ${esc(m.text)}
        <div style="font-size:.6rem;opacity:.7;margin-top:.2rem">${new Date(m.created_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
    </div>`;
  }).join('');
  listEl.scrollTop = listEl.scrollHeight;
}

async function sendDm(){
  const input = document.getElementById('dmInput');
  const text = input.value.trim();
  if (!text || !dmCurrentFriendId) return;
  try {
    const { error } = await sbClient.from('direct_messages').insert([{ sender_id: currentUser.id, recipient_id: dmCurrentFriendId, text }]);
    if (error) throw error;
    input.value = '';
    loadDmConversation(dmCurrentFriendId);
  } catch(e) {
    alert('Не удалось отправить — возможно, вы больше не друзья: ' + (e.message || e));
  }
}

function subscribeDmRealtime(){
  if (!sbClient || !currentUser || dmChannel) return;
  dmChannel = sbClient.channel('public:direct_messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, payload => {
      const m = payload.new;
      if (m.recipient_id !== currentUser.id) return; // не нам — игнор (RLS и так не отдаст чужое, но на всякий)
      if (dmCurrentFriendId === m.sender_id && document.getElementById('dmModal').style.display === 'flex') {
        loadDmConversation(m.sender_id);
      } else {
        updateDmUnreadBadge();
      }
    })
    .subscribe();
}

async function updateDmUnreadBadge(){
  if (!sbClient || !currentUser) return;
  try {
    const { count } = await sbClient.from('direct_messages').select('id', { count: 'exact', head: true })
      .eq('recipient_id', currentUser.id).is('read_at', null);
    dmUnreadCount = count || 0;
    document.querySelectorAll('.dm-unread-badge').forEach(el => {
      el.style.display = dmUnreadCount > 0 ? 'inline-flex' : 'none';
      el.textContent = dmUnreadCount > 9 ? '9+' : dmUnreadCount;
    });
  } catch(e) {}
}
