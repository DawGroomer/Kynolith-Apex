param(
    [string]$PortableExe = "",
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot

if ($PortableExe) {
    if ([IO.Path]::IsPathRooted($PortableExe)) {
        $artifactPath = $PortableExe
    }
    else {
        $artifactPath = Join-Path $projectRoot $PortableExe
    }
}
else {
    $artifact = Get-ChildItem `
        -LiteralPath (Join-Path $projectRoot "release") `
        -Filter "Kynolith-Apex-LMU-Coach-*-portable.exe" `
        -File `
        -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $artifact) {
        throw "No portable Apex executable was found. Run pnpm dist:win first."
    }

    $artifactPath = $artifact.FullName
}

$artifactPath = [IO.Path]::GetFullPath($artifactPath)

if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
    throw "Portable Apex executable not found: $artifactPath"
}

Write-Host "Kynolith Apex packaged-runtime smoke"
Write-Host "Artifact: $artifactPath"

$beforePorts = @(
    Get-NetTCPConnection `
        -State Listen `
        -LocalAddress "127.0.0.1" `
        -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty LocalPort
)

$beforeBridgePids = @(
    Get-Process `
        -Name "Kynolith.LmuBridge" `
        -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Id
)

$launcher = $null
$success = $false
$detectedPort = $null
$state = $null

try {
    Write-Host ""
    Write-Host "Launching packaged Apex..."

    $launcher = Start-Process `
        -FilePath $artifactPath `
        -PassThru

    Write-Host "Launcher PID: $($launcher.Id)"
    Write-Host "Discovering dynamically assigned Apex server port..."

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline -and -not $success) {
        $currentPorts = @(
            Get-NetTCPConnection `
                -State Listen `
                -LocalAddress "127.0.0.1" `
                -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty LocalPort
        )

        $candidatePorts = @(
            $currentPorts |
            Where-Object { $beforePorts -notcontains $_ } |
            Sort-Object -Unique
        )

        foreach ($port in $candidatePorts) {
            try {
                $response = Invoke-RestMethod `
                    -Uri "http://127.0.0.1:$port/api/state" `
                    -Method Get `
                    -TimeoutSec 2

                $properties = @($response.PSObject.Properties.Name)

                if (
                    $properties -contains "source" -and
                    $properties -contains "connected"
                ) {
                    $success = $true
                    $detectedPort = $port
                    $state = $response
                    break
                }
            }
            catch {
                # Ignore unrelated localhost listeners.
            }
        }

        if (-not $success) {
            Start-Sleep -Seconds 1
        }
    }

    if (-not $success) {
        throw "Packaged Apex did not expose a valid /api/state endpoint within $TimeoutSeconds seconds."
    }

    Write-Host ""
    Write-Host "PACKAGED RUNTIME: PASS"
    Write-Host "Detected port: $detectedPort"
    Write-Host "State source: $($state.source)"
    Write-Host "Connected: $($state.connected)"

    $localStatus = Invoke-RestMethod `
        -Uri "http://127.0.0.1:$detectedPort/api/local/status" `
        -Method Get `
        -TimeoutSec 10

    Write-Host ""
    Write-Host "LOCAL MODEL STATUS:"
    $localStatus | Format-List

    if ($localStatus.speechRecognition -notmatch "bundled offline") {
        throw "Speech-recognition model is not using the bundled offline package."
    }

    if ($localStatus.coachModel -notmatch "bundled offline") {
        throw "Coach model is not using the bundled offline package."
    }

    if ($localStatus.speechOutput -notmatch "bundled offline") {
        throw "Speech-output model is not using the bundled offline package."
    }

    Write-Host ""
    Write-Host "OFFLINE MODEL BUNDLE: PASS"
}
finally {
    Write-Host ""
    Write-Host "Stopping packaged Apex..."

    $windowProcess = Get-Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.MainWindowTitle -eq "Kynolith Apex // LMU Coach"
        } |
        Select-Object -First 1

    if ($windowProcess) {
        [void]$windowProcess.CloseMainWindow()

        try {
            Wait-Process `
                -Id $windowProcess.Id `
                -Timeout 10 `
                -ErrorAction SilentlyContinue
        }
        catch {}
    }

    if ($launcher -and -not $launcher.HasExited) {
        try {
            & taskkill /PID $launcher.Id /T /F | Out-Null
        }
        catch {}
    }

    Start-Sleep -Seconds 2

    $remainingBridge = @(
        Get-Process `
            -Name "Kynolith.LmuBridge" `
            -ErrorAction SilentlyContinue |
        Where-Object {
            $beforeBridgePids -notcontains $_.Id
        }
    )

    foreach ($bridge in $remainingBridge) {
        Write-Warning "Cleaning up smoke-test bridge PID $($bridge.Id)"
        Stop-Process `
            -Id $bridge.Id `
            -Force `
            -ErrorAction SilentlyContinue
    }
}

if (-not $success) {
    exit 1
}

Write-Host ""
Write-Host "Kynolith Apex packaged-runtime smoke completed successfully."

exit 0
