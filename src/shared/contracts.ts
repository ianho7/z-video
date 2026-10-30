/**
 * Renderer-safe contracts shared by the Electron main, preload and renderer.
 * Secrets, NAS tokens, opaque signs and private media paths intentionally do
 * not appear here.
 */

export type SessionStatus =
  | "logged-out"
  | "restoring"
  | "authenticating"
  | "mfa-required"
  | "authenticated"
  | "error";

export type AppView = "login" | "library" | "detail" | "player";

export interface AppError {
  kind: "network" | "unauthorized" | "business" | "malformed" | "storage" | "auth" | "unknown";
  code?: string;
  message: string;
}

export interface Classification {
  id: string;
  name: string;
  count: number;
  isSystem: boolean;
  isEnabled: boolean;
}

export interface Collection {
  collectionId: string;
  title: string;
  cover: string;
  releaseYear: string;
  videoType: string;
  score?: string;
  rating?: string;
  episodeCount?: number;
  storyline?: string;
  /** Main-process image key. The renderer never receives the NAS image path. */
  imageKey?: string;
  backgroundImageKey?: string;
}

/** Renderer-visible episode data. The main process resolves private media paths. */
export interface Episode {
  episodeId: string;
  episodeNumber: number;
  title: string;
  durationSec?: number;
  seasonNumber?: number;
}

export interface EpisodeSeason {
  seasonNumber: number;
  title: string;
  episodes: Episode[];
}

export interface ResumeState {
  episodeId: string;
  positionSec: number;
  audioIndex?: number;
  subtitleIndex?: number;
}

export interface CollectionDetail extends Collection {
  seasons: EpisodeSeason[];
  resume?: ResumeState;
}

export interface ContinueWatchingItem {
  collectionId: string;
  classificationId: string;
  episodeId: string;
  title: string;
  episodeTitle: string;
  imageKey?: string;
  watchedSeconds: number;
  durationSeconds?: number;
  progressPercent?: number;
  progressLabel: string;
  durationLabel: string;
}

export type LibraryFilter = "all" | "movie" | "tv" | "anime" | "show" | "diy";

export type LibraryCoverage = "server-page" | "loaded-page";

export interface LibraryQuery {
  classificationId: string;
  page: number;
  pageSize: number;
  query?: string;
  filter?: LibraryFilter;
  sort?: "recent" | "title";
}

export interface NavigationContext {
  view: AppView;
  library: LibraryQuery & { scrollTop: number };
  detail?: { collectionId: string; episodeId?: string; focusCollectionId?: string };
}

export interface LibraryPage {
  query: LibraryQuery;
  page: number;
  pageSize: number;
  totalCount?: number;
  totalPages?: number;
  loadedCount: number;
  coverage: LibraryCoverage;
  scopeDescription: string;
  collections: Collection[];
}

export interface LibraryPageResult {
  state: PublicSessionState;
  page?: LibraryPage;
}

export interface LibraryDetailResult {
  state: PublicSessionState;
  detail?: CollectionDetail;
}

export interface LibraryContinueWatchingResult {
  state: PublicSessionState;
  items: ContinueWatchingItem[];
}

export interface LibraryImageResult {
  state: PublicSessionState;
  dataUrl?: string;
  mimeType?: string;
}

export interface SessionIdentity {
  serverUrl: string;
  username: string;
  nasName?: string;
  nasId: string;
}

export interface PublicSessionState {
  status: SessionStatus;
  identity?: SessionIdentity;
  classifications: Classification[];
  error?: AppError;
  mfa?: { code: string; message: string };
}

export interface LoginInput {
  serverUrl: string;
  username: string;
  password: string;
  remember: boolean;
}

export interface LoginOutcome {
  state: PublicSessionState;
}

export interface OperationOutcome {
  state: PublicSessionState;
}

export type PlaybackCommand =
  | {
      type: "open";
      collectionId: string;
      classificationId: string;
      episodeId: string;
      startPositionSec?: number;
    }
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; positionSec: number }
  | { type: "set-audio-track"; trackId: string }
  | { type: "set-subtitle-track"; trackId: string | null }
  | { type: "fullscreen"; enabled: boolean }
  | { type: "close" };

export type PlaybackEvent =
  | { type: "loading"; episodeId: string }
  | { type: "ready"; episodeId: string; durationSec?: number }
  | { type: "state"; state: "playing" | "paused" | "buffering" | "ended" }
  | { type: "position"; episodeId: string; positionSec: number; durationSec?: number }
  | { type: "tracks"; audio: Array<{ id: string; label: string }>; subtitles: Array<{ id: string; label: string }> }
  | { type: "error"; episodeId?: string; message: string }
  | { type: "closed"; episodeId?: string };

export interface ElectronApi {
  session: {
    restore(): Promise<PublicSessionState>;
    login(input: LoginInput): Promise<LoginOutcome>;
    sendMfaCode(challengeType?: string): Promise<OperationOutcome>;
    verifyMfa(code: string): Promise<LoginOutcome>;
    logout(): Promise<OperationOutcome>;
  };
  library: {
    listClassifications(): Promise<{ classifications: Classification[]; state: PublicSessionState }>;
    listCollections(query: LibraryQuery): Promise<LibraryPageResult>;
    getDetail(input: { collectionId: string; classificationId: string }): Promise<LibraryDetailResult>;
    listContinueWatching(): Promise<LibraryContinueWatchingResult>;
    loadImage(input: { collectionId: string; kind: "cover" | "background" }): Promise<LibraryImageResult>;
    getNavigation(): Promise<NavigationContext>;
    setNavigation(context: NavigationContext): Promise<NavigationContext>;
  };
  /** Added by the native-player ticket; optional until its IPC owner lands. */
  player?: {
    send(command: PlaybackCommand): Promise<void>;
  };
}
