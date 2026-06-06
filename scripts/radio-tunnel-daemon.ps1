# Jalankan via PM2 (luxx-tunnel). Named tunnel = URL tetap; quick tunnel = auto-update .env.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Port = if ($env:RADIO_PORT) { $env:RADIO_PORT } else { 3920 }
$LocalUrl = "http://127.0.0.1:$Port"
$LogFile = Join-Path $Root 'temp\radio-tunnel.log'
$NamedConfig = Join-Path $Root 'config\cloudflared.yml'
$EnvFile = Join-Path $Root '.env'

New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null

function Get-CloudflaredPath {
    $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cf) { return $cf.Source }
    $x86 = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
    $x64 = 'C:\Program Files\cloudflared\cloudflared.exe'
    if (Test-Path $x86) { return $x86 }
    if (Test-Path $x64) { return $x64 }
    return $null
}

function Set-RadioPublicUrl([string]$Url) {
    if (-not (Test-Path $EnvFile)) { return }
    $url = $Url.Trim().TrimEnd('/')
    $lines = Get-Content $EnvFile -Encoding UTF8
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match '^\s*RADIO_PUBLIC_URL\s*=') {
            $found = $true
            "RADIO_PUBLIC_URL=$url"
        } else { $line }
    }
    if (-not $found) { $out += "RADIO_PUBLIC_URL=$url" }
    if (($out -join "`n") -ne ($lines -join "`n")) {
        Set-Content -Path $EnvFile -Value $out -Encoding UTF8
        Write-Host "[luxx-tunnel] RADIO_PUBLIC_URL -> $url" -ForegroundColor Green
        $pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
        if ($pm2) {
            pm2 restart luxx --update-env 2>$null
        }
    }
}

function Wait-RadioHealth {
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri "$LocalUrl/health" -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Seconds 2
    }
    return $false
}

$cfPath = Get-CloudflaredPath
if (-not $cfPath) {
    Write-Host '[luxx-tunnel] cloudflared tidak ditemukan. Install: winget install Cloudflare.cloudflared' -ForegroundColor Red
    exit 1
}

# --- Named tunnel (URL permanen) ---
if (Test-Path $NamedConfig) {
    Write-Host "[luxx-tunnel] Named tunnel: $NamedConfig" -ForegroundColor Cyan
    if (-not (Wait-RadioHealth)) {
        Write-Host '[luxx-tunnel] Radio belum siap di port' $Port '- tunnel tetap jalan' -ForegroundColor Yellow
    }
    & $cfPath tunnel --config $NamedConfig run 2>&1 | Tee-Object -FilePath $LogFile
    exit $LASTEXITCODE
}

# --- Quick tunnel (URL berubah tiap restart proses; .env di-update otomatis) ---
Write-Host '[luxx-tunnel] Quick tunnel (trycloudflare). Untuk URL tetap: scripts/radio-tunnel-named-setup.ps1' -ForegroundColor Yellow
if (-not (Wait-RadioHealth)) {
    Write-Host '[luxx-tunnel] Menunggu radio di' $LocalUrl '...' -ForegroundColor Yellow
}

$urlPattern = [regex]'https://[a-z0-9-]+\.trycloudflare\.com'
$urlApplied = $false

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $cfPath
$psi.Arguments = "tunnel --url $LocalUrl"
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true

$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi

$handler = {
    param($line)
    if (-not $line) { return }
    Add-Content -Path $LogFile -Value $line
    if (-not $script:urlApplied -and $line -match $urlPattern) {
        $m = $urlPattern.Match($line)
        if ($m.Success) {
            $script:urlApplied = $true
            Set-RadioPublicUrl $m.Value
        }
    }
}

$proc.add_OutputDataReceived({ param($s, $e) & $handler $e.Data })
$proc.add_ErrorDataReceived({ param($s, $e) & $handler $e.Data })

$proc.Start() | Out-Null
$proc.BeginOutputReadLine()
$proc.BeginErrorReadLine()
$proc.WaitForExit()
exit $proc.ExitCode