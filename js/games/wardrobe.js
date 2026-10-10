// ═══════════════════════════════════════
//  ГАРДЕРОБ 🎭 — #/games/wardrobe: собрать своего персонажа (js/core/avatar.js), части — за монеты (js/core/coins.js)
// ═══════════════════════════════════════
// Нажал на купленную/бесплатную часть — сразу надета. На чужую — примерка: персонаж показывает её, снизу
// «Купить и надеть». Превью живое: персонаж ходит, за ним бегает питомец и тянется след.
(() => {
  let root, api, raf = 0, slot = 'color', trying = null, cv, ctx, offCoins = null, offLook = null, t0 = 0;
  let parts = [], petX = 0, petY = 0, lastEmit = 0;
  const C = () => window.D37Char, W = () => window.D37Coins;
  const num = n => Number(n || 0).toLocaleString('ru');

  function wearing(){ return C().look(); }
  function same(a, b){ return C().SLOTS.every(s => a[s] === b[s]); }

  function render(){
    if (!root) return;
    trying = trying || { ...wearing() };
    const ad = !!window.D37Ads?.rewardReady?.() && W().canAd();
    const authed = typeof currentUser !== 'undefined' && !!currentUser;
    root.innerHTML = `<div class="wr">
        <div class="wr-top">
          <div class="wr-stage"><canvas class="wr-cv"></canvas></div>
          <div class="wr-side">
            <div class="wr-wallet">🪙 <b class="js-coins">${num(W().coins())}</b> <span>монет</span></div>
            <div class="wr-earn">
              ${W().canDaily() ? '<button type="button" class="wr-btn gold" data-act="daily">🎁 Бонус дня</button>' : '<span class="wr-done">🎁 Бонус дня получен</span>'}
              ${ad ? '<button type="button" class="wr-btn" data-act="ad">📺 Реклама → +40 🪙</button>' : ''}
            </div>
            <div class="wr-try" hidden></div>
            <div class="wr-acts"><button type="button" class="wr-btn" data-act="random">🎲 Случайный образ</button><a class="wr-btn" href="#/games/horde">🧟 Играть в «Орду»</a></div>
            <div class="ct-note">Персонаж — твой герой в «Орде» и других играх сайта. Монеты дают за забеги, победы в любых играх, бонус дня и задание дня.${authed ? '' : ' <b>Войди</b> — персонаж и покупки сохранятся в аккаунте на всех устройствах.'}</div>
          </div>
        </div>
        <div class="wr-tabs" role="tablist">${C().SLOTS.map(s => `<button type="button" role="tab" data-tab="${s}" class="${s === slot ? 'active' : ''}">${C().PARTS[s].icon}<span> ${C().PARTS[s].name}</span></button>`).join('')}</div>
        <div class="wr-grid"></div>
      </div>`;
    cv = root.querySelector('.wr-cv'); ctx = cv.getContext('2d');
    size();
    root.querySelector('.wr').addEventListener('click', onClick);
    grid(); tryBar();
    if (!raf) { t0 = performance.now(); raf = requestAnimationFrame(frame); }
  }

  function size(){
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.parentElement.clientWidth || 300, h = 220;
    cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }

  // Карточки частей текущей вкладки: мини-превью на персонаже, цена или «есть»
  function grid(){
    const box = root.querySelector('.wr-grid'), wear = wearing();
    const P = C().PARTS[slot];
    box.innerHTML = P.list.map(([id, name, price, v, vip]) => {
      const own = C().owns(slot, id), on = wear[slot] === id, tr = trying[slot] === id && !on;
      const tag = on ? '<span class="wr-tag on">надето</span>' : own ? '<span class="wr-tag">есть</span>'
        : `<span class="wr-tag price">${vip ? 'VIP · ' : ''}🪙 ${num(price)}</span>`;
      return `<button type="button" class="wr-card${on ? ' on' : ''}${tr ? ' trying' : ''}${own ? '' : ' locked'}" data-part="${id}" title="${name}">
        <canvas width="88" height="88" data-mini="${id}"></canvas><b>${name}</b>${tag}</button>`;
    }).join('');
    box.querySelectorAll('canvas[data-mini]').forEach(c => {
      const id = c.dataset.mini, look = { ...trying, [slot]: id };
      const x = c.getContext('2d');
      if (slot === 'trail') {
        C().draw(x, { ...look, pet: 'none', trail: id }, 44, 82, 58, { t: 0 });
        const e = id === 'none' ? '' : id === 'rainbow' ? '🌈' : C().part('trail', id).v;
        if (e) { x.font = '22px "Segoe UI Emoji","Apple Color Emoji",sans-serif'; x.textAlign = 'center'; x.fillText(e, 16, 70); }
      } else C().draw(x, slot === 'pet' ? look : { ...look, pet: 'none' }, slot === 'pet' ? 54 : 44, 82, 58, { t: 0 });
    });
  }

  // Полоска примерки: что примеряешь, цена, «Купить и надеть»
  function tryBar(msg){
    const bar = root?.querySelector('.wr-try');
    if (!bar) return;
    const wear = wearing();
    const diff = C().SLOTS.filter(s => trying[s] !== wear[s] && !C().owns(s, trying[s]));
    if (!diff.length) { bar.hidden = !msg; bar.innerHTML = msg || ''; return; }
    const s = diff[0], p = C().part(s, trying[s]), have = W().coins();
    const vipFree = p.vip && W().perks();
    bar.hidden = false;
    bar.innerHTML = `<div class="wr-try-t">Примерка: <b>${p.name}</b> (${C().PARTS[s].name.toLowerCase()})</div>
      ${p.vip ? `<div class="wr-try-vip">👑 Для VIP — бесплатно. <a href="/vip" target="_blank" rel="noopener">Как получить VIP</a></div>` : ''}
      <div class="wr-try-row">
        ${vipFree ? '' : `<button type="button" class="wr-btn gold" data-act="buy" data-slot="${s}" data-id="${p.id}"${have < p.price ? ' disabled' : ''}>Купить и надеть · 🪙 ${num(p.price)}</button>`}
        <button type="button" class="wr-btn" data-act="untry">Снять примерку</button>
      </div>
      ${!vipFree && have < p.price ? `<div class="wr-try-need">Не хватает 🪙 ${num(p.price - have)} — сыграй в «Орду» или забери бонус дня.</div>` : ''}`;
  }

  async function onClick(e){
    const tab = e.target.closest('[data-tab]');
    if (tab) { slot = tab.dataset.tab; root.querySelectorAll('.wr-tabs button').forEach(b => b.classList.toggle('active', b === tab)); grid(); return; }
    const card = e.target.closest('[data-part]');
    if (card) {
      const id = card.dataset.part;
      trying = { ...trying, [slot]: id };
      if (C().owns(slot, id)) {   // своё — надеваем сразу (вместе с остальным своим из примерки)
        const r = await C().set({ ...wearing(), [slot]: id });
        if (r && r.ok === false) api.toast('Не сохранилось — попробуй ещё раз');
        api.sfx('move');
      } else api.sfx('tick');
      grid(); tryBar();
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'untry') { trying = { ...wearing() }; grid(); tryBar(); }
    else if (act === 'buy') {
      b.disabled = true;
      const s = b.dataset.slot, id = b.dataset.id;
      const r = await W().buy(`skin:${s}:${id}`);
      if (r?.ok) {
        await C().set({ ...wearing(), [s]: id });
        api.sfx('win'); api.toast(`✅ Куплено и надето: ${C().part(s, id).name}`);
        trying = { ...wearing() };
      } else api.toast(r?.reason === 'coins' ? 'Не хватает монет' : r?.reason === 'auth' ? 'Войди в аккаунт' : 'Не получилось — попробуй ещё раз');
      grid(); tryBar();
    } else if (act === 'random') {
      const L = {};
      for (const s of C().SLOTS) { const own = C().PARTS[s].list.filter(p => C().owns(s, p[0])); L[s] = own[Math.floor(Math.random() * own.length)][0]; }
      await C().set(L); trying = { ...wearing() }; api.sfx('ok'); grid(); tryBar();
    } else if (act === 'daily') {
      b.disabled = true;
      const r = await W().daily();
      if (r?.ok) { api.sfx('win'); api.toast(`🎁 +${r.got} 🪙`); }
      render();
    } else if (act === 'ad') {
      b.disabled = true;
      const ok = await window.D37Ads.showReward('coins');
      if (ok) { const r = await W().adCoins(); if (r?.ok) { api.sfx('win'); api.toast(`📺 +${r.got} 🪙 — спасибо!`); } else api.toast(r?.reason === 'day_cap' ? 'На сегодня награды за рекламу кончились' : 'Подожди минутку и попробуй снова'); }
      else api.toast('Реклама не досмотрена — монет нет');
      render();
    }
  }

  // ── Живое превью: ходит туда-сюда, питомец догоняет, след ──
  function frame(now){
    raf = requestAnimationFrame(frame);
    if (!ctx || !cv) return;
    const t = (now - t0) / 1000, W2 = cv.width, H2 = cv.height, k = H2 / 220;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W2, H2);
    const g = ctx.createRadialGradient(W2 / 2, H2 * .7, 10, W2 / 2, H2 * .7, W2 * .6);
    g.addColorStop(0, 'rgba(155,109,255,.25)'); g.addColorStop(1, 'rgba(155,109,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W2, H2);
    ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(0, H2 * .86, W2, 2 * k);
    const span = Math.min(W2 * .3, 140 * k), x = W2 / 2 + Math.sin(t * .7) * span, dir = Math.cos(t * .7) >= 0 ? 1 : -1, y = H2 * .86;
    const look = trying || wearing();
    // след
    const tr = C().trail(look);
    if (tr && now - lastEmit > 70) { lastEmit = now; parts.push({ x: x - dir * 18 * k, y: y - (10 + Math.random() * 30) * k, t: 0.9, e: tr, c: `hsl(${(t * 200) % 360},90%,60%)` }); }
    parts = parts.filter(p => (p.t -= 1 / 60) > 0);
    for (const p of parts) {
      ctx.globalAlpha = Math.max(0, p.t);
      if (p.e === 'rainbow') { ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y + 10 * k, 7 * k * p.t, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.font = `${Math.round(16 * k)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.fillText(p.e, p.x, p.y - (0.9 - p.t) * 20 * k); }
    }
    ctx.globalAlpha = 1;
    // питомец догоняет
    const pet = C().petEmoji(look);
    if (pet) {
      const tx = x - dir * 70 * k, ty = y - 20 * k + Math.sin(t * 6) * 4 * k;
      petX += (tx - petX) * .06; petY += (ty - petY) * .1;
      ctx.font = `${Math.round(34 * k)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(pet, petX, petY);
    }
    C().draw(ctx, look, x, y, 150 * k, { t, dir, noPet: true, squash: Math.sin(t * 9) * .025 });
  }

  window.GAME_IMPL.wardrobe = {
    mount(el, gameApi){
      root = el; api = gameApi; trying = null; parts = [];
      render();
      offCoins = W().on(() => { const w = root?.querySelector('.wr-wallet .js-coins'); if (w) w.textContent = num(W().coins()); });
      offLook = C().on(() => { if (root) { trying = { ...wearing() }; grid(); tryBar(); } });
      W().sync().then(() => { if (root) { trying = { ...wearing() }; render(); } });
      window.addEventListener('resize', size);
    },
    unmount(){
      cancelAnimationFrame(raf); raf = 0;
      offCoins?.(); offLook?.(); offCoins = offLook = null;
      window.removeEventListener('resize', size);
      root = null; cv = null; ctx = null;
    },
  };
})();
