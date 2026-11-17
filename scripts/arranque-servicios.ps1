<#
  Asegura que PostgreSQL y las APIs del POS queden arriba despues de iniciar Windows.
  Lo ejecuta la tarea programada "POS-Arranque" (como SYSTEM, 3 min despues del arranque).
  Tambien sirve a mano, como ADMINISTRADOR, para recuperar el sistema:
    powershell -ExecutionPolicy Bypass -File C:\POS\scripts\arranque-servicios.ps1

  Casos que resuelve:
   - PostgreSQL tardo mas que el timeout del servicio: Windows lo marca "detenido" pero el
     proceso sigue vivo (postmaster huerfano). Se detiene limpio con pg_ctl y se arranca como servicio.
   - postmaster.pid viejo cuyo PID ahora es de otro proceso: se elimina.
   - APIs que no arrancaron porque su dependencia (PostgreSQL) fallo: se inician.
  Registro: C:\POS-logs\arranque.log
#>
param([string[]]$Apis = @('POS-API-Central', 'POS-API-Store'))
$ErrorActionPreference = 'Continue'
$Log = 'C:\POS-logs\arranque.log'
New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null
function Log($m) {
  $l = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $m
  Add-Content -Path $Log -Value $l -Encoding UTF8
  Write-Host $l
}
function Esperar-Estado($nombre, $estado, $segundos) {
  $fin = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $fin) {
    if ((Get-Service $nombre).Status -eq $estado) { return $true }
    Start-Sleep -Seconds 3
  }
  return $false
}

Log '--- Verificacion de arranque ---'
$pg = Get-CimInstance Win32_Service -Filter "Name LIKE 'postgresql%'" | Select-Object -First 1
if (-not $pg) { Log 'ERROR: no existe servicio PostgreSQL'; exit 1 }

$pgCtl = if ($pg.PathName -match '^"([^"]+)"') { $Matches[1] } else { ($pg.PathName -split ' ')[0] }
$data  = if ($pg.PathName -match '-D\s+"([^"]+)"') { $Matches[1] } else { $null }

# Si sigue arrancando (recuperacion tras apagado brusco), esperar
if ((Get-Service $pg.Name).Status -eq 'StartPending') {
  Log "$($pg.Name) arrancando; esperando..."
  [void](Esperar-Estado $pg.Name 'Running' 600)
}

if ((Get-Service $pg.Name).Status -ne 'Running') {
  Log "$($pg.Name) esta $((Get-Service $pg.Name).Status)"
  $pidFile = if ($data) { Join-Path $data 'postmaster.pid' } else { $null }
  if ($pidFile -and (Test-Path $pidFile)) {
    $pidPg = [int]((Get-Content $pidFile -TotalCount 1).Trim())
    $proc = Get-Process -Id $pidPg -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'postgres') {
      Log "postmaster huerfano (PID $pidPg); deteniendolo limpio con pg_ctl"
      & $pgCtl stop -D $data -m fast -w -t 120 | Out-Null
      if (Get-Process -Id $pidPg -ErrorAction SilentlyContinue) {
        Log 'pg_ctl no lo detuvo; forzando cierre'
        Stop-Process -Id $pidPg -Force
        Start-Sleep -Seconds 5
      }
    } else {
      Log "postmaster.pid viejo (PID $pidPg ya no es postgres); eliminandolo"
      Remove-Item $pidFile -Force
    }
  }
  Log "Iniciando $($pg.Name)..."
  try { Start-Service $pg.Name -ErrorAction Stop } catch { Log "Start-Service: $($_.Exception.Message)" }
  if (-not (Esperar-Estado $pg.Name 'Running' 600)) { Log "ERROR: $($pg.Name) no quedo en ejecucion"; exit 1 }
}
Log "$($pg.Name) en ejecucion"

foreach ($a in $Apis) {
  $s = Get-CimInstance Win32_Service -Filter "Name='$a'"
  if (-not $s) { continue }
  if ($s.StartMode -ne 'Auto') { Log "$a esta en modo $($s.StartMode); no se toca"; continue }
  if ($s.State -eq 'Running') { Log "$a ya en ejecucion"; continue }
  Log "Iniciando $a..."
  try { Start-Service $a -ErrorAction Stop } catch { Log "Start-Service: $($_.Exception.Message)" }
  if (Esperar-Estado $a 'Running' 60) { Log "$a en ejecucion" } else { Log "ERROR: $a no arranco (ver C:\POS-logs\$a.error.log)" }
}
