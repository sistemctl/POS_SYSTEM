<#
  Configura el equipo para que PostgreSQL y las APIs del POS arranquen siempre con Windows,
  aunque el apagado anterior haya sido brusco. Se puede ejecutar varias veces sin problema.

  Ejecutar UNA VEZ como ADMINISTRADOR:
    powershell -ExecutionPolicy Bypass -File C:\POS\scripts\blindar-arranque.ps1

  Que hace:
   1. Sube el timeout de arranque del servicio PostgreSQL (pg_ctl -t) de 60 s a 300 s.
      Tras un apagado brusco, la recuperacion puede pasar de 60 s y Windows lo daba por fallido.
   2. Recuperacion ante fallos (services.msc > Recuperacion): reiniciar PostgreSQL y las APIs.
   3. WaitToKillServiceTimeout >= 15 s: da tiempo a PostgreSQL de apagarse limpio al reiniciar.
   4. Tarea programada "POS-Arranque": 3 min despues de iniciar Windows ejecuta
      arranque-servicios.ps1, que levanta lo que haya quedado abajo.
   5. Recupera el estado actual (ejecuta arranque-servicios.ps1 ahora).
#>
param(
  [int]$TimeoutPg = 300,
  [string[]]$Apis = @('POS-API-Central', 'POS-API-Store')
)
$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Ejecute este script en PowerShell como Administrador.'
}

$pg = Get-CimInstance Win32_Service -Filter "Name LIKE 'postgresql%'" | Select-Object -First 1
if (-not $pg) { throw 'No se encontro el servicio de PostgreSQL' }

# 1. Timeout de pg_ctl
$clave = "HKLM:\SYSTEM\CurrentControlSet\Services\$($pg.Name)"
$img = (Get-ItemProperty $clave).ImagePath
$nuevo = if ($img -match '\s-t\s+\d+') { $img -replace '\s-t\s+\d+', " -t $TimeoutPg" } else { "$img -t $TimeoutPg" }
if ($nuevo -ne $img) {
  Set-ItemProperty -Path $clave -Name ImagePath -Value $nuevo
  Write-Host "1. $($pg.Name): timeout de arranque $TimeoutPg s" -ForegroundColor Green
} else { Write-Host "1. $($pg.Name): timeout ya era $TimeoutPg s" -ForegroundColor Green }

# 2. Recuperacion ante fallos (reiniciar; contador se resetea cada 24 h)
sc.exe failure $pg.Name reset= 86400 actions= restart/30000/restart/60000/restart/120000 | Out-Null
foreach ($a in $Apis) {
  if (Get-Service $a -ErrorAction SilentlyContinue) {
    sc.exe failure $a reset= 86400 actions= restart/10000/restart/30000/restart/60000 | Out-Null
  }
}
Write-Host '2. Recuperacion ante fallos: reiniciar automaticamente' -ForegroundColor Green

# 3. Tiempo que Windows espera a los servicios al apagar
$ctl = 'HKLM:\SYSTEM\CurrentControlSet\Control'
$actual = [int](Get-ItemProperty $ctl).WaitToKillServiceTimeout
if ($actual -lt 15000) {
  Set-ItemProperty -Path $ctl -Name WaitToKillServiceTimeout -Value '15000'
  Write-Host "3. WaitToKillServiceTimeout: $actual ms -> 15000 ms" -ForegroundColor Green
} else { Write-Host "3. WaitToKillServiceTimeout ya es $actual ms" -ForegroundColor Green }

# 4. Tarea programada de verificacion al arrancar
$script = Join-Path $PSScriptRoot 'arranque-servicios.ps1'
$accion = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$disparador = New-ScheduledTaskTrigger -AtStartup
$disparador.Delay = 'PT3M'
$cuenta = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName 'POS-Arranque' -Action $accion -Trigger $disparador -Principal $cuenta -Settings $ajustes `
  -Description 'Verifica que PostgreSQL y las APIs del POS esten en ejecucion tras iniciar Windows' -Force | Out-Null
Write-Host '4. Tarea programada POS-Arranque registrada (3 min tras iniciar Windows)' -ForegroundColor Green

# 5. Recuperar ahora
Write-Host '5. Verificando servicios ahora...' -ForegroundColor Cyan
& $script -Apis $Apis
Write-Host ''
Get-Service -Name (@($pg.Name) + $Apis) -ErrorAction SilentlyContinue | Format-Table Name, Status, StartType -AutoSize
