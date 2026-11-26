// ═══════════════════════════════════════
//  💬 КОММЕНТАРИИ С YOUTUBE НА САЙТЕ (D37YtComments) — владелец 26.11.2026: «можно ли сделать комменты от ютуба и убрать лишнее»
// ═══════════════════════════════════════
// Кнопка «💬» — у каждого Short (shorts.js, .sh-side) и в окне ролика (index.html #mCmt). Открывает окно комментариев этого ролика:
//  читать — 20 верхних веток YouTube (по «полезности») и ответы по нажатию — через сервер сайта /api/ytcomments (api/_lib/routes/
//  ytcomments.js: ключ сайта, кэш 10 мин, 1 ед. квоты; токен человека для чтения НЕ нужен);
//  написать / ответить — тем же D37YtLike (js/core/ytlike.js comment(): флаг YT_LIKE_REAL, разрешение Google youtube.force-ssl, тот же
//  экран Google и возврат, D37Intent 'ytcmt'); настоящая запись недоступна (флаг, не админ в 'test', встроенный браузер, отказ, квота)
//  — вместо поля ссылка «Написать на YouTube ↗» / у ветки «Ответить на YouTube ↗».
// ВОЗРАСТ (красная линия — дети и взрослые в общении разделены): окно и кнопка «💬» — только 13+ (D37Age.known() и не kid()). До 13 и
//  возраст не указан — кнопки «💬» нет вовсе. Текст с YouTube — только textContent (никакой разметки из чужих строк); ссылка — только имя
//  автора и только на youtube.com. Наград за комментарий нет (правила YouTube API III.F).
// Пока окно закрывает играющий плеер (телефон) — ролик на паузе (ничего поверх играющего видео), закрыл — играет дальше.
// Флаг YT_COMMENTS (js/core/config.js): 'on' | 'test' (админы и YT_LIKE_TEST_IDS) | 'off' — кнопок нет. Откат — 'off'.
(() => {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37YtComments) return;
  const doc = root.document;
  const RE = /^[A-Za-z0-9_-]{11}$/, PARENT_RE = /^[A-Za-z0-9_-]{10,100}$/;
  const YT_URL_RE = /^https:\/\/(www\.)?youtube\.com\/[\w@%.\/-]{1,200}$/;
  const me = () => (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
  const role = () => (typeof currentRole !== 'undefined' ? currentRole : null);
  const Y = () => root.D37YtLike || null;
  function mode() {
    let m = 'off';
    try { if (typeof YT_COMMENTS === 'string') m = YT_COMMENTS; } catch (e) {}
    return ['on', 'test', 'off'].includes(m) ? m : 'off';
  }
  // можно ли этому человеку окно комментариев: флаг + 13+ (возраст известен и не «до 13»)
  function allowed() {
    const m = mode();
    if (m === 'off') return false;
    if (m === 'test') {
      const u = me(); let ids = [];
      try { if (Array.isArray(YT_LIKE_TEST_IDS)) ids = YT_LIKE_TEST_IDS.map(String); } catch (e) {}
      if (!(u && (role() === 'admin' || ids.includes(String(u.id))))) return false;
    }
    const A = root.D37Age;
    if (!A) return false;
    try { return !!A.known() && !A.kid(); } catch (e) { return false; }
  }
  // настоящая запись доступна? (иначе — ссылка на YouTube)
  const KEEP_DRAFT = true;   // запись недоступна — написанный текст виден (только чтение) + «Скопировать текст» (откат: false — только ссылка, как до 27.11)
  const NOTE_W = 'Опубликуется на YouTube под именем твоего аккаунта YouTube — его увидят все. Пиши по-доброму.';
  const NOTE_COPY = 'С сайта сейчас не отправить — скопируй текст и вставь его на YouTube по ссылке ниже.';
  const COPY_T = 'Скопировать текст';
  const canWrite = () => { try { return !!Y() && Y().why() === null; } catch (e) { return false; } };

  // ═══ Кнопки «💬» ═══
  function show(b, on) { if (!b) return; b.hidden = !on; b.style.display = on ? '' : 'none'; }
  function paint(scope) {
    if (!doc) return;
    const ok = allowed();
    (scope && scope.querySelectorAll ? scope : doc).querySelectorAll('.ytc-btn').forEach(b => {
      let on = ok && RE.test(String(b.dataset.ytc || ''));
      // окно ролика: ролик не по возрасту (обложка) — без «💬», как без «Лайк на YouTube»
      if (on && b.id === 'mCmt') on = !doc.getElementById('mLike')?.hidden && !doc.getElementById('mVid')?.classList.contains('age-on');
      show(b, on);
    });
    if (!ok && isOpen()) close();
  }

  // ═══ Данные: /api/ytcomments (память страницы 60 с) ═══
  const mem = new Map();
  function load(id, parent) {
    const k = id + '|' + (parent || '');
    const h = mem.get(k);
    if (h && Date.now() - h.t < 60e3) return h.p;
    const q = new URLSearchParams({ id }); if (parent) q.set('parent', parent);
    const p = root.fetch('/api/ytcomments?' + q.toString()).then(r => r.json().catch(() => null).then(j => (r.ok && j && Array.isArray(j.items)) ? j : { error: (j && j.error) || 'unavailable' }))
      .catch(() => ({ error: 'unavailable' }));
    mem.set(k, { t: Date.now(), p });
    p.then(d => { if (d.error) mem.delete(k); });
    return p;
  }

  // ═══ Окно ═══
  let box = null, cur = null;   // cur: { id, short, parent, author, opener, paused: [iframe] }
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const isOpen = () => !!box && !box.hidden;
  function ago(iso) {
    const t = Date.parse(iso || ''); if (!t) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return 'только что';
    if (s < 3600) return Math.round(s / 60) + ' мин назад';
    if (s < 86400) return Math.round(s / 3600) + ' ч назад';
    if (s < 30 * 86400) return Math.round(s / 86400) + ' дн назад';
    try { return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; }
  }
  const fmt = n => (root.D37VLike?.fmt ? root.D37VLike.fmt(n) : String(n));
  // ссылки — только на youtube.com: адрес всегда начинается с нашей строки 'https://www.youtube.com/', дальше — путь (id — через
  // encodeURIComponent; путь автора — уже проверен YT_URL_RE)
  const ytUrl = (id, parent) => 'watch?v=' + encodeURIComponent(String(id || '')) + (parent ? '&lc=' + encodeURIComponent(String(parent)) : '');
  function linkOut(cls, text, ytPath) { const a = el('a', cls, text); a.href = 'https://www.youtube.com/' + ytPath; a.target = '_blank'; a.rel = 'noopener'; return a; }

  function build() {
    if (box) return box;
    css();
    box = el('div', 'ytc'); box.id = 'ytcPanel'; box.hidden = true;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'ytcTitle');
    const back = el('div', 'ytc-back'); back.addEventListener('click', close);
    const sheet = el('section', 'ytc-sheet');
    const head = el('header', 'ytc-head');
    const title = el('b', 'ytc-title', '💬 Комментарии с YouTube'); title.id = 'ytcTitle';
    const x = el('button', 'ytc-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Закрыть комментарии'); x.addEventListener('click', close);
    head.append(title, x);
    const list = el('div', 'ytc-list'); list.setAttribute('aria-live', 'polite');
    // не <footer>: правила сайта для подвала страницы (css/premium.css: в Shorts footer{display:none}) прятали всё нижнее окна (проверка 27.11)
    const foot = el('div', 'ytc-foot');
    const compose = el('div', 'ytc-compose');
    const to = el('div', 'ytc-to'); to.hidden = true;
    const toTxt = el('span', 'ytc-to-t'); const toX = el('button', 'ytc-to-x', '✕'); toX.type = 'button'; toX.setAttribute('aria-label', 'Не отвечать, а написать свой комментарий');
    toX.addEventListener('click', () => setParent('', ''));
    to.append(toTxt, toX);
    const ta = el('textarea', 'ytc-ta'); ta.rows = 2; ta.maxLength = Y()?.MAXC || 2000; ta.placeholder = 'Написать комментарий…';
    ta.setAttribute('aria-label', 'Текст комментария для YouTube');
    let dT = 0;
    ta.addEventListener('input', () => { clearTimeout(dT); dT = setTimeout(() => { if (cur) Y()?.saveDraft?.(cur.id, ta.value, cur.parent); }, 300); syncSend(); });
    const note = el('p', 'ytc-note', NOTE_W);
    const send = el('button', 'ytc-send', 'Отправить на YouTube'); send.type = 'button';
    send.addEventListener('click', submit);
    // запись недоступна, а текст уже написан — поле остаётся (только чтение) и «Скопировать текст» рядом со ссылкой на YouTube
    const copy = el('button', 'ytc-copy', COPY_T); copy.type = 'button'; copy.hidden = true;
    copy.addEventListener('click', copyDraft);
    compose.append(to, ta, note, send, copy);
    const ytw = linkOut('ytc-ytw', 'Написать комментарий на YouTube ↗', '');
    const src = el('div', 'ytc-src');
    foot.append(compose, ytw, src);
    sheet.append(head, list, foot);
    box.append(back, sheet);
    doc.body.appendChild(box);
    box._ = { list, compose, to, toTxt, ta, note, send, copy, ytw, src, sheet, x };
    return box;
  }
  function syncSend() {
    if (!box || !cur) return;
    const P = box._, busy = !!Y()?.cmtBusy?.(cur.id);
    P.send.disabled = busy || !P.ta.value.trim();
    P.send.textContent = busy ? 'Отправляем на YouTube…' : cur.parent ? 'Ответить на YouTube' : 'Отправить на YouTube';
  }
  // поле или ссылка: настоящая запись доступна — поле; нет — ссылка на YouTube, а уже написанный текст виден (только чтение) с кнопкой
  // «Скопировать текст» (отказ Google / квота / встроенный браузер / нет канала: проверка 27.11 — раньше текст пропадал с глаз)
  function paintCompose() {
    if (!box || !cur) return;
    const P = box._, w = canWrite(), keep = !w && KEEP_DRAFT && !!P.ta.value.trim();
    P.compose.hidden = !w && !keep;
    P.ta.readOnly = !w;
    P.send.hidden = !w;
    P.copy.hidden = !keep;
    if (!keep) P.copy.textContent = COPY_T;
    P.note.textContent = w ? NOTE_W : NOTE_COPY;
    P.ytw.hidden = w;
    P.ytw.href = 'https://www.youtube.com/' + ytUrl(cur.id, cur.parent);
    P.ytw.textContent = cur.parent ? 'Ответить на YouTube ↗' : 'Написать комментарий на YouTube ↗';
    P.list.querySelectorAll('.ytc-reply[data-tid]').forEach(r => { if ((r.tagName === 'BUTTON') !== w) r.replaceWith(replyCtl(r.dataset.tid, r.dataset.au || '')); });
    syncSend();
  }
  async function copyDraft() {
    if (!box) return;
    const P = box._, t = P.ta.value;
    let done = false;
    try { await root.navigator.clipboard.writeText(t); done = true; } catch (e) {}
    if (!done) { try { P.ta.focus(); P.ta.select(); done = !!doc.execCommand('copy'); } catch (e) {} }
    P.copy.textContent = done ? 'Скопировано ✓' : 'Выдели текст и скопируй';
    if (!done) { try { P.ta.focus(); P.ta.select(); } catch (e) {} }
  }
  function setParent(parent, author) {
    if (!cur) return;
    cur.parent = PARENT_RE.test(String(parent || '')) ? parent : '';
    cur.author = cur.parent ? String(author || '') : '';
    const P = box._;
    P.to.hidden = !cur.parent;
    P.toTxt.textContent = cur.parent ? 'Ответ ' + (cur.author || 'автору') : '';
    P.ta.placeholder = cur.parent ? 'Ответить ' + (cur.author || '') + '…' : 'Написать комментарий…';
    paintCompose();
    if (cur.parent && canWrite()) P.ta.focus();
  }

  // «Ответить» (настоящая запись доступна) или «Ответить на YouTube ↗» (нет) — перерисовывается, когда доступность меняется (paintCompose)
  function replyCtl(tid, au) {
    let r;
    if (canWrite()) { r = el('button', 'ytc-reply', 'Ответить'); r.type = 'button'; r.addEventListener('click', () => setParent(tid, au)); }
    else r = linkOut('ytc-reply', 'Ответить на YouTube ↗', ytUrl(cur.id, tid));
    r.dataset.tid = tid; r.dataset.au = au;
    return r;
  }
  function author(c) {
    const name = String(c.author || 'Автор YouTube');
    return YT_URL_RE.test(String(c.authorUrl || '')) ? Object.assign(linkOut('ytc-au', name, String(c.authorUrl).replace(/^https:\/\/(www\.)?youtube\.com\//, '')), { rel: 'noopener nofollow ugc' }) : el('b', 'ytc-au', name);
  }
  function item(c, threadId, isReply) {
    const li = el('article', 'ytc-it' + (isReply ? ' ytc-rep' : '') + (c.mine ? ' ytc-mine' : ''));
    li.dataset.cid = String(c.id || '');
    const top = el('div', 'ytc-top');
    top.append(author(c), el('span', 'ytc-ago', (c.mine ? 'твой · ' : '') + ago(c.at)));
    const txt = el('p', 'ytc-txt', String(c.text || ''));   // только текст: разметка из комментария не исполняется
    const row = el('div', 'ytc-row');
    if (+c.likes > 0) row.append(el('span', 'ytc-likes', '👍 ' + fmt(+c.likes)));
    const tid = threadId || c.id;
    if (cur && PARENT_RE.test(String(tid || ''))) row.append(replyCtl(tid, String(c.author || '')));
    li.append(top, txt, row);
    if (!isReply && +c.replies > 0 && PARENT_RE.test(String(c.id || ''))) {
      const more = el('button', 'ytc-more', 'Ответы (' + fmt(+c.replies) + ')'); more.type = 'button';
      const reps = el('div', 'ytc-reps');
      more.addEventListener('click', async () => {
        if (more.dataset.open) { reps.replaceChildren(); delete more.dataset.open; more.textContent = 'Ответы (' + fmt(+c.replies) + ')'; return; }
        more.dataset.open = '1'; more.disabled = true; more.textContent = 'Загружаем ответы…';
        const vid = cur && cur.id;
        const d = await load(vid, c.id);
        more.disabled = false;
        if (!cur || cur.id !== vid) return;
        more.textContent = 'Скрыть ответы';
        reps.replaceChildren();
        if (d.error) { reps.append(el('p', 'ytc-empty', 'Ответы сейчас не загрузились.'), linkOut('ytc-reply', 'Открыть на YouTube ↗', ytUrl(vid, c.id))); return; }
        d.items.forEach(r => reps.append(item(r, c.id, true)));
      });
      li.append(more, reps);
    }
    return li;
  }
  async function fill(id) {
    const P = box._;
    P.list.replaceChildren(el('p', 'ytc-empty', 'Загружаем комментарии…'));
    P.src.replaceChildren();
    const d = await load(id);
    if (!cur || cur.id !== id) return;
    P.list.replaceChildren();
    if (d.error) {
      P.list.append(el('p', 'ytc-empty', d.error === 'quota' ? 'Комментарии сегодня больше не загружаются (лимит YouTube).' : 'Комментарии сейчас не загрузились.'), linkOut('ytc-reply', 'Открыть комментарии на YouTube ↗', ytUrl(id)));
      return;
    }
    if (d.disabled) P.list.append(el('p', 'ytc-empty', 'Комментарии к этому ролику отключены на YouTube.'));
    else if (!d.items.length) P.list.append(el('p', 'ytc-empty', 'Пока нет комментариев — напиши первым.'));
    else d.items.forEach(c => P.list.append(item(c, '', false)));
    // свои, только что отправленные (ответ сервера мог прийти раньше списка; кэш сервера их ещё не знает) — сверху
    (cur.mine || []).filter(c => !d.items.some(x => x.id === c.id)).forEach(c => { P.list.querySelector('.ytc-empty')?.remove(); P.list.prepend(item(c, '', false)); });
    let when = '';
    const t = Date.parse(d.at || '');
    if (t) { try { when = ' · обновлено ' + new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); } catch (e) {} }
    P.src.append(el('span', '', 'Комментарии с YouTube' + when + ' · '), linkOut('', 'все на YouTube ↗', ytUrl(id)));
    if (d.disabled) { P.compose.hidden = true; P.ytw.hidden = true; }
  }

  // ═══ Пауза плеера, пока окно его закрывает ═══
  const cmd = (fr, func) => { try { fr.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*'); } catch (e) {} };
  function pauseCovered() {
    if (!box || !cur) return;
    const s = box._.sheet.getBoundingClientRect();
    cur.paused = [...doc.querySelectorAll('#mVid iframe, .sh-item.is-active iframe')].filter(fr => {
      const r = fr.getBoundingClientRect();
      return r.width > 10 && r.right > s.left + 4 && r.left < s.right - 4 && r.bottom > s.top + 4 && r.top < s.bottom - 4;
    });
    cur.paused.forEach(fr => cmd(fr, 'pauseVideo'));
  }

  function open(id, o = {}) {
    if (!RE.test(String(id || '')) || !allowed() || !doc?.body) return false;
    build();
    const P = box._;
    const same = cur && cur.id === id && isOpen();
    if (!same) {
      // route — раздел, где открыли (Shorts / главная с окном ролика): ушёл в другой раздел — окно закрывается
      cur = { id, short: !!o.short || doc.body?.dataset?.route === 'shorts', route: String(doc.body?.dataset?.route || ''), parent: '', author: '', opener: o.opener || doc.activeElement, paused: [], mine: [] };
      const d = Y()?.draft?.(id);
      P.ta.value = d ? d.text : '';
      setParent(d ? d.parent : '', '');
    }
    box.hidden = false;
    doc.body.classList.add('ytc-open');
    paintCompose();
    if (!same) fill(id);
    requestAnimationFrame(() => { pauseCovered(); if (!o.resumed) P.x.focus({ preventScroll: true }); });
    return true;
  }
  function close() {
    if (!box || box.hidden) return;
    if (cur) Y()?.saveDraft?.(cur.id, box._.ta.value, cur.parent);
    box.hidden = true;
    doc.body.classList.remove('ytc-open');
    const c = cur; cur = null;
    if (c) { c.paused.forEach(fr => { if (doc.contains(fr)) cmd(fr, 'playVideo'); }); try { if (c.opener && doc.contains(c.opener)) c.opener.focus({ preventScroll: true }); } catch (e) {} }
  }
  function submit() {
    if (!cur || !box) return;
    const P = box._;
    const text = P.ta.value.trim();
    if (!text) return;
    if (!me()) close();   // гость ('on'): окно входа (D37Intent) — после входа окно комментариев откроется снова с этим текстом и отправит его
    const r = Y()?.comment ? Y().comment(cur.id, text, cur.parent) : { ok: false, why: 'off' };
    if (!r.ok && r.why !== 'busy') paintCompose();
    syncSend();
  }
  // ответ D37YtLike: отправлено / не вышло / занято
  root.addEventListener?.('d37:ytcmt', e => {
    const d = e.detail || {};
    if (!box || !cur || d.id !== cur.id) return;
    const P = box._;
    if (d.ok && d.item) {
      const c = d.item;
      mem.delete(cur.id + '|'); if (d.parent) mem.delete(cur.id + '|' + d.parent);
      const node = item(c, d.parent || '', !!d.parent);
      const th = d.parent ? [...P.list.querySelectorAll('.ytc-it:not(.ytc-rep)')].find(x => x.dataset.cid === d.parent) : null;
      if (th) { let reps = th.querySelector('.ytc-reps'); if (!reps) { reps = el('div', 'ytc-reps'); th.append(reps); } reps.prepend(node); }
      else { P.list.querySelector('.ytc-empty')?.remove(); P.list.prepend(node); (cur.mine = cur.mine || []).push(c); }
      P.ta.value = '';
      setParent('', '');
      node.scrollIntoView?.({ block: 'nearest' });
    } else if (d.ok === false) {
      const dr = Y()?.draft?.(cur.id);
      if (dr && !P.ta.value.trim()) P.ta.value = dr.text;
      paintCompose();
    }
    syncSend();
  });

  function css() {
    if (!doc?.head || doc.getElementById('d37YtcCss')) return;
    const s = doc.createElement('style'); s.id = 'd37YtcCss';
    s.textContent = `
.ytc-btn[hidden]{display:none!important}
.ytc[hidden]{display:none!important}
/* под строкой-подсказкой (.xp-toast 9800), над окном ролика (600) и окном входа (9400 — гость сначала закрывает окно, см. submit) */
.ytc{position:fixed;inset:0;z-index:9700}
/* фон прозрачный: поверх играющего ролика ничего не темнеет; закрывает ли окно сам плеер — пауза (pauseCovered) */
.ytc-back{position:absolute;inset:0;background:transparent}
.ytc-sheet{position:absolute;right:0;top:0;bottom:0;width:min(440px,100%);display:flex;flex-direction:column;background:rgb(var(--panel-rgb,22,22,31));color:var(--text,#fff);
  border-left:1px solid var(--line,rgba(255,255,255,.1));box-shadow:-20px 0 60px -20px rgba(0,0,0,.6)}
.ytc-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.8rem 1rem;border-bottom:1px solid var(--line,rgba(255,255,255,.1))}
.ytc-title{font-size:1rem}
.ytc-x,.ytc-to-x{background:none;border:0;color:inherit;font:inherit;font-size:1.1rem;cursor:pointer;padding:.3rem .5rem;border-radius:8px}
.ytc-x:hover,.ytc-to-x:hover{background:rgba(var(--fg-rgb,255,255,255),.08)}
.ytc-list{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:.4rem 1rem}
.ytc-it{padding:.65rem 0;border-bottom:1px solid var(--line,rgba(255,255,255,.08))}
.ytc-rep{padding:.5rem 0 .5rem .8rem;border-bottom:0;border-left:2px solid var(--line,rgba(255,255,255,.12))}
.ytc-mine{background:rgba(255,0,0,.06)}
.ytc-top{display:flex;flex-wrap:wrap;align-items:baseline;gap:.4rem;font-size:.78rem}
.ytc-au{font-weight:800;color:inherit;text-decoration:none;overflow-wrap:anywhere}
a.ytc-au:hover{text-decoration:underline}
.ytc-ago{color:var(--muted,#8d8daa);font-size:.72rem}
.ytc-txt{margin:.3rem 0 0;font-size:.88rem;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
.ytc-row{display:flex;align-items:center;gap:.8rem;margin-top:.35rem;font-size:.74rem;color:var(--muted,#8d8daa)}
.ytc-reply,.ytc-more{background:none;border:0;padding:0;font:inherit;font-size:.74rem;font-weight:700;color:var(--muted,#8d8daa);cursor:pointer;text-decoration:none}
.ytc-reply:hover,.ytc-more:hover{color:var(--text,#fff)}
.ytc-more{margin-top:.4rem;color:#3ea6ff}
.ytc-reps{margin-top:.3rem}
.ytc-empty{color:var(--muted,#8d8daa);font-size:.85rem;margin:.8rem 0}
.ytc-foot{border-top:1px solid var(--line,rgba(255,255,255,.1));padding:.7rem 1rem calc(.7rem + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:.5rem}
.ytc-compose[hidden],.ytc-ytw[hidden],.ytc-to[hidden],.ytc-send[hidden],.ytc-copy[hidden],.ytc-note[hidden]{display:none!important}
.ytc-compose{display:flex;flex-direction:column;gap:.4rem}
.ytc-to{display:flex;align-items:center;justify-content:space-between;font-size:.76rem;color:var(--muted,#8d8daa)}
.ytc-ta{width:100%;box-sizing:border-box;resize:vertical;min-height:2.6rem;max-height:9rem;padding:.55rem .7rem;border-radius:10px;font:inherit;font-size:.88rem;
  color:inherit;background:rgba(var(--fg-rgb,255,255,255),.06);border:1px solid var(--line-hi,rgba(255,255,255,.18))}
.ytc-note{margin:0;font-size:.7rem;line-height:1.4;color:var(--muted,#8d8daa)}
.ytc-send,.ytc-ytw{align-self:flex-end;display:inline-flex;align-items:center;padding:.5rem .95rem;border-radius:10px;border:0;cursor:pointer;font:inherit;font-size:.8rem;font-weight:800;
  color:#fff;background:linear-gradient(135deg,#ff4040,#d90429);text-decoration:none}
.ytc-send:disabled{opacity:.5;cursor:default}
.ytc-ta[readonly]{opacity:.9;cursor:text;border-style:dashed}
.ytc-copy{align-self:flex-end;padding:.45rem .9rem;border-radius:10px;cursor:pointer;font:inherit;font-size:.78rem;font-weight:700;color:inherit;background:rgba(var(--fg-rgb,255,255,255),.08);border:1px solid var(--line-hi,rgba(255,255,255,.18))}
.ytc-copy:hover{background:rgba(var(--fg-rgb,255,255,255),.14)}
.ytc-src{font-size:.68rem;color:var(--muted,#8d8daa)}
.ytc-src a{color:inherit}
@media(max-width:640px){
  .ytc-sheet{top:auto;left:0;width:100%;height:min(78vh,640px);border-left:0;border-top:1px solid var(--line,rgba(255,255,255,.1));border-radius:16px 16px 0 0;box-shadow:0 -20px 60px -20px rgba(0,0,0,.6)}
}`;
    doc.head.appendChild(s);
  }

  if (doc?.addEventListener) {
    css();
    doc.addEventListener('click', e => {
      const b = e.target?.closest?.('.ytc-btn[data-ytc]');
      if (!b) return;
      e.preventDefault();
      open(b.dataset.ytc, { short: !!b.closest('.sh-item'), opener: b });
    });
    // Esc закрывает окно комментариев, а не окно ролика под ним
    root.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) { e.stopImmediatePropagation(); e.preventDefault(); close(); } }, true);
    root.addEventListener('d37:route', () => { if (isOpen() && cur && String(doc.body?.dataset?.route || '') !== cur.route) close(); });
    root.addEventListener('d37:age', () => paint());
    root.addEventListener('d37:auth', () => { paint(); paintCompose(); });
    root.addEventListener('d37:ytl', () => paintCompose());
    const boot = () => {
      paint();
      // окно ролика закрыли — окно его комментариев тоже; открыли другой ролик — кнопка уже с новым id (modal.js)
      const m = doc.getElementById('modal');
      if (m && root.MutationObserver) new root.MutationObserver(() => { if (!m.classList.contains('open') && isOpen() && cur && !cur.short) close(); else paint(m); }).observe(m, { attributes: true, attributeFilter: ['class'] });
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
  }

  root.D37YtComments = { open, close, paint, allowed, isOpen, mode, _test: { load, mem } };
})();
