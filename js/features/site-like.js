// ═══════════════════════════════════════
//  ❤ НА САЙТЕ у роликов и стрима (D37SiteLike) — владелец 25.11.2026: «чтобы люди могли ставить нормально лайк и смотреть видео и стримы»
// ═══════════════════════════════════════
// Лайк на YouTube сайт ставить не может (js/core/vlike.js — честная ссылка «👍 Лайк на YouTube»), поэтому рядом — своё «❤ на сайте»:
// окно ролика (modal.js, кнопка #mHeart), блок Twitch на главной (#twHeart — эфир этого дня) и лента Shorts (shorts.js зовёт
// D37SiteLike.shorts(feed) — кнопка у каждого Short, тот же вид 'video', тот же вход и доделка). Сервер — community.sql ч. 20
// (site_like / site_like_info; метка site_config part20 видна гостю). Нет ч. 20 или AUTH_SOCIAL = false — кнопок нет, как раньше.
// Гость нажал ❤ → D37Intent.need('site_like', …) → окно входа → после входа ❤ ставится сам (обработчик ниже — «поставить», не
// «переключить»: уже стоявший ❤ не снимется). Наград за ❤ нет. Число — без имён (кто поставил, не видно никому).
// ПРЯЧЕМ через show(): атрибут hidden + style.display='none' + правило .sl-btn[hidden] — CSS сайта (.modal-act{display:inline-flex},
// .tw-btn) перебивал [hidden] браузера, и мёртвая ❤ была видна всем без ч. 20 (проверщик 26.11). Только .hidden — не прячет.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37SiteLike) return;
  const doc = root.document;
  const ON = (() => { try { return typeof AUTH_SOCIAL === 'undefined' || !!AUTH_SOCIAL; } catch (e) { return true; } })();
  const YT_RE = /^[A-Za-z0-9_-]{11}$/;
  const sb = () => (typeof sbClient !== 'undefined' && sbClient) ? sbClient : null;
  const me = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const toast = t => { if (typeof xpToast === 'function') xpToast(t); else if (typeof gameToast === 'function') gameToast(t); };
  const fmt = n => (root.D37VLike?.fmt ? root.D37VLike.fmt(n) : String(n));
  // ❤ у РОЛИКОВ (окно ролика, Shorts) — SITE_LIKE_VIDEO (js/core/config.js, владелец 26.11: «кнопка „Нравится“ лишняя будто теперь»):
  // 'auto' — не показываем, пока у человека работает настоящий лайк на YouTube (D37YtLike.why() === null): одна кнопка лайка; не работает
  // — ❤ как раньше (никто не теряет рабочий лайк). Стрим — всегда (у Twitch своего лайка с сайта нет). Счёт на сервере не трогаем.
  function videoWanted() {
    let m = 'always';
    try { if (typeof SITE_LIKE_VIDEO === 'string' && ['auto', 'always', 'never'].includes(SITE_LIKE_VIDEO)) m = SITE_LIKE_VIDEO; } catch (e) {}
    if (m !== 'auto') return m === 'always';
    try { return !(root.D37YtLike && root.D37YtLike.why() === null); } catch (e) { return true; }
  }

  // ═══ Есть ли ч. 20 на сервере (метка site_config part20; один раз за визит) ═══
  let p20 = null;
  function part20() {
    if (!ON) return Promise.resolve(false);
    if (p20) return p20;
    p20 = (async () => {
      if (!sb()) return false;
      try { const { data } = await sb().from('site_config').select('value').eq('key', 'part20').maybeSingle(); return !!data && String(data.value) !== '0'; }
      catch (e) { return false; }
    })();
    return p20;
  }

  // ═══ Сервер ═══
  async function info(kind, item) {
    try { const { data, error } = await sb().rpc('site_like_info', { p_kind: kind, p_items: [item] }); return !error && data?.ok ? (data.items?.[item] || { n: 0, mine: false }) : null; }
    catch (e) { return null; }
  }
  async function set(kind, item, on) {
    try { const { data, error } = await sb().rpc('site_like', { p_kind: kind, p_item: item, p_on: on }); return error ? { ok: false } : data; }
    catch (e) { return { ok: false }; }
  }

  // ═══ Кнопки ═══
  function show(b, on) { if (!b) return; b.hidden = !on; b.style.display = on ? '' : 'none'; }
  const T = { video: 'Нравится ролик — ❤ на сайте (на YouTube лайк — отдельной кнопкой)', stream: 'Нравится стрим — ❤ на сайте' };
  function paint(btn, st) {
    if (!btn) return;
    const on = !!st?.mine;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    const n = btn.querySelector('.sl-n');
    if (n) n.textContent = st && st.n ? fmt(st.n) : '';
  }
  function make(id, kind, cls) {
    const b = doc.createElement('button');
    b.type = 'button'; b.id = id; b.className = cls + ' sl-btn'; b.dataset.slKind = kind; b.title = T[kind];
    b.setAttribute('aria-label', kind === 'video' ? 'Нравится ролик (на сайте)' : 'Нравится стрим (на сайте)');
    b.innerHTML = '<span class="sl-h" aria-hidden="true">❤</span> <span class="sl-t">Нравится</span> <span class="sl-n"></span>';
    show(b, false);
    return b;
  }
  function videoBtn() {
    let b = doc.getElementById('mHeart');
    const acts = doc.querySelector('#modal .modal-actions');
    if (!b && acts) { b = make('mHeart', 'video', 'modal-act'); acts.insertBefore(b, acts.firstChild); }
    return b;
  }
  function streamBtn() {
    let b = doc.getElementById('twHeart');
    const acts = doc.querySelector('#autoStreamWrap .tw-actions');
    if (!b && acts) { b = make('twHeart', 'stream', 'tw-btn'); acts.insertBefore(b, acts.firstChild); }
    return b;
  }
  const itemOf = kind => kind === 'video' ? (typeof modalVidId !== 'undefined' && YT_RE.test(String(modalVidId || '')) ? modalVidId : null) : 'live';
  // кнопка со своим роликом (Shorts: data-sl-fix=<id>) — иначе ролик окна / стрим
  const itemFor = (kind, b) => kind === 'video' && YT_RE.test(String(b?.dataset?.slFix || '')) ? b.dataset.slFix : itemOf(kind);
  const fixedBtns = item => doc ? [...doc.querySelectorAll('.sl-btn[data-sl-fix]')].filter(x => x.dataset.slFix === item) : [];
  const btnOf = kind => kind === 'video' ? videoBtn() : streamBtn();

  // обновить кнопку (ролик открыт / вход изменился)
  async function refresh(kind) {
    const b = btnOf(kind);
    if (!b) return;
    if (!(await part20())) { show(b, false); return; }
    const item = itemOf(kind);
    if (!item) { show(b, false); return; }
    if (kind === 'video') {   // ролик не по возрасту (обложка) — без ❤ (как без «Лайк на YouTube»); настоящий лайк работает — тоже без ❤
      const covered = !!doc.getElementById('mLike')?.hidden || !!doc.getElementById('mVid')?.classList.contains('age-on');
      show(b, !covered && videoWanted());
      if (covered || !videoWanted()) return;
    } else {   // стрим: ❤ — когда идёт эфир (twitch.js: twLive) или плеер раскрыт; без эфира и закрытым плеером — нечего лайкать
      const live = typeof twLive !== 'undefined' && twLive === true;
      const on = live || !!doc.getElementById('autoStreamWrap')?.classList.contains('open');
      show(b, on);
      if (!on) return;
    }
    b.dataset.slItem = item;
    const st = await info(kind, item);
    if (b.dataset.slItem === item) paint(b, st);
  }

  // ═══ Shorts: кнопка у каждого Short (shorts.js зовёт после отрисовки ленты); Shorts не по возрасту в ленту и так не попадают ═══
  async function shorts(feed) {
    feed = feed || doc?.getElementById('shFeed');
    if (!feed) return;
    const ok = (await part20()) && videoWanted();
    const items = [...feed.querySelectorAll('.sh-item[data-id]')].filter(x => YT_RE.test(x.dataset.id || ''));
    for (const it of items) {
      let b = it.querySelector('.sl-btn');
      if (!ok) { show(b, false); continue; }
      if (!b) {
        const side = it.querySelector('.sh-side');
        if (!side) continue;
        b = doc.createElement('button');
        b.type = 'button'; b.className = 'sh-btn sl-btn'; b.dataset.slKind = 'video'; b.dataset.slFix = it.dataset.id; b.title = T.video;
        b.setAttribute('aria-label', 'Нравится ролик (на сайте)'); b.setAttribute('aria-pressed', 'false');
        b.innerHTML = '<span class="sl-h" aria-hidden="true">❤</span><small class="sl-t">Нравится</small><small class="sl-n"></small>';
        side.insertBefore(b, side.querySelector('.sh-like') || side.firstChild);
      }
      show(b, true);
    }
    if (!ok || !items.length) return;
    // числа и «моё» — одним запросом на всю ленту
    try {
      const ids = items.map(x => x.dataset.id);
      const { data, error } = await sb().rpc('site_like_info', { p_kind: 'video', p_items: ids });
      if (!error && data?.ok) for (const id of ids) fixedBtns(id).forEach(b => paint(b, data.items?.[id] || { n: 0, mine: false }));
    } catch (e) {}
  }

  // нажали ❤
  async function tap(kind, btn) {
    const b = btn || btnOf(kind), item = itemFor(kind, b);
    if (!item || !b) return;
    if (!me()) {
      if (root.D37Intent) await root.D37Intent.need('site_like', { kind, item }, { label: kind === 'video' ? 'Войди — и ❤ ролику поставится сам' : 'Войди — и ❤ стриму поставится сам' });
      else if (typeof openGlobalAuth === 'function') openGlobalAuth('login');
      return;
    }
    const on = !b.classList.contains('on');
    b.classList.toggle('on', on);   // сразу видно нажатие; число — из ответа сервера
    b.disabled = true;
    const r = await set(kind, item, on);
    b.disabled = false;
    if (r?.ok) { paint(b, { mine: r.liked, n: r.n }); if (b.dataset.slFix) fixedBtns(item).forEach(x => paint(x, { mine: r.liked, n: r.n })); }
    else { toast(r?.reason === 'slow' ? 'На сегодня ❤ хватит — продолжишь завтра' : 'Не получилось — попробуй ещё раз'); if (b.dataset.slFix) shorts(); else refresh(kind); }
  }

  // после входа — доделать ❤ (D37Intent): ролик — тот же, если окно ролика вернули; стрим — сегодняшний
  async function resumed(args) {
    const kind = args?.kind === 'stream' ? 'stream' : 'video';
    const item = kind === 'video' ? (YT_RE.test(String(args?.item || '')) ? args.item : null) : 'live';
    if (!item) return { ok: false };
    if (!(await part20())) return { ok: false, msg: '❤ на сайте пока выключены' };
    const r = await set(kind, item, true);
    if (!r?.ok) return { ok: false, msg: r?.reason === 'slow' ? 'На сегодня ❤ хватит — продолжишь завтра' : 'Не получилось поставить ❤ — нажми ещё раз' };
    const b = btnOf(kind);
    if (b && itemOf(kind) === item) { show(b, true); b.dataset.slItem = item; paint(b, { mine: true, n: r.n }); }
    if (kind === 'video') {   // Shorts: лента после входа может дорисоваться позже — подождём кнопку этого ролика до 10 с
      for (let i = 0; i < 40 && !fixedBtns(item).length && doc?.body?.dataset?.route === 'shorts'; i++) await new Promise(r2 => setTimeout(r2, 250));
      fixedBtns(item).forEach(x => { show(x, true); paint(x, { mine: true, n: r.n }); });
    }
    return { ok: true, msg: '❤ Поставлено' };
  }

  function css() {
    if (!doc?.head || doc.getElementById('d37SiteLikeCss')) return;
    const s = doc.createElement('style'); s.id = 'd37SiteLikeCss';
    s.textContent = `
.sl-btn{cursor:pointer}
.sl-btn[hidden]{display:none!important}
.sl-btn .sl-h{display:inline-block;transition:transform .15s}
.sl-btn.on{border-color:rgba(255,45,85,.55)!important;background:rgba(255,45,85,.14)!important;color:var(--text,#fff)}
.sl-btn.on .sl-h{color:#ff2d55}
.sl-btn:active .sl-h{transform:scale(1.25)}
.sl-btn .sl-n:empty{display:none}
@media(max-width:420px){.sl-btn:not(.sh-btn) .sl-t{display:none}}`;
    doc.head.appendChild(s);
  }

  if (ON && doc?.addEventListener) {
    doc.addEventListener('click', e => {
      const b = e.target?.closest?.('.sl-btn[data-sl-kind]');
      if (!b) return;
      e.preventDefault();
      tap(b.dataset.slKind === 'stream' ? 'stream' : 'video', b);
    });
    const boot = () => {
      css(); videoBtn(); streamBtn();
      refresh('stream');
      if (doc.querySelector('#shFeed .sh-item')) shorts();
      // окно ролика открылось / закрылось (класс open у #modal) — без правки старого кода окна
      const m = doc.getElementById('modal');
      if (m && root.MutationObserver) new root.MutationObserver(() => { if (m.classList.contains('open')) refresh('video'); }).observe(m, { attributes: true, attributeFilter: ['class'] });
      // плеер Twitch раскрыли / эфир начался (twitch.js ставит класс open у #autoStreamWrap) — показать ❤ стрима
      const tw = doc.getElementById('autoStreamWrap');
      let twOpen = !!tw?.classList.contains('open');
      if (tw && root.MutationObserver) new root.MutationObserver(() => { const o = tw.classList.contains('open'); if (o !== twOpen) { twOpen = o; refresh('stream'); } }).observe(tw, { attributes: true, attributeFilter: ['class'] });
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
    // настоящий лайк стал доступен / недоступен (вход, отказ Google, квота — js/core/ytlike.js шлёт d37:ytl) — ❤ роликов показать / спрятать
    root.addEventListener('d37:ytl', () => { if (doc.getElementById('modal')?.classList.contains('open')) refresh('video'); if (doc.querySelector('#shFeed .sh-item')) shorts(); });
    root.addEventListener('d37:auth', () => { refresh('stream'); if (doc.getElementById('modal')?.classList.contains('open')) refresh('video'); if (doc.querySelector('#shFeed .sh-item')) shorts(); });
    root.D37Intent?.on('site_like', resumed);
  }

  root.D37SiteLike = { ON, part20, refresh, tap, videoWanted, shorts: ON ? shorts : () => {}, _test: { resumed, setP20: v => { p20 = Promise.resolve(!!v); }, itemOf } };
})();
