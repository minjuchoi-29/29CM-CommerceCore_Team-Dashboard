import { RoleSchedule } from "@/lib/types";

export const JIRA_BASE = "https://jira.team.musinsa.com/browse/";

/** 회의록·메신저에 바로 붙여 넣을 수 있는 Markdown 티켓 참조를 만든다. */
export function buildTicketReference(key: string, summary: string): string {
  const normalizedKey = key.trim();
  const normalizedSummary = summary.trim();
  return `[${normalizedKey}](${JIRA_BASE}${normalizedKey}) · ${normalizedSummary}`;
}

/** 클립보드에 "[KEY](URL) · 제목" 형식으로 복사 */
export async function copyTicketReference(
  key: string,
  summary: string
): Promise<void> {
  await navigator.clipboard.writeText(buildTicketReference(key, summary));
}

/** 주어진 티켓 키가 숨김 목록에 있는지 확인 */
export function isTicketHidden(key: string, hiddenKeys: Set<string>): boolean {
  return hiddenKeys.has(key);
}

/** 숨김 티켓 제외 필터 */
export function filterVisibleTickets<T extends { key: string }>(
  tickets: T[],
  hiddenKeys: Set<string>
): T[] {
  return tickets.filter((t) => !hiddenKeys.has(t.key));
}

/** cc-schedules에서 hidden 티켓 키에 해당하는 일정 제외 */
export function filterVisibleSchedules(
  schedules: Record<string, RoleSchedule[]>,
  hiddenKeys: Set<string>
): Record<string, RoleSchedule[]> {
  const result: Record<string, RoleSchedule[]> = {};
  for (const [key, roles] of Object.entries(schedules)) {
    if (!hiddenKeys.has(key)) result[key] = roles;
  }
  return result;
}
