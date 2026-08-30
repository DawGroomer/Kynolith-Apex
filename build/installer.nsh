!include MUI2.nsh

; electron-builder 26.15.3 calls customInit after initMultiUser.
; Re-select current-user mode so command-line mode selection cannot retain
; an all-users choice.
!macro customInit
  StrCpy $hasPerMachineInstallation "0"
  StrCpy $hasPerUserInstallation "1"
  !insertmacro setInstallModePerUser
!macroend

; The assisted install-mode page calls this hook before drawing its controls.
; Force current-user mode and abort the page so no elevation choice is shown.
!macro customInstallmode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Keep the Desktop shortcut optional without replacing electron-builder's
; built-in Start Menu shortcut handling.
Section /o "Desktop shortcut" SecDesktopShortcut
SectionEnd

!macro customPageAfterChangeDir
  !insertmacro MUI_PAGE_COMPONENTS
!macroend

!macro customInstall
  ${If} ${SectionIsSelected} ${SecDesktopShortcut}
    CreateShortCut "$DESKTOP\Kynolith Apex.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$DESKTOP\Kynolith Apex.lnk" "${APP_ID}"
  ${EndIf}
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Kynolith Apex.lnk"
!macroend
