# LuxxBot — buka radio ke internet via Cloudflare Tunnel (gratis, HTTPS)
# Prasyarat: bot sudah jalan (npm start) dan radio listen di port 3920

$ErrorActionPreference = "Stop"
$Port = if ($env:RADIO_PORT) { $env:RADIO_PORT } else { 3920 }
$LocalUrl = "http://127.0.0.1:$Port"

function Test-Cloudflared {
    $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cf) { return $cf.Source }
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host "Menginstall cloudflared via winget..."
        winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
        $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
        if ($cf) { return $cf.Source }
    }
    return $null
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  LuxxBot Radio — Cloudflare Tunnel" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

try {
    $health = Invoke-WebRequest -Uri "$LocalUrl/health" -UseBasicParsing -TimeoutSec 3
    Write-Host "OK: Radio bot aktif di $LocalUrl" -ForegroundColor Green
} catch {
    Write-Host "PERINGATAN: Bot/radio belum merespons di $LocalUrl" -ForegroundColor Yellow
    Write-Host "Jalankan dulu: npm start" -ForegroundColor Yellow
    Write-Host ""
}

$cfPath = Test-Cloudflared
if (-not $cfPath) {
    Write-Host "cloudflared tidak ditemukan." -ForegroundColor Red
    Write-Host "Install manual: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    exit 1
}

Write-Host ""
Write-Host "Tunnel dimulai. Tunggu URL https://....trycloudflare.com" -ForegroundColor Cyan
Write-Host ""
Write-Host "Setelah URL muncul:" -ForegroundColor White
Write-Host "  1. Salin URL ke .env -> RADIO_PUBLIC_URL=https://....trycloudflare.com"
Write-Host "  2. Restart bot (pm2 restart luxx --update-env)"
Write-Host "  3. Tes !radio dari WhatsApp (pakai data seluler, bukan WiFi rumah)"
Write-Host ""
Write-Host "Biarkan jendela ini terbuka selama mau pakai link publik." -ForegroundColor DarkGray
Write-Host "Tutup / Ctrl+C = link mati (bot tetap jalan)." -ForegroundColor DarkGray
Write-Host ""
Write-Host "Tekan Ctrl+C untuk stop tunnel." -ForegroundColor DarkGray
Write-Host ""

& $cfPath tunnel --url $LocalUrl