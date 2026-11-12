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
//  чтобы не наложиться на рекламу самого плеера; обновлять — не чаще раза в 2 минуты), никогда поверх плеера. 05.11.2026 (правила
//  AdSense: нет рекламы там, где главное — переписка, и под чужими роликами): Google здесь нет вовсе (ad-places.js gStrict), а
//  остальная — только под своим (эфир Денчика или ролик из ленты сайта) и только в каналах официального сообщества сайта
//  (не в чужих и закрытых сообществах, не на экранах настроек, жалоб, участников, обзора).
//  «В эфире»: статус — кэш live-badge.js (D37Live.check, decapi, 2 минуты), полоска сверху #общий и «📢 новости».
//  T-141 «📺 Смотреть вместе» (флаг WT_ON — откат одной строкой): кто включил плеер в текстовом канале, жмёт «👥 Вместе» — становится
//  ведущим; остальным в этом канале — полоска «📺 <ник> смотрит … — ▶ Смотреть вместе». Синхронно через broadcast канала Realtime
//  'd37wt:<сервер>:<канал>' (в базу ничего не пишется, presence нет): ведущий шлёт { ролик, время, играет ли } при каждом своём
//  действии и раз в 4 с; кто зашёл позже — шлёт «hi», ведущий отвечает сразу. Зритель держит время ведущего: разошлись больше чем на
//  1 с — перемотка (время считаем от момента приёма — часы у всех разные). Ролик управляется через postMessage плеера YouTube
//  (enablejsapi, без сторонних скриптов). Эфир Twitch — просто открыть у всех (это прямой эфир, перематывать нечего). Возраст —
//  у каждого свой: ролик не по возрасту (PL.videoOk) / эфир детям (PL.liveOk) — полоска говорит «не по возрасту», не играет.
// ═══════════════════════════════════════
(() => {
  const PL = window.D37Player = window.D37Player || {};
  const TW = typeof TWITCH !== 'undefined' ? TWITCH : 'dan4ik37';
  const e = s => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const LH = 'd37_player_h', AD_DELAY = 60e3;
  const WT_ON = true;   // T-141 «📺 Смотреть вместе»; откат — false
  let S = null, el = null, adT = 0, gamb = false, pending = null, adPlace = false;
  const narrow = () => { try { return matchMedia('(max-width: 860px)').matches; } catch (er) { return false; } };
  const host = () => (typeof HOST !== 'undefined' && HOST) || location.hostname || 'localhost';
  const videoOf = id => (typeof allVids !== 'undefined' && Array.isArray(allVids) ? allVids.find(v => v.id === id) : null) || null;

  // Можно ли смотреть ролик здесь → { ok, age, gamb, unknown }
  PL.videoOk = id => {
    const v = videoOf(id), A = window.D37Age;
    if (!/^[A-Za-z0-9_-]{11}$/.test(String(id || ''))) return { ok: false };
    if (!A) return { ok: true, age: 0, gamb: false, unknown: !v };
    if (!v) return { ok: !A.minor?.(), age: 0, gamb: false, unknown: true };
    const r = A.video(v.title, '');
    return { ok: A.canOpen(r.age) && A.listOk(r.age), age: r.age, gamb: !!A.isGambling(v.title) };
  };
  // Эфир — не детям (Twitch с 13 лет)
  PL.liveOk = () => !window.D37Age?.kid?.();
  PL.src = s => s.kind === 'tw'
    ? `https://player.twitch.tv/?channel=${encodeURIComponent(TW)}&parent=${encodeURIComponent(host())}&autoplay=true&muted=false`
    : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(s.id)}?autoplay=1&rel=0&modestbranding=1&playsinline=1${WT_ON ? '&enablejsapi=1&origin=' + encodeURIComponent(location.origin) : ''}${s.start > 1 ? '&start=' + Math.floor(s.start) : ''}`;

  // Открыть: { kind: 'tw' } — эфир, { kind: 'yt', id } — ролик. Не в чате — сначала в #/chat (телефон 📱 закрываем)
  PL.open = o => {
    if (!o) return false;
    if (!o.wt) wtDetach();   // открыл свой ролик — больше не смотрит «вместе» с кем-то
    if (o.kind === 'tw' && !PL.liveOk()) return false;
    let vo = null;
    if (o.kind === 'yt') { vo = PL.videoOk(o.id); if (!vo.ok) { location.href = '/v/' + encodeURIComponent(o.id); return false; } }
    S = { kind: o.kind === 'tw' ? 'tw' : 'yt', id: o.kind === 'tw' ? TW : o.id, title: o.kind === 'tw' ? (o.title || 'Эфир Денчика') : (videoOf(o.id)?.title || o.title || 'Видео dan4ik37'),
      mini: false, at: Date.now(), gamb: !!vo?.gamb, own: o.kind === 'tw' || !vo?.unknown, start: +o.start || 0 };
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
    wtStop(); wtDetach();
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
    adPlace = !!(srv && srv.official && ch && ch.kind !== 'voice');   // реклама под плеером — только в каналах официального сообщества
    if (!adPlace) { const b = el?.querySelector('.ds-plad'); if (b && b.dataset.shown) { b.hidden = true; b.innerHTML = ''; delete b.dataset.shown; } }
    if (pending && S) { pending = null; render(root); }
    else if (S && (!el || !root.contains(el))) render(root);
    liveBar(root, srv, ch);
    if (WT_ON) wtJoin(srv && ch && ch.kind !== 'voice' && ch.kind !== 'twitch' ? (srv.official ? 'o' : 'c' + (+srv.id || 0)) + ':' + String(ch.id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) : '', root);
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
    if (h >= 200 && !narrow()) el.style.setProperty('--plh', h + 'px');   // плеер не ниже 200 px (правила YouTube, css/ds.css)
    el.innerHTML = `<div class="ds-plbar"><b>${S.kind === 'tw' ? '🔴 Эфир Денчика' : '🎬 ' + e(S.title)}</b><span class="ds-plbtns">
        ${S.kind === 'yt' ? `<a href="/v/${e(S.id)}" title="Открыть страницу ролика">↗</a>` : `<a href="https://www.twitch.tv/${e(TW)}" target="_blank" rel="noopener" title="Открыть на Twitch">↗</a>`}
        ${WT_ON ? '<button type="button" class="ds-plwt" data-pl="wt" hidden></button>' : ''}<button type="button" data-pl="mini" title="Свернуть / развернуть" aria-label="Свернуть плеер">▾</button><button type="button" data-pl="close" title="Закрыть" aria-label="Закрыть плеер">✕</button></span></div>
      <div class="ds-plframe"><iframe src="${e(PL.src(S))}" title="${e(S.title)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
      <div class="ds-plad" hidden></div>
      <div class="ds-plgrip" title="Потяни, чтобы изменить высоту" aria-hidden="true"></div>`;
    m.insertBefore(el, m.querySelector('.ds-pin') || m.querySelector('.ds-body'));
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-pl]'); if (!b) return;
      if (b.dataset.pl === 'close') PL.close(); else if (b.dataset.pl === 'wt') wtToggle(); else PL.toggleMini();
    });
    if (WT_ON && S.kind === 'yt') ytBind(el.querySelector('iframe'));
    wtPaint();
    grip(el.querySelector('.ds-plgrip'));
    ad();
  }
  // Высота плеера — тянуть полоску (компьютер)
  function grip(g){
    g.addEventListener('pointerdown', ev => {
      if (narrow() || S?.mini) return;
      ev.preventDefault();
      const y0 = ev.clientY, h0 = el.querySelector('.ds-plframe').getBoundingClientRect().height;
      const mv = e2 => { const hh = Math.max(200, Math.min(window.innerHeight * .7, h0 + e2.clientY - y0)); el.style.setProperty('--plh', Math.round(hh) + 'px'); };
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
    if (!S.own) return 'foreign';      // чужой ролик (не из ленты сайта) — рекламы сайта под ним нет
    if (!adPlace) return 'place';      // не официальное сообщество или не канал (настройки, жалобы, участники, обзор)
    if (Date.now() - S.at < AD_DELAY) return 'early';
    return window.D37AdPlaces?.why?.('chat_player') ?? 'noads';
  };
  function ad(){
    clearTimeout(adT);
    const box = el?.querySelector('.ds-plad'); if (!box) return;
    if (S?.mini || S?.gamb || !S?.own || !adPlace) { box.hidden = true; box.innerHTML = ''; delete box.dataset.shown; return; }
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
  window.addEventListener('d37:route', () => { if (typeof currentRoute === 'function' && currentRoute() !== 'chat') { if (S && !pending) PL.close(); if (!pending) wtJoin(''); } });

  // ═══ T-141 «📺 Смотреть вместе» ═══
  // Плеер YouTube через postMessage: «listening» → infoDelivery { currentTime, playerState }; команды playVideo / pauseVideo / seekTo
  const YT_ORIGIN = 'https://www.youtube-nocookie.com';
  const yt = { fr: null, ready: false, t: 0, at: 0, p: false, try: 0, tryT: 0 };
  const pnow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const ytNow = () => yt.t + (yt.p ? (pnow() - yt.at) / 1000 : 0);
  function ytCmd(func, args){ try { yt.fr?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: args || [], id: 1, channel: 'widget' }), YT_ORIGIN); } catch (er) {} }
  function ytBind(fr){
    clearInterval(yt.tryT);
    Object.assign(yt, { fr, ready: false, t: +S?.start || 0, at: pnow(), p: false, try: 0 });
    if (!fr) return;
    const hello = () => { if (yt.fr !== fr || yt.ready || ++yt.try > 30) { clearInterval(yt.tryT); return; } try { fr.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT_ORIGIN); } catch (er) {} };
    fr.addEventListener('load', () => { yt.try = 0; clearInterval(yt.tryT); yt.tryT = setInterval(hello, 500); hello(); }, { once: true });
  }
  if (WT_ON) window.addEventListener('message', ev => {
    if (ev.origin !== YT_ORIGIN || !yt.fr || ev.source !== yt.fr.contentWindow) return;
    let d; try { d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch (er) { return; }
    if (!d || typeof d !== 'object') return;
    if (!yt.ready && (d.event === 'onReady' || d.event === 'initialDelivery' || d.event === 'infoDelivery')) { yt.ready = true; clearInterval(yt.tryT); if (WT.follow && WT.last) setTimeout(() => wtApply(WT.last, true), 0); }
    const info = d.info; if (!info || typeof info !== 'object') return;
    const was = ytNow(), wasP = yt.p;
    if (typeof info.currentTime === 'number' && isFinite(info.currentTime)) { yt.t = info.currentTime; yt.at = pnow(); }
    if (typeof info.playerState === 'number') yt.p = info.playerState === 1 || (info.playerState === 3 && yt.p);   // 3 — буферизация: как было
    // ведущий сам нажал паузу / перемотал — сразу всем
    if (WT.host && (yt.p !== wasP || Math.abs(ytNow() - was) > 2)) wtSend();
  });

  const WT = { key: '', ch: null, host: false, follow: null, last: null, rx: 0, tick: 0, watch: 0, offer: null, sent: 0, sendT: 0, root: null };
  const myUid = () => (typeof currentUser !== 'undefined' && currentUser?.id) || '';
  const myNick = () => (typeof currentProfile !== 'undefined' && currentProfile?.nick) || '';
  const sbc = () => (typeof sbClient !== 'undefined' && sbClient) || null;
  // Чужое сообщение — не доверяем: только знакомые поля и безопасные значения
  function wtValid(d){
    if (!d || typeof d !== 'object' || typeof d.u !== 'string' || !/^[0-9a-f-]{36}$/i.test(d.u)) return null;
    const n = String(d.n || '').slice(0, 24);
    if (d.t === 'hi' || d.t === 'end') return { t: d.t, u: d.u, n };
    if (d.t !== 's') return null;
    if (d.k === 'tw') return { t: 's', k: 'tw', u: d.u, n, v: TW };
    if (d.k !== 'yt' || !/^[A-Za-z0-9_-]{11}$/.test(String(d.v || ''))) return null;
    const tm = +d.tm; if (!isFinite(tm) || tm < 0 || tm > 86400 * 2) return null;
    return { t: 's', k: 'yt', u: d.u, n, v: d.v, tm, p: !!d.p, ti: String(d.ti || '').slice(0, 120) };
  }
  // Где должен быть ролик у зрителя сейчас: время ведущего + сколько прошло с приёма (если играет)
  const wtTarget = (st, rx, now) => st.tm + (st.p ? Math.max(0, now - rx) / 1000 : 0);
  function wtJoin(key, root){
    if (root) WT.root = root;
    if (key === WT.key) { wtOffer(); return; }
    wtStop(); wtDetach(); wtOfferClear();
    if (WT.ch) { const c = sbc(), ch = WT.ch; WT.ch = null; try { c?.removeChannel(ch); } catch (er) {} }
    WT.key = key;
    if (!key || !sbc()) { wtPaint(); return; }
    const ch = sbc().channel('d37wt:' + key, { config: { broadcast: { self: false } } });
    WT.ch = ch;
    ch.on('broadcast', { event: 'wt' }, ({ payload }) => wtMsg(payload));
    ch.subscribe(st => { if (st === 'SUBSCRIBED' && WT.ch === ch) wtRaw({ t: 'hi' }); });
    wtPaint();
  }
  function wtRaw(d){
    const uid = myUid(); if (!WT.ch || !uid) return;   // гость (без аккаунта) смотрит, но не пишет — ник и id нужны
    try { WT.ch.send({ type: 'broadcast', event: 'wt', payload: Object.assign({ u: uid, n: myNick().slice(0, 24) }, d) }); } catch (er) {}
  }
  // Ведущий: состояние — не чаще раза в 400 мс
  function wtSend(){
    if (!WT.host || !S) return;
    const wait = 400 - (Date.now() - WT.sent);
    if (wait > 0) { if (!WT.sendT) WT.sendT = setTimeout(() => { WT.sendT = 0; wtSend(); }, wait); return; }
    WT.sent = Date.now();
    wtRaw(S.kind === 'tw' ? { t: 's', k: 'tw' } : { t: 's', k: 'yt', v: S.id, tm: Math.round(ytNow() * 100) / 100, p: yt.p, ti: S.title });
  }
  function wtToggle(){
    if (WT.follow) { wtDetach(); return; }   // «Отдельно»
    if (WT.host) { wtStop(); return; }
    if (!myUid()) { alert('Войди в аккаунт, чтобы вести «Смотреть вместе»'); return; }
    if (!WT.ch || !S) return;
    WT.host = true; wtOfferClear();
    clearInterval(WT.tick); WT.tick = setInterval(wtSend, 4000);
    wtSend(); wtPaint();
  }
  function wtStop(){
    if (!WT.host) return;
    WT.host = false; clearInterval(WT.tick); clearTimeout(WT.sendT); WT.sendT = 0;
    wtRaw({ t: 'end' }); wtPaint();
  }
  function wtDetach(){ if (!WT.follow) return; WT.follow = null; WT.last = null; clearInterval(WT.watch); wtPaint(); wtOffer(); }
  function wtMsg(raw){
    const d = wtValid(raw); if (!d || d.u === myUid()) return;
    if (d.t === 'hi') { if (WT.host) { WT.sent = 0; wtSend(); } return; }
    if (d.t === 'end') {
      if (WT.follow?.u === d.u) { WT.follow = null; WT.last = null; clearInterval(WT.watch); wtPaint('📺 Ведущий закончил — дальше смотришь сам'); }
      if (WT.offer?.u === d.u) wtOfferClear();
      return;
    }
    if (WT.follow?.u === d.u) { WT.last = d; WT.rx = pnow(); wtApply(d); return; }
    if (WT.host || WT.follow) return;   // уже ведёт сам или смотрит с другим
    WT.offer = d; wtOffer();
  }
  // Зритель: тот же ролик и время ведущего (разошлись > 1 с — перемотать; пауза / игра — как у него)
  function wtApply(d, force){
    if (d.k === 'tw') { if (!S || S.kind !== 'tw') PL.open({ kind: 'tw', wt: true }); return; }
    if (!S || S.kind !== 'yt' || S.id !== d.v) { PL.open({ kind: 'yt', id: d.v, wt: true, start: wtTarget(d, WT.rx, pnow()) }); return; }
    if (!yt.ready) return;
    const want = wtTarget(d, WT.rx, pnow());
    if (force || Math.abs(ytNow() - want) > 1) { ytCmd('seekTo', [want, true]); yt.t = want; yt.at = pnow(); }
    if (d.p && !yt.p) ytCmd('playVideo'); else if (!d.p && yt.p) ytCmd('pauseVideo');
  }
  function wtFollow(d){
    const ok = d.k === 'tw' ? PL.liveOk() : PL.videoOk(d.v).ok;
    if (!ok) return;
    WT.follow = { u: d.u, n: d.n }; WT.last = d; WT.rx = pnow(); wtOfferClear();
    clearInterval(WT.watch);
    WT.watch = setInterval(() => { if (WT.follow && pnow() - WT.rx > 15000) wtPaint('📡 Ведущий пропал — ждём его…'); }, 5000);
    wtApply(d, true); wtPaint();
  }
  // Полоска-приглашение «📺 <ник> смотрит … — ▶ Смотреть вместе» (у каждого своя проверка возраста)
  function wtOffer(){
    const d = WT.offer, m = main(WT.root);
    let bar = m?.querySelector('.ds-wtbar');
    if (!d || !m || WT.host || WT.follow) { bar?.remove(); return; }
    const ok = d.k === 'tw' ? PL.liveOk() : PL.videoOk(d.v).ok;
    const ti = window.D37Phone?.clean ? window.D37Phone.clean(d.ti || '') : d.ti;
    const title = d.k === 'tw' ? 'эфир Денчика' : '«' + (videoOf(d.v)?.title || ti || 'ролик') + '»';
    if (!bar) { bar = document.createElement('div'); bar.className = 'ds-livebar ds-wtbar'; m.insertBefore(bar, m.querySelector('.ds-player') || m.querySelector('.ds-pin') || m.querySelector('.ds-body')); }
    bar.innerHTML = `<i></i><span><b>📺 ${e(d.n || 'Кто-то')}</b> смотрит ${e(title)}</span>${ok ? '<button type="button" class="ds-btn ds-sm" data-wt="go">▶ Смотреть вместе</button>' : '<small class="ds-dim">🔞 не по возрасту</small>'}<button type="button" class="ds-hb" data-wt="x" title="Скрыть" aria-label="Скрыть">✕</button>`;
    bar.onclick = ev => { const b = ev.target.closest('[data-wt]'); if (!b) return; const o = WT.offer; wtOfferClear(); if (b.dataset.wt === 'go' && o) wtFollow(o); };
  }
  function wtOfferClear(){ WT.offer = null; main(WT.root)?.querySelector('.ds-wtbar')?.remove(); }
  // Кнопка в полоске плеера: «👥 Вместе» / «👥 Ведёшь» / «📺 <ник> · отдельно»
  function wtPaint(note){
    if (note && window.D37Phone?.toast) window.D37Phone.toast(note, true);
    const b = el?.querySelector('[data-pl="wt"]'); if (!b) return;
    const can = WT_ON && !!WT.key && !!S;
    b.hidden = !can || (!WT.follow && !myUid());
    b.classList.toggle('on', WT.host || !!WT.follow);
    b.textContent = WT.follow ? '📺 ' + (WT.follow.n || 'вместе') + ' · отдельно' : WT.host ? '👥 Ведёшь' : '👥 Вместе';
    b.title = note || (WT.follow ? 'Смотришь вместе — нажми, чтобы смотреть отдельно' : WT.host ? 'Все в канале видят то же, что ты. Нажми — перестать' : 'Смотреть вместе: все в этом канале смогут включить то же самое синхронно');
  }
  PL.wt = () => ({ key: WT.key, host: WT.host, follow: WT.follow ? { ...WT.follow } : null, offer: !!WT.offer, yt: { t: ytNow(), p: yt.p, ready: yt.ready } });
  PL._test = { setS: v => { S = v; }, render, setPlace: v => { adPlace = !!v; }, wtValid, wtTarget, wtMsg, wtApply, WT, yt };
})();
