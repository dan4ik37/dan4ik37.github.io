// ═══════════════════════════════════════
//  НИК (T-177, владелец 20.11: «ники из смайликов система считает анонимными и не даёт сделать ник из смайликов»).
//  Причина была в двух местах: (1) premium.sql donor_name_reserved / js/core/premium.js reserved() считают «пустой» ключ (без букв и
//  цифр) анонимным — ник «🔥🔥» превращался в «занят системой»; (2) server-hardening.sql profile_nick_sanitize вырезал всё, кроме букв,
//  цифр, пробела и _ . - (смайлики — тоже), а пустое — ошибка / «user…». Теперь ник: русские и латинские буквы, цифры, пробел, _ . -
//  и смайлики (эмодзи) — отдельно или вместе с буквами. Длина — в видимых символах (2–24; семья 👨‍👩‍👧 = один символ).
//  Нельзя: невидимые и управляющие символы (лишний «склеиватель» ZWJ, знаки направления текста, «теги»), только пробелы и знаки,
//  мат (по буквам), «Аноним» / «гость»… (если в нике есть буквы — как раньше), ник «под команду сайта» (dan4ik37, Денчик37 — в том числе
//  похожими буквами: dаn4ik37 с русской «а», 0 вместо o…). Сервер проверяет то же самое (community.sql ч. 17 nick_problem) — главный он.
//  D37Nick.check(nick, { self }) → { ok, nick (очищенный), err (по-русски), len }. Откат — EMOJI = false (только буквы, как раньше).
// ═══════════════════════════════════════
(() => {
  const EMOJI = true;
  const MIN = 2, MAX = 24, MAX_UNITS = 64;
  // смайлики — те же диапазоны, что в community.sql ч. 17 (nick_allowed_class)
  const EMO = '\\u00a9\\u00ae\\u203c\\u2049\\u2122\\u2139\\u2194-\\u21aa\\u231a-\\u23ff\\u24c2\\u25aa-\\u27bf\\u2934\\u2935\\u2b05-\\u2b55\\u3030\\u303d\\u3297\\u3299\\u{1F000}-\\u{1FAFF}';
  const PLAIN = 'A-Za-zА-Яа-яЁё0-9_. \\-';
  const ALLOWED = new RegExp('^[' + PLAIN + (EMOJI ? EMO + '\\u200d\\ufe0f\\u20e3' : '') + ']+$', 'u');
  const EMO_RE = new RegExp('[' + EMO + ']', 'u');
  // невидимое и управляющее: C0/C1, мягкий перенос, нулевой ширины (кроме ZWJ), направление текста, «теги», прочие варианты начертания
  const INVIS = /[\u0000-\u001f\u007f-\u009f­͏؜ᅟᅠ឴឵᠋-᠏​‌‎‏‪-‮⁠-⁯ㅤ︀-︎﻿ﾠ\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/u;
  // ZWJ — только между двумя смайликами; FE0F — не после буквы; 20E3 (клавиша) — только после цифры (+FE0F)
  const BAD_JOIN = /(^|[A-Za-zА-Яа-яЁё0-9_. \-])‍|‍($|[A-Za-zА-Яа-яЁё0-9_. \-])|(^|[A-Za-zА-Яа-яЁё_. \-])️|(^|[^0-9️])⃣|️(?!⃣)(?=[0-9])/u;
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ru', { granularity: 'grapheme' }) : null;
  const glen = s => (seg ? [...seg.segment(s)].length : Array.from(s.replace(/‍./gu, '').replace(/[️⃣\u{1F3FB}-\u{1F3FF}]/gu, '')).length);
  // «скелет» для сравнения похожих: регистр, русские буквы-двойники → латиница, 0→o, 1/i/| → l, без пробелов, знаков и смайликов
  function skel(t){
    let s = String(t || '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е');
    const map = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'к': 'k', 'м': 'm', 'н': 'h', 'в': 'b', 'т': 't', 'і': 'l', 'ї': 'l', '0': 'o', '1': 'l', 'i': 'l', '|': 'l', '!': 'l' };
    s = s.replace(/[\s\S]/gu, c => map[c] || c);
    return s.replace(/[^a-zа-я0-9]/g, '');
  }
  // ники команды сайта (сервер берёт настоящий список из profiles: admin / moderator / helper)
  const STAFF = ['dan4ik37', 'Денчик37', 'Данчик37', 'denchik37'];
  const STAFF_SK = STAFF.map(skel);
  const isStaffSelf = () => { try { return typeof currentRole !== 'undefined' && ['admin', 'moderator', 'helper'].includes(currentRole); } catch (e) { return false; } };
  // мягкая чистка (то же делает сервер): NFC, лишние пробелы
  const tidy = t => String(t == null ? '' : t).normalize('NFC').replace(/[ \t 　]+/g, ' ').trim();
  function check(raw, o = {}){
    const nick = tidy(raw);
    const fail = err => ({ ok: false, nick, err, len: nick ? glen(nick) : 0 });
    if (!nick) return fail('Ник не может быть пустым');
    if (INVIS.test(nick)) return fail('В нике есть невидимые или служебные символы — убери их');
    if (!ALLOWED.test(nick)) return fail(EMOJI ? 'Ник: русские и латинские буквы, цифры, пробел, _ . - и смайлики' : 'Ник: буквы, цифры, пробел, _ . -');
    if (EMOJI && BAD_JOIN.test(nick)) return fail('В нике есть невидимые символы-склейки — убери их');
    const len = glen(nick);
    if (len < MIN || len > MAX || nick.length > MAX_UNITS) return fail(`Ник: от ${MIN} до ${MAX} символов (смайлик — один символ)`);
    if (!/[^ _.\-]/.test(nick)) return fail('Ник не может быть только из пробелов и знаков');
    const D = window.D37Donor;
    if (D?.nameKey && D.nameKey(nick) !== '' && D.reserved(nick)) return fail('Такой ник занят системой (так подписаны анонимные донаты и гости) — выбери другой');
    const P = window.D37Phone;
    // мат — по буквам (смайлики и знаки между буквами не спасают: «х🔥у…» проверяется как «ху…»)
    const letters = nick.replace(/[^A-Za-zА-Яа-яЁё0-9]/g, '');
    try { if (letters && P?.clean && P.clean(letters) !== letters) return fail('Без мата, пожалуйста'); } catch (e) {}
    const sk = skel(nick);
    if (!(o.self ?? isStaffSelf()) && sk && STAFF_SK.some(x => x && sk.includes(x))) return fail('Ник похож на ник команды сайта — выбери другой');
    return { ok: true, nick, err: '', len, emoji: EMO_RE.test(nick) };
  }
  // первая «буква» для заглушки аватара: целый смайлик (с ZWJ и оттенком), а не половинка
  const initial = t => { const s = tidy(t); if (!s) return '?'; if (seg) { for (const g of seg.segment(s)) return g.segment.toUpperCase(); } return Array.from(s)[0].toUpperCase(); };
  window.D37Nick = { EMOJI, MIN, MAX, MAX_UNITS, check, skel, glen, initial, tidy, STAFF, EMO_CLASS: EMO, _re: { ALLOWED, INVIS, BAD_JOIN } };
})();
