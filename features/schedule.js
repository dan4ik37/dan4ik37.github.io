// ═══════════════════════════════════════
//  SCHEDULE highlight today
// ═══════════════════════════════════════
document.querySelectorAll('.day-card').forEach(c=>{if(+c.dataset.d===new Date().getDay())c.classList.add('today')});

// ═══════════════════════════════════════
//  COUNTDOWN ДО СЛЕДУЮЩЕГО ЭФИРА (на основе расписания выше)
//  Показывает ближайший будущий слот, а не "идёт ли стрим прямо сейчас" —
//  это отдельный вопрос, за него отвечает сам плеер Twitch.
// ═══════════════════════════════════════
function computeNextStream(){
  const schedule = [...document.querySelectorAll('.day-card')].map(c=>{
    const liveEl = c.querySelector('.day-live');
    if (!liveEl) return null;
    const [h,m] = liveEl.textContent.trim().split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return { day: +c.dataset.d, hour: h, minute: m };
  }).filter(Boolean);
  if (!schedule.length) return null;
  const now = new Date();
  for (let addDays = 0; addDays < 8; addDays++){
    const checkDay = (now.getDay() + addDays) % 7;
    const slot = schedule.find(s => s.day === checkDay);
    if (!slot) continue;
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + addDays);
    candidate.setHours(slot.hour, slot.minute, 0, 0);
    if (candidate > now) return candidate;
  }
  return null;
}
function updateStreamCountdown(){
  const el = document.getElementById('streamCountdown');
  if (!el) return;
  const next = computeNextStream();
  if (!next){ el.textContent=''; return; }
  const diff = next - Date.now();
  if (diff <= 0){ el.textContent=''; return; }
  const days = Math.floor(diff/86400000);
  const hours = Math.floor((diff%86400000)/3600000);
  const mins = Math.floor((diff%3600000)/60000);
  const dayNames=['воскресенье','понедельник','вторник','среду','четверг','пятницу','субботу'];
  const parts=[];
  if(days) parts.push(`${days} дн.`);
  if(days||hours) parts.push(`${hours} ч.`);
  parts.push(`${mins} мин.`);
  const hh=String(next.getHours()).padStart(2,'0'), mm=String(next.getMinutes()).padStart(2,'0');
  el.innerHTML = `🔴 Ближайший эфир — <strong>${dayNames[next.getDay()]} в ${hh}:${mm}</strong> (через ${parts.join(' ')})`;
}
updateStreamCountdown();
setInterval(updateStreamCountdown, 60000);

// ═══════════════════════════════════════
//  РЕДАКТОР РАСПИСАНИЯ (админка "⚙️ Настройки сайта")
//  Хранится в site_config (key='schedule') — та же таблица и паттерн,
//  что уже использует редактор опросов. localStorage — быстрый кэш,
//  чтобы расписание применялось мгновенно, не дожидаясь ответа Supabase.
// ═══════════════════════════════════════
const DAY_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const DAY_FULL  = ['воскресенье','понедельник','вторник','среду','четверг','пятницу','субботу'];

function applyScheduleToDOM(schedule){
  schedule.forEach(day=>{
    const card = document.querySelector(`.day-card[data-d="${day.d}"]`);
    if (!card) return;
    card.innerHTML = day.live
      ? `<div class="day-name">${DAY_SHORT[day.d]}</div><div class="day-live">${day.time}</div>`
      : `<div class="day-name">${DAY_SHORT[day.d]}</div><div class="day-off">—</div>`;
    card.classList.toggle('today', day.d === new Date().getDay());
  });
  updateStreamCountdown();
}

async function loadScheduleFromDB(){
  // Локальный кэш применяется сразу при определении функции (см. ниже),
  // тут только сетевой поход в Supabase — он может подождать общую очередь,
  // а вот из localStorage лучше не заставлять секундами мелькать дефолт.
  if (!sbClient) return;
  try {
    const { data } = await sbClient.from('site_config').select('value').eq('key','schedule').single();
    if (data?.value) {
      const schedule = JSON.parse(data.value);
      applyScheduleToDOM(schedule);
      try { localStorage.setItem('d37_schedule', JSON.stringify(schedule)); } catch(e) {}
    }
  } catch(e) {}
}
// Мгновенно, без задержки — иначе на секунду-две видно дефолтное расписание
try {
  const cachedSchedule = localStorage.getItem('d37_schedule');
  if (cachedSchedule) applyScheduleToDOM(JSON.parse(cachedSchedule));
} catch(e) {}

function renderScheduleAdminRows(){
  const container = document.getElementById('schedAdminRows');
  if (!container) return;
  const rows = [...document.querySelectorAll('.day-card')]
    .map(c=>({ d:+c.dataset.d, live: !!c.querySelector('.day-live'), time: c.querySelector('.day-live')?.textContent.trim() || '20:00' }))
    .sort((a,b)=>a.d-b.d);
  container.innerHTML = rows.map(day=>`
    <div class="sched-admin-row" data-day="${day.d}">
      <span class="sched-admin-dayname">${DAY_FULL[day.d][0].toUpperCase()+DAY_FULL[day.d].slice(1)}</span>
      <label class="sched-admin-toggle">
        <input type="checkbox" class="sched-admin-live" ${day.live?'checked':''} onchange="this.closest('.sched-admin-row').querySelector('.sched-admin-time').style.display=this.checked?'inline-block':'none'">
        Стрим
      </label>
      <input type="time" class="sched-admin-time" aria-label="Время эфира в ${DAY_FULL[day.d]}" value="${day.time}" style="display:${day.live?'inline-block':'none'}">
    </div>
  `).join('');
}

async function saveScheduleAdmin(){
  const statusEl = document.getElementById('schedSaveStatus');
  const schedule = [...document.querySelectorAll('.sched-admin-row')].map(r=>{
    const d = +r.dataset.day;
    const live = r.querySelector('.sched-admin-live').checked;
    const time = r.querySelector('.sched-admin-time').value || '20:00';
    return live ? {d, live:true, time} : {d, live:false};
  });
  applyScheduleToDOM(schedule);
  try { localStorage.setItem('d37_schedule', JSON.stringify(schedule)); } catch(e) {}
  if (sbClient && currentRole === 'admin') {
    try {
      await sbClient.from('site_config').upsert([{ key: 'schedule', value: JSON.stringify(schedule) }]);
      statusEl.textContent = '✅ Сохранено!';
    } catch(e) {
      statusEl.textContent = '⚠ Применено локально, но не сохранилось на сервер';
    }
  } else {
    statusEl.textContent = '✅ Применено (локально)';
  }
  setTimeout(()=>statusEl.textContent='', 3000);
}
