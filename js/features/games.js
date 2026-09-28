// ═══════════════════════════════════════
//  ИГРЫ — раздел #/games (и #/games/<id> — сразу открыть игру)
// ═══════════════════════════════════════
// Здесь только витрина, загрузчик и общее API. Сами игры — js/games/*.js:
// грузятся лениво, при первом открытии (главная страница от них не тяжелеет).
// Игра регистрирует себя: GAME_IMPL[id] = { mount(el, api), unmount() }.
// Результаты — games.sql (game_result: XP за победы, рекорды); без входа —
// только локальная статистика в localStorage.
const GAMES_VER = '6';
const GAMES = [
  { id: 'cities',   icon: '🌍', title: 'Города',          desc: 'Называй город на последнюю букву — против бота трёх уровней или онлайн с другом по ссылке. 2 700+ городов.', scripts: ['js/games/cities-data.js', 'js/games/cities.js'], top: 'cities_hard', topLabel: 'цепочка на «Сложном»', color: '#29b6f6' },
  { id: 'guess',    icon: '🎬', title: 'Угадай видео',    desc: 'По кусочку превью угадай ролик dan4ik37. 10 раундов, чем быстрее — тем больше очков.', scripts: ['js/games/guess-video.js'], top: 'guess', topLabel: 'из 10', color: '#ff2d55' },
  { id: '2048',     icon: '🧩', title: '2048',            desc: 'Складывай плитки — стрелки, WASD или свайпы. Дойдёшь до 2048?', scripts: ['js/games/g2048.js'], top: '2048', topLabel: 'очков', color: '#ffd166' },
  { id: 'checkers', icon: '⚫', title: 'Шашки',           desc: 'Русские шашки: против бота трёх уровней, вдвоём на экране или онлайн с другом по ссылке.', scripts: ['js/games/room.js', 'js/games/checkers.js'], top: 'checkers_hard', topLabel: 'шашек сохранено в победе на «Сложном»', color: '#e5e7eb' },
  { id: 'catch',    icon: '💰', title: 'Лови донаты',     desc: 'Аркада: лови падающие донаты, уворачивайся от банов и бомб. Чем дольше — тем быстрее.', scripts: ['js/games/catch.js'], top: 'catch', topLabel: 'очков', color: '#ffd166' },
  { id: 'ttt',      icon: '❌', title: 'Крестики-нолики', desc: 'Против бота (последний уровень не проигрывает), вдвоём на экране или онлайн с другом.', scripts: ['js/games/room.js', 'js/games/tictactoe.js'], top: 'ttt_hard', topLabel: 'ничьих/побед у непобедимого', color: '#9147ff' },
  { id: 'reaction', icon: '⚡', title: 'Реакция',          desc: 'Жми, как только экран станет зелёным. 5 попыток — узнай свою скорость.', scripts: ['js/games/reaction.js'], top: 'reaction', topLabel: 'очков (1000 − мс)', color: '#22c55e' },
  { id: 'clicker',  icon: '👆', title: 'Кликер',          desc: 'Кликай на скорость и собирай комбо. Старая добрая классика сайта.', href: '#/clicker', color: '#ff9f43' },
];
const GAME_IMPL = window.GAME_IMPL = window.GAME_IMPL || {};

let gamesActive = null;        // id открытой игры
let gamesTopKey = 'cities_hard';
const gamesScriptCache = new Map();

function gamesLoadScript(src){
  if (gamesScriptCache.has(src)) return gamesScriptCache.get(src);
  const p = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src + '?v=' + GAMES_VER;
    s.onload = res;
    s.onerror = () => { gamesScriptCache.delete(src); rej(new Error('Не загрузилось: ' + src)); };
    document.head.appendChild(s);
  });
  gamesScriptCache.set(src, p);
  return p;
}

// Роутер зовёт при каждом заходе на #/games[/id]
function renderGamesPage(param){
  const [first, ...rest] = String(param || '').split('/');
  const id = GAMES.some(g => g.id === first && !g.href) ? first : null;
  if (id) openGame(id, rest.join('/') || null); else closeGame(true);
}

function renderGamesHub(){
  const grid = document.getElementById('gamesGrid');
  if (!grid || grid.dataset.ready) return;
  grid.dataset.ready = '1';
  grid.innerHTML = GAMES.map(g => {
    const st = gameLocalStats(g.id);
    const rec = st.best ? `<span class="gm-rec">🏆 ${esc(gameBestLabel(g.id, st.best))}</span>` : '';
    return `<a class="gm-card" href="${g.href || '#/games/' + g.id}" style="--gc:${g.color}">
      <span class="gm-ic">${g.icon}</span>
      <span class="gm-title">${esc(g.title)}</span>
      <span class="gm-desc">${esc(g.desc)}</span>
      <span class="gm-foot"><span class="gm-play">Играть →</span>${rec}</span>
    </a>`;
  }).join('');
  const tabs = document.getElementById('gamesTopTabs');
  tabs.innerHTML = GAMES.filter(g => g.top).map(g =>
    `<button class="gm-tab${g.top === gamesTopKey ? ' active' : ''}" data-key="${g.top}" onclick="setGamesTop('${g.top}')">${g.icon} ${esc(g.title)}</button>`).join('');
  renderGamesTop();
}

let gamesParam = null;
async function openGame(id, param){
  const g = GAMES.find(x => x.id === id);
  const hub = document.getElementById('gamesHub');
  const stage = document.getElementById('gamesStage');
  const box = document.getElementById('gamesStageBox');
  if (!g || !stage) return;
  if (gamesActive === id && gamesParam === (param || null) && box.childElementCount) return;
  unmountActiveGame();
  gamesActive = id;
  gamesParam = param || null;
  hub.hidden = true; stage.hidden = false;
  document.getElementById('gamesStageTitle').textContent = `${g.icon} ${g.title}`;
  box.innerHTML = '<div class="gm-loading"><div class="spinner"></div>Загружаем игру…</div>';
  try {
    for (const s of g.scripts) await gamesLoadScript(s);
    if (gamesActive !== id) return;   // пока грузилось, ушли на другую игру
    box.innerHTML = '';
    GAME_IMPL[id].mount(box, { ...gamesApi(id), param: gamesParam });
    window.scrollTo({ top: document.getElementById('games-page').offsetTop - 70, behavior: 'smooth' });
  } catch (e) {
    box.innerHTML = `<div class="empty-state"><span class="empty-state-icon">😵</span><div class="empty-state-title">Игра не загрузилась</div><div class="empty-state-text">Проверь интернет и обнови страницу.</div></div>`;
  }
}

function closeGame(fromRouter){
  unmountActiveGame();
  gamesActive = null;
  const hub = document.getElementById('gamesHub');
  const stage = document.getElementById('gamesStage');
  if (hub) hub.hidden = false;
  if (stage) stage.hidden = true;
  const grid = document.getElementById('gamesGrid');
  if (grid) delete grid.dataset.ready;   // перерисовать рекорды
  renderGamesHub();
  if (!fromRouter) location.hash = '#/games';
}

function unmountActiveGame(){
  if (gamesActive && GAME_IMPL[gamesActive]?.unmount) {
    try { GAME_IMPL[gamesActive].unmount(); } catch (e) {}
  }
  const box = document.getElementById('gamesStageBox');
  if (box) box.innerHTML = '';
}
// Ушли со страницы игр — останавливаем таймеры/анимации игры
window.addEventListener('hashchange', () => {
  if (gamesActive && !/^#\/games/.test(location.hash)) { unmountActiveGame(); gamesActive = null; }
});

// ── Локальная статистика (работает и без входа) ──
function gameLocalStats(id){
  try { return JSON.parse(localStorage.getItem('d37_game_' + id) || '{}'); } catch (e) { return {}; }
}
function gameSaveLocal(id, patch){
  const st = { plays: 0, wins: 0, best: 0, ...gameLocalStats(id), ...patch };
  try { localStorage.setItem('d37_game_' + id, JSON.stringify(st)); } catch (e) {}
  return st;
}
function gameBestLabel(id, best){
  if (id === 'reaction') return `${1000 - best} мс`;
  if (id === 'guess') return `${best}/10`;
  if (id === 'cities') return `цепочка ${best}`;
  if (id === 'ttt') return best >= 2 ? 'победа над непобедимым' : best >= 1 ? 'ничья с непобедимым' : '—';
  if (id === 'checkers') return `${best} ${best === 1 ? 'шашка' : best < 5 ? 'шашки' : 'шашек'} в победе`;
  if (id === 'catch') return `${Number(best).toLocaleString('ru')} очков`;
  return String(best);
}

// ── API для игр ──
let gamesGuestHint = false;
function gamesApi(id){
  return {
    id,
    // key — ключ для сервера (напр. 'cities_hard'), localBest — число для витрины (чем больше, тем лучше)
    async report(key, win, score, localBest){
      const prev = gameLocalStats(id);
      const lb = localBest ?? score;
      const isRecord = lb > (prev.best || 0);
      gameSaveLocal(id, { plays: (prev.plays || 0) + 1, wins: (prev.wins || 0) + (win ? 1 : 0), best: Math.max(prev.best || 0, lb) });
      if (!currentUser || !sbClient) {
        if (!gamesGuestHint) { gamesGuestHint = true; gameToast('🔑 Войди — и за победы будут XP, а рекорды попадут в таблицу'); }
        else if (isRecord) gameToast('🏆 Новый личный рекорд!');
        return null;
      }
      try {
        const { data, error } = await sbClient.rpc('game_result', { p_game: key, p_win: !!win, p_score: Math.round(score) || 0 });
        if (error || !data?.ok) { if (isRecord) gameToast('🏆 Новый личный рекорд!'); return null; }
        const parts = [];
        if (data.xp > 0) parts.push(`+${data.xp} XP`);
        if (data.record) parts.push('🏆 рекорд!');
        if (parts.length) gameToast(parts.join(' · '));
        if (data.xp > 0 && typeof xpLevelCache !== 'undefined') xpLevelCache.delete(currentUser.id);
        if (typeof claimAchievements === 'function') setTimeout(claimAchievements, 800);   // игровые ачивки
        return data;
      } catch (e) { return null; }
    },
    toast: gameToast,
    local: () => gameLocalStats(id),
    saveLocal: patch => gameSaveLocal(id, patch),
    sfx: gameSfx,
  };
}

function gameToast(text){
  if (typeof xpToast === 'function') { xpToast(text); return; }
  alert(text);
}

// Короткий звук (Web Audio), если у пользователя не выключен звук сайта
let gameAudioCtx = null;
function gameSfx(kind){
  try {
    if (localStorage.getItem('d37_games_mute') === '1') return;
    gameAudioCtx = gameAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = gameAudioCtx, o = ctx.createOscillator(), g = ctx.createGain();
    const map = { ok: [660, .08], bad: [180, .18], win: [880, .25], tick: [520, .03], move: [420, .04] };
    const [f, d] = map[kind] || map.tick;
    o.type = kind === 'bad' ? 'sawtooth' : 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(.07, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + d);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + d);
    if (kind === 'win') setTimeout(() => gameSfx('ok'), 120);
  } catch (e) {}
}
function toggleGamesMute(btn){
  const muted = localStorage.getItem('d37_games_mute') === '1';
  try { localStorage.setItem('d37_games_mute', muted ? '0' : '1'); } catch (e) {}
  btn.textContent = muted ? '🔊' : '🔇';
}

// ── Таблица рекордов ──
function setGamesTop(key){
  gamesTopKey = key;
  document.querySelectorAll('#gamesTopTabs .gm-tab').forEach(b => b.classList.toggle('active', b.dataset.key === key));
  renderGamesTop();
}
async function renderGamesTop(){
  const list = document.getElementById('gamesTopList');
  if (!list) return;
  const g = GAMES.find(x => x.top === gamesTopKey);
  if (!sbClient) { list.innerHTML = ''; return; }
  list.innerHTML = '<div class="gm-top-empty">Загрузка…</div>';
  const { data, error } = await sbClient.rpc('game_top', { p_game: gamesTopKey, lim: 10 });
  if (error) { document.getElementById('gamesTopBox').hidden = true; return; }   // games.sql ещё не выполнен
  document.getElementById('gamesTopBox').hidden = false;
  if (!data?.length) { list.innerHTML = '<div class="gm-top-empty">Пока никто не сыграл — стань первым!</div>'; return; }
  list.innerHTML = data.map((r, i) => `
    <li class="gm-top-item">
      <span class="gm-top-place">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
      <a class="gm-top-nick" href="#/profile/${esc(r.user_id)}">${esc(r.nick || 'user')}</a><span class="lv-badge" data-lv-uid="${esc(r.user_id)}"></span>
      <span class="gm-top-score">${esc(gameBestLabel(g.id, r.best_score))}</span>
    </li>`).join('') + `<div class="gm-top-note">${esc(g.title)}: ${esc(g.topLabel)}</div>`;
  if (typeof xpQueueBadges === 'function') xpQueueBadges();
}
