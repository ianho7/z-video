import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("zVideo", { overlay: {
  action: (value: unknown) => ipcRenderer.send("overlay:action", value),
  ignore: (value: boolean) => ipcRenderer.send("overlay:ignore", value),
  onState: (listener: (state: unknown) => void) => { ipcRenderer.on("overlay:state", (_event, state: unknown) => listener(state)); },
  onReset: (listener: () => void) => { ipcRenderer.on("overlay:reset", () => listener()); },
} });
