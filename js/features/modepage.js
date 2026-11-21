// ═══════════════════════════════════════
//  📄 СТРАНИЦА РЕЖИМА / ИГРЫ, как в Roblox (T-171, владелец 19.11: «страница-комната каждого режима: описание, картинки и видео,
//  кнопка „Играть“, автор, сколько играют, рекорды…»)
// ═══════════════════════════════════════
// Адрес: /hub/mode/<id> (раздел /hub уже открывается оболочкой сайта — новых правил адресов не нужно).
//   <id> — игра сайта (id из GAMES, js/features/games.js): chess, kletochki, world…
//          e-play / e-creative / e-klet — режимы нового движка (плитки /hub)
//          ugc-<id> / unity-<id> — игра игрока (каталоги ugc_games / unity_games, только опубликованные)
// На странице: картинка и описание, метка возраста, «▶ Играть», кто играет сейчас (общее «кто онлайн» — только те, кто сам показывает,
// чем занят; ник открывает общую мини-карточку — «Присоединиться» там по тем же правилам возраста), комнаты (T-174 — список лобби
// движка прямо на странице и ссылка «Все комнаты»), рекорды (game_top — у игр с таблицей рекордов), для игр игроков — автор и
// «🔔 Следить» (T-170). Видео — когда оно есть в MEDIA (пока пусто: роликов по режимам нет).
// Куда ведут ссылки сюда: «ⓘ» на карточке игры в каталоге и на плитках /hub (.md-dot[data-md]), «Игры игроков».
// Чужой текст (ники, названия и описания игр игроков) — только textContent. Откат — MODE_PAGE = false (js/core/config.js).
(() => {
  'use strict';
  const ON = () => { try { return typeof MODE_PAGE === 'undefined' || !!MODE_PAGE; } catch (e) { return true; } };
  if (window.D37Mode) return;
  const M = window.D37Mode = {};
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const sb = () => (typeof sbClient !== 'undefined' && sbClient) || null;
  const go = href => { if (window.D37Route?.go) D37Route.go(href); else location.href = href; };
  const ID_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/i;
  // адрес кнопки — только свой раздел сайта («/…» или «#/…»), без пробелов, кавычек и схем
  const safeHref = h => (/^(\/|#\/)[A-Za-z0-9/_.%?=&#-]*$/.test(String(h || '')) && !String(h).startsWith('//') ? String(h) : '/play');
  // ролики и дополнительные картинки по режимам: { '<id>': { video: '<id ролика YouTube>', shots: ['img/…'] } } — заполняется по мере появления
  const MEDIA = {};
  const ENGINE = {
    'e-play': { tile: 'play', join: '', rules: '' },
    'e-creative': { tile: 'creative', join: '', rules: '' },
    'e-klet': { tile: 'klet', join: 'klet2', rules: '/games/kletochki' },
  };
  M.href = id => '/hub/mode/' + encodeURIComponent(id);
  const ageMax = () => { let g = 'unknown'; try { g = window.D37Age ? window.D37Age.group() : 'unknown'; } catch (e) {} return g === 'teen16' || g === 'adult' ? 16 : 12; };

  // ═══ Что за режим ═══
  async function resolve(id){
    id = String(id || '');
    if (!ID_RE.test(id)) return null;
    if (ENGINE[id]) {
      const t = (window.D37Hub?.TILES || []).find(x => x.id === ENGINE[id].tile); if (!t) return null;
      return { id, kind: 'engine', title: t.title, icon: t.icon, desc: t.sub, play: t.href, join: ENGINE[id].join, rules: ENGINE[id].rules, age: t.age || '', img: '', lead: 'Режим нового движка D37' };
    }
    const ug = /^(ugc|unity)-(.{1,36})$/.exec(id);
    if (ug) {
      if (!sb()) return null;
      const table = ug[1] === 'ugc' ? 'ugc_games' : 'unity_games', gid = ug[2];
      try {
        const cols = 'id,title,icon,descr,author,plays,likes,updated_at,status' + (table === 'ugc_games' ? ',kind' : '');
        // метка возраста игры игрока — то же правило, что в каталоге «Игры игроков» (hub-catalog.js): до 16 лет и без возраста — до 12+
        let res = await sb().from(table).select(cols + ',age_rating').eq('id', gid).eq('status', 'public').limit(1);
        if (res.error) res = await sb().from(table).select(cols).eq('id', gid).eq('status', 'public').limit(1);   // старая база без колонки метки
        const g = res.data && res.data[0]; if (!g) return null;
        const rate = g.age_rating == null ? null : +g.age_rating;
        if (rate != null && rate > ageMax()) return { id, kind: 'age', age: rate + '+' };   // не по возрасту: ни названия, ни описания
        let nick = 'игрок';
        try { if (typeof sbProfiles === 'function') { const r = await (await sbProfiles()).select('nick').eq('id', g.author).limit(1); nick = (r.data && r.data[0] && r.data[0].nick) || nick; } } catch (e) {}
        const play = table === 'unity_games' ? '#/games/unity/play/' + encodeURIComponent(g.id) : (g.kind === 'place' ? '#/games/studio3d/play/' : '#/games/studio/play/') + encodeURIComponent(g.id);
        return { id, kind: 'player', title: String(g.title || 'Игра').slice(0, 60), icon: String(g.icon || '🎮').slice(0, 16), desc: String(g.descr || '').slice(0, 300), play, join: '', rules: '',
          age: rate != null && rate >= 0 ? rate + '+' : '', img: '', lead: 'Игра игрока', author: g.author, nick: String(nick).slice(0, 40), plays: +g.plays || 0, likes: +g.likes || 0, at: g.updated_at };
      } catch (e) { return null; }
    }
    const g = typeof GAMES !== 'undefined' ? GAMES.find(x => x.id === id) : null;
    if (!g) return null;
    return { id, kind: 'site', title: g.title, icon: g.icon, desc: g.desc, play: g.href ? (window.D37Route?.href ? D37Route.href(g.href) : g.href) : '/play/' + g.id, join: '', rules: g.href ? '' : '/games/' + g.id,
      age: g.age || '', ageWhy: g.ageWhy || '', img: 'img/games/' + g.id + '.png', color: g.color || '', top: g.top || '', topLabel: g.topLabel || '', actG: g.id, lead: 'Игра сайта' };
  }
  M._resolve = resolve;

  // ═══ Кто играет сейчас: общее «кто онлайн» (профиль «видят все» и человек сам показывает, чем занят) ═══
  function playing(m){
    const P = window.D37Phone, on = window.D37Chat?.online?.() || { users: [] };
    if (!P?.actParse) return [];
    const out = [], seen = new Set();
    for (const u of on.users || []) {
      if (!u || !u.id || seen.has(u.id)) continue;
      const a = P.actParse(u.a);
      const hit = m.join ? !!(a.d && a.d.g === m.join) : m.actG ? a.g === m.actG : m.kind === 'player' ? (typeof a.j === 'string' && a.j.endsWith('/' + m.id.replace(/^(ugc|unity)-/, ''))) : false;
      if (hit) { seen.add(u.id); out.push({ id: u.id, nick: String(u.nick || 'игрок').slice(0, 24) }); }
    }
    return out;
  }
  M._playing = playing;
  const plural = (n, a, b, c) => (n % 10 === 1 && n % 100 !== 11 ? a : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? b : c);

  // ═══ Страница ═══
  let seq = 0;
  M.page = async (host, id) => {
    if (!host) return;
    const my = ++seq;
    host.textContent = '';
    const wrap = el('div', 'hub wrap md');
    const back = el('a', 'hub-chip hub-chip-x md-back', '← Все игры'); back.href = '/hub';
    wrap.append(back);
    host.appendChild(wrap);
    if (!ON()) { wrap.append(el('p', 'hub-soon', 'Страницы игр появятся позже. А пока — раздел «Игры».')); return; }
    const load = el('p', 'md-dim', 'Загружаем…'); wrap.append(load);
    const m = await resolve(id);
    if (my !== seq || !wrap.isConnected) return;
    load.remove();
    if (!m) {
      wrap.append(el('h1', 'hub-h1', 'Такой игры нет'), el('p', 'hub-lead', 'Возможно, её убрали или ссылка с ошибкой.'));
      const a = el('a', 'md-play', '🎮 Все игры'); a.href = '/play'; wrap.append(a);
      return;
    }
    if (m.kind === 'age') {   // игра игрока с меткой старше, чем можно этому человеку: без названия и описания
      wrap.append(el('h1', 'hub-h1', 'Эта игра — для тех, кто старше'), el('p', 'hub-lead', `У игры метка ${m.age}. Тебе доступны игры с меткой помладше — их много в каталоге.`));
      const a = el('a', 'md-play', '🎮 Все игры'); a.href = '/play'; wrap.append(a);
      return;
    }
    try { document.title = m.title + ' — играть онлайн | Dan4ik37'; } catch (e) {}
    // ── верх: картинка + название, возраст, описание, «Играть» ──
    const hero = el('section', 'md-hero');
    // картинка — та же ссылка, что и «▶ Играть» (на картинке игры сайта кнопка «Играть» нарисована — нажатие по ней должно работать)
    const pic = el('a', 'md-pic'); pic.href = safeHref(m.play); pic.dataset.nomini = '1'; pic.setAttribute('aria-label', 'Играть: ' + m.title);
    if (m.color) pic.style.setProperty('--gc', m.color);
    const big = el('span', 'md-pic-ic', m.icon); pic.append(big);
    if (m.img) { const im = new Image(); im.alt = 'Картинка игры «' + m.title + '»'; im.decoding = 'async'; im.loading = 'eager'; im.onload = () => { pic.classList.add('has'); }; im.onerror = () => im.remove(); im.src = m.img; pic.append(im); }
    const info = el('div', 'md-info');
    const kick = el('div', 'md-kick', m.lead);
    const h1 = el('h1', 'md-h1'); h1.append(el('span', 'md-ic', m.icon), document.createTextNode(' ' + m.title));
    if (m.age) { const b = el('i', 'md-age', m.age); if (m.ageWhy) b.title = m.ageWhy; h1.append(' ', b); }
    const desc = el('p', 'md-desc', m.desc || 'Описания пока нет.');
    const acts = el('div', 'md-acts');
    const play = el('a', 'md-play', '▶ Играть'); play.href = safeHref(m.play); play.dataset.nomini = '1';
    acts.append(play);
    if (m.join && window.D37Join) { const r = el('a', 'md-btn', '👥 Комнаты'); r.href = '/hub/lobby/' + m.join; acts.append(r); }
    if (m.rules) { const r = el('a', 'md-btn', '📖 Правила и советы'); r.href = safeHref(m.rules); acts.append(r); }
    const share = el('button', 'md-btn', '🔗 Поделиться'); share.type = 'button';
    share.onclick = async () => { const url = (window.D37Ref?.wrap || (u => u))(location.origin + M.href(m.id)); let okc = false; try { await navigator.clipboard.writeText(url); okc = true; } catch (e) {} share.textContent = okc ? '✅ Ссылка скопирована' : '⚠️ Не скопировалось'; setTimeout(() => { share.textContent = '🔗 Поделиться'; }, 1800); };
    acts.append(share);
    info.append(kick, h1, desc, acts);
    if (m.ageWhy) info.append(el('p', 'md-why', m.age + ': ' + m.ageWhy));
    hero.append(pic, info);
    wrap.append(hero);

    const grid = el('div', 'md-grid');
    wrap.append(grid);
    // ── кто играет сейчас ──
    const now = el('section', 'md-card md-now');
    const nowH = el('h2', 'md-h2', '🟢 Сейчас играют'), nowB = el('div', 'md-people');
    now.append(nowH, nowB);
    grid.append(now);
    const paintNow = () => {
      if (!now.isConnected) { window.removeEventListener('d37:online', paintNow); return; }
      const L = playing(m);
      nowH.textContent = L.length ? `🟢 Сейчас играют: ${L.length}` : '🟢 Сейчас играют';
      nowB.textContent = '';
      if (!L.length) { nowB.append(el('p', 'md-dim', 'Прямо сейчас никого не видно — зайди первым. Здесь видно только тех, кто сам показывает, чем занят.')); return; }
      for (const u of L.slice(0, 24)) {
        const a = el('button', 'md-user', u.nick); a.type = 'button'; a.dataset.miniUid = u.id; a.dataset.miniNick = u.nick; a.title = 'Открыть карточку игрока';
        nowB.append(a);
      }
      if (L.length > 24) nowB.append(el('span', 'md-dim', `и ещё ${L.length - 24}`));
      // «Присоединиться» прямо в этом списке не ставим: рядом с ником нет проверки возраста. Ник открывает карточку — там кнопка есть
      // только тем, кому можно (правило: адресное «Присоединиться» между детьми и взрослыми скрыто).
    };
    window.addEventListener('d37:online', paintNow);
    paintNow();
    // ── комнаты (T-174): список лобби движка прямо здесь; у игр сайта комнаты создаются внутри игры ──
    if (m.join && window.D37Join?.lobby) {
      const rooms = el('section', 'md-card md-rooms');
      rooms.append(el('h2', 'md-h2', '👥 Комнаты'));
      const box = el('div', 'md-lobby'); rooms.append(box);
      try { window.D37Join.lobby(box, { game: m.join }); } catch (e) {}
      const all = el('a', 'md-link', 'Все комнаты →'); all.href = '/hub/lobby/' + m.join; rooms.append(all);
      grid.append(rooms);
    } else if (m.kind === 'site') {
      const rooms = el('section', 'md-card md-rooms');
      rooms.append(el('h2', 'md-h2', '👥 Играть с людьми'), el('p', 'md-dim', 'Комната создаётся в самой игре: нажми «▶ Играть», потом «Позвать» — и скинь ссылку другу. Комнаты игр нового движка — в общем списке.'));
      const all = el('a', 'md-link', 'Список комнат →'); all.href = '/hub/lobby'; rooms.append(all);
      grid.append(rooms);
    }
    // ── автор (игры игроков): ник, «Следить», сколько сыграли ──
    if (m.kind === 'player') {
      const au = el('section', 'md-card md-author');
      au.append(el('h2', 'md-h2', '👤 Автор'));
      const row = el('div', 'md-acts');
      const nick = el('a', 'md-btn', m.nick); nick.href = '#/profile/' + m.author;
      row.append(nick);
      const F = window.D37Follow;
      if (F && typeof currentUser !== 'undefined' && currentUser && currentUser.id !== m.author) {
        const fb = el('button', 'md-btn', '🔔 Следить'); fb.type = 'button'; fb.hidden = true; row.append(fb);
        let st = null;
        const paint = () => { fb.hidden = !st || (!!st.why && !st.on); fb.textContent = st && st.on ? '✓ Слежу за автором' : '🔔 Следить за автором'; fb.setAttribute('aria-pressed', String(!!(st && st.on))); };
        F.info(m.author).then(v => { st = v; if (fb.isConnected) paint(); });
        fb.onclick = async () => { if (!st) return; fb.disabled = true; const r = await F.set(m.author, !st.on); fb.disabled = false; if (r.ok) { st.on = r.on; paint(); } else if (typeof xpToast === 'function') xpToast('⚠️ ' + r.msg); };
      }
      au.append(row, el('p', 'md-dim', `▶ ${m.plays} ${plural(m.plays, 'раз сыграли', 'раза сыграли', 'раз сыграли')} · 👍 ${m.likes}`));
      grid.append(au);
    }
    // ── рекорды (у игр с таблицей рекордов) ──
    if (m.top && sb()) {
      const rec = el('section', 'md-card md-top');
      rec.append(el('h2', 'md-h2', '🏆 Рекорды'));
      const ol = el('ol', 'md-toplist'); ol.append(el('li', 'md-dim', 'Загружаем…')); rec.append(ol);
      grid.append(rec);
      (async () => {
        let data = null;
        try { const r = await sb().rpc('game_top', { p_game: m.top, lim: 10 }); data = r.error ? null : r.data; } catch (e) {}
        if (!ol.isConnected) return;
        ol.textContent = '';
        if (!Array.isArray(data)) { rec.remove(); return; }
        if (!data.length) { ol.append(el('li', 'md-dim', 'Пока никто не сыграл — стань первым!')); return; }
        data.slice(0, 10).forEach((r, i) => {
          const li = el('li', 'md-topi');
          const a = el('a', 'md-topn', String(r.nick || 'игрок').slice(0, 40)); a.href = '#/profile/' + r.user_id;
          let label = String(r.best_score);
          try { if (typeof gameBestLabel === 'function') label = gameBestLabel(m.id, r.best_score); } catch (e) {}
          li.append(el('span', 'md-topp', ['🥇', '🥈', '🥉'][i] || String(i + 1)), a, el('span', 'md-tops', label));
          ol.append(li);
        });
        if (m.topLabel) rec.append(el('p', 'md-dim', m.topLabel));
      })();
    }
    // ── картинки и видео ──
    const media = MEDIA[m.id];
    if (media && (media.video || (media.shots && media.shots.length))) {
      const sec = el('section', 'md-card md-media');
      sec.append(el('h2', 'md-h2', '🎬 Картинки и видео'));
      const row = el('div', 'md-shots');
      if (media.video && /^[A-Za-z0-9_-]{11}$/.test(media.video)) {   // ролик грузится только по нажатию (до этого — картинка-обложка)
        const v = el('button', 'md-video', '▶ Смотреть ролик'); v.type = 'button';
        v.style.backgroundImage = `url("https://i.ytimg.com/vi/${media.video}/hqdefault.jpg")`;
        v.onclick = () => { const f = document.createElement('iframe'); f.src = 'https://www.youtube-nocookie.com/embed/' + media.video + '?autoplay=1'; f.allow = 'autoplay; encrypted-media; picture-in-picture'; f.allowFullscreen = true; f.title = 'Ролик об игре'; f.className = 'md-frame'; v.replaceWith(f); };
        row.append(v);
      }
      for (const s of (media.shots || []).slice(0, 8)) { if (!/^img\/[a-z0-9/_.-]+$/i.test(s)) continue; const im = new Image(); im.loading = 'lazy'; im.alt = 'Снимок игры'; im.src = s; im.className = 'md-shot'; row.append(im); }
      sec.append(row);
      wrap.append(sec);
    }
  };

  // ═══ Ссылки «ⓘ» на карточках игр и плитках (внутри ссылки на игру — поэтому не <a>, а .md-dot[data-md] + обработчик; имя data-md своё: data-mode уже есть у чата) ═══
  M.dot = id => { const s = el('span', 'md-dot', 'ⓘ'); s.dataset.md = id; s.setAttribute('role', 'link'); s.tabIndex = 0; s.title = 'Страница игры: описание, кто играет, рекорды'; s.setAttribute('aria-label', 'Страница игры'); return s; };
  M.dotHtml = id => (ON() && ID_RE.test(String(id)) ? `<span class="md-dot" data-md="${String(id)}" role="link" tabindex="0" title="Страница игры: описание, кто играет, рекорды" aria-label="Страница игры">ⓘ</span>` : '');
  M.on = ON;
  const onDot = ev => {
    const d = ev.target?.closest?.('.md-dot[data-md]'); if (!d || !ON()) return;
    if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
    const id = d.dataset.md; if (!ID_RE.test(id)) return;
    ev.preventDefault(); ev.stopPropagation();
    go(M.href(id));
  };
  document.addEventListener('click', onDot, true);
  document.addEventListener('keydown', onDot, true);
})();
