$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dotnet = Join-Path $root '.tools\dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $dotnet)) {
    throw "Project-local .NET SDK not found at $dotnet"
}
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
& $dotnet publish (Join-Path $root 'bridge\Kynolith.LmuBridge.csproj') -c Release -o (Join-Path $root 'bridge\publish')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $root 'bridge\publish\Kynolith.LmuBridge.exe') --self-test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
