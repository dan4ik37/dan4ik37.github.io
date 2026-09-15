//  ОПРОС — Supabase
// ═══════════════════════════════════════
const POLLS = [
  { q: 'Во что стримить следующим?', opts: ['GTA 5','Minecraft','CS2','Valorant','Новинка'] },
  { q: 'Когда лучше стримить?', opts: ['Вечер будни','Вечер выходных','Ночь','Днём'] },
  { q: 'Какой контент нравится больше?', opts: ['Стримы','Видосы','Шортсы','Всё равно'] },
  { q: 'Любимая рубрика?', opts: ['Соло-прохождение','С подписчиками','Турниры','Just Chatting'] },
];
let pollIdx = 0;

let votedPolls = new Set(JSON.parse(localStorage.getItem('d37_polls')||'[]'));

function nextPoll() {
  pollIdx = (pollIdx + 1) % POLLS.length;
  renderPoll();
}

async function renderPoll() {
  const poll = POLLS[pollIdx];
  document.getElementById('pollQuestion').textContent = poll.q;
  const pollKey = `poll_${pollIdx}`;
  const voted = votedPolls.has(pollKey);

  // Грузим голоса из Supabase
  let votes = {};
  if (sbClient) {
    try {
      const { data } = await sbClient.from('poll_votes').select('option').eq('poll_id', pollIdx);
      data?.forEach(r => { votes[r.option] = (votes[r.option]||0)+1; });
    } catch(e) {}
  }
  const total = Object.values(votes).reduce((s,v)=>s+v,0);
  const maxVotes = Math.max(...Object.values(votes), 1);

  // БАГ (найден и исправлен): текст варианта опроса вставлялся в innerHTML
  // без esc() (прямой XSS) И передавался в onclick="votePoll(...,'${opt}',...)"
  // как аргумент JS-строки — тот же класс уязвимости, что был у banNick()
  // в чате. Опции задаёт админ через редактор опросов, так что обычный
  // апостроф в варианте ("Don't know" и т.п.) ломал бы кнопку голосования
  // даже без всякого злого умысла.
  document.getElementById('pollOptions').innerHTML = poll.opts.map((opt,idx) => {
    const cnt = votes[opt]||0;
    const pct = total ? cnt/total : 0;
    const pctText = total ? Math.round(pct*100)+'%' : '';
    const isWinner = cnt === maxVotes && total > 0;
    return `<button class="poll-opt${voted?' voted':''}${isWinner&&voted?' winner':''}"
      style="--pct:${pct}" data-opt-idx="${idx}"
      onclick="votePoll(${pollIdx},POLLS[${pollIdx}].opts[this.dataset.optIdx],this)">
      <div class="poll-opt-fill"></div>
      <div class="poll-opt-content">
        <span class="poll-opt-text">${isWinner&&voted?'👑 ':''} ${esc(opt)}</span>
        <span class="poll-opt-pct">${pctText}</span>
      </div>
    </button>`;
  }).join('');
  document.getElementById('pollVotes').textContent = total + ' голос' + (total===1?'':total<5?'а':'ов');
}

async function votePoll(pollId, option, btn) {
  const pollKey = `poll_${pollId}`;
  if (votedPolls.has(pollKey)) return;
  votedPolls.add(pollKey);
  try { localStorage.setItem('d37_polls', JSON.stringify([...votedPolls])); } catch(e) {}

  if (sbClient) {
    try {
      await sbClient.from('poll_votes').insert([{ poll_id: pollId, option, nick: chatNick||'Аноним' }]);
    } catch(e) {}
  }
  renderPoll();
}

// ═══════════════════════════════════════
//  РЕДАКТОР ОПРОСОВ (админка "⚙️ Настройки сайта")
//  Третий кусок логики опросов в оригинале — физически лежал рядом с
//  ГЛОБАЛЬНОЙ АВТОРИЗАЦИЕЙ, без всякой смысловой связи с ней.
// ═══════════════════════════════════════
let editingPollIdx = null;
let customPolls = JSON.parse(localStorage.getItem('d37_custom_polls') || 'null');
// Если есть кастомные опросы — используем их
if (customPolls) POLLS.splice(0, POLLS.length, ...customPolls);

function openPollAdmin() {
  document.getElementById('pollAdminModal').style.display = 'flex';
  renderPollAdminList();
  initPollOptInputs(['','','','']);
  trapModalFocus(document.getElementById('pollAdminModal'));
}
function closePollAdmin() {
  document.getElementById('pollAdminModal').style.display = 'none';
  releaseModalFocus();
}

function renderPollAdminList() {
  const list = document.getElementById('pollAdminList');
  list.innerHTML = POLLS.map((p, i) => `
    <div style="display:flex;align-items:center;gap:.6rem;padding:.5rem .7rem;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid var(--border);margin-bottom:.4rem">
      <div style="flex:1;min-width:0">
        <div style="font-size:.78rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.q)}</div>
        <div style="font-size:.65rem;color:var(--muted);margin-top:.1rem">${p.opts.join(' · ')}</div>
      </div>
      <button onclick="editPoll(${i})" aria-label="Редактировать опрос" style="background:rgba(145,71,255,.1);border:1px solid rgba(145,71,255,.2);color:var(--tw);border-radius:6px;padding:.3rem .6rem;font-size:.68rem;cursor:pointer;font-family:'Montserrat',sans-serif;white-space:nowrap">✏️</button>
      <button onclick="deletePoll(${i})" aria-label="Удалить опрос" style="background:rgba(255,45,85,.1);border:1px solid rgba(255,45,85,.2);color:var(--accent);border-radius:6px;padding:.3rem .6rem;font-size:.68rem;cursor:pointer;font-family:'Montserrat',sans-serif">🗑</button>
    </div>
  `).join('');
}

function initPollOptInputs(opts) {
  const container = document.getElementById('pAdminOpts');
  container.innerHTML = '<div style="font-size:.68rem;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);margin-bottom:.4rem">Варианты ответов</div>';
  opts.forEach((val, i) => addPollOptInput(val));
}

function addPollOptInput(val = '') {
  const container = document.getElementById('pAdminOpts');
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:.4rem;margin-bottom:.4rem';
  div.innerHTML = `
    <input placeholder="Вариант ${container.children.length}..." value="${esc(val)}"
      style="flex:1;background:rgba(255,255,255,.05);border:1.5px solid var(--border);border-radius:8px;padding:.5rem .8rem;color:var(--text);font-family:'Montserrat',sans-serif;font-size:.78rem;outline:none"
      onfocus="this.style.borderColor='var(--tw)'" onblur="this.style.borderColor='var(--border)'">
    <button onclick="this.parentNode.remove()" aria-label="Удалить вариант ответа" style="background:rgba(255,45,85,.1);border:1px solid rgba(255,45,85,.2);color:var(--accent);border-radius:8px;padding:.4rem .6rem;cursor:pointer;font-size:.8rem">✕</button>`;
  container.appendChild(div);
}

function editPoll(idx) {
  editingPollIdx = idx;
  const p = POLLS[idx];
  document.getElementById('pAdminQ').value = p.q;
  initPollOptInputs(p.opts);
  document.getElementById('pollFormTitle').textContent = `✏️ Редактировать опрос ${idx + 1}`;
  document.getElementById('pAdminQ').focus();
}

function deletePoll(idx) {
  if (!confirm(`Удалить опрос "${POLLS[idx].q}"?`)) return;
  POLLS.splice(idx, 1);
  savePollsToStorage();
  renderPollAdminList();
  if (pollIdx >= POLLS.length) pollIdx = 0;
  renderPoll();
}

function clearPollForm() {
  editingPollIdx = null;
  document.getElementById('pAdminQ').value = '';
  initPollOptInputs(['','','','']);
  document.getElementById('pollFormTitle').textContent = '➕ Новый опрос';
  document.getElementById('pollSaveStatus').textContent = '';
}

async function savePollAdmin() {
  const q = document.getElementById('pAdminQ').value.trim();
  if (!q) { document.getElementById('pollSaveStatus').textContent = '⚠ Введи вопрос'; return; }

  const inputs = document.querySelectorAll('#pAdminOpts input');
  const opts = [...inputs].map(i=>i.value.trim()).filter(Boolean);
  if (opts.length < 2) { document.getElementById('pollSaveStatus').textContent = '⚠ Минимум 2 варианта'; return; }

  const poll = { q, opts };

  if (editingPollIdx !== null) {
    POLLS[editingPollIdx] = poll;
  } else {
    POLLS.push(poll);
  }

  // Сохраняем в Supabase если есть подключение
  if (sbClient && currentRole === 'admin') {
    try {
      await sbClient.from('site_config').upsert([{ key: 'polls', value: JSON.stringify(POLLS) }]);
    } catch(e) {}
  }
  savePollsToStorage();
  renderPollAdminList();
  clearPollForm();
  renderPoll();
  document.getElementById('pollSaveStatus').textContent = '✅ Сохранено!';
  setTimeout(() => document.getElementById('pollSaveStatus').textContent = '', 2000);
}

function savePollsToStorage() {
  try { localStorage.setItem('d37_custom_polls', JSON.stringify(POLLS)); } catch(e) {}
}

// Загружаем опросы из Supabase при старте
async function loadPollsFromDB() {
  if (!sbClient) return;
  try {
    const { data } = await sbClient.from('site_config').select('value').eq('key','polls').maybeSingle();
    if (data?.value) {
      const polls = JSON.parse(data.value);
      POLLS.splice(0, POLLS.length, ...polls);
      savePollsToStorage();
      renderPoll();
    }
  } catch(e) {}
}

