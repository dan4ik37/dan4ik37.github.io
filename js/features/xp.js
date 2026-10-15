// ═══════════════════════════════════════
//  XP И УРОВНИ — таблицы, правила и лимиты в xp.sql
// ═══════════════════════════════════════
// Начисляет только БД (триггеры на визиты/чат/форум/идеи/рефералов).
// Отсюда — единственный «клиентский» источник: просмотр видео на сайте.
// Сколько реально играет ролик, узнаём из YouTube IFrame API без загрузки
// самой библиотеки: подписываемся на postMessage-события плеера
// ('listening' → 'infoDelivery' с currentTime) и копим только время, когда
// currentTime идёт вперёд маленькими шагами (перемотка не считается).
//
// Пока xp.sql не выполнен — всё XP-оформление скрыто (body.no-xp).

// Числа XP — как xp_rule() в economy.sql (экономика 15.10.2026, docs/ECONOMY.md; scripts/economy-test.cjs сверяет).
// Пока economy.sql не запущен, сервер даёт по-старому — подписи здесь уже новые (разница — несколько дней).
const XP_NUM = { visit: 5, streak7: 25, streak30: 100, chat: 1, chat_day: 15, forum_thread: 8, forum_thread_day: 3, forum_post: 2, forum_post_day: 10,
  idea: 3, idea_day: 3, idea_done: 50, referral: 50, watch: 3, watch_day: 10, daily: 25, secret: 50, game_family: 3, game_day: 100, unity_win: 5 };
const XP_RULES = [
  ['👁', 'Смотреть видео на сайте', `+${XP_NUM.watch} за ролик (от 1 мин, Shorts — от 15 с), до ${XP_NUM.watch * XP_NUM.watch_day} в день`],
  ['📅', 'Заходить каждый день', `+${XP_NUM.visit} в день; стрик 7 дней — +${XP_NUM.streak7}, 30 дней — +${XP_NUM.streak30}`],
  ['🎯', 'Задание дня', `+${XP_NUM.daily} (в разделе «Игры», новое каждый день)`],
  ['💬', 'Писать в чат', `+${XP_NUM.chat} за сообщение, до ${XP_NUM.chat * XP_NUM.chat_day} в день`],
  ['🗂️', 'Форум', `+${XP_NUM.forum_thread} за тему (до ${XP_NUM.forum_thread_day} в день), +${XP_NUM.forum_post} за ответ (до ${XP_NUM.forum_post_day})`],
  ['💡', 'Идеи для видео', `+${XP_NUM.idea} за идею (до ${XP_NUM.idea_day} в день), +${XP_NUM.idea_done} если её сняли`],
  ['👥', 'Позвать друга', `до +${XP_NUM.referral} за каждого друга по твоей ссылке — когда он дойдёт до 3 и 5 уровня (и монеты, вещи: «Пригласи друзей»)`],
  ['🏆', 'Ачивки', 'от +5 до +300 за каждую, один раз'],
  ['💖', 'Донат', '+1 XP за каждый рубль (до 1000 за донат)'],
  ['🎮', 'Игры', `от +1 до +20 за победу; в одной игре — первые ${XP_NUM.game_family} победы за день, всего до ${XP_NUM.game_day} XP в день — играй в разные!`],
];
// Что даёт уровень — как level_ladder() в economy.sql (friend_limit, check_level_rewards): [уровень, значок, текст, числа]
// числа: friends — лимит друзей, coins — монеты один раз, vip — VIP на столько дней, fx — эффект ника, badge — значок-титул,
// part — вещь персонажа «за уровень» (avatar.js PARTS, 7-е поле). Рамки — FRAME_LEVELS ниже (только CSS).
const LEVEL_REWARDS = [
  [5,   '🖼️', 'Неоновая рамка аватара · заявки в друзья (до 15)', { friends: 15 }],
  [10,  '🏷️', 'Титул из своих ачивок рядом с ником · 🍂 след «Листопад»', { part: 'trail:leaves' }],
  [15,  '🥇', 'Золотая рамка · до 20 друзей · +100 🪙', { friends: 20, coins: 100 }],
  [20,  '🦉', 'Питомец «Совёнок» · значок «Бывалый» · до 25 друзей', { friends: 25, badge: 'level_20', part: 'pet:owl' }],
  [25,  '👥', 'До 30 друзей · +150 🪙', { friends: 30, coins: 150 }],
  [30,  '🌈', 'Радужная рамка · до 35 друзей · 🎟️ VIP на 3 дня', { friends: 35, vip: 3 }],
  [35,  '🏅', 'Медаль в руку · до 40 друзей', { friends: 40, part: 'item:medal' }],
  [40,  '🌟', 'Золотой ник · значок «Мастер» · до 45 друзей', { friends: 45, fx: 'gold', badge: 'level_40' }],
  [45,  '❄️', 'След «Снежинки» · +300 🪙', { coins: 300, part: 'trail:snow' }],
  [50,  '🔥', 'Огненная рамка · 🎟️ VIP на неделю', { vip: 7 }],
  [55,  '🐺', 'Питомец «Волчонок» · +400 🪙', { coins: 400, part: 'pet:wolf' }],
  [60,  '🌈', 'Радужный ник — навсегда', { fx: 'rainbow' }],
  [65,  '🔮', '«Хрустальный шар» в руку · +500 🪙', { coins: 500, part: 'item:orb' }],
  [70,  '☄️', 'След «Кометы»', { part: 'trail:comet' }],
  [75,  '👑', 'Значок «Живая легенда» · +700 🪙', { coins: 700, badge: 'level_75' }],
  [80,  '🦅', 'Питомец «Орёл»', { part: 'pet:eagle' }],
  [90,  '🌌', 'След «Галактика» · +1000 🪙', { coins: 1000, part: 'trail:galaxy' }],
  [100, '💎', 'Бриллиантовая рамка · значок «Бессмертный» · 🔸 VIP на месяц', { vip: 30, badge: 'level_100' }],
];
const XP_SOURCE_LABEL = { visit: 'Визиты', streak: 'Стрик', watch: 'Просмотры', chat: 'Чат', forum_thread: 'Темы', forum_post: 'Ответы', idea: 'Идеи', idea_done: 'Идея снята', referral: 'Друзья', ach: 'Ачивки', donation: 'Донаты', game: 'Игры', daily: 'Задание дня', secret: 'Секреты' };
const XP_TIERS = [30, 20, 10, 5]; // рамки ника по порогам уровня

let xpAvailable = null; // null — ещё не проверяли
const xpLevelCache = new Map();
const xpTitleCache = new Map();   // uid → код ачивки-титула (progression.sql → nick_extras) или null
let xpExtrasOk = null;            // есть ли nick_extras (progression.sql выполнен)

function xpTierClass(level){
  const t = XP_TIERS.find(n => level >= n);
  return t ? ' lv-t' + t : '';
}

// ── Проверка, что xp.sql выполнен ──
async function xpCheck(){
  if (xpAvailable !== null) return xpAvailable;
  if (typeof sbClient === 'undefined' || !sbClient) return false;
  try {
    const { error } = await sbClient.rpc('top_xp_week', { lim: 1 });
    xpAvailable = !error;
  } catch (e) { xpAvailable = false; }
  document.body.classList.toggle('no-xp', !xpAvailable);
  return xpAvailable;
}
setTimeout(() => { xpCheck().then(ok => { if (ok) { renderXpTop(); xpQueueBadges(); } }); }, 2000);

// ── Бейджи Lv N рядом с никами (чат, форум). Пачкой, с кэшем ──
let xpBadgeTimer = 0;
function xpQueueBadges(){
  clearTimeout(xpBadgeTimer);
  xpBadgeTimer = setTimeout(xpFillBadges, 250);
}
async function xpFillBadges(){
  if (!(await xpCheck())) return;
  const els = [...document.querySelectorAll('.lv-badge[data-lv-uid]:not([data-lv])')];
  if (!els.length) return;
  const need = [...new Set(els.map(e => e.dataset.lvUid).filter(u => u && !(xpLevelCache.has(u) && xpTitleCache.has(u))))];
  await xpLoadExtras(need);
  els.forEach(el => {
    const uid = el.dataset.lvUid;
    const lv = xpLevelCache.get(uid);
    if (!lv) return;
    el.dataset.lv = lv;
    el.textContent = 'Lv ' + lv;
    el.className = 'lv-badge' + xpTierClass(lv);
    el.title = 'Уровень ' + lv;
    const d = typeof ACH_BY_CODE !== 'undefined' && ACH_BY_CODE[xpTitleCache.get(uid)];
    if (d) el.insertAdjacentHTML('afterend', `<span class="nick-title" title="Титул">${d.icon} ${esc(d.title)}</span>`);
  });
}

// Уровень + титул пачкой; без progression.sql — только уровень (xp_levels)
async function xpLoadExtras(uids){
  for (let i = 0; i < uids.length; i += 200) {
    const part = uids.slice(i, i + 200);
    let rows = null;
    if (xpExtrasOk !== false) {
      const { data, error } = await sbClient.rpc('nick_extras', { uids: part });
      if (error) xpExtrasOk = false; else { xpExtrasOk = true; rows = data; }
    }
    if (!rows) rows = (await sbClient.rpc('xp_levels', { uids: part })).data;
    (rows || []).forEach(r => { xpLevelCache.set(r.user_id, r.level); xpTitleCache.set(r.user_id, r.title || null); });
  }
}
async function xpGetExtras(uid){
  if (!uid || !(await xpCheck())) return null;
  if (!xpLevelCache.has(uid) || !xpTitleCache.has(uid)) await xpLoadExtras([uid]);
  return { level: xpLevelCache.get(uid) || 1, title: xpTitleCache.get(uid) || null };
}

// Рамка аватара по уровню (лесенка): 5 неон, 15 золото, 30 радуга, 50 пламя, 100 бриллиант.
// Анимация — только в body.high. Стили — css/premium.css (.lv-frame-*), подписи — LEVEL_REWARDS выше.
const FRAME_LEVELS = [100, 50, 30, 15, 5];
function avatarFrameClass(level){ const lv = FRAME_LEVELS.find(x => level >= x); return lv ? 'lv-frame-' + lv : ''; }
async function applyLevelFrame(el, uid){
  if (!el) return;
  el.classList.remove(...FRAME_LEVELS.map(x => 'lv-frame-' + x), 'lv-frame-ref');
  const [ex, amb] = await Promise.all([xpGetExtras(uid), window.D37Ref?.hasFrame?.(uid) || false]);
  // «Посол» (5 друзей по ссылке дошли до 5 уровня, js/core/ref.js; выключается на странице приглашений) — вместо рамки уровня
  const cls = amb ? 'lv-frame-ref' : ex && avatarFrameClass(ex.level);
  if (cls) el.classList.add(cls);
}

// ── Топ недели на главной ──
async function renderXpTop(){
  const box = document.getElementById('xpTopWeek');
  const list = document.getElementById('xpTopList');
  if (!box || !list || !(await xpCheck())) return;
  const { data, error } = await sbClient.rpc('top_xp_week', { lim: 5 });
  if (error || !data || !data.length) { box.hidden = true; return; }
  box.hidden = false;
  list.innerHTML = data.map((r, i) => `
    <li class="xp-top-item">
      <span class="xp-top-place">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
      <a class="xp-top-nick" href="#/profile/${esc(r.user_id)}">${esc(r.nick || 'user')}</a>
      <span class="lv-badge${xpTierClass(r.level)}">Lv ${r.level}</span>
      <span class="xp-top-xp">${r.xp} XP</span>
    </li>`).join('');
}

// ── Карточка на профиле ──
async function renderProfileXp(uid, isOwn){
  const card = document.getElementById('profileXpCard');
  if (!card) return;
  if (!(await xpCheck())) { card.hidden = true; return; }
  const { data, error } = await sbClient.rpc('xp_summary', { uid });
  if (error || !data) { card.hidden = true; return; }
  card.hidden = false;
  const span = Math.max(data.level_to - data.level_from, 1);
  const pct = Math.min(100, Math.max(0, (data.xp - data.level_from) / span * 100));
  document.getElementById('pxLevel').textContent = data.level;
  document.getElementById('pxLevel').className = xpTierClass(data.level).trim();
  document.getElementById('pxXp').textContent = data.xp + ' XP';
  document.getElementById('pxNext').textContent = `до ур. ${data.level + 1}: ${Math.max(0, data.level_to - data.xp)} XP`;
  document.getElementById('pxBar').style.width = pct.toFixed(1) + '%';
  document.getElementById('pxToday').textContent = isOwn ? `Сегодня: +${data.today} XP` : '';
  const week = Object.entries(data.week || {}).sort((a, b) => b[1] - a[1]);
  document.getElementById('pxWeek').innerHTML = week.length
    ? '<span class="xp-week-t">За неделю:</span>' + week.map(([k, v]) => `<span class="xp-chip">${XP_SOURCE_LABEL[k] || k} <b>+${v}</b></span>`).join('')
    : '';
  const rules = document.getElementById('pxRules');
  if (rules && !rules.innerHTML) rules.innerHTML = XP_RULES.map(([i, t, d]) => `<div class="xp-rule"><span>${i}</span><div><b>${t}</b><small>${d}</small></div></div>`).join('');
  card.querySelectorAll('.xp-help').forEach(d => { d.hidden = !isOwn; });
  const rw = document.getElementById('pxRewards');
  if (rw) rw.innerHTML = LEVEL_REWARDS.map(([lv, icon, text]) => `
    <div class="xp-reward${data.level >= lv ? ' got' : ''}">
      <span class="xp-reward-lv">${lv}</span><span>${icon}</span><span>${text}</span>${data.level >= lv ? '<b>✓</b>' : ''}
    </div>`).join('') + '<div class="xp-reward-note">VIP Silver и Gold — только за поддержку стрима: <a href="/vip">что даёт VIP</a></div>';
  xpLevelCache.set(uid, data.level);
}

// ── Учёт просмотра видео ──
// iframe должен быть с enablejsapi=1&origin=<сайт>. minSec — сколько секунд реального
// воспроизведения нужно для награды.
const xpTracked = new Map(); // contentWindow → { id, minSec, acc, last, done }
function xpTrackIframe(iframe, videoId, minSec){
  if (!iframe || !videoId) return;
  const start = () => {
    const w = iframe.contentWindow;
    if (!w) return;
    xpTracked.set(w, { id: videoId, minSec, acc: 0, last: null, done: false });
    // «Подписка» на события плеера (так делает сам YouTube IFrame API)
    try { w.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch (e) {}
  };
  iframe.addEventListener('load', start, { once: true });
}
window.addEventListener('message', e => {
  if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin)) return;
  const t = xpTracked.get(e.source);
  if (!t || t.done) return;
  let msg;
  try { msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (err) { return; }
  const cur = msg?.info?.currentTime;
  if (typeof cur !== 'number') return;
  if (t.last != null) {
    const d = cur - t.last;
    if (d > 0 && d <= 2.5) t.acc += d; // обычное воспроизведение; перемотку и повтор не считаем
  }
  t.last = cur;
  if (t.acc >= t.minSec) { t.done = true; xpClaimWatch(t.id); }
});

let xpGuestHintShown = false;
async function xpClaimWatch(videoId){
  if (!(await xpCheck())) return;
  if (!currentUser) {
    if (!xpGuestHintShown) { xpGuestHintShown = true; xpToast('Войди — и за просмотры будут начисляться XP', 'guest'); }
    return;
  }
  const { data, error } = await sbClient.rpc('claim_watch_xp', { p_video_id: videoId });
  if (error || !data) return;
  if (data.ok) {
    xpToast(`+${data.amount} XP за просмотр`);
    xpLevelCache.delete(currentUser.id);
  }
}

// ── Всплывашка «+5 XP» ──
function xpToast(text, kind){
  let el = document.getElementById('xpToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'xpToast';
    el.className = 'xp-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.innerHTML = kind === 'guest'
    ? `<span>⚡</span><span>${esc(text)}</span><button type="button" onclick="openGlobalAuth()">Войти</button>`
    : `<span>⚡</span><span>${esc(text)}</span>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), kind === 'guest' ? 6000 : 3000);
}

window.addEventListener('d37:auth', () => { if (xpAvailable) { renderXpTop(); xpQueueBadges(); } });
