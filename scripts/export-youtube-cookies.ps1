# Export cookies YouTube dari Chrome/Edge -> upload ke bot Railway
param(
    [string]$Browser = "chrome",
    [string]$ApiBase = "https://luxxbot-production.up.railway.app",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$root = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $root "data"
$outFile = Join-Path $outDir "youtube-cookies.txt"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if ((Test-Path $outFile) -and ((Get-Item $outFile).Length -gt 80) -and $AdminToken) {
    Write-Host "File cookies sudah ada - upload saja ..."
    & (Join-Path $PSScriptRoot "upload-youtube-cookies.ps1") -CookiesFile $outFile -ApiBase $ApiBase -AdminToken $AdminToken
    exit $LASTEXITCODE
}

$locking = @('chrome', 'msedge', 'brave') | Where-Object {
    Get-Process -Name $_ -ErrorAction SilentlyContinue
}
if ($locking) {
    Write-Host ""
    Write-Host "PERINGATAN: Browser masih jalan ($($locking -join ', '))" -ForegroundColor Yellow
    Write-Host "  Tutup SEMUA jendela Chrome/Edge/Brave lalu jalankan ulang."
    Write-Host ""
}

$testUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
$browsers = @($Browser, 'edge', 'chrome', 'firefox', 'brave') | Select-Object -Unique
$exported = $false
$errors = @()

foreach ($b in $browsers) {
    Write-Host "Coba export dari $b ..."
    if (Test-Path $outFile) { Remove-Item $outFile -Force -ErrorAction SilentlyContinue }
    $out = & yt-dlp --cookies-from-browser $b --cookies $outFile --skip-download $testUrl 2>&1
    $code = $LASTEXITCODE
    if ($out) { $out | ForEach-Object { Write-Host $_ } }
    if ((Test-Path $outFile) -and ((Get-Item $outFile).Length -gt 80)) {
        $exported = $true
        $Browser = $b
        break
    }
    if ($code -ne 0 -and $out) {
        $errors += "$b : $($out | Select-Object -Last 1)"
    }
}

if (-not $exported) {
    $dpapi = ($errors | Where-Object { $_ -match 'DPAPI' }).Count -gt 0
    $locked = ($errors | Where-Object { $_ -match 'Could not copy' }).Count -gt 0

    Write-Host ""
    Write-Host "GAGAL export cookies." -ForegroundColor Red
    if ($errors) {
        $errors | ForEach-Object { Write-Host "  $_" }
    }

    if ($dpapi) {
        Write-Host ""
        Write-Host "PENYEBAB: Chrome 127+ encrypt cookie (DPAPI)." -ForegroundColor Yellow
        Write-Host "Terminal Cursor/IDE tidak bisa decrypt cookie Chrome." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "SOLUSI A - pakai ekstensi (browser boleh terbuka):" -ForegroundColor Cyan
        Write-Host "  1) Install ekstensi Chrome: Get cookies.txt LOCALLY"
        Write-Host "  2) Buka youtube.com (login), export cookies"
        Write-Host "  3) Simpan ke: $outFile"
        Write-Host "  4) Upload:"
        Write-Host '     $env:ADMIN_API_TOKEN = "token-admin"'
        Write-Host "     .\scripts\upload-youtube-cookies.ps1"
        Write-Host "  Atau paste di /admin -> Simpan Cookies"
        Write-Host ""
        Write-Host "SOLUSI B - double-click scripts\export-youtube-cookies.bat dari File Explorer"
    }
    elseif ($locked) {
        Write-Host ""
        Write-Host "PENYEBAB: Chrome/Edge masih terbuka." -ForegroundColor Yellow
    }
    exit 1
}

$size = (Get-Item $outFile).Length
Write-Host "OK: $outFile - $size bytes"

if (-not $AdminToken) {
    Write-Host "Lokal: PM2 restart luxx. Railway: set ADMIN_API_TOKEN lalu jalankan ulang."
    exit 0
}

Write-Host "Upload ke $ApiBase ..."
$content = Get-Content $outFile -Raw -Encoding UTF8
$body = @{ content = $content } | ConvertTo-Json -Compress
$headers = @{
    Authorization = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

try {
    $res = Invoke-RestMethod -Uri "$ApiBase/admin/api/youtube-cookies" -Method POST -Headers $headers -Body $body
    Write-Host "Upload OK: $($res.path) - $($res.bytes) bytes" -ForegroundColor Green
    Write-Host "Tes: !play multo di WhatsApp"
}
catch {
    $msg = $_.Exception.Message
    Write-Host "Upload gagal: $msg" -ForegroundColor Red
    exit 1
}