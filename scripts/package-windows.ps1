$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$runId = [Guid]::NewGuid().ToString("N")
$packageRoot = [IO.Path]::GetFullPath((Join-Path $tempBase "Kynolith-Apex-Packaging-$runId"))
$releaseRoot = Join-Path $projectRoot "release"

if (-not $packageRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to package outside the Windows temporary directory: $packageRoot"
}

New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null

Push-Location $projectRoot
try {
  Write-Host "Validating packaging prerequisites before packaging..."
  & pnpm validate:packaging
  if ($LASTEXITCODE -ne 0) {
    throw "Packaging validation failed."
  }

  & pnpm exec electron-builder --win portable "--config.directories.output=$packageRoot"
  if ($LASTEXITCODE -ne 0) {
    throw "electron-builder failed with exit code $LASTEXITCODE"
  }

  $artifacts = @(Get-ChildItem -LiteralPath $packageRoot -Filter "Kynolith-Apex-LMU-Coach-*-portable.exe" -File)
  if ($artifacts.Count -ne 1) {
    throw "Expected one portable Apex executable, found $($artifacts.Count) in $packageRoot"
  }

  New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
  $destination = Join-Path $releaseRoot $artifacts[0].Name
  Copy-Item -LiteralPath $artifacts[0].FullName -Destination $destination -Force
  Write-Host "Portable build copied to $destination"
}
finally {
  Pop-Location
  if ((Test-Path -LiteralPath $packageRoot) -and $packageRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $packageRoot -Recurse -Force
  }
}
