// ═══════════════════════════════════════
//  LEADERBOARD — DonationAlerts API
// ═══════════════════════════════════════
let lbTab = 'top';
const DA_AUTH_URL = `/api/donations`; // Vercel serverless

async function loadLeaderboard() {
  const el = document.getElementById('lbContent');
  el.innerHTML = `<div class="lb-loading"><div class="spinner"></div>Загрузка...</div>`;

  // "Топ чата" считается из Supabase (сообщения) и к DonationAlerts вообще
  // не относится. БАГ: раньше эта вкладка всё равно шла через тот же путь,
  // что "Топ донатов"/"Последние" — если DonationAlerts не авторизован или
  // API упало, вместо топа чата показывался логин-промпт DA или демо-донаты.
  // Обрываем здесь, до всякого fetch('/api/donations').
  if (lbTab === 'chat') {
    document.getElementById('lbAuthStatus').textContent = '';
    document.getElementById('lbAuthBtn').style.display = 'none';
    document.getElementById('lbRefreshBtn').style.display = 'inline-flex';
    el.innerHTML = renderChatTop();
    return;
  }

  // Таймаут: раньше зависший запрос оставлял «Загрузка...» навсегда
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch('/api/donations', { signal: ctl.signal });
    clearTimeout(timer);
    if (r.status === 401) {
      const d = await r.json();
      showLbLogin(d.auth_url);
      renderVipSyncStatus();
      return;
    }
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (typeof processRecentDonationsForVip === 'function') processRecentDonationsForVip(data.donations);
    // Данные с сервера (снимок api/vip-sync.js) видят все; свои «живые» — только владелец с сессией DA
    let status = '✅ Подключено';
    if (data.source === 'server' && data.updated_at) {
      const t = new Date(data.updated_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      status = data.stale ? `⏳ Данные на ${t} — обновляются с задержкой` : `✅ Обновлено в ${t}`;
    }
    document.getElementById('lbAuthStatus').textContent = status;
    renderVipSyncStatus();
    document.getElementById('lbRefreshBtn').style.display = 'inline-flex';
    document.getElementById('lbAuthBtn').style.display = 'none';
    renderLb(data, lbTab);
  } catch(e) {
    clearTimeout(timer);
    // БАГ: тут раньше был renderLbDemo() — показывал ВЫДУМАННЫХ донатеров
    // (SuperFan, GamerPro...) на любую ошибку API, не только когда не
    // авторизован. С маленькой жёлтой подписью "демо" — легко принять за
    // настоящих донатеров. Теперь честная ошибка вместо выдумки.
    renderLbError();
  }
}

function showLbLogin(authUrl) {
  const el = document.getElementById('lbContent');
  const btn = document.getElementById('lbAuthBtn');
  btn.style.display = 'inline-flex';
  btn.onclick = () => window.location.href = authUrl || `/api/donations`;
  document.getElementById('lbAuthStatus').textContent = 'Не авторизован';
  el.innerHTML = `<div class="lb-login-msg">
    💝 Для отображения реального топа донатеров нужна авторизация через DonationAlerts.<br>
    <small style="opacity:.6">Только ты видишь свои данные — всё безопасно</small>
    <br><button class="lb-login-btn" onclick="lbLogin()">💝 Войти через DonationAlerts</button>
  </div>`;
}

async function lbLogin() {
  // БАГ: тут был жёстко зашитый client_id=19389 — а api/auth.js обменивает
  // код на токен под client_id из DA_CLIENT_ID (=19366, см. api/donations.js).
  // DonationAlerts выдаёт code под ОДНО приложение, обмен шёл под ДРУГОЕ —
  // это почти всегда падает как invalid_client. Теперь просто спрашиваем
  // актуальную ссылку у бэкенда (он — единственный источник правды про
  // client_id), а не собираем её тут по памяти.
  try {
    const r = await fetch('/api/donations');
    if (r.status === 401) {
      const d = await r.json();
      if (d.auth_url) { window.location.href = d.auth_url; return; }
    }
  } catch(e) {}
  document.getElementById('lbAuthStatus').textContent = '⚠ Не удалось получить ссылку авторизации';
}

function renderLbError() {
  document.getElementById('lbAuthStatus').textContent = '⚠ Ошибка';
  document.getElementById('lbAuthBtn').style.display = 'none';
  document.getElementById('lbRefreshBtn').style.display = 'inline-flex';
  document.getElementById('lbContent').innerHTML = `<div class="empty-state"><span class="empty-state-icon">⚠️</span><div class="empty-state-title">Не удалось загрузить донаты</div><div class="empty-state-text">Проблема с API DonationAlerts или сервером. Попробуй нажать «↻ Обновить» через минуту.</div></div>`;
}

function renderLb(data, tab) {
  document.getElementById('lbContent').innerHTML = renderLbHtml(data, tab);
}

function renderLbHtml(data, tab) {
  const colors = ['#ff2d55','#9147ff','#29b6f6','#22c55e','#f59e0b','#ec4899','#ff6b35'];
  if (tab === 'top') {
    if (!data.leaderboard?.length) return `<div class="empty-state"><span class="empty-state-icon">🏆</span><div class="empty-state-title">Донатов пока нет</div><div class="empty-state-text">Будь первым в списке — самый щедрый попадёт на самый верх 💝</div></div>`;
    return `<div class="lb-list">${data.leaderboard.map((d,i)=>{
      const ini=esc((d.username||'?').slice(0,2).toUpperCase());
      const col=colors[i%colors.length];
      const rank=i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}`;
      return `<div class="lb-item">
        <div class="lb-rank r${i+1}">${rank}</div>
        <div class="lb-avatar" style="background:${col}">${ini}</div>
        <div class="lb-info"><div class="lb-name">${esc(d.username)}</div><div class="lb-sub">${d.count} донат${d.count===1?'':'а'}</div></div>
        <div class="lb-amount">${Math.round(d.total).toLocaleString('ru')} ${d.currency}</div>
      </div>`;
    }).join('')}</div>`;
  } else if (tab === 'recent') {
    if (!data.donations?.length) return `<div class="empty-state"><span class="empty-state-icon">💌</span><div class="empty-state-title">Донатов пока нет</div><div class="empty-state-text">Последние донаты появятся здесь сразу после первого доната</div></div>`;
    return `<div class="lb-list">${data.donations.slice(0,10).map((d,i)=>{
      const ini=esc((d.username||'?').slice(0,2).toUpperCase());
      const col=colors[i%colors.length];
      const date=new Date(d.created).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
      return `<div class="lb-item">
        <div class="lb-avatar" style="background:${col}">${ini}</div>
        <div class="lb-info">
          <div class="lb-name">${esc(d.username||'Аноним')}</div>
          <div class="lb-sub">${d.message?esc(d.message.slice(0,40))+(d.message.length>40?'…':''):date}</div>
        </div>
        <div class="lb-amount">${Math.round(d.amount).toLocaleString('ru')} ${d.currency}</div>
      </div>`;
    }).join('')}</div>`;
  } else {
    return renderChatTop();
  }
}

function renderChatTop() {
  // Топ активных в чате — берём из Supabase
  if (!sbClient) return `<div class="lb-login-msg">Чат не подключён</div>`;
  // Берём последние 1000 сообщений: раньше тянулась ВСЯ история чата при каждом открытии
  // (а PostgREST всё равно отдавал максимум 1000 — «топ» считался по случайному куску)
  sbClient.from('messages').select('nick').eq('deleted',false).order('id',{ascending:false}).limit(1000).then(({data})=>{
    if (!data) return;
    const counts = {};
    data.forEach(m => { counts[m.nick] = (counts[m.nick]||0)+1; });
    const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const colors=['#ff2d55','#9147ff','#29b6f6','#22c55e','#f59e0b'];
    document.getElementById('lbContent').innerHTML = `<div class="lb-list">${top.map(([nick,cnt],i)=>{
      const ini=esc(nick.slice(0,2).toUpperCase());
      return `<div class="lb-item">
        <div class="lb-rank r${i+1}">${i+1}</div>
        <div class="lb-avatar" style="background:${colors[i%colors.length]}">${ini}</div>
        <div class="lb-info"><div class="lb-name">${esc(nick)}</div><div class="lb-sub">сообщений (из последних 1000)</div></div>
        <div class="lb-amount" style="color:var(--tw)">${cnt}</div>
      </div>`;
    }).join('')}</div>` || `<div class="lb-login-msg">Пока нет активности</div>`;
  });
  return `<div class="lb-loading"><div class="spinner"></div>Загрузка...</div>`;
}

function switchLbTab(tab, btn) {
  lbTab = tab;
  document.querySelectorAll('.lb-tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  loadLeaderboard();
}

// ─── Живая шкала цели из DA ───
async function loadGoalFromDA() {
  try {
    const r = await fetch('/api/donations');
    if (r.status !== 200) {
      // БАГ: раньше молча показывал 0 — от "донатов правда пока нет"
      // не отличить, что вообще-то сломан /api/donations (напр. 401/500).
      initGoalBar(0);
      document.getElementById('goalLiveBadge').innerHTML = `<span class="goal-live-badge" style="background:rgba(255,200,0,.1);color:rgba(255,200,0,.8);border-color:rgba(255,200,0,.2)">⚠ Нет связи с DonationAlerts (HTTP ${r.status})</span>`;
      return;
    }
    const data = await r.json();
    if (!data.donations?.length) { initGoalBar(0); return; }
    // Считаем общую сумму рублёвых донатов
    const total = data.donations
      .filter(d => d.currency === 'RUB')
      .reduce((s,d) => s + d.amount, 0);
    initGoalBar(Math.round(total));
    // Бейдж "живые данные"
    document.getElementById('goalLiveBadge').innerHTML = `<span class="goal-live-badge">🟢 Обновлено только что</span>`;
    // Последний донат
    const last = data.donations[0];
    if (last) {
      document.getElementById('goalLastDonText').textContent = `Последний: ${last.username} — ${Math.round(last.amount)} ${last.currency}${last.message?' · "'+last.message.slice(0,40)+'"':''}`;
      document.getElementById('goalLastDon').classList.add('show');
    }
  } catch(e) {
    initGoalBar(0);
    document.getElementById('goalLiveBadge').innerHTML = `<span class="goal-live-badge" style="background:rgba(255,200,0,.1);color:rgba(255,200,0,.8);border-color:rgba(255,200,0,.2)">⚠ Нет связи с DonationAlerts</span>`;
  }
}



// ═══════════════════════════════════════
//  Статус серверного начисления VIP — только админу
// ═══════════════════════════════════════
const VIP_SYNC_HELP = {
  no_stored_session: 'сервер ещё не получил доступ к DonationAlerts — войди через кнопку ниже',
  no_refresh_token:  'сервер потерял доступ к DonationAlerts — войди заново',
  da_unauthorized:   'DonationAlerts отклонил токен — войди заново',
  env_missing_da:    'в Vercel не заданы DA_CLIENT_ID / DA_CLIENT_SECRET',
  db_unavailable:    'база данных недоступна',
};
function timeAgoShort(iso){
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return min + ' мин назад';
  if (min < 1440) return Math.round(min / 60) + ' ч назад';
  return Math.round(min / 1440) + ' дн назад';
}
async function renderVipSyncStatus(){
  const box = document.getElementById('vipSyncStatus');
  if (!box) return;
  if (typeof currentRole === 'undefined' || currentRole !== 'admin' || !sbClient) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  let html = '';
  try {
    const { data: st, error } = await sbClient.from('vip_sync_state')
      .select('last_run_at,last_ok_at,last_error,last_error_at,last_credited,total_credited').eq('id', 1).maybeSingle();
    if (error) throw error;
    if (!st || !st.last_run_at) {
      html = '⚪ <b>Автоначисление VIP:</b> ещё не запускалось. Проверь переменные <code>SUPABASE_URL</code> и <code>SUPABASE_SERVICE_ROLE_KEY</code> в Vercel и войди через DonationAlerts.';
    } else if (st.last_error && (!st.last_ok_at || new Date(st.last_error_at) >= new Date(st.last_ok_at))) {
      const key = Object.keys(VIP_SYNC_HELP).find(k => st.last_error.includes(k)) || (/refresh_failed/.test(st.last_error) ? 'da_unauthorized' : null);
      html = `🔴 <b>Автоначисление VIP: сбой</b> (${timeAgoShort(st.last_error_at)}) — ${esc(key ? VIP_SYNC_HELP[key] : st.last_error)}` +
             (key && key !== 'env_missing_da' && key !== 'db_unavailable' ? ' <button class="lb-login-btn" onclick="lbLogin()" style="margin-left:.4rem">💝 Войти через DonationAlerts</button>' : '');
    } else {
      html = `🟢 <b>Автоначисление VIP работает</b> · последняя успешная проверка ${timeAgoShort(st.last_ok_at)} · начислено донатов за всё время: ${st.total_credited || 0}`;
    }
  } catch(e) {
    html = '⚪ <b>Автоначисление VIP:</b> таблицы ещё нет — выполни <code>server-hardening.sql</code> в Supabase.';
  }
  let last = null;
  try { last = sessionStorage.getItem('d37_da_sync_msg'); } catch(e) {}
  if (last) html += `<div style="margin-top:.3rem;opacity:.85">${esc(last)}</div>`;
  box.innerHTML = html;
}
