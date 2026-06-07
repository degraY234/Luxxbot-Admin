@echo off
title LuxxBot - Export YouTube Cookies
cd /d "%~dp0.."
echo.
echo  Jalankan dari File Explorer (bukan terminal Cursor)
echo  Supaya Windows bisa decrypt cookie Chrome.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0export-youtube-cookies.ps1"
echo.
pause