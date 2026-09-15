// ═══════════════════════════════════════
//  ШКАЛА ЦЕЛИ — ОБНОВЛЯЙ ЭТИ ЦИФРЫ
// ═══════════════════════════════════════
let goalCurrentVal = 0;     // ← сколько собрано (считается само из /api/donations, руками не трогать)
let goalMaxVal     = 10000; // ← цель в рублях — теперь меняется через "⚙️ Настройки сайта", это лишь дефолт
let goalTitleText  = '🎯 Новое оборудование для стрима'; // ← тоже через настройки, это дефолт

function initGoalBar(currentVal){
  const cur = (currentVal !== undefined) ? currentVal : goalCurrentVal;
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
  const cfg = { title, target };
  applyGoalConfig(cfg);
  try { localStorage.setItem('d37_goal', JSON.stringify(cfg)); } catch(e) {}
  if (sbClient && currentRole === 'admin') {
    try {
      await sbClient.from('site_config').upsert([{ key: 'goal', value: JSON.stringify(cfg) }]);
      statusEl.textContent = '✅ Сохранено!';
    } catch(e) {
      statusEl.textContent = '⚠ Применено локально, но не сохранилось на сервер';
    }
  } else {
    statusEl.textContent = '✅ Применено (локально)';
  }
  setTimeout(()=>statusEl.textContent='', 3000);
}
