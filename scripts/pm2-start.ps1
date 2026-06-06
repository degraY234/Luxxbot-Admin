# Nyalakan / daftarkan ulang LuxxBot di PM2
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

pm2 start ecosystem.config.cjs --update-env
pm2 save
pm2 status luxx
Write-Host "LuxxBot online. Simpan daftar PM2: pm2 save (sudah dijalankan)." -ForegroundColor Green