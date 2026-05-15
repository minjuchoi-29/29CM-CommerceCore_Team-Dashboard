import {
  Ticket,
  RoleSchedule,
  PlanningEntry,
  TrackState,
  DevTrackKey,
  JiraTypeGroup,
} from "@/lib/types";
import { classifyType, isTicketOverdue } from "@/lib/derived/tickets";
import { computeHealth, HealthResult, HealthInput } from "@/lib/derived/health";

// Re-export types roadmap/page.tsx currently defines locally
export type { JiraTypeGroup, TrackState, DevTrackKey };

export type InitiativeSummary = {
  total: number;
  visibleTotal: number;
  byType: Record<JiraTypeGroup, number>;
  design: Record<TrackState, number>;
  dev: Record<TrackState, number>;
  devTracks: Record<DevTrackKey, number>;
  reviewNeeded: number;
  scheduleUndecided: number;
  scheduleEtaOverdue: number;
  roleActive: Record<string, number>;
  personActive: Record<string, number>;
  bottleneckCandidates: Array<{ level: "red" | "amber" | "gray"; message: string }>;
  health: HealthResult;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyTrackCount(): Record<TrackState, number> {
  return { "대기중": 0, "검토중": 0, "완료": 0, "대상아님": 0 };
}

function getPlanningEntry(raw: unknown): PlanningEntry {
  if (!raw || typeof raw !== "object") return {};
  const v = raw as Record<string, unknown>;
  return {
    design: (v.design as TrackState) ?? "대기중",
    dev: (v.dev as TrackState) ?? "대기중",
    devTracks: (v.devTracks as Partial<Record<DevTrackKey, TrackState>>) ?? {},
    reviewNeeded: (v.reviewNeeded as boolean) ?? false,
  };
}

function aggregateDevState(
  devTracks: Partial<Record<DevTrackKey, TrackState>>
): TrackState {
  const vals = Object.values(devTracks).filter(Boolean) as TrackState[];
  if (!vals.length) return "대기중";
  if (vals.every((v) => v === "대상아님")) return "대상아님";
  const active = vals.filter((v) => v !== "대상아님");
  if (!active.length) return "대상아님";
  if (active.some((v) => v === "대기중")) return "대기중";
  if (active.some((v) => v === "검토중")) return "검토중";
  return "완료";
}

function isScheduleUndecided(r: RoleSchedule): boolean {
  return (
    (!r.start && !r.end) || r.status === "미정" || r.status === "확인필요"
  );
}

function isScheduleOverdue(r: RoleSchedule, today: string): boolean {
  return !!r.end && r.end < today && r.status !== "완료";
}

function isScheduleActive(r: RoleSchedule): boolean {
  return (
    r.status === "진행중" || r.status === "예정" || r.status === "확인필요"
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function computeInitiativeSummary(
  linkedTicketKeys: string[],
  allTickets: Ticket[],
  planning: Record<string, unknown>,
  schedules: Record<string, RoleSchedule[]>,
  hiddenKeys: Set<string> = new Set()
): InitiativeSummary {
  const visibleKeys = linkedTicketKeys.filter((k) => !hiddenKeys.has(k));
  const today = new Date().toISOString().split("T")[0];

  const DONE = new Set([
    "론치완료",
    "완료",
    "배포완료",
    "개발완료",
  ]);

  const byType: Record<JiraTypeGroup, number> = {
    Initiative: 0,
    Epic: 0,
    Task: 0,
    기타: 0,
  };
  const design = emptyTrackCount();
  const dev = emptyTrackCount();
  const devTracks: Record<DevTrackKey, number> = {
    SP: 0,
    PP: 0,
    CFE: 0,
    기타: 0,
  };
  const roleActive: Record<string, number> = {};
  const personActive: Record<string, number> = {};
  let reviewNeeded = 0;
  let scheduleUndecided = 0;
  let scheduleEtaOverdue = 0;
  let blocked = 0;
  const bottleneckRaw: Array<{
    level: "red" | "amber" | "gray";
    message: string;
    dedup: string;
  }> = [];

  for (const key of visibleKeys) {
    const ticket = allTickets.find((t) => t.key === key);
    byType[classifyType(ticket?.type ?? "")]++;

    const p = getPlanningEntry(planning[key]);
    const designState: TrackState = p.design ?? "대기중";
    const devTracksRaw = p.devTracks ?? {};
    const devState: TrackState =
      Object.keys(devTracksRaw).length > 0
        ? aggregateDevState(devTracksRaw)
        : (p.dev ?? "대기중");

    design[designState]++;
    dev[devState]++;

    for (const tk of ["SP", "PP", "CFE", "기타"] as DevTrackKey[]) {
      const s = devTracksRaw[tk];
      if (s && s !== "완료" && s !== "대상아님") devTracks[tk]++;
    }

    if (p.reviewNeeded) {
      reviewNeeded++;
      bottleneckRaw.push({
        level: "red",
        message: `${key} — 검토 필요`,
        dedup: `rn-${key}`,
      });
    }
    if (designState === "검토중")
      bottleneckRaw.push({
        level: "gray",
        message: `${key} — Design 검토중`,
        dedup: `dg-${key}`,
      });
    if (devState === "검토중")
      bottleneckRaw.push({
        level: "amber",
        message: `${key} — Dev 검토중`,
        dedup: `dv-${key}`,
      });

    if (ticket && isTicketOverdue(ticket, today)) {
      bottleneckRaw.push({
        level: "red",
        message: `${key} — ETA 경과 (${ticket.eta})`,
        dedup: `eta-${key}`,
      });
    }

    const roles = schedules[key] ?? [];
    let hasUndecided = false;
    for (const r of roles) {
      if (isScheduleActive(r)) {
        roleActive[r.role] = (roleActive[r.role] ?? 0) + 1;
        if (r.person)
          personActive[r.person] = (personActive[r.person] ?? 0) + 1;
      }
      if (r.status === "확인필요") blocked++;
      if (isScheduleUndecided(r)) {
        hasUndecided = true;
        bottleneckRaw.push({
          level: "amber",
          message: `${key} · ${r.role} — 일정 ${r.status ?? "미정"}`,
          dedup: `ud-${key}-${r.role}`,
        });
      }
      if (isScheduleOverdue(r, today)) {
        scheduleEtaOverdue++;
        bottleneckRaw.push({
          level: "red",
          message: `${key} · ${r.role} — 기한 초과 (${r.end})`,
          dedup: `so-${key}-${r.role}`,
        });
      }
    }
    if (!roles.length && ticket && !DONE.has(ticket.status))
      hasUndecided = true;
    if (hasUndecided) scheduleUndecided++;
  }

  // Deduplicate bottlenecks
  const seen = new Set<string>();
  const bottleneckCandidates = bottleneckRaw
    .filter((b) => {
      if (seen.has(b.dedup)) return false;
      seen.add(b.dedup);
      return true;
    })
    .map(({ level, message }) => ({ level, message }));

  const healthInput: HealthInput = {
    reviewNeeded,
    overdue: bottleneckRaw.filter((b) => b.dedup.startsWith("eta-")).length,
    unscheduled: scheduleUndecided,
    blocked,
    total: visibleKeys.length,
  };
  const health = computeHealth(healthInput);

  return {
    total: linkedTicketKeys.length,
    visibleTotal: visibleKeys.length,
    byType,
    design,
    dev,
    devTracks,
    reviewNeeded,
    scheduleUndecided,
    scheduleEtaOverdue,
    roleActive,
    personActive,
    bottleneckCandidates,
    health,
  };
}
