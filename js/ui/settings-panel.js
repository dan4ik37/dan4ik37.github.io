// ═══════════════════════════════════════
//  ОБЩИЕ ФУНКЦИИ ОТКРЫТИЯ/ЗАКРЫТИЯ ПАНЕЛИ "⚙️ НАСТРОЙКИ САЙТА"
// ═══════════════════════════════════════
function openSettingsAdmin(){
  renderScheduleAdminRows();
  document.getElementById('goalAdminTitle').value = goalTitleText;
  document.getElementById('goalAdminTarget').value = goalMaxVal;
  document.getElementById('goalAdminSince').value = goalSinceISO ? goalSinceISO.slice(0, 10) : '';
  renderCustomEmojiList();
  document.getElementById('settingsAdminModal').style.display = 'flex';
  trapModalFocus(document.getElementById('settingsAdminModal'));
}
function closeSettingsAdmin(){
  document.getElementById('settingsAdminModal').style.display = 'none';
  releaseModalFocus();
}
