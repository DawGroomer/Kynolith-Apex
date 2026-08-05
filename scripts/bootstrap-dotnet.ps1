param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$toolRoot = Join-Path $ProjectRoot '.tools\dotnet'
$dotnetExe = Join-Path $toolRoot 'dotnet.exe'

if (-not (Test-Path -LiteralPath $toolRoot)) {
    New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
}

$globalDotnet = Get-Command dotnet -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
$hasSdk = $false
if ($globalDotnet) {
    $dotnetInfo = & "$globalDotnet" --list-sdks 2>$null
    if ($dotnetInfo) { $hasSdk = $true }
}

if (-not $hasSdk) {
    Write-Host 'No .NET SDK was found globally. Installing .NET 9.0 SDK locally using dotnet-install.ps1...'
    $installScript = Join-Path $env:TEMP 'dotnet-install.ps1'
    Invoke-WebRequest -Uri 'https://dot.net/v1/dotnet-install.ps1' -OutFile $installScript -UseBasicParsing
    & powershell -NoProfile -ExecutionPolicy Bypass -File $installScript -Channel 9.0 -InstallDir $toolRoot -NoPath
    if ($LASTEXITCODE -ne 0) {
        throw "Local .NET SDK installation failed with exit code $LASTEXITCODE."
    }
}
else {
    Write-Host 'Global .NET SDK found. Copying SDK runtime files locally.'
    $globalRoot = Split-Path -Parent $globalDotnet
    Copy-Item -Path (Join-Path $globalRoot '*') -Destination $toolRoot -Recurse -Force
}

if (-not (Test-Path -LiteralPath $dotnetExe)) {
    throw "Failed to bootstrap local dotnet executable at $dotnetExe"
}

Write-Host "Local .NET SDK bootstrapped to $dotnetExe"
Write-Host "You can now run pnpm build:bridge or pnpm validate:packaging."
