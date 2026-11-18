<#
  Instala y activa el servidor OpenSSH de Windows para entrar a este equipo de forma remota.
  Ejecutar como ADMINISTRADOR:
    powershell -ExecutionPolicy Bypass -File C:\POS\scripts\instalar-ssh.ps1
#>
$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Ejecute este script en PowerShell como Administrador.'
}

function Paso($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

Paso 'Instalando cliente y servidor OpenSSH'
foreach ($nombre in 'OpenSSH.Client~~~~0.0.1.0', 'OpenSSH.Server~~~~0.0.1.0') {
  $cap = Get-WindowsCapability -Online -Name $nombre
  if ($cap.State -eq 'Installed') { Write-Host "  $nombre ya estaba instalado" }
  else { Add-WindowsCapability -Online -Name $nombre | Out-Null; Write-Host "  $nombre instalado" }
}

Paso 'Arrancando el servicio sshd (y que inicie solo con Windows)'
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
Set-Service -Name ssh-agent -StartupType Automatic -ErrorAction SilentlyContinue
Start-Service ssh-agent -ErrorAction SilentlyContinue

Paso 'Abriendo el puerto 22 en el firewall'
if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
}
Enable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP'

Paso 'Usar PowerShell como consola al entrar por SSH'
New-Item -Path 'HKLM:\SOFTWARE\OpenSSH' -Force | Out-Null
New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell -Value 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -PropertyType String -Force | Out-Null

Paso 'Listo'
Get-Service sshd, ssh-agent | Format-Table Name, Status, StartType
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress
Write-Host "Conéctese desde otro equipo con:" -ForegroundColor Green
foreach ($ip in $ips) { Write-Host "  ssh $env:USERNAME@$ip" -ForegroundColor Green }
Write-Host "(use la contraseña de Windows del usuario $env:USERNAME)"
