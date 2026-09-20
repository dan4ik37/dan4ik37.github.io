// ═══════════════════════════════════════════════════════════════════
//  ПОИСК ТИММЕЙТОВ (LFG) — заявки "ищу игроков в <игру>" + подбор
//  людей, у которых эта игра уже в любимых (profiles.favorite_games).
//  См. lfg-and-mini-profile.sql.
// ═══════════════════════════════════════════════════════════════════

let lfgGameMatchTimer = null;

async function renderLfgPage(){
  const createBox = document.getElementById('lfgCreateBox');
  const loggedOutHint = document.getElementById('lfgLoggedOutHint');
  if (createBox) createBox.style.display = currentUser ? 'block' : 'none';
  if (loggedOutHint) loggedOutHint.style.display = currentUser ? 'none' : 'block';

  const statusEl = document.getElementById('lfgStatus');
  const listEl = document.getElementById('lfgList');
  statusEl.textContent = 'Загружаем...';
  listEl.innerHTML = '';
  try {
    const { data: posts, error } = await sbClient
      .from('lfg_posts')
      .select('*, profiles(nick, avatar_url, role, is_vip, vip_until, total_donated)')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    if (!posts || !posts.length) { statusEl.textContent = 'Пока нет открытых заявок — стань первым!'; return; }
    statusEl.textContent = '';
    listEl.innerHTML = posts.map(p => renderLfgCard(p)).join('');
  } catch(e) {
    statusEl.textContent = 'Не удалось загрузить: ' + (e.message || e);
  }
}

function renderLfgCard(p){
  const nick = p.profiles?.nick || '?';
  const nickHtml = (typeof renderNickWithVip === 'function')
    ? renderNickWithVip(nick, p.profiles, ROLE_BADGE_HTML[p.profiles?.role] || '')
    : esc(nick);
  const isOwn = currentUser?.id === p.author_id;
  const canModerate = currentRole === 'admin' || currentRole === 'moderator' || currentRole === 'helper';
  const avatarStyle = p.profiles?.avatar_url ? `background-image:url('${p.profiles.avatar_url}')` : '';
  const ago = (typeof timeAgoRu === 'function') ? timeAgoRu(p.created_at) : new Date(p.created_at).toLocaleDateString('ru-RU');
  return `
    <div class="card-fade-in" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1rem 1.2rem" data-lfg-id="${p.id}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.8rem">
        <div style="min-width:0">
          <div style="font-weight:800;font-size:.92rem">🎮 ${esc(p.game)}</div>
          <div style="font-size:.72rem;color:var(--muted);margin-top:.25rem;display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
            <div style="width:20px;height:20px;border-radius:50%;background:var(--tw) center/cover;${avatarStyle};display:inline-flex;align-items:center;justify-content:center;font-size:.55rem;font-weight:800;color:#fff;flex-shrink:0;cursor:pointer" onclick="openMiniProfile('${p.author_id}','${nick.replace(/'/g,"\\'")}',this)">${p.profiles?.avatar_url ? '' : nick.substring(0,2).toUpperCase()}</div>
            <span onclick="openMiniProfile('${p.author_id}','${nick.replace(/'/g,"\\'")}',this)" style="cursor:pointer">${nickHtml}</span>
            · нужно ещё ${p.players_needed} · ${ago}
          </div>
        </div>
        <div style="display:flex;gap:.4rem;flex-shrink:0">
          ${isOwn || canModerate ? `<button onclick="closeLfgPost(${p.id})" title="Закрыть заявку (набрали игроков)" style="background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);color:#22c55e;border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:.75rem">✓</button>` : ''}
          ${isOwn || canModerate ? `<button onclick="deleteLfgPost(${p.id})" title="Удалить заявку" style="background:rgba(255,45,85,.1);border:1px solid rgba(255,45,85,.25);color:var(--accent);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:.75rem">✕</button>` : ''}
        </div>
      </div>
      ${p.description ? `<div style="font-size:.8rem;margin-top:.6rem;line-height:1.5;white-space:pre-wrap;word-break:break-word">${esc(p.description)}</div>` : ''}
      ${!isOwn ? `<button onclick="respondToLfg('${p.author_id}','${nick.replace(/'/g,"\\'")}')" style="margin-top:.7rem;padding:.5rem 1rem;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-weight:700;font-size:.78rem;cursor:pointer;font-family:'Montserrat',sans-serif">🤝 Откликнуться</button>` : ''}
    </div>`;
}

async function createLfgPost(){
  if (!currentUser) { openGlobalAuth(); return; }
  const gameInput = document.getElementById('lfgGameInput');
  const playersInput = document.getElementById('lfgPlayersInput');
  const descInput = document.getElementById('lfgDescInput');
  const errEl = document.getElementById('lfgCreateErr');
  errEl.textContent = '';

  const game = gameInput.value.trim().slice(0, 60);
  const players = Math.max(1, Math.min(20, parseInt(playersInput.value, 10) || 1));
  const description = descInput.value.trim().slice(0, 500);
  if (!game) { errEl.textContent = 'Укажи игру'; return; }

  try {
    const { error } = await sbClient.from('lfg_posts').insert([{
      author_id: currentUser.id, game, players_needed: players, description: description || null,
    }]);
    if (error) throw error;
    gameInput.value = ''; playersInput.value = '1'; descInput.value = '';
    document.getElementById('lfgGameMatches').innerHTML = '';
    renderLfgPage();
  } catch(e) {
    errEl.textContent = 'Не удалось создать заявку: ' + (e.message || e);
  }
}

async function closeLfgPost(id){
  try {
    await sbClient.from('lfg_posts').update({ active: false }).eq('id', id);
    document.querySelector(`[data-lfg-id="${id}"]`)?.remove();
  } catch(e) { alert('Не удалось закрыть заявку: ' + (e.message || e)); }
}
async function deleteLfgPost(id){
  if (!confirm('Удалить заявку?')) return;
  try {
    await sbClient.from('lfg_posts').delete().eq('id', id);
    document.querySelector(`[data-lfg-id="${id}"]`)?.remove();
  } catch(e) { alert('Не удалось удалить: ' + (e.message || e)); }
}

// Заявка от незнакомца не может сразу написать в ЛС (это разрешено
// только друзьям, см. friends-dm.sql) — поэтому "откликнуться" сначала
// отправляет заявку в друзья, а для уже принятых сразу открывает ЛС.
async function respondToLfg(authorId, nick){
  if (!currentUser) { openGlobalAuth(); return; }
  if (currentUser.id === authorId) return;
  try {
    const status = await getFriendshipStatus(authorId);
    if (status === 'friends') { openDmWith(authorId, nick); return; }
    if (status === 'pending_sent') { alert('Заявка в друзья уже отправлена — как примут, сможешь написать в ЛС.'); return; }
    if (status === 'pending_received') { await acceptFriendRequest(authorId); openDmWith(authorId, nick); return; }
    await sendFriendRequest(authorId);
  } catch(e) { alert('Не получилось: ' + (e.message || e)); }
}

// Подсказка при создании заявки: кто ещё на сайте указал эту игру в
// любимых (profiles.favorite_games) — помогает найти тиммейтов даже
// без открытой заявки с их стороны.
function onLfgGameInput(){
  clearTimeout(lfgGameMatchTimer);
  const val = document.getElementById('lfgGameInput').value.trim();
  const box = document.getElementById('lfgGameMatches');
  if (!val) { box.innerHTML = ''; return; }
  lfgGameMatchTimer = setTimeout(() => findGameMatches(val), 400);
}
async function findGameMatches(game){
  const box = document.getElementById('lfgGameMatches');
  if (!sbClient || !game) { box.innerHTML = ''; return; }
  try {
    const { data } = await sbClient
      .from('profiles')
      .select('id, nick, avatar_url')
      .contains('favorite_games', [game.toLowerCase()])
      .neq('id', currentUser?.id || '00000000-0000-0000-0000-000000000000')
      .limit(6);
    if (!data || !data.length) { box.innerHTML = '<div style="font-size:.72rem;color:var(--muted);margin-top:.4rem">Пока никто не указал эту игру в любимых — но заявку всё равно увидят все</div>'; return; }
    box.innerHTML = `<div style="font-size:.7rem;color:var(--muted);margin-top:.5rem;margin-bottom:.3rem">🎯 Уже играют в это:</div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">${data.map(u => {
        const avatarStyle = u.avatar_url ? `background-image:url('${u.avatar_url}')` : '';
        return `<div onclick="openMiniProfile('${u.id}','${(u.nick||'?').replace(/'/g,"\\'")}',this)" title="${esc(u.nick||'?')}" style="width:28px;height:28px;border-radius:50%;background:var(--tw) center/cover;${avatarStyle};display:flex;align-items:center;justify-content:center;font-size:.6rem;font-weight:800;color:#fff;cursor:pointer">${u.avatar_url ? '' : (u.nick||'?').substring(0,2).toUpperCase()}</div>`;
      }).join('')}</div>`;
  } catch(e) { box.innerHTML = ''; }
}

// ─── Любимые игры и статус в профиле (используются и в мини-профиле) ───
function toggleGamesEdit(show){
  document.getElementById('profileGamesView').style.display = show ? 'none' : 'block';
  document.getElementById('profileGamesEditWrap').style.display = show ? 'block' : 'none';
  if (show) document.getElementById('profileGamesInput').value = (currentProfile?.favorite_games || []).join(', ');
}
async function saveProfileGames(){
  const raw = document.getElementById('profileGamesInput').value;
  const games = [...new Set(raw.split(',').map(g => g.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
  try {
    await sbClient.from('profiles').update({ favorite_games: games }).eq('id', currentUser.id);
    if (currentProfile) currentProfile.favorite_games = games;
    renderProfileGamesView(games);
    toggleGamesEdit(false);
  } catch(e) { alert('Не удалось сохранить: ' + (e.message || e)); }
}
function renderProfileGamesView(games){
  const el = document.getElementById('profileGamesView');
  if (!el) return;
  if (!games || !games.length) { el.innerHTML = '<span style="color:var(--muted);font-size:.75rem">Игры не указаны</span>'; return; }
  el.innerHTML = games.map(g => `<span style="display:inline-block;background:rgba(145,71,255,.15);color:var(--tw);border-radius:6px;padding:.2rem .55rem;font-size:.72rem;margin:0 .3rem .3rem 0">🎮 ${esc(g)}</span>`).join('');
}

function toggleStatusEdit(show){
  document.getElementById('profileStatusView').style.display = show ? 'none' : 'block';
  document.getElementById('profileStatusEditWrap').style.display = show ? 'flex' : 'none';
  if (show) document.getElementById('profileStatusInput').value = currentProfile?.status_text || '';
}
async function saveProfileStatus(){
  const status = document.getElementById('profileStatusInput').value.trim().slice(0, 60);
  try {
    await sbClient.from('profiles').update({ status_text: status || null }).eq('id', currentUser.id);
    if (currentProfile) currentProfile.status_text = status;
    document.getElementById('profileStatusView').textContent = status || '';
    toggleStatusEdit(false);
  } catch(e) { alert('Не удалось сохранить: ' + (e.message || e)); }
}
