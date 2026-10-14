// ═══════════════════════════════════════
//  💎 МАГАЗИН (#/shop) — кристаллы: купить, потратить, история; донат DonationAlerts; админ
// ═══════════════════════════════════════
// Данные и вызовы — js/core/premium.js (D37Gems), начисляет только сервер (premium.sql, api/pay.js).
// Два пути купить — честно и по-простому: карта Казахстана / Kaspi (TipTop Pay, Freedom Pay — когда владелец
// подключит) и из России — донатом DonationAlerts (российские карты казахстанские платёжки не принимают).
// Без premium.sql — витрина и «скоро», донат даёт VIP как раньше. Без лутбоксов и случайных наград.
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

  // ── Шапка: что это и сколько у меня ──
  const head = `<div class="shp-head pf-card pf-card-gold">
    <div class="shp-gem" aria-hidden="true">${C.icon}</div>
    <div class="shp-head-body">
      <h3>${C.name} — валюта сайта</h3>
      <p>На ${C.name.toLowerCase()} покупают VIP (себе или в подарок другу), монеты 🪙 и вещи для персонажа. Кристаллы бывают только за реальные деньги — картой или донатом — и поддерживают стримы Денчика37. Обратно в деньги они не меняются.</p>
      ${!on ? `<div class="shp-note">⏳ Магазин кристаллов скоро откроется. А VIP за донат работает уже сейчас — <a href="#/shop/donate" onclick="event.preventDefault();document.getElementById('shp-donate').scrollIntoView({behavior:'smooth'})">как получить ↓</a></div>` : ''}
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
  const card = `<section class="shp-way pf-card pf-card-tw" id="shp-buy">
    <div class="shp-way-top"><span class="shp-flag" aria-hidden="true">💳</span><div><h4>Карта Казахстана или Kaspi</h4>
      <p>Visa и Mastercard банков Казахстана, Apple Pay и Google Pay${methods.some(m => m.id === 'kaspi') ? ', Kaspi' : ''}. Кристаллы приходят сразу после оплаты.</p></div></div>
    <div class="shp-packs">${packCards}</div>
    ${methods.length ? `<div class="shp-small">Способы: ${methods.map(m => esc(m.title)).join(' · ')}. Карты российских банков здесь не пройдут — для России ниже донат.</div>`
      : `<div class="shp-soon">🔜 Оплата картой появится скоро. ${on ? "Пока кристаллы можно получить донатом — выбери ниже «донат → кристаллы»" : "А VIP уже сейчас можно получить донатом"} ↓</div>`}
  </section>`;

  // ── Из России — донатом DonationAlerts ──
  const rate = S.rate || 1, bonusOn = S.bonus !== false;
  const donTable = [100, 500, 1000, 2000].map(r => `<span>${shopNum(r)} ₽ → <b>${C.icon} ${shopNum(shopDonGems(r, rate, bonusOn))}</b></span>`).join('');
  const mode = S.mode || 'vip';
  const modeBox = ok ? `<div class="shp-mode" role="radiogroup" aria-label="Что даёт донат">
      <button type="button" role="radio" aria-checked="${mode === 'vip'}" class="${mode === 'vip' ? 'on' : ''}" onclick="shopSetMode('vip')"><b>✨ VIP сразу</b><small>100 ₽ = месяц VIP, остаток копится — как раньше</small></button>
      <button type="button" role="radio" aria-checked="${mode === 'gems'}" class="${mode === 'gems' ? 'on' : ''}" onclick="shopSetMode('gems')"><b>${C.icon} Кристаллы</b><small>1 ₽ = ${shopNum(rate)} ${C.icon}${bonusOn ? ', крупный донат — с бонусом' : ''}; тратишь как хочешь</small></button>
    </div>` : '';
  const donate = `<section class="shp-way pf-card pf-card-accent" id="shp-donate">
    <div class="shp-way-top"><span class="shp-flag" aria-hidden="true">💝</span><div><h4>Из России и других стран — донатом</h4>
      <p>Российские карты казахстанские платёжные системы не принимают, поэтому для России — донат на DonationAlerts (карта, СБП и другие способы). ${ok ? 'Донат сам превратится в VIP или кристаллы — как выберешь ниже.' : 'Донат сам включает VIP: 100 ₽ = месяц, остаток копится.'}</p></div></div>
    ${ok ? `<div class="shp-don-table">${donTable}</div>` : ''}
    ${modeBox}
    <ol class="shp-steps">
      <li>${login ? `Твой логин для доната: <b class="shp-login">${esc(login)}</b> <button type="button" class="dl-copy" onclick="copyDonateLogin(this)">📋 Скопировать</button>`
        : authed ? `Придумай <b>логин для доната</b> в профиле — один раз. <a class="dl-copy" href="#/profile/vip">🔑 Задать логин</a>`
        : `<a href="#" onclick="shopLogin();return false">Войди или зарегистрируйся</a> и задай в профиле <b>логин для доната</b>.`}</li>
      <li>На DonationAlerts в поле «Ваше имя» вставь <b>этот логин</b> (не ник!). Сумма — любая.</li>
      <li>Через пару минут ${ok && mode === 'gems' ? 'кристаллы появятся на балансе' : 'VIP включится сам'} — обнови страницу. Не пришло? В профиле есть «Задонатил, а VIP или 💎 не пришли?».</li>
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
      <p class="shp-small">Месяцы VIP — те же, что за донат: цветной ник, GIF-аватарка, стикеры, закреп в чате. Уровень (VIP · Silver · Gold) растёт с суммой поддержки за всё время — донаты и покупки кристаллов: Silver — от 500 ₽, Gold — от 1500 ₽. <a href="/vip">Что даёт VIP</a></p>
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
  </section>`;

  // ── История ──
  const KIND = { pay: 'Покупка', donation: 'Донат', convert: 'Остаток доната', grant: 'Подарок от сайта', revoke: 'Списание', spend: 'Покупка в магазине', gift: 'Подарок другу', refund: 'Возврат денег', debt: 'Погашение долга' };
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
      <li>Каждая покупка картой — только с отметкой «плачу я (мне есть 18) или взрослый, который разрешил». Детям — пожалуйста, спросите родителей.</li>
      <li>Лимиты на покупки картой: до ${shopNum(S.limits?.day_rub ?? 3000)} ₽ в сутки и ${shopNum(S.limits?.month_rub ?? 10000)} ₽ за 30 дней — защита от случайных трат.</li>
      <li>Никаких лутбоксов, «сундуков» и случайных наград — всегда видно, что получаешь и сколько это стоит.</li>
      <li>Ошибся или купил без спроса — напишите нам: неистраченные кристаллы вернём деньгами. <a href="/refund">Политика возврата</a></li>
    </ul>
    <div class="shp-legal"><a href="/terms">Пользовательское соглашение</a> · <a href="/refund">Возврат</a> · <a href="/contacts">Реквизиты и контакты</a> · <a href="/privacy">Конфиденциальность</a></div>
  </section>`;

  const admin = currentRole === 'admin' ? `<section class="shp-block pf-card pf-card-danger" id="shpAdmin"><div class="shp-block-head"><b>🛠 Админ: кристаллы</b><span>видно только тебе</span></div><div id="shpAdminBody">${on ? 'Загружаем…' : 'premium.sql ещё не выполнен — инструменты появятся после него.'}</div></section>` : '';

  root.innerHTML = head + `<div class="shp-ways">${card}${donate}</div>` + spend + hist + parents + admin;
  if (currentRole === 'admin' && on) shopAdminLoad();
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
  const cur = shopMethods.currency || 'KZT', price = cur === 'RUB' ? p.rub : p.kzt;
  shopModal(`<h4>${C.icon} ${shopNum(p.gems)} ${G.word(p.gems)} за ${shopMoney(price, cur)}</h4>
    <div class="shp-methods" role="radiogroup" aria-label="Способ оплаты">${methods.map((m, i) => `<label class="shp-method"><input type="radio" name="shpMethod" value="${esc(m.id)}" ${i ? '' : 'checked'}>
      <span><b>${esc(m.title)}</b><small>${esc(m.note || '')}</small></span></label>`).join('')}</div>
    <label class="shp-consent"><input type="checkbox" id="shpConsent"> <span>Мне есть 18 лет, или эту покупку оплачивает взрослый (родитель) — или он разрешил её.</span></label>
    <p class="shp-small">Кристаллы — цифровая валюта сайта, они придут на аккаунт <b>${esc(currentProfile?.nick || '')}</b> сразу после оплаты. Неистраченные кристаллы можно вернуть — <a href="/refund" target="_blank">политика возврата</a>. Покупая, соглашаешься с <a href="/terms" target="_blank">правилами</a>.</p>
    <div class="shp-modal-err" role="alert"></div>
    <div class="shp-modal-act"><button type="button" class="pf-btn pf-btn-ghost" onclick="shopModalClose()">Отмена</button>
      <button type="button" class="pf-btn pf-btn-gold" id="shpPayBtn" onclick="shopPay('${p.id}')">Перейти к оплате</button></div>`);
}

const SHOP_ERR = {
  consent: 'Отметь галочку: покупку делает взрослый или с его разрешения.',
  limit_day: 'Лимит покупок на сегодня исчерпан — это защита от случайных трат. Попробуй завтра.',
  limit_month: 'Лимит покупок за 30 дней исчерпан — это защита от случайных трат.',
  too_many: 'Слишком много неоплаченных заказов — попробуй через час.',
  auth: 'Сначала войди на сайт.', off: 'Оплата пока не подключена — скоро.', method: 'Этот способ оплаты сейчас недоступен.',
  provider: 'Платёжная система не ответила — попробуй ещё раз или другой способ.', network: 'Нет связи — проверь интернет.',
};
async function shopPay(packId){
  if (shopBusy) return;
  const box = document.querySelector('.shp-modal'), err = box?.querySelector('.shp-modal-err');
  const method = box?.querySelector('input[name="shpMethod"]:checked')?.value;
  if (!document.getElementById('shpConsent')?.checked) { err.textContent = SHOP_ERR.consent; return; }
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
      <li>В комментарии к оплате напиши номер заказа: <b class="shp-login">${esc(res.order)}</b> <button type="button" class="dl-copy" onclick="shopCopy('${esc(res.order)}', this)">📋 Скопировать</button></li>
      <li>${C.icon} ${shopNum(res.gems)} придут после проверки оплаты — обычно в течение дня. Заказ виден в «Истории».</li>
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
  if (!currentUser) { shopToast('Войди, чтобы увидеть кристаллы'); return; }
  shopWaitPaid(orderId, 0);
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
  const s = data.settings || {}, C = D37Gems.CFG;
  const row = (o, act) => `<div class="shp-row"><span><b>${esc(o.nick || '?')}</b> · ${esc(o.id || o.order_id || '')}${o.gems ? ` · ${C.icon} ${shopNum(o.gems)}` : ''} · ${shopMoney(o.amount, o.currency)}${o.provider ? ' · ' + esc(o.provider) : ''}${o.status && o.status !== 'paid' ? ' · ' + esc(o.status) : ''}${o.test ? ' · тест' : ''} <small>${shopTime(o.created_at || o.paid_at)}</small></span>${act || ''}</div>`;
  body.innerHTML = `
    <div class="shp-adm-sec"><b>Найти человека</b>
      <form class="shp-gift" onsubmit="shopAdminFind(event)"><input name="q" placeholder="ник или его часть" required><button class="pf-btn pf-btn-ghost pf-btn-sm">🔎</button></form>
      <div id="shpAdmFound"></div></div>
    <div class="shp-adm-sec"><b>Kaspi — ждут проверки (${data.kaspi.length})</b>
      ${data.kaspi.map(o => row(o, `<button class="dc-ok" onclick="shopAdminPaid('${esc(o.id)}', this)">✓ Оплачено</button>`)).join('') || '<p class="shp-small">Нет.</p>'}
      <p class="shp-small">Увидел оплату в Kaspi Pay с этим номером заказа в комментарии и на эту сумму — жми «Оплачено».</p></div>
    <div class="shp-adm-sec"><b>Проблемные платежи (${data.problems.length})</b>
      ${data.problems.map(p => row({ ...p, id: p.order_id || p.payment_id }, `<small>${p.status === 'mismatch' ? 'сумма/валюта не сошлись' : 'нет заказа'}</small>`)).join('') || '<p class="shp-small">Нет.</p>'}
      <p class="shp-small">Деньги пришли, но не совпали с заказом — проверь в кабинете провайдера и начисли вручную или верни деньги.</p></div>
    <div class="shp-adm-sec"><b>Последние оплаты</b>
      ${data.recent.map(o => row(o, o.status === 'paid' ? `<button class="dc-no" onclick="shopAdminRefund('${esc(o.id)}', this)">↩ Вернул деньги</button>` : '')).join('') || '<p class="shp-small">Пока нет.</p>'}</div>
    <div class="shp-adm-sec"><b>Настройки</b>
      <form class="shp-adm-set" onsubmit="shopAdminSettings(event)">
        <label>${C.icon} за 1 ₽ доната<input name="donate_rate" type="number" min="0.01" max="100" step="0.01" value="${esc(s.donate_rate ?? 1)}"></label>
        <label><input name="donate_bonus" type="checkbox" ${s.donate_bonus !== false ? 'checked' : ''}> бонус за крупный донат (+10/20/30 %)</label>
        <label>Лимит покупок в сутки, ₽<input name="day_rub" type="number" min="0" step="100" value="${esc(s.day_rub ?? 3000)}"></label>
        <label>Лимит за 30 дней, ₽<input name="month_rub" type="number" min="0" step="100" value="${esc(s.month_rub ?? 10000)}"></label>
        <label><input name="shop_open" type="checkbox" ${s.shop_open !== false ? 'checked' : ''}> магазин открыт (тратить ${C.icon} можно)</label>
        <button class="pf-btn pf-btn-gold pf-btn-sm">Сохранить</button>
      </form></div>`;
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
    month_rub: parseInt(f.month_rub.value, 10), shop_open: f.shop_open.checked };
  const { error } = await sbClient.rpc('premium_admin_settings', { p });
  if (error) { alert('Не получилось: ' + humanErr(error)); return; }
  shopToast('Настройки сохранены');
  shopRender(await D37Gems.sync());
}
