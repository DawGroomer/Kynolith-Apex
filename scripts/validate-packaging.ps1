param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

$root = [IO.Path]::GetFullPath($ProjectRoot)

Write-Host "Validating Kynolith Apex packaging prerequisites..."

# ------------------------------------------------------------
# .NET SDK
# Academy supports either project-local or system .NET.
# ------------------------------------------------------------

$localDotnet = Join-Path $root ".tools\dotnet\dotnet.exe"
$dotnetExe = $null

if (Test-Path -LiteralPath $localDotnet -PathType Leaf) {
    $dotnetExe = $localDotnet
    Write-Host "Using project-local .NET: $dotnetExe"
}
else {
    $systemDotnet = Get-Command dotnet -ErrorAction SilentlyContinue

    if ($systemDotnet) {
        $dotnetExe = $systemDotnet.Source
        Write-Host "Using system .NET: $dotnetExe"
    }
}

if (-not $dotnetExe) {
    throw "No usable .NET SDK was found. Install .NET or bootstrap the project-local SDK before packaging."
}

$sdkList = @(& $dotnetExe --list-sdks 2>$null)

if ($LASTEXITCODE -ne 0 -or $sdkList.Count -eq 0) {
    throw "dotnet is present but no usable SDK was detected."
}

Write-Host "Detected .NET SDK:"
$sdkList | ForEach-Object { Write-Host "  $_" }

# ------------------------------------------------------------
# Compiled/runtime artifacts
# ------------------------------------------------------------

$requiredArtifacts = @(
    "bridge\publish\Kynolith.LmuBridge.exe",
    "dist\server.js",
    "dist\main.js",
    "THIRD_PARTY_NOTICES.md"
)

foreach ($relative in $requiredArtifacts) {
    $file = Join-Path $root $relative

    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Required packaging artifact is missing: $file"
    }

    Write-Host "OK: $relative"
}

# ------------------------------------------------------------
# Offline model bundle
# Keep this synchronized with LocalAi.hasCompleteBundle().
# ------------------------------------------------------------

$offlineModels = Join-Path $root "offline-models"

if (-not (Test-Path -LiteralPath $offlineModels -PathType Container)) {
    throw "Offline model bundle is missing at $offlineModels. Run pnpm models:stage first."
}

$requiredModelFiles = @(
    "onnx-community\whisper-tiny.en\config.json",
    "onnx-community\whisper-tiny.en\onnx\encoder_model_quantized.onnx",
    "onnx-community\whisper-tiny.en\onnx\decoder_model_merged_quantized.onnx",
    "onnx-community\Qwen3-0.6B-ONNX\config.json",
    "onnx-community\Qwen3-0.6B-ONNX\onnx\model_q4.onnx",
    "onnx-community\Kokoro-82M-v1.0-ONNX\config.json",
    "onnx-community\Kokoro-82M-v1.0-ONNX\onnx\model_quantized.onnx",
    "onnx-community\Kokoro-82M-v1.0-ONNX\voices\af_heart.bin"
)

foreach ($relative in $requiredModelFiles) {
    $file = Join-Path $offlineModels $relative

    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Offline model asset is missing: $file"
    }

    Write-Host "MODEL OK: $relative"
}

# ------------------------------------------------------------
# electron-builder contract
# ------------------------------------------------------------

$packageJsonPath = Join-Path $root "package.json"

if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf)) {
    throw "package.json was not found."
}

$package = Get-Content -Raw -LiteralPath $packageJsonPath | ConvertFrom-Json

$expectedFiles = @(
    "dist/**/*",
    "public/**/*",
    "electron/**/*",
    "package.json",
    "THIRD_PARTY_NOTICES.md"
)

$filePatterns = @($package.build.files)

foreach ($pattern in $expectedFiles) {
    if (-not ($filePatterns -contains $pattern)) {
        throw "package.json build.files is missing required pattern: $pattern"
    }
}

$resources = @($package.build.extraResources)

$bridgeResource = $resources | Where-Object {
    $_.from -eq "bridge/publish/Kynolith.LmuBridge.exe" -and
    $_.to -eq "bridge/Kynolith.LmuBridge.exe"
}

if (-not $bridgeResource) {
    throw "package.json extraResources is missing the LMU bridge mapping."
}

$modelResource = $resources | Where-Object {
    $_.from -eq "offline-models" -and
    $_.to -eq "models"
}

if (-not $modelResource) {
    throw "package.json extraResources is missing the offline model bundle mapping."
}

if ($package.build.appId -ne "com.kynolith.apex.lmucoach") {
    throw "Unexpected electron-builder appId: $($package.build.appId)"
}

Write-Host ""
Write-Host "Packaging validation completed successfully."
