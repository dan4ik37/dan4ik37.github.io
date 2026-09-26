//  ГЛОБАЛЬНАЯ АВТОРИЗАЦИЯ
// ═══════════════════════════════════════

// ═══════════════════════════════════════
//  РЕФЕРАЛЬНАЯ ССЫЛКА (?ref=<nick_пригласившего>)
//  Ловим при ЛЮБОЙ загрузке страницы и сохраняем — человек может побродить
//  по сайту до того, как решит зарегистрироваться. При signUp() значение
//  уходит в raw_user_meta_data, оттуда его читает handle_new_user()
//  (см. referrals.sql). Однажды пойманный код не затирается пустым —
//  только новым непустым, чтобы случайный визит без ?ref= не стёр то,
//  что уже было сохранено раньше.
function captureReferralCode(){
  try {
    const params = new URLSearchParams(location.search);
    const ref = (params.get('ref') || '').trim();
    if (ref) localStorage.setItem('d37_ref', ref.slice(0, 24));
  } catch(e) {}
}

// Модалка входа/регистрации/сброса пароля — всегда, независимо от
// текущего состояния логина. Нужна отдельно от openGlobalAuth() ниже
// из-за сброса пароля (chat.js): если человек уже залогинен в этом же
// браузере и переходит по ссылке "забыл пароль", всё равно должна
// открыться форма нового пароля, а не увести его на страницу профиля.
function openLoginModal() {
  const modal = document.getElementById('globalAuthModal');
  modal.classList.add('open');
  switchAuthTab('login');
  document.getElementById('gauthLogin').style.display = 'block';
  trapModalFocus(modal);
}

function openGlobalAuth() {
  // Уже залогинен — открываем полноценную страницу профиля, а не
  // дублирующую мини-модалку. Модалка теперь только для входа/регистрации.
  if (currentUser) {
    location.hash = '#/profile';
    return;
  }
  openLoginModal();
}

// После успешного входа/регистрации/сброса пароля — закрыть модалку и
// сразу показать полноценную страницу профиля вместо старой мини-карточки.
function goToOwnProfile() {
  closeGlobalAuth();
  location.hash = '#/profile';
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
    setTimeout(() => { errEl.style.color=''; goToOwnProfile(); }, 1200);
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
    goToOwnProfile();
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
      // дефолтного (уникального, построенного из id — см. vip-secure.sql).
      // Ник может быть занят (в т.ч. кем-то, кто раньше его носил) —
      // тогда аккаунт всё равно создаётся, просто с временным ником,
      // и явно предупреждаем об этом, а не тихо расходимся с БД.
      let nickApplied = true;
      try {
        const { error: nickErr } = await sbClient.from('profiles').update({ nick }).eq('id', data.user.id);
        if (nickErr) nickApplied = false;
      } catch(e) { nickApplied = false; }
      await onAuthStateChange(data.user);
      // currentProfile.nick уже актуален из БД (onAuthStateChange его
      // перезагрузил) — не перетираем его вручную желаемым ником.
      chatNick = currentProfile?.nick || nick;
      try { localStorage.setItem('d37_nick', chatNick); } catch(e) {}
      document.getElementById('chatNickDisplay').textContent = chatNick;
      if (!nickApplied) {
        alert(`Ник «${nick}» уже занят — аккаунт создан с временным ником «${chatNick}». Смени его на странице профиля.`);
      }
      goToOwnProfile();
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
  if (typeof applyThemeAccent === 'function') applyThemeAccent(null);

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
  document.getElementById('gauthEmail').value = '';
  document.getElementById('gauthPassword').value = '';
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
  const daSync = params.get('sync');
  if (!daAuth && !daError) return;
  history.replaceState({}, '', location.pathname + location.search.replace(/[?&](da_auth|da_error|sync)=[^&]*/g,'').replace(/^&/,'?') + location.hash);
  // Итог сохранения СЕРВЕРНОЙ сессии (автоначисление VIP) — покажем админу в блоке статуса
  const SYNC_MSG = {
    stored:          '✅ Серверная сессия сохранена — VIP теперь начисляется автоматически, даже когда тебя нет на сайте.',
    store_off:       'ℹ Автоначисление VIP выключено: задай SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в Vercel.',
    other_account:   '⚠ Вход выполнен, но серверная сессия уже принадлежит ДРУГОМУ аккаунту DonationAlerts — она не изменена.',
    not_owner:       '⚠ Это не тот аккаунт DonationAlerts (не совпадает с DA_OWNER_ID) — серверная сессия не изменена.',
    no_refresh_token:'⚠ DonationAlerts не вернул refresh-токен — серверную сессию сохранить не удалось.',
    user_check_failed:'⚠ Не удалось проверить аккаунт DonationAlerts — повтори вход.',
    error:           '⚠ Серверную сессию сохранить не удалось — повтори вход.',
  };
  if (daSync && SYNC_MSG[daSync]) { try { sessionStorage.setItem('d37_da_sync_msg', SYNC_MSG[daSync]); } catch(e) {} }
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
