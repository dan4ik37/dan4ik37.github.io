// ═══════════════════════════════════════
//  ДОСКА ИДЕЙ ДЛЯ ВИДЕО (#/ideas) — таблицы и правила в ideas.sql
// ═══════════════════════════════════════
// Все ограничения (3 идеи в сутки, один голос, не за свою идею, статус меняет
// только админ, счётчик голосов) проверяет БД — здесь только интерфейс.
// Пока ideas.sql не выполнен, пункт меню скрыт (body.no-ideas), а на самой
// странице — подсказка (админу — какой файл запустить).

const IDEA_STATUS = {
  new:      { label: 'Новая',     cls: 'st-new' },
  planned:  { label: 'В планах',  cls: 'st-planned' },
  done:     { label: 'Сделано',   cls: 'st-done' },
  rejected: { label: 'Отклонено', cls: 'st-rejected' },
};
let ideasSort = 'top', ideasFilter = '';
let ideasRows = [];
let myIdeaVotes = new Set();
let ideasLoading = false;

function ideasMissing(err){
  // функции/таблицы нет — ideas.sql ещё не запускали
  return err && (err.code === 'PGRST202' || err.code === '42P01' || err.code === '42883' || /list_ideas|does not exist|schema cache/i.test(err.message || ''));
}

// Проверка при загрузке сайта — прячем пункт меню, если раздел не подключён
setTimeout(async () => {
  if (typeof sbClient === 'undefined' || !sbClient) return;
  try {
    const { error } = await sbClient.rpc('list_ideas', { p_status: null, p_sort: 'new', p_limit: 1 });
    document.body.classList.toggle('no-ideas', ideasMissing(error));
  } catch (e) {}
}, 2500);

window.addEventListener('d37:auth', () => { if (document.body.dataset.route === 'ideas') renderIdeasPage(); });

async function renderIdeasPage(){
  const logged = !!(typeof currentUser !== 'undefined' && currentUser);
  document.getElementById('ideasForm').hidden = !logged;
  document.getElementById('ideasGuest').hidden = logged;
  await loadIdeas();
}

function setIdeasSort(s){
  ideasSort = s;
  document.querySelectorAll('[data-isort]').forEach(b => b.classList.toggle('active', b.dataset.isort === s));
  loadIdeas();
}
function setIdeasFilter(f){
  ideasFilter = f;
  document.querySelectorAll('[data-ifilter]').forEach(b => b.classList.toggle('active', b.dataset.ifilter === f));
  loadIdeas();
}

async function loadIdeas(){
  const statusEl = document.getElementById('ideasStatus');
  const listEl = document.getElementById('ideasList');
  const setup = document.getElementById('ideasSetup');
  if (!sbClient) { statusEl.textContent = 'Нет подключения к базе'; return; }
  if (ideasLoading) return;
  ideasLoading = true;
  if (!ideasRows.length) statusEl.textContent = 'Загружаем идеи…';
  try {
    const { data, error } = await sbClient.rpc('list_ideas', { p_status: ideasFilter || null, p_sort: ideasSort, p_limit: 100 });
    if (error) throw error;
    setup.hidden = true;
    document.getElementById('ideasTools').hidden = false;
    ideasRows = data || [];
    myIdeaVotes = new Set();
    if (currentUser && ideasRows.length) {
      const { data: votes } = await sbClient.from('idea_votes').select('idea_id').eq('user_id', currentUser.id).in('idea_id', ideasRows.map(r => r.id));
      (votes || []).forEach(v => myIdeaVotes.add(v.idea_id));
    }
    statusEl.textContent = ideasRows.length ? '' : (ideasFilter ? 'Здесь пока пусто.' : 'Идей пока нет — предложи первую!');
    listEl.innerHTML = ideasRows.map(ideaCardHtml).join('');
  } catch (e) {
    if (ideasMissing(e)) {
      setup.hidden = false;
      document.getElementById('ideasSetupAdmin').hidden = currentRole !== 'admin';
      document.getElementById('ideasTools').hidden = true;
      document.getElementById('ideasForm').hidden = true;
      document.getElementById('ideasGuest').hidden = true;
      statusEl.textContent = '';
      listEl.innerHTML = '';
    } else {
      statusEl.textContent = 'Не удалось загрузить: ' + (e.message || e);
    }
  } finally {
    ideasLoading = false;
  }
}

function ideaCardHtml(r){
  const st = IDEA_STATUS[r.status] || IDEA_STATUS.new;
  const me = currentUser?.id;
  const own = me && r.author_id === me;
  const voted = myIdeaVotes.has(r.id);
  const isAdmin = currentRole === 'admin';
  const isStaff = isAdmin || currentRole === 'moderator' || currentRole === 'helper';
  const canDelete = (own && r.status === 'new') || isStaff;
  const date = new Date(r.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const badge = (typeof ROLE_BADGE_HTML !== 'undefined' && ROLE_BADGE_HTML[r.author_role]) || '';
  const voteTitle = !me ? 'Войди, чтобы голосовать' : own ? 'За свою идею голосовать нельзя' : voted ? 'Снять голос' : 'Поддержать идею';
  return `
  <article class="id-card ${st.cls}" data-id="${r.id}">
    <button type="button" class="id-vote${voted ? ' voted' : ''}" onclick="toggleIdeaVote(${r.id})" title="${voteTitle}" ${own ? 'disabled' : ''} aria-pressed="${voted}">
      <span class="id-vote-arrow">▲</span><span class="id-vote-n">${r.votes}</span>
    </button>
    <div class="id-main">
      <div class="id-top">
        <span class="id-badge">${st.label}</span>
        <h3 class="id-title">${esc(r.title)}</h3>
      </div>
      ${r.body ? `<p class="id-body">${esc(r.body)}</p>` : ''}
      ${r.status === 'done' && r.video_id ? `<a class="id-watch" href="/v/${esc(r.video_id)}" data-vid="${esc(r.video_id)}">▶ Смотреть ролик</a>` : ''}
      <div class="id-meta">
        <a href="#/profile/${esc(r.author_id)}" class="id-author">${esc(r.author_nick || 'user')}</a>${badge} · ${esc(date)}
        ${canDelete ? `<button type="button" class="id-link" onclick="deleteIdea(${r.id})">Удалить</button>` : ''}
      </div>
      ${isAdmin ? `
      <div class="id-admin">
        ${Object.entries(IDEA_STATUS).map(([k, v]) => `<button type="button" class="id-chip${r.status === k ? ' active' : ''}" onclick="setIdeaStatus(${r.id},'${k}')">${v.label}</button>`).join('')}
      </div>` : ''}
    </div>
  </article>`;
}

async function toggleIdeaVote(id){
  if (!currentUser) { openGlobalAuth(); return; }
  const row = ideasRows.find(r => r.id === id);
  if (!row || row.author_id === currentUser.id) return;
  const had = myIdeaVotes.has(id);
  // Сразу показываем результат, при ошибке откатываем
  had ? myIdeaVotes.delete(id) : myIdeaVotes.add(id);
  row.votes += had ? -1 : 1;
  rerenderIdeaCard(row);
  const q = had
    ? sbClient.from('idea_votes').delete().eq('idea_id', id).eq('user_id', currentUser.id)
    : sbClient.from('idea_votes').insert([{ idea_id: id, user_id: currentUser.id }]);
  const { error } = await q;
  if (error && !(error.code === '23505' && !had)) { // 23505 — голос уже был, это не ошибка
    had ? myIdeaVotes.add(id) : myIdeaVotes.delete(id);
    row.votes += had ? 1 : -1;
    rerenderIdeaCard(row);
  }
}
function rerenderIdeaCard(row){
  const el = document.querySelector(`.id-card[data-id="${row.id}"]`);
  if (el) el.outerHTML = ideaCardHtml(row);
}

async function submitIdea(e){
  e.preventDefault();
  if (!currentUser) { openGlobalAuth(); return; }
  const titleEl = document.getElementById('ideaTitle');
  const bodyEl = document.getElementById('ideaBody');
  const msg = document.getElementById('ideaMsg');
  const btn = document.getElementById('ideaSubmit');
  const title = titleEl.value.trim(), body = bodyEl.value.trim();
  if (title.length < 5) { msg.textContent = 'Хотя бы 5 символов'; return; }
  btn.disabled = true; msg.textContent = '';
  const { error } = await sbClient.from('ideas').insert([{ author_id: currentUser.id, title, body }]);
  btn.disabled = false;
  if (error) { msg.textContent = /3 идей/.test(error.message) ? error.message : 'Не получилось: ' + error.message; return; }
  titleEl.value = ''; bodyEl.value = '';
  document.getElementById('ideaCount').textContent = '0 / 500';
  msg.textContent = '✓ Идея добавлена!';
  setTimeout(() => { if (msg.textContent.startsWith('✓')) msg.textContent = ''; }, 2500);
  if (ideasSort !== 'new' || ideasFilter) { setIdeasFilter(''); setIdeasSort('new'); } else loadIdeas();
}
// «Смотреть ролик» — открываем в окне на сайте (название берём из карточки, не из onclick-строки)
document.getElementById('ideasList')?.addEventListener('click', e => {
  const a = e.target.closest('a.id-watch');
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  const title = a.closest('.id-card')?.querySelector('.id-title')?.textContent || '';
  openVid(a.dataset.vid, title, '', '');
});
document.getElementById('ideaBody')?.addEventListener('input', e => {
  document.getElementById('ideaCount').textContent = e.target.value.length + ' / 500';
});

async function deleteIdea(id){
  const go = () => sbClient.from('ideas').delete().eq('id', id).then(({ error }) => {
    if (error) alert('Не удалось удалить: ' + error.message); else loadIdeas();
  });
  if (typeof askConfirm === 'function') askConfirm('Удалить эту идею?', go, 'Удалить'); else if (confirm('Удалить эту идею?')) go();
}

async function setIdeaStatus(id, status){
  const patch = { status };
  if (status === 'done') {
    const raw = prompt('Ссылка или ID ролика на YouTube (можно оставить пустым):', '') || '';
    const m = raw.match(/(?:v=|youtu\.be\/|shorts\/|\/v\/)([A-Za-z0-9_-]{11})/) || raw.trim().match(/^([A-Za-z0-9_-]{11})$/);
    patch.video_id = m ? m[1] : null;
  }
  const { error } = await sbClient.from('ideas').update(patch).eq('id', id);
  if (error) alert('Не удалось: ' + error.message); else loadIdeas();
}
