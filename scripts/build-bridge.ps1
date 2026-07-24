$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dotnet = Join-Path $root '.tools\dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $dotnet)) {
    $systemDotnet = Get-Command dotnet -ErrorAction SilentlyContinue
    if (-not $systemDotnet) { throw "Neither project-local nor system .NET SDK is available" }
    $dotnet = $systemDotnet.Source
}
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
& $dotnet publish (Join-Path $root 'bridge\Kynolith.LmuBridge.csproj') -c Release -o (Join-Path $root 'bridge\publish')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $root 'bridge\publish\Kynolith.LmuBridge.exe') --self-test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
