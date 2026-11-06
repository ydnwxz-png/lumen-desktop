@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=%~dp0runtime\node;%LOCALAPPDATA%\Lumen\node;%PATH%;%ProgramFiles%\nodejs"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\get-node.ps1"
if errorlevel 1 goto nonode
if exist "node_modules\electron\dist\electron.exe" goto ready
echo.
echo   Ставлю программу, это один раз - пару минут...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto noinstall
:ready
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
exit /b 0

:nonode
echo.
echo   Не получилось скачать Node.js. Проверь интернет и запусти ещё раз.
pause
exit /b 1
:noinstall
echo.
echo   Не получилось установить зависимости. Проверь интернет и запусти ещё раз.
pause
exit /b 1
