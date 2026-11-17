<#
.SYNOPSIS
  Restaura un backup (.backup generado por pg_dump --format=custom) en una base del POS.
  ATENCIÓN: reemplaza el contenido actual de la base indicada. Detenga primero el servicio de la API.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\restore-db.ps1 -Archivo "C:\POS-backups\store\pos_store_2026-11-11T23-00-00-000Z_programado.backup" -BaseDatos pos_store -SuperPassword "clave"
#>
param(
  [Parameter(Mandatory = $true)][string]$Archivo,
  [Parameter(Mandatory = $true)][string]$BaseDatos,
  [Parameter(Mandatory = $true)][string]$SuperPassword,
  [string]$PgBin = "C:\Program Files\PostgreSQL\18\bin",
  [string]$PgHost = "localhost",
  [int]$Port = 5432,
  [switch]$Confirmar
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Archivo)) { throw "No existe el archivo $Archivo" }

if (-not $Confirmar) {
  Write-Host "Se reemplazará TODO el contenido de la base '$BaseDatos' con el backup:" -ForegroundColor Yellow
  Write-Host "  $Archivo"
  Write-Host "Vuelva a ejecutar con -Confirmar para continuar."
  exit 1
}

$env:PGPASSWORD = $SuperPassword
$psql = Join-Path $PgBin 'psql.exe'
$restore = Join-Path $PgBin 'pg_restore.exe'

Write-Host "Cerrando conexiones a $BaseDatos..."
& $psql -h $PgHost -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$BaseDatos' AND pid <> pg_backend_pid();" | Out-Null

Write-Host "Recreando $BaseDatos..."
& $psql -h $PgHost -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $BaseDatos;" | Out-Null
& $psql -h $PgHost -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $BaseDatos OWNER pos ENCODING 'UTF8' TEMPLATE template0;" | Out-Null

Write-Host "Restaurando..."
& $restore -h $PgHost -p $Port -U postgres -d $BaseDatos --no-owner --role=pos $Archivo
if ($LASTEXITCODE -ne 0) { throw "pg_restore terminó con errores ($LASTEXITCODE)" }
Remove-Item Env:\PGPASSWORD
Write-Host "Restauración completada." -ForegroundColor Green
