$ErrorActionPreference = 'Stop'
$gfxBundler = Join-Path $PSScriptRoot 'esbuild.exe'
if (-not (Test-Path -LiteralPath $gfxBundler)) { throw 'Pinned esbuild 0.28.2 is missing from graphics-source.' }
Push-Location $PSScriptRoot
try {
    & $gfxBundler renderer.js --bundle --format=iife --target=es2020 --minify --legal-comments=inline --alias:three=./three.module.js --outfile=../scene.js
    if ($LASTEXITCODE -ne 0) { throw 'Graphics compilation failed.' }
} finally { Pop-Location }
