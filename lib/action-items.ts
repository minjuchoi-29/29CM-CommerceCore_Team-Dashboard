/**
 * lib/action-items.ts
 *
 * Product OS — Action Guidance 시스템
 * 티켓의 현재 상태(planning, schedule, etr)를 분석해 담당자가 해야 할 액션을 반환.
 *
 * TicketBoard.tsx와 OwnerDashboard.tsx 양쪽에서 공유.
 */

import type { Ticket } from "@/app/jira-tickets/TicketBoard";

// ── 최소 타입 정의 (TicketBoard와 구조적으로 호환) ─────────────────────────

export type TrackState = "대기중" | "검토중" | "완료" | "대상아님";
export type DevTrackKey = "SP" | "PP" | "CFE" | "Mobile" | "DFE" | "QA" | "기타";

export type RoleScheduleMin = {
  role: string;
  start?: string;
};

export type EtrInfoMin = {
  // PR-X: source 일반화 — ETR / ELT / 자체발의 모두 동등 처리.
  source?: "자체발의" | "ELT" | "ETR";
  etrTickets?: { key: string }[];
  wikiLinks?: { url: string; title: string }[];
};

export type ActionItem = {
  id: string;
  /** 낮을수록 우선순위 높음 (1=critical~7=info) */
  priority: number;
  level: "critical" | "warning" | "info";
  label: string;
  /** 클릭 시 이동할 탭 */
  targetTab?: "ops";
};

// ── Planning 상태 파싱 helper (TicketBoard.getPlanningVal과 동일 로직) ──────

function aggregateDevStateLocal(devTracks: Partial<Record<DevTrackKey, TrackState>>): TrackState {
  const values = Object.values(devTracks).filter(Boolean) as TrackState[];
  if (values.length === 0) return "대기중";
  if (values.every(v => v === "대상아님")) return "대상아님";
  const active = values.filter(v => v !== "대상아님");
  if (active.length === 0) return "대상아님";
  if (active.some(v => v === "대기중")) return "대기중";
  if (active.some(v => v === "검토중")) return "검토중";
  return "완료";
}

export function parsePlanningVal(val: unknown): {
  design: TrackState;
  dev: TrackState;
  devTracks: Partial<Record<DevTrackKey, TrackState>>;
  reviewNeeded: boolean;
} {
  if (!val || typeof val === "string")
    return { design: "대기중", dev: "대기중", devTracks: {}, reviewNeeded: false };
  const v = val as Record<string, unknown>;
  const devTracks = (v.devTracks as Partial<Record<DevTrackKey, TrackState>>) ?? {};
  const devTracksHasEntries = Object.keys(devTracks).length > 0;
  return {
    design: (v.design as TrackState) ?? "대기중",
    dev: devTracksHasEntries
      ? aggregateDevStateLocal(devTracks)
      : ((v.dev as TrackState) ?? "대기중"),
    devTracks,
    reviewNeeded: (v.reviewNeeded as boolean) ?? false,
  };
}

// ── 메인 함수 ───────────────────────────────────────────────────────────────

/**
 * 티켓 하나에 대한 Action Item 목록을 반환.
 * 완료 티켓은 빈 배열 반환.
 * priority 오름차순(1=가장 중요) 정렬.
 */
export function getActionItems(
  ticket: Ticket,
  planningVal: unknown,
  roles: RoleScheduleMin[],
  etrEntry: EtrInfoMin | undefined
): ActionItem[] {
  const items: ActionItem[] = [];
  const DONE = ["론치완료", "완료", "배포완료"];
  if (DONE.includes(ticket.status)) return [];

  const todayStr = new Date().toISOString().split("T")[0];
  const p = parsePlanningVal(planningVal);

  // 1. ETA 경과 (critical)
  if (ticket.eta && ticket.eta !== "-" && ticket.eta < todayStr) {
    items.push({
      id: "overdue",
      priority: 1,
      level: "critical",
      label: `ETA 경과 (${ticket.eta})`,
      targetTab: "ops",
    });
  }

  // 2. 플래닝 검토필요 (critical)
  if (p.reviewNeeded) {
    items.push({
      id: "review-needed",
      priority: 2,
      level: "critical",
      label: "플래닝 검토 확인 필요",
      targetTab: "ops",
    });
  }

  // 3. 세부 작업 일정 미입력 (warning) — 마일스톤(Kick-Off/Release/Launch) 제외
  const MILESTONE_ROLES = ["Kick-Off", "Release", "Launch"];
  const workRoles = roles.filter(r => !MILESTONE_ROLES.includes(r.role));
  if (workRoles.length === 0) {
    items.push({
      id: "no-schedule",
      priority: 3,
      level: "warning",
      label: "세부 작업 일정 미입력",
      targetTab: "ops",
    });
  }

  // 4. Launch 일정 미정 (warning)
  const hasLaunch = roles.some(
    r => ["Launch", "Release"].includes(r.role) && r.start && r.start !== "-"
  );
  if (!hasLaunch) {
    items.push({
      id: "no-launch",
      priority: 4,
      level: "warning",
      label: "Launch 일정 미정",
      targetTab: "ops",
    });
  }

  // 5. 플래닝 검토 중인 팀 (warning) — 검토중 = amber(attention) 계열
  const reviewingTeams: string[] = [];
  if (p.design === "검토중") reviewingTeams.push("디자인");
  for (const [tk, state] of Object.entries(p.devTracks)) {
    if (state === "검토중") reviewingTeams.push(tk);
  }
  if (reviewingTeams.length > 0) {
    items.push({
      id: "planning-reviewing",
      priority: 5,
      level: "warning",
      label: `플래닝 검토 중 — ${reviewingTeams.join(", ")}`,
      targetTab: "ops",
    });
  }

  // 6. 요청사항 출처 (info) — PR-X: source 별 분기.
  //  - source 미설정 → "요청사항 출처 미선택" (참고)
  //  - source="ETR" 인데 etrTickets 비어있음 → "ETR 미연결" (참고)
  //  - source="ELT" → action 없음 (ELT F/U Wiki 는 PR-Z 에서 별도 안내)
  //  - source="자체발의" → action 없음 (외부 출처 없음)
  const src = etrEntry?.source;
  if (!src) {
    items.push({
      id: "no-source",
      priority: 6,
      level: "info",
      label: "요청사항 출처 미선택",
    });
  } else if (src === "ETR" && !etrEntry?.etrTickets?.length) {
    items.push({
      id: "no-etr",
      priority: 6,
      level: "info",
      label: "요청사항 출처(ETR) 미연결",
    });
  }

  // 7. 관련 문서 미연결 (info) — neutral: 참고 수준
  if (!etrEntry?.wikiLinks?.length && !ticket.prdUrl && !ticket.twoPagerUrl) {
    items.push({
      id: "no-docs",
      priority: 7,
      level: "info",
      label: "관련 문서 미연결",
    });
  }

  return items.sort((a, b) => a.priority - b.priority);
}
