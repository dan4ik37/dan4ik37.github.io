// ═══════════════════════════════════════
//  РЕДАКТОР 3D-ПЕРСОНАЖА 🎭 — части тела и одежды, как в Роблоксе, + палитра на каждую часть, как в китайских играх
// ═══════════════════════════════════════
// D37Editor.mount(el, { api, onClose, key }) → Promise<boolean> (false — нет WebGL/Three.js, тогда гардероб остаётся 2D).
// Витрина — World3D.preview (крутится пальцем; нажатие на часть тела — раздел «Части» с этой частью, она подсвечена;
// кнопки: повернуть, пройтись, эмоции по кругу, случайный образ, отменить). Разделы → вкладки → карточки с картинками
// (thumb рисует тот же 3D-человечек) и палитры: готовые цвета + «🎨 свой» (квадрат насыщенность/яркость, полоска оттенка,
// #код). «Части»: голова, туловище, руки и ноги по отдельности — форма (пакеты: классика, стройный, силач, робот, рыцарь)
// и цвет части; «🪞 Зеркально» — левая и правая вместе, «Сбросить» — часть как была, «Случайно», «Отменить».
// Своё/бесплатное надевается сразу (D37Char.set → char_save), платное — примерка с «Купить и надеть» (D37Coins.buy; часть
// из пакета — покупается пакет, один раз на все его части), вещи только за 💎 — ссылка в магазин #/shop. Пока тянут
// палитру — меняется только витрина (recolor без пересборки), сохраняем после отпускания. Используется в гардеробе
// (#/games/wardrobe) и окном внутри «Мира Денчика».
(() => {
  const C = () => window.D37Char, W = () => window.D37Coins;
  const num = n => Number(n || 0).toLocaleString('ru');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TS = 144;   // размер картинки варианта (в CSS — 72 px)
  // Разделы и вкладки: slot — что выбираем, view — куда смотрит камера, colors — палитры под карточками; parts — части тела
  const CATS = [
    { id: 'body', icon: '🧍', name: 'Тело', subs: [
      { slot: 'body', name: 'Фигура', view: 'full' },
      { name: 'Кожа', view: 'top', colors: ['tone'] },
      { name: 'Пропорции', view: 'full', sliders: ['hgt', 'wid', 'head'] },
    ] },
    { id: 'parts', icon: '🦾', name: 'Части', title: 'Части тела', subs: [{ parts: 1, name: 'Части тела' }] },
    { id: 'face', icon: '🙂', name: 'Лицо', subs: [
      { slot: 'face', name: 'Стиль', view: 'head' },
      { slot: 'eyes', name: 'Глаза', view: 'head', colors: ['eyec'] },
      { slot: 'brows', name: 'Брови', view: 'head' },
      { slot: 'lash', name: 'Ресницы', view: 'head' },
      { slot: 'mouth', name: 'Рот', view: 'head' },
      { slot: 'cheek', name: 'Щёчки', view: 'head' },
    ] },
    { id: 'hair', icon: '💇', name: 'Волосы', subs: [{ slot: 'hair', name: 'Причёска', view: 'head', colors: ['hairc'] }] },
    { id: 'wear', icon: '👕', name: 'Одежда', subs: [
      { slot: 'top', name: 'Верх', view: 'top', colors: ['color', 'trim'] },
      { slot: 'bottom', name: 'Низ', view: 'legs', colors: ['botc'] },
      { slot: 'shoes', name: 'Обувь', view: 'feet', colors: ['shoec'] },
    ] },
    { id: 'acc', icon: '🎩', name: 'Аксессуары', subs: [
      { slot: 'hat', name: 'Шапка', view: 'hat', colors: ['hatc'] },
      { slot: 'glasses', name: 'Очки', view: 'head', colors: ['glassc'] },
      { slot: 'neck', name: 'На шее', view: 'top', colors: ['neckc'] },
      { slot: 'back', name: 'На спине', view: 'back', colors: ['backc'] },
      { slot: 'glove', name: 'На руках', view: 'armR', colors: ['glovec'] },
      { slot: 'item', name: 'В руке', view: 'full' },
    ] },
    { id: 'pet', icon: '🐾', name: 'Питомец', subs: [{ slot: 'pet', name: 'Питомец', view: 'full' }, { slot: 'trail', name: 'След', view: 'full' }] },
  ];
  const EMOJI_SLOTS = new Set(['item', 'pet', 'trail']);
  // Части тела: кнопки, куда смотрит камера, пары левая ↔ правая (для «зеркально»)
  const PART_UI = [['head', 'Голова', '🙂'], ['torso', 'Туловище', '👕'], ['armL', 'Л. рука', '💪'], ['armR', 'П. рука', '💪'], ['legL', 'Л. нога', '🦵'], ['legR', 'П. нога', '🦵']];
  const MSLOT = { psal: 'psar', psar: 'psal', psll: 'pslr', pslr: 'psll', pcal: 'pcar', pcar: 'pcal', pcll: 'pclr', pclr: 'pcll' };
  const LIMBS = ['pst', 'psal', 'psar', 'psll', 'pslr'], PCS = ['pch', 'pct', 'pcal', 'pcar', 'pcll', 'pclr'];
  // Как выглядят особые материалы на кружке палитры
  const FX_BG = {
    rainbow: 'conic-gradient(#ff4d6d,#ffcc33,#34c759,#22c7b8,#4f8df7,#9b6dff,#ff4d6d)',
    galaxy: 'radial-gradient(circle at 30% 30%,#fff 0 1px,transparent 2px),radial-gradient(circle at 70% 60%,#ffd6ff 0 1px,transparent 2px),linear-gradient(135deg,#2b1f7a,#4a2a9c,#1b1450)',
    gold: 'linear-gradient(135deg,#fff3c4,#f2b91e 45%,#a86b05)', goldskin: 'linear-gradient(135deg,#fff3c4,#f2b91e 45%,#a86b05)',
    neon: 'radial-gradient(circle,#fff 0 20%,#ff4fd8 60%)', glow: 'radial-gradient(circle,#fff 0 20%,#5ef2ff 60%)', fire: 'radial-gradient(circle,#fff3b0 0 20%,#ff7a1a 60%)',
  };
  const EMOS = () => window.World3D?.EMOTES || ['👋', '💃'];
  let st = null;
  const readMirror = () => { try { return localStorage.getItem('d37_ce_mirror') !== '0'; } catch (e) { return true; } };

  function myKey(){
    if (typeof currentUser !== 'undefined' && currentUser?.id) return 'u:' + currentUser.id;
    let id = '';
    try { id = sessionStorage.getItem('d37_room_gid') || ''; } catch (e) {}
    if (!id) { id = 'g-' + Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem('d37_room_gid', id); } catch (e) {} }
    return 'g:' + id;
  }
  // Не выбранные части человечка — как его видят в мире (по отпечатку ключа), чтобы правка одной части не меняла другие
  function materialize(look, key){
    const L = { ...look }, R = window.World3D.resolve(look, key);
    for (const s of C().BODY_SLOTS) if (L[s] === undefined && R[s] !== undefined) L[s] = R[s];
    return L;
  }
  const toast = t => st?.opts.api?.toast?.(t);
  const sfx = k => st?.opts.api?.sfx?.(k);
  const curSub = () => { const c = CATS.find(x => x.id === st.cat); return c.subs[Math.min(st.sub, c.subs.length - 1)]; };

  async function mount(el, opts = {}){
    unmount();
    const s = st = { el, opts, key: opts.key || myKey(), cat: 'body', sub: 0, trying: null, pv: null, pending: 0, offCoins: null, offLook: null, saving: 0,
      part: 'armL', mirror: readMirror(), hist: [], snap: null, emo: 0 };
    el.innerHTML = '<div class="ce-wait">🎭 Загружаем 3D-персонажа…</div>';
    const ok = !!window.World3D?.supported() && await window.World3D.load();
    if (st !== s) return false;
    if (!ok) { el.innerHTML = ''; st = null; return false; }
    render();
    s.offCoins = W()?.on(() => { if (st === s) { s.el.querySelectorAll('.ce-wallet b').forEach(b => { b.textContent = num(W().coins()); }); tryBar(); } });
    s.offLook = C().on(() => { if (st === s && !s.saving) { s.trying = materialize({ ...C().look(), ...unowned() }, s.key); updatePreview(true); refresh(); } });
    W()?.sync?.().then(() => { if (st === s) { refresh(); earn(); } });
    return true;
  }
  function unmount(){
    const s = st;
    if (!s) return;
    st = null;
    cancelAnimationFrame(s.pending);
    s.offCoins?.(); s.offLook?.();
    try { s.pv?.dispose(); } catch (e) {}
    s.el.innerHTML = '';
  }
  // Примеряемое, чего ещё нет (оставляем при обновлении надетого)
  function unowned(){
    const out = {};
    if (!st?.trying) return out;
    for (const sl of C().SLOTS) { const v = st.trying[sl]; if (v !== undefined && !C().owns(sl, v)) out[sl] = v; }
    return out;
  }
  // Что купить для примерки: часть или её пакет (один на все части пакета); вещи за 💎 — отдельно
  function toBuy(){
    const map = new Map();
    for (const [sl, id] of Object.entries(unowned())) {
      const b = C().buyItem ? C().buyItem(sl, id) : { item: `skin:${sl}:${id}`, ...C().part(sl, id) };
      if (!b) continue;
      if (map.has(b.item)) map.get(b.item).slots.push(sl); else map.set(b.item, { ...b, slots: [sl] });
    }
    return [...map.values()];
  }

  function render(){
    const s = st;
    s.trying = materialize(C().look(), s.key);
    s.el.innerHTML = `<div class="ce">
      <div class="ce-stage">
        <div class="ce-view"></div>
        <div class="ce-top">
          <span class="ce-wallet" title="Монеты — за игры, бонус дня и задания">🪙 <b>${num(W()?.coins())}</b></span>
          ${s.opts.onClose ? '<button type="button" class="ce-done" data-act="close">✓ Готово</button>' : ''}
        </div>
        <canvas class="ce-2d" width="128" height="128" title="Так ты выглядишь в 2D-играх (Орда и другие)"></canvas>
        <div class="ce-tools">
          <button type="button" data-act="rot" data-d="-1" title="Повернуть" aria-label="Повернуть влево">⟲</button>
          <button type="button" data-act="walk" title="Пройтись" aria-label="Пройтись">🚶</button>
          <button type="button" data-act="emonext" title="Эмоции по очереди" aria-label="Эмоция">${EMOS()[0]}</button>
          <button type="button" data-act="random" title="Случайный образ" aria-label="Случайный образ">🎲</button>
          <button type="button" data-act="undo" title="Отменить" aria-label="Отменить" disabled>↩</button>
          <button type="button" data-act="rot" data-d="1" title="Повернуть" aria-label="Повернуть вправо">⟳</button>
        </div>
      </div>
      <div class="ce-panel">
        <div class="ce-cats" role="tablist">${CATS.map(c => `<button type="button" role="tab" data-cat="${c.id}" class="${c.id === s.cat ? 'on' : ''}" title="${esc(c.title || c.name)}"><i>${c.icon}</i><span>${c.name}</span></button>`).join('')}</div>
        <div class="ce-subs"></div>
        <div class="ce-try" hidden></div>
        <div class="ce-body"></div>
        <div class="ce-earn"></div>
      </div>
    </div>`;
    s.pv = window.World3D.preview(s.el.querySelector('.ce-view'), { key: s.key });
    s.pv.set(s.trying, s.key);
    s.pv.onPick?.(p => selectPart(p));   // нажал на часть тела на витрине
    const root = s.el.querySelector('.ce');
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    renderSubs(); renderBody(); tryBar(); earn(); draw2d();
  }

  function renderSubs(){
    const c = CATS.find(x => x.id === st.cat), box = st.el.querySelector('.ce-subs');
    box.hidden = c.subs.length < 2;
    box.innerHTML = c.subs.map((sb, i) => `<button type="button" data-sub="${i}" class="${i === st.sub ? 'on' : ''}">${sb.name}</button>`).join('');
  }
  function renderBody(){
    const s = st, sb = curSub(), box = s.el.querySelector('.ce-body');
    if (sb.parts) { renderParts(); return; }
    s.pv.highlight?.(null);
    s.pv.focus(sb.view || 'full');
    let html = '';
    if (sb.sliders) html += sb.sliders.map(slider).join('');
    if (sb.slot) html += `<div class="ce-grid" data-grid="${sb.slot}">${cards(sb.slot)}</div>`;
    for (const cs of sb.colors || []) html += palette(cs);
    box.innerHTML = html;
    box.scrollTop = 0;
    thumbs();
    box.querySelectorAll('.ce-pick').forEach(initPicker);
  }
  // ── Части тела: голова, туловище, руки и ноги по отдельности ──
  const partSlots = p => C().BODY_PARTS?.[p] || ['psh', 'pch', ''];
  function renderParts(){
    const s = st, box = s.el.querySelector('.ce-body'), [shs, cls] = partSlots(s.part);
    s.pv.focus(s.part);
    s.pv.highlight?.(s.part);
    box.innerHTML = `<div class="ce-parts">${PART_UI.map(([id, name, icon]) => `<button type="button" data-part="${id}" class="${id === s.part ? 'on' : ''}" title="${esc(name)}"><i>${icon}</i><span>${esc(name)}</span></button>`).join('')}</div>
      <div class="ce-ptools">
        <button type="button" data-act="mirror" class="${s.mirror ? 'on' : ''}" title="Левая и правая рука (нога) — одинаковые">🪞 Зеркально</button>
        <button type="button" data-act="resetpart" title="Форма и цвет части — как было">♻ Сбросить</button>
        <button type="button" data-act="randparts" title="Случайные формы и цвета частей">🎲 Случайно</button>
        <button type="button" data-act="undo" title="Отменить последнее"${s.hist.length ? '' : ' disabled'}>↩ Отменить</button>
      </div>
      <div class="ce-phint">Нажми на часть тела на витрине или выбери выше. Пакет (силач, робот, рыцарь) покупается один раз — все его части твои, носи вперемешку.</div>
      <div class="ce-grid" data-grid="${shs}">${cards(shs)}</div>
      ${palette(cls)}`;
    box.scrollTop = 0;
    thumbs();
    box.querySelectorAll('.ce-pick').forEach(initPicker);
  }
  function selectPart(p){
    const s = st;
    if (!s || !partSlots(p)[2]) return;
    s.part = p;
    if (s.cat !== 'parts') { s.cat = 'parts'; s.sub = 0; s.el.querySelectorAll('.ce-cats button').forEach(b => b.classList.toggle('on', b.dataset.cat === 'parts')); renderSubs(); }
    renderBody(); sfx('tick');
  }
  // Картинки вариантов текущей вкладки (тот же человечек с этой частью; «зеркально» — сразу обе стороны)
  function thumbs(){
    const s = st, sb = curSub(), slot = sb.parts ? partSlots(s.part)[0] : sb.slot;
    if (!slot || EMOJI_SLOTS.has(slot)) return;
    const view = sb.parts ? s.part : sb.view;
    s.el.querySelectorAll('.ce-grid canvas[data-thumb]').forEach(cv => {
      const L = { ...s.trying, [slot]: cv.dataset.thumb };
      if (sb.parts && s.mirror && MSLOT[slot]) L[MSLOT[slot]] = cv.dataset.thumb;
      s.pv.thumb(L, s.key, view, cv);
    });
  }
  function tag(slot, id){
    const wear = C().look()[slot] === id, own = C().owns(slot, id), b = C().buyItem ? C().buyItem(slot, id) : C().part(slot, id);
    if (wear) return '<i class="ce-tag on">надето</i>';
    if (own) return b.price ? '<i class="ce-tag">есть</i>' : b.lvl ? `<i class="ce-tag">ур. ${b.lvl}</i>` : '';
    if (b.gems) return `<i class="ce-tag price gem" title="Только за кристаллы — в магазине">💎 ${num(b.gems)}</i>`;
    if (b.lvl) return `<i class="ce-tag price" title="Награда за ${b.lvl} уровень — бесплатно, не продаётся">🔒 ур. ${b.lvl}</i>`;
    return `<i class="ce-tag price">${b.vip ? 'VIP · ' : ''}🪙 ${num(b.price)}${b.pack ? ' · пакет' : ''}</i>`;
  }
  function cards(slot){
    const tr = st.trying;
    return C().PARTS[slot].list.map(([id, name, , v]) => {
      const own = C().owns(slot, id), on = tr[slot] === id;
      const pic = EMOJI_SLOTS.has(slot) ? `<span class="ce-emo">${v || '🚫'}</span>` : `<canvas data-thumb="${id}" width="${TS}" height="${TS}"></canvas>`;
      return `<button type="button" class="ce-card${on ? ' on' : ''}${own ? '' : ' locked'}" data-slot="${slot}" data-id="${id}" title="${esc(name)}">${pic}<b>${esc(name)}</b>${tag(slot, id)}</button>`;
    }).join('');
  }
  function slider(slot){
    const P = C().PARTS[slot], v = Math.max(0, Math.min(4, +(st.trying[slot] ?? 2) || 0));
    return `<label class="ce-sl"><span>${P.icon} ${esc(P.name)}: <b data-sl="${slot}">${esc(P.list[v][1])}</b></span>
      <input type="range" min="0" max="4" step="1" value="${v}" data-range="${slot}" aria-label="${esc(P.name)}"></label>`;
  }
  const hexOf = slot => { const p = C().part(slot, st.trying[slot]); return p?.v && p.v[0] === '#' ? p.v : '#888888'; };
  function swatchStyle(id, v){ return FX_BG[id] ? `background:${FX_BG[id]}` : v && v[0] === '#' ? `background:${v}` : ''; }
  function palette(slot){
    const P = C().PARTS[slot], cur = st.trying[slot], custom = C().custom(slot, cur), p = C().part(slot, cur);
    const sws = P.list.map(([id, name, price, v, vip]) => {
      const own = C().owns(slot, id);
      return `<button type="button" class="ce-sw${cur === id ? ' on' : ''}${own ? '' : ' locked'}${id === 'auto' ? ' auto' : ''}" data-slot="${slot}" data-id="${id}" title="${esc(name)}${own ? '' : ` · ${vip ? 'VIP · ' : ''}🪙 ${num(price)}`}" style="${swatchStyle(id, v)}">${id === 'auto' ? '↺' : ''}${own ? '' : '<i>🔒</i>'}</button>`;
    }).join('');
    return `<div class="ce-pal" data-pal="${slot}">
      <div class="ce-pal-h"><b>${esc(slot === 'color' ? 'Цвет одежды' : P.name)}</b><span class="ce-pal-cur" style="${swatchStyle(p?.id, p?.v)}"></span><span class="ce-pal-name">${esc(custom ? 'Свой цвет ' + p.v : p?.name || '')}</span></div>
      <div class="ce-sws">${sws}<button type="button" class="ce-sw ce-sw-custom${custom ? ' on' : ''}" data-act="pick" data-slot="${slot}" title="Свой цвет — любой">🎨</button></div>
      <div class="ce-pick" data-slot="${slot}"${custom ? '' : ' hidden'}>
        <canvas class="ce-sv" width="300" height="130" aria-label="Насыщенность и яркость"></canvas>
        <canvas class="ce-hue" width="300" height="16" aria-label="Оттенок"></canvas>
        <div class="ce-hexrow"><span class="ce-hexsw" style="background:${hexOf(slot)}"></span><input class="ce-hex" maxlength="7" value="${hexOf(slot)}" aria-label="Код цвета" spellcheck="false"><span class="ce-hint">тяни по квадрату и полоске</span></div>
      </div>
    </div>`;
  }

  // ── Свой цвет: квадрат насыщенность/яркость + полоска оттенка + #код ──
  function hex2hsv(hex){
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
  }
  function hsv2hex(h, s, v){
    const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  }
  function initPicker(box){
    const slot = box.dataset.slot, sv = box.querySelector('.ce-sv'), hue = box.querySelector('.ce-hue'), inp = box.querySelector('.ce-hex'), sw = box.querySelector('.ce-hexsw');
    let [h, s, v] = hex2hsv(hexOf(slot));
    const drawSV = () => {
      const g = sv.getContext('2d'), w = sv.width, H = sv.height;
      g.fillStyle = `hsl(${h},100%,50%)`; g.fillRect(0, 0, w, H);
      const wg = g.createLinearGradient(0, 0, w, 0); wg.addColorStop(0, '#fff'); wg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = wg; g.fillRect(0, 0, w, H);
      const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(1, '#000'); g.fillStyle = bg; g.fillRect(0, 0, w, H);
      const x = s * w, y = (1 - v) * H;
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 2; g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.stroke();
    };
    const drawHue = () => {
      const g = hue.getContext('2d'), w = hue.width, H = hue.height, gr = g.createLinearGradient(0, 0, w, 0);
      for (let i = 0; i <= 6; i++) gr.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
      g.fillStyle = gr; g.fillRect(0, 0, w, H);
      const x = h / 360 * w; g.fillStyle = '#fff'; g.fillRect(x - 3, 0, 6, H); g.strokeStyle = 'rgba(0,0,0,.5)'; g.strokeRect(x - 3.5, .5, 7, H - 1);
    };
    drawSV(); drawHue();
    const apply = final => { const hex = hsv2hex(h, s, v); inp.value = hex; sw.style.background = hex; setPart(slot, 'x' + hex.slice(1), { live: !final, keepPicker: true }); };
    drag(sv, (x, y) => { s = x; v = 1 - y; drawSV(); apply(false); }, () => apply(true));
    drag(hue, x => { h = Math.min(359.9, x * 360); drawSV(); drawHue(); apply(false); }, () => apply(true));
    inp.addEventListener('change', () => {
      const m = /^#?([0-9a-f]{6})$/i.exec(inp.value.trim());
      if (!m) { inp.value = hexOf(slot); return; }
      [h, s, v] = hex2hsv('#' + m[1].toLowerCase()); drawSV(); drawHue(); apply(true);
    });
    box._sync = () => { [h, s, v] = hex2hsv(hexOf(slot)); inp.value = hexOf(slot); sw.style.background = hexOf(slot); drawSV(); drawHue(); };
  }
  function drag(cv, move, end){
    cv.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (er) {}
      const at = ev => { const b = cv.getBoundingClientRect(); move(Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width)), Math.max(0, Math.min(1, (ev.clientY - b.top) / b.height))); };
      at(e);
      const mv = ev => at(ev);
      const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); end(); };
      cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    });
  }

  // ── Выбор части; история для «Отменить» (снимок до правки — до первого движения палитры) ──
  function pushHist(prev){
    const s = st;
    if (!prev || JSON.stringify(prev) === JSON.stringify(s.trying)) return;
    s.hist.push(prev);
    if (s.hist.length > 40) s.hist.shift();
    undoBtns();
  }
  function undoBtns(){ st?.el.querySelectorAll('[data-act="undo"]').forEach(b => { b.disabled = !st.hist.length; }); }
  async function save(){
    const s = st;
    s.saving++;
    try { const r = await C().set(s.trying); if (r && r.ok === false && r.reason !== 'item') toast('Не сохранилось — попробуй ещё раз'); }
    finally { s.saving--; }
  }
  async function setPart(slot, id, o = {}){
    const s = st;
    if (!s) return;
    if (!s.snap) s.snap = { ...s.trying };
    const next = { ...s.trying, [slot]: id };
    if (s.mirror && MSLOT[slot] && curSub()?.parts) next[MSLOT[slot]] = id;   // левая и правая вместе
    s.trying = next;
    updatePreview();
    if (o.live) return;   // тянут палитру/ползунок — только витрина
    pushHist(s.snap); s.snap = null;
    if (C().owns(slot, id)) await save();
    if (st !== s) return;
    refresh(o.keepPicker ? slot : null);
  }
  // Сразу много частей (сброс, случайно, отменить): витрина пересобирается, своё сохраняется
  async function setMany(look, hist = true){
    const s = st;
    if (hist) pushHist({ ...s.trying });
    s.trying = materialize(look, s.key);
    updatePreview(true);
    await save();
    if (st !== s) return;
    refresh();
  }
  async function undo(){
    const s = st, prev = s?.hist.pop();
    if (!prev) return;
    undoBtns();
    await setMany(prev, false);
    sfx('tick');
  }
  // Витрина: если поменялись только цвета — перекрашиваем, иначе собираем человечка заново (не чаще раза за кадр)
  function updatePreview(rebuild){
    const s = st;
    if (!s || s.pending) { if (s && rebuild) s.rebuild = true; return; }
    s.rebuild = !!rebuild;
    s.pending = requestAnimationFrame(() => {
      s.pending = 0;
      if (st !== s || !s.pv) return;
      if (s.rebuild || !s.pv.recolor(s.trying)) s.pv.set(s.trying, s.key);
      s.rebuild = false;
      draw2d();
    });
  }
  // Обновить отметки (надето/выбрано/цены), примерку и картинки вариантов без перерисовки всего окна
  function refresh(keepPicker){
    const s = st;
    if (!s) return;
    const sb = curSub(), slot = sb.parts ? partSlots(s.part)[0] : sb.slot;
    if (slot) { const g = s.el.querySelector('.ce-grid'); if (g) { g.innerHTML = cards(slot); thumbs(); } }
    s.el.querySelectorAll('.ce-pal').forEach(p => {
      const slot2 = p.dataset.pal, cur = s.trying[slot2], part = C().part(slot2, cur), custom = C().custom(slot2, cur);
      p.querySelectorAll('.ce-sw[data-id]').forEach(b => b.classList.toggle('on', b.dataset.id === cur));
      p.querySelector('.ce-sw-custom').classList.toggle('on', custom);
      const cs = p.querySelector('.ce-pal-cur'); cs.setAttribute('style', swatchStyle(part?.id, part?.v));
      p.querySelector('.ce-pal-name').textContent = custom ? 'Свой цвет ' + part.v : part?.name || '';
      const pk = p.querySelector('.ce-pick');
      if (slot2 !== keepPicker) pk._sync?.();
    });
    s.el.querySelectorAll('[data-sl]').forEach(b => { const P = C().PARTS[b.dataset.sl], v = +(s.trying[b.dataset.sl] ?? 2) || 0; b.textContent = P.list[Math.max(0, Math.min(4, v))][1]; });
    undoBtns();
    tryBar();
  }
  // Полоска примерки: что не куплено, сколько стоит, «Купить и надеть»; пакет — одной строкой; за 💎 — в магазин
  function tryBar(){
    const s = st, bar = s?.el.querySelector('.ce-try');
    if (!bar) return;
    const items = toBuy();
    if (!items.length) { bar.hidden = true; bar.innerHTML = ''; return; }
    const coinItems = items.filter(x => !x.gems && !x.lvl), gemItems = items.filter(x => x.gems), lvlItems = items.filter(x => x.lvl && !x.gems);
    const total = coinItems.reduce((a, x) => a + x.price, 0), have = W().coins();
    bar.hidden = false;
    bar.innerHTML = `<div class="ce-try-t">👀 Примерка: ${items.map(x => `<span class="ce-chip${x.gems ? ' gem' : ''}">${esc(x.name)} · ${x.gems ? '💎 ' + num(x.gems) : x.lvl ? '🔒 ур. ' + x.lvl : '🪙 ' + num(x.price)}<button type="button" data-act="untry" data-slots="${x.slots.join(',')}" title="Снять" aria-label="Снять">✕</button></span>`).join('')}</div>
      ${coinItems.some(x => x.vip) ? '<div class="ce-try-vip">👑 VIP-вещи для VIP — бесплатно. <a href="/vip" target="_blank" rel="noopener">Как получить VIP</a></div>' : ''}
      ${gemItems.length ? `<div class="ce-try-gem">💎 ${gemItems.map(x => esc(x.name)).join(', ')} — только за кристаллы. <a href="#/shop">В магазин 💎</a></div>` : ''}
      ${lvlItems.length ? `<div class="ce-try-vip">🔒 ${lvlItems.map(x => `${esc(x.name)} — с ${x.lvl} уровня`).join(', ')}: награда за уровень, не продаётся${W()?.level?.() ? ` (у тебя ${W().level()})` : ' — войди в аккаунт'}. <a href="#/profile">Что даёт уровень</a></div>` : ''}
      ${coinItems.length ? `<div class="ce-try-row"><button type="button" class="ce-btn gold" data-act="buyall"${have < total ? ' disabled' : ''}>Купить и надеть · 🪙 ${num(total)}</button>
      ${have < total ? `<span class="ce-need">Не хватает 🪙 ${num(total - have)} — играй в игры, забери бонус дня</span>` : ''}</div>` : ''}`;
  }
  function earn(){
    const box = st?.el.querySelector('.ce-earn');
    if (!box) return;
    const authed = typeof currentUser !== 'undefined' && !!currentUser;
    const ad = !!window.D37Ads?.rewardReady?.() && W().canAd();
    box.innerHTML = `${W().canDaily() ? '<button type="button" class="ce-btn gold" data-act="daily">🎁 Бонус дня</button>' : ''}
      ${ad ? `<button type="button" class="ce-btn" data-act="ad">📺 Реклама → +${W().RULES?.ad ?? 25} 🪙</button>` : ''}
      <span class="ce-note">Обычные цвета и формы частей — бесплатно. ${authed ? 'Образ сохраняется в аккаунте.' : '<b>Войди</b> — образ и покупки сохранятся на всех устройствах.'}</span>`;
  }
  // Маленький 2D-персонаж: так ты выглядишь в «Орде» и других 2D-играх
  function draw2d(){
    const cv = st?.el.querySelector('.ce-2d');
    if (!cv) return;
    const g = cv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    try { C().draw(g, { ...st.trying, pet: 'none' }, cv.width / 2, cv.height * .9, cv.height * .72, { t: 0 }); } catch (e) {}
  }

  async function onClick(e){
    const s = st;
    if (!s) return;
    const t = e.target.closest('[data-cat],[data-sub],[data-part],[data-act],[data-slot][data-id]');
    if (!t) return;
    if (t.dataset.cat) {
      s.cat = t.dataset.cat; s.sub = 0;
      s.el.querySelectorAll('.ce-cats button').forEach(b => b.classList.toggle('on', b === t));
      renderSubs(); renderBody(); sfx('tick');
      return;
    }
    if (t.dataset.sub != null && !t.dataset.act) {
      s.sub = +t.dataset.sub;
      s.el.querySelectorAll('.ce-subs button').forEach(b => b.classList.toggle('on', b === t));
      renderBody(); sfx('tick');
      return;
    }
    if (t.dataset.part) { selectPart(t.dataset.part); return; }
    const act = t.dataset.act;
    if (!act) {   // карточка или кружок палитры
      const slot = t.dataset.slot, id = t.dataset.id;
      sfx(C().owns(slot, id) ? 'move' : 'tick');
      await setPart(slot, id);
      return;
    }
    if (t.disabled) return;
    if (act === 'close') s.opts.onClose?.();
    else if (act === 'rot') s.pv.spin(+t.dataset.d * .7);
    else if (act === 'walk') { const on = !s.pv.walking; s.pv.walk(on); t.classList.toggle('on', on); }
    else if (act === 'emo') s.pv.emote(t.dataset.e);
    else if (act === 'emonext') { const L = EMOS(); s.pv.emote(L[s.emo % L.length]); s.emo = (s.emo + 1) % L.length; t.textContent = L[s.emo]; }
    else if (act === 'undo') undo();
    else if (act === 'mirror') { s.mirror = !s.mirror; t.classList.toggle('on', s.mirror); try { localStorage.setItem('d37_ce_mirror', s.mirror ? '1' : '0'); } catch (er) {} renderBody(); }
    else if (act === 'resetpart') {   // форма и цвет части — «как было» (зеркально — обе стороны)
      const [shs, cls] = partSlots(s.part), L = { ...s.trying, [shs]: C().PART_DEFAULT[shs], [cls]: 'auto' };
      if (s.mirror) { if (MSLOT[shs]) L[MSLOT[shs]] = L[shs]; if (MSLOT[cls]) L[MSLOT[cls]] = 'auto'; }
      await setMany(L); sfx('move');
    } else if (act === 'randparts') { await setMany(randomParts({ ...s.trying })); sfx('ok'); }
    else if (act === 'pick') {
      const pk = s.el.querySelector(`.ce-pick[data-slot="${t.dataset.slot}"]`);
      if (pk) { pk.hidden = !pk.hidden; if (!pk.hidden) { pk._sync?.(); pk.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
    } else if (act === 'untry') {
      const wear = C().look(), L = { ...s.trying };
      for (const sl of (t.dataset.slots || '').split(',').filter(Boolean)) L[sl] = wear[sl];
      s.trying = materialize(L, s.key);
      for (const sl of (t.dataset.slots || '').split(',').filter(Boolean)) if (wear[sl] === undefined) s.trying[sl] = materialize(wear, s.key)[sl];
      updatePreview(true); refresh();
    } else if (act === 'buyall') {
      t.disabled = true;
      let bought = 0;
      for (const x of toBuy().filter(y => !y.gems && !y.lvl)) {
        const r = await W().buy(x.item);
        if (r?.ok || r?.reason === 'owned') bought++;
        else { toast(r?.reason === 'coins' ? 'Не хватает монет' : r?.reason === 'auth' ? 'Войди в аккаунт' : r?.reason === 'gems' ? 'Эта вещь — только за 💎 в магазине' : r?.reason === 'item' ? 'Эта вещь появится в продаже после обновления сайта — загляни позже' : 'Не получилось — попробуй ещё раз'); break; }
      }
      if (st !== s) return;
      if (bought) { await save(); sfx('win'); toast(`✅ Куплено и надето: ${bought}`); }
      refresh();
    } else if (act === 'random') randomLook();
    else if (act === 'daily') {
      t.disabled = true;
      const r = await W().daily();
      if (r?.ok) { sfx('win'); toast(`🎁 +${r.got} 🪙`); }
      earn(); tryBar();
    } else if (act === 'ad') {
      t.disabled = true;
      const ok = await window.D37Ads.showReward('coins');
      if (ok) { const r = await W().adCoins(); if (r?.ok) { sfx('win'); toast(`📺 +${r.got} 🪙 — спасибо!`); } else toast(r?.reason === 'day_cap' ? 'На сегодня награды за рекламу кончились' : 'Подожди минутку и попробуй снова'); }
      else toast('Реклама не досмотрена — монет нет');
      earn(); tryBar();
    }
  }
  function onInput(e){
    const r = e.target.closest('[data-range]');
    if (!r) return;
    setPart(r.dataset.range, String(r.value), { live: true });
    const P = C().PARTS[r.dataset.range], b = st.el.querySelector(`[data-sl="${r.dataset.range}"]`);
    if (b) b.textContent = P.list[+r.value][1];
  }
  function onChange(e){
    const r = e.target.closest('[data-range]');
    if (r) setPart(r.dataset.range, String(r.value));
  }
  const pickOf = a => a[Math.floor(Math.random() * a.length)];
  const ownIds = sl => C().PARTS[sl] ? C().PARTS[sl].list.filter(p => C().owns(sl, p[0])).map(p => p[0]) : [];
  // Случайные части тела: чаще один пакет на всё, иногда вперемешку; цвета частей — чаще «как задумано»
  function randomParts(L){
    if (!C().PARTS.psal) return L;
    const packs = ownIds('psal'), base = pickOf(packs), mixed = Math.random() < .35;
    for (const sl of LIMBS) L[sl] = mixed ? pickOf(packs) : base;
    if (st?.mirror) { L.psar = L.psal; L.pslr = L.psll; }
    const heads = ownIds('psh');
    L.psh = Math.random() < .5 && heads.includes(base) ? base : pickOf(heads);
    const cols = C().PARTS.pch.list.map(p => p[0]).filter(id => id !== 'auto');
    const tint = Math.random() < .4 ? pickOf(cols) : null;
    for (const sl of PCS) L[sl] = tint && Math.random() < .6 ? tint : 'auto';
    if (st?.mirror) { L.pcar = L.pcal; L.pclr = L.pcll; }
    return L;
  }
  // Случайный образ: из своего и бесплатного, цвета — любые из готовых; части тела — чаще обычные
  async function randomLook(){
    const s = st, L = {};
    for (const sl of C().SLOTS) { const own = ownIds(sl); if (own.length) L[sl] = pickOf(own); }
    if (Math.random() < .7) { L.hat = 'none'; L.glasses = 'none'; }
    if (Math.random() < .6) L.back = 'none';
    if (Math.random() < .7) L.glove = 'none';
    for (const sl of ['trim', 'hatc', 'glassc', 'neckc', 'backc', 'glovec']) if (Math.random() < .6) L[sl] = 'auto';
    if (C().PART_DEFAULT) {
      if (Math.random() < .7) { for (const sl in C().PART_DEFAULT) if (/^p[sc]/.test(sl)) L[sl] = C().PART_DEFAULT[sl]; }
      else randomParts(L);
      if (Math.random() < .6) L.face = 'anime';
    }
    L.hgt = L.wid = L.head = '2';
    await setMany(L);
    sfx('ok');
  }

  window.D37Editor = { mount, unmount, get open(){ return !!st; } };
})();
