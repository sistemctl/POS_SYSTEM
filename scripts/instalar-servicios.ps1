<#
  Instala la API del POS como servicios de Windows con NSSM (arrancan solos con el equipo).

  Ejecutar como ADMINISTRADOR:
    powershell -ExecutionPolicy Bypass -File C:\POS\scripts\instalar-servicios.ps1                 # central + tienda
    powershell -ExecutionPolicy Bypass -File C:\POS\scripts\instalar-servicios.ps1 -Modo central   # solo oficina
    powershell -ExecutionPolicy Bypass -File C:\POS\scripts\instalar-servicios.ps1 -Modo store     # solo tienda
    powershell -ExecutionPolicy Bypass -File C:\POS\scripts\instalar-servicios.ps1 -Desinstalar

  Servicios: POS-API-Central (:3000) y POS-API-Store (:3001). Cada uno sirve también la web compilada
  (http://<equipo>:3000 y http://<equipo>:3001). Registros en C:\POS-logs.
#>
param(
  [ValidateSet('ambos', 'central', 'store')] [string]$Modo = 'ambos',
  [string]$NssmPath = '',
  [switch]$Compilar,
  [switch]$Desinstalar
)
$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Ejecute este script en PowerShell como Administrador.'
}

$Raiz    = Split-Path -Parent $PSScriptRoot
$ApiDir  = Join-Path $Raiz 'apps\api'
$WebDist = Join-Path $Raiz 'apps\web\dist'
$Logs    = 'C:\POS-logs'
$Node    = (Get-Command node -ErrorAction Stop).Source
$PgServicio = (Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1).Name

$definiciones = @(
  @{ Modo = 'central'; Nombre = 'POS-API-Central'; Env = '.env.central'; Titulo = 'POS - API central (oficina)' },
  @{ Modo = 'store';   Nombre = 'POS-API-Store';   Env = '.env.store';   Titulo = 'POS - API de tienda' }
) | Where-Object { $Modo -eq 'ambos' -or $_.Modo -eq $Modo }

# ---------- NSSM ----------
function Obtener-Nssm {
  if ($NssmPath -and (Test-Path $NssmPath)) { return $NssmPath }
  $local = Join-Path $Raiz 'tools\nssm\nssm.exe'
  if (Test-Path $local) { return $local }
  $enPath = (Get-Command nssm -ErrorAction SilentlyContinue).Source
  if ($enPath) { return $enPath }

  Write-Host 'NSSM no encontrado; descargando nssm 2.24...' -ForegroundColor Yellow
  $tmp = Join-Path $env:TEMP ("nssm-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'nssm.zip'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  try {
    Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $zip -UseBasicParsing
  } catch {
    throw "No se pudo descargar NSSM ($($_.Exception.Message)). Descárguelo de https://nssm.cc/download, copie win64\nssm.exe a $local y vuelva a ejecutar."
  }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $exe = Get-ChildItem $tmp -Recurse -Filter nssm.exe | Where-Object { $_.FullName -match 'win64' } | Select-Object -First 1
  if (-not $exe) { throw 'El zip de NSSM no contiene win64\nssm.exe' }
  New-Item -ItemType Directory -Force -Path (Split-Path $local) | Out-Null
  Copy-Item $exe.FullName $local -Force
  Remove-Item $tmp -Recurse -Force
  return $local
}
$nssm = Obtener-Nssm
Write-Host "NSSM: $nssm"

function Existe-Servicio($n) { [bool](Get-Service -Name $n -ErrorAction SilentlyContinue) }

function Quitar-Servicio($n) {
  if (Existe-Servicio $n) {
    & $nssm stop $n confirm | Out-Null
    & $nssm remove $n confirm | Out-Null
    Write-Host "Eliminado $n"
  }
}

if ($Desinstalar) {
  foreach ($d in $definiciones) { Quitar-Servicio $d.Nombre }
  return
}

# ---------- Compilación ----------
if ($Compilar -or -not (Test-Path (Join-Path $ApiDir 'dist\main.js')) -or -not (Test-Path (Join-Path $WebDist 'index.html'))) {
  Write-Host 'Compilando API y web...' -ForegroundColor Cyan
  Push-Location $Raiz
  try { pnpm turbo run build --filter=@pos/api --filter=@pos/web; if ($LASTEXITCODE) { throw 'Falló la compilación' } }
  finally { Pop-Location }
}

New-Item -ItemType Directory -Force -Path $Logs | Out-Null

# ---------- Servicios ----------
foreach ($d in $definiciones) {
  $n = $d.Nombre
  if (-not (Test-Path (Join-Path $ApiDir $d.Env))) { throw "Falta $($d.Env) en $ApiDir" }
  Quitar-Servicio $n

  & $nssm install $n $Node 'dist\main.js' | Out-Null
  & $nssm set $n AppDirectory $ApiDir | Out-Null
  & $nssm set $n DisplayName $d.Titulo | Out-Null
  & $nssm set $n Description "API NestJS del POS (SERVER_MODE=$($d.Modo))" | Out-Null
  & $nssm set $n AppEnvironmentExtra "ENV_FILE=$($d.Env)" "NODE_ENV=production" "WEB_DIST=$WebDist" | Out-Null
  & $nssm set $n Start SERVICE_DELAYED_AUTO_START | Out-Null
  if ($PgServicio) { & $nssm set $n DependOnService $PgServicio | Out-Null }
  # Registros con rotación diaria / 10 MB
  & $nssm set $n AppStdout (Join-Path $Logs "$n.log") | Out-Null
  & $nssm set $n AppStderr (Join-Path $Logs "$n.error.log") | Out-Null
  & $nssm set $n AppRotateFiles 1 | Out-Null
  & $nssm set $n AppRotateOnline 1 | Out-Null
  & $nssm set $n AppRotateSeconds 86400 | Out-Null
  & $nssm set $n AppRotateBytes 10485760 | Out-Null
  # Si se cae, reiniciar a los 5 s
  & $nssm set $n AppExit Default Restart | Out-Null
  & $nssm set $n AppRestartDelay 5000 | Out-Null
  & $nssm set $n AppStopMethodConsole 5000 | Out-Null

  & $nssm start $n | Out-Null
  Start-Sleep -Seconds 3
  $estado = (Get-Service $n).Status
  Write-Host ("{0,-16} {1}" -f $n, $estado) -ForegroundColor ($(if ($estado -eq 'Running') { 'Green' } else { 'Red' }))
}

# ---------- Firewall (acceso desde la LAN/VPN) ----------
foreach ($d in $definiciones) {
  $puerto = (Select-String -Path (Join-Path $ApiDir $d.Env) -Pattern '^\s*PORT\s*=\s*(\d+)').Matches.Groups[1].Value
  if ($puerto) {
    $regla = "$($d.Nombre) TCP $puerto"
    if (-not (Get-NetFirewallRule -DisplayName $regla -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName $regla -Direction Inbound -Protocol TCP -LocalPort $puerto -Action Allow -Profile Domain,Private | Out-Null
      Write-Host "Firewall: abierto TCP $puerto (redes privadas/dominio)"
    }
  }
}

# ---------- Arranque robusto (timeout PostgreSQL, recuperación, tarea POS-Arranque) ----------
& (Join-Path $PSScriptRoot 'blindar-arranque.ps1') -Apis ($definiciones | ForEach-Object { $_.Nombre })

Write-Host ''
Write-Host "Listo. Registros: $Logs" -ForegroundColor Green
Write-Host 'Administrar:  Get-Service POS-API-*  |  Restart-Service POS-API-Store  |  services.msc'
