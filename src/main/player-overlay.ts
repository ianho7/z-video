import { BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";

/** A dedicated, sandboxed surface above the native video child window. */
export function createPlayerOverlay(parent: BrowserWindow): void {
  let overlay: BrowserWindow | undefined;
  let overlayReady = false;
  const syncBounds = () => {
    if (overlay && !overlay.isDestroyed() && !parent.isDestroyed()) overlay.setBounds(parent.getContentBounds());
  };
  const requestState = () => {
    // The renderer owns the mirrored snapshot; re-requesting it is the main-process
    // half of "second open is not blank".
    if (!parent.isDestroyed() && !parent.webContents.isDestroyed()) parent.webContents.send("overlay:ready");
  };
  const onVisibility = (event: Electron.IpcMainEvent, visible: unknown) => {
    if (event.sender !== parent.webContents || event.senderFrame !== parent.webContents.mainFrame || typeof visible !== "boolean") return;
    if (!visible) {
      if (overlay && !overlay.isDestroyed()) {
        overlay.webContents.send("overlay:reset");
        overlay.hide();
      }
      return;
    }
    if (!overlay || overlay.isDestroyed()) {
      overlay = new BrowserWindow({ parent, frame: false, transparent: true, show: false, skipTaskbar: true, resizable: false,
        webPreferences: { preload: join(__dirname, "..", "preload", "overlay-preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
      overlayReady = false;
      void overlay.loadFile(join(__dirname, "..", "renderer", "overlay.html"));
      overlay.webContents.once("did-finish-load", () => { overlayReady = true; if (!parent.isDestroyed()) parent.webContents.send("overlay:ready"); });
    }
    syncBounds();
    overlay.showInactive();
    overlay.moveTop();
    // Hiding sent `overlay:reset`, which emptied the mirrored DOM; a full state
    // push now keeps the re-shown overlay from waiting for its 250 ms mirror tick.
    if (overlayReady) requestState();
  };
  const onState = (event: Electron.IpcMainEvent, state: unknown) => {
    if (event.sender !== parent.webContents || event.senderFrame !== parent.webContents.mainFrame || !overlay || overlay.isDestroyed()) return;
    overlay.webContents.send("overlay:state", state);
  };
  const onAction = (event: Electron.IpcMainEvent, action: unknown) => {
    if (!overlay || overlay.isDestroyed() || event.sender !== overlay.webContents || event.senderFrame !== overlay.webContents.mainFrame || parent.isDestroyed()) return;
    parent.webContents.send("overlay:action", action);
  };
  const onIgnore = (event: Electron.IpcMainEvent, ignore: unknown) => {
    if (!overlay || overlay.isDestroyed() || event.sender !== overlay.webContents || event.senderFrame !== overlay.webContents.mainFrame || typeof ignore !== "boolean") return;
    overlay.setIgnoreMouseEvents(ignore, { forward: true });
  };
  ipcMain.on("overlay:visible", onVisibility);
  ipcMain.on("overlay:state", onState);
  ipcMain.on("overlay:action", onAction);
  ipcMain.on("overlay:ignore", onIgnore);
  parent.on("move", syncBounds); parent.on("resize", syncBounds);
  parent.on("enter-full-screen", syncBounds); parent.on("leave-full-screen", syncBounds);
  parent.once("closed", () => {
    ipcMain.removeListener("overlay:visible", onVisibility); ipcMain.removeListener("overlay:state", onState);
    ipcMain.removeListener("overlay:action", onAction); ipcMain.removeListener("overlay:ignore", onIgnore);
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
  });
}
