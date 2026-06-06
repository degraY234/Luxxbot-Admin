# Dipanggil saat Windows login — pulihkan luxx kecuali sudah di-delete.
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $pm2) { exit 0 }

Start-Sleep -Seconds 3

try {
    $list = pm2 jlist 2>$null | ConvertFrom-Json
    $luxx = $list | Where-Object { $_.name -eq 'luxx' } | Select-Object -First 1

    if (-not $luxx) {
        pm2 start ecosystem.config.cjs --update-env 2>$null
    } elseif ($luxx.pm2_env.status -ne 'online') {
        pm2 start luxx --update-env 2>$null
    }

    pm2 save 2>$null
} catch {
    pm2 start ecosystem.config.cjs --update-env 2>$null
    pm2 save 2>$null
}