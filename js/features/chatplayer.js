// ═══════════════════════════════════════
//  ПЛЕЕР В ЧАТЕ (как у Twitch): эфир Денчика и ролики канала — прямо в чате, переписка не мешает.
//  Один на страницу #/chat: переходы по каналам и серверам его не закрывают, ушёл из чата — закрывается.
//  Компьютер: над лентой, высоту тянуть за полоску снизу (localStorage d37_player_h). Узко (телефон): сверху 16:9,
//  «▾» — маленькое окно в углу ленты, «✕» видно всегда.
//  Эфир — официальный плеер Twitch (parent = адрес сайта; реклама Twitch внутри — доход Денчика). Ролики — youtube-nocookie.
//  Возраст: ролик не по возрасту (D37Age.video → canOpen) — здесь не играет (ссылка на /v/<id>, там своя обложка); ролик не
//  из ленты сайта — несовершеннолетним тоже нет (вдруг кейсы); кейсы/депозит (isGambling) — без рекламы вокруг (ctx 'gambling').
//  Twitch — с 13 лет: детям полоски «в эфире» и плеера эфира нет.
//  Реклама сайта — одно место ПОД плеером (D37AdPlaces 'chat_player': только компьютер, не раньше чем через минуту после включения —
//  чтобы не наложиться на рекламу самого плеера; обновлять — не чаще раза в 2 минуты), никогда поверх плеера.
//  «В эфире»: статус — кэш live-badge.js (D37Live.check, decapi, 2 минуты), полоска сверху #общий и «📢 новости».
// ═══════════════════════════════════════
(() => {
  const PL = window.D37Player = window.D37Player || {};
  const TW = typeof TWITCH !== 'undefined' ? TWITCH : 'dan4ik37';
  const e = s => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const LH = 'd37_player_h', AD_DELAY = 60e3;
  let S = null, el = null, adT = 0, gamb = false, pending = null;
  const narrow = () => { try { return matchMedia('(max-width: 860px)').matches; } catch (er) { return false; } };
  const host = () => (typeof HOST !== 'undefined' && HOST) || location.hostname || 'localhost';
  const videoOf = id => (typeof allVids !== 'undefined' && Array.isArray(allVids) ? allVids.find(v => v.id === id) : null) || null;

  // Можно ли смотреть ролик здесь → { ok, age, gamb, unknown }
  PL.videoOk = id => {
    const v = videoOf(id), A = window.D37Age;
    if (!/^[A-Za-z0-9_-]{11}$/.test(String(id || ''))) return { ok: false };
    if (!A) return { ok: true, age: 0, gamb: false };
    if (!v) return { ok: !A.minor?.(), age: 0, gamb: false, unknown: true };
    const r = A.video(v.title, '');
    return { ok: A.canOpen(r.age) && A.listOk(r.age), age: r.age, gamb: !!A.isGambling(v.title) };
  };
  // Эфир — не детям (Twitch с 13 лет)
  PL.liveOk = () => !window.D37Age?.kid?.();
  PL.src = s => s.kind === 'tw'
    ? `https://player.twitch.tv/?channel=${encodeURIComponent(TW)}&parent=${encodeURIComponent(host())}&autoplay=true&muted=false`
    : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(s.id)}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;

  // Открыть: { kind: 'tw' } — эфир, { kind: 'yt', id } — ролик. Не в чате — сначала в #/chat (телефон 📱 закрываем)
  PL.open = o => {
    if (!o) return false;
    if (o.kind === 'tw' && !PL.liveOk()) return false;
    let vo = null;
    if (o.kind === 'yt') { vo = PL.videoOk(o.id); if (!vo.ok) { location.href = '/v/' + encodeURIComponent(o.id); return false; } }
    S = { kind: o.kind === 'tw' ? 'tw' : 'yt', id: o.kind === 'tw' ? TW : o.id, title: o.kind === 'tw' ? (o.title || 'Эфир Денчика') : (videoOf(o.id)?.title || o.title || 'Видео dan4ik37'),
      mini: false, at: Date.now(), gamb: !!vo?.gamb };
    setGamb(S.gamb);
    if (typeof currentRoute === 'function' && currentRoute() !== 'chat') {
      pending = true;
      if (window.D37Phone?.isOpen?.()) window.D37Phone.close?.();
      location.hash = '#/chat';
      return true;
    }
    render();
    return true;
  };
  PL.close = () => {
    S = null; pending = null; setGamb(false); clearTimeout(adT);
    if (el) { el.remove(); el = null; }
  };
  PL.state = () => (S ? { kind: S.kind, id: S.id, title: S.title, mini: S.mini } : null);
  PL.toggleMini = v => { if (!S) return; S.mini = v == null ? !S.mini : !!v; if (el) { el.classList.toggle('mini', S.mini); place(); ad(); } };
  // окошко — над полем ввода (у гостя оно выше: «Войти как гость»), не закрывает его
  function place(){ if (!el) return; const comp = el.parentElement?.querySelector('.mv-comp'); el.style.bottom = S?.mini ? ((comp?.offsetHeight || 74) + 12) + 'px' : ''; }
  // кейсы/депозит — пока играет такой ролик, рекламы на странице нет
  function setGamb(on){ if (on === gamb) return; gamb = on; window.D37AdPlaces?.ctx?.('gambling', on); }

  // Страница чата отрисовалась (community.js → DS.page): вставить плеер в .ds-main, полоска «в эфире»
  PL.mount = (root, srv, ch) => {
    if (!root) return;
    if (pending && S) { pending = null; render(root); }
    else if (S && (!el || !root.contains(el))) render(root);
    liveBar(root, srv, ch);
  };
  function main(root){ return (root || document).querySelector('.ds[data-mode="page"] .ds-main'); }
  function render(root){
    const m = main(root); if (!m || !S) return;
    if (el && el.isConnected && el.dataset.k === S.kind + ':' + S.id && m.contains(el)) { el.classList.toggle('mini', S.mini); return; }
    if (el) el.remove();
    el = document.createElement('div');
    el.className = 'ds-player' + (S.mini ? ' mini' : '');
    el.dataset.k = S.kind + ':' + S.id;
    const h = +localStorage.getItem(LH) || 0;
    if (h >= 140 && !narrow()) el.style.setProperty('--plh', h + 'px');
    el.innerHTML = `<div class="ds-plbar"><b>${S.kind === 'tw' ? '🔴 Эфир Денчика' : '🎬 ' + e(S.title)}</b><span class="ds-plbtns">
        ${S.kind === 'yt' ? `<a href="/v/${e(S.id)}" title="Открыть страницу ролика">↗</a>` : `<a href="https://www.twitch.tv/${e(TW)}" target="_blank" rel="noopener" title="Открыть на Twitch">↗</a>`}
        <button type="button" data-pl="mini" title="Свернуть / развернуть" aria-label="Свернуть плеер">▾</button><button type="button" data-pl="close" title="Закрыть" aria-label="Закрыть плеер">✕</button></span></div>
      <div class="ds-plframe"><iframe src="${e(PL.src(S))}" title="${e(S.title)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
      <div class="ds-plad" hidden></div>
      <div class="ds-plgrip" title="Потяни, чтобы изменить высоту" aria-hidden="true"></div>`;
    m.insertBefore(el, m.querySelector('.ds-pin') || m.querySelector('.ds-body'));
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-pl]'); if (!b) return;
      if (b.dataset.pl === 'close') PL.close(); else PL.toggleMini();
    });
    grip(el.querySelector('.ds-plgrip'));
    ad();
  }
  // Высота плеера — тянуть полоску (компьютер)
  function grip(g){
    g.addEventListener('pointerdown', ev => {
      if (narrow() || S?.mini) return;
      ev.preventDefault();
      const y0 = ev.clientY, h0 = el.querySelector('.ds-plframe').getBoundingClientRect().height;
      const mv = e2 => { const hh = Math.max(140, Math.min(window.innerHeight * .7, h0 + e2.clientY - y0)); el.style.setProperty('--plh', Math.round(hh) + 'px'); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
        const v = parseInt(el.style.getPropertyValue('--plh'), 10); if (v) try { localStorage.setItem(LH, String(v)); } catch (er) {} };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
  }
  // Реклама сайта — под плеером: когда плеер развёрнут, не раньше чем через минуту после включения, правила — D37AdPlaces
  PL.adWhy = () => {
    if (!S) return 'closed';
    if (S.mini) return 'mini';
    if (S.gamb) return 'gambling';
    if (Date.now() - S.at < AD_DELAY) return 'early';
    return window.D37AdPlaces?.why?.('chat_player') ?? 'noads';
  };
  function ad(){
    clearTimeout(adT);
    const box = el?.querySelector('.ds-plad'); if (!box) return;
    if (S?.mini || S?.gamb) { box.hidden = true; box.innerHTML = ''; return; }
    const wait = S.at + AD_DELAY - Date.now();
    if (wait > 0) { adT = setTimeout(ad, wait + 50); return; }
    if (box.dataset.shown) return;
    if (window.D37AdPlaces?.show?.(box, 'chat_player', { onEmpty: b => { b.hidden = true; b.innerHTML = ''; } })) { box.hidden = false; box.dataset.shown = '1'; }
  }

  // ═══ Полоска «🔴 Денчик в эфире» сверху #общий и «📢 новости» ═══
  let liveTitle = '';
  PL.liveTitle = async () => {
    try { const c = JSON.parse(sessionStorage.getItem('d37_live_title') || 'null'); if (c && Date.now() - c.t < 120e3) return c.v; } catch (er) {}
    let v = '';
    try { const r = await fetch('https://decapi.me/twitch/title/' + TW, { cache: 'no-store' }); v = r.ok ? (await r.text()).trim() : ''; if (/error|not found|could not|invalid/i.test(v)) v = ''; } catch (er) {}
    v = v.slice(0, 120);
    try { sessionStorage.setItem('d37_live_title', JSON.stringify({ t: Date.now(), v })); } catch (er) {}
    return v;
  };
  async function liveBar(root, srv, ch){
    const m = main(root); if (!m) return;
    let bar = m.querySelector('.ds-livebar');
    const want = srv?.official && ch && (ch.id === 'general' || ch.id === 'news') && PL.liveOk() && !closedBar();
    if (!want) { if (bar) bar.remove(); return; }
    const live = await (window.D37Live?.check?.() || Promise.resolve(false));
    if (!live || !m.isConnected || (S && S.kind === 'tw')) { if (bar) bar.remove(); return; }
    liveTitle = await PL.liveTitle();
    bar = m.querySelector('.ds-livebar');
    if (!bar) { bar = document.createElement('div'); bar.className = 'ds-livebar'; m.insertBefore(bar, m.querySelector('.ds-player') || m.querySelector('.ds-pin') || m.querySelector('.ds-body')); }
    bar.innerHTML = `<i></i><span><b>Денчик в эфире</b>${liveTitle ? ': ' + e(window.D37Phone?.clean ? window.D37Phone.clean(liveTitle) : liveTitle) : ''}</span>
      <button type="button" class="ds-btn ds-sm" data-live="play">▶ Смотреть здесь</button><button type="button" class="ds-hb" data-live="x" title="Скрыть" aria-label="Скрыть">✕</button>`;
    bar.onclick = ev => {
      const b = ev.target.closest('[data-live]'); if (!b) return;
      if (b.dataset.live === 'x') { try { sessionStorage.setItem('d37_livebar_x', '1'); } catch (er) {} bar.remove(); return; }
      bar.remove(); PL.open({ kind: 'tw', title: liveTitle });
    };
  }
  const closedBar = () => { try { return sessionStorage.getItem('d37_livebar_x') === '1'; } catch (er) { return false; } };

  // ушёл из чата — плеер закрывается (звук не играет за спиной)
  window.addEventListener('hashchange', () => { if (S && !pending && typeof currentRoute === 'function' && currentRoute() !== 'chat') PL.close(); });
  PL._test = { setS: v => { S = v; }, render };
})();
