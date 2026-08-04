import { contextBridge, ipcRenderer } from "electron";

// Safe, minimal bridge between the renderer and main process.
contextBridge.exposeInMainWorld("airlock", {
  getContext: () => ipcRenderer.invoke("get-context"),
  getHistory: (n: number) => ipcRenderer.invoke("get-history", n),
  getLockHistory: (n: number) => ipcRenderer.invoke("get-lock-history", n),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  getRobotStatus: () => ipcRenderer.invoke("get-robot-status"),
  updateSettings: (partial: unknown) =>
    ipcRenderer.invoke("update-settings", partial),
  manualLock: () => ipcRenderer.invoke("manual-lock"),
  manualUnlock: () => ipcRenderer.invoke("manual-unlock"),

  onContext: (cb: (data: unknown) => void) =>
    ipcRenderer.on("context", (_e, d) => cb(d)),
  onRobotStatus: (cb: (data: unknown) => void) =>
    ipcRenderer.on("robotStatus", (_e, d) => cb(d)),
  onLockEvent: (cb: (data: unknown) => void) =>
    ipcRenderer.on("lockEvent", (_e, d) => cb(d)),
});
