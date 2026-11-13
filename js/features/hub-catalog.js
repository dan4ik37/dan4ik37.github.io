// ═══════════════════════════════════════
//  🎮 ПЛАТФОРМА D37 — «кто ты в игре» и «Игры игроков» (T-163, владелец 13.11: «не увидел нормально строку игры, где мы бы
//  смотрели игры людей… не увидел достойное объединение с сайтом»)
// ═══════════════════════════════════════
// Вызывает js/features/hub.js (renderMenu и маршрут /hub/games), без этого файла меню — как было.
//  • me(wrap)  — плашка над плитками: ник и персонаж (тело + цвета образа d37body / d37look), твой мир (сколько наиграно, когда
//                сохранён, в облаке ли), творческий мир, друзья онлайн (заявки friendships + кто сейчас в чате сайта — D37Chat.online),
//                «👕 Гардероб» (лёгкий, без мира) и «📍 Позвать друга» (ссылка сразу в игру /hub/play).
//  • row(wrap) — горизонтальная строка «Игры игроков», как в Роблоксе: опубликованные игры «Студии игр» и 3D-миры «Студии 3D»
//                (ugc_games, status = public — прошли модерацию) и Unity-игры (unity_games, public): значок, название, автор (ник —
//                только textContent), запуски и лайки, возрастная метка; «Играть» открывает игру. Пока никто ничего не выложил —
//                игры Денчика (витрина, подписано «от Денчика», не выдаём за игры игроков) и карточка «Сделай первую игру».
//  • page(box) — /hub/games («Все»): фильтры «Популярные / Новые» и жанр (аркады из шаблонов, свой код, 3D-миры, Unity).
// Безопасность детей: только public, возрастная метка видна; 18+ не показываем никому (взрослого мира ещё нет), 16+ — только тем,
// кто сам указал 16 лет и больше. Чужой текст — только textContent. Откат — HUB_ON = false (весь раздел) или удалить <script>.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37HubCat) return;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const me = () => { try { return typeof currentUser !== 'undefined' && currentUser ? currentUser : null; } catch (e) { return null; } };
  const prof = () => { try { return typeof currentProfile !== 'undefined' && currentProfile ? currentProfile : null; } catch (e) { return null; } };
  const sb = () => { try { return typeof sbClient !== 'undefined' && sbClient ? sbClient : null; } catch (e) { return null; } };
  const H = () => root.D37Hub || null;
  const href = h => { try { return root.D37Route ? D37Route.toPath(h) : h; } catch (e) { return h; } };
  const num = n => { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' млн' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + ' тыс' : String(n); };

  // ═══ Витрина Денчика (пока игроки ничего не выложили): значок на своём цвете (картинки img/games/*.png — это открытки для соцсетей с текстом, не обложки) ═══
  const SHOW = [
    { id: 'valley', title: 'Долина D37', icon: '🌲', href: '/hub/play', age: 0, tag: 'Новый движок', g: 'linear-gradient(135deg,#14532d,#22c55e)' },
    { id: 'creative', title: 'Творческий режим', icon: '🪐', href: '/hub/creative', age: 0, tag: 'Полёт над планетой', g: 'linear-gradient(135deg,#0b1030,#1e3a8a 60%,#60a5fa)' },
    { id: 'world', title: 'Мир Денчика', icon: '🌍', href: '/play/world', age: 12, tag: 'Онлайн-город', g: 'linear-gradient(135deg,#16a34a,#0d9488)' },
    { id: 'kubomir', title: 'Кубомир', icon: '🧊', href: '/play/kubomir', age: 6, tag: 'Строй из кубиков', g: 'linear-gradient(135deg,#0ea5e9,#4338ca)' },
    { id: 'horde', title: 'Орда', icon: '🧟', href: '/play/horde', age: 12, tag: 'Выживи с друзьями', g: 'linear-gradient(135deg,#7c2d12,#b91c1c)' },
    { id: 'chess', title: 'Шахматы', icon: '♟️', href: '/play/chess', age: 0, tag: 'Онлайн и с ботом', g: 'linear-gradient(135deg,#334155,#6d28d9)' },
    { id: 'words', title: '5 букв', icon: '🔤', href: '/play/words', age: 0, tag: 'Слово дня', g: 'linear-gradient(135deg,#ca8a04,#16a34a)' },
    { id: 'durak', title: 'Дурак', icon: '♠️', href: '/play/durak', age: 0, tag: 'До 4 игроков', g: 'linear-gradient(135deg,#9f1239,#1e293b)' },
  ];
  const KIND = { tpl: 'Аркада', html: 'Своя игра', place: '3D-мир', unity: 'Unity' };
  const GENRES = [['all', 'Все жанры'], ['tpl', '🕹 Аркады'], ['place', '🧱 3D-миры'], ['html', '💻 Свой код'], ['unity', '🎮 Unity']];
  // старше какой метки не показываем: 18+ — никому (взрослого мира нет), 16+ — только тем, кто сам указал 16 лет и больше
  const ageMax = () => { let g = 'unknown'; try { g = root.D37Age ? D37Age.group() : 'unknown'; } catch (e) {} return g === 'teen16' || g === 'adult' ? 16 : 12; };

  // ═══ Игры игроков с сервера (ugc.sql, unity.sql; RLS и так отдаёт гостю только public) — кэш на минуту ═══
  let cache = null, cacheAt = 0, inflight = null;
  async function load(){
    if (cache && Date.now() - cacheAt < 60000) return cache;
    if (inflight) return inflight;
    const c = sb();
    if (!c) return [];
    inflight = (async () => {
      const out = [];
      const pull = async (table, cols, kindOf, play) => {
        try {
          const { data, error } = await c.from(table).select(cols).eq('status', 'public').order('plays', { ascending: false }).limit(60);
          if (error || !Array.isArray(data)) return;
          for (const g of data) out.push({ id: String(g.id), title: String(g.title || '').slice(0, 60), icon: String(g.icon || '🎮').slice(0, 16), kind: kindOf(g),
            plays: +g.plays || 0, likes: +g.likes || 0, at: Date.parse(g.updated_at || g.created_at) || 0, age: g.age_rating == null ? null : +g.age_rating,
            by: String(g.profiles && g.profiles.nick || 'игрок').slice(0, 40), href: href(play(g)) });
        } catch (e) {}
      };
      await Promise.all([
        pull('ugc_games', 'id,title,icon,kind,plays,likes,created_at,updated_at,age_rating,profiles(nick)', g => (KIND[g.kind] ? g.kind : 'tpl'),
          g => g.kind === 'place' ? '#/games/studio3d/play/' + encodeURIComponent(g.id) : '#/games/studio/play/' + encodeURIComponent(g.id)),
        pull('unity_games', 'id,title,icon,plays,likes,created_at,updated_at,profiles(nick)', () => 'unity', g => '#/games/unity/play/' + encodeURIComponent(g.id)),
      ]);
      const max = ageMax();
      cache = out.filter(g => g.title.length >= 2 && (g.age == null || g.age <= max));
      cacheAt = Date.now();
      return cache;
    })().finally(() => { inflight = null; });
    return inflight;
  }

  // ═══ Карточки ═══
  function ageBadge(a){ return a == null ? null : el('i', 'hc-age', a + '+'); }
  function card(g, own){
    const a = el('a', 'hc-card'); a.href = g.href; a.dataset.game = g.id;
    const cov = el('span', 'hc-cov');
    if (g.img) { const im = el('img'); im.src = g.img; im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; cov.appendChild(im); }
    else { cov.appendChild(el('span', 'hc-emo', g.icon)); cov.style.background = g.g || grad(g.id); }
    const b = ageBadge(g.age); if (b) cov.appendChild(b);
    a.appendChild(cov);
    a.appendChild(el('b', 'hc-tt', g.title));
    a.appendChild(el('span', 'hc-by', own ? 'от Денчика · ' + g.tag : (KIND[g.kind] || 'Игра') + ' · ' + g.by));
    if (!own) a.appendChild(el('span', 'hc-st', '▶ ' + num(g.plays) + '  ♥ ' + num(g.likes)));
    a.appendChild(el('span', 'hc-play', 'Играть'));
    return a;
  }
  // цвет обложки из id (у игр игроков нет картинок — значок на своём цвете)
  function grad(id){ let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const a = h % 360; return `linear-gradient(135deg,hsl(${a} 70% 42%),hsl(${(a + 50) % 360} 75% 30%))`; }
  function makeCard(first){
    const a = el('div', 'hc-card hc-make');
    a.appendChild(el('span', 'hc-emo', '🛠️'));
    a.appendChild(el('b', 'hc-tt', first ? 'Сделай первую игру' : 'Создать свою'));
    a.appendChild(el('span', 'hc-by', first ? 'Игр игроков ещё нет — твоя будет первой здесь' : 'Игра за 5 минут или свой 3D-мир'));
    const r = el('span', 'hc-mk');
    const g = el('a', 'hc-mkb', '🕹 Игра'); g.href = href('#/games/studio');
    const w = el('a', 'hc-mkb', '🧱 3D-мир'); w.href = '/play/studio3d';
    r.append(g, w); a.appendChild(r);
    return a;
  }

  // ═══ Строка на /hub ═══
  async function row(wrap){
    const sec = el('section', 'hc-sec'); sec.dataset.row = 'people';
    const head = el('div', 'hc-head');
    head.appendChild(el('h2', 'hc-h', 'Игры игроков'));
    const all = el('a', 'hc-all', 'Все →'); all.href = '/hub/games';
    head.appendChild(all);
    sec.appendChild(head);
    const sub = el('p', 'hc-sub', 'Загружаем…');
    sec.appendChild(sub);
    const strip = el('div', 'hc-strip');
    sec.appendChild(strip);
    wrap.appendChild(sec);
    const list = await load();
    strip.textContent = '';
    if (list.length) {
      sub.textContent = 'Игры и миры, которые сделали игроки сайта. Прошли проверку модератора.';
      for (const g of list.slice(0, 12)) strip.appendChild(card(g, false));
      strip.appendChild(makeCard(false));
    } else {
      sub.textContent = 'Здесь будут игры и миры, которые сделают игроки. Пока никто не выложил — стань первым! А пока — игры от Денчика:';
      strip.appendChild(makeCard(true));
      for (const g of SHOW) strip.appendChild(card(g, true));
    }
    sec.dataset.count = String(list.length);
  }

  // ═══ «Все» — /hub/games ═══
  const F = { sort: 'top', genre: 'all' };
  async function page(box){
    if (!box) return;
    box.textContent = '';
    const wrap = el('div', 'hub wrap');
    const back = el('a', 'hc-back', '← Меню'); back.href = '/hub';
    wrap.appendChild(back);
    wrap.appendChild(el('h1', 'hub-h1', 'Игры игроков'));
    wrap.appendChild(el('p', 'hub-lead', 'Всё, что сделали игроки в «Студии игр», «Студии 3D» и в Unity. Каждая игра прошла проверку модератора.'));
    const bar = el('div', 'hc-filt');
    const chips = (list, key) => list.map(([v, t]) => { const b = el('button', 'hc-chip' + (F[key] === v ? ' on' : ''), t); b.type = 'button'; b.dataset[key] = v; b.addEventListener('click', () => { F[key] = v; draw(); }); return b; });
    const grid = el('div', 'hc-grid');
    wrap.append(bar, grid);
    box.appendChild(wrap);
    const list = await load();
    function draw(){
      bar.textContent = '';
      bar.append(...chips([['top', '🔥 Популярные'], ['new', '🆕 Новые']], 'sort'), el('span', 'hc-sep'), ...chips(GENRES, 'genre'));
      grid.textContent = '';
      let l = list.filter(g => F.genre === 'all' || g.kind === F.genre);
      l = l.slice().sort((a, b) => F.sort === 'new' ? b.at - a.at : b.plays - a.plays || b.likes - a.likes);
      for (const g of l) grid.appendChild(card(g, false));
      grid.appendChild(makeCard(!list.length));
      if (!l.length) grid.prepend(el('p', 'hc-empty', list.length ? 'В этом жанре пока пусто.' : 'Игроки ещё не выложили ни одной игры. Сделай первую — она появится здесь после проверки.'));
      if (!list.length) {
        const own = el('div', 'hc-sec');
        own.appendChild(el('h2', 'hc-h', 'Пока — игры от Денчика'));
        const s = el('div', 'hc-grid');
        for (const g of SHOW) s.appendChild(card(g, true));
        own.appendChild(s);
        grid.after(own);
        wrap.querySelectorAll('.hc-sec').forEach((x, i, all) => { if (i < all.length - 1) x.remove(); });
      }
    }
    draw();
  }

  // ═══ «Кто ты в игре»: персонаж, мир, друзья онлайн ═══
  const BODY = { girl: ['👧', 'девочка'], boy: ['👦', 'мальчик'], mannequin: ['🧍', 'манекен'] };
  const when = t => { try { return new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  async function meCard(wrap){
    const h = H(), u = me(), p = prof();
    const look = h ? h.lookNow() : { body: 'girl', text: '' };
    const box = el('div', 'hc-me');
    // персонаж: тело и первые цвета образа
    const av = el('a', 'hc-av'); av.href = '/hub/wardrobe'; av.title = 'Гардероб'; av.setAttribute('aria-label', 'Гардероб');
    av.appendChild(el('span', 'hc-av-b', (BODY[look.body] || BODY.girl)[0]));
    const sw = el('span', 'hc-sw');
    const re = new RegExp('(?:^|,)' + (BODY[look.body] ? look.body : 'girl') + '\\.[a-z_]+:([0-9a-f]{6})', 'g');
    let m, k = 0; while ((m = re.exec(look.text)) && k++ < 5) { const d = el('i'); d.style.background = '#' + m[1]; sw.appendChild(d); }
    av.appendChild(sw);
    box.appendChild(av);
    const tx = el('div', 'hc-me-tx');
    const who = el('div', 'hc-who');
    who.append('Ты играешь как ', el('b', '', String(u ? (p && p.nick || 'игрок') : 'Гость').slice(0, 40)), ' · ' + (BODY[look.body] || BODY.girl)[1]);
    tx.appendChild(who);
    const wl = el('div', 'hc-worlds'); tx.appendChild(wl);
    const fr = el('div', 'hc-fr'); tx.appendChild(fr);
    box.appendChild(tx);
    const acts = el('div', 'hc-acts');
    const w = el('a', 'hub-btn hub-btn3', '👕 Гардероб'); w.href = '/hub/wardrobe';
    const inv = el('button', 'hub-btn hub-btn3', '📍 Позвать друга'); inv.type = 'button'; inv.dataset.act = 'invite';
    inv.addEventListener('click', e => { if (h) h.invite(e); });
    acts.append(w, inv);
    if (!u) { const b = el('button', 'hub-btn', 'Войти'); b.type = 'button'; b.addEventListener('click', () => { try { root.openGlobalAuth && root.openGlobalAuth(); } catch (e) {} }); acts.appendChild(b); }
    box.appendChild(acts);
    wrap.appendChild(box);
    // миры: главный и творческий (браузер; копия в облаке — у вошедших)
    const fm = h && h.fmtMin ? h.fmtMin : s => Math.round((+s || 0) / 60) + ' мин';
    const world = async (key, name, go) => {
      const r = h ? await h._idb.get(key).catch(() => null) : null;
      const line = el('div', 'hc-wl');
      const has = r && r.bytes && r.bytes.length;
      line.append(el('b', '', name + ': '), has ? fm(r.gt) + ' в игре · сохранён ' + when(r.at) + (r.cloud && r.cloud.on && !r.cloud.dirty ? ' · ☁️ в облаке' : ' · в этом браузере') : 'ещё не начат');
      const a = el('a', 'hc-go', has ? '▶ Продолжить' : '▶ Начать'); a.href = go;
      line.appendChild(a);
      return line;
    };
    wl.append(await world('planet', '🌲 Твой мир', '/hub/play'), await world('creative', '🪐 Творческий', '/hub/creative'));
    friends(fr);
  }
  async function friends(box){
    box.textContent = '';
    const u = me(), c = sb();
    box.appendChild(el('b', '', '👥 Друзья онлайн: '));
    if (!u || !c) { box.append('войди — увидишь, кто из друзей сейчас на сайте'); return; }
    let ids = [];
    try {
      const { data } = await c.from('friendships').select('requester_id,addressee_id,status').eq('status', 'accepted').or(`requester_id.eq.${u.id},addressee_id.eq.${u.id}`);
      ids = (data || []).map(r => r.requester_id === u.id ? r.addressee_id : r.requester_id);
    } catch (e) {}
    if (!ids.length) { box.append('друзей пока нет — позови кого-нибудь ссылкой'); return; }
    let on = [];
    try { on = ((root.D37Chat && D37Chat.online && D37Chat.online()) || { users: [] }).users || []; } catch (e) {}
    const set = new Set(ids), here = on.filter(x => x && set.has(x.id));
    if (!here.length) { box.append('сейчас никого (друзей: ' + ids.length + ')'); return; }
    for (const f of here.slice(0, 8)) box.appendChild(el('span', 'hc-fon', String(f.nick || 'друг').slice(0, 40)));
    if (here.length > 8) box.append(' +' + (here.length - 8));
  }

  root.D37HubCat = { row, page, me: wrap => { meCard(wrap).catch(() => {}); }, load, SHOW, _reset(){ cache = null; cacheAt = 0; } };
})();
