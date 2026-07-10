$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $project
& npm.cmd run refresh *>> (Join-Path $project 'daily-refresh.log')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
