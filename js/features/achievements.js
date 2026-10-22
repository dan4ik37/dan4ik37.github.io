// ═══════════════════════════════════════
//  СТРИК ПОСЕЩЕНИЙ + АЧИВКИ + ТИТУЛЫ
//  Считаются на бэкенде (progression.sql → my_achievements, claim_achievements,
//  set_title; с 15.10.2026 my_achievements и achievement_xp — в economy.sql) — здесь только вызов,
//  рендер и тосты. Коды синхронизированы 1-в-1 с my_achievements(); XP — с achievement_xp() (сервер
//  начисляет сам, здесь цифра только для показа; scripts/economy-test.cjs сверяет). Добавляешь код —
//  добавь в оба места.
//
//  special — ачивки роли/VIP: стоят первыми и видны, только если получены
//  (из VIP-уровней показывается старший). Остальные видны всем, неполученные — серые.
// ═══════════════════════════════════════
const ACHIEVEMENT_DEFS = [
  { code: 'creator',        icon: '👑', title: 'Создатель сайта', desc: 'Тот, кто всё это сделал',          xp: 250, special: true },
  { code: 'role_admin',     icon: '🛡️', title: 'Администратор',   desc: 'Команда сайта: администратор',    xp: 150, special: true },
  { code: 'role_moderator', icon: '⚔️', title: 'Модератор',       desc: 'Команда сайта: модератор',        xp: 100, special: true },
  { code: 'role_helper',    icon: '🧹', title: 'Хелпер',          desc: 'Команда сайта: хелпер',           xp: 75, special: true },
  { code: 'vip_gold',       icon: '✨', title: 'Gold VIP',        desc: 'Высший уровень VIP',               xp: 300, special: true, vip: 3 },
  { code: 'vip_silver',     icon: '⭐', title: 'Silver VIP',      desc: 'Серебряный VIP',                   xp: 200, special: true, vip: 2 },
  { code: 'vip',            icon: '🔸', title: 'VIP',             desc: 'Активный VIP-статус',              xp: 100, special: true, vip: 1 },
  { code: 'member',         icon: '👤', title: 'Участник',        desc: 'Зарегистрирован на сайте',         xp: 10,  special: true },

  { code: 'week_here',     icon: '📅', title: 'Неделя с нами',   desc: 'На сайте 7+ дней',                   xp: 10 },
  { code: 'month_here',    icon: '🗓️', title: 'Месяц с нами',    desc: 'На сайте 30+ дней',                  xp: 25 },
  { code: 'half_year',     icon: '🏅', title: 'Свой человек',    desc: 'На сайте полгода',                   xp: 75 },
  { code: 'year_here',     icon: '🎂', title: 'Старожил',        desc: 'На сайте больше года',               xp: 150 },
  { code: 'early_bird',    icon: '🐣', title: 'Первопроходец',   desc: 'Зарегистрировался в 2026 году',      xp: 25 },
  { code: 'streak_3',      icon: '🔥', title: 'Разогрелся',      desc: '3 дня подряд на сайте',              xp: 10 },
  { code: 'streak_7',      icon: '🔥', title: 'В огне',          desc: '7 дней подряд на сайте',             xp: 20 },
  { code: 'streak_30',     icon: '🌋', title: 'Не тухнет',       desc: '30 дней подряд на сайте',            xp: 75 },
  { code: 'streak_100',    icon: '🌠', title: 'Железная воля',   desc: '100 дней подряд на сайте',           xp: 250 },
  { code: 'chatty_10',     icon: '💬', title: 'Разговорился',    desc: '10+ сообщений в чате',               xp: 5 },
  { code: 'chatty_100',    icon: '🗣️', title: 'Душа чата',       desc: '100+ сообщений в чате',              xp: 25 },
  { code: 'chatty_500',    icon: '📢', title: 'Легенда чата',    desc: '500+ сообщений в чате',              xp: 75 },
  { code: 'chatty_1000',   icon: '📣', title: 'Голос сайта',     desc: '1000+ сообщений в чате',             xp: 150 },
  { code: 'night_owl',     icon: '🦉', title: 'Сова',            desc: 'Писал в чат с полуночи до 5 утра (МСК)', xp: 15 },
  { code: 'forum_1',       icon: '📝', title: 'Автор',           desc: 'Создал тему на форуме',              xp: 10 },
  { code: 'forum_5',       icon: '✍️', title: 'Писатель',        desc: '5+ тем на форуме',                   xp: 30 },
  { code: 'forum_replies', icon: '💡', title: 'Советчик',        desc: '25+ ответов на форуме',              xp: 40 },
  { code: 'idea_1',        icon: '🧠', title: 'Идейный',         desc: 'Предложил идею для видео',           xp: 10 },
  { code: 'idea_done',     icon: '🎬', title: 'Соавтор',         desc: 'По твоей идее сняли видео',          xp: 75 },
  { code: 'teammate',      icon: '🎮', title: 'Тиммейт',         desc: 'Создал заявку на поиск тиммейтов',   xp: 10 },
  { code: 'friends_1',     icon: '🤝', title: 'Первый друг',     desc: 'Есть хотя бы один друг',             xp: 10 },
  { code: 'friends_5',     icon: '👥', title: 'Душа компании',   desc: '5+ друзей',                          xp: 25 },
  { code: 'friends_15',    icon: '🎉', title: 'Своя тусовка',    desc: '15+ друзей',                         xp: 50 },
  { code: 'referrer_1',    icon: '🔗', title: 'Амбассадор',      desc: 'Друг по твоей ссылке дошёл до 3 уровня', xp: 25 },
  { code: 'referrer_5',    icon: '🌟', title: 'Инфлюенсер',      desc: '5 друзей по твоей ссылке дошли до 3 уровня', xp: 100 },
  { code: 'watcher_10',    icon: '📺', title: 'Зритель',         desc: 'Посмотрел 10 видео на сайте',        xp: 15 },
  { code: 'watcher_100',   icon: '🍿', title: 'Киноман',         desc: 'Посмотрел 100 видео на сайте',       xp: 75 },
  { code: 'styled',        icon: '🎨', title: 'Стиляга',         desc: 'Аватар, фон и «о себе» заполнены',   xp: 15 },
  { code: 'supporter',     icon: '💖', title: 'Поддержал стрим', desc: 'Сделал донат',                       xp: 100 },
  { code: 'gamer',         icon: '🕹️', title: 'Геймер',          desc: 'Сыграл 10 партий в «Играх»',        xp: 15 },
  { code: 'cities_master', icon: '🌍', title: 'Знаток городов',  desc: 'Обыграл бота в «Города» на сложном', xp: 75 },
  { code: 'quiz_expert',   icon: '🎯', title: 'Фанат канала',    desc: '10 из 10 в «Угадай видео»',          xp: 50 },
  { code: 'tile_2048',     icon: '🧩', title: '2048!',           desc: 'Собрал плитку 2048',                 xp: 75 },
  { code: 'ttt_unbeaten',  icon: '❌', title: 'Непробиваемый',   desc: 'Не проиграл непобедимому боту в крестики-нолики', xp: 25 },
  { code: 'lightning',     icon: '⚡', title: 'Молния',          desc: 'Средняя реакция быстрее 200 мс',     xp: 25 },
  { code: 'checkers_master', icon: '♟️', title: 'Гроссмейстер',  desc: 'Обыграл бота в шашки на «Сложном»',  xp: 75 },
  { code: 'big_catch',     icon: '🤑', title: 'Щедрый стрим',    desc: '1000+ очков в «Лови донаты»',        xp: 25 },
  { code: 'admiral',       icon: '⚓', title: 'Адмирал',         desc: 'Обыграл бота в «Морской бой» на «Сложном»', xp: 75 },
  { code: 'snake_charmer', icon: '🐍', title: 'Заклинатель змей', desc: '30+ яблок в «Змейке»',              xp: 25 },
  { code: 'sharp_memory',  icon: '🧠', title: 'Феноменальная память', desc: '900+ очков в «Найди пару»',     xp: 25 },
  { code: 'duelist',       icon: '⚔️', title: 'Дуэлянт',         desc: '10 побед над живыми соперниками в играх', xp: 50 },
  { code: 'level_10',      icon: '🥉', title: 'Опытный',         desc: 'Достиг 10 уровня' },
  { code: 'level_20',      icon: '🎖️', title: 'Бывалый',         desc: 'Достиг 20 уровня' },
  { code: 'level_30',      icon: '🥈', title: 'Ветеран',         desc: 'Достиг 30 уровня' },
  { code: 'level_40',      icon: '🏵️', title: 'Мастер',          desc: 'Достиг 40 уровня' },
  { code: 'level_50',      icon: '🥇', title: 'Легенда',         desc: 'Достиг 50 уровня' },
  { code: 'level_75',      icon: '👑', title: 'Живая легенда',   desc: 'Достиг 75 уровня' },
  { code: 'level_100',     icon: '💎', title: 'Бессмертный',     desc: 'Достиг 100 уровня' },
];
const ACH_BY_CODE = Object.fromEntries(ACHIEVEMENT_DEFS.map(d => [d.code, d]));
const TITLE_MIN_LEVEL = 10;
// Титул рядом с ником: ачивка или титул сезона ('ss:ГГГГ-ММ:1|2' — seasonTitleDef в games.js, season_claim в games-more.sql)
function achTitleDef(code){
  return (code && ACH_BY_CODE[code]) || (typeof seasonTitleDef === 'function' ? seasonTitleDef(code) : null) || null;
}

// Отмечаем сегодняшний визит — вызывается раз при входе (onAuthStateChange
// в chat.js). Не критично, если не выполнится (нет сети и т.п.) — просто
// не засчитается конкретно этот день, стрик не ломается фатально.
async function recordTodayVisit(){
  if (!sbClient || !currentUser) return;
  try { await sbClient.rpc('record_visit'); } catch(e) {}
  claimAchievements();
}

// XP за новые ачивки (сервер даёт каждую один раз) + догоняет VIP за уровень
async function claimAchievements(){
  if (!sbClient || !currentUser) return [];
  try {
    const { data, error } = await sbClient.rpc('claim_achievements');
    if (error || !data?.length) return [];
    const total = data.reduce((s, r) => s + (r.ach_xp || 0), 0);
    const first = ACH_BY_CODE[data[0].ach_code];
    achToast(data.length === 1 && first
      ? `${first.icon} «${first.title}» — +${total} XP`
      : `🏆 Ачивки: +${total} XP (${data.length} шт.)`);
    if (typeof xpLevelCache !== 'undefined') xpLevelCache.delete(currentUser.id);
    return data;
  } catch(e) { return []; }
}

function achToast(text){
  const el = document.createElement('div');
  el.className = 'fx-toast'; el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 500); }, 6000);
}

// Сравниваем список полученных ачивок с тем, что видели раньше (per-аккаунт
// ключ в localStorage) — если появилась новая, короткий тост. Не конфетти:
// это мелкое, частое событие, конфетти оставляем для цели доната (fx.js).
function notifyNewAchievements(uid, earnedCodes){
  const key = `d37_ach_seen_${uid}`;
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}
  const seenSet = new Set(seen);
  const fresh = earnedCodes.filter(c => !seenSet.has(c) && ACH_BY_CODE[c]);
  try { localStorage.setItem(key, JSON.stringify(earnedCodes)); } catch(e) {}
  if (!fresh.length || !seen.length) return; // первый расчёт — не спамим тостами за всю историю разом
  const def = ACH_BY_CODE[fresh[0]];
  achToast(`${def.icon} Новая ачивка: «${def.title}» — ${def.desc}${def.xp ? ` (+${def.xp} XP)` : ''}`);
}

// Какие бейджи показать: особые — только полученные (из VIP — старший), обычные — все
function achVisibleDefs(earned){
  const vipTop = Math.max(0, ...ACHIEVEMENT_DEFS.filter(d => d.vip && earned.has(d.code)).map(d => d.vip));
  const special = ACHIEVEMENT_DEFS.filter(d => d.special && earned.has(d.code) && (!d.vip || d.vip === vipTop));
  const regular = ACHIEVEMENT_DEFS.filter(d => !d.special)
    .sort((a, b) => (earned.has(b.code) - earned.has(a.code)));   // полученные — вперёд, порядок внутри сохраняется
  return { special, regular };
}

function achBadgeHtml(d, isEarned){
  const tip = `${d.title} — ${d.desc}${d.xp ? ` · +${d.xp} XP` : ''}`;
  return `<div class="ach-badge${isEarned ? ' earned' : ' locked'}${d.special ? ' special' : ''}" title="${esc(tip)}">
      <div class="ach-icon">${d.icon}</div>
      <div class="ach-title">${esc(d.title)}</div>
      ${d.xp ? `<div class="ach-xp">+${d.xp} XP</div>` : ''}
    </div>`;
}

// Рендер грид ачивок и стрика на профиле — вызывается из renderProfilePage
// (profile.js), для любого профиля: полученные бейджи видны всем, как в играх.
async function renderAchievements(targetId, isOwn){
  const box = document.getElementById('profileAchievements');
  const streakEl = document.getElementById('profileStatStreak');
  const sumEl = document.getElementById('profileAchSummary');
  if (!box) return;
  box.innerHTML = `<div style="font-size:.75rem;color:var(--muted)">Загрузка…</div>`;
  if (sumEl) sumEl.textContent = '';
  if (isOwn) await claimAchievements();
  try {
    const [achRes, streakRes] = await Promise.all([
      sbClient.rpc('my_achievements', { uid: targetId }),
      sbClient.rpc('current_streak', { uid: targetId }),
    ]);
    if (streakEl) streakEl.textContent = streakRes.error ? '—' : (streakRes.data ?? 0);
    if (achRes.error) { box.innerHTML = ''; return { earned: new Set(), streak: streakRes.error ? null : (streakRes.data ?? 0) }; }
    const earned = new Set((achRes.data || []).filter(r => r.earned).map(r => r.code));
    const { special, regular } = achVisibleDefs(earned);
    // Закрытых много (50+) — на телефоне это лента на 15 экранов. Показываем полученные + 8 следующих, остальные — по кнопке
    const SHOW_LOCKED = 8;
    let lockedShown = 0;
    box.innerHTML = special.map(d => achBadgeHtml(d, true)).join('') + regular.map(d => {
      const got = earned.has(d.code);
      const extra = !got && ++lockedShown > SHOW_LOCKED;
      return achBadgeHtml(d, got).replace('class="ach-badge', extra ? 'class="ach-more ach-badge' : 'class="ach-badge');
    }).join('');
    box.classList.remove('all');
    const rest = Math.max(0, lockedShown - SHOW_LOCKED);
    box.nextElementSibling?.classList?.contains('ach-toggle') && box.nextElementSibling.remove();
    if (rest) box.insertAdjacentHTML('afterend', `<button type="button" class="ach-toggle" onclick="const g=this.previousElementSibling;g.classList.toggle('all');this.textContent=g.classList.contains('all')?'Свернуть':'Показать все ачивки (ещё ${rest})'">Показать все ачивки (ещё ${rest})</button>`);
    if (sumEl) {
      const got = regular.filter(d => earned.has(d.code)).length;
      const xp = ACHIEVEMENT_DEFS.filter(d => earned.has(d.code)).reduce((s, d) => s + (d.xp || 0), 0);
      sumEl.textContent = `${got} из ${regular.length}${xp ? ` · +${xp} XP` : ''}`;
    }
    if (isOwn) {
      notifyNewAchievements(targetId, [...earned]);
      renderTitlePicker(earned);
    } else {
      const tp = document.getElementById('profileTitlePicker'); if (tp) tp.hidden = true;
    }
    return { earned, streak: streakRes.error ? null : (streakRes.data ?? 0) };   // профиль 2.0: витрина и быстрые числа (profile.js pf2Ach)
  } catch(e) {
    box.innerHTML = '';
    return null;
  }
}

// ── Титул рядом с ником (с 10 уровня) ──
async function renderTitlePicker(earned){
  const box = document.getElementById('profileTitlePicker');
  if (!box || !currentUser) return;
  const [lvRes, curRes] = await Promise.all([
    sbClient.rpc('user_level', { uid: currentUser.id }),
    sbClient.from('user_titles').select('code').eq('user_id', currentUser.id).maybeSingle(),
  ]);
  if (lvRes.error) { box.hidden = true; return; }   // progression.sql ещё не выполнен
  box.hidden = false;
  const lv = lvRes.data || 1;
  if (lv < TITLE_MIN_LEVEL) {
    box.innerHTML = `<span class="tp-lock">🔒 Титул рядом с ником — с ${TITLE_MIN_LEVEL} уровня (сейчас ${lv})</span>`;
    return;
  }
  const cur = curRes.data?.code || '';
  const opts = ACHIEVEMENT_DEFS.filter(d => earned.has(d.code));
  // надет титул сезона — тоже в списке (выбрать другой сезонный — «Игры» → сезон → «Мои награды сезонов»)
  const ss = /^ss:/.test(cur) && achTitleDef(cur);
  box.innerHTML = `<label class="tp-row"><span>🏷 Титул рядом с ником</span>
      <select id="titleSelect" onchange="saveTitle(this.value)">
        <option value="">— без титула —</option>
        ${ss ? `<option value="${esc(cur)}" selected>${ss.icon} ${esc(ss.title)}</option>` : ''}
        ${opts.map(d => `<option value="${d.code}"${d.code === cur ? ' selected' : ''}>${d.icon} ${esc(d.title)}</option>`).join('')}
      </select></label><span id="titleStatus" class="tp-status"></span>`;
}

async function saveTitle(code){
  const st = document.getElementById('titleStatus');
  if (st) { st.style.color = 'var(--muted)'; st.textContent = 'Сохраняем…'; }
  const { data, error } = /^ss:/.test(code || '') ? await sbClient.rpc('season_title_set', { p_code: code })
    : await sbClient.rpc('set_title', { p_code: code || null });
  const ok = !error && data?.ok;
  if (st) {
    st.style.color = ok ? '#22c55e' : '#f87171';
    st.textContent = ok ? '✅ Готово' : data?.reason === 'level' ? `Нужен ${TITLE_MIN_LEVEL} уровень` : '⚠ Не получилось';
  }
  if (ok) {
    if (typeof xpTitleCache !== 'undefined') xpTitleCache.set(currentUser.id, code || null);
    renderProfileTitle(currentUser.id);
  }
}

// Титул под ником в шапке профиля
async function renderProfileTitle(uid){
  const el = document.getElementById('profileTitle');
  if (!el) return;
  el.hidden = true;
  if (typeof xpGetExtras !== 'function') return;
  const ex = await xpGetExtras(uid);
  const d = ex?.title && achTitleDef(ex.title);
  if (!d) return;
  el.textContent = `${d.icon} ${d.title}`;
  el.hidden = false;
}
