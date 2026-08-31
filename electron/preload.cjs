const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("apexDesktop", {
  openHud: () => ipcRenderer.invoke("apex:open-hud"),
  closeHud: () => ipcRenderer.invoke("apex:close-hud"),
  getHudDisplays: () => ipcRenderer.invoke("apex:get-hud-displays"),
  setHudDisplayTarget: target => ipcRenderer.invoke(
    "apex:set-hud-display-target",
    typeof target === "string" ? target : "primary-display"
  ),
  onHudDisplayFallback: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("apex:hud-display-fallback", listener);
    return () => ipcRenderer.removeListener("apex:hud-display-fallback", listener);
  },
  setHudLocked: locked => ipcRenderer.invoke("apex:set-hud-locked", Boolean(locked)),
  setHudControlsInteractive: interactive => ipcRenderer.invoke(
    "apex:set-hud-controls-interactive",
    Boolean(interactive)
  )
});
