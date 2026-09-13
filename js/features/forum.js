// ═══════════════════════════════════════
//  ФОРУМ
//  Гостям форум закрыт на запись (RLS в forum.sql), только чтение.
//  Права на удаление — как в чате: admin/moderator/helper удаляют любое,
//  автор — своё. Пин/лок темы — только admin (защищено триггером в БД,
//  см. forum.sql, не только фронтендом).
// ═══════════════════════════════════════

let forumCurrentThreadId = null;

async function renderForumPage(threadId){
  document.getElementById('forumLoggedOutHint').style.display = currentUser ? 'none' : 'block';
  document.getElementById('forumCreateBtn').style.display = currentUser ? 'inline-flex' : 'none';

  if (threadId) {
    forumCurrentThreadId = threadId;
    document.getElementById('forumListView').style.display = 'none';
    document.getElementById('forumThreadView').style.display = 'block';
    await loadForumThread(threadId);
  } else {
    forumCurrentThreadId = null;
    document.getElementById('forumListView').style.display = 'block';
    document.getElementById('forumThreadView').style.display = 'none';
    await loadForumThreads();
  }
}

async function loadForumThreads(){
  const statusEl = document.getElementById('forumThreadsStatus');
  const listEl = document.getElementById('forumThreadsList');
  if (!sbClient) { statusEl.textContent = 'Форум недоступен offline'; return; }
  statusEl.textContent = 'Загружаем...'; listEl.innerHTML = '';
  try {
    const { data: threads, error } = await sbClient
      .from('forum_threads')
      .select('*, profiles(nick), forum_posts(count)')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    if (!threads || !threads.length) { statusEl.textContent = 'Пока нет ни одной темы — стань первым!'; return; }
    statusEl.textContent = '';
    listEl.innerHTML = threads.map(t => {
      const nick = t.profiles?.nick || '?';
      const postsCount = t.forum_posts?.[0]?.count ?? 0;
      const date = new Date(t.created_at).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
      return `
        <a href="#/forum/${t.id}" style="display:flex;justify-content:space-between;align-items:center;gap:1rem;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1rem 1.2rem;text-decoration:none;color:inherit;transition:border-color .2s" onmouseover="this.style.borderColor='var(--tw)'" onmouseout="this.style.borderColor='var(--border)'">
          <div style="min-width:0">
            <div style="font-weight:700;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${t.pinned ? '📌 ' : ''}${t.locked ? '🔒 ' : ''}${esc(t.title)}
            </div>
            <div style="font-size:.72rem;color:var(--muted);margin-top:.3rem">${esc(nick)} · ${date}</div>
          </div>
          <div style="flex-shrink:0;font-size:.75rem;color:var(--muted);white-space:nowrap">💬 ${postsCount}</div>
        </a>`;
    }).join('');
  } catch(e) {
    statusEl.textContent = 'Ошибка загрузки: ' + (e.message || e);
  }
}

async function loadForumThread(id){
  const headerEl = document.getElementById('forumThreadHeader');
  const postsEl = document.getElementById('forumPostsList');
  headerEl.innerHTML = 'Загружаем...'; postsEl.innerHTML = '';
  try {
    const { data: thread, error: tErr } = await sbClient
      .from('forum_threads').select('*, profiles(nick)').eq('id', id).single();
    if (tErr || !thread) throw tErr || new Error('Тема не найдена');

    const isAdmin = currentRole === 'admin';
    const canModerate = currentRole === 'admin' || currentRole === 'moderator' || currentRole === 'helper';
    const isThreadOwner = currentUser?.id === thread.author_id;

    headerEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap">
        <div>
          <div style="font-size:1.15rem;font-weight:800">${thread.pinned?'📌 ':''}${thread.locked?'🔒 ':''}${esc(thread.title)}</div>
          <div style="font-size:.75rem;color:var(--muted);margin-top:.3rem">${esc(thread.profiles?.nick||'?')} · ${new Date(thread.created_at).toLocaleString('ru-RU')}</div>
        </div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          ${isAdmin ? `<button onclick="toggleForumPin(${thread.id}, ${!thread.pinned})" class="profile-admin-btn" style="padding:.4rem .7rem;font-size:.7rem">${thread.pinned?'Открепить':'📌 Закрепить'}</button>` : ''}
          ${isAdmin ? `<button onclick="toggleForumLock(${thread.id}, ${!thread.locked})" class="profile-admin-btn" style="padding:.4rem .7rem;font-size:.7rem">${thread.locked?'Открыть':'🔒 Закрыть'}</button>` : ''}
          ${(canModerate || isThreadOwner) ? `<button onclick="deleteForumThread(${thread.id})" style="padding:.4rem .7rem;font-size:.7rem;border-radius:8px;border:1px solid rgba(255,45,85,.3);background:rgba(255,45,85,.08);color:var(--accent);cursor:pointer">🗑 Удалить тему</button>` : ''}
        </div>
      </div>`;

    const { data: posts, error: pErr } = await sbClient
      .from('forum_posts').select('*, profiles(nick, role)').eq('thread_id', id).order('created_at', { ascending: true });
    if (pErr) throw pErr;

    postsEl.innerHTML = (posts || []).map(p => {
      const nick = p.profiles?.nick || '?';
      const role = p.profiles?.role;
      const badge = ROLE_BADGE_HTML[role] || '';
      const canDelete = canModerate || currentUser?.id === p.author_id;
      return `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1rem 1.2rem" data-post-id="${p.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem">
            <div style="font-weight:700;font-size:.82rem">${esc(nick)} ${badge}</div>
            <div style="display:flex;align-items:center;gap:.6rem">
              <span style="font-size:.7rem;color:var(--muted)">${new Date(p.created_at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
              ${canDelete ? `<button onclick="deleteForumPost(${p.id})" aria-label="Удалить ответ" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.75rem">🗑</button>` : ''}
            </div>
          </div>
          <div style="font-size:.85rem;margin-top:.5rem;white-space:pre-wrap;word-break:break-word;line-height:1.6">${esc(p.body)}</div>
        </div>`;
    }).join('');

    const canReply = currentUser && !thread.locked;
    document.getElementById('forumReplyBox').style.display = canReply ? 'block' : 'none';
    document.getElementById('forumThreadLockedHint').style.display = thread.locked ? 'block' : 'none';
  } catch(e) {
    headerEl.innerHTML = `<p style="color:var(--muted)">Не удалось загрузить тему: ${esc(e.message || String(e))}</p>`;
  }
}

function openForumCreate(){
  if (!currentUser) { openGlobalAuth(); return; }
  document.getElementById('forumNewTitle').value = '';
  document.getElementById('forumNewBody').value = '';
  document.getElementById('forumCreateError').textContent = '';
  document.getElementById('forumCreateModal').style.display = 'flex';
  trapModalFocus(document.getElementById('forumCreateModal'));
}
function closeForumCreate(){
  document.getElementById('forumCreateModal').style.display = 'none';
  releaseModalFocus();
}

async function submitForumThread(){
  const errEl = document.getElementById('forumCreateError');
  const title = document.getElementById('forumNewTitle').value.trim();
  const body = document.getElementById('forumNewBody').value.trim();
  errEl.textContent = '';
  if (!title) { errEl.textContent = 'Введи заголовок темы'; return; }
  if (!body) { errEl.textContent = 'Напиши хотя бы пару слов в теме'; return; }

  try {
    const { data: thread, error: tErr } = await sbClient
      .from('forum_threads').insert([{ title, author_id: currentUser.id }]).select().single();
    if (tErr) throw tErr;
    const { error: pErr } = await sbClient
      .from('forum_posts').insert([{ thread_id: thread.id, author_id: currentUser.id, body }]);
    if (pErr) throw pErr;
    closeForumCreate();
    location.hash = `#/forum/${thread.id}`;
  } catch(e) {
    errEl.textContent = 'Не удалось создать тему: ' + (e.message || e);
  }
}

async function submitForumReply(){
  const input = document.getElementById('forumReplyInput');
  const body = input.value.trim();
  if (!body || !forumCurrentThreadId) return;
  try {
    const { error } = await sbClient.from('forum_posts').insert([{ thread_id: forumCurrentThreadId, author_id: currentUser.id, body }]);
    if (error) throw error;
    input.value = '';
    loadForumThread(forumCurrentThreadId);
  } catch(e) {
    alert('Не удалось отправить ответ: ' + (e.message || e));
  }
}

async function deleteForumThread(id){
  if (!confirm('Удалить тему целиком, со всеми ответами?')) return;
  try {
    await sbClient.from('forum_threads').delete().eq('id', id);
    location.hash = '#/forum';
  } catch(e) {
    alert('Не удалось удалить: ' + (e.message || e));
  }
}
async function deleteForumPost(id){
  if (!confirm('Удалить ответ?')) return;
  try {
    await sbClient.from('forum_posts').delete().eq('id', id);
    if (forumCurrentThreadId) loadForumThread(forumCurrentThreadId);
  } catch(e) {
    alert('Не удалось удалить: ' + (e.message || e));
  }
}
async function toggleForumPin(id, pinned){
  try { await sbClient.from('forum_threads').update({ pinned }).eq('id', id); loadForumThread(id); }
  catch(e) { alert('Не получилось: ' + (e.message || e)); }
}
async function toggleForumLock(id, locked){
  try { await sbClient.from('forum_threads').update({ locked }).eq('id', id); loadForumThread(id); }
  catch(e) { alert('Не получилось: ' + (e.message || e)); }
}
