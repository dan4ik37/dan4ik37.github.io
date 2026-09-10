//  ГЛОБАЛЬНАЯ АВТОРИЗАЦИЯ
// ═══════════════════════════════════════
function openGlobalAuth() {
  const modal = document.getElementById('globalAuthModal');
  modal.classList.add('open');
  if (currentUser) {
    showGlobalProfile();
  } else {
    switchAuthTab('login');
    document.getElementById('gauthLogin').style.display = 'block';
    document.getElementById('gauthProfile').style.display = 'none';
  }
  trapModalFocus(modal);
}

function closeGlobalAuth() {
  document.getElementById('globalAuthModal').classList.remove('open');
  document.getElementById('gauthErr').textContent = '';
  document.getElementById('gauthRegErr').textContent = '';
  releaseModalFocus();
}

// ─── Переключение "Вход" / "Регистрация" / "Новый пароль" ───
function switchAuthTab(mode) {
  const isReg = mode === 'register';
  const isReset = mode === 'reset';
  document.getElementById('gauthLoginFields').style.display = (!isReg && !isReset) ? 'block' : 'none';
  document.getElementById('gauthRegisterFields').style.display = isReg ? 'block' : 'none';
  document.getElementById('gauthResetFields').style.display = isReset ? 'block' : 'none';
  document.getElementById('gauthFormTitle').textContent = isReset ? '🔑 Новый пароль' : isReg ? '✍️ Регистрация' : '🔐 Вход';
  document.getElementById('gauthFormSubtitle').textContent = isReset
    ? 'Ссылка из письма подтверждена'
    : isReg ? 'Создай аккаунт зрителя dan4ik37' : 'Войди в свой аккаунт';
  const link = document.getElementById('gauthSwitchLink');
  link.style.display = isReset ? 'none' : 'inline';
  link.textContent = isReg ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться';
  link.dataset.to = isReg ? 'login' : 'register';
  document.getElementById('gauthErr').textContent = '';
  document.getElementById('gauthRegErr').textContent = '';
  document.getElementById('gauthResetErr').textContent = '';
}

// ─── Забыл пароль ───
async function doForgotPassword() {
  const email = document.getElementById('gauthEmail').value.trim();
  const errEl = document.getElementById('gauthErr');
  if (!email) { errEl.textContent = 'Сначала введи email в поле выше'; return; }
  if (!sbClient) { errEl.textContent = 'Нет подключения к БД'; return; }
  errEl.style.color = '';
  errEl.textContent = 'Отправляем письмо...';
  try {
    const { error } = await sbClient.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname,
    });
    if (error) throw error;
    errEl.style.color = 'var(--tw)';
    errEl.textContent = '✅ Письмо отправлено. Перейди по ссылке в нём, чтобы задать новый пароль.';
  } catch(e) {
    errEl.style.color = '';
    errEl.textContent = e.message || 'Не удалось отправить письмо';
  }
}

// Открывается автоматически по ссылке из письма (см. onAuthStateChange
// PASSWORD_RECOVERY в chat.js → initSupabase()), либо вручную из формы.
async function doPasswordReset() {
  const pass  = document.getElementById('gauthResetPassword').value;
  const pass2 = document.getElementById('gauthResetPassword2').value;
  const errEl = document.getElementById('gauthResetErr');
  errEl.textContent = '';
  if (pass.length < 6) { errEl.textContent = 'Пароль минимум 6 символов'; return; }
  if (pass !== pass2) { errEl.textContent = 'Пароли не совпадают'; return; }

  const btn = document.querySelector('#gauthResetFields .auth-submit');
  btn.textContent = 'СОХРАНЯЕМ...'; btn.disabled = true;
  try {
    const { error } = await sbClient.auth.updateUser({ password: pass });
    if (error) throw error;
    errEl.style.color = 'var(--tw)';
    errEl.textContent = '✅ Пароль обновлён!';
    // К этому моменту сессия уже активна (восстановление пароля само
    // логинит человека) — просто освежаем профиль и показываем его.
    const { data: { user } } = await sbClient.auth.getUser();
    if (user) await onAuthStateChange(user);
    setTimeout(() => { errEl.style.color=''; showGlobalProfile(); }, 1200);
  } catch(e) {
    errEl.style.color = '';
    errEl.textContent = e.message || 'Не удалось сохранить пароль';
  } finally {
    btn.textContent = 'СОХРАНИТЬ ПАРОЛЬ'; btn.disabled = false;
  }
}

async function doGlobalLogin() {
  const email = document.getElementById('gauthEmail').value.trim();
  const pass  = document.getElementById('gauthPassword').value;
  const errEl = document.getElementById('gauthErr');
  errEl.textContent = '';
  if (!email || !pass) { errEl.textContent = 'Введи email и пароль'; return; }

  const btn = document.querySelector('#gauthLogin .auth-submit');
  btn.textContent = 'ВХОД...'; btn.disabled = true;

  try {
    if (!sbClient) throw new Error('Нет подключения к БД');
    const { data, error } = await sbClient.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    await onAuthStateChange(data.user);
    showGlobalProfile();
  } catch(e) {
    errEl.textContent = e.message === 'Invalid login credentials' ? 'Неверный email или пароль' : e.message;
  } finally {
    btn.textContent = 'ВОЙТИ'; btn.disabled = false;
  }
}

async function doGlobalRegister() {
  const nick  = document.getElementById('gauthRegNick').value.trim();
  const email = document.getElementById('gauthRegEmail').value.trim();
  const pass  = document.getElementById('gauthRegPassword').value;
  const pass2 = document.getElementById('gauthRegPassword2').value;
  const errEl = document.getElementById('gauthRegErr');
  errEl.textContent = '';

  if (!nick) { errEl.textContent = 'Придумай ник'; return; }
  if (nick.length > 24) { errEl.textContent = 'Ник слишком длинный (макс. 24 символа)'; return; }
  if (!email || !pass) { errEl.textContent = 'Введи email и пароль'; return; }
  if (pass.length < 6) { errEl.textContent = 'Пароль минимум 6 символов'; return; }
  if (pass !== pass2) { errEl.textContent = 'Пароли не совпадают'; return; }

  const btn = document.querySelector('#gauthRegisterFields .auth-submit');
  btn.textContent = 'СОЗДАЁМ АККАУНТ...'; btn.disabled = true;

  try {
    if (!sbClient) throw new Error('Нет подключения к БД');
    const { data, error } = await sbClient.auth.signUp({ email, password: pass });
    if (error) throw error;

    if (data.session && data.user) {
      // Email-подтверждение выключено в настройках Supabase — сессия
      // приходит сразу. Профиль (id, nick, role='user') создаётся
      // автоматически триггером на стороне БД (см. SQL ниже) — здесь
      // только дописываем ник, который человек ввёл в форме, поверх
      // дефолтного (по умолчанию триггер берёт часть email до @).
      try { await sbClient.from('profiles').update({ nick }).eq('id', data.user.id); } catch(e) {}
      await onAuthStateChange(data.user);
      if (currentProfile) currentProfile.nick = nick;
      chatNick = nick;
      try { localStorage.setItem('d37_nick', chatNick); } catch(e) {}
      document.getElementById('chatNickDisplay').textContent = chatNick;
      showGlobalProfile();
    } else {
      // Email-подтверждение включено — сессии пока нет, нужно перейти
      // по ссылке из письма. Ник в этом случае профиль получит только
      // дефолтный (из email) через триггер — досохраняем настоящий ник
      // локально и попробуем дописать его в профиль при первом входе.
      try { localStorage.setItem('d37_pending_nick', nick); } catch(e) {}
      errEl.style.color = 'var(--tw)';
      errEl.textContent = '✅ Проверь почту — перейди по ссылке в письме, чтобы подтвердить регистрацию.';
    }
  } catch(e) {
    errEl.style.color = '';
    errEl.textContent = e.message === 'User already registered' ? 'Этот email уже зарегистрирован' : e.message;
  } finally {
    btn.textContent = 'ЗАРЕГИСТРИРОВАТЬСЯ'; btn.disabled = false;
  }
}

async function doGlobalLogout() {
  if (sbClient) await sbClient.auth.signOut();
  currentUser = null; currentRole = null; currentProfile = null;

  // Живые алерты о донате имеют смысл только в сессии админа — закрываем
  // сокет и перестаём переподключаться
  clearTimeout(donationWSReconnectTimer);
  if (donationWS) { try { donationWS.close(); } catch(e) {} donationWS = null; }

  // Сбрасываем и чат-идентичность — иначе в чате остаётся старый ник
  // администратора, но уже без роли, и сообщения пойдут от его имени как "guest".
  chatNick = '';
  try { localStorage.removeItem('d37_nick'); } catch(e) {}
  document.getElementById('chatNickScreen').style.display = 'flex';
  document.getElementById('chatMainInput').style.display = 'none';

  // Сбрасываем UI
  updateGlobalAuthBtn();
  document.getElementById('chatModPanel').style.display = 'none';
  document.getElementById('chatAuthBtn').style.display = '';
  document.getElementById('chatMsgs').classList.remove('is-mod');
  // БАГ: кнопки 🔨/✕ у уже отрисованных сообщений включались через
  // b.style.display='flex' (инлайн-стиль) при входе — снятие класса .is-mod
  // само по себе их не прячет, инлайн-стиль всегда сильнее правила из CSS.
  // Поэтому раньше они оставались висеть на старых сообщениях после выхода.
  document.querySelectorAll('.msg-del-btn,.msg-ban-btn').forEach(b=>b.style.display='');
  const pollBtn = document.getElementById('pollEditBtn');
  if (pollBtn) pollBtn.style.display = 'none';
  document.getElementById('schedEditBtn')?.style.setProperty('display','none');
  document.getElementById('goalEditBtn')?.style.setProperty('display','none');
  // Статус-бар ("режим модерации активен" и т.п.) не скрывался сам —
  // висел до перезагрузки страницы. Прячем при выходе явно.
  const statusBar = document.getElementById('chatStatusBar');
  if (statusBar) statusBar.style.display = 'none';

  closeGlobalAuth();
  document.getElementById('gauthLogin').style.display = 'block';
  document.getElementById('gauthProfile').style.display = 'none';
  document.getElementById('gauthEmail').value = '';
  document.getElementById('gauthPassword').value = '';
}

function showGlobalProfile() {
  document.getElementById('gauthLogin').style.display = 'none';
  document.getElementById('gauthProfile').style.display = 'block';

  const nick = currentProfile?.nick || currentUser?.email?.split('@')[0] || 'User';
  const role = currentRole;
  const ini = nick.slice(0,2).toUpperCase();
  const colors = { admin: 'var(--accent)', moderator: 'var(--tw)', helper: '#22c55e', user: 'var(--muted)' };

  document.getElementById('gauthProfileEmail').textContent = currentUser?.email || '';
  document.getElementById('gauthAvatarEl').textContent = ini;
  document.getElementById('gauthAvatarEl').style.background = colors[role] || 'var(--muted)';
  document.getElementById('gauthNickEl').textContent = nick;

  const badge = document.getElementById('gauthRoleBadge');
  badge.className = `gauth-role-badge ${role}`;
  badge.textContent = role === 'admin' ? '👑 Администратор' : role === 'moderator' ? '🛡 Модератор' : role === 'helper' ? '🧹 Хелпер' : '👤 Пользователь';

  // Доступные функции
  const perms = [
    { icon: '💬', label: 'Просмотр чата', active: true },
    { icon: '🗑', label: 'Удаление сообщений', active: role === 'admin' || role === 'moderator' || role === 'helper' },
    { icon: '🔨', label: 'Бан пользователей', active: role === 'admin' || role === 'moderator' },
    { icon: '🗳️', label: 'Редактор опросов', active: role === 'admin', action: 'openPollAdmin()' },
    { icon: '⚙', label: 'Настройки сайта', active: role === 'admin', action: 'openSettingsAdmin()' },
  ];
  document.getElementById('gauthPerms').innerHTML = perms.map(p =>
    `<div class="gauth-perm${p.active?' active':''}"${p.active&&p.action?` onclick="${p.action};closeGlobalAuth()" style="cursor:pointer"`:''}>
      <span class="gauth-perm-icon">${p.active ? '✅' : '🔒'}</span>
      <span>${p.label}</span>
    </div>`
  ).join('');
}

function updateGlobalAuthBtn() {
  const btn = document.getElementById('globalAuthBtn');
  const icon = document.getElementById('globalAuthIcon');
  const label = document.getElementById('globalAuthLabel');
  if (!currentUser) {
    btn.className = 'global-auth-btn';
    icon.textContent = '👤';
    label.textContent = 'Войти';
    return;
  }
  const nick = currentProfile?.nick || currentUser.email?.split('@')[0] || 'User';
  icon.textContent = currentRole === 'admin' ? '👑' : currentRole === 'moderator' ? '🛡' : currentRole === 'helper' ? '🧹' : '👤';
  label.textContent = nick;
  btn.className = `global-auth-btn ${currentRole === 'admin' ? 'is-admin' : currentRole === 'moderator' ? 'is-mod' : currentRole === 'helper' ? 'is-helper' : 'logged-in'}`;
}

//  РЕЗУЛЬТАТ OAuth DonationAlerts (?da_auth=success / ?da_error=...)
//  БАГ: api/auth.js редиректил сюда, но фронтенд эти параметры вообще не
//  читал — человек молча оказывался на главной без единого слова о том,
//  получилось подключение или нет (а если не получилось — почему).
// ═══════════════════════════════════════
(function handleDAAuthRedirect(){
  const params = new URLSearchParams(location.search);
  const daAuth = params.get('da_auth');
  const daError = params.get('da_error');
  if (!daAuth && !daError) return;
  history.replaceState({}, '', location.pathname + location.search.replace(/[?&]da_(auth|error)=[^&]*/g,'').replace(/^&/,'?') + location.hash);
  location.hash = '#/donate';
  setTimeout(() => {
    const statusEl = document.getElementById('lbAuthStatus');
    if (daAuth === 'success') {
      if (statusEl) statusEl.textContent = '✅ Подключено';
    } else if (daError) {
      if (statusEl) statusEl.textContent = '⚠ Ошибка входа';
      document.getElementById('lbContent').innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><div class="empty-state-title">Не удалось подключить DonationAlerts</div><div class="empty-state-text">Код ошибки: ${esc(daError)}. Попробуй ещё раз через «Войти через DonationAlerts».</div></div>`;
    }
  }, 300);
})();
