// Тесты игр в node, без браузера: движки правил, боты (тысячи партий), выбор → подтверждение → отмена.
// Запуск из корня сайта: node scripts/games-test.cjs            — все
//                        node scripts/games-test.cjs uno,nardy  — только эти
// Игры грузятся как в браузере (window.GAME_IMPL[id]._test), случайность — своя с зерном (повторяемо).
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
const ONLY = (process.argv[2] || '').split(',').filter(Boolean);
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Файл игры — в свою «песочницу» (window = глобальный объект); вернёт GAME_IMPL
function load(...files){
  const sb = { console, setTimeout, clearTimeout, setInterval, clearInterval, Math: Object.create(Math), Date, JSON, performance: { now: () => Date.now() } };
  sb.window = sb; sb.GAME_IMPL = {}; sb.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
  sb.esc = s => String(s);
  vm.createContext(sb);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(SITE, f), 'utf8'), sb, { filename: f });
  return sb;
}
const want = id => !ONLY.length || ONLY.includes(id);
const t0 = Date.now();

// ═══ «Одна!» ═══
if (want('uno')) {
  const T = load('js/games/uno.js').GAME_IMPL.uno._test;
  // 2000 партий ботов: всегда кончаются, 108 карт на месте, ходы ботов по правилам
  let games = 0, errs = 0, lost = 0, stuck = 0;
  for (let g = 0; g < 2000; g++) {
    const rand = rng(1000 + g), n = 2 + (g % 3);
    const G = T.newGame(Array.from({ length: n }, (_, i) => ({ id: 'b' + i, nick: 'Бот ' + i, bot: true })), rand);
    let steps = 0;
    while (G.winner < 0 && steps < 5000) {
      const p = G.turn, m = T.botMove(G, p);
      if (m.a === 'play' && G.hands[p].length === 2) T.act(G, p, { a: 'uno' }, 0);
      const e = T.act(G, p, m, 0);
      if (e) { errs++; break; }
      const cards = G.hands.reduce((s, h) => s + h.length, 0) + G.deck.length + G.discard.length;
      if (cards !== 108) { lost++; break; }
      steps++;
    }
    if (G.winner < 0) stuck++; else games++;
  }
  ok(errs === 0, 'uno: ходы ботов по правилам', errs);
  ok(lost === 0, 'uno: 108 карт всегда на месте', lost);
  ok(stuck === 0 && games === 2000, 'uno: все 2000 партий кончились', { games, stuck });

  // Выбор карты: состояние → нажатие → новое состояние / ход
  const R = T.pickReduce, N = T.NOSEL;
  const hand = ['r5', 'g7', 'W', 'b2'];
  const ctx = (o = {}) => ({ hand, myTurn: true, drew: false, now: 1000, canPlay: [true, false, true, false], ...o });
  let r = R(N, { t: 'card', i: 0 }, ctx());
  ok(r.s.pick === 0 && r.s.pickC === 'r5' && !r.act, 'uno: нажал карту — выбрана, хода нет');
  r = R(r.s, { t: 'card', i: 2 }, ctx());
  ok(r.s.pick === 2 && !r.act, 'uno: нажал другую — выбор сменился');
  const w = R(r.s, { t: 'card', i: 2 }, ctx());
  ok(w.s.wild && w.s.pick === 2 && !w.act, 'uno: дикую ещё раз — открылся выбор цвета, хода нет');
  const back = R(w.s, { t: 'back' }, ctx());
  ok(!back.s.wild && back.s.pick === 2 && !back.act, 'uno: «← Назад» — цвет закрыт, карта ещё выбрана');
  const col = R(w.s, { t: 'color', c: 'g' }, ctx());
  ok(eq(col.act, { a: 'play', i: 2, color: 'g' }) && col.s.pick === -1, 'uno: цвет выбран — ход дикой с цветом', col.act);
  ok(!R(w.s, { t: 'color', c: 'x' }, ctx()).act, 'uno: чужой цвет не принимается');
  const go = R(R(N, { t: 'card', i: 0 }, ctx()).s, { t: 'go' }, ctx());
  ok(eq(go.act, { a: 'play', i: 0 }), 'uno: «Сходить» — ход выбранной', go.act);
  const tw = R(R(N, { t: 'card', i: 0 }, ctx()).s, { t: 'card', i: 0 }, ctx());
  ok(eq(tw.act, { a: 'play', i: 0 }), 'uno: второе нажатие на ту же карту — ход', tw.act);
  ok(R(R(N, { t: 'card', i: 0 }, ctx()).s, { t: 'cancel' }, ctx()).s.pick === -1, 'uno: «Отмена» снимает выбор');
  ok(R(R(N, { t: 'card', i: 0 }, ctx()).s, { t: 'bg' }, ctx()).s.pick === -1, 'uno: нажал мимо — выбор снят');
  const e1 = R(w.s, { t: 'esc' }, ctx());
  ok(!e1.s.wild && e1.s.pick === 2, 'uno: Esc сначала закрывает выбор цвета');
  ok(R(e1.s, { t: 'esc' }, ctx()).s.pick === -1, 'uno: второй Esc снимает выбор');
  const bad = R(N, { t: 'card', i: 1 }, ctx());
  ok(bad.msg === 'bad' && bad.s.pick === -1 && !bad.act, 'uno: неподходящая карта не выбирается');
  ok(R(N, { t: 'card', i: 0 }, ctx({ myTurn: false, canPlay: [] })).msg === 'wait', 'uno: не твой ход — не выбирается');
  // колода: есть ход — сначала «точно?», второе нажатие — взять; ходить нечем — сразу
  const a1 = R(N, { t: 'deck' }, ctx());
  ok(a1.s.arm > 1000 && !a1.act && a1.msg === 'arm', 'uno: есть чем ходить — колода спрашивает');
  ok(eq(R(a1.s, { t: 'deck' }, ctx({ now: 2000 })).act, { a: 'draw' }), 'uno: второе нажатие на колоду — берёт');
  ok(!R(a1.s, { t: 'deck' }, ctx({ now: 9000 })).act, 'uno: через 4 с колода снова спрашивает');
  ok(eq(R(N, { t: 'deck' }, ctx({ canPlay: [false, false, false, false] })).act, { a: 'draw' }), 'uno: нечем ходить — берёт сразу');
  ok(!R(N, { t: 'deck' }, ctx({ drew: true })).act, 'uno: уже взял — колода молчит');
  // стол обновился
  const s0 = R(N, { t: 'card', i: 0 }, ctx()).s;
  ok(R(s0, { t: 'sync' }, ctx({ hand: ['g7', 'r5', 'W', 'b2'] })).s.pick === -1, 'uno: карта на месте выбора сменилась — выбор снят');
  ok(R(s0, { t: 'sync' }, ctx({ myTurn: false, canPlay: [] })).s.pick === -1, 'uno: ход ушёл (думал долго) — выбор снят');
  ok(R(s0, { t: 'sync' }, ctx({ hand: ['r5', 'g7', 'W', 'b2', 'y1', 'y3'], canPlay: [true, false, true, false, false, false] })).s.pick === 0, 'uno: добрал карты (поймали) — выбор остался');
  // показ руки: по цвету и значению, дикие — в конце
  const sorted = ['F', 'b2', 'W', 'r9', 'rS', 'r1', 'g0'].sort((a, b) => T.sortKey(a) - T.sortKey(b));
  ok(eq(sorted, ['r1', 'r9', 'rS', 'g0', 'b2', 'W', 'F']), 'uno: рука по порядку', sorted);
}

// ═══ «Дурак» ═══
if (want('durak')) {
  const T = load('js/games/durak.js').GAME_IMPL.durak._test;
  // 3000 партий ботов: без ошибок и зависаний, 36 карт на месте
  let errs = 0, stuck = 0, lost = 0;
  for (let g = 0; g < 3000; g++) {
    const rand = rng(5000 + g), n = 2 + (g % 3);
    const G = T.newGame(Array.from({ length: n }, (_, i) => ({ id: 'b' + i, nick: 'Бот ' + i, bot: true })), rand);
    let steps = 0;
    while (!G.over && steps < 3000) {
      let moved = false;
      for (const p of [G.defender, G.attacker, ...T.attackersOf(G)]) {
        const m = T.botMove(G, p);
        if (!m) continue;
        if (T.act(G, p, m)) { errs++; break; }
        moved = true; break;
      }
      if (!moved) break;
      const cards = G.hands.reduce((s, h) => s + h.length, 0) + G.deck.length + G.table.reduce((s, t) => s + 1 + (t.d ? 1 : 0), 0);
      const outCards = 36 - cards;
      if (outCards < 0) { lost++; break; }
      steps++;
    }
    if (!G.over) stuck++;
  }
  ok(errs === 0, 'durak: ходы ботов по правилам', errs);
  ok(stuck === 0, 'durak: все 3000 партий кончились', stuck);
  ok(lost === 0, 'durak: карты не размножаются', lost);

  // Выбор: отбиваюсь от двух карт; 8♠ бьёт только 7♠, козырь 7♦ бьёт обе, 6♣ — ничего
  const R = T.pickReduce, N = T.NOSEL;
  const hand = ['8s', '7d', '6c'];
  const ctx = (o = {}) => ({ hand, att: [false, false, false], bt: [[0], [0, 1], []], free: [0, 1], def: true, takeAsk: true, now: 1000, ...o });
  let r = R(N, { t: 'card', i: 0 }, ctx());
  ok(r.s.pick === 0 && !r.act, 'durak: нажал карту — выбрана');
  r = R(r.s, { t: 'card', i: 0 }, ctx());
  ok(eq(r.act, { a: 'beat', i: 0, t: 0 }), 'durak: ещё раз — бьёт единственную подходящую', r.act);
  const tr = R(N, { t: 'card', i: 1 }, ctx());
  const tr2 = R(tr.s, { t: 'card', i: 1 }, ctx());
  ok(!tr2.act && tr2.msg === 'choose' && tr2.s.pick === 1, 'durak: козырь бьёт две — просит выбрать карту на столе');
  ok(eq(R(tr2.s, { t: 'tgt', j: 1 }, ctx()).act, { a: 'beat', i: 1, t: 1 }), 'durak: нажал карту стола — бьёт её');
  const sw = R(tr.s, { t: 'card', i: 0 }, ctx());
  ok(sw.s.pick === 0 && !sw.act, 'durak: передумал — выбрал другую карту, хода нет');
  ok(R(tr.s, { t: 'cancel' }, ctx()).s.pick === -1 && R(tr.s, { t: 'esc' }, ctx()).s.pick === -1, 'durak: «Отмена» и Esc снимают выбор');
  // сначала карта на столе, потом рука
  const t1 = R(N, { t: 'tgt', j: 1 }, ctx());
  ok(t1.s.tgt === 1 && !t1.act, 'durak: нажал карту на столе — она выбрана целью');
  ok(R(t1.s, { t: 'card', i: 0 }, ctx()).msg === 'bad', 'durak: карта, что не бьёт цель, не выбирается');
  const t2 = R(t1.s, { t: 'card', i: 1 }, ctx());
  ok(t2.s.pick === 1 && t2.s.tgt === 1, 'durak: цель + подходящая карта');
  ok(eq(R(t2.s, { t: 'go' }, ctx()).act, { a: 'beat', i: 1, t: 1 }), 'durak: «Побить» — бьёт выбранную цель');
  ok(R(t1.s, { t: 'tgt', j: 1 }, ctx()).s.tgt === -1, 'durak: та же карта стола ещё раз — цель снята');
  ok(R(N, { t: 'card', i: 2 }, ctx()).msg === 'bad', 'durak: карта, которой нечем бить, не выбирается');
  // «Беру»: отбиться можно — второе нажатие; нельзя — сразу
  const k1 = R(N, { t: 'take' }, ctx());
  ok(!k1.act && k1.s.arm > 0, 'durak: «Беру», когда отбиться можно, — сначала «Точно?»');
  ok(eq(R(k1.s, { t: 'take' }, ctx({ now: 3000 })).act, { a: 'take' }), 'durak: второе «Беру» — берёт');
  ok(!R(k1.s, { t: 'take' }, ctx({ now: 9000 })).act, 'durak: через 4 с снова спрашивает');
  ok(eq(R(N, { t: 'take' }, ctx({ takeAsk: false })).act, { a: 'take' }), 'durak: отбиться нечем — берёт сразу');
  // нападаю
  const actx = (o = {}) => ({ hand, att: [true, false, true], bt: [[], [], []], free: [], def: false, takeAsk: false, now: 1000, ...o });
  const a1 = R(N, { t: 'card', i: 2 }, actx());
  ok(eq(R(a1.s, { t: 'go' }, actx()).act, { a: 'attack', i: 2 }), 'durak: нападение — «Сходить»');
  ok(R(a1.s, { t: 'sync' }, actx({ hand: ['8s', '7d'], att: [true, false] })).s.pick === -1, 'durak: карта ушла из руки — выбор снят');
  ok(R(a1.s, { t: 'sync' }, actx({ att: [true, false, false] })).s.pick === -1, 'durak: подкинуть больше нельзя — выбор снят');
  // можно ли отбить всё: паросочетание
  const G2 = { table: [{ a: '7s', d: null }, { a: '9s', d: null }], trump: 'd' };
  ok(T.canBeatAll(G2, ['8s', '6d']) === true, 'durak: 8♠ на 7♠ и козырь на 9♠ — отбиться можно');
  ok(T.canBeatAll(G2, ['10s', '6c']) === false, 'durak: одной картой две не побить');
  ok(T.canBeatAll({ table: [{ a: '7s', d: '8s' }], trump: 'd' }, []) === true, 'durak: всё побито — «можно» (нечего бить)');
  const sorted = ['Ad', '6s', 'Kh', '7d', 'Qs', '9c'].sort((a, b) => T.sortKey(a, 'd') - T.sortKey(b, 'd'));
  ok(eq(sorted, ['6s', 'Qs', '9c', 'Kh', '7d', 'Ad']), 'durak: рука по мастям, козыри в конце', sorted);
}

// ═══ «Лудо» ═══
if (want('ludo')) {
  const T = load('js/games/ludo.js').GAME_IMPL.ludo._test;
  let errs = 0, stuck = 0, choice = 0;
  for (let g = 0; g < 2000; g++) {
    const rand = rng(9000 + g), n = 2 + (g % 3), cols = n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3];
    const G = T.newGame(Array.from({ length: n }, (_, i) => ({ id: 'b' + i, nick: 'Бот ' + i, bot: true, color: cols[i] })), rand);
    let steps = 0;
    while (G.winner < 0 && steps < 20000) {
      const p = G.turn;
      if (G.phase === 'roll') { if (T.doRoll(G, p)) { errs++; break; } }
      else {
        if (T.choices(G, p, G.roll) > 1) choice++;
        const i = T.botPick(G, p);
        if (i < 0 || T.doMove(G, p, i)) { errs++; break; }
      }
      steps++;
    }
    if (G.winner < 0) stuck++;
  }
  ok(errs === 0 && stuck === 0, 'ludo: 2000 партий ботов без ошибок и до конца', { errs, stuck });
  ok(choice > 1000, 'ludo: выбор из нескольких фишек бывает часто', choice);
  // выбор фишки: нажал — выбрана; та же (или с той же клетки) — ход; другая — смена
  const tok = [-1, -1, 12, 20];
  ok(eq(T.tokPick(-1, 2, tok), { sel: 2, move: -1 }), 'ludo: нажал фишку — выбрана, хода нет');
  ok(eq(T.tokPick(2, 3, tok), { sel: 3, move: -1 }), 'ludo: другая фишка — выбор сменился');
  ok(eq(T.tokPick(3, 3, tok), { sel: -1, move: 3 }), 'ludo: та же ещё раз — ход');
  ok(eq(T.tokPick(0, 1, tok), { sel: -1, move: 0 }), 'ludo: из домика любая — тот же ход');
}

// ═══ «Нарды»: ход из шагов с отменой, «Готово» — весь ход разом ═══
if (want('nardy')) {
  const T = load('js/games/nardy.js').GAME_IMPL.nardy._test;
  const players = [{ id: 'a', nick: 'Белые' }, { id: 'b', nick: 'Чёрные' }];
  const snap = X => JSON.stringify([X.cnt, X.off, X.left, X.headUsed]);
  // первый ход: 3 и 5, с головы — одна шашка
  let G = T.newGame(players, rng(1)); T.roll(G, 0, 3, 5);
  let D = T.draft(G, 0);
  const s0 = snap(D);
  ok(T.legalNow(D, 0).length > 0 && !T.draftDone(D, 0), 'nardy: после броска есть ходы, ход не доделан');
  ok(!T.draftStep(D, 0, 0, 3), 'nardy: шаг с головы на 3');
  ok(D.cnt[0][0] === 14 && D.cnt[0][3] === 1 && eq(D.left, [5]) && D.headUsed === 1, 'nardy: черновик сдвинул шашку и кубик');
  ok(T.draftStep(D, 0, 0, 5) === 'Так ходить нельзя', 'nardy: вторая с головы — нельзя (только одна за ход)');
  ok(T.draftUndo(D) && snap(D) === s0 && D.seq.length === 0, 'nardy: «Отменить» вернул позицию, кубики и голову ровно как было');
  ok(!T.draftUndo(D), 'nardy: отменять больше нечего');
  ok(snap(G) === s0 && G.turn === 0, 'nardy: черновик не трогает настоящую партию');
  T.draftStep(D, 0, 0, 5); T.draftStep(D, 0, 5, 3);
  ok(T.draftDone(D, 0), 'nardy: оба кубика сыграны — ход доделан');
  ok(T.applySeq(G, 0, [{ f: 0, d: 5 }]) === 'Ход не доделан: кубики нужно использовать по максимуму' && snap(G) === s0, 'nardy: недоделанный ход хозяин не принимает, партия не тронута');
  ok(T.applySeq(G, 0, [{ f: 0, d: 5 }, { f: 0, d: 3 }]) === 'Так ходить нельзя' && snap(G) === s0, 'nardy: ход не по правилам — отказ, партия не тронута');
  ok(!T.applySeq(G, 0, D.seq) && G.turn === 1 && G.phase === 'roll' && G.cnt[0][8] === 1 && G.cnt[0][0] === 14, 'nardy: «Готово» — ход принят, очередь соперника');
  ok(T.applySeq(G, 0, D.seq) === 'Сейчас нельзя ходить', 'nardy: второй раз тот же ход — нельзя');
  // дубль 6-6 на первом ходу — с головы две
  G = T.newGame(players, rng(2)); T.roll(G, 0, 6, 6); D = T.draft(T.pub(G), 0);
  ok(!T.draftStep(D, 0, 0, 6) && !T.draftStep(D, 0, 0, 6) && T.draftStep(D, 0, 0, 6) === 'Так ходить нельзя', 'nardy: 6-6 первым ходом — с головы две, третья нельзя (черновик из публичного состояния)');
  // свойство: случайные ходы со случайными отменами → «Готово» → хозяин принимает; итог — один из законных ходов (sequences)
  let games = 0, turns = 0, bad = 0, undos = 0, notFinal = 0, errs = 0;
  for (let g = 0; g < 60 && !bad; g++) {
    const rand = rng(300 + g);
    G = T.newGame(players, rand);
    for (let k = 0; k < 400 && G.winner < 0; k++) {
      const p = G.turn;
      if (G.phase === 'roll') { T.roll(G, p); continue; }
      if (p === 1) { for (const s of T.botTurn(G, p, 'hard')) if (T.move(G, p, s.f, s.d)) { errs++; break; } continue; }
      const finals = new Set(T.sequences(G, p).seqs.map(seq => { const c = [G.cnt[0].slice(), G.cnt[1].slice()], o = G.off.slice(); for (const { f, d } of seq) { c[p][f]--; if (f + d < 24) c[p][f + d]++; else o[p]++; } return c[p].join(',') + '|' + o[p]; }));
      D = T.draft(T.pub(G), p);
      let guard = 0;
      while (!T.draftDone(D, p) && guard++ < 40) {
        const L = T.legalNow(D, p);
        if (D.seq.length && rand() < .3) { T.draftUndo(D); undos++; continue; }
        const m = L[Math.floor(rand() * L.length)];
        if (T.draftStep(D, p, m.f, m.d)) { bad++; break; }
      }
      if (!finals.has(D.cnt[p].join(',') + '|' + D.off[p])) notFinal++;
      const e = T.applySeq(G, p, D.seq);
      if (e) { bad++; console.log('отказ', e, JSON.stringify(D.seq)); break; }
      turns++;
    }
    if (G.winner >= 0) games++;
  }
  ok(bad === 0 && errs === 0, 'nardy: ходы с отменами хозяин всегда принимает', { bad, errs });
  ok(notFinal === 0, 'nardy: собранный ход — всегда один из законных (как у бота)', notFinal);
  ok(turns > 1000 && undos > 300, 'nardy: проверено много ходов и отмен', { turns, undos, games });
  ok(games >= 40, 'nardy: партии доходят до конца', games);
}

// ═══ «Шахматы»: правила (perft) и «Отменить ход» ═══
if (want('chess')) {
  const T = load('js/games/chess.js').GAME_IMPL.chess._test;
  const fen = f => {
    const [rows, turn, cast, ep, half, full] = f.split(' ');
    const b = [];
    for (const ch of rows.replace(/\//g, '')) { if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) b.push('.'); else b.push(ch); }
    const epI = ep && ep !== '-' ? (8 - +ep[1]) * 8 + 'abcdefgh'.indexOf(ep[0]) : -1;
    return { b, turn, cast: { K: cast.includes('K'), Q: cast.includes('Q'), k: cast.includes('k'), q: cast.includes('q') }, ep: epI, half: +half || 0, full: +full || 1, keys: [] };
  };
  const perft = (P, d) => { if (!d) return 1; let n = 0; for (const m of T.legal(P)) n += d === 1 ? 1 : perft(T.make(P, m), d - 1); return n; };
  const cases = [
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
    ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ];
  for (const [f, want] of cases) { const got = want.map((_, i) => perft(fen(f), i + 1)); ok(eq(got, want), 'chess: perft ' + f.split(' ')[0].slice(0, 20), got); }
  // «Отменить ход» = партия заново из журнала без последних ходов: всё ровно как было
  const clone = P => JSON.parse(JSON.stringify(P));
  let mism = 0, plies = 0;
  for (let g = 0; g < 40; g++) {
    const rand = rng(700 + g), moves = [], snaps = [];
    let P = T.newPos();
    snaps.push(clone(P));
    for (let k = 0; k < 120 && !T.status(P); k++) {
      const L = T.legal(P), m = L[Math.floor(rand() * L.length)];
      moves.push(m); P.keys = P.keys.concat([T.posKey(P)]); P = T.make(P, m); snaps.push(clone(P)); plies++;
    }
    for (let t = 0; t < 6; t++) {
      const k = Math.floor(rand() * (moves.length + 1)), R = T.replay(moves.slice(0, k));
      if (!eq(clone(R.P), snaps[k])) mism++;
    }
  }
  ok(mism === 0 && plies > 2000, 'chess: отмена восстанавливает позицию, очередь, рокировки, взятие на проходе, повторы', { mism, plies });
  const play = (sans) => { let P = T.newPos(); const ms = []; for (const s of sans) { const m = T.legal(P).find(x => T.san(P, x).replace(/[+#]/, '') === s); if (!m) throw new Error('нет хода ' + s); ms.push(m); P.keys = P.keys.concat([T.posKey(P)]); P = T.make(P, m); } return { P, ms }; };
  const ep = play(['e4', 'a6', 'e5', 'd5']);
  ok(ep.P.ep === 19, 'chess: после d7-d5 можно брать на проходе (d6)', ep.P.ep);
  const ep2 = play(['e4', 'a6', 'e5', 'd5', 'Кf3']);
  ok(ep2.P.ep === -1 && T.replay(ep2.ms.slice(0, 4)).P.ep === 19 && T.legal(T.replay(ep2.ms.slice(0, 4)).P).some(m => m.ep), 'chess: отмена вернула право взять на проходе');
  const ca = play(['e4', 'e5', 'Кf3', 'Кc6', 'Сc4', 'Сc5', 'Крe2']);
  const back = T.replay(ca.ms.slice(0, 6)).P;
  ok(!ca.P.cast.K && !ca.P.cast.Q && back.cast.K && back.cast.Q && T.legal(back).some(m => m.castle === 'K'), 'chess: отмена хода королём вернула рокировку');
  ok(T.myMoves(ca.ms, 'w') === 4 && T.myMoves(ca.ms, 'b') === 3 && T.myMoves([], 'w') === 0, 'chess: счёт своих ходов (с компьютером)');
}

// ═══ «Шашки»: правила ═══
if (want('checkers')) {
  const T = load('js/games/checkers.js').GAME_IMPL.checkers._test;
  const b0 = T.initial();
  ok(T.legalMoves(b0, 'w').length === 7 && T.legalMoves(b0, 'b').length === 7, 'checkers: в начале по 7 ходов');
  const empty = () => Array.from({ length: 8 }, () => Array(8).fill(null));
  let b = empty(); b[5][2] = 'w'; b[4][3] = 'b'; b[6][7] = 'w';
  let L = T.legalMoves(b, 'w');
  ok(L.length === 1 && L[0].caps.length === 1 && eq(L[0].to, [3, 4]), 'checkers: бить обязательно — только взятие', L);
  b = empty(); b[5][0] = 'w'; b[4][1] = 'b'; b[2][3] = 'b';
  L = T.legalMoves(b, 'w');
  ok(L.length === 1 && L[0].caps.length === 2 && eq(L[0].to, [1, 4]), 'checkers: бьют до конца серии', L.map(m => m.to));
  b = empty(); b[1][0] = 'w';
  L = T.legalMoves(b, 'w');
  ok(L.length === 1 && L[0].king && T.apply(b, L[0])[0][1] === 'W', 'checkers: дошла до края — дамка');
  b = empty(); b[2][1] = 'w'; b[1][2] = 'b'; b[1][4] = 'b';
  L = T.legalMoves(b, 'w');
  ok(L.some(m => m.caps.length === 2 && m.king), 'checkers: стала дамкой посреди боя и бьёт дальше как дамка', L.map(m => [m.to, m.caps.length]));
  b = empty(); b[7][0] = 'W';
  ok(T.legalMoves(b, 'w').length === 7, 'checkers: дамка ходит на любое расстояние');
  // боты против ботов: партии кончаются (нет ходов или 40 ходов без взятий)
  let ended = 0;
  for (let g = 0; g < 60; g++) {
    const rand = rng(40 + g);
    let bd = T.initial(), turn = 'w', quiet = 0, n = 0, over = false;
    while (!over && n < 600) {
      const ms = T.legalMoves(bd, turn);
      if (!ms.length || quiet >= 40) { over = true; break; }
      const m = ms[Math.floor(rand() * ms.length)];
      bd = T.apply(bd, m); quiet = m.caps.length ? 0 : quiet + 1; n++;
      turn = turn === 'w' ? 'b' : 'w';
    }
    if (over) ended++;
  }
  ok(ended === 60, 'checkers: 60 случайных партий кончаются', ended);
}

// ═══ «Морской бой»: расстановка руками ═══
if (want('sea')) {
  const T = load('js/games/sea.js').GAME_IMPL.sea._test;
  const N = T.N;
  // случайный флот → список → флот: те же клетки, правила соблюдены
  let okAll = true;
  for (let g = 0; g < 300; g++) {
    const f = T.makeFleet(rng(g)), list = T.listOf(f), f2 = T.fleetOf(list);
    const cnt = f2.cells.flat().filter(x => x >= 0).length;
    const same = f.cells.every((row, r) => row.every((v, c) => (v >= 0) === (f2.cells[r][c] >= 0)));
    const valid = list.every((s, i) => T.canPlace(list.filter((_, j) => j !== i), s));
    if (!same || cnt !== T.TOTAL || f2.left !== T.TOTAL || !valid || T.nextLen(list) !== null) { okAll = false; break; }
  }
  ok(okAll, 'sea: случайный флот → список кораблей → тот же флот, правила соблюдены');
  // ставим руками: от большого к маленькому
  const list = [];
  ok(T.nextLen(list) === 4, 'sea: первым ставим 4-палубный');
  const s1 = T.fitAt(0, 8, 4, true);
  ok(eq(s1, { r: 0, c: 6, len: 4, hor: true }), 'sea: у края корабль сдвигается внутрь', s1);
  ok(T.canPlace(list, s1), 'sea: на пустое поле — можно');
  list.push(s1);
  ok(T.nextLen(list) === 3, 'sea: дальше 3-палубный');
  ok(!T.canPlace(list, T.fitAt(1, 5, 3, false)), 'sea: касается углом — нельзя');
  ok(!T.canPlace(list, T.fitAt(1, 7, 3, false)), 'sea: касается бортом — нельзя');
  ok(T.canPlace(list, T.fitAt(2, 6, 3, true)), 'sea: через клетку — можно');
  ok(T.shipAt(list, 0, 7) === 0 && T.shipAt(list, 5, 5) === -1, 'sea: корабль под пальцем находится');
  const vert = T.fitAt(9, 0, 3, false);
  ok(eq(vert, { r: 7, c: 0, len: 3, hor: false }) && eq(T.shipCells(vert), [[7, 0], [8, 0], [9, 0]]), 'sea: поперёк у нижнего края — сдвиг вверх');
  // полный флот руками жадно по клеткам: всегда получается, бой с ботом идёт
  let built = 0;
  for (let g = 0; g < 50; g++) {
    const L = [], rand = rng(900 + g);
    for (let k = 0; k < 2000 && T.nextLen(L) !== null; k++) {
      const s = T.fitAt(Math.floor(rand() * N), Math.floor(rand() * N), T.nextLen(L), rand() < .5);
      if (T.canPlace(L, s)) L.push(s);
    }
    if (T.nextLen(L) === null && T.fleetOf(L).left === T.TOTAL) built++;
  }
  ok(built >= 45, 'sea: флот руками собирается', built);
}

console.log(`games-test: ${pass} ok, ${fail} fail (${((Date.now() - t0) / 1000).toFixed(1)} с)`);
process.exit(fail ? 1 : 0);
