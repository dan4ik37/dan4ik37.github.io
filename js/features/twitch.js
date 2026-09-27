// ═══════════════════════════════════════
//  TWITCH — блок на главной
// ═══════════════════════════════════════
// Статус эфира: публичный decapi.me (без ключей и серверной функции).
// Отвечает текстом: «dan4ik37 is offline» или аптайм вида «1 hour, 5 minutes».
// Любая ошибка = «статус неизвестен» — показываем компактную плашку с кнопкой
// «Показать плеер», ничего не выдумывая.
//
// Раньше плеер (тяжёлый iframe) грузился всегда и почти всегда показывал
// офлайн-заглушку во весь экран. Теперь он создаётся только если эфир реально
// идёт или человек сам нажал «Показать плеер».
//
// initHomeMedia() вызывается роутером только при открытии #/home
// (см. finishShowPage в router.js), поэтому с #/chat и т.п. ничего не грузится.
let homeMediaLoaded = false;
let twLive = null; // true / false / null (неизвестно)

function initHomeMedia(){
  if (homeMediaLoaded) return;
  homeMediaLoaded = true;
  loadYT();
  checkTwitchLive();
  // Эфир мог начаться, пока вкладка открыта
  setInterval(checkTwitchLive, 3 * 60 * 1000);
}

function loadTwitchPlayer(){
  const fr = document.getElementById('autoStreamPlayer');
  if (fr && !fr.src) fr.src = `https://player.twitch.tv/?channel=${TWITCH}&parent=${HOST}&autoplay=${twLive ? 'true&muted=true' : 'false'}`;
}

function setTwitchOpen(open){
  const box = document.getElementById('autoStreamWrap');
  const btn = document.getElementById('twToggle');
  if (!box) return;
  if (open) loadTwitchPlayer();
  box.classList.toggle('open', open);
  if (btn){
    btn.textContent = open ? 'Скрыть плеер' : 'Показать плеер';
    btn.setAttribute('aria-expanded', open);
  }
}
function toggleTwitchPlayer(){
  setTwitchOpen(!document.getElementById('autoStreamWrap')?.classList.contains('open'));
}

async function checkTwitchLive(){
  let live = null;
  try {
    const r = await fetch(`https://decapi.me/twitch/uptime/${TWITCH}`, { cache: 'no-store' });
    if (r.ok) {
      const t = (await r.text()).trim();
      if (/offline/i.test(t)) live = false;
      else if (t && !/error|not found|could not|invalid/i.test(t)) live = true;
    }
  } catch (e) {}
  applyTwitchStatus(live);
}

function applyTwitchStatus(live){
  const wasLive = twLive;
  twLive = live;
  window.__twLive = live === true; // читает fx.js → плашка «ближайший эфир» в герое
  window.__twOffline = live === false;
  const box = document.getElementById('autoStreamWrap');
  const txt = document.getElementById('twStatusText');
  const next = document.getElementById('twNext');
  if (typeof window.__renderHeroPill === 'function') window.__renderHeroPill();
  if (!box || !txt) return;
  box.classList.toggle('is-live', live === true);
  box.classList.toggle('is-offline', live === false);

  if (live === true) {
    txt.textContent = 'В эфире на Twitch — заходи!';
    if (next) next.textContent = '';
    if (wasLive !== true) setTwitchOpen(true);
  } else {
    txt.textContent = live === false ? 'Сейчас не в эфире' : 'Twitch';
    // Ближайший эфир уже посчитан fx.js из блока «Когда стримим?» — берём оттуда
    const pill = document.getElementById('heroPill');
    const pillTxt = document.getElementById('heroPillText');
    if (next) next.innerHTML = (pill && !pill.hidden && !pill.classList.contains('is-live') && pillTxt) ? pillTxt.innerHTML : '';
    if (wasLive === true) setTwitchOpen(false);
  }
}
