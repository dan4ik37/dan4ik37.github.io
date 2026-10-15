// ═══════════════════════════════════════
//  КАК УСТАНОВИТЬ ПРИЛОЖЕНИЕ 📲 (D37AppGuide) — окно с шагами и картинками; грузит js/features/app.js при первом открытии
// ═══════════════════════════════════════
// D37AppGuide.open({ env, how, prompt() → есть кнопка браузера, install(), installed }) / close() / refresh() / isOpen();
// steps(how) → [{ pic, text }] — чистая функция (scripts/pwa-test.cjs). Картинки — SVG прямо здесь (без файлов): так выглядят
// кнопки Safari / Chrome / Edge / Яндекса; что обведено розовым — куда нажать. Ключи how — detect() в app.js.
// Поменял этот файл — подними VER в app.js (адрес ?v=).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37AppGuide) return;
  const doc = root.document;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ═══ Картинки (viewBox 240×150) ═══
  const F = 'font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"';
  const ring = (cx, cy, r) => `<circle class="apg-hl" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ff2d55" stroke-width="3"/>`;
  const box = (x, y, w, h) => `<rect class="apg-hl" x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="none" stroke="#ff2d55" stroke-width="3"/>`;
  const svg = body => `<svg class="apg-pic" viewBox="0 0 240 150" role="img" aria-hidden="true" ${F}>${body}</svg>`;
  const shareIco = (x, y, c = '#007aff') => `<path d="M${x - 6} ${y - 2}v9h12v-9" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/><path d="M${x} ${y + 4}v-13M${x - 4} ${y - 5}l4-4 4 4" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  const page = (x, y, w) => `<rect x="${x}" y="${y}" width="${w}" height="54" rx="8" fill="#fff"/><rect x="${x + 10}" y="${y + 11}" width="${w * .5}" height="8" rx="4" fill="#d1d1d6"/><rect x="${x + 10}" y="${y + 27}" width="${w * .8}" height="6" rx="3" fill="#e5e5ea"/><rect x="${x + 10}" y="${y + 39}" width="${w * .65}" height="6" rx="3" fill="#e5e5ea"/>`;
  const PICS = {
    // Safari на iPhone (iOS 17–18): адрес и кнопки внизу, «Поделиться» — посередине
    'ios-share': svg(`<rect x="20" y="4" width="200" height="142" rx="20" fill="#f2f2f7"/>${page(34, 14, 172)}
      <rect x="34" y="78" width="172" height="22" rx="11" fill="#e3e3e8"/><text x="120" y="93" text-anchor="middle" font-size="9" fill="#3c3c43">🔒 dan4ik37.vercel.app</text>
      <path d="M50 119l-5 5 5 5M84 119l5 5-5 5" fill="none" stroke="#007aff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${shareIco(120, 124)}<path d="M150 118h10a4 4 0 0 1 4 4v8h-10a4 4 0 0 0-4 4z" fill="none" stroke="#007aff" stroke-width="1.8"/><rect x="186" y="117" width="12" height="12" rx="2.5" fill="none" stroke="#007aff" stroke-width="1.8"/><rect x="190" y="121" width="12" height="12" rx="2.5" fill="#f2f2f7" stroke="#007aff" stroke-width="1.8"/>
      ${ring(120, 123, 14)}`),
    // Safari в iOS 26: строка адреса внизу, «•••» справа
    'ios-dots': svg(`<rect x="20" y="4" width="200" height="142" rx="20" fill="#f2f2f7"/>${page(34, 14, 172)}<rect x="34" y="76" width="172" height="24" rx="8" fill="#fff"/>
      <rect x="30" y="110" width="180" height="28" rx="14" fill="#fff" stroke="#d1d1d6"/><path d="M45 119l-5 5 5 5" fill="none" stroke="#3c3c43" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="112" y="128" text-anchor="middle" font-size="9.5" fill="#3c3c43">dan4ik37.vercel.app</text>
      <circle cx="184" cy="124" r="1.8" fill="#3c3c43"/><circle cx="191" cy="124" r="1.8" fill="#3c3c43"/><circle cx="198" cy="124" r="1.8" fill="#3c3c43"/>${ring(191, 124, 13)}`),
    // меню «Поделиться»: «На экран «Домой»»
    'ios-menu': svg(`<rect x="20" y="4" width="200" height="142" rx="20" fill="#f2f2f7"/>
      <rect x="32" y="14" width="176" height="122" rx="12" fill="#fff"/>
      <text x="44" y="38" font-size="10.5" fill="#1c1c1e">Скопировать</text><rect x="186" y="27" width="10" height="12" rx="2" fill="none" stroke="#1c1c1e" stroke-width="1.5"/>
      <line x1="44" y1="50" x2="208" y2="50" stroke="#e5e5ea"/>
      <text x="44" y="72" font-size="10.5" fill="#1c1c1e">Добавить в Избранное</text><path d="M191 60l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" fill="none" stroke="#1c1c1e" stroke-width="1.4" stroke-linejoin="round"/>
      <line x1="44" y1="84" x2="208" y2="84" stroke="#e5e5ea"/>
      <text x="44" y="108" font-size="10.5" font-weight="600" fill="#1c1c1e">На экран «Домой»</text><rect x="184" y="96" width="14" height="14" rx="3.5" fill="none" stroke="#1c1c1e" stroke-width="1.6"/><path d="M191 99.5v7M187.5 103h7" stroke="#1c1c1e" stroke-width="1.6" stroke-linecap="round"/>
      ${box(36, 88, 168, 32)}`),
    // «Добавить» + «Открыть как веб-приложение»
    'ios-add': svg(`<rect x="20" y="4" width="200" height="142" rx="20" fill="#f2f2f7"/>
      <text x="32" y="27" font-size="8.5" fill="#007aff">Отменить</text><text x="120" y="27" text-anchor="middle" font-size="7.5" font-weight="600" fill="#1c1c1e">На экран «Домой»</text><text x="208" y="27" text-anchor="end" font-size="8.5" font-weight="700" fill="#007aff">Добавить</text>
      ${box(164, 14, 49, 19)}
      <rect x="32" y="42" width="176" height="52" rx="12" fill="#fff"/>
      <rect x="42" y="50" width="36" height="36" rx="9" fill="#08080e"/><circle cx="60" cy="68" r="13" fill="none" stroke="#ff2d55" stroke-width="3"/><text x="60" y="72" text-anchor="middle" font-size="10" font-weight="800" fill="#fff">D37</text>
      <text x="88" y="66" font-size="11" font-weight="600" fill="#1c1c1e">dan4ik37</text><text x="88" y="80" font-size="8" fill="#8e8e93">dan4ik37.vercel.app</text>
      <rect x="32" y="102" width="176" height="32" rx="12" fill="#fff"/><text x="42" y="121" font-size="8.6" fill="#1c1c1e">Открыть как веб-приложение</text>
      <rect x="176" y="109" width="26" height="16" rx="8" fill="#34c759"/><circle cx="194" cy="117" r="6.5" fill="#fff"/>`),
    // Chrome на Android: ⋮ → «Установить приложение»
    'android-menu': svg(`<rect x="20" y="4" width="200" height="142" rx="16" fill="#202124"/>
      <rect x="30" y="12" width="158" height="22" rx="11" fill="#303134"/><text x="44" y="27" font-size="9" fill="#e8eaed">dan4ik37.vercel.app</text>
      <circle cx="205" cy="17" r="1.8" fill="#e8eaed"/><circle cx="205" cy="23" r="1.8" fill="#e8eaed"/><circle cx="205" cy="29" r="1.8" fill="#e8eaed"/>${ring(205, 23, 11)}
      <rect x="84" y="40" width="130" height="100" rx="8" fill="#303134"/>
      <text x="96" y="60" font-size="9" fill="#e8eaed">Новая вкладка</text><text x="96" y="82" font-size="9" fill="#e8eaed">История</text>
      <path d="M100 97h10M105 92v10" stroke="#8ab4f8" stroke-width="1.8" stroke-linecap="round"/><text x="116" y="102" font-size="9" font-weight="700" fill="#e8eaed">Установить</text><text x="116" y="113" font-size="9" font-weight="700" fill="#e8eaed">приложение</text>
      ${box(88, 88, 122, 32)}<text x="96" y="133" font-size="8" fill="#9aa0a6">Настройки</text>`),
    // компьютер: значок установки в адресной строке (Chrome, Edge, Яндекс)
    'desktop-bar': svg(`<rect x="6" y="10" width="228" height="132" rx="10" fill="#202124"/>
      <rect x="6" y="10" width="228" height="22" rx="10" fill="#35363a"/><rect x="18" y="16" width="72" height="16" rx="6" fill="#202124"/><text x="26" y="27.5" font-size="8" fill="#e8eaed">dan4ik37</text>
      <rect x="14" y="38" width="212" height="20" rx="10" fill="#303134"/><text x="26" y="51.5" font-size="8.5" fill="#e8eaed">🔒 dan4ik37.vercel.app</text>
      <rect x="181" y="42" width="15" height="10" rx="1.5" fill="none" stroke="#e8eaed" stroke-width="1.5"/><path d="M188.5 44.5v5M186.3 47.6l2.2 2.2 2.2-2.2" fill="none" stroke="#e8eaed" stroke-width="1.4" stroke-linecap="round"/><path d="M185 55h7" stroke="#e8eaed" stroke-width="1.5"/>
      ${ring(188.5, 48, 12)}
      <rect x="96" y="66" width="128" height="68" rx="8" fill="#3c4043"/><text x="106" y="84" font-size="9" font-weight="700" fill="#e8eaed">Установить приложение?</text><text x="106" y="97" font-size="7.5" fill="#bdc1c6">dan4ik37.vercel.app</text>
      <rect x="166" y="108" width="50" height="18" rx="9" fill="#8ab4f8"/><text x="191" y="120" text-anchor="middle" font-size="8" font-weight="700" fill="#202124">Установить</text><text x="146" y="120" text-anchor="middle" font-size="8" fill="#8ab4f8">Отмена</text>`),
    // Safari на Mac: «Файл» → «Добавить в Dock…»
    'mac-dock': svg(`<rect x="6" y="10" width="228" height="132" rx="10" fill="#f5f5f7"/><rect x="6" y="10" width="228" height="16" rx="8" fill="#e8e8ed"/>
      <text x="18" y="21.5" font-size="8" font-weight="700" fill="#1d1d1f">Safari</text><text x="50" y="21.5" font-size="8" fill="#1d1d1f">Файл</text><text x="78" y="21.5" font-size="8" fill="#1d1d1f">Правка</text><text x="110" y="21.5" font-size="8" fill="#1d1d1f">Вид</text>
      <rect x="44" y="26" width="140" height="96" rx="7" fill="#fff" stroke="#d2d2d7"/><text x="54" y="44" font-size="8.5" fill="#1d1d1f">Новое окно</text><text x="54" y="62" font-size="8.5" fill="#1d1d1f">Новая вкладка</text>
      <rect x="48" y="70" width="132" height="18" rx="5" fill="#007aff"/><text x="54" y="82.5" font-size="8.5" font-weight="600" fill="#fff">Добавить в Dock…</text>${box(45, 67, 138, 24)}
      <text x="54" y="104" font-size="8.5" fill="#1d1d1f">Поделиться</text>`),
    // Firefox на Windows: кнопка веб-приложения в адресной строке
    'firefox-win': svg(`<rect x="6" y="10" width="228" height="132" rx="10" fill="#1c1b22"/><rect x="14" y="20" width="212" height="22" rx="6" fill="#2b2a33"/>
      <text x="26" y="34.5" font-size="8.5" fill="#fbfbfe">🔒 dan4ik37.vercel.app</text>
      <rect x="186" y="25" width="14" height="12" rx="2" fill="none" stroke="#fbfbfe" stroke-width="1.5"/><path d="M186 29h14" stroke="#fbfbfe" stroke-width="1.3"/><path d="M193 31.5v4M191 33.5h4" stroke="#fbfbfe" stroke-width="1.3" stroke-linecap="round"/>${ring(193, 31, 12)}
      <rect x="20" y="58" width="200" height="74" rx="8" fill="#2b2a33"/><text x="34" y="78" font-size="8.5" fill="#fbfbfe">Сайт появится на панели задач</text><text x="34" y="92" font-size="8.5" fill="#fbfbfe">и в меню «Пуск» Windows</text>
      <rect x="34" y="104" width="22" height="18" rx="4" fill="#08080e"/><text x="45" y="116" text-anchor="middle" font-size="6.5" font-weight="800" fill="#ff2d55">D37</text><rect x="60" y="104" width="22" height="18" rx="4" fill="#42414d"/><rect x="86" y="104" width="22" height="18" rx="4" fill="#42414d"/>`),
    // сайт открыт внутри другого приложения: ⋮ → «Открыть в браузере»
    'open-browser': svg(`<rect x="20" y="4" width="200" height="142" rx="16" fill="#1f2937"/><rect x="20" y="4" width="200" height="30" rx="16" fill="#111827"/>
      <path d="M36 14l8 8M44 14l-8 8" stroke="#e5e7eb" stroke-width="2" stroke-linecap="round"/><text x="120" y="23" text-anchor="middle" font-size="9" fill="#e5e7eb">dan4ik37.vercel.app</text>
      <circle cx="203" cy="13" r="1.8" fill="#e5e7eb"/><circle cx="203" cy="19" r="1.8" fill="#e5e7eb"/><circle cx="203" cy="25" r="1.8" fill="#e5e7eb"/>${ring(203, 19, 11)}
      <rect x="96" y="40" width="118" height="78" rx="8" fill="#374151"/><text x="106" y="60" font-size="8.5" fill="#e5e7eb">Обновить</text><text x="106" y="80" font-size="8.5" fill="#e5e7eb">Копировать ссылку</text>
      <text x="106" y="102" font-size="8.5" font-weight="700" fill="#fff">Открыть в браузере</text>${box(99, 88, 112, 22)}`),
  };

  // ═══ Шаги по месту (how — из detect() в app.js) ═══
  const S = (pic, text) => ({ pic, text });
  const DONE_PC = 'dan4ik37 откроется в своём окне без вкладок; значок — в меню «Пуск» (на Mac — в Launchpad), его можно закрепить на панели задач.';
  const STEPS = {
    ios: [
      S('ios-share', 'Нажми «Поделиться» — квадрат со стрелкой вверх (на iPhone — внизу, на iPad — вверху справа). В iOS 26 он спрятан: сначала «•••» справа от адреса.'),
      S('ios-menu', 'Пролистай меню и выбери «На экран «Домой»».'),
      S('ios-add', 'Проверь, что включено «Открыть как веб-приложение», и нажми «Добавить». Открывай dan4ik37 значком с экрана «Домой».'),
    ],
    'ios-other': [
      S('ios-share', 'Нажми кнопку «Поделиться» браузера (в Chrome — справа в строке адреса, в Firefox и Яндексе — в меню).'),
      S('ios-menu', 'Выбери «На экран «Домой»».'),
      S('ios-add', 'Нажми «Добавить». Нет такого пункта — открой dan4ik37.vercel.app в Safari: там он есть всегда.'),
    ],
    android: [
      S('android-menu', 'Открой меню браузера — ⋮ вверху справа (в Яндекс Браузере ⋮ внизу, в Samsung Internet — ☰ внизу).'),
      S(null, 'Выбери «Установить приложение» (или «Добавить на главный экран» → «Установить»).'),
      S(null, 'Значок dan4ik37 появится на экране и в списке приложений — открывай с него.'),
    ],
    'android-firefox': [
      S('android-menu', 'Нажми ⋮ — меню Firefox.'),
      S(null, 'Выбери «Установить» (в старых версиях — «Добавить на главный экран»).'),
    ],
    'desktop-chrome': [
      S('desktop-bar', 'Справа в строке адреса нажми значок установки (монитор со стрелкой) → «Установить».'),
      S(null, 'Значка нет? Меню ⋮ → «Сохранить и поделиться» (или «Трансляция, сохранение и отправка») → «Установить страницу как приложение».'),
      S(null, DONE_PC),
    ],
    'desktop-edge': [
      S('desktop-bar', 'Нажми значок «Приложение доступно» в строке адреса → «Установить».'),
      S(null, 'Или меню … → «Приложения» → «Установить этот сайт как приложение».'),
      S(null, DONE_PC),
    ],
    'desktop-yandex': [
      S('desktop-bar', 'В Умной строке нажми значок меню → «Установить как приложение».'),
      S(null, 'Выбери вид — «Отдельное окно».'),
      S(null, DONE_PC),
    ],
    'firefox-win': [
      S('firefox-win', 'Firefox 143 и новее: нажми кнопку веб-приложения в строке адреса — dan4ik37 закрепится на панели задач и в меню «Пуск».'),
      S(null, 'Кнопки нет — обнови Firefox или открой dan4ik37.vercel.app в Chrome, Edge или Яндекс Браузере.'),
    ],
    'firefox-no': [
      S(null, 'Firefox на Mac и Linux пока не умеет устанавливать сайты как приложения.'),
      S(null, 'Открой dan4ik37.vercel.app в Chrome, Edge или Яндекс Браузере (на Mac — ещё в Safari) и нажми «📲 Установить приложение».'),
    ],
    'mac-safari': [
      S('mac-dock', 'Safari на Mac (macOS 14 и новее): меню «Файл» → «Добавить в Dock…» → «Добавить».'),
      S(null, 'Значок dan4ik37 появится в Dock и в Launchpad — приложение откроется в своём окне.'),
    ],
    inapp: [
      S('open-browser', 'Сайт открыт внутри другого приложения (Telegram, ВКонтакте, YouTube…). Нажми ⋮ или ••• → «Открыть в браузере».'),
      S(null, 'В браузере открой меню сайта → «📲 Установить приложение».'),
    ],
    none: [
      S(null, 'Этот браузер не умеет устанавливать сайты как приложения.'),
      S(null, 'Открой dan4ik37.vercel.app в Chrome, Edge, Яндекс Браузере или Safari — там кнопка «Установить».'),
    ],
  };
  // Safari в iOS 26: «Поделиться» спрятано под «•••» справа от адреса
  STEPS.ios26 = [S('ios-dots', 'Нажми «•••» справа от адреса сайта, потом «Поделиться».'), ...STEPS.ios.slice(1)];
  const OTHER = [['ios', '📱 iPhone / iPad'], ['android', '🤖 Android'], ['desktop-chrome', '💻 Компьютер']];
  const steps = (how, env) => STEPS[how === 'ios' && env?.ios26 ? 'ios26' : how] || STEPS.none;

  // ═══ Окно ═══
  let el = null, ctx = null, back = null, cur = null;
  function render(){
    if (!el || !ctx) return;
    const canPrompt = !!ctx.prompt?.() && cur === ctx.how;
    const list = steps(cur, cur === ctx.how ? ctx.env : null);
    const note = cur === 'ios' || cur === 'ios-other'
      ? '<p class="aps-note">🔔 На iPhone уведомления работают только в приложении с экрана «Домой» (iOS 16.4+): открой его и включи 🔔 в профиле.</p>' : '';
    el.querySelector('.aps-main').innerHTML = canPrompt
      ? `<button type="button" class="aps-go aps-big" data-apg="prompt">📲 Установить</button><small class="aps-small">Браузер спросит «Установить приложение?» — нажми «Установить».</small>`
      : `<ol class="aps-steps">${list.map((s, i) => `<li>${s.pic && PICS[s.pic] ? `<figure>${PICS[s.pic]}</figure>` : ''}<p><b>${i + 1}</b>${esc(s.text)}</p></li>`).join('')}</ol>${note}`;
    el.querySelectorAll('[data-apg-tab]').forEach(b => { const on = b.dataset.apgTab === cur; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  }
  function open(c){
    ctx = c || {}; cur = ctx.how || 'none';
    close(true);
    back = doc.activeElement;
    el = doc.createElement('div');
    el.id = 'appSheet'; el.className = 'aps'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'apsT');
    el.innerHTML = `<div class="aps-box">
      <button type="button" class="aps-x" data-apg="close" aria-label="Закрыть">✕</button>
      <div class="aps-head"><img src="/icon-192.png" alt="" width="54" height="54"><div><b id="apsT">Приложение dan4ik37</b><span>Это тот же сайт — только как программа</span></div></div>
      <ul class="aps-why">
        <li>🪟 Своё окно — без вкладок и строки адреса</li>
        <li>🔴 Число новых сообщений и звонков на значке</li>
        <li>🎮 Судоку, пасьянсы, 2048 и другие — даже без интернета</li>
        <li>⚡ Открывается сразу и обновляется само</li>
      </ul>
      ${ctx.installed ? '<p class="aps-note">✅ Похоже, приложение уже установлено — открой его значком на экране или рабочем столе.</p>' : ''}
      <div class="aps-main"></div>
      <div class="aps-other"><span>Другое устройство:</span>${OTHER.map(([k, t]) => `<button type="button" data-apg-tab="${k}">${t}</button>`).join('')}${OTHER.some(([k]) => k === ctx.how) ? '' : `<button type="button" data-apg-tab="${esc(ctx.how)}">🧭 Этот браузер</button>`}</div>
      <p class="aps-small">Вход, монеты, друзья и игры — общие с сайтом. Удалить — как обычное приложение.</p>
    </div>`;
    doc.body.appendChild(el);
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    render();
    requestAnimationFrame(() => el?.classList.add('on'));
    (el.querySelector('[data-apg="prompt"]') || el.querySelector('.aps-x'))?.focus?.({ preventScroll: true });
    try { if (typeof root.va === 'function') root.va('event', { name: 'app_guide_open', data: { how: cur } }); } catch (e) {}
  }
  function onClick(e){
    if (e.target === el) { close(); return; }
    const b = e.target.closest?.('[data-apg], [data-apg-tab]'); if (!b) return;
    if (b.dataset.apgTab) { cur = b.dataset.apgTab; render(); return; }
    if (b.dataset.apg === 'close') close();
    else if (b.dataset.apg === 'prompt') { const c = ctx; close(); c?.install?.(); }
  }
  function close(silent){
    if (!el) return;
    const x = el; el = null;
    x.classList.remove('on');
    setTimeout(() => x.remove(), silent ? 0 : 220);
    if (!silent && back && doc.body.contains(back) && back.focus) try { back.focus({ preventScroll: true }); } catch (e) {}
    back = null;
  }

  root.D37AppGuide = { open, close: () => close(), refresh: render, isOpen: () => !!el, steps, PICS, STEPS };
})();
