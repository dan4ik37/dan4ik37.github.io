// ═══════════════════════════════════════
//  ШКАЛА ЦЕЛИ — ОБНОВЛЯЙ ЭТИ ЦИФРЫ
// ═══════════════════════════════════════
let goalCurrentVal = 0;     // ← сколько собрано (считается само из /api/donations, руками не трогать)
let goalMaxVal     = 10000; // ← цель в рублях — теперь меняется через "⚙️ Настройки сайта", это лишь дефолт
let goalTitleText  = '🎯 Новое оборудование для стрима'; // ← тоже через настройки, это дефолт
let goalSinceISO   = null;  // ← "считать донаты с этой даты" — тоже через настройки; null = вся история

function initGoalBar(currentVal){
  const cur = (currentVal !== undefined) ? currentVal : goalCurrentVal;
  goalCurrentVal = cur; // раньше не присваивалась заново — переменная всегда была 0
  document.getElementById('goalTitle').textContent=goalTitleText;
  document.getElementById('goalCurrent').textContent=cur.toLocaleString('ru');
  document.getElementById('goalMax').textContent=goalMaxVal.toLocaleString('ru');
  const pct=Math.min(Math.round(cur/goalMaxVal*100),100);
  document.getElementById('goalPercent').textContent=pct+'%';
  const obs=new IntersectionObserver(entries=>{
    if(entries[0].isIntersecting){
      document.getElementById('goalFill').style.width=pct+'%';
      obs.disconnect();
    }
  },{threshold:0.3});
  const el=document.getElementById('goalbar');
  if(el)obs.observe(el);

  // FAB-кольцо доната — та же реальная цифра, без дублирования логики
  if(typeof updateDonateFab==='function') updateDonateFab(pct, cur);
  // Конфетти при первом достижении 100% именно ЭТОЙ цели (анти-спам)
  if(typeof checkGoalCelebration==='function') checkGoalCelebration(pct);
}
initGoalBar();

// ═══════════════════════════════════════
//  РЕДАКТОР ЦЕЛИ ДОНАТА (админка "⚙️ Настройки сайта")
//  Название и сумма цели — в site_config (key='goal'). Сколько уже собрано
//  трогать не нужно, это отдельно и всегда считается из /api/donations.
// ═══════════════════════════════════════
function applyGoalConfig(cfg){
  if (cfg?.title) goalTitleText = cfg.title;
  if (cfg?.target) goalMaxVal = cfg.target;
  if (cfg && 'since' in cfg) goalSinceISO = cfg.since || null;
  const curText = document.getElementById('goalCurrent')?.textContent || '0';
  const cur = parseInt(curText.replace(/\D/g,''), 10) || 0;
  initGoalBar(cur);
}

async function loadGoalConfigFromDB(){
  if (!sbClient) return;
  try {
    const { data } = await sbClient.from('site_config').select('value').eq('key','goal').maybeSingle();
    if (data?.value) {
      const cfg = JSON.parse(data.value);
      applyGoalConfig(cfg);
      try { localStorage.setItem('d37_goal', JSON.stringify(cfg)); } catch(e) {}
    }
  } catch(e) {}
}
// Мгновенно, без задержки — та же причина, что и с расписанием выше
try {
  const cachedGoal = localStorage.getItem('d37_goal');
  if (cachedGoal) applyGoalConfig(JSON.parse(cachedGoal));
} catch(e) {}

async function saveGoalAdmin(){
  const statusEl = document.getElementById('goalSaveStatus');
  const title = document.getElementById('goalAdminTitle').value.trim();
  const target = parseInt(document.getElementById('goalAdminTarget').value, 10);
  if (!title) { statusEl.textContent = '⚠ Введи название цели'; return; }
  if (!target || target <= 0) { statusEl.textContent = '⚠ Укажи сумму цели больше нуля'; return; }
  // Дата "считать донаты с" — <input type="date"> отдаёт "2026-09-22" или
  // пустую строку. Пустая = вся история (goal_progress сам подставит дефолт).
  const sinceRaw = document.getElementById('goalAdminSince')?.value || '';
  const since = sinceRaw ? new Date(sinceRaw + 'T00:00:00Z').toISOString() : null;
  const cfg = { title, target, since };
  applyGoalConfig(cfg);
  try { localStorage.setItem('d37_goal', JSON.stringify(cfg)); } catch(e) {}
  if (sbClient && currentRole === 'admin') {
    try {
      await sbClient.from('site_config').upsert([{ key: 'goal', value: JSON.stringify(cfg) }]);
      statusEl.textContent = '✅ Сохранено!';
      if (typeof loadGoalFromDA === 'function') loadGoalFromDA();   // пересчитать сумму по новой дате сразу
    } catch(e) {
      statusEl.textContent = '⚠ Применено локально, но не сохранилось на сервер';
    }
  } else {
    statusEl.textContent = '✅ Применено (локально)';
  }
  setTimeout(()=>statusEl.textContent='', 3000);
}

// Кнопка "Обнулить и начать заново" в редакторе цели — просто ставит сегодняшнюю
// дату в поле, не сохраняет сама (сохранение — по общей кнопке "Сохранить",
// чтобы случайный клик не обнулил прогресс без подтверждения)
function resetGoalSinceToToday(){
  const inp = document.getElementById('goalAdminSince');
  if (inp) inp.value = new Date().toISOString().slice(0, 10);
}

// ═══════════════════════════════════════
//  ПОЛНЫЙ РАЗОВЫЙ ИМПОРТ ВСЕЙ ИСТОРИИ ДОНАТОВ
// ═══════════════════════════════════════
// Обычная синхронизация (api/vip-sync.js) специально смотрит только на
// последние 14 дней — она лёгкая и гоняется каждые 5 минут. Если у канала
// донатов больше, чем помещается в её 8 страниц за эти 14 дней, часть
// истории она в принципе никогда не увидит. Эта кнопка — отдельный
// возобновляемый проход по ВСЕЙ истории (см. server-hardening.sql,
// api/vip-sync.js?backfill=1): дозванивается сама, пока сервер не ответит
// done:true, по одной "порции" за раз (обычно несколько страниц), чтобы
// не упереться в лимит времени serverless-функции (30 сек).
let backfillRunning = false;

async function runDonationBackfill(reset) {
  if (backfillRunning) return;
  const statusEl = document.getElementById('backfillStatus');
  const btn = document.getElementById('backfillBtn');
  if (currentRole !== 'admin' || !sbClient) { if (statusEl) statusEl.textContent = '⚠ Только для администратора'; return; }

  backfillRunning = true;
  if (btn) btn.disabled = true;
  const say = (t, color) => { if (statusEl) { statusEl.textContent = t; statusEl.style.color = color || ''; } };
  say('Готовим запрос...');

  try {
    const { data: { session } } = await sbClient.auth.getSession();
    if (!session?.access_token) throw new Error('Нет активной сессии — войди заново и попробуй ещё раз');

    let first = true;
    let totalPages = 0, totalImported = 0;
    for (let round = 0; round < 500; round++) {   // защитный потолок — не бесконечный цикл при неожиданном ответе
      const qs = 'backfill=1' + (first && reset ? '&reset=1' : '');
      first = false;
      const r = await fetch('/api/vip-sync?' + qs, { headers: { Authorization: 'Bearer ' + session.access_token } });
      const data = await r.json().catch(() => ({}));

      if (r.status === 401) { say('⚠ Доступ только для администратора (' + (data.reason || 'нет прав') + ')'); return; }
      if (!data.ok) { say('⚠ Ошибка: ' + (data.error || data.reason || 'неизвестная')); return; }

      if (data.busy) { say('Сервер занят обычной синхронизацией, ждём...'); await new Promise(res => setTimeout(res, 3000)); continue; }

      totalPages = data.pages ?? totalPages;
      totalImported = data.imported ?? totalImported;
      say(`Импортируем историю... страниц: ${totalPages}, донатов учтено: ${totalImported}`, 'var(--tw)');

      if (data.done) {
        say(`✅ Готово! Просмотрено страниц: ${totalPages}, донатов в истории: ${totalImported}. Шкала цели теперь точная.`, 'var(--tw)');
        if (typeof loadGoalFromDA === 'function') loadGoalFromDA();
        return;
      }
      // Небольшая пауза между "порциями" — вежливо к API DonationAlerts и не долбит сервер сплошным потоком
      await new Promise(res => setTimeout(res, 400));
    }
    say('⚠ Остановлено — слишком много шагов подряд. Нажми ещё раз, импорт продолжится с той же точки.');
  } catch (e) {
    say('⚠ ' + (e.message || 'Сеть недоступна'));
  } finally {
    backfillRunning = false;
    if (btn) btn.disabled = false;
  }
}
