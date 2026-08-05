param(
    [string]$PortableExe = "release\Kynolith-Apex-LMU-Coach-0.1.0-portable.exe",
    [int]$TimeoutSeconds = 20
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$exePath = Join-Path $projectRoot $PortableExe
if (-not (Test-Path -LiteralPath $exePath)) {
    throw "Portable executable not found at $exePath. Build it first with pnpm dist:win."
}

Write-Host "Launching portable app for smoke test: $exePath"
$process = Start-Process -FilePath $exePath -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 5

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$success = $false
while ((Get-Date) -lt $deadline) {
    try {
        $response = Invoke-WebRequest -Uri http://127.0.0.1:4377/api/state -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            Write-Host "Smoke test passed: app responded on /api/state."
            $success = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 1
    }
}

if (-not $success) {
    throw "Smoke test failed: portable app did not respond on /api/state within $TimeoutSeconds seconds."
}

Write-Host "Stopping portable app."
if (!$process.HasExited) {
    $process.Kill()
    $process.WaitForExit()
}
