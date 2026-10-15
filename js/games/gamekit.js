// ═══════════════════════════════════════
//  ОБЩЕЕ ДЛЯ ИГР: окно «точно?», правила, плашка «чей ход», отсчёт хода онлайн, удобные размеры кнопок
// ═══════════════════════════════════════
// Грузится раньше любой игры (games.js gamesLoadScript — и на странице игры, и в окне поверх мира).
// GameKit.ask({ icon, title, text, yes, no, danger }) → Promise<boolean> — окно поверх всего сайта (и полного экрана):
//   Esc, «нет» или нажатие мимо окна — false. Одно окно за раз: новое закрывает старое с ответом «нет».
// GameKit.rules(id) — окно «📖 Правила»: тексты — js/games/rules-data.js (собирает node scripts/make-rules.mjs из
//   api/_lib/games-seo.js — одни правила для сайта и для поиска) + «Управление на сайте» (HOWTO ниже: как выбрать,
//   отменить, подтвердить). Кнопки [data-gk-rules] открывают его сами: значение — id игры, пусто — открытая игра.
// GameKit.isOpen() — открыто окно GameKit (Esc — ему: mir-play.js и игры проверяют).
// GameKit.turn(mine, html) — плашка хода: mine — «твой ход» (зелёная), иначе — ждём (серая).
// GameKit.cd() — отсчёт хода онлайн: игра рисует <span class="gk-cd" data-gk-cd="<до какого Date.now()>">, отсчёт виден
//   в последние 15 с («⏳ 9 с — потом ход сделают за тебя»). Звать после каждой перерисовки (сам выключается).
// GameKit.vipPerk() — VIP или персонал (бонусы: больше отмен в «2048» и т. п.; как подсказка в «5 букв»).
(() => {
  if (window.GameKit) return;
  const HOWTO = {
    uno: ['Нажми карту — она поднимется. Нажми её ещё раз или «Сходить». Передумал — нажми другую карту или «Отмена».',
      'Дикая карта: после «Сходить» выбери цвет; «← Назад» — вернуться и выбрать другую карту.',
      'Есть чем ходить, а нажал колоду? Колода спросит «Точно взять?» — нажми ещё раз, если да.',
      'Онлайн всё до «Сходить» видишь только ты; сходил — отменить нельзя.'],
    durak: ['Нажми карту — она поднимется. «Сходить» / «Подкинуть» / «Побить» или нажми её ещё раз. Передумал — другая карта или «Отмена».',
      'Отбиваешься и карта бьёт сразу несколько карт на столе — они подсветятся: нажми ту, которую бьёшь.',
      '«Беру», когда отбиться ещё можно, спросит «Точно?» — нажми ещё раз.', 'Онлайн до подтверждения ход видишь только ты.'],
    ludo: ['Брось кубик. Можно сходить несколькими фишками — нажми фишку: она подсветится и покажет, куда встанет. Нажми её ещё раз или «Ходить».',
      'Передумал — нажми другую фишку или «Отмена». Одна возможная фишка ходит сама.'],
    nardy: ['Брось кубики. Нажми свою шашку (подсвечены те, что могут ходить), потом точку, куда идти. Можно и сразу точку-подсказку.',
      '«↩ Отменить» — вернуть последний шаг. Ходы этого броска можно переставлять сколько угодно, пока не нажал «✅ Готово».',
      'Онлайн соперник видит твой ход только после «Готово».'],
    chess: ['Нажми фигуру, потом клетку (точки — куда можно). Нажми фигуру ещё раз или пустую клетку — выбор снят.',
      'С компьютером «↩ Отменить ход» возвращает твой ход и ответ компьютера. Одна отмена за партию — на случай промаха; больше — партия станет тренировочной (без XP и рекорда).',
      'Превращение пешки: «← Назад» — передумать. Онлайн ход надо подтвердить «✅ Сходить» — после этого отменить нельзя.',
      '«🏳 Сдаться» спрашивает «Точно?».'],
    checkers: ['Нажми шашку, потом клетку (зелёные точки — куда можно). Нажми шашку ещё раз или пустую клетку — выбор снят.',
      'С ботом «↩ Отменить ход» возвращает твой ход и ответ бота. Одна отмена за партию — бесплатно, дальше партия тренировочная (без XP и рекорда). Вдвоём на экране — отменяй сколько угодно.',
      'Онлайн ход надо подтвердить «✅ Сходить». «↻ Заново» посреди партии и «🏳 Сдаться» спрашивают «Точно?».'],
    sea: ['Расстановка: «🔀 Случайно» или «✋ Сам» — нажимай клетки, корабли ставятся от большого к маленькому. «🔄 Повернуть» — вдоль или поперёк.',
      'Нажал на поставленный корабль — он снова в руке. «↩ Убрать последний» и «🗑 Заново» — переставить.',
      'В бою «↻ Заново» спрашивает «Точно?» — партия не потеряется от случайного нажатия.'],
    2048: ['«↩ Отменить» — вернуть последний ход: 2 раза за игру (VIP — 5). В соревновании отмены нет.', '«↻ Заново» посреди игры спрашивает «Точно?».'],
    ttt: ['Партия короткая — «↻ Заново» начинает сразу. Онлайн ход сразу виден сопернику.'],
    memory: ['«↻ Новая раскладка» посреди игры спрашивает «Точно?».'],
    td: ['Нажми свободную клетку — выбери башню. Нажми башню — улучшить или продать. «Продать» нужно нажать два раза: первый раз кнопка спросит «Точно?».'],
    pool: ['Целься пальцем или мышью по столу, сила — ползунком: потяни и отпусти. Передумал бить — верни ползунок к нулю и отпусти.'],
    kosynka: ['«↶ Отменить» — сколько угодно ходов назад. Новая раздача посреди партии спросит «Точно?».'],
    pauk: ['«↶ Отменить» — сколько угодно ходов назад. Новая раздача посреди партии спросит «Точно?».'],
    freecell: ['«↶ Отменить» — сколько угодно ходов назад. Новая раздача посреди партии спросит «Точно?».'],
    sudoku: ['«↶ Отменить» возвращает цифры и заметки. Ошибки после отмены не исчезают — так честнее для рекордов.'],
    blocks: ['Фигуру можно перетащить или нажать фигуру, потом клетку. Положил — отменить нельзя: это головоломка на расчёт. «↻ Заново» спросит «Точно?».'],
    mahjong: ['Нажми фишку — она выделится; нажми другую такую же. Нажми выделенную ещё раз — выбор снят.'],
    miner: ['Флажок — правый клик, долгое нажатие или режим 🚩. Открытую клетку закрыть нельзя — как в настоящем «Сапёре».'],
  };
  const NO_RULES = new Set(['world', 'studio', 'studio3d', 'unity', 'wardrobe', 'sprites']);
  const CSS = `
.gk-ask,.gk-sheet{position:fixed;inset:0;z-index:100450;display:flex;align-items:center;justify-content:center;padding:max(14px,env(safe-area-inset-top)) max(14px,env(safe-area-inset-right)) max(14px,env(safe-area-inset-bottom)) max(14px,env(safe-area-inset-left));background:rgba(6,5,14,.66);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);font-family:Montserrat,system-ui,sans-serif;color:var(--text,#f0f0f8)}
.gk-box{width:min(380px,100%);display:flex;flex-direction:column;align-items:center;gap:.55rem;text-align:center;padding:1.2rem 1.1rem 1rem;border-radius:18px;background:#16131f;border:1px solid rgba(255,255,255,.12);box-shadow:0 24px 70px rgba(0,0,0,.6)}
body.high .gk-box{animation:gkIn .16s ease-out}
@keyframes gkIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.gk-ic{font-size:2rem;line-height:1}
.gk-t{font-weight:900;font-size:1.05rem}
.gk-x{font-size:.82rem;color:var(--muted,#9a98b3);line-height:1.45}
.gk-row{display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap;width:100%;margin-top:.35rem}
.gk-row button{flex:1 1 130px;min-height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:var(--text,#f0f0f8);font:800 .84rem Montserrat,system-ui,sans-serif;cursor:pointer;padding:.5rem .8rem}
.gk-row .gk-yes{border:none;color:#fff;background:linear-gradient(135deg,var(--accent,#7c3aed),var(--accent2,#ff2d55))}
.gk-row .gk-yes.danger{background:linear-gradient(135deg,#dc2626,#f97316)}
.gk-row button:focus-visible{outline:2px solid #fff;outline-offset:2px}
.gk-sheet .gk-box{width:min(560px,100%);max-height:100%;align-items:stretch;text-align:left;padding:0;overflow:hidden}
.gk-sh-head{display:flex;align-items:center;gap:.5rem;padding:.8rem .8rem .7rem 1.1rem;border-bottom:1px solid rgba(255,255,255,.08)}
.gk-sh-head b{flex:1;min-width:0;font-size:1.02rem}
.gk-sh-head button{flex:none;width:40px;height:40px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:inherit;font-size:1rem;cursor:pointer}
.gk-sh-body{overflow-y:auto;overscroll-behavior:contain;padding:.4rem 1.1rem 1rem;font-size:.84rem;line-height:1.5}
.gk-sh-body h4{margin:.8rem 0 .3rem;font-size:.86rem;color:#fde68a}
.gk-sh-body ol,.gk-sh-body ul{margin:0;padding-left:1.25rem;display:grid;gap:.3rem}
.gk-sh-body a{color:var(--accent,#a78bfa)}
.gk-sh-foot{padding:.6rem 1.1rem .9rem;border-top:1px solid rgba(255,255,255,.08)}
.gk-sh-foot .gk-row{margin:0}
@media(max-width:440px){.gm-stage-bar>b span{display:none}}
.gm-stage[data-game="world"] .gk-rbtn,.gm-stage[data-game="studio"] .gk-rbtn,.gm-stage[data-game="studio3d"] .gk-rbtn,.gm-stage[data-game="unity"] .gk-rbtn,.gm-stage[data-game="wardrobe"] .gk-rbtn,.gm-stage[data-game="sprites"] .gk-rbtn{display:none}
/* плашка «чей ход» */
.gk-turn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;max-width:100%;padding:.32rem .85rem;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:var(--muted,#9a98b3);font-weight:800;font-size:.88rem;line-height:1.3}
.gk-turn.me{color:#dcfce7;background:rgba(34,197,94,.16);border-color:rgba(34,197,94,.6);box-shadow:0 0 16px rgba(34,197,94,.18)}
body.high .gk-turn.me{animation:gkTurn 1.6s ease-in-out infinite}
@keyframes gkTurn{50%{box-shadow:0 0 22px rgba(34,197,94,.38)}}
.gk-turn.end{color:#fde68a;background:rgba(250,204,21,.12);border-color:rgba(250,204,21,.5)}
.gk-cd{display:inline-block;margin-left:.35rem;font-weight:900;color:#fca5a5;font-variant-numeric:tabular-nums}
.gk-cd:empty{display:none}
.gk-hint{text-align:center;font-size:.74rem;color:var(--muted,#9a98b3);line-height:1.4;min-height:1.1em}
.gk-hint b{color:var(--text,#f0f0f8)}
.gk-prac{display:inline-block;margin-left:.3rem;padding:.05rem .45rem;border-radius:8px;background:rgba(56,189,248,.16);color:#7dd3fc;font-size:.7rem;font-weight:800;vertical-align:middle}
/* кнопки «отменить / готово / сходить» — общий вид */
.gk-go{border:none!important;color:#fff!important;background:linear-gradient(135deg,#16a34a,#22c55e)!important}
.gk-armed{border-color:#f59e0b!important;background:rgba(245,158,11,.2)!important;color:#fde68a!important}
body.high .gk-go.pulse{animation:gkTurn 1.4s ease-in-out infinite}
/* пальцу — не меньше 40 px (было 28–36) */
.ct-opt,.un-n,.un-btn,.ct-actions button,.g2-new,.td-b,.ct-link button,.sl-btns button{min-height:40px}
.ct-opt{padding:.45rem .85rem}
.tb-add,.tb-x{min-height:34px;min-width:34px}
`;
  function css(){
    if (document.getElementById('gkCss')) return;
    const st = document.createElement('style'); st.id = 'gkCss'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ── Окно поверх всего: общий каркас (Esc, нажатие мимо, фокус) ──
  let cur = null;   // { el, done(v) }
  function layer(cls, html, onClose){
    css();
    if (cur) cur.done(false);
    const el = document.createElement('div');
    el.className = cls; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = html;
    const back = document.activeElement;
    let closed = false;
    const me = {
      el,
      done(v){
        if (closed) return; closed = true;
        if (cur === me) cur = null;
        window.removeEventListener('keydown', onKey, true);
        el.remove();
        try { if (back && back.focus && document.contains(back)) back.focus({ preventScroll: true }); } catch (e) {}
        onClose(v);
      },
    };
    // Esc — «нет»; клавиши дальше не пускаем (ни игре, ни выходу из полного экрана)
    function onKey(e){
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); me.done(false); return; }
      if (e.key === 'Tab') {   // фокус — по кругу внутри окна
        const f = [...el.querySelectorAll('button, a[href]')];
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        return;
      }
      if (!['Enter', ' '].includes(e.key)) e.stopPropagation();   // стрелки и цифры — не игре под окном
    }
    window.addEventListener('keydown', onKey, true);
    el.addEventListener('click', e => { if (e.target === el) me.done(false); });
    el.addEventListener('pointerdown', e => e.stopPropagation());
    document.body.appendChild(el);
    cur = me;
    return me;
  }

  function ask(o = {}){
    return new Promise(res => {
      const L = layer('gk-ask', `<div class="gk-box">
          ${o.icon ? `<div class="gk-ic">${o.icon}</div>` : ''}
          <div class="gk-t" id="gkAskT">${escH(o.title || 'Точно?')}</div>
          ${o.text ? `<div class="gk-x">${o.html ? o.text : escH(o.text)}</div>` : ''}
          <div class="gk-row"><button type="button" class="gk-no">${escH(o.no || 'Отмена')}</button><button type="button" class="gk-yes${o.danger ? ' danger' : ''}">${escH(o.yes || 'Да')}</button></div>
        </div>`, res);
      L.el.setAttribute('aria-labelledby', 'gkAskT');
      L.el.querySelector('.gk-no').onclick = () => L.done(false);
      L.el.querySelector('.gk-yes').onclick = () => L.done(true);
      try { L.el.querySelector('.gk-no').focus({ preventScroll: true }); } catch (e) {}
    });
  }

  // ── «📖 Правила» ──
  function activeId(){
    try { const s = window.MirPlay?.state?.(); if (s?.g) return s.g; } catch (e) {}
    return document.getElementById('gamesStage')?.dataset.game || (typeof gamesActive !== 'undefined' ? gamesActive : '') || '';
  }
  async function rules(id){
    id = id || activeId();
    if (!id || NO_RULES.has(id)) return;
    const g = (typeof GAMES !== 'undefined' ? GAMES : []).find(x => x.id === id);
    const L = layer('gk-sheet', `<div class="gk-box">
        <div class="gk-sh-head"><b id="gkRulesT">📖 Правила${g ? ': ' + escH(g.title) : ''}</b><button type="button" class="gk-sh-x" aria-label="Закрыть">✕</button></div>
        <div class="gk-sh-body"><div class="gm-loading"><div class="spinner"></div></div></div>
        <div class="gk-sh-foot"><div class="gk-row"><button type="button" class="gk-yes gk-ok">Понятно</button></div></div>
      </div>`, () => {});
    L.el.setAttribute('aria-labelledby', 'gkRulesT');
    L.el.querySelector('.gk-sh-x').onclick = () => L.done(false);
    L.el.querySelector('.gk-ok').onclick = () => L.done(true);
    try { L.el.querySelector('.gk-ok').focus({ preventScroll: true }); } catch (e) {}
    if (!window.GAME_RULES && typeof gamesLoadScript === 'function') { try { await gamesLoadScript('js/games/rules-data.js'); } catch (e) {} }
    const body = L.el.querySelector('.gk-sh-body');
    if (!body || !L.el.isConnected) return;
    const R = window.GAME_RULES?.[id], how = HOWTO[id];
    const list = (a, tag = 'ul') => `<${tag}>${a.map(x => `<li>${escH(x)}</li>`).join('')}</${tag}>`;
    body.innerHTML = (R?.rules?.length ? `<h4>${escH(R.rt || 'Как играть')}</h4>${list(R.rules, 'ol')}` : '<p>Правила этой игры скоро появятся здесь.</p>')
      + (how ? `<h4>🖐 Управление на сайте</h4>${list(how)}` : '')
      + (R?.tips?.length ? `<h4>${escH(R.tt || 'Советы')}</h4>${list(R.tips)}` : '')
      + (R ? `<p style="margin-top:.8rem"><a href="/games/${encodeURIComponent(id)}" target="_blank" rel="noopener">Подробнее об игре, советы и вопросы — на её странице ↗</a></p>` : '');
  }
  document.addEventListener('click', e => {
    const b = e.target?.closest?.('[data-gk-rules]');
    if (!b) return;
    e.preventDefault();
    rules(b.getAttribute('data-gk-rules') || '');
  });

  // ── Плашка хода и отсчёт ──
  const turn = (mine, html, end) => `<span class="gk-turn${end ? ' end' : mine ? ' me' : ''}">${html}</span>`;
  let cdT = 0;
  function cdTick(){
    const els = document.querySelectorAll('[data-gk-cd]');
    if (!els.length) { clearInterval(cdT); cdT = 0; return; }
    const now = Date.now();
    els.forEach(el => {
      const left = Math.ceil((+el.getAttribute('data-gk-cd') - now) / 1000);
      const txt = left > 0 && left <= 15 ? `⏳ ${left} с` : '';
      if (el.textContent !== txt) { el.textContent = txt; el.title = txt ? 'Не успеешь — ход сделают за тебя' : ''; }
    });
  }
  function cd(){ cdTick(); if (!cdT && document.querySelector('[data-gk-cd]')) cdT = setInterval(cdTick, 250); }

  function vipPerk(){
    try { return typeof currentProfile !== 'undefined' && !!currentProfile && typeof hasPerks === 'function' && !!hasPerks(currentProfile.role, currentProfile); }
    catch (e) { return false; }
  }

  css();
  window.GameKit = { ask, rules, isOpen: () => !!cur, close: () => cur?.done(false), turn, cd, vipPerk, HOWTO, NO_RULES };
})();
