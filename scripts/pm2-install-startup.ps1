# Pasang LuxxBot agar otomatis hidup lagi setelah laptop restart/login Windows.
# Jalankan PowerShell sebagai Administrator (disarankan, sekali saja).

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$BootScript = Join-Path $Root 'scripts\pm2-boot.ps1'

Write-Host "=== LuxxBot PM2 Auto-Start (Windows) ===" -ForegroundColor Cyan
Write-Host "Folder: $Root"

Set-Location $Root

$hasStartup = Get-Command pm2-startup -ErrorAction SilentlyContinue
if (-not $hasStartup) {
    Write-Host "Menginstall pm2-windows-startup (global)..." -ForegroundColor Yellow
    npm install -g pm2-windows-startup
}

Write-Host "[1/3] PM2 resurrect saat login..." -ForegroundColor Yellow
pm2-startup install

Write-Host "[2/3] Task login: selalu nyalakan luxx (kecuali pm2 delete)..." -ForegroundColor Yellow
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$taskName = 'LuxxBot-PM2-Boot'
$cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$BootScript`""

Set-ItemProperty -Path $runKey -Name $taskName -Value $cmd -Type String

Write-Host "[3/3] Daftarkan luxx + simpan..." -ForegroundColor Yellow
pm2 start ecosystem.config.cjs --update-env
pm2 save

Write-Host ""
Write-Host "Selesai." -ForegroundColor Green
Write-Host "  pm2 stop luxx   = mati sementara (hidup lagi setelah restart/login)"
Write-Host "  pm2 delete luxx = hilang permanen dari PM2"
Write-Host "  Link !radio     = jalankan manual: scripts/radio-tunnel.ps1"
Write-Host "  npm run pm2:start = nyalakan manual"
Write-Host ""
Write-Host "Cek: pm2 status" -ForegroundColor Cyan