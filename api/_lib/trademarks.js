// api/_lib/trademarks.js — чужие товарные знаки на страницах игр и тестов (05.11.2026).
// В заголовках «игра как Майнкрафт / agar.io / Brawl Stars», в тестах «кто ты из FNAF» — названия чужих игр. Чтобы не было
// похоже на официальную игру (жалоба правообладателя, правила рекламных сетей о вводящем в заблуждение), внизу страницы — одна
// строка: «X» — товарный знак его владельца; игра (тест) не связана с ним и не является официальной. Своих картинок чужих игр нет.
// Новая игра или тест с чужим названием в тексте — строка появится сама (список ниже); нет совпадений — строки нет.
import { esc } from './yt.js';

const MARKS = [
  [/minecraft|майнкрафт/i, 'Minecraft'],
  [/roblox|роблокс|robux|робукс/i, 'Roblox'],
  [/terraria|террари/i, 'Terraria'],
  [/agar\.io/i, 'agar.io'],
  [/slither\.io/i, 'slither.io'],
  [/vampire\s*survivors/i, 'Vampire Survivors'],
  [/clash\s*of\s*clans/i, 'Clash of Clans'],
  [/brawl\s*stars/i, 'Brawl Stars'],
  [/fnaf|фнаф|five\s*nights/i, 'Five Nights at Freddy’s'],
  [/poppy\s*playtime|huggy\s*wuggy|хагги\s*вагги/i, 'Poppy Playtime'],
  [/hollow\s*knight|silksong/i, 'Hollow Knight'],
  [/counter[\s-]?strike|\bcs\s?2\b|кс\s?2/i, 'Counter-Strike'],
  [/fortnite|фортнайт/i, 'Fortnite'],
  [/tetris|тетрис/i, 'Tetris'],
  [/among\s*us/i, 'Among Us'],
  [/geometry\s*dash/i, 'Geometry Dash'],
  [/subway\s*surfers/i, 'Subway Surfers'],
  [/angry\s*birds/i, 'Angry Birds'],
  [/pac[\s-]?man|пакман/i, 'Pac-Man'],
  [/doodle\s*jump/i, 'Doodle Jump'],
  [/flappy\s*bird/i, 'Flappy Bird'],
  [/fall\s*guys/i, 'Fall Guys'],
  [/stardew/i, 'Stardew Valley'],
  // 05.11.2026: по настоящему списку игр и тестов (GAME_PAGES, ARCADE_PAGES, QUIZZES, витрина /games) — «как в Windows» (Сапёр,
  // Косынка, Паук, Свободная ячейка), «как Block Blast / 1010!» (Блоки), «как Ludo King» (Лудо), «как Уно» (Одна!), «вордл» (5 букв),
  // GTA и Марио (Угадай игру по эмодзи), Unity (Unity-игры). Границы слов — чтобы «community», «рисунок», «ГТАйм» не совпали
  [/windows|виндоус/i, 'Windows'],
  [/block\s*blast/i, 'Block Blast'],
  [/(?:^|[^a-z0-9])1010!/i, '1010!'],
  [/ludo\s*king/i, 'Ludo King'],
  [/(?:^|[^a-zа-яё0-9])(?:uno|уно)(?![a-zа-яё0-9])/i, 'UNO'],
  [/wordle|вордл/i, 'Wordle'],
  [/(?:^|[^a-zа-яё0-9])(?:gta|гта)(?![a-zа-яё0-9])|grand\s*theft\s*auto/i, 'Grand Theft Auto'],
  [/(?:^|[^a-zа-яё])(?:mario|марио)(?![a-zа-яё])/i, 'Super Mario'],
  [/(?:^|[^a-z0-9])unity(?![a-z0-9])|юнити/i, 'Unity'],
  [/backrooms|бэкрумс/i, ''],   // не товарный знак (крипипаста) — без строки
];

// Названия знаков в текстах (без повторов, по порядку списка)
export function trademarksIn(...texts) {
  const t = texts.map(x => String(x || '')).join(' \n ');
  return MARKS.filter(([re, name]) => name && re.test(t)).map(([, name]) => name);
}

// Строка для страницы (HTML) или ''; what — «игра» / «игры» / «тест» / «тесты»
export function tmNote(what, ...texts) {
  const list = trademarksIn(...texts);
  if (!list.length) return '';
  const names = list.map(n => `«${esc(n)}»`).join(', ');
  const one = list.length === 1;
  const them = one ? 'ним' : 'ними';
  const w = { 'тест': `тест не связан с ${them} и не является официальным`, 'тесты': `тесты сайта не связаны с ${them} и не являются официальными`,
    'игры': `игры сайта не связаны с ${them} и не являются официальными` }[what] || `игра не связана с ${them} и не является официальной`;
  return `<p class="tm-note">${names} — ${one ? 'товарный знак его владельца' : 'товарные знаки их владельцев'}; ${w}.</p>`;
}

export const TM_CSS = `.tm-note{margin:1.6rem auto 0;max-width:760px;font-size:.74rem;line-height:1.5;color:var(--muted);text-align:center}`;
