// ═══════════════════════════════════════
//  «ЗАДОНАТИЛ — НЕ ЗАСЧИТАЛОСЬ?» и проверка донатов админом (vip-claims.sql + premium.sql, 22.10.2026)
// ═══════════════════════════════════════
// Пользователь (свой профиль, блок «Логин для доната»): форма — имя из DonationAlerts, сумма, день → claim_donation(). Сервер
// сам привязывает, только если: один такой донат, меньше D37Donor.RULES.auto_max ₽, имя ≤ 2 опечатки от ТВОЕГО логина для
// доната, донат после регистрации и после того, как логин стал твоим; анонимные («Аноним», пустое имя) — никогда. Иначе — админу.
// Что даёт привязанный донат — по выключателю premium.sql: статус «💛 Донатер» (по умолчанию) или VIP / 💎 (как до 22.10).
// Админ (свой профиль, панель администратора): donor_admin_state() — заявки с доказательствами, донаты «ждут решения» (логин совпал,
// но донат раньше регистрации / логина), крупные непривязанные, уже привязанные подозрительные (никого не лишаем — «в порядке» или
// «не считать в статус»), ники и логины, занятые системой. Нет нового premium.sql — старый список admin_donation_claims().
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
      <summary>Задонатил — не засчиталось?</summary>
      <p class="dc-hint">Чаще всего — опечатка в имени на DonationAlerts. Укажи донат как он был — найдём и привяжем к тебе.
        Само привяжется небольшой донат с именем, похожим на твой логин для доната; остальное проверит админ. Анонимные донаты
        и донаты, сделанные до того, как ты задал логин, — только через админа.</p>
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

const CLAIM_FLAG = {
  big: 'крупный донат', ambiguous: 'похожих донатов несколько', not_similar: 'имя не похоже на твой логин для доната',
  nick_only: 'имя похоже только на ник (его меняют свободно)', before_reg: 'донат сделан раньше регистрации',
  before_login: 'донат сделан раньше, чем ты задал этот логин', race: 'донат только что привязали', reserved: 'анонимный донат',
  claim_big: 'крупный, привязан заявкой сам (по старым правилам)',
};

async function submitDonationClaim(e){
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button'), out = f.querySelector('.dc-result');
  // Поля — через f.elements: у формы есть своё свойство name, обращение f.name вернуло бы его, а не поле
  const el = f.elements, name = el.dcName.value.trim(), amount = parseFloat(String(el.dcAmount.value).replace(',', '.')), date = el.dcDate.value;
  if (!name || !(amount > 0) || !date) { out.className = 'dc-result err'; out.textContent = 'Заполни все три поля.'; return; }
  if (window.D37Donor?.reserved(name)) { out.className = 'dc-result err'; out.textContent = 'Анонимные донаты («Аноним», без имени) ни к кому не привязываются. В следующий раз впиши в поле «Ваше имя» свой логин для доната.'; return; }
  btn.disabled = true; out.className = 'dc-result'; out.textContent = 'Ищем…';
  const gems0 = window.D37Gems?.isOn() ? D37Gems.balance() : null;
  let data = null, error = null;
  try { ({ data, error } = await sbClient.rpc('claim_donation', { p_name: name, p_amount: amount, p_date: date })); }
  catch (err) { error = err; }
  btn.disabled = false;
  if (error || !data) { out.className = 'dc-result err'; out.textContent = 'Не получилось проверить — попробуй позже или напиши админу.'; return; }
  let gemsGot = +data.gems || 0;
  if (data.status === 'credited' && !data.months && !gemsGot && data.reward !== 'status' && gems0 !== null) gemsGot = Math.max(0, (await D37Gems.sync()).balance - gems0);
  const D = window.D37Donor;
  const got = data.reward === 'status'
    ? (data.level ? ` — статус «Донатер ${D ? D.roman(data.level) : data.level}»${data.until && D ? ' ' + D.untilText(data.until) : ''}` : ' — в счёт статуса «💛 Донатер»')
    : data.months ? ` — VIP на ${data.months} мес.` : gemsGot ? ` — +${gemsGot} 💎 на балансе` : ' — остаток копится до следующего месяца VIP';
  const why = Array.isArray(data.flags) && data.flags.length ? ' Почему не сразу: ' + data.flags.map(x => CLAIM_FLAG[x] || x).join(', ') + '.' : '';
  const MSG = {
    credited:  ['ok',   `✅ Нашли! ${amount} ₽ привязаны к тебе${got}. Спасибо за поддержку!`],
    review:    ['wait', `📨 Донат есть, но решает админ.${why} Ответ придёт в уведомления 🔔.`],
    already:   ['wait', '⏳ Заявка по этому донату уже на проверке у админа.'],
    reserved:  ['err',  'Анонимные донаты («Аноним», без имени) ни к кому не привязываются. В следующий раз впиши в поле «Ваше имя» свой логин для доната.'],
    not_found: ['err',  'Такой донат не нашёлся. Проверь сумму, день и имя — ровно как на DonationAlerts. Донаты подтягиваются раз в несколько минут: если донатил только что, подожди минут 10.'],
    limit:     ['err',  'Слишком много попыток за сутки — попробуй завтра или напиши админу в чат.'],
    invalid:   ['err',  'Проверь поля: день — не раньше полугода назад, сумма больше нуля.'],
    auth:      ['err',  'Сначала войди на сайт.'],
  };
  const [cls, text] = MSG[data.status] || ['err', 'Что-то пошло не так — напиши админу.'];
  out.className = 'dc-result ' + cls; out.textContent = text;
  if (data.status === 'credited') {
    if (typeof window.va === 'function') window.va('event', { name: 'donation_claim_auto' });
    window.D37Donor?.sync();
    // Обновить свой профиль (VIP, статус) и перерисовать страницу
    setTimeout(async () => {
      try { const { data: p } = await (await sbProfiles()).select('*').eq('id', currentUser.id).single(); if (p) currentProfile = p; } catch (err) {}
      renderProfilePage();
    }, 2500);
  }
}

// ── Админ: «💸 Донаты: проверка» ──
const DC_HOLD = { before_reg: 'донат раньше регистрации', before_login: 'донат раньше, чем логин стал его', no_profile: 'имя не совпало ни с чьим логином' };
const dcTime = d => d ? new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const dcUser = (id, nick) => id ? `<a href="#/profile/${esc(id)}">${esc(nick || 'user')}</a>` : '—';
const dcMsg = m => m ? `<span class="dc-msg">💬 «${esc(m)}»</span>` : '';

async function renderAdminDonationClaims(){
  const panel = document.getElementById('profileAdminPanel');
  if (!panel || !sbClient) return;
  let box = document.getElementById('adminClaims');
  const { data: S, error } = await sbClient.rpc('donor_admin_state');
  if (error) return renderAdminDonationClaimsOld(panel, box);   // premium.sql (22.10) ещё не применён — старый список
  if (!box) { box = document.createElement('div'); box.id = 'adminClaims'; box.className = 'dc-admin'; panel.appendChild(box); }
  const n = S.claims.length + S.held.length + S.suspicious.length;
  const sum = panel.querySelector('.pf-admin-hint');
  if (sum) sum.textContent = n ? `💸 донаты на проверке: ${n}` : 'инструменты сайта';
  const mode = { off: '💛 статус «Донатер» (без VIP и 💎)', vip: '✨ VIP за донат (как раньше)', gems: '💎 кристаллы за донат' }[S.mode] || S.mode;
  const claims = S.claims.map(c => `
    <div class="dc-claim" data-id="${c.id}">
      <div class="dc-claim-body">
        <b>${dcUser(c.user_id, c.nick)}</b> <small>логин: ${esc(c.donate_login || '—')}${c.login_at ? ' (с ' + dcTime(c.login_at) + ')' : ''} · на сайте с ${dcTime(c.reg_at)}</small>
        <span>Ввёл: «${esc(c.name_typed)}» · ${+c.amount} ₽ · ${esc(c.claim_date)}</span>
        ${c.donation_id ? `<span>В DonationAlerts: «${esc(c.donor_username || '?')}» · ${dcTime(c.donated_at)} ${dcMsg(c.message)}</span>` : `<span class="dc-warn">Похожих донатов несколько (${c.candidates}) — найди нужный в «📋 Лог донатов» и привяжи по номеру</span>`}
        ${(c.flags || []).length ? `<span class="dc-warn">⚠ ${c.flags.map(x => esc(CLAIM_FLAG[x] || x)).join(' · ')}</span>` : ''}
      </div>
      <div class="dc-claim-act">
        ${c.donation_id ? `<button class="dc-ok" onclick="resolveDonationClaim(${c.id}, 'approve', this)">✓ Привязать</button>`
          : `<button class="dc-ok" onclick="donorAdminAssignAsk('${esc(c.user_id)}', this, ${c.id})">✓ Привязать донат №…</button>`}
        <button class="dc-no" onclick="resolveDonationClaim(${c.id}, 'deny', this)">✕ Отклонить</button>
      </div>
    </div>`).join('');
  const held = S.held.map(h => `
    <div class="dc-claim">
      <div class="dc-claim-body">
        <b>«${esc(h.donor_username || '?')}» · ${+h.amount} ₽</b> <small>№${h.donation_id} · ${dcTime(h.at)}</small>
        <span class="dc-warn">${esc(DC_HOLD[h.hold] || h.hold)}${h.user_id ? ' — логин совпал у ' + dcUser(h.user_id, h.nick) : ''}</span>
        ${dcMsg(h.message)}
      </div>
      <div class="dc-claim-act">
        ${h.user_id ? `<button class="dc-ok" onclick="donorAdminAssign(${h.donation_id}, '${esc(h.user_id)}', this)">✓ Это он(а)</button>` : ''}
        <button class="dc-no" onclick="donorAdminAssignAsk(null, this, null, ${h.donation_id})">→ Другому…</button>
      </div>
    </div>`).join('');
  const sus = S.suspicious.map(x => `
    <div class="dc-claim">
      <div class="dc-claim-body">
        <b>«${esc(x.donor_username || '?')}» · ${+x.amount} ₽ → ${dcUser(x.user_id, x.nick)}</b> <small>№${x.donation_id} · ${dcTime(x.at)} · ${esc({ status: '💛 статус', vip: '✨ VIP', gems: '💎' }[x.reward] || 'старый')}${x.excluded ? ' · не в счёт статуса' : ''}</small>
        <span class="dc-warn">⚠ ${(x.flags || []).map(f => esc(CLAIM_FLAG[f] || DC_HOLD[f] || f)).join(' · ')}</span>
      </div>
      <div class="dc-claim-act">
        <button class="dc-ok" onclick="donorAdminChecked(${x.donation_id}, this)">✓ Всё в порядке</button>
        ${x.excluded ? `<button class="dc-no" onclick="donorAdminExclude(${x.donation_id}, false, this)">↩ Вернуть в статус</button>`
          : `<button class="dc-no" onclick="donorAdminExclude(${x.donation_id}, true, this)">✕ Не считать в статус</button>`}
      </div>
    </div>`).join('');
  const names = S.names.map(p => `<span>${dcUser(p.id, p.nick)}${p.donate_login ? ' · логин «' + esc(p.donate_login) + '»' : ''}</span>`).join(' · ');
  box.innerHTML = `<div class="pf-kicker" style="margin:.9rem 0 .5rem">💸 Донаты: проверка</div>
    <p class="dc-hint">Сейчас донат даёт: <b>${esc(mode)}</b> (переключатель — в магазине, «🛠 Админ»). Привязка сама — только небольшой донат
      (до ${+S.rules.auto_max} ₽) с именем, похожим на логин, сделанный после регистрации и логина. Анонимные — никогда. Уже выданное
      (VIP, 💎) здесь не отнимается: «не считать в статус» убирает донат только из статуса «Донатер».</p>
    ${S.claims.length ? `<div class="pf-kicker dc-sub">Заявки — ${S.claims.length}</div>${claims}` : '<div class="dc-admin-empty">Заявок нет</div>'}
    ${S.held.length ? `<div class="pf-kicker dc-sub">⏳ Ждут решения — ${S.held.length}</div>${held}` : ''}
    ${S.suspicious.length ? `<div class="pf-kicker dc-sub">🔍 Подозрительные привязки — ${S.suspicious.length}</div>${sus}` : ''}
    ${S.names.length ? `<div class="pf-kicker dc-sub">🚫 Ники и логины, занятые системой (старые — не меняли сами)</div><p class="dc-hint">${names}</p>` : ''}`;
}

// Старый список (vip-claims.sql), пока premium.sql (22.10) не применён
async function renderAdminDonationClaimsOld(panel, box){
  const { data, error } = await sbClient.rpc('admin_donation_claims');
  if (error) { box?.remove(); return; }                     // vip-claims.sql не выполнен
  if (!box) { box = document.createElement('div'); box.id = 'adminClaims'; box.className = 'dc-admin'; panel.appendChild(box); }
  const sum = panel.querySelector('.pf-admin-hint');
  if (sum) sum.textContent = data.length ? `💸 заявок по донатам: ${data.length}` : 'инструменты сайта';
  if (!data.length) { box.innerHTML = '<div class="dc-admin-empty">💸 Заявок по донатам нет</div>'; return; }
  box.innerHTML = `<div class="pf-kicker" style="margin:.9rem 0 .5rem">💸 Заявки по донатам — ${data.length}</div>` + data.map(c => `
    <div class="dc-claim" data-id="${c.id}">
      <div class="dc-claim-body">
        <b>${dcUser(c.user_id, c.nick)}</b> <small>логин: ${esc(c.donate_login || '—')}</small>
        <span>Ввёл: «${esc(c.name_typed)}» · ${+c.amount} ₽ · ${esc(c.claim_date)}</span>
        ${c.donation_id ? `<span>В DonationAlerts: «${esc(c.donor_username || '?')}» · ${dcTime(c.donated_at)}</span>`
          : `<span class="dc-warn">Похожих донатов несколько (${c.candidates}) — проверь в «📋 Лог донатов» и реши вручную</span>`}
      </div>
      <div class="dc-claim-act">
        ${c.donation_id ? `<button class="dc-ok" onclick="resolveDonationClaim(${c.id}, 'approve', this)">✓ Привязать</button>`
          : `<button class="dc-ok" onclick="resolveDonationClaim(${c.id}, 'manual', this)">✓ Решил вручную</button>`}
        <button class="dc-no" onclick="resolveDonationClaim(${c.id}, 'deny', this)">✕ Отклонить</button>
      </div>
    </div>`).join('');
}

const DC_ERR = { taken: 'этот донат уже привязан', reserved: 'анонимный донат ни к кому не привязывается', no_donation: 'такого доната нет',
  no_profile: 'такого человека нет', invalid: 'донат не в рублях', ambiguous: 'похожих донатов несколько — привяжи по номеру', gone: 'заявку уже решили' };
async function resolveDonationClaim(id, action, btn){
  if (action === 'deny' && !confirm('Отклонить заявку? Человеку придёт уведомление.')) return;
  btn.disabled = true;
  const { data, error } = action === 'manual'
    ? await sbClient.rpc('admin_close_claim_manual', { p_id: id })
    : await sbClient.rpc('admin_resolve_claim', { p_id: id, p_approve: action === 'approve' });
  if (error || !data) { alert('Не получилось: ' + (error?.message || 'нет ответа')); btn.disabled = false; return; }
  if (!['approved', 'denied', 'manual', 'gone'].includes(data.status)) alert('Не получилось: ' + (DC_ERR[data.status] || data.status));
  renderAdminDonationClaims();
}
async function donorAdminAssign(donation, userId, btn){
  if (!confirm('Привязать этот донат к человеку? Это решение админа: донат засчитается ему.')) return;
  btn.disabled = true;
  const { data, error } = await sbClient.rpc('donor_admin_assign', { p_donation: donation, p_user: userId });
  if (error || data?.status !== 'credited') alert('Не получилось: ' + (error ? humanErr(error) : DC_ERR[data?.status] || data?.status));
  renderAdminDonationClaims();
}
// Привязать донат по номеру (из «📋 Лог донатов») к человеку из заявки — или к другому по нику
async function donorAdminAssignAsk(userId, btn, claimId, donationId){
  let donation = donationId;
  if (!donation) {
    donation = parseInt(prompt('Номер доната из «📋 Лог донатов» (его видно в логе у строки):', '') || '', 10);
    if (!donation) return;
  }
  let uid = userId;
  if (!uid) {
    const nick = (prompt('Ник человека на сайте, к которому привязать донат:', '') || '').trim();
    if (!nick) return;
    const { data: found } = await sbClient.rpc('premium_admin_find', { p_q: nick });
    const exact = (found || []).filter(u => String(u.nick).toLowerCase() === nick.toLowerCase());
    if (exact.length !== 1) { alert(exact.length ? 'С таким ником несколько человек — открой профиль и привяжи из заявки.' : 'Такого ника нет.'); return; }
    uid = exact[0].user_id;
  }
  await donorAdminAssign(donation, uid, btn);
}
async function donorAdminExclude(donation, on, btn){
  if (on && !confirm('Не считать этот донат в статус «Донатер»? Уже выданное (VIP, 💎) не отнимается.')) return;
  btn.disabled = true;
  const { data, error } = await sbClient.rpc('donor_admin_exclude', { p_donation: donation, p_on: on });
  if (error || !data?.ok) alert('Не получилось: ' + (error ? humanErr(error) : data?.reason));
  renderAdminDonationClaims();
}
async function donorAdminChecked(donation, btn){
  btn.disabled = true;
  const { error } = await sbClient.rpc('donor_admin_checked', { p_donation: donation });
  if (error) alert('Не получилось: ' + humanErr(error));
  renderAdminDonationClaims();
}
