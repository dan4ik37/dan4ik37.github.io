// ═══════════════════════════════════════
//  СООБЩЕНИЯ «КАК В ДИСКОРДЕ» (T-164, ds-msg; владелец 13.11: «наш дс до уровня дс не дотягивает, не хватает интересных фишек»)
//  Надстройка над лентой MsgView (msgview.js — крючки MV.dsm.*): разметка (**жирный**, *курсив*, ~~зачёркнутый~~, __подчёркнутый__,
//  `код`, ```блок```, > цитата, списки, # заголовок, ||спойлер||), 🧵 ветки из сообщения (панель сбоку, «N ответов», 🔔 следить),
//  📊 опросы (один голос, итоги, срок), 🗂 каналы-форумы (заголовок и теги поста), 🔍 поиск from: / has: / before: / after: / in:server,
//  🕘 история правок (автору и модераторам), 🔗 ссылка на сообщение и переход по ней (?m=<номер>), ⬆ к первому новому,
//  @here / @everyone / @роль в подсказке (детям — нет; рассылку решает сервер).
//  Сервер — community.sql часть 12 (dsm_*). Нет части 12 — работают только разметка, ссылка и поиск (ветки, опросы, форумы прячутся).
//  Чужой текст — только через esc() (MV.richBase) / textContent. Откат одной строкой: DSM_ON = false.
// ═══════════════════════════════════════
(() => {
  const DSM_ON = true;
  const MV = window.MsgView = window.MsgView || {};
  if (!DSM_ON || MV.dsm) return;
  const P = window.D37Phone;
  const e = s => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const sb = () => (typeof sbClient !== 'undefined' ? sbClient : null);
  const clean = t => (P?.clean ? P.clean(t) : String(t || ''));
  const plural = (n, a, b, c) => (P?.plural ? P.plural(n, a, b, c) : c);
  const when = iso => (P?.when ? P.when(iso) : new Date(iso).toLocaleString('ru-RU'));
  const touch = () => matchMedia('(pointer: coarse)').matches;
  const isKid = () => !!window.D37Age?.kid?.();
  const D = window.D37Dsm = { ready: false, polls: new Map(), forums: new Map(), fl: new Set(), posts: new Map(), pend: null, views: new Set() };

  // стили — свой файл (ds.css не трогаем: там работают другие)
  try { if (!document.querySelector('link[data-dsm]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/ds-msg.css?v=1'; l.dataset.dsm = '1'; document.head.appendChild(l); } } catch (er) {}

  // ═══ Разметка: метки → символы из «личной зоны» Юникода (их нет в обычном тексте), текст — через MV.richBase (esc, мат, ссылки,
  //     карточки, детский фильтр), потом символы → теги. Непарные теги закрываются, внутри тегов (атрибуты) символы удаляются. ═══
  const PUA = /[-]/g;
  const MK = { b: ['', ''], i: ['', ''], s: ['', ''], u: ['', ''], sp: ['', ''] };
  const OPEN = { '': ['b', '<b class="dsm-b">'], '': ['i', '<i class="dsm-i">'], '': ['s', '<s class="dsm-s">'], '': ['u', '<u class="dsm-u">'], '': ['sp', '<span class="dsm-sp" role="button" tabindex="0" title="Спойлер — нажми, чтобы открыть">'] };
  const CLOSE = { '': 'b', '': 'i', '': 's', '': 'u', '': 'sp' };
  const END = { b: '</b>', i: '</i>', s: '</s>', u: '</u>', sp: '</span>' };
  const CODE_OPEN = '', CODE_CLOSE = '';
  const MD_RE = /\*\*|__|~~|\|\||`|(^|\n)\s{0,3}(>|[-*•]\s|\d{1,3}[.)]\s|#{1,3}\s)|(^|[^\p{L}0-9*])\*\S|(^|[^\p{L}0-9_])_\S/u;
  const POLL_RE = /\[\[poll:(\d{1,12})\]\]/;
  // ссылка, @ник, :эмодзи: — метки отделяем пробелом, иначе richBase их не узнает (и чужая ссылка не скроется)
  const SPECIAL = /^(https?:|www\.|#\/|@|:[a-z0-9_]{1,32}:$)|[a-z0-9-]{2,}\.[a-zа-я]{2,}/i;
  function inline(s, codes){
    s = s.replace(/`([^`\n]{1,300})`/g, (m, c) => { codes.push(c); return CODE_OPEN + (codes.length - 1) + CODE_CLOSE; });
    // две группы (граница + текст) — курсив; одна — остальные. Номер позиции в replace не путаем с группой
    const wrap = (re, k) => { const two = re.source.startsWith('(^|'); s = s.replace(re, (m, a, b) => two ? a + MK[k][0] + b + MK[k][1] : MK[k][0] + a + MK[k][1]); };
    wrap(/\|\|([^\n|]+?)\|\|/g, 'sp');   // ||спойлер|| (можно с пробелами внутри)
    wrap(/\*\*(?=\S)([^\n]+?)(?<=\S)\*\*/g, 'b');
    wrap(/__(?=\S)([^\n]+?)(?<=\S)__/g, 'u');
    wrap(/~~(?=\S)([^\n]+?)(?<=\S)~~/g, 's');
    wrap(/(^|[^\p{L}0-9*\\])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\p{L}0-9*])/gu, 'i');
    wrap(/(^|[^\p{L}0-9_\\])_(?=\S)([^_\n]+?)(?<=\S)_(?![\p{L}0-9_])/gu, 'i');
    // метки у ссылок / @ / эмодзи — отдельными «словами»
    return s.split(/(\s+)/).map(w => {
      if (!/[-]/.test(w)) return w;
      const core = w.replace(/[-]/g, '');
      if (!SPECIAL.test(core)) return w;
      const lead = (w.match(/^[-]+/) || [''])[0], tail = (w.match(/[-]+$/) || [''])[0];
      const mid = w.slice(lead.length, w.length - tail.length).replace(/[-]/g, '');
      return (lead ? lead + ' ' : '') + mid + (tail ? ' ' + tail : '');
    }).join('');
  }
  // текст кода: тот же фильтр, что у обычного текста (детский, мат, чужие ссылки — «[ссылка]»), но без карточек и разметки
  function codeText(s, kid){
    let t = kid && window.D37Age?.kidText ? window.D37Age.kidText(String(s), { at: false }) : String(s);
    t = t.split(/(\s+)/).map(w => (!w || /^\s+$/.test(w)) ? w : (MV.sitePath?.(w) ? w : MV.EXT_RE?.test(w) ? '[ссылка]' : w)).join('');
    return clean(t);
  }
  function fix(html, codes, kid){
    html = html.replace(/<[^>]*>/g, t => t.replace(PUA, ''));   // в атрибутах (адрес ссылки) — без меток
    const stack = [];
    let out = '';
    for (const part of html.split(/(<[^>]*>)/)) {
      if (part[0] === '<') { out += part; continue; }
      out += part.replace(/(\d{1,3})|[-]/g, (m, ci) => {
        if (ci !== undefined) return codes[+ci] !== undefined ? `<code class="dsm-c">${e(codeText(codes[+ci], kid))}</code>` : '';
        if (OPEN[m]) { stack.push(OPEN[m][0]); return OPEN[m][1]; }
        const k = CLOSE[m];
        if (k && stack.length && stack[stack.length - 1] === k) { stack.pop(); return END[k]; }
        return '';
      });
    }
    while (stack.length) out += END[stack.pop()];
    return out;
  }
  function md(text, nick, o, base){
    let t = String(text || '');
    if (t.includes('[[poll:')) t = t.replace(/\s*\[\[poll:\d{1,12}\]\]/g, '');
    if (o.raw || !MD_RE.test(t)) return base(t, nick, o);
    t = t.replace(PUA, '');
    const kid = !!o.kid && !!window.D37Age;
    const cards = [];
    const addCards = r => { for (const c of r.cards || []) if (cards.length < 2 && !cards.some(x => JSON.stringify(x) === JSON.stringify(c))) cards.push(c); };
    const line = s => { const codes = []; const r = base(inline(s, codes), nick, o); addCards(r); return fix(r.html, codes, kid); };
    let html = '', prev = '', blank = 0;
    const items = [];
    const parts = t.split(/(```[\s\S]*?```)/);
    parts.forEach((part, pi) => {
      if (pi % 2 === 1) {
        const body = part.slice(3, -3).replace(/^[a-z0-9+#.-]{1,15}\n/i, '').replace(/^\n|\n$/g, '');
        items.push({ k: 'pre', html: `<pre class="dsm-pre"><code>${e(codeText(body, kid))}</code></pre>` });
        return;
      }
      let lines = part.split('\n');
      if (pi > 0 && lines[0] === '') lines = lines.slice(1);
      if (pi < parts.length - 1 && lines[lines.length - 1] === '') lines = lines.slice(0, -1);
      for (const ln of lines) {
        let m;
        if ((m = /^\s{0,3}>\s?(.*)$/.exec(ln))) items.push({ k: 'q', html: line(m[1]) });
        else if ((m = /^\s{0,3}[-*•]\s+(.*)$/.exec(ln))) items.push({ k: 'ul', html: line(m[1]) });
        else if ((m = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/.exec(ln))) items.push({ k: 'ol', html: line(m[2]), start: +m[1] });
        else if ((m = /^\s{0,3}(#{1,3})\s+(.+)$/.exec(ln))) items.push({ k: 'h', html: `<span class="dsm-h dsm-h${m[1].length}">${line(m[2])}</span>` });
        else if (!ln.trim()) items.push({ k: 'blank' });
        else items.push({ k: 'p', html: line(ln) });
      }
    });
    for (let i = 0; i < items.length;) {
      const it = items[i];
      if (it.k === 'blank') { blank++; i++; continue; }
      if (it.k === 'q' || it.k === 'ul' || it.k === 'ol') {
        let j = i; const g = [];
        while (j < items.length && items[j].k === it.k) g.push(items[j++].html);
        html += it.k === 'q' ? `<blockquote class="dsm-q">${g.join('<br>')}</blockquote>`
          : it.k === 'ul' ? `<ul class="dsm-ul">${g.map(x => `<li>${x}</li>`).join('')}</ul>`
          : `<ol class="dsm-ol"${it.start > 1 ? ` start="${it.start}"` : ''}>${g.map(x => `<li>${x}</li>`).join('')}</ol>`;
        i = j; prev = 'block'; blank = 0; continue;
      }
      if (it.k === 'p') { if (prev === 'p') html += blank ? '<br><br>' : '<br>'; html += it.html; prev = 'p'; }
      else { html += it.html; prev = 'block'; }
      blank = 0; i++;
    }
    return { html, cards, big: false };
  }

  // ═══ Канал ленты: o — сервер сайта (messages), c — сообщество (community_messages); ЛС и прочее — null ═══
  function ctx(A){
    if (!A) return null;
    if (A.dsmCtx) return A.dsmCtx;
    const k = String(A.key || '');
    if (k.startsWith('o:')) return { kind: 'o', cid: null, ch: k.slice(2), table: 'messages' };
    if (k.startsWith('c:') && A.community) return { kind: 'c', cid: +A.community, ch: k.slice(2), table: 'community_messages' };
    return null;
  }
  const isThreadView = V => !!V?.opt?.dsmThread;
  const numId = id => typeof id === 'number';
  function mapRow(c, r){
    if (c.kind === 'o' && typeof offMsg === 'function') return offMsg(r);   // eslint-disable-line no-undef
    const f = window.D37DS?._test?.cmMsg;
    if (c.kind === 'c' && f) return Object.assign(f(r), { myReacts: new Set() });
    return { id: r.id, uid: r.user_id || null, nick: r.nick || 'игрок', text: r.text || '', at: r.created_at, reply: r.reply_to || null, edited: r.edited_at || null,
      deleted: !!r.deleted, att: r.att || null, thread: r.thread_id || null, tn: r.thread_n || 0, tat: r.thread_at || null };
  }
  const chanHref = c => c.kind === 'o' ? '#/chat/' + c.ch : `#/chat/c/${c.cid}/${c.ch}`;
  const chanName = (c, ch) => {
    if (c.kind === 'o' && typeof OFF !== 'undefined') { const x = OFF.channels?.find?.(y => y.id === (ch || 'general')); if (x) return '#' + x.name; }   // eslint-disable-line no-undef
    return '#канал';
  };
  const myUid = V => V.A?.me?.()?.uid || P?.me?.() || null;
  const canMod = (V, c) => !!V.A?.me?.()?.staff || (c?.kind === 'c' && !!V.A?.canPin?.({}));

  // ═══ 🧵 Ветки ═══
  function threadAdapter(PA, c, root){
    const T = Object.create(PA);
    const fns = new Set();
    Object.defineProperty(T, 'caps', { value: Object.assign({}, PA.caps, { pin: false, search: false, stickers: false, typing: false }) });
    Object.assign(T, {
      key: `thr:${c.kind}:${root.id}`, dsmCtx: c, dsmRoot: root, dsmFns: fns,
      title: 'ветку', placeholder: 'Ответить в ветке…', startText: 'Начало ветки', emptyText: 'Ответов пока нет — напиши первым',
      pins: null, search: null, typing: null, sendSticker: null,
      async load({ before }){
        const s = sb(); if (!s) return { list: [], err: true, errText: 'нет связи с сервером' };
        let q = s.from(c.table).select('*').eq('thread_id', root.id).eq('deleted', false).order('id', { ascending: false }).limit(50);
        if (before) q = q.lt('id', before);
        const { data, error } = await q;
        if (error) return { list: [], err: error, errText: P.err(error) };
        const list = (data || []).map(r => mapRow(c, r)).reverse();
        const more = (data || []).length === 50;
        if (!more) list.unshift(Object.assign({}, root, { tn: 0 }));
        return { list, more };
      },
      sub(fn){ fns.add(fn); return () => fns.delete(fn); },
      send: (text, reply) => PA.send(text, reply, root.id),
    });
    return T;
  }
  function closeThread(V){
    const t = V.dsmT; if (!t) return;
    V.dsmT = null;
    try { t.child.destroy(); } catch (er) {}
    t.box.remove();
    V.root.classList.remove('dsm-thr-open', 'dsm-thr-side');
  }
  async function openThread(V, root){
    const c = ctx(V.A); if (!c || !D.ready || !numId(root.id) || root.thread) return;
    closeThread(V);
    const box = document.createElement('div');
    box.className = 'dsm-thr';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Ветка');
    box.innerHTML = `<div class="dsm-thh"><b>🧵 Ветка</b><span class="dsm-tht"></span><button type="button" class="dsm-hb" data-dsm="follow" hidden>🔔</button><button type="button" class="dsm-hb" data-dsm="thrclose" aria-label="Закрыть ветку">✕</button></div><div class="dsm-thv"></div>`;
    box.querySelector('.dsm-tht').textContent = clean(String(root.text || '').replace(/\s*\[\[poll:\d+\]\]/g, '')).slice(0, 60) || 'сообщение';
    V.root.appendChild(box);
    V.root.classList.add('dsm-thr-open');
    V.root.classList.toggle('dsm-thr-side', V.root.clientWidth >= 900);
    const T = threadAdapter(V.A, c, root);
    const child = MV.mount(box.querySelector('.dsm-thv'), { compact: true, noFocus: touch(), dsmThread: true });
    V.dsmT = { box, child, root, fns: T.dsmFns, akey: V.A.key };
    box.addEventListener('keydown', ev => { if (ev.key === 'Escape') { closeThread(V); ev.stopPropagation(); } });
    child.setAdapter(T);
    // 🔔 следить: строка dsm_follows (видно только своё — RLS)
    if (myUid(V) && sb()) {
      const { data } = await sb().from('dsm_follows').select('on_').eq('kind', c.kind).eq('root_id', root.id).maybeSingle().then(r => r, () => ({}));
      if (V.dsmT?.child !== child) return;
      setFollow(box, !!data?.on_);
    }
  }
  function setFollow(box, on){
    const b = box.querySelector('[data-dsm="follow"]'); if (!b) return;
    b.hidden = false; b.dataset.on = on ? '1' : '';
    b.textContent = on ? '🔔 Слежу' : '🔕 Следить';
    b.title = on ? 'Новые ответы приходят в 🔔 — нажми, чтобы не следить' : 'Следить за веткой: новые ответы — в 🔔';
  }
  async function toggleFollow(V){
    const t = V.dsmT; if (!t) return;
    const c = ctx(V.A), b = t.box.querySelector('[data-dsm="follow"]'), on = !b.dataset.on;
    const r = await P.rpc('dsm_follow', { p_kind: c.kind, p_root: t.root.id, p_on: on });
    if (r.data?.ok) setFollow(t.box, r.data.on); else t.child.note?.('⚠️ Не получилось: ' + (r.data?.reason || P.err(r.error)));
  }

  // ═══ 📊 Опросы ═══
  const pollNeed = new Set(); let pollT = 0;
  function pollHtml(id){
    const p = D.polls.get(id);
    if (p === undefined) { pollNeed.add(id); clearTimeout(pollT); pollT = setTimeout(pollFetch, 30); return `<div class="dsm-poll" data-dsmpoll="${id}"><b class="dsm-pq">📊 Опрос</b><small>Загружаем…</small></div>`; }
    if (!p) return `<div class="dsm-poll off" data-dsmpoll="${id}"><b class="dsm-pq">📊 Опрос недоступен</b></div>`;
    const sum = p.counts.reduce((a, b) => a + b, 0), my = new Set(p.my || []), res = p.closed || my.size > 0;
    const left = p.closed ? 'опрос завершён' : 'до ' + new Date(p.ends_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const opts = (p.opts || []).map((o, i) => {
      const pct = sum ? Math.round(p.counts[i] / sum * 100) : 0;
      return `<button type="button" class="dsm-po${my.has(i) ? ' on' : ''}" data-dsm="pv" data-opt="${i}"${p.closed ? ' disabled' : ''}><i style="width:${res ? pct : 0}%"></i><span>${my.has(i) ? '✓ ' : ''}${e(clean(o))}</span>${res ? `<em>${pct}% · ${p.counts[i]}</em>` : ''}</button>`;
    }).join('');
    return `<div class="dsm-poll${p.closed ? ' off' : ''}" data-dsmpoll="${id}"><b class="dsm-pq">📊 ${e(clean(p.q))}</b><small>${p.multi ? 'можно выбрать несколько' : 'один ответ'} · ${e(left)}</small>${opts}<div class="dsm-pf"><span>${p.voters} ${plural(p.voters, 'голос', 'голоса', 'голосов')}</span>${p.can_end ? '<button type="button" data-dsm="pend">⏹ Завершить</button>' : ''}<button type="button" data-dsm="prf" title="Обновить">↻</button></div></div>`;
  }
  const pollPaint = id => document.querySelectorAll(`.dsm-poll[data-dsmpoll="${+id}"]`).forEach(x => { x.outerHTML = pollHtml(+id); });
  async function pollFetch(){
    const ids = [...pollNeed]; pollNeed.clear();
    for (const id of ids) {
      D.polls.set(id, null);   // загружается
      const r = await P.rpc('dsm_poll_get', { p_id: id });
      D.polls.set(id, r.data?.ok ? r.data.poll : r.error && !r.missing ? undefined : false);
      if (D.polls.get(id) === undefined) D.polls.delete(id);
      pollPaint(id);
    }
  }
  async function pollVote(V, id, opt){
    const p = D.polls.get(id); if (!p || p.closed) return;
    if (!P.me()) { if (typeof openGlobalAuth === 'function') openGlobalAuth('login'); return; }
    let my = new Set(p.my || []);
    if (p.multi) { if (my.has(opt)) my.delete(opt); else my.add(opt); } else my = my.has(opt) ? new Set() : new Set([opt]);
    const r = await P.rpc('dsm_poll_vote', { p_id: id, p_opts: [...my] });
    if (r.data?.ok) { D.polls.set(id, r.data.poll); pollPaint(id); }
    else V.note?.('⚠️ ' + ({ closed: 'опрос уже закончился', member: 'сначала вступи в сообщество', not_found: 'опрос недоступен', auth: 'нужно войти' }[r.data?.reason] || P.err(r.error) || 'не получилось'), true, 2500);
  }
  async function pollEnd(V, id){
    const r = await P.rpc('dsm_poll_end', { p_id: id });
    if (r.data?.ok) { D.polls.set(id, r.data.poll); pollPaint(id); } else V.note?.('⚠️ Не получилось', true, 2000);
  }
  function pollForm(V){
    const c = ctx(V.A); if (!c) return;
    const b = V.openOver('<b>📊 Новый опрос</b>', `<div class="dsm-form">
      <label>Вопрос<input data-f="q" maxlength="200" placeholder="Например: во что играем вечером?"></label>
      <div class="dsm-opts">${[1, 2].map(i => `<input data-f="o" maxlength="80" placeholder="Вариант ${i}">`).join('')}</div>
      <button type="button" class="dsm-lbtn" data-dsm="padd">＋ Ещё вариант</button>
      <label>Сколько длится<select data-f="min"><option value="60">1 час</option><option value="480">8 часов</option><option value="1440" selected>1 день</option><option value="4320">3 дня</option><option value="10080">7 дней</option></select></label>
      <label class="dsm-chk"><input type="checkbox" data-f="multi"> можно выбрать несколько</label>
      <div class="dsm-err" hidden></div>
      <button type="button" class="mv-gbtn" data-dsm="pgo">Создать опрос</button></div>`);
    b.querySelector('[data-f="q"]').focus();
  }
  async function pollCreate(V, box){
    const c = ctx(V.A), err = box.querySelector('.dsm-err');
    const q = box.querySelector('[data-f="q"]').value.trim(), opts = [...box.querySelectorAll('[data-f="o"]')].map(x => x.value.trim()).filter(Boolean);
    const say = t => { err.hidden = false; err.textContent = t; };
    if (!q) return say('Напиши вопрос');
    if (opts.length < 2) return say('Нужно хотя бы 2 варианта');
    const go = box.querySelector('[data-dsm="pgo"]'); go.disabled = true;
    const r = await P.rpc('dsm_poll_create', { p_kind: c.kind, p_community: c.cid, p_channel: c.ch, p_question: q, p_options: opts, p_minutes: +box.querySelector('[data-f="min"]').value, p_multi: box.querySelector('[data-f="multi"]').checked });
    go.disabled = false;
    if (!r.data?.ok) return say(({ rights: 'здесь нельзя писать', len: 'вопрос — до 200 букв', options: '2–10 вариантов, каждый до 80 букв', bad: 'есть плохие слова', link: 'ссылки в опросе нельзя', time: 'срок — от 5 минут до 7 дней', rate: 'не больше 5 опросов в час' }[r.data?.reason]) || (r.missing ? 'опросы появятся, когда сайт обновится' : P.err(r.error)));
    const s = await V.A.send(`📊 ${q} [[poll:${r.data.id}]]`, null);
    if (!s?.ok) return say('Опрос создан, но сообщение не отправилось: ' + (s?.err || 'ошибка'));
    V.closeOver();
    if (s.m && !V.msgs.has(s.m.id)) V.onEvent({ t: 'ins', m: s.m });
    V.toBottom();
  }

  // ═══ 🕘 История правок ═══
  async function history(V, m){
    const c = ctx(V.A); if (!c || !numId(m.id)) return;
    const b = V.openOver('<b>🕘 История правок</b>', '<div class="mv-dim">Загружаем…</div>');
    const r = await P.rpc('dsm_edits_get', { p_kind: c.kind, p_id: m.id });
    if (!b.isConnected) return;
    if (!r.data?.ok) { b.innerHTML = `<div class="mv-dim">${e(r.data?.reason === 'rights' ? 'Прошлые версии видят автор и модераторы' : r.missing ? 'История появится, когда сайт обновится' : 'Не удалось загрузить')}</div>`; return; }
    const kid = isKid();
    const row = (t, at, cur) => `<div class="dsm-hv${cur ? ' cur' : ''}"><time>${cur ? 'сейчас' : e(when(at))}</time><div class="mv-text">${MV.rich(t, '', { kid }).html}</div></div>`;
    b.innerHTML = row(r.data.now, r.data.edited, true) + (r.data.list.length ? r.data.list.map(x => row(x.text, x.at)).join('') : '<div class="mv-dim">Прошлых версий нет (изменено до обновления сайта)</div>');
  }

  // ═══ 🔗 Ссылка на сообщение и переход ═══
  function msgLink(c, id){
    const h = chanHref(c);
    const base = window.D37Route?.abs ? window.D37Route.abs(h) : location.origin + '/' + h;
    return base + (base.includes('?') ? '&' : '?') + 'm=' + id;
  }
  function readPend(){
    const m = /[?&]m=(\d{1,12})(?!\d)/.exec(location.search + location.hash);
    if (m) D.pend = { id: +m[1], t: Date.now() };
  }
  readPend();
  window.addEventListener('d37:route', readPend);

  // ═══ 🔍 Поиск: from:ник has:file|link|poll|image|video before:2026-11-01 after:… in:server (и по-русски: от: есть: до: после: в:сервер) ═══
  const HAS = { file: 'file', файл: 'file', link: 'link', ссылка: 'link', poll: 'poll', опрос: 'poll', image: 'img', img: 'img', картинка: 'img', фото: 'img', video: 'vid', видео: 'vid' };
  function parseDate(s){
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/.exec(s); if (m) return new Date(m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : new Date().getFullYear(), +m[2] - 1, +m[1]);
    if (/^(сегодня|today)$/i.test(s)) { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
    if (/^(вчера|yesterday)$/i.test(s)) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 1); return d; }
    return null;
  }
  function parseQuery(s){
    const o = { words: [], has: new Set(), ops: 0 };
    for (const t of s.split(/\s+/).filter(Boolean)) {
      const m = /^(from|от|has|есть|before|до|after|после|in|в):(.+)$/i.exec(t);
      if (!m) { o.words.push(t); continue; }
      const k = m[1].toLowerCase(), v = m[2];
      if (k === 'from' || k === 'от') { o.from = v.replace(/^@/, ''); o.ops++; }
      else if (k === 'has' || k === 'есть') { if (HAS[v.toLowerCase()]) { o.has.add(HAS[v.toLowerCase()]); o.ops++; } else o.words.push(t); }
      else if (k === 'before' || k === 'до') { const d = parseDate(v); if (d) { o.before = d; o.ops++; } else o.words.push(t); }
      else if (k === 'after' || k === 'после') { const d = parseDate(v); if (d) { d.setDate(d.getDate() + 1); o.after = d; o.ops++; } else o.words.push(t); }
      else if (/^(server|сервер|all|все|везде)$/i.test(v)) { o.all = true; o.ops++; }
      else o.words.push(t);
    }
    return o;
  }
  const san = s => String(s || '').replace(/[%_,()*\\:"]/g, ' ').replace(/\s+/g, ' ').trim();
  async function search(V, s){
    const c = ctx(V.A), o = parseQuery(s);
    if (!c || (!o.ops && !isThreadView(V))) return V.A.search ? V.A.search(s) : [];
    const S = sb(); if (!S) return [];
    let q = S.from(c.table).select('*').eq('deleted', false);
    if (c.kind === 'o') { if (!o.all) q = c.ch === 'general' ? q.is('channel', null) : q.eq('channel', c.ch); }
    else q = o.all ? q.eq('community_id', c.cid) : q.eq('channel_id', +c.ch);
    const w = san(o.words.join(' ')); if (w) q = q.ilike('text', `%${w}%`);
    if (o.from) { const f = san(o.from); if (f) q = q.ilike('nick', f); }
    if (o.has.has('file')) q = q.not('att', 'is', null);
    if (o.has.has('img')) q = q.like('att->>mime', 'image/%');
    if (o.has.has('vid')) q = q.like('att->>mime', 'video/%');
    if (o.has.has('link')) q = q.or('text.ilike.%http%,text.ilike.%vercel.app%,text.ilike.%#/%');
    if (o.has.has('poll')) q = q.ilike('text', '%[[poll:%');
    if (o.before) q = q.lt('created_at', o.before.toISOString());
    if (o.after) q = q.gte('created_at', o.after.toISOString());
    const { data, error } = await q.order('id', { ascending: false }).limit(40);
    if (error) return [];
    return (data || []).map(r => {
      const m = mapRow(c, r), ch = c.kind === 'o' ? (r.channel || 'general') : String(r.channel_id);
      m.dsmCh = ch; m.dsmFar = ch !== c.ch;
      return m;
    });
  }
  function resRow(m, V){
    if (!m.dsmFar && !m.thread) return null;
    const c = ctx(V.A);
    const where = m.dsmFar ? (c.kind === 'o' ? chanName(c, m.dsmCh) : '#другой канал') : '';
    return `<button type="button" class="mv-res" data-dsmgo="${e(m.id)}" data-dsmthr="${e(m.thread || '')}" data-dsmch="${e(m.dsmCh || '')}"><b>${e(m.nick)}</b><time>${e(when(m.at))}</time><span>${m.thread ? '🧵 в ветке · ' : ''}${where ? e(where) + ' · ' : ''}${e(clean(String(m.text || '').replace(/\s*\[\[poll:\d+\]\]/g, '')).slice(0, 160))}</span></button>`;
  }
  async function goResult(V, btn){
    const c = ctx(V.A), id = +btn.dataset.dsmgo, thr = +btn.dataset.dsmthr || 0, ch = btn.dataset.dsmch;
    if (ch && ch !== c.ch) {
      D.pend = { id: thr || id, t: Date.now(), thr: !!thr };
      V.closeOver();
      const h = chanHref(Object.assign({}, c, { ch }));
      if (window.D37Route?.go) window.D37Route.go(h); else location.hash = h;
      return;
    }
    await V.jump(thr || id);
    if (thr) { const root = V.msgs.get(thr); if (root) openThread(V, root); }
  }

  // ═══ 🗂 Каналы-форумы ═══
  const fkey = c => c.kind + ':' + c.ch;
  async function loadForums(c){
    const sk = c.kind === 'o' ? 'o' : 'c:' + c.cid;
    if (D.fl.has(sk) || !sb()) return;
    D.fl.add(sk);
    let q = sb().from('dsm_forums').select('kind, channel, tags').eq('kind', c.kind);
    if (c.kind === 'c') q = q.eq('community_id', c.cid);
    const { data, error } = await q.then(r => r, er => ({ error: er }));
    if (error) { D.fl.delete(sk); return; }
    (data || []).forEach(f => D.forums.set(f.kind + ':' + f.channel, Array.isArray(f.tags) ? f.tags : []));
  }
  async function loadPosts(c, ids){
    if (!sb()) return;
    let q = sb().from('dsm_posts').select('msg_id, title, tags').eq('kind', c.kind).eq('channel', c.ch);
    q = ids ? q.in('msg_id', ids) : q.order('msg_id', { ascending: false }).limit(300);
    const { data } = await q.then(r => r, () => ({}));
    (data || []).forEach(p => D.posts.set(c.kind + ':' + p.msg_id, { title: p.title, tags: p.tags || [] }));
  }
  function forumBar(V){
    const c = ctx(V.A), tags = c && !isThreadView(V) && D.forums.get(fkey(c));
    let bar = V.root.querySelector(':scope > .dsm-fbar');
    V.root.classList.toggle('dsm-forum', !!tags);
    if (!tags) { bar?.remove(); delete V.root.dataset.dsmtag; return; }
    if (!bar) { bar = document.createElement('div'); bar.className = 'dsm-fbar'; V.root.insertBefore(bar, V.list); }
    bar.innerHTML = `<b>🗂 Форум</b><span class="dsm-ftags"><button type="button" data-dsm="ftag" data-t="" class="on">Все</button>${tags.map((t, i) => `<button type="button" data-dsm="ftag" data-t="${i}">${e(t)}</button>`).join('')}</span>${V.canWrite ? '<button type="button" class="dsm-fnew" data-dsm="fnew">＋ Пост</button>' : ''}`;
    delete V.root.dataset.dsmtag;
  }
  function postForm(V){
    const c = ctx(V.A), tags = D.forums.get(fkey(c)) || [];
    const b = V.openOver('<b>🗂 Новый пост</b>', `<div class="dsm-form">
      <label>Заголовок<input data-f="t" maxlength="100" placeholder="О чём пост?"></label>
      ${tags.length ? `<div class="dsm-tagpick">${tags.map((t, i) => `<button type="button" data-dsm="tpick" data-t="${i}">${e(t)}</button>`).join('')}</div><small class="mv-dim">До 3 тегов</small>` : ''}
      <label>Текст<textarea data-f="b" rows="4" maxlength="${V.A.maxLen || 500}" placeholder="Подробнее… (можно **разметку**)"></textarea></label>
      <div class="dsm-err" hidden></div>
      <button type="button" class="mv-gbtn" data-dsm="fgo">Опубликовать</button></div>`);
    b.querySelector('[data-f="t"]').focus();
  }
  async function postCreate(V, box){
    const c = ctx(V.A), tags = D.forums.get(fkey(c)) || [], err = box.querySelector('.dsm-err');
    const say = t => { err.hidden = false; err.textContent = t; };
    const title = box.querySelector('[data-f="t"]').value.trim(), body = box.querySelector('[data-f="b"]').value.trim();
    const pick = [...box.querySelectorAll('[data-dsm="tpick"].on')].map(x => tags[+x.dataset.t]).filter(Boolean).slice(0, 3);
    if (!title) return say('Напиши заголовок');
    const go = box.querySelector('[data-dsm="fgo"]'); go.disabled = true;
    const s = await V.A.send(body ? `**${title.replace(/\*/g, '')}**\n${body}` : `**${title.replace(/\*/g, '')}**`, null);
    if (!s?.ok || !s.m || !numId(s.m.id)) { go.disabled = false; return say('Не отправилось: ' + (s?.err || 'ошибка')); }
    const r = await P.rpc('dsm_post_meta', { p_kind: c.kind, p_id: s.m.id, p_title: title, p_tags: pick });
    go.disabled = false;
    if (r.data?.ok) D.posts.set(c.kind + ':' + s.m.id, { title, tags: pick });
    V.closeOver();
    if (!V.msgs.has(s.m.id)) V.onEvent({ t: 'ins', m: s.m }); else V.rerender(s.m.id);
    if (!r.data?.ok) V.note?.('⚠️ Пост отправлен без заголовка: ' + ({ bad: 'плохие слова', link: 'ссылки нельзя', len: 'заголовок до 100 букв' }[r.data?.reason] || 'ошибка'), true, 4000);
    V.toBottom();
  }
  function forumSetForm(V){
    const c = ctx(V.A), tags = D.forums.get(fkey(c));
    V.openOver('<b>🗂 Канал-форум</b>', `<div class="dsm-form">
      <p class="mv-dim">В форуме каждое сообщение — пост с заголовком и тегами, обсуждение — в ветке поста.</p>
      <label class="dsm-chk"><input type="checkbox" data-f="on"${tags ? ' checked' : ''}> Этот канал — форум</label>
      <label>Теги через запятую (до 12)<input data-f="tags" maxlength="300" placeholder="вопрос, идея, баг, арт"></label>
      <div class="dsm-err" hidden></div>
      <button type="button" class="mv-gbtn" data-dsm="fsgo">Сохранить</button></div>`);
    const inp = V.root.querySelector('.mv-over [data-f="tags"]'); if (inp) inp.value = (tags || []).join(', ');
  }
  async function forumSet(V, box){
    const c = ctx(V.A), err = box.querySelector('.dsm-err');
    const on = box.querySelector('[data-f="on"]').checked, tags = box.querySelector('[data-f="tags"]').value.split(',').map(x => x.trim()).filter(Boolean);
    const r = await P.rpc('dsm_forum_set', { p_community: c.kind === 'c' ? c.cid : null, p_channel: c.ch, p_on: on, p_tags: tags });
    if (!r.data?.ok) { err.hidden = false; err.textContent = ({ rights: 'менять каналы может только тот, у кого есть право «каналы»', last: '#общий и 📢 новости форумом не делаются', tag: 'тег — до 20 букв, без ссылок и мата', tags: 'не больше 12 тегов', not_found: 'канал не найден' }[r.data?.reason]) || P.err(r.error) || 'не получилось'; return; }
    if (on) D.forums.set(fkey(c), tags); else D.forums.delete(fkey(c));
    V.closeOver(); forumBar(V); if (on) await loadPosts(c); V.refreshAll();
  }

  // ═══ ➕ Меню у поля ввода ═══
  function plusMenu(V){
    const c = ctx(V.A); if (!c) return;
    const forum = D.forums.get(fkey(c));
    V.openOver('<b>➕ Ещё</b>', `<div class="dsm-plus-list">
      ${D.ready ? '<button type="button" class="mv-res" data-dsm="poll"><b>📊 Опрос</b><span>Вопрос, варианты, срок — один голос на человека</span></button>' : ''}
      ${D.ready && forum ? '<button type="button" class="mv-res" data-dsm="fnew"><b>🗂 Новый пост</b><span>Заголовок, теги и обсуждение в ветке</span></button>' : ''}
      ${D.ready && canMod(V, c) ? `<button type="button" class="mv-res" data-dsm="fset"><b>⚙️ Канал-форум</b><span>${forum ? 'Теги или выключить форум' : 'Сделать этот канал форумом с постами и тегами'}</span></button>` : ''}
      <button type="button" class="mv-res" data-dsm="mdhelp"><b>✍️ Разметка</b><span>Жирный, курсив, код, спойлер, списки</span></button></div>`);
  }
  function mdHelp(V){
    V.openOver('<b>✍️ Разметка</b>', `<div class="dsm-mdh">${[['**жирный**'], ['*курсив*'], ['__подчёркнутый__'], ['~~зачёркнутый~~'], ['||спойлер||'], ['`код`'], ['```\nблок кода\n```'], ['> цитата'], ['- пункт списка'], ['1. пункт по номерам'], ['# Заголовок'], ['@ник · @here — кто в сети · @everyone — все (детям — нет)']].map(([t]) => `<div><code>${e(t)}</code><span class="mv-text">${MV.rich(t, '', {}).html}</span></div>`).join('')}</div>`);
  }
  function updatePlus(V){
    const b = V.root.querySelector('.dsm-plus'); if (!b) return;
    b.hidden = !(ctx(V.A) && !isThreadView(V) && V.canWrite);
  }

  // ═══ Крючки MsgView ═══
  MV.dsm = {
    md,
    searchHint: '🔍 Поиск… from:ник has:file before:01.11 in:server',
    pre(m, V){
      const c = ctx(V.A); if (!c || isThreadView(V) || !numId(m.id)) return '';
      const p = D.posts.get(c.kind + ':' + m.id); if (!p) return '';
      const tags = D.forums.get(fkey(c)) || [];
      const idx = (p.tags || []).map(t => tags.indexOf(t)).filter(i => i >= 0);
      return `<div class="dsm-post" data-tags="${idx.map(i => 't' + i).join(' ')}"><b class="dsm-ptitle">${e(clean(p.title))}</b>${(p.tags || []).map(t => `<i class="dsm-tag">${e(t)}</i>`).join('')}</div>`;
    },
    post(m, V){
      let out = '';
      const pm = D.ready && POLL_RE.exec(m.text || '');
      if (pm && ctx(V.A)) out += pollHtml(+pm[1]);
      if (!isThreadView(V) && m.tn > 0 && D.ready) out += `<button type="button" class="dsm-tc" data-dsm="thr">💬 ${m.tn} ${plural(m.tn, 'ответ', 'ответа', 'ответов')}${m.tat ? ` · ${e(when(m.tat))}` : ''}</button>`;
      else if (!isThreadView(V) && D.ready && D.forums.get(ctx(V.A) ? fkey(ctx(V.A)) : '') && D.posts.has(ctx(V.A).kind + ':' + m.id)) out += '<button type="button" class="dsm-tc" data-dsm="thr">💬 Обсудить</button>';
      return out;
    },
    skip(ev, V){
      if (isThreadView(V)) return false;
      const m = ev.m; if (!m) return false;
      const T = V.dsmT;
      if (m.thread) {
        if (ev.t !== 'load') {
          if (T && T.root.id === m.thread) T.fns.forEach(f => { try { f(ev); } catch (er) {} });
          if (ev.t === 'ins') { const r = V.msgs.get(m.thread); if (r) { r.tn = (r.tn || 0) + 1; r.tat = m.at; V.rerender(r.id); } }
        }
        return true;
      }
      if (ev.t === 'upd' && T && m.id === T.root.id) T.fns.forEach(f => { try { f(ev); } catch (er) {} });
      if (ev.t === 'ins' && numId(m.id)) {
        const c = ctx(V.A);
        if (c && D.forums.has(fkey(c))) setTimeout(() => loadPosts(c, [m.id]).then(() => { if (V.A && ctx(V.A)?.ch === c.ch) V.rerender(m.id); }), 2500);
      }
      return false;
    },
    menu(m, V){
      const c = ctx(V.A); if (!c || !numId(m.id) || m.sys) return [];
      const out = [];
      if (D.ready && !isThreadView(V) && !m.thread && (V.canWrite || m.tn > 0)) out.push(`<button type="button" data-m="dsm:thr">🧵 ${m.tn > 0 ? `Открыть ветку (${m.tn})` : 'Начать ветку'}</button>`);
      out.push('<button type="button" data-m="dsm:link">🔗 Скопировать ссылку</button>');
      if (D.ready && m.edited && (m.uid && m.uid === myUid(V) || canMod(V, c) || (V.A.modActions?.(m) || []).length)) out.push('<button type="button" data-m="dsm:hist">🕘 История правок</button>');
      return out;
    },
    async act(k, m, V){
      const c = ctx(V.A);
      if (k === 'thr') openThread(V, m);
      else if (k === 'hist') history(V, m);
      else if (k === 'link' && c) {
        const url = msgLink(c, m.thread || m.id);
        try { await navigator.clipboard.writeText(url); V.note?.('🔗 Ссылка скопирована', false, 1600); } catch (er) { V.note?.(url, false, 6000); }
      }
    },
    search,
    resRow,
    mount(V){
      D.views.add(V);
      const destroy = V.destroy;
      V.destroy = () => { closeThread(V); D.views.delete(V); destroy(); };
      if (isThreadView(V)) return;
      // ➕ у поля ввода, ⬆ к первому новому
      V.root.querySelector('.mv-row .mv-in')?.insertAdjacentHTML('beforebegin', '<button type="button" class="mv-cb dsm-plus" data-dsm="plus" title="Опрос, пост, разметка" aria-label="Ещё: опрос, пост, разметка" hidden>➕</button>');
      V.list.insertAdjacentHTML('beforebegin', '<button type="button" class="dsm-unr" data-dsm="unr" hidden>⬆ К первому новому</button>');
      const unr = V.root.querySelector('.dsm-unr');
      V.list.addEventListener('scroll', () => { const d = V.list.querySelector('.mv-new'); unr.hidden = !(d && d.offsetTop + d.offsetHeight < V.list.scrollTop + 4); }, { passive: true });
      // клики — до обработчиков ленты (иначе на телефоне спойлер откроет меню сообщения)
      V.root.addEventListener('click', ev => {
        const t = ev.target;
        const sp = t.closest('.dsm-sp');
        if (sp && V.root.contains(sp)) { if (!sp.classList.contains('on')) { sp.classList.add('on'); ev.stopPropagation(); ev.preventDefault(); } return; }
        const ed = t.closest('.mv-ed');
        if (ed && D.ready) { const tv = ed.closest('.dsm-thv') && V.dsmT ? V.dsmT.child : V, el = ed.closest('.mv-m'), m = el && tv.msgs.get(+el.dataset.id); if (m) { ev.stopPropagation(); history(tv, m); } return; }
        const go = t.closest('[data-dsmgo]'); if (go) { ev.stopPropagation(); goResult(V, go); return; }
        const b = t.closest('[data-dsm]'); if (!b || !V.root.contains(b)) return;
        ev.stopPropagation();
        const k = b.dataset.dsm, form = b.closest('.mv-obody');
        const tv = b.closest('.dsm-thv') && V.dsmT ? V.dsmT.child : V;
        const el = b.closest('.mv-m'), m = el ? tv.msgs.get(+el.dataset.id) : null;
        if (k === 'thr' && m) openThread(V, m);
        else if (k === 'thrclose') closeThread(V);
        else if (k === 'follow') toggleFollow(V);
        else if (k === 'plus') plusMenu(V);
        else if (k === 'poll') pollForm(V);
        else if (k === 'padd' && form) { const box = form.querySelector('.dsm-opts'); if (box.children.length < 10) { box.insertAdjacentHTML('beforeend', `<input data-f="o" maxlength="80" placeholder="Вариант ${box.children.length + 1}">`); box.lastElementChild.focus(); } }
        else if (k === 'pgo' && form) pollCreate(V, form);
        else if (k === 'pv') pollVote(tv, +b.closest('[data-dsmpoll]').dataset.dsmpoll, +b.dataset.opt);
        else if (k === 'pend') pollEnd(tv, +b.closest('[data-dsmpoll]').dataset.dsmpoll);
        else if (k === 'prf') { const id = +b.closest('[data-dsmpoll]').dataset.dsmpoll; D.polls.delete(id); pollPaint(id); }
        else if (k === 'fnew') postForm(V);
        else if (k === 'tpick') { if (b.classList.contains('on') || form.querySelectorAll('[data-dsm="tpick"].on').length < 3) b.classList.toggle('on'); }
        else if (k === 'fgo' && form) postCreate(V, form);
        else if (k === 'fset') forumSetForm(V);
        else if (k === 'fsgo' && form) forumSet(V, form);
        else if (k === 'mdhelp') mdHelp(V);
        else if (k === 'ftag') { b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); if (b.dataset.t === '') delete V.root.dataset.dsmtag; else V.root.dataset.dsmtag = b.dataset.t; }
        else if (k === 'unr') { V.list.querySelector('.mv-new')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      }, true);
      V.root.addEventListener('keydown', ev => {
        const sp = ev.target.closest?.('.dsm-sp');
        if (sp && (ev.key === 'Enter' || ev.key === ' ')) { sp.classList.add('on'); ev.preventDefault(); }
        if (ev.key === 'Enter' && !ev.shiftKey && ev.target.matches?.('.mv-over [data-f]:not(textarea)')) {
          const f = ev.target.closest('.mv-obody'); const go = f?.querySelector('[data-dsm="pgo"],[data-dsm="fgo"],[data-dsm="fsgo"]'); if (go) { ev.preventDefault(); go.click(); }
        }
      });
    },
    async loaded(V){
      if (isThreadView(V)) return;
      if (V.dsmT && V.dsmT.akey !== V.A?.key) closeThread(V);
      updatePlus(V);
      const c = ctx(V.A);
      // @here / @everyone / @роль — в подсказке (детям нет: сервер им такое не разошлёт)
      const A = V.A;
      if (c && A.members && !A.dsmMembers) {
        const orig = A.members;
        A.dsmMembers = true;
        A.members = async q => {
          const list = await orig.call(A, q);
          if (isKid()) return list;
          const s = String(q || '').toLowerCase(), extra = ['here', 'everyone'].filter(x => x.startsWith(s)).map(x => ({ id: '', nick: x }));
          const R = c.kind === 'c' ? window.D37DS?.x?.roleSync?.(c.cid) : null;
          if (R?.byId) for (const r of R.byId.values()) if (r?.name && String(r.name).toLowerCase().startsWith(s) && /^[\p{L}0-9_.-]{2,24}$/u.test(r.name)) extra.push({ id: '', nick: r.name });
          return [...extra, ...(list || [])];
        };
      }
      // переход по ссылке ?m=<номер>
      if (D.pend && Date.now() - D.pend.t < 60e3 && c) {
        const p = D.pend; D.pend = null;
        setTimeout(async () => { if (V.A !== A) return; await V.jump(p.id); if (p.thr) { const r = V.msgs.get(p.id); if (r) openThread(V, r); } }, 60);
      }
      if (!c || !D.ready) { forumBar(V); return; }
      await loadForums(c);
      if (V.A !== A) return;
      forumBar(V);
      if (D.forums.has(fkey(c))) { await loadPosts(c); if (V.A === A) V.refreshAll(); }
    },
  };

  // часть 12 на сервере? (нет — ветки, опросы, форумы, история не показываются)
  const check = () => {
    if (!P?.rpc) return;
    P.rpc('dsm_info').then(r => {
      const was = D.ready;
      D.ready = !!r.data?.ok;
      if (D.ready && !was) D.views.forEach(V => { if (!V.destroyed && V.A) { updatePlus(V); V.refreshAll(); MV.dsm.loaded(V); } });
    });
  };
  check();
  D._test = { md, inline, fix, parseQuery, ctx, msgLink, threadAdapter, pollHtml, openThread, closeThread };
})();
