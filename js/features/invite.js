// ═══════════════════════════════════════
//  👥 ПРИГЛАСИ ДРУЗЕЙ — страница #/invite, карточка в профиле, плашка новичку, проверка админом (#/invite/admin)
// ═══════════════════════════════════════
// Код и ссылки — js/core/ref.js (D37Ref), сервер — referrals2.sql (ref_me, ref_top, ref_set, ref_admin_*), разбор — docs/REFERRALS.md.
// Пока referrals2.sql не запущен — временная ссылка ?ref=<ник> (как раньше) и честное «награды — после обновления сайта».
// Детям (js/core/age.js) — без блока «бонус за поддержку» (деньги друзей — не для них), топ — без их ника (сервер).
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('ru-RU');
  const R = () => window.D37Ref;
  const sb = () => (typeof sbClient !== 'undefined' ? sbClient : null);
  const me = () => (typeof currentUser !== 'undefined' ? currentUser : null);
  const kid = () => !!window.D37Age?.kid?.();
  const isAdmin = () => typeof currentRole !== 'undefined' && currentRole === 'admin';
  const plural = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? b : c;
  const friends = n => n + ' ' + plural(n, 'друг', 'друга', 'друзей');
  const ST = { me: null, at: 0, off: false, err: false, top: {}, tab: 'week', place: '', qr: false, adm: 'review', loading: null };
  // Раздел сайта (js/ui/router.js): '#/invite/admin' при любых адресах (/invite/admin и #/invite/admin); без роутера — решётка
  const routeHash = () => (typeof D37Route !== 'undefined' ? D37Route.hash() : (typeof location !== 'undefined' && location.hash) || '');
  const routeSeg = i => routeHash().replace(/^#\/?/, '').split('/')[i] || null;

  // Вещь персонажа из лестницы → «🦜 Попугай»
  function partName(id){
    const [slot, pid] = String(id || '').split(':');
    const p = window.D37Char?.PARTS?.[slot]?.list?.find(x => x[0] === pid);
    return p ? `${/^[^\w\s]/u.test(p[3] || '') ? p[3] + ' ' : ''}${p[1]}` : '';
  }
  const gift = (o = {}) => [o.xp ? `+${o.xp} XP` : '', o.coins ? `+${num(o.coins)} 🪙` : ''].filter(Boolean).join(' и ');

  async function load(force){
    if (!me() || !sb()) return null;
    if (!force && ST.me && Date.now() - ST.at < 60000) return ST.me;
    if (ST.loading) return ST.loading;
    ST.loading = (async () => {
      try {
        const { data, error } = await sb().rpc('ref_me', { p_dev: R()?.device() || null });
        if (error) { ST.off = !!R()?.noSql(error); ST.err = !ST.off; return null; }
        ST.off = false; ST.err = false; ST.me = data; ST.at = Date.now();
        if (data?.code) R()?.setMine(me().id, data.code);
        return data;
      } catch (e) { ST.err = true; return null; } finally { ST.loading = null; }
    })();
    return ST.loading;
  }
  async function loadTop(tab){
    if (!sb()) return null;
    try {
      const { data, error } = await sb().rpc('ref_top', { p_period: tab, p_lim: 10 });
      if (error) return null;
      ST.top[tab] = data;
      return data;
    } catch (e) { return null; }
  }

  // Ссылка: своя /r/<код>; без referrals2.sql — по-старому ?ref=<ник>
  function myLink(){
    const c = ST.me?.code;
    if (c) return R().link(c, ST.place);
    const nick = typeof currentProfile !== 'undefined' ? currentProfile?.nick : '';
    if (!nick || /^user_[0-9a-f]{6,32}$/.test(nick)) return '';
    const to = ST.place ? (typeof D37Route !== 'undefined' ? D37Route.href('#/' + ST.place) : '#/' + ST.place) : '/', q = '?ref=' + encodeURIComponent(nick);   // /play/chess?ref=… (или /?ref=…#/games/chess)
    return to[0] === '#' ? `${location.origin}/${q}${to}` : `${location.origin}${to}${q}`;
  }
  function shareText(){
    const g = /^games\/([a-z0-9_]+)$/.exec(ST.place || '');
    const game = g && typeof GAMES !== 'undefined' ? GAMES.find(x => x.id === g[1]) : null;
    if (ST.place === 'games/world') return 'Залетай ко мне в «Мир Денчика» — 3D-мир, игры за столами и друзья! По моей ссылке — подарок новичку 🎁';
    if (game) return `Сыграй со мной в «${game.title}» на сайте Денчика37! По моей ссылке — подарок новичку 🎁`;
    return 'Залетай на сайт Денчика37: игры, «Мир Денчика», чат и друзья. По моей ссылке — подарок новичку 🎁';
  }
  const shortLink = u => String(u || '').replace(/^https?:\/\//, '');

  // ═══ Страница ═══
  async function renderInvitePage(param){
    const root = document.getElementById('inviteRoot');
    if (!root) return;
    if (param === 'admin') { root.className = 'rf-adm-root'; return renderAdmin(root); }
    root.innerHTML = '<div class="rf-wait">Загружаем…</div>';
    if (me()) await load(true);
    if (!document.getElementById('inviteRoot') || routeSeg(0) !== 'invite') return;
    root.className = me() ? 'rf-in' : 'rf-out';
    root.innerHTML = page();
    bind(root);
    showTop(root, ST.tab);
    if (ST.qr) drawQr(root);
  }

  function page(){
    const L = R()?.LADDER, m = ST.me, logged = !!me();
    const steps = L ? L.m.map(x => `<li><b>${x.lv} уровень</b><span>${gift(x)}</span></li>`).join('') : '';
    const hero = `<section class="rf-hero pf-card pf-card-accent">
      <div class="rf-hero-t"><span class="rf-hero-ic" aria-hidden="true">🎁</span><div><h3>Позови друзей — получай награды</h3>
        <p>Друг пришёл по твоей ссылке и играет — тебе XP и монеты на каждом шаге. Дошёл до 5 уровня — питомец, а за 5 таких друзей — рамка «Посол».${kid() ? '' : ' Поддержал сайт — 10 % его кристаллов 💎 твои.'}</p></div></div>
      <ol class="rf-steps">${steps}</ol>
      <p class="rf-small">Награды — когда друг правда играет, а не просто зарегистрировался. Новичку по ссылке — свой подарок на ${L?.w.lv || 3} уровне: ${num(L?.w.coins)} 🪙 и ${esc(L?.w.text || '')}.</p>
    </section>`;
    // колонки .rf-col: на компьютере — слева и справа, на телефоне — одной лентой (css/invite.css)
    const cols = (l, r) => `<div class="rf-col rf-col-l">${l}</div><div class="rf-col rf-col-r">${r}</div>`;
    if (!logged) {
      return hero + cols(`<section class="pf-card pf-card-tw rf-login"><b>Войди, чтобы получить свою ссылку</b><span>Аккаунт бесплатный — почта, Google и другие способы.</span>
        <div class="rf-row"><button type="button" class="pf-btn pf-btn-primary" data-a="register">✍️ Создать профиль</button><button type="button" class="pf-btn pf-btn-ghost" data-a="login">Войти</button></div></section>`
        + invitedCard(), topCard()) + rules();
    }
    // вошёл — сначала ссылка (главное действие), потом что за неё дают
    const left = linkCard() + (ST.off ? offCard() : ST.err ? errCard() : statsCard() + listCard());
    const right = (ST.off || ST.err ? '' : progressCard()) + invitedCard() + topCard();
    return cols(left, right) + hero + rules()
      + (isAdmin() ? `<div class="rf-adm-go"><a class="pf-btn pf-btn-ghost pf-btn-sm" href="#/invite/admin">🛡 Проверка приглашений</a></div>` : '');
  }

  function placeOptions(){
    const opts = [['', '🏠 Главная сайта'], ['games/world', '🌍 Мир Денчика'], ['games', '🎮 Все игры'], ['games/studio', '🛠️ Студия игр'], ['chat', '💬 Чат']];
    const games = typeof GAMES !== 'undefined' ? GAMES.filter(g => !g.href && !['world', 'studio', 'studio3d', 'unity', 'wardrobe'].includes(g.id)) : [];
    return opts.map(([v, t]) => `<option value="${v}"${ST.place === v ? ' selected' : ''}>${t}</option>`).join('')
      + (games.length ? `<optgroup label="Сыграть вместе">${games.map(g => `<option value="games/${g.id}"${ST.place === 'games/' + g.id ? ' selected' : ''}>${g.icon} ${esc(g.title)}</option>`).join('')}</optgroup>` : '');
  }

  function linkCard(){
    const link = myLink();
    if (!link) return `<section class="pf-card pf-card-gold rf-link"><div class="pf-kicker">🔗 Твоя ссылка</div><p class="rf-small">Сначала придумай ник в профиле — и ссылка появится.</p><a class="pf-btn pf-btn-primary pf-btn-sm" href="#/profile">✏️ В профиль</a></section>`;
    return `<section class="pf-card pf-card-gold rf-link">
      <div class="pf-kicker">🔗 Твоя ссылка${ST.me?.code ? ` · код <b class="rf-code">${esc(ST.me.code)}</b>` : ''}</div>
      <div class="rf-url"><input id="rfUrl" readonly value="${esc(link)}" aria-label="Твоя ссылка-приглашение"><button type="button" class="pf-btn pf-btn-primary pf-btn-sm" data-a="copy">📋 Скопировать</button></div>
      <div class="rf-share">
        ${navigator.share ? '<button type="button" class="rf-sh rf-sh-native" data-a="native">📲 Поделиться</button>' : ''}
        <button type="button" class="rf-sh rf-sh-tg" data-a="tg">✈️ Telegram</button>
        <button type="button" class="rf-sh rf-sh-vk" data-a="vk">ВКонтакте</button>
        <button type="button" class="rf-sh rf-sh-wa" data-a="wa">💬 WhatsApp</button>
        <button type="button" class="rf-sh rf-sh-qr${ST.qr ? ' on' : ''}" data-a="qr" aria-expanded="${ST.qr}">▦ QR-код</button>
      </div>
      <label class="rf-place"><span>Куда позвать</span><select id="rfPlace">${placeOptions()}</select></label>
      <p class="rf-small">Комната в игре, стол в «Мире», мир из «Студии 3D», ролик — кнопки «🔗 Ссылка» и «Поделиться» там уже с твоим кодом.</p>
      <div class="rf-qr" id="rfQr"${ST.qr ? '' : ' hidden'}></div>
      <div class="rf-note" id="rfNote" role="status"></div>
    </section>`;
  }
  const offCard = () => `<section class="pf-card pf-card-muted rf-off"><b>⏳ Короткая ссылка и награды за друзей появятся, когда сайт обновится</b><span>Ссылка выше уже работает: кто зарегистрируется по ней — запишется за тобой.</span></section>`;
  const errCard = () => `<section class="pf-card pf-card-muted rf-off"><b>📡 Сервер не ответил</b><span>Проверь интернет и обнови страницу.</span><button type="button" class="pf-btn pf-btn-ghost pf-btn-sm" data-a="reload">↻ Ещё раз</button></section>`;

  // Ступени: сколько друзей дошли до нужного уровня
  function haveFor(t){ const s = ST.me?.stats || {}; return t.lv >= 10 ? s.l10 || 0 : t.lv >= 5 ? s.l5 || 0 : s.l3 || 0; }
  function progressCard(){
    const L = R().LADDER, got = new Set(ST.me?.tiers || []);
    const next = L.t.find(t => !got.has(t.id));
    const tiers = L.t.map(t => {
      const have = Math.min(haveFor(t), t.n), done = got.has(t.id);
      return `<li class="${done ? 'done' : ''}"><span class="rf-ti">${done ? '✅' : t.frame ? '🖼️' : (partName(t.part).split(' ')[0] || '🎁')}</span>
        <span class="rf-tt"><b>${esc(t.text)}</b><small>${friends(t.n)} до ${t.lv} уровня · ${done ? 'получено' : `${have} из ${t.n}`}</small>
        <i class="rf-bar"><i style="width:${Math.round(100 * have / t.n)}%"></i></i></span></li>`;
    }).join('');
    const nextLine = next ? (() => { const left = Math.max(0, next.n - haveFor(next)); return `🎯 Следующая награда: <b>${esc(next.text)}</b> — ещё ${friends(left)} до ${next.lv} уровня`; })() : '🏆 Все ступени пройдены — ты легенда приглашений!';
    const month = ST.me?.month;
    const aff = kid() ? '' : `<div class="rf-aff"><span>💎 Бонус за поддержку в этом месяце</span><b>${num(month?.gems)} из ${num(month?.cap)}</b>
        <i class="rf-bar"><i style="width:${Math.min(100, Math.round(100 * (month?.gems || 0) / (month?.cap || 1)))}%"></i></i>
        <small>Друг купил кристаллы или задонатил — тебе ${R().RULES.pct} % его 💎 (${R().RULES.months} месяцев после его регистрации). Подарки и тестовые покупки не считаются; вернул деньги — бонус тоже вернётся.</small></div>`;
    return `<section class="pf-card pf-card-tw rf-prog"><div class="pf-kicker">🏅 Награды за друзей</div><p class="rf-next">${nextLine}</p><ul class="rf-tiers">${tiers}</ul>${aff}
      ${ST.me?.frame ? `<label class="rf-tg"><input type="checkbox" data-a="frame"${ST.me.frame_on ? ' checked' : ''}> Рамка «Посол» вместо рамки уровня</label>` : ''}</section>`;
  }

  function statsCard(){
    const s = ST.me?.stats || {}, e = ST.me?.earned || {};
    const cell = (v, t) => `<div class="rf-stat"><b>${num(v)}</b><span>${t}</span></div>`;
    const items = (e.items || []).map(partName).filter(Boolean);
    return `<section class="pf-card rf-stats-card"><div class="rf-stats">${cell(s.joined, 'пришли по ссылке')}${cell(s.l3, 'дошли до 3 ур.')}${cell(s.l5, 'до 5 ур.')}${cell(s.l10, 'до 10 ур.')}</div>
      <div class="rf-earned"><span>Ты получил:</span> <b>${num(e.xp)} XP</b> · <b>${num(e.coins)} 🪙</b>${kid() ? '' : ` · <b>${num(e.gems)} 💎</b>`}${items.length ? ' · ' + items.map(esc).join(', ') : ''}
        ${e.held ? `<small>⏳ Ещё ${e.held} ${plural(e.held, 'награда ждёт', 'награды ждут', 'наград ждут')} проверки или лимита (не больше ${R().RULES.dayCap} наград за друзей в сутки).</small>` : ''}</div>
      ${s.week ? `<p class="rf-small">За неделю пришло: ${friends(s.week)}.</p>` : ''}</section>`;
  }

  function listCard(){
    const list = ST.me?.list || [];
    if (!list.length) return `<section class="pf-card pf-card-muted rf-list"><div class="pf-kicker">👥 Мои приглашения</div><p class="rf-empty">Пока никого. Отправь ссылку другу — здесь появится, кто пришёл и до какого уровня дошёл.</p></section>`;
    const chip = (on, lv) => `<i class="rf-m${on ? ' on' : ''}" title="${on ? 'Дошёл' : 'Ещё не дошёл'} до ${lv} уровня">${lv}</i>`;
    const rows = list.map(f => {
      const ava = f.av ? `<span class="rf-ava" style="background-image:url('${esc(String(f.av).replace(/'/g, ''))}')"></span>` : `<span class="rf-ava">${esc(String(f.nick || '?').slice(0, 2).toUpperCase())}</span>`;
      const name = f.id ? `<a href="#/profile/${esc(f.id)}">${esc(f.nick)}</a>` : `<span>${esc(f.nick)}</span>`;
      const st = f.st === 'hold' ? '<em class="rf-st hold" title="Проверяем, что это другой человек">⏳ проверка</em>' : f.st === 'no' ? '<em class="rf-st no" title="Похоже на второй аккаунт или то же устройство">🚫 не засчитан</em>' : '';
      const when = f.at ? `<small>${new Date(f.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</small>` : f.hid ? '<small title="Профиль скрыт — видно только ник и уровень">🔒</small>' : '';
      return `<li>${ava}<span class="rf-fn">${name}${when}</span><span class="rf-rt"><span class="rf-lv">Lv ${num(f.lv)}</span><span class="rf-ms">${chip(f.m?.l3, 3)}${chip(f.m?.l5, 5)}${chip(f.m?.l10, 10)}</span>${st}</span></li>`;
    }).join('');
    return `<section class="pf-card rf-list"><div class="pf-kicker">👥 Мои приглашения · ${list.length}</div><ul>${rows}</ul></section>`;
  }

  function invitedCard(){
    const iv = ST.me?.invited, L = R()?.LADDER;
    if (iv && iv.st === 'ok') {
      const lv = iv.lv || 1, need = iv.gift?.lv || L?.w.lv || 3;
      const body = iv.got ? `✅ Подарок получен: ${num(iv.gift?.coins)} 🪙 и ${esc(iv.gift?.text || '')}. <a href="#/games/wardrobe">Надеть в гардеробе →</a>`
        : iv.wait ? '⏳ Подарок за приглашение проверяется — скоро придёт.'
        : `Дойди до ${need} уровня — получишь ${num(iv.gift?.coins)} 🪙 и ${esc(iv.gift?.text || '')}. Сейчас: ${lv} из ${need}.<i class="rf-bar"><i style="width:${Math.min(100, Math.round(100 * lv / need))}%"></i></i>`;
      return `<section class="pf-card pf-card-gold rf-invited"><b>🎁 Тебя позвал(а) ${esc(iv.nick || 'друг')}</b><span>${body}</span></section>`;
    }
    const p = R()?.pending();
    if (!me() && p) return `<section class="pf-card pf-card-gold rf-invited"><b>🎁 Тебя позвали на сайт</b><span>Создай профиль — на ${L?.w.lv || 3} уровне получишь ${num(L?.w.coins)} 🪙 и ${esc(L?.w.text || '')}.</span></section>`;
    return '';
  }

  function topCard(){
    return `<section class="pf-card rf-top"><div class="rf-top-h"><div class="pf-kicker">🏆 Топ пригласивших</div>
      <div class="rf-tabs" role="tablist"><button type="button" role="tab" data-tab="week" class="${ST.tab === 'week' ? 'on' : ''}" aria-selected="${ST.tab === 'week'}">Неделя</button><button type="button" role="tab" data-tab="all" class="${ST.tab === 'all' ? 'on' : ''}" aria-selected="${ST.tab === 'all'}">Всё время</button></div></div>
      <ol class="rf-toplist" id="rfTop"><li class="rf-wait">…</li></ol>
      <p class="rf-small">Считаются друзья, дошедшие до 3 уровня.</p>
      ${me() && ST.me ? `<label class="rf-tg"><input type="checkbox" data-a="hide"${ST.me.hide_top ? '' : ' checked'}> Показывать мой ник в топе</label>` : ''}</section>`;
  }
  async function showTop(root, tab){
    const box = root.querySelector('#rfTop');
    if (!box) return;
    const d = ST.top[tab] || await loadTop(tab);
    if (!root.isConnected || ST.tab !== tab) return;
    const list = d?.list || [];
    box.innerHTML = !d ? '<li class="rf-empty">Топ появится, когда сайт обновится.</li>' : !list.length ? '<li class="rf-empty">Пока пусто — стань первым!</li>'
      : list.map(x => `<li class="${x.me ? 'me' : ''}"><span class="rf-rk">${x.rank <= 3 ? ['🥇', '🥈', '🥉'][x.rank - 1] : x.rank}</span>
          <span class="rf-tn">${x.nick ? (x.id ? `<a href="#/profile/${esc(x.id)}">${esc(x.nick)}</a>` : esc(x.nick)) : '<span class="rf-anon">🕶 Аноним</span>'}${x.me ? ' <small>(ты)</small>' : ''}</span>
          <b>${num(x.n)}</b></li>`).join('');
  }

  function rules(){
    const L = R()?.LADDER, r = R()?.RULES || {};
    return `<section class="pf-card pf-card-muted rf-rules"><div class="pf-kicker">❓ Как это работает</div>
      <details><summary>Когда засчитывается друг?</summary><p>Друг открыл твою ссылку и в течение ${r.keepDays} дней создал аккаунт — любым способом: почта, Google и другие. Ссылку можно открыть на любой странице сайта: он попадёт туда, куда ты звал. Аккаунт должен быть новым — не старше ${r.claimDays} дней.</p></details>
      <details><summary>Что я получу?</summary><p>За каждого друга: ${L ? L.m.map(x => `${x.lv} уровень — ${gift(x)}`).join(', ') : ''}. Ступени: ${L ? L.t.map(t => `${friends(t.n)} до ${t.lv} уровня — ${t.text}`).join('; ') : ''}. Не больше ${r.dayCap} наград за друзей в сутки — остальные придут позже.</p></details>
      ${kid() ? '' : `<details><summary>Бонус за поддержку — как это?</summary><p>Если друг купит кристаллы 💎 или задонатит, тебе — ${r.pct} % его кристаллов (донат в режиме «VIP сразу» считается по курсу 1 ₽ = 1 💎). ${r.months} месяцев после его регистрации, не больше ${num(r.gemsMonth)} 💎 в месяц. Кто именно и сколько заплатил, мы не показываем. Друг вернул деньги — бонус за ту покупку списывается.</p></details>`}
      <details><summary>Что не засчитывается?</summary><p>Свои вторые аккаунты, вход со своего же телефона или компьютера, «друзья», которые не играют. Если похоже на накрутку (тот же интернет, одно устройство на несколько аккаунтов, много «друзей» с одного адреса) — награды ждут проверки админом. Зови настоящих друзей — так честно для всех.</p></details>
      <details><summary>Что видит тот, кто меня позвал?</summary><p>Твой ник и уровень. Дату регистрации и профиль — только если профиль открыт. Сколько ты потратил, возраст, почту — никогда.</p></details></section>`;
  }

  // ── Кнопки ──
  function note(root, t){ const n = root.querySelector('#rfNote'); if (n) { n.textContent = t; clearTimeout(n._t); n._t = setTimeout(() => { n.textContent = ''; }, 2600); } }
  async function copy(root, text){
    try { await navigator.clipboard.writeText(text); note(root, '✅ Ссылка скопирована — отправь другу'); }
    catch (e) { const i = root.querySelector('#rfUrl'); if (i) { i.select(); try { document.execCommand('copy'); note(root, '✅ Скопировано'); } catch (er) { prompt('Скопируй ссылку:', text); } } }
  }
  function track(kind){ try { window.va?.('event', { name: 'invite_share', data: { kind, place: ST.place || 'home' } }); } catch (e) {} R()?.touch?.(); }
  function bind(root){
    root.onclick = async e => {
      const b = e.target.closest('[data-a],[data-tab]');
      if (!b) return;
      const a = b.dataset.a, link = myLink(), text = shareText();
      if (b.dataset.tab) { ST.tab = b.dataset.tab; root.querySelectorAll('[data-tab]').forEach(t => { t.classList.toggle('on', t === b); t.setAttribute('aria-selected', String(t === b)); }); showTop(root, ST.tab); return; }
      if (a === 'register' || a === 'login') { if (typeof openGlobalAuth === 'function') openGlobalAuth(a === 'register' ? 'register' : undefined); return; }
      if (a === 'reload') { renderInvitePage(); return; }
      if (!link) return;
      if (a === 'copy') { track('copy'); copy(root, link); }
      else if (a === 'native') { track('native'); navigator.share({ title: 'Сайт Денчика37', text, url: link }).catch(() => {}); }
      else if (a === 'tg' || a === 'vk' || a === 'wa') { track(a); window.open(R().shareUrls(link, text)[a], '_blank', 'noopener'); }
      else if (a === 'qr') { ST.qr = !ST.qr; b.classList.toggle('on', ST.qr); b.setAttribute('aria-expanded', String(ST.qr)); const q = root.querySelector('#rfQr'); if (q) q.hidden = !ST.qr; if (ST.qr) { track('qr'); drawQr(root); } }
      else if (a === 'qrsave') saveQr(link);
    };
    root.onchange = async e => {
      const t = e.target;
      if (t.id === 'rfPlace') { ST.place = t.value; const i = root.querySelector('#rfUrl'); if (i) i.value = myLink(); if (ST.qr) drawQr(root); return; }
      if (t.dataset.a === 'hide' || t.dataset.a === 'frame') {
        const args = t.dataset.a === 'hide' ? { p_hide_top: !t.checked, p_frame: null } : { p_hide_top: null, p_frame: t.checked };
        const { data, error } = await sb().rpc('ref_set', args);
        if (error || !data?.ok) { t.checked = !t.checked; return; }
        Object.assign(ST.me, { hide_top: data.hide_top, frame_on: data.frame_on });
        if (t.dataset.a === 'hide') { ST.top = {}; showTop(root, ST.tab); }
        else { R()?.forgetFrame(me()?.id); }
      }
    };
  }

  // ── QR (js/core/qr.js — грузится при первом нажатии) ──
  let qrLoading = null;
  function loadQr(){
    if (window.D37QR) return Promise.resolve(true);
    if (!qrLoading) qrLoading = new Promise(res => { const s = document.createElement('script'); s.src = 'js/core/qr.js?v=1'; s.onload = () => res(!!window.D37QR); s.onerror = () => { qrLoading = null; res(false); }; document.head.appendChild(s); });
    return qrLoading;
  }
  async function drawQr(root){
    const box = root.querySelector('#rfQr');
    if (!box) return;
    const link = myLink();
    if (!(await loadQr())) { box.innerHTML = '<p class="rf-small">QR-код не загрузился — обнови страницу.</p>'; return; }
    box.innerHTML = `<div class="rf-qr-img">${window.D37QR.svg(link, { px: 5, margin: 3 })}</div>
      <div class="rf-qr-t"><b>Покажи другу — пусть наведёт камеру</b><span>${esc(shortLink(link))}</span><button type="button" class="pf-btn pf-btn-ghost pf-btn-sm" data-a="qrsave">⬇ Сохранить картинку</button></div>`;
  }
  async function saveQr(link){
    if (!(await loadQr())) return;
    const c = document.createElement('canvas');
    if (!window.D37QR.draw(c, link, { px: 10, margin: 4 })) return;
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png'); a.download = 'priglashenie-dan4ik37.png';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ═══ Карточка в профиле (вместо старой «🔗 Пригласи друзей») ═══
  async function renderInviteCard(panel, isOwn){
    if (!panel) return;
    if (!isOwn || !me()) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    const draw = () => {
      const s = ST.me?.stats, link = myLink();
      panel.innerHTML = `<div class="pf-kicker" style="margin-bottom:.5rem">👥 Пригласи друзей</div>
        <p class="rf-small" style="margin:0 0 .7rem">Друг дошёл до 3, 5 и 10 уровня — тебе XP и монеты, на 5 уровне — питомец 🦜${kid() ? '' : ', поддержал сайт — 10 % его 💎 твои'}.</p>
        ${s ? `<p class="rf-pf-stats">Пришли: <b>${num(s.joined)}</b> · до 3 ур.: <b>${num(s.l3)}</b> · до 5 ур.: <b>${num(s.l5)}</b></p>` : ''}
        ${link ? `<div class="rf-url"><input readonly value="${esc(link)}" aria-label="Твоя ссылка-приглашение"><button type="button" class="pf-btn pf-btn-primary pf-btn-sm" data-pa="copy">📋</button></div>` : ''}
        <div class="rf-row"><a class="pf-btn pf-btn-tw pf-btn-sm" href="#/invite">👥 Мои приглашения и награды →</a></div>
        <div class="rf-note" role="status"></div>`;
      panel.querySelector('[data-pa="copy"]')?.addEventListener('click', async () => {
        const n = panel.querySelector('.rf-note');
        try { await navigator.clipboard.writeText(myLink()); if (n) n.textContent = '✅ Скопировано!'; } catch (e) { prompt('Скопируй ссылку:', myLink()); }
        R()?.touch?.();
        setTimeout(() => { if (n) n.textContent = ''; }, 2500);
      });
    };
    draw();
    await load();
    if (panel.isConnected) draw();
  }

  // ═══ Проверка приглашений (админ) ═══
  const FLAG = { same_dev: '📱 то же устройство, что у пригласившего', same_ip: '🌐 тот же интернет (IP), что у пригласившего',
    dev_reuse: '👥 это устройство есть у другого аккаунта', ip_burst: '🏫 с этого IP пришло несколько друзей' };
  const STATUS = { ok: '✅ засчитан', hold: '⏳ на проверке', self: '📱 «сам себя»', denied: '⛔ отклонён' };
  async function renderAdmin(root){
    if (!isAdmin()) { root.innerHTML = '<section class="pf-card pf-card-muted rf-off"><b>Только для админа</b><a class="pf-btn pf-btn-ghost pf-btn-sm" href="#/invite">← Приглашения</a></section>'; return; }
    root.innerHTML = '<div class="rf-wait">Загружаем…</div>';
    const [st, ls] = await Promise.all([sb().rpc('ref_admin_stats'), sb().rpc('ref_admin_list', { p_what: ST.adm, p_limit: 150 })]);
    if (st.error || ls.error) {
      const off = R()?.noSql(st.error || ls.error);
      root.innerHTML = `<section class="pf-card pf-card-muted rf-off"><b>${off ? '⏳ Нужен referrals2.sql — запусти его в Supabase' : '📡 Не получилось загрузить'}</b><a class="pf-btn pf-btn-ghost pf-btn-sm" href="#/invite">← Приглашения</a></section>`;
      return;
    }
    const s = st.data || {}, list = ls.data || [];
    const tabs = [['review', 'На проверке'], ['all', 'Все'], ['denied', 'Отклонённые'], ['ok', 'Засчитанные']];
    root.innerHTML = `<div class="rf-adm">
      <div class="rf-crumbs"><a href="#/invite">← Приглашения</a></div>
      <section class="pf-card pf-card-danger"><div class="pf-kicker">🛡 Проверка приглашений</div>
        <div class="rf-stats">${[[s.links, 'всего'], [s.ok, 'засчитано'], [s.hold, 'на проверке'], [s.self, '«сам себя»'], [s.denied, 'отклонено'], [s.held, 'наград ждут']].map(([v, t]) => `<div class="rf-stat"><b>${num(v)}</b><span>${t}</span></div>`).join('')}</div>
        <p class="rf-small">Выдано за всё время: ${num(s.paid?.xp)} XP · ${num(s.paid?.coins)} 🪙 · ${num(s.paid?.gems)} 💎. За неделю приглашений: ${num(s.week)}.</p>
        <div class="rf-tabs">${tabs.map(([k, t]) => `<button type="button" data-adm="${k}" class="${ST.adm === k ? 'on' : ''}">${t}</button>`).join('')}</div></section>
      ${list.length ? `<ul class="rf-adm-list">${list.map(x => `<li class="pf-card" data-inv="${esc(x.invitee)}">
          <div class="rf-adm-h"><b><a href="#/profile/${esc(x.invitee)}">${esc(x.invitee_nick || '?')}</a></b><span>← позвал(а) <a href="#/profile/${esc(x.inviter)}">${esc(x.inviter_nick || '?')}</a></span><em class="rf-st ${esc(x.status)}">${STATUS[x.status] || esc(x.status)}</em></div>
          <div class="rf-adm-m">Lv ${num(x.lv)} · ${x.l3 ? '3✓' : '3·'} ${x.l5 ? '5✓' : '5·'} ${x.l10 ? '10✓' : '10·'} · ${esc(x.src || '')}${x.place ? ' → ' + esc(x.place) : ''} · ${new Date(x.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${x.legacy ? ' · по старым правилам' : ''}</div>
          ${(x.flags || []).length ? `<div class="rf-flags">${x.flags.map(f => `<span>${FLAG[f] || esc(f)}</span>`).join('')}</div>` : ''}
          ${(x.same_as || []).length ? `<div class="rf-small">Общие IP или устройство с: ${x.same_as.map(esc).join(', ')}</div>` : ''}
          ${x.held ? `<div class="rf-small">⏳ Ждут: ${num(x.held)} ${plural(x.held, 'награда', 'награды', 'наград')}${x.held_gems ? ` (из них ${num(x.held_gems)} 💎 бонуса)` : ''}</div>` : ''}
          ${x.note ? `<div class="rf-small">📝 ${esc(x.note)}</div>` : ''}
          <div class="rf-row">${x.status !== 'ok' ? '<button type="button" class="pf-btn pf-btn-primary pf-btn-sm" data-rv="ok">✅ Засчитать</button>' : ''}${x.status !== 'denied' ? '<button type="button" class="pf-btn pf-btn-danger pf-btn-sm" data-rv="no">⛔ Отклонить</button>' : ''}</div>
        </li>`).join('')}</ul>` : '<section class="pf-card pf-card-muted"><p class="rf-empty">Пусто — подозрительных приглашений нет.</p></section>'}
    </div>`;
    root.onclick = async e => {
      const t = e.target.closest('[data-adm]');
      if (t) { ST.adm = t.dataset.adm; renderAdmin(root); return; }
      const b = e.target.closest('[data-rv]');
      if (!b) return;
      const li = b.closest('[data-inv]'), ok = b.dataset.rv === 'ok';
      const why = prompt(ok ? 'Засчитать приглашение — отложенные награды выдадутся. Заметка (необязательно):' : 'Отклонить: награды за этого друга не будет. Причина:', ok ? '' : 'второй аккаунт');
      if (why === null) return;
      b.disabled = true;
      const { data, error } = await sb().rpc('ref_admin_review', { p_invitee: li.dataset.inv, p_ok: ok, p_note: why });
      if (error || !data?.ok) { alert('Не получилось: ' + (error?.message || data?.reason || '')); b.disabled = false; return; }
      renderAdmin(root);
    };
  }

  // ═══ Плашка новичку: «<ник> зовёт тебя» ═══
  let bannerShown = false, bannerT = 0;
  async function banner(){
    const p = R()?.pending();
    if (!p || me() || bannerShown) return;
    try { if (sessionStorage.getItem('d37_ref_bn')) return; } catch (e) {}
    // не поверх игры, чата, своей страницы и других окошек (возраст, «установить приложение», вход)
    if (/^#\/(games\/|chat|invite)/.test(routeHash()) || document.body.classList.contains('game-on')) return;
    if (document.querySelector('.age-sheet, .apc.on, #globalAuthModal.open')) { clearTimeout(bannerT); bannerT = setTimeout(banner, 15000); return; }
    bannerShown = true;
    const info = await R().publicInfo(p.c);
    if (me()) return;
    const L = R().LADDER;
    const el = document.createElement('div');
    el.className = 'rf-bn';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Приглашение на сайт');
    el.innerHTML = `<span class="rf-bn-ic" aria-hidden="true">🎁</span><span class="rf-bn-t"><b>${info?.nick ? `${esc(info.nick)} зовёт тебя на сайт!` : 'Тебя зовут на сайт Денчика37!'}</b>
      <span>Создай профиль — на ${L.w.lv} уровне подарок: ${num(L.w.coins)} 🪙 и ${esc(L.w.text)}.</span></span>
      <button type="button" class="rf-bn-go">Создать профиль</button><button type="button" class="rf-bn-x" aria-label="Закрыть">✕</button>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('on'));
    const close = () => { el.classList.remove('on'); setTimeout(() => el.remove(), 300); try { sessionStorage.setItem('d37_ref_bn', '1'); } catch (e) {} };
    el.querySelector('.rf-bn-x').onclick = close;
    el.querySelector('.rf-bn-go').onclick = () => { close(); if (typeof openGlobalAuth === 'function') openGlobalAuth('register'); };
    window.addEventListener('d37:auth', () => { if (me()) close(); }, { once: true });
  }

  function toast(html){
    let el = document.getElementById('rfToast');
    if (!el) { el = document.createElement('div'); el.id = 'rfToast'; el.className = 'rf-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.innerHTML = html;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 7000);
  }
  // Ответ сервера после входа: привязан к пригласившему / не засчитано
  R()?.on((type, d) => {
    if (type !== 'claim' || !d) return;
    const L = R().LADDER;
    if (d.ok && !d.already) toast(`🎉 Ты пришёл(ла) по приглашению <b>${esc(d.inviter || 'друга')}</b>! На ${L.w.lv} уровне — подарок: ${num(L.w.coins)} 🪙 и ${esc(L.w.text)}. <a href="#/invite">Подробнее</a>`);
    else if (d.reason === 'self_device') toast('Приглашение не засчитано: ссылку открыли там же, где входит пригласивший. Зови других людей — и всё получится 🙂');
    ST.at = 0;
    if (routeSeg(0) === 'invite') renderInvitePage(routeSeg(1));
  });
  window.addEventListener('d37:auth', () => {
    ST.me = null; ST.at = 0; ST.off = false; ST.err = false;
    if (routeSeg(0) === 'invite') renderInvitePage(routeSeg(1));
  });
  setTimeout(banner, 2500);
  window.addEventListener('d37:route', () => { clearTimeout(bannerT); bannerT = setTimeout(banner, 1200); });

  // ═══ Окно входа: «🎁 Тебя пригласил(а) <ник>» над кнопками «Войти через…» (#gauthRef в index.html; само окно — global-auth.js) ═══
  async function authLine(){
    const box = document.getElementById('gauthRef');
    if (!box) return;
    const p = R()?.pending();
    if (!p || me()) { box.hidden = true; return; }
    const L = R().LADDER, info = await R().publicInfo(p.c);
    if (!R().pending() || me()) { box.hidden = true; return; }
    box.innerHTML = `🎁 ${info?.nick ? `Тебя пригласил(а) <b>${esc(info.nick)}</b>` : 'Тебя пригласили на сайт'} — создай профиль любым способом, и на ${L.w.lv} уровне получишь ${num(L.w.coins)} 🪙 и ${esc(L.w.text)}.`;
    box.hidden = false;
  }
  const authModal = document.getElementById('globalAuthModal');
  if (authModal && window.MutationObserver) new MutationObserver(() => { if (authModal.classList.contains('open')) authLine(); }).observe(authModal, { attributes: true, attributeFilter: ['class'] });
  R()?.on(type => { if (type === 'claim') { const b = document.getElementById('gauthRef'); if (b) b.hidden = true; } });

  window.renderInvitePage = renderInvitePage;
  window.renderInviteCard = renderInviteCard;
  window.D37Invite = { load, shareText, myLink, state: () => ST, _test: { page, partName, placeOptions, authLine } };
})();
