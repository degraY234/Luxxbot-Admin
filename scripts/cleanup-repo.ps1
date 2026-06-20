# cleanup-repo.ps1
# Jalankan di PowerShell dari root folder project
# Membersihkan clutter runtime/build — TIDAK menghapus session/ (WA login)
#
# Contoh (sudah di PowerShell — jangan ketik "powershell" lagi):
#   .\scripts\cleanup-repo.ps1
#   .\scripts\cleanup-repo.ps1 -Commit
# Atau commit saja tanpa PowerShell: npm run cleanup:commit

param([switch]$Commit)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$deleted = @()
$errors = @()

function Remove-IfExists {
    param([string]$Path, [switch]$Recurse)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    try {
        if ($Recurse) {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
        } else {
            Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
        }
        $script:deleted += $Path
        Write-Host "Menghapus: $Path" -ForegroundColor Yellow
    } catch {
        $script:errors += "$Path : $($_.Exception.Message)"
        Write-Host "Gagal: $Path - $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "=== LuxxBot Repo Cleanup (session preserved) ===" -ForegroundColor Cyan

# Folders: runtime/build clutter only — session/ intentionally excluded
foreach ($folder in @('temp', 'dist-pages', 'terminals', 'backup', '.kiro')) {
    Remove-IfExists $folder -Recurse
}

# Root clutter files
foreach ($file in @('dasu.response', 'w2g_room.json', '$null', 'CLEANUP_AND_COMMIT.md')) {
    Remove-IfExists $file
}

# Runtime data (gitignored)
Remove-IfExists 'data\youtube-cookies.txt'
Remove-IfExists 'data\sounds' -Recurse

# Scripts probe/test/diag clutter
if (Test-Path 'scripts') {
    Get-ChildItem 'scripts' -File | Where-Object {
        $_.Name -like '_*' -or
        $_.Name -like 'probe-*' -or
        $_.Name -like 'test-*'
    } | ForEach-Object {
        Remove-IfExists $_.FullName
    }
}

# Hapus folder kosong yang tersisa setelah isi di-delete
foreach ($empty in @('temp', 'dist-pages', 'terminals', 'backup', '.kiro')) {
    if ((Test-Path $empty) -and -not (Get-ChildItem $empty -Recurse -Force -ErrorAction SilentlyContinue)) {
        Remove-IfExists $empty -Recurse
    }
}

Write-Host "`nDihapus: $($deleted.Count) item" -ForegroundColor Green
Write-Host "Dipertahankan: session/, .env, node_modules/, source code" -ForegroundColor Green

if ($errors.Count) {
    Write-Host "`nErrors:" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "  $_" }
}

if ($Commit) {
    Write-Host "`n=== Git commit cleanup ===" -ForegroundColor Cyan
    git add .gitignore README.md package.json scripts/cleanup-repo.ps1
    git add -u -- . ':!.env' ':!session' ':!session/*' ':!node_modules' ':!node_modules/*' ':!temp' ':!temp/*' ':!dist-pages' ':!dist-pages/*' ':!terminals' ':!terminals/*' ':!.kiro' ':!.kiro/*'
    git commit -m "chore: rapikan struktur repo + hapus clutter" `
        -m "- Hapus 71+ script probe/test/diag di scripts/" `
        -m "- Bersihkan runtime cache (temp, terminals, dist-pages, .kiro)" `
        -m "- Hapus file sampah root (dasu.response, w2g_room.json, restore.js)" `
        -m "- Perbarui .gitignore, README struktur folder, cleanup-repo.ps1 (preserve session/)"
    Write-Host "`n=== Git log (3 terakhir) ===" -ForegroundColor Cyan
    git log --oneline -3
    Write-Host "`n=== Git status ===" -ForegroundColor Cyan
    git status --short
} else {
    Write-Host "`nTip: tambahkan -Commit untuk stage + commit perubahan cleanup" -ForegroundColor DarkGray
}

Write-Host "`n=== Root Contents ===" -ForegroundColor Cyan
Get-ChildItem $root -Force | Select-Object -ExpandProperty Name