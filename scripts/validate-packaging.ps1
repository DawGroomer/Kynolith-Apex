param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

$root = [IO.Path]::GetFullPath($ProjectRoot)

function Get-Sha256Hex {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $sha256 = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)

    try {
        return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $stream.Dispose()
        $sha256.Dispose()
    }
}

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
# Keep this synchronized with the runtime manifest consumed by LocalAi.
# ------------------------------------------------------------

$offlineModels = Join-Path $root "offline-models"

if (-not (Test-Path -LiteralPath $offlineModels -PathType Container)) {
    throw "Offline model bundle is missing at $offlineModels. Run pnpm models:stage first."
}

$manifestPath = Join-Path $root "config\bundled-model-manifest.json"

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Bundled model manifest is missing: $manifestPath"
}

try {
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
}
catch {
    throw "Bundled model manifest is not valid JSON: $manifestPath"
}

if ($manifest.version -ne 1 -or -not $manifest.files) {
    throw "Bundled model manifest has an invalid schema: $manifestPath"
}

$manifestEntries = @($manifest.files.PSObject.Properties)

if ($manifestEntries.Count -eq 0) {
    throw "Bundled model manifest contains no assets: $manifestPath"
}

$offlineModelsRoot = $offlineModels.TrimEnd('\') + '\'
foreach ($entry in $manifestEntries) {
    $relative = [string]$entry.Name
    $expected = ([string]$entry.Value).ToLowerInvariant()

    if (
        [IO.Path]::IsPathRooted($relative) -or
        $relative.Contains('\') -or
        $relative -match '(^|/)\.\.?(/|$)' -or
        $expected -notmatch '^[0-9a-f]{64}$'
    ) {
        throw "Bundled model manifest has an invalid asset entry: $relative"
    }

    $file = [IO.Path]::GetFullPath((Join-Path $offlineModels ($relative -replace '/', '\')))

    if (-not $file.StartsWith($offlineModelsRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Bundled model asset escapes its root: $relative"
    }

    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Offline model asset is missing: $relative"
    }

    $actual = Get-Sha256Hex -Path $file

    if ($actual -ne $expected) {
        throw "Offline model asset hash mismatch: $relative (expected $expected, got $actual)"
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
    "config/**/*",
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
