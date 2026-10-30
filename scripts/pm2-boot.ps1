# Dipanggil saat Windows login — pulihkan luxx kecuali sudah di-delete.
# Semua pm2 lewat node (windowsHide) agar tidak muncul jendela CMD.
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { exit 0 }

& node (Join-Path $PSScriptRoot 'pm2-boot.mjs')
exit $LASTEXITCODE