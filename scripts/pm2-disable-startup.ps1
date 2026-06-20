$ErrorActionPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

# Remove registry Run entry if exists
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$taskName = 'LuxxBot-PM2-Boot'
Remove-ItemProperty -Path $runKey -Name $taskName -ErrorAction SilentlyContinue

# Uninstall pm2-windows-startup service to prevent resurrect
$hasStartup = Get-Command pm2-startup -ErrorAction SilentlyContinue
if ($hasStartup) {
    pm2-startup uninstall
}

Write-Host "PM2 startup trigger removed. Apps will not auto-start on login." -ForegroundColor Green
Write-Host "Use: npm run pm2:start  => manual start" -ForegroundColor Yellow