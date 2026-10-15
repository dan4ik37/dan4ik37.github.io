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

console.log(`games-test: ${pass} ok, ${fail} fail (${((Date.now() - t0) / 1000).toFixed(1)} с)`);
process.exit(fail ? 1 : 0);
