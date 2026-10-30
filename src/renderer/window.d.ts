import type { ElectronApi } from "../shared/contracts";

declare global {
  interface Window {
    zVideo: ElectronApi;
  }
}

export {};
