$ErrorActionPreference = 'Stop'
$root = Join-Path (Get-Location).Path "guard-qa-$([Guid]::NewGuid())"
$install = Join-Path $root 'AI-Commitment-StarMap-Agent'
$external = Join-Path $root 'external'
New-Item -ItemType Directory $install,$external | Out-Null
Set-Content -LiteralPath (Join-Path $external 'outside.dll') -Value 'external' -NoNewline
New-Item -ItemType Junction -Path (Join-Path $install 'linked') -Target $external | Out-Null
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$exe = Join-Path $root 'InstallGuardTests.exe'
& $compiler '/nologo' '/platform:x64' "/out:$exe" '/main:InstallGuardTests' 'build\maintenance\InstallGuard.cs' 'release\installer-support\LegacyInstaller.cs' 'tests\v15\InstallGuardTests.cs'
if ($LASTEXITCODE) { exit $LASTEXITCODE }
& $exe $install $external
exit $LASTEXITCODE
