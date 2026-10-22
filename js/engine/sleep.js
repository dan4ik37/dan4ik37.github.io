// ═══════════════════════════════════════
//  D37E.sleep — правила сна для игр (T-049, docs/plans/kubomir-modpacks.md §4.5; общий модуль §3.3: «Кубомир» — лежанка,
//  потом «Подземье» — кровати, «Живой город» — квартиры). Без DOM и Three.js
// ═══════════════════════════════════════
//   D37E.sleep.why({ night, monsters, alone }) → '' (можно спать) | 'day' | 'monsters'
//   D37E.sleep.need(всего игроков, правило 'one' | 'half' | 'all') → сколько должно спать, чтобы ночь прошла
//   D37E.sleep.skip(часы, утро) → { time, nextDay } — проспал ночь: утро того же дня (уснул после полуночи) или следующего
//   D37E.sleep.TEXT — что сказать игроку (по-русски, свои слова)
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const TEXT = { day: '☀️ Спать можно только ночью — а лежанка теперь твой дом', monsters: '👹 Рядом монстры — сейчас не уснуть', morning: '☀️ Доброе утро!' };
  const why = o => !o.night ? 'day' : o.monsters ? 'monsters' : '';
  const need = (total, rule) => { const n = Math.max(1, total | 0); return rule === 'one' ? 1 : rule === 'all' ? n : Math.ceil(n / 2); };
  // утро: уснул вечером — утро следующего дня, после полуночи — этого же (счётчик дней игра прибавляет сама по nextDay)
  const skip = (hours, morning = 5.6) => { const h = ((hours % 24) + 24) % 24; return { time: morning, nextDay: h > morning }; };
  E.sleep = { why, need, skip, TEXT };
})();
