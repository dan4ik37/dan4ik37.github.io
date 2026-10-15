// ═══════════════════════════════════════
//  «СТУДИЯ 3D» — обучение «Первый мир за 5 минут» (расширение студии 'learn'): поставить деталь → подвинуть →
//  покрасить → ▶ сыграть → 📤 выложить. Подсказки — под то, чем управляют (мышь и клавиатура / палец / геймпад),
//  нужная кнопка обведена; любой шаг можно пропустить, окно — закрыть; вернуть — кнопка «🎓 Обучение».
// ═══════════════════════════════════════
// Первый раз в студии — начинается само (вместо старого списка «Первые шаги»; кто его прошёл — только по кнопке):
// localStorage d37_s3_learn = 'done'.
(() => {
  const E = window.D37E = window.D37E || {};
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let api = null, cur = -1, off = [], ringT = 0, played = false, tick = 0, pend = false;
  const ed = () => api?.ed;
  const kind = () => E.inputKind?.kind || 'kb';
  const compact = () => !!ed()?.box.classList.contains('s3-compact');
  // шаги: заголовок, текст для мыши / пальца / геймпада, что обвести
  const STEPS = [
    { k: 'add', t: '➕ Поставь деталь',
      kb: 'Нажми «➕ Деталь» вверху и выбери «🟫 Блок». Он появится там, куда смотришь.',
      touch: 'Нажми зелёную кнопку «➕ Добавить» внизу и выбери «Блок».',
      pad: 'Нажми ☰ (кнопка «Back / View»), стиком выбери «Детали», Ⓐ, потом «Блок» и Ⓐ.',
      target: () => compact() ? '.s3x-bar .add' : '[data-a="menu:part"]' },
    { k: 'move', t: '✥ Подвинь её',
      kb: 'Потяни мышкой цветную стрелку — деталь поедет. Или тащи саму деталь.',
      touch: 'Потяни деталь пальцем — она поедет по земле. Можно тянуть и за цветную стрелку.',
      pad: 'Наведи прицел на деталь и нажми Ⓐ — она «в руках». Поверни камеру стиком и нажми Ⓐ — поставить.',
      target: () => compact() ? '.s3x-bar [data-t="move"]' : '[data-tool="move"]' },
    { k: 'paint', t: '🎨 Покрась',
      kb: 'Справа в «Свойствах» нажми любой цвет. Ниже — материал: дерево, неон, стекло…',
      touch: 'Нажми «🎨 Цвет» внизу и выбери цвет.',
      pad: 'Нажми ☰, выбери «🎨 Цвет» и любой кружок.',
      target: () => compact() ? '.s3x-bar [data-a="s3x:paint"]' : '.s3-right .s3-pal' },
    { k: 'play', t: '▶ Сыграй в свой мир',
      kb: 'Нажми зелёную «▶ Играть»: W A S D — идти, Пробел — прыжок. Потом «■ Стоп».',
      touch: 'Нажми «▶ Играть»: левый палец — идти, кнопка ⤒ — прыжок. Потом «■ Стоп».',
      pad: 'Нажми Start: левый стик — идти, Ⓐ — прыжок. Ещё раз Start — назад в редактор.',
      target: () => '.s3-play' },
    { k: 'publish', t: '📤 Выложи мир',
      kb: 'Нажми «📤 Выложить» — получишь ссылку для друзей. (Нужно войти в аккаунт.)',
      touch: 'Нажми «•••» вверху, потом «📤 Выложить» — будет ссылка для друзей. (Нужно войти в аккаунт.)',
      pad: 'Выложить — мышкой или пальцем: «📤 Выложить» вверху (или «•••» на телефоне).',
      target: () => compact() ? '.s3x-more' : '[data-a="publish"]' },
  ];
  const DONE_K = 'd37_s3_learn';
  const seen = () => { try { return localStorage.getItem(DONE_K) === 'done'; } catch (e) { return true; } };
  const markDone = () => { try { localStorage.setItem(DONE_K, 'done'); localStorage.setItem('d37_s3_tut', '1'); } catch (e) {} };

  function start(){
    const e = ed(); if (!e || e.player) return;
    e.q('.s3-tut')?.remove(); e.tut = null;   // старый список «Первые шаги» — не нужен
    cur = 0; played = false; draw();
  }
  function stop(done){
    cur = -1; ed()?.q('.s3x-tut')?.remove(); ring(null);
    if (done) markDone();
  }
  function next(){ cur++; if (cur >= STEPS.length) { finish(); return; } draw(); }
  function finish(){
    const e = ed(); cur = STEPS.length; ring(null);
    let box = e.q('.s3x-tut'); if (!box) { box = document.createElement('div'); box.className = 's3x-tut'; e.q('.s3-view').appendChild(box); }
    box.innerHTML = `<b>🎉 Первый мир готов!</b><p>Ты умеешь ставить, двигать, красить, играть и выкладывать. Дальше — сделай из мира игру: обби, гонку, прятки, бои командами…</p><div class="s3x-row"><button type="button" class="s3-play" data-l="mode">🎮 Режим игры</button><button type="button" data-l="close">Закрыть</button></div>`;
    markDone();
    try { navigator.vibrate?.(30); } catch (er) {}
  }
  function draw(){
    const e = ed(); if (!e || cur < 0 || cur >= STEPS.length) return;
    const S = STEPS[cur], k = kind() === 'pad' ? 'pad' : compact() ? 'touch' : 'kb';   // текст — под раскладку: узкий экран — кнопки внизу
    let box = e.q('.s3x-tut');
    if (!box) { box = document.createElement('div'); box.className = 's3x-tut'; e.q('.s3-view').appendChild(box); box.addEventListener('click', onClick); box.addEventListener('pointerdown', ev => ev.stopPropagation()); }
    const extra = S.k === 'play' && played ? '<p><b>Отлично!</b> Теперь нажми «■ Стоп» — вернёшься в редактор.</p>' : '';
    box.innerHTML = `<div class="dots">${STEPS.map((s, i) => `<i class="${i < cur ? 'ok' : i === cur ? 'cur' : ''}"></i>`).join('')}</div>`
      + `<b>🎓 Первый мир за 5 минут · ${cur + 1}/${STEPS.length}</b><b>${esc(S.t)}</b><p>${esc(S[k] || S.kb)}</p>${extra}`
      + `<div class="s3x-row"><button type="button" data-l="skip" title="Этот шаг потом">Пропустить шаг</button><button type="button" data-l="close" title="Закрыть обучение — вернуть можно кнопкой «🎓 Обучение»">✕ Закрыть</button></div>`;
    ringNow();
  }
  function onClick(ev){
    const a = ev.target.closest('[data-l]')?.dataset.l; if (!a) return;
    if (a === 'skip') next();
    else if (a === 'close') stop(true);
    else if (a === 'mode') { stop(true); api.core.act('s3g:panel'); }
  }
  // обвести нужную кнопку (если видна)
  function ring(el){
    let r = document.querySelector('.s3x-ring');
    if (!el) { r?.remove(); return; }
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) { r?.remove(); return; }
    if (!r) { r = document.createElement('div'); r.className = 's3x-ring'; document.body.appendChild(r); }
    r.style.cssText = `left:${b.left - 5}px;top:${b.top - 5}px;width:${b.width + 10}px;height:${b.height + 10}px`;
  }
  function ringNow(){
    const e = ed(); if (!e || cur < 0 || cur >= STEPS.length) { ring(null); return; }
    const S = STEPS[cur];
    if (kind() === 'pad' && S.k !== 'publish') { ring(null); return; }
    if (S.k === 'play' && e.playing && !played) played = true;
    const sel = S.target(), el = e.box.querySelector(sel);
    ring(el && !el.closest('[hidden]') ? el : null);
  }
  // что сделал человек — шаг засчитан
  function on(what, d){
    if (cur < 0 || cur >= STEPS.length) return;
    const S = STEPS[cur];
    if (S.k === 'add' && what === 'add' && (d?.cls === 'Part' || d?.cls === 'Prefab')) { if (!pend) { pend = true; setTimeout(() => { pend = false; if (STEPS[cur]?.k === 'add') next(); }, 0); } }   // после «на поверхность» — иначе её сдвиг засчитался бы шагом «подвинь»
    else if (S.k === 'move' && what === 'change' && d?.key === 'pos' && d.obj && d.obj.cls !== 'NPC' && !ed()?.playing) next();
    else if (S.k === 'paint' && what === 'change' && (d?.key === 'color' || d?.key === 'mat')) next();
    else if (S.k === 'play' && what === 'play') { played = true; draw(); }
    else if (S.k === 'play' && what === 'stop' && played) next();
    else if (S.k === 'publish' && what === 'publish') next();
  }

  E.studioExt = E.studioExt || [];
  E.studioExt.push({
    id: 'learn',
    mount(a){
      api = a; const e = a.ed; if (!e || e.player) return;
      const b = document.createElement('button'); b.type = 'button'; b.dataset.a = 's3l:start'; b.title = 'Обучение «Первый мир за 5 минут»'; b.setAttribute('aria-label', 'Обучение');
      b.innerHTML = '🎓<span> Обучение</span>';
      a.slot?.appendChild(b);
      off.push(e.SC.on('add', o => on('add', o)), e.SC.on('change', d => on('change', d)));
      off.push(E.inputKind?.on(() => draw()) || (() => {}));
      ringT = setInterval(() => { if (++tick % 2 === 0) ringNow(); }, 250);
      // само — только новичкам (старый список «Первые шаги» не пройден): опытным — кнопка «🎓 Обучение»
      let old = false; try { old = localStorage.getItem('d37_s3_tut') === '1'; } catch (er) {}
      if (!seen() && !old) setTimeout(() => { if (api === a && !a.ed?.player) start(); }, 600);
    },
    unmount(){ clearInterval(ringT); for (const f of off) { try { f?.(); } catch (e) {} } off = []; stop(false); api = null; },
    act(a){
      if (a === 's3l:start') { start(); return true; }
      if (a === 'publish') on('publish');
      return false;
    },
    play(){ on('play'); },
    stop(){ on('stop'); },
  });
  E.s3learn = { _test: { STEPS, start, state: () => cur } };
})();
