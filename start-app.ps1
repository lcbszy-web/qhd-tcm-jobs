$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$portInUse = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue
if ($portInUse) { exit 0 }
Set-Location $project
& node.exe src/server.js *>> (Join-Path $project 'server.log')
