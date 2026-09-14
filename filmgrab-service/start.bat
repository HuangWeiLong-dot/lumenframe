@echo off
REM 双击启动 FilmGrab 截图代理（自动调用 start.ps1，绕过执行策略限制）
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
