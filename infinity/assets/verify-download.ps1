<#
  verify-download.ps1 - check a downloaded Infinity.Inc file and clear the mark
  Windows puts on it.

  Windows marks every file that arrives from the internet. That mark, not the
  file, is what makes the "this file is not safe" prompt appear. Verifying the
  published digest proves the bytes are the ones that were released, and
  Unblock-File removes the mark once that is known.

  Usage:
    powershell -ExecutionPolicy Bypass -File verify-download.ps1 -Path .\InfinityCloud_1.0.0-pre4_win64_setup.exe -Sha256 <digest>
#>
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Sha256
)
$ErrorActionPreference = 'Stop'
$file = Get-Item -LiteralPath $Path
$hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLower()
Write-Host ("file    : " + $file.FullName)
Write-Host ("size    : " + $file.Length + " bytes")
Write-Host ("sha256  : " + $hash)
if ($Sha256) {
  $want = $Sha256.ToLower().Replace('sha256:', '').Trim()
  if ($hash -ne $want) {
    Write-Host "MISMATCH: the file is not the published one. Do not run it." -ForegroundColor Red
    exit 1
  }
  Write-Host "MATCH: this is the published file." -ForegroundColor Green
} else {
  Write-Host "No digest given; compare the line above with the one on the download page."
}
Unblock-File -LiteralPath $file.FullName
Write-Host "Unblocked: Windows will no longer warn about this file."
