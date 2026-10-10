// ═══════════════════════════════════════
//  ИГРЫ — раздел #/games (и #/games/<id> — сразу открыть игру)
// ═══════════════════════════════════════
// Здесь только витрина, загрузчик и общее API. Сами игры — js/games/*.js:
// грузятся лениво, при первом открытии (главная страница от них не тяжелеет).
// Игра регистрирует себя: GAME_IMPL[id] = { mount(el, api), unmount() }.
// Результаты — games.sql (game_result: XP за победы, рекорды); без входа —
// только локальная статистика в localStorage.
const GAMES_VER = '16';
const GAMES = [
  { id: 'cities',   icon: '🌍', title: 'Города',          desc: 'Называй город на последнюю букву — против бота трёх уровней или онлайн с другом по ссылке. 2 700+ городов.', scripts: ['js/games/cities-data.js', 'js/games/cities.js'], top: 'cities_hard', topLabel: 'цепочка на «Сложном»', color: '#29b6f6' },
  { id: 'words',    icon: '🔤', title: '5 букв',          desc: 'Угадай слово из 5 букв за 6 попыток. Новое слово дня каждый день, свободная игра и соревнование с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/words-data.js', 'js/games/words.js'], top: 'words', topLabel: 'лучшая попытка в слове дня', color: '#22c55e' },
  { id: 'guess',    icon: '🎬', title: 'Угадай видео',    desc: 'По кусочку превью угадай ролик dan4ik37. 10 раундов, чем быстрее — тем больше очков. Можно наперегонки с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/guess-video.js'], top: 'guess', topLabel: 'из 10', color: '#ff2d55' },
  { id: '2048',     icon: '🧩', title: '2048',            desc: 'Складывай плитки — стрелки, WASD или свайпы. Дойдёшь до 2048? Или кто больше за 3 минуты — с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/g2048.js'], top: '2048', topLabel: 'очков', color: '#ffd166' },
  { id: 'checkers', icon: '⚫', title: 'Шашки',           desc: 'Русские шашки: против бота трёх уровней, вдвоём на экране или онлайн с другом по ссылке.', scripts: ['js/games/room.js', 'js/games/checkers.js'], top: 'checkers_hard', topLabel: 'шашек сохранено в победе на «Сложном»', color: '#e5e7eb' },
  { id: 'catch',    icon: '💰', title: 'Лови донаты',     desc: 'Аркада: лови падающие донаты, уворачивайся от банов и бомб. С другом — одинаковый дождь донатов у обоих.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/catch.js'], top: 'catch', topLabel: 'очков', color: '#ffd166' },
  { id: 'sea',      icon: '🚢', title: 'Морской бой',     desc: 'Классика 10×10: против бота трёх уровней или онлайн с другом по ссылке. Расставь флот и топи корабли.', scripts: ['js/games/room.js', 'js/games/sea.js'], top: 'sea_hard', topLabel: 'палуб уцелело в победе на «Сложном»', color: '#38bdf8' },
  { id: 'snake',    icon: '🐍', title: 'Змейка',          desc: 'Ешь яблоки, расти и не врезайся в стены и хвост. Стрелки, WASD или свайпы. Можно наперегонки с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/snake.js'], top: 'snake', topLabel: 'яблок', color: '#22c55e' },
  { id: 'memory',   icon: '🃏', title: 'Найди пару',      desc: 'Игра на память: открывай карточки и находи пары за минимум ходов. С другом — одинаковая раскладка.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/memory.js'], top: 'memory', topLabel: 'очков', color: '#f472b6' },
  { id: 'ttt',      icon: '❌', title: 'Крестики-нолики', desc: 'Против бота (последний уровень не проигрывает), вдвоём на экране или онлайн с другом.', scripts: ['js/games/room.js', 'js/games/tictactoe.js'], top: 'ttt_hard', topLabel: 'ничьих/побед у непобедимого', color: '#9147ff' },
  { id: 'reaction', icon: '⚡', title: 'Реакция',          desc: 'Жми, как только экран станет зелёным. 5 попыток — узнай свою скорость и сравни с другом.', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/reaction.js'], top: 'reaction', topLabel: 'очков (1000 − мс)', color: '#22c55e' },
  { id: 'clicker',  icon: '👆', title: 'Кликер',          desc: 'Кликай на скорость и собирай комбо. Старая добрая классика сайта.', href: '#/clicker', color: '#ff9f43' },
  { id: 'quiz',     icon: '🧩', title: 'Тесты',           desc: 'Какой ты моб из Майнкрафта? Кто ты из FNAF и Роблокса? 8 вопросов — и результат, которым можно поделиться.', href: '/quiz', color: '#38bdf8' },
  { id: 'wheel',    icon: '🎡', title: 'Колесо фортуны',  desc: 'Впиши варианты и крути: во что поиграть, кто моет посуду, кто выиграл приз. Честный рандом и ссылка для друзей.', href: '/tools/wheel', color: '#f472b6' },
  { id: 'random',   icon: '🔢', title: 'Рандомайзер',     desc: 'Случайное число в любом диапазоне, монетка «орёл или решка», кубики. Для розыгрышей и споров.', href: '/tools/random', color: '#22c55e' },
  { id: 'typing',   icon: '⌨️', title: 'Тест печати',     desc: 'Сколько знаков в минуту ты печатаешь? Короткие тексты про игры, рекорд и вызов другу.', href: '/tools/typing', color: '#a78bfa' },
  { id: 'cps',      icon: '🖱', title: 'CPS тест',        desc: 'Сколько кликов в секунду ты успеешь? 1, 5 или 10 секунд, звание и рекорд — и вызов другу.', href: '/tools/cps', color: '#f59e0b' },
  { id: 'fonts',    icon: '✒️', title: 'Шрифты для ника', desc: 'Сделай ник красивым: 𝓓𝓪𝓷, 𝕯𝖆𝖓, Ⓓⓐⓝ, ꧁ник꧂ и 70+ символов. Нажал — скопировано.', href: '/tools/fonts', color: '#c084fc' },
];
const GAME_IMPL = window.GAME_IMPL = window.GAME_IMPL || {};
// Задание дня — коды и порядок совпадают с daily_quest_code()/daily_quest_done() в games.sql
const DAILY_QUESTS = {
  win_cities:   { text: 'Победи бота в «Города» (любая сложность)', game: 'cities' },
  play3:        { text: 'Сыграй 3 партии в любые игры', game: null },
  guess7:       { text: 'Угадай 7+ роликов из 10 в «Угадай видео»', game: 'guess' },
  catch500:     { text: 'Набери 500+ очков в «Лови донаты»', game: 'catch' },
  win_checkers: { text: 'Выиграй партию в шашки', game: 'checkers' },
  reaction:     { text: 'Средняя реакция 300 мс или быстрее', game: 'reaction' },
  score2048:    { text: 'Набери 2000+ очков в «2048»', game: '2048' },
  win_ttt:      { text: 'Выиграй в крестики-нолики (Средний, Непобедимый или онлайн)', game: 'ttt' },
  win_sea:      { text: 'Выиграй в «Морской бой» (Средний, Сложный или онлайн)', game: 'sea' },
  snake20:      { text: 'Съешь 20+ яблок в «Змейке»', game: 'snake' },
  memory:       { text: 'Найди все пары в «Найди пару» за 20 ходов или меньше', game: 'memory' },
  words:        { text: 'Угадай слово дня в «5 букв»', game: 'words' },
};

let gamesActive = null;        // id открытой игры
let gamesTopKey = 'cities_hard';
let gamesTopWeek = true;       // рекорды за 7 дней (иначе — за всё время)
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
  tabs.innerHTML = `<button class="gm-tab duel${gamesTopKey === 'duels' ? ' active' : ''}" data-key="duels" onclick="setGamesTop('duels')">⚔️ Чемпионы дуэлей</button>` +
    GAMES.filter(g => g.top).map(g =>
    `<button class="gm-tab${g.top === gamesTopKey ? ' active' : ''}" data-key="${g.top}" onclick="setGamesTop('${g.top}')">${g.icon} ${esc(g.title)}</button>`).join('');
  document.querySelectorAll('#gamesTopPeriod button').forEach(b => b.classList.toggle('active', (b.dataset.week === '1') === gamesTopWeek));
  renderGamesTop();
  renderDailyQuest();
  const hubAd = document.getElementById('gamesHubAd');
  if (hubAd && !hubAd.dataset.adDone) { hubAd.dataset.adDone = '1'; window.D37Ads?.render(hubAd, 'games_hub'); }
}

// Реклама под игрой — только после окончания партии (не во время), обновляется не чаще раза в 90 с
let gamesAdAt = 0;
function gamesAdAfterRound(){
  const stage = document.getElementById('gamesStage');
  if (!stage || stage.hidden || !window.D37Ads || Date.now() - gamesAdAt < 90000) return;
  let box = document.getElementById('gamesAd');
  if (!box) { box = document.createElement('div'); box.id = 'gamesAd'; stage.appendChild(box); }
  if (window.D37Ads.render(box, 'game_over')) gamesAdAt = Date.now();
}

async function renderDailyQuest(){
  const box = document.getElementById('gamesDaily');
  if (!box || !sbClient) return;
  const { data, error } = await sbClient.rpc('daily_quest');
  if (error || !data?.code || !DAILY_QUESTS[data.code]) { box.hidden = true; return; }   // games.sql ещё не выполнен
  const q = DAILY_QUESTS[data.code];
  box.hidden = false;
  let right;
  if (!currentUser) right = `<button class="dq-btn ghost" onclick="openGlobalAuth()">Войти</button>`;
  else if (data.claimed) right = `<span class="dq-done">✅ Награда получена</span>`;
  else if (data.done) right = `<button class="dq-btn" onclick="claimDailyQuest(this)">🎁 Забрать +50 XP</button>`;
  else right = q.game ? `<a class="dq-btn ghost" href="#/games/${q.game}">Играть →</a>` : '';
  box.innerHTML = `<span class="dq-ic">🎯</span>
    <div class="dq-body"><b>Задание дня</b><span>${esc(q.text)}</span><small>${currentUser ? (data.done ? 'Выполнено!' : 'Новое задание — каждый день в полночь по МСК') : 'Войди, чтобы получить награду'}</small></div>
    ${right}`;
}
async function claimDailyQuest(btn){
  btn.disabled = true;
  const { data } = await sbClient.rpc('claim_daily_quest');
  if (data?.ok) { gameToast(`🎯 Задание дня выполнено: +${data.xp} XP`); if (typeof xpLevelCache !== 'undefined') xpLevelCache.delete(currentUser.id); }
  renderDailyQuest();
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
  document.body.classList.add('game-on');   // телефон: нижнее меню прячем (CSS) — под ним была клавиша «ВВОД» в «5 букв»
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
  document.body.classList.remove('game-on');
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
  if (!/^#\/games\/./.test(location.hash)) document.body.classList.remove('game-on');
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
  if (id === 'sea') return `${best} из 20 палуб`;
  if (id === 'snake') return `${best} ${best % 10 === 1 && best % 100 !== 11 ? 'яблоко' : [2, 3, 4].includes(best % 10) && ![12, 13, 14].includes(best % 100) ? 'яблока' : 'яблок'}`;
  if (id === 'memory') return `${best} очков`;
  if (id === 'words') return `с ${7 - best}-й попытки`;
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
      if (win || (isRecord && lb > 0)) gamesSupport(id, isRecord && lb > 0);
      gamesAdAfterRound();
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
        dailyQuestHint();
        return data;
      } catch (e) { return null; }
    },
    toast: gameToast,
    local: () => gameLocalStats(id),
    saveLocal: patch => gameSaveLocal(id, patch),
    sfx: gameSfx,
  };
}

// ── «Поддержать стрим» / «Позвать друга» — в моменты радости (победа, рекорд) ──
// Не чаще раза в 10 минут и не больше 3 раз за визит; крестик скрывает до конца визита.
let gamesSupportShown = 0, gamesSupportAt = 0, gamesSupportOff = false;
function gamesSupport(id, record){
  if (gamesSupportOff || gamesSupportShown >= 3 || Date.now() - gamesSupportAt < 10 * 60 * 1000) return;
  const stage = document.getElementById('gamesStage');
  if (!stage || stage.hidden) return;
  gamesSupportShown++; gamesSupportAt = Date.now();
  let box = document.getElementById('gamesSupport');
  if (!box) { box = document.createElement('div'); box.id = 'gamesSupport'; box.className = 'gm-support'; stage.appendChild(box); }
  const g = GAMES.find(x => x.id === id);
  box.hidden = false;
  box.innerHTML = `<div>${record ? '🏆 <b>Новый рекорд!</b>' : '🎉 <b>Победа!</b>'} Нравятся игры? Их делает стример dan4ik37 —
      поддержи стрим донатом (за донаты на сайте даётся <a href="/vip">VIP</a>) или позови друга сыграть.</div>
    <a class="sp-don" href="https://www.donationalerts.com/r/dan4ik37" target="_blank" rel="noopener">💜 Поддержать</a>
    <button class="sp-share" type="button">🔗 Позвать друга</button>
    <button class="sp-x" type="button" aria-label="Скрыть">✕</button>`;
  box.querySelector('.sp-x').onclick = () => { box.hidden = true; gamesSupportOff = true; };
  box.querySelector('.sp-share').onclick = e => gamesChallenge(e.target, id);
  if (typeof window.va === 'function') window.va('event', { name: 'game_support_shown', data: { game: id } });
}
// «📣 Вызов» — ссылка на страницу игры с лучшим результатом: в Telegram/ВК превью «Ник набрал N — побьёшь?»
async function gamesChallenge(btn, id = gamesActive){
  if (!id) return;
  const g = GAMES.find(x => x.id === id);
  const best = gameLocalStats(id).best || 0;
  const nick = (typeof currentProfile !== 'undefined' && currentProfile?.nick) || '';
  const url = location.origin + '/games/' + id + (best > 0 ? `?s=${best}&n=${encodeURIComponent(nick || 'Друг')}` : '');
  const text = best > 0 ? `Мой рекорд в «${g?.title || 'игре'}» — ${gameBestLabel(id, best)}. Побьёшь?` : `Сыграй со мной в «${g?.title || 'игру'}» на сайте dan4ik37!`;
  if (typeof window.va === 'function') window.va('event', { name: 'game_challenge', data: { game: id } });
  if (navigator.share) { navigator.share({ title: g?.title || 'Игры', text, url }).catch(() => {}); return; }
  const old = btn.innerHTML;
  try { await navigator.clipboard.writeText(text + ' ' + url); btn.textContent = '✅ Скопировано'; setTimeout(() => { btn.innerHTML = old; }, 1800); }
  catch (e) { prompt('Скопируй ссылку и отправь другу:', url); }
}

// Уходим из игры — плашку прячем
window.addEventListener('hashchange', () => { ['gamesSupport', 'gamesAd'].forEach(id => { const b = document.getElementById(id); if (b) b.hidden = true; }); gamesAdAt = 0; });

// ── «Сегодня на сайте» (главная) и точка на «Игры» в нижнем меню ──
// Слово дня «5 букв»: номер дня — как в js/games/words.js (день №1 = 03.10.2026, смена в полночь МСК).
// Прогресс дня words.js пишет в localStorage d37_words_day — отсюда видно, сыграно ли сегодня.
function wordsDayNo(){ return Math.floor((Date.now() + 3 * 3600e3) / 864e5) - Math.floor(Date.UTC(2026, 9, 3) / 864e5) + 1; }
function wordsToday(){
  try { const s = JSON.parse(localStorage.getItem('d37_words_day')); return s && s.n === wordsDayNo() ? s : null; } catch (e) { return null; }
}
function gamesDailyDot(){
  const dot = document.getElementById('btGamesDot');
  if (dot) dot.hidden = !!wordsToday()?.done;
}
// «🆕 Новое на сайте» над «Сегодня на сайте»: один раз на каждую пачку новинок (WHATSNEW_VER), закрыл ✕ — не показываем.
// Для тех, кто заходил раньше и не знает про новые разделы. Новая пачка → поднять версию и поменять список.
const WHATSNEW_VER = '2026-10-10';
const WHATSNEW = [['/quiz', '🧩', 'Тесты «Кто ты из игр»'], ['/tools/wheel', '🎡', 'Колесо фортуны'], ['/tools/fonts', '✒️', 'Шрифты для ника'], ['/tools/random', '🔢', 'Рандомайзер'], ['/tools/cps', '🖱', 'CPS тест'], ['/top', '🏆', 'Лучшие видео']];
function whatsNewHtml(){
  let seen = ''; try { seen = localStorage.getItem('d37_whatsnew') || ''; } catch (e) {}
  if (seen === WHATSNEW_VER) return '';
  return `<div class="whatsnew" id="whatsNew"><b>🆕 Новое на сайте</b><div class="wn-links">${WHATSNEW.map(([h, ic, t]) => `<a href="${h}">${ic} ${esc(t)}</a>`).join('')}</div>
    <button type="button" class="wn-x" aria-label="Скрыть" onclick="hideWhatsNew()">✕</button></div>`;
}
function hideWhatsNew(){ try { localStorage.setItem('d37_whatsnew', WHATSNEW_VER); } catch (e) {} document.getElementById('whatsNew')?.remove(); }

// «Тест дня» на главной — по кругу от номера дня (тесты — api/_lib/quizzes.js, страницы /quiz/<slug>)
const QUIZ_DAY = [['minecraft', '⛏', 'Какой ты моб из Майнкрафта?'], ['fnaf', '🐻', 'Кто ты из FNAF?'], ['game', '🕹', 'Какая ты игра?'], ['roblox', '🟨', 'Кто ты в Роблоксе?'], ['poppy', '🧸', 'Кто ты из Poppy Playtime?'], ['cs2', '🎯', 'Какая ты роль в CS2?'], ['horror', '👻', 'Кто ты в хоррор-игре?'], ['viewer', '📺', 'Какой ты зритель dan4ik37?']];

function renderToday(){
  const box = document.getElementById('today');
  if (!box) return;
  const s = wordsToday();
  const state = !s ? 'Угадай слово из 5 букв — новое каждый день'
    : s.done ? (s.win ? `✅ Угадано с ${s.rows.length}-й попытки · завтра новое` : '❌ Не угадано · завтра новое слово')
    : `Попытка ${s.rows.length + 1} из 6 — доиграй!`;
  // Игры — без инструментов (колесо, тесты, шрифты, CPS ведут на свои страницы)
  const n = GAMES.filter(g => !g.href || g.href[0] === '#').length;
  const qz = QUIZ_DAY[wordsDayNo() % QUIZ_DAY.length];
  box.innerHTML = whatsNewHtml() + `<a class="today-online" id="todayOnline" href="#/chat" hidden></a><div class="today-grid">
      <a class="today-card hot-slot${s?.done ? '' : ' hot'}" href="#/games/words"><span class="ti">🔤</span><span class="tt"><b>Слово дня #${wordsDayNo()}</b><small>${esc(state)}</small></span></a>
      <a class="today-card" href="/quiz/${qz[0]}"><span class="ti">${qz[1]}</span><span class="tt"><b>Тест дня</b><small>${esc(qz[2])}</small></span></a>
      <a class="today-card" href="#/games"><span class="ti">🎮</span><span class="tt"><b>${n} игр на сайте</b><small>Морской бой, Города, Шашки — с ботом или с другом по ссылке</small></span></a>
      <a class="today-card" href="/tools/wheel"><span class="ti">🎡</span><span class="tt"><b>Колесо фортуны</b><small>Во что поиграть? Кто моет посуду? Крути!</small></span></a>
      ${window.__d37Daily ? `<a class="today-card today-vid" href="/v/${esc(window.__d37Daily.id)}"><span class="ti">🎬</span><span class="tt"><b>Видео дня</b><small>${esc(window.__d37Daily.title)}</small></span></a>`
        : '<a class="today-card" href="/top"><span class="ti">🏆</span><span class="tt"><b>Лучшие видео</b><small>Самые популярные ролики канала</small></span></a>'}
      <button type="button" class="today-card" onclick="d37Surprise(this)"><span class="ti">🎲</span><span class="tt"><b>Удиви меня</b><small>Случайное видео из почти 6000</small></span></button>
    </div>`;
  gamesDailyDot();
  renderTodayOnline();
}
// «🟢 Сейчас на сайте: N» — только если кроме тебя есть кто-то ещё (иначе «1 на сайте» выглядит пусто)
function renderTodayOnline(){
  const el = document.getElementById('todayOnline');
  if (!el) return;
  const n = window.__d37Online || 0;
  el.hidden = n < 2;
  el.innerHTML = `<i></i>Сейчас на сайте: <b>${n}</b> — заходи в чат →`;
}
window.addEventListener('d37:online', renderTodayOnline);
window.addEventListener('d37:daily', () => { if (document.body.dataset.route === 'home') renderToday(); });
window.gamesDailyDot = gamesDailyDot;
gamesDailyDot();
// Полночь по МСК: обновить точку и карточку, если сайт открыт долго
setInterval(() => { gamesDailyDot(); if (document.body.dataset.route === 'home') renderToday(); }, 5 * 60e3);

// ── Игровая статистика в профиле (#profileGameStatsCard) ──
// game_stats читают все (games.sql). Ключи вида cities_hard / words_duel → игра по префиксу из GAMES.
// Лучший результат — по ключу рекордов игры (GAMES[].top), как в таблице рекордов.
async function renderProfileGameStats(uid, isOwn){
  const card = document.getElementById('profileGameStatsCard');
  if (!card) return;
  card.hidden = true;
  if (!uid || !sbClient) return;
  const { data, error } = await sbClient.from('game_stats').select('game,plays,wins,best_score').eq('user_id', uid);
  if (error || !data) return;
  const rows = [];
  let plays = 0, wins = 0;
  for (const g of GAMES.filter(x => !x.href)) {
    const mine = data.filter(r => r.game === g.id || r.game.startsWith(g.id + '_'));
    if (!mine.length) continue;
    const p = mine.reduce((s, r) => s + (r.plays || 0), 0), w = mine.reduce((s, r) => s + (r.wins || 0), 0);
    plays += p; wins += w;
    const top = mine.find(r => r.game === g.top);
    rows.push({ g, p, w, best: top && top.best_score > 0 ? gameBestLabel(g.id, top.best_score) : '' });
  }
  if (!rows.length && !isOwn) return;
  card.hidden = false;
  const box = document.getElementById('profileGameStats');
  document.getElementById('profileGameStatsSum').textContent = plays ? `${plays} ${plays % 10 === 1 && plays % 100 !== 11 ? 'партия' : [2, 3, 4].includes(plays % 10) && ![12, 13, 14].includes(plays % 100) ? 'партии' : 'партий'} · ${wins} побед` : '';
  box.innerHTML = rows.length ? rows.sort((a, b) => b.p - a.p).map(r => `<a class="pgs-item" href="#/games/${r.g.id}" style="--gc:${r.g.color}">
      <span class="pgs-ic">${r.g.icon}</span>
      <span class="pgs-txt"><b>${esc(r.g.title)}</b><small>${r.p} игр · ${r.w} побед${r.best ? ' · 🏆 ' + esc(r.best) : ''}</small></span></a>`).join('')
    : '<div class="pgs-empty">Ещё не играл. <a href="#/games">Сыграй во что-нибудь</a> — за победы дают XP, а рекорды попадут сюда.</div>';
}

// После партии: если задание дня выполнено и не забрано — напомнить
async function dailyQuestHint(){
  try {
    const { data } = await sbClient.rpc('daily_quest');
    if (data?.done && !data.claimed) setTimeout(() => gameToast('🎯 Задание дня выполнено — забери +50 XP в «Играх»'), 1800);
  } catch (e) {}
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

// Побед в дуэлях с живыми соперниками (все игры) — за 7 дней или за всё время
async function renderDuelTop(list){
  const { data, error } = await sbClient.rpc('duel_top', { p_week: gamesTopWeek, lim: 10 });
  if (error) { list.innerHTML = '<div class="gm-top-empty">Таблица чемпионов скоро появится</div>'; return; }
  document.getElementById('gamesTopBox').hidden = false;
  if (!data?.length) { list.innerHTML = '<div class="gm-top-empty">Ещё никто не побеждал в дуэлях — позови друга по ссылке из любой игры!</div>'; return; }
  list.innerHTML = data.map((r, i) => `
    <li class="gm-top-item">
      <span class="gm-top-place">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
      <a class="gm-top-nick" href="#/profile/${esc(r.user_id)}">${esc(r.nick || 'user')}</a><span class="lv-badge" data-lv-uid="${esc(r.user_id)}"></span>
      <span class="gm-top-score">${r.wins} ${r.wins % 10 === 1 && r.wins % 100 !== 11 ? 'победа' : [2, 3, 4].includes(r.wins % 10) && ![12, 13, 14].includes(r.wins % 100) ? 'победы' : 'побед'} из ${r.played}</span>
    </li>`).join('') + '<div class="gm-top-note">Дуэли: «Города», шашки и крестики-нолики онлайн, соревнования в остальных играх</div>';
  if (typeof xpQueueBadges === 'function') xpQueueBadges();
}

// ── Таблица рекордов ──
function setGamesTop(key){
  gamesTopKey = key;
  document.querySelectorAll('#gamesTopTabs .gm-tab').forEach(b => b.classList.toggle('active', b.dataset.key === key));
  renderGamesTop();
}
function setGamesTopPeriod(week){
  gamesTopWeek = week;
  document.querySelectorAll('#gamesTopPeriod button').forEach(b => b.classList.toggle('active', (b.dataset.week === '1') === week));
  renderGamesTop();
}
async function renderGamesTop(){
  const list = document.getElementById('gamesTopList');
  if (!list) return;
  if (!sbClient) { list.innerHTML = ''; return; }
  list.innerHTML = '<div class="gm-top-empty">Загрузка…</div>';
  if (gamesTopKey === 'duels') return renderDuelTop(list);
  const g = GAMES.find(x => x.top === gamesTopKey);
  let { data, error } = gamesTopWeek
    ? await sbClient.rpc('game_top_week', { p_game: gamesTopKey, lim: 10 })
    : await sbClient.rpc('game_top', { p_game: gamesTopKey, lim: 10 });
  if (error && gamesTopWeek) ({ data, error } = await sbClient.rpc('game_top', { p_game: gamesTopKey, lim: 10 }));   // старый games.sql без недельных
  if (error) { document.getElementById('gamesTopBox').hidden = true; return; }   // games.sql ещё не выполнен
  document.getElementById('gamesTopBox').hidden = false;
  if (!data?.length) { list.innerHTML = `<div class="gm-top-empty">${gamesTopWeek ? 'На этой неделе ещё никто не сыграл' : 'Пока никто не сыграл'} — стань первым!</div>`; return; }
  list.innerHTML = data.map((r, i) => `
    <li class="gm-top-item">
      <span class="gm-top-place">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
      <a class="gm-top-nick" href="#/profile/${esc(r.user_id)}">${esc(r.nick || 'user')}</a><span class="lv-badge" data-lv-uid="${esc(r.user_id)}"></span>
      <span class="gm-top-score">${esc(gameBestLabel(g.id, r.best_score))}</span>
    </li>`).join('') + `<div class="gm-top-note">${esc(g.title)}: ${esc(g.topLabel)}</div>`;
  if (typeof xpQueueBadges === 'function') xpQueueBadges();
}
