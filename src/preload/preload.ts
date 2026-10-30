import { contextBridge, ipcRenderer } from "electron";

import type { ElectronApi, LoginInput, OperationOutcome, PlaybackCommand, PlaybackEvent, PublicSessionState } from "../shared/contracts";

// Sandboxed preloads may require Electron's built-ins, but not local CommonJS
// modules. Keep these names identical to shared/ipc-channels.ts.
const IPC_CHANNELS = {
  restore: "session:restore",
  login: "session:login",
  sendMfa: "session:send-mfa",
  verifyMfa: "session:verify-mfa",
  logout: "session:logout",
  listClassifications: "library:list-classifications",
  playerChooseLocalFile: "player:choose-local-file",
  playerCommand: "player:command",
  playerEvent: "player:event",
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
  player: {
    chooseLocalFile: () => ipcRenderer.invoke(IPC_CHANNELS.playerChooseLocalFile) as Promise<{ opened: boolean }>,
    command: (command: PlaybackCommand) => ipcRenderer.invoke(IPC_CHANNELS.playerCommand, command) as Promise<void>,
    onEvent: (listener: (event: PlaybackEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: PlaybackEvent) => listener(value);
      ipcRenderer.on(IPC_CHANNELS.playerEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.playerEvent, handler);
    },
  },
};

contextBridge.exposeInMainWorld("zVideo", api);
