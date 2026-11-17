<#
.SYNOPSIS
  Prepara PostgreSQL nativo para el POS (desarrollo o un servidor nuevo).
  - Crea el usuario de BD "pos" y las bases pos_central / pos_store
  - Genera apps/api/.env.central y apps/api/.env.store (si no existen)

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-db.ps1 -SuperPassword "clave_de_postgres"

.PARAMETER Modo
  dev     = crea ambas bases (central + tienda) en esta PC para desarrollo
  central = solo pos_central
  store   = solo pos_store
#>
param(
  [Parameter(Mandatory = $true)][string]$SuperPassword,
  [string]$AppPassword = "",
  [ValidateSet('dev', 'central', 'store')][string]$Modo = 'dev',
  [string]$PgBin = "C:\Program Files\PostgreSQL\18\bin",
  [string]$PgHost = "localhost",
  [int]$Port = 5432
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$apiDir = Join-Path $root 'apps\api'
$psql = Join-Path $PgBin 'psql.exe'
if (-not (Test-Path $psql)) { throw "No se encontró psql en $PgBin. Indique -PgBin." }

function New-Secret([int]$len = 48) {
  $bytes = New-Object byte[] $len
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([Convert]::ToBase64String($bytes) -replace '[+/=]', '').Substring(0, $len)
}

if (-not $AppPassword) { $AppPassword = New-Secret 24 }

$env:PGPASSWORD = $SuperPassword
function Invoke-Sql([string]$sql, [string]$db = 'postgres') {
  $out = & $psql -h $PgHost -p $Port -U postgres -d $db -v ON_ERROR_STOP=1 -tAc $sql
  if ($LASTEXITCODE -ne 0) { throw "Error ejecutando SQL: $sql" }
  return $out
}

Write-Host "Creando/actualizando usuario 'pos'..."
$pwdSql = $AppPassword.Replace("'", "''")
Invoke-Sql ('DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ''pos'') THEN CREATE ROLE pos LOGIN CREATEDB PASSWORD ''{0}''; ELSE ALTER ROLE pos LOGIN CREATEDB PASSWORD ''{0}''; END IF; END $$;' -f $pwdSql) | Out-Null

$dbs = switch ($Modo) { 'dev' { @('pos_central', 'pos_store') } 'central' { @('pos_central') } 'store' { @('pos_store') } }
foreach ($db in $dbs) {
  $existe = Invoke-Sql ("SELECT 1 FROM pg_database WHERE datname = '{0}'" -f $db)
  if ($existe -eq '1') {
    Write-Host "La base $db ya existe."
  } else {
    Write-Host "Creando base $db..."
    Invoke-Sql ("CREATE DATABASE {0} OWNER pos ENCODING 'UTF8' TEMPLATE template0" -f $db) | Out-Null
  }
}
Remove-Item Env:\PGPASSWORD

# Token compartido para que la tienda de desarrollo se sincronice con el central
$syncToken = New-Secret 40
$pgBinEsc = $PgBin
$utf8 = New-Object Text.UTF8Encoding $false

$centralEnv = Join-Path $apiDir '.env.central'
if (($dbs -contains 'pos_central') -and -not (Test-Path $centralEnv)) {
  $c = @"
SERVER_MODE=central
PORT=3000
DATABASE_URL=postgresql://pos:$AppPassword@${PgHost}:$Port/pos_central?schema=public
JWT_SECRET=$(New-Secret 48)
SUCURSAL_ID=
# Solo desarrollo: el seed asigna este token a la sucursal demo
SEED_SYNC_TOKEN=$syncToken
PG_BIN=$pgBinEsc
BACKUP_DIR=C:\POS-backups\central
BACKUP_EXTERNAL_DIR=
BACKUP_RETENCION_DIAS=30
BACKUP_HORA=23
WEB_DIST=
"@
  [IO.File]::WriteAllText($centralEnv, $c, $utf8)
  Write-Host "Creado $centralEnv"
}

$storeEnv = Join-Path $apiDir '.env.store'
if (($dbs -contains 'pos_store') -and -not (Test-Path $storeEnv)) {
  $s = @"
SERVER_MODE=store
PORT=3001
DATABASE_URL=postgresql://pos:$AppPassword@${PgHost}:$Port/pos_store?schema=public
JWT_SECRET=$(New-Secret 48)
SUCURSAL_ID=01930000-0000-7000-8000-000000000001
CENTRAL_URL=http://localhost:3000
SYNC_TOKEN=$syncToken
SYNC_INTERVALO_SEGUNDOS=30
PG_BIN=$pgBinEsc
BACKUP_DIR=C:\POS-backups\store
BACKUP_EXTERNAL_DIR=
BACKUP_RETENCION_DIAS=30
BACKUP_HORA=23
WEB_DIST=
"@
  [IO.File]::WriteAllText($storeEnv, $s, $utf8)
  Write-Host "Creado $storeEnv"
}

Write-Host ""
Write-Host "Listo. Siguientes pasos:" -ForegroundColor Green
Write-Host "  cd apps\api"
Write-Host "  pnpm db:deploy:central ; pnpm db:deploy:store ; pnpm db:seed"
