// api/_lib/nicks.js — словари и генератор для /tools/nick («Генератор ников для игр»).
// Один и тот же код работает на сервере (примеры в HTML — их видит поисковик) и в браузере
// (кнопка «Ещё»): generate() сериализуется в страницу через toString().
// Слова — только безобидные: ник увидят в играх и чатах.

export const STYLES = {
  cool:   { label: '😎 Крутой',   a: ['Dark', 'Shadow', 'Toxic', 'Ghost', 'Neon', 'Silent', 'Crazy', 'Frost', 'Iron', 'Wild', 'Lucky', 'Rapid', 'Cyber', 'Night', 'Blaze', 'Storm', 'Venom', 'Phantom', 'Hyper', 'Turbo', 'Atomic', 'Savage', 'Mystic', 'Royal'],
                                  b: ['Wolf', 'Fox', 'Hunter', 'Sniper', 'Raven', 'Viper', 'Knight', 'Rider', 'Ninja', 'Tiger', 'Dragon', 'Reaper', 'Hawk', 'Shark', 'Panda', 'Bandit', 'Pilot', 'Rogue', 'Titan', 'Byte', 'Falcon', 'Cobra', 'Samurai', 'Ronin'] },
  ru:     { label: '🇷🇺 По-русски', a: ['Тёмный', 'Злой', 'Тихий', 'Дикий', 'Ледяной', 'Огненный', 'Хитрый', 'Ночной', 'Безумный', 'Добрый', 'Сонный', 'Быстрый', 'Грозный', 'Ловкий', 'Мрачный', 'Шустрый', 'Весёлый', 'Железный'],
                                  b: ['Волк', 'Лис', 'Кот', 'Ворон', 'Снайпер', 'Пельмень', 'Ёжик', 'Шаман', 'Самурай', 'Батон', 'Призрак', 'Енот', 'Барсук', 'Медведь', 'Ниндзя', 'Пират', 'Рыцарь', 'Бобёр', 'Дракон', 'Гусь'] },
  cute:   { label: '🌸 Милый',    a: ['Cute', 'Sweet', 'Soft', 'Tiny', 'Fluffy', 'Sunny', 'Happy', 'Sleepy', 'Pink', 'Little', 'Cozy', 'Bubbly', 'Moon', 'Sugar', 'Cloudy', 'Peachy'],
                                  b: ['Bunny', 'Kitty', 'Mochi', 'Peach', 'Cookie', 'Star', 'Bubble', 'Panda', 'Honey', 'Berry', 'Muffin', 'Puppy', 'Bear', 'Cherry', 'Donut', 'Pudding'] },
  horror: { label: '💀 Страшный', a: ['Crimson', 'Rotten', 'Hollow', 'Cursed', 'Grim', 'Bloody', 'Silent', 'Wicked', 'Pale', 'Broken', 'Lost', 'Midnight', 'Creepy', 'Haunted'],
                                  b: ['Doll', 'Mask', 'Shade', 'Wraith', 'Clown', 'Bones', 'Raven', 'Witch', 'Ghoul', 'Spider', 'Crow', 'Lantern', 'Puppet', 'Stalker'] },
  anime:  { label: '🌙 Аниме',    syl: ['ka', 'ki', 'ku', 'ko', 'sa', 'shi', 'su', 'so', 'ta', 'chi', 'tsu', 'to', 'na', 'ni', 'no', 'ha', 'hi', 'ma', 'mi', 'mo', 'ya', 'yu', 'yo', 'ra', 'ri', 'ru', 're', 'ro', 'ryo', 'ke', 'ze', 'ji', 'zu', 'ai', 'ei'],
                                  end: ['', '', '', 'kun', 'chan', 'sama', 'senpai'] },
};
export const DECOR = {
  none:   { label: 'Без украшений' },
  num:    { label: 'Цифры' },
  under:  { label: 'Через _' },
  xx:     { label: 'xX_ник_Xx' },
  bracket:{ label: '『ник』' },
  star:   { label: '★ ник ★' },
  tsu:    { label: 'ник ツ' },
};

// Генератор: rand — функция 0..1 (на сервере — с зерном, в браузере — Math.random)
export function generate(style, decor, rand, S, D){
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const st = S[style] || S.cool;
  let nick;
  if (st.syl) {
    const n = 2 + Math.floor(rand() * 2);
    let base = '';
    for (let i = 0; i < n; i++) base += pick(st.syl);
    base = base[0].toUpperCase() + base.slice(1);
    const end = pick(st.end);
    nick = end ? base + '_' + end : base;
  } else {
    nick = pick(st.a) + pick(st.b);
  }
  switch (D[decor] ? decor : 'none') {
    case 'num': nick += Math.floor(rand() * 900 + 10); break;
    case 'under': nick = nick.replace(/(?<=[a-zа-яё])(?=[A-ZА-ЯЁ])/g, '_'); break;
    case 'xx': nick = 'xX_' + nick + '_Xx'; break;
    case 'bracket': nick = '『' + nick + '』'; break;
    case 'star': nick = '★ ' + nick + ' ★'; break;
    case 'tsu': nick = nick + ' ツ'; break;
  }
  return nick;
}

// Детерминированный генератор (mulberry32) — примеры на странице не меняются от запроса к запросу
export function seeded(seed){
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
