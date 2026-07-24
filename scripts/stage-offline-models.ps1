param(
    [string]$CacheRoot = ".model-smoke-cache\huggingface",
    [string]$Destination = "offline-models"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $CacheRoot))
$destinationRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $Destination))
$models = @(
    "onnx-community\whisper-tiny.en",
    "onnx-community\Qwen3-0.6B-ONNX",
    "onnx-community\Kokoro-82M-v1.0-ONNX"
)

foreach ($model in $models) {
    $source = Join-Path $sourceRoot $model
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        throw "Required model is not present in the local cache: $source"
    }
}

New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null
foreach ($model in $models) {
    $source = Join-Path $sourceRoot $model
    $target = [System.IO.Path]::GetFullPath((Join-Path $destinationRoot $model))
    if (-not $target.StartsWith($destinationRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to stage outside the offline model directory: $target"
    }
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
}

Write-Host "Apex offline model bundle staged at $destinationRoot"
