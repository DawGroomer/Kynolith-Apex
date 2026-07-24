$ErrorActionPreference = 'Stop'
$lmu = 'C:\Program Files (x86)\Steam\steamapps\common\Le Mans Ultimate'
$sdk = Join-Path $lmu 'Support\SharedMemoryInterface'
if (-not (Test-Path -LiteralPath $sdk)) { throw "LMU SDK headers not found at $sdk" }
cmake -S native -B native/build -DLMU_SDK_DIR="$sdk"
cmake --build native/build --config Release
