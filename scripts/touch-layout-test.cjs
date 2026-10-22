// Проверка раскладки кнопок телефона (js/core/touch-layout.js, D37TouchLayout; T-074) без браузера: node scripts/touch-layout-test.cjs
// Раскладка по умолчанию и своя (лёжа и стоя отдельно, от ближнего края — на другом экране кнопка у того же края), левша — зеркально,
// «Размер кнопок» — множитель, кнопка в окне целиком, стили пишутся только при перемене (не каждый кадр), «как в другой» (same),
// хранилище: битые и чужие записи отбрасываются, подписи «до первого нажатия», строка в ⚙️ экранирует название игры.
// Редактор (перетащить, размер, «Как было») — в настоящем Chrome: scripts/touch-hud-e2e.cjs (TH_MODE=full).
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };

function env(store0 = {}){
  const store = new Map(Object.entries(store0)), L = new Map(), ticks = [];
  let writes = 0;
  const el = (w = 0, h = 0) => {
    const st = { setProperty(k, v){ this[k] = v; writes++; } };
    const proxy = new Proxy(st, { set(t, k, v){ t[k] = v; writes++; return true; } });
    const e = { clientWidth: w, clientHeight: h, isConnected: true, style: proxy, children: [], getClientRects: () => [1], appendChild(c){ this.children.push(c); c.parentNode = this; return c; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) };
    return e;
  };
  const doc = {
    documentElement: { classList: { _s: new Set(), contains(c){ return this._s.has(c); }, toggle(c, v){ v ? this._s.add(c) : this._s.delete(c); } } },
    head: { appendChild(){} }, getElementById: () => null,
    createElement: () => { const e = el(); e.remove = () => {}; return e; },
    addEventListener(){},
  };
  const ctx = {
    console, Math, Map, Set, JSON, Array, Object, String, Number, Boolean, Promise, Proxy, Infinity, NaN, setTimeout: f => { ticks.push(f); return ticks.length; },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: doc, getComputedStyle: () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' }),
    D37Opt: { lefty: false }, D37Settings: { _ts: 100, get(k){ return k === 'touchSize' ? this._ts : undefined; }, isOpen: () => false },
    addEventListener: (ev, f) => { if (!L.has(ev)) L.set(ev, []); L.get(ev).push(f); },
    CustomEvent: function (t, o){ this.type = t; this.detail = o?.detail; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'js/core/touch-layout.js'), 'utf8'), ctx, { filename: 'touch-layout.js' });
  return { ctx, TL: ctx.D37TouchLayout, el, store, fire: (ev, d) => { for (const f of L.get(ev) || []) f({ detail: d }); while (ticks.length) ticks.shift()(); }, writes: () => writes };
}
const ITEMS = [{ id: 'jump', icon: '⤒', label: 'прыжок' }, { id: 'sneak', icon: '⬇', label: 'красться' }, { id: 'down', icon: '⤓', label: 'вниз', same: 'sneak' }, { id: 'inv', icon: '🎒', label: 'вещи' }];
// по умолчанию: «прыжок» в правом нижнем углу, остальные — левее и выше (для правой руки)
const DEF = (W, H, k) => ({ jump: { x: W - 43 * k, y: H - 43 * k, d: 54 * k }, sneak: { x: W - 109 * k, y: H - 37 * k, d: 44 * k }, down: { x: W - 109 * k, y: H - 37 * k, d: 44 * k }, inv: { x: W - 41 * k, y: H - 111 * k, d: 44 * k } });

console.log('— раскладка по умолчанию, левша, размер');
{
  const E = env(), wrap = E.el(844, 390), B = {}; for (const it of ITEMS) B[it.id] = E.el();
  const T = E.TL.attach({ id: 'kubomir', title: 'Кубомир', el: wrap, items: () => ITEMS, btn: id => B[id], defaults: DEF });
  ok(!!T && E.TL._test.live() === 1, 'подключено');
  const at = b => ({ x: parseFloat(b.style.left) + parseFloat(b.style.width) / 2, y: parseFloat(b.style.top) + parseFloat(b.style.height) / 2, d: parseFloat(b.style.width) });
  ok(Math.abs(at(B.jump).x - 801) < .6 && Math.abs(at(B.jump).y - 347) < .6 && at(B.jump).d === 54, '«прыжок» — как задала игра', at(B.jump));
  ok(at(B.down).x === at(B.sneak).x && at(B.down).y === at(B.sneak).y, '«вниз» — там же, где «красться»');
  ok(B.jump.style['--tl-d'] === '54px', '--tl-d — диаметр (для размера значка)');
  // стили — только при перемене
  const w0 = E.writes(); for (let i = 0; i < 100; i++) T.layout(); ok(E.writes() === w0, '100 раз «расставь» без перемен — ни одной записи в стили', E.writes() - w0);
  // левша — зеркально
  E.ctx.D37Opt.lefty = true; E.fire('d37:settings', { key: 'lefty' });
  ok(Math.abs(at(B.jump).x - 43) < .6, 'левша: «прыжок» в левом нижнем углу', at(B.jump));
  E.ctx.D37Opt.lefty = false; E.fire('d37:settings', { key: 'lefty' });
  // размер кнопок 130 %
  E.ctx.D37Settings._ts = 130; E.fire('d37:settings', { key: 'touchSize' });
  ok(Math.abs(at(B.jump).d - 70.2) < .6, 'размер кнопок 130 % — диаметр ×1,3', at(B.jump));
  E.ctx.D37Settings._ts = 100; E.fire('d37:settings', { key: 'touchSize' });
  // окно поменялось — пересчёт
  wrap.clientWidth = 915; wrap.clientHeight = 412; T.layout();
  ok(Math.abs(at(B.jump).x - 872) < .6 && Math.abs(at(B.jump).y - 369) < .6, 'окно 915×412 — «прыжок» снова в углу', at(B.jump));
  // в окне целиком
  const T2 = E.TL.attach({ id: 'edge', el: E.el(300, 200), items: () => [{ id: 'a' }], btn: () => B.inv, defaults: () => ({ a: { x: 400, y: -50, d: 40 } }) });
  ok(at(B.inv).x <= 300 - 20 && at(B.inv).y >= 20, 'кнопку за краем — внутрь окна', at(B.inv));
  T2.detach(); T.detach();
  ok(E.TL._test.live() === 0 && !E.TL.current(), 'отключено — живых раскладок нет');
}

console.log('— своя раскладка игрока');
{
  // своя: «прыжок» в 120 px от правого края и 100 от нижнего, диаметр 60 при 100 %; стоя — своя отдельно
  const saved = { v: 1, g: { kubomir: { l: { jump: { x: 120, y: 100, ax: 1, ay: 1, d: 60 }, sneak: { x: 40, y: 200, ax: 0, ay: 1, d: 44 } } } } };
  const E = env({ d37_touch_layout: JSON.stringify(saved) }), wrap = E.el(844, 390), B = {}; for (const it of ITEMS) B[it.id] = E.el();
  const at = b => ({ x: parseFloat(b.style.left) + parseFloat(b.style.width) / 2, y: parseFloat(b.style.top) + parseFloat(b.style.height) / 2, d: parseFloat(b.style.width) });
  const T = E.TL.attach({ id: 'kubomir', el: wrap, items: () => ITEMS, btn: id => B[id], defaults: DEF });
  ok(Math.abs(at(B.jump).x - 724) < .6 && Math.abs(at(B.jump).y - 290) < .6 && at(B.jump).d === 60, 'своя: «прыжок» — где поставил игрок', at(B.jump));
  ok(Math.abs(at(B.sneak).x - 40) < .6 && Math.abs(at(B.down).x - 40) < .6, 'своя: «красться» у левого края, «вниз» — с ним', [at(B.sneak), at(B.down)]);
  ok(Math.abs(at(B.inv).x - 803) < .6, 'не переставленная кнопка — по умолчанию', at(B.inv));
  wrap.clientWidth = 915; wrap.clientHeight = 412; T.layout();
  ok(Math.abs(at(B.jump).x - 795) < .6 && Math.abs(at(B.jump).y - 312) < .6, 'другой экран — у того же края (120 и 100 px)', at(B.jump));
  E.ctx.D37Settings._ts = 120; E.fire('d37:settings', { key: 'touchSize' });
  ok(Math.abs(at(B.jump).d - 72) < .6, 'своя кнопка тоже слушает «Размер кнопок»', at(B.jump));
  E.ctx.D37Settings._ts = 100; E.fire('d37:settings', { key: 'touchSize' });
  E.ctx.D37Opt.lefty = true; E.fire('d37:settings', { key: 'lefty' });
  ok(Math.abs(at(B.jump).x - 120) < .6, 'своя раскладка у левши — зеркально', at(B.jump));
  E.ctx.D37Opt.lefty = false; E.fire('d37:settings', { key: 'lefty' });
  wrap.clientWidth = 390; wrap.clientHeight = 844; T.layout();
  ok(Math.abs(at(B.jump).x - (390 - 43)) < .6, 'стоя — своей раскладки нет: по умолчанию', at(B.jump));
  ok(!!E.TL.saved('kubomir', 'l') && !E.TL.saved('kubomir', 'p'), 'лёжа и стоя — отдельно');
  E.TL.clear('kubomir');
  wrap.clientWidth = 844; wrap.clientHeight = 390; T.layout();
  ok(Math.abs(at(B.jump).x - 801) < .6 && !E.store.has('d37_touch_layout'), '«сбросить всё» — снова по умолчанию, запись стёрта', [at(B.jump), E.store.get('d37_touch_layout')]);
  T.detach();
}

console.log('— хранилище: битое и чужое');
{
  const bad = { v: 1, g: { kubomir: { l: { jump: { x: 'NaN', y: 1, d: 50 }, inv: { x: 10, y: 10, d: 5000 }, ok: { x: 10, y: 20, ax: 1, ay: 0, d: 50 }, '<img>': { x: 1, y: 1, d: 40 } } }, '<script>': { l: { a: { x: 1, y: 1, d: 40 } } } } };
  const E = env({ d37_touch_layout: JSON.stringify(bad) });
  const m = E.TL.saved('kubomir', 'l');
  ok(m && Object.keys(m).join() === 'ok', 'остаётся только правильная кнопка (не числа, огромный размер, странное имя — выброшены)', m);
  ok(!E.TL.saved('<script>', 'l'), 'чужое имя игры — выброшено');
  const E2 = env({ d37_touch_layout: '{не json' });
  ok(E2.TL.saved('kubomir', 'l') === null, 'битый JSON — как будто ничего нет');
  const E3 = env({ d37_touch_layout: JSON.stringify({ v: 2, g: { kubomir: { l: { a: { x: 1, y: 1, d: 40 } } } } }) });
  ok(E3.TL.saved('kubomir', 'l') === null, 'другая версия записи — не читаем');
}

console.log('— подписи «до первого нажатия», строка в ⚙️');
{
  const E = env();
  ok(!E.TL.seen('kubomir', 'inv'), 'новая кнопка — с подписью');
  E.TL.markSeen('kubomir', 'inv');
  ok(E.TL.seen('kubomir', 'inv') && JSON.parse(E.store.get('d37_touch_seen')).kubomir.inv === 1, 'нажал — подпись больше не показываем (запомнено)');
  E.TL.markSeen('<b>', 'x'); ok(!/<b>/.test(E.store.get('d37_touch_seen')), 'странное имя — не запоминаем');
  ok(/disabled/.test(E.TL.settingsRow()) && /Настроить кнопки/.test(E.TL.settingsRow()), 'игры нет — кнопка «Настроить» неактивна, с подсказкой');
  const T = E.TL.attach({ id: 'kubomir', title: '<img src=x onerror=alert(1)>', el: E.el(800, 400), items: () => ITEMS, btn: () => null, defaults: DEF });
  const row = E.TL.settingsRow();
  ok(!/disabled/.test(row) && !/<img/.test(row) && /&lt;img/.test(row), 'игра открыта — кнопка активна, название экранировано', row.slice(0, 200));
  T.detach();
}

console.log(`\ntouch-layout-test: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
