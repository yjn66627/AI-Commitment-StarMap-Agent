# Windows 11 / PowerShell 7+, run by Codex. Source/build files in the project workspace.
# Only installation/upgrade/uninstall experiments use D:\E盘下载中转区.
# Normal source edits and official archived results belong in the project workspace. Never modify frozen V1.5.
param([string]$FrozenV15Desktop=$env:STARMAP_FROZEN_V15_DESKTOP,[string]$FrozenV15AppAsar=$env:STARMAP_FROZEN_V15_ASAR)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$true
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
  if(-not (Test-Path 'package.json')) {throw 'Desktop project root missing'}
  # Source comparison with the FINAL Windows V1.5 freeze is mandatory for Windows release.
  # Codex must locate the final source via Everything; this script only reads it.
  if(-not $FrozenV15Desktop){throw 'FINAL_V15_DESKTOP_REQUIRED: pass -FrozenV15Desktop <frozen-desktop-source>'}
  if(-not $FrozenV15AppAsar){
    $possible=@(
      (Join-Path $FrozenV15Desktop 'release-final\win-unpacked\resources\app.asar'),
      (Join-Path $FrozenV15Desktop 'release\win-unpacked\resources\app.asar')
    )
    $FrozenV15AppAsar=$possible | Where-Object {Test-Path -LiteralPath $_ -PathType Leaf} | Select-Object -First 1
  }
  if(-not $FrozenV15AppAsar){throw 'FINAL_V15_APP_ASAR_REQUIRED: supply verified final V1.5 app.asar'}
  $frozenSha=(Get-FileHash -LiteralPath $FrozenV15AppAsar -Algorithm SHA256).Hash.ToUpperInvariant()
  if($frozenSha -ne '803410C78E99DCE13A71E81DC5B39C0EA95788734982A7D7383BA9144FE972DF'){
    throw 'FINAL_V15_FREEZE_PROVENANCE_MISMATCH: do not build over unverified source'
  }
  & node.exe scripts/verify-frozen-v15.mjs $FrozenV15Desktop
  if($LASTEXITCODE -ne 0){throw 'FINAL_V15_BASELINE_NOT_RECONCILED'}
  if(-not (Test-Path -LiteralPath 'package-lock.json')) {
    & npm.cmd install --package-lock-only --ignore-scripts --no-audit --no-fund
    if($LASTEXITCODE -ne 0){throw 'npm lockfile generation failed'}
  }
  & npm.cmd ci --no-audit --no-fund
  if($LASTEXITCODE -ne 0) {throw 'reproducible npm ci failed'}
  if(-not (Test-Path -LiteralPath 'package-lock.json')){throw 'DEPENDENCY_LOCKFILE_MISSING'}
  & npm.cmd run prepare:gestures
  if($LASTEXITCODE -ne 0) {throw 'Google MediaPipe model/wasm staging failed'}
  & npm.cmd run check
  if($LASTEXITCODE -ne 0) {throw 'source and regression tests failed'}
  & npm.cmd run make:win
  if($LASTEXITCODE -ne 0) {throw 'Windows NSIS build failed'}
  & npm.cmd run verify:winpackage
  if($LASTEXITCODE -ne 0){throw 'PACKAGED_MEDIA_MODEL_NOT_PRESENT: refuse release'}
  # Source in project workspace; install/uninstall experiments must use the agreed D: transit directory.
  $setup=Get-Item -LiteralPath (Join-Path $root 'release/AI-Commitment-StarMap-2.0.0-Windows-x64-Setup.exe')
  if(-not $setup) {throw 'NSIS Setup.exe missing'}
  $zipRoot=Join-Path $root 'release-final'
  if(-not (Test-Path $zipRoot)) {New-Item -ItemType Directory -Path $zipRoot | Out-Null}
  $installName='01_安装_AI承诺审计星图-智能体.exe'
  $uninstallName='02_卸载_AI承诺审计星图-智能体.exe'
  Copy-Item -LiteralPath $setup.FullName -Destination (Join-Path $zipRoot $installName) -Force
  # Build a true standalone Chinese uninstall launcher, not a copied old uninstaller.
  $csc=@("$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe","$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe") | Where-Object {Test-Path $_} | Select-Object -First 1
  if(-not $csc){throw 'Windows C# compiler unavailable, cannot safely create Chinese uninstall EXE'}
  & $csc /nologo /target:winexe /optimize+ "/win32icon:$root\assets\icon.ico" "/out:$zipRoot\$uninstallName" /reference:System.Windows.Forms.dll (Join-Path $root 'build\UninstallLauncher.cs')
  if($LASTEXITCODE -ne 0){throw 'Chinese uninstall EXE compiler failed'}
  $instructions=@'
AI承诺审计星图-智能体 V2.0｜Windows x64

【安装】双击“01_安装_AI承诺审计星图-智能体.exe”，根据提示选择安装位置。
【卸载】双击“02_卸载_AI承诺审计星图-智能体.exe”，或使用Windows“已安装的应用”。
完全卸载将清理专属用户数据，需要两次确认。默认标准卸载保留数据。
【手势控制】进入“关系星图 → 3D空间”，点击“开启手势”，授权摄像头。
张开手掌移动：旋转；双手张开并拉开/靠近：缩放；食指指向预高亮后捏合：选点，松开后切换；握拳：暂停。
手势识别完全在本机进行，不需要AI API密钥，离开星图会停止摄像头。
若没有摄像头或摄像头被占用，鼠标操作仍然正常。
【项目演进】材料删除移入可恢复历史；承诺状态和关系变更保留证据。星图时间轴为只读历史。
【在线AI】首次使用须自行配置模型与API Key；密钥本机加密保存，未配置时不会调用在线供应商。
【备份】首次迁移保存旧工作区原字节；降级前请先导出备份，避免旧版丢失新增历史。
安装包未做代码签名，Windows可能提示未知发布者。
'@
  Set-Content -LiteralPath (Join-Path $zipRoot '使用说明.txt') -Value $instructions -Encoding UTF8
  $zipPath=Join-Path (Split-Path -Parent $root) 'AI承诺审计星图-智能体_V2.0.0_Windows中文发行包.zip'
  if(Test-Path $zipPath){throw 'Existing release ZIP present; do not overwrite freeze/delivery'}
  # No test files and no API secrets in the public ZIP. Installer and uninstaller are actual executable binaries.
  $topFiles=@(Get-ChildItem -LiteralPath $zipRoot -File | Select-Object -ExpandProperty Name | Sort-Object)
  $expected=@('01_安装_AI承诺审计星图-智能体.exe','02_卸载_AI承诺审计星图-智能体.exe','使用说明.txt') | Sort-Object
  if((Compare-Object $topFiles $expected)){throw 'RELEASE_ROOT_NOT_CLEAN'}
  Compress-Archive -Path (Join-Path $zipRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal
  Write-Host "Final Windows release ZIP: $zipPath"
  Write-Host 'Windows camera, installer, uninstaller and user-profile safety acceptance still required.'

  Get-ChildItem -Path (Join-Path $root 'release') -Filter '*.exe' -File |
     Select-Object FullName,Length,@{N='SHA256';E={(Get-FileHash $_.FullName -Algorithm SHA256).Hash}} | Format-List
} finally {Pop-Location}
