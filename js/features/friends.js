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
    if (error) {
      // Отказ базы (progression.sql): уровень, лимит друзей или человек не принимает заявки
      if (/row-level security/i.test(error.message || '') && typeof friendBlockReason === 'function') {
        const why = await friendBlockReason();
        alert(why || '🚫 Этот человек не принимает заявки в друзья');
        return;
      }
      throw error;
    }
    alert('Заявка в друзья отправлена');
    if (typeof openMiniProfile === 'function' && profileViewedId === targetId) renderProfilePage(targetId);
  } catch(e) {
    if (String(e.message||'').includes('duplicate')) alert('Заявка уже отправлена или вы уже друзья');
    else alert('Не удалось отправить заявку: ' + (e.message || e));
  }
}

async function acceptFriendRequest(requesterId){
  try {
    const { error } = await sbClient.from('friendships').update({ status: 'accepted' }).eq('requester_id', requesterId).eq('addressee_id', currentUser.id);
    if (error) {
      alert(/row-level security/i.test(error.message || '')
        ? '👥 Не получилось: у тебя или у него уже максимум друзей. Лимит растёт с уровнем и VIP'
        : 'Не получилось: ' + error.message);
    }
    if (typeof myFriendStatusCache !== 'undefined') myFriendStatusCache = null;
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
    // requester_id/addressee_id ссылаются на auth.users, а не на profiles, поэтому
    // встроенный select профилей PostgREST отвергает (400) — профили берём вторым запросом.
    const { data: rows } = await sbClient.from('friendships').select('*')
      .or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`);
    const ids = [...new Set((rows||[]).flatMap(r => [r.requester_id, r.addressee_id]))];
    if (ids.length) {
      const { data: profs } = await (await sbProfiles())
        .select('id, nick, avatar_url, role, is_vip, vip_until, total_donated').in('id', ids);
      const byId = new Map((profs||[]).map(p => [p.id, p]));
      for (const r of rows) { r.requester = byId.get(r.requester_id); r.addressee = byId.get(r.addressee_id); }
    }

    const limitEl = document.getElementById('friendsLimitNote');
    if (limitEl && typeof myFriendStatus === 'function') myFriendStatus(true).then(st => {
      limitEl.textContent = st ? `${st.count} / ${st.limit ?? '∞'}` : '';
    });
    const friends = (rows||[]).filter(r => r.status === 'accepted').map(r => {
      const isMe = r.requester_id === currentUser.id;
      const p = isMe ? r.addressee : r.requester;
      return { id: isMe ? r.addressee_id : r.requester_id, profile: p || {} };
    });
    const incoming = (rows||[]).filter(r => r.status === 'pending' && r.addressee_id === currentUser.id)
      .map(r => ({ id: r.requester_id, nick: r.requester?.nick || '?' }));

    reqEl.innerHTML = incoming.length ? incoming.map(f => `
      <div class="role-result-row">
        <span class="role-result-nick">${esc(f.nick)}</span>
        <button class="role-result-save" onclick="acceptFriendRequest('${f.id}')">✅ Принять</button>
        <button onclick="removeFriendship('${f.id}')" style="background:none;border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:.4rem .6rem;font-size:.72rem;cursor:pointer">✕</button>
      </div>`).join('') : '<div style="color:var(--muted);font-size:.78rem">Заявок нет</div>';

    // VIP и стафф — наверх списка (роль важнее уровня VIP, оба важнее
    // обычных друзей), дальше по алфавиту — самое ценное видно сразу,
    // не листая весь список.
    const ROLE_RANK = { admin: 3, moderator: 2, helper: 1 };
    const rank = (p) => {
      if (ROLE_RANK[p.role]) return 10 + ROLE_RANK[p.role];
      const tier = typeof getVipTier === 'function' ? getVipTier(p) : null;
      if (tier) return tier.key === 'gold' ? 9 : tier.key === 'silver' ? 8 : 7;
      return 0;
    };
    friends.sort((a, b) => rank(b.profile) - rank(a.profile) || (a.profile.nick||'').localeCompare(b.profile.nick||''));

    listEl.innerHTML = friends.length ? friends.map(f => {
      const p = f.profile;
      const nick = p.nick || '?';
      const nickHtml = (typeof renderNickWithVip === 'function') ? renderNickWithVip(nick, p, ROLE_BADGE_HTML[p.role] || '') : esc(nick);
      const avatarStyle = p.avatar_url ? `background-image:url('${safeImgUrl(p.avatar_url)}')` : '';
      return `
      <div class="role-result-row card-fade-in" style="display:flex;align-items:center;gap:.6rem">
        <div onclick="location.hash='#/profile/${f.id}'" style="width:32px;height:32px;border-radius:50%;background:var(--tw) center/cover;${avatarStyle};display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:800;color:#fff;cursor:pointer;flex-shrink:0">${p.avatar_url ? '' : nick.substring(0,2).toUpperCase()}</div>
        <span class="role-result-nick" style="cursor:pointer;flex:1;min-width:0" onclick="location.hash='#/profile/${f.id}'">${nickHtml}</span>
        <button class="role-result-save" onclick="openDmWith('${f.id}',${jsAttr(nick)})">✉</button>
        <button onclick="removeFriendship('${f.id}')" style="background:none;border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:.4rem .6rem;font-size:.72rem;cursor:pointer">✕</button>
      </div>`;
    }).join('') : '<div style="color:var(--muted);font-size:.78rem">Пока нет друзей — найди кого-нибудь через мини-профиль в чате или на странице профиля</div>';
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
