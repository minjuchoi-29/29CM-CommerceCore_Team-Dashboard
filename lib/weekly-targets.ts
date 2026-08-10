export const COMPLETED_WEEKLY_TRACKING_DAYS = 14;

export const DONE_FOR_WEEKLY = new Set([
  "론치완료",
  "완료",
  "배포완료",
  "개발완료",
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

export function isPlanningRefreshStatus(status: string): boolean {
  return !ACTIVE_FOR_WEEKLY.has(status) &&
    !DONE_FOR_WEEKLY.has(status) &&
    !TERMINAL_WITHOUT_WEEKLY.has(status);
}

export type WeeklyTargetTicket = {
  key: string;
  status: string;
  resolutionDate?: string;
  updatedAt?: string;
};

export type WeeklyTargetSelection<T extends WeeklyTargetTicket> = {
  targets: T[];
  recentlyCompletedCount: number;
  skippedHidden: number;
  excludedCompletedKeys: string[];
};

function completedWithinTrackingWindow(
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
    const isDone = DONE_FOR_WEEKLY.has(ticket.status);
    const isActive = ACTIVE_FOR_WEEKLY.has(ticket.status);
    const isRecentlyCompleted = isDone && completedWithinTrackingWindow(ticket, now, trackingDays);
    const eligible = isActive || isRecentlyCompleted;

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
