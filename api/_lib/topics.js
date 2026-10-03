// api/_lib/topics.js — темы (игры) канала для страниц /topics и /topic/<slug>.
// Список собран по реальным названиям роликов (03.10.2026, ~6000 видео): в тему попадают ролики,
// в названии которых есть re. Темы с < 30 роликами не заводить — пустые страницы поиску не нужны.
// Новая игра на канале → добавить запись; порядок = порядок на странице /topics.

export const TOPICS = [
  { slug: 'roblox', name: 'Roblox', re: /roblox|роблокс/i,
    about: 'Roblox — платформа с тысячами режимов от игроков. На канале — режимы с подписчиками, ивенты, хорроры и смешные моменты.' },
  { slug: 'cs2', name: 'Counter-Strike 2', re: /\bcs\s?2\b|кс\s?2|counter[\s-]?strike|#кс\b|csgo|cs:go|#cs\b/i,
    about: 'Counter-Strike 2 (раньше CS:GO) — командный шутер от Valve. Здесь — катки, моменты, клатчи и тесты железа.' },
  { slug: 'minecraft', name: 'Minecraft', re: /minecraft|майнкрафт/i,
    about: 'Minecraft — песочница про кубический мир: выживание, постройки, моды и сервера.' },
  { slug: 'dead-rails', name: 'Dead Rails (Мёртвые рельсы)', re: /dead\s*rails|мёртвые\s*рельсы|мертвые\s*рельсы|мёртвыерельсы/i,
    about: 'Dead Rails («Мёртвые рельсы») — режим Roblox: поезд, дикий запад и зомби по пути до конечной станции.' },
  { slug: 'silksong', name: 'Hollow Knight: Silksong', re: /silksong|hollow\s*knight|хорнет/i,
    about: 'Hollow Knight: Silksong — метроидвания от Team Cherry, продолжение Hollow Knight, где играем за Хорнет.' },
  { slug: 'fnaf', name: 'FNAF (Five Nights at Freddy’s)', re: /fnaf|фнаф|five\s*nights/i,
    about: 'Five Nights at Freddy’s — серия хорроров про аниматроников. На канале — сама серия и FNAF-режимы.' },
  { slug: 'terraria', name: 'Terraria', re: /terraria|террари/i,
    about: 'Terraria — 2D-песочница: копаем, строим, сражаемся с боссами.' },
  { slug: '99-nights', name: '99 ночей в лесу', re: /99\s*nights|99\s*ноч/i,
    about: '«99 ночей в лесу» (99 Nights in the Forest) — режим Roblox на выживание: продержаться 99 ночей.' },
  { slug: 'apex', name: 'Apex Legends', re: /apex/i,
    about: 'Apex Legends — королевская битва с героями и способностями.' },
  { slug: 'poppy-playtime', name: 'Poppy Playtime', re: /poppy\s*playtime|haggy|хагги/i,
    about: 'Poppy Playtime — хоррор про заброшенную фабрику игрушек и Хагги Вагги.' },
  { slug: 'tiny-bunny', name: 'Tiny Bunny (Зайчик)', re: /tiny\s*bunny|tinybunny/i,
    about: 'Tiny Bunny («Зайчик») — русская хоррор-новелла про мальчика Антона и зимний лес.' },
  { slug: 'metro', name: 'Metro 2033', re: /metro\s*(2033|redux|last\s*light|exodus)|метро\s*2033|метро\s*исход/i,
    about: 'Серия Metro по романам Дмитрия Глуховского: постапокалипсис в московском метро.' },
  { slug: 'fortnite', name: 'Fortnite', re: /fortnite|фортнайт/i,
    about: 'Fortnite — королевская битва со строительством и коллаборациями.' },
  { slug: 'spider-man', name: 'Spider-Man', re: /spider[\s-]?man|человек[\s-]паук/i,
    about: 'Игры Marvel’s Spider-Man — приключения Человека-паука в Нью-Йорке.' },
  { slug: 'not-a-human', name: 'No, I’m not a Human', re: /not\s*a\s*human|notahuman/i,
    about: 'No, I’m not a Human — хоррор, где нужно понять, кто стучится в дверь: человек или нет.' },
  { slug: 'repo', name: 'R.E.P.O.', re: /\brepo\b/i,
    about: 'R.E.P.O. — кооперативный хоррор: вытаскиваем ценности из жутких локаций.' },
  { slug: 'homura-hime', name: 'Homura Hime', re: /homura/i,
    about: 'Ролики dan4ik37 по игре Homura Hime — смешные и эпичные моменты.' },
  { slug: 'horror', name: 'Хорроры', re: /horror|хоррор|ужастик/i,
    about: 'Все хорроры канала: страшные игры, скримеры и истории.' },
];

export const topicOf = slug => TOPICS.find(t => t.slug === slug);
export const topicsFor = title => TOPICS.filter(t => t.re.test(title || ''));
