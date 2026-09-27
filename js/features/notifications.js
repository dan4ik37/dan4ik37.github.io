// ═══════════════════════════════════════
//  УВЕДОМЛЕНИЯ 🔔 — таблица и триггеры в notifications.sql
// ═══════════════════════════════════════
// Создаёт уведомления только база (ответ в теме, @упоминание, идеи, друзья,
// рефералы). Здесь — колокольчик: счётчик, панель, живое обновление через
// Supabase Realtime (+ опрос раз в 90 с на случай, если Realtime недоступен),
// «Прочитать все», переход по клику, число непрочитанных в заголовке вкладки.
// Пока notifications.sql не выполнен — колокольчик не показывается.

const NOTIF_ICON = {
  forum_reply: '💬', mention: '@', friend_request: '🤝', friend_accept: '🤝',
  idea_planned: '💡', idea_done: '🎬', idea_rejected: '💭', idea_votes: '🔥', referral: '🔗'
};
let notifItems = [];
let notifUnread = 0;
let notifChannel = null;
let notifPollTimer = 0;
let notifAvailable = null;
const notifBaseTitle = document.title;

window.addEventListener('d37:auth', () => { currentUser ? notifStart() : notifStop(); });

async function notifStart(){
  if (!currentUser || !sbClient) return;
  const first = await notifLoad();
  if (!first) return; // таблицы нет — SQL ещё не выполнен
  document.getElementById('notifWrap').hidden = false;
  notifSubscribe();
  clearInterval(notifPollTimer);
  notifPollTimer = setInterval(notifLoad, 90000);
}
function notifStop(){
  document.getElementById('notifWrap').hidden = true;
  closeNotifPanel();
  notifItems = []; notifUnread = 0; notifUpdateCount();
  clearInterval(notifPollTimer);
  if (notifChannel) { try { sbClient.removeChannel(notifChannel); } catch (e) {} notifChannel = null; }
}

async function notifLoad(){
  if (!currentUser) return false;
  const uid = currentUser.id;
  const [list, unread] = await Promise.all([
    sbClient.from('notifications').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(40),
    sbClient.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', uid).is('read_at', null)
  ]);
  if (list.error) { notifAvailable = false; return false; }
  notifAvailable = true;
  notifItems = list.data || [];
  notifUnread = unread.count || 0;
  await notifFreshNicks(notifItems);
  notifUpdateCount();
  if (document.getElementById('notifWrap').classList.contains('open')) notifRender();
  return true;
}

// Ник автора — актуальный из профиля (в уведомлении мог остаться старый/временный)
const notifNickCache = new Map();
async function notifFreshNicks(items){
  const need = [...new Set(items.map(n => n.actor_id).filter(id => id && !notifNickCache.has(id)))];
  if (need.length) {
    const { data } = await sbClient.from('profiles').select('id, nick').in('id', need);
    (data || []).forEach(p => notifNickCache.set(p.id, p.nick));
  }
  items.forEach(n => { if (n.actor_id && notifNickCache.get(n.actor_id)) n.actor_nick = notifNickCache.get(n.actor_id); });
}

function notifSubscribe(){
  if (notifChannel || !sbClient.channel) return;
  const uid = currentUser.id;
  notifChannel = sbClient.channel('notif-' + uid)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, async payload => {
      const n = payload.new;
      if (!n || notifItems.some(x => x.id === n.id)) return;
      await notifFreshNicks([n]);
      notifItems.unshift(n);
      notifUnread++;
      notifUpdateCount(true);
      if (document.getElementById('notifWrap').classList.contains('open')) notifRender();
      else notifToast(n);
    })
    .subscribe();
}

function notifUpdateCount(bump){
  const c = document.getElementById('notifCount');
  if (c) {
    c.hidden = !notifUnread;
    c.textContent = notifUnread > 99 ? '99+' : notifUnread;
    if (bump) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
  }
  document.getElementById('notifBtn')?.setAttribute('aria-label', notifUnread ? `Уведомления: ${notifUnread} новых` : 'Уведомления');
  document.title = notifUnread ? `(${notifUnread}) ${notifBaseTitle}` : notifBaseTitle;
}

function notifTimeAgo(iso){
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return Math.floor(s / 60) + ' мин назад';
  if (s < 86400) return Math.floor(s / 3600) + ' ч назад';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' дн назад';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function notifRender(){
  const list = document.getElementById('notifList');
  if (!list) return;
  document.getElementById('notifReadAll').hidden = !notifUnread;
  if (!notifItems.length) {
    list.innerHTML = `<div class="notif-empty"><div>🔔</div><b>Пока тихо</b><span>Здесь появятся ответы на форуме, упоминания в чате, новости по твоим идеям и заявки в друзья.</span></div>`;
    return;
  }
  list.innerHTML = notifItems.map(n => `
    <button type="button" class="notif-item${n.read_at ? '' : ' unread'}" data-id="${n.id}">
      <span class="notif-ic">${NOTIF_ICON[n.kind] || '🔔'}</span>
      <span class="notif-text">
        <span class="notif-title">${n.actor_nick ? `<b>${esc(n.actor_nick)}</b> ` : ''}${esc(n.title)}</span>
        ${n.body ? `<span class="notif-body">${esc(n.body)}</span>` : ''}
        <span class="notif-time">${notifTimeAgo(n.created_at)}</span>
      </span>
    </button>`).join('');
}
document.getElementById('notifList')?.addEventListener('click', e => {
  const b = e.target.closest('.notif-item');
  if (!b) return;
  const n = notifItems.find(x => x.id === +b.dataset.id);
  if (n) openNotif(n);
});

async function openNotif(n){
  if (!n.read_at) {
    n.read_at = new Date().toISOString();
    notifUnread = Math.max(0, notifUnread - 1);
    notifUpdateCount();
    sbClient.rpc('mark_notifications_read', { p_ids: [n.id] });
  }
  closeNotifPanel();
  const link = n.link || '';
  const vid = link.match(/^\/v\/([A-Za-z0-9_-]{11})$/);
  if (vid && typeof openVid === 'function') openVid(vid[1], (n.body || '').replace(/^«|»$/g, ''), '', '');
  else if (link.startsWith('#')) location.hash = link;
  else if (link) location.href = link;
}

async function markAllNotifsRead(){
  if (!notifUnread) return;
  const now = new Date().toISOString();
  notifItems.forEach(n => { if (!n.read_at) n.read_at = now; });
  notifUnread = 0;
  notifUpdateCount();
  notifRender();
  await sbClient.rpc('mark_notifications_read', { p_ids: null });
}

function toggleNotifPanel(e){
  e?.stopPropagation();
  const w = document.getElementById('notifWrap');
  if (w.classList.contains('open')) { closeNotifPanel(); return; }
  w.classList.add('open');
  document.getElementById('notifBtn').setAttribute('aria-expanded', 'true');
  notifRender();
  notifLoad(); // освежить на всякий случай
}
function closeNotifPanel(){
  const w = document.getElementById('notifWrap');
  if (!w) return;
  w.classList.remove('open');
  document.getElementById('notifBtn')?.setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', e => { if (!e.target.closest('#notifWrap')) closeNotifPanel(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNotifPanel(); });
window.addEventListener('hashchange', closeNotifPanel);

// Всплывашка о новом уведомлении (панель закрыта)
function notifToast(n){
  let el = document.getElementById('notifToast');
  if (!el) {
    el = document.createElement('button');
    el.type = 'button';
    el.id = 'notifToast';
    el.className = 'notif-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.innerHTML = `<span class="notif-ic">${NOTIF_ICON[n.kind] || '🔔'}</span><span>${n.actor_nick ? `<b>${esc(n.actor_nick)}</b> ` : ''}${esc(n.title)}</span>`;
  el.onclick = () => { el.classList.remove('show'); openNotif(n); };
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 5000);
}
