// ═══════════════════════════════════════
//  ❤ НА САЙТЕ у роликов и стрима (D37SiteLike) — владелец 25.11.2026: «чтобы люди могли ставить нормально лайк и смотреть видео и стримы»
// ═══════════════════════════════════════
// Лайк на YouTube сайт ставить не может (js/core/vlike.js — честная ссылка «👍 Лайк на YouTube»), поэтому рядом — своё «❤ на сайте»:
// окно ролика (modal.js, кнопка #mHeart) и блок Twitch на главной (#twHeart — эфир этого дня). Сервер — community.sql ч. 20
// (site_like / site_like_info; метка site_config part20 видна гостю). Нет ч. 20 или AUTH_SOCIAL = false — кнопок нет, как раньше.
// Гость нажал ❤ → D37Intent.need('site_like', …) → окно входа → после входа ❤ ставится сам (обработчик ниже — «поставить», не
// «переключить»: уже стоявший ❤ не снимется). Наград за ❤ нет. Число — без имён (кто поставил, не видно никому).
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
    b.hidden = true;
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
  const btnOf = kind => kind === 'video' ? videoBtn() : streamBtn();

  // обновить кнопку (ролик открыт / вход изменился)
  async function refresh(kind) {
    const b = btnOf(kind);
    if (!b) return;
    if (!(await part20())) { b.hidden = true; return; }
    const item = itemOf(kind);
    if (!item) { b.hidden = true; return; }
    b.hidden = !!(kind === 'video' && doc.getElementById('mLike')?.hidden);   // ролик не по возрасту — без ❤ (как без «Лайк на YouTube»)
    b.dataset.slItem = item;
    const st = await info(kind, item);
    if (b.dataset.slItem === item) paint(b, st);
  }

  // нажали ❤
  async function tap(kind) {
    const item = itemOf(kind), b = btnOf(kind);
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
    if (r?.ok) paint(b, { mine: r.liked, n: r.n });
    else { toast('Не получилось — попробуй ещё раз'); refresh(kind); }
  }

  // после входа — доделать ❤ (D37Intent): ролик — тот же, если окно ролика вернули; стрим — сегодняшний
  async function resumed(args) {
    const kind = args?.kind === 'stream' ? 'stream' : 'video';
    const item = kind === 'video' ? (YT_RE.test(String(args?.item || '')) ? args.item : null) : 'live';
    if (!item || !(await part20())) return { ok: false };
    const r = await set(kind, item, true);
    if (!r?.ok) return { ok: false, msg: 'Не получилось поставить ❤ — нажми ещё раз' };
    const b = btnOf(kind);
    if (b && itemOf(kind) === item) { b.hidden = false; b.dataset.slItem = item; paint(b, { mine: true, n: r.n }); }
    return { ok: true, msg: '❤ Поставлено' };
  }

  function css() {
    if (!doc?.head || doc.getElementById('d37SiteLikeCss')) return;
    const s = doc.createElement('style'); s.id = 'd37SiteLikeCss';
    s.textContent = `
.sl-btn{cursor:pointer;font:inherit}
.sl-btn .sl-h{display:inline-block;transition:transform .15s}
.sl-btn.on{border-color:rgba(255,45,85,.55)!important;background:rgba(255,45,85,.14)!important;color:var(--text,#fff)}
.sl-btn.on .sl-h{color:#ff2d55}
.sl-btn:active .sl-h{transform:scale(1.25)}
.sl-btn .sl-n:empty{display:none}
@media(max-width:420px){.sl-btn .sl-t{display:none}}`;
    doc.head.appendChild(s);
  }

  if (ON && doc?.addEventListener) {
    doc.addEventListener('click', e => {
      const b = e.target?.closest?.('.sl-btn[data-sl-kind]');
      if (!b) return;
      e.preventDefault();
      tap(b.dataset.slKind === 'stream' ? 'stream' : 'video');
    });
    const boot = () => {
      css(); videoBtn(); streamBtn();
      refresh('stream');
      // окно ролика открылось / закрылось (класс open у #modal) — без правки старого кода окна
      const m = doc.getElementById('modal');
      if (m && root.MutationObserver) new root.MutationObserver(() => { if (m.classList.contains('open')) refresh('video'); }).observe(m, { attributes: true, attributeFilter: ['class'] });
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
    root.addEventListener('d37:auth', () => { refresh('stream'); if (doc.getElementById('modal')?.classList.contains('open')) refresh('video'); });
    root.D37Intent?.on('site_like', resumed);
  }

  root.D37SiteLike = { ON, part20, refresh, tap, _test: { resumed, setP20: v => { p20 = Promise.resolve(!!v); }, itemOf } };
})();
