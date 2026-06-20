# Dipanggil saat Windows login — pulihkan luxx kecuali sudah di-delete.
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $pm2) { exit 0 }

Start-Sleep -Seconds 3

try {
    $list = pm2 jlist 2>$null | ConvertFrom-Json
    $luxx = $list | Where-Object { $_.name -eq 'luxx' } | Select-Object -First 1

    if ($luxx -and $luxx.pm2_env.status -eq 'online') {
        # App already online; nothing to do.
    } elseif (-not $luxx) {
        pm2 start ecosystem.config.cjs --update-env 2>$null
        pm2 save 2>$null
    } else {
        # App exists but is not online (e.g., stopped); do NOT force-start.
        # Manual start required to run again.
    }
} catch {
    # If dump read fails, do nothing to avoid forced start.
}
