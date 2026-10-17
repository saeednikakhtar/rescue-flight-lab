param([switch]$StartFlight)
$ErrorActionPreference = 'Stop'
$rescueLauncher = Join-Path $PSScriptRoot $(if ($StartFlight) { 'RESCUE-Flight-Lab.exe' } else { 'QGC-Manual-Ground.exe' })
if (-not (Test-Path -LiteralPath $rescueLauncher)) { throw 'Extract the complete RESCUE package before starting.' }
Start-Process -FilePath $rescueLauncher -WorkingDirectory $PSScriptRoot -Wait
