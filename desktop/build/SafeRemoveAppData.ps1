# Invoked only by the confirmed NSIS COMPLETE uninstall path.
# Never follow junctions or symbolic links while removing the application-owned data tree.
param([Parameter(Mandatory=$true)][string]$Target)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$expected=[System.IO.Path]::GetFullPath((Join-Path $env:APPDATA 'AICommitmentStarMap-Production')).TrimEnd('\')
$actual=[System.IO.Path]::GetFullPath($Target).TrimEnd('\')
if(-not [string]::Equals($actual,$expected,[System.StringComparison]::OrdinalIgnoreCase)){throw 'TARGET_NOT_OWNED_APPDATA'}
if(-not (Test-Path -LiteralPath $actual -PathType Container)){exit 0}
$root=Get-Item -LiteralPath $actual -Force
if(($root.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0){throw 'APPDATA_ROOT_IS_REPARSE_POINT'}
$marker=Join-Path $actual '.starmap-owner-v15'
if(-not (Test-Path -LiteralPath $marker -PathType Leaf)){throw 'APPDATA_OWNERSHIP_MARKER_MISSING'}
$markerInfo=Get-Item -LiteralPath $marker -Force
if(($markerInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0){throw 'APPDATA_MARKER_IS_REPARSE_POINT'}
function Remove-OwnedTree([string]$directory){
  $entry=Get-Item -LiteralPath $directory -Force
  if(($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0){throw 'RACE_REPARSE_POINT_DETECTED'}
  foreach($child in @(Get-ChildItem -LiteralPath $directory -Force)){
    $info=Get-Item -LiteralPath $child.FullName -Force
    if(($info.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0){
      # Remove the link itself. NEVER recurse through it, including directory junctions.
      Remove-Item -LiteralPath $child.FullName -Force -ErrorAction Stop
    }elseif($info.PSIsContainer){
      Remove-OwnedTree $child.FullName
    }else{
      Remove-Item -LiteralPath $child.FullName -Force -ErrorAction Stop
    }
  }
  Remove-Item -LiteralPath $directory -Force -ErrorAction Stop
}
Remove-OwnedTree $actual
exit 0
