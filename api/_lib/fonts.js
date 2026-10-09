// api/_lib/fonts.js — «Шрифты для ника» (/tools/fonts): красивые буквы из Юникода (𝓓𝓪𝓷, 𝕯𝖆𝖓, Ⓓⓐⓝ, ᴅᴀɴ…),
// украшения (꧁…꧂, 『…』) и символы для ника. Это не настоящие шрифты, а другие символы Юникода, похожие
// на буквы, — поэтому их можно скопировать и вставить куда угодно: ник в игре, Telegram, Discord, TikTok.
// makeFonts() самодостаточна (без внешних переменных): тот же код уходит в браузер через toString(),
// а сервер рисует им примеры в HTML для поисковика.
export function makeFonts() {
  var cp = String.fromCodePoint;
  // Математические буквы Юникода: [код A, код a, код 0 (0 — цифр нет), буквы, лежащие в другом месте блока]
  var MATH = {
    boldScript: [0x1D4D0, 0x1D4EA, 0],
    script: [0x1D49C, 0x1D4B6, 0, { B: 0x212C, E: 0x2130, F: 0x2131, H: 0x210B, I: 0x2110, L: 0x2112, M: 0x2133, R: 0x211B, e: 0x212F, g: 0x210A, o: 0x2134 }],
    boldFraktur: [0x1D56C, 0x1D586, 0],
    fraktur: [0x1D504, 0x1D51E, 0, { C: 0x212D, H: 0x210C, I: 0x2111, R: 0x211C, Z: 0x2128 }],
    double: [0x1D538, 0x1D552, 0x1D7D8, { C: 0x2102, H: 0x210D, N: 0x2115, P: 0x2119, Q: 0x211A, R: 0x211D, Z: 0x2124 }],
    bold: [0x1D400, 0x1D41A, 0x1D7CE],
    boldItalic: [0x1D468, 0x1D482, 0],
    italic: [0x1D434, 0x1D44E, 0, { h: 0x210E }],
    sansBold: [0x1D5D4, 0x1D5EE, 0x1D7EC],
    sansBoldItalic: [0x1D63C, 0x1D656, 0],
    sansItalic: [0x1D608, 0x1D622, 0],
    mono: [0x1D670, 0x1D68A, 0x1D7F6]
  };
  function math(k) {
    var m = MATH[k];
    return function (ch) {
      var c = ch.charCodeAt(0);
      if (m[3] && m[3][ch]) return cp(m[3][ch]);
      if (c >= 65 && c <= 90) return cp(m[0] + c - 65);
      if (c >= 97 && c <= 122) return cp(m[1] + c - 97);
      if (m[2] && c >= 48 && c <= 57) return cp(m[2] + c - 48);
      return ch;
    };
  }
  // Посимвольная замена по двум строкам; заглавные берут вариант строчной
  function table(from, to) {
    var map = {}, t = Array.from(to);
    for (var i = 0; i < from.length; i++) map[from[i]] = t[i];
    return function (ch) { return map[ch] || map[ch.toLowerCase()] || ch; };
  }
  var LAT = 'abcdefghijklmnopqrstuvwxyz';
  var smallCaps = table(LAT, 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ');
  var sup = table(LAT + '0123456789', 'ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖqʳˢᵗᵘᵛʷˣʸᶻ⁰¹²³⁴⁵⁶⁷⁸⁹');
  function circled(ch) {
    var c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) return cp(0x24B6 + c - 65);
    if (c >= 97 && c <= 122) return cp(0x24D0 + c - 97);
    if (c === 48) return cp(0x24EA);
    if (c >= 49 && c <= 57) return cp(0x2460 + c - 49);
    return ch;
  }
  function blackCircle(ch) {
    var c = ch.toUpperCase().charCodeAt(0);
    if (c >= 65 && c <= 90) return cp(0x1F150 + c - 65);
    if (c === 48) return cp(0x24FF);
    if (c >= 49 && c <= 57) return cp(0x2776 + c - 49);
    return ch;
  }
  function squared(ch) { var c = ch.toUpperCase().charCodeAt(0); return c >= 65 && c <= 90 ? cp(0x1F130 + c - 65) : ch; }
  function blackSquare(ch) { var c = ch.toUpperCase().charCodeAt(0); return c >= 65 && c <= 90 ? cp(0x1F170 + c - 65) : ch; }
  function wide(ch) { var c = ch.charCodeAt(0); return c === 32 ? cp(0x3000) : (c > 32 && c < 127 ? cp(c + 0xFEE0) : ch); }
  var FLIP = { a: 'ɐ', b: 'q', c: 'ɔ', d: 'p', e: 'ǝ', f: 'ɟ', g: 'ƃ', h: 'ɥ', i: 'ᴉ', j: 'ɾ', k: 'ʞ', l: 'l', m: 'ɯ', n: 'u', o: 'o', p: 'd', q: 'b', r: 'ɹ', s: 's', t: 'ʇ', u: 'n', v: 'ʌ', w: 'ʍ', x: 'x', y: 'ʎ', z: 'z',
    '.': '˙', ',': '\'', '?': '¿', '!': '¡', '_': '‾', '(': ')', ')': '(', '1': 'Ɩ', '2': 'ᄅ', '3': 'Ɛ', '4': 'ㄣ', '5': 'ϛ', '6': '9', '7': 'ㄥ', '9': '6' };
  function each(f) { return function (s) { return Array.from(s).map(f).join(''); }; }
  function comb(mark) { return function (s) { return Array.from(s).map(function (ch) { return ch === ' ' ? ch : ch + mark; }).join(''); }; }
  // [id, название, функция, 1 — меняет только латиницу и цифры]
  var STYLES = [
    ['boldScript', 'Каллиграфия жирная', each(math('boldScript')), 1],
    ['script', 'Каллиграфия', each(math('script')), 1],
    ['boldFraktur', 'Готический жирный', each(math('boldFraktur')), 1],
    ['fraktur', 'Готический', each(math('fraktur')), 1],
    ['double', 'Двойной контур', each(math('double')), 1],
    ['bold', 'Жирный с засечками', each(math('bold')), 1],
    ['boldItalic', 'Жирный курсив', each(math('boldItalic')), 1],
    ['italic', 'Курсив', each(math('italic')), 1],
    ['sansBold', 'Жирный', each(math('sansBold')), 1],
    ['sansBoldItalic', 'Жирный наклонный', each(math('sansBoldItalic')), 1],
    ['sansItalic', 'Наклонный', each(math('sansItalic')), 1],
    ['mono', 'Моноширинный', each(math('mono')), 1],
    ['smallCaps', 'Маленькие заглавные', each(smallCaps), 1],
    ['sup', 'Надстрочный', each(sup), 1],
    ['circled', 'В кружках', each(circled), 1],
    ['blackCircle', 'В чёрных кружках', each(blackCircle), 1],
    ['squared', 'В квадратах', each(squared), 1],
    ['blackSquare', 'В чёрных квадратах', each(blackSquare), 1],
    ['wide', 'Широкий', each(wide), 1],
    ['flip', 'Вверх ногами', function (s) { return Array.from(s.toLowerCase()).map(function (ch) { return FLIP[ch] || ch; }).reverse().join(''); }, 1],
    ['strike', 'Зачёркнутый', comb('̶'), 0],
    ['under', 'Подчёркнутый', comb('̲'), 0],
    ['slash', 'Перечёркнутый наискось', comb('̸'), 0],
    ['spaced', 'С пробелами', function (s) { return Array.from(s).join(' '); }, 0]
  ];
  var DECOR = [['', ''], ['꧁༺', '༻꧂'], ['『', '』'], ['★彡 ', ' 彡★'], ['亗 ', ' 亗'], ['×͜× ', ''], ['', ' ツ'], ['✦ ', ' ✦'], ['【', '】'],
    ['♛ ', ' ♛'], ['⚔ ', ' ⚔'], ['•°', '°•'], ['☠ ', ' ☠'], ['༒', '༒'], ['ᴾᴿᴼ ', ''], ['ꨄ︎ ', ' ꨄ︎']];
  var SYMBOLS = ('★ ☆ ✦ ✧ ✪ ✯ ♛ ♚ ♕ ♔ ☠ ⚔ ⚡ ☯ ☾ ☽ ♡ ❤ ❥ ✿ ❀ ❁ ✓ ✗ ⚝ 亗 彡 ツ ㋡ ꧁ ꧂ ༺ ༻ 『 』 【 】 《 》 ༒ ⚜ ☬ ♆ ✞ † ‡ ∞ ⚘ ☘ ✌ ☁ ❄ ♪ ♫ ⁂ ⚙ ⛧ ✠ ⌘ ☢ ☣ ♨ ʚ ɞ ᵔᴥᵔ ×͜× 𓆩 𓆪 ꨄ ⋆ ˚ ☄ ⍟ ᴳᴼᴰ ᴾᴿᴼ ᴮᴼˢˢ').split(' ');
  function convert(text, decor) {
    var d = DECOR[decor || 0] || DECOR[0];
    return STYLES.map(function (st) { return { id: st[0], name: st[1], out: d[0] + st[2](text) + d[1], latinOnly: !!st[3] }; });
  }
  return { STYLES: STYLES, DECOR: DECOR, SYMBOLS: SYMBOLS, convert: convert };
}
