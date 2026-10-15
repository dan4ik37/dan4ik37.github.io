// api/_lib/age.js — возрастные метки (436-ФЗ: 0+, 6+, 12+, 16+, 18+) для серверных страниц: игры (/games, /games/<id>),
// ролики (/v/<id>, /videos, /topic/…), игры игроков (/g/<id>). Сервер возраста посетителя НЕ знает и не узнаёт: что прятать и
// что накрыть обложкой, решает браузер (js/core/age.js по году в localStorage) — страница только ставит метки и data-age.
// Те же цифры: GAMES[].age / ageWhy (js/features/games.js), VIDEO_RULES (js/core/age.js) — тест scripts/age-test.cjs сверяет.
import { isGambling, esc } from './yt.js';
import { TOPICS, AGE_EXTRA, VIDEO_AGE_DEFAULT, VIDEO_AGE_DEFAULT_WHY } from './topics.js';
export { SITE_AGE } from './page.js';

// Игры сайта: [метка, почему]. 0+ — без причины
export const GAME_AGE = {
  world: [12, 'Онлайн-мир: общение с незнакомыми игроками в чате.'],
  raid: [12, 'Мультяшные сражения: армии человечков штурмуют участки других игроков (без крови).'],   // docs/RAIDS.md, «Возраст»
  studio: [6, 'Конструктор игр; игры других игроков — со своей меткой.'],
  studio3d: [6, 'Конструктор 3D-миров; миры других игроков — со своей меткой.'],
  unity: [12, 'Игры игроков с других сайтов: модератор проверяет, но автор может обновить игру.'],
  kubomir: [6, 'Мультяшные монстры ночью (зомби, слизни) и падение с высоты — без крови.'],
  krokodil: [12, 'Онлайн-игра компанией: чат и рисунки других игроков (мат и ссылки закрыты, есть жалобы на рисунок).'],
  horde: [12, 'Сражения с мультяшными монстрами, боссы «Дракон» и «Жнец».'],
  arena: [12, 'Перестрелка двух персонажей (мультяшная, без крови).'],
  td: [6, 'Башни отбиваются от мультяшных монстров.'],
  balda: [0, ''], fillword: [0, ''], sudoku: [0, ''], mahjong: [0, ''], miner: [0, ''], kosynka: [0, ''], freecell: [0, ''], pauk: [0, ''], blocks: [0, ''],
  domino: [0, ''], chess: [0, ''], uno: [0, ''], durak: [0, ''], pool: [0, ''], ludo: [0, ''], nardy: [0, ''],
  wardrobe: [0, ''], cities: [0, ''], words: [0, ''],
  guess: [12, 'Кусочки превью роликов канала — бывают страшилки.'],
  '2048': [0, ''], checkers: [0, ''], catch: [0, ''], sea: [0, ''], snake: [0, ''], memory: [0, ''], ttt: [0, ''], reaction: [0, ''],
  emoji: [6, 'Названия игр, в том числе хорроров и стрелялок (только эмодзи).'],
  clicker: [0, ''], quiz: [6, 'Тесты про героев игр, в том числе хорроров (FNAF).'],
  wheel: [0, ''], random: [0, ''], typing: [0, ''], cps: [0, ''], fonts: [0, ''],
};
export const gameAge = id => (GAME_AGE[id] || [0, ''])[0];
export const UGC_AGE = 12;   // игра / мир игрока без метки (age.sql: age_rating по умолчанию 12)

// Метка ролика: кейсы и промокоды на депозит — 18+; иначе наибольшая из совпавших тем; ни одна — по умолчанию
export function videoAge(title, desc = '') {
  if (isGambling(title, desc)) return { age: 18, why: 'Ролик про открытие кейсов и промокоды на депозит — это азартные игры.' };
  let age = -1, why = '';
  for (const t of [...TOPICS, ...AGE_EXTRA]) if (t.re.test(title || '') && t.age > age) { age = t.age; why = t.ageWhy; }
  return age < 0 ? { age: VIDEO_AGE_DEFAULT, why: VIDEO_AGE_DEFAULT_WHY } : { age, why };
}

// Значок метки. o.title — подсказка, o.min — показывать только от этой метки (в списках — от 16+, иначе шумно)
export function ageBadge(n, o = {}) {
  n = [0, 6, 12, 16, 18].includes(+n) ? +n : 0;
  if (o.min != null && n < o.min) return '';
  return `<span class="age-b age-b${n}"${o.title ? ` title="${esc(o.title)}"` : ''}>${n}+</span>`;
}
// Атрибут карточки в списке: 18+ браузер несовершеннолетнего прячет (html.d37-h18 [data-age="18"])
export const ageAttr = n => +n >= 12 ? ` data-age="${+n}"` : '';
