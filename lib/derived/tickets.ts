import {
  Ticket,
  JiraTypeGroup,
  RoleSchedule,
  DONE_STATUSES,
  ACTIVE_STATUSES,
} from "@/lib/types";

export function classifyType(type: string): JiraTypeGroup {
  if (!type) return "기타";
  const t = type.toLowerCase();
  if (t.includes("initiative")) return "Initiative";
  if (t.includes("epic")) return "Epic";
  if (
    t.includes("task") ||
    t.includes("story") ||
    t.includes("bug") ||
    t.includes("subtask")
  )
    return "Task";
  return "기타";
}

export function isTicketDone(status: string): boolean {
  return DONE_STATUSES.has(status);
}

export function isTicketActive(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function isTicketOverdue(ticket: Ticket, today: string): boolean {
  return (
    !!ticket.eta &&
    ticket.eta !== "-" &&
    ticket.eta < today &&
    !isTicketDone(ticket.status)
  );
}

export function filterVisibleTickets<T extends { key: string }>(
  tickets: T[],
  hiddenKeys: Set<string>
): T[] {
  return tickets.filter((t) => !hiddenKeys.has(t.key));
}

export function filterVisibleSchedules(
  schedules: Record<string, RoleSchedule[]>,
  hiddenKeys: Set<string>
): Record<string, RoleSchedule[]> {
  const result: Record<string, RoleSchedule[]> = {};
  for (const [key, roles] of Object.entries(schedules)) {
    if (!hiddenKeys.has(key)) {
      result[key] = roles;
    }
  }
  return result;
}
