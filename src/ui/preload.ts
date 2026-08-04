import { contextBridge, ipcRenderer } from "electron";

function subscribe(channel: string, callback: (data: unknown) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, data: unknown) =>
    callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

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

  onContext: (cb: (data: unknown) => void) => subscribe("context", cb),
  onRobotStatus: (cb: (data: unknown) => void) =>
    subscribe("robotStatus", cb),
  onLockEvent: (cb: (data: unknown) => void) => subscribe("lockEvent", cb),
});
