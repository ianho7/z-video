import { BrowserWindow, nativeTheme } from "electron";
import { join } from "node:path";

import { IPC_CHANNELS } from "../shared/ipc-channels";
import type { WindowAppearanceState } from "../shared/contracts";
import { recordUiOperation } from "./diagnostics";

const WINDOW_BACKGROUND = "#101113";

export function readWindowAppearance(): WindowAppearanceState {
  const forcedByEnvironment = isEnvironmentFlagEnabled(process.env.Z_VIDEO_REDUCED_TRANSPARENCY)
    || isEnvironmentFlagEnabled(process.env.Z_VIDEO_HIGH_CONTRAST);
  const highContrast = process.platform === "win32"
    && (nativeTheme.shouldUseHighContrastColors || nativeTheme.inForcedColorsMode || isEnvironmentFlagEnabled(process.env.Z_VIDEO_HIGH_CONTRAST));
  const reducedTransparency = process.platform === "win32"
    && (nativeTheme.prefersReducedTransparency || forcedByEnvironment);
  const nativeBackdrop = process.platform === "win32"
    && supportsNativeBackdropPlatform()
    && !reducedTransparency
    && !highContrast
    && !isEnvironmentFlagDisabled(process.env.Z_VIDEO_NATIVE_BACKDROP);
  return { nativeBackdrop, reducedTransparency, highContrast };
}

function supportsNativeBackdropPlatform(): boolean {
  if (process.platform !== "win32") return false;
  const build = Number(process.getSystemVersion().split(".")[2]);
  return Number.isFinite(build) && build >= 22621;
}

function isEnvironmentFlagEnabled(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isEnvironmentFlagDisabled(value: string | undefined): boolean {
  return value !== undefined && ["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

export function applyWindowAppearance(window: BrowserWindow, appearance = readWindowAppearance()): WindowAppearanceState {
  if (process.platform === "win32") {
    try {
      window.setBackgroundMaterial(appearance.nativeBackdrop ? "acrylic" : "none");
      window.setBackgroundColor(appearance.nativeBackdrop ? "#00000000" : WINDOW_BACKGROUND);
    } catch {
      // Electron documents system materials as Windows 11 22H2+ only. Keep
      // the opaque client fallback if the material is unavailable at runtime.
      appearance = { ...appearance, nativeBackdrop: false, reducedTransparency: true };
      window.setBackgroundMaterial("none");
      window.setBackgroundColor(WINDOW_BACKGROUND);
    }
  }
  if (!window.webContents.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.appearanceState, appearance);
  }
  return appearance;
}

export function createMainWindow(): BrowserWindow {
  const appearance = readWindowAppearance();
  const window = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: appearance.nativeBackdrop ? "#00000000" : WINDOW_BACKGROUND,
    backgroundMaterial: appearance.nativeBackdrop ? "acrylic" : "none",
    show: false,
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const sendAppearance = () => {
    applyWindowAppearance(window, readWindowAppearance());
  };
  window.webContents.once("did-finish-load", () => {
    sendAppearance();
    void recordUiOperation("window.renderer-ready", "success", Date.now());
  });
  const onNativeThemeUpdated = () => sendAppearance();
  nativeTheme.on("updated", onNativeThemeUpdated);
  window.once("closed", () => nativeTheme.off("updated", onNativeThemeUpdated));
  void window.loadFile(join(__dirname, "..", "renderer", "index.html"));
  window.once("ready-to-show", () => window.show());
  return window;
}
