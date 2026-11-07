export function renderTrackOptions(select: HTMLSelectElement | null, tracks: Array<{ id: string; label: string; selected?: boolean }>, emptyLabel: string): void {
  if (!select) return;
  const options = [new Option(emptyLabel, ""), ...tracks.map((track) => {
    const option = new Option(track.label, track.id);
    option.selected = Boolean(track.selected);
    return option;
  })];
  select.replaceChildren(...options);
  select.value = tracks.find((track) => track.selected)?.id ?? "";
}
