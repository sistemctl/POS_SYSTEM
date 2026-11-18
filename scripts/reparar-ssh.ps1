<#
  Repara el servidor SSH cuando el servicio sshd no arranca ("no respondió a tiempo").
  Genera las llaves del servidor, corrige permisos y vuelve a intentar.
  Ejecutar como ADMINISTRADOR:
    powershell -ExecutionPolicy Bypass -File C:\POS\scripts\reparar-ssh.ps1
#>
$ErrorActionPreference = 'Continue'

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Ejecute este script en PowerShell como Administrador.'
}

function Paso($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
$Dir = 'C:\ProgramData\ssh'
$Bin = 'C:\Windows\System32\OpenSSH'

Paso 'Deteniendo sshd'
Stop-Service sshd -Force -ErrorAction SilentlyContinue
Get-Process sshd -ErrorAction SilentlyContinue | Stop-Process -Force

Paso "Contenido de $Dir"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Get-ChildItem $Dir | Format-Table Name, Length, LastWriteTime

Paso 'Generando llaves del servidor (si faltan)'
Push-Location $Dir
# ssh-keygen -A crea las llaves en .\__PROGRAMDATA__\ssh; se generan directo para evitar ese problema.
foreach ($tipo in 'rsa', 'ecdsa', 'ed25519') {
  $f = Join-Path $Dir "ssh_host_${tipo}_key"
  if (-not (Test-Path $f)) {
    & "$Bin\ssh-keygen.exe" -q -t $tipo -f $f -N '""'
    if (-not (Test-Path $f)) { & "$Bin\ssh-keygen.exe" -q -t $tipo -f $f -N '' }
    Write-Host "  creada $f"
  } else { Write-Host "  ya existe $f" }
}
Pop-Location

Paso 'Corrigiendo permisos de las llaves (solo SYSTEM y Administradores)'
Get-ChildItem $Dir -Filter 'ssh_host_*_key' | ForEach-Object {
  icacls $_.FullName /inheritance:r /grant 'SYSTEM:F' /grant '*S-1-5-32-544:F' | Out-Null
  Write-Host "  $($_.Name)"
}
icacls $Dir /grant 'SYSTEM:(OI)(CI)F' /grant '*S-1-5-32-544:(OI)(CI)F' | Out-Null

Paso 'Revisando la configuración'
& "$Bin\sshd.exe" -t
if ($LASTEXITCODE) { Write-Host '  La configuración tiene errores (ver arriba).' -ForegroundColor Red } else { Write-Host '  Configuración OK' -ForegroundColor Green }

Paso 'Arrancando sshd'
try {
  Start-Service sshd -ErrorAction Stop
} catch {
  Write-Host "  No arrancó: $($_.Exception.Message)" -ForegroundColor Red
  Paso 'Diagnóstico: sshd en modo depuración (5 segundos)'
  $log = Join-Path $env:TEMP 'sshd-debug.txt'
  $p = Start-Process "$Bin\sshd.exe" -ArgumentList '-d', '-p', '2222' -RedirectStandardError $log -PassThru -NoNewWindow
  Start-Sleep -Seconds 5
  if (-not $p.HasExited) { Stop-Process $p -Force }
  Get-Content $log -Tail 40
}

Paso 'Firewall puerto 22'
if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
}
Enable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP'

Paso 'PowerShell como consola SSH'
New-Item -Path 'HKLM:\SOFTWARE\OpenSSH' -Force | Out-Null
New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -PropertyType String -Force | Out-Null

Paso 'Estado final'
Get-Service sshd | Format-Table Name, Status, StartType
if ((Get-Service sshd).Status -eq 'Running') {
  $ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress
  Write-Host 'Conéctese desde otro equipo con:' -ForegroundColor Green
  foreach ($ip in $ips) { Write-Host "  ssh $env:USERNAME@$ip" -ForegroundColor Green }
}
