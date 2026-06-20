@echo off
REM Remove LuxxBot PM2-Boot from Windows startup registry
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "LuxxBot-PM2-Boot" /f 2>nul
call "%~dp0pm2-disable-startup.ps1"
pause