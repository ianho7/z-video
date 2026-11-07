import type { LocalLibraryState } from "../../shared/local-library-contracts";

export function renderSources(next: LocalLibraryState, sourceId: string | undefined, allSourceCount: HTMLElement | null, sourceList: HTMLElement | null): void {
  if (allSourceCount) allSourceCount.textContent = String(next.sources.reduce((total, source) => total + source.itemCount, 0));
  if (sourceList) {
    sourceList.replaceChildren(...next.sources.map((source) => {
      const row = document.createElement("div");
      row.className = `source-row${sourceId === source.sourceId ? " selected" : ""}`;
      row.dataset.sourceId = source.sourceId;
      row.setAttribute("role", "listitem");
      const select = document.createElement("button");
      select.className = "source-select";
      select.type = "button";
      select.dataset.sourceId = source.sourceId;
      select.setAttribute("aria-pressed", String(sourceId === source.sourceId));
      const dot = document.createElement("span");
      dot.className = `source-dot${source.available ? "" : " offline"}`;
      const label = document.createElement("span");
      label.className = "source-label";
      label.textContent = source.label;
      const count = document.createElement("span");
      count.className = "source-count";
      count.textContent = String(source.itemCount);
      select.append(dot, label, count);
      const actions = document.createElement("span");
      actions.className = "source-actions";
      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = "source-action";
      refresh.dataset.refreshSourceId = source.sourceId;
      refresh.title = "刷新来源";
      refresh.setAttribute("aria-label", `刷新 ${source.label}`);
      refresh.textContent = "↻";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "source-action danger";
      remove.dataset.removeSourceId = source.sourceId;
      remove.title = "移除来源索引";
      remove.setAttribute("aria-label", `移除 ${source.label}`);
      remove.textContent = "×";
      actions.append(refresh, remove);
      row.append(select, actions);
      return row;
    }));
    if (next.sources.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "尚未添加来源";
      sourceList.append(empty);
    }
  }
}
