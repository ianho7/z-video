import type { LocalLibraryState, LocalScanProgress, LocalSourceSummary } from "../../shared/local-library-contracts";

export interface RenderSourcesOptions {
  /** Source IDs registered by "添加单个视频" during this session. */
  singleVideoSourceIds?: ReadonlySet<string>;
}

function statusFor(source: LocalSourceSummary, progress: LocalScanProgress | undefined): { label: string; tone: "ok" | "warning" | "busy" | "muted" } {
  const current = progress?.sourceId === source.sourceId ? progress.status : undefined;
  if (current === "running") return { label: "扫描中", tone: "busy" };
  if (current === "partial") return { label: "部分完成", tone: "warning" };
  if (current === "unavailable" || !source.available) return { label: "离线", tone: "warning" };
  return { label: "可用", tone: "ok" };
}

function sourceNote(source: LocalSourceSummary, singleVideo: boolean): string | undefined {
  const notes: string[] = [];
  if (!source.available) notes.push("暂时无法读取。接回驱动器或网络位置后点“重新扫描”，已加入的作品和观看进度仍保留。");
  if (singleVideo) notes.push("由“添加单个视频”登记。这次只加入了选中的文件；以后重新扫描会把整个文件夹里的其他支持视频也加入片库。");
  return notes.length ? notes.join(" ") : undefined;
}

export function renderSources(next: LocalLibraryState, progress: LocalScanProgress | undefined, sourceList: HTMLElement | null, options: RenderSourcesOptions = {}): void {
  if (!sourceList) return;
  const anyScanRunning = progress?.status === "running";
  sourceList.replaceChildren(...next.sources.map((source) => {
    const row = document.createElement("article");
    row.className = "source-card";
    row.setAttribute("role", "listitem");
    row.dataset.sourceCardId = source.sourceId;
    if (!source.available) row.dataset.available = "false";
    const current = progress?.sourceId === source.sourceId ? progress.status : undefined;
    const scanningThis = current === "running";

    const head = document.createElement("div");
    head.className = "source-card-head";
    const status = document.createElement("span");
    const statusInfo = statusFor(source, progress);
    status.className = `source-chip source-chip-${statusInfo.tone}`;
    status.textContent = statusInfo.label;
    head.append(status);
    if (options.singleVideoSourceIds?.has(source.sourceId)) {
      const tag = document.createElement("span");
      tag.className = "source-tag";
      tag.textContent = "由添加单个视频登记";
      head.append(tag);
    }

    const title = document.createElement("h2");
    title.textContent = source.label;
    const location = document.createElement("p");
    location.className = "location-hint";
    location.textContent = source.locationHint;
    const counts = document.createElement("p");
    counts.className = "source-card-counts";
    const works = document.createElement("b");
    works.textContent = String(source.collectionCount);
    const episodes = document.createElement("b");
    episodes.textContent = String(source.itemCount);
    counts.append(works, " 部作品 / ", episodes, " 集");

    const noteText = sourceNote(source, options.singleVideoSourceIds?.has(source.sourceId) ?? false);
    const note = document.createElement("p");
    note.className = "source-card-note";
    if (noteText) note.textContent = noteText;

    const actions = document.createElement("div");
    actions.className = "source-card-actions";
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "secondary-button";
    refresh.dataset.refreshSourceId = source.sourceId;
    refresh.textContent = "重新扫描";
    if (scanningThis) {
      delete refresh.dataset.refreshSourceId;
      refresh.dataset.cancelSourceScan = source.sourceId;
      refresh.textContent = "取消扫描";
    } else {
      refresh.disabled = anyScanRunning;
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost-button source-remove-button";
    remove.dataset.removeSourceId = source.sourceId;
    remove.textContent = "移除";
    remove.disabled = anyScanRunning;
    actions.append(refresh, remove);

    row.append(head, title, location, counts);
    if (noteText) row.append(note);
    row.append(actions);
    return row;
  }));
  if (!next.sources.length) {
    const empty = document.createElement("div");
    empty.className = "source-empty";
    const title = document.createElement("h2");
    title.textContent = "还没有添加文件夹";
    const copy = document.createElement("p");
    copy.textContent = "添加文件夹后，这里会显示它的盘符或上级线索、作品数和集数；也可以添加单个视频，应用会登记它所在的文件夹。";
    empty.append(title, copy);
    sourceList.append(empty);
  }
}
