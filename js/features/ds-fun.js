// ═══════════════════════════════════════
//  ДС «фишки» (T-164, ветка ds-fun; владелец 13.11: «наш ДС до уровня ДС не дотягивает и ему не хватает интересных фишек»).
//  Грузится после community2.js (phone.js → MODS.ds). SQL — community.sql ч. 14 (cf_*). Нет ч. 14 на сервере — всё как раньше.
//  • 😀 свои эмодзи и 🖼 стикеры сервера: загружают те, кто управляет каналами (картинка ужимается в браузере до 64 / 160 px);
//    у сообществ — видно только после проверки командой сайта (детская аудитория). В тексте — :ce_<id>: / :stk_<id>: (пишем :имя:,
//    при отправке подменяем), рисует MsgView через MV.emojiHook (картинки — только data:image/…, только проверенные — cf_media_get).
//  • 🔊 звуковая панель в голосовом: звуки до 5 с, сервер решает «можно ли сейчас» (cf_sound_play, раз в 4 с), рассылка — broadcast
//    'd37fun:<сервер>:<канал>' тем, кто в голосовом; громкость и «выключить звуки» — у каждого свои (d37_ds_sb).
//  • 🎮 «Играть вместе»: кнопка у поля ввода и в голосовом — комната игры сайта или Долина D37 (/hub/play) → карточка «▶ Войти» всем.
//  • 🎙 «сцена» в голосовом: говорят выбранные (до 6), остальные слушают (микрофон выключается сам) и ✋ поднимают руку.
//  • 👋 «с чего начать» новичку (один раз), 🏷 метки в карточках обзора 🧭, ⭐ уровни активности на сервере (+1 опыт не чаще раза
//    в минуту — сервер; ничего не продаётся), 🎂 годовщина на сервере. Экран «🎉 Фишки сервера» — #/chat[/c/<id>]/fun.
//  Крючки: msgview.js emojiImg → MV.emojiHook; community.js showChannel (голосовой) → DS.x.voiceMore; phone.js MODS.ds — этот файл.
// ═══════════════════════════════════════
(() => {
  const DS_FUN = true;   // откат одной строкой: false — без эмодзи/стикеров/звуков сервера, «Играть вместе», сцены, уровней
  const P = window.D37Phone, MV = window.MsgView, DS = window.D37DS;
  if (!DS_FUN || !P || !MV || !DS) return;
  const X = DS.x = DS.x || {};
  X.sub = X.sub || {};
  const e = s => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const SITE = 'https://dan4ik37.vercel.app';
  const skey = srv => (srv?.official ? 'o' : String(srv?.id ?? 'o'));
  const cidOf = srv => (srv?.official ? null : +srv.id);
  const LS = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (er) { return d; } };
  const LSset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (er) {} };
  const IMG_RE = /^data:image\/(png|webp|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
  const SND_RE = /^data:audio\/(mpeg|ogg|webm|wav|mp4|aac);base64,[A-Za-z0-9+/]+={0,2}$/;
  const REASON = { auth: 'войди в аккаунт', rights: 'нет прав', kind: 'не тот тип', name: 'имя — 2–24 латинских буквы, цифры, _', bad: 'плохое слово',
    size: 'слишком большой файл', type: 'такой файл нельзя', dur: 'звук — до 5 секунд', full: 'места больше нет — удали старое', rate: 'не больше 20 загрузок в день',
    taken: 'такое имя уже есть', not_found: 'не найдено', member: 'сначала вступи', muted: 'тебя заглушили', wait: 'подожди пару секунд', channel: 'такой канал нельзя',
    tag: 'метки — до 5, по 2–16 букв', not_stage: 'это не сцена' };
  const why = r => (r?.missing ? 'появится, когда сайт обновится' : r?.error ? P.err(r.error) : REASON[r?.data?.reason] || r?.data?.reason || 'не получилось');

  // ── стили — свой файл (ds.css не трогаем: в нём работают другие ветки) ──
  if (!document.querySelector('link[data-dsfun]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/ds-fun.css?v=1'; l.dataset.dsfun = '1'; document.head.appendChild(l);
  }

  // ═══ Медиа сервера: список (эмодзи — с картинкой) и картинки / звуки по номерам ═══
  const LIST = new Map();    // skey → { at, d: { manage, list } | null }
  const MEDIA = new Map();   // id → { id, kind, name, data, dur } (только проверенные)
  let missing = false;
  async function mediaList(srv, fresh){
    const k = skey(srv), c = LIST.get(k);
    if (c && !fresh && Date.now() - c.at < 120e3) return c.d;
    if (missing && !fresh) return null;
    const r = await P.rpc('cf_media_list', { p_community: cidOf(srv) });
    if (r.missing) missing = true;
    const d = r.data?.ok ? { manage: !!r.data.manage, list: r.data.list || [] } : null;
    if (d) d.list.forEach(m => { if (m.status === 'ok' && m.kind === 'emoji' && IMG_RE.test(m.data || '')) MEDIA.set(+m.id, m); });
    LIST.set(k, { at: Date.now(), d });
    return d;
  }
  const want = new Set(); let wantT = 0;
  function fetchSoon(id){
    if (MEDIA.has(id) || want.has(id) || missing) return;
    want.add(id); clearTimeout(wantT); wantT = setTimeout(flush, 30);
  }
  async function flush(){
    const ids = [...want].slice(0, 24); ids.forEach(i => want.delete(i));
    if (!ids.length) return;
    const r = await P.rpc('cf_media_get', { p_ids: ids });
    if (r.missing) { missing = true; return; }
    (Array.isArray(r.data) ? r.data : []).forEach(m => {
      if ((m.kind === 'sound' ? SND_RE : IMG_RE).test(m.data || '')) MEDIA.set(+m.id, m);
    });
    ids.forEach(id => {
      const m = MEDIA.get(id);
      document.querySelectorAll(`img[data-dsf="${id}"]`).forEach(img => { if (m && m.kind !== 'sound') { img.src = m.data; img.alt = img.title = ':' + m.name + ':'; } else img.replaceWith(document.createTextNode(img.dataset.raw || '')); });
    });
    if (want.size) flush();
  }
  // MsgView рисует :ce_<id>: и :stk_<id>: (крючок в msgview.js emojiImg). Только наши номера, только data:image
  MV.emojiHook = name => {
    const m = /^(ce|stk)_(\d{1,12})$/.exec(name); if (!m) return null;
    const id = +m[2], it = MEDIA.get(id), stk = m[1] === 'stk';
    if (!it) fetchSoon(id);
    const src = it && it.kind !== 'sound' && IMG_RE.test(it.data) ? ` src="${e(it.data)}"` : '';
    return `<img class="${stk ? 'dsf-stk' : 'custom-emoji-img inline-emoji dsf-emo'}" data-dsf="${id}" data-raw=":${e(name)}:"${src} alt="${it ? ':' + e(it.name) + ':' : ''}" title="${it ? ':' + e(it.name) + ':' : ''}" loading="lazy" decoding="async">`;
  };

  // ═══ Адаптер ленты: :имя: → :ce_<id>: при отправке и правке, уровни после своих сообщений, кнопка ✨ у поля ввода ═══
  const CTX = new Map();   // A.key → { srv, ch, A }
  const toIds = (text, srv) => {
    const d = LIST.get(skey(srv))?.d; if (!d || !text.includes(':')) return text;
    const by = new Map(d.list.filter(m => m.kind === 'emoji' && m.status === 'ok').map(m => [m.name, m.id]));
    return text.replace(/:([a-z0-9_]{2,24}):/g, (all, n) => (by.has(n) ? `:ce_${by.get(n)}:` : all));
  };
  const wrap0 = X.wrapAdapter;
  X.wrapAdapter = (A0, srv, ch) => {
    const A1 = wrap0 ? wrap0(A0, srv, ch) : A0;
    if (!A1 || !srv || !ch || ch.kind !== 'text') return A1;
    const A = Object.create(A1);
    if (A1.send) A.send = async (text, replyId, ...rest) => { const r = await A1.send.call(A1, toIds(String(text ?? ''), srv), replyId, ...rest); if (r?.ok) levelSoon(srv); return r; };
    if (A1.edit) A.edit = (m, text, ...rest) => A1.edit.call(A1, m, toIds(String(text ?? ''), srv), ...rest);
    CTX.set(A.key, { srv, ch, A });
    if (CTX.size > 30) CTX.delete(CTX.keys().next().value);
    mediaList(srv).catch(() => {});
    setTimeout(() => injectBtns(A.key), 0);
    return A;
  };
  function injectBtns(key){
    document.querySelectorAll('.ds-mv .mv-row').forEach(row => {
      let b = row.querySelector('.dsf-btn');
      if (!b) {
        b = document.createElement('button'); b.type = 'button'; b.className = 'mv-cb dsf-btn'; b.textContent = '✨';
        b.title = 'Эмодзи и стикеры сервера, «Играть вместе»'; b.setAttribute('aria-label', b.title);
        const emo = row.querySelector('[data-c="emoji"]');
        row.insertBefore(b, emo ? emo.nextSibling : row.firstChild);
      }
      b.dataset.key = key;
    });
  }
  // ── всплывающая панель ✨ над полем ввода ──
  let pop = null;
  function closePop(){ if (pop) { pop.remove(); pop = null; } }
  async function openPop(btn){
    if (pop) { closePop(); return; }
    const ctx = CTX.get(btn.dataset.key); if (!ctx) return;
    const comp = btn.closest('.mv-comp'); if (!comp) return;
    pop = document.createElement('div'); pop.className = 'dsf-pop'; pop.setAttribute('role', 'dialog');
    pop.innerHTML = '<div class="ds-dim">Загружаем…</div>';
    comp.insertBefore(pop, comp.querySelector('.mv-row'));
    const me = pop, d = await mediaList(ctx.srv);
    if (pop !== me) return;
    const ok = (d?.list || []).filter(m => m.status === 'ok');
    const emo = ok.filter(m => m.kind === 'emoji'), stk = ok.filter(m => m.kind === 'sticker');
    stk.forEach(m => fetchSoon(+m.id));
    const fun = DS.link ? DS.link(DS.cur?.() ? 'page' : 'phone', ctx.srv.official ? DS.OFF_ID : ctx.srv.id, 'fun') : '';
    me.innerHTML = `<div class="dsf-ptabs"><b>✨ Сервер</b><button type="button" class="ds-btn ds-sm" data-f="play">🎮 Играть вместе</button>${fun ? `<a class="ds-btn ghost ds-sm" href="${e(fun)}">🎉 Фишки</a>` : ''}</div>
      ${emo.length ? `<div class="mv-emo-h">Эмодзи сервера</div><div class="mv-emo">${emo.map(m => `<button type="button" data-ins=":${e(m.name)}:" title=":${e(m.name)}:"><img src="${e(m.data)}" alt=":${e(m.name)}:"></button>`).join('')}</div>` : ''}
      ${stk.length ? `<div class="mv-emo-h">Стикеры сервера</div><div class="dsf-stks">${stk.map(m => `<button type="button" data-fstk="${+m.id}" title="${e(m.name)}">${MV.emojiHook('stk_' + (+m.id))}</button>`).join('')}</div>` : ''}
      ${!emo.length && !stk.length ? `<div class="ds-dim">${d ? 'Своих эмодзи и стикеров пока нет' + (d.manage ? ' — добавь в «🎉 Фишки»' : '') + '.' : missing ? 'Свои эмодзи и стикеры появятся, когда сайт обновится.' : 'Не загрузилось.'}</div>` : ''}`;
    me.dataset.key = btn.dataset.key;
  }
  document.addEventListener('click', ev => {
    const t = ev.target;
    const b = t?.closest?.('.dsf-btn');
    if (b) { ev.preventDefault(); openPop(b); return; }
    if (!pop) return;
    if (!t.closest('.dsf-pop')) { closePop(); return; }
    const s = t.closest('[data-fstk]'), pl = t.closest('[data-f="play"]');
    if (s) { const ctx = CTX.get(pop.dataset.key), comp = pop.closest('.mv-comp'); closePop(); sendText(comp, `:stk_${+s.dataset.fstk}:`); return; }
    if (pl) { const ctx = CTX.get(pop.dataset.key), comp = pop.closest('.mv-comp'); closePop(); playTogether(ctx, txt => sendText(comp, txt)); return; }
    if (t.closest('[data-ins]')) setTimeout(closePop, 0);
  }, true);
  // отправить через саму ленту (как будто человек набрал и нажал ➤) — работают проверки, медленный режим, автомодерация
  function sendText(comp, text){
    const inp = comp?.querySelector('.mv-in'), go = comp?.querySelector('[data-c="send"]');
    if (!inp || !go) return;
    const keep = inp.value; inp.value = text; go.click();
    setTimeout(() => { if (!inp.value && keep) { inp.value = keep; inp.dispatchEvent(new Event('input')); } }, 0);
  }

  // ═══ 🎮 Играть вместе: комната игры сайта или Долина D37 ═══
  const QUICK = ['chess', 'durak', 'uno', 'checkers', 'pool', 'nardy', 'ludo', 'arena', 'horde', 'td', 'sea', 'ttt', 'krokodil'];
  const COOP = new Set(['horde', 'td']);
  function playTogether(ctx, post){
    const games = QUICK.map(id => typeof GAMES !== 'undefined' && GAMES.find(g => g.id === id)).filter(g => g && (!window.D37Age || window.D37Age.canOpen?.(parseInt(g.age, 10) || 0) !== false));
    const body = `<div class="ds-dim">Всем в канале придёт карточка «▶ Войти», а ты сразу окажешься в игре.</div>
      <div class="dsf-games"><button type="button" class="dsf-g" data-v="hub">🌲 Долина D37<small>новый движок</small></button>${games.map(g => `<button type="button" class="dsf-g" data-v="${e(g.id)}">${g.icon} ${e(g.title)}${COOP.has(g.id) ? '<small>вместе</small>' : ''}</button>`).join('')}</div>`;
    sheet('🎮 Во что играем вместе?', body).then(gid => {
      if (!gid) return;
      let text, go;
      if (gid === 'hub') { text = `🎮 Играем вместе в «Долину D37» — заходите! ${SITE}/hub/play`; go = '/hub/play'; }
      else {
        const g = GAMES.find(x => x.id === gid); if (!g) return;
        const code = window.GameRoom?.newCode?.() || Math.random().toString(36).slice(2, 8);
        const path = `#/games/${gid}/${COOP.has(gid) ? 'coop/' : ''}${code}`;
        text = `🎮 Играем вместе в «${g.title}» — заходите! ${SITE}/${path}`; go = path;
      }
      post(text);
      setTimeout(() => { if (go[0] === '#') location.hash = go; else if (window.D37Route?.go) window.D37Route.go(go); else location.href = go; }, 600);
    });
  }
  // карточка Долины D37 в ленте (комнаты игр — уже есть: «Зовёт в …» с «▶ Войти»)
  const cardOf0 = MV.cardOf, cardHtml0 = MV.cardHtml;
  MV.cardOf = path => (/^(?:#\/hub|\/hub)\/play\/?$/.test(path) ? { t: 'hubplay' } : cardOf0(path));
  MV.cardHtml = c => (c?.t === 'hubplay'
    ? '<div class="mv-card mv-game mv-room" style="--gc:#22c55e"><i>🌲</i><span><b>Играть вместе: Долина D37</b><small>Новый движок сайта — заходи, все в одном мире</small></span><a class="mv-cbtn" href="/hub/play">▶ Войти</a></div>'
    : cardHtml0(c));

  // ═══ Окно (как в community2 ч. 4): заголовок, тело, кнопки data-v ═══
  function sheet(title, body, collect){
    return new Promise(res => {
      const w = document.createElement('div');
      w.className = 'ds4-sh dsf-sh'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true');
      w.innerHTML = `<div class="ds4-box"><div class="ds4-t">${title}</div>${body}<button type="button" class="ds4-wide ghost" data-v="">Закрыть</button></div>`;
      const key = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); done(null); } };
      const done = v => { w.remove(); document.removeEventListener('keydown', key, true); res(v); };
      w.addEventListener('click', ev => {
        if (ev.target === w) return done(null);
        const b = ev.target.closest('[data-v]'); if (!b) return;
        done(b.dataset.v ? (collect ? collect(w, b.dataset.v) : b.dataset.v) : null);
      });
      document.addEventListener('keydown', key, true);
      (document.fullscreenElement && document.fullscreenElement.tagName !== 'IFRAME' ? document.fullscreenElement : document.body).appendChild(w);
    });
  }

  // ═══ Настройки «фишек» сервера и мой уровень (cf_server_get, кэш минута) ═══
  const FUN = new Map();
  async function funGet(srv, fresh){
    const k = skey(srv), c = FUN.get(k);
    if (c && !fresh && Date.now() - c.at < 60e3) return c.d;
    if (missing && !fresh) return null;
    const r = await P.rpc('cf_server_get', { p_community: cidOf(srv) });
    if (r.missing) missing = true;
    const d = r.data?.ok ? r.data : null;
    FUN.set(k, { at: Date.now(), d });
    return d;
  }
  // ⭐ уровень после своих сообщений (не чаще раза в 90 с) → 🎉 «новый уровень» — только у себя
  const lvT = new Map();
  function levelSoon(srv){
    const k = skey(srv); if (Date.now() - (lvT.get(k) || 0) < 90e3) return;
    lvT.set(k, Date.now());
    setTimeout(async () => {
      const d = await funGet(srv, true); if (!d?.me || !d.levels) return;
      const seen = LS('d37_ds_lv', {}), had = k in seen, was = +seen[k] || 0, now = +d.me.level || 0;
      if (had && now === was) return;
      seen[k] = now; LSset('d37_ds_lv', seen);
      if (had && now > was) {   // первый раз только запоминаем (иначе «новый уровень» вылез бы у всех, кто давно пишет)
        const t = `🎉 Новый уровень на сервере: ${now}!`;
        P.toast(t, true);
        window.D37Chat?.view?.push?.({ sys: true, text: t + ' Таблица — «🎉 Фишки сервера».' });
      }
    }, 1500);
  }
  const years = since => { if (!since) return 0; const a = new Date(since), n = new Date(); let y = n.getFullYear() - a.getFullYear(); if (n.getMonth() < a.getMonth() || (n.getMonth() === a.getMonth() && n.getDate() < a.getDate())) y--; return Math.max(0, y); };
  const days = since => (since ? Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 864e5)) : 0);
  // 🎂 значок годовщины: год+ — торт с числом, месяц+ — росток, неделя — новичок
  X.annivBadge = since => {
    const y = years(since), d = days(since);
    if (y >= 1) return `<span class="dsf-anniv" title="На сервере с ${e(new Date(since).toLocaleDateString('ru-RU'))}">🎂 ${y} ${P.plural(y, 'год', 'года', 'лет')}</span>`;
    if (d >= 30) return `<span class="dsf-anniv" title="На сервере ${d} ${P.plural(d, 'день', 'дня', 'дней')}">🌱 ${Math.floor(d / 30)} мес.</span>`;
    return since ? '<span class="dsf-anniv" title="Новичок на сервере">🐣 новичок</span>' : '';
  };

  // ═══ 👋 «С чего начать» новичку (после правил T-162), 🎂 «сегодня годовщина» — один раз ═══
  const gate0 = X.rulesGate;
  X.rulesGate = async srv => {
    try { await gate0?.(srv); } catch (er) {}
    const d = await funGet(srv).catch(() => null); if (!d) return;
    const k = skey(srv);
    const chs = (d.start_chs || []).map(id => (srv.channels || []).find(c => String(c.id) === String(id))).filter(Boolean);
    const seen = LS('d37_ds_start', {});
    const sig = chs.map(c => c.id).join(',');
    if (chs.length && seen[k] !== sig && !document.querySelector('.ds4-sh')) {
      seen[k] = sig; LSset('d37_ds_start', seen);
      const mode = DS.cur?.() ? 'page' : 'phone';
      sheet(`👋 С чего начать на ${srv.official ? 'сервере «Денчик37»' : 'сервере «' + e(srv.name) + '»'}`,
        `<div class="dsf-start">${chs.map(c => `<a class="ds-btn ghost" data-v="go" href="${e(DS.link(mode, srv.official ? DS.OFF_ID : srv.id, c.id))}">${c.emoji ? e(c.emoji) : '#'} ${e(c.name)}${c.about ? `<small>${e(String(c.about).slice(0, 60))}</small>` : ''}</a>`).join('')}</div>`);
    }
    const me = d.me, y = years(me?.since), an = LS('d37_ds_anniv', {});
    if (me?.since && y >= 1) {
      const s = new Date(me.since), n = new Date(), tag = k + ':' + n.getFullYear();
      if (s.getMonth() === n.getMonth() && s.getDate() === n.getDate() && !an[tag]) { an[tag] = 1; LSset('d37_ds_anniv', an); P.toast(`🎂 Сегодня ${y} ${P.plural(y, 'год', 'года', 'лет')}, как ты на этом сервере!`, true); }
    }
  };

  // ═══ Строка «🎉 Фишки сервера» под «📅 События» ═══
  const top0 = X.chanTop;
  X.chanTop = (mode, srv, selCh) => (top0 ? top0(mode, srv, selCh) : '')
    + `<a class="ds-ch dsf-row${selCh === 'x:fun' ? ' on' : ''}" href="${e(DS.link(mode, srv.official ? DS.OFF_ID : srv.id, 'fun'))}"><i>🎉</i><span>Фишки сервера</span></a>`;

  // ═══ 🏷 метки в карточках обзора 🧭 (cf_tags — пачкой) ═══
  const TAGS = new Map(); const tagWant = new Set(); let tagT = 0;
  const ccard0 = X.ccard;
  if (ccard0) X.ccard = (c, mode) => {
    const h = ccard0(c, mode); if (!h) return h;
    const id = +c.id, t = TAGS.get(id);
    if (t === undefined) { tagWant.add(id); clearTimeout(tagT); tagT = setTimeout(tagFlush, 50); }
    const i = h.lastIndexOf('</div>');
    return i < 0 ? h : h.slice(0, i) + `<div class="dsf-tags" data-tags="${id}">${(t || []).map(x => `<span>#${e(x)}</span>`).join('')}</div>` + h.slice(i);
  };
  async function tagFlush(){
    const ids = [...tagWant].slice(0, 48); ids.forEach(i => tagWant.delete(i));
    if (!ids.length || missing) return;
    const r = await P.rpc('cf_tags', { p_ids: ids });
    if (r.missing) { missing = true; return; }
    ids.forEach(id => TAGS.set(id, []));
    (Array.isArray(r.data) ? r.data : []).forEach(x => TAGS.set(+x.id, (x.tags || []).slice(0, 5)));
    ids.forEach(id => document.querySelectorAll(`[data-tags="${id}"]`).forEach(el => { el.innerHTML = (TAGS.get(id) || []).map(x => `<span>#${e(x)}</span>`).join(''); }));
    if (tagWant.size) tagFlush();
  }

  // ═══ 🔊 Голосовой: звуковая панель, сцена, «Играть вместе» (крючок community.js → DS.x.voiceMore) ═══
  const SB = () => Object.assign({ vol: 0.6, off: false }, LS('d37_ds_sb', {}));
  let V = null;   // { k, srv, ch, host, el, bc, hands: Map, stage, lastSnd: Map }
  X.voiceMore = (host, srv, ch) => {
    if (!host || !srv || !ch) return;
    let el = host.querySelector('.dsf-voice');
    if (!el) { el = document.createElement('div'); el.className = 'dsf-voice'; host.appendChild(el); }
    if (V && V.el !== el) voiceDrop();
    V = V || { k: skey(srv) + ':' + ch.id, srv, ch, el, hands: new Map(), lastSnd: new Map(), stage: null, invites: [] };
    voiceDraw();
  };
  const inVoice = () => { const v = window.D37Calls?.voiceInfo?.(); if (!v || !V) return false; return V.srv.official ? v.kind === 'official' : String(v.channel) === String(V.ch.id); };
  function voiceDrop(){ if (V?.bc) { try { V.bc.unsubscribe(); } catch (er) {} } V = null; }
  function bcOn(){
    if (!V || V.bc || typeof sbClient === 'undefined' || !sbClient?.channel) return;
    const me = V;
    me.bc = sbClient.channel('d37fun:' + me.k, { config: { broadcast: { self: false } } });
    me.bc.on('broadcast', { event: 'f' }, ({ payload: p }) => { if (V === me) onBc(p || {}); }).subscribe();
  }
  function bcSend(p){ try { V?.bc?.send({ type: 'broadcast', event: 'f', payload: p }); } catch (er) {} }
  function bcOff(){ if (V?.bc) { try { V.bc.unsubscribe(); } catch (er) {} V.bc = null; } }
  function onBc(p){
    const nick = String(p.nick || '').slice(0, 24), uid = String(p.uid || '').slice(0, 40);
    if (p.t === 'snd') {
      const id = +p.id; if (!id || !uid) return;
      const last = V.lastSnd.get(uid) || 0; if (Date.now() - last < 3000) return;   // чужой браузер мог обойти сервер — у нас тоже раз в 3 с
      V.lastSnd.set(uid, Date.now());
      playSound(id, nick);
    } else if (p.t === 'hand' && uid) { if (p.on) V.hands.set(uid, nick); else V.hands.delete(uid); voiceDraw(); }
    else if (p.t === 'stage') stageLoad().then(voiceDraw);
    else if (p.t === 'play' && /^(hub|#\/games\/[a-z0-9]+\/(coop\/)?[a-z0-9]{4,12})$/.test(String(p.go || ''))) {
      V.invites = [{ nick, go: p.go, title: String(p.title || '').slice(0, 40), at: Date.now() }].concat(V.invites).slice(0, 3); voiceDraw();
    }
  }
  async function playSound(id, nick){
    const s = SB(); if (s.off) return;
    if (!MEDIA.has(id)) { fetchSoon(id); await new Promise(r => setTimeout(r, 400)); }
    const m = MEDIA.get(id); if (!m || m.kind !== 'sound' || !SND_RE.test(m.data)) return;
    const own = V && (LIST.get(skey(V.srv))?.d?.list || []).some(x => +x.id === id); if (!own) return;   // только звуки этого сервера
    try { const a = new Audio(m.data); a.volume = Math.max(0, Math.min(1, s.vol * (window.D37Opt?.vol ?? 1))); a.play().catch(() => {}); } catch (er) {}
    const n = V?.el?.querySelector('.dsf-snote'); if (n) { n.textContent = `🔊 ${nick || 'кто-то'}: ${m.name}`; clearTimeout(n._t); n._t = setTimeout(() => { n.textContent = ''; }, 2500); }
  }
  async function stageLoad(){
    if (!V) return;
    const r = await P.rpc('cf_stage_get', { p_community: cidOf(V.srv), p_ch: String(V.ch.id) });
    V.stage = r.data?.ok && r.data.stage ? { manage: !!r.data.manage, speakers: (r.data.speakers || []).map(String) } : null;
    stageEnforce();
  }
  function stageEnforce(){
    if (!V?.stage || V.stage.manage || !inVoice()) return;
    const me = P.me(), v = window.D37Calls.voiceInfo();
    if (!V.stage.speakers.includes(String(me)) && !v.mute) window.D37Calls.voiceMute();   // слушатель — микрофон выключен
  }
  let drawing = false;
  async function voiceDraw(){
    if (!V || drawing) return;
    if (!V.el.isConnected) { voiceDrop(); return; }
    drawing = true;
    try {
      const here = inVoice();
      if (here) bcOn(); else bcOff();
      const [d] = await Promise.all([mediaList(V.srv), V.stage === null && !V.stageTried ? (V.stageTried = true, stageLoad()) : null]);
      if (!V || !V.el.isConnected) return;
      const snd = (d?.list || []).filter(m => m.kind === 'sound' && m.status === 'ok'), s = SB(), me = P.me();
      const st = V.stage, speaker = st && st.speakers.includes(String(me));
      const stageHtml = st ? `<div class="dsf-stage"><b>🎙 Сцена</b> <span class="ds-dim">говорят выбранные, остальные слушают</span>
          ${st.speakers.length ? `<div class="dsf-spk">${st.speakers.map(u => { const p = P.prof?.(u); return `<span>${e(p?.nick || 'участник')}${st.manage ? ` <button type="button" class="dsf-x" data-fv="unspk" data-u="${e(u)}" title="Забрать слово">✕</button>` : ''}</span>`; }).join('')}</div>` : '<div class="ds-dim">Пока никто не на сцене.</div>'}
          ${here && !st.manage && !speaker ? `<button type="button" class="ds-btn ghost ds-sm" data-fv="hand">${V.myHand ? '✋ Опустить руку' : '✋ Поднять руку'}</button>` : ''}
          ${st.manage && V.hands.size ? `<div class="dsf-hands"><b>✋ Хотят сказать</b>${[...V.hands].map(([u, n]) => `<span>${e(n)} <button type="button" class="ds-btn ds-sm" data-fv="spk" data-u="${e(u)}">🎙 Дать слово</button></span>`).join('')}</div>` : ''}
          ${st.manage && here && !speaker ? `<button type="button" class="ds-btn ghost ds-sm" data-fv="spk" data-u="${e(me || '')}">🎙 Выйти на сцену</button>` : ''}</div>` : '';
      const inv = V.invites.filter(x => Date.now() - x.at < 10 * 60e3).map(x => `<div class="mv-card mv-game mv-room" style="--gc:#22c55e"><i>🎮</i><span><b>${e(x.nick)} зовёт играть</b><small>${e(x.title || 'игра сайта')}</small></span><a class="mv-cbtn" href="${x.go === 'hub' ? '/hub/play' : e(x.go)}">▶ Войти</a></div>`).join('');
      V.el.innerHTML = `${stageHtml}${inv}
        <div class="dsf-sb"><div class="dsf-sbh"><b>🔊 Звуковая панель</b>
          <label class="dsf-vol" title="Громкость звуков панели — только у тебя">🔉<input type="range" min="0" max="100" value="${Math.round(s.vol * 100)}" data-fv="vol" aria-label="Громкость звуков"></label>
          <button type="button" class="ds-btn ghost ds-sm" data-fv="off" title="Не слышать звуки панели">${s.off ? '🔇 Звуки выкл.' : '🔈 Звуки вкл.'}</button></div>
          ${snd.length ? `<div class="dsf-pads">${snd.map(m => `<button type="button" class="dsf-pad" data-fv="snd" data-id="${+m.id}"${here ? '' : ' disabled'} title="${here ? 'Сыграть всем в голосовом' : 'Сначала зайди в голосовой'}">🔊 ${e(m.name)}</button>`).join('')}</div>`
            : `<div class="ds-dim">${missing ? 'Звуковая панель появится, когда сайт обновится.' : 'Звуков пока нет' + (d?.manage ? ' — добавь в «🎉 Фишки сервера».' : '.')}</div>`}
          <div class="dsf-snote" role="status"></div>
          <div class="ds-row"><button type="button" class="ds-btn ds-sm" data-fv="play"${here ? '' : ' disabled'}>🎮 Играть вместе</button><span class="ds-dim">${here ? '' : 'Зайди в голосовой — и зови всех в игру'}</span></div></div>`;
    } finally { drawing = false; }
  }
  window.addEventListener('d37:voice', () => { if (V) { stageEnforce(); voiceDraw(); if (!inVoice() && V.myHand) V.myHand = false; } });
  document.addEventListener('input', ev => {
    const r = ev.target?.closest?.('[data-fv="vol"]'); if (!r) return;
    LSset('d37_ds_sb', Object.assign(SB(), { vol: Math.max(0, Math.min(1, +r.value / 100)) }));
  });
  document.addEventListener('click', async ev => {
    const b = ev.target?.closest?.('[data-fv]'); if (!b || !V || !V.el.contains(b)) return;
    const k = b.dataset.fv, me = P.me();
    if (k === 'off') { LSset('d37_ds_sb', Object.assign(SB(), { off: !SB().off })); voiceDraw(); }
    else if (k === 'snd') {
      if (!me) { P.toast('Войди в аккаунт', false); return; }
      b.disabled = true;
      const id = +b.dataset.id, r = await P.rpc('cf_sound_play', { p_community: cidOf(V.srv), p_id: id });
      setTimeout(() => { b.disabled = false; }, 1200);
      if (!r.data?.ok) { P.toast('⚠️ ' + (r.data?.reason === 'wait' ? `подожди ${+r.data.wait || 1} с` : why(r)), false); return; }
      const nick = (typeof currentProfile !== 'undefined' && currentProfile?.nick) || 'я';
      bcSend({ t: 'snd', id, uid: me, nick });
      playSound(id, nick);
    } else if (k === 'hand') { V.myHand = !V.myHand; bcSend({ t: 'hand', on: V.myHand, uid: me, nick: (typeof currentProfile !== 'undefined' && currentProfile?.nick) || '' }); voiceDraw(); }
    else if (k === 'spk' || k === 'unspk') {
      const r = await P.rpc('cf_stage_speaker', { p_community: cidOf(V.srv), p_ch: String(V.ch.id), p_uid: b.dataset.u, p_on: k === 'spk' });
      if (!r.data?.ok) { P.toast('⚠️ ' + why(r), false); return; }
      V.hands.delete(b.dataset.u); bcSend({ t: 'stage' }); await stageLoad(); voiceDraw();
    } else if (k === 'play') {
      const srvOk = V.srv, chV = V.ch;
      playTogether({ srv: srvOk, ch: chV }, text => {
        const m = /(#\/games\/[a-z0-9]+\/(?:coop\/)?[a-z0-9]{4,12})|\/hub\/play/.exec(text); if (!m) return;
        const go = m[1] || 'hub', title = (/«([^»]{1,40})»/.exec(text) || [])[1] || '';
        bcSend({ t: 'play', go, title, nick: (typeof currentProfile !== 'undefined' && currentProfile?.nick) || 'кто-то' });
      });
    }
  });

  // ═══ Экран «🎉 Фишки сервера»: уровни и годовщина, эмодзи / стикеры / звуки, настройки, проверка (команда сайта) ═══
  const TABS = [['lv', '⭐ Уровни'], ['media', '😀 Эмодзи и звуки'], ['set', '⚙️ Настройки'], ['queue', '🛡 Проверка']];
  X.sub.fun = {
    title: '🎉 Фишки сервера',
    async render(el, mode, srv, rest){
      const tab = TABS.some(t => t[0] === rest[0]) ? rest[0] : 'lv';
      el.innerHTML = '<div class="ds-pane"><div class="ds-dim">Загружаем…</div></div>';
      const [d, m] = await Promise.all([funGet(srv, true), mediaList(srv, true)]);
      if (!el.isConnected) return;
      if (!d) { el.innerHTML = `<div class="ds-pane"><h3>🎉 Фишки сервера</h3><div class="ds-soon">🛠️ ${missing ? 'Появится, когда сайт обновится.' : 'Не загрузилось — проверь интернет.'}</div></div>`; return; }
      const staff = ['admin', 'moderator'].includes(typeof currentRole !== 'undefined' ? currentRole : '');
      const tabs = TABS.filter(([k]) => k === 'lv' || k === 'media' || (k === 'set' && d.manage) || (k === 'queue' && staff));
      const href = k => DS.link(mode, srv.official ? DS.OFF_ID : srv.id, 'fun/' + k);
      el.innerHTML = `<div class="ds-pane ds-wide dsf-page"><h3>🎉 Фишки ${srv.official ? 'сервера «Денчик37»' : '«' + e(srv.name) + '»'}</h3>
        <div class="ds-chips">${tabs.map(([k, t]) => `<a class="${k === tab ? 'on' : ''}" href="${e(href(k))}">${t}</a>`).join('')}</div><div class="dsf-body"></div></div>`;
      const body = el.querySelector('.dsf-body');
      if (tab === 'lv') return tabLevels(body, srv, d);
      if (tab === 'media') return tabMedia(body, srv, m);
      if (tab === 'set' && d.manage) return tabSet(body, srv, d);
      if (tab === 'queue' && staff) return tabQueue(body);
      body.innerHTML = '<div class="ds-dim">Нет доступа.</div>';
    }
  };
  async function tabLevels(body, srv, d){
    const me = d.me;
    const pct = me ? Math.min(100, Math.round((me.xp - 5 * me.level * me.level) / Math.max(1, me.next - 5 * me.level * me.level) * 100)) : 0;
    body.innerHTML = `${me ? `<div class="dsf-me"><b>Твой уровень: ${+me.level}</b> ${X.annivBadge(me.since)}<div class="dsf-bar"><i style="width:${pct}%"></i></div><small class="ds-dim">${+me.xp} опыта · до уровня ${+me.level + 1} — ${Math.max(0, +me.next - +me.xp)}. +1 за сообщение, не чаще раза в минуту. Ничего не продаётся.</small></div>` : '<div class="ds-dim">Войди — и копи уровень на сервере.</div>'}
      ${d.levels ? '<h4>🏆 Самые активные</h4><div class="dsf-top"><div class="ds-dim">Загружаем…</div></div>' : '<div class="ds-dim">Уровни на этом сервере выключены.</div>'}`;
    if (!d.levels) return;
    const r = await P.rpc('cf_levels_top', { p_community: cidOf(srv) });
    const box = body.querySelector('.dsf-top'); if (!box) return;
    const list = r.data?.ok ? r.data.list || [] : [];
    box.innerHTML = list.length ? list.map((x, i) => `<div class="dsf-trow"><b>${i + 1}</b><span>${e(x.nick || 'игрок')}</span>${X.annivBadge(x.since)}<em>ур. ${+x.level}</em><small>${+x.xp}</small></div>`).join('') : '<div class="ds-dim">Пока пусто — напиши что-нибудь!</div>';
  }
  const KIND = { emoji: ['😀 Эмодзи', 50, 'до 64×64, вставляются в текст как :имя:'], sticker: ['🖼 Стикеры', 30, 'до 160×160, крупно, отдельным сообщением'], sound: ['🔊 Звуки', 24, 'до 5 секунд и 50 КБ, mp3 / ogg / wav — для голосовых'] };
  const ST = { ok: '', pending: '⏳ ждёт проверки', rejected: '❌ отклонено' };
  function tabMedia(body, srv, m){
    if (!m) { body.innerHTML = `<div class="ds-dim">${missing ? 'Появится, когда сайт обновится.' : 'Не загрузилось.'}</div>`; return; }
    (m.list || []).filter(x => x.kind === 'sticker' && x.status === 'ok').forEach(x => fetchSoon(+x.id));
    const s = SB();
    body.innerHTML = `<p class="ds-dim">${srv.official ? 'Эмодзи, стикеры и звуки сервера сайта.' : 'Загружают те, кто управляет каналами. Сообщество — детская аудитория: новое видно всем после проверки командой сайта (обычно за день).'}</p>
      ${Object.entries(KIND).map(([k, [t, cap, hint]]) => { const l = m.list.filter(x => x.kind === k); return `<div class="ds-sect"><b>${t}</b> <span class="ds-dim">${l.filter(x => x.status !== 'rejected').length} / ${cap} · ${hint}</span>
        <div class="dsf-mlist">${l.map(x => `<div class="dsf-mi${x.status !== 'ok' ? ' wait' : ''}">${k === 'emoji' && x.data && IMG_RE.test(x.data) ? `<img src="${e(x.data)}" alt="">` : k === 'sticker' ? (x.status === 'ok' ? MV.emojiHook('stk_' + (+x.id)) : '🖼') : `<button type="button" class="ds-btn ghost ds-sm" data-fm="hear" data-id="${+x.id}"${x.status === 'ok' ? '' : ' disabled'}>▶</button>`}
          <span>:${e(x.name)}:${ST[x.status] ? `<small>${ST[x.status]}${x.note ? ' — ' + e(x.note) : ''}</small>` : ''}</span>${m.manage ? `<button type="button" class="dsf-x" data-fm="del" data-id="${+x.id}" title="Удалить">🗑</button>` : ''}</div>`).join('') || '<span class="ds-dim">пока нет</span>'}</div>
        ${m.manage ? `<div class="ds-row dsf-up"><input class="ds-in ds-sm" data-fm="name" data-k="${k}" maxlength="24" placeholder="имя (латиница)" aria-label="Имя"><label class="ds-btn ghost ds-sm">📁 Файл<input type="file" hidden data-fm="file" data-k="${k}" accept="${k === 'sound' ? 'audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4,audio/aac' : 'image/png,image/webp,image/jpeg,image/gif'}"></label><span class="ds-dim" data-fm="msg" data-k="${k}" role="status"></span></div>` : ''}</div>`; }).join('')}
      <div class="ds-sect"><b>🔉 Звуки у меня</b><div class="ds-row"><label class="dsf-vol">Громкость<input type="range" min="0" max="100" value="${Math.round(s.vol * 100)}" data-fm="vol"></label><label><input type="checkbox" data-fm="off"${s.off ? ' checked' : ''}> не слышать звуки панели</label></div></div>`;
    body.oninput = ev => { const r = ev.target.closest('[data-fm="vol"]'); if (r) LSset('d37_ds_sb', Object.assign(SB(), { vol: +r.value / 100 })); };
    body.onchange = async ev => {
      const t = ev.target;
      if (t.dataset.fm === 'off') { LSset('d37_ds_sb', Object.assign(SB(), { off: t.checked })); return; }
      if (t.dataset.fm !== 'file' || !t.files?.[0]) return;
      const k = t.dataset.k, msg = body.querySelector(`[data-fm="msg"][data-k="${k}"]`), nm = body.querySelector(`[data-fm="name"][data-k="${k}"]`);
      const name = (nm.value || t.files[0].name.replace(/\.[^.]+$/, '')).toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 24);
      msg.textContent = '⏳ Готовим…';
      try {
        const prep = k === 'sound' ? await prepSound(t.files[0]) : await prepImage(t.files[0], k === 'emoji' ? 64 : 160, k === 'emoji' ? 6000 : 40000);
        const r = await P.rpc('cf_media_add', { p_community: cidOf(srv), p_kind: k, p_name: name, p_data: prep.data, p_dur: prep.dur || 0 });
        if (!r.data?.ok) { msg.textContent = '⚠️ ' + why(r); return; }
        msg.textContent = r.data.status === 'ok' ? '✅ Добавлено' : '✅ Отправлено на проверку';
        setTimeout(() => mediaList(srv, true).then(d => { if (body.isConnected) tabMedia(body, srv, d); }), 700);
      } catch (er) { msg.textContent = '⚠️ ' + (er?.message || 'не получилось'); }
      t.value = '';
    };
    body.onclick = async ev => {
      const b = ev.target.closest('[data-fm]'); if (!b) return;
      if (b.dataset.fm === 'hear') { fetchSoon(+b.dataset.id); setTimeout(() => { const x = MEDIA.get(+b.dataset.id); if (x?.kind === 'sound' && SND_RE.test(x.data)) { const a = new Audio(x.data); a.volume = SB().vol; a.play().catch(() => {}); } }, MEDIA.has(+b.dataset.id) ? 0 : 500); }
      else if (b.dataset.fm === 'del') {
        if (await sheet('🗑 Удалить?', '<p class="ds-dim">Из старых сообщений он тоже пропадёт.</p><button type="button" class="ds4-wide ds4-go" data-v="yes">🗑 Удалить</button>') !== 'yes') return;
        const r = await P.rpc('cf_media_del', { p_id: +b.dataset.id });
        if (!r.data?.ok) { P.toast('⚠️ ' + why(r), false); return; }
        MEDIA.delete(+b.dataset.id); mediaList(srv, true).then(d => tabMedia(body, srv, d));
      }
    };
  }
  // картинка → квадрат до size px (webp; нет webp — png), ужимаем качество, пока не влезет в max знаков. EXIF и анимация пропадают
  async function prepImage(file, size, max){
    if (!/^image\/(png|webp|jpeg|gif)$/.test(file.type) || file.size > 4e6) throw new Error('нужна картинка png / webp / jpg / gif до 4 МБ');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('картинка не открылась')); i.src = url; });
      const k = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
      for (const q of [0.9, 0.8, 0.65, 0.5, 0.35]) {
        let d = c.toDataURL('image/webp', q); if (!d.startsWith('data:image/webp')) d = c.toDataURL('image/png');
        if (d.length <= max && IMG_RE.test(d)) return { data: d };
      }
      throw new Error('не ужимается — возьми картинку проще');
    } finally { URL.revokeObjectURL(url); }
  }
  async function prepSound(file){
    if (!/^audio\/(mpeg|ogg|webm|wav|x-wav|mp4|aac)$/.test(file.type)) throw new Error('нужен звук mp3 / ogg / wav');
    if (file.size > 51000) throw new Error('звук — до 50 КБ (5 секунд)');
    const buf = await file.arrayBuffer();
    let dur = 0;
    try { const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC(); const a = await ac.decodeAudioData(buf.slice(0)); dur = Math.round(a.duration * 1000); ac.close(); } catch (er) { throw new Error('звук не открылся'); }
    if (dur < 200 || dur > 5000) throw new Error('звук — от 0,2 до 5 секунд');
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).replace(/^data:audio\/(x-wav|wave)/, 'data:audio/wav')); r.onerror = rej; r.readAsDataURL(file); });
    if (!SND_RE.test(data)) throw new Error('такой звук нельзя');
    return { data, dur };
  }
  function tabSet(body, srv, d){
    const texts = (srv.channels || []).filter(c => c.kind === 'text' && !c.archived && !c.soon);
    const voices = (srv.channels || []).filter(c => c.kind === 'voice' && !c.soon);
    const start = new Set((d.start_chs || []).map(String)), stage = new Set((d.stage_chs || []).map(String));
    body.innerHTML = `<div class="ds-sect"><b>👋 С чего начать</b><p class="ds-dim">До 5 каналов — новичок увидит их один раз (после правил).</p>
        <div class="dsf-checks">${texts.map(c => `<label><input type="checkbox" data-st="start" value="${e(c.id)}"${start.has(String(c.id)) ? ' checked' : ''}> ${c.emoji ? e(c.emoji) : '#'} ${e(c.name)}</label>`).join('') || '<span class="ds-dim">Нет текстовых каналов</span>'}</div></div>
      <div class="ds-sect"><b>🎙 Сцена</b><p class="ds-dim">В таком голосовом говорят только выбранные (до 6), остальные слушают и поднимают руку ✋ — для эфиров и интервью. До 3 каналов.</p>
        <div class="dsf-checks">${voices.map(c => `<label><input type="checkbox" data-st="stage" value="${e(c.id)}"${stage.has(String(c.id)) ? ' checked' : ''}> 🔊 ${e(c.name)}</label>`).join('') || '<span class="ds-dim">Нет голосовых каналов</span>'}</div></div>
      ${srv.official ? '' : `<div class="ds-sect"><b>🏷 Метки в обзоре 🧭</b><p class="ds-dim">До 5 меток через запятую — по ним сервер находят (например: майнкрафт, рисование, стримы).</p><input class="ds-in" data-st="tags" maxlength="100" value="${e((d.tags || []).join(', '))}"></div>`}
      <div class="ds-sect"><label><input type="checkbox" data-st="levels"${d.levels ? ' checked' : ''}> ⭐ Уровни активности на сервере (+1 опыт за сообщение, не чаще раза в минуту)</label></div>
      <div class="ds-row"><button type="button" class="ds-btn" data-st="save">💾 Сохранить</button><span class="ds-dim" data-st="msg" role="status"></span></div>`;
    body.querySelector('[data-st="save"]').onclick = async () => {
      const vals = k => [...body.querySelectorAll(`[data-st="${k}"]:checked`)].map(x => x.value);
      const tags = srv.official ? [] : String(body.querySelector('[data-st="tags"]').value || '').split(/[,#]/).map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 5);
      const r = await P.rpc('cf_server_set', { p_community: cidOf(srv), p_start: vals('start').slice(0, 5), p_tags: tags, p_levels: body.querySelector('[data-st="levels"]').checked, p_stage: vals('stage').slice(0, 3) });
      body.querySelector('[data-st="msg"]').textContent = r.data?.ok ? '✅ Сохранено' : '⚠️ ' + why(r);
      if (r.data?.ok) { FUN.delete(skey(srv)); TAGS.delete(+srv.id); }
    };
  }
  async function tabQueue(body){
    body.innerHTML = '<div class="ds-dim">Загружаем очередь…</div>';
    const r = await P.rpc('cf_media_queue', {});
    if (!body.isConnected) return;
    const list = r.data?.ok ? r.data.list || [] : null;
    if (!list) { body.innerHTML = `<div class="ds-dim">⚠️ ${e(why(r))}</div>`; return; }
    body.innerHTML = `<p class="ds-dim">Эмодзи, стикеры и звуки сообществ ждут проверки. Сайт детский: без мата, жестокости, 18+, чужих лиц и рекламы.</p>
      ${list.map(x => `<div class="dsf-q" data-id="${+x.id}">${x.kind === 'sound' ? (SND_RE.test(x.data || '') ? `<audio controls preload="none" src="${e(x.data)}"></audio>` : '🔊 ?') : IMG_RE.test(x.data || '') ? `<img src="${e(x.data)}" alt="">` : '🖼 ?'}
        <span><b>:${e(x.name)}:</b><small>${e({ emoji: 'эмодзи', sticker: 'стикер', sound: 'звук' }[x.kind] || '')} · ${e(x.cname || 'сервер сайта')} · ${e(P.ago ? P.ago(x.at) : '')}</small></span>
        <button type="button" class="ds-btn ds-sm" data-q="ok">✅</button><button type="button" class="ds-btn ghost ds-sm" data-q="no">❌</button></div>`).join('') || '<div class="ds-dim">Очередь пуста 🎉</div>'}`;
    body.onclick = async ev => {
      const b = ev.target.closest('[data-q]'); if (!b) return;
      const row = b.closest('[data-id]'), ok = b.dataset.q === 'ok';
      const note = ok ? '' : await sheet('❌ Причина', '<input class="ds-in" data-f="why" maxlength="200" placeholder="например: мат, жестокость, чужое лицо"><button type="button" class="ds4-wide ds4-go" data-v="go">❌ Отклонить</button>', w => w.querySelector('[data-f="why"]').value.trim() || 'не подходит для детей');
      if (!ok && note == null) return;
      const rr = await P.rpc('cf_media_review', { p_id: +row.dataset.id, p_ok: ok, p_note: note || '' });
      if (rr.data?.ok) row.remove(); else P.toast('⚠️ ' + why(rr), false);
    };
  }

  window.D37DsFun = { _test: { toIds, prepImage, years, days, onBc: p => V && onBc(p), get V(){ return V; }, MEDIA, LIST, CTX } };
})();
