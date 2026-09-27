// ═══════════════════════════════════════
//  СТРИК ПОСЕЩЕНИЙ + АЧИВКИ
//  Считаются на бэкенде (streaks-achievements.sql, RPC my_achievements) —
//  здесь только вызов, рендер и тосты. Список наград синхронизирован
//  1-в-1 с case'ами в SQL-функции my_achievements(); если добавляешь
//  новый код там — добавь и здесь, иначе бейдж будет earned:true, но
//  без иконки/названия.
// ═══════════════════════════════════════
const ACHIEVEMENT_DEFS = [
  { code: 'first_visit', icon: '👋', title: 'Добро пожаловать', desc: 'Зарегистрировался на сайте' },
  { code: 'week_here',   icon: '📅', title: 'Неделя с нами',    desc: 'На сайте 7+ дней' },
  { code: 'month_here',  icon: '🗓️', title: 'Месяц с нами',     desc: 'На сайте 30+ дней' },
  { code: 'year_here',   icon: '🎂', title: 'Старожил',         desc: 'На сайте больше года' },
  { code: 'streak_3',    icon: '🔥', title: 'Разогрелся',       desc: '3 дня подряд на сайте' },
  { code: 'streak_7',    icon: '🔥', title: 'В огне',           desc: '7 дней подряд на сайте' },
  { code: 'streak_30',   icon: '🌋', title: 'Не тухнет',        desc: '30 дней подряд на сайте' },
  { code: 'chatty_10',   icon: '💬', title: 'Разговорился',     desc: '10+ сообщений в чате' },
  { code: 'chatty_100',  icon: '🗣️', title: 'Душа чата',        desc: '100+ сообщений в чате' },
  { code: 'chatty_500',  icon: '📢', title: 'Легенда чата',     desc: '500+ сообщений в чате' },
  { code: 'forum_1',     icon: '📝', title: 'Автор',            desc: 'Создал тему на форуме' },
  { code: 'forum_5',     icon: '✍️', title: 'Писатель',         desc: '5+ тем на форуме' },
  { code: 'friends_5',   icon: '👥', title: 'Душа компании',    desc: '5+ друзей' },
  { code: 'referrer_1',  icon: '🔗', title: 'Амбассадор',       desc: 'Привёл активного реферала' },
  { code: 'referrer_5',  icon: '🌟', title: 'Инфлюенсер',       desc: '5+ активных рефералов' },
  { code: 'vip',         icon: '✨', title: 'VIP',              desc: 'Активный VIP-статус' },
];

// Отмечаем сегодняшний визит — вызывается раз при входе (onAuthStateChange
// в chat.js). Не критично, если не выполнится (нет сети и т.п.) — просто
// не засчитается конкретно этот день, стрик не ломается фатально.
async function recordTodayVisit(){
  if (!sbClient || !currentUser) return;
  try { await sbClient.rpc('record_visit'); } catch(e) {}
}

// Сравниваем список полученных ачивок с тем, что видели раньше (per-аккаунт
// ключ в localStorage) — если появилась новая, короткий тост. Не конфетти:
// это мелкое, частое событие, конфетти оставляем для цели доната (fx.js).
function notifyNewAchievements(uid, earnedCodes){
  const key = `d37_ach_seen_${uid}`;
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}
  const seenSet = new Set(seen);
  const fresh = earnedCodes.filter(c => !seenSet.has(c));
  try { localStorage.setItem(key, JSON.stringify(earnedCodes)); } catch(e) {}
  if (!fresh.length || !seen.length) return; // первый расчёт за сессию — не спамим тостами за всю историю разом
  const def = ACHIEVEMENT_DEFS.find(d => d.code === fresh[0]);
  if (!def) return;
  const el = document.createElement('div');
  el.className = 'fx-toast'; el.setAttribute('role', 'status');
  el.textContent = `${def.icon} Новая ачивка: «${def.title}» — ${def.desc}`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 500); }, 6000);
}

// Рендер грид ачивок и стрика на профиле — вызывается из renderProfileHeader
// (profile.js) вместе с остальной статистикой, для любого профиля (свой
// и чужой одинаково видны полученные бейджи — это социальное доказательство,
// как в играх).
async function renderAchievements(targetId, isOwn){
  const box = document.getElementById('profileAchievements');
  const streakEl = document.getElementById('profileStatStreak');
  if (!box) return;
  box.innerHTML = `<div style="font-size:.75rem;color:var(--muted)">Загрузка…</div>`;
  try {
    const [achRes, streakRes] = await Promise.all([
      sbClient.rpc('my_achievements', { uid: targetId }),
      sbClient.rpc('current_streak', { uid: targetId }),
    ]);
    if (streakEl) streakEl.textContent = streakRes.error ? '—' : (streakRes.data ?? 0);
    if (achRes.error) { box.innerHTML = ''; return; }
    const earned = new Set((achRes.data || []).filter(r => r.earned).map(r => r.code));
    box.innerHTML = ACHIEVEMENT_DEFS.map(d => `
      <div class="ach-badge${earned.has(d.code) ? ' earned' : ' locked'}" title="${d.title} — ${d.desc}">
        <div class="ach-icon">${d.icon}</div>
        <div class="ach-title">${d.title}</div>
      </div>`).join('');
    if (isOwn) notifyNewAchievements(targetId, [...earned]);
  } catch(e) {
    box.innerHTML = '';
  }
}
