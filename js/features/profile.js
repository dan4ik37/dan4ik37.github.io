// ═══════════════════════════════════════
//  ПРОФИЛЬ — своя страница (#/profile или #/profile/<id> для чужого)
// ═══════════════════════════════════════

const ROLE_BADGE_HTML = {
  admin: '<span class="role-badge admin profile-badge-pop">ADMIN</span>',
  moderator: '<span class="role-badge moderator profile-badge-pop">MOD</span>',
  helper: '<span class="role-badge helper profile-badge-pop">HELPER</span>',
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

// ═══════════════════════════════════════
//  БАЛАНС VIP — ВСЕ ЦИФРЫ В ОДНОМ МЕСТЕ
// ═══════════════════════════════════════
// Уровень считается по сумме донатов за всё время (profiles.total_donated,
// см. vip-tiers.sql); пока VIP не активен — уровня нет вообще. Порядок по
// убыванию min — первое совпадение побеждает.
//
// Что даёт каждый уровень (перки суммируются вверх):
//   • ВСЕМ VIP: анимированные аватар/фон, цветной ник, своя тема, форматирование
//     форума, стикеры (базовый набор), закреп сообщения, список гостей
//   • pinMin / pinCooldownMult — длительность закрепа и пауза до следующего
//     (пауза = pinMin × mult). Скважность растёт с уровнем: 25% → 33% → 40%,
//     то есть высокий уровень закрепляет не только дольше, но и чаще.
//   • stickerSets — какие наборы стикеров открыты (см. STICKER_SETS в chat.js)
//   • guestsLimit — сколько последних гостей профиля показывать
//
// ВАЖНО: pinMin/pinCooldownMult и пороги min ДУБЛИРУЮТСЯ на сервере в
// vip-balance.sql (функции vip_tier_of и pin_own_message) — сервер не верит
// клиенту. Поменял цифру тут — поменяй и там.
const VIP_TIERS = [
  { key: 'gold',   min: 1500, label: 'GOLD VIP',   rgb: '255,195,40',  icon: '✨', pinMin: 40, pinCooldownMult: 1.5, stickerSets: ['base','silver','gold'], guestsLimit: 100 },
  { key: 'silver', min: 500,  label: 'SILVER VIP', rgb: '200,210,225', icon: '⭐', pinMin: 20, pinCooldownMult: 2,   stickerSets: ['base','silver'],        guestsLimit: 30  },
  { key: 'bronze', min: 0,    label: 'VIP',        rgb: '205,140,60',  icon: '🔸', pinMin: 10, pinCooldownMult: 3,   stickerSets: ['base'],                 guestsLimit: 10  },
];
// Стафф получает перки бесплатно: стикеры и анимацию — как у Gold, гостей — как у Silver.
const STAFF_PIN = { admin: { minutes: 60, cooldownMin: 0 }, moderator: { minutes: 30, cooldownMin: 0 }, helper: { minutes: 15, cooldownMin: 30 } };
const STAFF_ROLES = ['admin', 'moderator', 'helper'];
const isStaffRole = r => STAFF_ROLES.includes(r);

function getVipTier(profile){
  if (!isVipActive(profile)) return null;
  const total = Number(profile?.total_donated) || 0;
  return VIP_TIERS.find(t => total >= t.min) || VIP_TIERS[VIP_TIERS.length - 1];
}
// { minutes, cooldownMin } — сколько держится закреп и пауза до следующего; null — закрепа нет
function getPinPerks(role, profile){
  if (STAFF_PIN[role]) return STAFF_PIN[role];
  const t = getVipTier(profile);
  return t ? { minutes: t.pinMin, cooldownMin: Math.round(t.pinMin * t.pinCooldownMult) } : null;
}
// Есть ли у человека какие-либо платные/стаффовые перки (стикеры, гости, анимация)
function hasPerks(role, profile){ return isStaffRole(role) || isVipActive(profile); }
function allowedStickerSets(role, profile){
  if (isStaffRole(role)) return ['base', 'silver', 'gold'];
  return getVipTier(profile)?.stickerSets || [];
}
function guestsLimitFor(role, profile){
  const t = getVipTier(profile);
  if (t) return t.guestsLimit;
  return isStaffRole(role) ? 30 : 0;
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

  // Гости профиля: чужой профиль — тихо фиксируем визит (не блокируем
  // рендер, ошибка не критична); свой профиль — если VIP, показываем,
  // кто заходил.
  if (!isOwn && currentUser?.id) recordProfileView(targetId);
  if (isOwn) renderProfileGuests(profile);
  renderVipPerksPanel(profile, isOwn);
  if (isOwn) renderVipPromoTiers();
  if (isOwn) renderDonateLoginBlock(profile.donate_login);
  else { const p = document.getElementById('donateLoginPanel'); if (p) p.style.display = 'none'; }
  renderStaffVipPanel(profile, isOwn);

  document.getElementById('profileRoleBadge').innerHTML = ROLE_BADGE_HTML[profile.role] || '';
  {
    const tier = getVipTier(profile);
    const vipBadgeEl = document.getElementById('profileVipBadge');
    vipBadgeEl.style.display = tier ? 'inline-block' : 'none';
    vipBadgeEl.classList.toggle('profile-badge-pop', !!tier);
    if (tier) {
      vipBadgeEl.textContent = tier.key === 'gold' ? '✨ ' + tier.label : tier.key === 'silver' ? '⭐ ' + tier.label : '🔸 ' + tier.label;
      vipBadgeEl.style.background = `linear-gradient(135deg, rgb(${tier.rgb}), rgba(${tier.rgb},.6))`;
    }
    // Напоминание о скором окончании — только себе, чтобы не потерять
    // уровень: без нового доната минимум 100₽ VIP не продлится.
    const expireEl = document.getElementById('profileVipExpireWarn');
    if (expireEl) {
      const daysLeft = (isOwn && tier && profile.vip_until) ? Math.ceil((new Date(profile.vip_until) - Date.now()) / 86400000) : null;
      if (daysLeft !== null && daysLeft <= 7) {
        expireEl.style.display = 'block';
        expireEl.textContent = daysLeft <= 0 ? '⚠️ VIP истекает сегодня — задонать ещё, чтобы не потерять уровень' : `⚠️ VIP закончится через ${daysLeft} ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'} — задонать 100₽+, чтобы продлить`;
      } else {
        expireEl.style.display = 'none';
      }
    }
  }
  document.getElementById('profileBioText').textContent = profile.bio || (isOwn ? 'Расскажи о себе...' : '');
  document.getElementById('profileStatusView').textContent = profile.status_text || '';
  if (typeof renderProfileGamesView === 'function') renderProfileGamesView(profile.favorite_games);
  document.getElementById('profileBanner').style.backgroundImage = profile.banner_url ? `url('${safeImgUrl(profile.banner_url)}')` : '';
  document.getElementById('profileBanner').classList.toggle('profile-banner-empty', !profile.banner_url);
  const avatarEl = document.getElementById('profileAvatarImg');
  if (profile.avatar_url) { avatarEl.style.backgroundImage = `url('${safeImgUrl(profile.avatar_url)}')`; avatarEl.textContent=''; }
  else { avatarEl.style.backgroundImage=''; avatarEl.textContent = (profile.nick||'?').substring(0,2).toUpperCase(); }
  applyProfileGlow(avatarEl, profile);

  renderProfileStats(profile, targetId);

  // Редактирование — только на своём профиле
  document.getElementById('profileBannerEditBtn').style.display = isOwn ? 'flex' : 'none';
  const upHint = document.getElementById('profileUploadHint'); if (upHint) upHint.style.display = isOwn ? 'block' : 'none';
  document.getElementById('profileBannerRemoveBtn').style.display = (isOwn && profile.banner_url) ? 'block' : 'none';
  document.getElementById('profileAvatarEditBtn').style.display = isOwn ? 'flex' : 'none';
  document.getElementById('profileAvatarRemoveBtn').style.display = (isOwn && profile.avatar_url) ? 'block' : 'none';
  document.getElementById('profileNickEditBtn').style.display = isOwn ? 'inline' : 'none';
  document.getElementById('profileBioEditBtn').style.display = isOwn ? 'inline' : 'none';
  document.getElementById('profileStatusEditBtn').style.display = isOwn ? 'inline' : 'none';
  document.getElementById('profileGamesEditBtn').style.display = isOwn ? 'inline' : 'none';
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
      friends: `<button onclick="openDmWith('${targetId}',${jsAttr(profile.nick||'?')})" style="padding:.6rem 1.2rem;border-radius:10px;border:1.5px solid var(--border);background:rgba(255,255,255,.04);color:var(--text);font-size:.82rem;cursor:pointer;font-family:'Montserrat',sans-serif">✉ Написать другу</button>`,
    };
    addFriendWrap.innerHTML = buttons[status] || '';
    addFriendWrap.style.display = 'block';
  } else {
    addFriendWrap.style.display = 'none';
  }
  document.getElementById('profileVipPromo').style.display = (isOwn && !canUseAnimatedAvatar(profile.role, profile)) ? 'block' : 'none';
  const themePanel = document.getElementById('profileThemePanel');
  if (themePanel) {
    themePanel.style.display = (isOwn && isVipActive(profile)) ? 'block' : 'none';
    if (isOwn) renderThemePresets(profile.theme_accent);
  }
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

// Цвет свечения вокруг аватарки: роль важнее VIP (видно, кто модерирует
// сайт, даже если админ/модератор ещё и донатер). Цвета — те же RGB,
// что у .role-badge в CSS, чтобы бейдж и свечение совпадали. Для VIP
// цвет берётся из уровня (VIP_TIERS выше) — золото/серебро/бронза.
const GLOW_RGB = {
  admin: '255,45,85',      // var(--accent)
  moderator: '145,71,255', // var(--tw)
  helper: '34,197,94',     // #22c55e
};
function applyProfileGlow(avatarEl, profile){
  let rgb = null;
  if (profile.role && GLOW_RGB[profile.role]) rgb = GLOW_RGB[profile.role];
  else { const tier = getVipTier(profile); if (tier) rgb = tier.rgb; }

  if (rgb) {
    avatarEl.style.setProperty('--ring-rgb', rgb);
    avatarEl.classList.add('profile-avatar-glow');
  } else {
    avatarEl.classList.remove('profile-avatar-glow');
  }
}

// Статистика профиля: дата регистрации + пара лёгких count-запросов.
// Не трогает донаты/VIP — только новое поле profiles.created_at
// (profile-stats.sql) и уже существующие таблицы friendships/forum_threads.
async function renderProfileStats(profile, targetId){
  const regDateEl = document.getElementById('profileStatRegDate');
  const daysEl = document.getElementById('profileStatDays');
  const friendsEl = document.getElementById('profileStatFriends');
  const threadsEl = document.getElementById('profileStatThreads');
  if (!regDateEl) return;

  if (profile.created_at) {
    const regDate = new Date(profile.created_at);
    regDateEl.textContent = regDate.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
    daysEl.textContent = Math.max(0, Math.floor((Date.now() - regDate.getTime()) / 86400000));
  } else {
    // Значит profile-stats.sql ещё не выполнен на базе — не ломаем страницу
    regDateEl.textContent = '—';
    daysEl.textContent = '—';
  }

  friendsEl.textContent = '…';
  threadsEl.textContent = '…';
  try {
    const [friendsRes, threadsRes] = await Promise.all([
      sbClient.from('friendships')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'accepted')
        .or(`requester_id.eq.${targetId},addressee_id.eq.${targetId}`),
      sbClient.from('forum_threads')
        .select('id', { count: 'exact', head: true })
        .eq('author_id', targetId),
    ]);
    friendsEl.textContent = friendsRes.count ?? '0';
    threadsEl.textContent = threadsRes.count ?? '0';
  } catch(e) {
    friendsEl.textContent = '—';
    threadsEl.textContent = '—';
  }
}

// Свой акцентный цвет интерфейса — только для активных VIP, видно
// только самому пользователю (личная тема, никак не влияет на других).
// Готовые пары цветов, а не произвольный пикер — чтобы не было
// нечитаемых сочетаний. Хранится как "accent,accent2" в profiles.theme_accent.
const THEME_PRESETS = [
  { key: 'default', label: 'Розовый (по умолчанию)', a1: '#ff2d55', a2: '#ff6b35' },
  { key: 'purple',  label: 'Фиолетовый',              a1: '#9147ff', a2: '#c77dff' },
  { key: 'blue',    label: 'Синий',                   a1: '#2979ff', a2: '#29b6f6' },
  { key: 'green',   label: 'Зелёный',                 a1: '#16a34a', a2: '#4ade80' },
  { key: 'gold',    label: 'Золотой',                 a1: '#ffd700', a2: '#ff9500' },
];
function applyThemeAccent(profile){
  if (!profile || !isVipActive(profile) || !profile.theme_accent) {
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.style.removeProperty('--accent2');
    return;
  }
  const [a1, a2] = String(profile.theme_accent).split(',');
  if (a1) document.documentElement.style.setProperty('--accent', a1.trim());
  if (a2) document.documentElement.style.setProperty('--accent2', a2.trim());
}
function renderThemePresets(currentValue){
  const wrap = document.getElementById('profileThemeSwatches');
  if (!wrap) return;
  wrap.innerHTML = THEME_PRESETS.map(p => {
    const active = currentValue === `${p.a1},${p.a2}` || (!currentValue && p.key === 'default');
    return `<button onclick="saveThemeAccent('${p.key === 'default' ? '' : p.a1}','${p.key === 'default' ? '' : p.a2}')" title="${p.label}"
      style="width:34px;height:34px;border-radius:50%;cursor:pointer;background:linear-gradient(135deg,${p.a1},${p.a2});border:2px solid ${active ? '#fff' : 'transparent'};box-shadow:${active ? '0 0 0 2px rgba(255,255,255,.3)' : 'none'}"></button>`;
  }).join('');
}
async function saveThemeAccent(a1, a2){
  if (!currentUser) return;
  const value = (a1 && a2) ? `${a1},${a2}` : null;
  try {
    await sbClient.from('profiles').update({ theme_accent: value }).eq('id', currentUser.id);
    if (currentProfile) currentProfile.theme_accent = value;
    applyThemeAccent(currentProfile || { is_vip: true, vip_until: null, theme_accent: value });
    renderThemePresets(value);
  } catch(e) {
    alert('Не удалось сохранить тему: ' + (e.message || e));
  }
}

// Ник + бейдж роли/VIP + цвет по уровню — используется на форуме (и
// где угодно ещё, где рендерится чужой профиль по join'у profiles).
// Роль важнее VIP: если есть roleBadgeHtml, отдельный VIP-бейдж не
// дублируем — тот же принцип, что и в applyProfileGlow().
function renderNickWithVip(nick, profile, roleBadgeHtml){
  const tier = !roleBadgeHtml ? getVipTier(profile) : null;
  const color = tier ? `color:rgb(${tier.rgb})` : '';
  const vipBadge = tier ? ` <span class="role-badge" style="background:rgba(${tier.rgb},.22);color:rgb(${tier.rgb})">${tier.key==='gold'?'✨':tier.key==='silver'?'⭐':'🔸'} ${tier.key.toUpperCase()}</span>` : '';
  return `<span style="${color}">${esc(nick)}</span>${roleBadgeHtml||''}${vipBadge}`;
}

// Гости профиля — VIP-плюшка. Запись визита делает КАЖДЫЙ залогиненный
// посетитель чужого профиля (не только к VIP), потому что узнать, что
// у тебя есть гости, ты сможешь, только когда сам купишь VIP — так и
// задумано: история визитов не теряется, пока ты не VIP.
async function recordProfileView(viewedId){
  if (!sbClient || !currentUser?.id || currentUser.id === viewedId) return;
  try {
    await sbClient.from('profile_views')
      .upsert([{ viewer_id: currentUser.id, viewed_id: viewedId, viewed_at: new Date().toISOString() }], { onConflict: 'viewer_id,viewed_id' });
  } catch(e) { /* не критично — просто не покажется в списке гостей */ }
}
async function renderProfileGuests(profile){
  const panel = document.getElementById('profileGuestsPanel');
  if (!panel) return;
  const listEl = document.getElementById('profileGuestsList');
  panel.style.display = 'block';

  // Нет перков → не прячем блок совсем, а показываем ЧИСЛО заходивших за 30
  // дней и замок на имена. Число мы и так вправе знать (это записи о визитах
  // на СВОЙ профиль, RLS их отдаёт владельцу), а вот «кто именно» — плюшка.
  if (!hasPerks(profile.role, profile)) {
    listEl.innerHTML = '<div style="font-size:.78rem;color:var(--muted);text-align:center;padding:.5rem 0">Считаем...</div>';
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { count, error } = await sbClient.from('profile_views')
        .select('viewer_id', { count: 'exact', head: true })
        .eq('viewed_id', currentUser.id).gte('viewed_at', since);
      if (error) throw error;
      listEl.innerHTML = count > 0
        ? `<div style="text-align:center;padding:.4rem 0"><div style="font-size:1.6rem;font-weight:800;color:#ffd700">${count}</div>
             <div style="font-size:.78rem;color:var(--muted);margin-bottom:.5rem">${pluralRu(count, 'человек заходил', 'человека заходило', 'человек заходило')} на твой профиль за 30 дней</div>
             <div style="font-size:.72rem;color:var(--muted)">🔒 Кто именно — с VIP</div></div>`
        : '<div style="font-size:.78rem;color:var(--muted);text-align:center;padding:.5rem 0">За 30 дней никто не заходил. Расскажи о себе в «О себе» — и загляни на форум 😉</div>';
    } catch(e) {
      panel.style.display = 'none';
    }
    return;
  }

  const limit = guestsLimitFor(profile.role, profile);
  listEl.innerHTML = '<div style="font-size:.75rem;color:var(--muted);text-align:center;padding:.5rem 0">Загружаем...</div>';
  try {
    const { data, error } = await sbClient
      .from('profile_views')
      .select('viewer_id, viewed_at, profiles!profile_views_viewer_id_fkey(nick, avatar_url)')
      .eq('viewed_id', currentUser.id)
      .order('viewed_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    if (!data || !data.length) {
      listEl.innerHTML = '<div style="font-size:.78rem;color:var(--muted);text-align:center;padding:.5rem 0">Пока никто не заходил</div>';
      return;
    }
    listEl.innerHTML = data.map(v => {
      const nick = v.profiles?.nick || '?';
      const ago = timeAgoRu(v.viewed_at);
      const avatarStyle = v.profiles?.avatar_url ? `background-image:url('${safeImgUrl(v.profiles.avatar_url)}')` : '';
      return `
        <div onclick="openMiniProfile('${v.viewer_id}',${jsAttr(nick)},this)" class="card-fade-in" style="display:flex;align-items:center;gap:.6rem;cursor:pointer;padding:.4rem 0">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--tw) center/cover;flex-shrink:0;${avatarStyle};display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:800;color:#fff">${v.profiles?.avatar_url ? '' : esc(nick.slice(0,2).toUpperCase())}</div>
          <div style="min-width:0;flex:1">
            <div style="font-size:.8rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nick)}</div>
            <div style="font-size:.68rem;color:var(--muted)">${ago}</div>
          </div>
        </div>`;
    }).join('') + `<div style="font-size:.66rem;color:var(--muted);margin-top:.5rem;opacity:.7">Показаны последние ${limit} заходов</div>`;
  } catch(e) {
    listEl.innerHTML = '<div style="font-size:.78rem;color:var(--muted);text-align:center;padding:.5rem 0">Не удалось загрузить</div>';
  }
}
// Склонение: 1 человек / 2-4 человека / 5+ человек
function pluralRu(n, one, few, many){
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function timeAgoRu(iso){
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} ч назад`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} дн назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit' });
}

// Сколько стикеров открыто у уровня (наборы — STICKER_SETS в chat.js)
function stickerCountFor(sets){
  return typeof STICKER_SETS === 'undefined' ? '' : sets.reduce((n, k) => n + (STICKER_SETS[k]?.length || 0), 0);
}
function tierPerkLine(t){
  return `закреп ${t.pinMin} мин (повтор через ${Math.round(t.pinMin * t.pinCooldownMult)}) · стикеров: ${stickerCountFor(t.stickerSets)} · гостей: ${t.guestsLimit}`;
}
// Таблица уровней для не-VIP («что я получу») — генерируется из VIP_TIERS, чтобы
// цифры в тексте никогда не разъезжались с реальными
function renderVipPromoTiers(){
  const box = document.getElementById('vipPromoTiers');
  if (!box) return;
  box.innerHTML = [...VIP_TIERS].reverse().map(t => `
    <div style="display:flex;gap:.5rem;align-items:baseline;padding:.3rem 0;border-top:1px solid rgba(255,255,255,.06)">
      <span style="flex:0 0 5.6rem;font-weight:800;color:rgb(${t.rgb})">${t.icon} ${t.key === 'bronze' ? 'VIP' : t.key === 'silver' ? 'Silver' : 'Gold'}</span>
      <span style="flex:1;font-size:.72rem;color:var(--muted)">${t.min ? 'от ' + t.min + '₽ за всё время — ' : 'с первого месяца — '}${tierPerkLine(t)}</span>
    </div>`).join('');
}
// Панель «мой уровень» у активного VIP: что даёт сейчас и сколько до следующего
function renderVipPerksPanel(profile, isOwn){
  const panel = document.getElementById('profileVipPerksPanel');
  if (!panel) return;
  const tier = getVipTier(profile);
  if (!isOwn || !tier) { panel.style.display = 'none'; return; }
  const total = Number(profile.total_donated) || 0;
  const idx = VIP_TIERS.indexOf(tier);
  const next = idx > 0 ? VIP_TIERS[idx - 1] : null;
  const pct = next ? Math.max(0, Math.min(100, Math.round((total - tier.min) / (next.min - tier.min) * 100))) : 100;
  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="font-size:.68rem;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:.6rem">${tier.icon} Твой уровень</div>
    <div style="font-size:1.05rem;font-weight:800;color:rgb(${tier.rgb});margin-bottom:.5rem">${tier.label}</div>
    <div style="font-size:.76rem;color:var(--muted);line-height:1.7">
      📌 Закреп в чате: <b style="color:var(--text)">${tier.pinMin} мин</b>, повтор через ${Math.round(tier.pinMin * tier.pinCooldownMult)} мин<br>
      🎉 Стикеров: <b style="color:var(--text)">${stickerCountFor(tier.stickerSets)}</b> · 👀 Гостей в списке: <b style="color:var(--text)">${tier.guestsLimit}</b><br>
      ✨ Анимированные аватар и фон, цветной ник, своя тема, форматирование на форуме
    </div>
    ${next ? `
      <div style="background:rgba(255,255,255,.08);border-radius:6px;height:8px;overflow:hidden;margin:.8rem 0 .4rem"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,rgb(${tier.rgb}),rgb(${next.rgb}));border-radius:6px"></div></div>
      <div style="font-size:.72rem;color:var(--muted)">До ${next.icon} ${next.label} ещё <b style="color:var(--text)">${Math.max(0, next.min - total).toFixed(0)}₽</b> донатов — ${tierPerkLine(next)}</div>`
    : '<div style="font-size:.74rem;color:var(--muted);margin-top:.7rem">Максимальный уровень — спасибо, что с нами 💛</div>'}`;
}

// Личная шкала VIP-прогресса — сколько накоплено к следующему месяцу
// (vip_pending_rub из 100₽, см. vip-secure.sql). Видно ТОЛЬКО
// модераторам и выше, и только когда они смотрят чужой профиль — это
// инструмент присмотра за донатами, а не публичная информация.
function renderStaffVipPanel(profile, isOwn){
  const panel = document.getElementById('profileStaffVipPanel');
  if (!panel) return;
  const isStaffViewer = currentRole === 'admin' || currentRole === 'moderator';
  if (isOwn || !isStaffViewer || !profile.is_vip) { panel.style.display = 'none'; return; }

  const pending = Number(profile.vip_pending_rub) || 0;
  const missing = Math.max(0, VIP_RUB_PER_MONTH - pending);
  const pct = Math.min(100, Math.round((pending / VIP_RUB_PER_MONTH) * 100));
  const tier = getVipTier(profile);
  const untilStr = profile.vip_until ? new Date(profile.vip_until).toLocaleDateString('ru-RU') : 'бессрочно';

  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="font-size:.68rem;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:.6rem">🔒 Только для модерации: шкала VIP</div>
    <div style="font-size:.78rem;margin-bottom:.4rem">Уровень: <b>${tier ? tier.label : 'не активен'}</b> · всего задонатил: <b>${(Number(profile.total_donated)||0).toFixed(0)}₽</b></div>
    <div style="font-size:.78rem;margin-bottom:.4rem">До следующего месяца: <b>${pending.toFixed(0)}/${VIP_RUB_PER_MONTH}₽</b>${missing > 0 ? ` (не хватает ${missing.toFixed(0)}₽)` : ' — набрано!'}</div>
    <div style="background:rgba(255,255,255,.08);border-radius:6px;height:8px;overflow:hidden;margin:.5rem 0"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:6px"></div></div>
    <div style="font-size:.72rem;color:var(--muted)">VIP активен до: ${untilStr}</div>`;
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
    // Ник больше не участвует в матчинге доната (см. vip-donate-login.sql)
    // — для этого есть отдельный "логин для доната". Поэтому ник снова
    // свободный, без проверок на уникальность.
    const { error } = await sbClient.from('profiles').update({ nick }).eq('id', currentUser.id);
    if (error) { errEl.textContent = 'Не удалось сохранить: ' + error.message; return; }
    if (currentProfile) currentProfile.nick = nick;
    chatNick = nick;
    try { localStorage.setItem('d37_nick', nick); } catch(e) {}
    document.getElementById('profileNick').textContent = nick;
    toggleNickEdit(false);
  } catch(e) {
    errEl.textContent = 'Не удалось сохранить: ' + (e.message || e);
  }
}

// bucket: 'avatars' | 'profile-bg' — сброс к дефолту (без файла)
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

// ═══════════════════════════════════════
//  ЗАГРУЗКА АВАТАРКИ И ФОНА
// ═══════════════════════════════════════
// Почему фон не грузился: браузерные блокировщики рекламы (AdBlock, uBlock,
// AdGuard, Brave Shields, «Анти-Баннер» Касперского) режут запросы «про
// баннеры». Два переименования бакета (banners → profile-covers → profile-bg)
// не помогли — значит, дело не в слове. Гадать дальше не надо: загрузка теперь
// НЕ ЗАВИСИТ от блокировщика.
//
//  1. Фон идёт по ТОЧНО такому же пути, как аватарка, которая у всех грузится:
//     бакет avatars, папка <uid>, имя начинается с «avatar-» (отдельный бакет
//     profile-bg больше не нужен и SQL для него запускать не надо).
//  2. Картинка перед отправкой пережимается в WebP: PNG-скриншот на 8 МБ
//     превращается в ~300 КБ (раньше «файл больше 5 МБ» → отказ).
//  3. Если Storage всё равно недоступен (сеть режет запрос) — фон сохраняется
//     сжатым (≤140 КБ) прямо в профиль обычным запросом к базе — тем же, что
//     сохраняет ник и «О себе», а он блокировщикам не мешает.
//  4. Если не вышло совсем — человек видит понятную причину, а не «Failed to fetch».
const UPLOAD_MAX_SRC_BYTES = 25 * 1024 * 1024;   // что можно выбрать (сожмём сами)
const UPLOAD_MAX_OUT_BYTES = 5 * 1024 * 1024;    // что реально уходит в Storage
const BANNER_INLINE_MAX_BYTES = 140 * 1024;      // запасной вариант без Storage
const UPLOAD_BLOCK_HINT = '🛡 Загрузке мешает блокировщик рекламы или защита браузера (AdBlock, uBlock, AdGuard, Brave Shields, «Анти-Баннер» Касперского). Отключи его для этого сайта и повтори.';

function isNetworkBlockError(err){
  const m = String(err?.message || err?.originalError?.message || err || '');
  return /failed to fetch|networkerror|load failed|network request failed|err_blocked/i.test(m);
}

function loadImageFile(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать картинку — возможно, файл повреждён')); };
    img.src = url;
  });
}
function blobToDataUrl(blob){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Не удалось прочитать файл'));
    r.readAsDataURL(blob);
  });
}
// Перекодирует в WebP (JPEG — если браузер не умеет кодировать WebP, напр. Safari до 17).
// cropAspect — обрезка по центру до нужного соотношения сторон (ширина/высота).
async function reencodeImage(file, { maxW, maxH, quality, cropAspect }){
  const img = await loadImageFile(file);
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (cropAspect) {
    if (sw / sh > cropAspect) { const nw = sh * cropAspect; sx = (sw - nw) / 2; sw = nw; }
    else { const nh = sw / cropAspect; sy = (sh - nh) / 2; sh = nh; }
  }
  const k = Math.min(1, maxW / sw, maxH / sh);
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const draw = (fill) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    return cv;
  };
  let blob = await new Promise(r => draw().toBlob(r, 'image/webp', quality));
  if (!blob || blob.type !== 'image/webp') {
    // JPEG не хранит прозрачность — заливаем фоном сайта, чтобы не было чёрных дыр
    blob = await new Promise(r => draw('#0f0f18').toBlob(r, 'image/jpeg', quality));
  }
  if (!blob) throw new Error('Не удалось сжать картинку');
  return blob;
}
// Запасной вариант для фона: сжатая картинка (≤140 КБ) как data: URL прямо в профиле
async function bannerAsInlineDataUrl(file){
  for (const [w, q] of [[1200, .8], [960, .7], [720, .6], [560, .5]]) {
    const blob = await reencodeImage(file, { maxW: w, maxH: Math.round(w / 3), quality: q, cropAspect: 3 });
    if (blob.size <= BANNER_INLINE_MAX_BYTES) return blobToDataUrl(blob);
  }
  throw new Error('картинка слишком детальная для облегчённого режима — попробуй другую или отключи блокировщик');
}
// Путь файла внутри бакета avatars из публичного URL (или null)
function avatarsPathFromUrl(url){
  const m = /\/object\/public\/avatars\/([^?]+)/.exec(url || '');
  return m ? decodeURIComponent(m[1]) : null;
}

// bucket: 'avatars' | 'profile-bg' (второе — метка «это фон», физически оба идут в бакет avatars)
async function uploadProfileImage(bucket, file){
  const statusEl = document.getElementById('profileUploadStatus');
  if (!file) return;
  statusEl.style.color = '';
  const isBanner = bucket === 'profile-bg';
  const col = isBanner ? 'banner_url' : 'avatar_url';
  const say = (msg, color) => { statusEl.style.color = color || ''; statusEl.textContent = msg; };
  // input.value = '' — чтобы повторный выбор ТОГО ЖЕ файла снова вызвал onchange
  const resetInput = () => { const i = document.getElementById(isBanner ? 'profileBannerInput' : 'profileAvatarInput'); if (i) i.value = ''; };

  const isGif = file.type === 'image/gif';
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    say('⚠ Только PNG, JPEG, WEBP или GIF'); resetInput(); return;
  }
  if (file.size > UPLOAD_MAX_SRC_BYTES) { say('⚠ Файл больше 25 МБ'); resetInput(); return; }

  let prev = null;
  try {
    const { data } = await sbClient.from('profiles').select('role,is_vip,vip_until,total_donated,avatar_url,banner_url').eq('id', currentUser.id).single();
    prev = data;
  } catch(e) {}
  if (isGif && !hasPerks(prev?.role, prev)) {
    say('✨ Анимированные картинки — только для VIP или команды сайта. Обычное фото (PNG/JPEG/WEBP) можно грузить всем.');
    resetInput(); return;
  }
  if (isGif && file.size > UPLOAD_MAX_OUT_BYTES) { say('⚠ GIF больше 5 МБ — сожми его или выбери другой'); resetInput(); return; }

  say('Готовим картинку...');
  let body = file, ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
  if (!isGif) {
    try {
      const blob = await reencodeImage(file, isBanner
        ? { maxW: 1600, maxH: 900, quality: .85 }
        : { maxW: 512,  maxH: 512, quality: .88 });
      if (blob.size < file.size || file.size > UPLOAD_MAX_OUT_BYTES) { body = blob; ext = blob.type === 'image/webp' ? 'webp' : 'jpg'; }
    } catch(e) {
      if (file.size > UPLOAD_MAX_OUT_BYTES) { say('⚠ ' + (e.message || 'Не удалось сжать картинку')); resetInput(); return; }
      // маленький файл, который не удалось перекодировать — грузим как есть
    }
  }
  if (body.size > UPLOAD_MAX_OUT_BYTES) { say('⚠ Даже после сжатия больше 5 МБ — выбери другую картинку'); resetInput(); return; }

  say('Загружаем...');
  const uid = currentUser.id;
  // Фон: уникальное имя (заодно решает кэш); аватарка: одно имя на пользователя, как и раньше
  const path = isBanner ? `${uid}/avatar-x${Date.now().toString(36)}.${ext}` : `${uid}/avatar.${ext}`;

  let upErr = null;
  try {
    const res = await sbClient.storage.from('avatars').upload(path, body, {
      upsert: !isBanner, cacheControl: '3600', contentType: body.type || file.type
    });
    upErr = res.error;
  } catch(e) { upErr = e; }

  try {
    if (upErr) {
      if (!isNetworkBlockError(upErr)) throw upErr;
      // Запрос к Storage не дошёл (блокировщик/сеть). Для фона есть запасной путь.
      if (!isBanner) { say(UPLOAD_BLOCK_HINT); resetInput(); return; }
      say('Хранилище недоступно — сохраняем облегчённую версию...');
      const dataUrl = await bannerAsInlineDataUrl(file);
      const { error: dbErr } = await sbClient.from('profiles').update({ banner_url: dataUrl }).eq('id', uid);
      if (dbErr) throw dbErr;
      say('✅ Фон сохранён в облегчённом виде: браузер не пустил загрузку в хранилище. Чтобы грузить в полном качестве — отключи блокировщик рекламы для этого сайта.', 'var(--tw)');
      renderProfilePage(uid);
      resetInput();
      return;
    }

    const { data: urlData } = sbClient.storage.from('avatars').getPublicUrl(path);
    // ?t= — чтобы браузер не показывал старую картинку из кэша при замене
    const publicUrl = urlData.publicUrl + '?t=' + Date.now();
    const { error: dbErr } = await sbClient.from('profiles').update({ [col]: publicUrl }).eq('id', uid);
    if (dbErr) throw dbErr;

    // Старый файл больше не нужен — убираем, чтобы Storage не разрастался (не критично, если не выйдет)
    const oldPath = avatarsPathFromUrl(prev?.[col]);
    if (oldPath && oldPath !== path && oldPath.startsWith(uid + '/')) {
      sbClient.storage.from('avatars').remove([oldPath]).catch(() => {});
    }
    say('✅ Обновлено!', 'var(--tw)');
    renderProfilePage(uid);
    setTimeout(() => { if (statusEl && statusEl.textContent === '✅ Обновлено!') statusEl.textContent = ''; }, 2500);
  } catch(e) {
    say(isNetworkBlockError(e) ? UPLOAD_BLOCK_HINT : '⚠ Не получилось: ' + (e.message || e));
  }
  resetInput();
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
  // Вся логика начисления — в SQL-функции credit_donation (server-hardening.sql):
  // она атомарная, повторный вызов с тем же id безопасен, а тот же путь использует и
  // серверная синхронизация api/vip-sync.js. Раньше здесь было «прочитать → посчитать →
  // записать» из браузера: при одновременной работе двух вкладок (или сервера) донат
  // мог начислиться дважды, а ник с символами % и _ работал как маска в ilike.
  try {
    await sbClient.rpc('credit_donation', {
      p_id: d.id, p_username: d.username, p_amount: d.amount, p_currency: d.currency || 'RUB'
    });
  } catch(e) { /* сетевой сбой — донат не отмечен в логе, следующая синхронизация повторит */ }
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

async function saveDonateLogin(){
  if (!currentUser) return;
  const input = document.getElementById('donateLoginInput');
  const errEl = document.getElementById('donateLoginErr');
  const login = input.value.trim();
  errEl.textContent = '';
  if (!login) { errEl.textContent = 'Введи логин'; return; }
  if (login.length > 32) { errEl.textContent = 'Слишком длинный (макс. 32 символа)'; return; }
  try {
    const { error } = await sbClient.from('profiles').update({ donate_login: login }).eq('id', currentUser.id);
    if (error) {
      errEl.textContent = error.code === '23505' || /уже занят/i.test(error.message || '')
        ? `Логин «${login}» уже занят — в том числе кем-то, кто раньше его использовал`
        : 'Не удалось сохранить: ' + error.message;
      return;
    }
    if (currentProfile) currentProfile.donate_login = login;
    renderDonateLoginBlock(login);
  } catch(e) {
    errEl.textContent = 'Не удалось сохранить: ' + (e.message || e);
  }
}
function renderDonateLoginBlock(login){
  const panel = document.getElementById('donateLoginPanel');
  if (panel) panel.style.display = 'block';
  const displayEl = document.getElementById('donateLoginCurrent');
  const editWrap = document.getElementById('donateLoginEditWrap');
  if (!displayEl) return;
  if (login) {
    displayEl.style.display = 'flex';
    document.getElementById('donateLoginValue').textContent = login;
    editWrap.style.display = 'none';
  } else {
    displayEl.style.display = 'none';
    editWrap.style.display = 'flex';
  }
}

function openVipBuyGuide(){
  if (!currentUser) { openGlobalAuth(); return; }
  if (!currentProfile?.donate_login) {
    alert('Сначала укажи логин для доната — он выше, в блоке VIP. Без него донат не поймёт, кому начислять VIP.');
    document.getElementById('donateLoginInput')?.focus();
    return;
  }
  const months = parseInt(document.getElementById('vipBuyMonths').value, 10);
  const amount = months * VIP_RUB_PER_MONTH;
  document.getElementById('vipGuideNick').textContent = currentProfile.donate_login;
  document.getElementById('vipGuideAmount').textContent = amount + '₽';
  document.getElementById('vipBuyModal').style.display = 'flex';
}
function closeVipBuyGuide(){
  document.getElementById('vipBuyModal').style.display = 'none';
}
async function proceedToVipDonate(){
  const login = document.getElementById('vipGuideNick').textContent;
  const amount = document.getElementById('vipGuideAmount').textContent.replace('₽','');
  try { await navigator.clipboard.writeText(login); } catch(e) {
    // Буфер обмена может быть недоступен (напр. без HTTPS или разрешения) —
    // не критично, логин всё равно есть текстом в гайде, можно ввести руками.
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
  document.getElementById('miniProfileStatus').textContent = '';
  document.getElementById('miniProfileGames').innerHTML = '';
  document.getElementById('miniProfileRoleBadge').innerHTML = '';
  document.getElementById('miniProfileAvatar').classList.remove('profile-avatar-glow');
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
    document.getElementById('miniProfileStatus').textContent = p.status_text || '';
    {
      const games = p.favorite_games || [];
      const myGames = new Set((currentProfile?.favorite_games) || []);
      const gamesEl = document.getElementById('miniProfileGames');
      if (games.length) {
        gamesEl.innerHTML = games.map(g => {
          const shared = currentUser && currentUser.id !== userId && myGames.has(g);
          return `<span style="display:inline-block;background:${shared ? 'rgba(34,197,94,.18)' : 'rgba(145,71,255,.15)'};color:${shared ? '#22c55e' : 'var(--tw)'};border-radius:6px;padding:.15rem .5rem;font-size:.66rem;margin:0 .25rem .25rem 0">${shared ? '✓ ' : ''}🎮 ${esc(g)}</span>`;
        }).join('');
      } else {
        gamesEl.innerHTML = '';
      }
    }
    document.getElementById('miniProfileRoleBadge').innerHTML = ROLE_BADGE_HTML[p.role] || '';
    document.getElementById('miniProfileVip').style.display = isVipActive(p) ? 'inline' : 'none';
    if (p.avatar_url) document.getElementById('miniProfileAvatar').style.backgroundImage = `url('${safeImgUrl(p.avatar_url)}')`;
    if (p.banner_url) document.getElementById('miniProfileBanner').style.backgroundImage = `url('${safeImgUrl(p.banner_url)}')`;
    applyProfileGlow(document.getElementById('miniProfileAvatar'), p);

    const actionEl = document.getElementById('miniProfileFriendAction');
    if (currentUser && currentUser.id !== userId) {
      const status = await getFriendshipStatus(userId);
      const small = 'padding:.4rem .8rem;border-radius:8px;font-size:.72rem;cursor:pointer;font-family:\'Montserrat\',sans-serif;border:none;width:100%';
      const buttons = {
        none: `<button onclick="sendFriendRequest('${userId}')" style="${small};background:var(--tw);color:#fff">➕ В друзья</button>`,
        pending_sent: `<span style="font-size:.72rem;color:var(--muted)">⏳ Заявка отправлена</span>`,
        pending_received: `<button onclick="acceptFriendRequest('${userId}')" style="${small};background:var(--accent);color:#fff">✅ Принять заявку</button>`,
        friends: `<button onclick="openDmWith('${userId}',${jsAttr(p.nick||fallbackNick)})" style="${small};background:rgba(255,255,255,.1);color:var(--text)">✉ Написать</button>`,
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
