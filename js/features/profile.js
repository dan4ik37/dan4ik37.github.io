// ═══════════════════════════════════════
//  ПРОФИЛЬ — своя страница (#/profile или #/profile/<id> для чужого)
// ═══════════════════════════════════════

const ROLE_BADGE_HTML = {
  admin: '<span class="role-badge admin">ADMIN</span>',
  moderator: '<span class="role-badge moderator">MOD</span>',
  helper: '<span class="role-badge helper">HELPER</span>',
};

let profileViewedId = null; // чей профиль сейчас открыт (может быть не наш)
let profileEmailRaw = '';
let profileEmailVisible = false;

// dan.ivanov@mail.ru → da••••••@mail.ru — стример может показывать
// профиль на стриме, почта по умолчанию скрыта даже от него самого.
function maskEmail(email){
  const at = email.indexOf('@');
  if (at < 2) return email;
  return email.slice(0, 2) + '•'.repeat(Math.max(at - 2, 3)) + email.slice(at);
}
function renderProfileEmailMask(){
  const el = document.getElementById('profileEmail');
  const btn = document.getElementById('profileEmailToggle');
  if (!profileEmailRaw) { el.textContent = ''; return; }
  el.textContent = profileEmailVisible ? profileEmailRaw : maskEmail(profileEmailRaw);
  if (btn) btn.textContent = profileEmailVisible ? '🙈' : '👁';
}
function toggleProfileEmailVisibility(){
  profileEmailVisible = !profileEmailVisible;
  renderProfileEmailMask();
}

function isVipActive(p){
  if (!p?.is_vip) return false;
  if (!p.vip_until) return true; // без даты — бессрочно
  return new Date(p.vip_until) > new Date();
}
// Стафф анимацию получает бесплатно, VIP — по донату (см. profile-system.sql)
function canUseAnimatedAvatar(role, profile){
  return role === 'admin' || role === 'moderator' || role === 'helper' || isVipActive(profile);
}

async function renderProfilePage(viewUserId){
  const loggedOutEl = document.getElementById('profileLoggedOut');
  const contentEl = document.getElementById('profileContent');

  const targetId = viewUserId || currentUser?.id;
  if (!targetId) {
    loggedOutEl.style.display = 'block';
    contentEl.style.display = 'none';
    return;
  }
  if (!sbClient) return;

  loggedOutEl.style.display = 'none';
  contentEl.style.display = 'block';
  profileViewedId = targetId;
  const isOwn = targetId === currentUser?.id;

  let profile;
  try {
    const { data } = await sbClient.from('profiles').select('*').eq('id', targetId).single();
    profile = data;
  } catch(e) { profile = null; }
  if (!profile) {
    contentEl.innerHTML = '<p style="text-align:center;color:var(--muted);padding:3rem 0">Профиль не найден</p>';
    return;
  }

  document.getElementById('profileNick').textContent = profile.nick || 'Без ника';
  profileEmailRaw = isOwn ? (currentUser?.email || '') : '';
  profileEmailVisible = false;
  document.getElementById('profileEmailToggle').style.display = (isOwn && profileEmailRaw) ? 'inline' : 'none';
  renderProfileEmailMask();
  document.getElementById('profileRoleBadge').innerHTML = ROLE_BADGE_HTML[profile.role] || '';
  document.getElementById('profileVipBadge').style.display = isVipActive(profile) ? 'inline-block' : 'none';
  document.getElementById('profileBioText').textContent = profile.bio || (isOwn ? 'Расскажи о себе...' : '');
  document.getElementById('profileBanner').style.backgroundImage = profile.banner_url ? `url('${profile.banner_url}')` : '';
  const avatarEl = document.getElementById('profileAvatarImg');
  if (profile.avatar_url) { avatarEl.style.backgroundImage = `url('${profile.avatar_url}')`; avatarEl.textContent=''; }
  else { avatarEl.style.backgroundImage=''; avatarEl.textContent = (profile.nick||'?').substring(0,2).toUpperCase(); }

  // Редактирование — только на своём профиле
  document.getElementById('profileBannerEditBtn').style.display = isOwn ? 'flex' : 'none';
  document.getElementById('profileBannerRemoveBtn').style.display = (isOwn && profile.banner_url) ? 'block' : 'none';
  document.getElementById('profileAvatarEditBtn').style.display = isOwn ? 'flex' : 'none';
  document.getElementById('profileAvatarRemoveBtn').style.display = (isOwn && profile.avatar_url) ? 'block' : 'none';
  document.getElementById('profileNickEditBtn').style.display = isOwn ? 'inline' : 'none';
  document.getElementById('profileBioEditBtn').style.display = isOwn ? 'inline' : 'none';
  document.getElementById('profileAccountSettings').style.display = isOwn ? 'block' : 'none';
  document.getElementById('profileFriendsPanel').style.display = isOwn ? 'block' : 'none';
  if (isOwn) {
    renderFriendsPanel();
    subscribeDmRealtime();
  }

  const addFriendWrap = document.getElementById('profileAddFriendWrap');
  if (!isOwn && currentUser) {
    const status = await getFriendshipStatus(targetId);
    const buttons = {
      none: `<button onclick="sendFriendRequest('${targetId}')" style="padding:.6rem 1.2rem;border-radius:10px;border:none;background:linear-gradient(135deg,var(--tw),#6d28d9);color:#fff;font-weight:700;font-size:.82rem;cursor:pointer;font-family:'Montserrat',sans-serif">➕ Добавить в друзья</button>`,
      pending_sent: `<span style="color:var(--muted);font-size:.8rem">⏳ Заявка отправлена</span>`,
      pending_received: `<button onclick="acceptFriendRequest('${targetId}')" style="padding:.6rem 1.2rem;border-radius:10px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-weight:700;font-size:.82rem;cursor:pointer;font-family:'Montserrat',sans-serif">✅ Принять заявку в друзья</button>`,
      friends: `<button onclick="openDmWith('${targetId}','${esc(profile.nick||'?').replace(/'/g,"\\'")}')" style="padding:.6rem 1.2rem;border-radius:10px;border:1.5px solid var(--border);background:rgba(255,255,255,.04);color:var(--text);font-size:.82rem;cursor:pointer;font-family:'Montserrat',sans-serif">✉ Написать другу</button>`,
    };
    addFriendWrap.innerHTML = buttons[status] || '';
    addFriendWrap.style.display = 'block';
  } else {
    addFriendWrap.style.display = 'none';
  }
  document.getElementById('profileVipPromo').style.display = (isOwn && !canUseAnimatedAvatar(profile.role, profile)) ? 'block' : 'none';
  document.getElementById('profileAdminPanel').style.display = (isOwn && profile.role === 'admin') ? 'block' : 'none';

  const staffPanel = document.getElementById('profileStaffPanel');
  if (isOwn && (profile.role === 'moderator' || profile.role === 'helper')) {
    staffPanel.style.display = 'block';
    const perms = profile.role === 'moderator'
      ? ['🗑 Удаление сообщений в чате', '🔨 Бан участников чата']
      : ['🗑 Удаление сообщений в чате'];
    document.getElementById('profileStaffPerms').innerHTML = perms.map(p=>`<div>${p}</div>`).join('')
      + '<div style="color:var(--muted);margin-top:.3rem">Настройки сайта и опросы — только у администратора</div>';
  } else {
    staffPanel.style.display = 'none';
  }
}

function toggleBioEdit(show){
  document.getElementById('profileBioText').style.display = show ? 'none' : 'block';
  document.getElementById('profileBioEditWrap').style.display = show ? 'block' : 'none';
  if (show) document.getElementById('profileBioInput').value = document.getElementById('profileBioText').textContent;
}

async function saveProfileBio(){
  const bio = document.getElementById('profileBioInput').value.trim().slice(0, 280);
  try {
    await sbClient.from('profiles').update({ bio }).eq('id', currentUser.id);
    document.getElementById('profileBioText').textContent = bio || 'Расскажи о себе...';
    toggleBioEdit(false);
  } catch(e) {
    alert('Не удалось сохранить: ' + (e.message || e));
  }
}

function toggleNickEdit(show){
  document.getElementById('profileNick').style.display = show ? 'none' : 'inline';
  document.getElementById('profileNickEditBtn').style.display = show ? 'none' : 'inline';
  document.getElementById('profileNickEditWrap').style.display = show ? 'flex' : 'none';
  document.getElementById('profileNickError').textContent = '';
  if (show) document.getElementById('profileNickInput').value = document.getElementById('profileNick').textContent;
}

async function saveProfileNick(){
  const errEl = document.getElementById('profileNickError');
  const nick = document.getElementById('profileNickInput').value.trim();
  errEl.textContent = '';
  if (!nick) { errEl.textContent = 'Ник не может быть пустым'; return; }
  if (nick.length > 24) { errEl.textContent = 'Максимум 24 символа'; return; }

  try {
    // Мягкое предупреждение о занятом нике — не блокирует (уникальности
    // на уровне БД нет и специально, см. ИНСТРУКЦИЮ, раздел 8), просто
    // подсказка, чтобы не путаться с кем-то ещё в поиске ролей/донатах.
    const { data: existing } = await sbClient.from('profiles').select('id').ilike('nick', nick).neq('id', currentUser.id).maybeSingle();
    if (existing && !confirm(`Ник «${nick}» уже занят кем-то другим. Использовать всё равно? (может запутать при выдаче ролей/VIP по нику)`)) return;

    await sbClient.from('profiles').update({ nick }).eq('id', currentUser.id);
    if (currentProfile) currentProfile.nick = nick;
    chatNick = nick;
    try { localStorage.setItem('d37_nick', nick); } catch(e) {}
    document.getElementById('profileNick').textContent = nick;
    toggleNickEdit(false);
  } catch(e) {
    errEl.textContent = 'Не удалось сохранить: ' + (e.message || e);
  }
}

// bucket: 'avatars' | 'profile-covers' — сброс к дефолту (без файла)
async function removeProfileImage(bucket){
  if (!confirm('Удалить ' + (bucket === 'avatars' ? 'аватарку' : 'фон') + '?')) return;
  const col = bucket === 'avatars' ? 'avatar_url' : 'banner_url';
  const statusEl = document.getElementById('profileUploadStatus');
  try {
    await sbClient.from('profiles').update({ [col]: null }).eq('id', currentUser.id);
    // Файл из Storage не трогаем намеренно — просто отвязываем ссылку в
    // профиле, это и быстрее, и безопаснее (без риска задеть чужой путь
    // случайным несовпадением расширения файла).
    renderProfilePage(currentUser.id);
  } catch(e) {
    statusEl.textContent = '⚠ Не удалось удалить: ' + (e.message || e);
  }
}

// bucket: 'avatars' | 'profile-covers'
async function uploadProfileImage(bucket, file){
  const statusEl = document.getElementById('profileUploadStatus');
  if (!file) return;
  statusEl.style.color = '';

  const isGif = file.type === 'image/gif';
  const okTypes = ['image/png','image/jpeg','image/webp','image/gif'];
  if (!okTypes.includes(file.type)) {
    statusEl.textContent = '⚠ Только PNG, JPEG, WEBP или GIF'; return;
  }
  if (isGif) {
    let profile;
    try { const { data } = await sbClient.from('profiles').select('role,is_vip,vip_until').eq('id', currentUser.id).single(); profile = data; } catch(e) {}
    if (!canUseAnimatedAvatar(profile?.role, profile)) {
      statusEl.textContent = '✨ Анимированные картинки — только для VIP или команды сайта. Обычное фото (PNG/JPEG) можно грузить всем.';
      return;
    }
  }
  if (file.size > 5 * 1024 * 1024) { statusEl.textContent = '⚠ Файл больше 5 МБ'; return; }

  statusEl.textContent = 'Загружаем...';
  try {
    const ext = file.name.split('.').pop();
    const path = `${currentUser.id}/${bucket === 'avatars' ? 'avatar' : 'banner'}.${ext}`;
    const { error: upErr } = await sbClient.storage.from(bucket).upload(path, file, { upsert: true, cacheControl: '3600' });
    if (upErr) throw upErr;
    const { data: urlData } = sbClient.storage.from(bucket).getPublicUrl(path);
    // ?t= — чтобы браузер не показывал старую картинку из кэша при замене
    const publicUrl = urlData.publicUrl + '?t=' + Date.now();
    const col = bucket === 'avatars' ? 'avatar_url' : 'banner_url';
    await sbClient.from('profiles').update({ [col]: publicUrl }).eq('id', currentUser.id);
    statusEl.style.color = 'var(--tw)';
    statusEl.textContent = '✅ Обновлено!';
    renderProfilePage(currentUser.id);
    setTimeout(()=>{ if(statusEl) statusEl.textContent=''; }, 2500);
  } catch(e) {
    statusEl.style.color = '';
    statusEl.textContent = '⚠ Не получилось: ' + (e.message || e);
  }
}

// ═══════════════════════════════════════
//  АВТО-VIP ПО ДОНАТУ (100₽ = 1 месяц, дробная часть сгорает)
//  Вызывается из leaderboard.js (список последних донатов) и из
//  donation-alerts.js (живой алерт) — оба места видны ТОЛЬКО в сессии
//  админа (см. пояснение в donation-alerts.js), это ожидаемое
//  ограничение, не баг. Дедуп через vip_donation_log — один donation_id
//  обрабатывается ровно один раз, повторные вызовы просто выходят рано.
// ═══════════════════════════════════════
const VIP_RUB_PER_MONTH = 100;

async function processDonationForVip(d){
  if (!sbClient || currentRole !== 'admin' || !d?.id) return;

  try {
    const { data: already } = await sbClient.from('vip_donation_log').select('donation_id').eq('donation_id', d.id).maybeSingle();
    if (already) return; // уже обработан раньше

    const logBase = { donation_id: d.id, donor_username: d.username, amount: d.amount, currency: d.currency || 'RUB' };

    // Конвертация валют не реализована — см. vip-auto.sql. Логируем как
    // "не сопоставлен", чтобы админ видел донат целиком, а не тишину.
    if (d.currency && d.currency !== 'RUB') {
      await sbClient.from('vip_donation_log').insert([{ ...logBase, matched: false }]);
      return;
    }
    const months = Math.floor((Number(d.amount) || 0) / VIP_RUB_PER_MONTH);
    if (months < 1) {
      await sbClient.from('vip_donation_log').insert([{ ...logBase, matched: false }]);
      return;
    }

    const { data: profile } = await sbClient.from('profiles').select('id, nick, is_vip, vip_until').ilike('nick', d.username).maybeSingle();
    if (!profile) {
      await sbClient.from('vip_donation_log').insert([{ ...logBase, matched: false }]);
      return;
    }

    const activeUntil = (profile.is_vip && profile.vip_until && new Date(profile.vip_until) > new Date())
      ? new Date(profile.vip_until) : new Date();
    activeUntil.setMonth(activeUntil.getMonth() + months);

    await sbClient.from('profiles').update({ is_vip: true, vip_until: activeUntil.toISOString() }).eq('id', profile.id);
    await sbClient.from('vip_donation_log').insert([{ ...logBase, profile_id: profile.id, matched: true, months_granted: months }]);
  } catch(e) {
    // Гонка (два вызова обработали один donation_id одновременно) или
    // сетевая ошибка — не критично, при следующей загрузке списка
    // донатов donation_id либо уже будет в логе, либо попробуется снова.
  }
}

// Прогоняет весь список последних донатов (из /api/donations) через
// авто-VIP — для тех, что пришли, пока админ не был на сайте живьём.
function processRecentDonationsForVip(donations){
  if (!Array.isArray(donations) || currentRole !== 'admin') return;
  donations.forEach(d => processDonationForVip(d));
}


// ═══════════════════════════════════════
//  ПОКУПКА VIP — гайд + копирование ника
//  ВАЖНО: DonationAlerts официально не документирует, поддерживает ли
//  страница доната параметры в ссылке (сумма/имя через URL) — поэтому
//  полагаться только на это нельзя. Делаем то, что гарантированно
//  работает (копируем точный ник в буфер обмена, показываем понятную
//  инструкцию) и ПЫТАЕМСЯ подставить сумму через ?amount= "на удачу" —
//  если DA его не читает, просто ничего не подставится, страница всё
//  равно откроется нормально.
// ═══════════════════════════════════════
const DA_DONATE_URL = 'https://www.donationalerts.com/r/dan4ik37';

function openVipBuyGuide(){
  if (!currentUser) { openGlobalAuth(); return; }
  const months = parseInt(document.getElementById('vipBuyMonths').value, 10);
  const amount = months * VIP_RUB_PER_MONTH;
  const nick = currentProfile?.nick || currentUser.email.split('@')[0];
  document.getElementById('vipGuideNick').textContent = nick;
  document.getElementById('vipGuideAmount').textContent = amount + '₽';
  document.getElementById('vipBuyModal').style.display = 'flex';
}
function closeVipBuyGuide(){
  document.getElementById('vipBuyModal').style.display = 'none';
}
async function proceedToVipDonate(){
  const nick = document.getElementById('vipGuideNick').textContent;
  const amount = document.getElementById('vipGuideAmount').textContent.replace('₽','');
  try { await navigator.clipboard.writeText(nick); } catch(e) {
    // Буфер обмена может быть недоступен (напр. без HTTPS или разрешения) —
    // не критично, ник всё равно есть текстом в гайде, можно ввести руками.
  }
  // best-effort — см. комментарий выше, не гарантировано
  window.open(`${DA_DONATE_URL}?amount=${amount}`, '_blank');
  closeVipBuyGuide();
}


// ═══════════════════════════════════════
//  ЛОГ ДОНАТОВ/VIP (только админ — видит и RLS, и здесь для честности)
// ═══════════════════════════════════════
async function openDonationLog(){
  if (currentRole !== 'admin') return;
  document.getElementById('donationLogModal').style.display = 'flex';
  const statusEl = document.getElementById('donationLogStatus');
  const tableEl = document.getElementById('donationLogTable');
  statusEl.textContent = 'Загружаем...'; tableEl.innerHTML = '';
  try {
    const { data, error } = await sbClient
      .from('vip_donation_log')
      .select('*, profiles(nick)')
      .order('processed_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    if (!data || !data.length) { statusEl.textContent = 'Пока пусто — донатов ещё не было'; return; }
    statusEl.textContent = '';
    tableEl.innerHTML = data.map(row => {
      const date = new Date(row.processed_at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      const status = row.matched
        ? `✅ +${row.months_granted} мес. → <b>${esc(row.profiles?.nick || '?')}</b>`
        : `⚠ Не сопоставлен`;
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.8rem;background:rgba(255,255,255,.03);border-radius:10px;padding:.6rem .9rem;font-size:.78rem;flex-wrap:wrap">
          <div>
            <div style="font-weight:700">${esc(row.donor_username || '(без имени)')} — ${row.amount ?? '?'} ${esc(row.currency || 'RUB')}</div>
            <div style="color:var(--muted);font-size:.7rem">${date}</div>
          </div>
          <div>${status}</div>
        </div>`;
    }).join('');
  } catch(e) {
    statusEl.textContent = 'Ошибка загрузки: ' + (e.message || e);
  }
}
function closeDonationLog(){
  document.getElementById('donationLogModal').style.display = 'none';
}


// ═══════════════════════════════════════
//  МИНИ-ПРОФИЛЬ (клик на ник в чате — как в Discord)
// ═══════════════════════════════════════
async function openMiniProfile(userId, fallbackNick, anchorEl){
  const pop = document.getElementById('miniProfilePopover');
  if (!sbClient || !userId) return;

  // Позиционируем рядом с кликом, с защитой от выхода за край экрана
  const rect = anchorEl.getBoundingClientRect();
  const popW = 260;
  let left = rect.left;
  if (left + popW > window.innerWidth - 16) left = window.innerWidth - popW - 16;
  pop.style.left = Math.max(16, left) + 'px';
  pop.style.top = (rect.bottom + 8) + 'px';
  pop.style.display = 'block';

  document.getElementById('miniProfileNick').textContent = fallbackNick;
  document.getElementById('miniProfileBio').textContent = '';
  document.getElementById('miniProfileRoleBadge').innerHTML = '';
  document.getElementById('miniProfileVip').style.display = 'none';
  document.getElementById('miniProfileAvatar').textContent = (fallbackNick||'?').substring(0,2).toUpperCase();
  document.getElementById('miniProfileAvatar').style.backgroundImage = '';
  document.getElementById('miniProfileBanner').style.backgroundImage = '';
  document.getElementById('miniProfileLink').href = `#/profile/${userId}`;

  try {
    const { data: p } = await sbClient.from('profiles').select('*').eq('id', userId).single();
    if (!p) return;
    document.getElementById('miniProfileNick').textContent = p.nick || fallbackNick;
    document.getElementById('miniProfileBio').textContent = p.bio || '';
    document.getElementById('miniProfileRoleBadge').innerHTML = ROLE_BADGE_HTML[p.role] || '';
    document.getElementById('miniProfileVip').style.display = isVipActive(p) ? 'inline' : 'none';
    if (p.avatar_url) document.getElementById('miniProfileAvatar').style.backgroundImage = `url('${p.avatar_url}')`;
    if (p.banner_url) document.getElementById('miniProfileBanner').style.backgroundImage = `url('${p.banner_url}')`;

    const actionEl = document.getElementById('miniProfileFriendAction');
    if (currentUser && currentUser.id !== userId) {
      const status = await getFriendshipStatus(userId);
      const small = 'padding:.4rem .8rem;border-radius:8px;font-size:.72rem;cursor:pointer;font-family:\'Montserrat\',sans-serif;border:none;width:100%';
      const buttons = {
        none: `<button onclick="sendFriendRequest('${userId}')" style="${small};background:var(--tw);color:#fff">➕ В друзья</button>`,
        pending_sent: `<span style="font-size:.72rem;color:var(--muted)">⏳ Заявка отправлена</span>`,
        pending_received: `<button onclick="acceptFriendRequest('${userId}')" style="${small};background:var(--accent);color:#fff">✅ Принять заявку</button>`,
        friends: `<button onclick="openDmWith('${userId}','${(p.nick||fallbackNick).replace(/'/g,"\\'")}')" style="${small};background:rgba(255,255,255,.1);color:var(--text)">✉ Написать</button>`,
      };
      actionEl.innerHTML = buttons[status] || '';
    } else {
      actionEl.innerHTML = '';
    }
  } catch(e) {}
}
document.addEventListener('click', e => {
  const pop = document.getElementById('miniProfilePopover');
  if (pop && pop.style.display === 'block' && !pop.contains(e.target) && !e.target.closest('.chat-avatar,.chat-user')) {
    pop.style.display = 'none';
  }
});
