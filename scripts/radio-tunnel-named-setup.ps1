# Sekali setup: Cloudflare Named Tunnel → URL !radio TETAP (meski laptop restart).
# Butuh: akun Cloudflare gratis + domain yang DNS-nya di Cloudflare.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$configDir = Join-Path $Root 'config'
$configYml = Join-Path $configDir 'cloudflared.yml'
$credsJson = Join-Path $configDir 'cloudflared-credentials.json'
$example = Join-Path $configDir 'cloudflared.example.yml'
$port = if ($env:RADIO_PORT) { $env:RADIO_PORT } else { 3920 }

function Get-CloudflaredPath {
    $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cf) { return $cf.Source }
    throw 'cloudflared belum terinstall. Jalankan: winget install Cloudflare.cloudflared'
}

Write-Host ''
Write-Host '=== LuxxBot — Named Cloudflare Tunnel (URL permanen) ===' -ForegroundColor Magenta
Write-Host ''

$cf = Get-CloudflaredPath

Write-Host '[1/5] Login Cloudflare (browser akan terbuka)...' -ForegroundColor Cyan
& $cf tunnel login

$tunnelName = Read-Host 'Nama tunnel (misal: luxx-radio)'
if (-not $tunnelName.Trim()) { $tunnelName = 'luxx-radio' }

Write-Host '[2/5] Buat tunnel...' -ForegroundColor Cyan
$createOut = & $cf tunnel create $tunnelName 2>&1 | Out-String
Write-Host $createOut

$tunnelId = $null
if ($createOut -match 'Created tunnel\s+([a-f0-9-]{36})') { $tunnelId = $Matches[1] }
if (-not $tunnelId -and ($createOut -match 'already exists' -or $createOut -match 'Tunnel .+ already exists')) {
    $listOut = & $cf tunnel list 2>&1 | Out-String
    Write-Host $listOut
    $tunnelId = Read-Host 'Tunnel sudah ada — paste Tunnel ID (UUID)'
}

if (-not $tunnelId) {
    Write-Host 'Gagal ambil Tunnel ID. Cek: cloudflared tunnel list' -ForegroundColor Red
    exit 1
}

$hostname = Read-Host 'Hostname publik (misal: radio.domainkamu.com)'
if (-not $hostname.Trim()) {
    Write-Host 'Hostname wajib untuk link tetap.' -ForegroundColor Red
    exit 1
}

Write-Host '[3/5] Route DNS...' -ForegroundColor Cyan
& $cf tunnel route dns $tunnelId $hostname

New-Item -ItemType Directory -Force -Path $configDir | Out-Null

$defaultCreds = Join-Path $env:USERPROFILE ".cloudflared\$tunnelId.json"
if (Test-Path $defaultCreds) {
    Copy-Item $defaultCreds $credsJson -Force
} elseif (-not (Test-Path $credsJson)) {
    Write-Host "Credentials tidak otomatis disalin. Salin manual ke: $credsJson" -ForegroundColor Yellow
}

$credsRel = 'config/cloudflared-credentials.json'
$yml = @"
tunnel: $tunnelId
credentials-file: $credsRel

ingress:
  - hostname: $hostname
    service: http://127.0.0.1:$port
  - service: http_status:404
"@
Set-Content -Path $configYml -Value $yml -Encoding UTF8

$publicUrl = "https://$hostname"
$envPath = Join-Path $Root '.env'
if (Test-Path $envPath) {
    $lines = Get-Content $envPath -Encoding UTF8
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match '^\s*RADIO_PUBLIC_URL\s*=') {
            $found = $true
            "RADIO_PUBLIC_URL=$publicUrl"
        } else { $line }
    }
    if (-not $found) { $out += "RADIO_PUBLIC_URL=$publicUrl" }
    Set-Content -Path $envPath -Value $out -Encoding UTF8
}

Write-Host ''
Write-Host '[4/5] Config tersimpan: config/cloudflared.yml' -ForegroundColor Green
Write-Host "      RADIO_PUBLIC_URL=$publicUrl" -ForegroundColor Green
Write-Host ''
Write-Host '[5/5] Daftarkan tunnel ke PM2:' -ForegroundColor Cyan
Write-Host '  pm2 start ecosystem.config.cjs --update-env'
Write-Host '  pm2 save'
Write-Host ''
Write-Host 'Setelah laptop mati/hidup lagi (login Windows), PM2 nyalakan luxx + luxx-tunnel otomatis.' -ForegroundColor White
Write-Host 'Link !radio tetap sama kecuali kamu: pm2 restart luxx-tunnel / stop tunnel.' -ForegroundColor White
Write-Host ''