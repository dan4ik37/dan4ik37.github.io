// Круг выбора D37E.radial (js/engine/ui.js, HUD 2.0 T-123) без браузера: node scripts/radial-test.cjs
// Палец ведут на ВИДИМЫЙ значок (где он нарисован: круг прижат к краю экрана или поднят над пальцем, как в «Мире», «Кубомире»,
// «Подземье», «Терре») — выбран именно он, а не сосед по направлению от точки нажатия. Ещё: дрожь пальца (меньше 28 px) — выбора
// нет, отпустил не сдвинув — круг ждёт нажатия; отпустил на ✕ в середине — отмена; ПК с захваченной мышью — от середины круга.
// В настоящем Chrome (касание, игры): scripts/touch-hud-e2e.cjs (TH_MODE=full, GAME=kubomir | podzem | world).
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };

// ── крошечный DOM: только то, что трогает D37E.radial ──
function env(W, H){
  const L = [];
  const mk = tag => {
    const e = { tagName: tag, children: [], style: {}, dataset: {}, attrs: {}, hidden: false, className: '', textContent: '', parentNode: null,
      classList: { _s: new Set(), toggle(c, v){ v ? this._s.add(c) : this._s.delete(c); }, contains(c){ return this._s.has(c); } },
      appendChild(c){ this.children.push(c); c.parentNode = this; return c; },
      remove(){ const p = this.parentNode; if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); } this.parentNode = null; },
      setAttribute(k, v){ this.attrs[k] = String(v); }, getAttribute(k){ return this.attrs[k] ?? null; },
      addEventListener(t, f){ L.push([this, t, f]); }, removeEventListener(t, f){ const i = L.findIndex(x => x[0] === this && x[1] === t && x[2] === f); if (i >= 0) L.splice(i, 1); },
      contains(x){ for (let p = x; p; p = p.parentNode) if (p === this) return true; return false; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H }),
    };
    Object.defineProperty(e, 'innerHTML', { set(v){ e.children.length = 0; for (let i = 0; i < (String(v).match(/<div/g) || []).length; i++) e.appendChild(mk('div')); }, get: () => '' });
    return e;
  };
  const document = { createElement: mk, getElementById: () => null, head: mk('head'), addEventListener(t, f){ L.push([document, t, f]); }, removeEventListener(t, f){ const i = L.findIndex(x => x[0] === document && x[1] === t && x[2] === f); if (i >= 0) L.splice(i, 1); } };
  const window = { addEventListener(t, f){ L.push([window, t, f]); }, removeEventListener(t, f){ const i = L.findIndex(x => x[0] === window && x[1] === t && x[2] === f); if (i >= 0) L.splice(i, 1); } };
  const ctx = { window, document, navigator: {}, console, setTimeout, clearTimeout, matchMedia: () => ({ matches: true }), CustomEvent: class {}, Math, Object, JSON, String, Number, Array, Set, Map };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'js/engine/ui.js'), 'utf8'), ctx, { filename: 'ui.js' });
  const host = mk('div');
  return { E: window.D37E, host, L };
}

// нарисованная середина значка (px окна host = экрана в тесте): left/top круга + translate кнопки
const drawn = (R, b) => { const m = /translate\((-?\d+)px,(-?\d+)px\)/.exec(b.style.transform); return { x: parseFloat(R.el.style.left) + +m[1], y: parseFloat(R.el.style.top) + +m[2] }; };
const items = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, icon: String(i), label: 'Пункт ' + i }));
// провести палец от (x0, y0) к (x1, y1) за k шагов и отпустить; → id выбранного (null — ничего)
function slide(E, host, n, at, from, to, k = 6, oo = {}){
  let got = null; const R = E.radial(host, {});
  R.open(items(n), at, Object.assign({ onPick: it => { got = it.id; }, from }, oo));
  for (let s = 1; s <= k; s++) R.move(from.x + (to.x - from.x) * s / k, from.y + (to.y - from.y) * s / k);
  R.up(); const st = R.isSticky(); R.dispose();
  return { got, sticky: st };
}

// ── 1. круг прямо под пальцем (как раньше): ведёшь на значок — он ──
{
  const { E, host } = env(844, 390);
  for (const n of [4, 6, 8]) {
    let bad = [];
    const R0 = E.radial(host, {}); R0.open(items(n), { x: 422, y: 200 }, {}); const pts = [...R0.el.children].filter(c => c.className.startsWith('e2-rad-it')).map(b => drawn(R0, b)); R0.dispose();
    pts.forEach((p, i) => { const r = slide(E, host, n, { x: 422, y: 200 }, { x: 422, y: 200 }, p); if (r.got !== 'p' + i) bad.push([i, r.got]); });
    ok(!bad.length, `круг под пальцем, ${n} пунктов: повёл на значок — выбран он`, bad);
  }
}

// ── 2. круг поднят над пальцем (−40, −124: «Мир» D37E.ui, «Кубомир», «Подземье») и прижат к краю (лёжа и стоя, правый нижний угол,
//    левша — слева): ведёшь на НАРИСОВАННЫЙ значок — выбран он (до T-123 fix: выбор по направлению от пальца — сосед) ──
for (const [W, H] of [[844, 390], [412, 915], [1280, 720]]) {
  const { E, host } = env(W, H);
  const fingers = [{ x: W - 107, y: H - 41 }, { x: W - 60, y: H - 140 }, { x: 107, y: H - 41 }, { x: W / 2, y: H - 60 }];
  for (const f of fingers) for (const dx of [-40, 40]) for (const n of [4, 5, 6, 8]) {
    const at = { x: f.x + dx, y: f.y - 124 };
    const R0 = E.radial(host, {}); R0.open(items(n), at, { from: f }); const pts = [...R0.el.children].filter(c => c.className.startsWith('e2-rad-it')).map(b => drawn(R0, b)); R0.dispose();
    const bad = [];
    pts.forEach((p, i) => { for (const k of [3, 6, 12]) { const r = slide(E, host, n, at, f, p, k); if (r.got !== 'p' + i) bad.push({ i, k, got: r.got, p }); } });
    ok(!bad.length, `${W}×${H}, палец (${f.x},${f.y}), круг сдвинут ${dx}/−124 (и прижат), ${n} пунктов: повёл на видимый значок — выбран он`, bad.slice(0, 4));
  }
}

// ── 3. палец «почти» на значке (радиус попадания кнопки 24 px): ведёшь в точку со смещением до 18 px — всё равно он ──
{
  const { E, host } = env(844, 390);
  const f = { x: 737, y: 349 }, at = { x: 697, y: 225 };   // замер проверяющего T-123: палец (737,349), круг прижат над ним
  const n = 8;
  const R0 = E.radial(host, {}); R0.open(items(n), at, { from: f }); const pts = [...R0.el.children].filter(c => c.className.startsWith('e2-rad-it')).map(b => drawn(R0, b)); R0.dispose();
  const bad = [];
  pts.forEach((p, i) => { for (const [ox, oy] of [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12], [10, 10], [-10, -10]]) { const r = slide(E, host, n, at, f, { x: p.x + ox, y: p.y + oy }); if (r.got !== 'p' + i) bad.push({ i, ox, oy, got: r.got }); } });
  ok(!bad.length, 'палец рядом со значком (±12 px), 8 пунктов, круг прижат: выбран тот, рядом с которым палец', bad.slice(0, 4));
}

// ── 4. дрожь пальца и отмена ──
{
  const { E, host } = env(844, 390);
  const f = { x: 737, y: 349 }, at = { x: 697, y: 225 };
  let r = slide(E, host, 6, at, f, { x: f.x + 8, y: f.y - 9 });
  ok(r.got === null && r.sticky, 'дрожь пальца (12 px) — ничего не выбрано, круг ждёт нажатия (sticky)', r);
  r = slide(E, host, 6, at, f, { x: f.x + 12, y: f.y - 16 });
  ok(r.got === null && !r.sticky, 'сдвинул на 20 px и отпустил — не выбрано, круг закрыт', r);
  r = slide(E, host, 6, at, f, { x: f.x - 20, y: f.y - 18 });
  ok(r.got === null, 'сдвинулся на 27 px (у нижнего значка) — ещё не выбрано', r);
  const R0 = E.radial(host, {}); R0.open(items(6), at, { from: f }); const cx = parseFloat(R0.el.style.left), cy = parseFloat(R0.el.style.top); R0.dispose();
  r = slide(E, host, 6, at, f, { x: cx + 6, y: cy - 5 });
  ok(r.got === null && !r.sticky, 'отпустил на ✕ в середине круга — отмена (круг закрыт)', r);
  let cancel = 0; const R = E.radial(host, { onCancel: () => cancel++ }); R.open(items(6), at, { from: f, onPick: () => {} }); R.move(cx, cy - 4); R.move(cx + 3, cy); R.up(); R.dispose();
  ok(cancel === 1, 'отмена зовёт onCancel один раз', cancel);
}

// ── 5. ПК: захваченная мышь (lock) — выбор от середины круга, from не мешает ──
{
  const { E, host } = env(1280, 720);
  const R0 = E.radial(host, {}); R0.open(items(6), null, { lock: true }); const pts = [...R0.el.children].filter(c => c.className.startsWith('e2-rad-it')).map(b => drawn(R0, b)); const c = { x: parseFloat(R0.el.style.left), y: parseFloat(R0.el.style.top) }; R0.dispose();
  const bad = [];
  pts.forEach((p, i) => { const r = slide(E, host, 6, null, c, { x: c.x + (p.x - c.x) * .7, y: c.y + (p.y - c.y) * .7 }, 4, { lock: true, from: { x: 5, y: 5 } }); if (r.got !== 'p' + i) bad.push([i, r.got]); });
  ok(!bad.length, 'ПК, мышь захвачена: сдвиг от середины круга к значку — выбран он', bad);
}

// ── 6. слушатели снимаются ──
{
  const { E, host, L } = env(844, 390);
  const n0 = L.length;
  for (let i = 0; i < 20; i++) { const R = E.radial(host, {}); R.open(items(6), null, {}); R.close(); R.dispose(); }
  ok(L.length === n0 && host.children.length === 0, '20 раз создать и убрать круг — слушатели и узлы не копятся', { n0, n: L.length, kids: host.children.length });
}

console.log(fail ? `❌ radial-test: ${fail} из ${pass + fail} не прошли` : `✅ radial-test: ${pass} проверок прошло`);
process.exit(fail ? 1 : 0);
