<#
  Actualiza el servidor POS después de cambios en el código: detiene los servicios, regenera Prisma,
  aplica migraciones de base de datos, compila API y web, y vuelve a arrancar los servicios.

  Ejecutar como ADMINISTRADOR:
    powershell -ExecutionPolicy Bypass -File C:\POS\scripts\actualizar-servidor.ps1
    powershell -ExecutionPolicy Bypass -File C:\POS\scripts\actualizar-servidor.ps1 -Modo store   # solo tienda
#>
param(
  [ValidateSet('ambos', 'central', 'store')] [string]$Modo = 'ambos'
)
$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Ejecute este script en PowerShell como Administrador.'
}

$Raiz   = Split-Path -Parent $PSScriptRoot
$ApiDir = Join-Path $Raiz 'apps\api'
$servicios = @()
if ($Modo -in 'ambos', 'central') { $servicios += @{ Nombre = 'POS-API-Central'; Env = '.env.central' } }
if ($Modo -in 'ambos', 'store')   { $servicios += @{ Nombre = 'POS-API-Store';   Env = '.env.store' } }

function Paso($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Ejecutar([string]$desc, [scriptblock]$cmd) {
  & $cmd
  if ($LASTEXITCODE) { throw "Falló: $desc (código $LASTEXITCODE)" }
}

Paso 'Deteniendo servicios'
foreach ($s in $servicios) {
  if (Get-Service $s.Nombre -ErrorAction SilentlyContinue) { Stop-Service $s.Nombre -Force; Write-Host "  $($s.Nombre) detenido" }
}
Start-Sleep -Seconds 2

try {
  Push-Location $ApiDir
  Paso 'Generando cliente Prisma'
  Ejecutar 'prisma generate' { pnpm exec prisma generate }

  foreach ($s in $servicios) {
    Paso "Migraciones de base de datos ($($s.Env))"
    Ejecutar "migrate deploy $($s.Env)" { pnpm exec dotenv -e $s.Env -- prisma migrate deploy }
  }
  Pop-Location

  Paso 'Compilando API y web'
  Push-Location $Raiz
  Ejecutar 'build' { pnpm turbo run build --filter=@pos/api --filter=@pos/web }
  Pop-Location
}
finally {
  Paso 'Arrancando servicios'
  foreach ($s in $servicios) {
    if (Get-Service $s.Nombre -ErrorAction SilentlyContinue) {
      Start-Service $s.Nombre
      Start-Sleep -Seconds 3
      $estado = (Get-Service $s.Nombre).Status
      Write-Host ("  {0,-16} {1}" -f $s.Nombre, $estado) -ForegroundColor ($(if ($estado -eq 'Running') { 'Green' } else { 'Red' }))
    }
  }
}

Write-Host "`nServidor actualizado. Registros en C:\POS-logs" -ForegroundColor Green
