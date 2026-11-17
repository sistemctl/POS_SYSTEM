<#
  Permite que un usuario de Windows (sin ser administrador) inicie, detenga y reinicie
  SOLO los servicios del POS (POS-API-Central y POS-API-Store). No da ningún otro permiso.

  Ejecutar UNA VEZ como ADMINISTRADOR:
    powershell -ExecutionPolicy Bypass -File C:\POS\scripts\permitir-reinicio-servicios.ps1
    powershell -ExecutionPolicy Bypass -File C:\POS\scripts\permitir-reinicio-servicios.ps1 -Usuario OTROEQUIPO\usuario
#>
param(
  [string]$Usuario = "$env:USERDOMAIN\$env:USERNAME",
  [string[]]$Servicios = @('POS-API-Central', 'POS-API-Store')
)
$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Ejecute este script en PowerShell como Administrador.'
}

$sid = (New-Object Security.Principal.NTAccount($Usuario)).Translate([Security.Principal.SecurityIdentifier]).Value
# RP=iniciar, WP=detener, DT=pausar, LO=consultar estado, CR=control, RC=leer permisos
$ace = "(A;;RPWPDTLOCRRC;;;$sid)"

foreach ($s in $Servicios) {
  if (-not (Get-Service $s -ErrorAction SilentlyContinue)) { Write-Host "  $s no existe, se omite" -ForegroundColor Yellow; continue }
  $sddl = (& sc.exe sdshow $s | Where-Object { $_ -match '^D:' }).Trim()
  if ($sddl.Contains($ace)) { Write-Host "  $s ya tenía el permiso" -ForegroundColor Green; continue }
  # La entrada nueva va dentro de la lista D: (antes de la parte S: de auditoría, si existe)
  $i = $sddl.IndexOf('S:')
  $nuevo = if ($i -ge 0) { $sddl.Substring(0, $i) + $ace + $sddl.Substring($i) } else { $sddl + $ace }
  & sc.exe sdset $s $nuevo | Out-Null
  if ($LASTEXITCODE) { throw "No se pudo cambiar el permiso de $s" }
  Write-Host "  $s : $Usuario ya puede iniciarlo/detenerlo/reiniciarlo" -ForegroundColor Green
}
