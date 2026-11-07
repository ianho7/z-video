import { screen } from "electron";
import type { BrowserWindow } from "electron";
import koffi from "koffi";

const WS_CHILD = 0x40000000;
const WS_CLIPSIBLINGS = 0x04000000;
const WS_CLIPCHILDREN = 0x02000000;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;
const SW_HIDE = 0;
const SW_SHOW = 5;

const RECT = koffi.struct("NativeRect", {
  left: "long",
  top: "long",
  right: "long",
  bottom: "long",
});

type NativeHandle = bigint;
type Win32Function = (...args: any[]) => any;

interface Win32Api {
  createWindow: Win32Function;
  destroyWindow: Win32Function;
  getClientRect: Win32Function;
  getDpiForWindow: Win32Function;
  setWindowPos: Win32Function;
  showWindow: Win32Function;
}

let win32Api: Win32Api | undefined;

function getWin32Api(): Win32Api {
  if (win32Api) return win32Api;
  if (process.platform !== "win32") throw new Error("native video window is only available on Windows");
  const user32 = koffi.load("user32.dll");
  win32Api = {
    createWindow: user32.func("__stdcall", "CreateWindowExW", "void *", [
      "uint32_t",
      "str16",
      "str16",
      "uint32_t",
      "int32_t",
      "int32_t",
      "int32_t",
      "int32_t",
      "void *",
      "void *",
      "void *",
      "void *",
    ]),
    destroyWindow: user32.func("__stdcall", "DestroyWindow", "int", ["void *"]),
    getClientRect: user32.func("__stdcall", "GetClientRect", "int", ["void *", koffi.out(koffi.pointer(RECT))]),
    getDpiForWindow: user32.func("__stdcall", "GetDpiForWindow", "uint32_t", ["void *"]),
    setWindowPos: user32.func("__stdcall", "SetWindowPos", "int", [
      "void *",
      "void *",
      "int32_t",
      "int32_t",
      "int32_t",
      "int32_t",
      "uint32_t",
    ]),
    showWindow: user32.func("__stdcall", "ShowWindow", "int", ["void *", "int32_t"]),
  };
  return win32Api;
}

function bufferToHandle(buffer: Buffer): NativeHandle {
  if (buffer.length >= 8) return buffer.readBigUInt64LE(0);
  if (buffer.length >= 4) return BigInt(buffer.readUInt32LE(0));
  throw new Error("Electron returned an invalid native window handle");
}

export class NativeVideoWindow {
  readonly handle: NativeHandle;
  private destroyed = false;
  private visible = false;
  private readonly resizeListener: () => void;
  private readonly fullScreenListener: () => void;
  private readonly displayMetricsListener: () => void;

  private constructor(private readonly parent: BrowserWindow, handle: NativeHandle, private readonly api: Win32Api) {
    this.handle = handle;
    this.resizeListener = () => this.resize();
    this.fullScreenListener = () => this.resize();
    this.displayMetricsListener = () => this.resize();
    parent.on("resize", this.resizeListener);
    parent.on("enter-full-screen", this.fullScreenListener);
    parent.on("leave-full-screen", this.fullScreenListener);
    screen.on("display-metrics-changed", this.displayMetricsListener);
    this.resize();
  }

  static create(parent: BrowserWindow): NativeVideoWindow {
    const api = getWin32Api();
    const parentHandle = bufferToHandle(parent.getNativeWindowHandle());
    const style = WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN;
    const handle = api.createWindow(0, "STATIC", "", style, 0, 0, 1, 1, parentHandle, 0n, 0n, 0n) as NativeHandle;
    if (!handle) throw new Error("failed to create the native video host");
    return new NativeVideoWindow(parent, handle, api);
  }

  resize(): void {
    if (this.destroyed || this.parent.isDestroyed()) return;
    const rect = { left: 0, top: 0, right: 0, bottom: 0 };
    if (!this.api.getClientRect(this.parentHandle(), rect)) return;
    const dpi = Number(this.api.getDpiForWindow(this.parentHandle())) || 96;
    const controlsHeight = Math.round((152 * dpi) / 96);
    const width = Math.max(1, Number(rect.right) - Number(rect.left));
    const height = Math.max(1, Number(rect.bottom) - Number(rect.top) - controlsHeight);
    this.api.setWindowPos(this.handle, 0n, 0, 0, width, height, SWP_NOACTIVATE | (this.visible ? SWP_SHOWWINDOW : 0));
    this.api.showWindow(this.handle, this.visible ? SW_SHOW : SW_HIDE);
  }

  show(): void {
    if (this.destroyed) return;
    this.visible = true;
    this.resize();
  }

  hide(): void {
    if (this.destroyed) return;
    this.visible = false;
    this.api.showWindow(this.handle, SW_HIDE);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.parent.removeListener("resize", this.resizeListener);
    this.parent.removeListener("enter-full-screen", this.fullScreenListener);
    this.parent.removeListener("leave-full-screen", this.fullScreenListener);
    screen.removeListener("display-metrics-changed", this.displayMetricsListener);
    this.api.destroyWindow(this.handle);
  }

  private parentHandle(): NativeHandle {
    return bufferToHandle(this.parent.getNativeWindowHandle());
  }
}
