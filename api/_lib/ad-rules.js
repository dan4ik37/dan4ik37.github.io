// api/_lib/ad-rules.js — правила прямой рекламы (кабинет рекламодателя #/adv) для сервера сайта: переход /go/<id>
// (routes/adgo.js) и страница правил /ads-terms (routes/adterms.js).
// ТЕ ЖЕ списки и цифры — в ads.sql (ad_bad_words, ad_short_hosts, ad_url_ok, ad_settings) и js/core/ad-direct.js:
// поменял тут — поменяй там (PGlite-тест test-ads.mjs и scripts/ad-direct-test.cjs сверяют).

// Запрещённые темы (аудитория — дети). Ищем как кусок текста в нижнем регистре (ё → е), латинские «двойники» тоже
export const BAD_WORDS = [
  'казино', 'casino', 'kazino', 'букмекер', 'bookmaker', 'betting', 'беттинг', 'ставки на спорт', 'ставка на спорт', 'тотализатор',
  '1xbet', '1win', 'mostbet', 'melbet', 'fonbet', 'winline', 'parimatch', 'leonbets', 'betcity', 'ggbet', 'pin-up', 'pinup', 'vavada',
  'azino', 'азино', 'joycasino', 'рулетк', 'roulette', 'джекпот', 'jackpot', 'лотере', 'lottery', 'игровые автоматы', 'покер', 'poker',
  'ggdrop', 'casebattle', 'case-battle', 'case battle', 'кейсбатл', 'кейс батл', 'forcedrop', 'easydrop', 'bulldrop', 'skinbox',
  'открытие кейсов', 'открывай кейсы', 'промокод на деп', 'депозит',
  'алкогол', 'alcohol', 'водка', 'vodka', 'пиво', 'beer', 'коньяк', 'виски', 'whisky', 'whiskey',
  'сигарет', 'cigarette', 'табак', 'tobacco', 'вейп', 'вэйп', 'vape', 'электронк', 'снюс', 'snus', 'кальян', 'hookah', 'iqos', 'насвай',
  'порно', 'porn', 'xxx', 'секс', 'эротик', 'erotic', 'интим', '18+', 'onlyfans', 'знакомства', 'dating', 'эскорт', 'escort',
  'оружи', 'weapon', 'пистолет', 'травмат', 'боеприпас', 'патрон',
  'криптовалют', 'crypto', 'bitcoin', 'биткоин', 'биткойн', 'nft', 'форекс', 'forex', 'трейдинг', 'инвестиц', 'пассивный доход',
  'легкие деньги', 'быстрые деньги', 'easy money', 'заработок без вложений', 'микрозайм', 'займ', 'кредит',
  'лекарств', 'таблетк', 'антибиотик', 'похуден', 'жиросжиг', 'бады',
  'наркот', 'марихуан', 'cannabis', 'спайс',
  'ты выиграл', 'вы выиграли', 'you won', 'скачай', 'бесплатные робуксы', 'робуксы бесплатно', 'free robux', 'free v-bucks',
  'читы', 'взлом аккаунт',
];
// Короткие ссылки прячут, куда ведут
export const SHORT_HOSTS = ['bit.ly', 'bitly.com', 'clck.ru', 'cutt.ly', 'tinyurl.com', 'goo.su', 't.ly', 'is.gd', 'v.gd', 'ow.ly', 'rebrand.ly',
  'shorturl.at', 'u.to', 'vk.cc', 'rb.gy', 'tiny.cc', 'qps.ru', 's.id', 'surl.li'];

// Цифры по умолчанию (как ad_settings в ads.sql; в базе админ может поменять)
export const DEF = {
  prices: { native: { cpm: 70, day: 60 }, banner: { cpm: 50, day: 50 }, rail: { cpm: 60, day: 40 }, board: { cpm: 100, day: 100 } },
  min_budget: 200, max_budget: 100000, min_topup: 50, max_days: 30, dedup_min: 30, freq_day: 6, terms: '2026-10-15',
};
// Форматы: размер картинки (кабинет сам готовит её такой) и человеческое название
export const SIZES = { native: [640, 360], b300x250: [600, 500], b728x90: [1456, 180], r160x600: [320, 1200], r300x600: [600, 1200], board: [1024, 512] };
export const FORMATS = [
  { g: 'native', t: 'Карточка в ленте', d: 'картинка 16:9, заголовок, текст и кнопка — среди игр, видео и каталогов «Студии игр»' },
  { g: 'banner', t: 'Баннер 300×250 и 728×90', d: 'экраны загрузки мира и игр, «☕ Перерыв» и место под игрой после партии, страницы игр и роликов' },
  { g: 'rail', t: 'Столбик 160×600 / 300×600', d: 'справа от игры на широких экранах компьютера' },
  { g: 'board', t: 'Щит в 3D-мире', d: 'большой щит у площади «Мира Денчика» — его видит каждый, кто заходит в мир' },
];

const LAT = 'aeopcxykmtbh', CYR = 'аеорсхукмтвн';
const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е');
const toCyr = s => s.replace(/[aeopcxykmtbh]/g, c => CYR[LAT.indexOf(c)]);
// Запрещённое слово → само слово, иначе ''
export function textBad(t) {
  const n = norm(t), l = toCyr(n);
  return BAD_WORDS.find(w => n.includes(w) || l.includes(w)) || '';
}
const ctrl = s => { for (const ch of s) { const c = ch.charCodeAt(0); if (c < 32 || c === 127) return true; } return false; };
// Ссылка рекламы: '' — можно, иначе причина (как ad_url_ok в ads.sql)
export function urlBad(u) {
  u = String(u ?? '').trim();
  if (!u) return 'empty';
  if (u.length > 500) return 'long';
  if (u.slice(0, 8) !== 'https://') return 'https';
  if (/[\s<>"\\]/.test(u) || ctrl(u)) return 'chars';
  const h = ((/^https:\/\/([^/?#]*)/.exec(u) || [])[1] || '').toLowerCase();
  if (!h || /[@:]/.test(h) || !/^[a-z0-9.-]+$/.test(h) || !/\.[a-z0-9-]{2,}$/.test(h) || /^[0-9.]+$/.test(h) || /\.\./.test(h) || /^[.-]/.test(h)) return 'host';
  if (SHORT_HOSTS.some(w => h === w || h.endsWith('.' + w))) return 'short';
  if (textBad(u)) return 'bad';
  return '';
}
export const host = u => (((/^https:\/\/([^/?#]*)/.exec(String(u ?? '').trim()) || [])[1] || '').toLowerCase()).replace(/^www\./, '');
