import { contextBridge, ipcRenderer } from "electron";

import type { ElectronApi, LoginInput, OperationOutcome, PublicSessionState } from "../shared/contracts";

// Sandboxed preloads may require Electron's built-ins, but not local CommonJS
// modules. Keep these names identical to shared/ipc-channels.ts.
const IPC_CHANNELS = {
  restore: "session:restore",
  login: "session:login",
  sendMfa: "session:send-mfa",
  verifyMfa: "session:verify-mfa",
  logout: "session:logout",
  listClassifications: "library:list-classifications",
} as const;

const api: ElectronApi = {
  session: {
    restore: () => ipcRenderer.invoke(IPC_CHANNELS.restore) as Promise<PublicSessionState>,
    login: (input: LoginInput) => ipcRenderer.invoke(IPC_CHANNELS.login, input) as Promise<{ state: PublicSessionState }>,
    sendMfaCode: (challengeType?: string) => ipcRenderer.invoke(IPC_CHANNELS.sendMfa, challengeType) as Promise<OperationOutcome>,
    verifyMfa: (code: string) => ipcRenderer.invoke(IPC_CHANNELS.verifyMfa, code) as Promise<{ state: PublicSessionState }>,
    logout: () => ipcRenderer.invoke(IPC_CHANNELS.logout) as Promise<OperationOutcome>,
  },
  library: {
    listClassifications: () => ipcRenderer.invoke(IPC_CHANNELS.listClassifications) as Promise<{ classifications: PublicSessionState["classifications"]; state: PublicSessionState }>,
  },
};

contextBridge.exposeInMainWorld("zVideo", api);
