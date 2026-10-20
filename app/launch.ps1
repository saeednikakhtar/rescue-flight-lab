$rescuePython = Join-Path $PSScriptRoot 'runtime/python.exe'
if (-not (Test-Path -LiteralPath $rescuePython)) {
    & (Join-Path $PSScriptRoot 'RESCUE-Flight-Lab.exe')
    exit $LASTEXITCODE
}
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'Live SITL monitor: http://127.0.0.1:8765'
& $rescuePython (Join-Path $PSScriptRoot 'monitor.py')
