@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0Sauvegarde-restauration-Firestore.ps1"
if errorlevel 1 (
  echo.
  echo Le programme s'est termine avec une erreur.
)
pause
endlocal
