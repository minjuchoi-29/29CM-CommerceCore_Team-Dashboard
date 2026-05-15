import { RoleSchedule, ScheduleEntry, StatusKind } from "@/lib/types";

export function classifyScheduleEntry(
  e: ScheduleEntry,
  today: string
): StatusKind {
  if (e.status === "완료") return "완료";
  if (e.end && e.end < today) return "기한초과";
  if (e.status === "진행중") return "진행중";
  if (e.status === "예정") return "예정";
  if (e.status === "확인필요") return "확인필요";
  return "미정";
}

export function isScheduleEntryUndecided(e: ScheduleEntry): boolean {
  if (e.status === "완료") return false;
  return (!e.start && !e.end) || e.status === "미정" || e.status === "확인필요";
}

export function overlapsMonth(
  start: string | undefined,
  end: string | undefined,
  ym: string
): boolean {
  const mStart = `${ym}-01`;
  const mEnd = `${ym}-31`;
  const s = start ?? mStart;
  const e = end ?? mEnd;
  return s <= mEnd && e >= mStart;
}

export type ResourceKpi = {
  ongoing: number;
  scheduled: number;
  needsCheck: number;
  undecided: number;
  overdue: number;
};

export function computeResourceKpi(
  entries: ScheduleEntry[],
  today: string
): ResourceKpi {
  let ongoing = 0,
    scheduled = 0,
    needsCheck = 0,
    undecided = 0,
    overdue = 0;
  for (const e of entries) {
    const kind = classifyScheduleEntry(e, today);
    if (kind === "진행중") ongoing++;
    if (kind === "예정") scheduled++;
    if (kind === "확인필요") needsCheck++;
    if (kind === "미정") undecided++;
    if (kind === "기한초과") overdue++;
  }
  return { ongoing, scheduled, needsCheck, undecided, overdue };
}

export function flattenSchedules(
  schedules: Record<string, RoleSchedule[]>,
  hiddenKeys: Set<string> = new Set()
): ScheduleEntry[] {
  const result: ScheduleEntry[] = [];
  for (const [ticketKey, roles] of Object.entries(schedules)) {
    if (hiddenKeys.has(ticketKey)) continue;
    for (const r of roles) {
      result.push({ ...r, ticketKey });
    }
  }
  return result;
}
