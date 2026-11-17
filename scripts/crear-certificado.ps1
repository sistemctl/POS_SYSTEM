<#
.SYNOPSIS
  Crea un certificado HTTPS autofirmado para la API del POS (no requiere administrador).
  Solo es necesario para usar la CÁMARA del celular/tablet como lector de códigos en "Escanear productos".
  Con un lector USB o Bluetooth no hace falta.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\crear-certificado.ps1 -Direcciones 192.168.1.10,pos-central -Clave "UnaClaveSegura"

  Luego agregue al .env del servidor (.env.central o .env.store):
    HTTPS_PFX=C:\POS\certificados\pos.pfx
    HTTPS_PASSPHRASE=UnaClaveSegura
  y reinicie la API. En el celular abra https://192.168.1.10:3000 y acepte el aviso de certificado
  (o instale certificados\pos.cer en el celular como certificado de confianza).
#>
param(
  [Parameter(Mandatory = $true)][string[]]$Direcciones,
  [Parameter(Mandatory = $true)][string]$Clave,
  [string]$Carpeta = (Join-Path $PSScriptRoot '..\certificados'),
  [int]$Anios = 5
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Carpeta | Out-Null
$Carpeta = (Resolve-Path $Carpeta).Path

# Nombres alternativos: direcciones IP y nombres DNS (con -File las comas llegan como un solo texto)
$Direcciones = @($Direcciones | ForEach-Object { $_ -split '[,;\s]+' } | Where-Object { $_ })
$san = @()
foreach ($d in ($Direcciones + 'localhost' + '127.0.0.1' | Select-Object -Unique)) {
  if ($d -match '^\d{1,3}(\.\d{1,3}){3}$') { $san += "IPAddress=$d" } else { $san += "DNS=$d" }
}
$ext = "2.5.29.17={text}" + ($san -join '&')

$cert = New-SelfSignedCertificate `
  -Subject "CN=POS Supermercado" `
  -TextExtension @($ext, '2.5.29.37={text}1.3.6.1.5.5.7.3.1') `
  -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears($Anios) `
  -CertStoreLocation 'Cert:\CurrentUser\My'

$pfx = Join-Path $Carpeta 'pos.pfx'
$cer = Join-Path $Carpeta 'pos.cer'
$segura = ConvertTo-SecureString -String $Clave -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $segura | Out-Null
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
# El certificado ya quedó en los archivos; se quita del almacén del usuario
Remove-Item -LiteralPath ("Cert:\CurrentUser\My\" + $cert.Thumbprint)

Write-Host "Certificado creado:" -ForegroundColor Green
Write-Host "  $pfx  (para la API)"
Write-Host "  $cer  (para instalar como confiable en celulares/PCs)"
Write-Host "  Válido para: $($san -join ', ')"
Write-Host ""
Write-Host "Agregue al .env del servidor y reinicie la API:" -ForegroundColor Yellow
Write-Host "  HTTPS_PFX=$pfx"
Write-Host "  HTTPS_PASSPHRASE=<la clave que usó>"
