# LuxxBot - buka radio/watch ke internet via Cloudflare Tunnel
# Prasyarat: bot sudah jalan (pm2) dan radio listen di port 3920

$ErrorActionPreference = "Stop"
$Port = if ($env:RADIO_PORT) { $env:RADIO_PORT } else { 3920 }
$LocalUrl = "http://127.0.0.1:$Port"

function Test-Cloudflared {
    $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cf) { return $cf.Source }
    $paths = @(
        "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
        "$env:ProgramFiles\cloudflared\cloudflared.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }
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
Write-Host "  LuxxBot - Cloudflare Tunnel" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

try {
    $null = Invoke-WebRequest -Uri "$LocalUrl/health" -UseBasicParsing -TimeoutSec 3
    Write-Host "OK: Bot aktif di $LocalUrl" -ForegroundColor Green
} catch {
    Write-Host "PERINGATAN: Bot belum merespons di $LocalUrl" -ForegroundColor Yellow
    Write-Host "Jalankan: npm run pm2:restart" -ForegroundColor Yellow
    Write-Host ""
}

$cfPath = Test-Cloudflared
if (-not $cfPath) {
    Write-Host "cloudflared tidak ditemukan." -ForegroundColor Red
    Write-Host "Install: winget install Cloudflare.cloudflared"
    exit 1
}

Write-Host ""
Write-Host "Tunnel dimulai. Tunggu URL https://....trycloudflare.com" -ForegroundColor Cyan
Write-Host ""
Write-Host "Setelah URL muncul:" -ForegroundColor White
Write-Host "  1. Salin URL ke .env -> RADIO_PUBLIC_URL=https://....trycloudflare.com"
Write-Host "  2. pm2 restart luxx --update-env"
Write-Host "  3. Tes !watch dari WhatsApp"
Write-Host ""
Write-Host "Biarkan jendela ini terbuka. Tutup = link mati." -ForegroundColor DarkGray
Write-Host ""

& $cfPath tunnel --url $LocalUrl