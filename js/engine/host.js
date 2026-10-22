// ═══════════════════════════════════════
//  D37E.host — общий «шов» для помощников игр (T-049, docs/plans/kubomir-modpacks.md §4.0, §3.3)
// ═══════════════════════════════════════
// Помощники (аксессуары, подсказка под прицелом, книга рецептов, карта, сон, задания) пишутся ОДИН раз и подключаются к игре
// через тонкий переходник (у «Кубомира» — js/games/kubomir-x.js; «Подземье» и другие — свой переходник потом). Игра зовёт
// несколько крючков: init / dispose, update (шаг логики), hud (кадр), emit(событие, a, b, c, d) — без мусора: число аргументов
// постоянное, обработчики — массивы, каждый под try/catch. Помощник, который упал, выключается до конца сессии (игра живёт),
// ошибка уходит в мониторинг сайта (d37Err('kx:<id>', e) — без данных игрока).
//   H = D37E.host({ id: 'kubomir', ext: () => объект игрока для помощников, onFail(f, e) })
//   H.register({ id, order, init(H), dispose(H), update(dt), hud(dt), on: { break(x, y, z, b), place(…), … } })
//   H.emit(тип, a, b, c, d) — события игры (имена — общие для игр): break place craft smelt pickup kill eat use sleep wake knockout
//     respawn biome day ach quest inv equip
//   H.ext(id) — свой раздел данных игрока (сохраняется вместе с игроком; «вместе» — у хозяина мира): P.ext[id]
//   H.get(id) — помощник по id; H.alive(id) — не выключен ли; H.stats() — сколько и кто выключен
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const EVENTS = ['break', 'place', 'craft', 'smelt', 'pickup', 'kill', 'eat', 'use', 'sleep', 'wake', 'knockout', 'respawn', 'biome', 'day', 'ach', 'quest', 'inv', 'equip'];

  E.host = function host(adapter = {}){
    const feats = [], byId = new Map(), on = new Map(), dead = new Set();
    for (const ev of EVENTS) on.set(ev, []);
    let inited = false;
    const H = { adapter, feats, events: EVENTS };
    function fail(f, e){
      if (dead.has(f.id)) return;
      dead.add(f.id); f.dead = true;
      try { console.warn('Помощник «' + f.id + '» выключен до конца игры:', e); } catch (er) {}
      try { root.d37Err?.('kx:' + f.id, e); } catch (er) {}
      try { adapter.onFail?.(f, e); } catch (er) {}
      try { f.dispose?.(H); } catch (er) {}
    }
    H.fail = fail;
    H.register = f => {
      if (!f || !f.id || byId.has(f.id)) return null;
      f.order = +f.order || 0;
      feats.push(f); feats.sort((a, b) => a.order - b.order); byId.set(f.id, f);
      for (const ev in f.on || {}) {
        const L = on.get(ev) || (on.set(ev, []), on.get(ev));
        L.push({ f, fn: f.on[ev] }); L.sort((a, b) => a.f.order - b.f.order);
      }
      if (inited) { try { f.init?.(H); } catch (e) { fail(f, e); } }
      return f;
    };
    H.get = id => byId.get(id) || null;
    H.alive = id => byId.has(id) && !dead.has(id);
    // события: без выделения памяти (обычный цикл, постоянное число аргументов)
    H.emit = (type, a, b, c, d) => {
      const L = on.get(type); if (!L || !L.length) return;
      for (let i = 0; i < L.length; i++) { const h = L[i]; if (h.f.dead) continue; try { h.fn(a, b, c, d); } catch (e) { fail(h.f, e); } }
    };
    H.init = () => { if (inited) return; inited = true; for (const f of feats) { if (f.dead) continue; try { f.init?.(H); } catch (e) { fail(f, e); } } };
    H.dispose = () => { for (let i = feats.length - 1; i >= 0; i--) { const f = feats[i]; if (f.dead) continue; try { f.dispose?.(H); } catch (e) { console.warn(e); } } inited = false; };
    H.update = dt => { for (let i = 0; i < feats.length; i++) { const f = feats[i]; if (f.dead || !f.update) continue; try { f.update(dt); } catch (e) { fail(f, e); } } };
    H.hud = dt => { for (let i = 0; i < feats.length; i++) { const f = feats[i]; if (f.dead || !f.hud) continue; try { f.hud(dt); } catch (e) { fail(f, e); } } };
    // свой раздел данных игрока: P.ext[id] (объект; создаётся при первом обращении)
    H.ext = id => { const x = adapter.ext?.(); if (!x) return {}; let o = x[id]; if (!o || typeof o !== 'object' || Array.isArray(o)) o = x[id] = {}; return o; };
    H.stats = () => ({ n: feats.length, dead: [...dead] });
    return H;
  };
  E.host.EVENTS = EVENTS;

  // ── данные игрока для помощников (P.ext): только простые данные, не больше max байт в JSON; лишнее отбрасывается ──
  // Чистит то, что пришло из сохранения или от другого игрока: только объекты/массивы/строки/числа/булевы, глубина ≤ 6,
  // строки ≤ 400 знаков, массивы ≤ 400, ключи — без __proto__/constructor/prototype
  E.host.cleanExt = function cleanExt(x, max = 65536){
    const bad = k => k === '__proto__' || k === 'constructor' || k === 'prototype';
    const walk = (v, d) => {
      if (v == null) return null;
      const t = typeof v;
      if (t === 'number') return Number.isFinite(v) ? v : null;
      if (t === 'boolean') return v;
      if (t === 'string') return v.length > 400 ? v.slice(0, 400) : v;
      if (t !== 'object' || d > 6) return null;
      if (Array.isArray(v)) { const a = []; for (let i = 0; i < v.length && i < 400; i++) a.push(walk(v[i], d + 1)); return a; }
      const o = {}; let n = 0;
      for (const k of Object.keys(v)) { if (bad(k) || k.length > 40 || ++n > 200) continue; const w = walk(v[k], d + 1); if (w !== null && w !== undefined) o[k] = w; }
      return o;
    };
    const o = x && typeof x === 'object' && !Array.isArray(x) ? walk(x, 0) : {};
    try { if (JSON.stringify(o).length > max) { for (const k of Object.keys(o)) { const s = JSON.stringify(o[k]); if (s && s.length > max / 4) delete o[k]; } } } catch (e) { return {}; }
    return o || {};
  };
})();
