/**
 * Pure pagination decisions for the local work list and the single-episode
 * list. Rendering the controls stays in the renderer; the maths and the input
 * validation live here so they are covered without a DOM.
 */

export interface PaginationModel {
  totalPages: number;
  page: number;
  pages: number[];
  status: string;
  firstDisabled: boolean;
  previousDisabled: boolean;
  nextDisabled: boolean;
  lastDisabled: boolean;
}

const PAGE_WINDOW = 5;

/** A whole page number inside [1, totalPages]; anything else falls back to 1. */
export function clampPage(value: number, totalPages: number): number {
  const last = Math.max(1, Math.floor(totalPages));
  if (!Number.isFinite(value) || !Number.isInteger(value)) return 1;
  return Math.min(last, Math.max(1, value));
}

/**
 * Jump input is a user-typed page number. A whole number outside the range is
 * clamped to the nearest valid page, the way paging buttons already behave;
 * empty or non-numeric text is rejected so the current page never changes.
 */
export function parseJumpTarget(raw: string, totalPages: number): number | undefined {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return undefined;
  return clampPage(Number(text), totalPages);
}

export function paginationModel(totalCount: number, pageSize: number, page: number): PaginationModel {
  const size = Math.max(1, Math.floor(pageSize));
  const count = Math.max(0, Math.floor(Number.isFinite(totalCount) ? totalCount : 0));
  const totalPages = Math.max(1, Math.ceil(count / size));
  const current = clampPage(page, totalPages);
  const start = Math.min(Math.max(1, current - Math.floor(PAGE_WINDOW / 2)), Math.max(1, totalPages - PAGE_WINDOW + 1));
  const end = Math.min(totalPages, start + PAGE_WINDOW - 1);
  const pages: number[] = [];
  for (let candidate = start; candidate <= end; candidate += 1) pages.push(candidate);
  return {
    totalPages,
    page: current,
    pages,
    status: `第 ${current} / ${totalPages} 页`,
    firstDisabled: current <= 1,
    previousDisabled: current <= 1,
    nextDisabled: current >= totalPages,
    lastDisabled: current >= totalPages,
  };
}
