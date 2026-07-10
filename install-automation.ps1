$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$dailyScript = Join-Path $project 'run-daily.ps1'
$serverScript = Join-Path $project 'start-app.ps1'

$dailyAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dailyScript`""
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At '07:30'
$dailySettings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName 'QHD TCM Jobs Daily Refresh' -Action $dailyAction -Trigger $dailyTrigger -Settings $dailySettings -Description 'Daily refresh for Qinhuangdao TCM jobs' -Force | Out-Null

$serverAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$serverScript`""
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$serverTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$serverSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName 'QHD TCM Jobs Web Server' -Action $serverAction -Trigger $serverTrigger -Settings $serverSettings -Description 'Start local Qinhuangdao TCM jobs web app at logon' -Force | Out-Null

Write-Host 'Automation installed: daily refresh at 07:30 and web server at logon.'
