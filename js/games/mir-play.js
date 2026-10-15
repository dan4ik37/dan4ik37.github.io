// ═══════════════════════════════════════
//  ИГРА ПОВЕРХ МИРА — партия из «Мира Денчика» открывается окном поверх мира, как в Роблоксе: мир не выгружается,
//  связь с миром и место за столом остаются. Партия кончилась — «↩ В мир» (сам через 10 с) или «▶ Ещё партию».
// ═══════════════════════════════════════
// MirPlay.open(id, param, { wrap, where, auto, onRoute, onClose(why), onFail(err) }) — скрипты игры грузит gamesLoadScript
// (games.js), игра монтируется в окно ВНУТРИ wrap (.wld-wrap мира — уходит в полный экран вместе с миром). Игре — то же api,
// что на её странице, плюс inWorld: true и exit(); report() обёрнут: после партии — полоска «Партия окончена» с отсчётом
// (нажал что-то в игре — партия продолжается, полоска прячется; на исходе отсчёта экран игры сменился и кнопки «ещё» нет —
// соперник уже начал новую, остаёмся). auto { g, c, n } — d37_autostart стола (table.js) ставится снова при «Ещё партию».
// Переходы игры (location.hash = '#/games/<игра>/<код>', «выйти» — '#/games/<игра>', ссылки <a href="#/…">) ловит роутер
// (MirPlay.onHash из js/ui/router.js) → decide(): та же игра с новым кодом и другие игры — внутри окна, «выйти» из партии,
// начатой с кодом (стол, приглашение), — окно закрывается; адрес мира возвращается history.replaceState (hashchange нет —
// мир не перезагружается). «Назад» в браузере и на телефоне — закрыть окно (своя запись истории, history.state.mp).
// Не открылась (скрипт не загрузился, ошибка mount) — onFail: мир уходит на страницу игры по-старому; там в шапке «↩ В мир»
// (sessionStorage d37_from_world — пришли из мира; ставит onHash при переходе мир → игра). why в onClose: back — «↩ В мир»,
// auto — сам после партии, leave — «выйти» в игре, exit — api.exit(), world/editor — игра позвала мир/гардероб,
// popstate — «Назад», nav — ушли в другой раздел сайта, unmount — мир закрылся, replace — открыли другую, fail — не открылась.
// Полный экран (js/core/fullscreen.js): окно — внутри #gamesStage, он и уходит во весь экран (⛶ в шапке окна тоже);
// переход игры внутри окна полный экран не сбрасывает (popstate такого перехода до D37Full не доходит). Esc: после партии —
// в мир; во время партии — игре (меню мира не открывается: мир на паузе). Реклама (js/core/ad-places.js): пока партия —
// D37AdPlaces.ctx('playing'); после партии gamesAdAfterRound (games.js) кладёт рекламу / «☕ Перерыв» в полоску итога
// (MirPlay.adStage), а не под мир — показ только между партиями. Телефон 📱 (js/features/phone.js): кнопка в шапке окна, его
// слой выше; открыт — Esc его (наш Esc молчит); клавиша P во время партии — игре (mir.js: hotkey мира выключен, пока играешь);
// друзьям — «играет в …» и куда прийти (phoneAct → D37Phone.setActivity, после каждого mount; закрыли — null).
// Тесты: node scripts/mirplay-test.cjs.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const NO = new Set(['world', 'studio', 'studio3d', 'unity', 'wardrobe']);   // поверх мира не открываются
  const FLAG = 'd37_from_world', FLAG_TTL = 3 * 3600e3;
  const VOLUNTARY = new Set(['back', 'auto', 'leave', 'exit', 'world', 'editor']);   // закрыли сами — свои записи истории убрать
  const AGAIN_ACT = /^(again|rematch|restart|retry|replay|co-again|co-go|next)$/;   // next — «▶ Уровень N» (маджонг)
  const AGAIN_TXT = /^\s*(↻|🔄)|ещё (раз|парти)|реванш|заново|снова|новая (игра|парти|раздача)/i;
  const PAID = /реклам|монет|🪙|📺|купить/i;   // такие кнопки сами не нажимаем
  const WAIT = /ждём|ожида/i;
  const P = { back: 10, sig: 1500 };   // секунд до возврата в мир; через сколько мс запомнить экран итога (тесты меняют)
  let cur = null, seq = 0;

  const list = () => (typeof GAMES !== 'undefined' && Array.isArray(GAMES) ? GAMES : root.GAMES) || [];
  const info = id => list().find(g => g.id === id) || null;
  const can = id => { const g = info(id); return !!(g && !g.href && Array.isArray(g.scripts) && g.scripts.length && !NO.has(id)); };
  const hashOf = url => { const s = String(url || ''), i = s.indexOf('#'); return i < 0 ? '' : s.slice(i); };
  const doc = () => (typeof document !== 'undefined' ? document : null);
  const toast = t => { try { if (typeof gameToast === 'function') gameToast(t); } catch (e) {} };
  const muted = () => { try { return localStorage.getItem('d37_games_mute') === '1'; } catch (e) { return false; } };
  const adCtx = on => { try { root.D37AdPlaces?.ctx?.('playing', on); } catch (e) {} };   // «идёт партия» — без «☕ Перерыва»
  // телефон 📱: друзья видят «играет в …» и «📍 К другу» ведёт в эту комнату (phone.js)
  const phoneAct = s => { try { root.D37Phone?.setActivity?.(s ? { g: s.g, j: s.param ? `games/${s.g}/${s.param}` : '' } : null); } catch (e) {} };
  const typing = t => !!t?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');

  // '#/games/chess/abc' → { g: 'chess', param: 'abc' }; не страница игры (витрина, другой раздел) — null
  function parse(hash){
    const m = /^#\/games\/([^/?#]+)(?:\/([^?#]*))?/.exec(String(hash || ''));
    return m ? { g: m[1], param: m[2] || null } : null;
  }
  // Переход, пока открыта игра поверх мира (чистая функция): reroute — показать в окне, stay — ничего, close — окно закрыть
  // (в мир), editor — закрыть и открыть редактор персонажа мира, pass — обычный переход сайта (окно закрыть, мир уйдёт сам)
  function decide(c, hash){
    const r = parse(hash);
    if (!r) return { act: 'pass' };
    if (r.g === 'world') return { act: 'close', why: 'world' };
    if (r.g === 'wardrobe') return { act: 'editor' };
    if (r.g === c.g) {
      if (r.param === c.param) return { act: 'stay' };
      if (r.param) return { act: 'reroute', g: r.g, param: r.param };
      return c.p0 ? { act: 'close', why: 'leave' } : { act: 'reroute', g: r.g, param: null };   // «выйти»: из партии — в мир, иначе — в меню игры
    }
    return can(r.g) ? { act: 'reroute', g: r.g, param: r.param } : { act: 'pass' };
  }

  // ── Окно ──
  const CSS = `
html.mir-playing,html.mir-playing body{overflow:hidden}
html.mir-playing:not(.gs-full) #games-page{z-index:9000!important;transform:none!important}
.mp{position:fixed;inset:0;z-index:60;background:rgba(6,5,16,.64);touch-action:auto;font-family:Montserrat,system-ui,sans-serif}
/* размер окна — от inset, а не height: реклама Google ставит предкам height:auto!important (окно росло выше экрана) */
.mp-panel{position:absolute;inset:clamp(10px,2.2vw,26px);margin:auto;max-width:1180px;max-height:980px;display:flex;flex-direction:column;background:var(--card,#111119);border:1px solid rgba(255,255,255,.1);border-radius:20px;box-shadow:0 30px 90px -20px rgba(0,0,0,.8);overflow:hidden;animation:mpIn .2s ease-out}
@keyframes mpIn{from{opacity:0;transform:translateY(12px) scale(.985)}to{opacity:1;transform:none}}
.mp-head{flex:none;display:flex;align-items:center;gap:.55rem;padding:.5rem .7rem;border-bottom:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.025)}
.mp-head b{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--font-display,Oswald,sans-serif);letter-spacing:1px;font-size:1.08rem;color:var(--text,#f0f0f8)}
.mp-head button{flex:none;min-height:38px;min-width:38px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:var(--text,#f0f0f8);border-radius:10px;padding:.4rem .7rem;font:700 .76rem Montserrat,system-ui,sans-serif;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:.3rem}
.mp-head .gs-fullbtn.on{border-color:#4ade80}
.mp-head .mp-phone{position:relative}
.mp-head .mp-back{border-color:rgba(34,197,94,.6);background:rgba(34,197,94,.16)}
.mp-head button:hover{border-color:#4ade80}
.mp-where{flex:none;font-size:.7rem;color:var(--muted,#8d8daa);white-space:nowrap}
.mp-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:1rem 1.1rem 1.3rem;-webkit-overflow-scrolling:touch}
.mp-end{flex:none;max-height:58%;overflow-y:auto;border-top:1px solid rgba(250,204,21,.35);background:linear-gradient(180deg,rgba(250,204,21,.11),rgba(250,204,21,.03));padding:.5rem .7rem calc(.5rem + env(safe-area-inset-bottom,0px))}
.mp-end[hidden]{display:none}
.mp-end-row{display:flex;align-items:center;justify-content:center;gap:.5rem;flex-wrap:wrap}
.mp-end-t{font-weight:800;font-size:.86rem;color:#fde68a;margin-right:.2rem}
.mp-end .ct-start{padding:.55rem 1.1rem;align-self:auto}
.mp-end-again{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:var(--text,#f0f0f8);border-radius:12px;padding:.55rem 1rem;font:800 .8rem Montserrat,system-ui,sans-serif;cursor:pointer}
.mp-end-ad{display:flex;justify-content:center}
.mp-end-ad #gamesAd{width:100%;margin-top:.45rem}
.mp-end-ad #gamesAd:empty,.mp-end-ad #gamesAd[hidden]{display:none}
.mp-end-ad .d37-break{margin-top:.2rem}
.mp-err{display:grid;justify-items:center;gap:.6rem;padding:2.5rem 1rem;text-align:center;color:var(--muted,#8d8daa)}
.mp-err b{color:var(--text,#f0f0f8);font-size:1rem}
.gm-stage-bar .mp-shell{border-color:rgba(34,197,94,.6);background:rgba(34,197,94,.14)}
.gm-stage-bar .mp-shell[hidden]{display:none}
@media (max-width:640px){
  .mp{background:var(--bg,#08080e)}
  .mp-panel{inset:0;max-width:none;max-height:none;border:0;border-radius:0;box-shadow:none;animation:none}
  .mp-head{padding:max(.4rem,env(safe-area-inset-top,0px)) .45rem .4rem}
  .mp-head button span,.mp-where{display:none}
  .mp-body{padding:.5rem .4rem calc(.6rem + env(safe-area-inset-bottom,0px))}
}
body:not(.high) .mp-panel{animation:none}
`;
  function css(){
    const d = doc(); if (!d || d.getElementById('mpCss')) return;
    const st = d.createElement('style'); st.id = 'mpCss'; st.textContent = CSS; d.head.appendChild(st);
  }
  const el = (tag, cls, html) => { const e = doc().createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  function build(s){
    css();
    const box = s.el = el('div', 'mp');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const panel = el('div', 'mp-panel'), head = el('div', 'mp-head');
    const back = el('button', 'mp-back', '↩<span> В мир</span>'); back.type = 'button'; back.title = 'Вернуться в «Мир Денчика»';
    s.titleEl = el('b', 'mp-title');
    const where = el('span', 'mp-where'); where.textContent = s.o.where || '🌍 Мир Денчика';
    const snd = s.snd = el('button', 'mp-snd'); snd.type = 'button'; snd.setAttribute('aria-label', 'Звук вкл/выкл'); paintSnd(s);
    head.append(back, s.titleEl, where);
    // 📖 правила игры (js/games/gamekit.js: обработчик по data-gk-rules, id — в setTitle)
    s.rulesBtn = el('button', 'mp-rules', '📖'); s.rulesBtn.type = 'button'; s.rulesBtn.title = 'Правила игры и управление'; s.rulesBtn.setAttribute('aria-label', 'Правила');
    head.appendChild(s.rulesBtn);
    // ⚙️ настройки и ⛶ / 🔄 полный экран — свои обработчики у settings.js / fullscreen.js (по data-атрибутам); во весь экран
    // уходит #gamesStage — окно внутри него
    if (root.D37Settings) { const b = el('button', 'gs-setbtn'); b.type = 'button'; b.setAttribute('data-gs-set', ''); b.title = 'Настройки: звук, графика, управление'; b.setAttribute('aria-label', 'Настройки'); b.textContent = '⚙️'; head.appendChild(b); }
    // 📱 телефон (js/features/phone.js) — его слой выше окна; клавиша P во время партии — игре, поэтому кнопкой
    if (root.D37Phone?.toggle) {
      const b = el('button', 'mp-phone', '📱<em class="ph-bdg" data-ph-badge="total" hidden></em>'); b.type = 'button'; b.title = 'Телефон: друзья, звонки, сообщения'; b.setAttribute('aria-label', 'Телефон');
      b.addEventListener('click', ev => { ev.stopPropagation(); root.D37Phone.toggle(); });
      head.appendChild(b);
      try { root.D37Phone.renderBadges?.(); } catch (e) {}
    }
    head.appendChild(snd);
    const F = root.D37Full;
    if (F?.btn && s.o.wrap?.closest?.('#gamesStage')) head.insertAdjacentHTML('beforeend', F.rotBtn('#gamesStage') + F.btn('#gamesStage', { esc: false, cls: 'gs-fullbtn' }));
    const body = el('div', 'mp-body');
    s.box = el('div', 'mp-game');
    body.appendChild(s.box);
    // полоска после партии; .mp-end-ad — реклама между партиями (games.js gamesAdAfterRound → MirPlay.adStage → ad-places.js)
    s.end = el('div', 'mp-end'); s.end.hidden = true;
    const row = el('div', 'mp-end-row');
    s.endT = el('span', 'mp-end-t');
    s.endBack = el('button', 'ct-start mp-end-back'); s.endBack.type = 'button';
    s.endAgain = el('button', 'mp-end-again', '▶ Ещё партию'); s.endAgain.type = 'button';
    row.append(s.endT, s.endBack, s.endAgain);
    s.endAd = el('div', 'mp-end-ad');
    s.end.append(row, s.endAd);
    panel.append(head, body, s.end);
    box.appendChild(panel);
    back.addEventListener('click', () => { if (cur === s) close('back'); });
    s.endBack.addEventListener('click', () => { if (cur === s) close('back'); });
    s.endAgain.addEventListener('click', () => { if (cur === s) rematch(); });
    snd.addEventListener('click', () => {
      if (typeof toggleGamesMute === 'function') toggleGamesMute(snd);   // то же, что «Звук в играх» в ⚙️ (games.js)
      else { const m = muted(); try { localStorage.setItem('d37_games_mute', m ? '0' : '1'); } catch (e) {} }
      paintSnd(s);
    });
    s.box.addEventListener('pointerdown', () => { if (cur === s) resume(s); }, true);   // нажал в игре — партия продолжается
    box.addEventListener('click', onLink, true);
    (s.o.wrap || doc().body).appendChild(box);
  }
  function paintSnd(s){ if (!s.snd) return; const m = muted(); s.snd.textContent = m ? '🔇' : '🔊'; s.snd.title = m ? 'Звук выключен — включить' : 'Звук включён — выключить'; }
  function onSettings(e){ if (cur && ['mute', '*'].includes(e?.detail?.key)) paintSnd(cur); }
  function setTitle(s){
    const g = info(s.g);
    if (s.titleEl) s.titleEl.textContent = g ? `${g.icon} ${g.title}` : s.g;
    s.el?.setAttribute('aria-label', g ? g.title : s.g);
    s.rulesBtn?.setAttribute('data-gk-rules', s.g);
  }

  // ── Открыть / закрыть ──
  async function open(id, param, o = {}){
    if (cur) close('replace');
    const s = cur = { n: ++seq, g: id, param: param || null, p0: param || null, o, phase: 'loading', gen: 0, token: 'mp' + seq + '-' + Date.now().toString(36),
      home: (typeof location !== 'undefined' && location.hash) || '#/games/world', pushed: false, depth: 0, left: 0, win: false, sig: null, mounted: null };
    if (!can(id)) { s.err = new Error('Эта игра не открывается поверх мира: ' + id); close('fail'); return false; }
    build(s); setTitle(s); loading(s);
    doc().documentElement.classList.add('mir-playing');
    try { const a = doc().activeElement; if (a && a !== doc().body) a.blur?.(); } catch (e) {}
    root.addEventListener?.('popstate', onPop, true);   // раньше D37Full: переход игры внутри окна не должен выключать полный экран
    root.addEventListener?.('keydown', onKey, true);
    root.addEventListener?.('d37:settings', onSettings);
    adCtx(true);
    const ok = await mountGame(s);
    if (cur !== s) return false;
    if (!ok) { close('fail'); return false; }
    // своя запись истории (тот же адрес): «Назад» закроет окно. Только свои поля — запись D37Full (gsFull) не копируем
    try { history.pushState({ mp: s.token, mpd: 1 }, '', location.href); s.pushed = true; s.depth = 1; } catch (e) {}
    return true;
  }
  function close(why = 'back'){
    const s = cur; if (!s) return false;
    cur = null;
    stopEnd(s);
    unmountGame(s);
    adCtx(false);
    phoneAct(null);
    root.removeEventListener?.('popstate', onPop, true);
    root.removeEventListener?.('keydown', onKey, true);
    root.removeEventListener?.('d37:settings', onSettings);
    s.el?.remove?.();
    doc()?.documentElement.classList.remove('mir-playing');
    s.phase = 'closed';
    // свои записи истории («окно», переходы игры) — назад, до записи мира: «Назад» потом сразу уводит дальше.
    // Поверх наших — запись полного экрана (⛶ нажали в окне)? Тогда не трогаем: «назад» выключил бы полный экран.
    if (s.pushed && VOLUNTARY.has(why)) { try { const st = history.state; if (st?.mp === s.token && st.mpd > 0 && st.gsFull == null) history.go(-st.mpd); } catch (e) {} }
    try { s.o.onClose?.(why); } catch (e) { console.error(e); }
    if (why === 'fail') try { s.o.onFail?.(s.err); } catch (e) { console.error(e); }
    return true;
  }
  function loading(s){ if (s.box) s.box.innerHTML = '<div class="gm-loading"><div class="spinner"></div>Загружаем игру…</div>'; }
  async function mountGame(s){
    const gen = ++s.gen, g = info(s.g);
    s.phase = 'loading';
    let adL = null;   // реклама под «Загружаем игру…», если грузится дольше 1,5 с (ad-places.js, как на странице игры)
    try { adL = root.D37AdPlaces?.loading?.({ anchor: s.box?.firstChild, game: s.g, param: s.param }) || null; } catch (e) {}
    try {
      if (typeof gamesLoadScript !== 'function') throw new Error('Нет загрузчика игр');
      for (const src of g.scripts) await gamesLoadScript(src);
      if (cur !== s || s.gen !== gen) return false;
      const impl = root.GAME_IMPL?.[s.g];
      if (!impl?.mount) throw new Error('Игра не зарегистрировалась: ' + s.g);
      s.box.innerHTML = '';
      s.mounted = s.g;
      impl.mount(s.box, api(s, gen));
      s.phase = 'playing';
      phoneAct(s);
      return true;
    } catch (err) {
      console.error(err);
      if (cur === s && s.gen === gen) { s.err = err; unmountGame(s); s.phase = 'error'; }
      return false;
    } finally { try { adL?.done?.(); } catch (e) {} }
  }
  function unmountGame(s){
    if (s.mounted) { const impl = root.GAME_IMPL?.[s.mounted]; s.mounted = null; try { impl?.unmount?.(); } catch (e) { console.error(e); } }
    if (s.box) s.box.innerHTML = '';
  }
  // Другая игра / другой код — в том же окне
  function remount(s, g, param){
    stopEnd(s); unmountGame(s); adCtx(true);
    s.g = g; s.param = param || null; setTitle(s); loading(s);
    const a = s.o.auto;   // за столом: хозяин сам нажмёт «Начать», когда все снова на месте (table.js)
    if (a && a.g === g && a.c === s.param) { try { sessionStorage.setItem('d37_autostart', JSON.stringify({ g, c: a.c, n: a.n, t: Date.now() })); } catch (e) {} }
    try { s.o.onRoute?.(g, s.param); } catch (e) {}
    mountGame(s).then(ok => {
      if (ok || cur !== s || s.phase !== 'error') return;
      s.box.innerHTML = '<div class="mp-err"><span style="font-size:2rem">😵</span><b>Игра не загрузилась</b><span>Проверь интернет — или вернись в мир кнопкой «↩ В мир».</span></div>';
    });
  }
  // api игры: как на её странице (gamesApi) + inWorld, exit(); report — конец партии
  function api(s, gen){
    const base = typeof gamesApi === 'function' ? gamesApi(s.g) : { id: s.g, report: async () => null, toast, local: () => ({}), saveLocal(){}, sfx(){} };
    // полоска итога — раньше отчёта: реклама после партии (gamesAdAfterRound → MirPlay.adStage) ложится в уже видимую полоску
    return { ...base, param: s.param, inWorld: true,
      exit: () => { if (cur === s) close('exit'); },
      report(...a){ if (cur === s && s.gen === gen) { adCtx(false); ended(s, !!a[1]); } return base.report(...a); } };
  }

  // ── После партии: полоска «↩ В мир (N) · ▶ Ещё партию» ──
  const sig = box => String(box?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
  function ended(s, win){
    stopEnd(s);
    s.phase = 'ended'; s.win = win; s.left = P.back; s.sig = null;
    s.sigT = setTimeout(() => { if (cur === s && s.phase === 'ended') s.sig = sig(s.box); }, P.sig);
    s.endTimer = setInterval(() => tick(s), 1000);
    paintEnd(s);
  }
  function tick(s){
    if (cur !== s || s.phase !== 'ended') return;
    if (--s.left > 0) { paintEnd(s); return; }
    // экран итога сменился и кнопки «ещё» нет — соперник уже начал новую партию: остаёмся
    if (s.sig != null && sig(s.box) !== s.sig && !findAgain(s.box)) { resume(s); return; }
    close('auto');
  }
  function paintEnd(s){
    if (!s.end) return;
    s.end.hidden = false;
    s.endT.textContent = (s.win ? '🏆 Победа! ' : '') + 'Партия окончена';
    s.endBack.textContent = `↩ В мир (${Math.max(0, s.left)})`;
  }
  function resume(s){ if (s.phase !== 'ended') return; s.phase = 'playing'; stopEnd(s); adCtx(true); }
  function stopEnd(s){ clearInterval(s.endTimer); clearTimeout(s.sigT); s.endTimer = s.sigT = 0; if (s.end) s.end.hidden = true; }
  // кнопка игры «↻ Ещё партия / Реванш / Ещё раз» (не за рекламу и не за монеты)
  function findAgain(box){
    if (!box?.querySelectorAll) return null;
    const ok = b => {
      if (b.disabled || b.hidden || (b.getClientRects && !b.getClientRects().length)) return false;
      const t = b.textContent || '';
      if (PAID.test(t)) return false;
      return AGAIN_ACT.test(b.dataset?.act || '') || /again|rematch/i.test(`${b.id || ''} ${typeof b.className === 'string' ? b.className : ''}`) || AGAIN_TXT.test(t);
    };
    const all = [...box.querySelectorAll('button')].filter(ok);
    return all.find(b => /\bct-start\b/.test(b.className || '')) || all[0] || null;
  }
  // «▶ Ещё партию»: кнопка самой игры; ждём хозяина — подождать; иначе — та же игра заново (тот же код стола)
  function rematch(){
    const s = cur; if (!s) return;
    resume(s);
    const b = findAgain(s.box);
    if (b) { b.click(); return; }
    if (WAIT.test(sig(s.box))) { toast('⏳ Ждём, пока соперник начнёт новую партию'); return; }
    remount(s, s.g, s.param);
  }

  // ── Переходы ──
  function apply(s, d){
    if (d.act === 'reroute') remount(s, d.g, d.param);
    else if (d.act === 'close') close(d.why);
    else if (d.act === 'editor') close('editor');
  }
  // Роутер зовёт на каждый hashchange; true — переход наш (мир не трогать, showPage не звать)
  function onHash(e){
    try {
      const s = cur;
      if (!s) { track(e?.oldURL, location.hash); shell(); return false; }
      const d = decide(s, location.hash);
      if (d.act === 'pass') { close('nav'); track(s.home, location.hash); shell(); return false; }
      // адрес мира — обратно (замена записи, без hashchange); запись — своя: «Назад» закроет окно
      s.depth++;
      try { history.replaceState({ mp: s.token, mpd: s.depth }, '', location.pathname + location.search + s.home); } catch (er) {}
      apply(s, d);
      return true;
    } catch (er) { console.error(er); return false; }
  }
  // ссылки «#/…» в игре — сразу через decide (без записи в историю); остальные — как обычно
  function onLink(e){
    const s = cur; if (!s || e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = e.target?.closest?.('a[href]'); if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('#/')) return;
    const d = decide(s, href);
    if (d.act === 'pass') return;   // другой раздел сайта: окно закроется по hashchange
    e.preventDefault();
    apply(s, d);
  }
  // «Назад» в браузере / на телефоне: вернулись на запись мира — окно закрыть. Слушаем в фазе захвата (раньше D37Full)
  function onPop(e){
    const s = cur; if (!s) return;
    if (location.hash !== s.home) {   // игра сменила адрес (онлайн, «выйти») — решит onHash; полному экрану об этом знать не надо
      e?.stopImmediatePropagation?.();
      return;
    }
    const st = history.state;
    if (st?.mp === s.token && st.mpd === s.depth) return;
    close('popstate');
    if (st?.mp === s.token && st.mpd > 0) { try { history.go(-st.mpd); } catch (er) {} }   // остальные свои записи — тоже назад
  }
  // Клавиши: после партии Esc — в мир, другая клавиша — партия продолжается; во время партии всё — игре
  // (меню мира по Esc не откроется: мир на паузе)
  function onKey(e){
    const s = cur; if (!s) return;
    if (root.D37Settings?.isOpen?.() || root.D37Phone?.isOpen?.() || root.GameKit?.isOpen?.()) return;   // поверх — окно ⚙️, телефон 📱 или «точно?»/правила игры: Esc у них
    if (e.key === 'Escape' && s.phase === 'ended' && !typing(e.target)) { e.preventDefault(); e.stopPropagation(); close('back'); return; }
    if (s.phase !== 'ended' || ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape'].includes(e.key)) return;
    resume(s);
  }

  // ── Страница игры, куда пришли из мира (старый путь): «↩ В мир» в шапке ──
  function flag(){
    try { const f = JSON.parse(sessionStorage.getItem(FLAG) || 'null'); return f && Date.now() - f.t < FLAG_TTL ? f : null; } catch (e) { return null; }
  }
  function track(oldUrl, hash){
    const was = parse(hashOf(oldUrl)), r = parse(hash);
    try {
      if (!r || r.g === 'world') sessionStorage.removeItem(FLAG);
      else if (was?.g === 'world' && info(r.g) && !info(r.g).href) sessionStorage.setItem(FLAG, JSON.stringify({ g: r.g, t: Date.now() }));
    } catch (e) {}
  }
  function shell(){
    const d = doc(); if (!d) return;
    const bar = d.querySelector('.gm-stage-bar'); if (!bar) return;
    const r = parse(typeof location !== 'undefined' ? location.hash : ''), show = !!(r && r.g !== 'world' && flag());
    let b = bar.querySelector('.mp-shell');
    if (!b) {
      if (!show) return;
      css();
      b = el('button', 'gm-mute mp-shell', '↩<span> В мир</span>'); b.type = 'button'; b.title = 'Вернуться в «Мир Денчика» — к тому же месту';
      b.addEventListener('click', () => { location.hash = '#/games/world'; });
      const back = bar.querySelector('.gm-back');
      if (back) back.after(b); else bar.prepend(b);
    }
    b.hidden = !show;
  }

  root.MirPlay = {
    can, open, close, onHash, shell, P,
    isOpen: () => !!cur,
    // куда класть рекламу после партии (games.js gamesAdAfterRound): пока открыто окно — в полоску итога, не под мир
    adStage: () => (cur?.endAd?.isConnected !== false ? cur?.endAd : null) || null,
    state: () => cur ? { g: cur.g, param: cur.param, p0: cur.p0, phase: cur.phase, left: cur.left, depth: cur.depth, pushed: cur.pushed } : null,
    _test: { parse, decide, findAgain, sig, rematch, tick: () => cur && tick(cur), flag, track },
  };
})();
