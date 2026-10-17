$rescuePython = Join-Path $PSScriptRoot 'runtime/python.exe'
if (-not (Test-Path -LiteralPath $rescuePython)) {
    $rescuePython = (Get-Command python -ErrorAction Stop).Source
}
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'Live SITL monitor: http://127.0.0.1:8765'
& $rescuePython (Join-Path $PSScriptRoot 'monitor.py')
