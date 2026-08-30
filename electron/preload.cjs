const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("apexDesktop", {
  openHud: () => ipcRenderer.invoke("apex:open-hud"),
  closeHud: () => ipcRenderer.invoke("apex:close-hud"),
  setHudLocked: locked => ipcRenderer.invoke("apex:set-hud-locked", Boolean(locked)),
  setHudControlsInteractive: interactive => ipcRenderer.invoke(
    "apex:set-hud-controls-interactive",
    Boolean(interactive)
  )
});
