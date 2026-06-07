# Upload file cookies (dari ekstensi browser) ke Railway — tidak butuh yt-dlp decrypt
param(
    [string]$CookiesFile = "",
    [string]$ApiBase = "https://luxxbot-production.up.railway.app",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$root = Split-Path $PSScriptRoot -Parent
if (-not $CookiesFile) {
    $CookiesFile = Join-Path $root "data\youtube-cookies.txt"
}

if (-not (Test-Path $CookiesFile)) {
    Write-Host "File tidak ada: $CookiesFile" -ForegroundColor Red
    Write-Host ""
    Write-Host "Export dulu pakai ekstensi Chrome 'Get cookies.txt LOCALLY':"
    Write-Host "  1) Buka youtube.com (login)"
    Write-Host "  2) Klik ekstensi → Export → simpan sebagai:"
    Write-Host "     $CookiesFile"
    Write-Host "  3) Jalankan ulang script ini"
    exit 1
}

$size = (Get-Item $CookiesFile).Length
if ($size -lt 80) {
    Write-Host "File cookies terlalu kecil ($size bytes) — export ulang dari youtube.com" -ForegroundColor Red
    exit 1
}

Write-Host "File OK: $CookiesFile ($size bytes)"

if (-not $AdminToken) {
    Write-Host ""
    Write-Host "Set token dulu:" -ForegroundColor Yellow
    Write-Host '  $env:ADMIN_API_TOKEN = "token-dari-.env"'
    Write-Host "  .\scripts\upload-youtube-cookies.ps1"
    exit 1
}

$content = Get-Content $CookiesFile -Raw -Encoding UTF8
$body = @{ content = $content } | ConvertTo-Json -Compress
$headers = @{
    Authorization = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

Write-Host "Upload ke $ApiBase ..."
try {
    $res = Invoke-RestMethod -Uri "$ApiBase/admin/api/youtube-cookies" -Method POST -Headers $headers -Body $body
    Write-Host "Upload OK: $($res.path) ($($res.bytes) bytes)" -ForegroundColor Green
    Write-Host "Tes: !play multo di WhatsApp"
} catch {
    Write-Error "Upload gagal: $($_.Exception.Message)"
    exit 1
}