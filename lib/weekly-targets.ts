export const COMPLETED_WEEKLY_TRACKING_DAYS = 14;

export type JiraStatusCategory = "new" | "indeterminate" | "done" | string;
export type TicketLifecycleKind = "planning" | "active" | "done" | "terminal";
export type TicketViewLifecycle = "planning" | "active" | "recently_completed" | "completed" | "terminal";

/**
 * Jira workflow에서 실제 완료로 쓰는 상태명 fallback.
 * 신규 API 응답은 statusCategory를 우선 사용하지만, 기존 KV 캐시와 테스트 데이터에는
 * statusCategory가 없을 수 있어 상태명 fallback을 함께 유지한다.
 */
export const DONE_FOR_WEEKLY = new Set([
  "론치완료",
  "완료",
]);

export const ACTIVE_FOR_WEEKLY = new Set([
  "기획중",
  "기획완료",
  "디자인중",
  "디자인완료",
  "개발중",
  "개발 진행중",
  "진행중",
  "In Progress",
  "In Review",
  "QA",
  "QA중",
  "검수중",
  // 실제 Jira workflow에서 아직 statusCategory=indeterminate인 실행 상태
  "개발완료",
  "배포완료",
]);

export const TERMINAL_WITHOUT_WEEKLY = new Set([
  "Dropped",
  "Reject",
  "Rejected",
  "Cancelled",
  "Canceled",
  "철회/반려/취소",
  "철회",
  "반려",
  "취소",
  "검수 완료",
]);

const PLANNING_STATUS_OVERRIDES = new Set([
  "SUGGESTED",
  "Backlog",
  "HOLD",
  "Postponed",
  "Blocked",
  "준비중",
  // 일부 Jira workflow는 초안 검토 상태를 indeterminate로 분류하지만,
  // 실제 운영 의미는 개발 실행 전 프리플래닝 단계다.
  "초안 검토 중",
  "초안 검토중",
]);

export type WeeklyTargetTicket = {
  key: string;
  status: string;
  statusCategory?: JiraStatusCategory;
  resolutionDate?: string;
  updatedAt?: string;
};

/**
 * 상태명 번역에 의존하지 않고 Jira statusCategory를 기준으로 화면/동기화 생명주기를 통일한다.
 * HOLD처럼 Jira 카테고리는 진행 중이어도 제품 정책상 플래닝인 상태와,
 * 취소·반려처럼 완료 카테고리여도 Weekly 후속 추적이 불필요한 상태는 이름으로 먼저 구분한다.
 */
export function classifyTicketLifecycle(
  ticket: Pick<WeeklyTargetTicket, "status" | "statusCategory">,
): TicketLifecycleKind {
  if (TERMINAL_WITHOUT_WEEKLY.has(ticket.status)) return "terminal";
  if (PLANNING_STATUS_OVERRIDES.has(ticket.status)) return "planning";

  if (ticket.statusCategory === "done") return "done";
  if (ticket.statusCategory === "indeterminate") return "active";
  if (ticket.statusCategory === "new") return "planning";

  if (DONE_FOR_WEEKLY.has(ticket.status)) return "done";
  if (ACTIVE_FOR_WEEKLY.has(ticket.status)) return "active";
  return "planning";
}

export function isPlanningRefreshTicket(
  ticket: Pick<WeeklyTargetTicket, "status" | "statusCategory">,
): boolean {
  return classifyTicketLifecycle(ticket) === "planning";
}

/** @deprecated 저장된 statusCategory가 없는 legacy 호출만 지원한다. */
export function isPlanningRefreshStatus(status: string): boolean {
  return isPlanningRefreshTicket({ status });
}

export type WeeklyTargetSelection<T extends WeeklyTargetTicket> = {
  targets: T[];
  recentlyCompletedCount: number;
  skippedHidden: number;
  excludedCompletedKeys: string[];
};

export function completedWithinTrackingWindow(
  ticket: WeeklyTargetTicket,
  now: Date,
  trackingDays: number,
): boolean {
  const trackingStartedAt = ticket.resolutionDate;
  if (!trackingStartedAt) return false;
  const completedAt = new Date(trackingStartedAt).getTime();
  if (!Number.isFinite(completedAt)) return false;
  const ageMs = now.getTime() - completedAt;
  return ageMs >= 0 && ageMs <= trackingDays * 24 * 60 * 60 * 1000;
}

/**
 * 목록·상세·Weekly Sync가 같은 기준으로 티켓을 분류하도록 만든 화면용 생명주기.
 * Jira의 완료일이 확인되는 경우에만 최근 완료 추적 대상으로 승격하며,
 * 취소·반려 같은 terminal 상태는 완료 실적과 분리한다.
 */
export function getTicketViewLifecycle(
  ticket: WeeklyTargetTicket,
  now: Date = new Date(),
  trackingDays = COMPLETED_WEEKLY_TRACKING_DAYS,
): TicketViewLifecycle {
  const lifecycle = classifyTicketLifecycle(ticket);
  if (lifecycle !== "done") return lifecycle;
  return completedWithinTrackingWindow(ticket, now, trackingDays)
    ? "recently_completed"
    : "completed";
}

/**
 * 실행 단계 과제와 실제 완료일 기준 최근 완료 과제만 Weekly Sync 대상으로 선정한다.
 * 플래닝 대기·종료 상태는 제외하며, 일반 updatedAt은 완료 시각으로 사용하지 않는다.
 */
export function selectWeeklySyncTargets<T extends WeeklyTargetTicket>(
  tickets: T[],
  hiddenKeys: Set<string>,
  now: Date = new Date(),
  trackingDays = COMPLETED_WEEKLY_TRACKING_DAYS,
): WeeklyTargetSelection<T> {
  const targets: T[] = [];
  const excludedCompletedKeys: string[] = [];
  let recentlyCompletedCount = 0;
  let skippedHidden = 0;

  for (const ticket of tickets) {
    const lifecycle = getTicketViewLifecycle(ticket, now, trackingDays);
    const isDone = lifecycle === "recently_completed" || lifecycle === "completed";
    const isRecentlyCompleted = lifecycle === "recently_completed";
    const eligible = lifecycle === "active" || isRecentlyCompleted;

    if (!eligible) {
      if (isDone) excludedCompletedKeys.push(ticket.key);
      continue;
    }
    if (hiddenKeys.has(ticket.key)) {
      skippedHidden++;
      continue;
    }
    targets.push(ticket);
    if (isRecentlyCompleted) recentlyCompletedCount++;
  }

  return { targets, recentlyCompletedCount, skippedHidden, excludedCompletedKeys };
}
