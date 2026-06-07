# Export cookies YouTube -> simpan data/youtube-cookies.txt -> upload ke bot (Railway atau PM2 lokal)
param(
    [string]$Browser = "chrome",
    [string]$ApiBase = "",
    [string]$AdminToken = $env:ADMIN_API_TOKEN,
    [switch]$Local,
    [switch]$UploadOnly
)

$root = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $root "data"
$outFile = Join-Path $outDir "youtube-cookies.txt"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Read-DotEnvValue([string]$Name) {
    $envFile = Join-Path $root ".env"
    if (-not (Test-Path $envFile)) { return $null }
    foreach ($line in Get-Content $envFile -Encoding UTF8) {
        if ($line -match "^\s*$Name\s*=\s*(.+)\s*$") {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

if (-not $AdminToken) {
    $AdminToken = Read-DotEnvValue "ADMIN_API_TOKEN"
}

if (-not $ApiBase) {
    if ($Local) {
        $port = Read-DotEnvValue "RADIO_PORT"
        if (-not $port) { $port = "3920" }
        $ApiBase = "http://localhost:$port"
    } else {
        $pub = Read-DotEnvValue "RADIO_PUBLIC_URL"
        if ($pub -and $pub -notmatch 'trycloudflare|localhost|127\.0\.0\.1') {
            $ApiBase = $pub.TrimEnd('/')
        } else {
            $ApiBase = "https://luxxbot-production.up.railway.app"
        }
    }
}

Write-Host "Target API: $ApiBase"

if ($UploadOnly -or ((Test-Path $outFile) -and ((Get-Item $outFile).Length -gt 80) -and $AdminToken)) {
    if (-not (Test-Path $outFile) -or (Get-Item $outFile).Length -le 80) {
        Write-Host "File cookies belum ada di $outFile" -ForegroundColor Red
        Write-Host "Export dulu pakai ekstensi 'Get cookies.txt LOCALLY' dari youtube.com"
        exit 1
    }
    Write-Host "Upload file cookies yang sudah ada ..."
    & (Join-Path $PSScriptRoot "upload-youtube-cookies.ps1") -CookiesFile $outFile -ApiBase $ApiBase -AdminToken $AdminToken
    exit $LASTEXITCODE
}

$locking = @('chrome', 'msedge', 'brave') | Where-Object {
    Get-Process -Name $_ -ErrorAction SilentlyContinue
}
if ($locking) {
    Write-Host ""
    Write-Host "PERINGATAN: Browser masih jalan ($($locking -join ', '))" -ForegroundColor Yellow
    Write-Host "  Tutup SEMUA jendela Chrome/Edge/Brave (cek Task Manager)."
    Write-Host "  Atau pakai: .\scripts\export-youtube-cookies.ps1 -UploadOnly (setelah export via ekstensi)"
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
    Write-Host "GAGAL export via yt-dlp." -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "  $_" }

    Write-Host ""
    Write-Host "CARA PALING MUDAH (browser boleh terbuka):" -ForegroundColor Cyan
    Write-Host "  1) Chrome -> install ekstensi 'Get cookies.txt LOCALLY'"
    Write-Host "  2) Buka youtube.com (login) -> export -> simpan:"
    Write-Host "     $outFile"
    Write-Host "  3) Upload:"
    if ($Local) {
        Write-Host "     .\scripts\export-youtube-cookies.ps1 -Local -UploadOnly"
    } else {
        Write-Host "     .\scripts\export-youtube-cookies.ps1 -UploadOnly"
    }
    Write-Host "  Atau paste di /admin -> Simpan Cookies"

    if ($locked) {
        Write-Host ""
        Write-Host "Extra: tutup Chrome/Edge lalu double-click scripts\export-youtube-cookies.bat" -ForegroundColor Yellow
    }
    exit 1
}

$size = (Get-Item $outFile).Length
Write-Host "OK: $outFile - $size bytes" -ForegroundColor Green

if (-not $AdminToken) {
    Write-Host ""
    Write-Host "Cookies tersimpan lokal. PM2 akan pakai file ini otomatis."
    Write-Host "Upload ke server (opsional): set ADMIN_API_TOKEN di .env lalu -UploadOnly"
    exit 0
}

Write-Host "Upload ke $ApiBase ..."
& (Join-Path $PSScriptRoot "upload-youtube-cookies.ps1") -CookiesFile $outFile -ApiBase $ApiBase -AdminToken $AdminToken
exit $LASTEXITCODE