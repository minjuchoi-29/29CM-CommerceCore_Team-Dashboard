import type { LinkedDoc } from "./etr-links";

export const DEFAULT_LINKED_DOC_LIMIT = 6;

export type DisplayLinkedDoc = LinkedDoc & {
  isLatestWeekly: boolean;
};

type DatedWeekly = { doc: LinkedDoc; date: number; series: string };

function datedWeekly(doc: LinkedDoc): DatedWeekly | null {
  if (!/weekly/i.test(doc.title)) return null;
  const match = doc.title.match(/(?:^|\[|\s)(20\d{2})[-./](\d{1,2})[-./](\d{1,2})(?:\]|\s|$)/);
  if (!match) return null;
  const date = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(date)) return null;
  const series = doc.title
    .replace(match[0], " ")
    .replace(/[\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return { doc, date, series };
}

/** Latest dated Weekly document per recurring title is pinned; older editions
 * remain reachable only after expanding the list. Other documents keep order. */
export function organizeLinkedDocs(
  docs: LinkedDoc[],
  limit = DEFAULT_LINKED_DOC_LIMIT,
): { visible: DisplayLinkedDoc[]; hidden: DisplayLinkedDoc[]; omittedWeeklyCount: number } {
  const weekly = docs.map(datedWeekly).filter((item): item is DatedWeekly => item !== null);
  const newestBySeries = new Map<string, DatedWeekly>();
  for (const item of weekly) {
    const current = newestBySeries.get(item.series);
    if (!current || item.date > current.date) newestBySeries.set(item.series, item);
  }

  const newestUrls = new Set(Array.from(newestBySeries.values(), item => item.doc.url));
  const weeklyUrls = new Set(weekly.map(item => item.doc.url));
  const pinned = Array.from(newestBySeries.values())
    .sort((a, b) => b.date - a.date)
    .map(({ doc }) => ({ ...doc, isLatestWeekly: true }));
  const regular = docs
    .filter(doc => !weeklyUrls.has(doc.url))
    .map(doc => ({ ...doc, isLatestWeekly: false }));
  const omittedWeeklyCount = weekly.filter(({ doc }) => !newestUrls.has(doc.url)).length;

  const primary = [...pinned, ...regular];
  const safeLimit = Math.max(1, limit);
  return {
    visible: primary.slice(0, safeLimit),
    hidden: primary.slice(safeLimit),
    omittedWeeklyCount,
  };
}
