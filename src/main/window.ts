import { BrowserWindow } from "electron";
import { join } from "node:path";

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: "#101113",
    show: false,
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void window.loadFile(join(__dirname, "..", "renderer", "index.html"));
  window.once("ready-to-show", () => window.show());
  return window;
}
