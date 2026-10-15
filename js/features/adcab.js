// ═══════════════════════════════════════
//  📣 КАБИНЕТ РЕКЛАМОДАТЕЛЯ (#/adv) — своя реклама на сайте за 💎 (ads.sql; показ на сайте — js/core/ad-direct.js)
// ═══════════════════════════════════════
// Грузится при первом заходе в #/adv (D37AdDirect.cabinet, стили — css/adcab.css). Маршруты:
//   #/adv — мои кампании (гостю — что это, форматы, цены), #/adv/new — новая, #/adv/edit/<id> — правка,
//   #/adv/c/<id> — статистика по дням и действия, #/adv/admin[/live|all|prices] — модерация, все кампании, цены, итоги.
// Пишет только сервер (ad_save / ad_act / ad_admin_*): бюджет — из 💎 в копилку кампании, остаток — назад.
// Картинки готовит браузер: обрезка под точный размер формата (как в ad_kind_size), webp или jpeg до 500 КБ → закрытое
// хранилище 'ads' (своя папка). «🪄 Из карточки» — баннер, столбик и щит из картинки и текста карточки (тоже на проверку).
// Пока ads.sql не выполнен — витрина «как это работает» и «откроется, когда сайт обновится».
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('ru');
  const dec = (n, d = 2) => Number(n || 0).toLocaleString('ru', { maximumFractionDigits: d });
  const toast = t => { if (typeof xpToast === 'function') xpToast(t); else alert(t); };
  const D = () => window.D37AdDirect || {};
  const RL = () => D().rules || {};
  const authed = () => typeof currentUser !== 'undefined' && !!currentUser;
  const uid = () => (authed() ? currentUser.id : '');
  const mskDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  const addDays = (s, n) => { const d = new Date(String(s).slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const ruDate = s => s ? new Date(String(s).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
  const ruTime = s => s ? new Date(s).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const plural = (n, a, b, c) => { n = Math.abs(n) % 100; const m = n % 10; return n > 10 && n < 20 ? c : m === 1 ? a : m > 1 && m < 5 ? b : c; };
  const gems = n => `${num(n)} 💎`;

  // ── Справочники ──
  const GROUPS = [
    { g: 'native', icon: '🗂', t: 'Карточка в ленте', d: 'среди игр, видео и каталогов игр игроков — выглядит как карточки сайта', kinds: ['native'] },
    { g: 'banner', icon: '🖼', t: 'Баннер', d: 'экраны загрузки мира и игр, «☕ Перерыв» и место под игрой после партии, страницы игр и роликов', kinds: ['b300x250', 'b728x90'] },
    { g: 'rail', icon: '📏', t: 'Столбик', d: 'справа от игры на широком экране компьютера', kinds: ['r300x600', 'r160x600'] },
    { g: 'board', icon: '🌍', t: 'Щит в 3D-мире', d: 'большой щит у площади «Мира Денчика» — его видит каждый, кто заходит в мир', kinds: ['board'] },
  ];
  const KIND = { native: { t: 'Картинка 16:9', show: [320, 180] }, b300x250: { t: '300×250', show: [300, 250] }, b728x90: { t: '728×90', show: [728, 90] },
    r300x600: { t: '300×600', show: [300, 600] }, r160x600: { t: '160×600', show: [160, 600] }, board: { t: 'Щит 2:1', show: [512, 256] } };
  const SECTIONS = [['games', '🎮 Игры'], ['videos', '🎬 Видео и главная'], ['world', '🌍 Мир 3D'], ['studio', '🛠️ Игры игроков'], ['other', '📄 Другие страницы']];
  const DEVICES = [['mobile', '📱 Телефон'], ['desktop', '💻 Компьютер']];
  const AGES = [['child', 'до 13 лет'], ['teen', '13–15'], ['teen16', '16–17'], ['adult', '18+'], ['unknown', 'возраст не указан']];
  const GEO = [['any', '🌐 Везде'], ['ru', '🇷🇺 Только Россия'], ['not_ru', '🌍 Кроме России']];
  // Возрастная метка рекламы (как у игр и роликов сайта) → кому из зрителей её можно (группы — js/core/age.js; «не указан» — по
  // ADS_RULES.age.unknown, обычно как 13–15). Сервер не выдаёт кампанию зрителю младше метки (ad_age_max в ads.sql)
  const RATINGS = [[0, 'всем'], [6, 'всем'], [12, 'с 13 лет'], [16, 'с 16 лет'], [18, 'только взрослым']];
  const ageChip = r => (r === 0 || r > 0) ? `<span class="adc-age">${+r}+</span>` : '';
  const STATUS = { draft: ['Черновик', '#a1a1b5'], review: ['На проверке', '#ffd166'], active: ['Показывается', '#4ade80'], paused: ['На паузе', '#7cc4ff'],
    finished: ['Завершена', '#a1a1b5'], rejected: ['Отклонена', '#fca5a5'], banned: ['Заблокирована', '#ff2d55'] };
  const PAUSED = { owner: 'поставил(а) ты', admin: 'поставил администратор', reports: 'жалобы зрителей — ждёт решения администратора' };
  const FINISH = { budget: 'бюджет израсходован', date: 'кончились даты показа', owner: 'остановил(а) ты', admin: 'остановил администратор' };
  const PLACES = { feed_games: 'Витрина игр', feed_videos: 'Лента видео', feed_ugc: 'Каталоги игр игроков', feed: 'Ленты', loading: 'Экраны загрузки',
    break: '«☕ Перерыв»', game_over: 'Под игрой после партии', games_hub: 'Раздел «Игры»', seo_game: 'Страницы игр', video_page: 'Страницы роликов',
    home_mid: 'Главная', rail: 'Столбик справа от игры', billboard: 'Щит в 3D-мире', other: 'Прочее' };
  const LOGACT = { create: 'Создана', submit: 'Отправлена на проверку', approve: '✅ Одобрена', reject: '⛔ Отклонена', pause: '⏸ Пауза', resume: '▶ Продолжена',
    finish: '🏁 Завершена', refund: '↩ Возврат', topup: '💎 Пополнение', edit: '✏️ Изменена', withdraw: '↩ Отозвана с проверки', ban: '🚫 Заблокирована', note: '📝 Заметка', rate: '🔞 Метка' };
  const URLWHY = { empty: 'Нужна ссылка на сайт', long: 'Слишком длинная ссылка', https: 'Ссылка должна начинаться с https://',
    chars: 'В ссылке пробелы, кавычки или угловые скобки', host: 'Странный адрес сайта (без IP, логина и порта)',
    short: 'Короткие ссылки (bit.ly, clck.ru, vk.cc…) нельзя — дай прямой адрес сайта', bad: 'В ссылке запрещённая тема' };
  const ERR = {
    auth: 'Сначала войди на сайт.', terms: 'Сначала прими правила рекламы.', not_found: 'Кампания не найдена.', locked: 'Законченную или заблокированную кампанию менять нельзя — сделай копию.',
    too_fast: 'Слишком часто — подожди пару секунд и попробуй ещё раз.', limit: 'Не больше 30 кампаний — удали старые черновики.', data: 'Ошибка данных — обнови страницу.',
    pricing: 'Неизвестный способ оплаты.', number: 'Проверь числа: ставку, бюджет, дни.', dates: 'Проверь даты: начало — не раньше сегодня, конец — не раньше начала.',
    geo: 'Неизвестная страна.', erid_ru: '«Только Россия» без erid — показов не будет: впиши erid из ОРД или выбери другую страну.', inn: 'ИНН — 10 или 12 цифр, БИН/ИИН — 12 цифр.', erid: 'erid — латинские буквы, цифры, «-» и «_», от 4 знаков (как выдал ОРД).',
    creatives: 'Добавь хотя бы один формат с картинкой.', kind: 'Неизвестный формат.', image: 'Картинка не загрузилась — выбери её ещё раз.',
    size: 'Картинка не того размера — выбери её ещё раз.', text: 'Слишком длинный текст.', title: 'У карточки нужен заголовок (от 2 букв).',
    advertiser: 'Укажи рекламодателя: ФИО ИП, название компании или имя блогера.', day_off: 'Пакеты «по дням» сейчас выключены — выбери оплату за показы.',
    age: 'Выбери возрастную метку рекламы: 0+, 6+, 12+, 16+ или 18+.', status: 'Сейчас так нельзя — у кампании другой статус.', off: 'Реклама временно выключена администратором.', act: 'Неизвестное действие.', why: 'Нужна причина (хотя бы пару слов).',
  };
  function errText(r){
    if (!r) return 'Нет связи с сервером — попробуй ещё раз.';
    if (r.reason === 'url') return URLWHY[r.why] || ERR.url || 'Плохая ссылка';
    if (r.reason === 'bad') return `Запрещённая тема: «${r.word}». Такую рекламу на сайте показывать нельзя — аудитория дети. Правила: /ads-terms`;
    if (r.reason === 'bid') return `Ставка ниже минимальной: нужно от ${gems(r.need)} за 1000 показов.`;
    if (r.reason === 'budget') return `Бюджет — от ${gems(r.min)} до ${gems(r.max)}.`;
    if (r.reason === 'amount') return `Пополнение — от ${gems(r.min)} до ${gems(r.max)}.`;
    if (r.reason === 'days') return `Дней — от 1 до ${r.max || 30}.`;
    if (r.reason === 'gems') return `Не хватает 💎: нужно ${gems(r.need)}. Пополнить — в магазине.`;
    return ERR[r.reason] || 'Не получилось — попробуй ещё раз.';
  }

  // ── Состояние и сервер ──
  const ST = { off: false, my: null, cfgGuest: null, seq: 0, ed: null, busy: false };
  const cfg = () => ST.my?.cfg || ST.cfgGuest || D().DEF || { prices: {}, min_budget: 200, max_budget: 100000, min_topup: 50, max_days: 30, terms: '' };
  async function api(fn, args){
    if (typeof sbClient === 'undefined' || !sbClient) return { error: { message: 'Нет связи с сервером' } };
    try {
      const { data, error } = await sbClient.rpc(fn, args || {});
      if (error && (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || ''))) ST.off = true;
      return { data, error };
    } catch (e) { return { error: e }; }
  }
  async function loadMy(){
    const { data } = await api('ad_my');
    if (data && data.ok) ST.my = data;
    return ST.my;
  }
  async function loadGuestCfg(){
    if (ST.cfgGuest) return;
    const { data } = await api('ad_prices');
    if (data && data.prices) ST.cfgGuest = data;
  }
  const balance = () => { const G = window.D37Gems; return G?.isOn?.() ? G.balance() : null; };

  // ── Окно ──
  function modal(html){
    let el = document.getElementById('adcModal');
    if (!el) {
      el = document.createElement('div'); el.id = 'adcModal'; el.className = 'shp-overlay adc-overlay';
      el.addEventListener('click', e => { if (e.target === el && !ST.busy) modalClose(); });
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="shp-modal adc-modal" role="dialog" aria-modal="true">${html}</div>`;
    el.classList.add('open');
    return el.firstElementChild;
  }
  function modalClose(){ document.getElementById('adcModal')?.classList.remove('open'); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('adcModal')?.classList.contains('open') && !ST.busy) modalClose(); });

  // ═══ Вход в раздел ═══
  async function render(param){
    const root = document.getElementById('advRoot');
    if (!root) return;
    wire(root);
    const seq = ++ST.seq;
    const [sec = '', id = ''] = String(param || '').split('/');
    if (!root.childElementCount) root.innerHTML = '<div class="adc-load">Загружаем кабинет…</div>';
    if (!authed()) { await loadGuestCfg(); if (seq === ST.seq) intro(root, 'login'); return; }
    await loadMy();
    if (seq !== ST.seq) return;
    if (ST.off || !ST.my) { if (!ST.off) await loadGuestCfg(); intro(root, ST.off ? 'off' : 'err'); return; }
    window.D37Gems?.sync?.();
    if (sec === 'admin' && ST.my.admin) return admin(root, id || 'review', seq);
    if (!ST.my.terms_ok) return terms(root, param);
    if (sec === 'new') return editor(root, null, seq);
    if (sec === 'edit' && id) return editor(root, id, seq);
    if (sec === 'c' && id) return campaign(root, id, seq);
    home(root, sec === 'how');
  }
  const rerender = () => render((location.hash.match(/^#\/adv\/?(.*)$/) || [])[1] || '');

  // ═══ Гостю и до запуска SQL: что это, форматы, цены, как работает ═══
  function intro(root, mode){
    const cta = mode === 'login'
      ? `<button type="button" class="pf-btn pf-btn-primary" data-a="login">Войти и создать кампанию</button>`
      : `<div class="adc-note">⏳ ${mode === 'off' ? 'Кабинет откроется, когда сайт обновится — совсем скоро.' : 'Сервер не ответил — обнови страницу чуть позже.'} Пока можно договориться напрямую — <a href="/reklama">медиакит и контакты</a>.</div>`;
    root.innerHTML = `
      <section class="adc-hero pf-card pf-card-accent">
        <div class="adc-hero-t">
          <h3>Своя реклама на сайте Денчика37 — сам, за 💎</h3>
          <p>Блогер, магазин, свой проект? Сделай кампанию сам: картинка, текст и ссылка. После проверки реклама сама показывается зрителям сайта — в ленте игр и видео, на экранах загрузки, под играми, справа от игры и на щите в 3D-мире. Статистика — каждый день, остаток 💎 возвращается.</p>
          <div class="adc-cta">${cta}<a class="pf-btn pf-btn-ghost pf-btn-sm" href="/ads-terms" target="_blank" rel="noopener">📜 Правила рекламы</a><a class="pf-btn pf-btn-ghost pf-btn-sm" href="/reklama">📊 Медиакит</a></div>
        </div>
        <div class="adc-hero-pv" aria-hidden="true">${mockNative()}</div>
      </section>
      ${formatsBlock()}${pricesBlock()}${howBlock(true)}`;
  }
  function mockNative(){
    return `<div class="d37-feed d37-dad adc-mock"><div class="dad dad-native"><div class="dad-lbl"><span class="dad-lbl-t">Реклама · <b>Твой канал</b> · erid: 2Vtz…</span><span class="dad-i">ⓘ</span></div>
      <span class="dad-a"><span class="dad-img adc-mock-img">🎬</span><b class="dad-t">Новые ролики про Roblox каждую неделю</b><span class="dad-d">Подпишись — первым увидишь обновления</span>
      <span class="dad-foot"><span class="dad-host">youtube.com ↗</span><span class="dad-cta">Смотреть</span></span></span></div></div>`;
  }
  function formatsBlock(){
    return `<section class="adc-sec"><h3 class="adc-h">Где показывается</h3><div class="adc-formats">${GROUPS.map(f => `<div class="adc-format pf-card pf-card-muted">
      <span class="adc-format-ic">${f.icon}</span><b>${esc(f.t)}</b><small>${esc(f.d)}</small><em>${f.kinds.map(k => KIND[k].t).join(' · ')}</em></div>`).join('')}</div></section>`;
  }
  function pricesBlock(){
    const c = cfg(), P = c.prices || {};
    return `<section class="adc-sec"><h3 class="adc-h">Цены</h3><div class="adc-prices pf-card pf-card-gold">
      <table class="adc-tab"><thead><tr><th>Формат</th><th>за 1000 показов (CPM)</th><th>пакет «день»</th></tr></thead><tbody>
      ${GROUPS.map(f => `<tr><td>${f.icon} ${esc(f.t)}</td><td>от <b>${gems(P[f.g]?.cpm)}</b></td><td>${c.day_on === false ? '—' : `<b>${gems(P[f.g]?.day)}</b> в день`}</td></tr>`).join('')}
      </tbody></table>
      <p class="adc-small">Минимальный бюджет за показы — ${gems(c.min_budget)}. 1 💎 ≈ 1 ₽ (100 💎 = донат 100 ₽). Пакет «по дням» — несколько форматов складываются. Клики бесплатны — платишь только за показы (или дни). <a href="#/shop">Где взять 💎</a></p>
    </div></section>`;
  }
  function howBlock(open){
    const c = cfg();
    return `<details class="adc-how pf-card pf-card-tw"${open ? ' open' : ''}><summary><b>❓ Как это работает</b></summary>
      <ol class="adc-steps">
        <li><b>Создай кампанию:</b> ссылка на сайт, рекламодатель, картинки и текст — превью сразу покажет, как это будет выглядеть.</li>
        <li><b>Выбери, кому и где:</b> возрастная метка рекламы (0+…18+ — реклама не покажется тем, кто младше), разделы сайта, телефон или компьютер, возраст, Россия или другие страны, даты.</li>
        <li><b>Оплата 💎:</b> за 1000 показов (ставка — от минимальной; выше ставка — чаще показ) или пакет «по дням». При отправке бюджет переходит в копилку кампании.</li>
        <li><b>Проверка:</b> обычно в течение дня. Отклонили — 💎 сразу возвращаются, причина видна в кабинете.</li>
        <li><b>Показ:</b> реклама сама встаёт в свободные места. Показ засчитывается, только когда реклама видна хотя бы наполовину не меньше секунды, — раз в ${c.dedup_min || 30} минут на зрителя и не больше ${c.freq_day || 6} раз в день. Свои показы не считаются, VIP рекламу не видят.</li>
        <li><b>Статистика:</b> показы, клики, CTR и расход по дням. Пауза, пополнение, остановка — в любой момент; неизрасходованные 💎 возвращаются сами.</li>
      </ol>
      <p class="adc-small">Аудитория — в основном дети и подростки: нельзя азартные игры и кейсы, ставки, алкоголь, табак и вейпы, 18+ и знакомства, оружие, крипту и «лёгкие деньги», займы, лекарства, обман вроде «скачай» / «ты выиграл». Для показа в России нужен <b>erid</b> из ОРД (без него — только в других странах). Подробно — <a href="/ads-terms" target="_blank" rel="noopener">правила рекламы</a>.</p>
    </details>`;
  }

  // ═══ Правила — один раз перед первой кампанией ═══
  function terms(root, back){
    const a = ST.my?.advertiser || {};
    root.innerHTML = `<section class="adc-terms pf-card pf-card-gold">
      <h3>📜 Перед первой кампанией — правила рекламы</h3>
      <ul class="adc-list-dot">
        <li>Реклама показывается детям и подросткам — запрещены азарт, кейсы и ставки, алкоголь, табак и вейпы, 18+, оружие, крипта и «лёгкие деньги», займы, лекарства, обман. У каждой кампании — возрастная метка (0+…18+): младшим зрителям она не показывается, детям до 13 — только 0+ и 6+.</li>
        <li>Каждую кампанию проверяет администратор. Отклонили — 💎 возвращаются. Неизрасходованный остаток возвращается всегда.</li>
        <li>Для показа в России нужен <b>erid</b> из ОРД — его получает рекламодатель (или его агентство). Без erid реклама идёт только в другие страны. На рекламе всегда пишем «Реклама · рекламодатель».</li>
        <li>Ты — рекламодатель или действуешь по его поручению и отвечаешь за содержание и ссылку.</li>
      </ul>
      <p><a href="/ads-terms" target="_blank" rel="noopener">Прочитать правила целиком →</a></p>
      <div class="adc-grid2">
        <label class="adc-f"><span>Рекламодатель по умолчанию <small>(можно поменять в кампании)</small></span><input id="adcTName" maxlength="120" value="${esc(a.name || '')}" placeholder="ИП Иванов И. И., ООО «Ромашка» или имя блогера"></label>
        <label class="adc-f"><span>ИНН / БИН <small>(необязательно)</small></span><input id="adcTInn" maxlength="12" inputmode="numeric" value="${esc(a.inn || '')}" placeholder="10 или 12 цифр"></label>
      </div>
      <label class="shp-consent"><input type="checkbox" id="adcTOk"> <span>Я прочитал(а) правила рекламы (редакция ${esc(cfg().terms || '')}) и согласен(на) с ними.</span></label>
      <div class="adc-err" role="alert"></div>
      <div class="adc-act"><a class="pf-btn pf-btn-ghost" href="#/home">Не сейчас</a><button type="button" class="pf-btn pf-btn-gold" data-a="terms" data-back="${esc(back || '')}">Принимаю</button></div>
    </section>${howBlock(false)}`;
  }
  async function acceptTerms(btn){
    const err = $('.adc-terms .adc-err');
    if (!$('#adcTOk')?.checked) { err.textContent = 'Отметь галочку — без согласия с правилами кампании не запускаются.'; return; }
    const inn = $('#adcTInn').value.trim();
    if (inn && !/^(\d{10}|\d{12})$/.test(inn)) { err.textContent = ERR.inn; return; }
    btn.disabled = true;
    const { data } = await api('ad_terms_accept', { p_version: cfg().terms, p_name: $('#adcTName').value.trim(), p_inn: inn });
    btn.disabled = false;
    if (!data?.ok) { err.textContent = data?.reason === 'version' ? 'Правила обновились — обнови страницу.' : errText(data); return; }
    await render(btn.dataset.back || '');
  }

  // ═══ Мои кампании ═══
  function statusChip(c){
    const [t, col] = STATUS[c.status] || [c.status, '#aaa'];
    return `<span class="adc-st" style="--st:${col}">${esc(t)}</span>`;
  }
  function priceLine(c){
    return c.pricing === 'day' ? `пакет ${c.days} ${plural(c.days, 'день', 'дня', 'дней')} × ${gems(c.day_price || dayPrice(c.groups))}` : `${gems(c.bid)} за 1000 показов`;
  }
  const ctr = (v, k) => v ? dec(k / v * 100, 2) + ' %' : '—';
  function home(root, openHow){
    const list = ST.my.campaigns || [], bal = balance();
    root.innerHTML = `
      <div class="adc-top pf-card pf-card-gold">
        <div class="adc-bal"><span>💎 <b class="js-gems">${bal == null ? '—' : num(bal)}</b></span><small>на балансе — бюджет кампаний списывается отсюда</small></div>
        <div class="adc-top-act">
          <a class="pf-btn pf-btn-ghost pf-btn-sm" href="#/shop">Пополнить 💎</a>
          ${ST.my.admin ? '<a class="pf-btn pf-btn-tw pf-btn-sm" href="#/adv/admin">🛡 Модерация</a>' : ''}
          <a class="pf-btn pf-btn-primary" href="#/adv/new">➕ Новая кампания</a>
        </div>
      </div>
      <h3 class="adc-h">Мои кампании</h3>
      ${list.length ? `<div class="adc-cards">${list.map(card).join('')}</div>` : `<div class="adc-empty pf-card pf-card-muted"><b>Пока ни одной кампании</b><span>Создай первую — превью покажет, как реклама будет выглядеть на сайте.</span><a class="pf-btn pf-btn-primary" href="#/adv/new">➕ Создать кампанию</a></div>`}
      ${howBlock(openHow || !list.length)}${pricesBlock()}`;
    thumbs(root);
  }
  function card(c){
    const cap = Math.max(0, c.budget - c.refunded), pct = cap ? Math.min(100, Math.round(Number(c.spent) / cap * 100)) : 0;   // отклонённая — всё вернулось, копилки нет
    const sub = c.status === 'paused' ? PAUSED[c.paused_by] : c.status === 'finished' ? FINISH[c.finish_reason] : c.status === 'rejected' ? (c.reject_reason || '') : c.changed ? 'изменена — ждёт проверки' : '';
    return `<a class="adc-card pf-card pf-card-muted" href="#/adv/c/${esc(c.id)}">
      <span class="adc-thumb"${c.thumb ? ` data-img="${esc(c.thumb)}"` : ''}>${c.thumb ? '' : '📣'}</span>
      <span class="adc-card-b">
        <b class="adc-card-t">${esc(c.title)}</b>
        <span class="adc-card-m">${statusChip(c)}${ageChip(c.age_rating)}<small>${esc(priceLine(c))}</small></span>
        ${sub ? `<small class="adc-card-sub">${esc(sub)}</small>` : ''}
        ${cap ? `<span class="adc-bar" title="Потрачено ${dec(c.spent)} из ${num(cap)} 💎"><i style="width:${pct}%"></i></span>` : ''}
        <small class="adc-card-s">👁 ${num(c.views)} · 👆 ${num(c.clicks)} · CTR ${ctr(c.views, c.clicks)}${cap ? ` · ${dec(c.spent)} / ${num(cap)} 💎` : ''}</small>
      </span></a>`;
  }
  async function thumbs(root){
    for (const el of $$('[data-img]', root)) {
      const u = await D().img?.(el.dataset.img);
      if (u && el.isConnected) { el.style.backgroundImage = `url("${u.replace(/"/g, '%22')}")`; el.classList.add('has'); }
    }
  }

  // ═══ Редактор кампании ═══
  const SZ = k => (RL().SIZES || {})[k] || [600, 500];
  function blankEd(){
    const a = ST.my?.advertiser || {}, c = cfg();
    return { id: null, status: 'draft', locked: false, approved: false,
      c: { title: '', url: '', advertiser: a.name || '', inn: a.inn || '', erid: '', pricing: 'cpm', bid: (c.prices?.native?.cpm || 70), plan_budget: Math.max(c.min_budget || 200, 500),
        days: 3, start_date: mskDay(), end_date: '', sections: [], devices: [], ages: [], geo: 'any', age_rating: null },
      on: { native: true, banner: false, rail: false, board: false }, cr: {}, color: '#ff2d55' };
  }
  const groupsOn = E => GROUPS.filter(f => E.on[f.g]).map(f => f.g);
  const dayPrice = gs => (gs || []).reduce((s, g) => s + (cfg().prices?.[g]?.day || 0), 0);
  const floorOf = gs => Math.max(0, ...(gs || []).map(g => cfg().prices?.[g]?.cpm || 0));
  async function editor(root, id, seq){
    let E = blankEd();
    if (id) {
      const { data } = await api('ad_get', { p_id: id });
      if (seq !== ST.seq) return;
      if (!data?.ok || !data.own) { root.innerHTML = `<div class="adc-empty pf-card pf-card-muted"><b>Кампания не найдена</b><a class="pf-btn pf-btn-ghost" href="#/adv">← Мои кампании</a></div>`; return; }
      const c = data.c;
      if (['finished', 'banned'].includes(c.status)) { location.hash = '#/adv/c/' + c.id; return; }
      E = { id: c.id, status: c.status, locked: !['draft', 'rejected'].includes(c.status), approved: c.approved, color: '#ff2d55',
        c: { title: c.title, url: c.url, advertiser: c.advertiser, inn: c.inn, erid: c.erid, pricing: c.pricing, bid: c.bid, plan_budget: c.plan_budget || cfg().min_budget,
          days: c.days || 3, start_date: c.start_date ? String(c.start_date).slice(0, 10) : mskDay(), end_date: c.end_date ? String(c.end_date).slice(0, 10) : '',
          sections: c.sections || [], devices: c.devices || [], ages: c.ages || [], geo: c.geo || 'any', age_rating: c.age_rating ?? null },
        on: { native: false, banner: false, rail: false, board: false }, cr: {} };
      for (const cr of data.creatives || []) {
        const g = (RL().KIND_GROUP || {})[cr.kind]; if (g) E.on[g] = true;
        E.cr[cr.kind] = { title: cr.title, body: cr.body, cta: cr.cta, image: cr.image, w: cr.w, h: cr.h, src: '' };
        D().img?.(cr.image).then(u => { if (u && E.cr[cr.kind]?.image === cr.image) { E.cr[cr.kind].src = u; refresh(E); paintPick(E, cr.kind); } });
      }
      if (!Object.values(E.on).some(Boolean)) E.on.native = true;
    }
    ST.ed = E;
    const c = E.c, today = mskDay();
    const lockNote = E.locked ? `<div class="adc-note">✏️ Кампания уже отправлена: тип оплаты, бюджет и дата начала не меняются (пополнить — на странице кампании). Если поменять картинки, тексты, ссылку, рекламодателя, erid, возрастную метку или «кому показывать» — кампания снова уйдёт на проверку и до одобрения показываться не будет.</div>` : '';
    root.innerHTML = `
      <div class="adc-crumbs"><a href="#/adv">← Мои кампании</a>${E.id ? ` · <a href="#/adv/c/${esc(E.id)}">статистика</a>` : ''}</div>
      <h3 class="adc-h">${E.id ? 'Кампания: правка' : 'Новая кампания'} ${E.id ? statusChip({ status: E.status }) : ''}</h3>
      ${lockNote}
      <div class="adc-ed">
        <div class="adc-ed-main">
          <section class="pf-card pf-card-accent adc-box"><h4>1. Что рекламируем</h4>
            <label class="adc-f"><span>Название кампании <small>(видишь только ты)</small></span><input data-f="title" maxlength="60" value="${esc(c.title)}" placeholder="Например: Канал — октябрь"></label>
            <label class="adc-f"><span>Ссылка — куда ведёт реклама</span><input data-f="url" maxlength="500" inputmode="url" value="${esc(c.url)}" placeholder="https://…"><small class="adc-hint" data-hint="url"></small></label>
            <div class="adc-grid2">
              <label class="adc-f"><span>Рекламодатель <small>(показывается на рекламе)</small></span><input data-f="advertiser" maxlength="120" value="${esc(c.advertiser)}" placeholder="ИП Иванов И. И. / ООО «Ромашка» / имя блогера"></label>
              <label class="adc-f"><span>ИНН / БИН <small>(необязательно)</small></span><input data-f="inn" maxlength="12" inputmode="numeric" value="${esc(c.inn)}" placeholder="10 или 12 цифр"></label>
            </div>
            <label class="adc-f"><span>erid <small>(токен из ОРД — нужен для показа в России)</small></span><input data-f="erid" maxlength="64" value="${esc(c.erid)}" placeholder="например 2VtzqwXYZ…"><small class="adc-hint" data-hint="erid"></small></label>
          </section>
          <section class="pf-card pf-card-tw adc-box"><h4>2. Форматы и картинки</h4>
            <div class="adc-groups">${GROUPS.map(f => `<label class="adc-grp${E.on[f.g] ? ' on' : ''}"><input type="checkbox" data-grp="${f.g}"${E.on[f.g] ? ' checked' : ''}><span class="adc-grp-ic">${f.icon}</span><span><b>${esc(f.t)}</b><small>${esc(f.d)}</small></span></label>`).join('')}</div>
            <div class="adc-crs">${GROUPS.map(f => crBlock(E, f)).join('')}</div>
            <label class="adc-f adc-color"><span>Цвет кнопки и фона для «🪄 Из карточки»</span><input type="color" data-f="color" value="${esc(E.color)}"></label>
          </section>
          <section class="pf-card pf-card-muted adc-box"><h4>3. Кому показывать <small>(ничего не выбрано — всем)</small></h4>
            <div class="adc-chk-row adc-age-row"><span>Возрастная метка рекламы — обязательно <small>(как у игр и роликов сайта)</small></span>${RATINGS.map(([n, t]) => `<label class="adc-chk"><input type="radio" name="adcAge" data-agerating="${n}"${c.age_rating === n ? ' checked' : ''}> <b>${n}+</b> <small>${t}</small></label>`).join('')}</div>
            <small class="adc-hint" data-hint="age"></small>
            <div class="adc-chk-row"><span>Разделы</span>${SECTIONS.map(([v, t]) => chk('sections', v, t, c.sections)).join('')}<span class="adc-chk adc-chk-soon" title="В чате и сообществах рекламы пока нет">💬 Чат — скоро</span></div>
            <div class="adc-chk-row"><span>Устройства</span>${DEVICES.map(([v, t]) => chk('devices', v, t, c.devices)).join('')}</div>
            <div class="adc-chk-row"><span>Возраст</span>${AGES.map(([v, t]) => chk('ages', v, t, c.ages)).join('')}</div>
            <div class="adc-chk-row"><span>Страна</span>${GEO.map(([v, t]) => `<label class="adc-chk"><input type="radio" name="adcGeo" data-geo="${v}"${c.geo === v ? ' checked' : ''}> ${t}</label>`).join('')}</div>
            <small class="adc-hint" data-hint="geo"></small>
            <p class="adc-small">Возраст зритель указывает сам (или не указывает) — «возраст не указан» включает гостей. Страна — по IP; если её не узнать, считаем Россией.</p>
          </section>
          <section class="pf-card pf-card-gold adc-box"><h4>4. Даты и оплата</h4>
            <div class="adc-pay">
              <label class="adc-pay-opt${c.pricing === 'cpm' ? ' on' : ''}"><input type="radio" name="adcPay" data-pay="cpm"${c.pricing === 'cpm' ? ' checked' : ''}${E.locked ? ' disabled' : ''}><b>За показы (CPM)</b><small>платишь за каждую 1000 засчитанных показов; выше ставка — чаще показ</small></label>
              ${cfg().day_on === false && c.pricing !== 'day' ? '' : `<label class="adc-pay-opt${c.pricing === 'day' ? ' on' : ''}"><input type="radio" name="adcPay" data-pay="day"${c.pricing === 'day' ? ' checked' : ''}${E.locked ? ' disabled' : ''}><b>Пакет «по дням»</b><small>фиксированная цена за день — показы весь день, сколько будет</small></label>`}
            </div>
            <div class="adc-grid2">
              <label class="adc-f"><span>Начало</span><input type="date" data-f="start_date" min="${today}" value="${esc(c.start_date)}"${E.locked ? ' disabled' : ''}></label>
              <label class="adc-f adc-only-cpm"><span>Конец <small>(необязательно)</small></span><input type="date" data-f="end_date" min="${today}" value="${esc(c.end_date)}"></label>
              <label class="adc-f adc-only-day"><span>Дней</span><input type="number" data-f="days" min="1" max="${cfg().max_days || 30}" value="${esc(c.days)}"${E.locked ? ' disabled' : ''}></label>
            </div>
            <div class="adc-grid2 adc-only-cpm">
              <label class="adc-f"><span>Ставка, 💎 за 1000 показов</span><input type="number" data-f="bid" min="1" step="1" value="${esc(c.bid)}"><small class="adc-hint" data-hint="bid"></small></label>
              <label class="adc-f"><span>Бюджет, 💎</span><input type="number" data-f="plan_budget" min="${cfg().min_budget}" step="10" value="${esc(c.plan_budget)}"${E.locked ? ' disabled' : ''}></label>
            </div>
            <div class="adc-calc" data-calc></div>
          </section>
        </div>
        <aside class="adc-ed-side">
          <section class="pf-card pf-card-muted adc-box adc-pv-box"><h4>Превью — как на сайте</h4><div class="adc-pv" data-pv></div></section>
        </aside>
      </div>
      <div class="adc-err" role="alert" data-err></div>
      <div class="adc-act adc-act-sticky">
        <a class="pf-btn pf-btn-ghost" href="${E.id ? '#/adv/c/' + esc(E.id) : '#/adv'}">Отмена</a>
        <button type="button" class="pf-btn pf-btn-ghost" data-a="save">💾 ${E.locked ? 'Сохранить изменения' : 'Сохранить черновик'}</button>
        ${['draft', 'rejected'].includes(E.status) ? '<button type="button" class="pf-btn pf-btn-gold" data-a="submit" data-sum>📤 Отправить на проверку</button>' : ''}
      </div>`;
    for (const k of Object.keys(E.cr)) paintPick(E, k);
    refresh(E);
  }
  const chk = (f, v, t, arr) => `<label class="adc-chk"><input type="checkbox" data-arr="${f}" value="${v}"${(arr || []).includes(v) ? ' checked' : ''}> ${t}</label>`;
  function crBlock(E, f){
    const kinds = f.kinds.map(k => {
      const [w, h] = SZ(k), cr = E.cr[k] || {};
      const magic = k !== 'native' ? `<button type="button" class="adc-mini" data-a="magic" data-k="${k}" title="Нарисовать из картинки и текста карточки">🪄 Из карточки</button>` : '';
      return `<div class="adc-cr" data-cr="${k}">
        <div class="adc-pick" data-pick="${k}"><span class="adc-pick-img"></span><span class="adc-pick-t"><b>${KIND[k].t}</b><small>картинка ${w}×${h} — обрежем сами</small></span></div>
        <div class="adc-cr-act"><label class="adc-mini adc-file">🖼 Выбрать<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-file="${k}" hidden></label>
          <label class="adc-mini adc-fit" title="Картинка целиком, с полями"><input type="checkbox" data-fit="${k}"> вписать</label>${magic}
          <button type="button" class="adc-mini" data-a="drop" data-k="${k}"${cr.image || cr.blob ? '' : ' hidden'}>✕</button></div>
        ${k === 'native' ? `<label class="adc-f"><span>Заголовок</span><input data-cr-f="title" data-k="native" maxlength="40" value="${esc(cr.title || '')}" placeholder="До 40 знаков"></label>
          <label class="adc-f"><span>Текст</span><input data-cr-f="body" data-k="native" maxlength="90" value="${esc(cr.body || '')}" placeholder="До 90 знаков"></label>
          <label class="adc-f"><span>Кнопка</span><input data-cr-f="cta" data-k="native" maxlength="20" value="${esc(cr.cta || '')}" placeholder="Смотреть / Играть / Подробнее"></label>` : ''}
        ${k === 'board' ? `<label class="adc-f"><span>Подпись к щиту <small>(для окошка в мире)</small></span><input data-cr-f="title" data-k="board" maxlength="40" value="${esc(cr.title || '')}"></label>` : ''}
      </div>`;
    }).join('');
    return `<div class="adc-crg" data-crg="${f.g}"${E.on[f.g] ? '' : ' hidden'}><div class="adc-crg-h">${f.icon} ${esc(f.t)}${f.kinds.length > 1 ? ' <small>— можно один размер, лучше оба</small>' : ''}</div>${kinds}</div>`;
  }
  function paintPick(E, k){
    const box = $(`[data-pick="${k}"] .adc-pick-img`), cr = E.cr[k];
    if (!box) return;
    const [w, h] = SZ(k);
    box.style.aspectRatio = `${w}/${h}`;
    box.style.backgroundImage = cr?.src ? `url("${cr.src.replace(/"/g, '%22')}")` : '';
    box.classList.toggle('has', !!cr?.src);
    const drop = $(`[data-a="drop"][data-k="${k}"]`); if (drop) drop.hidden = !(cr?.image || cr?.blob);
  }

  // Предпросмотр и расчёт — без перерисовки формы (курсор в полях не прыгает)
  let refreshT = 0;
  function refresh(E, now){
    clearTimeout(refreshT);
    if (!now) { refreshT = setTimeout(() => refresh(E, true), 90); return; }
    if (ST.ed !== E) return;
    const root = document.getElementById('advRoot');
    if (!root) return;
    const c = E.c, gs = groupsOn(E), R = RL();
    root.classList.toggle('adc-day', c.pricing === 'day');
    const hint = (k, t, bad) => { const el = $(`[data-hint="${k}"]`, root); if (el) { el.textContent = t || ''; el.classList.toggle('bad', !!bad); } };
    const ub = c.url ? R.urlBad?.(c.url) : '';
    hint('url', !c.url ? 'На рекламе будет виден домен сайта.' : ub ? URLWHY[ub] : `На рекламе будет: ${R.hostOf?.(c.url)} ↗`, !!ub);
    hint('erid', c.erid ? '' : 'Без erid реклама в России не показывается — только в других странах.', false);
    hint('geo', !c.erid && c.geo !== 'not_ru' ? '⚠ erid не указан — показы в России будут пропущены (закон о маркировке рекламы).' : '', !c.erid && c.geo !== 'not_ru');
    hint('age', c.age_rating == null ? 'Выбери метку: аудитория сайта — в основном дети; реклама с меткой старше зрителя ему не покажется.'
      : c.age_rating >= 16 ? `${c.age_rating}+ — детям и подросткам до ${c.age_rating} не покажется (как и тем, кто возраст не указал).` : '', c.age_rating == null);
    const fl = floorOf(gs);
    hint('bid', fl ? `минимум для выбранных форматов — ${gems(fl)}` : '', +c.bid < fl);
    // расчёт
    const calc = $('[data-calc]', root);
    if (calc) {
      if (c.pricing === 'day') {
        const dp = dayPrice(gs), total = dp * (+c.days || 0), end = c.start_date ? addDays(c.start_date, Math.max(0, (+c.days || 1) - 1)) : '';
        calc.innerHTML = `<b>${gems(total)}</b> <span>= ${num(c.days)} ${plural(+c.days, 'день', 'дня', 'дней')} × ${gems(dp)} (${gs.map(g => GROUPS.find(f => f.g === g).t.toLowerCase()).join(' + ') || 'выбери форматы'})</span>${end ? `<small>показ ${ruDate(c.start_date)} — ${ruDate(end)}; день списывается при первом показе этого дня, неиспользованные дни вернутся</small>` : ''}`;
      } else {
        const v = +c.bid > 0 ? Math.floor(+c.plan_budget / +c.bid * 1000) : 0;
        calc.innerHTML = `<b>≈ ${num(v)} ${plural(v, 'показ', 'показа', 'показов')}</b> <span>за ${gems(c.plan_budget)} при ставке ${gems(c.bid)} за 1000</span><small>считаем только показы, где реклама видна хотя бы наполовину не меньше секунды; клики бесплатно; остаток вернётся</small>`;
      }
      const sum = submitSum(E), bal = balance(), btn = $('[data-sum]', root);
      if (btn) btn.textContent = `📤 Отправить на проверку — ${gems(sum)}`;
      if (bal != null && sum > bal && !E.locked) calc.insertAdjacentHTML('beforeend', `<small class="bad">На балансе ${gems(bal)} — не хватает ${gems(sum - bal)}. <a href="#/shop">Пополнить 💎</a></small>`);
    }
    // превью
    const pv = $('[data-pv]', root);
    if (pv) pv.innerHTML = gs.length ? gs.map(g => preview(E, g)).join('') : '<p class="adc-small">Выбери хотя бы один формат.</p>';
  }
  const submitSum = E => E.c.pricing === 'day' ? dayPrice(groupsOn(E)) * (+E.c.days || 0) : (+E.c.plan_budget || 0);
  // Тот же вид, что у настоящей рекламы (стили .dad-* — js/core/ad-direct.js)
  function preview(E, g){
    const c = E.c, host = RL().hostOf?.(c.url) || 'сайт.рф', lbl = `<div class="dad-lbl"><span class="dad-lbl-t">Реклама${c.age_rating != null ? ` <span class="dad-age">${c.age_rating}+</span>` : ''} · <b>${esc(c.advertiser || 'рекламодатель')}</b>${c.erid ? ` · erid: ${esc(c.erid)}` : ''}</span><span class="dad-i">ⓘ</span></div>`;
    const img = (k, alt) => E.cr[k]?.src ? `<img src="${esc(E.cr[k].src)}" alt="${esc(alt || '')}">` : `<span class="dad-noimg">${KIND[k].t}<br>нет картинки</span>`;
    if (g === 'native') {
      const n = E.cr.native || {};
      return `<div class="adc-pv-i"><small>🗂 Карточка в ленте</small><div class="d37-feed d37-dad adc-pv-native"><div class="dad dad-native">${lbl}<span class="dad-a"><span class="dad-img">${img('native')}</span>
        <b class="dad-t">${esc(n.title || 'Заголовок карточки')}</b>${n.body ? `<span class="dad-d">${esc(n.body)}</span>` : ''}<span class="dad-foot"><span class="dad-host">${esc(host)} ↗</span>${n.cta ? `<span class="dad-cta">${esc(n.cta)}</span>` : ''}</span></span></div></div></div>`;
    }
    if (g === 'board') {
      const b = E.cr.board || {};
      return `<div class="adc-pv-i"><small>🌍 Щит в 3D-мире</small><div class="adc-board"><div class="adc-board-face">${img('board', b.title)}<span class="adc-board-tag">РЕКЛАМА</span><span class="adc-board-mark">Реклама${c.age_rating != null ? ` ${c.age_rating}+` : ''} · ${esc(c.advertiser || 'рекламодатель')}${c.erid ? ' · erid: ' + esc(c.erid) : ''}</span></div><i></i><i></i></div></div>`;
    }
    return GROUPS.find(f => f.g === g).kinds.filter(k => E.cr[k]?.src || E.cr[k]?.image).map(k => {
      const [dw, dh] = KIND[k].show;
      return `<div class="adc-pv-i"><small>${g === 'rail' ? '📏 Столбик' : '🖼 Баннер'} ${KIND[k].t}</small><div class="dad dad-${g}" style="--dad-w:${dw}px;--dad-ar:${dw}/${dh}">${lbl}<span class="dad-a">${img(k)}</span><span class="dad-host">${esc(host)} ↗</span></div></div>`;
    }).join('') || `<div class="adc-pv-i"><small>${g === 'rail' ? '📏 Столбик' : '🖼 Баннер'}</small><p class="adc-small">Добавь картинку — или «🪄 Из карточки».</p></div>`;
  }

  // ── Картинки: под точный размер формата, webp/jpeg до 500 КБ ──
  function loadBitmap(src){
    return new Promise((res, rej) => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => res(im); im.onerror = () => rej(new Error('Картинку не открыть — выбери другую'));
      im.src = src;
    });
  }
  function drawFit(g, im, W, H, fit, bg){
    const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
    const s = fit === 'contain' ? Math.min(W / w, H / h) : Math.max(W / w, H / h);
    if (fit === 'contain') { g.fillStyle = bg || '#0f172a'; g.fillRect(0, 0, W, H); }
    g.drawImage(im, (W - w * s) / 2, (H - h * s) / 2, w * s, h * s);
  }
  async function encode(cv){
    for (const [type, q] of [['image/webp', .88], ['image/webp', .74], ['image/jpeg', .86], ['image/jpeg', .72], ['image/jpeg', .56]]) {
      const b = await new Promise(r => cv.toBlob(r, type, q));
      if (b && b.type === type && b.size <= 500 * 1024) return { blob: b, ext: type === 'image/webp' ? 'webp' : 'jpg', type };
    }
    throw new Error('Картинка получилась слишком тяжёлой — выбери попроще');
  }
  async function prepFile(file, k, fit){
    if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Нужна картинка PNG, JPG или WebP (SVG нельзя)');
    if (file.size > 15 * 1024 * 1024) throw new Error('Файл больше 15 МБ — выбери поменьше');
    const url = URL.createObjectURL(file);
    try {
      const im = await loadBitmap(url);
      const [W, H] = SZ(k), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      drawFit(cv.getContext('2d'), im, W, H, fit ? 'contain' : 'cover', '#0f172a');
      return await encode(cv);
    } finally { URL.revokeObjectURL(url); }
  }
  function wrapText(g, text, x, y, maxW, lh, lines){
    const words = String(text || '').split(/\s+/).filter(Boolean); let line = '', n = 0;
    for (let i = 0; i < words.length; i++) {
      const t = line ? line + ' ' + words[i] : words[i];
      if (g.measureText(t).width > maxW && line) {
        if (n === lines - 1) { while (line && g.measureText(line + '…').width > maxW) line = line.slice(0, -1); g.fillText(line + '…', x, y + n * lh); return n + 1; }
        g.fillText(line, x, y + n * lh); n++; line = words[i];
      } else line = t;
    }
    if (line) { g.fillText(line, x, y + n * lh); n++; }
    return n;
  }
  function pill(g, x, y, w, h, color, text, size){
    g.fillStyle = color; g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, h / 2); else g.rect(x, y, w, h);
    g.fill(); g.fillStyle = '#fff'; g.font = `800 ${size}px Montserrat, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, x + w / 2, y + h / 2 + 1); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  }
  // «🪄 Из карточки»: картинка карточки + заголовок + текст + кнопка, под размер формата
  async function fromCard(E, k){
    const n = E.cr.native;
    if (!n?.src || !n.title) throw new Error('Сначала заполни карточку: картинку и заголовок');
    const im = await loadBitmap(n.src);
    const [W, H] = SZ(k), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), col = E.color || '#ff2d55', host = RL().hostOf?.(E.c.url) || '';
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#0d0d16'); gr.addColorStop(1, '#1b1b2b');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const pic = (x, y, w, h) => { g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); drawFit(g, im, w, h, 'cover'); g.restore(); };
    const put = (x, y, w, h) => { g.save(); g.translate(x, y); pic(0, 0, w, h); g.restore(); };
    const T = (size, weight = 800) => { g.font = `${weight} ${size}px Montserrat, Arial, sans-serif`; g.fillStyle = '#fff'; };
    const cta = n.cta || 'Подробнее';
    if (k === 'b300x250') {
      put(0, 0, W, 290);
      T(38); wrapText(g, n.title, 28, 344, W - 56, 44, 2);
      if (n.body) { T(24, 600); g.fillStyle = 'rgba(255,255,255,.75)'; wrapText(g, n.body, 28, 424, W - 300, 30, 2); }
      pill(g, W - 230, H - 82, 202, 58, col, cta, 26);
    } else if (k === 'b728x90') {
      put(0, 0, 320, H);
      T(46); wrapText(g, n.title, 352, 76, W - 352 - 290, 50, 1);
      if (n.body) { T(28, 600); g.fillStyle = 'rgba(255,255,255,.75)'; wrapText(g, n.body, 352, 128, W - 352 - 290, 32, 1); }
      pill(g, W - 262, (H - 76) / 2, 232, 76, col, cta, 30);
    } else if (k === 'r160x600' || k === 'r300x600') {
      const big = k === 'r300x600', ih = Math.round(W * 9 / 16);
      put(0, 0, W, ih);
      T(big ? 54 : 36); const l = wrapText(g, n.title, 24, ih + (big ? 90 : 70), W - 48, big ? 62 : 44, 4);
      if (n.body) { T(big ? 34 : 26, 600); g.fillStyle = 'rgba(255,255,255,.75)'; wrapText(g, n.body, 24, ih + (big ? 110 : 90) + l * (big ? 62 : 44), W - 48, big ? 44 : 34, 5); }
      if (host) { T(big ? 26 : 22, 700); g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(host, 24, H - (big ? 170 : 150)); }
      pill(g, 24, H - (big ? 128 : 110), W - 48, big ? 92 : 76, col, cta, big ? 36 : 28);
    } else if (k === 'board') {
      put(0, 0, 560, H - 50);
      T(56); const l = wrapText(g, n.title, 592, 120, W - 592 - 30, 64, 3);
      if (n.body) { T(30, 600); g.fillStyle = 'rgba(255,255,255,.8)'; wrapText(g, n.body, 592, 130 + l * 64, W - 592 - 30, 38, 3); }
      pill(g, 592, H - 140, 260, 70, col, cta, 30);
    }
    return encode(cv);
  }
  function setCr(E, k, enc){
    const prev = E.cr[k] || {};
    if (prev.blobUrl) URL.revokeObjectURL(prev.blobUrl);
    const [w, h] = SZ(k), blobUrl = URL.createObjectURL(enc.blob);
    E.cr[k] = { ...prev, image: '', blob: enc.blob, ext: enc.ext, type: enc.type, w, h, src: blobUrl, blobUrl };
    paintPick(E, k); refresh(E);
  }
  const rand = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(x => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join(''); };
  async function uploadNew(E){
    for (const g of groupsOn(E)) for (const k of GROUPS.find(f => f.g === g).kinds) {
      const c = E.cr[k];
      if (!c?.blob || c.image) continue;
      const path = `${uid()}/${rand(16)}.${c.ext}`;
      const { error } = await sbClient.storage.from('ads').upload(path, c.blob, { contentType: c.type, upsert: false, cacheControl: '31536000' });
      if (error) throw new Error('Картинка не загрузилась: ' + (error.message || 'ошибка хранилища'));
      c.image = path; c.blob = null;
    }
  }
  function payload(E){
    const c = E.c, out = { title: c.title.trim() || 'Кампания', url: c.url.trim(), advertiser: c.advertiser.trim(), inn: c.inn.trim(), erid: c.erid.trim(),
      sections: c.sections, devices: c.devices, ages: c.ages, geo: c.geo, pricing: c.pricing, bid: Math.round(+c.bid || 0), plan_budget: Math.round(+c.plan_budget || 0),
      days: Math.round(+c.days || 0), start_date: c.start_date || '', end_date: c.pricing === 'cpm' ? (c.end_date || '') : '', age_rating: c.age_rating ?? null, creatives: [] };
    for (const g of groupsOn(E)) for (const k of GROUPS.find(f => f.g === g).kinds) {
      const cr = E.cr[k];
      if (!cr?.image) continue;
      const [w, h] = SZ(k);
      out.creatives.push({ kind: k, title: (cr.title || '').trim(), body: k === 'native' ? (cr.body || '').trim() : '', cta: k === 'native' ? (cr.cta || '').trim() : '', image: cr.image, w, h });
    }
    return out;
  }
  // Проверка до сервера (сервер всё равно проверит сам)
  function check(E, full){
    const c = E.c, R = RL(), gs = groupsOn(E);
    if (c.url && R.urlBad?.(c.url)) return URLWHY[R.urlBad(c.url)];
    for (const t of [c.title, c.advertiser, ...Object.values(E.cr).flatMap(x => [x.title, x.body, x.cta])]) { const w = R.textBad?.(t); if (w) return errText({ reason: 'bad', word: w }); }
    if (c.inn && !/^(\d{10}|\d{12})$/.test(c.inn)) return ERR.inn;
    if (c.erid && !/^[A-Za-z0-9_-]{4,64}$/.test(c.erid)) return ERR.erid;
    if (!full) return '';
    if (!c.url) return URLWHY.empty;
    if (c.advertiser.trim().length < 2) return ERR.advertiser;
    if (!gs.length) return ERR.creatives;
    if (c.age_rating == null) return ERR.age;
    if (c.geo === 'ru' && !c.erid.trim()) return ERR.erid_ru;
    for (const g of gs) {
      const has = GROUPS.find(f => f.g === g).kinds.some(k => E.cr[k]?.image || E.cr[k]?.blob);
      if (!has) return `Формат «${GROUPS.find(f => f.g === g).t}»: добавь картинку (или сними галочку).`;
    }
    if (E.on.native && (E.cr.native?.title || '').trim().length < 2) return ERR.title;
    if (c.pricing === 'cpm' && +c.bid < floorOf(gs)) return errText({ reason: 'bid', need: floorOf(gs) });
    if (c.pricing === 'cpm' && (+c.plan_budget < cfg().min_budget || +c.plan_budget > cfg().max_budget)) return errText({ reason: 'budget', min: cfg().min_budget, max: cfg().max_budget });
    if (c.pricing === 'day' && (+c.days < 1 || +c.days > (cfg().max_days || 30))) return errText({ reason: 'days', max: cfg().max_days });
    return '';
  }
  async function save(E, submit){
    const root = document.getElementById('advRoot'), err = $('[data-err]', root);
    const showErr = t => { err.textContent = t || ''; if (t) err.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); };
    const bad = check(E, submit);
    if (bad) return showErr(bad);
    if (ST.busy) return;
    if (submit && !(await confirmSubmit(E))) return;
    ST.busy = true; showErr('');
    $$('[data-a="save"],[data-a="submit"]', root).forEach(b => { b.disabled = true; });
    try {
      await uploadNew(E);
      const { data, error } = await api('ad_save', { p_id: E.id, p: payload(E) });
      if (error || !data?.ok) { showErr(error ? 'Нет связи с сервером — попробуй ещё раз.' : errText(data)); return; }
      E.id = data.id; E.status = data.status;
      if (!submit) {
        toast(data.status === 'review' && E.locked ? '✏️ Сохранено — кампания снова на проверке' : '💾 Сохранено');
        history.replaceState(null, '', '#/adv/edit/' + data.id);
        return;
      }
      const r = (await api('ad_act', { p_id: data.id, p_act: 'submit' })).data;
      if (!r?.ok) {
        history.replaceState(null, '', '#/adv/edit/' + data.id);
        if (r?.reason === 'gems') { gemsModal(r.need); return; }
        showErr(errText(r)); return;
      }
      modalClose();
      toast(`📤 Отправлено на проверку — ${gems(r.paid)} в копилке кампании`);
      window.D37Gems?.sync?.();
      location.hash = '#/adv/c/' + data.id;
    } catch (e) { showErr(e.message || String(e)); }
    finally { ST.busy = false; $$('[data-a="save"],[data-a="submit"]', document.getElementById('advRoot')).forEach(b => { b.disabled = false; }); }
  }
  function confirmSubmit(E){
    return new Promise(res => {
      const sum = submitSum(E), c = E.c;
      const m = modal(`<h4>📤 Отправить на проверку?</h4>
        <p>Спишется <b>${gems(sum)}</b> с баланса в копилку кампании. Отклонят — вернутся все. Останутся неизрасходованные — вернутся сами.</p>
        ${!c.erid && c.geo !== 'not_ru' ? '<p class="adc-warn">⚠ erid не указан — в России реклама показываться не будет, только в других странах.</p>' : ''}
        <label class="shp-consent"><input type="checkbox" data-ok> <span>Реклама не про азартные игры и кейсы, ставки, алкоголь, табак и вейпы, 18+ и знакомства, оружие, крипту и «лёгкие деньги», займы и лекарства; не обманывает («скачай», «ты выиграл»); ссылка ведёт куда написано.</span></label>
        <div class="adc-err" role="alert"></div>
        <div class="shp-modal-act"><button type="button" class="pf-btn pf-btn-ghost" data-no>Отмена</button><button type="button" class="pf-btn pf-btn-gold" data-yes>Отправить — ${gems(sum)}</button></div>`);
      m.querySelector('[data-no]').onclick = () => { modalClose(); res(false); };
      m.querySelector('[data-yes]').onclick = () => {
        if (!m.querySelector('[data-ok]').checked) { m.querySelector('.adc-err').textContent = 'Отметь галочку.'; return; }
        m.querySelector('[data-yes]').disabled = true; m.querySelector('[data-yes]').textContent = 'Отправляем…';
        res(true);
      };
    });
  }
  function gemsModal(need){
    const bal = balance();
    modal(`<h4>💎 Не хватает кристаллов</h4><p>Нужно ${gems(need)}${bal != null ? `, на балансе ${gems(bal)}` : ''}. Кампания сохранена черновиком — отправишь, когда пополнишь.</p>
      <p class="adc-small">💎 — в магазине: картой (когда подключится) или донатом с выбором «донат → кристаллы» (1 ₽ = 1 💎).</p>
      <div class="shp-modal-act"><button type="button" class="pf-btn pf-btn-ghost" data-a="close">Позже</button><a class="pf-btn pf-btn-gold" href="#/shop" data-a="close">💎 В магазин</a></div>`);
  }

  // ═══ Кампания: статистика и действия ═══
  async function campaign(root, id, seq){
    const { data } = await api('ad_get', { p_id: id });
    if (seq !== ST.seq) return;
    if (!data?.ok) { root.innerHTML = `<div class="adc-empty pf-card pf-card-muted"><b>Кампания не найдена</b><a class="pf-btn pf-btn-ghost" href="#/adv">← Мои кампании</a></div>`; return; }
    const c = data.c, own = data.own, adm = ST.my?.admin;
    const cap = Math.max(0, c.budget - c.refunded), left = Math.max(0, Math.floor(c.budget - c.refunded - Number(c.spent)));
    const why = c.status === 'rejected' || c.status === 'banned' ? `<div class="adc-msg bad"><b>${c.status === 'banned' ? '🚫 Заблокирована' : '⛔ Отклонена'}:</b> ${esc(c.reject_reason || 'без причины')}${c.status === 'rejected' ? '<br><small>Поправь и отправь снова — 💎 уже вернулись на баланс.</small>' : ''}</div>`
      : c.status === 'paused' ? `<div class="adc-msg"><b>⏸ Пауза:</b> ${esc(PAUSED[c.paused_by] || '')}</div>`
      : c.status === 'finished' ? `<div class="adc-msg"><b>🏁 Завершена:</b> ${esc(FINISH[c.finish_reason] || '')}${c.refunded ? ` · вернулось ${gems(c.refunded)}` : ''}</div>`
      : c.status === 'review' ? `<div class="adc-msg warn"><b>⏳ На проверке.</b> Обычно — в течение дня. Придёт уведомление 🔔.${c.changed ? ' Изменения после одобрения тоже проверяются.' : ''}</div>`
      : c.status === 'active' && !c.erid && c.geo !== 'not_ru' ? '<div class="adc-msg warn">⚠ erid не указан — в России реклама не показывается, только в других странах.</div>' : '';
    const acts = [];
    if (own) {
      if (['draft', 'rejected'].includes(c.status)) acts.push(['edit', '✏️ Изменить', 'primary'], ['delete', '🗑 Удалить', 'danger']);
      if (c.status === 'review') acts.push(['edit', '✏️ Изменить', 'ghost'], ['withdraw', '↩ Отозвать и вернуть 💎', 'ghost']);
      if (c.status === 'active') acts.push(['pause', '⏸ Пауза', 'ghost']);
      if (c.status === 'paused' && c.paused_by === 'owner') acts.push(['resume', '▶ Продолжить', 'primary']);
      if (['active', 'paused', 'review'].includes(c.status) || (c.status === 'finished' && c.pricing === 'cpm' && ['budget', 'owner'].includes(c.finish_reason) && c.approved && !c.changed))
        acts.push(['topup', c.status === 'finished' ? '💎 Пополнить и продолжить' : c.pricing === 'day' ? '➕ Продлить дни' : '💎 Пополнить', 'gold']);
      if (['active', 'paused'].includes(c.status)) acts.push(['edit', '✏️ Изменить', 'ghost'], ['stop', '🏁 Остановить и вернуть остаток', 'danger']);
      if (c.status !== 'banned') acts.push(['dup', '⧉ Копия', 'ghost']);
    }
    if (adm && !own) acts.push(['admin', '🛡 К модерации', 'tw']);
    root.innerHTML = `
      <div class="adc-crumbs"><a href="#/adv">← ${own ? 'Мои кампании' : 'Кабинет'}</a>${adm ? ' · <a href="#/adv/admin">модерация</a>' : ''}</div>
      <div class="adc-c-head pf-card pf-card-accent">
        <div class="adc-c-t"><h3>${esc(c.title)}</h3><div class="adc-card-m">${statusChip(c)}${ageChip(c.age_rating)}<small>${esc(priceLine(c))}</small>${!own ? `<small>· ${esc(data.owner_nick || '')}</small>` : ''}</div>
          <small class="adc-muted">${c.start_date ? `${ruDate(c.start_date)} — ${c.end_date ? ruDate(c.end_date) : 'пока не кончится бюджет'}` : 'даты — после отправки'} · ${esc(c.host || '')}${c.erid ? ' · erid ' + esc(c.erid) : ''}</small></div>
        <div class="adc-c-money">
          <div><b>${dec(c.spent)}</b><small>потрачено 💎</small></div><div><b>${num(left)}</b><small>осталось 💎</small></div>
          <div><b>${num(c.views)}</b><small>показов</small></div><div><b>${num(c.clicks)}</b><small>кликов · CTR ${ctr(c.views, c.clicks)}</small></div>
        </div>
        ${cap ? `<span class="adc-bar"><i style="width:${Math.min(100, Math.round(Number(c.spent) / cap * 100))}%"></i></span>` : ''}
      </div>
      ${why}
      ${acts.length ? `<div class="adc-act adc-c-acts">${acts.map(([a, t, k]) => `<button type="button" class="pf-btn pf-btn-${k} pf-btn-sm" data-a="c-${a}" data-id="${esc(c.id)}">${t}</button>`).join('')}</div>` : ''}
      <section class="pf-card pf-card-tw adc-box"><h4>📈 По дням</h4>${chart(data.stats || [])}${statTable(data.stats || [])}</section>
      ${data.places?.length ? `<section class="pf-card pf-card-muted adc-box"><h4>📍 Где показывалась</h4><div class="adc-places">${data.places.map(p => `<div><span>${esc(PLACES[p.place] || p.place)}</span><b>👁 ${num(p.views)} · 👆 ${num(p.clicks)}</b></div>`).join('')}</div></section>` : ''}
      <section class="pf-card pf-card-muted adc-box"><h4>🖼 Креативы</h4><div class="adc-pv adc-pv-wide" data-cpv></div></section>
      <section class="pf-card pf-card-muted adc-box"><h4>🎯 Кому</h4><p class="adc-small">${targeting(c)}</p></section>
      <section class="pf-card pf-card-muted adc-box"><h4>🧾 Журнал</h4>${(data.log || []).map(l => `<div class="shp-row"><span><small>${ruTime(l.created_at)}</small> ${esc(LOGACT[l.act] || l.act)}${l.note ? ' — ' + esc(l.note) : ''}</span>${l.admin ? '<small>админ</small>' : ''}</div>`).join('') || '<p class="adc-small">Пусто.</p>'}</section>`;
    // креативы — как на сайте
    const E = { c: { url: c.url, advertiser: c.advertiser, erid: c.erid }, cr: {}, on: {} };
    for (const cr of data.creatives || []) { E.cr[cr.kind] = { ...cr, src: '' }; E.on[(RL().KIND_GROUP || {})[cr.kind]] = true; }
    const paint = () => { const el = $('[data-cpv]', root); if (el) el.innerHTML = GROUPS.filter(f => E.on[f.g]).map(f => preview(E, f.g)).join('') || '<p class="adc-small">Креативов нет.</p>'; };
    paint();
    await Promise.all(Object.entries(E.cr).map(async ([k, cr]) => { cr.src = await D().img?.(cr.image) || ''; }));
    if (seq === ST.seq) paint();
  }
  function targeting(c){
    const name = (list, vals) => vals?.length ? vals.map(v => (list.find(x => x[0] === v) || [v, v])[1]).join(', ') : 'все';
    const r = RATINGS.find(x => x[0] === c.age_rating);
    return `Метка: ${r ? `${r[0]}+ (${r[1]})` : 'не выбрана'} · разделы: ${esc(name(SECTIONS, c.sections))} · устройства: ${esc(name(DEVICES, c.devices))} · возраст: ${esc(name(AGES, c.ages))} · страна: ${esc((GEO.find(g => g[0] === c.geo) || [0, 'везде'])[1])}`;
  }
  function chart(stats){
    if (!stats.length) return '<p class="adc-small">Показов пока нет. Статистика появится после первых показов (обновляется сразу).</p>';
    const days = [], by = Object.fromEntries(stats.map(s => [String(s.day).slice(0, 10), s]));
    const last = String(stats[stats.length - 1].day).slice(0, 10), first = String(stats[0].day).slice(0, 10);
    const n = Math.min(30, Math.max(7, Math.round((Date.parse(last) - Date.parse(first)) / 864e5) + 1));
    for (let i = n - 1; i >= 0; i--) { const d = addDays(last, -i); days.push({ d, ...(by[d] || { views: 0, clicks: 0, spent: 0 }) }); }
    const W = 600, H = 150, bw = W / days.length, mv = Math.max(1, ...days.map(x => +x.views)), mc = Math.max(1, ...days.map(x => +x.clicks));
    const bars = days.map((x, i) => { const h = Math.round(+x.views / mv * (H - 24)); return `<rect x="${(i * bw + bw * .15).toFixed(1)}" y="${H - h}" width="${(bw * .7).toFixed(1)}" height="${h}" rx="3"><title>${ruDate(x.d)}: ${num(x.views)} показов, ${num(x.clicks)} кликов</title></rect>`; }).join('');
    const pts = days.map((x, i) => `${(i * bw + bw / 2).toFixed(1)},${(H - Math.round(+x.clicks / mc * (H - 24))).toFixed(1)}`).join(' ');
    return `<div class="adc-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Показы и клики по дням"><g class="adc-bars">${bars}</g><polyline class="adc-line" points="${pts}"/></svg>
      <div class="adc-chart-l"><span>${ruDate(days[0].d)}</span><span><i class="v"></i>показы (макс. ${num(mv)}) <i class="c"></i>клики (макс. ${num(mc)})</span><span>${ruDate(days[days.length - 1].d)}</span></div></div>`;
  }
  function statTable(stats){
    if (!stats.length) return '';
    const rows = stats.slice().reverse().slice(0, 30);
    return `<details class="adc-days"><summary>Таблица по дням</summary><table class="adc-tab"><thead><tr><th>День</th><th>Показы</th><th>Клики</th><th>CTR</th><th>💎</th></tr></thead><tbody>
      ${rows.map(s => `<tr><td>${ruDate(s.day)}</td><td>${num(s.views)}</td><td>${num(s.clicks)}</td><td>${ctr(+s.views, +s.clicks)}</td><td>${dec(s.spent)}</td></tr>`).join('')}</tbody></table></details>`;
  }
  async function act(id, a){
    const run = async (p_act, amount) => {
      ST.busy = true;
      const { data, error } = await api('ad_act', { p_id: id, p_act, p_amount: amount ?? null });
      ST.busy = false;
      if (error || !data?.ok) { if (data?.reason === 'gems') gemsModal(data.need); else toast(error ? 'Нет связи с сервером' : errText(data)); return null; }
      window.D37Gems?.sync?.();
      return data;
    };
    if (a === 'edit') { location.hash = '#/adv/edit/' + id; return; }
    if (a === 'admin') { location.hash = '#/adv/admin'; return; }
    if (a === 'pause') { if (await run('pause')) { toast('⏸ На паузе'); rerender(); } return; }
    if (a === 'resume') { if (await run('resume')) { toast('▶ Снова показывается'); rerender(); } return; }
    if (a === 'stop') { if (!confirm('Остановить кампанию? Показы прекратятся, неизрасходованные 💎 вернутся на баланс. Продолжить потом можно пополнением (при оплате за показы).')) return; const r = await run('stop'); if (r) { toast(`🏁 Остановлена${r.refund ? ` — вернулось ${gems(r.refund)}` : ''}`); rerender(); } return; }
    if (a === 'withdraw') { if (!confirm('Отозвать с проверки? 💎 вернутся на баланс, кампания станет черновиком.')) return; const r = await run('withdraw'); if (r) { toast(`↩ Отозвана — вернулось ${gems(r.refund || 0)}`); rerender(); } return; }
    if (a === 'delete') { if (!confirm('Удалить кампанию насовсем?')) return; if (await run('delete')) { toast('🗑 Удалена'); location.hash = '#/adv'; } return; }
    if (a === 'dup') { const r = await run('dup'); if (r) { toast('⧉ Копия — черновик'); location.hash = '#/adv/edit/' + r.id; } return; }
    if (a === 'topup') {
      const c = (ST.my?.campaigns || []).find(x => x.id === id);
      const day = c?.pricing === 'day';
      const m = modal(`<h4>${day ? '➕ Продлить пакет' : '💎 Пополнить бюджет'}</h4>
        <label class="adc-f"><span>${day ? `Сколько дней добавить (× ${gems(c?.day_price)})` : `Сколько 💎 (от ${gems(cfg().min_topup)})`}</span><input type="number" data-n min="${day ? 1 : cfg().min_topup}" value="${day ? 1 : Math.max(cfg().min_topup, 100)}"></label>
        <p class="adc-small">Баланс: ${balance() == null ? '—' : gems(balance())}.</p><div class="adc-err" role="alert"></div>
        <div class="shp-modal-act"><button type="button" class="pf-btn pf-btn-ghost" data-a="close">Отмена</button><button type="button" class="pf-btn pf-btn-gold" data-ok>Пополнить</button></div>`);
      m.querySelector('[data-ok]').onclick = async () => {
        const n = Math.round(+m.querySelector('[data-n]').value || 0);
        if (n < 1) { m.querySelector('.adc-err').textContent = 'Введи число.'; return; }
        const r = await run('topup', n);
        if (r) { modalClose(); toast(`💎 +${num(r.paid)} в копилку кампании`); rerender(); }
      };
    }
  }

  // ═══ Админ: очередь, в работе, все, цены, итоги ═══
  const REJECT = ['Нет erid — для показа в России нужен erid из ОРД (или выберите «Кроме России»)', 'Запрещённая тема для детской аудитории',
    'Ссылка не открывается или ведёт не туда', 'Обман или кликбейт («скачай», «ты выиграл», «бесплатно»)', 'Картинка плохого качества или текст не читается',
    'Не указан рекламодатель или ИНН/БИН не сходится'];
  async function admin(root, tab, seq){
    const st = tab === 'live' ? 'live' : tab === 'all' ? '' : 'review';
    const { data, error } = await api('ad_admin_list', { p_status: st });
    if (seq !== ST.seq) return;
    if (error || !data?.ok) { root.innerHTML = `<div class="adc-empty pf-card pf-card-danger"><b>Не загрузилось</b><span>${esc(error?.message || '')}</span></div>`; return; }
    const t = data.totals || {}, bs = t.by_status || {}, c = data.cfg || cfg();
    const tabs = [['review', `На проверке (${bs.review || 0})`], ['live', `В работе (${(bs.active || 0) + (bs.paused || 0)})`], ['all', 'Все'], ['prices', 'Цены и настройки']];
    root.innerHTML = `
      <div class="adc-crumbs"><a href="#/adv">← Мои кампании</a></div>
      <h3 class="adc-h">🛡 Реклама: модерация</h3>
      <div class="adc-totals">
        <div class="pf-card pf-card-gold"><b>${num(t.escrow)}</b><small>💎 в копилках (не потрачено)</small></div>
        <div class="pf-card pf-card-gold"><b>${dec(t.earned_7d)}</b><small>💎 заработано за 7 дней</small></div>
        <div class="pf-card pf-card-muted"><b>${dec(t.earned)}</b><small>💎 заработано всего</small></div>
        <div class="pf-card pf-card-tw"><b>${num(t.views_today)} / ${num(t.clicks_today)}</b><small>показы / клики сегодня</small></div>
        <div class="pf-card pf-card-tw"><b>${num(t.views_7d)} / ${num(t.clicks_7d)}</b><small>за 7 дней</small></div>
      </div>
      <div class="adc-tabs">${tabs.map(([k, n]) => `<a class="${k === tab ? 'on' : ''}" href="#/adv/admin/${k}">${n}</a>`).join('')}</div>
      ${tab === 'prices' ? pricesForm(c) : (data.campaigns || []).map(x => adminItem(x)).join('') || `<div class="adc-empty pf-card pf-card-muted"><b>${tab === 'review' ? 'Очередь пуста 🎉' : 'Нет кампаний'}</b></div>`}`;
    if (tab !== 'prices') for (const x of data.campaigns || []) for (const cr of x.creatives || []) {
      D().img?.(cr.image).then(u => { $$(`[data-src="${CSS.escape(cr.image)}"]`, root).forEach(im => { if (u) im.src = u; }); });
    }
  }
  function adminItem(x){
    const warn = [];
    if (!x.erid && x.geo !== 'not_ru') warn.push('нет erid — в России показываться не будет');
    if (!x.inn) warn.push('ИНН/БИН не указан');
    if (x.changed) warn.push('изменена после одобрения');
    if (x.reports) warn.push(`жалоб: ${x.reports}`);
    if (x.age_rating == null) warn.push('нет возрастной метки');
    const lbl = `<div class="dad-lbl"><span class="dad-lbl-t">Реклама · <b>${esc(x.advertiser)}</b>${x.erid ? ` · erid: ${esc(x.erid)}` : ''}</span></div>`;
    const crs = (x.creatives || []).map(cr => {
      const [dw, dh] = KIND[cr.kind]?.show || [300, 250];
      return `<figure class="adc-adm-cr"><figcaption>${esc(KIND[cr.kind]?.t || cr.kind)}${cr.title ? ' — ' + esc(cr.title) : ''}${cr.body ? `<br><small>${esc(cr.body)}${cr.cta ? ' · [' + esc(cr.cta) + ']' : ''}</small>` : ''}</figcaption>
        ${lbl}<img data-src="${esc(cr.image)}" alt="" width="${dw}" height="${dh}" style="width:${dw}px;max-width:100%;aspect-ratio:${dw}/${dh}"></figure>`;
    }).join('');
    const btn = (a, t, k) => `<button type="button" class="pf-btn pf-btn-${k} pf-btn-sm" data-a="adm-${a}" data-id="${esc(x.id)}">${t}</button>`;
    const rateSel = `<label class="adc-mini adc-rate">🔞 метка <select data-rate="${esc(x.id)}">${x.age_rating == null ? '<option value="" selected>—</option>' : ''}${RATINGS.map(([n]) => `<option value="${n}"${x.age_rating === n ? ' selected' : ''}>${n}+</option>`).join('')}</select></label>`;
    const acts = x.status === 'review' ? btn('approve', '✅ Одобрить', 'gold') + btn('reject', '⛔ Отклонить', 'danger')
      : x.status === 'active' ? btn('pause', '⏸ Пауза', 'ghost') + btn('stop', '🏁 Остановить', 'ghost')
      : x.status === 'paused' ? btn('resume', '▶ Продолжить', 'primary') + btn('stop', '🏁 Остановить', 'ghost') : '';
    return `<article class="adc-adm pf-card ${x.status === 'review' ? 'pf-card-gold' : 'pf-card-muted'}">
      <div class="adc-adm-h"><b>${esc(x.title)}</b>${statusChip(x)}${ageChip(x.age_rating)}<small>${esc(x.owner_nick || '?')} · ${esc(priceLine(x))} · в копилке ${num(Math.max(0, x.budget - x.refunded))} 💎 · потрачено ${dec(x.spent)}</small></div>
      <div class="adc-adm-g"><div><small>Рекламодатель</small><b>${esc(x.advertiser || '—')}</b></div><div><small>ИНН/БИН</small><b>${esc(x.inn || '—')}</b></div>
        <div><small>erid</small><b>${esc(x.erid || '—')}</b></div><div><small>Ссылка</small><a href="${esc(x.url)}" target="_blank" rel="noopener nofollow noreferrer">${esc(x.url)}</a></div></div>
      <p class="adc-small">${targeting(x)} · ${x.start_date ? `${ruDate(x.start_date)} — ${x.end_date ? ruDate(x.end_date) : 'без конца'}` : ''}</p>
      ${warn.length ? `<p class="adc-warn">⚠ ${esc(warn.join(' · '))}</p>` : ''}
      <div class="adc-adm-crs">${crs}</div>
      <div class="adc-act">${acts}${x.status !== 'banned' ? btn('ban', '🚫 Заблокировать', 'danger') : ''}${rateSel}<a class="pf-btn pf-btn-ghost pf-btn-sm" href="#/adv/c/${esc(x.id)}">📈 Статистика</a></div>
    </article>`;
  }
  function pricesForm(c){
    const P = c.prices || {};
    return `<form class="pf-card pf-card-gold adc-box adc-prices-f" data-form="prices">
      <h4>Цены (новые — для новых отправок; работающие кампании платят по своей цене)</h4>
      <table class="adc-tab"><thead><tr><th>Формат</th><th>мин. CPM, 💎</th><th>день, 💎</th></tr></thead><tbody>
      ${GROUPS.map(f => `<tr><td>${f.icon} ${esc(f.t)}</td><td><input type="number" min="1" name="cpm_${f.g}" value="${esc(P[f.g]?.cpm)}"></td><td><input type="number" min="1" name="day_${f.g}" value="${esc(P[f.g]?.day)}"></td></tr>`).join('')}
      </tbody></table>
      <div class="adc-grid3">
        <label class="adc-f"><span>Мин. бюджет</span><input type="number" name="min_budget" min="1" value="${esc(c.min_budget)}"></label>
        <label class="adc-f"><span>Макс. бюджет</span><input type="number" name="max_budget" min="1" value="${esc(c.max_budget)}"></label>
        <label class="adc-f"><span>Мин. пополнение</span><input type="number" name="min_topup" min="1" value="${esc(c.min_topup)}"></label>
        <label class="adc-f"><span>Макс. дней пакета</span><input type="number" name="max_days" min="1" value="${esc(c.max_days)}"></label>
        <label class="adc-f"><span>Показ раз в N минут на зрителя</span><input type="number" name="dedup_min" min="1" value="${esc(c.dedup_min)}"></label>
        <label class="adc-f"><span>Не больше показов в день на зрителя</span><input type="number" name="freq_day" min="1" value="${esc(c.freq_day)}"></label>
      </div>
      <label class="adc-chk"><input type="checkbox" name="day_on"${c.day_on !== false ? ' checked' : ''}> пакеты «по дням» включены</label>
      <label class="adc-chk"><input type="checkbox" name="enabled"${c.enabled !== false ? ' checked' : ''}> прямая реклама включена (выкл — нигде не показывается, отправлять нельзя)</label>
      <div class="adc-act"><button class="pf-btn pf-btn-gold">💾 Сохранить</button></div></form>`;
  }
  async function adminAct(id, a){
    let reason = null;
    if (a === 'reject' || a === 'ban') {
      reason = await askReason(a);
      if (!reason) return;
    } else if (a === 'pause') { reason = prompt('Причина паузы (её увидит рекламодатель):', '') ?? null; if (reason === null) return; }
    else if (a === 'stop') { if (!confirm('Остановить кампанию? Остаток 💎 вернётся рекламодателю.')) return; }
    const { data, error } = await api('ad_admin_act', { p_id: id, p_act: a, p_reason: reason });
    if (error || !data?.ok) { toast(error ? (error.message || 'Ошибка') : errText(data)); return; }
    toast({ approve: '✅ Одобрена — уже показывается', reject: '⛔ Отклонена, 💎 вернулись рекламодателю', ban: '🚫 Заблокирована', pause: '⏸ На паузе', resume: '▶ В работе', stop: '🏁 Остановлена' }[a] || 'Готово');
    rerender();
  }
  function askReason(a){
    return new Promise(res => {
      const m = modal(`<h4>${a === 'ban' ? '🚫 Заблокировать' : '⛔ Отклонить'} — причина</h4><p class="adc-small">Её увидит рекламодатель.</p>
        <div class="adc-reasons">${REJECT.map(r => `<button type="button" class="adc-mini" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>
        <label class="adc-f"><span>Причина</span><textarea data-why maxlength="300" rows="3"></textarea></label><div class="adc-err" role="alert"></div>
        <div class="shp-modal-act"><button type="button" class="pf-btn pf-btn-ghost" data-no>Отмена</button><button type="button" class="pf-btn pf-btn-danger" data-yes>${a === 'ban' ? 'Заблокировать' : 'Отклонить'}</button></div>`);
      m.querySelectorAll('[data-r]').forEach(b => { b.onclick = () => { m.querySelector('[data-why]').value = b.dataset.r; }; });
      m.querySelector('[data-no]').onclick = () => { modalClose(); res(null); };
      m.querySelector('[data-yes]').onclick = () => {
        const v = m.querySelector('[data-why]').value.trim();
        if (v.length < 3) { m.querySelector('.adc-err').textContent = ERR.why; return; }
        modalClose(); res(v);
      };
    });
  }
  async function rate(id, v){
    const { data, error } = await api('ad_admin_act', { p_id: id, p_act: 'rate', p_reason: String(v) });
    if (error || !data?.ok) { toast(error ? (error.message || 'Ошибка') : errText(data)); return; }
    toast(`🔞 Метка: ${v}+`);
    rerender();
  }
  async function savePrices(form){
    const f = form.elements, prices = {};
    for (const g of GROUPS) prices[g.g] = { cpm: Math.round(+f['cpm_' + g.g].value || 0), day: Math.round(+f['day_' + g.g].value || 0) };
    const p = { prices, enabled: f.enabled.checked, day_on: f.day_on.checked };
    for (const k of ['min_budget', 'max_budget', 'min_topup', 'max_days', 'dedup_min', 'freq_day']) p[k] = Math.round(+f[k].value || 0);
    const { data, error } = await api('ad_admin_settings', { p });
    if (error || !data?.ok) { toast(error ? (error.message || 'Ошибка') : errText(data)); return; }
    if (ST.my) ST.my.cfg = data.cfg;
    toast('💾 Цены сохранены');
    rerender();
  }

  // ═══ События (один обработчик на весь раздел) ═══
  function wire(root){
    if (root.dataset.wired) return;
    root.dataset.wired = '1';
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b || !root.contains(b)) return;
      const a = b.dataset.a, E = ST.ed;
      if (a === 'login') { if (typeof openGlobalAuth === 'function') openGlobalAuth(); return; }   // после входа — d37:auth → снова этот раздел
      if (a === 'terms') { acceptTerms(b); return; }
      if (a === 'save') { save(E, false); return; }
      if (a === 'submit') { save(E, true); return; }
      if (a === 'drop' && E) { const k = b.dataset.k; if (E.cr[k]?.blobUrl) URL.revokeObjectURL(E.cr[k].blobUrl); E.cr[k] = { ...(E.cr[k] || {}), image: '', blob: null, src: '', blobUrl: '' }; paintPick(E, k); refresh(E); return; }
      if (a === 'magic' && E) {
        b.disabled = true;
        fromCard(E, b.dataset.k).then(enc => setCr(E, b.dataset.k, enc)).catch(er => toast(er.message || String(er))).finally(() => { b.disabled = false; });
        return;
      }
      if (a.startsWith('c-')) { act(b.dataset.id, a.slice(2)); return; }
      if (a.startsWith('adm-')) { adminAct(b.dataset.id, a.slice(4)); return; }
    });
    root.addEventListener('input', e => {
      const E = ST.ed, t = e.target;
      if (!E || !t.closest?.('.adc-ed, .adc-act')) return;
      if (t.dataset.f) { if (t.dataset.f === 'color') E.color = t.value; else E.c[t.dataset.f] = t.value; refresh(E); }
      else if (t.dataset.crF) { const k = t.dataset.k; E.cr[k] = { ...(E.cr[k] || {}), [t.dataset.crF]: t.value }; refresh(E); }
    });
    root.addEventListener('change', async e => {
      const E = ST.ed, t = e.target;
      if (t.closest?.('[data-form="prices"]')) return;
      if (t.dataset.rate) { rate(t.dataset.rate, t.value); return; }
      if (!E) return;
      if (t.dataset.grp) { E.on[t.dataset.grp] = t.checked; t.closest('.adc-grp')?.classList.toggle('on', t.checked); const blk = $(`[data-crg="${t.dataset.grp}"]`, root); if (blk) blk.hidden = !t.checked; refresh(E); }
      else if (t.dataset.arr) { const arr = E.c[t.dataset.arr]; const i = arr.indexOf(t.value); if (t.checked && i < 0) arr.push(t.value); if (!t.checked && i >= 0) arr.splice(i, 1); refresh(E); }
      else if (t.dataset.geo) { E.c.geo = t.dataset.geo; refresh(E); }
      else if (t.dataset.agerating) { E.c.age_rating = +t.dataset.agerating; refresh(E); }
      else if (t.dataset.pay) { E.c.pricing = t.dataset.pay; $$('.adc-pay-opt', root).forEach(x => x.classList.toggle('on', !!x.querySelector('input:checked'))); refresh(E); }
      else if (t.dataset.file) {
        const k = t.dataset.file, f = t.files?.[0];
        t.value = '';
        if (!f) return;
        try { setCr(E, k, await prepFile(f, k, $(`[data-fit="${k}"]`, root)?.checked)); }
        catch (er) { toast(er.message || String(er)); }
      }
    });
    root.addEventListener('submit', e => { const f = e.target.closest('[data-form="prices"]'); if (f) { e.preventDefault(); savePrices(f); } });
    document.addEventListener('click', e => { if (e.target.closest?.('#adcModal [data-a="close"]')) modalClose(); });
  }
  window.addEventListener('d37:auth', () => { if (document.body?.dataset.route === 'adv') setTimeout(rerender, 300); });
  window.D37Gems?.on?.(() => { if (document.body?.dataset.route === 'adv' && ST.ed) refresh(ST.ed); });

  window.D37AdCab = { render, _test: { ST, check, payload, blankEd, errText, chart, preview, submitSum, floorOf, dayPrice } };
})();
