// api/_lib/trademarks.js — чужие товарные знаки на страницах игр и тестов (05.11.2026).
// В заголовках «игра как Майнкрафт / agar.io / Brawl Stars», в тестах «кто ты из FNAF» — названия чужих игр. Чтобы не было
// похоже на официальную игру (жалоба правообладателя, правила рекламных сетей о вводящем в заблуждение), внизу страницы — одна
// строка: «X» — товарный знак его владельца; игра (тест) не связана с ним и не является официальной. Своих картинок чужих игр нет.
// Новая игра или тест с чужим названием в тексте — строка появится сама (список ниже); нет совпадений — строки нет.
import { esc } from './yt.js';

const MARKS = [
  [/minecraft|майнкрафт/i, 'Minecraft'],
  [/roblox|роблокс/i, 'Roblox'],
  [/terraria|террари/i, 'Terraria'],
  [/agar\.io/i, 'agar.io'],
  [/slither\.io/i, 'slither.io'],
  [/vampire\s*survivors/i, 'Vampire Survivors'],
  [/clash\s*of\s*clans/i, 'Clash of Clans'],
  [/brawl\s*stars/i, 'Brawl Stars'],
  [/fnaf|фнаф|five\s*nights/i, 'Five Nights at Freddy’s'],
  [/poppy\s*playtime/i, 'Poppy Playtime'],
  [/hollow\s*knight/i, 'Hollow Knight'],
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
