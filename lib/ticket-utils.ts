import { RoleSchedule } from "@/lib/types";

export const JIRA_BASE = "https://jira.team.musinsa.com/browse/";

/** 클립보드에 "[KEY] 제목\nURL" 형식으로 복사 */
export async function copyTicketReference(
  key: string,
  summary: string
): Promise<void> {
  const text = `[${key}] ${summary}\n${JIRA_BASE}${key}`;
  await navigator.clipboard.writeText(text);
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
