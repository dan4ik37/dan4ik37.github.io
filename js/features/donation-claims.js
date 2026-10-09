// ═══════════════════════════════════════
//  «ЗАДОНАТИЛ, А VIP НЕ ПРИШЁЛ?» — самостоятельная привязка доната (vip-claims.sql)
// ═══════════════════════════════════════
// Пользователь (свой профиль, блок «Логин для доната»): форма — имя из DonationAlerts, сумма, день →
// claim_donation(). Сервер сам решает: похоже на свой логин/ник (≤ 2 опечатки) — VIP сразу, иначе — заявка админу.
// Админ (свой профиль, панель администратора): список заявок admin_donation_claims() — одобрить / отклонить /
// «выдал вручную» (если похожих донатов несколько). Пока vip-claims.sql не выполнен — ничего не показываем.
let claimsAvailable = null;   // null — не проверяли; проверка — пробный вызов с пустыми полями (status: invalid)

async function claimsCheck(){
  if (claimsAvailable !== null || !sbClient || !currentUser) return claimsAvailable;
  try {
    const { data, error } = await sbClient.rpc('claim_donation', { p_name: '', p_amount: 0, p_date: null });
    claimsAvailable = !error && !!data?.status;
  } catch (e) { claimsAvailable = false; }
  return claimsAvailable;
}

// ── Пользователь ──
async function renderDonationClaimBox(){
  const panel = document.getElementById('donateLoginPanel');
  if (!panel) return;
  panel.querySelector('.dc-box')?.remove();
  if (!(await claimsCheck())) return;
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);   // по МСК, как у DonationAlerts на сайте
  panel.insertAdjacentHTML('beforeend', `<details class="dc-box">
      <summary>Задонатил, а VIP не пришёл?</summary>
      <p class="dc-hint">Чаще всего — опечатка в имени на DonationAlerts. Укажи донат как он был — найдём и привяжем к тебе.
        Если имя совсем не похоже на твой логин или ник, заявку проверит админ.</p>
      <form class="dc-form" onsubmit="submitDonationClaim(event)">
        <label>Имя, которое писал в DonationAlerts<input name="dcName" maxlength="64" required autocomplete="off" placeholder="как в поле «Ваше имя»"></label>
        <div class="dc-row">
          <label>Сумма, ₽<input name="dcAmount" type="number" inputmode="decimal" min="1" step="0.01" required placeholder="100"></label>
          <label>День доната<input name="dcDate" type="date" required value="${today}" max="${today}"></label>
        </div>
        <button type="submit" class="pf-btn pf-btn-gold pf-btn-sm">🔎 Найти мой донат</button>
        <div class="dc-result" role="status"></div>
      </form>
    </details>`);
}

async function submitDonationClaim(e){
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button'), out = f.querySelector('.dc-result');
  // Поля — через f.elements: у формы есть своё свойство name, обращение f.name вернуло бы его, а не поле
  const el = f.elements, name = el.dcName.value.trim(), amount = parseFloat(String(el.dcAmount.value).replace(',', '.')), date = el.dcDate.value;
  if (!name || !(amount > 0) || !date) { out.className = 'dc-result err'; out.textContent = 'Заполни все три поля.'; return; }
  btn.disabled = true; out.className = 'dc-result'; out.textContent = 'Ищем…';
  let data = null, error = null;
  try { ({ data, error } = await sbClient.rpc('claim_donation', { p_name: name, p_amount: amount, p_date: date })); }
  catch (err) { error = err; }
  btn.disabled = false;
  if (error || !data) { out.className = 'dc-result err'; out.textContent = 'Не получилось проверить — попробуй позже или напиши админу.'; return; }
  const MSG = {
    credited:  ['ok',   `✅ Нашли! ${amount} ₽ привязаны к тебе${data.months ? ` — VIP на ${data.months} мес.` : ' — остаток копится до следующего месяца VIP'}. Спасибо за поддержку!`],
    review:    ['wait', '📨 Донат есть, но имя в нём не похоже на твой логин — отправили админу на проверку. Решение придёт в уведомления 🔔.'],
    already:   ['wait', '⏳ Заявка по этому донату уже на проверке у админа.'],
    not_found: ['err',  'Такой донат не нашёлся. Проверь сумму, день и имя — ровно как на DonationAlerts. Донаты подтягиваются раз в несколько минут: если донатил только что, подожди минут 10.'],
    limit:     ['err',  'Слишком много попыток за сутки — попробуй завтра или напиши админу в чат.'],
    invalid:   ['err',  'Проверь поля: день — не раньше полугода назад, сумма больше нуля.'],
    auth:      ['err',  'Сначала войди на сайт.'],
  };
  const [cls, text] = MSG[data.status] || ['err', 'Что-то пошло не так — напиши админу.'];
  out.className = 'dc-result ' + cls; out.textContent = text;
  if (data.status === 'credited') {
    if (typeof window.va === 'function') window.va('event', { name: 'donation_claim_auto' });
    // Обновить свой профиль (VIP, сумма донатов) и перерисовать страницу
    setTimeout(async () => {
      try { const { data: p } = await (await sbProfiles()).select('*').eq('id', currentUser.id).single(); if (p) currentProfile = p; } catch (err) {}
      renderProfilePage();
    }, 2500);
  }
}

// ── Админ ──
async function renderAdminDonationClaims(){
  const panel = document.getElementById('profileAdminPanel');
  if (!panel || !sbClient) return;
  let box = document.getElementById('adminClaims');
  const { data, error } = await sbClient.rpc('admin_donation_claims');
  if (error) { box?.remove(); return; }                     // vip-claims.sql не выполнен
  if (!box) { box = document.createElement('div'); box.id = 'adminClaims'; box.className = 'dc-admin'; panel.appendChild(box); }
  const sum = panel.querySelector('.pf-admin-hint');
  if (sum) sum.textContent = data.length ? `💸 заявок по донатам: ${data.length}` : 'инструменты сайта';
  if (!data.length) { box.innerHTML = '<div class="dc-admin-empty">💸 Заявок по донатам нет</div>'; return; }
  const fmtD = d => d ? new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  box.innerHTML = `<div class="pf-kicker" style="margin:.9rem 0 .5rem">💸 Заявки «VIP не пришёл» — ${data.length}</div>` + data.map(c => `
    <div class="dc-claim" data-id="${c.id}">
      <div class="dc-claim-body">
        <b><a href="#/profile/${esc(c.user_id)}">${esc(c.nick || 'user')}</a></b> <small>логин: ${esc(c.donate_login || '—')}</small>
        <span>Ввёл: «${esc(c.name_typed)}» · ${+c.amount} ₽ · ${esc(c.claim_date)}</span>
        ${c.donation_id ? `<span>В DonationAlerts: «${esc(c.donor_username || '?')}» · ${fmtD(c.donated_at)}</span>`
          : `<span class="dc-warn">Похожих донатов несколько (${c.candidates}) — проверь в «📋 Лог донатов/VIP» и выдай VIP вручную</span>`}
      </div>
      <div class="dc-claim-act">
        ${c.donation_id ? `<button class="dc-ok" onclick="resolveDonationClaim(${c.id}, 'approve', this)">✓ Привязать</button>`
          : `<button class="dc-ok" onclick="resolveDonationClaim(${c.id}, 'manual', this)">✓ Выдал вручную</button>`}
        <button class="dc-no" onclick="resolveDonationClaim(${c.id}, 'deny', this)">✕ Отклонить</button>
      </div>
    </div>`).join('');
}

async function resolveDonationClaim(id, action, btn){
  if (action === 'deny' && !confirm('Отклонить заявку? Человеку придёт уведомление.')) return;
  btn.disabled = true;
  const { data, error } = action === 'manual'
    ? await sbClient.rpc('admin_close_claim_manual', { p_id: id })
    : await sbClient.rpc('admin_resolve_claim', { p_id: id, p_approve: action === 'approve' });
  if (error || !data) { alert('Не получилось: ' + (error?.message || 'нет ответа')); btn.disabled = false; return; }
  if (data.status === 'ambiguous') alert('Похожих донатов несколько — выдай VIP вручную и нажми «Выдал вручную».');
  else if (!['approved', 'denied', 'manual', 'gone'].includes(data.status)) alert('Не получилось: ' + data.status);
  renderAdminDonationClaims();
}
