// ═══════════════════════════════════════
//  ФОКУС В МОДАЛКАХ (доступность)
//  Раньше при открытии любой модалки фокус клавиатуры оставался на том,
//  что было под ней — пользователь скринридера/клавиатуры не понимал, что
//  что-то вообще открылось, и не мог сразу попасть в диалог. При закрытии
//  фокус нигде не возвращался туда, откуда открывали.
// ═══════════════════════════════════════
let modalReturnFocus = null;
function trapModalFocus(modalEl){
  if (!modalEl) return;
  modalReturnFocus = document.activeElement;
  modalEl.setAttribute('role','dialog');
  modalEl.setAttribute('aria-modal','true');
  const focusable = modalEl.querySelector('input,button,select,textarea,[tabindex]:not([tabindex="-1"])');
  requestAnimationFrame(()=>{ (focusable || modalEl).focus(); });
}
function releaseModalFocus(){
  if (modalReturnFocus && document.body.contains(modalReturnFocus) && typeof modalReturnFocus.focus === 'function') {
    modalReturnFocus.focus();
  }
  modalReturnFocus = null;
}
// Escape закрывал раньше только видео-модалку — теперь любую открытую
function closeAnyOpenModal(){
  const modal = document.getElementById('modal');
  const confirmM = document.getElementById('confirmModal');
  const settingsM = document.getElementById('settingsAdminModal');
  const pollM = document.getElementById('pollAdminModal');
  const privacyM = document.getElementById('privacyModal');
  const authM = document.getElementById('globalAuthModal');
  const cmdM = document.getElementById('cmdPalette');
  if (cmdM?.classList.contains('open')) { closeCmdPalette(); return true; }
  if (modal?.classList.contains('open')) { closeModal(); return true; }
  if (confirmM?.classList.contains('open')) { closeConfirm(); return true; }
  if (settingsM && getComputedStyle(settingsM).display !== 'none') { closeSettingsAdmin(); return true; }
  if (pollM && getComputedStyle(pollM).display !== 'none') { closePollAdmin(); return true; }
  if (privacyM?.classList.contains('open')) { closePrivacy(); return true; }
  if (authM && getComputedStyle(authM).display !== 'none') { closeGlobalAuth(); return true; }
  return false;
}
function openPrivacy(){
  document.getElementById('privacyModal').classList.add('open');
  trapModalFocus(document.getElementById('privacyModal'));
}
function closePrivacy(){
  document.getElementById('privacyModal').classList.remove('open');
  releaseModalFocus();
}

// ═══════════════════════════════════════
//  MODAL
// ═══════════════════════════════════════
// Ссылка «поделиться» ведёт на страницу ролика на сайте (/v/<id>, api/video.js),
// а не на YouTube: у неё красивое превью, и пришедший остаётся на сайте.
let modalVidId = '';
function vidPageUrl(id){ return 'https://dan4ik37.vercel.app/v/' + id; }
function shareCurrentVid(){
  const url = vidPageUrl(modalVidId), btn = document.getElementById('mShare');
  const title = document.getElementById('mTitle').textContent;
  if (navigator.share) { navigator.share({ title, url }).catch(()=>{}); return; }
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(()=>{
    if (btn) { btn.textContent = '✓ Скопировано'; setTimeout(()=>btn.textContent='🔗 Поделиться', 1800); }
  }, ()=>prompt('Скопируй ссылку:', url));
}

function openVid(id,title,date,views){
  if(typeof markVidWatched==='function') markVidWatched(id);
  modalVidId = id;
  const pageLink = document.getElementById('mPage'); if (pageLink) pageLink.href = '/v/' + id;
  document.getElementById('mTitle').textContent=title;
  document.getElementById('mMeta').textContent=`YouTube · @Dan4ik37Yt${date?' · '+date:''}${views?' · 👁 '+views:''}`;
  // enablejsapi+origin — чтобы xp.js видел реальное время воспроизведения (XP за просмотр)
  document.getElementById('mVid').innerHTML=`<iframe src="https://www.youtube.com/embed/${id}?autoplay=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}" allowfullscreen allow="autoplay;encrypted-media"></iframe>`;
  if (typeof xpTrackIframe === 'function') xpTrackIframe(document.querySelector('#mVid iframe'), id, 60);
  document.getElementById('modal').classList.add('open');document.body.style.overflow='hidden';
  trapModalFocus(document.getElementById('modal'));
}
function closeModal(){
  document.getElementById('modal').classList.remove('open');
  document.getElementById('mVid').innerHTML='';
  document.body.style.overflow='';
  releaseModalFocus();
  // Показываем баннер подписки после просмотра видео
  const banner = document.getElementById('subBanner');
  if (banner) banner.classList.add('show');
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeReactionPicker();closeAnyOpenModal();}});

// ═══════════════════════════════════════
//  ПОДТВЕРЖДЕНИЕ ДЕЙСТВИЯ (общий диалог, напр. для выхода из аккаунта)
// ═══════════════════════════════════════
let confirmCallback = null;
function askConfirm(msg, onConfirm, okLabel){
  document.getElementById('confirmMsg').textContent = msg;
  document.getElementById('confirmOkBtn').textContent = okLabel || 'Подтвердить';
  confirmCallback = onConfirm;
  document.getElementById('confirmModal').classList.add('open');
  trapModalFocus(document.getElementById('confirmModal'));
}
function closeConfirm(){
  document.getElementById('confirmModal').classList.remove('open');
  confirmCallback = null;
  releaseModalFocus();
}
document.getElementById('confirmOkBtn').addEventListener('click', ()=>{
  const cb = confirmCallback;
  closeConfirm();
  if (cb) cb();
});
function confirmLogout(){
  askConfirm('Выйти из аккаунта? Ты перестанешь быть админом/модератором в чате и на сайте.', doGlobalLogout, 'Выйти');
}
