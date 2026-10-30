# Pasang LuxxBot agar otomatis hidup lagi setelah laptop restart/login Windows.
# Jalankan PowerShell sebagai Administrator (disarankan, sekali saja).

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$BootCmd = Join-Path $Root 'scripts\pm2-boot.cmd'
$BootVbs = Join-Path $Root 'scripts\pm2-boot-launch.vbs'

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

Write-Host "=== LuxxBot PM2 Auto-Start (Windows, tanpa CMD) ===" -ForegroundColor Cyan
Write-Host "Folder: $Root"

Set-Location $Root

# Hapus entri PM2 bawaan — cegah startup ganda + jendela CMD dari pm2_resurrect.cmd
$hasStartup = Get-Command pm2-startup -ErrorAction SilentlyContinue
if ($hasStartup) {
    Write-Host "[1/4] Hapus pm2-startup lama (hindari ganda)..." -ForegroundColor Yellow
    pm2-startup uninstall 2>$null
}

Write-Host "[2/4] Task login tersembunyi (VBS + node)..." -ForegroundColor Yellow
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$taskName = 'LuxxBot-PM2-Boot'
$cmd = "wscript.exe `"$BootVbs`" `"$BootCmd`""

Set-ItemProperty -Path $runKey -Name $taskName -Value $cmd -Type String

Write-Host "[3/4] Aktifkan LUXX_AUTO_START di .env..." -ForegroundColor Yellow
Set-EnvFlag 'LUXX_AUTO_START' '1'
Set-EnvFlag 'LUXX_AUTO_TUNNEL' '1'

Write-Host "[4/4] Daftarkan luxx + simpan..." -ForegroundColor Yellow
pm2 start ecosystem.config.cjs --update-env
pm2 save

Write-Host ""
Write-Host "Selesai — luxx + luxx-tunnel hidup otomatis setelah login/restart." -ForegroundColor Green
Write-Host "  npm run pm2:disable-startup = matikan auto-start (disarankan jika ganggu)"
Write-Host "  npm run pm2:start = nyalakan manual tanpa auto-start"
Write-Host ""
Write-Host "Cek: pm2 status" -ForegroundColor Cyan