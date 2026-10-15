// Проверка логики «Кубомира» в браузере — один проход по системам выживания (pass 3, 16.10.2026).
// Как запустить: открыть мир «Выживание» (#/games/kubomir), вставить этот файл в консоль (во встроенном браузере — через
// javascript_tool; сначала подменить requestAnimationFrame на setTimeout и document.hidden на false — см. CLAUDE.md).
// Мир правится: площадка 9×9 из камня под игроком, вещи игрока очищаются. Итог — список «✓ / ✗» (и в window.__kbqa).
(async () => {
  const T = GAME_IMPL.kubomir._test, wait = ms => new Promise(r => setTimeout(r, ms));
  const st = T.state(); if (!st || st.creative) return console.warn('Нужен открытый мир «Выживание»');
  const V = D37E.vox, W = st.W, P = st.P, R = window.__kbqa = [];
  const ok = (c, m, x) => R.push((c ? '✓ ' : '✗ ') + m + (c ? '' : ' ' + JSON.stringify(x ?? '').slice(0, 160)));
  const inv = id => P.inv.reduce((a, s) => a + (s && s.id === id ? s.n : 0), 0);
  const sel = id => { const i = P.inv.findIndex(s => s && s.id === id); if (i >= 9) { const t = P.inv[i]; P.inv[i] = P.inv[0]; P.inv[0] = t; P.sel = 0; } else P.sel = i; };
  const click = (q, shift) => { document.querySelector(q)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0, shiftKey: !!shift })); document.querySelector('.kb-inv')?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0 })); };
  const book = (out, shift) => { const b = st.ui.book(), j = b.findIndex(x => x.r.out === out || (out instanceof RegExp && out.test(x.r.out))); if (j >= 0) click(`[data-k="book"][data-i="${j}"]`, shift); return j >= 0; };
  const tick = s => { for (let i = 0; i < s * 20; i++) st.ents.tick(1 / 20); };
  st.meta.diff = 'peaceful'; P.inv.fill(null); P.fly = false; P.food = 20; P.hp = 20;
  const x0 = Math.floor(P.x), z0 = Math.floor(P.z), gy = Math.max(W.heightAt(x0, z0), Math.floor(P.y));
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) { W.set(x0 + dx, gy - 1, z0 + dz, V.ID.stone); for (let y = gy; y < gy + 4; y++) W.set(x0 + dx, y, z0 + dz, 0); }
  Object.assign(P, { x: x0 + .5, y: gy, z: z0 + .5, vx: 0, vy: 0, vz: 0 }); await wait(1000);
  const aimDo = async (x, y, z, act) => { T.aim(x, y, z); await wait(250); const h = st.hit; act(); await wait(250); return h; };
  // копать: рукой камень не выпадает, киркой — выпадает
  T.give({ id: 'cobble', n: 1 }); sel('cobble');
  await aimDo(x0 + 2.5, gy - .02, z0 + .5, () => T.use());
  ok(W.get(x0 + 2, gy, z0) === V.ID.cobble && inv('cobble') === 0, 'поставить блок');
  await aimDo(x0 + 2.5, gy + .5, z0 + .5, () => T.dig()); P.x = x0 + 2.3; await wait(900);
  ok(W.get(x0 + 2, gy, z0) === 0 && inv('cobble') === 0, 'булыжник рукой — сломан, но не выпал (нужна кирка)');
  P.x = x0 + .5; await wait(300);
  // крафт через «📖 Можно сделать»
  T.give({ id: 'log_oak', n: 4 }); st.ui.open('inv'); await wait(100);
  book(/^planks/, true); await wait(100);
  ok(inv('planks_oak') === 16, 'бревна → доски (книга + Shift по результату)', inv('planks_oak'));
  book('crafting_table'); click('[data-k="result"]', true); await wait(100); st.ui.close(); await wait(100);
  ok(inv('crafting_table') === 1, 'верстак из книги');
  sel('crafting_table'); await aimDo(x0 - 1.5, gy - .02, z0 + .5, () => T.use());
  sel('planks_oak'); await aimDo(x0 - 1.5, gy + .5, z0 + .5, () => T.use());
  ok(st.ui.kind === 'craft', 'верстак: окно 3×3', st.ui.kind);
  book('stick'); click('[data-k="result"]', true); await wait(100); book('pick_wood'); click('[data-k="result"]'); await wait(100); st.ui.close(); await wait(100);
  ok(inv('pick_wood') === 1, 'деревянная кирка на верстаке');
  sel('pick_wood'); await aimDo(x0 + 2.5, gy - .5, z0 + .5, () => T.dig()); Object.assign(P, { x: x0 + 2.5, y: gy - 1 }); await wait(900);   // в яму за булыжником
  ok(inv('cobble') === 1, 'киркой — булыжник выпал и подобрался'); Object.assign(P, { x: x0 + .5, y: gy }); W.set(x0 + 2, gy - 1, z0, V.ID.stone); await wait(300);
  // печь: Shift+клик раскладывает руду и топливо, 2 слитка за 14 с, сломал — всё выпало
  T.give({ id: 'cobble', n: 7 }); sel('planks_oak'); await aimDo(x0 - 1.5, gy + .5, z0 + .5, () => T.use());
  book('furnace'); click('[data-k="result"]', true); await wait(100); st.ui.close(); await wait(100);
  ok(inv('furnace') === 1, 'печь из 8 булыжников');
  sel('furnace'); const fh = await aimDo(x0 + .5, gy - .02, z0 - 1.5, () => T.use()); const fp = fh ? [fh.x + (fh.nx || 0), fh.y + (fh.ny || 0), fh.z + (fh.nz || 0)] : [x0, gy, z0 - 2];
  T.give({ id: 'ore_iron', n: 2 }); T.give({ id: 'coal', n: 1 }); sel('ore_iron');
  await aimDo(fp[0] + .5, fp[1] + .5, fp[2] + .5, () => T.use());
  ok(st.ui.kind === 'furnace', 'печь: окно');
  click(`[data-k="inv"][data-i="${P.inv.findIndex(s => s && s.id === 'ore_iron')}"]`, true); await wait(60);
  click(`[data-k="inv"][data-i="${P.inv.findIndex(s => s && s.id === 'coal')}"]`, true); await wait(60); st.ui.close();
  tick(14);
  const ft = W.tile(fp[0], fp[1], fp[2]);
  ok(ft?.out?.id === 'iron_ingot' && ft.out.n === 2, 'печь: 2 слитка за 14 с', ft);
  // сундук: Shift+клик, ⇅, сломал — содержимое выпало
  T.give({ id: 'chest', n: 1 }); T.give({ id: 'apple', n: 3 }); sel('chest');
  const ch = await aimDo(x0 + 2.5, gy - .02, z0 + 2.5, () => T.use()); const cp = ch ? [ch.x + (ch.nx || 0), ch.y + (ch.ny || 0), ch.z + (ch.nz || 0)] : [x0 + 2, gy, z0 + 2];
  await aimDo(cp[0] + .5, cp[1] + .4, cp[2] + .5, () => T.use());
  ok(st.ui.kind === 'chest', 'сундук: окно');
  click(`[data-k="inv"][data-i="${P.inv.findIndex(s => s && s.id === 'apple')}"]`, true); await wait(60); st.ui.close(); await wait(60);
  ok(W.tile(cp[0], cp[1], cp[2])?.items?.some(s => s && s.id === 'apple'), 'сундук: яблоки внутри');
  // дверь: две половины, ПКМ — открыть обе, сломал верх — ушла вся
  T.give({ id: 'door', n: 1 }); sel('door');
  const dh = await aimDo(x0 - 1.5, gy - .02, z0 - 1.5, () => T.use()); const dp = dh ? [dh.x + (dh.nx || 0), dh.y + (dh.ny || 0), dh.z + (dh.nz || 0)] : [x0 - 2, gy, z0 - 2];
  const d0 = W.raw(...dp), d1 = W.raw(dp[0], dp[1] + 1, dp[2]);
  ok((d0 & 0xfff) === V.ID.door_oak && (d1 & 0xfff) === V.ID.door_oak, 'дверь: две половины');
  await aimDo(dp[0] + .5, dp[1] + .5, dp[2] + .5, () => T.use());
  ok(((W.raw(...dp) >>> 12) & 4) !== ((d0 >>> 12) & 4) && ((W.raw(dp[0], dp[1] + 1, dp[2]) >>> 12) & 4) !== ((d1 >>> 12) & 4), 'дверь: открылись обе половины');
  sel('pick_wood'); await aimDo(dp[0] + .5, dp[1] + 1.5, dp[2] + .5, () => T.dig());
  ok(W.get(...dp) === 0 && W.get(dp[0], dp[1] + 1, dp[2]) === 0, 'дверь: сломал верх — ушли обе');
  // вода и лава
  const wx = x0 - 3, wz = z0 + 3; W.set(wx, gy, wz, V.ID.water); tick(4);
  let wet = 0; for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (W.get(wx + dx, gy, wz + dz) === V.ID.water) wet++;
  ok(wet > 3, 'вода растеклась', wet);
  W.set(wx, gy, wz, 0); tick(10); wet = 0; for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) if (W.get(wx + dx, gy, wz + dz) === V.ID.water) wet++;
  ok(wet === 0, 'без источника — высохла', wet);
  W.set(x0 + 3, gy, z0 - 3, V.ID.lava); W.set(x0 + 4, gy, z0 - 3, V.ID.water); tick(3);
  ok([V.ID.obsidian, V.ID.cobble].includes(W.get(x0 + 3, gy, z0 - 3)), 'лава + вода → обсидиан / булыжник');
  // ночь: только по часам игры (не /time) и без смерти
  st.R.lighting.time = 18.97; await wait(2500); st.R.lighting.time = 5.47; await wait(3000);
  ok(!!(st.meta.ach || {}).night, 'сумерки → рассвет по часам — «Пережил ночь»');
  console.log(R.join('\n'));
  return R;
})();
