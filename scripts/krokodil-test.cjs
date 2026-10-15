// Тесты «Крокодила» (js/games/krokodil.js) в node, без браузера: слова, судья, фильтр, растр и правки рисунка, картинки бота,
// ведущий (hostStep: ходы, очки, подсказки, жалобы, уход игроков и ведущего), комната с подменной сетью (presence, личные
// сообщения — и шифром WebCrypto, поток рисунка, смена хозяина) и целая игра 4 «браузеров» поверх неё.
// Запуск из корня сайта: node scripts/krokodil-test.cjs [папка для картинок бота (PNG-лист для просмотра)]
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const SITE = path.join(__dirname, '..');
const OUT = process.argv[2] || '';
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };

const ctx = vm.createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder, crypto: globalThis.crypto, btoa, atob, Math, Date, JSON });
ctx.window = ctx; ctx.GAME_IMPL = {};
vm.runInContext(fs.readFileSync(path.join(SITE, 'js/games/krokodil.js'), 'utf8'), ctx, { filename: 'krokodil.js' });
const K = ctx.GAME_IMPL.krokodil._test;
const { W, H } = K;

// ═══ 1. Слова ═══
const all = [1, 2, 3].flatMap(lv => K.LISTS[lv]);
ok(K.LISTS[1].length >= 140 && K.LISTS[2].length >= 140 && K.LISTS[3].length >= 100, 'слов хватает (простые / средние / сложные)', [K.LISTS[1].length, K.LISTS[2].length, K.LISTS[3].length]);
ok(new Set(all.map(K.norm)).size === all.length, 'слова не повторяются между уровнями');
ok(all.every(w => /^[а-яё]+(?:[ -][а-яё]+)*$/.test(w)), 'слова — только русские буквы, пробел, дефис', all.filter(w => !/^[а-яё]+(?:[ -][а-яё]+)*$/.test(w)));
ok(all.every(w => K.clean(w) === w), 'в словах нет мата (фильтр их не трогает)', all.filter(w => K.clean(w) !== w));
ok(all.length >= 400, 'всего слов — несколько сотен', all.length);

// ═══ 2. Судья и фильтр ═══
const J = (t, w, a) => K.judge(t, w, a);
ok(J('кот', 'кот') === 'hit' && J('КОТ', 'кот') === 'hit' && J('  кот! ', 'кот') === 'hit', 'точное слово — угадал (регистр, знаки)');
ok(J('это кот?', 'кот') === 'hit' && J('может быть ёлка', 'елка') === 'hit', 'слово целиком внутри фразы — угадал');
ok(J('елка', 'ёлка') === 'hit' && J('ёж', 'еж') === 'hit', 'ё = е');
ok(J('божья коровка', 'божья коровка') === 'hit' && J('божьякоровка', 'божья коровка') === 'hit' && J('хотдог', 'хот-дог') === 'hit', 'фразы: пробел и дефис не важны');
ok(J('котик', 'кот') === 'near' && J('котлета', 'кот') === 'near', 'слово внутри другого — «почти» (всем не показываем)');
ok(J('кошк', 'кошка') === 'close' && J('кашка', 'кошка') === 'close' && J('слан', 'слон') === 'close', 'одна-две ошибки — «близко»');
ok(J('собака', 'кошка') === 'miss' && J('', 'кот') === 'miss' && J('123', 'кот') === 'miss', 'мимо');
ok(J('кошка', 'кот', ['кошка', 'котик']) === 'hit', 'синонимы картинок бота');
ok(K.clean('привет https://evil.ru/x') === 'привет [ссылка]', 'ссылки закрыты');
ok(/\*/.test(K.clean('ты хуйло')) && !/хуй/.test(K.clean('ты хуйло')), 'мат закрыт');
ok(K.clean('a'.repeat(200)).length === 60, 'длина сообщения ≤ 60');
ok(K.clean('при' + String.fromCharCode(0x200b) + 'вет') === 'привет', 'невидимые символы убраны');
ok(K.maskOf('ёлка') === '____' && K.maskOf('хот-дог') === '___-___' && K.maskOf('божья  коровка') === '_____ _______', 'маска слова');

// ═══ 3. Растр и правки рисунка ═══
{
  const P = K.makePic();
  ok(P.apply([1, 1, 1, 100, 100, 2, 2, 200, 100, 200, 200]), 'линия применилась');
  ok(P.r.pix[100 * W + 150] === 1 && P.r.pix[150 * W + 200] === 1 && P.r.pix[150 * W + 150] === 0, 'линия на растре');
  // заливка закрытого квадрата не протекает наружу
  P.apply([5, 1, 1, 1, 300, 300, 2, 4, 400, 300, 400, 400, 300, 400, 300, 300, 3, 4, 350, 350]);
  ok(P.r.pix[350 * W + 350] === 4 && P.r.pix[350 * W + 450] === 0 && P.r.pix[350 * W + 250] === 0, 'заливка — только внутри фигуры');
  const h1 = P.hash();
  const Q = K.makePic(); Q.apply(P.ops());
  ok(Q.hash() === h1, 'весь рисунок одной пачкой даёт тот же растр (full)');
  P.apply([4]);   // отменить заливку
  ok(P.r.pix[350 * W + 350] === 0 && P.r.pix[300 * W + 350] === 1, 'отмена убирает последнее действие');
  P.apply([4]);
  ok(P.r.pix[300 * W + 350] === 0 && P.acts.length === 0, 'отмена линии; пусто');
  P.apply([4, 4]);
  ok(P.acts.length === 0, 'лишняя отмена ничего не ломает');
  ok(!P.apply([1, 99, 1, 5, 5]) && !P.apply([2, 5000, 1, 1]) && !P.apply([7]) && !P.apply('x') && !P.apply([1, 1, 1, 'a', 2]), 'битые правки отвергнуты');
  const P2 = K.makePic(); P2.apply([1, 1, 3, -50, 9999]);
  ok(P2.acts[0].p[0] === 0 && P2.acts[0].p[1] === H - 1, 'точки за краем прижаты к холсту');
  // предел точек
  const P3 = K.makePic(), big = [1, 1, 0, 0, 0, 2, 3990]; for (let i = 0; i < 3990; i++) big.push(i % W, (i * 7) % H);
  P3.apply(big); P3.apply([1, 1, 0, 1, 1, 2, 3000, ...Array(6000).fill(5)]);
  ok(P3.pts <= K.MAX_PTS && P3.full(), 'не больше MAX_PTS точек', P3.pts);
  // заливка на всё поле и очистка
  const P4 = K.makePic(); P4.apply([3, 6, 10, 10]);
  ok(P4.r.pix.every(v => v === 6), 'заливка пустого холста — весь холст');
  P4.apply([5]); ok(P4.r.pix.every(v => v === 0) && !P4.acts.length, 'очистить — пусто и без истории');
}
// склейка пачек
{
  const a = { t: 'd', tn: 3, q: 1, n: 1, o: [1, 1, 1, 5, 5] }, b = { t: 'd', tn: 3, q: 2, n: 1, o: [2, 1, 6, 6] }, c = { t: 'd', tn: 3, q: 4, n: 1, o: [4] };
  const m = K.mergeD(a, b);
  ok(m && m.q === 1 && m.n === 2 && m.o.length === 9, 'соседние пачки склеиваются');
  ok(K.mergeD(m, c) === null, 'с дыркой — не склеиваются');
  ok(K.mergeD(a, { t: 'd', tn: 4, q: 2, n: 1, o: [] }) === null, 'разные ходы — не склеиваются');
  const f = { t: 'full', tn: 3, q: 5, o: [1, 1, 1, 0, 0] };
  ok(K.mergeD(m, f) === f, 'полный рисунок поглощает старые пачки');
  const fd = K.mergeD(f, { t: 'd', tn: 3, q: 6, n: 2, o: [4] });
  ok(fd && fd.t === 'full' && fd.q === 7 && fd.o.length === 6, 'полный + следующая пачка = полный');
}

// ═══ 4. Картинки бота ═══
const sheet = [];
for (const pc of K.PICS) {
  const acts = K.picActs(pc.d);
  const inside = acts.every(a => a.k === 'f' ? a.x >= 0 && a.x < W && a.y >= 0 && a.y < H : a.p.every((v, i) => v >= -2 && v <= (i % 2 ? H + 1 : W + 1)));
  ok(acts.length >= 2 && inside, `картинка «${pc.w}»: разобралась, в пределах холста`);
  const P = K.makePic();
  let leak = '';
  for (const a of acts) {
    const before = P.r.pix.slice();
    P.apply(K.actsOps([a]));
    if (a.k === 'f') {
      let ch = 0; for (let i = 0; i < before.length; i++) if (before[i] !== P.r.pix[i]) ch++;
      if (ch > W * H * .45) leak = `заливка (${a.x},${a.y}) — ${Math.round(ch / W / H * 100)} %`;
      if (ch === 0) leak = leak || `заливка (${a.x},${a.y}) ничего не закрасила`;
    }
  }
  let ink = 0; for (const v of P.r.pix) if (v) ink++;
  ok(!leak, `картинка «${pc.w}»: заливки не протекают и не пустые`, leak);
  ok(ink > W * H * .03 && ink < W * H * .75, `картинка «${pc.w}»: на холсте разумно краски`, Math.round(ink / W / H * 100));
  // бот рисует по времени — итог тот же
  const pen = K.botPen(acts, 16), B = K.makePic();
  let t = 0; while (!pen.done && t < 200) { B.apply(pen.next(.04)); t += .04; }
  ok(pen.done && B.hash() === P.hash(), `картинка «${pc.w}»: бот дорисовывает за ~16 с и выходит то же`, t.toFixed(1));
  ok(t >= 8 && t <= 24, `картинка «${pc.w}»: рисуется 8–24 с`, t.toFixed(1));
  ok(K.judge(pc.w, pc.w, pc.alt) === 'hit' && (pc.alt || []).every(a => K.judge(a, pc.w, pc.alt) === 'hit'), `картинка «${pc.w}»: слово и синонимы угадываются`);
  sheet.push({ w: pc.w, pix: P.r.pix.slice() });
}
ok(K.PICS.length >= 40, 'картинок бота — хватает на 4 игры без повторов', K.PICS.length);
ok(new Set(K.PICS.map(p => K.norm(p.w))).size === K.PICS.length, 'картинки не повторяются');
// лист картинок (PNG) — посмотреть глазами
if (OUT) {
  const cols = 6, sc = 4, cw = W / sc, chh = H / sc, rows = Math.ceil(sheet.length / cols), SW = cols * cw, SH = rows * chh;
  const rgb = K.PAL.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const img = Buffer.alloc((SW * 3 + 1) * SH, 255);
  sheet.forEach((s, k) => {
    const ox = (k % cols) * cw, oy = Math.floor(k / cols) * chh;
    for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
      const v = s.pix[(y * sc) * W + x * sc], c = rgb[v], o = (oy + y) * (SW * 3 + 1) + 1 + (ox + x) * 3;
      const edge = x === 0 || y === 0;
      img[o] = edge ? 120 : c[0]; img[o + 1] = edge ? 120 : c[1]; img[o + 2] = edge ? 120 : c[2];
    }
  });
  for (let y = 0; y < SH; y++) img[y * (SW * 3 + 1)] = 0;
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(SW, 0); ihdr.writeUInt32BE(SH, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'kroko-pics.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(img)), chunk('IEND', Buffer.alloc(0))]));
  fs.writeFileSync(path.join(OUT, 'kroko-pics.txt'), sheet.map((s, i) => `${i + 1}. ${s.w}`).join('\n'));
}

// ═══ 5. Ведущий: hostStep ═══
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const ids = ['a~1', 'b~2', 'c~3', 'd~4'];
const players = n => ids.slice(0, n).map((id, i) => ({ id, nick: 'Игрок ' + 'АБВГ'[i] }));
let now = 1e6;
function run(Hh, ev){ ev.now = now; return K.hostStep(Hh, ev, { rand }); }
const bc = out => out.filter(([to]) => to === '*').map(([, m]) => m);
const to = (out, id) => out.filter(([t]) => t === id).map(([, m]) => m);
const stOf = out => bc(out).filter(m => m.t === 'st').map(m => m.s).pop();
{
  const Hh = K.newHost();
  let out = run(Hh, { k: 'seats', players: players(1) });
  ok(stOf(out)?.ph === 'lobby', 'лобби: состояние разослано');
  out = run(Hh, { k: 'start', from: ids[0] });
  ok(Hh.S.ph === 'lobby' && to(out, ids[0]).some(m => m.t === 'sys'), 'один — начать нельзя');
  run(Hh, { k: 'seats', players: players(4) });
  run(Hh, { k: 'set', r: 2, t: 60, mode: 'all' });
  run(Hh, { k: 'set', r: 9, t: 7, mode: 'xxx' });
  ok(Hh.S.set.r === 2 && Hh.S.set.t === 60 && Hh.S.set.mode === 'all', 'настройки: только допустимые');
  out = run(Hh, { k: 'start', from: ids[0] });
  const S = Hh.S;
  ok(S.ph === 'choose' && S.dr === ids[0] && S.rd === 1 && S.tn === 1, 'старт: ход первого, выбор слова');
  const opts = to(out, ids[0]).find(m => m.t === 'opts');
  ok(opts && opts.w.length === 3 && opts.lv.join() === '1,2,3', 'художнику лично — 3 слова разной сложности', opts);
  ok(!JSON.stringify(bc(out)).includes(opts.w[0]) && !JSON.stringify(to(out, ids[1])).includes(opts.w[0]), 'варианты слов другим не уходят');
  out = run(Hh, { k: 'pick', from: ids[1], i: 0, tn: 1 });
  ok(S.ph === 'choose', 'выбрать слово может только художник');
  out = run(Hh, { k: 'pick', from: ids[0], i: 2, tn: 1 });
  const word = opts.w[2];
  ok(S.ph === 'draw' && S.lv === 3 && S.mask === K.maskOf(word) && Hh.word === word, 'художник выбрал — рисуем, маска', [S.mask, word]);
  ok(to(out, ids[0]).some(m => m.t === 'word' && m.w === word), 'художнику — подтверждение слова');
  ok(!JSON.stringify(bc(out)).includes(word), 'слово не разослано всем');
  const T = S.set.t * 1000;
  ok(Hh.wake === Math.min(Hh.dl, ...Hh.hints) && Hh.hints.length >= 1, 'будильник — на подсказку');
  // догадки
  now += 1000;
  out = run(Hh, { k: 'guess', from: ids[1], x: 'собачка' });
  ok(bc(out).some(m => m.t === 'chat' && m.id === ids[1] && m.x === 'собачка'), 'мимо — в общий чат');
  out = run(Hh, { k: 'guess', from: ids[0], x: word });
  ok(!out.length || !bc(out).some(m => m.t === 'chat'), 'художник не пишет в чат, пока рисует');
  const close = word.slice(0, -1) + (word.endsWith('а') ? 'о' : 'а');
  out = run(Hh, { k: 'guess', from: ids[2], x: close });
  ok(to(out, ids[2]).some(m => m.t === 'cls') && bc(out).some(m => m.t === 'chat'), '«близко» — лично, а сама догадка — всем', [close, word]);
  out = run(Hh, { k: 'guess', from: ids[3], x: 'это ' + word + 'ище' });
  ok(to(out, ids[3]).some(m => m.t === 'cls' && m.near) && !bc(out).some(m => m.t === 'chat'), 'слово внутри — только «почти» лично, всем не видно');
  now += 5000;
  out = run(Hh, { k: 'guess', from: ids[1], x: word.toUpperCase() });
  const hit1 = bc(out).find(m => m.t === 'hit');
  ok(hit1 && hit1.id === ids[1] && S.gs.includes(ids[1]) && S.sc[ids[1]] === hit1.p, 'угадал — очки и событие всем', hit1);
  ok(!JSON.stringify(bc(out)).includes(word.toLowerCase()) && !JSON.stringify(bc(out)).includes(word.toUpperCase()), 'верная догадка не видна другим');
  const exp = Math.round((50 + 250 * (T - 6000) / T) * 1.5) + 40;
  ok(hit1.p === exp, 'очки: быстрее и сложнее — больше, первому +40', [hit1.p, exp]);
  out = run(Hh, { k: 'guess', from: ids[1], x: 'легко!' });
  ok(to(out, ids[0]).some(m => m.t === 'gc') && !to(out, ids[2]).length && !bc(out).some(m => m.t === 'chat'), 'чат угадавших — только угадавшим и художнику');
  // подсказки
  now += T * .5;
  out = run(Hh, { k: 'tick' });
  const opened = [...S.mask].filter(c => /[а-я]/.test(c)).length;
  ok(opened === 1, 'на половине времени открылась 1 буква', S.mask);
  // спам догадками
  for (let i = 0; i < 4; i++) run(Hh, { k: 'guess', from: ids[2], x: 'мимо' + i });
  out = run(Hh, { k: 'guess', from: ids[2], x: 'мимо5' });
  ok(to(out, ids[2]).some(m => m.t === 'slow'), 'не больше 4 сообщений за 3 с');
  now += 3100;
  out = run(Hh, { k: 'guess', from: ids[2], x: word });
  ok(S.gs.length === 2 && bc(out).find(m => m.t === 'hit').p >= 50 + 20, 'второй угадал: +20 за место');
  out = run(Hh, { k: 'guess', from: ids[3], x: word });
  ok(S.ph === 'reveal' && S.why === 'all' && S.word === word, 'все угадали — показываем слово');
  ok(S.gain[ids[0]] === Math.round(200 * 1.5), 'художник: за всех угадавших — 200 × сложность', S.gain);
  // следующие ходы до конца
  now += K.REVEAL_MS;
  out = run(Hh, { k: 'tick' });
  ok(S.ph === 'choose' && S.dr === ids[1] && S.tn === 2, 'дальше рисует следующий');
  now += K.CHOOSE_MS + 10;
  out = run(Hh, { k: 'tick' });
  ok(S.ph === 'draw' && Hh.word, 'не выбрал за 15 с — слово выбрано само');
  ok(to(out, ids[1]).some(m => m.t === 'word'), 'художник узнал слово (выбрано за него)');
  now += T + 10;
  out = run(Hh, { k: 'tick' });
  ok(S.ph === 'reveal' && S.why === 'none' && !S.gain[ids[1]], 'время вышло, никто не угадал — художнику 0');
  // жалобы
  now += K.REVEAL_MS; run(Hh, { k: 'tick' }); now += 100; run(Hh, { k: 'pick', from: S.dr, i: 0, tn: S.tn });
  const drC = S.dr;
  run(Hh, { k: 'vote', from: ids[0], tn: S.tn });
  run(Hh, { k: 'vote', from: ids[0], tn: S.tn });
  ok(S.ph === 'draw' && S.votes === 1, 'жалоба одна от человека');
  run(Hh, { k: 'vote', from: drC, tn: S.tn });
  ok(S.votes === 1, 'художник на себя не жалуется');
  run(Hh, { k: 'vote', from: ids[3], tn: S.tn });
  ok(S.ph === 'reveal' && S.why === 'vote' && S.ex.includes(drC), '2 жалобы из 3 — ход пропущен, художник больше не рисует');
  // уход игрока и художника
  now += K.REVEAL_MS; run(Hh, { k: 'tick' });
  ok(S.dr !== drC, 'исключённого пропускают в очереди', S.dr);
  now += 100; run(Hh, { k: 'pick', from: S.dr, i: 1, tn: S.tn });
  const drD = S.dr;
  out = run(Hh, { k: 'seats', players: players(4).filter(p => p.id !== drD) });
  ok(S.ph === 'reveal' && S.why === 'left' && !S.ord.includes(drD), 'художник ушёл — ход окончен, его нет в очереди');
  // доигрываем до финала
  let guard = 0;
  while (S.ph !== 'final' && guard++ < 200) {
    now += 20000;
    run(Hh, { k: 'tick' });
    if (S.ph === 'choose') run(Hh, { k: 'pick', from: S.dr, i: 0, tn: S.tn });
    if (S.ph === 'draw') for (const id of S.ord) if (id !== S.dr) run(Hh, { k: 'guess', from: id, x: Hh.word });
  }
  ok(S.ph === 'final' && S.why === 'end' && S.rd > S.set.r, 'игра доходит до итогов');
  const rk = K.ranking(S);
  ok(rk.length === 3 && rk[0].p >= rk[1].p && rk[1].p >= rk[2].p && rk[0].place === 1, 'места по очкам', rk);
  ok(Hh.wake === 0, 'в итогах будильник не нужен');
  // новая игра: очки с нуля
  out = run(Hh, { k: 'start', from: ids[0] });
  ok(S.ph === 'choose' && Object.values(S.sc).every(v => v === 0) && S.g === 2, 'ещё игра — очки с нуля');
  // меньше двух — итоги
  run(Hh, { k: 'seats', players: players(1) });
  ok(S.ph === 'final' && S.why === 'few', 'остался один — итоги');
}
// свои слова и простые
{
  const Hh = K.newHost();
  run(Hh, { k: 'seats', players: players(3) });
  run(Hh, { k: 'set', mode: 'own' });
  run(Hh, { k: 'own', text: 'Денчик37, стрим, хуйня, ок, кот, кот, https://x.ru, майнкрафт крипер' });
  ok(Hh.own.join('|') === 'стрим|ок|кот|майнкрафт крипер', 'свои слова: без мата, ссылок, повторов и цифр', Hh.own);
  ok(Hh.S.set.own === 4 && !JSON.stringify(Hh.S).includes('крипер'), 'другим видно только число своих слов');
  const out = run(Hh, { k: 'start', from: ids[0] });
  const o = to(out, ids[0]).find(m => m.t === 'opts');
  ok(o.w.length === 3 && o.w.every(w => Hh.own.includes(w)), 'загадываются свои слова', o.w);
  const H2 = K.newHost();
  run(H2, { k: 'seats', players: players(2) }); run(H2, { k: 'set', mode: 'easy' });
  const o2 = to(run(H2, { k: 'start', from: ids[0] }), ids[0]).find(m => m.t === 'opts');
  ok(o2.lv.join() === '1,1,1' && o2.w.every(w => K.LISTS[1].includes(w)), 'режим «простые»');
}
// смена ведущего посреди хода
{
  const Hh = K.newHost();
  run(Hh, { k: 'seats', players: players(4) });
  run(Hh, { k: 'start', from: ids[0] });
  run(Hh, { k: 'pick', from: ids[0], i: 0, tn: 1 });
  now += 3000;
  run(Hh, { k: 'guess', from: ids[1], x: Hh.word });
  const word = Hh.word, Slast = JSON.parse(JSON.stringify(Hh.S));
  // ушёл ведущий-игрок c~3 (не художник): новый ведущий — b~2, слова не знает; d~4 ещё угадывает
  const three = players(4).filter(p => p.id !== ids[2]);
  const N = K.hostFrom(Slast, '');
  let out = run(N, { k: 'takeover', players: three, left: 40000 });
  ok(N.S.ph === 'draw' && N.waitWord > now && N.S.gs.includes(ids[1]), 'новый ведущий: ждёт слово, угаданное сохранилось');
  out = run(N, { k: 'guess', from: ids[3], x: word });
  ok(!bc(out).some(m => m.t === 'chat') && N.pending.length === 1, 'пока слова нет — догадки ждут, в общий чат не уходят');
  out = run(N, { k: 'word', from: ids[1], w: 'неправда', tn: N.S.tn });
  ok(!N.word, 'слово принимается только от художника');
  out = run(N, { k: 'word', from: ids[0], w: word, lv: 1, tn: N.S.tn });
  ok(N.word === word && !N.waitWord && N.S.gs.includes(ids[3]) && N.S.ph === 'reveal', 'художник прислал слово новому ведущему; отложенная догадка засчитана');
  // без слова — ход прерван
  const N2 = K.hostFrom(Slast, '');
  run(N2, { k: 'takeover', players: three, left: 40000 });
  now += K.WORD_WAIT + 10;
  run(N2, { k: 'tick' });
  ok(N2.S.ph === 'reveal' && N2.S.why === 'host', 'слово не пришло за 2,5 с — ход прерван');
  // ведущий ушёл во время выбора — новый ведущий даёт художнику новые варианты
  const H3 = K.newHost(); run(H3, { k: 'seats', players: players(3) }); run(H3, { k: 'start', from: ids[0] });
  const N3 = K.hostFrom(H3.S, '');
  out = run(N3, { k: 'takeover', players: players(3).filter(p => p.id !== ids[2]), left: 9000 });
  ok(N3.S.ph === 'choose' && to(out, ids[0]).some(m => m.t === 'opts' && m.tn === N3.S.tn), 'выбор слова: новые варианты художнику');
}

// ═══ 6. Комната: подменная сеть (presence + сообщения), поддельные часы ═══
function makeClock(){
  const C = { t: 1e6, q: [], id: 0 };
  C.now = () => C.t;
  C.setT = (f, ms) => { const id = ++C.id; C.q.push({ id, at: C.t + Math.max(0, ms | 0), f }); return id; };
  C.clearT = id => { C.q = C.q.filter(x => x.id !== id); };
  C.advance = async ms => { const end = C.t + ms; for (;;) { await flushAll(); C.q.sort((a, b) => a.at - b.at || a.id - b.id); const x = C.q[0]; if (!x || x.at > end) break; C.q.shift(); C.t = x.at; x.f(); } C.t = end; await flushAll(); };
  return C;
}
const flushAll = async () => { for (let i = 0; i < 4; i++) { await new Promise(r => setImmediate(r)); await new Promise(r => setTimeout(r, 1)); } };
function makeBus(clock){
  const B = { ch: new Map(), sent: 0, delivered: 0, drop: null };
  B.open = (name, key) => {
    let c = B.ch.get(name); if (!c) B.ch.set(name, c = { members: new Set(), pres: new Map() });
    const T = { onStatus: null, onSync: null, onMsg: null, key };
    c.members.add(T);
    const syncAll = () => { const st = {}; for (const [k, metas] of c.pres) st[k] = metas.map(m => ({ ...m })); for (const m of c.members) clock.setT(() => m.onSync?.(st), 1); };
    T.track = async meta => { c.pres.set(key, [...(c.pres.get(key) || []).filter(x => x._t !== T), { ...meta, _t: T }].map(x => x)); syncAll(); };
    T.send = payload => { B.sent++; const p = JSON.parse(JSON.stringify(payload)); for (const m of c.members) if (m !== T) { if (B.drop && B.drop(p, m)) continue; B.delivered++; clock.setT(() => m.onMsg?.(p), 2); } };
    T.close = () => { c.members.delete(T); const l = (c.pres.get(key) || []).filter(x => x._t !== T); if (l.length) c.pres.set(key, l); else c.pres.delete(key); syncAll(); };
    clock.setT(() => T.onStatus?.('SUBSCRIBED'), 3);
    return T;
  };
  return B;
}
// presence в тестовой сети хранит служебное поле _t — уберём при выдаче
async function roomTest(useCrypto){
  const clock = makeClock(), bus = makeBus(clock);
  const got = {};
  const mk = (key, nick) => {
    got[key] = [];
    const R = K.createRoom({ open: bus.open, game: 'krokodil', code: 'test1', max: 3, me: { key, nick }, net: null, subtle: useCrypto ? globalThis.crypto.subtle : null,
      now: clock.now, setT: clock.setT, clearT: clock.clearT,
      onState: () => {}, onMsg: (from, m, how) => got[key].push({ from, m, how }), onError: r => got[key].push({ err: r }) });
    return R;
  };
  const A = mk('ka', 'Аня'); await clock.advance(50);
  const B = mk('kb', 'Боря'); await clock.advance(50);
  const Cc = mk('kc', 'Вика'); await clock.advance(1000);
  ok(A.isHost && !B.isHost && !Cc.isHost && A.players.length === 3 && B.host === A.me, `комната${useCrypto ? ' (шифр)' : ''}: хозяин — первый вошедший`);
  const D = mk('kd', 'Гоша'); await clock.advance(1000);
  ok(got.kd.some(x => x.err === 'full'), 'четвёртый в комнату на 3 — «заполнена»');
  A.send({ t: 'hello' }); await clock.advance(20);
  ok(got.kb.some(x => x.m?.t === 'hello' && x.how === 'pub' && x.from === A.me) && got.kc.some(x => x.m?.t === 'hello'), 'общие сообщения доходят всем');
  B.sendTo(A.me, { t: 'g', x: 'секрет' }); await clock.advance(20);
  ok(got.ka.some(x => x.m?.t === 'g' && x.m.x === 'секрет' && x.how === 'priv' && x.from === B.me), 'личное сообщение дошло до хозяина');
  ok(!got.kc.some(x => x.m?.t === 'g'), 'личное — не видно другим');
  if (useCrypto) {
    let seen = false; bus.drop = p => { if (p.k === 'p') seen = seen || JSON.stringify(p).includes('секрет2'); return false; };
    B.sendTo(A.me, { t: 'g', x: 'секрет2' }); await clock.advance(20); bus.drop = null;
    ok(!seen && got.ka.some(x => x.m?.x === 'секрет2'), 'личное — зашифровано в сети (AES-GCM)');
  }
  // поток рисунка от гостя без прямой связи — всем сразу через сервер
  Cc.stream({ t: 'd', tn: 1, q: 1, n: 1, o: [1, 1, 1, 5, 5] }, K.mergeD); await clock.advance(20);
  ok(got.ka.some(x => x.how === 'stream' && x.from === Cc.me) && got.kb.some(x => x.how === 'stream' && x.from === Cc.me), 'рисунок гостя — всем через сервер');
  // хозяин копит рисунок для пересылки и склеивает
  const before = bus.sent;
  for (let q = 1; q <= 3; q++) A.stream({ t: 'd', tn: 2, q, n: 1, o: [2, 1, q, q] }, K.mergeD);
  await clock.advance(500);
  const recvB = got.kb.filter(x => x.how === 'stream' && x.m.tn === 2);
  ok(bus.sent - before === 1 && recvB.length === 1 && recvB[0].m.n === 3, 'хозяин: 3 пачки за 0,35 с — одним сообщением', [bus.sent - before, recvB.map(x => x.m)]);
  // смена хозяина: A ушёл
  A.leave(); await clock.advance(100);
  ok(B.isHost && Cc.host === B.me, 'хозяин ушёл — хозяин следующий по времени входа');
  // та же учётка из другой вкладки
  const B2 = K.createRoom({ open: bus.open, game: 'krokodil', code: 'test1', max: 3, me: { key: 'kb', nick: 'Боря' }, net: null, subtle: null, now: clock.now, setT: clock.setT, clearT: clock.clearT, onState: () => {}, onMsg: () => {}, onError: () => {} });
  clock.t += 5; await clock.advance(1000);
  ok(got.kb.some(x => x.err === 'dup'), 'та же учётка во второй вкладке — первая уступает');
  B2.leave(); Cc.leave(); D.leave();
}

// ═══ 7. Целая игра: 4 «браузера» поверх подменной сети (тот же протокол, что в экране игры) ═══
async function fullGame(){
  const clock = makeClock(), bus = makeBus(clock);
  const cl = [];
  function client(key, nick){
    const c = { key, nick, S: null, H: null, word: '', pic: K.makePic(), lastQ: 0, q: 0, chat: [], hits: [], cls: 0, seenWords: [] };
    const step = ev => {
      if (!c.H) return;
      ev.now = clock.now();
      const out = K.hostStep(c.H, ev, { rand });
      for (const [t, m] of out) { if (t === '*') { c.R.send(m); fromHost(m); } else if (t === c.R.me) fromHost(m); else c.R.sendTo(t, m); }
      clock.clearT(c.wakeT);
      if (c.H.wake) c.wakeT = clock.setT(() => step({ k: 'tick' }), Math.max(30, c.H.wake - clock.now() + 5));
    };
    c.step = step;
    function fromHost(m){
      if (m.t === 'st') { const nt = !c.S || m.s.tn !== c.S.tn; c.S = m.s; if (nt) { c.pic.reset(); c.lastQ = 0; c.q = 0; if (c.S.dr !== c.R.me) c.word = ''; } }
      else if (m.t === 'opts') c.opts = m;
      else if (m.t === 'word') c.word = m.w;
      else if (m.t === 'chat') c.chat.push(m.x);
      else if (m.t === 'hit') c.hits.push(m.id);
      else if (m.t === 'cls') c.cls++;
    }
    c.R = K.createRoom({ open: bus.open, game: 'krokodil', code: 'full', max: 10, me: { key, nick }, net: null, subtle: null, now: clock.now, setT: clock.setT, clearT: clock.clearT,
      onState: R => {
        const pl = R.players.map(p => ({ id: p.id, nick: p.nick }));
        if (R.isHost && !c.H) { c.H = c.S ? K.hostFrom(c.S, c.S.dr === R.me ? c.word : '') : K.newHost(); step(c.S ? { k: 'takeover', players: pl, left: 30000 } : { k: 'seats', players: pl }); }
        else if (R.isHost) step({ k: 'seats', players: pl });
        if (c.S && c.S.ph === 'draw' && c.S.dr === R.me && c.word && !R.isHost) R.sendTo(R.host, { t: 'word', w: c.word, lv: c.S.lv, tn: c.S.tn });
      },
      onMsg: (from, m, how) => {
        for (const v of Object.values(m || {})) if (typeof v === 'string') c.seenWords.push(v);
        if (c.H && how === 'priv') { if (m.t === 'g') return step({ k: 'guess', from, x: m.x }); if (m.t === 'pick') return step({ k: 'pick', from, i: m.i, tn: m.tn }); if (m.t === 'word') return step({ k: 'word', from, w: m.w, lv: m.lv, tn: m.tn }); }
        if (how === 'stream') { if (c.S && m.tn === c.S.tn && from === c.S.dr && m.q === c.lastQ + 1) { c.pic.apply(m.o); c.lastQ = m.q + (m.n || 1) - 1; } return; }
        if (from !== c.R.host) return;
        fromHost(m);
      },
      onError: () => {} });
    cl.push(c);
    return c;
  }
  const A = client('ua', 'Аня'); await clock.advance(30);
  const B = client('ub', 'Боря'); await clock.advance(30);
  const Cc = client('uc', 'Вика'); await clock.advance(30);
  const D = client('ud', 'Гоша'); await clock.advance(1500);
  ok(cl.every(c => c.S && c.S.ph === 'lobby' && Object.keys(c.S.nm).length === 4), 'игра: все в лобби, видят 4 игроков');
  A.step({ k: 'set', r: 1, t: 60, mode: 'all' });
  A.step({ k: 'start', from: A.R.me }); await clock.advance(50);
  ok(cl.every(c => c.S.ph === 'choose' && c.S.dr === A.R.me), 'игра: у всех — выбор слова Ани');
  ok(A.opts && !B.opts && !Cc.opts, 'варианты — только художнику');
  // художник (он же хозяин) выбирает и рисует
  A.step({ k: 'pick', from: A.R.me, i: 0, tn: A.S.tn }); await clock.advance(50);
  const w1 = A.word;
  ok(w1 && cl.every(c => c.S.ph === 'draw') && !B.word && !B.seenWords.includes(w1) && !Cc.seenWords.includes(w1), 'рисуем; слово знает только художник');
  for (let q = 1; q <= 5; q++) { const o = q === 1 ? [1, 4, 2, 100, 100] : [2, 1, 100 + q * 30, 100 + q * 20]; A.pic.apply(o); A.R.stream({ t: 'd', tn: A.S.tn, q, n: 1, o }, K.mergeD); await clock.advance(120); }
  await clock.advance(400);
  ok([B, Cc, D].every(c => c.pic.hash() === A.pic.hash() && c.lastQ === 5), 'рисунок у всех такой же, как у художника', [B.lastQ, Cc.lastQ, D.lastQ]);
  // догадки: Боря угадывает, Вика пишет мимо
  Cc.R.sendTo(Cc.R.host, { t: 'g', x: 'не знаю' }); await clock.advance(40);
  B.R.sendTo(B.R.host, { t: 'g', x: w1 }); await clock.advance(40);
  ok(cl.every(c => c.hits.includes(B.R.me)) && cl.every(c => c.chat.includes('не знаю')), 'угадал Боря — видят все; «не знаю» — в чате у всех');
  ok(!Cc.seenWords.some(s => K.norm(s) === K.norm(w1)) && !D.seenWords.some(s => K.norm(s) === K.norm(w1)), 'верную догадку Бори другие не видели');
  // ведущий (Аня, она же художник) уходит — ход прерван у нового ведущего? Нет: художник ушёл → ход окончен
  A.R.leave(); cl.splice(cl.indexOf(A), 1); await clock.advance(200);
  ok(B.R.isHost && B.H, 'новый ведущий — Боря');
  ok(cl.every(c => c.S.ph === 'reveal' && c.S.why === 'left'), 'художник-ведущий ушёл — ход окончен у всех', cl.map(c => [c.S.ph, c.S.why]));
  await clock.advance(6000);
  ok(cl.every(c => c.S.ph === 'choose' && c.S.dr === B.R.me), 'следующий ход — у нового ведущего Бори', cl.map(c => c.S.dr));
  // Вика рисует после Бори; Боря (ведущий) уходит посреди хода Вики — слово новому ведущему (Вике) знать не надо: она художник
  B.step({ k: 'pick', from: B.R.me, i: 1, tn: B.S.tn }); await clock.advance(50);
  Cc.R.sendTo(Cc.R.host, { t: 'g', x: B.word }); D.R.sendTo(D.R.host, { t: 'g', x: B.word }); await clock.advance(80);
  ok(cl.every(c => c.S.ph === 'reveal' && c.S.why === 'all'), 'все угадали слово Бори');
  await clock.advance(6000);
  ok(cl.every(c => c.S.ph === 'choose' && c.S.dr === Cc.R.me), 'ход Вики');
  Cc.R.sendTo(Cc.R.host, { t: 'pick', i: 0, tn: Cc.S.tn }); await clock.advance(80);
  ok(Cc.word && cl.every(c => c.S.ph === 'draw'), 'Вика выбрала слово (через ведущего)');
  const w3 = Cc.word;
  B.R.leave(); cl.splice(cl.indexOf(B), 1); await clock.advance(400);
  ok(Cc.R.isHost && Cc.H && Cc.H.word === w3 && Cc.S.ph === 'draw', 'ведущий ушёл посреди хода Вики — Вика ведёт и продолжает свой ход');
  D.R.sendTo(D.R.host, { t: 'g', x: w3 }); await clock.advance(100);
  ok(cl.every(c => c.S.ph === 'reveal' && c.S.why === 'all'), 'Гоша угадал у нового ведущего');
  await clock.advance(6000);
  ok(cl.every(c => c.S.ph === 'choose' && c.S.dr === D.R.me), 'ход Гоши');
  // Гоша рисует, ведущий-Вика уходит → Гоша один → итоги
  Cc.R.leave(); cl.splice(cl.indexOf(Cc), 1); await clock.advance(400);
  ok(D.R.isHost && D.S.ph === 'final' && D.S.why === 'few', 'остался один — итоги');
  D.R.leave();
  ok(bus.sent < 400, 'сообщений через сервер немного', bus.sent);
}

(async () => {
  await roomTest(false);
  await roomTest(true);
  await fullGame();
  console.log(`krokodil-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
