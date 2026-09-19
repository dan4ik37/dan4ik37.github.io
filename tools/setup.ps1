# Установка всего необходимого одной командой (кроме самого ARDY — он
# отдельный тяжёлый репозиторий, см. README).
#
# Запуск (из папки проекта, в PowerShell):
#   .\tools\setup.ps1
#
# Если ругается на "выполнение сценариев отключено" — один раз разреши:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

Write-Host "== npm install (Electron + three.js + three-vrm) ==" -ForegroundColor Cyan
npm install

Write-Host "`n== pip install (для автоанализа музыки: librosa и т.п.) ==" -ForegroundColor Cyan
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) { $pythonCmd = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $pythonCmd) {
    Write-Host "Python не найден в PATH — пропускаю pip install. Автоанализ музыки будет недоступен, пока не поставишь Python (python.org) и не перезапустишь PowerShell." -ForegroundColor Yellow
} else {
    & $pythonCmd.Source -m pip install -r tools/requirements.txt
}

Write-Host "`nГотово. Запускай: npm start" -ForegroundColor Green
