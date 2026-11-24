Unicode true
RequestExecutionLevel user
Name "AI承诺审计星图-智能体"
OutFile "release\AI-Commitment-StarMap-2.0.0-Windows-x64-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs"
SetCompressor zlib

!include "MUI2.nsh"
!define MUI_ICON "assets\icon.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "build\installerHeader.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "build\installerSidebar.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "build\uninstallerSidebar.bmp"
!define MUI_UNICON "assets\icon.ico"
!define MUI_DIRECTORYPAGE_TEXT_TOP "选择现有父目录。安装器将在其中新建 AI-Commitment-StarMap-Agent 专属子目录。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\AI-Commitment-StarMap-Agent\AI承诺审计星图-智能体.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "安装"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\payload"
  File /r "release\win-unpacked\*"
  File "release\installer-support\InstallGuard.exe"
  WriteUninstaller "$PLUGINSDIR\payload\Uninstall.exe"
  SetOutPath "$PLUGINSDIR"
  ExecWait '"$PLUGINSDIR\payload\InstallGuard.exe" install "$INSTDIR\AI-Commitment-StarMap-Agent" "$PLUGINSDIR\payload"' $0
  IfErrors failed
  StrCmp $0 0 done
  failed:
    SetErrorLevel 1
    Abort "安装未完成。请选择安全的现有父目录。安装器不会覆盖已有目录，也不会自动卸载已有安装。"
  done:
    DetailPrint "安装成功。可从 Windows 已安装的应用卸载。"
SectionEnd

Section "un.卸载"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "release\installer-support\InstallGuard.exe"
  StrCpy $1 "uninstall"
  IfSilent remove
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否同时删除共享的项目与模型配置？选择否将保留本地数据。" IDNO remove
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "最后确认：删除项目与模型配置不可撤销。若还有其他安装，清理将被拒绝。是否继续？" IDNO remove
  StrCpy $1 "purge"
  remove:
    ExecWait '"$PLUGINSDIR\InstallGuard.exe" $1 "$INSTDIR"' $0
    IfErrors failed
    StrCmp $0 0 done
    StrCmp $0 2 retained
  failed:
    SetErrorLevel 1
    Abort "卸载未完成。无法确认登记、文件归属或数据安全。"
  retained:
    DetailPrint "保留了有改动、被占用或无法安全确认归属的文件。"
  done:
SectionEnd


