import type {
  AppError,
  Collection,
  CollectionDetail,
  ContinueWatchingItem,
  Episode,
  EpisodeSeason,
  LibraryDetailResult,
  LibraryFilter,
  LibraryImageResult,
  LibraryPage,
  LibraryPageResult,
  LibraryQuery,
  LibraryContinueWatchingResult,
  NavigationContext,
  PublicSessionState,
  ResumeState,
} from "../shared/contracts";
import { NasError, type AuthenticatedSession, type NasCollection, type NasCollectionDetail, type NasCollectionPage } from "./nas-client";
import { SessionController } from "./session-controller";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE_CACHE_ENTRIES = 8;
const MAX_DETAIL_CACHE_ENTRIES = 12;
const MAX_IMAGE_CACHE_ENTRIES = 64;
const MAX_IMAGE_CACHE_BYTES = 8 * 1024 * 1024;

interface DetailCacheEntry {
  classificationId: string;
  detail: NasCollectionDetail;
}

interface CachedImage {
  dataUrl: string;
  mimeType: string;
  bytes: number;
}

export interface LibraryImageRequest {
  collectionId: string;
  kind: "cover" | "background";
}

export interface LibraryDetailRequest {
  collectionId: string;
  classificationId: string;
}

export interface LibraryGateway {
  getCollections(session: AuthenticatedSession, classificationId: string, start: number, limit: number): Promise<NasCollectionPage>;
  getCollectionDetail(session: AuthenticatedSession, collectionId: string, classificationId: string): Promise<NasCollectionDetail>;
  fetchImage(session: AuthenticatedSession, imagePath: string): Promise<{ dataUrl: string; mimeType: string; bytes: number }>;
}

function defaultNavigation(): NavigationContext {
  return {
    view: "library",
    library: {
      classificationId: "",
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      filter: "all",
      sort: "recent",
      scrollTop: 0,
    },
  };
}

function appError(error: unknown, fallback: string): AppError {
  if (error instanceof NasError) {
    const kind: AppError["kind"] = error.kind === "http" || error.kind === "network" ? "network" : error.kind === "unauthorized" ? "unauthorized" : error.kind === "business" ? "business" : error.kind === "malformed" ? "malformed" : error.kind === "auth" || error.kind === "crypto" || error.kind === "mfa-required" ? "auth" : "unknown";
    return { kind, code: error.code, message: error.message || fallback };
  }
  return { kind: "unknown", message: error instanceof Error && error.message ? error.message : fallback };
}

function normalizeQuery(query: LibraryQuery): LibraryQuery {
  const classificationId = query.classificationId.trim();
  if (!classificationId) throw new NasError("malformed", "影视列表请求缺少 classification_id");
  const page = Number.isInteger(query.page) && query.page > 0 ? query.page : 1;
  const pageSize = Number.isInteger(query.pageSize) && query.pageSize > 0 ? Math.min(query.pageSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const search = query.query?.trim();
  return {
    classificationId,
    page,
    pageSize,
    ...(search ? { query: search.slice(0, 200) } : {}),
    filter: query.filter ?? "all",
    sort: query.sort ?? "recent",
  };
}

function queryKey(query: LibraryQuery): string {
  return `${query.classificationId}|${query.page}|${query.pageSize}`;
}

function detailKey(collectionId: string, classificationId: string): string {
  return `${classificationId}|${collectionId}`;
}

function imageKey(collectionId: string, kind: LibraryImageRequest["kind"]): string {
  return `${collectionId}|${kind}`;
}

function mapCollection(item: NasCollection): Collection {
  return {
    collectionId: item.collectionId,
    title: item.title || "未命名影视",
    cover: "",
    releaseYear: item.releaseYear,
    videoType: item.videoType,
    score: item.score,
    rating: item.rating,
    episodeCount: item.episodeCount,
    storyline: item.storyline,
    ...(item.coverPath ? { imageKey: imageKey(item.collectionId, "cover") } : {}),
    ...(item.backgroundPath ? { backgroundImageKey: imageKey(item.collectionId, "background") } : {}),
  };
}

function mapEpisode(episode: NasCollectionDetail["seasons"][number]["episodes"][number]): Episode {
  return {
    episodeId: episode.episodeId,
    episodeNumber: episode.episodeNumber,
    title: episode.title || `第${episode.episodeNumber}集`,
    ...(episode.durationSec !== undefined ? { durationSec: episode.durationSec } : {}),
    seasonNumber: episode.seasonNumber,
  };
}

function episodeMatches(episode: NasCollectionDetail["seasons"][number]["episodes"][number], identifier: string): boolean {
  const expected = identifier.trim();
  return Boolean(expected) && [episode.episodeId, episode.filePath, episode.versionId].some((candidate) => Boolean(candidate?.trim()) && candidate!.trim() === expected);
}

function mapResume(detail: NasCollectionDetail): ResumeState | undefined {
  const history = detail.history;
  if (!history?.playDurationSec || history.playDurationSec <= 0) return undefined;
  const episodes = detail.seasons.flatMap((season) => season.episodes);
  let selected = history.lastVideoId ? episodes.find((episode) => episodeMatches(episode, history.lastVideoId!)) : undefined;
  if (!selected && episodes.length === 1) selected = episodes[0];
  if (!selected) return undefined;
  return {
    episodeId: selected.episodeId,
    positionSec: history.playDurationSec,
    ...(history.audioIndex !== undefined ? { audioIndex: history.audioIndex } : {}),
    ...(history.subtitleIndex !== undefined ? { subtitleIndex: history.subtitleIndex } : {}),
  };
}

function mapDetail(detail: NasCollectionDetail): CollectionDetail {
  const collection = mapCollection(detail);
  const seasons: EpisodeSeason[] = detail.seasons.map((season) => ({
    seasonNumber: season.seasonNumber,
    title: season.title || `第${season.seasonNumber}季`,
    episodes: season.episodes.map(mapEpisode),
  }));
  return { ...collection, seasons, resume: mapResume(detail) };
}

function normalizedType(value: string): string {
  return value.trim().toLowerCase();
}

function matchesFilter(collection: Collection, filter: LibraryFilter): boolean {
  if (filter === "all") return true;
  const type = normalizedType(collection.videoType);
  if (filter === "movie") return ["movie", "film", "100", "电影"].includes(type);
  if (filter === "tv") return ["tv", "series", "电视剧", "剧集"].includes(type);
  if (filter === "anime") return ["anime", "动漫"].includes(type);
  if (filter === "show") return ["show", "综艺"].includes(type);
  return type === "diy" || type === "自建合集";
}

function compareText(left: Collection, right: Collection): number {
  const leftTitle = left.title.toLowerCase();
  const rightTitle = right.title.toLowerCase();
  if (leftTitle < rightTitle) return -1;
  if (leftTitle > rightTitle) return 1;
  if (left.collectionId < right.collectionId) return -1;
  if (left.collectionId > right.collectionId) return 1;
  return 0;
}

function numericValue(value?: string): number | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function integerValue(value?: string): number | undefined {
  const normalized = value?.trim();
  if (!normalized || !/^[+-]?\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed >= -2147483648 && parsed <= 2147483647 ? parsed : undefined;
}

function effectiveScore(collection: Collection): string | undefined {
  const score = collection.score;
  if (score !== undefined && score !== "" && score !== "0" && score !== "0.0") return score;
  const rating = collection.rating;
  if (rating !== undefined && rating !== "" && rating !== "0" && rating !== "0.0") return rating;
  return undefined;
}

function compareOptionalNumberDescending(left: number | undefined, right: number | undefined): number {
  if (left !== undefined && right !== undefined) {
    if (left > right) return -1;
    if (left < right) return 1;
    return 0;
  }
  if (left !== undefined) return -1;
  if (right !== undefined) return 1;
  return 0;
}

function compareScoreDescending(left: Collection, right: Collection): number {
  return compareOptionalNumberDescending(numericValue(effectiveScore(left)), numericValue(effectiveScore(right))) || compareText(left, right);
}

function compareReleaseYearDescending(left: Collection, right: Collection): number {
  return compareOptionalNumberDescending(integerValue(left.releaseYear), integerValue(right.releaseYear)) || compareText(left, right);
}

function formatWatchTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function buildContinueWatchingItem(collectionId: string, classificationId: string, detail: NasCollectionDetail): ContinueWatchingItem | undefined {
  const resume = mapResume(detail);
  if (!resume) return undefined;
  const episode = detail.seasons.flatMap((season) => season.episodes).find((candidate) => candidate.episodeId === resume.episodeId);
  if (!episode) return undefined;
  const durationSeconds = episode.durationSec;
  const progressPercent = durationSeconds && durationSeconds > 0 ? Math.min(100, Math.floor((resume.positionSec * 100) / durationSeconds)) : undefined;
  return {
    collectionId,
    classificationId,
    episodeId: episode.episodeId,
    title: detail.title || "未命名影视",
    episodeTitle: episode.title || `第${episode.episodeNumber}集`,
    ...(detail.coverPath ? { imageKey: imageKey(collectionId, "cover") } : {}),
    watchedSeconds: resume.positionSec,
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(progressPercent !== undefined ? { progressPercent } : {}),
    progressLabel: progressPercent !== undefined ? `已看 ${progressPercent}%` : `已看 ${formatWatchTime(resume.positionSec)}`,
    durationLabel: durationSeconds !== undefined ? formatWatchTime(durationSeconds) : "时长未知",
  };
}

export class LibraryController {
  private readonly pageCache = new Map<string, NasCollectionPage>();
  private readonly detailCache = new Map<string, DetailCacheEntry>();
  private readonly imagePaths = new Map<string, string>();
  private readonly imageCache = new Map<string, CachedImage>();
  private imageCacheBytes = 0;
  private navigation: NavigationContext = defaultNavigation();
  private requestGeneration = 0;
  private activeSessionKey?: string;

  constructor(
    private readonly sessions: SessionController,
    private readonly nas: LibraryGateway,
  ) {}

  async listCollections(input: LibraryQuery): Promise<LibraryPageResult> {
    let query: LibraryQuery;
    try {
      query = normalizeQuery(input);
    } catch (error) {
      return { state: this.sessions.getPublicState(appError(error, "片库查询参数无效")) };
    }
    const generation = ++this.requestGeneration;
    const session = this.sessions.getAuthenticatedSession();
    if (!session) {
      this.clearCaches();
      return { state: { status: "logged-out", classifications: [], error: { kind: "unauthorized", message: "请先登录 NAS" } } };
    }
    this.ensureSession(session);
    try {
      const key = queryKey(query);
      let raw = this.pageCache.get(key);
      if (!raw) {
        raw = await this.nas.getCollections(session, query.classificationId, (query.page - 1) * query.pageSize + 1, query.pageSize);
        if (generation >= this.requestGeneration) this.rememberPage(key, raw);
      } else {
        this.touchPage(key, raw);
      }
      const page = this.toPage(query, raw);
      if (generation === this.requestGeneration) {
        this.navigation = { ...this.navigation, view: "library", library: { ...this.navigation.library, ...query, scrollTop: this.navigation.library.scrollTop } };
      }
      return { state: this.sessions.getPublicState(), page };
    } catch (error) {
      return await this.handleError(error, "片库加载失败");
    }
  }

  async getDetail(input: LibraryDetailRequest): Promise<LibraryDetailResult> {
    const collectionId = input.collectionId.trim();
    const classificationId = input.classificationId.trim();
    if (!collectionId || !classificationId) return { state: this.sessions.getPublicState({ kind: "malformed", message: "详情请求缺少 collection_id 或 classification_id" }) };
    const session = this.sessions.getAuthenticatedSession();
    if (!session) {
      this.clearCaches();
      return { state: { status: "logged-out", classifications: [], error: { kind: "unauthorized", message: "请先登录 NAS" } } };
    }
    this.ensureSession(session);
    const key = detailKey(collectionId, classificationId);
    try {
      let entry = this.detailCache.get(key);
      if (!entry) {
        entry = { classificationId, detail: await this.nas.getCollectionDetail(session, collectionId, classificationId) };
        this.rememberDetail(key, entry);
      } else {
        this.touchDetail(key, entry);
      }
      this.rememberImagePath(collectionId, "cover", entry.detail.coverPath);
      this.rememberImagePath(collectionId, "background", entry.detail.backgroundPath);
      const detail = mapDetail(entry.detail);
      this.navigation = {
        ...this.navigation,
        view: "detail",
        detail: { collectionId, focusCollectionId: collectionId },
      };
      return { state: this.sessions.getPublicState(), detail };
    } catch (error) {
      return await this.handleError(error, "详情加载失败");
    }
  }

  async listContinueWatching(): Promise<LibraryContinueWatchingResult> {
    const session = this.sessions.getAuthenticatedSession();
    if (!session) {
      this.clearCaches();
      return { state: { status: "logged-out", classifications: [], error: { kind: "unauthorized", message: "请先登录 NAS" } }, items: [] };
    }
    this.ensureSession(session);
    const items: ContinueWatchingItem[] = [];
    for (const [key, entry] of this.detailCache) {
      const [classificationId, collectionId] = key.split("|", 2);
      const item = buildContinueWatchingItem(collectionId, classificationId, entry.detail);
      if (item) items.push(item);
    }
    return { state: this.sessions.getPublicState(), items };
  }

  async loadImage(input: LibraryImageRequest): Promise<LibraryImageResult> {
    const collectionId = input.collectionId.trim();
    if (!collectionId) return { state: this.sessions.getPublicState({ kind: "malformed", message: "图片请求缺少 collection_id" }) };
    const session = this.sessions.getAuthenticatedSession();
    if (!session) {
      this.clearCaches();
      return { state: { status: "logged-out", classifications: [], error: { kind: "unauthorized", message: "请先登录 NAS" } } };
    }
    this.ensureSession(session);
    const pathKey = imageKey(collectionId, input.kind);
    const imagePath = this.imagePaths.get(pathKey);
    if (!imagePath) return { state: this.sessions.getPublicState({ kind: "malformed", message: "当前条目没有可用封面" }) };
    const cached = this.imageCache.get(pathKey);
    if (cached) {
      this.touchImage(pathKey, cached);
      return { state: this.sessions.getPublicState(), dataUrl: cached.dataUrl, mimeType: cached.mimeType };
    }
    try {
      const image = await this.nas.fetchImage(session, imagePath);
      this.rememberImage(pathKey, image);
      return { state: this.sessions.getPublicState(), dataUrl: image.dataUrl, mimeType: image.mimeType };
    } catch (error) {
      return await this.handleError(error, "封面加载失败");
    }
  }

  getNavigation(): NavigationContext {
    return cloneNavigation(this.navigation);
  }

  setNavigation(context: NavigationContext): NavigationContext {
    this.navigation = normalizeNavigation(context);
    return this.getNavigation();
  }

  private toPage(query: LibraryQuery, raw: NasCollectionPage): LibraryPage {
    const allCollections = raw.list.map((item) => {
      const collection = mapCollection(item);
      this.rememberImagePath(collection.collectionId, "cover", item.coverPath);
      this.rememberImagePath(collection.collectionId, "background", item.backgroundPath);
      return collection;
    });
    const filtered = allCollections.filter((item) => matchesFilter(item, query.filter ?? "all"));
    if (query.query) {
      const needle = query.query.toLocaleLowerCase();
      filtered.splice(0, filtered.length, ...filtered.filter((item) => [item.title, item.releaseYear, item.videoType, item.storyline ?? ""].join(" ").toLocaleLowerCase().includes(needle)));
    }
    if (query.sort === "title") filtered.sort(compareText);
    if (query.sort === "score_desc") filtered.sort(compareScoreDescending);
    if (query.sort === "release_year_desc") filtered.sort(compareReleaseYearDescending);
    const localSort = query.sort === "title" || query.sort === "score_desc" || query.sort === "release_year_desc";
    const totalCount = raw.count;
    const totalPages = totalCount !== undefined ? Math.max(1, Math.ceil(totalCount / query.pageSize)) : undefined;
    const scopeDescription = totalCount === undefined
      ? `当前已加载范围：第 ${query.page} 页 ${filtered.length}/${allCollections.length} 项；服务端未提供总数`
      : `当前已加载范围：第 ${query.page} 页 ${filtered.length}/${totalCount} 项；共 ${totalPages} 页`;
    return {
      query,
      page: query.page,
      pageSize: query.pageSize,
      ...(totalCount !== undefined ? { totalCount } : {}),
      ...(totalPages !== undefined ? { totalPages } : {}),
      loadedCount: allCollections.length,
      coverage: query.query || query.filter !== "all" || localSort ? "loaded-page" : "server-page",
      scopeDescription,
      collections: filtered,
    };
  }

  private async handleError<T extends { state: PublicSessionState }>(error: unknown, fallback: string): Promise<T> {
    const mapped = appError(error, fallback);
    if (mapped.kind === "unauthorized") {
      this.clearCaches();
      return { state: await this.sessions.invalidate(mapped) } as unknown as T;
    }
    return { state: this.sessions.getPublicState(mapped) } as T;
  }

  private rememberPage(key: string, value: NasCollectionPage): void {
    this.pageCache.delete(key);
    this.pageCache.set(key, value);
    while (this.pageCache.size > MAX_PAGE_CACHE_ENTRIES) this.pageCache.delete(this.pageCache.keys().next().value!);
  }

  private touchPage(key: string, value: NasCollectionPage): void {
    this.pageCache.delete(key);
    this.pageCache.set(key, value);
  }

  private rememberDetail(key: string, value: DetailCacheEntry): void {
    this.detailCache.delete(key);
    this.detailCache.set(key, value);
    while (this.detailCache.size > MAX_DETAIL_CACHE_ENTRIES) this.detailCache.delete(this.detailCache.keys().next().value!);
  }

  private touchDetail(key: string, value: DetailCacheEntry): void {
    this.detailCache.delete(key);
    this.detailCache.set(key, value);
  }

  private rememberImagePath(collectionId: string, kind: LibraryImageRequest["kind"], path: string): void {
    if (path.trim()) this.imagePaths.set(imageKey(collectionId, kind), path);
  }

  private rememberImage(key: string, image: CachedImage): void {
    const previous = this.imageCache.get(key);
    if (previous) this.imageCacheBytes -= previous.bytes;
    this.imageCache.delete(key);
    this.imageCache.set(key, image);
    this.imageCacheBytes += image.bytes;
    while (this.imageCache.size > MAX_IMAGE_CACHE_ENTRIES || this.imageCacheBytes > MAX_IMAGE_CACHE_BYTES) {
      const oldestKey = this.imageCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldest = this.imageCache.get(oldestKey);
      if (oldest) this.imageCacheBytes -= oldest.bytes;
      this.imageCache.delete(oldestKey);
    }
  }

  private touchImage(key: string, image: CachedImage): void {
    this.imageCache.delete(key);
    this.imageCache.set(key, image);
  }

  private ensureSession(session: AuthenticatedSession): void {
    const key = `${session.baseUrl}|${session.username}|${session.nasId ?? ""}`;
    if (this.activeSessionKey === key) return;
    this.clearCaches();
    this.activeSessionKey = key;
  }

  private clearCaches(): void {
    this.pageCache.clear();
    this.detailCache.clear();
    this.imagePaths.clear();
    this.imageCache.clear();
    this.imageCacheBytes = 0;
    this.activeSessionKey = undefined;
  }
}

function normalizeNavigation(context: NavigationContext): NavigationContext {
  const query = normalizeQuery(context.library);
  return {
    view: context.view === "detail" ? "detail" : "library",
    library: { ...query, scrollTop: Number.isFinite(context.library.scrollTop) && context.library.scrollTop >= 0 ? context.library.scrollTop : 0 },
    ...(context.detail ? { detail: { collectionId: context.detail.collectionId.trim(), ...(context.detail.episodeId ? { episodeId: context.detail.episodeId.trim() } : {}), ...(context.detail.focusCollectionId ? { focusCollectionId: context.detail.focusCollectionId.trim() } : {}) } } : {}),
  };
}

function cloneNavigation(context: NavigationContext): NavigationContext {
  return {
    view: context.view,
    library: { ...context.library },
    ...(context.detail ? { detail: { ...context.detail } } : {}),
  };
}

