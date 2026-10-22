// ═══════════════════════════════════════
//  «ПУТЬ КЛЕТКИ» — режим «Клеточек»: стадия микроба «Вселенной Денчика» (T-056, docs/plans/universe-path.md §1.2)
// ═══════════════════════════════════════
// Обычная арена остаётся как была (те же комнаты pub1…, ключи kletochki / kletochki_online). Здесь — свой род:
//  • «🧬 Мой род» — стадии (Клетка → Органоиды → Колония → Готов к суше → На суше), что нужно до следующей, ДНК (сегодня / лимит дня,
//    «отдохнувший» ×2), задание дня, родина рода (свет и время года), микро-биомы: 💧 Лужа · 🪸 Риф · 🌑 Глубина (открываются вехами).
//  • «🧬 Эволюция» — 6 мест на мембране: части за ДНК (цена, места, с какой стадии — D37Evo.CELL), форма колонии, раскраска; облик
//    действует со следующей жизни (между жизнями и раундами).
//  • Игра — тот же мир «Клеточек» с настройками биома (D37Evo.worldCfg): свет дня и ночи у родины, минералы и гиганты Глубины, колония
//    (клетки держатся вместе), ДНК жизни: сахар (точки и свет), белок (съеденные клетки), минералы, цель жизни. Комнаты пути — свои
//    (kletochki-evo-io-<биом><N>, друзья — kletochki-evo-io-<буква биома><код>): биомы не смешиваются. Жизнь — билет сервера
//    (evo_act start → life): ДНК считает сервер, по своим часам и лимитам.
//  • «📖 Микромир» — кого встретил род; «🌱 На сушу» — план тела и питание (шаблон стадии «Существо»), переход «Прошли миллионы лет».
// Подключение: kletochki.js зовёт KletochkiPath(HOOK) при открытии игры (HOOK — экран, сеанс, рисунок). Числа — только D37Evo (evo.js).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.KletochkiPath) return;
  const TAU = Math.PI * 2;
  const BG = { pool: '#0b1d2b', reef: '#13212d', deep: '#04060e' };
  const BCOL = { pool: '#38bdf8', reef: '#fb7185', deep: '#818cf8' };
  const BL = { p: 'pool', r: 'reef', d: 'deep' };   // первая буква комнаты друга → биом
  const TITLE = 'Клеточки — Путь клетки';
  // где рисовать части ботов (место на мембране: 0 — нос, дальше по кругу)
  const PREF = { jaw: 0, eye: 1, photo: 5, flagellum: 3, cilia: 2, leaf: 2, spikes: 4, armour: 1, toxin: 3, adhesion: 4 };
  let GLOW = null;   // спрайт пятна света (один на страницу)
  function glowSprite(){
    if (GLOW || typeof document === 'undefined') return GLOW;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.55, 'rgba(255,255,255,.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return (GLOW = c);
  }
  const fmtT = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const clone = o => JSON.parse(JSON.stringify(o));

  root.KletochkiPath = function(H){
    const E = root.D37Evo, K = H.K;
    if (!E || !K) return null;
    const A = E.api;
    // свои экранировщик и числа (xss-scan видит, что они безопасны): чужой текст и подписи — только через esc
    const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    const num = n => Math.round(+n || 0).toLocaleString('ru');
    css();
    let screen = '', backTo = '', draft = null, sel = -1, land = { plan: '', diet: '' }, nameEdit = null, adL = null, transT = 0, koCard = '';
    const toast = t => { try { H.api?.toast?.(t); } catch (e) {} };
    const offState = A.on('state', () => { if (screen === 'hub') hub(); else if (screen === 'evo') renderEditor(); else if (screen === 'book') book(); else if (screen === 'land') landScreen(); });

    // ═══ Меню «Клеточек»: кнопка пути ═══
    function menuButton(box){
      if (!box || box.querySelector('[data-io="evhub"]')) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ct-start kp-go'; b.dataset.io = 'evhub';
      b.innerHTML = '🧬 Путь клетки <small>от микроба — к суше и дальше</small>';
      box.prepend(b);
    }
    // #/games/kletochki/evo[/<код друга>]
    function route(rest){
      const code = String(rest || '');
      if (code && root.GameRoom?.validCode(code) && BL[code[0]]) { A.init().then(() => play(BL[code[0]], 'room', code)); return; }
      hub();
    }

    // ═══ «🧬 Мой род» ═══
    function hub(){
      screen = 'hub';
      if (!A.st) { H.showOv('<div class="io-card"><div class="io-logo">🧬</div><div class="io-sub">Загружаем род…</div></div>', 'kp'); A.init(); return; }
      H.showOv(hubHtml(), 'kp');
      paintCell(H.ui.ov.querySelector('.kp-cell'), A.st.design, -Math.PI / 2);
    }
    const stageName = i => E.STAGES[i] ? `${E.STAGES[i].e} ${E.STAGES[i].n}` : '';
    function homeLine(st){   // текст (экранируется там, где вставляется)
      const h = E.HOMES.find(x => x.id === st.home?.id) || E.HOMES[0], ms = Date.now(), L = E.light, s = L.season(ms);
      return `🏝 Родина: ${h.n} · ${L.isNight(ms) ? '🌙 ночь' : '☀️ день'} · ${L.SEASON_E[s]} ${L.SEASON_N[s]}`;
    }
    function hubHtml(){
      const st = A.st, D = A.D, now = A.clock();
      const today = E.Rules.todayOf(st, now), rest = E.Rules.restLeft(D, st, now), cap = D.caps.day;
      const T = E.TASKS[E.Rules.taskOf(now)], tdone = st.tday === E.Rules.dayOf(now);
      const note = A.mode === 'server' ? '' : A.why === 'nosql' ? '🧪 Сохранение рода на сервере появится, когда сайт обновится. Пока — пробный род, только в этом браузере.'
        : A.why === 'net' ? '📡 Нет связи с сервером — пока пробный род в этом браузере.' : '🧪 Пробный род — только в этом браузере. Войди, чтобы род сохранился (перенесётся до стадии «Колония»).';
      const track = [1, 2, 3, 4, 5].map(i => `<span class="${st.stage > i ? 'done' : st.stage === i ? 'on' : ''}"><b>${esc(E.STAGES[i].e)}</b><small>${esc(E.STAGES[i].n)}</small></span>`).join('<i></i>');
      const needs = E.nextNeeds(D, st);
      const needH = needs.length ? `<div class="kp-sec"><div class="kp-h">До стадии «${esc(E.STAGES[st.stage + 1].n)}»</div><ul class="kp-needs">${needs.map(n => `<li class="${n.ok ? 'ok' : ''}">${n.ok ? '✅' : '⬜'} ${esc(n.t)}${!n.ok && n.need > 1 ? ` <b>${num(Math.min(n.v, n.need))}/${num(n.need)}</b>` : ''}</li>`).join('')}</ul></div>` : '';
      const landH = st.stage === 4 ? `<div class="kp-land"><b>🌊 Род готов выйти на сушу!</b><span>Выбери план тела и питание — с них начнётся существо.</span><button type="button" class="ct-start" data-io="evland">🌱 На сушу</button></div>`
        : st.stage === 5 ? `<div class="kp-land done"><b>🌱 Род на суше: ${esc(E.PLANS[st.plan]?.e || '')} ${esc(E.PLANS[st.plan]?.n || '')}, ${esc(E.DIETS[st.diet]?.n || '')}</b><span>Стадия «Существо» — скоро. А клетку можно развивать дальше: рекорды и Микромир ждут.</span></div>` : '';
      const offer = A.offer ? `<div class="kp-imp"><b>🧪 Перенести пробный род в аккаунт?</b><span>ДНК ${num(A.offer.dna)}, частей ${num(E.Rules.partsOwned(A.offer))}. Переносится до стадии «Колония».</span><div class="kp-row"><button type="button" class="ct-start" data-io="evimp">Перенести</button><button type="button" class="io-b2" data-io="evimpno">Не надо</button></div></div>` : '';
      const name = nameEdit ? `<div class="kp-nm"><select data-io="evna">${E.NAME_A.map((w, i) => `<option value="${i}"${i === nameEdit.a ? ' selected' : ''}>${esc(w)}</option>`).join('')}</select>
          <select data-io="evnb">${E.NAME_B.map((w, i) => `<option value="${i}"${i === nameEdit.b ? ' selected' : ''}>${esc(w)}</option>`).join('')}</select>
          <button type="button" class="io-b2 io-sm" data-io="evnrnd" title="Случайно">🎲</button><button type="button" class="ct-start io-sm" data-io="evnsave">✓</button></div>`
        : `<div class="kp-name">Род «${esc(E.lineageName(st))}» <button type="button" class="kp-ib" data-io="evname" title="Имя рода" aria-label="Имя рода">✏️</button></div>`;
      const bio = E.BIOME_IDS.map(b => {
        const B = E.BIOMES[b], open = st.stage >= B.at, been = st.biomes.includes(b);
        return `<div class="kp-bio${open ? '' : ' off'}" style="--kb:${BCOL[b]}"><div class="kp-bt"><b>${esc(B.e)} ${esc(B.n)}</b>${been ? ' <i title="Род тут был">✓</i>' : ''}</div>
          <div class="kp-bd">${esc(open ? B.d : `🔒 Откроется на стадии «${E.STAGES[B.at].n}»`)}</div>
          ${open ? `<div class="kp-bb"><button type="button" class="ct-start" data-io="evplay" data-b="${esc(b)}" data-m="pub">▶ Плыть</button><button type="button" class="io-b2 io-sm" data-io="evplay" data-b="${esc(b)}" data-m="bots" title="С ботами, без интернета" aria-label="С ботами">🤖</button><button type="button" class="io-b2 io-sm" data-io="evplay" data-b="${esc(b)}" data-m="friend" title="С другом по ссылке" aria-label="С другом">🔗</button></div>` : ''}</div>`;
      }).join('');
      const r = st.rec;
      return `<div class="io-card wide kp-hub">
        <div class="kp-head"><canvas class="kp-cell" width="120" height="120"></canvas><div class="kp-hi">${name}
          <div class="kp-stg">${esc(stageName(st.stage))} <small>· стадия ${Math.min(st.stage, 4)} из 4</small></div><div class="kp-home">${esc(homeLine(st))}</div></div></div>
        ${offer}${note ? `<div class="kp-note">${esc(note)}</div>` : ''}
        <div class="kp-track">${track}</div>
        ${landH}${needH}
        <div class="kp-dna"><div><b>🧬 ${num(st.dna)}</b> ДНК <small>· всего получено ${num(st.earned)}</small></div>
          <div class="kp-bar" title="ДНК сегодня"><i style="width:${Math.round(Math.min(1, today / Math.max(1, cap)) * 100)}%"></i><span>сегодня ${num(today)} / ${num(cap)}</span></div>
          ${rest > 0 ? `<div class="kp-rest">😴 Отдохнувший: ещё ${num(rest)} ДНК пойдут ×2</div>` : today >= cap ? '<div class="kp-rest">🌙 На сегодня ДНК всё — завтра будет ещё. Играть можно: рекорды и Микромир копятся.</div>' : ''}</div>
        <div class="kp-task${tdone ? ' ok' : ''}">📅 Задание дня: ${esc(T.n)} <b>${tdone ? '✅ сделано' : `+${num(D.caps.task)} 🧬`}</b></div>
        <div class="kp-bios">${bio}</div>
        <div class="kp-rec">🏆 Рекорды рода: масса ${num(r.mass)} · жизнь ${fmtT(r.life)} · съедено ${num(r.kills)} · жизней ${num(r.lives)}</div>
        <div class="kp-row kp-main"><button type="button" class="ct-start" data-io="evedit">🧬 Эволюция</button><button type="button" class="io-b2" data-io="evbook">📖 Микромир ${st.finds.length}/${E.MICRO_IDS.length}</button><button type="button" class="io-b2" data-io="menu">🏠 Меню</button></div>
        <div class="io-cd">Ценное считает сервер: ДНК, стадии и «На сушу». Части — только за ДНК, без денег.</div>
      </div>`;
    }

    // ═══ «🧬 Эволюция»: 6 мест на мембране, части, форма колонии, раскраска ═══
    function editor(from){
      backTo = from || 'hub';
      screen = 'evo';
      draft = clone(A.st.design); sel = -1;
      renderEditor();
    }
    // свойства облика для подписи (как bodyStats в kletochki.js)
    function statsOf(d){
      const st = { speed: 1, view: 1, eat: 1.25, turn: 1, dark: 0, glow: 0, leaf: 0, adh: 0, def: 0, toxin: 0, spikes: 0, sugar: 1, prot: 1 };
      for (const id of E.placed(d)) {
        const p = E.CELL[id].sim || {};
        for (const k of ['speed', 'view', 'eat', 'turn', 'sugar', 'prot']) if (p[k]) st[k] *= p[k];
        for (const k of ['dark', 'glow', 'leaf', 'adh']) if (p[k]) st[k] += p[k];
        for (const k of ['def', 'toxin', 'spikes']) if (p[k]) st[k] = 1;
      }
      return st;
    }
    const usedOf = (d, id) => d.s.filter(x => x === id).length;
    function evoHtml(){
      const st = A.st, D = A.D, own = st.owned, d = draft, sc = statsOf(d), col = E.capacity(d);
      const ring = d.s.map((id, k) => {
        const a = -Math.PI / 2 + k * TAU / 6, x = 50 + Math.cos(a) * 43, y = 50 + Math.sin(a) * 43;
        const P = id && id !== '=' ? E.CELL[id] : null;
        return `<button type="button" class="kp-slot${sel === k ? ' sel' : ''}${id === '=' ? ' cont' : ''}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%" data-io="evslot" data-k="${k}" aria-label="Место ${k + 1}${P ? ': ' + esc(P.n) : ''}">${esc(P ? P.e : id === '=' ? '·' : '+')}</button>`;
      }).join('');
      const bar = (v, lo, hi) => `<i style="width:${Math.round(Math.max(.06, Math.min(1, (v - lo) / (hi - lo))) * 100)}%"></i>`;
      const special = [sc.spikes && '📌 колючки не рвут', sc.def && '🛡 панцирь', sc.toxin && '☁️ облачко', sc.leaf && `🌿 сахар от света ×${sc.leaf}`, sc.glow && `✨ свет ×${sc.glow}`, sc.prot > 1 && '🦷 белка больше'].filter(Boolean);
      let pick = '';
      if (sel >= 0) {
        const cur = d.s[sel];
        const opts = E.PART_IDS.filter(id => E.CELL[id].slots > 0 && (own[id] | 0) > usedOf(d, id) - (cur === id ? 1 : 0)).map(id => {
          const P = E.CELL[id];
          return `<button type="button" class="kp-opt" data-io="evput" data-id="${esc(id)}"><b>${esc(P.e)}</b>${esc(P.n)}${P.slots > 1 ? ' <small>(2 места)</small>' : ''}</button>`;
        }).join('');
        pick = `<div class="kp-pick"><div class="kp-h">Место ${sel + 1}: что поставить</div>${opts || '<div class="kp-mut">Свободных купленных частей нет — купи ниже ⬇</div>'}
          ${cur ? '<button type="button" class="kp-opt del" data-io="evdel">✖ Убрать</button>' : ''}</div>`;
      }
      const forms = own.adhesion ? `<div class="kp-sec"><div class="kp-h">Форма колонии</div><div class="kp-forms">${E.FORM_IDS.map(f => { const F = E.FORMS[f]; return `<button type="button" class="kp-chip${d.f === f ? ' sel' : ''}" data-io="evform" data-v="${esc(f)}"><b>${esc(F.e)} ${esc(F.n)}</b><small>${esc(F.d)}</small></button>`; }).join('')}</div></div>` : '';
      const shop = E.PART_IDS.map(id => {
        const P = E.CELL[id], n = own[id] | 0, can = st.stage >= P.at, full = n >= P.max, cheap = st.dna >= P.cost;
        const btn = full ? '<span class="kp-own">✓ есть</span>' : !can ? `<span class="kp-lock">🔒 ${esc(E.STAGES[P.at].n)}</span>` : `<button type="button" class="${cheap ? 'ct-start' : 'io-b2'} io-sm" data-io="evbuy" data-id="${esc(id)}"${cheap ? '' : ' disabled'}>${num(P.cost)} 🧬</button>`;
        return `<div class="kp-part${full ? ' full' : ''}"><b class="kp-pe">${esc(P.e)}</b><div><div class="kp-pn">${esc(P.n)}${P.max > 1 ? ` <small>${num(n)}/${num(P.max)}</small>` : ''}${P.slots > 1 ? ' <small>· 2 места</small>' : P.slots === 0 ? ' <small>· без места</small>' : ''}</div><div class="kp-pd">${esc(P.d)}</div></div>${btn}</div>`;
      }).join('');
      const pig = (own.pigment | 0) > 0, pats = pig ? H.PATTERNS_X : H.PATTERNS;
      const changed = JSON.stringify(d) !== JSON.stringify(st.design), bad = E.designWhy(d, own);
      return `<div class="io-card wide kp-evo">
        <div class="kp-top"><div class="io-title" style="font-size:1.3rem">🧬 Эволюция</div><div class="kp-dnab">🧬 <b>${num(st.dna)}</b></div></div>
        <div class="kp-ringw"><div class="kp-ring"><canvas class="kp-ecell" width="220" height="220"></canvas>${ring}</div>
          <div class="kp-st"><div>Скорость <span class="kp-sb">${bar(sc.speed, .7, 1.3)}</span></div><div>Обзор <span class="kp-sb">${bar(sc.view, .9, 1.4)}</span></div>
            <div>Ест клетки <span class="kp-sb">${bar(1.3 - sc.eat, 0, .25)}</span></div><div>Поворот <span class="kp-sb">${bar(sc.turn, 1, 1.7)}</span></div>
            <div>В темноте <span class="kp-sb">${bar(sc.dark, 0, .9)}</span></div><div><span>Колония</span><span><b>${num(col)}</b> ${col > 1 ? 'клеток' : '(нужна 🧲)'}</span></div>
            ${special.length ? `<div class="kp-mut">${esc(special.join(' · '))}</div>` : ''}</div></div>
        <div class="kp-mut">Нажми на место у мембраны и поставь купленную часть. Облик — со следующей жизни.</div>
        ${pick}${forms}
        <div class="kp-sec"><div class="kp-h">Части за ДНК</div><div class="kp-parts">${shop}</div></div>
        <div class="kp-sec"><div class="kp-h">Раскраска</div><div class="kp-skins">${H.PRESETS.map((q, k) => `<button type="button" data-io="evsk" data-k="${k}" aria-label="Раскраска ${k + 1}"><canvas width="48" height="48"></canvas></button>`).join('')}</div>
          <div class="io-cols"><label>Узор <select data-io="evpat">${pats.map((p, k) => `<option value="${k}"${d.k.p === k ? ' selected' : ''}>${esc(p)}${k >= 8 ? ' 🎨' : ''}</option>`).join('')}</select></label>
            <label>Цвет <input type="color" data-io="evca" value="${esc(d.k.a)}"></label><label>Второй <input type="color" data-io="evcb" value="${esc(d.k.b)}"></label></div></div>
        <div class="kp-row kp-main"><button type="button" class="ct-start" data-io="evsave"${changed && !bad ? '' : ' disabled'}>💾 Сохранить</button><button type="button" class="io-b2" data-io="evback">← Назад</button></div>
      </div>`;
    }
    function renderEditor(){
      if (screen !== 'evo' || !draft) return;
      const ov = H.ui.ov, top = ov.scrollTop;
      H.showOv(evoHtml(), 'kp');
      ov.scrollTop = top;
      paintCell(ov.querySelector('.kp-ecell'), draft, -Math.PI / 2);
      ov.querySelectorAll('[data-io="evsk"]').forEach((b, k) => { const q = H.PRESETS[k], c = b.querySelector('canvas').getContext('2d'); H.drawCell(c, 24, 24, 19, { p: q[0], a: q[1], b: q[2] }, k, 0, 1, 0, 1); });
      const on = (q, f) => ov.querySelector(q)?.addEventListener('change', f);
      on('[data-io="evpat"]', e => { draft.k = { ...draft.k, p: +e.target.value | 0 }; renderEditor(); });
      on('[data-io="evca"]', e => { if (K.okColor(e.target.value)) { draft.k = { ...draft.k, a: e.target.value.toLowerCase() }; renderEditor(); } });
      on('[data-io="evcb"]', e => { if (K.okColor(e.target.value)) { draft.k = { ...draft.k, b: e.target.value.toLowerCase() }; renderEditor(); } });
    }
    // поставить часть id на место sel (часть на 2 места занимает и следующее)
    function clearSlot(d, k){
      const id = d.s[k];
      if (id === '=') { const p = (k + 5) % 6; d.s[p] = ''; d.s[k] = ''; return; }
      if (id && E.CELL[id]?.slots > 1) for (let j = 0; j < E.CELL[id].slots; j++) d.s[(k + j) % 6] = '';
      else d.s[k] = '';
    }
    function put(id){
      const P = E.CELL[id]; if (!P || sel < 0) return;
      clearSlot(draft, sel);
      for (let j = 1; j < P.slots; j++) clearSlot(draft, (sel + j) % 6);
      draft.s[sel] = id;
      for (let j = 1; j < P.slots; j++) draft.s[(sel + j) % 6] = '=';
      sel = -1;
    }
    async function save(){
      const d = clone(draft), r = await A.act('design', { d });
      if (!r.ok) { toast('⚠️ ' + E.why(r)); return; }
      toast('🧬 Облик рода сохранён — со следующей жизни');
      H.S?.setMe?.({ design: E.designCode(d), skin: d.k });
      goBack();
    }
    function goBack(){
      draft = null; sel = -1;
      if (backTo === 'ko' && koCard) { screen = 'ko'; H.showOv(koCard, 'ko'); return; }
      if (backTo === 'game') { screen = ''; H.hideOv(); return; }
      hub();
    }

    // ═══ «📖 Микромир» ═══
    function book(){
      screen = 'book';
      const st = A.st;
      const cards = E.MICRO_IDS.map(id => {
        const M = E.MICRO[id], f = st.finds.includes(id), B = E.BIOMES[M.b];
        return `<div class="kp-mc${f ? '' : ' off'}"><b>${esc(f ? M.e : '❓')}</b><div><div class="kp-pn">${esc(f ? M.n : '???')}</div><div class="kp-pd">${esc(f ? M.d : `Живёт: ${B ? B.e + ' ' + B.n : 'везде'}`)}</div></div></div>`;
      }).join('');
      H.showOv(`<div class="io-card wide kp-book"><div class="io-title" style="font-size:1.3rem">📖 Микромир</div>
        <div class="io-sub">Кого встретил твой род: ${st.finds.length} из ${E.MICRO_IDS.length}. Плавай в разных биомах, днём и ночью.</div>
        <div class="kp-mcs">${cards}</div><div class="kp-row kp-main"><button type="button" class="io-b2" data-io="evhub">← Мой род</button></div></div>`, 'kp');
    }

    // ═══ «🌱 На сушу» ═══
    function landScreen(){
      screen = 'land';
      const st = A.st, own = st.owned;
      if (!land.diet) land.diet = own.jaw && !own.leaf ? 'meat' : own.leaf && !own.jaw ? 'plant' : 'both';
      const plans = Object.keys(E.PLANS).map(p => { const P = E.PLANS[p]; return `<button type="button" class="kp-chip big${land.plan === p ? ' sel' : ''}" data-io="evplan" data-v="${esc(p)}"><b>${esc(P.e)} ${esc(P.n)}</b><small>${esc(P.d)}</small></button>`; }).join('');
      const diets = Object.keys(E.DIETS).map(p => { const P = E.DIETS[p]; return `<button type="button" class="kp-chip${land.diet === p ? ' sel' : ''}" data-io="evdiet" data-v="${esc(p)}"><b>${esc(P.e)} ${esc(P.n)}</b></button>`; }).join('');
      H.showOv(`<div class="io-card wide kp-landc"><div class="io-logo">🌊</div><div class="io-title" style="font-size:1.35rem">Выйти на сушу</div>
        <div class="io-sub">Колония твоего рода стала одним телом. С чего начнёт существо на берегу? Части клетки тоже пригодятся: глазки, зубы, шипы, свет.</div>
        <div class="kp-h">План тела</div><div class="kp-forms">${plans}</div><div class="kp-h">Питание</div><div class="kp-forms row">${diets}</div>
        <div class="kp-row kp-main"><button type="button" class="ct-start" data-io="evgo"${land.plan ? '' : ' disabled'}>🌱 Выйти на сушу</button><button type="button" class="io-b2" data-io="evhub">← Назад</button></div>
        <div class="io-cd">Выбирается один раз. Клетку можно будет развивать и дальше.</div></div>`, 'kp');
    }
    async function goLand(){
      if (!land.plan) return;
      // «На сушу» — ценное: только с родом на сервере (пробный род переносится не дальше «Колонии»)
      if (A.mode !== 'server') {
        if (A.why === 'guest') { toast('🔑 Войди, чтобы род вышел на сушу — он сохранится в аккаунте'); try { root.openGlobalAuth?.(); } catch (e) {} }
        else toast('⚠️ ' + (A.why === 'nosql' ? E.WHY.nosql : E.WHY.net));
        return;
      }
      const yes = root.GameKit?.ask ? await root.GameKit.ask({ icon: '🌱', title: 'Выйти на сушу?', text: `${E.PLANS[land.plan].n}, ест: ${E.DIETS[land.diet].n.toLowerCase()}. Выбирается один раз.`, yes: 'Да, на сушу', no: 'Подумаю' }) : true;
      if (!yes) return;
      const r = await A.act('land', { plan: land.plan, diet: land.diet });
      if (!r.ok) { toast('⚠️ ' + E.why(r)); return; }
      transition(r);
    }
    // Переход «Прошли миллионы лет…» — естественная пауза (место рекламы загрузки, ad-places.js)
    function transition(r){
      screen = 'trans';
      const st = A.st, t = E.landTemplate(st), P = E.PLANS[st.plan];
      H.showOv(`<div class="kp-tr"><div class="kp-tr-t">Прошли миллионы лет…</div><div class="kp-tr-ad"></div>
        <div class="io-card kp-tr-c" hidden><div class="io-logo">${esc(P?.e || '🌱')}</div><div class="io-title" style="font-size:1.3rem">Род «${esc(E.lineageName(st))}» вышел на сушу!</div>
          <div class="io-sub">${esc(P?.n || '')} · ${esc(E.DIETS[st.diet]?.n || '')} · глаз: ${num(t ? t.body.eyes : 2)}${t?.body.horns ? ' · рожки' : ''}${t?.body.glow ? ' · светится' : ''}${t?.body.armour ? ' · чешуя' : ''}</div>
          <div class="kp-note">Дальше — стадия «Существо»: тело как в редакторе, еда, гнездо, стая, поколения. Она появится на сайте — род её дождётся.${r?.got?.awake ? ' «Пробуждение» уже открыто.' : ''}</div>
          <div class="kp-row kp-main"><button type="button" class="ct-start" data-io="evhub">🧬 Мой род</button></div></div></div>`, 'kp kp-trans');
      try { root.GAME_IMPL?.kletochki && H.api?.sfx?.('win'); } catch (e) {}
      try { adL = root.D37AdPlaces?.loading({ anchor: H.ui.ov.querySelector('.kp-tr-ad'), tip: 'game' }) || null; } catch (e) { adL = null; }
      clearTimeout(transT);
      transT = setTimeout(() => { const c = H.ui?.ov.querySelector('.kp-tr-c'); if (c) c.hidden = false; }, 3800);
    }

    // ═══ Игра в биоме ═══
    async function play(b, how, code){
      await A.init();
      if (!E.BIOMES[b]) b = 'pool';
      screen = '';
      const pv = makePV(b);
      if (how === 'bots') H.startBots(pv);
      else if (how === 'room') H.startOnline(code, false, pv);
      else if (how === 'friend') { const c = b[0] + (root.GameRoom?.newCode?.() || Math.random().toString(36).slice(2, 8)); K.share('kletochki', 'evo/' + c, TITLE, toast); try { location.hash = '#/games/kletochki/evo/' + c; } catch (e) {} }
      else H.startOnline('', true, pv);
      if (pv.locked) toast(`🔒 ${E.BIOMES[b].n}: твой род ещё не дорос — ДНК тут не копится, но играть можно`);
    }
    function makePV(b){
      const st = A.st || E.Rules.fresh(), cfg = E.worldCfg(b);
      const HA = new Float64Array(H.MAXO), PX = new Float64Array(H.MAXO), PY = new Float64Array(H.MAXO), CX = new Float64Array(H.MAXO), CY = new Float64Array(H.MAXO), CM = new Float64Array(H.MAXO);
      const HEART = new Int16Array(H.MAXO), BIG = new Int16Array(H.MAXO), LAY = new Array(H.MAXO).fill(null), GLO = new Uint8Array(H.MAXO);
      const lays = new Map();
      let hl = null, hlTxt = '', known = 0, life = null, last = null, kOv = '';
      for (let i = 0; i < E.MICRO_IDS.length; i++) if (st.finds.includes(E.MICRO_IDS[i])) known |= 1 << i;
      const pv = {
        b, cfg, game: 'kletochki-evo', prefix: b, sim: H.SIM.forEvo(cfg), design: E.designCode(st.design), skin: st.design.k, bg: BG[b],
        light: cfg.lightAt(Date.now()), locked: st.stage < E.BIOMES[b].at, closed: false, lm: null, lx: null,
        again: () => makePV(b),
        busy: () => screen === 'evo' || screen === 'book' || screen === 'hub',
        stop(){ pv.closed = true; hl?.remove(); hl = null; pv.lm = null; pv.lx = null; },
        onKo, onRound, hud, leave, invite, decor, bridges, overlay, minerals,
      };
      // ── жизнь: билет сервера при появлении, отчёт — когда съели, конец раунда или ушёл ──
      function goal(){
        const own = E.placed((A.st || st).design), list = E.GOALS.filter(g => (!g.b || g.b === b) && (g.need !== 'adh' || own.includes('adhesion')));
        return list[Math.floor(Math.random() * list.length)] || E.GOALS[0];
      }
      function lifeStart(){
        life = { on: true, t0: performance.now(), tk: null, best: 0, goal: goal(), req: null };
        if (pv.locked) return;
        const L = life;
        L.req = A.act('start', { b }).then(r => { if (r.ok) L.tk = r.got.n; else if (r.reason === 'locked') pv.locked = true; return r; }, () => null);
      }
      const goalDone = (g, d, sec, best) => g.k === 'pel' ? d.pel >= g.v : g.k === 'life' ? sec >= g.v : g.k === 'mass' ? best >= g.v : g.k === 'kills' ? d.kills >= g.v : g.k === 'col' ? d.col >= g.v : g.k === 'min' ? d.m >= g.v : false;
      const rawOf = (d, g) => (d.s | 0) + (d.p | 0) + 2 * (d.m | 0) + E.CAPS.goal * g;
      function lifeEnd(d, sec, best){
        const L = life;
        if (!L || !L.on) return null;
        L.on = false;
        d = d || { s: 0, p: 0, m: 0, pel: 0, col: 1, seen: 0, kills: 0 };
        const g = goalDone(L.goal, d, sec, best) ? 1 : 0;
        const rep = { s: d.s | 0, p: d.p | 0, m: d.m | 0, g, col: d.col | 0, kills: d.kills | 0, mass: Math.round(best) | 0, life: Math.round(sec) | 0, pel: d.pel | 0,
          seen: E.MICRO_IDS.filter((id, i) => (d.seen >> i) & 1) };
        const raw = rawOf(d, g);
        return (async () => {
          if (pv.locked) return { ok: false, reason: 'locked', raw, g };
          if (L.req) await L.req;
          if (!L.tk) return { ok: false, reason: 'net', raw, g };
          let r = await A.act('life', { n: L.tk, ...rep });
          if (!r.ok && r.reason === 'net') { await new Promise(res => setTimeout(res, 1500)); r = await A.act('life', { n: L.tk, ...rep }); }
          if (r.ok && r.got.up) { toast(`🎉 Новая стадия рода: ${stageName(r.got.up)}!`); try { H.api?.sfx?.('win'); } catch (e) {} }
          return { ...r, raw, g };
        })();
      }
      function gainText(r){
        if (!r) return '';
        if (r.ok) {
          const G = r.got, x = [];
          if (G.bonus) x.push('😴 ×2 отдохнувший');
          if (G.gain < G.raw + G.bonus) x.push('🌙 лимит дня');
          if (G.task) x.push(`📅 задание дня +${G.task}`);
          if (r.g) x.push('🎯 цель жизни');
          return `🧬 <b>+${num(G.gain + G.task)}</b> ДНК в род${x.length ? ' · ' + esc(x.join(' · ')) : ''}`;
        }
        if (r.reason === 'locked') return '🔒 ДНК тут не копится — род ещё не дорос до этого биома';
        if (r.reason === 'nosql' || r.reason === 'net') return `🧬 +${num(r.raw)} ДНК не засчитаны: ${esc(E.why(r))}`;
        return esc(E.why(r));
      }
      function paintGain(p){
        p?.then(r => { const el = H.ui?.ov.querySelector('.kp-gain'); if (el) el.innerHTML = gainText(r); kOv = H.ui?.ov.innerHTML || kOv; koCard = kOv; }, () => {});
      }
      function onKo(e){
        const p = lifeEnd(e.evo, e.life, e.best), by = e.by >= 0 ? H.names[e.by] : '';
        setTimeout(() => {
          if (!H.S || H.mode !== 'play' || !H.koAt || pv.closed) return;
          kOv = `<div class="io-card"><div class="io-logo">😵</div><div class="io-title">Тебя съели!</div>
            ${by ? `<div class="io-sub">${esc(`Тебя съел${H.bots[e.by] ? ' бот' : ''} «${by}»`)}</div>` : ''}
            <div class="io-stats"><div><b>${esc(num(e.best))}</b><small>лучшая масса</small></div><div><b>${esc(String(e.eaten))}</b><small>${esc(K.ru(e.eaten, 'съедена клетка', 'съедено клетки', 'съедено клеток'))}</small></div><div><b>${esc(fmtT(e.life))}</b><small>в игре</small></div></div>
            <div class="kp-gain">🧬 считаем ДНК…</div>
            <div class="io-btns"><button type="button" class="ct-start" data-io="again">▶ Ещё раз</button><button type="button" class="io-b2" data-io="evedit" data-from="ko">🧬 Эволюция</button><button type="button" class="io-b2" data-io="evhub">🧬 Мой род</button></div></div>`;
          koCard = kOv; screen = 'ko';
          H.showOv(kOv, 'ko');
          paintGain(p);
        }, 650);
      }
      function onRound(e, podium){
        if (e.k === 'start') { if (screen === 'ko') screen = ''; return; }
        if (e.k !== 'end') return;
        const S = H.S, mine = e.rank.findIndex(r => r[0] === S.me);
        const p = mine >= 0 && !H.koAt ? lifeEnd(e.evo?.[S.me], e.rank[mine][3], e.rank[mine][2]) : null;
        kOv = podium.replace('<div class="io-btns">', `<div class="kp-gain">${p ? '🧬 считаем ДНК…' : ''}</div><div class="io-btns"><button type="button" class="io-b2" data-io="evedit" data-from="ko">🧬 Эволюция</button>`);
        koCard = kOv; screen = 'ko';
        H.showOv(kOv);
        if (p) paintGain(p);
      }
      function leave(){
        if (!life || !life.on || !last) return;
        lifeEnd(last, (performance.now() - life.t0) / 1000, life.best);
      }
      function invite(){
        const S = H.S;
        if (S && S.code && S.role !== 'off' && !S.pub) { K.share('kletochki', 'evo/' + S.code, TITLE, toast); return; }
        play(b, 'friend');
      }
      // ── HUD: ДНК жизни, свет, колония, цель ──
      function hud(V, guest){
        if (pv.closed || !V) return;
        let d = null, mass = 0;
        if (guest) { if (V.ready) { d = { s: V.dS, p: V.dP, m: V.dM, pel: V.pel, col: V.colMax, colN: V.colN, seen: V.seen, kills: V.kills }; mass = V.mass; } }
        else { const o = V.owners?.[H.S?.me]; if (o) { d = { s: o.dS, p: o.dP, m: o.dM, pel: o.pel, col: o.colMax, colN: o.colN, seen: o.seen, kills: o.eaten }; mass = o.alive ? o.mass : 0; } }
        pv.light = cfg.lightAt(Date.now());
        const sc = statsOf((A.st || st).design);   // как далеко видно в темноте (глазки, фотофоры) — для рисунка темноты
        pv.sight = Math.max(.5, Math.min(1.2, .5 + sc.dark * .7));
        if (!d) return;
        const alive = mass > 0 && V.phase === 0;
        if (alive && (!life || !life.on)) lifeStart();
        if (life && life.on && alive) { if (mass > life.best) life.best = mass; last = d; }
        // новое в «Микромире»
        const fresh = d.seen & ~known;
        if (fresh) { known |= fresh; for (let i = 0; i < E.MICRO_IDS.length; i++) if ((fresh >> i) & 1) { const M = E.MICRO[E.MICRO_IDS[i]]; toast(`📖 Микромир: ${M.e} ${M.n}!`); break; } }
        if (!hl) { const tl = H.ui?.hud.querySelector('.io-tl'); if (!tl) return; hl = document.createElement('div'); hl.className = 'kp-hl'; tl.appendChild(hl); }
        const sec = life ? (performance.now() - life.t0) / 1000 : 0, g = life?.goal;
        const gv = !g ? '' : g.k === 'pel' ? d.pel : g.k === 'life' ? Math.floor(sec) : g.k === 'mass' ? Math.round(life.best) : g.k === 'kills' ? d.kills : g.k === 'col' ? d.col : d.m;
        const gd = g && life && goalDone(g, d, sec, life.best);
        const t = pv.locked ? `🔒 ${E.BIOMES[b].e} без ДНК` : `🧬 +${num(rawOf(d, gd ? 1 : 0))}`;
        const light = b === 'deep' ? '🌑' : pv.light < .5 ? '🌙' : '☀️';
        const txt = `${t} · ${light}${d.colN > 1 || E.capacity((A.st || st).design) > 1 ? ` · 🫧 ${d.colN || 1}` : ''}${g && alive ? ` · 🎯 ${gd ? '✅' : `${num(Math.min(gv, g.v))}/${num(g.v)}`}` : ''}`;
        if (txt !== hlTxt) { hlTxt = txt; hl.textContent = txt; hl.title = g ? `Цель жизни: ${g.n} (+${E.CAPS.goal} ДНК)` : ''; }
      }
      // ── Рисунок: части на мембране, мостики колонии, темнота, минералы ──
      // части участника на мембране (6 мест): по виду бота или коду облика; в кадре — без новых строк (ключ — только когда поменялся)
      const SRCK = new Int16Array(H.MAXO).fill(-2), SRCD = new Array(H.MAXO).fill(null);
      function layoutOf(i){
        const S = H.S, V = S?.view?.(), o = V?.owners?.[i];
        if (!o) { SRCK[i] = -2; return null; }
        if (o.kind === SRCK[i] && (o.kind >= 0 || o.design === SRCD[i])) return LAY[i];
        SRCK[i] = o.kind; SRCD[i] = o.design;
        const key = o.kind >= 0 ? 'k' + o.kind : o.design || '';
        if (!key) return null;
        let l = lays.get(key);
        if (l === undefined) {
          l = null;
          if (o.kind >= 0) {
            const id = E.MICRO_IDS[o.kind], M = E.MICRO[id];
            if (M && M.parts?.length) {
              l = ['', '', '', '', '', ''];
              for (const p of M.parts) {
                if (!E.CELL[p]) continue;
                let k = PREF[p] ?? 0, n = 0;
                while (l[k] && n++ < 6) k = (k + 1) % 6;
                if (l[k]) break;
                l[k] = p; if (E.CELL[p].slots > 1) l[(k + 1) % 6] = '=';
              }
            }
          } else { const d = E.parseCode(o.design); if (d && d.s.some(x => x)) l = d.s; }
          lays.set(key, l);
        }
        return l;
      }
      function bridges(c, ox, oy, z, n){
        const R = H.R, S = H.S;
        HEART.fill(-1); BIG.fill(-1); CX.fill(0); CY.fill(0); CM.fill(0);
        for (let j = 0; j < n; j++) {
          const i = R.o[j], m = R.r[j] * R.r[j]; CX[i] += R.x[j] * m; CY[i] += R.y[j] * m; CM[i] += m;
          if (R.f[j] & 8) HEART[i] = j;
          if (R.f[j] & 4 && (BIG[i] < 0 || R.r[j] > R.r[BIG[i]])) BIG[i] = j;
        }
        for (let i = 0; i < H.MAXO; i++) if (HEART[i] < 0) HEART[i] = BIG[i];   // у гостя сердце не приходит — самая большая клетка колонии
        // курс участника — по движению (свой — по управлению), плавно
        for (let i = 0; i < H.MAXO; i++) {
          if (!CM[i]) continue;
          const x = CX[i] / CM[i], y = CY[i] / CM[i];
          LAY[i] = layoutOf(i); GLO[i] = LAY[i] && LAY[i].includes('photo') ? 1 : 0;
          if (i === S?.me && (Math.abs(H.INP[0]) + Math.abs(H.INP[1]) > .05)) HA[i] = Math.atan2(H.INP[1], H.INP[0]);
          else {
            const dx = x - PX[i], dy = y - PY[i];
            if (dx * dx + dy * dy > .25 && dx * dx + dy * dy < 4e4) { let da = Math.atan2(dy, dx) - HA[i]; da -= Math.round(da / TAU) * TAU; HA[i] += da * .2; }
          }
          PX[i] = x; PY[i] = y;
        }
        // мостики колонии: от сердца к клеткам
        let any = false;
        for (let j = 0; j < n; j++) if ((R.f[j] & 12) === 4 && HEART[R.o[j]] >= 0 && HEART[R.o[j]] !== j) { any = true; break; }
        if (!any) return;
        c.globalAlpha = .55; c.lineCap = 'round';
        for (let j = 0; j < n; j++) {
          if ((R.f[j] & 12) !== 4) continue;
          const h = HEART[R.o[j]]; if (h < 0 || h === j) continue;
          const sk = H.skins[R.o[j]];
          c.strokeStyle = sk ? sk.b : '#fff'; c.lineWidth = Math.max(2, Math.min(R.r[j], R.r[h]) * z * .55);
          c.beginPath(); c.moveTo(ox + R.x[h] * z, oy + R.y[h] * z); c.lineTo(ox + R.x[j] * z, oy + R.y[j] * z); c.stroke();
        }
        c.globalAlpha = 1; c.lineCap = 'butt';
      }
      function decor(c, x, y, r, i, j, t, sk){
        const l = LAY[i];
        if (!l) return;
        const a0 = HA[i], night = pv.light < .5;
        for (let k = 0; k < 6; k++) { const id = l[k]; if (id && id !== '=') part(c, id, x, y, r, a0 + k * TAU / 6, t, sk, night, j); }
      }
      // «Тени великанов» (план §2.3): над лужей и рифом раз в ~1,5 мин проплывает тень огромного существа — по времени, у всех одна
      const SHP = 95, SHT = 9;
      function shadow(c, ox, oy, z){
        const now = Date.now() / 1000, k = Math.floor(now / SHP), ph = now - k * SHP;
        if (ph > SHT) return;
        const a = K.hash3(k, 37, 1) * TAU, ca = Math.cos(a), sa = Math.sin(a), off = (K.hash3(k, 37, 2) - .5) * 2400;
        const d = (ph / SHT * 2 - 1) * 3200, x = ox + (ca * d - sa * off) * z, y = oy + (sa * d + ca * off) * z, rx = 560 * z, ry = 220 * z;
        c.save();
        c.globalAlpha = .16 * Math.min(1, ph / 1.2, (SHT - ph) / 1.2);
        c.fillStyle = '#00060f';
        c.translate(x, y); c.rotate(a);
        c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, TAU);
        c.moveTo(-rx * .85, 0); c.lineTo(-rx * 1.45, -ry * .9); c.lineTo(-rx * 1.3, 0); c.lineTo(-rx * 1.45, ry * .9); c.closePath();   // хвост
        c.moveTo(rx * .1, ry * .8); c.lineTo(-rx * .25, ry * 1.6); c.lineTo(-rx * .35, ry * .7); c.closePath();   // плавники
        c.moveTo(rx * .1, -ry * .8); c.lineTo(-rx * .25, -ry * 1.6); c.lineTo(-rx * .35, -ry * .7); c.closePath();
        c.fill();
        c.restore();
      }
      function overlay(c, ox, oy, z, W2, H2, t, n){
        const L = pv.light;
        if (b !== 'deep') shadow(c, ox, oy, z);
        if (L > .9 || typeof document === 'undefined') return;
        if (!pv.lm) { pv.lm = document.createElement('canvas'); pv.lx = pv.lm.getContext('2d'); }
        const w = Math.max(16, Math.round(W2 / 4)), h = Math.max(16, Math.round(H2 / 4)), x = pv.lx, k = w / W2, g = glowSprite();
        if (pv.lm.width !== w || pv.lm.height !== h) { pv.lm.width = w; pv.lm.height = h; }
        x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, w, h);
        x.globalAlpha = Math.min(.9, (1 - L) * .95); x.fillStyle = '#02040e'; x.fillRect(0, 0, w, h);
        x.globalCompositeOperation = 'destination-out'; x.globalAlpha = 1;
        if (H.myMass > 0) {
          const R0 = (150 + H.myRt * 1.5) * (pv.sight || .5) * z * k;   // без глазков в Глубине видно чуть-чуть вокруг себя
          x.drawImage(g, (ox + H.myX * z) * k - R0, (oy + H.myY * z) * k - R0, R0 * 2, R0 * 2);
        }
        const R = H.R;
        for (let j = 0; j < n; j++) {
          if (!GLO[R.o[j]]) continue;
          const R1 = (R.r[j] * 2.4 + 40) * z * k;
          x.drawImage(g, (ox + R.x[j] * z) * k - R1, (oy + R.y[j] * z) * k - R1, R1 * 2, R1 * 2);
        }
        x.globalCompositeOperation = 'source-over';
        c.drawImage(pv.lm, 0, 0, W2, H2);
      }
      function minerals(c, V, ox, oy, z, zx0, zx1, zy0, zy1, pr){
        const q = pr * 1.6;
        c.fillStyle = '#d9b46a'; c.beginPath();
        for (let zy = zy0; zy <= zy1; zy++) for (let zx = zx0; zx <= zx1; zx++) {
          const base = (zy * H.ZN + zx) * H.KS;
          for (let jj = 0; jj < H.KS; jj++) {
            const p = base + jj;
            if (!V.pAl[p] || !H.isMin(V, p)) continue;
            const px = ox + V.pX[p] * z, py = oy + V.pY[p] * z;
            c.moveTo(px, py - q); c.lineTo(px + q * .8, py); c.lineTo(px, py + q); c.lineTo(px - q * .8, py); c.closePath();
          }
        }
        c.fill();
      }
      return pv;
    }

    // ═══ Части на мембране (в кадре: без новых объектов) ═══
    function part(c, id, x, y, r, a, t, sk, night, j){
      const ca = Math.cos(a), sa = Math.sin(a), ex = x + ca * r, ey = y + sa * r;
      switch (id) {
        case 'flagellum': {   // жгутик: волна наружу
          c.strokeStyle = sk.b; c.lineWidth = Math.max(1.2, r * .08); c.beginPath(); c.moveTo(ex, ey);
          const L = r * .95, nx = -sa, ny = ca, ph = t * .012 + j;
          for (let s = 1; s <= 6; s++) { const d = L * s / 6, w = Math.sin(ph + s * 1.3) * r * .14 * s / 6; c.lineTo(ex + ca * d + nx * w, ey + sa * d + ny * w); }
          c.stroke(); break;
        }
        case 'cilia': {   // реснички: короткие волоски по дуге
          c.strokeStyle = sk.b; c.lineWidth = Math.max(1, r * .05); c.beginPath();
          for (let s = -2; s <= 2; s++) { const b = a + s * .16 + Math.sin(t * .02 + s + j) * .05, cb = Math.cos(b), sb = Math.sin(b); c.moveTo(x + cb * r, y + sb * r); c.lineTo(x + cb * r * 1.2, y + sb * r * 1.2); }
          c.stroke(); break;
        }
        case 'eye': {
          const px = x + ca * r * .66, py = y + sa * r * .66;
          c.fillStyle = '#fff'; c.beginPath(); c.arc(px, py, r * .17, 0, TAU); c.fill();
          c.fillStyle = '#111'; c.beginPath(); c.arc(px + ca * r * .06, py + sa * r * .06, r * .08, 0, TAU); c.fill(); break;
        }
        case 'leaf': {   // хлоропласты внутри
          c.fillStyle = '#22c55e'; c.beginPath();
          for (let s = -1; s <= 1; s++) { const b = a + s * .4, px = x + Math.cos(b) * r * .5, py = y + Math.sin(b) * r * .5; c.moveTo(px + r * .1, py); c.arc(px, py, r * .1, 0, TAU); }
          c.fill(); break;
        }
        case 'jaw': {   // хищный рот: тёмная дуга и зубки
          c.strokeStyle = '#3f0d12'; c.lineWidth = Math.max(1.5, r * .12); c.beginPath(); c.arc(x, y, r * .9, a - .5, a + .5); c.stroke();
          c.fillStyle = '#fff'; c.beginPath();
          for (let s = -1; s <= 1; s++) { const b = a + s * .3, cb = Math.cos(b), sb = Math.sin(b), nx = -sb, ny = cb; c.moveTo(x + cb * r * .97 + nx * r * .07, y + sb * r * .97 + ny * r * .07); c.lineTo(x + cb * r * .97 - nx * r * .07, y + sb * r * .97 - ny * r * .07); c.lineTo(x + cb * r * .74, y + sb * r * .74); c.closePath(); }
          c.fill(); break;
        }
        case 'spikes': {
          c.fillStyle = '#e2e8f0'; c.beginPath();
          for (let s = -1; s <= 1; s++) { const b = a + s * .32, cb = Math.cos(b), sb = Math.sin(b), nx = -sb, ny = cb; c.moveTo(x + cb * r + nx * r * .09, y + sb * r + ny * r * .09); c.lineTo(x + cb * r * 1.28, y + sb * r * 1.28); c.lineTo(x + cb * r - nx * r * .09, y + sb * r - ny * r * .09); c.closePath(); }
          c.fill(); break;
        }
        case 'photo': {   // фотофор: светящаяся точка (ночью ярче)
          const px = x + ca * r * .78, py = y + sa * r * .78;
          if (night) { c.globalAlpha = .35 + .15 * Math.sin(t * .006 + j); c.fillStyle = '#fde68a'; c.beginPath(); c.arc(px, py, r * .34, 0, TAU); c.fill(); c.globalAlpha = 1; }
          c.fillStyle = '#facc15'; c.beginPath(); c.arc(px, py, r * .12, 0, TAU); c.fill(); break;
        }
        case 'adhesion': {   // липкие бугорки
          c.fillStyle = sk.b; c.beginPath();
          for (let s = -1; s <= 1; s += 2) { const b = a + s * .18, px = x + Math.cos(b) * r, py = y + Math.sin(b) * r; c.moveTo(px + r * .09, py); c.arc(px, py, r * .09, 0, TAU); }
          c.fill(); break;
        }
        case 'armour': {   // панцирь: толстая дуга на 2 места
          c.strokeStyle = 'rgba(148,163,184,.92)'; c.lineWidth = Math.max(2, r * .2); c.beginPath(); c.arc(x, y, r * .92, a - .45, a + TAU / 6 + .45); c.stroke(); break;
        }
        case 'toxin': {   // облачко: пузыри сзади
          c.globalAlpha = .28; c.fillStyle = '#c084fc'; c.beginPath();
          for (let s = 0; s < 3; s++) { const d = r * (1.15 + s * .32), b = a + Math.sin(t * .003 + s * 2 + j) * .4, px = x + Math.cos(b) * d, py = y + Math.sin(b) * d, q = r * (.32 - s * .06); c.moveTo(px + q, py); c.arc(px, py, q, 0, TAU); }
          c.fill(); c.globalAlpha = 1; break;
        }
      }
    }
    // Клетка рода на картинке (меню рода, редактор): раскраска + части; нос — вверх
    function paintCell(cv, d, a0){
      if (!cv || !d) return;
      const c = cv.getContext('2d'), w = cv.width, r = w * .3;
      c.clearRect(0, 0, w, w);
      const sk = d.k || { p: 5, a: '#4ade80', b: '#166534' };
      H.drawCell(c, w / 2, w / 2, r, sk, 7, 0, 1, a0, 1);
      for (let k = 0; k < 6; k++) { const id = d.s[k]; if (id && id !== '=') part(c, id, w / 2, w / 2, r, a0 + k * TAU / 6, 0, sk, false, 0); }
    }

    // ═══ Нажатия (kletochki.js отдаёт сюда всё, что начинается на data-io="ev…") ═══
    async function click(a, b){
      const st = A.st;
      if (a === 'evhub') { nameEdit = null; clearTimeout(transT); adL?.done?.(); adL = null; if (H.mode === 'play') H.menu(); hub(); }
      else if (a === 'evplay') play(b.dataset.b, b.dataset.m);
      else if (a === 'evedit') { if (!st) await A.init(); editor(b.dataset.from || (H.mode === 'play' ? 'game' : 'hub')); }
      else if (a === 'evbook') book();
      else if (a === 'evland') { land = { plan: '', diet: '' }; landScreen(); }
      else if (a === 'evplan') { land.plan = b.dataset.v; landScreen(); }
      else if (a === 'evdiet') { land.diet = b.dataset.v; landScreen(); }
      else if (a === 'evgo') goLand();
      else if (a === 'evslot') { const k = +b.dataset.k; sel = sel === k ? -1 : k; renderEditor(); }
      else if (a === 'evput') { put(b.dataset.id); renderEditor(); }
      else if (a === 'evdel') { if (sel >= 0) clearSlot(draft, sel); sel = -1; renderEditor(); }
      else if (a === 'evform') { draft.f = b.dataset.v; renderEditor(); }
      else if (a === 'evsk') { const q = H.PRESETS[+b.dataset.k]; if (q) { draft.k = { p: q[0], a: q[1], b: q[2] }; renderEditor(); } }
      else if (a === 'evbuy') {
        const id = b.dataset.id, r = await A.act('buy', { part: id });
        if (r.ok) { toast(`🧬 Новая часть: ${E.CELL[id].e} ${E.CELL[id].n}`); if (r.got.up) toast(`🎉 Новая стадия рода: ${stageName(r.got.up)}!`); }
        else toast('⚠️ ' + E.why(r));
        renderEditor();
      }
      else if (a === 'evsave') save();
      else if (a === 'evback') goBack();
      else if (a === 'evname') { nameEdit = { a: st.name.a, b: st.name.b }; hub(); }
      else if (a === 'evnrnd') { nameEdit = { a: Math.floor(Math.random() * E.NAME_A.length), b: Math.floor(Math.random() * E.NAME_B.length) }; hub(); }
      else if (a === 'evnsave') {
        const ov = H.ui.ov, x = +ov.querySelector('[data-io="evna"]').value, y = +ov.querySelector('[data-io="evnb"]').value;
        const r = await A.act('name', { a: x, b: y });
        nameEdit = null;
        if (!r.ok) toast('⚠️ ' + E.why(r));
        hub();
      }
      else if (a === 'evimp') { const r = await A.importTrial(); toast(r.ok ? '🧬 Пробный род перенесён в аккаунт' : '⚠️ ' + E.why(r)); hub(); }
      else if (a === 'evimpno') { A.skipImport(); hub(); }
    }
    function unmount(){
      offState?.(); clearTimeout(transT); adL?.done?.(); adL = null; screen = ''; draft = null;
    }

    return { menuButton, route, click, unmount, hub, _t: { part, paintCell, statsOf, get screen(){ return screen; } } };
  };

  // ═══ CSS (только для пути; грузится вместе с ним) ═══
  const CSS = `
.kp-go{display:flex;flex-direction:column;align-items:center;gap:1px;background:linear-gradient(135deg,#16a34a,#0891b2)!important}
.kp-go small{font-size:.66rem;font-weight:700;opacity:.9}
.io-ov.kp{align-items:flex-start}
.kp-hub,.kp-evo,.kp-book,.kp-landc{text-align:left;align-items:stretch;gap:.55rem}
.kp-head{display:flex;gap:.7rem;align-items:center}
.kp-cell{width:84px;height:84px;flex:none}
.kp-hi{display:flex;flex-direction:column;gap:3px;min-width:0}
.kp-name{font-weight:900;font-size:1rem;display:flex;gap:.3rem;align-items:center;flex-wrap:wrap}
.kp-ib{border:0;background:rgba(255,255,255,.08);color:inherit;border-radius:8px;min-width:32px;min-height:32px;cursor:pointer}
.kp-nm{display:flex;gap:.3rem;flex-wrap:wrap;align-items:center}
.kp-nm select{background:rgba(255,255,255,.08);color:var(--text,#fff);border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:.35rem;font:700 .78rem Montserrat,system-ui,sans-serif;min-height:36px}
.kp-nm select option{background:#16131f}
.kp-stg{font-weight:800;font-size:.85rem;color:#86efac}
.kp-stg small,.kp-home{font-size:.7rem;color:var(--muted,#9a98b3);font-weight:600}
.kp-note,.kp-imp,.kp-land{font-size:.74rem;line-height:1.45;padding:.55rem .7rem;border-radius:12px;background:rgba(56,189,248,.1);border:1px solid rgba(56,189,248,.25)}
.kp-imp,.kp-land{display:flex;flex-direction:column;gap:.35rem;background:rgba(74,222,128,.1);border-color:rgba(74,222,128,.3)}
.kp-land.done{background:rgba(250,204,21,.08);border-color:rgba(250,204,21,.28)}
.kp-land b,.kp-imp b{font-size:.85rem}
.kp-track{display:flex;align-items:center;justify-content:space-between;gap:2px;padding:.2rem 0}
.kp-track span{display:flex;flex-direction:column;align-items:center;gap:1px;opacity:.38;min-width:0;flex:1;text-align:center}
.kp-track span b{font-size:1.25rem}
.kp-track span small{font-size:.56rem;line-height:1.15}
.kp-track span.done{opacity:.75}
.kp-track span.on{opacity:1;filter:drop-shadow(0 0 6px rgba(74,222,128,.6))}
.kp-track span.on small{color:#86efac;font-weight:800}
.kp-track i{flex:0 0 8px;height:2px;background:rgba(255,255,255,.18)}
.kp-sec{display:flex;flex-direction:column;gap:.35rem}
.kp-h{font-size:.72rem;font-weight:800;color:var(--muted,#9a98b3);text-transform:uppercase;letter-spacing:.4px}
.kp-needs{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px;font-size:.76rem}
.kp-needs li.ok{opacity:.6}
.kp-needs b{color:#fde68a}
.kp-dna{display:flex;flex-direction:column;gap:.3rem;font-size:.8rem}
.kp-dna small{color:var(--muted,#9a98b3)}
.kp-bar{position:relative;height:18px;border-radius:9px;background:rgba(255,255,255,.08);overflow:hidden}
.kp-bar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#22c55e,#38bdf8)}
.kp-bar span{position:relative;display:block;text-align:center;font-size:.64rem;font-weight:800;line-height:18px}
.kp-rest{font-size:.7rem;color:#c4b5fd}
.kp-task{font-size:.76rem;padding:.45rem .6rem;border-radius:10px;background:rgba(250,204,21,.08);border:1px solid rgba(250,204,21,.22)}
.kp-task.ok{opacity:.7}
.kp-task b{white-space:nowrap}
.kp-bios{display:grid;grid-template-columns:repeat(3,1fr);gap:.4rem}
.kp-bio{display:flex;flex-direction:column;gap:.3rem;padding:.5rem;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid color-mix(in srgb,var(--kb) 45%,transparent)}
.kp-bio.off{opacity:.5;border-color:rgba(255,255,255,.1)}
.kp-bt{font-size:.82rem}
.kp-bt i{font-style:normal;color:#86efac}
.kp-bd{font-size:.66rem;color:var(--muted,#9a98b3);line-height:1.35;flex:1}
.kp-bb{display:flex;gap:.25rem;flex-wrap:wrap}
.kp-bb .ct-start{flex:1;min-height:40px;padding:.4rem .5rem;font-size:.78rem}
.kp-bb .io-sm{min-width:40px;min-height:40px!important}
.kp-rec{font-size:.68rem;color:var(--muted,#9a98b3)}
.kp-row{display:flex;gap:.4rem;flex-wrap:wrap}
.kp-main>button{flex:1;min-height:44px}
.kp-top{display:flex;justify-content:space-between;align-items:center}
.kp-dnab{font-size:1rem;padding:.25rem .6rem;border-radius:10px;background:rgba(74,222,128,.12)}
.kp-ringw{display:flex;gap:.7rem;align-items:center;flex-wrap:wrap;justify-content:center}
.kp-ring{position:relative;width:min(220px,62vw);aspect-ratio:1;flex:none}
.kp-ecell{width:100%;height:100%}
.kp-slot{position:absolute;transform:translate(-50%,-50%);width:44px;height:44px;border-radius:50%;border:2px dashed rgba(255,255,255,.35);background:rgba(10,12,24,.78);color:#fff;font-size:1.15rem;cursor:pointer;display:grid;place-items:center;padding:0;touch-action:manipulation}
.kp-slot.sel{border:2px solid #fde68a;box-shadow:0 0 0 3px rgba(253,230,138,.25)}
.kp-slot.cont{opacity:.55}
.kp-st{display:flex;flex-direction:column;gap:3px;font-size:.7rem;min-width:150px;flex:1}
.kp-st>div{display:flex;align-items:center;gap:.35rem;justify-content:space-between}
.kp-sb{position:relative;flex:0 0 74px;height:7px;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden}
.kp-sb i{position:absolute;left:0;top:0;bottom:0;background:#4ade80}
.kp-mut{font-size:.68rem;color:var(--muted,#9a98b3)}
.kp-pick{display:flex;flex-wrap:wrap;gap:.3rem;padding:.5rem;border-radius:12px;background:rgba(253,230,138,.06);border:1px solid rgba(253,230,138,.25)}
.kp-pick .kp-h{width:100%}
.kp-opt{display:flex;align-items:center;gap:.3rem;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:var(--text,#fff);border-radius:10px;padding:.35rem .55rem;font:700 .74rem Montserrat,system-ui,sans-serif;min-height:40px;cursor:pointer}
.kp-opt b{font-size:1.05rem}
.kp-opt.del{border-color:rgba(248,113,113,.45)}
.kp-forms{display:grid;grid-template-columns:repeat(3,1fr);gap:.35rem}
.kp-forms.row{grid-template-columns:repeat(3,1fr)}
.kp-chip{display:flex;flex-direction:column;gap:2px;align-items:flex-start;text-align:left;border:1.5px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:var(--text,#fff);border-radius:12px;padding:.45rem .5rem;cursor:pointer;min-height:44px;font:700 .74rem Montserrat,system-ui,sans-serif}
.kp-chip small{font-weight:600;font-size:.62rem;color:var(--muted,#9a98b3);line-height:1.3}
.kp-chip.sel{border-color:#4ade80;background:rgba(74,222,128,.12)}
.kp-chip.big b{font-size:.9rem}
.kp-parts{display:flex;flex-direction:column;gap:.3rem}
.kp-part{display:grid;grid-template-columns:34px 1fr auto;gap:.45rem;align-items:center;padding:.35rem .45rem;border-radius:10px;background:rgba(255,255,255,.04)}
.kp-part.full{opacity:.7}
.kp-pe{font-size:1.35rem;text-align:center}
.kp-pn{font-weight:800;font-size:.78rem}
.kp-pn small{font-weight:600;color:var(--muted,#9a98b3)}
.kp-pd{font-size:.64rem;color:var(--muted,#9a98b3);line-height:1.35}
.kp-part .io-sm{min-width:74px;min-height:40px!important}
.kp-part button[disabled]{opacity:.5;cursor:default}
.kp-own{font-size:.7rem;color:#86efac;font-weight:800}
.kp-lock{font-size:.64rem;color:var(--muted,#9a98b3);text-align:right;max-width:90px}
.kp-skins{display:grid;grid-template-columns:repeat(6,1fr);gap:5px}
.kp-skins button{aspect-ratio:1;border-radius:10px;border:2px solid transparent;background:rgba(255,255,255,.05);cursor:pointer;padding:2px;display:grid;place-items:center;min-height:40px}
.kp-skins canvas{width:100%;height:100%}
.kp-mcs{display:grid;grid-template-columns:repeat(2,1fr);gap:.35rem}
.kp-mc{display:grid;grid-template-columns:34px 1fr;gap:.4rem;align-items:center;padding:.45rem;border-radius:12px;background:rgba(255,255,255,.05)}
.kp-mc b{font-size:1.4rem;text-align:center}
.kp-mc.off{opacity:.55}
.kp-gain{font-size:.82rem;text-align:center;line-height:1.45}
.kp-gain b{color:#86efac;font-size:1rem}
.kp-hl{font-size:.72rem;font-weight:800;text-shadow:0 1px 4px rgba(0,0,0,.8);background:rgba(8,10,20,.45);border-radius:8px;padding:2px 7px;white-space:nowrap;pointer-events:none}
.io-ov.kp-trans{background:linear-gradient(180deg,#020617 0%,#0c4a6e 55%,#a16207 100%);align-items:center}
.kp-tr{display:flex;flex-direction:column;align-items:center;gap:1rem;width:min(460px,100%);margin:auto}
.kp-tr-t{font-family:var(--font-display,inherit);font-size:1.6rem;font-weight:900;color:#e0f2fe;text-align:center;text-shadow:0 2px 12px rgba(0,0,0,.6)}
body.high .kp-tr-t{animation:kpEon 3.6s ease-out both}
@keyframes kpEon{0%{opacity:0;letter-spacing:6px}30%{opacity:1}100%{opacity:1;letter-spacing:.5px}}
.kp-tr-ad:empty{display:none}
@media(max-width:520px){.kp-bios{grid-template-columns:1fr}.kp-bio{flex-direction:row;flex-wrap:wrap;align-items:center}.kp-bt{flex:1 1 40%}.kp-bd{flex:1 1 100%;order:3}.kp-bb{flex:0 0 auto}.kp-forms{grid-template-columns:1fr}.kp-mcs{grid-template-columns:1fr}.kp-ringw{flex-direction:column}.kp-st{width:100%}}
`;
  function css(){ if (typeof document === 'undefined' || document.getElementById('kpCss')) return; const s = document.createElement('style'); s.id = 'kpCss'; s.textContent = CSS; document.head.appendChild(s); }
})();
