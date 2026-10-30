$ErrorActionPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Set-EnvFlag($name, $value) {
    $envFile = Join-Path $Root '.env'
    if (-not (Test-Path $envFile)) { return }
    $lines = Get-Content $envFile -Encoding UTF8
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match "^\s*$name\s*=") {
            $found = $true
            "$name=$value"
        } else {
            $line
        }
    }
    if (-not $found) { $out += "$name=$value" }
    Set-Content -Path $envFile -Value $out -Encoding UTF8
}

# Hapus auto-start Windows
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$taskName = 'LuxxBot-PM2-Boot'
Remove-ItemProperty -Path $runKey -Name $taskName -ErrorAction SilentlyContinue

$hasStartup = Get-Command pm2-startup -ErrorAction SilentlyContinue
if ($hasStartup) {
    pm2-startup uninstall 2>$null
}

# Matikan flag auto-start di .env
Set-EnvFlag 'LUXX_AUTO_START' '0'
Set-EnvFlag 'LUXX_AUTO_TUNNEL' '0'

# Hentikan proses + kosongkan dump PM2
pm2 stop luxx 2>$null
pm2 stop luxx-tunnel 2>$null
pm2 save 2>$null

Write-Host "Auto-start dimatikan — luxx & luxx-tunnel tidak hidup sendiri lagi." -ForegroundColor Green
Write-Host "  npm run pm2:start     = nyalakan manual" -ForegroundColor Yellow
Write-Host "  npm run pm2:start:all = luxx + tunnel sekaligus" -ForegroundColor Yellow
Write-Host "  npm run pm2:install-startup = hidup otomatis lagi (opsional)" -ForegroundColor DarkGray