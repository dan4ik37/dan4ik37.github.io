// ═══════════════════════════════════════
//  ОБЩИЕ ФУНКЦИИ ОТКРЫТИЯ/ЗАКРЫТИЯ ПАНЕЛИ "⚙️ НАСТРОЙКИ САЙТА"
// ═══════════════════════════════════════
function openSettingsAdmin(){
  renderScheduleAdminRows();
  document.getElementById('goalAdminTitle').value = goalTitleText;
  document.getElementById('goalAdminTarget').value = goalMaxVal;
  renderCustomEmojiList();
  document.getElementById('settingsAdminModal').style.display = 'flex';
  trapModalFocus(document.getElementById('settingsAdminModal'));
}
function closeSettingsAdmin(){
  document.getElementById('settingsAdminModal').style.display = 'none';
  releaseModalFocus();
}
