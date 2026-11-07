import type { LocalLibraryState, LocalScanProgress } from "../../shared/local-library-contracts";
export function renderSources(next: LocalLibraryState, progress: LocalScanProgress | undefined, sourceList: HTMLElement | null): void {
  if (!sourceList) return;
  sourceList.replaceChildren(...next.sources.map((source) => {
    const row = document.createElement("article"); row.className = "source-card"; row.setAttribute("role", "listitem");
    const title = document.createElement("h2"); title.textContent = source.label;
    const count = document.createElement("p"); count.className = "source-card-count"; count.textContent = String(source.itemCount);
    const caption = document.createElement("p"); caption.textContent = "个媒体条目";
    const status = document.createElement("span"); status.className = "source-chip";
    const current = progress?.sourceId === source.sourceId ? progress.status : undefined;
    status.textContent = current === "running" ? "扫描中" : current === "partial" ? "部分完成" : !source.available || current === "unavailable" ? "离线" : "可用";
    const actions = document.createElement("div"); actions.className = "source-card-actions";
    const refresh = document.createElement("button"); refresh.type = "button"; refresh.className = "secondary-button"; refresh.dataset.refreshSourceId = source.sourceId; refresh.textContent = "重新扫描"; if (current === "running") { delete refresh.dataset.refreshSourceId; refresh.dataset.cancelSourceScan = source.sourceId; refresh.textContent = "取消扫描"; } else refresh.disabled = progress?.status === "running";
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary-button"; remove.dataset.removeSourceId = source.sourceId; remove.textContent = "移除"; remove.disabled = progress?.status === "running";
    actions.append(refresh, remove); row.append(status, title, count, caption, actions); return row;
  }));
  if (!next.sources.length) { const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "尚未添加来源"; sourceList.append(empty); }
}
