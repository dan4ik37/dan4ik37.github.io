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
function openVid(id,title,date,views){
  document.getElementById('mTitle').textContent=title;
  document.getElementById('mMeta').textContent=`YouTube · @Dan4ik37Yt${date?' · '+date:''}${views?' · 👁 '+views:''}`;
  document.getElementById('mVid').innerHTML=`<iframe src="https://www.youtube.com/embed/${id}?autoplay=1&rel=0" allowfullscreen allow="autoplay;encrypted-media"></iframe>`;
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
