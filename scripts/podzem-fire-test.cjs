// «Подземье» — огонь (js/games/podzem-fire.js поверх ядра js/engine/fire.js) в node: игра целиком (scripts/podzem-sim.cjs).
// node scripts/podzem-fire-test.cjs [--fast]
// Горючесть — по полям плиток; старый мир — горит только подожжённое; «распространяется» — дом из досок сгорает (доски чернеют,
// дверь и верстак исчезают целиком), ствол прогорел — дерево валится путём топора (дерево вещью), вода гасит, лава и брошенный
// факел поджигают, огонь жжёт; одинаково при 30 / 60 / 144 кадрах; сохранение посреди пожара; N минут случайной игры без ошибок.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
const FAST = process.argv.includes('--fast');
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const sec = t => console.log('— ' + t);
// время такта: среднее и 99-й процентиль (худший такт в node на занятой машине — это планировщик ОС, не код: проверено process.cpuUsage)
const pct = (a, q) => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

(async () => {
  const sim = await require('./podzem-sim.cjs')(SITE);
  for (const f of ['js/engine/support.js', 'js/games/podzem-support.js', 'js/engine/fire.js', 'js/games/podzem-fire.js']) vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
  const { A, T } = sim, PZ = globalThis.PZ, ID = k => PZ.TILE[k].id, FI = globalThis.D37E.fire, PF = globalThis.PZFire;
  const PLANKS = ID('planks'), STONE = ID('stone'), TRUNK = ID('trunk'), LEAVES = ID('leaves'), GRASS = ID('tallgrass'), DOOR = ID('door'), BENCH = ID('workbench'), CHAR = ID('charwood'), DIRT = ID('dirt'), TURF = ID('grass');
  async function world(support, seed = 'огонь', fire){
    if (T.G.state !== 'menu') await A.stopWorld(false);
    const w = A.newWorldRecord('Проверка', seed, [], support, fire), c = A.newCharRecord('Герой');
    await A.put('worlds', w); await A.put('chars', c);
    await A.play(w.id, c.id);
    for (let i = 0; i < 400 && T.G.state !== 'play'; i++) await sim.frames(.05);
    T.god(true);
    return T.G;
  }
  async function site(G, x0, y0){
    T.tp(x0, y0 - 4); await sim.frames(1.5);
    for (let i = 0; i < 40 && !(T.G.chunks.size > 8); i++) await sim.frames(.25);
  }
  const fill = (x0, y0, x1, y1, f) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) T.setCell(x, y, f, 0, null, 0); };
  const placeAt = (G, x, y, f, st = 0) => { T.setCell(x, y, f, st, null, 0); G.sup?.placed(x, y); };
  const count = (x0, y0, x1, y1, f) => { let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (T.fgAt(x, y) === f) n++; return n; };
  const itemsOf = (G, id) => G.items.filter(i => i.id === id).reduce((a, i) => a + i.n, 0);
  const X0 = 40, Y0 = 520;   // глубоко: вокруг камень (своя комната)
  const stand = x => T.tp(x, Y0 + 1 - T.G.pl.h - .01);   // герой стоит на полу комнаты (ноги — на Y0 + 1)
  const room = (x0, y0, x1, y1) => { fill(x0, y0, x1, y1, 0); fill(x0 - 2, y1 + 1, x1 + 2, y1 + 5, STONE); fill(x0 - 2, y0, x0 - 1, y1, STONE); fill(x1 + 1, y0, x1 + 2, y1, STONE); };
  // дерево руками: ствол h клеток (низ — y0), крона — круг листвы радиуса r над стволом
  const tree = (G, x, y0, h, r) => { for (let k = 0; k < h; k++) T.setCell(x, y0 - k, TRUNK, 0, null, 0); const cy = y0 - h - r + 1; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 1 && T.fgAt(x + dx, cy + dy) === 0) T.setCell(x + dx, cy + dy, LEAVES, 0, null, 0); };

  sec('горючесть — по полям плиток (без списков имён)');
  {
    const G = await world(undefined);
    const X = G.fire, MF = FI.MAT, m = k => X.FM[ID(k)];
    ok(!!X && X.spread === false, 'старый мир: огонь есть, но не распространяется (W.fire нет)', { fire: !!X, spread: X?.spread });
    const want = { trunk: 'wood', leaves: 'leaves', pleaves: 'leaves', jleaves: 'leaves', tallgrass: 'grass', flower: 'grass', vine: 'grass', mushroom: 'grass', rope: 'cloth', ladder: 'planks', platform: 'planks', planks: 'planks', door: 'planks', dooropen: 'planks', workbench: 'planks', bed: 'planks', grass: 'turf', jgrass: 'turf', charwood: 'char' };
    const bad = Object.entries(want).filter(([k, v]) => m(k) !== MF[v]).map(([k, v]) => [k, FI.MATS[m(k)]?.key, v]);
    ok(!bad.length, 'горят: стволы, листва, трава, цветы, лианы, грибы, верёвка, лестница, платформа, доски, дверь, верстак, кровать, дёрн, обугленные доски', bad);
    const never = ['stone', 'dirt', 'sand', 'torch', 'glowshroom', 'crystal', 'cactus', 'chest', 'loot', 'furnace', 'anvil', 'glass', 'pot', 'brick', 'stonebrick', 'ice', 'snow', 'lifecrystal'].filter(k => m(k));
    ok(!never.length, 'не горят: камень, земля, песок, факел, светогриб, кристаллы, кактус, сундуки, печь, наковальня, стекло, горшок, кирпич, лёд', never);
    // новая плитка «как дерево» (мод или порода деревьев) — горит сама, по полям
    const P = PZ.P, t = { burn: undefined }, f = 230;
    P.KIND[f] = PZ.KINDS.plant; P.TOOL[f] = PZ.TOOLS.axe; P.SUP[f] = 0; P.EMIS[f] = 0; P.LR[f] = P.LG[f] = P.LB[f] = 0; P.LEAFY[f] = 0;
    const wood = PF.burnOf(P, t, f, PZ.KINDS, PZ.TOOLS, P.GROUP[PLANKS]);
    P.LEAFY[f] = 1; const leafy = PF.burnOf(P, t, f, PZ.KINDS, PZ.TOOLS, P.GROUP[PLANKS]);
    P.KIND[f] = 0; P.LEAFY[f] = 0; P.TOOL[f] = 0;
    ok(wood === 'wood' && leafy === 'leaves', 'новая плитка: растение под топор без опоры — ствол, листва — листва', { wood, leafy });
    ok(PZ.ITEMS.firestarter?.kind === 'igniter' && PZ.RECIPES.some(r => r.o === 'firestarter'), 'огниво: вещь и рецепт (железный слиток + камень)');
  }

  sec('старый мир — горит только подожжённое');
  {
    const G = await world(undefined);
    await site(G, X0, Y0); room(X0 - 12, Y0 - 12, X0 + 12, Y0);
    for (let x = X0 - 5; x <= X0 + 5; x++) placeAt(G, x, Y0, PLANKS);
    const r = G.fire.igniteAt(X0, Y0);
    await sim.frames(30);
    ok(r === 1 && G.fire.F.stats.ignited === 1 && count(X0 - 5, Y0, X0 + 5, Y0, PLANKS) + count(X0 - 5, Y0, X0 + 5, Y0, CHAR) === 10 && T.fgAt(X0, Y0) === 0, 'подожгли одну доску — сгорела только она, соседи целы', { r, st: G.fire.F.stats, planks: count(X0 - 5, Y0, X0 + 5, Y0, PLANKS), at: T.fgAt(X0, Y0) });
  }

  sec('«распространяется»: дом из досок — чернеет, сгорает; дверь и верстак — целиком');
  {
    const G = await world(undefined, 'огонь', 'spread');
    await site(G, X0, Y0); room(X0 - 14, Y0 - 14, X0 + 14, Y0);
    for (let x = X0 - 6; x <= X0 + 6; x++) { placeAt(G, x, Y0, PLANKS); placeAt(G, x, Y0 - 8, PLANKS); }   // пол и крыша
    for (let y = Y0 - 7; y <= Y0 - 1; y++) { placeAt(G, X0 - 6, y, PLANKS); if (y < Y0 - 3) placeAt(G, X0 + 6, y, PLANKS); }   // стены
    for (let k = 0; k < 3; k++) T.setCell(X0 + 6, Y0 - 3 + k, DOOR, k << 4, null, 0);   // дверь (3 клетки над полом)
    T.setCell(X0 - 2, Y0 - 1, BENCH, 0, null, 0); T.setCell(X0 - 1, Y0 - 1, BENCH, 1 << 4, null, 0);   // верстак на полу
    stand(X0 + 11);
    const planks0 = count(X0 - 6, Y0 - 8, X0 + 6, Y0, PLANKS);
    ok(G.fire.igniteAt(X0 - 6, Y0) === 1, 'подожгли угол дома');
    let charSeen = 0, t = 0;
    for (; t < 150; t += 2) { await sim.frames(2); charSeen = Math.max(charSeen, count(X0 - 6, Y0 - 8, X0 + 6, Y0, CHAR)); if (!G.fire.F.n) break; }
    const planks1 = count(X0 - 6, Y0 - 8, X0 + 6, Y0, PLANKS) + count(X0 - 6, Y0 - 8, X0 + 6, Y0, CHAR), doorLeft = count(X0 + 6, Y0 - 3, X0 + 6, Y0 - 1, DOOR), bench = count(X0 - 2, Y0 - 1, X0 - 1, Y0 - 1, BENCH);
    const st = G.fire.F.stats;
    ok(charSeen > 0, 'доски чернели (обугленные доски) по ходу горения', { charSeen });
    ok(planks1 < planks0 * .25 && doorLeft === 0 && bench === 0, 'дом сгорел: досок почти нет, дверь и верстак исчезли целиком', { planks0, planks1, doorLeft, bench });
    ok(itemsOf(G, 'door') === 0 && itemsOf(G, 'workbench') === 0, 'сгоревшее не выпадает вещью');
    ok(st.burnt > 20 && st.peak > 5, 'сгорело много клеток, горело сразу много', { burnt: st.burnt, peak: st.peak, t });
    console.log(`  дом: ${planks0} досок → ${planks1}, горело до ${st.peak} клеток сразу, сгорело ${st.burnt}, за ${t} с`);
  }

  sec('«реализм»: столб из досок прогорел — балка падает (обрушение — своим путём, podzem-support.js)');
  {
    const G = await world('real', 'обрушение');
    ok(G.W.fire === 'spread' && G.fire.spread === true, 'новый мир «реализм» — огонь распространяется (W.fire = spread)', { fire: G.W.fire });
    await site(G, X0, Y0); room(X0 - 14, Y0 - 14, X0 + 14, Y0);
    for (let y = Y0 - 6; y <= Y0; y++) placeAt(G, X0, y, PLANKS);
    for (let x = X0 + 1; x <= X0 + 4; x++) placeAt(G, x, Y0 - 6, PLANKS);
    for (let x = X0 + 1; x <= X0 + 4; x++) T.setCell(x, Y0 - 5, ID('stonebrick'), 0, null, 0), G.sup.placed(x, Y0 - 5);   // под балкой — кирпич (не горит)
    stand(X0 + 10);
    G.fire.igniteAt(X0, Y0);
    let t = 0; for (; t < 90 && !G.sup.stats.groups; t += 1) await sim.frames(1);
    ok(G.sup.stats.groups >= 1, 'прогорел столб — кусок без опоры упал', { groups: G.sup.stats.groups, t, burnt: G.fire.F.stats.burnt });
    console.log(`  обрушение через ${t} с после поджога, групп ${G.sup.stats.groups}, плиток ${G.sup.stats.cells}`);
  }

  sec('дерево: листва горит быстро, ствол прогорел — верх валится путём топора (дерево вещью), пень догорает');
  {
    const G = await world(undefined, 'огонь', 'spread');
    await site(G, X0, Y0); room(X0 - 14, Y0 - 24, X0 + 14, Y0);
    tree(G, X0, Y0, 12, 3);
    stand(X0 + 12);
    const trunk0 = count(X0, Y0 - 11, X0, Y0, TRUNK);
    G.fire.igniteAt(X0, Y0);   // у корня: ствол прогорает снизу — верх падает
    let t = 0;
    for (; t < 150; t += 3) { await sim.frames(3); if (!G.fire.F.n) break; }
    const leaves1 = count(X0 - 4, Y0 - 20, X0 + 4, Y0 - 10, LEAVES), trunk1 = count(X0, Y0 - 11, X0, Y0, TRUNK), wood = itemsOf(G, 'wood');
    let floating = 0; for (let y = Y0 - 11; y < Y0; y++) if (T.fgAt(X0, y) === TRUNK && T.fgAt(X0, y + 1) === 0) floating++;
    ok(leaves1 === 0, 'листва сгорела вся', { leaves1 });
    ok(G.fire.stats.fell >= 1 && wood > 0, 'ствол прогорел — верх упал (дерево вещью, путём топора)', { fell: G.fire.stats.fell, wood, trunk0, trunk1 });
    ok(floating === 0, 'нет висящих кусков ствола над прогоревшим', { floating });
    console.log(`  дерево: ствол ${trunk0} → ${trunk1}, упало ${G.fire.stats.fell} раз, дерева вещью ${wood}, за ${t} с`);
  }

  sec('вода гасит; лава, брошенный факел, огненный шар поджигают; огонь жжёт');
  {
    const G = await world(undefined, 'огонь', 'spread');
    await site(G, X0, Y0); room(X0 - 14, Y0 - 10, X0 + 14, Y0);
    // вода сверху на горящей доске
    for (let x = X0 - 10; x <= X0 - 6; x++) placeAt(G, x, Y0, PLANKS);
    G.fire.igniteAt(X0 - 8, Y0);
    await sim.frames(.5);
    T.setCell(X0 - 8, Y0 - 1, null, null, null, 255, 1);
    await sim.frames(1);
    ok(!G.fire.F.has(X0 - 8, Y0) && T.fgAt(X0 - 8, Y0) === PLANKS, 'вода на горящей доске — погасла, доска цела', { burning: G.fire.F.has(X0 - 8, Y0), f: T.fgAt(X0 - 8, Y0) });
    T.setCell(X0 - 6, Y0 - 1, null, null, null, 255, 1);
    ok(G.fire.igniteAt(X0 - 6, Y0) === -1, 'мокрое не поджечь (огниво: «Мокрое — не загорится»)');
    for (let x = X0 - 11; x <= X0 - 5; x++) T.setCell(x, Y0 - 1, null, null, null, 0, 0);
    G.fire.F.clear();
    // лава в ямке, над ней доска
    fill(X0 + 1, Y0 + 1, X0 + 5, Y0 + 1, 0); fill(X0 + 1, Y0 + 2, X0 + 5, Y0 + 2, STONE);
    for (let x = X0 + 1; x <= X0 + 5; x++) T.setCell(x, Y0 + 1, null, null, null, 255, 2);
    placeAt(G, X0 + 3, Y0, PLANKS); placeAt(G, X0 + 2, Y0, PLANKS); placeAt(G, X0 + 4, Y0, PLANKS);
    let lit = false; for (let t = 0; t < 40 && !lit; t++) { await sim.frames(1); lit = G.fire.stats.lava > 0; }
    ok(lit, 'лава подожгла доски над собой', { lava: G.fire.stats.lava });
    G.fire.F.clear(); fill(X0 + 1, Y0 - 3, X0 + 5, Y0 + 1, 0); fill(X0 + 1, Y0 + 1, X0 + 5, Y0 + 1, STONE);
    // брошенный факел в траве
    for (let x = X0 + 8; x <= X0 + 12; x++) T.setCell(x, Y0, GRASS, 0, null, 0);
    stand(X0 - 12);
    T.G.items.length = 0; A.dropItem('torch', 1, X0 + 10.5, Y0 - 1.5, 0, 0);
    let tl = false; for (let t = 0; t < 30 && !tl; t++) { await sim.frames(.5); tl = G.fire.stats.torch > 0; }
    ok(tl, 'факел упал в траву — она загорелась', { torch: G.fire.stats.torch, items: T.G.items.map(i => [i.id, +i.x.toFixed(1), +i.y.toFixed(1), i.ground]) });
    await sim.frames(6); G.fire.F.clear(); T.G.items.length = 0;
    // огненный шар
    for (let x = X0 - 4; x <= X0 + 4; x++) placeAt(G, x, Y0, PLANKS);
    G.fire.ball(X0 + .5, Y0 - .2);
    ok(G.fire.stats.ball === 1 && G.fire.F.n >= 1, 'огненный шар поджёг доску', { ball: G.fire.stats.ball, n: G.fire.F.n });
    G.fire.F.clear();
    // огонь жжёт (без «бога»)
    T.god(false); const hp0 = T.G.CH.hp;
    T.setCell(X0, Y0, GRASS, 0, null, 0); T.setCell(X0 + 1, Y0, GRASS, 0, null, 0); stand(X0 + .2);
    G.fire.F.ignite(X0, Y0); G.fire.F.ignite(X0 + 1, Y0);
    await sim.frames(1);
    ok(T.G.CH.hp < hp0 && G.fire.stats.hurt > 0, 'в огне — урон (стоишь в горящей траве)', { hp0, hp: T.G.CH.hp, hurt: G.fire.stats.hurt });
    T.god(true); T.G.CH.hp = T.G.CH.maxHp;
    // огниво в руке (вещь «igniter»)
    G.fire.F.clear(); fill(X0 - 4, Y0, X0 + 4, Y0, 0);
    T.setCell(X0 + 2, Y0, LEAVES, 0, null, 0); stand(X0);
    T.useIgniter(X0 + 2, Y0);
    ok(G.fire.F.has(X0 + 2, Y0), 'огниво: подожгло листву у курсора');
    T.useIgniter(X0 - 2, Y0 + 1);
    ok(G.fire.F.n === 1, 'огниво по камню — ничего не загорелось (подсказка)', { n: G.fire.F.n });
  }

  sec('одинаково при 30 / 60 / 144 кадрах (лес и трава, ветер нет, обрушение выкл)');
  async function forest(hz){
    const G = await world(undefined, 'лес огня', 'spread');
    await site(G, X0, Y0); room(X0 - 30, Y0 - 24, X0 + 30, Y0);
    for (let x = X0 - 28; x <= X0 + 28; x++) T.setCell(x, Y0, GRASS, 0, null, 0);
    for (let x = X0 - 25; x <= X0 + 25; x += 5) tree(G, x, Y0, 8 + ((x * 7) & 3), 3);
    for (let x = X0 - 26; x <= X0 + 26; x += 3) T.setCell(x, Y0 + 1, TURF, 0, null, 0);
    stand(X0 - 29);   // герой у стены
    // поджечь в начале такта огня с одного номера такта, картина — ровно через TGT тактов (клетки меняет только такт огня)
    const X = G.fire, t0 = X.tick, TGT = 100000 + (FAST ? 1200 : 2100);
    let lit = false, snap = null, ticks = 0, maxMs = 0, sum = 0; const TT = [];
    X.tick = () => {
      if (!lit) { lit = true; X.F.T = 99999; X.igniteAt(X0, Y0); }
      const a = performance.now(); t0(); const d = performance.now() - a; ticks++; sum += d; if (d > maxMs) maxMs = d; TT.push(d);
      if (!snap && X.F.T === TGT) {
        let sig = ''; for (let y = Y0 - 24; y <= Y0 + 1; y++) for (let x = X0 - 30; x <= X0 + 30; x++) sig += String.fromCharCode(65 + (T.fgAt(x, y) & 63));
        const st = X.F.stats; snap = { hz, ignited: st.ignited, burnt: st.burnt, peak: st.peak, n: X.F.n, T: X.F.T, sig };
      }
    };
    for (let i = 0; i < 400 && !snap; i++) await sim.frames(.25, hz);
    X.tick = t0;
    return Object.assign(snap || { hz, sig: '' }, { ticks, maxMs, avg: sum / Math.max(1, ticks), p99: pct(TT, .99) });
  }
  {
    const a = await forest(60), b = await forest(30), c = await forest(144);
    const same = (p, q) => p.ignited === q.ignited && p.burnt === q.burnt && p.peak === q.peak && p.n === q.n && p.T === q.T && p.sig === q.sig;
    ok(a.ignited > 100 && a.burnt > 80, 'лес сгорел (загорелось и сгорело много)', { ignited: a.ignited, burnt: a.burnt, peak: a.peak });
    ok(same(a, b) && same(a, c), 'одинаково при 60 / 30 / 144 кадрах: те же клетки, то же число загораний и сгоревших', [a, b, c].map(r => ({ hz: r.hz, ignited: r.ignited, burnt: r.burnt, peak: r.peak, n: r.n, T: r.T })));
    console.log(`  лес: загорелось ${a.ignited}, сгорело ${a.burnt}, сразу до ${a.peak}; такт огня в node: в среднем ${a.avg.toFixed(3)} мс, 99 % — до ${a.p99.toFixed(3)} мс (тактов ${a.ticks})`);
  }

  sec('сохранение посреди пожара: что горит — продолжается после выхода и входа');
  {
    const G = await world(undefined, 'огонь', 'spread');
    await site(G, X0, Y0); room(X0 - 14, Y0 - 10, X0 + 14, Y0);
    for (let x = X0 - 10; x <= X0 + 10; x++) placeAt(G, x, Y0, PLANKS);
    G.fire.igniteAt(X0, Y0);
    await sim.frames(4);
    const n0 = G.fire.F.n, wid = G.W.id, cid = G.CH.id;
    await A.saveAll();
    await A.stopWorld(false);
    await A.play(wid, cid);
    const G2 = T.G, n1 = G2.fire?.F.n;
    ok(G2.fire && n1 === n0 && n0 > 0, 'после входа горит то же самое', { n0, n: n1 });
    for (let i = 0; i < 400 && T.G.state !== 'play'; i++) await sim.frames(.05);
    const b0 = G2.fire.F.stats.burnt;
    for (let i = 0; i < 40 && G2.chunks.size < 4; i++) await sim.frames(.25);
    await sim.frames(25);
    ok(G2.fire.F.stats.burnt > b0, 'и догорает дальше', { burnt: G2.fire.F.stats.burnt });
  }

  sec('новый мир: огонь — выбор при создании');
  {
    const r1 = A.newWorldRecord('a', 's', [], 'real'), r2 = A.newWorldRecord('a', 's', [], 'soft'), r3 = A.newWorldRecord('a', 's', [], undefined, 'spread'), r4 = A.newWorldRecord('a', 's', [], 'real', 'off'), r5 = A.newWorldRecord('a', 's');
    ok(r1.fire === 'spread' && r2.fire === undefined && r3.fire === 'spread' && r4.fire === undefined && r5.fire === undefined, '«реализм» — вкл, «мягкое» и старые — выкл, выбор игрока главнее', [r1.fire, r2.fire, r3.fire, r4.fire, r5.fire]);
  }

  // ── N минут игры: строим из досок, сажаем траву и деревья, поджигаем, льём воду, ломаем; без ошибок ──
  const MIN = FAST ? 2 : 10;
  sec(MIN + ' минут случайной игры в мире «реализм» с огнём — без ошибок');
  {
    const G = await world('real', 'пожары');
    await site(G, X0, Y0); room(X0 - 30, Y0 - 24, X0 + 30, Y0);
    let errs = 0, act = 0; const rnd = globalThis.D37E.support.rng(91), BRICK = ID('brick');
    const onErr = e => { errs++; if (errs < 4) console.log('  ошибка:', e && e.stack); };
    const built = [];
    let tickMax = 0, ticks = 0, tickSum = 0; const TT = [];
    const tick0 = G.fire.tick; G.fire.tick = () => { const a = performance.now(); tick0(); const d = performance.now() - a; tickSum += d; ticks++; if (d > tickMax) tickMax = d; TT.push(d); };
    for (let s = 0; s < MIN * 60 * 4; s++) {
      try {
        const r = rnd();
        if (r < .45) {   // построить: доски, кирпич, трава, деревья
          let x, y;
          if (built.length && rnd() < .8) { const b = built[Math.floor(rnd() * built.length)], d = Math.floor(rnd() * 4); x = b[0] + (d === 0 ? 1 : d === 1 ? -1 : 0); y = b[1] + (d === 2 ? 1 : d === 3 ? -1 : 0); }
          else { x = X0 - 28 + Math.floor(rnd() * 56); y = Y0; }
          const q = rnd(), f = q < .6 ? PLANKS : q < .75 ? BRICK : q < .9 ? GRASS : LEAVES;
          if (y > Y0 - 23 && y <= Y0 && !T.fgAt(x, y) && (f === GRASS || f === LEAVES || G.sup.canPlace(f, x, y))) { placeAt(G, x, y, f); built.push([x, y]); }
        } else if (r < .55) { const x = X0 - 28 + Math.floor(rnd() * 56); if (x % 9 === 0 && !T.fgAt(x, Y0)) tree(G, x, Y0, 5 + Math.floor(rnd() * 5), 2); }
        else if (r < .65 && built.length) { const b = built[Math.floor(rnd() * built.length)]; G.fire.igniteAt(b[0], b[1]); }
        else if (r < .7) { const x = X0 - 28 + Math.floor(rnd() * 56), y = Y0 - 1 - Math.floor(rnd() * 20); if (!T.fgAt(x, y)) T.setCell(x, y, null, null, null, 200, 1); }   // ковш воды (растечётся)
        else if (r < .78) { const x = X0 - 28 + Math.floor(rnd() * 56), y = Y0 - 1 - Math.floor(rnd() * 20); A.dropItem('torch', 1, x + .5, y + .5, 0, 0); }
        else if (built.length) { const i = Math.floor(rnd() * built.length), b = built[i]; if (T.fgAt(b[0], b[1])) T.breakTile(b[0], b[1], true); built.splice(i, 1); }
        act++;
        if ((s & 3) === 3) await sim.frames(1);
        if (built.length > 900) built.splice(0, 300);
        if (T.G.items.length > 300) T.G.items.length = 0;
      } catch (e) { onErr(e); }
    }
    await sim.frames(5);
    G.fire.tick = tick0;
    const st = G.fire.F.stats;
    console.log(`  ${MIN} мин: действий ${act}, загорелось ${st.ignited}, сгорело ${st.burnt}, погасло ${st.out + st.gone}, сразу до ${st.peak}; такт огня: в среднем ${(tickSum / Math.max(1, ticks)).toFixed(3)} мс, 99 % — до ${pct(TT, .99).toFixed(3)} мс; лава ${G.fire.stats.lava}, факелы ${G.fire.stats.torch}, упало деревьев ${G.fire.stats.fell}`);
    ok(errs === 0, MIN + ' мин игры с огнём — без ошибок', errs);
    ok(st.ignited > MIN * 25 && st.burnt > MIN * 12 && st.peak <= 4096, 'горело и гасло много, не больше предела ядра', { ignited: st.ignited, burnt: st.burnt, peak: st.peak });
  }

  console.log(`\nПодземье, огонь: ${pass} прошло, ${fail} не прошло`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
