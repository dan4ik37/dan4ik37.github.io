// Тесты «Района участков» (js/games/mir-base.js) в node: каталог, правила стройки (как base_act в bases.sql), добыча
// кирпичей, подарок дня, мебель, проверка сохранённого, геометрия района на карте мира и случайная «стройка» с проверкой
// правил после каждого хода. Запуск из корня сайта: node scripts/base-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/games/mir-base.js'), 'utf8'), { filename: 'mir-base.js' });
const MB = globalThis.MirBase, RU = MB.Rules, { DEFS, FURN, Geo } = MB;
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const T0 = 1760000000;   // «сейчас» (секунды)
const fresh = (now = T0) => RU.fresh(1, now);
const act = (s, a, g, now = T0, w) => RU.act(s, a, g, now, w);
const find = (s, k) => s.layout.find(it => it.k === k);
const nondec = a => a.every((v, i) => i === 0 || v >= a[i - 1]);

// ═══ Каталог ═══
{
  for (const [k, D] of Object.entries(DEFS)) {
    ok(D.cost.length === D.lv && D.time.length === D.lv, `${k}: цена и время на каждый уровень`);
    ok(nondec(D.cost) && nondec(D.time), `${k}: дороже и дольше с уровнем`);
    ok(Number.isInteger(D.w) && Number.isInteger(D.d) && D.w >= 1 && D.d >= 1, `${k}: размер`);
    if (D.g !== 'deco') ok(Array.isArray(D.max) && D.max.length === 5 && nondec(D.max), `${k}: лимит по ратуше`);
    else ok(D.lv === 1 && D.time[0] === 0, `${k}: украшение без уровней и стройки`);
    ok(typeof D.n === 'string' && D.e, `${k}: название и значок`);
  }
  ok(DEFS.mine.hold.every((h, i) => h === DEFS.mine.rate[i] * 8), 'шахта вмещает 8 часов добычи');
  ok(DEFS.th.keep.length === 5 && DEFS.store.keep.length === 5 && DEFS.house.furn.length === 5, 'вместимость и мебель на 5 уровней');
  // дорогое улучшение ратуши можно накопить: вместимость на предыдущем уровне с лучшими складами ≥ цены
  for (let t = 2; t <= 5; t++) {
    const prev = t - 1, stores = DEFS.store.max[prev - 1], best = DEFS.th.keep[prev - 1] + stores * DEFS.store.keep[Math.min(DEFS.store.lv, prev) - 1];
    ok(best >= DEFS.th.cost[t - 1], `ратуша ${t}: хватает места на складах (${best} ≥ ${DEFS.th.cost[t - 1]})`);
  }
  for (const [k, F] of Object.entries(FURN)) ok(Number.isInteger(F.w) && Number.isInteger(F.d) && F.w <= 3 && F.d <= 3 && ((F.cost > 0) !== (F.coins > 0)), `мебель ${k}: размер и одна цена`);
  const S = MB.SERVER;
  ok(S.n === 12 && S.in === 9 && S.per === 6 && S.plots === 600 && S.k.mine.rate.length === 5 && S.f.rug.floor === 1 && !('n' in S.k.th), 'серверная часть каталога (base_defs)');
}

// ═══ Новый участок ═══
{
  const s = fresh();
  ok(s.layout.every(it => RU.fits(s.layout, it.x, it.z, ...RU.fp(it.k, it.r), it.i)), 'новый участок: ничего не пересекается');
  ok(RU.th(s) === 1 && s.bricks === 600 && RU.cap(s) === 1000 && RU.builders(s) === 1 && RU.busy(s, T0) === 0, 'ратуша 1, 600 кирпичей, склад 1000, 1 строитель');
  ok(s.room.every(it => RU.ffits(s.room, it.k, it.x, it.z, ...RU.ffp(it.k, it.r), it.i)), 'мебель на месте');
  ok(s.own['f:bed'] === 1 && s.own['f:rug'] === 1, 'стартовая мебель — своя');
}

// ═══ Постройка ═══
{
  const s = fresh();
  ok(act(s, 'place', { k: 'mine', x: 1, z: 1, r: 0 }).reason === 'max', 'вторая шахта при ратуше 1 — лимит');
  ok(act(s, 'place', { k: 'shop', x: 1, z: 1, r: 0 }).reason === 'th', 'мастерская — с ратуши 2');
  ok(act(s, 'place', { k: 'fountain', x: 1, z: 1, r: 0 }).reason === 'th', 'фонтан — с ратуши 2');
  ok(act(s, 'place', { k: 'th', x: 1, z: 1, r: 0 }).reason === 'kind' && act(s, 'place', { k: 'house', x: 1, z: 1, r: 0 }).reason === 'kind', 'вторую ратушу/дом не поставить');
  ok(act(s, 'place', { k: 'store', x: 5, z: 3, r: 0 }).reason === 'place', 'на ратушу — нельзя');
  ok(act(s, 'place', { k: 'store', x: 11, z: 0, r: 0 }).reason === 'place', 'за край — нельзя');
  let r = act(s, 'place', { k: 'store', x: 1, z: 1, r: 0 });
  const st = s.layout.find(it => it.i === r.id);
  ok(r.ok && s.bricks === 450 && st.l === 0 && st.ul === 1 && st.ue === T0 + 20 && RU.busy(s, T0) === 1, 'склад: −150, стройка 20 с, строитель занят', st);
  ok(act(s, 'upgrade', { id: find(s, 'house').i }).reason === 'lvcap', 'дом 2 — потолок ратуши (проверяется раньше строителя)');
  s.bricks = 900; ok(act(s, 'upgrade', { id: find(s, 'th').i }).reason === 'builder' && s.bricks === 900, 'единственный строитель занят — ничего не списано'); s.bricks = 450;
  ok(act(s, 'upgrade', { id: st.i }).reason === 'busy', 'стройка не улучшается');
  ok(RU.cap(s) === 1000, 'недостроенный склад не добавляет места');
  RU.norm(s, T0 + 20);
  ok(st.l === 1 && st.ul == null && st.ue == null && RU.cap(s) === 2000 && RU.busy(s, T0 + 20) === 0, 'достроился: склад 1, место 2000');
  // заборы: мгновенно, лимит 20, каждый 10
  let n = 0;
  for (let z = 0; z < 12 && n < 25; z++) for (let x = 0; x < 12 && n < 25; x++) { if (act(s, 'place', { k: 'wall', x, z, r: 0 }, T0 + 21).ok) n++; }
  ok(n === 20 && RU.count(s.layout, 'wall') === 20 && s.bricks === 450 - 200, '20 заборов при ратуше 1, по 10 🧱', { n, b: s.bricks });
  ok(s.layout.filter(it => it.k === 'wall').every(it => it.l === 1 && it.ue == null), 'заборы строятся сразу');
  // поворот меняет размер: скамейка 2×1
  const s2 = fresh();
  ok(act(s2, 'place', { k: 'bench', x: 11, z: 0, r: 0 }).reason === 'place', 'скамейка 2×1 у края — не влезает');
  ok(act(s2, 'place', { k: 'bench', x: 11, z: 0, r: 1 }).ok, 'повёрнутая (1×2) — влезает');
  // украшения: общий лимит 6, убранное — в запас, ставится бесплатно
  const s3 = fresh(), spots = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [1, 1]];
  const kinds = ['tree', 'pine', 'bush', 'flowers', 'rock', 'lamp', 'flag'];
  const res = spots.map(([x, z], i) => act(s3, 'place', { k: kinds[i], x, z, r: 0 }));
  ok(res.slice(0, 6).every(r => r.ok) && res[6].reason === 'max', '6 украшений при ратуше 1, седьмое — лимит');
  const b0 = s3.bricks, tree = s3.layout.find(it => it.k === 'tree');
  ok(act(s3, 'remove', { id: tree.i }).ok && s3.own.tree === 1 && !s3.layout.some(it => it.k === 'tree'), 'убрал дерево — оно в запасе');
  ok(act(s3, 'place', { k: 'tree', x: 7, z: 9, r: 0 }).ok && s3.bricks === b0, 'из запаса — бесплатно');
  ok(act(s3, 'place', { k: 'flag', x: 7, z: 10, r: 0 }).reason === 'max', 'лимит украшений — с учётом поставленных из запаса');
  ok(act(s3, 'remove', { id: find(s3, 'mine').i }).reason === 'fixed', 'постройку не убрать');
  // за монеты
  const s4 = fresh();
  find(s4, 'th').l = 3;
  ok(act(s4, 'place', { k: 'statue', x: 0, z: 0, r: 0 }).reason === 'coins', 'статуя без кошелька — монеты');
  const w = { coins: 150 };
  ok(act(s4, 'place', { k: 'statue', x: 0, z: 0, r: 0 }, T0, w).reason === 'coins' && w.coins === 150, 'не хватает монет — ничего не списано');
  w.coins = 250;
  r = act(s4, 'place', { k: 'statue', x: 0, z: 0, r: 0 }, T0, w);
  ok(r.ok && w.coins === 50 && r.coins === 200 && s4.bricks === 600 && s4.own.statue === 1, 'статуя за 200 🪙');
}

// ═══ Улучшения, ратуша, строители ═══
{
  const s = fresh();
  const mine = find(s, 'mine'), th = find(s, 'th'), house = find(s, 'house');
  ok(act(s, 'upgrade', { id: mine.i }).reason === 'lvcap', 'шахта 2 — нужна ратуша 2');
  ok(act(s, 'upgrade', { id: th.i }).ok && s.bricks === 100 && th.ul === 2 && th.ue === T0 + 300, 'ратуша 2: −500, 5 мин');
  ok(RU.th(s) === 1, 'пока строится — ратуша прежняя');
  ok(act(s, 'upgrade', { id: 999 }).reason === 'id', 'нет такой постройки');
  RU.norm(s, T0 + 299); ok(th.l === 1, 'за секунду до конца — ещё строится');
  RU.norm(s, T0 + 300); ok(th.l === 2 && RU.th(s) === 2 && RU.cap(s) === 1500, 'ратуша 2: место 1500');
  s.bricks = 1500;
  ok(act(s, 'upgrade', { id: mine.i }, T0 + 300).ok && s.bricks === 1250 + Math.min(250, RU.prod({ ...mine, ul: undefined, ue: undefined }, T0 + 300) * 0), 'шахта 2: −250');
  ok(RU.prod(mine, T0 + 400) === 0, 'шахта при улучшении не копит');
  RU.norm(s, T0 + 300 + 120);
  ok(mine.l === 2 && mine.t0 === T0 + 420, 'шахта 2 копит с момента окончания');
  ok(act(s, 'upgrade', { id: house.i }, T0 + 420).ok, 'дом 2');
  s.bricks = 1500;
  r = act(s, 'place', { k: 'shop', x: 9, z: 0, r: 0 }, T0 + 420);
  ok(r.reason === 'builder', 'мастерская — строитель занят (дом)');
  RU.norm(s, T0 + 420 + 120);
  s.bricks = 1500;
  const shop = act(s, 'place', { k: 'shop', x: 9, z: 0, r: 0 }, T0 + 540);
  ok(shop.ok && s.bricks === 500 && RU.builders(s) === 1, 'мастерская: −1000, строится 10 мин');
  RU.norm(s, T0 + 540 + 600);
  ok(RU.builders(s) === 2, 'мастерская готова — 2 строителя');
  s.bricks = 1500;
  ok(act(s, 'upgrade', { id: mine.i }, T0 + 1140).reason === 'lvcap', 'шахта 3 — нужна ратуша 3');
  ok(act(s, 'place', { k: 'mine', x: 9, z: 4, r: 0 }, T0 + 1140).ok && act(s, 'upgrade', { id: house.i }, T0 + 1140).reason === 'lvcap', 'новая шахта + дом 3 — потолок ратуши');
  ok(act(s, 'upgrade', { id: th.i }, T0 + 1140).reason === 'bricks', 'ратуша 3 — не хватает кирпичей');
  const sh = s.layout.find(it => it.k === 'shop');
  ok(act(s, 'upgrade', { id: sh.i }, T0 + 1140).reason === 'maxlv', 'мастерская — один уровень');
  const w1 = s.layout.find(it => it.k === 'wall');
  ok(!w1, 'заборов нет');
  act(s, 'place', { k: 'wall', x: 0, z: 0, r: 0 }, T0 + 1140);
  const wl = s.layout.find(it => it.k === 'wall'), b = s.bricks;
  ok(act(s, 'upgrade', { id: wl.i }, T0 + 1140).ok && wl.l === 2 && s.bricks === b - 30, 'забор 2 — сразу, −30');
  ok(act(s, 'upgrade', { id: wl.i }, T0 + 1140).reason === 'lvcap', 'забор 3 — нужна ратуша 3');
  // два строителя: две стройки, третья — ждать
  s.bricks = 1500;
  const s5 = RU.clone(s);
  const m2 = s5.layout.filter(it => it.k === 'mine')[1];
  RU.norm(s5, T0 + 1200);
  ok(act(s5, 'place', { k: 'store', x: 9, z: 9, r: 0 }, T0 + 1200).ok && RU.busy(s5, T0 + 1200) === 1, 'вторая стройка при 2 строителях (новая шахта уже готова)', m2);
  ok(act(s5, 'upgrade', { id: find(s5, 'house').i }, T0 + 1200).reason === 'lvcap', 'дом 3 упирается в ратушу');
}
var r;

// ═══ Добыча и сбор ═══
{
  const s = fresh(), mine = find(s, 'mine');
  ok(RU.prod(mine, T0) === 0 && RU.prod(mine, T0 + 3600) === 150 && RU.prod(mine, T0 + 1800) === 75, 'шахта 1: 150 в час');
  ok(RU.prod(mine, T0 + 100 * 3600) === 1200, 'вмещает 1200 (8 ч)');
  ok(act(s, 'collect', {}, T0 + 10).reason === 'empty', 'через 10 с собирать нечего');
  r = act(s, 'collect', {}, T0 + 3600);
  ok(r.ok && r.got === 150 && s.bricks === 750 && mine.t0 === T0 + 3600, 'собрал 150');
  // склад почти полон: остаток остаётся в шахте
  s.bricks = 950;
  r = act(s, 'collect', { id: mine.i }, T0 + 3600 + 3 * 3600);
  ok(r.ok && r.got === 50 && s.bricks === 1000, 'влезло только 50', r);
  ok(RU.prod(mine, T0 + 4 * 3600) >= 400 && RU.prod(mine, T0 + 4 * 3600) <= 401, 'остальные 400 — в шахте', RU.prod(mine, T0 + 4 * 3600));
  ok(act(s, 'collect', {}, T0 + 4 * 3600).reason === 'full', 'склад полон — «полон»');
  ok(act(s, 'collect', { id: 4242 }, T0 + 4 * 3600).reason === 'empty', 'не шахта — нечего');
  // улучшение шахты сначала собирает
  const s2 = fresh(); find(s2, 'th').l = 2; const m = find(s2, 'mine');
  r = act(s2, 'upgrade', { id: m.i }, T0 + 2 * 3600);
  ok(r.ok && s2.bricks === 600 + 300 - 250, 'перед улучшением шахта отдала 300', s2.bricks);
  // много шахт, порядок сбора: по списку
  const s3 = fresh(); find(s3, 'th').l = 3;
  act(s3, 'place', { k: 'mine', x: 1, z: 0, r: 0 }, T0); RU.norm(s3, T0 + 20);
  s3.bricks = 0;
  r = act(s3, 'collect', {}, T0 + 20 + 3600);
  ok(r.ok && r.got === 150 + 150 + 0 || r.got >= 300, 'две шахты за час — 300', r);
}

// ═══ Подарок дня ═══
{
  const s = fresh();
  r = act(s, 'gift', {}, T0);
  ok(r.ok && r.got === 100 && s.bricks === 700, 'подарок: +100 при ратуше 1');
  ok(act(s, 'gift', {}, T0 + 60).reason === 'done', 'второй раз за день — нет');
  const nextDay = T0 + 86400;
  ok(act(s, 'gift', {}, nextDay).ok, 'на следующий день — снова');
  ok(RU.day(1760043599) !== RU.day(1760043600) && RU.day(1760043600) === '2025-10-10', 'день — по Москве (полночь МСК = 21:00 UTC)', RU.day(1760043600));
  const s2 = fresh(); s2.bricks = RU.cap(s2);
  ok(act(s2, 'gift', {}, T0).reason === 'full' && s2.gift === '', 'склад полон — подарок ждёт');
  s2.bricks = RU.cap(s2) - 30;
  r = act(s2, 'gift', {}, T0);
  ok(r.ok && r.got === 30, 'влезло 30 — подарок забран');
}

// ═══ Мебель ═══
{
  const s = fresh();
  ok(act(s, 'fplace', { k: 'sofa', x: 3, z: 8, r: 0 }).reason === 'place', 'проход от двери — занят');
  ok(act(s, 'fplace', { k: 'rug', x: 3, z: 6, r: 0 }).ok, 'ковёр — можно на проход');
  ok(act(s, 'fplace', { k: 'rug', x: 4, z: 4, r: 0 }).reason === 'place', 'ковёр на ковёр — нельзя');
  ok(act(s, 'fplace', { k: 'chair', x: 4, z: 4, r: 0 }).ok, 'стул на ковёр — можно');
  ok(act(s, 'fplace', { k: 'table', x: 0, z: 1, r: 0 }).reason === 'place', 'на кровать — нельзя');
  ok(act(s, 'fplace', { k: 'bed', x: 8, z: 0, r: 0 }).reason === 'place', 'за стену — нельзя');
  ok(act(s, 'fplace', { k: 'bed', x: 6, z: 0, r: 1 }).ok, 'кровать повёрнута (3×2)');
  const b = s.bricks;
  ok(b === 600 - 40 - 20 - 80, 'мебель за кирпичи', b);
  ok(act(s, 'fplace', { k: 'tv', x: 6, z: 3, r: 0 }).reason === 'coins', 'телевизор — за монеты');
  const w = { coins: 100 };
  r = act(s, 'fplace', { k: 'tv', x: 6, z: 3, r: 0 }, T0, w);
  ok(r.ok && w.coins === 40 && s.own['f:tv'] === 1, 'телевизор за 60 🪙');
  ok(s.room.length === 6, 'в доме 6 предметов');
  ok(act(s, 'fplace', { k: 'plant', x: 0, z: 4, r: 0 }).ok && act(s, 'fplace', { k: 'plant', x: 0, z: 5, r: 0 }).ok, '7 и 8');
  ok(act(s, 'fplace', { k: 'plant', x: 0, z: 6, r: 0 }).reason === 'house', '9-й предмет — дом 1 полон');
  const tv = s.room.find(it => it.k === 'tv');
  ok(act(s, 'fremove', { id: tv.i }).ok && s.own['f:tv'] === 1, 'убрал телевизор — в запасе');
  ok(act(s, 'fplace', { k: 'tv', x: 6, z: 4, r: 0 }).ok, 'из запаса — без монет');
  ok(act(s, 'fmove', { id: tv.i + 100, x: 0, z: 0, r: 0 }).reason === 'id', 'нет такого предмета');
  const t2 = s.room.find(it => it.k === 'tv');
  ok(act(s, 'fmove', { id: t2.i, x: 3, z: 7, r: 0 }).reason === 'place', 'в проход — нельзя');
  ok(act(s, 'fmove', { id: t2.i, x: 6, z: 5, r: 0 }).ok && t2.z === 5, 'передвинул');
  // уровень дома — больше мебели
  find(s, 'house').l = 2;
  ok(act(s, 'fplace', { k: 'plant', x: 0, z: 6, r: 0 }).ok, 'дом 2 — больше места');
}

// ═══ Перемещение, доступ, проверка аргументов ═══
{
  const s = fresh(), house = find(s, 'house');
  ok(act(s, 'move', { id: house.i, x: 5, z: 3, r: 0 }).reason === 'place', 'дом на ратушу — нельзя');
  ok(act(s, 'move', { id: house.i, x: 0, z: 7, r: 2 }).ok && house.z === 7 && house.r === 2, 'дом сдвинут и повёрнут');
  ok(act(s, 'move', { id: house.i, x: 0, z: 7, r: 2 }).ok, 'на своё же место — можно');
  ok(act(s, 'move', { id: house.i, x: 8, z: 7, r: 0 }).reason === 'place', 'дом 5×5 за край — нельзя');
  find(s, 'th').l = 2;
  act(s, 'upgrade', { id: house.i });
  ok(act(s, 'move', { id: house.i, x: 0, z: 6, r: 0 }).ok && house.ul === 2, 'строящееся можно двигать');
  for (const a of ['all', 'friends', 'nobody']) ok(act(s, 'access', { a }).ok && s.access === a, 'доступ: ' + a);
  ok(act(s, 'access', { a: 'everyone' }).reason === 'args', 'чужое значение доступа — отказ');
  for (const g of [{ k: 'wall', x: 12, z: 0, r: 0 }, { k: 'wall', x: -1, z: 0, r: 0 }, { k: 'wall', x: 1.5, z: 0, r: 0 }, { k: 'wall', x: 1, z: 0, r: 4 }, { x: 1, z: 0, r: 0 }, { k: 'wall', x: '1', z: 0, r: 0 }])
    ok(act(s, 'place', g).reason === 'args', 'плохие аргументы: ' + JSON.stringify(g));
  ok(act(s, 'place', { k: 'castle', x: 1, z: 1, r: 0 }).reason === 'kind', 'нет такой постройки');
  ok(act(s, 'dance', {}).reason === 'args', 'нет такого хода');
  ok(act(s, 'upgrade', {}).reason === 'args' && act(s, 'collect', { id: 'x' }).reason === 'args', 'id — число');
  ok(act(s, 'finish', { id: house.i }).reason === 'coins' && act(s, 'finish', { id: find(s, 'mine').i }).reason === 'idle', 'ускорить: монеты / нечего');
  const w = { coins: 10 }, left = house.ue - T0;
  r = act(s, 'finish', { id: house.i }, T0, w);
  ok(r.ok && r.coins === Math.ceil(left / 120) && house.l === 2 && house.ue == null, 'ускорил дом за ' + r.coins + ' 🪙');
  ok(RU.speedCost({ ue: T0 + 1 }, T0) === 1 && RU.speedCost({ ue: T0 + 121 }, T0) === 2 && RU.speedCost({ ue: T0 + 28800 }, T0) === 240, 'цена ускорения: 1 🪙 за 2 мин');
}

// ═══ Сохранение (localStorage) ═══
{
  const s = fresh(); act(s, 'place', { k: 'store', x: 1, z: 1, r: 0 });
  const back = RU.sanitize(JSON.parse(JSON.stringify(s)));
  ok(JSON.stringify(back.layout) === JSON.stringify(s.layout) && JSON.stringify(back.room) === JSON.stringify(s.room) && back.seq === s.seq && back.bricks === s.bricks, 'JSON туда-обратно');
  ok(RU.sanitize(null) === null && RU.sanitize({ layout: 5 }) === null && RU.sanitize({ layout: [{ i: 1, k: 'mine', x: 0, z: 0, l: 1 }] }) === null, 'мусор и участок без ратуши/дома — отбрасываются');
  const dirty = RU.sanitize({ plot: 3, bricks: -5, access: 'evil', layout: [...s.layout, { i: 99, k: 'nuke', x: 0, z: 0, l: 1 }, { i: 98, k: 'wall', x: 1, z: 1, l: 9, r: 7, hack: 1 }], room: [{ i: 50, k: 'bed', x: 0, z: 0 }, { i: 51, k: 'tank', x: 1, z: 1 }], own: { tree: 2, 'f:bed': 1, bad: 5, 'f:zzz': 3 } });
  ok(dirty.layout.length === s.layout.length + 1 && dirty.layout.at(-1).l === 5 && dirty.layout.at(-1).r === 3 && !('hack' in dirty.layout.at(-1)), 'лишнее и неизвестное — убрано, уровень обрезан');
  ok(dirty.bricks === 0 && dirty.access === 'all' && dirty.room.length === 1 && dirty.own.tree === 2 && !('bad' in dirty.own) && !('f:zzz' in dirty.own) && dirty.seq === 98, 'кирпичи, доступ, мебель, запас, номер');
}

// ═══ Район на карте ═══
{
  const { LOTS, LANE, HALF, CELL } = Geo;
  const rect = (lot, m = 0) => { const pts = [[-HALF - m, -HALF - m], [HALF + m, -HALF - m], [-HALF - m, HALF + m], [HALF + m, HALF + m]].map(([x, z]) => Geo.lotToWorld(lot, x, z)); return { x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])), z0: Math.min(...pts.map(p => p[1])), z1: Math.max(...pts.map(p => p[1])) }; };
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
  const busy = { кафе: { x0: -11.5, x1: 11.5, z0: -43.5, z1: -28.5 }, сцена: { x0: -46, x1: -21, z0: -10, z1: 8 }, гардероб: { x0: -27, x1: -17, z0: 19, z1: 29 }, улица: { x0: -13, x1: 13, z0: 15, z1: 80 } };
  LOTS.forEach((lot, j) => {
    const r = rect(lot);
    ok(r.x0 > -84 && r.x1 < 84 && r.z0 > -72 && r.z1 < 92, `участок ${j}: внутри мира`);
    ok(Geo.zone(r.x0 + .1, r.z0 + .1) && Geo.zone(r.x1 - .1, r.z1 - .1), `участок ${j}: в зоне без деревьев`);
    ok(Math.hypot(lot.x, lot.z) - HALF * 1.42 > 18.4, `участок ${j}: не на площади`);
    for (const [n, b] of Object.entries(busy)) ok(!hit(rect(lot, .3), b), `участок ${j} не задевает: ${n}`);
    LOTS.forEach((o, k) => { if (k > j) ok(!hit(rect(lot, .5), rect(o, .5)), `участки ${j} и ${k} не пересекаются`); });
    // перед участка — на улице
    const [fx, fz] = Geo.lotToWorld(lot, 0, HALF + .5);
    ok(Math.abs(fz - LANE.z) < LANE.w / 2 + .1 && fx > LANE.x0 && fx < LANE.x1, `участок ${j}: перед выходит на улицу`, [fx, fz]);
    // туда-обратно
    for (const [x, z] of [[0, 0], [3.3, -7.1], [-9.6, 9.6]]) { const [wx, wz] = Geo.lotToWorld(lot, x, z), [bx, bz] = Geo.worldToLot(lot, wx, wz); ok(Math.abs(bx - x) < 1e-9 && Math.abs(bz - z) < 1e-9, `участок ${j}: мир ↔ участок`); }
  });
  ok(!hit({ x0: LANE.x0, x1: LANE.x1, z0: LANE.z - LANE.w / 2, z1: LANE.z + LANE.w / 2 }, busy.кафе) || LANE.x1 <= -11, 'улица упирается в кафе сбоку');
  ok(Geo.streetOf(1) === 0 && Geo.streetOf(6) === 0 && Geo.streetOf(7) === 1 && Geo.lotOf(7) === 0 && Geo.lotOf(600) === 5 && Geo.streetOf(600) === 99, 'номер участка → улица и место');
  // поворот на 90°: четыре раза — на месте; клетка ↔ центр постройки
  let p = [1.25, -.5]; for (let i = 0; i < 4; i++) p = Geo.rotXZ(1, ...p);
  ok(Math.abs(p[0] - 1.25) < 1e-12 && Math.abs(p[1] + .5) < 1e-12, 'четыре поворота — исходная точка');
  for (const k of Object.keys(DEFS)) for (let r = 0; r < 4; r++) {
    const [w, d] = RU.fp(k, r), it = { k, r, x: 2, z: 3 }, [cx, cz] = Geo.itemCenter(it), [x, z] = Geo.cellAt(cx, cz, w, d);
    ok(x === 2 && z === 3, `${k} r${r}: клетка ↔ центр`);
  }
  for (const k of Object.keys(FURN)) { const [w, d] = RU.ffp(k, 1), [cx, cz] = Geo.furnCenter({ k, r: 1, x: 1, z: 2 }), [x, z] = Geo.icellAt(cx, cz, w, d); ok(x === 1 && z === 2, `мебель ${k}: клетка ↔ центр`); }
  ok(Geo.zone(-40, -40) && !Geo.zone(0, 0) && !Geo.zone(-40, 0) && !Geo.zone(-40, -70), 'зона района');
  ok(Geo.inDistrict(-46.8, -28.4) && !Geo.inDistrict(-12.5, -30), 'район: участки — да, дорожка от площади — нет');
  ok(CELL * 12 === Geo.LOT, 'участок 12 клеток');
}

// ═══ Случайная стройка: правила держатся после каждого хода ═══
{
  const rnd = (() => { let a = 12345; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const pick = a => a[Math.floor(rnd() * a.length)];
  let bad = 0, okN = 0, now = T0;
  for (let run = 0; run < 30; run++) {
    const s = fresh(now), w = { coins: 500 };
    for (let step = 0; step < 300; step++) {
      now += Math.floor(rnd() * rnd() * 4000);
      const a = pick(['place', 'place', 'place', 'upgrade', 'upgrade', 'collect', 'move', 'remove', 'gift', 'fplace', 'fmove', 'fremove', 'finish', 'access']);
      const L = s.layout, id = L.length ? pick(L).i : 1, rid = s.room.length ? pick(s.room).i : 1;
      const g = a === 'place' ? { k: pick(Object.keys(DEFS)), x: Math.floor(rnd() * 12), z: Math.floor(rnd() * 12), r: Math.floor(rnd() * 4) }
        : a === 'fplace' ? { k: pick(Object.keys(FURN)), x: Math.floor(rnd() * 9), z: Math.floor(rnd() * 9), r: Math.floor(rnd() * 4) }
        : a === 'move' ? { id, x: Math.floor(rnd() * 12), z: Math.floor(rnd() * 12), r: Math.floor(rnd() * 4) }
        : a === 'fmove' ? { id: rid, x: Math.floor(rnd() * 9), z: Math.floor(rnd() * 9), r: Math.floor(rnd() * 4) }
        : a === 'fremove' ? { id: rid } : a === 'access' ? { a: pick(['all', 'friends', 'nobody']) } : a === 'collect' ? (rnd() < .5 ? {} : { id }) : { id };
      if (rnd() < .3) s.bricks = Math.min(RU.cap(s), s.bricks + Math.floor(rnd() * 3000));   // как будто долго копил
      const before = JSON.stringify(s), res = RU.act(s, a, g, now, w);
      if (res.ok) okN++;
      else if (JSON.stringify(RU.norm(JSON.parse(before), now)) !== JSON.stringify(s)) { bad++; console.log('отказ изменил участок', a, g, res); }
      // правила
      const t = RU.th(s);
      for (const it of s.layout) {
        const [w2, d2] = RU.fp(it.k, it.r);
        if (!RU.fits(s.layout, it.x, it.z, w2, d2, it.i)) { bad++; console.log('пересечение', it); }
        if (it.k !== 'th' && it.l > t) { bad++; console.log('уровень выше ратуши', it, t); }
        if (it.ul && it.k !== 'th' && it.ul > t && it.ue > now) { bad++; console.log('строится выше ратуши', it); }
      }
      for (const k of Object.keys(DEFS)) if (!RU.isDeco(k) && RU.count(s.layout, k) > RU.limit(k, t)) { bad++; console.log('лимит', k); }
      if (RU.count(s.layout, 'deco') > RU.limit('tree', t)) { bad++; console.log('лимит украшений'); }
      if (RU.busy(s, now) > RU.builders(s)) { bad++; console.log('строителей меньше, чем строек'); }
      if (s.bricks < 0 || w.coins < 0) { bad++; console.log('ушли в минус'); }
      for (const it of s.room) { const [w2, d2] = RU.ffp(it.k, it.r); if (!RU.ffits(s.room, it.k, it.x, it.z, w2, d2, it.i)) { bad++; console.log('мебель пересекается', it); } }
      if (s.room.length > DEFS.house.furn[RU.houseLv(s) - 1]) { bad++; console.log('мебели больше лимита'); }
      for (const k of Object.keys(FURN)) if (s.room.filter(e => e.k === k).length > (s.own['f:' + k] || 0)) { bad++; console.log('мебель без покупки', k); }
      for (const k of Object.keys(DEFS)) if (RU.isDeco(k) && RU.count(s.layout, k) > (s.own[k] || 0)) { bad++; console.log('украшение без покупки', k); }
      if (new Set([...s.layout, ...s.room].map(it => it.i)).size !== s.layout.length + s.room.length || Math.max(...s.layout.map(it => it.i), ...s.room.map(it => it.i)) > s.seq) { bad++; console.log('номера'); }
      if (bad > 5) break;
    }
  }
  ok(bad === 0, `9000 случайных ходов: правила не нарушены (успешных ${okN})`);
}

// ═══ Темп (для баланса): игрок заходит 2 раза в день и строит самое дешёвое полезное ═══
{
  let s = fresh(T0), now = T0, day = 0;
  const log = [];
  for (; day < 40 && RU.th(s) < 5; day++) {
    for (const h of [9, 20]) {
      now = T0 + day * 86400 + h * 3600;
      RU.act(s, 'gift', {}, now); RU.act(s, 'collect', {}, now);
      for (let k = 0; k < 6; k++) {
        const th = s.layout.find(it => it.k === 'th');
        if (RU.act(s, 'upgrade', { id: th.i }, now).ok) continue;
        if (RU.act(s, 'place', { k: 'store', x: (k * 2) % 12, z: 10, r: 0 }, now).ok) continue;
        if (RU.act(s, 'place', { k: 'mine', x: (k * 2) % 12, z: 0, r: 0 }, now).ok) continue;
        if (RU.act(s, 'place', { k: 'shop', x: 10, z: 4, r: 0 }, now).ok) continue;
        const up = s.layout.filter(it => ['mine', 'store'].includes(it.k)).sort((a, b) => a.l - b.l)[0];
        if (up && RU.act(s, 'upgrade', { id: up.i }, now).ok) continue;
      }
    }
    if (!log.length || log.at(-1)[1] !== RU.th(s)) log.push([day + 1, RU.th(s)]);
  }
  console.log('   темп: ратуша по дням —', log.map(([d, t]) => `${t} ур. на ${d}-й день`).join(', '));
  ok(log.find(([, t]) => t >= 3)?.[0] <= 7, 'ратуша 3 — за первую неделю (2 захода в день)');
  ok(!log.find(([, t]) => t >= 5) || log.find(([, t]) => t >= 5)[0] >= 10, 'ратуша 5 — не раньше 10-го дня (есть куда расти)');
}

console.log(`${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);
