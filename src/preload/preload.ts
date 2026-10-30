import { contextBridge, ipcRenderer } from "electron";

import type {
  ElectronApi,
  LibraryQuery,
  NavigationContext,
  LoginInput,
  OperationOutcome,
  PublicSessionState,
  DiscoveryCancelOutcome,
  DiscoveryOutcome,
} from "../shared/contracts";

// Sandboxed preloads may require Electron's built-ins, but not local CommonJS
// modules. Keep these names identical to shared/ipc-channels.ts.
const IPC_CHANNELS = {
  restore: "session:restore",
  login: "session:login",
  sendMfa: "session:send-mfa",
  verifyMfa: "session:verify-mfa",
  logout: "session:logout",
  listClassifications: "library:list-classifications",
  listCollections: "library:list-collections",
  getCollectionDetail: "library:get-detail",
  listContinueWatching: "library:list-continue-watching",
  loadImage: "library:load-image",
  getNavigation: "library:get-navigation",
  setNavigation: "library:set-navigation",
  discoveryStart: "discovery:start",
  discoveryCancel: "discovery:cancel",
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
    listCollections: (query: LibraryQuery) => ipcRenderer.invoke(IPC_CHANNELS.listCollections, query),
    getDetail: (input: { collectionId: string; classificationId: string }) => ipcRenderer.invoke(IPC_CHANNELS.getCollectionDetail, input),
    listContinueWatching: () => ipcRenderer.invoke(IPC_CHANNELS.listContinueWatching),
    loadImage: (input: { collectionId: string; kind: "cover" | "background" }) => ipcRenderer.invoke(IPC_CHANNELS.loadImage, input),
    getNavigation: () => ipcRenderer.invoke(IPC_CHANNELS.getNavigation) as Promise<NavigationContext>,
    setNavigation: (context: NavigationContext) => ipcRenderer.invoke(IPC_CHANNELS.setNavigation, context) as Promise<NavigationContext>,
  },
  discovery: {
    start: () => ipcRenderer.invoke(IPC_CHANNELS.discoveryStart) as Promise<DiscoveryOutcome>,
    cancel: () => ipcRenderer.invoke(IPC_CHANNELS.discoveryCancel) as Promise<DiscoveryCancelOutcome>,
  },
};

contextBridge.exposeInMainWorld("zVideo", api);
