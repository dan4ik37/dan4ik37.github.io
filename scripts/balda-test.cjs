// Тесты «Балды» (js/games/balda.js) в node: словари (js/games/nouns-data.js, nouns-common.js), правила хода, поиск всех ходов
// (сверка с перебором), бот (3 уровня) и тысячи партий бот против бота без ошибок.
// Запуск из корня сайта: node scripts/balda-test.cjs [число партий, по умолчанию 2000]
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
const GAMES_N = +process.argv[2] || 2000;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); } };
const ctx = vm.createContext({ console, Math, Date, JSON });
ctx.window = ctx; ctx.GAME_IMPL = {};
for (const f of ['js/games/nouns-data.js', 'js/games/nouns-common.js', 'js/games/balda.js']) vm.runInContext(fs.readFileSync(path.join(SITE, f), 'utf8'), ctx, { filename: f });
const B = ctx.GAME_IMPL.balda._test;

// ═══ 1. Словари ═══
const D = B.dicts();
const all = D.all.words;
ok(all.length > 35000, 'существительных больше 35 тысяч', all.length);
ok(all.every((w, i) => !i || all[i - 1] < w), 'словарь отсортирован, без повторов');
ok(all.every(w => /^[а-я]{2,15}$/.test(w)), 'только а–я (ё → е), 2–15 букв', all.filter(w => !/^[а-я]{2,15}$/.test(w)).slice(0, 10));
const must = 'кот кошка заяц время дочь мороженое ножницы брюки кино пальто метро еж лед ветер сон рот ухо стол дом балда лак ад уж оса сом рак рука мука бык рыба ель день пень ночь мышь любовь церковь щи шахматы пожарный стрим донат'.split(' ');
ok(must.every(w => D.all.has(w)), 'основные слова есть', must.filter(w => !D.all.has(w)));
const mustNot = 'коты красный бегать быстро пять семь зайцы весны котлеты дерьмо жопа сука говно мразь хер жид негр задница бля'.split(' ');
ok(mustNot.every(w => !D.all.has(w)), 'нет: формы мн. ч., прилагательные, глаголы, числа, мат и грубое', mustNot.filter(w => D.all.has(w)));
ok(D.all.has('пиво') && !D.common.has('пиво') && D.all.has('дурак') && !D.common.has('дурак'), 'грубое/алкоголь — можно игроку, но бот ими не ходит');
ok(D.common.words.every(w => D.all.has(w)), 'понятные слова — все в словаре');
ok(D.common.size > 1200 && D.easy.words.every(w => w.length <= 5), 'понятных слов достаточно; лёгкий — до 5 букв', D.common.size);
ok(D.starts.length >= 300 && D.starts.every(w => w.length === 5 && D.all.has(w)), 'стартовых слов из 5 букв — хватает', D.starts.length);
ok(D.all.hasPrefix('кош') && !D.all.hasPrefix('кшщ') && D.all.hasPrefix('а') && !D.all.hasPrefix('ъ'), 'проверка начала слова');

// ═══ 2. Правила ═══
let G = B.newGame('балда', 0);
ok(G.b.slice(10, 15).join('') === 'балда' && G.b.filter(Boolean).length === 5, 'слово — в середине');
ok(B.canPlace(G, 5) && B.canPlace(G, 17) && !B.canPlace(G, 0) && !B.canPlace(G, 12), 'буква — только в пустую клетку рядом с буквами');
ok(B.placeable(G).length === 10, 'в начале 10 клеток для буквы');
const chk = mv => B.check(G, mv, D.all);
ok(!chk({ cell: 0, ch: 'к', path: [0, 5] }).ok, 'не рядом с буквами — нельзя');
ok(!chk({ cell: 5, ch: 'к', path: [5] }).ok, 'слово из одной буквы — нельзя');
ok(!chk({ cell: 5, ch: 'л', path: [10, 11] }).ok && /через новую/.test(chk({ cell: 5, ch: 'л', path: [10, 11] }).err), 'слово без новой буквы — нельзя');
ok(/соседями/.test(chk({ cell: 5, ch: 'к', path: [5, 11, 12] }).err), 'по диагонали — нельзя');
// «лак»: Л(12) А(11) К(6)
const lak = { cell: 6, ch: 'к', path: [12, 11, 6] };
let r = chk(lak);
ok(r.ok && r.word === 'лак', 'ЛАК — можно', r);
ok(/нет в словаре/.test(chk({ cell: 6, ch: 'ы', path: [12, 11, 6] }).err), 'нет в словаре — нельзя');
ok(/уже было/.test(chk({ cell: 8, ch: 'а', path: [10, 11, 12, 13, 8] }).err), 'стартовое слово ещё раз — нельзя');
B.apply(G, lak, 'лак');
ok(G.sc[0] === 3 && G.turn === 1 && G.b[6] === 'к' && G.used.includes('лак'), 'ход засчитан: 3 очка, ход соперника');
ok(!B.check(G, { cell: 16, ch: 'к', path: [12, 11, 16] }, D.all).ok, 'ЛАК второй раз — нельзя');
B.pass(G); B.pass(G); B.pass(G);
ok(!G.over && G.passes === 3, '3 пропуска — игра идёт');
B.pass(G);
ok(G.over && B.winner(G) === 0, '4 пропуска подряд — конец, побеждает тот, у кого больше очков');
const G2 = B.newGame('балда', 1);
ok(G2.turn === 1, 'первым может ходить второй игрок');

// ═══ 3. Все ходы — сверка с перебором (пути до 6 клеток) ═══
function brute(G, dict, maxLen){
  const res = new Set();
  for (const X of B.placeable(G)) for (const L of B.ABC) {
    const b = G.b.slice(); b[X] = L;
    const walk = (p, word) => {
      if (word.length >= 2 && p.includes(X) && dict.has(word) && !G.used.includes(word)) res.add(X + ':' + L + ':' + word);
      if (word.length >= maxLen) return;
      for (const nb of B.NB[p[p.length - 1]]) if (b[nb] && !p.includes(nb)) walk([...p, nb], word + b[nb]);
    };
    for (let s = 0; s < 25; s++) if (b[s]) walk([s], b[s]);
  }
  return res;
}
let rnd = 7; const rand = () => { rnd = (rnd * 16807) % 2147483647; return (rnd - 1) / 2147483646; };
for (let t = 0; t < 4; t++) {
  const T = B.newGame(D.starts[(t * 37) % D.starts.length], 0);
  for (let k = 0; k < 4 + t * 2; k++) { const m = B.botMove(T, 'normal', rand); if (m) B.apply(T, m, m.word); else B.pass(T); }
  const fast = new Set(B.allMoves(T, D.common, 6).map(m => m.cell + ':' + m.ch + ':' + m.word));
  const slow = brute(T, D.common, 6);
  ok(fast.size === slow.size && [...slow].every(x => fast.has(x)), `поиск ходов = перебор (позиция ${t + 1}: ${slow.size} ходов)`, [fast.size, slow.size]);
}
// каждый найденный ход проходит проверку
{
  const T = B.newGame('пирог', 0);
  const ms = B.allMoves(T, D.all, 15);
  ok(ms.length > 20 && ms.every(m => B.check(T, m, D.all).ok), 'найденные ходы — правильные', ms.length);
}

// ═══ 4. Бот: время хода и сила ═══
{
  const T = B.newGame('карта', 0);
  for (let k = 0; k < 10; k++) { const m = B.botMove(T, 'normal', rand); if (m) B.apply(T, m, m.word); else B.pass(T); }
  for (const lv of ['easy', 'normal', 'hard']) {
    const t0 = Date.now(); const m = B.botMove(T, lv, rand); const dt = Date.now() - t0;
    ok(dt < 2500, `бот «${lv}» думает меньше 2,5 с`, dt);
    ok(!m || B.check(T, m, D.all).ok, `ход бота «${lv}» правильный`);
  }
}
function play(l0, l1, seed){
  rnd = seed;
  const T = B.newGame(D.starts[Math.floor(rand() * D.starts.length)], 0);
  let guard = 0;
  while (!T.over && guard++ < 80) {
    const lv = T.turn === 0 ? l0 : l1;
    const m = B.botMove(T, lv, rand);
    if (m) { const c = B.check(T, m, D.all); if (!c.ok) throw new Error('бот: неправильный ход ' + JSON.stringify(m) + ' ' + c.err); B.apply(T, m, m.word); }
    else B.pass(T);
    const n = T.b.filter(Boolean).length;
    if (n !== 5 + T.used.length - 1) throw new Error('буквы на поле не сходятся со словами');
  }
  if (!T.over) throw new Error('партия не кончилась');
  return T;
}
const res = { win: [0, 0, 0], full: 0, len: 0, words: 0, maxWord: '' };
let errs = 0;
const t0 = Date.now();
const plan = [];
for (let i = 0; i < GAMES_N; i++) plan.push(i % 10 === 0 ? ['hard', 'normal'] : i % 10 === 1 ? ['normal', 'hard'] : i % 2 ? ['normal', 'easy'] : ['easy', 'normal']);
plan.forEach(([a, b], i) => {
  try {
    const T = play(a, b, 1000 + i);
    const w = B.winner(T);
    res.win[w + 1]++;
    if (!T.b.includes('')) res.full++;
    for (const p of [0, 1]) for (const x of T.words[p]) { res.words++; res.len += x.length; if (x.length > res.maxWord.length) res.maxWord = x; }
  } catch (e) { errs++; if (errs < 4) console.log('ошибка партии', i, e.message); }
});
ok(errs === 0, `${GAMES_N} партий бот против бота — без ошибок и зависаний`, errs);
ok(res.full > GAMES_N * .2, 'часто поле заполняется до конца', res.full);
console.log(`  партий ${GAMES_N} за ${((Date.now() - t0) / 1000).toFixed(1)} с · ничьих ${res.win[0]} · поле целиком ${res.full} · средняя длина слова ${(res.len / res.words).toFixed(2)} · самое длинное «${res.maxWord}»`);
// сила уровней: сложный против среднего и средний против лёгкого — побеждают чаще
function duel(a, b, n){ let wa = 0, wb = 0; for (let i = 0; i < n; i++) { const first = i % 2; const T = play(first ? b : a, first ? a : b, 5000 + i); const w = B.winner(T); if (w < 0) continue; const aw = first ? w === 1 : w === 0; if (aw) wa++; else wb++; } return [wa, wb]; }
const hn = duel('hard', 'normal', 40), ne = duel('normal', 'easy', 60);
ok(hn[0] > hn[1] * 1.5, 'сложный бот обыгрывает среднего', hn);
ok(ne[0] > ne[1] * 1.5, 'средний бот обыгрывает лёгкого', ne);
console.log(`  сложный : средний = ${hn.join(' : ')} · средний : лёгкий = ${ne.join(' : ')}`);

console.log(`balda-test: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
