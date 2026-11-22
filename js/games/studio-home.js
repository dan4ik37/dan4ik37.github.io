// ═══════════════════════════════════════
//  ГЛАВНАЯ СТУДИИ — одна дверь (T-176, EDITOR_ONE S1; владелец 21.11: «Сделай пока создание режимов»). Флаг STUDIO_ONE (config.js)
// ═══════════════════════════════════════
// #/games/studio при STUDIO_ONE: 1) «🎮 Создать режим» — десять готовых заготовок «Студии 3D» карточками (картинка, название, строка,
// возраст); список — js/games/studio-blanks.js, он собирается из самих заготовок (studio3d-modes.js T + modes.js desc) проверкой
// scripts/studio-home-test.cjs --write, руками не пишется. Нажал — #/games/studio3d/new/<заготовка>: «Студия 3D» делает новый мир из
// заготовки и сразу открывает окно «🎮 Режим игры и ракурс» (ползунки, «▶ Проверить», «👥 Вдвоём»). 2) «✨ Создать» — 3D-мир, шесть
// шаблонов, «Свой код + ИИ» (редактор «Студии игр», без 3D). 3) «📁 Мои проекты» — одним списком: игры с сайта (все виды), черновики
// этого браузера (d37_studio_drafts) и 3D-миры этого браузера (d37_s3_index → #/games/studio3d/open/<id>). 4) «🌍 Игры игроков» — как
// раньше, но по возрасту, как /hub (выше своей границы — не показываем). Везде: «Загружаем…», «Пока пусто», «Не получилось» + «Повторить».
// Простая разметка (DOM): three.js и движок здесь не грузятся — только когда нажата карточка 3D. Чужой текст — только через esc().
// Запросы, черновики, метки возраста, адреса игр — из studio.js (homeCore), второй копии нет. Стили — css/studio-one.css.
(() => {
  const S3_INDEX = 'd37_s3_index';
  const PIC = id => `img/studio/modes/${id}.webp`;
  const ver = () => (typeof GAMES_VER !== 'undefined' ? GAMES_VER : '1');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const playOf = g => (g.kind === 'place' ? `#/games/studio3d/play/${esc(g.id)}` : `#/games/studio/play/${esc(g.id)}`);   // как playHref в studio.js
  const ageOf = g => (g?.age_rating != null && window.D37Age?.badge ? window.D37Age.badge(+g.age_rating, { title: 'Метка возраста игры' }) : '');
  const KIND = { place: '🧱 3D-мир', tpl: '🎮 Игра', html: '💻 Свой код' };
  // T-176 S2: «⚡ Арена на нашем движке» (js/games/studio-arena.js) — только при флаге STUDIO_ARENA и загруженном редакторе
  const arenaOn = () => typeof STUDIO_ARENA !== 'undefined' && !!STUDIO_ARENA && !!window.D37StudioArena;
  const arenaCard = () => `<div class="so-arena"><span class="so-arena-ic" aria-hidden="true">⚡</span><b>Арена на нашем движке</b>
      <small>Собери свой режим из блоков и правил «когда → то» и сразу играй — на телефоне тоже.</small>
      <span class="so-arena-a"><a class="so-btn" href="#/games/studio/arena/new" data-arena="new">С нуля</a><a class="so-btn ghost" href="#/games/studio/arena/demo" data-arena="demo">Из примера</a></span></div>`;
  const arenaProjects = () => { try { return arenaOn() ? window.D37StudioArena.projects() : []; } catch (e) { return []; } };

  function css(){
    if (typeof document === 'undefined' || document.getElementById('studio-one-css')) return;
    const l = document.createElement('link'); l.id = 'studio-one-css'; l.rel = 'stylesheet'; l.href = 'css/studio-one.css?v=' + ver();
    document.head.appendChild(l);
  }
  const blanks = () => (Array.isArray(window.D37StudioBlanks) ? window.D37StudioBlanks : []);
  // 3D-миры этого браузера (studio3d.js store.index: { id, name, t, n })
  function localWorlds(){
    try { const a = JSON.parse(localStorage.getItem(S3_INDEX) || '[]'); return Array.isArray(a) ? a.filter(w => w && /^[a-z0-9]{4,24}$/i.test(String(w.id))) : []; } catch (e) { return []; }
  }
  // Возраст, как в /hub (hub-catalog.js): 16+ видят только 16+ и взрослые, остальным — до 12+; без метки — показываем
  function ageMax(){ let g = 'unknown'; try { g = window.D37Age ? window.D37Age.group() : 'unknown'; } catch (e) {} return g === 'teen16' || g === 'adult' ? 16 : 12; }
  const ageFits = (g, max = ageMax()) => g?.age_rating == null || +g.age_rating <= max;
  const ageMark = a => (window.D37Age?.badge ? window.D37Age.badge(a, { title: 'Метка возраста режима (её можно поменять при «Выложить»)' }) : `<i class="so-age">${esc(a)}+</i>`);

  // ── Разметка (чистые функции — их проверяет scripts/studio-home-test.cjs) ──
  const modeCard = b => `<a class="so-mode" href="#/games/studio3d/new/${esc(b.id)}" data-blank="${esc(b.id)}" style="--c:${/^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#475569'}">
      <span class="so-pic"><span class="so-pic-ic" aria-hidden="true">${esc(b.icon)}</span><img src="${esc(PIC(b.id))}" alt="" loading="lazy" decoding="async" width="480" height="270"></span>
      <span class="so-mode-b"><b>${esc(b.icon)} ${esc(b.name)}</b><small>${esc(b.line)}</small><span class="so-mode-f">${ageMark(b.age)}<span class="so-go">Открыть →</span></span></span></a>`;
  const createTile = (href, icon, name, line, cls = '') => `<a class="so-tile${cls}" href="${esc(href)}"><span class="so-tile-ic" aria-hidden="true">${esc(icon)}</span><span><b>${esc(name)}</b><small>${esc(line)}</small></span></a>`;
  // одна строка «Мои проекты»: g — { src: 'srv' | 'draft' | 'world', … }
  function rowHtml(g, C){
    if (g.src === 'arena') {
      const href = `#/games/studio/arena/open/${esc(g.id)}`;
      return `<div class="so-row"><span class="so-row-ic" aria-hidden="true">⚡</span><div class="so-row-b"><b>${esc(g.name || 'Моя арена')}</b><small>⚡ Арена · только в этом браузере</small></div>
        <span class="so-row-a"><a class="so-btn" href="${href}">Открыть</a></span></div>`;
    }
    if (g.src === 'world') {
      const href = `#/games/studio3d/open/${esc(g.id)}`;
      return `<div class="so-row"><span class="so-row-ic" aria-hidden="true">🧱</span><div class="so-row-b"><b>${esc(g.name || 'Мой мир')}</b><small>${KIND.place} · только в этом браузере${g.n ? ` · ${esc(g.n)} объектов` : ''}</small></div>
        <span class="so-row-a"><a class="so-btn" href="${href}">Открыть</a></span></div>`;
    }
    const st = (C?.STATUS || {})[g.status] || (C?.STATUS || {}).draft || ['📝', 'Черновик'];
    const kind = KIND[g.kind] || KIND.html;
    const edit = g.kind === 'place' ? '#/games/studio3d' : `#/games/studio/edit/${esc(g.id)}`;
    const play = playOf(g);
    return `<div class="so-row"><span class="so-row-ic" aria-hidden="true">${esc(g.icon || '🎮')}</span><div class="so-row-b"><b>${esc(g.title || 'Без названия')}${ageOf(g)}</b>
      <small>${kind} · <span class="so-chip so-${esc(g.status || 'draft')}">${esc(st[0])} ${esc(st[1])}</span>${g.src === 'srv' ? ` · 👁 ${esc(C?.num ? C.num(g.plays) : +g.plays || 0)} · ❤️ ${esc(C?.num ? C.num(g.likes) : +g.likes || 0)}` : ' · только в этом браузере'}</small></div>
      <span class="so-row-a"><a class="so-btn" href="${play}" title="Играть">▶</a><a class="so-btn ghost" href="${edit}" title="Изменить">✏️</a></span></div>`;
  }
  function catCard(g, C){
    return `<a class="so-card" href="${playOf(g)}"><span class="so-card-ic" aria-hidden="true">${esc(g.icon || '🎮')}</span><b>${esc(g.title)}${ageOf(g)}</b>${g.kind === 'place' ? '<small class="so-card-3d">🧱 3D-мир</small>' : ''}
      <small>👤 ${esc(g.profiles?.nick || 'Игрок')}${g.author ? `<span class="lv-badge" data-lv-uid="${esc(g.author)}"></span>` : ''}</small><small>👁 ${esc(C?.num ? C.num(g.plays) : +g.plays || 0)} · ❤️ ${esc(C?.num ? C.num(g.likes) : +g.likes || 0)}</small></a>`;
  }
  const stateHtml = (kind, text, retry) => `<div class="so-state so-${kind}" role="${kind === 'err' ? 'alert' : 'status'}">${kind === 'load' ? '<span class="so-spin" aria-hidden="true"></span>' : ''}<span>${esc(text)}</span>${retry ? `<button type="button" class="so-btn ghost" data-retry="${esc(retry)}">Повторить</button>` : ''}</div>`;
  const errText = err => (err === 'missing' ? 'Каталог откроется совсем скоро — сайт обновляется.' : err === 'offline' ? 'Нет связи с сайтом — проверь интернет.' : 'Не получилось загрузить — проверь интернет.');

  function skeleton(C){
    const tpls = C.tpls();
    return `<div class="so">
      <div class="so-hero"><h2>🛠️ Студия</h2><p>Сделай свой режим, игру или 3D-мир и позови друзей по ссылке. Начни с готового режима — он уже играется.</p></div>
      <section class="so-sec" aria-labelledby="so-h-modes"><h3 class="so-h" id="so-h-modes">🎮 Создать режим <small>готовая карта и правила — поменяй и играй</small></h3>
        <div class="so-modes">${arenaOn() ? arenaCard() : ''}${blanks().map(modeCard).join('') || stateHtml('err', 'Режимы не загрузились — обнови страницу.')}</div>
        <p class="so-note">Режимы — в 3D. Если телефон не тянет 3D, ниже есть игры без 3D: шаблоны и «Свой код».</p></section>
      <section class="so-sec" aria-labelledby="so-h-new"><h3 class="so-h" id="so-h-new">✨ Создать</h3>
        <div class="so-tiles">${createTile('#/games/studio3d/new/grass', '🧱', '3D-мир', 'Пустой мир с травой: строй из деталей, деревьев и фонарей, оживляй скриптами.', ' so-tile-3d')}
          ${tpls.map(t => createTile('#/games/studio/new/' + t.id, t.icon, t.name, t.desc)).join('')}
          ${createTile('#/games/studio/new/code', '💻', 'Свой код + ИИ', 'Опиши игру — DeepSeek, GigaChat или ChatGPT напишут код. Вставь его сюда — и играй.', ' so-tile-code')}</div>
        <p class="so-note">Игра из Unity? <a href="#/games/unity">Выложи её в «Unity-игры» →</a></p></section>
      <section class="so-sec" aria-labelledby="so-h-mine"><h3 class="so-h" id="so-h-mine">📁 Мои проекты</h3><div class="so-mine">${stateHtml('load', 'Загружаем…')}</div></section>
      <section class="so-sec" aria-labelledby="so-h-cat"><h3 class="so-h" id="so-h-cat">🌍 Игры игроков <span class="so-sort"><button type="button" data-sort="plays" class="on">Популярные</button><button type="button" data-sort="new">Новые</button></span></h3>
        <div class="so-cat">${stateHtml('load', 'Загружаем…')}</div></section>
      <div class="so-mod" hidden></div>
      <div class="so-rules"><b>Правила:</b> никаких оскорблений, взрослого контента, азартных игр и чужих паролей. В каталог игры попадают после проверки модератором, до этого — только по ссылке.
        За популярные игры автор получает монеты 🪙.</div>
    </div>`;
  }

  // ── Экран ──
  function render(root, C){
    css();
    root.innerHTML = skeleton(C);
    // картинка не загрузилась — остаётся значок на цвете режима
    root.querySelectorAll('.so-pic img').forEach(img => img.addEventListener('error', () => img.remove(), { once: true }));
    let sort = 'plays';
    root.querySelector('.so')?.addEventListener('click', e => {   // на своём блоке, не на root: root живёт и под другими экранами студии
      const r = e.target.closest?.('[data-retry]');
      if (r) { if (r.dataset.retry === 'mine') mine(root, C); else catalog(root, C, sort); return; }
      const s = e.target.closest?.('.so-sort [data-sort]');
      if (s) { sort = s.dataset.sort; root.querySelectorAll('.so-sort button').forEach(x => x.classList.toggle('on', x === s)); catalog(root, C, sort); }
    });
    mine(root, C);
    catalog(root, C, sort);
    if (C.isStaff()) { const b = root.querySelector('.so-mod'); if (b) { b.hidden = false; b.innerHTML = '<a class="so-btn" href="#/games/studio/mod">🛡️ Модерация игр</a>'; } }
  }

  // «Мои проекты»: игры с сайта + черновики браузера + 3D-миры браузера — одним списком, новые сверху
  async function mine(root, C){
    const box = root.querySelector('.so-mine'); if (!box) return;
    box.innerHTML = stateHtml('load', 'Загружаем…');
    const uid = C.uid();
    let srv = [], err = null;
    if (uid) { const L = await C.light(); const r = await C.query(q => q.select(L).eq('author', uid).order('updated_at', { ascending: false }).limit(60)); srv = r.rows || []; err = r.err; }
    if (!C.alive()) return;
    const ids = new Set(srv.map(g => g.id));
    const t = g => Date.parse(g.updated_at || '') || +g.updated || +g.t || 0;
    const list = [
      ...srv.map(g => ({ ...g, src: 'srv' })),
      ...Object.values(C.drafts()).filter(d => d && d.id && !ids.has(d.id)).map(d => ({ ...d, status: 'draft', src: 'draft' })),
      ...localWorlds().map(w => ({ ...w, src: 'world' })),
      ...arenaProjects().map(a => ({ ...a, src: 'arena' })),
    ].sort((a, b) => t(b) - t(a));
    const warn = err ? stateHtml('err', uid ? 'Игры с сайта не загрузились. ' + errText(err) : errText(err), 'mine') : '';
    if (!list.length) { box.innerHTML = warn || stateHtml('empty', uid ? 'Пока пусто — выбери режим или шаблон выше 🙂' : 'Пока пусто — выбери режим или шаблон выше 🙂 Войди, чтобы видеть и игры, выложенные на сайт.'); return; }
    box.innerHTML = warn + `<div class="so-list">${list.map(g => rowHtml(g, C)).join('')}</div>`;
    if (err) box.querySelector('.so-err')?.setAttribute('title', String(err));
  }

  async function catalog(root, C, sort){
    const box = root.querySelector('.so-cat'); if (!box) return;
    box.innerHTML = stateHtml('load', 'Загружаем…');
    const L = await C.light();
    const r = await C.query(q => q.select(L).eq('status', 'public').order(sort === 'new' ? 'created_at' : 'plays', { ascending: false }).limit(30));
    if (!C.alive()) return;
    if (!r.rows) { box.innerHTML = stateHtml('err', errText(r.err), 'cat'); box.querySelector('.so-err')?.setAttribute('title', String(r.err || '')); return; }
    const max = ageMax(), rows = r.rows.filter(g => ageFits(g, max));
    if (!rows.length) { box.innerHTML = stateHtml('empty', 'Здесь будут лучшие игры игроков. Сделай свою — может, она будет первой!'); return; }
    box.innerHTML = `<div class="so-grid">${rows.map(g => catCard(g, C)).join('')}</div>`;
    window.D37AdPlaces?.feed(box.firstChild, { place: 'feed_ugc', every: 8, row: true, max: 2 });   // реклама — только в каталоге (игры прошли проверку), как раньше
    if (typeof xpQueueBadges === 'function') xpQueueBadges();
  }

  window.D37StudioHome = { render, _test: { modeCard, rowHtml, catCard, stateHtml, ageFits, skeleton, localWorlds } };
})();
