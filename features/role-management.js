// ═══════════════════════════════════════
//  УПРАВЛЕНИЕ РОЛЯМИ (админка "⚙️ Настройки сайта")
//  Раньше роль helper/moderator/admin назначалась только вручную через
//  SQL Editor в Supabase (см. registration.sql). Здесь — то же самое, но
//  из интерфейса: ищем зарегистрированного зрителя по нику (по email
//  искать нельзя — auth.users не читается с фронтенда, это нормально и
//  безопасно так и должно быть) и меняем роль через выпадающий список.
//  Требует политику "Админ редактирует любой профиль" из registration.sql
//  — без неё RLS пустит только к своей собственной строке.
// ═══════════════════════════════════════

const ROLE_LABELS = {
  admin: '👑 Админ',
  moderator: '🛡 Модератор',
  helper: '🧹 Хелпер',
  user: '👤 Пользователь',
};

async function searchUsersByNick() {
  const q = document.getElementById('roleSearchInput').value.trim();
  const statusEl = document.getElementById('roleSearchStatus');
  const resultsEl = document.getElementById('roleSearchResults');
  resultsEl.innerHTML = '';
  statusEl.textContent = '';

  if (!q) { statusEl.textContent = 'Введи хотя бы часть ника'; return; }
  if (!sbClient) { statusEl.textContent = 'Нет подключения к БД'; return; }
  if (currentRole !== 'admin') { statusEl.textContent = 'Только для администратора'; return; }

  statusEl.textContent = 'Ищем...';
  try {
    const { data, error } = await sbClient
      .from('profiles')
      .select('id, nick, role')
      .ilike('nick', `%${q}%`)
      .order('nick')
      .limit(20);
    if (error) throw error;

    if (!data || !data.length) {
      statusEl.textContent = 'Никого не нашли — человек ещё не регистрировался с таким ником';
      return;
    }
    statusEl.textContent = `Найдено: ${data.length}`;
    resultsEl.innerHTML = data.map(u => `
      <div class="role-result-row" data-id="${u.id}">
        <span class="role-result-nick">${esc(u.nick || '(без ника)')}</span>
        <select class="role-result-select" aria-label="Роль для ${esc(u.nick || u.id)}">
          ${Object.entries(ROLE_LABELS).map(([val, label]) =>
            `<option value="${val}" ${u.role === val ? 'selected' : ''}>${label}</option>`
          ).join('')}
        </select>
        <button class="role-result-save" onclick="setUserRole('${u.id}', this)">💾 Сохранить</button>
      </div>
    `).join('');
  } catch(e) {
    statusEl.textContent = 'Ошибка поиска: ' + (e.message || e);
  }
}

async function setUserRole(userId, btn) {
  const row = btn.closest('.role-result-row');
  const select = row.querySelector('.role-result-select');
  const newRole = select.value;
  const nick = row.querySelector('.role-result-nick').textContent;

  if (userId === currentUser?.id) {
    if (!confirm('Это твой собственный аккаунт. Правда хочешь сменить себе роль?')) return;
  } else {
    if (!confirm(`Назначить «${nick}» роль «${ROLE_LABELS[newRole]}»?`)) return;
  }

  const oldText = btn.textContent;
  btn.textContent = '...'; btn.disabled = true;
  try {
    const { error } = await sbClient.from('profiles').update({ role: newRole }).eq('id', userId);
    if (error) throw error;
    btn.textContent = '✅';
    setTimeout(() => { btn.textContent = oldText; btn.disabled = false; }, 1500);
  } catch(e) {
    alert('Не удалось сохранить роль: ' + (e.message || e));
    btn.textContent = oldText; btn.disabled = false;
  }
}
