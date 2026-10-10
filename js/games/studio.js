// ═══════════════════════════════════════
//  СТУДИЯ ИГР 🛠️ (#/games/studio) — игроки делают свои игры, сайт показывает их всем и сам ставит рекламу вокруг
// ═══════════════════════════════════════
// Маршруты: studio (главная: шаблоны, мои игры, игры игроков), studio/new/<шаблон|code>, studio/edit/<id>,
// studio/play/<id>, studio/mod (модерация — персонал). Игра запускается в песочнице: iframe sandbox="allow-scripts"
// со srcdoc = studio/frame.html (CSP без сети, форм и переходов) → внутри ещё одна песочница с самой игрой.
// Сайт ↔ игра — только postMessage: ready, score, over, again, error, log, save (своя «localStorage» игры).
// Шаблоны — js/games/studio-tpl.js (код без участия игрока), «свой код» — HTML игры (можно попросить ИИ).
// Сервер — ugc.sql: ugc_games (черновик / по ссылке / на проверке / в каталоге / скрыта / заблокирована), ugc_save,
// ugc_status, ugc_review (персонал), ugc_play (просмотры, монеты автору), ugc_like, ugc_report. Пока ugc.sql не выполнен —
// игры хранятся только в браузере (черновики d37_studio_drafts). Реклама — только вокруг игр «в каталоге» (прошли модерацию).
(() => {
  const TPL = () => window.STUDIO_TPL;
  const LS = 'd37_studio_drafts', LS_BEST = 'd37_ugc_best', MAX_HTML = 200000;
  const STATUS = { draft: ['📝', 'Черновик'], link: ['🔗', 'По ссылке'], review: ['⏳', 'На проверке'], public: ['🌍', 'В каталоге'], hidden: ['🙈', 'Скрыта'], banned: ['⛔', 'Заблокирована'] };
  const AI_LINKS = [['DeepSeek', 'https://chat.deepseek.com/'], ['GigaChat', 'https://giga.chat/'], ['Алиса', 'https://alice.yandex.ru/'], ['ChatGPT', 'https://chatgpt.com/']];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('ru');
  const authed = () => typeof currentUser !== 'undefined' && !!currentUser;
  const isStaff = () => { try { return typeof currentProfile !== 'undefined' && ['admin', 'moderator'].includes(currentProfile?.role); } catch (e) { return false; } };
  const SITE = 'https://dan4ik37.vercel.app';
  let root = null, api = null, S = null;   // S — состояние текущего экрана

  // ── Черновики в браузере ──
  function drafts(){ try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } }
  function putDraft(d){ const all = drafts(); all[d.id] = { ...d, updated: Date.now() }; try { localStorage.setItem(LS, JSON.stringify(all)); } catch (e) { api?.toast('Не хватает места в браузере — удали старые черновики'); } }
  function dropDraft(id){ const all = drafts(); delete all[id]; try { localStorage.setItem(LS, JSON.stringify(all)); } catch (e) {} }
  const bestOf = id => { try { return (JSON.parse(localStorage.getItem(LS_BEST) || '{}') || {})[id] || 0; } catch (e) { return 0; } };
  function saveBest(id, v){ try { const b = JSON.parse(localStorage.getItem(LS_BEST) || '{}') || {}; if (v > (b[id] || 0)) { b[id] = v; localStorage.setItem(LS_BEST, JSON.stringify(b)); return true; } } catch (e) {} return false; }
  const storeKey = id => 'd37_ugc_store_' + id;

  // ── Сервер (ugc.sql) ──
  let srvMissing = false;
  async function rpc(name, args){
    if (typeof sbClient === 'undefined' || !sbClient || srvMissing) return null;
    try {
      const { data, error } = await sbClient.rpc(name, args || {});
      if (error) { if (error.code === 'PGRST202' || /Could not find the function|does not exist/i.test(error.message || '')) srvMissing = true; return { ok: false, reason: 'error', message: error.message }; }
      return data;
    } catch (e) { return null; }
  }
  async function select(q){
    if (typeof sbClient === 'undefined' || !sbClient || srvMissing) return null;
    try {
      const { data, error } = await q(sbClient.from('ugc_games'));
      if (error) { if (error.code === '42P01' || /does not exist|Could not find/i.test(error.message || '')) srvMissing = true; return null; }
      return data;
    } catch (e) { return null; }
  }
  const LIGHT = 'id,title,icon,descr,kind,tpl,status,plays,likes,created_at,updated_at,author,profiles(nick)';
  const playHref = g => g.kind === 'place' ? `#/games/studio3d/play/${esc(g.id)}` : `#/games/studio/play/${esc(g.id)}`;

  // ── Песочница ──
  let hostHtml = null;
  async function hostPage(){
    if (!hostHtml) { const r = await fetch('/studio/frame.html?v=' + (typeof GAMES_VER !== 'undefined' ? GAMES_VER : '1')); hostHtml = await r.text(); }
    return hostHtml;
  }
  function sandbox(box, on){
    const f = document.createElement('iframe');
    f.className = 'st-frame';
    f.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
    f.setAttribute('allow', 'autoplay; gamepad');
    f.title = 'Игра';
    let ready = false, queued = null, run = 0, dead = false;
    const send = m => { try { f.contentWindow.postMessage(m, '*'); } catch (e) {} };
    const onMsg = e => {
      if (dead || e.source !== f.contentWindow) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'host') { ready = true; if (queued) { send(queued); queued = null; } return; }
      if (d.type === 'game' && d.run === run) on(d);
    };
    window.addEventListener('message', onMsg);
    hostPage().then(h => { if (!dead) f.srcdoc = h; }).catch(() => { box.innerHTML = '<div class="st-empty">Не загрузилось — проверь интернет</div>'; });
    box.appendChild(f);
    return {
      el: f,
      run(game, store){ run++; const m = { type: 'run', run, store: store || '{}', ...game }; if (ready) send(m); else queued = m; },
      stop(){ if (ready) send({ type: 'stop' }); },
      focus(){ try { f.focus(); } catch (e) {} },
      destroy(){ dead = true; window.removeEventListener('message', onMsg); f.remove(); },
    };
  }
  // Что отправить в песочницу: шаблон — код шаблона + проверенные параметры, свой код — HTML
  function payload(g){
    if (g.kind === 'tpl') {
      const t = TPL().get(g.tpl);
      if (!t) return null;
      return { kind: 'tpl', code: t.code.toString(), params: TPL().clean(t, g.data || g.params) };
    }
    return { kind: 'html', html: String(g.html || '').slice(0, MAX_HTML) };
  }

  // ═══ Экраны ═══
  function show(param){
    stopScreen();
    const [a, b] = String(param || '').split('/');
    if (a === 'new' && b) editor({ isNew: true, kind: b === 'code' ? 'html' : 'tpl', tpl: b === 'code' ? null : b });
    else if (a === 'edit' && b) editor({ id: b });
    else if (a === 'play' && b) play(b);
    else if (a === 'mod') moderation();
    else home();
  }
  function stopScreen(){
    if (!S) return;
    S.sb?.destroy();
    clearTimeout(S.saveT); clearTimeout(S.runT);
    S = null;
  }
  const go = p => { location.hash = '#/games/studio' + (p ? '/' + p : ''); };

  // ── Главная студии ──
  async function home(){
    S = { screen: 'home' };
    const st = S;
    const tpls = TPL().list;
    root.innerHTML = `<div class="st">
      <div class="st-hero"><div><h2>🛠️ Студия игр</h2><p>Сделай свою игру за пару минут: выбери шаблон, поставь своего героя, цвета и правила — и позови друзей играть по ссылке.
        Хочешь что-то своё — опиши идею, ИИ напишет код, а сайт его запустит.</p></div></div>
      <h3 class="st-h">✨ Из шаблона — без кода</h3>
      <div class="st-tpls">${tpls.map(t => `<a class="st-tpl" href="#/games/studio/new/${t.id}"><span class="st-tpl-ic">${t.icon}</span><b>${esc(t.name)}</b><small>${esc(t.desc)}</small><span class="st-go">Сделать →</span></a>`).join('')}
        <a class="st-tpl st-tpl-code" href="#/games/studio/new/code"><span class="st-tpl-ic">💻</span><b>Свой код + ИИ</b><small>Опиши игру — DeepSeek, GigaChat или ChatGPT напишут код. Вставь его сюда — и играй.</small><span class="st-go">Открыть →</span></a>
      </div>
      <h3 class="st-h">📁 Мои игры</h3>
      <div class="st-mine"><div class="st-empty">Загружаем…</div></div>
      <h3 class="st-h">🌍 Игры игроков <span class="st-sort"><button type="button" data-sort="plays" class="on">Популярные</button><button type="button" data-sort="new">Новые</button></span></h3>
      <div class="st-cat"><div class="st-empty">Загружаем…</div></div>
      <div class="st-mod-link" hidden></div>
      <div class="st-rules"><b>Правила:</b> никаких оскорблений, взрослого контента, азартных игр и чужих паролей. В каталог игры попадают после проверки модератором, до этого — только по ссылке.
        За популярные игры автор получает монеты 🪙.</div>
    </div>`;
    root.querySelector('.st-sort').addEventListener('click', e => { const b = e.target.closest('[data-sort]'); if (!b) return; root.querySelectorAll('.st-sort button').forEach(x => x.classList.toggle('on', x === b)); catalog(b.dataset.sort); });
    mine(st);
    catalog('plays');
    if (isStaff()) {
      const box = root?.querySelector('.st-mod-link');
      if (box && S === st) { box.hidden = false; box.innerHTML = `<a class="st-btn" href="#/games/studio/mod">🛡️ Модерация игр</a>`; }
    }
  }
  async function mine(st){
    const box = root?.querySelector('.st-mine');
    if (!box) return;
    const local = Object.values(drafts());
    let srv = [];
    if (authed()) srv = await select(q => q.select(LIGHT).eq('author', currentUser.id).order('updated_at', { ascending: false }).limit(60)) || [];
    if (S !== st) return;
    const ids = new Set(srv.map(g => g.id));
    const list = [...srv.map(g => ({ ...g, srv: true })), ...local.filter(d => !ids.has(d.id)).map(d => ({ ...d, status: 'draft', local: true }))]
      .sort((a, b) => (new Date(b.updated_at || b.updated || 0)) - (new Date(a.updated_at || a.updated || 0)));
    if (!list.length) { box.innerHTML = '<div class="st-empty">Пока пусто — выбери шаблон выше и сделай первую игру 🙂</div>'; return; }
    box.innerHTML = `<div class="st-list">${list.map(g => {
      const [si, sn] = STATUS[g.status] || STATUS.draft;
      return `<div class="st-row"><span class="st-row-ic">${esc(g.icon || '🎮')}</span>
        <div class="st-row-b"><b>${esc(g.title || 'Без названия')}</b><small><span class="st-chip st-${esc(g.status)}">${si} ${sn}</span>${g.srv ? ` · 👁 ${num(g.plays)} · ❤️ ${num(g.likes)}` : g.local ? ' · только в этом браузере' : ''}</small></div>
        <span class="st-row-a"><a class="st-btn" href="${playHref(g)}">▶</a><a class="st-btn ghost" href="${g.kind === 'place' ? '#/games/studio3d' : `#/games/studio/edit/${esc(g.id)}`}">✏️</a></span></div>`;
    }).join('')}</div>`;
  }
  async function catalog(sort){
    const box = root?.querySelector('.st-cat');
    if (!box) return;
    const st = S;
    const rows = await select(q => q.select(LIGHT).eq('status', 'public').order(sort === 'new' ? 'created_at' : 'plays', { ascending: false }).limit(30));
    if (S !== st || !root) return;
    if (!rows) { box.innerHTML = `<div class="st-empty">${srvMissing ? 'Каталог откроется совсем скоро — сайт обновляется.' : 'Не получилось загрузить — обнови страницу.'}</div>`; return; }
    if (!rows.length) { box.innerHTML = '<div class="st-empty">Здесь будут лучшие игры игроков. Сделай свою — может, она будет первой!</div>'; return; }
    box.innerHTML = `<div class="st-grid">${rows.map(cardHtml).join('')}</div>`;
    if (typeof xpQueueBadges === 'function') xpQueueBadges();
  }
  const plural = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? b : c;
  const cardHtml = g => `<a class="st-card" href="${playHref(g)}"><span class="st-card-ic">${esc(g.icon || '🎮')}</span><b>${esc(g.title)}</b>${g.kind === 'place' ? '<small class="st-card-3d">🧱 3D-мир</small>' : ''}
    <small class="st-card-au">👤 ${esc(g.profiles?.nick || 'Игрок')}${g.author ? `<span class="lv-badge" data-lv-uid="${esc(g.author)}"></span>` : ''}</small>
    <small>👁 ${num(g.plays)} · ❤️ ${num(g.likes)}</small></a>`;

  // ── Редактор ──
  async function editor(o){
    S = { screen: 'edit', game: null, sb: null, dirty: false, lastErr: '' };
    const st = S;
    let g;
    if (o.isNew) {
      const t = o.kind === 'tpl' ? TPL().get(o.tpl) : null;
      if (o.kind === 'tpl' && !t) { go(''); return; }
      g = { id: 'd' + Date.now().toString(36), kind: o.kind, tpl: t?.id || null, data: t ? TPL().defaults(t) : {}, html: o.kind === 'html' ? STARTER : '',
        title: t ? t.name + ' от ' + myNick() : 'Моя игра', icon: t?.icon || '🎮', descr: '', status: 'draft', local: true };
    } else {
      g = drafts()[o.id] ? { ...drafts()[o.id], local: true } : null;
      if (!g || authed()) {
        const row = await select(q => q.select('id,title,icon,descr,kind,tpl,data,html,status,plays,likes,author').eq('id', o.id).maybeSingle());
        if (S !== st) return;
        if (row) { if (authed() && row.author !== currentUser.id && !isStaff()) { go('play/' + o.id); return; } g = { ...row, srv: true }; }
      }
      if (!g) { root.innerHTML = '<div class="st-empty">Игра не найдена. <a href="#/games/studio">В студию</a></div>'; return; }
    }
    st.game = g;
    const t = g.kind === 'tpl' ? TPL().get(g.tpl) : null;
    root.innerHTML = `<div class="st st-ed">
      <div class="st-top"><a class="st-back" href="#/games/studio">← Студия</a><b>${t ? t.icon + ' ' + esc(t.name) : '💻 Свой код'}</b><span class="st-saved"></span></div>
      <div class="st-ed-grid">
        <div class="st-prev">
          <div class="st-frame-box"></div>
          <div class="st-prev-bar"><button type="button" class="st-btn" data-act="run">▶ Заново</button><span class="st-score"></span></div>
          <div class="st-err" hidden></div>
        </div>
        <div class="st-form">
          <label class="st-f"><span>Название игры</span><input data-f="title" maxlength="60" value="${esc(g.title)}"></label>
          <div class="st-f2">
            <label class="st-f"><span>Значок</span><input data-f="icon" maxlength="12" value="${esc(g.icon)}" class="st-emoji-in"></label>
            <label class="st-f st-grow"><span>Описание (для друзей и каталога)</span><input data-f="descr" maxlength="300" value="${esc(g.descr || '')}" placeholder="Во что играть и как"></label>
          </div>
          <div class="st-params">${t ? paramsHtml(t, g.data) : codeHtml(g)}</div>
          <div class="st-actions">
            <button type="button" class="st-btn gold" data-act="save">💾 Сохранить</button>
            <button type="button" class="st-btn" data-act="publish">🔗 Ссылка для друзей</button>
            <button type="button" class="st-btn" data-act="review">🌍 В каталог</button>
            <button type="button" class="st-btn ghost danger" data-act="delete">🗑</button>
          </div>
          <div class="st-status"></div>
        </div>
      </div>
    </div>`;
    st.sb = sandbox(root.querySelector('.st-frame-box'), d => onGame(st, d));
    const form = root.querySelector('.st-form');
    form.addEventListener('input', e => onEdit(st, e));
    form.addEventListener('change', e => onEdit(st, e, true));
    form.addEventListener('click', e => onEditClick(st, e));
    root.querySelector('.st-prev-bar').addEventListener('click', e => { if (e.target.closest('[data-act="run"]')) runPreview(st); });
    statusLine(st);
    runPreview(st);
  }
  const myNick = () => { try { return (typeof currentProfile !== 'undefined' && currentProfile?.nick) || 'игрока'; } catch (e) { return 'игрока'; } };
  // Форма параметров шаблона
  const POP = ['😀', '😎', '🤖', '👻', '🐱', '🐶', '🦊', '🐸', '🐤', '🦖', '🐉', '🚀', '🛸', '👾', '⚽', '🍕', '🍎', '🍩', '💎', '⭐', '🪙', '🔥', '💣', '🌵', '🪨', '🧱', '🎁', '❤️', '🏃', '🦸', '🧟', '🎃'];
  function paramsHtml(t, data){
    const P = TPL().clean(t, data);
    return t.params.map(p => {
      const v = P[p.k];
      if (p.t === 'text') return `<label class="st-f"><span>${esc(p.label)}</span><input data-p="${p.k}" maxlength="${p.max || 40}" value="${esc(v)}"></label>`;
      if (p.t === 'emoji') return `<div class="st-f"><span>${esc(p.label)}</span><div class="st-emo-row"><input data-p="${p.k}" class="st-emoji-in" maxlength="12" value="${esc(v)}">${POP.slice(0, 16).map(e => `<button type="button" class="st-emo" data-emo="${p.k}" data-v="${e}">${e}</button>`).join('')}</div></div>`;
      if (p.t === 'emojis') return `<div class="st-f"><span>${esc(p.label)} <i>(до ${p.max || 6}, через пробел)</i></span><div class="st-emo-row"><input data-p="${p.k}" data-list="1" class="st-emojis-in" value="${esc(v.join(' '))}">${POP.slice(16).map(e => `<button type="button" class="st-emo" data-add="${p.k}" data-v="${e}">${e}</button>`).join('')}</div></div>`;
      if (p.t === 'color') return `<label class="st-f st-color"><span>${esc(p.label)}</span><input type="color" data-p="${p.k}" value="${esc(v)}"></label>`;
      if (p.t === 'range') return `<label class="st-f"><span>${esc(p.label)}: <b data-rv="${p.k}">${v}</b></span><input type="range" data-p="${p.k}" min="${p.min ?? 1}" max="${p.max ?? 10}" step="${p.step || 1}" value="${v}"></label>`;
      if (p.t === 'bool') return `<label class="st-f st-check"><input type="checkbox" data-p="${p.k}"${v ? ' checked' : ''}><span>${esc(p.label)}</span></label>`;
      if (p.t === 'qa') return `<div class="st-f"><span>${esc(p.label)} <i>(до 30; отметь правильный ответ)</i></span><div class="st-qa" data-qa="${p.k}">${v.map((q, i) => qaHtml(q, i)).join('')}</div>
        <button type="button" class="st-btn ghost" data-act="qa-add">＋ Вопрос</button></div>`;
      return '';
    }).join('');
  }
  const qaHtml = (q, i) => `<div class="st-q" data-i="${i}"><div class="st-q-h"><b>${i + 1}.</b><input class="st-q-text" maxlength="140" value="${esc(q.q)}" placeholder="Вопрос"><button type="button" class="st-x" data-act="qa-del" title="Удалить вопрос">✕</button></div>
    ${[0, 1, 2, 3].map(k => `<label class="st-q-a"><input type="radio" name="qa${i}" value="${k}"${q.right === k ? ' checked' : ''}><input class="st-q-ans" data-k="${k}" maxlength="60" value="${esc(q.a[k] || '')}" placeholder="${k < 2 ? 'Ответ' : 'Ответ (можно пусто)'}"></label>`).join('')}</div>`;
  function readQa(box){
    return [...box.querySelectorAll('.st-q')].map(el => {
      const a = [...el.querySelectorAll('.st-q-ans')].map(x => x.value.trim());
      const r = +(el.querySelector('input[type=radio]:checked')?.value || 0);
      const kept = a.map((t, k) => ({ t, k })).filter(x => x.t);
      return { q: el.querySelector('.st-q-text').value.trim(), a: kept.map(x => x.t), right: Math.max(0, kept.findIndex(x => x.k === r)) };
    });
  }
  // Свой код: поле + задание для ИИ
  function codeHtml(g){
    return `<div class="st-ai">
        <b>🤖 Пусть игру напишет ИИ</b>
        <textarea class="st-idea" rows="3" maxlength="600" placeholder="Например: «Змейка, которая ест пиццу, на телефоне управление свайпами» или «Тетрис с котиками»"></textarea>
        <div class="st-ai-row"><button type="button" class="st-btn gold" data-act="ai-copy">📋 Скопировать задание для ИИ</button>
          ${AI_LINKS.map(([n, u]) => `<a class="st-btn ghost" href="${u}" target="_blank" rel="noopener noreferrer">${n} ↗</a>`).join('')}</div>
        <small>1) Опиши игру и скопируй задание. 2) Вставь его в чат ИИ. 3) Скопируй ответ (весь код) и вставь ниже. 4) Нажми «▶ Запустить».</small>
      </div>
      <label class="st-f"><span>Код игры (HTML) <i class="st-size"></i></span><textarea class="st-code" data-f="html" spellcheck="false" wrap="off">${esc(g.html || '')}</textarea></label>
      <div class="st-ai-row"><button type="button" class="st-btn" data-act="run">▶ Запустить</button><button type="button" class="st-btn ghost" data-act="paste">📥 Вставить из буфера</button></div>`;
  }
  function aiPrompt(idea){
    return `Сделай браузерную игру одним HTML-файлом. Идея игры: ${idea || 'придумай сам весёлую аркаду'}.

Обязательные правила:
1. Всё в одном файле: HTML, <style> и <script>. Без внешних картинок, звуков, шрифтов и запросов в интернет (fetch, XMLHttpRequest, WebSocket не работают). Графику рисуй на <canvas> — фигурами и эмодзи (ctx.fillText) — или HTML-элементами.
2. Игра должна работать и на телефоне (касания, кнопки на экране), и на компьютере (клавиатура и мышь). Холст — на всё окно и подстраивается при изменении размера окна.
3. В странице уже есть объект D37: вызывай D37.score(очки), когда меняется счёт, и D37.over(очки), когда игра закончилась. Звуки без файлов: D37.sfx('jump'), D37.sfx('coin'), D37.sfx('hit'), D37.sfx('shoot'), D37.sfx('boom'), D37.sfx('good'), D37.sfx('bad'), D37.sfx('win'), D37.sfx('over').
4. После конца игры — кнопка или нажатие «Ещё раз» (начать заново без перезагрузки страницы, и тогда вызови D37.again()).
5. Нельзя: alert, prompt, confirm, формы, ссылки, открытие окон, просьбы ввести пароль или личные данные.
6. Все тексты в игре — на русском. Сначала экран «Нажми, чтобы начать», в углу — счёт и рекорд (рекорд можно хранить в localStorage).
7. Можно подключить одну библиотеку: <script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script> (Phaser 3), но лучше без неё.

Ответь только полным кодом файла, без пояснений.`;
  }
  const STARTER = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#16122e;overflow:hidden;touch-action:none}canvas{display:block}</style></head>
<body><canvas id="c"></canvas>
<script>
// Пример: жми на звезду, пока не кончилось время. Замени этот код своим — или кодом от ИИ.
const c = document.getElementById('c'), x = c.getContext('2d');
let W, H, star, score = 0, time = 20, state = 'start';
function fit(){ W = c.width = innerWidth; H = c.height = innerHeight; }
addEventListener('resize', fit); fit();
function move(){ star = { x: 60 + Math.random() * (W - 120), y: 100 + Math.random() * (H - 160), r: 40 }; }
move();
c.addEventListener('pointerdown', e => {
  if (state !== 'play') { state = 'play'; score = 0; time = 20; move(); D37.again(); return; }
  if (Math.hypot(e.clientX - star.x, e.clientY - star.y) < star.r + 10) { score++; D37.score(score); D37.sfx('coin'); move(); }
});
let last = performance.now();
(function frame(now){
  const dt = (now - last) / 1000; last = now;
  if (state === 'play') { time -= dt; if (time <= 0) { state = 'over'; D37.sfx('over'); D37.over(score); } }
  x.fillStyle = '#16122e'; x.fillRect(0, 0, W, H);
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
  if (state === 'play') { x.font = (star.r * 2) + 'px serif'; x.fillText('⭐', star.x, star.y); x.font = 'bold 28px sans-serif'; x.fillText('Счёт: ' + score + '   ⏱ ' + Math.ceil(time), W / 2, 36); }
  else { x.font = 'bold 34px sans-serif'; x.fillText(state === 'start' ? 'Лови звезду!' : 'Счёт: ' + score, W / 2, H / 2 - 20); x.font = '20px sans-serif'; x.fillText('Нажми, чтобы начать', W / 2, H / 2 + 26); }
  requestAnimationFrame(frame);
})(last);
<\/script>
</body></html>`;

  function onEdit(st, e, final){
    if (st !== S) return;
    const g = st.game, el = e.target;
    if (el.dataset.f) {
      g[el.dataset.f] = el.value;
      if (el.dataset.f === 'html') sizeLabel(st);
    } else if (el.dataset.p) {
      const k = el.dataset.p;
      if (el.type === 'checkbox') g.data[k] = el.checked;
      else if (el.type === 'range') { g.data[k] = +el.value; const b = root.querySelector(`[data-rv="${k}"]`); if (b) b.textContent = el.value; }
      else if (el.dataset.list) g.data[k] = el.value.split(/[\s,]+/).filter(Boolean);
      else g.data[k] = el.value;
    } else if (el.closest('.st-qa')) {
      const box = el.closest('.st-qa');
      g.data[box.dataset.qa] = readQa(box);
    } else return;
    st.dirty = true;
    markSaved(st, false);
    if (g.kind === 'tpl') { clearTimeout(st.runT); st.runT = setTimeout(() => runPreview(st), final ? 50 : 450); }
    clearTimeout(st.saveT); st.saveT = setTimeout(() => saveLocal(st), 800);
  }
  async function onEditClick(st, e){
    const b = e.target.closest('button');
    if (!b || st !== S) return;
    const g = st.game;
    if (b.dataset.emo) { const inp = root.querySelector(`input[data-p="${b.dataset.emo}"]`); inp.value = b.dataset.v; inp.dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (b.dataset.add) { const inp = root.querySelector(`input[data-p="${b.dataset.add}"]`); inp.value = (inp.value.trim() + ' ' + b.dataset.v).trim(); inp.dispatchEvent(new Event('change', { bubbles: true })); return; }
    const act = b.dataset.act;
    if (act === 'qa-add' || act === 'qa-del') {
      const box = b.closest('.st-f').querySelector('.st-qa') || b.closest('.st-qa');
      let list = readQa(box);
      if (act === 'qa-add') { if (list.length >= 30) return api.toast('Не больше 30 вопросов'); list.push({ q: '', a: ['', ''], right: 0 }); }
      else list.splice(+b.closest('.st-q').dataset.i, 1);
      box.innerHTML = list.map((q, i) => qaHtml({ ...q, a: q.a.length ? q.a : ['', ''] }, i)).join('');
      g.data[box.dataset.qa] = list;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (act === 'run') { runPreview(st); return; }
    if (act === 'paste') {
      try { const t = await navigator.clipboard.readText(); if (t) { const ta = root.querySelector('.st-code'); ta.value = extractHtml(t); ta.dispatchEvent(new Event('input', { bubbles: true })); runPreview(st); } }
      catch (er) { api.toast('Не получилось прочитать буфер — вставь вручную (Ctrl+V)'); }
      return;
    }
    if (act === 'ai-copy') {
      const idea = root.querySelector('.st-idea')?.value.trim();
      try { await navigator.clipboard.writeText(aiPrompt(idea)); api.toast('📋 Задание скопировано — вставь его в чат ИИ'); }
      catch (er) { prompt('Скопируй задание:', aiPrompt(idea)); }
      return;
    }
    if (act === 'save') { await saveServer(st, null); return; }
    if (act === 'publish') { await saveServer(st, 'link'); return; }
    if (act === 'review') { await saveServer(st, 'review'); return; }
    if (act === 'copy-link') { copyLink(g.id); return; }
    if (act === 'delete') {
      if (!confirm('Удалить игру «' + (g.title || '') + '»? Её нельзя будет вернуть.')) return;
      if (g.srv) { const r = await rpc('ugc_status', { p_id: g.id, p_status: 'deleted' }); if (!r?.ok) { api.toast('Не получилось удалить'); return; } }
      dropDraft(g.id);
      api.toast('🗑 Игра удалена');
      go('');
    }
  }
  // ИИ часто отвечает текстом и блоком ```html ... ``` — достаём только код
  function extractHtml(t){
    const m = /```(?:html)?\s*([\s\S]*?)```/i.exec(t);
    const s = (m ? m[1] : t).trim();
    const i = s.search(/<!doctype|<html/i);
    return i > 0 ? s.slice(i) : s;
  }
  function sizeLabel(st){
    const el = root?.querySelector('.st-size');
    if (!el) return;
    const n = (st.game.html || '').length;
    el.textContent = `${Math.round(n / 1024)} из ${MAX_HTML / 1000} КБ`;
    el.classList.toggle('bad', n > MAX_HTML);
  }
  function runPreview(st){
    if (st !== S || !st.sb) return;
    const p = payload(st.game);
    if (!p) return;
    errBox(st, '');
    st.sb.run(p, '{}');
    if (st.game.kind === 'html') sizeLabel(st);
  }
  function errBox(st, msg){
    const el = root?.querySelector('.st-err');
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg ? '⚠️ ' + msg : '';
  }
  function onGame(st, d){
    if (st !== S) return;
    if (st.screen === 'edit') {
      if (d.t === 'error') errBox(st, d.v + (d.line ? ` (строка ${d.line})` : '') + ' — попроси ИИ исправить: перешли ему эту ошибку.');
      if (d.t === 'score' || d.t === 'over') { const el = root.querySelector('.st-score'); if (el) el.textContent = (d.t === 'over' ? '🏁 ' : '⭐ ') + num(d.v); }
      return;
    }
    if (st.screen === 'play') onPlayMsg(st, d);
  }
  function saveLocal(st){
    if (st !== S) return;
    const g = st.game;
    putDraft({ id: g.id, kind: g.kind, tpl: g.tpl, data: g.data, html: g.html, title: g.title, icon: g.icon, descr: g.descr, srv: !!g.srv });
    markSaved(st, true, 'в браузере');
  }
  function markSaved(st, ok, where){
    const el = root?.querySelector('.st-saved');
    if (el) el.textContent = ok ? '✓ сохранено ' + (where || '') : '';
  }
  function statusLine(st){
    const el = root?.querySelector('.st-status');
    if (!el) return;
    const g = st.game, [si, sn] = STATUS[g.status] || STATUS.draft;
    const link = g.srv && ['link', 'review', 'public'].includes(g.status);
    el.innerHTML = `<span class="st-chip st-${esc(g.status)}">${si} ${sn}</span>
      ${link ? `<button type="button" class="st-btn ghost" data-act="copy-link">📤 Скопировать ссылку</button><a class="st-btn ghost" href="#/games/studio/play/${esc(g.id)}">▶ Страница игры</a>` : ''}
      <small>${!authed() ? 'Войди в аккаунт — тогда игру можно сохранить на сайте и дать ссылку друзьям.' : srvMissing ? 'Публикация заработает чуть позже — сайт обновляется. Пока игра хранится в этом браузере.'
        : g.status === 'review' ? 'Игру проверит модератор — после этого она появится в каталоге. По ссылке играть уже можно.'
        : g.status === 'public' ? 'Игра в каталоге! Если изменишь её, она снова уйдёт на проверку.'
        : g.status === 'banned' ? 'Игру заблокировал модератор — она нарушает правила.' : ''}</small>`;
  }
  async function saveServer(st, want){
    const g = st.game;
    saveLocal(st);
    if (!authed()) { api.toast('🔑 Войди, чтобы сохранить игру на сайте'); if (typeof openGlobalAuth === 'function') openGlobalAuth(); return; }
    if (g.kind === 'html' && (g.html || '').length > MAX_HTML) { api.toast('Код слишком большой — до 200 КБ'); return; }
    if ((g.title || '').trim().length < 2) { api.toast('Придумай название игры'); return; }
    const r = await rpc('ugc_save', {
      p_id: g.srv ? g.id : null, p_title: (g.title || '').trim(), p_descr: (g.descr || '').trim(), p_icon: (g.icon || '🎮').trim(),
      p_kind: g.kind, p_tpl: g.tpl || null, p_data: g.kind === 'tpl' ? TPL().clean(TPL().get(g.tpl), g.data) : {}, p_html: g.kind === 'html' ? g.html : null,
    });
    if (st !== S) return;
    if (!r || !r.ok) {
      api.toast(srvMissing ? 'Сохранение на сайте заработает чуть позже — игра сохранена в браузере' : r?.reason === 'limit' ? 'Слишком много игр — удали старые' : r?.reason === 'too_fast' ? 'Подожди пару секунд' : r?.reason === 'banned' ? 'Эту игру заблокировал модератор' : 'Не сохранилось — попробуй ещё раз');
      statusLine(st);
      return;
    }
    if (!g.srv) { dropDraft(g.id); g.id = r.id; g.srv = true; history.replaceState(null, '', '#/games/studio/edit/' + r.id); }
    g.status = r.status || g.status;
    if (want && want !== g.status) {
      const s2 = await rpc('ugc_status', { p_id: g.id, p_status: want });
      if (s2?.ok) g.status = s2.status;
      else api.toast('Статус не поменялся — попробуй ещё раз');
    }
    putDraft({ id: g.id, kind: g.kind, tpl: g.tpl, data: g.data, html: g.html, title: g.title, icon: g.icon, descr: g.descr, srv: true });
    markSaved(st, true, 'на сайте');
    statusLine(st);
    if (want === 'link' || want === 'review') { copyLink(g.id); }
    else api.toast('💾 Сохранено');
  }
  function copyLink(id){
    const url = SITE + '/g/' + id;
    if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) { navigator.share({ title: 'Моя игра', text: 'Сыграй в мою игру!', url }).catch(() => {}); return; }
    navigator.clipboard?.writeText(url).then(() => api.toast('🔗 Ссылка скопирована: ' + url), () => prompt('Ссылка на игру:', url));
  }

  // ── Игра: страница ──
  async function play(id){
    S = { screen: 'play', id, game: null, sb: null, played: false, rounds: 0 };
    const st = S;
    root.innerHTML = '<div class="st"><div class="st-empty">Загружаем игру…</div></div>';
    let g = null;
    const row = await select(q => q.select('id,title,icon,descr,kind,tpl,data,html,status,plays,likes,author,created_at,profiles(nick)').eq('id', id).maybeSingle());
    if (S !== st) return;
    if (row?.kind === 'place') { location.replace('#/games/studio3d/play/' + id); return; }   // 3D-мир — в «Студии 3D»
    if (row) g = { ...row, srv: true };
    else if (drafts()[id]) g = { ...drafts()[id], status: 'draft', local: true };
    if (!g) { root.innerHTML = '<div class="st"><div class="st-empty">Игра не найдена или скрыта автором. <a href="#/games/studio">Другие игры</a></div></div>'; return; }
    st.game = g;
    const mineG = authed() && g.author === currentUser.id, pub = g.status === 'public';
    root.innerHTML = `<div class="st st-play">
      <div class="st-top"><a class="st-back" href="#/games/studio">← Студия</a></div>
      <div class="st-play-head"><span class="st-play-ic">${esc(g.icon || '🎮')}</span>
        <div class="st-play-t"><b>${esc(g.title)}</b><small>${g.srv ? `от <a href="#/profile/${esc(g.author)}">${esc(g.profiles?.nick || 'игрока')}</a> · 👁 ${num(g.plays)} · ❤️ <span class="st-likes2">${num(g.likes)}</span>` : 'черновик в этом браузере'} ${g.status !== 'public' && g.srv ? `· <span class="st-chip st-${esc(g.status)}">${(STATUS[g.status] || STATUS.draft).join(' ')}</span>` : ''}</small></div>
        <span class="st-play-a">
          ${g.srv ? `<button type="button" class="st-btn ghost" data-act="like">❤️ <span class="st-likes">${num(g.likes)}</span></button><button type="button" class="st-btn ghost" data-act="share">📤</button>` : ''}
          ${mineG || g.local ? `<a class="st-btn ghost" href="#/games/studio/edit/${esc(g.id)}">✏️</a>` : g.srv ? '<button type="button" class="st-btn ghost" data-act="report" title="Пожаловаться">⚠️</button>' : ''}
        </span></div>
      <div class="st-frame-box st-big"></div>
      <div class="st-result" hidden></div>
      <div class="st-ad" hidden></div>
      ${g.descr ? `<p class="st-descr">${esc(g.descr)}</p>` : ''}
      <div class="st-author" hidden></div>
      <div class="st-more" hidden></div>
      <div class="st-cta"><span>Хочешь такую же? Сделай свою игру за пару минут — без кода.</span><a class="st-btn gold" href="#/games/studio">🛠️ Сделать свою игру</a></div>
      <div class="st-warn">Это игра игрока. Никогда не вводи в играх пароли и личные данные.</div>
    </div>`;
    root.querySelector('.st-play-head').addEventListener('click', e => onPlayClick(st, e));
    st.sb = sandbox(root.querySelector('.st-frame-box'), d => onGame(st, d));
    const p = payload(g);
    if (!p) { root.querySelector('.st-frame-box').innerHTML = '<div class="st-empty">Шаблон этой игры пока не поддерживается</div>'; return; }
    let store = '{}';
    try { store = localStorage.getItem(storeKey(g.id)) || '{}'; } catch (e) {}
    st.sb.run(p, store);
    st.pub = pub;
    if (g.srv) authorBlock(st, g);
  }
  // ── Автор игры: аватар (или его персонаж) с рамкой уровня, ник с VIP/ролью, уровень и титул, игры в каталоге,
  //    запуски и лайки, с какого месяца в студии, «Профиль», «В друзья» и «Ещё игры автора» ──
  async function authorBlock(st, g){
    let prof = null;
    try { if (typeof sbProfiles === 'function') { const { data } = await (await sbProfiles()).select('*').eq('id', g.author).maybeSingle(); prof = data || null; } } catch (e) {}
    const games = await select(q => q.select(LIGHT).eq('author', g.author).eq('status', 'public').order('plays', { ascending: false }).limit(13)) || [];
    if (S !== st || !root) return;
    const box = root.querySelector('.st-author');
    if (!box) return;
    const nick = prof?.nick || g.profiles?.nick || 'Игрок';
    const role = typeof ROLE_BADGE_HTML !== 'undefined' ? ROLE_BADGE_HTML[prof?.role] || '' : '';
    let nickHtml = esc(nick);
    try { if (typeof renderNickWithVip === 'function') nickHtml = renderNickWithVip(nick, prof, role); } catch (e) {}
    const plays = games.reduce((a, x) => a + (x.plays || 0), 0), likes = games.reduce((a, x) => a + (x.likes || 0), 0);
    const since = [g, ...games].map(x => x.created_at).filter(Boolean).sort()[0];
    const me = authed() && currentUser.id === g.author;
    const ava = prof?.avatar_url && /^https:\/\//.test(prof.avatar_url) ? `<img src="${esc(prof.avatar_url)}" alt="" loading="lazy">` : '<canvas width="112" height="112"></canvas>';
    box.innerHTML = `<a class="st-au-ava" href="#/profile/${esc(g.author)}" aria-label="Профиль автора">${ava}</a>
      <div class="st-au-b"><span class="st-au-lbl">Автор игры</span>
        <div class="st-au-nick"><a href="#/profile/${esc(g.author)}">${nickHtml}</a><span class="lv-badge" data-lv-uid="${esc(g.author)}"></span></div>
        <small>🎮 ${games.length ? `${num(games.length)} ${plural(games.length, 'игра', 'игры', 'игр')} в каталоге · 👁 ${num(plays)} ${plural(plays, 'запуск', 'запуска', 'запусков')} · ❤️ ${num(likes)}` : 'пока без игр в каталоге'}${since ? ' · в студии с ' + new Date(since).toLocaleDateString('ru', { month: 'long', year: 'numeric' }) : ''}</small></div>
      <div class="st-au-a"><a class="st-btn ghost" href="#/profile/${esc(g.author)}">👤 Профиль</a>${!me && typeof sendFriendRequest === 'function' ? '<button type="button" class="st-btn ghost" data-act="friend">➕ В друзья</button>' : ''}${me ? '<a class="st-btn ghost" href="#/games/studio">📁 Мои игры</a>' : ''}</div>`;
    box.hidden = false;
    box.querySelector('[data-act="friend"]')?.addEventListener('click', () => sendFriendRequest(g.author));
    const cv = box.querySelector('canvas');
    if (cv && window.D37Char) {
      let L = window.D37Char.DEFAULT;
      try { const looks = await window.D37Char.looksOf([g.author]); if (looks[g.author]) L = looks[g.author]; } catch (e) {}
      if (S === st) window.D37Char.draw(cv.getContext('2d'), L, 56, 104, 84, { t: 0 });
    }
    if (typeof applyLevelFrame === 'function') applyLevelFrame(box.querySelector('.st-au-ava'), g.author);
    const more = games.filter(x => x.id !== g.id).slice(0, 8), mb = root.querySelector('.st-more');
    if (mb && more.length) { mb.hidden = false; mb.innerHTML = `<h3 class="st-h">Ещё игры автора</h3><div class="st-grid">${more.map(cardHtml).join('')}</div>`; }
    if (typeof xpQueueBadges === 'function') xpQueueBadges();
  }
  async function onPlayClick(st, e){
    const b = e.target.closest('[data-act]');
    if (!b || st !== S) return;
    const g = st.game, act = b.dataset.act;
    if (act === 'share') copyLink(g.id);
    else if (act === 'like') {
      if (!authed()) { api.toast('🔑 Войди, чтобы ставить лайки'); return; }
      const r = await rpc('ugc_like', { p_id: g.id });
      if (r?.ok) { g.likes = r.likes; b.classList.toggle('on', !!r.liked); root.querySelectorAll('.st-likes,.st-likes2').forEach(s => { s.textContent = num(r.likes); }); api.sfx('ok'); }
    } else if (act === 'report') {
      if (!authed()) { api.toast('🔑 Войди, чтобы пожаловаться'); return; }
      const why = prompt('Что не так с игрой? (оскорбления, взрослое, просит пароль, не работает…)');
      if (!why) return;
      const r = await rpc('ugc_report', { p_id: g.id, p_reason: why.slice(0, 200) });
      api.toast(r?.ok ? '⚠️ Спасибо! Модератор посмотрит' : 'Не отправилось — попробуй позже');
    }
  }
  function onPlayMsg(st, d){
    const g = st.game;
    if (d.t === 'ready' && !st.played) { st.played = true; if (g.srv) rpc('ugc_play', { p_id: g.id }); }
    if (d.t === 'save') { try { if (d.v.length < 60000) localStorage.setItem(storeKey(g.id), d.v); } catch (e) {} }
    if (d.t === 'over') {
      st.rounds++;
      const rec = saveBest(g.id, d.v), best = bestOf(g.id);
      const box = root.querySelector('.st-result');
      if (box) {
        box.hidden = false;
        box.innerHTML = `<span>${rec && d.v > 0 ? '🏆 Новый рекорд' : '🏁 Счёт'}: <b>${num(d.v)}</b> · лучший: ${num(best)}</span>
          ${g.srv ? '<button type="button" class="st-btn" data-act="share-res">📣 Вызвать друга</button>' : ''}`;
        box.onclick = e => { if (e.target.closest('[data-act="share-res"]')) shareResult(g, d.v); };
      }
      // реклама — только у игр из каталога (прошли модерацию), не во время игры
      if (st.pub) {
        const ad = root.querySelector('.st-ad');
        if (ad && !ad.dataset.done && window.D37Ads?.render(ad, 'game_over')) ad.dataset.done = '1';
        if (st.rounds >= 2) window.D37Ads?.interstitial?.();
      }
    }
    if (d.t === 'again') { const box = root.querySelector('.st-result'); if (box) box.hidden = true; }
  }
  function shareResult(g, score){
    const url = SITE + '/g/' + g.id, text = `Я набрал ${score} в игре «${g.title}» — побьёшь?`;
    if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) { navigator.share({ title: g.title, text, url }).catch(() => {}); return; }
    navigator.clipboard?.writeText(text + ' ' + url).then(() => api.toast('📣 Скопировано — отправь другу'), () => prompt('Отправь другу:', text + ' ' + url));
  }

  // ── Модерация (персонал) ──
  async function moderation(){
    S = { screen: 'mod' };
    const st = S;
    if (!isStaff()) { root.innerHTML = '<div class="st"><div class="st-empty">Только для модераторов. <a href="#/games/studio">В студию</a></div></div>'; return; }
    root.innerHTML = '<div class="st"><div class="st-top"><a class="st-back" href="#/games/studio">← Студия</a><b>🛡️ Модерация игр</b></div><div class="st-modlist"><div class="st-empty">Загружаем…</div></div></div>';
    const rows = await select(q => q.select(LIGHT + ',reports').or('status.eq.review,reports.gt.0').order('updated_at', { ascending: true }).limit(50));
    if (S !== st) return;
    const box = root.querySelector('.st-modlist');
    if (!rows) { box.innerHTML = '<div class="st-empty">Нет доступа или сайт обновляется</div>'; return; }
    if (!rows.length) { box.innerHTML = '<div class="st-empty">Очередь пуста 🎉</div>'; return; }
    box.innerHTML = rows.map(g => `<div class="st-row" data-id="${esc(g.id)}"><span class="st-row-ic">${esc(g.icon || '🎮')}</span>
      <div class="st-row-b"><b>${esc(g.title)}</b><small>👤 <a href="#/profile/${esc(g.author)}" target="_blank">${esc(g.profiles?.nick || '')}</a> · ${(STATUS[g.status] || STATUS.draft).join(' ')} · ${g.kind === 'tpl' ? 'шаблон ' + esc(g.tpl) : g.kind === 'place' ? '🧱 3D-мир (модели в нём — проверка в «Студии 3D» → 🛡)' : 'свой код'}${g.reports ? ` · ⚠️ жалоб: ${g.reports}` : ''}</small><small>${esc(g.descr || '')}</small></div>
      <span class="st-row-a"><a class="st-btn ghost" href="${playHref(g)}" target="_blank">▶</a>
        <button type="button" class="st-btn" data-mod="public">✅ В каталог</button><button type="button" class="st-btn ghost" data-mod="link">🔗 Только ссылка</button><button type="button" class="st-btn ghost danger" data-mod="banned">⛔</button></span></div>`).join('');
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-mod]');
      if (!b) return;
      const row = b.closest('[data-id]');
      b.disabled = true;
      const r = await rpc('ugc_review', { p_id: row.dataset.id, p_status: b.dataset.mod });
      if (r?.ok) { row.remove(); api.toast('Готово'); } else { b.disabled = false; api.toast('Не получилось'); }
    });
  }

  window.GAME_IMPL.studio = {
    mount(el, gameApi){ root = el; api = gameApi; show(gameApi.param); },
    unmount(){ stopScreen(); root = null; },
    _test: { extractHtml, aiPrompt, payload },
  };
})();
