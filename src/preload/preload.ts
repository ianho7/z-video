import { contextBridge, ipcRenderer } from "electron";

import type {
  ElectronApi,
  LibraryQuery,
  NavigationContext,
  LoginInput,
  OperationOutcome,
  PlaybackCommand,
  PlaybackEvent,
  PublicSessionState,
  DiscoveryCancelOutcome,
  DiscoveryOutcome,
  WindowAppearanceState,
  LocalLibraryQuery,
} from "../shared/contracts";

// Sandboxed preloads may require Electron's built-ins, but not local CommonJS
// modules. Keep these names identical to shared/ipc-channels.ts.
const IPC_CHANNELS = {
  localLibraryState: "local-library:state",
  localLibraryChooseFolder: "local-library:choose-folder",
  localLibraryOpenVideo: "local-library:open-video",
  localLibraryList: "local-library:list",
  localLibraryGet: "local-library:get",
  restore: "session:restore",
  login: "session:login",
  sendMfa: "session:send-mfa",
  verifyMfa: "session:verify-mfa",
  logout: "session:logout",
  sessionState: "session:state",
  appearanceState: "appearance:state",
  listClassifications: "library:list-classifications",
  playerChooseLocalFile: "player:choose-local-file",
  playerChooseSubtitleFile: "player:choose-subtitle-file",
  playerCommand: "player:command",
  playerEvent: "player:event",
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
  localLibrary: {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.localLibraryState),
    chooseFolder: () => ipcRenderer.invoke(IPC_CHANNELS.localLibraryChooseFolder),
    openVideo: () => ipcRenderer.invoke(IPC_CHANNELS.localLibraryOpenVideo),
    list: (query?: Partial<LocalLibraryQuery>) => ipcRenderer.invoke(IPC_CHANNELS.localLibraryList, query),
    get: (mediaId: string) => ipcRenderer.invoke(IPC_CHANNELS.localLibraryGet, mediaId),
    onState: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value);
      ipcRenderer.on(IPC_CHANNELS.localLibraryState, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.localLibraryState, handler);
    },
  },
  appearance: {
    onState: (listener: (state: WindowAppearanceState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: WindowAppearanceState) => listener(value);
      ipcRenderer.on(IPC_CHANNELS.appearanceState, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.appearanceState, handler);
    },
  },
  session: {
    restore: () => ipcRenderer.invoke(IPC_CHANNELS.restore) as Promise<PublicSessionState>,
    login: (input: LoginInput) => ipcRenderer.invoke(IPC_CHANNELS.login, input) as Promise<{ state: PublicSessionState }>,
    sendMfaCode: (challengeType?: string) => ipcRenderer.invoke(IPC_CHANNELS.sendMfa, challengeType) as Promise<OperationOutcome>,
    verifyMfa: (code: string) => ipcRenderer.invoke(IPC_CHANNELS.verifyMfa, code) as Promise<{ state: PublicSessionState }>,
    logout: () => ipcRenderer.invoke(IPC_CHANNELS.logout) as Promise<OperationOutcome>,
    onState: (listener: (state: PublicSessionState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: PublicSessionState) => listener(value);
      ipcRenderer.on(IPC_CHANNELS.sessionState, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.sessionState, handler);
    },
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
  player: {
    chooseLocalFile: () => ipcRenderer.invoke(IPC_CHANNELS.playerChooseLocalFile) as Promise<{ opened: boolean }>,
    chooseSubtitleFile: () => ipcRenderer.invoke(IPC_CHANNELS.playerChooseSubtitleFile) as Promise<{ loaded: boolean }>,
    command: (command: PlaybackCommand) => ipcRenderer.invoke(IPC_CHANNELS.playerCommand, command) as Promise<void>,
    send: (command: PlaybackCommand) => ipcRenderer.invoke(IPC_CHANNELS.playerCommand, command) as Promise<void>,
    onEvent: (listener: (event: PlaybackEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: PlaybackEvent) => listener(value);
      ipcRenderer.on(IPC_CHANNELS.playerEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.playerEvent, handler);
    },
  },
  discovery: {
    start: () => ipcRenderer.invoke(IPC_CHANNELS.discoveryStart) as Promise<DiscoveryOutcome>,
    cancel: () => ipcRenderer.invoke(IPC_CHANNELS.discoveryCancel) as Promise<DiscoveryCancelOutcome>,
  },
};

contextBridge.exposeInMainWorld("zVideo", api);
