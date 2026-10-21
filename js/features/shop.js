// ═══════════════════════════════════════
//  💎 МАГАЗИН (#/shop) — кристаллы: купить, потратить, история; донат DonationAlerts; админ
// ═══════════════════════════════════════
// Данные и вызовы — js/core/premium.js (D37Gems), начисляет только сервер (premium.sql, api/pay.js).
// 22.10.2026: оплата — пока только Kaspi (заказ D37-…, админ подтверждает «✓ Оплачено»; TipTop Pay / Freedom Pay — код есть,
// включаются переменной PAY_CARDS=1). Перед оплатой — согласие на обработку данных и условия возврата; по возрасту: до 14 —
// нельзя, год не указан — сначала указать (premium_pay_age). Цены — окончательные. Донат DonationAlerts — поддержка стрима:
// даёт статус «💛 Донатер», а не 💎 (выключатель donate_rewards в premium.sql). Без лутбоксов и случайных наград.
// #/shop/o/<заказ> — вернулся со страницы оплаты (Freedom Pay) → ждём зачисления; #/shop/vip, #/shop/donate — к разделу.
let shopMethods = null, shopBusy = false, shopWatch = '';

const shopToast = t => (typeof xpToast === 'function' ? xpToast(t) : alert(t));
const shopNum = n => Number(n || 0).toLocaleString('ru');
const shopMoney = (n, cur) => shopNum(n) + (cur === 'RUB' ? ' ₽' : ' ₸');
const shopDate = d => d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const shopTime = d => d ? new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

async function renderShopPage(param){
  const root = document.getElementById('shopRoot');
  if (!root || !window.D37Gems) return;
  if (!root.dataset.ready) root.innerHTML = '<div class="shp-load">Загружаем магазин…</div>';
  const [S, M] = await Promise.all([D37Gems.sync(), D37Gems.methods()]);
  shopMethods = M;
  root.dataset.ready = '1';
  shopRender(S);
  const m = /^(o|fail)\/(D37-[\w-]{4,40})$/.exec(param || '');
  if (m) shopAfterRedirect(m[2], m[1] === 'fail');
  else if (param === 'vip' || param === 'donate' || param === 'buy') document.getElementById('shp-' + param)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function shopRender(S){
  const root = document.getElementById('shopRoot');
  if (!root) return;
  const G = D37Gems, C = G.CFG, authed = !!currentUser, on = S.ready === true, ok = !!S.ok;
  const methods = on ? (shopMethods?.methods || []) : [], cur = shopMethods?.currency || 'KZT';
  const vip = shopVipLine();
  const items = S.items || C.items;
  const item = id => items.find(x => x.id === id);
  const bal = S.balance || 0;
  const canSpend = p => ok && bal >= p;
  const login = currentProfile?.donate_login || '';
  // Что даёт донат — как donateMode() в profile.js: пока на базе старый premium.sql, сервер по-старому даёт VIP/💎
  const donOff = (typeof donateMode === 'function' ? donateMode() : (S.donate_rewards || 'vip')) === 'off';

  // ── Шапка: что это и сколько у меня ──
  const head = `<div class="shp-head pf-card pf-card-gold">
    <div class="shp-gem" aria-hidden="true">${C.icon}</div>
    <div class="shp-head-body">
      <h3>${C.name} — валюта сайта</h3>
      <p>На ${C.name.toLowerCase()} покупают VIP (себе или в подарок другу), монеты 🪙 и вещи для персонажа. ${donOff ? 'Кристаллы покупают через Kaspi (когда откроется оплата); донат — это поддержка стрима, за него — статус «💛 Донатер», а не кристаллы.' : 'Кристаллы покупают за реальные деньги — через Kaspi или донатом, — и это поддерживает стримы Денчика37.'} Обратно в деньги они не меняются.</p>
      ${!on ? `<div class="shp-note">⏳ Магазин кристаллов скоро откроется.</div>` : ''}
    </div>
    <div class="shp-wallet">
      ${!authed ? `<button type="button" class="pf-btn pf-btn-gold" onclick="shopLogin()">Войти</button><small>кристаллы хранятся в аккаунте</small>`
        : ok ? `<span class="shp-bal">${C.icon} <b class="js-gems">${shopNum(bal)}</b></span><small>${G.word(bal)} у тебя</small>${S.debt ? `<small class="shp-warn">долг после возврата денег: ${shopNum(S.debt)} ${C.icon}</small>` : ''}`
        : `<span class="shp-bal">${C.icon} <b>—</b></span><small>скоро</small>`}
    </div>
  </div>`;

  // ── Как купить: карта Казахстана / Kaspi ──
  const packCards = (S.packs || C.packs).map(p => {
    const price = cur === 'RUB' ? p.rub : p.kzt;
    const pct = p.bonus ? Math.round(p.bonus / (p.gems - p.bonus) * 100) : 0;
    return `<button type="button" class="shp-pack" onclick="shopBuy('${p.id}')" ${!methods.length ? 'aria-disabled="true"' : ''}>
      ${pct ? `<span class="shp-bonus">+${pct}%</span>` : ''}
      <span class="shp-pack-gems">${C.icon} ${shopNum(p.gems)}</span>
      ${p.bonus ? `<small>${shopNum(p.gems - p.bonus)} + ${shopNum(p.bonus)} в подарок</small>` : `<small>${G.word(p.gems)}</small>`}
      <b>${shopMoney(price, cur)}</b>
    </button>`;
  }).join('');
  // Возраст (premium.sql premium_pay_age, js/core/age.js): до 14 лет — нельзя; год не указан — сначала указать (его видит только сам)
  const payAge = shopPayAge(S);
  const kaspiOnly = methods.length && methods.every(m => m.id === 'kaspi');
  const card = `<section class="shp-way pf-card pf-card-tw" id="shp-buy">
    <div class="shp-way-top"><span class="shp-flag" aria-hidden="true">💳</span><div><h4>${kaspiOnly || !methods.length ? 'Kaspi' : 'Карта Казахстана или Kaspi'}</h4>
      <p>${kaspiOnly || !methods.length ? 'Оплата в приложении Kaspi.kz по номеру заказа — кристаллы придут после проверки оплаты (обычно в течение дня).' : 'Visa и Mastercard банков Казахстана, Apple Pay и Google Pay, Kaspi.'} Цена — окончательная, налоги включены.</p></div></div>
    ${payAge === 'age_child' ? `<div class="shp-kid"><b>👨‍👩‍👧 Покупать можно с 14 лет</b>
      <p>Тебе пока меньше 14, поэтому оплата на сайте выключена — так никто не потратит деньги случайно. Если очень хочется кристаллы или VIP, покажи эту страницу родителям: взрослый может купить кристаллы на своём аккаунте и подарить тебе VIP по нику («🎁 VIP в подарок» ниже).</p></div>`
      : payAge === 'age_unknown' && authed ? `<div class="shp-kid"><b>🎂 Сначала укажи год рождения</b>
      <p>Покупать можно с 14 лет (до 18 — с разрешения взрослого и с лимитами). Год видишь только ты — ни админ, ни другие его не видят.</p>
      <button type="button" class="pf-btn pf-btn-gold pf-btn-sm" onclick="window.D37Age?.ask?.({ edit: true })">🎂 Указать год</button></div>`
      : `<div class="shp-packs">${packCards}</div>
    ${methods.length ? `<div class="shp-small">Способ: ${methods.map(m => esc(m.title)).join(' · ')}. Карты российских банков здесь не пройдут.</div>`
      : `<div class="shp-soon">🔜 Оплата скоро — владелец подключает Kaspi.</div>`}`}
  </section>`;

  // ── Донат DonationAlerts: 'off' — статус «💛 Донатер» (поддержка, не покупка); 'vip' / 'gems' — как до 22.10 ──
  const rate = S.rate || 1, bonusOn = S.bonus !== false;
  const DN = window.D37Donor;
  if (donOff) {
    const lv = DN ? DN.LEVELS.map(l => `<span>${DN.roman(l.lv)} — от <b>${shopNum(l.min)} ₽</b></span>`).join('') : '';
    var donate = `<section class="shp-way pf-card pf-card-accent" id="shp-donate">
    <div class="shp-way-top"><span class="shp-flag" aria-hidden="true">💛</span><div><h4>Поддержать стрим донатом</h4>
      <p>Донат на DonationAlerts — это поддержка стрима, а не покупка: кристаллы и VIP за него не начисляются. Взамен — спасибо и статус <b>«💛 Донатер»</b> на ${DN?.RULES?.days || 30} дней с бонусами как у VIP (на игры и рейтинги не влияют). Уровень — по сумме донатов за ${DN?.RULES?.days || 30} дней:</p></div></div>
    <div class="shp-don-table">${lv}</div>
    <ol class="shp-steps">
      <li>${login ? `Твой логин для доната: <b class="shp-login">${esc(login)}</b> <button type="button" class="dl-copy" onclick="copyDonateLogin(this)">📋 Скопировать</button>`
        : authed ? `Придумай <b>логин для доната</b> в профиле — один раз. <a class="dl-copy" href="#/profile/vip">🔑 Задать логин</a>`
        : `<a href="#" onclick="shopLogin();return false">Войди или зарегистрируйся</a> и задай в профиле <b>логин для доната</b>.`}</li>
      <li>На DonationAlerts в поле «Ваше имя» вставь <b>этот логин</b> (не ник!). Сумма — любая. Засчитываются донаты, сделанные после того, как логин задан.</li>
      <li>Через пару минут статус включится сам. Не засчитался? В профиле есть «Задонатил — не засчиталось?».</li>
    </ol>
    <a class="pf-btn pf-btn-primary shp-don-btn" href="${C.donateUrl}" target="_blank" rel="noopener" onclick="shopDonateClick()">💝 Задонатить на DonationAlerts</a>
  </section>`;
  }
  const donTable = [100, 500, 1000, 2000].map(r => `<span>${shopNum(r)} ₽ → <b>${C.icon} ${shopNum(shopDonGems(r, rate, bonusOn))}</b></span>`).join('');
  const mode = S.mode || 'vip';
  const modeBox = ok && !donOff ? `<div class="shp-mode" role="radiogroup" aria-label="Что даёт донат">
      <button type="button" role="radio" aria-checked="${mode === 'vip'}" class="${mode === 'vip' ? 'on' : ''}" onclick="shopSetMode('vip')"><b>✨ VIP сразу</b><small>100 ₽ = месяц VIP, остаток копится — как раньше</small></button>
      <button type="button" role="radio" aria-checked="${mode === 'gems'}" class="${mode === 'gems' ? 'on' : ''}" onclick="shopSetMode('gems')"><b>${C.icon} Кристаллы</b><small>1 ₽ = ${shopNum(rate)} ${C.icon}${bonusOn ? ', крупный донат — с бонусом' : ''}; тратишь как хочешь</small></button>
    </div>` : '';
  if (!donOff) var donate = `<section class="shp-way pf-card pf-card-accent" id="shp-donate">
    <div class="shp-way-top"><span class="shp-flag" aria-hidden="true">💝</span><div><h4>Из России и других стран — донатом</h4>
      <p>Российские карты казахстанские платёжные системы не принимают, поэтому для России — донат на DonationAlerts (карта, СБП и другие способы). ${ok ? 'Донат сам превратится в VIP или кристаллы — как выберешь ниже.' : 'Донат сам включает VIP: 100 ₽ = месяц, остаток копится.'}</p></div></div>
    ${ok ? `<div class="shp-don-table">${donTable}</div>` : ''}
    ${modeBox}
    <ol class="shp-steps">
      <li>${login ? `Твой логин для доната: <b class="shp-login">${esc(login)}</b> <button type="button" class="dl-copy" onclick="copyDonateLogin(this)">📋 Скопировать</button>`
        : authed ? `Придумай <b>логин для доната</b> в профиле — один раз. <a class="dl-copy" href="#/profile/vip">🔑 Задать логин</a>`
        : `<a href="#" onclick="shopLogin();return false">Войди или зарегистрируйся</a> и задай в профиле <b>логин для доната</b>.`}</li>
      <li>На DonationAlerts в поле «Ваше имя» вставь <b>этот логин</b> (не ник!). Сумма — любая. Засчитываются донаты, сделанные после того, как логин задан.</li>
      <li>Через пару минут ${ok && mode === 'gems' ? 'кристаллы появятся на балансе' : 'VIP включится сам'} — обнови страницу. Не пришло? В профиле есть «Задонатил — не засчиталось?».</li>
    </ol>
    <a class="pf-btn pf-btn-primary shp-don-btn" href="${C.donateUrl}" target="_blank" rel="noopener" onclick="shopDonateClick()">💝 Задонатить на DonationAlerts</a>
  </section>`;

  // ── На что потратить ──
  const vipCards = ['vip:1', 'vip:3', 'vip:12'].map(id => {
    const it = item(id); if (!it) return '';
    const per = Math.round(it.price / it.months);
    return `<div class="shp-item">
      <b>✨ ${esc(it.title)}</b>
      <span class="shp-price">${C.icon} ${shopNum(it.price)}</span>
      <small>${it.months > 1 ? `${per} ${C.icon} в месяц` : 'как донат 100 ₽'}</small>
      <button type="button" class="pf-btn pf-btn-gold pf-btn-sm" onclick="shopSpend('${it.id}')" ${canSpend(it.price) ? '' : 'disabled'}>Купить</button>
    </div>`;
  }).join('');
  const gift = item('gift:1');
  const coins = ['coins:100', 'coins:550', 'coins:1200'].map(item).filter(Boolean);
  const skins = items.filter(x => x.kind === 'skin');
  const readySkins = skins.filter(x => window.D37Char && D37Char.price(x.id) != null);
  const spendNote = !authed ? `<a href="#" onclick="shopLogin();return false">Войди</a>, чтобы тратить кристаллы.` : !on ? 'Откроется вместе с магазином — скоро.'
    : !bal ? 'Сначала нужны кристаллы — купи картой или получи донатом ↑' : '';
  const spend = `<section class="shp-spend" id="shp-vip">
    <h3 class="shp-h">На что потратить</h3>
    ${spendNote ? `<p class="shp-small shp-spend-note">${spendNote}</p>` : ''}
    <div class="shp-block pf-card pf-card-gold">
      <div class="shp-block-head"><b>✨ VIP</b><span>${vip}</span></div>
      <div class="shp-items">${vipCards}</div>
      <p class="shp-small">VIP: цветной ник, GIF-аватарка, стикеры, закреп в чате, сайт без рекламы. Уровень (VIP · Silver · Gold) растёт с суммой покупок кристаллов за всё время${donOff ? ' (и донатов до 22.10.2026)' : ' и донатов'}: Silver — от 500 ₽, Gold — от 1500 ₽. Есть и статус «💛 Донатер» — у кого оба, действует лучшее. <a href="/vip">Что даёт VIP</a></p>
    </div>
    ${gift ? `<div class="shp-block pf-card pf-card-tw">
      <div class="shp-block-head"><b>🎁 VIP в подарок другу</b><span>${C.icon} ${shopNum(gift.price)} — месяц</span></div>
      <form class="shp-gift" onsubmit="shopGift(event)"><input name="nick" maxlength="24" placeholder="Ник друга на сайте" autocomplete="off" required>
        <button type="submit" class="pf-btn pf-btn-tw pf-btn-sm" ${canSpend(gift.price) ? '' : 'disabled'}>Подарить</button></form>
      <p class="shp-small">Другу придёт уведомление. До 5 подарков в сутки.</p>
    </div>` : ''}
    <div class="shp-block pf-card pf-card-muted">
      <div class="shp-block-head"><b>🪙 Обменять на монеты</b><span>только в одну сторону</span></div>
      <div class="shp-items">${coins.map(it => `<div class="shp-item">
        <b>🪙 ${shopNum(it.coins)}</b><span class="shp-price">${C.icon} ${shopNum(it.price)}</span>
        <button type="button" class="pf-btn pf-btn-ghost pf-btn-sm" onclick="shopSpend('${it.id}')" ${canSpend(it.price) ? '' : 'disabled'}>Обменять</button></div>`).join('')}</div>
      <p class="shp-small">Монеты — на героев и улучшения в играх и части персонажа в гардеробе. Монеты обратно в кристаллы не меняются.</p>
    </div>
    <div class="shp-block pf-card pf-card-accent">
      <div class="shp-block-head"><b>🎭 Эксклюзивы для персонажа</b><span>только за ${C.icon}</span></div>
      ${readySkins.length ? `<div class="shp-items">${readySkins.map(it => {
        const own = window.D37Coins?.owns(it.id);
        return `<div class="shp-item"><b>${esc(it.title)}</b><span class="shp-price">${C.icon} ${shopNum(it.price)}</span>
          ${own ? '<small>✅ уже твоё — надень в гардеробе</small>' : `<button type="button" class="pf-btn pf-btn-primary pf-btn-sm" onclick="shopSpend('${it.id}')" ${canSpend(it.price) ? '' : 'disabled'}>Купить</button>`}</div>`;
      }).join('')}</div>` : `<p class="shp-small">Скоро в гардеробе: ${skins.map(x => esc(x.title.toLowerCase())).join(', ')}. Каждая вещь — с понятной ценой, без случайных «сундуков».</p>`}
    </div>
    <div class="shp-block pf-card pf-card-tw">
      <div class="shp-block-head"><b>📣 Реклама на сайте</b><span>для блогеров и магазинов</span></div>
      <p class="shp-small" style="margin-top:0">Своя кампания за ${C.icon}: карточка в ленте, баннер, столбик у игры или щит в 3D-мире — с проверкой и статистикой по дням. Неизрасходованное возвращается.</p>
      <a class="pf-btn pf-btn-tw pf-btn-sm" href="#/adv" style="text-decoration:none">Открыть кабинет рекламы →</a>
    </div>
  </section>`;

  // ── История ──
  const KIND = { pay: 'Покупка', donation: 'Донат', convert: 'Остаток доната', grant: 'Подарок от сайта', revoke: 'Списание', spend: 'Покупка в магазине', gift: 'Подарок другу', refund: 'Возврат денег', debt: 'Погашение долга',
    ads: 'Реклама на сайте', ads_refund: 'Возврат остатка рекламы',   // ads — кабинет рекламодателя #/adv (ads.sql)
    ref: 'Бонус за друзей', ref_back: 'Друг вернул деньги — бонус списан' };   // 👥 приглашения (referrals2.sql)
  const hist = ok ? `<section class="shp-block pf-card pf-card-muted" id="shp-hist">
    <div class="shp-block-head"><b>🧾 История</b><span>последние операции</span></div>
    ${(S.orders || []).filter(o => o.status === 'new' && o.provider === 'kaspi').map(o => `<div class="shp-row shp-wait"><span>⏳ Заказ <b>${esc(o.id)}</b> (Kaspi) — ждёт проверки оплаты</span><span>${C.icon} ${shopNum(o.gems)} · ${shopMoney(o.amount, o.currency)}</span></div>`).join('')}
    ${(S.history || []).length ? (S.history || []).map(h => `<div class="shp-row">
      <span><small>${shopTime(h.created_at)}</small> ${esc(KIND[h.kind] || h.kind)}${h.note ? ` — ${esc(h.note)}` : ''}</span>
      <span class="${h.amount > 0 ? 'plus' : h.amount < 0 ? 'minus' : ''}">${h.amount > 0 ? '+' : ''}${shopNum(h.amount)} ${C.icon}</span></div>`).join('')
      : '<p class="shp-small">Пока пусто.</p>'}
  </section>` : '';

  // ── Родителям ──
  const parents = `<section class="shp-block pf-card pf-card-muted shp-parents">
    <div class="shp-block-head"><b>👨‍👩‍👧 Для родителей и честно о покупках</b></div>
    <ul>
      <li>Кристаллы — цифровая валюта этого сайта, не деньги. Их нельзя вывести или продать, они не передаются другим аккаунтам (кроме подарка VIP).</li>
      <li>Каждая покупка — только с отметкой «плачу я (мне есть 18) или взрослый, который разрешил» и согласием на обработку данных. Детям — пожалуйста, спросите родителей.</li>
      <li>Лимиты на покупки: ${payAge === 'age_child' ? 'до 14 лет оплата выключена' : `до ${shopNum(S.limits?.day_rub ?? 3000)} ₽ в сутки и ${shopNum(S.limits?.month_rub ?? 10000)} ₽ за 30 дней`} — защита от случайных трат.</li>
      <li>Покупать можно, когда указан год рождения (⚙️ Настройки → Сайт → 🎂, его видит только сам человек): до 14 лет — нельзя, 14–15 лет — до 1000 ₽ в сутки и 3000 ₽ за 30 дней, 16–17 лет — до 2000 ₽ и 6000 ₽.</li>
      <li>Цены — окончательные: налоги уже включены, при оплате ничего не добавляется.</li>
      <li>Донат на DonationAlerts — это поддержка стрима, а не покупка: кристаллов и VIP за него нет, только статус «💛 Донатер» и спасибо.</li>
      <li>Никаких лутбоксов, «сундуков» и случайных наград — всегда видно, что получаешь и сколько это стоит.</li>
      <li>Ошибся или купил без спроса — напишите нам: неистраченные кристаллы вернём деньгами. <a href="/refund">Политика возврата</a></li>
    </ul>
    <div class="shp-legal"><a href="/terms">Пользовательское соглашение</a> · <a href="/refund">Возврат</a> · <a href="/contacts">Реквизиты и контакты</a> · <a href="/privacy">Конфиденциальность</a></div>
  </section>`;

  const admin = currentRole === 'admin' ? `<section class="shp-block pf-card pf-card-danger" id="shpAdmin"><div class="shp-block-head"><b>🛠 Админ: кристаллы</b><span>видно только тебе</span></div><div id="shpAdminBody">${on ? 'Загружаем…' : 'premium.sql ещё не выполнен — инструменты появятся после него.'}</div></section>` : '';

  root.innerHTML = head + `<div class="shp-ways">${card}${donate}</div>` + spend + hist + parents + admin;
  if (currentRole === 'admin' && on) shopAdminLoad();
}

// Можно ли платить по возрасту: сервер (premium_state.pay_age) главнее; до ответа — по году в браузере (js/core/age.js)
function shopPayAge(S){
  if (S?.pay_age) return S.pay_age;
  if (S?.cards === true) return null;
  const A = window.D37Age;
  if (!A?.known?.()) return currentUser ? 'age_unknown' : null;
  const a = A.age?.();
  return typeof a === 'number' && a < 14 ? 'age_child' : null;
}

// Сколько 💎 даст донат (как premium_donation_gems в premium.sql)
function shopDonGems(rub, rate, bonus){
  const base = Math.floor(rub * rate);
  const pct = !bonus ? 0 : rub >= 2000 ? 30 : rub >= 1000 ? 20 : rub >= 500 ? 10 : 0;
  return base + Math.floor(base * pct / 100);
}

function shopVipLine(){
  const p = currentProfile;
  if (!currentUser || !p) return 'войди, чтобы купить';
  const t = typeof getVipTier === 'function' ? getVipTier(p) : null;
  if (p.is_vip && !p.vip_until) return 'у тебя бессрочный VIP 💛';
  const until = typeof vipEffectiveUntil === 'function' ? vipEffectiveUntil(p) : p.vip_until;
  return t ? `у тебя ${t.label}${until ? ' до ' + shopDate(until) : ''}` : 'сейчас VIP нет';
}

function shopLogin(){
  try { sessionStorage.setItem('d37_back', '#/shop'); } catch (e) {}
  openGlobalAuth();
}
// Указал / сменил возраст — правила оплаты другие (js/core/age.js)
window.addEventListener('d37:age', () => { if (document.body.dataset.route === 'shop') renderShopPage(); });
window.addEventListener('d37:auth', () => {
  let back = null;
  try { back = sessionStorage.getItem('d37_back'); sessionStorage.removeItem('d37_back'); } catch (e) {}
  if (currentUser && back === '#/shop') setTimeout(() => { location.hash = '#/shop'; }, 500);
  else if (document.body.dataset.route === 'shop') renderShopPage();
});
function shopDonateClick(){
  if (currentProfile?.donate_login) { try { navigator.clipboard.writeText(currentProfile.donate_login); } catch (e) {} }
  if (typeof window.va === 'function') window.va('event', { name: 'shop_donate_click' });
}

// ── Покупка пакета ──
function shopBuy(packId){
  const G = window.D37Gems, C = G.CFG, S = G.state();
  const p = (S.packs || C.packs).find(x => x.id === packId);
  if (!p) return;
  const methods = shopMethods?.methods || [];
  if (!methods.length) { document.getElementById('shp-donate')?.scrollIntoView({ behavior: 'smooth' }); shopToast(S.ready === true ? 'Оплата картой появится скоро — пока кристаллы можно получить донатом' : 'Оплата картой появится скоро — а VIP уже сейчас можно получить донатом'); return; }
  if (!currentUser) { shopLogin(); return; }
  if (S.ready !== true) { shopToast('Магазин скоро откроется'); return; }
  const pa = shopPayAge(S);
  if (pa === 'age_child' || pa === 'age_unknown') { shopToast(SHOP_ERR[pa]); if (pa === 'age_unknown') window.D37Age?.ask?.({ edit: true }); return; }
  const cur = shopMethods.currency || 'KZT', price = cur === 'RUB' ? p.rub : p.kzt;
  shopModal(`<h4>${C.icon} ${shopNum(p.gems)} ${G.word(p.gems)} за ${shopMoney(price, cur)}</h4>
    <div class="shp-methods" role="radiogroup" aria-label="Способ оплаты">${methods.map((m, i) => `<label class="shp-method"><input type="radio" name="shpMethod" value="${esc(m.id)}" ${i ? '' : 'checked'}>
      <span><b>${esc(m.title)}</b><small>${esc(m.note || '')}</small></span></label>`).join('')}</div>
    <label class="shp-consent"><input type="checkbox" id="shpConsent"> <span>Мне есть 18 лет, или эту покупку оплачивает взрослый (родитель) — или он разрешил её.</span></label>
    <label class="shp-consent"><input type="checkbox" id="shpPd"> <span>Согласен(на) на обработку персональных данных для оплаты — <a href="/privacy#pay" target="_blank">политика конфиденциальности</a>.</span></label>
    <p class="shp-small">Цена окончательная — налоги включены, при оплате ничего не добавляется. Кристаллы — цифровая валюта сайта, они придут на аккаунт <b>${esc(currentProfile?.nick || '')}</b> после оплаты. Неистраченные кристаллы можно вернуть — <a href="/refund" target="_blank">условия возврата</a>. Покупая, соглашаешься с <a href="/terms" target="_blank">правилами</a>.</p>
    <div class="shp-modal-err" role="alert"></div>
    <div class="shp-modal-act"><button type="button" class="pf-btn pf-btn-ghost" onclick="shopModalClose()">Отмена</button>
      <button type="button" class="pf-btn pf-btn-gold" id="shpPayBtn" onclick="shopPay('${p.id}')">Перейти к оплате</button></div>`);
}

const SHOP_ERR = {
  consent: 'Отметь галочку: покупку делает взрослый или с его разрешения.',
  pd: 'Отметь согласие на обработку персональных данных — без него оплата невозможна.',
  age_unknown: 'Сначала укажи год рождения (его видишь только ты): покупать можно с 14 лет.',
  limit_day: 'Лимит покупок на сегодня исчерпан — это защита от случайных трат. Попробуй завтра.',
  limit_month: 'Лимит покупок за 30 дней исчерпан — это защита от случайных трат.',
  too_many: 'Слишком много неоплаченных заказов — попробуй через час.',
  age_child: 'Покупать можно с 14 лет. Попроси родителей: взрослый может купить на своём аккаунте и подарить тебе VIP по нику.',
  auth: 'Сначала войди на сайт.', off: 'Оплата пока не подключена — скоро.', method: 'Этот способ оплаты сейчас недоступен.',
  provider: 'Платёжная система не ответила — попробуй ещё раз или другой способ.', network: 'Нет связи — проверь интернет.',
};
async function shopPay(packId){
  if (shopBusy) return;
  const box = document.querySelector('.shp-modal'), err = box?.querySelector('.shp-modal-err');
  const method = box?.querySelector('input[name="shpMethod"]:checked')?.value;
  if (!document.getElementById('shpConsent')?.checked) { err.textContent = SHOP_ERR.consent; return; }
  if (!document.getElementById('shpPd')?.checked) { err.textContent = SHOP_ERR.pd; return; }
  shopBusy = true;
  const btn = document.getElementById('shpPayBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Создаём заказ…'; }
  const res = await D37Gems.order(packId, method);
  shopBusy = false;
  if (!res?.ok) {
    if (btn) { btn.disabled = false; btn.textContent = 'Перейти к оплате'; }
    let t = SHOP_ERR[res?.reason] || 'Не получилось создать заказ — попробуй ещё раз.';
    // Лимит ещё не исчерпан, просто пакет крупнее остатка
    if (/^limit_/.test(res?.reason) && res.left > 0) t = `Этот пакет больше лимита покупок ${res.reason === 'limit_day' ? 'на сегодня' : 'на 30 дней'} — это защита от случайных трат. Выбери пакет поменьше.`;
    err.textContent = t; return;
  }
  if (typeof window.va === 'function') window.va('event', { name: 'shop_order', data: { pack: packId, method } });
  if (res.pay?.type === 'manual') return shopKaspi(res);
  if (res.pay?.type === 'redirect') { if (btn) btn.textContent = 'Открываем оплату…'; D37Gems.pay(res); return; }
  shopModalClose();
  const r = await D37Gems.pay(res);
  if (r.status === 'success') return shopWaitPaid(res.order, res.gems);
  if (r.status === 'cancel') shopToast('Оплата отменена — ничего не списано');
  else shopToast('Оплата не прошла. Деньги не списаны — попробуй ещё раз.');
}

function shopKaspi(res){
  const C = D37Gems.CFG;
  shopModal(`<h4>Оплата через Kaspi</h4>
    <ol class="shp-steps">
      <li>Нажми «Открыть Kaspi» и оплати ровно <b>${shopMoney(res.amount, res.currency)}</b>.</li>
      <li>Номер заказа: <b class="shp-login">${esc(res.order)}</b> <button type="button" class="dl-copy" onclick="shopCopy('${esc(res.order)}', this)">📋 Скопировать</button> — если Kaspi предложит комментарий, впиши его туда.</li>
      <li>${C.icon} ${shopNum(res.gems)} придут после проверки оплаты (сверяем сумму и время) — обычно в течение дня. Заказ виден в «Истории». Не пришло за сутки — напиши нам номер заказа: <a href="/contacts" target="_blank">контакты</a>.</li>
    </ol>
    <div class="shp-modal-act"><button type="button" class="pf-btn pf-btn-ghost" onclick="shopModalClose()">Готово</button>
      <a class="pf-btn pf-btn-gold" href="${esc(res.pay.link)}" target="_blank" rel="noopener">Открыть Kaspi</a></div>`);
  D37Gems.sync().then(shopRender);
}
async function shopCopy(text, btn){
  try { await navigator.clipboard.writeText(text); } catch (e) {}
  const old = btn.textContent; btn.textContent = '✅ Скопировано'; setTimeout(() => { btn.textContent = old; }, 1500);
}

async function shopWaitPaid(orderId, gems){
  if (shopWatch === orderId) return;
  shopWatch = orderId;
  const C = D37Gems.CFG;
  shopModal(`<h4>⏳ Проверяем оплату…</h4><p class="shp-small">Заказ <b>${esc(orderId)}</b>. Обычно это несколько секунд — можно не закрывать окно.</p>`);
  const r = await D37Gems.watch(orderId);
  shopWatch = '';
  if (r?.status === 'paid') {
    shopModal(`<h4>✅ +${shopNum(gems || r.gems)} ${C.icon}</h4><p>Оплата прошла, кристаллы на балансе. Спасибо за поддержку! 💛</p>
      <div class="shp-modal-act"><button type="button" class="pf-btn pf-btn-gold" onclick="shopModalClose()">Отлично</button></div>`);
    if (typeof window.va === 'function') window.va('event', { name: 'shop_paid' });
  } else if (r?.status === 'failed') {
    shopModal(`<h4>Оплата не прошла</h4><p class="shp-small">Деньги не списаны. Попробуй ещё раз или другой способ.</p><div class="shp-modal-act"><button type="button" class="pf-btn pf-btn-ghost" onclick="shopModalClose()">Закрыть</button></div>`);
  } else {
    shopModal(`<h4>Оплата ещё обрабатывается</h4><p class="shp-small">Если деньги списались, кристаллы придут сами (придёт уведомление 🔔). Номер заказа: <b>${esc(orderId)}</b> — если что-то пойдёт не так, напиши его нам: <a href="/contacts">контакты</a>.</p><div class="shp-modal-act"><button type="button" class="pf-btn pf-btn-ghost" onclick="shopModalClose()">Понятно</button></div>`);
  }
  shopRender(D37Gems.state());
}
function shopAfterRedirect(orderId, failed){
  history.replaceState(null, '', '#/shop');
  if (failed) { shopToast('Оплата не прошла — деньги не списаны'); return; }
  if (currentUser) { shopWaitPaid(orderId, 0); return; }
  // Вернулись со страницы оплаты — вход ещё поднимается (Supabase восстанавливает сессию после загрузки)
  const done = () => { clearTimeout(t); window.removeEventListener('d37:auth', done); if (currentUser) shopWaitPaid(orderId, 0); };
  const t = setTimeout(() => { window.removeEventListener('d37:auth', done); if (!currentUser) shopToast('Войди, чтобы увидеть кристаллы'); }, 8000);
  window.addEventListener('d37:auth', done);
}

// ── Траты ──
async function shopSpend(id){
  const G = D37Gems, C = G.CFG, it = G.item(id);
  if (!it || shopBusy) return;
  const what = it.kind === 'coins' ? `Обменять ${C.icon} ${it.price} на 🪙 ${shopNum(it.coins)} монет? Обратно монеты в кристаллы не меняются.`
    : `Купить «${it.title}» за ${C.icon} ${shopNum(it.price)}?`;
  if (!confirm(what)) return;
  shopBusy = true;
  const r = await G.spend(id);
  shopBusy = false;
  shopSpendResult(r, it);
}
async function shopGift(e){
  e.preventDefault();
  const G = D37Gems, C = G.CFG, it = G.item('gift:1'), nick = e.target.elements.nick.value.trim();
  if (!it || !nick || shopBusy) return;
  if (!confirm(`Подарить VIP на месяц игроку «${nick}» за ${C.icon} ${it.price}?`)) return;
  shopBusy = true;
  const r = await G.spend('gift:1', nick);
  shopBusy = false;
  shopSpendResult(r, it);
}
async function shopSpendResult(r, it){
  const C = D37Gems.CFG;
  if (r?.ok) {
    shopToast(it.kind === 'coins' ? `🪙 +${shopNum(r.got)} монет` : it.kind === 'gift' ? `🎁 VIP подарен: ${r.to}` : `✅ Готово: ${it.title}`);
    if (it.kind === 'coins' || it.kind === 'skin') window.D37Coins?.sync();
    if (it.kind === 'vip') await shopRefreshProfile();
    shopRender(await D37Gems.sync());
    return;
  }
  const M = { gems: `Не хватает кристаллов — нужно ${C.icon} ${shopNum(r?.need || it.price)}.`, forever: 'У тебя (или у друга) бессрочный VIP — покупать не нужно.',
    target: 'Такого ника на сайте нет — проверь, как он пишется.', self: 'Себе подарок нельзя — купи VIP в блоке выше.', limit: 'Не больше 5 подарков в сутки.',
    owned: 'Эта вещь уже твоя.', closed: 'Магазин временно закрыт.', coins_off: 'Монеты на сервере ещё не включены.', off: 'Магазин скоро откроется.', auth: 'Сначала войди.' };
  shopToast(M[r?.reason] || 'Не получилось — попробуй ещё раз.');
}
async function shopRefreshProfile(){
  try { const { data } = await (await sbProfiles()).select('*').eq('id', currentUser.id).single(); if (data) currentProfile = data; } catch (e) {}
}

// ── Что даёт донат ──
async function shopSetMode(mode){
  const G = D37Gems, S = G.state(), C = G.CFG;
  if (S.mode === mode || shopBusy) return;
  if (mode === 'gems' && !confirm(`Теперь донаты будут давать ${C.name.toLowerCase()}, а не VIP сразу. VIP купишь за кристаллы здесь же (100 ${C.icon} = месяц, подольше — дешевле).${S.pending_rub ? ` Накопленный остаток к VIP-месяцу (${S.pending_rub} ₽) станет кристаллами.` : ''} Переключить?`)) return;
  shopBusy = true;
  const r = await G.setMode(mode);
  shopBusy = false;
  if (r?.ok) shopToast(mode === 'gems' ? `Донаты → ${C.icon}${r.converted ? ` (+${r.converted} за остаток)` : ''}` : 'Донаты → ✨ VIP сразу');
  else shopToast('Не получилось переключить — попробуй ещё раз.');
  shopRender(G.state());
}

// ── Окно ──
function shopModal(html){
  let el = document.getElementById('shpModal');
  if (!el) {
    el = document.createElement('div'); el.id = 'shpModal'; el.className = 'shp-overlay';
    el.addEventListener('click', e => { if (e.target === el && !shopBusy && !shopWatch) shopModalClose(); });
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="shp-modal" role="dialog" aria-modal="true">${html}</div>`;
  el.classList.add('open');
}
function shopModalClose(){ document.getElementById('shpModal')?.classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('shpModal')?.classList.contains('open') && !shopWatch) shopModalClose(); });

// ═══ Админ ═══
async function shopAdminLoad(){
  const body = document.getElementById('shpAdminBody');
  if (!body || !sbClient) return;
  const { data, error } = await sbClient.rpc('premium_admin_orders');
  if (error) { body.textContent = 'Не загрузилось: ' + humanErr(error); return; }
  const s = data.settings || {}, C = D37Gems.CFG, S0 = D37Gems.state() || {};
  shopTaxPeriod = s.tax_period || null;
  const row = (o, act) => `<div class="shp-row"><span><b>${esc(o.nick || '?')}</b> · ${esc(o.id || o.order_id || '')}${o.gems ? ` · ${C.icon} ${shopNum(o.gems)}` : ''} · ${shopMoney(o.amount, o.currency)}${o.provider ? ' · ' + esc(o.provider) : ''}${o.status && o.status !== 'paid' ? ' · ' + esc(o.status) : ''}${o.test ? ' · тест' : ''} <small>${shopTime(o.created_at || o.paid_at)}</small></span>${act || ''}</div>`;
  body.innerHTML = `
    <div class="shp-adm-sec"><b>Найти человека</b>
      <form class="shp-gift" onsubmit="shopAdminFind(event)"><input name="q" placeholder="ник или его часть" required><button class="pf-btn pf-btn-ghost pf-btn-sm">🔎</button></form>
      <div id="shpAdmFound"></div></div>
    <div class="shp-adm-sec"><b>Kaspi — ждут проверки (${data.kaspi.length})</b>
      ${data.kaspi.map(o => row(o, `<button class="dc-ok" onclick="shopAdminPaid('${esc(o.id)}', this)">✓ Оплачено</button>`)).join('') || '<p class="shp-small">Нет.</p>'}
      <p class="shp-small">Увидел в Kaspi Pay оплату ровно на эту сумму примерно в это время (или с номером заказа в комментарии) — жми «Оплачено». Сомневаешься — спроси покупателя.</p></div>
    <div class="shp-adm-sec"><b>Проблемные платежи (${data.problems.length})</b>
      ${data.problems.map(p => row({ ...p, id: p.order_id || p.payment_id }, `<small>${p.status === 'mismatch' ? 'сумма/валюта не сошлись' : 'нет заказа'}</small>`)).join('') || '<p class="shp-small">Нет.</p>'}
      <p class="shp-small">Деньги пришли, но не совпали с заказом — проверь в кабинете провайдера и начисли вручную или верни деньги.</p></div>
    <div class="shp-adm-sec"><b>Последние оплаты</b>
      ${data.recent.map(o => row(o, o.status === 'paid' ? `<button class="dc-no" onclick="shopAdminRefund('${esc(o.id)}', this)">↩ Вернул деньги</button>` : '')).join('') || '<p class="shp-small">Пока нет.</p>'}</div>
    <div class="shp-adm-sec"><b>💛 Что даёт донат DonationAlerts</b>
      <form class="shp-adm-set" onsubmit="shopAdminDonate(event)">
        ${[['off', 'статус «💛 Донатер» на 30 дней — без VIP и 💎 (пока не оформлен статус и платёжка)'], ['vip', 'как раньше: VIP за донат (100 ₽ = месяц) или 💎 — кто что выбрал'], ['gems', 'все донаты → 💎 (1 ₽ = курс ниже)']]
          .map(([v, t]) => `<label><input type="radio" name="dr" value="${v}" ${(S0.donate_rewards || 'off') === v ? 'checked' : ''}> ${t}</label>`).join('')}
        <button class="pf-btn pf-btn-gold pf-btn-sm">Сохранить</button>
      </form>
      <p class="shp-small">При «VIP» и «💎» донат становится покупкой (встречная выдача) — включать после решения с юристом и бухгалтером. На «статус» остатки к VIP-месяцу сразу станут днями VIP.</p></div>
    <div class="shp-adm-sec"><b>🧾 Доход и налог</b><div id="shpIncome"><p class="shp-small">Загружаем…</p></div></div>
    <div class="shp-adm-sec"><b>Настройки</b>
      <form class="shp-adm-set" onsubmit="shopAdminSettings(event)">
        <label>${C.icon} за 1 ₽ доната<input name="donate_rate" type="number" min="0.01" max="100" step="0.01" value="${esc(s.donate_rate ?? 1)}"></label>
        <label><input name="donate_bonus" type="checkbox" ${s.donate_bonus !== false ? 'checked' : ''}> бонус за крупный донат (+10/20/30 %)</label>
        <label>Лимит покупок в сутки, ₽<input name="day_rub" type="number" min="0" step="100" value="${esc(s.day_rub ?? 3000)}"></label>
        <label>Лимит за 30 дней, ₽<input name="month_rub" type="number" min="0" step="100" value="${esc(s.month_rub ?? 10000)}"></label>
        <label><input name="shop_open" type="checkbox" ${s.shop_open !== false ? 'checked' : ''}> магазин открыт (тратить ${C.icon} можно)</label>
        <label>Ставка налога, % (уточни у бухгалтера; пусто — не указана)<input name="tax_pct" type="number" min="0" max="100" step="0.01" value="${s.tax_pct == null ? '' : esc(s.tax_pct)}" placeholder="не указана"></label>
        <label>Налоговый период<select name="tax_period">${[['', '— не выбран —'], ['month', 'месяц'], ['quarter', 'квартал'], ['half', 'полгода'], ['year', 'год']].map(([v, t]) => `<option value="${v}" ${(s.tax_period || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <button class="pf-btn pf-btn-gold pf-btn-sm">Сохранить</button>
      </form></div>`;
  shopIncome(0);
}

// ── 🧾 Доход и налог: оплаты Kaspi (и карт, если включат) за налоговый период — подтверждённые, возвраты, «чистыми», налог по ставке
// владельца (ориентир; ставку и режим уточняет бухгалтер), список платежей и CSV для бухгалтера. Донаты — отдельной строкой ──
let shopIncomeOff = 0, shopIncomeData = null, shopTaxPeriod = null;
const SHOP_PERIODS = { month: 1, quarter: 3, half: 6, year: 12 };
function shopIncomeRange(type, off){
  const n = SHOP_PERIODS[type] || 1, now = new Date();
  const startM = Math.floor(now.getMonth() / n) * n - off * n;
  const a = new Date(now.getFullYear(), startM, 1), b = new Date(now.getFullYear(), startM + n, 0);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(a), to: iso(b), title: n === 1 ? a.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) : `${a.toLocaleDateString('ru-RU')} — ${b.toLocaleDateString('ru-RU')}` };
}
async function shopIncome(delta){
  const box = document.getElementById('shpIncome');
  if (!box || !sbClient) return;
  shopIncomeOff = Math.max(0, delta === 0 ? 0 : shopIncomeOff + delta);
  const period = shopTaxPeriod || 'month';
  const R = shopIncomeRange(period, shopIncomeOff);
  const { data, error } = await sbClient.rpc('premium_admin_income', { p_from: R.from, p_to: R.to });
  if (error || !data?.ok) { box.innerHTML = `<p class="shp-small">${error && /PGRST202|Could not find/i.test(error.message || '') ? 'Появится после запуска premium.sql (22.10).' : 'Не загрузилось: ' + esc(error ? humanErr(error) : data?.reason || '')}</p>`; return; }
  shopIncomeData = data;
  const cur = Object.entries(data.totals || {});
  const pct = data.tax_pct;
  const totals = cur.length ? cur.map(([c, t]) => `<div class="shp-row"><span>${esc(c)}: оплат <b>${t.count}</b> на ${shopMoney(t.paid, c)}, возвратов ${shopMoney(t.refunds, c)} → <b>чистыми ${shopMoney(t.net, c)}</b>${+t.open ? ` · не разобрано ${shopMoney(t.open, c)}` : ''}</span>
      <span>${pct == null ? 'налог: укажи ставку ↓' : `к уплате ≈ <b>${shopMoney(t.tax, c)}</b> (${pct} %)`}</span></div>`).join('')
    : '<p class="shp-small">За этот период оплат не было.</p>';
  const rows = (data.rows || []).map(x => `<div class="shp-row"><span><small>${shopTime(x.at)}</small> ${esc(x.order_id || x.payment_id)} · ${esc(x.provider)} · ${esc({ credited: 'оплачено', extra: 'оплачено (лишний платёж)', refund: 'возврат', mismatch: 'сумма не сошлась', no_order: 'нет заказа' }[x.status] || x.status)}${x.test ? ' · тест' : ''}${x.nick ? ' · ' + esc(x.nick) : ''}</span><span>${x.status === 'refund' ? '−' : ''}${shopMoney(x.amount, x.currency)}</span></div>`).join('');
  box.innerHTML = `<div class="shp-adm-period"><button type="button" class="dc-no" onclick="shopIncome(1)">◀</button> <b>${esc(R.title)}</b>
      <button type="button" class="dc-no" onclick="shopIncome(-1)" ${shopIncomeOff ? '' : 'disabled'}>▶</button>
      <button type="button" class="dc-ok" onclick="shopIncomeCsv()">⬇ CSV для бухгалтера</button></div>
    ${totals}
    <div class="shp-row"><span>💝 Донаты DonationAlerts за период: ${+data.donations?.count || 0} на ${shopMoney(+data.donations?.rub || 0, 'RUB')}</span><span><small>как учитывать донаты — уточни у бухгалтера</small></span></div>
    ${rows ? `<details><summary class="shp-small">Платежи (${(data.rows || []).length})</summary>${rows}</details>` : ''}
    <p class="shp-small">Цены на сайте — окончательные (налоги включены). «К уплате» — ориентир по твоей ставке${data.tax_period ? '' : '; период — месяц, пока не выбран ниже'}: ставку, режим, чеки (фискализацию через Kaspi) и учёт донатов уточни у бухгалтера. Записи пишет только сервер: оплату Kaspi подтверждает админ («✓ Оплачено»), каждый платёж и возврат — отдельной строкой.</p>`;
}
function shopIncomeCsv(){
  const d = shopIncomeData;
  if (!d) return;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Дата', 'Заказ', 'Платёж', 'Провайдер', 'Сумма', 'Валюта', 'Статус', 'Тест', 'Ник'].map(q).join(';')]
    .concat((d.rows || []).map(x => [new Date(x.at).toLocaleString('ru-RU'), x.order_id, x.payment_id, x.provider, (x.status === 'refund' ? '-' : '') + x.amount, x.currency, x.status, x.test ? 'да' : '', x.nick || ''].map(q).join(';')));
  Object.entries(d.totals || {}).forEach(([c, t]) => lines.push(['Итого ' + c, '', '', '', t.net, c, `оплат ${t.count}: ${t.paid}, возвратов ${t.refunds}`, '', d.tax_pct == null ? 'ставка не указана' : `налог ${d.tax_pct}% ≈ ${t.tax}`].map(q).join(';')));
  lines.push(['Донаты DonationAlerts', '', '', '', +d.donations?.rub || 0, 'RUB', `${+d.donations?.count || 0} шт.`, '', 'как учитывать — уточни у бухгалтера'].map(q).join(';'));
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `dohod-${d.from}-${d.to}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function shopAdminDonate(e){
  e.preventDefault();
  const v = e.target.elements.dr?.value;
  if (!v) return;
  if (v !== 'off' && !confirm('Донат станет давать VIP/💎 — это уже «покупка», а не просто поддержка. Включать после решения с юристом и бухгалтером. Включить?')) return;
  const { data, error } = await sbClient.rpc('donor_admin_set', { p_key: 'donate_rewards', p_value: v });
  if (error || !data?.ok) { alert('Не получилось: ' + (error ? humanErr(error) : data?.reason)); return; }
  shopToast(v === 'off' ? `Донаты → статус «💛 Донатер»${data.converted ? ` (остатки к VIP-месяцу: ${data.converted} чел. → дни VIP)` : ''}` : v === 'vip' ? 'Донаты → VIP (как раньше)' : 'Донаты → 💎');
  window.D37Donor?.sync();
  shopRender(await D37Gems.sync());
}
async function shopAdminFind(e){
  e.preventDefault();
  const out = document.getElementById('shpAdmFound'), q = e.target.elements.q.value.trim(), C = D37Gems.CFG;
  const { data, error } = await sbClient.rpc('premium_admin_find', { p_q: q });
  if (error) { out.textContent = humanErr(error); return; }
  out.innerHTML = (data || []).map(u => `<div class="shp-row"><span><b>${esc(u.nick)}</b> · ${C.icon} ${shopNum(u.balance)}${u.debt ? ' · долг ' + shopNum(u.debt) : ''} · донат → ${u.mode === 'gems' ? C.icon : 'VIP'} · поддержка ${shopNum(Math.round(u.total_donated))} ₽</span>
    <span><button class="dc-ok" onclick="shopAdminGrant('${u.user_id}', ${jsAttr(u.nick)})">± ${C.icon}</button> <button class="dc-no" onclick="shopAdminHistory('${u.user_id}', this)">История</button></span></div>`).join('') || '<p class="shp-small">Никого.</p>';
}
async function shopAdminGrant(uid, nick){
  const C = D37Gems.CFG;
  const amount = parseInt(prompt(`Сколько ${C.icon} начислить «${nick}»? (минус — списать)`, '100'), 10);
  if (!amount) return;
  const reason = (prompt('Причина (её увидит человек в истории):', amount > 0 ? 'Подарок от стримера' : 'Исправление ошибки') || '').trim();
  if (reason.length < 3) { alert('Нужна причина — хотя бы пару слов.'); return; }
  const { data, error } = await sbClient.rpc('premium_admin_grant', { p_user: uid, p_amount: amount, p_reason: reason });
  if (error || !data?.ok) { alert('Не получилось: ' + (error ? humanErr(error) : { gems: 'столько нет на балансе', amount: 'не та сумма', reason: 'нужна причина', user: 'нет такого' }[data?.reason] || data?.reason)); return; }
  shopToast(`Готово: баланс ${C.icon} ${shopNum(data.balance)}`);
}
async function shopAdminHistory(uid, btn){
  const { data, error } = await sbClient.rpc('premium_admin_history', { p_user: uid, p_limit: 50 });
  if (error) { alert(humanErr(error)); return; }
  const row = btn.closest('.shp-row'), C = D37Gems.CFG;
  row.insertAdjacentHTML('afterend', `<div class="shp-adm-hist">${(data || []).map(h => `<div class="shp-row"><span><small>${shopTime(h.created_at)}</small> ${esc(h.kind)} ${esc(h.note || h.ref || '')}${h.actor ? ' · вручную' : ''}</span><span>${h.amount > 0 ? '+' : ''}${shopNum(h.amount)} ${C.icon} → ${shopNum(h.balance)}</span></div>`).join('') || '<p class="shp-small">Пусто.</p>'}</div>`);
  btn.disabled = true;
}
async function shopAdminPaid(id, btn){
  const note = prompt('Отметка (необязательно): например, время оплаты в Kaspi', '') ?? null;
  if (note === null) return;
  btn.disabled = true;
  const { data, error } = await sbClient.rpc('premium_admin_mark_paid', { p_order: id, p_note: note });
  if (error || !['credited', 'extra'].includes(data?.status)) alert('Не получилось: ' + (error ? humanErr(error) : data?.status));
  shopAdminLoad();
}
async function shopAdminRefund(id, btn){
  if (!confirm('Деньги за этот заказ уже вернул покупателю (в кабинете провайдера или в Kaspi)? Кристаллы спишутся, а если их уже потратили — запишется долг.')) return;
  btn.disabled = true;
  const { data, error } = await sbClient.rpc('premium_admin_refund', { p_order: id });
  if (error || data?.status !== 'refunded') alert('Не получилось: ' + (error ? humanErr(error) : data?.status));
  else shopToast(`Списано ${data.taken} 💎${data.debt ? `, долг ${data.debt}` : ''}`);
  shopAdminLoad();
}
async function shopAdminSettings(e){
  e.preventDefault();
  const f = e.target.elements;
  const p = { donate_rate: parseFloat(f.donate_rate.value), donate_bonus: f.donate_bonus.checked, day_rub: parseInt(f.day_rub.value, 10),
    month_rub: parseInt(f.month_rub.value, 10), shop_open: f.shop_open.checked,
    tax_pct: f.tax_pct ? f.tax_pct.value.trim() : '', tax_period: f.tax_period ? f.tax_period.value : '' };
  const { error } = await sbClient.rpc('premium_admin_settings', { p });
  if (error) { alert('Не получилось: ' + humanErr(error)); return; }
  shopToast('Настройки сохранены');
  shopRender(await D37Gems.sync());
}
