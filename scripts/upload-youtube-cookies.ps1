# Upload file cookies (dari ekstensi browser) ke bot — Railway atau PM2 lokal
param(
    [string]$CookiesFile = "",
    [string]$ApiBase = "",
    [string]$AdminToken = $env:ADMIN_API_TOKEN,
    [switch]$Local
)

$root = Split-Path $PSScriptRoot -Parent

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

if (-not $AdminToken) { $AdminToken = Read-DotEnvValue "ADMIN_API_TOKEN" }
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
    Write-Host "ADMIN_API_TOKEN tidak ada di .env / environment." -ForegroundColor Yellow
    Write-Host "Untuk PM2 lokal: cukup simpan file di data/youtube-cookies.txt lalu pm2 restart luxx"
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