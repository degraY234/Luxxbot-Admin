# pm2-unsave.ps1
# Hentikan proses luxx & luxx-tunnel lalu kosongkan PM2 dump
# sehingga keduanya tidak auto-start saat boot.
# PM2 startup service tetap terdaftar - hanya dump yang dikosongkan.

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "=== PM2 Unsave: Menonaktifkan auto-start ===" -ForegroundColor Cyan

pm2 stop luxx 2>$null
pm2 stop luxx-tunnel 2>$null
pm2 save

Write-Host ""
Write-Host "Selesai. PM2 dump telah dikosongkan." -ForegroundColor Green
Write-Host "  - Proses TIDAK akan auto-start saat boot." -ForegroundColor Yellow
Write-Host "  - Jalankan 'npm run pm2:start' untuk start manual." -ForegroundColor Yellow
Write-Host ""
Write-Host "Verifikasi: pm2 ls" -ForegroundColor Cyan
