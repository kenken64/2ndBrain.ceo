param([int]$Port = 3000)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$version = '26.12.1'
$toolsDir = Join-Path $projectRoot '.tools'
$nodeDir = Join-Path $toolsDir "node-v$version-win-x64"
$nodeExe = Join-Path $nodeDir 'node.exe'
if (-not (Test-Path -LiteralPath $nodeExe)) {
  New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
  $archive = Join-Path $toolsDir "node-v$version-win-x64.zip"
  $checksums = Join-Path $toolsDir "node-v$version-SHASUMS256.txt"
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v$version/node-v$version-win-x64.zip" -OutFile $archive
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v$version/SHASUMS256.txt" -OutFile $checksums
  $escapedVersion = [regex]::Escape($version)
  $expected = ((Get-Content -LiteralPath $checksums | Where-Object { $_ -match "  node-v$escapedVersion-win-x64\.zip$" }) -split '\s+')[0]
  if (-not $expected -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) {
    throw 'Node.js download checksum verification failed.'
  }
  Expand-Archive -LiteralPath $archive -DestinationPath $toolsDir
}
$env:PATH = "$nodeDir;$env:PATH"
$env:HOSTNAME = '127.0.0.1'
$env:PORT = "$Port"
if (-not $env:INSTANCE_REAPER_ENABLED) { $env:INSTANCE_REAPER_ENABLED = 'false' }
if (-not $env:TOKEN_USAGE_CONSUMER_ENABLED) { $env:TOKEN_USAGE_CONSUMER_ENABLED = 'false' }
Push-Location $projectRoot
try {
  $duckdbPackage = Join-Path $projectRoot 'node_modules\@duckdb\duckdb-wasm\package.json'
  if (-not (Test-Path -LiteralPath $duckdbPackage)) {
    & (Join-Path $nodeDir 'npm.cmd') ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  }
  & $nodeExe 'scripts/prepare-duckdb.cjs'
  if ($LASTEXITCODE -ne 0) { throw 'Preparing browser assets failed.' }
  & $nodeExe 'server/custom-server.js'
} finally { Pop-Location }
