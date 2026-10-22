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

// Стример может показывать профиль на стриме — почта по умолчанию скрыта
// ПОЛНОСТЬЮ (даже первые буквы и домен помогают угадать адрес).
// Показать целиком — кнопкой 👁.
function maskEmail(email){
  return '•••••••• (скрыта)';
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
  return role === 'admin' || role === 'moderator' || role === 'helper' || isVipActive(profile) || donorLevelOf(profile) > 0;
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
  // profiles_public (progression.sql) отдаёт готовый уровень — с учётом VIP за уровень
  if (profile && profile.vip_tier !== undefined) return VIP_TIERS.find(t => t.key === profile.vip_tier) || null;
  if (!isVipActive(profile)) return null;
  const total = Number(profile?.total_donated) || 0;
  return VIP_TIERS.find(t => total >= t.min) || VIP_TIERS[VIP_TIERS.length - 1];
}
// { minutes, cooldownMin } — сколько держится закреп и пауза до следующего; null — закрепа нет
function getPinPerks(role, profile){
  if (STAFF_PIN[role]) return STAFF_PIN[role];
  const t = getPerkTier(profile);
  return t ? { minutes: t.pinMin, cooldownMin: Math.round(t.pinMin * t.pinCooldownMult) } : null;
}
// «💛 Донатер» (js/core/premium.js D37Donor, premium.sql): уровень за донаты последних 30 дней, 0 — нет. Свой — из donor_me,
// чужие — из кэша значков (D37Donor.badges). Бонусы — как у VIP того же ранга; у кого обе ветки — по лучшей (как на сервере perk_tier_of)
function donorLevelOf(profile){ try { return (profile?.id && window.D37Donor?.levelOf(profile.id)) || 0; } catch (e) { return 0; } }
function getPerkTier(profile){
  const v = getVipTier(profile), dl = donorLevelOf(profile);
  const d = dl ? VIP_TIERS.find(t => t.key === window.D37Donor.perkOf(dl)) : null;
  if (!d) return v;
  return !v || VIP_TIERS.indexOf(d) < VIP_TIERS.indexOf(v) ? d : v;
}
// Что показать у ника: лучшая ветка с её подписью — { kind: 'donor' | 'vip', tier, label, rgb, icon, until }; при равенстве — донатер
function statusOf(profile){
  const v = getVipTier(profile), dl = donorLevelOf(profile), D = window.D37Donor;
  const d = dl ? VIP_TIERS.find(t => t.key === D.perkOf(dl)) : null;
  if (d && (!v || VIP_TIERS.indexOf(d) <= VIP_TIERS.indexOf(v))) return { kind: 'donor', lv: dl, tier: d, label: D.label(dl), rgb: D.rgb(dl), icon: '💛', until: D.untilOf(profile.id) };
  return v ? { kind: 'vip', tier: v, label: v.label, rgb: v.rgb, icon: v.icon, until: profile?.vip_until || null } : null;
}
// Есть ли у человека бонусы (стикеры, гости, анимация, тема): персонал, VIP или донатер
function hasPerks(role, profile){ return isStaffRole(role) || isVipActive(profile) || donorLevelOf(profile) > 0; }
function allowedStickerSets(role, profile){
  if (isStaffRole(role)) return ['base', 'silver', 'gold'];
  return getPerkTier(profile)?.stickerSets || [];
}
function guestsLimitFor(role, profile){
  const t = getPerkTier(profile);
  if (t) return t.guestsLimit;
  return isStaffRole(role) ? 30 : 0;
}

// Персонаж из гардероба (js/core/avatar.js) — стоит рядом с аватаркой. Свой — всегда (ведёт в гардероб),
// чужой — если он его собрал (char_looks в coins.sql; до запуска SQL чужих не видно)
async function renderProfileChar(uid, isOwn){
  const holder = document.getElementById('profileAvatarImg')?.parentElement;
  if (!holder || !window.D37Char) return;
  let el = document.getElementById('profileChar');
  if (!el) { el = document.createElement('a'); el.id = 'profileChar'; el.className = 'pf-char'; el.innerHTML = '<img alt="Персонаж">'; holder.appendChild(el); }
  el.hidden = true;
  let look = null;
  if (isOwn) look = D37Char.look();
  else { const m = await D37Char.looksOf([uid]); look = m[uid] || null; }
  if (!look || document.getElementById('profileChar') !== el) return;
  el.querySelector('img').src = D37Char.img(look, 96);
  el.href = isOwn ? '#/games/wardrobe' : '#/games/wardrobe';
  el.title = isOwn ? 'Мой персонаж — открыть гардероб' : 'Персонаж игрока — собери своего в гардеробе';
  el.hidden = false;
}

// ═══ Профиль 2.0 (T-086; UI_V2 в js/core/config.js → html.ui2, стили — css/ui2.css) ═══
// Те же данные, другая раскладка: шапка (фон, аватар с рамкой, персонаж, ник и значки, уровень, быстрые числа, кнопки дружбы),
// дальше две колонки на компьютере (главное слева, свои панели справа) и одна на телефоне. Карточки двигаются в колонки ОДИН раз
// (pf2Layout) — id и обработчики те же; без UI_V2 разметка не трогается (профиль как раньше).
const PF2_MAIN = ['profileHiddenNote', 'profileAboutCard', 'profileGamesCard', 'pf2Showcase', 'profileGameStatsCard', 'profileAchievementsCard', 'profileXpCard', 'profileQuestsCard'];
const PF2_SIDE = ['profileFriendsPanel', 'profileStatsRow', 'profileReferralPanel', 'profileGuestsPanel', 'donateLoginPanel', 'profileVipPerksPanel', 'profileVipPromo', 'profileThemePanel', 'profileStaffVipPanel', 'profileStaffPanel', 'profileAdminPanel', 'profileAccountSettings'];
const pf2On = () => document.documentElement.classList.contains('ui2');
function pf2Layout(){
  const box = document.getElementById('profileContent');
  if (!pf2On() || !box || box.querySelector(':scope > .pf2-cols')) return;
  const head = box.querySelector('.pf-head'), fw = document.getElementById('profileAddFriendWrap');
  if (head && fw) head.appendChild(fw);
  const cols = document.createElement('div'); cols.className = 'pf2-cols';
  const main = document.createElement('div'); main.className = 'pf2-main';
  const side = document.createElement('div'); side.className = 'pf2-side';
  for (const id of PF2_MAIN) { const el = document.getElementById(id); if (el) main.appendChild(el); }
  for (const id of PF2_SIDE) { const el = document.getElementById(id); if (el) side.appendChild(el); }
  cols.append(main, side);
  const after = document.getElementById('profileUploadHint') || head;
  after.after(cols);
}
const pf2Set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
function pf2Reset(isOwn){
  document.getElementById('profileContent')?.classList.toggle('pf2-other', !isOwn);
  for (const id of ['pf2Streak', 'pf2Xp', 'pf2Games', 'pf2Ach']) pf2Set(id, '—');
  const lv = document.getElementById('pf2Lv'); if (lv) lv.hidden = true;
  const sh = document.getElementById('pf2Showcase'); if (sh) sh.hidden = true;
}
const pf2Num = n => { n = +n || 0; return n >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace('.', ',') + 'K' : n.toLocaleString('ru-RU'); };
// уровень и опыт: те же числа, что карточка «Уровень» (xp_summary → renderProfileXp)
function pf2Xp(uid, d){
  if (profileViewedId !== uid || !d) return;
  pf2Set('pf2Xp', pf2Num(d.xp));
  const span = Math.max(d.level_to - d.level_from, 1), pct = Math.min(100, Math.max(0, (d.xp - d.level_from) / span * 100));
  const lv = document.getElementById('pf2Lv'); if (!lv) return;
  pf2Set('pf2LvN', 'Lv ' + d.level);
  document.getElementById('pf2LvN').className = (typeof xpTierClass === 'function' ? xpTierClass(d.level) : '').trim();
  document.getElementById('pf2LvBar').style.width = pct.toFixed(1) + '%';
  pf2Set('pf2LvT', `${pf2Num(d.xp)} XP · до ${d.level + 1} ур. ещё ${pf2Num(Math.max(0, d.level_to - d.xp))}`);
  lv.hidden = false;
}
// серия, число ачивок и витрина (лучшие полученные: особые, потом по XP) — из ответа renderAchievements
function pf2Ach(uid, r){
  if (profileViewedId !== uid || !r) return;
  if (r.streak != null) pf2Set('pf2Streak', pf2Num(r.streak));
  const earned = r.earned instanceof Set ? r.earned : new Set(r.earned || []);
  if (typeof ACHIEVEMENT_DEFS === 'undefined') return;
  const got = ACHIEVEMENT_DEFS.filter(d => earned.has(d.code));
  pf2Set('pf2Ach', String(got.filter(d => !d.special).length));
  const vipTop = Math.max(0, ...got.filter(d => d.vip).map(d => d.vip));
  const best = got.filter(d => !d.vip || d.vip === vipTop).sort((a, b) => (b.special ? 1 : 0) - (a.special ? 1 : 0) || (b.xp || 0) - (a.xp || 0)).slice(0, 6);
  const box = document.getElementById('pf2Showcase'), grid = document.getElementById('pf2ShowGrid');
  if (!box || !grid) return;
  grid.innerHTML = best.map(d => `<div class="pf2-sh" title="${esc(d.title + ' — ' + d.desc)}"><span>${d.icon}</span><b>${esc(d.title)}</b>${d.xp ? `<small>+${d.xp} XP</small>` : ''}</div>`).join('');
  box.hidden = !best.length;
}
// партии — то же число, что в «Играх на сайте» (game_stats → renderProfileGameStats)
function pf2Games(uid){
  if (profileViewedId !== uid) return;
  const m = /^(\d[\d\s]*)/.exec(document.getElementById('profileGameStatsSum')?.textContent || '');
  pf2Set('pf2Games', m ? pf2Num(m[1].replace(/\s/g, '')) : document.getElementById('profileGameStatsCard')?.hidden === false ? '0' : '—');
}

async function renderProfilePage(viewUserId){
  const loggedOutEl = document.getElementById('profileLoggedOut');
  const contentEl = document.getElementById('profileContent');
  // #/profile/invites — «👥 Мои приглашения» (страница #/invite, js/features/invite.js)
  if (viewUserId === 'invites') { D37Route.go('#/invite', { replace: true }); return; }
  // #/profile/vip — свой профиль сразу на блоках «Логин для доната» и «Хочу купить VIP» (кнопка со страницы /vip)
  const focusVip = viewUserId === 'vip';
  if (focusVip) viewUserId = null;
  // #/profile/logins — свой профиль сразу на «Способах входа» (js/features/social-login.js; туда возвращает привязка входа)
  const focusLogins = viewUserId === 'logins';
  if (focusLogins) viewUserId = null;
  const loHint = loggedOutEl?.querySelector('p');
  if (loHint) loHint.textContent = focusVip ? 'VIP привязывается к аккаунту — войди или зарегистрируйся, и откроется, как его получить' : 'Чтобы завести профиль — войди или зарегистрируйся';

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
  pf2Layout();
  pf2Reset(isOwn);

  let profile, loadErr = null;
  try {
    const { data, error } = await (await sbProfiles()).select('*').eq('id', targetId).single();
    profile = data; loadErr = error;
  } catch(e) { profile = null; loadErr = e; }
  // Раньше здесь затирался весь contentEl.innerHTML — пропадали #profileNick и остальные блоки, и после одного
  // «не найден» ни один профиль не открывался до перезагрузки страницы. Теперь — отдельная плашка поверх.
  let nf = document.getElementById('profileNotFound');
  if (!profile) {
    if (!nf) { nf = document.createElement('div'); nf.id = 'profileNotFound'; nf.className = 'profile-not-found'; contentEl.before(nf); }
    // PGRST116 — такой строки нет, 22P02 — в ссылке не id; остальное — сеть/сервер
    const missing = !loadErr || ['PGRST116', '22P02'].includes(loadErr.code);
    const safeId = String(targetId).replace(/[^0-9a-f-]/gi, '');
    nf.innerHTML = missing
      ? '<div class="pnf-ico">👤</div><b>Профиль не найден</b><p>Аккаунт удалён или в ссылке ошибка.</p><a href="#/home" class="pf-btn pf-btn-sm" onclick="if(history.length>1){event.preventDefault();history.back()}">← Назад</a>'
      : `<div class="pnf-ico">📡</div><b>Не удалось загрузить профиль</b><p>Проверь интернет и попробуй ещё раз.</p><button class="pf-btn pf-btn-sm" onclick="renderProfilePage('${safeId}')">↻ Повторить</button>`;
    nf.style.display = 'block';
    contentEl.style.display = 'none';
    return;
  }
  if (nf) nf.style.display = 'none';
  // Ник по умолчанию (user_<id> — так база называет новые аккаунты, например после входа через Google) — предложить свой
  let np = document.getElementById('profileNickPrompt');
  const defaultNick = isOwn && /^user_[0-9a-f]{6,32}$/.test(profile.nick || '');
  if (defaultNick && !np) { np = document.createElement('div'); np.id = 'profileNickPrompt'; np.className = 'pf-nick-prompt'; contentEl.prepend(np); }
  if (np) {
    np.hidden = !defaultNick;
    if (defaultNick) np.innerHTML = '<span>👋 Придумай ник — так тебя увидят в чате, играх и рекордах. Сейчас ты «' + esc(String(profile.nick).slice(0, 12)) + '…»</span><button type="button" class="pf-btn pf-btn-primary pf-btn-sm" onclick="toggleNickEdit(true);var i=document.getElementById(\'profileNickInput\');i.value=\'\';i.focus()">✏️ Придумать ник</button>';
  }

  document.getElementById('profileNick').textContent = profile.nick || 'Без ника';
  window.d37NickFx?.markEl(document.getElementById('profileNick'), targetId);
  renderProfileChar(targetId, isOwn);
  // служебная почта аккаунта из VK / Яндекса / Telegram (…@id.invalid) — не настоящая, не показываем
  profileEmailRaw = isOwn && !window.D37Login?.isSynthetic?.(currentUser) ? (currentUser?.email || '') : '';
  profileEmailVisible = false;
  document.getElementById('profileEmailToggle').style.display = (isOwn && profileEmailRaw) ? 'inline' : 'none';
  renderProfileEmailMask();

  // Гости профиля: чужой профиль — тихо фиксируем визит (не блокируем
  // рендер, ошибка не критична); свой профиль — если VIP, показываем,
  // кто заходил.
  if (!isOwn && currentUser?.id) recordProfileView(targetId);
  if (isOwn) renderProfileGuests(profile);
  renderVipPerksPanel(profile, isOwn);
  if (isOwn) renderVipPromo();
  if (isOwn) { renderDonateLoginBlock(profile.donate_login); renderProfileGems(); if (typeof renderDonationClaimBox === 'function') renderDonationClaimBox(); }
  else { const p = document.getElementById('donateLoginPanel'); if (p) p.style.display = 'none'; }
  renderStaffVipPanel(profile, isOwn);

  document.getElementById('profileRoleBadge').innerHTML = ROLE_BADGE_HTML[profile.role] || '';
  // модераторам на чужом профиле — «связанные входы» (какие сервисы и сколько, без номеров и почты; social-login.js)
  if (window.D37Login) window.D37Login.staffNote(isOwn ? null : targetId).catch(() => {});
  {
    // Статус у ника — лучшая ветка: «💛 Донатер N» (донаты за 30 дней) или VIP (за уровень / 💎)
    if (window.D37Donor) await D37Donor.badges([targetId]).catch(() => {});
    if (profileViewedId !== targetId) return;
    const stat = statusOf(profile), tier = stat?.tier;
    const vipBadgeEl = document.getElementById('profileVipBadge');
    vipBadgeEl.style.display = stat ? 'inline-block' : 'none';
    vipBadgeEl.classList.toggle('profile-badge-pop', !!stat);
    if (stat) {
      vipBadgeEl.textContent = stat.kind === 'donor' ? `${stat.label}${stat.until ? ' · ' + D37Donor.untilText(stat.until) : ''}`
        : tier.key === 'gold' ? '✨ ' + tier.label : tier.key === 'silver' ? '⭐ ' + tier.label : '🔸 ' + tier.label;
      vipBadgeEl.title = stat.kind === 'donor' ? 'Статус за поддержку стрима: бонусы как у ' + tier.label : '';
      vipBadgeEl.style.background = `linear-gradient(135deg, rgb(${stat.rgb}), rgba(${stat.rgb},.6))`;
    }
    // Напоминание о скором окончании VIP — только себе. Донатом VIP больше не продлевается (премиум.sql, 22.10): только за 💎
    const expireEl = document.getElementById('profileVipExpireWarn');
    if (expireEl) {
      const vt = getVipTier(profile);
      const daysLeft = (isOwn && vt && profile.vip_until) ? Math.ceil((new Date(profile.vip_until) - Date.now()) / 86400000) : null;
      if (daysLeft !== null && daysLeft <= 7) {
        expireEl.style.display = 'block';
        expireEl.textContent = daysLeft <= 0 ? '⚠️ VIP истекает сегодня — продлить можно за 💎 в магазине' : `⚠️ VIP закончится через ${daysLeft} ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'} — продлить можно за 💎 в магазине`;
      } else {
        expireEl.style.display = 'none';
      }
    }
  }
  const hidden = !isOwn && !!profile.profile_hidden;
  renderProfileHiddenNote(profile, hidden);
  document.getElementById('profileAboutCard').style.display = (hidden || (!isOwn && !String(profile.bio || '').trim())) ? 'none' : '';
  document.getElementById('profileGamesCard').style.display = hidden ? 'none' : '';
  document.getElementById('profileAchievementsCard').style.display = hidden ? 'none' : '';
  // Статистику на скрытом профиле видит только персонал (служебный просмотр)
  document.getElementById('profileStatsRow').style.display = (hidden && !profile.staff_view) ? 'none' : 'grid';
  document.getElementById('profileBioText').textContent = profile.bio || (isOwn ? 'Расскажи о себе...' : '');
  document.getElementById('profileStatusView').textContent = profile.status_text || '';
  if (typeof renderProfileGamesView === 'function') renderProfileGamesView(profile.favorite_games);
  document.getElementById('profileBanner').style.backgroundImage = profile.banner_url ? `url('${safeImgUrl(profile.banner_url)}')` : '';
  document.getElementById('profileBanner').classList.toggle('profile-banner-empty', !profile.banner_url);
  const avatarEl = document.getElementById('profileAvatarImg');
  if (profile.avatar_url) { avatarEl.style.backgroundImage = `url('${safeImgUrl(profile.avatar_url)}')`; avatarEl.textContent=''; }
  else { avatarEl.style.backgroundImage=''; avatarEl.textContent = (profile.nick||'?').substring(0,2).toUpperCase(); }
  applyProfileGlow(avatarEl, profile);
  if (typeof applyLevelFrame === 'function') applyLevelFrame(avatarEl, targetId);
  if (typeof renderProfileTitle === 'function') renderProfileTitle(targetId);

  if (!hidden || profile.staff_view) renderProfileStats(profile, targetId);
  renderReferralPanel(profile, isOwn);
  if (!hidden && typeof renderAchievements === 'function') Promise.resolve(renderAchievements(targetId, isOwn)).then(r => pf2Ach(targetId, r)).catch(() => {});
  if (typeof renderProfileGameStats === 'function') Promise.resolve(renderProfileGameStats(hidden ? null : targetId, isOwn)).then(() => pf2Games(targetId)).catch(() => {});
  if (typeof renderProfileQuests === 'function') renderProfileQuests(targetId, isOwn);   // сезон и задания недели (свой профиль)
  if (hidden) document.getElementById('profileXpCard').hidden = true;
  else if (typeof renderProfileXp === 'function') Promise.resolve(renderProfileXp(targetId, isOwn)).then(d => pf2Xp(targetId, d)).catch(() => {});
  document.querySelector('#profileContent .pf-head')?.classList.toggle('pf2-hid', hidden);
  if (isOwn) renderPrivacySettings(profile);
  if (isOwn && window.D37Login) window.D37Login.renderMethods().then(() => {   // «Способы входа»
    if (focusLogins) { const el = document.getElementById('profileLogins'); if (el && !el.hidden) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }).catch(e => console.warn('способы входа:', e));

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
    if (profileViewedId !== targetId) return;
    const note = t => `<span class="pf-fnote">${esc(t)}</span>`;
    const buttons = {
      none: `<button type="button" class="pf-btn pf-btn-tw" onclick="sendFriendRequest('${targetId}')">➕ Добавить в друзья</button>`,
      pending_sent: note('⏳ Заявка отправлена'),
      pending_received: `<button type="button" class="pf-btn pf-btn-primary" onclick="acceptFriendRequest('${targetId}')">✅ Принять заявку в друзья</button>`,
      friends: `<button type="button" class="pf-btn pf-btn-ghost" onclick="openDmWith('${targetId}',${jsAttr(profile.nick||'?')})">✉ Написать другу</button>`,
    };
    if (status === 'none' && profile.accepts_friend_requests === false) {
      buttons.none = note('🚫 Не принимает заявки в друзья');
    } else if (status === 'none') {
      const why = (await window.D37Age?.friendBlock?.(targetId)) ? D37Age.kidMsg('agefriend') : await friendBlockReason();
      if (why) buttons.none = note(why);
    } else if (status === 'friends' || status === 'pending_received') {
      // ребёнку до 13 со взрослым / до 9 — личные каналы закрыты (сервер не пропустит; дружба остаётся)
      const kb = status === 'friends' ? await window.D37Age?.contact?.(targetId) : await window.D37Age?.friendBlock?.(targetId);
      if (kb) buttons[status] = note(D37Age.kidMsg(status === 'friends' ? kb : 'agefriend'));
    }
    if (profileViewedId !== targetId) return;
    // «⋯» — общая мини-карточка: звонок, «📍 К нему», блокировка, модерация (те же правила, js/features/minicard.js)
    const more = window.D37Mini ? `<button type="button" class="pf-btn pf-btn-ghost pf-more" data-mini-uid="${esc(targetId)}" data-mini-nick="${esc(profile.nick || '')}" title="Ещё: позвонить, к нему в игру, заблокировать" aria-label="Ещё действия">⋯</button>` : '';
    addFriendWrap.innerHTML = (buttons[status] || '') + more;
    addFriendWrap.style.display = '';
  } else {
    addFriendWrap.style.display = 'none';
  }
  document.getElementById('profileVipPromo').style.display = (isOwn && !canUseAnimatedAvatar(profile.role, profile)) ? 'block' : 'none';
  const themePanel = document.getElementById('profileThemePanel');
  if (themePanel) {
    themePanel.style.display = (isOwn && (isVipActive(profile) || donorLevelOf(profile) > 0)) ? 'block' : 'none';
    if (isOwn) renderThemePresets(profile.theme_accent);
  }
  document.getElementById('profileAdminPanel').style.display = (isOwn && profile.role === 'admin') ? 'block' : 'none';
  if (isOwn && profile.role === 'admin' && typeof renderAdminDonationClaims === 'function') renderAdminDonationClaims();
  if (isOwn && profile.role === 'admin') renderAdminCloudLine();

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
  if (focusVip && isOwn) setTimeout(() => {
    const blocks = ['donateLoginPanel', 'profileVipPromo'].map(id => document.getElementById(id)).filter(el => el && el.style.display !== 'none');
    if (!blocks.length) return;
    blocks[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
    blocks.forEach(el => { el.classList.add('pf-focus'); setTimeout(() => el.classList.remove('pf-focus'), 2600); });
  }, 350);
}

// Логин для доната — в буфер (его вписывают в поле «Ваше имя» на DonationAlerts)
async function copyDonateLogin(btn){
  const v = currentProfile?.donate_login || document.getElementById('donateLoginValue')?.textContent || '';
  if (!v) return;
  try { await navigator.clipboard.writeText(v); }
  catch (e) { const t = document.createElement('textarea'); t.value = v; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e2) {} t.remove(); }
  const old = btn.textContent; btn.textContent = '✅ Скопировано'; setTimeout(() => { btn.textContent = old; }, 1600);
}

// Что даёт донат сейчас (premium.sql, выключатель site_config 'donate_rewards'): 'off' — статус «💛 Донатер» (по умолчанию),
// 'vip' / 'gems' — как до 22.10. premium.sql (22.10) ещё не применён на базе — сервер по-старому даёт VIP: 'vip'
function donateMode(){
  const D = window.D37Donor, S = window.D37Gems?.state?.();
  if (D && D.ready() === false) return 'vip';                  // donor_me нет — сервер по-старому даёт VIP за донат
  if (D?.me?.()?.mode) return D.me().mode;
  if (S && S.ready === true) return S.donate_rewards || 'vip';  // premium_state без donate_rewards — тоже старый premium.sql
  return 'off';
}
// Уровни донатера одной строкой: «I — от 100 ₽ · II — от 300 ₽ …»
function donorLevelsLine(){
  const D = window.D37Donor;
  return D ? D.LEVELS.map(l => `${D.roman(l.lv)} — от ${l.min} ₽`).join(' · ') : '';
}

// Плашка на странице #/donate: что даёт донат (честно) и свой логин для доната с кнопкой «Скопировать».
// Без логина донат не находит владельца — статус не засчитается, и человек пишет заявку «задонатил — не засчиталось».
function renderDonateVipHint(){
  const txt = document.getElementById('donateVipText'), act = document.getElementById('donateVipAct'), title = document.getElementById('donateVipTitle');
  if (!txt || !act) return;
  const D = window.D37Donor;
  if (D && D.ready() === null && !renderDonateVipHint._wait) {
    renderDonateVipHint._wait = D.sync().then(() => { renderDonateVipHint._wait = null; if (document.body.dataset.route === 'donate') renderDonateVipHint(); });
  }
  const login = currentUser && currentProfile?.donate_login;
  const mode = donateMode();
  if (mode !== 'off') {
    if (title) title.textContent = 'VIP за донат — 100 ₽ = месяц';
    const more = '<a class="dv-btn ghost" href="/vip">Что даёт VIP</a><a class="dv-btn ghost" href="#/shop">💎 Магазин</a>';
    const gems = mode === 'gems' || (!!window.D37Gems?.isOn() && D37Gems.state().mode === 'gems');
    if (login) {
      txt.innerHTML = `Впиши <b class="dv-login">${esc(login)}</b> в поле «Ваше имя» на DonationAlerts — ${gems ? 'придут кристаллы 💎 (VIP за них — в магазине)' : 'VIP включится сам'}.`;
      act.innerHTML = '<button type="button" class="dv-btn" onclick="copyDonateLogin(this)">📋 Скопировать логин</button>' + more;
    } else if (currentUser) {
      txt.innerHTML = 'Сначала придумай <b>логин для доната</b> в профиле (один раз), потом впиши его в поле «Ваше имя» на DonationAlerts.';
      act.innerHTML = '<a class="dv-btn" href="#/profile/vip">🔑 Задать логин</a>' + more;
    } else {
      txt.innerHTML = 'Донат привязывается к аккаунту: заведи профиль, задай <b>логин для доната</b> и впиши его в поле «Ваше имя» на DonationAlerts.';
      act.innerHTML = '<button type="button" class="dv-btn" onclick="openGlobalAuth(\'register\')">Создать профиль</button>' + more;
    }
    return;
  }
  const days = D?.RULES?.days || 30;
  if (title) title.textContent = '💛 Донатер — статус за поддержку стрима, с бонусами';
  const more = '<a class="dv-btn ghost" href="/vip">Что даёт статус</a>';
  const lead = `Донат — это поддержка стрима, а не покупка. Взамен — спасибо и статус <b>«💛 Донатер»</b> на ${days} дней с бонусами как у VIP (${esc(donorLevelsLine())} за ${days} дней).`;
  if (login) {
    txt.innerHTML = `${lead} Чтобы донат засчитался тебе, впиши <b class="dv-login">${esc(login)}</b> в поле «Ваше имя» на DonationAlerts.`;
    act.innerHTML = '<button type="button" class="dv-btn" onclick="copyDonateLogin(this)">📋 Скопировать логин</button>' + more;
  } else if (currentUser) {
    txt.innerHTML = `${lead} Чтобы донат засчитался тебе, сначала придумай <b>логин для доната</b> в профиле (один раз) — засчитываются донаты, сделанные после этого.`;
    act.innerHTML = '<a class="dv-btn" href="#/profile/vip">🔑 Задать логин</a>' + more;
  } else {
    txt.innerHTML = `${lead} Статус привязывается к аккаунту: заведи профиль и задай <b>логин для доната</b> — засчитываются донаты, сделанные после этого.`;
    act.innerHTML = '<button type="button" class="dv-btn" onclick="openGlobalAuth(\'register\')">Создать профиль</button>' + more;
  }
}
window.addEventListener('d37:auth', () => { if (document.body.dataset.route === 'donate') renderDonateVipHint(); });
// Свой статус «💛 Донатер» пришёл (js/core/premium.js, после входа или нового доната) — тема, плашка доната, свой профиль
let donorShownLv = null;
window.addEventListener('d37:donor', e => {
  const lv = e?.detail?.level || 0;
  if (currentProfile) applyThemeAccent(currentProfile);
  const r = document.body.dataset.route;
  if (r === 'donate') renderDonateVipHint();
  if (r === 'profile' && currentUser && profileViewedId === currentUser.id && donorShownLv !== null && donorShownLv !== lv) renderProfilePage();
  donorShownLv = lv;
});

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
  else { const st = statusOf(profile); if (st) rgb = st.rgb; }

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
  const referralsEl = document.getElementById('profileStatReferrals');
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
  if (referralsEl) referralsEl.textContent = '…';
  try {
    const [friendsRes, threadsRes, referralsRes] = await Promise.all([
      sbClient.from('friendships')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'accepted')
        .or(`requester_id.eq.${targetId},addressee_id.eq.${targetId}`),
      sbClient.from('forum_threads')
        .select('id', { count: 'exact', head: true })
        .eq('author_id', targetId),
      // Отдельный слот статистики, не путать с друзьями (friendships) —
      // это две разные вещи, см. referrals.sql. RPC — функция referral_count(uid)
      // из той же миграции; если она ещё не выполнена на базе, просто '—'.
      sbClient.rpc('referral_count', { uid: targetId }),
    ]);
    friendsEl.textContent = friendsRes.count ?? '0';
    threadsEl.textContent = threadsRes.count ?? '0';
    if (referralsEl) referralsEl.textContent = (referralsRes.error ? '—' : (referralsRes.data ?? 0));
  } catch(e) {
    friendsEl.textContent = '—';
    threadsEl.textContent = '—';
    if (referralsEl) referralsEl.textContent = '—';
  }
}

// ═══════════════════════════════════════
//  ПРИВАТНОСТЬ (privacy.sql) — прятать данные обязана база (profiles_public),
//  здесь только показ и настройки
// ═══════════════════════════════════════
// Почему я не могу отправить заявку (null — могу). Как в Steam: с 5 уровня,
// за 5 приглашённых друзей или после доната; плюс лимит друзей (progression.sql)
let myFriendStatusCache = null;
async function myFriendStatus(force){
  if (!currentUser) return null;
  if (myFriendStatusCache && !force && Date.now() - myFriendStatusCache.at < 60000) return myFriendStatusCache.data;
  const { data, error } = await sbClient.rpc('my_friend_status');
  if (error) return null;   // progression.sql ещё не выполнен — ограничений нет
  myFriendStatusCache = { at: Date.now(), data };
  return data;
}
async function friendBlockReason(){
  const st = await myFriendStatus();
  if (!st) return null;
  if (!st.can_add) return `🔒 Заявки в друзья — с 5 уровня (у тебя ${st.level}), за 5 приглашённых друзей или после доната`;
  if (st.limit != null && st.count >= st.limit) return `👥 У тебя максимум друзей (${st.limit}). Лимит растёт с уровнем и VIP`;
  return null;
}

function renderProfileHiddenNote(profile, hidden){
  const el = document.getElementById('profileHiddenNote');
  if (!el) return;
  if (!hidden) { el.style.display = 'none'; return; }
  const friendsOnly = profile.profile_visibility === 'friends';
  let sub = '';
  if (profile.staff_view) sub = '🛡 Служебный просмотр: вам как модератору видны только дата регистрации, роль и VIP';
  else if (friendsOnly && currentUser && profile.accepts_friend_requests !== false) sub = 'Добавь в друзья, чтобы увидеть больше';
  el.innerHTML = `<div style="font-size:1.6rem">🔒</div>
    <div style="font-weight:800;margin-top:.3rem">${friendsOnly ? 'Профиль видят только друзья' : 'Пользователь скрыл профиль'}</div>
    ${sub ? `<div style="font-size:.74rem;color:var(--muted);margin-top:.4rem">${sub}</div>` : ''}`;
  el.style.display = 'block';
}

function renderPrivacySettings(profile){
  const box = document.getElementById('profilePrivacy');
  if (!box) return;
  box.hidden = typeof privacyAvailable !== 'function' || !privacyAvailable();
  if (box.hidden) return;
  document.getElementById('pvProfile').value = profile.profile_visibility || 'all';
  document.getElementById('pvRequests').value = profile.accepts_friend_requests === false ? 'nobody' : 'all';
  const inv = document.getElementById('pvInvisible');
  const canInv = profile.can_be_invisible !== false;   // undefined — progression.sql ещё не выполнен
  inv.checked = !!profile.privacy_invisible && canInv;
  inv.disabled = !canInv;
  document.getElementById('pvInvisibleLock').hidden = canInv;
  document.getElementById('pvDonations').checked = !!profile.privacy_hide_donations;
  document.getElementById('pvStatus').textContent = '';
  // Ребёнку до 13 (js/core/age.js; сервер включает это сам — age.sql): заявки в друзья — только когда сам зовёшь
  const req = document.getElementById('pvRequests'), kid = !!window.D37Age?.kid?.();
  let note = document.getElementById('pvKidNote');
  if (kid && req && !note) { note = document.createElement('div'); note.id = 'pvKidNote'; note.className = 'pv-kid'; req.insertAdjacentElement('afterend', note); }
  if (note) { note.hidden = !kid; note.textContent = '🔒 Тебе меньше 13: заявки «от всех» лучше включать вместе с родителями. Друзей можно звать самому — заявку отправляешь ты.'; }
}

async function savePrivacy(col, value){
  const st = document.getElementById('pvStatus');
  if (!sbClient || !currentUser) return;
  // ребёнок открывает заявки «от всех» — переспросить (js/core/age.js)
  if (col === 'privacy_friend_requests' && value === 'all' && window.D37Age?.kid?.()
      && !confirm('Тебе меньше 13. Заявки в друзья «от всех» — это значит, что писать в друзья смогут и незнакомые люди. Включить? Лучше вместе с родителями.')) {
    renderPrivacySettings(currentProfile || {});
    return;
  }
  st.style.color = 'var(--muted)'; st.textContent = 'Сохраняем...';
  const { error } = await sbClient.from('profiles').update({ [col]: value }).eq('id', currentUser.id);
  if (error) {
    st.style.color = '#f87171'; st.textContent = '⚠ Не сохранилось: ' + humanErr(error);
    renderPrivacySettings(currentProfile || {});
    return;
  }
  // В profiles_public настройки называются чуть иначе — держим currentProfile в том же виде
  if (currentProfile) {
    if (col === 'privacy_profile') currentProfile.profile_visibility = value;
    else if (col === 'privacy_friend_requests') currentProfile.accepts_friend_requests = value === 'all';
    else currentProfile[col] = value;
  }
  // Невидимка стирает и уже записанные свои заходы в чужие «Гости профиля»
  if (col === 'privacy_invisible' && value) {
    try { await sbClient.from('profile_views').delete().eq('viewer_id', currentUser.id); } catch (e) {}
  }
  st.style.color = '#22c55e';
  st.textContent = col === 'privacy_hide_donations' ? '✅ Сохранено — топ донатеров обновится в течение нескольких минут' : '✅ Сохранено';
}

// «👥 Пригласи друзей» на своём профиле — карточка из js/features/invite.js (ссылка /r/<код>, счётчики, «Мои приглашения»).
// Нет её — по-старому: ник как код приглашения (?ref=<nick>)
function renderReferralPanel(profile, isOwn){
  const panel = document.getElementById('profileReferralPanel');
  if (!panel) return;
  if (typeof renderInviteCard === 'function') return renderInviteCard(panel, isOwn);
  if (!isOwn || !profile?.nick) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  const link = `${location.origin}/?ref=${encodeURIComponent(profile.nick)}`;
  const input = document.getElementById('profileReferralLink');
  if (input) input.value = link;
}
function copyReferralLink(){
  const input = document.getElementById('profileReferralLink');
  const note = document.getElementById('profileReferralCopied');
  if (!input) return;
  input.select();
  const done = () => { if (note) { note.textContent = '✅ Скопировано!'; setTimeout(()=>note.textContent='', 2500); } };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(input.value).then(done).catch(()=>{ document.execCommand('copy'); done(); });
  } else {
    document.execCommand('copy'); done();
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
  if (!profile || !(isVipActive(profile) || donorLevelOf(profile) > 0) || !profile.theme_accent) {
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
      style="width:34px;height:34px;border-radius:50%;cursor:pointer;background:linear-gradient(135deg,${p.a1},${p.a2});border:2px solid ${active ? '#fff' : 'transparent'};box-shadow:${active ? '0 0 0 2px rgba(var(--fg-rgb),.3)' : 'none'}"></button>`;
  }).join('');
}
async function saveThemeAccent(a1, a2){
  if (!currentUser) return;
  const value = (a1 && a2) ? `${a1},${a2}` : null;
  try {
    await sbOk(sbClient.from('profiles').update({ theme_accent: value }).eq('id', currentUser.id));
    if (currentProfile) currentProfile.theme_accent = value;
    applyThemeAccent(currentProfile || { is_vip: true, vip_until: null, theme_accent: value });
    renderThemePresets(value);
  } catch(e) {
    alert('Не удалось сохранить тему: ' + humanErr(e));
  }
}

// Ник + бейдж роли/VIP + цвет по уровню — используется на форуме (и
// где угодно ещё, где рендерится чужой профиль по join'у profiles).
// Роль важнее VIP: если есть roleBadgeHtml, отдельный VIP-бейдж не
// дублируем — тот же принцип, что и в applyProfileGlow().
function renderNickWithVip(nick, profile, roleBadgeHtml){
  const st = !roleBadgeHtml ? statusOf(profile) : null, tier = st?.tier;
  const color = st ? `color:rgb(${st.rgb})` : '';
  const vipBadge = !st ? '' : st.kind === 'donor'
    ? ` <span class="role-badge" style="background:rgba(${st.rgb},.22);color:rgb(${st.rgb})">💛 ${window.D37Donor.roman(st.lv)}</span>`
    : ` <span class="role-badge" style="background:rgba(${tier.rgb},.22);color:rgb(${tier.rgb})">${tier.key==='gold'?'✨':tier.key==='silver'?'⭐':'🔸'} ${tier.key.toUpperCase()}</span>`;
  return `<span style="${color}">${esc(nick)}</span>${roleBadgeHtml||''}${vipBadge}`;
}

// Гости профиля — VIP-плюшка. Запись визита делает КАЖДЫЙ залогиненный
// посетитель чужого профиля (не только к VIP), потому что узнать, что
// у тебя есть гости, ты сможешь, только когда сам купишь VIP — так и
// задумано: история визитов не теряется, пока ты не VIP.
async function recordProfileView(viewedId){
  if (!sbClient || !currentUser?.id || currentUser.id === viewedId) return;
  // Невидимка (с Silver VIP) — база проверяет и сама, тут просто не шлём лишний запрос
  if (currentProfile?.privacy_invisible && currentProfile?.can_be_invisible !== false) return;
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
// Блок «как получить бонусы» в своём профиле (у кого бонусов нет). Всё из чисел кода — VIP_TIERS, D37Donor.LEVELS, VIP_MONTH_OPTIONS.
// Донаты выключены от наград ('off'): «💛 Донатер» — статус за поддержку (донат — не покупка), VIP — отдельно: за уровень или 💎.
// 'vip' / 'gems' (как до 22.10) — VIP за донат и калькулятор месяцев
const VIP_MONTH_OPTIONS = [1, 3, 6, 12];
function renderVipPromo(){
  const box = document.getElementById('profileVipPromo');
  if (!box) return;
  const D = window.D37Donor, mode = donateMode();
  if (mode === 'off' && D) {
    const rows = D.LEVELS.map(l => { const t = VIP_TIERS.find(x => x.key === l.perk); return `
      <div class="vp-row"><span style="color:rgb(${D.rgb(l.lv)})">💛 ${D.roman(l.lv)}</span><span>от ${l.min} ₽ за ${D.RULES.days} дней — как ${esc(t.label)}: ${tierPerkLine(t)}</span></div>`; }).join('');
    box.innerHTML = `
      <div class="vp-lead">💛 <b>Донатер — статус за поддержку стрима, с бонусами.</b> Донат — это поддержка, а не покупка: взамен — спасибо
        и статус на ${D.RULES.days} дней. Уровень — по сумме донатов за последние ${D.RULES.days} дней; бонусы — как у VIP (на игры и рейтинги не влияют):</div>
      <div class="vp-rows">${rows}</div>
      <div class="vp-note">Засчитываются донаты, сделанные после того, как задан логин для доната. Анонимные донаты ни к кому не привязываются.</div>
      <div class="vp-act"><button type="button" onclick="openVipBuyGuide()" class="pf-btn pf-btn-gold">💛 Как стать донатером</button></div>
      <div class="vp-lead vp-sep">✨ <b>VIP — отдельно:</b> пробный за уровень на сайте (30-й — 3 дня, 50-й — неделя, 100-й — месяц) или за 💎 в <a href="#/shop" style="color:#ffd166">магазине</a>. Бонусы почти те же; у кого есть и то, и другое — действует лучшее.</div>`;
    return;
  }
  const current = parseInt(document.getElementById('vipBuyMonths')?.value, 10) || 3;
  box.innerHTML = `
    <div class="vp-lead">✨ <b>VIP — 100₽ в месяц</b> (донат больше — месяцев больше, остаток копится) или за 💎 кристаллы в <a href="#/shop" style="color:#ffd166">магазине</a>.
      Всем VIP: анимированные аватар и фон, цветной ник в чате и на форуме, своя тема сайта, форматирование постов, стикеры, закреп сообщения и список гостей профиля.
      Уровень растёт с суммой поддержки (донаты и кристаллы) за всё время:</div>
    <div class="vp-rows">${[...VIP_TIERS].reverse().map(t => `<div class="vp-row"><span style="color:rgb(${t.rgb})">${t.icon} ${t.key === 'bronze' ? 'VIP' : t.key === 'silver' ? 'Silver' : 'Gold'}</span><span>${t.min ? 'от ' + t.min + '₽ за всё время — ' : 'с первого месяца — '}${tierPerkLine(t)}</span></div>`).join('')}</div>
    <input type="hidden" id="vipBuyMonths" value="${current}">
    <div id="vipMonthBtns" class="vip-month-btns" style="display:flex;gap:.4rem;flex-wrap:wrap;margin:.7rem 0"></div>
    <div class="vp-act"><div id="vipCalcTotal" style="font-size:.85rem;font-weight:800;color:var(--text)"></div><button type="button" onclick="openVipBuyGuide()" class="pf-btn pf-btn-gold">✨ Хочу VIP</button></div>`;
  renderVipMonthButtons();
}
// Калькулятор месяцев (только когда донат даёт VIP: 'vip'). openVipBuyGuide() читает #vipBuyMonths
function renderVipMonthButtons(){
  const box = document.getElementById('vipMonthBtns');
  if (!box) return;
  const current = parseInt(document.getElementById('vipBuyMonths')?.value, 10) || 3;
  box.innerHTML = VIP_MONTH_OPTIONS.map(m => `
    <button type="button" class="vip-month-btn${m === current ? ' active' : ''}" data-months="${m}"
      style="padding:.5rem .9rem;border-radius:8px;border:1.5px solid ${m === current ? 'var(--vip-gold,#ffd93d)' : 'var(--border)'};background:${m === current ? 'rgba(255,217,61,.14)' : 'rgba(var(--fg-rgb),.04)'};color:var(--text);font-family:'Montserrat',sans-serif;font-size:.76rem;font-weight:700;cursor:pointer;transition:all .15s">
      ${m} мес${m===1?'':m<5?'яца':'яцев'}<br><span style="font-size:.66rem;font-weight:600;color:var(--muted)">${(m*VIP_RUB_PER_MONTH).toLocaleString('ru')}₽</span>
    </button>`).join('');
  box.querySelectorAll('.vip-month-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>selectVipMonths(parseInt(btn.dataset.months,10)));
  });
  updateVipCalcTotal(current);
}
function selectVipMonths(months){
  const input = document.getElementById('vipBuyMonths');
  if (input) input.value = String(months);
  document.querySelectorAll('#vipMonthBtns .vip-month-btn').forEach(b=>{
    const active = parseInt(b.dataset.months,10) === months;
    b.classList.toggle('active', active);
    b.style.borderColor = active ? 'var(--vip-gold,#ffd93d)' : 'var(--border)';
    b.style.background = active ? 'rgba(255,217,61,.14)' : 'rgba(var(--fg-rgb),.04)';
  });
  updateVipCalcTotal(months);
}
function updateVipCalcTotal(months){
  const el = document.getElementById('vipCalcTotal');
  if (el) el.textContent = `Итого: ${(months * VIP_RUB_PER_MONTH).toLocaleString('ru')}₽ за ${months} мес.`;
}

// Панель «мой статус» (свой профиль, бонусы есть): лучшая ветка — «💛 Донатер» (донаты за 30 дней, до какого числа, сколько до
// следующего) и/или VIP (за уровень или 💎); что даёт сейчас
function renderVipPerksPanel(profile, isOwn){
  const panel = document.getElementById('profileVipPerksPanel');
  if (!panel) return;
  const D = window.D37Donor, st = statusOf(profile), tier = getPerkTier(profile);
  if (!isOwn || !st || !tier) { panel.style.display = 'none'; return; }
  const me = D?.me?.() || {}, dl = donorLevelOf(profile), vt = getVipTier(profile);
  const lines = [];
  if (dl) {
    const nx = me.next;
    lines.push(`<div style="font-size:1.05rem;font-weight:800;color:rgb(${D.rgb(dl)});margin-bottom:.3rem">${esc(D.label(dl))} <small style="font-weight:600;color:var(--muted)">${esc(D.untilText(D.untilOf(profile.id)))}</small></div>
      <div style="font-size:.74rem;color:var(--muted);margin-bottom:.5rem">За ${D.RULES.days} дней — ${Math.round(+me.sum || 0)} ₽ донатов. ${nx ? `До «Донатер ${D.roman(nx.level)}» ещё ${Math.round(+nx.need)} ₽.` : 'Это высший уровень — спасибо, что с нами 💛'} Статус временный: донат считается ${D.RULES.days} дней.</div>`);
  }
  if (vt) {
    const until = typeof vipEffectiveUntil === 'function' ? vipEffectiveUntil(profile) : profile.vip_until;
    lines.push(`<div style="font-size:${dl ? '.82rem' : '1.05rem'};font-weight:800;color:rgb(${vt.rgb});margin-bottom:.5rem">${vt.icon} ${esc(vt.label)}${until ? ` <small style="font-weight:600;color:var(--muted)">до ${new Date(until).toLocaleDateString('ru-RU')}</small>` : ''}</div>`);
  }
  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="font-size:.68rem;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:.6rem">${st.icon} Твой статус</div>
    ${lines.join('')}
    <div style="font-size:.76rem;color:var(--muted);line-height:1.7">
      Действует лучшее: <b style="color:var(--text)">как ${esc(tier.label)}</b><br>
      📌 Закреп в чате: <b style="color:var(--text)">${tier.pinMin} мин</b>, повтор через ${Math.round(tier.pinMin * tier.pinCooldownMult)} мин<br>
      🎉 Стикеров: <b style="color:var(--text)">${stickerCountFor(tier.stickerSets)}</b> · 👀 Гостей в списке: <b style="color:var(--text)">${tier.guestsLimit}</b><br>
      ✨ Анимированные аватар и фон, цветной ник, своя тема, форматирование на форуме, сайт без рекламы
    </div>`;
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
    <div style="font-size:.78rem;margin-bottom:.4rem">Уровень: <b>${tier ? tier.label : 'не активен'}</b> · всего задонатил: <b>${profile.donations_hidden ? '🔒 скрыто' : (Number(profile.total_donated)||0).toFixed(0) + '₽'}</b></div>
    <div style="font-size:.78rem;margin-bottom:.4rem">До следующего месяца: <b>${pending.toFixed(0)}/${VIP_RUB_PER_MONTH}₽</b>${missing > 0 ? ` (не хватает ${missing.toFixed(0)}₽)` : ' — набрано!'}</div>
    <div style="background:rgba(var(--fg-rgb),.08);border-radius:6px;height:8px;overflow:hidden;margin:.5rem 0"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:6px"></div></div>
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
    const { error } = await sbClient.from('profiles').update({ bio }).eq('id', currentUser.id);
    if (error) throw error;
    document.getElementById('profileBioText').textContent = bio || 'Расскажи о себе...';
    toggleBioEdit(false);
  } catch(e) {
    alert('Не удалось сохранить: ' + humanErr(e));
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
  if (window.D37Donor?.reserved(nick)) { errEl.textContent = 'Такой ник занят системой (так подписаны анонимные донаты и гости) — выбери другой'; return; }

  try {
    // Ник больше не участвует в матчинге доната (см. vip-donate-login.sql)
    // — для этого есть отдельный "логин для доната". Поэтому ник снова
    // свободный, без проверок на уникальность.
    const { error } = await sbClient.from('profiles').update({ nick }).eq('id', currentUser.id);
    if (error) { errEl.textContent = 'Не удалось сохранить: ' + humanErr(error); return; }
    if (currentProfile) currentProfile.nick = nick;
    chatNick = nick;
    try { localStorage.setItem('d37_nick', nick); } catch(e) {}
    document.getElementById('profileNick').textContent = nick;
    toggleNickEdit(false);
    const np = document.getElementById('profileNickPrompt'); if (np) np.hidden = true;   // «Придумай ник» больше не нужен
  } catch(e) {
    errEl.textContent = 'Не удалось сохранить: ' + humanErr(e);
  }
}

// bucket: 'avatars' | 'profile-bg' — сброс к дефолту (без файла)
async function removeProfileImage(bucket){
  if (!confirm('Удалить ' + (bucket === 'avatars' ? 'аватарку' : 'фон') + '?')) return;
  const col = bucket === 'avatars' ? 'avatar_url' : 'banner_url';
  const statusEl = document.getElementById('profileUploadStatus');
  try {
    await sbOk(sbClient.from('profiles').update({ [col]: null }).eq('id', currentUser.id));
    // Файл из Storage не трогаем намеренно — просто отвязываем ссылку в
    // профиле, это и быстрее, и безопаснее (без риска задеть чужой путь
    // случайным несовпадением расширения файла).
    renderProfilePage(currentUser.id);
  } catch(e) {
    statusEl.textContent = '⚠ Не удалось удалить: ' + humanErr(e);
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
    const { data } = await (await sbProfiles()).select('role,is_vip,vip_until,total_donated,avatar_url,banner_url').eq('id', currentUser.id).single();
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
    say(isNetworkBlockError(e) ? UPLOAD_BLOCK_HINT : '⚠ Не получилось: ' + humanErr(e));
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
  // «Аноним», «гость», «без имени»… так DonationAlerts подписывает анонимные донаты — к логину не привяжутся (premium.sql)
  if (window.D37Donor?.reserved(login)) { errEl.textContent = 'Такой логин нельзя: так подписываются анонимные донаты — придумай свой'; return; }
  try {
    const { error } = await sbClient.from('profiles').update({ donate_login: login }).eq('id', currentUser.id);
    if (error) {
      errEl.textContent = error.code === '23505' || /уже занят/i.test(error.message || '')
        ? `Логин «${login}» уже занят — в том числе кем-то, кто раньше его использовал`
        : error.code === '23514' || /нельзя: так DonationAlerts/i.test(error.message || '') ? 'Такой логин нельзя: так подписываются анонимные донаты — придумай свой'
        : 'Не удалось сохранить: ' + humanErr(error);
      return;
    }
    if (currentProfile) currentProfile.donate_login = login;
    renderDonateLoginBlock(login);
    window.D37Donor?.sync();   // «логин стал твоим» — с этого момента донаты засчитываются
  } catch(e) {
    errEl.textContent = 'Не удалось сохранить: ' + humanErr(e);
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

// 💎 Кристаллы в своём профиле (js/core/premium.js, магазин #/shop): баланс и что даёт донат — VIP сразу или кристаллы.
// Пока premium.sql не выполнен — только ссылка на магазин.
async function renderProfileGems(){
  const panel = document.getElementById('donateLoginPanel');
  if (!panel || !window.D37Gems) return;
  let box = panel.querySelector('.pg-box');
  if (!box) { box = document.createElement('div'); box.className = 'pg-box'; panel.appendChild(box); }
  const S = await D37Gems.sync(), C = D37Gems.CFG;
  if (!S.ok) { box.innerHTML = `<a class="dl-copy dl-go" href="#/shop">${C.icon} Магазин кристаллов</a>`; return; }
  const row = `<div class="pg-row"><span>${C.icon} <b class="js-gems">${D37Gems.num(S.balance)}</b> ${D37Gems.word(S.balance)}</span><a class="dl-copy dl-go" href="#/shop">Магазин →</a></div>`;
  // Донат не даёт ни VIP, ни 💎 (premium.sql, 'off') — выбирать нечего: статус «💛 Донатер»
  if (donateMode() === 'off') { box.innerHTML = row; return; }
  box.innerHTML = row + `
    <div class="pg-mode" role="radiogroup" aria-label="Что даёт донат"><span>Донат даёт:</span>
      <button type="button" role="radio" aria-checked="${S.mode === 'vip'}" class="${S.mode === 'vip' ? 'on' : ''}" onclick="profileGemsMode('vip')">✨ VIP сразу</button>
      <button type="button" role="radio" aria-checked="${S.mode === 'gems'}" class="${S.mode === 'gems' ? 'on' : ''}" onclick="profileGemsMode('gems')">${C.icon} Кристаллы</button></div>`;
}
async function profileGemsMode(mode){
  if (typeof shopSetMode !== 'function') return;
  await shopSetMode(mode);
  renderProfileGems();
}

function openVipBuyGuide(){
  if (!currentUser) { openGlobalAuth(); return; }
  if (!currentProfile?.donate_login) {
    alert('Сначала укажи логин для доната — он выше, в блоке «Логин для доната». Без него донат не поймёт, кому засчитать.');
    document.getElementById('donateLoginInput')?.focus();
    return;
  }
  const D = window.D37Donor, off = donateMode() === 'off';
  const months = parseInt(document.getElementById('vipBuyMonths')?.value, 10) || 1;
  const amount = off ? '' : months * VIP_RUB_PER_MONTH + '₽';
  const login = esc(currentProfile.donate_login);
  const title = document.getElementById('vipGuideTitle'), steps = document.getElementById('vipGuideSteps'), note = document.getElementById('vipGuideNote');
  if (title) title.textContent = off ? '💛 Как стать донатером' : '✨ Как получить VIP';
  if (steps) steps.innerHTML = off ? `
    <li>Жми «Перейти к донату» ниже — откроется страница DonationAlerts</li>
    <li>В поле <b>«Ваше имя»</b> впиши <b>ровно</b> свой логин для доната (не ник! он уже в буфере обмена — просто вставь): <span id="vipGuideNick" style="color:#ffd700;font-weight:700">${login}</span></li>
    <li>Сумма — любая. За ${D?.RULES?.days || 30} дней: ${esc(donorLevelsLine())} <span id="vipGuideAmount" hidden></span></li>
    <li>Через пару минут статус «💛 Донатер» включится сам — обнови профиль</li>`
    : `
    <li>Жми «Перейти к донату» ниже — откроется страница DonationAlerts</li>
    <li>В поле <b>«Ваше имя»</b> введи <b>ровно</b> свой логин для доната (не ник! уже в буфере обмена): <span id="vipGuideNick" style="color:#ffd700;font-weight:700">${login}</span></li>
    <li>Сумма — <span id="vipGuideAmount" style="color:#ffd700;font-weight:700">${amount}</span> (любая, не обязательно кратно 100₽ — остаток копится к следующему месяцу)</li>
    <li>После доната VIP применится автоматически в течение пары минут — обнови страницу профиля</li>`;
  if (note) note.textContent = off
    ? 'Донат — это поддержка стрима, а не покупка: взамен — спасибо и статус. Засчитываются донаты после того, как задан логин. Не засчитался (опечатка в имени) — в профиле есть «Задонатил — не засчиталось?».'
    : '⚠ Если логин не совпадёт (опечатка, донат под ником вместо логина) — не потеряется: в профиле есть «Задонатил — не засчиталось?».';
  document.getElementById('vipBuyModal').style.display = 'flex';
}
function closeVipBuyGuide(){
  document.getElementById('vipBuyModal').style.display = 'none';
}
async function proceedToVipDonate(){
  const login = document.getElementById('vipGuideNick')?.textContent || currentProfile?.donate_login || '';
  const amount = (document.getElementById('vipGuideAmount')?.textContent || '').replace('₽','');
  try { await navigator.clipboard.writeText(login); } catch(e) {
    // Буфер обмена может быть недоступен (напр. без HTTPS или разрешения) —
    // не критично, логин всё равно есть текстом в гайде, можно ввести руками.
  }
  // best-effort — см. комментарий выше, не гарантировано
  window.open(amount ? `${DA_DONATE_URL}?amount=${amount}` : DA_DONATE_URL, '_blank');
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
      // В режиме «донат → 💎» (premium.sql) донат даёт кристаллы, а не месяцы
      const HOLD = { reserved: 'анонимный', before_reg: 'раньше регистрации — реши в «Донаты: проверка»', before_login: 'раньше, чем логин стал его — реши в «Донаты: проверка»', currency: 'не в рублях', no_profile: 'логин не найден' };
      const status = row.matched
        ? (row.reward === 'status' ? `💛 статус${row.excluded ? ' (не в счёт)' : ''}` : row.gems_granted ? `✅ +${row.gems_granted} 💎` : `✅ +${row.months_granted} мес.`) + ` → <b>${esc(row.profiles?.nick || '?')}</b>`
        : `⚠ Не привязан${row.hold && HOLD[row.hold] ? ': ' + HOLD[row.hold] : ''}`;
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.8rem;background:rgba(var(--fg-rgb),.03);border-radius:10px;padding:.6rem .9rem;font-size:.78rem;flex-wrap:wrap">
          <div>
            <div style="font-weight:700">${esc(row.donor_username || '(без имени)')} — ${row.amount ?? '?'} ${esc(row.currency || 'RUB')}</div>
            <div style="color:var(--muted);font-size:.7rem">${date} · №${esc(String(row.donation_id))}</div>
          </div>
          <div>${status}</div>
        </div>`;
    }).join('');
  } catch(e) {
    statusEl.textContent = 'Ошибка загрузки: ' + humanErr(e);
  }
}
function closeDonationLog(){
  document.getElementById('donationLogModal').style.display = 'none';
}


// Мини-профиль (нажатие на ник — как в Discord): ОДНА карточка на сайт — js/features/minicard.js (D37Mini, T-086);
// openMiniProfile(id, ник, элемент) — её старое имя (тиммейты, гости профиля)

// ☁️ «Облако» в панели администратора: сколько занято хранилища сайта (бесплатный тариф Supabase — 1 ГБ на ВСЁ: сохранения игр,
// модели, эмодзи, реклама). cloud_usage() в ugc.sql (только админ); при 800 МБ новые сохранения в облако не принимаются (cloud_rule
// cap_mb). Нет функции (ugc.sql не запущен) — строки нет
async function renderAdminCloudLine(){
  const grid = document.querySelector('#profileAdminPanel .pf-admin-grid');
  if (!grid || typeof sbClient === 'undefined' || !sbClient) return;
  let el = document.getElementById('pfCloudLine');
  if (!el) { el = document.createElement('div'); el.id = 'pfCloudLine'; el.style.cssText = 'margin-top:.7rem;font-size:.78rem;opacity:.9'; el.hidden = true; grid.after(el); }
  const res = await sbClient.rpc('cloud_usage').catch(e => ({ error: e }));
  const u = res && !res.error ? res.data : null;
  if (!u || !u.ok) { el.hidden = true; return; }
  const mb = n => Math.round((+n || 0) / 1048576);
  el.textContent = `☁️ Облако: ${mb(u.site_bytes)} МБ из ${u.site_mb} · сохранения игр — ${mb(u.cloud_bytes)} МБ (${u.worlds} миров, ${u.users} чел.)` +
    (u.full ? ` · 🔴 занято больше ${u.cap_mb} МБ — новые сохранения в облако остановлены` : ` · предел для сохранений — ${u.cap_mb} МБ`);
  el.hidden = false;
}
