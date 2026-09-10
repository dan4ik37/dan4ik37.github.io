// ═══════════════════════════════════════
//  PROTECTION (только drag)
// ═══════════════════════════════════════
document.addEventListener('dragstart',e=>e.preventDefault());

// ═══════════════════════════════════════
//  INIT новых фич
// ═══════════════════════════════════════
updatePushBtn();
updateGlobalAuthBtn();
renderPoll();
loadLeaderboard();
loadGoalFromDA();
setTimeout(loadPollsFromDB, 2000);
setTimeout(loadScheduleFromDB, 2000);
setTimeout(loadGoalConfigFromDB, 2000);
initChat();
initPerfMode();
// Слушатель публичных алертов о донате — для ВСЕХ посетителей, не только
// админа (сама трансляция события идёт из сессии админа, см. выше)
initPublicDonationBroadcastListener();
// loadYT() и Twitch-плеер теперь грузятся только при реальном заходе на
// #/home — см. initHomeMedia(), вызывается из showPage(). Раньше грузились
// всегда, даже если открыли сайт сразу на #/chat — тратили квоту YouTube API
// и грузили Twitch-плеер зря.

// ── КНОПКА НАВЕРХ + ПРОГРЕСС ──
const scrollTopBtn = document.getElementById('scrollTop');
const progressBar  = document.getElementById('readProgress');
window.addEventListener('scroll', () => {
  const scrolled = window.scrollY;
  const total    = document.body.scrollHeight - window.innerHeight;
  // Кнопка
  scrollTopBtn.classList.toggle('show', scrolled > 400);
  // Прогресс бар
  if(progressBar) progressBar.style.width = (total > 0 ? (scrolled/total*100) : 0) + '%';
}, {passive:true});
