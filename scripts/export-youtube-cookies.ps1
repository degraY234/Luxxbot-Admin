# Export cookies YouTube dari Chrome/Edge → upload ke bot Railway (sekali saja, tersimpan di volume)
param(
    [string]$Browser = "chrome",
    [string]$ApiBase = "https://luxxbot-production.up.railway.app",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$root = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $root "data"
$outFile = Join-Path $outDir "youtube-cookies.txt"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$locking = @('chrome', 'msedge', 'brave') | Where-Object {
    Get-Process -Name $_ -ErrorAction SilentlyContinue
}
if ($locking) {
    Write-Host ""
    Write-Host "PERINGATAN: Browser masih jalan ($($locking -join ', '))" -ForegroundColor Yellow
    Write-Host "  yt-dlp tidak bisa baca cookie DB kalau browser terbuka."
    Write-Host "  Tutup SEMUA jendela Chrome/Edge/Brave lalu jalankan ulang script."
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
    Write-Host ""
    Write-Host "GAGAL export cookies." -ForegroundColor Red
    if ($errors) {
        Write-Host "Error terakhir per browser:" -ForegroundColor Red
        $errors | ForEach-Object { Write-Host "  $_" }
    }
    Write-Host ""
    Write-Host "Penyebab paling umum:" -ForegroundColor Yellow
    Write-Host "  • Chrome/Edge MASIH TERBUKA → database cookie dikunci"
    Write-Host "  • Belum login youtube.com di browser"
    Write-Host "  • Firefox tidak terpasang / tidak pernah dipakai"
    Write-Host ""
    Write-Host "Langkah fix:" -ForegroundColor Cyan
    Write-Host "  1) Tutup SEMUA Chrome, Edge, Brave (cek Task Manager)"
    Write-Host "  2) Buka Chrome → login youtube.com"
    Write-Host "  3) Tutup Chrome lagi → jalankan: .\scripts\export-youtube-cookies.ps1"
    Write-Host ""
    Write-Host "Alternatif (tanpa tutup browser):" -ForegroundColor Cyan
    Write-Host "  • Ekstensi 'Get cookies.txt LOCALLY' di Chrome → export youtube.com"
    Write-Host "  • Paste isi file di https://luxxbot-production.up.railway.app/admin → Simpan Cookies"
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