param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$ModelCache = ".model-smoke-cache\huggingface"
)

$ErrorActionPreference = 'Stop'
$dotnet = Join-Path $ProjectRoot '.tools\dotnet\dotnet.exe'
$bridgeExe = Join-Path $ProjectRoot 'bridge\publish\Kynolith.LmuBridge.exe'
$serverJs = Join-Path $ProjectRoot 'dist\server.js'
$offlineModels = Join-Path $ProjectRoot 'offline-models'
$requiredModelFiles = @(
    'onnx-community\whisper-tiny.en\config.json',
    'onnx-community\whisper-tiny.en\onnx\encoder_model_quantized.onnx',
    'onnx-community\whisper-tiny.en\onnx\decoder_model_merged_quantized.onnx',
    'onnx-community\Qwen3-0.6B-ONNX\config.json',
    'onnx-community\Qwen3-0.6B-ONNX\onnx\model_q4.onnx',
    'onnx-community\Kokoro-82M-v1.0-ONNX\config.json',
    'onnx-community\Kokoro-82M-v1.0-ONNX\onnx\model_quantized.onnx',
    'onnx-community\Kokoro-82M-v1.0-ONNX\voices\af_heart.bin'
)

Write-Host 'Validating packaging prerequisites...'

if (-not (Test-Path -LiteralPath $dotnet)) {
    throw "Local .NET SDK not found at $dotnet. Run scripts/build-bridge.ps1 after installing the project-local .NET runtime."
}

if (-not (Test-Path -LiteralPath $bridgeExe)) {
    throw "Bridge executable not found at $bridgeExe. Run pnpm build:bridge first."
}

if (-not (Test-Path -LiteralPath $serverJs)) {
    throw "Compiled server file not found at $serverJs. Run pnpm build first."
}

if (-not (Test-Path -LiteralPath $offlineModels)) {
    throw "Offline model bundle not found at $offlineModels. Run pnpm models:stage after preparing the model cache."
}

foreach ($relative in $requiredModelFiles) {
    $file = Join-Path $offlineModels $relative
    if (-not (Test-Path -LiteralPath $file)) {
        throw "Offline model asset missing: $file. Stage the model bundle with pnpm models:stage."
    }
}

$packageJsonPath = Join-Path $ProjectRoot 'package.json'
$package = Get-Content -Raw -Path $packageJsonPath | ConvertFrom-Json
$filePatterns = $package.build.files
$expectedFiles = @('dist/**/*', 'public/**/*', 'electron/**/*', 'package.json', 'THIRD_PARTY_NOTICES.md')
foreach ($pattern in $expectedFiles) {
    if (-not ($filePatterns -contains $pattern)) {
        throw "package.json build.files is missing required pattern: $pattern"
    }
}

if (-not ($filePatterns -contains 'node_modules/**/*')) {
    Write-Warning 'package.json build.files does not explicitly include node_modules/**/*; verify that dependencies are correctly bundled by electron-builder.'
}

Write-Host 'Packaging validation completed successfully.'
