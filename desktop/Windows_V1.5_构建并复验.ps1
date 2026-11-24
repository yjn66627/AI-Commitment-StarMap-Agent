# V1.5 isolated Windows x64 build. Does NOT install, uninstall, delete,
# or overwrite the user's already verified V1.3/V1.4 binaries or projects.
# Run with PowerShell 7+ on Windows. If policy prevents running PS1, Codex
# can run the npm.cmd commands directly in the same order.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$true
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
    Write-Host "Building V1.5 from $root"
    $version=& node.exe --version
    if($LASTEXITCODE -ne 0){throw 'Node.js unavailable'}
    Write-Host "Node $version"
    & npm.cmd install --no-audit --no-fund
    if($LASTEXITCODE -ne 0){throw 'npm install failed'}
    & npm.cmd run check
    if($LASTEXITCODE -ne 0){throw 'Source tests failed'}
    & npm.cmd run make:win
    if($LASTEXITCODE -ne 0){throw 'NSIS build failed'}
    $items=Get-ChildItem -LiteralPath (Join-Path $root 'release') -Filter '*.exe' -File
    if(-not $items){throw 'Setup.exe absent despite build exit 0'}
    $items | Select-Object FullName,Length,@{n='SHA256';e={(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}} | Format-List
    Write-Host 'Windows native installer built. Actual install/uninstall and visibility tests are still required.'
} finally { Pop-Location }
