// ═══════════════════════════════════════
//  ФОРУМ 2.0 — СТАТЬИ (D37Forum2, T-157; владелец 12.11: «нельзя нормально людям выкладывать статьи свои встраивать видео, с файлами.
//  И источником. Как в новостных лентах или пикабу»). Флаг FORUM2 в js/core/config.js — откат одной строкой (старый форум — forum.js).
// ═══════════════════════════════════════
// Адреса раздела: /forum (лента), /forum/t/<метка>, /forum/<id>-<slug> (статья), /forum/new, /forum/edit/<id>, /forum/my (мои и черновики),
// /forum/saved (закладки), /forum/u/<uuid> (статьи автора), /forum/mod (модерация). Те же адреса — серверные страницы для поиска
// (api/_lib/routes/forum.js). Данные — только через функции forum.sql (forum_feed, forum_get, forum_save…): сервер проверяет всё сам.
// Блоки статьи — данные (js/features/forum-blocks.js — та же проверка, что у сервера); здесь их рисуем ТОЛЬКО через DOM и textContent:
// ни одной строки пользователя в innerHTML. Видео — заставка, по нажатию iframe разрешённого сайта с sandbox. Картинки и файлы —
// хранилище 'forum-media' (выключено, пока владелец не включит site_config forum.media). Нет forum.sql на сервере — старый форум.
(() => {
  'use strict';
  if (window.D37Forum2) return;
  const F = window.D37Forum2 = {};
  const B = () => window.D37ForumBlocks;
  const sb = () => (typeof sbClient !== 'undefined' && sbClient) || null;
  const me = () => (typeof currentUser !== 'undefined' && currentUser) || null;
  const role = () => (typeof currentRole !== 'undefined' && currentRole) || '';
  const isMod = () => ['admin', 'moderator', 'helper'].indexOf(role()) >= 0;
  const human = e => (typeof humanErr === 'function' ? humanErr(e) : String(e && e.message || e || 'ошибка'));
  const MEDIA_BUCKET = 'forum-media';
  const SB_BASE = () => (typeof SB_URL !== 'undefined' && SB_URL) || 'https://zdisuowyjgqirhvcyjfq.supabase.co';
  const mediaUrl = key => (/^[0-9a-f-]{36}\/[a-z0-9]{16,40}\.[a-z0-9]{2,5}$/.test(String(key || '')) ? SB_BASE() + '/storage/v1/object/public/' + MEDIA_BUCKET + '/' + key : '');
  const AGE_LABEL = { 0: '0+', 6: '6+', 12: '12+', 16: '16+', 18: '18+' };
  const ROLE_LABEL = { admin: 'админ', moderator: 'модератор', helper: 'помощник' };
  const SORTS = [['hot', '🔥 Горячее'], ['new', '🆕 Свежее'], ['best', '⭐ Лучшее']];
  const PAGE = 20;
  let cfg = null, cfgAt = 0, v2 = null;   // v2: null — не знаем, true — forum.sql 2.0 на сервере, false — старый форум
  let root = null, gen = 0;               // gen — номер отрисовки: устаревшие ответы сервера не рисуем
  const timers = new Set();
  // Детские правила (как чат: js/features/msgview.js MV.rich, сообщества: kidAbout): читателю до 13 — телефоны, почта, соцсети,
  // @ники, «дай номер» → «[скрыто]», адреса сайтов → «[ссылка]», чужие ссылки не нажимаются. Решает js/core/age.js (D37Age.kid)
  const kid = () => { try { return !!(window.D37Age && window.D37Age.kid && window.D37Age.kid()); } catch (e) { return false; } };
  const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"]+/gi;
  const kt = s => { s = String(s == null ? '' : s); return kid() && window.D37Age.kidText ? window.D37Age.kidText(s).replace(URL_RE, '[ссылка]') : s; };

  // ═══ Маленький DOM-помощник: строки — только textContent ═══
  function h(tag, a, ...kids){
    const el = document.createElement(tag);
    if (a) for (const k in a) {
      const v = a[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') { for (const ev in v) el.addEventListener(ev, v[ev]); }
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat(3)) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
    return el;
  }
  const clear = el => { while (el && el.firstChild) el.removeChild(el.firstChild); return el; };
  const day = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); };
  const ago = s => {
    const d = new Date(s); if (isNaN(d)) return '';
    const m = Math.round((Date.now() - d) / 60000);
    if (m < 1) return 'только что'; if (m < 60) return m + ' мин назад'; if (m < 1440) return Math.round(m / 60) + ' ч назад';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  };
  const go = path => (window.D37Route?.go ? window.D37Route.go(path) : (location.hash = '#' + path));
  const artPath = a => '/forum/' + a.id + (a.slug ? '-' + a.slug : '');
  function toast(text){ if (typeof xpToast === 'function') xpToast(text); else { const t = h('div', { class: 'f2-toast', text, role: 'status' }); document.body.append(t); setTimeout(() => t.remove(), 2600); } }
  async function rpc(fn, args){
    const c = sb(); if (!c) throw new Error('нет связи с сервером');
    const { data, error } = await c.rpc(fn, args || {});
    if (error) throw error;
    return data;
  }
  const missing = e => /PGRST202|PGRST205|could not find the function|does not exist/i.test(String((e && (e.code + ' ' + e.message)) || e));
  async function loadCfg(){
    if (cfg && Date.now() - cfgAt < 600e3) return cfg;
    try { cfg = Object.assign({ media: false, files: ['pdf', 'txt', 'zip'], img_kb: 900, file_mb: 10, ads_every: 6 }, await rpc('forum_cfg')); v2 = true; }
    catch (e) { if (missing(e)) v2 = false; cfg = cfg || { media: false, files: ['pdf', 'txt', 'zip'], img_kb: 900, file_mb: 10, ads_every: 6 }; }
    cfgAt = Date.now();
    return cfg;
  }

  // ═══ Вход в раздел ═══
  F.render = async function (param){
    if (!ensureRoot()) return false;
    const my = ++gen;
    await loadCfg();
    if (my !== gen) return true;
    if (v2 === false) { legacy(true); return false; }   // forum.sql 2.0 ещё не применён — старый форум
    legacy(false);
    try { await route(String(param || '')); } catch (e) { console.warn('forum2', e); }
    return true;
  };
  async function route(p){
    let m;
    if (!p) return feedView({ sort: sortPref() });
    if ((m = p.match(/^t\/([^/?#]{1,40})/))) return feedView({ sort: sortPref(), tag: decodeURIComponent(m[1]).toLowerCase() });
    if ((m = p.match(/^u\/([0-9a-f-]{36})/))) return feedView({ sort: 'new', author: m[1] });
    if (p === 'my') return feedView({ sort: 'mine' });
    if (p === 'saved') return feedView({ sort: 'bookmarks' });
    if (p === 'follow') return feedView({ sort: 'follow' });
    if (p === 'mod') return modView();
    if (p === 'new') return editorView(null);
    if ((m = p.match(/^edit\/(\d{1,12})/))) return editorView(+m[1]);
    if ((m = p.match(/^(\d{1,12})/))) return articleView(+m[1]);
    return feedView({ sort: sortPref() });
  }
  F.available = () => v2 !== false;
  function ensureRoot(){
    const page = document.getElementById('forum-page'); if (!page) return false;
    root = document.getElementById('forum2');
    if (!root) { root = h('div', { id: 'forum2', class: 'f2' }); page.append(root); css(); }
    return true;
  }
  function legacy(on){
    ['forumListView', 'forumThreadView', 'forumCreateBtn'].forEach(id => { const el = document.getElementById(id); if (el) el.classList.toggle('f2-off', !on); });
    if (root) root.hidden = on;
  }
  function stopTimers(){ timers.forEach(t => clearInterval(t)); timers.clear(); }
  F.leave = () => { stopTimers(); gen++; flushDraft(); };
  const sortPref = () => { try { return localStorage.getItem('d37_forum_sort') || 'hot'; } catch (e) { return 'hot'; } };
  const setSortPref = s => { try { localStorage.setItem('d37_forum_sort', s); } catch (e) {} };
  function meta(o){ window.D37Route?.meta?.(o); }

  // ═══ Лента ═══
  function topBar(cur){
    const u = me();
    const bar = h('div', { class: 'f2-top' });
    const tabs = h('div', { class: 'f2-tabs', role: 'tablist' });
    SORTS.forEach(([k, label]) => tabs.append(h('a', { class: 'f2-tab' + (cur === k ? ' on' : ''), href: '/forum', role: 'tab', 'aria-selected': cur === k ? 'true' : 'false', text: label,
      on: { click: e => { e.preventDefault(); setSortPref(k); if (location.pathname.replace(/\/+$/, '') !== '/forum') go('/forum'); else F.render(''); } } })));
    if (u) {
      tabs.append(h('a', { class: 'f2-tab' + (cur === 'follow' ? ' on' : ''), href: '/forum/follow', text: '👤 Подписки' }));
      tabs.append(h('a', { class: 'f2-tab' + (cur === 'bookmarks' ? ' on' : ''), href: '/forum/saved', text: '🔖 Закладки' }));
      tabs.append(h('a', { class: 'f2-tab' + (cur === 'mine' ? ' on' : ''), href: '/forum/my', text: '📝 Мои' }));
      if (isMod()) tabs.append(h('a', { class: 'f2-tab' + (cur === 'mod' ? ' on' : ''), href: '/forum/mod', text: '🛡 Модерация' }));
    }
    bar.append(tabs, h('a', { class: 'f2-write', href: '/forum/new', text: '✍️ Написать статью', on: { click: e => { if (!me()) { e.preventDefault(); openAuth(); } } } }));
    return bar;
  }
  function openAuth(){ if (typeof openGlobalAuth === 'function') openGlobalAuth(); else toast('Войди, чтобы писать'); }
  function skeleton(n){ return h('div', { class: 'f2-list', 'aria-busy': 'true' }, Array.from({ length: n }, () => h('div', { class: 'f2-card f2-skel' }, h('i'), h('b'), h('span')))); }
  async function feedView(o){
    const my = gen; stopTimers();
    clear(root);
    const titles = { mine: '📝 Мои статьи и черновики', bookmarks: '🔖 Закладки', follow: '👤 Статьи тех, на кого подписан' };
    meta(o.tag ? { title: '#' + o.tag + ' — статьи на форуме dan4ik37', description: 'Статьи с меткой #' + o.tag + ' на форуме dan4ik37.', canonical: location.origin + '/forum/t/' + encodeURIComponent(o.tag) }
      : { title: 'Форум dan4ik37 — статьи, гайды и новости игр', canonical: location.origin + '/forum' });
    root.append(topBar(o.sort === 'best_week' || o.sort === 'best_month' ? 'best' : o.sort));
    if (o.tag) root.append(h('div', { class: 'f2-taghead' }, h('h3', { text: '#' + o.tag }), h('a', { href: '/forum', text: '× все статьи' })));
    if (titles[o.sort]) root.append(h('h3', { class: 'f2-h', text: titles[o.sort] }));
    if (o.author) root.append(h('h3', { class: 'f2-h', text: 'Статьи автора' }));
    if (o.sort === 'best') {
      const sel = h('select', { class: 'f2-period', 'aria-label': 'За какое время' }, h('option', { value: 'best_week', text: 'за неделю' }), h('option', { value: 'best_month', text: 'за месяц' }), h('option', { value: 'best', text: 'за всё время' }));
      sel.value = o.period || 'best_week';
      sel.addEventListener('change', () => feedView(Object.assign({}, o, { period: sel.value })));
      root.append(h('div', { class: 'f2-sub' }, 'Лучшее ', sel));
    }
    if ((o.sort === 'mine' || o.sort === 'bookmarks' || o.sort === 'follow') && !me()) {
      root.append(h('div', { class: 'f2-empty' }, h('p', { text: 'Войди, чтобы видеть свои статьи, закладки и подписки.' }), h('button', { class: 'f2-btn', text: 'Войти', on: { click: openAuth } })));
      return true;
    }
    const list = skeleton(4); root.append(list);
    const more = h('button', { class: 'f2-more', text: 'Показать ещё', hidden: true });
    root.append(more);
    const sort = o.sort === 'best' ? (o.period || 'best_week') : o.sort;
    let off = 0, first = true;
    const load = async () => {
      more.disabled = true;
      let rows;
      try { rows = await rpc('forum_feed', { p_sort: sort, p_tag: o.tag || null, p_author: o.author || null, p_offset: off, p_limit: PAGE }); }
      catch (e) {
        if (my !== gen) return;
        if (missing(e)) { v2 = false; legacy(true); if (typeof renderForumPage === 'function') renderForumPage(null); return; }
        if (first) { clear(list).removeAttribute('aria-busy'); list.append(errorBox('Лента не загрузилась: ' + human(e), () => feedView(o))); }
        else toast('Не загрузилось: ' + human(e));
        more.disabled = false; return;
      }
      if (my !== gen) return;
      rows = Array.isArray(rows) ? rows : [];
      if (first) { clear(list).removeAttribute('aria-busy'); first = false;
        if (!rows.length) {
          if (sort === 'hot' && !o.tag) return feedView(Object.assign({}, o, { sort: 'new' }));   // горячего (14 дней) пока нет — свежее
          list.append(h('div', { class: 'f2-empty' }, h('p', { text: o.sort === 'mine' ? 'У тебя пока нет статей.' : o.sort === 'bookmarks' ? 'Закладок пока нет — нажми 🔖 у статьи.' : o.sort === 'follow' ? 'Подпишись на авторов — их статьи будут здесь.' : 'Здесь пока пусто — напиши первую статью!' }),
            h('a', { class: 'f2-btn', href: '/forum/new', text: '✍️ Написать статью' })));
        }
      }
      rows.forEach(a => list.append(card(a)));
      off += rows.length;
      more.hidden = rows.length < PAGE; more.disabled = false;
      // реклама в ленте — только в общих лентах (там только опубликованное), через D37AdPlaces
      if (['hot', 'new', 'best', 'best_week', 'best_month'].indexOf(sort) >= 0) window.D37AdPlaces?.feed(list, { place: 'feed_forum', every: +cfg.ads_every || 6, max: 2 });
      if (typeof xpQueueBadges === 'function') xpQueueBadges();
    };
    more.addEventListener('click', load);
    await load();
    return true;
  }
  function errorBox(text, retry){ return h('div', { class: 'f2-empty f2-err' }, h('p', { text }), retry ? h('button', { class: 'f2-btn', text: '↻ Ещё раз', on: { click: retry } }) : null); }
  const STATUS = { draft: ['📝', 'Черновик'], pending: ['⏳', 'На проверке'], hidden: ['🚫', 'Скрыта модератором'] };
  function card(a){
    const B_ = B();
    const href = a.status === 'draft' ? '/forum/edit/' + a.id : artPath(a);
    const pic = a.cover ? mediaUrl(a.cover) : a.video ? B_.poster(a.video) : '';
    const el = h('article', { class: 'f2-card' });
    const link = h('a', { class: 'f2-card-a', href });
    if (pic) link.append(h('div', { class: 'f2-cover' + (a.video && !a.cover ? ' f2-vid' : '') }, h('img', { src: pic, alt: '', loading: 'lazy', decoding: 'async' })));
    link.append(h('h3', { class: 'f2-card-t' }, a.pinned ? '📌 ' : '', a.locked ? '🔒 ' : '', kt(a.title || 'Без названия')));
    if (a.excerpt) link.append(h('p', { class: 'f2-card-x', text: kt(a.excerpt) }));
    el.append(link);
    const st = STATUS[a.status];
    const meta_ = h('div', { class: 'f2-meta' },
      st ? h('span', { class: 'f2-st f2-st-' + a.status, text: st.join(' ') }) : null,
      a.age >= 16 ? h('span', { class: 'f2-age', text: AGE_LABEL[a.age] }) : null,
      nickEl(a), h('span', { text: ago(a.at) }),
      h('span', { class: 'f2-num', title: 'Рейтинг', text: (a.rating > 0 ? '+' : '') + (a.rating || 0) }),
      h('span', { class: 'f2-num', title: 'Комментарии', text: '💬 ' + (a.comments || 0) }));
    el.append(meta_);
    if (a.tags && a.tags.length) el.append(tagsEl(a.tags));
    return el;
  }
  function nickEl(a){
    const s = h('span', { class: 'f2-nick', dataset: { miniUid: a.author_id || '', miniNick: a.nick || '' } }, a.nick || 'игрок');
    if (ROLE_LABEL[a.role]) s.append(h('span', { class: 'f2-role', text: ROLE_LABEL[a.role] }));
    s.append(h('span', { class: 'lv-badge', dataset: { lvUid: a.author_id || '' } }));
    return s;
  }
  function tagsEl(tags){ return h('div', { class: 'f2-tags' }, tags.map(t => h('a', { class: 'f2-tag', href: '/forum/t/' + encodeURIComponent(t), text: '#' + t }))); }

  // ═══ Статья ═══
  async function articleView(id){
    const my = gen; stopTimers();
    clear(root);
    root.append(h('a', { class: 'f2-back', href: '/forum', text: '← Все статьи' }));
    const box = h('div', { class: 'f2-art f2-skel-art', 'aria-busy': 'true' }, h('i'), h('b'), h('span'), h('span'));
    root.append(box);
    let a;
    try { a = await rpc('forum_get', { p_id: id }); }
    catch (e) { if (my !== gen) return; if (missing(e)) { v2 = false; legacy(true); if (typeof renderForumPage === 'function') renderForumPage(String(id)); return; }
      clear(box).removeAttribute('aria-busy'); box.className = 'f2-art'; box.append(errorBox('Статья не загрузилась: ' + human(e), () => articleView(id))); return; }
    if (my !== gen) return;
    clear(box).removeAttribute('aria-busy'); box.className = 'f2-art';
    if (!a || !a.ok) {
      box.append(errorBox(a && a.reason === 'age' ? 'Эта статья — для тех, кто старше.' : 'Статья не найдена: её удалили, скрыли или она ещё на проверке.'));
      meta({ title: 'Статья не найдена — форум dan4ik37', noindex: true });
      return;
    }
    const canon = location.origin + artPath(a);
    meta({ title: kt(a.title) + ' — форум dan4ik37', description: kt(a.excerpt || '').slice(0, 160), canonical: canon, noindex: a.status !== 'published' || a.age > 12 });
    if (location.pathname !== artPath(a) && /^\/forum\/\d/.test(location.pathname)) window.D37Route?.setUrl?.(artPath(a));   // старый адрес /forum/5 → /forum/5-slug
    const st = STATUS[a.status];
    if (st) box.append(h('div', { class: 'f2-banner f2-st-' + a.status }, st.join(' '), a.status === 'pending' ? ' — её видишь только ты и модераторы. Обычно проверка недолгая.' : '',
      a.mod_note ? h('div', { class: 'f2-note', text: 'Модератор: ' + a.mod_note }) : null));
    box.append(h('h1', { class: 'f2-title' }, a.pinned ? '📌 ' : '', a.locked ? '🔒 ' : '', kt(a.title || 'Без названия')));
    box.append(h('div', { class: 'f2-meta' }, nickEl(a), h('time', { datetime: a.at, text: day(a.at) }), a.edited_at ? h('span', { class: 'f2-muted', text: 'изменено ' + ago(a.edited_at) }) : null,
      a.age >= 16 ? h('span', { class: 'f2-age', text: AGE_LABEL[a.age] }) : null));
    box.append(renderBlocks(a.blocks));
    if (a.source_url) box.append(sourceEl(a.source_url, a.source_title));
    if (a.tags && a.tags.length) box.append(tagsEl(a.tags));
    box.append(actions(a));
    if (a.ads && a.status === 'published') {   // одно место рекламы в статье — только опубликованная, проверенная, без жалоб, до 12+
      const slot = h('div', { class: 'f2-adwrap' }); slot.append(h('div', { dataset: { ad: 'forum_article' }, hidden: true }));
      box.append(slot); try { window.D37Ads?.fillAll?.(); } catch (e) {}
    }
    root.append(await commentsEl(a, my));
    if (typeof xpQueueBadges === 'function') xpQueueBadges();
    if (location.hash && /^#c\d+$/.test(location.hash)) { const c = document.getElementById(location.hash.slice(1)); c?.scrollIntoView?.({ block: 'center' }); }
    return true;
  }
  function sourceEl(url, title){
    let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
    if (kid()) return h('div', { class: 'f2-source' }, '📰 Источник: ', h('span', { text: kt(title || host || 'сайт') }));   // ребёнку — без перехода
    return h('div', { class: 'f2-source' }, '📰 Источник: ', h('a', { href: url, rel: 'nofollow ugc noopener', target: '_blank', text: title || host || url }), title && host ? h('span', { class: 'f2-muted', text: ' · ' + host }) : null);
  }
  // Блоки → DOM (тот же порядок, что toHtml на сервере). Только textContent; ссылки — https и rel="nofollow ugc noopener"
  function renderBlocks(blocks){
    const B_ = B(), body = h('div', { class: 'f2-body' });
    (Array.isArray(blocks) ? blocks : []).forEach(b => {
      if (!b || typeof b !== 'object') return;
      if (b.t === 'p') {
        const p = h('p');
        (b.r || []).forEach(r => {
          if (!r || typeof r.x !== 'string') return;
          let n = document.createTextNode(kt(r.x));
          if (r.b) n = h('strong', null, n);
          if (r.i) n = h('em', null, n);
          if (r.h && B_.https(r.h) && !kid()) n = h('a', { href: r.h, rel: 'nofollow ugc noopener', target: '_blank' }, n);
          p.append(n);
        });
        body.append(p);
      } else if (b.t === 'h') body.append(h(b.l === 3 ? 'h3' : 'h2', { text: kt(b.x || '') }));
      else if (b.t === 'list') body.append(h(b.o ? 'ol' : 'ul', null, (b.items || []).map(x => h('li', { text: kt(x) }))));
      else if (b.t === 'quote') body.append(h('blockquote', null, h('p', { text: kt(b.x || '') }), b.by ? h('footer', { text: '— ' + kt(b.by) }) : null));
      else if (b.t === 'img') {
        const u = b.blob || mediaUrl(b.src); if (!u) return;
        const img = h('img', { src: u, alt: kt(b.cap || ''), loading: 'lazy', decoding: 'async' });
        if (b.w && b.h) { img.width = b.w; img.height = b.h; }
        body.append(h('figure', null, img, b.cap ? h('figcaption', { text: kt(b.cap) }) : null));
      } else if (b.t === 'video') body.append(videoEl(b));
      else if (b.t === 'file') {
        const u = mediaUrl(b.key);
        body.append(h('p', { class: 'f2-file' }, '📎 ', u ? h('a', { href: u + '?download=' + encodeURIComponent(b.name || 'file'), rel: 'nofollow noopener', download: b.name || '', 'data-server': '', text: kt(b.name || 'файл') }) : h('span', { text: kt(b.name || 'файл') }),
          b.size ? h('span', { class: 'f2-muted', text: ' · ' + B_.fmtSize(b.size) }) : null, h('span', { class: 'f2-muted', text: ' · только скачать, не открываем на сайте' })));
      } else if (b.t === 'hr') body.append(h('hr'));
    });
    return body;
  }
  // Видео: заставка → по нажатию iframe разрешённого сайта (sandbox, без доступа к странице сайта)
  function videoEl(b){
    const B_ = B();
    if (!B_.videoOk(b.p, b.id)) return h('span');
    const poster = B_.poster(b);
    const fig = h('figure', { class: 'f2-video' });
    const btn = h('button', { class: 'f2-vplay', type: 'button', 'aria-label': 'Включить видео ' + B_.providerName(b.p) },
      poster ? h('img', { src: poster, alt: '', loading: 'lazy' }) : h('span', { class: 'f2-vprov', text: B_.providerName(b.p) }),
      h('span', { class: 'f2-vicon', text: '▶' }), h('span', { class: 'f2-vlabel', text: B_.providerName(b.p) + ' · нажми, чтобы смотреть' }));
    btn.addEventListener('click', () => {
      const src = B_.embedUrl(b, location.hostname || 'dan4ik37.vercel.app'); if (!src) return;
      const fr = h('iframe', { src, title: 'Видео ' + B_.providerName(b.p), allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture', allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin', sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox' });
      btn.replaceWith(h('div', { class: 'f2-vframe' }, fr));
    });
    fig.append(btn);
    fig.append(h('figcaption', null, b.cap ? kt(b.cap) + ' · ' : '', h('a', { href: B_.watchUrl(b), rel: 'nofollow noopener', target: '_blank', text: 'открыть на ' + B_.providerName(b.p) })));
    return fig;
  }
  function actions(a){
    const u = me(), bar = h('div', { class: 'f2-actions' });
    const rating = h('span', { class: 'f2-rating', text: (a.rating > 0 ? '+' : '') + (a.rating || 0) });
    const up = h('button', { class: 'f2-vote' + (a.my === 1 ? ' on' : ''), 'aria-label': 'Плюс', text: '▲' });
    const down = h('button', { class: 'f2-vote down' + (a.my === -1 ? ' on' : ''), 'aria-label': 'Минус', text: '▼' });
    const vote = async v => {
      if (!u) return openAuth();
      if (a.status !== 'published') return toast('Статья ещё на проверке');
      const nv = a.my === v ? 0 : v;
      try { const r = await rpc('forum_vote', { p_id: a.id, p_v: nv }); if (!r.ok) return toast(B().reason(r.reason)); a.my = r.my; a.rating = r.rating;
        rating.textContent = (r.rating > 0 ? '+' : '') + r.rating; up.classList.toggle('on', r.my === 1); down.classList.toggle('on', r.my === -1); }
      catch (e) { toast(human(e)); }
    };
    up.addEventListener('click', () => vote(1)); down.addEventListener('click', () => vote(-1));
    if (!a.mine) bar.append(h('span', { class: 'f2-votes' }, up, rating, down)); else bar.append(h('span', { class: 'f2-votes' }, h('span', { class: 'f2-muted', text: 'Рейтинг ' }), rating));
    const bm = h('button', { class: 'f2-act' + (a.bm ? ' on' : ''), text: a.bm ? '🔖 В закладках' : '🔖 В закладки' });
    bm.addEventListener('click', async () => {
      if (!u) return openAuth();
      try { const r = await rpc('forum_bookmark', { p_id: a.id, p_on: !a.bm }); if (!r.ok) return toast(B().reason(r.reason)); a.bm = r.bm; bm.textContent = a.bm ? '🔖 В закладках' : '🔖 В закладки'; bm.classList.toggle('on', a.bm); }
      catch (e) { toast(human(e)); }
    });
    bar.append(bm);
    bar.append(h('button', { class: 'f2-act', text: '🔗 Поделиться', on: { click: () => share(a) } }));
    if (!a.mine && a.author_id) {
      const fl = h('button', { class: 'f2-act' + (a.follow ? ' on' : ''), text: a.follow ? '✓ Ты подписан' : '👤 Подписаться на автора' });
      fl.addEventListener('click', async () => {
        if (!u) return openAuth();
        try { const r = await rpc('forum_follow', { p_author: a.author_id, p_on: !a.follow }); if (!r.ok) return toast(B().reason(r.reason)); a.follow = r.follow; fl.textContent = a.follow ? '✓ Ты подписан' : '👤 Подписаться на автора'; fl.classList.toggle('on', a.follow); }
        catch (e) { toast(human(e)); }
      });
      bar.append(fl);
    }
    if (a.mine) {
      if (a.status !== 'hidden') bar.append(h('a', { class: 'f2-act', href: '/forum/edit/' + a.id, text: '✏️ Изменить' }));
      bar.append(h('button', { class: 'f2-act f2-danger', text: '🗑 Удалить', on: { click: () => del(a) } }));
    } else if (u) bar.append(h('button', { class: 'f2-act', text: '⚑ Пожаловаться', on: { click: () => report('article', a.id) } }));
    if (a.mod) bar.append(modBar(a));
    return bar;
  }
  function share(a){
    const url = (window.D37Ref?.wrap || (x => x))(location.origin + artPath(a));
    if (navigator.share) { navigator.share({ title: a.title, url }).catch(() => {}); return; }
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('🔗 Ссылка скопирована'), () => prompt('Скопируй ссылку:', url));
  }
  async function del(a){
    if (!confirm('Удалить статью вместе с комментариями? Вернуть будет нельзя.')) return;
    try { const r = await rpc('forum_delete', { p_id: a.id }); if (!r.ok) return toast(B().reason(r.reason)); toast('Статья удалена'); go('/forum/my'); }
    catch (e) { toast(human(e)); }
  }
  async function report(kind, id){
    const why = prompt('Что не так? (спам, оскорбления, обман, личные данные…)', '');
    if (why === null) return;
    try { const r = await rpc('forum_report', { p_kind: kind, p_id: id, p_why: why }); if (!r.ok) return toast(B().reason(r.reason)); toast('Спасибо! Модераторы посмотрят'); }
    catch (e) { toast(human(e)); }
  }
  function modBar(a){
    const box = h('div', { class: 'f2-modbar' }, h('b', { text: '🛡 ' }));
    const act = (label, action, cls) => h('button', { class: 'f2-act' + (cls ? ' ' + cls : ''), text: label, on: { click: async () => {
      const note = action === 'hide' ? prompt('Причина (увидит автор):', 'нарушение правил') : '';
      if (note === null) return;
      try { const r = await rpc('forum_mod', { p_action: action, p_id: a.id, p_note: note || '' }); if (!r.ok) return toast(B().reason(r.reason)); toast('Готово'); F.render(String(a.id)); }
      catch (e) { toast(human(e)); }
    } } });
    if (a.status === 'pending' || a.status === 'hidden') box.append(act('✅ Опубликовать', 'approve'));
    if (a.status !== 'hidden') box.append(act('🚫 Скрыть', 'hide', 'f2-danger'));
    box.append(act(a.locked ? '🔓 Открыть комментарии' : '🔒 Закрыть комментарии', a.locked ? 'unlock' : 'lock'));
    box.append(act(a.pinned ? 'Открепить' : '📌 Закрепить', a.pinned ? 'unpin' : 'pin'));
    if (a.reports) box.append(h('span', { class: 'f2-muted', text: ' жалоб: ' + a.reports }));
    if (!a.mine) box.append(h('button', { class: 'f2-act f2-danger', text: '🗑 Удалить', on: { click: () => del(a) } }));
    return box;
  }

  // ═══ Комментарии деревом ═══
  async function commentsEl(a, my){
    const wrap = h('section', { class: 'f2-comments', id: 'f2c' });
    wrap.append(h('h2', { class: 'f2-h', text: 'Комментарии' + (a.comments ? ' · ' + a.comments : '') }));
    const listBox = h('div', { class: 'f2-clist' }, h('div', { class: 'f2-skel-c' }));
    const u = me();
    const form = () => {
      if (a.status !== 'published') return h('p', { class: 'f2-muted', text: 'Комментарии откроются после проверки статьи.' });
      if (a.locked && !a.mod) return h('p', { class: 'f2-muted', text: '🔒 Комментарии закрыты' });
      if (!u) return h('p', { class: 'f2-muted' }, h('button', { class: 'f2-link', text: 'Войди', on: { click: openAuth } }), ', чтобы ответить.');
      return replyBox(a, null, () => reload());
    };
    wrap.append(form(), listBox);
    const reload = async () => {
      let rows;
      try { rows = await rpc('forum_comments', { p_id: a.id }); }
      catch (e) { clear(listBox).append(errorBox('Комментарии не загрузились: ' + human(e), reload)); return; }
      if (my !== gen) return;
      clear(listBox);
      const tr = B().tree(Array.isArray(rows) ? rows : []);
      if (!tr.length) listBox.append(h('p', { class: 'f2-muted', text: 'Пока никто не ответил — будь первым!' }));
      tr.forEach(n => listBox.append(commentEl(a, n, reload, 0)));
      if (typeof xpQueueBadges === 'function') xpQueueBadges();
    };
    await reload();
    return wrap;
  }
  function commentEl(a, c, reload, depth){
    const el = h('div', { class: 'f2-c' + (depth ? ' f2-c-sub' : ''), id: 'c' + c.id });
    const head = h('div', { class: 'f2-c-head' }, nickEl(c), h('span', { class: 'f2-muted', text: ago(c.at) + (c.edited_at ? ' · изменено' : '') }));
    const body = h('div', { class: 'f2-c-body', text: c.deleted ? 'комментарий удалён' : kt(c.body) });
    if (c.deleted) body.classList.add('f2-muted');
    const tools = h('div', { class: 'f2-c-tools' });
    const u = me();
    if (!c.deleted && u && a.status === 'published' && (!a.locked || a.mod)) tools.append(h('button', { class: 'f2-link', text: 'Ответить', on: { click: () => {
      if (el.querySelector(':scope > .f2-reply')) return;
      el.insertBefore(replyBox(a, c.id, reload), el.querySelector(':scope > .f2-kids'));
    } } }));
    if (!c.deleted && c.mine && Date.now() - new Date(c.at) < 864e5) tools.append(h('button', { class: 'f2-link', text: 'Изменить', on: { click: () => {
      const ta = h('textarea', { class: 'f2-ta', maxlength: 4000, rows: 3 }); ta.value = c.body;
      const save = h('button', { class: 'f2-btn sm', text: 'Сохранить' });
      save.addEventListener('click', async () => {
        try { const r = await rpc('forum_comment_edit', { p_id: c.id, p_body: ta.value, p_delete: false }); if (!r.ok) return toast(B().reason(r.reason)); reload(); } catch (e) { toast(human(e)); }
      });
      body.replaceWith(h('div', { class: 'f2-reply' }, ta, save));
    } } }));
    if (!c.deleted && (c.mine || a.mod)) tools.append(h('button', { class: 'f2-link f2-danger', text: 'Удалить', on: { click: async () => {
      if (!confirm('Удалить комментарий?')) return;
      try { const r = c.mine ? await rpc('forum_comment_edit', { p_id: c.id, p_body: '', p_delete: true }) : await rpc('forum_mod', { p_action: 'delete_comment', p_id: c.id, p_note: '' });
        if (!r.ok) return toast(B().reason(r.reason)); reload(); } catch (e) { toast(human(e)); }
    } } }));
    if (!c.deleted && u && !c.mine) tools.append(h('button', { class: 'f2-link', text: '⚑', title: 'Пожаловаться', 'aria-label': 'Пожаловаться на комментарий', on: { click: () => report('comment', c.id) } }));
    el.append(head, body, tools);
    if (c.kids && c.kids.length) el.append(h('div', { class: 'f2-kids' }, c.kids.map(k => commentEl(a, k, reload, depth + 1))));
    return el;
  }
  function replyBox(a, parent, done){
    const ta = h('textarea', { class: 'f2-ta', maxlength: 4000, rows: parent ? 2 : 3, placeholder: parent ? 'Твой ответ…' : 'Напиши комментарий…' });
    const send = h('button', { class: 'f2-btn sm', text: 'Отправить' });
    const err = h('div', { class: 'f2-err-line', role: 'alert' });
    send.addEventListener('click', async () => {
      const t = ta.value.trim(); if (!t) return;
      send.disabled = true; err.textContent = '';
      try { const r = await rpc('forum_comment', { p_thread: a.id, p_parent: parent, p_body: t }); if (!r.ok) { err.textContent = B().reason(r.reason); return; } ta.value = ''; done(); }
      catch (e) { err.textContent = human(e); }
      finally { send.disabled = false; }
    });
    return h('div', { class: 'f2-reply' }, ta, h('div', { class: 'f2-row' }, send, err));
  }

  // ═══ Редактор (телефон в первую очередь) ═══
  // Текст в редакторе — простая разметка: **жирный**, *курсив*, [текст](https://ссылка); кнопки Ж / К / 🔗 оборачивают выделенное.
  function runsToMd(runs){
    return (runs || []).map(r => { let s = r.x || ''; if (r.h) s = '[' + s + '](' + r.h + ')'; if (r.b) s = '**' + s + '**'; if (r.i) s = '*' + s + '*'; return s; }).join('');
  }
  function mdToRuns(s){
    const out = []; let i = 0; s = String(s || '');
    const re = /\*\*\*([^*\n]+?)\*\*\*|\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*|\[([^\]\n]{1,300})\]\((https:\/\/[^\s)]{3,500})\)/g;
    let m;
    const push = (x, o) => { if (!x) return; const r = Object.assign({ x }, o); out.push(r); };
    while ((m = re.exec(s))) {
      push(s.slice(i, m.index));
      if (m[1] != null) mdToRuns(m[1]).forEach(r => out.push(Object.assign(r, { b: 1, i: 1 })));
      else if (m[2] != null) mdToRuns(m[2]).forEach(r => out.push(Object.assign(r, { b: 1 })));
      else if (m[3] != null) mdToRuns(m[3]).forEach(r => out.push(Object.assign(r, { i: 1 })));
      else push(m[4], { h: m[5] });
      i = m.index + m[0].length;
    }
    push(s.slice(i));
    return out;
  }
  F._md = { runsToMd, mdToRuns };   // для node-теста (scripts/forum-test.cjs)
  F._render = b => renderBlocks(b);
  let ed = null;   // { id, doc, status, dirty, savedAt, el }
  const draftKey = id => 'd37_forum_draft_' + (id || 'new') + '_' + (me()?.id || '');
  function flushDraft(){ if (ed && ed.dirty) { try { localStorage.setItem(draftKey(ed.id), JSON.stringify({ at: Date.now(), doc: ed.doc })); } catch (e) {} } }
  function blank(){ return { title: '', blocks: [{ t: 'p', r: [] }], tags: [], cover: null, source_url: '', source_title: '', age: 12 }; }
  async function editorView(id){
    const my = gen; stopTimers();
    clear(root);
    meta({ title: (id ? 'Изменить статью' : 'Новая статья') + ' — форум dan4ik37', noindex: true });
    if (!me()) { root.append(h('div', { class: 'f2-empty' }, h('p', { text: 'Войди, чтобы писать статьи.' }), h('button', { class: 'f2-btn', text: 'Войти', on: { click: openAuth } }))); return true; }
    let doc = blank(), status = 'new';
    if (id) {
      try {
        const a = await rpc('forum_get', { p_id: id });
        if (my !== gen) return;
        if (!a || !a.ok || !a.mine) { root.append(errorBox('Эту статью нельзя изменить.')); return; }
        if (a.status === 'hidden') { root.append(errorBox('Статью скрыл модератор — изменить её нельзя.')); return; }
        doc = { title: a.title || '', blocks: a.blocks && a.blocks.length ? a.blocks : [{ t: 'p', r: [] }], tags: a.tags || [], cover: a.cover, source_url: a.source_url || '', source_title: a.source_title || '', age: a.age ?? 12 };
        status = a.status;
      } catch (e) { root.append(errorBox('Не загрузилось: ' + human(e), () => editorView(id))); return; }
    }
    // локальный черновик новее — предложить
    try {
      const loc = JSON.parse(localStorage.getItem(draftKey(id)) || 'null');
      if (loc && loc.doc && Date.now() - loc.at < 30 * 864e5 && JSON.stringify(loc.doc) !== JSON.stringify(doc) && (loc.doc.title || (loc.doc.blocks || []).some(b => b.t !== 'p' || (b.r || []).length))) {
        if (confirm('Есть несохранённый черновик этой статьи на этом устройстве. Вернуть его?')) doc = loc.doc;
      }
    } catch (e) {}
    ed = { id, doc, status, dirty: false, savedAt: 0, serverAt: 0, saving: false };
    drawEditor();
    // автосохранение: в браузер — сразу (через 0,8 с), на сервер — черновик раз в 20 с (опубликованную — только по кнопке)
    const t = setInterval(() => { if (ed && ed.dirty && ed.status !== 'published' && ed.status !== 'pending' && Date.now() - ed.serverAt > 20000) saveServer(false, true); }, 5000);
    timers.add(t);
    return true;
  }
  function touch(){
    if (!ed) return;
    ed.dirty = true;
    clearTimeout(ed.lt); ed.lt = setTimeout(() => { flushDraft(); setSaved('сохранено на устройстве'); }, 800);
    if (ed.preview && !ed.preview.hidden) drawPreview();
  }
  function setSaved(t){ const s = root.querySelector('.f2-saved'); if (s) s.textContent = t; }
  function drawEditor(){
    clear(root);
    const d = ed.doc, c = cfg || {};
    root.append(h('a', { class: 'f2-back', href: ed.id ? '/forum/' + ed.id : '/forum', text: '← ' + (ed.id ? 'К статье' : 'К ленте') }));
    const wrap = h('div', { class: 'f2-ed' });
    const tabs = h('div', { class: 'f2-edtabs' });
    const tEdit = h('button', { class: 'f2-tab on', text: '✏️ Писать' }), tPrev = h('button', { class: 'f2-tab', text: '👁 Просмотр' });
    tabs.append(tEdit, tPrev, h('span', { class: 'f2-saved f2-muted', text: ed.status === 'published' ? 'правки увидят после «Сохранить»' : '' }));
    const form = h('div', { class: 'f2-edform' });
    const prev = h('div', { class: 'f2-art f2-prev', hidden: true });
    ed.preview = prev;
    tEdit.addEventListener('click', () => { form.hidden = false; prev.hidden = true; tEdit.classList.add('on'); tPrev.classList.remove('on'); });
    tPrev.addEventListener('click', () => { form.hidden = true; prev.hidden = false; tPrev.classList.add('on'); tEdit.classList.remove('on'); drawPreview(); });
    const title = h('input', { class: 'f2-titlein', maxlength: 140, placeholder: 'Заголовок статьи', 'aria-label': 'Заголовок', value: d.title || '' });
    title.addEventListener('input', () => { d.title = title.value; touch(); });
    form.append(title);
    const list = h('div', { class: 'f2-blocks' });
    form.append(list);
    const redraw = () => { clear(list); d.blocks.forEach((b, i) => list.append(blockEditor(b, i, redraw))); };
    redraw();
    // большие кнопки «добавить»
    const add = (b) => { d.blocks.push(b); redraw(); touch(); const last = list.lastElementChild; last?.querySelector('textarea,input')?.focus(); last?.scrollIntoView?.({ block: 'center' }); };
    const media = !!c.media;
    const adds = h('div', { class: 'f2-adds' },
      h('button', { class: 'f2-add', text: '📝 Текст', on: { click: () => add({ t: 'p', r: [] }) } }),
      h('button', { class: 'f2-add', text: '🖼 Фото', disabled: !media, title: media ? '' : 'Фото включит владелец сайта', on: { click: () => pickFile('img', add) } }),
      h('button', { class: 'f2-add', text: '🎬 Видео', on: { click: () => add({ t: 'video', p: '', id: '', _url: '' }) } }),
      h('button', { class: 'f2-add', text: '📎 Файл', disabled: !media, title: media ? '' : 'Файлы включит владелец сайта', on: { click: () => pickFile('file', add) } }),
      h('button', { class: 'f2-add', text: '❝ Цитата', on: { click: () => add({ t: 'quote', x: '' }) } }),
      h('button', { class: 'f2-add', text: '📰 Источник', on: { click: () => { const s = form.querySelector('.f2-srcurl'); s?.scrollIntoView?.({ block: 'center' }); s?.focus(); } } }));
    const adds2 = h('div', { class: 'f2-adds f2-adds-sm' },
      h('button', { class: 'f2-add sm', text: 'Заголовок', on: { click: () => add({ t: 'h', x: '', l: 2 }) } }),
      h('button', { class: 'f2-add sm', text: 'Список', on: { click: () => add({ t: 'list', o: 0, items: [] }) } }),
      h('button', { class: 'f2-add sm', text: '— Линия', on: { click: () => add({ t: 'hr' }) } }));
    form.append(h('div', { class: 'f2-addbox' }, h('div', { class: 'f2-muted f2-addh', text: 'Добавить блок:' }), adds, adds2,
      media ? null : h('div', { class: 'f2-muted f2-note', text: 'Фото и файлы пока выключены — их включит владелец сайта. Видео — ссылкой на YouTube, VK Видео, RuTube или Twitch.' })));
    // источник, метки, возраст
    const srcUrl = h('input', { class: 'f2-in f2-srcurl', type: 'url', inputmode: 'url', maxlength: 500, placeholder: 'https://… — откуда взята новость', value: d.source_url || '' });
    const srcTitle = h('input', { class: 'f2-in', maxlength: 140, placeholder: 'Название источника (например, «Игромания»)', value: d.source_title || '' });
    srcUrl.addEventListener('input', () => { d.source_url = srcUrl.value.trim(); touch(); });
    srcTitle.addEventListener('input', () => { d.source_title = srcTitle.value; touch(); });
    const tags = h('input', { class: 'f2-in', maxlength: 140, placeholder: 'метки через запятую: minecraft, гайд, новости', value: (d.tags || []).join(', ') });
    tags.addEventListener('input', () => { d.tags = tags.value.split(/[,\s]+/).map(x => x.replace(/^#/, '').trim().toLowerCase()).filter(Boolean).slice(0, 5); touch(); });
    const age = h('select', { class: 'f2-in', 'aria-label': 'Для какого возраста' }, [0, 6, 12, 16].map(n => h('option', { value: String(n), text: AGE_LABEL[n] + (n === 12 ? ' — обычная' : n === 16 ? ' — для старших' : '') })));
    age.value = String(d.age ?? 12);
    age.addEventListener('change', () => { d.age = +age.value; touch(); });
    form.append(h('div', { class: 'f2-fields' },
      h('label', { class: 'f2-lab' }, h('span', { text: '📰 Источник (ссылка + название)' }), srcUrl, srcTitle),
      h('label', { class: 'f2-lab' }, h('span', { text: '🏷 Метки (до 5)' }), tags),
      h('label', { class: 'f2-lab' }, h('span', { text: '🔞 Для какого возраста' }), age)));
    const err = h('div', { class: 'f2-err-line', role: 'alert' });
    const btnDraft = h('button', { class: 'f2-btn ghost', text: ed.status === 'published' || ed.status === 'pending' ? '💾 Сохранить правки' : '💾 Сохранить черновик' });
    const btnPub = h('button', { class: 'f2-btn', text: ed.status === 'published' ? '✅ Сохранить и показать' : '🚀 Опубликовать' });
    btnDraft.addEventListener('click', () => saveServer(false, false));
    btnPub.addEventListener('click', () => saveServer(true, false));
    form.append(h('div', { class: 'f2-pubbar' }, err, h('div', { class: 'f2-row' }, btnDraft, btnPub)),
      h('p', { class: 'f2-muted f2-note', text: 'Правила: своё или со ссылкой на источник, без оскорблений, рекламы и личных данных. Первые статьи новых авторов и ссылки новичков сначала смотрит модератор.' }));
    ed.err = err;
    wrap.append(tabs, form, prev);
    root.append(wrap);
  }
  function drawPreview(){
    if (!ed || !ed.preview) return;
    const p = clear(ed.preview), d = ed.doc;
    p.append(h('h1', { class: 'f2-title', text: d.title || 'Без названия' }));
    p.append(renderBlocks(toDoc().blocks.map((b, i) => (b.t === 'img' && d.blocks[i] && d.blocks[i].blob ? Object.assign({}, b, { blob: d.blocks[i].blob }) : b))));
    if (d.source_url && B().https(d.source_url)) p.append(sourceEl(d.source_url, d.source_title));
    if (d.tags && d.tags.length) p.append(tagsEl(d.tags));
  }
  // Документ для сервера: служебные поля редактора (_url, blob, _md) убираем, текст из разметки → runs
  function toDoc(){
    const d = ed.doc;
    const blocks = d.blocks.map(b => {
      if (b.t === 'p') return { t: 'p', r: b._md != null ? mdToRuns(b._md) : (b.r || []) };
      if (b.t === 'video') return { t: 'video', p: b.p, id: b.id, cap: b.cap || undefined };
      if (b.t === 'img') return { t: 'img', src: b.src, w: b.w, h: b.h, cap: b.cap || undefined };
      if (b.t === 'list') return { t: 'list', o: b.o ? 1 : 0, items: b._txt != null ? b._txt.split('\n') : (b.items || []) };
      const o = Object.assign({}, b); delete o.blob; delete o._url; return o;
    });
    return { title: d.title || '', blocks, tags: d.tags || [], cover: d.cover || null, source_url: d.source_url || '', source_title: d.source_title || '', age: d.age ?? 12 };
  }
  async function saveServer(publish, auto){
    if (!ed || ed.saving) return;
    const doc = toDoc();
    const v = B().check(doc, { publish: publish || ed.status === 'published', media: !!(cfg && cfg.media), files: cfg && cfg.files, uid: me()?.id, mod: isMod() });
    if (!v.ok) {
      if (auto) return;
      showErr(v);
      return;
    }
    if (auto && !doc.title && v.chars < 10 && !v.media && !v.videos) return;   // пустое не шлём
    ed.saving = true; if (!auto) ed.err.textContent = '⏳ Сохраняем…';
    try {
      const r = await rpc('forum_save', { p_id: ed.id, p_doc: doc, p_publish: !!publish });
      if (!r || !r.ok) { if (!auto) showErr(r || {}); return; }
      const first = !ed.id;
      ed.id = r.id; ed.status = r.status; ed.dirty = false; ed.serverAt = Date.now();
      try { localStorage.removeItem(draftKey(first ? null : r.id)); localStorage.removeItem(draftKey(r.id)); } catch (e) {}
      if (first) window.D37Route?.setUrl?.('/forum/edit/' + r.id);
      if (auto) { setSaved('черновик сохранён · ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })); return; }
      ed.err.textContent = '';
      if (r.status === 'published') {
        toast(publish ? '🎉 Статья опубликована!' : 'Сохранено');
        pingSearch(r.id);
        ed = null; go('/forum/' + r.id + (r.slug ? '-' + r.slug : ''));
      } else if (r.status === 'pending') { toast('⏳ Статья у модераторов — после проверки её увидят все'); ed = null; go('/forum/' + r.id); }
      else setSaved('черновик сохранён');
    } catch (e) { if (!auto) ed.err.textContent = human(e); }
    finally { if (ed) ed.saving = false; }
  }
  function showErr(v){
    if (!ed) return;
    ed.err.textContent = B().reason(v.reason);
    root.querySelectorAll('.f2-bed.bad').forEach(x => x.classList.remove('bad'));
    if (v.at != null && v.at >= 0) { const el = root.querySelectorAll('.f2-bed')[v.at]; if (el) { el.classList.add('bad'); el.scrollIntoView?.({ block: 'center' }); } }
  }
  // Сообщить поисковикам (IndexNow) о новой статье — сервер сам проверит, что она опубликована, и сообщит один раз
  function pingSearch(id){ try { fetch('/api/forum-ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }), keepalive: true }).catch(() => {}); } catch (e) {} }
  function blockEditor(b, i, redraw){
    const d = ed.doc, B_ = B();
    const names = { p: '📝 Текст', h: 'Заголовок', list: 'Список', quote: '❝ Цитата', img: '🖼 Фото', video: '🎬 Видео', file: '📎 Файл', hr: '— Линия' };
    const box = h('div', { class: 'f2-bed', dataset: { t: b.t } });
    const move = dir => { const j = i + dir; if (j < 0 || j >= d.blocks.length) return; const t = d.blocks[i]; d.blocks[i] = d.blocks[j]; d.blocks[j] = t; redraw(); touch(); };
    box.append(h('div', { class: 'f2-bed-head' }, h('span', { class: 'f2-bed-name', text: names[b.t] || b.t }),
      h('button', { class: 'f2-ib', 'aria-label': 'Выше', text: '↑', disabled: i === 0, on: { click: () => move(-1) } }),
      h('button', { class: 'f2-ib', 'aria-label': 'Ниже', text: '↓', disabled: i === d.blocks.length - 1, on: { click: () => move(1) } }),
      h('button', { class: 'f2-ib f2-danger', 'aria-label': 'Удалить блок', text: '✕', on: { click: () => { d.blocks.splice(i, 1); if (!d.blocks.length) d.blocks.push({ t: 'p', r: [] }); redraw(); touch(); } } })));
    const ta = (val, ph, rows, max, on) => { const t = h('textarea', { class: 'f2-ta', rows, maxlength: max, placeholder: ph }); t.value = val || ''; t.addEventListener('input', () => { on(t.value); touch(); }); return t; };
    if (b.t === 'p') {
      if (b._md == null) b._md = runsToMd(b.r);
      const t = ta(b._md, 'Текст… (**жирный**, *курсив*, [текст](https://ссылка))', 4, 6000, v => { b._md = v; });
      const wrapSel = (l, r, ask) => {
        const s = t.selectionStart, e = t.selectionEnd, sel = t.value.slice(s, e) || 'текст';
        let ins;
        if (ask) { const u = prompt('Ссылка (только https://…):', 'https://'); if (!u) return; if (!B_.https(u)) { toast(B_.reason('link')); return; } ins = '[' + sel + '](' + u + ')'; }
        else ins = l + sel + r;
        t.setRangeText(ins, s, e, 'end'); b._md = t.value; t.focus(); touch();
      };
      box.append(h('div', { class: 'f2-fmt' }, h('button', { class: 'f2-ib', 'aria-label': 'Жирный', text: 'Ж', style: 'font-weight:800', on: { click: () => wrapSel('**', '**') } }),
        h('button', { class: 'f2-ib', 'aria-label': 'Курсив', text: 'К', style: 'font-style:italic', on: { click: () => wrapSel('*', '*') } }),
        h('button', { class: 'f2-ib', 'aria-label': 'Ссылка', text: '🔗', on: { click: () => wrapSel('', '', true) } })), t);
    } else if (b.t === 'h') {
      const inp = h('input', { class: 'f2-in f2-hin', maxlength: 200, placeholder: 'Заголовок раздела', value: b.x || '' });
      inp.addEventListener('input', () => { b.x = inp.value; touch(); });
      const lv = h('select', { class: 'f2-in sm', 'aria-label': 'Размер' }, h('option', { value: '2', text: 'Крупный' }), h('option', { value: '3', text: 'Помельче' }));
      lv.value = String(b.l === 3 ? 3 : 2); lv.addEventListener('change', () => { b.l = +lv.value; touch(); });
      box.append(h('div', { class: 'f2-row' }, inp, lv));
    } else if (b.t === 'list') {
      if (b._txt == null) b._txt = (b.items || []).join('\n');
      const t = ta(b._txt, 'Каждый пункт — с новой строки', 4, 16000, v => { b._txt = v; });
      const num = h('input', { type: 'checkbox', checked: !!b.o }); num.addEventListener('change', () => { b.o = num.checked ? 1 : 0; touch(); });
      box.append(t, h('label', { class: 'f2-chk' }, num, ' нумерованный'));
    } else if (b.t === 'quote') {
      box.append(ta(b.x, 'Цитата…', 3, 2000, v => { b.x = v; }));
      const by = h('input', { class: 'f2-in', maxlength: 120, placeholder: 'Кто сказал (необязательно)', value: b.by || '' });
      by.addEventListener('input', () => { b.by = by.value; touch(); });
      box.append(by);
    } else if (b.t === 'video') {
      const inp = h('input', { class: 'f2-in', type: 'url', inputmode: 'url', placeholder: 'Ссылка на YouTube, VK Видео, RuTube или Twitch', value: b._url || (b.id ? B_.watchUrl(b) : '') });
      const prevBox = h('div', { class: 'f2-vprev' });
      const show = () => { clear(prevBox); if (B_.videoOk(b.p, b.id)) prevBox.append(videoEl(b)); else if (inp.value.trim()) prevBox.append(h('div', { class: 'f2-err-line', text: B_.reason('video') })); };
      inp.addEventListener('input', () => { b._url = inp.value; const v = B_.parseVideo(inp.value); b.p = v ? v.p : ''; b.id = v ? v.id : ''; show(); touch(); });
      const cap = h('input', { class: 'f2-in', maxlength: 300, placeholder: 'Подпись (необязательно)', value: b.cap || '' });
      cap.addEventListener('input', () => { b.cap = cap.value; touch(); });
      box.append(inp, prevBox, cap); show();
    } else if (b.t === 'img') {
      const u = b.blob || mediaUrl(b.src);
      box.append(u ? h('img', { class: 'f2-imgprev', src: u, alt: '' }) : h('div', { class: 'f2-muted', text: 'Картинка не загрузилась' }));
      const cap = h('input', { class: 'f2-in', maxlength: 300, placeholder: 'Подпись (необязательно)', value: b.cap || '' });
      cap.addEventListener('input', () => { b.cap = cap.value; touch(); });
      const cov = h('input', { type: 'radio', name: 'f2cover', checked: d.cover === b.src || (!d.cover && d.blocks.find(x => x.t === 'img') === b) });
      cov.addEventListener('change', () => { if (cov.checked) { d.cover = b.src; touch(); } });
      box.append(cap, h('label', { class: 'f2-chk' }, cov, ' обложка статьи'));
    } else if (b.t === 'file') {
      box.append(h('div', { class: 'f2-file' }, '📎 ', h('b', { text: b.name || 'файл' }), b.size ? h('span', { class: 'f2-muted', text: ' · ' + B_.fmtSize(b.size) }) : null));
    } else if (b.t === 'hr') box.append(h('hr'));
    return box;
  }
  // Фото: уменьшить до 1920 px и пересжать (WebP, иначе JPEG) прямо в телефоне; файл — только разрешённые виды и размер
  function pickFile(kind, add){
    if (!cfg || !cfg.media) return toast(B().reason('media_off'));
    const exts = (cfg.files || []).map(x => '.' + x).join(',');
    const inp = h('input', { type: 'file', accept: kind === 'img' ? 'image/jpeg,image/png,image/webp,image/gif' : exts, hidden: true });
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; inp.remove(); if (!f) return;
      try {
        toast('⏳ Загружаем…');
        const blk = kind === 'img' ? await uploadImage(f) : await uploadFile(f);
        add(blk);
      } catch (e) { toast(human(e)); }
    });
    document.body.append(inp); inp.click();
  }
  const rand = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, x => x.toString(36).padStart(2, '0')).join('').slice(0, 20); };
  async function reencode(file){
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('Нужна картинка JPG, PNG, WebP или GIF');
    if (file.size > 25 * 1048576) throw new Error('Картинка больше 25 МБ — выбери поменьше');
    const bmp = await (window.createImageBitmap ? createImageBitmap(file).catch(() => null) : null) || await new Promise((res, rej) => {
      const im = new Image(), u = URL.createObjectURL(file); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Картинку не открыть — выбери другую')); }; im.src = u; });
    const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight, k = Math.min(1, 1920 / Math.max(w0, h0));
    const W = Math.max(1, Math.round(w0 * k)), H = Math.max(1, Math.round(h0 * k));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    cv.getContext('2d').drawImage(bmp, 0, 0, W, H); if (bmp.close) bmp.close();
    const max = (+cfg.img_kb || 900) * 1024;
    try {
      for (const [type, q] of [['image/webp', .86], ['image/webp', .72], ['image/jpeg', .84], ['image/jpeg', .7], ['image/jpeg', .55]]) {
        const b = await new Promise(r => cv.toBlob(r, type, q));
        if (b && b.type === type && b.size <= max) return { blob: b, ext: type === 'image/webp' ? 'webp' : 'jpg', type, w: W, h: H };
      }
    } finally { cv.width = cv.height = 0; }
    throw new Error('Картинка получилась слишком тяжёлой — выбери попроще');
  }
  async function uploadImage(file){
    const c = sb(), uid = me()?.id; if (!c || !uid) throw new Error('Войди, чтобы загружать');
    const r = await reencode(file);
    const key = uid + '/' + rand() + '.' + r.ext;
    const { error } = await c.storage.from(MEDIA_BUCKET).upload(key, r.blob, { contentType: r.type, upsert: false, cacheControl: '31536000' });
    if (error) throw error;
    return { t: 'img', src: key, w: r.w, h: r.h, blob: URL.createObjectURL(r.blob) };
  }
  // Файл: вид — по списку владельца, по расширению И по первым байтам (pdf, zip, txt без нулевых байтов)
  async function uploadFile(file){
    const c = sb(), uid = me()?.id; if (!c || !uid) throw new Error('Войди, чтобы загружать');
    const ext = ((file.name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/) || [])[1] || '';
    const MIME = { pdf: 'application/pdf', txt: 'text/plain', zip: 'application/zip' };
    if ((cfg.files || []).indexOf(ext) < 0 || !MIME[ext]) throw new Error('Такой тип файла нельзя. Можно: ' + (cfg.files || []).join(', '));
    if (file.size > (+cfg.file_mb || 10) * 1048576) throw new Error('Файл больше ' + (cfg.file_mb || 10) + ' МБ');
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    const at = (s) => s.split('').every((ch, i) => head[i] === ch.charCodeAt(0));
    if ((ext === 'pdf' && !at('%PDF')) || (ext === 'zip' && !at('PK')) || (ext === 'txt' && head.indexOf(0) >= 0)) throw new Error('Файл не похож на .' + ext);
    const key = uid + '/' + rand() + '.' + ext;
    const { error } = await c.storage.from(MEDIA_BUCKET).upload(key, file, { contentType: MIME[ext], upsert: false, cacheControl: '31536000' });
    if (error) throw error;
    const name = (file.name || 'файл.' + ext).replace(/[/\\<>]/g, '_').slice(0, 120);
    return { t: 'file', key, name, size: file.size, mime: MIME[ext] };
  }

  // ═══ Модерация ═══
  async function modView(){
    const my = gen; stopTimers();
    clear(root);
    meta({ title: 'Модерация форума — dan4ik37', noindex: true });
    root.append(topBar('mod'));
    if (!isMod()) { root.append(errorBox('Только для модераторов.')); return true; }
    const box = h('div', { class: 'f2-mod' }, skeleton(3));
    root.append(box);
    let q;
    try { q = await rpc('forum_mod_queue'); } catch (e) { if (my !== gen) return; clear(box).append(errorBox('Очередь не загрузилась: ' + human(e), modView)); return; }
    if (my !== gen) return;
    clear(box);
    if (!q || !q.ok) { box.append(errorBox(B().reason(q && q.reason))); return true; }
    const act = (action, id, label, cls) => h('button', { class: 'f2-act' + (cls ? ' ' + cls : ''), text: label, on: { click: async () => {
      const note = action === 'hide' ? prompt('Причина (увидит автор):', 'нарушение правил') : '';
      if (note === null) return;
      try { const r = await rpc('forum_mod', { p_action: action, p_id: id, p_note: note || '' }); if (!r.ok) return toast(B().reason(r.reason)); modView(); } catch (e) { toast(human(e)); }
    } } });
    box.append(h('h3', { class: 'f2-h', text: '⏳ На проверке · ' + q.pending.length }));
    if (!q.pending.length) box.append(h('p', { class: 'f2-muted', text: 'Пусто — всё проверено.' }));
    q.pending.forEach(a => { const c = card(a); c.append(h('div', { class: 'f2-row' }, a.mod_note ? h('span', { class: 'f2-muted', text: a.mod_note }) : null, act('approve', a.id, '✅ Опубликовать'), act('hide', a.id, '🚫 Скрыть', 'f2-danger'))); box.append(c); });
    box.append(h('h3', { class: 'f2-h', text: '⚑ Жалобы · ' + q.reports.length }));
    if (!q.reports.length) box.append(h('p', { class: 'f2-muted', text: 'Жалоб нет.' }));
    q.reports.forEach(r => box.append(h('div', { class: 'f2-card' },
      h('div', { class: 'f2-meta' }, h('b', { text: r.kind === 'article' ? 'Статья' : 'Комментарий' }), h('span', { text: '×' + r.n }), h('span', { text: ago(r.at) })),
      h('a', { href: '/forum/' + r.thread_id + (r.kind === 'comment' ? '#c' + r.target : ''), text: r.title || 'статья' }),
      r.text ? h('p', { class: 'f2-card-x', text: r.text }) : null, r.why ? h('p', { class: 'f2-muted', text: 'Причина: ' + r.why }) : null,
      h('div', { class: 'f2-row' }, act('dismiss', r.id, 'Отклонить жалобу'), r.kind === 'comment' ? act('delete_comment', r.target, '🗑 Удалить комментарий', 'f2-danger') : act('hide', r.target, '🚫 Скрыть статью', 'f2-danger')))));
    box.append(h('h3', { class: 'f2-h', text: '🚫 Скрытые · ' + q.hidden.length }));
    q.hidden.forEach(a => { const c = card(a); c.append(h('div', { class: 'f2-row' }, act('restore', a.id, '↩ Вернуть'))); box.append(c); });
    return true;
  }

  // ушли из раздела — остановить автосохранение (черновик остаётся на устройстве)
  window.addEventListener('d37:route', () => { try { if (!/^#\/forum(\/|$)/.test(window.D37Route?.hash?.() || '')) F.leave(); } catch (e) {} });

  // ═══ Стили (тёмная и светлая тема — через переменные сайта; телефон — в первую очередь) ═══
  function css(){
    if (document.getElementById('f2Css')) return;
    const s = document.createElement('style'); s.id = 'f2Css';
    s.textContent = `
.f2-off{display:none!important}
.f2{--f2-r:14px;font-size:.92rem}
.f2-top{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;justify-content:space-between;margin:.2rem 0 1rem}
.f2-tabs{display:flex;gap:.35rem;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;max-width:100%}
.f2-tabs::-webkit-scrollbar{display:none}
.f2-tab{flex:none;padding:.5rem .85rem;border-radius:999px;border:1px solid var(--border);background:var(--card);color:var(--text);text-decoration:none;font-weight:700;font-size:.8rem;cursor:pointer;white-space:nowrap;font-family:inherit}
.f2-tab.on{background:var(--tw);border-color:var(--tw);color:#fff}
.f2-write,.f2-btn{display:inline-flex;align-items:center;justify-content:center;gap:.3rem;min-height:44px;padding:.55rem 1.1rem;border-radius:12px;border:0;background:var(--accent);color:#fff;font-weight:800;text-decoration:none;cursor:pointer;font-family:inherit;font-size:.88rem}
.f2-btn.ghost{background:transparent;border:1.5px solid var(--border);color:var(--text)}
.f2-btn.sm{min-height:38px;padding:.4rem .9rem;font-size:.8rem}
.f2-btn:disabled{opacity:.55;cursor:default}
.f2-sub{display:flex;align-items:center;gap:.4rem;margin:-.4rem 0 .8rem;font-size:.8rem;color:var(--muted)}
.f2-period,.f2-in,.f2-ta,.f2-titlein{background:rgba(var(--fg-rgb),.05);border:1.5px solid var(--border);border-radius:10px;color:var(--text);font-family:inherit;font-size:.9rem;padding:.6rem .75rem;outline:none;width:100%;box-sizing:border-box}
.f2-period{width:auto;padding:.35rem .5rem;font-size:.8rem}
.f2-in:focus,.f2-ta:focus,.f2-titlein:focus{border-color:var(--tw)}
.f2-ta{resize:vertical;line-height:1.55;min-height:3.2em}
.f2-titlein{font-size:1.25rem;font-weight:800;padding:.75rem .85rem;margin-bottom:.8rem}
.f2-h{font-size:1rem;margin:1.2rem 0 .6rem}
.f2-taghead{display:flex;align-items:baseline;gap:.8rem;margin:0 0 .8rem}.f2-taghead h3{margin:0}
.f2-list{display:flex;flex-direction:column;gap:.75rem}
.f2-card{position:relative;background:var(--card);border:1px solid var(--border);border-radius:var(--f2-r);padding:.9rem 1rem;display:flex;flex-direction:column;gap:.45rem}
.f2-card-a{color:inherit;text-decoration:none;display:flex;flex-direction:column;gap:.45rem}
.f2-card-a:hover .f2-card-t{color:var(--tw)}
.f2-cover{margin:-.9rem -1rem .2rem;border-radius:var(--f2-r) var(--f2-r) 0 0;overflow:hidden;aspect-ratio:16/9;background:rgba(var(--fg-rgb),.06);position:relative}
.f2-cover img{width:100%;height:100%;object-fit:cover;display:block}
.f2-cover.f2-vid::after{content:'▶';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:56px;height:56px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.4rem}
.f2-card-t{margin:0;font-size:1.05rem;font-weight:800;line-height:1.3;word-break:break-word}
.f2-card-x{margin:0;color:rgba(var(--text-rgb),.78);font-size:.85rem;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.f2-meta{display:flex;flex-wrap:wrap;gap:.25rem .7rem;align-items:center;font-size:.74rem;color:var(--muted)}
.f2-nick{font-weight:700;color:var(--text);cursor:pointer}
.f2-role{margin-left:.3rem;padding:0 .35rem;border-radius:6px;background:rgba(255,45,85,.15);color:var(--accent);font-size:.64rem;font-weight:800}
.f2-num{font-weight:700}
.f2-age{padding:0 .4rem;border-radius:6px;background:rgba(255,159,10,.18);color:#ff9f0a;font-weight:800}
.f2-st{padding:.05rem .45rem;border-radius:999px;font-weight:800;background:rgba(var(--fg-rgb),.08)}
.f2-st-pending{background:rgba(255,209,102,.18)}.f2-st-hidden{background:rgba(255,45,85,.15)}
.f2-tags{display:flex;flex-wrap:wrap;gap:.35rem}
.f2-tag{font-size:.74rem;padding:.15rem .55rem;border-radius:999px;background:rgba(145,71,255,.12);color:var(--tw);text-decoration:none;font-weight:700}
.f2-more{display:block;margin:1rem auto;min-height:44px;padding:.5rem 1.4rem;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--text);font-weight:700;cursor:pointer;font-family:inherit}
.f2-more[hidden]{display:none}
.f2-empty{text-align:center;padding:2rem 1rem;background:var(--card);border:1px dashed var(--border);border-radius:var(--f2-r);color:var(--muted)}
.f2-empty p{margin:0 0 .9rem}
.f2-err{border-color:rgba(255,45,85,.4)}
.f2-err-line{color:var(--accent);font-size:.8rem;min-height:1.1em}
.f2-muted{color:var(--muted)}
.f2-note{font-size:.75rem;margin-top:.5rem}
.f2-back{display:inline-block;margin-bottom:.8rem;color:var(--tw);text-decoration:none;font-size:.85rem;font-weight:700}
.f2-art{background:var(--card);border:1px solid var(--border);border-radius:var(--f2-r);padding:1.1rem 1.1rem 1rem}
.f2-title{font-size:1.5rem;line-height:1.25;margin:.1rem 0 .5rem;word-break:break-word}
.f2-banner{padding:.6rem .8rem;border-radius:10px;margin-bottom:.8rem;font-size:.82rem;font-weight:700}
.f2-note{font-weight:600}
.f2-body{margin-top:.9rem;font-size:.97rem;line-height:1.7;word-break:break-word;color:rgba(var(--text-rgb),.94)}
.f2-body p{margin:0 0 .9em;white-space:pre-wrap}
.f2-body h2{font-size:1.2rem;margin:1.3em 0 .5em}.f2-body h3{font-size:1.05rem;margin:1.1em 0 .4em}
.f2-body ul,.f2-body ol{margin:0 0 .9em;padding-left:1.4em}
.f2-body blockquote{margin:0 0 1em;padding:.5rem .9rem;border-left:4px solid var(--tw);background:rgba(145,71,255,.07);border-radius:0 10px 10px 0}
.f2-body blockquote p{margin:0}.f2-body blockquote footer{font-size:.8rem;color:var(--muted);margin-top:.3rem}
.f2-body figure{margin:0 0 1em}.f2-body img{max-width:100%;height:auto;border-radius:10px;display:block}
.f2-body figcaption{font-size:.78rem;color:var(--muted);margin-top:.35rem}
.f2-body a{color:var(--link,var(--tw))}
.f2-body hr{border:0;border-top:1px solid var(--border);margin:1.4em 0}
.f2-video .f2-vplay{position:relative;display:block;width:100%;aspect-ratio:16/9;border:0;border-radius:12px;overflow:hidden;background:#111;cursor:pointer;padding:0}
.f2-vplay img{width:100%;height:100%;object-fit:cover}
.f2-vprov{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:1.2rem;background:linear-gradient(135deg,#1f1147,#3b0d2b)}
.f2-vicon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:64px;height:64px;border-radius:50%;background:rgba(0,0,0,.65);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.6rem}
.f2-vlabel{position:absolute;left:.6rem;bottom:.5rem;color:#fff;font-size:.75rem;font-weight:700;text-shadow:0 1px 3px #000}
.f2-vframe{position:relative;width:100%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#000}
.f2-vframe iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.f2-source{margin:1rem 0 .4rem;padding:.6rem .8rem;border-radius:10px;background:rgba(var(--fg-rgb),.05);font-size:.85rem;word-break:break-word}
.f2-source a{color:var(--link,var(--tw));font-weight:700}
.f2-file{word-break:break-word}
.f2-actions{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;margin-top:1rem;padding-top:.8rem;border-top:1px solid var(--border)}
.f2-votes{display:inline-flex;align-items:center;gap:.25rem;margin-right:.3rem}
.f2-vote{width:44px;height:44px;border-radius:12px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:1rem;cursor:pointer}
.f2-vote.on{background:rgba(34,197,94,.18);border-color:#22c55e;color:#22c55e}
.f2-vote.down.on{background:rgba(255,45,85,.15);border-color:var(--accent);color:var(--accent)}
.f2-rating{min-width:2.2rem;text-align:center;font-weight:800}
.f2-act{min-height:40px;padding:.4rem .75rem;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:.8rem;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;font-family:inherit}
.f2-act.on{border-color:var(--tw);color:var(--tw)}
.f2-danger{color:var(--accent)!important}
.f2-modbar{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;width:100%;padding:.5rem;border-radius:10px;background:rgba(255,209,102,.08)}
.f2-adwrap{margin:1.2rem 0 0}
.f2-comments{margin-top:1.2rem}
.f2-c{padding:.7rem .85rem;border-radius:12px;background:var(--card);border:1px solid var(--border);margin-bottom:.55rem}
.f2-c-sub{margin:.55rem 0 0;border-left:3px solid rgba(145,71,255,.35)}
.f2-kids{margin-left:.6rem}
.f2-c-head{display:flex;gap:.6rem;align-items:center;font-size:.78rem;flex-wrap:wrap}
.f2-c-body{margin-top:.35rem;white-space:pre-wrap;word-break:break-word;line-height:1.55;font-size:.88rem}
.f2-c-tools{display:flex;gap:.8rem;margin-top:.3rem}
.f2-link{background:none;border:0;padding:.2rem 0;color:var(--tw);font-weight:700;font-size:.78rem;cursor:pointer;font-family:inherit}
.f2-reply{display:flex;flex-direction:column;gap:.4rem;margin:.5rem 0 .8rem}
.f2-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.f2-ed{display:flex;flex-direction:column;gap:.8rem}
.f2-edtabs{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap}
.f2-saved{font-size:.74rem;margin-left:auto}
.f2-blocks{display:flex;flex-direction:column;gap:.6rem}
.f2-bed{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:.55rem .65rem .7rem;display:flex;flex-direction:column;gap:.45rem}
.f2-bed.bad{border-color:var(--accent);box-shadow:0 0 0 2px rgba(255,45,85,.25)}
.f2-bed-head{display:flex;align-items:center;gap:.3rem}
.f2-bed-name{flex:1;font-size:.75rem;font-weight:800;color:var(--muted)}
.f2-ib{min-width:38px;height:38px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;font-family:inherit;font-size:.9rem}
.f2-ib:disabled{opacity:.35}
.f2-fmt{display:flex;gap:.3rem}
.f2-hin{font-weight:800}
.f2-in.sm{width:auto}
.f2-chk{display:flex;align-items:center;gap:.4rem;font-size:.82rem}
.f2-imgprev{max-width:100%;max-height:260px;border-radius:10px;object-fit:contain;align-self:flex-start}
.f2-addbox{padding:.7rem;border-radius:12px;border:1px dashed var(--border)}
.f2-addh{font-size:.75rem;margin-bottom:.45rem}
.f2-adds{display:grid;grid-template-columns:repeat(3,1fr);gap:.45rem}
.f2-adds-sm{margin-top:.45rem}
.f2-add{min-height:52px;border-radius:12px;border:1px solid var(--border);background:rgba(var(--fg-rgb),.04);color:var(--text);font-weight:800;font-size:.86rem;cursor:pointer;font-family:inherit}
.f2-add.sm{min-height:40px;font-size:.78rem;font-weight:700}
.f2-add:disabled{opacity:.45;cursor:not-allowed}
.f2-fields{display:flex;flex-direction:column;gap:.8rem}
.f2-lab{display:flex;flex-direction:column;gap:.35rem;font-size:.8rem;font-weight:700}
.f2-pubbar{position:sticky;bottom:0;z-index:5;padding:.6rem 0;background:linear-gradient(to top,var(--bg,#0b0b12) 70%,transparent);display:flex;flex-direction:column;gap:.35rem}
.f2-pubbar .f2-btn{flex:1}
.f2-skel i,.f2-skel b,.f2-skel span,.f2-skel-art i,.f2-skel-art b,.f2-skel-art span,.f2-skel-c{display:block;border-radius:8px;background:rgba(var(--fg-rgb),.07)}
.f2-skel i{height:140px;margin:-.9rem -1rem .3rem;border-radius:var(--f2-r) var(--f2-r) 0 0}.f2-skel b{height:1.2rem;width:70%}.f2-skel span{height:.8rem;width:45%}
.f2-skel-art i{height:1.8rem;width:80%;margin-bottom:.8rem}.f2-skel-art b{height:1rem;width:40%;margin-bottom:1.2rem}.f2-skel-art span{height:.9rem;margin-bottom:.6rem}
.f2-skel-c{height:3rem}
body.high .f2-skel i,body.high .f2-skel b,body.high .f2-skel-art i{animation:f2p 1.4s ease-in-out infinite}
@keyframes f2p{50%{opacity:.5}}
.f2-toast{position:fixed;left:50%;bottom:5.5rem;transform:translateX(-50%);z-index:99999;padding:.6rem 1rem;border-radius:12px;background:#1d1d2b;color:#fff;font-size:.85rem;font-weight:700;box-shadow:0 6px 24px rgba(0,0,0,.4);max-width:calc(100vw - 32px)}
@media(max-width:600px){.f2-art{padding:.9rem .85rem}.f2-title{font-size:1.25rem}.f2-write{width:100%}.f2-kids{margin-left:.3rem}.f2-c{padding:.6rem .7rem}}
`;
    document.head.append(s);
  }
})();
