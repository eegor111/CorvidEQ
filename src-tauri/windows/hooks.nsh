; Uninstaller hook (tauri.conf.json, bundle > windows > nsis > installerHooks).
;
; CorvidEQ's EQ keeps working after the app closes, so once the app is
; uninstalled there would be no way left to switch it off. Before removing
; the files, the app itself puts the previous config.txt back (lib.rs,
; `--release-eapo`; the same checked restore as the power button).
;
; Not in update mode: the updater and a reinstall over an older version run
; the uninstaller with /UPDATE, and an update must keep the EQ as it is.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --release-eapo'
  ${EndIf}
!macroend
