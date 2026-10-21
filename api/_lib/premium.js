// api/_lib/premium.js — 💎 кристаллы для серверных страниц (/shop, /terms, /refund) и api/pay.js.
// Те же цифры — в js/core/premium.js (CFG, сайт) и premium.sql (premium_packs, premium_items — по ним начисляет база):
// поменял тут — поменяй там (scripts/pay-test.cjs и PGlite-тест сверяют).
export const GEMS = { icon: '💎', name: 'Кристаллы', forms: ['кристалл', 'кристалла', 'кристаллов'] };

export const PACKS = [
  { id: 'p100', gems: 100, bonus: 0, rub: 100, kzt: 590 },
  { id: 'p300', gems: 300, bonus: 0, rub: 300, kzt: 1770 },
  { id: 'p550', gems: 550, bonus: 50, rub: 500, kzt: 2950 },
  { id: 'p1200', gems: 1200, bonus: 200, rub: 1000, kzt: 5900 },
  { id: 'p2600', gems: 2600, bonus: 600, rub: 2000, kzt: 11800 },
];

export const ITEMS = [
  { id: 'vip:1', kind: 'vip', months: 1, price: 100, title: 'VIP на 1 месяц' },
  { id: 'vip:3', kind: 'vip', months: 3, price: 270, title: 'VIP на 3 месяца' },
  { id: 'vip:12', kind: 'vip', months: 12, price: 960, title: 'VIP на 12 месяцев' },
  { id: 'gift:1', kind: 'gift', months: 1, price: 100, title: 'VIP на месяц в подарок' },
  { id: 'coins:100', kind: 'coins', coins: 100, price: 10, title: '100 монет' },
  { id: 'coins:550', kind: 'coins', coins: 550, price: 50, title: '550 монет' },
  { id: 'coins:1200', kind: 'coins', coins: 1200, price: 100, title: '1200 монет' },
  { id: 'skin:hat:gemcrown', kind: 'skin', price: 150, title: 'Кристальная корона' },
  { id: 'skin:back:gemwings', kind: 'skin', price: 300, title: 'Кристальные крылья' },
  { id: 'skin:trail:gems', kind: 'skin', price: 100, title: 'След из кристаллов' },
];

// Лимиты по умолчанию (premium_settings в базе; админ меняет в магазине)
export const LIMITS = { dayRub: 3000, monthRub: 10000 };

// 💛 «Донатер» (22.10.2026) — те же числа и имена, что premium.sql (donor_levels, donor_rule, donor_name_reserved) и
// js/core/premium.js (D37Donor): уровень — сумма донатов за последние days дней. ПРЕДЛОЖЕНИЕ — решает владелец
export const DONOR_LEVELS = [
  { lv: 1, min: 100, perk: 'bronze' },
  { lv: 2, min: 300, perk: 'silver' },
  { lv: 3, min: 700, perk: 'gold' },
  { lv: 4, min: 1500, perk: 'gold' },
];
export const DONOR_RULES = { days: 30, auto_max: 300, claims_day: 5 };
export const DONOR_RESERVED = {
  exact: ['аноним', 'анонимно', 'анонимный', 'анонимная', 'анонимус', 'анон', 'anonymous', 'anonym', 'anonim', 'anonimus', 'anon',
    'гость', 'гостья', 'guest', 'без имени', 'безымянный', 'безымянная', 'noname', 'no name', 'nameless', 'unknown',
    'неизвестный', 'неизвестная', 'неизвестно', 'нет имени', 'ваше имя', 'your name', 'имя', 'name', 'никто', 'nobody',
    'user', 'пользователь', 'donationalerts', 'донатер', 'донатёр', 'donater', 'donator', 'donor'],
  prefix: ['аноним', 'anonym', 'anonim'],
};
const UP = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё', LO = 'абвгдеежзийклмнопрстуфхцчшщъыьэюяе', LAT = 'aeopcxykmhbt0', CYR = 'аеорсхукмнвто';
export function donorNameKey(t) {
  let out = '';
  for (let ch of String(t == null ? '' : t)) {
    let i = UP.indexOf(ch); if (i >= 0) ch = LO[i];
    if (ch >= 'A' && ch <= 'Z') ch = ch.toLowerCase();
    i = LAT.indexOf(ch); if (i >= 0) ch = CYR[i];
    if (/^[a-zа-я0-9]$/.test(ch)) out += ch;
  }
  return out;
}
const EXACT = new Set(DONOR_RESERVED.exact.map(donorNameKey)), PREF = DONOR_RESERVED.prefix.map(donorNameKey);
// «Аноним», «гость», «без имени»… — в топе донатеров показываем «Аноним» и ни к кому не привязываем
export function donorNameReserved(t) { const k = donorNameKey(t); return k === '' || EXACT.has(k) || PREF.some(p => k.startsWith(p)); }

export function gemWord(n) {
  const a = Math.abs(n) % 100, b = a % 10;
  return GEMS.forms[a > 10 && a < 20 ? 2 : b === 1 ? 0 : b > 1 && b < 5 ? 1 : 2];
}
export const money = (n, cur) => Number(n).toLocaleString('ru-RU') + (cur === 'RUB' ? ' ₽' : ' ₸');
