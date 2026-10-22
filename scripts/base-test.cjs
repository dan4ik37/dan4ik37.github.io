// Тесты «Района участков» (мирный: дом, мебель, шахты) и ВОЕННЫХ БАЗ боевой зоны (js/games/mir-base.js) в node: каталоги,
// правила стройки (как base_act / war_act в bases.sql), добыча, подарок дня, мебель, казарма и армия, техника, пожертвования,
// проверка сохранённого, геометрия района и участков баз на карте (js/games/mir-war.js PLOTS), отрисовка построек, случайные ходы
// с проверкой правил после каждого. Запуск из корня сайта: node scripts/base-test.cjs
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

// ═══ Район мирный (владелец 15.10, п. 31): ни обороны, ни казармы, ни армии — всё это у военных баз ═══
{
  ok(!['barracks', 'cannon', 'mortar', 'bomb', 'airmine'].some(k => DEFS[k]) && Object.values(DEFS).every(D => !D.hp && !D.atk && !D.trap && !D.army), 'в районе нет обороны, ловушек и казармы');
  ok(DEFS.tower.lv === 3 && !DEFS.tower.atk && DEFS.tower.max[0] === 0 && DEFS.tower.max[2] >= 1, 'вышка района — смотровая (с ратуши 3, не стреляет)');
  const s = fresh();
  for (const a of ['train', 'untrain', 'tfinish', 'unarm', 'vbuy', 'vsell', 'give']) ok(act(s, a, { u: 'fighter', n: 1, v: 'jeep' }).reason === 'args', `в районе нет хода «${a}»`);
  ok(!('army' in s) && !('queue' in s) && !('veh' in s) && !('q2' in s), 'у участка района нет армии, очереди и техники');
  const S = MB.SERVER;
  ok(!S.u && !S.raid && !S.hero && !S.k.cannon && !('hp' in S.k.th) && !('army' in S.k.tower), 'base_defs — только мирный каталог (набеги — war_defs)');
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

// ═══ Отрисовка: каждая постройка каждого уровня собирается из деталей без ошибок, числа конечные, тела годные ═══
{
  const { DRAW } = MB._draw;
  const V3 = () => ({ x: 0, y: 0, z: 0, set(x, y, z){ this.x = x; this.y = y; this.z = z; return this; } });
  class G { constructor(){ this.children = []; this.position = V3(); this.scale = V3(); this.rotation = V3(); this.userData = {}; } add(c){ this.children.push(c); } }
  const x0 = () => ({ T: { Group: G }, R: { prefab: () => new G(), mat: () => ({}), water: () => new G() }, glass: {}, tvMat: {}, boardMat: {} });
  const fin = v => v === undefined || (typeof v === 'number' && Number.isFinite(v));
  for (const [k, D] of Object.entries(DEFS)) {
    if (k === 'wall') continue;   // забор — drawWall (соседи)
    ok(typeof DRAW[k] === 'function', `${k}: есть отрисовка`);
    if (typeof DRAW[k] !== 'function') continue;
    for (let l = 1; l <= D.lv; l++) {
      const parts = [], bd = [], x = x0();
      let h, err = null;
      try { h = DRAW[k]((g, o) => { parts.push(o); return new G(); }, new G(), { i: 1, k, x: 2, z: 2, r: 0, l }, bd, x); } catch (e) { err = e.message; }
      ok(!err, `${k} ${l} ур.: рисуется`, err);
      ok(parts.every(o => ['x', 'y', 'z', 'w', 'h', 'd', 'r', 'yaw', 'rx', 'rz'].every(f => fin(o[f]))), `${k} ${l} ур.: размеры деталей — числа`);
      ok(parts.every(o => ['box', 'cyl', 'cone', 'ball', 'ico', 'torus', 'ring', 'disc', 'plane'].includes(o.s || 'box')), `${k} ${l} ур.: детали — те, что умеет движок (R.part)`, parts.map(o => o.s));
      ok(h === undefined || (Number.isFinite(h) && h > 0 && h < 20), `${k} ${l} ур.: высота`, h);
      ok(bd.every(b => (b.t === 'cyl' ? b.r > 0 : b.w > 0 && b.d > 0) && b.h > 0 && fin(b.y0) && fin(b.x) && fin(b.z)), `${k} ${l} ур.: тела`, bd);
    }
  }
  // вышка растёт с уровнем, у обороны есть тело (в неё не пройти насквозь), ловушки — без тел
  const hOf = (k, l) => DRAW[k]((g, o) => new G(), new G(), { i: 1, k, x: 2, z: 2, r: 0, l }, [], x0());
  ok([1, 2, 3, 4, 5].map(l => hOf('tower', l)).every((h, i, a) => i === 0 || h >= a[i - 1]), 'вышка выше с уровнем');
  for (const k of ['cannon', 'mortar', 'barracks']) { const bd = []; DRAW[k](() => new G(), new G(), { i: 1, k, x: 2, z: 2, r: 0, l: 1 }, bd, x0()); ok(bd.length > 0, `${k}: есть тело`); }
  for (const k of ['bomb', 'airmine']) { const bd = []; DRAW[k](() => new G(), new G(), { i: 1, k, x: 2, z: 2, r: 0, l: 1 }, bd, x0()); ok(bd.length === 0, `${k}: ловушка без тела`); }
}

globalThis.window = globalThis;
for (const f of ['js/engine/core.js', 'js/engine/physics.js', 'js/engine/interior.js', 'js/engine/worldmap.js', 'js/games/mir-zones.js', 'js/games/mir-war.js']) vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });

// ═══ Военная база: каталог (оборона, ловушки, казарма, техника, отряды, герой, набеги — docs/RAIDS.md) ═══
{
  const { WDEFS: W, UNITS, HERO, RAID, LEAGUES, SKINS, VEH, WAR, NAMES, COLORS } = MB, S = MB.WSERVER;
  const pos = a => Array.isArray(a) && a.every(v => typeof v === 'number' && v > 0);
  for (const [k, D] of Object.entries(W)) {
    ok(D.cost.length === D.lv && D.time.length === D.lv && nondec(D.cost) && nondec(D.time), `база ${k}: цена и время на каждый уровень, растут`);
    ok(Number.isInteger(D.w) && Number.isInteger(D.d) && D.w >= 1 && D.d >= 1 && D.w <= 4 && D.d <= 4 && typeof D.n === 'string' && D.e, `база ${k}: размер, название, значок`);
    if (D.g === 'deco') { ok(D.lv === 1 && D.time[0] === 0 && !D.hp && !D.atk && !D.trap, `база ${k}: украшение — без уровней, стройки и боя`); continue; }
    ok(Array.isArray(D.max) && D.max.length === 5 && nondec(D.max), `база ${k}: лимит по штабу`);
    if (D.trap) ok(!D.hp && pos(D.trap.dmg) && D.trap.dmg.length === D.lv && nondec(D.trap.dmg) && D.trap.trig > 0 && (D.trap.gnd ^ D.trap.air) === 1, `база ${k}: ловушка — урон по уровням, одна цель`);
    else ok(pos(D.hp) && D.hp.length === D.lv && nondec(D.hp), `база ${k}: прочность на каждый уровень и растёт (в набеге — цель)`);
    if (D.atk) ok(pos(D.atk.dmg) && D.atk.dmg.length === D.lv && nondec(D.atk.dmg) && D.atk.cd > 0 && D.atk.rng > D.atk.min && (D.atk.gnd || D.atk.air), `база ${k}: оборона — урон, перезарядка, дальность`);
    if (D.rate) ok(D.hold.every((h, i) => h === D.rate[i] * 8) && D.rate.length === D.lv, `база ${k}: производство вмещает 8 часов`);
    if (D.slots) ok(D.slots.length === D.lv && nondec(D.slots) && Object.values(VEH).some(V => V.b === k), `база ${k}: места техники по уровню, есть что поставить`);
  }
  ok(W.th.crew.length === 5 && nondec(W.th.crew) && W.th.crew[0] >= 4 && W.th.crew[4] <= 30, 'штаб: состав растёт с уровнем (4…30 человек)');
  ok(W.th.keep.length === 5 && W.store.keep.length === 5, 'вместимость казны на 5 уровней');
  for (let t = 2; t <= 5; t++) {
    const prev = t - 1, best = W.th.keep[prev - 1] + W.store.max[prev - 1] * W.store.keep[Math.min(W.store.lv, prev) - 1];
    ok(best >= W.th.cost[t - 1], `штаб ${t}: хватает места в казне (${best} ≥ ${W.th.cost[t - 1]})`);
  }
  ok(W.barracks.max[0] === 1 && W.barracks.max[2] === 2 && W.barracks.max.every(m => m <= 2), 'вторая казарма — постройка со штаба 3 (не покупка)');
  ok(!('q2' in RAID.shop), 'вторую казарму за 💎 не продаём (красная линия: сила за деньги — никогда)');
  ok(Object.keys(RAID.shop).every(k => ['sh1', 'sh2', 'shWeek', 'shMax', 'fin', 'skin', 'army'].includes(k)), 'за 💎 — только щиты, время и облики', Object.keys(RAID.shop));
  ok(W.tower.atk.air && W.tower.max[0] >= 1 && W.cannon.max[0] >= 1 && W.bomb.max[0] >= 1, 'вышка бьёт и летающих; пушка, вышка, бомба — с первого штаба');
  ok(W.barracks.army.length === 5 && nondec(W.barracks.army), 'казарма: место растёт с уровнем');
  const lvs = Object.values(UNITS).map(U => U.lv);
  ok(Object.keys(UNITS).length >= 4 && Object.keys(UNITS).length <= 6 && lvs.includes(1) && Math.max(...lvs) <= W.barracks.lv, '4–6 отрядов, первый — с казармы 1');
  for (const [u, U] of Object.entries(UNITS)) {
    ok([U.sp, U.cost, U.time, U.hp, U.spd, U.rng].every(v => typeof v === 'number' && v > 0) && Number.isInteger(U.sp) && Number.isInteger(U.cost) && Number.isInteger(U.time), `${u}: место, цена, время, жизни, скорость`);
    ok(['any', 'def', 'wall', 'heal'].includes(U.tgt) && (U.tgt === 'heal' ? U.heal > 0 && U.hr > 0 : U.dmg > 0) && U.n && U.e, `${u}: цель и урон/лечение`);
    ok(U.sp <= W.barracks.army[U.lv - 1], `${u}: влезает в казарму своего уровня`);
  }
  for (const [v, V] of Object.entries(VEH)) ok(W[V.b]?.slots && V.lv >= 1 && V.lv <= W[V.b].lv && V.cost > 0 && Number.isInteger(V.cost), `техника ${v}: стоит в «${W[V.b]?.n}», с ${V.lv} ур., цена в 🧱`);
  ok(HERO.hp.length === 5 && nondec(HERO.hp) && nondec(HERO.ab), 'герой: по уровню штаба');
  ok(RAID.tps === 20 && RAID.max === 180 && RAID.loot.prot.length === 5 && RAID.league.length === LEAGUES.length && RAID.bonus.length === LEAGUES.length && RAID.chest.length === LEAGUES.length, 'правила набегов: таблицы по штабу и лигам');
  ok(RAID.camp.length === RAID.campTh.length && RAID.campTh.every((t, i) => t >= 1 && t <= 5 && (!i || t >= RAID.campTh[i - 1])), 'поход: штабы лагерей не убывают');
  ok(Object.keys(RAID.shop.skin).every(k => SKINS[k]) && Object.values(RAID.shop.skin).every(p => (p.g > 0) !== (p.c > 0)) && Object.values(RAID.shop.skin).some(p => p.c > 0), 'облики: есть в SKINS, одна цена; есть и за монеты');
  ok(MB.league(0) === 0 && MB.league(100) === 1 && MB.league(99999) === 6, 'лига по кубкам');
  ok(WAR.n === 32 && WAR.ring.length === 5 && WAR.ring[4] === WAR.n && nondec(WAR.ring) && WAR.ring.every(s => (WAR.n - s) % 2 === 0), 'сетка 32, открытая часть 16 → 32 (ровно в середине)');
  ok(WAR.block.every(([x, z, w, d]) => x >= 0 && z >= 0 && x + w <= WAR.n && z + d <= WAR.n), 'занятые клетки — внутри участка');
  ok(NAMES.length === S.names && COLORS.length === S.colors && NAMES.length >= 8 && new Set(NAMES).size === NAMES.length && NAMES.every(n => /^[А-ЯЁ][а-яё]+ [а-яё]+$/.test(n)), 'имена баз — готовые, разные, без цифр и латиницы');
  ok(MB.baseName(3, 7) === NAMES[3] + ' 7', 'имя базы: готовое + номер');
  ok(S.k && S.u && S.hero && S.raid && S.veh && !('n' in S.k.th) && !('info' in S.u.fighter) && S.k.cannon.atk.dmg.length === 5 && S.k.th.crew, 'war_defs: каталог без подписей');
  // ядро штаба 5 + ловушки + стены влезают в 32×32 (за вычетом занятых клеток)
  const core = Object.entries(W).filter(([k, D]) => D.g !== 'deco' && !D.trap && k !== 'wall').reduce((a, [, D]) => a + D.w * D.d * D.max[4], 0);
  const free = 32 * 32 - WAR.block.reduce((a, b) => a + b[2] * b[3], 0);
  ok(core + W.bomb.max[4] + W.airmine.max[4] + W.wall.max[4] <= free * .75, `штаб 5: всё по максимуму занимает ≤ 75 % участка (${core} + ловушки + стены из ${free})`);
}

// ═══ Военная база: правила (открытая часть по штабу, занятые клетки, строители, производство, казна) ═══
{
  const WR = MB.WRules, W = MB.WDEFS, now = T0;
  const s = WR.fresh(1, now), wact = (g, a, t = now, w) => WR.act(s, a, g, t, w);
  ok(WR.boxOf(s)[0] === 8 && WR.boxOf(s)[1] === 24 && s.bricks === MB.WAR.start && WR.cap(s) === W.th.keep[0] && WR.builders(s) === 1, 'новая база: штаб 1, открыто 16×16 (клетки 8…23), казна и строитель');
  ok(s.layout.every(it => WR.fits(s.layout, it.x, it.z, ...WR.fp(it.k, it.r), it.i)), 'новая база: ничего не пересекается, всё в открытой части');
  ok(wact({ k: 'cannon', x: 6, z: 10, r: 0 }, 'place').reason === 'place' && wact({ k: 'cannon', x: 23, z: 10, r: 0 }, 'place').reason === 'place', 'за открытой частью — нельзя');
  ok(wact({ k: 'cannon', x: 22, z: 10, r: 0 }, 'place').ok, 'у края открытой части — можно');
  ok(wact({ k: 'th', x: 0, z: 0, r: 0 }, 'place').reason === 'kind' && wact({ k: 'house', x: 9, z: 9, r: 0 }, 'place').reason === 'kind', 'второго штаба и дома нет');
  ok(wact({ k: 'factory', x: 9, z: 9, r: 0 }, 'place').reason === 'th' && wact({ k: 'hangar', x: 9, z: 9, r: 0 }, 'place').reason === 'th', 'завод и ангар — со штаба выше');
  // штаб 5: весь участок, кроме КП зоны и проезда к воротам
  const s5 = WR.fresh(2, now); s5.layout[0].l = 5; s5.bricks = 1e6;
  ok(WR.boxOf(s5)[0] === 0 && WR.boxOf(s5)[1] === 32, 'штаб 5: открыт весь участок');
  ok(WR.act(WR.clone(s5), 'place', { k: 'wall', x: 8, z: 28, r: 0 }, now).reason === 'place' && WR.act(WR.clone(s5), 'place', { k: 'wall', x: 15, z: 30, r: 0 }, now).reason === 'place', 'на КП зоны и на проезде к воротам — нельзя');
  ok(WR.act(WR.clone(s5), 'place', { k: 'wall', x: 12, z: 29, r: 0 }, now).ok && WR.act(WR.clone(s5), 'place', { k: 'wall', x: 0, z: 0, r: 0 }, now).ok, 'рядом и в углу — можно');
  // мастерские: каждая — плюс строитель
  const sb = WR.fresh(3, now); sb.layout[0].l = 4; sb.bricks = 1e6;
  for (const x of [8, 11]) { WR.act(sb, 'place', { k: 'shop', x, z: 2, r: 0 }, now); WR.norm(sb, now + 1000); }
  ok(WR.builders(sb) === 3, 'две мастерские — три строителя (у района — максимум два)');
  // производство: карьер и завод копят, сбор — в казну
  const sp = WR.fresh(4, now); sp.layout[0].l = 2; sp.bricks = W.factory.cost[0];
  ok(WR.act(sp, 'place', { k: 'factory', x: 18, z: 18, r: 0 }, now).ok && sp.bricks === 0, 'завод поставлен'); WR.norm(sp, now + 600);
  const fac = sp.layout.find(it => it.k === 'factory');
  ok(fac.l === 1 && fac.t0 === now + 600 && WR.prod(fac, now + 600 + 3600) === W.factory.rate[0], 'завод: копит с конца стройки, ' + W.factory.rate[0] + '/ч');
  const r1 = WR.act(sp, 'collect', {}, now + 600 + 3600);
  ok(r1.ok && r1.got === W.factory.rate[0] + Math.floor(W.mine.rate[0] * (4200) / 3600), 'сбор: карьер и завод — в казну', r1);
  // подарок дня — в казну
  ok(WR.act(sp, 'gift', {}, now + 5000).ok && WR.act(sp, 'gift', {}, now + 5001).reason === 'done', 'подарок дня базы — раз в день');
  // мебели и доступа у базы нет
  ok(WR.act(sp, 'fplace', { k: 'bed', x: 0, z: 0, r: 0 }, now).reason === 'args' && WR.act(sp, 'access', { a: 'all' }, now).reason === 'args', 'у базы нет мебели и доступа к дому');
  // сохранение: туда-обратно, мусор отброшен
  const back = WR.sanitize(JSON.parse(JSON.stringify({ ...sp, veh: { jeep: 2, ufo: 1 }, army: { fighter: 3, nuke: 2 } })));
  ok(JSON.stringify(back.layout) === JSON.stringify(sp.layout) && back.veh.jeep === 2 && !('ufo' in back.veh) && back.army.fighter === 3 && !('nuke' in back.army), 'база: туда-обратно, мусор отброшен');
  ok(WR.sanitize({ layout: [{ i: 1, k: 'mine', x: 0, z: 0, l: 1 }] }) === null, 'база без штаба — отброшена');
}

// ═══ Казарма базы: тренировка по времени, очередь, место, ускорение, распуск, вторая казарма ═══
{
  const { UNITS, WDEFS: D } = MB, WR = MB.WRules;
  const s = WR.fresh(1, T0);
  const act2 = (a, g, now = T0, w) => WR.act(s, a, g, now, w);
  ok(act2('train', { u: 'fighter', n: 1 }).reason === 'barracks', 'нет казармы — не тренировать');
  let r = act2('place', { k: 'barracks', x: 18, z: 10, r: 0 });
  ok(r.ok && s.bricks === MB.WAR.start - D.barracks.cost[0], 'казарма поставлена', r);
  ok(act2('train', { u: 'fighter', n: 1 }).reason === 'barracks', 'казарма строится — пока нельзя');
  WR.norm(s, T0 + 60);
  const t1 = T0 + 60, cap1 = D.barracks.army[0];
  ok(WR.barracksLv(s) === 1 && WR.armyCap(s) === cap1 && WR.armySpace(s) === 0, 'казарма 1: место ' + cap1);
  ok(act2('train', { u: 'tank', n: 1 }, t1).reason === 'ulock', 'силач — с казармы 2');
  ok(act2('train', { u: 'dragon', n: 1 }, t1).reason === 'kind' && act2('train', { u: 'fighter', n: 0 }, t1).reason === 'args' && act2('train', { u: 'fighter', n: 31 }, t1).reason === 'args', 'плохие аргументы');
  const b0 = s.bricks;
  r = act2('train', { u: 'fighter', n: 3 }, t1);
  const Tf = UNITS.fighter.time;
  ok(r.ok && s.bricks === b0 - 3 * UNITS.fighter.cost && s.queue.map(q => q.ue).join() === [t1 + Tf, t1 + 2 * Tf, t1 + 3 * Tf].join(), 'трое бойцов: по очереди', s.queue);
  r = act2('train', { u: 'archer' }, t1 + 5);
  ok(r.ok && s.queue.at(-1).ue === t1 + 3 * Tf + UNITS.archer.time, 'n не указано — один; в конец очереди');
  WR.norm(s, t1 + Tf);
  ok(s.army.fighter === 1 && s.queue.length === 3, 'первый готов — в армии');
  const b1 = s.bricks;
  r = act2('untrain', { u: 'fighter' }, t1 + Tf);
  ok(r.ok && s.bricks === b1 + UNITS.fighter.cost && s.queue.length === 2 && s.queue[1].u === 'archer' && s.queue[1].ue === t1 + 2 * Tf + UNITS.archer.time, 'убрал бойца — лучник раньше', s.queue);
  s.bricks = 1000;
  const used = WR.armySpace(s);
  ok(act2('train', { u: 'fighter', n: cap1 - used + 1 }, t1 + Tf).reason === 'space' && act2('train', { u: 'fighter', n: cap1 - used }, t1 + Tf).ok && WR.armySpace(s) === cap1, 'места ровно ' + cap1);
  const s2 = WR.clone(s); s2.out = { fighter: 1 }; s2.queue.pop();
  ok(WR.act(s2, 'train', { u: 'fighter', n: 1 }, t1 + Tf).reason === 'space', 'армия в набеге занимает место');
  const left = s.queue.at(-1).ue - (t1 + Tf), need = Math.max(1, Math.ceil(left / 120));
  ok(act2('tfinish', {}, t1 + Tf).reason === 'coins', 'без монет — нет');
  const w = { coins: need };
  r = act2('tfinish', {}, t1 + Tf, w);
  ok(r.ok && r.coins === need && w.coins === 0 && !s.queue.length && WR.spaceOf(s.army) === cap1, `дотренировал всех за ${need} 🪙`);
  ok(act2('unarm', { u: 'archer', n: 2 }).reason === 'noarmy' && act2('unarm', { u: 'archer', n: 1 }).ok && !('archer' in s.army), 'распустил лучника');
  // вторая казарма (штаб 3) — вдвое быстрее (округление вверх)
  const s3 = WR.fresh(5, T0); s3.layout[0].l = 3; s3.bricks = 1e5;
  WR.act(s3, 'place', { k: 'barracks', x: 8, z: 8, r: 0 }, T0); WR.norm(s3, T0 + 60);
  WR.act(s3, 'train', { u: 'archer', n: 1 }, T0 + 60);
  ok(s3.queue[0].t === UNITS.archer.time, 'одна казарма — обычная скорость');
  WR.act(s3, 'place', { k: 'barracks', x: 11, z: 8, r: 0 }, T0 + 60); WR.norm(s3, T0 + 200);
  ok(WR.barracksN(s3) === 2, 'две готовые казармы');
  WR.act(s3, 'train', { u: 'archer', n: 2 }, T0 + 200);
  ok(s3.queue.at(-1).t === Math.ceil(UNITS.archer.time / 2), 'вторая казарма: вдвое быстрее — без 💎');
  ok(WR.act(WR.clone(s3), 'place', { k: 'barracks', x: 14, z: 18, r: 0 }, T0 + 200).reason === 'max', 'третьей казармы нет');
}

// ═══ Военная база: техника и пожертвования из района ═══
{
  const WR = MB.WRules, W = MB.WDEFS, V = MB.VEH;
  const s = WR.fresh(1, T0); s.layout[0].l = 3; s.bricks = 30000;
  ok(WR.act(s, 'vbuy', { v: 'jeep' }, T0).reason === 'vlock', 'без гаража — нельзя');
  WR.act(s, 'place', { k: 'garage', x: 8, z: 8, r: 0 }, T0); WR.norm(s, T0 + 100);
  let r = WR.act(s, 'vbuy', { v: 'jeep' }, T0 + 100);
  ok(r.ok && s.veh.jeep === 1 && s.bricks === 30000 - W.garage.cost[0] - V.jeep.cost, 'джип в гараж');
  ok(WR.act(s, 'vbuy', { v: 'jeep' }, T0 + 100).reason === 'vfull' && WR.act(s, 'vbuy', { v: 'tank' }, T0 + 100).reason === 'vlock', 'гараж 1: одно место, танк — с 3-го');
  ok(WR.act(s, 'vbuy', { v: 'ufo' }, T0 + 100).reason === 'args' && WR.act(s, 'vsell', { v: 'tank' }, T0 + 100).reason === 'noveh', 'нет такой / нечего списать');
  ok(WR.act(s, 'vsell', { v: 'jeep' }, T0 + 100).ok && !s.veh.jeep, 'списал джип');
  const g = s.layout.find(it => it.k === 'garage'); g.l = 3;
  ok(WR.slotsOf(s, 'garage') === 3 && WR.act(s, 'vbuy', { v: 'tank' }, T0 + 100).ok, 'гараж 3: три места, танк можно');
  // кирпичи из района
  const d = { bricks: 700, left: MB.WAR.give };
  ok(WR.act(s, 'give', { n: 100 }, T0).reason === 'nodonor', 'без участка в районе — нечего дарить');
  const b = s.bricks; s.bricks = WR.cap(s) - 600;
  ok(WR.act(s, 'give', { n: 800 }, T0, undefined, d).reason === 'bricks', 'больше, чем есть в районе — нельзя');
  ok(WR.act(s, 'give', { n: 650 }, T0, undefined, d).reason === 'full', 'больше, чем влезет в казну — нельзя');
  r = WR.act(s, 'give', { n: 500 }, T0, undefined, d);
  ok(r.ok && r.got === 500 && d.bricks === 200 && d.left === MB.WAR.give - 500 && s.bricks === WR.cap(s) - 100, 'подарил 500: из района — в казну');
  ok(WR.act(s, 'give', { n: 600 }, T0, undefined, { bricks: 9999, left: 100 }).reason === 'givemax', 'дневной лимит');
  void b;
}

// ═══ Военная база: случайные ходы — правила держатся ═══
{
  const WR = MB.WRules, W = MB.WDEFS, { UNITS } = MB;
  let a0 = 9090; const rnd = () => { a0 = (a0 + 0x6D2B79F5) >>> 0; let t = a0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  let bad = 0, oks = 0, now = T0;
  for (let run = 0; run < 20; run++) {
    const s = WR.fresh(run + 1, now), w = { coins: 400 };
    for (let step = 0; step < 300; step++) {
      now += Math.floor(rnd() * rnd() * 3000);
      if (rnd() < .25) s.bricks = Math.min(WR.cap(s), s.bricks + Math.floor(rnd() * 6000));
      if (rnd() < .03) { WR.norm(s, now); const th = s.layout.find(it => it.k === 'th'); if (th.l < 5 && th.ue == null) th.l++; }
      if (rnd() < .04) s.out = rnd() < .5 ? {} : { fighter: 1 + Math.floor(rnd() * 3) };
      const a = pick(['place', 'place', 'place', 'upgrade', 'upgrade', 'collect', 'move', 'remove', 'gift', 'finish', 'train', 'train', 'untrain', 'tfinish', 'unarm', 'vbuy', 'vsell']);
      const L = s.layout, id = L.length ? pick(L).i : 1, [lo, hi] = WR.boxOf(s), cell = () => lo - 2 + Math.floor(rnd() * (hi - lo + 4));
      const g = a === 'place' ? { k: pick(Object.keys(W)), x: cell(), z: cell(), r: Math.floor(rnd() * 4) } : a === 'move' ? { id, x: cell(), z: cell(), r: Math.floor(rnd() * 4) }
        : a === 'train' ? { u: pick(Object.keys(UNITS)), n: 1 + Math.floor(rnd() * 6) } : a === 'untrain' ? (rnd() < .5 ? {} : { u: pick(Object.keys(UNITS)) })
        : a === 'unarm' ? { u: pick(Object.keys(UNITS)), n: 1 } : a === 'vbuy' || a === 'vsell' ? { v: pick(Object.keys(MB.VEH)) } : a === 'collect' ? (rnd() < .5 ? {} : { id }) : { id };
      const before = JSON.stringify(s), res = WR.act(s, a, g, now, w);
      if (res.ok) oks++;
      else if (JSON.stringify(WR.norm(JSON.parse(before), now)) !== JSON.stringify(s)) { bad++; console.log('отказ изменил базу', a, g, res); }
      const t = WR.th(s), [b0, b1] = WR.boxOf(s);
      for (const it of s.layout) {
        const [w2, d2] = WR.fp(it.k, it.r);
        if (!WR.fits(s.layout, it.x, it.z, w2, d2, it.i)) { bad++; console.log('пересечение или за краем', it, [b0, b1]); }
        if (it.k !== 'th' && it.l > t) { bad++; console.log('уровень выше штаба', it, t); }
      }
      for (const k of Object.keys(W)) if (!WR.isDeco(k) && WR.count(s.layout, k) > WR.limit(k, t)) { bad++; console.log('лимит', k); }
      if (WR.busy(s, now) > WR.builders(s)) { bad++; console.log('строителей меньше, чем строек'); }
      if (s.bricks < 0 || w.coins < 0) { bad++; console.log('минус'); }
      for (const b of ['garage', 'helipad', 'hangar', 'dock']) if (WR.vehIn(s, b) > WR.slotsOf(s, b)) { bad++; console.log('техники больше мест', b, s.veh); }
      if (res.ok && a === 'train' && WR.armySpace(s) > WR.armyCap(s)) { bad++; console.log('армии больше места'); }
      for (let i = 1; i < s.queue.length; i++) if (s.queue[i].ue < s.queue[i - 1].ue + s.queue[i].t) { bad++; console.log('очередь не по порядку'); break; }
      if (s.queue.length && s.queue[0].ue <= now) { bad++; console.log('готовый остался в очереди'); }
      if (Object.values(s.army).some(n => !(n > 0)) || Object.values(s.veh).some(n => !(n > 0))) { bad++; console.log('ноль в армии или технике', s.army, s.veh); }
      if (new Set(s.layout.map(it => it.i)).size !== s.layout.length || Math.max(...s.layout.map(it => it.i)) > s.seq) { bad++; console.log('номера'); }
      if (bad > 5) break;
    }
  }
  ok(bad === 0 && oks > 1500, `6000 случайных ходов базы: правила не нарушены (успешных ${oks})`);
}

// ═══ Полная база (замеры и проверки): fillLayout — всё по правилам ═══
{
  const WR = MB.WRules;
  for (let t = 1; t <= 5; t++) {
    const L = MB.fillLayout(t, t), s = { layout: L };
    ok(L.every(it => WR.fits(L, it.x, it.z, ...WR.fp(it.k, it.r), it.i)) && L.every(it => it.k === 'th' || it.l <= t), `полная база штаба ${t}: ${L.length} построек — без пересечений, в открытой части, уровни по штабу`);
    ok(Object.keys(MB.WDEFS).every(k => MB.WRules.isDeco(k) || WR.count(L, k) <= WR.limit(k, t)), `полная база штаба ${t}: лимиты`);
    void s;
  }
}

// ═══ Участки баз на карте (js/games/mir-war.js PLOTS): рамка участка, КП зоны и проезд — в занятых клетках, подвал под серединой ═══
{
  const MW = globalThis.MirWar, MZ = globalThis.MirZones, G = MB.GW, YAW = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };
  ok(MW && MW.PLOTS.length === MB.WAR.per, 'в секторе — столько участков, сколько на карте (12)');
  const inBlock = (x, z) => MB.WAR.block.some(([bx, bz, bw, bd]) => x >= bx && x <= bx + bw && z >= bz && z <= bz + bd);
  for (const P of MW.PLOTS) {
    const lot = { x: P.cx, z: P.cz, yaw: YAW[P.gate.side] }, cells = (wx, wz) => { const [lx, lz] = Geo.worldToLot(lot, wx, wz); return [(lx + G.HALF) / G.CELL, (lz + G.HALF) / G.CELL]; };
    ok(Math.abs(G.HALF * 2 - (P.x1 - P.x0)) < 1e-6 && P.cells === MB.WAR.n, `${P.id}: 32 × 32 клетки по 1,6`);
    const g = cells(P.gate.x, P.gate.z);
    ok(Math.abs(g[0] - 16) < 1e-6 && Math.abs(g[1] - 32) < 1e-6, `${P.id}: ворота — снизу посередине (рамка «+z — к воротам»)`, g);
    const c = P.cp, corners = [[c.x - c.w / 2, c.z - c.d / 2], [c.x + c.w / 2, c.z - c.d / 2], [c.x - c.w / 2, c.z + c.d / 2], [c.x + c.w / 2, c.z + c.d / 2]].map(([x, z]) => cells(x, z));
    ok(corners.every(([x, z]) => inBlock(x, z)), `${P.id}: командный пункт зоны — в занятых клетках`, corners);
    ok(inBlock(...cells(P.spawn.x, P.spawn.z)), `${P.id}: место появления у ворот — свободно от построек (занятые клетки)`);
    const C = P.cellar;
    ok(C && C.x1 - C.x0 >= 10 && C.z1 - C.z0 >= 10 && C.floor < -4 && C.top <= 0 && C.x0 > P.x0 + 4 && C.x1 < P.x1 - 4 && C.z0 > P.z0 + 4 && C.z1 < P.z1 - 4, `${P.id}: подвал — под серединой участка, ниже земли`);
    for (const [x, z] of [[0, 0], [5.5, -3.2], [-20, 17]]) { const [wx, wz] = Geo.lotToWorld(lot, x, z), [bx, bz] = Geo.worldToLot(lot, wx, wz); ok(Math.abs(bx - x) < 1e-9 && Math.abs(bz - z) < 1e-9, `${P.id}: мир ↔ участок`); }
  }
  ok(MZ.CELLAR && MZ.CELLAR.list.length === MW.PLOTS.length && !MZ.CELLAR.on, 'подвалы в рельефе зоны — выключены, пока не легли плиты');
  const C0 = MW.PLOTS[0].cellar, mx = (C0.x0 + C0.x1) / 2, mz = (C0.z0 + C0.z1) / 2, g0 = MZ.terrain(mx, mz), g1 = MZ.terrain(C0.x1 + 2, mz);
  ok(g0 > C0.floor + 3, 'пока зона не построена — над подвалом обычная земля (не провалиться)', g0);
  MZ.CELLAR.on = true;
  ok(MZ.terrain(mx, mz) === C0.floor && MZ.terrain(C0.x1 + 2, mz) === g1, 'плита легла — пол подвала ниже, вокруг — как было');
  MZ.CELLAR.on = false;
  ok(MZ.terrain(mx, mz) === g0, 'зону выгрузили — снова обычная земля');
}

// ═══ Отрисовка построек военной базы: каждая каждого уровня (свои — WDRAW, общие — DRAW), стены базы ═══
{
  const { DRAW, WDRAW, WALL_WST } = MB._draw;
  const V3 = () => ({ x: 0, y: 0, z: 0, set(x, y, z){ this.x = x; this.y = y; this.z = z; return this; } });
  class Gr { constructor(){ this.children = []; this.position = V3(); this.scale = V3(); this.rotation = V3(); this.userData = {}; } add(c){ this.children.push(c); } }
  const x0 = () => ({ T: { Group: Gr }, R: { prefab: () => new Gr(), mat: () => ({}), water: () => new Gr() }, war: true, color: '#22c55e', glass: {}, tvMat: {}, boardMat: {} });
  const fin = v => v === undefined || (typeof v === 'number' && Number.isFinite(v));
  for (const [k, D] of Object.entries(MB.WDEFS)) {
    if (k === 'wall') continue;
    const fn = WDRAW[k] || DRAW[k];
    ok(typeof fn === 'function', `база ${k}: есть отрисовка`);
    if (typeof fn !== 'function') continue;
    for (let l = 1; l <= D.lv; l++) {
      const parts = [], bd = [], x = x0();
      let h, err = null;
      try { h = fn((g, o) => { parts.push(o); return new Gr(); }, new Gr(), { i: 1, k, x: 2, z: 2, r: 0, l }, bd, x); } catch (e) { err = e.message; }
      ok(!err, `база ${k} ${l} ур.: рисуется`, err);
      ok(parts.every(o => ['x', 'y', 'z', 'w', 'h', 'd', 'r', 'r2', 'sy', 'yaw', 'rx', 'rz'].every(f => fin(o[f]))) && parts.every(o => ['box', 'cyl', 'cone', 'ball', 'ico'].includes(o.s || 'box')), `база ${k} ${l} ур.: детали — числа и те, что умеет движок`);
      ok(h === undefined || (Number.isFinite(h) && h > 0 && h < 20), `база ${k} ${l} ур.: высота`, h);
      ok(bd.every(b => (b.t === 'cyl' ? b.r > 0 : b.w > 0 && b.d > 0) && b.h > 0 && fin(b.y0)), `база ${k} ${l} ур.: тела`, bd);
      const half = Math.max(D.w, D.d) * 1.6 / 2 + .35;
      ok(parts.every(o => Math.abs(o.x || 0) <= half + (o.w || o.r || 0) && Math.abs(o.z || 0) <= half + (o.d || o.r || 0)) || k === 'hangar', `база ${k} ${l} ур.: детали не вылезают далеко за клетки`);
    }
  }
  for (let l = 1; l <= 5; l++) { const parts = [], bd = []; MB._draw.drawWall((g, o) => { parts.push(o); return new Gr(); }, new Gr(), { i: 1, k: 'wall', l }, bd, [[1, 0], [0, 1]], WALL_WST); ok(parts.length >= 3 && bd.length === 3 && parts.every(o => ['x', 'y', 'z', 'w', 'h', 'd'].every(f => fin(o[f]))), `стена базы ${l} ур.: столб и две перемычки`); }
  const wh = [1, 2, 3, 4, 5].map(l => MB._draw.drawWall(() => new Gr(), new Gr(), { i: 1, k: 'wall', l }, [], [], WALL_WST));
  ok(wh.every((h, i) => i === 0 || h >= wh[i - 1]), 'стена базы выше с уровнем');
  const bd2 = []; WDRAW.th(() => new Gr(), new Gr(), { i: 1, k: 'th', l: 1 }, bd2, x0()); ok(bd2.some(b => b.cam), 'штаб держит камеру (в него не заглянуть насквозь)');
}

// ═══ Вид военной базы: тела стен — отрезками (меньше тел), детали — меньше граней, дальний вид — без мелочи ═══
{
  const { wallRunsLocal, detailOf } = MB._draw, C = Geo.CELL, H = MB.WAR.n * C / 2, ctr = v => -H + (v + .5) * C;
  let oldN = 0, newN = 0, covered = true, bridged = false;
  for (let j = 1; j <= 12; j++) {
    const L = MB.fillLayout(5, j), walls = L.filter(it => it.k === 'wall' && it.l > 0), at = new Set(walls.map(it => it.x + ',' + it.z));
    for (const it of walls) { oldN++; for (const [dx, dz] of [[1, 0], [0, 1]]) if (at.has((it.x + dx) + ',' + (it.z + dz))) oldN++; }
    const R = wallRunsLocal(L); newN += R.length;
    for (const it of walls) if (!R.some(b => Math.abs(ctr(it.x) - b.cx) <= b.w / 2 + 1e-6 && Math.abs(ctr(it.z) - b.cz) <= b.d / 2 + 1e-6)) covered = false;
    for (const b of R) for (let x = Math.ceil((b.cx - b.w / 2 + H) / C - .5); ctr(x) <= b.cx + b.w / 2; x++) for (let z = Math.ceil((b.cz - b.d / 2 + H) / C - .5); ctr(z) <= b.cz + b.d / 2; z++) if (!at.has(x + ',' + z)) bridged = true;
  }
  ok(covered, 'тела стен: каждая клетка стены внутри коробки отрезка');
  ok(!bridged, 'тела стен: отрезок не перекрывает пустые клетки');
  ok(newN * 5 <= oldN, `тела стен: отрезков в 5+ раз меньше, чем столбиков и перемычек (${newN} против ${oldN})`, { newN, oldN });
  const mix = wallRunsLocal([{ i: 1, k: 'wall', x: 3, z: 3, r: 0, l: 1 }, { i: 2, k: 'wall', x: 4, z: 3, r: 0, l: 1 }, { i: 3, k: 'wall', x: 5, z: 3, r: 0, l: 4 }, { i: 4, k: 'wall', x: 6, z: 3, r: 0, l: 4 }, { i: 5, k: 'wall', x: 7, z: 3, r: 0, l: 0 }]);
  ok(mix.length === 2 && mix.every(b => b.h >= .9) && mix[0].h !== mix[1].h, 'тела стен: разные уровни — разные отрезки своей высоты, строящаяся — не в отрезке', mix);
  const one = wallRunsLocal([{ i: 1, k: 'wall', x: 9, z: 9, r: 0, l: 2 }]);
  ok(one.length === 1 && one[0].w === one[0].d && one[0].w >= .5, 'тела стен: одиночный столбик — квадратное тело');
  // детали вида
  const ball = detailOf({ s: 'ball', r: .12 }, false), big = detailOf({ s: 'ball', r: .5 }, false), cyl = detailOf({ s: 'cyl', r: .1, h: 1 }, false), keep3 = detailOf({ s: 'cyl', r: 1, h: 1, seg: 3 }, false);
  ok(ball.seg === 6 && big.seg === 10 && cyl.seg === 6 && keep3.seg === 3, 'детали вида: шары и трубы — меньше граней, явные 3–4 грани (крыши) — как были');
  ok(detailOf({ s: 'ico', r: .2, det: 1 }, false).det === 0 && detailOf({ s: 'ico', r: 1.2, det: 1 }, false).det === 1, 'детали вида: маленький многогранник проще, большой — как был');
  const bx = { s: 'box', w: 2, h: 1, d: 2 };
  ok(detailOf(bx, false) === bx && detailOf(bx, true) === bx, 'детали вида: коробка не меняется');
  ok(detailOf({ s: 'box', w: .2, h: .2, d: .2 }, true) === null && detailOf({ s: 'box', w: .8, h: .05, d: .8 }, true) === null && detailOf({ s: 'cyl', r: .05, h: 3 }, true) !== null, 'дальний вид: мелочь и тонкие пластинки не рисуются, длинный шест — рисуется');
}

console.log(`${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);
