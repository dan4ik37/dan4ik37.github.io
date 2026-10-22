// ═══════════════════════════════════════
//  «КУБОМИР» — лежанка, сон, вёдра, свиток возврата (T-049, docs/plans/kubomir-modpacks.md §4.5 и §7½: телепорт — расходный
//  предмет, его делают каждый раз)
// ═══════════════════════════════════════
// 🛏 Лежанка (ПКМ): всегда — «дом здесь» (после нокаута и по свитку — сюда; P.ext.home, у каждого игрока свой); ночью и без монстров
// рядом (8 блоков вокруг, 4 по высоте) — сон: экран темнеет 1,2 с, утро, здоровье не меньше 14 из 20; сдвинулся или ударили — проснулся.
// Вместе: спит хозяин и гости — ночь проходит, когда спит половина (D37E.sleep.need; гость шлёт хозяину «zz»). Правила сна — общие
// (js/engine/sleep.js). Лежанку сломали — «Твоя лежанка пропала», дом — начало мира.
// 🪣 Ведро (ПКМ): черпнуть источник воды или лавы (течение не черпается), полное (ПКМ) — вылить в соседнюю клетку (как блок).
// Вместе: у гостя вёдра пока не работают (хозяин не умеет проверять «черпнуть» — следующий шаг, T-049 хвост).
// ✨ Свиток возврата (ПКМ): домой (к лежанке, иначе — в начало мира), свиток исчезает; не сразу после удара (5 с).
(() => {
  const VX = () => window.D37E.vox, E = () => window.D37E;
  window.KubomirX?.feature((st, X) => {
    const g = X.g, P = st.P;
    const f = { id: 'world', title: 'Лежанка, вёдра, свиток', order: 30 };
    let sleep = null, ov = null, voteT = 0, warned = false;
    const home = () => { const h = X.ext('home'); return Number.isFinite(h.x) ? h : null; };
    // ── дом: лежанка цела? (чанк не загружен — верим) ──
    f.home = () => {
      const h = home(); if (!h) return null;
      if (Array.isArray(h.b) && st.W) {
        const v = st.W.raw(h.b[0], h.b[1], h.b[2]);
        if (v >= 0 && (v & 0xfff) !== VX().ID.bed) {
          const o = X.ext('home'); for (const k of Object.keys(o)) delete o[k];
          if (!warned) { warned = true; g.toast?.('🛏 Твоя лежанка пропала — дом теперь в начале мира'); }
          return null;
        }
      }
      return h;
    };
    // ── ПКМ по лежанке ──
    f.useBlock = (hit, b) => {
      if (b.use !== 'bed') return false;
      const V = VX(), up = st.W.raw(hit.x, hit.y + 1, hit.z), up2 = st.W.raw(hit.x, hit.y + 2, hit.z);
      if ((up > 0 && V.T.solid[up & 0xfff]) || (up2 > 0 && V.T.solid[up2 & 0xfff])) { g.toast?.('🛏 Над лежанкой должно быть 2 свободные клетки'); return true; }
      const h = X.ext('home'), was = Array.isArray(h.b) && h.b[0] === hit.x && h.b[1] === hit.y && h.b[2] === hit.z;
      Object.assign(h, { x: hit.x + .5, y: hit.y + 1, z: hit.z + .5, b: [hit.x, hit.y, hit.z] }); warned = false;
      const why = E().sleep.why({ night: !!g.night?.(), monsters: monstersNear() });
      if (why) { g.toast?.(why === 'day' ? (was ? '🛏 Это твой дом. Спать можно только ночью' : '🛏 Дом здесь: после нокаута и по свитку — сюда. Спать — ночью') : E().sleep.TEXT.monsters + (was ? '' : ' (дом — здесь)')); return true; }
      if (sleep) return true;
      sleep = { t: 0, x: P.x, z: P.z, wait: false, hp: P.hp };
      g.sound?.('kb_place', { vol: .3, rate: .7 });
      overlay(true, '💤');
      if (st.coopGuest) st.net?.sleep?.(true);
      return true;
    };
    // монстры рядом: 8 блоков вокруг, 4 по высоте (мирные и «успокоенные» — не считаются; «Мирно» и «Творчество» — никогда)
    function monstersNear(){
      if (st.creative || st.meta?.diff === 'peaceful') return false;
      const M = window.KubomirEnts?.MOBS || {}, L = st.ents?.mobs || [];
      for (let i = 0; i < L.length; i++) { const m = L[i]; if (M[m.type]?.passive || m.calm > 0) continue; if (Math.abs(m.x - P.x) <= 8 && Math.abs(m.z - P.z) <= 8 && Math.abs(m.y - P.y) <= 4) return true; }
      return false;
    }
    function overlay(on, text){
      const host = g.hudEl?.(); if (!host) return;
      if (!ov) { ov = document.createElement('div'); ov.className = 'kx-sleep'; ov.innerHTML = '<b></b>'; host.appendChild(ov); }
      ov.querySelector('b').textContent = text || '';
      void ov.offsetWidth;
      ov.classList.toggle('on', !!on);
    }
    function wake(msg){
      if (!sleep) return;
      const was = sleep; sleep = null;
      overlay(false, msg === 'morning' ? '☀️' : '');
      if (st.coopGuest) st.net?.sleep?.(false);
      if (msg === 'morning') { g.toast?.(E().sleep.TEXT.morning, true); P.hp = Math.max(P.hp, 14); X.emit('wake', was.t); }
      else if (msg) g.toast?.(msg);
    }
    // проспать ночь (хозяин или один): утро, новый день, «Пережил ночь», погода — по дню и часу (KubomirWeather.at) — сама
    function morning(){
      const L = st.R?.lighting; if (!L) return;
      const s = E().sleep.skip(L.time);
      if (s.nextDay) st.meta.day = (st.meta.day || 1) + 1;
      L.time = s.time; if ('_t' in L) L._t = s.time;
      g.unlockNight?.();
      X.emit('sleep', st.meta.day | 0);
    }
    // гость лёг / встал (хозяину): решить, прошла ли ночь
    X.sleepVote = () => { voteT = 0; };
    f.update = dt => {
      if (!sleep) return;
      sleep.t += dt;
      // сдвинулся (больше полублока) или ударили — проснулся
      if (Math.abs(P.x - sleep.x) + Math.abs(P.z - sleep.z) > .5) { wake('🛏 Встал с лежанки'); return; }
      if (P.hp < sleep.hp) { wake('😣 Разбудили!'); return; }
      sleep.hp = P.hp;
      if (!g.night?.()) { wake('morning'); return; }   // утро пришло (у гостя — от хозяина, у хозяина — когда проспали)
      if (sleep.t < 1.2) return;   // экран темнеет
      if (st.coopGuest) { if (!sleep.wait) { sleep.wait = true; overlay(true, '💤 Ждём, когда уснут другие…'); } return; }
      // хозяин или один: сколько спит
      const N = st.net, total = N ? N.players().length : 1, sleepers = 1 + (N?.sleepers?.() || 0), need = E().sleep.need(total, st.meta?.rules?.sleep || 'half');
      if (sleepers >= need) { morning(); wake('morning'); return; }
      if ((voteT -= dt) <= 0) { voteT = 1; overlay(true, '💤 Спят ' + sleepers + ' из ' + total + ' — ночь пройдёт, когда уснёт ' + need); }
    };
    // хозяин не спит, а гостей спит достаточно (правило «один» / «половина»): ночь проходит и так
    f.hud = dt => {
      if (sleep || st.coopGuest || !st.net?.sleepers) return;
      if ((voteT -= dt) > 0) return; voteT = 1;
      const n = st.net.sleepers(); if (!n || !g.night?.()) return;
      const total = st.net.players().length, need = E().sleep.need(total, st.meta?.rules?.sleep || 'half');
      if (n >= need) { morning(); g.toast?.('☀️ Друзья проспали ночь — утро', true); }
    };
    f.dispose = () => { ov?.remove(); ov = null; if (sleep && st.coopGuest) st.net?.sleep?.(false); sleep = null; };

    // ── вещи: ведро, свиток ──
    const hand = which => which === 'off' ? P.off : P.inv[P.sel];
    const setHand = (which, s) => { if (which === 'off') P.off = s; else P.inv[P.sel] = s; };
    // одна вещь из руки → другая (полное ведро ↔ пустое): одна в руке — заменить, стопка — одну отдать в сумку (не влезла — выпала)
    function swapOne(which, toId){
      const s = hand(which); if (!s) return;
      if (s.n <= 1) { setHand(which, { id: toId, n: 1, d: 0 }); return; }
      s.n--;
      const left = g.give?.({ id: toId, n: 1 }) ?? 1;
      if (left > 0) g.spawnItem?.(P.x, P.y + 1, P.z, { id: toId, n: left });
    }
    let useT = -1;
    f.useItem = (s, it, which, hit) => {
      if (!it.use || !['bucket', 'pour', 'recall', 'learn', 'map'].includes(it.use)) return false;
      if (it.use === 'learn' || it.use === 'map') return false;   // книга — kubomir-recipes.js, лист карты — kubomir-map.js
      // ПКМ держат — не повторять каждые 0,22 с (свиток не потратить дважды)
      const t = (st.steps | 0) / 60; if (t - useT < .45) return true; useT = t;
      if (it.use === 'recall') return recall(which);
      if (st.coopGuest) { g.toast?.('🪣 В мире друга вёдра пока не работают'); return true; }
      if (it.use === 'bucket') return scoop(which);
      return pour(which, it, hit);
    };
    // черпнуть: по взгляду до 5 блоков — первый источник жидкости (течение пропускаем, твёрдое — стоп; лёд на озере — стоп)
    function liquidAhead(){
      const V = VX(), W = st.W, e = g.eye?.(), d = g.lookDir?.(); if (!e || !d) return null;
      const ex = e[0], ey = e[1], ez = e[2], dx = d.x, dy = d.y, dz = d.z;
      let lx = NaN, ly = NaN, lz = NaN;
      for (let k = 1; k <= 52; k++) {
        const s = k * .1, x = Math.floor(ex + dx * s), y = Math.floor(ey + dy * s), z = Math.floor(ez + dz * s);
        if (x === lx && y === ly && z === lz) continue; lx = x; ly = y; lz = z;
        const v = W.raw(x, y, z); if (v <= 0) continue;
        const t = v & 0xfff;
        if (V.T.liquid[t]) { if (V.isIce?.(W, x, y, z, v)) return null; if ((v >>> 12) === 0) return { x, y, z, t, lava: V.T.liquid[t] === 2 }; continue; }
        if (V.T.solid[t] || V.blocks[t].shape !== V.SHAPE.cross) return null;
      }
      return null;
    }
    function scoop(which){
      const q = liquidAhead();
      if (!q) { g.toast?.('🪣 Наведи на воду или лаву (на источник, не на течение)'); return true; }
      st.W.set(q.x, q.y, q.z, 0, { urgent: 3 });
      swapOne(which, q.lava ? 'bucket_lava' : 'bucket_water');
      g.sound?.(q.lava ? 'kb_pop' : 'kb_splash', { x: q.x - st.ox + .5, y: q.y + .5, z: q.z - st.oz + .5, vol: .55, rate: q.lava ? .6 : 1.2 });
      if (q.lava) st.ents?.glow?.('ember', q.x + .5, q.y + .8, q.z + .5, 6); else st.ents?.splash?.(q.x + .5, q.y + .9, q.z + .5, .5);
      X.emit('use', 'bucket', q.x, q.y, q.z);
      return true;
    }
    function pour(which, it, hit){
      const V = VX(), W = st.W;
      if (!hit) { g.toast?.('🪣 Наведи на блок, рядом с которым вылить'); return true; }
      let x = hit.x, y = hit.y, z = hit.z;
      const hb = V.blocks[hit.v & 0xfff];
      if (!(hb.replace && !hb.liquid)) { x += hit.nx; y += hit.ny; z += hit.nz; }
      if (y < 1 || y >= V.H - 1) return true;
      const cur = W.raw(x, y, z); if (cur < 0) return true;
      const ct = cur & 0xfff;
      if (cur > 0 && !(V.blocks[ct].replace)) { g.toast?.('🪣 Тут занято — вылей рядом'); return true; }
      if (cur > 0 && V.T.liquid[ct] && (cur >>> 12) === 0) { g.toast?.('🪣 Тут уже полно'); return true; }
      const lid = it.liquid === 'lava' ? V.ID.lava : V.ID.water;
      if (cur > 0 && !V.T.liquid[ct] && V.blocks[ct].drop && V.item(V.blocks[ct].drop) && V.blocks[ct].hard === 0) g.spawnItem?.(x + .5, y + .3, z + .5, { id: V.blocks[ct].drop, n: 1 });   // цветок / трава — выпали
      W.set(x, y, z, V.cell(lid, 0), { urgent: 3 });
      swapOne(which, 'bucket');
      g.sound?.(it.liquid === 'lava' ? 'kb_pop' : 'kb_splash', { x: x - st.ox + .5, y: y + .5, z: z - st.oz + .5, vol: .6, rate: it.liquid === 'lava' ? .5 : 1 });
      if (it.liquid !== 'lava') st.ents?.splash?.(x + .5, y + .5, z + .5, .7);
      X.emit('use', 'pour', x, y, z);
      return true;
    }
    // свиток возврата: домой; расходный (делать каждый раз); не сразу после удара
    function recall(which){
      if ((g.hurtAgo?.() ?? 99) < 5) { g.toast?.('✨ Не сейчас: тебя только что ударили (подожди 5 с)'); return true; }
      const h = f.home() || st.meta?.bed || st.meta?.spawn; if (!h) return true;
      const from = { x: P.x, y: P.y, z: P.z };
      g.take?.(which);
      st.ents?.particles?.('magic', from.x, from.y + 1, from.z, 24);
      g.sound?.('coin', { vol: .5, rate: .7 });
      g.teleport?.(h.x, h.y, h.z);
      g.toast?.('✨ Свиток возврата: ' + (f.home() ? 'ты у своей лежанки' : 'ты в начале мира'), true);
      X.emit('use', 'recall', from.x | 0, from.y | 0, from.z | 0);
      return true;
    }
    f.state = () => ({ sleep: sleep ? { ...sleep } : null, home: home() });
    return f;
  });
})();
