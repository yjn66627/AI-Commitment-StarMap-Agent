!macro customUnInstall
  ; Standard uninstall always preserves all project data and API configuration.
  ; The updater's silent uninstall MUST NEVER delete data.
  IfSilent v16_no_data_cleanup
  IfFileExists "$APPDATA\AICommitmentStarMap-Production\.starmap-owner-v15" 0 v16_no_data_cleanup
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否执行完全卸载，同时删除本应用的本地项目、API加密配置、缓存和日志？$\r$\n$\r$\n选择‘否’可保留个人数据，方便以后升级或重新安装。不会删除外部备份、V1.3/V1.4独立数据。" IDNO v16_no_data_cleanup
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "二次确认：专属用户目录中的资料删除后不能撤回，请先导出需要保留的项目。确定执行完全卸载吗？" IDNO v16_no_data_cleanup
  ; Safe helper avoids following junctions/symlinks. Fail closed and keep user data on error.
  InitPluginsDir
  File "/oname=$PLUGINSDIR\SafeRemoveAppData.ps1" "${BUILD_RESOURCES_DIR}\SafeRemoveAppData.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\SafeRemoveAppData.ps1" -Target "$APPDATA\AICommitmentStarMap-Production"'
  Pop $0
  Pop $1
  StrCmp $0 "0" v16_no_data_cleanup
  MessageBox MB_ICONEXCLAMATION|MB_OK "数据清理未完成（安全保护已阻止继续删除）。应用已卸载，但个人资料保留。错误代码：$0"
  v16_no_data_cleanup:
!macroend
