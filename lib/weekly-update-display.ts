import type { WeeklyNote, WeeklySourceText } from "./weekly-types";

export type WeeklyUpdateDisplay = {
  sourceWeek: string;
  updatedAt: string;
  dateLabel: string;
  label: string;
  hasData: boolean;
};

function timestamp(value?: string): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function formatMonthDay(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getMonth() + 1}/${date.getDate()} 갱신`;
}

/**
 * 목록에서 사용할 Weekly 갱신 정보를 만든다.
 * 선택된 원문(cc-weekly-source-text)을 우선하고, legacy 데이터는 가장 최근 note로 보완한다.
 */
export function getWeeklyUpdateDisplay(
  source?: WeeklySourceText,
  notes: WeeklyNote[] = [],
): WeeklyUpdateDisplay {
  const latestNote = [...notes].sort((a, b) => {
    const updatedDelta = timestamp(b.lastSeenAt || b.sourceUpdatedAt)
      - timestamp(a.lastSeenAt || a.sourceUpdatedAt);
    if (updatedDelta !== 0) return updatedDelta;
    return b.sourceWeek.localeCompare(a.sourceWeek, "ko-KR", { numeric: true });
  })[0];

  const sourceWeek = source?.sourceWeek?.trim() || latestNote?.sourceWeek?.trim() || "";
  const updatedAt = source?.sourceUpdatedAt?.trim()
    || latestNote?.lastSeenAt?.trim()
    || latestNote?.sourceUpdatedAt?.trim()
    || "";
  const dateLabel = formatMonthDay(updatedAt);
  const label = [sourceWeek, dateLabel].filter(Boolean).join(" · ") || "Weekly 없음";

  return {
    sourceWeek,
    updatedAt,
    dateLabel,
    label,
    hasData: Boolean(sourceWeek || updatedAt),
  };
}
