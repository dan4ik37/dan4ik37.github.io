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
      .select('id, nick, role, is_vip, vip_until')
      .ilike('nick', `%${q}%`)
      .order('nick')
      .limit(20);
    if (error) throw error;

    if (!data || !data.length) {
      statusEl.textContent = 'Никого не нашли — человек ещё не регистрировался с таким ником';
      return;
    }
    statusEl.textContent = `Найдено: ${data.length}`;
    resultsEl.innerHTML = data.map(u => {
      const vipActive = u.is_vip && (!u.vip_until || new Date(u.vip_until) > new Date());
      return `
      <div class="role-result-row" data-id="${u.id}">
        <span class="role-result-nick">${esc(u.nick || '(без ника)')}</span>
        <select class="role-result-select" aria-label="Роль для ${esc(u.nick || u.id)}">
          ${Object.entries(ROLE_LABELS).map(([val, label]) =>
            `<option value="${val}" ${u.role === val ? 'selected' : ''}>${label}</option>`
          ).join('')}
        </select>
        <button class="role-result-save" onclick="setUserRole('${u.id}', this)">💾 Роль</button>
      </div>
      <div class="role-result-row" style="margin-top:-.3rem;background:rgba(255,215,0,.05)">
        <label style="display:flex;align-items:center;gap:.4rem;font-size:.75rem;color:var(--muted);flex:1">
          <input type="checkbox" class="role-result-vip-check" ${vipActive ? 'checked' : ''} style="width:16px;height:16px;accent-color:#ffd700">
          ✨ VIP (анимированные аватарки)
        </label>
        <select class="role-result-vip-days" style="background:rgba(255,255,255,.06);border:1.5px solid var(--border);border-radius:8px;padding:.3rem .4rem;color:var(--text);font-family:'Montserrat',sans-serif;font-size:.7rem">
          <option value="30">30 дней</option>
          <option value="90">90 дней</option>
          <option value="365">Год</option>
          <option value="0">Бессрочно</option>
        </select>
        <button class="role-result-save" onclick="setUserVip('${u.id}', this)">💾 VIP</button>
      </div>
    `;
    }).join('');
  } catch(e) {
    statusEl.textContent = 'Ошибка поиска: ' + (e.message || e);
  }
}

async function setUserVip(userId, btn) {
  const row = btn.closest('.role-result-row');
  const checked = row.querySelector('.role-result-vip-check').checked;
  const days = parseInt(row.querySelector('.role-result-vip-days').value, 10);
  const vipUntil = checked && days > 0
    ? new Date(Date.now() + days * 86400000).toISOString()
    : null; // снято, или бессрочно (checked && days===0)

  if (!confirm(checked ? `Выдать VIP на ${days > 0 ? days + ' дней' : 'бессрочно'}?` : 'Снять VIP?')) return;

  const oldText = btn.textContent;
  btn.textContent = '...'; btn.disabled = true;
  try {
    const { error } = await sbClient.from('profiles').update({ is_vip: checked, vip_until: vipUntil }).eq('id', userId);
    if (error) throw error;
    btn.textContent = '✅';
    setTimeout(() => { btn.textContent = oldText; btn.disabled = false; }, 1500);
  } catch(e) {
    alert('Не удалось сохранить VIP: ' + (e.message || e));
    btn.textContent = oldText; btn.disabled = false;
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
