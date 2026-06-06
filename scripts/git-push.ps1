# LuxxBot — push cepat ke GitHub
# Usage: .\scripts\git-push.ps1 "pesan commit"
# Env opsional: $env:GITHUB_REPO = "https://github.com/user/luxxbot.git"

param(
    [Parameter(Mandatory = $false)]
    [string]$Message = "update: LuxxBot $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Test-Path ".git")) {
    Write-Host "Inisialisasi git..."
    git init
    if ($env:GITHUB_REPO) {
        git remote add origin $env:GITHUB_REPO 2>$null
    }
}

git add -A
$status = git status --porcelain
if (-not $status) {
    Write-Host "Tidak ada perubahan untuk di-commit."
    exit 0
}

git commit -m $Message
Write-Host "Commit OK: $Message"

$branch = git rev-parse --abbrev-ref HEAD 2>$null
if (-not $branch -or $branch -eq "HEAD") {
    git checkout -b main 2>$null
    $branch = "main"
}

if (git remote get-url origin 2>$null) {
    git push -u origin $branch
    Write-Host "Push ke origin/$branch selesai."
} else {
    Write-Host "Remote origin belum diset. Jalankan:"
    Write-Host '  git remote add origin https://github.com/USER/REPO.git'
    Write-Host '  $env:GITHUB_REPO = "..." ; .\scripts\git-push.ps1 "msg"'
}