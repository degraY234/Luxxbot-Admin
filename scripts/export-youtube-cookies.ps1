# Export cookies YouTube dari Chrome/Edge → upload ke bot Railway (sekali saja, tersimpan di volume)
param(
    [string]$Browser = "chrome",
    [string]$ApiBase = "https://luxxbot-production.up.railway.app",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $root "data"
$outFile = Join-Path $outDir "youtube-cookies.txt"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$testUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
$browsers = @($Browser, 'edge', 'chrome', 'firefox', 'brave') | Select-Object -Unique
$exported = $false

foreach ($b in $browsers) {
    Write-Host "Coba export dari $b ..."
    if (Test-Path $outFile) { Remove-Item $outFile -Force -ErrorAction SilentlyContinue }
    & yt-dlp --cookies-from-browser $b --cookies $outFile --skip-download $testUrl 2>&1 | Out-Host
    if ((Test-Path $outFile) -and ((Get-Item $outFile).Length -gt 80)) {
        $exported = $true
        $Browser = $b
        break
    }
}

if (-not $exported) {
    Write-Host ""
    Write-Host "GAGAL export cookies. Coba:" -ForegroundColor Red
    Write-Host "  1) Tutup SEMUA jendela Chrome/Edge (browser lock cookie DB)"
    Write-Host "  2) Login youtube.com di browser"
    Write-Host "  3) Jalankan ulang script ini"
    Write-Host "  Atau export manual pakai ekstensi 'Get cookies.txt LOCALLY' → paste di /admin"
    exit 1
}

Write-Host "OK: $outFile ($((Get-Item $outFile).Length) bytes)"

if (-not $AdminToken) {
    Write-Host ""
    Write-Host "Lokal: cookies sudah di data/youtube-cookies.txt (PM2 restart luxx)"
    Write-Host "Railway: set ADMIN_API_TOKEN lalu jalankan ulang script ini, atau upload manual di /admin"
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
    Write-Host "Upload OK: $($res.path) ($($res.bytes) bytes)"
    Write-Host "Coba !play multo di WhatsApp / /play di Discord"
} catch {
    Write-Error "Upload gagal: $($_.Exception.Message)"
}